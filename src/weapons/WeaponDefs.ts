/**
 * 18 把武器的静态定义与稀有度常量。
 *
 * 数值基准（DESIGN 第 4、7 节）：普通稀有度、无加成时身体持续 DPS 约 60–90（含换弹；近战允许到约 105）。
 * 原 11 把武器无头实测（120 秒、8 米大木桩、完美压枪、备弹充足；括号内为不含 5% 基础暴击）：
 * 左轮 88（82）、冲锋枪 95（91）、步枪 95（90）、点射 93（86）、霰弹 95（90，含边装边打）、弩 88（82）、
 * 光束 77（74，单跳伤害 7→8 后；旁边有第二名敌人吃电弧时约 105）、机炮 94（90）、蜂群 89（82）、榴弹 111（火焰对生命 ×1.25，另有灼烧 DOT）；
 * 狙击 120（107），作为必须开镜、射速最慢的精准武器有意略高。
 * 所有角度为弧度「半角」；射速为「每秒发数」（burst 为每秒轮数，beam 为每秒跳数，charge 为松手后冷却 1 / fireRate）。
 * 双形态武器（魔刀千刃）：根字段描述远程形态「千刃」，近战形态「斩」的参数在 melee，武器技能在 skill。
 */
import type { Element, ProjectileVisual, SfxId, WeaponForm } from '../core/types';

/**
 * 'melee' 只作为双形态武器近战形态的「有效模式」（由 formMode() 返回）：
 * 双形态武器的 WeaponDef.mode 本身描述远程形态，近战形态的参数在 WeaponDef.melee。
 */
export type FireMode = 'semi' | 'auto' | 'burst' | 'beam' | 'spinup' | 'charge' | 'melee';
export type WeaponKind = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'launcher' | 'crossbow' | 'beam' | 'heavy' | 'blade';
/** 第一人称换弹动画风格（'recall' = 魔刀千刃召回飞刃：刃片从世界中飞回重组） */
export type ReloadStyle = 'mag' | 'cylinder' | 'shell' | 'tube' | 'cell' | 'box' | 'recall';

export interface ProjectileParams {
  speed: number;
  /** m/s²，正值向下 */
  gravity: number;
  radius: number;
  /** 0 = 不爆炸 */
  explosionRadius: number;
  lifetime: number;
  visual: ProjectileVisual;
  scale: number;
  /** 追踪转向速率（弧度/秒） */
  homing: number;
  /** 每次扣扳机发射的弹体数（蜂群 5） */
  count: number;
  /** 多发弹体的发射间隔（秒） */
  stagger: number;
  /** 多发弹体的扇形散开半角 */
  fan: number;
  /**
   * 固定扇形（魔刀千刃）：true 时一轮 count 发弹体按水平偏航角均匀分布在 [−fan, +fan]（3 发 = −fan / 0 / +fan），
   * 不做随机锥形与上抬；false（缺省）为蜂群式随机散开
   */
  fanFixed: boolean;
  explodeOnExpire: boolean;
  /** 无元素时弹体颜色 */
  color: number;
  /** 撞墙反弹次数 */
  bounces: number;
}

export interface RecoilParams {
  /** 每发上跳（弧度） */
  pitch: number;
  /** 每发水平随机抖动（弧度） */
  yaw: number;
  /** 水平固定偏移（弧度，连射时形成拖拽） */
  bias: number;
  /** 连射时每发后坐增量系数（最多累计 12 发） */
  climb: number;
}

/**
 * 近战连段的一段（docs/demon-blade.md 第 3 节）。时间均为未计攻速的秒数，WeaponSystem 按「射速」倍率缩短。
 * 判定只在判定帧（开始挥砍后 windup 秒）结算一次：扇形 + 高度 + 视线，范围内所有敌人各命中一次。
 */
export interface MeleeSegment {
  /** 基础伤害（× 本武器伤害倍率 ResolvedWeapon.damageMult；不含玩家 damagePct，Combat 会乘） */
  damage: number;
  /** 前摇：开始挥砍 → 判定帧 */
  windup: number;
  /** 整段时长（含前摇）；结束后才能接下一段 */
  duration: number;
  /** 判定扇形：水平距离（米，按敌人胶囊表面计）与水平半角（弧度） */
  range: number;
  halfAngle: number;
  /** 击退（米/秒，沿玩家 → 敌人的水平方向略上抬） */
  knockback: number;
  /** 本段玩家前冲距离（米，0 = 不前冲，但连段中可能触发追击；在前摇内经 IPlayer.lunge 软突进完成） */
  lunge: number;
  /** 对眩晕中（stunTime > 0）的敌人必定暴击 */
  stunCrit: boolean;
  /** 命中时屏震强度（ctx.fx.shake 的 intensity；狙击枪每发约 0.22） */
  shake: number;
}

/**
 * 双形态武器的近战形态参数。WeaponDef.melee 非 null 即为双形态武器：
 * 近战形态 = 本结构，远程形态 = WeaponDef 根字段（mode / damage / projectile / mag / reload …）。
 */
