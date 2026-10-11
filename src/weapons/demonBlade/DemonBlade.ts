/**
 * 魔刀千刃 v2 的玩法控制器（docs/demon-blade-v2.md 第 2–8 节）。
 *
 * 碎刃去向（mode）：hand 在手里（左键三段斩）/ swarm 千刃出窍（右键按住，刃群追着准星绞杀）/
 * shield 碎刃屏障（R 按住，身前圆盾挡弹）/ burst 杀气爆发（V：碎片聚于一点后炸开）。
 * 右键与 R 共用刃气；斩中回复刃气。杀意满时 V 变为人刀合一（强化爆发 + 8 秒强化）。用魔刀击杀时刀根鬼眼睁开吸魂回血。
 *
 * WeaponSystem 在当前武器是魔刀时每帧调用 update()，切走 / 死亡 / 换关时调用 stow()；冷却与杀意在 tick() 里推进（不论当前武器）。
 * 所有伤害 source 为 'weapon'，带本武器的伤害倍率、元素、暴击与 weaponUid，因此正常触发词条、秘卷与元素反应。
 */
import * as THREE from 'three';
import type {
  BladeHudState, BladeMode, DamageRequest, GameContext, IEnemy, ProjectileWard, WeaponInstance, WeaponSkillState,
} from '../../core/types';
import { clamp01 } from '../../core/math';
import type { BladeSlash, DemonBladeParams } from '../WeaponDefs';
import type { ResolvedWeapon } from '../WeaponStats';
import { BLADE_PURPLE } from './BladeModel';
import { BladeEffects } from './BladeEffects';
import { BladeSwarm } from './BladeSwarm';
import { createBladePoseInput, type BladeView } from './BladeView';

/** 准星「攻击距离内」检测间隔（帧） */
const IN_RANGE_EVERY = 3;
/** 贴身（胶囊表面距离 ≤ 此值）时不判扇形角度，只排除正后方 */
const MELEE_CLOSE = 0.35;
/** 每段最多播几处命中特效 */
const MAX_HIT_FX = 6;
/** 斩击输入缓冲 */
const SLASH_BUFFER = 0.35;
/** 碎片在外时按下左键：先收刃，这么久之内碎片回得差不多就接上斩击 */
const RECALL_SLASH_WINDOW = 1;
/** 还有不超过这么多片在飞回（刀尖附近最后回）时就可以出刀 */
const SLASH_READY_AWAY = 14;
/** 碎片到齐多少比例后开始绞杀 / 挡弹 */
const FORMED_TO_ACT = 0.35;
/** 刃群中心离墙面的距离 */
const WALL_PULLBACK = 0.6;
/** 杀气爆发：炸散后多久开始归刀 */
const SCATTER_TIME = 0.24;
/** 斩波飞行时长 */
const WAVE_TIME = 0.42;
/** 移速基准（Stats 默认 moveSpeed 7.5），人刀合一 / 屏障按比例加减 */
const BASE_MOVE = 7.5;
const SRC_SHIELD = 'weapon:bladeShield';
const SRC_UNION = 'weapon:bladeUnion';
const SWING_PITCH = [1.08, 0.96, 0.78];

const SLASH_TAGS = ['slash'];
const SWARM_TAGS = ['swarm'];
const BURST_TAGS = ['bladeBurst'];
const WAVE_TAGS = ['slash', 'bladeWave'];

const _f = new THREE.Vector3();
const _c = new THREE.Vector3();
const _h = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

/** WeaponSystem 提供的接口 */
export interface BladeHost {
  resolve(inst: WeaponInstance): ResolvedWeapon;
  /** 「天命」等传说计数（每段斩击算一次射击） */
  countShot(inst: WeaponInstance): number;
  /** 当前显示的第一人称魔刀（没有时为 null） */
  view(): BladeView | null;
}

/** 本帧输入（WeaponSystem 已按 inputOk / 切枪等条件过滤） */
export interface BladeInput {
  fireDown: boolean;
  firePressed: boolean;
  aimDown: boolean;
  shieldDown: boolean;
  skillPressed: boolean;
  /** 切枪 / 死亡等不能出招 */
  ready: boolean;
  /** 攻速倍率（射速词条 × 狂热 × 疾化） */
  speed: number;
}

