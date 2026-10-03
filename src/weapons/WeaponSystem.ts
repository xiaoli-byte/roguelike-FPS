/**
 * 武器系统：两个武器槽、开火状态机（半自动 / 全自动 / 点射 / 光束 / 预热机炮）、换弹（整匣 / 逐发）、
 * 开镜、散布、后坐、切枪，以及随机生成、描述、强化、掉落模型与第一人称模型。
 *
 * 其他模块只通过 IWeaponSystem 接口访问。开镜是唯一写 ctx.cameraFx.fovKick 的地方。
 */
import type * as THREE from 'three';
import type { Element, GameContext, IWeaponSystem, Rarity, WeaponDescription, WeaponInstance } from '../core/types';
import { clamp, clamp01, damp, lerp } from '../core/math';
import { rollAffixes } from './Affixes';
import { AffixEffects, type WeaponRuntime } from './AffixEffects';
import { describeWeapon } from './Describe';
import { Ballistics, makeBeamHit, shotColor } from './Firing';
import { Viewmodel, type ViewmodelState } from './Viewmodel';
import { getWeaponDef, hasWeaponDef, MAX_LEVEL, WEAPON_IDS, type WeaponDef } from './WeaponDefs';
import { buildWorldModel } from './WeaponModels';
import { resolveWeapon, type ResolvedWeapon } from './WeaponStats';

/** 切枪总时长（收枪 + 掏枪），期间不能开火 */
const SWITCH_TIME = 0.35;
/** 其中收枪所占比例 */
const HOLSTER_FRAC = 0.4;
/** 半自动 / 点射的输入缓冲（提前按下也能在冷却结束时打出） */
const FIRE_BUFFER = 0.14;
/** 打空后自动换弹的延迟 */
const AUTO_RELOAD_DELAY = 0.25;
/**
 * 逐发装填结束（装满或被开火打断）后的上膛时间，期间不能开火。
 * 没有它的话「装一发打一发」几乎不花额外时间（装一发 ≈ 射击间隔），霰弹枪等于无限弹匣，持续秒伤从约 85 涨到 140。
 */
const SHELL_RACK_TIME = 0.3;
const SLOW_SOURCE = 'weapon:minigun';
const HELD_SOURCE = 'weapon:held';
const RANDOM_ELEMENTS: readonly Element[] = ['fire', 'shock', 'corrode'];
/** 精良及以上获得随机元素的概率 */
const RANDOM_ELEMENT_CHANCE = 0.35;
const RARITIES: readonly Rarity[] = [0, 1, 2, 3, 4];
/** 各章稀有度权重：第一章以普通/精良为主，第三章常见史诗 */
const CHAPTER_RARITY: readonly (readonly number[])[] = [
  [58, 32, 8, 2, 0.4],
  [28, 36, 24, 9, 3],
  [10, 26, 32, 22, 10],
];

let nextUid = 1;

/** 把外部传入的稀有度规整到 0..4 的整数（容错：越界 / NaN） */
function toRarity(r: number): Rarity {
  return (Number.isFinite(r) ? clamp(Math.round(r), 0, 4) : 0) as Rarity;
}

export class WeaponSystem implements IWeaponSystem {
  slots: (WeaponInstance | null)[] = [null, null];
  activeSlot = 0;

  private readonly vm: Viewmodel;
  private readonly ballistics: Ballistics;
  private readonly effects: AffixEffects;
  private readonly runtimes = new WeakMap<WeaponInstance, WeaponRuntime>();
  /** describe() 结果缓存：交互提示每帧都会拉取，避免每帧重建字符串与数组 */
  private readonly descCache = new WeakMap<WeaponInstance, { R: ResolvedWeapon; version: number; level: number; rarity: number; affixes: number; element: Element; desc: WeaponDescription }>();
  private readonly beamHit = makeBeamHit();
  private readonly vmState: ViewmodelState = {
    aimT: 0, lowerT: 0, reloading: false, reloadP: 0, shellMode: false, firing: false, spin: 0, scoped: false, sinceShot: 99, cock: 1,
  };
  private readonly rand = (): number => this.ctx.rng.next();

  // 换弹
  private reloading = false;
  private reloadElapsed = 0;
  private reloadTotal = 1;
  private shellMode = false;
  private shellTimer = 0;
  private shellsInserted = 0;
  private shellsNeeded = 1;
  // 开火
  private cooldown = 0;
  private fireBuffer = 0;
  private burstLeft = 0;
  private burstTimer = 0;
  private volleyLeft = 0;
  private volleyTimer = 0;
  private volleyCrit = false;
  private volleyMult = 1;
  private spin = 0;
  private spinning = false;
  private minigunFiring = false;
  private slowApplied = false;
  private beamOn = false;
  private beamAcc = 0;
  private beamSfx = 0;
  private autoReload = 0;
  private dryTimer = 0;
  /** 所有武器弹药全空的持续时间（应急补给用） */
  private starvedTime = 0;
  private lastShotTime = -99;
  private consecutive = 0;
  // 切枪
  private switchTimer = 0;
  private holster: WeaponInstance | null = null;
  // 瞄准 / 散布
  private aimT = 0;
  private bloom = 0;
  private spreadNow = 0.02;
  private hudSpread = 0.02;

