/**
 * 熔心魔将定义（Unity Bosses/Warlord/WarlordDef.cs 逐项照搬；3-3 铸范大坊 / 火神殿终点的领主战，「剑士化 v2」重甲剑士）+ 招式的纯数据与判定几何
 * （WarlordSword.cs、WarlordBladeCombo / Iai / SwordWave / Thrust / Spin 的常量与纯函数、Reference/WarlordMoves.cs 的 WarlordRef / WarlordLeap 判定、
 * Fx.Warlord.cs 的 WarlordPalette）。纯数据 + 纯计算（不碰场景）：运行时（Warlord.ts / WarlordMoves.ts）、模拟（WarlordBalance.ts）、测试都读它。
 *   招式：焰刃连斩（三 / 四 / 五刀）、居合一闪、熔铜剑气、突刺冲锋、回旋斩（二阶段起，狂怒二连）；保留的横扫、跃击、陨石雨（二阶段起）、熔铜渠涨落。
 *   阶段：教招（100–50%）→ 50% 引动熔铜渠（转换后第一招涨落）→ 20% 狂怒（生命层跌破即狂怒；转换后第一招回旋二连）。
 *   弱点：胸口的地火之心 socket_core（半径 0.45 m）；另有肩甲、膝甲两组命中区。
 *   数值：3-3 的难度 2.92 下定档 18000 生命 + 4600 护盾 + 5000 护甲（I3 按首领浸泡实测秒伤重定；WarlordBalance 约 90 s）。
 * 角度一律世界 yaw（度，0 = +Z，方向 = (sin, 0, cos)）。
 */
import { BossDef, bossMove, bossPhase, bossVitals, type BossMoveSpec } from './framework/BossDef';

export interface BossHitZoneDef {
  id: string;
  bone: string;
  radius: number;
  height?: number;
}

const DEG = Math.PI / 180;

// ───────────────────────────── 颜色（WarlordDef / WarlordRef / WarlordPalette） ─────────────────────────────

export const FIRE = 0xff6a1f, EMBERS = 0xffa040, WARN = 0xff4a1a, RAGE = 0xff3010, LAVA = 0xff4a10;

function lerpColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** 熔心魔将的色阶（Fx.Warlord.cs WarlordPalette）：常态亮芯 / 主色 / 暗边，狂怒更白热；紫褐烟、暗月牙、铁渣 */
export const WarlordPalette = {
  Hot: 0xffe6a6, Copper: 0xff8a2e, Deep: 0xb8461a,
  FuryHot: 0xfff6dc, FuryCopper: 0xffb24a, FuryDeep: 0xff4a14,
  Smoke: 0x4e3442, Under: 0x210b0f, Slag: 0x3a2a26,
  hotAt: (fury: number) => lerpColor(WarlordPalette.Hot, WarlordPalette.FuryHot, fury),
  copperAt: (fury: number) => lerpColor(WarlordPalette.Copper, WarlordPalette.FuryCopper, fury),
  deepAt: (fury: number) => lerpColor(WarlordPalette.Deep, WarlordPalette.FuryDeep, fury),
  lerp: lerpColor,
};

// ───────────────────────────── 参考招式的常量（Reference/WarlordMoves.cs WarlordRef） ─────────────────────────────

export const WarlordRef = {
  /** 横扫扇形半角（度）、火浪最大半径、环带宽、预警半径 */
  SweepHalf: 64.74, SweepRadius: 13, SweepWidth: 1.3, SweepWarnRadius: 14,
  /** 连斩：每斩前摇、间隔、扇形半径与半角（度） */
  ComboWindup: 0.5, ComboPer: 0.72, ComboRange: 4.8, ComboHalf: 51.57,
  /** 跃击落点与预警圈中心偏差超过此值（被掩体挡住半路落地）时不结算落点重击；跃击重力 */
  LeapMiss: 2.5, LeapGravity: 30,
} as const;

// ───────────────────────────── 剑士化 v2 的共用常量与判定几何（WarlordSword.cs） ─────────────────────────────

