/**
 * 火麒麟定义（Unity Qilin/QilinDef.cs + 各招式 Moves/*.cs 的常量逐项照搬；终章首领，3-4 祝融炉心）。纯数据 + 纯计算（不碰场景）：
 * 运行时（Qilin.ts / QilinMoves.ts）、定档模型、node 测试都读这里，一处改数。
 *   一阶段 · 玄鳞（100–55%，玄铁鳞甲 = 护甲层）：踏火奔驰、张鳞、麟火、饮熔（85% / 70% 血量线排上；饮熔时打碎它身后的锁扣 → 鼎角砸中：硬直 4 s、鳞甲崩裂 × 2）。
 *   转换（55%，5.2 s，1.9 s 在熔岩柱里换形）：链全断、巨鼎坠池；鳞甲炸飞（护甲清零）。
 *   二阶段 · 焚身（飞行形态）：熔流轮转（换形后第一招）、踏云俯冲三连 → 落地喘息、吐息扫象限、火云雨 + 神火飞鸦；15% 狂怒长啸。
 *   数值（I3 定档）：3-4 难度 3.08 下 28000 生命 + 2400 护甲；难度 1 参考 9090 / 0 / 780（Three.js 原值 5000 + 1500 护甲）。
 *   定档曲线 = I3 参考曲线（BalanceModel.ReferenceDps：90 ×（1 + 1.15 ×（难度 − 1））× 1.6 × 0.8），只搬了这一条（docs/threejs-migration.md M6）。
 */
import { BossDef, bossMove, bossPhase, bossVitals, type BossMoveSpec, type BossVitals } from './framework/BossDef';
import { SWEEP_SPOT_OUT } from './QilinFurnace';

// ───────────── 招式（Unity Moves/*.cs 的常量与调度参数）─────────────

export const ScaleGallop = {
  id: 'gallop', name: '踏火奔驰',
  spec: bossMove({ id: 'gallop', name: '踏火奔驰', cooldown: 9, recovery: 1, weight: 2.6, firstDelay: 0.5, windup: 0.35, active: 14, recover: 0.1, forms: ['xuan'] }),
};

export const ScaleBlades = {
  id: 'scales', name: '张鳞',
  Count: 36, Speed: 21, StartRadius: 2.2, Height: 1.2, BladeRadius: 0.5, SecondRingAt: 0.85, SecondDelay: 0.4, Damage: 20,
  spec: bossMove({ id: 'scales', name: '张鳞', cooldown: 11, recovery: 1.2, weight: 2, firstDelay: 2.5, windup: 1, active: 0.55, recover: 0.7, forms: ['xuan'] }),
};

export const ScaleBreath = {
  id: 'breath', name: '麟火',
  HalfAngle: 24, Range: 14, TurnRate: 28.6, TickEvery: 0.15, TickDamage: 6, MaxDistance: 15,
  spec: bossMove({ id: 'breath', name: '麟火', cooldown: 7, recovery: 0.9, weight: 2.4, firstDelay: 1.5, windup: 0.8, active: 1.6, recover: 0.3, forms: ['xuan'] }),
};

export const ScaleDrink = {
  id: 'drink', name: '饮熔',
  LeapHeight: 6, LandRadius: 4.5, CrouchFrac: 0.28, LandDamage: 24,
  spec: bossMove({ id: 'drink', name: '饮熔', cooldown: 1, recovery: 0.6, weight: 0, windup: 1, active: 9, recover: 0.6, forms: ['xuan'] }),
};

export const BurnFlood = {
  id: 'burn_flood', name: '熔流轮转',
  Alt: 5.5, Speed: 16, OpenAt: 1.2,
  spec: bossMove({ id: 'burn_flood', name: '熔流轮转', cooldown: 34, recovery: 0.6, weight: 3, firstDelay: 0, windup: 0.4, active: 1.6, recover: 0.1, forms: ['burn'] }),
};

export const BurnDives = {
  id: 'burn_dives', name: '踏云俯冲',
  Count: 3, RiseSpeed: 22, RiseMax: 1.4, Tele: 0.9, TeleRage: 0.7, DiveTime: 0.3, LandRecover: 0.45,
  Lead: 0.5, Radius: 4.2, RingSpeed: 13, RingRadius: 15, BlastDamage: 30, RingDamage: 16,
  /** stomp 片段里砸地那一帧的归一化时刻（第 12 / 26 帧） */
  StompHitAt: 12 / 26,
  spec: bossMove({ id: 'burn_dives', name: '踏云俯冲', cooldown: 10, recovery: 0.4, weight: 2.8, firstDelay: 2.5, windup: 0.35, active: 14, recover: 0.05, forms: ['burn'] }),
};

