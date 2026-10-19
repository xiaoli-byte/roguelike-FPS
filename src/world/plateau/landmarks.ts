/**
 * 地标与场景物件的程序化白模（docs/level-design/chuanzang-v1.md 第 2.2 节）。
 * 每个物件在自己的局部坐标里搭：原点在底面中心，正面朝 +z；落地高度取占地范围内的最低地形，避免悬空。
 * 静态部分全部进同一个 GeoBuilder，按材质合并；会动的（转经筒、牦牛、出口光环）单独成网格。
 * 宗教元素只做场景，不做可破坏物；玛尼石刻纹是抽象纹样。
 */
import * as THREE from 'three';
import { FLAG_COLORS, FlagSystem } from './flags';
import { GeoBuilder, mat4 } from './geo';
import { waterMaterial } from './fx';
import { materials, patchMaterial, textTexture, type MaterialKey } from './materials';
import type { HeightGrid } from './grid';
import { FIRES_TO_UNLOCK, FLAG_LINES, PLACEMENTS, type FlagLine, type LandmarkKind, type Placement } from './spec';
import type { Terrain } from './terrain';
import type { CollisionWorld } from './walker';

export interface Animated { update(t: number, dt: number): void }
export interface SmokeEmitter { x: number; y: number; z: number; big: boolean; steam?: boolean }
export interface MapIcon { name: string; x: number; z: number; kind: LandmarkKind | 'bridge' }

/** 点亮的灵火数（检视页开关）；按灵火坛摆放顺序点亮，≥ FIRES_TO_UNLOCK 时垭口经幡门打开 */
/** 灵火：lit 是点亮的个数（垭口经幡门看它）；mask 给了就按坛子编号单独点亮（游玩模式），没给就点亮前 lit 个（检视滑块） */
export const FIRE_STATE: { lit: number; mask?: boolean[] } = { lit: 0 };

export interface BuildCtx {
  /** 4-1 的盆地或 4-2 的峡谷；roadNearest 让房子、经幡避开路面 */
  terrain: HeightGrid & { roadNearest(x: number, z: number): { d: number } };
  b: GeoBuilder;
  flags: FlagSystem;
  world: CollisionWorld;
  /** 不合并的网格（文字牌、会动的物件） */
  extra: THREE.Group;
  anim: Animated[];
  smoke: SmokeEmitter[];
  icons: MapIcon[];
  /** 会引雷的高处导体顶点（经幡杆、拉则、碉楼），雷暴落雷时用 */
  conductors?: THREE.Vector3[];
}

export const C = {
  stone: '#f1ede6', stoneDark: '#cec6ba', white: '#ffffff', chorten: '#f7f4ee',
  ochre: '#963625', black: '#1b1917', wood: '#ffffff', woodPale: '#e6c9a6', woodDark: '#5a2e1f',
  gold: '#e8b43c', red: '#b8322b', blue: '#2c5fb8', green: '#2f8f4c', yellow: '#e2b830',
  bone: '#e6dcc6', horn: '#3b342e', rock: '#8f8a80', gravel: '#9d958a', straw: '#d8b65a',
  tin: '#5f7d99', drumOrange: '#c8642a', drumBlue: '#2f62a8', rope: '#4a3d30',
};

// ───────────────────────────── 局部工具 ─────────────────────────────

export interface Here { x: number; y: number; z: number; yaw: number }

function yawOf(p: Placement): number {
  if (p.face) return Math.atan2(p.face[0] - p.x, p.face[1] - p.z);
  return p.yaw ?? 0;
}

export function ground(ctx: BuildCtx, p: Placement, hx: number, hz: number, sink = 0.08): Here {
  const yaw = yawOf(p);
  return { x: p.x, z: p.z, yaw, y: ctx.terrain.footprintMin(p.x, p.z, hx, hz, yaw) - sink };
}

export function frame(ctx: BuildCtx, h: Here): void { ctx.b.setFrame(h.x, h.y, h.z, h.yaw); }

/** 局部坐标下的碰撞方块（y 相对底面） */
export function boxC(ctx: BuildCtx, h: Here, lx: number, lz: number, hx: number, hz: number, y0: number, y1: number, walkable: boolean, lyaw = 0): void {
  const w = ctx.b.world(lx, 0, lz);
  ctx.world.add({ kind: 'box', x: w.x, z: w.z, hx, hz, yaw: h.yaw + lyaw, y0: h.y + y0, y1: h.y + y1, walkable });
}

export function cylC(ctx: BuildCtx, h: Here, lx: number, lz: number, r: number, y0: number, y1: number, walkable = false): void {
  const w = ctx.b.world(lx, 0, lz);
  ctx.world.add({ kind: 'cyl', x: w.x, z: w.z, r, y0: h.y + y0, y1: h.y + y1, walkable });
}

export function part(b: GeoBuilder, key: MaterialKey, geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, M: THREE.Matrix4, sub?: THREE.Matrix4): void {
  b.add(key, geo, color, sub ? M.clone().multiply(sub) : M);
}

/** 藏式窗：黑色梯形窗套 + 木窗 + 三色窗楣布 + 小檐。窗面朝局部 +z，M 给出墙面上的位置与朝向 */
export function tibetWindow(b: GeoBuilder, M: THREE.Matrix4, w: number, h: number, door = false): void {
  const wb = w + 0.55, wt = w + 0.2, H = h + 0.3;
  const shape = new THREE.Shape();
  shape.moveTo(-wb / 2, -0.15); shape.lineTo(wb / 2, -0.15); shape.lineTo(wt / 2, H - 0.15); shape.lineTo(-wt / 2, H - 0.15); shape.closePath();
  part(b, 'plain', new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false }), C.black, M);
  part(b, door ? 'wood' : 'plain', new THREE.BoxGeometry(w, h, 0.06), door ? C.wood : C.woodDark, M, mat4(0, h / 2, 0.05));
  if (!door) part(b, 'wood', new THREE.BoxGeometry(0.07, h, 0.05), C.wood, M, mat4(0, h / 2, 0.09));
  [C.red, C.blue, C.green].forEach((c, i) => part(b, 'plain', new THREE.BoxGeometry(w + 0.35, 0.1, 0.06), c, M, mat4(0, H - 0.1 - i * 0.1, 0.1)));
  part(b, 'wood', new THREE.BoxGeometry(w + 0.7, 0.12, 0.3), C.wood, M, mat4(0, H + 0.02, 0.12));
}

/** 四角白石（嘉绒民居和碉楼屋顶四角的白色台座） */
export function cornerHorn(b: GeoBuilder, x: number, y: number, z: number): void {
  b.box('whitewash', 0.7, 0.55, 0.7, C.white, x, y, z);
  b.box('whitewash', 0.45, 0.4, 0.45, C.white, x, y + 0.55, z);
  b.rock('plain', 0.18, '#fbfbf7', x, y + 0.95, z, 0.9, x * 3 + z);
}

function miniChorten(b: GeoBuilder, x: number, y: number, z: number, s = 1): void {
  b.box('whitewash', 1.1 * s, 0.7 * s, 1.1 * s, C.chorten, x, y, z);
  b.box('whitewash', 0.85 * s, 0.4 * s, 0.85 * s, C.chorten, x, y + 0.7 * s, z);
  b.lathe('plain', [[0, 0], [0.45 * s, 0], [0.5 * s, 0.2 * s], [0.42 * s, 0.45 * s], [0.2 * s, 0.6 * s], [0, 0.62 * s]], C.chorten, x, y + 1.1 * s, z, 12);
  b.cyl('gold', 0.04 * s, 0.13 * s, 0.7 * s, C.gold, x, y + 1.65 * s, z, 8);
}

export function flagPole(ctx: BuildCtx, x: number, z: number, height: number, banner = false): THREE.Vector3 {
  const y = ctx.terrain.heightAt(x, z) - 0.2;
  ctx.b.clearFrame();
  ctx.b.cyl('wood', 0.07, 0.1, height + 0.2, C.woodPale, x, y, z, 6);
  ctx.b.rock('plain', 0.45, C.rock, x, y, z, 0.6, x + z);
  ctx.world.add({ kind: 'cyl', x, z, r: 0.2, y0: y, y1: y + height, walkable: false });
  if (banner) ctx.flags.addBanner(new THREE.Vector3(x, y + height * 0.45, z), height * 0.5, 0.7, 0.35, FLAG_COLORS[Math.floor(Math.abs(x * 7 + z)) % 5]);
  const top = new THREE.Vector3(x, y + height + 0.2, z);
  ctx.conductors?.push(top);
  return top;
}

// ───────────────────────────── 地标 ─────────────────────────────

