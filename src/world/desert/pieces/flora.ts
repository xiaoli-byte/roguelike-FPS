import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createStylizedFoliage, createStylizedLit, type Rgba } from '../../UnityStylizedLit';
import type { BuiltPiece, LabPiece, PieceBox, PieceContext, Quat, V2, V3 } from './types';

/**
 * 第一章新做的植物件（程序化建模，白盒标了 needs 的两种）：
 *   白杨（新疆杨）：1-4 月泉阁两侧绿叶 ×23（11–13 m，树冠底约 3 m 人能从下面走，树冠给碰撞好挡旱魃的日晒射线），
 *                  1-A 南岸金叶 ×22（8–11 m 成林）。通直灰白干 + 菱形皮孔，柱状树冠由叶团堆成，风里轻摆。
 *   胡杨枯木：1-1 ×6、1-4 ×4。粗壮扭曲、深裂纹的灰褐干，三四根断头粗枝，无叶，4.5–6 m，天幕上要读得出剪影。
 *
 * 材质走游戏里 Unity 场景件同一条路：树干 / 枯木 = Spiritfire/StylizedLit（createStylizedLit，程序贴图 × 顶点色），
 * 树冠 = Spiritfire/Foliage（createStylizedFoliage：顶点色固有色、alpha = 摆动权重、逆光透光、着色器里的风）。
 * 一片林子一次建：每种几何几个变体（按 seed 挑），InstancedMesh 实例化，按高度缩放；材质全场共享（不随件释放）。
 */

// ───────────── 小工具（bones.ts 也用） ─────────────

const UP = new THREE.Vector3(0, 1, 0);

/** 可复现的随机数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 几个数揉成一个种子 */
export function hashSeed(...values: number[]): number {
  let h = 2166136261;
  for (const v of values) {
    h ^= Math.round(v * 1000) | 0;
    h = Math.imul(h, 16777619);
  }
  // 末尾再搅一遍（murmur3 fmix32）：输入都是 1000 的整数倍时低位恒定，seed % 变体数会全挑到同一个
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** sRGB 写的颜色 → 线性（顶点色按线性存） */
export function srgb(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
}

const _mix = new THREE.Color();
/** 线性空间插值（返回共享的临时色，用完即取值） */
export function mix(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return _mix.copy(a).lerp(b, clamp01(t));
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const v3 = (v: THREE.Vector3): V3 => [r3(v.x), r3(v.y), r3(v.z)];
const q4 = (q: THREE.Quaternion): Quat => [r3(q.x), r3(q.y), r3(q.z), r3(q.w)];

/** 世界坐标的线段 a→b 包成一个方截面的长盒（枝干碰撞） */
export function segmentBox(a: THREE.Vector3, b: THREE.Vector3, thick: number, name: string): PieceBox {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  return { center: v3(a.clone().add(b).multiplyScalar(0.5)), size: [r3(thick), r3(len), r3(thick)], rotation: q4(q), name };
}

/** 绕 y 转 yaw 的盒（中心、尺寸都是世界坐标） */
export function yawBox(center: THREE.Vector3, size: V3, yaw: number, name: string): PieceBox {
  return { center: v3(center), size: [r3(size[0]), r3(size[1]), r3(size[2])], rotation: q4(new THREE.Quaternion().setFromAxisAngle(UP, yaw)), name };
}

export function triangles(geometry: THREE.BufferGeometry): number {
  return Math.round((geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3);
}

/** 合并后释放零件 */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('[flora] 零件属性不一致，合并失败');
  for (const p of parts) p.dispose();
  return merged;
}

// ───────────── 管子：树干、枝、肋骨、长骨 ─────────────

export type TubeCap = 'none' | 'flat' | 'broken';

export interface TubeSpec {
  /** 中心线（≥ 2 点，向心 Catmull-Rom） */
  points: THREE.Vector3[];
  /** 半径（s = 沿长度 0..1） */
  radius(s: number): number;
  sides: number;
  segments: number;
  /** 截面形状：径向倍率（phi = 扭转后的绕圈角）——裂纹的沟脊、扁骨 */
  shape?(s: number, phi: number): number;
  /** 沟脊 / 贴图沿全长扭转的弧度 */
  twist?: number;
  /** 贴图：绕一圈 u 重复几次（整数，接缝才对得上）、每米 v 走多少 */
  uRepeat?: number;
  vPerMeter?: number;
  /** 顶点色（线性）：k = shape 的值 */
  color(s: number, phi: number, k: number, p: THREE.Vector3): THREE.Color;
  start?: TubeCap;
  end?: TubeCap;
  /** 断头参差的深度（米） */
  jag?: number;
  /** 断面颜色：rim = 茬口一圈，否则 = 断面中心 */
  capColor?(rim: boolean): THREE.Color;
  /** 截面的「上」：给了就用它定第一根法线（扁骨、扁肋要朝向确定），否则按 Frenet 框架 */
  up?: THREE.Vector3;
  rand?: () => number;
}

/** 管子几何（position / normal / uv / color3，带索引）；端头可封平口或断茬 */
export function tube(spec: TubeSpec): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(spec.points, false, 'centripetal');
  const { sides, segments } = spec;
  const frames = curve.computeFrenetFrames(segments, false);
  if (spec.up) {
    // 用固定的「上」重算框架：法线 = up 在截面里的投影
    for (let i = 0; i <= segments; i++) {
      const T = frames.tangents[i];
      const N = spec.up.clone().addScaledVector(T, -spec.up.dot(T));
      if (N.lengthSq() < 1e-6) N.set(1, 0, 0).addScaledVector(T, -T.x);
      N.normalize();
      frames.normals[i].copy(N);
      frames.binormals[i].crossVectors(T, N).normalize();
    }
  }
  const length = curve.getLength();
  const rand = spec.rand ?? Math.random;
  const twist = spec.twist ?? 0, uRepeat = spec.uRepeat ?? 1, vPerMeter = spec.vPerMeter ?? 0.5;
  const jag = spec.jag ?? 0;
  const broken = spec.end === 'broken' && jag > 0;
  // 断头：末圈每个点往回缩一截，少数几根茬子留得长
  const teeth: number[] = [];
  for (let j = 0; j < sides; j++) teeth.push(jag * (1 - Math.pow(rand(), 2.4)));
  teeth.push(teeth[0]);
  const pos: number[] = [], uv: number[] = [], col: number[] = [], index: number[] = [];
  const c = new THREE.Vector3(), d = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    curve.getPointAt(s, c);
    const N = frames.normals[i], B = frames.binormals[i], T = frames.tangents[i];
    const last = i === segments;
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const phi = a - twist * s;
      const k = spec.shape ? spec.shape(s, phi) : 1;
      d.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      p.copy(c).addScaledVector(d, spec.radius(s) * k * (broken && last ? 0.88 : 1));
      if (broken && last) p.addScaledVector(T, -teeth[j]);
      pos.push(p.x, p.y, p.z);
      uv.push((phi / (Math.PI * 2)) * uRepeat, s * length * vPerMeter);
      const cc = spec.color(s, phi, k, p);
      col.push(cc.r, cc.g, cc.b);
    }
  }
  const row = sides + 1;
  for (let i = 0; i < segments; i++) for (let j = 0; j < sides; j++) {
    const a = i * row + j, b = a + row;
    index.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // 接缝两列法线取平均（u 接缝处顶点是重复的）
  const n = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i <= segments; i++) {
    const a = i * row, b = a + sides;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  const parts = [geo];
  const ring = (i: number) => Array.from({ length: sides }, (_, j) => new THREE.Vector3().fromArray(pos, (i * row + j) * 3));
  const capColor = spec.capColor ?? (() => spec.color(1, 0, 1, c).clone());
  if (spec.end && spec.end !== 'none') {
    const center = curve.getPointAt(1).addScaledVector(frames.tangents[segments], broken ? -jag * 0.95 : 0);
    parts.push(capGeometry(ring(segments), center, true, capColor(true), capColor(false)));
  }
  if (spec.start && spec.start !== 'none') {
    parts.push(capGeometry(ring(0), curve.getPointAt(0), false, capColor(true), capColor(false)));
  }
  return parts.length === 1 ? geo : mergeParts(parts);
}

