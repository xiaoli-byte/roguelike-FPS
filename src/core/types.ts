/**
 * 全局共享契约（冻结）。所有子系统只通过这里的接口互相调用。
 * 修改本文件 = 修改契约，只允许架构负责人（集成阶段）改动。
 *
 * 约定：
 *  - 单位：米、秒、弧度。Y 轴向上。实体 position 一律指「脚底中心」。
 *  - 所有 update(dt) 的 dt 已经乘过 timeScale，且被钳制在 <= 0.05s。
 *  - 构造函数里不要访问 ctx 上的其他系统（可能尚未创建），跨系统初始化放到 init()。
 *  - 所有中文文案面向玩家。
 */
import type * as THREE from 'three';
import type { EventBus } from './EventBus';
import type { Input } from './Input';
import type { Rng } from './Rng';
import type { Stats } from './Stats';
import type { TaskRunner } from './Tasks';
import type { CollisionWorld } from '../world/Collision';

// ───────────────────────────── 基础枚举 ─────────────────────────────

export type Element = 'none' | 'fire' | 'shock' | 'corrode';
export const ELEMENTS: readonly Element[] = ['none', 'fire', 'shock', 'corrode'];
export const ELEMENT_NAMES: Record<Element, string> = { none: '物理', fire: '灼烧', shock: '雷殛', corrode: '蚀化' };
export const ELEMENT_COLORS: Record<Element, number> = { none: 0xfff1d6, fire: 0xff6a1f, shock: 0x6fd8ff, corrode: 0x9dff4a };

/** 0 普通 / 1 精良 / 2 稀有 / 3 史诗 / 4 传说 */
export type Rarity = 0 | 1 | 2 | 3 | 4;
export const RARITY_NAMES: readonly string[] = ['普通', '精良', '稀有', '史诗', '传说'];
export const RARITY_COLORS: readonly number[] = [0xcfd3da, 0x62d36a, 0x4aa3ff, 0xb45cff, 0xffa726];
export const RARITY_CSS: readonly string[] = ['#cfd3da', '#62d36a', '#4aa3ff', '#b45cff', '#ffa726'];

export type GameState =
  | 'boot'
  | 'menu'        // 主菜单 / 选英雄 / 天赋等界面
  | 'playing'     // 游戏进行中（鼠标锁定）
  | 'paused'      // Esc 暂停
  | 'modal'       // 游戏内模态框（选秘卷等），玩法冻结、鼠标解锁
  | 'transition'  // 关卡切换淡入淡出中
  | 'summary';    // 结算界面（死亡 / 通关）

// ───────────────────────────── 属性（Stats） ─────────────────────────────

/**
 * 所有属性都是「基础值 + 修饰值之和」（纯加法）。
 * 以 Pct 结尾的是百分比加成：最终倍率 = 1 + value（0.2 = +20%）。
 * 冷却类：实际冷却 = 基础冷却 / (1 + skillHaste)。
 * 换弹：实际换弹时间 = 基础时间 / (1 + reloadSpeedPct)。
 * damageReduction 为受伤减免比例，结算时钳制到 [0, 0.8]。
 */
export type StatKey =
  // 生存
  | 'maxHp' | 'maxShield' | 'shieldRegenDelay' | 'shieldRegenRate' | 'hpRegen'
  | 'damageReduction' | 'lifesteal' | 'killHeal' | 'killShield'
  // 移动
  | 'moveSpeed' | 'jumpVelocity' | 'extraJumps' | 'dashCooldown' | 'dashCharges'
  // 输出
  | 'damagePct' | 'critChance' | 'critDamagePct'
  | 'fireRatePct' | 'reloadSpeedPct' | 'magSizePct' | 'ammoReservePct' | 'spreadPct' | 'recoilPct'
  | 'projectileSpeedPct' | 'explosionRadiusPct' | 'explosionDamagePct'
  | 'bossDamagePct' | 'eliteDamagePct' | 'shieldDamagePct' | 'armorDamagePct'
  // 元素
  | 'elementChancePct' | 'elementDamagePct' | 'fireDamagePct' | 'shockDamagePct' | 'corrodeDamagePct'
  | 'reactionDamagePct' | 'reactionHaste'
  // 技能
  | 'skillDamagePct' | 'skillHaste' | 'secondaryCharges'
  // 经济 / 杂项
  | 'pickupRadius' | 'coinGainPct' | 'luck';

// ───────────────────────────── 伤害 / 状态 ─────────────────────────────

export type DamageSource = 'weapon' | 'skill' | 'status' | 'explosion' | 'scroll' | 'melee';
export type DamageLayer = 'shield' | 'armor' | 'health';
export type StatusId = 'burn' | 'shock' | 'corrode' | 'stun' | 'slow';

// ───── 元素反应（docs/arsenal-expansion.md 第 2 节） ─────
export type ReactionId = 'thunderfire' | 'meltdown' | 'veinseal' | 'abyss';
export const REACTION_IDS: readonly ReactionId[] = ['thunderfire', 'meltdown', 'veinseal', 'abyss'];
export const REACTION_NAMES: Record<ReactionId, string> = { thunderfire: '焚雷', meltdown: '熔金', veinseal: '封脉', abyss: '归墟' };
export const REACTION_COLORS: Record<ReactionId, number> = { thunderfire: 0xffd84a, meltdown: 0xff7a1a, veinseal: 0x5affd0, abyss: 0xc89bff };
/** 反应伤害请求统一带的标签（第二个标签为反应 id） */
export const REACTION_TAG = 'reaction';
/** 引爆结果：引发了某个反应，或单一状态的「崩解」 */
export type DetonateOutcome = ReactionId | 'collapse';
export interface StatusApplyOpts {
  /** 这次附着的 procDepth（缺省 0；>= 2 不会引发反应；只有 0 会触发雷殛弹射） */
  depth?: number;
  /** 归属武器（由它引发的反应带上该 weaponUid） */
  weaponUid?: number;
  /** 由这次附着引发的反应威力倍率（缺省 1；「万象」传 0.6） */
  reactionScale?: number;
}
export interface TriggerReactionOpts {
  depth?: number;
  weaponUid?: number;
  /** 反应中心；敌人已死时必须提供 */
  point?: THREE.Vector3;
  /** 无视该敌人该反应的内置冷却 */
  ignoreIcd?: boolean;
  /** 直接指定反应威力 B（跳过 k × power 与上下限） */
  fixedBase?: number;
  /** 威力倍率（缺省 1） */
  scale?: number;
  /** 透传到 'enemy:reaction'.tag（'echo' / 'nirvana' / 'kalpa'） */
  tag?: string;
}
export interface DetonateOpts {
  /** 引爆这一击的强度（通常 = 该次实际伤害；内部钳到最大生命 × 0.5） */
  power: number;
  /** 强度倍率，缺省 1 */
  mult?: number;
  depth?: number;
  weaponUid?: number;
  point?: THREE.Vector3;
}

