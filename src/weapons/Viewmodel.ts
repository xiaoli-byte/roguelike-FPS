/**
 * 第一人称武器模型：挂在 ctx.viewCamera 下（相机在原点朝 −Z），右下持枪。
 *
 * 姿态照 Unity FirstPersonViewmodel.cs（M10）：幅度沿用 Three.js 原值，跟随改成弹簧阻尼（子步 1/240 s），按枪重放慢：
 *   · 腰射 ↔ 开镜：按开镜程度的 smoothstep 混合；呼吸、行走摆动（开镜收到 15%，× 摆动倍率 / √枪重）；
 *   · 鼠标滞后：鼠标速度换成 60 帧当量，弹簧 ω 14 / ζ 0.62（带一点回弹）；侧倾 / 前后 / 竖直滞后各一个弹簧；
 *   · 落地：按下落速度给竖直弹簧一个向下的冲量（ζ 0.42，压下去再弹一下）；起跳轻轻往上一抬；冲刺 / 滞空姿态；
 *   · 后坐：每发叠加（上限单发 2.4 倍，WeaponSystem 按 Unity ViewKickScale 0.55 × VM_SCALE 0.76 缩）、按枪重指数回位，
 *     再过一个欠阻尼弹簧显示（回位末尾有一点回弹）；带一点随机横滚；持续开火颤动；空仓抖动；
 *   · 换弹：整匣换弹按包络叠本把的换弹姿态（WeaponHandling.tiltRot / tiltPos），弹匣入位（loadAt）那一刻枪身一顿；
 *     逐发装填整体姿态、每压一发往下一磕；切枪收放；技能出手的覆盖姿态（CastPose）。
 * 零件（Unity WeaponPartAnimator / TrinityCycle / RailgunCharge）：弹匣按本把的偏移 / 俯仰离位（管式装填塞进去后隐藏）、转轮每发一格并在换弹时甩出、
 *   泵动、转管、弩弦、三才转轮灵纹（换元素亮闪 FlashGain 0.9）、灵炮蓄力灵纹与枪口聚光。
 * 左手（Unity WeaponHandRig）：平时刚性跟着握点走（只让偏差衰减），换弹按 sampleLoadingHand 走送弹口 / 收尾点，弹匣入位时发加弹事件（onCommitLoad），
 *   前臂按两骨 IK 摆（TwoBoneIK：肩在相机左下方，前臂跟摆动 70%、最多 35°）。
 * 碎刃由 demonBlade/BladeView 负责（持刀姿态、三段斩、剑指、128 片碎刃、刀光），这里只叠通用摆动（Unity BladeView 的 Sway：枪重 0.85）。
 * 枪口火焰为加法混合精灵；武器场景里一个复用的 PointLight 照亮枪身。
 * 主场景不再放枪口点光源（主场景点光源数量会让所有受光材质的片元开销上升，集成阶段要求压缩）。
 */
import * as THREE from 'three';
import type { Element, GameContext, Rarity, WeaponInstance } from '../core/types';
import { ELEMENT_COLORS } from '../core/types';
import { clamp, clamp01, damp, DEG, lerp, TAU } from '../core/math';
import { getWeaponDef, type WeaponDef } from './WeaponDefs';
import { boxGeo, buildGunModel, getFlashTexture, setCrossbowString, solidMat, type GunModel, ART_GLOW, ART_GLOW_BASE } from './WeaponModels';
import { BladeView, createBladePoseInput, type BladePoseInput } from './demonBlade/BladeView';
import { AssetLibrary } from '../assets/AssetLibrary';
import { applyArtEnvironment } from '../assets/ArtEnvironment';
import { attachStaticPart } from '../assets/StaticAttachment';
import { BLADE_SWAY, WEAPON_HANDLING, isShellAction, magOut as profileMagOut, reloadEnvelope, sampleLoadingHand, type HandlingProfile, type HandPose } from './WeaponHandling';
import { HAND_IK, solveTwoBone } from './TwoBoneIK';
import { WEAPON_FEEL } from './FireControl';
import { addReloadBreech } from './ReloadBreech';
import { OriginalWeaponLibrary } from '../assets/OriginalWeaponLibrary';
import { OriginalRecoil, OriginalWeaponView } from './OriginalWeaponView';

export interface ViewmodelState {
  aimT: number;
  /** 切枪：0 = 正常持枪，1 = 完全收下 */
  lowerT: number;
  reloading: boolean;
  /** 换弹进度 0..1；逐发装填时为当前一发的进度 */
  reloadP: number;
  /** 逐发装填中 */
  shellMode: boolean;
  /** 逐发装填时，当前是否为本次换弹的第一发（之后各发从装填口起手） */
  firstShell: boolean;
  /** 逐发装填已经压进的发数（赤蛟霰铳的弹壳两管交替） */
  shellsInserted?: number;
  /** 持续开火（光束 / 机炮 / 蓄力中） */
  firing: boolean;
  /** 机炮转速 0..1；蓄力武器为蓄力进度 0..1 */
  spin: number;
  /** 狙击开镜，隐藏模型 */
  scoped: boolean;
  /** 距上次开火的秒数 */
  sinceShot: number;
  /** 弩上弦进度 0..1（1 = 已上弦） */
  cock: number;
  /** 元素轮转：下一发的元素（换弹中是换完的第一发；能量槽显示该元素色）；非轮转武器为 null */
  elementHint: Element | null;
  /** 元素轮转：弹巢进度（转轮对准下一发所在弹膛）；非轮转武器为 −1 */
  cycleIndex: number;
  /** 蓄力满了（灵纹快闪） */
  chargeFull?: boolean;

  /** 碎刃：控制器的姿态输入（WeaponSystem 每帧写入；其他武器为 null） */
  blade: BladePoseInput | null;
  /**
   * 技能出手的覆盖姿态（Unity FirstPersonViewmodel.OverlayPos / OverlayRot，player/CastPose 按技能播时间线）：
   * 位置（米）/ 旋转（弧度）直接叠在组合姿态上；没有时为 null
   */
  overlayPos?: { x: number; y: number; z: number } | null;
  overlayRot?: { x: number; y: number; z: number } | null;
}

/** ViewmodelState 默认值（WeaponSystem 持有一份并逐帧改写） */
export function createViewmodelState(): ViewmodelState {
  return {
    aimT: 0, lowerT: 0, reloading: false, reloadP: 0, shellMode: false, firstShell: true, shellsInserted: 0, firing: false, spin: 0, scoped: false, sinceShot: 99, cock: 1,
    elementHint: null, cycleIndex: -1, chargeFull: false,
    blade: null, overlayPos: null, overlayRot: null,
  };
}

