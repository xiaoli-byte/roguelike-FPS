/**
 * 按外观（BoxLook）把布局盒子画成低多边形结构：围墙（城垛 / 檐角 / 黑曜石尖刺）、角楼、壁柱、
 * 高台、台阶、掩体、柱子、石碑、亭顶、牌坊等。所有零件进 GeoBatch 合批。
 * 视觉零件可以略微超出碰撞盒（檐口、台沿），但不会明显侵入可走区域。
 */
import type { GeoBatch, MatKey } from './Batch';
import { Tpl } from './Batch';
import type { LayoutBox, LevelLayout } from './LevelGen';
import type { ThemeStyle } from './Themes';

type Rand = () => number;

interface Ctx {
  b: GeoBatch;
  st: ThemeStyle;
  L: LevelLayout;
  rand: Rand;
  frost: boolean;
  hot: boolean;
}

export function drawStructures(b: GeoBatch, L: LevelLayout, st: ThemeStyle, rand: Rand): void {
  const c: Ctx = { b, st, L, rand, frost: L.theme === 'frost', hot: L.theme === 'inferno' };
  for (const bx of L.boxes) {
    b.aoBase = bx.minY;
    switch (bx.look) {
      case 'wall': wall(c, bx); break;
      case 'tower': tower(c, bx); break;
      case 'pilaster': pilaster(c, bx); break;
      case 'gatePillar': gatePillar(c, bx); break;
      case 'platform': platform(c, bx); break;
      case 'stair': stair(c, bx); break;
      case 'parapet': parapet(c, bx); break;
      case 'post': post(c, bx); break;
      case 'roof': pavilionRoof(c, bx); break;
      case 'lowWall': lowWall(c, bx); break;
      case 'crate': crate(c, bx); break;
      case 'pillar': pillar(c, bx); break;
      case 'ruin': ruin(c, bx); break;
      case 'stele': stele(c, bx); break;
      case 'steleBase': steleBase(c, bx); break;
      case 'lintel': lintel(c, bx); break;
      case 'galleryRoof': galleryRoof(c, bx); break;
      case 'counter': counter(c, bx); break;
      default: break; // collider / invisible 不绘制
    }
  }
  b.aoBase = 0;
}

// ───────────────────────────── 小工具 ─────────────────────────────

function dims(bx: LayoutBox): { cx: number; cz: number; sx: number; sy: number; sz: number } {
  return {
    cx: (bx.minX + bx.maxX) / 2,
    cz: (bx.minZ + bx.maxZ) / 2,
    sx: bx.maxX - bx.minX,
    sy: bx.maxY - bx.minY,
    sz: bx.maxZ - bx.minZ,
  };
}

/** 盒子四周加一圈（footprint 外扩 grow）的水平带 */
function ring(c: Ctx, key: MatKey, bx: LayoutBox, y0: number, y1: number, grow: number, color: number): void {
  c.b.boxMM(key, bx.minX - grow, y0, bx.minZ - grow, bx.maxX + grow, y1, bx.maxZ + grow, color);
}

/** 顶面积雪（霜雪主题） */
function snowCap(c: Ctx, bx: LayoutBox, y: number, grow = 0.04): void {
  if (!c.frost) return;
  c.b.boxMM('rough', bx.minX - grow, y, bx.minZ - grow, bx.maxX + grow, y + 0.07, bx.maxZ + grow, c.st.snow);
}