export class DemonBlade {
  readonly swarm: BladeSwarm;
  readonly effects: BladeEffects;
  readonly pose = createBladePoseInput();
  readonly hud: BladeHudState = { mode: 'hand', qi: 1, intent: 0, union: 0, inRange: false };
  private readonly skill: WeaponSkillState = {
    id: 'demon_burst', name: '杀气爆发', glyph: '爆', key: 'V', description: '', cooldownRemaining: 0, cooldownTotal: 15, active: false, charge: 0,
  };
  private readonly ward: ProjectileWard;
  private inst: WeaponInstance | null = null;
  private P: DemonBladeParams | null = null;

  mode: BladeMode = 'hand';
  private qi = 100;
  private qiDelay = 0;
  private intent = 0;
  private intentIdle = 0;
  private unionLeft = 0;
  private burstCd = 0;
  private eyeLeft = 0;
  // 斩
  private comboIndex = 0;
  private swingIdx = -1;
  private swingT = 0;
  private swingHit = false;
  private comboIdle = 0;
  private slashBuffer = 0;
  /** 收刃接斩：碎片在外时按下左键，归刀后自动出第一段 */
  private pendingSlash = 0;
  private readonly hits: IEnemy[] = [];
  private rangeFrame = 0;
  // 千刃出窍
  private tickAcc = 0;
  private readonly target = new THREE.Vector3();
  private swarmSfx = 0;
  // 杀气爆发
  private burstPhase: 'none' | 'gather' | 'scatter' | 'return' = 'none';
  private burstT = 0;
  private burstUnion = false;
  private readonly burstPoint = new THREE.Vector3();
  // 斩波（人刀合一）：每道记录槽位与已命中的敌人
  private readonly waves: { slot: number; base: number; hit: Set<IEnemy>; origin: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  private shieldOn = false;
  private unionOn = false;

  constructor(private readonly ctx: GameContext, private readonly host: BladeHost) {
    this.swarm = new BladeSwarm(ctx);
    this.effects = new BladeEffects(ctx);
    this.ward = {
      center: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 0, 1),
      radius: 0.85,
      onBlock: (point) => this.onBlock(point),
    };
  }

  init(): void {
    this.swarm.init();
    this.effects.init();
    this.ctx.events.on('enemy:killed', ({ enemy, result }) => {
      const inst = this.inst;
      if (!inst || !this.P || result.request.weaponUid !== inst.uid || result.request.tags?.includes('purge')) return;
      this.devour(enemy);
    });
  }

  // ───────────── 只读状态 ─────────────

  get active(): boolean {
    return this.inst !== null;
  }

  skillState(): WeaponSkillState {
    const s = this.skill;
    const P = this.P;
    const full = P !== null && this.intent >= P.intent.max;
    s.id = full ? 'demon_union' : 'demon_burst';
    s.name = full ? '人刀合一' : '杀气爆发';
    s.glyph = full ? '合' : '爆';
    s.description = full
      ? '强化杀气爆发后进入 8 秒人刀合一：斩击放出碎刃斩波，千刃出窍不耗刃气，刃群更大，移速提升。'
      : '碎片聚于准星落点压缩成刃球后炸开，范围内敌人受到重创并被击退。杀意满时变为人刀合一。';
    s.cooldownRemaining = full ? 0 : Math.max(0, this.burstCd);
    s.cooldownTotal = this.cooldownTotal();
    s.active = this.burstPhase !== 'none' || this.unionLeft > 0;
    s.charge = P ? clamp01(this.intent / P.intent.max) : 0;
    return s;
  }

  private cooldownTotal(): number {
    const base = this.P?.burst.cooldown ?? 15;
    return Math.max(0.1, base / Math.max(0.2, 1 + this.ctx.player.stats.get('skillHaste')));
  }

  // ───────────── 生命周期 ─────────────

  /** 每帧（不论当前武器）：冷却、杀意衰减、人刀合一计时、特效收尾 */
  tick(dt: number): void {
    if (this.burstCd > 0) this.burstCd = Math.max(0, this.burstCd - dt);
    if (this.unionLeft > 0) {
      this.unionLeft = Math.max(0, this.unionLeft - dt);
      if (this.unionLeft <= 0) this.setUnion(false);
    }
    const P = this.P;
    if (P && this.unionLeft <= 0) {
      this.intentIdle += dt;
      if (this.intentIdle > P.intent.decayDelay) this.intent = Math.max(0, this.intent - P.intent.decay * dt);
    }
    if (this.eyeLeft > 0) this.eyeLeft = Math.max(0, this.eyeLeft - dt);
    if (!this.inst) {
      this.effects.update(dt, () => null);
    }
  }

