/**
 * 武器系统：两个武器槽、开火状态机（半自动 / 全自动 / 点射 / 光束 / 预热机炮 / 蓄力 / 近战连段）、换弹（整匣 / 逐发 / 召回）、
 * 开镜、散布、后坐、切枪、元素轮转、双形态与武器技能，以及随机生成、描述、强化、掉落模型与第一人称模型。
 *
 * 其他模块只通过 IWeaponSystem 接口访问。开镜是唯一写 ctx.cameraFx.fovKick 的地方。
 *
 * 双形态武器（魔刀千刃，docs/demon-blade.md 第 10.4 节）：右键不开镜而是变形（rt.form 在变形开始时翻转，morphTime 内不能攻击）；
 * 「斩」形态走 updateMelee 的三段连斩（单判定帧，扇形判定见 Melee.ts），「千刃」形态复用投射物 / 换弹（固定扇形齐射、按柄计弹、召回）。
 * 武器技能「千刃·无间」由 BladeSkill 持有（冷却全局一条，update 每帧调用，不论当前武器）。
 */
import * as THREE from 'three';
import type {
  DamageRequest, Element, GameContext, IEnemy, IWeaponSystem, Rarity, WeaponDescription, WeaponForm, WeaponInstance, WeaponSkillState,
} from '../core/types';
import { clamp, clamp01, damp, lerp } from '../core/math';
import { rollAffixes } from './Affixes';
import { AffixEffects, type WeaponRuntime } from './AffixEffects';
import { BladeSkill } from './BladeSkill';
import { describeWeapon } from './Describe';
import { Ballistics, makeBeamHit, NO_SHOT, shotColor, type ShotMods } from './Firing';
import { bladeColor, surfaceDistance, sweepSector, type MeleeSector } from './Melee';
import { createViewmodelState, Viewmodel } from './Viewmodel';
import {
  formMode, getWeaponDef, hasWeaponDef, MAX_LEVEL, WEAPON_DEFS, WEAPON_IDS,
  type FireMode, type MeleeParams, type MeleeSegment, type ProjectileParams, type WeaponDef,
} from './WeaponDefs';
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

// ───── 双形态 / 近战手感常量表（docs/demon-blade.md 10.1.3；各段前摇 / 整段 / 扇形在 WeaponDefs 的 melee.combo） ─────
/** 右键在不能变形时（判定帧前 / 切枪中）缓冲的秒数 */
const MORPH_BUFFER = 0.25;
/** 「斩」形态 currentSpread 的目标值（准星张开，提示近战） */
const MELEE_HUD_SPREAD = 0.035;
/** 斩击击退方向的上抬分量（与水平单位向量相加后归一化） */
const KNOCK_LIFT = 0.2;
/** 斩击命中点：身体中心沿「敌人 → 玩家」水平方向移向表面的比例（× 敌人半径） */
const SLASH_POINT_INSET = 0.8;
/** 第三段前冲结束后保留的速度（米/秒）与前冲最短时长 */
const SEG_EXIT_SPEED = 2;
const SEG_LUNGE_MIN_TIME = 0.05;
/**
 * 连段追击：上一段命中、本段没有自带前冲、扇形内没有敌人在攻击距离内，但最近的敌人表面在 range + CHASE_REACH 内时，
 * 前摇中朝它软突进 min(CHASE_MAX, 差距 + CHASE_MARGIN) 米（被上一段击退出攻击距离的敌人仍能接上连段）
 */
const CHASE_REACH = 1.2;
const CHASE_MARGIN = 0.2;
const CHASE_MAX = 1.4;
/** 「换形一击」用掉后，至少隔这么久变形完成才会再打开窗口（防止连续变形刷出每一击都 ×1.5） */
const STRIKE_REARM = 1.5;
/** 三段挥砍 blade_swing 的音高、blade_hit 的音量（最后一段 pitch HEAVY_HIT_PITCH） */
const SWING_PITCH: readonly number[] = [1.06, 0.96, 0.82];
const SLASH_HIT_VOLUME: readonly number[] = [0.7, 0.7, 1.0];
const HEAVY_HIT_PITCH = 0.85;
/** 斩击命中的屏震时长（强度为 MeleeSegment.shake） */
const SLASH_SHAKE_TIME = 0.13;
/** 斩击命中的镜头冲击 [roll, pitch]（角速度冲量，见 IPlayer.cameraPunch）：横斩 / 回斩向挥砍方向一歪，下劈向下一顿 */
const SLASH_PUNCH: readonly (readonly [number, number])[] = [[-0.45, 0.15], [0.45, 0.15], [0, -0.9]];
/** 准星的「攻击距离内」检测间隔（帧） */
const IN_RANGE_EVERY = 3;
/** 每段最多播几个 fx.blade.slashHit */
const MAX_SLASH_FX = 6;
/** 斩击伤害请求的标签（模块级常量数组，不修改；只做标识，不影响倍率） */
const SLASH_TAGS: string[] = ['slash'];
/** 换弹召回时刃片特效的起点：眼前 RECALL_FX_DIST 米 */
const RECALL_FX_DIST = 6;

const _fwd = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _muz = new THREE.Vector3();
const _body = new THREE.Vector3();
/** 连段追击的加长扇形（复用） */
const _chaseSector: MeleeSector = { range: 0, halfAngle: 0 };

let nextUid = 1;

export class WeaponSystem implements IWeaponSystem {
  slots: (WeaponInstance | null)[] = [null, null];
  activeSlot = 0;

