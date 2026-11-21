/**
 * 精英头顶印章（照译 Unity G/UI/Widgets/EliteSeal.cs + EliteSealTextures.cs；挂在 EnemyBars 的精英血条顶上）：
 * 小体型精英在 10 m 外，脚下金环只剩几十个像素——印章把「精英 + 哪种词缀」竖起来放到头顶，远处也读得出。
 *   · 样子：鎏金印章（墨底 + 粗金带 + 四颗菱形钉 + 底下朝下的金尖），里面套词缀纹样（词缀色）；没有词缀的是一颗四芒金星。
 *   · 距离：NearHide m 以内不画，到 NearFull m 淡满；屏幕上的宽度按距离从 PxNear 涨到 PxFar 像素（抵掉血条随距离缩小）。
 *   · 准星：印章中心离屏幕中心 AimClear 像素以内时淡到 AimAlpha。
 * 贴图：框与四芒星照 C# 的有向距离函数逐像素合成（2×2 超采样），「明度 + 覆盖」着色成 data URL，全场共用。
 * 网页差异：词缀纹样（Unity EliteSigilTextures，随金环一起属 M11b）这里用 canvas 画同一套形状语言的简化版——
 *   迅捷三道卷云钩、坚盾六角龟甲 + 角钉、爆裂十六芒星、狂暴十二颗向内獠牙；亮度不跟金环的 Level（网页金环没有这个量），固定 1。
 * 纯函数（fadeAt / pixelsAt / aimFade、常量）不碰 DOM，测试直接调。
 */
import type { RGBA } from '../toolkit/UITheme';

export const SEAL_TEX_W = 96, SEAL_TEX_H = 112;
/** 设计尺寸（面板像素）：宽 × 高（高里含金尖） */
export const SEAL_WIDTH = 32, SEAL_HEIGHT = (SEAL_WIDTH * SEAL_TEX_H) / SEAL_TEX_W;
/** 近处隐藏 / 淡满的距离（米） */
export const NearHide = 6, NearFull = 9;
/** 屏幕上的宽度（面板像素）：NearFull 处 → FarAt 处 */
export const PxNear = 30, PxFar = 35, FarAt = 30;
/** 离准星多近开始让（面板像素）、让到多淡 */
export const AimClear = 70, AimTight = 30, AimAlpha = 0.35;
const Gap = 2;
/** 内圈墨底的半径（贴图单位：1 = 半宽） */
const Inner = 0.84;
const TipDepth = (SEAL_TEX_H - SEAL_TEX_W * 0.5) / (SEAL_TEX_W * 0.5);
/** 金框的颜色（金环同色 #ffc233） */
export const SealGold: RGBA = [1, 0.76, 0.2, 1];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const invLerp = (a: number, b: number, v: number) => clamp01((v - a) / (b - a));

/** 距离淡入：NearHide 以内 0，到 NearFull 满（smoothstep） */
export function fadeAt(dist: number): number {
  const t = clamp01((dist - NearHide) / (NearFull - NearHide));
  return t * t * (3 - 2 * t);
}

/** 屏幕上的宽度（面板像素）：NearFull → FarAt 从 PxNear 涨到 PxFar */
export function pixelsAt(dist: number): number {
  return PxNear + (PxFar - PxNear) * invLerp(NearFull, FarAt, dist);
}

/** 离准星的让位：AimClear 像素以外 1，AimTight 以内 AimAlpha */
export function aimFade(pxFromCenter: number): number {
  return AimAlpha + (1 - AimAlpha) * invLerp(AimTight, AimClear, pxFromCenter);
}

// ───────────── 贴图（明度 + 覆盖）─────────────

type LA = [number, number];
const cover = (sd: number, aa: number) => clamp01(0.5 - sd / aa);

function over(under: LA, lum: number, alpha: number): LA {
  const a = alpha + under[1] * (1 - alpha);
  if (a < 1e-5) return [0, 0];
  return [(lum * alpha + under[0] * under[1] * (1 - alpha)) / a, a];
}

