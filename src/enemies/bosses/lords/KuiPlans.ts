/**
 * 夔八招的纯数据（Unity Kui/Moves/KuiGround.cs、KuiJumps.cs 的常量与构造函数里的调度参数；时间轴照 docs/art/ch4-move-events.json）。
 */
import { bossMove } from '../framework/BossDef';

/** 雷兽的色板（Unity KuiPalette） */
export const KuiPalette = {
  ThunderCore: 0xfff4fd, Thunder: 0xe05ad8, ThunderEdge: 0x4a2a7a,
  SkinCore: 0xfff0e0, Skin: 0xc89a6a, SkinEdge: 0x5a3a2a,
  CloudSeam: 0xc8b8ff, Cloud: 0x6a6080, CloudDark: 0x3a3448,
  Dust: 0x8a7a60, DustCold: 0x5a5a62,
} as const;

/** 小跳：3.5 m 一跳（离玩家留 3 m），高 1.4 m；落地 3.5 m 小冲击 8；可被眩晕 */
export const KuiHopPlan = {
  id: 'hop', name: '小跳', Height: 1.4, Reach: 3.5, Keep: 3, ImpactRadius: 3.5, WebDamage: 8,
  spec: bossMove({ id: 'hop', name: '小跳', windup: 0.3, active: 0.55, recover: 0.25, cooldown: 0, recovery: 0.35, weight: 1, stunnable: true }),
};

/** 大跳（一二阶段）：朝玩家跳 14 m、高 4.2 m；落点 4 m 预警；鼓皮冲击环扩到 16 m（0.9 s）、22，跳起来躲 */
export const KuiLeapPlan = {
  id: 'leap', name: '大跳', Height: 4.2, Reach: 14, Keep: 0, RingRadius: 16, RingSeconds: 0.9, RingDamage: 22, LandWarn: 4,
  // Unity KuiLeap.Allowed：base && Phase < 2（三阶段换连环大跳）= maxPhase 1
  spec: bossMove({ id: 'leap', name: '大跳', windup: 0.75, active: 1.05, recover: 0.8, cooldown: 1.5, recovery: 0.35, weight: 6, firstDelay: 1, maxPhase: 1 }),
};

/** 连环大跳（三阶段）：三连砸，每跳 10 m、高 3.2 m；第三跳后跪得更久（收招 + 0.6 s） */
export const KuiLeapChainPlan = {
  id: 'leapChain', name: '连环大跳', Height: 3.2, Reach: 10, Count: 3, LastExtraRecover: 0.6,
  spec: bossMove({ id: 'leapChain', name: '连环大跳', windup: 0.5, active: 0.9, recover: 0.35, cooldown: 2, recovery: 0.35, weight: 6, minPhase: 2 }),
};

/** 转身跳：玩家绕到身后（> 115°、12 m 内），原地一蹲、空中转 180°，落地 5 m 冲击 10 */
export const KuiTurnLeapPlan = {
  id: 'turnLeap', name: '转身跳', Height: 1.4, ImpactRadius: 5, WebDamage: 10, BehindDeg: 115, Near: 12,
  spec: bossMove({ id: 'turnLeap', name: '转身跳', windup: 0.3, active: 0.5, recover: 0.3, cooldown: 2.5, recovery: 0.35, weight: 20, stunnable: true }),
};

/** 拄拳：不攻击，绕拉则挪位（2.5 m/s），三步 × 1.3 s；远于 12 m 时偶尔出 */
export const KuiKnucklePlan = {
  id: 'knuckle', name: '拄拳', Speed: 2.5, StepSeconds: 1.3, Far: 12,
  spec: bossMove({ id: 'knuckle', name: '拄拳', windup: 0, active: 3.9, recover: 0, cooldown: 5, recovery: 0.35, weight: 0.6, stunnable: true, firstDelay: 2 }),
};

/** 雷掌：正面 8 m 内，扇形 60° / 8 m；16 + 雷殛 + 击退；可被眩晕 */
export const KuiClapPlan = {
  id: 'clap', name: '雷掌', Range: 8, HalfAngle: 30, WebDamage: 16,
  spec: bossMove({ id: 'clap', name: '雷掌', windup: 0.6, active: 0.2, recover: 0.6, cooldown: 4, recovery: 0.35, weight: 4, stunnable: true }),
};

/** 捶胸引雷（二阶段）：三捶（0.8 / 1.4 / 2.0 s），每捶玩家脚下 + 随机一处各一道雷（1.2 s 预警、3.2 m、18）；霸体 */
export const KuiDrumPlan = {
  id: 'drum', name: '捶胸引雷', Warn: 1.2, BoltRadius: 3.2, WebDamage: 18, Interval: 0.6, Beats: 3,
  spec: bossMove({ id: 'drum', name: '捶胸引雷', windup: 0.8, active: 1.8, recover: 1.0, cooldown: 3, recovery: 0.35, weight: 50, minPhase: 1, maxPhase: 1, stunnable: false }),
};

/** 捶胸引雷（五下，三阶段）：五捶在 0.8 / 1.4 / 2.0 / 2.6 / 3.2 s，最后一捶双拳一起砸 */
export const KuiDrum5Plan = {
  id: 'drum5', name: '捶胸引雷（五下）', Beats: 5,
  spec: bossMove({ id: 'drum5', name: '捶胸引雷（五下）', windup: 0.8, active: 3.0, recover: 1.0, cooldown: 3, recovery: 0.35, weight: 50, minPhase: 2, stunnable: false }),
};

export const KUI_PLANS = [KuiHopPlan, KuiLeapPlan, KuiLeapChainPlan, KuiTurnLeapPlan, KuiKnucklePlan, KuiClapPlan, KuiDrumPlan, KuiDrum5Plan];
