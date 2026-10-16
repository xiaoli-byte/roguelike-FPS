/**
 * 第三章远程组（毕方、马面狱卒）的火系特效与危险物。全部挂 ctx.stageGroup、由 ctx.tasks 驱动：
 * 施放者死亡 / 被打断后，已经射出的火矛、地上的讹火照样兑现（与冰光余迹、蜃火珠一致）。
 *
 *  - INFERNO：本组的配色。预警一律用浅金白（0xffe9a0）：深色玄武岩上醒目，叠在橙色熔岩上也比熔岩更亮，
 *    不会像橙色预警那样被熔岩吃掉；锁定 / 出手的瞬间转成白热。
 *  - AimLine：毕方「毕」声时从喙尖连到玩家胸口的瞄准细线（空中的线，比地面贴花更能指出「从哪儿来」）。
 *  - launchFireSpear：毕方「方」声啄出的火矛——快速直线弹（不追踪）。世界射线挡住处留下讹火；
 *    打中玩家造成伤害并点燃 2 秒（每 0.5 秒一跳灼烧，多只毕方叠加只刷新时长）。
 *  - spawnEmberFire：讹火——火矛打空落在墙面 / 地面上烧 3 秒的火点：地上一簇跳动的火舌 + 焦痕，站在上面每 0.5 秒烫一下。
 *    火点登记进「地上的火」登记表（inferno/FireFeed.ts 的 registerFloorFire）：祸斗会跑去吃掉它，吃掉时火立刻熄灭。
 *  - ChainLinks：马面狱卒的勾魂索——运行时程序化铁链（一组实例化的链环，相邻两环互相垂直），
 *    每环单独一个「热度」颜色（甩圈时从腕铐往外逐节烧红、拖拽时整条发红）；钩头是一个带倒刺的小铁钩。
 *  - chainShotHits：链子被射中的判定（玩家开枪时的瞄准射线到链子线段的最近距离）；dropChain：断链散落。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../../core/types';
import { clamp01 } from '../../core/math';
import { BeamMesh, GroundDecal } from '../bosses/Visuals';
import { FLAME_FX_TIME, createFlameTongue, spawnScorch, type FlameTongue } from './FlameFx';
import { registerFloorFire, type FloorFireHandle } from '../inferno/FireFeed';
import { segmentHitsPlayer } from './FrostRangedFx';

export const INFERNO = {
  /** 预警：浅金白（深色玄武岩与橙色熔岩上都读得出来）；锁定后转白热 */
  warn: 0xffe9a0, warnHot: 0xfff8e8,
  ember: 0xff7a1a, hot: 0xffc04a, core: 0xfff1c8, spark: 0xffd27a, smoke: 0x3a2e28, ash: 0x6a5a50,
  /** 铁链：冷铁的暗灰、烧红的熔岩橙 */
  iron: 0x34302e, ironHot: 0xff5a14,
} as const;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Q90 = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);

// ───────────── 点燃（玩家） ─────────────

const ignite = { ctx: null as GameContext | null, until: 0, next: 0, tick: 0, running: false };

/** 点燃玩家 duration 秒，每 0.5 秒一跳 tick 伤害（火属性）。已在燃烧时只刷新时长并取较大的跳伤 */
export function ignitePlayer(ctx: GameContext, duration: number, tick: number): void {
  const now = ctx.time.now;
  if (ignite.ctx !== ctx || !ignite.running) {
    ignite.ctx = ctx;
    ignite.until = now + duration;
    ignite.next = now + 0.5;
    ignite.tick = tick;
    ignite.running = true;
    ctx.tasks.add(() => {
      const p = ctx.player;
      if (ignite.ctx !== ctx || !p.alive || ctx.time.now > ignite.until + 0.05) {
        if (ignite.ctx === ctx) ignite.running = false;
        return true;
      }
      if (ctx.time.now >= ignite.next && ignite.next <= ignite.until + 0.02) {
        ignite.next += 0.5;
        ctx.combat.damagePlayer(ignite.tick, 'fire', null, p.position);
        _a.set(p.position.x, p.position.y + 0.6, p.position.z);
        ctx.fx.burst(_a, INFERNO.ember, 6, 1.4, 0.45, 0.09, -2.5);
        ctx.audio.play('burn_tick', { volume: 0.5, pitch: 1.1 });
      }
      return false;
    }, true);
    return;
  }
  ignite.until = Math.max(ignite.until, now + duration);
  ignite.tick = Math.max(ignite.tick, tick);
}