/** 嘉绒四角碉：24 m，底 6.4 m 见方收到 4.6 m，片石砌，木筋层、小窗、高处木门和独木梯、白色顶带与四角白石 */
function diaolou(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 3.2, 3.2, 0.3), b = ctx.b;
  frame(ctx, h);
  const H = 24, B = 6.4, T = 4.6;
  const half = (y: number): number => (B + (T - B) * (y / H)) / 2;
  const body = new THREE.CylinderGeometry(T / Math.SQRT2, (B + 0.25) / Math.SQRT2, H + 1.5, 4, 1);
  body.rotateY(Math.PI / 4); body.translate(0, (H + 1.5) / 2 - 1.5, 0);
  b.add('stone', body, C.stone, undefined, { tile: 2.2 });
  // 木筋层
  for (let y = 2.6; y < H - 2; y += 2.9) {
    const s = half(y) * 2 + 0.1;
    b.box('wood', s, 0.14, s, '#d8b090', 0, y, 0);
  }
  // 顶部白带与平顶女儿墙
  const top = half(H) * 2;
  b.box('whitewash', top + 0.12, 1.5, top + 0.12, C.white, 0, H - 1.5, 0);
  b.box('plain', top + 0.2, 0.18, top + 0.2, C.ochre, 0, H - 1.7, 0);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) cornerHorn(b, sx * (top / 2 - 0.25), H, sz * (top / 2 - 0.25));
  // 小窗（四面，越高越密）
  for (const face of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (const y of [7.5, 11.2, 14.6, 17.8, 20.6]) {
      if (face === 0 && y === 7.5) continue;
      const off = (Math.round(y) % 2 ? 0.7 : -0.6);
      const M = mat4(Math.sin(face) * (half(y) + 0.02) + Math.cos(face) * off, y, Math.cos(face) * (half(y) + 0.02) - Math.sin(face) * off, face);
      part(b, 'plain', new THREE.BoxGeometry(0.34, 0.95, 0.06), '#151311', M);
      part(b, 'wood', new THREE.BoxGeometry(0.6, 0.1, 0.18), C.woodPale, M, mat4(0, 0.55, 0.05));
    }
  }
  // 高处木门 + 独木梯
  const doorY = 5.2, fz = half(doorY) + 0.03;
  tibetWindow(b, mat4(0.2, doorY, fz, 0), 0.9, 1.6, true);
  b.rod('wood', new THREE.Vector3(0.9, 0.1, fz + 3.3), new THREE.Vector3(0.35, doorY + 0.2, fz + 0.15), 0.13, C.woodPale, 6);
  for (let k = 1; k < 9; k++) {
    const t = k / 9;
    b.box('wood', 0.34, 0.06, 0.16, '#c9a27b', 0.9 + (0.35 - 0.9) * t, 0.1 + (doorY + 0.1) * t, fz + 3.3 * (1 - t) + 0.15 * t + 0.08);
  }
  // 顶上经幡杆 + 竖幡，两条经幡拉到台地边
  const pole = b.world(top / 2 - 0.3, H + 1.3, -(top / 2 - 0.3));
  b.cyl('wood', 0.05, 0.07, 4.2, C.woodPale, top / 2 - 0.3, H + 1.1, -(top / 2 - 0.3), 6);
  ctx.flags.addBanner(pole.clone().setY(pole.y + 1.2), 2.4, 0.8, 0.4, FLAG_COLORS[2]);
  for (const [lx, lz] of [[-8, 7], [8, 6]]) {
    const w = b.world(lx, 0, lz);
    const end = flagPole(ctx, w.x, w.z, 3.2);
    frame(ctx, h);
    ctx.flags.addLine(b.world(0, H + 0.6, 0), end, { sag: 0.05 });
  }
  boxC(ctx, h, 0, 0, B / 2, B / 2, -2, H + 1, false);
  ctx.conductors?.push(b.world(0, H + 1.4, 0));
  ctx.icons.push({ name: '碉楼', x: p.x, z: p.z, kind: 'diaolou' });
}

/** 嘉绒石砌民居：12 × 9 m，两层平顶；一层片石，二层白墙，赭红檐带，正面木挑楼，侧面石梯上屋顶（俯射位） */
function house(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 6, 4.5, 0.05), b = ctx.b;
  frame(ctx, h);
  const W = 12, D = 9, F1 = 3.6, F2 = 3.2, R = F1 + F2;
  b.box('stone', W, F1 + 1.2, D, C.stone, 0, -1.2, 0);
  b.box('whitewash', W, F2, D, C.white, 0, F1, 0);
  b.box('plain', W + 0.12, 0.45, D + 0.12, C.ochre, 0, R - 0.55, 0);
  // 女儿墙（右侧靠后留楼梯口）
  const par = (lx: number, lz: number, w: number, d: number): void => { b.box('whitewash', w, 0.7, d, C.white, lx, R, lz); };
  par(0, D / 2 - 0.2, W, 0.4); par(0, -D / 2 + 0.2, W, 0.4); par(-W / 2 + 0.2, 0, 0.4, D);
  par(W / 2 - 0.2, 1.3, 0.4, D - 2.6);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) cornerHorn(b, sx * (W / 2 - 0.35), R + 0.7, sz * (D / 2 - 0.35));
  // 屋顶小经堂（后左）
  b.box('whitewash', 4.6, 2.6, 3.8, C.white, -3.2, R, -2.3);
  b.box('plain', 4.7, 0.35, 3.9, C.ochre, -3.2, R + 2.25, -2.3);
  b.box('wood', 5.0, 0.18, 4.2, C.wood, -3.2, R + 2.6, -2.3);
  tibetWindow(b, mat4(-3.2, R + 0.8, -2.3 + 1.92, 0), 1.0, 1.1);
  // 正面木挑楼（二层左）
  b.box('wood', 4.4, 2.8, 1.5, C.wood, -3.4, F1 + 0.1, D / 2 + 0.75, 0, { tile: 1.6 });
  for (const lx of [-5.3, -1.5]) b.rod('wood', new THREE.Vector3(lx, F1 + 0.1, D / 2 + 1.4), new THREE.Vector3(lx, F1 - 1.1, D / 2 + 0.05), 0.08, C.woodPale);
  tibetWindow(b, mat4(-3.4, F1 + 0.8, D / 2 + 1.51, 0), 1.6, 1.3);
  // 窗与门
  tibetWindow(b, mat4(1.0, F1 + 0.8, D / 2 + 0.01, 0), 1.1, 1.3);
  tibetWindow(b, mat4(4.0, F1 + 0.8, D / 2 + 0.01, 0), 1.1, 1.3);
  tibetWindow(b, mat4(2.5, 0, D / 2 + 0.01, 0), 1.4, 2.2, true);
  tibetWindow(b, mat4(-3.0, 1.5, D / 2 + 0.01, 0), 0.6, 0.7);
  for (const lz of [-2.2, 1.8]) {
    tibetWindow(b, mat4(-W / 2 - 0.01, F1 + 0.8, lz, -Math.PI / 2), 1.0, 1.2);
    tibetWindow(b, mat4(W / 2 + 0.01, F1 + 0.8, lz - 1.5, Math.PI / 2), 1.0, 1.2);
  }
  tibetWindow(b, mat4(2.5, F1 + 0.8, -D / 2 - 0.01, Math.PI), 1.0, 1.2);
  // 侧面石梯：沿右墙从前往后爬到屋顶
  const steps = 17, rise = R / steps;
  for (let k = 0; k < steps; k++) {
    const top = rise * (k + 1);
    const lz = D / 2 - 0.4 - k * 0.47;
    b.box('stone', 1.4, top + 1.2, 0.5, C.stoneDark, W / 2 + 0.7, -1.2, lz);
    boxC(ctx, h, W / 2 + 0.7, lz, 0.7, 0.25, -1.2, top, true);
  }
  // 屋顶经幡
  ctx.flags.addLine(b.world(-W / 2 + 0.35, R + 1.6, D / 2 - 0.35), b.world(-3.2, R + 3.4, -2.3), { sag: 0.04 });
  ctx.flags.addLine(b.world(W / 2 - 0.35, R + 1.6, D / 2 - 0.35), b.world(-3.2, R + 3.4, -2.3), { sag: 0.04 });
  b.cyl('wood', 0.04, 0.06, 1.4, C.woodPale, -3.2, R + 2.6, -2.3, 6);
  // 碰撞：主体（屋顶可站）、挑楼、经堂、女儿墙
  boxC(ctx, h, 0, 0, W / 2, D / 2, -1.2, R, true);
  boxC(ctx, h, -3.4, D / 2 + 0.75, 2.2, 0.75, F1 + 0.1, F1 + 2.9, true);
  boxC(ctx, h, -3.2, -2.3, 2.3, 1.9, R, R + 2.8, true);
  boxC(ctx, h, 0, D / 2 - 0.2, W / 2, 0.2, R, R + 0.7, true);
  boxC(ctx, h, 0, -D / 2 + 0.2, W / 2, 0.2, R, R + 0.7, true);
  boxC(ctx, h, -W / 2 + 0.2, 0, 0.2, D / 2, R, R + 0.7, true);
  boxC(ctx, h, W / 2 - 0.2, 1.3, 0.2, (D - 2.6) / 2, R, R + 0.7, true);
  ctx.icons.push({ name: '民居', x: p.x, z: p.z, kind: 'house' });
}

