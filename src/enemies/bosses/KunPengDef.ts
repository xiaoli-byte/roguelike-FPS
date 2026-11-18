/**
 * 鲲鹏定义（Unity KunPeng/KunPengDef.cs 逐项照搬；第二章首领，2-4 北冥冰台）。《庄子》北冥之鱼，化而为鸟：两个形态各是一个模型，阶段转换时在冰雾里换模型。
 *   一阶段 · 鲲（SK_Boss_Kun × 1.3，头和前半身探出冰窟，冰线以下不建模；模型原点 = 平切口，切口始终压在水面下）：
 *     吞吸、猛砸 + 冰浪、潜袭（从玩家那一侧破冰而出）、吐冰；平时在冰窟里慢慢绕到玩家那一侧。75% 以下鲲怒：猛砸连掀两道冰浪、吐冰多一块、喘息 × 0.8。
 *   转换（50%，4.6 s，第 1.55 s 换形）：鲲沉入冰窟，冰海炸开（整圈冰浪），冰雾最浓时换成鹏，鹏从雾里升空；护盾重凝六成，第一招扇翼狂风。
 *   二阶段 · 鹏（SK_Boss_Peng × 1.15，飞行形态）：扇翼狂风、俯冲掠台（撞冰柱 / 祭台硬直 1.8 s）、羽刃雨、落台歇翼（主要输出窗口）。
 *     25% 以下狂怒：俯冲连掠两次、羽刃 14 枚、喘息 0.7（= 阶段 0.9 × 狂怒 0.78）。
 *   弱点：额头的鲛珠（两个形态都是 pearl 骨骼），猛砸趴台、落台歇翼、撞柱时发亮。不召小怪。
 *   血条刻度：75%（鲲怒）、50%（化鹏）、25%（鹏狂怒）。
 *   数值：2-4 的难度 2.28 下定档 16000 生命 + 4800 护盾（I3 按首领浸泡实测把 BS3 的 8000 + 2400 翻倍，见 KunPengBalance：参考秒伤下约 85 s）。
 * 另附纯几何（KunPengMath：平切口上限、俯冲线）与击杀用时模型（KunPengBalance）。纯数据，不碰场景：运行时、测试都读它。
 */
import * as THREE from 'three';
import { BossDef, bossPhase, bossVitals, vitalsTotal } from './framework/BossDef';
import type { IceHoleInfo } from './KunPengArena';
import { kunPengSpecs, KUN, PENG, PengGust } from './KunPengPlans';

/** 命中区（设计尺寸 = 世界半径 ÷ 体型；Unity BossHitZoneDef） */
export interface KunPengHitZone {
  id: string;
  bone: string;
  radius: number;
  form: string;
}

export class KunPengDef extends BossDef {
  static readonly Id = 'boss_kunpeng';
  static readonly KunForm = KUN;
  static readonly PengForm = PENG;
  static readonly KunPrefab = 'SK_Boss_Kun';
  static readonly PengPrefab = 'SK_Boss_Peng';
  /** 化鹏阈值（生命层比例）与两个生命刻度 */
  static readonly SwapAt = 0.5;
  static readonly FuryAt = 0.75;
  static readonly RageAt = 0.25;
  static readonly FuryMark = 'kun_fury';
  static readonly RageMark = 'peng_rage';
  /** 转换演出时长与换形时刻（冰雾最浓的 1.55 s） */
  static readonly TransitionSeconds = 4.6;
  static readonly TransitionSwap = 1.55;
  /** 2-4 的难度与定档 */
  static readonly StageDifficulty = 2.28;
  static readonly TierHp = 16000;
  static readonly TierShield = 4800;

  static readonly Warn = 0x7fd8ff;
  static readonly Ice = 0xd8f6ff;
  static readonly Pearl = 0x7ff0ff;
  static readonly Gust = 0xbfe9ff;

  /** 两个形态的模型缩放（美术按 8 米制作：鲲约 10.4 m 高，鹏约 9.2 m） */
  static readonly KunScale = 1.3;
  static readonly PengScale = 1.15;
  /** 鲲露出水面时模型原点（平切口）在环台地面下多深、完全沉下去时多深 */
  static readonly KunBaseY = -1;
  static readonly KunSunkY = -14;
  /** 平切口的范围（模型单位，往后 / 往前 / 两侧）与它最高点至少压在水面下多深 */
  static readonly CutBack = 3;
  static readonly CutFront = 2.8;
  static readonly CutSide = 2.8;
  static readonly CutMargin = 0.3;
  /** Three.js 的海面在环台地面上 0.06 m */
  static readonly TsWaterLevel = 0.06;

