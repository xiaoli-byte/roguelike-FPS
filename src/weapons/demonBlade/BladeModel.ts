/**
 * 魔刀千刃 v2 的运行时模型（docs/demon-blade-v2.md 第 9 节）。
 *
 * - 128 片碎刃：BladeShape 的 Voronoi 单元各自建成带倒角的厚片，合并成一个几何体（顶点带片号与片心）。
 *   每片的位置 / 朝向 / 缩放 / 亮度存在一张 128×3 的浮点纹理（ShardBuffer）里，顶点着色器按片号取出变换。
 *   同一几何体既用于第一人称刀身，也用于世界中的刃群（各自一张 ShardBuffer），所以碎片离刀后外形不变。
 * - 刀根（鬼面）、铜环、护手、缠柄、柄尾：贴图从用户确认的设计图裁出（art/pipeline/demon_blade_textures.py）。
 *   刀根材质在闭眼 / 睁眼两张贴图之间混合（噬灵鬼眼）。
 * - 刀芯：碎刃区域形状的紫色发光薄片，从片缝里透出来；碎片离刀后按 coreTop 截掉。
 * - 辉光：刀身轮廓外一圈加法混合的紫光（刃口一侧更宽更亮）。
 *
 * 坐标：模型根节点原点 = 右手握持点；frame 子节点是刀身局部坐标（+Y 指向刀尖、刃口 +X）。
 */
import * as THREE from 'three';
import {
  acrossOf, bladeCells, bladeOutline, BLADE_LEN, rootBoundaryY, rootPolygon, ROOT_TEX_LEN, shardRegion, SHARD_COUNT,
  spineX, bladeWidth, thicknessAt, type Poly,
} from './BladeShape';

/** 右手握持点在刀身局部坐标中的 y（靠近护手） */
export const GRIP_Y = -0.085;
/** 刀柄各段（设计图正侧面量得，与刀身同一比例）：柄尾 3.7 cm、缠柄 23 cm、柄头箍 1 cm、护手 1.8 cm，刀根套 1.4 cm 包在刀身起点 */
const POMMEL_Y0 = -0.2955;
const GRIP_Y0 = -0.2585;
const FUCHI_Y0 = -0.0276;
const GUARD_Y0 = -0.0176;
const HABAKI_Y1 = 0.014;

/** 贴图集矩形（像素，左上原点，1024²），与 art/pipeline/demon_blade_textures.py 的 RECTS 一致 */
const ATLAS = 1024;
const HILT_ATLAS = {
  root: [0, 0, 256, 576],
  rootAwake: [256, 0, 256, 576],
  grip: [0, 576, 1024, 144],
  pommel: [0, 720, 128, 160],
  guard: [128, 720, 512, 96],
} as const;
type Rect = readonly [number, number, number, number];
const AWAKE_OFFSET = (HILT_ATLAS.rootAwake[0] - HILT_ATLAS.root[0]) / ATLAS;

/** 刀根鬼面的眼睛（刀根贴图坐标：横向 u、长度 v）→ 刀身局部 */
const EYE_U = 0.41;
const EYE_V = 0.244;

export const BLADE_PURPLE = 0x9a5cff;
export const BLADE_EDGE_GLOW = 0xeadcff;
export const BLADE_SEAM_GLOW = 0x8a4cff;

function rectUv(r: Rect, s: number, t: number): [number, number] {
  return [(r[0] + s * r[2]) / ATLAS, 1 - (r[1] + t * r[3]) / ATLAS];
}

// ───────────────────────────── 贴图 ─────────────────────────────

let hiltMaps: { albedo: THREE.Texture; glow: THREE.Texture } | null = null;

function loadHiltMaps(): { albedo: THREE.Texture; glow: THREE.Texture } {
  if (hiltMaps) return hiltMaps;
  const base = `${import.meta.env?.BASE_URL ?? '/'}assets/weapons/`;
  const load = (name: string): THREE.Texture => {
    const tex = new THREE.Texture();
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    if (typeof document !== 'undefined') {
      new THREE.ImageLoader().load(base + name, (img) => {
        tex.image = img;
        tex.needsUpdate = true;
      });
    }
    return tex;
  };
  hiltMaps = { albedo: load('T_DemonBlade_Hilt_D.webp'), glow: load('T_DemonBlade_Hilt_E.webp') };
  return hiltMaps;
}

let glowSprite: THREE.Texture | null = null;

