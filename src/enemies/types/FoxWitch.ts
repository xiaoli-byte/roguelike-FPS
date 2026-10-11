/**
 * 九尾狐巫（fox_witch，第二章 · 昆仑雪墟的辅助）：汉画像石里侍奉西王母的九尾狐，冻成了白狐女祭司。
 * 一面青铜镜悬浮在她胸前（SM_EnemyPart_FoxWitchMirror，挂在 mirror 挂点上），手从不碰镜子：平时镜背的玉钮朝外，
 * 她隔空结印驱使它翻转、升起、照人。铜镜就是弱点（头部判定挂在镜心上）：「先打铜镜」。
 * 设计见 docs/art/enemy-roster-v2.md「九尾狐巫 · 冰壁与铜镜」。
 *
 * 她不近战，靠改变战场辅助同伴：
 * - 保持距离：躲在同伴身后 12–18 米；玩家逼近到 7 米内时九尾一甩，向侧后方闪身约 5 米（5 秒冷却）。
 * - 立冰壁（约 10 秒，有同伴在交火）：尾巴一扫、铜镜升到头顶压下，在同伴和玩家之间升起一道 4 米宽、2.5 米高的冰壁
 *   （FoxIceWall：真的碰撞体，挡人、挡子弹、挡视线；150 血可打碎；12 秒后自己崩解；狐巫死了随之碎掉）。
 *   每只狐巫最多同时维持 2 道，第三道起最老的那道先碎。
 * - 霜甲（约 8 秒）：铜镜飞旋，12 米内同伴身上结一层冰壳，受到的伤害 ×0.7，持续 5 秒（src/enemies/SupportBuffs.ts 登记，
 *   多只狐巫不叠加，按乘法撤下）。
 * - 照妖镜（约 6 秒，有视线）：铜镜翻到镜面朝外，转向玩家，镜面蓄光 0.8 秒（一道细光线跟着玩家扫），然后射出冻结光束：
 *   出手那一刻镜子到玩家之间没有遮挡才算命中，伤害 + 减速 70% 1.5 秒——断开视线就能躲。
 * - 碎镜：铜镜累计承受她最大生命 30% 的伤害后裂开炸碎，霜甲立刻消失，此后不再立冰壁、不再照镜，
 *   改放狐火（三团追踪狐火，约 4.5 秒一轮）；弱点挪到她的头上。
 *
 * 动作：九条大尾巴（两扇各四条 + 正中主尾）是弹簧骨骼，随移动惯性甩动、平时像孔雀屏一样缓缓起伏，施法时展开 / 横扫；
 * 宽袖按重力下垂；趾行狐腿小步走；双手隔空结印（剑指、托举、横扫），不碰镜子。
 *
 * 状态机：enter → stalk → wallWindup | armorWindup | mirrorCharge | foxfireWindup | blink → stalk；碎镜时 scream → stalk
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, IEnemy, SpawnOptions } from '../../core/types';
import { clamp01, raySphere } from '../../core/math';
import type { StaticBox } from '../../world/Collision';
import { StandardEnemy } from '../StandardEnemy';
import { EnemyBase, type ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody, NativePose } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { BuffRegistry, type Buffable } from '../SupportBuffs';
import { BeamMesh, GroundDecal } from '../bosses/Visuals';
import { Geo, flat, joint, part } from '../Models';
import { FrostShell, Sway, chillPlayer, iceWallGeometry } from '../fx/FrostSupportFx';

export const FOX_WITCH_DEF: ScaledEnemyDef = {
  id: 'fox_witch',
  name: '九尾狐巫',
  hp: 130,
  speed: 4.6,
  radius: 0.4,
  height: 1.8,
  // 照妖镜光束的基础伤害（狐火 = 0.7 倍）
  damage: 12,
  coins: [3, 5],
  essence: 1,
  // 弱点 = 悬浮铜镜：判定球挂在镜心（随镜子的浮动、翻转走）
  headY: 1.1,
  headRadius: 0.27,
  knockbackResist: 0.25,
  color: 0x8fdcff,
  // 美术按 1.8 米制作，游戏里放大约 1.15 倍（约 2.1 米）
  scale: 1.15,
};

/** 冰壁：狐巫召出的可破坏掩体（不算阵容，只由狐巫生成） */
export const ICE_WALL_DEF: ScaledEnemyDef = {
  id: 'fox_ice_wall',
  name: '狐巫冰壁',
  hp: 150,
  speed: 0,
  // 半径只用于分离 / 爆炸查询：实际体积由 FoxIceWall 的碰撞盒决定
  radius: 0.9,
  height: 2.5,
  // 「飞行」= 不受重力、原地不动（墙体自己的碰撞盒就在脚下，按地面单位积分会被顶到墙顶上）
  flying: true,
  damage: 0,
  coins: [0, 0],
  essence: 0,
  headY: 2.0,
  headRadius: 0.2,
  knockbackResist: 1,
  color: 0xbfe8ff,
};
export const ICE_WALL_ID = ICE_WALL_DEF.id;

/** 冰壁尺寸（米）与寿命 */
export const WALL = { width: 4, height: 2.5, thick: 0.6, life: 12, segments: 6 } as const;
/** 冰壁离被保护的同伴多远（占同伴 → 玩家距离的比例，夹在 [2.5, 6] 米），离玩家至少多远 */
const WALL_ALONG = { frac: 0.4, min: 2.5, max: 6, playerGap: 3.5 } as const;
const WALL_COOLDOWN = [9, 11] as const;
const WALL_WINDUP = 0.9;
const MAX_WALLS = 2;
/** 霜甲 */
const ARMOR_RANGE = 12;
const ARMOR_COOLDOWN = [7, 9] as const;
const ARMOR_WINDUP = 0.8;
const ARMOR_DURATION = 5;
const ARMOR_TAKEN = 0.7;
/** 照妖镜 */
const MIRROR_RANGE = 30;
const MIRROR_COOLDOWN = [5.5, 6.5] as const;
const MIRROR_CHARGE = 0.8;
/** 蓄光时瞄准线跟随玩家的角速度（弧度 / 秒）：横移够快就能甩开 */
const MIRROR_TRACK = 1.6;
const MIRROR_SLOW = 0.7;
const MIRROR_SLOW_TIME = 1.5;
/** 碎镜：铜镜累计承受的伤害（相对最大生命） */
export const MIRROR_BREAK = 0.3;
/** 狐火 */
const FOXFIRE_COOLDOWN = [4, 5] as const;
const FOXFIRE_WINDUP = 0.7;
/** 闪身 */
const BLINK_RANGE = 7;
const BLINK_DIST = 5;
const BLINK_TIME = 0.28;
const BLINK_COOLDOWN = 5;
/** 躲在同伴身后：离玩家的距离带（米） */
const KEEP_RANGE = [12, 18] as const;
const BEHIND_ALLIES = 4;
/** 出场：尾巴从收拢到展开 */
const ENTER_TIME = 0.9;

/** 铜镜挂点（模型空间、未缩放）：胸前，镜心为原点，镜面朝 +Z、玉钮在 -Z；平时转 180°（玉钮朝外） */
const MIRROR_HOME = new THREE.Vector3(0, 1.1, 0.52);
const MIRROR_R = 0.3;

const C = {
  fur: 0xf2f4f8, robe: 0x9cc4e4, robeDark: 0x5a7fa6, tailTip: 0x6fa8e8, bronze: 0x6f8a6a, bronzeLight: 0xb8a878,
  jade: 0x58e0d0, jadeHot: 0xd8fff8, ice: 0xbfe8ff, iceHot: 0xffffff, frost: 0x9fdcff, mirrorFace: 0xd8e8f0,
  beam: 0x8fe6ff, beamCore: 0xf2ffff, foxfire: 0x7fd8ff, shard: 0xa89a68, armor: 0xb8ecff,
};

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
type Side = 'L' | 'R';
const boneNames = (s: Side) => ({
  arm: `arm_${s}`, forearm: `forearm_${s}`, hand: `hand_${s}`, middle1: `middle_1_${s}`,
  thigh: `thigh_${s}`, shin: `shin_${s}`, foot: `foot_${s}`, toe: `toe_${s}`,
  sleeve: [`sleeve_${s}1`, `sleeve_${s}2`], robe1: `robe_${s}1`, robe2: `robe_${s}2`,
  finger1: FINGERS.map((f) => `${f}_1_${s}`), finger2: FINGERS.map((f) => `${f}_2_${s}`),
});
const BN: Record<Side, ReturnType<typeof boneNames>> = { L: boneNames('L'), R: boneNames('R') };
type Curl = readonly [number, number, number, number, number];
/** 手势：五指弯曲量（0 = 伸直，1 = 握拳；负值 = 张开反翘） */
const GESTURE: Record<string, Curl> = {
  relax: [0.2, 0.18, 0.22, 0.28, 0.34],
  // 剑指：食指、中指并拢伸直，其余扣住
  sword: [0.75, 0.0, 0.02, 0.95, 0.95],
  offer: [0.05, 0.15, 0.18, 0.22, 0.28],
  splay: [-0.25, -0.25, -0.2, -0.2, -0.25],
  claw: [0.35, 0.65, 0.65, 0.7, 0.7],
};
/** 手的 IK 目标（模型空间、未缩放；左手，右手取 x 镜像）。绑定姿势的手在 (0.445, 0.99, 0.21)，肩在 (0.13, 1.22, 0.16) */
const HAND: Record<string, [number, number, number]> = {
  relax: [0.34, 0.92, 0.25],
  // 剑指引镜：手停在镜侧（不碰镜子）
  guide: [0.26, 1.14, 0.42],
  // 立冰壁：先扬起，再向前下方一扫
  raise: [0.38, 1.46, 0.24],
  sweep: [0.42, 0.9, 0.42],
  // 霜甲：双手托向前上方
  offer: [0.24, 1.28, 0.44],
  // 碎镜哀鸣：双手捂脸前
  cover: [0.1, 1.42, 0.36],
};
/**
 * 九条尾巴：左右各 4（1 最低），C 是两扇正中、从腰后向上向后扬起的主尾
 * （Tripo 只生成了 8 条，C 是复制 L4 的网格补上的，见 art/tools/foxwitch_ninth_tail.py）。程序化白模同样画 9 条。
 */