  /** 新开一局：冷却、杀意、刃气全部重置 */
  resetForRun(): void {
    this.stow();
    this.burstCd = 0;
    this.intent = 0;
    this.qi = 100;
    this.unionLeft = 0;
  }

  /** 收刀（切走 / 死亡 / 换关）：碎片瞬间归刀，屏障与人刀合一结束；冷却与杀意保留 */
  stow(): void {
    this.swarm.snapHome();
    this.effects.clear();
    this.setShield(false);
    this.setUnion(false);
    this.unionLeft = 0;
    this.mode = 'hand';
    this.burstPhase = 'none';
    this.swingIdx = -1;
    this.comboIndex = 0;
    this.comboIdle = 0;
    this.slashBuffer = 0;
    this.pendingSlash = 0;
    this.waves.length = 0;
    this.inst = null;
    this.hud.inRange = false;
    this.swarm.setProvider(null);
  }

  // ───────────── 每帧（当前武器是魔刀） ─────────────

  update(dt: number, inst: WeaponInstance, R: ResolvedWeapon, inp: BladeInput): void {
    const ctx = this.ctx;
    const P = R.def.blade;
    if (!P) return;
    if (this.inst !== inst) {
      if (this.inst) this.stow();
      this.inst = inst;
    }
    this.P = P;
    const view = this.host.view();
    this.swarm.setProvider(view);
    view?.setSwarm(this.swarm);
    if (inp.firePressed) this.slashBuffer = SLASH_BUFFER;
    else this.slashBuffer = Math.max(0, this.slashBuffer - dt);
    if (inp.firePressed && this.mode !== 'hand' && this.burstPhase === 'none') this.pendingSlash = RECALL_SLASH_WINDOW;
    else this.pendingSlash = Math.max(0, this.pendingSlash - dt);

    // 刃气回复：碎片全在手里、停用一会儿之后
    if (this.mode === 'hand' && this.swarm.allHome()) {
      if (this.qiDelay > 0) this.qiDelay -= dt;
      else this.qi = Math.min(P.qi.max, this.qi + P.qi.regen * dt);
    } else {
      this.qiDelay = P.qi.regenDelay;
    }

    if (this.burstPhase !== 'none') {
      this.updateBurst(dt, inst, R, P);
    } else {
      const canAct = inp.ready && this.swingIdx < 0;
      const full = this.intent >= P.intent.max;
      if (inp.skillPressed && inp.ready && (full || this.burstCd <= 0)) {
        this.startBurst(inst, P, full);
      } else {
        // 左键：碎片在外时先收刃（排队斩击）
        const wantSlash = this.slashBuffer > 0 || this.pendingSlash > 0 || inp.fireDown;
        const wantSwarm = !wantSlash && inp.aimDown && canAct && this.qi > 0;
        const wantShield = !wantSlash && !wantSwarm && inp.shieldDown && canAct && this.qi > 0;
        if (wantSwarm && this.mode !== 'swarm') this.startSwarm(P);
        else if (wantShield && this.mode !== 'shield') this.startShield(P);
        else if (!wantSwarm && !wantShield && (this.mode === 'swarm' || this.mode === 'shield')) this.release(wantSlash);
      }
    }

    this.updateSlash(dt, inst, R, P, inp);
    if (this.mode === 'swarm') this.updateSwarm(dt, inst, R, P);
    if (this.mode === 'shield') this.updateShield(dt, P);
    this.updateWaves(inst, R, P);
    this.updateInRange(P);

    this.swarm.boost = this.unionLeft > 0 ? 0.6 : 0;
    this.swarm.update(dt, ctx.time.now);
    this.effects.update(dt, (out) => (view ? view.rootWorld(out) : null));
    // 刃群绞杀的持续刃鸣
    if (this.mode === 'swarm' && this.swarm.formedFraction() > FORMED_TO_ACT) {
      this.swarmSfx -= dt;
      if (this.swarmSfx <= 0) {
        this.swarmSfx = 0.11;
        ctx.audio.play('blade_swarm');
      }
    }
    this.writePose(P);
    this.writeHud(P);
  }

  // ───────────── 斩 ─────────────