  constructor(readonly ctx: GameContext) {
    this.vm = new Viewmodel(ctx);
    this.ballistics = new Ballistics(ctx, this.vm, this.rand);
    this.effects = new AffixEffects(ctx, {
      find: (uid) => this.findByUid(uid),
      resolve: (inst) => this.resolve(inst),
      runtime: (inst) => this.runtime(inst),
      refill: (inst, n) => this.refill(inst, n),
    });
  }

  // ───────────── IWeaponSystem：只读状态 ─────────────

  get active(): WeaponInstance | null {
    return this.slots[this.activeSlot] ?? null;
  }

  get isReloading(): boolean {
    return this.reloading;
  }

  get reloadProgress(): number {
    if (!this.reloading) return 0;
    if (this.shellMode) {
      const inst = this.active;
      if (!inst) return 0;
      const R = this.resolve(inst);
      const step = this.shellsInserted === 0 ? R.reloadStart + R.shellTime : R.shellTime;
      const partial = 1 - clamp01(this.shellTimer / Math.max(0.01, step));
      return clamp01((this.shellsInserted + partial) / Math.max(1, this.shellsNeeded));
    }
    return clamp01(this.reloadElapsed / this.reloadTotal);
  }

  get currentSpread(): number {
    return this.hudSpread;
  }

  magCapacity(inst: WeaponInstance): number {
    return this.resolve(inst).magCap;
  }

  reserveCapacity(inst: WeaponInstance): number {
    return this.resolve(inst).reserveCap;
  }

  allDefIds(): string[] {
    return [...WEAPON_IDS];
  }

  // ───────────── 生命周期 ─────────────

  init(): void {
    this.vm.init();
    // 「猎首」修饰器在这里注册一次：Combat.clear()（换关）不会移除修饰器（types.ts 已写明）
    this.effects.init();
    this.ctx.events.on('player:died', () => {
      this.stopActions();
      this.aimT = 0;
      this.ctx.cameraFx.fovKick = 0;
    });
  }

  /**
   * 换关 / 开局 / 回菜单（Game.clearStage 调用）：停止一切进行中的动作，清掉开镜、机炮减速与待执行的触发效果。
   * 进行中的换弹直接完成（换关有淡入淡出，玩家不必在新关卡开头重按 R），不发事件。
   */
  clear(): void {
    if (this.reloading) {
      const inst = this.active;
      if (inst) {
        const cap = this.magCapacity(inst);
        const take = Math.min(Math.max(0, cap - inst.mag), Math.max(0, inst.reserve));
        inst.mag += take;
        inst.reserve -= take;
      }
      this.reloading = false;
      this.shellMode = false;
    }
    this.stopActions();
    this.aimT = 0;
    this.bloom = 0;
    this.cooldown = 0;
    this.starvedTime = 0;
    this.dryTimer = 0;
    this.ctx.cameraFx.fovKick = 0;
    this.effects.clear();
    this.vm.clearTransient();
  }

  resetForRun(startingWeaponId: string): void {
    this.clear();
    this.vm.resetModels();
    const inst = this.roll({ defId: hasWeaponDef(startingWeaponId) ? startingWeaponId : 'rifle', rarity: 0 });
    this.slots = [inst, null];
    this.activeSlot = 0;
    this.holster = null;
    this.switchTimer = SWITCH_TIME;
    this.lastShotTime = -99;
    this.applyHeldMods();
    this.vm.setWeapon(inst);
    this.ctx.events.emit('weapon:switched', { weapon: inst, slot: 0 });
  }

  give(inst: WeaponInstance): WeaponInstance | null {
    this.ctx.events.emit('weapon:acquired', { weapon: inst });
    const empty = this.slots.indexOf(null);
    if (empty >= 0) {
      this.slots[empty] = inst;
      this.switchTo(empty, true);
      return null;
    }
    this.finishVolley();
    this.stopActions();
    const old = this.slots[this.activeSlot];
    if (old) this.runtime(old).readyAt = this.ctx.time.now + Math.max(0, this.cooldown);
    this.slots[this.activeSlot] = inst;
    this.holster = null;
    this.switchTimer = SWITCH_TIME;
    this.aimT = 0;
    this.bloom = 0;
    this.cooldown = Math.max(0, this.runtime(inst).readyAt - this.ctx.time.now);
    this.applyHeldMods();
    this.vm.setWeapon(inst);
    this.vm.prune(this.slots);
    this.ctx.events.emit('weapon:switched', { weapon: inst, slot: this.activeSlot });
    return old;
  }

