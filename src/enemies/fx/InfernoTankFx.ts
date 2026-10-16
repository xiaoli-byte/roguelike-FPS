/**
 * 第三章坦克（熔炉铁牛、火鼍）的熔岩 / 铸铁特效，贴合模型、跟着骨骼走：
 *
 * - INFERNO：调色板。预警用实色的电光品红（GroundDecal.solid）：熔岩橙、玄武岩黑上都读得出来，
 *   橙红系的预警在熔岩旁边会被熔岩吃掉。
 * - createFurnaceCore：炉膛里白热的炉心（加法混合的圆盘 + 外晕，朝 +Z），开门 / 呛火时提亮；实例材质由调用方释放。
 * - hoofPrint：铁蹄留下的发红蹄印，1 秒内冷却。
 * - moltenArc：一团熔铁沿抛物线飞出去，落地溅开（纯视觉）。
 * - streak：一条细亮的气流线 / 火星从 from 飞到 to（鼓风吸气时朝嘴和炉门汇聚）。
 * - SlagWall：熔铁冷成的矮铁渣墙。碰撞体是 CollisionWorld 里的一排轴对齐盒（同狐巫冰壁的 addBox / remove），
 *   挡玩家、挡敌人、挡子弹和视线（导航网格按 world.version 自动重建）；6 秒后碎掉。和玩家 / 敌人重叠的那一段不加碰撞。
 * - fireSpot：地上一小片燃烧的火点（站在上面每 0.4 秒烫一下），鼍鸣溅起的熔岩用。
 * - basaltShards / moltenSplash / smokePuff / lavaBubbles：碎岩甲、熔岩飞溅、黑烟、熔岩鼓泡。
 *
 * 挂到 ctx.stageGroup 的东西换关自动清理；任务都由 ctx.tasks 托管。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import type { StaticBox } from '../../world/Collision';
import { GroundDecal } from '../bosses/Visuals';

export const INFERNO = {
  lava: 0xff6a1a, ember: 0xffa040, hot: 0xffe08a, white: 0xfff4d8, basalt: 0x2a2220, basaltLite: 0x4a3d36,
  smoke: 0x2e2828, iron: 0x35302c, slag: 0x3a2a22, crimson: 0xd8261a,
  /** 熔岩、玄武岩上都读得出来的实色预警（饱和的电光品红，普通混合：GroundDecal.solid = true） */
  warn: 0xff2bd6,
} as const;

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

// ───────────── 炉心 ─────────────

let coreGeo: THREE.CircleGeometry | null = null;
let haloGeo: THREE.RingGeometry | null = null;

export interface FurnaceCore {
  group: THREE.Group;
  /** 0..1.5：炉心与外晕一起变亮 */
  set(level: number): void;
  dispose(): void;
}

/** 立着的炉心（法线朝 +Z、半径 1，由调用方缩放）：白热的内核 + 橙色外晕，加法混合、不写深度 */
export function createFurnaceCore(): FurnaceCore {
  coreGeo ??= new THREE.CircleGeometry(1, 20);
  haloGeo ??= new THREE.RingGeometry(0.75, 1.5, 24);
  const mk = (c: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
    color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    side: THREE.DoubleSide,
  });
  const coreMat = mk(INFERNO.white), haloMat = mk(INFERNO.lava);
  const group = new THREE.Group();
  const core = new THREE.Mesh(coreGeo, coreMat);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  core.renderOrder = halo.renderOrder = 4;
  core.castShadow = halo.castShadow = false;
  halo.position.z = -0.02;
  group.add(core, halo);
  return {
    group,
    set(level: number): void {
      const k = Math.max(0, Math.min(1.5, level));
      coreMat.opacity = Math.min(1, 0.9 * k);
      haloMat.opacity = Math.min(1, 0.65 * k);
      group.visible = k > 0.01;
      halo.scale.setScalar(1 + 0.15 * k);
    },
    dispose(): void {
      coreMat.dispose();
      haloMat.dispose();
    },
  };
}

// ───────────── 蹄印 ─────────────