export interface MeleeParams {
  /** 连段，按顺序循环（魔刀千刃：横斩 → 回斩 → 下劈） */
  combo: MeleeSegment[];
  /** 一段结束后空闲超过此秒数，连段重置到第一段 */
  comboReset: number;
  /** 判定高度：玩家脚底以下 / 头顶（position.y + height）以上的延伸（米） */
  reachBelow: number;
  reachAbove: number;
  /** 斩击的元素附着基础概率（代替 WeaponDef.elementChance；词条「元素触发率」照常叠加） */
  elementChance: number;
  /** 斩击回刃：每段每命中 1 名敌人召回的飞刃数，与每段召回上限 */
  recallPerHit: number;
  recallMaxPerSwing: number;
  /** 持近战形态时的额外移速（与「轻盈」一样只在持握时生效） */
  moveBonus: number;
  /** 形态显示名 [近战, 远程] */
  formNames: [string, string];
  /** 形态切换（变形）时长，期间不能攻击 */
  morphTime: number;
  /** 「换形一击」：变形完成后 window 秒内的第一次攻击伤害 × mult */
  formStrikeWindow: number;
  formStrikeMult: number;
}

/**
 * 武器技能（V / 鼠标中键）。目前只有一种：kind 'dashSlash' = 魔刀千刃「千刃·无间」（突进连斩 + 刃印 + 延迟贯穿引爆）。
 * 伤害均为基础值，× 本武器伤害倍率（ResolvedWeapon.damageMult）。
 */
export interface WeaponSkillParams {
  kind: 'dashSlash';
  id: string;
  name: string;
  /** HUD 图标单字 */
  glyph: string;
  description: string;
  /** 基础冷却（秒），实际 = cooldown / (1 + skillHaste)，与英雄技能同一公式 */
  cooldown: number;
  /** 突进：水平距离、时长、无敌时长、结束后保留的速度（米/秒） */
  dashDist: number;
  dashTime: number;
  iframes: number;
  exitSpeed: number;
  /** 突进路径两侧的斩击半径（米，按敌人胶囊表面计）与伤害 */
  pathRadius: number;
  slashDamage: number;
  /** 突进结束后多久贯穿所有带刃印的敌人，与贯穿伤害 */
  impaleDelay: number;
  impaleDamage: number;
  /** 每命中 1 名敌人召回的飞刃数（最多补满弹匣） */
  recallPerHit: number;
  /** 一次释放最多打上刃印的敌人数 */
  maxMarks: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  /** 类别中文名 */
  category: string;
  kind: WeaponKind;
  mode: FireMode;
  /** 单发 / 单弹丸 / 单跳基础伤害 */
  damage: number;
  pellets: number;
  fireRate: number;
  burstCount: number;
  /** 点射内部间隔（秒） */
  burstInterval: number;
  mag: number;
  reserve: number;
  /** 整匣换弹时间；逐发装填武器为估算的满匣时间（仅显示） */
  reloadTime: number;
  /** 逐发装填：每发耗时（0 = 整匣换弹） */
  shellTime: number;
  /** 逐发装填：开始前的准备时间 */
  reloadStart: number;
  reloadStyle: ReloadStyle;
  spreadHip: number;
  spreadAim: number;
  spreadPerShot: number;
  spreadMax: number;
  /** 停火后散布恢复速度（弧度/秒） */
  spreadRecovery: number;
  /** 霰弹弹丸锥角（半角） */
  pelletCone: number;
  recoil: RecoilParams;
  critMult: number;
  range: number;
  /** 距离衰减：[开始, 结束, 最低倍率]；null = 无衰减 */
  falloff: [number, number, number] | null;
  projectile: ProjectileParams | null;
  /** 默认元素 */
  element: Element;
  /** 带元素时的单次命中附着概率 */
  elementChance: number;
  pierce: number;
  /** 开镜 fovKick（负数 = 放大） */
  aimFov: number;
  /** 开镜过渡速度（damp lambda） */
  aimSpeed: number;
  sfx: SfxId;
  sfxVolume: number;
  /** 击退冲量（米/秒，每弹丸） */
  knockback: number;
  /** 机炮预热秒数 */
  spinup: number;
  /** 开火时移速惩罚 */
  moveSlow: number;
  /** 光束：电弧弹射伤害比例与距离 */
  chainFraction: number;
  chainRange: number;
  tracerWidth: number;
  impactSize: number;
  /** 第一人称后坐：后移距离、上抬角度 */
  kick: { back: number; rot: number };
  /** 每发屏震强度 */
  shake: number;
  /** 枪口火焰尺寸 */
  flash: number;
  /**
   * 第一人称腰射 / 开镜位置（相机空间，按建模尺寸给出）。
   * Viewmodel 会把枪模整体缩放 VM_SCALE、开镜位置同乘该系数（画面不变），腰射位置再整体右下偏移。
   */
  viewOffset: [number, number, number];
  aimOffset: [number, number, number];
  /** 掉落模型缩放 */
  worldScale: number;
  description: string;
  /** 固有特性（显示在描述里） */
  notes: string[];
  /** 固有词条：rollAffixes 生成实例时原样放到 affixes 最前面，不占词条名额、不随稀有度放大、同 id 不会再被抽到 */
  innate: { id: string; value: number }[];
  /** 元素轮转（新机制 A）；null = 不轮转 */
  cycle: Element[] | null;
  /** 蓄力（新机制 B）：满蓄所需秒数（0 = 非蓄力武器） */
  chargeTime: number;
  /** 蓄力：未蓄满时的最低伤害倍率 */
  chargeMinMult: number;
  /** 蓄力：满蓄额外穿透数 */
  chargeFullPierce: number;
  /** 蓄力：满蓄命中是否引爆敌人身上的元素状态 */
  chargeDetonate: boolean;
  /** roll() 不指定 defId 时的抽取权重 */
  dropWeight: number;
  /** 双形态武器的近战形态（docs/demon-blade.md）；null = 普通武器 */
  melee: MeleeParams | null;
  /** 武器技能（V / 鼠标中键）；null = 没有武器技能 */
  skill: WeaponSkillParams | null;
  /** 召回式换弹（魔刀千刃）：换弹不需要也不消耗备弹（reserve 恒为 0，HUD 显示 ∞），不参与弹药补给 / 防卡关判定 */
  recall: boolean;
  /**
   * 按弹体计弹药（魔刀千刃）：一轮齐射的每枚弹体各消耗 1 发弹匣，一轮实际发射 min(projectile.count, 弹匣余量) 枚；
   * false（缺省）= 每次扣扳机消耗 1 发（蜂群一轮 5 枚只耗 1 发）
   */
  perProjectileAmmo: boolean;
}

