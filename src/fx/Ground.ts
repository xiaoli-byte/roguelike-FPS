/**
 * 贴地特效：冲击波环、地面预警圈、出生法阵、竖直光柱，以及弹孔 / 焦痕。
 *
 * - 贴花都是 XZ 平面上的 2×2 方片 + 程序化片元着色器，按半径缩放；polygonOffset 防 Z-fighting。
 * - 每个贴花槽位有自己的材质实例（uniform 独立），着色器程序共享；全部在构造时预建，运行时零分配。
 * - 弹孔用一个 InstancedMesh（环形覆盖最旧）。
 * - 预警圈可以被取消（攻击被打断）：返回的取消函数带着槽位的世代号（stamp），槽位被复用后旧函数自动失效。
 */
import * as THREE from 'three';
import { ORDER_DECAL, ORDER_FLASH, hexToColor, rand } from './shared';

const MODE_RING = 0;
const MODE_WARNING = 1;
const MODE_CIRCLE = 2;

const ADDITIVE_DECALS = 40;
const WARNING_DECALS = 56;
/** 出生光柱 + 冲击波光墙共用（一波最多十几只同时出生） */
const BANDS = 32;
/** 机炮 20 发/秒打墙时，256 个约 13 秒才会开始覆盖最旧的 */
const HOLES = 256;
/** 弹孔存在时间（秒） */
const HOLE_LIFE = 11;
/**
 * 冲击波光墙只给中小型环（2..8 米）。Boss 换阶段 / 登场的 10–15 米大环是纯装饰，
 * 若也立起一圈齐膝的光墙，会和巨像真正需要跳过的冲击波（由 Boss 自己绘制）混淆。
 */
const BAND_MIN_RADIUS = 2;
const BAND_MAX_RADIUS = 8;
/** 预警圈到时后的收尾闪烁时长 */
const WARNING_OUTRO = 0.14;
/** 预警圈被取消（攻击被打断）后的淡出时长：不闪、不放大，读作「这一下不会来了」 */
const WARNING_CANCEL_FADE = 0.1;