  // ───────────── 鲲 ─────────────
  /** 鲲身体中心离冰沿多远（往冰窟里收：头部刚好探到冰沿上方） */
  kunInset = 4.6;
  /** 鲲的角色胶囊半径（世界米） */
  kunBodyRadius = 1.8;
  /** 平时绕到玩家那一侧的角速度、转头角速度（度/秒）、朝向偏离冰窟外法线的上限（度） */
  kunCircleRate = 6.875; kunTurnRate = 68.75; kunAimLimit = 51.57;

  // ───────────── 鹏 ─────────────
  /** 盘旋高度（离地，模型原点 = 双爪）；飞越冰窟上空时不低于 pengOverHole */
  pengHover = 13.5; pengOverHole = 11.5;
  /** 绕冰窟盘旋的角速度（度/秒）、掉头间隔（秒） */
  pengOrbitRate = 13.75;
  readonly pengOrbitFlip: readonly [number, number] = [5, 9];
  /** 水平加速度（米/秒²）、竖直速度上限 = 移速 × climb */
  pengAccel = 22; pengClimb = 1.5;

  // ───────────── 吞吸 / 狂风的推拉 ─────────────
  /** 每一下的冲量（米/秒）与间隔（秒）：单位时间的拉力与 Three.js 每 0.18 s 3.4 / 3.6 m/s 相同（约 19 m/s²） */
  pullImpulse = 2.95; pullInterval = 0.15;

  /** 额外命中区（鲲猛砸时头伸到冰沿外、鹏的两翼） */
  readonly hitZones: KunPengHitZone[] = [];

  constructor() {
    super();
    this.id = KunPengDef.Id;
    this.name = '鲲鹏';
    this.title = '北冥之鱼 · 化而为鸟';
    this.vitals = bossVitals(KunPengDef.TierHp / KunPengDef.StageDifficulty, KunPengDef.TierShield / KunPengDef.StageDifficulty);
    this.tiers.push({ difficulty: KunPengDef.StageDifficulty, vitals: bossVitals(KunPengDef.TierHp, KunPengDef.TierShield) });
    this.damage = 14;
    this.speed = 9;
    this.element = 'none';
    this.color = 0x7fe8ff;
    this.warnColor = KunPengDef.Warn;
    this.radius = 3;
    this.height = 8;
    this.repeatWeight = 0.2;
    this.phaseWait = 2;
    // 元素眩晕不生效：鲲在冰窟里、鹏在空中；撞柱是脚本化硬直（stagger）
    this.stunBetweenMoves = false;

    this.forms.push({
      id: KUN, name: '鲲', prefab: KunPengDef.KunPrefab, scale: KunPengDef.KunScale, proxyPrefab: 'SK_Enemy_IceWhale', proxyScale: 3,
      weakBone: 'pearl', weakRadius: 0.6 / KunPengDef.KunScale,
    });
    this.forms.push({
      id: PENG, name: '鹏', prefab: KunPengDef.PengPrefab, scale: KunPengDef.PengScale, proxyPrefab: 'SK_Enemy_Qingniao', proxyScale: 3.5,
      weakBone: 'pearl', weakRadius: 0.5 / KunPengDef.PengScale, flying: true, shieldRestore: 0.6, firstMove: PengGust.id,
    });
    this.phases.push(bossPhase({
      at: KunPengDef.SwapAt, form: PENG, seconds: KunPengDef.TransitionSeconds, formSwapAt: KunPengDef.TransitionSwap, anim: 'roar', sfx: 'boss_roar',
      shake: 0.6, toast: '鲲沉入冰窟——北冥要炸开了！', restScale: 0.9,
    }));
    this.marks.push({ at: KunPengDef.FuryAt, id: KunPengDef.FuryMark, tick: true });
    this.marks.push({ at: KunPengDef.RageAt, id: KunPengDef.RageMark, tick: true });
    this.hitZones.push({ id: 'kun_head', bone: 'head', radius: 2 / KunPengDef.KunScale, form: KUN });
    this.hitZones.push({ id: 'kun_neck', bone: 'spine_3', radius: 2.2 / KunPengDef.KunScale, form: KUN });
    this.hitZones.push({ id: 'peng_wing_l', bone: 'wing_L_2', radius: 1.6 / KunPengDef.PengScale, form: PENG });
    this.hitZones.push({ id: 'peng_wing_r', bone: 'wing_R_2', radius: 1.6 / KunPengDef.PengScale, form: PENG });

    this.moves.push(...kunPengSpecs());

    // 鹏狂怒（25%）由运行时在鹏形态时触发（enrageBelow 留 0：鲲形态不狂怒）；阶段 0.9 × 0.78 ≈ Three.js 的 0.7
    this.enrageBelow = 0;
    this.enrageAfter = 0;
    this.enrageRestScale = 0.7 / 0.9;
    this.enrageWindupScale = 1;
    this.enrageDamageScale = 1;
    this.enrageToast = '鹏狂怒了——俯冲会连掠两次，羽刃更密';
    this.summonCap = 0;

    this.intro.seconds = 3;
    this.intro.anim = 'rise';
    this.intro.sfx = null; // 吼声在升到一半时（KunPeng.introTick）
    this.intro.shake = 0;
    this.intro.firstRest = 1.2;
    // 倒下演出 4.4 s：鹏 55% 时砸到冰面、趴着挣两下再炸开；鲲沉到冰窟底才炸
    this.defeat.seconds = 4.4;
    this.defeat.despawnAfter = 2.5;
    this.defeat.toast = null; // 按倒下时的形态说（KunPeng.onDefeated）
    this.rewards = { essence: 60, coins: [60, 100], chest: 'weapon', healPlayer: true };
  }
}