  addAmmoFraction(frac: number): void {
    if (!(frac > 0)) return;
    for (const w of this.slots) {
      if (!w) continue;
      const cap = this.reserveCapacity(w);
      if (w.reserve >= cap) continue;
      w.reserve = Math.min(cap, w.reserve + Math.max(1, Math.ceil(cap * frac)));
    }
  }

  roll(opts?: { chapter?: number; rarity?: Rarity; minRarity?: Rarity; defId?: string }): WeaponInstance {
    const rng = this.ctx.rng;
    const defId = opts?.defId && hasWeaponDef(opts.defId) ? opts.defId : rng.pick(WEAPON_IDS);
    const def = getWeaponDef(defId);
    const minR = toRarity(opts?.minRarity ?? 0);
    const chapter = opts?.chapter ?? this.ctx.run.chapter;
    let rarity: Rarity = opts?.rarity !== undefined ? toRarity(opts.rarity) : this.rollRarity(Number.isFinite(chapter) ? chapter : 0, minR);
    if (rarity < minR) rarity = minR;
    let element: Element = def.element;
    if (element === 'none' && rarity >= 1 && rng.chance(RANDOM_ELEMENT_CHANCE)) element = rng.pick(RANDOM_ELEMENTS);
    const inst: WeaponInstance = {
      uid: nextUid++, defId: def.id, rarity, element, level: 0, mag: 0, reserve: 0,
      affixes: rollAffixes(def, rarity, element, rng),
    };
    const R = this.resolve(inst);
    inst.mag = R.magCap;
    inst.reserve = R.reserveCap;
    return inst;
  }

  /** 返回的对象会被缓存复用（武器或玩家属性变化时重建），调用方只读不改 */
  describe(inst: WeaponInstance): WeaponDescription {
    const R = this.resolve(inst);
    const c = this.descCache.get(inst);
    if (c && c.R === R && c.version === R.kVersion && c.level === inst.level && c.rarity === inst.rarity
      && c.affixes === inst.affixes.length && c.element === inst.element) {
      return c.desc;
    }
    const desc = describeWeapon(inst, R);
    this.descCache.set(inst, { R, version: R.kVersion, level: inst.level, rarity: inst.rarity, affixes: inst.affixes.length, element: inst.element, desc });
    return desc;
  }

  createWorldModel(inst: WeaponInstance): THREE.Object3D {
    return buildWorldModel(inst.defId, inst.rarity, inst.element);
  }

  upgradeCost(inst: WeaponInstance): number | null {
    if (inst.level >= MAX_LEVEL) return null;
    return Math.round(50 * (inst.level + 1) * (1 + 0.3 * Math.max(0, this.ctx.run.chapter)));
  }

  upgrade(inst: WeaponInstance): void {
    if (inst.level < MAX_LEVEL) inst.level++;
  }

  setViewmodelVisible(v: boolean): void {
    this.vm.setVisible(v);
  }

  // ───────────── 每帧 ─────────────

