/**
 * 武器技能「千刃·无间」（魔刀千刃，docs/demon-blade.md 第 6、10.4.7 节）。由 WeaponSystem 持有、每帧调用 update（不论当前武器）。
 *
 * 阶段：IDLE → DASH → PENDING → IDLE。
 * - DASH：tryCast 经 IPlayer.lunge 突进；每帧对本帧脚底位移做路径判定（Melee.sweepPath），新命中的敌人受一次斩击、
 *   召回飞刃，存活者打上「刃印」。lunge 结束（或超过 dashTime + 宽限）进入 PENDING；契约桩 lunge 返回 false 时原地结算。
 * - PENDING：突进结束 impaleDelay 秒后贯穿所有刃印敌人并 ctx.combat.detonate 引爆其元素状态；刃群特效提前 IMPALE_LEAD 秒发射，
 *   与伤害同时落下。结算后派发 weapon:skillImpale（HUD 的全屏反馈与视野外方向提示）。
 *   延迟由 ctx.tasks 的关卡任务驱动：任务被清除（换关 ctx.tasks.clear）时不会回调，因此 update 里另有超时自清——
 *   超过 impaleDelay + PENDING_TIMEOUT 仍未贯穿就丢弃刃印回到 IDLE。中止（死亡 / 换关 / 超时）时 fx.blade.clearMarks() 让刃印淡出。
 * - 冷却：全局一条（所有武器技能共用，防止两把魔刀互切刷技能），= cooldown / (1 + skillHaste)（与英雄技能同一公式），
 *   急速变化时按比例换算剩余时间；换关保留、开新局清零；不响应 player.reduceCooldowns()（那是英雄技能）。
 *
 * 伤害一律 source 'weapon'、procDepth 0、tags SKILL_TAGS（只做标识，不吃 skillDamagePct），
 * 基础值 × 本武器伤害倍率 ResolvedWeapon.damageMult；吃 damagePct、吸血、命中类词条 / 秘卷与元素附着。
 */
import * as THREE from 'three';
import type { DamageRequest, DetonateOpts, GameContext, IEnemy, WeaponInstance, WeaponSkillState } from '../core/types';
import { clamp01 } from '../core/math';
import { bladeColor, pathClosest, sweepPath, type MeleeReach } from './Melee';
import type { WeaponSkillParams } from './WeaponDefs';
import type { ResolvedWeapon } from './WeaponStats';

// ───────────── 常量表（docs/demon-blade.md 10.1.3） ─────────────

/** 技能伤害请求的标签（模块级常量数组，不修改） */
const SKILL_TAGS: string[] = ['slash', 'weaponSkill'];
/** HUD / 描述的按键提示（默认绑定 KeyV，另有鼠标中键） */
export const WEAPON_SKILL_KEY = 'V';
/** 突进阶段最长 = dashTime + 此值（isLunging 未结束也强制进入等待） */
const SKILL_DASH_GRACE = 0.08;
/** 冷却中按 V 的 ui_deny 最短间隔 */
const SKILL_DENY_GAP = 0.4;
/** 路径斩击击退（沿「路径最近点 → 敌人」水平方向）与其上抬分量 */
const SKILL_PATH_KNOCK = 2.5;
const PATH_LIFT = 0.3;
/** 贯穿击退（以向上为主，略带「玩家 → 敌人」水平分量） */
const IMPALE_KNOCK = 2;
const IMPALE_SIDE = 0.35;
/** 引爆强度 = min(贯穿实际伤害, 最大生命 × 此值) */
const IMPALE_POWER_CAP = 0.5;
/** 刃印特效时长的余量（秒） */
const MARK_FX_PAD = 0.1;
/** 贯穿任务超时自清：PENDING 超过 impaleDelay + 此值仍未贯穿（任务已被清除）就丢弃刃印 */
const PENDING_TIMEOUT = 0.5;
/**
 * 贯穿特效提前于伤害的秒数：刃群出发后约 0.1–0.16 秒到齐（BladeFx），提前发射让刃群、伤害数字 / 闪白与重击音效同时落下
 * （伤害时刻不变，仍为突进结束后 impaleDelay 秒）
 */