/** 稀有度伤害倍率 */
export const RARITY_DAMAGE: readonly number[] = [1, 1.15, 1.35, 1.6, 1.9];
/** 强化上限与每级伤害加成 */
export const MAX_LEVEL = 5;
export const LEVEL_DAMAGE = 0.12;

type DefInput = Omit<WeaponDef, 'burstCount' | 'burstInterval' | 'shellTime' | 'reloadStart' | 'pelletCone' | 'falloff' | 'projectile' | 'pierce' | 'spinup' | 'moveSlow' | 'chainFraction' | 'chainRange' | 'sfxVolume' | 'aimSpeed' | 'pellets' | 'element' | 'worldScale'
    | 'innate' | 'cycle' | 'chargeTime' | 'chargeMinMult' | 'chargeFullPierce' | 'chargeDetonate' | 'dropWeight' | 'melee' | 'skill' | 'recall' | 'perProjectileAmmo'>
  & Partial<Pick<WeaponDef, 'burstCount' | 'burstInterval' | 'shellTime' | 'reloadStart' | 'pelletCone' | 'falloff' | 'pierce' | 'spinup' | 'moveSlow' | 'chainFraction' | 'chainRange' | 'sfxVolume' | 'aimSpeed' | 'pellets' | 'element' | 'worldScale'
    | 'innate' | 'cycle' | 'chargeTime' | 'chargeMinMult' | 'chargeFullPierce' | 'chargeDetonate' | 'dropWeight' | 'melee' | 'skill' | 'recall' | 'perProjectileAmmo'>>
  & { projectile?: Partial<ProjectileParams> & Pick<ProjectileParams, 'speed' | 'visual'> };

function def(d: DefInput): WeaponDef {
  const p = d.projectile;
  return {
    burstCount: 1,
    burstInterval: 0,
    shellTime: 0,
    reloadStart: 0,
    pelletCone: 0,
    falloff: null,
    pierce: 0,
    spinup: 0,
    moveSlow: 0,
    chainFraction: 0,
    chainRange: 0,
    sfxVolume: 0.8,
    aimSpeed: 16,
    pellets: 1,
    element: 'none',
    worldScale: 1.25,
    innate: [],
    cycle: null,
    chargeTime: 0,
    chargeMinMult: 0.2,
    chargeFullPierce: 0,
    chargeDetonate: false,
    dropWeight: 1,
    melee: null,
    skill: null,
    recall: false,
    perProjectileAmmo: false,
    ...d,
    projectile: p
      ? {
          gravity: 0,
          radius: 0.1,
          explosionRadius: 0,
          lifetime: 3,
          scale: 1,
          homing: 0,
          count: 1,
          stagger: 0,
          fan: 0,
          fanFixed: false,
          explodeOnExpire: false,
          color: 0xffd9a0,
          bounces: 0,
          ...p,
        }
      : null,
  };
}

