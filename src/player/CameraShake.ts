/**
 * 震屏前端（Unity Fx/CameraShake.cs + FeelProfile 的震屏曲线）：调用方只说「多强、多久」，真正把抖动写到镜头上的是 CameraRig。
 * trauma 模型：强度 s（0–1.2，1 ≈ 很强）换算成 trauma = √(s / 1.2)；每个来源占一个「声部」，trauma 在 duration 内线性降到 0，
 * 画面幅度 = 1.2 × trauma²（开头猛、收尾柔，上限 1.8）。单个来源时幅度就等于传进来的强度。
 * 多个来源：最强的那个 + 其余之和 × 0.35（叠起来更凶，但不会翻倍），上限 1。
 * 0.06 s 内的连续调用（同一次爆炸被两处各报一遍、每帧调用的持续震动）并进同一个声部、取较强者。
 * 设置「震屏强度」由 CameraRig 出画面时乘上（0 = 关掉）；这里存原始强度。纯逻辑（时钟注入），node --test 直接测。
 */

export const SHAKE = {
  /** 强度上限（= trauma 1） */
  MaxStrength: 1.2,
  /** 单次最长时长（秒） */
  MaxTime: 1.5,
  Voices: 8,
  MergeWindow: 0.06,
  StackShare: 0.35,
  /** 画面幅度 = 上限 × trauma ^ 指数（FeelProfile 定稿 2 = trauma²），封顶 */
  Exponent: 2,
  AmpMax: 1.8,
} as const;

interface Voice {
  trauma: number;
  start: number;
  length: number;
}

function level(v: Voice, now: number): number {
  if (!(v.length > 0)) return 0;
  const age = now - v.start;
  return age < 0 || age >= v.length ? 0 : v.trauma * (1 - age / v.length);
}

export class CameraShake {
  private readonly voices: Voice[] = Array.from({ length: SHAKE.Voices }, () => ({ trauma: 0, start: 0, length: 0 }));
  private latest = -1;

  constructor(private readonly clock: () => number) {}

  /** 清掉所有震动（换关、传送） */
  clear(): void {
    for (const v of this.voices) {
      v.trauma = 0;
      v.start = 0;
      v.length = 0;
    }
    this.latest = -1;
  }

  /** 当前 trauma（0–1）：最强声部 + 其余之和 × 0.35 */
  get trauma(): number {
    const now = this.clock();
    let max = 0, sum = 0;
    for (const v of this.voices) {
      const l = level(v, now);
      if (l <= 0) continue;
      sum += l;
      if (l > max) max = l;
    }
    return Math.min(1, max + (sum - max) * SHAKE.StackShare);
  }

  /** 当前抖动强度（与 add 的 strength 同单位 = trauma² × 1.2） */
  get current(): number {
    const t = this.trauma;
    return t * t * SHAKE.MaxStrength;
  }

  /** 画面幅度（未乘设置）：1.2 × trauma ^ 2，封顶 1.8 */
  amplitude(): number {
    return shakeAmplitude(this.trauma);
  }

  /** 震一下：strength 0–1.2（0.25 ≈ 护盾被打空，0.5 ≈ 近处爆炸，0.9 ≈ 首领砸地），duration 秒（≤ 1.5） */
  add(strength: number, duration = 0.3): void {
    if (!(strength > 0) || !(duration > 0)) return;
    this.addTrauma(Math.sqrt(Math.min(strength, SHAKE.MaxStrength) / SHAKE.MaxStrength), duration);
  }

  /** 直接按 trauma（0–1）加一个声部 */
  addTrauma(trauma: number, duration = 0.3): void {
    // NaN / 负数直接丢掉：写进镜头会让整个画面消失
    if (!(trauma > 0) || !(duration > 0)) return;
    trauma = Math.min(1, trauma);
    duration = Math.min(duration, SHAKE.MaxTime);
    const now = this.clock();

    // 刚开始不久的声部：并进去（取较强者、时长取较长的剩余）
    if (this.latest >= 0) {
      const v = this.voices[this.latest];
      const age = now - v.start;
      if (age >= 0 && age < SHAKE.MergeWindow && age < v.length) {
        v.trauma = Math.max(level(v, now), trauma);
        v.length = Math.max(v.length - age, duration);
        v.start = now;
        return;
      }
    }

    // 找空位；满了就顶掉现在最弱的（比新来的还强就不加了）
    let slot = -1;
    let weakest = Infinity;
    for (let i = 0; i < this.voices.length; i++) {
      const l = level(this.voices[i], now);
      if (l <= 0) {
        slot = i;
        break;
      }
      if (l < weakest) {
        weakest = l;
        slot = i;
      }
    }
    if (slot < 0 || (level(this.voices[slot], now) > 0 && weakest >= trauma)) return;
    const v = this.voices[slot];
    v.trauma = trauma;
    v.start = now;
    v.length = duration;
    this.latest = slot;
  }

  /** 以 at 为中心的震动：玩家（from）离得越远越弱（水平线性），range 米外没有 */
  quake(from: { x: number; z: number }, at: { x: number; z: number }, strength: number, range: number, duration = 0.3): void {
    if (!(range > 0)) return;
    const k = Math.max(0, Math.min(1, 1 - Math.hypot(from.x - at.x, from.z - at.z) / range));
    if (k > 0) this.add(strength * k, duration);
  }
}

/** 震屏的画面幅度（未乘设置）：上限 × trauma ^ 指数，封顶（FeelProfile.ShakeAmplitude） */
export function shakeAmplitude(trauma: number): number {
  return Math.min(SHAKE.AmpMax, SHAKE.MaxStrength * Math.pow(Math.max(0, Math.min(1, trauma)), Math.max(0.5, SHAKE.Exponent)));
}