export interface DamageRequest {
  /** 未乘任何倍率的基础伤害 */
  base: number;
  element: Element;
  source: DamageSource;
  /** 元素附着概率 0..1（会再叠加 elementChancePct），缺省 0 */
  elementChance?: number;
  /** 是否命中头部（命中即暴击） */
  headshot?: boolean;
  /** 暴击倍率（武器决定，默认 2.0）。最终暴击倍率 = critMult * (1 + critDamagePct) */
  critMult?: number;
  /** 是否允许随机暴击（critChance），默认 true；状态伤害等应为 false */
  canCrit?: boolean;
  /** 强制暴击 */
  forceCrit?: boolean;
  weaponUid?: number;
  point?: THREE.Vector3;
  direction?: THREE.Vector3;
  /** 击退冲量（米/秒），沿 direction；explode 中只有显式设置才生效（无默认击退） */
  knockback?: number;
  /**
   * 链式触发层数。直接伤害为 0；由 on-hit 效果（秘卷、元素连锁等）衍生出的伤害 >= 1。
   * 所有「命中时触发」的效果必须检查 procDepth < 2 以防无限递归。
   */
  procDepth?: number;
  /**
   * 标签。已约定：'explosion'（由 explode 结算）、'chain'（雷殛弹射）、
   * 'purge'（静默处决：EnemyManager.killAll 等清场用，掉落与「击杀时」效果应忽略它）
   */
  tags?: string[];
}

export interface DamageResult {
  request: DamageRequest;
  /** 实际扣除的总量 */
  dealt: number;
  isCrit: boolean;
  killed: boolean;
  /** 这次伤害最先打在哪一层 */
  layer: DamageLayer;
  shieldBroken: boolean;
  armorBroken: boolean;
  element: Element;
  statusApplied: StatusId | null;
  /** 这一击的元素附着引发的反应（Combat 第 4 步写入，早于 'enemy:damaged'） */
  reaction?: ReactionId | null;
}

export interface StatusInstance {
  id: StatusId;
  stacks: number;
  /** 剩余秒数 */
  remaining: number;
  /** 下次 tick 倒计时 */
  tickTimer: number;
  /** 施加时的强度（通常 = 触发伤害的一部分），用于计算 DOT */
  power: number;
}

// ───────────────────────────── 关卡 / 流程 ─────────────────────────────

export type StageType = 'combat' | 'elite' | 'treasure' | 'shop' | 'boss';
export type RewardType = 'scroll' | 'weapon' | 'coins' | 'heal' | 'upgrade' | 'none';
export type ThemeId = 'desert' | 'frost' | 'inferno';

export const CHAPTER_COUNT = 3;
/** 每章关卡数（最后一关是 Boss） */
export const STAGES_PER_CHAPTER = 5;

export interface StageNode {
  chapter: number;      // 0-based
  index: number;        // 章内 0-based，STAGES_PER_CHAPTER-1 为 Boss
  type: StageType;
  reward: RewardType;   // 清关后宝箱给什么
  theme: ThemeId;
}

export interface RunState {
  heroId: string;
  seed: number;
  chapter: number;
  stageIndex: number;
  stage: StageNode;
  coins: number;
  kills: number;
  damageDealt: number;
  /** 本局已进行秒数（仅 playing 状态累计） */
  time: number;
  stagesCleared: number;
  /** 本局获得的局外货币（魂晶） */
  essence: number;
  /** 敌人强度倍率，随章节/关卡递增 */
  difficulty: number;
  /**
   * 自由使用的计数器 / 开关。已约定的键：
   *  - infiniteAmmo: >0 时武器射击不消耗弹匣（技能写入，武器系统读取；换关时 Game 归零）
   *  - glide: >0 时空中按住跳跃可滑翔（雷隼被动写入，玩家控制器读取；换关时不归零）
   */
  flags: Record<string, number>;
}

export interface RunSummary {
  victory: boolean;
  heroId: string;
  chapter: number;
  stageIndex: number;
  stagesCleared: number;
  kills: number;
  damageDealt: number;
  time: number;
  coins: number;
  essenceEarned: number;
  scrolls: { id: string; name: string; rarity: Rarity; stacks: number }[];
  weapons: string[];
}

export interface Settings {
  sensitivity: number;     // 鼠标灵敏度倍率，默认 1
  fov: number;             // 竖直 FOV，默认 80
  masterVolume: number;    // 0..1
  sfxVolume: number;
  musicVolume: number;
  quality: 'low' | 'medium' | 'high';
  damageNumbers: boolean;
  screenShake: number;     // 0..1
  invertY: boolean;
}

// ───────────────────────────── 事件 ─────────────────────────────

