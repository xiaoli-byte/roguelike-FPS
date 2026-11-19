/**
 * 飞廉（Unity Feilian/FeilianDef.cs；4-1 ⑤ 冰川口领主，风伯；chuanzang-combat-v1.md 4.2，设计单 docs/art/vfx/feilian.md）。
 * 鹿身雀头、鹿角、蛇尾羽扇；鹿角间悬着风雷珠（弱点 orb 骨）。只在冰舌顶上活动（擂台 34 m，不下冰崖）。
 *   风：擂台里一直有风——一二阶段从它那里往外推、三阶段往里吸；
 *   一阶段 · 风伯：蓄风狂风（50° 锥 40 m，躲在冰脊 / 巨石后不挨）、低头冲撞（撞上冰脊 / 巨石晕 2 s）、风刃、侧跃；
 *   二阶段 · 龙卷（66%）：加龙卷风柱（被火打中变火龙卷，被风吸回去烧它）、回旋冲撞；
 *   三阶段 · 风眼（33%）：风向反过来往里吸；加风雷爆（4 s 蓄力，前摇里打满破防条 = 珠碎打断）。
 *   破防条 800（网页值，按耐久换算）：「珠碎」侧倒 4 s、风停 6 s，25 s 后珠子重新长出来。
 * 数值：4-1 难度 3.4 下定档 31500 生命 / 网页 11000。
 */
import { bossPhase, bossVitals, breakBarDef } from '../framework/BossDef';
import { LordDef } from './LordDef';
import { FEILIAN_PLANS, FeilianPalette } from './FeilianPlans';

export class FeilianDef extends LordDef {
  static readonly Id = 'boss_feilian';
  static readonly FormId = 'feilian';
  static readonly PrefabId = 'SK_Boss_Feilian';
  static readonly TornadoAt = 0.66;
  static readonly EyeAt = 0.33;
  static readonly TierHp = 31500;
  static readonly Web = 11000;
  static readonly WeakBone = 'orb';
  /** 冰脊 / 巨石的碰撞体名前缀（低头冲撞撞上就晕） */
  static readonly ObstaclePrefixes = ['IceRidge', 'Boulder'] as const;

  // ───────────── 运行时层（网页版原值）─────────────
  /** 擂台风：影响半径、满强度半径（米）、吹着人走的速度（m/s；风雷爆蓄力时 2.6）、顺风 / 逆风步速比例；狂风猛推（m/s） */
  windRadius = 42;
  windCore = 10;
  windPush = 1.6;
  stormPush = 2.6;
  windSpeedK = 0.25;
  gustPush = 9;
  /** 珠碎：风停几秒、珠子多久重新长出来 */
  breakWindOff = 6;
  orbRegrow = 25;
  /** 侧跃：2 s 内挨打超过这么多（网页值，按耐久换算）就侧跳 */
  sidestepDamage = 700;
  /** 龙卷：寿命、追人速度、火龙卷寿命 / 被吸回去的速度、烧它的间隔 / 伤害（网页值）/ 半径 */
  tornadoLife = 9;
  tornadoSpeed = 3.5;
  fireLife = 8;
  fireSpeed = 6;
  fireTick = 0.5;
  fireDamage = 40;
  fireRadius = 3.5;

  constructor() {
    super();
    this.id = FeilianDef.Id;
    this.name = '飞廉';
    this.title = '风伯';
    this.prefab = FeilianDef.PrefabId;
    this.webHp = FeilianDef.Web;
    this.vitals = bossVitals(FeilianDef.TierHp / LordDef.StageDifficulty);
    this.tiers.push({ difficulty: LordDef.StageDifficulty, vitals: bossVitals(FeilianDef.TierHp) });
    this.damage = 16;
    this.speed = 7;
    this.element = 'none';
    this.color = FeilianPalette.Wind;
    this.core = FeilianPalette.WindCore;
    this.edge = FeilianPalette.WindEdge;
    this.radius = 1.6;
    this.height = 5;
    this.idleMinRange = 12;
    this.idleMaxRange = 18;
    this.repeatWeight = 0.35;

    this.forms.push({ id: FeilianDef.FormId, prefab: FeilianDef.PrefabId, scale: 1, proxyPrefab: 'SK_Enemy_IronOx', proxyScale: 2, weakBone: FeilianDef.WeakBone, weakRadius: 0.6 });
    this.phases.push(bossPhase({ at: FeilianDef.TornadoAt, seconds: 3.0, anim: 'tornado', sfx: 'boss_roar', shake: 0.4, toast: '二 · 龙卷', restScale: 0.9 }));
    this.phases.push(bossPhase({ at: FeilianDef.EyeAt, seconds: 2.6, anim: 'roar', sfx: 'boss_roar', shake: 0.4, toast: '三 · 风眼', restScale: 0.75 }));

    this.hitZones.push({ id: 'chest', bone: 'chest', radius: 1.0 });
    this.hitZones.push({ id: 'hips', bone: 'hips', radius: 0.9 });
    this.hitZones.push({ id: 'neck', bone: 'neck', radius: 0.5 });
    this.hitZones.push({ id: 'head', bone: 'head', radius: 0.45, multiplier: 1.5, priority: 2 });

    this.breakBar = breakBarDef({ max: 800 * FeilianDef.TierHp / FeilianDef.Web, seconds: 4, pose: 'down', label: '珠碎', takenMult: 1.3 });

    for (const p of FEILIAN_PLANS) this.moves.push({ ...p.spec });

    this.intro.seconds = 5.4;
    this.intro.anim = 'sidestep';
    this.intro.sfx = null;
    this.intro.shake = 0;
    this.intro.firstRest = 0.8;

    this.deathAnim = 'down';
    const d = this.death;
    d.name = '飞廉 · 风止';
    d.cardTitle = '飞廉 · 风止';
    d.cardSub = '盆地的风停了';
    d.epithet = '4-1 · 冰川口';
    d.radius = 14;
    d.height = 5;
    d.lookHeight = 2;
    d.orbitFrom = -0.4;
    d.orbitTo = 0.8;
  }
}