/** 端头的扇面：outward = 朝管子末端方向 */
function capGeometry(ring: THREE.Vector3[], center: THREE.Vector3, outward: boolean, rim: THREE.Color, mid: THREE.Color): THREE.BufferGeometry {
  const pos = [center.x, center.y, center.z], col = [mid.r, mid.g, mid.b], uv = [0.5, 0.5];
  for (const q of ring) {
    pos.push(q.x, q.y, q.z);
    col.push(rim.r, rim.g, rim.b);
    uv.push(0.5, 0);
  }
  const index: number[] = [];
  for (let j = 0; j < ring.length; j++) {
    const a = 1 + j, b = 1 + ((j + 1) % ring.length);
    if (outward) index.push(0, a, b); else index.push(0, b, a);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 椭球块（骨节、盆骨、肩胛……）：经纬球按 radii 拉伸、quaternion 转、移到 center；顶点色按回调（d = 单位球上的方向）。
 * 和 tube 一样出 position / normal / uv / color3 + 索引，能直接合并。
 */
export function ellipsoid(center: THREE.Vector3, radii: V3, rotation: THREE.Quaternion, widthSegments: number, heightSegments: number,
  color: (d: THREE.Vector3, p: THREE.Vector3) => THREE.Color, warp?: (d: THREE.Vector3) => number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  const P = geo.getAttribute('position') as THREE.BufferAttribute;
  const N = geo.getAttribute('normal') as THREE.BufferAttribute;
  const col: number[] = [];
  const d = new THREE.Vector3(), p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    d.fromBufferAttribute(P, i);
    const w = warp ? warp(d) : 1;
    p.set(d.x * radii[0] * w, d.y * radii[1] * w, d.z * radii[2] * w).applyQuaternion(rotation).add(center);
    n.set(d.x / radii[0], d.y / radii[1], d.z / radii[2]).normalize().applyQuaternion(rotation);
    P.setXYZ(i, p.x, p.y, p.z);
    N.setXYZ(i, n.x, n.y, n.z);
    const c = color(d, p);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

// ───────────── 材质（全场共享，和 Unity 场景件同一套风格化光照） ─────────────

const litSources = new Map<string, THREE.MeshStandardMaterial>();

/**
 * 程序件的 StylizedLit：源材质按 Unity 导出的格式写 userData（_BaseColor 白、金属 0），走 createStylizedLit，
 * 再打开顶点色（createStylizedLit 默认关掉；程序件的固有色 = 贴图 × 顶点色）。同 key 只建一次。
 */
export function proceduralLit(key: string, make: () => { map?: THREE.Texture; floats?: Record<string, number>; colors?: Record<string, Rgba> },
  environment?: PieceContext['environment']): THREE.MeshStandardMaterial {
  let source = litSources.get(key);
  if (!source) {
    const o = make();
    source = new THREE.MeshStandardMaterial({ name: key, map: o.map ?? null });
    source.userData = {
      unityShader: 'Spiritfire/StylizedLit',
      unityFloats: { _Metallic: 0, _Roughness: 1, _SpecStrength: 0, ...(o.floats ?? {}) },
      unityColors: { _BaseColor: [1, 1, 1, 1], ...(o.colors ?? {}) },
    };
    litSources.set(key, source);
  }
  const material = createStylizedLit(source, environment);
  material.vertexColors = true;
  return material;
}

let foliageSource: THREE.MeshStandardMaterial | null = null;

/** 树冠：Spiritfire/Foliage（顶点色 rgb = 叶色，a = 摆动权重；风、逆光透光都在着色器里） */
function foliageMaterial(environment?: PieceContext['environment']): THREE.MeshStandardMaterial {
  if (!foliageSource) {
    foliageSource = new THREE.MeshStandardMaterial({ name: 'M_Proc_PoplarLeaves' });
    foliageSource.userData = {
      unityShader: 'Spiritfire/Foliage',
      // 白杨叶柄扁、风一吹就颤：枝梢摆幅比缺省大一点，细颤也大一点；整棵摆还是慢
      unityFloats: { _WindStrength: 0.42, _WindSpeed: 1.15, _Flutter: 0.05, _Translucency: 0.5 },
      unityColors: { _BaseColor: [1, 1, 1, 1], _TranslucencyColor: [1, 0.86, 0.48, 1], _ShadowTint: [0.6, 0.66, 0.84, 1] },
    };
  }
  return createStylizedFoliage(foliageSource, environment);
}

/** 画一张能四方连续的贴图：每个形状在 3×3 个错位上各画一次 */
function tileCanvas(width: number, height: number, draw: (g: CanvasRenderingContext2D, wrap: (fn: (dx: number, dy: number) => void) => void) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  draw(g, fn => { for (const dx of [-width, 0, width]) for (const dy of [-height, 0, height]) fn(dx, dy); });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/**
 * 新疆杨树皮：浅暖灰底 + 横宽的深色菱形皮孔（白杨最认得出的特征），零散的横向短皮孔线。
 * 只用干净的几何形，不铺噪点（用户：贴图不要斑驳、不要糊）。u 绕干一圈、v 每 3 m 一张。
 */
function poplarBarkTexture(): THREE.CanvasTexture {
  return tileCanvas(256, 512, (g, wrap) => {
    g.fillStyle = '#dedad0';
    g.fillRect(0, 0, 256, 512);
    const rand = rng(4021);
    // 两条很宽很淡的竖向色带：树皮光泽的起伏
    for (let k = 0; k < 2; k++) {
      const x = rand() * 256, w = 50 + rand() * 50;
      wrap((dx) => {
        const grad = g.createLinearGradient(x + dx - w, 0, x + dx + w, 0);
        grad.addColorStop(0, 'rgba(120,112,98,0)');
        grad.addColorStop(0.5, 'rgba(120,112,98,0.10)');
        grad.addColorStop(1, 'rgba(120,112,98,0)');
        g.fillStyle = grad;
        g.fillRect(x + dx - w, 0, w * 2, 512);
      });
    }
    // 横向短皮孔线
    g.fillStyle = 'rgba(128,120,106,0.75)';
    for (let k = 0; k < 60; k++) {
      const x = rand() * 256, y = rand() * 512, len = 5 + rand() * 12;
      wrap((dx, dy) => g.fillRect(x + dx - len / 2, y + dy, len, 1.6));
    }
    // 菱形皮孔：宽是高的 2.5–3.5 倍，大的少、小的多
    for (let k = 0; k < 48; k++) {
      const x = rand() * 256, y = rand() * 512, w = 9 + Math.pow(rand(), 2) * 30, h = w * (0.28 + rand() * 0.1);
      wrap((dx, dy) => {
        g.fillStyle = '#56514a';
        g.beginPath();
        g.moveTo(x + dx - w / 2, y + dy);
        g.quadraticCurveTo(x + dx - w * 0.1, y + dy - h * 0.62, x + dx, y + dy - h / 2);
        g.quadraticCurveTo(x + dx + w * 0.1, y + dy - h * 0.62, x + dx + w / 2, y + dy);
        g.quadraticCurveTo(x + dx + w * 0.1, y + dy + h * 0.62, x + dx, y + dy + h / 2);
        g.quadraticCurveTo(x + dx - w * 0.1, y + dy + h * 0.62, x + dx - w / 2, y + dy);
        g.fill();
        // 下沿一道浅边：皮孔是凹进去的
        g.strokeStyle = 'rgba(250,246,236,0.55)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x + dx - w * 0.42, y + dy + h * 0.2);
        g.quadraticCurveTo(x + dx, y + dy + h * 0.75, x + dx + w * 0.42, y + dy + h * 0.2);
        g.stroke();
      });
    }
  });
}

/**
 * 胡杨枯木：近白的底 + 长条竖向深裂（两头收尖、略带波），裂纹一侧一道亮棱。颜色主要靠顶点色（沟深脊浅），
 * 这张图只补几何分不出来的细裂。u 绕一圈、v 每 2.2 m 一张。
 */
function deadwoodTexture(): THREE.CanvasTexture {
  return tileCanvas(256, 512, (g, wrap) => {
    g.fillStyle = '#efebe4';
    g.fillRect(0, 0, 256, 512);
    const rand = rng(911);
    for (let k = 0; k < 13; k++) {
      const x0 = rand() * 256, y0 = rand() * 512, len = 160 + rand() * 330, w = 2.2 + rand() * 4.2;
      const amp = 2 + rand() * 6, freq = (0.6 + rand() * 1.4) * Math.PI * 2 / 512, ph = rand() * 6.28;
      const steps = 28;
      const L: [number, number][] = [], R: [number, number][] = [], E: [number, number][] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, y = y0 + t * len, x = x0 + Math.sin(y * freq + ph) * amp;
        const half = (w / 2) * Math.pow(Math.sin(Math.PI * t), 0.55);
        L.push([x - half, y]);
        R.push([x + half, y]);
        E.push([x + half + 1.4, y]);
      }
      wrap((dx, dy) => {
        g.fillStyle = '#5e5045';
        g.beginPath();
        g.moveTo(L[0][0] + dx, L[0][1] + dy);
        for (const [x, y] of L) g.lineTo(x + dx, y + dy);
        for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0] + dx, R[i][1] + dy);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.6)';
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(E[2][0] + dx, E[2][1] + dy);
        for (let i = 3; i < E.length - 2; i++) g.lineTo(E[i][0] + dx, E[i][1] + dy);
        g.stroke();
      });
    }
  });
}