export interface GameEvents {
  'enemy:spawned': { enemy: IEnemy };
  'enemy:damaged': { enemy: IEnemy; result: DamageResult };
  'enemy:killed': { enemy: IEnemy; result: DamageResult };
  'enemy:statusApplied': { enemy: IEnemy; status: StatusId; stacks: number };
  'enemy:shieldBroken': { enemy: IEnemy };
  'enemy:armorBroken': { enemy: IEnemy };
  /** 反应效果执行完毕后派发（不在伤害管线内，监听者可以直接造成伤害）。point 为复用向量，保存请 clone */
  'enemy:reaction': { enemy: IEnemy; reaction: ReactionId; point: THREE.Vector3; base: number; depth: number; hits: number; weaponUid?: number; origin: 'status' | 'detonate' | 'forced'; tag?: string; centerKilled: boolean; stunned: boolean };
  'player:damaged': { amount: number; toShield: number; toHp: number; element: Element; source: IEnemy | null; from: THREE.Vector3 | null };
  'player:shieldBroken': {};
  'player:healed': { amount: number };
  'player:died': {};
  'player:jumped': {};
  'player:landed': { fallSpeed: number };
  'player:dashed': {};
  'weapon:fired': { weapon: WeaponInstance };
  'weapon:reloadStart': { weapon: WeaponInstance };
  'weapon:reloaded': { weapon: WeaponInstance };
  'weapon:switched': { weapon: WeaponInstance | null; slot: number };
  'weapon:acquired': { weapon: WeaponInstance };
  /** 双形态武器开始切换形态（form 为目标形态；docs/demon-blade.md 第 10 节） */
  'weapon:formChanged': { weapon: WeaponInstance; form: WeaponForm };
  /** 释放武器技能（魔刀千刃「千刃·无间」） */
  'weapon:skillUsed': { weapon: WeaponInstance; skillId: string };
  /** 「千刃·无间」贯穿结算（每次释放最多一次）：points 为各刃印敌人的身体中心（新建数组，HUD 画视野外方向提示） */
  'weapon:skillImpale': { weapon: WeaponInstance; points: THREE.Vector3[] };
  'skill:used': { slot: 'primary' | 'secondary'; skillId: string };
  'stage:loaded': { stage: StageNode };
  'stage:cleared': { stage: StageNode };
  'wave:started': { index: number; total: number };
  'coins:changed': { coins: number; delta: number };
  'scroll:acquired': { id: string; stacks: number };
  'pickup': { kind: 'coin' | 'ammo' | 'health' | 'weapon' | 'essence'; amount: number };
  'run:started': { run: RunState };
  'run:ended': { summary: RunSummary };
  'game:stateChanged': { from: GameState; to: GameState };
}

// ───────────────────────────── 通用系统形态 ─────────────────────────────

export interface System {
  /** 所有系统都构造完成后调用一次 */
  init?(): void;
  /** 关卡切换 / 新开一局时清场 */
  clear?(): void;
  update?(dt: number): void;
}

// ───────────────────────────── 玩家 ─────────────────────────────

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  /** 基础冷却（秒）；受 skillHaste 影响 */
  cooldown: number;
  /** 最大充能数（>=1）；副技能额外 + secondaryCharges */
  charges: number;
  /** 激活。返回 false 表示本次未能释放（不消耗充能） */
  activate(ctx: GameContext): boolean;
  /** 可选：每帧调用（用于持续型技能），在 playing 状态下 */
  update?(ctx: GameContext, dt: number): void;
  /** 持续型技能：当前是否处于激活状态（HUD 显示） */
  isActive?(ctx: GameContext): boolean;
}

export interface SkillState {
  def: SkillDef;
  charges: number;
  maxCharges: number;
  /** 正在恢复的那一格充能剩余秒数（满充能时为 0） */
  cooldownRemaining: number;
  /** 当前实际冷却时长（已算 haste），用于 HUD 画进度 */
  cooldownTotal: number;
}

export interface HeroDef {
  id: string;
  name: string;
  title: string;
  description: string;
  /** 主题色 */
  color: number;
  /** 覆盖基础属性 */
  base: Partial<Record<StatKey, number>>;
  startingWeapon: string;
  /** Q：主技能 */
  primary: SkillDef;
  /** E：副技能（通常是多充能的投掷物） */
  secondary: SkillDef;
  passive: {
    name: string;
    description: string;
    /** 安装被动，返回卸载函数 */
    apply(ctx: GameContext): () => void;
  };
}

export interface IPlayer extends System {
  /** 脚底中心 */
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  /** 眼睛（相机）世界坐标，每帧更新 */
  readonly eye: THREE.Vector3;
  yaw: number;
  pitch: number;
  hp: number;
  shield: number;
  readonly stats: Stats;
  readonly hero: HeroDef | null;
  readonly alive: boolean;
  readonly onGround: boolean;
  readonly radius: number;
  readonly height: number;
  /** 剩余无敌时间（秒），>0 时不受伤 */
  invulnerableTime: number;
  /** 最近一次受伤的 ctx.time.now */
  readonly lastDamageTime: number;
  readonly isDashing: boolean;
  readonly dashCharges: number;
  readonly dashCooldownRemaining: number;
  /** 正在被 lunge() 驱动位移（魔刀千刃的武器技能突进 / 第三段前冲） */
  readonly isLunging: boolean;
  readonly skills: { primary: SkillState | null; secondary: SkillState | null };
  maxHp(): number;
  maxShield(): number;
  /** 瞄准方向（单位向量，含 pitch） */
  getAimDirection(out: THREE.Vector3): THREE.Vector3;
  /** 水平朝向（单位向量，y=0） */
  getForward(out: THREE.Vector3): THREE.Vector3;
  /** 后坐力：正 pitch = 枪口上跳 */
  addRecoil(pitch: number, yaw: number): void;
  /** 承受伤害（已经过 combat 的减伤计算），返回实际扣除量 */
  takeDamage(amount: number, element: Element, source: IEnemy | null, from?: THREE.Vector3 | null): number;
  heal(amount: number): number;
  addShield(amount: number): number;
  applyImpulse(v: THREE.Vector3): void;
  /**
   * 受控突进：沿水平方向 dir（内部压平并归一化，调用方可传复用向量）在 time 秒内移动 dist 米。走正常碰撞求解（贴地、台阶），被墙挡住时提前结束。
   * - iframes > 0（硬突进，武器技能）：invulnerableTime = max(当前, iframes)；匀速、忽略移动 / 冲刺 / 跳跃输入与外力，竖直速度为 0（空中释放时悬停）；
   *   结束时水平速度设为 dir × exitSpeed（缺省 0）。
   * - iframes = 0（软突进，斩击前冲 / 追击）：只把沿 dir 的速度分量抬到不低于 dist / time，侧向速度、重力、跳跃照常；
   *   冲刺与外力直接打断它；结束时沿 dir 的速度回落到 max(exitSpeed, 突进开始时沿 dir 的速度)（边跑边砍不减速）。
   * 新的 lunge 覆盖进行中的；teleport / 死亡 / 新开一局会结束它。返回 false 表示未执行（已死亡、dist 或 time 非正）。
   */
  lunge(dir: THREE.Vector3, dist: number, time: number, iframes?: number, exitSpeed?: number): boolean;
  /** 立即结束进行中的突进（按上面的出口规则处理速度）；不在突进时无效果 */
  cancelLunge(): void;
  /** 镜头冲击（不改瞄准）：roll / pitch 为镜头弹簧的角速度冲量（弧度/秒，与受击抖动同一弹簧），正 pitch = 上仰 */
  cameraPunch(roll: number, pitch: number): void;
  teleport(pos: THREE.Vector3, yaw?: number): void;
  /** 新开一局：设置英雄、重置属性（含天赋）、满血 */
  resetForRun(hero: HeroDef): void;
  /** 立即给技能回复冷却（秒），用于秘卷等 */
  reduceCooldowns(seconds: number, slot?: 'primary' | 'secondary' | 'both'): void;
}

