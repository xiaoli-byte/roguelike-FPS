/**
 * 第二章群怪（冻鲛人、雪狌狌）的贴合特效与投掷物视觉：
 *
 * - 冻鱼骨矛：程序化骨矛（骨白矛杆 + 一排鱼刺肋 + 冰晶矛头），握在鲛人手里；投出后的飞矛视觉跟着真实投射物
 *   （ProjectileSystem 负责伤害、挡弹）的同一条弹道飞，撞墙时插在墙上一会儿再碎，命中玩家当场碎成冰屑。
 * - 冰块：狌狌从地上掰下的冰块，抛物线飞向落点（落点有预警圈），落地碎开、小范围伤害；半路撞墙就在墙上碎。
 * - 冰环：跳砸落地时贴地扩散的一圈冰刺（冒出 → 停留 → 沉回地面）和雪雾。
 * - 冻缓：给玩家一个短暂的移速减益（统一来源，重复命中只刷新时长不叠加）。
 * - 鲛珠：鲛人死时额头的鲛珠蹦出来、弹两下滚一小段，停下后变成一个小回复拾取物。
 *
 * 几何体模块级缓存，飞矛 / 冰块 / 冰刺实例走对象池（挂在 ctx.stageGroup 上，换关时被摘下，下次取用时重新挂上）。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../../core/types';
import { clamp01 } from '../../core/math';
import { blastPlayer } from '../Hazards';
import { flat } from '../Models';

export const FROST = {
  bone: 0xe6dcc4, boneDark: 0xb8ab90, ice: 0x9fe0ff, iceDeep: 0x4fa8d8, iceHot: 0xe8fbff,
  snow: 0xeef7ff, mist: 0xcfeaff, pearl: 0x6ff2ff, pearlHot: 0xeaffff, warn: 0x8fdcff,
  /** 地面预警用的饱和蓝：浅青色画在浅色冰面上几乎看不见 */
  warnSolid: 0x1a8cff,
};

// ───────────────────────────── 冻鱼骨矛 ─────────────────────────────

/** 骨矛沿 +Z：握点在原点，矛尖在 SPEAR_TIP（模型单位，未乘体型） */
export const SPEAR_TIP = 0.67;

interface SpearGeo {
  shaft: THREE.BufferGeometry;
  knob: THREE.BufferGeometry;
  rib: THREE.BufferGeometry;
  blade: THREE.BufferGeometry;
  bladeGlow: THREE.BufferGeometry;
}
let spearGeo: SpearGeo | null = null;

export function spearGeometry(): SpearGeo {
  if (spearGeo) return spearGeo;
  const shaft = new THREE.CylinderGeometry(0.014, 0.019, 0.76, 6).rotateX(Math.PI / 2).translate(0, 0, 0.04);
  const knob = new THREE.IcosahedronGeometry(0.03, 0).scale(1, 1, 1.4).translate(0, 0, -0.35);
  // 鱼刺肋：细长的扁锥，从矛杆斜向后伸出
  const rib = new THREE.ConeGeometry(0.008, 0.085, 4).translate(0, 0.0425, 0);
  // 冰晶矛头：拉长的八面体，略扁（像一片冻住的鱼骨刃）
  const blade = new THREE.OctahedronGeometry(1, 0).scale(0.048, 0.022, 0.15).translate(0, 0, 0.52);
  const bladeGlow = new THREE.OctahedronGeometry(1, 0).scale(0.058, 0.03, 0.165).translate(0, 0, 0.52);
  spearGeo = { shaft, knob, rib, blade, bladeGlow };
  return spearGeo;
}

/**
 * 在 parent 下拼一支骨矛（矛杆、鱼刺肋、矛头）。glow 由调用方提供时，矛头外再罩一层发光件（前摇时亮）。
 * 返回骨矛的根节点。
 */
