/**
 * 碎刃 v2 的刀身几何（docs/demon-blade-v2.md 第 9 节）：轮廓、刀根分界与 128 片 Voronoi 碎刃。纯数学，不依赖 three。
 *
 * 刀身局部坐标：+Y 从刀身起点（护手铜环上沿）指向刀尖；刀背在 −X，刃口在 +X；Z 为厚度方向。单位米。
 * 刀根（鬼面那段）不碎，分界线按设计图手绘的紫缝走（art/pipeline/demon_blade_textures.py 打印的分界点）。
 * 碎刃区域切成 SHARD_COUNT 个各不相同的凸多边形：各向异性（沿刀身拉长）、刀根附近密、刀尖附近疏，Lloyd 松弛后互不重叠、拼回整刀。
 * 结果确定（固定种子），首次调用时计算并缓存。
 */

export const SHARD_COUNT = 128;
/** 刀身起点（护手上沿）到刀尖，沿刀柄轴线方向 */
export const BLADE_LEN = 0.7777;
/** 刀根贴图 v = 1 对应的刀身长度（贴图取自设计图正侧面 x = 581 → 940 px） */
export const ROOT_TEX_LEN = 0.198;
/** 各向异性：Voronoi 在 y / ANISO 的空间里求，碎片沿刀身拉长 */
const ANISO = 1.55;
/** Lloyd 松弛轮数：少量松弛只去掉过细的碎片，保留碎玻璃般大小不一的不规则多边形（轮数多了会变成蜂窝） */
const LLOYD_ITERS = 7;
const NEIGHBORS = 18;
const SEED = 0x5eed7;

/**
 * 刀身轮廓：从用户确认的设计图正侧面逐段量得（art/source/weapons/SK_Weapon_DemonBlade/00_design/DS_SK_Weapon_DemonBlade_v001.png，
 * 1 px = 0.55 mm，原点在刀柄轴线与护手上沿的交点）。[y, 刀背 x, 刃口 x]：刀身先略向刃口一侧下垂，再一路向刀背上挑，
 * 宽度约 5.1 cm 保持到 70% 处，之后刃口弧线扫向刀尖，与刀背交于一点。
 */
const PROFILE: readonly (readonly [number, number, number])[] = [
  [0, -0.022, 0.0313], [0.066, -0.0165, 0.0363], [0.1209, -0.0115, 0.0396], [0.1759, -0.0077, 0.0434],
  [0.2308, -0.0055, 0.0456], [0.2858, -0.0044, 0.0462], [0.3408, -0.0038, 0.0472], [0.3957, -0.0035, 0.0476],
  [0.4507, -0.0044, 0.047], [0.5056, -0.0066, 0.0445], [0.5606, -0.0099, 0.041], [0.6155, -0.0143, 0.0341],
  [0.6705, -0.022, 0.022], [0.698, -0.0264, 0.0121], [0.7255, -0.0319, 0.0005], [0.7529, -0.0379, -0.0165],
  [0.7777, -0.0434, -0.0434],
];

/** 刀根分界（u = 刀背 0 → 刃口 1，v = y / ROOT_TEX_LEN），按设计图正侧面里暗色刀根与碎片的交界描出 */
const ROOT_BOUNDARY: readonly (readonly [number, number])[] = [[0, 0.81], [0.25, 0.76], [0.5, 0.7], [0.75, 0.59], [1, 0.455]];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** 轮廓列 col（1 = 刀背，2 = 刃口）在 y 处的值：Catmull-Rom 插值 */
function profileAt(y: number, col: 1 | 2): number {
  const P = PROFILE;
  if (y <= 0) return P[0][col];
  if (y >= BLADE_LEN) return P[P.length - 1][col];
  let i = 0;
  while (i < P.length - 2 && P[i + 1][0] < y) i++;
  const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
  const t = (y - p1[0]) / (p2[0] - p1[0]);
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1[col] + (p2[col] - p0[col]) * t + (2 * p0[col] - 5 * p1[col] + 4 * p2[col] - p3[col]) * t2
    + (3 * p1[col] - p0[col] - 3 * p2[col] + p3[col]) * t3);
}

export function spineX(y: number): number {
  return profileAt(y, 1);
}

export function edgeX(y: number): number {
  return y >= BLADE_LEN ? spineX(y) : Math.max(spineX(y), profileAt(y, 2));
}

export function bladeWidth(y: number): number {
  return edgeX(y) - spineX(y);
}

/** 刀身中线 */
export function bladeCenterX(y: number): number {
  return (spineX(y) + edgeX(y)) / 2;
}