  private readonly vm: Viewmodel;
  private readonly ballistics: Ballistics;
  private readonly effects: AffixEffects;
  private readonly runtimes = new WeakMap<WeaponInstance, WeaponRuntime>();
  private readonly beamHit = makeBeamHit();
  private readonly vmState = createViewmodelState();
  /** 蓄力射击的修饰（复用，避免每发分配） */
  private readonly chargeShot: ShotMods = { mult: 1, pierceBonus: 0, full: false, strength: 1 };
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
  // 蓄力（贯虹灵炮）
  private charge = 0;
  private charging = false;
  private chargeFull = false;
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
  // 双形态（魔刀千刃）：形态本身在 rt.form（按实例），以下为瞬态（按 10.4.9 重置）
  /** 变形剩余秒（> 0 时不能攻击） */
  private morphLeft = 0;
  /** 右键缓冲 */
  private morphBuffer = 0;
  /** 「换形一击」窗口截止（ctx.time.now；-99 = 无） */
  private strikeUntil = -99;
  /** 此刻之前变形完成不打开换形一击窗口（上次用掉 + STRIKE_REARM） */
  private strikeReadyAt = -99;
  // 连段
  /** 下一段 0..n-1 */
  private comboIndex = 0;
  /** 当前段，-1 = 空闲 */
  private swingIdx = -1;
  /** 当前段已进行秒数（已乘攻速） */
  private swingT = 0;
  /** 当前段的判定帧已结算 */
  private swingHit = false;
  /** 当前段带「换形一击」 */
  private swingStrike = false;
  /** 当前段触发了软突进（第三段前冲 / 连段追击）：被打断时一并结束突进 */
  private swingLunge = false;
  /** 上一段判定帧命中了敌人（连段追击的前提） */
  private lastSwingHit = false;
  /** 上一段结束后的空闲秒数 */
  private comboIdle = 0;
  /** 斩击命中列表（Melee.sweepSector 复用） */
  private readonly meleeHits: IEnemy[] = [];
  /** 准星的攻击距离检测（Melee.sweepSector 复用）与结果 */
  private readonly rangeHits: IEnemy[] = [];
  private inRange = false;
  private rangeFrame = 0;
  // 齐射
  /** 本轮实际弹体数（perProjectileAmmo 时 = min(count, 发射前余量)） */
  private volleyCount = 0;
  /** 武器技能（千刃·无间） */
  private readonly skill: BladeSkill;

