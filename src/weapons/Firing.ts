/**
 * 弹道：命中扫描、投射物、光束。
 *
 * 所有射线从 ctx.player.eye 出发（准星即落点），曳光 / 投射物从枪口出发。
 * 伤害请求的 base 不含玩家 damagePct（Combat 会乘），source 一律为 'weapon'。
 *
 * 元素轮转（三才转轮）：WeaponSystem 在每次射击分派前设置 elementOverride，本文件所有读取
 * 「本发元素」的地方都经 el(inst)，分派后复位为 null。
 * 蓄力（贯虹灵炮）：命中扫描接受 ShotMods（伤害倍率 / 穿透加成 / 满蓄 / 反馈强度），满蓄命中经
 * ctx.combat.detonate 引爆目标身上的元素状态。
 * 固定扇形齐射（魔刀千刃）：projectile 的 yawOffset 把「枪口 → 准星落点」方向绕竖直轴偏转，
 * shareAim 让同一轮的后续弹体复用第一枚的准星落点（三柄共享落点，扇形以准星为中心）。
 */
import * as THREE from 'three';
import type { DamageRequest, Element, GameContext, IEnemy, WeaponInstance } from '../core/types';
import { ELEMENT_COLORS } from '../core/types';
import { lerp, randomInCone } from '../core/math';
import type { WorldRayHit, StaticBox } from '../world/Collision';
import type { WeaponDef } from './WeaponDefs';
import type { ResolvedWeapon } from './WeaponStats';
import type { Viewmodel } from './Viewmodel';

/** 每穿透一名敌人后保留的伤害比例 */
const PIERCE_KEEP = 0.85;
/** 单次射线最多命中的敌人数（防御性上限） */
const MAX_HITS = 8;
/** 投射物瞄准点的最远距离 */
const AIM_MAX = 160;
/**
 * 准星落点近于此距离时改从眼前发射：枪口挂点约在相机前 0.9 米，
 * 贴脸的敌人可能夹在眼睛与枪口之间，从枪口发射会直接越过它。
 */
const POINT_BLANK = 1.3;
/** 抛物线补偿的最长飞行时间（秒） */
const GRAVITY_COMP_MAX = 2.4;

const _aim = new THREE.Vector3();
const _center = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();
const _target = new THREE.Vector3();
const _spawn = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _wh: WorldRayHit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as unknown as StaticBox };
const _exclude = new Set<IEnemy>();
const UP = new THREE.Vector3(0, 1, 0);

/** 光束每帧的命中结果（由 WeaponSystem 持有并复用） */
export interface BeamHit {
  enemy: IEnemy | null;
  headshot: boolean;
  hitWall: boolean;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  muzzle: THREE.Vector3;
  dir: THREE.Vector3;
}

export function makeBeamHit(): BeamHit {
  return {
    enemy: null, headshot: false, hitWall: false,
    point: new THREE.Vector3(), normal: new THREE.Vector3(), muzzle: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1),
  };
}

/** 单次射击的额外修饰（蓄力武器）；其他开火模式一律用 NO_SHOT */
export interface ShotMods {
  /** 额外伤害倍率（蓄力程度） */
  mult: number;
  /** 额外穿透数（满蓄） */
  pierceBonus: number;
  /** 满蓄一击（引爆元素状态） */
  full: boolean;
  /** 反馈强度 0..1：后坐、屏震、曳光宽度 */
  strength: number;
}

export const NO_SHOT: ShotMods = { mult: 1, pierceBonus: 0, full: false, strength: 1 };

/** 满蓄一击的附加光束颜色（物理时用灵炮的虹紫） */
const FULL_CHARGE_GLOW = 0xc9a8ff;

/** 曳光 / 火焰颜色：带元素用元素色，物理为暖白。el 为本发元素（元素轮转时与 inst.element 不同） */
export function shotColor(inst: WeaponInstance, el: Element = inst.element): number {
  return el === 'none' ? 0xffd9a0 : ELEMENT_COLORS[el];
}

/** 距离衰减倍率 */
export function falloffMult(def: WeaponDef, dist: number): number {
  const f = def.falloff;
  if (!f || dist <= f[0]) return 1;
  if (dist >= f[1]) return f[2];
  return lerp(1, f[2], (dist - f[0]) / (f[1] - f[0]));
}