export const TAIL_IDS = ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4', 'C'] as const;
const TAIL_SEG_W = [0.5, 0.3, 0.2] as const;

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _t = new THREE.Vector3();
const _w = new THREE.Vector3();
const _h1 = new THREE.Vector3(), _h2 = new THREE.Vector3(), _h3 = new THREE.Vector3(), _h4 = new THREE.Vector3();
const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s3 = new THREE.Vector3(), _s4 = new THREE.Vector3();
const _hc = new THREE.Vector3();
const _scratch: IEnemy[] = [];
const _allies: IEnemy[] = [];

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** 临界阻尼弹簧：姿态权重的缓入缓出 */
class Ease {
  x = 0;
  private v = 0;
  private readonly w: number;
  constructor(w: number) {
    this.w = w;
  }
  step(target: number, dt: number): number {
    const h = Math.min(dt, 1 / 30), w = this.w;
    this.v += (w * w * (target - this.x) - 2 * w * this.v) * h;
    this.x += this.v * h;
    return this.x;
  }
}

// ───────────── 同伴判定（冰壁、首领不算） ─────────────

/** 辅助怪眼里的「同伴」：活着、不是首领、不是冰壁 */
export function isFrostAlly(self: IEnemy, e: IEnemy): boolean {
  return e !== self && e.alive && !e.isBoss && e.def.id !== ICE_WALL_ID;
}

// ───────────── 冰壁选址（纯函数，单元测试直接调用） ─────────────

export interface WallPlan {
  x: number;
  z: number;
  /** 墙面朝向（atan2(dx, dz)，朝玩家）；墙沿它的垂直方向展开 */
  yaw: number;
}

/**
 * 在被保护的一方（同伴质心 a）和玩家 p 之间选冰壁的位置：从 a 往玩家走「两者距离的 40%（夹在 2.5–6 米）」，
 * 但离玩家至少留 3.5 米；两者太近（站不下一道墙）就返回 false。shift = 沿连线再往玩家挪多少米（重试用）。
 */
export function planIceWall(a: THREE.Vector3, p: THREE.Vector3, out: WallPlan, shift = 0): boolean {
  const dx = p.x - a.x, dz = p.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d < WALL_ALONG.min + WALL_ALONG.playerGap) return false;
  let along = THREE.MathUtils.clamp(d * WALL_ALONG.frac, WALL_ALONG.min, WALL_ALONG.max) + shift;
  along = Math.min(along, d - WALL_ALONG.playerGap);
  if (along < 1.5) return false;
  out.x = a.x + (dx / d) * along;
  out.z = a.z + (dz / d) * along;
  out.yaw = Math.atan2(dx, dz);
  return true;
}

/**
 * 冰壁的碰撞盒（世界坐标 AABB）：墙沿 yaw 的垂直方向展开，碰撞世界只有轴对齐盒，所以切成 segments 段，
 * 每段取它的轴对齐包围盒（斜着的墙是一排略有重叠的台阶状盒子，比墙体略厚一点）。
 */
export function iceWallBoxes(x: number, y: number, z: number, yaw: number, segments = WALL.segments): { minX: number; minZ: number; maxX: number; maxZ: number; minY: number; maxY: number }[] {
  const ux = Math.cos(yaw), uz = -Math.sin(yaw);       // 墙的走向（模型 +X）
  const nx = Math.sin(yaw), nz = Math.cos(yaw);        // 墙面法线（朝玩家）
  const seg = WALL.width / segments;
  const hx = Math.abs(ux) * seg * 0.5 + Math.abs(nx) * WALL.thick * 0.5;
  const hz = Math.abs(uz) * seg * 0.5 + Math.abs(nz) * WALL.thick * 0.5;
  const out = [];
  for (let i = 0; i < segments; i++) {
    const s = (i + 0.5) * seg - WALL.width / 2;
    const cx = x + ux * s, cz = z + uz * s;
    out.push({ minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, minY: y, maxY: y + WALL.height });
  }
  return out;
}

// ───────────── 霜甲登记 ─────────────

type BuffAlly = IEnemy & Buffable;
const NO_MODS = { damage: 1, rate: 1, speed: 1, taken: 1 };
/** 只用「赐福」那一档：限时、同一时间认一个来源、来源死亡 / 碎镜立即失效 */
export const frostArmor = new BuffRegistry<BuffAlly, FoxWitch>(NO_MODS, { damage: 1, rate: 1, speed: 1, taken: ARMOR_TAKEN });
const takenInstalled = new WeakSet<object>();
const armorShells = new Map<IEnemy, FrostShell>();
let shellFrame = -1;

function installTakenModifier(ctx: GameContext): void {
  if (takenInstalled.has(ctx)) return;
  takenInstalled.add(ctx);
  ctx.combat.addOutgoingModifier((enemy) => frostArmor.taken(enemy as BuffAlly));
}

function releaseShell(ctx: GameContext, e: IEnemy, shatter: boolean): void {
  const s = armorShells.get(e);
  if (!s) return;
  armorShells.delete(e);
  if (shatter && e.alive) {
    e.getBodyCenter(_hc);
    ctx.fx.burst(_hc, C.armor, 14, 3, 0.6, 0.07, 9);
  }
  s.release();
}

// ───────────── 狐巫 ─────────────

/** 一只手：IK 目标与五指弯曲量（都平滑过渡） */
interface HandState {
  side: Side;
  target: THREE.Vector3;
  curl: number[];
  axes: THREE.Vector3[];
}

/** 一条尾巴：三节骨骼、绑定姿势下的方向（模型空间）、在扇面里的角度、惯性弹簧 */
interface TailState {
  bones: [string, string, string];
  /** 左扇 +1、右扇 -1、正中主尾 0 */
  side: number;
  /** 绑定姿势下的方向在扇面（XY）里与水平线的夹角 */
  phi: number;
  curlAxis: THREE.Vector3;
  sway: Sway;
  seed: number;
}

export class FoxWitch extends StandardEnemy {
  /** 碎镜（或死亡）后为 true：不再立冰壁、照镜、加霜甲（BuffSource） */
  silenced = false;
  /** 铜镜挂点（美术资产 SM_EnemyPart_FoxWitchMirror 挂在这里）：镜心为原点，镜面朝 +Z、玉钮朝 -Z */
  private mirror!: THREE.Group;
  private knob!: THREE.Mesh;
  /** 镜面蓄光（加法发光件，不进白模四视图） */
  private mirrorGlow!: THREE.Mesh;
  /** 白模身体（美术身体就绪后隐藏） */
  private body!: THREE.Group;
  private classicTails: THREE.Group[] = [];
  private classicArms: THREE.Group[] = [];
  private classicHead!: THREE.Group;

  private wallCd: number;
  private armorCd: number;
  private mirrorCd: number;
  private fireCd: number;
  private blinkCd = 1;
  private windTime = 1;
  private mirrorDamage = 0;
  private screamTime = 0;
  /** 本狐巫维持着的冰壁（老的在前） */
  readonly walls: FoxIceWall[] = [];
  private readonly plan: WallPlan = { x: 0, z: 0, yaw: 0 };
  private planY = 0;
  private wallDecal: GroundDecal | null = null;
  private aimLine: BeamMesh | null = null;
  private readonly aimPoint = new THREE.Vector3();
  private readonly blinkVel = new THREE.Vector3();
  private hurtWindow = 0;
  private hitAt = -9;
  private releaseAt = -9;
  /** 碎镜后的镜子已隐藏 */
  private mirrorGone = false;

