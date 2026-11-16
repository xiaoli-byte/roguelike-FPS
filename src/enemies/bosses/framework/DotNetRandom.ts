/**
 * System.Random(seed) 的逐位移植（.NET / Mono 的 Knuth 减法生成器）：Unity 的击杀用时模拟（HanbaBalance）用固定种子的 System.Random 抽招，
 * 网页的同一份模拟用它，同一种子抽出同一串数，测试才能和 Unity 的 EditMode 断言对得上。
 */
const MBIG = 2147483647;
const MSEED = 161803398;

export class DotNetRandom {
  private readonly seedArray = new Array<number>(56).fill(0);
  private inext = 0;
  private inextp = 21;

  constructor(seed: number) {
    const s = seed | 0;
    const subtraction = s === -2147483648 ? MBIG : Math.abs(s);
    let mj = MSEED - subtraction;
    this.seedArray[55] = mj;
    let mk = 1;
    for (let i = 1; i < 55; i++) {
      const ii = (21 * i) % 55;
      this.seedArray[ii] = mk;
      mk = mj - mk;
      if (mk < 0) mk += MBIG;
      mj = this.seedArray[ii];
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        this.seedArray[i] -= this.seedArray[1 + (i + 30) % 55];
        if (this.seedArray[i] < 0) this.seedArray[i] += MBIG;
      }
    }
    this.inext = 0;
    this.inextp = 21;
  }

  private internalSample(): number {
    let locINext = this.inext;
    let locINextp = this.inextp;
    if (++locINext >= 56) locINext = 1;
    if (++locINextp >= 56) locINextp = 1;
    let ret = this.seedArray[locINext] - this.seedArray[locINextp];
    if (ret === MBIG) ret--;
    if (ret < 0) ret += MBIG;
    this.seedArray[locINext] = ret;
    this.inext = locINext;
    this.inextp = locINextp;
    return ret;
  }

  /** [0, 1) */
  nextDouble(): number {
    return this.internalSample() * (1 / MBIG);
  }

  /** [0, int.MaxValue) */
  next(): number {
    return this.internalSample();
  }
}