export const BurnPant = {
  id: 'burn_pant', name: '落地喘息',
  Rest: 3.5, LandRadius: 5, LandDamage: 16, TakeoffRadius: 6, TakeoffDamage: 12, TakeoffWarn: 0.8,
  spec: bossMove({ id: 'burn_pant', name: '落地喘息', cooldown: 0, recovery: 0.6, weight: 0, windup: 0.8, active: 3.5, recover: 0.7, forms: ['burn'] }),
};

export const BurnSweep = {
  id: 'burn_sweep', name: '麟火扫象限',
  ApproachSpeed: 20, ApproachMax: 2.2, ApproachAlt: 3, Tele: 1.2, SweepTime: 2.6, Tail: 0.3,
  HalfBeam: 8.6, TickEvery: 0.15, TickDamage: 9, SpotOut: SWEEP_SPOT_OUT, WarnPad: 4.6,
  spec: bossMove({ id: 'burn_sweep', name: '麟火扫象限', cooldown: 10, recovery: 1, weight: 2.2, firstDelay: 6, windup: 2.2, active: 1.2 + 2.6 + 0.3, recover: 0.3, forms: ['burn'] }),
};

export const BurnRain = {
  id: 'burn_rain', name: '火云雨',
  Meteors: 10, MeteorsRage: 14, Every: 0.16, FallTime: 1.25, Radius: 2.4, Damage: 18, Height: 22, CrowsAt: 0.3,
  spec: bossMove({ id: 'burn_rain', name: '火云雨', cooldown: 13, recovery: 1, weight: 1.8, firstDelay: 4, windup: 0.7, active: 1.9, recover: 0, forms: ['burn'] }),
};

export const BurnRage = {
  id: 'burn_rage', name: '狂怒长啸',
  WaveSpeed: 14, WaveDamage: 14,
  spec: bossMove({ id: 'burn_rage', name: '狂怒长啸', cooldown: 0, recovery: 0.4, weight: 0, windup: 1.3, active: 0.4, recover: 0.5, forms: ['burn'] }),
};

/** 十招（定义顺序 = Unity QilinDef.moves 的顺序） */
export const QILIN_MOVES = [ScaleGallop, ScaleBlades, ScaleBreath, ScaleDrink, BurnFlood, BurnDives, BurnPant, BurnSweep, BurnRain, BurnRage] as const;

export function qilinSpecs(): BossMoveSpec[] {
  return QILIN_MOVES.map(m => ({ ...m.spec, forms: m.spec.forms ? [...m.spec.forms] : null }));
}

/** 焚身踏云的离地高度（蹄下）、俯冲蓄势 / 火云雨的高度、竖直速度上限、水平加速度、绕殿速度、身下离石柱顶至少多高（Unity QilinBrain） */
export const SKY = { Alt: 4.5, High: 7.5, Climb: 12, Accel: 30, OrbitSpeed: 11, Clearance: 0.7 } as const;

/** 倒下时硬直片段播到哪里（归一化）：之后是撑起身子 */
export const STUN_LIE_UNTIL = 0.72;

/** 锁扣基础血量（× 难度，Unity QilinLock.BaseHp） */
export const LOCK_BASE_HP = 110;

// ───────────── I3 参考曲线（Unity BalanceModel / BossBalance，只搬火麒麟用到的）─────────────

export const BalanceModel = {
  BaseDps: 90, GearGrowth: 1.15, KitMult: 1.6, Uptime: 0.8,
  gearMult(difficulty: number): number {
    return 1 + 1.15 * (Math.max(1, difficulty) - 1);
  },
  /** 参考秒伤 = 武器裸秒伤 90 × 装备倍率 × 武器之外 1.6 × 输出占比 0.8 */
  referenceDps(difficulty: number): number {
    return 90 * BalanceModel.gearMult(difficulty) * 1.6 * 0.8;
  },
};

/** 首领浸泡实测（可选中时的秒伤，Unity BossBalance.Soak） */
export const BOSS_SOAK: readonly { stage: string; difficulty: number; dps: number }[] = [
  { stage: '1-4', difficulty: 1.48, dps: 220 },
  { stage: '2-4', difficulty: 2.28, dps: 405 },
  { stage: '3-3', difficulty: 2.92, dps: 435 },
  { stage: '3-4', difficulty: 3.08, dps: 480 },
];

export function soakDps(stage: string): number {
  return BOSS_SOAK.find(s => s.stage === stage)?.dps ?? 0;
}

// ───────────── 定义 ─────────────

