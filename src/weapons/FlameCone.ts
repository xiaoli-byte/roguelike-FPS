/**
 * 喷火器的火焰锥（Unity Weapons/FlameCone.cs，朱雀吐息）。原来每跳发一枚 flame 投射物（14 跳 / 秒）；照 Unity 改成不生成任何弹体：
 *   · 结算：每跳（WeaponSystem 的一次 shoot：耗 1 发、发 weapon:fired，词条照常）沿准星扫一个锥——
 *     锥长 = 弹速 × 寿命（24 × 0.42 ≈ 10 m，弹速词条 / 属性会拉长，不超过武器射程，撞墙截短），
 *     半径从投射物半径 0.32 线性张到锥口（半角 0.06 rad，10 m 处约 0.9 m）；
 *     锥内的敌人按沿轴距离排序，前 1 + 穿透 名各吃一次（不衰减），被地形挡住的不算、也不占名额；
 *     不按弱点算（火舌整团包住身体，不是点射）；出生中 / 遁地中（不可选中）的跳过，免得每秒十几个「免疫」；
 *   · 表现：每跳从枪口放 5 颗火舌（fx.flameJet：加法、上浮、阻尼、长大），隔跳一颗烟；命中点偶尔舔一簇小火星。
 * Unity 用 OverlapCapsule + 碰撞体最近点；网页的敌人是竖直胶囊（position / radius / height），按「锥轴线段 ↔ 胶囊轴线段」的最近点对算，
 * 结果同样是「胶囊表面离锥轴最近的点」。纯几何（{@link coneHit}）不碰场景，node --test 直接测。
 */
import * as THREE from 'three';
import type { DamageRequest, Element, GameContext, IEnemy, WeaponInstance } from '../core/types';
import { ELEMENT_COLORS } from '../core/types';
import { randomInCone } from '../core/math';
import { fxExtras } from '../fx/extras';
import type { WeaponDef } from './WeaponDefs';
import type { ResolvedWeapon } from './WeaponStats';

export const FLAME_CONE = {
  /** 投射物外观 id：定义的 projectile.visual 是它、且是连发武器时由火焰锥接管 */
  Visual: 'flame',
  /** 锥的半角（弧度）：10 m 处半径约 0.9 m——近战武器要好打中 */
  HalfAngle: 0.06,
  /** 锥从眼前多远开始（米）：贴脸的敌人也要烧到 */
  StartOffset: 0.15,
  /** 每跳的火舌颗数（Unity 乘画质密度，至少 2 颗） */
  Flames: 5,
  /** 舔火星：每几个命中一次 */
  LickEvery: 3,
} as const;

/** 这把枪的开火由火焰锥接管（喷火器） */
export function flameConeHandles(def: WeaponDef | null | undefined): boolean {
  return !!def && !!def.projectile && def.projectile.visual === FLAME_CONE.Visual && def.mode === 'auto';
}

/** 锥长（米）：弹速（含弹速加成）× 寿命，不超过定义射程 */
export function flameReach(def: WeaponDef, projSpeedMult = 1): number {
  const p = def.projectile!;
  return Math.min(p.speed * (projSpeedMult > 0 ? projSpeedMult : 1) * p.lifetime, def.range);
}

/** 距锥起点 along 米处的锥半径 */
export function flameRadiusAt(def: WeaponDef, along: number): number {
  return def.projectile!.radius + Math.max(0, along) * Math.tan(FLAME_CONE.HalfAngle);
}

export interface ConeHit {
  /** 沿锥轴的距离 */
  along: number;
  /** 离锥轴的距离 */
  off: number;
  point: THREE.Vector3;
}

const _a0 = new THREE.Vector3();
const _a1 = new THREE.Vector3();
const _b0 = new THREE.Vector3();
const _b1 = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _q = new THREE.Vector3();

/** 两条线段的最近点对（Ericson 5.1.9）：写入 outA / outB */
function closestSegSeg(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, outA: THREE.Vector3, outB: THREE.Vector3): void {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) {
    s = t = 0;
  } else if (a <= 1e-9) {
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) {
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  outA.set(p1.x + d1x * s, p1.y + d1y * s, p1.z + d1z * s);
  outB.set(p2.x + d2x * t, p2.y + d2y * t, p2.z + d2z * t);
}

/**
 * 竖直胶囊（脚底 feet、半径 r、高 h）是否在火焰锥里（Unity FlameCone.Burn 的判定）：
 * 取胶囊表面离锥轴最近的点 q，沿轴距离 along 在 [0, reach] 内、离轴距离 ≤ 该处锥半径（+1 mm）。不在锥里返回 null；
 * out 复用（point 是 q 的拷贝）
 */
