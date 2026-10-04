/**
 * 装饰道具（Deco）的低多边形模型：全部在局部坐标系中搭建（+Z 为朝向），进 GeoBatch 合批。
 * 带火焰的火盆只画盆体，火焰由 ArenaView 用实例化网格做动画。
 */
import type { GeoBatch } from './Batch';
import { Tpl } from './Batch';
import type { Deco, LevelLayout } from './LevelGen';
import type { ThemeStyle } from './Themes';

type Rand = () => number;

interface Ctx {
  b: GeoBatch;
  st: ThemeStyle;
  rand: Rand;
  frost: boolean;
  hot: boolean;
  desert: boolean;
}

/** 火焰位置（世界坐标，火焰底部） */
export interface FlameSpot { x: number; y: number; z: number; s: number }

export function drawProps(b: GeoBatch, L: LevelLayout, st: ThemeStyle, rand: Rand, flames: FlameSpot[], replaced?: ReadonlySet<Deco>): void {
  const c: Ctx = { b, st, rand, frost: L.theme === 'frost', hot: L.theme === 'inferno', desert: L.theme === 'desert' };
  for (const d of L.decos) {
    if (replaced?.has(d)) continue;
    b.setFrame(d.x, d.y, d.z, d.yaw, d.s);
    // 悬挂在高处的装饰不做贴地 AO
    if (d.kind === 'wallBanner' || d.kind === 'lanternString') b.aoBase = -100;
    switch (d.kind) {
      case 'gate': gate(c, d); break;
      case 'door': door(c, d); break;
      case 'wallBanner': wallBanner(c, d); break;
      case 'banner': banner(c, d); break;
      case 'brazier':
        brazier(c);
        flames.push({ x: d.x, y: d.y + 0.95 * d.s, z: d.z, s: d.s });
        break;
      case 'stoneLantern': stoneLantern(c); break;
      case 'lanternPost': lanternPost(c); break;
      case 'lanternString': lanternString(c, d); break;
      case 'stall': stall(c, d); break;
      case 'cactus': cactus(c, d); break;
      case 'statue': statue(c, d); break;
      case 'dune': mound(c, d, c.st.sand); break;
      case 'snowdrift': mound(c, d, c.st.snow); break;
      case 'pine': pine(c, d); break;
      case 'crystal': crystal(c, d); break;
      case 'spike': spike(c, d); break;
      case 'rock': rock(c, d); break;
      case 'pots': pots(c, d); break;
    }
    b.clearFrame();
  }
}

// ───────────────────────────── 墙面 / 大门 ─────────────────────────────