export class QilinDef extends BossDef {
  static readonly Id = 'boss_qilin';
  static readonly XuanForm = 'xuan';
  static readonly BurnForm = 'burn';
  static readonly XuanPrefab = 'SK_Boss_Qilin';
  static readonly BurnPrefab = 'SK_Boss_QilinBurn';
  static readonly ProxyPrefab = 'SK_Enemy_IronOx';
  static readonly ModelScale = 1.25;
  /** 换形阈值（生命层比例）与饮熔线（生命刻度事件，血条上各一道） */
  static readonly TransformAt = 0.55;
  static readonly DrinkMarkA = 'drink85';
  static readonly DrinkMarkB = 'drink70';
  static readonly DrinkAt = [0.85, 0.7] as const;
  /** 3-4 的难度与定档 */
  static readonly StageDifficulty = 3.08;
  static readonly TierHp = 28000;
  static readonly TierArmor = 2400;
  /** 鼎角砸中：硬直秒数、受伤倍率（鳞甲崩裂） */
  static readonly StunSeconds = 4;
  static readonly CrackTakenMult = 2;
  static readonly TransitionSeconds = 5.2;

  static readonly Fire = 0xff6a1a;
  static readonly Warn = 0xff7a2a;
  static readonly Hot = 0xffd070;
  static readonly Ember = 0xff8a3a;
  static readonly ScaleDark = 0x2a2420;
  /** QilinPalette：暗金、鳞刃赭金 */
  static readonly Gold = 0xd9a441;
  static readonly Blade = 0xe0a040;

  // ───────────── 场地 / 饮熔 ─────────────
  lockHeight = 12;
  drinkSeconds = 4; drinkSpotOut = 3.1; drinkDamageGrowth = 1.08;
  drinkTantong = 4;
  tantongId = 'tantong';

  // ───────────── 蹄印 / 奔驰 / 冲撞（TS 原值）─────────────
  printLife = 4; printRadius = 0.95; printDamage = 7; printInterval = 0.4;
  gallopSpeed = 18; toTrackSpeed = 15; chargeSpeed = 30; chargeRadius = 1.6;

  // ───────────── 焚身 ─────────────
  crowId = 'fire_crow';
  rainCrows = 4;

  constructor() {
    super();
    this.id = QilinDef.Id;
    this.name = '火麒麟';
    this.title = '祝融炉心 · 守炉神兽';
    // 难度 1 的参考值 = 定档 ÷ 3.08（定档表优先）；Three.js 原值 5000 + 1500 护甲
    this.vitals = bossVitals(9090, 0, 780);
    this.tiers.push({ difficulty: QilinDef.StageDifficulty, vitals: bossVitals(QilinDef.TierHp, 0, QilinDef.TierArmor) });
    this.damage = 16;
    this.speed = 6.5;
    this.element = 'fire';
    this.color = QilinDef.Fire;
    this.warnColor = QilinDef.Warn;
    this.radius = 2;
    this.height = 7.2;
    this.idleMinRange = 9;
    this.idleMaxRange = 16;
    this.repeatWeight = 0.2;
    this.phaseWait = 2;

    this.forms.push({
      id: QilinDef.XuanForm, name: '玄鳞', prefab: QilinDef.XuanPrefab, scale: QilinDef.ModelScale, proxyPrefab: QilinDef.ProxyPrefab, proxyScale: 2.2,
      weakBone: 'pearl', weakRadius: 0.3,
    });
    this.forms.push({
      id: QilinDef.BurnForm, name: '焚身', prefab: QilinDef.BurnPrefab, scale: QilinDef.ModelScale, proxyPrefab: QilinDef.ProxyPrefab, proxyScale: 2.2,
      weakBone: 'pearl', weakRadius: 0.3, firstMove: BurnFlood.id, flying: true,
    });
    this.phases.push(bossPhase({
      at: QilinDef.TransformAt, form: QilinDef.BurnForm, seconds: QilinDef.TransitionSeconds, formSwapAt: 1.9, anim: 'tuck', sfx: 'boss_roar', shake: 0.6,
      toast: '剩下的铁链全断了——巨鼎坠入熔池！', restScale: 0.9,
    }));
    this.marks.push({ at: QilinDef.DrinkAt[0], id: QilinDef.DrinkMarkA, tick: true });
    this.marks.push({ at: QilinDef.DrinkAt[1], id: QilinDef.DrinkMarkB, tick: true });

    this.moves.push(...qilinSpecs());

    this.summonCap = 6;
    // 狂怒（TS restFactor：焚身 0.9、狂怒 × 0.72 ≈ 0.65）：喘息、前摇缩短（框架缺省 0.85），伤害 × 1.15
    this.enrageBelow = 0.15;
    this.enrageRestScale = 0.72;
    this.enrageToast = '火麒麟狂怒——焚身之火愈烈！';
    this.intro.seconds = 3.2;
    this.intro.anim = 'tuck';
    this.intro.sfx = 'boss_roar';
    this.intro.shake = 0.6;
    this.intro.firstRest = 1.2;
    this.defeat.seconds = 3.4;
    this.defeat.toast = '火麒麟伏诛——祝融炉心重归平静';
  }