export const WarlordSword = {
  /** 连斩每一刀（slashA / slashB / slashUp / slashC，25 帧）的刀到在第 15 帧 */
  SlashHitAt: 15 / 25,
  /** 居合 iai（48 帧）：第 24 帧拔刀突进、第 36 帧收刀「咔」 */
  IaiDashAt: 24 / 48, IaiHitAt: 36 / 48,
  /** 一道竖剑气 waveSlash（30 帧）：第 19 帧出手 */
  WaveHitAt: 19 / 30,
  /** 横竖两刀 waveCross（40 帧）：第 15 帧横斩（hit）、第 23 帧竖劈（impact） */
  CrossHitAt: 15 / 40, CrossImpactAt: 23 / 40,
  /** 突刺收刀横斩 thrustCut（27 帧）：第 12 帧刀到 */
  ThrustCutHitAt: 12 / 27,
  /** 回旋斩 spin（36 帧）：第 18 帧；二连 spinTwice（54 帧）：第 18 / 32 帧 */
  SpinHitAt: 18 / 36, SpinTwiceHitAt: 18 / 54, SpinTwiceImpactAt: 32 / 54,
  /** 狂怒熔铜长刃：刀光、剑气、回旋的射程倍率 */
  FuryReach: 1.15,
  /** 居合突进用时（秒） */
  IaiDash: 0.14,
} as const;

export function dirOf(yawDeg: number): { x: number; z: number } {
  return { x: Math.sin(yawDeg * DEG), z: Math.cos(yawDeg * DEG) };
}

export function yawOf(x: number, z: number): number {
  return Math.atan2(x, z) / DEG;
}

