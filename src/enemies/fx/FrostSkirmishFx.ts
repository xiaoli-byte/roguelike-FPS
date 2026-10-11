/**
 * 第二章「游击组」（三青鸟、冰河豚、冰棘豪彘）共用的贴合模型特效与小工具：
 *
 * - applyFrostGlow：在美术材质上按「贴图颜色 × 资产空间区域」叠加冰光（胸口霜晶、羽尖冰刃、刺根），
 *   不加任何外壳网格：发光的就是模型本身画好的那块冰。每层一个强度 uniform，由敌人按招式节奏驱动。
 * - 冻雾（冰河豚）：地面流动霜纹 + 几团缓慢翻滚的雾团；站在里面的玩家减速。减速由一个常驻任务统一结算
 *   （多团雾取最强、离开 / 雾散 / 换关后立刻撤销），不会因为换关清掉非常驻任务而把减速永远留在玩家身上。
 * - 冰刺新星的地面辐条预警、残刺阵（冰棘豪彘）。
 * - Spring：临界阻尼弹簧（尾羽、鳍的跟随）。
 * - 多球命中盒：鸟、野猪这种长条 / 展翼的身体，竖直胶囊包不住，改用挂在骨骼上的几颗球。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { clamp01, raySphere } from '../../core/math';
import { GroundDecal } from '../bosses/Visuals';

/** 冰光噪声的时间（每帧由敌人写入 ctx.time.now） */
export const FROST_FX_TIME = { value: 0 };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// ───────────────────────────── 冰光（材质扩展） ─────────────────────────────

export interface FrostGlowLayer {
  /** 发光颜色 */
  color: number;
  /** 只认这一段色相（0..1，中心与半宽），按 sRGB 贴图颜色判断；缺省不限 */
  hue?: readonly [number, number];
  /** 饱和度 / 明度下限（sRGB），缺省 0 */
  minSat?: number;
  minVal?: number;
  /** 饱和度上限（区分发白的冰与饱和的宝石），缺省 1 */
  maxSat?: number;
  /** 资产空间（米：x = 生物左侧，y = 上，z = 前）的软边盒；absX = 左右对称（只写 x ≥ 0 一侧） */
  box?: { min: readonly [number, number, number]; max: readonly [number, number, number]; soft?: number; absX?: boolean };
  /** 资产空间球（中心、半径），与 box 相乘 */
  sphere?: { center: readonly [number, number, number]; radius: number };
  /** 竖直衰减：y0 处全亮，到 y1 处熄灭（刺根亮、刺尖暗）；y1 < y0 也可以（反向） */
  fadeY?: readonly [number, number];
  /** 噪声闪烁幅度 0..1（冰里流动的光） */
  shimmer?: number;
}

export interface FrostGlowHandle {
  /** 每层的强度（0 = 不亮） */
  readonly strength: { value: number }[];
  readonly color: { value: THREE.Color }[];
}

const NOISE_GLSL = `
float fgHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fgNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fgHash(i), fgHash(i + vec3(1,0,0)), f.x), mix(fgHash(i + vec3(0,1,0)), fgHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fgHash(i + vec3(0,0,1)), fgHash(i + vec3(1,0,1)), f.x), mix(fgHash(i + vec3(0,1,1)), fgHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 fgHsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
`;

const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const v3 = (a: readonly number[]): string => `vec3(${a.map(f).join(', ')})`;

