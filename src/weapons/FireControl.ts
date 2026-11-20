/**
 * 武器开火控制的纯逻辑（Unity Weapons/FireModes/WeaponTiming.cs + IFireMode.cs 的 TriggerState / FireInput，
 * WeaponController.cs 的开镜 / 散布 / 后坐常数）。WeaponSystem 读这里，node --test 直接测（不 import 任何东西）。
 *
 * 和 M8 之前的网页版不一样的地方（都照 Unity）：
 *   · 扳机闩 TriggerState：「扣了一下」= 开火缓冲里（按下后 0.14 s 内）或按住但这次按压还没打出过——
 *     冷却中按住不放，冷却一好就打出这一发；任何一发打出后都要松开扳机，半自动 / 点射 / 齐射才会再响应「按住」；
 *   · 冲刺禁射 blocked：冲刺中半自动 / 全自动 / 光束 / 齐射不开火，点射暂停（冲刺完接着打完这一轮），
 *     机炮转速保持但不开火，蓄力不受影响（冲刺照样能蓄、能松手）；
 *   · 开镜：换弹 / 切枪 / 冲刺 / 被接管（碎刃）时不开镜，开镜程度每秒 7（线性，约 0.14 s 开完），视角层 = aimFov × 开镜程度；
 *   · 散布：跑动 +20%（开镜 +10%）、滞空 ×1.15（开镜 ×1.05）——原来是 +60% / ×1.5：边跑边打、跳起来打都要打得中；
 *     进了镜（视角层 < −30°，只有鹰隼狙击够得到）零散布；
 *   · 后坐：镜头的抬枪量 × 0.3 且完全回正（PlayerController 的回正比例 1），枪模后坐另算（随 M10）。
 */

/** Unity WeaponTiming */
export const WEAPON_TIMING = {
  /** 切枪总时长（收枪 + 掏枪），期间不能开火；其中收枪所占比例 */
  SwitchTime: 0.35,
  HolsterFrac: 0.4,
  /** 开火缓冲：提前按下也能在冷却结束时打出 */
  FireBuffer: 0.14,
  /** 打空后（没按扳机时）自动换弹的延迟 */
  AutoReloadDelay: 0.25,
  /** 逐发装填结束（装满或被开火打断）后的上膛时间，期间不能开火 */
  ShellRack: 0.3,
  /** 全自动 / 光束 / 机炮同一帧最多补发几发 */
  MaxCatchUp: 4,
  /** 空仓音的最小间隔 */
  DryInterval: 0.3,
  /** 应急补给：所有武器弹匣与备弹全空持续多久（只在有活着的敌人时） */
  StarveTime: 2.5,
  /** 机炮松手后转速归零的时间；蓄力线圈松手后转停的时间 */
  SpinDown: 0.9,
  CoilDown: 0.6,
  /** 整匣换弹的最短时间 */
  MinReload: 0.2,
  /** 逐发装填被开火打断后，缓冲至少保留到上膛结束再多这么久 */
  RackBufferPad: 0.05,
} as const;

/** Unity WeaponController 的手感常数 */
export const WEAPON_FEEL = {
  /** 后坐整体缩放：镜头只轻轻上跳且完全回正（不是硬核 FPS，后坐只做手感、不做惩罚） */
  RecoilScale: 0.3,
  /** 枪模后坐的缩放（枪模保留明显的上抬当作打击感；随 M10 的枪模弹簧一起接） */
  ViewKickScale: 0.55,
  /** 持接管武器（碎刃）时准星张开到这个半角 */
  MeleeHudSpread: 0.035,
  /** 开镜程度每秒变化量（Mathf.MoveTowards(aimT, 目标, dt × 7)） */
  AimRate: 7,
  /** 跑动散布：1 + clamp01(水平速度 / 7.5) × (MoveSpread − MoveSpreadAim × 开镜) */
  MoveSpread: 0.2,
  MoveSpreadAim: 0.1,
  MoveSpreadSpeed: 7.5,
  /** 滞空散布：AirSpread − AirSpreadAim × 开镜 */
  AirSpread: 1.15,
  AirSpreadAim: 0.1,
  /** 连射累积在开镜时的折扣、霰弹锥在开镜时收到的比例 */
  BloomAim: 0.45,
  PelletAim: 0.72,
  HudSpreadMax: 0.25,
  HudLambda: 18,
  /** 开镜视角层阈值（度，Unity WeaponSight.ScopeKick）：低于它算进了镜 */
  ScopeKick: -30,
  /** 蓄力射击的反馈强度 0.4 + 0.6·t */
  ChargeStrengthMin: 0.4,
} as const;

/**
 * 扳机：开火缓冲 + 「按住只算一次」的闩（Unity TriggerState）。
 * 缓冲：按下时置为 FireBuffer，之后每帧递减。
 */
export class TriggerState {
  buffer = 0;
  /** 这次按压已经打出过（松开后复位） */
  held = false;

  get buffered(): boolean {
    return this.buffer > 0;
  }