/** 横向坐标：刀背 0 → 刃口 1 */
export function acrossOf(x: number, y: number): number {
  const w = bladeWidth(y);
  return w > 1e-6 ? clamp01((x - spineX(y)) / w) : 0.5;
}

/** 厚度：刀背厚、刃口薄，刀尖整体变薄 */
export function thicknessAt(x: number, y: number): number {
  const a = acrossOf(x, y);
  const tip = 1 - 0.45 * smooth(0.8, 1, y / BLADE_LEN);
  return (0.0064 * Math.pow(1 - a, 0.8) + 0.001) * tip;
}

/** 刀根分界在横向 u 处的长度坐标 y */
export function rootBoundaryY(u: number): number {
  const b = ROOT_BOUNDARY;
  u = clamp01(u);
  for (let i = 1; i < b.length; i++) {
    if (u <= b[i][0]) {
      const t = (u - b[i - 1][0]) / (b[i][0] - b[i - 1][0]);
      return (b[i - 1][1] + (b[i][1] - b[i - 1][1]) * t) * ROOT_TEX_LEN;
    }
  }
  return b[b.length - 1][1] * ROOT_TEX_LEN;
}

/** 平面多边形：[x0, y0, x1, y1, ...]，逆时针 */
export type Poly = number[];

function boundaryPoint(u: number, out: Poly): void {
  const y = rootBoundaryY(u);
  out.push(spineX(y) + u * bladeWidth(y), y);
}

/** 刀根（不碎的鬼面段）轮廓，逆时针 */
export function rootPolygon(): Poly {
  const p: Poly = [];
  const ySpine = rootBoundaryY(0), yEdge = rootBoundaryY(1);
  // 刀背从下往上走是逆时针的反方向：先沿刃口向上，再沿分界从刃口到刀背，再沿刀背向下
  for (let i = 0; i <= 6; i++) {
    const y = (yEdge * i) / 6;
    p.push(edgeX(y), y);
  }
  for (let i = 1; i < 20; i++) boundaryPoint(1 - i / 20, p);
  for (let i = 0; i <= 8; i++) {
    const y = ySpine * (1 - i / 8);
    p.push(spineX(y), y);
  }
  return ensureCcw(p);
}

/** 碎刃区域轮廓（分界线到刀尖），逆时针 */
export function shardRegion(): Poly {
  const p: Poly = [];
  const ySpine = rootBoundaryY(0), yEdge = rootBoundaryY(1);
  // 分界：刀背 → 刃口
  for (let i = 0; i < 20; i++) boundaryPoint(i / 20, p);
  // 刃口：分界 → 刀尖
  const nE = 72;
  for (let i = 0; i < nE; i++) {
    const t = i / nE;
    // 刀尖附近加密（切先弧线）
    const y = yEdge + (BLADE_LEN - yEdge) * (1 - Math.pow(1 - t, 1.6));
    p.push(edgeX(y), y);
  }
  p.push(spineX(BLADE_LEN), BLADE_LEN);
  // 刀背：刀尖 → 分界
  const nS = 48;
  for (let i = 1; i < nS; i++) {
    const y = BLADE_LEN - (BLADE_LEN - ySpine) * (i / nS);
    p.push(spineX(y), y);
  }
  return ensureCcw(p);
}

/** 整把刀身（刀根 + 碎刃区）外轮廓，逆时针；用于辉光 */
export function bladeOutline(): Poly {
  const p: Poly = [];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = BLADE_LEN * (1 - Math.pow(1 - t, 1.5));
    p.push(edgeX(y), y);
  }
  for (let i = 1; i < 60; i++) {
    const y = BLADE_LEN * (1 - i / 60);
    p.push(spineX(y), y);
  }
  p.push(spineX(0), 0);
  return ensureCcw(p);
}

export function polyArea(p: Poly): number {
  let a = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
  }
  return a / 2;
}

function ensureCcw(p: Poly): Poly {
  if (polyArea(p) >= 0) return p;
  const r: Poly = [];
  for (let i = p.length / 2 - 1; i >= 0; i--) r.push(p[2 * i], p[2 * i + 1]);
  return r;
}

export function pointInPoly(p: Poly, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 面积质心 */
export function polyCentroid(p: Poly): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    const c = p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
    a += c;
    cx += (p[2 * i] + p[2 * j]) * c;
    cy += (p[2 * i + 1] + p[2 * j + 1]) * c;
  }
  if (Math.abs(a) < 1e-14) return [p[0], p[1]];
  return [cx / (3 * a), cy / (3 * a)];
}