/** 玩家是否正在燃烧（测试 / UI） */
export function playerIgnited(ctx: GameContext): boolean {
  return ignite.ctx === ctx && ignite.running && ctx.time.now <= ignite.until;
}

// ───────────── 讹火（地上的火点） ─────────────

export interface EmberFire {
  readonly position: THREE.Vector3;
  readonly radius: number;
  readonly until: number;
  /** 烧完 / 被祸斗吃掉 */
  out: boolean;
  /** 在「地上的火」登记表里的条目（祸斗食火，src/enemies/inferno/FireFeed.ts） */
  readonly feed: FloorFireHandle;
}

/**
 * 讹火：point 处烧 duration 秒的火点（半径 radius）。打在墙上时火落在墙脚的地面上（往下找 3 米内的地面），
 * 悬空找不到地面就只在命中点冒一团火星、不留火点。站在火点里的玩家每 0.5 秒受 tick 点火伤害。
 * 火点登记进 FireFeed（registerFloorFire）：祸斗能找到它、吃掉它——吃掉时火舌、贴花、伤害立刻一起熄灭。
 */
export function spawnEmberFire(ctx: GameContext, point: THREE.Vector3, normal: THREE.Vector3 | null, radius: number, duration: number, tick: number): EmberFire | null {
  // 墙面命中：往外挪一点再找地面
  _a.copy(point);
  if (normal) _a.addScaledVector(normal, Math.abs(normal.y) < 0.5 ? radius * 0.8 : 0.05);
  const gy = ctx.world.groundHeight(_a.x, _a.z, _a.y + 0.3);
  ctx.fx.burst(point, INFERNO.hot, 14, 4, 0.5, 0.1, -3);
  ctx.fx.burst(point, INFERNO.spark, 8, 6, 0.35, 0.05, -6);
  if (!Number.isFinite(gy) || _a.y - gy > 3) return null;
  const pos = new THREE.Vector3(_a.x, gy, _a.z);
  const feed = registerFloorFire(ctx, pos, radius, duration, () => {
    fire.out = true;
  });
  const fire: EmberFire = { position: pos, radius, until: ctx.time.now + duration, out: false, feed };
  spawnScorch(ctx, pos, radius * 1.15, duration + 2);
  // 火舌：一簇跳动的火苗（自己管理，被吃掉时能提前熄灭）
  const tongues: { m: FlameTongue; base: number; phase: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const m = createFlameTongue();
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius * 0.75;
    m.position.set(pos.x + Math.cos(a) * r, pos.y + 0.02, pos.z + Math.sin(a) * r);
    m.scale.setScalar(0.01);
    ctx.stageGroup.add(m);
    tongues.push({ m, base: 0.55 * (0.6 + Math.random() * 0.6), phase: Math.random() * 10 });
  }
  const ring = GroundDecal.acquire(ctx.stageGroup, INFERNO.ember).circle(pos.x, pos.y + 0.02, pos.z, radius, radius * 0.55);
  ring.opacity = 0;
  let next = ctx.time.now + 0.25;
  let t = 0;
  let fade = -1;
  ctx.tasks.add((dt) => {
    t += dt;
    FLAME_FX_TIME.value = ctx.time.now;
    const left = fire.until - ctx.time.now;
    if ((fire.out || left <= 0) && fade < 0) fade = 0;
    if (fade >= 0) fade += dt;
    // 熄灭：0.25 秒内收小
    const k = fade >= 0 ? clamp01(1 - fade / 0.25) : Math.min(1, t / 0.2) * clamp01(left / 0.6 + 0.2);
    ring.time = t;
    ring.opacity = 0.55 * k * (fade >= 0 ? 0 : 1);
    for (const it of tongues) {
      const pulse = 0.75 + 0.35 * Math.sin(t * 9 + it.phase) + 0.15 * Math.sin(t * 23 + it.phase * 2);
      const sz = it.base * k;
      it.m.scale.set(Math.max(0.01, sz * 0.9), Math.max(0.01, sz * pulse * 1.4), Math.max(0.01, sz));
      it.m.material.uniforms.uAlpha.value = 0.9 * k;
    }
    const p = ctx.player;
    if (fade < 0 && p.alive && ctx.time.now >= next) {
      const dx = p.position.x - pos.x, dz = p.position.z - pos.z;
      if (dx * dx + dz * dz <= (radius + p.radius * 0.5) ** 2 && p.position.y - pos.y < 0.6 && p.position.y - pos.y > -0.6) {
        next = ctx.time.now + 0.5;
        ctx.combat.damagePlayer(tick, 'fire', null, pos);
      }
    }
    if ((fade >= 0.25) || !ring.mesh.parent) {
      fire.out = true;
      feed.remove();
      ring.release();
      for (const it of tongues) {
        it.m.removeFromParent();
        it.m.material.dispose();
      }
      return true;
    }
    return false;
  });
  return fire;
}

