/**
 * 旱魃定义（Unity Hanba/HanbaDef.cs 逐项照搬；第一章首领，1-4 鸣沙山月牙泉——露天：沙山环抱的洼地、一弯月牙泉、南岸月泉阁）。
 *   阶段（血条刻度就是这两道阈值）：
 *     一 · 烈日 100–60%：日轮扫射、旱风、召沙魇；日晒与荫蔽（午后的低太阳拖出长影子），泉水里灼烧减半。
 *     二 · 焦土 60–30%：转阶段时吸干泉水、泉床龟裂，之后裂缝间歇喷气；新增焦裂、飞天之殇（转阶段后的第一招）。
 *     三 · 赤地千里 30–0%：日轮升到头顶、太阳推到约 85°，影子缩到脚下；新增日蚀（转阶段后的第一招）。
 *     前一阶段的招式都留着，按 pace 变快（前摇 ÷ 节奏、扫得更快、沙魇 4 只、旱风补余波、焦裂三条成扇），喘息按 restScale 缩短。
 *   弱点：心口的泉珠（socket_core），只在招式后摇、硬直和日蚀窗口露出。
 *   数值：1-4 的难度 1.48 下定档 7700 生命 + 3850 护盾（I3 按首领浸泡实测重定；HanbaBalance 模拟复核 60–120 s）。
 * 纯数据（不碰场景）：运行时（Hanba.ts）、模拟（HanbaBalance.ts）、测试都读它。
 */
import { BossDef, bossPhase, bossVitals } from './framework/BossDef';
import { ApsaraCall, Eclipse, hanbaSpecs } from './HanbaPlans';

export class HanbaDef extends BossDef {
  static readonly Id = 'boss_hanba';
  static readonly FormId = 'hanba';
  /** 阶段阈值（生命层比例）：焦土、赤地千里 */
  static readonly ScorchedAt = 0.6;
  static readonly RedEarthAt = 0.3;
  /** 1-4 的难度（定档就定在这里） */
  static readonly StageDifficulty = 1.48;
  /** 1-4 的定档：生命 / 护盾 */
  static readonly TierHp = 7700;
  static readonly TierShield = 3850;

  static readonly Sun = 0xffe2a0;
  static readonly Sand = 0xd9b27a;
  static readonly Warn = 0xffa23d;

  // ───────────── 悬浮（运行时层）─────────────
  /** 悬浮高度（米）、上下起伏幅度与频率 */
  hover = 0.55; bob = 0.12; bobRate = 1.1;

  // ───────────── 日晒（SunExposure）─────────────
  /** 光柱 / 日轮整份暴露的叠层增益；日轮平时 / 最炽时的直射距离；浅水倍率；每层每跳伤害（难度 1） */
  shaftGain = 1; ringGain = 0.6; ringRange = 14; ringBlazeRange = 24; waterFactor = 0.5; sunDamagePerStack = 0.6;

  /** 招式收招后泉珠再露多久（秒） */
  weakGrace = 0.6;

  /** 每个阶段的出招节奏（一阶段 = 1） */
  readonly pace = [1, 1.2, 1.4];

  // ───────────── 沙魇 ─────────────
  /** 每次召唤按顺序取前 n 只（一阶段 3、之后 4） */
  readonly wraithRoster = ['sand_wraith', 'sand_wraith', 'scorpion_archer', 'sand_wraith'];
  wraithTint = 0xf2cc8c; wraithOverlay = 0xd9a866; wraithOverlayAmount = 0.38;

  // ───────────── 焦土：喷气裂缝（Phase2Scorch）─────────────
  ventEvery2 = 4.5; ventEvery3 = 3.2; ventWarn = 1.1; ventRadius = 2.2; ventDamage = 0.6;
  ventCount2 = 2; ventCount3 = 3;

  // ───────────── 飞天之殇：琵琶护体 ─────────────
  apsaraId = 'apsara'; apsaraName = '日灼·邪飞天';
  wardTaken = 0.2; wardBreakStagger = 2.5; wardBreakTaken = 1.3;
  apsaraOverlay = 0xd9521f; apsaraOverlayAmount = 0.35;

  // ───────────── 午后的低太阳（一阶段，露天场地）─────────────
  lowSunElevation = 30; lowSunMax = 42;

  // ───────────── 赤地千里：日轮升到头顶 ─────────────
  risenElevation = 85; sunDriveSeconds = 3.2; risenDistance = 45; risenSkyScale = 2.4; risenSunGain = 1.4;
  riseDrop = 8.5; risenRange = 70; risenGain = 0.8; risenScale = 1.5;

