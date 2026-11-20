/**
 * 狙击镜遮罩（照译 Unity G/UI/Widgets/ScopeOverlay.cs）：进了镜（视角层 < −30°，只有鹰隼狙击的 −45° 够得到）且游戏在跑时显示——
 * 全屏黑底挖出 70vmin 的圆形镜口（内缘一圈暗影）、镜口细金边 + 外圈黑环、十字细线 + 外侧四根粗柱、
 * 两轴各 4 个密位点（±5 / ±10 vmin）、中心朱红点。淡入 0.12 s，镜口从 1.06 倍收到 1。
 * 显示期间把准星收起（CrosshairWidget.suppressed），换弹环 / 命中标记照常。层序 35：在准星（40）之下、受击暗角（10）之上。
 * Unity 的 Painter2D 在网页换成 canvas 2D（按面板的设计像素画，随四层一起缩放）。
 */
import { CinnabarHi, css } from '../toolkit/UITheme';
import { damp, el } from '../toolkit/el';
import { CrosshairWidget } from './CrosshairWidget';
import { type HudFrame, HudWidget } from './HudWidget';

/** 淡入 / 淡出时长（秒，不缩放时间） */
export const SCOPE_FADE = 0.12;
/** 视角层低于它算进镜（同 Unity WeaponSight.Scoped） */
export const SCOPE_KICK = -30;
const ZoomFrom = 1.06;

/** 进镜判定（纯函数，测试用） */
export function isScoped(playing: boolean, hasWeapon: boolean, alive: boolean, fovKick: number): boolean {
  return playing && hasWeapon && alive && fovKick < SCOPE_KICK;
}

export class ScopeOverlay extends HudWidget {
  readonly id = 'scope';
  override readonly order = 35;

  private canvas!: HTMLCanvasElement;
  private alpha = 0;
  private shownAlpha = -1;
  private zoom = ZoomFrom;
  private drawnZoom = -1;
  private drawnW = 0;
  private drawnH = 0;
  private scopedV = false;
  private suppressing = false;

  /** 镜内（遮罩在显示 / 淡入中；测试用） */
  get scoped(): boolean {
    return this.scopedV;
  }

  protected build(): HTMLElement {
    const root = el('sf-scope');
    root.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;opacity:0;display:none;';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;';
    root.appendChild(this.canvas);
    return root;
  }

  protected override onDetach(): void {
    this.suppress(false);
  }

  override resetState(): void {
    this.scopedV = false;
    this.alpha = 0;
    this.zoom = ZoomFrom;
    this.apply();
    this.suppress(false);
  }

  override tick(f: HudFrame): void {
    const g = this.game;
    const p = g.player;
    const on = isScoped(f.playing, !!g.weapons?.active, !!p && p.hp > 0, g.cameraFx.fovKick);
    this.scopedV = on;
    this.suppress(on);
    const dt = Math.max(0, f.unscaledDt);
    const step = dt / SCOPE_FADE;
    this.alpha = on ? Math.min(1, this.alpha + step) : Math.max(0, this.alpha - step);
    // 镜口：进镜时从 1.06 收到 1，退镜后复位，下次进镜再收一次
    this.zoom = on ? damp(this.zoom, 1, 16, dt) : ZoomFrom;
    this.apply();
  }

  private apply(): void {
    if (!this.root) return;
    const a = Math.round(this.alpha * 50) / 50;
    if (a !== this.shownAlpha) {
      this.shownAlpha = a;
      this.root.style.opacity = String(a);
      this.root.style.display = a > 0 ? '' : 'none';
    }
    if (a <= 0) return;
    const z = Math.round(this.zoom * 400) / 400;
    const size = this.ctx.panelSize;
    const w = Math.round(size.x), h = Math.round(size.y);
    if (z === this.drawnZoom && w === this.drawnW && h === this.drawnH) return;
    this.drawnZoom = z;
    this.drawnW = w;
    this.drawnH = h;
    this.draw(w, h, z);
  }

  private suppress(on: boolean): void {
    if (on === this.suppressing) return;
    this.suppressing = on;
    const x = this.ctx?.widget(CrosshairWidget);
    if (x) x.suppressed = on;
  }

  /** 镜内画面：尺寸按 vmin（较短边的 1%）；黑底挖圆（镜口半径 35 vmin 固定），其余乘 zoom */
  private draw(w: number, h: number, zoom: number): void {
    const cv = this.canvas;
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const p = cv.getContext('2d');
    if (!p || w < 2 || h < 2) return;
    p.clearRect(0, 0, w, h);
    const vmin = Math.min(w, h) / 100;
    const cx = w / 2, cy = h / 2;
    const hole = 35 * vmin, R = hole * zoom;
    const TAU = Math.PI * 2;

    p.fillStyle = 'rgba(0,0,0,0.97)';
    p.beginPath();
    p.rect(-2, -2, w + 4, h + 4);
    p.arc(cx, cy, hole, 0, TAU);
    p.fill('evenodd');

    const circle = (radius: number, width: number, color: string) => {
      if (radius <= 0.5) return;
      p.lineWidth = width;
      p.strokeStyle = color;
      p.beginPath();
      p.arc(cx, cy, radius, 0, TAU);
      p.stroke();
    };
    // 镜口内缘的暗影：几圈由外向内渐淡的描边
    const rings = 6, band = 6 * vmin * zoom;
    for (let i = 0; i < rings; i++) {
      const t = (i + 0.5) / rings;
      circle(R - band * t, band / rings + 0.5, `rgba(0,0,0,${(0.72 * (1 - t) * (1 - t)).toFixed(3)})`);
    }
    // 外圈黑环 3 px + 细金边 1 px
    circle(R + 1.5, 3, 'rgba(0,0,0,0.9)');
    circle(R, 1, 'rgba(212,169,85,0.28)');

    const line = (x0: number, y0: number, x1: number, y1: number, width: number, color: string) => {
      p.lineWidth = width;
      p.strokeStyle = color;
      p.beginPath();
      p.moveTo(x0, y0);
      p.lineTo(x1, y1);
      p.stroke();
    };
    // 十字细线（贯穿镜口）+ 外侧粗柱（长 30% 镜口直径，宽 5 px）
    p.lineCap = 'butt';
    line(cx - R, cy, cx + R, cy, 1, 'rgba(0,0,0,0.85)');
    line(cx, cy - R, cx, cy + R, 1, 'rgba(0,0,0,0.85)');
    const post = 2 * R * 0.3;
    line(cx - R, cy, cx - R + post, cy, 5, '#000');
    line(cx + R, cy, cx + R - post, cy, 5, '#000');
    line(cx, cy - R, cx, cy - R + post, 5, '#000');
    line(cx, cy + R, cx, cy + R - post, 5, '#000');

    const dot = (x: number, y: number, radius: number, color: string) => {
      p.fillStyle = color;
      p.beginPath();
      p.arc(x, y, radius, 0, TAU);
      p.fill();
    };
    // 密位点：两轴各 ±5 / ±10 vmin
    for (const k of [-10, -5, 5, 10]) {
      dot(cx + k * vmin * zoom, cy, 2, 'rgba(0,0,0,0.9)');
      dot(cx, cy + k * vmin * zoom, 2, 'rgba(0,0,0,0.9)');
    }
    // 中心朱红点 + 一圈辉光
    dot(cx, cy, 5, 'rgba(255,60,40,0.35)');
    dot(cx, cy, 2, css(CinnabarHi));
  }
}
