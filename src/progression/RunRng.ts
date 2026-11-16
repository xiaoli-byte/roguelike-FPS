/**
 * 可种子化随机数（Unity RunRng.cs 一比一：mulberry32，同 src/core/Rng.ts，同种子同序列）。
 * 玩法随机按「流」分开：{@link RunRng.stream}(局种子, "loot") 只由种子和流名决定，各流互不扰动——
 * 掉落多掷一次不会改变下一关的地图或刷怪。{@link RunRng.fork} 同 core/Rng fork：从当前状态派生一个子序列。
 *
 * 和 core/Rng 的区别：状态是 uint32、带 nextUInt / state、流名哈希（FNV-1a），float 结果按 C# float 截断，
 * 便于和 Unity 对拍（tests/unity-run-route.test.mjs）。
 */
export class RunRng {
  private s: number;

  /** (uint)seed == 0 时用 1（同 C#） */
  constructor(seed: number) {
    this.s = (seed >>> 0) || 1;
  }

  /** 当前内部状态（存档 / 调试） */
  get state(): number {
    return this.s;
  }

  /** 局种子 + 流名 → 独立的随机流（同样的参数总是得到同样的序列） */
  static stream(seed: number, stream: string): RunRng {
    return new RunRng(seed).fork(RunRng.hash(stream));
  }

  /** 按当前状态派生子随机数（同 TS fork）；传字符串 = 按流名哈希 */
  fork(salt: number | string): RunRng {
    const k = typeof salt === 'string' ? RunRng.hash(salt) : salt | 0;
    // C#：((s ^ (uint)salt) * 2654435761u) ^ (uint)(salt * 97)，全部按 32 位回绕
    return new RunRng((Math.imul(this.s ^ k, 2654435761) ^ Math.imul(k, 97)) >>> 0);
  }

  /** 32 位无符号随机数（mulberry32 一步） */
  nextUInt(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** [0, 1)（C# float） */
  get value(): number {
    return Math.fround(this.nextUInt() / 4294967296);
  }

  /** [0, 1)（双精度，和 TS next() 逐位相同） */
  nextDouble(): number {
    return this.nextUInt() / 4294967296;
  }

  /** [min, max)（C# float 运算） */
  range(min: number, max: number): number {
    const f = Math.fround;
    return f(f(min) + f(f(f(max) - f(min)) * f(this.nextDouble())));
  }

  /** [min, max] 闭区间整数（同 TS int） */
  int(min: number, max: number): number {
    return Math.floor(min + (max - min + 1) * this.nextDouble());
  }

  chance(p: number): boolean {
    return this.nextDouble() < Math.fround(p);
  }

  sign(): 1 | -1 {
    return this.nextDouble() < 0.5 ? -1 : 1;
  }

  pick<T>(list: readonly T[] | null | undefined): T | undefined {
    return !list || list.length === 0 ? undefined : list[Math.floor(this.nextDouble() * list.length)];
  }

  /** 按权重挑选；权重全 ≤ 0 时退化为均匀挑选（同 TS weighted） */
  weighted<T>(list: readonly T[] | null | undefined, weight: (item: T) => number): T | undefined {
    if (!list || list.length === 0) return undefined;
    let total = 0;
    for (const it of list) total += Math.max(0, Math.fround(weight(it)));
    if (total <= 0) return this.pick(list);
    let r = this.nextDouble() * total;
    for (const it of list) {
      r -= Math.max(0, Math.fround(weight(it)));
      if (r <= 0) return it;
    }
    return list[list.length - 1];
  }

  /** 原地洗牌（Fisher–Yates，同 TS shuffle） */
  shuffle<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.nextDouble() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  /** 流名的稳定哈希（FNV-1a，按 UTF-16 码元，同 C# foreach char；返回有符号 32 位） */
  static hash(text: string | null | undefined): number {
    let h = 2166136261;
    if (text) for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h | 0;
  }
}