function layerGlsl(l: FrostGlowLayer, i: number): string {
  const lines: string[] = ['float m = 1.0;'];
  if (l.hue) {
    lines.push(`m *= 1.0 - smoothstep(${f(l.hue[1] * 0.6)}, ${f(l.hue[1])}, abs(fract(fgC.x - ${f(l.hue[0])} + 0.5) - 0.5));`);
  }
  if (l.minSat) lines.push(`m *= smoothstep(${f(l.minSat - 0.08)}, ${f(l.minSat + 0.08)}, fgC.y);`);
  if (l.maxSat !== undefined && l.maxSat < 1) lines.push(`m *= 1.0 - smoothstep(${f(l.maxSat - 0.08)}, ${f(l.maxSat + 0.08)}, fgC.y);`);
  if (l.minVal) lines.push(`m *= smoothstep(${f(l.minVal - 0.1)}, ${f(l.minVal + 0.1)}, fgC.z);`);
  if (l.box) {
    const s = f(l.box.soft ?? 0.05);
    lines.push(`{ vec3 p = vFrostPos; ${l.box.absX ? 'p.x = abs(p.x);' : ''}
      vec3 lo = ${v3(l.box.min)}; vec3 hi = ${v3(l.box.max)};
      vec3 a = smoothstep(lo - ${s}, lo + ${s}, p) * (1.0 - smoothstep(hi - ${s}, hi + ${s}, p));
      m *= a.x * a.y * a.z; }`);
  }
  if (l.sphere) {
    const r = l.sphere.radius;
    lines.push(`m *= 1.0 - smoothstep(${f(r * 0.7)}, ${f(r)}, distance(vFrostPos, ${v3(l.sphere.center)}));`);
  }
  if (l.fadeY) {
    const [y0, y1] = l.fadeY;
    lines.push(y1 >= y0
      ? `m *= 1.0 - smoothstep(${f(y0)}, ${f(y1)}, vFrostPos.y);`
      : `m *= smoothstep(${f(y1)}, ${f(y0)}, vFrostPos.y);`);
  }
  const sh = l.shimmer ?? 0.4;
  lines.push(`float n = fgNoise(vFrostPos * 9.0 + vec3(0.0, uFrostTime * 1.7, uFrostTime * 0.6));`);
  lines.push(`outgoingLight += uFgColor${i} * uFgStrength${i} * m * (${f(1 - sh)} + ${f(sh * 2)} * n);`);
  return `{ ${lines.join('\n')} }`;
}

/**
 * 在美术材质（已带 applyCharacterShading）上叠加若干层冰光。只在本材质上扩展着色器；
 * 同一组层配置共用一个程序（key 相同）。
 */