function sdTip(x: number, y: number, hw: number, tip: number): number {
  const top = -0.78;
  const t = clamp01((top - y) / (top - tip));
  const side = (Math.abs(x) - hw * (1 - t)) * 0.9;
  return Math.max(side, Math.max(y - top, tip - y));
}

function sdDiamond(dx: number, dy: number, rx: number, ry: number, ru: number, rv: number): number {
  const u = Math.abs(dx * rx + dy * ry), v = Math.abs(dx * -ry + dy * rx);
  return (u / ru + v / rv - 1) * Math.min(ru, rv) * 0.7;
}

/** 印章框：圆形墨底、贴外缘的金带（外亮内暗一档）、四颗菱形钉、朝下的金尖，整个外轮廓一道墨边 */
export function framePixel(x: number, y: number): LA {
  const aa = 2.4 / (SEAL_TEX_W * 0.5);
  const r = Math.hypot(x, y);
  const tipY = -TipDepth + 0.04;
  let c = over([0, 0], 0, cover(Math.min(r - 0.985, sdTip(x, y, 0.4, tipY)), aa) * 0.93);
  c = over(c, 0.92, cover(sdTip(x, y, 0.3, tipY + 0.1), aa));
  c = over(c, r >= 0.9 ? 1 : 0.76, cover(Math.abs(r - 0.9) - 0.06, aa));
  for (let k = 0; k < 4; k++) {
    const ak = Math.PI * 0.25 + k * Math.PI * 0.5;
    const rx = Math.cos(ak), ry = Math.sin(ak);
    const sd = sdDiamond(x - rx * 0.9, y - ry * 0.9, rx, ry, 0.17, 0.12);
    c = over(c, 0, cover(sd - 0.04, aa) * 0.9);
    c = over(c, 1, cover(sd, aa));
  }
  return c;
}

/** 四芒金星：竖长横短，中心一点墨，墨边托底 */
export function corePixel(x: number, y: number): LA {
  const aa = 2.4 / 32;
  const star = Math.min(sdDiamond(x, y, 0, 1, 0.95, 0.34), sdDiamond(x, y, 1, 0, 0.62, 0.34));
  let c = over([0, 0], 0, cover(star - 0.07, aa) * 0.92);
  c = over(c, y > 0 ? 1 : 0.8, cover(star, aa));
  c = over(c, 0, cover(Math.hypot(x, y) - 0.1, aa) * 0.9);
  return c;
}

const urlCache = new Map<string, string>();

/** 逐像素合成并着色（白 = tint、黑 = 墨）→ data URL；没有 canvas（测试）时返回空串 */
function bake(key: string, w: number, h: number, pixel: (x: number, y: number) => LA, tint: RGBA): string {
  const k = `${key}/${tint.map((v) => Math.round(v * 255)).join(',')}`;
  const hit = urlCache.get(k);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    if (g) {
      const img = g.createImageData(w, h);
      const half = w * 0.5;
      for (let py = 0; py < h; py++)
        for (let px = 0; px < w; px++) {
          let a = 0, l = 0;
          for (let sy = 0; sy < 2; sy++)
            for (let sx = 0; sx < 2; sx++) {
              // 贴图单位：x 以中线为 0、半宽为 1；y 以圆心为 0、往上为正（圆心离顶边半宽；canvas 的 y 向下）
              const c = pixel((px + 0.25 + sx * 0.5 - half) / half, (half - (py + 0.25 + sy * 0.5)) / half);
              l += c[0] * c[1];
              a += c[1];
            }
          const lum = a > 1e-4 ? l / a : 0, i = (py * w + px) * 4;
          img.data[i] = Math.round(lum * tint[0] * 255);
          img.data[i + 1] = Math.round(lum * tint[1] * 255);
          img.data[i + 2] = Math.round(lum * tint[2] * 255);
          img.data[i + 3] = Math.round((a / 4) * 255);
        }
      g.putImageData(img, 0, 0);
      url = cv.toDataURL('image/png');
    }
  } catch {
    url = '';
  }
  urlCache.set(k, url);
  return url;
}

