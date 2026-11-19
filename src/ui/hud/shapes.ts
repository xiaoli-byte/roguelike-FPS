/**
 * 矢量小件（照译 Unity HudArt.cs 的 RingElement / ArcElement：Unity 用 Painter2D 画，网页用内联 SVG）。
 *   RingElement 圆环：技能冷却环、换弹环、蓄力环。从 12 点钟方向顺时针画 progress（0..1），底下可选一圈淡轨道；值量化到 1/400，没变不重画。
 *   ArcElement  一段弧：受击方向弧、近战括号。中心角 center（度，0 = 正右、-90 = 正上，顺时针为正）、半宽 halfSpan；
 *               fade = 两端渐隐所占的比例（分 14 段画、alpha 往两端递减）。
 */
import { el } from '../toolkit/el';
import { type RGBA, css } from '../toolkit/UITheme';

const NS = 'http://www.w3.org/2000/svg';

function svg(size: number): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${size} ${size}`);
  return s;
}

function same(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export class RingElement {
  readonly el: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly trackEl: SVGCircleElement;
  private readonly progEl: SVGPathElement;
  private progress = 1;
  private width: number;
  private color: RGBA = [1, 1, 1, 1];
  private track: RGBA = [1, 1, 1, 0.08];
  private round = true;
  private size: number;
  private dirty = true;

  constructor(lineWidth: number, size: number, classes?: string) {
    this.el = el('sf-ring ' + (classes ?? ''));
    this.width = lineWidth;
    this.size = size;
    this.svg = svg(size);
    this.trackEl = document.createElementNS(NS, 'circle');
    this.trackEl.setAttribute('fill', 'none');
    this.progEl = document.createElementNS(NS, 'path');
    this.progEl.setAttribute('fill', 'none');
    this.svg.append(this.trackEl, this.progEl);
    this.el.appendChild(this.svg);
    this.redraw();
  }

  get Progress(): number {
    return this.progress;
  }

  set Progress(v: number) {
    const q = Math.round(Math.min(1, Math.max(0, Number.isNaN(v) ? 0 : v)) * 400) / 400;
    if (q === this.progress) return;
    this.progress = q;
    this.redraw();
  }

  get Color(): RGBA {
    return this.color;
  }

  set Color(c: RGBA) {
    if (same(c, this.color)) return;
    this.color = c;
    this.redraw();
  }

  set Track(c: RGBA) {
    if (same(c, this.track)) return;
    this.track = c;
    this.redraw();
  }

  set RoundCap(v: boolean) {
    this.round = v;
    this.redraw();
  }

  /** 元素尺寸（设计像素）变了 */
  setSize(size: number): void {
    if (size === this.size) return;
    this.size = size;
    this.svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    this.redraw();
  }

  private redraw(): void {
    const rad = this.size * 0.5 - this.width * 0.5;
    const c = this.size * 0.5;
    if (rad <= 0.5) return;
    const t = this.trackEl;
    t.setAttribute('cx', String(c));
    t.setAttribute('cy', String(c));
    t.setAttribute('r', String(rad));
    t.setAttribute('stroke-width', String(this.width));
    t.setAttribute('stroke', css(this.track));
    t.style.display = this.track[3] > 0.001 ? '' : 'none';
    const p = this.progEl;
    if (this.progress <= 0.0025 || this.color[3] <= 0.001) {
      p.setAttribute('d', '');
      return;
    }
    p.setAttribute('stroke', css(this.color));
    p.setAttribute('stroke-width', String(this.width));
    p.setAttribute('stroke-linecap', this.round && this.progress < 0.999 ? 'round' : 'butt');
    p.setAttribute('d', this.progress >= 0.999 ? circlePath(c, c, rad) : arcPath(c, c, rad, -90, -90 + 360 * Math.min(this.progress, 0.9999)));
    this.dirty = false;
  }
}

export class ArcElement {
  readonly el: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly segs: SVGPathElement[] = [];
  private center = -90;
  private halfSpan = 24;
  private fade = 0.7;
  private width = 6;
  private inset = 0;
  private color: RGBA = [1, 0, 0, 1];
  private size: number;
  static readonly Segments = 14;

  constructor(size: number, classes?: string) {
    this.el = el('sf-arc ' + (classes ?? ''));
    this.size = size;
    this.svg = svg(size);
    for (let i = 0; i < ArcElement.Segments; i++) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke-linecap', 'butt');
      this.segs.push(p);
      this.svg.appendChild(p);
    }
    this.el.appendChild(this.svg);
  }

  get Color(): RGBA {
    return this.color;
  }

  set Color(c: RGBA) {
    if (same(c, this.color)) return;
    this.color = c;
    this.redraw();
  }

  /** 设参数（变了才重画） */
  set(centerDeg: number, halfSpanDeg: number, fadeFraction: number, lineWidth: number, c: RGBA, inset = 0): void {
    if (this.center === centerDeg && this.halfSpan === halfSpanDeg && this.fade === fadeFraction && this.width === lineWidth && same(c, this.color) && this.inset === inset) return;
    this.center = centerDeg;
    this.halfSpan = halfSpanDeg;
    this.fade = Math.min(1, Math.max(0, fadeFraction));
    this.width = lineWidth;
    this.color = c;
    this.inset = inset;
    this.redraw();
  }

  setSize(size: number): void {
    if (Math.abs(size - this.size) < 0.01) return;
    this.size = size;
    this.svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    this.redraw();
  }

  private redraw(): void {
    const rad = this.size * 0.5 - this.width * 0.5 - this.inset;
    const c = this.size * 0.5;
    const hide = rad <= 0.5 || this.color[3] <= 0.001;
    if (this.fade <= 0.001) {
      for (let i = 0; i < this.segs.length; i++) {
        const p = this.segs[i];
        if (i > 0 || hide) {
          p.setAttribute('d', '');
          continue;
        }
        p.setAttribute('stroke', css(this.color));
        p.setAttribute('stroke-width', String(this.width));
        p.setAttribute('d', arcPath(c, c, rad, this.center - this.halfSpan, this.center + this.halfSpan));
      }
      return;
    }
    // 分段：中间 (1 - fade) 实，两端线性淡到 0
    const a0 = this.center - this.halfSpan, step = (this.halfSpan * 2) / ArcElement.Segments;
    const solid = 1 - this.fade;
    for (let i = 0; i < this.segs.length; i++) {
      const p = this.segs[i];
      const mid = a0 + (i + 0.5) * step;
      const k = Math.abs(mid - this.center) / this.halfSpan; // 0 = 中心，1 = 端点
      const alpha = k <= solid ? 1 : 1 - (k - solid) / Math.max(0.001, this.fade);
      if (hide || alpha <= 0.01) {
        p.setAttribute('d', '');
        continue;
      }
      p.setAttribute('stroke', css(this.color, alpha));
      p.setAttribute('stroke-width', String(this.width));
      p.setAttribute('d', arcPath(c, c, rad, a0 + i * step, a0 + (i + 1) * step + 0.4));
    }
  }
}

/** 圆弧路径：角度（度，0 = 正右，顺时针为正——屏幕坐标 y 向下） */
export function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const a = (fromDeg * Math.PI) / 180, b = (toDeg * Math.PI) / 180;
  const x0 = cx + r * Math.cos(a), y0 = cy + r * Math.sin(a);
  const x1 = cx + r * Math.cos(b), y1 = cy + r * Math.sin(b);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  const sweep = toDeg > fromDeg ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function circlePath(cx: number, cy: number, r: number): string {
  return `${arcPath(cx, cy, r, -90, 90)}${arcPath(cx, cy, r, 90, 270).replace(/^M[^A]*/, '')}`;
}