function poplarBarkMaterial(environment?: PieceContext['environment']): THREE.MeshStandardMaterial {
  return proceduralLit('M_Proc_PoplarBark', () => ({
    map: poplarBarkTexture(),
    // 暗部冷色收一点：灰白干在阴面不能发紫
    floats: { _RimStrength: 0.3 },
    colors: { _ShadowTint: [0.66, 0.68, 0.8, 1] },
  }), environment);
}

function deadwoodMaterial(environment?: PieceContext['environment']): THREE.MeshStandardMaterial {
  return proceduralLit('M_Proc_Deadwood', () => ({
    map: deadwoodTexture(),
    floats: { _RimStrength: 0.4 },
    colors: { _ShadowTint: [0.66, 0.66, 0.8, 1] },
  }), environment);
}

// ───────────── 白杨 ─────────────

export type PoplarTint = 'green' | 'gold';

export interface PoplarTree {
  at: V2;
  /** 树根高度；缺省 ctx.ground */
  y?: number;
  /** 树高（米） */
  height: number;
  /** 挑变体、朝向、色差；缺省按序号和位置算 */
  seed?: number;
  /** 度，俯视逆时针；缺省随机 */
  yaw?: number;
  /** green = 1-4 夏季黄绿（带点银白），gold = 1-A 秋季金叶 */
  tint?: PoplarTint;
}

/** 变体按 12 m 树高建：树冠底 3 m、最宽处半径 1.6 m（白盒 canopy 半径 1.7） */
const POPLAR_H = 12;
const POPLAR_CB = 3;
const POPLAR_R = 1.55;
const POPLAR_VARIANTS = 4;
/** 干在树冠里长到多高（建模高度） */
const POPLAR_TRUNK_TOP = 9.4;

/** 树冠轮廓：底部收圆、中段直上直下（柱状，不是塔松的三角）、上三成收成圆尖（t = 树冠内的相对高度 0..1） */
function poplarProfile(t: number): number {
  if (t < 0.2) return 0.55 + 0.45 * Math.sin((t / 0.2) * Math.PI / 2);
  if (t < 0.5) return 1;
  return 1 - 0.88 * Math.pow((t - 0.5) / 0.5, 1.8);
}

const POPLAR_PALETTE: Record<PoplarTint, { deep: THREE.Color; mid: THREE.Color; light: THREE.Color; alt: THREE.Color }> = {
  // 夏季新疆杨：黄绿，叶背白——少数叶团偏银灰绿
  green: { deep: srgb(0.13, 0.22, 0.1), mid: srgb(0.32, 0.45, 0.15), light: srgb(0.55, 0.65, 0.24), alt: srgb(0.45, 0.54, 0.4) },
  // 秋季金叶：暗部橙褐、亮部明黄；少数叶团偏橙
  gold: { deep: srgb(0.4, 0.19, 0.05), mid: srgb(0.76, 0.46, 0.09), light: srgb(0.94, 0.71, 0.22), alt: srgb(0.8, 0.36, 0.07) },
};

interface Clump {
  c: THREE.Vector3; r: number; ey: number; alt: boolean; shade: number; ph: [number, number, number];
  /** 所属的大团（枝簇）：中心、半径——法线 / 明暗按大团走，树冠先读出几大块，再读小团 */
  m: THREE.Vector3; mr: number;
}