// ───────────────────────────── 武器 ─────────────────────────────

export interface WeaponAffix {
  id: string;
  /** 数值（含义由武器系统解释，如 0.1 = +10%） */
  value: number;
}

export interface WeaponInstance {
  uid: number;
  defId: string;
  rarity: Rarity;
  element: Element;
  /** 商店强化等级，0 起 */
  level: number;
  mag: number;
  reserve: number;
  affixes: WeaponAffix[];
}

export interface WeaponDescription {
  name: string;
  category: string;
  rarity: Rarity;
  rarityName: string;
  color: string;       // CSS 颜色
  element: Element;
  /** 例如 [{label:'伤害', value:'42 ×8'}, {label:'射速', value:'1.2/s'}] */
  stats: { label: string; value: string }[];
  /** 词条 / 特性描述 */
  traits: string[];
  /** 元素的特殊显示（如三才转轮的「三相」）；有值时 UI 用它代替元素单字 */
  elementLabel?: string;
  /** 双形态武器的形态显示名 [近战, 远程]（魔刀千刃：['斩', '千刃']） */
  formNames?: [string, string];
  /** 武器技能（名称 / 按键提示 / 描述 / 基础冷却秒数），UI 单独成行显示 */
  skill?: { name: string; key: string; description: string; cooldown: number };
}

/**
 * 双形态武器的形态（docs/demon-blade.md）：'melee' = 近战形态（魔刀「斩」），'ranged' = 远程形态（魔刀「千刃」）。
 */
export type WeaponForm = 'melee' | 'ranged';

/** 武器技能的 HUD 状态（IWeaponSystem.weaponSkill 返回复用对象，读取后不要保存引用） */
export interface WeaponSkillState {
  id: string;
  name: string;
  /** HUD 图标单字 */
  glyph: string;
  /** 按键提示（'V'） */
  key: string;
  /** 剩余冷却秒数（0 = 就绪） */
  cooldownRemaining: number;
  /** 当前实际冷却时长（已算 skillHaste），HUD 画冷却环 */
  cooldownTotal: number;
  /** 释放中（突进或等待贯穿） */
  active: boolean;
}

export interface IWeaponSystem extends System {
  /** 长度恒为 2 */
  readonly slots: readonly (WeaponInstance | null)[];
  readonly activeSlot: number;
  readonly active: WeaponInstance | null;
  readonly isReloading: boolean;
  /** 0..1 */
  readonly reloadProgress: number;
  /** 当前准星扩散（弧度），HUD 用来画准星 */
  readonly currentSpread: number;
  /** 蓄力武器的当前蓄力进度 0..1（非蓄力 / 未蓄力为 0） */
  readonly chargeProgress?: number;
  /** 当前武器的形态（非双形态武器 / 空手为 null） */
  readonly activeForm?: WeaponForm | null;
  /** 形态切换进度 0..1（1 = 已完成 / 未在切换） */
  readonly formMorphProgress?: number;
  /** 「换形一击」窗口剩余秒数（0 = 无窗口或已用掉；HUD 武器槽发光） */
  readonly formStrikeTime?: number;
  /** 当前武器的武器技能状态（当前武器没有武器技能时为 null） */
  readonly weaponSkill?: WeaponSkillState | null;
  /** 近战形态：下一段斩击此刻挥出能命中至少一名敌人（每 3 帧更新；非近战形态为 false，准星据此提示攻击距离） */
  readonly meleeInRange?: boolean;
  /** 当前武器实际弹匣容量（含加成） */
  magCapacity(inst: WeaponInstance): number;
  reserveCapacity(inst: WeaponInstance): number;
  /** 新开一局 */
  resetForRun(startingWeaponId: string): void;
  /** 拾取：若有空槽放入空槽，否则替换当前武器，返回被替换下来的武器（由调用者丢到地上） */
  give(inst: WeaponInstance): WeaponInstance | null;
  /** 按最大备弹的比例补充所有武器的备弹 */
  addAmmoFraction(frac: number): void;
  /** 随机生成武器。chapter 影响稀有度分布，luck 属性会自动计入 */
  roll(opts?: { chapter?: number; rarity?: Rarity; minRarity?: Rarity; defId?: string }): WeaponInstance;
  describe(inst: WeaponInstance): WeaponDescription;
  /** 世界中的掉落模型（新建对象，调用者负责加到场景/移除） */
  createWorldModel(inst: WeaponInstance): THREE.Object3D;
  /** 强化一级的价格；返回 null 表示满级 */
  upgradeCost(inst: WeaponInstance): number | null;
  upgrade(inst: WeaponInstance): void;
  /** 显示/隐藏第一人称武器模型 */
  setViewmodelVisible(v: boolean): void;
  /** 某把武器所有定义 id（调试/商店用） */
  allDefIds(): string[];
}

// ───────────────────────────── 敌人 ─────────────────────────────

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  shield?: number;
  armor?: number;
  /** 移动速度 m/s */
  speed: number;
  radius: number;
  height: number;
  flying?: boolean;
  /** 基础攻击伤害（由子类解释） */
  damage: number;
  /** 击杀掉落金币区间 */
  coins: [number, number];
  /** 击杀掉落魂晶（局外货币） */
  essence?: number;
  isBoss?: boolean;
  /** 头部中心相对脚底的高度（缺省 height*0.85）与半径（缺省 radius*0.55） */
  headY?: number;
  headRadius?: number;
  /** 击退抗性 0..1 */
  knockbackResist?: number;
  /** 敌人主题色，用于特效 */
  color?: number;
}

export interface SpawnOptions {
  position: THREE.Vector3;
  elite?: boolean;
  /** 精英词缀 id（由敌人系统解释） */
  affix?: string;
  /** 强度倍率，通常 = run.difficulty */
  level?: number;
}

export interface EnemyRayHit {
  enemy: IEnemy;
  distance: number;
  point: THREE.Vector3;
  headshot: boolean;
}

