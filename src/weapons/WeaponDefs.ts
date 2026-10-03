/**
 * 11 把武器的静态定义与稀有度常量。
 *
 * 数值基准（DESIGN 第 4、7 节）：普通稀有度、无加成时身体持续 DPS 约 60–90（含换弹）。
 * 无头实测（120 秒、8 米大木桩、完美压枪、备弹充足；括号内为不含 5% 基础暴击）：
 * 左轮 88（82）、冲锋枪 95（91）、步枪 95（90）、点射 93（86）、霰弹 95（90，含边装边打）、弩 88（82）、
 * 光束 77（74，单跳伤害 7→8 后；旁边有第二名敌人吃电弧时约 105）、机炮 94（90）、蜂群 89（82）、榴弹 111（火焰对生命 ×1.25，另有灼烧 DOT）；
 * 狙击 120（107），作为必须开镜、射速最慢的精准武器有意略高。
 * 所有角度为弧度「半角」；射速为「每秒发数」（burst 为每秒轮数，beam 为每秒跳数）。
 */
import type { Element, ProjectileVisual, SfxId } from '../core/types';

export type FireMode = 'semi' | 'auto' | 'burst' | 'beam' | 'spinup';
export type WeaponKind = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'launcher' | 'crossbow' | 'beam' | 'heavy';
/** 第一人称换弹动画风格 */
export type ReloadStyle = 'mag' | 'cylinder' | 'shell' | 'tube' | 'cell' | 'box';

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
  explodeOnExpire: boolean;
  /** 无元素时弹体颜色 */
  color: number;
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
}

/** 稀有度伤害倍率 */
export const RARITY_DAMAGE: readonly number[] = [1, 1.15, 1.35, 1.6, 1.9];
/** 强化上限与每级伤害加成 */
export const MAX_LEVEL = 5;
export const LEVEL_DAMAGE = 0.12;

type DefInput = Omit<WeaponDef, 'burstCount' | 'burstInterval' | 'shellTime' | 'reloadStart' | 'pelletCone' | 'falloff' | 'projectile' | 'pierce' | 'spinup' | 'moveSlow' | 'chainFraction' | 'chainRange' | 'sfxVolume' | 'aimSpeed' | 'pellets' | 'element' | 'worldScale'>
  & Partial<Pick<WeaponDef, 'burstCount' | 'burstInterval' | 'shellTime' | 'reloadStart' | 'pelletCone' | 'falloff' | 'pierce' | 'spinup' | 'moveSlow' | 'chainFraction' | 'chainRange' | 'sfxVolume' | 'aimSpeed' | 'pellets' | 'element' | 'worldScale'>>
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
          explodeOnExpire: false,
          color: 0xffd9a0,
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
