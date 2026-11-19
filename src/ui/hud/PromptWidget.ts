/**
 * 交互提示卡（照译 Unity G/UI/Widgets/PromptWidget.cs；数据 = InteractPrompt）：
 *   底部技能栏上方居中：左边朱砂键帽（交互键 / 自定按键）、右边 标题（标题字体，提示色，缺省鎏金）、副标题、多行说明（含 ▲ 的绿、含 ▼ 的红）、
 *   价格（铜钱 + 数字；灵石不够标红并写「灵石不足」，每帧按当前灵石刷新）；
 *   说明超过 3 行（武器对比）时改到准星右侧竖直居中，不挡准星和底部 HUD。
 * 出现：0.2 s 淡入 + 上移 10；收起：0.2 s 淡出后隐藏。不缩放时间。
 */
import type { InteractPrompt } from '../../core/types';
import { el, formatNum, setOpacity, setText, setTranslate, show, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { UIIcon, makeIcon } from '../toolkit/UIIcons';
import { GoldHi, css } from '../toolkit/UITheme';
import { type HudFrame, HudWidget, keyLabel } from './HudWidget';

const DetailLines = 3, InTime = 0.2, OutTime = 0.2;

export class PromptWidget extends HudWidget {
  readonly id = 'prompt';
  override readonly order = 60;

  private wrap!: HTMLDivElement;
  private card!: HTMLDivElement;
  private linesEl!: HTMLDivElement;
  private costEl!: HTMLDivElement;
  private key!: HTMLDivElement;
  private title!: HTMLDivElement;
  private sub!: HTMLDivElement;
  private costNum!: HTMLDivElement;
  private costShort!: HTMLDivElement;
  private readonly lineLabels: HTMLDivElement[] = [];
  private current: InteractPrompt | null = null;
  private changedAt = -10;
  private open = false;
  private animating = false;
  private detail = false;
  private shortV = false;

  /** 当前显示的提示（测试用；收起后为 null） */
  get Current(): InteractPrompt | null {
    return this.open ? this.current : null;
  }

  protected build(): HTMLElement {
    // 外层负责摆位（底部居中 / 详细模式在准星右侧竖直居中），卡片本身的 translate 留给出入场动画
    this.wrap = el('sf-prompt-wrap');
    this.card = el('sf-prompt', this.wrap);
    this.key = text('sf-prompt__key', this.card, 'F', UIFontRole.Number);
    const body = el('sf-prompt__body', this.card);
    this.title = text('sf-prompt__title', body, '', UIFontRole.Title);
    this.sub = text('sf-prompt__sub', body);
    this.linesEl = el('sf-prompt__lines', body);
    this.costEl = el('sf-prompt__cost', body);
    this.costEl.appendChild(makeIcon(UIIcon.Coin, 'sf-icon--coin', 'sf-prompt__coin'));
    this.costNum = text('sf-prompt__costnum', this.costEl, '', UIFontRole.Number);
    this.costShort = text('sf-prompt__short', this.costEl, '灵石不足');
    show(this.sub, false);
    show(this.linesEl, false);
    show(this.costEl, false);
    this.card.style.display = 'none';
    setOpacity(this.card, 0);
    return this.wrap;
  }

  /** 设提示（null = 收起） */
  set(p: InteractPrompt | null): void {
    const now = performance.now() / 1000;
    if (!p) {
      if (!this.open) return;
      this.open = false;
      this.changedAt = now;
      this.animating = true;
      return;
    }
    this.sync(p, now);
    this.current = p;
    if (!this.open) {
      this.open = true;
      this.changedAt = now;
      this.animating = true;
      this.card.style.display = '';
    }
  }

  private sync(p: InteractPrompt, now: number): void {
    setText(this.title, p.title ?? '');
    const c = p.color || css(GoldHi);
    this.title.style.color = c;
    this.card.style.borderLeftColor = c;
    setText(this.sub, p.subtitle ?? '');
    show(this.sub, !!p.subtitle);
    setText(this.key, p.key || keyLabel(this.game, 'interact', now));

    const cost = p.cost ?? 0;
    show(this.costEl, cost > 0);
    if (cost > 0) setText(this.costNum, formatNum(cost));
    this.shortV = cost > 0 && (this.game.run?.coins ?? 0) < cost;
    this.applyShort(this.shortV);

    let n = 0;
    for (const line of p.lines ?? []) {
      if (!line) continue;
      if (n >= this.lineLabels.length) this.lineLabels.push(text('sf-prompt__line', this.linesEl));
      const l = this.lineLabels[n++];
      setText(l, line);
      show(l, true);
      toggle(l, 'is-up', line.includes('▲') || line.includes('↑'));
      toggle(l, 'is-down', line.includes('▼') || line.includes('↓'));
    }
    for (let i = n; i < this.lineLabels.length; i++) show(this.lineLabels[i], false);
    show(this.linesEl, n > 0);
    const d = n > DetailLines;
    if (d !== this.detail) {
      this.detail = d;
      toggle(this.wrap, 'is-detail', d);
    }
  }

  private applyShort(s: boolean): void {
    toggle(this.costEl, 'is-short', s);
    show(this.costShort, s);
  }

  override resetState(): void {
    this.open = false;
    this.animating = false;
    this.current = null;
    this.card.style.display = 'none';
    setOpacity(this.card, 0);
  }

  override tick(f: HudFrame): void {
    // 每帧按当前灵石刷新「不足」
    const p = this.current;
    if (this.open && p && (p.cost ?? 0) > 0) {
      const s = (this.game.run?.coins ?? 0) < (p.cost ?? 0);
      if (s !== this.shortV) {
        this.shortV = s;
        this.applyShort(s);
      }
    }
    if (!this.animating) return;
    let k = (f.unscaledTime - this.changedAt) / (this.open ? InTime : OutTime);
    if (k < 0) k = 0;
    if (k >= 1) {
      this.animating = false;
      setOpacity(this.card, this.open ? 1 : 0);
      setTranslate(this.card, null);
      if (!this.open) {
        this.card.style.display = 'none';
        this.current = null;
      }
      return;
    }
    const e = 1 - (1 - k) * (1 - k) * (1 - k);
    setOpacity(this.card, this.open ? e : 1 - e);
    const off = this.open ? 10 * (1 - e) : 10 * e;
    if (this.detail) setTranslate(this.card, off, 0);
    else setTranslate(this.card, 0, off);
  }
}
