/**
 * 程序化 CanvasTexture（不使用外部图片）：砖石、木板、三种主题地面（含熔岩裂缝自发光贴图）、地面法阵。
 * 所有贴图都可无缝平铺。纹理由调用者负责 dispose。
 */
import * as THREE from 'three';
import type { ThemeDef, ThemeId } from '../core/types';
import type { ThemeStyle } from './Themes';

type Rand = () => number;
type Ctx2D = CanvasRenderingContext2D;

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return [c, g];
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, repeat: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function css(hex: number, mul = 1, alpha = 1): string {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * mul));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * mul));
  const b = Math.min(255, Math.round((hex & 255) * mul));
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

function gray(v: number, alpha = 1): string {
  const c = Math.max(0, Math.min(255, Math.round(v * 255)));
  return alpha >= 1 ? `rgb(${c},${c},${c})` : `rgba(${c},${c},${c},${alpha})`;
}

/** 在四周偏移处重复绘制，保证无缝平铺 */
function wrapDraw(size: number, x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const px = x + ox;
      const py = y + oy;
      if (px + r < 0 || py + r < 0 || px - r > size || py - r > size) continue;
      fn(px, py);
    }
  }
}

function speckle(g: Ctx2D, size: number, rand: Rand, count: number, light: string, dark: string, maxS = 2): void {
  for (let i = 0; i < count; i++) {
    g.fillStyle = rand() < 0.5 ? light : dark;
    const s = 1 + Math.floor(rand() * maxS);
    g.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), s, s);
  }
}

function blob(g: Ctx2D, size: number, x: number, y: number, r: number, color: string, clear: string): void {
  wrapDraw(size, x, y, r, (px, py) => {
    const grd = g.createRadialGradient(px, py, 0, px, py, r);
    grd.addColorStop(0, color);
    grd.addColorStop(1, clear);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(px, py, r, 0, Math.PI * 2);
    g.fill();
  });
}

/** 随机折线（裂缝） */
function crack(g: Ctx2D, size: number, rand: Rand, x: number, y: number, len: number, width: number, style: string, glow = 0): void {
  const pts: [number, number][] = [[x, y]];
  let a = rand() * Math.PI * 2;
  let cx = x;
  let cy = y;
  const segs = 4 + Math.floor(rand() * 5);
  for (let i = 0; i < segs; i++) {
    a += (rand() - 0.5) * 1.3;
    const l = (len / segs) * (0.6 + rand() * 0.8);
    cx += Math.cos(a) * l;
    cy += Math.sin(a) * l;
    pts.push([cx, cy]);
  }
  wrapDraw(size, x, y, len + 10, (px, py) => {
    const ox = px - x;
    const oy = py - y;
    g.save();
    g.strokeStyle = style;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (glow > 0) {
      g.shadowColor = style;
      g.shadowBlur = glow;
    }
    g.beginPath();
    g.moveTo(pts[0][0] + ox, pts[0][1] + oy);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + ox, pts[i][1] + oy);
    g.stroke();
    g.restore();
  });
}

// ───────────────────────────── 砖石 / 木板（灰度，乘顶点色） ─────────────────────────────

/** 顺砌石块：一张 = 2m × 2m，块高 0.5m、宽 1m */
export function makeStoneTexture(rand: Rand): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = gray(0.58);
  g.fillRect(0, 0, S, S);
  const rowH = S / 4;
  const bw = S / 2;
  for (let row = 0; row < 4; row++) {
    const off = row % 2 === 0 ? 0 : bw / 2;
    for (let k = -1; k < 3; k++) {
      const x = k * bw + off;
      const v = 0.84 + rand() * 0.14;
      g.fillStyle = gray(v);
      g.fillRect(x + 3, row * rowH + 3, bw - 6, rowH - 6);
      // 上沿高光 / 下沿阴影
      g.fillStyle = gray(Math.min(1, v + 0.08));
      g.fillRect(x + 3, row * rowH + 3, bw - 6, 3);
      g.fillStyle = gray(v - 0.12);
      g.fillRect(x + 3, row * rowH + rowH - 6, bw - 6, 3);
    }
  }
  speckle(g, S, rand, 2600, gray(1, 0.18), gray(0, 0.14));
  for (let i = 0; i < 7; i++) crack(g, S, rand, rand() * S, rand() * S, 18 + rand() * 30, 1.2, gray(0.35, 0.6));
  return toTexture(c, true, true);
}