export function applyFrostGlow(material: THREE.MeshStandardMaterial, key: string, layers: readonly FrostGlowLayer[]): FrostGlowHandle {
  const strength = layers.map(() => ({ value: 0 }));
  const color = layers.map((l) => ({ value: new THREE.Color(l.color) }));
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.uFrostTime = FROST_FX_TIME;
    const decl: string[] = ['uniform float uFrostTime;', 'varying vec3 vFrostPos;'];
    layers.forEach((_, i) => {
      shader.uniforms[`uFgStrength${i}`] = strength[i];
      shader.uniforms[`uFgColor${i}`] = color[i];
      decl.push(`uniform float uFgStrength${i};`, `uniform vec3 uFgColor${i};`);
    });
    shader.vertexShader = 'varying vec3 vFrostPos;\n' + shader.vertexShader.replace(
      '#include <skinning_vertex>', '#include <skinning_vertex>\n  vFrostPos = transformed;');
    shader.fragmentShader = decl.join('\n') + '\n' + NOISE_GLSL + shader.fragmentShader.replace('#include <opaque_fragment>', `
      {
        vec3 fgC = fgHsv(pow(clamp(diffuseColor.rgb, 0.0, 1.0), vec3(1.0 / 2.2)));
        ${layers.map(layerGlsl).join('\n')}
      }
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `${prevKey}+frostglow:${key}`;
  material.needsUpdate = true;
  return { strength, color };
}

// ───────────────────────────── 弹簧 ─────────────────────────────

/** 临界阻尼（或欠阻尼）标量弹簧：x 追 target，k = 刚度，zeta = 阻尼比 */
export class Spring {
  x = 0;
  v = 0;
  constructor(private readonly k = 60, private readonly zeta = 0.7) {}

  step(target: number, dt: number): number {
    const h = Math.min(dt, 1 / 20);
    const n = Math.max(1, Math.ceil(h / (1 / 120)));
    const s = h / n;
    const c = 2 * this.zeta * Math.sqrt(this.k);
    for (let i = 0; i < n; i++) {
      this.v += (this.k * (target - this.x) - c * this.v) * s;
      this.x += this.v * s;
    }
    return this.x;
  }

  reset(x = 0): void {
    this.x = x;
    this.v = 0;
  }
}

// ───────────────────────────── 多球命中盒 ─────────────────────────────

/** 挂在骨骼 / 关节上的一颗命中球（anchor 的局部原点为球心，r 为模型单位半径） */
export interface HitSphere {
  anchor: THREE.Object3D;
  r: number;
  /** 命中算爆头（弱点） */
  head: boolean;
}

/**
 * 射线对一组命中球：取最近的一颗；弱点优先（只有身体球明显更近时才算身体），与 EnemyBase.raycastHit 的约定一致。
 * scale = 模型单位 → 世界的缩放（sizeScale）。
 */
export function raycastSpheres(
  spheres: readonly HitSphere[], scale: number, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number,
  out: { distance: number; headshot: boolean },
): boolean {
  let bestHead = -1, bestBody = -1, headR = 0;
  for (const s of spheres) {
    s.anchor.getWorldPosition(_v);
    const r = s.r * scale;
    const t = raySphere(origin, dir, _v, r);
    if (t < 0 || t > maxDist) continue;
    if (s.head) {
      if (bestHead < 0 || t < bestHead) { bestHead = t; headR = r; }
    } else if (bestBody < 0 || t < bestBody) bestBody = t;
  }
  if (bestHead < 0 && bestBody < 0) return false;
  if (bestHead >= 0 && (bestBody < 0 || bestBody >= bestHead - headR * 0.5)) {
    out.distance = bestHead;
    out.headshot = true;
  } else {
    out.distance = bestBody;
    out.headshot = false;
  }
  return true;
}

/** 在 parent 上挂一个命中锚点，位置给的是 host（模型根）空间坐标 */
export function hitAnchor(parent: THREE.Object3D, host: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const a = new THREE.Object3D();
  parent.add(a);
  host.updateWorldMatrix(true, true);
  a.position.copy(parent.worldToLocal(host.localToWorld(_w.set(x, y, z))));
  return a;
}

// ───────────────────────────── 冻雾（冰河豚） ─────────────────────────────

interface FogZone {
  ctx: GameContext;
  x: number;
  y: number;
  z: number;
  r: number;
  until: number;
  slow: number;
  /** 视觉还挂在场景里（换关时 stageGroup 被清空 → false） */
  alive: () => boolean;
}

const fogs: FogZone[] = [];
let fogTaskCtx: GameContext | null = null;
/** 冻雾减速的属性来源名（玩家 moveSpeed 修饰） */
export const FOG_SLOW_SOURCE = 'frost:fog';

let puffGeo: THREE.BufferGeometry | null = null;

/** 玩家当前是否站在某团冻雾里（测试与 UI 用） */
export function playerInFrostFog(ctx: GameContext): boolean {
  return ctx.player.stats.hasSource(FOG_SLOW_SOURCE);
}

function insideFog(ctx: GameContext, f: FogZone): boolean {
  const p = ctx.player;
  const dx = p.position.x - f.x, dz = p.position.z - f.z;
  if (dx * dx + dz * dz > (f.r + p.radius * 0.5) ** 2) return false;
  const dy = p.position.y - f.y;
  return dy > -1.2 && dy < 2.4;
}

/** 常驻任务：多团雾取最强减速，全部散掉后撤销并结束自己 */
function ensureFogTask(ctx: GameContext): void {
  if (fogTaskCtx === ctx) return;
  fogTaskCtx = ctx;
  let applied = 0;
  let frost = 0;
  ctx.tasks.add((dt) => {
    const p = ctx.player;
    const now = ctx.time.now;
    let want = 0;
    for (let i = fogs.length - 1; i >= 0; i--) {
      const fz = fogs[i];
      // 别的上下文（测试里重建的世界）留下的雾与本局无关，直接丢掉
      if (fz.ctx !== ctx || now >= fz.until || !fz.alive()) {
        fogs.splice(i, 1);
        continue;
      }
      if (p.alive && insideFog(ctx, fz)) want = Math.max(want, fz.slow);
    }
    if (want !== applied) {
      p.stats.removeSource(FOG_SLOW_SOURCE);
      if (want > 0) p.stats.add('moveSpeed', -want * p.stats.getBase('moveSpeed'), FOG_SLOW_SOURCE);
      applied = want;
    }
    if (applied > 0) {
      // 脚下结霜：被减速时脚边不断冒细小的冰晶
      frost += dt;
      if (frost > 0.2) {
        frost = 0;
        _v.set(p.position.x + (Math.random() - 0.5) * 0.6, p.position.y + 0.15, p.position.z + (Math.random() - 0.5) * 0.6);
        ctx.fx.burst(_v, 0xdff6ff, 2, 0.8, 0.5, 0.06, -1);
      }
    }
    if (fogs.length === 0) {
      p.stats.removeSource(FOG_SLOW_SOURCE);
      fogTaskCtx = null;
      return true;
    }
    return false;
  }, true);
}

/**
 * 冻雾：中心 center（世界坐标，雾团落在其下方地面上，悬空太高时就在原处），半径 radius，持续 duration 秒，
 * 玩家在里面移速 −slow（0..1，相对基础移速）。视觉挂在 stageGroup 上，换关自动移除。
 */
export function spawnFrostFog(ctx: GameContext, center: THREE.Vector3, radius: number, duration: number, slow: number): void {
  const gy = ctx.world.groundHeight(center.x, center.z, center.y + 0.5);
  const ground = Number.isFinite(gy) && center.y - gy < 3.2 ? gy : center.y - 0.8;
  const decal = GroundDecal.acquire(ctx.stageGroup, 0xbfeaff).circle(center.x, ground, center.z, radius);
  decal.pattern = 1;
  decal.opacity = 0;
  // 雾团：几团扁圆的半透明雾，贴地缓慢翻滚、向外扩散
  if (!puffGeo) puffGeo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xe6f7ff, transparent: true, opacity: 0, depthWrite: false, fog: true });
  const group = new THREE.Group();
  group.position.set(center.x, ground, center.z);
  ctx.stageGroup.add(group);
  const puffs: { m: THREE.Mesh; a: number; d: number; s: number; spin: number }[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(puffGeo, mat);
    m.renderOrder = 4;
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
    const d = i === 0 ? 0 : radius * (0.35 + Math.random() * 0.4);
    puffs.push({ m, a, d, s: radius * (0.42 + Math.random() * 0.18), spin: (Math.random() - 0.5) * 0.8 });
    group.add(m);
  }
  const zone: FogZone = {
    ctx, x: center.x, y: ground, z: center.z, r: radius, until: ctx.time.now + duration, slow,
    alive: () => decal.mesh.parent !== null,
  };
  fogs.push(zone);
  ensureFogTask(ctx);
  // 外观（非常驻：换关时随 stageGroup 一起消失）
  let t = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    const fin = t < 0.25 ? t / 0.25 : 1;
    const fout = Math.max(0, 1 - Math.max(0, t - (duration - 0.8)) / 0.8);
    const a = fin * fout;
    decal.time = t;
    decal.opacity = 0.75 * a;
    mat.opacity = 0.32 * a;
    for (const p of puffs) {
      const grow = 1 + 0.25 * clamp01(t / duration);
      p.a += p.spin * dt * 0.4;
      p.m.position.set(Math.cos(p.a) * p.d * grow, p.s * 0.45 + 0.08 * Math.sin(t * 1.3 + p.a * 3), Math.sin(p.a) * p.d * grow);
      p.m.scale.set(p.s * grow, p.s * 0.55 * grow, p.s * grow);
      p.m.rotation.y += p.spin * dt;
    }
    if (t >= duration || !group.parent) {
      decal.release();
      group.removeFromParent();
      mat.dispose();
      return true;
    }
    return false;
  });
}

// ───────────────────────────── 冰刺新星（冰棘豪彘） ─────────────────────────────

/** 冰刺新星的地面辐条预警：count 条从中心向外的细长条，蓄刺期间逐渐填满（缝隙就是安全的方向） */
export class NovaSpokes {
  private readonly decals: GroundDecal[] = [];

  constructor(ctx: GameContext, center: THREE.Vector3, count: number, yaw0: number, range: number, color = 0xb6a6ff) {
    const gy = ctx.world.groundHeight(center.x, center.z, center.y + 0.5);
    const y = Number.isFinite(gy) ? gy : center.y;
    for (let i = 0; i < count; i++) {
      const d = GroundDecal.acquire(ctx.stageGroup, color).rect(center.x, y, center.z, yaw0 + (i / count) * Math.PI * 2, range, 0.12);
      d.opacity = 0;
      this.decals.push(d);
    }
  }

  /** k = 蓄刺进度 0..1 */
  update(k: number): void {
    for (const d of this.decals) {
      d.opacity = 0.25 + 0.55 * k;
      d.fill = k;
    }
  }

  release(): void {
    for (const d of this.decals) d.release();
    this.decals.length = 0;
  }
}

let quillGeo: THREE.BufferGeometry | null = null;

/**
 * 残刺阵：爆点周围斜插一圈冰刺（inner..outer 米），duration 秒后沉下去消失。只负责外观，扎脚伤害由调用方结算。
 */
export function spawnQuillField(ctx: GameContext, ground: THREE.Vector3, inner: number, outer: number, count: number, duration: number): void {
  if (!quillGeo) quillGeo = new THREE.ConeGeometry(0.07, 0.62, 5).translate(0, 0.31, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xcfeeff, emissive: 0x6a7cff, emissiveIntensity: 0.5, roughness: 0.25, metalness: 0, transparent: true, opacity: 1, flatShading: true,
  });
  const group = new THREE.Group();
  group.position.copy(ground);
  ctx.stageGroup.add(group);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const d = inner + Math.random() * (outer - inner);
    const m = new THREE.Mesh(quillGeo, mat);
    m.position.set(Math.sin(a) * d, -0.08, Math.cos(a) * d);
    // 刺尖朝外斜插：先绕水平轴外倾 0.5–0.9 弧度，再朝向径向
    m.rotation.set(0.5 + Math.random() * 0.4, a, 0, 'YXZ');
    m.scale.setScalar(0.8 + Math.random() * 0.5);
    m.castShadow = true;
    group.add(m);
  }
  let t = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    const k = clamp01((t - (duration - 0.6)) / 0.6);
    group.position.y = ground.y - 0.4 * k;
    mat.opacity = 1 - k;
    mat.emissiveIntensity = 0.5 + 0.3 * Math.sin(t * 6);
    if (t >= duration || !group.parent) {
      group.removeFromParent();
      mat.dispose();
      return true;
    }
    return false;
  });
}

/** 冰块碎裂：大块冰屑 + 细霜 + 一圈地面冲击环 */
export function iceShatter(ctx: GameContext, center: THREE.Vector3, size: number, color = 0xcff2ff): void {
  ctx.fx.burst(center, color, 14, 5.5 * size, 0.7, 0.12 * size, 9);
  ctx.fx.burst(center, 0xffffff, 18, 3 * size, 0.9, 0.05 * size, 1.5);
  ctx.fx.burst(center, 0x9fe6ff, 6, 1.4 * size, 0.6, 0.45 * size, -0.5);
}