export class Ballistics {
  /** 当前光束的取消函数（fx.beam 的返回值）；停火时调用，让光束立即收掉而不是拖完剩余寿命 */
  private beamCancel: (() => void) | null = null;
  /** 本发元素（元素轮转）：WeaponSystem 在 shoot() 分派前设置、分派后复位为 null */
  elementOverride: Element | null = null;
  /** 最近一次 projectile() 的散布后方向与准星落点（shareAim 复用） */
  private readonly volleyDir = new THREE.Vector3(0, 0, -1);
  private readonly volleyTarget = new THREE.Vector3();
  private volleyDist = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly vm: Viewmodel,
    private readonly rand: () => number,
  ) {}

  /** 本发实际元素 */
  private el(inst: WeaponInstance): Element {
    return this.elementOverride ?? inst.element;
  }

  private rollCrit(forceCrit: boolean, R: ResolvedWeapon): boolean {
    return forceCrit || (R.critChance > 0 && this.rand() < R.critChance);
  }

  // ───────────── 命中扫描 ─────────────

  /**
   * 命中扫描射击。spread 为整体散布（半角），pelletCone 为霰弹弹丸锥角。
   * mult 为额外伤害倍率（「终焉」最后一发、蓄力程度等，已由调用者合并）；shot 为蓄力修饰。
   */
  hitscan(inst: WeaponInstance, R: ResolvedWeapon, spread: number, pelletCone: number, forceCrit: boolean, mult: number, shot: ShotMods = NO_SHOT): void {
    const ctx = this.ctx;
    const def = R.def;
    ctx.player.getAimDirection(_aim);
    randomInCone(_aim, spread, this.rand, _center);
    this.vm.getMuzzleWorld(_muzzle);
    const el = this.el(inst);
    const color = shotColor(inst, el);
    const eye = ctx.player.eye;
    for (let i = 0; i < def.pellets; i++) {
      if (def.pellets > 1) randomInCone(_center, pelletCone, this.rand, _dir);
      else _dir.copy(_center);
      this.trace(inst, R, eye, _dir, forceCrit, mult, color, el, shot);
    }
  }

  private trace(
    inst: WeaponInstance, R: ResolvedWeapon, origin: THREE.Vector3, dir: THREE.Vector3,
    forceCrit: boolean, mult: number, color: number, el: Element, shot: ShotMods,
  ): void {
    const ctx = this.ctx;
    const def = R.def;
    const wh = ctx.world.raycast(origin, dir, def.range, _wh);
    const wallDist = wh ? wh.distance : def.range;
    _exclude.clear();
    let pierceLeft = R.pierce + shot.pierceBonus;
    let endDist = wallDist;
    let stopped = false;
    let dmgMult = mult;
    const detonate = shot.full && def.chargeDetonate;
    for (let n = 0; n < MAX_HITS; n++) {
      const eh = ctx.enemies.raycast(origin, dir, wallDist, _exclude);
      if (!eh) break;
      const enemy = eh.enemy;
      const dist = eh.distance;
      _hitPoint.copy(eh.point);
      _exclude.add(enemy);
      const req: DamageRequest = {
        base: R.damage * falloffMult(def, dist) * dmgMult,
        element: el,
        source: 'weapon',
        elementChance: R.elementChance,
        headshot: eh.headshot,
        critMult: R.critMult,
        weaponUid: inst.uid,
        point: _hitPoint.clone(),
        direction: dir.clone(),
        knockback: def.knockback,
        procDepth: 0,
      };
      if (this.rollCrit(forceCrit, R)) req.forceCrit = true;
      const res = ctx.combat.damageEnemy(enemy, req);
      // 满蓄：引爆目标身上已有的元素状态（只入队，不同步造成伤害；无状态时 Combat 返回 null）
      if (detonate && res && !res.killed && enemy.alive) {
        ctx.combat.detonate(enemy, { power: Math.min(res.dealt, enemy.maxHp * 0.5), depth: 0, weaponUid: inst.uid, point: req.point });
      }
      if (pierceLeft <= 0) {
        endDist = dist;
        stopped = true;
        break;
      }
      pierceLeft--;
      dmgMult *= PIERCE_KEEP;
    }
    const k = shot.strength;
    if (!stopped && wh) ctx.fx.impact(_wh.point, _wh.normal, color, def.impactSize * (0.6 + 0.4 * k));
    if (endDist > 1.2) {
      _end.copy(origin).addScaledVector(dir, endDist);
      ctx.fx.tracer(_muzzle, _end, color, def.tracerWidth * k);
      // 满蓄一击：沿弹道追加一道短暂的虹光
      if (shot.full) ctx.fx.beam(_muzzle, _end, el === 'none' ? FULL_CHARGE_GLOW : color, def.tracerWidth * 0.7, 0.16);
    }
  }

  // ───────────── 投射物 ─────────────

  /** 从 origin 沿 dir 的准星落点距离（墙或敌人，取更近） */
  private aimDistance(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    const ctx = this.ctx;
    const wh = ctx.world.raycast(origin, dir, maxDist, _wh);
    let d = wh ? wh.distance : maxDist;
    const eh = ctx.enemies.raycast(origin, dir, d);
    if (eh) d = eh.distance;
    return d;
  }

  /**
   * 发射一枚玩家投射物。初始方向修正为「枪口 → 准星落点」，有重力时补偿抛物线下坠；
   * fan > 0 时在该方向附近随机散开（蜂群）；yawOffset 为绕竖直轴的固定偏航（魔刀千刃的固定扇形，弧度）；
   * shareAim = true 时复用上一次调用的散布方向与准星落点（同一轮固定扇形的第 2 枚起）。
   */
  projectile(
    inst: WeaponInstance, R: ResolvedWeapon, spread: number, forceCrit: boolean, mult: number, fan: number,
    yawOffset = 0, shareAim = false,
  ): void {
    const ctx = this.ctx;
    const def = R.def;
    const p = def.projectile;
    if (!p) return;
    const eye = ctx.player.eye;
    ctx.player.getAimDirection(_aim);
    let dist: number;
    if (shareAim) {
      _dir.copy(this.volleyDir);
      _target.copy(this.volleyTarget);
      dist = this.volleyDist;
    } else {
      randomInCone(_aim, spread, this.rand, _dir);
      dist = this.aimDistance(eye, _dir, Math.min(def.range, AIM_MAX));
      _target.copy(eye).addScaledVector(_dir, dist);
      this.volleyDir.copy(_dir);
      this.volleyTarget.copy(_target);
      this.volleyDist = dist;
    }

    this.vm.getMuzzleWorld(_muzzle);
    // 枪口被墙挡住（贴墙）或目标贴脸时从眼前发射，避免穿墙 / 越过目标
    if (dist < POINT_BLANK || ctx.world.segmentBlocked(eye, _muzzle)) _spawn.copy(eye).addScaledVector(_dir, 0.15);
    else _spawn.copy(_muzzle);

    _vel.subVectors(_target, _spawn);
    const len = _vel.length();
    if (dist < 2.5 || len < 0.5) _vel.copy(_dir);
    else _vel.multiplyScalar(1 / len);
    if (yawOffset !== 0) _vel.applyAxisAngle(UP, yawOffset);
    if (fan > 0) {
      randomInCone(_vel, fan, this.rand, _tmp);
      _vel.copy(_tmp);
      _vel.y += fan * 0.6;
      _vel.normalize();
    }
    const speed = p.speed * R.projSpeedMult;
    _vel.multiplyScalar(speed);
    if (p.gravity > 0 && fan === 0) {
      // 抛物线补偿：让弹道落在准星处。最多补偿 2.4 秒（且不超过寿命的 85%）飞行时间，
      // 榴弹约 80 米内都能打中准星（竞技场对角线约 79 米）；更远时会落短，保留抛物线手感。
      const h = Math.hypot(_target.x - _spawn.x, _target.z - _spawn.z);
      const hSpeed = Math.max(1, Math.hypot(_vel.x, _vel.z));
      const t = Math.min(GRAVITY_COMP_MAX, p.lifetime * 0.85, h / hSpeed);
      _vel.y += 0.5 * p.gravity * t;
    }

    const el = this.el(inst);
    const req: DamageRequest = {
      base: R.damage * mult,
      element: el,
      source: 'weapon',
      elementChance: R.elementChance,
      critMult: R.critMult,
      weaponUid: inst.uid,
      knockback: def.knockback,
      procDepth: 0,
    };
    if (this.rollCrit(forceCrit, R)) req.forceCrit = true;
    const color = el === 'none' ? p.color : ELEMENT_COLORS[el];
    ctx.projectiles.spawn({
      owner: 'player',
      position: _spawn.clone(),
      velocity: _vel.clone(),
      gravity: p.gravity,
      radius: p.radius,
      lifetime: p.lifetime,
      damage: req,
      element: el,
      explosionRadius: R.explosionRadius > 0 ? R.explosionRadius : undefined,
      pierce: R.pierce > 0 ? R.pierce : undefined,
      bounces: p.bounces > 0 ? p.bounces : undefined,
      homing: p.homing > 0 ? p.homing : undefined,
      color,
      visual: p.visual,
      scale: p.scale,
      explodeOnExpire: p.explodeOnExpire ? true : undefined,
    });
  }

  // ───────────── 光束 ─────────────

  /**
   * 每帧：沿准星求光束落点并绘制。
   * fx 会把同一发射点、连续每帧刷新的光束合并成一条，寿命只续到 0.05 秒；
   * 停火 / 换弹 / 切枪时 WeaponSystem 再调用 stopBeam() 提前结束它。
   */
  beamTrace(inst: WeaponInstance, R: ResolvedWeapon, out: BeamHit): void {
    const ctx = this.ctx;
    const eye = ctx.player.eye;
    const range = R.def.range;
    ctx.player.getAimDirection(out.dir);
    const wh = ctx.world.raycast(eye, out.dir, range, _wh);
    const maxD = wh ? wh.distance : range;
    const eh = ctx.enemies.raycast(eye, out.dir, maxD);
    if (eh) {
      out.enemy = eh.enemy;
      out.headshot = eh.headshot;
      out.hitWall = false;
      out.point.copy(eh.point);
    } else {
      out.enemy = null;
      out.headshot = false;
      if (wh) {
        out.hitWall = true;
        out.point.copy(_wh.point);
        out.normal.copy(_wh.normal);
      } else {
        out.hitWall = false;
        out.point.copy(eye).addScaledVector(out.dir, range);
      }
    }
    this.vm.getMuzzleWorld(out.muzzle);
    const cancel = ctx.fx.beam(out.muzzle, out.point, beamColor(this.el(inst)), R.def.tracerWidth, 0.05);
    this.beamCancel = typeof cancel === 'function' ? cancel : null;
  }

  /** 停止绘制光束：调用最近一次 fx.beam 返回的取消函数（没有在画则什么都不做） */
  stopBeam(): void {
    const cancel = this.beamCancel;
    if (!cancel) return;
    this.beamCancel = null;
    try {
      cancel();
    } catch (err) {
      console.error('[Weapons] beam cancel failed', err);
    }
  }

  /** 光束一跳：伤害当前目标并向附近 1 名敌人弹射电弧 */
  beamTick(inst: WeaponInstance, R: ResolvedWeapon, hit: BeamHit, forceCrit: boolean, mult: number): void {
    const ctx = this.ctx;
    const def = R.def;
    const el = this.el(inst);
    const color = beamColor(el);
    const target = hit.enemy;
    if (target && target.alive) {
      const req: DamageRequest = {
        base: R.damage * mult,
        element: el,
        source: 'weapon',
        elementChance: R.elementChance,
        headshot: hit.headshot,
        critMult: R.critMult,
        weaponUid: inst.uid,
        point: hit.point.clone(),
        direction: hit.dir.clone(),
        knockback: def.knockback,
        procDepth: 0,
      };
      if (this.rollCrit(forceCrit, R)) req.forceCrit = true;
      ctx.combat.damageEnemy(target, req);
      if (def.chainFraction > 0) {
        _exclude.clear();
        _exclude.add(target);
        const next = ctx.enemies.nearest(hit.point, def.chainRange, _exclude);
        if (next && next.alive) {
          next.getBodyCenter(_tmp);
          ctx.fx.lightning(hit.point, _tmp, color);
          const dir = _vel.subVectors(_tmp, hit.point).normalize();
          ctx.combat.damageEnemy(next, {
            base: R.damage * mult * def.chainFraction,
            element: el,
            source: 'weapon',
            elementChance: R.elementChance * 0.5,
            canCrit: false,
            weaponUid: inst.uid,
            point: _tmp.clone(),
            direction: dir.clone(),
            procDepth: 1,
          });
        }
      }
    } else if (hit.hitWall) {
      ctx.fx.impact(hit.point, hit.normal, color, def.impactSize);
    }
  }
}

function beamColor(el: Element): number {
  return ELEMENT_COLORS[el === 'none' ? 'shock' : el];
}