/** 白塔：台基 9 m 见方 1.5 m 高（南面台阶），四层叠涩座、覆钵、塔脖、十三天、伞盖与日月顶，约 12.5 m */
function chorten(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 4.5, 6.5, 0.1), b = ctx.b;
  frame(ctx, h);
  b.box('whitewash', 9, 1.6, 9, C.chorten, 0, -0.1, 0);
  b.box('plain', 9.1, 0.2, 9.1, C.ochre, 0, 1.3, 0);
  for (let k = 0; k < 3; k++) {
    b.box('stone', 3.2, 0.5 * (k + 1) + 0.1, 0.6, C.stoneDark, 0, -0.1, 4.5 + 1.5 - k * 0.6 - 0.3);
    boxC(ctx, h, 0, 4.5 + 1.5 - k * 0.6 - 0.3, 1.6, 0.3, -0.1, 0.5 * (k + 1), true);
  }
  let y = 1.5;
  for (const [s, t] of [[6.4, 1.0], [5.6, 0.8], [4.9, 0.7], [4.3, 0.6]] as [number, number][]) {
    b.box('whitewash', s, t, s, C.chorten, 0, y, 0);
    b.box('plain', s + 0.06, 0.1, s + 0.06, t > 0.75 ? C.ochre : C.gold, 0, y + t - 0.1, 0);
    y += t;
  }
  b.lathe('whitewash', [[0, 0], [1.95, 0], [2.2, 0.35], [2.3, 0.9], [2.2, 1.6], [1.9, 2.3], [1.45, 2.85], [0.9, 3.15], [0, 3.25]], C.chorten, 0, y, 0, 20);
  // 覆钵正面的龛
  const nm = mat4(0, y + 0.95, 2.31, 0);
  part(b, 'gold', new THREE.BoxGeometry(1.1, 1.4, 0.12), C.gold, nm);
  part(b, 'plain', new THREE.BoxGeometry(0.75, 1.05, 0.14), '#2a1d14', nm, mat4(0, 0.05, 0.02));
  y += 3.15;
  b.box('whitewash', 1.5, 0.85, 1.5, C.chorten, 0, y, 0);
  b.box('gold', 1.62, 0.16, 1.62, C.gold, 0, y + 0.72, 0);
  y += 0.88;
  for (let k = 0; k < 13; k++) {
    const r = 0.62 - k * 0.024;
    b.cyl('gold', r * 0.9, r, 0.2, C.gold, 0, y + k * 0.22, 0, 12);
  }
  y += 13 * 0.22;
  b.cyl('gold', 1.0, 0.9, 0.14, C.gold, 0, y, 0, 16);
  const moon = new THREE.TorusGeometry(0.3, 0.07, 6, 14, Math.PI);
  moon.rotateZ(Math.PI);
  b.add('gold', moon, C.gold, mat4(0, y + 0.55, 0));
  b.add('gold', new THREE.SphereGeometry(0.16, 10, 8), C.gold, mat4(0, y + 0.62, 0));
  b.cyl('gold', 0, 0.06, 0.45, C.gold, 0, y + 0.76, 0, 6);
  const tip = b.world(0, y - 0.6, 0);
  boxC(ctx, h, 0, 0, 4.5, 4.5, -0.2, 1.5, true);
  boxC(ctx, h, 0, 0, 3.2, 3.2, 1.5, y + 1, false);
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const w = b.world(Math.cos(a) * 13, 0, Math.sin(a) * 13);
    const end = flagPole(ctx, w.x, w.z, 2.2);
    frame(ctx, h);
    ctx.flags.addLine(tip, end, { sag: 0.035 });
  }
  ctx.icons.push({ name: '白塔', x: p.x, z: p.z, kind: 'chorten' });
}

/** 玛尼墙：片石墙身 + 彩色刻石墙顶 + 两端小塔 */
function maniWall(ctx: BuildCtx, p: Placement): void {
  const L = p.len ?? 24;
  const h = ground(ctx, p, L / 2, 0.8, 0.15), b = ctx.b;
  frame(ctx, h);
  b.box('stone', L, 0.75, 1.4, C.stoneDark, 0, -0.2, 0);
  b.box('mani', L, 0.45, 1.3, C.white, 0, 0.55, 0, 0, { tile: 1.6 });
  b.box('stone', L + 0.2, 0.18, 1.55, C.stone, 0, 1.0, 0);
  let seed = 3;
  const r = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let x = -L / 2 + 0.6; x < L / 2 - 0.5; x += 0.55) {
    for (const lz of [-0.35, 0.35]) {
      b.box('mani', 0.48, 0.4 + r() * 0.15, 0.12, C.white, x + (r() - 0.5) * 0.1, 1.15, lz, (r() - 0.5) * 0.3, { tile: 0.9 }, lz * 0.5);
    }
  }
  miniChorten(b, -L / 2 - 0.9, -0.1, 0, 1.1);
  miniChorten(b, L / 2 + 0.9, -0.1, 0, 1.1);
  boxC(ctx, h, 0, 0, L / 2, 0.78, -0.3, 1.25, true);
  cylC(ctx, h, -L / 2 - 0.9, 0, 0.7, -0.2, 2.6);
  cylC(ctx, h, L / 2 + 0.9, 0, 0.7, -0.2, 2.6);
  ctx.icons.push({ name: '玛尼墙', x: p.x, z: p.z, kind: 'maniWall' });
}

/** 转经亭：四根红柱、金色攒尖顶，中间的大转经筒一直在转 */
function wheelHouse(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 2.3, 2.3, 0.1), b = ctx.b;
  frame(ctx, h);
  b.box('stone', 4.4, 0.45, 4.4, C.stoneDark, 0, -0.15, 0);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    b.cyl('plain', 0.14, 0.16, 2.9, C.red, sx * 1.75, 0.3, sz * 1.75, 8);
    cylC(ctx, h, sx * 1.75, sz * 1.75, 0.2, 0, 3.2);
  }
  b.box('wood', 4.5, 0.35, 4.5, C.wood, 0, 3.2, 0);
  b.box('plain', 4.6, 0.25, 4.6, C.ochre, 0, 3.0, 0);
  const roof = new THREE.ConeGeometry(3.35, 1.5, 4, 1);
  roof.rotateY(Math.PI / 4); roof.translate(0, 0.75, 0);
  b.add('gold', roof, '#c99a3c', mat4(0, 3.55, 0));
  b.add('gold', new THREE.SphereGeometry(0.2, 10, 8), C.gold, mat4(0, 5.15, 0));
  b.cyl('gold', 0, 0.07, 0.5, C.gold, 0, 5.3, 0, 6);
  boxC(ctx, h, 0, 0, 2.2, 2.2, -0.2, 0.3, true);
  cylC(ctx, h, 0, 0, 0.85, 0.3, 2.8);
  // 转经筒（单独网格）
  const wb = new GeoBuilder();
  wb.cyl('plain', 0.75, 0.75, 1.8, C.red, 0, -0.9, 0, 20);
  wb.cyl('mani', 0.77, 0.77, 0.9, C.white, 0, -0.45, 0, 20, { tile: 1.2 });
  for (const yy of [-0.95, 0.83]) wb.cyl('gold', 0.8, 0.8, 0.14, C.gold, 0, yy, 0, 20);
  wb.cyl('gold', 0.05, 0.05, 2.6, C.gold, 0, -1.3, 0, 6);
  const wheel = wb.build('prayer-wheel');
  const c = ctx.b.world(0, 1.45, 0);
  wheel.position.copy(c);
  ctx.extra.add(wheel);
  ctx.anim.push({ update: (_t, dt) => { wheel.rotation.y += dt * 0.9; } });
  ctx.icons.push({ name: '转经亭', x: p.x, z: p.z, kind: 'wheelHouse' });
}

/** 拉则：石堆上插一束经箭，八根经幡杆围成一圈，几十条经幡从箭束顶上放射出去 */
function lhatse(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 2, 2, 0.15), b = ctx.b;
  frame(ctx, h);
  b.lathe('stone', [[0, 0], [2.2, 0], [2.1, 0.8], [1.7, 1.7], [1.2, 2.3], [0, 2.4]], C.stoneDark, 0, 0, 0, 14);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    b.rock('plain', 0.35 + (k % 3) * 0.12, C.rock, Math.cos(a) * 2.3, 0, Math.sin(a) * 2.3, 0.7, k);
  }
  let seed = 11;
  const r = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 16; k++) {
    const a = r() * Math.PI * 2, rr = r() * 0.6;
    const base = new THREE.Vector3(Math.cos(a) * rr, 2.1, Math.sin(a) * rr);
    const tip = new THREE.Vector3(Math.cos(a) * (0.7 + r()), 7.5 + r() * 2.5, Math.sin(a) * (0.7 + r()));
    b.rod('wood', base, tip, 0.06 + r() * 0.04, k % 3 === 0 ? C.red : k % 3 === 1 ? '#f4efe4' : C.woodPale, 5);
    if (k % 4 === 0) {
      const w = b.world(tip.x, tip.y - 2.2, tip.z);
      ctx.flags.addBanner(w, 1.8, 0.6, r() * 6, FLAG_COLORS[k % 5]);
    }
  }
  // 白色哈达缠在箭束中段
  b.cyl('plain', 0.95, 1.1, 0.5, '#f7f5ee', 0, 3.4, 0, 12);
  const top = b.world(0, 8.4, 0);
  ctx.conductors?.push(b.world(0, 10, 0));
  boxC(ctx, h, 0, 0, 1.6, 1.6, -0.2, 9, false);
  // 一圈经幡杆，避开道路
  const spots: { w: THREE.Vector3; banner: boolean }[] = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.2;
    const w = b.world(Math.cos(a) * 19, 0, Math.sin(a) * 19);
    // 避开道路，也不挡垭口望贡嘎的视线
    if (ctx.terrain.roadNearest(w.x, w.z).d < 5.5) continue;
    spots.push({ w, banner: k % 2 === 0 });
  }
  const poles = spots.map(s => flagPole(ctx, s.w.x, s.w.z, 6, s.banner));
  frame(ctx, h);
  for (const q of poles) ctx.flags.addLine(top, q, { sag: 0.03 });
  for (let i = 0; i < poles.length; i++) {
    const a = poles[i], c = poles[(i + 1) % poles.length];
    if (a.distanceTo(c) < 25) ctx.flags.addLine(a.clone().setY(a.y - 0.4), c.clone().setY(c.y - 0.4), { sag: 0.07 });
  }
  // 拉到地面木桩的低经幡（不跨过道路）
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const w = b.world(Math.cos(a) * 13, 0, Math.sin(a) * 13);
    if (ctx.terrain.roadNearest(w.x, w.z).d < 5) continue;
    const g = ctx.terrain.heightAt(w.x, w.z);
    ctx.b.clearFrame();
    ctx.b.cyl('wood', 0.05, 0.06, 1.0, C.woodPale, w.x, g - 0.1, w.z, 5);
    frame(ctx, h);
    ctx.flags.addLine(b.world(0, 7.6, 0), new THREE.Vector3(w.x, g + 0.85, w.z), { sag: 0.02 });
  }
  ctx.icons.push({ name: '拉则', x: p.x, z: p.z, kind: 'lhatse' });
}