/** 竖向木板：一张 = 1.5m */
export function makeWoodTexture(rand: Rand): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S, S);
  const planks = 4;
  const pw = S / planks;
  for (let i = 0; i < planks; i++) {
    const v = 0.78 + rand() * 0.18;
    g.fillStyle = gray(v);
    g.fillRect(i * pw, 0, pw, S);
    // 木纹
    for (let k = 0; k < 7; k++) {
      g.strokeStyle = gray(v - 0.1 - rand() * 0.08, 0.7);
      g.lineWidth = 1;
      const x = i * pw + 3 + rand() * (pw - 6);
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (rand() - 0.5) * 6, S * 0.33, x + (rand() - 0.5) * 6, S * 0.66, x, S);
      g.stroke();
    }
    g.fillStyle = gray(0.35);
    g.fillRect(i * pw, 0, 2, S);
    // 钉子
    g.fillStyle = gray(0.3);
    g.fillRect(i * pw + pw / 2 - 1, 8, 3, 3);
    g.fillRect(i * pw + pw / 2 - 1, S - 11, 3, 3);
  }
  return toTexture(c, true, true);
}

// ───────────────────────────── 地面 ─────────────────────────────

export interface FloorTextures {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture | null;
  /** 一张纹理对应的米数 */
  tile: number;
}

/** 主题地面：一张 = 8m × 8m，512px */
export function makeFloorTextures(id: ThemeId, theme: ThemeDef, st: ThemeStyle, rand: Rand): FloorTextures {
  const S = 512;
  const [c, g] = canvas(S, S);
  const tileM = 8;
  const px = S / tileM; // 每米像素
  let emissive: THREE.CanvasTexture | null = null;

  if (id === 'desert') {
    g.fillStyle = css(theme.floor);
    g.fillRect(0, 0, S, S);
    speckle(g, S, rand, 9000, css(theme.floor, 1.12), css(theme.floor, 0.86));
    // 残破的砂岩铺地（2m 一块）
    const t = px * 2;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (rand() < 0.3) continue;
        const v = 0.92 + rand() * 0.14;
        g.fillStyle = css(st.paving, v);
        g.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
        g.strokeStyle = css(st.trim, 1, 0.55);
        g.lineWidth = 2;
        g.strokeRect(i * t + 3, j * t + 3, t - 6, t - 6);
        if (rand() < 0.5) crack(g, S, rand, i * t + rand() * t, j * t + rand() * t, t * 0.5, 1.5, css(st.trim, 1, 0.5));
      }
    }
    speckle(g, S, rand, 3000, css(st.paving, 1.1, 0.5), css(st.trim, 1, 0.25));
    // 风沙半掩
    for (let i = 0; i < 16; i++) blob(g, S, rand() * S, rand() * S, 30 + rand() * 70, css(st.sand, 1, 0.55 + rand() * 0.35), css(st.sand, 1, 0));
    // 风纹
    g.strokeStyle = css(st.sand, 1.1, 0.35);
    g.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) {
      const y = rand() * S;
      const x = rand() * S;
      wrapDraw(S, x, y, 60, (qx, qy) => {
        g.beginPath();
        g.moveTo(qx - 50, qy);
        g.quadraticCurveTo(qx, qy - 6, qx + 50, qy);
        g.stroke();
      });
    }
  } else if (id === 'frost') {
    g.fillStyle = css(theme.floor);
    g.fillRect(0, 0, S, S);
    // 青灰石板
    const t = px * 2;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const v = 0.9 + rand() * 0.15;
        g.fillStyle = css(st.paving, v);
        g.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
        g.strokeStyle = css(st.trim, 1, 0.6);
        g.lineWidth = 3;
        g.strokeRect(i * t + 2, j * t + 2, t - 4, t - 4);
      }
    }
    speckle(g, S, rand, 5000, css(st.paving, 1.15, 0.6), css(st.trim, 1, 0.25));
    // 积雪覆盖
    for (let i = 0; i < 22; i++) blob(g, S, rand() * S, rand() * S, 34 + rand() * 80, css(st.snow, 1, 0.7 + rand() * 0.3), css(st.snow, 1, 0));
    // 冰面反光斑
    for (let i = 0; i < 5; i++) blob(g, S, rand() * S, rand() * S, 20 + rand() * 30, css(st.ice, 1, 0.25), css(st.ice, 1, 0));
    speckle(g, S, rand, 2200, 'rgba(255,255,255,0.9)', 'rgba(170,195,220,0.35)', 1);
  } else {
    g.fillStyle = css(theme.floor);
    g.fillRect(0, 0, S, S);
    speckle(g, S, rand, 9000, css(theme.floor, 1.25), css(theme.floor, 0.7));
    // 不规则玄武岩板（格点抖动的四边形）
    const n = 5;
    const cell = S / n;
    const jx: number[] = [];
    const jy: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        jx.push((rand() - 0.5) * cell * 0.35);
        jy.push((rand() - 0.5) * cell * 0.35);
      }
    }
    const corner = (i: number, j: number): [number, number] => {
      const k = ((j % n) + n) % n * n + (((i % n) + n) % n);
      return [i * cell + jx[k], j * cell + jy[k]];
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const q = [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)];
        const v = 0.85 + rand() * 0.3;
        wrapDraw(S, 0, 0, S, (ox, oy) => {
          g.fillStyle = css(st.paving, v);
          g.strokeStyle = css(st.trim);
          g.lineWidth = 4;
          g.beginPath();
          g.moveTo(q[0][0] + ox, q[0][1] + oy);
          for (let k = 1; k < 4; k++) g.lineTo(q[k][0] + ox, q[k][1] + oy);
          g.closePath();
          g.fill();
          g.stroke();
        });
      }
    }
    speckle(g, S, rand, 3000, css(st.paving, 1.3, 0.5), 'rgba(0,0,0,0.3)');
    // 熔岩裂缝：颜色贴图画暗红底，自发光贴图画亮线
    const [ec, eg] = canvas(S, S);
    eg.fillStyle = '#000';
    eg.fillRect(0, 0, S, S);
    const cracks: { x: number; y: number; len: number; seed: number }[] = [];
    for (let i = 0; i < 14; i++) cracks.push({ x: rand() * S, y: rand() * S, len: 50 + rand() * 110, seed: rand() });
    for (const k of cracks) {
      // 同一条裂缝在颜色贴图与自发光贴图上必须走同一条折线：用相同种子的小随机数
      const seq = (): Rand => {
        let s = Math.floor(k.seed * 233280);
        return () => {
          s = (s * 9301 + 49297) % 233280;
          return s / 233280;
        };
      };
      crack(g, S, seq(), k.x, k.y, k.len, 5, 'rgb(70,18,8)');
      crack(eg, S, seq(), k.x, k.y, k.len, 2.6, css(st.glow), 8);
      crack(eg, S, seq(), k.x, k.y, k.len, 1, css(st.glowHot));
    }
    for (let i = 0; i < 10; i++) blob(eg, S, rand() * S, rand() * S, 6 + rand() * 10, css(st.glow, 1, 0.8), css(st.glow, 1, 0));
    emissive = toTexture(ec, true, true);
  }

  return { map: toTexture(c, true, true), emissive, tile: tileM };
}

