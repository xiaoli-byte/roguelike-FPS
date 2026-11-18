/**
 * 提示队列（照译 Unity G/UI/Toolkit/UIToasts.cs）：屏幕左侧 38% 高处往下叠，最多 4 条，满了先快速收走最老的；
 * 和最新一条文字相同就合并计数「×N」、弹一下、刷新计时。颜色是左边竖线 / 菱形 / 计数的强调色（缺省鎏金），正文统一纸色。
 * 计时和动画都用不缩放时间：暂停 / 慢动作中照常出现和消失。进场 0.34 s 从左滑入，离场 0.36 s（被挤掉 0.16 s）。
 * 电影模式（HUD 隐藏：首领登场演出）整层淡出、结束后淡回（出 0.15 s、进 0.45 s），计时照走。
 */
import { el, text, show, setOpacity, setTranslate, setScale, opacityOf } from './el';
import { UIFontRole } from './UIFonts';
import { GoldHi, Ink0, css, fadeRight, paint } from './UITheme';

export const TOAST_MAX = 4;
export const TOAST_SECONDS = 2.8;
const EnterTime = 0.34, LeaveTime = 0.36, LeaveFast = 0.16, PulseTime = 0.18;

interface Item {
  el: HTMLDivElement;
  text: HTMLDivElement;
  count: HTMLDivElement;
  message: string;
  n: number;
  born: number;
  until: number;
  leaveStart: number;
  pulseStart: number;
  seconds: number;
  leaving: boolean;
  fast: boolean;
}

export class UIToasts {
  readonly root: HTMLDivElement;
  private readonly items: Item[] = [];
  private readonly leaving: Item[] = [];
  private shown = 1;
  private lastTick = -1;

  /** hidden = 电影模式（HUD 隐藏）：整层淡出 */
  constructor(parent: HTMLElement, private readonly clock: () => number, private readonly hidden: () => boolean = () => false) {
    this.root = el('sf-toasts', parent, 'toasts');
    parent.appendChild(this.root);
  }

  /** 显示中的条数（不含正在离场的） */
  get count(): number {
    return this.items.length;
  }

  /** 显示中的文字（从老到新；测试用） */
  get texts(): string[] {
    return this.items.map((it) => (it.n > 1 ? `${it.message} ×${it.n}` : it.message));
  }

  /** 推一条提示：color = 强调色（CSS 颜色，缺省鎏金），seconds = 显示时长 */
  push(message: string, color?: string | null, seconds = TOAST_SECONDS): void {
    if (!message) return;
    const now = this.clock();
    seconds = seconds > 0 ? seconds : TOAST_SECONDS;
    const last = this.items.length > 0 ? this.items[this.items.length - 1] : null;
    if (last && last.message === message) {
      last.n++;
      last.count.textContent = '×' + last.n;
      show(last.count, true);
      last.pulseStart = now;
      last.seconds = Math.max(last.seconds, seconds);
      last.until = now + last.seconds;
      return;
    }
    while (this.items.length >= TOAST_MAX) this.dismiss(this.items[0], true, now);

    const c = color || css(GoldHi);
    const e = el('sf-toast', this.root, 'toast');
    paint(e, fadeRight(Ink0));
    e.style.borderLeftColor = c;
    const mark = el('sf-toast__mark', e);
    mark.style.backgroundColor = c;
    const label = text('sf-toast__text', e, message);
    const cnt = text('sf-toast__count', e, '', UIFontRole.Number);
    cnt.style.color = c;
    show(cnt, false);
    setOpacity(e, 0);
    this.items.push({ el: e, text: label, count: cnt, message, n: 1, born: now, until: now + seconds, leaveStart: 0, pulseStart: -1, seconds, leaving: false, fast: false });
  }

  /** 全部快速收走（弹模态界面、结算前） */
  clear(): void {
    const now = this.clock();
    while (this.items.length > 0) this.dismiss(this.items[0], true, now);
  }

  private dismiss(it: Item, fast: boolean, now: number): void {
    if (it.leaving) return;
    it.leaving = true;
    it.fast = fast;
    it.leaveStart = now;
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
    this.leaving.push(it);
  }

  /** 每帧（UIRoot，不缩放时间） */
  tick(now: number): void {
    const target = this.hidden() ? 0 : 1;
    const dt = this.lastTick < 0 ? 0 : Math.max(0, now - this.lastTick);
    this.lastTick = now;
    if (this.shown !== target) {
      const rate = dt / (target > this.shown ? 0.45 : 0.15);
      this.shown = target > this.shown ? Math.min(target, this.shown + rate) : Math.max(target, this.shown - rate);
      setOpacity(this.root, this.shown);
    }
    for (let i = this.items.length - 1; i >= 0; i--) if (now >= this.items[i].until) this.dismiss(this.items[i], false, now);
    for (const it of this.items) {
      const k = Math.min(1, Math.max(0, (now - it.born) / EnterTime));
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      setOpacity(it.el, e);
      const pulse = it.pulseStart >= 0 ? Math.min(1, Math.max(0, (now - it.pulseStart) / PulseTime)) : 1;
      const s = pulse < 1 ? 1.06 + (1 - 1.06) * (1 - (1 - pulse) * (1 - pulse)) : 1;
      setTranslate(it.el, -24 * (1 - e), 0);
      setScale(it.el, s);
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const it = this.leaving[i];
      const k = Math.min(1, Math.max(0, (now - it.leaveStart) / (it.fast ? LeaveFast : LeaveTime)));
      if (k >= 1) {
        it.el.remove();
        this.leaving.splice(i, 1);
        continue;
      }
      setOpacity(it.el, Math.min(opacityOf(it.el), 1 - k));
      setTranslate(it.el, -16 * k, 0);
    }
  }
}