/** 玛尼堆：彩色刻石堆成的尖堆，顶上牦牛头骨，插一根小经幡杆 */
function maniPile(ctx: BuildCtx, p: Placement): void {
  const s = p.scale ?? 1;
  const h = ground(ctx, p, 1.4 * s, 1.4 * s, 0.15), b = ctx.b;
  frame(ctx, h);
  b.lathe('mani', [[0, 0], [1.45 * s, 0], [1.25 * s, 0.5 * s], [0.8 * s, 1.15 * s], [0.3 * s, 1.6 * s], [0, 1.7 * s]], C.white, 0, 0, 0, 10, { tile: 1.0 });
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    b.box('mani', 0.42 * s, 0.38 * s, 0.1, C.white, Math.cos(a) * 1.25 * s, 0, Math.sin(a) * 1.25 * s, -a + Math.PI / 2, { tile: 0.8 }, -0.25);
    if (k % 2 === 0) b.rock('plain', 0.28 * s, C.rock, Math.cos(a + 0.3) * 1.5 * s, 0, Math.sin(a + 0.3) * 1.5 * s, 0.6, k + p.x);
  }
  // 牦牛头骨
  const sy = 1.62 * s;
  b.box('plain', 0.34, 0.26, 0.5, C.bone, 0, sy, 0.05);
  b.box('plain', 0.26, 0.2, 0.22, C.bone, 0, sy - 0.04, 0.35);
  b.rod('plain', new THREE.Vector3(0.12, sy + 0.2, -0.05), new THREE.Vector3(0.48, sy + 0.38, -0.12), 0.06, C.horn);
  b.rod('plain', new THREE.Vector3(0.48, sy + 0.38, -0.12), new THREE.Vector3(0.42, sy + 0.68, -0.05), 0.045, C.horn);
  b.rod('plain', new THREE.Vector3(-0.12, sy + 0.2, -0.05), new THREE.Vector3(-0.48, sy + 0.38, -0.12), 0.06, C.horn);
  b.rod('plain', new THREE.Vector3(-0.48, sy + 0.38, -0.12), new THREE.Vector3(-0.42, sy + 0.68, -0.05), 0.045, C.horn);
  b.cyl('wood', 0.04, 0.05, 2.6 * s + 0.6, C.woodPale, 0.4 * s, sy * 0.6, -0.3 * s, 5);
  ctx.flags.addBanner(b.world(0.4 * s, sy * 0.6 + 1.6 * s, -0.3 * s), 1.4 * s, 0.45, 1.2, FLAG_COLORS[((Math.round(p.x) % 5) + 5) % 5]);
  cylC(ctx, h, 0, 0, 1.4 * s, -0.2, 1.7 * s);
  ctx.icons.push({ name: '玛尼堆', x: p.x, z: p.z, kind: 'maniPile' });
}

/** 煨桑炉：白色宝瓶形炉子，冒白色桑烟（垭口那座是导航用的大烟柱） */
function sangBurner(ctx: BuildCtx, p: Placement): void {
  const s = p.big ? 1.45 : 1;
  const h = ground(ctx, p, 1.1 * s, 1.1 * s, 0.1), b = ctx.b;
  frame(ctx, h);
  b.box('stone', 2.4 * s, 0.4 * s, 2.4 * s, C.stoneDark, 0, -0.1, 0);
  b.lathe('whitewash', [[0, 0], [0.95 * s, 0], [1.05 * s, 0.6 * s], [0.95 * s, 1.1 * s], [0.55 * s, 1.45 * s], [0.42 * s, 1.75 * s], [0.5 * s, 1.85 * s], [0, 1.85 * s]], C.white, 0, 0.3 * s, 0, 16);
  b.cyl('plain', 1.07 * s, 1.07 * s, 0.14 * s, C.ochre, 0, 0.8 * s, 0, 16);
  part(b, 'plain', new THREE.BoxGeometry(0.5 * s, 0.45 * s, 0.1), '#2a1a10', mat4(0, 0.55 * s, 0.98 * s));
  part(b, 'plain', new THREE.BoxGeometry(0.36 * s, 0.25 * s, 0.11), '#ff9a3a', mat4(0, 0.6 * s, 0.99 * s));
  const top = b.world(0, 2.2 * s, 0);
  ctx.smoke.push({ x: top.x, y: top.y, z: top.z, big: !!p.big });
  cylC(ctx, h, 0, 0, 1.15 * s, -0.2, 2.1 * s);
  ctx.icons.push({ name: p.big ? '煨桑炉（桑烟）' : '煨桑炉', x: p.x, z: p.z, kind: 'sangBurner' });
}

/** 牦牛毛黑帐篷：8 × 6.8 m，屋脊 2.6 m，四周拉绳 */
function blackTent(ctx: BuildCtx, p: Placement): void {
  const s = p.scale ?? 1;
  const L = 8 * s, D = 3.4 * s, H = 2.6 * s;
  const h = ground(ctx, p, L / 2, D, 0.1), b = ctx.b;
  frame(ctx, h);
  const shape = new THREE.Shape();
  shape.moveTo(-D, -0.2); shape.lineTo(-D * 0.88, 1.3 * s); shape.lineTo(-0.3, H); shape.lineTo(0.3, H);
  shape.lineTo(D * 0.88, 1.3 * s); shape.lineTo(D, -0.2); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false });
  g.applyMatrix4(mat4(-L / 2, 0, 0, Math.PI / 2));
  b.add('weave', g, C.white, undefined, { tile: 2.6 });
  // 门帘与屋脊烟缝
  part(b, 'plain', new THREE.BoxGeometry(1.4 * s, 1.6 * s, 0.08), '#0f0d0c', mat4(0.8 * s, 0.8 * s, D * 0.925 + 0.05, 0, -0.3));
  b.box('plain', L * 0.6, 0.06, 0.5, '#0b0a09', 0, H + 0.01, 0);
  // 撑杆与拉绳
  for (const sx of [-1, 1]) b.cyl('wood', 0.05, 0.06, H + 0.6, C.woodPale, sx * (L / 2 - 0.4), 0, 0, 5);
  for (const sx of [-1, -0.33, 0.33, 1]) for (const sz of [-1, 1]) {
    const a = new THREE.Vector3(sx * (L / 2 - 0.2), 1.3 * s, sz * D * 0.88);
    const c = new THREE.Vector3(sx * (L / 2 + 0.9), 0, sz * (D + 2.4));
    b.rod('plain', a, c, 0.025, C.rope, 4);
    b.cyl('wood', 0.04, 0.05, 0.4, C.woodPale, c.x, -0.1, c.z, 4);
  }
  boxC(ctx, h, 0, 0, L / 2, D, -0.2, H, false);
  ctx.icons.push({ name: '黑帐篷', x: p.x, z: p.z, kind: 'blackTent' });
}

/** 白帐篷：白布墙 + 蓝色吉祥纹边 + 人字顶 */
function whiteTent(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 2.6, 2.1, 0.05), b = ctx.b;
  frame(ctx, h);
  b.box('tentWhite', 5, 1.7, 4, C.white, 0, -0.1, 0, 0, { tile: 1.9 });
  const shape = new THREE.Shape();
  shape.moveTo(-2.25, 0); shape.lineTo(0, 1.5); shape.lineTo(2.25, 0); shape.closePath();
  const roof = new THREE.ExtrudeGeometry(shape, { depth: 5.3, bevelEnabled: false });
  roof.applyMatrix4(mat4(-2.65, 1.6, 0, Math.PI / 2));
  b.add('plain', roof, '#f3f0e8');
  b.box('plain', 5.4, 0.1, 0.12, C.blue, 0, 3.08, 0);
  part(b, 'plain', new THREE.BoxGeometry(1.2, 1.5, 0.06), C.blue, mat4(0, 0.65, 2.02));
  part(b, 'plain', new THREE.BoxGeometry(0.5, 0.5, 0.07), '#f3f0e8', mat4(0, 0.9, 2.03));
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    b.rod('plain', new THREE.Vector3(sx * 2.5, 1.55, sz * 2), new THREE.Vector3(sx * 3.6, 0, sz * 3.2), 0.025, C.rope, 4);
  ctx.flags.addLine(b.world(-2.6, 3.0, 0), b.world(2.6, 3.0, 0), { sag: 0.0, spacing: 0.6 });
  boxC(ctx, h, 0, 0, 2.5, 2, -0.1, 3.1, false);
  ctx.icons.push({ name: '白帐篷', x: p.x, z: p.z, kind: 'whiteTent' });
}

