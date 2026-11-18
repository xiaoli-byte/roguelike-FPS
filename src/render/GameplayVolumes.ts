import type { VolumeLayer } from './UrpVolume';

/**
 * 玩法屏效（Unity GameplayVolumes，unity/Assets/Game/Scripts/Fx/GameplayVolumes.cs）的网页版：几个运行时的全局 Volume 层，
 * 权重每帧按玩法状态算，和场景的 Volume 一起按优先级混（PostScene.layers）：
 *   低血量（生命 < 35% 起、10% 满，平滑）：饱和度 −38、对比 +6；阵亡 = 0（交给慢动作）
 *   受击：色差脉冲，峰值 0.35 + 伤害占（生命 + 护盾上限）× 3，只扣护盾 × 0.6；0.03 s 线性起，之后指数退（τ 0.14 s）
 *   冲刺：色差 0.25 + 暗角 0.3 / 柔和 0.5，0.05 s 起、0.27 s 二次退
 *   慢动作（只认仲裁器里的阵亡 / 首领倒下 DeathSlowMo）：饱和度 −30、对比 +10、暗角 0.34、色差 0.15
 * 优先级 150–153（关卡 0、天气 50 / 60 之上）：低血量 → 冲刺 → 慢动作 → 受击。全部再乘「屏幕特效」（默认 1）。
 * 时间一律用真实时间（不随慢动作变慢）。纯函数照搬，node --test 对照。
 */
export const GAMEPLAY_VOLUMES = {
  QualityPriority: 140, LowHealthPriority: 150, DashPriority: 151, SlowPriority: 152, HurtPriority: 153,
  LowHpStart: 0.35, LowHpFull: 0.1,
  HurtAttack: 0.03, HurtDecay: 0.14, DashHold: 0.05, DashFade: 0.27,
  /** FeelProfile 的默认值（工程里没有 Resources/Feel/FeelProfile.asset） */
  HurtAberration: 0.4, DashAberration: 0.25, SlowAberration: 0.15,
  /** TimeScaleArbiter.Priority.DeathSlowMo */
  DeathSlowMoPriority: 200,
} as const;

const G = GAMEPLAY_VOLUMES;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Mathf.InverseLerp */
function inverseLerp(a: number, b: number, v: number): number {
  return a !== b ? clamp01((v - a) / (b - a)) : 0;
}

/** 低血量权重：生命比例 35% 起、10% 满（平滑），阵亡 = 0 */
export function lowHealthTarget(hpFraction: number, dead: boolean): number {
  if (dead || Number.isNaN(hpFraction)) return 0;
  const t = inverseLerp(G.LowHpStart, G.LowHpFull, hpFraction);
  return t * t * (3 - 2 * t);
}

/** 受击峰值：0.35 + 伤害占总池 × 3，只扣护盾 × 0.6，夹到 1 */
export function hurtStrength(toHp: number, toShield: number, pool: number): number {
  const dmg = Math.max(0, toHp) + Math.max(0, toShield);
  if (dmg <= 0) return 0;
  const k = clamp01(0.35 + dmg / Math.max(1, pool) * 3);
  return toHp > 0 ? k : k * 0.6;
}

/** 受击包络：0.03 s 线性起，之后指数退（τ 0.14 s），低于 0.02 归零 */
export function hurtEnvelope(age: number): number {
  if (age < 0) return 0;
  if (age < G.HurtAttack) return age / G.HurtAttack;
  const v = Math.exp(-(age - G.HurtAttack) / G.HurtDecay);
  return v < 0.02 ? 0 : v;
}

/** 冲刺包络：0.05 s 起到满，之后 0.27 s 二次退到 0 */
export function dashEnvelope(age: number): number {
  if (age < 0) return 0;
  if (age < G.DashHold) return age / G.DashHold;
  const k = 1 - (age - G.DashHold) / G.DashFade;
  return k <= 0 ? 0 : k * k;
}

