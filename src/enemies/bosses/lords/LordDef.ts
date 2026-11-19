/**
 * 4-1 三领主（夔、飞廉、化蛇）的定义底座（Unity Bosses/Lords/LordDef.cs；docs/unity-ch4-port.md C4-6、chuanzang-combat-v1.md 第 4 节「领主通用」）：
 *   · 4-1 的难度（RunPlan：1 + 0.8 × 3 = 3.4）下按 I3 参考秒伤定档，领主梯度（framework/LordScaling）在生成时再乘血量；
 *   · lordLevel = 「4-1」、转阶段只出横幅（phaseCinematic = false），阶段名写在阶段的 toast；
 *   · 一场领主战内部的节奏：二阶段收招 × tempo2、三阶段 × tempo3（网页 boss.ts tempo），再乘领主梯度；
 *   · 死亡不放通用的溃散爆炸，改成领主自己的死亡演出（death，LordCinema）；倒下后据点灵火由关卡的据点模式点亮（world/objectives）。
 * 纯数据 + 纯计算（不碰场景），node --test 直接测。
 */
import { BalanceModel } from '../QilinDef';
import { BossDef } from '../framework/BossDef';
import { LordTier } from '../framework/LordScaling';

/** 受击区（Unity BossHitZoneDef 的子集：骨骼 + 球半径 + 倍率）；网页命中形状只分弱点 / 身体，倍率留作对照 */
export interface LordHitZone {
  id: string;
  bone: string;
  radius: number;
  multiplier?: number;
  priority?: number;
}

/**
 * 死亡演出的镜头表（Unity LordDeathSpec；docs/art/ch4-boss-intros.json 每个领主的第三段：show + land）：
 *   show：绕首领转半圈（从玩家方向 orbitFrom 转到 orbitTo，距 radius、高 height），开头 slowSeconds 秒 slowScale 倍慢放；
 *   land：切到玩家身后的过肩机位（后 3.2 m、上 0.9 m、右 0.9 m），landSeconds 秒推进玩家眼睛；名字卡 cardAt 起 cardSeconds 秒。
 */
export class LordDeathSpec {
  name = '';
  seconds = 6;
  landSeconds = 1.2;
  handoff = 0.5;
  cardAt = 3;
  cardSeconds = 2.8;
  cardTitle = '';
  cardSub = '';
  epithet = '';
  /** 环绕：半径、机位高、看点高（米）、起止偏角（弧度，相对「首领 → 玩家」方向） */
  radius = 13;
  height = 4;
  lookHeight = 2.5;
  orbitFrom = -0.3;
  orbitTo = 0.9;
  /** 开头的慢放倍率与真实秒数 */
  slowScale = 0.3;
  slowSeconds = 1.2;

  /** 环绕段的秒数（整段 − 落回） */
  get showSeconds(): number {
    return Math.max(0.1, this.seconds - this.landSeconds);
  }
}

export abstract class LordDef extends BossDef {
  /** 4-1 的关卡 id（领主梯度的记账键）与难度 */
  static readonly Level = '4-1';
  static readonly StageDifficulty = 3.4;
  /** 弱点 / 破防窗口给的额外输出（相对参考秒伤）：领主战的弱点都在明处（鼓心、风雷珠、张开的嘴），破防 4 s × 1.3 */
  static readonly WeakBonus = 1.1;

  /** 网页版的数值是按网页的枪（9 发 / 秒 × 16）定的：耐久、破防条、机关伤害按「Unity 定档 ÷ 网页血量」统一换算 */
  webHp = 12000;
  /** 二 / 三阶段的收招倍率（网页 boss.ts：0.9 / 0.75） */
  tempo2 = 0.9;
  tempo3 = 0.75;
  /** 死亡演出的镜头表与倒下的动作（片段名） */
  readonly death = new LordDeathSpec();
  deathAnim = 'kneel';
  /** 主题色三阶（亮芯 / 主色 / 暗边） */
  core = 0xffffff;
  edge = 0x808080;
  /** 受击区（骨骼名） */
  readonly hitZones: LordHitZone[] = [];
  /** 动画资产（public/assets/anim/<资产>.json 与 characters/<资产>.glb） */
  prefab = '';

  constructor() {
    super();
    this.lordLevel = LordDef.Level;
    this.phaseCinematic = false;
    this.repeatWeight = 1;
    this.phaseWait = 2;
    this.summonCap = 4;
    this.stunBetweenMoves = true;
    // 倒下：领主自己的死亡演出（LordCinema），通用溃散只留倒下那一下的爆点；慢放由演出放
    this.defeat.seconds = 6;
    this.defeat.despawnAfter = 1.5;
    this.defeat.slowMo = 1;
    this.defeat.slowMoSeconds = 0;
    this.rewards.chest = 'scroll';
    this.intro.banner = true;
  }

  /** 4-1 难度下的耐久（定档） */
  get stageHp(): number {
    return this.vitalsAt(LordDef.StageDifficulty).hp;
  }

  /** 网页数值 → Unity：按耐久比例（破防条、机关对领主的伤害、侧跃的挨打阈值） */
  get webScale(): number {
    return this.stageHp / Math.max(1, this.webHp);
  }

  /** 某个阶段的收招节奏（0 → 1、1 → tempo2、≥ 2 → tempo3） */
  phaseTempo(phase: number): number {
    return phase >= 2 ? this.tempo3 : phase === 1 ? this.tempo2 : 1;
  }

  /**
   * 模拟击杀用时（秒，登场结束到倒下）：tier 档的血量 ÷（参考秒伤 × 弱点加成）+ 两次转阶段的不可选中时间。
   * 4-1 三领主每一档都要落在 60–120 s（docs/unity-parity.md 7.4），第 0 档在 65–85 s
   */
  estimateKillSeconds(tier: number): number {
    const t = new LordTier(tier);
    const dps = BalanceModel.referenceDps(LordDef.StageDifficulty) * LordDef.WeakBonus;
    let trans = 0;
    for (const p of this.phases) trans += p.seconds;
    return this.stageHp * t.hpMult / Math.max(1, dps) + trans;
  }
}

/** Unity Color(r, g, b) → 0xRRGGBB */
export function rgb(r: number, g: number, b: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}