/** 用直线 a·x + b·y ≤ c 裁剪多边形（Sutherland–Hodgman 单边） */
function clipHalf(p: Poly, a: number, b: number, c: number): Poly {
  const out: Poly = [];
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = p[2 * i], y1 = p[2 * i + 1], x2 = p[2 * j], y2 = p[2 * j + 1];
    const d1 = a * x1 + b * y1 - c, d2 = a * x2 + b * y2 - c;
    if (d1 <= 0) out.push(x1, y1);
    if ((d1 <= 0) !== (d2 <= 0)) {
      const t = d1 / (d1 - d2);
      out.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    }
  }
  return out;
}

/** 用凸多边形 clip（逆时针）裁剪任意简单多边形 subject */
function clipByConvex(subject: Poly, clip: Poly): Poly {
  let out = subject;
  const n = clip.length / 2;
  for (let i = 0; i < n && out.length >= 6; i++) {
    const j = (i + 1) % n;
    const x1 = clip[2 * i], y1 = clip[2 * i + 1], x2 = clip[2 * j], y2 = clip[2 * j + 1];
    // 逆时针多边形的内侧在边的左边：外法线 (dy, −dx)
    const a = y2 - y1, b = -(x2 - x1);
    out = clipHalf(out, a, b, a * x1 + b * y1);
  }
  return out;
}