export function assembleSpear(
  parent: THREE.Object3D, boneMat: THREE.Material, iceMat: THREE.Material,
  glow?: (parent: THREE.Object3D, geo: THREE.BufferGeometry) => THREE.Mesh,
): THREE.Group {
  const g = spearGeometry();
  const root = new THREE.Group();
  parent.add(root);
  root.add(new THREE.Mesh(g.shaft, boneMat));
  root.add(new THREE.Mesh(g.knob, boneMat));
  for (let i = 0; i < 5; i++) {
    const z = -0.02 + i * 0.075;
    for (const s of [1, -1]) {
      const r = new THREE.Mesh(g.rib, boneMat);
      r.position.set(0, 0, z);
      // 向外、向后斜伸，越靠近矛头越短
      r.rotation.set(-0.95, 0, s * 1.25);
      r.scale.setScalar(1 - i * 0.12);
      root.add(r);
    }
  }
  root.add(new THREE.Mesh(g.blade, iceMat));
  if (glow) glow(root, g.bladeGlow);
  return root;
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _d = new THREE.Vector3();
const _chest = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, 1);

interface Pooled {
  obj: THREE.Object3D;
  busy: boolean;
}

function acquire(pool: Pooled[], ctx: GameContext, make: () => THREE.Object3D): Pooled {
  let p = pool.find((x) => !x.busy);
  if (!p) {
    p = { obj: make(), busy: false };
    pool.push(p);
  }
  p.busy = true;
  if (p.obj.parent !== ctx.stageGroup) ctx.stageGroup.add(p.obj);
  p.obj.visible = true;
  p.obj.scale.setScalar(1);
  return p;
}

function release(p: Pooled): void {
  p.busy = false;
  p.obj.visible = false;
}

const spearPool: Pooled[] = [];

export interface SpearFlight {
  /** 投射物撞到东西（玩家 / 墙 / 地面）：point 为撞击点 */
  impact(point: THREE.Vector3): void;
  /** 投射物被挡下（魔刀千刃碎刃屏障等）：飞矛停在 point、当场碎开 */
  block(point: THREE.Vector3): void;
  /** 飞矛外观是否已经结束（碎掉 / 回收），测试与调试用 */
  readonly done: boolean;
}

/**
 * 飞矛视觉：与真实投射物同一弹道（同样的半隐式欧拉积分），矛尖对准投射物位置、沿速度方向。
 * 撞到墙 / 地面就插在那里 1 秒再碎；离玩家胸口很近的撞击当作命中玩家，当场碎开。超过 life 秒自然碎掉。
 */
export function launchSpearVisual(
  ctx: GameContext, from: THREE.Vector3, velocity: THREE.Vector3, gravity: number, life: number, scale: number,
): SpearFlight {
  const slot = acquire(spearPool, ctx, () => {
    const g = new THREE.Group();
    assembleSpear(g, flat(FROST.bone, { rough: 0.6 }), flat(FROST.ice, { emissive: 0x2a6a88, rough: 0.25 }));
    return g;
  });
  const obj = slot.obj;
  obj.scale.setScalar(scale);
  const pos = from.clone();
  const vel = velocity.clone();
  let age = 0;
  let stuck = -1;
  let trail = 0;
  let done = false;
  const place = (): void => {
    _d.copy(vel).normalize();
    obj.quaternion.setFromUnitVectors(FWD, _d);
    obj.position.copy(pos).addScaledVector(_d, -SPEAR_TIP * scale);
  };
  const shatter = (at: THREE.Vector3): void => {
    if (done) return;
    done = true;
    ctx.fx.burst(at, FROST.ice, 10, 3.2, 0.45, 0.07 * scale, 6);
    ctx.fx.burst(at, FROST.snow, 6, 1.4, 0.5, 0.16 * scale, 0.5);
    release(slot);
  };
  place();
  ctx.tasks.add((dt) => {
    if (done) return true;
    age += dt;
    if (stuck >= 0) {
      stuck += dt;
      // 插在墙上微微颤动，然后碎掉
      obj.rotation.z += Math.sin(stuck * 60) * 0.004 * Math.max(0, 1 - stuck * 4);
      if (stuck > 1.0) shatter(pos);
      return done;
    }
    vel.y -= gravity * dt;
    pos.addScaledVector(vel, dt);
    place();
    trail += dt;
    if (trail > 0.05) {
      trail = 0;
      ctx.fx.burst(pos, FROST.mist, 1, 0.25, 0.3, 0.09 * scale, 0);
    }
    if (age > life) shatter(pos);
    return done;
  });
  return {
    impact(point: THREE.Vector3): void {
      if (done || stuck >= 0) return;
      pos.copy(point);
      const p = ctx.player;
      _chest.set(p.position.x, p.position.y + p.height * 0.55, p.position.z);
      if (point.distanceTo(_chest) < 1.0) {
        shatter(point);
        return;
      }
      // 插进墙里一点
      place();
      obj.position.addScaledVector(_d, 0.08 * scale);
      stuck = 0;
      ctx.fx.burst(point, FROST.ice, 6, 2.2, 0.35, 0.06 * scale, 6);
    },
    block(point: THREE.Vector3): void {
      if (done) return;
      pos.copy(point);
      ctx.fx.burst(point, FROST.iceHot, 8, 4, 0.3, 0.06 * scale, 3);
      shatter(point);
    },
    get done(): boolean {
      return done;
    },
  };
}

