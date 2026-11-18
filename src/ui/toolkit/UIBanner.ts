/**
 * 大横幅（照译 Unity G/UI/Toolkit/UIBanner.cs）：屏幕 17% 高处居中，标题用标题字体鎏金色、两侧祥云、下面一道两端渐隐的金线、再下面副标题；
 * 底下垫一层淡墨径向衬底（沙漠 / 雪地亮天空下也清楚）。
 * 动画（不缩放时间）：标题 0.9 s 字距收拢 + 淡入；金线 0.15 s 后 0.8 s 展开；祥云和副标题 0.25 s 后 0.7 s 上浮淡入；收起 0.5 s 上移淡出。
 * 同一标题还在显示（关卡导演与首领先后为同一首领发横幅）：只换副标题、延长时间，不重播动画。
 */
import { el, text, show, setOpacity, setTranslate, setScale } from './el';
import { UIFontRole } from './UIFonts';
import { UIIcon, makeIcon } from './UIIcons';
import { Gold, Ink0, fadeBoth, paint, radialSoft } from './UITheme';

const TitleIn = 0.9, RuleDelay = 0.15, RuleIn = 0.8, RiseDelay = 0.25, RiseIn = 0.7, OutTime = 0.5, MinSeconds = 0.6;
/** 标题字距（设计像素）：入场从 40 收到 20 */
const SpacingFrom = 40, SpacingTo = 20;

const easeOut = (k: number) => 1 - (1 - k) * (1 - k) * (1 - k);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class UIBanner {
  readonly root: HTMLDivElement;
  private readonly rule: HTMLDivElement;
  private readonly cloudL: HTMLDivElement;
  private readonly cloudR: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private shownAt = 0;
  private until = 0;
  private hideAt = -1;
  private visible = false;

  constructor(parent: HTMLElement, private readonly clock: () => number) {
    this.root = el('sf-banner', null, 'banner');
    const backdrop = el('sf-banner__backdrop', this.root, 'backdrop');
    paint(backdrop, radialSoft(Ink0));
    const row = el('sf-banner__row', this.root);
    this.cloudL = makeIcon(UIIcon.Cloud, 'sf-banner__cloud');
    row.appendChild(this.cloudL);
    this.title = text('sf-banner__title sf-title', row, '', UIFontRole.Title);
    this.cloudR = makeIcon(UIIcon.Cloud, 'sf-banner__cloud', 'sf-banner__cloud--r');
    row.appendChild(this.cloudR);
    this.rule = el('sf-banner__rule', this.root);
    paint(this.rule, fadeBoth(Gold));
    this.sub = text('sf-banner__sub', this.root);
    show(this.root, false);
    parent.appendChild(this.root);
  }

  /** 正在显示（含收起动画） */
  get isVisible(): boolean {
    return this.visible;
  }

  get titleText(): string | null {
    return this.visible ? this.title.textContent : null;
  }

  get subtitleText(): string | null {
    return this.visible ? this.sub.textContent : null;
  }

  /** 显示横幅；title 和 sub 都空则忽略 */
  show(titleText: string | null | undefined, subText?: string | null, seconds = 2.6): void {
    if (!titleText && !subText) return;
    const now = this.clock();
    seconds = Math.max(MinSeconds, Number.isNaN(seconds) ? 2.6 : seconds);
    if (this.visible && this.hideAt < 0 && titleText && titleText === this.title.textContent) {
      if (subText) {
        this.sub.textContent = subText;
        show(this.sub, true);
      }
      this.until = now + seconds;
      return;
    }
    this.title.textContent = titleText ?? '';
    this.sub.textContent = subText ?? '';
    show(this.sub, !!subText);
    show(this.root, true);
    this.visible = true;
    this.shownAt = now;
    this.until = now + seconds;
    this.hideAt = -1;
    this.apply(now);
  }

  /** 收起（immediate = 不播淡出） */
  hide(immediate = false): void {
    if (!this.visible) return;
    if (immediate) {
      this.visible = false;
      this.hideAt = -1;
      show(this.root, false);
      return;
    }
    if (this.hideAt < 0) this.hideAt = this.clock();
  }

  tick(now: number): void {
    if (!this.visible) return;
    if (this.hideAt < 0 && now >= this.until) this.hideAt = now;
    this.apply(now);
  }

  private apply(now: number): void {
    const t = now - this.shownAt;
    const kt = easeOut(clamp01(t / TitleIn));
    setOpacity(this.title, lerp(0.3, 1, kt));
    const ls = `${lerp(SpacingFrom, SpacingTo, kt).toFixed(2)}px`;
    this.title.style.letterSpacing = ls;
    this.title.style.paddingLeft = ls; // 字距只加在字后面：左边补同样的空，标题保持居中
    const kr = easeOut(clamp01((t - RuleDelay) / RuleIn));
    setOpacity(this.rule, kr);
    setScale(this.rule, Math.max(0.0001, kr), 1);
    const ks = easeOut(clamp01((t - RiseDelay) / RiseIn));
    for (const e of [this.cloudL, this.cloudR, this.sub]) {
      setOpacity(e, ks);
      setTranslate(e, 0, 10 * (1 - ks));
    }
    if (this.hideAt >= 0) {
      const ko = clamp01((now - this.hideAt) / OutTime);
      setOpacity(this.root, 1 - ko);
      setTranslate(this.root, 0, -8 * ko);
      if (ko >= 1) {
        this.visible = false;
        this.hideAt = -1;
        show(this.root, false);
      }
    } else {
      setOpacity(this.root, 1);
      setTranslate(this.root, 0, 0);
    }
  }
}