const DECAL_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DECAL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uProgress;
uniform float uTime;
uniform float uMode;
uniform float uSeed;
varying vec2 vP;
const float TAU = 6.2831853;
void main() {
  float d = length(vP);
  if (d > 1.0) discard;
  vec3 col = uColor;
  float a = 0.0;
  if (uMode < 0.5) {
    // 冲击波：一圈亮边 + 内侧淡淡的余波
    float r = uProgress;
    float th = 0.035 + 0.09 * (1.0 - uProgress);
    float ring = smoothstep(th, 0.0, abs(d - r));
    float inner = d < r ? pow(d / max(r, 1e-3), 4.0) * 0.3 : 0.0;
    a = (ring + inner) * uOpacity;
    col = uColor + vec3(0.7) * ring * ring * ring;
  } else if (uMode < 1.5) {
    // 预警：脉动外圈 + 刻度 + 淡底 + 由内向外填满的内圈
    float urgency = uProgress * uProgress;
    float pulse = 0.7 + 0.3 * sin(uTime * (10.0 + urgency * 22.0));
    float edge = smoothstep(0.9, 0.965, d) * (1.0 - smoothstep(0.985, 1.0, d));
    float ang = atan(vP.y, vP.x) / TAU;
    float ticks = step(0.55, fract(ang * 28.0 + uTime * 0.35)) * step(0.83, d) * step(d, 0.88);
    float fill = d < uProgress ? 0.32 + 0.12 * urgency : 0.0;
    float front = smoothstep(0.045, 0.0, abs(d - uProgress)) * step(0.02, uProgress);
    a = edge * pulse + ticks * 0.4 + 0.13 + fill + front * 0.55;
    col = mix(uColor, vec3(1.0, 0.92, 0.85), front * 0.45 + edge * 0.2);
    a = clamp(a, 0.0, 1.0) * uOpacity;
  } else {
    // 出生法阵：双环 + 符文带 + 六芒星，整体旋转
    float rot = uTime * 1.1 + uSeed;
    float ca = cos(rot), sa = sin(rot);
    vec2 p = vec2(ca * vP.x - sa * vP.y, sa * vP.x + ca * vP.y);
    float ring1 = smoothstep(0.028, 0.0, abs(d - 0.95));
    float ring2 = smoothstep(0.018, 0.0, abs(d - 0.78));
    float ring3 = smoothstep(0.016, 0.0, abs(d - 0.28));
    float pa = atan(p.y, p.x) / TAU + 0.5;
    float cell = floor(pa * 20.0);
    float seg = fract(pa * 20.0);
    float glyph = step(0.5, fract(sin(cell * 91.7 + uSeed * 13.0) * 437.58));
    float band = step(0.81, d) * step(d, 0.92) * step(0.18, seg) * step(seg, 0.82);
    float bandIn = band * (0.25 + 0.55 * glyph * step(0.3, fract(seg * 3.0 + d * 7.0)));
    float t1 = -1e3;
    float t2 = -1e3;
    for (int k = 0; k < 3; k++) {
      float an = 1.5707963 + float(k) * 2.0943951;
      t1 = max(t1, dot(p, vec2(cos(an), sin(an))));
      float an2 = an + 1.0471976;
      t2 = max(t2, dot(p, vec2(cos(an2), sin(an2))));
    }
    float star = smoothstep(0.02, 0.0, abs(t1 - 0.39)) + smoothstep(0.02, 0.0, abs(t2 - 0.39));
    star *= step(d, 0.8);
    float fillGlow = (1.0 - d) * 0.18;
    a = (ring1 + ring2 * 0.85 + ring3 * 0.6 + bandIn + star * 0.9 + fillGlow) * uOpacity;
    col = uColor + vec3(0.55) * (ring1 + star) * 0.5;
  }
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

const BAND_VERT = /* glsl */ `
varying float vH;
void main() {
  vH = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BAND_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vH;
void main() {
  float a = pow(1.0 - vH, 1.7) * uOpacity;
  vec3 col = uColor + vec3(0.6) * smoothstep(0.12, 0.0, vH);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

const HOLE_VERT = /* glsl */ `
attribute vec2 aState;
varying vec2 vUv;
varying vec2 vState;
void main() {
  vUv = uv;
  vState = aState;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const HOLE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec2 vState; // x: 不透明度, y: 余热
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float d = length(c);
  if (d > 1.0 || vState.x <= 0.001) discard;
  float ang = atan(c.y, c.x);
  float rough = 1.0 - 0.18 * (0.5 + 0.5 * sin(ang * 7.0 + vUv.x * 3.0));
  float hole = smoothstep(0.3, 0.16, d);
  float scorch = smoothstep(rough, 0.2, d) * 0.6;
  float a = max(hole, scorch) * vState.x;
  vec3 col = vec3(0.03, 0.026, 0.024);
  float heat = vState.y * smoothstep(0.5, 0.08, d);
  col += vec3(1.0, 0.42, 0.1) * heat * 2.2;
  a = max(a, heat * vState.x);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

// 共享几何（模块级缓存）
let decalGeo: THREE.PlaneGeometry | null = null;
let bandGeo: THREE.CylinderGeometry | null = null;
let holeGeo: THREE.PlaneGeometry | null = null;

function getDecalGeo(): THREE.PlaneGeometry {
  if (!decalGeo) {
    decalGeo = new THREE.PlaneGeometry(2, 2);
    decalGeo.rotateX(-Math.PI / 2);
  }
  return decalGeo;
}

function getBandGeo(): THREE.CylinderGeometry {
  if (!bandGeo) {
    bandGeo = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true);
    bandGeo.translate(0, 0.5, 0);
  }
  return bandGeo;
}

function getHoleGeo(): THREE.PlaneGeometry {
  if (!holeGeo) holeGeo = new THREE.PlaneGeometry(1, 1);
  return holeGeo;
}

interface DecalUniforms {
  [k: string]: THREE.IUniform;
  uColor: THREE.IUniform<THREE.Color>;
  uOpacity: THREE.IUniform<number>;
  uProgress: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uMode: THREE.IUniform<number>;
  uSeed: THREE.IUniform<number>;
}

interface Decal {
  mesh: THREE.Mesh;
  u: DecalUniforms;
  active: boolean;
  mode: number;
  age: number;
  duration: number;
  radius: number;
  /** 线性扩散（玩法同步用）还是缓出 */
  linear: boolean;
  /** 世代号：每次被 take 复用都会换新，取消函数据此判断槽位是否还是自己的 */
  stamp: number;
  /** 预警圈取消后的淡出计时（秒）；-1 表示没有被取消 */
  fade: number;
  /** 取消那一刻的不透明度（从这里淡到 0） */
  fadeFrom: number;
}

interface BandUniforms {
  [k: string]: THREE.IUniform;
  uColor: THREE.IUniform<THREE.Color>;
  uOpacity: THREE.IUniform<number>;
}

interface Band {
  mesh: THREE.Mesh;
  u: BandUniforms;
  active: boolean;
  age: number;
  duration: number;
  radius: number;
  height: number;
  /** true：半径随时间扩散（冲击波）；false：高度升起（光柱） */
  expand: boolean;
  linear: boolean;
  stamp: number;
}

const _q = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _Z = new THREE.Vector3(0, 0, 1);

function makeDecalMaterial(additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0 },
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uMode: { value: 0 },
      uSeed: { value: 0 },
    },
    vertexShader: DECAL_VERT,
    fragmentShader: DECAL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
}