  update(pressed: boolean, down: boolean, dt: number): void {
    if (!down) this.held = false;
    this.buffer = pressed ? WEAPON_TIMING.FireBuffer : Math.max(0, this.buffer - dt);
  }

  /** 「扣了一下」：缓冲里，或按住但这次按压还没打出过 */
  pulled(down: boolean): boolean {
    return this.buffer > 0 || (down && !this.held);
  }

  /** 吃掉这次扣扳机（清开火缓冲、标记按住已打出） */
  consume(): void {
    this.buffer = 0;
    this.held = true;
  }

  reset(): void {
    this.buffer = 0;
    this.held = false;
  }
}

/** 两发之间的间隔（秒）：射速下限 0.1 发 / 秒（Unity FireModeBase.Interval） */
export function fireInterval(rate: number): number {
  return 1 / Math.max(0.1, rate);
}

/** 能打出这一发：ready（不在切枪、不在换弹、活着）且没被冲刺挡住（Unity FireInput.CanShoot） */
export function canShoot(ready: boolean, blocked: boolean): boolean {
  return ready && !blocked;
}

/** 蓄力倍率：min + (1 − min) × t²（Unity WeaponTiming.ChargeMult；贯虹灵炮 min = 0.2） */
export function chargeMult(minMult: number, t: number): number {
  t = Math.max(0, Math.min(1, t));
  return minMult + (1 - minMult) * t * t;
}

/** 蓄力射击的反馈强度 0.4 + 0.6·t（Unity ChargeMode.Shot） */
export function chargeStrength(t: number): number {
  return WEAPON_FEEL.ChargeStrengthMin + (1 - WEAPON_FEEL.ChargeStrengthMin) * Math.max(0, Math.min(1, t));
}

/** 开镜程度推进一帧（线性，Unity Mathf.MoveTowards） */
export function aimStep(aimT: number, aiming: boolean, dt: number): number {
  const target = aiming ? 1 : 0;
  const step = Math.max(0, dt) * WEAPON_FEEL.AimRate;
  return Math.abs(target - aimT) <= step ? target : aimT + Math.sign(target - aimT) * step;
}

/** 能不能开镜：换弹 / 切枪 / 冲刺 / 被接管时不开（Unity WeaponController.Update） */
export function aimAllowed(s: { aimInput: boolean; takeover: boolean; reloading: boolean; switchTimer: number; dashing: boolean }): boolean {
  return s.aimInput && !s.takeover && !s.reloading && s.switchTimer <= 0 && !s.dashing;
}

/** 视角层是否已经「进了镜」（Unity WeaponSight.Scoped） */
export function scoped(fovKick: number): boolean {
  return fovKick < WEAPON_FEEL.ScopeKick;
}

/**
 * 当前散布半角（Unity WeaponController.UpdateSpread）：
 * (腰射 / 开镜基础 × 移动 × 空中 + 连射累积 × (1 − 0.45 × 开镜)) × 散布倍率；进了镜为 0。
 * base = lerp(spreadHip, spreadAim, aimT)
 */
export function spreadAngle(base: number, speedH: number, grounded: boolean, aimT: number, bloom: number, spreadMult: number, fovKick = 0): number {
  if (scoped(fovKick)) return 0;
  const F = WEAPON_FEEL;
  const moveF = 1 + Math.max(0, Math.min(1, speedH / F.MoveSpreadSpeed)) * (F.MoveSpread - F.MoveSpreadAim * aimT);
  const airF = grounded ? 1 : F.AirSpread - F.AirSpreadAim * aimT;
  return (base * moveF * airF + bloom * (1 - F.BloomAim * aimT)) * spreadMult;
}

/** 停火多久之后散布开始恢复：略长于射击间隔（Unity：clamp(1.25 / (射速 × 点射数), 0.08, 0.35)） */
export function bloomDelay(fireRate: number, burstCount: number): number {
  return Math.max(0.08, Math.min(0.35, 1.25 / Math.max(0.1, fireRate * Math.max(1, burstCount))));
}

/**
 * 切枪姿态（Unity WeaponTiming.SwitchPose）：先收后出。holster = 这一刻该显示旧枪；lower = 下沉量 0..1。
 * 没有旧枪（开局、拾取替换当前槽）时只有新枪从底下抬起
 */
export function switchPose(switchTimer: number, hasHolster: boolean): { holster: boolean; lower: number } {
  if (switchTimer <= 0) return { holster: false, lower: 0 };
  const t = 1 - Math.max(0, Math.min(1, switchTimer / WEAPON_TIMING.SwitchTime));
  if (!hasHolster) return { holster: false, lower: 1 - t };
  if (t < WEAPON_TIMING.HolsterFrac) return { holster: true, lower: t / WEAPON_TIMING.HolsterFrac };
  return { holster: false, lower: 1 - (t - WEAPON_TIMING.HolsterFrac) / (1 - WEAPON_TIMING.HolsterFrac) };
}