/** 铁蹄印：发红的一小块贴花，1 秒内冷却熄灭 */
export function hoofPrint(ctx: GameContext, ground: THREE.Vector3, radius: number, life = 1): void {
  const decal = GroundDecal.acquire(ctx.stageGroup, INFERNO.lava).circle(ground.x, ground.y, ground.z, radius);
  decal.pattern = 1;
  decal.soft = 0.2;
  let t = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    decal.time = t;
    decal.opacity = Math.max(0, 1 - t / life) * 0.9;
    if (t >= life) {
      decal.release();
      return true;
    }
    return false;
  });
  ctx.fx.burst(_p.set(ground.x, ground.y + 0.1, ground.z), INFERNO.smoke, 3, 1.4, 0.6, 0.22 * radius * 2, -1.2);
}

// ───────────── 熔铁飞溅 / 气流线 ─────────────

let blobGeo: THREE.IcosahedronGeometry | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;
let streakGeo: THREE.BoxGeometry | null = null;
const streakMats = new Map<number, THREE.MeshBasicMaterial>();

/** 一团熔铁从 from 沿抛物线（顶点高 arc 米）飞到 to，duration 秒；落地溅开 */
export function moltenArc(ctx: GameContext, from: THREE.Vector3, to: THREE.Vector3, duration: number, size = 0.22, arc = 2): void {
  blobGeo ??= new THREE.IcosahedronGeometry(1, 0);
  blobMat ??= new THREE.MeshBasicMaterial({ color: INFERNO.ember, toneMapped: false });
  const m = new THREE.Mesh(blobGeo, blobMat);
  m.scale.setScalar(size);
  m.castShadow = false;
  ctx.stageGroup.add(m);
  const a = from.clone(), b = to.clone();
  let t = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    const k = Math.min(1, t / duration);
    m.position.lerpVectors(a, b, k);
    m.position.y += Math.sin(k * Math.PI) * arc;
    m.rotation.x += dt * 9;
    if (k >= 1 || !m.parent) {
      m.removeFromParent();
      moltenSplash(ctx, b, size * 4);
      return true;
    }
    return false;
  });
}

/** 一条细亮的线从 from 飞到 to（吸气的气流、被吸进炉门的火星） */
export function streak(ctx: GameContext, from: THREE.Vector3, to: THREE.Vector3, color: number, life = 0.45, width = 0.04): void {
  streakGeo ??= new THREE.BoxGeometry(1, 1, 1);
  let mat = streakMats.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    streakMats.set(color, mat);
  }
  const m = new THREE.Mesh(streakGeo, mat);
  m.castShadow = false;
  m.renderOrder = 4;
  ctx.stageGroup.add(m);
  const a = from.clone(), b = to.clone();
  const len = Math.min(1.6, a.distanceTo(b) * 0.3);
  let t = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    const k = Math.min(1, t / life);
    const e = k * k;
    m.position.lerpVectors(a, b, e);
    _q.subVectors(b, a);
    m.lookAt(_p.copy(m.position).add(_q));
    m.scale.set(width, width, len * (1 - 0.6 * k));
    if (k >= 1 || !m.parent) {
      m.removeFromParent();
      return true;
    }
    return false;
  });
}

// ───────────── 铁渣墙 ─────────────

/** 铁渣墙：每段 0.7 米见方的碰撞盒、高 1.35 米；寿命 6 秒 */
export const SLAG = { seg: 0.7, height: 1.35, thick: 0.7, life: 6, cool: 1.5 } as const;

let slagGeo: THREE.BoxGeometry | null = null;
/** 场上的铁渣墙（测试 / 调试用） */
export const slagWalls = new Set<SlagWall>();

export class SlagWall {
  readonly boxes: StaticBox[] = [];
  readonly group = new THREE.Group();
  private readonly mat: THREE.MeshStandardMaterial;
  /** 底层铁渣：冷却后仍留一点余烬，上层冷成黑铁，整道墙不是一片平涂的红块 */
  private readonly ember: THREE.MeshStandardMaterial;
  private t = 0;
  private done = false;