/**
 * 树冠叶团的摆法（同一变体两种叶色共用一套）：大 → 中 → 小三级。
 * 先沿树冠分层摆七八个「枝簇」大团（偏向外侧、方位错开），每个大团再由几个小团拼成；中轴补几团实心的免得透空。
 * 不用等大的叶团按螺旋均匀排——那样读成玉米棒 / 松果。
 */
function poplarClumps(rand: () => number, low: boolean): Clump[] {
  const CH = POPLAR_H - POPLAR_CB;
  const clumps: Clump[] = [];
  const add = (c: THREE.Vector3, r: number, ey: number, m: THREE.Vector3, mr: number, shade: number, alt: boolean) => clumps.push({
    c, r, ey, alt, shade, ph: [rand() * 6.28, rand() * 6.28, rand() * 6.28], m, mr,
  });
  const masses = low ? 6 : 8, per = low ? 3 : 4;
  for (let i = 0; i < masses; i++) {
    const t = (i + 0.2 + rand() * 0.6) / masses;
    const pr = poplarProfile(t) * POPLAR_R;
    const mr = pr * (0.55 + rand() * 0.15) + 0.12;
    const az = i * 2.2 + rand() * 0.9;
    const off = Math.max(0, pr - mr * 0.8);
    const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const y = Math.max(POPLAR_CB + t * (CH - 1.1) + 0.2, POPLAR_CB + mr * 1.15);
    const m = out.clone().multiplyScalar(off).setY(y);
    const shade = rand() * 2 - 1, alt = rand() < 0.25;
    for (let k = 0; k < per; k++) {
      // 小团偏向大团朝外、朝上的一面
      const dir = new THREE.Vector3(rand() - 0.5, rand() * 1.2 - 0.45, rand() - 0.5).addScaledVector(out, 0.55).normalize();
      const r = mr * (0.46 + rand() * 0.2) * (low ? 1.15 : 1);
      add(m.clone().addScaledVector(dir, mr * 0.45), r, 1.2 + rand() * 0.3, m, mr, shade * 0.7 + (rand() - 0.5) * 0.6, alt);
    }
  }
  // 中轴实心：从下到上几团，大团之间不透天
  const core = low ? 3 : 4;
  for (let k = 0; k < core; k++) {
    const t = (k + 0.5) / core * 0.9;
    const r = poplarProfile(t) * POPLAR_R * 0.62;
    const m = new THREE.Vector3(0, Math.max(POPLAR_CB + t * CH, POPLAR_CB + r * 1.5), 0);
    add(m.clone(), r, 1.5, m, r, -0.6, false);
  }
  // 树冠底：几团贴着干收口，抬头看是合上的
  const base = new THREE.Vector3(0, POPLAR_CB + 0.55, 0);
  for (let k = 0; k < (low ? 2 : 3); k++) {
    const ang = k * 2.1 + rand();
    add(new THREE.Vector3(Math.cos(ang) * 0.35, POPLAR_CB + 0.5, Math.sin(ang) * 0.35), 0.42, 1.2, base, 0.8, -0.8, false);
  }
  // 树梢：细长的一团收尖
  const tip = new THREE.Vector3((rand() - 0.5) * 0.15, POPLAR_H - 0.85, (rand() - 0.5) * 0.15);
  add(tip, 0.3, 2.6, tip.clone(), 0.5, 0.6, false);
  return clumps;
}

/** 树冠几何：叶团（二十面体细分一次）拼起来，法线一半按叶团一半按整个树冠的椭球（读成一整个柱状体积，又有团块） */
function poplarCrown(clumps: Clump[], tint: PoplarTint): THREE.BufferGeometry {
  const pal = POPLAR_PALETTE[tint];
  const CH = POPLAR_H - POPLAR_CB;
  const yMid = POPLAR_CB + CH * 0.4, A = CH * 0.58, R2 = POPLAR_R * POPLAR_R;
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const P = ico.getAttribute('position');
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const d = new THREE.Vector3(), p = new THREE.Vector3(), nc = new THREE.Vector3(), nk = new THREE.Vector3(), nm = new THREE.Vector3(), n = new THREE.Vector3();
  const c = new THREE.Color();
  const q = new THREE.Vector3();
  for (const k of clumps) {
    for (let i = 0; i < P.count; i++) {
      d.fromBufferAttribute(P, i);
      // 团块边缘起伏（只取方向的函数：重复顶点位移一致，不裂缝）；幅度小，轮廓圆润不揉皱
      const lump = 1 + 0.1 * (Math.sin(d.x * 4.4 + k.ph[0]) + Math.sin(d.y * 3.6 + k.ph[1]) + Math.sin(d.z * 4.6 + k.ph[2])) / 1.6;
      p.set(d.x * k.r * lump, d.y * k.r * k.ey * lump, d.z * k.r * lump).add(k.c);
      nk.set(d.x, d.y / k.ey, d.z).normalize();
      nm.copy(p).sub(k.m).multiplyScalar(1 / k.mr);
      nm.y /= 1.3;
      nm.normalize();
      nc.set(p.x / R2, (p.y - yMid) / (A * A), p.z / R2).normalize();
      // 法线：小团 0.4 + 大团 0.35 + 整冠 0.25——三级体积都读得出
      n.copy(nk).multiplyScalar(0.4).addScaledVector(nm, 0.35).addScaledVector(nc, 0.25).normalize();
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      // 颜色：朝外、靠外、靠上的亮，树冠里面、底下的暗
      const h = clamp01((p.y - POPLAR_CB) / CH);
      const radial = clamp01(Math.hypot(p.x, p.z) / (poplarProfile(h) * POPLAR_R + 0.2));
      const outward = nm.dot(nc) * 0.35 + nk.dot(nc) * 0.15 + 0.5;
      // 团与团相交的缝里压暗：顶点离别的叶团表面越近越暗（风格化的 AO，团块才分得开）
      let crevice = 0;
      for (const o of clumps) {
        if (o === k) continue;
        q.copy(p).sub(o.c);
        const e = Math.hypot(q.x / o.r, q.y / (o.r * o.ey), q.z / o.r);
        crevice += smooth(1.4, 0.95, e);
      }
      const occ = clamp01(0.5 * outward + 0.28 * radial + 0.3 * h - 0.04 + k.shade * 0.08 - 0.3 * Math.min(1, crevice));
      if (occ < 0.5) c.copy(pal.deep).lerp(pal.mid, occ / 0.5); else c.copy(pal.mid).lerp(pal.light, (occ - 0.5) / 0.5);
      if (k.alt) c.lerp(pal.alt, 0.45 * smooth(0.25, 0.8, occ));
      // 摆动权重：树冠底几乎不动，越往上越摆
      const sway = 0.04 + 0.96 * Math.pow(h, 1.25);
      col.push(c.r, c.g, c.b, sway);
    }
  }
  ico.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  return geo;
}

