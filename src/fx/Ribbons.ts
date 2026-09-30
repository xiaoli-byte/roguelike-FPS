/**
 * 朝向相机的发光四边形批渲染器（立即模式）。
 *
 * 每帧：begin(相机位置) → 若干 quad(A, B, 宽度, 颜色, 透明度) → end()。
 * 所有 quad 写进同一个动态 BufferGeometry，一次 draw call。
 * 用于 tracer、光束、闪电、火花拖尾。
 */
import * as THREE from 'three';
import { GLSL_FOG_FADE, ORDER_RIBBON } from './shared';

/** 普通柔光条 */
export const RIBBON_SOFT = 0;
/** 光束：沿长度滚动的能量波纹 */
export const RIBBON_BEAM = 1;

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute vec3 aParams; // x: 横向 -1..1, y: 沿长度（米）, z: 风格
varying vec4 vColor;
varying vec3 vParams;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vParams = aParams;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec4 vColor;
varying vec3 vParams;
#include <fog_pars_fragment>
void main() {
  float across = abs(vParams.x);
  float soft = 1.0 - across;
  soft *= soft;
  float core = smoothstep(0.4, 0.0, across);
  vec3 col = vColor.rgb + vec3(0.9) * core * core;
  float a = vColor.a * (soft + core * 0.6);
  if (vParams.z > 0.5) {
    float s = vParams.y;
    float w1 = sin(s * 6.0 - uTime * 38.0) * 0.5 + 0.5;
    float w2 = sin(s * 1.7 + uTime * 21.0) * 0.5 + 0.5;
    a *= 0.62 + 0.38 * w1 * (0.6 + 0.4 * w2);
  }
  ${GLSL_FOG_FADE}
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

const _side = new THREE.Vector3();

export class RibbonBatch {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  readonly timeUniform = { value: 0 };

  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly par: Float32Array;
  private readonly aPos: THREE.BufferAttribute;
  private readonly aCol: THREE.BufferAttribute;
  private readonly aPar: THREE.BufferAttribute;
  private readonly geo: THREE.BufferGeometry;
  private count = 0;
  private lastCount = 0;
  private cx = 0;
  private cy = 0;
  private cz = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    const v = capacity * 4;
    this.pos = new Float32Array(v * 3);
    this.col = new Float32Array(v * 4);
    this.par = new Float32Array(v * 3);
    const idx = new Uint16Array(capacity * 6);
    for (let q = 0; q < capacity; q++) {
      const b = q * 4, o = q * 6;
      idx[o] = b;
      idx[o + 1] = b + 1;
      idx[o + 2] = b + 2;
      idx[o + 3] = b;
      idx[o + 4] = b + 2;
      idx[o + 5] = b + 3;
    }
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aPar = new THREE.BufferAttribute(this.par, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aParams', this.aPar);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    mat.uniforms.uTime = this.timeUniform;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = ORDER_RIBBON;
    this.mesh.name = 'fx.ribbons';
  }

  get full(): boolean {
    return this.count >= this.capacity;
  }

  begin(cam: THREE.Vector3, time: number): void {
    this.count = 0;
    this.cx = cam.x;
    this.cy = cam.y;
    this.cz = cam.z;
    this.timeUniform.value = time;
  }

  /**
   * 写入一个从 A 到 B 的朝向相机四边形。
   * wa / wb 为两端半宽（米），aa / ab 为两端透明度，颜色为线性空间 RGB。
   * along0 / along1 为两端的「沿长度坐标」，光束风格用它做波纹。
   */
  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    wa: number, wb: number,
    r: number, g: number, b: number,
    aa: number, ab: number,
    style = RIBBON_SOFT, along0 = 0, along1 = 0,
  ): void {
    if (this.count >= this.capacity) return;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    // 视线：相机 → 线段中点
    const vx = (ax + bx) * 0.5 - this.cx;
    const vy = (ay + by) * 0.5 - this.cy;
    const vz = (az + bz) * 0.5 - this.cz;
    _side.set(dy * vz - dz * vy, dz * vx - dx * vz, dx * vy - dy * vx);
    const len = _side.length();
    if (len < 1e-7) return;
    const sx = _side.x / len, sy = _side.y / len, sz = _side.z / len;

    const q = this.count++;
    let o = q * 12;
    const p = this.pos;
    p[o] = ax - sx * wa; p[o + 1] = ay - sy * wa; p[o + 2] = az - sz * wa;
    p[o + 3] = ax + sx * wa; p[o + 4] = ay + sy * wa; p[o + 5] = az + sz * wa;
    p[o + 6] = bx + sx * wb; p[o + 7] = by + sy * wb; p[o + 8] = bz + sz * wb;
    p[o + 9] = bx - sx * wb; p[o + 10] = by - sy * wb; p[o + 11] = bz - sz * wb;

    o = q * 16;
    const c = this.col;
    c[o] = r; c[o + 1] = g; c[o + 2] = b; c[o + 3] = aa;
    c[o + 4] = r; c[o + 5] = g; c[o + 6] = b; c[o + 7] = aa;
    c[o + 8] = r; c[o + 9] = g; c[o + 10] = b; c[o + 11] = ab;
    c[o + 12] = r; c[o + 13] = g; c[o + 14] = b; c[o + 15] = ab;

    o = q * 12;
    const m = this.par;
    m[o] = -1; m[o + 1] = along0; m[o + 2] = style;
    m[o + 3] = 1; m[o + 4] = along0; m[o + 5] = style;
    m[o + 6] = 1; m[o + 7] = along1; m[o + 8] = style;
    m[o + 9] = -1; m[o + 10] = along1; m[o + 11] = style;
  }

  end(): void {
    const n = this.count;
    if (n > 0 || this.lastCount > 0) {
      const v = Math.max(n, 1) * 4;
      this.aPos.clearUpdateRanges();
      this.aPos.addUpdateRange(0, v * 3);
      this.aPos.needsUpdate = true;
      this.aCol.clearUpdateRanges();
      this.aCol.addUpdateRange(0, v * 4);
      this.aCol.needsUpdate = true;
      this.aPar.clearUpdateRanges();
      this.aPar.addUpdateRange(0, v * 3);
      this.aPar.needsUpdate = true;
    }
    this.lastCount = n;
    this.geo.setDrawRange(0, n * 6);
  }
}