function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/** 沿长轴排列的两片坡屋面 + 屋脊（双坡顶），用于围墙檐顶与牌坊 */
function gableRoof(c: Ctx, alongX: boolean, cx: number, cz: number, len: number, ridgeY: number, halfW: number, pitch: number, color: number): void {
  const b = c.b;
  const w = halfW / Math.cos(pitch);
  const off = (w / 2) * Math.cos(pitch);
  const drop = (w / 2) * Math.sin(pitch);
  for (const s of [-1, 1]) {
    if (alongX) {
      b.box('rough', cx, ridgeY - drop, cz + s * off, len, 0.16, w, color, 0, s * pitch);
      if (c.frost) b.box('rough', cx, ridgeY - drop + 0.1, cz + s * off * 0.95, len - 0.2, 0.08, w * 0.85, c.st.snow, 0, s * pitch);
    } else {
      b.box('rough', cx + s * off, ridgeY - drop, cz, len, 0.16, w, color, Math.PI / 2, s * pitch);
      if (c.frost) b.box('rough', cx + s * off * 0.95, ridgeY - drop + 0.1, cz, len - 0.2, 0.08, w * 0.85, c.st.snow, Math.PI / 2, s * pitch);
    }
  }
  if (alongX) b.box('rough', cx, ridgeY + 0.05, cz, len + 0.2, 0.26, 0.3, c.st.trim);
  else b.box('rough', cx, ridgeY + 0.05, cz, 0.3, 0.26, len + 0.2, c.st.trim);
}

/** 翘角：屋角向上挑起的小锥 */
function upturn(c: Ctx, x: number, y: number, z: number, dx: number, dz: number, color: number): void {
  // 朝 (dx,dz) 方向外倾 55°
  const yaw = Math.atan2(dx, dz);
  c.b.cone('rough', 4, x, y, z, 0.14, 0.7, color, yaw, 0.95);
}

// ───────────────────────────── 围墙 ─────────────────────────────

function wall(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { cx, cz, sx, sy: h, sz } = dims(bx);
  const alongX = sx > sz;
  const len = alongX ? sx : sz;
  const thick = alongX ? sz : sx;
  b.box('stone', cx, h / 2, cz, sx, h, sz, st.stone);

  // 内侧面（朝向场内）的饰带
  const dir = alongX ? (cz < 0 ? 1 : -1) : (cx < 0 ? 1 : -1);
  const face = alongX ? (cz < 0 ? bx.maxZ : bx.minZ) : (cx < 0 ? bx.maxX : bx.minX);
  const band = (key: MatKey, y0: number, y1: number, out: number, color: number, inset = 0): void => {
    const a = face;
    const e = face + dir * out;
    if (alongX) b.boxMM(key, bx.minX + inset, y0, Math.min(a, e), bx.maxX - inset, y1, Math.max(a, e), color);
    else b.boxMM(key, Math.min(a, e), y0, bx.minZ + inset, Math.max(a, e), y1, bx.maxZ - inset, color);
  };
  band('stone', 0, 0.7, 0.15, st.stone2);
  band('stone', h * 0.62, h * 0.62 + 0.18, 0.08, st.stone2);

  switch (st.wallTop) {
    case 'merlon': {
      band('stone', h - 0.35, h, 0.22, st.stone2);
      const n = Math.floor(len / 2.0);
      const start = (alongX ? bx.minX : bx.minZ) + (len - (n - 1) * 2.0) / 2;
      for (let i = 0; i < n; i++) {
        const t = start + i * 2.0;
        if (alongX) b.box('stone', t, h + 0.5, cz, 1.1, 1.0, thick + 0.1, st.stone);
        else b.box('stone', cx, h + 0.5, t, thick + 0.1, 1.0, 1.1, st.stone);
      }
      break;
    }
    case 'eave': {
      // 朱红檐下饰带 + 青瓦双坡顶 + 积雪
      band('lacquer', h - 1.1, h - 0.25, 0.06, st.lacquer);
      band('metal', h - 1.2, h - 1.1, 0.08, st.gold);
      b.box('stone', cx, h + 0.15, cz, alongX ? len : thick, 0.3, alongX ? thick : len, st.stone2);
      gableRoof(c, alongX, cx, cz, len, h + 1.05, thick / 2 + 0.95, 0.42, st.roof);
      break;
    }
    case 'spike': {
      band('stone', h - 0.35, h, 0.22, st.stone2);
      band('glow', 0.7, 0.76, 0.17, st.glow);
      const n = Math.floor(len / 1.5);
      const start = alongX ? bx.minX : bx.minZ;
      for (let i = 0; i < n; i++) {
        const t = start + 0.75 + i * 1.5 + (c.rand() - 0.5) * 0.4;
        const r = 0.3 + c.rand() * 0.25;
        const hh = 0.8 + c.rand() * 1.6;
        const off = (c.rand() - 0.5) * thick * 0.5;
        if (alongX) b.cone('gloss', 5, t, h, cz + off, r, hh, st.obsidian, c.rand() * 3, (c.rand() - 0.5) * 0.3, (c.rand() - 0.5) * 0.3);
        else b.cone('gloss', 5, cx + off, h, t, r, hh, st.obsidian, c.rand() * 3, (c.rand() - 0.5) * 0.3, (c.rand() - 0.5) * 0.3);
      }
      // 墙面熔岩裂缝
      const seams = Math.max(2, Math.floor(len / 8));
      for (let i = 0; i < seams; i++) {
        const t = (alongX ? bx.minX : bx.minZ) + 3 + c.rand() * (len - 6);
        const y0 = 0.8 + c.rand() * 2.5;
        const y1 = y0 + 1.5 + c.rand() * 4;
        const w = 0.08 + c.rand() * 0.08;
        const a = face;
        const e = face + dir * 0.03;
        if (alongX) b.boxMM('glow', t - w, y0, Math.min(a, e), t + w, Math.min(h - 0.5, y1), Math.max(a, e), st.glow);
        else b.boxMM('glow', Math.min(a, e), y0, t - w, Math.max(a, e), Math.min(h - 0.5, y1), t + w, st.glow);
      }
      break;
    }
  }
}