  update(dt: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    this.effects.flush();

    const inputOk = ctx.input.enabled && player.alive;
    if (inputOk) this.handleSwitchInput();
    if (this.switchTimer > 0) this.switchTimer = Math.max(0, this.switchTimer - dt);
    if (this.dryTimer > 0) this.dryTimer -= dt;
    this.cooldown -= dt;

    const inst = this.active;
    if (!inst) {
      this.idle(dt);
      return;
    }
    const R = this.resolve(inst);
    const def = R.def;
    const infinite = (ctx.run.flags.infiniteAmmo ?? 0) > 0;
    const fireDown = inputOk && ctx.input.down('fire');
    if (inputOk && ctx.input.pressed('fire')) this.fireBuffer = FIRE_BUFFER;
    else this.fireBuffer = Math.max(0, this.fireBuffer - dt);

    // 狂热层数衰减与实际射速
    const rt = this.runtime(inst);
    if (rt.frenzy > 0 && ctx.time.now - rt.frenzyTime > 2) rt.frenzy = 0;
    const frenzyMult = R.legendary === 'lg_frenzy' ? 1 + rt.frenzy * R.legendaryValue : 1;
    const rate = R.fireRate * frenzyMult;
    const rateMult = R.fireRateMult * frenzyMult;

    // 开镜（狙击换弹时强制退镜）
    const wantAim = inputOk && ctx.input.down('aim') && this.switchTimer <= 0 && !(this.reloading && def.kind === 'sniper');
    this.aimT = damp(this.aimT, wantAim ? 1 : 0, def.aimSpeed, dt);
    let fov = damp(ctx.cameraFx.fovKick, wantAim ? def.aimFov : 0, def.aimSpeed, dt);
    if (Math.abs(fov) < 0.02) fov = 0;
    ctx.cameraFx.fovKick = fov;

    // 换弹。无限弹药期间（猎隼 Q 等）弹匣不消耗：进行中的换弹直接中断（不上膛），忽略 R 键与自动换弹，保证马上能开火
    if (infinite) {
      if (this.reloading) this.cancelReload(false);
    } else if (inputOk && ctx.input.pressed('reload')) {
      this.startReload(inst, R);
    }
    if (this.reloading) {
      if (this.shellMode && this.fireBuffer > 0 && inst.mag > 0) {
        this.cancelReload();
        // 上膛后再打出这一枪：输入缓冲至少保留到上膛结束
        this.fireBuffer = Math.max(this.fireBuffer, this.cooldown + 0.05);
      } else {
        this.updateReload(dt, inst, R);
      }
    }

    // 开火
    const ready = this.switchTimer <= 0 && !this.reloading && player.alive;
    const hasAmmo = infinite || inst.mag > 0;
    this.minigunFiring = false;
    switch (def.mode) {
      case 'semi':
        if (this.fireBuffer > 0 && ready && hasAmmo && this.cooldown <= 0 && this.volleyLeft === 0) {
          this.fireBuffer = 0;
          this.shoot(inst, R, infinite);
          this.cooldown = 1 / rate;
        }
        break;
      case 'auto':
        this.autoFire(fireDown && ready, inst, R, infinite, rate);
        break;
      case 'burst':
        this.updateBurst(dt, ready, hasAmmo, inst, R, infinite, rate, rateMult);
        break;
      case 'spinup':
        this.updateMinigun(dt, fireDown && ready, hasAmmo, inst, R, infinite, rate, rateMult);
        break;
      case 'beam':
        this.updateBeam(dt, fireDown && ready && hasAmmo, inst, R, infinite, rate);
        break;
    }
    if (this.volleyLeft > 0) this.updateVolley(dt, inst, R);
    if (this.cooldown < 0) this.cooldown = 0;
    this.updateSlow(this.minigunFiring);

    this.handleEmpty(dt, inst, R, infinite, fireDown, inputOk);
    this.checkStarvation(dt, infinite);
    this.updateSpread(dt, def, R);
    this.updateViewmodel(dt, inst, rate, infinite);
  }

  private idle(dt: number): void {
    const ctx = this.ctx;
    this.aimT = damp(this.aimT, 0, 16, dt);
    const fov = damp(ctx.cameraFx.fovKick, 0, 16, dt);
    ctx.cameraFx.fovKick = Math.abs(fov) < 0.02 ? 0 : fov;
    this.updateSlow(false);
    this.vm.setWeapon(null);
    this.hudSpread = damp(this.hudSpread, 0.02, 10, dt);
    this.vm.update(dt, this.vmState);
  }

  private handleSwitchInput(): void {
    const input = this.ctx.input;
    if (input.pressed('weapon1')) this.switchTo(0);
    else if (input.pressed('weapon2')) this.switchTo(1);
    else if (input.pressed('swapWeapon')) this.switchTo(1 - this.activeSlot);
    else if (input.wheel !== 0 && this.switchTimer < SWITCH_TIME * 0.5) this.switchTo(1 - this.activeSlot);
  }

  /** 切到指定槽。force = 即使是当前槽也重新掏枪（拾取到当前空槽时） */
  private switchTo(slot: number, force = false): void {
    const target = this.slots[slot];
    if (!target) return;
    if (slot === this.activeSlot && !force) return;
    const prev = this.slots[this.activeSlot];
    this.finishVolley();
    this.stopActions();
    // 射击冷却按武器记录：切走时保存，切回时恢复
    const now = this.ctx.time.now;
    if (prev && prev !== target) this.runtime(prev).readyAt = now + Math.max(0, this.cooldown);
    this.cooldown = Math.max(0, this.runtime(target).readyAt - now);
    this.bloom = 0;
    this.holster = prev && prev !== target ? prev : null;
    this.activeSlot = slot;
    this.switchTimer = SWITCH_TIME;
    this.applyHeldMods();
    this.ctx.audio.play('weapon_switch', { volume: 0.7 });
    this.ctx.events.emit('weapon:switched', { weapon: target, slot });
  }

  /** 中断换弹、点射、光束、机炮与连射计数（保留弹药） */
  private stopActions(): void {
    if (this.reloading) this.cancelReload();
    this.burstLeft = 0;
    this.volleyLeft = 0;
    this.endBeam();
    this.spin = 0;
    this.spinning = false;
    this.minigunFiring = false;
    this.updateSlow(false);
    this.fireBuffer = 0;
    this.autoReload = 0;
    this.consecutive = 0;
  }

  // ───────────── 开火模式 ─────────────