export interface IEnemy {
  readonly id: number;
  readonly def: EnemyDef;
  readonly displayName: string;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly root: THREE.Object3D;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  armor: number;
  maxArmor: number;
  alive: boolean;
  /** 死亡动画播放完毕，可以从管理器移除 */
  readonly removed: boolean;
  readonly isElite: boolean;
  /** 精英词缀 id（swift / shielded / volatile / frenzied），非精英为 null */
  readonly affix: string | null;
  readonly isBoss: boolean;
  readonly flying: boolean;
  readonly radius: number;
  readonly height: number;
  readonly level: number;
  readonly statuses: Map<StatusId, StatusInstance>;
  /** 眩晕剩余秒数（>0 时不行动） */
  stunTime: number;
  /** 由状态系统每帧写入的移速倍率（1 = 正常） */
  slowMult: number;
  /** 受到伤害倍率（蚀化等写入），1 = 正常 */
  damageTakenMult: number;
  knockbackResist: number;
  /**
   * 不可选中（例如 Boss 登场、阶段转换）：EnemyManager 的 raycast/queryRadius/nearest 跳过它，
   * Combat.damageEnemy / applyStatus 对它直接返回。缺省 false。
   */
  readonly untargetable?: boolean;
  /** 此刻免疫眩晕（Boss 出招中等）：Combat 施加 stun 时直接忽略（不播特效、不派发事件）。缺省 false */
  readonly stunImmune?: boolean;
  getHeadCenter(out: THREE.Vector3): THREE.Vector3;
  getBodyCenter(out: THREE.Vector3): THREE.Vector3;
  /** 射线命中测试（头部球 + 身体胶囊） */
  raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean;
  /** combat 结算后回调：受击闪白、打断等 */
  onDamaged(result: DamageResult): void;
  /** combat 判定死亡时回调：开始死亡动画 */
  onKilled(result: DamageResult): void;
  knockback(impulse: THREE.Vector3): void;
  update(dt: number): void;
  dispose(): void;
}

export interface IEnemyManager extends System {
  /** 当前所有敌人（包括正在播放死亡动画的，需检查 alive） */
  readonly list: readonly IEnemy[];
  spawn(defId: string, opts: SpawnOptions): IEnemy | null;
  aliveCount(): number;
  /** 最近的被射线命中的活着的敌人 */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: ReadonlySet<IEnemy>): EnemyRayHit | null;
  /** 半径内活着的敌人（按身体中心判定，考虑敌人半径） */
  queryRadius(center: THREE.Vector3, radius: number, out?: IEnemy[]): IEnemy[];
  nearest(pos: THREE.Vector3, maxDist: number, exclude?: ReadonlySet<IEnemy>): IEnemy | null;
  killAll(): void;
}

export interface WaveEntry {
  enemyId: string;
  count: number;
  elite?: boolean;
  affix?: string;
}

export interface WavePlan {
  entries: WaveEntry[];
  /** 当上一波剩余存活数 <= 此值时开始本波（缺省 0 = 清完才开始） */
  triggerRemaining?: number;
  /** 满足触发条件后再延迟多少秒（缺省 1.2） */
  delay?: number;
}

// ───────────────────────────── 战斗 / 投射物 ─────────────────────────────

/** 返回伤害倍率（1 = 不变） */
export type OutgoingDamageModifier = (enemy: IEnemy, req: DamageRequest, isCrit: boolean) => number;
/** 返回伤害倍率（1 = 不变） */
/**
 * 返回伤害倍率（1 = 不变）。Combat 按函数形参个数排序：不读取 amount 的修饰器请声明为零参数函数，
 * 读取 amount 的修饰器（例如致命伤判定）排在最后，看到的是减伤与其他修饰器之后的数值。
 */
export type IncomingDamageModifier = (amount: number, element: Element, source: IEnemy | null) => number;

export interface ExplosionOptions {
  /** 对玩家造成的伤害（缺省 0 = 不伤玩家） */
  playerDamage?: number;
  color?: number;
  /** 不播放爆炸特效与爆炸音效 */
  noFx?: boolean;
  /** 伤害随距离衰减到边缘的比例（缺省 0.5） */
  falloff?: number;
  exclude?: ReadonlySet<IEnemy>;
}

export interface ICombat extends System {
  /** 对敌人造成伤害（完整管线：倍率、暴击、分层、元素附着、事件、死亡）。敌人已死返回 null */
  damageEnemy(enemy: IEnemy, req: DamageRequest): DamageResult | null;
  /** 敌人 → 玩家的伤害（计入减伤与 incoming 修饰器），返回实际扣除量 */
  damagePlayer(amount: number, element: Element, source: IEnemy | null, from?: THREE.Vector3 | null): number;
  /** 范围伤害（玩家方）；返回命中敌人数量 */
  explode(center: THREE.Vector3, radius: number, req: DamageRequest, opts?: ExplosionOptions): number;
  /** 直接施加状态。burn/shock/corrode 会先判定元素反应；不会同步造成伤害，可在任意事件回调里调用 */
  /** power 为「不含元素/精英/首领 Pct」的强度（每一跳结算时再乘），会钳制到最大生命 × 0.5 */
  applyStatus(enemy: IEnemy, id: StatusId, power: number, duration?: number, opts?: StatusApplyOpts): void;
  /** 强制引发一次反应（不需要也不消耗状态）；被预算 / 深度 / 冷却拒绝时返回 false。只入队，不同步造成伤害 */
  triggerReaction(enemy: IEnemy, id: ReactionId, power: number, opts?: TriggerReactionOpts): boolean;
  /** 引爆敌人身上已有的元素状态。只入队，不同步造成伤害 */
  detonate(enemy: IEnemy, opts: DetonateOpts): DetonateOutcome | null;
  /** 修饰器在 clear()（换关）后依然保留，只能由返回的移除函数移除 */
  addOutgoingModifier(fn: OutgoingDamageModifier): () => void;
  addIncomingModifier(fn: IncomingDamageModifier): () => void;
  /** 仅计算玩家对该敌人的预期倍率（UI/调试） */
  previewMultiplier?(enemy: IEnemy, req: DamageRequest): number;
}

/** 'blade' = 魔刀千刃的旋转飞刃（细拖尾） */
export type ProjectileVisual = 'orb' | 'bolt' | 'rocket' | 'arrow' | 'grenade' | 'shard' | 'flame' | 'blade';