// ───────────── 瞄准细线（毕方「毕」） ─────────────

/** 喙尖到瞄准点的细光线：跟踪段淡金色、锁定后白热闪烁 */
export class AimLine {
  private beam: BeamMesh | null;

  constructor(ctx: GameContext) {
    this.beam = BeamMesh.acquire(ctx.stageGroup, INFERNO.warn, INFERNO.warnHot);
    this.beam.setOpacity(0);
  }

  /** k = 蓄力进度 0..1；locked = 方向已锁定 */
  update(from: THREE.Vector3, to: THREE.Vector3, k: number, locked: boolean, now: number): void {
    const b = this.beam;
    if (!b) return;
    b.set(from, to, locked ? 0.045 : 0.025 + 0.015 * k);
    b.setColor(locked ? INFERNO.warnHot : INFERNO.warn);
    b.setOpacity(locked ? 0.75 + 0.25 * Math.sin(now * 40) : 0.25 + 0.4 * k);
  }

  release(): void {
    this.beam?.release();
    this.beam = null;
  }
}

// ───────────── 火矛（毕方「方」） ─────────────

export interface FireSpearSpec {
  from: THREE.Vector3;
  /** 单位方向 */
  dir: THREE.Vector3;
  speed: number;
  range: number;
  /** 判定半径（米） */
  radius: number;
  damage: number;
  source: IEnemy | null;
  /** 点燃：时长、每跳伤害 */
  ignite: { duration: number; tick: number };
  /** 讹火：半径、时长、每跳伤害 */
  fire: { radius: number; duration: number; tick: number };
  /** 视觉粗细倍率（精英） */
  scale?: number;
}

let spearGeo: THREE.ConeGeometry | null = null;

