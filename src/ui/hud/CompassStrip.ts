/**
 * 顶部罗盘条（照译 Unity G/UI/Widgets/CompassStrip.cs，样式 css/unity/map.css 的 .sf-compass；取代旧的行旅图 AdventureHUD，不做常驻小地图）：
 *   · 一条 560 设计像素宽的方位带，覆盖视线左右各 75°：每 15° 一道刻度，45° 长刻度，北 / 东 / 南 / 西大字、东北等小字，两端渐隐；正中一枚鎏金小三角；
 *   · 地点徽记（MapMarkers：场地「战」、藏宝「宝」、补给营「营」、出口「门」、首领「首」、灵火坛「火」）按方位落在带上，只显示发现过的；颜色跟状态走；
 *   · 目标：金色菱框 + 下方距离「128 米」；转到视线外时贴在带子内侧并加 ← / →；准心对着它（±25°）时带子下面写「前往 · 雅丹石阵」。
 * 首领血条在场时收起（两者都在顶部正中）。朝向取玩家的水平朝向（不含镜头震动），只写变化了的样式。
 * 布局计算（compassX、tickAlpha、markAlpha）是纯函数，测试直接调。
 */
import { type MapMarker, type MapModel, bearing, deltaAngle, headingOf, markerColor, markerGlyph } from '../MapMarkers';
import { el, setOpacity, setText, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { css, fadeBoth, paint } from '../toolkit/UITheme';
import { type HudFrame, HudWidget } from './HudWidget';

export const COMPASS_WIDTH = 560, COMPASS_SPAN = 150, COMPASS_HALF = COMPASS_SPAN * 0.5, CAPTION_CONE = 25;
const PxPerDeg = COMPASS_WIDTH / COMPASS_SPAN, BadgeSize = 20, EdgeClamp = COMPASS_HALF - 6;
const Dir8 = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

const smooth = (t: number) => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k * (3 - 2 * k);
};
const invLerp = (a: number, b: number, v: number) => (v - a) / (b - a);

/** 相对视线 rel 度的东西在带上的 x（设计像素，半像素取整）；clampEdge = 视线外贴在带子内侧（两端留 6°） */
export function compassX(rel: number, clampEdge = false): number {
  const r = clampEdge ? Math.min(EdgeClamp, Math.max(-EdgeClamp, rel)) : rel;
  return Math.round((COMPASS_WIDTH * 0.5 + r * PxPerDeg) * 2) * 0.5;
}

/** 刻度的不透明度：±45° 内 1，到 ±75° 渐隐，之外 0（量化到 0.05） */
export function tickAlpha(rel: number): number {
  const a = Math.abs(rel) <= COMPASS_HALF ? 1 - smooth(invLerp(COMPASS_HALF * 0.6, COMPASS_HALF, Math.abs(rel))) : 0;
  return Math.round(a * 20) / 20;
}

/** 徽记的不透明度：两端渐隐（目标贴边时不淡），已完成的压到 0.7 */
export function markAlpha(rel: number, isTarget: boolean, done: boolean): number {
  const a = (isTarget ? 1 : 1 - smooth(invLerp(COMPASS_HALF * 0.72, COMPASS_HALF, Math.abs(rel)))) * (done ? 0.7 : 1);
  return Math.round(a * 20) / 20;
}

interface Notch {
  root: HTMLDivElement;
  deg: number;
  x: number;
  a: number;
}

interface Mark {
  root: HTMLDivElement;
  badge: HTMLDivElement;
  glyph: HTMLDivElement;
  dist: HTMLDivElement;
  arrow: HTMLDivElement;
  marker: MapMarker | null;
  shown: boolean;
  target: boolean;
  x: number;
  meters: number;
  arrowText: string;
  color: string;
  alpha: number;
}

export class CompassStrip extends HudWidget {
  readonly id = 'compass';
  override readonly order = 45;
  /** 地点状态（UIManager 给；和全图共用） */
  model: MapModel | null = null;
  /** 首领血条在场（UIManager 给） */
  bossShown: () => boolean = () => false;

  private marksLayer!: HTMLDivElement;
  private caption!: HTMLDivElement;
  private readonly ticks: Notch[] = [];
  private readonly marks: Mark[] = [];
  private builtVersion = -1;
  private lastYaw = NaN;
  private captionText = '';
  private captionAlpha = 0;
  /** 当前朝向（度，0 = 北；测试用） */
  heading = 0;

  /** 带上显示着的徽记（测试用：名字、相对带中心的 x、是不是目标、距离文字） */
  get shown(): { name: string; x: number; target: boolean; distance: string }[] {
    return this.marks.filter((m) => m.shown && m.marker).map((m) => ({ name: m.marker!.name, x: m.x - COMPASS_WIDTH * 0.5, target: m.target, distance: m.dist.textContent ?? '' }));
  }

  /** 带子下方的目标说明（测试用） */
  get captionShown(): string {
    return this.captionText;
  }

