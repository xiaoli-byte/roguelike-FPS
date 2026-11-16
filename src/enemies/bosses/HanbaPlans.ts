/**
 * 旱魃招式的纯数据（Unity Hanba/Moves/*.cs 的常量、调度参数、按阶段节奏的时间轴 Plan）与动作片段的事件表
 * （unity/Assets/Art/Characters/SK_Boss_Hanba/Anim/SK_Boss_Hanba.events.json，由 art/source/characters/SK_Boss_Hanba/anim/hanba_anims.py 生成；30 fps）。
 * 不碰场景：HanbaDef、击杀用时模拟（HanbaBalance）、node 测试、运行时招式（HanbaMoves.ts）都读这里，一处改数。
 */
import { bossMove, type BossMoveSpec } from './framework/BossDef';

/** 一招的时间轴（秒）：前摇 / 出手 / 收招 */
export interface HanbaMovePlan {
  windup: number;
  active: number;
  recover: number;
}

export function planTotal(p: HanbaMovePlan): number {
  return p.windup + p.active + p.recover;
}

const paced = (windup: number, pace: number) => Math.max(0.25, windup / Math.max(0.5, pace));

// ───────────── 日轮扫射（Phase1SunSweep）─────────────
export const SunSweep = {
  id: 'sun_sweep',
  name: '日轮扫射',
  /** 扫射总角度、角速度（度 / 秒，× 节奏）、落点距离范围、判定半径、外观半宽、判定间隔、细分步长 */
  Arc: 110, Speed: 48, MinRange: 7, MaxRange: 26, HitRadius: 0.85, VisualRadius: 0.45, HitEvery: 0.45, SubStep: 0.5,
  /** 每次灼伤的伤害倍率、额外日晒秒数 */
  DamageMult: 0.85, BurnSeconds: 0.5,
  /** 片段 sunSweep 121 帧，beamStart / hit 在 36 帧 */
  ClipHit: 36 / 121,
  FadeSeconds: 0.18,
  spec: bossMove({ id: 'sun_sweep', name: '日轮扫射', cooldown: 9, recovery: 1, weight: 2.4, windup: 1.4, active: 110 / 48, recover: 1 }),
  /** 出手 = 扫满 110° 的时长（角速度 × 节奏） */
  plan(pace: number): HanbaMovePlan {
    return { windup: paced(1.4, pace), active: 110 / (48 * Math.max(0.5, pace)), recover: 1 };
  },
  weight(base: number, distance: number): number {
    return distance > 6 ? base : base * 0.4;
  },
};

// ───────────── 旱风（Phase1HotWind）─────────────
export const HotWind = {
  id: 'hot_wind',
  name: '旱风',
  /** 扇区半径、半角（度）、扩散速度、环带厚度、可命中的高度、推力、伤害倍率、额外日晒秒数 */
  Range: 22, HalfAngle: 38, Speed: 26, Width: 3, Height: 4.5, Knockback: 15, DamageMult: 1, BurnSeconds: 1,
  /** 片段 droughtGale 84 帧，hit 在 30 帧 */
  ClipHit: 30 / 84,
  spec: bossMove({ id: 'hot_wind', name: '旱风', cooldown: 7, recovery: 1.1, weight: 2.6, windup: 1.1, active: 22 / 26 + 0.25, recover: 0.9 }),
  /** 出手 = 热浪扩到 22 m（二阶段起多一道余波） */
  activeSeconds(pace: number): number {
    return 22 / 26 + (pace > 1.01 ? 0.45 : 0.25);
  },
  plan(pace: number): HanbaMovePlan {
    return { windup: paced(1.1, pace), active: HotWind.activeSeconds(pace), recover: 0.9 };
  },
  weight(base: number, distance: number): number {
    return distance < 22 - 2 ? base : base * 0.25;
  },
};