/** 慢动作目标权重：只认 DeathSlowMo；时间缩放 0.3 → 1（(1 − s) / 0.7） */
export function slowTarget(timeScale: number, priority: number | null): number {
  if (priority !== G.DeathSlowMoPriority || timeScale >= 0.98) return 0;
  return clamp01((1 - timeScale) / 0.7);
}

/** Mathf.MoveTowards */
function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

const BLACK = [0, 0, 0, 1];

/** 读玩法状态的接口（PostStack 从 GameContext 接过来；测试里给假的） */
export interface GameplaySource {
  /** 生命比例 0..1；没有玩家 = NaN */
  hpFraction(): number;
  dead(): boolean;
  timeScale(): number;
  /** 当前生效的时间缩放申请的优先级；玩家阵亡（直接写的 0.3）也算 DeathSlowMo */
  timePriority(): number | null;
}

export class GameplayVolumes {
  readonly lowHealth: VolumeLayer = { priority: G.LowHealthPriority, weight: 0, overrides: { ColorAdjustments: { saturation: -38, contrast: 6 } } };
  readonly dash: VolumeLayer = {
    priority: G.DashPriority, weight: 0,
    overrides: { ChromaticAberration: { intensity: G.DashAberration }, Vignette: { intensity: 0.3, smoothness: 0.5, color: BLACK } },
  };
  readonly slow: VolumeLayer = {
    priority: G.SlowPriority, weight: 0,
    overrides: {
      ColorAdjustments: { saturation: -30, contrast: 10 },
      Vignette: { intensity: 0.34, smoothness: 0.5, color: BLACK },
      ChromaticAberration: { intensity: G.SlowAberration },
    },
  };
  readonly hurt: VolumeLayer = { priority: G.HurtPriority, weight: 0, overrides: { ChromaticAberration: { intensity: G.HurtAberration } } };
  readonly layers: readonly VolumeLayer[] = [this.lowHealth, this.dash, this.slow, this.hurt];

  /** 设置「屏幕特效」0..1（0 = 关） */
  amount = 1;
  private hurtAt = -10;
  private hurtPeak = 0;
  private dashAt = -10;
  private slowV = 0;
  private last = NaN;

  constructor(private readonly source: GameplaySource, private readonly clock: () => number = () => performance.now() / 1000) {}

  /** 玩家受伤（GameEvents.PlayerHit）：正在褪的那一下没退完时取大的，不叠加 */
  onPlayerHit(toHp: number, toShield: number, pool: number): void {
    const k = hurtStrength(toHp, toShield, pool);
    if (k <= 0) return;
    const now = this.clock();
    this.hurtPeak = Math.max(k, this.hurtPeak * hurtEnvelope(now - this.hurtAt));
    this.hurtAt = now;
  }

  /** 直接触发一次受击屏效（机关 / 测试；strength 0..1） */
  pulseHurt(strength: number): void {
    this.hurtPeak = clamp01(strength);
    this.hurtAt = this.clock();
  }

  /** 冲刺（GameEvents.PlayerDashed）/ 测试 */
  pulseDash(): void {
    this.dashAt = this.clock();
  }

  /** 每帧调：更新四层的权重 */
  update(): void {
    const now = this.clock();
    const dt = Number.isNaN(this.last) ? 0 : Math.min(0.25, Math.max(0, now - this.last));
    this.last = now;
    const amount = clamp01(this.amount);
    const s = this.source;
    const low = lowHealthTarget(s.hpFraction(), s.dead());
    const target = slowTarget(s.timeScale(), s.timePriority());
    this.slowV = moveTowards(this.slowV, target, dt * (target > this.slowV ? 5 : 2.5));
    set(this.lowHealth, low * amount);
    set(this.hurt, this.hurtPeak * hurtEnvelope(now - this.hurtAt) * amount);
    set(this.dash, dashEnvelope(now - this.dashAt) * amount);
    set(this.slow, this.slowV * amount);
  }
}

function set(layer: VolumeLayer, w: number): void {
  w = clamp01(w);
  layer.weight = w > 0.002 ? w : 0;
}