const IMPALE_LEAD = 0.13;
/** 屏震：突进起手 / 贯穿结算（intensity, duration） */
const DASH_SHAKE = 0.3;
const DASH_SHAKE_TIME = 0.12;
const IMPALE_SHAKE = 0.55;
const IMPALE_SHAKE_TIME = 0.25;
/** 还没释放过时的基础冷却（HUD 显示） */
const DEFAULT_COOLDOWN = 16;
/** 双形态参数缺失时的判定高度带 */
const DEFAULT_REACH: MeleeReach = { reachBelow: 0.3, reachAbove: 0.6 };

type Phase = 'idle' | 'dash' | 'pending';

export interface BladeSkillHost {
  resolve(inst: WeaponInstance): ResolvedWeapon;
  /** 回刃（封顶弹匣，播召回特效）；from 为特效起点（世界坐标），null = 不播特效 */
  addBlades(inst: WeaponInstance, n: number, from: THREE.Vector3 | null): void;
  /** 释放时打断：换弹、连段、开火 / 变形缓冲 */
  interrupt(): void;
}

const _fwd = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _c = new THREE.Vector3();
const _first = new THREE.Vector3();
/** 贯穿引爆选项（Combat 同步读取、不持有引用；point 用完复位） */
const _det: DetonateOpts = { power: 0, mult: 1, depth: 0, weaponUid: 0, point: undefined };

export class BladeSkill {
  private phase: Phase = 'idle';
  /** 施法实例与参数（实例被 give 替换掉也照常贯穿；weaponUid 找不到实例时词条自然不触发） */
  private inst: WeaponInstance | null = null;
  private params: WeaponSkillParams | null = null;
  private color = 0xff3a24;
  /** 突进已进行秒数 */
  private elapsed = 0;
  /** 上一帧脚底位置（路径判定线段起点） */
  private readonly prev = new THREE.Vector3();
  /** 本次释放已被路径斩击命中的敌人（每名敌人只斩一次） */
  private readonly hitSet = new Set<IEnemy>();
  /** 刃印（只存敌人引用，复用数组） */
  private readonly marks: IEnemy[] = [];
  private readonly found: IEnemy[] = [];
  /** 贯穿时刻（ctx.time.now）与驱动它的关卡任务 */
  private impaleAt = 0;
  private cancelTask: (() => void) | null = null;
  /** 本次等待的贯穿特效已提前发射（IMPALE_LEAD） */
  private fxLaunched = false;
  /** 每次 abort / 新的等待递增，作废旧任务 */
  private gen = 0;
  // 冷却
  private cdLeft = 0;
  private cdTotal = DEFAULT_COOLDOWN;
  private cdBase = DEFAULT_COOLDOWN;
  private lastDeny = -99;
  private readonly hud: WeaponSkillState = {
    id: '', name: '', glyph: '', key: WEAPON_SKILL_KEY, cooldownRemaining: 0, cooldownTotal: DEFAULT_COOLDOWN, active: false,
  };

  constructor(
    private readonly ctx: GameContext,
    private readonly host: BladeSkillHost,
  ) {}

  /** 突进中（WeaponSystem：不响应切枪、不能攻击 / 变形 / 换弹） */
  get dashing(): boolean {
    return this.phase === 'dash';
  }

  /** 突进进度 0..1；不在突进为 −1（写 ViewmodelState.skillT） */
  get dashProgress(): number {
    if (this.phase !== 'dash' || !this.params) return -1;
    return clamp01(this.elapsed / Math.max(0.01, this.params.dashTime));
  }

