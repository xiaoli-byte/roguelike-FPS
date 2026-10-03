/**
 * 岩熊展示模型专用的低多边形拼装工具：
 *  - BearKit：本模型自建几何体 / 材质的工厂与登记表（dispose 时统一释放，绝不碰共享缓存）
 *  - 放样（loft）：一串椭圆截面环 → 锥形四肢、楔形躯干、吻部等有机形体
 *  - 贴皮（wrap）：在放样体表面按角度 / 高度贴一条紧贴的「皮」——袈裟斜披、胸前月牙、金边
 *  - 关键帧轨道（Hermite，可设停顿 / 砸击切线）、阻尼弹簧、两段式手臂 IK
 */
import * as THREE from 'three';

export const TAU = Math.PI * 2;

export interface Ring {
  y: number;
  rx: number;
  rz: number;
  cx?: number;
  cz?: number;
}

export type Anchor = 'top' | 'bottom' | 'center';

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _r = new THREE.Vector3();

/** 放样体表面（与 loftGeo 的多边形完全一致）上，角度 a、高度 y 处的点 */
export function loftPoint(rings: readonly Ring[], seg: number, phase: number, a: number, y: number, out: THREE.Vector3): THREE.Vector3 {
  let j = 0;
  while (j < rings.length - 2 && y > rings[j + 1].y) j++;
  const r0 = rings[j];
  const r1 = rings[j + 1];
  const f = Math.min(1, Math.max(0, (y - r0.y) / (r1.y - r0.y || 1)));
  const rx = r0.rx + (r1.rx - r0.rx) * f;
  const rz = r0.rz + (r1.rz - r0.rz) * f;
  const cx = (r0.cx ?? 0) + ((r1.cx ?? 0) - (r0.cx ?? 0)) * f;
  const cz = (r0.cz ?? 0) + ((r1.cz ?? 0) - (r0.cz ?? 0)) * f;
  const step = TAU / seg;
  let u = (a - phase) / step;
  u -= Math.floor(u / seg) * seg;
  const k = Math.floor(u);
  const fr = u - k;
  const a0 = phase + k * step;
  const a1 = a0 + step;
  const x0 = Math.sin(a0) * rx;
  const z0 = Math.cos(a0) * rz;
  const x1 = Math.sin(a1) * rx;
  const z1 = Math.cos(a1) * rz;
  return out.set(cx + x0 + (x1 - x0) * fr, y, cz + z0 + (z1 - z0) * fr);
}

/** 放样体表面外法线（数值差分） */
export function loftNormal(rings: readonly Ring[], seg: number, phase: number, a: number, y: number, out: THREE.Vector3): THREE.Vector3 {
  const e = 0.004;
  loftPoint(rings, seg, phase, a + e, y, _p);
  loftPoint(rings, seg, phase, a - e, y, _q);
  _p.sub(_q);
  loftPoint(rings, seg, phase, a, y + e, _q);
  loftPoint(rings, seg, phase, a, y - e, _r);
  _q.sub(_r);
  return out.crossVectors(_p, _q).normalize();
}

/** 关键帧 k 的出切线（Catmull-Rom；停顿 / 砸击 / 首尾帧为 0） */
function outTan(keys: readonly number[], n: number, k: number): number {
  if (keys[k * 3 + 2] !== 0 || k === 0 || k === n - 1) return 0;
  return (keys[(k + 1) * 3 + 1] - keys[(k - 1) * 3 + 1]) / (keys[(k + 1) * 3] - keys[(k - 1) * 3]);
}