  // ───────────── 日蚀 ─────────────
  eclipseSeconds = 3; eclipseWeakMult = 3; flareDamage = 1.6; flareBurn = 2.5;
  eclipseDim = 0.12; flareBright = 2.4;

  // ───────────── 演出 ─────────────
  introSlowMo = 0.45; introSlowMoSeconds = 0.35; phaseSlowMo = 0.5; phaseSlowMoSeconds = 0.45; roarAt = 0.5833;
  readonly phaseCards = ['二 · 焦土', '三 · 赤地千里'];
  readonly phaseCardSubs = ['泉水尽涸 · 泉床龟裂', '烈日当头 · 影子缩到脚下'];

  constructor() {
    super();
    this.id = HanbaDef.Id;
    this.name = '旱魃';
    this.title = '赤地之源';
    // 难度 1 的参考值 = 定档 ÷ 1.48（定档表优先，见 vitalsAt）
    this.vitals = bossVitals(HanbaDef.TierHp / HanbaDef.StageDifficulty, HanbaDef.TierShield / HanbaDef.StageDifficulty);
    this.tiers.push({ difficulty: HanbaDef.StageDifficulty, vitals: bossVitals(HanbaDef.TierHp, HanbaDef.TierShield) });
    this.damage = 15;
    this.speed = 4.2;
    this.element = 'fire';
    this.color = 0xffd27a;
    this.warnColor = HanbaDef.Warn;
    this.radius = 0.9;
    this.height = 4.5;
    this.idleMinRange = 10;
    this.idleMaxRange = 18;
    this.repeatWeight = 0.15;

    this.forms.push({
      id: HanbaDef.FormId, name: null, prefab: 'SK_Boss_Hanba', scale: 1, proxyPrefab: 'SK_Enemy_Apsara', proxyScale: 3.5,
      weakBone: 'socket_core', weakRadius: 0.2,
    });
    // 二阶段：双手捧到心口把泉水吸进泉珠（apsaraCall 那段）；演出里吸干、龟裂，结束后先召邪飞天
    this.phases.push(bossPhase({
      at: HanbaDef.ScorchedAt, seconds: 3.2, anim: 'apsaraCall', sfx: 'boss_roar', shake: 0.6, restScale: 0.85, firstMove: ApsaraCall.id,
      toast: '旱魃吸干了月牙泉——泉床裂缝会喷出热气，看地面预警！',
    }));
    // 三阶段：蜷起再舒展长啸（intro 那段），日轮升到头顶、太阳推到 85°；结束后先放日蚀
    this.phases.push(bossPhase({
      at: HanbaDef.RedEarthAt, seconds: 3.6, anim: 'intro', sfx: 'boss_roar', shake: 0.7, restScale: 0.7, firstMove: Eclipse.id,
      toast: '日轮升到头顶——影子几乎没了，躲进楼阁里或沙丘檐下的深影！',
    }));

    this.moves.push(...hanbaSpecs());

    this.summonCap = 6;
    this.enrageAfter = 240;
    this.enrageToast = '旱魃狂怒——烈日焚天！';
    this.intro.seconds = 4;
    this.intro.anim = 'intro';
    this.intro.sfx = 'boss_roar';
    this.intro.shake = 0.5;
    this.intro.firstRest = 1.2;
    this.defeat.seconds = 4.2;
    this.defeat.slowMo = 0.3;
    this.defeat.slowMoSeconds = 0.8;
    this.defeat.toast = '旱魃伏诛——泉眼复涌';
  }

  /** 某个阶段的出招节奏（越界取两端） */
  paceAt(phase: number): number {
    return this.pace.length === 0 ? 1 : this.pace[Math.min(this.pace.length - 1, Math.max(0, phase))];
  }

  /** 某个阶段每隔多久喷一轮气（一阶段没有，按二阶段算） */
  ventEveryAt(phase: number): number {
    return Math.max(0.5, phase >= 2 ? this.ventEvery3 : this.ventEvery2);
  }

  /** 某个阶段每轮喷几个裂口 */
  ventCountAt(phase: number): number {
    return Math.max(1, phase >= 2 ? this.ventCount3 : this.ventCount2);
  }

  /** 进入第 phase 阶段（1 = 焦土、2 = 赤地千里）时的名卡标题与副标题 */
  cardTitle(phase: number): string | null {
    return phase >= 1 && phase - 1 < this.phaseCards.length ? this.phaseCards[phase - 1] : null;
  }

  cardSub(phase: number): string | null {
    return phase >= 1 && phase - 1 < this.phaseCardSubs.length ? this.phaseCardSubs[phase - 1] : null;
  }
}