/** 射出一支火矛：逐帧推进，先撞世界就留讹火，先碰到玩家就伤害 + 点燃。返回取消函数（只移除视觉，不会再判定） */
export function launchFireSpear(ctx: GameContext, s: FireSpearSpec): () => void {
  const pos = s.from.clone();
  const dir = s.dir.clone().normalize();
  const k = s.scale ?? 1;
  if (!spearGeo) spearGeo = new THREE.ConeGeometry(0.11, 1.3, 6, 1).rotateX(Math.PI / 2);
  // 矛身：白热的锥（尖朝前）+ 一道短拖尾光束
  const mat = new THREE.MeshBasicMaterial({ color: INFERNO.core, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(spearGeo, mat);
  mesh.scale.setScalar(k);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  ctx.stageGroup.add(mesh);
  const trail = BeamMesh.acquire(ctx.stageGroup, INFERNO.ember, INFERNO.hot);
  _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  mesh.quaternion.copy(_q);
  let travelled = 0;
  let done = false;
  let sparkAcc = 0;
  const end = (): void => {
    if (done) return;
    done = true;
    mesh.removeFromParent();
    mat.dispose();
    trail.release();
  };
  ctx.audio.play('skill_fire', { position: pos, volume: 0.85, pitch: 1.45 });
  ctx.tasks.add((dt) => {
    if (done) return true;
    if (!mesh.parent) {
      end();
      return true;
    }
    const step = Math.min(s.speed * dt, s.range - travelled);
    _b.copy(pos).addScaledVector(dir, step);
    const hit = ctx.world.raycast(pos, dir, step);
    const segEnd = hit ? _c.copy(pos).addScaledVector(dir, hit.distance) : _b;
    if (segmentHitsPlayer(ctx, pos, segEnd, s.radius) && ctx.player.invulnerableTime <= 0) {
      ctx.combat.damagePlayer(s.damage, 'fire', s.source, pos);
      ignitePlayer(ctx, s.ignite.duration, s.ignite.tick);
      ctx.player.applyImpulse(_d.set(dir.x * 2.4, 0, dir.z * 2.4));
      ctx.fx.burst(segEnd, INFERNO.hot, 16, 4, 0.45, 0.1, -2);
      end();
      return true;
    }
    if (hit) {
      spawnEmberFire(ctx, hit.point, hit.normal, s.fire.radius * k, s.fire.duration, s.fire.tick);
      ctx.audio.play('burn_tick', { position: hit.point, volume: 0.8, pitch: 0.8 });
      end();
      return true;
    }
    travelled += step;
    pos.copy(_b);
    mesh.position.copy(pos);
    _a.copy(pos).addScaledVector(dir, -Math.min(travelled, 2.6 * k));
    trail.set(_a, pos, 0.09 * k);
    trail.flicker(0.8 + 0.2 * Math.sin(ctx.time.now * 70));
    sparkAcc += dt;
    if (sparkAcc > 0.03) {
      sparkAcc = 0;
      ctx.fx.burst(pos, INFERNO.spark, 2, 1.2, 0.3, 0.06 * k, -2);
    }
    if (travelled >= s.range - 1e-6) {
      end();
      return true;
    }
    return false;
  });
  return end;
}

// ───────────── 勾魂索的铁链 ─────────────

let linkGeo: THREE.TorusGeometry | null = null;
let hookGeo: THREE.BufferGeometry | null = null;

function hookGeometry(): THREE.BufferGeometry {
  if (hookGeo) return hookGeo;
  // 钩头：一段 3/4 圆弧的粗钩 + 柄 + 两根倒刺，合成一个几何体（局部 +Z 为钩尖朝向）
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.TorusGeometry(0.13, 0.03, 5, 12, Math.PI * 1.35).rotateZ(-Math.PI * 0.4).rotateY(Math.PI / 2).translate(0, -0.02, 0.06));
  parts.push(new THREE.CylinderGeometry(0.028, 0.034, 0.26, 6).rotateX(Math.PI / 2).translate(0, 0.11, -0.08));
  parts.push(new THREE.ConeGeometry(0.035, 0.12, 4).rotateX(-Math.PI * 0.35).translate(0, 0.07, 0.17));
  parts.push(new THREE.ConeGeometry(0.03, 0.1, 4).rotateX(Math.PI * 0.75).translate(0, -0.16, 0.0));
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    const pa = g.attributes.position, na = g.attributes.normal;
    for (let i = 0; i < pa.count; i++) {
      pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      nrm.push(na.getX(i), na.getY(i), na.getZ(i));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  hookGeo = g;
  return g;
}

/** 铁链材质：底色冷铁；每个实例的颜色当作自发光（热度），不去染底色 */
function chainMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: INFERNO.iron, roughness: 0.55, metalness: 0.75 });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
        totalEmissiveRadiance += vColor * 1.6;
      #endif`);
  };
  m.customProgramCacheKey = () => 'inferno-chain';
  return m;
}

/**
 * 程序化铁链：count 个链环沿一组点（折线）等距排开，相邻两环绕链子方向错开 90°；heat(i) 给每环 0..1 的热度。
 * 钩头单独一个网格（挂在链尾，尖朝链子延伸方向）。所有对象挂在 parent（ctx.stageGroup）下，用 dispose 释放。
 */
export class ChainLinks {
  readonly links: THREE.InstancedMesh;
  readonly hook: THREE.Mesh;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly hookMat: THREE.MeshStandardMaterial;
  private readonly color = new THREE.Color();
  private readonly cold = new THREE.Color(0x000000);
  private readonly hotC = new THREE.Color(INFERNO.ironHot);
  /** 链环间距（米，乘体型） */
  readonly pitch: number;

