/**
 * 法印（docs/art/fx-style.md 第五节）：技能的「蓄」和「余韵」两段用的国风符阵，纯程序绘制、不用贴图。
 *
 * 由外到内：粗细双环 + 七十二刻度（每六格一长）；一圈回纹；一道断环；先天八卦（三爻，阳爻整、阴爻断）；双细环；
 * 两重相错的多边形（方胜）；中心太极。各层转向相反、快慢不一。
 * 不是一下子整枚出现：从外圈往里一圈一圈「写」出来，每一圈由一个亮点领着画过去。
 * 三段时间：写出（write 秒）→ 停留（hold 秒，< 0 = 一直停到句柄 end()）→ 淡出（fade 秒）。
 * 池化 10 枚面片，各带自己的 uniform；加法混合、不写深度。
 */
import * as THREE from 'three';
import { ORDER_GLOW } from './shared';

const MAX = 10;

const VERT = /* glsl */ `
varying vec2 vC;
void main() {
  vC = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec4 uParams; // x 写出进度 0..1，y 转角，z 内层多边形边数，w 亮度
varying vec2 vC;
const float TAU = 6.28318531;

// 一笔：离中线 d、半宽 w；细到画不出来时不再变细，改成变淡（远处不闪）
float stroke(float d, float w, float px) {
  float ww = max(w, px * 0.75);
  return (1.0 - smoothstep(ww - px * 0.75, ww + px * 0.75, d)) * min(1.0, w / ww);
}
// 回纹的一格：相套的方框，各留一个错开的口（读作「回」）
float meander(vec2 p, float px) {
  vec2 q = abs(p - 0.5);
  float m = max(q.x, q.y);
  float I = stroke(abs(m - 0.40), 0.035, px) * step(0.12, abs(p.x - 0.5) + step(p.y, 0.5));
  I += stroke(abs(m - 0.24), 0.035, px) * step(0.10, abs(p.x - 0.5) + step(0.5, p.y));
  I += stroke(abs(m - 0.08), 0.045, px);
  return I * step(m, 0.46);
}
// 先天八卦一周的爻（自下而上三爻，1 = 阳）：乾 巽 坎 艮 坤 震 离 兑
vec3 trigram(float k) {
  if (k < 0.5) return vec3(1.0, 1.0, 1.0);
  if (k < 1.5) return vec3(0.0, 1.0, 1.0);
  if (k < 2.5) return vec3(0.0, 1.0, 0.0);
  if (k < 3.5) return vec3(0.0, 0.0, 1.0);
  if (k < 4.5) return vec3(0.0, 0.0, 0.0);
  if (k < 5.5) return vec3(1.0, 0.0, 0.0);
  if (k < 6.5) return vec3(1.0, 0.0, 1.0);
  return vec3(1.0, 1.0, 0.0);
}
float seal(vec2 c, float sides, float turn, float written, float px) {
  float r = length(c);
  if (r > 1.0 || written <= 0.0) return 0.0;
  float a = atan(c.y, c.x);
  float I = 0.0;
  // 外圈：粗环、细环，中间七十二刻度
  I += stroke(abs(r - 0.968), 0.022, px) + stroke(abs(r - 0.905), 0.006, px);
  float ta = (a + turn * 0.3) / TAU * 72.0;
  float longTick = step(mod(floor(ta) + 720.0, 6.0), 0.5);
  I += stroke(abs(fract(ta) - 0.5) / 72.0 * TAU * r, 0.0045, px) * step(0.912, r) * step(r, 0.928 + 0.02 * longTick);
  // 回纹带
  float k1 = (a - turn * 0.8) / TAU * 28.0;
  vec2 mp = vec2(fract(k1), (r - 0.762) / 0.118);
  if (mp.y > 0.0 && mp.y < 1.0) I += meander(mp, px * 9.0) * 0.85;
  I += stroke(abs(r - 0.745), 0.006, px);
  // 断环
  I += stroke(abs(r - 0.705), 0.005, px) * step(0.34, fract((a + turn * 0.6) / TAU * 36.0));
  // 八卦：八个方位各三爻（三段同心弧），阴爻中间断开
  float a2 = a + turn * 0.5;
  float seg = TAU / 8.0;
  float f = floor(a2 / seg + 0.5);
  float al = a2 - f * seg;
  vec3 yao = trigram(mod(f + 800.0, 8.0));
  float arc = 1.0 - smoothstep(0.25, 0.27, abs(al));
  float gap = step(0.045, abs(al));
  I += stroke(abs(r - 0.475), 0.017, px) * arc * mix(gap, 1.0, yao.x);
  I += stroke(abs(r - 0.545), 0.017, px) * arc * mix(gap, 1.0, yao.y);
  I += stroke(abs(r - 0.615), 0.017, px) * arc * mix(gap, 1.0, yao.z);
  // 内：双细环
  I += stroke(abs(r - 0.405), 0.007, px) + stroke(abs(r - 0.378), 0.004, px);
  // 两重相错的多边形（方胜）
  float sg = TAU / max(3.0, sides);
  float a3 = a - turn * 1.1;
  float am = a3 - floor(a3 / sg + 0.5) * sg;
  I += stroke(abs(r * cos(am) - 0.335 * cos(sg * 0.5)), 0.006, px) * step(r, 0.34);
  float a4 = a3 + sg * 0.5;
  float an = a4 - floor(a4 / sg + 0.5) * sg;
  I += stroke(abs(r * cos(an) - 0.335 * cos(sg * 0.5)), 0.004, px) * step(r, 0.34) * 0.7;
  // 中心：太极（外圆、S 线、两点）
  float ct = cos(turn * 1.6), st = sin(turn * 1.6);
  vec2 t = vec2(ct * c.x - st * c.y, st * c.x + ct * c.y);
  I += stroke(abs(r - 0.15), 0.008, px);
  float up = length(t - vec2(0.0, 0.075)), dn = length(t + vec2(0.0, 0.075));
  I += stroke(abs(up - 0.075), 0.006, px) * step(t.x, 0.0) * step(r, 0.15);
  I += stroke(abs(dn - 0.075), 0.006, px) * step(0.0, t.x) * step(r, 0.15);
  I += (1.0 - smoothstep(0.016, 0.026, up)) + (1.0 - smoothstep(0.016, 0.026, dn));
  // 写出：外圈先，回纹与断环次之，八卦再次，最里最后；每一圈由一个亮点领着转一周
  float zone = r > 0.89 ? 0.0 : (r > 0.69 ? 1.0 : (r > 0.36 ? 2.0 : 3.0));
  float pz = clamp(written * 4.6 - zone, 0.0, 1.0);
  float af = fract(a / TAU + 0.27 * zone + 0.5);
  float head = (1.0 - step(1.0, pz)) * step(0.001, pz) * exp(-(af - pz) * (af - pz) * 1600.0) * 2.5;
  return I * (step(af, pz) + head);
}
void main() {
  float px = length(fwidth(vC));
  float I = seal(vC, uParams.z, uParams.y, uParams.x, px);
  float r = length(vC);
  if (r > 1.0) discard;
  float halo = 0.05 * exp(-(r - 0.94) * (r - 0.94) * 260.0) * clamp(uParams.x * 4.0, 0.0, 1.0);
  vec3 col = uColor * (min(I, 1.6) + halo) + max(I - 1.0, 0.0) * 0.35;
  gl_FragColor = vec4(col * uParams.w, 1.0);
  #include <colorspace_fragment>
  // 预乘输出：笔画除了加光，还遮住身后六成。纯加法的印在雪地、亮沙地上被洗成一片奶白，认不出是哪种颜色的印；
  // 遮一部分之后亮地面上是有颜色的笔画，暗地面上和原来几乎一样
  gl_FragColor.a = clamp(min(I, 1.0) * 0.6 * min(uParams.w, 1.0), 0.0, 0.6);
}
`;