export interface ProjectileSpec {
  owner: 'player' | 'enemy';
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** 重力加速度（m/s²，正值向下），缺省 0 */
  gravity?: number;
  radius: number;
  /** 存活秒数 */
  lifetime: number;
  /** 玩家投射物：命中敌人的伤害请求（point/direction 由系统填写） */
  damage?: DamageRequest;
  /** 敌人投射物：对玩家的伤害 */
  enemyDamage?: number;
  element?: Element;
  /** >0 时命中/到期爆炸 */
  explosionRadius?: number;
  /** 爆炸对玩家伤害（敌方爆炸弹使用 enemyDamage，本字段用于玩家自伤，缺省 0） */
  selfDamage?: number;
  /** 可穿透敌人数 */
  pierce?: number;
  /** 撞墙反弹次数 */
  bounces?: number;
  /** 追踪转向速率（弧度/秒） */
  homing?: number;
  color: number;
  visual?: ProjectileVisual;
  /** 视觉缩放，缺省 1 */
  scale?: number;
  /** 到期时是否爆炸（缺省：有 explosionRadius 则爆炸） */
  explodeOnExpire?: boolean;
  /** 发射者（敌方投射物不会打到自己） */
  sourceEnemy?: IEnemy | null;
  /** 命中回调（命中敌人、玩家或墙体时），hitEnemy 为 null 表示打中墙或玩家 */
  /** 命中敌人、玩家或墙体时回调；没有伤害与爆炸的载体投射物（手雷、信标）到期时也会在原地回调一次 (point, null) */
  onImpact?: (point: THREE.Vector3, hitEnemy: IEnemy | null) => void;
}

export interface IProjectileSystem extends System {
  spawn(spec: ProjectileSpec): void;
  readonly count: number;
}

// ───────────────────────────── 关卡世界 ─────────────────────────────

export interface ThemeDef {
  id: ThemeId;
  name: string;         // 例如「荒漠遗迹」
  fogColor: number;
  skyTop: number;
  skyBottom: number;
  ambient: number;
  sun: number;
  floor: number;
  wall: number;
  accent: number;
}

export interface ArenaInfo {
  minX: number; minZ: number; maxX: number; maxZ: number;
  floorY: number;
  playerSpawn: THREE.Vector3;
  playerYaw: number;
  /** 敌人刷新点（地面） */
  spawnPoints: THREE.Vector3[];
  /** 清关奖励宝箱位置 */
  rewardPoint: THREE.Vector3;
  /** 出口传送门位置（最多 3 个） */
  portalPoints: THREE.Vector3[];
  /** 商店摊位中心（shop 关） */
  shopPoint: THREE.Vector3;
  /** 竞技场中心 */
  center: THREE.Vector3;
  theme: ThemeDef;
}

export interface INavGrid {
  /** 基于 ctx.world 的当前静态几何体构建导航网格 */
  build(arena: ArenaInfo, cellSize?: number): void;
  /**
   * 寻路，out 被清空后填入路径点（不含起点）。地面路点 y 为地面高度，高台/台阶上的路点 y 为其顶面高度
   * （EnemyBase 只使用 x/z）。目标不可达时路径终点为最近可达格。失败返回 false。
   */
  findPath(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3[]): boolean;
  isWalkable(x: number, z: number): boolean;
  nearestWalkable(p: THREE.Vector3, out: THREE.Vector3): boolean;
  randomWalkable(center: THREE.Vector3, minR: number, maxR: number, out: THREE.Vector3): boolean;
}

export interface IStageDirector extends System {
  readonly stage: StageNode | null;
  readonly arena: ArenaInfo | null;
  readonly cleared: boolean;
  /** 0-based，当前进行到第几波 */
  readonly waveIndex: number;
  /** 波次总数；只有 Boss 一波的关卡为 0（HUD 不显示波次） */
  readonly waveCount: number;
  /** 生成并搭建关卡（几何、碰撞、导航、灯光、传送门、商店/宝箱、刷怪计划），并把玩家放到出生点 */
  load(stage: StageNode): void;
  /** 移除关卡几何 */
  unload(): void;
}

// ───────────────────────────── 成长 / 掉落 / 交互 ─────────────────────────────

export interface ScrollDef {
  id: string;
  name: string;
  /** 描述文本。可以使用 {n} 占位，UI 会传入层数 */
  description: string;
  rarity: Rarity;
  maxStacks: number;
  tags?: string[];
  /** 只在特定英雄出现 */
  heroOnly?: string;
  /**
   * 安装效果（stacks 为当前层数）。返回卸载函数。
   * 层数变化时系统会先调用旧的卸载函数再用新层数重新 apply。
   * 属性修饰请用 source = `scroll:${id}`。
   */
  apply(ctx: GameContext, stacks: number): () => void;
}

export interface IScrollSystem extends System {
  readonly all: readonly ScrollDef[];
  owned(): { def: ScrollDef; stacks: number }[];
  stacks(id: string): number;
  get(id: string): ScrollDef | undefined;
  add(id: string): void;
  /** 随机抽取（不含已满层），luck 影响稀有度 */
  roll(count: number, opts?: { minRarity?: Rarity; exclude?: string[] }): ScrollDef[];
  resetForRun(): void;
}

export interface Interactable {
  position: THREE.Vector3;
  /** 可交互半径 */
  radius: number;
  enabled: boolean;
  /** 交互提示；每帧拉取，可动态变化 */
  prompt(): InteractPrompt;
  onInteract(): void;
}

export interface InteractPrompt {
  title: string;
  subtitle?: string;
  lines?: string[];
  /** CSS 颜色 */
  color?: string;
  /** 按键提示，缺省 'F' */
  key?: string;
  /** 价格（显示金币图标），不足时 UI 标红 */
  cost?: number;
}

export interface IInteraction extends System {
  readonly current: Interactable | null;
  add(item: Interactable): () => void;
}