/** 径向渐变（眼睛光点 / 碎片光晕共用） */
export function bladeGlowTexture(): THREE.Texture {
  if (glowSprite) return glowSprite;
  if (typeof document === 'undefined') return (glowSprite = new THREE.Texture());
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowSprite = new THREE.CanvasTexture(c);
  glowSprite.colorSpace = THREE.SRGBColorSpace;
  return glowSprite;
}

// ───────────────────────────── 碎片变换纹理 ─────────────────────────────

/**
 * 每片碎刃的变换：第 0 行 (中心 xyz, 缩放)，第 1 行四元数，第 2 行 (亮度, 0, 0, 0)。
 * 中心与朝向都在网格自身的坐标系里（第一人称刀身 = 刀身局部；世界刃群 = 世界坐标）。
 */
export class ShardBuffer {
  readonly data = new Float32Array(SHARD_COUNT * 4 * 3);
  readonly texture: THREE.DataTexture;
  private dirty = true;

  constructor() {
    this.texture = new THREE.DataTexture(this.data, SHARD_COUNT, 3, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.homeAll();
  }

  /** 全部回到刀身原位（缩放 1、无旋转、不发光） */
  homeAll(): void {
    const cells = bladeCells();
    for (let i = 0; i < SHARD_COUNT; i++) this.set(i, cells[i].cx, cells[i].cy, 0, null, 1, 0);
  }

  /** 隐藏（缩放 0） */
  hide(i: number): void {
    this.data[i * 4 + 3] = 0;
    this.dirty = true;
  }

  set(i: number, x: number, y: number, z: number, q: THREE.Quaternion | null, scale: number, glow: number): void {
    const d = this.data;
    const a = i * 4, b = (SHARD_COUNT + i) * 4, c = (2 * SHARD_COUNT + i) * 4;
    d[a] = x; d[a + 1] = y; d[a + 2] = z; d[a + 3] = scale;
    if (q) { d[b] = q.x; d[b + 1] = q.y; d[b + 2] = q.z; d[b + 3] = q.w; } else { d[b] = 0; d[b + 1] = 0; d[b + 2] = 0; d[b + 3] = 1; }
    d[c] = glow;
    this.dirty = true;
  }

  setGlow(i: number, glow: number): void {
    this.data[(2 * SHARD_COUNT + i) * 4] = glow;
    this.dirty = true;
  }

  scaleOf(i: number): number {
    return this.data[i * 4 + 3];
  }

  /** 每帧写完后调用一次 */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

// ───────────────────────────── 碎刃几何 ─────────────────────────────

/** 多边形内缩 d（逆时针；斜接，限制尖角处的位移） */
function inset(p: Poly, d: number): Poly {
  const n = p.length / 2;
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const pi = (i + n - 1) % n, ni = (i + 1) % n;
    let ax = p[2 * i] - p[2 * pi], ay = p[2 * i + 1] - p[2 * pi + 1];
    let bx = p[2 * ni] - p[2 * i], by = p[2 * ni + 1] - p[2 * i + 1];
    const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
    ax /= la; ay /= la; bx /= lb; by /= lb;
    // 逆时针的内法线 = 左法线 (−dy, dx)
    const nx = -ay - by, ny = ax + bx;
    const nl = Math.hypot(nx, ny) || 1;
    const cosHalf = Math.max(0.35, (nx / nl) * -ay + (ny / nl) * ax);
    const k = d / cosHalf;
    out.push(p[2 * i] + (nx / nl) * k, p[2 * i + 1] + (ny / nl) * k);
  }
  return out;
}

/** 质心到各边所在直线的最小距离（近似内切半径） */
function inradius(p: Poly, cx: number, cy: number): number {
  let m = Infinity;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = p[2 * j] - p[2 * i], ey = p[2 * j + 1] - p[2 * i + 1];
    const l = Math.hypot(ex, ey);
    if (l < 1e-9) continue;
    m = Math.min(m, Math.abs((cx - p[2 * i]) * ey - (cy - p[2 * i + 1]) * ex) / l);
  }
  return Number.isFinite(m) ? m : 0;
}

const _ca = new THREE.Color(), _cb = new THREE.Color();