/** 牦牛：身体、驼峰、长毛裙、短腿；头低下吃草再抬起，尾巴甩 */
function yak(ctx: BuildCtx, p: Placement): void {
  const seed = p.seed ?? 1;
  const h = ground(ctx, p, 0.6, 1.2, 0.05);
  const coat = ['#2a2420', '#1f1b19', '#4e3626', '#2a2420', '#3a2c22'][seed % 5];
  const face = seed % 3 === 0 ? '#ece6da' : coat;
  const root = new THREE.Group();
  root.position.set(h.x, h.y, h.z);
  root.rotation.y = h.yaw;
  const body = new GeoBuilder();
  body.add('plain', new THREE.SphereGeometry(1, 14, 10), coat, mat4(0, 1.05, -0.05, 0, 0, 0, 0.62, 0.55, 1.12));
  body.add('plain', new THREE.SphereGeometry(1, 12, 8), coat, mat4(0, 1.32, 0.45, 0, 0, 0, 0.5, 0.42, 0.6));
  body.add('plain', new THREE.CylinderGeometry(0.62, 0.78, 0.62, 14, 1, true), '#171412', mat4(0, 0.62, -0.05, 0, 0, 0, 1, 1, 1.55));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
    body.cyl('plain', 0.09, 0.11, 0.6, '#1a1614', sx * 0.3, 0, sz * 0.62, 6);
  root.add(body.build('yak-body'));
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.2, 0.95);
  const head = new GeoBuilder();
  head.add('plain', new THREE.SphereGeometry(1, 12, 8), face, mat4(0, -0.12, 0.3, 0, 0, 0, 0.27, 0.3, 0.42));
  head.add('plain', new THREE.SphereGeometry(1, 10, 6), '#3b302a', mat4(0, -0.24, 0.62, 0, 0, 0, 0.18, 0.15, 0.16));
  for (const sx of [1, -1]) {
    head.rod('plain', new THREE.Vector3(sx * 0.18, 0.05, 0.2), new THREE.Vector3(sx * 0.48, 0.18, 0.15), 0.05, '#d9d0bd', 5);
    head.rod('plain', new THREE.Vector3(sx * 0.48, 0.18, 0.15), new THREE.Vector3(sx * 0.42, 0.45, 0.22), 0.035, '#d9d0bd', 5);
  }
  headPivot.add(head.build('yak-head'));
  root.add(headPivot);
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 1.15, -1.18);
  const tail = new GeoBuilder();
  tail.rod('plain', new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.6, -0.15), 0.04, coat, 4);
  tail.add('plain', new THREE.SphereGeometry(0.13, 8, 6), '#171412', mat4(0, -0.68, -0.17, 0, 0, 0, 1, 1.6, 1));
  tailPivot.add(tail.build('yak-tail'));
  root.add(tailPivot);
  ctx.extra.add(root);
  const phase = seed * 2.3;
  ctx.anim.push({
    update: (t) => {
      // 吃草：大部分时间低头，偶尔抬头张望
      const cycle = (t * 0.12 + phase) % 1;
      const down = cycle < 0.72 ? 1 : 1 - Math.sin(((cycle - 0.72) / 0.28) * Math.PI);
      headPivot.rotation.x = 0.15 + down * 0.65 + Math.sin(t * 3 + phase) * 0.04 * down;
      headPivot.rotation.y = (1 - down) * Math.sin(t * 0.8 + phase) * 0.5;
      tailPivot.rotation.z = Math.sin(t * 2.4 + phase) * 0.35;
    },
  });
  ctx.b.setFrame(h.x, h.y, h.z, h.yaw);
  boxC(ctx, h, 0, 0, 0.55, 1.2, 0, 1.6, false);
}

/** 青稞架：木柱 + 一排排横杆，挂着青稞草 */
function barleyRack(ctx: BuildCtx, p: Placement): void {
  const L = p.len ?? 6;
  const h = ground(ctx, p, L / 2, 0.4, 0.15), b = ctx.b;
  frame(ctx, h);
  const posts = Math.max(3, Math.round(L / 2) + 1);
  for (let k = 0; k < posts; k++) b.cyl('wood', 0.1, 0.13, 5.3, C.woodPale, -L / 2 + (L * k) / (posts - 1), -0.2, 0, 6);
  let seed = Math.round(p.x * 13 + p.z);
  const r = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0.8; y < 4.9; y += 0.55) {
    b.box('wood', L + 0.3, 0.07, 0.08, '#c9a27b', 0, y, 0);
    for (let x = -L / 2 + 0.3; x < L / 2 - 0.2; x += 0.5) {
      if (r() < 0.55) b.box('plain', 0.42, 0.5, 0.32, r() < 0.5 ? C.straw : '#c9a44c', x, y - 0.45, 0, 0, { jitter: 0.12 });
    }
  }
  b.box('wood', L + 0.8, 0.12, 0.8, C.wood, 0, 5.1, 0);
  boxC(ctx, h, 0, 0, L / 2, 0.3, -0.2, 5.2, false);
  ctx.icons.push({ name: '青稞架', x: p.x, z: p.z, kind: 'barleyRack' });
}

/** 废弃道班：白墙、红腰带、铁皮顶、蓝底道班牌 */
function daoban(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 5, 3, 0.05), b = ctx.b;
  frame(ctx, h);
  b.box('stone', 10, 1.4, 6, C.stoneDark, 0, -0.5, 0);
  b.box('whitewash', 10, 2.4, 6, C.white, 0, 0.9, 0);
  b.box('plain', 10.08, 0.4, 6.08, '#a63a2b', 0, 2.75, 0);
  const roof = new THREE.BoxGeometry(10.8, 0.14, 7.0);
  b.add('plain', roof, C.tin, mat4(0, 3.3, 0, 0, -0.1));
  for (let x = -5.2; x <= 5.2; x += 0.45) b.box('plain', 0.05, 0.05, 7.0, '#4f6a84', x, 3.32, 0, 0, undefined, -0.1);
  b.box('stone', 0.7, 1.4, 0.7, C.stoneDark, 3.2, 3.0, -1.5);
  part(b, 'plain', new THREE.BoxGeometry(1.2, 2.1, 0.08), '#3a6fb5', mat4(-1.5, 1.05, 3.02));
  for (const x of [1.5, 3.6, -3.8]) {
    part(b, 'plain', new THREE.BoxGeometry(1.2, 1.0, 0.08), '#3a6fb5', mat4(x, 1.2, 3.02));
    part(b, 'plain', new THREE.BoxGeometry(1.0, 0.8, 0.09), '#1c2630', mat4(x, 1.3, 3.03));
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.9), patchMaterial(new THREE.MeshLambertMaterial({
    map: textTexture(['道 班', '天路养护站'], { bg: '#2c5aa8', fg: '#ffffff', w: 512, h: 180, font: 70 }),
  }), { rim: 0 }));
  sign.position.copy(b.world(-1.5, 2.55, 3.07));
  sign.rotation.y = h.yaw;
  ctx.extra.add(sign);
  boxC(ctx, h, 0, 0, 5, 3, -0.5, 3.4, false);
  ctx.icons.push({ name: '道班', x: p.x, z: p.z, kind: 'daoban' });
}

function drums(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 1.4, 1.4, 0.02), b = ctx.b;
  frame(ctx, h);
  const list: [number, number, string][] = [[0, 0, C.drumOrange], [0.7, 0.2, C.drumBlue], [0.25, 0.75, C.drumOrange]];
  for (const [x, z, c] of list) {
    b.cyl('plain', 0.3, 0.3, 0.92, c, x, 0, z, 12);
    for (const y of [0.25, 0.65]) b.cyl('plain', 0.31, 0.31, 0.05, '#2c2a28', x, y, z, 12);
    cylC(ctx, h, x, z, 0.32, 0, 0.92, true);
  }
  b.add('plain', new THREE.CylinderGeometry(0.3, 0.3, 0.92, 12), C.drumBlue, mat4(-0.9, 0.3, 0.4, 0.6, 0, Math.PI / 2));
  cylC(ctx, h, -0.9, 0.4, 0.45, 0, 0.6, true);
}

function gravel(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 2.5, 2.5, 0.1), b = ctx.b;
  frame(ctx, h);
  b.lathe('plain', [[0, 0], [2.6, 0], [1.6, 0.6], [0.5, 1.1], [0, 1.15]], C.gravel, 0, 0, 0, 9);
  for (let k = 0; k < 6; k++) b.rock('plain', 0.25, '#8d867b', Math.cos(k) * 2.4, 0, Math.sin(k * 1.3) * 2.2, 0.7, k);
  cylC(ctx, h, 0, 0, 2.2, 0, 1.1, true);
}

function milestone(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 0.3, 0.2, 0.1), b = ctx.b;
  frame(ctx, h);
  b.box('plain', 0.55, 0.95, 0.28, '#f0ede6', 0, 0, 0);
  b.box('plain', 0.57, 0.3, 0.3, '#b8322b', 0, 0.95, 0);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42), patchMaterial(new THREE.MeshLambertMaterial({
    map: textTexture(['天路', 'K0'], { bg: '#f0ede6', fg: '#b8322b', w: 256, h: 220, font: 80 }),
  }), { rim: 0 }));
  sign.position.copy(b.world(0, 0.6, 0.145));
  sign.rotation.y = h.yaw;
  ctx.extra.add(sign);
  boxC(ctx, h, 0, 0, 0.3, 0.16, 0, 1.25, false);
}

function fieldWall(ctx: BuildCtx, p: Placement): void {
  const L = p.len ?? 8;
  const h = ground(ctx, p, L / 2, 0.45, 0.2), b = ctx.b;
  frame(ctx, h);
  b.box('stone', L, 1.35, 0.85, C.stoneDark, 0, -0.2, 0, 0, { tile: 1.8 });
  for (let x = -L / 2 + 0.4; x < L / 2; x += 0.7) b.rock('plain', 0.24, C.rock, x, 1.08, (x * 7) % 0.3 - 0.15, 0.6, x);
  boxC(ctx, h, 0, 0, L / 2, 0.45, -0.2, 1.2, true);
}

function dungWall(ctx: BuildCtx, p: Placement): void {
  const L = p.len ?? 8;
  const h = ground(ctx, p, L / 2, 0.35, 0.15), b = ctx.b;
  frame(ctx, h);
  b.box('dung', L, 1.35, 0.65, C.white, 0, -0.15, 0, 0, { tile: 1.2 });
  for (let x = -L / 2 + 0.3; x < L / 2; x += 0.55) b.cyl('plain', 0.24, 0.26, 0.09, '#6b5038', x, 1.2, 0, 8, undefined, 0, 0, 0.15);
  boxC(ctx, h, 0, 0, L / 2, 0.35, -0.15, 1.2, true);
}

