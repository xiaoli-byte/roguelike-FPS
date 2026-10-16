/**
 * 第三章「炮击 / 自爆组」（炮仗傀儡、神火飞鸦）共用的火药特效。和前两章拉开：这里全是明代火器——
 * 「一窝蜂」火箭、地老鼠烟花、神火飞鸦的火箭筒尾焰、炸开的红纸屑和纸灰。
 *
 * - 预警一律用饱和的「朱红偏洋红」（INFERNO.warn）：熔岩是橙色的，纯朱红落在熔岩上会被吃掉；偏一点洋红，
 *   在暗色玄武岩和亮橙熔岩上都读得出来。俯冲线用普通混合（solid）的贴花，不靠加法混合。
 * - createJetFlame：火箭筒口的尾焰（两层加法锥：外层橙、内芯黄白），沿 +Y 伸出，挂在骨骼插槽上。
 * - launchRocketVolley：一窝蜂齐射。火箭从箱口冲天（可见的上升段），落点立刻亮出预警圈，按各自时间从高空
 *   斜砸下来炸开（头顶来的，掩体不挡上方，但爆心到胸口被墙挡住时不伤）。可以顺带伤敌（哑炸乱飞的火箭）。
 * - spawnGroundRats：地老鼠：贴地乱窜、追玩家的脚，碰到脚或到时就炸（起跳躲开）。
 * - FuseSpark：引信火花沿导线（宿主局部坐标的折线）一路烧下去。
 * - DiveLine：神火飞鸦的俯冲线（地面朱红长条，点火期间逐渐填满）。
 * - spawnFloorFire / spawnPaperAsh：地上的残火（火箭落点、撞地后的燃烧纸灰），几秒内站在上面被烧；
 *   全部登记到 inferno/FireFeed，祸斗能跑去吃掉（吃掉即熄灭）。
 * - gunpowderBlast：火药爆炸的外观（火球、火柱、红纸屑、金色火星、焦痕），不结算伤害。
 *
 * 全部只用 ctx.fx / ctx.tasks / GroundDecal，挂到 ctx.stageGroup 的东西换关自动清理。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../../core/types';
import { clamp01 } from '../../core/math';
import { GroundDecal } from '../bosses/Visuals';
import { blastPlayer, zonePlayer } from '../Hazards';
import { FLAME_FX_TIME, createFlameTongue, spawnFlamePillar, spawnScorch, type FlameTongue } from './FlameFx';
import { registerFloorFire, type FloorFireHandle } from '../inferno/FireFeed';

export const INFERNO = {
  /** 预警：饱和的朱红偏洋红（暗玄武岩 / 亮橙熔岩上都看得见） */
  warn: 0xff1f4f,
  /** 火药火光 */
  fire: 0xff8a2a,
  hot: 0xffd27a,
  core: 0xfff4d0,
  /** 红纸屑、金色火星、黑烟灰 */
  paper: 0xd8241c,
  gold: 0xffc850,
  soot: 0x2a1a14,
} as const;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** 地面高度：找不到地面时用 fallback */
function groundAt(ctx: GameContext, x: number, z: number, fromY: number, fallback: number): number {
  const gy = ctx.world.groundHeight(x, z, fromY);
  return Number.isFinite(gy) ? gy : fallback;
}

// ───────────────────────────── 尾焰 ─────────────────────────────

let jetGeo: THREE.ConeGeometry | null = null;

export interface JetFlame {
  /** 挂到插槽上；尾焰沿本地 +Y 伸出，长度 1、底半径 0.28（由调用方缩放 group） */
  readonly group: THREE.Group;
  /** level 0 = 熄灭，约 1 = 平时巡航，2 = 点火猛喷；t 用于闪烁 */
  set(level: number, t: number): void;
  dispose(): void;
}