  /** 写入并返回复用的 HUD 状态对象（读取后不要保存引用） */
  fill(def: WeaponSkillParams): WeaponSkillState {
    const s = this.hud;
    s.id = def.id;
    s.name = def.name;
    s.glyph = def.glyph;
    s.key = WEAPON_SKILL_KEY;
    s.cooldownRemaining = this.cdLeft;
    s.cooldownTotal = this.cdLeft > 0 ? this.cdTotal : this.totalFor(def.cooldown);
    s.active = this.phase !== 'idle';
    return s;
  }

  /** 释放。非 IDLE / 冷却中（播 ui_deny）/ 玩家已死返回 false。可在任一形态、变形中释放，释放后保持当前形态 */
  tryCast(inst: WeaponInstance, R: ResolvedWeapon): boolean {
    const ctx = this.ctx;
    const sk = R.def.skill;
    const player = ctx.player;
    if (!sk || this.phase !== 'idle' || !player.alive) return false;
    if (this.cdLeft > 0) {
      const now = ctx.time.now;
      if (now - this.lastDeny >= SKILL_DENY_GAP) {
        this.lastDeny = now;
        ctx.audio.play('ui_deny', { volume: 0.5 });
      }
      return false;
    }
    this.host.interrupt();
    this.inst = inst;
    this.params = sk;
    this.color = bladeColor(inst, R.def);
    this.elapsed = 0;
    this.hitSet.clear();
    this.marks.length = 0;
    this.prev.copy(player.position);
    player.getForward(_fwd);
    const moved = player.lunge(_fwd, sk.dashDist, sk.dashTime, sk.iframes, sk.exitSpeed);
    this.phase = 'dash';
    this.cdBase = sk.cooldown;
    this.cdTotal = this.totalFor(sk.cooldown);
    this.cdLeft = this.cdTotal;
    ctx.audio.play('blade_dash', { volume: 0.9 });
    ctx.fx.shake(DASH_SHAKE, DASH_SHAKE_TIME);
    ctx.events.emit('weapon:skillUsed', { weapon: inst, skillId: sk.id });
    // 起点处的敌人
    this.sweep(this.prev, this.prev, R);
    // 契约桩 / 被拒绝：原地结算（不白耗冷却）
    if (!moved) this.endDash();
    return true;
  }

  /** 每帧：冷却、突进扫描、待贯穿超时自清 */
  update(dt: number): void {
    this.updateCooldown(dt);
    if (this.phase === 'dash') this.updateDash(dt);
    else if (this.phase === 'pending' && this.ctx.time.now > this.impaleAt + PENDING_TIMEOUT) this.abort();
  }

  /** 回到 IDLE、丢弃刃印与待贯穿（仍在显示的刃印特效淡出：不会贯穿了）；冷却保留（死亡 / 换关） */
  abort(): void {
    this.gen++;
    if (this.cancelTask) {
      this.cancelTask();
      this.cancelTask = null;
    }
    if (this.marks.length > 0) this.ctx.fx.blade.clearMarks();
    this.fxLaunched = false;
    this.phase = 'idle';
    this.inst = null;
    this.params = null;
    this.elapsed = 0;
    this.marks.length = 0;
    this.found.length = 0;
    this.hitSet.clear();
  }

  /** 开新局：abort + 冷却清零 */
  resetForRun(): void {
    this.abort();
    this.cdLeft = 0;
    this.cdBase = DEFAULT_COOLDOWN;
    this.cdTotal = this.totalFor(DEFAULT_COOLDOWN);
    this.lastDeny = -99;
  }

  // ───────────── 内部 ─────────────

  private totalFor(base: number): number {
    return Math.max(0.1, base / Math.max(0.2, 1 + this.ctx.player.stats.get('skillHaste')));
  }

  private updateCooldown(dt: number): void {
    // 急速变化：按比例换算剩余时间（与 SkillController 一致）
    const total = this.totalFor(this.cdBase);
    if (total !== this.cdTotal) {
      if (this.cdLeft > 0 && this.cdTotal > 0) this.cdLeft *= total / this.cdTotal;
      this.cdTotal = total;
    }
    if (this.cdLeft > 0) this.cdLeft = Math.max(0, this.cdLeft - dt);
  }

