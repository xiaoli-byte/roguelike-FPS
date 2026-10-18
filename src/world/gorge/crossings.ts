/**
 * 4-2 的过河与上下设施（docs/level-design/chuanzang-v1.md 3.3）：铁索桥、藤索吊桥、伸臂木桥、栈道、溜索、河心跳石。
 * 每样东西都同时给出：程序化白模、行走碰撞体（桥面 / 栈道是一级级可站立的方块）、自动验收要用的「这条路由哪些碰撞体组成」。
 * 铁索桥和吊桥按桥长分成几段，每段单独成网格，按 4t(1−t) 的幅度左右晃；碰撞体不晃（晃幅只有几厘米）。
 * 铁链用单独的材质，被雷劈中或雷桩放电时整座桥发紫红光（electrify）。
 */
import * as THREE from 'three';
import { GeoBuilder, mat4 } from '../plateau/geo';
import { patchMaterial } from '../plateau/materials';
import type { Collider, CollisionWorld } from '../plateau/walker';
import { SPANS, STONES, ZIPS, type SpanSpec, type ZipSpec } from './spec';
import type { GorgeTerrain } from './terrain';

const IRON = '#34343a', WOOD = '#ffffff', WOOD_DARK = '#7a4a30', ROPE = '#6d5a3c', STONE = '#7d7870';

/** 一条过河 / 上下的路：组成它的碰撞体（自动验收逐个断开时关掉它们） */
export interface Route { id: string; name: string; colliders: Collider[] }

export interface Zip {
  spec: ZipSpec;
  /** 钢索两头（起点高、终点低） */
  a: THREE.Vector3; b: THREE.Vector3;
  length: number;
  /** 钢索在 t（0..1）处的位置（含一点下垂） */
  at(t: number, out?: THREE.Vector3): THREE.Vector3;
  /** 锚桩被打断：钢索弹起、暂时不能用 */
  cut: boolean;
  handle: THREE.Object3D;
}

export interface CrossingField {
  group: THREE.Group;
  routes: Route[];
  zips: Zip[];
  /** 铁索桥上的导体点（落雷用）；劈中这些点时桥带电 */
  ironConductors: THREE.Vector3[];
  /** 其他导体（溜索钢索） */
  conductors: THREE.Vector3[];
  /** 铁索桥带电 0..1（检视页每帧衰减） */
  electrify(v: number): void;
  readonly charge: number;
  /** 栈道可砸断段：plank id + 段号 → 断 / 接上 */
  breakPlank(plank: string, seg: number, broken: boolean): void;
  plankBroken(plank: string, seg: number): boolean;
  /** 跳石（涨水时被淹） */
  stoneTop: number;
  update(t: number, dt: number, gust: number): void;
  /** 桥面中点（大鹗落脚、机位） */
  ironMid: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);

/** 桥：两头 a、b，中间按 4t(1−t) 下垂 sag 米 */
function spanPoint(s: SpanSpec, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(
    s.a[0] + (s.b[0] - s.a[0]) * t,
    s.a[1] + (s.b[1] - s.a[1]) * t - s.sag * 4 * t * (1 - t),
    s.a[2] + (s.b[2] - s.a[2]) * t,
  );
}