export const WEAPON_DEFS: readonly WeaponDef[] = [
  def({
    id: 'revolver', name: '赤铜左轮', category: '手枪', kind: 'pistol', mode: 'semi',
    damage: 38, fireRate: 3.5, mag: 8, reserve: 64, reloadTime: 1.6, reloadStyle: 'cylinder',
    spreadHip: 0.004, spreadAim: 0.0012, spreadPerShot: 0.014, spreadMax: 0.04, spreadRecovery: 0.16,
    recoil: { pitch: 0.022, yaw: 0.004, bias: 0, climb: 0 },
    critMult: 2.5, range: 80, falloff: [35, 80, 0.7],
    elementChance: 0.3, aimFov: -12, sfx: 'shot_pistol', knockback: 1.5,
    tracerWidth: 0.03, impactSize: 0.9, kick: { back: 0.06, rot: 0.22 }, shake: 0.09, flash: 0.12,
    viewOffset: [0.2, -0.17, -0.42], aimOffset: [0, -0.089, -0.34], worldScale: 1.9,
    description: '赤铜铸就的八膛转轮手枪，弹道笔直，爆头倍率极高。',
    notes: ['弹道极准，适合点射爆头'],
  }),
  def({
    id: 'smg', name: '蜂鸣冲锋枪', category: '冲锋枪', kind: 'smg', mode: 'auto',
    damage: 11, fireRate: 13, mag: 36, reserve: 252, reloadTime: 1.7, reloadStyle: 'mag',
    spreadHip: 0.03, spreadAim: 0.016, spreadPerShot: 0.0035, spreadMax: 0.07, spreadRecovery: 0.2,
    recoil: { pitch: 0.0045, yaw: 0.0026, bias: 0.0002, climb: 0.015 },
    critMult: 2, range: 45, falloff: [16, 40, 0.55],
    elementChance: 0.08, aimFov: -10, sfx: 'shot_smg', sfxVolume: 0.6, knockback: 0.25,
    tracerWidth: 0.02, impactSize: 0.6, kick: { back: 0.012, rot: 0.03 }, shake: 0.035, flash: 0.12,
    viewOffset: [0.21, -0.2, -0.46], aimOffset: [0, -0.1, -0.36], worldScale: 1.45,
    description: '嗡鸣不止的轻型冲锋枪，近距离弹幕压制。',
    notes: ['高射速，远距离伤害衰减明显'],
  }),
  def({
    id: 'rifle', name: '裂风步枪', category: '步枪', kind: 'rifle', mode: 'auto',
    damage: 18, fireRate: 8, mag: 30, reserve: 210, reloadTime: 2.4, reloadStyle: 'mag',
    spreadHip: 0.016, spreadAim: 0.004, spreadPerShot: 0.003, spreadMax: 0.045, spreadRecovery: 0.14,
    recoil: { pitch: 0.0062, yaw: 0.0018, bias: 0.0003, climb: 0.02 },
    critMult: 2, range: 90, falloff: [40, 90, 0.75],
    elementChance: 0.12, aimFov: -16, sfx: 'shot_rifle', sfxVolume: 0.7, knockback: 0.4,
    tracerWidth: 0.024, impactSize: 0.75, kick: { back: 0.018, rot: 0.045 }, shake: 0.05, flash: 0.14,
    viewOffset: [0.22, -0.21, -0.5], aimOffset: [0, -0.1, -0.38],
    description: '可靠的制式突击步枪，中远距离表现均衡。',
    notes: ['全距离表现均衡'],
  }),
  def({
    id: 'burst', name: '三叠点射枪', category: '步枪', kind: 'rifle', mode: 'burst',
    damage: 24, fireRate: 1.6, burstCount: 3, burstInterval: 0.065, mag: 24, reserve: 168, reloadTime: 2.1, reloadStyle: 'mag',
    spreadHip: 0.012, spreadAim: 0.003, spreadPerShot: 0.004, spreadMax: 0.035, spreadRecovery: 0.14,
    recoil: { pitch: 0.007, yaw: 0.0014, bias: 0.0002, climb: 0.01 },
    critMult: 2.2, range: 90, falloff: [45, 90, 0.75],
    elementChance: 0.14, aimFov: -16, sfx: 'shot_rifle', sfxVolume: 0.7, knockback: 0.5,
    tracerWidth: 0.026, impactSize: 0.8, kick: { back: 0.02, rot: 0.05 }, shake: 0.06, flash: 0.14,
    viewOffset: [0.22, -0.21, -0.5], aimOffset: [0, -0.132, -0.38],
    description: '三管叠列的点射步枪，一次扣动打出三发精准弹丸。',
    notes: ['每次扣动扳机打出三连发'],
  }),
  def({
    id: 'shotgun', name: '碎岩霰弹', category: '霰弹枪', kind: 'shotgun', mode: 'semi',
    damage: 12, pellets: 9, fireRate: 1.4, mag: 6, reserve: 42, reloadTime: 3.6, shellTime: 0.48, reloadStart: 0.4, reloadStyle: 'shell',
    spreadHip: 0.008, spreadAim: 0.004, spreadPerShot: 0.012, spreadMax: 0.03, spreadRecovery: 0.1, pelletCone: 0.075,
    recoil: { pitch: 0.035, yaw: 0.006, bias: 0, climb: 0 },
    critMult: 2, range: 32, falloff: [9, 30, 0.35],
    elementChance: 0.06, aimFov: -10, sfx: 'shot_shotgun', sfxVolume: 0.9, knockback: 0.9,
    tracerWidth: 0.014, impactSize: 0.5, kick: { back: 0.085, rot: 0.22 }, shake: 0.22, flash: 0.24,
    viewOffset: [0.22, -0.22, -0.5], aimOffset: [0, -0.096, -0.4],
    description: '以碎岩为铳管衬里的泵动霰弹枪，贴脸一击足以撼山。',
    notes: ['一次射出 9 枚弹丸，近距离威力巨大', '逐发装填，装填中开火可打断'],
  }),
  def({
    id: 'sniper', name: '鹰隼狙击', category: '狙击枪', kind: 'sniper', mode: 'semi',
    damage: 160, fireRate: 0.9, mag: 5, reserve: 30, reloadTime: 3.2, reloadStyle: 'mag',
    spreadHip: 0.028, spreadAim: 0, spreadPerShot: 0.03, spreadMax: 0.07, spreadRecovery: 0.12,
    recoil: { pitch: 0.042, yaw: 0.005, bias: 0, climb: 0 },
    critMult: 3, range: 220, pierce: 2,
    elementChance: 0.7, aimFov: -45, aimSpeed: 11, sfx: 'shot_sniper', sfxVolume: 1, knockback: 5,
    tracerWidth: 0.06, impactSize: 1.4, kick: { back: 0.09, rot: 0.2 }, shake: 0.2, flash: 0.26,
    viewOffset: [0.22, -0.22, -0.52], aimOffset: [0, -0.12, -0.3], worldScale: 1.05,
    description: '鹰眼般的栓动狙击枪，开镜后弹无虚发。',
    notes: ['开镜后零散布', '子弹可贯穿多名敌人'],
  }),
  def({
    id: 'launcher', name: '焚城榴弹', category: '发射器', kind: 'launcher', mode: 'semi',
    damage: 110, fireRate: 1.1, mag: 4, reserve: 20, reloadTime: 2.4, reloadStyle: 'tube',
    spreadHip: 0.012, spreadAim: 0.005, spreadPerShot: 0.012, spreadMax: 0.03, spreadRecovery: 0.1,
    recoil: { pitch: 0.03, yaw: 0.004, bias: 0, climb: 0 },
    critMult: 1.8, range: 120, element: 'fire',
    projectile: { speed: 34, gravity: 9, radius: 0.14, explosionRadius: 4, lifetime: 3.2, visual: 'grenade', scale: 1.1, explodeOnExpire: true, color: 0xff8a3a },
    elementChance: 0.6, aimFov: -10, sfx: 'shot_launcher', sfxVolume: 0.9, knockback: 7,
    tracerWidth: 0, impactSize: 1, kick: { back: 0.07, rot: 0.14 }, shake: 0.16, flash: 0.26,
    viewOffset: [0.23, -0.24, -0.52], aimOffset: [0.1, -0.18, -0.44], worldScale: 1.35,
    description: '发射燃烧榴弹的转轮发射器，所过之处尽成火海。',
    notes: ['榴弹沿抛物线飞行，命中或落地后爆炸'],
  }),
  def({
    id: 'crossbow', name: '追魂连弩', category: '弩', kind: 'crossbow', mode: 'semi',
    damage: 55, fireRate: 2, mag: 10, reserve: 60, reloadTime: 2.1, reloadStyle: 'mag',
    spreadHip: 0.008, spreadAim: 0.0015, spreadPerShot: 0.008, spreadMax: 0.03, spreadRecovery: 0.12,
    recoil: { pitch: 0.012, yaw: 0.002, bias: 0, climb: 0 },
    critMult: 2.2, range: 150, pierce: 3,
    projectile: { speed: 95, gravity: 3, radius: 0.09, lifetime: 1.6, visual: 'arrow', color: 0xd8e6ff },
    elementChance: 0.3, aimFov: -18, sfx: 'shot_bow', sfxVolume: 0.8, knockback: 2,
    tracerWidth: 0, impactSize: 0.7, kick: { back: 0.03, rot: 0.06 }, shake: 0.05, flash: 0,
    viewOffset: [0.22, -0.21, -0.5], aimOffset: [0, -0.16, -0.36],
    description: '机括连发的重弩，弩箭破风而出，连穿数敌。',
    notes: ['弩箭高速飞行，可贯穿多名敌人'],
  }),
  def({
    id: 'beam', name: '雷弧发射器', category: '光束', kind: 'beam', mode: 'beam',
    damage: 8, fireRate: 10, mag: 100, reserve: 400, reloadTime: 2.2, reloadStyle: 'cell',
    spreadHip: 0.012, spreadAim: 0.006, spreadPerShot: 0, spreadMax: 0, spreadRecovery: 1,
    recoil: { pitch: 0.0004, yaw: 0.0006, bias: 0, climb: 0 },
    critMult: 1.8, range: 25, element: 'shock', chainFraction: 0.4, chainRange: 7,
    elementChance: 0.1, aimFov: -10, sfx: 'shot_beam', sfxVolume: 0.35, knockback: 0,
    tracerWidth: 0.07, impactSize: 0.45, kick: { back: 0.003, rot: 0.004 }, shake: 0.012, flash: 0.14,
    viewOffset: [0.22, -0.22, -0.48], aimOffset: [0.05, -0.14, -0.4],
    description: '释放持续雷弧的能量武器，电流会在敌群间跳跃。',
    notes: ['按住持续放电，射程 25 米', '命中时电弧弹射至附近 1 名敌人（40% 伤害）'],
  }),
  def({
    id: 'minigun', name: '旋风机炮', category: '重武器', kind: 'heavy', mode: 'spinup',
    damage: 7.5, fireRate: 20, mag: 120, reserve: 480, reloadTime: 3.4, reloadStyle: 'box', spinup: 0.6, moveSlow: 2,
    spreadHip: 0.04, spreadAim: 0.028, spreadPerShot: 0.0012, spreadMax: 0.065, spreadRecovery: 0.2,
    recoil: { pitch: 0.003, yaw: 0.0022, bias: 0, climb: 0.005 },
    critMult: 1.8, range: 60, falloff: [25, 60, 0.6],
    elementChance: 0.06, aimFov: -10, sfx: 'shot_heavy', sfxVolume: 0.55, knockback: 0.3,
    tracerWidth: 0.022, impactSize: 0.6, kick: { back: 0.01, rot: 0.012 }, shake: 0.05, flash: 0.16,
    viewOffset: [0.24, -0.26, -0.56], aimOffset: [0.14, -0.22, -0.5], worldScale: 1.25,
    description: '六管旋转机炮，转起来便是一场钢铁风暴。',
    notes: ['按住预热 0.6 秒后开火', '开火时移动速度降低'],
  }),
  def({
    id: 'swarm', name: '蜂群飞弹', category: '发射器', kind: 'launcher', mode: 'semi',
    damage: 30, fireRate: 0.75, mag: 4, reserve: 20, reloadTime: 2.8, reloadStyle: 'tube',
    spreadHip: 0.02, spreadAim: 0.01, spreadPerShot: 0.01, spreadMax: 0.03, spreadRecovery: 0.1,
    recoil: { pitch: 0.009, yaw: 0.003, bias: 0, climb: 0 },
    critMult: 1.8, range: 150,
    projectile: { speed: 24, radius: 0.12, explosionRadius: 1.8, lifetime: 3.5, visual: 'rocket', scale: 0.6, homing: 4.5, count: 5, stagger: 0.06, fan: 0.16, explodeOnExpire: true, color: 0xffc860 },
    elementChance: 0.25, aimFov: -12, sfx: 'shot_launcher', sfxVolume: 0.5, knockback: 3,
    tracerWidth: 0, impactSize: 0.8, kick: { back: 0.035, rot: 0.06 }, shake: 0.06, flash: 0.14,
    viewOffset: [0.23, -0.24, -0.52], aimOffset: [0.1, -0.2, -0.44], worldScale: 1.5,
    description: '蜂巢式火箭匣，一次齐射五枚会自行寻敌的小型飞弹。',
    notes: ['一次齐射 5 枚追踪火箭'],
  }),

  // ───── 武器库扩充（docs/arsenal-expansion.md 第 3 节） ─────

  def({
    id: 'flamer', name: '朱雀吐息', category: '喷火器', kind: 'heavy', mode: 'auto',
    damage: 7.5, fireRate: 14, mag: 70, reserve: 280, reloadTime: 2.6, reloadStyle: 'cell',
    spreadHip: 0.05, spreadAim: 0.035, spreadPerShot: 0, spreadMax: 0.05, spreadRecovery: 0.3,
    recoil: { pitch: 0.0012, yaw: 0.0015, bias: 0, climb: 0 },
    critMult: 1.5, range: 11, pierce: 3,
    projectile: { speed: 24, gravity: -3, radius: 0.32, lifetime: 0.42, visual: 'flame', scale: 1.1, color: 0xff7a2a },
    element: 'fire', elementChance: 0.08, aimFov: -6, sfx: 'shot_beam', sfxVolume: 0.3, knockback: 0,
    tracerWidth: 0, impactSize: 0.4, kick: { back: 0.004, rot: 0.006 }, shake: 0.012, flash: 0.09,
    viewOffset: [0.24, -0.25, -0.54], aimOffset: [0.12, -0.2, -0.48], worldScale: 1.3,
    description: '朱雀衔火的喷焰枪，烈焰扑面，贯穿成群之敌。',
    notes: ['近距离持续喷射火焰，射程约 10 米', '火焰可贯穿 3 名敌人'],
  }),
  def({
    id: 'stormpod', name: '青冥雷蛊', category: '发射器', kind: 'launcher', mode: 'semi',
    damage: 95, fireRate: 1.2, mag: 5, reserve: 30, reloadTime: 2.5, reloadStyle: 'cylinder',
    spreadHip: 0.012, spreadAim: 0.005, spreadPerShot: 0.012, spreadMax: 0.03, spreadRecovery: 0.1,
    recoil: { pitch: 0.04, yaw: 0.008, bias: 0, climb: 0 },
    critMult: 1.6, range: 90, element: 'corrode', elementChance: 0.6,
    projectile: { speed: 30, gravity: 14, radius: 0.15, explosionRadius: 3.2, lifetime: 1.8, visual: 'orb', scale: 0.9, bounces: 2, explodeOnExpire: true, color: 0x9dff4a },
    innate: [{ id: 'subShock', value: 0.4 }],
    aimFov: -10, sfx: 'shot_launcher', sfxVolume: 0.8, knockback: 4,
    tracerWidth: 0, impactSize: 0.9, kick: { back: 0.06, rot: 0.12 }, shake: 0.13, flash: 0.2,
    viewOffset: [0.23, -0.24, -0.52], aimOffset: [0.08, -0.17, -0.44], worldScale: 1.4,
    description: '以青铜蛊罐封存雷蛊与蚀毒的弹跳榴弹，落地翻滚，炸开一片青雷。',
    notes: ['蛊弹撞墙反弹 2 次，触敌或 1.8 秒后爆炸', '蚀雷双属，易引发「封脉」'],
  }),
  def({
    id: 'magmashot', name: '赤蛟霰铳', category: '霰弹枪', kind: 'shotgun', mode: 'semi',
    damage: 11, pellets: 8, fireRate: 2.5, mag: 2, reserve: 36, reloadTime: 1.4, shellTime: 0.55, reloadStart: 0.3, reloadStyle: 'shell',
    spreadHip: 0.01, spreadAim: 0.005, spreadPerShot: 0.015, spreadMax: 0.035, spreadRecovery: 0.12, pelletCone: 0.09,
    recoil: { pitch: 0.06, yaw: 0.014, bias: 0, climb: 0 },
    critMult: 2, range: 28, falloff: [8, 26, 0.35],
    element: 'fire', elementChance: 0.07,
    innate: [{ id: 'subCorrode', value: 0.06 }],
    aimFov: -8, sfx: 'shot_shotgun', sfxVolume: 1.0, knockback: 1.0,
    tracerWidth: 0.014, impactSize: 0.5, kick: { back: 0.09, rot: 0.25 }, shake: 0.24, flash: 0.28,
    viewOffset: [0.22, -0.22, -0.5], aimOffset: [0, -0.075, -0.4], worldScale: 1.3,
    description: '双管并列的赤蛟霰铳，铁砂裹着熔火与蚀液，专剥重甲。',
    notes: ['双管：连开两枪后逐发装填，装填中开火可打断', '一次射出 8 枚弹丸', '火蚀双属，易引发「熔金」'],
  }),
  def({
    id: 'trinity', name: '三才转轮', category: '手枪', kind: 'pistol', mode: 'semi',
    damage: 42, fireRate: 3.0, mag: 6, reserve: 54, reloadTime: 1.8, reloadStyle: 'cylinder',
    spreadHip: 0.005, spreadAim: 0.0015, spreadPerShot: 0.016, spreadMax: 0.045, spreadRecovery: 0.16,
    recoil: { pitch: 0.04, yaw: 0.009, bias: 0, climb: 0 },
    critMult: 2.4, range: 80, falloff: [35, 80, 0.7],
    element: 'fire', cycle: ['fire', 'shock', 'corrode'], elementChance: 0.45,
    aimFov: -12, sfx: 'shot_pistol', sfxVolume: 0.95, knockback: 2,
    tracerWidth: 0.035, impactSize: 1.0, kick: { back: 0.07, rot: 0.26 }, shake: 0.1, flash: 0.14,
    viewOffset: [0.2, -0.17, -0.42], aimOffset: [0, -0.09, -0.34], worldScale: 1.9, dropWeight: 0.8,
    description: '天、地、人三才分镌于转轮弹巢，火、雷、蚀依次出膛。',
    notes: ['弹巢按 灼烧 → 雷殛 → 蚀化 轮转出膛', '枪身灵纹显示下一发的元素', '每次换弹从灼烧重新开始'],
  }),
  def({
    id: 'railgun', name: '贯虹灵炮', category: '蓄能炮', kind: 'rifle', mode: 'charge',
    damage: 155, fireRate: 2, mag: 6, reserve: 36, reloadTime: 2.4, reloadStyle: 'cell',
    chargeTime: 0.9, chargeMinMult: 0.2, chargeFullPierce: 3, chargeDetonate: true,
    spreadHip: 0.01, spreadAim: 0, spreadPerShot: 0.02, spreadMax: 0.05, spreadRecovery: 0.15,
    recoil: { pitch: 0.05, yaw: 0.008, bias: 0, climb: 0 },
    critMult: 2.5, range: 200, pierce: 1,
    element: 'none', elementChance: 0.35,
    aimFov: -24, aimSpeed: 12, sfx: 'shot_sniper', sfxVolume: 0.9, knockback: 4,
    tracerWidth: 0.09, impactSize: 1.3, kick: { back: 0.08, rot: 0.16 }, shake: 0.18, flash: 0.2,
    viewOffset: [0.22, -0.22, -0.52], aimOffset: [0, -0.13, -0.36], worldScale: 1.1, dropWeight: 0.8,
    description: '以双轨灵纹束缚长虹的蓄能炮，一击贯穿，引万象归一。',
    notes: ['按住蓄力 0.9 秒，松开发射；蓄力越满伤害越高（20%–100%）', '满蓄：额外穿透 3 名敌人，并「引爆」命中目标身上的元素状态'],
  }),
  def({
    id: 'lantern', name: '蚀蛊灯', category: '蛊灯', kind: 'launcher', mode: 'semi',
    damage: 55, fireRate: 1.6, mag: 8, reserve: 48, reloadTime: 2.0, reloadStyle: 'cell',
    spreadHip: 0.01, spreadAim: 0.004, spreadPerShot: 0.006, spreadMax: 0.02, spreadRecovery: 0.1,
    recoil: { pitch: 0.012, yaw: 0.004, bias: 0, climb: 0 },
    critMult: 1.8, range: 60, pierce: 6,
    projectile: { speed: 14, gravity: -0.3, radius: 0.38, lifetime: 3.2, visual: 'orb', scale: 1.5, homing: 2.2, color: 0x9dff4a },
    element: 'corrode', elementChance: 0.6,
    innate: [{ id: 'seed', value: 0.5 }],
    aimFov: -8, sfx: 'shot_launcher', sfxVolume: 0.4, knockback: 0.6,
    tracerWidth: 0, impactSize: 0.8, kick: { back: 0.03, rot: 0.07 }, shake: 0.04, flash: 0.1,
    viewOffset: [0.24, -0.22, -0.5], aimOffset: [0.06, -0.15, -0.42], worldScale: 1.4, dropWeight: 0.8,
    description: '南疆巫祝的养蛊铜灯，灯火所照之处，瘴疠横生。',
    notes: ['发射缓缓飘行的蛊灯，自动寻敌并穿透多名敌人'],
  }),

  // ───── 魔刀千刃（docs/demon-blade.md；数值见第 10.1 节） ─────

  def({
    id: 'demon_blade', name: '魔刀千刃', category: '刀', kind: 'blade', mode: 'auto',
    // ── 千刃（远程形态 = 根字段）：一轮 3 柄固定扇形，每柄耗 1 发；召回式换弹不需要备弹 ──
    damage: 16, fireRate: 2.0, mag: 18, reserve: 0, reloadTime: 1.4, reloadStyle: 'recall',
    recall: true, perProjectileAmmo: true,
    spreadHip: 0.006, spreadAim: 0.006, spreadPerShot: 0.004, spreadMax: 0.02, spreadRecovery: 0.12,
    recoil: { pitch: 0.006, yaw: 0.003, bias: 0, climb: 0 },
    critMult: 2.0, range: 24, pierce: 1,
    projectile: {
      speed: 45, radius: 0.12, lifetime: 0.54, visual: 'blade', scale: 1,
      count: 3, stagger: 0, fan: 0.0873 /* 5° */, fanFixed: true, color: 0xff3a24 /* 朱红 */,
    },
    element: 'none', elementChance: 0.17,
    aimFov: 0, sfx: 'blade_throw', sfxVolume: 0.7, knockback: 0.8,
    tracerWidth: 0, impactSize: 0.6, kick: { back: 0.025, rot: 0.04 }, shake: 0.03, flash: 0,
    viewOffset: [0.24, -0.24, -0.46], aimOffset: [0.24, -0.24, -0.46], worldScale: 1.4, dropWeight: 0.6,
    // ── 斩（近战形态）：横斩 → 回斩 → 下劈；手感参数（前摇 / 整段 / 扇形）在这里调 ──
    melee: {
      combo: [
        { damage: 28, windup: 0.08, duration: 0.30, range: 3.2, halfAngle: 0.9599 /* 55° */, knockback: 1.5, lunge: 0, stunCrit: false, shake: 0.22 },
        { damage: 28, windup: 0.08, duration: 0.30, range: 3.2, halfAngle: 0.9599, knockback: 1.5, lunge: 0, stunCrit: false, shake: 0.22 },
        { damage: 54, windup: 0.14, duration: 0.46, range: 3.8, halfAngle: 0.6109 /* 35° */, knockback: 6, lunge: 0.6, stunCrit: true, shake: 0.5 },
      ],
      comboReset: 0.6, reachBelow: 0.3, reachAbove: 0.6, elementChance: 0.35,
      recallPerHit: 1, recallMaxPerSwing: 3, moveBonus: 0.4, formNames: ['斩', '千刃'],
      morphTime: 0.25, formStrikeWindow: 2, formStrikeMult: 1.5,
    },
    // ── 武器技能（V / 鼠标中键） ──
    skill: {
      kind: 'dashSlash', id: 'thousand_edge', name: '千刃·无间', glyph: '刃',
      description: '向准星水平方向瞬身突进 8 米（无敌、穿过敌人，被墙阻挡时提前停下），斩击路径两侧 1.6 米内的敌人并打上刃印；0.6 秒后千刃贯穿所有刃印目标并引爆其身上的元素状态。每命中 1 名敌人召回 2 柄飞刃。',
      cooldown: 16, dashDist: 8, dashTime: 0.18, iframes: 0.25, exitSpeed: 6,
      pathRadius: 1.6, slashDamage: 60, impaleDelay: 0.6, impaleDamage: 140, recallPerHit: 2, maxMarks: 24,
    },
    description: '妖魔铸就的弧形长刀，刀身可裂解为千柄飞刃。近身连斩召回飞刃，再化作刃雨远程收割。',
    notes: [
      '右键切换「斩」/「千刃」（0.25 秒），切换后 2 秒内的第一次攻击伤害 +50%',
      '「斩」：横斩 → 回斩 → 下劈，扇形内所有敌人都会被命中；每命中 1 名敌人召回 1 柄飞刃（每段最多 3 柄）',
      '「斩」：下劈对眩晕中的敌人必定暴击；持「斩」时移动速度 +0.4',
      '「千刃」：一次射出 3 柄飞刃（可爆头、穿透 1）；R 或打空后召回飞刃，不消耗备弹',
    ],
  }),
];