// ───────────── 召沙魇（Phase1SandWraiths）─────────────
export const SandWraiths = {
  id: 'sand_wraiths',
  name: '召沙魇',
  /** 片段 summonWraiths 84 帧，summon 在 48 帧 */
  ClipHit: 48 / 84,
  spec: bossMove({ id: 'sand_wraiths', name: '召沙魇', cooldown: 18, recovery: 1.2, weight: 1.6, firstDelay: 5, windup: 1.6, active: 0.3, recover: 1 }),
  plan(pace: number): HanbaMovePlan {
    return { windup: paced(1.6, pace), active: 0.3, recover: 1 };
  },
  /** 这一阶段召几只（一阶段 3、之后 4） */
  countFor(phase: number): number {
    return phase >= 1 ? 4 : 3;
  },
  /** 场上（在场 + 预警中）加上这次要召的会超过上限时权重为 0 */
  weight(base: number, alive: number, pending: number, phase: number, cap: number): number {
    return alive + pending + SandWraiths.countFor(phase) > cap ? 0 : base;
  },
};

// ───────────── 焦裂（Phase2CrackLine）─────────────
export const CrackLine = {
  id: 'scorch_crack',
  name: '焦裂',
  /** 裂缝蔓延速度、分段长、走到头后多久爆、逐段间隔、每段爆炸半径、伤害倍率、长条半宽、长度范围、扇形张角 */
  CrackSpeed: 18, Step: 1.5, ExplodeDelay: 0.45, ChainGap: 0.035, BlastRadius: 1.7, DamageMult: 1.25,
  HalfWidth: 1.3, MinLength: 14, MaxLength: 28, FanAngle: 28,
  /** 片段 crackPalm 150 帧，hit 在 36 帧 */
  ClipHit: 36 / 150,
  spec: bossMove({ id: 'scorch_crack', name: '焦裂', cooldown: 8, recovery: 1.0, weight: 2.2, minPhase: 1, windup: 1.2, active: 1.4, recover: 0.9 }),
  /** 一条长 length 的裂缝从按掌到爆完要多久 */
  activeSeconds(length: number): number {
    return length / 18 + 0.45 + Math.ceil(length / 1.5) * 0.035 + 0.15;
  },
  /** 出手 = 掌按在地上，等最长的一条蔓延到头、爆完（按平均 22 m 的线估） */
  plan(pace: number): HanbaMovePlan {
    return { windup: paced(1.2, pace), active: CrackLine.activeSeconds(22), recover: 0.9 };
  },
  /** 这一阶段几条（二阶段 1 条，三阶段起 3 条成扇） */
  countFor(phase: number): number {
    return phase >= 2 ? 3 : 1;
  },
  weight(base: number, distance: number): number {
    return distance > 4 ? base : base * 0.3;
  },
};

// ───────────── 飞天之殇（Phase2ApsaraCall）─────────────
export const ApsaraCall = {
  id: 'apsara_call',
  name: '飞天之殇',
  /** 片段 apsaraCall 90 帧，summon 在 54 帧（60%） */
  ClipHit: 0.6,
  spec: bossMove({ id: 'apsara_call', name: '飞天之殇', cooldown: 30, recovery: 1.2, weight: 1.4, minPhase: 1, windup: 1.8, active: 0.4, recover: 1.0 }),
  plan(pace: number): HanbaMovePlan {
    return { windup: paced(1.8, pace), active: 0.4, recover: 1.0 };
  },
};

// ───────────── 日蚀（Phase3Eclipse）─────────────
export const Eclipse = {
  id: 'eclipse',
  name: '日蚀',
  /** 片段原速：eclipseStart 在 0.667 s，eclipseEnd 在 3.667 s，flare 在 3.933 s，全长 4.5 s */
  Lead: 0.667, FlareAfter: 0.267, ClipSeconds: 4.5,
  /** 强光预警（倒计时）的半径 */
  WarnRadius: 7,
  /** 日冕倒计时珠的颗数 */
  Beads: 8,
  spec: bossMove({ id: 'eclipse', name: '日蚀', cooldown: 24, recovery: 1.4, weight: 1.8, minPhase: 2, windup: 0.667, active: 3, recover: 1.2 }),
  /** 时间轴固定（不吃节奏）：前摇 0.67 s + 窗口 + 收招 */
  plan(_pace: number): HanbaMovePlan {
    return { windup: 0.667, active: 3, recover: 1.2 };
  },
};