  private updateSlash(dt: number, inst: WeaponInstance, R: ResolvedWeapon, P: DemonBladeParams, inp: BladeInput): void {
    const combo = P.combo;
    if (this.swingIdx < 0) {
      this.comboIdle += dt;
      if (this.comboIdle > P.comboReset) this.comboIndex = 0;
      const can = inp.ready && this.mode === 'hand' && this.burstPhase === 'none' && this.swarm.awayCount() <= SLASH_READY_AWAY;
      if (!can || !(inp.fireDown || this.slashBuffer > 0 || this.pendingSlash > 0)) return;
      this.startSwing(this.comboIndex % combo.length, 0);
    }
    this.swingT += dt * Math.max(0.2, inp.speed);
    for (let guard = 0; this.swingIdx >= 0 && guard < 3; guard++) {
      const idx = this.swingIdx;
      const seg = combo[idx];
      if (!this.swingHit && this.swingT >= seg.windup) {
        this.swingHit = true;
        this.resolveSlash(inst, R, P, seg, idx);
      }
      if (this.swingT < seg.duration) break;
      const over = this.swingT - seg.duration;
      this.comboIndex = (idx + 1) % combo.length;
      this.swingIdx = -1;
      this.comboIdle = 0;
      if (inp.ready && this.mode === 'hand' && (inp.fireDown || this.slashBuffer > 0)) this.startSwing(this.comboIndex, over);
    }
  }

  private startSwing(idx: number, t0: number): void {
    this.swingIdx = idx;
    this.swingT = t0;
    this.swingHit = false;
    this.slashBuffer = 0;
    this.pendingSlash = 0;
    this.host.view()?.onSlash();
    this.ctx.audio.play('blade_swing', { volume: 0.75, pitch: SWING_PITCH[idx] ?? 1 });
  }

  /** 判定帧：扇形内所有可见敌人各命中一次 */
  private resolveSlash(inst: WeaponInstance, R: ResolvedWeapon, P: DemonBladeParams, seg: BladeSlash, idx: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    const shots = this.host.countShot(inst);
    const nth = Math.round(R.legendaryValue);
    const nthCrit = R.legendary === 'lg_nth' && nth > 0 && shots % nth === 0;
    const heavy = idx === P.combo.length - 1;
    const range = seg.range * (this.unionLeft > 0 ? 1.15 : 1);
    const list = this.sector(range, seg.halfAngle, P, this.hits);
    const pp = player.position;
    let hitCount = 0;
    let fx = 0;
    for (const e of list) {
      if (!e.alive) continue;
      let hx = e.position.x - pp.x, hz = e.position.z - pp.z;
      const d = Math.hypot(hx, hz);
      if (d > 1e-4) {
        hx /= d;
        hz /= d;
      } else {
        player.getForward(_f);
        hx = _f.x;
        hz = _f.z;
      }
      e.getBodyCenter(_c);
      const point = new THREE.Vector3(_c.x - hx * e.radius * 0.8, _c.y, _c.z - hz * e.radius * 0.8);
      const direction = new THREE.Vector3(hx, 0.2, hz).normalize();
      const crit = nthCrit || (R.critChance > 0 && Math.random() < R.critChance);
      const req: DamageRequest = {
        base: seg.damage * R.damageMult, element: inst.element, source: 'weapon', elementChance: R.elementChance,
        critMult: R.critMult, weaponUid: inst.uid, point, direction, knockback: seg.knockback, procDepth: 0, tags: SLASH_TAGS,
      };
      if (crit) req.forceCrit = true;
      if (!ctx.combat.damageEnemy(e, req)) continue;
      hitCount++;
      if (fx++ < MAX_HIT_FX) {
        ctx.fx.enemyHit(point, BLADE_PURPLE, crit);
        ctx.fx.burst(point, 0xd8c2ff, heavy ? 12 : 6, heavy ? 7 : 5, 0.25, 0.06, 4);
      }
    }
    list.length = 0;
    if (hitCount > 0) {
      this.qi = Math.min(P.qi.max, this.qi + P.qi.perSlashHit * hitCount);
      this.gainIntent(P.intent.slashHit * hitCount, P);
      this.host.view()?.onHit(heavy);
      ctx.audio.play('blade_hit', { volume: heavy ? 1 : 0.7, pitch: heavy ? 0.85 : 1 });
      ctx.fx.shake(seg.shake, 0.13);
      player.cameraPunch(idx === 1 ? 0.45 : -0.45, heavy ? -0.6 : 0.15);
    }
    // 人刀合一：每段放出一道碎刃斩波
    if (this.unionLeft > 0) this.launchWave(seg.damage * R.damageMult * P.union.waveFrac, idx, P);
    ctx.events.emit('weapon:fired', { weapon: inst });
  }