// ───────────────────────────── 法阵 ─────────────────────────────

/** 白色法阵（透明底），用材质颜色着色 */
export function makeRuneTexture(rand: Rand): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const cx = S / 2;
  const R = S / 2 - 6;
  g.translate(cx, cx);
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.shadowColor = '#fff';
  g.shadowBlur = 6;
  const ring = (r: number, w: number): void => {
    g.lineWidth = w;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  };
  ring(R, 5);
  ring(R - 14, 2);
  ring(R * 0.62, 3);
  ring(R * 0.58, 1.5);
  ring(R * 0.22, 3);
  // 外圈刻度与符文
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    g.save();
    g.rotate(a);
    g.lineWidth = i % 4 === 0 ? 3 : 1.5;
    g.beginPath();
    g.moveTo(R - 14, 0);
    g.lineTo(R - (i % 4 === 0 ? 34 : 24), 0);
    g.stroke();
    if (i % 2 === 1) {
      // 抽象篆纹：几段短横竖
      g.translate(R - 50, 0);
      g.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const dx = (rand() - 0.5) * 12;
        const dy = (rand() - 0.5) * 12;
        g.beginPath();
        g.moveTo(dx, dy);
        g.lineTo(dx + (rand() < 0.5 ? 10 : 0), dy + (rand() < 0.5 ? 0 : 10));
        g.stroke();
      }
    }
    g.restore();
  }
  // 八卦方位：八边形 + 放射线
  g.lineWidth = 2.5;
  g.beginPath();
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * R * 0.52;
    const y = Math.sin(a) * R * 0.52;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.save();
    g.rotate(a);
    for (let k = 0; k < 3; k++) {
      const broken = rand() < 0.5;
      const y = -8 + k * 8;
      const x0 = R * 0.26;
      const x1 = R * 0.46;
      g.lineWidth = 4;
      g.beginPath();
      if (broken) {
        g.moveTo(x0, y);
        g.lineTo((x0 + x1) / 2 - 4, y);
        g.moveTo((x0 + x1) / 2 + 4, y);
        g.lineTo(x1, y);
      } else {
        g.moveTo(x0, y);
        g.lineTo(x1, y);
      }
      g.stroke();
    }
    g.restore();
  }
  // 中心太极
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, R * 0.14, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(0, -R * 0.07, R * 0.07, -Math.PI / 2, Math.PI / 2);
  g.arc(0, R * 0.07, R * 0.07, -Math.PI / 2, Math.PI / 2, true);
  g.arc(0, 0, R * 0.14, Math.PI / 2, -Math.PI / 2);
  g.fill();
  return toTexture(c, true, false);
}