/** 词缀纹样（简化版，墨边 + 词缀色）；不认识的词缀退回四芒金星 */
function sigilUrl(affix: string, tint: RGBA): string {
  const k = `sigil-${affix}/${tint.map((v) => Math.round(v * 255)).join(',')}`;
  const hit = urlCache.get(k);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    const S = 96;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    if (g) {
      g.translate(S / 2, S / 2);
      g.scale(S / 2, S / 2);
      g.lineJoin = g.lineCap = 'round';
      const color = `rgb(${Math.round(tint[0] * 255)},${Math.round(tint[1] * 255)},${Math.round(tint[2] * 255)})`;
      const pass = (draw: (ink: boolean) => void) => {
        g.strokeStyle = g.fillStyle = 'rgba(6,5,8,0.92)';
        draw(true);
        g.strokeStyle = g.fillStyle = color;
        draw(false);
      };
      if (affix === 'swift') {
        // 三道卷云钩
        pass((ink) => {
          g.lineWidth = ink ? 0.3 : 0.17;
          for (let i = 0; i < 3; i++) {
            const a = (i * Math.PI * 2) / 3;
            g.beginPath();
            g.arc(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.52, a - 0.35, a + 1.9);
            g.stroke();
          }
        });
      } else if (affix === 'shielded') {
        // 六角龟甲框 + 六颗角钉
        pass((ink) => {
          g.lineWidth = ink ? 0.3 : 0.16;
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = Math.PI / 6 + (i * Math.PI) / 3;
            g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 0.62, Math.sin(a) * 0.62);
          }
          g.closePath();
          g.stroke();
          for (let i = 0; i < 6; i++) {
            const a = Math.PI / 6 + (i * Math.PI) / 3;
            g.beginPath();
            g.arc(Math.cos(a) * 0.62, Math.sin(a) * 0.62, ink ? 0.17 : 0.1, 0, Math.PI * 2);
            g.fill();
          }
          g.beginPath();
          g.arc(0, 0, ink ? 0.2 : 0.13, 0, Math.PI * 2);
          g.fill();
        });
      } else if (affix === 'volatile') {
        // 长短相间的十六芒火药星
        pass((ink) => {
          const grow = ink ? 0.08 : 0;
          g.beginPath();
          for (let i = 0; i < 32; i++) {
            const a = (i * Math.PI) / 16;
            const r = i % 2 ? 0.26 + grow : (i % 4 ? 0.6 : 0.86) + grow;
            g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
          }
          g.closePath();
          g.fill();
        });
      } else if (affix === 'frenzied') {
        // 十二颗向内的锯齿獠牙
        pass((ink) => {
          const grow = ink ? 0.06 : 0;
          for (let i = 0; i < 12; i++) {
            const a = (i * Math.PI) / 6, w = 0.2 + grow;
            g.beginPath();
            g.moveTo(Math.cos(a - w) * (0.84 + grow), Math.sin(a - w) * (0.84 + grow));
            g.lineTo(Math.cos(a + w) * (0.84 + grow), Math.sin(a + w) * (0.84 + grow));
            g.lineTo(Math.cos(a + 0.1) * (0.3 - grow), Math.sin(a + 0.1) * (0.3 - grow));
            g.closePath();
            g.fill();
          }
        });
      } else {
        urlCache.set(k, (url = bake('core', 64, 64, corePixel, tint)));
        return url;
      }
      url = cv.toDataURL('image/png');
    }
  } catch {
    url = '';
  }
  urlCache.set(k, url);
  return url;
}

const KNOWN = new Set(['swift', 'shielded', 'volatile', 'frenzied']);

export class EliteSeal {
  readonly root: HTMLDivElement;
  private readonly inner: HTMLDivElement;
  private shown = '\0';
  private alphaV = -1;
  private scaleV = -1;
  private on = false;
  /** 这一帧在屏幕上的宽度（面板像素，不含锚点透明度） */
  pixels = 0;