  constructor(parent: THREE.Object3D, readonly count: number, private readonly size: number) {
    if (!linkGeo) linkGeo = new THREE.TorusGeometry(0.055, 0.016, 4, 8).scale(1, 1.55, 1);
    this.mat = chainMaterial();
    this.links = new THREE.InstancedMesh(linkGeo, this.mat, count);
    this.links.frustumCulled = false;
    this.links.castShadow = false;
    for (let i = 0; i < count; i++) this.links.setColorAt(i, this.cold);
    this.hookMat = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.45, metalness: 0.8, emissive: INFERNO.ironHot, emissiveIntensity: 0 });
    this.hook = new THREE.Mesh(hookGeometry(), this.hookMat);
    this.hook.scale.setScalar(size);
    this.hook.castShadow = false;
    this.pitch = 0.13 * size;
    parent.add(this.links, this.hook);
    this.visible = false;
  }

  set visible(v: boolean) {
    this.links.visible = v;
    this.hook.visible = v;
  }

  get visible(): boolean {
    return this.links.visible;
  }

  /**
   * 沿折线 pts（链根 → 钩头）摆放；链环数按长度截取（多余的隐藏）。heat(u) 给出链长比例 u（0 = 链根）处的热度。
   * 钩头放在折线末端，尖朝最后一段的方向。
   */
  layout(pts: readonly THREE.Vector3[], heat: (u: number) => number, hookHeat: number): void {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
    const n = Math.min(this.count, Math.max(1, Math.floor(total / this.pitch)));
    let seg = 1, segStart = 0, segLen = pts.length > 1 ? pts[1].distanceTo(pts[0]) : 0;
    for (let i = 0; i < this.count; i++) {
      if (i >= n || pts.length < 2) {
        _m.makeScale(0, 0, 0);
        this.links.setMatrixAt(i, _m);
        continue;
      }
      const d = (i + 0.5) * this.pitch;
      while (seg < pts.length - 1 && d > segStart + segLen) {
        segStart += segLen;
        seg++;
        segLen = pts[seg].distanceTo(pts[seg - 1]);
      }
      const f = segLen > 1e-6 ? clamp01((d - segStart) / segLen) : 0;
      _a.lerpVectors(pts[seg - 1], pts[seg], f);
      _b.subVectors(pts[seg], pts[seg - 1]);
      if (_b.lengthSq() < 1e-10) _b.set(0, 1, 0);
      _b.normalize();
      // 环的长轴（局部 Y）顺着链子；绕链子方向交替转 90°
      _q.setFromUnitVectors(UP, _b);
      if (i % 2 === 1) _q.multiply(Q90);
      _m.compose(_a, _q, _s.setScalar(this.size));
      this.links.setMatrixAt(i, _m);
      this.color.copy(this.cold).lerp(this.hotC, clamp01(heat(d / Math.max(1e-6, total))));
      this.links.setColorAt(i, this.color);
    }
    this.links.instanceMatrix.needsUpdate = true;
    if (this.links.instanceColor) this.links.instanceColor.needsUpdate = true;
    const last = pts[pts.length - 1];
    this.hook.position.copy(last);
    _b.subVectors(last, pts[Math.max(0, pts.length - 2)]);
    if (_b.lengthSq() > 1e-10) {
      _b.normalize();
      this.hook.quaternion.setFromUnitVectors(_d.set(0, 0, 1), _b);
    }
    this.hookMat.emissiveIntensity = 1.2 * clamp01(hookHeat);
  }

  dispose(): void {
    this.links.removeFromParent();
    this.hook.removeFromParent();
    this.links.dispose();
    this.mat.dispose();
    this.hookMat.dispose();
  }
}

/**
 * 断掉的链子：一串链环散落在地上，滚开一点再慢慢冷却、沉下去（duration 秒）。只负责外观。
 */