/** 手绘片面底色：刀背蓝紫 → 片身淡紫银 → 刃口近白 */
function shardColor(a: number, jitter: number, hue: number, out: THREE.Color): THREE.Color {
  if (a < 0.55) {
    _ca.setHex(0x6268d4);
    _cb.setHex(0xaaaaf0);
    out.copy(_ca).lerp(_cb, a / 0.55);
  } else {
    _ca.setHex(0xaaaaf0);
    _cb.setHex(0xeeeaff);
    out.copy(_ca).lerp(_cb, (a - 0.55) / 0.45);
  }
  _ca.setHex(0xc4a2ff);
  out.lerp(_ca, hue);
  return out.multiplyScalar(jitter);
}

let shardGeo: THREE.BufferGeometry | null = null;

/** 128 片碎刃的合并几何体（全局共享，不要 dispose） */
export function bladeShardGeometry(): THREE.BufferGeometry {
  if (shardGeo) return shardGeo;
  const cells = bladeCells();
  const pos: number[] = [], col: number[] = [], shard: number[] = [], pivot: number[] = [], glow: number[] = [];
  const c = new THREE.Color();
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (const cell of cells) {
    const jitter = 0.93 + rnd() * 0.14;
    const hue = rnd() * 0.16;
    const size = Math.sqrt(Math.abs(cell.area));
    // 内缩量按内切半径限制：贴边的细长小片不会内缩过头而翻面
    const ir = inradius(cell.poly, cell.cx, cell.cy);
    const outer = inset(cell.poly, Math.min(0.00075, ir * 0.2));
    const inner = inset(outer, Math.min(0.0022, size * 0.12, ir * 0.35));
    const n = outer.length / 2;
    const tz = (x: number, y: number): number => thicknessAt(x, y) / 2;
    const bevel = (x: number, y: number): number => Math.min(0.0013, thicknessAt(x, y) * 0.32);
    const push = (x: number, y: number, z: number, light: number, edgeBoost: number): void => {
      pos.push(x, y, z);
      const a = acrossOf(x, y);
      shardColor(a, jitter * light, hue, c);
      col.push(c.r, c.g, c.b);
      shard.push(cell.index);
      pivot.push(cell.cx, cell.cy, 0);
      const edge = Math.pow(Math.max(0, (a - 0.62) / 0.38), 1.5);
      glow.push(Math.min(1, edge), edgeBoost);
    };
    for (const side of [1, -1]) {
      // 顶面（扇形，以片心为中心）
      const czc = tz(cell.cx, cell.cy) * side;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const [i0, j0] = side > 0 ? [i, j] : [j, i];
        push(cell.cx, cell.cy, czc, 1.06, 0);
        push(inner[2 * i0], inner[2 * i0 + 1], tz(inner[2 * i0], inner[2 * i0 + 1]) * side, 1, 0);
        push(inner[2 * j0], inner[2 * j0 + 1], tz(inner[2 * j0], inner[2 * j0 + 1]) * side, 1, 0);
      }
      // 倒角环（亮边）
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const [i0, j0] = side > 0 ? [i, j] : [j, i];
        const ix0 = inner[2 * i0], iy0 = inner[2 * i0 + 1], ix1 = inner[2 * j0], iy1 = inner[2 * j0 + 1];
        const ox0 = outer[2 * i0], oy0 = outer[2 * i0 + 1], ox1 = outer[2 * j0], oy1 = outer[2 * j0 + 1];
        const zi0 = tz(ix0, iy0) * side, zi1 = tz(ix1, iy1) * side;
        const zo0 = (tz(ox0, oy0) - bevel(ox0, oy0)) * side, zo1 = (tz(ox1, oy1) - bevel(ox1, oy1)) * side;
        push(ix0, iy0, zi0, 1.2, 0); push(ox0, oy0, zo0, 1.28, 0.25); push(ox1, oy1, zo1, 1.28, 0.25);
        push(ix0, iy0, zi0, 1.2, 0); push(ox1, oy1, zo1, 1.28, 0.25); push(ix1, iy1, zi1, 1.2, 0);
      }
    }
    // 侧壁（暗）
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = outer[2 * i], y0 = outer[2 * i + 1], x1 = outer[2 * j], y1 = outer[2 * j + 1];
      const z0 = tz(x0, y0) - bevel(x0, y0), z1 = tz(x1, y1) - bevel(x1, y1);
      push(x0, y0, -z0, 0.62, 0.8); push(x1, y1, -z1, 0.62, 0.8); push(x1, y1, z1, 0.62, 0.8);
      push(x0, y0, -z0, 0.62, 0.8); push(x1, y1, z1, 0.62, 0.8); push(x0, y0, z0, 0.62, 0.8);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aShard', new THREE.Float32BufferAttribute(shard, 1));
  g.setAttribute('aPivot', new THREE.Float32BufferAttribute(pivot, 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  shardGeo = g;
  return g;
}

const SHARD_VERT_HEAD = /* glsl */ `
attribute float aShard;
attribute vec3 aPivot;
attribute vec2 aGlow;
uniform sampler2D uShardTex;
varying vec2 vGlow;
varying float vShardGlow;
vec3 bladeQRot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`;

/**
 * 碎刃材质：按 ShardBuffer 变换每片；刃口白紫自发光（aGlow.x）、倒角 / 侧壁紫色缝光（aGlow.y）、每片额外亮度（纹理第 2 行）。
 * uniforms 挂在 material.userData.uniforms：edge / seam 为强度，boost 为整体附加亮度。
 */
export function shardMaterial(buffer: ShardBuffer): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.18, emissive: 0x1c0c44 });
  const uniforms = {
    uShardTex: { value: buffer.texture },
    uEdgeColor: { value: new THREE.Color(BLADE_EDGE_GLOW) },
    uSeamColor: { value: new THREE.Color(BLADE_SEAM_GLOW) },
    uEdge: { value: 1.3 },
    uSeam: { value: 0.45 },
    uBoost: { value: 0 },
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SHARD_VERT_HEAD}`)
      .replace('#include <beginnormal_vertex>', /* glsl */ `
        int bladeId = int(aShard + 0.5);
        vec4 bladeA = texelFetch(uShardTex, ivec2(bladeId, 0), 0);
        vec4 bladeQ = texelFetch(uShardTex, ivec2(bladeId, 1), 0);
        vec4 bladeG = texelFetch(uShardTex, ivec2(bladeId, 2), 0);
        vec3 objectNormal = bladeQRot(bladeQ, normal);
        vGlow = aGlow;
        vShardGlow = bladeG.x;`)
      .replace('#include <begin_vertex>', /* glsl */ `
        vec3 transformed = bladeA.xyz + bladeQRot(bladeQ, (position - aPivot) * bladeA.w);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uEdgeColor; uniform vec3 uSeamColor; uniform float uEdge; uniform float uSeam; uniform float uBoost;
        varying vec2 vGlow; varying float vShardGlow;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uEdgeColor * vGlow.x * (uEdge + vShardGlow * 1.5 + uBoost)
          + uSeamColor * (vGlow.y * (uSeam + vShardGlow + uBoost) + vShardGlow * 0.6 + uBoost * 0.35);`);
  };
  m.customProgramCacheKey = () => 'demonBladeShard';
  return m;
}

// ───────────────────────────── 刀芯 / 辉光 ─────────────────────────────

/** 只显示 y ≤ uCoreTop 的部分（碎片从刀尖离开时刀芯随之收回） */
function clippedBasic(params: THREE.MeshBasicMaterialParameters, key: string): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial(params);
  const uniforms = { uCoreTop: { value: 10 }, uFade: { value: 1 } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vBladeY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBladeY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCoreTop; uniform float uFade; varying float vBladeY;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vBladeY > uCoreTop) discard;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb *= uFade; gl_FragColor.a *= clamp(uFade, 0.0, 1.0);');
  };
  m.customProgramCacheKey = () => key;
  return m;
}

function polyGeometry(p: Poly, z: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < p.length; i += 2) pts.push(new THREE.Vector2(p[i], p[i + 1]));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const pos: number[] = [];
  for (const t of tris) for (const k of t) pos.push(pts[k].x, pts[k].y, z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** 辉光：紫色半透明（普通混合，亮背景下不会发白），顶点 alpha 由内向外衰减 */
function haloMaterial(): THREE.MeshBasicMaterial {
  return clippedBasic({
    color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }, 'demonBladeHalo');
}

/** 刀身轮廓外的辉光带：内圈浓、外圈透明；刃口一侧更宽更浓 */
function haloGeometry(): THREE.BufferGeometry {
  const o = bladeOutline();
  const n = o.length / 2;
  const pos: number[] = [], col: number[] = [];
  const c = new THREE.Color(BLADE_PURPLE);
  const vert = (i: number, outer: boolean): void => {
    const pi = (i + n - 1) % n, ni = (i + 1) % n;
    const tx = o[2 * ni] - o[2 * pi], ty = o[2 * ni + 1] - o[2 * pi + 1];
    const tl = Math.hypot(tx, ty) || 1;
    // 逆时针轮廓的外法线 = 右法线 (dy, −dx)
    const nx = ty / tl, ny = -tx / tl;
    const x = o[2 * i], y = o[2 * i + 1];
    const a = acrossOf(x, y);
    const rootK = y < rootBoundaryY(a) ? 0.45 : 1;
    const off = outer ? (0.004 + 0.011 * a) * (0.6 + 0.4 * rootK) : 0;
    pos.push(x + nx * off, y + ny * off, 0);
    const k = outer ? 0 : (0.18 + 0.5 * a) * rootK;
    col.push(c.r, c.g, c.b, k);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    vert(i, false); vert(i, true); vert(j, true);
    vert(i, false); vert(j, true); vert(j, false);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  return g;
}

// ───────────────────────────── 刀根 / 刀柄 ─────────────────────────────

interface MeshData { pos: number[]; uv: number[] }

function tri(d: MeshData, a: number[], b: number[], c: number[]): void {
  d.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  d.uv.push(a[3], a[4], b[3], b[4], c[3], c[4]);
}

/** 刀根厚板：两面鬼面贴图（u = 横向、v = 长度），侧壁取刀根贴图的暗处 */
function rootSlabGeometry(): THREE.BufferGeometry {
  const p = rootPolygon();
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < p.length; i += 2) pts.push(new THREE.Vector2(p[i], p[i + 1]));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const d: MeshData = { pos: [], uv: [] };
  const R = HILT_ATLAS.root;
  const v = (x: number, y: number, side: number): number[] => {
    const a = acrossOf(x, y);
    const [u, t] = rectUv(R, a, Math.min(1, y / ROOT_TEX_LEN));
    return [x, y, (thicknessAt(x, y) / 2 + 0.0004) * side, u, t];
  };
  for (const t of tris) {
    let [a, b, c] = t.map((k) => pts[k]);
    // 正面（+Z）要逆时针
    if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) [b, c] = [c, b];
    tri(d, v(a.x, a.y, 1), v(b.x, b.y, 1), v(c.x, c.y, 1));
    tri(d, v(a.x, a.y, -1), v(c.x, c.y, -1), v(b.x, b.y, -1));
  }
  const [du, dv] = rectUv(R, 0.08, 0.5);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const za = thicknessAt(a.x, a.y) / 2 + 0.0004, zb = thicknessAt(b.x, b.y) / 2 + 0.0004;
    tri(d, [a.x, a.y, -za, du, dv], [b.x, b.y, -zb, du, dv], [b.x, b.y, zb, du, dv]);
    tri(d, [a.x, a.y, -za, du, dv], [b.x, b.y, zb, du, dv], [a.x, a.y, za, du, dv]);
  }
  return finish(d);
}

function finish(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * 沿 Y 拉伸的凸截面柱体（截面在 XZ 平面，逆时针看向 −Y）。
 * capUv(x, z) 给端面贴图坐标；sideUv(周长比例, 高度比例) 给侧面贴图坐标。
 */
function prism(d: MeshData, outline: [number, number][], y0: number, y1: number,
  capUv: (x: number, z: number) => [number, number], sideUv: (s: number, h: number) => [number, number]): void {
  const n = outline.length;
  let perim = 0;
  const acc: number[] = [0];
  for (let i = 0; i < n; i++) {
    const [ax, az] = outline[i], [bx, bz] = outline[(i + 1) % n];
    perim += Math.hypot(bx - ax, bz - az);
    acc.push(perim);
  }
  for (let i = 0; i < n; i++) {
    const [ax, az] = outline[i], [bx, bz] = outline[(i + 1) % n];
    const s0 = acc[i] / perim, s1 = acc[i + 1] / perim;
    const a0 = sideUv(s0, 0), a1 = sideUv(s0, 1), b0 = sideUv(s1, 0), b1 = sideUv(s1, 1);
    tri(d, [ax, y0, az, ...a0], [bx, y0, bz, ...b0], [bx, y1, bz, ...b1]);
    tri(d, [ax, y0, az, ...a0], [bx, y1, bz, ...b1], [ax, y1, az, ...a1]);
  }
  for (let i = 1; i < n - 1; i++) {
    const p0 = outline[0], p1 = outline[i], p2 = outline[i + 1];
    // 截面在 (x, z) 中为顺时针：顶面 (p0, p1, p2) 法线朝 +Y，底面反过来
    tri(d, [p0[0], y1, p0[1], ...capUv(p0[0], p0[1])], [p1[0], y1, p1[1], ...capUv(p1[0], p1[1])], [p2[0], y1, p2[1], ...capUv(p2[0], p2[1])]);
    tri(d, [p0[0], y0, p0[1], ...capUv(p0[0], p0[1])], [p2[0], y0, p2[1], ...capUv(p2[0], p2[1])], [p1[0], y0, p1[1], ...capUv(p1[0], p1[1])]);
  }
}

/** 两端截面不同的柱体侧面（缠柄），端面被柄尾 / 柄头箍盖住，不生成 */
function prismTaper(d: MeshData, a: [number, number][], b: [number, number][], y0: number, y1: number,
  sideUv: (s: number, h: number) => [number, number]): void {
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const s0 = i / n, s1 = (i + 1) / n;
    const a0 = sideUv(s0, 0), a1 = sideUv(s0, 1), b0 = sideUv(s1, 0), b1 = sideUv(s1, 1);
    tri(d, [a[i][0], y0, a[i][1], ...a0], [a[j][0], y0, a[j][1], ...b0], [b[j][0], y1, b[j][1], ...b1]);
    tri(d, [a[i][0], y0, a[i][1], ...a0], [b[j][0], y1, b[j][1], ...b1], [b[i][0], y1, b[i][1], ...a1]);
  }
}

/** 倒角矩形截面（x 半宽、z 半深、倒角 c） */
function chamferRect(hx: number, hz: number, c: number, cx = 0): [number, number][] {
  return [[cx - hx + c, -hz], [cx + hx - c, -hz], [cx + hx, -hz + c], [cx + hx, hz - c], [cx + hx - c, hz], [cx - hx + c, hz], [cx - hx, hz - c], [cx - hx, -hz + c]].reverse() as [number, number][];
}

function ellipse(rx: number, rz: number, n: number, cx = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (-i / n) * Math.PI * 2 + Math.PI / n;
    out.push([cx + Math.cos(a) * rx, Math.sin(a) * rz]);
  }
  return out;
}

/** 铜环、护手、缠柄、柄尾（一个几何体） */
function hiltGeometry(): THREE.BufferGeometry {
  const d: MeshData = { pos: [], uv: [] };
  // 刀柄轴线 = 刀身局部 x = 0（设计图里刀柄与刀根中线基本对齐）
  const cx = 0.004;
  const G = HILT_ATLAS.guard, P = HILT_ATLAS.pommel, W = HILT_ATLAS.grip;
  const side = (s: number, h: number): [number, number] => rectUv(G, 0.12 + s * 0.76, 0.2 + h * 0.6);
  // 刀根套（包住刀身起点的一圈暗色金属）
  const hw = bladeWidth(0) / 2 + 0.0025, hc = spineX(0) + bladeWidth(0) / 2;
  prism(d, chamferRect(hw, 0.0052, 0.0015, hc), 0, HABAKI_Y1, (x, z) => rectUv(G, 0.3 + x * 2, 0.5 + z * 6), side);
  // 护手：大号倒角方板（约为刀宽的 1.8 倍），正面贴设计图的护手
  prism(d, chamferRect(0.047, 0.019, 0.007, cx), GUARD_Y0, 0,
    (x, z) => rectUv(G, 0.5 + (x - cx) / 0.1, 0.45 + z / 0.05), (s, h) => rectUv(G, (s * 2) % 1, 0.15 + h * 0.7));
  // 柄头箍
  prism(d, chamferRect(0.0205, 0.0168, 0.004, cx), FUCHI_Y0, GUARD_Y0, (x, z) => rectUv(G, 0.3 + x * 2, 0.5 + z * 6), side);
  // 缠柄：十棱，长度方向 = 贴图横向，周向镜像两次；柄尾一端略粗
  prismTaper(d, ellipse(0.0215, 0.0172, 10, cx), ellipse(0.0185, 0.0152, 10, cx), GRIP_Y0, FUCHI_Y0,
    (s, h) => rectUv(W, 0.02 + h * 0.96, Math.abs(((s * 2) % 2) - 1)));
  // 柄尾
  prism(d, chamferRect(0.0228, 0.0185, 0.004, cx), POMMEL_Y0, GRIP_Y0,
    (x, z) => rectUv(P, 0.5 + (x - cx) / 0.05, 0.5 + z / 0.04), (s, h) => rectUv(P, (s * 4) % 1, 1 - h));
  return finish(d);
}

// ───────────────────────────── 组装 ─────────────────────────────

export interface DemonBladeModel {
  /** 原点 = 握持点 */
  root: THREE.Group;
  /** 刀身局部坐标系 */
  frame: THREE.Group;
  shards: THREE.Mesh;
  buffer: ShardBuffer;
  shardMat: THREE.MeshStandardMaterial;
  core: THREE.Mesh;
  halo: THREE.Mesh;
  rootSlab: THREE.Mesh;
  eye: THREE.Mesh;
  /** 刀尖锚点（frame 子节点） */
  tip: THREE.Object3D;
  /** 鬼眼 0 闭 → 1 睁 */
  setAwake(v: number): void;
  /** 刀芯 / 辉光只显示到这一高度（刀身局部 y） */
  setCoreTop(y: number): void;
  /** 刀芯与辉光整体亮度 */
  setAura(v: number): void;
  dispose(): void;
}

let hiltGeo: THREE.BufferGeometry | null = null;
let rootGeo: THREE.BufferGeometry | null = null;
let coreGeo: THREE.BufferGeometry | null = null;
let haloGeo: THREE.BufferGeometry | null = null;
let hiltMat: THREE.MeshStandardMaterial | null = null;

/**
 * 新建一把魔刀。dynamic = true（第一人称）：独享 ShardBuffer 与材质，可逐片动画；
 * false（世界掉落等静态展示）：共享全局材质，所有实例都是完整刀身。
 */
export function buildDemonBlade(dynamic: boolean): DemonBladeModel {
  const maps = loadHiltMaps();
  hiltGeo ??= hiltGeometry();
  rootGeo ??= rootSlabGeometry();
  coreGeo ??= polyGeometry(shardRegion(), 0);
  haloGeo ??= haloGeometry();
  hiltMat ??= new THREE.MeshStandardMaterial({
    map: maps.albedo, emissiveMap: maps.glow, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.58, metalness: 0.35,
  });

  const root = new THREE.Group();
  root.name = 'demonBlade';
  const frame = new THREE.Group();
  frame.name = 'demonBlade.frame';
  frame.position.y = -GRIP_Y;
  root.add(frame);

  const shared = !dynamic ? staticParts() : null;
  const buffer = shared ? shared.buffer : new ShardBuffer();
  const shardMat = shared ? shared.shardMat : shardMaterial(buffer);
  const shards = new THREE.Mesh(bladeShardGeometry(), shardMat);
  shards.name = 'demonBlade.shards';
  shards.frustumCulled = !dynamic;
  frame.add(shards);

  const coreMat = shared ? shared.coreMat : clippedBasic({ color: 0x7436ff, side: THREE.DoubleSide, toneMapped: false }, 'demonBladeCore');
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.name = 'demonBlade.core';
  frame.add(core);

  const haloMat = shared ? shared.haloMat : haloMaterial();
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.name = 'demonBlade.halo';
  halo.renderOrder = 2;
  frame.add(halo);

  const rootMat = shared ? shared.rootMat : rootMaterial(maps);
  const rootSlab = new THREE.Mesh(rootGeo, rootMat);
  rootSlab.name = 'demonBlade.root';
  frame.add(rootSlab);

  const hilt = new THREE.Mesh(hiltGeo, hiltMat);
  hilt.name = 'demonBlade.hilt';
  frame.add(hilt);

  // 鬼眼光点（两面各一）
  const eyeMat = shared ? shared.eyeMat : new THREE.MeshBasicMaterial({
    map: bladeGlowTexture(), color: 0xd9b8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    side: THREE.DoubleSide,
  });
  const eyeY = EYE_V * ROOT_TEX_LEN;
  const eyeX = spineX(eyeY) + EYE_U * bladeWidth(eyeY);
  const eye = new THREE.Mesh(eyePlane(), eyeMat);
  eye.name = 'demonBlade.eye';
  eye.position.set(eyeX, eyeY, 0);
  eye.renderOrder = 3;
  frame.add(eye);

  const tip = new THREE.Object3D();
  tip.name = 'demonBlade.tip';
  tip.position.set(spineX(BLADE_LEN), BLADE_LEN, 0);
  frame.add(tip);

  for (const o of [shards, core, halo, rootSlab, hilt, eye]) {
    o.castShadow = false;
    o.receiveShadow = false;
  }

  const rootU = rootMat.userData.uniforms as { uAwake: { value: number } };
  const coreU = coreMat.userData.uniforms as { uCoreTop: { value: number }; uFade: { value: number } };
  const haloU = haloMat.userData.uniforms as { uCoreTop: { value: number }; uFade: { value: number } };
  return {
    root, frame, shards, buffer, shardMat, core, halo, rootSlab, eye, tip,
    setAwake(v) {
      if (shared) return;
      rootU.uAwake.value = v;
      eyeMat.opacity = v;
      eye.scale.setScalar(0.6 + 0.6 * v);
    },
    setCoreTop(y) {
      if (shared) return;
      coreU.uCoreTop.value = y;
      haloU.uCoreTop.value = y;
    },
    setAura(v) {
      if (shared) return;
      haloU.uFade.value = v;
      coreU.uFade.value = 0.6 + 0.4 * Math.min(1.5, v);
    },
    dispose() {
      if (shared) return;
      buffer.dispose();
      shardMat.dispose();
      coreMat.dispose();
      haloMat.dispose();
      rootMat.dispose();
      eyeMat.dispose();
    },
  };
}

let eyeGeo: THREE.BufferGeometry | null = null;

/** 两面贴在刀根上的眼睛光点（略高于刀根表面，避免 z 冲突） */
function eyePlane(): THREE.BufferGeometry {
  if (eyeGeo) return eyeGeo;
  const s = 0.026, z = 0.0058;
  const pos = [-s, -s * 0.55, z, s, -s * 0.55, z, s, s * 0.55, z, -s, -s * 0.55, z, s, s * 0.55, z, -s, s * 0.55, z];
  const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
  const all = pos.concat(pos.map((v, i) => (i % 3 === 2 ? -v : v)));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv.concat(uv), 2));
  eyeGeo = g;
  return g;
}

function rootMaterial(maps: { albedo: THREE.Texture; glow: THREE.Texture }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: maps.albedo, emissiveMap: maps.glow, emissive: 0xffffff, emissiveIntensity: 1.25, roughness: 0.5, metalness: 0.4,
  });
  const uniforms = { uAwake: { value: 0 }, uAwakeOffset: { value: new THREE.Vector2(AWAKE_OFFSET, 0) } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uAwake; uniform vec2 uAwakeOffset;')
      .replace('#include <map_fragment>', /* glsl */ `
        #ifdef USE_MAP
          diffuseColor *= mix(texture2D(map, vMapUv), texture2D(map, vMapUv + uAwakeOffset), uAwake);
        #endif`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `
        #ifdef USE_EMISSIVEMAP
          totalEmissiveRadiance *= mix(texture2D(emissiveMap, vEmissiveMapUv), texture2D(emissiveMap, vEmissiveMapUv + uAwakeOffset), uAwake).rgb
            * (1.0 + 0.8 * uAwake);
        #endif`);
  };
  m.customProgramCacheKey = () => 'demonBladeRoot';
  return m;
}