function tower(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { cx, cz, sx, sy: h, sz } = dims(bx);
  b.box('stone', cx, h / 2, cz, sx, h, sz, shade(st.stone, 0.92));
  ring(c, 'stone', bx, 0, 0.9, 0.12, st.stone2);
  ring(c, 'stone', bx, h * 0.55, h * 0.55 + 0.25, 0.08, st.stone2);
  switch (st.wallTop) {
    case 'merlon': {
      ring(c, 'stone', bx, h - 0.4, h, 0.25, st.stone2);
      for (let i = 0; i < 3; i++) {
        const t = -0.33 + i * 0.33;
        b.box('stone', cx + t * sx, h + 0.55, bx.minZ + 0.35, 0.9, 1.1, 0.7, st.stone);
        b.box('stone', cx + t * sx, h + 0.55, bx.maxZ - 0.35, 0.9, 1.1, 0.7, st.stone);
        b.box('stone', bx.minX + 0.35, h + 0.55, cz + t * sz, 0.7, 1.1, 0.9, st.stone);
        b.box('stone', bx.maxX - 0.35, h + 0.55, cz + t * sz, 0.7, 1.1, 0.9, st.stone);
      }
      break;
    }
    case 'eave': {
      ring(c, 'lacquer', bx, h - 1.3, h - 0.3, 0.05, st.lacquer);
      ring(c, 'metal', bx, h - 1.4, h - 1.3, 0.07, st.gold);
      b.add('rough', Tpl.pyramid(), cx, h - 0.1, cz, sx / 2 + 0.3, 2.8, sz / 2 + 0.3, st.roof);
      b.add('rough', Tpl.pyramid(), cx, h + 0.35, cz, (sx / 2 + 0.3) * 0.72, 2.2, (sz / 2 + 0.3) * 0.72, st.snow);
      b.cyl('metal', 6, cx, h + 2.5, cz, 0.08, 1.0, st.gold);
      b.sphere('metal', cx, h + 3.55, cz, 0.18, 0.18, 0.18, st.gold);
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) upturn(c, cx + dx * (sx / 2 + 0.3), h - 0.1, cz + dz * (sz / 2 + 0.3), dx, dz, st.roof);
      break;
    }
    case 'spike': {
      ring(c, 'stone', bx, h - 0.4, h, 0.25, st.stone2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        b.cone('gloss', 5, cx + Math.sin(a) * sx * 0.38, h, cz + Math.cos(a) * sz * 0.38, 0.35, 1.2 + c.rand() * 1.4, st.obsidian, a, Math.cos(a) * 0.25, -Math.sin(a) * 0.25);
      }
      b.cone('gloss', 6, cx, h, cz, 0.9, 4.2, st.obsidian, c.rand());
      // 发光窗缝
      for (const y of [h * 0.35, h * 0.72]) {
        b.box('glow', cx, y, bx.minZ - 0.02, 0.22, 1.1, 0.06, st.glow);
        b.box('glow', cx, y, bx.maxZ + 0.02, 0.22, 1.1, 0.06, st.glow);
        b.box('glow', bx.minX - 0.02, y, cz, 0.06, 1.1, 0.22, st.glow);
        b.box('glow', bx.maxX + 0.02, y, cz, 0.06, 1.1, 0.22, st.glow);
      }
      break;
    }
  }
}