function fence(ctx: BuildCtx, p: Placement): void {
  const L = p.len ?? 10;
  const yaw = yawOf(p), b = ctx.b;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  b.clearFrame();
  const posts: THREE.Vector3[] = [];
  for (let d = -L / 2; d <= L / 2 + 0.01; d += 1.75) {
    const x = p.x + d * c, z = p.z - d * s;
    const y = ctx.terrain.heightAt(x, z);
    b.cyl('wood', 0.06, 0.07, 1.35, C.woodPale, x, y - 0.15, z, 5);
    posts.push(new THREE.Vector3(x, y, z));
  }
  for (let i = 0; i < posts.length - 1; i++) for (const yy of [0.45, 0.95]) {
    b.rod('wood', posts[i].clone().setY(posts[i].y + yy), posts[i + 1].clone().setY(posts[i + 1].y + yy), 0.035, '#c9a27b', 4);
  }
  const h = { x: p.x, z: p.z, yaw, y: ctx.terrain.heightAt(p.x, p.z) };
  b.setFrame(h.x, h.y, h.z, h.yaw);
  boxC(ctx, h, 0, 0, L / 2, 0.12, -2, 1.1, false);
}

function boulder(ctx: BuildCtx, p: Placement): void {
  const s = p.scale ?? 2;
  const sq = 0.72, r = s / (sq * 1.75);
  const y = ctx.terrain.heightAt(p.x, p.z);
  ctx.b.clearFrame();
  ctx.b.rock('plain', r, C.rock, p.x, y, p.z, sq, Math.round(p.x * 3 + p.z), 1);
  ctx.b.rock('plain', r * 0.35, '#7d786f', p.x + r * 0.9, y, p.z + r * 0.4, 0.6, Math.round(p.z));
  ctx.world.add({ kind: 'cyl', x: p.x, z: p.z, r: r * 0.82, y0: y - 1, y1: y + s - 0.1, walkable: true });
}

/** 达觉：土丘上一簇高杆竖幡 */
function darchor(ctx: BuildCtx, p: Placement): void {
  const y = ctx.terrain.heightAt(p.x, p.z);
  ctx.b.clearFrame();
  const spots: [number, number, number][] = [[0, 0, 9], [1.6, 0.8, 7.5], [-1.4, 1.2, 8], [0.6, -1.6, 7], [-1.2, -1.0, 6.5]];
  spots.forEach(([dx, dz, H], i) => {
    const x = p.x + dx, z = p.z + dz;
    ctx.b.cyl('wood', 0.06, 0.1, H, C.woodPale, x, y - 0.2, z, 6);
    ctx.b.add('gold', new THREE.SphereGeometry(0.12, 8, 6), C.gold, mat4(x, y + H - 0.1, z));
    ctx.flags.addBanner(new THREE.Vector3(x, y + H * 0.35, z), H * 0.55, 0.75, 0.3 + i * 0.2, FLAG_COLORS[i % 5]);
    ctx.conductors?.push(new THREE.Vector3(x, y + H, z));
    ctx.world.add({ kind: 'cyl', x, z, r: 0.15, y0: y, y1: y + H, walkable: false });
  });
  ctx.b.rock('plain', 1.1, C.rock, p.x, y - 0.3, p.z, 0.5, 4);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const ex = p.x + Math.cos(a) * 10, ez = p.z + Math.sin(a) * 10;
    const g = ctx.terrain.heightAt(ex, ez);
    if (ctx.terrain.roadNearest(ex, ez).d < 4.5) continue;
    ctx.b.cyl('wood', 0.05, 0.06, 1.0, C.woodPale, ex, g - 0.1, ez, 5);
    ctx.flags.addLine(new THREE.Vector3(p.x, y + 8.4, p.z), new THREE.Vector3(ex, g + 0.85, ez), { sag: 0.02 });
  }
  ctx.icons.push({ name: '达觉经幡', x: p.x, z: p.z, kind: 'darchor' });
}

/** 避风石屋：5 × 4 × 2.4 m，平顶可上（旁边的石头当台阶） */
function shelter(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 2.6, 2.1, 0.1), b = ctx.b;
  frame(ctx, h);
  b.box('stone', 5, 2.5, 4, C.stoneDark, 0, -0.2, 0, 0, { tile: 1.8 });
  b.box('wood', 5.3, 0.2, 4.3, C.wood, 0, 2.3, 0);
  b.box('plain', 5.1, 0.25, 4.1, C.ochre, 0, 2.05, 0);
  tibetWindow(b, mat4(0.8, 0, 2.01, 0), 0.9, 1.7, true);
  tibetWindow(b, mat4(-1.4, 1.0, 2.01, 0), 0.5, 0.5);
  ctx.flags.addLine(b.world(2.4, 2.6, 2.0), b.world(-2.4, 2.6, -2.0), { sag: 0.12 });
  boxC(ctx, h, 0, 0, 2.6, 2.1, -0.2, 2.5, true);
  ctx.icons.push({ name: '避风屋', x: p.x, z: p.z, kind: 'shelter' });
}

/** 垭口碑 */
function stele(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 1.4, 0.6, 0.2), b = ctx.b;
  frame(ctx, h);
  b.box('stone', 2.8, 0.6, 1.2, C.stoneDark, 0, -0.2, 0);
  b.box('plain', 2.2, 3.4, 0.5, '#d9d4ca', 0, 0.4, 0, 0, { jitter: 0.02 });
  b.box('plain', 2.4, 0.25, 0.6, '#b3aa9c', 0, 3.8, 0);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 3.0), patchMaterial(new THREE.MeshLambertMaterial({
    map: textTexture(['折多山', '垭口 海拔 4298 米'], { bg: '#e6e1d6', fg: '#b3261e', w: 300, h: 480, font: 96 }),
  }), { rim: 0 }));
  sign.position.copy(b.world(0, 2.1, 0.26));
  sign.rotation.y = h.yaw;
  ctx.extra.add(sign);
  ctx.flags.addLine(b.world(-1.1, 4.0, 0), b.world(-6, 0.9, 3), { sag: 0.04 });
  boxC(ctx, h, 0, 0, 1.4, 0.6, -0.2, 4, false);
  ctx.icons.push({ name: '垭口碑', x: p.x, z: p.z, kind: 'stele' });
}

/** 出口：两根经幡杆 + 横拉的经幡 + 发光的门环 */
function flagGate(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 3.5, 1, 0.1), b = ctx.b;
  frame(ctx, h);
  const A = b.world(-3.4, 0, 0), B = b.world(3.4, 0, 0);
  const ta = flagPole(ctx, A.x, A.z, 7.5, true), tb = flagPole(ctx, B.x, B.z, 7.5, true);
  frame(ctx, h);
  for (const dy of [0, -0.7, -1.4]) ctx.flags.addLine(ta.clone().setY(ta.y + dy), tb.clone().setY(tb.y + dy), { sag: 0.05 });
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.1, 0.12, 10, 48),
    new THREE.MeshBasicMaterial({ color: '#ffd77a', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 40),
    new THREE.MeshBasicMaterial({ color: '#9fe3ff', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  const gate = new THREE.Group();
  gate.add(ring, disc);
  gate.position.copy(b.world(0, 2.5, 0));
  gate.rotation.y = h.yaw;
  ctx.extra.add(gate);
  const ringMat = ring.material as THREE.MeshBasicMaterial, discMat = disc.material as THREE.MeshBasicMaterial;
  ctx.anim.push({
    update: (t) => {
      // 灵火不够时门环是暗的、不转；点够了亮起来并开始转
      const open = FIRE_STATE.lit >= FIRES_TO_UNLOCK;
      ring.rotation.z = open ? t * 0.6 : 0;
      ringMat.color.set(open ? '#ffd77a' : '#5d6f80');
      ringMat.opacity = open ? 0.9 : 0.45;
      disc.visible = open;
      discMat.opacity = 0.16 + 0.08 * Math.sin(t * 2.2);
    },
  });
  ctx.icons.push({ name: '出口', x: p.x, z: p.z, kind: 'flagGate' });
}

let altarIndex = 0;

/** 残碉：只剩 11–14 m，顶部四面墙断在不同高度，墙脚一堆塌下来的片石 */
function diaolouRuin(ctx: BuildCtx, p: Placement): void {
  const s = p.scale ?? 1;
  const h = ground(ctx, p, 3 * s, 3 * s, 0.3), b = ctx.b;
  frame(ctx, h);
  const B = 6 * s, H = 11 * s, T = 5.2 * s;
  const body = new THREE.CylinderGeometry(T / Math.SQRT2, (B + 0.2) / Math.SQRT2, H + 1.5, 4, 1);
  body.rotateY(Math.PI / 4); body.translate(0, (H + 1.5) / 2 - 1.5, 0);
  b.add('stone', body, C.stone, undefined, { tile: 2.2 });
  for (let y = 2.6; y < H - 1; y += 2.9) { const w = B + (T - B) * (y / H) + 0.1; b.box('wood', w, 0.14, w, '#c9a585', 0, y, 0); }
  const wt = 0.8 * s, half = T / 2;
  const tops = [4.5, 1.6, 3.2, 0.8].map(v => v * s);
  const walls: [number, number, number, number][] = [[0, half - wt / 2, T, wt], [half - wt / 2, 0, wt, T], [0, -half + wt / 2, T, wt], [-half + wt / 2, 0, wt, T]];
  walls.forEach(([x, z, w, d], i) => {
    for (let k = 0; k < 3; k++) {
      const f = (k + 0.5) / 3 - 0.5;
      const tall = tops[i] * (1 - Math.abs(f) * (i % 2 ? 0.8 : 0.4)) + (k === 1 ? 0.6 * s : 0);
      if (w > d) b.box('stone', w / 3, tall, d, C.stone, x + f * w, H, z, 0, { tile: 2.2 });
      else b.box('stone', w, tall, d / 3, C.stone, x, H, z + f * d, 0, { tile: 2.2 });
    }
  });
  for (let k = 0; k < 10; k++) {
    const a = k * 0.9 + 0.4, r = B * 0.7 + (k % 3) * 0.8;
    b.rock('plain', (0.5 + (k % 3) * 0.3) * s, '#8f877a', Math.cos(a) * r, 0, Math.sin(a) * r, 0.5, k + Math.round(p.x));
  }
  for (const face of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const y of [5.5 * s, 9 * s]) {
    const hf = (B + (T - B) * (y / H)) / 2 + 0.02;
    part(b, 'plain', new THREE.BoxGeometry(0.34, 0.9, 0.06), '#151311', mat4(Math.sin(face) * hf, y, Math.cos(face) * hf, face));
  }
  boxC(ctx, h, 0, 0, B / 2, B / 2, -2, H + 3 * s, false);
  ctx.icons.push({ name: '残碉', x: p.x, z: p.z, kind: 'diaolouRuin' });
}

/** 湖心小白塔：小台基 + 小塔，经幡拉到岛边的木桩 */
function stupa(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 1.7, 1.7, 0.2), b = ctx.b;
  frame(ctx, h);
  b.box('stone', 3.4, 0.5, 3.4, C.stoneDark, 0, -0.2, 0);
  miniChorten(b, 0, 0.3, 0, 2.2);
  const top = b.world(0, 0.3 + 1.65 * 2.2 + 1.2, 0);
  const stakes = [0.6, 2.7, 4.8].map(a => b.world(Math.cos(a) * 5.5, 0, Math.sin(a) * 5.5));
  for (const w of stakes) {
    const g = ctx.terrain.heightAt(w.x, w.z);
    ctx.b.clearFrame();
    ctx.b.cyl('wood', 0.04, 0.05, 1.2, C.woodPale, w.x, g - 0.1, w.z, 5);
    ctx.flags.addLine(top, new THREE.Vector3(w.x, g + 1.0, w.z), { sag: 0.02 });
  }
  frame(ctx, h);
  cylC(ctx, h, 0, 0, 1.4, -0.2, 5);
  ctx.icons.push({ name: '湖心白塔', x: p.x, z: p.z, kind: 'stupa' });
}

/** 塔林：一排小白塔立在长台基上，塔顶之间连经幡 */
function chortenRow(ctx: BuildCtx, p: Placement): void {
  const n = p.count ?? 7, L = p.len ?? 18;
  const h = ground(ctx, p, L / 2 + 1, 1.2, 0.15), b = ctx.b;
  frame(ctx, h);
  b.box('stone', L + 2.2, 0.45, 2.2, C.stoneDark, 0, -0.2, 0);
  const tops: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (L * i) / (n - 1);
    miniChorten(b, x, 0.25, 0, 1.15);
    tops.push(b.world(x, 0.25 + 1.65 * 1.15 + 0.75, 0));
    cylC(ctx, h, x, 0, 0.7, 0.25, 2.9);
  }
  for (let i = 0; i < n - 1; i++) ctx.flags.addLine(tops[i], tops[i + 1], { sag: 0.12, size: 0.36, spacing: 0.44 });
  boxC(ctx, h, 0, 0, L / 2 + 1.1, 1.1, -0.2, 0.25, true);
  ctx.icons.push({ name: '塔林', x: p.x, z: p.z, kind: 'chortenRow' });
}