  protected build(): HTMLElement {
    const root = el('sf-compass');
    const strip = el('sf-compass__strip', root);
    paint(strip, fadeBoth([0.027, 0.024, 0.04, 0.72]));
    el('sf-compass__rule', strip);
    const ticksLayer = el('sf-compass__layer', strip);
    this.marksLayer = el('sf-compass__layer', strip);
    el('sf-compass__notch', strip);
    for (let i = 0; i < 24; i++) {
      const cardinal = i % 6 === 0, inter = !cardinal && i % 3 === 0;
      const t: Notch = { deg: i * 15, root: el('sf-compass__tick' + (cardinal ? ' is-cardinal' : inter ? ' is-major' : ''), ticksLayer), x: NaN, a: -1 };
      el('sf-compass__line', t.root);
      if (cardinal || inter) text('sf-compass__dir', t.root, Dir8[i / 3], cardinal ? UIFontRole.Title : UIFontRole.Body);
      this.ticks.push(t);
    }
    this.caption = text('sf-compass__caption', root, '', UIFontRole.Title);
    this.caption.style.opacity = '0';
    return root;
  }

  override resetState(): void {
    this.builtVersion = -1;
    this.lastYaw = NaN;
  }

  private rebuildMarks(all: readonly MapMarker[], version: number): void {
    this.builtVersion = version;
    while (this.marks.length < all.length) {
      const root = el('sf-compass__mark', this.marksLayer);
      el('sf-compass__diamond', root);
      const badge = el('sf-compass__badge', root);
      const glyph = text('sf-compass__glyph', badge, '', UIFontRole.Title);
      const arrow = text('sf-compass__arrow', root, '');
      const dist = text('sf-compass__dist', root, '', UIFontRole.Number);
      root.style.display = 'none';
      this.marks.push({ root, badge, glyph, dist, arrow, marker: null, shown: false, target: false, x: NaN, meters: -1, arrowText: '', color: '', alpha: -1 });
    }
    this.marks.forEach((m, i) => {
      m.marker = all[i] ?? null;
      m.shown = m.target = false;
      m.x = NaN;
      m.meters = m.alpha = -1;
      m.color = m.arrowText = '';
      m.arrow.textContent = m.dist.textContent = '';
      toggle(m.root, 'is-target', false);
      m.root.style.display = 'none';
      if (m.marker) m.glyph.textContent = markerGlyph(m.marker.kind);
    });
  }

  override tick(f: HudFrame): void {
    const g = this.game;
    const p = g.player;
    const model = this.model;
    const show = !!p && !!model && !this.bossShown();
    this.visible = show;
    if (!show || !model) return;
    model.update(g);
    const mk = model.markers;
    const yaw = headingOf(p.yaw);
    this.heading = yaw;
    if (Number.isNaN(this.lastYaw) || Math.abs(deltaAngle(yaw, this.lastYaw)) > 0.05) {
      this.lastYaw = yaw;
      for (const t of this.ticks) this.placeTick(t, deltaAngle(yaw, t.deg));
    }
    if (this.builtVersion !== mk.version) this.rebuildMarks(mk.all, mk.version);
    const pos = p.position;
    const target = mk.target;
    let cap = '';
    for (const m of this.marks) {
      const k = m.marker;
      if (!k) continue;
      const isTarget = k === target;
      const rel = deltaAngle(yaw, bearing(pos.x, pos.z, k.x, k.z));
      const inView = Math.abs(rel) <= COMPASS_HALF;
      const shown = mk.visible(k) && (inView || isTarget);
      if (shown !== m.shown) {
        m.shown = shown;
        m.root.style.display = shown ? '' : 'none';
      }
      if (!shown) continue;
      if (isTarget !== m.target) {
        m.target = isTarget;
        toggle(m.root, 'is-target', isTarget);
        m.meters = -1;
        if (!isTarget) m.dist.textContent = '';
      }
      const x = compassX(rel, true);
      if (x !== m.x) {
        m.x = x;
        m.root.style.left = `${x - BadgeSize * 0.5}px`;
      }
      const arrow = !isTarget || inView ? '' : rel < 0 ? '←' : '→';
      if (arrow !== m.arrowText) {
        m.arrowText = arrow;
        m.arrow.textContent = arrow;
        toggle(m.arrow, 'is-right', rel > 0);
      }
      const c = css(markerColor(k.kind, k.state));
      if (c !== m.color) {
        m.color = c;
        m.badge.style.borderColor = c;
        m.glyph.style.color = c;
      }
      const a = markAlpha(rel, isTarget, k.state === 'done');
      if (a !== m.alpha) {
        m.alpha = a;
        setOpacity(m.root, a);
      }
      if (isTarget) {
        const meters = Math.round(k.distance);
        if (meters !== m.meters) {
          m.meters = meters;
          m.dist.textContent = meters + ' 米';
        }
        if (Math.abs(rel) <= CAPTION_CONE) cap = mk.targetVerb ? `${mk.targetVerb} · ${k.name}` : k.name;
      }
    }
    if (cap !== this.captionText) {
      if (cap) setText(this.caption, cap);
      this.captionText = cap;
    }
    const want = this.captionText ? 1 : 0;
    if (this.captionAlpha !== want) {
      const step = f.unscaledDt / 0.18;
      this.captionAlpha = want > this.captionAlpha ? Math.min(want, this.captionAlpha + step) : Math.max(want, this.captionAlpha - step);
      setOpacity(this.caption, this.captionAlpha);
    }
  }

  private placeTick(t: Notch, rel: number): void {
    const a = tickAlpha(rel);
    if (a !== t.a) {
      t.a = a;
      setOpacity(t.root, a);
      t.root.style.display = a > 0 ? '' : 'none';
    }
    if (a <= 0) return;
    const x = compassX(rel);
    if (x !== t.x) {
      t.x = x;
      t.root.style.left = `${x}px`;
    }
  }
}