  private readonly hands: HandState[] = [];
  private readonly tails: TailState[] = [];
  private readonly eRaise = new Ease(7);
  private readonly eGuide = new Ease(8);
  private readonly eOffer = new Ease(7);
  private readonly eScream = new Ease(10);
  private readonly eFlare = new Ease(4);
  private readonly eSpin = new Ease(5);
  private readonly lean = new Sway(14, 5.5);
  private readonly robe = new Sway(18, 3.5);
  private readonly headYaw = new Sway(30, 9);
  private readonly prevVel = new THREE.Vector3();
  private readonly mirrorPos = MIRROR_HOME.clone();
  private mirrorYaw = Math.PI;
  private mirrorPitch = 0;
  private mirrorRoll = 0;
  private mirrorSpinAngle = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, FOX_WITCH_DEF, opts);
    this.wallCd = ctx.rng.range(3, 5);
    this.armorCd = ctx.rng.range(1.5, 3);
    this.mirrorCd = ctx.rng.range(2.5, 4);
    this.fireCd = ctx.rng.range(1, 2);
    this.deathDuration = 1.3;
    this.setState('enter');
    installTakenModifier(ctx);
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const fur = flat(C.fur, { rough: 0.85 }), robe = flat(C.robe), robeDark = flat(C.robeDark), tip = flat(C.tailTip);
    const bronze = flat(C.bronze, { metal: 0.6, rough: 0.45 });
    // 白模：深衣、上身、狐头（双耳、长吻）、双臂、九尾扇；美术身体就绪后整组隐藏
    const body = joint(root, 0, 0, 0);
    this.body = body;
    part(body, Geo.cone(0.46, 0.9, 8, 'bottom'), robe, 0, 0.12, 0.05);
    part(body, Geo.cyl(0.07, 0.08, 0.2, 6, 'bottom'), fur, 0.14, 0, 0.12);
    part(body, Geo.cyl(0.07, 0.08, 0.2, 6, 'bottom'), fur, -0.14, 0, 0.12);
    part(body, Geo.box(0.3, 0.34, 0.22), robeDark, 0, 1.12, 0.12);
    const head = joint(body, 0, 1.36, 0.14);
    this.classicHead = head;
    part(head, Geo.ico(0.16, 1), fur, 0, 0.14, 0).scale.set(1, 1.05, 1);
    part(head, Geo.cone(0.07, 0.16, 5), fur, 0, 0.09, 0.17).rotation.x = Math.PI / 2;
    for (const s of [1, -1]) {
      part(head, Geo.cone(0.07, 0.2, 4, 'bottom'), fur, s * 0.1, 0.24, -0.01).rotation.z = -s * 0.25;
      const arm = joint(body, s * 0.14, 1.22, 0.16);
      arm.rotation.z = s * -0.65;
      part(arm, Geo.box(0.3, 0.12, 0.14), robe, s * 0.15, 0, 0);
      part(arm, Geo.box(0.12, 0.05, 0.08), fur, s * 0.34, 0, 0.02);
      this.classicArms.push(arm);
    }
    part(body, Geo.cyl(0.07, 0.02, 0.18, 4, 'bottom'), bronze, 0, 1.62, 0.12);
    // 九尾扇：根在腰后，像孔雀屏一样从左下到右下展开
    const fan = joint(body, 0, 0.88, -0.08);
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI * 0.42 + (i / 8) * Math.PI * 0.84;
      const tj = joint(fan, 0, 0, 0);
      tj.rotation.set(-0.35, 0, a);
      part(tj, Geo.ico(0.13, 1), fur, 0, 0.32, 0).scale.set(1, 2.4, 0.9);
      part(tj, Geo.ico(0.1, 1), tip, 0, 0.6, 0).scale.set(1, 1.5, 0.9);
      this.classicTails.push(tj);
    }

    // 悬浮铜镜（挂点在镜心：镜面朝 +Z、玉钮朝 -Z；直径 0.6 米、厚约 0.14 米）
    const mirror = joint(root, MIRROR_HOME.x, MIRROR_HOME.y, MIRROR_HOME.z);
    mirror.name = 'mirror'; // 挂点名：美术资产按它绑定（registry.toml 的 blockout.attachment）
    this.mirror = mirror;
    const disc = part(mirror, Geo.cyl(MIRROR_R, MIRROR_R, 0.07, 24), bronze, 0, 0, -0.01);
    disc.rotation.x = Math.PI / 2;
    const face = part(mirror, Geo.cyl(MIRROR_R * 0.8, MIRROR_R * 0.8, 0.012, 24), flat(C.mirrorFace, { metal: 0.9, rough: 0.15 }), 0, 0, 0.03);
    face.rotation.x = Math.PI / 2;
    part(mirror, Geo.torus(MIRROR_R * 0.92, 0.035, 6, 32), flat(C.bronzeLight, { metal: 0.7, rough: 0.35 }), 0, 0, 0);
    part(mirror, Geo.cyl(0.08, 0.1, 0.035, 10), bronze, 0, 0, -0.055).rotation.x = Math.PI / 2;
    // 玉钮（发光提示件，进白模）
    this.knob = this.glowPart(mirror, Geo.ico(0.055, 1), C.jade, C.jadeHot, 0, 0, -0.072);
    // 镜面蓄光（加法，平时不可见）
    this.mirrorGlow = this.glowPart(mirror, Geo.cyl(MIRROR_R * 0.78, MIRROR_R * 0.78, 0.004, 24), 0x000000, C.beamCore, 0, 0, 0.042, 1, true);
    this.mirrorGlow.rotation.x = Math.PI / 2;
    this.setHeadAnchor(mirror, 0, 0, 0);
    mirror.rotation.y = Math.PI;
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (n) {
      this.body.visible = false;
      this.initNative(n.pose);
    }
  }

  /** 绑定姿势下算好每根手指的弯曲轴、每条尾巴的扇面角与卷曲轴 */
  private initNative(P: NativePose): void {
    for (const side of ['L', 'R'] as const) {
      const axes: THREE.Vector3[] = [];
      for (const f of FINGERS) {
        const a = P.restPosition(`${f}_1_${side}`), b = P.restPosition(`${f}_2_${side}`);
        const ax = new THREE.Vector3(0, 0, 1);
        if (a && b) ax.crossVectors(_v.subVectors(b, a).normalize(), AZ).normalize();
        axes.push(ax);
      }
      const rest = P.restPosition(`hand_${side}`);
      this.hands.push({ side, target: rest ? rest.clone() : new THREE.Vector3(), curl: [...GESTURE.relax], axes });
    }
    for (let i = 0; i < TAIL_IDS.length; i++) {
      const id = TAIL_IDS[i];
      const bones: [string, string, string] = [`tail_${id}_1`, `tail_${id}_2`, `tail_${id}_3`];
      const a = P.restPosition(bones[0]), b = P.restPosition(bones[2]);
      if (!a || !b) continue;
      const d = _v.subVectors(b, a).normalize();
      const side = id[0] === 'L' ? 1 : id[0] === 'R' ? -1 : 0;
      const curlAxis = new THREE.Vector3().crossVectors(d, AZ);
      if (curlAxis.lengthSq() < 1e-6) curlAxis.set(side === 0 ? 1 : 0, -side, 0);
      curlAxis.normalize();
      this.tails.push({ bones, side, phi: Math.atan2(d.y, Math.abs(d.x)), curlAxis, sway: new Sway(16, 4), seed: i * 1.37 });
    }
  }

  protected override cancelAttack(): void {
    this.glowTarget[0] = 0;
    this.glowTarget[1] = 0;
    this.wallDecal?.release();
    this.wallDecal = null;
    this.aimLine?.release();
    this.aimLine = null;
    this.accel = 28;
    if (this.state !== 'stalk' && this.state !== 'idle' && this.state !== 'enter') this.setState('stalk');
  }

  protected override onDispose(): void {
    super.onDispose();
    frostArmor.dropSource(this, this.ctx.time.now);
  }

  // ───────────── AI ─────────────

  protected override ai(dt: number): void {
    const now = this.ctx.time.now;
    const rate = this.attackRate;
    this.wallCd -= dt * rate;
    this.armorCd -= dt * rate;
    this.mirrorCd -= dt * rate;
    this.fireCd -= dt * rate;
    this.blinkCd -= dt;
    this.hurtWindow = Math.max(0, this.hurtWindow - dt * 0.5);
    this.screamTime = Math.max(0, this.screamTime - dt);
    frostArmor.tick(now);
    this.pruneWalls();
    switch (this.state) {
      case 'enter': {
        this.stopMoving();
        this.facePlayer(2, dt);
        if (this.stateTime >= ENTER_TIME) this.setState('stalk');
        break;
      }
      case 'stalk': {
        if (this.tryBlink()) break;
        this.positionBehindAllies();
        this.facePlayer(3, dt);
        this.glowTarget[0] = this.silenced ? 0 : 0.25 + 0.1 * Math.sin(this.age * 2.5);
        if (this.screamTime > 0) break;
        if (!this.silenced) {
          if (this.wallCd <= 0 && this.pickWallSpot()) {
            this.beginCast('wallWindup', WALL_WINDUP);
            this.showWallDecal();
          } else if (this.armorCd <= 0 && this.armorTargets().length > 0) {
            this.beginCast('armorWindup', ARMOR_WINDUP);
          } else if (this.mirrorCd <= 0 && this.sees && this.distToPlayer() <= MIRROR_RANGE
            && this.requestAttack('ranged', MIRROR_CHARGE + 0.8)) {
            this.beginCast('mirrorCharge', MIRROR_CHARGE);
            this.playerChest(this.aimPoint);
            this.aimLine = BeamMesh.acquire(this.ctx.stageGroup, C.beam, C.beamCore);
            this.aimLine.setOpacity(0.35);
          }
        } else if (this.fireCd <= 0 && this.sees && this.distToPlayer() <= MIRROR_RANGE && this.requestAttack('ranged', FOXFIRE_WINDUP + 0.5)) {
          this.beginCast('foxfireWindup', FOXFIRE_WINDUP);
        }
        break;
      }
      case 'wallWindup': {
        this.stopMoving();
        _p.set(this.plan.x, this.position.y, this.plan.z);
        this.faceTowards(_p, 3, dt);
        const k = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.5 + 0.5 * k;
        if (this.wallDecal) {
          this.wallDecal.fill = k;
          this.wallDecal.time = this.age;
        }
        if (this.stateTime >= this.windTime) {
          this.raiseWall();
          this.wallCd = this.ctx.rng.range(WALL_COOLDOWN[0], WALL_COOLDOWN[1]);
          this.setState('stalk');
        }
        break;
      }
      case 'armorWindup': {
        this.stopMoving();
        this.facePlayer(2, dt);
        this.glowTarget[0] = 0.6 + 0.4 * clamp01(this.stateTime / this.windTime);
        if (this.stateTime >= this.windTime) {
          this.castArmor();
          this.armorCd = this.ctx.rng.range(ARMOR_COOLDOWN[0], ARMOR_COOLDOWN[1]);
          this.setState('stalk');
        }
        break;
      }
      case 'mirrorCharge': {
        this.stopMoving();
        this.facePlayer(2.5, dt);
        this.trackAim(dt);
        const k = clamp01(this.stateTime / this.windTime);
        this.glowTarget[1] = k;
        this.glowTarget[0] = 0.4 + 0.6 * k;
        if (this.stateTime >= this.windTime) {
          this.fireMirror();
          this.releaseAttack();
          this.mirrorCd = this.ctx.rng.range(MIRROR_COOLDOWN[0], MIRROR_COOLDOWN[1]);
          this.setState('stalk');
        }
        break;
      }
      case 'foxfireWindup': {
        this.stopMoving();
        this.facePlayer(3, dt);
        if (this.stateTime >= this.windTime) {
          this.castFoxfire();
          this.releaseAttack();
          this.fireCd = this.ctx.rng.range(FOXFIRE_COOLDOWN[0], FOXFIRE_COOLDOWN[1]);
          this.setState('stalk');
        }
        break;
      }
      case 'blink': {
        // 闪身：保持冲刺速度直线滑开（积分里直接用这个速度），到点收住
        this.desiredX = this.blinkVel.x;
        this.desiredZ = this.blinkVel.z;
        this.facePlayer(4, dt);
        if (this.stateTime >= BLINK_TIME) {
          this.accel = 28;
          this.velocity.multiplyScalar(0.25);
          this.setState('stalk');
        }
        break;
      }
      default:
        this.setState('stalk');
    }
  }

  private beginCast(state: string, windup: number): void {
    this.windTime = this.windup(windup, windup * 0.6);
    this.setState(state);
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.45, pitch: state === 'mirrorCharge' ? 1.5 : 1.15 });
  }

  /** 躲在同伴身后：同伴质心再往远离玩家的方向退几米，离玩家至少 KEEP_RANGE[0]；没有同伴就和玩家保持距离 */
  private positionBehindAllies(): void {
    const pl = this.ctx.player.position;
    const allies = this.alliesWithin(20);
    if (allies.length === 0) {
      this.keepRange(KEEP_RANGE[0], KEEP_RANGE[1], this.speed);
      return;
    }
    _q.set(0, 0, 0);
    for (const e of allies) _q.add(e.position);
    _q.multiplyScalar(1 / allies.length);
    _v.set(_q.x - pl.x, 0, _q.z - pl.z);
    const d = _v.length() || 1;
    _q.addScaledVector(_v, BEHIND_ALLIES / d);
    _v.set(_q.x - pl.x, 0, _q.z - pl.z);
    if (_v.length() < KEEP_RANGE[0]) _q.set(pl.x, _q.y, pl.z).addScaledVector(_v.normalize(), KEEP_RANGE[0]);
    if (Math.hypot(_q.x - this.position.x, _q.z - this.position.z) > 1.8) this.navigate(_q, this.speed, 1.2);
    else this.stopMoving();
  }

  /** 范围内的同伴（复用数组，调用方立即使用） */
  private alliesWithin(range: number): IEnemy[] {
    _allies.length = 0;
    const list = this.ctx.enemies.queryRadius(this.position, range, _scratch);
    for (const e of list) if (isFrostAlly(this, e)) _allies.push(e);
    _scratch.length = 0;
    return _allies;
  }

  /** 玩家逼近（或刚挨了重击）时向侧后方闪身：先试正后方偏左 / 偏右 50°，要可走、直线无遮挡 */
  private tryBlink(): boolean {
    if (this.blinkCd > 0 || this.screamTime > 0) return false;
    const close = this.distToPlayerXZ() < BLINK_RANGE;
    if (!close && this.hurtWindow < 0.15) return false;
    const pl = this.ctx.player.position;
    const away = Math.atan2(this.position.x - pl.x, this.position.z - pl.z);
    for (const off of [0.9, -0.9, 1.5, -1.5]) {
      const a = away + off * this.strafeSign;
      const x = this.position.x + Math.sin(a) * BLINK_DIST, z = this.position.z + Math.cos(a) * BLINK_DIST;
      if (!this.ctx.nav.isWalkable(x, z)) continue;
      _p.set(this.position.x, this.position.y + 0.6, this.position.z);
      _q.set(x, this.position.y + 0.6, z);
      if (this.ctx.world.segmentBlocked(_p, _q)) continue;
      const v = BLINK_DIST / BLINK_TIME;
      this.blinkVel.set(Math.sin(a) * v, 0, Math.cos(a) * v);
      this.velocity.x = this.blinkVel.x;
      this.velocity.z = this.blinkVel.z;
      this.accel = 400;
      this.blinkCd = BLINK_COOLDOWN;
      this.hurtWindow = 0;
      this.setState('blink');
      for (const t of this.tails) t.sway.kick(-this.strafeSign * 9, 4);
      this.getBodyCenter(_p);
      this.ctx.fx.burst(_p, C.foxfire, 18, 3, 0.5, 0.08, -1);
      this.ctx.audio.play('dash', { position: this.position, volume: 0.5, pitch: 1.3 });
      return true;
    }
    this.blinkCd = 1;
    return false;
  }

  // ───────────── 冰壁 ─────────────

  /** 在交火中的同伴（离玩家 5–30 米、离她 22 米内，取离玩家最近的至多三只的质心）和玩家之间选址；没有同伴就挡在自己前面 */
  private pickWallSpot(): boolean {
    const ctx = this.ctx, pl = ctx.player.position;
    const cand = this.alliesWithin(22).filter((e) => {
      const d = Math.hypot(e.position.x - pl.x, e.position.z - pl.z);
      return d > 5 && d < 30;
    });
    cand.sort((a, b) => a.position.distanceToSquared(pl) - b.position.distanceToSquared(pl));
    _q.set(0, 0, 0);
    const n = Math.min(3, cand.length);
    if (n === 0) _q.copy(this.position);
    else {
      for (let i = 0; i < n; i++) _q.add(cand[i].position);
      _q.multiplyScalar(1 / n);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!planIceWall(_q, pl, this.plan, attempt * 0.8)) return false;
      if (this.wallSpotClear()) return true;
    }
    return false;
  }

  /** 选址检查：墙中心和两端可走，玩家不在墙体里（墙不会把玩家关进去） */
  private wallSpotClear(): boolean {
    const ctx = this.ctx, pl = ctx.player.position, p = this.plan;
    const ux = Math.cos(p.yaw), uz = -Math.sin(p.yaw);
    for (const s of [0, -WALL.width / 2 + 0.3, WALL.width / 2 - 0.3]) {
      if (!ctx.nav.isWalkable(p.x + ux * s, p.z + uz * s)) return false;
    }
    // 玩家到墙中线的距离
    const dx = pl.x - p.x, dz = pl.z - p.z;
    const along = dx * ux + dz * uz, across = dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw);
    if (Math.abs(along) < WALL.width / 2 + 0.6 && Math.abs(across) < WALL.thick / 2 + ctx.player.radius + 0.6) return false;
    const gy = ctx.world.groundHeight(p.x, p.z, this.position.y + 2);
    this.planY = Number.isFinite(gy) ? gy : this.position.y;
    return true;
  }

  /** 前摇：墙线上一条从两端往中间填满的冰蓝预警带 */
  private showWallDecal(): void {
    const p = this.plan;
    // 墙的走向（模型 +X）= (cos yaw, -sin yaw)；预警带从一端出发沿它铺满
    const ux = Math.cos(p.yaw), uz = -Math.sin(p.yaw);
    const sx = p.x - ux * (WALL.width / 2), sz = p.z - uz * (WALL.width / 2);
    this.wallDecal?.release();
    this.wallDecal = GroundDecal.acquire(this.ctx.stageGroup, C.frost).rect(sx, this.planY, sz, Math.atan2(ux, uz), WALL.width, WALL.thick * 0.75);
  }

  private raiseWall(): void {
    const ctx = this.ctx;
    this.wallDecal?.release();
    this.wallDecal = null;
    this.releaseAt = this.age;
    // 超过上限：最老的那道先碎
    while (this.walls.length >= MAX_WALLS) this.walls.shift()?.expire();
    const e = ctx.enemies.spawn(ICE_WALL_ID, { position: new THREE.Vector3(this.plan.x, this.planY, this.plan.z), level: this.level });
    if (!(e instanceof FoxIceWall)) return;
    e.raise(this, this.plan.yaw);
    this.walls.push(e);
    this.mirror.getWorldPosition(_p);
    _q.set(this.plan.x, this.planY + 1.2, this.plan.z);
    ctx.fx.beam(_p, _q, C.frost, 0.06, 0.35);
    ctx.audio.play('shield_break', { position: _q, volume: 0.6, pitch: 0.6 });
  }

  private pruneWalls(): void {
    for (let i = this.walls.length - 1; i >= 0; i--) if (!this.walls[i].alive) this.walls.splice(i, 1);
  }

  // ───────────── 霜甲 ─────────────

  /** 12 米内、还没有霜甲（或快到期）的同伴 */
  private armorTargets(): IEnemy[] {
    const now = this.ctx.time.now;
    return this.alliesWithin(ARMOR_RANGE).filter((e) => {
      const b = frostArmor.get(e as BuffAlly);
      return !b || !b.blessedBy || b.blessedUntil - now < 1.5;
    });
  }

  private castArmor(): void {
    const ctx = this.ctx, now = ctx.time.now;
    this.releaseAt = this.age;
    this.mirror.getWorldPosition(_p);
    ctx.fx.ring(_q.set(this.position.x, this.position.y + 0.05, this.position.z), ARMOR_RANGE, C.armor, 0.8);
    ctx.audio.play('skill_buff', { position: _p, volume: 0.7, pitch: 1.2 });
    for (const e of this.alliesWithin(ARMOR_RANGE)) {
      const b = frostArmor.grantBless(e as BuffAlly, this, now + ARMOR_DURATION, now);
      e.getBodyCenter(_q);
      ctx.fx.beam(_p, _q, C.armor, 0.04, 0.4);
      ctx.fx.burst(_q, C.armor, 12, 2, 0.6, 0.07, -1);
      if (!armorShells.has(e)) armorShells.set(e, FrostShell.acquire(ctx.stageGroup));
      const target = e;
      b.fx.onUnbless = () => releaseShell(ctx, target, true);
      b.fx.onClear = () => releaseShell(ctx, target, true);
    }
  }

  // ───────────── 照妖镜 / 狐火 ─────────────

  /** 蓄光：瞄准点以有限角速度跟着玩家胸口转（横移够快能甩开），细光线从镜心画到瞄准点后的第一个遮挡 */
  private trackAim(dt: number): void {
    const ctx = this.ctx;
    this.mirror.getWorldPosition(_p);
    this.playerChest(_t);
    _v.subVectors(this.aimPoint, _p);
    _w.subVectors(_t, _p);
    const ang = _v.angleTo(_w);
    const step = MIRROR_TRACK * dt;
    if (ang > 1e-4) {
      const k = Math.min(1, step / ang);
      _v.normalize().lerp(_w.normalize(), k).normalize();
    } else _v.copy(_w).normalize();
    const dist = _p.distanceTo(_t);
    this.aimPoint.copy(_p).addScaledVector(_v, dist);
    if (this.aimLine) {
      const hit = ctx.world.raycast(_p, _v, MIRROR_RANGE + 5);
      _q.copy(_p).addScaledVector(_v, hit ? hit.distance : MIRROR_RANGE + 5);
      this.aimLine.set(_p, _q, 0.025 + 0.02 * clamp01(this.stateTime / this.windTime));
      this.aimLine.flicker(0.6 + 0.4 * Math.sin(this.age * 30));
    }
  }

  /**
   * 出手：沿当前瞄准方向射出冻结光束。光束从镜心到第一个遮挡（墙、冰壁、掩体）；
   * 玩家在光束上（离光束轴 < 玩家半径 + 0.25 米）且镜子到玩家之间没有遮挡才算命中：伤害 + 减速。
   */
  fireMirror(): boolean {
    const ctx = this.ctx, pl = ctx.player;
    this.aimLine?.release();
    this.aimLine = null;
    this.glowTarget[1] = 0;
    this.releaseAt = this.age;
    this.mirror.getWorldPosition(_p);
    _v.subVectors(this.aimPoint, _p).normalize();
    const wall = ctx.world.raycast(_p, _v, MIRROR_RANGE + 5);
    const reach = wall ? wall.distance : MIRROR_RANGE + 5;
    this.playerChest(_t);
    const along = _w.subVectors(_t, _p).dot(_v);
    const off = _w.addScaledVector(_v, -along).length();
    const hit = pl.alive && along > 0 && along <= reach && off <= pl.radius + 0.25 && !ctx.world.segmentBlocked(_p, _t);
    _q.copy(_p).addScaledVector(_v, hit ? along : reach);
    ctx.fx.beam(_p, _q, C.beam, 0.14, 0.3);
    ctx.fx.burst(_q, C.frost, 16, 3, 0.5, 0.08, 4);
    ctx.audio.play('shot_beam', { position: _p, volume: 0.75, pitch: 1.4 });
    if (hit) {
      ctx.combat.damagePlayer(this.def.damage * this.damageMult, 'none', this, _p);
      chillPlayer(ctx, MIRROR_SLOW, MIRROR_SLOW_TIME);
      ctx.fx.burst(_t, C.armor, 20, 2.5, 0.8, 0.08, -0.5);
    }
    return hit;
  }

  /** 碎镜后：三团追踪狐火，从尾尖散开射出（先往两侧绕，再被追踪拉回玩家） */
  private castFoxfire(): void {
    this.releaseAt = this.age;
    this.playerChest(_t);
    for (let i = 0; i < 3; i++) {
      const lat = (i - 1) * 2.6;
      this.localPoint((i - 1) * 0.55, 1.45 + (i === 1 ? 0.3 : 0), -0.25, _p);
      _q.set(_t.x + Math.cos(this.facing) * lat, _t.y + 1.2, _t.z - Math.sin(this.facing) * lat);
      this.shoot({ from: _p, target: _q, speed: 8.5, damage: this.def.damage * 0.7, radius: 0.28, color: C.foxfire, homing: 2.4, lifetime: 5, visual: 'orb', scale: 1.4 });
      this.ctx.fx.burst(_p, C.foxfire, 8, 1.5, 0.4, 0.07, -1);
    }
  }

  // ───────────── 受击 / 碎镜 / 死亡 ─────────────

  /** 弱点是铜镜；真头另加一个判定球（算打身体），否则身体胶囊太矮、打头会穿过去。镜碎后头就是弱点（锚点已挪过去） */
  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    const hit = super.raycastHit(origin, dir, maxDist, out);
    if (!this.alive || this.silenced) return hit;
    this.realHead(_hc);
    const t = raySphere(origin, dir, _hc, 0.2 * this.sizeScale);
    if (t >= 0 && t <= maxDist && (!hit || t < out.distance - 0.05)) {
      out.distance = t;
      out.headshot = false;
      return true;
    }
    return hit;
  }

  private realHead(out: THREE.Vector3): THREE.Vector3 {
    const b = this.nativeBody?.pose.bone('head');
    b?.updateWorldMatrix(true, false);
    if (b) return b.localToWorld(out.set(0, 0, 0)).add(_w.set(0, 0.12 * this.sizeScale, 0));
    return this.localPoint(0, 1.52, 0.14, out);
  }

  protected override onHurt(r: DamageResult): void {
    super.onHurt(r);
    this.hurtWindow += r.dealt / Math.max(1, this.maxHp);
    const onMirror = !this.silenced && this.alive && !!r.request.headshot;
    if (!onMirror) return;
    this.hitAt = this.age;
    this.mirrorDamage += r.dealt;
    this.glowLevel[0] = 1;
    if (this.mirrorDamage >= this.maxHp * MIRROR_BREAK) {
      this.breakMirror();
      return;
    }
    this.mirror.getWorldPosition(_p);
    this.ctx.audio.play('hit_armor', { position: _p, volume: 0.7, pitch: 1.3 });
  }

  /** 铜镜累计受伤占碎镜阈值的比例（测试 / 调试用） */
  get mirrorCrack(): number {
    return clamp01(this.mirrorDamage / (this.maxHp * MIRROR_BREAK));
  }

  private breakMirror(): void {
    const ctx = this.ctx;
    this.silenced = true;
    this.mirror.getWorldPosition(_p);
    this.cancelAttack();
    this.releaseAttack();
    frostArmor.dropSource(this, ctx.time.now);
    this.mirrorGone = true;
    this.mirror.visible = false;
    ctx.fx.burst(_p, C.shard, 22, 5, 0.9, 0.07, 14);
    ctx.fx.burst(_p, C.jadeHot, 12, 4, 0.5, 0.06, 6);
    for (let i = 0; i < 3; i++) {
      _q.set(_p.x + (Math.random() - 0.5) * 2, _p.y + (Math.random() - 0.3) * 1.5, _p.z + (Math.random() - 0.5) * 2);
      ctx.fx.lightning(_p, _q, C.frost);
    }
    ctx.audio.play('shield_break', { position: _p, volume: 1, pitch: 0.8 });
    ctx.audio.play('boss_roar', { position: this.position, volume: 0.4, pitch: 2.2 });
    const head = this.nativeBody?.pose.bone('head');
    if (head) this.setHeadAnchor(head, 0, 0.1, 0.05);
    else this.setHeadAnchor(this.classicHead, 0, 0.14, 0);
    this.screamTime = 1.2;
    this.fireCd = Math.max(this.fireCd, 1.5);
    for (const t of this.tails) t.sway.kick(0, 10);
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.silenced = true;
    frostArmor.dropSource(this, this.ctx.time.now);
    if (attackDirector.purging) return;
    const ctx = this.ctx;
    const center = this.getBodyCenter(new THREE.Vector3());
    ctx.fx.burst(center, C.frost, 26, 3.5, 1.2, 0.08, 2);
    ctx.fx.burst(center, C.foxfire, 14, 2, 1.4, 0.07, -1);
    if (!this.mirrorGone) {
      this.mirror.getWorldPosition(_p);
      ctx.fx.burst(_p, C.shard, 14, 3, 0.8, 0.07, 14);
      this.mirror.visible = false;
      this.mirrorGone = true;
    }
  }

  // ───────────── 动画 ─────────────

  private deathT = 0;

  /** 死亡：双膝一软向后坐倒，九尾垂下，身体化作冰雾散去 */
  protected override animateDeath(t: number): void {
    const dt = Math.max(0, (t - this.deathT) * this.deathDuration);
    this.deathT = t;
    this.model.rotation.x = -0.5 * smooth(t / 0.5);
    this.model.position.y = -0.3 * smooth(t / 0.6) * this.sizeScale;
    const fade = smooth((t - 0.5) / 0.5);
    this.model.scale.setScalar(Math.max(0.01, this.sizeScale * (1 - fade)));
    if (dt > 0) this.pose(dt);
    if (Math.random() < dt * 30) {
      this.getBodyCenter(_p);
      _p.x += (Math.random() - 0.5) * 0.6;
      _p.z += (Math.random() - 0.5) * 0.6;
      this.ctx.fx.burst(_p, C.frost, 1, 0.8, 1.2, 0.08, -0.6);
    }
  }

  protected override pose(dt: number): void {
    const st = this.state;
    const cast = clamp01(this.stateTime / Math.max(0.01, this.windTime));
    // 立冰壁：前 60% 扬手，后 40% 向前下方一扫
    const raise = st === 'wallWindup' ? (cast < 0.6 ? 1 : 1 - (cast - 0.6) / 0.4) : 0;
    const sweep = st === 'wallWindup' ? smooth((cast - 0.55) / 0.45) : 0;
    this.eRaise.step(st === 'wallWindup' ? 1 : 0, dt);
    this.eGuide.step(st === 'mirrorCharge' || st === 'foxfireWindup' ? 1 : 0, dt);
    this.eOffer.step(st === 'armorWindup' ? 1 : 0, dt);
    this.eScream.step(this.screamTime > 0 ? 1 : 0, dt);
    const enter = st === 'enter' ? smooth(this.stateTime / ENTER_TIME) : 1;
    // 尾扇展开：施法时展开，出场从收拢展开到平常
    const flareGoal = (st === 'armorWindup' ? 1 : 0) + (st === 'mirrorCharge' ? 0.5 : 0) + (st === 'wallWindup' ? 0.6 : 0)
      + 1.4 * this.eScream.x - (1 - enter) * 1.2;
    this.eFlare.step(flareGoal, dt);
    this.eSpin.step(st === 'armorWindup' ? 1 : 0, dt);
    this.poseMirror(dt, raise, sweep);
    if (this.nativeBody) this.poseNative(this.nativeBody, dt, raise, sweep);
    else this.poseClassic(dt, raise, sweep);
    this.updateFx(dt);
  }

  /**
   * 铜镜：平时悬在胸前（玉钮朝外），随呼吸慢半拍浮动、轻轻摆；照镜时翻到镜面朝外、对准瞄准点；
   * 立冰壁时升到头顶、镜面朝下，随扫手压下；霜甲时绕竖轴飞旋；被打中往后一弹再回摆。
   */
  private poseMirror(dt: number, raise: number, sweep: number): void {
    if (this.mirrorGone) return;
    const t = this.age;
    const k = 1 - Math.exp(-7 * dt);
    const guide = this.eGuide.x, spin = this.eSpin.x;
    _t.copy(MIRROR_HOME);
    _t.y += 0.04 * Math.sin(t * 1.6 - 0.7);
    _t.lerp(_v.set(0, 1.95, 0.25), this.eRaise.x * (1 - sweep));
    _t.lerp(_v.set(0, 1.25, 0.95), sweep * 0.8);
    _t.y += 0.12 * guide;
    this.mirrorPos.lerp(_t, k);
    this.mirror.position.copy(this.mirrorPos);
    const ht = t - this.hitAt;
    const jolt = ht < 0.6 ? Math.exp(-7 * ht) * Math.cos(22 * ht) : 0;
    this.mirror.position.z -= 0.06 * jolt;
    // 朝向：平时玉钮朝外（yaw = π，轻摆）；照镜对准瞄准点（模型空间里的方向）
    let yawGoal = Math.PI + 0.2 * Math.sin(t * 0.7), pitchGoal = 0;
    if (guide > 0.01 && this.state === 'mirrorCharge') {
      this.mirror.getWorldPosition(_p);
      _v.subVectors(this.aimPoint, _p);
      const aimYaw = wrapAngle(Math.atan2(_v.x, _v.z) - this.facing);
      yawGoal = mix(yawGoal, aimYaw, guide);
      pitchGoal = -Math.atan2(_v.y, Math.hypot(_v.x, _v.z)) * guide;
    }
    this.mirrorSpinAngle += dt * 9 * spin;
    yawGoal += this.mirrorSpinAngle * (spin > 0.02 ? 1 : 0);
    if (spin <= 0.02) this.mirrorSpinAngle = 0;
    const kk = 1 - Math.exp(-10 * dt);
    this.mirrorYaw += wrapAngle(yawGoal - this.mirrorYaw) * kk;
    this.mirrorPitch = mix(this.mirrorPitch, pitchGoal - (Math.PI / 2) * this.eRaise.x * (1 - sweep * 0.5), kk);
    this.mirrorRoll = mix(this.mirrorRoll, 0.05 * Math.sin(t * 0.9), kk);
    this.mirror.rotation.set(this.mirrorPitch - 0.3 * jolt, this.mirrorYaw, this.mirrorRoll, 'YXZ');
    const pulse = 1 + 0.06 * Math.max(0, 1 - (t - this.releaseAt) * 4);
    this.mirror.scale.setScalar(pulse);
    this.knob.scale.setScalar(1 + 0.3 * clamp01(this.glowLevel[0]));
  }

  /**
   * 美术骨骼动画（creature_rigs/SK_Enemy_FoxWitch.json）。模型空间：X = 生物左侧，Y = 上，Z = 前。
   * - 身体：呼吸、随移动前倾 / 侧倾（弹簧），头看向玩家（慢半拍）；施法时仰身，碎镜时捂脸颤抖。
   * - 腿：趾行狐腿小步走（大腿前后摆、跖骨抬起），深衣前后片跟着腿与惯性摆。
   * - 手：IK 目标按姿势混合（垂手 / 剑指引镜 / 扬手横扫 / 托举 / 捂脸），手指按手势弯曲；宽袖在 IK 之后按重力下垂。
   * - 尾巴：九条尾巴各三节，扇面内缓缓起伏（相位从根到尖传；正中主尾左右摆），随移动惯性甩开（弹簧），施法时两扇展开、主尾向后上方挺起，立冰壁时横扫。
   */
  private poseNative(n: NativeBody, dt: number, raise: number, sweep: number): void {
    const P = n.pose;
    P.reset();
    const t = this.age;
    const sf = Math.sin(this.facing), cf = Math.cos(this.facing);
    const vz = this.velocity.x * sf + this.velocity.z * cf, vx = this.velocity.x * cf - this.velocity.z * sf;
    const h = Math.max(dt, 1e-3);
    const az = ((this.velocity.x - this.prevVel.x) * sf + (this.velocity.z - this.prevVel.z) * cf) / h;
    const ax = ((this.velocity.x - this.prevVel.x) * cf - (this.velocity.z - this.prevVel.z) * sf) / h;
    this.prevVel.copy(this.velocity);
    this.lean.step(THREE.MathUtils.clamp(vz * 0.04, -0.15, 0.22), THREE.MathUtils.clamp(-vx * 0.04, -0.18, 0.18), dt);
    this.robe.step(THREE.MathUtils.clamp(-az * 0.012 - vz * 0.04, -0.4, 0.4), THREE.MathUtils.clamp(ax * 0.012 + vx * 0.04, -0.3, 0.3), dt);
    const offer = this.eOffer.x, guide = this.eGuide.x, scream = this.eScream.x, raiseW = this.eRaise.x;
    const calm = (1 - offer) * (1 - scream) * (1 - raiseW);
    const tremble = scream * Math.sin(t * 41) * 0.025;
    const breath = Math.sin(t * 1.4);

    // 身体
    P.rotate('hips', AX, this.lean.x);
    P.rotate('hips', AZ, this.lean.y + 0.03 * Math.sin(t * 0.7) * calm);
    P.rotate('spine', AX, 0.02 * breath - 0.08 * offer - 0.06 * raiseW + 0.1 * sweep);
    P.rotate('chest', AX, -this.hurtKick * 0.2 - 0.06 * offer + 0.12 * scream + 0.08 * sweep);
    P.rotate('chest', AZ, tremble);
    P.rotate('chest', AY, -0.15 * sweep + 0.1 * raise * (raiseW > 0.1 ? 1 : 0));
    // 头：看向玩家（弹簧），施法仰头，哀鸣低头捂脸
    const pl = this.ctx.player.position;
    const dyaw = wrapAngle(Math.atan2(pl.x - this.position.x, pl.z - this.position.z) - this.facing);
    this.headYaw.step(THREE.MathUtils.clamp(dyaw, -0.7, 0.7) * (1 - scream), 0, dt);
    P.rotate('neck', AY, this.headYaw.x * 0.45);
    P.rotate('head', AY, this.headYaw.x * 0.4);
    P.rotate('head', AZ, (0.08 * Math.sin(t * 0.5)) * calm + tremble);
    P.rotate('neck', AX, -0.1 * offer - 0.12 * raiseW + 0.25 * scream + 0.05 * guide);
    P.rotate('head', AX, -0.08 * offer - 0.1 * raiseW + 0.2 * scream - 0.04 * breath * calm);

    // 腿：趾行小步（大腿前后摆、跖骨抬起），站定时重心轻轻左右换
    const ph = this.walkPhase, amp = this.walkAmp;
    for (let i = 0; i < 2; i++) {
      const s = BN[i === 0 ? 'L' : 'R'];
      const sw = Math.sin(ph + i * Math.PI), lift = Math.max(0, Math.cos(ph + i * Math.PI));
      P.rotate(s.thigh, AX, -0.42 * amp * sw - 0.06 * lift * amp + this.lean.x * 0.3);
      P.rotate(s.shin, AX, 0.5 * amp * lift);
      P.rotate(s.foot, AX, -0.45 * amp * lift);
      P.rotate(s.toe, AX, 0.3 * amp * lift);
    }
    // 深衣：前片跟着往前迈的腿，后片跟着往后蹬的腿，再叠惯性和轻摆
    const fwd = Math.max(0, Math.sin(ph), Math.sin(ph + Math.PI)) * amp;
    const flutter = (k: number): number => 0.035 * Math.sin(t * 1.5 + k * 1.3);
    P.rotate('robe_F1', AX, -0.35 * fwd + Math.min(0.05, this.robe.x) + flutter(0));
    P.rotate('robe_F2', AX, this.robe.x * 0.5 + flutter(1));
    P.rotate('robe_B1', AX, 0.3 * fwd + Math.max(-0.05, this.robe.x) + flutter(2));
    P.rotate('robe_B2', AX, this.robe.x * 0.5 + flutter(3));
    for (let j = 0; j < 2; j++) {
      const s = BN[j === 0 ? 'L' : 'R'], m = j === 0 ? 1 : -1;
      P.rotate(s.robe1, AZ, m * Math.max(-0.05, this.robe.y * m) + flutter(4) * m);
      P.rotate(s.robe2, AZ, this.robe.y * 0.5 + flutter(5) * m);
      P.rotate(s.robe1, AX, this.robe.x * 0.4);
    }

    // 双手
    const kk = 1 - Math.exp(-12 * dt);
    for (const hs of this.hands) {
      const left = hs.side === 'L', m = left ? 1 : -1, bn = BN[hs.side];
      const v3 = (a: readonly number[], out: THREE.Vector3): THREE.Vector3 => out.set(a[0] * m, a[1], a[2]);
      _t.copy(v3(HAND.relax, _h1));
      _t.y += 0.015 * breath;
      // 剑指引镜：右手（主手）停在镜侧，左手微抬
      if (guide > 0.001) {
        if (!left) _t.lerp(v3(HAND.guide, _h2), guide);
        else _t.lerp(_h2.set(0.36, 1.0, 0.3), guide * 0.6);
      }
      if (raiseW > 0.001) _t.lerp(v3(HAND.raise, _h2), raiseW * (1 - sweep));
      if (sweep > 0.001) _t.lerp(v3(HAND.sweep, _h2), sweep);
      if (offer > 0.001) _t.lerp(v3(HAND.offer, _h2).add(_h3.set(0, 0.04 * Math.sin(t * 3 + (left ? 0 : 1.5)), 0)), offer);
      if (scream > 0.001) _t.lerp(v3(HAND.cover, _h2), scream);
      hs.target.lerp(_t, kk);
      P.twoBoneIK(bn.arm, bn.forearm, bn.hand, hs.target, 0);
      this.swivelElbow(P, hs.side, m);
      // 手势
      for (let f = 0; f < 5; f++) {
        let goal = GESTURE.relax[f];
        if (!left) goal = mix(goal, GESTURE.sword[f], guide);
        else goal = mix(goal, GESTURE.offer[f], guide * 0.6);
        goal = mix(goal, GESTURE.splay[f], raiseW * (1 - sweep));
        goal = mix(goal, GESTURE.offer[f], Math.max(offer, sweep));
        goal = mix(goal, GESTURE.claw[f] + Math.sin(t * 37 + f) * 0.05, scream);
        hs.curl[f] = mix(hs.curl[f], goal, kk);
        const c = hs.curl[f], axis = hs.axes[f], thumb = f === 0;
        P.rotate(bn.finger1[f], axis, c * (thumb ? 0.55 : 0.8));
        P.rotate(bn.finger2[f], axis, c * (thumb ? 0.6 : 1.0));
      }
      // 宽袖：IK 之后按重力下垂，再叠一点惯性和飘动
      for (let i = 0; i < 2; i++) {
        const name = bn.sleeve[i];
        if (!P.has(name)) continue;
        const a = P.hostPosition(name, _h1);
        const child = i === 0 ? bn.sleeve[1] : null;
        const cur = child ? P.hostPosition(child, _h2).sub(a) : a.sub(P.hostPosition(bn.sleeve[0], _h2));
        if (cur.lengthSq() < 1e-8) continue;
        cur.normalize();
        const goal = _h3.set(0.25 * this.robe.y + 0.05 * Math.sin(t * 1.3 + i) + 0.12 * m, -1, -0.3 * this.robe.x + 0.04 * Math.sin(t * 1.7 + i)).normalize();
        const axis = _h4.crossVectors(cur, goal);
        const sin = axis.length();
        if (sin < 1e-5) continue;
        P.rotateCurrent(name, axis.divideScalar(sin), Math.atan2(sin, cur.dot(goal)) * 0.85);
      }
    }

    // 尾巴：尾根整体随立冰壁横扫；每条尾巴三节，扇面内的起伏 + 惯性 + 展开
    P.rotate('tail_root', AY, 0.7 * Math.sin(Math.PI * sweep) * (raiseW > 0.05 ? 1 : 0));
    P.rotate('tail_root', AX, -0.25 * raiseW * (1 - sweep) + 0.12 * this.eScream.x);
    const flare = this.eFlare.x;
    for (const tl of this.tails) {
      // 惯性：横移时整扇往反方向甩，前进时尾巴往后拖、后退时往前卷（弹簧，慢半拍、会过冲）
      tl.sway.step(THREE.MathUtils.clamp(vx * 0.06 + ax * 0.004, -0.5, 0.5), THREE.MathUtils.clamp(-vz * 0.05 - az * 0.004, -0.45, 0.45), dt);
      // 两扇在扇面里张开；正中的主尾不往两边张，而是向后上方挺起（卷曲轴上的负方向 = 向后）
      const center = tl.side === 0;
      const spread = center ? 0 : (tl.phi - 0.45) * 0.35 * flare;
      const lift = center ? -0.45 * flare : 0;
      for (let k = 0; k < 3; k++) {
        const w = TAIL_SEG_W[k];
        const wave = 0.07 * Math.sin(t * 1.5 - k * 0.8 + tl.seed) + tremble * 4;
        const bob = 0.06 * Math.sin(t * 1.1 - k * 0.7 + tl.seed * 1.7);
        // 主尾的起伏是左右摆（绕前后轴），幅度和两扇一样
        P.rotate(tl.bones[k], AZ, tl.side * spread * (k === 0 ? 1 : 0.3) + (tl.side || 1) * wave * w * 2 + tl.sway.x * w);
        P.rotate(tl.bones[k], tl.curlAxis, (bob + tl.sway.y) * w * 1.6 + (0.12 * flare + lift) * w + 0.2 * this.eGuide.x * w);
      }
    }
  }

  /** 绕「肩 → 腕」轴转整条手臂，把手肘摆到自然的下外侧略靠后（腕的位置不变） */
  private swivelElbow(P: NativePose, side: Side, m: number): void {
    const bn = BN[side];
    const sh = P.hostPosition(bn.arm, _s1);
    const el = P.hostPosition(bn.forearm, _s2);
    const axis = P.hostPosition(bn.hand, _s3).sub(sh);
    const len = axis.length();
    if (len < 1e-4) return;
    axis.divideScalar(len);
    const e = el.sub(sh);
    e.addScaledVector(axis, -e.dot(axis));
    const pole = _s4.set(0.7 * m, -1, -0.35);
    pole.addScaledVector(axis, -pole.dot(axis));
    if (e.lengthSq() < 1e-8 || pole.lengthSq() < 1e-8) return;
    e.normalize();
    pole.normalize();
    P.rotateCurrent(bn.arm, axis, Math.atan2(axis.dot(_q.crossVectors(e, pole)), e.dot(pole)));
  }

  /** 程序化白模（?classic 或资产未就绪）：九尾扇起伏、手臂按姿势抬放、头看向玩家 */
  private poseClassic(dt: number, raise: number, sweep: number): void {
    const t = this.age;
    const flare = this.eFlare.x;
    for (let i = 0; i < this.classicTails.length; i++) {
      const tj = this.classicTails[i];
      const a = -Math.PI * 0.42 + (i / 8) * Math.PI * 0.84;
      tj.rotation.set(-0.35 - 0.1 * Math.sin(t * 1.2 + i), 0.5 * Math.sin(Math.PI * sweep), a * (1 + 0.3 * flare) + 0.06 * Math.sin(t * 1.5 + i * 0.9));
    }
    const up = Math.max(this.eRaise.x * (1 - sweep), this.eOffer.x * 0.7, this.eScream.x);
    for (let j = 0; j < this.classicArms.length; j++) {
      const s = j === 0 ? 1 : -1;
      const arm = this.classicArms[j];
      arm.rotation.z = s * mix(-0.65, 0.4, up) + s * 0.03 * Math.sin(t * 1.4);
      arm.rotation.y = s * -0.6 * (j === 1 ? this.eGuide.x : 0) - s * 0.4 * this.eOffer.x;
    }
    const pl = this.ctx.player.position;
    const dyaw = wrapAngle(Math.atan2(pl.x - this.position.x, pl.z - this.position.z) - this.facing);
    this.classicHead.rotation.set(-0.1 * raise + 0.25 * this.eScream.x, THREE.MathUtils.clamp(dyaw, -0.6, 0.6), 0);
    this.body.rotation.x = 0.08 * sweep - this.hurtKick * 0.2;
    void dt;
  }

  /** 霜甲冰壳跟着同伴走（每帧只由一只狐巫更新一次） */
  private updateFx(dt: number): void {
    const ctx = this.ctx;
    if (shellFrame === ctx.time.frame) return;
    shellFrame = ctx.time.frame;
    for (const [e, s] of armorShells) {
      if (!e.alive) {
        releaseShell(ctx, e, false);
        continue;
      }
      s.show = Math.min(1, s.show + dt / 0.35);
      s.place(e.position, Math.max(0.5, e.radius), Math.max(1, e.height), this.age + e.position.x);
    }
  }
}

