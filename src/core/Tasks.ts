/**
 * 通用逐帧任务调度器（技能持续效果、延时爆炸、Boss 招式时间轴等）。
 * 任务函数返回 true 表示结束并移除；返回 void/false 继续运行。
 * 非 persistent 任务在关卡切换时（ctx.tasks.clear()）被清除。
 * 仅在 playing 状态下推进。
 */
type TaskFn = (dt: number) => boolean | void;

interface Task {
  fn: TaskFn;
  persistent: boolean;
  dead: boolean;
}

export class TaskRunner {
  private tasks: Task[] = [];

  /** 添加逐帧任务，返回取消函数 */
  add(fn: TaskFn, persistent = false): () => void {
    const t: Task = { fn, persistent, dead: false };
    this.tasks.push(t);
    return () => {
      t.dead = true;
    };
  }

  /** seconds 秒后执行一次 */
  delay(seconds: number, fn: () => void, persistent = false): () => void {
    let left = seconds;
    return this.add((dt) => {
      left -= dt;
      if (left <= 0) {
        fn();
        return true;
      }
      return false;
    }, persistent);
  }

  /** 每 interval 秒执行一次，持续 duration 秒（缺省无限，直到取消/清场）；fn 返回 true 提前结束 */
  every(interval: number, fn: () => boolean | void, duration = Infinity, persistent = false): () => void {
    let acc = 0;
    let elapsed = 0;
    return this.add((dt) => {
      acc += dt;
      elapsed += dt;
      while (acc >= interval) {
        acc -= interval;
        if (fn() === true) return true;
      }
      return elapsed >= duration;
    }, persistent);
  }

  /** 持续 duration 秒，每帧以进度 t∈[0,1] 调用 fn */
  tween(duration: number, fn: (t: number, dt: number) => void, onDone?: () => void, persistent = false): () => void {
    let elapsed = 0;
    return this.add((dt) => {
      elapsed += dt;
      const t = Math.min(1, elapsed / duration);
      fn(t, dt);
      if (t >= 1) {
        onDone?.();
        return true;
      }
      return false;
    }, persistent);
  }

  update(dt: number): void {
    // 迭代期间新增的任务会在下一帧才执行
    const list = this.tasks;
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const t = list[i];
      if (t.dead) continue;
      try {
        if (t.fn(dt) === true) t.dead = true;
      } catch (err) {
        console.error('[Tasks] task threw, removing', err);
        t.dead = true;
      }
    }
    if (this.tasks.some((t) => t.dead)) this.tasks = this.tasks.filter((t) => !t.dead);
  }

  /** 清除任务。includePersistent=true 时连常驻任务一起清除（新开一局） */
  clear(includePersistent = false): void {
    if (includePersistent) {
      for (const t of this.tasks) t.dead = true;
      this.tasks = [];
    } else {
      for (const t of this.tasks) if (!t.persistent) t.dead = true;
      this.tasks = this.tasks.filter((t) => !t.dead);
    }
  }

  get size(): number {
    return this.tasks.length;
  }
}