function pilaster(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { sy: h } = dims(bx);
  const key: MatKey = c.frost ? 'lacquer' : 'stone';
  const color = c.frost ? st.lacquer : st.stone2;
  b.boxMM(key, bx.minX, 0, bx.minZ, bx.maxX, h, bx.maxZ, color);
  ring(c, 'stone', bx, 0, 0.5, 0.1, st.stone2);
  ring(c, c.frost ? 'metal' : 'stone', bx, h - 0.35, h, 0.14, c.frost ? st.gold : shade(st.stone2, 0.85));
  snowCap(c, bx, h, 0.14);
}

function gatePillar(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { sy: h } = dims(bx);
  b.boxMM('lacquer', bx.minX, 0, bx.minZ, bx.maxX, h, bx.maxZ, st.lacquer);
  ring(c, 'stone', bx, 0, 0.6, 0.3, st.stone2);
  ring(c, 'stone', bx, 0.6, 0.75, 0.18, shade(st.stone2, 1.1));
  ring(c, 'metal', bx, h * 0.62, h * 0.62 + 0.12, 0.04, st.gold);
  ring(c, 'metal', bx, h * 0.62 + 0.25, h * 0.62 + 0.32, 0.04, st.gold);
  ring(c, 'lacquer', bx, h - 0.3, h, 0.18, shade(st.lacquer, 0.8));
  snowCap(c, bx, h, 0.18);
}

// ───────────────────────────── 高台 / 台阶 ─────────────────────────────

function platform(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { sy: h } = dims(bx);
  b.boxMM('stone', bx.minX, 0, bx.minZ, bx.maxX, h - 0.2, bx.maxZ, st.stone);
  ring(c, 'stone', bx, h - 0.22, h, 0.12, st.paving);
  ring(c, 'stone', bx, h - 0.62, h - 0.46, 0.04, st.stone2);
  ring(c, 'stone', bx, 0, 0.4, 0.08, st.stone2);
  snowCap(c, bx, h - 0.02, 0.1);
  if (c.hot) ring(c, 'glow', bx, h - 0.46, h - 0.42, 0.045, st.glow);
}

function stair(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { sy: h } = dims(bx);
  b.boxMM('stone', bx.minX, 0, bx.minZ, bx.maxX, h - 0.08, bx.maxZ, st.stone2);
  b.boxMM('stone', bx.minX - 0.03, h - 0.08, bx.minZ - 0.03, bx.maxX + 0.03, h, bx.maxZ + 0.03, st.paving);
  snowCap(c, bx, h - 0.03, 0.0);
}

function parapet(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  b.boxMM('stone', bx.minX, bx.minY, bx.minZ, bx.maxX, bx.maxY - 0.1, bx.maxZ, st.stone);
  ring(c, 'stone', bx, bx.maxY - 0.1, bx.maxY, 0.06, st.stone2);
  snowCap(c, bx, bx.maxY - 0.02, 0.06);
}

// ───────────────────────────── 亭子 / 牌坊 / 回廊 ─────────────────────────────

function post(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { sy: h } = dims(bx);
  b.boxMM('lacquer', bx.minX, bx.minY, bx.minZ, bx.maxX, bx.maxY, bx.maxZ, st.lacquer);
  ring(c, 'stone', bx, bx.minY, bx.minY + 0.25, 0.08, st.stone2);
  ring(c, 'metal', bx, bx.minY + h * 0.8, bx.minY + h * 0.8 + 0.08, 0.03, st.gold);
}

