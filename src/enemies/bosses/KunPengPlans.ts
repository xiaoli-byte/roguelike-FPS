/**
 * 鲲鹏八招的纯数据（Unity KunPeng/Moves/*.cs 的常量与构造函数里的调度参数）与倒下演出的节拍（KunPengDeath）。
 * 不碰场景：KunPengDef、击杀用时模型、node 测试、运行时招式（KunPengMoves.ts）都读这里，一处改数。
 * 时间轴：Three.js 的 at(t) 在 Unity 里拆成前摇 / 出手 / 收招三段，每招的总长仍是 Three.js 的结束时刻（吞吸 4.6、猛砸 2.5、潜袭 3.0、吐冰 1.3、狂风 5.8…）。
 * 角度一律世界 yaw（度，0 = +Z）。
 */
import { bossMove, type BossMoveSpec } from './framework/BossDef';

export const KUN = 'kun';
export const PENG = 'peng';

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const span = (t: number, a: number, b: number): number => (b > a ? Math.min(1, Math.max(0, (t - a) / (b - a))) : t >= b ? 1 : 0);

// ───────────── 鲲 · 吞吸 ─────────────
export const KunInhale = {
  id: 'inhale',
  name: '鲲 · 吞吸',
  /** 扇形预警的半径 / 半角（度）、拉人的半角与够得着的距离、扑咬半径、扑咬预警在出手段的第几秒 */
  SectorRange: 22, SectorHalf: 35.5, PullHalf: 43, PullReach: 30, BiteRadius: 5.5, BiteWarnAt: 2.2,
  /** 收头蓄咬在出手段里的时刻（inhale 第 105 帧 = 3.5 s） */
  BiteWindAt: 2.6,
  spec: bossMove({ id: 'inhale', name: '鲲 · 吞吸', forms: [KUN], cooldown: 11, recovery: 1.2, firstDelay: 2, weight: 1.8, windup: 0.9, active: 3, recover: 0.7 }),
  /** 玩家离得远（> 14 m）更爱吸 */
  weight(distance: number): number {
    return distance > 14 ? 3 : 1.8;
  },
};

// ───────────── 鲲 · 猛砸冰浪 ─────────────
export const KunSlam = {
  id: 'slam',
  name: '鲲 · 猛砸冰浪',
  /** 落点半径、冰浪射程 / 半角、鲲怒时两侧窄扇的偏角 / 半角 / 射程、第二道冰浪在出手段的第几秒 */
  BlastRadius: 5, WaveRange: 28, WaveHalf: 31.5, SideYaw: 43, SideHalf: 17.2, SideRange: 18, Wave2At: 0.45,
  /** 蓄力顶点在前摇里的比例（slamWind 第 19 / 33 帧） */
  ApexAt: 19 / 33,
  spec: bossMove({ id: 'slam', name: '鲲 · 猛砸冰浪', forms: [KUN], cooldown: 7, recovery: 1.1, firstDelay: 0.5, weight: 2.6, windup: 1.1, active: 0.85, recover: 0.55 }),
};

// ───────────── 鲲 · 潜袭 ─────────────
export const KunDive = {
  id: 'dive',
  name: '鲲 · 潜袭',
  /** 几秒起不可选中、几秒亮破冰预警、几秒在水下换位、新方位的随机偏差（度）、破冰半径、冰浪半角、「玩家离得远」的方位差（度） */
  SubmergeAt: 0.5, WarnAt: 0.7, RelocateAt: 1.2, Spread: 20, BlastRadius: 4.5, WaveHalf: 68.75, FarOff: 68.75,
  /** 沉：0.15 s 起、0.8 s 沉到底；下潜水花；破水而出、升到顶 */
  SinkFrom: 0.15, SinkTo: 0.8, PlungeAt: 0.43, BreachAt: 1.6, RiseTo: 1.9,
  /** 破水前多久水面开始隆起 */
  DomeLead: 0.4,
  spec: bossMove({ id: 'dive', name: '鲲 · 潜袭', forms: [KUN], cooldown: 9, recovery: 0.8, firstDelay: 6, weight: 1.6, windup: 2, active: 0.3, recover: 0.7 }),
  /** 玩家在冰窟另一侧（方位差 > 68.75°）时权重 4，否则 1.6 */
  weight(offDeg: number): number {
    return Math.abs(offDeg) > 68.75 ? 4 : 1.6;
  },
  /**
   * 沉浮曲线（0 = 露出水面，1 = 完全沉下去）：0.15–0.8 s 沉下去（EaseInOut）；1.6 s 破水、0.3 s 冲到顶（1 − EaseOutCubic），扑咬那一帧已经整只出水
   */
  sunkAt(t: number): number {
    return t < 1.6 ? easeInOut(span(t, 0.15, 0.8)) : 1 - easeOutCubic(span(t, 1.6, 1.9));
  },
};