/** Mathf.DeltaAngle：b − a 折到 (−180, 180] */
export function deltaAngle(a: number, b: number): number {
  let d = ((b - a) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

interface P3 { x: number; y: number; z: number }

/** 扇形判定：脚底水平距离 ≤ radius + pr/2、方位偏离 ≤ 半角 + 玩家半径对应的角度、脚底高差在 [−down, up] */
export function inSector(o: P3, yawDeg: number, halfDeg: number, radius: number, feet: P3, pr: number, up: number, down = 1.5): boolean {
  const dx = feet.x - o.x, dz = feet.z - o.z, dy = feet.y - o.y;
  if (dy > up || dy < -down) return false;
  const d = Math.hypot(dx, dz);
  if (d > radius + pr * 0.5) return false;
  if (d < 0.05) return true;
  const off = Math.abs(deltaAngle(yawDeg, yawOf(dx, dz)));
  return off <= halfDeg + Math.atan2(pr, Math.max(0.5, d)) / DEG;
}

/** 长条判定：from 沿水平方向 dir 长 length、半宽 halfWidth（+ 玩家半径），脚底高差在 [−down, up] */
export function inLane(from: P3, dir: { x: number; z: number }, length: number, halfWidth: number, feet: P3, pr: number, up: number, down = 1.5): boolean {
  const l = Math.hypot(dir.x, dir.z);
  if (l < 1e-3) return false;
  const ux = dir.x / l, uz = dir.z / l;
  const rx = feet.x - from.x, ry = feet.y - from.y, rz = feet.z - from.z;
  if (ry > up || ry < -down) return false;
  const along = rx * ux + rz * uz;
  if (along < -pr || along > length + pr) return false;
  return Math.abs(rx * uz - rz * ux) <= halfWidth + pr;
}

/** 环带判定：水平距离在 [inner − pr, outer + pr]，脚底高差在 [−down, up] */
export function inRing(c: P3, inner: number, outer: number, feet: P3, pr: number, up: number, down = 1.5): boolean {
  const dy = feet.y - c.y;
  if (dy > up || dy < -down) return false;
  const d = Math.hypot(feet.x - c.x, feet.z - c.z);
  return d >= inner - pr && d <= outer + pr;
}

/** 飞行剑气这一帧扫过的范围：前沿从 s0 走到 s1（沿 dir），宽 halfWidth、离地 [floor − 1.5, floor + top]；玩家胶囊和这一段扫过的长方体相交即算 */
export function waveSweeps(origin: P3, dir: { x: number; z: number }, s0: number, s1: number, halfWidth: number, floorY: number, top: number, feet: P3, pr: number): boolean {
  const dy = feet.y - floorY;
  if (dy > top || dy < -1.5) return false;
  const l = Math.hypot(dir.x, dir.z);
  if (l < 1e-3) return false;
  const ux = dir.x / l, uz = dir.z / l;
  const rx = feet.x - origin.x, rz = feet.z - origin.z;
  const along = rx * ux + rz * uz;
  if (along < s0 - pr - 0.35 || along > s1 + pr) return false;
  return Math.abs(rx * uz - rz * ux) <= halfWidth + pr;
}

// ───────────────────────────── 焰刃连斩（WarlordBladeCombo） ─────────────────────────────

export type Stroke = 'kesa' | 'gyaku' | 'rise' | 'cleave';

/** 一刀：warn = 画预警、起动作（相对整招，秒）；strike = 刀到 */
export interface Beat {
  stroke: Stroke;
  warn: number;
  strike: number;
}

const beat = (stroke: Stroke, warn: number, strike: number): Beat => ({ stroke, warn, strike });

export const BladeCombo = {
  id: 'warlord_combo',
  /** 袈裟 / 逆袈裟扇形（半径、半角）、上挑扇形、下劈长条（一阶段 / 之后的长度、半宽） */
  SlashRange: 4.8, SlashHalf: 52, RiseRange: 4.4, RiseHalf: 40, CleaveLen0: 9, CleaveLen: 11, CleaveHalfWidth: 1.25,
  P0: [beat('kesa', 0, 0.5), beat('gyaku', 0.68, 1.14), beat('cleave', 1.38, 1.98)] as readonly Beat[],
  P1: [beat('kesa', 0, 0.46), beat('gyaku', 0.62, 1.04), beat('rise', 1.2, 1.62), beat('cleave', 1.8, 2.3)] as readonly Beat[],
  P2: [beat('kesa', 0, 0.38), beat('gyaku', 0.52, 0.88), beat('kesa', 1.02, 1.38), beat('rise', 1.52, 1.9), beat('cleave', 2.06, 2.5)] as readonly Beat[],
  /** 某阶段（狂怒 = 2）的刀序与节奏 */
  plan(phase: number): readonly Beat[] {
    return phase >= 2 ? BladeCombo.P2 : phase >= 1 ? BladeCombo.P1 : BladeCombo.P0;
  },
  windupOf(b: Beat): number {
    return b.strike - b.warn;
  },
  /** 每一刀的动作状态名 */
  stateOf(s: Stroke): string {
    return s === 'kesa' ? 'slashA' : s === 'gyaku' ? 'slashB' : s === 'rise' ? 'slashUp' : 'slashC';
  },
};

/** 参考连斩第 k 刀（共 count 刀）的动作：袈裟 slashA / 逆袈裟 slashB 交替，最后一刀双手竖劈 slashC（WarlordBrain.SlashState） */
export function slashState(k: number, count: number): string {
  return k >= count - 1 ? 'slashC' : k % 2 === 0 ? 'slashA' : 'slashB';
}

/** 参考连斩每刀片段拉伸到的时长：比每斩间隔长 0.12 s（WarlordBrain.SlashClip） */
export const SlashClip = WarlordRef.ComboPer + 0.12;

// ───────────────────────────── 居合一闪（WarlordIai） ─────────────────────────────

export const Iai = {
  id: 'warlord_iai',
  /** 线宽的一半（一阶段 / 之后）、离玩家身后多远、最短 / 最长 */
  HalfWidth0: 1.5, HalfWidth: 1.7, Beyond: 4, MinLen: 8, MaxLen: 14,
  /** 按刀时长 w 下的纳刀时长：拔刀在 24 / 48、收刀在 36 / 48，整段按同一个倍率拉伸 → 突进 + 纳刀 = w × (36 / 24 − 1) */
  sheatheFor(windupSeconds: number): number {
    return Math.max(0.16, windupSeconds * (WarlordSword.IaiHitAt / WarlordSword.IaiDashAt - 1) - WarlordSword.IaiDash);
  },
};

// ───────────────────────────── 熔铜剑气（WarlordSwordWave） ─────────────────────────────

export type WaveKind = 'vertical' | 'horizontal';

export interface WaveShot {
  kind: WaveKind;
  yaw: number;
  speed: number;
}

const shot = (kind: WaveKind, yaw: number, speed: number): WaveShot => ({ kind, yaw, speed });

export const SwordWave = {
  id: 'warlord_wave',
  /** 竖 / 横剑气的半宽、离地高度上限；射程 */
  VHalf: 0.9, VTop: 3.4, HHalf: 3.2, HTop: 0.95, Range: 26,
  /** 某阶段（狂怒 = 2）的两刀：第一刀（hit）和第二刀（impact，一阶段没有）各甩出哪些剑气 */
  pattern(phase: number): { first: readonly WaveShot[]; second: readonly WaveShot[] } {
    if (phase >= 2) return { first: [shot('horizontal', 0, 15)], second: [shot('vertical', 0, 22), shot('vertical', -32, 21), shot('vertical', 32, 21)] };
    if (phase >= 1) return { first: [shot('horizontal', 0, 17)], second: [shot('vertical', 0, 21)] };
    return { first: [shot('vertical', 0, 20)], second: [] };
  },
  halfWidth(kind: WaveKind, reach: number): number {
    return kind === 'horizontal' ? SwordWave.HHalf * reach : SwordWave.VHalf;
  },
};

// ───────────────────────────── 突刺冲锋（WarlordThrust） ─────────────────────────────

export const Thrust = {
  id: 'warlord_thrust',
  HalfWidth: 1.6, Speed: 24, MaxLen: 24, CutRange: 5.2, CutHalf: 70,
  /**
   * 突进多远：越过玩家 5 m、最长 24 m、截到场地边（edge = 到场地边界的距离，留 1.5 m）；再交给 ledge 截到台沿 / 没有导航的地方之前
   * （场地边截出来的最短 8 m / 2 m 只管场地边，台沿截短不受它限制）
   */
  planLength(toPlayer: number, edge: number, ledge: (length: number) => number = l => l): number {
    const length = Math.min(Math.max(Math.min(toPlayer + 5, Thrust.MaxLen), Math.min(8, edge)), Math.max(2, edge));
    return ledge(length);
  },
};

// ───────────────────────────── 回旋斩（WarlordSpin） ─────────────────────────────

export const Spin = {
  id: 'warlord_spin',
  Radius: 6.2, Inner2: 2.6, Outer2: 9,
  /** 二连：两圈之间的间隔（片段 spinTwice 两次出手在 18 / 54、32 / 54，整段按同一个倍率拉伸） */
  gapFor(windupSeconds: number): number {
    return windupSeconds * (WarlordSword.SpinTwiceImpactAt / WarlordSword.SpinTwiceHitAt - 1);
  },
};

// ───────────────────────────── 跃击（WarlordLeap 的落地决策） ─────────────────────────────

export type LandStep = 'fly' | 'pin' | 'land';

export const Leap = {
  id: 'warlord_leap',
  /** 落在比落点高这么多（米）以上的东西上 = 被掩体挡住了 */
  BlockedRise: 0.8,
  isBlocked(at: P3, target: P3, hitWall: boolean): boolean {
    return hitWall || at.y > target.y + Leap.BlockedRise;
  },
  /**
   * 起跳后第 t 秒（滞空 air 秒）这一帧怎么办：还在空中 → 接着飞；没被挡住却早着地 → 钉到落点、等预警填满；着地（或滞空超时）→ 落地
   */
  decide(t: number, air: number, grounded: boolean, at: P3, target: P3, hitWall: boolean): LandStep {
    if (!((t > 0.15 && grounded) || t > air + 0.8)) return 'fly';
    return t < air - 0.12 && !Leap.isBlocked(at, target, hitWall) ? 'pin' : 'land';
  },
};

export const ChannelSurge = { id: 'warlord_channels' };
export const Sweep = { id: 'warlord_sweep' };
export const Meteor = { id: 'warlord_meteor' };

/** 招式清单（Unity WarlordDef.moves 的顺序；调度参数照各招构造函数） */
export function warlordSpecs(): BossMoveSpec[] {
  return [
    bossMove({ id: BladeCombo.id, name: '魔将 · 焰刃连斩', cooldown: 3.5, recovery: 0.9, windup: 0.5, recover: 0.1 }),
    bossMove({ id: Iai.id, name: '魔将 · 居合一闪', cooldown: 6.5, recovery: 1, windup: 0.95, recover: 0.1 }),
    bossMove({ id: SwordWave.id, name: '魔将 · 熔铜剑气', cooldown: 6, recovery: 1, windup: 0.8, recover: 0.1 }),
    bossMove({ id: Thrust.id, name: '魔将 · 突刺冲锋', cooldown: 7, recovery: 1, windup: 0.85, recover: 0.1 }),
    bossMove({ id: Spin.id, name: '魔将 · 回旋斩', cooldown: 7, recovery: 1, windup: 0.8, recover: 0.1, minPhase: 1 }),
    bossMove({ id: Sweep.id, name: '魔将 · 火焰横扫', cooldown: 5, recovery: 1.1, windup: 0.85, recover: 0.1, weight: 3 }),
    bossMove({ id: Leap.id, name: '魔将 · 跃击', cooldown: 8, recovery: 1.1, windup: 0.48, recover: 0.1 }),
    // 陨石雨（号令天火）二阶段起才出：一阶段只教剑术
    bossMove({ id: Meteor.id, name: '魔将 · 陨石雨', cooldown: 11, recovery: 1, windup: 0.8, recover: 0.1, minPhase: 1 }),
    bossMove({ id: ChannelSurge.id, name: '魔将 · 熔铜渠涨落', cooldown: 22, recovery: 0.6, windup: 0.45, active: 0.85, recover: 0.1 }),
  ];
}

// ───────────────────────────── 定义 ─────────────────────────────

export class WarlordDef extends BossDef {
  static readonly Id = 'boss_warlord';
  static readonly FormId = 'warlord';
  static readonly PrefabId = 'SK_Boss_Warlord';
  static readonly ProxyPrefabId = 'SK_Enemy_IronOx';
  /** 阶段阈值（生命层比例）：引动熔铜渠、狂怒 */
  static readonly ChannelsAt = 0.5;
  static readonly FuryAt = 0.2;
  /** 3-3 的难度（RunPlan：1 + 0.8 × 2 + 0.16 × 2） */
  static readonly StageDifficulty = 2.92;
  /** 3-3 难度下的定档（I3） */
  static readonly TierHp = 18000;
  static readonly TierShield = 4600;
  static readonly TierArmor = 5000;
  /** 弱点 = 胸口地火之心、头骨；上身骨；大剑握点 / 剑尖；角盔盔脊、两肩甲顶（狂怒火舌） */
  static readonly WeakBone = 'socket_core';
  static readonly HeadBone = 'head';
  static readonly TorsoBone = 'spine';
  static readonly GripBone = 'socket_sword';
  static readonly TipBone = 'socket_sword_tip';
  static readonly HelmBone = 'socket_helm';
  static readonly PauldronL = 'socket_pauldron_L';
  static readonly PauldronR = 'socket_pauldron_R';

  // ───────────── 运行时层 ─────────────

  /** 登场：从多高砸下来（米）、下落占登场时长的比例、吼叫时刻（比例） */
  dropHeight = 34; dropFraction = 0.4; roarAt = 0.7;
  /** 狂怒的零星陨石：间隔（秒）、落在玩家周围的距离带（米） */
  ambientMeteorEvery = 2.4;
  readonly ambientMeteorRange: readonly [number, number] = [1.5, 6];
  /** 狂怒后陨石雨的冷却（秒） */
  furyMeteorCooldown = 7;
  /** 熔铜渠涨落：高位停多久（秒，一阶段被强制出招时 / 二阶段 / 三阶段） */
  readonly surgeHold = [6, 6, 8];
  /** 命中区：肩甲、膝甲（胸、髋在身体胶囊里） */
  readonly hitZones: BossHitZoneDef[] = [];

  constructor() {
    super();
    this.id = WarlordDef.Id;
    this.name = '熔心魔将';
    this.title = '熔火深渊的统帅';
    // 难度 1 的参考值 ≈ 定档 ÷ 2.92（定档表优先，见 vitalsAt）
    this.vitals = bossVitals(6160, 1580, 1710);
    this.tiers.push({ difficulty: WarlordDef.StageDifficulty, vitals: bossVitals(WarlordDef.TierHp, WarlordDef.TierShield, WarlordDef.TierArmor) });
    this.damage = 24;
    this.speed = 4.6;
    this.element = 'fire';
    this.color = 0xff5a1f;
    this.warnColor = WARN;
    this.radius = 1.3;
    this.height = 3.6;
    this.idleMinRange = 5;
    this.idleMaxRange = 9;
    this.repeatWeight = 0.2;

    this.forms.push({
      id: WarlordDef.FormId, name: null, prefab: WarlordDef.PrefabId, scale: 1, proxyPrefab: WarlordDef.ProxyPrefabId, proxyScale: 1.6,
      weakBone: WarlordDef.WeakBone, weakRadius: 0.45,
    });
    this.hitZones.push({ id: 'pauldron_l', bone: 'pauldron_L', radius: 0.46 });
    this.hitZones.push({ id: 'pauldron_r', bone: 'pauldron_R', radius: 0.46 });
    this.hitZones.push({ id: 'knee_l', bone: 'shin_L', radius: 0.3, height: 1.44 });
    this.hitZones.push({ id: 'knee_r', bone: 'shin_R', radius: 0.3, height: 1.44 });

    this.phases.push(bossPhase({
      at: WarlordDef.ChannelsAt, seconds: 2.2, anim: 'roar', sfx: 'boss_roar', shake: 0.5, toast: '熔心魔将引动了熔铜渠！', restScale: 0.8,
      firstMove: ChannelSurge.id,
    }));
    // 狂怒的提示由 enrageToast 打（生命层跌破 20% 立刻狂怒，转换演出等当前招式收尾）
    this.phases.push(bossPhase({
      at: WarlordDef.FuryAt, seconds: 2.2, anim: 'roar', sfx: 'boss_roar', shake: 0.6, toast: null, restScale: 0.85, firstMove: Spin.id,
    }));

    this.moves.push(...warlordSpecs());

    this.summonCap = 0;
    this.enrageAfter = 0;
    this.enrageBelow = WarlordDef.FuryAt;
    // 20% 狂怒（TS 三阶段 restFactor 0.6）：阶段 0.85 × 狂怒 0.7 ≈ 0.6
    this.enrageRestScale = 0.7;
    this.enrageWindupScale = 0.9;
    this.enrageDamageScale = 1.1;
    this.enrageToast = '熔心魔将陷入狂怒——大剑燃成熔铜长刃！';
    this.intro.seconds = 2.6;
    this.intro.anim = '';
    this.intro.sfx = null;
    this.intro.shake = 0;
    this.intro.banner = true;
    this.intro.firstRest = 1;
    this.defeat.seconds = 3.2;
    this.defeat.toast = '熔心魔将伏诛——熔铜渠归于平静';
  }

  /** 某个阶段熔铜渠高位停多久（越界取两端） */
  surgeHoldAt(phase: number): number {
    const h = this.surgeHold;
    return h.length === 0 ? 6 : h[Math.min(h.length - 1, Math.max(0, phase))];
  }
}