const BARK_BASE = srgb(0.5, 0.47, 0.43);
const BARK_TOP = srgb(0.86, 0.85, 0.82);
const WHITE = new THREE.Color(1, 1, 1);

/** 白杨的干 + 树冠里斜向上的枝（新疆杨的枝几乎贴着干往上长，树冠才是柱状） */
function poplarTrunk(rand: () => number, low: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const lean = new THREE.Vector2((rand() - 0.5) * 0.35, (rand() - 0.5) * 0.35);
  const wob = new THREE.Vector2((rand() - 0.5) * 0.12, (rand() - 0.5) * 0.12);
  const top = POPLAR_TRUNK_TOP;
  const axis = (y: number) => {
    const f = clamp01(y / top);
    return new THREE.Vector3(lean.x * Math.pow(f, 1.5) + wob.x * Math.sin(f * Math.PI), y, lean.y * Math.pow(f, 1.5) + wob.y * Math.sin(f * Math.PI));
  };
  const radiusAt = (y: number) => 0.235 * (1 - 0.78 * Math.pow(clamp01(y / top), 1.1)) + 0.075 * Math.exp(-Math.max(0, y) / 0.32);
  // 干：根部发暗（老皮），往上是干净的灰白
  const c = new THREE.Color();
  const barkColor = (y: number) => {
    c.copy(BARK_BASE).lerp(WHITE, smooth(0.15, 1.7, y));
    // 树冠里背光，压一点
    return c.lerp(BARK_TOP, smooth(4, 8, y));
  };
  const y0 = -0.4;
  parts.push(tube({
    points: [0, 0.2, 0.25, 0.5, 0.75, 1].map(f => axis(y0 + f * (top - y0))),
    radius: s => radiusAt(y0 + s * (top - y0)),
    sides: low ? 6 : 9, segments: low ? 8 : 14,
    shape: (_s, phi) => 1 + 0.035 * Math.cos(2 * phi + 0.6),
    uRepeat: 1, vPerMeter: 1 / 3,
    color: (_s, _phi, _k, p) => barkColor(p.y),
    end: 'flat', rand,
  }));
  // 枝：树冠里斜向上，长度往上递减
  const branches = low ? 4 : 7;
  for (let b = 0; b < branches; b++) {
    const y = 3.4 + (b / branches) * 4.6 + rand() * 0.4;
    // 枝藏在树冠里：只从叶团缝里露一点，不能戳出轮廓
    const az = b * 2.4 + rand() * 0.8, el = THREE.MathUtils.degToRad(62 + rand() * 14);
    const len = (0.8 + (1 - (y - 3) / 6) * 0.9) * (0.8 + rand() * 0.3);
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const start = axis(y);
    const r0 = Math.max(0.035, radiusAt(y) * 0.42);
    parts.push(tube({
      points: [start, start.clone().addScaledVector(dir, len * 0.5), start.clone().addScaledVector(dir, len).add(new THREE.Vector3(0, len * 0.12, 0))],
      radius: s => r0 * (1 - 0.7 * s),
      sides: low ? 4 : 5, segments: low ? 2 : 3,
      uRepeat: 1, vPerMeter: 1 / 3,
      color: (_s, _phi, _k, p) => barkColor(p.y),
      rand,
    }));
  }
  return mergeParts(parts);
}

interface PoplarVariant {
  trunk: THREE.BufferGeometry;
  clumps: Clump[];
  crowns: Partial<Record<PoplarTint, THREE.BufferGeometry>>;
}

function poplarVariant(v: number, low: boolean): PoplarVariant {
  const rand = rng(hashSeed(1301, v));
  return { trunk: poplarTrunk(rand, low), clumps: poplarClumps(rand, low), crowns: {} };
}

/**
 * 一片白杨（实例化）。树冠底 = min(3, 0.27 × 树高)：11 m 以上的树冠底都在 3 m 左右，人能从下面走。
 * 碰撞：每棵一根干（约 0.5 m 见方，地面到树冠底）+ 树冠两个盒（下段宽、上段窄，从树冠底往上），
 * 树冠盒挡子弹，也挡旱魃的日晒射线（树冠下面算阴凉）；名字 poplar-trunk / poplar-crown 好区分。
 */
export function buildPoplars(trees: PoplarTree[], ctx: PieceContext): BuiltPiece {
  const group = new THREE.Group();
  group.name = 'Poplars';
  const colliders: PieceBox[] = [];
  const variants: PoplarVariant[] = [];
  const getVariant = (v: number) => (variants[v] ??= poplarVariant(v, ctx.low));
  const trunkBuckets = new Map<number, THREE.Matrix4[]>();
  const crownBuckets = new Map<string, { v: number; tint: PoplarTint; items: { m: THREE.Matrix4; shade: THREE.Color }[] }>();
  trees.forEach((tree, i) => {
    const [x, z] = tree.at;
    const seed = tree.seed ?? hashSeed(i, x, z);
    const rand = rng(seed ^ 0x5bd1e995);
    const v = seed % POPLAR_VARIANTS;
    const tint = tree.tint ?? 'green';
    const y = tree.y ?? ctx.ground(x, z);
    const H = Math.max(5, tree.height);
    const yaw = THREE.MathUtils.degToRad(tree.yaw ?? rand() * 360);
    const cb = Math.min(POPLAR_CB, 0.27 * H);
    const sy = (H - cb) / (POPLAR_H - POPLAR_CB);
    const sxz = 0.7 + 0.3 * (H / POPLAR_H);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const trunkM = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sxz, cb / POPLAR_CB, sxz));
    const crownM = new THREE.Matrix4().compose(new THREE.Vector3(x, y + cb - POPLAR_CB * sy, z), q, new THREE.Vector3(sxz, sy, sxz));
    if (!trunkBuckets.has(v)) trunkBuckets.set(v, []);
    trunkBuckets.get(v)!.push(trunkM);
    const key = `${v}|${tint}`;
    if (!crownBuckets.has(key)) crownBuckets.set(key, { v, tint, items: [] });
    // 每棵一点明暗 / 冷暖差，林子不像复印的
    const k = 0.92 + rand() * 0.14, warm = (rand() - 0.5) * 0.06;
    crownBuckets.get(key)!.items.push({ m: crownM, shade: new THREE.Color(k * (1 + warm), k, k * (1 - warm)) });
    // 碰撞
    const trunkW = 0.5 * sxz, trunkTop = cb + 0.4;
    colliders.push(yawBox(new THREE.Vector3(x, y + (trunkTop - 0.3) / 2, z), [trunkW, trunkTop + 0.3, trunkW], yaw, 'poplar-trunk'));
    const R = POPLAR_R * sxz, CH = H - cb;
    const lowBottom = y + cb + 0.3, lowTop = y + cb + 0.55 * CH, highTop = y + cb + 0.86 * CH;
    colliders.push(yawBox(new THREE.Vector3(x, (lowBottom + lowTop) / 2, z), [1.56 * R, lowTop - lowBottom, 1.56 * R], yaw, 'poplar-crown'));
    colliders.push(yawBox(new THREE.Vector3(x, (lowTop + highTop) / 2, z), [1.0 * R, highTop - lowTop, 1.0 * R], yaw, 'poplar-crown'));
  });
  const bark = poplarBarkMaterial(ctx.environment);
  const leaves = foliageMaterial(ctx.environment);
  const meshes: THREE.InstancedMesh[] = [];
  const stats: Record<string, number> = {};
  for (const [v, list] of trunkBuckets) {
    const geo = getVariant(v).trunk;
    const mesh = new THREE.InstancedMesh(geo, bark, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.name = `PoplarTrunk_${v}`;
    meshes.push(mesh);
    stats[`trunk${v}`] = triangles(geo);
  }
  for (const { v, tint, items } of crownBuckets.values()) {
    const variant = getVariant(v);
    const geo = (variant.crowns[tint] ??= poplarCrown(variant.clumps, tint));
    const mesh = new THREE.InstancedMesh(geo, leaves, items.length);
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      mesh.setColorAt(i, it.shade);
    });
    mesh.name = `PoplarCrown_${v}_${tint}`;
    meshes.push(mesh);
    stats[`crown${v}`] = triangles(geo);
  }
  for (const mesh of meshes) {
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  group.userData.triangles = stats;
  return {
    object: group,
    colliders,
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      for (const v of variants) {
        if (!v) continue;
        v.trunk.dispose();
        for (const g of Object.values(v.crowns)) g?.dispose();
      }
    },
  };
}

