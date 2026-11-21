import type { GameState } from './types';
import { TimePriority, type TimeScaleArbiter, type TimeScaleHandle } from './TimeScaleArbiter';

/**
 * 状态机（Unity G/Core/GameState.cs 的 GameStateMachine 照译，docs/unity-parity.md 4.7）：
 * 一个底层状态（{@link setBase}：boot / menu / playing / transition / summary）+ 模态栈（{@link push} / {@link pop}）。
 * 每个栈项有一个 owner（谁打开的谁关），默认同时向 {@link TimeScaleArbiter} 申请停住时间（暂停用 Pause 优先级，其余用 Modal 优先级），
 * 弹出时撤销——所以「秘卷三选一叠在暂停菜单上，选完之后时间仍然停着」是自然成立的。
 * 当前状态（栈顶，栈空时是底层状态）变化时回调 onChange（Game 转成 game:stateChanged）。光标 / 玩家输入由 Game 跟着状态走。
 */
interface Entry {
  owner: unknown;
  state: GameState;
  time: TimeScaleHandle | null;
}

export class GameStateMachine {
  private baseState: GameState = 'boot';
  private readonly stack: Entry[] = [];

  constructor(
    private readonly arbiter: TimeScaleArbiter | null,
    private readonly onChange: (from: GameState, to: GameState) => void = () => undefined,
  ) {}

  /** 当前状态：模态栈顶，栈空时是底层状态 */
  get current(): GameState {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1].state : this.baseState;
  }

  /** 底层状态（不含模态） */
  get base(): GameState {
    return this.baseState;
  }

  /** 模态栈深度 */
  get depth(): number {
    return this.stack.length;
  }

  /** 有模态（暂停 / 模态界面 / 结算面板）挡在游戏上面 */
  get blocked(): boolean {
    return this.stack.length > 0;
  }

  /** 正在正常游玩（底层是 playing 且没有模态） */
  get isPlaying(): boolean {
    return this.stack.length === 0 && this.baseState === 'playing';
  }

  /** 切底层状态 */
  setBase(state: GameState): void {
    const prev = this.current;
    this.baseState = state;
    this.notify(prev);
  }

  /**
   * 压一个模态（owner 已经在栈里时先把它旧的那一项拿掉，再压到栈顶）。
   * freezeTime：同时停住时间（paused 用暂停优先级，其余用模态优先级）
   */
  push(owner: unknown, state: GameState = 'modal', freezeTime = true): void {
    const prev = this.current;
    this.remove(owner);
    const e: Entry = { owner, state, time: null };
    this.stack.push(e);
    if (freezeTime && this.arbiter) e.time = this.arbiter.request(owner, 0, state === 'paused' ? TimePriority.Pause : TimePriority.Modal);
    this.notify(prev);
  }

  /** 弹出 owner 的模态（不必在栈顶）；没有则返回 false */
  pop(owner: unknown): boolean {
    const prev = this.current;
    if (!this.remove(owner)) return false;
    this.notify(prev);
    return true;
  }

  /** owner 的模态在不在栈里 */
  contains(owner: unknown): boolean {
    return this.stack.some(e => e.owner === owner);
  }

  /** 清空模态栈（撤销它们的时间申请），底层回到 boot。重开 / 换关时调用（Unity Clear） */
  clear(): void {
    this.clearModals('boot');
  }

  /** 清空模态栈并把底层切到 state（一次只通知一回） */
  clearModals(state: GameState = this.baseState): void {
    const prev = this.current;
    for (const e of this.stack) e.time?.dispose();
    this.stack.length = 0;
    this.baseState = state;
    this.notify(prev);
  }

  private remove(owner: unknown): boolean {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].owner !== owner) continue;
      this.stack[i].time?.dispose();
      this.stack.splice(i, 1);
      return true;
    }
    return false;
  }

  private notify(prev: GameState): void {
    const now = this.current;
    if (now !== prev) this.onChange(prev, now);
  }
}