  /**
   * 扇形判定：玩家前方水平扇形（距离按胶囊表面、角度按角半径放宽）+ 高度带 + 视线。out 先清空再写入命中的敌人。
   */
  private sector(range: number, halfAngle: number, P: DemonBladeParams, out: IEnemy[]): IEnemy[] {
    out.length = 0;
    const ctx = this.ctx;
    const player = ctx.player;
    const p = player.position;
    const f = player.getForward(_f);
    const yLo = p.y - P.reachBelow;
    const yHi = p.y + player.height + P.reachAbove;
    for (const e of ctx.enemies.list) {
      if (!e.alive || e.untargetable) continue;
      const dx = e.position.x - p.x, dz = e.position.z - p.z;
      const dist = Math.hypot(dx, dz);
      const surface = dist - e.radius;
      if (surface > range) continue;
      if (e.position.y > yHi || e.position.y + e.height < yLo) continue;
      if (surface > MELEE_CLOSE && dist > 1e-4) {
        const cos = (dx * f.x + dz * f.z) / dist;
        const allow = halfAngle + Math.asin(Math.min(1, e.radius / dist));
        if (cos < Math.cos(Math.min(Math.PI, allow))) continue;
      } else if (dist > 1e-4 && (dx * f.x + dz * f.z) / dist < -0.3) {
        continue;
      }
      if (ctx.world.segmentBlocked(player.eye, e.getBodyCenter(_c)) && ctx.world.segmentBlocked(player.eye, e.getHeadCenter(_h))) continue;
      out.push(e);
    }
    return out;
  }

  private updateInRange(P: DemonBladeParams): void {
    if (this.mode !== 'hand' || !this.ctx.player.alive) {
      this.hud.inRange = false;
      return;
    }
    if (++this.rangeFrame % IN_RANGE_EVERY !== 0) return;
    const seg = P.combo[(this.swingIdx >= 0 ? this.swingIdx : this.comboIndex) % P.combo.length];
    this.hud.inRange = this.sector(seg.range, seg.halfAngle, P, this.hits).length > 0;
    this.hits.length = 0;
  }

  // ───────────── 千刃出窍 ─────────────

  private startSwarm(P: DemonBladeParams): void {
    this.setShield(false);
    this.mode = 'swarm';
    this.aimPoint(P.swarm.range, this.target);
    this.swarm.center.copy(this.target);
    this.swarm.radius = this.swarmRadius(P) * 0.7;
    this.swarm.launch('vortex');
    this.tickAcc = 0;
    this.ctx.audio.play('blade_throw', { volume: 0.85 });
  }

  private swarmRadius(P: DemonBladeParams): number {
    return P.swarm.radius * (this.unionLeft > 0 ? P.union.swarmRadiusMult : 1);
  }

  /** 准星落点：敌人（身体中心）> 墙面（拉回一点）> 最远射程 */
  private aimPoint(range: number, out: THREE.Vector3): THREE.Vector3 {
    const ctx = this.ctx;
    const eye = ctx.player.eye;
    const dir = ctx.player.getAimDirection(_aim);
    const wall = ctx.world.raycast(eye, dir, range);
    const maxD = wall ? wall.distance : range;
    const hit = ctx.enemies.raycast(eye, dir, maxD);
    if (hit) return hit.enemy.getBodyCenter(out);
    return out.copy(eye).addScaledVector(dir, Math.max(1.5, maxD - (wall ? WALL_PULLBACK : 0)));
  }

  private updateSwarm(dt: number, inst: WeaponInstance, R: ResolvedWeapon, P: DemonBladeParams): void {
    const ctx = this.ctx;
    const union = this.unionLeft > 0;
    // 刃气
    if (!union) this.qi = Math.max(0, this.qi - P.swarm.drain * dt);
    if (this.qi <= 0) {
      this.release(false);
      return;
    }
    // 刃群中心追着准星落点（有拖拽感）
    this.aimPoint(P.swarm.range, this.target);
    const c = this.swarm.center;
    _d.subVectors(this.target, c);
    const dist = _d.length();
    const step = P.swarm.follow * (union ? 1.4 : 1) * dt;
    if (dist > step) c.addScaledVector(_d, step / dist);
    else c.copy(this.target);
    const radius = this.swarmRadius(P);
    this.swarm.radius += (radius * 0.72 - this.swarm.radius) * Math.min(1, dt * 6);
    this.swarm.hitRadius = radius;
    if (this.swarm.formedFraction() < FORMED_TO_ACT) return;
    // 绞杀：每 tick 秒结算一次，半径内最多 maxTargets 个敌人
    this.tickAcc += dt;
    let n = 0;
    while (this.tickAcc >= P.swarm.tick && n++ < 3) {
      this.tickAcc -= P.swarm.tick;
      this.swarmTick(inst, R, P, radius);
    }
  }