/** 远端大门：门柱由布局盒子绘制，这里画门扇、额枋、匾额、门楼顶与灯笼 */
function gate(c: Ctx, d: Deco): void {
  const { b, st } = c;
  const W = d.w;
  const Hh = d.h;
  const doorH = Hh - 1.7;
  // 门扇 + 门钉
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -(W - 0.6) : 0.03;
    const x1 = s < 0 ? -0.03 : W - 0.6;
    b.boxMM('wood', x0, 0, 0.02, x1, doorH, 0.2, st.woodDark);
    const cx = (x0 + x1) / 2;
    const lw = x1 - x0;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 5; j++) {
        b.box('metal', cx + (i - 1.5) * lw * 0.22, 0.8 + j * (doorH - 1.4) / 4, 0.23, 0.12, 0.12, 0.07, st.gold);
      }
    }
    b.sphere('metal', s * 0.35, doorH * 0.48, 0.28, 0.16, 0.16, 0.1, st.gold);
  }
  b.boxMM('stone', -W, doorH, 0.0, W, doorH + 0.3, 0.35, st.stone2);
  // 额枋
  b.boxMM('lacquer', -W - 0.9, Hh - 0.5, 0.05, W + 0.9, Hh - 0.05, 1.15, st.lacquer);
  b.boxMM('lacquer', -W + 0.6, Hh - 1.55, 0.2, W - 0.6, Hh - 1.25, 1.0, st.lacquer);
  b.boxMM('metal', -W - 0.9, Hh - 0.56, 0.02, W + 0.9, Hh - 0.5, 1.18, st.gold);
  // 匾额
  b.box('metal', 0, Hh - 0.9, 1.1, 2.0, 0.8, 0.1, st.gold);
  b.box('rough', 0, Hh - 0.9, 1.16, 1.75, 0.58, 0.04, st.trim);
  for (let i = 0; i < 3; i++) b.box(c.hot ? 'glow' : 'metal', (i - 1) * 0.48, Hh - 0.9, 1.19, 0.28, 0.3, 0.02, c.hot ? st.glow : st.gold);
  // 门楼顶
  const ridge = Hh + 1.1;
  const halfW = 1.5;
  const pitch = 0.5;
  const w = halfW / Math.cos(pitch);
  const off = (w / 2) * Math.cos(pitch);
  const drop = (w / 2) * Math.sin(pitch);
  const len = 2 * W + 3.2;
  for (const s of [-1, 1]) {
    b.box('rough', 0, ridge - drop, 0.55 + s * off, len, 0.18, w, st.roof, 0, s * pitch);
    if (c.frost) b.box('rough', 0, ridge - drop + 0.11, 0.55 + s * off * 0.95, len - 0.3, 0.08, w * 0.85, st.snow, 0, s * pitch);
  }
  b.box('rough', 0, ridge + 0.06, 0.55, len + 0.3, 0.3, 0.34, st.trim);
  for (const s of [-1, 1]) {
    b.cone('rough', 4, s * (len / 2 + 0.1), ridge - 0.1, 0.55, 0.16, 0.9, st.roof, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0.8);
    b.cone('rough', 4, s * (len / 2 - 0.2), ridge - 0.95, 0.55 + 1.4, 0.13, 0.7, st.roof, Math.atan2(s, 1), 0.95);
  }
  // 额枋下的纸灯笼
  for (const s of [-1, 1]) paperLantern(c, s * (W - 1.0), Hh - 2.4, 1.0, 1.1);
}

/** 入口紧闭的大门（贴墙，不挡路） */
function door(c: Ctx, d: Deco): void {
  const { b, st } = c;
  const W = d.w;
  const Hh = d.h;
  for (const s of [-1, 1]) {
    b.boxMM('stone', s * W - 0.35, 0, 0, s * W + 0.35, Hh + 0.4, 0.3, st.stone2);
    b.boxMM('wood', s < 0 ? -W + 0.35 : 0.03, 0, 0.02, s < 0 ? -0.03 : W - 0.35, Hh, 0.18, st.woodDark);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 5; j++) b.box('metal', s * (0.4 + i * 0.5), 0.7 + j * (Hh - 1.2) / 4, 0.21, 0.1, 0.1, 0.06, st.gold);
    }
  }
  b.boxMM('stone', -W - 0.5, Hh + 0.4, 0, W + 0.5, Hh + 0.8, 0.45, st.stone2);
  b.box('rough', 0, Hh + 1.05, 0.35, 2 * W + 1.6, 0.16, 1.0, st.roof, 0, 0.35);
  if (c.frost) b.box('rough', 0, Hh + 1.15, 0.35, 2 * W + 1.4, 0.08, 0.85, st.snow, 0, 0.35);
}

/** 墙面垂幡（原点在幡顶，贴墙） */
function wallBanner(c: Ctx, d: Deco): void {
  const { b, st } = c;
  const h = d.h;
  const cloth = st.cloth;
  // 离墙 0.14 米起挂，避开墙面腰线饰带
  b.box('metal', 0, 0, 0.22, 1.7, 0.08, 0.08, st.metal);
  for (const s of [-1, 1]) b.sphere('metal', s * 0.88, 0, 0.22, 0.08, 0.08, 0.08, st.gold, 5, 4);
  b.box('cloth', 0, -h / 2, 0.18, 1.3, h, 0.04, cloth);
  for (const s of [-1, 1]) {
    b.box('cloth', s * 0.375, -h - 0.25, 0.18, 0.55, 0.5, 0.04, cloth);
    b.box('cloth', s * 0.6, -h / 2, 0.2, 0.1, h, 0.03, st.cloth2);
  }
  b.add(c.hot ? 'glow' : 'metal', Tpl.disc(12), 0, -h * 0.3, 0.205, 0.34, 0.34, 1, c.hot ? st.glowHot : st.gold);
  b.add('cloth', Tpl.disc(12), 0, -h * 0.3, 0.212, 0.22, 0.22, 1, cloth);
  b.box(c.hot ? 'glow' : 'metal', 0, -h * 0.3, 0.218, 0.06, 0.3, 0.01, c.hot ? st.glowHot : st.gold);
}