export class GroundEffects {
  readonly group = new THREE.Group();
  private readonly additive: Decal[] = [];
  private readonly warnings: Decal[] = [];
  private readonly bands: Band[] = [];
  private stamp = 0;
  private time = 0;

  private readonly holes: THREE.InstancedMesh;
  private readonly holeState: Float32Array;
  private readonly holeStateAttr: THREE.InstancedBufferAttribute;
  private readonly holeAge: Float32Array;
  private readonly holeLife: Float32Array;
  private readonly holeHeat: Float32Array;
  private holeCursor = 0;
  private holeCount = 0;

  constructor() {
    this.group.name = 'fx.ground';
    for (let i = 0; i < ADDITIVE_DECALS; i++) this.additive.push(this.makeDecal(true, i));
    for (let i = 0; i < WARNING_DECALS; i++) this.warnings.push(this.makeDecal(false, i));
    for (let i = 0; i < BANDS; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 0 } },
        vertexShader: BAND_VERT,
        fragmentShader: BAND_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(getBandGeo(), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = ORDER_FLASH;
      this.group.add(mesh);
      this.bands.push({
        mesh, u: mat.uniforms as BandUniforms, active: false, age: 0, duration: 1, radius: 1, height: 1,
        expand: true, linear: false, stamp: 0,
      });
    }