export interface ILoot extends System {
  dropCoins(pos: THREE.Vector3, amount: number): void;
  dropAmmo(pos: THREE.Vector3, fraction?: number): void;
  dropHealth(pos: THREE.Vector3, amount?: number): void;
  dropWeapon(pos: THREE.Vector3, inst: WeaponInstance): void;
  /** 清关奖励宝箱 */
  spawnChest(pos: THREE.Vector3, reward: RewardType): void;
  /** 商店（多个摊位 + 强化台） */
  /** facingYaw 为模型朝向约定（商店正面朝 (sin, cos)，即 atan2(dx, dz)）；缺省朝向玩家出生点 */
  spawnShop(center: THREE.Vector3, facingYaw?: number): void;
  /** 立即发放奖励（可能打开秘卷选择界面） */
  grant(reward: RewardType, pos: THREE.Vector3): void;
  /** 打开「三选一」秘卷界面 */
  offerScrolls(count?: number, minRarity?: Rarity): void;
}

export interface TalentDef {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  stat: StatKey;
  perLevel: number;
  cost(level: number): number;
}

export interface MetaSave {
  version: 1;
  essence: number;
  talents: Record<string, number>;
  unlockedHeroes: string[];
  /** bestChapter 从 1 起计（0 = 从未出征）；bestStages 为单局最多清关数 */
  stats: { runs: number; wins: number; bestChapter: number; bestStages: number; totalKills: number };
}

export interface IMeta extends System {
  readonly save: MetaSave;
  readonly talents: readonly TalentDef[];
  talentLevel(id: string): number;
  buyTalent(id: string): boolean;
  isHeroUnlocked(id: string): boolean;
  unlockHero(id: string, cost: number): boolean;
  addEssence(n: number): void;
  /** 把天赋加成写入属性（source = 'talent'） */
  applyTalents(stats: Stats): void;
  recordRun(summary: RunSummary): void;
  persist(): void;
}

export interface IRunPlan {
  createRun(heroId: string, seed: number): RunState;
  firstStage(run: RunState): StageNode;
  /** 当前关卡清关后可选的出口（1~3 个）；本局已通关返回 [] */
  nextOptions(run: RunState): StageNode[];
  isFinalStage(node: StageNode): boolean;
  difficultyFor(node: StageNode): number;
  themeFor(chapter: number): ThemeId;
  stageLabel(node: StageNode): string;
  rewardLabel(reward: RewardType): string;
}

// ───────────────────────────── 表现层 ─────────────────────────────

export interface DamageNumberOpts {
  crit?: boolean;
  element?: Element;
  kind?: DamageLayer | 'heal' | 'player' | 'immune' | 'reaction';
  /** 持续伤害（DOT）的一跳：显示得更小、更暗、不弹跳 */
  dot?: boolean;
  /** kind = 'reaction' 时显示的文本（如「焚雷」） */
  text?: string;
  /** kind = 'reaction' 时的颜色（hex） */
  color?: number;
  /** kind = 'reaction' 时使用大号字（归墟） */
  big?: boolean;
}

/**
 * 魔刀千刃的专用特效（docs/demon-blade.md 第 8、10 节）。所有方法按值复制传入的向量。
 * 实现位于 fx/BladeFx.ts，由 FxSystem 持有（IFx.blade）、逐帧推进，并在 IFx.clear()（换关 / 开局）时清空。
 */
export interface IBladeFx {
  /**
   * 挥砍弧光：以 origin（通常为 player.eye）为圆心、朝 (yaw, pitch) 的扇形拖尾面片，约 0.12 秒扫过、0.2 秒淡出。
   * segment：0 横斩（右 → 左）/ 1 回斩（左 → 右）/ 2 下劈（上 → 下）；range 为半径（米），halfAngle 为扇形半角（弧度）。
   */
  slashArc(origin: THREE.Vector3, yaw: number, pitch: number, segment: number, range: number, halfAngle: number, color: number): void;
  /** 斩击命中点的刃光与火花；dir 为斩击方向（玩家 → 敌人，单位向量），heavy = 第三段 / 技能斩击 */
  slashHit(point: THREE.Vector3, dir: THREE.Vector3, color: number, heavy: boolean): void;
  /** 刃印：跟随敌人的旋转红色刃环，duration 秒后自动消失（敌人死亡 / 移除时提前消失） */
  mark(enemy: IEnemy, duration: number, color: number): void;
  /**
   * 千刃贯穿：数十柄刃从四面八方射入敌人身体中心（同时移除该敌人的刃印），约 0.1–0.16 秒后到齐爆闪——
   * 调用方应提前约 IMPALE_LEAD 调用，让刃群与伤害同时到达。目标在视野外时刃群从玩家眼前上方掠过再射向它。
   */
  impale(enemy: IEnemy, color: number): void;
  /** 所有仍在显示的刃印淡出（技能被中止、不会贯穿时调用） */
  clearMarks(): void;
  /** 突进残影与风压线：本帧位移 from → to（脚底坐标）；突进期间每帧调用一次 */
  dashTrail(from: THREE.Vector3, to: THREE.Vector3, color: number): void;
  /** 飞刃召回：count 柄刃片从 from 飞向 to（主场景世界坐标；to 通常为 viewmodel 枪口的世界坐标） */
  recall(from: THREE.Vector3, to: THREE.Vector3, count: number, color: number): void;
}

/** 所有方法都会按值复制传入的向量，调用方可以传复用的临时向量。 */
export interface IFx extends System {
  /** 魔刀千刃专用特效 */
  readonly blade: IBladeFx;
  impact(point: THREE.Vector3, normal: THREE.Vector3 | null, color?: number, size?: number): void;
  enemyHit(point: THREE.Vector3, color?: number, crit?: boolean): void;
  tracer(from: THREE.Vector3, to: THREE.Vector3, color?: number, width?: number): void;
  /** 含按与相机距离计算的屏震；调用方只在需要额外强调时再调用 shake */
  explosion(center: THREE.Vector3, radius: number, color?: number): void;
  damageNumber(pos: THREE.Vector3, amount: number, opts?: DamageNumberOpts): void;
  burst(pos: THREE.Vector3, color: number, count?: number, speed?: number, life?: number, size?: number, gravity?: number): void;
  /** 地面扩散冲击波环 */
  /** 纯装饰（缓出曲线），不要用它来同步伤害判定；有伤害的冲击波请自行绘制 */
  ring(center: THREE.Vector3, radius: number, color?: number, duration?: number): void;
  /** 地面预警圈，duration 秒后填满 */
  /** 返回取消函数：攻击被打断（施法者死亡、眩晕）时调用，预警圈在约 0.1 秒内淡出 */
  groundWarning(center: THREE.Vector3, radius: number, duration: number, color?: number): () => void;
  /** 返回取消函数（提前结束光束） */
  beam(from: THREE.Vector3, to: THREE.Vector3, color?: number, width?: number, duration?: number): () => void;
  lightning(from: THREE.Vector3, to: THREE.Vector3, color?: number): void;
  /** 相机震动（会乘以设置里的 screenShake） */
  shake(intensity: number, duration?: number): void;
  spawnEffect(pos: THREE.Vector3, color?: number): void;
  deathEffect(pos: THREE.Vector3, color?: number, size?: number): void;
}