  /** 全自动：按住时按射速连发（同帧最多 4 发，保留冷却余量以保证高射速准确） */
  private autoFire(active: boolean, inst: WeaponInstance, R: ResolvedWeapon, infinite: boolean, rate: number): void {
    if (!active) return;
    let n = 0;
    while (this.cooldown <= 0 && n < 4 && (infinite || inst.mag > 0)) {
      this.shoot(inst, R, infinite);
      this.cooldown += 1 / rate;
      n++;
    }
  }

  private updateBurst(dt: number, ready: boolean, hasAmmo: boolean, inst: WeaponInstance, R: ResolvedWeapon, infinite: boolean, rate: number, rateMult: number): void {
    const def = R.def;
    if (this.burstLeft === 0 && this.fireBuffer > 0 && ready && hasAmmo && this.cooldown <= 0) {
      this.fireBuffer = 0;
      this.burstLeft = def.burstCount;
      this.burstTimer = 0;
      this.cooldown = 1 / rate;
    }
    if (this.burstLeft <= 0) return;
    this.burstTimer -= dt;
    while (this.burstLeft > 0 && this.burstTimer <= 0) {
      if (!ready || !(infinite || inst.mag > 0)) {
        this.burstLeft = 0;
        break;
      }
      this.shoot(inst, R, infinite);
      this.burstLeft--;
      this.burstTimer += def.burstInterval / rateMult;
    }
  }

  /** 机炮：按住预热，转满后才开火；开火期间减速 */
  private updateMinigun(dt: number, want: boolean, hasAmmo: boolean, inst: WeaponInstance, R: ResolvedWeapon, infinite: boolean, rate: number, rateMult: number): void {
    const def = R.def;
    if (want) {
      if (!this.spinning) {
        this.spinning = true;
        this.ctx.audio.play('weapon_switch', { volume: 0.5, pitch: 0.55 });
      }
      this.spin = Math.min(1, this.spin + (dt * rateMult) / Math.max(0.05, def.spinup));
    } else {
      this.spinning = false;
      this.spin = Math.max(0, this.spin - dt / 0.9);
    }
    const firing = want && this.spin >= 1 && hasAmmo;
    this.autoFire(firing, inst, R, infinite, rate);
    this.minigunFiring = firing;
  }

  /** 光束：按住持续放电，每跳伤害一次并消耗 1 点能量 */
  private updateBeam(dt: number, active: boolean, inst: WeaponInstance, R: ResolvedWeapon, infinite: boolean, rate: number): void {
    if (!active) {
      this.endBeam();
      return;
    }
    const interval = 1 / Math.max(0.1, rate);
    if (!this.beamOn) {
      this.beamOn = true;
      this.beamAcc = interval;
      this.beamSfx = 0;
    }
    this.ballistics.beamTrace(inst, R, this.beamHit);
    this.beamAcc += dt;
    let n = 0;
    while (this.beamAcc >= interval && n < 4) {
      this.beamAcc -= interval;
      n++;
      if (!infinite && inst.mag <= 0) break;
      this.shoot(inst, R, infinite);
    }
    this.beamSfx -= dt;
    if (this.beamSfx <= 0) {
      this.beamSfx = 0.16;
      this.ctx.audio.play(R.def.sfx, { volume: R.def.sfxVolume, pitch: 0.95 + Math.random() * 0.1 });
    }
  }

  /** 停止光束：清掉放电状态并提前收掉正在绘制的光束（停火 / 换弹 / 切枪 / 死亡 / 换关） */
  private endBeam(): void {
    this.beamOn = false;
    this.ballistics.stopBeam();
  }

  /** 蜂群：一轮齐射的弹体按间隔依次发射 */
  private updateVolley(dt: number, inst: WeaponInstance, R: ResolvedWeapon): void {
    const p = R.def.projectile;
    if (!p) {
      this.volleyLeft = 0;
      return;
    }
    this.volleyTimer -= dt;
    while (this.volleyLeft > 0 && this.volleyTimer <= 0) {
      this.ballistics.projectile(inst, R, this.spreadNow, this.volleyCrit, this.volleyMult, p.fan);
      this.feedback(inst, R, 1);
      this.volleyLeft--;
      this.volleyTimer += p.stagger;
    }
  }

  /** 切枪 / 替换前把剩余的齐射弹体立即打完（弹药已扣） */
  private finishVolley(): void {
    const inst = this.active;
    if (this.volleyLeft <= 0 || !inst) return;
    const R = this.resolve(inst);
    const p = R.def.projectile;
    while (p && this.volleyLeft > 0) {
      this.ballistics.projectile(inst, R, this.spreadNow, this.volleyCrit, this.volleyMult, p.fan);
      this.volleyLeft--;
    }
    this.volleyLeft = 0;
  }