// ───────────── 冰壁 ─────────────

const _wa = new THREE.Vector3();
let wallMatTemplate: THREE.MeshStandardMaterial | null = null;

/**
 * 狐巫立起的冰壁：一排多面体冰柱，从地下 0.4 秒升起。碰撞体是 CollisionWorld 里的一排轴对齐盒（公开接口 addBox / remove），
 * 挡玩家、挡敌人、挡子弹和视线（导航网格按 world.version 自动重建）。150 血，可打碎；12 秒后自己崩解；
 * 召唤它的狐巫死了随之碎掉。自己崩解 / 随主人碎掉不算击杀（不掉落、不触发击杀事件）。
 */
export class FoxIceWall extends EnemyBase {
  owner: FoxWitch | null = null;
  private readonly boxes: StaticBox[] = [];
  private life: number = WALL.life;
  /** 已经因主人死亡缩短过寿命（只缩一次） */
  private ownerLost = false;
  private raised = false;
  private crack = 0;
  private iceMats: THREE.MeshStandardMaterial[] = [];

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, ICE_WALL_DEF, opts);
    this.spawnDuration = 0.01;
    this.deathDuration = 0.45;
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    if (!wallMatTemplate) {
      wallMatTemplate = new THREE.MeshStandardMaterial({
        color: C.ice, emissive: 0x2f7fb8, emissiveIntensity: 0.35, roughness: 0.18, metalness: 0.05,
        transparent: true, opacity: 0.86, flatShading: true,
      });
    }
    for (const g of iceWallGeometry(WALL.width, WALL.height, WALL.thick)) root.add(new THREE.Mesh(g, wallMatTemplate));
    return root;
  }

  /** 生成后立刻调用：朝向（墙面朝玩家）、碰撞盒；和玩家 / 其他敌人重叠的那一段不加碰撞（不把人关进墙里） */
  raise(owner: FoxWitch | null, yaw: number): void {
    const ctx = this.ctx;
    this.owner = owner;
    this.facing = yaw;
    this.root.rotation.y = yaw;
    this.flyTargetY = this.position.y;
    this.velocity.set(0, 0, 0);
    this.raised = true;
    this.iceMats = this.clonedMats.filter((m): m is THREE.MeshStandardMaterial => (m as THREE.MeshStandardMaterial).isMeshStandardMaterial);
    const pl = ctx.player;
    for (const b of iceWallBoxes(this.position.x, this.position.y, this.position.z, yaw)) {
      if (overlapsBody(b, pl.position, pl.radius, pl.height)) continue;
      let blocked = false;
      for (const e of ctx.enemies.list) {
        if (e === this || !e.alive || e.flying || e.def.id === ICE_WALL_ID) continue;
        if (overlapsBody(b, e.position, e.radius * 0.85, e.height)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      this.boxes.push(ctx.world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 'cover'));
    }
    _wa.set(this.position.x, this.position.y + 0.1, this.position.z);
    ctx.fx.ring(_wa, WALL.width * 0.6, C.frost, 0.5);
    ctx.fx.burst(_wa, C.ice, 24, 4, 0.7, 0.09, 6);
    ctx.fx.shake(0.15, 0.2);
  }

  /** 冰壁当前的碰撞盒数量（测试用） */
  get boxCount(): number {
    return this.boxes.length;
  }

  protected override think(dt: number): void {
    this.velocity.set(0, 0, 0);
    this.life -= dt;
    // 主人死了：只在第一次发现时把剩余寿命缩到 0.35–0.6 秒（错开几道墙的碎裂）。
    // 不能每帧重掷——旧写法每帧都会把 life 重置回 >0.35，碎裂被无限期推迟（测试偶发失败的根因）。
    if (this.owner && !this.owner.alive && !this.ownerLost) {
      this.ownerLost = true;
      this.life = Math.min(this.life, this.ctx.rng.range(0.35, 0.6));
    }
    if (this.life <= 0) this.expire();
  }

  protected override animate(dt: number): void {
    // 从地下升起（0.4 秒，缓出），最后 2 秒开始发白、裂开；受伤越多裂纹越亮
    const rise = smooth(this.age / 0.4);
    this.model.position.y = -(1 - rise) * WALL.height;
    this.crack = Math.max(this.crack, 1 - this.hp / Math.max(1, this.maxHp));
    const old = clamp01(1 - this.life / 2);
    for (const m of this.iceMats) {
      if (this.flashTimer > 0) continue;
      m.emissiveIntensity = 0.35 + 0.5 * this.crack + 0.4 * old * (0.5 + 0.5 * Math.sin(this.age * 12));
      m.opacity = 0.86 - 0.25 * old;
    }
    void dt;
  }

  /** 射线：直接对碰撞盒求交（盒子略微放大，保证子弹先打到墙体本身而不是同位置的碰撞世界盒） */
  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive) return false;
    const lift = this.model.position.y;
    let best = Infinity;
    const list = this.boxes.length ? this.boxes : iceWallBoxes(this.position.x, this.position.y, this.position.z, this.facing);
    for (const b of list) {
      const t = rayBox(origin, dir, b.minX - 0.03, b.minY + lift, b.minZ - 0.03, b.maxX + 0.03, b.maxY + lift + 0.03, b.maxZ + 0.03);
      if (t >= 0 && t < best) best = t;
    }
    if (best > maxDist) return false;
    out.distance = best;
    out.headshot = false;
    return true;
  }

  /** 到时 / 主人死亡：自己崩解（不经过战斗结算，没有击杀事件和掉落） */
  expire(): void {
    if (!this.alive) return;
    this.onKilled({ request: { base: 0, element: 'none', source: 'status' } } as unknown as DamageResult);
  }

  protected override onDeath(_r: DamageResult): void {
    this.removeBoxes();
    const ctx = this.ctx;
    if (attackDirector.purging) return;
    _wa.set(this.position.x, this.position.y + WALL.height * 0.5, this.position.z);
    ctx.fx.burst(_wa, C.ice, 36, 5, 0.9, 0.1, 12);
    ctx.fx.burst(_wa, C.iceHot, 12, 3, 0.4, 0.06, 4);
    ctx.audio.play('shield_break', { position: _wa, volume: 0.8, pitch: 1.1 });
  }

  protected override animateDeath(t: number): void {
    // 碎裂：往下塌、向四周散开（缩小），很快消失
    this.velocity.set(0, 0, 0);
    this.model.position.y = -t * t * WALL.height * 0.6;
    this.model.scale.set(1 + 0.3 * t, Math.max(0.01, 1 - t), 1 + 0.3 * t);
  }

  protected override onDispose(): void {
    this.removeBoxes();
  }

  private removeBoxes(): void {
    for (const b of this.boxes) this.ctx.world.remove(b);
    this.boxes.length = 0;
  }
}

function overlapsBody(b: { minX: number; minZ: number; maxX: number; maxZ: number; minY: number; maxY: number }, feet: THREE.Vector3, r: number, h: number): boolean {
  return feet.x + r > b.minX && feet.x - r < b.maxX && feet.z + r > b.minZ && feet.z - r < b.maxZ && feet.y + h > b.minY && feet.y < b.maxY;
}

/** 射线与轴对齐盒（slab 法）；起点在盒内返回 0，不相交返回 -1 */
function rayBox(o: THREE.Vector3, d: THREE.Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let tmin = 0, tmax = Infinity;
  const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z], lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-9) {
      if (os[i] < lo[i] || os[i] > hi[i]) return -1;
      continue;
    }
    let a = (lo[i] - os[i]) / ds[i], b = (hi[i] - os[i]) / ds[i];
    if (a > b) [a, b] = [b, a];
    tmin = Math.max(tmin, a);
    tmax = Math.min(tmax, b);
    if (tmin > tmax) return -1;
  }
  return tmin;
}