  constructor(readonly ctx: GameContext) {
    this.vm = new Viewmodel(ctx);
    this.ballistics = new Ballistics(ctx, this.vm, this.rand);
    this.effects = new AffixEffects(ctx, {
      find: (uid) => this.findByUid(uid),
      resolve: (inst) => this.resolve(inst),
      runtime: (inst) => this.runtime(inst),
      refill: (inst, n) => this.refill(inst, n),
    });
    this.skill = new BladeSkill(ctx, {
      resolve: (inst) => this.resolve(inst),
      addBlades: (inst, n, from) => this.addBlades(inst, n, from),
      interrupt: () => this.interruptForSkill(),
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

  /** 蓄力进度 0..1（未在蓄力时为 0，准星蓄力环读取） */
  get chargeProgress(): number {
    return this.charging ? this.charge : 0;
  }

  /** 当前武器的形态（非双形态武器 / 空手为 null） */
  get activeForm(): WeaponForm | null {
    const inst = this.active;
    if (!inst || !getWeaponDef(inst.defId).melee) return null;
    return this.runtime(inst).form;
  }

  /** 形态切换进度 0..1（1 = 已完成 / 未在切换） */
  get formMorphProgress(): number {
    if (this.morphLeft <= 0) return 1;
    const inst = this.active;
    const m = inst ? getWeaponDef(inst.defId).melee : null;
    return m ? clamp01(1 - this.morphLeft / Math.max(0.01, m.morphTime)) : 1;
  }

  /** 「换形一击」窗口剩余秒数（0 = 无窗口或已用掉） */
  get formStrikeTime(): number {
    return Math.max(0, this.strikeUntil - this.ctx.time.now);
  }

  /** 近战形态：下一段斩击此刻挥出能命中敌人（每 IN_RANGE_EVERY 帧更新；准星提示攻击距离） */
  get meleeInRange(): boolean {
    return this.inRange;
  }

  /** 当前武器的武器技能状态（复用对象；当前武器没有武器技能时为 null） */
  get weaponSkill(): WeaponSkillState | null {
    const inst = this.active;
    const sk = inst ? getWeaponDef(inst.defId).skill : null;
    return sk ? this.skill.fill(sk) : null;
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
    this.effects.init();
    const ev = this.ctx.events;
    ev.on('stage:loaded', () => {
      this.clear();
      this.effects.installModifier();
    });
    ev.on('player:died', () => {
      this.stopActions();
      this.skill.abort();
      this.aimT = 0;
      this.ctx.cameraFx.fovKick = 0;
    });
    // 暂停 / 弹窗 / 过场期间不跑 update：离开 playing 时作废进行中的蓄力，
    // 否则恢复后（按键已被 releaseAll 松开）第一帧会把存下的蓄力当作「松手」自动发射
    ev.on('game:stateChanged', ({ to }) => {
      if (to !== 'playing') this.resetCharge();
    });
  }

  /** 换关 / 开局：停止一切进行中的动作，清掉开镜与机炮减速 */
  clear(): void {
    this.stopActions();
    // 换关：突进 / 待贯穿作废（刃印特效由 fx.clear() 清掉）；技能冷却保留
    this.skill.abort();
    this.aimT = 0;
    this.bloom = 0;
    this.cooldown = 0;
    // 换关 / 开局：换形一击的重新就绪时刻作废（ctx.time.now 可能随新局归零）
    this.strikeReadyAt = -99;
    this.ctx.cameraFx.fovKick = 0;
    this.effects.clear();
    this.vm.clearTransient();
  }

  resetForRun(startingWeaponId: string): void {
    this.clear();
    this.skill.resetForRun();
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
    // 不指定 defId 时按 dropWeight 加权（新机制武器略低，减少旧内容被稀释）
    const defId = opts?.defId && hasWeaponDef(opts.defId) ? opts.defId : rng.weighted(WEAPON_DEFS, (d) => d.dropWeight).id;
    const def = getWeaponDef(defId);
    const minR = opts?.minRarity ?? 0;
    let rarity: Rarity = opts?.rarity ?? this.rollRarity(opts?.chapter ?? this.ctx.run.chapter, minR);
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

  describe(inst: WeaponInstance): WeaponDescription {
    return describeWeapon(inst, this.resolve(inst));
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
    // 武器技能突进中不响应切枪
    if (inputOk && !this.skill.dashing) this.handleSwitchInput();
    if (this.switchTimer > 0) this.switchTimer = Math.max(0, this.switchTimer - dt);
    if (this.dryTimer > 0) this.dryTimer -= dt;
    this.cooldown -= dt;
    // 武器技能：冷却 / 突进扫描 / 待贯穿（不论当前武器）
    this.skill.update(dt);

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

    // 狂热层数衰减与实际射速；「疾化」：引发反应后数秒内射速提升（蓄力速度、斩击攻速随之加快）
    const rt = this.runtime(inst);
    if (rt.frenzy > 0 && ctx.time.now - rt.frenzyTime > 2) rt.frenzy = 0;
    const frenzyMult = R.legendary === 'lg_frenzy' ? 1 + rt.frenzy * R.legendaryValue : 1;
    const haste = R.rxnHaste > 0 && ctx.time.now < rt.rxnHasteUntil ? 1 + R.rxnHaste : 1;
    const rate = R.fireRate * frenzyMult * haste;
    const rateMult = R.fireRateMult * frenzyMult * haste;

    if (def.melee) {
      // 双形态：右键只读边沿用于变形（缓冲），不开镜、不写 aimFov；开镜与 FOV 按空手的方式衰减到 0
      if (inputOk && ctx.input.pressed('aim')) this.morphBuffer = MORPH_BUFFER;
      this.aimT = damp(this.aimT, 0, 16, dt);
      const fov = damp(ctx.cameraFx.fovKick, 0, 16, dt);
      ctx.cameraFx.fovKick = Math.abs(fov) < 0.02 ? 0 : fov;
      this.updateMorph(dt, inst, R, rt);
    } else {
      // 开镜（狙击换弹时强制退镜）
      const wantAim = inputOk && ctx.input.down('aim') && this.switchTimer <= 0 && !(this.reloading && def.kind === 'sniper');
      this.aimT = damp(this.aimT, wantAim ? 1 : 0, def.aimSpeed, dt);
      let fov = damp(ctx.cameraFx.fovKick, wantAim ? def.aimFov : 0, def.aimSpeed, dt);
      if (Math.abs(fov) < 0.02) fov = 0;
      ctx.cameraFx.fovKick = fov;
    }
    // 有效开火模式（变形在开始时就翻转了 rt.form，所以在变形处理之后再取）
    const mode: FireMode = def.melee ? formMode(def, rt.form) : def.mode;

    // 武器技能（V / 鼠标中键）：任一形态、变形中都能释放
    if (inputOk && def.skill && this.switchTimer <= 0 && ctx.input.pressed('weaponSkill')) this.skill.tryCast(inst, R);

    // 换弹（「斩」形态无效果）
    if (inputOk && ctx.input.pressed('reload') && mode !== 'melee') this.startReload(inst, R);
    if (this.reloading) {
      if (this.shellMode && this.fireBuffer > 0 && inst.mag > 0) this.cancelReload();
      else this.updateReload(dt, inst, R);
    }

    // 开火（变形中、技能突进中不能攻击）
    const ready = this.switchTimer <= 0 && !this.reloading && player.alive && this.morphLeft <= 0 && !this.skill.dashing;
    const hasAmmo = infinite || inst.mag > 0;
    this.minigunFiring = false;
    switch (mode) {
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
      case 'charge':
        this.updateCharge(dt, fireDown, inputOk, ready && hasAmmo && this.cooldown <= 0, inst, R, infinite, rate, rateMult);
        break;
      case 'melee':
        this.updateMelee(dt, fireDown, ready, inst, R, rateMult);
        break;
    }
    if (this.volleyLeft > 0) this.updateVolley(dt, inst, R);
    if (this.cooldown < 0) this.cooldown = 0;
    this.updateSlow(this.minigunFiring);

    this.handleEmpty(dt, inst, R, infinite, fireDown, inputOk, mode);
    this.checkStarvation(dt, infinite);
    this.updateSpread(dt, def, R, mode);
    this.updateInRange(R, mode);
    this.updateViewmodel(dt, inst, rate, infinite);
  }

  private idle(dt: number): void {
    const ctx = this.ctx;
    this.inRange = false;
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

  /** 中断换弹、点射、光束、机炮、连射计数、变形与连段（保留弹药与各实例的形态） */
  private stopActions(): void {
    if (this.reloading) this.cancelReload();
    this.burstLeft = 0;
    this.volleyLeft = 0;
    this.beamOn = false;
    this.spin = 0;
    this.spinning = false;
    this.minigunFiring = false;
    this.resetCharge();
    this.updateSlow(false);
    this.fireBuffer = 0;
    this.autoReload = 0;
    this.consecutive = 0;
    this.resetMelee();
  }

  /**
   * 变形（清零即视为完成，不触发换形一击）、换形一击窗口与连段重置。
   * 被打断的段若带软突进（第三段前冲 / 追击）一并结束突进——换枪后不再被拖着往前走；技能突进中不动它（那是技能的硬突进）
   */
  private resetMelee(): void {
    if (this.swingIdx >= 0 && this.swingLunge && !this.skill.dashing) this.ctx.player.cancelLunge();
    this.morphLeft = 0;
    this.morphBuffer = 0;
    this.strikeUntil = -99;
    this.swingIdx = -1;
    this.swingT = 0;
    this.swingHit = false;
    this.swingStrike = false;
    this.swingLunge = false;
    this.lastSwingHit = false;
    this.comboIndex = 0;
    this.comboIdle = 0;
    this.meleeHits.length = 0;
    this.inRange = false;
  }

  // ───────────── 双形态（魔刀千刃） ─────────────

  /**
   * 变形推进：缓冲的右键在可变形时执行；变形完成的那一帧打开「换形一击」窗口——
   * 但距上一次换形一击用掉不足 STRIKE_REARM 秒时不打开（判定帧后可以变形取消收势，否则连按右键能让每一击都 ×1.5）
   */
  private updateMorph(dt: number, inst: WeaponInstance, R: ResolvedWeapon, rt: WeaponRuntime): void {
    const m = R.def.melee;
    if (!m) return;
    if (this.morphBuffer > 0) {
      if (this.canMorph()) this.doMorph(inst, R, rt);
      else this.morphBuffer = Math.max(0, this.morphBuffer - dt);
    }
    if (this.morphLeft > 0) {
      this.morphLeft -= dt;
      if (this.morphLeft <= 0) {
        this.morphLeft = 0;
        const now = this.ctx.time.now;
        if (now >= this.strikeReadyAt) this.strikeUntil = now + m.formStrikeWindow;
      }
    }
  }

  /** 换形一击窗口用掉：清除窗口，STRIKE_REARM 秒内变形不再打开 */
  private consumeStrike(): void {
    this.strikeUntil = -99;
    this.strikeReadyAt = this.ctx.time.now + STRIKE_REARM;
  }

  /** 能否立即变形：切枪 / 变形 / 突进中不能；挥砍判定帧之前不能（判定帧之后可以取消收势） */
  private canMorph(): boolean {
    return this.switchTimer <= 0 && this.morphLeft <= 0 && !(this.swingIdx >= 0 && !this.swingHit)
      && !this.skill.dashing && this.ctx.player.alive;
  }

  /** 开始变形：形态立即翻转（HUD 立即显示新形态名），morphTime 内不能攻击；召回（换弹）作废、连段重置 */
  private doMorph(inst: WeaponInstance, R: ResolvedWeapon, rt: WeaponRuntime): void {
    const m = R.def.melee;
    if (!m) return;
    this.morphBuffer = 0;
    if (this.reloading) this.cancelReload();
    this.finishVolley();
    this.swingIdx = -1;
    this.swingHit = false;
    this.swingStrike = false;
    this.swingLunge = false;
    this.lastSwingHit = false;
    this.comboIndex = 0;
    this.comboIdle = 0;
    this.fireBuffer = 0;
    this.autoReload = 0;
    rt.form = rt.form === 'melee' ? 'ranged' : 'melee';
    this.morphLeft = m.morphTime;
    this.strikeUntil = -99;
    this.applyHeldMods();
    this.ctx.audio.play('blade_morph', { volume: 0.8 });
    this.ctx.events.emit('weapon:formChanged', { weapon: inst, form: rt.form });
  }

  /**
   * 三段连斩：按住左键自动接段（缓冲的点击也算），一段结束后空闲超过 comboReset 回到第一段。
   * 每段只在判定帧（swingT 越过 windup）结算一次；speed 为攻速倍率（射速加成 × 狂热 × 疾化），整段时长 / 前摇 ÷ speed。
   */
  private updateMelee(dt: number, fireDown: boolean, ready: boolean, inst: WeaponInstance, R: ResolvedWeapon, speed: number): void {
    const m = R.def.melee;
    if (!m || m.combo.length === 0) return;
    if (this.swingIdx < 0) {
      this.comboIdle += dt;
      if (this.comboIdle > m.comboReset) {
        this.comboIndex = 0;
        this.lastSwingHit = false;
      }
      if (!ready || !(fireDown || this.fireBuffer > 0)) return;
      this.startSwing(inst, R, this.comboIndex % m.combo.length, 0, speed, dt);
    }
    this.swingT += dt * speed;
    // 一帧内最多推进 3 段（低帧率 / 高攻速时保持节奏）
    for (let guard = 0; this.swingIdx >= 0 && guard < 3; guard++) {
      const idx = this.swingIdx;
      const seg = m.combo[idx];
      if (!this.swingHit && this.swingT >= seg.windup) {
        this.swingHit = true;
        this.resolveSwing(inst, R, seg, idx);
        // 结算中的事件（击杀等）可能打断连段
        if (this.swingIdx !== idx) break;
      }
      if (this.swingT < seg.duration) break;
      const over = this.swingT - seg.duration;
      this.comboIndex = (idx + 1) % m.combo.length;
      this.swingIdx = -1;
      this.swingStrike = false;
      this.swingLunge = false;
      this.comboIdle = 0;
      // 按住自动接段
      if (ready && (fireDown || this.fireBuffer > 0)) this.startSwing(inst, R, this.comboIndex, over, speed, dt);
    }
  }

  /** 准星的攻击距离提示：近战形态每 IN_RANGE_EVERY 帧按下一段的扇形扫一次 */
  private updateInRange(R: ResolvedWeapon, mode: FireMode): void {
    const m = R.def.melee;
    if (mode !== 'melee' || !m || m.combo.length === 0 || !this.ctx.player.alive) {
      this.inRange = false;
      return;
    }
    if (++this.rangeFrame % IN_RANGE_EVERY !== 0) return;
    const seg = m.combo[(this.swingIdx >= 0 ? this.swingIdx : this.comboIndex) % m.combo.length];
    this.inRange = sweepSector(this.ctx, seg, m, this.rangeHits).length > 0;
    this.rangeHits.length = 0;
  }

  /** dt：本帧时长（追击突进要在判定帧之前走完） */
  private startSwing(inst: WeaponInstance, R: ResolvedWeapon, idx: number, t0: number, speed: number, dt: number): void {
    const ctx = this.ctx;
    const def = R.def;
    const m = def.melee;
    if (!m) return;
    const seg = m.combo[idx];
    // 连段追击的前提：上一段命中（随后由本段的判定帧重新记录）
    const chase = this.lastSwingHit && seg.lunge <= 0;
    this.swingIdx = idx;
    this.swingT = t0;
    this.swingHit = false;
    this.swingLunge = false;
    this.fireBuffer = 0;
    // 换形一击：本段所有命中 × formStrikeMult，窗口用掉
    this.swingStrike = ctx.time.now < this.strikeUntil;
    if (this.swingStrike) this.consumeStrike();
    this.vm.onSlash(idx, bladeColor(inst, def));
    ctx.audio.play('blade_swing', { volume: 0.75, pitch: SWING_PITCH[idx] ?? 1 });
    const sp = Math.max(0.01, speed);
    if (seg.lunge > 0) {
      // 前冲（第三段）：软突进，在前摇内完成
      ctx.player.getForward(_fwd);
      this.swingLunge = ctx.player.lunge(_fwd, seg.lunge, Math.max(SEG_LUNGE_MIN_TIME, seg.windup / sp), 0, SEG_EXIT_SPEED);
    } else if (chase) {
      this.chase(seg, m, t0, sp, dt);
    }
  }

  /**
   * 连段追击：扇形内没有敌人在攻击距离内、但最近的敌人表面在 range + CHASE_REACH 内时，朝它软突进补上差距。
   * 突进时长 = 判定帧之前剩下的整帧数 × dt（玩家在武器系统之前更新：本帧不动，下一帧起推进），保证判定帧时已走完
   */
  private chase(seg: MeleeSegment, m: MeleeParams, t0: number, speed: number, dt: number): void {
    const ctx = this.ctx;
    if (!(dt > 0)) return;
    const frames = Math.ceil((seg.windup - t0) / (dt * speed)) - 1;
    if (frames < 1) return;
    _chaseSector.range = seg.range + CHASE_REACH;
    _chaseSector.halfAngle = seg.halfAngle;
    const list = sweepSector(ctx, _chaseSector, m, this.rangeHits);
    let best: IEnemy | null = null;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = surfaceDistance(ctx, list[i]);
      if (d < bestD) {
        bestD = d;
        best = list[i];
      }
    }
    list.length = 0;
    // 已有敌人在攻击距离内：原地挥砍
    if (!best || bestD <= seg.range) return;
    const pp = ctx.player.position;
    _fwd.set(best.position.x - pp.x, 0, best.position.z - pp.z);
    const dist = Math.min(CHASE_MAX, bestD - seg.range + CHASE_MARGIN);
    this.swingLunge = ctx.player.lunge(_fwd, dist, frames * dt, 0, SEG_EXIT_SPEED);
  }

  /**
   * 判定帧：扇形内所有敌人各命中一次（没有爆头；对眩晕敌人 stunCrit 段必暴），每命中 1 名敌人召回飞刃（每段封顶），
   * 计「天命」射击次数，并作为一次「开火」派发 weapon:fired。挥空不消耗任何资源；不调用 addRecoil / feedback
   * （命中时的屏震与镜头冲击只动镜头，不改瞄准）。
   */
  private resolveSwing(inst: WeaponInstance, R: ResolvedWeapon, seg: MeleeSegment, idx: number): void {
    const ctx = this.ctx;
    const def = R.def;
    const m = def.melee;
    if (!m) return;
    const player = ctx.player;
    const rt = this.runtime(inst);
    rt.shots++;
    const nth = Math.round(R.legendaryValue);
    const nthCrit = R.legendary === 'lg_nth' && nth > 0 && rt.shots % nth === 0;
    const heavy = idx === m.combo.length - 1;
    const color = bladeColor(inst, def);
    const base = seg.damage * R.damageMult * (this.swingStrike ? m.formStrikeMult : 1);
    const hits = sweepSector(ctx, seg, m, this.meleeHits);
    const pp = player.position;
    let hitCount = 0;
    let fxCount = 0;
    let first: THREE.Vector3 | null = null;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      let hx = e.position.x - pp.x;
      let hz = e.position.z - pp.z;
      const d = Math.hypot(hx, hz);
      if (d > 1e-4) {
        hx /= d;
        hz /= d;
      } else {
        player.getForward(_fwd);
        hx = _fwd.x;
        hz = _fwd.z;
      }
      e.getBodyCenter(_body);
      const inset = e.radius * SLASH_POINT_INSET;
      // DamageResult.request 会被监听者持有：point / direction 每击新建（同 Firing）
      const point = new THREE.Vector3(_body.x - hx * inset, _body.y, _body.z - hz * inset);
      const direction = new THREE.Vector3(hx, KNOCK_LIFT, hz).normalize();
      const crit = nthCrit || (seg.stunCrit && e.stunTime > 0) || (R.critChance > 0 && this.rand() < R.critChance);
      const req: DamageRequest = {
        base,
        element: inst.element,
        source: 'weapon',
        elementChance: R.meleeElementChance,
        critMult: R.critMult,
        weaponUid: inst.uid,
        point,
        direction,
        knockback: seg.knockback,
        procDepth: 0,
        tags: SLASH_TAGS,
      };
      if (crit) req.forceCrit = true;
      if (!ctx.combat.damageEnemy(e, req)) continue;
      hitCount++;
      if (!first) first = point;
      if (fxCount < MAX_SLASH_FX) {
        fxCount++;
        ctx.fx.blade.slashHit(point, direction, color, heavy);
      }
    }
    hits.length = 0;
    this.lastSwingHit = hitCount > 0;
    if (hitCount > 0) {
      // 斩击回刃：每命中 1 名敌人召回 recallPerHit 柄（每段封顶）
      this.addBlades(inst, Math.min(hitCount * m.recallPerHit, m.recallMaxPerSwing), first);
      this.vm.onSlashHit(heavy);
      ctx.audio.play('blade_hit', { volume: SLASH_HIT_VOLUME[idx] ?? 0.7, pitch: heavy ? HEAVY_HIT_PITCH : 1 });
      if (seg.shake > 0) ctx.fx.shake(seg.shake, SLASH_SHAKE_TIME);
      // 方向性的镜头冲击（不改瞄准，弹簧自然回弹）
      const punch = SLASH_PUNCH[idx];
      if (punch) player.cameraPunch(punch[0], punch[1]);
    }
    ctx.fx.blade.slashArc(player.eye, player.yaw, player.pitch, idx, seg.range, seg.halfAngle, color);
    this.lastShotTime = ctx.time.now;
    ctx.events.emit('weapon:fired', { weapon: inst });
  }

  /** 回刃：封顶弹匣；有 from 且是当前武器时播召回特效（from → 枪口）。不派发 weapon:reloaded */
  private addBlades(inst: WeaponInstance, n: number, from: THREE.Vector3 | null): void {
    if (!(n > 0)) return;
    const cap = this.resolve(inst).magCap;
    const add = Math.min(Math.round(n), cap - inst.mag);
    if (add <= 0) return;
    inst.mag += add;
    if (from && inst === this.active) {
      this.vm.getMuzzleWorld(_muz);
      this.ctx.fx.blade.recall(from, _muz, add, bladeColor(inst, getWeaponDef(inst.defId)));
    }
    this.ctx.audio.play('blade_recall', { volume: 0.35, pitch: 1.5 });
  }

  /** 武器技能释放时打断：换弹（召回作废）、连段、点射 / 光束 / 蓄力、开火与变形缓冲（进行中的变形照常完成） */
  private interruptForSkill(): void {
    if (this.reloading) this.cancelReload();
    this.finishVolley();
    this.burstLeft = 0;
    this.beamOn = false;
    this.resetCharge();
    this.swingIdx = -1;
    this.swingHit = false;
    this.swingStrike = false;
    // 进行中的软突进由技能的硬突进覆盖
    this.swingLunge = false;
    this.lastSwingHit = false;
    this.comboIndex = 0;
    this.comboIdle = 0;
    this.fireBuffer = 0;
    this.morphBuffer = 0;
    this.autoReload = 0;
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
      this.beamOn = false;
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

  /** 作废进行中的蓄力（不开火） */
  private resetCharge(): void {
    this.charging = false;
    this.charge = 0;
    this.chargeFull = false;
  }

  /**
   * 蓄力：按住蓄力（射速加成同时加快蓄力），松开发射；伤害倍率 = min + (1 − min) × t²。
   * 满蓄额外穿透并引爆命中目标的元素状态。蓄力中被换弹 / 切枪 / 打空 / 暂停或弹窗（stateChanged）打断时作废，不开火。
   */
  private updateCharge(dt: number, fireDown: boolean, inputOk: boolean, can: boolean, inst: WeaponInstance, R: ResolvedWeapon, infinite: boolean, rate: number, rateMult: number): void {
    const ctx = this.ctx;
    const def = R.def;
    if (fireDown && can) {
      if (!this.charging) {
        this.charging = true;
        this.charge = 0;
        this.chargeFull = false;
        ctx.audio.play('weapon_switch', { volume: 0.4, pitch: 0.6 });
      }
      this.charge = Math.min(1, this.charge + (dt * rateMult) / Math.max(0.05, def.chargeTime));
      if (this.charge >= 1 && !this.chargeFull) {
        this.chargeFull = true;
        ctx.audio.play('telegraph', { volume: 0.35, pitch: 1.6 });
      }
    } else if (this.charging) {
      if (!fireDown && can && inputOk) {
        const t = this.charge;
        const shot = this.chargeShot;
        shot.mult = def.chargeMinMult + (1 - def.chargeMinMult) * t * t;
        shot.pierceBonus = t >= 1 ? def.chargeFullPierce : 0;
        shot.full = t >= 1;
        shot.strength = 0.4 + 0.6 * t;
        this.fireBuffer = 0;
        this.shoot(inst, R, infinite, shot);
        this.cooldown = 1 / rate;
      }
      // 松手发射，或被换弹 / 切枪打断
      this.resetCharge();
    }
    // 线圈转速（第一人称）：蓄力中等于蓄力进度，松手后约 0.6 秒转停
    this.spin = this.charging ? this.charge : Math.max(0, this.spin - dt / 0.6);
  }

  /** 蜂群：一轮齐射的弹体按间隔依次发射（魔刀千刃：固定扇形，同帧射出） */
  private updateVolley(dt: number, inst: WeaponInstance, R: ResolvedWeapon): void {
    const p = R.def.projectile;
    if (!p) {
      this.volleyLeft = 0;
      return;
    }
    this.volleyTimer -= dt;
    while (this.volleyLeft > 0 && this.volleyTimer <= 0) {
      const first = this.fireVolleyProjectile(inst, R, p);
      // 固定扇形一轮只有一次后坐 / 音效 / 第一人称后坐
      if (!p.fanFixed || first) this.feedback(inst, R, 1);
      this.volleyLeft--;
      this.volleyTimer += p.stagger;
    }
  }

  /**
   * 齐射中的一枚弹体（不减 volleyLeft）；返回是否为本轮第一枚。
   * 固定扇形：按整轮 count 的槽位间距、以准星为中心排布——第 i 枚（本轮实际 n 枚）偏航 fan × (2i − (n − 1)) / (count − 1)：
   * 3 枚 = −fan / 0 / +fan，余量只剩 2 枚时 = ±fan / 2，1 枚 = 0（准星正中始终有刃，不会从小怪两侧擦过）；
   * 第 2 枚起共享第一枚的准星落点
   */
  private fireVolleyProjectile(inst: WeaponInstance, R: ResolvedWeapon, p: ProjectileParams): boolean {
    const n = Math.max(1, this.volleyCount);
    const i = Math.max(0, n - this.volleyLeft);
    if (p.fanFixed) {
      const yaw = (p.fan * (2 * i - (n - 1))) / Math.max(1, p.count - 1);
      this.ballistics.projectile(inst, R, this.spreadNow, this.volleyCrit, this.volleyMult, 0, yaw, i > 0);
    } else {
      this.ballistics.projectile(inst, R, this.spreadNow, this.volleyCrit, this.volleyMult, p.fan);
    }
    return i === 0;
  }

  /** 切枪 / 替换前把剩余的齐射弹体立即打完（弹药已扣） */
  private finishVolley(): void {
    const inst = this.active;
    if (this.volleyLeft <= 0 || !inst) return;
    const R = this.resolve(inst);
    const p = R.def.projectile;
    while (p && this.volleyLeft > 0) {
      this.fireVolleyProjectile(inst, R, p);
      this.volleyLeft--;
    }
    this.volleyLeft = 0;
  }

  /**
   * 一次射击：扣弹、传说特性判定、元素轮转、发射、反馈、事件。
   * 光束每跳、点射每发、蜂群每轮各算一次。shot 为蓄力修饰（其他模式为 NO_SHOT）。
   */
  private shoot(inst: WeaponInstance, R: ResolvedWeapon, infinite: boolean, shot: ShotMods = NO_SHOT): void {
    const ctx = this.ctx;
    const def = R.def;
    const p = def.projectile;
    const magBefore = inst.mag;
    // 按弹体计弹药（魔刀千刃）：一轮实际射出 min(count, 发射前余量) 枚、各耗 1 发；否则每次扣扳机耗 1 发
    const perProjectile = def.perProjectileAmmo && !!p;
    const count = p ? Math.max(1, p.count) : 1;
    const volleyN = perProjectile && !infinite ? Math.max(1, Math.min(count, magBefore)) : count;
    let consumed = false;
    if (!infinite) {
      // 「无尽」免耗时整轮不扣
      const free = R.legendary === 'lg_endless' && this.rand() < R.legendaryValue;
      if (!free) {
        inst.mag = Math.max(0, inst.mag - (perProjectile ? volleyN : 1));
        consumed = true;
      }
    }
    const rt = this.runtime(inst);
    rt.shots++;
    const nth = Math.round(R.legendaryValue);
    const forceCrit = R.legendary === 'lg_nth' && nth > 0 && rt.shots % nth === 0;
    // 「终焉」：最后一发；按弹体计弹药时为「本轮打空弹匣」
    const last = perProjectile ? consumed && inst.mag === 0 : consumed && magBefore === 1;
    let mult = (R.legendary === 'lg_last' && last ? R.legendaryValue : 1) * shot.mult;
    // 换形一击（千刃）：变形后窗口内的第一轮，整轮都吃
    if (def.melee && ctx.time.now < this.strikeUntil) {
      mult *= def.melee.formStrikeMult;
      this.consumeStrike();
    }

    // 元素轮转：本发元素取弹巢当前位置，随后推进一格（换弹归零）
    const cyc = def.cycle;
    let el: Element = inst.element;
    if (cyc && cyc.length > 0) {
      el = cyc[rt.cycleIndex % cyc.length];
      rt.cycleIndex++;
      this.ballistics.elementOverride = el;
    }

    const volley = !!p && p.count > 1;
    if (def.mode === 'beam') {
      this.ballistics.beamTick(inst, R, this.beamHit, forceCrit, mult);
    } else if (volley) {
      this.volleyCount = volleyN;
      this.volleyLeft = volleyN;
      this.volleyTimer = 0;
      this.volleyCrit = forceCrit;
      this.volleyMult = mult;
    } else if (p) {
      this.ballistics.projectile(inst, R, this.spreadNow, forceCrit, mult, 0);
    } else {
      this.ballistics.hitscan(inst, R, this.spreadNow, this.pelletCone(def, R), forceCrit, mult, shot);
    }

    const now = ctx.time.now;
    const gap = 1 / Math.max(0.1, R.fireRate * def.burstCount);
    this.consecutive = now - this.lastShotTime < gap * 1.6 + 0.05 ? this.consecutive + 1 : 0;
    this.lastShotTime = now;
    this.bloom = Math.min(def.spreadMax, this.bloom + def.spreadPerShot);
    if (volley) this.updateVolley(0, inst, R);
    else this.feedback(inst, R, shot.strength, el);
    this.ballistics.elementOverride = null;
    ctx.events.emit('weapon:fired', { weapon: inst });
  }

  /** 后坐、第一人称后坐与火焰、音效、屏震。el 为本发元素（枪口火焰颜色） */
  private feedback(inst: WeaponInstance, R: ResolvedWeapon, strength: number, el: Element = inst.element): void {
    const ctx = this.ctx;
    const def = R.def;
    const rc = def.recoil;
    const climb = 1 + Math.min(this.consecutive, 12) * rc.climb;
    const k = R.recoilMult * (1 - 0.3 * this.aimT) * strength;
    const pitch = rc.pitch * climb * k * (0.85 + Math.random() * 0.3);
    const yaw = (rc.bias + (Math.random() * 2 - 1) * rc.yaw) * k;
    if (pitch !== 0 || yaw !== 0) ctx.player.addRecoil(pitch, yaw);
    this.vm.onShot(def, def.melee ? bladeColor(inst, def) : shotColor(inst, el), strength);
    if (def.mode !== 'beam') ctx.audio.play(def.sfx, { volume: def.sfxVolume, pitch: 0.94 + Math.random() * 0.12 });
    if (def.shake > 0) ctx.fx.shake(def.shake * strength, def.shake > 0.15 ? 0.16 : 0.08);
  }

  // ───────────── 弹药 / 换弹 ─────────────

  /** 空弹：按开火自动换弹；没有备弹时空仓音效。打空后短暂延迟也会自动换弹（召回式不需要备弹；「斩」形态不处理） */
  private handleEmpty(dt: number, inst: WeaponInstance, R: ResolvedWeapon, infinite: boolean, fireDown: boolean, inputOk: boolean, mode: FireMode): void {
    const empty = !infinite && inst.mag <= 0;
    if (mode === 'melee' || !empty || this.reloading || this.switchTimer > 0) {
      this.autoReload = 0;
      return;
    }
    const def = R.def;
    const canReload = def.recall || inst.reserve > 0;
    if (inputOk) {
      // 蓄力武器空匣按半自动处理（按下才换弹，按住不连续触发）
      const holdMode = def.mode === 'auto' || def.mode === 'spinup' || def.mode === 'beam';
      if (this.fireBuffer > 0 || (fireDown && holdMode)) {
        this.fireBuffer = 0;
        if (canReload) {
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
    if (canReload && this.burstLeft === 0 && this.volleyLeft === 0 && this.ctx.player.alive) {
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
    // 召回式（魔刀千刃）永不算空
    const allEmpty = this.slots.every((w) => !w || (w.mag <= 0 && w.reserve <= 0 && !getWeaponDef(w.defId).recall));
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
    const def = R.def;
    // 双形态：「斩」形态不换弹；变形 / 技能突进中不换弹
    if (def.melee && (this.runtime(inst).form === 'melee' || this.morphLeft > 0 || this.skill.dashing)) return false;
    if (inst.mag >= R.magCap || !(def.recall || inst.reserve > 0)) return false;
    this.burstLeft = 0;
    this.beamOn = false;
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
    if (def.recall) {
      // 召回：刃片从眼前 RECALL_FX_DIST 米处飞回枪口
      const player = this.ctx.player;
      player.getAimDirection(_aimDir);
      _from.copy(player.eye).addScaledVector(_aimDir, RECALL_FX_DIST);
      this.vm.getMuzzleWorld(_muz);
      this.ctx.fx.blade.recall(_from, _muz, R.magCap - inst.mag, bladeColor(inst, def));
      this.ctx.audio.play('blade_recall', { volume: 0.8 });
    } else {
      this.ctx.audio.play('reload_start', { volume: 0.8 });
    }
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
      // 召回式：不需要也不消耗备弹
      const need = Math.max(0, R.magCap - inst.mag);
      const take = R.def.recall ? need : Math.min(need, inst.reserve);
      inst.mag += take;
      if (!R.def.recall) inst.reserve -= take;
      this.finishReload(inst, false);
    }
  }

  private finishReload(inst: WeaponInstance, rack: boolean): void {
    this.reloading = false;
    this.shellMode = false;
    // 元素轮转：每次换弹从第一种元素重新开始
    this.runtime(inst).cycleIndex = 0;
    if (rack) this.vm.rack();
    if (getWeaponDef(inst.defId).recall) this.ctx.audio.play('reload_end', { volume: 0.5, pitch: 1.35 });
    else this.ctx.audio.play('reload_end', { volume: 0.85 });
    this.ctx.events.emit('weapon:reloaded', { weapon: inst });
  }

  /** 中断换弹；逐发装填已压入的弹保留，并视为一次（部分）换弹完成 */
  private cancelReload(): void {
    if (!this.reloading) return;
    const inst = this.active;
    const partial = this.shellMode && this.shellsInserted > 0;
    this.reloading = false;
    this.shellMode = false;
    if (partial && inst) {
      this.vm.rack();
      this.ctx.events.emit('weapon:reloaded', { weapon: inst });
    }
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

  /** 连射扩大、停火恢复、移动 / 空中增大、开镜减小；「斩」形态准星张开到 MELEE_HUD_SPREAD */
  private updateSpread(dt: number, def: WeaponDef, R: ResolvedWeapon, mode: FireMode): void {
    const p = this.ctx.player;
    // 停火一小段时间（略长于射击间隔）后才开始恢复，保证连射时散布确实累积
    const delay = clamp(1.25 / Math.max(0.1, R.fireRate * def.burstCount), 0.08, 0.35);
    if (this.ctx.time.now - this.lastShotTime > delay) this.bloom = Math.max(0, this.bloom - def.spreadRecovery * dt);
    const base = lerp(def.spreadHip, def.spreadAim, this.aimT);
    const hs = Math.hypot(p.velocity.x, p.velocity.z);
    const moveF = 1 + clamp01(hs / 7.5) * (0.6 - 0.35 * this.aimT);
    const airF = p.onGround ? 1 : 1.5 - 0.25 * this.aimT;
    this.spreadNow = (base * moveF * airF + this.bloom * (1 - 0.45 * this.aimT)) * R.spreadMult;
    const hud = mode === 'melee' ? MELEE_HUD_SPREAD : clamp(this.spreadNow + this.pelletCone(def, R), 0, 0.25);
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

  /** 持握类词条（轻盈）与「斩」形态移速：只对当前武器生效（切枪 / 变形时整体重算） */
  private applyHeldMods(): void {
    const stats = this.ctx.player.stats;
    stats.removeSource(HELD_SOURCE);
    const inst = this.active;
    if (!inst) return;
    const R = this.resolve(inst);
    if (R.swift > 0) stats.add('moveSpeed', R.swift, HELD_SOURCE);
    const m = R.def.melee;
    if (m && m.moveBonus !== 0 && this.runtime(inst).form === 'melee') stats.add('moveSpeed', m.moveBonus, HELD_SOURCE);
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
    s.firing = this.beamOn || this.minigunFiring || this.charging;
    // 机炮转管 / 蓄力武器线圈（updateCharge 中 spin 跟随蓄力进度，松手后转停）
    s.spin = this.spin;
    // 元素轮转：灵纹显示下一发元素（按当前显示的那把枪）
    const cyc = getWeaponDef(shown.defId).cycle;
    if (cyc && cyc.length > 0) {
      const idx = this.runtime(shown).cycleIndex;
      s.cycleIndex = idx;
      s.elementHint = cyc[idx % cyc.length];
    } else {
      s.cycleIndex = -1;
      s.elementHint = null;
    }
    s.scoped = this.ctx.cameraFx.fovKick < -30;
    s.sinceShot = this.ctx.time.now - this.lastShotTime;
    if (shown !== inst) s.cock = 1;
    else if (this.reloading) s.cock = clamp01((s.reloadP - 0.6) / 0.3);
    else s.cock = infinite || inst.mag > 0 ? clamp01(1 - this.cooldown * rate) : 0;
    this.writeBladeState(shown, inst);
    this.vm.update(dt, s);
  }

  /** 双形态字段（docs/demon-blade.md 10.7.1）：按当前显示的实例 shown 写入；非双形态武器写默认值 */
  private writeBladeState(shown: WeaponInstance, inst: WeaponInstance): void {
    const s = this.vmState;
    const m = getWeaponDef(shown.defId).melee;
    if (!m) {
      s.form = null;
      s.morphT = 1;
      s.swing = -1;
      s.swingP = 0;
      s.swingHitP = 0.25;
      s.blades = 0;
      s.bladesMax = 1;
      s.skillT = -1;
      s.strikeT = 0;
      return;
    }
    const cur = shown === inst;
    s.form = this.runtime(shown).form;
    s.morphT = cur && this.morphLeft > 0 ? clamp01(1 - this.morphLeft / Math.max(0.01, m.morphTime)) : 1;
    const swinging = cur && this.swingIdx >= 0;
    s.swing = swinging ? this.swingIdx : -1;
    // 不在挥砍时给出下一段的判定帧位置（动画可预先对齐）
    const seg = m.combo[swinging ? this.swingIdx : this.comboIndex % Math.max(1, m.combo.length)];
    s.swingP = swinging && seg ? clamp01(this.swingT / Math.max(0.01, seg.duration)) : 0;
    s.swingHitP = seg ? clamp01(seg.windup / Math.max(0.01, seg.duration)) : 0.25;
    s.blades = shown.mag;
    s.bladesMax = this.magCapacity(shown);
    s.skillT = this.skill.dashProgress;
    s.strikeT = cur ? clamp01(this.formStrikeTime / Math.max(0.01, m.formStrikeWindow)) : 0;
  }

  // ───────────── 工具 ─────────────

  private resolve(inst: WeaponInstance): ResolvedWeapon {
    return resolveWeapon(inst, this.ctx.player.stats);
  }

  private runtime(inst: WeaponInstance): WeaponRuntime {
    let rt = this.runtimes.get(inst);
    if (!rt) {
      rt = { shots: 0, frenzy: 0, frenzyTime: -99, lastHeadBlast: -99, readyAt: -99, cycleIndex: 0, rxnHasteUntil: -99, form: 'melee' };
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