let statics: {
  buffer: ShardBuffer; shardMat: THREE.MeshStandardMaterial; coreMat: THREE.MeshBasicMaterial; haloMat: THREE.MeshBasicMaterial;
  rootMat: THREE.MeshStandardMaterial; eyeMat: THREE.MeshBasicMaterial;
} | null = null;

/** 静态展示（掉落 / 商店）共享的整刀材质 */
function staticParts(): NonNullable<typeof statics> {
  if (statics) return statics;
  const maps = loadHiltMaps();
  const buffer = new ShardBuffer();
  buffer.flush();
  statics = {
    buffer,
    shardMat: shardMaterial(buffer),
    coreMat: clippedBasic({ color: 0x7436ff, side: THREE.DoubleSide, toneMapped: false }, 'demonBladeCore'),
    haloMat: haloMaterial(),
    rootMat: rootMaterial(maps),
    eyeMat: new THREE.MeshBasicMaterial({ map: bladeGlowTexture(), transparent: true, opacity: 0, depthWrite: false }),
  };
  return statics;
}

/** 碎刃区域的长度范围（刀芯截断用）：每片离刀时 coreTop 收到剩余片中最低的那片之下 */
export function shardBottomY(index: number): number {
  const p = bladeCells()[index].poly;
  let m = Infinity;
  for (let i = 1; i < p.length; i += 2) m = Math.min(m, p[i]);
  return m;
}

/** 片心（刀身局部） */
export function shardHome(index: number, out: THREE.Vector3): THREE.Vector3 {
  const c = bladeCells()[index];
  return out.set(c.cx, c.cy, 0);
}