  private swarmTick(inst: WeaponInstance, R: ResolvedWeapon, P: DemonBladeParams, radius: number): void {
    const ctx = this.ctx;
    const list = ctx.enemies.queryRadius(this.swarm.center, radius, this.hits);
    const c = this.swarm.center;
    list.sort((a, b) => a.position.distanceToSquared(c) - b.position.distanceToSquared(c));
    let hits = 0;
    for (let i = 0; i < list.length && hits < P.swarm.maxTargets; i++) {
      const e = list[i];
      if (!e.alive) continue;
      e.getBodyCenter(_c);
      const point = new THREE.Vector3(_c.x + (Math.random() - 0.5) * e.radius, _c.y + (Math.random() - 0.3) * e.height * 0.4, _c.z + (Math.random() - 0.5) * e.radius);
      const direction = new THREE.Vector3(Math.random() - 0.5, 0.1, Math.random() - 0.5).normalize();
      const req: DamageRequest = {
        base: P.swarm.damage * R.damageMult, element: inst.element, source: 'weapon',
        elementChance: R.elementChance * P.swarm.elementScale, critMult: R.critMult, weaponUid: inst.uid,
        point, direction, knockback: 0, procDepth: 0, tags: SWARM_TAGS, bypassShield: true,
      };
      if (R.critChance > 0 && Math.random() < R.critChance) req.forceCrit = true;
      if (!ctx.combat.damageEnemy(e, req)) continue;
      hits++;
      if (Math.random() < 0.35) ctx.fx.burst(point, 0xd8c2ff, 3, 4, 0.18, 0.05, 2);
    }
    list.length = 0;
    if (hits > 0 && this.P) this.gainIntent(this.P.intent.swarmHit * hits, this.P);
  }

  /** 收刃：刃群 / 屏障归刀；slash = 左键触发的收刃（加快归刀） */
  private release(slash: boolean): void {
    if (this.mode === 'hand') return;
    this.setShield(false);
    this.mode = 'hand';
    this.swarm.recall(slash ? 0.4 : 1);
    this.ctx.audio.play('blade_recall', { volume: 0.7, pitch: slash ? 1.2 : 1 });
  }

  // ───────────── 碎刃屏障 ─────────────

  private startShield(P: DemonBladeParams): void {
    this.mode = 'shield';
    this.frameShield(P);
    this.swarm.launch('shield');
    this.setShield(true);
    this.ctx.audio.play('blade_morph', { volume: 0.8 });
  }

  private frameShield(P: DemonBladeParams): void {
    const player = this.ctx.player;
    const dir = player.getAimDirection(_aim);
    _right.set(-dir.z, 0, dir.x);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
    _up.crossVectors(_right, dir).normalize();
    const sw = this.swarm;
    sw.shieldCenter.copy(player.eye).addScaledVector(dir, P.shield.distance).addScaledVector(_up, -0.12);
    sw.shieldNormal.copy(dir);
    sw.shieldRight.copy(_right);
    sw.shieldUp.copy(_up);
    sw.shieldRadius = P.shield.radius;
    this.ward.center.copy(sw.shieldCenter);
    this.ward.normal.copy(dir);
    this.ward.radius = P.shield.radius * 1.1;
  }

  private updateShield(dt: number, P: DemonBladeParams): void {
    this.qi = Math.max(0, this.qi - P.shield.drain * dt);
    if (this.qi <= 0) {
      this.release(false);
      return;
    }
    this.frameShield(P);
    // 碎片到齐后才挡弹
    const ready = this.swarm.formedFraction() >= FORMED_TO_ACT;
    this.ctx.projectiles.setWard(ready ? this.ward : null);
  }

  private setShield(on: boolean): void {
    const stats = this.ctx.player.stats;
    if (on === this.shieldOn) {
      if (!on) this.ctx.projectiles.setWard(null);
      return;
    }
    this.shieldOn = on;
    if (on) {
      const P = this.P;
      stats.add('damageReduction', P?.shield.reduction ?? 0.3, SRC_SHIELD);
      stats.add('moveSpeed', -BASE_MOVE * (P?.shield.moveSlow ?? 0.2), SRC_SHIELD);
    } else {
      stats.removeSource(SRC_SHIELD);
      this.ctx.projectiles.setWard(null);
    }
  }