export function coneHit(
  def: WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, reach: number,
  feet: { x: number; y: number; z: number }, r: number, h: number, out: ConeHit,
): ConeHit | null {
  _a0.copy(origin).addScaledVector(dir, FLAME_CONE.StartOffset);
  _a1.copy(origin).addScaledVector(dir, Math.max(FLAME_CONE.StartOffset, reach));
  const lo = feet.y + Math.min(r, h * 0.5), hi = feet.y + Math.max(h - r, h * 0.5);
  _b0.set(feet.x, lo, feet.z);
  _b1.set(feet.x, hi, feet.z);
  closestSegSeg(_a0, _a1, _b0, _b1, _pa, _pb);
  const d = _pa.distanceTo(_pb);
  // 胶囊表面离锥轴最近的点：轴线穿过胶囊时就是轴上那一点
  if (d <= r || d < 1e-6) _q.copy(_pa);
  else _q.copy(_pb).addScaledVector(_pa.sub(_pb), r / d);
  const along = (_q.x - origin.x) * dir.x + (_q.y - origin.y) * dir.y + (_q.z - origin.z) * dir.z;
  if (along < -1e-6 || along > reach + 1e-6) return null;
  const ox = _q.x - (origin.x + dir.x * along), oy = _q.y - (origin.y + dir.y * along), oz = _q.z - (origin.z + dir.z * along);
  const off = Math.hypot(ox, oy, oz);
  if (off > flameRadiusAt(def, along) + 1e-3) return null;
  out.along = along;
  out.off = off;
  out.point.copy(_q);
  return out;
}

/** 烧谁：按沿轴距离从近到远，前 1 + 穿透 名（被挡住的不算、不占名额）。cands 已经是锥内的 */
export function pickBurned<T extends { along: number }>(cands: T[], pierce: number, blocked: (c: T) => boolean): T[] {
  cands.sort((x, y) => x.along - y.along);
  const limit = 1 + Math.max(0, Math.floor(pierce));
  const out: T[] = [];
  for (const c of cands) {
    if (out.length >= limit) break;
    if (blocked(c)) continue;
    out.push(c);
  }
  return out;
}

const WHITE = new THREE.Color(0xffffff);
const _col = new THREE.Color();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();
const _heading = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _wh = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as never };
/** 烟色（Unity (0.22, 0.18, 0.16)） */
const SMOKE = 0x382e29;

interface Cand extends ConeHit {
  enemy: IEnemy;
}

function mix(color: number, white: number): number {
  return _col.setHex(color).lerp(WHITE, white).getHex();
}

export interface FlameShot {
  inst: WeaponInstance;
  R: ResolvedWeapon;
  /** 本发元素（元素轮转 / 随机元素） */
  element: Element;
  /** 整体散布（半角） */
  spread: number;
  /** 伤害倍率（传说「终焉」等，已由调用者合并） */
  mult: number;
  forceCrit: boolean;
}