// ───────────────────────────── 纯几何 ─────────────────────────────

const DEG = Math.PI / 180;

/** 鲲鹏的纯几何（Unity KunPengMath）：平切口的上限、角度、缓动、俯冲线 */
export const KunPengMath = {
  /**
   * 鲲的模型原点（平切口中心）最高能放到多高（相对水面，米）：前倾时切口后缘翘起、后仰时前缘翘起、侧倾时一侧翘起——
   * 都要留在水面下 CutMargin。pitch / roll 是弧度（绕 +X 正转 = 前倾），scale = 模型体型
   */
  cutCeiling(pitch: number, roll: number, scale = KunPengDef.KunScale): number {
    const sp = Math.sin(pitch);
    const lift = scale * (Math.max(KunPengDef.CutBack * sp, -KunPengDef.CutFront * sp, 0) + KunPengDef.CutSide * Math.abs(Math.sin(roll)));
    return -KunPengDef.CutMargin - lift;
  },

  /** 平切口一圈的取样点（模型单位，XZ：往后 3、往前 2.8、两侧 2.8 与四个斜角） */
  CutRim: [[0, -3], [0, 2.8], [2.8, 0], [-2.8, 0], [2, -2], [-2, -2], [2, 2], [-2, 2]] as readonly (readonly [number, number])[],

  /** t 在 [a, b] 里的比例（夹到 0..1） */
  span(t: number, a: number, b: number): number {
    return b > a ? Math.min(1, Math.max(0, (t - a) / (b - a))) : t >= b ? 1 : 0;
  },

  easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  },

  easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
  },

  /** 水平朝向（度，0 = +Z） */
  yaw(dir: { x: number; z: number }): number {
    return Math.atan2(dir.x, dir.z) / DEG;
  },

  dir(yawDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = yawDeg * DEG;
    return out.set(Math.sin(a), 0, Math.cos(a));
  },

  /** Unity Mathf.DeltaAngle：b − a 夹到 (−180, 180] */
  deltaAngle(a: number, b: number): number {
    let d = (b - a) % 360;
    if (d > 180) d -= 360;
    else if (d <= -180) d += 360;
    return d;
  },

  /** Unity Mathf.MoveTowardsAngle */
  moveTowardsAngle(current: number, target: number, maxDelta: number): number {
    const d = KunPengMath.deltaAngle(current, target);
    if (-maxDelta < d && d < maxDelta) return target;
    return current + Math.sign(d) * maxDelta;
  },

  /**
   * 俯冲掠台的路线：过玩家所在方位、离圆心 rp（夹在 冰窟 + 3 … 外缘 − 4）处，沿环台切线（side = ±1 决定往哪边掠），
   * 半长 = min(16, √((外缘 − 3)² − rp²))，两端都留在环台内。返回起点、朝向（度）与全长
   */
  swoopLine(hole: IceHoleInfo, player: { x: number; z: number }, side: number): { from: THREE.Vector3; yaw: number; length: number } {
    let ra = hole.angle(player), rp = hole.distance(player);
    if (!(rp > 0.5)) {
      ra = 0;
      rp = hole.radius + 3;
    }
    rp = Math.min(Math.max(hole.radius + 3, hole.outer - 4), Math.max(hole.radius + 3, rp));
    const tangent = ra + (side >= 0 ? 90 : -90);
    const edge = hole.outer - 3;
    const half = Math.min(16, Math.sqrt(Math.max(4, edge * edge - rp * rp)));
    const mid = hole.point(ra, rp);
    const from = mid.sub(KunPengMath.dir(tangent).multiplyScalar(half));
    return { from, yaw: tangent, length: half * 2 };
  },

  /**
   * 俯冲从哪一头进场：鹏在玩家切线的哪一头，就从哪一头掠过来（玩家把冰柱夹在自己和鹏之间，俯冲线就先穿过柱子——引撞）；
   * 鹏几乎在玩家正上方（沿切线不到 3 m）时用 fallback
   */
  swoopSide(hole: IceHoleInfo, player: { x: number; z: number }, bird: { x: number; z: number }, fallback: number): number {
    const ra = hole.distance(player) > 0.5 ? hole.angle(player) : 0;
    const t = KunPengMath.dir(ra + 90);
    const along = (bird.x - player.x) * t.x + (bird.z - player.z) * t.z;
    if (Math.abs(along) < 3) return fallback >= 0 ? 1 : -1;
    return along < 0 ? 1 : -1;
  },

  /**
   * 俯冲线上离起点 wallAt 米有一处陡面时线该多长：陡面在玩家之前（引撞）不改；陡面在玩家之后截到陡面前 pullUp 米，至少过玩家 past 米；没有陡面不改
   */
  trimSwoop(length: number, playerAt: number, wallAt: number, pullUp: number, past: number): number {
    if (!(wallAt < length) || wallAt <= playerAt) return length;
    return Math.min(length, Math.max(wallAt - pullUp, playerAt + past));
  },

  /** 这一趟是引撞：线上玩家之前就有陡面 */
  swoopLured(length: number, playerAt: number, wallAt: number): boolean {
    return wallAt < length && wallAt <= playerAt;
  },
};