/** 水转经房：架在河上的小屋，正面敞开能看到转经筒，下面的水轮被水冲着转 */
function waterWheel(ctx: BuildCtx, p: Placement): void {
  const g = ctx.terrain.heightAt(p.x, p.z);
  const wl = ctx.terrain.waterLevelAt(p.x, p.z);
  const water = Number.isFinite(wl) ? wl : g;
  const floor = water + 0.9;
  const h: Here = { x: p.x, z: p.z, yaw: yawOf(p), y: floor };
  const b = ctx.b;
  frame(ctx, h);
  const legH = floor - g + 1.5;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.cyl('wood', 0.12, 0.14, legH, C.woodPale, sx * 1.4, -legH, sz * 1.4, 6);
  b.box('wood', 3.6, 0.2, 3.6, C.wood, 0, -0.2, 0);
  b.box('whitewash', 3.2, 2.2, 0.25, C.white, 0, 0, -1.5);
  b.box('whitewash', 0.25, 2.2, 3.2, C.white, -1.5, 0, 0);
  b.box('whitewash', 0.25, 2.2, 3.2, C.white, 1.5, 0, 0);
  b.box('plain', 3.5, 0.35, 3.5, C.ochre, 0, 2.2, 0);
  b.box('wood', 3.9, 0.18, 3.9, C.wood, 0, 2.55, 0);
  ctx.flags.addLine(b.world(-1.9, 2.7, 1.9), b.world(1.9, 2.7, -1.9), { sag: 0.1, size: 0.36, spacing: 0.44 });
  const wb = new GeoBuilder();
  wb.cyl('plain', 0.55, 0.55, 1.3, C.red, 0, -0.65, 0, 16);
  wb.cyl('mani', 0.57, 0.57, 0.6, C.white, 0, -0.3, 0, 16, { tile: 1 });
  for (const yy of [-0.7, 0.58]) wb.cyl('gold', 0.6, 0.6, 0.1, C.gold, 0, yy, 0, 16);
  wb.cyl('wood', 0.05, 0.05, 2.4, C.woodPale, 0, -2.4, 0, 6);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    wb.box('wood', 0.75, 0.45, 0.06, '#c9a27b', Math.cos(a) * 0.5, -2.3, Math.sin(a) * 0.5, -a);
  }
  const wheel = wb.build('water-prayer-wheel');
  wheel.position.copy(b.world(0, 1.1, 0));
  ctx.extra.add(wheel);
  ctx.anim.push({ update: (_t, dt) => { wheel.rotation.y += dt * 1.6; } });
  boxC(ctx, h, 0, 0, 1.8, 1.8, -0.4, 2.7, true);
  ctx.icons.push({ name: '水转经房', x: p.x, z: p.z, kind: 'waterWheel' });
}

/** 灵火坛：八角石座 + 铜盆。没点亮时只有暗红余烬；点亮后是青金色的灵火 */
function altar(ctx: BuildCtx, p: Placement): void {
  const index = altarIndex++;
  const h = ground(ctx, p, 1.4, 1.4, 0.15), b = ctx.b;
  frame(ctx, h);
  b.cyl('stone', 1.2, 1.35, 0.45, C.stoneDark, 0, -0.15, 0, 8);
  b.cyl('stone', 0.75, 0.92, 1.0, C.stone, 0, 0.3, 0, 8);
  b.cyl('gold', 0.95, 0.8, 0.12, C.gold, 0, 1.25, 0, 8);
  b.lathe('plain', [[0, 0], [0.4, 0], [0.75, 0.25], [0.82, 0.45], [0.72, 0.45], [0.35, 0.12], [0, 0.12]], '#4a3a26', 0, 1.35, 0, 12);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    b.box('stone', 0.35, 1.3, 0.35, C.stoneDark, Math.cos(a) * 2, -0.2, Math.sin(a) * 2);
    ctx.flags.addBanner(b.world(Math.cos(a) * 2, 1.1, Math.sin(a) * 2), 0.9, 0.35, a, FLAG_COLORS[k % 5]);
  }
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff6a2a' }));
  ember.scale.y = 0.35;
  ember.position.copy(b.world(0, 1.55, 0));
  const flame = new THREE.Group();
  ['#3fd2ff', '#9ff0ff', '#fff1bf'].forEach((col, k) => {
    const H = 2.2 - k * 0.5;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.5 - k * 0.13, H, 12, 1, true), new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    cone.position.y = H / 2;
    flame.add(cone);
  });
  flame.position.copy(b.world(0, 1.5, 0));
  ctx.extra.add(ember, flame);
  const emberMat = ember.material as THREE.MeshBasicMaterial;
  ctx.anim.push({
    update: (t) => {
      const lit = FIRE_STATE.mask ? !!FIRE_STATE.mask[index] : index < FIRE_STATE.lit;
      flame.visible = lit;
      emberMat.color.set(lit ? '#c9f6ff' : '#ff6a2a');
      ember.scale.set(1, lit ? 0.5 : 0.3 + 0.05 * Math.sin(t * 3 + index), 1);
      if (lit) flame.children.forEach((c, k) => {
        c.scale.set(1 + 0.1 * Math.sin(t * 9 + k), 1 + 0.18 * Math.sin(t * 6.5 + k * 2), 1 + 0.1 * Math.sin(t * 8 + k));
        c.rotation.y = t * (1 + k * 0.4);
      });
    },
  });
  cylC(ctx, h, 0, 0, 1.3, -0.2, 1.8);
  ctx.icons.push({ name: '灵火坛', x: p.x, z: p.z, kind: 'altar' });
}

/** 冰舌末端：一排高低不齐的冰块组成的冰崖（中间高两头低、微微内凹），顶上有冰塔，正面有蓝色裂隙 */
function glacierSnout(ctx: BuildCtx, p: Placement): void {
  const L = p.len ?? 60, yaw = yawOf(p);
  const y0 = ctx.terrain.heightAt(p.x + Math.sin(yaw) * 6, p.z + Math.cos(yaw) * 6) - 1.2;
  const h: Here = { x: p.x, z: p.z, yaw, y: y0 };
  const b = ctx.b;
  frame(ctx, h);
  let seed = 5;
  const r = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let x = -L / 2; x < L / 2; x += 3 + r() * 2) {
    const edge = 1 - Math.pow(Math.abs(x) / (L / 2), 3);
    const H = (9 + r() * 5) * (0.45 + 0.55 * edge);
    const D = 7 + r() * 5;
    const z = -0.006 * x * x;
    b.box('ice', 3.6 + r() * 1.6, H, D, r() < 0.3 ? '#bfe0ee' : '#e6f4fa', x, -0.5, z - D / 2 + 1, (r() - 0.5) * 0.25, undefined, (r() - 0.5) * 0.1, (r() - 0.5) * 0.1);
    if (r() < 0.65) b.box('ice', 1.4 + r() * 1.6, 2 + r() * 2.5, 1.6 + r(), '#f2f9fc', x + (r() - 0.5) * 2, H - 1, z - D * 0.35, r() * 3, undefined, (r() - 0.5) * 0.4, (r() - 0.5) * 0.4);
    if (r() < 0.5) b.box('plain', 0.18, H * 0.7, 0.1, '#4d8fb4', x + (r() - 0.5) * 2, 0.6, z + 1.05);
  }
  boxC(ctx, h, 0, -3, L / 2, 4.5, -1, 13, false);
  ctx.icons.push({ name: '冰舌', x: p.x, z: p.z, kind: 'glacierSnout' });
}

