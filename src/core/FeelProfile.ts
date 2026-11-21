/**
 * 手感总表（Unity G/Core/FeelProfile.cs，I7；docs/feel.md）：顿帧、清场慢动作、屏效、震屏曲线、手柄瞄准辅助集中在一处。
 * 按决定 D16「代码默认值优先」：字段的默认值就是定稿值。Unity 可以在 Resources/Feel/FeelProfile.asset 建一份覆盖，
 * 工程里没有这份资产，所以网页只有这一份默认表（{@link FEEL}）；调试时直接改它的字段。
 * 读的地方：core/HitStop（顿帧时长 / 缩放）、core/ClearSlowMo（清场慢动作）；屏效色差在 render/GameplayVolumes（同值，各写一份）、
 * 震屏曲线随 M8 的镜头手感、手柄瞄准辅助网页没有手柄输入（数值先留着）。
 */
export interface FeelProfile {
  // ── 顿帧（秒，真实时间）──
  hitStopScale: number;
  killStop: number;
  eliteKillStop: number;
  bossKillStop: number;
  critStop: number;
  reactionStop: number;
  // ── 清场慢动作：打死一处场地的最后一只 ──
  /** 时间缩放；1 = 关掉 */
  clearSlowMoScale: number;
  /** 真实秒数 */
  clearSlowMoSeconds: number;
  /** 场地至少打过这么多只才放（两三只的小场地不放） */
  clearSlowMoMinKills: number;
  // ── 屏效（色差强度）──
  hurtAberration: number;
  dashAberration: number;
  slowAberration: number;
  // ── 震屏：画面幅度 = 上限 × trauma ^ 指数 × 设置 ──
  /** 2 = 开头猛、收尾柔（trauma²） */
  shakeExponent: number;
  /** 幅度上限（相对强度） */
  shakeAmpMax: number;
  // ── 手柄瞄准辅助（只对右摇杆）──
  assistRange: number;
  assistConeDeg: number;
  assistSlowdown: number;
  assistPull: number;
}

/** Unity CameraShake.MaxStrength：trauma = 1 时的相对强度 */
export const SHAKE_MAX_STRENGTH = 1.2;

export function defaultFeel(): FeelProfile {
  return {
    hitStopScale: 0.05,
    killStop: 0.035, eliteKillStop: 0.07, bossKillStop: 0.18,
    critStop: 0.025, reactionStop: 0.045,
    clearSlowMoScale: 0.3, clearSlowMoSeconds: 0.4, clearSlowMoMinKills: 4,
    hurtAberration: 0.4, dashAberration: 0.25, slowAberration: 0.15,
    shakeExponent: 2, shakeAmpMax: 1.8,
    assistRange: 45, assistConeDeg: 4, assistSlowdown: 0.5, assistPull: 0.12,
  };
}

/** 生效的手感表（Unity FeelProfile.Active） */
export const FEEL: FeelProfile = defaultFeel();

/** 震屏的画面幅度（未乘设置）：上限 × trauma ^ 指数，封顶（Unity FeelProfile.ShakeAmplitude） */
export function shakeAmplitude(trauma: number, feel: FeelProfile = FEEL): number {
  const t = Math.min(1, Math.max(0, trauma));
  return Math.min(feel.shakeAmpMax, SHAKE_MAX_STRENGTH * Math.pow(t, Math.max(0.5, feel.shakeExponent)));
}
