/**
 * 魔刀千刃的挥砍弧光（docs/demon-blade.md 10.8）：以眼睛附近为圆心的新月面片，沿挥砍方向 0.08 秒扫开、0.15 秒淡出。
 *
 * - 8 个弧面对象池；每个弧面两层共用一份几何体：普通混合的深色底层（弧光色 × BASE_DARK）+ 加法混合的细热边。
 *   纯加法在亮色关卡（沙漠、砖墙）上会被洗成白 / 粉，底层保住主题色。顶点在 spawn 时写一次，之后每帧只改 uniform。
 *   空闲时网格保持可见、绘制范围为 0（不出 draw call），换关预编译能编到这两个着色器。
 * - 新月：外缘（刃尖轨迹）最亮，向内渐暗；两端收窄。另外沿外缘写一条朝向相机的刃光带（RibbonBatch），
 *   保证任何视角下都看得清。外缘半径 ≈ 判定距离（判定按敌人胶囊表面算，弧光比判定短会让玩家低估攻击距离）。
 * - 横斩平面略向左下倾、回斩向右下倾、下劈为偏右且顶端右倾的斜面（与第一人称挥砍方向一致：横斩右 → 左、回斩左 → 右、下劈右上 → 左下）。
 * - 判定帧生成时已扫开 REVEAL_START：此刻第一人称的刀已挥到中线，弧光的刃头与刀尖大致同步。
 */
import * as THREE from 'three';
import type { RibbonBatch } from './Ribbons';
import { GLSL_FOG_FADE, ORDER_GLOW, hexToColor } from './shared';

const ARCS = 8;
/** 每个弧面的分段数 */
const SEG = 24;
/** 扫开 / 淡出时长与加法热边的最大不透明度（防眩光） */
const REVEAL = 0.08;
const FADE = 0.15;
const MAX_ALPHA = 0.35;
/** 普通混合深色底层：峰值不透明度与颜色（弧光色 × BASE_DARK：朱红 0xff3a24 → 约 0xb3291a） */
const BASE_ALPHA = 0.4;
const BASE_DARK = 0.7;
/**
 * 生成时已扫开的比例：弧光在判定帧生成，此时第一人称的刀已经从蓄势侧挥到中线（出刀姿态），
 * 弧光从 0 开始扫会落后刀身约半个弧；从这里起扫，刃头与刀尖大致同步。
 */
const REVEAL_START = 0.42;
/** 内外半径（× range）：最亮的外缘落在真实判定距离附近（range + 敌人半径的大半） */
const R_OUT = 1.05;
const R_IN = 0.72;
/**
 * 横斩 / 回斩：平面倾角、弧心相对眼睛的下沉与前端下压（浅碗）。
 * 从眼睛看弧面的掠射角 ≈ asin(DROP_H / 距离)，只由弧心与眼睛的距离决定（径向下压不改变它）：
 * DROP_H 0.55 在 2.3–3.4 米处约 9–13°，新月面不再被侧看成一条线；DIP_H 保持很小，免得外缘沉到地面。
 * 下劈：平面侧倾与右移（同理，右移决定侧看的角度）。
 */
const TILT_H = (22 * Math.PI) / 180;
const DROP_H = 0.55;
const DIP_H = 0.06;
/**
 * 下劈的弧面几乎经过眼睛，侧看只是一条竖线：顶端向右倾得更多（读作右上 → 左下的斜劈，与第一人称刀路一致），
 * 弧心右移 SHIFT_V，中段向右鼓出（DIP_V），新月面朝向镜头。
 */
const TILT_V = (26 * Math.PI) / 180;
const SHIFT_V = 0.4;
const DIP_V = 0.13;
/** 外缘刃光带：分段数、半宽、拖在刃头后的长度（u） */
const EDGE_QUADS = 14;
const EDGE_W = 0.035;
const EDGE_TAIL = 0.75;