/** 立杆旗帜 */
function banner(c: Ctx, d: Deco): void {
  const { b, st } = c;
  const h = d.h;
  b.box('stone', 0, 0.15, 0, 0.5, 0.3, 0.5, st.stone2);
  b.cyl('wood', 6, 0, 0.3, 0, 0.06, h, st.woodDark);
  b.box('wood', 0.35, h - 0.1, 0, 0.9, 0.06, 0.06, st.woodDark);
  b.box('cloth', 0.4, h - 1.25, 0, 0.8, 2.2, 0.03, st.cloth);
  b.box('cloth', 0.4, h - 2.45, 0, 0.5, 0.25, 0.03, st.cloth);
  b.sphere('metal', 0, h + 0.35, 0, 0.09, 0.09, 0.09, st.gold, 5, 4);
}

// ───────────────────────────── 灯火 ─────────────────────────────

function brazier(c: Ctx): void {
  const { b, st } = c;
  b.cyl('stone', 6, 0, 0, 0, 0.4, 0.62, st.stone2, 0.72);
  b.cyl('stone', 6, 0, 0, 0, 0.46, 0.12, shade(st.stone2, 0.85));
  b.cyl('metal', 8, 0, 0.6, 0, 0.3, 0.36, st.metal, 1.9);
  b.cyl('metal', 8, 0, 0.94, 0, 0.6, 0.06, st.gold);
  b.cyl('glow', 8, 0, 0.9, 0, 0.5, 0.05, st.glow);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.box('metal', Math.sin(a) * 0.5, 0.85, Math.cos(a) * 0.5, 0.08, 0.3, 0.08, st.gold, a);
  }
}

function stoneLantern(c: Ctx): void {
  const { b, st } = c;
  b.cyl('stone', 6, 0, 0, 0, 0.48, 0.25, st.stone2);
  b.cyl('stone', 6, 0, 0.25, 0, 0.16, 0.85, st.stone2);
  b.box('stone', 0, 1.17, 0, 0.8, 0.14, 0.8, st.stone2);
  b.box('stone', 0, 1.49, 0, 0.56, 0.5, 0.56, st.stone);
  b.box('glow', 0, 1.49, 0, 0.3, 0.28, 0.6, st.glow);
  b.box('glow', 0, 1.49, 0, 0.6, 0.28, 0.3, st.glow);
  b.add('stone', Tpl.pyramid(), 0, 1.74, 0, 0.47, 0.42, 0.47, st.stone2);
  b.sphere('stone', 0, 2.22, 0, 0.1, 0.12, 0.1, st.stone2, 5, 4);
  if (c.frost) b.add('rough', Tpl.pyramid(), 0, 1.84, 0, 0.37, 0.3, 0.37, st.snow);
}

/** 纸灯笼（悬挂点在 y 顶部） */
function paperLantern(c: Ctx, x: number, y: number, z: number, s: number): void {
  const { b, st } = c;
  b.box('rough', x, y + 0.2 * s, z, 0.02, 0.4 * s, 0.02, st.trim);
  b.cyl('wood', 8, x, y - 0.05 * s, z, 0.17 * s, 0.06 * s, st.woodDark);
  b.add('glow', Tpl.sphere(8, 6), x, y - 0.33 * s, z, 0.27 * s, 0.3 * s, 0.27 * s, st.paper);
  b.cyl('wood', 8, x, y - 0.66 * s, z, 0.15 * s, 0.06 * s, st.woodDark);
  b.box('glow', x, y - 0.8 * s, z, 0.05 * s, 0.2 * s, 0.05 * s, st.glowHot);
}

