/**
 * 全屏黑幕。基于真实时间（requestAnimationFrame + setTimeout 兜底），不依赖游戏时间。
 * 新的 fade 会立即结束（resolve）上一个未完成的 fade，并从当前不透明度继续过渡。
 */
import { h } from './dom';

export class Fade {
  readonly el: HTMLDivElement;
  private value = 0;
  private token = 0;
  private raf = 0;
  private timer = 0;
  private pending: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = h('div', 'gf-fade', parent);
    this.apply(0);
  }

  get opacity(): number {
    return this.value;
  }

  to(target: number, duration: number): Promise<void> {
    const goal = Math.min(1, Math.max(0, Number.isFinite(target) ? target : 0));
    this.settle();
    const token = ++this.token;
    const from = this.value;
    const ms = Math.max(0, Number.isFinite(duration) ? duration : 0) * 1000;
    const start = performance.now();

    return new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (this.token === token) {
          this.pending = null;
          cancelAnimationFrame(this.raf);
          window.clearTimeout(this.timer);
        }
        resolve();
      };
      this.pending = finish;

      const step = () => {
        if (this.token !== token) return;
        const k = ms <= 0 ? 1 : Math.min(1, (performance.now() - start) / ms);
        const e = k * k * (3 - 2 * k);
        this.apply(from + (goal - from) * e);
        // 到达终点后再等一帧，保证最终画面已经上屏（例如黑幕盖住后再加载关卡）
        this.raf = requestAnimationFrame(k >= 1 ? finish : step);
      };
      this.raf = requestAnimationFrame(step);
      // 兜底：后台标签页 rAF 不触发时也要可靠 resolve
      this.timer = window.setTimeout(() => {
        if (this.token === token) this.apply(goal);
        finish();
      }, ms + 250);
    });
  }

  /** 结束当前过渡（保持当前不透明度），并 resolve 其 Promise */
  private settle(): void {
    const p = this.pending;
    this.pending = null;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.timer);
    p?.();
  }

  private apply(v: number): void {
    this.value = v;
    this.el.style.opacity = v.toFixed(3);
    this.el.style.visibility = v <= 0.001 ? 'hidden' : 'visible';
  }
}