/** 去掉过近或几乎共线的顶点（每次只删一个、删完重新判断，不会把转角两侧的点一起删掉） */
function simplify(p: Poly, minLen: number, cosTol: number): Poly {
  const cur = p.slice();
  for (let guard = 0; guard < 256; guard++) {
    const n = cur.length / 2;
    if (n <= 3) return cur;
    let drop = -1;
    for (let i = 0; i < n && drop < 0; i++) {
      const pi = (i + n - 1) % n, ni = (i + 1) % n;
      const ax = cur[2 * i] - cur[2 * pi], ay = cur[2 * i + 1] - cur[2 * pi + 1];
      const bx = cur[2 * ni] - cur[2 * i], by = cur[2 * ni + 1] - cur[2 * i + 1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la < minLen || (la > 0 && lb > 0 && (ax * bx + ay * by) / (la * lb) > cosTol)) drop = i;
    }
    if (drop < 0) return cur;
    cur.splice(2 * drop, 2);
  }
  return cur;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 碎片密度：刀根附近密、刀尖附近疏，刃口一侧略疏（参考动画截图） */
function density(x: number, y: number): number {
  const y0 = ROOT_BOUNDARY[ROOT_BOUNDARY.length - 1][1] * ROOT_TEX_LEN;
  const t = clamp01((y - y0) / (BLADE_LEN - y0));
  return (1.55 - 0.85 * Math.pow(t, 0.8)) * (1.12 - 0.24 * acrossOf(x, y));
}

export interface BladeCell {
  index: number;
  /** 逆时针多边形（刀身局部坐标） */
  poly: Poly;
  cx: number;
  cy: number;
  area: number;
  /** 离刀顺序：0 = 最靠刀尖，SHARD_COUNT − 1 = 最靠刀根 */
  rank: number;
}

let cached: BladeCell[] | null = null;

/** 128 片碎刃（确定、缓存；返回的数组与多边形不要修改） */
export function bladeCells(): BladeCell[] {
  if (cached) return cached;
  const region = shardRegion();
  // 各向异性空间
  const sRegion: Poly = region.map((v, i) => (i % 2 ? v / ANISO : v));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < sRegion.length; i += 2) {
    minX = Math.min(minX, sRegion[i]); maxX = Math.max(maxX, sRegion[i]);
    minY = Math.min(minY, sRegion[i + 1]); maxY = Math.max(maxY, sRegion[i + 1]);
  }
  const box: Poly = [minX - 0.01, minY - 0.01, maxX + 0.01, minY - 0.01, maxX + 0.01, maxY + 0.01, minX - 0.01, maxY + 0.01];
  const rand = mulberry32(SEED);
  const dens = (sx: number, sy: number): number => density(sx, sy * ANISO);
  // 播种：按密度拒绝采样 + 最小间距
  const area = polyArea(sRegion);
  const sites: number[] = [];
  const baseR = Math.sqrt(area / SHARD_COUNT) * 0.55;
  for (let tries = 0; sites.length < SHARD_COUNT * 2 && tries < 200000; tries++) {
    const x = minX + rand() * (maxX - minX), y = minY + rand() * (maxY - minY);
    if (!pointInPoly(sRegion, x, y)) continue;
    const d = dens(x, y);
    if (rand() * 1.7 > d) continue;
    const r = baseR / Math.sqrt(d);
    let ok = true;
    for (let k = 0; k < sites.length; k += 2) {
      if (Math.hypot(sites[k] - x, sites[k + 1] - y) < r) { ok = false; break; }
    }
    if (!ok) continue;
    sites.push(x, y);
    if (sites.length >= SHARD_COUNT * 2) break;
  }
  // 间距太严时补足（极少发生）
  while (sites.length < SHARD_COUNT * 2) {
    const x = minX + rand() * (maxX - minX), y = minY + rand() * (maxY - minY);
    if (pointInPoly(sRegion, x, y)) sites.push(x, y);
  }

  // 每个站点最近的 NEIGHBORS 个邻居（插入排序选出，避免整表排序）
  const near = new Int32Array(NEIGHBORS);
  const nearD = new Float64Array(NEIGHBORS);
  const cellsOf = (): Poly[] => {
    const out: Poly[] = [];
    for (let i = 0; i < SHARD_COUNT; i++) {
      const sx = sites[2 * i], sy = sites[2 * i + 1];
      let count = 0;
      for (let j = 0; j < SHARD_COUNT; j++) {
        if (j === i) continue;
        const dx = sites[2 * j] - sx, dy = sites[2 * j + 1] - sy;
        const d = dx * dx + dy * dy;
        if (count === NEIGHBORS && d >= nearD[NEIGHBORS - 1]) continue;
        let k = count < NEIGHBORS ? count++ : NEIGHBORS - 1;
        while (k > 0 && nearD[k - 1] > d) {
          nearD[k] = nearD[k - 1];
          near[k] = near[k - 1];
          k--;
        }
        nearD[k] = d;
        near[k] = j;
      }
      let cell = box;
      for (let k = 0; k < count; k++) {
        const j = near[k];
        const ox = sites[2 * j], oy = sites[2 * j + 1];
        const a = ox - sx, b = oy - sy;
        const mx = (sx + ox) / 2, my = (sy + oy) / 2;
        cell = clipHalf(cell, a, b, a * mx + b * my);
      }
      // 完全在区域内的单元不必再裁（大多数）；贴边的用区域裁剪
      let inside = true;
      for (let k = 0; k < cell.length; k += 2) if (!pointInPoly(sRegion, cell[k], cell[k + 1])) { inside = false; break; }
      out.push(inside ? cell : clipByConvex(sRegion, cell));
    }
    return out;
  };

  for (let it = 0; it < LLOYD_ITERS; it++) {
    const cells = cellsOf();
    for (let i = 0; i < SHARD_COUNT; i++) {
      const c = cells[i];
      if (c.length < 6) continue;
      // 按密度加权的质心（以多边形质心为扇心三角化）
      const [gx, gy] = polyCentroid(c);
      let w = 0, wx = 0, wy = 0;
      for (let k = 0, n = c.length / 2; k < n; k++) {
        const l = (k + 1) % n;
        const ax = c[2 * k], ay = c[2 * k + 1], bx = c[2 * l], by = c[2 * l + 1];
        const ta = Math.abs((ax - gx) * (by - gy) - (bx - gx) * (ay - gy)) / 2;
        const tx = (gx + ax + bx) / 3, ty = (gy + ay + by) / 3;
        const tw = ta * dens(tx, ty);
        w += tw; wx += tx * tw; wy += ty * tw;
      }
      if (w > 0 && pointInPoly(sRegion, wx / w, wy / w)) {
        sites[2 * i] = wx / w;
        sites[2 * i + 1] = wy / w;
      }
    }
  }

  const final = cellsOf();
  const cells: BladeCell[] = final.map((c, index) => {
    // 只去掉重合点与几乎共线的点：删掉短边的端点会切掉一角，在相邻碎片之间留下三角形空洞
    const poly = ensureCcw(simplify(c.map((v, i) => (i % 2 ? v * ANISO : v)), 0.00015, Math.cos((0.8 * Math.PI) / 180)));
    const [cx, cy] = polyCentroid(poly);
    return { index, poly, cx, cy, area: polyArea(poly), rank: 0 };
  });
  // 离刀顺序：刀尖在前（按质心长度坐标，同高时刃口在前）
  const byTip = cells.slice().sort((a, b) => b.cy + 0.15 * acrossOf(b.cx, b.cy) * 0.02 - (a.cy + 0.15 * acrossOf(a.cx, a.cy) * 0.02));
  byTip.forEach((c, k) => { c.rank = k; });
  cached = cells;
  return cells;
}