export function dropChain(ctx: GameContext, pts: readonly THREE.Vector3[], size: number, duration = 3): void {
  const chain = new ChainLinks(ctx.stageGroup, 36, size);
  chain.visible = true;
  const base = pts.map((p) => p.clone());
  const vel = base.map(() => new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2));
  const floor = base.map((p) => {
    const gy = ctx.world.groundHeight(p.x, p.z, p.y + 0.2);
    return Number.isFinite(gy) && p.y - gy < 6 ? gy + 0.03 : p.y - 1;
  });
  let t = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    for (let i = 0; i < base.length; i++) {
      const p = base[i], v = vel[i];
      v.y -= 22 * dt;
      p.addScaledVector(v, dt);
      if (p.y < floor[i]) {
        p.y = floor[i];
        v.set(v.x * 0.4, 0, v.z * 0.4);
      }
    }
    const cool = clamp01(1 - t / 1.2);
    const sink = Math.max(0, t - (duration - 0.6)) / 0.6;
    if (sink > 0) for (let i = 0; i < base.length; i++) base[i].y -= dt * 0.25;
    chain.layout(base, () => 0.8 * cool, 0.6 * cool);
    if (t >= duration || !chain.links.parent) {
      chain.dispose();
      return true;
    }
    return false;
  });
}

// ───────────── 射链子 ─────────────

/** 两条线段之间的最近点参数（s 在 ab 上，t 在 cd 上）与距离平方 */
function closestSegSeg(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): { s: number; t: number; d2: number } {
  const d1 = _a.subVectors(b, a), d2 = _b.subVectors(d, c), r = _c.subVectors(a, c);
  const aa = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (aa <= 1e-9 && e <= 1e-9) return { s: 0, t: 0, d2: r.lengthSq() };
  if (aa <= 1e-9) t = clamp01(f / e);
  else {
    const cc = d1.dot(r);
    if (e <= 1e-9) s = clamp01(-cc / aa);
    else {
      const bb = d1.dot(d2), den = aa * e - bb * bb;
      s = den > 1e-9 ? clamp01((bb * f - cc * e) / den) : 0;
      t = (bb * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-cc / aa); } else if (t > 1) { t = 1; s = clamp01((bb - cc) / aa); }
    }
  }
  const px = a.x + d1.x * s - (c.x + d2.x * t), py = a.y + d1.y * s - (c.y + d2.y * t), pz = a.z + d1.z * s - (c.z + d2.z * t);
  return { s, t, d2: px * px + py * py + pz * pz };
}

/**
 * 玩家这一枪（eye 沿 dir 的射线，射程 range）打到链子 root → tip 上 [skipRoot, 链长 − skipTip] 那一段的距离（沿射线，米）；
 * 没打到返回 -1。条件：射线到链段的最近距离 ≤ radius，且从枪口到那一点之间没有墙、也没有更近的敌人挡着。
 * 链根附近（腕铐、锁芯）和贴着玩家的一小段不算；调用方还要排除「其实是瞄着施放者本人」的情况（链子几乎顺着视线）。
 */
export function chainShotHits(
  ctx: GameContext, eye: THREE.Vector3, dir: THREE.Vector3, range: number,
  root: THREE.Vector3, tip: THREE.Vector3, radius: number, skipRoot: number, skipTip: number,
): number {
  const len = root.distanceTo(tip);
  if (len <= skipRoot + skipTip + 0.2) return -1;
  const r0 = new THREE.Vector3().lerpVectors(root, tip, skipRoot / len);
  const r1 = new THREE.Vector3().lerpVectors(root, tip, 1 - skipTip / len);
  const far = new THREE.Vector3().copy(eye).addScaledVector(dir, range);
  const res = closestSegSeg(eye, far, r0, r1);
  if (res.d2 > radius * radius) return -1;
  const along = res.s * range;
  if (along < 0.3) return -1;
  if (ctx.world.raycast(eye, dir, along)) return -1;
  const eh = ctx.enemies.raycast?.(eye, dir, along);
  if (eh && eh.distance < along - 0.15) return -1;
  return along;
}

/** 着色器时间（讹火火舌共用 FlameFx 的时钟）：敌人每帧写 ctx.time.now */
export function tickInfernoFx(now: number): void {
  FLAME_FX_TIME.value = now;
}