  /**
   * 一次射击：扣弹、传说特性判定、发射、反馈、事件。
   * 光束每跳、点射每发、蜂群每轮各算一次。
   */
  private shoot(inst: WeaponInstance, R: ResolvedWeapon, infinite: boolean): void {
    const ctx = this.ctx;
    const def = R.def;
    const magBefore = inst.mag;
    let consumed = false;
    if (!infinite) {
      const free = R.legendary === 'lg_endless' && this.rand() < R.legendaryValue;
      if (!free) {
        inst.mag = Math.max(0, inst.mag - 1);
        consumed = true;
      }
    }
    const rt = this.runtime(inst);
    rt.shots++;
    const nth = Math.round(R.legendaryValue);
    const forceCrit = R.legendary === 'lg_nth' && nth > 0 && rt.shots % nth === 0;
    const mult = R.legendary === 'lg_last' && consumed && magBefore === 1 ? R.legendaryValue : 1;

    const p = def.projectile;
    const volley = !!p && p.count > 1;
    if (def.mode === 'beam') {
      this.ballistics.beamTick(inst, R, this.beamHit, forceCrit, mult);
    } else if (volley) {
      this.volleyLeft = p.count;
      this.volleyTimer = 0;
      this.volleyCrit = forceCrit;
      this.volleyMult = mult;
    } else if (p) {
      this.ballistics.projectile(inst, R, this.spreadNow, forceCrit, mult, 0);
    } else {
      this.ballistics.hitscan(inst, R, this.spreadNow, this.pelletCone(def, R), forceCrit, mult);
    }

    const now = ctx.time.now;
    const gap = 1 / Math.max(0.1, R.fireRate * def.burstCount);
    this.consecutive = now - this.lastShotTime < gap * 1.6 + 0.05 ? this.consecutive + 1 : 0;
    this.lastShotTime = now;
    this.bloom = Math.min(def.spreadMax, this.bloom + def.spreadPerShot);
    if (volley) this.updateVolley(0, inst, R);
    else this.feedback(inst, R, 1);
    ctx.events.emit('weapon:fired', { weapon: inst });
  }

  /** 后坐、第一人称后坐与火焰、音效、屏震 */
  private feedback(inst: WeaponInstance, R: ResolvedWeapon, strength: number): void {
    const ctx = this.ctx;
    const def = R.def;
    const rc = def.recoil;
    const climb = 1 + Math.min(this.consecutive, 12) * rc.climb;
    // 开镜大幅稳定（参考枪火重生：开镜后坐约为腰射的一半）
    const k = R.recoilMult * (1 - 0.5 * this.aimT) * strength;
    const pitch = rc.pitch * climb * k * (0.85 + Math.random() * 0.3);
    const yaw = (rc.bias + (Math.random() * 2 - 1) * rc.yaw) * k;
    if (pitch !== 0 || yaw !== 0) ctx.player.addRecoil(pitch, yaw);
    this.vm.onShot(def, shotColor(inst), strength);
    if (def.mode !== 'beam') ctx.audio.play(def.sfx, { volume: def.sfxVolume, pitch: 0.94 + Math.random() * 0.12 });
    if (def.shake > 0) ctx.fx.shake(def.shake * strength, def.shake > 0.15 ? 0.16 : 0.08);
  }

  // ───────────── 弹药 / 换弹 ─────────────

  /** 空弹：按开火自动换弹；没有备弹时空仓音效。打空后短暂延迟也会自动换弹 */
  private handleEmpty(dt: number, inst: WeaponInstance, R: ResolvedWeapon, infinite: boolean, fireDown: boolean, inputOk: boolean): void {
    const empty = !infinite && inst.mag <= 0;
    if (!empty || this.reloading || this.switchTimer > 0) {
      this.autoReload = 0;
      return;
    }
    const def = R.def;
    if (inputOk) {
      const holdMode = def.mode === 'auto' || def.mode === 'spinup' || def.mode === 'beam';
      if (this.fireBuffer > 0 || (fireDown && holdMode)) {
        this.fireBuffer = 0;
        if (inst.reserve > 0) {
          this.startReload(inst, R);
          return;
        }
        if (this.dryTimer <= 0) {
          this.ctx.audio.play('dry_fire', { volume: 0.8 });
          this.vm.dryKick();
          this.dryTimer = 0.3;
        }
      }
    }
    if (inst.reserve > 0 && this.burstLeft === 0 && this.volleyLeft === 0 && this.ctx.player.alive) {
      this.autoReload += dt;
      if (this.autoReload >= AUTO_RELOAD_DELAY) this.startReload(inst, R);
    }
  }

