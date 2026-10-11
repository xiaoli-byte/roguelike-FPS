/**
 * 刀光弧：一道沿弧线扫过的月牙形刀光（加法混合、白热刃口 → 彩色拖尾），用于近战怪的横斩 / 旋斩 / 交叉斩。
 * 纯视觉，不做伤害判定。弧在「刀光平面」里展开：默认水平（绕世界 Y 轴扫），tilt 绕前方轴倾斜（斜劈 / X 字斩）。
 * 几何体模块级缓存、实例走对象池（同 MirageFireball），逐帧更新挂在 ctx.tasks 上。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';

export interface SlashArcSpec {
  /** 弧心（世界坐标） */
  center: THREE.Vector3;
  /** 刀光中线朝向（世界 yaw，0 = +Z） */
  yaw: number;
  /** 半径（米） */
  radius: number;
  /** 弧长（弧度）；旋斩用接近 2π */
  arc: number;
  /** 扫动方向：1 = 从右往左（俯视逆时针），-1 = 从左往右 */
  dir?: 1 | -1;
  /** 绕前方轴的倾斜（弧度）：0 = 水平横斩 */
  tilt?: number;
  /** 刀光宽度（米） */
  width?: number;
  /** 总时长（秒）：前 55% 扫出，之后淡出 */
  duration?: number;
  color?: number;
}

const SEGMENTS = 40;

const VERT = /* glsl */ `
attribute vec2 arcUv;
varying vec2 vUv;
void main() {
  vUv = arcUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uHead;
uniform float uFade;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // vUv.x：沿弧 0..1（1 = 扫动终点），vUv.y：径向 0（内）..1（外刃口）
  float behind = uHead - vUv.x;
  if (behind < 0.0) discard;
  float tail = exp(-behind * 3.2);
  float edge = smoothstep(0.0, 0.85, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y));
  float hot = smoothstep(0.6, 0.97, vUv.y) * exp(-behind * 7.0);
  float a = tail * edge * uFade;
  vec3 c = mix(uColor, vec3(1.0, 0.97, 0.88), hot);
  gl_FragColor = vec4(c * a * 1.6, a);
}`;

let geo: THREE.BufferGeometry | null = null;
const pool: THREE.Mesh[] = [];

/** 弧带拓扑（SEGMENTS 段 × 内外两圈）；顶点坐标由 shape() 按每次的半径 / 弧长写入，每个实例一份副本 */
function arcGeometry(): THREE.BufferGeometry {
  if (geo) return geo;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    for (const r of [0, 1]) {
      pos.push(t, r, 0); // 占位：实际坐标在 shape() 里按弧长重写
      uv.push(t, r);
    }
    if (i < SEGMENTS) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('arcUv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

function acquire(ctx: GameContext): THREE.Mesh {
  const m = pool.pop() ?? new THREE.Mesh(arcGeometry().clone(), new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uHead: { value: 0 }, uFade: { value: 1 }, uColor: { value: new THREE.Color() } },
  }));
  m.frustumCulled = false;
  m.renderOrder = 3;
  ctx.scene.add(m);
  return m;
}

function release(m: THREE.Mesh): void {
  m.removeFromParent();
  pool.push(m);
}

/** 按弧长、宽度、扫动方向重写弧带顶点（局部空间：弧在 XZ 平面，中线朝 +Z） */
function shape(m: THREE.Mesh, radius: number, arc: number, width: number, dir: number): void {
  const p = m.geometry.getAttribute('position') as THREE.BufferAttribute;
  const inner = Math.max(0.05, radius - width);
  for (let i = 0; i <= SEGMENTS; i++) {
    // t = 0 是扫动起点；dir = 1 时从右侧（-X）扫向左侧（+X）
    const a = (i / SEGMENTS - 0.5) * arc * dir;
    const s = Math.sin(a), c = Math.cos(a);
    p.setXYZ(i * 2, s * inner, 0, c * inner);
    p.setXYZ(i * 2 + 1, s * radius, 0, c * radius);
  }
  p.needsUpdate = true;
  m.geometry.computeBoundingSphere();
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const FORWARD = new THREE.Vector3(0, 0, 1);

export function spawnSlashArc(ctx: GameContext, spec: SlashArcSpec): void {
  const m = acquire(ctx);
  const mat = m.material as THREE.ShaderMaterial;
  const duration = spec.duration ?? 0.22;
  shape(m, spec.radius, spec.arc, spec.width ?? spec.radius * 0.32, spec.dir ?? 1);
  (mat.uniforms.uColor.value as THREE.Color).set(spec.color ?? 0xffc46a);
  mat.uniforms.uHead.value = 0;
  mat.uniforms.uFade.value = 1;
  m.position.copy(spec.center);
  _e.set(0, spec.yaw, 0, 'YXZ');
  m.quaternion.setFromEuler(_e);
  if (spec.tilt) m.quaternion.multiply(_q.setFromAxisAngle(FORWARD, spec.tilt));
  let age = 0;
  ctx.tasks.add((dt) => {
    age += dt;
    const t = age / duration;
    // 前 55% 刀光从起点扫到终点（缓出），之后整体淡出并略向外扩
    mat.uniforms.uHead.value = 1.25 * (1 - Math.pow(1 - Math.min(1, t / 0.55), 2.2));
    mat.uniforms.uFade.value = t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.45);
    m.scale.setScalar(1 + 0.12 * t);
    if (t >= 1) {
      release(m);
      return true;
    }
    return false;
  });
}