function lanternPost(c: Ctx): void {
  const { b, st } = c;
  b.box('stone', 0, 0.15, 0, 0.42, 0.3, 0.42, st.stone2);
  b.box('lacquer', 0, 1.75, 0, 0.18, 3.2, 0.18, st.lacquer);
  b.box('wood', 0, 3.1, 0.4, 0.1, 0.1, 0.95, st.woodDark);
  b.box('metal', 0, 3.4, 0, 0.26, 0.08, 0.26, st.gold);
  paperLantern(c, 0, 2.95, 0.8, 1.0);
}

/** 横跨场地的灯笼串：两端立杆，中间下垂的绳子挂着灯笼 */
function lanternString(c: Ctx, d: Deco): void {
  const { b, st } = c;
  const w = d.w;
  const h = d.h;
  const sag = 1.4;
  for (const s of [-1, 1]) {
    b.cyl('wood', 6, s * w, 0, 0, 0.1, h + 0.4, st.woodDark);
    b.sphere('metal', s * w, h + 0.5, 0, 0.12, 0.12, 0.12, st.gold, 5, 4);
  }
  const yAt = (x: number): number => h - sag * (1 - (x / w) * (x / w));
  const segs = 18;
  for (let i = 0; i < segs; i++) {
    const x0 = -w + (2 * w * i) / segs;
    const x1 = -w + (2 * w * (i + 1)) / segs;
    b.beam('rough', x0, yAt(x0), 0, x1, yAt(x1), 0, 0.035, st.trim);
  }
  const n = Math.floor((2 * w - 3) / 2.4);
  for (let i = 0; i <= n; i++) {
    const x = -w + 1.5 + (i * (2 * w - 3)) / Math.max(1, n);
    const y = yAt(x);
    b.box('rough', x, y - 0.12, 0, 0.02, 0.24, 0.02, st.trim);
    b.cyl('wood', 8, x, y - 0.3, 0, 0.12, 0.05, st.woodDark);
    b.add('glow', Tpl.sphere(8, 6), x, y - 0.5, 0, 0.19, 0.22, 0.19, i % 2 === 0 ? st.paper : st.glowHot);
    b.cyl('wood', 8, x, y - 0.74, 0, 0.1, 0.05, st.woodDark);
  }
}

/** 集市摊棚（原点在柜台中心，+Z 朝场内，墙在 -Z 约 2.15 米处） */
function stall(c: Ctx, d: Deco): void {
  const { b, st } = c;
  const W = d.w;
  const back = -1.95;
  for (const s of [-1, 1]) {
    b.box('wood', s * W, 1.3, 0.55, 0.14, 2.6, 0.14, st.woodDark);
    b.box('wood', s * W, 1.55, back, 0.14, 3.1, 0.14, st.woodDark);
  }
  // 条纹布棚（前低后高）
  const stripes = 6;
  const pitch = Math.atan2(0.75, 2.6);
  const len = Math.hypot(0.75, 2.6) + 0.4;
  for (let i = 0; i < stripes; i++) {
    const x = -W + ((i + 0.5) * 2 * W) / stripes;
    b.box('cloth', x, 2.95, -0.7, (2 * W) / stripes + 0.01, 0.05, len, i % 2 === 0 ? st.cloth : st.cloth2, 0, pitch);
  }
  b.box('cloth', 0, 2.5, 0.72, 2 * W + 0.1, 0.3, 0.04, st.cloth);
  // 后架
  b.box('wood', 0, 0.8, back + 0.2, 2 * W - 0.3, 1.6, 0.4, st.wood);
  b.box('wood', 0, 1.62, back + 0.2, 2 * W - 0.2, 0.06, 0.5, st.woodDark);
  // 货物
  const r = c.rand;
  for (let i = 0; i < 4; i++) {
    const x = -W + 0.5 + i * ((2 * W - 1) / 3);
    const kind = Math.floor(r() * 3);
    if (kind === 0) b.add('rough', Tpl.sphere(7, 5), x, 1.2, 0, 0.2, 0.24, 0.2, st.clay);
    else if (kind === 1) b.box('wood', x, 1.15, 0, 0.35, 0.3, 0.3, st.wood, r() * 0.6);
    else b.add('cloth', Tpl.cyl(6), x, 1.12, -0.18, 0.12, 0.5, 0.12, r() < 0.5 ? st.cloth2 : st.cloth, Math.PI / 2, r(), 0);
  }
  for (let i = 0; i < 3; i++) b.add('rough', Tpl.sphere(6, 4), -W + 0.6 + i * 0.5, 1.75, back + 0.2, 0.14, 0.16, 0.14, st.clay);
}