/** 一枚法印的句柄 */
export interface SealHandle {
  /** 现在开始淡出（seconds 秒）；重复调用安全，槽位被复用后无效 */
  end(seconds?: number): void;
}

export interface SealOptions {
  /** 写出 / 停留 / 淡出（秒）。hold < 0 = 一直停留，直到句柄 end() */
  write?: number;
  hold?: number;
  fade?: number;
  /** 内层多边形边数 3–9：每个技能固定用一个，便于辨认 */
  sides?: number;
  /** 停留期间的转速（弧度 / 秒） */
  spin?: number;
  /** 亮度 */
  gain?: number;
  /** 每帧跟着这个点走（脚下的印跟着人）；y 用 followY() 的返回值 */
  follow?: THREE.Vector3;
  followY?: () => number;
}

interface Slot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  live: boolean;
  gen: number;
  age: number;
  write: number;
  hold: number;
  fade: number;
  endAt: number;
  spin: number;
  turn: number;
  gain: number;
  radius: number;
  follow: THREE.Vector3 | null;
  followY: (() => number) | null;
  nx: number; ny: number; nz: number;
  glintAt: number;
}

const _z = new THREE.Vector3(0, 0, 1);
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _head = new THREE.Vector3();
const NOOP_HANDLE: SealHandle = { end() {} };

export class SealEffects {
  readonly group = new THREE.Group();
  private readonly slots: Slot[] = [];
  private readonly geo = new THREE.PlaneGeometry(2, 2);
  /** 写出时领笔的亮点甩出光屑：(位置, 径向, 法线, 颜色) */
  onGlint: ((pos: THREE.Vector3, radial: THREE.Vector3, normal: THREE.Vector3, color: THREE.Color) => void) | null = null;
  /** 累计画出的法印数（自查用） */
  spawned = 0;

  constructor() {
    this.group.name = 'fx.seals';
  }