function pavilionRoof(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { cx, cz, sx, sz } = dims(bx);
  const y0 = bx.minY;
  b.boxMM('wood', bx.minX + 0.3, y0, bx.minZ + 0.3, bx.maxX - 0.3, y0 + 0.28, bx.maxZ - 0.3, st.woodDark);
  b.boxMM('lacquer', bx.minX + 0.45, y0 - 0.35, bx.minZ + 0.45, bx.maxX - 0.45, y0, bx.maxZ - 0.45, st.lacquer);
  // 四角攒尖顶
  const rx = sx / 2 + 0.1;
  const rz = sz / 2 + 0.1;
  b.add('rough', Tpl.pyramid(), cx, y0 + 0.25, cz, rx, 1.8, rz, st.roof);
  if (c.frost) b.add('rough', Tpl.pyramid(), cx, y0 + 0.5, cz, rx * 0.8, 1.5, rz * 0.8, st.snow);
  b.cyl('metal', 6, cx, y0 + 1.9, cz, 0.08, 0.5, st.gold);
  b.sphere('metal', cx, y0 + 2.5, cz, 0.2, 0.2, 0.2, st.gold);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) upturn(c, cx + dx * sx * 0.5, y0 + 0.28, cz + dz * sz * 0.5, dx, dz, st.roof);
}

function lintel(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { cx, cz, sx, sy, sz } = dims(bx);
  const alongX = sx > sz;
  const len = alongX ? sx : sz;
  b.boxMM('lacquer', bx.minX, bx.minY, bx.minZ, bx.maxX, bx.maxY, bx.maxZ, st.lacquer);
  // 下层额枋
  const y2 = bx.minY - 0.9;
  if (alongX) b.box('lacquer', cx, y2, cz, len - 1.8, 0.32, sz * 0.8, st.lacquer);
  else b.box('lacquer', cx, y2, cz, sx * 0.8, 0.32, len - 1.8, st.lacquer);
  // 匾额
  const py = (bx.minY + y2) / 2;
  for (const s of [-1, 1]) {
    if (alongX) {
      b.box('metal', cx, py, cz + s * (sz / 2 + 0.02), 1.7, 0.66, 0.08, st.gold);
      b.box('rough', cx, py, cz + s * (sz / 2 + 0.06), 1.45, 0.46, 0.04, st.trim);
    } else {
      b.box('metal', cx + s * (sx / 2 + 0.02), py, cz, 0.08, 0.66, 1.7, st.gold);
      b.box('rough', cx + s * (sx / 2 + 0.06), py, cz, 0.04, 0.46, 1.45, st.trim);
    }
  }
  // 金色束带
  const bandW = alongX ? sz + 0.06 : sx + 0.06;
  for (const t of [-0.35, 0.35]) {
    if (alongX) b.box('metal', cx + t * len, bx.minY + sy / 2, cz, 0.12, sy + 0.04, bandW, st.gold);
    else b.box('metal', cx, bx.minY + sy / 2, cz + t * len, bandW, sy + 0.04, 0.12, st.gold);
  }
  // 屋顶
  const ridge = bx.maxY + 0.75;
  gableRoof(c, alongX, cx, cz, len + 1.2, ridge, 1.05, 0.5, st.roof);
  const endT = (len + 1.2) / 2;
  for (const s of [-1, 1]) {
    for (const k of [-1, 1]) {
      if (alongX) upturn(c, cx + s * endT, ridge - 0.55, cz + k * 0.9, s, k * 0.4, st.roof);
      else upturn(c, cx + k * 0.9, ridge - 0.55, cz + s * endT, k * 0.4, s, st.roof);
    }
  }
}