export function createJetFlame(seed = 0): JetFlame {
  jetGeo ??= (() => {
    // 尖朝 +Y、底面在原点的锥（底半径 1，高 1）
    const g = new THREE.ConeGeometry(1, 1, 10, 1, true);
    g.rotateX(Math.PI);
    g.translate(0, 0.5, 0);
    return g;
  })();
  const mk = (color: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const outerMat = mk(INFERNO.fire), innerMat = mk(INFERNO.core);
  const group = new THREE.Group();
  const outer = new THREE.Mesh(jetGeo, outerMat);
  const inner = new THREE.Mesh(jetGeo, innerMat);
  outer.renderOrder = inner.renderOrder = 4;
  outer.castShadow = inner.castShadow = false;
  outer.frustumCulled = inner.frustumCulled = false;
  group.add(outer, inner);
  group.visible = false;
  return {
    group,
    set(level: number, t: number): void {
      const k = Math.max(0, Math.min(2.5, level));
      group.visible = k > 0.01;
      if (!group.visible) return;
      const flick = 1 + 0.18 * Math.sin(t * 47 + seed * 3.1) + 0.1 * Math.sin(t * 83 + seed * 7.7);
      const len = (0.35 + 0.65 * k) * flick;
      outer.scale.set(0.28 * Math.min(1.4, 0.6 + 0.4 * k), len, 0.28 * Math.min(1.4, 0.6 + 0.4 * k));
      inner.scale.set(0.14 * Math.min(1.4, 0.6 + 0.4 * k), len * 0.6, 0.14 * Math.min(1.4, 0.6 + 0.4 * k));
      outerMat.opacity = Math.min(1, 0.55 * k);
      innerMat.opacity = Math.min(1, 0.7 * k);
    },
    dispose(): void {
      outerMat.dispose();
      innerMat.dispose();
    },
  };
}

// ───────────────────────────── 火箭 ─────────────────────────────

let rocketGeo: THREE.BufferGeometry | null = null;
let rocketMat: THREE.MeshStandardMaterial | null = null;
let trailMat: THREE.MeshBasicMaterial | null = null;

/** 一支「一窝蜂」火箭：红纸筒 + 铁箭头 + 尾部火光（沿 +Y 飞） */
function rocketMesh(scale: number): THREE.Group {
  if (!rocketGeo) {
    const body = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6).toNonIndexed();
    const tip = new THREE.ConeGeometry(0.075, 0.18, 6).translate(0, 0.34, 0).toNonIndexed();
    const pos = [...(body.getAttribute('position').array as Float32Array), ...(tip.getAttribute('position').array as Float32Array)];
    rocketGeo = new THREE.BufferGeometry();
    rocketGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rocketGeo.computeVertexNormals();
    body.dispose();
    tip.dispose();
  }
  rocketMat ??= new THREE.MeshStandardMaterial({ color: INFERNO.paper, emissive: 0x401006, roughness: 0.7, metalness: 0, flatShading: true });
  trailMat ??= new THREE.MeshBasicMaterial({
    color: INFERNO.hot, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const g = new THREE.Group();
  const m = new THREE.Mesh(rocketGeo, rocketMat);
  m.castShadow = true;
  g.add(m);
  // 尾部一团火光（拉长的发光球）
  const glow = new THREE.Mesh(ballGeometry(), trailMat);
  glow.position.y = -0.32;
  glow.scale.set(0.12, 0.3, 0.12);
  glow.renderOrder = 4;
  glow.castShadow = false;
  g.add(glow);
  g.scale.setScalar(scale);
  return g;
}

let ballGeo: THREE.IcosahedronGeometry | null = null;
function ballGeometry(): THREE.BufferGeometry {
  ballGeo ??= new THREE.IcosahedronGeometry(1, 1);
  return ballGeo;
}

export interface RocketVolleySpec {
  /** 每支火箭的出射点（世界坐标；少于火箭数时循环使用） */
  from: readonly THREE.Vector3[];
  /** 落点（地面）与各自的落地时间（从现在起，秒） */
  targets: readonly THREE.Vector3[];
  times: readonly number[];
  /** 爆炸半径、对玩家的伤害（已乘 damageMult） */
  radius: number;
  damage: number;
  source: IEnemy | null;
  /** 顺带伤敌（哑炸乱飞的火箭）：对敌人的基础伤害与击退；缺省不伤敌 */
  enemyBase?: number;
  knockback?: number;
  /** 上升段：冲多高、飞多久（秒）；乱飞的火箭冲得低、飞得短 */
  rise?: number;
  riseTime?: number;
  scale?: number;
  /** 预警圈颜色 */
  warn?: number;
  /** 落点留下的残火（半径、持续、每 0.5 秒的伤害）；缺省不留 */
  fire?: { radius: number; duration: number; damage: number };
}

/** 火箭从高空斜砸下来的最后一段（秒）与起始高度 */
const ROCKET_FALL = 0.32;
const ROCKET_DROP = 13;

/**
 * 一窝蜂齐射：火箭从出射点冲上天（视觉），各落点立刻亮出预警圈，按 times 依次从高空斜着砸下来炸开。
 * 返回取消函数：只撤销还没落地的预警圈和火箭（发射者死亡时已经射出去的照样落下，不调用它）。
 */
export function launchRocketVolley(ctx: GameContext, s: RocketVolleySpec): () => void {
  const k = s.scale ?? 1;
  const rise = s.rise ?? 9;
  const riseTime = s.riseTime ?? 0.55;
  const cancels: (() => void)[] = [];
  let cancelled = false;
  // 上升段：每支火箭从各自的出射点往上冲，稍微朝落点方向斜出、带火星尾迹
  const risers = s.targets.map((tgt, i) => {
    const from = s.from[i % Math.max(1, s.from.length)] ?? tgt;
    const m = rocketMesh(k);
    m.position.copy(from);
    ctx.stageGroup.add(m);
    const dx = tgt.x - from.x, dz = tgt.z - from.z, d = Math.hypot(dx, dz) || 1;
    const spread = 1.6 + (i % 3) * 0.5;
    return {
      m, delay: i * 0.05,
      vx: (dx / d) * spread + Math.sin(i * 2.4) * 0.8, vz: (dz / d) * spread + Math.cos(i * 2.4) * 0.8,
      vy: rise / riseTime,
    };
  });
  let rt = 0, trail = 0;
  ctx.tasks.add((dt) => {
    rt += dt;
    trail += dt;
    const puff = trail > 0.04;
    if (puff) trail = 0;
    for (const r of risers) {
      if (rt < r.delay) continue;
      r.m.position.x += r.vx * dt;
      r.m.position.z += r.vz * dt;
      r.m.position.y += r.vy * dt;
      _a.set(r.vx, r.vy, r.vz).normalize();
      r.m.quaternion.setFromUnitVectors(_b.set(0, 1, 0), _a);
      if (puff) ctx.fx.burst(r.m.position, INFERNO.gold, 1, 0.8, 0.35, 0.07 * k, -1);
    }
    if (rt >= riseTime + 0.05 * risers.length || cancelled) {
      for (const r of risers) r.m.removeFromParent();
      return true;
    }
    return false;
  });

  s.targets.forEach((tgt, i) => {
    const target = tgt.clone();
    const T = Math.max(ROCKET_FALL + 0.12, s.times[i] ?? 1.4);
    cancels.push(ctx.fx.groundWarning(target, s.radius, T, s.warn ?? INFERNO.warn));
    cancels.push(ctx.tasks.delay(T - ROCKET_FALL, () => {
      if (cancelled) return;
      const m = rocketMesh(1.1 * k);
      // 斜着砸下来：从落点上方、偏一侧的高空沿直线落到落点
      const side = (i % 2 === 0 ? 1 : -1) * 2.5;
      const start = new THREE.Vector3(target.x + side, target.y + ROCKET_DROP, target.z + side * 0.6);
      const dir = new THREE.Vector3().subVectors(target, start).normalize();
      m.quaternion.setFromUnitVectors(_b.set(0, 1, 0), dir);
      m.position.copy(start);
      ctx.stageGroup.add(m);
      let ft = 0, sp = 0;
      ctx.tasks.add((dt) => {
        ft += dt;
        sp += dt;
        const u = clamp01(ft / ROCKET_FALL);
        m.position.lerpVectors(start, target, u * u);
        if (sp > 0.04) {
          sp = 0;
          ctx.fx.burst(m.position, INFERNO.gold, 1, 0.6, 0.3, 0.08 * k, 0);
        }
        if (u >= 1 || cancelled) {
          m.removeFromParent();
          if (!cancelled) rocketImpact(ctx, target, s, k);
          return true;
        }
        return false;
      });
    }));
  });
  return () => {
    if (cancelled) return;
    cancelled = true;
    for (const c of cancels) c();
  };
}

function rocketImpact(ctx: GameContext, c: THREE.Vector3, s: RocketVolleySpec, k: number): void {
  _c.set(c.x, c.y + 0.35, c.z);
  blastPlayer(ctx, _c, s.radius, s.damage, 'fire', s.source, 0.5, 0.25, 4.5);
  if (s.enemyBase && s.enemyBase > 0) {
    const center = _c.clone();
    const base = s.enemyBase, kb = s.knockback ?? 4;
    // 延后一点结算：不在别的伤害结算里递归
    ctx.tasks.delay(0.02, () => {
      ctx.combat.explode(center, s.radius, {
        base, element: 'none', source: 'explosion', procDepth: 1, canCrit: false, knockback: kb,
      }, { playerDamage: 0, noFx: true, falloff: 0.5 });
    });
  }
  gunpowderBlast(ctx, _c, s.radius * 0.9, 0.7 * k);
  // 落点留一小片残火（祸斗会来吃）
  if (s.fire) {
    spawnFloorFire(ctx, { ground: c, radius: s.fire.radius, duration: s.fire.duration, damage: s.fire.damage, source: s.source, flames: 3, size: 0.32 });
  }
}

// ───────────────────────────── 火药爆炸（外观） ─────────────────────────────

/** 火药爆炸：火球、火柱、红纸屑、金色火星、焦痕。只有外观（伤害由调用方结算） */
export function gunpowderBlast(ctx: GameContext, center: THREE.Vector3, radius: number, size = 1): void {
  ctx.fx.explosion(center, radius, INFERNO.fire);
  const gy = groundAt(ctx, center.x, center.z, center.y + 0.5, center.y - 1);
  _b.set(center.x, gy, center.z);
  if (center.y - gy < 2.5) {
    spawnFlamePillar(ctx, _b, radius * 0.35, radius * 0.8);
    spawnScorch(ctx, _b, radius * 0.7, 5);
  }
  ctx.fx.burst(center, INFERNO.paper, Math.round(14 * size) + 4, 5.5 * size, 1.1, 0.07 * size, 3);
  ctx.fx.burst(center, INFERNO.gold, Math.round(18 * size) + 4, 8 * size, 0.6, 0.06 * size, 10);
  ctx.fx.burst(center, INFERNO.soot, 6, 2 * size, 1.2, 0.45 * size, -1.2);
  ctx.fx.ring(_b.set(center.x, gy + 0.05, center.z), radius * 1.1, INFERNO.hot, 0.35);
  ctx.audio.play('explosion', { position: center, volume: Math.min(1, 0.55 + 0.1 * radius), pitch: 1.15 });
}

// ───────────────────────────── 地老鼠 ─────────────────────────────

export interface GroundRatSpec {
  /** 撒出点（脚下，世界坐标） */
  from: THREE.Vector3;
  count: number;
  /** 寿命（到时就炸）、速度、爆炸半径、伤害（已乘 damageMult） */
  life: number;
  speed: number;
  radius: number;
  damage: number;
  source: IEnemy | null;
  /** 初始朝向（弧度，facing 约定），地老鼠先朝这个方向扇形撒开 */
  yaw: number;
}

let ratGeo: THREE.BufferGeometry | null = null;
let ratMat: THREE.MeshStandardMaterial | null = null;
let sparkMat: THREE.MeshBasicMaterial | null = null;

/** 碰到玩家脚的判定距离（水平）与高度差 */
const RAT_TOUCH = 0.75;
const RAT_TOUCH_DY = 0.9;

/**
 * 地老鼠烟花：count 个小纸炮从 from 扇形撒出去，贴地乱窜追玩家的脚（蛇形摆动，比玩家跑得慢），
 * 碰到脚（水平 0.75 米内、玩家没跳起来）或寿命到了就炸。返回存活数量的查询（测试用）。
 */
export function spawnGroundRats(ctx: GameContext, s: GroundRatSpec): { alive: () => number } {
  ratGeo ??= new THREE.CylinderGeometry(0.07, 0.07, 0.28, 6).rotateX(Math.PI / 2);
  ratMat ??= new THREE.MeshStandardMaterial({ color: INFERNO.paper, emissive: 0x3a0c06, roughness: 0.7, metalness: 0, flatShading: true });
  sparkMat ??= new THREE.MeshBasicMaterial({ color: INFERNO.hot, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const rats = Array.from({ length: s.count }, (_, i) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(ratGeo!, ratMat!);
    body.position.y = 0.08;
    body.castShadow = true;
    const spark = new THREE.Mesh(ballGeometry(), sparkMat!);
    spark.position.set(0, 0.1, -0.17);
    spark.scale.setScalar(0.07);
    spark.renderOrder = 4;
    g.add(body, spark);
    g.position.copy(s.from);
    ctx.stageGroup.add(g);
    const spread = s.count > 1 ? (i / (s.count - 1) - 0.5) * 2.2 : 0;
    return { g, spark, yaw: s.yaw + spread, phase: i * 1.7, age: 0, done: false };
  });
  let live = rats.length;
  let puff = 0;
  ctx.tasks.add((dt) => {
    const pl = ctx.player;
    puff += dt;
    const sparkle = puff > 0.05;
    if (sparkle) puff = 0;
    for (const r of rats) {
      if (r.done) continue;
      r.age += dt;
      const p = r.g.position;
      // 追脚：朝玩家脚下转（转向有限），叠加蛇形摆动；先 0.25 秒按撒出方向冲出去
      if (r.age > 0.25 && pl.alive) {
        const want = Math.atan2(pl.position.x - p.x, pl.position.z - p.z);
        let d = want - r.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        r.yaw += Math.max(-4.5 * dt, Math.min(4.5 * dt, d));
      }
      const wig = Math.sin(r.age * 13 + r.phase) * 0.9;
      const yaw = r.yaw + wig;
      const nx = p.x + Math.sin(yaw) * s.speed * dt, nz = p.z + Math.cos(yaw) * s.speed * dt;
      _a.set(p.x, p.y + 0.2, p.z);
      _b.set(nx, p.y + 0.2, nz);
      if (ctx.world.segmentBlocked(_a, _b)) {
        r.yaw += Math.PI * 0.6;
      } else {
        const gy = groundAt(ctx, nx, nz, p.y + 0.6, p.y);
        if (gy - p.y < 0.5) p.set(nx, gy, nz);
        else r.yaw += Math.PI * 0.6;
      }
      r.g.rotation.y = yaw;
      r.spark.scale.setScalar(0.06 + 0.03 * Math.sin(r.age * 40 + r.phase));
      if (sparkle) ctx.fx.burst(_c.set(p.x, p.y + 0.12, p.z), INFERNO.gold, 1, 1.5, 0.25, 0.05, 2);
      const dx = pl.position.x - p.x, dz = pl.position.z - p.z;
      const touch = pl.alive && dx * dx + dz * dz < RAT_TOUCH * RAT_TOUCH && Math.abs(pl.position.y - p.y) < RAT_TOUCH_DY;
      if (touch || r.age >= s.life || !r.g.parent) {
        r.done = true;
        live--;
        if (r.g.parent) {
          _c.set(p.x, p.y + 0.25, p.z);
          blastPlayer(ctx, _c, s.radius, s.damage, 'fire', s.source, 0.4, 0.15, 3);
          gunpowderBlast(ctx, _c, s.radius * 0.8, 0.45);
        }
        r.g.removeFromParent();
      }
    }
    return live <= 0;
  });
  return { alive: () => live };
}

// ───────────────────────────── 引信火花 ─────────────────────────────

let fuseGeo: THREE.IcosahedronGeometry | null = null;

/**
 * 引信火花：一颗白热的火花沿导线（parent 局部坐标的折线）烧下去，身后不断喷金色火星。
 * set(t) 把火花放到折线 t（0..1，按长度）处；t < 0 隐藏。材质由本对象持有（dispose）。
 */
export class FuseSpark {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly lens: number[] = [];
  private readonly total: number;
  private acc = 0;

  constructor(parent: THREE.Object3D, private readonly points: readonly THREE.Vector3[], private readonly size = 0.05) {
    fuseGeo ??= new THREE.IcosahedronGeometry(1, 1);
    this.mat = new THREE.MeshBasicMaterial({
      color: INFERNO.core, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(fuseGeo, this.mat);
    this.mesh.scale.setScalar(size);
    this.mesh.renderOrder = 5;
    this.mesh.castShadow = false;
    this.mesh.visible = false;
    parent.add(this.mesh);
    let sum = 0;
    for (let i = 1; i < points.length; i++) {
      sum += points[i].distanceTo(points[i - 1]);
      this.lens.push(sum);
    }
    this.total = sum;
  }

  /** 火花当前的局部位置（t 处） */
  pointAt(t: number, out: THREE.Vector3): THREE.Vector3 {
    const d = clamp01(t) * this.total;
    for (let i = 0; i < this.lens.length; i++) {
      if (d <= this.lens[i] || i === this.lens.length - 1) {
        const l0 = i === 0 ? 0 : this.lens[i - 1];
        const u = clamp01((d - l0) / Math.max(1e-6, this.lens[i] - l0));
        return out.lerpVectors(this.points[i], this.points[i + 1], u);
      }
    }
    return out.copy(this.points[this.points.length - 1]);
  }

  set(ctx: GameContext, t: number, dt: number): void {
    if (t < 0) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.pointAt(t, this.mesh.position);
    this.mesh.scale.setScalar(this.size * (1 + 0.45 * Math.sin(ctx.time.now * 60)));
    this.acc += dt;
    if (this.acc > 0.03) {
      this.acc = 0;
      this.mesh.getWorldPosition(_c);
      ctx.fx.burst(_c, INFERNO.gold, 2, 2.2, 0.3, 0.05, 6);
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mat.dispose();
  }
}

// ───────────────────────────── 俯冲线 ─────────────────────────────

/** 神火飞鸦的俯冲线：从 a 到 b 的地面朱红长条（普通混合，熔岩上也看得见），update(k) 随点火进度填满；tipRadius > 0 时末端再加一个环 */
export class DiveLine {
  private decal: GroundDecal | null;
  private readonly tip: GroundDecal | null;

  constructor(ctx: GameContext, a: THREE.Vector3, b: THREE.Vector3, halfWidth = 0.32, tipRadius = 1.2) {
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const len = Math.max(0.5, Math.hypot(b.x - a.x, b.z - a.z));
    this.decal = GroundDecal.acquire(ctx.stageGroup, INFERNO.warn).rect(a.x, Math.min(a.y, b.y), a.z, yaw, len, halfWidth);
    this.decal.solid = true;
    this.decal.opacity = 0;
    this.tip = tipRadius > 0 ? GroundDecal.acquire(ctx.stageGroup, INFERNO.warn).circle(b.x, b.y, b.z, tipRadius, tipRadius * 0.75) : null;
    if (this.tip) {
      this.tip.solid = true;
      this.tip.opacity = 0;
    }
  }

  update(k: number): void {
    if (!this.decal) return;
    this.decal.opacity = 0.35 + 0.5 * clamp01(k);
    this.decal.fill = clamp01(k);
    if (this.tip) {
      this.tip.opacity = 0.3 + 0.6 * clamp01(k);
      this.tip.fill = clamp01(k);
    }
  }

  release(): void {
    this.decal?.release();
    this.tip?.release();
    this.decal = null;
  }
}

// ───────────────────────────── 地火（纸灰、火箭落点的残火） ─────────────────────────────

export interface FloorFireSpec {
  ground: THREE.Vector3;
  radius: number;
  duration: number;
  /** 站在上面每 0.5 秒一跳的伤害（已乘 damageMult） */
  damage: number;
  source: IEnemy | null;
  /** 贴花颜色、火苗数量与大小 */
  color?: number;
  flames?: number;
  size?: number;
}

/**
 * 一片会被祸斗吃掉的地火：贴花 + 几簇跳动的火苗，duration 秒内站在上面每 0.5 秒烧一下。
 * 登记到 inferno/FireFeed（registerFloorFire）：祸斗吃掉它时火苗收小熄灭、不再伤人。外观和伤害都挂在非常驻任务上，
 * 换关自动结束。返回登记句柄（测试与调用方读 eaten）。
 */
export function spawnFloorFire(ctx: GameContext, s: FloorFireSpec): FloorFireHandle {
  const center = s.ground.clone();
  const duration = s.duration, radius = s.radius;
  const decal = GroundDecal.acquire(ctx.stageGroup, s.color ?? 0xff5a1a).circle(center.x, center.y, center.z, radius);
  decal.pattern = 1;
  decal.opacity = 0;
  const n = s.flames ?? 4, size = s.size ?? 0.4;
  const tongues: { t: FlameTongue; base: number; phase: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = createFlameTongue(Math.random());
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.8, r = i === 0 ? 0 : Math.sqrt(Math.random()) * radius * 0.75;
    t.position.set(center.x + Math.cos(a) * r, center.y + 0.02, center.z + Math.sin(a) * r);
    ctx.stageGroup.add(t);
    tongues.push({ t, base: size * (0.6 + Math.random() * 0.6), phase: Math.random() * 10 });
  }
  let t = 0, tick = 0.25, out = -1;
  const fire = registerFloorFire(ctx, center, radius, duration, () => { out = 0; });
  ctx.tasks.add((dt) => {
    t += dt;
    tick -= dt;
    FLAME_FX_TIME.value = ctx.time.now;
    // 被吃掉：0.35 秒内收小熄灭
    if (out >= 0) out += dt;
    const fadeIn = Math.min(1, t / 0.15);
    const fadeOut = out >= 0 ? Math.max(0, 1 - out / 0.35) : Math.max(0, Math.min(1, (duration - t) / 0.6));
    decal.time = t;
    decal.opacity = 0.7 * fadeIn * fadeOut;
    for (const f of tongues) {
      const pulse = 0.75 + 0.35 * Math.sin(t * 9 + f.phase) + 0.15 * Math.sin(t * 23 + f.phase * 2);
      const k = f.base * fadeIn * fadeOut;
      f.t.scale.set(k * 0.9, k * pulse * 1.4, k);
      f.t.material.uniforms.uAlpha.value = 0.9 * fadeOut;
    }
    if (tick <= 0 && out < 0) {
      tick = 0.5;
      zonePlayer(ctx, center, radius, s.damage, 'fire', s.source, 1.6);
    }
    if (t >= duration || (out >= 0 && fadeOut <= 0) || !decal.mesh.parent) {
      fire.remove();
      decal.release();
      for (const f of tongues) {
        f.t.removeFromParent();
        f.t.material.dispose();
      }
      return true;
    }
    return false;
  });
  return fire;
}

/** 撞地后的燃烧纸灰（神火飞鸦）：地火的一种，焦黑纸灰上跳着火苗 */
export function spawnPaperAsh(ctx: GameContext, ground: THREE.Vector3, radius: number, duration: number, damage: number, source: IEnemy | null): FloorFireHandle {
  return spawnFloorFire(ctx, { ground, radius, duration, damage, source, color: 0xff5a1a, flames: 5, size: 0.4 });
}