interface VmEntry {
  uid: number;
  def: WeaponDef;
  gun: GunModel;
  /** 持握与换弹（碎刃 / 原版枪没有） */
  profile: HandlingProfile | null;
  /**
   * 弹匣入位那一顿的换弹进度（Unity WeaponRigFactory.Configure：vm.seatAt = profile.loadAt）。原版枪的 profile 置空了，但 Unity 的 Configure
   * 在原作分支清零换弹姿态之前就写了 seatAt，所以原版枪也按持握表的 loadAt（0.78）一顿；没有持握表的按 FirstPersonViewmodel 默认 0.8
   */
  seatAt: number;
  /** 枪重 / 晃动 / 摆动倍率（profile 或碎刃的 Sway） */
  weight: number;
  swayScale: number;
  bobScale: number;
  /** 本模型独享的能量槽材质（脉动） */
  energyMat: THREE.MeshBasicMaterial;
  /** 美术手臂的实例材质 */
  armMats: THREE.MeshStandardMaterial[];
  leftArm: THREE.Object3D | null;
  support: THREE.Vector3;
  loadOffset: THREE.Vector3;
  /** 逐发装填时手里实际可见的弹壳 / 双管弹药。 */
  rounds: THREE.Group | null;
  breech: THREE.Group | null;
  /** 赤蛟霰铳：膛口上方递进枪管的那一发（Unity BreakAction 的 reload.shell，枪模空间） */
  chamberShell: THREE.Mesh | null;
  ownedGeometry: THREE.BufferGeometry[];
  baseColor: THREE.Color;
  rarity: number;
  element: Element;
  magBase: THREE.Vector3;
  magRotX: number;
  pumpBase: number;
  original: OriginalWeaponView | null;
  recoil: OriginalRecoil | null;
  /** 碎刃的第一人称表现；其他武器为 null */
  blade: BladeView | null;
  // 左手（WeaponHandRig）：离握点的偏差、手型
  restOffset: THREE.Vector3;
  handRoll: number;
  handPitch: number;
  /** 三才转轮：灵纹正在显示的元素与亮闪 */
  shownNext: Element | null;
  cycleFlash: number;
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _tint = new THREE.Color();
const _axis = new THREE.Vector3();
const _euler = new THREE.Euler();
const _handPose: HandPose = { x: 0, y: 0, z: 0, roll: 0, pitch: 0 };
const _supportPoint: [number, number, number] = [0, 0, 0];
const _loadPoint: [number, number, number] = [0, 0, 0];
const _v2 = new THREE.Vector3();
const _h = new THREE.Vector3();
const _h0 = new THREE.Vector3();
const _e = new THREE.Vector3();
const _e0 = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qHand = new THREE.Quaternion();
const _shoulder = new THREE.Vector3(...HAND_IK.shoulder);
const _pole = new THREE.Vector3(...HAND_IK.pole);
/** 碎刃不在挥砍等状态时的默认姿态输入 */
const BLADE_IDLE = createBladePoseInput();

/**
 * 第一人称枪模相对建模尺寸的整体缩放（Unity PlayerFactory.ViewmodelScale）。
 * 开镜位置同步乘以该系数（相机原点处的等比缩放不改变投影），所以开镜画面与缩放前完全一致；
 * 腰射时枪模以握把为锚点缩小，并整体再往右下挪一点。
 */
export const VM_SCALE = 0.76;
/** 腰射锚点的额外右下偏移（相机空间，米；Unity WeaponRigFactory.HipShift） */
const HIP_SHIFT_X = 0.024;
const HIP_SHIFT_Y = -0.02;
/** 没有持握表时弹匣入位那一顿的进度（Unity FirstPersonViewmodel.seatAt 默认 0.8） */
export const SEAT_AT_DEFAULT = 0.8;
/**
 * 枪模后坐的整体缩放（Unity WeaponController.ViewKickScale）：镜头只轻轻上跳（RecoilScale 0.3，WeaponSystem），
 * 枪模保留明显的上抬（0.55）当作打击感；向后的距离再乘 VM_SCALE（枪模缩了）
 */
export const VIEW_KICK_SCALE = WEAPON_FEEL.ViewKickScale;

/** Unity FirstPersonViewmodel 的常数（Three.js 原值） */
export const VM_FEEL = {
  BobAmp: 0.011, BobRoll: 0.018, Breath: 0.0032, SwayAmount: 0.00042, SwayClampX: 0.05, SwayClampY: 0.04,
  RollPerSpeed: 0.009, RollClamp: 0.07, FwdPerSpeed: 0.0022, FwdClamp: 0.02, VyPerSpeed: 0.0022, VyClamp: 0.03,
  LandPerSpeed: 0.0035, LandMax: 0.05, JumpLift: 0.012, KickCap: 2.4, SubStep: 1 / 240,
  /** 弹簧：鼠标滞后 ω 14 ζ 0.62；侧倾 9 / 0.8；前后 8 / 0.75；竖直 8 / 0.75；落地 11 / 0.42（ω 都按 √枪重放慢） */
  Sway: [14, 0.62], Roll: [9, 0.8], Fwd: [8, 0.75], Vy: [8, 0.75], Land: [11, 0.42],
  /** 后坐显示弹簧（不随枪重）：向后 42 / 0.55、上抬 40 / 0.55、横滚 36 / 0.6；回位速度 15 / 12 / 12 × 枪重^−0.3 */
  ShownZ: [42, 0.55], ShownRot: [40, 0.55], ShownRoll: [36, 0.6], RecZ: 15, RecRot: 12, RecRoll: 12,
} as const;

/** 三才转轮换元素的亮闪（Unity TrinityCycle.FlashGain / FlashDecay） */
export const TRINITY_FLASH = { gain: 0.9, decay: 14 } as const;
/** 灵炮满蓄色（物理元素时的蓄能色；同 Firing.FULL_CHARGE_GLOW / Unity Ballistics.FullChargeColor） */
const FULL_CHARGE_GLOW = 0xc9a8ff;

/**
 * 赤蛟霰铳的折开换弹（Unity BreakAction）：完全折开的角度（阻尼 10，同 shellT）；两根枪管的横向位置、膛口 z、弹壳长度（枪模坐标，Unity 的 x 取反）
 */
export const BREAK = { OpenAngle: 0.48, BoreX: 0.019, BoreY: 0.04, ChamberZ: -0.065, ShellLength: 0.052 } as const;

/** 弹壳位置（Unity BreakAction.ShellPose）：先停在膛口后上方（手把它递过来），这一发进度 55%–92% 滑进第 bore 根枪管（两管交替） */
export function breakShellPose(p: number, bore: number, out: THREE.Vector3): THREE.Vector3 {
  const x = (bore % 2 === 0 ? -1 : 1) * BREAK.BoreX;
  const t = smooth((p - 0.55) / 0.37);
  const heldY = BREAK.BoreY + 0.035, heldZ = BREAK.ChamberZ + 0.045;
  const inY = BREAK.BoreY, inZ = BREAK.ChamberZ - BREAK.ShellLength * 0.5;
  return out.set(x, heldY + (inY - heldY) * t, heldZ + (inZ - heldZ) * t);
}

/** 袖子底色：深色布料，只混入少量英雄主题色 */
const SLEEVE_BASE = 0x2b2a2f;
const SLEEVE_TINT = 0.3;

const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** 弹簧一步（半隐式欧拉，子步长 1/240 s；Unity FirstPersonViewmodel.Spring）。返回新的 [值, 速度] 写回 s 的 x / v */
export function springStep(s: { x: number; v: number }, target: number, omega: number, zeta: number, dt: number): void {
  const k = omega * omega, c = 2 * zeta * omega;
  for (let t = dt; t > 1e-6; t -= VM_FEEL.SubStep) {
    const h = Math.min(VM_FEEL.SubStep, t);
    s.v += (k * (target - s.x) - c * s.v) * h;
    s.x += s.v * h;
  }
}

const spring = (): { x: number; v: number } => ({ x: 0, v: 0 });

/** 三才转轮的灵纹亮度：呼吸 + 换元素亮闪（Unity TrinityCycle.Pulse） */
export function trinityPulse(time: number, flash: number): number {
  return 0.82 + 0.14 * Math.sin(time * 3) + TRINITY_FLASH.gain * clamp01(flash);
}

/** 灵炮蓄力的灵纹亮度（Unity RailgunCharge.Pulse） */
export function chargePulse(charge: number, full: boolean, time: number): number {
  return 0.8 + 0.7 * clamp01(charge) + (full ? Math.sin(time * 34) * 0.22 : Math.sin(time * 18) * 0.06);
}

/** 灵炮蓄力时枪口光球颜色的 HDR 倍率（Unity RailgunCharge.LateUpdate：Tint(orb, color × (1.5 + 1.5·charge) × a)） */
export function chargeOrbBoost(charge: number): number {
  return 1.5 + 1.5 * charge;
}

/**
 * 第一人称手套与袖子的材质。袖子是偏暗的布料色，只带一点英雄主题色倾向；主题色本身只用在袖口的一圈细滚边上，
 * 避免整条手臂变成一大块高饱和色块（例如赤狐的橙色）。dim < 1 时袖子再压暗（碎刃）。
 */
function armMaterials(heroColor: number, dim = 1): { glove: THREE.Material; cuff: THREE.Material; sleeve: THREE.Material; trim: THREE.Material } {
  const glove = solidMat(0x2e241e, 0.05, 0.9);
  const cuff = solidMat(0x1b1714, 0.1, 0.8);
  _c.setHex(SLEEVE_BASE).lerp(_tint.setHex(heroColor), SLEEVE_TINT).multiplyScalar(0.85 * dim);
  const sleeve = solidMat(_c.getHex(), 0.02, 0.92);
  _c.setHex(heroColor).multiplyScalar(0.62);
  const trim = solidMat(_c.getHex(), 0.1, 0.7);
  return { glove, cuff, sleeve, trim };
}

/** 往 parent 下加一块手臂方块 */
function armBox(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx: number, ry: number, rz = 0): void {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.name = 'arm';
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
}

/**
 * 程序化第一人称手臂（一侧）。分组名 arm_r / arm_l 也是美术资产（SM_Arms_<英雄><R|L>）的挂点名：
 * 右手在握把处，坐标就是枪模坐标（分组放在枪模原点）；左手以左手握点为原点（分组放到 gun.leftHand）。
 */
export function buildArm(side: 'r' | 'l', heroColor: number): THREE.Group {
  const { glove, cuff, sleeve, trim } = armMaterials(heroColor);
  const g = new THREE.Group();
  g.name = side === 'r' ? 'arm_r' : 'arm_l';
  const mk = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx: number, ry: number, rz = 0): void =>
    armBox(g, mat, w, h, d, x, y, z, rx, ry, rz);
  /** 袖口滚边：紧贴护腕、沿前臂方向后移一点的一圈细带 */
  const band = (size: number, x: number, y: number, z: number, rx: number, ry: number): void => {
    _axis.set(0, 0, 1).applyEuler(_euler.set(rx, ry, 0));
    mk(trim, size, size, 0.016, x + _axis.x * 0.03, y + _axis.y * 0.03, z + _axis.z * 0.03, rx, ry);
  };
  if (side === 'r') {
    // 右手：握把
    mk(glove, 0.052, 0.078, 0.07, 0.003, -0.05, 0.034, -0.3, 0);
    mk(glove, 0.018, 0.018, 0.045, -0.024, -0.008, 0.018, -0.2, 0.3);
    mk(cuff, 0.074, 0.074, 0.045, 0.024, -0.098, 0.1, 0.62, 0.38);
    band(0.078, 0.024, -0.098, 0.1, 0.62, 0.38);
    mk(sleeve, 0.07, 0.07, 0.34, 0.075, -0.165, 0.2, 0.62, 0.38);
  } else {
    // 左手：护木 / 前握把（以握点为原点）
    mk(glove, 0.054, 0.046, 0.085, -0.006, -0.022, 0, 0, 0);
    mk(glove, 0.012, 0.03, 0.07, 0.03, -0.006, 0, 0, 0);
    mk(cuff, 0.072, 0.072, 0.045, -0.034, -0.068, 0.058, 0.6, -0.5);
    band(0.076, -0.034, -0.068, 0.058, 0.6, -0.5);
    mk(sleeve, 0.068, 0.068, 0.4, -0.094, -0.15, 0.162, 0.6, -0.5);
  }
  return g;
}