  /**
   * 防卡关：所有武器弹匣与备弹全空持续 2.5 秒时，给当前武器补一个弹匣的备弹。
   * 只在战斗关（有活着的敌人）时触发，避免在商店里无限刷弹药。
   */
  private checkStarvation(dt: number, infinite: boolean): void {
    const ctx = this.ctx;
    const inst = this.active;
    if (infinite || !inst || !ctx.player.alive) {
      this.starvedTime = 0;
      return;
    }
    let allEmpty = true;
    for (const w of this.slots) {
      if (w && (w.mag > 0 || w.reserve > 0)) {
        allEmpty = false;
        break;
      }
    }
    if (!allEmpty || ctx.enemies.aliveCount() === 0) {
      this.starvedTime = 0;
      return;
    }
    this.starvedTime += dt;
    if (this.starvedTime < 2.5) return;
    this.starvedTime = 0;
    inst.reserve = Math.min(this.reserveCapacity(inst), inst.reserve + this.magCapacity(inst));
    ctx.audio.play('pickup_ammo');
    ctx.ui.toast('应急补给：弹药 +1 匣', '#e8c46a');
  }

  private startReload(inst: WeaponInstance, R: ResolvedWeapon): boolean {
    if (this.reloading || this.switchTimer > 0 || this.volleyLeft > 0) return false;
    // 无限弹药期间不换弹（R 键 / 空仓自动换弹都走这里，统一兜底）
    if ((this.ctx.run.flags.infiniteAmmo ?? 0) > 0) return false;
    if (inst.mag >= R.magCap || inst.reserve <= 0) return false;
    this.burstLeft = 0;
    this.endBeam();
    this.autoReload = 0;
    this.reloading = true;
    if (R.def.shellTime > 0) {
      this.shellMode = true;
      // 准备动作 + 第一发
      this.shellTimer = R.reloadStart + R.shellTime;
      this.shellsInserted = 0;
      this.shellsNeeded = Math.max(1, Math.min(R.magCap - inst.mag, inst.reserve));
    } else {
      this.shellMode = false;
      this.reloadElapsed = 0;
      this.reloadTotal = Math.max(0.2, R.reloadTime);
    }
    this.ctx.audio.play('reload_start', { volume: 0.8 });
    this.ctx.events.emit('weapon:reloadStart', { weapon: inst });
    return true;
  }

  private updateReload(dt: number, inst: WeaponInstance, R: ResolvedWeapon): void {
    if (this.shellMode) {
      this.shellTimer -= dt;
      let guard = 0;
      while (this.reloading && this.shellTimer <= 0 && guard++ < 4) {
        if (inst.mag < R.magCap && inst.reserve > 0) {
          inst.mag++;
          inst.reserve--;
          this.shellsInserted++;
          this.vm.shellInserted();
          this.ctx.audio.play('reload_end', { volume: 0.45, pitch: 1.3 + Math.random() * 0.1 });
        }
        if (inst.mag >= R.magCap || inst.reserve <= 0) this.finishReload(inst, true);
        else this.shellTimer += Math.max(0.05, R.shellTime);
      }
      return;
    }
    this.reloadElapsed += dt;
    if (this.reloadElapsed >= this.reloadTotal) {
      const take = Math.min(Math.max(0, R.magCap - inst.mag), inst.reserve);
      inst.mag += take;
      inst.reserve -= take;
      this.finishReload(inst, false);
    }
  }

  private finishReload(inst: WeaponInstance, rack: boolean): void {
    this.reloading = false;
    this.shellMode = false;
    if (rack) this.rackAfterShells();
    this.ctx.audio.play('reload_end', { volume: 0.85 });
    this.ctx.events.emit('weapon:reloaded', { weapon: inst });
  }

  /**
   * 中断换弹；逐发装填已压入的弹保留，并视为一次（部分）换弹完成。
   * rack = false 时跳过上膛动作与上膛冷却（无限弹药开始时用：弹匣不消耗，没有「装一发打一发」可以钻）。
   */
  private cancelReload(rack = true): void {
    if (!this.reloading) return;
    const inst = this.active;
    const partial = this.shellMode && this.shellsInserted > 0;
    this.reloading = false;
    this.shellMode = false;
    if (partial && inst) {
      if (rack) this.rackAfterShells();
      this.ctx.events.emit('weapon:reloaded', { weapon: inst });
    }
  }

  /** 逐发装填后的上膛：泵动动画 + 短暂不能开火 */
  private rackAfterShells(): void {
    this.vm.rack();
    this.cooldown = Math.max(this.cooldown, SHELL_RACK_TIME);
  }

  private refill(inst: WeaponInstance, rounds: number): void {
    const cap = this.resolve(inst).magCap;
    if (inst.mag >= cap) return;
    inst.mag = Math.min(cap, inst.mag + rounds);
    this.ctx.audio.play('reload_end', { volume: 0.3, pitch: 1.6 });
  }

  // ───────────── 散布 / 属性 / 第一人称 ─────────────

  private pelletCone(def: WeaponDef, R: ResolvedWeapon): number {
    return def.pelletCone > 0 ? def.pelletCone * lerp(1, 0.72, this.aimT) * R.spreadMult : 0;
  }