export function buildCrossings(terrain: GorgeTerrain, world: CollisionWorld): CrossingField {
  const group = new THREE.Group();
  group.name = 'crossings';
  const routes: Route[] = [];
  const ironConductors: THREE.Vector3[] = [];
  const conductors: THREE.Vector3[] = [];
  const swayers: { obj: THREE.Object3D; amp: number; dir: THREE.Vector3; phase: number; speed: number }[] = [];
  const chainMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color('#e03ac8'), emissiveIntensity: 0 }), { rim: 0.3 });
  let charge = 0;

  const addCol = (list: Collider[], c: Collider): void => { world.add(c); list.push(c); };

  // ───────────── 铁索桥 / 藤索吊桥：分段建网格，各段按位置晃 ─────────────
  for (const s of SPANS.filter(sp => sp.kind !== 'cantilever')) {
    const iron = s.kind === 'iron';
    const cols: Collider[] = [];
    const A = new THREE.Vector3(s.a[0], s.a[1], s.a[2]), B = new THREE.Vector3(s.b[0], s.b[1], s.b[2]);
    const flat = new THREE.Vector3(B.x - A.x, 0, B.z - A.z);
    const L = flat.length();
    flat.normalize();
    const side = new THREE.Vector3(-flat.z, 0, flat.x);
    const yaw = Math.atan2(flat.x, flat.z);
    const W = s.width;
    const pieces = Math.max(4, Math.round(L / (iron ? 8 : 6)));
    for (let p = 0; p < pieces; p++) {
      const t0 = p / pieces, t1 = (p + 1) / pieces, tm = (t0 + t1) / 2;
      const b = new GeoBuilder(), chains = new GeoBuilder();
      const center = spanPoint(s, tm);
      // 本段局部坐标：原点在段中心，几何直接写世界坐标再减去中心（方便整段平移晃动）
      const off = (v: THREE.Vector3): THREE.Vector3 => v.clone().sub(center);
      const n = 6;
      for (let k = 0; k < n; k++) {
        const ta = t0 + ((t1 - t0) * k) / n, tb = t0 + ((t1 - t0) * (k + 1)) / n;
        const pa = spanPoint(s, ta), pb = spanPoint(s, tb);
        // 底链（铁索桥 9 根；吊桥 2 根藤索）+ 扶手链（两侧各 2 根 / 1 根）
        const floor = iron ? 9 : 2;
        for (let c = 0; c < floor; c++) {
          const o = (c / (floor - 1) - 0.5) * (W - 0.2);
          chains.rod('plain', off(pa.clone().addScaledVector(side, o).add(new THREE.Vector3(0, -0.12, 0))), off(pb.clone().addScaledVector(side, o).add(new THREE.Vector3(0, -0.12, 0))), iron ? 0.045 : 0.06, iron ? IRON : ROPE, 4);
        }
        for (const sd of [-1, 1]) for (const h of iron ? [0.6, 1.15] : [1.0]) {
          const lift = (t: number): number => h + (iron ? 0 : 0.25 * Math.sin(t * Math.PI));
          chains.rod('plain', off(pa.clone().addScaledVector(side, sd * (W / 2 + 0.05)).add(new THREE.Vector3(0, lift(ta), 0))),
            off(pb.clone().addScaledVector(side, sd * (W / 2 + 0.05)).add(new THREE.Vector3(0, lift(tb), 0))), iron ? 0.04 : 0.05, iron ? IRON : ROPE, 4);
        }
      }
      // 桥板：横铺木板（铁索桥满铺，吊桥稀一点）+ 两条顺铺的走道板
      const step = iron ? 0.36 : 0.55;
      const len = L * (t1 - t0);
      for (let d = step / 2; d < len; d += step) {
        const t = t0 + (d / len) * (t1 - t0);
        const q = spanPoint(s, t);
        const plankW = W * (0.94 + 0.08 * Math.sin(d * 13.1));
        b.add('wood', new THREE.BoxGeometry(plankW, 0.06, step * 0.78), (Math.floor(d * 7) % 3) ? '#e2c49f' : '#cfae88',
          mat4(q.x - center.x, q.y - center.y - 0.04, q.z - center.z, yaw), { tile: 1.2 });
      }
      if (iron) for (const o of [-0.45, 0.45]) {
        const pa = spanPoint(s, t0), pb = spanPoint(s, t1);
        b.rod('wood', off(pa.clone().addScaledVector(side, o).add(new THREE.Vector3(0, 0.0, 0))), off(pb.clone().addScaledVector(side, o).add(new THREE.Vector3(0, 0.0, 0))), 0.12, '#d9b892', 4);
      }
      // 扶手链之间的竖向连杆（铁索桥）/ 吊绳（吊桥）
      for (let d = 0; d < len; d += iron ? 2 : 1.5) {
        const q = spanPoint(s, t0 + (d / len) * (t1 - t0));
        for (const sd of [-1, 1]) {
          const base = q.clone().addScaledVector(side, sd * (W / 2 + 0.05));
          chains.rod('plain', off(base.clone().add(new THREE.Vector3(0, -0.1, 0))), off(base.clone().add(new THREE.Vector3(0, iron ? 1.15 : 1.0, 0))), 0.025, iron ? IRON : ROPE, 3);
        }
      }
      const g = b.build(`${s.id}-deck-${p}`);
      const cg = chains.build(`${s.id}-chain-${p}`, { castShadow: true });
      if (iron) cg.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = chainMat; });
      const piece = new THREE.Group();
      piece.add(g, cg);
      piece.position.copy(center);
      group.add(piece);
      swayers.push({ obj: piece, amp: (iron ? 0.06 : 0.16) * 4 * tm * (1 - tm), dir: side.clone(), phase: tm * 1.2, speed: iron ? 1.1 : 1.6 });
      piece.userData.base = center.clone();
    }
    // 碰撞：桥面一级级可站立的方块（每 1.2 m 一块）+ 两侧扶手（跳得过去）
    const N = Math.ceil(L / 1.2);
    for (let i = 0; i < N; i++) {
      const tm = (i + 0.5) / N, q = spanPoint(s, tm);
      addCol(cols, { kind: 'box', x: q.x, z: q.z, hx: W / 2, hz: L / N / 2 + 0.05, yaw, y0: q.y - 0.5, y1: q.y, walkable: true });
      // 扶手碰撞离两头桥面各让出 1.5 m，斜着上桥不会卡在扶手头上
      if (tm * L < 1.5 || (1 - tm) * L < 1.5) continue;
      for (const sd of [-1, 1]) {
        const r = q.clone().addScaledVector(side, sd * (W / 2 + 0.12));
        addCol(cols, { kind: 'box', x: r.x, z: r.z, hx: 0.08, hz: L / N / 2 + 0.05, yaw, y0: q.y - 0.2, y1: q.y + 1.05, walkable: false });
      }
    }
    if (iron) for (let t = 0.05; t < 1; t += 0.1) {
      const q = spanPoint(s, t);
      for (const sd of [-1, 1]) ironConductors.push(q.clone().addScaledVector(side, sd * (W / 2)).add(new THREE.Vector3(0, 1.2, 0)));
    }
    routes.push({ id: s.id, name: s.name, colliders: cols });
  }

  // ───────────── 伸臂木桥：两岸各三层原木一层层往外伸，托住中间的桥面 ─────────────
  for (const s of SPANS.filter(sp => sp.kind === 'cantilever')) {
    const cols: Collider[] = [];
    const A = new THREE.Vector3(s.a[0], s.a[1], s.a[2]), B = new THREE.Vector3(s.b[0], s.b[1], s.b[2]);
    const flat = new THREE.Vector3(B.x - A.x, 0, B.z - A.z);
    const L = flat.length();
    flat.normalize();
    const yaw = Math.atan2(flat.x, flat.z);
    const b = new GeoBuilder();
    const mid = A.clone().lerp(B, 0.5);
    b.setFrame(mid.x, A.y, mid.z, yaw);
    b.box('wood', s.width, 0.25, L + 4, '#d9b892', 0, -0.25, 0, 0, { tile: 1.4 });
    for (let z = -L / 2 - 2; z < L / 2 + 2; z += 0.5) b.box('wood', s.width + 0.1, 0.05, 0.4, '#cfae88', 0, -0.02, z);
    for (const end of [-1, 1]) {
      // 岸边石砌桥台 + 三层原木
      b.box('stone', s.width + 2.4, 5, 3.2, '#9a948a', 0, -5.2, end * (L / 2 + 1.2), 0, { tile: 1.6 });
      for (let k = 0; k < 3; k++) {
        const reach = 2.2 + k * 1.8, yy = -1.2 - (2 - k) * 0.45;
        for (const x of [-0.7, -0.25, 0.25, 0.7]) {
          b.add('wood', new THREE.CylinderGeometry(0.17, 0.19, reach + 1.5, 7).rotateX(Math.PI / 2), WOOD_DARK,
            mat4(x * s.width * 0.5, yy, end * (L / 2 + 0.75 - reach / 2), 0));
        }
      }
      for (const x of [-1, 1]) b.cyl('wood', 0.09, 0.11, 1.3, WOOD_DARK, x * (s.width / 2 + 0.05), 0, end * (L / 2 + 1.5), 6);
    }
    for (const x of [-1, 1]) b.rod('wood', b.world(x * (s.width / 2 + 0.05), 1.1, -L / 2 - 1.5), b.world(x * (s.width / 2 + 0.05), 1.1, L / 2 + 1.5), 0.05, '#c9a27b', 4);
    group.add(b.build(s.id));
    addCol(cols, { kind: 'box', x: mid.x, z: mid.z, hx: s.width / 2, hz: L / 2 + 2, yaw, y0: A.y - 0.6, y1: A.y, walkable: true });
    for (const x of [-1, 1]) {
      const r = mid.clone().addScaledVector(new THREE.Vector3(-flat.z, 0, flat.x), x * (s.width / 2 + 0.1));
      addCol(cols, { kind: 'box', x: r.x, z: r.z, hx: 0.08, hz: L / 2 - 0.5, yaw, y0: A.y - 0.2, y1: A.y + 1.1, walkable: false });
    }
    routes.push({ id: s.id, name: s.name, colliders: cols });
  }

  // ───────────── 栈道：一级级木板（陡处就是台阶），外侧矮栏，下面斜撑插进崖里 ─────────────
  const plankGroups = new Map<string, { meshes: THREE.Object3D[]; cols: Collider[] }>();
  for (const pl of terrain.planks) {
    const cols: Collider[] = [];
    const segOf = (i: number): number => pl.breakable.findIndex(([a, b]) => i >= a && i < b);
    const builders = new Map<number, GeoBuilder>();
    const bOf = (seg: number): GeoBuilder => { let g = builders.get(seg); if (!g) builders.set(seg, g = new GeoBuilder()); return g; };
    const segCols = new Map<number, Collider[]>();
    for (let i = 0; i < pl.pts.length - 1; i++) {
      const [ax, az, ay] = pl.pts[i], [bx, bz, by] = pl.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      // 拐角是一块 2.2 m 见方的平台（高度 = 节点高度），台阶只铺在两头平台之间，整段高差都在这一截里走完
      const trimA = i > 0 ? 1.1 : 0, trimB = i < pl.pts.length - 2 ? 1.1 : 0;
      const run = Math.max(0.3, len - trimA - trimB);
      const grade = Math.abs(by - ay) / run;
      // 每一级：起伏不超过 0.36 m（行走能迈上去的台阶），平的地方 1 m 一块
      const n = Math.max(1, Math.ceil(run / Math.min(1.0, 0.36 / Math.max(grade, 1e-3))));
      const ux = (bx - ax) / len, uz = (bz - az) / len, yaw = Math.atan2(ux, uz);
      const sx = -uz, sz = ux;
      const seg = segOf(i);
      const b = bOf(seg);
      // 外侧（河一侧）= 地形更低的一侧
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const outer = terrain.heightAt(mx + sx * 2.5, mz + sz * 2.5) < terrain.heightAt(mx - sx * 2.5, mz - sz * 2.5) ? 1 : -1;
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n, t = (trimA + u * run) / len;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ay + (by - ay) * u;
        const piece = run / n;
        b.add('wood', new THREE.BoxGeometry(1.8, 0.14, piece + 0.04), k % 2 ? '#d8b892' : '#c9a580', mat4(x, y - 0.14, z, yaw), { tile: 1.1 });
        const c: Collider = { kind: 'box', x, z, hx: 0.9, hz: piece / 2 + 0.03, yaw, y0: y - 0.5, y1: y, walkable: true };
        addCol(cols, c);
        if (seg >= 0) { let l = segCols.get(seg); if (!l) segCols.set(seg, l = []); l.push(c); }
      }
      // 每 2 m 一根斜撑（外沿往下斜插进崖）+ 外侧栏杆柱
      for (let d = 0.5; d < len; d += 2) {
        const t = d / len;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ay + (by - ay) * t;
        const edge = new THREE.Vector3(x + sx * outer * 0.85, y - 0.2, z + sz * outer * 0.85);
        const wall = new THREE.Vector3(x - sx * outer * 0.9, y - 2.2, z - sz * outer * 0.9);
        b.rod('wood', wall, edge, 0.07, WOOD_DARK, 5);
        b.rod('wood', new THREE.Vector3(x - sx * outer * 1.2, y - 0.25, z - sz * outer * 1.2), new THREE.Vector3(x + sx * outer * 0.9, y - 0.25, z + sz * outer * 0.9), 0.08, WOOD_DARK, 5);
        b.cyl('wood', 0.05, 0.06, 1.05, WOOD_DARK, edge.x, y - 0.1, edge.z, 5);
      }
      const ra = new THREE.Vector3(ax + sx * outer * 0.85, ay + 0.95, az + sz * outer * 0.85), rb = new THREE.Vector3(bx + sx * outer * 0.85, by + 0.95, bz + sz * outer * 0.85);
      b.rod('plain', ra, rb, 0.03, ROPE, 4);
      // 栏杆碰撞两头各让出 1.2 m（从平台、拐角上下栈道不会被栏杆挡住）；台阶很陡时不放（碰撞体是水平的，会挡住下坡）
      const rc: Collider = { kind: 'box', x: mx + sx * outer * 0.95, z: mz + sz * outer * 0.95, hx: 0.06, hz: len / 2 - 1.2, yaw, y0: Math.min(ay, by) - 0.2, y1: Math.min(ay, by) + 0.95, walkable: false };
      if (grade < 0.2 && rc.hz > 0.5) { addCol(cols, rc); if (seg >= 0) segCols.get(seg)?.push(rc); }
    }
    // 拐角平台
    for (let i = 1; i < pl.pts.length - 1; i++) {
      const [x, z, y] = pl.pts[i];
      const seg = segOf(i) >= 0 ? segOf(i) : segOf(i - 1);
      const [px, pz] = pl.pts[i - 1], yaw = Math.atan2(x - px, z - pz);
      bOf(seg).add('wood', new THREE.BoxGeometry(2.2, 0.16, 2.2), '#cfae88', mat4(x, y - 0.16, z, yaw), { tile: 1.1 });
      const c: Collider = { kind: 'box', x, z, hx: 1.1, hz: 1.1, yaw, y0: y - 0.5, y1: y, walkable: true };
      addCol(cols, c);
      if (seg >= 0) { let l = segCols.get(seg); if (!l) segCols.set(seg, l = []); l.push(c); }
    }
    for (const [seg, b] of builders) {
      const g = b.build(`${pl.id}-${seg}`);
      group.add(g);
      if (seg >= 0) plankGroups.set(`${pl.id}:${seg}`, { meshes: [g], cols: segCols.get(seg) ?? [] });
    }
    routes.push({ id: pl.id, name: pl.name, colliders: cols });
  }

  // ───────────── 溜索：起点高架（两根木杆 + 横梁 + 滑轮挂钩），终点矮架；钢索略下垂 ─────────────
  const zips: Zip[] = [];
  for (const zs of ZIPS) {
    const b = new GeoBuilder();
    const [fx, fz, fy] = zs.from, [tx, tz, ty] = zs.to;
    const a = new THREE.Vector3(fx, fy + 5.0, fz), e = new THREE.Vector3(tx, ty + 3.8, tz);
    const length = a.distanceTo(e);
    const sag = length * 0.012;
    const at = (t: number, out = new THREE.Vector3()): THREE.Vector3 => out.lerpVectors(a, e, t).setY(a.y + (e.y - a.y) * t - sag * 4 * t * (1 - t));
    for (const [p, h] of [[a, 5.2], [e, 4.0]] as const) {
      const dir = new THREE.Vector3(e.x - a.x, 0, e.z - a.z).normalize();
      const sd = new THREE.Vector3(-dir.z, 0, dir.x);
      const g = p.y - h + 0.2;
      for (const k of [-1, 1]) b.cyl('wood', 0.12, 0.15, h + 0.3, WOOD_DARK, p.x + sd.x * k * 1.1, g - 0.3, p.z + sd.z * k * 1.1, 7);
      b.rod('wood', new THREE.Vector3(p.x - sd.x * 1.25, p.y + 0.1, p.z - sd.z * 1.25), new THREE.Vector3(p.x + sd.x * 1.25, p.y + 0.1, p.z + sd.z * 1.25), 0.12, WOOD_DARK, 6);
      // 拉线（后方斜拉到地上）
      const back = p === a ? -1 : 1;
      b.rod('plain', p.clone(), new THREE.Vector3(p.x + dir.x * back * 5, g - 0.2, p.z + dir.z * back * 5), 0.03, IRON, 4);
      for (const k of [-1, 1]) world.add({ kind: 'cyl', x: p.x + sd.x * k * 1.1, z: p.z + sd.z * k * 1.1, r: 0.2, y0: g - 0.5, y1: g + h, walkable: false });
    }
    const segs = 16;
    for (let i = 0; i < segs; i++) b.rod('plain', at(i / segs), at((i + 1) / segs), 0.03, '#4a4a52', 4);
    group.add(b.build(zs.id));
    for (let i = 1; i < 6; i++) conductors.push(at(i / 6));
    // 挂钩：滑轮 + 皮绳 + 横把手（骑上去时跟着人走）
    const hb = new GeoBuilder();
    hb.cyl('plain', 0.14, 0.14, 0.1, IRON, 0, -0.05, 0, 10, undefined, 0, Math.PI / 2);
    hb.rod('plain', new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, -1.1, 0), 0.025, ROPE, 4);
    hb.rod('wood', new THREE.Vector3(-0.35, -1.1, 0), new THREE.Vector3(0.35, -1.1, 0), 0.04, WOOD_DARK, 5);
    const handle = hb.build(`${zs.id}-handle`);
    handle.position.copy(at(0.012));
    group.add(handle);
    zips.push({ spec: zs, a, b: e, length, at, cut: false, handle });
  }

  // ───────────── 河心跳石 ─────────────
  const stoneCols: Collider[] = [];
  const sb = new GeoBuilder();
  const wl = terrain.baseWaterAt((STONES.a[0] + STONES.b[0]) / 2, (STONES.a[1] + STONES.b[1]) / 2);
  const stoneTop = wl + STONES.top;
  for (let i = 0; i < STONES.n; i++) {
    const t = (i + 0.5) / STONES.n;
    const x = STONES.a[0] + (STONES.b[0] - STONES.a[0]) * t, z = STONES.a[1] + (STONES.b[1] - STONES.a[1]) * t;
    const r = 0.85 + 0.15 * Math.sin(i * 2.3);
    const g = terrain.heightAt(x, z);
    sb.cyl('stone', r * 0.9, r * 1.1, stoneTop - g + 0.2, STONE, x, g - 0.2, z, 8, { tile: 1.2 });
    sb.rock('plain', r * 0.75, '#8d877d', x, stoneTop - r * 0.45, z, 0.5, i * 5 + 2);
    addCol(stoneCols, { kind: 'cyl', x, z, r: r * 0.95, y0: g - 1, y1: stoneTop, walkable: true });
  }
  group.add(sb.build('stones'));
  routes.push({ id: STONES.id, name: STONES.name, colliders: stoneCols });

  const ironSpan = SPANS.find(s => s.kind === 'iron')!;
  const ironMid = spanPoint(ironSpan, 0.5);

  return {
    group, routes, zips, ironConductors, conductors, ironMid, stoneTop,
    get charge() { return charge; },
    electrify(v: number) { charge = Math.max(charge, v); },
    breakPlank(plank: string, seg: number, broken: boolean) {
      const g = plankGroups.get(`${plank}:${seg}`);
      if (!g) return;
      for (const m of g.meshes) m.visible = !broken;
      for (const c of g.cols) c.off = broken;
    },
    plankBroken(plank: string, seg: number) { return !!plankGroups.get(`${plank}:${seg}`)?.cols[0]?.off; },
    update(t: number, dt: number, gust: number) {
      for (const s of swayers) {
        const base = s.obj.userData.base as THREE.Vector3;
        const k = s.amp * (1 + 2.5 * gust) * Math.sin(t * s.speed + s.phase) + s.amp * 0.4 * Math.sin(t * s.speed * 2.3 + s.phase * 2);
        s.obj.position.copy(base).addScaledVector(s.dir, k).addScaledVector(UP, -Math.abs(k) * 0.3);
      }
      charge = Math.max(0, charge - dt * 0.25);
      chainMat.emissiveIntensity = charge > 0.01 ? charge * (1.6 + 1.2 * Math.sin(t * 47) * Math.sin(t * 13)) : 0;
      for (const z of zips) if (!z.cut && z.handle.userData.riding !== true) z.at(0.012, z.handle.position);
    },
  };
}
