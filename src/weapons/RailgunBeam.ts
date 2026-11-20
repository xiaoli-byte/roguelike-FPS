/**
 * 满蓄一击的「贯虹」虹光（Unity Weapons/RailgunBeam.cs，贯虹灵炮）：主光束（fx.beam，枪口 → 落点，0.16 s）在 Firing.trace 里照旧，
 * 这里是 Unity 新增的那一层——三股彩虹丝沿弹道缠绕（每股色相沿长度走一整圈彩虹、三股错开 1/3），两端收拢到枪口和落点，
 * 0.38 s 内一边旋转一边散开、变细、淡出。
 * 每条虹光一个物体（3 条朝向镜头的带子，加法混合，顶点色 × 淡出），用完回池。几何（{@link strandPoint} / {@link rainbow} / {@link taper}）是纯函数。
 */
import * as THREE from 'three';

export const RAILGUN_BEAM = {
  Strands: 3,
  Points: 32,
  /** 寿命（秒）、初始缠绕半径（米）、整段缠绕圈数、旋转速度（弧度 / 秒） */
  Life: 0.38,
  Radius: 0.05,
  Turns: 2.5,
  SpinSpeed: 9,
  /** 曳光宽度的上下限、带子宽度占曳光宽度的比例、寿命末尾收细到的比例 */
  WidthMin: 0.02,
  WidthMax: 0.3,
  WidthShare: 0.55,
  WidthShrink: 0.6,
  /** 寿命内缠绕半径张开到 1 + 这么多倍 */
  Spread: 1.5,
} as const;

/** 彩虹色（u 任意，按 1 取模）：色相 u、饱和 0.8、明度 1（Unity Color.HSVToRGB） */
export function rainbow(u: number, out: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 }): { r: number; g: number; b: number } {
  const h = ((u % 1) + 1) % 1, s = 0.8, v = 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: out.r = v; out.g = t; out.b = p; break;
    case 1: out.r = q; out.g = v; out.b = p; break;
    case 2: out.r = p; out.g = v; out.b = t; break;
    case 3: out.r = p; out.g = q; out.b = v; break;
    case 4: out.r = t; out.g = p; out.b = v; break;
    default: out.r = v; out.g = p; out.b = q; break;
  }
  return out;
}

/** 两端收拢：t = 0（枪口）和 1（落点）处为 0，离两端 1/8 段长之外为 1 */
export function taper(t: number): number {
  const c = (x: number): number => Math.max(0, Math.min(1, x));
  return c(t * 8) * c((1 - t) * 8);
}

const smooth = (x: number): number => x * x * (3 - 2 * x);

const _d = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);

/** 弹道的缠绕基：side ⟂ 弹道（水平优先）、up = side × dir */
function basis(from: THREE.Vector3, to: THREE.Vector3): void {
  _d.subVectors(to, from);
  _dir.copy(_d).normalize();
  _side.crossVectors(_dir, _Y);
  if (_side.lengthSq() < 1e-6) _side.crossVectors(_dir, _X);
  _side.normalize();
  _up.crossVectors(_side, _dir);
}

/**
 * 第 strand 股、第 i 个点（共 Points 个）在 age 秒时的位置（Unity RailgunBeam.Draw）：
 * 相位 = 股 × 2π/3 + age × 9；沿弹道 t 处绕 2.5 圈；半径 0.05 × (1 + 1.5k) × 两端收拢
 */
export function strandPoint(from: THREE.Vector3, to: THREE.Vector3, strand: number, i: number, age: number, out: THREE.Vector3): THREE.Vector3 {
  basis(from, to);
  const B = RAILGUN_BEAM;
  const k = Math.max(0, Math.min(1, age / B.Life));
  const t = i / (B.Points - 1);
  const a = strand * ((Math.PI * 2) / B.Strands) + age * B.SpinSpeed + t * B.Turns * Math.PI * 2;
  const r = B.Radius * (1 + B.Spread * k) * taper(t);
  return out.copy(from).addScaledVector(_d, t).addScaledVector(_side, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r);
}

/** 亮度（两端：枪口 fade、落点 fade × 0.7，沿长度线性）与带子宽度（Unity：width × 0.55 × (1 − 0.6k)） */
export function beamFade(age: number): number {
  return 1 - smooth(Math.max(0, Math.min(1, age / RAILGUN_BEAM.Life)));
}
export function strandWidth(width: number, age: number): number {
  const k = Math.max(0, Math.min(1, age / RAILGUN_BEAM.Life));
  return width * RAILGUN_BEAM.WidthShare * (1 - RAILGUN_BEAM.WidthShrink * k);
}