  /**
   * 以 (x, y, z) 为中心、沿 yaw 的垂直方向（墙面朝 yaw）摆一道长 length 的矮墙。
   * 和玩家 / 地面敌人重叠的段、落在不可走格（熔岩、悬崖、墙里）上的段跳过。
   */
  constructor(private readonly ctx: GameContext, x: number, y: number, z: number, yaw: number, length: number) {
    slagGeo ??= new THREE.BoxGeometry(1, 1, 1);
    this.mat = new THREE.MeshStandardMaterial({
      color: INFERNO.iron, roughness: 0.82, metalness: 0.5, emissive: INFERNO.lava, emissiveIntensity: 2.4, flatShading: true,
    });
    this.ember = new THREE.MeshStandardMaterial({
      color: INFERNO.slag, roughness: 0.9, metalness: 0.35, emissive: INFERNO.lava, emissiveIntensity: 2.4, flatShading: true,
    });
    const n = Math.max(1, Math.round(length / SLAG.seg));
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const pl = ctx.player;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * SLAG.seg;
      const cx = x + rx * off, cz = z + rz * off;
      if (ctx.nav && !ctx.nav.isWalkable(cx, cz)) continue;
      const h = SLAG.height * (0.82 + 0.18 * Math.abs(Math.sin(i * 2.3 + x)));
      const hw = SLAG.seg / 2, ht = SLAG.thick / 2;
      const b = { minX: cx - Math.max(hw, ht), minZ: cz - Math.max(hw, ht), maxX: cx + Math.max(hw, ht), maxZ: cz + Math.max(hw, ht), minY: y, maxY: y + h };
      if (overlaps(b, pl.position, pl.radius, pl.height)) continue;
      let blocked = false;
      for (const e of ctx.enemies?.list ?? []) {
        if (!e.alive || e.flying) continue;
        if (overlaps(b, e.position, e.radius * 0.85, e.height)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      this.boxes.push(ctx.world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 'cover'));
      // 视觉：两三块歪斜的铁渣叠成一段
      for (let k = 0; k < 2; k++) {
        const m = new THREE.Mesh(slagGeo, k === 0 ? this.ember : this.mat);
        m.position.set(cx + (k - 0.5) * 0.12, y + h * (k === 0 ? 0.32 : 0.72), cz);
        m.scale.set(SLAG.seg * (1.05 - 0.2 * k), h * (k === 0 ? 0.64 : 0.5), SLAG.thick * (1.1 - 0.25 * k));
        m.rotation.set(0.12 * Math.sin(i + k), yaw + 0.25 * Math.sin(i * 1.7 + k), 0.1 * Math.cos(i * 1.3 + k));
        m.castShadow = true;
        this.group.add(m);
      }
    }
    ctx.stageGroup.add(this.group);
    slagWalls.add(this);
    _p.set(x, y + 0.2, z);
    ctx.fx.burst(_p, INFERNO.ember, 16, 4, 0.6, 0.12, 6);
    ctx.fx.burst(_p, INFERNO.smoke, 8, 1.5, 0.9, 0.35, -1.5);
    ctx.tasks.add((dt) => this.tick(dt));
  }

  get alive(): boolean {
    return !this.done;
  }

  private tick(dt: number): boolean {
    if (this.done) return true;
    this.t += dt;
    // 刚落地通红，1.5 秒冷成黑铁，最后半秒裂开发红
    const cool = Math.max(0, 1 - this.t / SLAG.cool);
    const crack = Math.max(0, (this.t - (SLAG.life - 0.6)) / 0.6);
    const flare = 2.3 * cool * cool + 1.2 * crack * (0.5 + 0.5 * Math.sin(this.t * 30));
    this.mat.emissiveIntensity = 0.015 + flare;
    this.ember.emissiveIntensity = 0.1 + flare;
    if (this.t >= SLAG.life) {
      this.shatter();
      return true;
    }
    return false;
  }

  /** 碎掉：碰撞盒移除，碎铁渣四散 */
  shatter(): void {
    if (this.done) return;
    this.done = true;
    for (const b of this.boxes) this.ctx.world.remove(b);
    this.boxes.length = 0;
    for (const c of this.group.children) {
      c.getWorldPosition(_p);
      this.ctx.fx.burst(_p, INFERNO.iron, 5, 4, 0.7, 0.14, 12);
    }
    this.ctx.fx.burst(_p, INFERNO.ember, 6, 3, 0.4, 0.08, 6);
    this.group.removeFromParent();
    this.mat.dispose();
    this.ember.dispose();
    slagWalls.delete(this);
  }
}