function galleryRoof(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { cx, cz, sx, sz } = dims(bx);
  const wallSide = cx > 0 ? 1 : -1;
  const y0 = bx.minY;
  // 檐下木梁（沿柱列）
  const beamX = wallSide > 0 ? bx.minX + 0.4 : bx.maxX - 0.4;
  b.box('lacquer', beamX, y0 - 0.2, cz, 0.36, 0.4, sz, st.lacquer);
  b.box('metal', beamX, y0 - 0.44, cz, 0.4, 0.06, sz, st.gold);
  b.boxMM('wood', bx.minX, y0, bx.minZ, bx.maxX, y0 + 0.28, bx.maxZ, st.woodDark);
  // 单坡屋面：靠墙一侧更高
  const pitch = 0.28;
  const w = (sx + 1.0) / Math.cos(pitch);
  const lift = (sx / 2) * Math.tan(pitch);
  b.box('rough', cx - wallSide * 0.4, y0 + 0.3 + lift, cz, w, 0.18, sz + 0.8, st.roof, 0, 0, wallSide * pitch);
  if (c.frost) b.box('rough', cx - wallSide * 0.45, y0 + 0.42 + lift, cz, w * 0.9, 0.08, sz + 0.6, st.snow, 0, 0, wallSide * pitch);
}

// ───────────────────────────── 掩体 ─────────────────────────────

function lowWall(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { cx, cz, sx, sy: h, sz } = dims(bx);
  b.boxMM('stone', bx.minX, 0, bx.minZ, bx.maxX, h - 0.14, bx.maxZ, st.stone);
  ring(c, 'stone', bx, h - 0.14, h, 0.08, st.stone2);
  ring(c, 'stone', bx, 0, 0.25, 0.05, st.stone2);
  snowCap(c, bx, h - 0.02, 0.08);
  if (c.hot) {
    if (sx > sz) b.box('glow', cx + (bx.v - 0.5) * sx * 0.5, h * 0.45, cz, sx * 0.35, 0.05, sz + 0.02, st.glow);
    else b.box('glow', cx, h * 0.45, cz + (bx.v - 0.5) * sz * 0.5, sx + 0.02, 0.05, sz * 0.35, st.glow);
  }
}

function crate(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { cx, cz, sx, sy: h, sz } = dims(bx);
  const y0 = bx.minY;
  b.boxMM('wood', bx.minX, y0, bx.minZ, bx.maxX, bx.maxY, bx.maxZ, shade(st.wood, 0.9 + bx.v * 0.2));
  // 包角
  const e = 0.1;
  for (const x of [bx.minX + e / 2 - 0.02, bx.maxX - e / 2 + 0.02]) {
    for (const z of [bx.minZ + e / 2 - 0.02, bx.maxZ - e / 2 + 0.02]) b.box('wood', x, y0 + h / 2, z, e, h + 0.02, e, st.woodDark);
  }
  // 铁箍
  for (const t of [0.2, 0.8]) b.box('metal', cx, y0 + h * t, cz, sx + 0.04, 0.08, sz + 0.04, st.metal);
  b.boxMM('wood', bx.minX - 0.02, bx.maxY - 0.06, bx.minZ - 0.02, bx.maxX + 0.02, bx.maxY, bx.maxZ + 0.02, st.woodDark);
  snowCap(c, bx, bx.maxY - 0.01, -0.05);
}

function pillar(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { cx, cz, sx, sy: h, sz } = dims(bx);
  const r = Math.min(sx, sz) / 2;
  ring(c, 'stone', bx, 0, 0.45, 0.22, st.stone2);
  ring(c, 'stone', bx, 0.45, 0.6, 0.1, shade(st.stone2, 1.12));
  const shaftKey: MatKey = c.frost ? 'lacquer' : 'stone';
  const shaftColor = c.frost ? st.lacquer : c.hot ? st.stone2 : st.stone;
  b.cyl(shaftKey, 8, cx, 0.6, cz, r, h - 1.0, shaftColor, 1, Math.PI / 8);
  if (c.hot) {
    for (const t of [0.35, 0.68]) b.cyl('glow', 8, cx, 0.6 + (h - 1.0) * t, cz, r * 1.04, 0.08, st.glow, 1, Math.PI / 8);
  } else if (!c.frost) {
    for (const t of [0.12, 0.88]) b.cyl('stone', 8, cx, 0.6 + (h - 1.0) * t, cz, r * 1.06, 0.14, st.stone2, 1, Math.PI / 8);
  } else {
    b.cyl('metal', 8, cx, h - 0.75, cz, r * 1.05, 0.12, st.gold, 1, Math.PI / 8);
  }
  ring(c, c.frost ? 'lacquer' : 'stone', bx, h - 0.4, h, 0.28, c.frost ? shade(st.lacquer, 0.75) : st.stone2);
  snowCap(c, bx, h, 0.28);
}