  /** 受击球（TS QilinModel 的 XUAN_POINTS / BURN_POINTS 半径；heart 只在焚身、是弱点） */
  static readonly HitZones = [
    { id: 'head', bone: 'head', radius: 0.42, weak: false, form: null },
    { id: 'neck', bone: 'neck_1', radius: 0.6, weak: false, form: null },
    { id: 'chest', bone: 'chest', radius: 0.85, weak: false, form: null },
    { id: 'back', bone: 'spine', radius: 0.85, weak: false, form: null },
    { id: 'hips', bone: 'hips', radius: 0.8, weak: false, form: null },
    { id: 'heart', bone: 'chest', radius: 0.45, weak: true, form: 'burn' },
  ] as const;

  // ───────────── 定档模型（Unity QilinDef，EditMode 测试守着）─────────────

  static readonly Uptime = BalanceModel.Uptime;
  /** 无属性打护甲的倍率 */
  static readonly ArmorMult = 0.75;
  /** 焚身在空中时打得到的比例、落地喘息时的输出倍率 */
  static readonly AirHitRate = 0.85;
  static readonly PantDpsMult = 1.5;
  /** 俯冲时飞到玩家头顶的典型用时、吐息落到对岸的典型用时、打一只神火飞鸦要几秒 */
  static readonly TypicalRise = 1;
  static readonly TypicalApproach = 1.5;
  static readonly CrowSeconds = 0.5;

  /** 定档用的模拟秒伤 = I3 参考曲线 */
  static referenceDps(difficulty: number): number {
    return BalanceModel.referenceDps(difficulty);
  }

  /**
   * 模拟击杀用时（秒，登场结束到倒下）= 一阶段 + 换形演出（不可选中）+ 二阶段：
   *   一阶段：45% 生命 + 护甲 ÷ 0.75 为基础量；两次饮熔里没打断的那几次各回满一次鳞甲；每次砸中给 4 s × 秒伤 ×（受伤倍率 − 1）的额外输出；
   *   二阶段：55% 生命 ÷（秒伤 × 焚身折算）
   */
  static estimateKillSeconds(v: BossVitals, dps: number, cauldronHits: number, drinks = 2): number {
    if (!(dps > 0)) return Infinity;
    cauldronHits = Math.min(drinks, Math.max(0, cauldronHits));
    const armorRaw = v.armor / QilinDef.ArmorMult;
    const pool1 = v.hp * (1 - QilinDef.TransformAt) + v.shield + armorRaw + armorRaw * (drinks - cauldronHits);
    const bonus = cauldronHits * QilinDef.StunSeconds * dps * (QilinDef.CrackTakenMult - 1);
    const phase1 = Math.max(0, pool1 - bonus) / dps;
    const phase2 = v.hp * QilinDef.TransformAt / (dps * QilinDef.burnDpsFactor());
    return phase1 + QilinDef.TransitionSeconds + phase2;
  }

  /** 焚身一轮（俯冲三连 + 喘息 + 吐息 + 火云雨各一次，含招式间喘息 × 焚身 0.9）的秒数、其中落地喘息的秒数、分火打飞鸦的秒数 */
  static burnRotation(): { seconds: number; pantSeconds: number; crowSeconds: number } {
    const rest = 0.9;
    const dv = BurnDives.spec, pt = BurnPant.spec, sw = BurnSweep.spec, rn = BurnRain.spec;
    const d = dv.windup + BurnDives.Count * (QilinDef.TypicalRise + BurnDives.Tele + BurnDives.DiveTime + BurnDives.LandRecover) + dv.recovery * rest;
    const p = pt.windup + pt.active + pt.recover + pt.recovery * rest;
    const s = QilinDef.TypicalApproach + sw.active + sw.recover + sw.recovery * rest;
    const r = rn.windup + rn.active + rn.recover + rn.recovery * rest;
    return { seconds: d + p + s + r, pantSeconds: pt.active, crowSeconds: new QilinDef().rainCrows * QilinDef.CrowSeconds };
  }

  /** 二阶段相对模拟秒伤的输出倍率：一轮里空中的时间（扣掉打飞鸦的）× 0.85 + 喘息 × 1.5，按一轮的时长平均（约 0.87） */
  static burnDpsFactor(): number {
    const { seconds: t, pantSeconds: pant, crowSeconds: crows } = QilinDef.burnRotation();
    if (!(t > 0)) return 1;
    const air = Math.max(0, t - pant - crows);
    return (air * QilinDef.AirHitRate + pant * QilinDef.PantDpsMult) / t;
  }
}
