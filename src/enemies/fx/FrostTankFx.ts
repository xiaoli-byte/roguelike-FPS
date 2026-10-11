/**
 * 第二章坦克（冰甲旋龟、玄冰巨蟹）的冰霜特效，贴合模型、跟着骨骼走：
 *
 * - createGlowDisc：加法混合的发光圆盘（外环 + 内核），挂在骨骼上当散热孔 / 鳃缝的辉光；实例材质由调用方释放。
 * - dropIcePatch：旋壳滑过的地面留下一块滑冰带（贴花 + 冰屑），持续 duration 秒；玩家踩在上面时移动打滑
 *   （沿当前水平速度追加一点惯性，同一帧多块冰面只推一次）。
 * - iceShards / frostVapour / iceCrack：碎冰、青紫霜气、落地冰裂（爆点、撞墙、碎钳、死亡）。
 *
 * 全部只用 ctx.fx / GroundDecal / ctx.tasks，挂到 ctx.stageGroup 的东西换关自动清理。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { GroundDecal } from '../bosses/Visuals';

export const FROST = {
  ice: 0xbfe8ff, iceDeep: 0x6fb8e8, snow: 0xf2f8ff, violet: 0xb08cff, cyan: 0x7ff6ff, aqua: 0x5fe8e0,
  shell: 0x4f8a7a, carapace: 0x2f4a6a, warn: 0x8fdcff, band: 0x9fe4ff, spike: 0xd8f2ff,
  /** 浅色冰面上用的实色预警（饱和的电光蓝，普通混合：GroundDecal.solid = true） */
  warnSolid: 0x0e86ff,
} as const;

const _p = new THREE.Vector3();
const _imp = new THREE.Vector3();

// ───────────── 发光圆盘 ─────────────

let discGeo: THREE.CircleGeometry | null = null;
let ringGeo: THREE.RingGeometry | null = null;

export interface GlowDisc {
  group: THREE.Group;
  /** 0..1：外环与内核同时变亮 */
  set(level: number): void;
  dispose(): void;
}

/**
 * 平放的发光圆盘（法线朝 +Y，半径 1，由调用方缩放）：内核实心，外环稍大。平时看不见（level 0），
 * 过热 / 蓄力时提亮。depthWrite 关闭、加法混合，不挡贴图。
 */
export function createGlowDisc(color: number, coreColor = 0xffffff): GlowDisc {
  discGeo ??= new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  ringGeo ??= new THREE.RingGeometry(0.8, 1.35, 24).rotateX(-Math.PI / 2);
  const mk = (c: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
    color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    side: THREE.DoubleSide,
  });
  const coreMat = mk(coreColor), ringMat = mk(color);
  const group = new THREE.Group();
  const core = new THREE.Mesh(discGeo, coreMat);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  core.renderOrder = ring.renderOrder = 4;
  core.castShadow = ring.castShadow = false;
  group.add(core, ring);
  return {
    group,
    set(level: number): void {
      const k = Math.max(0, Math.min(1.5, level));
      coreMat.opacity = Math.min(1, 0.85 * k);
      ringMat.opacity = Math.min(1, 0.6 * k);
      group.visible = k > 0.01;
      ring.scale.setScalar(1 + 0.12 * k);
    },
    dispose(): void {
      coreMat.dispose();
      ringMat.dispose();
    },
  };
}

// ───────────── 滑冰带 ─────────────

/** 同一帧多块冰面只推一次 */
let slipStamp = -1;
/** 打滑强度：每秒沿当前水平速度追加的比例（地面摩擦会把它吃掉一部分，剩下的就是滑出去的惯性） */
const SLIP = 5.5;
/** 单帧冲量上限（米/秒），防止低帧率时一下滑飞 */
const SLIP_MAX = 0.9;