/** 六招（定义顺序 = Unity HanbaDef.moves 的顺序：模拟按这个顺序累权重抽招） */
export const HANBA_MOVES = [SunSweep, HotWind, SandWraiths, CrackLine, ApsaraCall, Eclipse] as const;

export function hanbaPlan(id: string, pace: number): HanbaMovePlan {
  const m = HANBA_MOVES.find(x => x.id === id);
  if (!m) throw new Error(`没有招式 ${id}`);
  return m.plan(pace);
}

export function hanbaSpecs(): BossMoveSpec[] {
  return HANBA_MOVES.map(m => ({ ...m.spec }));
}

// ───────────── 动作片段（30 fps；at = 片段内归一化时刻）─────────────

export interface HanbaClip {
  frames: number;
  loop?: boolean;
  events: readonly (readonly [number, string])[];
}

export const HANBA_FPS = 30;

/** SK_Boss_Hanba.events.json 原样（Unity 的 OnAnimEvent 叠加表） */
export const HANBA_CLIPS: Readonly<Record<string, HanbaClip>> = {
  Idle: { frames: 90, loop: true, events: [] },
  intro: { frames: 120, events: [[0, 'sfx:telegraph'], [0.5833, 'roar'], [0.5833, 'sfx:boss_roar'], [0.5833, 'fx:shake']] },
  sunSweep: { frames: 121, events: [[0, 'fx:lineWarning'], [0, 'sfx:enemy_charge'], [0.1405, 'fx:raise'], [0.2975, 'hit'], [0.2975, 'beamStart'], [0.7851, 'beamEnd']] },
  droughtGale: { frames: 84, events: [[0, 'fx:sectorWarning'], [0, 'sfx:telegraph'], [0.3571, 'hit'], [0.3571, 'fx:shake'], [0.3571, 'sfx:boss_roar']] },
  summonWraiths: { frames: 84, events: [[0, 'fx:groundWarning'], [0, 'sfx:telegraph'], [0.5714, 'summon'], [0.5714, 'fx:shake']] },
  crackPalm: { frames: 150, events: [[0, 'fx:lineWarning'], [0, 'sfx:telegraph'], [0.24, 'hit'], [0.24, 'fx:shake'], [0.24, 'sfx:boss_slam'], [0.7733, 'fx:palmOut']] },
  apsaraCall: { frames: 90, events: [[0, 'sfx:telegraph'], [0.6, 'summon'], [0.6, 'fx:shake']] },
  eclipse: { frames: 135, events: [[0, 'sfx:telegraph'], [0.1481, 'eclipseStart'], [0.7704, 'fx:gather'], [0.8148, 'eclipseEnd'], [0.8741, 'flare'], [0.8741, 'fx:shake'], [0.8741, 'sfx:boss_roar']] },
  Hit: { frames: 21, events: [] },
  death: { frames: 120, events: [[0, 'sfx:boss_roar'], [0.5, 'collapse'], [0.5, 'fx:shake'], [0.7917, 'fx:shake'], [0.7917, 'sfx:boss_slam']] },
};

export function clipSeconds(state: string): number {
  const c = HANBA_CLIPS[state];
  return c ? c.frames / HANBA_FPS : 0;
}

/** 出手事件比按时间兜底的出手早到多少（秒，约 1 帧） */
export const ANIM_LEAD = 1 / 60;

/** ActAt：让出手事件（片段里的位置 = hitFraction）落在 hitAt 秒之前 ANIM_LEAD 的整段播放时长 */
export function actAtSeconds(hitFraction: number, hitAt: number): number {
  return Math.max(0.1, hitAt - ANIM_LEAD) / Math.max(0.01, hitFraction);
}

/** Unity HanbaBrain.Act 的 ActScale：片段时长 ÷ 想要的时长，夹在 0.4–2.5（seconds ≤ 0.05 时原速） */
export function actScale(state: string, seconds: number): number {
  const len = clipSeconds(state);
  return len > 0 && seconds > 0.05 ? Math.min(2.5, Math.max(0.4, len / seconds)) : 1;
}