  constructor(bar: HTMLElement) {
    const root = (this.root = document.createElement('div'));
    root.className = 'sf-ebar__seal';
    root.dataset.name = 'elite-seal';
    const s = root.style;
    s.position = 'absolute';
    s.left = '50%';
    s.bottom = '100%';
    s.width = `${SEAL_WIDTH}px`;
    s.height = `${SEAL_HEIGHT}px`;
    s.marginLeft = `${-SEAL_WIDTH * 0.5}px`;
    s.marginBottom = `${Gap}px`;
    s.transformOrigin = '50% 100%';
    s.backgroundSize = '100% 100%';
    s.pointerEvents = 'none';
    const inner = (this.inner = document.createElement('div'));
    inner.dataset.name = 'elite-seal-sigil';
    const d = SEAL_WIDTH * Inner;
    const si = inner.style;
    si.position = 'absolute';
    si.left = si.top = `${(SEAL_WIDTH - d) * 0.5}px`;
    si.width = si.height = `${d}px`;
    si.backgroundSize = '100% 100%';
    root.appendChild(inner);
    bar.appendChild(root);
    s.display = 'none';
  }

  /** 这一帧的不透明度（0 = 没画） */
  get alpha(): number {
    return this.alphaV < 0 ? 0 : this.alphaV;
  }

  /** 印章里画的是哪种词缀（'' = 四芒金星） */
  get sigil(): string {
    return this.shown === '\0' ? '' : this.shown;
  }

  /** 血条槽位分给一只敌人时调：精英挂印章（affix = 词缀 id，可空；color = 词缀色），不是精英藏起来 */
  bind(elite: boolean, affix: string | null, color: RGBA | null): void {
    this.on = elite;
    this.alphaV = this.scaleV = -1;
    this.pixels = 0;
    this.root.style.display = elite ? '' : 'none';
    this.root.style.opacity = '0';
    this.alphaV = 0;
    if (!elite) return;
    if (!this.root.style.backgroundImage) {
      const url = bake('frame', SEAL_TEX_W, SEAL_TEX_H, framePixel, SealGold);
      if (url) this.root.style.backgroundImage = `url(${url})`;
    }
    const sig = affix && KNOWN.has(affix) ? affix : '';
    if (sig !== this.shown) {
      this.shown = sig;
      const tint: RGBA = sig && color ? [color[0], color[1], color[2], 1] : SealGold;
      const url = sig ? sigilUrl(sig, tint) : bake('core', 64, 64, corePixel, tint);
      this.inner.style.backgroundImage = url ? `url(${url})` : '';
    }
  }

  unbind(): void {
    this.on = false;
    this.root.style.display = 'none';
  }

  /**
   * 每帧：dist = 到相机的距离（米），barScale = 血条这一帧的缩放，headX / headY = 锚点（头顶）的面板坐标，
   * panelX / panelY = 面板尺寸，barHeight = 血条的排版高度（设计像素）
   */
  tick(dist: number, barScale: number, headX: number, headY: number, panelX: number, panelY: number, barHeight: number): void {
    if (!this.on) return;
    const px = pixelsAt(dist);
    const k = px / SEAL_WIDTH / Math.max(0.05, barScale);
    if (Math.abs(k - this.scaleV) > 0.01) {
      this.scaleV = k;
      this.root.style.scale = `${k.toFixed(3)} ${k.toFixed(3)}`;
    }
    this.pixels = px;
    // 印章中心的面板坐标：头顶往上 = 血条高 × 缩放 + 空隙 + 半个印章
    const up = (Number.isFinite(barHeight) ? barHeight : 24) * barScale + Gap * barScale + ((px * SEAL_HEIGHT) / SEAL_WIDTH) * 0.5;
    const a = fadeAt(dist) * aimFade(Math.hypot(headX - panelX * 0.5, headY - up - panelY * 0.5));
    if (Math.abs(a - this.alphaV) > 0.02 || (a === 0) !== (this.alphaV === 0)) {
      this.alphaV = a;
      this.root.style.opacity = String(Math.round(a * 100) / 100);
    }
  }
}
