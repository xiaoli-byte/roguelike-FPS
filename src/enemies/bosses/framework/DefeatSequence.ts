/**
 * 首领倒下的演出层（Unity BossDefeatSequence.cs + BossDefeatFx.cs）与慢动作入口。
 *   · 慢动作：经 {@link arbiterFor}（ctx.time 的时间缩放仲裁）申请，按真实时间撤销；第一次申请时挂一个常驻任务每帧推进仲裁，没有申请了就自己撤掉。
 *   · 溃散：倒下那一刻的大爆炸 / 震屏 / 吼声 / 每 0.2 s 一团爆炸 / 88% 的最后一下大爆炸由 BossBase（网页原有的同一套）放；
 *     这里补 Unity 多出来的：倒下慢动作（defeat.slowMo × slowMoSeconds 真实秒）、倒下提示、按时间排的特效时间轴（{@link DefeatTimeline}）。
 *     时间轴挂在 ctx.tasks 上（不挂在首领身上）：首领物体回收之后，泉眼复涌、太阳复原这些长尾照样跑完；换关时随任务一起清掉。
 */
import type { GameContext } from '../../../core/types';
import type { BossDefeatDef } from './BossDef';
import { arbiterFor, TimePriority, type TimeScaleHandle } from './TimeScaleArbiter';

const tickers = new WeakSet<object>();

/** 申请一段慢动作（scale 倍速，持续 realSeconds 真实秒）；返回句柄（可提前 dispose） */
export function slowMo(ctx: GameContext, owner: unknown, scale: number, realSeconds: number, priority: number = TimePriority.BossCinematic): TimeScaleHandle | null {
  if (!(scale > 0 && scale < 1) || !(realSeconds > 0)) return null;
  const arbiter = arbiterFor(ctx.time);
  const handle = arbiter.request(owner, scale, priority, realSeconds);
  if (!tickers.has(ctx.time)) {
    tickers.add(ctx.time);
    ctx.tasks.add(() => {
      arbiter.tick();
      if (arbiter.active) return false;
      tickers.delete(ctx.time);
      return true;
    }, true);
  }
  return handle;
}

/** 倒下后按秒排的一串动作（BossDefeatFx：At(2.0, …).At(2.4, …)），逐帧放，放完自己移除 */
export class DefeatTimeline {
  private readonly steps: { at: number; run: () => void }[] = [];
  private t = 0;
  private cancelTask: (() => void) | null = null;

  constructor(private readonly ctx: GameContext) {}

  at(seconds: number, run: () => void): this {
    this.steps.push({ at: Math.max(0, seconds), run });
    this.ensure();
    return this;
  }

  /** 每帧调（dt = 游戏时间）的持续动作，持续 seconds 秒 */
  during(seconds: number, run: (t: number, dt: number) => void): this {
    let t = 0;
    this.ctx.tasks.add((dt) => {
      t += dt;
      try {
        run(t, dt);
      } catch (err) {
        console.error('[DefeatTimeline] during threw', err);
        return true;
      }
      return t >= seconds;
    });
    return this;
  }

  private ensure(): void {
    if (this.cancelTask) return;
    this.cancelTask = this.ctx.tasks.add((dt) => {
      this.t += dt;
      for (let i = this.steps.length - 1; i >= 0; i--) {
        if (this.t < this.steps[i].at) continue;
        const s = this.steps.splice(i, 1)[0];
        try {
          s.run();
        } catch (err) {
          console.error('[DefeatTimeline] step threw', err);
        }
      }
      if (this.steps.length > 0) return false;
      this.cancelTask = null;
      return true;
    });
  }

  cancel(): void {
    this.cancelTask?.();
    this.cancelTask = null;
    this.steps.length = 0;
  }
}

/** 倒下那一刻（BossDefeatSequence.Begin 里 BossBase.onDeath 没有的那部分）：慢动作 + 提示 */
export function beginDefeat(ctx: GameContext, owner: unknown, d: BossDefeatDef, color: number): void {
  if (d.slowMo > 0 && d.slowMo < 1 && d.slowMoSeconds > 0) slowMo(ctx, owner, d.slowMo, d.slowMoSeconds, TimePriority.DeathSlowMo);
  if (d.toast) ctx.ui.toast(d.toast, `#${color.toString(16).padStart(6, '0')}`);
}