// ───────────── 胡杨枯木 ─────────────

export interface DeadPoplarTree {
  at: V2;
  y?: number;
  /** 树高（米），整棵按比例缩放 */
  height: number;
  seed?: number;
  yaw?: number;
}

const DEAD_VARIANTS = 4;
const DW_RIDGE = srgb(0.55, 0.53, 0.49);
const DW_GROOVE = srgb(0.21, 0.18, 0.16);
const DW_BLEACH = srgb(0.71, 0.7, 0.67);
const DW_SAND = srgb(0.7, 0.58, 0.43);
const DW_CUT = srgb(0.8, 0.71, 0.58);
const DW_HOLLOW = srgb(0.2, 0.15, 0.12);

/** 深裂纹的截面：宽平的脊、窄深的沟（N 条，绕圈略带扭曲）；返回 shape 函数和「脊度」 */
function fissure(N: number, amp: number, ph: [number, number]) {
  const shape = (s: number, phi: number) => {
    const w = (phi * N) / 2 + 0.6 * Math.sin(phi * 2 + ph[0]) + 0.35 * Math.sin(phi * 3 + ph[1] + s * 5);
    return 1 - amp * (1 - Math.pow(Math.abs(Math.cos(w)), 0.45));
  };
  const ridge = (k: number) => clamp01((k - 1 + amp) / amp);
  return { shape, ridge };
}

function deadwoodColor(ridge: number, y: number): THREE.Color {
  const c = mix(DW_GROOVE, DW_RIDGE, Math.pow(ridge, 0.7));
  // 高处晒得更白，贴地沾沙
  c.lerp(DW_BLEACH, smooth(1.5, 5.5, y) * 0.4 * ridge);
  return c.lerp(DW_SAND, smooth(0.45, 0, y) * 0.55);
}

const deadCap = (rim: boolean) => (rim ? DW_CUT : DW_HOLLOW).clone();

interface DeadVariant { geo: THREE.BufferGeometry; top: number; boxes: { a: THREE.Vector3; b: THREE.Vector3; thick: number; name: string }[] }