  private onBlock(point: THREE.Vector3): void {
    const P = this.P;
    if (!P) return;
    this.qi = Math.max(0, this.qi - P.shield.perBlock);
    this.gainIntent(P.intent.block, P);
    this.swarm.flashShield(point);
    this.ctx.fx.burst(point, 0xd8c2ff, 10, 5, 0.25, 0.05, 2);
    this.ctx.audio.play('blade_hit', { volume: 0.55, pitch: 1.4 });
  }

  // ───────────── 杀气爆发 / 人刀合一 ─────────────

  private startBurst(inst: WeaponInstance, P: DemonBladeParams, union: boolean): void {
    this.setShield(false);
    this.swingIdx = -1;
    this.mode = 'burst';
    this.burstPhase = 'gather';
    this.burstT = 0;
    this.burstUnion = union;
    this.aimPoint(P.burst.range, this.burstPoint);
    this.swarm.center.copy(this.burstPoint);
    this.swarm.ballCompress = 0;
    this.swarm.launch('ball');
    if (union) this.intent = 0;
    this.burstCd = this.cooldownTotal();
    this.ctx.audio.play('blade_dash', { volume: 0.9 });
    this.ctx.events.emit('weapon:skillUsed', { weapon: inst, skillId: union ? 'demon_union' : 'demon_burst' });
  }

  private updateBurst(dt: number, inst: WeaponInstance, R: ResolvedWeapon, P: DemonBladeParams): void {
    this.burstT += dt;
    if (this.burstPhase === 'gather') {
      const k = clamp01(this.burstT / P.burst.gather);
      this.swarm.ballCompress = k * k;
      if (this.burstT >= P.burst.gather) {
        this.explode(inst, R, P);
        this.burstPhase = 'scatter';
        this.burstT = 0;
      }
    } else if (this.burstPhase === 'scatter') {
      if (this.burstT >= SCATTER_TIME) {
        this.swarm.recall(0.6);
        this.burstPhase = 'return';
        this.burstT = 0;
      }
    } else if (this.swarm.allHome() || this.burstT > 1.5) {
      this.burstPhase = 'none';
      this.mode = 'hand';
    }
  }

  private explode(inst: WeaponInstance, R: ResolvedWeapon, P: DemonBladeParams): void {
    const ctx = this.ctx;
    const B = this.burstPoint;
    const union = this.burstUnion;
    const radius = union ? P.union.burstRadius : P.burst.radius;
    const base = P.burst.damage * R.damageMult * (union ? P.union.burstMult : 1);
    this.swarm.scatter();
    ctx.fx.explosion(B, radius, BLADE_PURPLE);
    ctx.fx.ring(B, radius, 0xd2b4ff, 0.45);
    ctx.fx.shake(union ? 0.6 : 0.4, 0.3);
    ctx.audio.play('blade_impale', { volume: 1 });
    for (const e of ctx.enemies.queryRadius(B, radius, this.hits)) {
      if (!e.alive) continue;
      e.getBodyCenter(_c);
      if (ctx.world.segmentBlocked(B, _c)) continue;
      const dir = new THREE.Vector3().subVectors(_c, B).setY(0);
      if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
      dir.normalize().setY(0.35).normalize();
      const req: DamageRequest = {
        base, element: inst.element, source: 'weapon', elementChance: R.elementChance, critMult: R.critMult,
        weaponUid: inst.uid, point: _c.clone(), direction: dir, knockback: P.burst.knockback, procDepth: 0, tags: BURST_TAGS,
      };
      if (R.critChance > 0 && Math.random() < R.critChance) req.forceCrit = true;
      ctx.combat.damageEnemy(e, req);
    }
    this.hits.length = 0;
    if (union) this.setUnion(true);
  }

  private setUnion(on: boolean): void {
    if (on === this.unionOn) return;
    this.unionOn = on;
    const stats = this.ctx.player.stats;
    stats.removeSource(SRC_UNION);
    if (on) {
      const P = this.P;
      this.unionLeft = P?.union.duration ?? 8;
      stats.add('moveSpeed', BASE_MOVE * (P?.union.moveSpeed ?? 0.15), SRC_UNION);
      this.ctx.audio.play('skill_buff', { volume: 0.8, pitch: 0.7 });
    }
  }