const VERT = /* glsl */ `
attribute vec2 aUv;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = aUv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uReveal;
uniform float uAlpha;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float u = vUv.x;
  float v = vUv.y;
  // 刃头之后可见（软前沿），越靠近刃头越亮
  float lead = 1.0 - smoothstep(uReveal - 0.06, uReveal, u);
  float tail = 0.25 + 0.75 * smoothstep(uReveal - 0.85, uReveal, u);
  // 两端收窄
  float ends = smoothstep(0.0, 0.1, u) * (1.0 - smoothstep(0.88, 1.0, u));
#ifdef BASE_LAYER
  // 深色底层（普通混合）：整片铺色、外缘略浓，在亮色背景上保住主题色
  float radial = (0.3 + 0.7 * v) * (1.0 - smoothstep(0.93, 1.0, v));
  vec3 col = uColor;
#else
  // 热边（加法混合）：外缘亮、向内迅速变暗，只留一道细边；少量混白
  float radial = v * v * v * (1.0 - smoothstep(0.9, 1.0, v));
  vec3 col = uColor + vec3(0.3) * pow(v, 6.0) * tail;
#endif
  float a = lead * tail * ends * radial * uAlpha;
  ${GLSL_FOG_FADE}
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

interface ArcUniforms {
  uColor: { value: THREE.Color };
  uReveal: { value: number };
  uAlpha: { value: number };
}

interface Arc {
  /** 加法热边与普通混合深色底层（共用几何体 / 绘制范围） */
  mesh: THREE.Mesh;
  baseMesh: THREE.Mesh;
  pos: THREE.BufferAttribute;
  u: ArcUniforms;
  bu: ArcUniforms;
  /** 外缘点（刃光带用），按扫动顺序 */
  outer: Float32Array;
  active: boolean;
  age: number;
  stamp: number;
}

let templateHot: THREE.ShaderMaterial | null = null;
let templateBase: THREE.ShaderMaterial | null = null;
let uvAttr: THREE.BufferAttribute | null = null;
let index: number[] | null = null;

/** base = 普通混合深色底层，否则为加法热边（同一片段着色器，BASE_LAYER 宏区分） */
function material(base: boolean): THREE.ShaderMaterial {
  let t = base ? templateBase : templateHot;
  if (!t) {
    t = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uColor: { value: new THREE.Color() },
        uReveal: { value: 0 },
        uAlpha: { value: 0 },
      }]),
      defines: base ? { BASE_LAYER: '' } : {},
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: base ? THREE.NormalBlending : THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    if (base) templateBase = t;
    else templateHot = t;
  }
  return t.clone();
}

function sharedUv(): THREE.BufferAttribute {
  if (!uvAttr) {
    const uv = new Float32Array((SEG + 1) * 4);
    for (let i = 0; i <= SEG; i++) {
      uv[i * 4] = i / SEG;
      uv[i * 4 + 1] = 0;
      uv[i * 4 + 2] = i / SEG;
      uv[i * 4 + 3] = 1;
    }
    uvAttr = new THREE.BufferAttribute(uv, 2);
  }
  return uvAttr;
}

function sharedIndex(): number[] {
  if (!index) {
    index = [];
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  return index;
}

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _up = new THREE.Vector3();
const _side = new THREE.Vector3();
const _n = new THREE.Vector3();
const _o = new THREE.Vector3();

export class BladeArcs {
  readonly group = new THREE.Group();
  private readonly arcs: Arc[] = [];
  private stamp = 0;

  constructor() {
    this.group.name = 'fx.bladeArcs';
    for (let i = 0; i < ARCS; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array((SEG + 1) * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', pos);
      geo.setAttribute('aUv', sharedUv());
      geo.setIndex(sharedIndex());
      const mat = material(false);
      const baseMat = material(true);
      geo.setDrawRange(0, 0);
      // 底层先画（普通混合），热边叠在上面（加法）
      const baseMesh = new THREE.Mesh(geo, baseMat);
      baseMesh.frustumCulled = false;
      baseMesh.renderOrder = ORDER_GLOW - 2;
      baseMesh.name = `fx.bladeArcBase${i}`;
      this.group.add(baseMesh);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = ORDER_GLOW - 1;
      mesh.name = `fx.bladeArc${i}`;
      this.group.add(mesh);
      this.arcs.push({
        mesh, baseMesh, pos,
        u: mat.uniforms as unknown as ArcUniforms,
        bu: baseMat.uniforms as unknown as ArcUniforms,
        outer: new Float32Array((SEG + 1) * 3), active: false, age: 0, stamp: 0,
      });
    }
  }

  private take(): Arc {
    let oldest = this.arcs[0];
    for (const a of this.arcs) {
      if (!a.active) return a;
      if (a.stamp < oldest.stamp) oldest = a;
    }
    return oldest;
  }

  /** segment：0 横斩（右 → 左）/ 1 回斩（左 → 右）/ 2 下劈（上 → 下） */
  spawn(origin: THREE.Vector3, yaw: number, pitch: number, segment: number, range: number, halfAngle: number, color: number): void {
    const a = this.take();
    const cp = Math.cos(pitch);
    _f.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    _r.set(Math.cos(yaw), 0, -Math.sin(yaw));
    _up.crossVectors(_r, _f).normalize();
    let from: number, to: number;
    let dip: number;
    if (segment === 2) {
      // 下劈：偏右、顶端向右倾的竖直面，自上而下；中段沿弧面法线（背离眼睛：右下）鼓出
      _side.copy(_up).multiplyScalar(Math.cos(TILT_V)).addScaledVector(_r, Math.sin(TILT_V));
      _o.copy(origin).addScaledVector(_r, SHIFT_V).addScaledVector(_up, -0.04);
      _n.copy(_r).multiplyScalar(Math.cos(TILT_V)).addScaledVector(_up, -Math.sin(TILT_V));
      from = halfAngle;
      to = -halfAngle;
      dip = DIP_V;
    } else {
      // 横斩平面右高左低（向左下倾），回斩左高右低（向右下倾）；眼睛略高于弧面，中段向下压（浅碗）
      const tilt = segment === 0 ? TILT_H : -TILT_H;
      _side.copy(_r).multiplyScalar(Math.cos(tilt)).addScaledVector(_up, Math.sin(tilt));
      _o.copy(origin).addScaledVector(_up, -DROP_H);
      _n.copy(_up).negate();
      from = segment === 0 ? halfAngle : -halfAngle;
      to = -from;
      dip = DIP_H;
    }
    const rOut = Math.max(0.5, range) * R_OUT;
    const rIn0 = Math.max(0.5, range) * R_IN;
    const P = a.pos.array as Float32Array;
    const O = a.outer;
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      const th = from + (to - from) * u;
      const c = Math.cos(th), s = Math.sin(th);
      let dx = _f.x * c + _side.x * s + _n.x * dip * c;
      let dy = _f.y * c + _side.y * s + _n.y * dip * c;
      let dz = _f.z * c + _side.z * s + _n.z * dip * c;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      // 新月：中段最宽，两端收窄
      const rIn = rOut - (rOut - rIn0) * (0.3 + 0.7 * Math.sin(Math.PI * u));
      P[i * 6] = _o.x + dx * rIn;
      P[i * 6 + 1] = _o.y + dy * rIn;
      P[i * 6 + 2] = _o.z + dz * rIn;
      P[i * 6 + 3] = O[i * 3] = _o.x + dx * rOut;
      P[i * 6 + 4] = O[i * 3 + 1] = _o.y + dy * rOut;
      P[i * 6 + 5] = O[i * 3 + 2] = _o.z + dz * rOut;
    }
    a.pos.needsUpdate = true;
    hexToColor(color, a.u.uColor.value);
    a.bu.uColor.value.copy(a.u.uColor.value).multiplyScalar(BASE_DARK);
    a.u.uReveal.value = a.bu.uReveal.value = REVEAL_START;
    a.u.uAlpha.value = MAX_ALPHA;
    a.bu.uAlpha.value = BASE_ALPHA;
    a.active = true;
    a.age = 0;
    a.stamp = ++this.stamp;
    a.mesh.geometry.setDrawRange(0, Infinity);
  }

  update(dt: number): void {
    for (const a of this.arcs) {
      if (!a.active) continue;
      a.age += dt;
      const t = Math.min(1, a.age / REVEAL);
      a.u.uReveal.value = a.bu.uReveal.value = REVEAL_START + (1 - (1 - t) * (1 - t)) * (1.08 - REVEAL_START);
      const k = a.age <= REVEAL ? 1 : 1 - (a.age - REVEAL) / FADE;
      if (k <= 0) {
        a.active = false;
        a.mesh.geometry.setDrawRange(0, 0);
        continue;
      }
      a.u.uAlpha.value = MAX_ALPHA * k;
      a.bu.uAlpha.value = BASE_ALPHA * k;
    }
  }

  /** 外缘的朝向相机刃光带（刃头最亮最宽，向后渐细渐暗） */
  render(batch: RibbonBatch): void {
    for (const a of this.arcs) {
      if (!a.active) continue;
      const head = Math.min(1, a.u.uReveal.value);
      const tail = Math.max(0, head - EDGE_TAIL);
      if (head - tail < 1e-3) continue;
      const k = a.u.uAlpha.value / MAX_ALPHA;
      const c = a.u.uColor.value;
      // 少量混白：亮色关卡里刃光带仍读作主题色
      const hr = c.r + (1 - c.r) * 0.12, hg = c.g + (1 - c.g) * 0.12, hb = c.b + (1 - c.b) * 0.12;
      let px = 0, py = 0, pz = 0, pw = 0, pa = 0;
      for (let q = 0; q <= EDGE_QUADS; q++) {
        const s = q / EDGE_QUADS;
        const u = tail + (head - tail) * s;
        const f = u * SEG;
        const i = Math.min(SEG - 1, Math.floor(f));
        const w = f - i;
        const O = a.outer;
        const x = O[i * 3] + (O[i * 3 + 3] - O[i * 3]) * w;
        const y = O[i * 3 + 1] + (O[i * 3 + 4] - O[i * 3 + 1]) * w;
        const z = O[i * 3 + 2] + (O[i * 3 + 5] - O[i * 3 + 2]) * w;
        // 两端收窄（整条弧的两端 + 拖尾端）
        const ends = Math.min(1, u / 0.08, (1 - u) / 0.1);
        const width = EDGE_W * (0.25 + 0.75 * s) * Math.max(0, ends);
        const alpha = k * (0.15 + 0.85 * s * s) * 0.9;
        if (q > 0) batch.quad(px, py, pz, x, y, z, pw, width, hr, hg, hb, pa, alpha);
        px = x;
        py = y;
        pz = z;
        pw = width;
        pa = alpha;
      }
    }
  }

  clear(): void {
    for (const a of this.arcs) {
      a.active = false;
      a.mesh.geometry.setDrawRange(0, 0);
    }
  }
}