function ruin(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { cx, cz, sx, sy: h, sz } = dims(bx);
  const col = bx.v < 0.5 ? st.stone : shade(st.stone2, 1.1);
  b.boxMM('stone', bx.minX, 0, bx.minZ, bx.maxX, h, bx.maxZ, col);
  ring(c, 'stone', bx, 0, 0.3, 0.06, st.stone2);
  if (bx.v > 0.35) {
    // 顶上松动的碎砖
    b.box('stone', cx + (bx.v - 0.6) * sx * 0.4, h + 0.12, cz, sx * 0.55, 0.26, sz * 0.8, col, bx.v * 3, (bx.v - 0.5) * 0.4, (0.5 - bx.v) * 0.3);
  }
  snowCap(c, bx, h - 0.02, 0.02);
}

function steleBase(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { cx, cz, sx, sz } = dims(bx);
  b.boxMM('stone', bx.minX, 0, bx.minZ, bx.maxX, bx.maxY - 0.12, bx.maxZ, st.stone2);
  b.boxMM('stone', bx.minX + 0.08, bx.maxY - 0.12, bx.minZ + 0.08, bx.maxX - 0.08, bx.maxY, bx.maxZ - 0.08, shade(st.stone2, 1.15));
  // 龟趺头
  if (sx > sz) b.box('rough', bx.maxX + 0.12, 0.25, cz, 0.35, 0.32, 0.4, st.stone2);
  else b.box('rough', cx, 0.25, bx.maxZ + 0.12, 0.4, 0.32, 0.35, st.stone2);
}

function stele(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  const { cx, cz, sx, sy: h, sz } = dims(bx);
  const y0 = bx.minY;
  b.boxMM('rough', bx.minX, y0, bx.minZ, bx.maxX, bx.maxY, bx.maxZ, shade(st.stone2, 1.05));
  // 碑首
  const wide = Math.max(sx, sz);
  b.add('rough', Tpl.pyramid(), cx, bx.maxY, cz, sx / 2 + 0.08, 0.45, sz / 2 + 0.08, st.stone2);
  // 两面刻字：3 列 × 5 字
  const faceX = sx < sz;
  const glyph = c.hot ? st.glow : st.trim;
  const key: MatKey = c.hot ? 'glow' : 'rough';
  for (const s of [-1, 1]) {
    for (let col = 0; col < 3; col++) {
      const u = (col - 1) * wide * 0.26;
      for (let k = 0; k < 5; k++) {
        const y = y0 + h * 0.78 - k * h * 0.14;
        if (faceX) b.box(key, cx + s * (sx / 2 + 0.01), y, cz + u, 0.03, 0.14, 0.12, glyph);
        else b.box(key, cx + u, y, cz + s * (sz / 2 + 0.01), 0.12, 0.14, 0.03, glyph);
      }
    }
  }
}

function counter(c: Ctx, bx: LayoutBox): void {
  const { b, st } = c;
  b.boxMM('wood', bx.minX, 0, bx.minZ, bx.maxX, bx.maxY - 0.08, bx.maxZ, st.wood);
  b.boxMM('wood', bx.minX - 0.06, bx.maxY - 0.08, bx.minZ - 0.06, bx.maxX + 0.06, bx.maxY, bx.maxZ + 0.06, st.woodDark);
  ring(c, 'wood', bx, 0, 0.12, 0.03, st.woodDark);
}