  /** 斩波：沿视线水平方向飞出，路径上的敌人各受一次伤害 */
  private launchWave(base: number, idx: number, P: DemonBladeParams): void {
    const ctx = this.ctx;
    const dir = ctx.player.getAimDirection(new THREE.Vector3());
    dir.y *= 0.35;
    dir.normalize();
    const origin = ctx.player.eye.clone().addScaledVector(dir, 0.4);
    const wall = ctx.world.raycast(origin, dir, P.union.waveRange);
    const range = wall ? Math.max(1, wall.distance) : P.union.waveRange;
    const roll = idx === 0 ? 0.6 : idx === 1 ? -0.4 : 0;
    const slot = this.effects.wave(origin, dir, roll, range, WAVE_TIME);
    this.waves.push({ slot, base, hit: new Set(), origin, dir });
  }

  private updateWaves(inst: WeaponInstance, R: ResolvedWeapon, P: DemonBladeParams): void {
    const ctx = this.ctx;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      const front = this.effects.waveFront(w.slot);
      if (front < 0) {
        this.waves.splice(i, 1);
        continue;
      }
      for (const e of ctx.enemies.list) {
        if (!e.alive || e.untargetable || w.hit.has(e)) continue;
        e.getBodyCenter(_c);
        _p.subVectors(_c, w.origin);
        const along = _p.dot(w.dir);
        if (along < 0 || along > front + 0.4) continue;
        const lateral = _p.addScaledVector(w.dir, -along).length();
        if (lateral > 1.4 + 1.6 * (front / Math.max(1, P.union.waveRange)) + e.radius) continue;
        w.hit.add(e);
        const req: DamageRequest = {
          base: w.base, element: inst.element, source: 'weapon', elementChance: R.elementChance, critMult: R.critMult,
          weaponUid: inst.uid, point: _c.clone(), direction: w.dir.clone(), knockback: 2, procDepth: 0, tags: WAVE_TAGS,
        };
        ctx.combat.damageEnemy(e, req);
        ctx.fx.enemyHit(req.point!, BLADE_PURPLE, false);
      }
    }
  }

  // ───────────── 噬灵鬼眼 / 杀意 ─────────────

  private devour(enemy: IEnemy): void {
    const P = this.P!;
    const player = this.ctx.player;
    const frac = enemy.isBoss ? P.eye.healBoss : enemy.isElite ? P.eye.healElite : P.eye.heal;
    player.heal(player.maxHp() * frac);
    this.eyeLeft = P.eye.open;
    this.gainIntent(P.intent.kill, P);
    this.effects.wisp(enemy.getBodyCenter(_c));
    this.ctx.audio.play('blade_eye', { volume: enemy.isBoss || enemy.isElite ? 1 : 0.7 });
  }

  private gainIntent(v: number, P: DemonBladeParams): void {
    if (this.unionLeft > 0) return;
    this.intent = Math.min(P.intent.max, this.intent + v);
    this.intentIdle = 0;
  }

  // ───────────── 输出 ─────────────

  private writePose(P: DemonBladeParams): void {
    const s = this.pose;
    if (this.swingIdx >= 0) {
      const seg = P.combo[this.swingIdx];
      s.swing = this.swingIdx;
      s.swingP = clamp01(this.swingT / Math.max(0.01, seg.duration));
      s.hitP = clamp01(seg.windup / Math.max(0.01, seg.duration));
    } else {
      s.swing = -1;
      s.swingP = 0;
    }
    s.gesture = this.mode === 'swarm' ? 'point'
      : this.mode === 'shield' ? 'shield'
      : this.burstPhase === 'gather' ? 'raise'
      : this.burstPhase !== 'none' ? 'point' : 'none';
    s.union = this.unionLeft > 0 ? Math.min(1, this.unionLeft * 3) : 0;
    s.eye = this.eyeLeft > 0 ? Math.min(1, this.eyeLeft * 4) : 0;
    s.qi = clamp01(this.qi / P.qi.max);
  }

  private writeHud(P: DemonBladeParams): void {
    const h = this.hud;
    h.mode = this.mode;
    h.qi = clamp01(this.qi / P.qi.max);
    h.intent = clamp01(this.intent / P.intent.max);
    h.union = this.unionLeft > 0 ? clamp01(this.unionLeft / P.union.duration) : 0;
  }
}
