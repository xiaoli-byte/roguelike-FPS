/**
 * 全屏闪光（照译 Unity G/UI/Toolkit/UIFlash.cs；灵宠技能、结契、神兽现世…）：叠层（HUD 之上、界面之下），颜色含 alpha，
 * 按剩余时间的平方淡出，用不缩放时间（暂停中也会淡完）。新的闪光替换旧的。
 */
import { el, show } from './el';
import { type RGBA, css } from './UITheme';

export class UIFlash {
  readonly el: HTMLDivElement;
  private color: RGBA = [1, 1, 1, 1];
  private start = 0;
  private duration = 1;
  private active = false;

  constructor(parent: HTMLElement, private readonly clock: () => number) {
    this.el = el('sf-flash', parent, 'flash');
    show(this.el, false);
  }

  /** 正在闪 */
  get isActive(): boolean {
    return this.active;
  }

  play(c: RGBA, seconds: number): void {
    this.color = c;
    this.duration = Math.max(0.05, seconds);
    this.start = this.clock();
    this.active = true;
    this.el.parentElement?.appendChild(this.el);
    show(this.el, true);
    this.tick(this.start);
  }

  tick(now: number): void {
    if (!this.active) return;
    const k = 1 - Math.min(1, Math.max(0, (now - this.start) / this.duration));
    if (k <= 0) {
      this.active = false;
      show(this.el, false);
      return;
    }
    this.el.style.backgroundColor = css(this.color, k * k);
  }
}
