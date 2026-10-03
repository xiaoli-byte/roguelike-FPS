/**
 * 雷隼展示模型专用的程序化几何辅助（只给 falcon.ts 用）。
 *  - FalconKit：登记本模型自建的几何体 / 材质，dispose 时统一释放（不碰 enemies/Models 的共享缓存）。
 *  - loftGeo：沿路径放样的低多边形管体（锥形四肢、楔形躯干、弯钩喙、羽簇…），可按截面着色。
 *  - shellGeo：绕 Y 轴的开口薄壳（风衣下摆、立领、胸羽），可按格着色。
 *  - latLongGeo：经纬网格雕塑体（头部），断点即花纹分界，按格着色。
 *  - featherGeo / edgeStripGeo：带中脊的羽片与羽缘发光条（单位尺寸，用 mesh.scale 缩放）。
 *  - armIK / frameQuat：两段臂 IK 与「前向 + 拇指向」朝向（不分配对象，可在每帧 update 里用）。
 */
import * as THREE from 'three';

export class FalconKit {
  readonly geos: THREE.BufferGeometry[] = [];
  readonly mats: THREE.Material[] = [];

  own<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  /** 低多边形平直着色受光材质 */
  std(color: number, rough = 0.8, metal = 0.04, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true, ...extra });
    this.mats.push(m);
    return m;
  }

  /** 自发光（不受光、不参与色调映射） */
  glow(color: number, extra: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra });
    this.mats.push(m);
    return m;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geos.length = 0;
    this.mats.length = 0;
  }
}

