import type { GameEvents } from './types';

type Handler<T> = (payload: T) => void;

/** 类型安全的同步事件总线。处理函数抛出的异常会被捕获并打印，不会打断主循环。 */
export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<any>>>();

  /** 订阅，返回取消订阅函数 */
  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn);
    return () => this.off(type, fn);
  }

  once<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): void {
    this.handlers.get(type)?.delete(fn);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set || set.size === 0) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] handler for "${String(type)}" threw`, err);
      }
    }
  }
}
