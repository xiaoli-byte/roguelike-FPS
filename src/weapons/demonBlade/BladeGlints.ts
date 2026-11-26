/**
 * 第一人称视图里的小光点（Unity BladeGlints.cs，M10）：刚归位的碎片闪一下（归位闪）、剑指指尖的灵光、判定帧刃口的白热一闪。
 * 每帧 begin → 若干 add（父物体局部坐标，近似相机空间）→ end：拼成一块面向镜头的方片网格，柔光贴图、加色，顶点色带每颗的亮度。
 * 调用方给「sRGB 色 × HDR 倍率」：THREE.Color.setHex 已经是线性值，倍率原样乘（同 Unity Vertex：色相转线性、倍率乘回）。
 */
import * as THREE from 'three';

export const GLINT_MAX = 160;

let glowTexture: THREE.Texture | null = null;

/** 柔光贴图（中心白、向外高斯收掉；同 Unity M_Fx_Glow） */
function glowMap(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1;
      const r2 = dx * dx + dy * dy;
      const a = r2 >= 1 ? 0 : Math.exp(-r2 * 4.5) * (1 - r2);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  glowTexture = t;
  return t;
}

export class BladeGlints {
  readonly mesh: THREE.Mesh;
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.MeshBasicMaterial;
  private count = 0;
  /** 上一帧画了几颗（测试读） */
  lastCount = 0;

  constructor() {
    const uv = new Float32Array(GLINT_MAX * 8);
    const idx = new Uint16Array(GLINT_MAX * 6);
    for (let i = 0; i < GLINT_MAX; i++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    this.pos = new THREE.BufferAttribute(new Float32Array(GLINT_MAX * 12), 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(new Float32Array(GLINT_MAX * 16), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('color', this.col);
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.MeshBasicMaterial({
      map: glowMap(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    this.mesh.name = 'demonBlade.glints';
    this.mesh.visible = false;
  }

  begin(): void {
    this.count = 0;
  }

  /** 一颗光点：中心（父物体局部坐标）、直径（米）、颜色（线性 × HDR 倍率）、强度（alpha） */
  add(center: THREE.Vector3, size: number, color: THREE.Color, alpha: number): void {
    if (this.count >= GLINT_MAX || !(size > 1e-4) || !(alpha > 0.004)) return;
    const h = size * 0.5;
    const P = this.pos.array as Float32Array, C = this.col.array as Float32Array;
    const v = this.count * 4;
    // 父物体是相机空间（只带一点晃动）：方片直接立在局部 XY 平面里，正对镜头
    const corners = [-h, -h, h, -h, h, h, -h, h];
    for (let k = 0; k < 4; k++) {
      P[(v + k) * 3] = center.x + corners[k * 2];
      P[(v + k) * 3 + 1] = center.y + corners[k * 2 + 1];
      P[(v + k) * 3 + 2] = center.z;
      // 加色：颜色 × 强度
      C[(v + k) * 4] = color.r * alpha;
      C[(v + k) * 4 + 1] = color.g * alpha;
      C[(v + k) * 4 + 2] = color.b * alpha;
      C[(v + k) * 4 + 3] = 1;
    }
    this.count++;
  }

  end(): void {
    this.lastCount = this.count;
    if (this.count === 0) {
      this.mesh.visible = false;
      return;
    }
    this.geo.setDrawRange(0, this.count * 6);
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.mesh.visible = true;
  }

  clear(): void {
    this.count = 0;
    this.lastCount = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