    // 弹孔
    this.holeState = new Float32Array(HOLES * 2);
    this.holeStateAttr = new THREE.InstancedBufferAttribute(this.holeState, 2);
    this.holeStateAttr.setUsage(THREE.DynamicDrawUsage);
    this.holeAge = new Float32Array(HOLES);
    this.holeLife = new Float32Array(HOLES);
    this.holeHeat = new Float32Array(HOLES);
    const holeGeoInst = getHoleGeo().clone();
    holeGeoInst.setAttribute('aState', this.holeStateAttr);
    const holeMat = new THREE.ShaderMaterial({
      vertexShader: HOLE_VERT,
      fragmentShader: HOLE_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    this.holes = new THREE.InstancedMesh(holeGeoInst, holeMat, HOLES);
    this.holes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.holes.count = 0;
    this.holes.frustumCulled = false;
    this.holes.matrixAutoUpdate = false;
    this.holes.renderOrder = ORDER_DECAL - 1;
    this.holes.name = 'fx.holes';
    this.group.add(this.holes);
  }

  private makeDecal(additive: boolean, i: number): Decal {
    const mat = makeDecalMaterial(additive);
    const mesh = new THREE.Mesh(getDecalGeo(), mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    // 一百多个贴花常驻场景：只有活跃的才更新矩阵（place / update 里手动 updateMatrix）
    mesh.matrixAutoUpdate = false;
    // 普通混合的预警圈先画，加法混合的光环叠在上面
    mesh.renderOrder = additive ? ORDER_DECAL + 1 : ORDER_DECAL;
    mesh.name = additive ? `fx.decal.add${i}` : `fx.decal.warn${i}`;
    this.group.add(mesh);
    return {
      mesh, u: mat.uniforms as DecalUniforms, active: false, mode: 0, age: 0, duration: 1, radius: 1, linear: false, stamp: 0,
      fade: -1, fadeFrom: 0,
    };
  }

  private take<T extends { active: boolean; stamp: number }>(pool: T[]): T {
    let oldest = pool[0];
    for (const it of pool) {
      if (!it.active) return it;
      if (it.stamp < oldest.stamp) oldest = it;
    }
    return oldest;
  }

  /** 预警圈槽位：空闲的优先，其次是正在淡出（已取消）的，最后才挤掉最旧的仍有效预警 */
  private takeWarning(): Decal {
    let oldest = this.warnings[0];
    let fading: Decal | null = null;
    for (const d of this.warnings) {
      if (!d.active) return d;
      if (d.fade >= 0 && (!fading || d.stamp < fading.stamp)) fading = d;
      if (d.stamp < oldest.stamp) oldest = d;
    }
    return fading ?? oldest;
  }

  /** 取消预警圈：槽位已被复用（世代号变了）、已回收或已在淡出时什么都不做，所以重复调用、迟到调用都安全 */
  private cancelWarning(d: Decal, stamp: number): void {
    if (!d.active || d.stamp !== stamp || d.mode !== MODE_WARNING || d.fade >= 0) return;
    d.fade = 0;
    d.fadeFrom = d.u.uOpacity.value;
  }

  private place(d: Decal, center: THREE.Vector3, lift: number): void {
    // 同一位置叠多个贴花时错开一点高度
    d.mesh.position.set(center.x, center.y + lift + (d.stamp % 7) * 0.0025, center.z);
    d.mesh.scale.set(d.radius, 1, d.radius);
    d.mesh.updateMatrix();
    d.mesh.visible = true;
  }

  private setDecalScale(d: Decal, s: number): void {
    d.mesh.scale.set(s, 1, s);
    d.mesh.updateMatrix();
  }

  // ───────────── 发射 ─────────────
  // 调用方（FxSystem）已保证 center 为有限向量、radius / duration 为有限正数。

  /** 地面扩散冲击波环（中小型环带竖直光墙） */
  ring(center: THREE.Vector3, radius: number, color: number, duration: number, withBand: boolean): void {
    const d = this.take(this.additive);
    d.active = true;
    d.mode = MODE_RING;
    d.age = 0;
    d.duration = Math.max(0.05, duration);
    d.radius = Math.max(0.1, radius);
    // 一律缓出：所有调用方的环都是装饰（Boss 的伤害冲击波由 Boss 自己绘制）。
    // 线性扩散的 0.5 秒 6.5 米环速度≈13 m/s，和巨像真正要跳过的 12 m/s 冲击波几乎一样，容易误导；
    // 缓出的环一开始就几乎到位、随后淡出，读作「这一下的爆发范围」。
    d.linear = false;
    d.stamp = ++this.stamp;
    hexToColor(color, d.u.uColor.value);
    d.u.uMode.value = MODE_RING;
    d.u.uProgress.value = 0;
    d.u.uOpacity.value = 1;
    this.place(d, center, 0.03);
    if (withBand && radius >= BAND_MIN_RADIUS && radius <= BAND_MAX_RADIUS) {
      const h = Math.min(0.42, Math.max(0.15, radius * 0.055));
      this.band(center, radius, h, color, duration, true, d.linear);
    }
  }

  /**
   * 地面预警圈：duration 秒内由内向外填满，到时闪一下消失。
   * 返回取消函数：调用后预警圈停止填充、约 0.1 秒内淡出并回收；只作用于这一次生成的预警（按世代号判断）。
   */
  warning(center: THREE.Vector3, radius: number, duration: number, color: number): () => void {
    const d = this.takeWarning();
    d.active = true;
    d.mode = MODE_WARNING;
    d.age = 0;
    d.duration = Math.max(0.05, duration);
    d.radius = Math.max(0.2, radius);
    d.linear = true;
    d.stamp = ++this.stamp;
    d.fade = -1;
    d.fadeFrom = 0;
    hexToColor(color, d.u.uColor.value);
    d.u.uMode.value = MODE_WARNING;
    d.u.uProgress.value = 0;
    d.u.uOpacity.value = 0;
    d.u.uSeed.value = Math.random() * 10;
    this.place(d, center, 0.025);
    const stamp = d.stamp;
    return () => this.cancelWarning(d, stamp);
  }

  /** 旋转法阵（出生特效） */
  circle(center: THREE.Vector3, radius: number, color: number, duration: number): void {
    const d = this.take(this.additive);
    d.active = true;
    d.mode = MODE_CIRCLE;
    d.age = 0;
    d.duration = duration;
    d.radius = radius;
    d.linear = false;
    d.stamp = ++this.stamp;
    hexToColor(color, d.u.uColor.value);
    d.u.uMode.value = MODE_CIRCLE;
    d.u.uProgress.value = 0;
    d.u.uOpacity.value = 0;
    d.u.uSeed.value = Math.random() * 6.28;
    this.place(d, center, 0.035);
    this.setDecalScale(d, 0.01);
  }

  /** 竖直光带：expand=true 时半径扩散（冲击波墙），否则高度升起（光柱） */
  band(center: THREE.Vector3, radius: number, height: number, color: number, duration: number, expand: boolean, linear = false): void {
    const b = this.take(this.bands);
    b.active = true;
    b.age = 0;
    b.duration = Math.max(0.05, duration);
    b.radius = radius;
    b.height = height;
    b.expand = expand;
    b.linear = linear;
    b.stamp = ++this.stamp;
    hexToColor(color, b.u.uColor.value);
    b.u.uOpacity.value = 0;
    b.mesh.position.set(center.x, center.y + 0.02, center.z);
    b.mesh.scale.set(expand ? 0.01 : radius, height, expand ? 0.01 : radius);
    b.mesh.updateMatrix();
    b.mesh.visible = true;
  }

  /**
   * 弹孔 / 焦痕。normal 需为单位向量；size 为直径（米）；heat 0..1 为初始余热发光。
   */
  hole(point: THREE.Vector3, normal: THREE.Vector3, size: number, heat: number, life = HOLE_LIFE): void {
    const i = this.holeCursor;
    this.holeCursor = (i + 1) % HOLES;
    if (this.holeCount < HOLES) this.holeCount++;
    _n.copy(normal);
    _q.setFromUnitVectors(_Z, _n);
    _qRoll.setFromAxisAngle(_Z, Math.random() * Math.PI * 2);
    _q.multiply(_qRoll);
    _p.copy(point).addScaledVector(_n, 0.012);
    const s = size * rand(0.85, 1.15);
    _s.set(s, s, 1);
    _m.compose(_p, _q, _s);
    this.holes.setMatrixAt(i, _m);
    this.holes.instanceMatrix.addUpdateRange(i * 16, 16);
    this.holes.instanceMatrix.needsUpdate = true;
    this.holeAge[i] = 0;
    this.holeLife[i] = life;
    this.holeHeat[i] = heat;
    this.holeState[i * 2] = 1;
    this.holeState[i * 2 + 1] = heat;
    this.holes.count = this.holeCount;
  }

  // ───────────── 推进 ─────────────

  update(dt: number): void {
    this.time += dt;
    const time = this.time;

    for (const d of this.additive) {
      if (!d.active) continue;
      d.age += dt;
      const t = d.age / d.duration;
      if (t >= 1) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      d.u.uTime.value = time;
      if (d.mode === MODE_RING) {
        const p = d.linear ? t : 1 - (1 - t) * (1 - t) * (1 - t);
        d.u.uProgress.value = p;
        d.u.uOpacity.value = Math.pow(1 - t, 1.3) * (d.linear ? 1 : 1.2);
      } else {
        // 法阵：弹出 → 旋转 → 淡出
        const pop = Math.min(1, d.age / 0.16);
        const s = pop < 1 ? 1 - Math.pow(1 - pop, 3) * (1 - 0.35 * Math.sin(pop * Math.PI)) : 1;
        if (pop < 1 || d.mesh.scale.x !== d.radius) this.setDecalScale(d, d.radius * Math.max(0.01, s));
        const fin = Math.min(1, d.age / 0.1);
        const fout = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
        d.u.uOpacity.value = fin * fout * 1.1;
        d.u.uProgress.value = t;
      }
    }

    for (const d of this.warnings) {
      if (!d.active) continue;
      d.u.uTime.value = time;
      if (d.fade >= 0) {
        // 被取消：填充进度停在原处，从取消时的不透明度淡到 0 后回收（不闪、不放大）
        d.fade += dt;
        const o = d.fade / WARNING_CANCEL_FADE;
        if (o >= 1) {
          d.active = false;
          d.mesh.visible = false;
          d.fade = -1;
          continue;
        }
        d.u.uOpacity.value = d.fadeFrom * (1 - o) * (1 - o);
        continue;
      }
      d.age += dt;
      if (d.age >= d.duration) {
        // 收尾：填满后亮一下并略微放大，然后消失
        const o = (d.age - d.duration) / WARNING_OUTRO;
        if (o >= 1) {
          d.active = false;
          d.mesh.visible = false;
          continue;
        }
        d.u.uProgress.value = 1;
        d.u.uOpacity.value = (1 - o) * 1.25;
        this.setDecalScale(d, d.radius * (1 + o * 0.06));
      } else {
        const t = d.age / d.duration;
        d.u.uProgress.value = t;
        d.u.uOpacity.value = Math.min(1, d.age / 0.1) * 0.95;
      }
    }

    for (const b of this.bands) {
      if (!b.active) continue;
      b.age += dt;
      const t = b.age / b.duration;
      if (t >= 1) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      if (b.expand) {
        const p = b.linear ? t : 1 - (1 - t) * (1 - t) * (1 - t);
        const r = Math.max(0.01, b.radius * p);
        b.mesh.scale.set(r, b.height, r);
        b.u.uOpacity.value = (1 - t) * 0.9;
      } else {
        // 光柱：快速升起，收窄淡出
        const rise = 1 - Math.pow(1 - Math.min(1, t * 2.2), 2);
        const w = b.radius * (1 - t * 0.6);
        b.mesh.scale.set(w, Math.max(0.01, b.height * rise), w);
        b.u.uOpacity.value = Math.sin(Math.min(1, t) * Math.PI) * 0.85;
      }
      b.mesh.updateMatrix();
    }

    if (this.holeCount > 0 && dt > 0) {
      const st = this.holeState;
      for (let i = 0; i < this.holeCount; i++) {
        const life = this.holeLife[i];
        if (life <= 0) continue;
        const age = (this.holeAge[i] += dt);
        if (age >= life) {
          this.holeLife[i] = 0;
          st[i * 2] = 0;
          st[i * 2 + 1] = 0;
          continue;
        }
        st[i * 2] = age > life - 2 ? (life - age) / 2 : 1;
        st[i * 2 + 1] = this.holeHeat[i] * Math.max(0, 1 - age / 0.6);
      }
      this.holeStateAttr.needsUpdate = true;
    }
  }

  clear(): void {
    for (const d of this.additive) {
      d.active = false;
      d.mesh.visible = false;
    }
    for (const d of this.warnings) {
      d.active = false;
      d.mesh.visible = false;
      d.fade = -1;
    }
    for (const b of this.bands) {
      b.active = false;
      b.mesh.visible = false;
    }
    this.holeState.fill(0);
    this.holeLife.fill(0);
    this.holeStateAttr.needsUpdate = true;
    this.holeCount = 0;
    this.holeCursor = 0;
    this.holes.count = 0;
  }
}