  private updateDash(dt: number): void {
    const inst = this.inst;
    const sk = this.params;
    if (!inst || !sk) {
      this.abort();
      return;
    }
    const player = this.ctx.player;
    this.elapsed += dt;
    const pos = player.position;
    this.sweep(this.prev, pos, this.host.resolve(inst));
    // sweep 中的击杀事件理论上可能让玩家死亡并 abort
    if (this.phase !== 'dash') return;
    this.ctx.fx.blade.dashTrail(this.prev, pos, this.color);
    this.prev.copy(pos);
    if (!player.isLunging || this.elapsed >= sk.dashTime + SKILL_DASH_GRACE) this.endDash();
  }

  /** 路径斩击：a → b 两侧 pathRadius 内本次释放尚未命中的敌人 */
  private sweep(a: THREE.Vector3, b: THREE.Vector3, R: ResolvedWeapon): void {
    const ctx = this.ctx;
    const inst = this.inst;
    const sk = this.params;
    if (!inst || !sk) return;
    const found = sweepPath(ctx, a, b, sk.pathRadius, R.def.melee ?? DEFAULT_REACH, this.hitSet, this.found);
    if (found.length === 0) return;
    const base = sk.slashDamage * R.damageMult;
    let any = false;
    for (let i = 0; i < found.length; i++) {
      const e = found[i];
      if (!e.alive) continue;
      this.hitSet.add(e);
      pathClosest(a, b, e.position, _cp);
      e.getBodyCenter(_c);
      let hx = _c.x - _cp.x;
      let hz = _c.z - _cp.z;
      const d = Math.hypot(hx, hz);
      if (d > 1e-4) {
        hx /= d;
        hz /= d;
      } else {
        // 正好在路径上：沿突进方向
        ctx.player.getForward(_fwd);
        hx = _fwd.x;
        hz = _fwd.z;
      }
      // DamageResult.request 会被监听者持有：point / direction 每击新建（同 Firing）
      const k = e.radius * 0.8;
      const point = new THREE.Vector3(_c.x - hx * k, _c.y, _c.z - hz * k);
      const direction = new THREE.Vector3(hx, PATH_LIFT, hz).normalize();
      const req: DamageRequest = {
        base,
        element: inst.element,
        source: 'weapon',
        elementChance: R.meleeElementChance,
        critMult: R.critMult,
        weaponUid: inst.uid,
        point,
        direction,
        knockback: SKILL_PATH_KNOCK,
        procDepth: 0,
        tags: SKILL_TAGS,
      };
      if (R.critChance > 0 && ctx.rng.next() < R.critChance) req.forceCrit = true;
      const res = ctx.combat.damageEnemy(e, req);
      if (!res) continue;
      any = true;
      // 回刃：被斩死的也算
      this.host.addBlades(inst, sk.recallPerHit, point);
      if (!res.killed && e.alive && this.marks.length < sk.maxMarks) {
        this.marks.push(e);
        ctx.fx.blade.mark(e, sk.impaleDelay + Math.max(0, sk.dashTime - this.elapsed) + MARK_FX_PAD, this.color);
      }
      ctx.fx.blade.slashHit(point, direction, this.color, true);
    }
    found.length = 0;
    if (any) ctx.audio.play('blade_hit', { volume: 1, pitch: 0.8 });
  }