/** 关键帧轨道：[t, v, 标志] × n。标志 0 = 平滑穿过；1 = 在此停顿（切线为 0）；2 = 砸击（加速冲入、在此急停）。无分配 */
export function track(keys: readonly number[], t: number): number {
  const n = keys.length / 3;
  if (t <= keys[0]) return keys[1];
  if (t >= keys[(n - 1) * 3]) return keys[(n - 1) * 3 + 1];
  let i = 1;
  while (i < n - 1 && t > keys[i * 3]) i++;
  const t0 = keys[(i - 1) * 3];
  const v0 = keys[(i - 1) * 3 + 1];
  const t1 = keys[i * 3];
  const v1 = keys[i * 3 + 1];
  const h = t1 - t0;
  const m0 = outTan(keys, n, i - 1);
  const m1 = keys[i * 3 + 2] === 2 ? (2.2 * (v1 - v0)) / h : outTan(keys, n, i);
  const u = (t - t0) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * h * m1;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const smooth01 = (v: number): number => {
  const x = clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
};

/** 周期包络：每 period 秒在 offset 处 rise 秒升到 1、保持 hold 秒、fall 秒落回 0 */
export function pulse(t: number, period: number, offset: number, rise: number, hold: number, fall: number): number {
  let u = (t - offset) % period;
  if (u < 0) u += period;
  if (u < rise) return smooth01(u / rise);
  if (u < rise + hold) return 1;
  if (u < rise + hold + fall) return 1 - smooth01((u - rise - hold) / fall);
  return 0;
}

/** 阻尼弹簧（半隐式欧拉，无分配） */
export class Spring {
  x = 0;
  v = 0;
  constructor(public k = 90, public c = 12) {}
  step(target: number, dt: number): number {
    const a = this.k * (target - this.x) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
  reset(x = 0): void {
    this.x = x;
    this.v = 0;
  }
}

const _S = new THREE.Vector3();
const _T = new THREE.Vector3();
const _U = new THREE.Vector3();
const _V = new THREE.Vector3();
const _E = new THREE.Vector3();
const _D1 = new THREE.Vector3();
const _D2 = new THREE.Vector3();
const _X = new THREE.Vector3();
const _Y = new THREE.Vector3();
const _Z = new THREE.Vector3();
const _M = new THREE.Matrix4();

/**
 * 两段式手臂 IK（构建期用）：肩关节 shoulder 与肘关节 elbow 的肢体都沿本地 −Y 下垂，
 * 肘 rotation.x 为负 = 前臂向本地 +Z 屈。target / pole 为肩关节父空间坐标。
 */
export function solveArm(
  shoulder: THREE.Object3D, elbow: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, a: number, b: number,
): void {
  _S.copy(shoulder.position);
  _T.copy(target).sub(_S);
  const d = clamp(_T.length(), Math.abs(a - b) + 0.01, a + b - 0.002);
  _U.copy(_T).normalize();
  _V.copy(pole).addScaledVector(_U, -pole.dot(_U)).normalize();
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const alpha = Math.acos(cosA);
  _E.copy(_U).multiplyScalar(Math.cos(alpha) * a).addScaledVector(_V, Math.sin(alpha) * a);
  _D1.copy(_E).normalize();
  _D2.copy(_U).multiplyScalar(d).sub(_E).normalize();
  _Y.copy(_D1).negate();
  _Z.copy(_D2).addScaledVector(_D1, -_D2.dot(_D1)).normalize();
  _X.crossVectors(_Y, _Z).normalize();
  _M.makeBasis(_X, _Y, _Z);
  shoulder.quaternion.setFromRotationMatrix(_M);
  const cosK = clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1);
  elbow.rotation.set(-(Math.PI - Math.acos(cosK)), 0, 0);
}

/** 本模型自建资源的工厂 + 登记表 */
export class BearKit {
  readonly geos: THREE.BufferGeometry[] = [];
  readonly mats: THREE.Material[] = [];
  private readonly cache = new Map<string, THREE.BufferGeometry>();

  private keep<T extends THREE.BufferGeometry>(key: string | null, make: () => T): T {
    if (key) {
      const hit = this.cache.get(key);
      if (hit) return hit as T;
    }
    const g = make();
    this.geos.push(g);
    if (key) this.cache.set(key, g);
    return g;
  }

  // ─────────── 材质 ───────────

  std(color: number, rough = 0.85, metal = 0, emissive = 0x000000, ei = 1): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true, emissive, emissiveIntensity: ei });
    this.mats.push(m);
    return m;
  }

  glow(color: number): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    this.mats.push(m);
    return m;
  }

  additive(color: number): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({
      color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.mats.push(m);
    return m;
  }

  // ─────────── 几何体 ───────────

  /** 沿 +Y 放样：每环为 seg 边形椭圆（phase 默认让一个平面正对 +Z） */
  loft(rings: readonly Ring[], seg: number, capBottom = true, capTop = true, phase = Math.PI / seg): THREE.BufferGeometry {
    return this.keep(null, () => {
      const pos: number[] = [];
      const idx: number[] = [];
      for (const r of rings) {
        for (let i = 0; i < seg; i++) {
          const a = phase + (i / seg) * TAU;
          pos.push((r.cx ?? 0) + Math.sin(a) * r.rx, r.y, (r.cz ?? 0) + Math.cos(a) * r.rz);
        }
      }
      for (let j = 0; j < rings.length - 1; j++) {
        for (let i = 0; i < seg; i++) {
          const a = j * seg + i;
          const b = j * seg + ((i + 1) % seg);
          const c = (j + 1) * seg + i;
          const d = (j + 1) * seg + ((i + 1) % seg);
          idx.push(a, b, c, b, d, c);
        }
      }
      if (capBottom) {
        const r = rings[0];
        const ci = pos.length / 3;
        pos.push(r.cx ?? 0, r.y, r.cz ?? 0);
        for (let i = 0; i < seg; i++) idx.push(ci, (i + 1) % seg, i);
      }
      if (capTop) {
        const j = rings.length - 1;
        const r = rings[j];
        const ci = pos.length / 3;
        pos.push(r.cx ?? 0, r.y, r.cz ?? 0);
        for (let i = 0; i < seg; i++) idx.push(ci, j * seg + i, j * seg + ((i + 1) % seg));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    });
  }

  /**
   * 沿 +Z 放样（吻部、脚掌、下颌）：环的 y 字段表示 z 位置，rz 字段表示竖向半径，cz 字段表示竖向中心（向上为正）。
   */
  loftZ(rings: readonly Ring[], seg: number, capBack = true, capFront = true, phase = Math.PI / seg): THREE.BufferGeometry {
    const conv = rings.map((r) => ({ y: r.y, rx: r.rx, rz: r.rz, cx: r.cx ?? 0, cz: -(r.cz ?? 0) }));
    const g = this.loft(conv, seg, capBack, capFront, phase);
    g.rotateX(Math.PI / 2);
    g.computeVertexNormals();
    return g;
  }

  /** 锥形方块：w = X 宽，d = Z 深（B = 底、T = 顶），h = 高；shiftZ 让顶面前后错位做出楔形 */
  taper(wB: number, wT: number, dB: number, dT: number, h: number, anchor: Anchor = 'center', shiftZ = 0): THREE.BufferGeometry {
    const y0 = anchor === 'top' ? -h : anchor === 'bottom' ? 0 : -h / 2;
    const k = Math.SQRT1_2;
    return this.loft(
      [
        { y: y0, rx: wB * k, rz: dB * k },
        { y: y0 + h, rx: wT * k, rz: dT * k, cz: shiftZ },
      ],
      4, true, true, Math.PI / 4,
    );
  }

  box(w: number, h: number, d: number, anchor: Anchor = 'center'): THREE.BufferGeometry {
    return this.keep(`box:${w}:${h}:${d}:${anchor}`, () => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (anchor === 'top') g.translate(0, -h / 2, 0);
      else if (anchor === 'bottom') g.translate(0, h / 2, 0);
      return g;
    });
  }

  cyl(rTop: number, rBot: number, h: number, seg = 6, anchor: Anchor = 'center', open = false): THREE.BufferGeometry {
    return this.keep(`cyl:${rTop}:${rBot}:${h}:${seg}:${anchor}:${open}`, () => {
      const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
      if (anchor === 'top') g.translate(0, -h / 2, 0);
      else if (anchor === 'bottom') g.translate(0, h / 2, 0);
      return g;
    });
  }

  /** 尖朝 +Y 的锥体；anchor 'bottom' 时底面在原点（毛簇、爪尖） */
  cone(r: number, h: number, seg = 4, anchor: Anchor = 'bottom'): THREE.BufferGeometry {
    return this.keep(`cone:${r}:${h}:${seg}:${anchor}`, () => {
      const g = new THREE.ConeGeometry(r, h, seg);
      if (anchor === 'top') g.translate(0, -h / 2, 0);
      else if (anchor === 'bottom') g.translate(0, h / 2, 0);
      return g;
    });
  }

  ico(r: number, detail = 0): THREE.BufferGeometry {
    return this.keep(`ico:${r}:${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
  }

  dodeca(r: number): THREE.BufferGeometry {
    return this.keep(`dodeca:${r}`, () => new THREE.DodecahedronGeometry(r));
  }

  octa(r: number): THREE.BufferGeometry {
    return this.keep(`octa:${r}`, () => new THREE.OctahedronGeometry(r));
  }

  /** 平躺（轴向 Y）的圆环 */
  torus(R: number, tube: number, radial = 4, tubular = 12): THREE.BufferGeometry {
    return this.keep(`torus:${R}:${tube}:${radial}:${tubular}`, () => new THREE.TorusGeometry(R, tube, radial, tubular).rotateX(Math.PI / 2));
  }

  /**
   * 在放样体（rings/seg/phase 与 loft 相同）表面贴一层皮：角度 a ∈ [a0, a1]，高度 y ∈ [lo(a), hi(a)]，
   * 沿外法线偏移 off。用于袈裟斜披、月牙胸毛、金边与补丁线。
   */
  wrap(
    rings: readonly Ring[], seg: number, phase: number,
    a0: number, a1: number, nA: number,
    lo: (a: number) => number, hi: (a: number) => number, nY: number, off: number,
  ): THREE.BufferGeometry {
    return this.keep(null, () => {
      const pos: number[] = [];
      const idx: number[] = [];
      const p = new THREE.Vector3();
      const n = new THREE.Vector3();
      for (let i = 0; i <= nA; i++) {
        const a = a0 + ((a1 - a0) * i) / nA;
        const yl = lo(a);
        const yh = hi(a);
        for (let j = 0; j <= nY; j++) {
          const y = yl + ((yh - yl) * j) / nY;
          loftPoint(rings, seg, phase, a, y, p);
          loftNormal(rings, seg, phase, a, y, n);
          pos.push(p.x + n.x * off, p.y + n.y * off, p.z + n.z * off);
        }
      }
      const row = nY + 1;
      for (let i = 0; i < nA; i++) {
        for (let j = 0; j < nY; j++) {
          const a = i * row + j;
          const b = (i + 1) * row + j;
          const c = i * row + j + 1;
          const d = (i + 1) * row + j + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    });
  }

  // ─────────── 拼装 ───────────

  mesh(
    parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
    x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  }

  joint(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geos.length = 0;
    this.cache.clear();
  }
}
