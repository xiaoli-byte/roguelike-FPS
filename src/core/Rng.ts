/** 可种子化随机数（mulberry32）。所有玩法随机都应走 ctx.rng，方便复现。 */
export class Rng {
  private s: number;

  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }

  reseed(seed: number): void {
    this.s = seed >>> 0 || 1;
  }

  /** [0, 1) */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** [min, max] 闭区间整数 */
  int(min: number, max: number): number {
    return Math.floor(min + (max - min + 1) * this.next());
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** 按权重挑选；所有权重 <= 0 时退化为均匀挑选 */
  weighted<T>(arr: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const it of arr) total += Math.max(0, weight(it));
    if (total <= 0) return this.pick(arr);
    let r = this.next() * total;
    for (const it of arr) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return arr[arr.length - 1];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** 派生一个独立子随机数（用于关卡生成等，不扰动主序列太多） */
  fork(salt: number): Rng {
    return new Rng((Math.imul(this.s ^ salt, 2654435761) >>> 0) ^ (salt * 97));
  }
}