// ───────────────────────────── 荒漠 ─────────────────────────────

function cactus(c: Ctx, d: Deco): void {
  const { b, st } = c;
  const h = 2.6 + d.v * 0.7;
  b.cyl('rough', 7, 0, 0, 0, 0.27, h, st.foliage, 0.88);
  b.sphere('rough', 0, h, 0, 0.235, 0.16, 0.235, st.foliage2, 7, 4);
  const arms = d.v < 0.35 ? 1 : 2;
  for (let i = 0; i < arms; i++) {
    const s = i === 0 ? 1 : -1;
    const y = 1.0 + (i === 0 ? d.v : 1 - d.v) * 0.7;
    const top = y + 0.7 + d.v * 0.5;
    b.beam('rough', 0, y, 0, s * 0.62, y + 0.12, 0, 0.3, st.foliage);
    b.cyl('rough', 7, s * 0.62, y, 0, 0.18, top - y, st.foliage, 0.85);
    b.sphere('rough', s * 0.62, top, 0, 0.155, 0.12, 0.155, st.foliage2, 7, 4);
  }
  // 小花
  if (d.v > 0.6) b.sphere('glow', 0, h + 0.12, 0, 0.08, 0.06, 0.08, 0xff7aa0, 5, 3);
}

/** 破旧石像：坐姿守卫，头颅掉在一旁 */
function statue(c: Ctx, _d: Deco): void {
  const { b, st } = c;
  const col = shade(st.stone, 1.05);
  b.box('rough', 0, 0.5, 0, 1.8, 1.0, 1.8, st.stone2);
  b.box('rough', 0, 0.98, 0, 1.95, 0.14, 1.95, shade(st.stone2, 1.15));
  b.box('rough', 0, 1.3, 0.15, 1.3, 0.5, 1.1, col);
  b.box('rough', 0, 2.1, -0.12, 1.0, 1.2, 0.7, col, 0, -0.08);
  b.box('rough', 0, 2.68, -0.12, 1.45, 0.34, 0.8, col);
  for (const s of [-1, 1]) {
    b.box('rough', s * 0.66, 2.05, 0.05, 0.3, 0.95, 0.36, col, 0, 0.15 * s);
    b.box('rough', s * 0.66, 1.55, 0.4, 0.34, 0.2, 0.42, col);
  }
  b.box('rough', 0, 2.93, -0.12, 0.34, 0.18, 0.34, col);
  // 掉落的头
  b.box('rough', 1.35, 0.3, 0.95, 0.62, 0.6, 0.6, col, 0.7, 0.2, 0.45);
  b.box('rough', 1.45, 0.62, 0.95, 0.2, 0.28, 0.5, st.stone2, 0.7, 0.2, 0.45);
  b.add('rough', Tpl.dodeca(), -0.9, 0.12, 1.1, 0.28, 0.2, 0.25, st.stone2);
}

function mound(c: Ctx, d: Deco, color: number): void {
  c.b.add('rough', Tpl.mound(), 0, -0.04, 0, d.w, d.h, d.w * 0.5, color);
  c.b.add('rough', Tpl.mound(), d.w * 0.45, -0.04, 0.2, d.w * 0.45, d.h * 0.7, d.w * 0.3, color);
}

// ───────────────────────────── 霜雪 ─────────────────────────────