  /** 突进结束：收刀横弧；有刃印则 impaleDelay 秒后贯穿（ctx.tasks 驱动） */
  private endDash(): void {
    const ctx = this.ctx;
    const sk = this.params;
    if (!sk) {
      this.abort();
      return;
    }
    const p = ctx.player;
    // 收刀横弧按「横斩」方向（右 → 左）：第一人称的收刀横扫是从身侧压刀姿态横斩而出（Viewmodel FINISH）
    ctx.fx.blade.slashArc(p.eye, p.yaw, 0, 0, sk.pathRadius * 2, Math.PI / 2, this.color);
    this.hitSet.clear();
    if (this.marks.length === 0) {
      this.abort();
      return;
    }
    this.phase = 'pending';
    this.impaleAt = ctx.time.now + sk.impaleDelay;
    this.fxLaunched = false;
    const gen = ++this.gen;
    if (this.cancelTask) this.cancelTask();
    // 关卡任务（非常驻）：换关时被 ctx.tasks.clear 清除且不回调，由 update 的超时自清兜底。
    // 贯穿前 IMPALE_LEAD 秒先发射刃群特效，到点再结算伤害
    this.cancelTask = ctx.tasks.add(() => {
      if (gen !== this.gen || this.phase !== 'pending') return true;
      const now = this.ctx.time.now;
      if (!this.fxLaunched && now >= this.impaleAt - IMPALE_LEAD) this.launchImpaleFx();
      if (now < this.impaleAt) return false;
      this.cancelTask = null;
      this.impale();
      return true;
    });
  }

  /** 贯穿特效：刃群射向所有仍存活的刃印敌人（同时移除其刃印）；比伤害早 IMPALE_LEAD 秒，击杀也有表现 */
  private launchImpaleFx(): void {
    this.fxLaunched = true;
    const marks = this.marks;
    for (let i = 0; i < marks.length; i++) {
      const e = marks[i];
      if (e.alive) this.ctx.fx.blade.impale(e, this.color);
    }
  }

  /** 千刃贯穿所有仍存活的刃印敌人，并引爆其元素状态（≥ 2 种引发反应，否则「崩解」；引爆只入队） */
  private impale(): void {
    const ctx = this.ctx;
    const inst = this.inst;
    const sk = this.params;
    if (!inst || !sk) {
      this.abort();
      return;
    }
    if (!this.fxLaunched) this.launchImpaleFx();
    const R = this.host.resolve(inst);
    const base = sk.impaleDamage * R.damageMult;
    const p = ctx.player.position;
    let hit = false;
    const marks = this.marks;
    /** HUD 的视野外方向提示（每次释放一次，新建数组） */
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < marks.length; i++) {
      const e = marks[i];
      if (!e.alive) continue;
      e.getBodyCenter(_c);
      let hx = e.position.x - p.x;
      let hz = e.position.z - p.z;
      const d = Math.hypot(hx, hz);
      if (d > 1e-4) {
        hx /= d;
        hz /= d;
      } else {
        hx = 0;
        hz = 0;
      }
      const point = _c.clone();
      const req: DamageRequest = {
        base,
        element: inst.element,
        source: 'weapon',
        elementChance: R.meleeElementChance,
        critMult: R.critMult,
        weaponUid: inst.uid,
        point,
        direction: new THREE.Vector3(hx * IMPALE_SIDE, 1, hz * IMPALE_SIDE).normalize(),
        knockback: IMPALE_KNOCK,
        procDepth: 0,
        tags: SKILL_TAGS,
      };
      if (R.critChance > 0 && ctx.rng.next() < R.critChance) req.forceCrit = true;
      if (!hit) {
        hit = true;
        _first.copy(point);
      }
      points.push(point);
      const res = ctx.combat.damageEnemy(e, req);
      if (res && !res.killed && e.alive) {
        _det.power = Math.min(res.dealt, e.maxHp * IMPALE_POWER_CAP);
        _det.weaponUid = inst.uid;
        _det.point = point;
        ctx.combat.detonate(e, _det);
        _det.point = undefined;
      }
    }
    if (hit) {
      ctx.audio.play('blade_impale', { position: _first, volume: 1 });
      ctx.fx.shake(IMPALE_SHAKE, IMPALE_SHAKE_TIME);
      // 全屏反馈（朱红暗角闪 + 视野外刃印的方向刃光）：贯穿常发生在突进后的身后
      ctx.events.emit('weapon:skillImpale', { weapon: inst, points });
    }
    // 刃印已随贯穿特效移除：不再让 abort 淡出
    this.marks.length = 0;
    this.abort();
  }
}