/**
 * 给枪模装上第一人称手臂（Unity WeaponRigFactory：右手在握把，左手在左手握点，横滚 = leftRoll）。
 * 该英雄有美术手臂资产（bind = fp / 英雄 id / arm_r|arm_l）时换上美术网格，返回它们的实例材质（换枪时释放）。
 */
function addArms(gun: GunModel, heroColor: number, heroId: string | undefined, renderer: THREE.WebGLRenderer, defId: string): { mats: THREE.MeshStandardMaterial[] } {
  const r = gun.root;
  const handling = WEAPON_HANDLING[defId];
  const right = buildArm('r', heroColor);
  if (handling) {
    right.position.fromArray(handling.right);
    right.rotation.x = handling.rightPitch;
  }
  r.add(right);
  if (gun.leftHand || handling?.support) {
    const left = buildArm('l', heroColor);
    if (gun.leftHand) {
      left.position.copy(gun.leftHand);
      if (gun.leftParent) {
        gun.leftParent.updateMatrix();
        left.position.applyMatrix4(gun.leftParent.matrix);
      }
    } else left.position.fromArray(handling.support!);
    left.rotation.z = handling?.leftRoll ?? 0;
    // 握点跟随泵动，但手不直接挂在泵上：换弹时可以独立离开护木。
    r.add(left);
  }
  const mats: THREE.MeshStandardMaterial[] = [];
  if (!heroId) return { mats };
  for (const asset of AssetLibrary.findAttachments('fp', heroId)) {
    const part = attachStaticPart(r, asset);
    if (!part) continue;
    for (const m of part.materials) {
      applyArtEnvironment(m, renderer);
      mats.push(m);
    }
    part.lod.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
  }
  return { mats };
}

/** 调试 / 测试读的姿态量（Unity FirstPersonViewmodel.LandOffset / ShownKick*、WeaponHandRig.Elbow / Swing、WeaponPartAnimator.MagOut） */
export interface ViewmodelDebug {
  land: number;
  kickBack: number;
  kickRot: number;
  reloadTilt: number;
  shellTilt: number;
  magOut: number;
  /** 左手离握点的距离（枪模空间，米） */
  handOffset: number;
  /** 前臂相对握持姿势的摆动（度） */
  forearmSwing: number;
  /** 本次整匣换弹发过加弹事件 */
  committed: boolean;
  /** 三才转轮：灵纹显示的元素与亮闪 */
  glowElement: Element | null;
  glowFlash: number;
  weight: number;
}

export class Viewmodel {
  /** 挂在 viewCamera 下 */
  readonly root = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly entries = new Map<number, VmEntry>();
  private cur: VmEntry | null = null;
  private visible = false;

  private readonly flash: THREE.Sprite;
  private readonly flashMat: THREE.SpriteMaterial;
  /** 武器场景枪口闪光（照亮枪身） */
  private readonly vmLight: THREE.PointLight;
  /** 弹匣入位的加弹事件（WeaponSystem.commitLoad；Unity WeaponHandRig → WeaponStateMachine.CommitLoad） */
  onCommitLoad: (() => void) | null = null;

  // 动画状态（Unity FirstPersonViewmodel）
  private bobPhase = 0;
  private move = 0;
  private dashT = 0;
  private airT = 0;
  private readonly swayX = spring();
  private readonly swayY = spring();
  private readonly roll = spring();
  private readonly fwd = spring();
  private readonly vy = spring();
  private readonly land = spring();
  private kickZ = 0;
  private kickRot = 0;
  private kickRoll = 0;
  private readonly shownZ = spring();
  private readonly shownRot = spring();
  private readonly shownRoll = spring();
  private jitterX = 0;
  private jitterY = 0;
  private reloadT = 0;
  private shellT = 0;
  private shellBump = 0;
  private prevReloadP = 0;
  // 零件（Unity WeaponPartAnimator）
  private magOut = 0;
  private cylAngle = 0;
  private cylTarget = 0;
  /** 换枪后第一帧把轮转武器的转轮直接对准当前弹膛 */
  private cylSnap = false;
  private rackT = 99;
  private flashT = 0;
  private flashDur = 0.05;
  private lightI = 0;
  private committed = false;
  private forearmSwing = 0;