  /** 连射扩大、停火恢复、移动 / 空中增大、开镜减小 */
  private updateSpread(dt: number, def: WeaponDef, R: ResolvedWeapon): void {
    const p = this.ctx.player;
    // 停火一小段时间（略长于射击间隔）后才开始恢复，保证连射时散布确实累积
    const delay = clamp(1.25 / Math.max(0.1, R.fireRate * def.burstCount), 0.08, 0.35);
    if (this.ctx.time.now - this.lastShotTime > delay) this.bloom = Math.max(0, this.bloom - def.spreadRecovery * dt);
    const base = lerp(def.spreadHip, def.spreadAim, this.aimT);
    const hs = Math.hypot(p.velocity.x, p.velocity.z);
    const moveF = 1 + clamp01(hs / 7.5) * (0.6 - 0.35 * this.aimT);
    const airF = p.onGround ? 1 : 1.5 - 0.25 * this.aimT;
    this.spreadNow = (base * moveF * airF + this.bloom * (1 - 0.45 * this.aimT)) * R.spreadMult;
    const hud = clamp(this.spreadNow + this.pelletCone(def, R), 0, 0.25);
    this.hudSpread = damp(this.hudSpread, hud, 18, dt);
  }

  private updateSlow(on: boolean): void {
    if (on === this.slowApplied) return;
    const stats = this.ctx.player.stats;
    if (on) {
      const inst = this.active;
      const slow = inst ? getWeaponDef(inst.defId).moveSlow : 2;
      stats.add('moveSpeed', -slow, SLOW_SOURCE);
    } else {
      stats.removeSource(SLOW_SOURCE);
    }
    this.slowApplied = on;
  }

  /** 持握类词条（轻盈）：只对当前武器生效 */
  private applyHeldMods(): void {
    const stats = this.ctx.player.stats;
    stats.removeSource(HELD_SOURCE);
    const inst = this.active;
    if (!inst) return;
    const R = this.resolve(inst);
    if (R.swift > 0) stats.add('moveSpeed', R.swift, HELD_SOURCE);
  }

  private updateViewmodel(dt: number, inst: WeaponInstance, rate: number, infinite: boolean): void {
    const s = this.vmState;
    let shown: WeaponInstance = inst;
    if (this.switchTimer > 0) {
      const t = 1 - this.switchTimer / SWITCH_TIME;
      if (this.holster && t < HOLSTER_FRAC) {
        shown = this.holster;
        s.lowerT = t / HOLSTER_FRAC;
      } else if (this.holster) {
        s.lowerT = 1 - (t - HOLSTER_FRAC) / (1 - HOLSTER_FRAC);
      } else {
        s.lowerT = 1 - t;
      }
    } else {
      s.lowerT = 0;
      if (this.holster) {
        this.holster = null;
        this.vm.prune(this.slots);
      }
    }
    this.vm.setWeapon(shown);
    s.aimT = this.aimT;
    s.reloading = this.reloading && shown === inst;
    s.reloadP = this.reloading && !this.shellMode ? clamp01(this.reloadElapsed / this.reloadTotal) : 0;
    s.shellMode = this.reloading && this.shellMode;
    s.firing = this.beamOn || this.minigunFiring;
    s.spin = this.spin;
    s.scoped = this.ctx.cameraFx.fovKick < -30;
    s.sinceShot = this.ctx.time.now - this.lastShotTime;
    if (shown !== inst) s.cock = 1;
    else if (this.reloading) s.cock = clamp01((s.reloadP - 0.6) / 0.3);
    else s.cock = infinite || inst.mag > 0 ? clamp01(1 - this.cooldown * rate) : 0;
    this.vm.update(dt, s);
  }

  // ───────────── 工具 ─────────────

  private resolve(inst: WeaponInstance): ResolvedWeapon {
    return resolveWeapon(inst, this.ctx.player.stats);
  }

  private runtime(inst: WeaponInstance): WeaponRuntime {
    let rt = this.runtimes.get(inst);
    if (!rt) {
      rt = { shots: 0, frenzy: 0, frenzyTime: -99, lastHeadBlast: -99, readyAt: -99 };
      this.runtimes.set(inst, rt);
    }
    return rt;
  }

  private findByUid(uid: number): WeaponInstance | null {
    for (const w of this.slots) if (w && w.uid === uid) return w;
    return null;
  }

  private rollRarity(chapter: number, minRarity: number): Rarity {
    const ch = clamp(Math.floor(chapter), 0, CHAPTER_RARITY.length - 1);
    const base = CHAPTER_RARITY[ch];
    const luck = Math.max(0, this.ctx.player.stats.get('luck'));
    const r = this.ctx.rng.weighted(RARITIES, (x) => {
      if (x < minRarity) return 0;
      const w = base[x];
      return x === 0 ? w / (1 + 0.12 * luck) : w * (1 + 0.15 * luck * x);
    });
    return (r < minRarity ? minRarity : r) as Rarity;
  }
}