export type SfxId =
  | 'shot_pistol' | 'shot_smg' | 'shot_rifle' | 'shot_shotgun' | 'shot_sniper' | 'shot_launcher' | 'shot_beam' | 'shot_bow' | 'shot_heavy'
  | 'reload_start' | 'reload_end' | 'dry_fire' | 'weapon_switch'
  // 魔刀千刃：挥砍破风 / 斩击命中 / 飞刃投掷 / 召回 / 变形 / 突进 / 千刃贯穿
  | 'blade_swing' | 'blade_hit' | 'blade_throw' | 'blade_recall' | 'blade_morph' | 'blade_dash' | 'blade_impale'
  | 'hit' | 'hit_crit' | 'hit_shield' | 'hit_armor' | 'kill' | 'explosion'
  | 'player_hurt' | 'shield_break' | 'shield_recharge' | 'low_hp'
  | 'jump' | 'land' | 'dash' | 'footstep'
  | 'pickup_coin' | 'pickup_ammo' | 'pickup_health' | 'pickup_weapon'
  | 'chest_open' | 'portal' | 'buy' | 'scroll_get'
  | 'enemy_shot' | 'enemy_melee' | 'enemy_alert' | 'enemy_death' | 'enemy_spawn' | 'enemy_charge'
  | 'boss_roar' | 'boss_slam' | 'telegraph'
  | 'skill_fire' | 'skill_shock' | 'skill_earth' | 'skill_buff' | 'skill_throw'
  | 'burn_tick' | 'shock_zap' | 'corrode_tick'
  | 'ui_click' | 'ui_hover' | 'ui_confirm' | 'ui_deny'
  | 'wave_start' | 'stage_clear' | 'victory' | 'defeat';

export type MusicId = 'none' | 'menu' | 'calm' | 'combat' | 'boss';

export interface IAudio extends System {
  /** 必须在用户手势中调用一次以解锁 AudioContext */
  unlock(): void;
  play(id: SfxId, opts?: { position?: THREE.Vector3; volume?: number; pitch?: number }): void;
  setMusic(id: MusicId): void;
  applyVolumes(master: number, sfx: number, music: number): void;
}

export interface IUI extends System {
  showMainMenu(): void;
  showPause(visible: boolean): void;
  showSummary(summary: RunSummary): void;
  /** 三选一秘卷；UI 在点击处理函数里同步调用 onPick，然后调用 ctx.game.closeModal() */
  showScrollChoice(options: ScrollDef[], onPick: (s: ScrollDef) => void): void;
  showHUD(visible: boolean): void;
  toast(text: string, color?: string): void;
  banner(title: string, subtitle?: string, duration?: number): void;
  setBoss(enemy: IEnemy | null): void;
  setInteractPrompt(p: InteractPrompt | null): void;
  /** 全屏黑幕淡入淡出（0 透明 → 1 全黑） */
  fade(to: number, duration: number): Promise<void>;
}

// ───────────────────────────── 流程控制 ─────────────────────────────

export interface IGame {
  readonly state: GameState;
  readonly debug: boolean;
  /** 最近 0.5 秒的平均帧率 */
  readonly fps: number;
  startRun(heroId: string): void;
  /** 进入下一关（传送门调用），带淡入淡出 */
  advance(next: StageNode): void;
  endRun(victory: boolean): void;
  toMenu(): void;
  pause(): void;
  resume(): void;
  /** 打开游戏内模态框：冻结玩法并释放鼠标 */
  openModal(): void;
  /** 关闭模态框：必须在用户手势（点击）处理函数中同步调用，以便重新锁定鼠标 */
  closeModal(): void;
  applySettings(): void;
  saveSettings(): void;
}

// ───────────────────────────── 上下文 ─────────────────────────────

export interface GameContext {
  readonly scene: THREE.Scene;
  /**
   * 关卡临时物体容器（已加入 scene）。每次换关 / 开新局时 Game 会清空它的全部子节点（只移除，不 dispose）。
   * 技能召唤物、Boss 危险区、临时特效物体等挂这里即可避免泄漏；请使用缓存的几何体。
   */
  readonly stageGroup: THREE.Group;
  readonly camera: THREE.PerspectiveCamera;
  /** 第一人称武器模型专用场景与相机（主场景之后清深度再渲染） */
  readonly viewScene: THREE.Scene;
  readonly viewCamera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly dom: { root: HTMLElement; canvas: HTMLCanvasElement; world: HTMLElement; ui: HTMLElement };
  readonly input: Input;
  readonly events: EventBus;
  readonly world: CollisionWorld;
  /** 本局随机数（开局按种子重置） */
  rng: Rng;
  readonly tasks: TaskRunner;
  readonly time: { now: number; dt: number; timeScale: number; frame: number };
  /** 相机效果：fx.shake 写入，玩家控制器读取 */
  /**
   * 相机效果。shakeIntensity 为 0..1 的相对强度（1 = 很强），shakeTime 为秒；由 fx 写入、玩家控制器读取并衰减。
   * fovKick 为 FOV 偏移（度，负数 = 放大），只由武器系统写入（开镜）。
   */
  readonly cameraFx: { shakeIntensity: number; shakeTime: number; fovKick: number };
  settings: Settings;
  run: RunState;

  readonly game: IGame;
  readonly player: IPlayer;
  readonly weapons: IWeaponSystem;
  readonly enemies: IEnemyManager;
  readonly combat: ICombat;
  readonly projectiles: IProjectileSystem;
  readonly stage: IStageDirector;
  readonly nav: INavGrid;
  readonly loot: ILoot;
  readonly scrolls: IScrollSystem;
  readonly interact: IInteraction;
  readonly meta: IMeta;
  readonly runPlan: IRunPlan;
  readonly heroes: readonly HeroDef[];
  readonly fx: IFx;
  readonly audio: IAudio;
  readonly ui: IUI;
}