/** 创建网格挂到 parent；可选旋转与缩放 */
export function mesh(
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

export function grp(parent: THREE.Object3D, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.set(rx, ry, rz);
  parent.add(g);
  return g;
}

// ───────────────────────────── 放样管体 ─────────────────────────────

/**
 * 放样截面：[x, y, z, w, h, hb?, color?]
 *  - w：沿「侧向」（默认 X）的全宽；h：沿法向（T × 侧向）正侧的全高；hb：负侧全高（默认 = h），用于前后不对称的截面。
 */
export type Sec = [number, number, number, number, number, number?, number?];

export interface LoftOpts {
  sides?: number;
  /** 截面起始角（弧度），用来让平面 / 棱角朝向需要的方向 */
  rot?: number;
  /** 截面侧向参考轴，默认 X（路径与它平行时自动改用 Z） */
  hint?: [number, number, number];
  /** 默认整体颜色（截面未指定颜色时；只有至少一个截面带颜色才写入顶点色） */
  color?: number;
  /** 固定截面法向（例如躯干用 [0, −1, 0] 让每个截面保持水平），不随路径切线倾斜 */
  axis?: [number, number, number];
}

const _t = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _h = new THREE.Vector3();
const _c = new THREE.Color();

export function loftGeo(secs: readonly Sec[], o: LoftOpts = {}): THREE.BufferGeometry {
  const n = o.sides ?? 6;
  const rot = o.rot ?? 0;
  const useColor = secs.some((s) => s[6] !== undefined);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const m = secs.length;
  const P = secs.map((s) => new THREE.Vector3(s[0], s[1], s[2]));
  for (let k = 0; k < m; k++) {
    const a = P[Math.max(0, k - 1)];
    const b = P[Math.min(m - 1, k + 1)];
    if (o.axis) _t.set(...o.axis).normalize();
    else _t.subVectors(b, a).normalize();
    _h.set(...(o.hint ?? [1, 0, 0]));
    if (Math.abs(_h.dot(_t)) > 0.97) _h.set(0, 0, 1);
    _s.copy(_h).addScaledVector(_t, -_h.dot(_t)).normalize();
    _n.crossVectors(_t, _s);
    const [, , , w, h, hb, c] = secs[k];
    _c.set(c ?? o.color ?? 0xffffff);
    for (let i = 0; i < n; i++) {
      const ang = rot + (i / n) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const hh = sa >= 0 ? h : (hb ?? h);
      pos.push(
        P[k].x + _s.x * ca * w * 0.5 + _n.x * sa * hh * 0.5,
        P[k].y + _s.y * ca * w * 0.5 + _n.y * sa * hh * 0.5,
        P[k].z + _s.z * ca * w * 0.5 + _n.z * sa * hh * 0.5,
      );
      if (useColor) col.push(_c.r, _c.g, _c.b);
    }
  }
  for (let k = 0; k < m - 1; k++) {
    for (let i = 0; i < n; i++) {
      const A = k * n + i;
      const B = k * n + ((i + 1) % n);
      const C = (k + 1) * n + ((i + 1) % n);
      const D = (k + 1) * n + i;
      idx.push(A, B, C, A, C, D);
    }
  }
  // 端盖
  const capStart = pos.length / 3;
  pos.push(P[0].x, P[0].y, P[0].z);
  const capEnd = capStart + 1;
  pos.push(P[m - 1].x, P[m - 1].y, P[m - 1].z);
  if (useColor) {
    _c.set(secs[0][6] ?? o.color ?? 0xffffff);
    col.push(_c.r, _c.g, _c.b);
    _c.set(secs[m - 1][6] ?? o.color ?? 0xffffff);
    col.push(_c.r, _c.g, _c.b);
  }
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    idx.push(capStart, i1, i);
    idx.push(capEnd, (m - 1) * n + i, (m - 1) * n + i1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (useColor) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ───────────────────────────── 开口薄壳 ─────────────────────────────

/**
 * 薄壳的一行：高度 y、椭圆半径 rx / rz、角度范围 a0..a1（0 = +Z 正前，π/2 = +X）、
 * 中心 z 偏移 cz、褶皱幅度 fold（相邻列一凸一凹）。
 */
export interface ShellRow {
  y: number;
  rx: number;
  rz: number;
  a0: number;
  a1: number;
  cz?: number;
  fold?: number;
  /** 行高度随 |角度| 抬升（做 V 形 / 人字纹） */
  tilt?: number;
}

/** 非索引薄壳；外法线朝外（FrontSide = 外面，BackSide = 里子）。color(i, j) 给第 i 行第 j 格着色 */
export function shellGeo(rows: readonly ShellRow[], cols: number, color?: (i: number, j: number) => number): THREE.BufferGeometry {
  const grid: THREE.Vector3[][] = rows.map((r) => {
    const line: THREE.Vector3[] = [];
    for (let j = 0; j <= cols; j++) {
      const a = r.a0 + (r.a1 - r.a0) * (j / cols);
      const f = 1 + (r.fold ?? 0) * (j === 0 || j === cols ? 0 : j % 2 ? 1 : -1);
      line.push(new THREE.Vector3(Math.sin(a) * r.rx * f, r.y + (r.tilt ?? 0) * Math.abs(a), (r.cz ?? 0) + Math.cos(a) * r.rz * f));
    }
    return line;
  });
  const pos: number[] = [];
  const col: number[] = [];
  const push = (v: THREE.Vector3): void => {
    pos.push(v.x, v.y, v.z);
    if (color) col.push(_c.r, _c.g, _c.b);
  };
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < cols; j++) {
      if (color) _c.set(color(i, j));
      const a = grid[i][j];
      const b = grid[i][j + 1];
      const c = grid[i + 1][j + 1];
      const d = grid[i + 1][j];
      // 角度递增方向 × 向下 = 朝内，所以 (a, d, c) / (a, c, b) 朝外
      push(a); push(d); push(c);
      push(a); push(c); push(b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ───────────────────────────── 雕塑体 ─────────────────────────────

const _a = new THREE.Vector3();
const _d = new THREE.Vector3();

/** 方位角 az（0 = +Z 正前，+π/2 = +X）与仰角 el 对应的单位方向 */
export function dirOf(az: number, el: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/**
 * 低模雕塑（经纬网格）：在给定的方位角断点（azHalf：0 → π，左右镜像）与仰角断点（els：−π/2 → π/2）上取方向 n，
 * 经 shape(n, out) 形变成顶点；每格按格心方向取 color(n) 着色（非索引、按格纯色）。
 * 断点就是花纹边界，所以兜帽 / 髭纹 / 颊斑的分界是干净的棱线，而不是锯齿。
 */
export function latLongGeo(
  azHalf: readonly number[],
  els: readonly number[],
  shape: (n: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3,
  color: (n: THREE.Vector3) => number,
): THREE.BufferGeometry {
  const az = [...azHalf.slice(1).reverse().map((a) => -a), ...azHalf];
  const pos: number[] = [];
  const col: number[] = [];
  const P = (a: number, e: number): [number, number, number] => {
    shape(dirOf(a, e, _a), _d);
    return [_d.x, _d.y, _d.z];
  };
  const tri = (p: [number, number, number], q: [number, number, number], r: [number, number, number]): void => {
    pos.push(...p, ...q, ...r);
    col.push(_c.r, _c.g, _c.b, _c.r, _c.g, _c.b, _c.r, _c.g, _c.b);
  };
  const POLE = Math.PI / 2 - 1e-4;
  for (let i = 0; i < els.length - 1; i++) {
    const e0 = els[i];
    const e1 = els[i + 1];
    for (let j = 0; j < az.length - 1; j++) {
      const a0 = az[j];
      const a1 = az[j + 1];
      _c.set(color(dirOf((a0 + a1) / 2, (e0 + e1) / 2, _a)));
      const A = P(a0, e0);
      const B = P(a1, e0);
      const Cc = P(a1, e1);
      const D = P(a0, e1);
      if (e0 > -POLE) tri(A, B, Cc);
      if (e1 < POLE) tri(A, Cc, D);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ───────────────────────────── 羽片 ─────────────────────────────

/** 羽片轮廓的一档：y（向下为负）、内侧半宽 wl（−X）、外侧半宽 wr（+X）、中脊厚 t、本档以下这一段的颜色 c */
export interface FeatherLevel {
  y: number;
  wl: number;
  wr: number;
  t: number;
  c: number;
}

/**
 * 单位羽片：枢轴在原点，沿 −Y 伸到 y = −1，X 为宽、Z 为厚（菱形截面，中脊凸起，平直着色出棱面）。
 * 非索引，按段着色（色带分明）。
 */
export function featherGeo(lv: readonly FeatherLevel[], under = 0xffffff): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const L = (k: number): [number, number, number] => [-lv[k].wl, lv[k].y, 0];
  const R = (k: number): [number, number, number] => [lv[k].wr, lv[k].y, 0];
  const F = (k: number): [number, number, number] => [0, lv[k].y, lv[k].t];
  const B = (k: number): [number, number, number] => [0, lv[k].y, -lv[k].t];
  const tint = new THREE.Color(under);
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]): void => {
    pos.push(...a, ...b, ...c);
    col.push(_c.r, _c.g, _c.b, _c.r, _c.g, _c.b, _c.r, _c.g, _c.b);
  };
  _c.set(lv[0].c);
  tri(L(0), F(0), R(0));
  tri(L(0), R(0), B(0));
  for (let k = 0; k < lv.length - 1; k++) {
    const k1 = k + 1;
    // +Z 面（腹面 / 贴身一侧）可单独压暗着色
    _c.set(lv[k].c).multiply(tint);
    tri(L(k), L(k1), F(k1)); tri(L(k), F(k1), F(k));
    tri(F(k), F(k1), R(k1)); tri(F(k), R(k1), R(k));
    _c.set(lv[k].c);
    tri(L(k), B(k1), L(k1)); tri(L(k), B(k), B(k1));
    tri(B(k), R(k1), B(k1)); tri(B(k), R(k), R(k1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** 羽缘发光条：沿某侧边缘（side = 1 外侧 +X，−1 内侧 −X）从第 from 档到羽尖、向外伸出 width 的平面窄带（双面材质） */
export function edgeStripGeo(lv: readonly FeatherLevel[], from: number, width: number, side: 1 | -1): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let k = from; k < lv.length; k++) {
    const e = side > 0 ? lv[k].wr : -lv[k].wl;
    const taper = 1 - (k - from) / Math.max(1, lv.length - from) * 0.6;
    pos.push(e, lv[k].y, 0, e + side * width * taper, lv[k].y, 0);
  }
  const cnt = lv.length - from;
  for (let k = 0; k < cnt - 1; k++) {
    const a = k * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ───────────────────────────── 搭姿势（build 时用） ─────────────────────────────

const _m4 = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

const _ikDir = new THREE.Vector3();
const _ikP = new THREE.Vector3();
const _ikE = new THREE.Vector3();
const _ikW = new THREE.Vector3();
const _ikF = new THREE.Vector3();
const _ikQ = new THREE.Quaternion();

/**
 * 两段臂 IK（父空间内）：肩 S、腕目标 W、上臂 L1、前臂 L2、肘部朝向提示 pole。
 * 输出上臂关节四元数（骨骼沿本地 −Y，肘部绕本地 X 弯曲），返回肘关节 rotation.x。
 * 只用模块级临时变量，可在每帧 update 里调用。
 */
export function armIK(S: THREE.Vector3, W: THREE.Vector3, L1: number, L2: number, pole: THREE.Vector3, outQ: THREE.Quaternion): number {
  _ikDir.subVectors(W, S);
  const d = THREE.MathUtils.clamp(_ikDir.length(), 0.05, (L1 + L2) * 0.999);
  _ikDir.normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _ikP.copy(pole).addScaledVector(_ikDir, -pole.dot(_ikDir)).normalize();
  _ikE.copy(S).addScaledVector(_ikDir, a).addScaledVector(_ikP, h);
  _ikW.copy(S).addScaledVector(_ikDir, d);
  _y.subVectors(S, _ikE).normalize();
  _ikF.subVectors(_ikW, _ikE).normalize();
  _x.crossVectors(_y, _ikF);
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
  _x.normalize();
  _z.crossVectors(_x, _y).normalize();
  _m4.makeBasis(_x, _y, _z);
  outQ.setFromRotationMatrix(_m4);
  _ikF.applyQuaternion(_ikQ.copy(outQ).invert());
  return Math.atan2(-_ikF.z, -_ikF.y);
}

/** 朝向：本地 −Y 指向 fwd，本地 +Z 尽量指向 up（拇指 / 枪顶方向） */
export function frameQuat(fwd: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _y.copy(fwd).normalize().negate();
  _z.copy(up).addScaledVector(_y, -up.dot(_y)).normalize();
  _x.crossVectors(_y, _z).normalize();
  _m4.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m4);
}

// ───────────────────────────── 缓动 ─────────────────────────────

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (v: number): number => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
export const easeOut3 = (v: number): number => {
  const x = 1 - clamp01(v);
  return 1 - x * x * x;
};
export const easeInOut = (v: number): number => {
  const x = clamp01(v);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** 带回弹的缓出（略冲过 1 再回落） */
export const easeOutBack = (v: number, s = 1.6): number => {
  const x = clamp01(v) - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
};