  get active(): number {
    let n = 0;
    for (const s of this.slots) if (s.live) n++;
    return n;
  }

  private make(): Slot {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uParams: { value: new THREE.Vector4(0, 0, 6, 1) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = ORDER_GLOW - 1;
    mesh.visible = false;
    this.group.add(mesh);
    const s: Slot = {
      mesh, mat, live: false, gen: 0, age: 0, write: 0.25, hold: 0.4, fade: 0.5, endAt: -1, spin: 0.5, turn: 0, gain: 2,
      radius: 1, follow: null, followY: null, nx: 0, ny: 1, nz: 0, glintAt: 0,
    };
    this.slots.push(s);
    return s;
  }

  spawn(center: THREE.Vector3, normal: THREE.Vector3 | null, radius: number, color: number, o: SealOptions = {}): SealHandle {
    if (!(radius > 0) || !Number.isFinite(radius + center.x + center.y + center.z)) return NOOP_HANDLE;
    let s: Slot | null = null;
    let oldest: Slot | null = null;
    for (const x of this.slots) {
      if (!x.live) { s = x; break; }
      if (!oldest || x.age > oldest.age) oldest = x;
    }
    if (!s) s = this.slots.length < MAX ? this.make() : oldest;
    if (!s) return NOOP_HANDLE;
    const len = normal ? normal.length() : 0;
    if (normal && len > 1e-6 && Number.isFinite(len)) _n.copy(normal).multiplyScalar(1 / len);
    else _n.set(0, 1, 0);
    s.live = true;
    s.gen++;
    s.age = 0;
    s.write = Math.max(0.02, o.write ?? 0.25);
    s.hold = o.hold ?? 0.4;
    s.fade = Math.max(0.02, o.fade ?? 0.5);
    s.endAt = -1;
    s.spin = o.spin ?? 0.5;
    s.turn = Math.random() * 6.28;
    s.gain = o.gain ?? 2;
    s.radius = Math.min(30, radius);
    s.follow = o.follow ?? null;
    s.followY = o.followY ?? null;
    s.nx = _n.x; s.ny = _n.y; s.nz = _n.z;
    s.glintAt = 0;
    (s.mat.uniforms.uColor.value as THREE.Color).setHex(color);
    (s.mat.uniforms.uParams.value as THREE.Vector4).set(0, s.turn, Math.min(9, Math.max(3, o.sides ?? 6)), s.gain);
    s.mesh.position.copy(center).addScaledVector(_n, 0.03);
    s.mesh.quaternion.copy(_q.setFromUnitVectors(_z, _n));
    s.mesh.scale.setScalar(s.radius);
    s.mesh.visible = true;
    this.spawned++;
    const slot = s;
    const gen = s.gen;
    return {
      end: (seconds = 0.3) => {
        if (!slot.live || slot.gen !== gen || slot.endAt >= 0) return;
        slot.endAt = slot.age;
        slot.fade = Math.max(0.02, seconds);
      },
    };
  }

  update(dt: number): void {
    if (dt <= 0) return;
    for (const s of this.slots) {
      if (!s.live) continue;
      s.age += dt;
      const written = Math.min(1, s.age / s.write);
      // 写的时候转得快一点（笔势），写完慢下来
      s.turn += dt * s.spin * (written < 1 ? 2.2 : 1);
      let fade = 1;
      if (s.endAt < 0 && s.hold >= 0 && s.age >= s.write + s.hold) s.endAt = s.age;
      if (s.endAt >= 0) {
        const k = (s.age - s.endAt) / s.fade;
        if (k >= 1) {
          s.live = false;
          s.mesh.visible = false;
          continue;
        }
        fade = (1 - k) * (1 - k);
      } else if (written >= 1) {
        fade = 0.86 + 0.14 * Math.sin(s.age * 5.3);
      }
      if (s.follow) {
        const y = s.followY ? s.followY() : s.follow.y;
        s.mesh.position.set(s.follow.x + s.nx * 0.03, y + s.ny * 0.03, s.follow.z + s.nz * 0.03);
      }
      const p = s.mat.uniforms.uParams.value as THREE.Vector4;
      p.x = written;
      p.y = s.turn;
      p.w = fade * s.gain;
      // 领笔的亮点甩出的光屑：只在外圈那一周
      if (this.onGlint && written < 0.22 && s.age >= s.glintAt && s.radius >= 0.5) {
        s.glintAt = s.age + 0.016;
        const a = (Math.min(1, written * 4.6) - 0.5) * Math.PI * 2;
        _head.set(Math.cos(a), Math.sin(a), 0).applyQuaternion(s.mesh.quaternion);
        _n.set(s.nx, s.ny, s.nz);
        const radial = _head.clone();
        _head.multiplyScalar(s.radius * 0.95).add(s.mesh.position);
        this.onGlint(_head, radial, _n, s.mat.uniforms.uColor.value as THREE.Color);
      }
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.live = false;
      s.mesh.visible = false;
    }
  }
}