export const WEAPON_IDS: readonly string[] = WEAPON_DEFS.map((d) => d.id);

const BY_ID = new Map<string, WeaponDef>(WEAPON_DEFS.map((d) => [d.id, d]));

/** 取武器定义；未知 id 退回步枪（容错，避免上游传错 id 直接崩溃） */
export function getWeaponDef(id: string): WeaponDef {
  return BY_ID.get(id) ?? (BY_ID.get('rifle') as WeaponDef);
}

export function hasWeaponDef(id: string): boolean {
  return BY_ID.has(id);
}

/** 命中扫描（非投射物、非光束） */
export function isHitscan(d: WeaponDef): boolean {
  return !d.projectile && d.mode !== 'beam';
}

export function isExplosive(d: WeaponDef): boolean {
  return !!d.projectile && d.projectile.explosionRadius > 0;
}

/** 每次扣扳机（或每跳）的伤害单位数：弹丸数 × 弹体数 */
export function hitsPerShot(d: WeaponDef): number {
  return d.pellets * (d.projectile ? d.projectile.count : 1);
}

/** 每秒「射击次数」（点射算每发） */
export function shotsPerSecond(d: WeaponDef, rate = d.fireRate): number {
  return rate * d.burstCount;
}

/** 双形态武器（WeaponDef.melee 非 null，魔刀千刃） */
export function isDualForm(d: WeaponDef): boolean {
  return d.melee !== null;
}

/** 某形态下的有效开火模式：双形态武器的近战形态为 'melee'，其他情况为 d.mode */
export function formMode(d: WeaponDef, form: WeaponForm): FireMode {
  return d.melee && form === 'melee' ? 'melee' : d.mode;
}

/** 近战连段一轮的总时长（秒，未计攻速）；非双形态武器为 0 */
export function comboCycleTime(d: WeaponDef): number {
  if (!d.melee) return 0;
  let t = 0;
  for (const s of d.melee.combo) t += s.duration;
  return t;
}