/**
 * 地面滑冰带：一块圆形冰面贴花，duration 秒后淡出。玩家站在上面（贴地、高度差 < 0.6）时，
 * 沿当前水平速度追加一点惯性：急停会滑出去、转向会甩尾。不造成伤害。
 * @returns 冰面贴花（已由任务托管，调用方不必释放）
 */
export function dropIcePatch(ctx: GameContext, ground: THREE.Vector3, radius: number, duration: number): void {
  const decal = GroundDecal.acquire(ctx.stageGroup, FROST.band).circle(ground.x, ground.y, ground.z, radius);
  decal.pattern = 1;
  decal.soft = 0.35;
  const cx = ground.x, cy = ground.y, cz = ground.z;
  let t = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    decal.time = t;
    decal.opacity = (t < 0.12 ? t / 0.12 : Math.max(0, 1 - Math.max(0, t - (duration - 0.6)) / 0.6)) * 0.75;
    const pl = ctx.player;
    if (pl.alive && pl.onGround && t < duration - 0.3 && slipStamp !== ctx.time.now) {
      const dx = pl.position.x - cx, dz = pl.position.z - cz, dy = pl.position.y - cy;
      if (dx * dx + dz * dz < (radius + pl.radius * 0.5) ** 2 && dy > -0.6 && dy < 0.6) {
        slipStamp = ctx.time.now;
        _imp.set(pl.velocity.x, 0, pl.velocity.z).multiplyScalar(SLIP * dt);
        const len = _imp.length();
        if (len > SLIP_MAX) _imp.multiplyScalar(SLIP_MAX / len);
        if (len > 1e-3) pl.applyImpulse(_imp);
      }
    }
    if (t >= duration) {
      decal.release();
      return true;
    }
    return false;
  });
  // 刮起的冰屑
  ctx.fx.burst(_p.set(cx, cy + 0.1, cz), FROST.snow, 3, 2, 0.45, 0.14 * radius, 6);
}

// ───────────── 碎冰 / 霜气 / 冰裂 ─────────────

/** 一把碎冰（冰蓝、雪白、深冰三色），scale = 体型 */
export function iceShards(ctx: GameContext, at: THREE.Vector3, scale: number, count = 14, speed = 6): void {
  ctx.fx.burst(at, FROST.ice, count, speed, 0.9, 0.1 * scale, 16);
  ctx.fx.burst(at, FROST.snow, Math.ceil(count * 0.6), speed * 0.8, 0.7, 0.08 * scale, 14);
  ctx.fx.burst(at, FROST.iceDeep, Math.ceil(count * 0.4), speed * 0.9, 0.8, 0.12 * scale, 18);
}

/** 青紫霜气：慢慢往上飘的一团雾（gravity 为负 = 上飘） */
export function frostVapour(ctx: GameContext, at: THREE.Vector3, scale: number, count = 6, color: number = FROST.violet): void {
  ctx.fx.burst(at, color, count, 1.6, 0.9, 0.32 * scale, -2.4);
  ctx.fx.burst(at, FROST.snow, Math.ceil(count * 0.5), 1.0, 0.7, 0.24 * scale, -1.6);
}

/** 落地冰裂：一圈冰屑冲击环 + 短暂的冰面贴花（纯视觉） */
export function iceCrack(ctx: GameContext, ground: THREE.Vector3, radius: number, life = 1.4): void {
  ctx.fx.ring(ground, radius, FROST.ice, 0.35);
  ctx.fx.burst(_p.copy(ground).setY(ground.y + 0.15), FROST.snow, 10, 4, 0.6, 0.18, 8);
  const decal = GroundDecal.acquire(ctx.stageGroup, FROST.iceDeep).circle(ground.x, ground.y, ground.z, radius * 0.7);
  decal.pattern = 1;
  let t = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    decal.time = t;
    decal.opacity = Math.max(0, 1 - t / life) * 0.8;
    if (t >= life) {
      decal.release();
      return true;
    }
    return false;
  });
}
