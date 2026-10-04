/**
 * 指针锁定偶尔产生孤立的位移尖峰。较大的突变等下一个事件确认：
 * 连续快速移动保留全部位移，随后立即恢复小位移则丢弃尖峰。
 * 不限制每帧总位移，避免低帧率 / 高频鼠标的正常甩枪被截断。
 */
const HARD_LIMIT = 400;
const SPIKE_MIN = 160;
const SPIKE_RATIO = 4;
// mousemove 可能随渲染合并；留出低帧率下相邻事件的间隔。
const CONFIRM_WINDOW_MS = 100;

export class MouseLookFilter {
  private lastTime = -Infinity;
  private lastMagnitude = 0;
  private pending: { x: number; y: number; magnitude: number; time: number } | null = null;
  private readonly output = { x: 0, y: 0 };

  reset(): void {
    this.lastTime = -Infinity;
    this.lastMagnitude = 0;
    this.pending = null;
  }

  /** 返回值复用，只能在本次调用后立即消费。time 使用 MouseEvent.timeStamp（毫秒）。 */
  sample(x: number, y: number, time: number): Readonly<{ x: number; y: number }> {
    const out = this.output;
    out.x = out.y = 0;
    const magnitude = Math.hypot(x, y);
    // 整个事件一起丢弃，不能保留异常对角线输入的另一轴。
    if (!Number.isFinite(magnitude) || !Number.isFinite(time) || magnitude > HARD_LIMIT) {
      this.reset();
      return out;
    }

    const elapsed = time - this.lastTime;
    if (elapsed < 0 || elapsed > CONFIRM_WINDOW_MS) this.reset();
    this.lastTime = time;

    const pending = this.pending;
    if (pending) {
      this.pending = null;
      if (time - pending.time <= CONFIRM_WINDOW_MS && magnitude >= pending.magnitude / SPIKE_RATIO) {
        // 相邻事件也在快速移动：补回暂存的位移，不削弱连续甩枪。
        out.x = pending.x + x;
        out.y = pending.y + y;
        this.lastMagnitude = magnitude;
        return out;
      }
      // 未获确认：丢弃孤立尖峰，当前小位移仍正常生效。
    }

    if (magnitude > SPIKE_MIN && magnitude > this.lastMagnitude * SPIKE_RATIO) {
      this.pending = { x, y, magnitude, time };
      return out;
    }
    this.lastMagnitude = magnitude;
    out.x = x;
    out.y = y;
    return out;
  }
}