/** 一棵胡杨枯木：扭的粗干（顶上折断）+ 三四根断头粗枝 + 细枝 + 几条半埋的板根 */
function deadPoplarVariant(v: number, low: boolean): DeadVariant {
  const rand = rng(hashSeed(7717, v));
  const parts: THREE.BufferGeometry[] = [];
  const boxes: DeadVariant['boxes'] = [];
  const fork = 1.7 + rand() * 0.6;
  const leanAz = rand() * Math.PI * 2, lean = 0.3 + rand() * 0.35;
  const L = new THREE.Vector3(Math.cos(leanAz), 0, Math.sin(leanAz));
  const S = new THREE.Vector3(-L.z, 0, L.x);
  const bend = (rand() - 0.5) * 0.5;
  const topY = fork + 0.6 + rand() * 0.7;
  const axis = (y: number) => {
    const f = clamp01(y / topY);
    return new THREE.Vector3().addScaledVector(L, lean * Math.pow(f, 1.3)).addScaledVector(S, bend * Math.sin(Math.PI * f)).setY(y);
  };
  const y0 = -0.5;
  const trunkPts = [y0, 0.35, fork * 0.45, fork * 0.85, topY].map(axis);
  const trunkCurve = new THREE.CatmullRomCurve3(trunkPts, false, 'centripetal');
  // 胡杨老干粗而矮：建模高约 5.5 m 时干径接近 1 m
  const R0 = 0.44 + rand() * 0.08;
  const trunkR = (s: number) => {
    const y = y0 + s * (topY - y0);
    return R0 * (1 - 0.3 * s) + 0.26 * Math.exp(-Math.max(0, y) / 0.45);
  };
  const tf = fissure(6, 0.17, [rand() * 6.28, rand() * 6.28]);
  const twist = (rand() < 0.5 ? 1 : -1) * (1.2 + rand() * 0.8);
  parts.push(tube({
    points: trunkPts, radius: trunkR, sides: low ? 14 : 22, segments: low ? 9 : 15,
    shape: tf.shape, twist, uRepeat: 2, vPerMeter: 1 / 2.2,
    color: (_s, _phi, k, p) => deadwoodColor(tf.ridge(k), p.y),
    end: 'broken', jag: 0.55 + rand() * 0.3, capColor: deadCap, rand,
  }));
  boxes.push({ a: axis(0), b: trunkCurve.getPointAt(0.8), thick: R0 * 2 * 0.95, name: 'deadpoplar-trunk' });

  // 主枝：三四根，一根陡（领头）、其余斜出，每段拐一下，末端折断
  const n = rand() < 0.5 ? 3 : 4;
  const az0 = rand() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const sAt = 0.55 + rand() * 0.3;
    const base = trunkCurve.getPointAt(sAt);
    const rBase = trunkR(sAt) * (0.6 + rand() * 0.15);
    const az = az0 + (k * Math.PI * 2) / n + (rand() - 0.5) * 0.7;
    // 一根陡的领头枝，其余斜着往外伸（胡杨的冠是摊开的，不是往上收的）
    const el = k === 0 ? 0.85 + rand() * 0.3 : 0.18 + rand() * 0.45;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const len = (k === 0 ? 2.1 : 1.7) + rand() * 1.0;
    const pts = [base.clone().addScaledVector(dir, -rBase * 0.8), base.clone()];
    const p = base.clone();
    const steps = 4;
    for (let st = 1; st <= steps; st++) {
      // 每段拐个肘：随机偏一下，再拉回「往外 + 往上」
      dir.add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.95))
        .addScaledVector(out, 0.2)
        .add(new THREE.Vector3(0, k === 0 ? 0.2 : 0.1 + rand() * 0.15, 0)).normalize();
      p.addScaledVector(dir, len / steps);
      pts.push(p.clone());
    }
    const bf = fissure(4, 0.12, [rand() * 6.28, rand() * 6.28]);
    const radius = (s: number) => rBase * (1 - 0.42 * s) + rBase * 0.3 * Math.pow(1 - s, 8);
    parts.push(tube({
      points: pts, radius, sides: low ? 7 : 10, segments: low ? 6 : 11,
      shape: bf.shape, twist: 0.9, uRepeat: 1, vPerMeter: 0.45,
      color: (_s, _phi, kk, q) => deadwoodColor(bf.ridge(kk), q.y),
      end: 'broken', jag: rBase * 1.3, capColor: deadCap, rand,
    }));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const mid = curve.getPointAt(0.55);
    if (Math.min(base.y, mid.y) < 2.6) boxes.push({ a: base.clone(), b: mid, thick: rBase * 1.8, name: 'deadpoplar-branch' });
    // 细枝：一到三根，一半是尖梢一半也断了
    const twigs = 1 + Math.floor(rand() * 2.4);
    for (let t = 0; t < twigs; t++) {
      const sT = 0.3 + rand() * 0.5;
      const at = curve.getPointAt(sT), tan = curve.getTangentAt(sT);
      const d2 = new THREE.Vector3(rand() - 0.5, 0.25 + rand() * 0.5, rand() - 0.5).normalize().addScaledVector(tan, 0.7).normalize();
      const l2 = 0.5 + rand() * 0.8, r2 = radius(sT) * 0.48;
      const kink = new THREE.Vector3(rand() - 0.5, rand() * 0.3, rand() - 0.5).multiplyScalar(l2 * 0.35);
      const snapped = rand() < 0.5;
      parts.push(tube({
        points: [at.clone().addScaledVector(d2, -r2 * 0.6), at.clone().addScaledVector(d2, l2 * 0.5), at.clone().addScaledVector(d2, l2).add(kink)],
        radius: s => r2 * (1 - (snapped ? 0.45 : 0.85) * s), sides: low ? 4 : 6, segments: low ? 3 : 5,
        uRepeat: 1, vPerMeter: 0.45,
        color: (_s, phi, _k, q) => deadwoodColor(0.55 + 0.35 * Math.cos(phi * 2), q.y),
        end: snapped ? 'broken' : 'none', jag: r2 * 1.6, capColor: deadCap, rand,
      }));
    }
  }

  // 干上一两个断茬
  const stubs = 1 + Math.floor(rand() * 2);
  for (let k = 0; k < stubs; k++) {
    const y = 0.9 + rand() * (fork - 1.2);
    const az = rand() * Math.PI * 2, el = 0.1 + rand() * 0.35;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const start = axis(y), r = 0.1 + rand() * 0.05, len = trunkR(0.3) + 0.25 + rand() * 0.25;
    parts.push(tube({
      points: [start, start.clone().addScaledVector(dir, len)],
      radius: s => r * (1 - 0.25 * s), sides: low ? 5 : 7, segments: 3,
      uRepeat: 1, vPerMeter: 0.45,
      color: (_s, phi, _k, q) => deadwoodColor(0.5 + 0.4 * Math.cos(phi * 3), q.y),
      end: 'broken', jag: r * 1.2, capColor: deadCap, rand,
    }));
  }

  // 根：三四条拱起的粗根（像指节）从干脚往外往下扎进沙里
  const roots = 3 + Math.floor(rand() * 2);
  const ra0 = rand() * Math.PI * 2;
  for (let k = 0; k < roots; k++) {
    const a = ra0 + (k * Math.PI * 2) / roots + (rand() - 0.5) * 0.6;
    const o = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const reach = 0.95 + rand() * 0.45, rr = (0.2 + rand() * 0.06) * (R0 / 0.44);
    const base = axis(0.6);
    const pts = [
      base.clone().addScaledVector(o, 0.1),
      base.clone().addScaledVector(o, reach * 0.45).setY(0.26),
      base.clone().addScaledVector(o, reach * 0.8).setY(0.02),
      base.clone().addScaledVector(o, reach).setY(-0.35),
    ];
    const rf = fissure(3, 0.1, [rand() * 6.28, rand() * 6.28]);
    parts.push(tube({
      points: pts, radius: s => rr * (1 - 0.7 * s), sides: low ? 5 : 8, segments: low ? 4 : 6,
      shape: rf.shape, uRepeat: 1, vPerMeter: 0.45,
      color: (_s, _phi, kk, q) => deadwoodColor(rf.ridge(kk), q.y),
      rand,
    }));
  }
  const geo = mergeParts(parts);
  geo.computeBoundingBox();
  return { geo, top: geo.boundingBox!.max.y, boxes };
}

/**
 * 胡杨枯木（实例化，四个变体按 seed 挑），整棵按 height / 变体高缩放。
 * 碰撞：顺着干的斜盒（地面到分叉上方）+ 低于 2.6 m 的主枝各一根斜盒（人能撞上的那几根）。
 */
export function buildDeadPoplars(trees: DeadPoplarTree[], ctx: PieceContext): BuiltPiece {
  const group = new THREE.Group();
  group.name = 'DeadPoplars';
  const colliders: PieceBox[] = [];
  const variants: DeadVariant[] = [];
  const getVariant = (v: number) => (variants[v] ??= deadPoplarVariant(v, ctx.low));
  const buckets = new Map<number, THREE.Matrix4[]>();
  trees.forEach((tree, i) => {
    const [x, z] = tree.at;
    const seed = tree.seed ?? hashSeed(i, x, z, 3);
    const rand = rng(seed ^ 0x27d4eb2f);
    const v = seed % DEAD_VARIANTS;
    const variant = getVariant(v);
    const y = tree.y ?? ctx.ground(x, z);
    const s = Math.max(2, tree.height) / variant.top;
    const yaw = THREE.MathUtils.degToRad(tree.yaw ?? rand() * 360);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(s, s, s));
    if (!buckets.has(v)) buckets.set(v, []);
    buckets.get(v)!.push(m);
    for (const b of variant.boxes) colliders.push(segmentBox(b.a.clone().applyMatrix4(m), b.b.clone().applyMatrix4(m), b.thick * s, b.name));
  });
  const material = deadwoodMaterial(ctx.environment);
  const meshes: THREE.InstancedMesh[] = [];
  const stats: Record<string, number> = {};
  for (const [v, list] of buckets) {
    const geo = getVariant(v).geo;
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.name = `DeadPoplar_${v}`;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
    group.add(mesh);
    stats[`dead${v}`] = triangles(geo);
  }
  group.userData.triangles = stats;
  return {
    object: group,
    colliders,
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      for (const v of variants) v?.geo.dispose();
    },
  };
}

// ───────────── 检视页 ─────────────