// ───────────── 鲲 · 吐冰 ─────────────
export const KunSpit = {
  id: 'spit',
  name: '鲲 · 吐冰',
  /** 最近出招距离、预判秒数、飞行时间、拱高、落点半径 */
  MinRange: 12, Lead: 0.6, Flight: 1.15, Arc: 7, Radius: 2.6,
  spec: bossMove({ id: 'spit', name: '鲲 · 吐冰', forms: [KUN], cooldown: 5, recovery: 0.9, firstDelay: 3, weight: 1.6, windup: 0.7, active: 0.1, recover: 0.5 }),
  weight(distance: number): number {
    return distance > 12 ? 1.6 : 0;
  },
  /** 第 i 块冰弹的侧向偏移（米）：0、+3.2、−3.2、+6.2 */
  side(i: number): number {
    return i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * (3.2 + Math.floor((i - 1) / 2) * 3);
  },
};

// ───────────── 鹏 · 扇翼狂风 ─────────────
export const PengGust = {
  id: 'gust',
  name: '鹏 · 扇翼狂风',
  /** 飞到冰窟上空的时长、冻风带的预警下限 / 生效时长 */
  FlyIn: 1.6, ZoneArm: 1, ZoneSeconds: 3.6,
  /** 下扇周期（片段 17 帧）、蓄力顶点 */
  FlapPeriod: 17 / 30, ApexAt: 1.8,
  spec: bossMove({ id: 'gust', name: '鹏 · 扇翼狂风', forms: [PENG], cooldown: 12, recovery: 1.2, firstDelay: 1.5, weight: 2, windup: 2, active: 3.4, recover: 0.4 }),
};

// ───────────── 鹏 · 俯冲掠台 ─────────────
export const PengSwoop = {
  id: 'swoop',
  name: '鹏 · 俯冲掠台',
  AimMax: 1.8, TeleSeconds: 0.9, DiveSpeed: 26, DiveAlt: 0.6, DiveMax: 2.6, HalfWidth: 2.3, HitRadius: 1.6, CrashStagger: 1.8,
  /** 撞柱探针：双爪上方多高、多粗 */
  ProbeLift: 1.5, ProbeRadius: 0.35,
  /** 预警时悬停的高度、俯冲往下压的竖直速度 */
  TeleAlt: 7, DescentRate: 13.5,
  /** 线截短：陡面前多少米拉起、至少过玩家多少米；拉起的刹车加速度与上抬速度 */
  PullUp: 8, PastPlayer: 3, PullBrake: 60, PullLift: 12,
  /** 横向偏差拉回预警线的速率（1/秒）与横向速度上限 */
  LineGain: 4, LineMaxSide: 14,
  spec: bossMove({ id: 'swoop', name: '鹏 · 俯冲掠台', forms: [PENG], cooldown: 7, recovery: 1, firstDelay: 3.5, weight: 2.6, windup: 1.8 + 0.9, active: 8, recover: 0.6 }),
  weight(distance: number): number {
    return distance > 10 ? 2.6 : 1.6;
  },
};

// ───────────── 鹏 · 羽刃雨 ─────────────
export const PengFeatherRain = {
  id: 'rain',
  name: '鹏 · 羽刃雨',
  Feathers: 10, RageFeathers: 14, Interval: 0.11, Flight: 1.05, Radius: 2.1, RainAlt: 17,
  spec: bossMove({ id: 'rain', name: '鹏 · 羽刃雨', forms: [PENG], cooldown: 9, recovery: 1, firstDelay: 5, weight: 2, windup: 0.9, active: 10 * 0.11, recover: 0.6 }),
};

// ───────────── 鹏 · 落台歇翼 ─────────────
export const PengPerch = {
  id: 'perch',
  name: '鹏 · 落台歇翼',
  ApproachAlt: 9, ApproachMax: 3, DescendSeconds: 0.9, RestSeconds: 4.8, TakeoffWarnAt: 4, LandRadius: 5, TakeoffRadius: 7,
  /** perch / takeoff 片段的长度 */
  PerchClip: 1.8, TakeoffClip: 1.6,
  /** 落台点的试探偏角（度，first 之后依次试） */
  tries(first: number): number[] {
    return [first, first + 20, first - 17.2, first + 40.1, -first, -first - 20, first + 63, -first + 17.2];
  },
  spec: bossMove({ id: 'perch', name: '鹏 · 落台歇翼', forms: [PENG], cooldown: 14, recovery: 0.6, firstDelay: 10, weight: 3.4, windup: 3 + 0.9, active: 4.8, recover: 0.8 }),
  /** 飞累了（上次歇翼后出过两招）才落台 */
  weight(movesSincePerch: number): number {
    return movesSincePerch >= 2 ? 3.4 : 0;
  },
};

/** 八招（定义顺序 = Unity KunPengDef.moves 的顺序） */
export const KUNPENG_MOVES = [KunInhale, KunSlam, KunDive, KunSpit, PengGust, PengSwoop, PengFeatherRain, PengPerch] as const;

export function kunPengSpecs(): BossMoveSpec[] {
  return KUNPENG_MOVES.map(m => ({ ...m.spec, forms: m.spec.forms ? [...m.spec.forms] : null }));
}

/** 倒下演出的节拍（Unity KunPengDeath）：代理 / 程序化体的落地比例与没顶比例；手 K death 片段的翼折 / 触地 / 最后一声（秒） */
export const KunPengDeath = {
  LandAt: 0.55, SunkAt: 0.8,
  BreakTime: 0.4, LandTime: 2.4, CryTime: 2.93, FallFrom: 0.2, ClipSeconds: 4,
  /** 坠进北冥后往下沉多深（米） */
  SinkDepth: 7,
};
