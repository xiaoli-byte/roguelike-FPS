/**
 * 全屏黑幕（照译 Unity G/UI/Toolkit/UICurtain.cs）：最上层，盖住 HUD、界面和提示。用不缩放时间、smoothstep 缓动；
 * 新的淡入淡出立刻结束上一个（上一个的 await 马上返回），从当前不透明度接着过渡；到达终点后再等一帧才返回，保证最终画面已经上屏。
 * 网页差异：标签页在后台时 requestAnimationFrame 不跑——另挂一个按时长的 setTimeout 兜底，过渡总会结束（关卡流程在等它）。
 */
import { el, show, setOpacity } from './el';

export class UICurtain {
  readonly el: HTMLDivElement;
  private value = 0;
  private token = 0;
  private pending: (() => void) | null = null;

  constructor(parent: HTMLElement, private readonly clock: () => number) {
    this.el = el('sf-curtain', parent, 'curtain');
    this.set(0);
  }

  /** 当前不透明度（0 透明 → 1 全黑） */
  get opacity(): number {
    return this.value;
  }

  /** 立刻设成某个不透明度（打断进行中的过渡） */
  set(alpha: number): void {
    this.token++;
    this.settle();
    this.apply(clamp01(alpha));
  }

  /** 淡到 to，用时 seconds（不缩放时间）；可 await */
  fadeTo(to: number, seconds: number): Promise<void> {
    const my = ++this.token;
    this.settle();
    const goal = clamp01(Number.isNaN(to) ? 0 : to);
    const from = this.value;
    const dur = Math.max(0, Number.isNaN(seconds) || !Number.isFinite(seconds) ? 0 : seconds);
    const start = this.clock();
    // 放到层容器最后 = 画在最上面（BringToFront）
    this.el.parentElement?.appendChild(this.el);
    return new Promise<void>((resolve) => {
      let done = false;
      let timer = 0;
      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        if (this.pending === finish) this.pending = null;
        resolve();
      };
      this.pending = finish;
      const step = () => {
        if (done) return;
        if (my !== this.token) return finish();
        const t = this.clock() - start;
        if (t < dur) {
          const k = t / dur;
          this.apply(from + (goal - from) * k * k * (3 - 2 * k));
          requestAnimationFrame(step);
          return;
        }
        this.apply(goal);
        // 终点画面上屏后再返回
        requestAnimationFrame(() => finish());
      };
      // 后台标签页兜底：时长 + 0.25 s 后直接到终点
      timer = window.setTimeout(() => {
        if (done || my !== this.token) return finish();
        this.apply(goal);
        finish();
      }, dur * 1000 + 250);
      step();
    });
  }

  /** 新的过渡开始：上一个立刻返回 */
  private settle(): void {
    const p = this.pending;
    this.pending = null;
    p?.();
  }

  private apply(a: number): void {
    this.value = a;
    setOpacity(this.el, a);
    show(this.el, a > 0.001);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