// ───────────────────────────── 击杀用时 ─────────────────────────────

/**
 * 鲲鹏的定档模型（Unity KunPengBalance + BossBalance 的 2-4 那一行）：
 *   章末参考秒伤 = 首领浸泡实测（2-4：史诗 +2 裂风步枪 + 利刃 ×3 / 鹰目 ×2 / 屠巨 + 燎的技能，可选中时 405）× 0.8 命中率 ≈ 324；
 *   有效耐久 = 生命 + 护盾 + 化鹏时重凝的六成护盾；不可选中 = 登场 3 s + 转换 4.6 s + 一阶段约 3 次潜袭 × 1.5 s。
 * 目标击杀用时 60–120 s，±15% 秒伤也在里面。
 */
export const KunPengBalance = {
  /** BossBalance：击杀用时目标带、输出率、2-4 的浸泡实测秒伤（可选中时） */
  MinSeconds: 60, MaxSeconds: 120, Uptime: 0.8, SoakDps: 405,
  HitRate: 0.8, DivesPhase1: 3, DiveUnderwater: 1.5,

  /** 章末参考秒伤 */
  get referenceDps(): number {
    return KunPengBalance.SoakDps * KunPengBalance.HitRate;
  },

  /** 一场里不可选中的总秒数 */
  untargetableSeconds(def: BossDef): number {
    let transition = 0;
    for (const p of def.phases) transition += p.seconds;
    return def.intro.seconds + transition + KunPengBalance.DivesPhase1 * KunPengBalance.DiveUnderwater;
  },

  /** 有效耐久：三层合计 + 换形时重凝的护盾 / 护甲 */
  effectiveHp(def: BossDef, difficulty: number): number {
    const v = def.vitalsAt(difficulty);
    let extra = 0;
    const c01 = (x: number) => Math.min(1, Math.max(0, x));
    for (const f of def.forms) extra += v.shield * c01(f.shieldRestore ?? 0) + v.armor * c01(f.armorRestore ?? 0);
    return vitalsTotal(v) + extra;
  },

  /** 按秒伤 dps 打完一场的秒数（含不可选中） */
  killSeconds(def: BossDef, difficulty: number, dps: number): number {
    return KunPengBalance.effectiveHp(def, difficulty) / Math.max(1, dps) + KunPengBalance.untargetableSeconds(def);
  },
};
