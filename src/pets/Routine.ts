/**
 * Unity 协程在网页的对应（灵宠的动作、灵技演出都是协程写的）：生成器函数 yield 出
 *   · 数字 s     ——等 s 秒（WaitForSeconds，按游戏时间）；
 *   · null / 不写 ——等一帧（yield return null）；
 *   · 另一个生成器——先跑完它再接着走（yield return pet.DashTo(...) 这种嵌套协程）。
 * 生成器的 next(dt) 拿到的是这一帧的 dt（DashTo 这类逐帧推进的子程序要用）。
 * 抛错只打日志、结束这一条（同 Unity：协程里的异常不影响别的）；finally 块在 stop / 跑完时都会执行。
 * 本文件不 import 运行时模块。
 */
export type RoutineYield = number | null | undefined | void | RoutineGen;
export type RoutineGen = Generator<RoutineYield, void, number>;

interface Running {
  stack: RoutineGen[];
  wait: number;
  done: boolean;
}

export class Routines {
  private list: Running[] = [];

  get count(): number {
    return this.list.length;
  }

  /** 开一条协程；返回停止它的函数（会执行生成器里的 finally） */
  start(gen: RoutineGen): () => void {
    const r: Running = { stack: [gen], wait: 0, done: false };
    this.list.push(r);
    // 同 Unity StartCoroutine：立刻跑到第一个 yield
    this.step(r, 0);
    return () => this.stop(r);
  }

  /** 每帧推进（dt 已乘时间缩放） */
  update(dt: number): void {
    if (this.list.length === 0) return;
    // 本帧开出来的新协程已经在 start 里跑过第一步，这里只推进已有的
    const snapshot = this.list.slice();
    for (const r of snapshot) {
      if (r.done) continue;
      if (r.wait > 0) {
        r.wait -= dt;
        if (r.wait > 0) continue;
      }
      this.step(r, dt);
    }
    if (this.list.some((r) => r.done)) this.list = this.list.filter((r) => !r.done);
  }

  /** 全部停掉（执行各自的 finally） */
  stopAll(): void {
    for (const r of this.list.slice()) this.stop(r);
    this.list.length = 0;
  }

  private stop(r: Running): void {
    if (r.done) return;
    r.done = true;
    for (let i = r.stack.length - 1; i >= 0; i--) {
      try {
        r.stack[i].return(undefined);
      } catch (err) {
        console.error('[pets] 协程收尾出错', err);
      }
    }
    r.stack.length = 0;
  }

  private step(r: Running, dt: number): void {
    // 子程序跑完立刻回到上一层继续（同一帧），上限防止写错的生成器死循环
    for (let guard = 0; guard < 64 && !r.done; guard++) {
      const top = r.stack[r.stack.length - 1];
      if (!top) {
        r.done = true;
        return;
      }
      let res: IteratorResult<RoutineYield, void>;
      try {
        res = top.next(dt);
      } catch (err) {
        console.error('[pets] 协程出错', err);
        this.stop(r);
        return;
      }
      if (res.done) {
        r.stack.pop();
        if (r.stack.length === 0) {
          r.done = true;
          return;
        }
        // 子程序消耗了这一帧的 dt：父程序接着走时不再算一次
        dt = 0;
        continue;
      }
      const v = res.value;
      if (typeof v === 'number') {
        r.wait = v;
        return;
      }
      if (v && typeof (v as RoutineGen).next === 'function') {
        r.stack.push(v as RoutineGen);
        // 子程序第一步在同一帧跑（同 Unity：嵌套协程立刻开始）
        continue;
      }
      return;
    }
  }
}