// ───────────────────────────── 冰块 ─────────────────────────────

let chunkGeo: THREE.BufferGeometry | null = null;
/** 不规则的多面冰块（两个错位的十二面体合成的大形，按半径 1 建模） */
function iceChunkGeometry(): THREE.BufferGeometry {
  if (chunkGeo) return chunkGeo;
  const g = new THREE.DodecahedronGeometry(1, 0);
  const pos = g.getAttribute('position');
  // 按方向随机拉伸顶点：每个面略有起伏，像掰下来的冰
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    const k = 0.85 + 0.25 * Math.abs(Math.sin(_p.x * 7.1 + _p.y * 3.3 + _p.z * 5.7));
    _p.multiplyScalar(k);
    _p.y *= 0.8;
    pos.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  chunkGeo = g;
  return g;
}

/** 冰块的模型（挂在狌狌手上 / 飞行时用同一形状）：外层冰、里层亮芯 */
export function createIceChunk(radius: number): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(iceChunkGeometry(), flat(FROST.ice, { emissive: 0x1d5c7a, rough: 0.2, metal: 0.1 }));
  shell.scale.setScalar(radius);
  g.add(shell);
  const core = new THREE.Mesh(iceChunkGeometry(), flat(FROST.iceHot, { emissive: 0x5aa8c8, rough: 0.3 }));
  core.scale.setScalar(radius * 0.55);
  core.rotation.set(0.6, 0.9, 0.2);
  g.add(core);
  return g;
}

const chunkPool: Pooled[] = [];

export interface IceChunkSpec {
  from: THREE.Vector3;
  target: THREE.Vector3;
  flightTime: number;
  /** 冰块半径（米） */
  size: number;
  /** 落地碎裂的伤害半径（米） */
  radius: number;
  damage: number;
  source: IEnemy | null;
}