function pine(c: Ctx, d: Deco): void {
  const { b, st } = c;
  b.cyl('rough', 5, 0, 0, 0, 0.2, 1.3, st.woodDark, 0.8);
  const tiers: [number, number, number][] = [[0.8, 1.55, 1.9], [1.85, 1.2, 1.7], [2.8, 0.86, 1.5], [3.75, 0.45, 1.0]];
  for (let i = 0; i < tiers.length; i++) {
    const [y, r, h] = tiers[i];
    const ry = d.v * 6 + i;
    b.cone('rough', 7, 0, y, 0, r, h, i % 2 === 0 ? st.foliage : st.foliage2, ry);
    if (c.frost) b.cone('rough', 7, 0, y + h * 0.42, 0, r * 0.64, h * 0.6, st.snow, ry + 0.2);
  }
}

function crystal(c: Ctx, d: Deco): void {
  const { b, st } = c;
  b.add('rough', Tpl.dodeca(), 0, 0.1, 0, 0.75, 0.4, 0.7, st.stone2);
  const n = 4 + Math.floor(d.v * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + d.v * 3;
    const r = i === 0 ? 0 : 0.35 + c.rand() * 0.2;
    const sy = i === 0 ? 1.1 : 0.55 + c.rand() * 0.45;
    const sxz = i === 0 ? 0.42 : 0.24 + c.rand() * 0.12;
    const tilt = i === 0 ? 0 : 0.35;
    b.add('gloss', Tpl.octa(), Math.sin(a) * r, sy * 0.85, Math.cos(a) * r, sxz, sy, sxz, c.hot ? st.obsidian : st.ice, Math.cos(a) * tilt, a, -Math.sin(a) * tilt);
  }
  // 发光晶核
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    b.add('glow', Tpl.octa(), Math.sin(a) * 0.55, 0.3, Math.cos(a) * 0.55, 0.12, 0.3, 0.12, c.hot ? st.glow : st.ice, 0.3, a, 0);
  }
}

// ───────────────────────────── 熔火 ─────────────────────────────

function spike(c: Ctx, d: Deco): void {
  const { b, st } = c;
  b.add('rough', Tpl.dodeca(), 0, 0.1, 0, 0.9, 0.45, 0.85, st.stone2);
  const n = 4 + Math.floor(d.v * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + d.v * 5;
    const r = i === 0 ? 0 : 0.3 + c.rand() * 0.3;
    const h = i === 0 ? 3.0 : 1.3 + c.rand() * 1.5;
    const tilt = i === 0 ? 0.05 : 0.22 + c.rand() * 0.2;
    b.cone('gloss', 5, Math.sin(a) * r, 0, Math.cos(a) * r, i === 0 ? 0.55 : 0.28 + c.rand() * 0.18, h, st.obsidian, a, Math.cos(a) * tilt, -Math.sin(a) * tilt);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 1.1;
    b.cone('glow', 4, Math.sin(a) * 0.7, 0, Math.cos(a) * 0.7, 0.13, 0.45, st.glow, a);
  }
}

function rock(c: Ctx, d: Deco): void {
  c.b.add('rough', Tpl.dodeca(), 0, 0.22, 0, 1, 0.62, 0.85, c.hot ? c.st.stone2 : shade(c.st.stone2, 1.1), 0, d.v * 6, 0);
}

function pots(c: Ctx, d: Deco): void {
  const { b, st } = c;
  const n = 1 + Math.floor(d.v * 3);
  for (let i = 0; i < n; i++) {
    const a = i * 2.1 + d.v * 4;
    const r = i === 0 ? 0 : 0.55;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const s = i === 0 ? 1 : 0.7 + c.rand() * 0.2;
    const col = shade(st.clay, 0.85 + c.rand() * 0.3);
    b.add('rough', Tpl.sphere(8, 6), x, 0.38 * s, z, 0.34 * s, 0.4 * s, 0.34 * s, col);
    b.cyl('rough', 8, x, 0.7 * s, z, 0.15 * s, 0.16 * s, col, 1.25);
    b.cyl('rough', 8, x, 0.86 * s, z, 0.2 * s, 0.04 * s, shade(col, 0.8));
    if (c.frost) b.add('rough', Tpl.mound(), x, 0.88 * s, z, 0.17 * s, 0.05, 0.17 * s, st.snow);
  }
}

function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const bl = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | bl;
}
