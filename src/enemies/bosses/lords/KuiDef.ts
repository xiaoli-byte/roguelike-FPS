/**
 * 夔（Unity Kui/KuiDef.cs；4-1 ⑥ 经幡山头领主；chuanzang-combat-v1.md 4.1，设计单 docs/art/vfx/kui.md）。
 * 一足巨兽，皮早被做成了鼓：胸口一面残破的雷鼓（鼓心 drum_core 是弱点）。只在雷暴里现身——擂台中心是拉则，经幡杆一圈在 14–23 m（都是导体）。
 *   一阶段 · 一足：小跳、大跳（鼓皮冲击环 16 m，跳起来躲）、转身跳、拄拳、雷掌；
 *   二阶段 · 雷鼓（66%）：召鼓——跳上拉则旁、两只连鼓灵护驾、经幡杆通电；加捶胸引雷（每捶一下两道雷）；
 *   三阶段 · 风雨（33%）：擂台外圈落雷越来越密；连环大跳、捶胸五下、收招变短。
 *   场地：大跳落在带电的经幡杆 4.5 m 内被回劈（硬直 1.5 s + 200 + 破防条）；登场从残鼓里长出来、死时倒回残鼓。
 *   破防条 900（网页值，按耐久比例换算）：「破鼓」单膝跪地 4 s。
 * 数值：4-1 难度 3.4 下定档 34400 生命 / 网页 12000。落雷 / 导体 / 高原雷暴随 M7（src/world/mechanisms/），经 KuiStorm.ts 的适配层接。
 */
import { bossPhase, bossVitals, breakBarDef } from '../framework/BossDef';
import { LordDef } from './LordDef';
import { KUI_PLANS, KuiPalette } from './KuiPlans';

export class KuiDef extends LordDef {
  static readonly Id = 'boss_kui';
  static readonly FormId = 'kui';
  static readonly PrefabId = 'SK_Boss_Kui';
  static readonly DrumPrefabId = 'SM_Prop_KuiBrokenDrum';
  /** 阶段阈值（生命层比例） */
  static readonly DrumsAt = 0.66;
  static readonly StormAt = 0.33;
  /** 4-1 难度下的定档、网页版血量 */
  static readonly TierHp = 34400;
  static readonly Web = 12000;
  /** 弱点：胸口鼓心（drum_core 骨，离地约 3.4 m） */
  static readonly WeakBone = 'drum_core';

  // ───────────── 运行时层（网页版 bosses.ts 原值）─────────────
  /** 走到残鼓多近开打（米；4-1 的门槛由关卡目标的据点圆判，这里给测试场 / 兜底用） */
  triggerRadius = 22;
  /** 捶胸：每隔几招捶一次（二 / 三阶段） */
  drumEvery = 5;
  drumEvery3 = 4;
  /** 大跳：每几次小跳接一次；超过这么远直接大跳（米） */
  leapEvery = 4;
  leapBeyond = 16;
  /** 三阶段外圈落雷：间隔（秒）、离擂台中心的距离带（米）、预警、半径、伤害（网页值） */
  ringEvery = 1.2;
  ringBand: [number, number] = [20, 32];
  ringWarn = 1.2;
  ringRadius = 3.5;
  ringDamage = 16;
  /** 经幡杆回劈：落点离带电杆多近（米）、硬直秒数、伤害 / 破防条（网页值，按耐久比例换算） */
  backlashRadius = 4.5;
  backlashStun = 1.5;
  backlashDamage = 200;
  backlashBreak = 150;
  /** 召鼓：连鼓灵的敌人 id、只数；经幡杆一齐通电的电量 */
  lianguId = 'liangu';
  lianguCount = 2;
  drumsPoleCharge = 0.5;
  /** 捶胸时鼓心的倍率（网页 3.5，平时 2.5：弱点区的倍率乘 1.4） */
  drumOpenMult = 1.4;

  constructor() {
    super();
    this.id = KuiDef.Id;
    this.name = '夔';
    this.title = '一足之雷';
    this.prefab = KuiDef.PrefabId;
    this.webHp = KuiDef.Web;
    this.vitals = bossVitals(KuiDef.TierHp / LordDef.StageDifficulty);
    this.tiers.push({ difficulty: LordDef.StageDifficulty, vitals: bossVitals(KuiDef.TierHp) });
    this.damage = 16;
    this.speed = 2.5;
    this.element = 'shock';
    this.color = KuiPalette.Thunder;
    this.core = KuiPalette.ThunderCore;
    this.edge = KuiPalette.ThunderEdge;
    this.radius = 2.5;
    this.height = 6;
    this.idleMinRange = 6;
    this.idleMaxRange = 16;

    this.forms.push({ id: KuiDef.FormId, prefab: KuiDef.PrefabId, scale: 1, proxyPrefab: 'SK_Enemy_IronOx', proxyScale: 2.4, weakBone: KuiDef.WeakBone, weakRadius: 0.75 });
    this.phases.push(bossPhase({ at: KuiDef.DrumsAt, seconds: 3.2, anim: 'roar', sfx: 'boss_roar', shake: 0.5, toast: '二 · 雷鼓', restScale: 0.9 }));
    this.phases.push(bossPhase({ at: KuiDef.StormAt, seconds: 2.6, anim: 'drum', sfx: 'boss_roar', shake: 0.45, toast: '三 · 风雨', restScale: 0.75 }));

    this.hitZones.push({ id: 'chest', bone: 'chest', radius: 1.5 });
    this.hitZones.push({ id: 'hips', bone: 'hips', radius: 1.0 });
    this.hitZones.push({ id: 'head', bone: 'head', radius: 0.7, multiplier: 1.5, priority: 2 });
    this.hitZones.push({ id: 'shin', bone: 'shin', radius: 0.5 });

    this.breakBar = breakBarDef({ max: 900 * KuiDef.TierHp / KuiDef.Web, seconds: 4, pose: 'kneel', label: '破鼓', takenMult: 1.3 });

    for (const p of KUI_PLANS) this.moves.push({ ...p.spec });

    this.intro.seconds = 4.3;
    this.intro.anim = 'rise';
    this.intro.sfx = 'boss_roar';
    this.intro.shake = 0;
    this.intro.firstRest = 0.8;

    this.deathAnim = 'sink';
    const d = this.death;
    d.name = '夔 · 雷息';
    d.cardTitle = '夔 · 平息';
    d.cardSub = '雷暴退去';
    d.epithet = '4-1 · 经幡山头';
    d.radius = 13;
    d.height = 4;
    d.lookHeight = 3;
    d.orbitFrom = -0.3;
    d.orbitTo = 0.9;
  }
}