function overlaps(b: { minX: number; minZ: number; maxX: number; maxZ: number; minY: number; maxY: number }, feet: THREE.Vector3, r: number, h: number): boolean {
  return feet.x + r > b.minX && feet.x - r < b.maxX && feet.z + r > b.minZ && feet.z - r < b.maxZ && feet.y + h > b.minY && feet.y < b.maxY;
}

// ───────────── 火点 ─────────────

/** 地上一小片燃烧的火点：站在上面（贴地）每 0.4 秒受一次火伤 */
export function fireSpot(ctx: GameContext, ground: THREE.Vector3, radius: number, duration: number, damage: number): void {
  const decal = GroundDecal.acquire(ctx.stageGroup, INFERNO.lava).circle(ground.x, ground.y, ground.z, radius);
  decal.pattern = 1;
  const cx = ground.x, cy = ground.y, cz = ground.z;
  let t = 0, tick = 0.2;
  ctx.tasks.add((dt) => {
    t += dt;
    tick -= dt;
    decal.time = t;
    decal.opacity = (t < 0.15 ? t / 0.15 : Math.max(0, 1 - Math.max(0, t - (duration - 0.5)) / 0.5)) * 0.9;
    if (Math.random() < dt * 6) ctx.fx.burst(_p.set(cx + (Math.random() - 0.5) * radius, cy + 0.15, cz + (Math.random() - 0.5) * radius), INFERNO.ember, 2, 1.5, 0.5, 0.1, -3);
    const pl = ctx.player;
    if (tick <= 0) {
      tick = 0.4;
      const dx = pl.position.x - cx, dz = pl.position.z - cz, dy = pl.position.y - cy;
      if (pl.alive && dx * dx + dz * dz < radius * radius && dy > -0.5 && dy < 0.6) ctx.combat.damagePlayer(damage, 'fire', null, _p.set(cx, cy, cz));
    }
    if (t >= duration) {
      decal.release();
      return true;
    }
    return false;
  });
}

// ───────────── 碎岩 / 飞溅 / 黑烟 / 鼓泡 ─────────────

/** 碎玄武岩甲：黑岩块 + 熔岩火星，scale = 体型 */
export function basaltShards(ctx: GameContext, at: THREE.Vector3, scale: number, count = 14, speed = 6): void {
  ctx.fx.burst(at, INFERNO.basalt, count, speed, 0.9, 0.12 * scale, 16);
  ctx.fx.burst(at, INFERNO.basaltLite, Math.ceil(count * 0.5), speed * 0.8, 0.8, 0.09 * scale, 14);
  ctx.fx.burst(at, INFERNO.ember, Math.ceil(count * 0.7), speed * 1.1, 0.6, 0.06 * scale, 6);
}

/** 熔岩 / 熔铁飞溅 */
export function moltenSplash(ctx: GameContext, at: THREE.Vector3, scale: number, count = 10): void {
  ctx.fx.burst(at, INFERNO.lava, count, 4.5, 0.7, 0.1 * scale, 12);
  ctx.fx.burst(at, INFERNO.hot, Math.ceil(count * 0.5), 3.5, 0.45, 0.07 * scale, 10);
}

/** 黑烟：慢慢往上飘（gravity 为负 = 上飘） */
export function smokePuff(ctx: GameContext, at: THREE.Vector3, scale: number, count = 6): void {
  ctx.fx.burst(at, INFERNO.smoke, count, 1.4, 1.1, 0.35 * scale, -2);
  ctx.fx.burst(at, INFERNO.ember, Math.ceil(count * 0.4), 2, 0.5, 0.06 * scale, -3);
}

/** 熔岩鼓泡：一圈冒起来的熔岩泡 + 波纹 */
export function lavaBubbles(ctx: GameContext, at: THREE.Vector3, radius: number): void {
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
    _p.set(at.x + Math.sin(a) * r, at.y + 0.08, at.z + Math.cos(a) * r);
    ctx.fx.burst(_p, INFERNO.hot, 3, 2.2, 0.35, 0.16, 8);
  }
  ctx.fx.burst(_q.set(at.x, at.y + 0.1, at.z), INFERNO.lava, 6, 3, 0.5, 0.14, 10);
}
