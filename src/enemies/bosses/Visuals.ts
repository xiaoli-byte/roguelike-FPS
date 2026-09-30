/**
 * Boss 危险物的可视化基元：
 *  - GroundDecal：贴地着色器贴花（圆 / 环带 / 扇形 / 长条），用于预警与持续伤害区。
 *  - BeamMesh：两层圆柱光束（内芯 + 外晕），用于扫射光束、瞄准线、冰晶链接。
 *  - waveWallGeometry：冲击波环的竖直光墙（顶部透明渐变，可限定扇形）。
 * 几何体与着色器模板模块级缓存；实例（含各自的材质克隆）走对象池复用、从不释放——
 * 这样着色器程序始终被引用，不会在「最后一个预警消失」时被 three.js 销毁、下次出现时再编译卡顿。
 */
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

// ───────────── 贴地贴花 ─────────────

const DECAL_VERT = /* glsl */ `
uniform vec2 uHalf;
uniform vec2 uOff;
varying vec2 vP;
void main() {
  vec3 p = vec3(position.x * uHalf.x + uOff.x, 0.0, position.y * uHalf.y + uOff.y);
  vP = p.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const DECAL_FRAG = /* glsl */ `
#define PI 3.14159265
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uShape;
uniform float uInner;
uniform float uOuter;
uniform float uSoft;
uniform float uArcCenter;
uniform float uArcHalf;
uniform vec2 uRect;
uniform float uFill;
uniform float uPattern;
varying vec2 vP;
void main() {
  float mask;
  float edge;
  float prog;
  if (uShape < 0.5) {
    float d = length(vP);
    float ang = atan(vP.x, vP.y);
    float da = abs(mod(ang - uArcCenter + PI, 2.0 * PI) - PI);
    float arc = uArcHalf >= PI ? 1.0 : 1.0 - smoothstep(0.0, uSoft, d * sin(clamp(da - uArcHalf, 0.0, 1.5)));
    float inner = uInner > 0.0 ? smoothstep(uInner - uSoft, uInner, d) : 1.0;
    float outer = 1.0 - smoothstep(uOuter, uOuter + uSoft, d);
    mask = inner * outer * arc;
    edge = 1.0 - smoothstep(0.0, 0.45, abs(d - uOuter));
    if (uInner > 0.0) edge = max(edge, 1.0 - smoothstep(0.0, 0.45, abs(d - uInner)));
    if (uArcHalf < PI) edge = max(edge, (1.0 - smoothstep(0.0, 0.35, d * sin(abs(da - uArcHalf)))) * step(da, uArcHalf + 0.2));
    float base = max(uInner, 0.0);
    prog = (d - base) / max(0.001, uOuter - base);
  } else {
    float ax = abs(vP.x);
    mask = (1.0 - smoothstep(uRect.x, uRect.x + uSoft, ax)) * smoothstep(-uSoft, 0.0, vP.y) * (1.0 - smoothstep(uRect.y, uRect.y + uSoft, vP.y));
    edge = 1.0 - smoothstep(0.0, 0.3, abs(ax - uRect.x));
    prog = vP.y / max(0.001, uRect.y);
  }
  if (mask <= 0.002) discard;
  float a;
  vec3 col = uColor;
  if (uPattern < 0.5) {
    // 预警：淡底 + 亮边 + 由内向外（或沿长条）推进的填充
    float fill = 1.0 - smoothstep(uFill - 0.03, uFill, prog);
    float front = (1.0 - smoothstep(0.0, 0.06, abs(prog - uFill))) * step(0.01, uFill);
    float chev = uShape > 0.5 ? step(0.55, fract(vP.y * 0.3 - abs(vP.x) * 0.3 - uTime * 1.6)) : 0.0;
    a = 0.16 + edge * 0.75 + fill * 0.32 + front * 0.6 + chev * 0.12;
  } else {
    // 持续伤害区：流动的熔岩 / 火焰纹理
    float n = sin(vP.x * 1.3 + uTime * 1.2) * sin(vP.y * 1.5 - uTime * 0.9);
    n += 0.6 * sin((vP.x - vP.y) * 0.8 + uTime * 2.3);
    n += 0.35 * sin(length(vP) * 2.2 - uTime * 3.0);
    float hot = clamp(0.5 + 0.3 * n, 0.0, 1.0);
    col = mix(uColor * 0.55, uColor * 1.35 + vec3(0.25, 0.18, 0.05), hot);
    a = 0.38 + 0.3 * hot + edge * 0.5;
  }
  a = clamp(a * mask * uOpacity, 0.0, 1.0);
  gl_FragColor = vec4(col * (1.0 + edge * 0.5), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface DecalUniforms {
  uColor: { value: THREE.Color };
  uOpacity: { value: number };
  uTime: { value: number };
  uShape: { value: number };
  uInner: { value: number };
  uOuter: { value: number };
  uSoft: { value: number };
  uArcCenter: { value: number };
  uArcHalf: { value: number };
  uRect: { value: THREE.Vector2 };
  uHalf: { value: THREE.Vector2 };
  uOff: { value: THREE.Vector2 };
  uFill: { value: number };
  uPattern: { value: number };
}

let decalGeo: THREE.PlaneGeometry | null = null;
let decalTemplate: THREE.ShaderMaterial | null = null;

function decalMaterial(): THREE.ShaderMaterial {
  if (!decalTemplate) {
    decalTemplate = new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(0xff5533) },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        uShape: { value: 0 },
        uInner: { value: 0 },
        uOuter: { value: 1 },
        uSoft: { value: 0.25 },
        uArcCenter: { value: 0 },
        uArcHalf: { value: 4 },
        uRect: { value: new THREE.Vector2(1, 1) },
        uHalf: { value: new THREE.Vector2(1, 1) },
        uOff: { value: new THREE.Vector2(0, 0) },
        uFill: { value: 0 },
        uPattern: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }
  return decalTemplate.clone();
}

const decalPool: GroundDecal[] = [];

/** 贴地贴花。形状在着色器里计算，mesh 只是一块被拉伸的平面。用 acquire / release 取还。 */
export class GroundDecal {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly u: DecalUniforms;
  private pooled = false;

  private constructor() {
    if (!decalGeo) decalGeo = new THREE.PlaneGeometry(2, 2, 1, 1);
    this.mat = decalMaterial();
    this.u = this.mat.uniforms as unknown as DecalUniforms;
    this.mesh = new THREE.Mesh(decalGeo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  static acquire(parent: THREE.Object3D, color: number): GroundDecal {
    const d = decalPool.pop() ?? new GroundDecal();
    d.pooled = false;
    const u = d.u;
    u.uColor.value.setHex(color);
    u.uOpacity.value = 1;
    u.uTime.value = 0;
    u.uFill.value = 0;
    u.uPattern.value = 0;
    u.uSoft.value = 0.25;
    u.uInner.value = 0;
    u.uArcCenter.value = 0;
    u.uArcHalf.value = 4;
    d.mesh.visible = true;
    parent.add(d.mesh);
    return d;
  }

  /** 圆 / 环带 / 扇形。inner=0 为实心；arcHalf>=PI 为整圆；arcCenter 与 facing 同约定（atan2(dx,dz)） */
  circle(x: number, y: number, z: number, outer: number, inner = 0, arcCenter = 0, arcHalf = Math.PI): this {
    const u = this.u;
    u.uShape.value = 0;
    this.mesh.position.set(x, y + 0.04, z);
    this.mesh.rotation.set(0, 0, 0);
    u.uArcCenter.value = arcCenter;
    u.uArcHalf.value = arcHalf >= Math.PI - 1e-3 ? 4 : arcHalf;
    this.setRadii(outer, inner);
    return this;
  }

  setRadii(outer: number, inner = 0): void {
    const u = this.u;
    u.uOuter.value = Math.max(0.01, outer);
    u.uInner.value = Math.max(0, inner);
    const ext = outer + u.uSoft.value + 0.5;
    u.uHalf.value.set(ext, ext);
    u.uOff.value.set(0, 0);
  }

  /** 从 (x,z) 出发、朝 yaw 方向延伸 length、半宽 halfWidth 的长条 */
  rect(x: number, y: number, z: number, yaw: number, length: number, halfWidth: number): this {
    const u = this.u;
    u.uShape.value = 1;
    this.mesh.position.set(x, y + 0.04, z);
    this.mesh.rotation.set(0, yaw, 0);
    u.uRect.value.set(halfWidth, length);
    const s = u.uSoft.value + 0.4;
    u.uHalf.value.set(halfWidth + s, length / 2 + s);
    u.uOff.value.set(0, length / 2);
    return this;
  }

  set opacity(v: number) {
    this.u.uOpacity.value = v;
  }
  set fill(v: number) {
    this.u.uFill.value = v;
  }
  set time(v: number) {
    this.u.uTime.value = v;
  }
  /** 0 = 预警样式，1 = 持续伤害区（流动纹理） */
  set pattern(v: number) {
    this.u.uPattern.value = v;
  }
  set soft(v: number) {
    this.u.uSoft.value = v;
  }
  setColor(hex: number): void {
    this.u.uColor.value.setHex(hex);
  }

  /** 归还对象池（可重复调用） */
  release(): void {
    if (this.pooled) return;
    this.pooled = true;
    this.mesh.removeFromParent();
    decalPool.push(this);
  }
}

// ───────────── 光束 ─────────────

let beamGeo: THREE.CylinderGeometry | null = null;

const beamPool: BeamMesh[] = [];

/** 两层圆柱光束；set(a, b, r) 每帧摆放，无分配。用 acquire / release 取还。 */
export class BeamMesh {
  readonly group = new THREE.Group();
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private readonly core: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private baseOpacity = 1;
  private pooled = false;

  private constructor() {
    if (!beamGeo) beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.coreMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.haloMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.core = new THREE.Mesh(beamGeo, this.coreMat);
    this.core.scale.set(0.4, 1, 0.4);
    this.halo = new THREE.Mesh(beamGeo, this.haloMat);
    this.core.frustumCulled = false;
    this.halo.frustumCulled = false;
    this.group.add(this.halo, this.core);
    this.group.renderOrder = 4;
  }

  static acquire(parent: THREE.Object3D, color: number, coreColor = 0xfff4e0): BeamMesh {
    const b = beamPool.pop() ?? new BeamMesh();
    b.pooled = false;
    b.haloMat.color.setHex(color);
    b.coreMat.color.setHex(coreColor);
    b.setOpacity(1);
    b.group.visible = true;
    b.group.scale.set(0.001, 0.001, 0.001);
    parent.add(b.group);
    return b;
  }

  set(a: THREE.Vector3, b: THREE.Vector3, radius: number): void {
    _dir.subVectors(b, a);
    const len = _dir.length();
    if (len < 1e-4) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    _dir.multiplyScalar(1 / len);
    this.group.position.addVectors(a, b).multiplyScalar(0.5);
    this.group.quaternion.setFromUnitVectors(UP, _dir);
    this.group.scale.set(radius, len, radius);
  }

  setOpacity(o: number): void {
    this.baseOpacity = o;
    this.coreMat.opacity = 0.95 * o;
    this.haloMat.opacity = 0.55 * o;
  }

  /** 叠加闪烁（不改变基础透明度） */
  flicker(k: number): void {
    this.coreMat.opacity = 0.95 * this.baseOpacity * k;
    this.haloMat.opacity = 0.55 * this.baseOpacity * k;
  }

  setColor(hex: number): void {
    this.haloMat.color.setHex(hex);
  }

  setCoreColor(hex: number): void {
    this.coreMat.color.setHex(hex);
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  /** 归还对象池（可重复调用） */
  release(): void {
    if (this.pooled) return;
    this.pooled = true;
    this.group.removeFromParent();
    beamPool.push(this);
  }
}

// ───────────── 冲击波光墙 ─────────────

const wallGeos = new Map<string, THREE.BufferGeometry>();

/**
 * 半径 1、高 1（底面 y=0）的开口圆柱侧面，顶点 alpha 自下而上 1→0。
 * arcHalf < PI 时只生成以 +Z 为中心、半角 arcHalf 的扇形段（旋转 mesh.rotation.y 对准方向）。
 */
export function waveWallGeometry(arcHalf: number): THREE.BufferGeometry {
  const full = arcHalf >= Math.PI - 1e-3;
  const key = full ? 'full' : arcHalf.toFixed(2);
  let g = wallGeos.get(key);
  if (g) return g;
  const segs = full ? 64 : Math.max(8, Math.ceil((64 * arcHalf) / Math.PI));
  const cg = full
    ? new THREE.CylinderGeometry(1, 1, 1, segs, 1, true)
    : new THREE.CylinderGeometry(1, 1, 1, segs, 1, true, -arcHalf, arcHalf * 2);
  cg.translate(0, 0.5, 0);
  const pos = cg.getAttribute('position');
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const top = pos.getY(i) > 0.5;
    col[i * 4] = 1;
    col[i * 4 + 1] = 1;
    col[i * 4 + 2] = 1;
    col[i * 4 + 3] = top ? 0 : 1;
  }
  cg.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g = cg;
  wallGeos.set(key, g);
  return g;
}

const wallMatPool: THREE.MeshBasicMaterial[] = [];

/** 取一份冲击波光墙材质（对象池，用完 releaseWaveWallMaterial 归还） */
export function acquireWaveWallMaterial(color: number): THREE.MeshBasicMaterial {
  const m = wallMatPool.pop() ?? new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  m.color.setHex(color);
  m.opacity = 1;
  return m;
}

export function releaseWaveWallMaterial(m: THREE.MeshBasicMaterial): void {
  if (!wallMatPool.includes(m)) wallMatPool.push(m);
}
