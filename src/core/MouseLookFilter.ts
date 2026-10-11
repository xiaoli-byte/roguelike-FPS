/**
 * 指针锁定偶尔产生孤立的位移尖峰。较大的突变先暂存，由相邻事件确认：
 *  - 下一个事件同样很快（≥ 1/4），或前后任一事件与它同向且不是微小抖动，视为真实甩枪，补回全部位移；
 *  - 否则（前后都是微小位移或方向不符）视为尖峰丢弃，当前小位移照常生效。
 * 低帧率下浏览器把一次甩枪合并成单个大事件、随后鼠标停下不再有事件时，
 * 由每帧的 flush() 依据前一事件的方向结算，避免真实甩枪被吞掉。
 * 不限制每帧总位移，避免低帧率 / 高频鼠标的正常甩枪被截断。
 */
/** 单轴硬上限：超出即为损坏数据包（按轴判断，快速斜向甩枪不会因合成长度被整包丢弃） */
const HARD_LIMIT = 400;
const SPIKE_MIN = 160;
const SPIKE_RATIO = 4;
/** 同向确认：夹角余弦下限，以及邻近事件相对暂存位移的最小比例（排除静止时的微小抖动） */
const ALIGN_COS = 0.5;
const ALIGN_FRACTION = 1 / 12;
// mousemove 可能随渲染合并；留出低帧率下相邻事件的间隔。
const CONFIRM_WINDOW_MS = 100;

interface Motion { x: number; y: number; magnitude: number; time: number }

const aligned = (a: Motion, b: Motion | null): boolean => !!b && Math.abs(a.time - b.time) <= CONFIRM_WINDOW_MS
  && b.magnitude >= a.magnitude * ALIGN_FRACTION
  && (a.x * b.x + a.y * b.y) >= ALIGN_COS * a.magnitude * b.magnitude;

export class MouseLookFilter {
  private lastTime = -Infinity;
  private lastMagnitude = 0;
  private previous: Motion | null = null;
  private pending: Motion | null = null;
  private readonly output = { x: 0, y: 0 };

  reset(): void {
    this.lastTime = -Infinity;
    this.lastMagnitude = 0;
    this.previous = null;
    this.pending = null;
  }

  /** 返回值复用，只能在本次调用后立即消费。time 使用 MouseEvent.timeStamp（毫秒）。 */
  sample(x: number, y: number, time: number): Readonly<{ x: number; y: number }> {
    const out = this.output;
    out.x = out.y = 0;
    const magnitude = Math.hypot(x, y);
    // 整个事件一起丢弃，不能保留异常输入的另一轴。
    if (!Number.isFinite(magnitude) || !Number.isFinite(time) || Math.abs(x) > HARD_LIMIT || Math.abs(y) > HARD_LIMIT) {
      this.reset();
      return out;
    }

    const elapsed = time - this.lastTime;
    if (elapsed < 0) this.reset();
    else if (elapsed > CONFIRM_WINDOW_MS) {
      // 长时间无事件：暂存位移只按此前的方向结算（flush 未及时调用时的兜底）。
      const settled = this.settle();
      this.reset();
      if (settled) { out.x = settled.x; out.y = settled.y; }
    }
    this.lastTime = time;
    const current: Motion = { x, y, magnitude, time };

    const pending = this.pending;
    if (pending) {
      this.pending = null;
      if (time - pending.time <= CONFIRM_WINDOW_MS
        && (magnitude >= pending.magnitude / SPIKE_RATIO || aligned(pending, current) || aligned(pending, this.previous))) {
        // 相邻事件也在朝同一方向快速移动：补回暂存的位移，不削弱连续甩枪。
        out.x += pending.x + x;
        out.y += pending.y + y;
        this.lastMagnitude = magnitude;
        this.previous = current;
        return out;
      }
      // 未获确认：丢弃孤立尖峰，当前小位移仍正常生效。
    }

    if (magnitude > SPIKE_MIN && magnitude > this.lastMagnitude * SPIKE_RATIO) {
      this.pending = current;
      return out;
    }
    this.lastMagnitude = magnitude;
    this.previous = current;
    out.x += x;
    out.y += y;
    return out;
  }

  /**
   * 每帧调用：暂存超过确认窗口仍无后续事件时结算。与此前事件同向的视为真实甩枪并返回其位移，
   * 否则丢弃。返回值复用。
   */
  flush(now: number): Readonly<{ x: number; y: number }> {
    const out = this.output;
    out.x = out.y = 0;
    if (!this.pending || !(now - this.pending.time > CONFIRM_WINDOW_MS)) return out;
    const settled = this.settle();
    this.pending = null;
    if (settled) { out.x = settled.x; out.y = settled.y; this.lastMagnitude = settled.magnitude; this.previous = settled; }
    return out;
  }

  private settle(): Motion | null {
    const pending = this.pending;
    return pending && aligned(pending, this.previous) ? pending : null;
  }
}