export class FlameCone {
  private tick = 0;
  private burning = false;
  private readonly near: IEnemy[] = [];
  private readonly cands: Cand[] = [];
  /** 上一跳烧到几个（调试 / 测试读） */
  lastBurned = 0;
  /** 上一跳的锥长（撞墙截短后） */
  lastReach = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly muzzle: (out: THREE.Vector3) => THREE.Vector3,
    private readonly rand: () => number,
  ) {}

  /** 一跳：返回这一跳烧到的敌人数 */
  emit(s: FlameShot): number {
    const ctx = this.ctx;
    const def = s.R.def;
    if (!def.projectile) return 0;
    const origin = ctx.player.eye;
    ctx.player.getAimDirection(_aim);
    randomInCone(_aim, s.spread, this.rand, _dir);
    let reach = flameReach(def, s.R.projSpeedMult);
    // 撞墙截短：火焰不穿墙
    const wall = ctx.world.raycast(origin, _dir, reach, _wh as never);
    if (wall) reach = Math.max(FLAME_CONE.StartOffset + 0.05, wall.distance);
    this.lastReach = reach;
    this.muzzle(_muzzle);
    const dir = _dir.clone();
    const hit = this.burn(s, origin, dir, reach);
    this.draw(s, origin, dir, _muzzle, reach);
    this.lastBurned = hit;
    return hit;
  }

  private burn(s: FlameShot, origin: THREE.Vector3, dir: THREE.Vector3, reach: number): number {
    // 结算里的伤害事件万一同步又开了一枪（重入），用临时表，不踩正在遍历的共享表
    if (this.burning) return this.burnInto(s, origin, dir, reach, [], []);
    this.burning = true;
    try {
      return this.burnInto(s, origin, dir, reach, this.near, this.cands);
    } finally {
      this.burning = false;
      this.near.length = 0;
      this.cands.length = 0;
    }
  }

  private burnInto(s: FlameShot, origin: THREE.Vector3, dir: THREE.Vector3, reach: number, near: IEnemy[], cands: Cand[]): number {
    const ctx = this.ctx;
    const def = s.R.def;
    const rMax = flameRadiusAt(def, reach);
    _mid.copy(origin).addScaledVector(dir, reach * 0.5);
    near.length = 0;
    cands.length = 0;
    const found = ctx.enemies.queryRadius(_mid, reach * 0.5 + rMax + 0.5, near);
    for (const e of found) {
      if (!e.alive || e.untargetable) continue;
      const c: Cand = { enemy: e, along: 0, off: 0, point: new THREE.Vector3() };
      if (coneHit(def, origin, dir, reach, e.position, e.radius, e.height, c)) cands.push(c);
    }
    if (cands.length === 0) return 0;
    const burned = pickBurned(cands, s.R.pierce, c => !c.enemy.alive || ctx.world.segmentBlocked(origin, c.point));
    const el = s.element;
    const tint = el === 'none' ? def.projectile!.color : ELEMENT_COLORS[el];
    let n = 0;
    for (let i = 0; i < burned.length; i++) {
      const c = burned[i];
      if (!c.enemy.alive) continue;
      const req: DamageRequest = {
        base: s.R.damage * s.mult,
        element: el,
        source: 'weapon',
        elementChance: s.R.elementChance,
        critMult: s.R.critMult,
        weaponUid: s.inst.uid,
        point: c.point.clone(),
        direction: dir.clone(),
        knockback: def.knockback,
        procDepth: 0,
      };
      if (s.forceCrit || (s.R.critChance > 0 && this.rand() < s.R.critChance)) req.forceCrit = true;
      ctx.combat.damageEnemy(c.enemy, req);
      n++;
      if ((this.tick + i) % FLAME_CONE.LickEvery === 0) this.lick(c.point, dir, tint);
    }
    return n;
  }

  /** 一跳的火舌：火团 5 颗、烟 1 颗（隔跳）；寿命按撞墙距离截短 */
  private draw(s: FlameShot, origin: THREE.Vector3, dir: THREE.Vector3, muzzle: THREE.Vector3, reach: number): void {
    const ex = fxExtras(this.ctx);
    this.tick++;
    if (!ex?.flameJet) return;
    const def = s.R.def;
    const spec = def.projectile!;
    const color = s.element === 'none' ? spec.color : ELEMENT_COLORS[s.element];
    const speed = spec.speed * (s.R.projSpeedMult > 0 ? s.R.projSpeedMult : 1);
    // 火舌从枪口出发，指向准星方向上锥的末端（枪口在右下，直接沿 dir 会和准星错开）
    _end.copy(origin).addScaledVector(dir, reach);
    _heading.subVectors(_end, muzzle);
    const span = _heading.length();
    if (span < 1e-4) _heading.copy(dir);
    else _heading.multiplyScalar(1 / span);
    const life = Math.max(0.08, Math.min(spec.lifetime, span / Math.max(1, speed)));
    for (let i = 0; i < FLAME_CONE.Flames; i++) {
      randomInCone(_heading, FLAME_CONE.HalfAngle * 1.25, Math.random, _v);
      _v.multiplyScalar(speed * (0.82 + Math.random() * 0.23));
      _p.copy(muzzle).addScaledVector(_heading, Math.random() * 0.25);
      ex.flameJet(_p, _v, mix(color, 0.1 + Math.random() * 0.35), spec.radius * spec.scale * (0.35 + Math.random() * 0.25), life * (0.8 + Math.random() * 0.3));
    }
    if (this.tick % 2 === 0) {
      _p.copy(muzzle).addScaledVector(_heading, reach * 0.35);
      _v.copy(_heading).multiplyScalar(speed * 0.35);
      _v.y += 0.8;
      ex.flameJet(_p, _v, SMOKE, 0.45, 0.7, true);
    }
  }

  /** 命中点舔一簇小火星（隔几跳一次，免得十几跳 / 秒刷满屏） */
  private lick(point: THREE.Vector3, dir: THREE.Vector3, color: number): void {
    const ex = fxExtras(this.ctx);
    if (!ex?.flameJet) return;
    for (let i = 0; i < 2; i++) {
      _p.copy(point).addScaledVector(dir, -0.1);
      _v.set(Math.random() * 2 - 1, Math.random() * 2 - 1 + 0.8, Math.random() * 2 - 1);
      if (_v.lengthSq() < 1e-6) _v.set(0, 1, 0);
      _v.normalize().multiplyScalar(1 + Math.random() * 1.5);
      ex.flameJet(_p, _v, mix(color, 0.3), 0.25 + Math.random() * 0.2, 0.18 + Math.random() * 0.12);
    }
  }
}