/** 抛出冰块：抛物线飞向落点（预警圈同步填满），落地或撞墙时碎裂、小范围伤害 */
export function launchIceChunk(ctx: GameContext, spec: IceChunkSpec): void {
  const T = Math.max(0.3, spec.flightTime);
  const g = 22;
  const pos = spec.from.clone();
  const vel = new THREE.Vector3().subVectors(spec.target, spec.from).divideScalar(T);
  vel.y += 0.5 * g * T;
  const slot = acquire(chunkPool, ctx, () => createIceChunk(1));
  const obj = slot.obj;
  obj.scale.setScalar(spec.size);
  obj.position.copy(pos);
  const spin = new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3);
  const cancelWarning = ctx.fx.groundWarning(spec.target, spec.radius, T, FROST.warnSolid);
  let age = 0;
  let trail = 0;
  let done = false;
  const burst = (at: THREE.Vector3, landed: boolean): void => {
    done = true;
    if (!landed) cancelWarning();
    release(slot);
    blastPlayer(ctx, at, spec.radius, spec.damage, 'none', spec.source, 0.4, 0.35, 3.5);
    ctx.fx.burst(at, FROST.ice, 16, 4.5, 0.55, 0.09, 9);
    ctx.fx.burst(at, FROST.snow, 10, 2.2, 0.7, 0.26, 0.5);
    _q.copy(at);
    _q.y += 0.05;
    ctx.fx.ring(_q, spec.radius, FROST.mist, 0.35);
    ctx.audio.play('land', { position: at, volume: 0.7, pitch: 1.6 });
  };
  ctx.tasks.add((dt) => {
    if (done) return true;
    age += dt;
    _p.copy(pos);
    vel.y -= g * dt;
    pos.addScaledVector(vel, dt);
    obj.position.copy(pos);
    obj.rotation.x += spin.x * dt;
    obj.rotation.y += spin.y * dt;
    obj.rotation.z += spin.z * dt;
    trail += dt;
    if (trail > 0.06) {
      trail = 0;
      ctx.fx.burst(pos, FROST.mist, 1, 0.2, 0.35, 0.14 * spec.size / 0.18, 0);
    }
    // 半路砸到玩家 / 撞墙：当场碎
    const p = ctx.player;
    _chest.set(p.position.x, p.position.y + p.height * 0.5, p.position.z);
    if (p.alive && pos.distanceTo(_chest) < spec.size + p.radius + 0.25) {
      burst(pos.clone(), false);
      return true;
    }
    if (age > 0.08 && ctx.world.segmentBlocked(_p, pos)) {
      burst(_p.clone(), false);
      return true;
    }
    if (age >= T) {
      const gy = ctx.world.groundHeight(pos.x, pos.z, pos.y + 1.5);
      if (!Number.isFinite(gy) || pos.y <= gy + spec.size || age >= T + 0.8) {
        if (Number.isFinite(gy)) pos.y = Math.max(gy, Math.min(pos.y, gy + spec.size));
        burst(pos.clone(), true);
        return true;
      }
    }
    return false;
  });
}

// ───────────────────────────── 冰环 ─────────────────────────────

let spikeGeo: THREE.BufferGeometry | null = null;
const ringPool: Pooled[] = [];
const RING_SPIKES = 12;

/** 跳砸落地：贴地一圈冰刺冒出、停留后沉回地面，加冲击环和雪雾。纯视觉（伤害由调用方结算） */
export function spawnIceRing(ctx: GameContext, ground: THREE.Vector3, radius: number): void {
  if (!spikeGeo) spikeGeo = new THREE.ConeGeometry(0.16, 0.7, 5).translate(0, 0.35, 0);
  const slot = acquire(ringPool, ctx, () => {
    const g = new THREE.Group();
    const mat = flat(FROST.ice, { emissive: 0x2a6a88, rough: 0.2 });
    for (let i = 0; i < RING_SPIKES; i++) g.add(new THREE.Mesh(spikeGeo!, mat));
    return g;
  });
  const obj = slot.obj;
  obj.position.copy(ground);
  obj.rotation.y = Math.random() * Math.PI;
  const spikes = obj.children as THREE.Mesh[];
  const seeds = spikes.map(() => 0.7 + Math.random() * 0.6);
  spikes.forEach((m, i) => {
    const a = (i / RING_SPIKES) * Math.PI * 2;
    const r = radius * (0.72 + 0.18 * (i % 2));
    m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    // 向外倾斜
    m.rotation.set(0, -a, 0);
    m.rotateZ(-0.45);
    m.scale.setScalar(0.01);
  });
  _q.copy(ground);
  _q.y += 0.06;
  ctx.fx.ring(_q, radius, FROST.mist, 0.4);
  ctx.fx.ring(_q, radius * 0.55, FROST.iceHot, 0.25);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    _p.set(ground.x + Math.cos(a) * radius * 0.7, ground.y + 0.15, ground.z + Math.sin(a) * radius * 0.7);
    ctx.fx.burst(_p, FROST.snow, 2, 1.6, 0.6, 0.3, 0.8);
  }
  ctx.fx.burst(_q, FROST.ice, 14, 5, 0.5, 0.08, 10);
  const DUR = 0.75;
  let t = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    const up = clamp01(t / 0.12);
    const down = clamp01((t - 0.45) / (DUR - 0.45));
    spikes.forEach((m, i) => {
      const s = seeds[i] * (up * (2 - up)) * (1 - down);
      m.scale.set(Math.max(0.01, s), Math.max(0.01, s * (1 - 0.6 * down)), Math.max(0.01, s));
    });
    if (t >= DUR) {
      release(slot);
      return true;
    }
    return false;
  });
}