/** 冰湖里的浮冰 */
function iceBlock(ctx: BuildCtx, p: Placement): void {
  const s = p.scale ?? 1;
  const wl = ctx.terrain.waterLevelAt(p.x, p.z);
  const y = (Number.isFinite(wl) ? wl : ctx.terrain.heightAt(p.x, p.z)) - 0.45 * s;
  ctx.b.clearFrame();
  ctx.b.rock('ice', 1.0 * s, '#e3f2f8', p.x, y, p.z, 0.55, Math.round(p.x * 7 + p.z), 0);
}

/** 温泉：三个石圈泉池，冒热气，旁边拉一条经幡 */
function hotSpring(ctx: BuildCtx, p: Placement): void {
  const b = ctx.b;
  const pools: [number, number, number][] = [[0, 0, 2.6], [5.5, 3, 2.0], [-3.5, 5.5, 1.8]];
  for (const [dx, dz, r] of pools) {
    const x = p.x + dx, z = p.z + dz;
    const g = ctx.terrain.footprintMin(x, z, r, r, 0);
    b.clearFrame();
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      b.rock('plain', 0.42 + (k % 3) * 0.12, '#8a847a', x + Math.cos(a) * r, g - 0.15, z + Math.sin(a) * r, 0.55, k + dx * 3, 0);
    }
    const water = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 28), waterMaterial('#3aa6a8', '#9ad8cf', 0, true));
    water.rotation.x = -Math.PI / 2;
    water.position.set(x, g + 0.18, z);
    water.renderOrder = 2;
    ctx.extra.add(water);
    ctx.smoke.push({ x, y: g + 0.3, z, big: false, steam: true });
  }
  const a = flagPole(ctx, p.x - 5, p.z - 4, 3.2), c = flagPole(ctx, p.x + 8, p.z - 2, 3.2);
  ctx.flags.addLine(a, c, { sag: 0.08 });
  ctx.icons.push({ name: '温泉', x: p.x, z: p.z, kind: 'hotSpring' });
}

/** 修行洞：一块大岩体，洞口前砌白墙、开门窗，经幡从岩顶拉下来 */
function cave(ctx: BuildCtx, p: Placement): void {
  const h = ground(ctx, p, 7, 4, 0.5), b = ctx.b;
  frame(ctx, h);
  b.rock('plain', 6.5, '#7f7a72', 0, -1.5, -5.5, 0.95, 3, 1);
  b.rock('plain', 5, '#8a847b', -6.5, -1, -3.8, 0.9, 7, 1);
  b.rock('plain', 4.6, '#77736b', 6.5, -1, -4, 0.85, 11, 1);
  b.box('whitewash', 5.2, 3.3, 0.6, C.white, 0, -0.3, 0.4);
  b.box('plain', 5.4, 0.35, 0.7, C.ochre, 0, 2.65, 0.4);
  b.box('wood', 5.8, 0.15, 1.0, C.wood, 0, 3.0, 0.4);
  tibetWindow(b, mat4(-1.0, 0, 0.71, 0), 0.9, 1.8, true);
  tibetWindow(b, mat4(1.4, 1.2, 0.71, 0), 0.6, 0.6);
  const top = b.world(0, 9, -4);
  const stakes = [b.world(-6, 0, 6), b.world(6, 0, 6)];
  for (const w of stakes) {
    const end = flagPole(ctx, w.x, w.z, 2.6);
    ctx.flags.addLine(top, end, { sag: 0.05 });
  }
  frame(ctx, h);
  boxC(ctx, h, 0, -4, 9, 4.8, -1, 10, false);
  ctx.icons.push({ name: '修行洞', x: p.x, z: p.z, kind: 'cave' });
}

const BUILDERS: Partial<Record<LandmarkKind, (ctx: BuildCtx, p: Placement) => void>> = {
  diaolou, house, chorten, maniWall, wheelHouse, lhatse, maniPile, sangBurner, blackTent, whiteTent, yak,
  barleyRack, daoban, drums, gravel, milestone, fieldWall, dungWall, fence, boulder, darchor, shelter, stele, flagGate,
  diaolouRuin, stupa, chortenRow, waterWheel, altar, glacierSnout, iceBlock, hotSpring, cave,
};

// ───────────────────────────── 道路附属：木桥、挡土墙 ─────────────────────────────

function bridges(ctx: BuildCtx & { terrain: Terrain }): void {
  for (const br of ctx.terrain.bridges) bridge(ctx, br);
}

function bridge(ctx: BuildCtx, br: Terrain['bridges'][number]): void {
  const b = ctx.b;
  const h: Here = { x: br.x, z: br.z, yaw: br.yaw, y: br.deckY };
  frame(ctx, h);
  const L = br.len, W = br.width;
  b.box('wood', W, 0.3, L, C.wood, 0, -0.3, 0, 0, { tile: 1.4 });
  for (let z = -L / 2 + 0.3; z < L / 2; z += 0.55) b.box('wood', W + 0.1, 0.05, 0.42, '#d8b493', 0, -0.02, z);
  for (const sx of [-1, 1]) {
    for (let z = -L / 2 + 0.3; z <= L / 2; z += 1.6) b.box('wood', 0.16, 1.05, 0.16, C.woodPale, sx * (W / 2 - 0.1), 0, z);
    b.box('wood', 0.12, 0.12, L, '#c9a27b', sx * (W / 2 - 0.1), 1.0, 0);
    boxC(ctx, h, sx * (W / 2 - 0.1), 0, 0.12, L / 2, 0, 1.1, false);
    ctx.flags.addLine(b.world(sx * (W / 2 - 0.1), 1.05, -L / 2 + 0.3), b.world(sx * (W / 2 - 0.1), 1.05, L / 2 - 0.3), { sag: 0.03, size: 0.36, spacing: 0.42 });
  }
  // 桥墩
  for (const z of [-L / 2 + 0.6, L / 2 - 0.6]) b.box('stone', W + 0.6, 2.2, 1.0, C.stoneDark, 0, -2.4, z);
  boxC(ctx, h, 0, 0, W / 2 - 0.2, L / 2, -2.5, 0, true);
  ctx.icons.push({ name: br.road ? '桥' : '木桥', x: br.x, z: br.z, kind: 'bridge' });
}

function retainingWalls(ctx: BuildCtx & { terrain: Terrain }): void {
  const b = ctx.b;
  for (const w of ctx.terrain.walls) {
    const h: Here = { x: w.x, z: w.z, yaw: w.yaw, y: w.bottom };
    frame(ctx, h);
    b.box('stone', w.thick, w.top - w.bottom, w.len, w.kind === 'cut' ? '#e3ddd2' : C.stone, 0, 0, 0, 0, { tile: 1.9 });
    if (w.kind === 'cut') boxC(ctx, h, 0, 0, w.thick / 2, w.len / 2, 0, w.top - w.bottom, true);
    if (w.kind === 'fill') {
      b.box('stone', w.thick + 0.1, 0.12, w.len, '#d4ccbf', 0, w.top - w.bottom - 0.06, 0);
      boxC(ctx, h, 0, 0, w.thick / 2, w.len / 2, 0, w.top - w.bottom, true);
    }
  }
}

// ───────────────────────────── 入口 ─────────────────────────────

function place(ctx: BuildCtx, placements: readonly Placement[]): void {
  for (const p of placements) {
    const fn = BUILDERS[p.kind];
    if (fn) fn(ctx, p);
    ctx.b.clearFrame();
  }
}

function stringFlags(ctx: BuildCtx, lines: readonly FlagLine[]): void {
  for (const line of lines) {
    const ga = ctx.terrain.heightAt(line.a[0], line.a[1]), gb = ctx.terrain.heightAt(line.b[0], line.b[1]);
    if (line.poles) {
      flagPole(ctx, line.a[0], line.a[1], line.ha + 0.3);
      flagPole(ctx, line.b[0], line.b[1], line.hb + 0.3);
    }
    ctx.flags.addLine(new THREE.Vector3(line.a[0], ga + line.ha, line.a[1]), new THREE.Vector3(line.b[0], gb + line.hb, line.b[1]), { sag: line.sag ?? 0.06 });
  }
}

/** 4-1：spec 里的全部地标、天路的木桥与挡土墙、经幡绳 */
export function buildLandmarks(ctx: BuildCtx & { terrain: Terrain }): void {
  altarIndex = 0;
  place(ctx, PLACEMENTS);
  bridges(ctx);
  retainingWalls(ctx);
  ctx.b.clearFrame();
  stringFlags(ctx, FLAG_LINES);
  ctx.b.clearFrame();
}

/** 别的图（4-2）复用这套地标：按给定的摆放表和经幡绳搭，灵火坛按摆放顺序编号 */
export function buildPlacements(ctx: BuildCtx, placements: readonly Placement[], lines: readonly FlagLine[] = []): void {
  altarIndex = 0;
  place(ctx, placements);
  stringFlags(ctx, lines);
  ctx.b.clearFrame();
}

export { materials };