  constructor(private readonly ctx: GameContext) {
    this.root.name = 'viewmodel';
    this.root.add(this.pivot);
    this.root.visible = false;
    this.flashMat = new THREE.SpriteMaterial({
      map: getFlashTexture(),
      color: 0xffc070,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.flash = new THREE.Sprite(this.flashMat);
    // 略微置于枪口前方，减少被枪管遮挡
    this.flash.position.set(0, 0, -0.04);
    this.flash.visible = false;
    this.flash.renderOrder = 10;
    this.vmLight = new THREE.PointLight(0xffc080, 0, 1.4, 2);
    this.root.add(this.vmLight);
  }

  init(): void {
    this.ctx.viewCamera.add(this.root);
    this.ctx.events.on('player:landed', ({ fallSpeed }) => this.landImpulse(fallSpeed));
    this.ctx.events.on('player:jumped', () => {
      this.land.v -= VM_FEEL.JumpLift * this.omega(VM_FEEL.Land[0]) * 1.6;
    });
    // 暂停 / 模态框期间武器场景仍在渲染但不再更新：别让一帧枪口火焰定格在菜单底下
    this.ctx.events.on('game:stateChanged', ({ to }) => {
      if (to !== 'playing') this.killFlash();
    });
  }

  get currentUid(): number {
    return this.cur ? this.cur.uid : -1;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.visible = v && !!this.cur;
    if (!v) this.killFlash();
  }

  /** 切换显示的武器（同一把直接返回） */
  setWeapon(inst: WeaponInstance | null): void {
    if (!inst) {
      if (this.cur) this.pivot.remove(this.cur.gun.root);
      this.cur = null;
      return;
    }
    if (this.cur && this.cur.uid === inst.uid) return;
    if (this.cur) this.pivot.remove(this.cur.gun.root);
    let e = this.entries.get(inst.uid);
    if (!e) {
      e = this.build(inst);
      this.entries.set(inst.uid, e);
      this.upgradeWhenSynced(e, inst);
      this.upgradeWhenArt(e, inst);
    }
    this.cur = e;
    this.pivot.add(e.gun.root);
    e.gun.muzzle.add(this.flash);
    this.flash.visible = false;
    this.cylAngle = this.cylTarget = 0;
    this.cylSnap = true;
    this.magOut = 0;
    this.reloadT = 0;
    this.shellT = 0;
    this.committed = false;
    // 收起来的枪下次掏出时不带着上一把的残余动作（Unity FirstPersonViewmodel.OnDisable）
    this.kickZ = this.kickRot = this.kickRoll = 0;
    this.shownZ.x = this.shownZ.v = this.shownRot.x = this.shownRot.v = this.shownRoll.x = this.shownRoll.v = 0;
    this.land.x = this.land.v = 0;
    this.shellBump = 0;
    e.restOffset.set(0, 0, 0);
    e.shownNext = null;
    e.cycleFlash = 0;
    if (e.gun.cylinder) e.gun.cylinder.rotation.z = 0;
    e.blade?.resetAnim();
  }

  private upgradeWhenSynced(entry: VmEntry, inst: WeaponInstance): void {
    const pending = OriginalWeaponLibrary.get(inst.defId);
    if (!pending) return;
    void pending.then((asset) => {
      if (!asset || this.entries.get(inst.uid) !== entry || (entry.original && entry.recoil)) return;
      this.rebuild(entry, inst);
    });
  }

  /**
   * 美术枪模按需读（AssetLibrary 的 weapons 范围）：捡起来的枪还没读到美术时先用程序化枪模，读到后原地重建。
   * 用原生枪模（OriginalWeaponLibrary）的不管
   */
  private upgradeWhenArt(entry: VmEntry, inst: WeaponInstance): void {
    if (entry.original || AssetLibrary.findBound('weapon', inst.defId) || !AssetLibrary.request('weapon', inst.defId)) return;
    void AssetLibrary.ensureBound('weapon', [inst.defId]).then(() => {
      if (this.entries.get(inst.uid) !== entry || entry.original || !AssetLibrary.findBound('weapon', inst.defId)) return;
      this.rebuild(entry, inst);
    });
  }

  private rebuild(entry: VmEntry, inst: WeaponInstance): void {
    const current = this.cur === entry;
    this.disposeEntry(entry);
    const upgraded = this.build(inst);
    this.entries.set(inst.uid, upgraded);
    if (current) {
      this.cur = upgraded;
      this.pivot.add(upgraded.gun.root);
      upgraded.gun.muzzle.add(this.flash);
      this.flash.visible = false;
    }
  }

  /** 释放不再持有的武器模型 */
  prune(keep: readonly (WeaponInstance | null)[]): void {
    for (const [uid, e] of this.entries) {
      if (e === this.cur) continue;
      if (keep.some((w) => w !== null && w.uid === uid)) continue;
      this.disposeEntry(e);
      this.entries.delete(uid);
    }
  }

  /** 丢弃全部缓存模型（新开一局，英雄袖色可能变化） */
  resetModels(): void {
    if (this.cur) this.pivot.remove(this.cur.gun.root);
    this.cur = null;
    for (const e of this.entries.values()) this.disposeEntry(e);
    this.entries.clear();
    this.clearTransient();
  }

  /** 清空瞬时动画（换关 / 开局） */
  clearTransient(): void {
    this.kickZ = this.kickRot = this.kickRoll = 0;
    for (const s of [this.shownZ, this.shownRot, this.shownRoll, this.land, this.vy]) s.x = s.v = 0;
    this.reloadT = this.magOut = this.shellT = this.shellBump = 0;
    this.rackT = 99;
    this.committed = false;
    this.killFlash();
    this.cur?.recoil?.reset();
    this.cur?.blade?.resetAnim();
  }

  /** 当前显示的碎刃（第一人称）；不是碎刃时为 null */
  bladeView(): BladeView | null {
    return this.cur?.blade ?? null;
  }

  /** 调试 / 测试读的姿态量 */
  debug(): ViewmodelDebug {
    const e = this.cur;
    return {
      land: this.land.x, kickBack: this.shownZ.x, kickRot: this.shownRot.x, reloadTilt: this.reloadT, shellTilt: this.shellT,
      magOut: this.magOut, handOffset: e?.leftArm ? e.leftArm.position.distanceTo(e.support) : 0, forearmSwing: this.forearmSwing,
      committed: this.committed, glowElement: e?.shownNext ?? null, glowFlash: e?.cycleFlash ?? 0, weight: e?.weight ?? 1,
    };
  }

  private killFlash(): void {
    this.flashT = 0;
    this.lightI = 0;
    this.flash.visible = false;
    this.vmLight.intensity = 0;
  }

  private disposeEntry(e: VmEntry): void {
    e.gun.root.removeFromParent();
    if (this.flash.parent && this.flash.parent === e.gun.muzzle) e.gun.muzzle.remove(this.flash);
    e.energyMat.dispose();
    e.gun.artGlow?.dispose(); // 美术枪模、美术手臂的实例材质（贴图共享，不在这里释放）
    for (const m of e.armMats) m.dispose();
    for (const g of e.ownedGeometry) g.dispose();
    e.original?.dispose();
    e.blade?.dispose();
  }

  private build(inst: WeaponInstance): VmEntry {
    const def = getWeaponDef(inst.defId);
    if (def.blade) return this.buildBlade(inst);
    const gun = buildGunModel(inst.defId, inst.rarity, inst.element);
    const base = new THREE.Color(ELEMENT_COLORS[inst.element]);
    const energyMat = new THREE.MeshBasicMaterial({ color: base.clone(), toneMapped: false });
    for (const m of gun.energy) m.material = energyMat;
    const synced = OriginalWeaponLibrary.loaded(def.id);
    let original: OriginalWeaponView | null = null;
    if (synced?.gltf) {
      original = new OriginalWeaponView(synced, this.ctx.renderer, def.reloadTime);
      for (const child of gun.root.children) child.visible = false;
      gun.root.add(original.root);
      gun.muzzle = original.muzzle;
      gun.mag = gun.cylinder = gun.spinner = gun.pump = null;
    }
    const arms = original ? { mats: [] } : addArms(gun, this.ctx.player.hero?.color ?? 0x5a6a7a, this.ctx.player.hero?.id, this.ctx.renderer, def.id);
    const leftArm = original ? null : gun.root.getObjectByName('arm_l') ?? null;
    const support = leftArm?.position.clone() ?? new THREE.Vector3();
    const profile = WEAPON_HANDLING[def.id] ?? null;
    const loadOffset = new THREE.Vector3().fromArray(profile?.load ?? [0, 0, 0]);
    if (gun.mag) {
      gun.root.updateMatrixWorld(true);
      gun.mag.getWorldPosition(_v);
      gun.root.worldToLocal(_v);
      loadOffset.sub(_v);
    }
    let rounds: THREE.Group | null = null;
    let breech: THREE.Group | null = null;
    const ownedGeometry: THREE.BufferGeometry[] = [];
    let chamberShell: THREE.Mesh | null = null;
    // 逐发装填手里的那一发（Unity WeaponHandRig：只有泵动霰弹枪；赤蛟霰铳的弹壳由 BreakAction 画在膛口）
    if (leftArm && profile?.action === 'shell') {
      rounds = new THREE.Group();
      rounds.name = 'reload.rounds';
      const shell = new THREE.Mesh(boxGeo(0.013, 0.013, BREAK.ShellLength), solidMat(0xb86b32, 0.4, 0.5));
      shell.position.set(0, 0.014, -0.025);
      rounds.add(shell);
      rounds.visible = false;
      leftArm.add(rounds);
    }
    if (def.id === 'magmashot') {
      breech = addReloadBreech(gun.root, ownedGeometry);
      chamberShell = new THREE.Mesh(boxGeo(0.013, 0.013, BREAK.ShellLength), solidMat(0xb86b32, 0.4, 0.5));
      chamberShell.name = 'reload.shell';
      chamberShell.visible = false;
      gun.root.add(chamberShell);
    }
    gun.root.scale.setScalar(original ? 1 : VM_SCALE);
    gun.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    // 原版枪（GunfireOriginal，不迁）自己有换弹动画：不套换弹姿态、零件与左手（Unity WeaponRigFactory 的 original 分支）
    const handling = original ? null : profile;
    return {
      uid: inst.uid,
      def,
      gun,
      profile: handling,
      seatAt: profile?.loadAt ?? SEAT_AT_DEFAULT,
      weight: profile?.weight ?? 1, swayScale: profile?.swayScale ?? 1, bobScale: profile?.bobScale ?? 1,
      energyMat,
      armMats: arms.mats,
      leftArm, support, loadOffset, rounds, breech, chamberShell, ownedGeometry,
      baseColor: base,
      rarity: inst.rarity,
      element: inst.element,
      magBase: gun.mag ? gun.mag.position.clone() : new THREE.Vector3(),
      magRotX: gun.mag ? gun.mag.rotation.x : 0,
      pumpBase: gun.pump ? gun.pump.position.z : 0,
      original,
      recoil: synced ? new OriginalRecoil(synced.motion) : null,
      blade: null,
      restOffset: new THREE.Vector3(), handRoll: profile?.leftRoll ?? 0, handPitch: 0,
      shownNext: null, cycleFlash: 0,
    };
  }

  /** 碎刃：BladeView 自带刀模、双手与刀光；关键帧是相机空间的真实位置，不做 VM_SCALE 缩放 */
  private buildBlade(inst: WeaponInstance): VmEntry {
    const def = getWeaponDef(inst.defId);
    const view = new BladeView(this.ctx, this.ctx.player.hero?.color ?? 0x5a6a7a);
    view.onKick = (back, rot) => this.kick(back, rot);
    // 英雄的美术手臂：右手拳握刀柄、左手并掌作剑指（实例材质随刀模释放）
    const heroId = this.ctx.player.hero?.id;
    const armMats = heroId ? view.attachArtArms(AssetLibrary.findAttachments('fp', heroId), this.ctx.renderer) : [];
    const root = new THREE.Group();
    root.name = 'viewmodel.demonBlade';
    root.add(view.root);
    const gun: GunModel = {
      root, muzzle: view.model.tip, mag: null, cylinder: null, cylinderSteps: 6, spinner: null, pump: null, bolt: null,
      stringHalves: null, stringTip: null, energy: [], leftHand: null, leftParent: null, artGlow: null, blade: null,
    };
    return {
      uid: inst.uid, def, gun, profile: null, seatAt: SEAT_AT_DEFAULT,
      weight: BLADE_SWAY.weight, swayScale: BLADE_SWAY.swayScale, bobScale: BLADE_SWAY.bobScale,
      energyMat: new THREE.MeshBasicMaterial({ toneMapped: false }),
      armMats, leftArm: null, support: new THREE.Vector3(), loadOffset: new THREE.Vector3(), rounds: null, breech: null, chamberShell: null,
      ownedGeometry: [], baseColor: new THREE.Color(ELEMENT_COLORS[inst.element]), rarity: inst.rarity, element: inst.element,
      magBase: new THREE.Vector3(), magRotX: 0, pumpBase: 0,
      original: null, recoil: null,
      blade: view,
      restOffset: new THREE.Vector3(), handRoll: 0, handPitch: 0, shownNext: null, cycleFlash: 0,
    };
  }

  // ───────────── 事件 ─────────────

  /** 弹簧角频率按枪重放慢（Unity FirstPersonViewmodel.Omega） */
  private omega(w: number): number {
    return w / Math.sqrt(Math.max(0.3, this.cur?.weight ?? 1));
  }

  /** 落地冲量（下落速度 m/s）：压下 ≈ min(5 cm, 速度 × 0.0035) × 枪重^0.3，之后回弹（Unity FirstPersonViewmodel.Land） */
  landImpulse(fallSpeed: number): void {
    const w = Math.max(0.3, this.cur?.weight ?? 1);
    const d = Math.min(VM_FEEL.LandMax, Math.max(0, fallSpeed) * VM_FEEL.LandPerSpeed) * Math.pow(w, 0.3);
    this.land.v += d * this.omega(VM_FEEL.Land[0]) * 1.6;
  }

  /**
   * 枪模后坐（Unity FirstPersonViewmodel.Kick）：back 米（向后），rot 弧度（枪口上抬）。每发直接叠加、上限为单发的 2.4 倍，
   * 另加一点随机横滚；之后指数回位
   */
  kick(back: number, rot: number): void {
    this.kickZ = Math.min(this.kickZ + back, back * VM_FEEL.KickCap);
    this.kickRot = Math.min(this.kickRot + rot, rot * VM_FEEL.KickCap);
    this.kickRoll += (Math.random() - 0.5) * rot * 0.4;
  }

  /** 开火：后坐（× ViewKickScale；原版枪有自己的后坐运动时不叠）、枪口火焰、闪光、转轮一格 */
  onShot(def: WeaponDef, color: number, strength = 1): void {
    const e = this.cur;
    e?.original?.fire(strength >= 1);
    e?.recoil?.fire();
    if (!e?.recoil) this.kick(def.kick.back * VM_SCALE * VIEW_KICK_SCALE * strength, def.kick.rot * VIEW_KICK_SCALE * strength);
    if (e && e.gun.cylinder) this.cylTarget += TAU / e.gun.cylinderSteps;
    if (def.flash > 0) {
      // 强度 < 1（未蓄满的蓄力射击）时火焰与闪光相应减弱
      const sk = 0.5 + 0.5 * strength;
      this.flashDur = def.flash > 0.2 ? 0.07 : 0.05;
      this.flashT = this.flashDur;
      this.flash.scale.setScalar(def.flash * (0.8 + Math.random() * 0.45) * sk);
      this.flashMat.rotation = Math.random() * TAU;
      this.flashMat.color.setHex(color);
      this.vmLight.color.setHex(color);
      this.lightI = 1;
    }
  }

  /** 空仓扣扳机：枪口轻轻一挑 + 一点横滚抖动 */
  dryKick(): void {
    this.kickRot += 0.02;
    this.kickRoll += (Math.random() - 0.5) * 0.03;
  }

  /** 逐发装填压进一发：枪身往下一磕 */
  shellInserted(): void {
    this.shellBump = 1;
  }

  /** 霰弹：装填结束后上膛（泵动一次） */
  rack(): void {
    this.rackT = 0;
  }

  /** 弹匣入位的一顿（Unity FirstPersonViewmodel.Seat） */
  private seat(): void {
    this.kickRot -= 0.05;
    this.land.v += 0.01 * this.omega(VM_FEEL.Land[0]) * 1.6;
  }

  // ───────────── 每帧 ─────────────

  update(dt: number, s: ViewmodelState): void {
    const e = this.cur;
    this.root.visible = this.visible && !!e && !s.scoped;
    if (!e) {
      this.updateLights(dt, s);
      return;
    }
    const ctx = this.ctx;
    const p = ctx.player;
    const def = e.def;
    const time = ctx.time.now;
    const F = VM_FEEL;
    const isBlade = !!e.blade;
    // 碎刃的 Sway 不读开镜（Unity BladeView：Sway.aim 一直是 0）
    const a = isBlade ? 0 : smooth(s.aimT);
    const aimK = 1 - 0.85 * a, swayK = 1 - 0.6 * a;
    const W = Math.max(0.3, e.weight);

    // ── 行走摆动 / 呼吸 ──
    const vx = p.velocity.x, vz = p.velocity.z;
    const hs = Math.hypot(vx, vz);
    const grounded = p.onGround;
    this.move = damp(this.move, grounded ? clamp01(hs / 7.5) : 0, 10, dt);
    if (grounded) this.bobPhase += dt * hs * 1.55;
    const bob = e.bobScale / Math.sqrt(W);
    const bobX = Math.sin(this.bobPhase) * F.BobAmp * this.move * aimK * bob;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * F.BobAmp * this.move * aimK * bob;
    const bobRoll = Math.sin(this.bobPhase) * F.BobRoll * this.move * aimK * bob;
    const breath = Math.sin(time * 1.6) * F.Breath * aimK;

    // ── 鼠标滞后（弹簧，带回弹）：鼠标速度换成 60 帧当量 ──
    const inp = ctx.input;
    const mdx = inp.enabled ? inp.mouseDX : 0;
    const mdy = inp.enabled ? inp.mouseDY * (ctx.settings.invertY ? -1 : 1) : 0;
    const perFrame = dt > 1e-5 ? 1 / (60 * dt) : 0;
    const k = F.SwayAmount * e.swayScale;
    springStep(this.swayX, clamp(-mdx * perFrame * k, -F.SwayClampX, F.SwayClampX), this.omega(F.Sway[0]), F.Sway[1], dt);
    springStep(this.swayY, clamp(mdy * perFrame * k, -F.SwayClampY, F.SwayClampY), this.omega(F.Sway[0]), F.Sway[1], dt);

    // ── 侧倾 / 前后 / 竖直滞后、落地 ──
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const lateral = vx * cy - vz * sy;
    const forward = -vx * sy - vz * cy;
    springStep(this.roll, clamp(-lateral * F.RollPerSpeed, -F.RollClamp, F.RollClamp), this.omega(F.Roll[0]), F.Roll[1], dt);
    springStep(this.fwd, clamp(forward * F.FwdPerSpeed, -F.FwdClamp, F.FwdClamp), this.omega(F.Fwd[0]), F.Fwd[1], dt);
    springStep(this.vy, clamp(-p.velocity.y * F.VyPerSpeed, -F.VyClamp, F.VyClamp), this.omega(F.Vy[0]), F.Vy[1], dt);
    springStep(this.land, 0, this.omega(F.Land[0]), F.Land[1], dt);
    this.dashT = damp(this.dashT, p.isDashing ? 1 : 0, 14, dt);
    this.airT = damp(this.airT, grounded ? 0 : 1, 7, dt);

    // ── 后坐：指数回位（枪越重回得越慢），欠阻尼弹簧显示 ──
    const rec = 1 / Math.pow(W, 0.3);
    this.kickZ *= Math.exp(-F.RecZ * rec * dt);
    this.kickRot *= Math.exp(-F.RecRot * rec * dt);
    this.kickRoll *= Math.exp(-F.RecRoll * rec * dt);
    springStep(this.shownZ, this.kickZ, F.ShownZ[0], F.ShownZ[1], dt);
    springStep(this.shownRot, this.kickRot, F.ShownRot[0], F.ShownRot[1], dt);
    springStep(this.shownRoll, this.kickRoll, F.ShownRoll[0], F.ShownRoll[1], dt);
    this.shellBump = damp(this.shellBump, 0, 10, dt);

    // ── 换弹 ──
    const prof = e.profile;
    const fullReload = s.reloading && !s.shellMode;
    const rp = fullReload ? s.reloadP : 0;
    this.reloadT = damp(this.reloadT, fullReload ? reloadEnvelope(rp) : 0, 18, dt);
    this.shellT = damp(this.shellT, s.reloading && s.shellMode ? 1 : 0, 10, dt);
    const seatAt = e.seatAt;
    if (fullReload && this.prevReloadP < seatAt && rp >= seatAt) this.seat();
    if (!s.reloading) this.committed = false;
    this.prevReloadP = rp;

    // ── 开火颤动（光束 / 机炮 / 蓄力） ──
    if (s.firing && !isBlade) {
      const j = def.mode === 'charge' ? 0.0008 + 0.0026 * s.spin : 0.003;
      this.jitterX = (Math.random() - 0.5) * j;
      this.jitterY = (Math.random() - 0.5) * j;
    } else {
      const kj = 1 - Math.exp(-30 * dt);
      this.jitterX += (0 - this.jitterX) * kj;
      this.jitterY += (0 - this.jitterY) * kj;
    }

    // ── 组合（相机空间：x 右、y 上、z 朝后；rx + 枪口上抬、ry + 枪口左摆、rz + 右侧上翻）──
    e.recoil?.update(dt);
    const lowE = smooth(s.lowerT);
    let x = bobX + this.swayX.x * 0.5 * swayK + this.dashT * 0.015 + this.jitterX + (e.recoil?.position.x ?? 0);
    let y = bobY + breath + this.swayY.x * 0.5 * swayK + this.vy.x - this.land.x - lowE * 0.3 + this.shownZ.x * 0.15 - this.dashT * 0.02 + this.airT * 0.008
      + this.jitterY + (e.recoil?.position.y ?? 0);
    let z = this.shownZ.x + this.fwd.x + lowE * 0.05 + (e.recoil?.position.z ?? 0);
    let rx = this.shownRot.x + breath * 1.2 + this.swayY.x * swayK - lowE * 0.9 - this.dashT * 0.12 + this.airT * 0.05 + (e.recoil?.rotation.x ?? 0);
    let ry = -this.swayX.x * 1.3 * swayK + (e.recoil?.rotation.y ?? 0);
    let rz = this.roll.x * swayK + bobRoll + this.shownRoll.x - this.dashT * 0.3 + (e.recoil?.rotation.z ?? 0);

    // 换弹姿态：整匣按包络、逐发整体姿态（Unity WeaponRigFactory.Configure：shell 时写进 shellTilt）
    if (prof) {
      const shell = isShellAction(prof.action);
      const rt = shell ? 0 : this.reloadT, st = shell ? this.shellT : 0;
      const [tx, ty, tz] = prof.tiltPos, [trx, try_, trz] = prof.tiltRot;
      x += tx * (rt + st);
      y += ty * (rt + st);
      z += tz * (rt + st);
      rx += trx * (rt + st);
      ry += try_ * (rt + st);
      rz += trz * (rt + st);
    }
    y -= this.shellBump * 0.012;
    rx -= this.shellBump * 0.06;
    // 技能出手的覆盖姿态（CastPose）
    if (s.overlayPos) {
      x += s.overlayPos.x;
      y += s.overlayPos.y;
      z += s.overlayPos.z;
    }
    if (s.overlayRot) {
      rx += s.overlayRot.x;
      ry += s.overlayRot.y;
      rz += s.overlayRot.z;
    }
    // 腰射 ↔ 开镜（碎刃没有偏移：刀姿关键帧是相机空间的真实位置）
    let bx = 0, by = 0, bz = 0;
    if (!isBlade) {
      const hipX = e.original?.hip.x ?? def.viewOffset[0] + HIP_SHIFT_X;
      const hipY = e.original?.hip.y ?? def.viewOffset[1] + HIP_SHIFT_Y;
      const hipZ = e.original?.hip.z ?? def.viewOffset[2];
      const aimX = e.original?.aim.x ?? def.aimOffset[0] * VM_SCALE;
      const aimY = e.original?.aim.y ?? def.aimOffset[1] * VM_SCALE;
      const aimZ = e.original?.aim.z ?? def.aimOffset[2] * VM_SCALE;
      bx = lerp(hipX, aimX, a);
      by = lerp(hipY, aimY, a);
      bz = lerp(hipZ, aimZ, a);
    }
    const bl = e.blade;
    if (bl) bl.pose(dt, s.blade ?? BLADE_IDLE, this.realDt(dt));
    this.pivot.position.set(bx + x, by + y, bz + z);
    this.pivot.rotation.set(rx, ry, rz);
    if (bl) {
      this.pivot.updateMatrixWorld(true);
      bl.animate(dt, s.blade ?? BLADE_IDLE);
    }

    e.original?.update(dt, s);
    this.animateParts(dt, e, s, time);
    this.animateHands(dt, e, s);
    this.updateFlash(dt, e, s);
    this.updateLights(dt, s);
  }

  /**
   * 真实帧时长（顿帧里 dt 被时间缩放压小；Unity 碎刃视觉顿帧按 unscaledDeltaTime 走）。用 Game.frame 记下的 ctx.time.rawDt：
   * 不能拿 dt / 当前 timeScale 反推——dt 是帧开头按当时的缩放算的，碎刃命中在同一帧里先申请全局顿帧（仲裁器立刻把 timeScale 写成 0.05），
   * 反推出来的「真实时长」会是 1/60 ÷ 0.05 ≈ 0.33 s，视觉顿帧在命中那一帧就被扣光。没有 rawDt（检视页 / 测试的桩）时才退回反推
   */
  private realDt(dt: number): number {
    const raw = this.ctx.time.rawDt;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const ts = this.ctx.time.timeScale;
    return ts > 1e-4 ? dt / ts : dt;
  }

  /**
   * 左手（Unity WeaponHandRig）：平时刚性跟着握点走、只让离握点的偏差按 20/s 衰减（推泵时手不拖后）；
   * 换弹按 sampleLoadingHand 走（送弹口跟着弹匣离位），整匣换弹进度过了 loadAt 发加弹事件；前臂两骨 IK。
   */
  private animateHands(dt: number, e: VmEntry, s: ViewmodelState): void {
    const left = e.leftArm;
    const profile = e.profile;
    this.forearmSwing = 0;
    if (!left || !profile || e.blade) return;
    const g = e.gun;
    _v.copy(e.support);
    if (g.leftParent && g.leftHand) {
      g.leftParent.updateMatrix();
      _v.copy(g.leftHand).applyMatrix4(g.leftParent.matrix);
    }
    _supportPoint[0] = _v.x; _supportPoint[1] = _v.y; _supportPoint[2] = _v.z;
    if (e.breech) e.breech.rotation.x = -BREAK.OpenAngle * this.shellT;
    if (s.reloading) {
      _v2.fromArray(profile.load);
      if (g.mag && !s.shellMode) {
        g.root.updateMatrixWorld(true);
        g.mag.getWorldPosition(_v2);
        g.root.worldToLocal(_v2).add(e.loadOffset);
      }
      _loadPoint[0] = _v2.x; _loadPoint[1] = _v2.y; _loadPoint[2] = _v2.z;
      sampleLoadingHand(profile, s.reloadP, _supportPoint, _loadPoint, _handPose, !s.shellMode || s.firstShell);
      left.position.set(_handPose.x, _handPose.y, _handPose.z);
      e.restOffset.copy(left.position).sub(_v);
      e.handRoll = _handPose.roll;
      e.handPitch = _handPose.pitch;
      // 加弹的动画事件：弹匣入位
      if (!s.shellMode && s.reloadP >= profile.loadAt && !this.committed) {
        this.committed = true;
        this.onCommitLoad?.();
      }
    } else {
      const k = 1 - Math.exp(-20 * dt);
      e.restOffset.multiplyScalar(1 - k);
      left.position.copy(_v).add(e.restOffset);
      e.handRoll = lerp(e.handRoll, profile.leftRoll, k);
      e.handPitch = lerp(e.handPitch, 0, k);
    }
    this.poseForearm(e, left, _v);
    if (e.rounds) e.rounds.visible = s.shellMode && s.reloadP > 0.22 && s.reloadP < 0.98;
    if (e.chamberShell) {
      const show = s.reloading && s.shellMode && s.reloadP > 0.22 && s.reloadP < 0.98;
      e.chamberShell.visible = show;
      if (show) breakShellPose(s.reloadP, s.shellsInserted ?? 0, e.chamberShell.position);
    }
  }

  /**
   * 前臂两骨 IK（Unity WeaponHandRig.Apply）：相机空间里手在当前位置 / 在握点时各解一次肘，前臂按两个肘方向之间的转动摆
   * （× 0.7、最多 35°），换到枪模局部叠在手型上。枪模随开镜 / 晃动移动时肩不动，所以肘的弯法也跟着变。
   */
  private poseForearm(e: VmEntry, left: THREE.Object3D, support: THREE.Vector3): void {
    _qHand.setFromEuler(_euler.set(e.handPitch, 0, e.handRoll));
    const gunRoot = e.gun.root;
    const cam = this.ctx.viewCamera;
    gunRoot.updateWorldMatrix(true, false);
    cam.updateWorldMatrix(true, false);
    _h.copy(left.position).applyMatrix4(gunRoot.matrixWorld);
    cam.worldToLocal(_h);
    _h0.copy(support).applyMatrix4(gunRoot.matrixWorld);
    cam.worldToLocal(_h0);
    solveTwoBone(_shoulder, _h, HAND_IK.upperArm, HAND_IK.forearm, _pole, _e);
    solveTwoBone(_shoulder, _h0, HAND_IK.upperArm, HAND_IK.forearm, _pole, _e0);
    _a.subVectors(_e0, _h0);
    _b.subVectors(_e, _h);
    let applied = false;
    if (_a.lengthSq() > 1e-10 && _b.lengthSq() > 1e-10) {
      _q.setFromUnitVectors(_a.normalize(), _b.normalize());
      const w = clamp(_q.w, -1, 1);
      let angle = 2 * Math.acos(Math.abs(w));
      const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
      if (Number.isFinite(angle) && sinHalf > 1e-6 && angle > 1e-5) {
        _axis.set(_q.x, _q.y, _q.z).divideScalar(sinHalf);
        if (w < 0) _axis.negate();
        angle = Math.min(angle * HAND_IK.weight, HAND_IK.maxSwingDeg * DEG);
        this.forearmSwing = angle / DEG;
        // 相机空间的转动换到枪模局部
        gunRoot.getWorldQuaternion(_q2).invert();
        cam.getWorldQuaternion(_q);
        _q2.multiply(_q);
        _axis.applyQuaternion(_q2).normalize();
        _q.setFromAxisAngle(_axis, angle);
        left.quaternion.copy(_q).multiply(_qHand);
        applied = true;
      }
    }
    if (!applied) left.quaternion.copy(_qHand);
  }

  private animateParts(dt: number, e: VmEntry, s: ViewmodelState, time: number): void {
    const g = e.gun;
    const prof = e.profile;
    const fullReload = s.reloading && !s.shellMode;
    this.magOut = damp(this.magOut, fullReload && prof ? profileMagOut(prof, s.reloadP) : 0, 20, dt);
    const mo = this.magOut;
    // 弹匣 / 能量罐 / 弹箱 / 箭匣 / 灯芯（与转轮不是同一个节点时）：按本把的偏移与俯仰离位，管式装填塞进去后隐藏
    if (g.mag && g.mag !== g.cylinder && prof) {
      const b = e.magBase;
      g.mag.position.set(b.x + prof.magOffset[0] * mo, b.y + prof.magOffset[1] * mo, b.z + prof.magOffset[2] * mo);
      g.mag.rotation.x = e.magRotX + prof.magPitch * mo;
      g.mag.visible = prof.magHideAt >= 1 || mo < prof.magHideAt;
    }
    // 转轮：每发转一格；换弹时甩出并快速旋转
    if (g.cylinder) {
      const swing = prof?.cylinderSwing ?? -0.045;
      if (mo > 0.3) {
        this.cylAngle += dt * (prof?.cylinderSpin ?? 14);
        this.cylTarget = this.cylAngle;
      } else {
        if (s.cycleIndex >= 0) {
          // 元素轮转（Unity TrinityCycle.LockTarget）：转轮锁定到「下一发」所在弹膛（换弹中按归零后的位置），只向前转。
          // 弹膛数是轮转长度的整数倍时，同色弹膛等价，周期缩短为 steps / len 格
          const steps = g.cylinderSteps;
          const step = TAU / steps;
          const len = e.def.cycle ? e.def.cycle.length : 1;
          const period = len > 0 && steps % len === 0 ? step * len : TAU;
          const want = (s.reloading ? 0 : s.cycleIndex) * step;
          this.cylTarget = want + Math.ceil((this.cylTarget - step * 0.5 - want) / period) * period;
          if (this.cylSnap) this.cylAngle = this.cylTarget;
        }
        this.cylAngle = damp(this.cylAngle, this.cylTarget, 25, dt);
      }
      this.cylSnap = false;
      g.cylinder.rotation.z = this.cylAngle;
      const b = e.magBase;
      g.cylinder.position.set(b.x + swing * mo, b.y, b.z);
    }
    // 机炮转管
    if (g.spinner) g.spinner.rotation.z += s.spin * 42 * dt;
    // 霰弹泵动：开火后 0.12–0.44 s 与装填结束上膛 0.3 s 各拉一次（Unity WeaponPartAnimator，行程 = pumpStroke）
    if (g.pump) {
      const stroke = prof?.pumpStroke ?? 0;
      let pz = 0;
      const t1 = (s.sinceShot - 0.12) / 0.32;
      if (t1 > 0 && t1 < 1) pz = Math.sin(t1 * Math.PI) * stroke;
      this.rackT += dt;
      const t2 = this.rackT / 0.3;
      if (t2 < 1) pz = Math.max(pz, Math.sin(t2 * Math.PI) * stroke);
      g.pump.position.z = e.pumpBase + pz;
    }
    // 弩：弦与箭
    if (g.stringHalves) {
      const c = smooth(s.cock);
      setCrossbowString(g, c);
      if (g.bolt) g.bolt.visible = s.cock >= 0.98;
    }
    this.animateGlow(dt, e, s, time);
  }

  /**
   * 枪身灵纹：
   * - 三才转轮（Unity TrinityCycle）：下一发的元素色 × 稀有度亮度 × (呼吸 + 换元素亮闪)；
   * - 灵炮蓄力中（Unity RailgunCharge）：蓄能色（物理 = 满蓄虹紫）× 稀有度亮度 × 蓄力脉动；
   * - 其余：静态着色（Unity WeaponTint，buildGunModel 已写好）。
   * 程序化枪模的能量槽（美术还没到时的替身，Unity 没有）沿用网页的脉动。
   */
  private animateGlow(dt: number, e: VmEntry, s: ViewmodelState, time: number): void {
    const g = e.gun;
    const charging = e.def.mode === 'charge' && s.firing && s.spin > 0.02;
    let pulse: number;
    if (s.elementHint) {
      // 下一发的元素一变就亮闪一下（开枪 / 换弹归零），0.15 s 左右收回
      if (e.shownNext !== s.elementHint) {
        if (e.shownNext !== null) e.cycleFlash = 1;
        e.shownNext = s.elementHint;
      }
      e.cycleFlash = Math.max(0, e.cycleFlash - dt * TRINITY_FLASH.decay * Math.max(0.2, e.cycleFlash));
      e.baseColor.setHex(ELEMENT_COLORS[s.elementHint]);
      pulse = trinityPulse(time, e.cycleFlash);
      if (g.artGlow) g.artGlow.emissive.copy(e.baseColor).multiplyScalar(ART_GLOW[e.rarity as Rarity] * ART_GLOW_BASE * pulse);
    } else if (charging) {
      pulse = chargePulse(s.spin, !!s.chargeFull, time);
      const energy = e.element === 'none' ? FULL_CHARGE_GLOW : ELEMENT_COLORS[e.element];
      e.baseColor.setHex(energy);
      if (g.artGlow) g.artGlow.emissive.setHex(energy).multiplyScalar(ART_GLOW[e.rarity as Rarity] * ART_GLOW_BASE * pulse);
    } else {
      e.baseColor.setHex(ELEMENT_COLORS[e.element]);
      pulse = s.firing ? 1.3 + Math.sin(time * 40) * 0.25 : 0.82 + Math.sin(time * 3) * 0.14;
      if (g.artGlow) g.artGlow.emissive.copy(g.artGlow.userData.glowBase as THREE.Color);
    }
    e.energyMat.color.copy(e.baseColor).multiplyScalar(pulse);
  }

  private updateFlash(dt: number, e: VmEntry, s: ViewmodelState): void {
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = true;
      this.flashMat.opacity = clamp01(this.flashT / this.flashDur);
    } else if (s.firing && e.def.mode === 'beam') {
      // 光束持续放电的枪口辉光
      this.flash.visible = true;
      this.flashMat.opacity = 0.55 + Math.random() * 0.3;
      this.flash.scale.setScalar(e.def.flash * (0.7 + Math.random() * 0.5));
      this.flashMat.rotation = Math.random() * TAU;
    } else if (s.firing && e.def.mode === 'charge' && s.spin > 0.02) {
      // 蓄力：枪口聚起一团逐渐增大的灵光（Unity RailgunCharge 的枪口光球：大小 flash × (0.25 + 0.55·t)，满蓄后忽明忽暗）。
      // 着色 = 能量色 × HDR 倍率 (1.5 + 1.5·t) × a（RailgunCharge.cs:99–100，加色）：颜色乘倍率（材质不走色调映射，HDR 值吃得到泛光），透明度取 a
      const c = s.spin;
      this.flash.visible = true;
      this.flashMat.color.copy(e.baseColor).multiplyScalar(chargeOrbBoost(c));
      this.flashMat.opacity = 0.2 + 0.45 * c + (s.chargeFull ? Math.random() * 0.2 : 0);
      this.flash.scale.setScalar(e.def.flash * (0.25 + 0.55 * c) * (0.92 + Math.random() * 0.16));
      this.flashMat.rotation += dt * (2 + 10 * c);
    } else {
      this.flash.visible = false;
    }
  }

  private updateLights(dt: number, s: ViewmodelState): void {
    this.lightI = Math.max(0, this.lightI - dt / 0.07);
    let i = this.lightI;
    if (s.firing && this.cur && this.cur.def.mode === 'beam') i = Math.max(i, 0.35 + Math.random() * 0.15);
    else if (s.firing && this.cur && this.cur.def.mode === 'charge' && s.spin > 0.02 && this.lightI <= 0) {
      // 蓄力辉光：武器场景灯色取能量色（主场景不放枪口点光源）
      const cur = this.cur;
      this.vmLight.color.copy(cur.baseColor);
      i = 0.06 + 0.16 * s.spin;
    }
    if (i <= 0.001 || !this.visible) {
      this.vmLight.intensity = 0;
      return;
    }
    if (this.cur) {
      this.cur.gun.muzzle.updateWorldMatrix(true, false);
      _v.setFromMatrixPosition(this.cur.gun.muzzle.matrixWorld);
      this.root.worldToLocal(_v);
      this.vmLight.position.copy(_v);
    }
    this.vmLight.intensity = i * 0.22;
  }

  /**
   * 枪口的主场景世界坐标（曳光起点）：取 viewmodel 枪口在武器相机中的屏幕位置，
   * 换算到主相机前方约 0.9 米处，使曳光看起来从枪口射出（两台相机 FOV 不同）。
   */
  getMuzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    const ctx = this.ctx;
    const e = this.cur;
    if (e) {
      e.gun.muzzle.updateWorldMatrix(true, false);
      _v.setFromMatrixPosition(e.gun.muzzle.matrixWorld);
      ctx.viewCamera.worldToLocal(_v);
    } else {
      _v.set(0.18, -0.15, -0.6);
    }
    return this.projectLaunchWorld(out);
  }

  private projectLaunchWorld(out: THREE.Vector3): THREE.Vector3 {
    const ctx = this.ctx, cam = ctx.camera;
    const depth = 0.9;
    const vz = Math.min(-0.05, _v.z);
    const tanV = Math.tan(ctx.viewCamera.fov * DEG * 0.5);
    const tanM = Math.tan(cam.fov * DEG * 0.5);
    const k = (depth / -vz) * (tanM / tanV);
    out.set(_v.x * k, _v.y * k, -depth);
    cam.updateMatrixWorld();
    return cam.localToWorld(out);
  }
}

