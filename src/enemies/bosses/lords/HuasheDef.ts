/**
 * 化蛇（Unity Huashe/HuasheDef.cs；4-1 ④ 圣湖海子领主；chuanzang-combat-v1.md 4.3，设计单 docs/art/vfx/huashe.md）。
 * 《中山经》「人面豺身、鸟翼蛇行，其音如叱呼，见则其邑大水」。在湖里绕湖心岛游，弱点是嘴（只在张嘴时露出来：吐水、扑咬、吼叫、潜游扑出、噎住）。
 *   水：在水里时湿身——灼烧时长减半、雷殛 +50%；玩家自己站在 6 m 内的水里打出雷殛会电到自己（5，网页值）。
 *   一阶段 · 游：吐水弹、扑岸（搁浅 1.2 s 是最大的窗口）、翼拍浪（1 m 高的浪推到 30 m，跳过）；
 *   二阶段 · 涨水（66%）：湖水常驻 +1.2 m，岸边低处被淹（泡在水里每秒 2）；加吼叫涨水（再 +0.8 m，6 s 后退）、潜游突袭；
 *   三阶段 · 大水（33%）：湖水打漩，泡在水里往湖心拉；加尾扫，吼叫更勤。
 *   破防条 700（只在张嘴时填，BreakBarDef.fillWhen）：「噎住」翻肚子浮在水面 4 s、打断涨水。
 * 数值：4-1 难度 3.4 下定档 30000 生命 / 网页 10500。导航：化蛇在水里游，位置全由代码驱动。
 */
import { bossPhase, bossVitals, breakBarDef } from '../framework/BossDef';
import { LordDef } from './LordDef';
import { HUASHE_PLANS, HuashePalette } from './HuashePlans';

export class HuasheDef extends LordDef {
  static readonly Id = 'boss_huashe';
  static readonly FormId = 'huashe';
  static readonly PrefabId = 'SK_Boss_Huashe';
  static readonly FloodAt = 0.66;
  static readonly DelugeAt = 0.33;
  static readonly TierHp = 30000;
  static readonly Web = 10500;
  static readonly MouthBone = 'mouth';

  // ───────────── 运行时层（网页值）─────────────
  /** 常驻涨水（二阶段，米）、吼叫涨水（米）与停留秒数、退水速度（米 / 秒） */
  flood = 1.2;
  surge = 0.8;
  surgeHold = 6;
  surgeFall = 0.3;
  /** 泡在涨水里每秒的伤害（网页值）、三阶段往湖心拉的速度（m/s） */
  soakDamage = 2;
  whirlPull = 1.6;
  /** 湿身：灼烧时长倍率、雷殛倍率；玩家在 selfShockRange 米内的水里打雷殛电到自己（网页值） */
  wetBurn = 0.5;
  wetShock = 1.5;
  selfShockRange = 6;
  selfShockDamage = 5;
  /** 游速（弧度 / 秒，朝玩家那一侧的湖岸） */
  swimRate = 0.35;

  constructor() {
    super();
    this.id = HuasheDef.Id;
    this.name = '化蛇';
    this.title = '人面豺身 · 鸟翼蛇行';
    this.prefab = HuasheDef.PrefabId;
    this.webHp = HuasheDef.Web;
    this.vitals = bossVitals(HuasheDef.TierHp / LordDef.StageDifficulty);
    this.tiers.push({ difficulty: LordDef.StageDifficulty, vitals: bossVitals(HuasheDef.TierHp) });
    this.damage = 16;
    this.speed = 6;
    this.element = 'none';
    this.color = HuashePalette.Water;
    this.core = HuashePalette.Foam;
    this.edge = HuashePalette.Deep;
    this.radius = 1.6;
    this.height = 3.2;
    this.repeatWeight = 0.35;

    this.forms.push({ id: HuasheDef.FormId, prefab: HuasheDef.PrefabId, scale: 1, proxyPrefab: 'SK_Enemy_IceWhale', proxyScale: 1, weakBone: HuasheDef.MouthBone, weakRadius: 0.5, flying: true });
    this.phases.push(bossPhase({ at: HuasheDef.FloodAt, seconds: 3.2, anim: 'roar', sfx: 'boss_roar', shake: 0.4, toast: '二 · 涨水', restScale: 0.9 }));
    this.phases.push(bossPhase({ at: HuasheDef.DelugeAt, seconds: 2.6, anim: 'roar', sfx: 'boss_roar', shake: 0.4, toast: '三 · 大水', restScale: 0.75 }));

    this.hitZones.push({ id: 'chest', bone: 'chest', radius: 1.1 });
    this.hitZones.push({ id: 'head', bone: 'head', radius: 0.7, multiplier: 1.6, priority: 2 });
    this.hitZones.push({ id: 'spine', bone: 'spine2', radius: 1.0 });
    this.hitZones.push({ id: 'hips', bone: 'hips', radius: 0.9 });
    this.hitZones.push({ id: 'tail', bone: 'tail_3', radius: 0.6 });

    this.breakBar = breakBarDef({
      max: 700 * HuasheDef.TierHp / HuasheDef.Web, seconds: 4, pose: 'choke', label: '噎住', takenMult: 1.3,
      // 只在张嘴时填（Unity fillWhen = b is HuasheBrain h && h.MouthOpen）
      fillWhen: (b) => !!(b as { mouthOpen?: boolean } | null)?.mouthOpen,
    });

    for (const p of HUASHE_PLANS) this.moves.push({ ...p.spec });

    this.intro.seconds = 5.6;
    this.intro.anim = '';
    this.intro.sfx = null;
    this.intro.shake = 0;
    this.intro.firstRest = 0.8;

    this.deathAnim = 'choke';
    const d = this.death;
    d.name = '化蛇 · 水退';
    d.cardTitle = '化蛇 · 水退';
    d.cardSub = '湖面平了';
    d.epithet = '4-1 · 圣湖海子';
    d.radius = 16;
    d.height = 6;
    d.lookHeight = 1;
    d.orbitFrom = -0.3;
    d.orbitTo = 0.7;
  }
}