const _p = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _next = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _view = new THREE.Vector3();
const _off = new THREE.Vector3();
const _rgb = { r: 0, g: 0, b: 0 };

class Beam {
  readonly mesh: THREE.Mesh;
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  readonly from = new THREE.Vector3();
  readonly to = new THREE.Vector3();
  age = 0;
  width = 0.05;
  live = false;

  constructor(material: THREE.Material) {
    const B = RAILGUN_BEAM;
    const verts = B.Strands * B.Points * 2;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('color', this.col);
    const index: number[] = [];
    for (let s = 0; s < B.Strands; s++) {
      const base = s * B.Points * 2;
      for (let i = 0; i < B.Points - 1; i++) {
        const a = base + i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = 'railgunBeam';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  draw(eye: THREE.Vector3): void {
    const B = RAILGUN_BEAM;
    const fade = beamFade(this.age);
    const half = strandWidth(this.width, this.age) * 0.5;
    const pos = this.pos.array as Float32Array, col = this.col.array as Float32Array;
    for (let s = 0; s < B.Strands; s++) {
      for (let i = 0; i < B.Points; i++) {
        strandPoint(this.from, this.to, s, i, this.age, _p);
        strandPoint(this.from, this.to, s, Math.max(0, i - 1), this.age, _prev);
        strandPoint(this.from, this.to, s, Math.min(B.Points - 1, i + 1), this.age, _next);
        _tan.subVectors(_next, _prev);
        _view.subVectors(eye, _p);
        _off.crossVectors(_tan, _view);
        if (_off.lengthSq() < 1e-10) _off.set(0, 1, 0);
        _off.normalize().multiplyScalar(half);
        const t = i / (B.Points - 1);
        // 7 个色键沿弹道走一整圈彩虹，股与股错开 1/3；顶点色 × 淡出（加法混合，亮度就是不透明度）
        rainbow(t + s / B.Strands, _rgb);
        const a = fade * (1 - 0.3 * t);
        const k = (s * B.Points + i) * 6;
        pos[k] = _p.x + _off.x; pos[k + 1] = _p.y + _off.y; pos[k + 2] = _p.z + _off.z;
        pos[k + 3] = _p.x - _off.x; pos[k + 4] = _p.y - _off.y; pos[k + 5] = _p.z - _off.z;
        col[k] = col[k + 3] = _rgb.r * a;
        col[k + 1] = col[k + 4] = _rgb.g * a;
        col[k + 2] = col[k + 5] = _rgb.b * a;
      }
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }
}

/** 虹光的对象池（WeaponSystem 持有、每帧推进） */
export class RailgunBeams {
  private readonly pool: Beam[] = [];
  private readonly material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
  });

  constructor(private readonly parent: () => THREE.Object3D | null) {}

  /** 正在播的条数 */
  get live(): number {
    let n = 0;
    for (const b of this.pool) if (b.live) n++;
    return n;
  }

  /** 满蓄弹道的虹光。width = 武器曳光宽度（钳到 0.02–0.3）；太短（< 0.2 m）或坐标非法时不出 */
  spawn(from: THREE.Vector3, to: THREE.Vector3, width: number): boolean {
    if (!Number.isFinite(from.x + from.y + from.z + to.x + to.y + to.z) || from.distanceToSquared(to) < 0.04) return false;
    const parent = this.parent();
    if (!parent) return false;
    let b = this.pool.find(x => !x.live);
    if (!b) this.pool.push(b = new Beam(this.material));
    if (b.mesh.parent !== parent) parent.add(b.mesh);
    b.from.copy(from);
    b.to.copy(to);
    b.width = Math.max(RAILGUN_BEAM.WidthMin, Math.min(RAILGUN_BEAM.WidthMax, width));
    b.age = 0;
    b.live = true;
    b.mesh.visible = true;
    return true;
  }

  update(dt: number, eye: THREE.Vector3): void {
    for (const b of this.pool) {
      if (!b.live) continue;
      b.age += dt;
      if (b.age >= RAILGUN_BEAM.Life) {
        b.live = false;
        b.mesh.visible = false;
        continue;
      }
      b.draw(eye);
    }
  }

  /** 换关 / 回菜单：全部收掉 */
  clear(): void {
    for (const b of this.pool) {
      b.live = false;
      b.mesh.visible = false;
      b.mesh.removeFromParent();
    }
  }
}