const referenceMaterials = new WeakMap<THREE.Material, THREE.Material>();

/**
 * 检视页对色用：把一件现成的沙漠资产（public/assets/props/<名>.glb）按游戏里同一套风格化光照摆进来
 * （同 props.ts 的 stylizedFor：PBR 材质反推成 StylizedLit 参数）。
 */
export async function labReference(name: string, at: V3, rotDeg: number, scale: number, ctx: PieceContext): Promise<THREE.Object3D> {
  const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/DRACOLoader.js'),
  ]);
  const draco = new DRACOLoader();
  try {
    const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(`${import.meta.env.BASE_URL}assets/props/${name}.glb`);
    const root = gltf.scene;
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = true;
      const source = mesh.material as THREE.MeshStandardMaterial;
      let next = referenceMaterials.get(source);
      if (!next) {
        const proxy = source.clone();
        const s = source.color.clone().convertLinearToSRGB();
        proxy.userData = {
          unityShader: 'Spiritfire/StylizedLit',
          unityFloats: {
            ...(source.normalMap ? { _Metallic: 1, _Roughness: Math.min(1, source.roughness / 0.86) } : { _Metallic: source.metalness, _Roughness: source.roughness }),
            _Cull: [2, 1, 0][source.side] ?? 2, _OcclusionStrength: source.aoMap ? 0 : 1,
          },
          unityColors: { _BaseColor: [s.r, s.g, s.b, source.opacity] },
        };
        next = createStylizedLit(proxy, ctx.environment);
        referenceMaterials.set(source, next);
      }
      mesh.material = next;
    });
    root.position.set(...at);
    root.rotation.y = THREE.MathUtils.degToRad(rotDeg);
    root.scale.setScalar(scale);
    root.name = `ref:${name}`;
    return root;
  } finally {
    draco.dispose();
  }
}

/** 检视页条目：件 + 对色资产拼成一件 */
export async function labCombine(piece: BuiltPiece, refs: Promise<THREE.Object3D>[]): Promise<BuiltPiece> {
  const group = new THREE.Group();
  group.add(piece.object);
  const loaded = await Promise.all(refs.map(r => r.catch(e => { console.warn('[flora] 对色资产没加载上', e); return null; })));
  for (const o of loaded) if (o) group.add(o);
  console.info('[flora] 三角形', piece.object.userData.triangles ?? {});
  return {
    object: group,
    colliders: piece.colliders,
    update: piece.update,
    dispose() {
      piece.dispose();
      for (const o of loaded) o?.traverse(m => { if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).geometry.dispose(); });
    },
  };
}

/** 1-4 月泉阁旁那种双排（绿）+ 1-A 南岸那种成片（金） */
const GROVE_GREEN: PoplarTree[] = [
  [-17, -3, 12.5], [-13.6, -4.2, 11.4], [-10.4, -2.6, 12.8], [-7.2, -4, 11.8], [-4, -2.8, 12.2],
  [-15.4, 1.2, 11.6], [-12, 0.4, 12.9], [-8.6, 1.6, 11.2], [-5.4, 0.6, 12.4],
].map(([x, z, h]) => ({ at: [x, z] as V2, height: h, tint: 'green' as const }));
const GROVE_GOLD: PoplarTree[] = [
  [4, -5, 9.6], [7.2, -6.4, 10.8], [10.6, -4.6, 8.4], [13.4, -6, 10.2], [16.2, -3.6, 9.2],
  [5.8, -1.8, 8.8], [9, -0.6, 10.4], [12.4, -1.4, 9], [15.4, 0.4, 8.2], [7.4, 2.6, 9.8], [11.2, 2.8, 8.6],
].map(([x, z, h]) => ({ at: [x, z] as V2, height: h, tint: 'gold' as const }));

export const LAB: LabPiece[] = [
  {
    id: 'poplar-grove',
    title: '白杨林',
    note: '左：1-4 月泉阁两侧的绿叶白杨（11–13 m，树冠底 3 m 人能走过，树冠有碰撞挡日晒）；右：1-A 南岸金叶白杨（8–11 m）。前面摆红柳、商队残骸对色',
    build: ctx => labCombine(buildPoplars([...GROVE_GREEN, ...GROVE_GOLD], ctx), [
      labReference('SM_Env_DesertTamarisk', [-1.5, 0, 6], 30, 1.2, ctx),
      labReference('SM_Tripo_DesertCaravanWreck', [4, 0, 7], -20, 1, ctx),
    ]),
    views: [
      { name: '顺光平视', eye: [-16, 1.6, -24], look: [0, 5, -1] },
      { name: '逆光平视', eye: [10, 1.6, 26], look: [0, 6, -2] },
      { name: '林下', eye: [-11, 1.6, 5], look: [-11, 4.6, -6] },
      { name: '远看剪影', eye: [70, 3, 95], look: [0, 6, -2], fov: 40 },
    ],
  },
  {
    id: 'poplar-single',
    title: '白杨单株',
    note: '绿叶 12 m（1-4）+ 金叶 10 m（1-A）各一棵，玩家眼高近看树干皮孔、树冠底、叶团',
    build: ctx => labCombine(buildPoplars([
      { at: [-3, 0], height: 12, tint: 'green', seed: 1 },
      { at: [3, 0], height: 10, tint: 'gold', seed: 2 },
    ], ctx), []),
    views: [
      { name: '眼高近看', eye: [0, 1.6, 10], look: [0, 5.5, 0] },
      { name: '树下抬头', eye: [-3.6, 1.6, 2.4], look: [-2.8, 6, -0.8] },
      { name: '树干特写', eye: [-2.2, 1.6, 2.2], look: [-3, 1.2, 0] },
      { name: '顺光侧面', eye: [-14, 2, -16], look: [0, 5.5, 0] },
    ],
  },
  {
    id: 'dead-poplar',
    title: '胡杨枯木',
    note: '四个变体（4.5 / 5 / 5.5 / 6 m）：1-1 古道边 ×6、1-4 北岸残祠 ×4；粗扭的裂纹干、断头粗枝、无叶。红柳对色',
    build: ctx => labCombine(buildDeadPoplars([
      { at: [-10, 0], height: 4.5, seed: 0, yaw: 20 },
      { at: [-3.5, -1], height: 5, seed: 1, yaw: 140 },
      { at: [3.5, 0.5], height: 5.5, seed: 2, yaw: 260 },
      { at: [10, -0.5], height: 6, seed: 3, yaw: 70 },
    ], ctx), [labReference('SM_Env_DesertTamarisk', [0, 0, 4], 0, 1.2, ctx)]),
    views: [
      { name: '眼高', eye: [0, 1.6, 16], look: [0, 2.8, 0] },
      { name: '近看', eye: [1.5, 1.6, 5.5], look: [3.5, 2.2, 0.5] },
      { name: '逆光剪影', eye: [16, 0.9, 26], look: [0, 3.2, 0], fov: 50 },
      { name: '顺光', eye: [-12, 2.5, -16], look: [0, 2.8, 0] },
    ],
  },
];