// ───────────────────────────── 冻缓 ─────────────────────────────

const CHILL_SRC = 'enemy:frostChill';
let chillUntil = 0;
let chillTick = -Infinity;

/**
 * 冻缓：移速降低 frac（相对基础移速），持续 seconds 秒；重复命中只刷新时长、不叠加。
 * 解除由常驻任务负责（换关不清掉它，否则减速会一直留着）；新开一局时属性整体重置，同样会清掉。
 */
export function chillPlayer(ctx: GameContext, seconds: number, frac: number): void {
  const p = ctx.player;
  if (!p.alive) return;
  const stats = p.stats;
  const now = ctx.time.now;
  if (!stats.hasSource(CHILL_SRC)) stats.add('moveSpeed', -stats.getBase('moveSpeed') * frac, CHILL_SRC);
  chillUntil = Math.max(chillUntil, now + seconds);
  // 任务每帧刷新 chillTick；超过半秒没刷新说明任务已不在（新开一局清掉了），重新挂一个
  if (now - chillTick < 0.5) return;
  chillTick = now;
  let puff = 0;
  ctx.tasks.add((dt) => {
    chillTick = ctx.time.now;
    puff += dt;
    if (puff > 0.18 && p.alive) {
      puff = 0;
      _p.set(p.position.x + (Math.random() - 0.5) * 0.6, p.position.y + 0.15, p.position.z + (Math.random() - 0.5) * 0.6);
      ctx.fx.burst(_p, FROST.mist, 1, 0.4, 0.5, 0.18, -0.5);
    }
    if (ctx.time.now < chillUntil && p.alive) return false;
    stats.removeSource(CHILL_SRC);
    chillTick = -Infinity;
    return true;
  }, true);
}

// ───────────────────────────── 鲛珠 ─────────────────────────────

const pearlPool: Pooled[] = [];

/**
 * 鲛珠：从 from（额头）沿 dir 蹦出，落地弹两下、滚一小段；停下（约 0.8 秒）后原地变成回复 heal 点生命的拾取物。
 */
export function dropPearl(ctx: GameContext, from: THREE.Vector3, dir: THREE.Vector3, heal: number): void {
  const slot = acquire(pearlPool, ctx, () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 1), new THREE.MeshBasicMaterial({ color: FROST.pearl, toneMapped: false })));
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), new THREE.MeshBasicMaterial({
      color: FROST.pearl, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    })));
    return g;
  });
  const obj = slot.obj;
  const pos = from.clone();
  const vel = new THREE.Vector3(dir.x * 2.2, 3.2, dir.z * 2.2);
  obj.position.copy(pos);
  let age = 0;
  let bounces = 0;
  let sparkle = 0;
  ctx.fx.burst(pos, FROST.pearlHot, 8, 2, 0.35, 0.06, 0);
  ctx.tasks.add((dt) => {
    age += dt;
    vel.y -= 18 * dt;
    _p.copy(pos);
    pos.addScaledVector(vel, dt);
    if (ctx.world.segmentBlocked(_p, pos)) {
      pos.copy(_p);
      vel.x *= -0.4;
      vel.z *= -0.4;
    }
    const gy = ctx.world.groundHeight(pos.x, pos.z, pos.y + 0.3);
    const floor = (Number.isFinite(gy) ? gy : from.y - 1) + 0.075;
    if (pos.y < floor) {
      pos.y = floor;
      if (vel.y < 0) {
        vel.y = bounces < 2 ? -vel.y * 0.4 : 0;
        vel.x *= 0.7;
        vel.z *= 0.7;
        bounces++;
      }
    }
    obj.position.copy(pos);
    obj.rotation.x += Math.hypot(vel.x, vel.z) * dt * 8;
    sparkle += dt;
    if (sparkle > 0.12) {
      sparkle = 0;
      ctx.fx.burst(pos, FROST.pearl, 1, 0.3, 0.4, 0.05, -1);
    }
    if (age >= 0.8) {
      release(slot);
      ctx.fx.burst(pos, FROST.pearlHot, 12, 1.8, 0.5, 0.07, -2);
      ctx.loot.dropHealth(pos, heal);
      return true;
    }
    return false;
  });
}
