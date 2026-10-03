/**
 * 第一人称武器模型：挂在 ctx.viewCamera 下（相机在原点朝 −Z），右下持枪。
 *
 * 动画：呼吸摆动、移动晃动、鼠标惯性、横移倾斜、跳跃 / 落地、冲刺姿态、开火后坐、
 * 换弹（按 ReloadStyle）、切枪收放、机炮转管、霰弹泵动、左轮转轮、弩弦上弦、
 * 元素轮转（灵纹改色 + 转轮对准下一发）、蓄力（线圈加速、颤动与枪口聚光）、
 * 魔刀千刃（三段挥砍 + 顿帧 + 刀光拖尾、变形时刀身裂解为 18 片悬浮刃片、投掷 / 召回、突进姿态、随动流苏）。
 * 枪口火焰为加法混合精灵；主场景与武器场景各一个复用的 PointLight 做闪光。
 */
import * as THREE from 'three';
import type { Element, GameContext, WeaponForm, WeaponInstance } from '../core/types';
import { ELEMENT_COLORS } from '../core/types';
import { clamp, clamp01, damp, DEG, lerp, TAU } from '../core/math';
import { getWeaponDef, type WeaponDef } from './WeaponDefs';
import {
  BLADE_RUNE_COLOR, BLADE_SHARDS, boxGeo, buildGunModel, getFlashTexture, setCrossbowString, solidMat,
  type BladeRig, type GunModel,
} from './WeaponModels';

export interface ViewmodelState {
  aimT: number;
  /** 切枪：0 = 正常持枪，1 = 完全收下 */
  lowerT: number;
  reloading: boolean;
  /** 整匣换弹进度 0..1 */
  reloadP: number;
  /** 逐发装填中 */
  shellMode: boolean;
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
  /** 元素轮转：下一发的元素（能量槽显示该元素色）；非轮转武器为 null */
  elementHint: Element | null;
  /** 元素轮转：弹巢进度（转轮对准下一发所在弹膛）；非轮转武器为 −1 */
  cycleIndex: number;

  // ───── 双形态武器（魔刀千刃，docs/demon-blade.md 第 10 节）：WeaponSystem 每帧写入，非双形态武器保持默认值 ─────
  /** 当前（目标）形态；非双形态武器为 null */
  form: WeaponForm | null;
  /** 形态切换进度 0..1（1 = 完成 / 未在切换）：从「另一形态」过渡到 form */
  morphT: number;
  /** 近战：当前挥砍段 0 横斩 / 1 回斩 / 2 下劈；−1 = 不在挥砍 */
  swing: number;
  /** 近战：当前段进度 0..1（按整段时长归一化，已含攻速） */
  swingP: number;
  /** 近战：判定帧在本段中的位置 0..1（= windup / duration），动画把「出刀」对齐到这里 */
  swingHitP: number;
  /** 飞刃（弹匣）当前数量与容量：千刃形态悬浮刃片数 = blades / bladesMax × 模型刃片数 */
  blades: number;
  bladesMax: number;
  /** 武器技能突进进度 0..1；−1 = 不在突进 */
  skillT: number;
  /** 「换形一击」窗口剩余比例 0..1（刃口符纹增亮）；0 = 无 */
  strikeT: number;
}

/** ViewmodelState 默认值（WeaponSystem 持有一份并逐帧改写） */
export function createViewmodelState(): ViewmodelState {
  return {
    aimT: 0, lowerT: 0, reloading: false, reloadP: 0, shellMode: false, firing: false, spin: 0, scoped: false, sinceShot: 99, cock: 1,
    elementHint: null, cycleIndex: -1,
    form: null, morphT: 1, swing: -1, swingP: 0, swingHitP: 0.25, blades: 0, bladesMax: 1, skillT: -1, strikeT: 0,
  };
}

interface VmEntry {
  uid: number;
  def: WeaponDef;
  gun: GunModel;
  /** 本模型独享的能量槽材质（脉动） */
  energyMat: THREE.MeshBasicMaterial;
  baseColor: THREE.Color;
  magBase: THREE.Vector3;
  magRotX: number;
  pumpBase: number;
  /** 魔刀千刃的第一人称状态；其他武器为 null */
  blade: BladeVm | null;
}

/** 魔刀千刃：每把刀（模型实例）的第一人称状态 */
interface BladeVm {
  rig: BladeRig;
  /** 独享的符纹材质（变形 / 换形一击 / 命中时增亮） */
  runeMat: THREE.MeshBasicMaterial;
  /** 刀光颜色（元素色或朱红，与斩击弧光一致） */
  color: number;
  /** 每片刃片在离开顺序中的名次（0 = 最先离开：刀尖 / 阵中央） */
  rank: Uint8Array;
  /** 刃片是否在场（数量 = 剩余飞刃） */
  present: boolean[];
  /** 出现（飞回）动画计时（≥ APPEAR_TIME 为已落位） */
  appearT: Float32Array;
  /** 投掷飞离动画计时（< 0 = 不在飞离） */
  launchT: Float32Array;
  /** 飞回起点的随机偏移（每次出现时重抽） */
  jit: Float32Array;
  /** 每片当前的悬浮阵位（角 / 半径 / z 偏移），向随剩余数量重排的目标平滑 */
  fanAng: Float32Array;
  fanR: Float32Array;
  fanDz: Float32Array;
  /** 独享的刃片材质（刃口 / 刀背各一份克隆）：千刃形态加朱红自发光 */
  shardMats: THREE.MeshStandardMaterial[];
  /** 袖子所在的前臂节点（腕部为原点，只跟随部分刀姿旋转） */
  forearm: THREE.Object3D | null;
  /** 下一帧直接对齐（刚切到这把刀：不播出现 / 飞离动画） */
  snap: boolean;
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();

// ───────────────────────────── 魔刀千刃（docs/demon-blade.md 10.7） ─────────────────────────────

/** 姿态：相对 viewOffset 的 pivot 偏移与旋转 [Δx, Δy, Δz, rx, ry, rz]（弧度） */
type Pose = readonly [number, number, number, number, number, number];

/** 斩·待机：刀斜举在视野右侧（刀尖不挡准星） */
const P_MELEE_IDLE: Pose = [0, 0, 0, 0.45, -0.12, -0.5];
/** 千刃·待机：刀身消失，手持刀柄略收，刃片悬浮于手背上方 */
const P_RANGED_IDLE: Pose = [-0.02, 0.02, 0.04, 0.15, 0.12, 0.1];
/** 技能·突进：刀收到身侧、刀尖平指右后方（手与柄尾留在视野右下） */
const P_DASH: Pose = [0.02, 0.05, 0.02, -0.15, -1.35, -1.35];
/**
 * 三段挥砍的关键姿态 [蓄势, 出刀, 收势]。横斩右 → 左（ry < 0 刀尖朝右，刃口朝左，rz ≈ −1.35）、
 * 回斩左 → 右（刃口朝右）、下劈自头顶劈向前下方（刃口朝前）。与 fx.blade.slashArc 的方向一致。
 */
const SWING_POSES: readonly (readonly [Pose, Pose, Pose])[] = [
  // 出刀（判定帧）ry ≈ +0.28：手在视野右侧，刀尖略偏左才正好扫过准星（ry 0 时刀与视线平行，接触点偏右）。
  // 横斩蓄势 ry −0.75 / Δx 0.04：刀尖留在画面右缘以内（原 −1.05 / 0.10 时整把刀甩出屏幕，前摇读作「闪了一下」）
  [[0.04, 0.04, 0.04, 0.2, -0.75, -1.35], [-0.02, 0, -0.06, 0.05, 0.28, -1.45], [-0.2, -0.03, 0, 0, 1.15, -0.8]],
  [[-0.2, -0.02, 0.02, 0.05, 1.15, 0.8], [-0.02, -0.02, -0.06, 0.05, 0.28, 1.35], [0.1, -0.04, 0, 0, -0.9, 1.0]],
  // 下劈：自右上举刀劈向准星下方（出刀 / 收势 ry > 0，刀路成右上 → 左下的斜线，与弧光的倾斜一致）。
  // 出刀 rx −0.18：判定帧刀尖落在胸口高度（原 −0.35 时已压到裆部，顿帧把刀停在那里）；收势 rx −0.8 / Δy −0.06 保留下劈的追随
  [[0.02, 0.2, 0.06, 1.35, 0.1, -0.15], [-0.03, 0.02, -0.08, -0.18, 0.26, -0.2], [-0.05, -0.06, -0.04, -0.8, 0.34, -0.22]],
];
/** 蓄势占判定帧前摇的比例（0 → WIND_FRAC × hitP 进入蓄势，之后加速出刀） */
const WIND_FRAC = 0.5;
/** 技能：进入突进姿态所占的突进进度 */
const DASH_IN = 0.35;
/** 段结束后回到待机的时长 */
const RELEASE_TIME = 0.15;
/** 技能突进结束后的收刀横扫时长 */
const FINISH_TIME = 0.2;
/** 顿帧（表现层钉在出刀姿态）秒数：普通 / 重击 */
const HITSTOP = 0.04;
const HITSTOP_HEAVY = 0.06;
/** 刃片：飞回（召回 / 回刃）与投掷飞离的动画时长 */
const APPEAR_TIME = 0.12;
const LAUNCH_TIME = 0.1;
/** 变形中刃片的脱离：起始（morph 进度）、相邻两段的间隔、单片飞行时长 */
const MORPH_SHARD_START = 0.3;
const MORPH_SHARD_STEP = 0.028;
const MORPH_SHARD_FLY = 0.3;
/**
 * 千刃悬浮阵：手背上方略靠前的两层扇形（内外交替），像一圈孔雀尾 / 刃轮：
 * 每片刃尖沿径向朝外并前倾 FAN_TILT，刃面朝向镜头（第一人称视野右下，不挡准星）。扇形圆心为 root 空间。
 * 剩余刃片在随数量收窄的扇面里重新均匀排布（半角 = FAN_HALF × n / 18，不小于 FAN_HALF_MIN），阵位变化以 FAN_DAMP 平滑：
 * 投掷时阵中央的刃片飞走，其余向中间合拢，扇面宽度即剩余量。
 */
const FAN_CENTER = new THREE.Vector3(0.005, 0.06, -0.12);
const FAN_INNER_R = 0.075;
const FAN_OUTER_R = 0.115;
const FAN_TILT = 35 * DEG;
const FAN_HALF = 72 * DEG;
const FAN_HALF_MIN = 12 * DEG;
const FAN_DAMP = 14;
/** 内层刃片略靠前（避免与外层穿插） */
const FAN_INNER_DZ = 0.012;
/** 千刃形态刃片的朱红自发光强度；最后一轮（≤ 一轮的柄数）时 ×1–2 以 LAST_PULSE_HZ 脉动，提示快打空 */
const SHARD_GLOW = 0.5;
const LAST_PULSE_HZ = 6;
/** 魔刀的袖子（前臂）只跟随刀姿旋转（相对待机姿态的偏离）的这个比例：手腕转动、前臂基本不动，不会整条扫进画面 */
const FOREARM_FOLLOW = 0.35;
/** 刃片在悬浮阵中的缩放（比拼在刀上时小一些，阵形更利落） */
const FAN_SCALE = 0.8;
/** 千刃形态的「枪口」：悬浮阵中心前方（飞刃出生点、召回终点） */
const RANGED_MUZZLE = new THREE.Vector3(0.005, 0.11, -0.19);
/** 刀光拖尾：取样数、细分、寿命；刃面（普通混合）的颜色倍率与最大透明度；加法热边占刃面外侧的比例起点 */
const TRAIL_SAMPLES = 18;
const TRAIL_SUB = 4;
const TRAIL_LIFE = 0.11;
const TRAIL_DARK = 0.75;
const TRAIL_ALPHA = 0.6;
const TRAIL_EDGE_FRAC = 0.82;
/** 流苏三节（自上而下）的弹簧刚度与阻尼（越往下越软、越滞后），以及「速度反向摆动」强度 */
const TASSEL_K = [150, 105, 72];
const TASSEL_C = [10, 8, 6];
const TASSEL_DRAG = 0.14;
const TASSEL_VMAX = 10;

const DOWN = new THREE.Vector3(0, -1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _pose = new Float32Array(6);
const _idle = new Float32Array(6);

/**
 * 「离开名次 → 满阵时的阵位角」（阵中央先离开）与「按阵位角从左到右排列的名次」：剩余刃片按后者的顺序在收窄的扇面里重新排布，
 * 下一批要离开的总在阵中央。满阵时的阵位 = 内 9 片 ±64°、外 9 片 ±72°（交错）。
 */
const RANK_ANGLE: number[] = [];
const RANKS_BY_ANGLE: number[] = [];
{
  const half = BLADE_SHARDS / 2;
  const angles: number[] = [];
  for (let s = 0; s < BLADE_SHARDS; s++) {
    const inner = s < half;
    const k = inner ? s : s - half;
    const phi = inner ? (-64 + (128 * k) / (half - 1)) * DEG : (-72 + (144 * k) / (half - 1)) * DEG;
    angles.push(phi + (inner ? 0 : 0.001));
  }
  // 按 |角度| 由中央向两侧；同一对左右阵位交替先左 / 先右，使刃口片与刀背片在两侧混排
  const order = angles.map((_a, i) => i).sort((a, b) => Math.abs(angles[a]) - Math.abs(angles[b]) || angles[a] - angles[b]);
  let pair = 0;
  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    const next = order[i + 1];
    if (next !== undefined && Math.abs(Math.abs(angles[s]) - Math.abs(angles[next])) < 1e-6 && angles[s] !== angles[next]) {
      if (pair++ % 2 === 0) RANK_ANGLE.push(angles[s], angles[next]);
      else RANK_ANGLE.push(angles[next], angles[s]);
      i++;
    } else {
      RANK_ANGLE.push(angles[s]);
    }
  }
  for (let k = 0; k < RANK_ANGLE.length; k++) RANKS_BY_ANGLE.push(k);
  RANKS_BY_ANGLE.sort((a, b) => RANK_ANGLE[a] - RANK_ANGLE[b]);
}

const _fanM = new THREE.Matrix4();
const _fanX = new THREE.Vector3();
const _fanY = new THREE.Vector3();
const _fanZ = new THREE.Vector3();
const _slotP = new THREE.Vector3();
const _slotQ = new THREE.Quaternion();
const _eul = new THREE.Euler();

/** 悬浮阵位（角 phi、半径 r、z 偏移）→ root 空间位置与朝向：刃尖（本地 −Z）沿径向朝外并前倾，刃面（本地 ±X）尽量朝向镜头（+Z） */
function fanSlot(phi: number, r: number, dz: number, pos: THREE.Vector3, quat: THREE.Quaternion): void {
  const sx = Math.sin(phi), cy = Math.cos(phi);
  pos.set(FAN_CENTER.x + sx * r, FAN_CENTER.y + cy * r, FAN_CENTER.z + dz);
  _fanZ.set(-sx * Math.cos(FAN_TILT), -cy * Math.cos(FAN_TILT), Math.sin(FAN_TILT)).normalize();
  _fanX.set(0, 0, 1).addScaledVector(_fanZ, -_fanZ.z).normalize();
  _fanY.crossVectors(_fanZ, _fanX);
  _fanM.makeBasis(_fanX, _fanY, _fanZ);
  quat.setFromRotationMatrix(_fanM);
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** Catmull-Rom 插值（标量） */
function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}

function poseLerp(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>, t: number): Float32Array {
  for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

/** 千刃程度：0 = 斩形态 … 1 = 千刃形态（变形中按进度；ViewmodelState.form 是目标形态） */
function rangedAmount(s: ViewmodelState): number {
  if (s.form === 'ranged') return clamp01(s.morphT);
  if (s.form === 'melee') return 1 - clamp01(s.morphT);
  return 0;
}

/** W → S → F 三点样条：u ∈ [0, 2]（u = 1 时正好在 S） */
function poseSpline(out: Float32Array, w: ArrayLike<number>, s: ArrayLike<number>, f: ArrayLike<number>, u: number): Float32Array {
  if (u <= 1) for (let i = 0; i < 6; i++) out[i] = cr(w[i], w[i], s[i], f[i], u);
  else for (let i = 0; i < 6; i++) out[i] = cr(w[i], s[i], f[i], f[i], u - 1);
  return out;
}

/**
 * 挥砍曲线：0 → WIND_FRAC·hitP 由起点缓入蓄势；→ hitP 加速出刀（正好在判定帧过中线）；
 * hitP → 1 快速甩过并缓停在收势（初速与出刀末速衔接）。
 */
function swingPose(out: Float32Array, seg: number, p: number, hitP: number, from: ArrayLike<number>): Float32Array {
  const [w, s, f] = SWING_POSES[Math.max(0, Math.min(SWING_POSES.length - 1, seg))];
  const hp = clamp(hitP, 0.05, 0.9);
  const a = WIND_FRAC * hp;
  if (p < a) {
    // 起手：由当前刀姿平滑过渡到蓄势（连段时含手腕翻转）
    const t = p / a;
    return poseLerp(out, from, w, t * t * (3 - 2 * t));
  }
  if (p < hp) {
    const t = (p - a) / (hp - a);
    return poseSpline(out, w, s, f, t * t);
  }
  const t = (p - hp) / (1 - hp);
  const k = clamp((2 * (1 - hp)) / (hp - a), 2, 5);
  return poseSpline(out, w, s, f, 1 + (1 - (1 - t) ** k));
}

/**
 * 刀光拖尾：在武器场景（viewmodel 根节点空间）里记录刀身内缘 / 刀尖的轨迹，Catmull-Rom 细分成两层带：
 * 普通混合的深色刃面（主题色 × TRAIL_DARK，透明度 ≤ TRAIL_ALPHA；纯加法叠在天空 / 沙地上会变成粉紫光柱）+
 * 沿刀尖轨迹的加法细热边（外缘 TRAIL_EDGE_FRAC 以外）。
 */
class BladeTrail {
  readonly group = new THREE.Group();
  private readonly inner = new Float32Array(TRAIL_SAMPLES * 3);
  private readonly outer = new Float32Array(TRAIL_SAMPLES * 3);
  private readonly age = new Float32Array(TRAIL_SAMPLES);
  private count = 0;
  private readonly pos: THREE.BufferAttribute;
  /** 刃面颜色 RGBA（普通混合，逐顶点透明度） */
  private readonly col: THREE.BufferAttribute;
  private readonly geo: THREE.BufferGeometry;
  private readonly edgePos: THREE.BufferAttribute;
  /** 热边颜色 RGB（加法混合，已乘亮度） */
  private readonly edgeCol: THREE.BufferAttribute;
  private readonly edgeGeo: THREE.BufferGeometry;
  private readonly color = new THREE.Color();

  constructor() {
    const maxPts = (TRAIL_SAMPLES - 1) * TRAIL_SUB + 1;
    const idx: number[] = [];
    for (let k = 0; k < maxPts - 1; k++) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const index = new THREE.Uint16BufferAttribute(idx, 1);
    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(maxPts * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(new Float32Array(maxPts * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('color', this.col);
    this.geo.setIndex(index);
    this.geo.setDrawRange(0, 0);
    this.edgeGeo = new THREE.BufferGeometry();
    this.edgePos = new THREE.BufferAttribute(new Float32Array(maxPts * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.edgeCol = new THREE.BufferAttribute(new Float32Array(maxPts * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.edgeGeo.setAttribute('position', this.edgePos);
    this.edgeGeo.setAttribute('color', this.edgeCol);
    this.edgeGeo.setIndex(index);
    this.edgeGeo.setDrawRange(0, 0);
    const body = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.NormalBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    }));
    body.frustumCulled = false;
    body.renderOrder = 12;
    body.name = 'viewmodel.bladeTrail';
    const edge = new THREE.Mesh(this.edgeGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    }));
    edge.frustumCulled = false;
    edge.renderOrder = 13;
    edge.name = 'viewmodel.bladeTrailEdge';
    this.group.add(body, edge);
  }

  setColor(hex: number): void {
    this.color.setHex(hex);
  }

  clear(): void {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
    this.edgeGeo.setDrawRange(0, 0);
  }

  /** 追加一个取样（与上一个几乎重合时跳过，例如顿帧中） */
  push(inner: THREE.Vector3, outer: THREE.Vector3): void {
    const n = this.count;
    if (n > 0) {
      const o = (n - 1) * 3;
      const dx = outer.x - this.outer[o], dy = outer.y - this.outer[o + 1], dz = outer.z - this.outer[o + 2];
      if (dx * dx + dy * dy + dz * dz < 4e-6) {
        this.age[n - 1] = 0;
        return;
      }
    }
    if (n >= TRAIL_SAMPLES) this.shift(1);
    const i = this.count++;
    this.inner[i * 3] = inner.x; this.inner[i * 3 + 1] = inner.y; this.inner[i * 3 + 2] = inner.z;
    this.outer[i * 3] = outer.x; this.outer[i * 3 + 1] = outer.y; this.outer[i * 3 + 2] = outer.z;
    this.age[i] = 0;
  }

  private shift(k: number): void {
    this.inner.copyWithin(0, k * 3, this.count * 3);
    this.outer.copyWithin(0, k * 3, this.count * 3);
    this.age.copyWithin(0, k, this.count);
    this.count -= k;
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) this.age[i] += dt;
    let dead = 0;
    while (dead < this.count && this.age[dead] >= TRAIL_LIFE) dead++;
    // 至少保留一个已死的点作为尾端（让带子平滑收尾）
    if (dead > 1) this.shift(dead - 1);
    const n = this.count;
    if (n < 2 || this.age[n - 1] >= TRAIL_LIFE) {
      this.geo.setDrawRange(0, 0);
      this.edgeGeo.setDrawRange(0, 0);
      return;
    }
    const P = this.pos.array as Float32Array;
    const C = this.col.array as Float32Array;
    const EP = this.edgePos.array as Float32Array;
    const EC = this.edgeCol.array as Float32Array;
    const c = this.color;
    const br = c.r * TRAIL_DARK, bg = c.g * TRAIL_DARK, bb = c.b * TRAIL_DARK;
    let v = 0;
    for (let s = 0; s < n - 1; s++) {
      const i0 = Math.max(0, s - 1), i1 = s, i2 = s + 1, i3 = Math.min(n - 1, s + 2);
      const last = s === n - 2;
      for (let k = 0; k <= (last ? TRAIL_SUB : TRAIL_SUB - 1); k++) {
        const t = k / TRAIL_SUB;
        for (let a = 0; a < 3; a++) {
          const pi = cr(this.inner[i0 * 3 + a], this.inner[i1 * 3 + a], this.inner[i2 * 3 + a], this.inner[i3 * 3 + a], t);
          const po = cr(this.outer[i0 * 3 + a], this.outer[i1 * 3 + a], this.outer[i2 * 3 + a], this.outer[i3 * 3 + a], t);
          P[v * 6 + a] = pi;
          P[v * 6 + 3 + a] = po;
          EP[v * 6 + a] = pi + (po - pi) * TRAIL_EDGE_FRAC;
          EP[v * 6 + 3 + a] = po;
        }
        const age = lerp(this.age[i1], this.age[i2], t);
        const life = clamp01(1 - age / TRAIL_LIFE);
        const head = clamp01(1 - age / 0.035);
        const al = life * life;
        // 刃面：内缘几乎透明、外缘（刀尖轨迹）最浓
        C[v * 8] = br; C[v * 8 + 1] = bg; C[v * 8 + 2] = bb; C[v * 8 + 3] = al * TRAIL_ALPHA * 0.12;
        C[v * 8 + 4] = br; C[v * 8 + 5] = bg; C[v * 8 + 6] = bb; C[v * 8 + 7] = al * TRAIL_ALPHA;
        // 热边：内侧为 0（柔边），外缘为主题色，最新一截略偏白
        const ek = al * 0.85;
        const wr = c.r + (1 - c.r) * head * 0.3, wg = c.g + (1 - c.g) * head * 0.3, wb = c.b + (1 - c.b) * head * 0.3;
        EC[v * 6] = 0; EC[v * 6 + 1] = 0; EC[v * 6 + 2] = 0;
        EC[v * 6 + 3] = wr * ek; EC[v * 6 + 4] = wg * ek; EC[v * 6 + 5] = wb * ek;
        v++;
      }
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.edgePos.needsUpdate = true;
    this.edgeCol.needsUpdate = true;
    this.geo.setDrawRange(0, (v - 1) * 6);
    this.edgeGeo.setDrawRange(0, (v - 1) * 6);
  }
}

const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** 换弹倾斜包络：进入 0–15%，保持，82–100% 退出 */
function reloadEnvelope(p: number): number {
  return smooth(p / 0.15) * (1 - smooth((p - 0.82) / 0.18));
}

/** 弹匣离位曲线：12–38% 取出，38–55% 离位，55–78% 装入 */
function magCurve(p: number): number {
  if (p < 0.12) return 0;
  if (p < 0.38) return smooth((p - 0.12) / 0.26);
  if (p < 0.55) return 1;
  if (p < 0.78) return 1 - smooth((p - 0.55) / 0.23);
  return 0;
}

/**
 * 给第一人称模型装上手套与袖子（袖子取英雄主题色）。
 * 魔刀返回前臂节点（腕部为原点、袖子挂在下面）：挥砍时手腕翻转幅度很大，袖子若随手腕整体旋转会像一块木板扫进画面，
 * 所以 Viewmodel 每帧让它只跟随刀姿旋转的 FOREARM_FOLLOW；其他武器返回 null。
 */
function addArms(gun: GunModel, sleeveColor: number): THREE.Object3D | null {
  const glove = solidMat(0x2e241e, 0.05, 0.9);
  const cuff = solidMat(0x1b1714, 0.1, 0.8);
  _c.setHex(sleeveColor).multiplyScalar(gun.blade ? 0.5 : 0.72);
  const sleeve = solidMat(_c.getHex(), 0.05, 0.85);
  const mk = (parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx: number, ry: number, rz = 0): void => {
    const m = new THREE.Mesh(boxGeo(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
  };
  const r = gun.root;
  if (gun.blade) {
    // 魔刀：拳头横握沿 Z 的刀柄（拳面包住握把轴线），拇指压在刀柄左上，手腕紧跟拳后
    mk(r, glove, 0.05, 0.054, 0.074, 0.006, -0.006, 0.034, 0, 0, -0.22);
    mk(r, glove, 0.018, 0.05, 0.068, -0.02, -0.012, 0.034, 0, 0, -0.1);
    mk(r, glove, 0.017, 0.016, 0.046, -0.014, 0.02, 0.006, 0.12, 0.22);
    mk(r, cuff, 0.07, 0.07, 0.045, 0.026, -0.044, 0.096, 0.55, 0.38);
    // 前臂（腕部 = 护腕中心）；袖子缩短到 0.2、颜色压暗，近端仍接在护腕后
    const forearm = new THREE.Group();
    forearm.name = 'viewmodel.forearm';
    forearm.position.set(0.026, -0.044, 0.096);
    r.add(forearm);
    mk(forearm, sleeve, 0.068, 0.068, 0.2, 0.028, -0.03, 0.056, 0.62, 0.38);
    return forearm;
  }
  // 右手：握把
  mk(r, glove, 0.052, 0.078, 0.07, 0.003, -0.05, 0.034, -0.3, 0);
  mk(r, glove, 0.018, 0.018, 0.045, -0.024, -0.008, 0.018, -0.2, 0.3);
  mk(r, cuff, 0.074, 0.074, 0.045, 0.024, -0.098, 0.1, 0.62, 0.38);
  mk(r, sleeve, 0.07, 0.07, 0.34, 0.075, -0.165, 0.2, 0.62, 0.38);
  // 左手：护木 / 前握把
  if (gun.leftHand) {
    const p = gun.leftParent ?? r;
    const L = gun.leftHand;
    mk(p, glove, 0.054, 0.046, 0.085, L.x - 0.006, L.y - 0.022, L.z, 0, 0);
    mk(p, glove, 0.012, 0.03, 0.07, L.x + 0.03, L.y - 0.006, L.z, 0, 0);
    mk(p, cuff, 0.072, 0.072, 0.045, L.x - 0.034, L.y - 0.068, L.z + 0.058, 0.6, -0.5);
    mk(p, sleeve, 0.068, 0.068, 0.4, L.x - 0.094, L.y - 0.15, L.z + 0.162, 0.6, -0.5);
  }
  return null;
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
  /** 主场景枪口闪光（照亮环境） */
  private readonly light: THREE.PointLight;
  /** 武器场景枪口闪光（照亮枪身） */
  private readonly vmLight: THREE.PointLight;

  // 动画状态
  private bobPhase = 0;
  private move = 0;
  private swayX = 0;
  private swayY = 0;
  private roll = 0;
  private fwdLag = 0;
  private vyLag = 0;
  private land = 0;
  private dashT = 0;
  private airT = 0;
  private kickZ = 0;
  private kickRot = 0;
  private kickRoll = 0;
  private reloadTilt = 0;
  private magOut = 0;
  private shellT = 0;
  private shellBump = 0;
  private prevReloadP = 0;
  private cylAngle = 0;
  private cylTarget = 0;
  /** 换枪后第一帧把轮转武器的转轮直接对准当前弹膛 */
  private cylSnap = false;
  private rackT = 99;
  private flashT = 0;
  private flashDur = 0.05;
  private lightI = 0;
  private lightPeak = 12;

  // ── 魔刀千刃 ──
  private readonly trail = new BladeTrail();
  /** 当前刀姿（不含投掷 / 召回 / 变形等叠加手势）与过渡起点 */
  private readonly bp = new Float32Array(6);
  private readonly bpFrom = new Float32Array(6);
  /** 0 回待机 / 1 挥砍 / 2 技能突进 / 3 突进后的收刀横扫 */
  private bpMode = 0;
  private bpSeg = -1;
  private bpT = 0;
  private bpReset = true;
  /** onSlash 记下的新段（同一段号连续出现时也能重新起势） */
  private slashPending = -1;
  /** 顿帧剩余秒数；表现层挥砍进度落后逻辑进度的量（顿帧中钉在出刀姿态，之后追上） */
  private hitStop = 0;
  private swingLag = 0;
  private hitFlash = 0;
  private throwT = 9;
  private trailOn = false;
  private readonly tasselDir = [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0)];
  private readonly tasselVel = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly tasselPrev = new THREE.Vector3();
  private tasselInit = false;

  constructor(private readonly ctx: GameContext) {
    this.root.name = 'viewmodel';
    this.root.add(this.pivot);
    this.root.add(this.trail.group);
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
    this.light = new THREE.PointLight(0xffc080, 0, 8, 2);
    this.light.castShadow = false;
    this.vmLight = new THREE.PointLight(0xffc080, 0, 1.4, 2);
    this.root.add(this.vmLight);
  }

  init(): void {
    this.ctx.viewCamera.add(this.root);
    this.ctx.scene.add(this.light);
    this.ctx.events.on('player:landed', ({ fallSpeed }) => {
      this.land += Math.min(0.05, Math.max(0, fallSpeed) * 0.0035);
    });
    this.ctx.events.on('player:jumped', () => {
      this.land -= 0.012;
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
    }
    this.cur = e;
    this.pivot.add(e.gun.root);
    e.gun.muzzle.add(this.flash);
    this.flash.visible = false;
    this.cylAngle = this.cylTarget = 0;
    this.cylSnap = true;
    this.magOut = 0;
    this.reloadTilt = 0;
    this.shellT = 0;
    if (e.gun.cylinder) e.gun.cylinder.rotation.z = 0;
    this.resetBladeAnim();
    if (e.blade) {
      e.blade.snap = true;
      this.trail.setColor(e.blade.color);
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
    this.reloadTilt = this.magOut = this.shellT = this.shellBump = 0;
    this.land = this.vyLag = 0;
    this.rackT = 99;
    this.killFlash();
    this.resetBladeAnim();
  }

  /** 魔刀的瞬时动画（姿态过渡、顿帧、拖尾、流苏）归零 */
  private resetBladeAnim(): void {
    this.bpReset = true;
    this.slashPending = -1;
    this.hitStop = this.swingLag = this.hitFlash = 0;
    this.throwT = 9;
    this.trailOn = false;
    this.trail.clear();
    this.tasselInit = false;
  }

  private killFlash(): void {
    this.flashT = 0;
    this.lightI = 0;
    this.flash.visible = false;
    this.light.intensity = 0;
    this.vmLight.intensity = 0;
  }

  private disposeEntry(e: VmEntry): void {
    e.gun.root.removeFromParent();
    if (this.flash.parent && this.flash.parent === e.gun.muzzle) e.gun.muzzle.remove(this.flash);
    e.energyMat.dispose();
    if (e.blade) {
      e.blade.runeMat.dispose();
      for (const m of e.blade.shardMats) m.dispose();
    }
  }

  private build(inst: WeaponInstance): VmEntry {
    const def = getWeaponDef(inst.defId);
    const gun = buildGunModel(inst.defId, inst.rarity, inst.element);
    const base = new THREE.Color(ELEMENT_COLORS[inst.element]);
    const energyMat = new THREE.MeshBasicMaterial({ color: base.clone(), toneMapped: false });
    for (const m of gun.energy) m.material = energyMat;
    let blade: BladeVm | null = null;
    if (gun.blade) {
      const rig = gun.blade;
      const runeMat = new THREE.MeshBasicMaterial({ color: BLADE_RUNE_COLOR, toneMapped: false });
      for (const m of rig.runes) m.material = runeMat;
      const rank = new Uint8Array(BLADE_SHARDS);
      rig.shardOrder.forEach((shard, k) => { rank[shard] = k; });
      // 刃片材质按模型克隆（缓存材质是全局共享的），千刃形态逐帧调自发光
      const shardMats: THREE.MeshStandardMaterial[] = [];
      const clones = new Map<THREE.Material, THREE.MeshStandardMaterial>();
      for (const s of rig.shards) {
        const src = s.material as THREE.MeshStandardMaterial;
        let c = clones.get(src);
        if (!c) {
          c = src.clone();
          c.emissive.setHex(BLADE_RUNE_COLOR);
          c.emissiveIntensity = 0;
          clones.set(src, c);
          shardMats.push(c);
        }
        s.material = c;
      }
      blade = {
        rig,
        runeMat,
        color: inst.element !== 'none' ? ELEMENT_COLORS[inst.element] : (def.projectile?.color ?? BLADE_RUNE_COLOR),
        rank,
        present: new Array<boolean>(BLADE_SHARDS).fill(true),
        appearT: new Float32Array(BLADE_SHARDS).fill(APPEAR_TIME),
        launchT: new Float32Array(BLADE_SHARDS).fill(-1),
        jit: new Float32Array(BLADE_SHARDS * 2),
        fanAng: new Float32Array(BLADE_SHARDS),
        fanR: new Float32Array(BLADE_SHARDS).fill(FAN_OUTER_R),
        fanDz: new Float32Array(BLADE_SHARDS),
        shardMats,
        forearm: null,
        snap: true,
      };
    }
    const forearm = addArms(gun, this.ctx.player.hero?.color ?? 0x5a6a7a);
    if (blade) blade.forearm = forearm;
    gun.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    return {
      uid: inst.uid,
      def,
      gun,
      energyMat,
      baseColor: base,
      magBase: gun.mag ? gun.mag.position.clone() : new THREE.Vector3(),
      magRotX: gun.mag ? gun.mag.rotation.x : 0,
      pumpBase: gun.pump ? gun.pump.position.z : 0,
      blade,
    };
  }

  // ───────────── 事件 ─────────────

  /** 开火：后坐、枪口火焰、闪光 */
  onShot(def: WeaponDef, color: number, strength = 1): void {
    const k = def.kick;
    this.kickZ = Math.min(this.kickZ + k.back * strength, k.back * 2.4);
    this.kickRot = Math.min(this.kickRot + k.rot * strength, k.rot * 2.4);
    this.kickRoll += (Math.random() - 0.5) * k.rot * 0.4 * strength;
    const e = this.cur;
    if (e && e.gun.cylinder) this.cylTarget += TAU / e.gun.cylinderSteps;
    // 魔刀「千刃」齐射：向前一甩的投掷手势（刃片飞离由弹药数变化驱动）
    if (e && e.blade) this.throwT = 0;
    if (def.flash > 0) {
      // 强度 < 1（未蓄满的蓄力射击）时火焰与闪光相应减弱
      const sk = 0.5 + 0.5 * strength;
      this.flashDur = def.flash > 0.2 ? 0.07 : 0.05;
      this.flashT = this.flashDur;
      this.flash.scale.setScalar(def.flash * (0.8 + Math.random() * 0.45) * sk);
      this.flashMat.rotation = Math.random() * TAU;
      this.flashMat.color.setHex(color);
      this.light.color.setHex(color);
      this.vmLight.color.setHex(color);
      this.lightI = 1;
      this.lightPeak = (6 + def.flash * 60) * sk;
    }
  }

  /** 空仓扣扳机：轻微抖动 */
  dryKick(): void {
    this.kickRot += 0.02;
  }

  /** 霰弹：压入一发 */
  shellInserted(): void {
    this.shellBump = 1;
  }

  /** 霰弹：装填结束后上膛（泵动一次） */
  rack(): void {
    this.rackT = 0;
  }

  /**
   * 魔刀千刃：开始挥砍第 segment 段（0 横斩 / 1 回斩 / 2 下劈），color 为刃光颜色。
   * 下一帧从当前刀姿起势（缓入蓄势 → 加速出刀 → 收势），刀光拖尾改用 color。
   */
  onSlash(segment: number, color: number): void {
    this.slashPending = segment;
    this.trail.setColor(color);
    const e = this.cur;
    if (e && e.blade) e.blade.color = color;
  }

  /**
   * 魔刀千刃：本段斩击命中了敌人（判定帧调用一次）。heavy = 第三段 / 技能斩击。
   * 顿帧：表现层钉在出刀（接触）姿态 40 毫秒（重击 60 毫秒）后追上逻辑进度；刀身轻震、符纹闪亮。
   */
  onSlashHit(heavy: boolean): void {
    this.hitStop = heavy ? HITSTOP_HEAVY : HITSTOP;
    this.kickRot += heavy ? 0.06 : 0.03;
    this.hitFlash = 1;
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

    // ── 移动晃动 ──
    const vx = p.velocity.x, vz = p.velocity.z;
    const hs = Math.hypot(vx, vz);
    const grounded = p.onGround;
    this.move = damp(this.move, grounded ? clamp01(hs / 7.5) : 0, 10, dt);
    if (grounded) this.bobPhase += dt * hs * 1.55;
    const aimK = 1 - 0.85 * s.aimT;
    const bobX = Math.sin(this.bobPhase) * 0.011 * this.move * aimK;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.011 * this.move * aimK;
    const bobRoll = Math.sin(this.bobPhase) * 0.018 * this.move * aimK;
    const breath = Math.sin(time * 1.6) * 0.0032 * aimK;

    // ── 鼠标惯性 ──
    const inp = ctx.input;
    const mdx = inp.enabled ? inp.mouseDX : 0;
    const mdy = inp.enabled ? inp.mouseDY * (ctx.settings.invertY ? -1 : 1) : 0;
    this.swayX = damp(this.swayX, clamp(-mdx * 0.00042, -0.05, 0.05), 10, dt);
    this.swayY = damp(this.swayY, clamp(mdy * 0.00042, -0.04, 0.04), 10, dt);

    // ── 横移倾斜 / 前后 / 垂直惯性 ──
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const lateral = vx * cy - vz * sy;
    const forward = -vx * sy - vz * cy;
    this.roll = damp(this.roll, clamp(-lateral * 0.009, -0.07, 0.07), 8, dt);
    this.fwdLag = damp(this.fwdLag, clamp(forward * 0.0022, -0.02, 0.02), 6, dt);
    this.vyLag = damp(this.vyLag, clamp(-p.velocity.y * 0.0022, -0.03, 0.03), 7, dt);
    this.land = damp(this.land, 0, 8, dt);
    this.dashT = damp(this.dashT, p.isDashing ? 1 : 0, 14, dt);
    this.airT = damp(this.airT, grounded ? 0 : 1, 7, dt);

    // ── 后坐恢复 ──
    this.kickZ = damp(this.kickZ, 0, 15, dt);
    this.kickRot = damp(this.kickRot, 0, 12, dt);
    this.kickRoll = damp(this.kickRoll, 0, 12, dt);
    this.shellBump = damp(this.shellBump, 0, 10, dt);

    // ── 换弹 ──
    const fullReload = s.reloading && !s.shellMode;
    const rp = fullReload ? s.reloadP : 0;
    this.reloadTilt = damp(this.reloadTilt, fullReload ? reloadEnvelope(rp) : 0, 18, dt);
    this.magOut = damp(this.magOut, fullReload ? magCurve(rp) : 0, 20, dt);
    this.shellT = damp(this.shellT, s.shellMode ? 1 : 0, 10, dt);
    if (fullReload && this.prevReloadP < 0.8 && rp >= 0.8) {
      this.kickRot -= 0.05;
      this.land += 0.01;
    }
    this.prevReloadP = rp;

    // ── 组合姿态 ──
    const hip = def.viewOffset, aim = def.aimOffset;
    const lowE = smooth(s.lowerT);
    const swayK = 1 - 0.6 * s.aimT;
    let x = lerp(hip[0], aim[0], s.aimT) + bobX + this.swayX * 0.5 * swayK + this.dashT * 0.015;
    let y = lerp(hip[1], aim[1], s.aimT) + bobY + breath + this.swayY * 0.5 * swayK + this.vyLag - this.land
      - lowE * 0.3 + this.kickZ * 0.15 - this.dashT * 0.02 + this.airT * 0.008;
    let z = lerp(hip[2], aim[2], s.aimT) + this.kickZ + this.fwdLag + lowE * 0.05;
    let rx = this.kickRot + breath * 1.2 + this.swayY * 1.0 * swayK - lowE * 0.9 - this.dashT * 0.12 + this.airT * 0.05;
    let ry = -this.swayX * 1.3 * swayK;
    let rz = this.roll * swayK + bobRoll + this.kickRoll - this.dashT * 0.3;

    const tilt = this.reloadTilt;
    switch (def.reloadStyle) {
      case 'mag': rz += 0.45 * tilt; rx += 0.12 * tilt; x -= 0.03 * tilt; y += 0.01 * tilt; break;
      case 'cylinder': rz += 0.75 * tilt; rx += 0.1 * tilt; x -= 0.04 * tilt; break;
      case 'tube': rx += 0.5 * tilt; rz += 0.15 * tilt; y -= 0.04 * tilt; z += 0.04 * tilt; break;
      case 'cell': rz += 0.3 * tilt; rx += 0.12 * tilt; x -= 0.02 * tilt; break;
      case 'box': rz += 0.28 * tilt; x -= 0.02 * tilt; y -= 0.05 * tilt; break;
      case 'shell': break;
    }
    const st = this.shellT;
    rz -= 0.38 * st;
    rx += 0.1 * st - this.shellBump * 0.06;
    x -= 0.015 * st;
    y += 0.015 * st - this.shellBump * 0.012;

    if (s.firing) {
      // 持续开火的颤动；蓄力时随蓄力加剧
      const j = def.mode === 'charge' ? 0.0008 + 0.0026 * s.spin : 0.003;
      x += (Math.random() - 0.5) * j;
      y += (Math.random() - 0.5) * j;
    }
    const bl = e.blade;
    if (bl) {
      const bp = this.updateBladePose(dt, s);
      x += bp[0];
      y += bp[1];
      z += bp[2];
      rx += bp[3];
      ry += bp[4];
      rz += bp[5];
    }
    this.pivot.position.set(x, y, z);
    this.pivot.rotation.set(rx, ry, rz);
    if (bl) {
      // 前臂只跟随刀姿相对待机姿态（_idle）偏离量的 FOREARM_FOLLOW（_pose 为本帧刀姿）：父节点（pivot）的旋转里扣掉其余部分。
      // 待机时与原来一样整体跟随，挥砍 / 突进时手腕大幅翻转而前臂基本不动
      if (bl.forearm) {
        const k = 1 - FOREARM_FOLLOW;
        _eul.set(rx - k * (_pose[3] - _idle[3]), ry - k * (_pose[4] - _idle[4]), rz - k * (_pose[5] - _idle[5]));
        bl.forearm.quaternion.copy(this.pivot.quaternion).invert().multiply(_q.setFromEuler(_eul));
      }
      this.animateBlade(dt, e, bl, s, time);
    }

    this.animateParts(dt, e, s, time);
    this.updateFlash(dt, e, s);
    this.updateLights(dt, s);
  }

  // ───────────── 魔刀千刃 ─────────────

  /**
   * 刀姿（相对 viewOffset 的偏移与旋转）：挥砍段 / 技能突进与收刀 / 回待机三种过渡，
   * 再叠加投掷、召回、变形的手势。返回模块级复用数组。
   */
  private updateBladePose(dt: number, s: ViewmodelState): Float32Array {
    const R = rangedAmount(s);
    poseLerp(_idle, P_MELEE_IDLE, P_RANGED_IDLE, smooth(R));
    const bp = this.bp, from = this.bpFrom;
    if (this.bpReset) {
      bp.set(_idle);
      from.set(_idle);
      this.bpMode = 0;
      this.bpT = RELEASE_TIME;
      this.bpSeg = -1;
      this.bpReset = false;
      this.slashPending = -1;
    }
    this.trailOn = false;
    // 顿帧计时在任何分支都走（挥砍被打断时不残留）
    const stopping = this.hitStop > 0;
    if (stopping) this.hitStop = Math.max(0, this.hitStop - dt);
    if (s.skillT >= 0) {
      // 技能·突进：前 DASH_IN 内收刀到身侧并保持（刀尖微颤）
      if (this.bpMode !== 2) {
        from.set(bp);
        this.bpMode = 2;
      }
      poseLerp(bp, from, P_DASH, smooth(s.skillT / DASH_IN));
    } else if (s.swing >= 0) {
      if (this.bpMode !== 1 || s.swing !== this.bpSeg || this.slashPending >= 0) {
        from.set(bp);
        this.bpMode = 1;
        this.bpSeg = s.swing;
        this.swingLag = 0;
        this.slashPending = -1;
      }
      // 顿帧：逻辑进度照走，表现层钉在「刀刃过中线」的接触姿态（p = hitP），结束后快速追上。
      // 判定帧往往落在两帧之间（上一帧刀还在蓄势侧）：直接跳到接触姿态，由刀光拖尾补出这一下的弧线，
      // 保证敌人闪白 / 火花出现的那一帧刀正好砍在身上，而不是停在半空再甩过去。
      const hp = s.swingHitP;
      if (stopping) {
        this.swingLag = Math.max(0, s.swingP - hp);
      } else {
        this.swingLag = damp(this.swingLag, 0, 22, dt);
      }
      const p = clamp01(s.swingP - this.swingLag);
      swingPose(bp, s.swing, p, hp, from);
      this.trailOn = R < 0.35 && p > WIND_FRAC * hp * 0.75 && p < hp + 0.5 * (1 - hp);
    } else if (this.bpMode === 2 || this.bpMode === 3) {
      // 突进结束：从压刀姿态横扫而出（复用横斩 出刀 → 收势），与收刀弧光同时出现
      if (this.bpMode === 2) {
        from.set(bp);
        this.bpMode = 3;
        this.bpT = 0;
        const cur = this.cur;
        if (cur && cur.blade) this.trail.setColor(cur.blade.color);
      }
      this.bpT += dt;
      const t = clamp01(this.bpT / FINISH_TIME);
      const sw = SWING_POSES[0];
      poseSpline(bp, from, sw[1], sw[2], 2 * easeOutCubic(t));
      this.trailOn = R < 0.35 && t < 0.7;
      if (t >= 1) {
        this.bpMode = 0;
        this.bpT = 0;
        from.set(bp);
      }
    } else {
      if (this.bpMode !== 0) {
        from.set(bp);
        this.bpMode = 0;
        this.bpT = 0;
        this.bpSeg = -1;
      }
      this.bpT += dt;
      poseLerp(bp, from, _idle, smooth(this.bpT / RELEASE_TIME));
    }

    // ── 叠加手势 ──
    const out = _pose;
    out.set(bp);
    // 千刃齐射：向前一甩
    this.throwT += dt;
    if (this.throwT < 0.22) {
      const k = this.throwT < 0.05 ? this.throwT / 0.05 : 1 - smooth((this.throwT - 0.05) / 0.17);
      out[0] -= 0.012 * k;
      out[2] -= 0.045 * k;
      out[3] -= 0.08 * k;
      out[5] -= 0.16 * k;
    }
    // 召回：掌心翻起接刃
    if (s.reloading && R > 0.5) {
      const env = reloadEnvelope(s.reloadP);
      out[1] += 0.02 * env;
      out[2] += 0.03 * env;
      out[3] += 0.12 * env;
      out[5] += 0.3 * env;
    }
    // 变形：手腕一拧，斩 → 千刃的前段刀身轻颤
    if (s.morphT < 1) {
      const b = Math.sin(Math.PI * s.morphT);
      out[1] += 0.022 * b;
      out[3] += 0.1 * b;
      out[5] += (s.form === 'ranged' ? 0.4 : -0.4) * b;
      if (s.form === 'ranged' && s.morphT < 0.35) {
        out[0] += (Math.random() - 0.5) * 0.006;
        out[1] += (Math.random() - 0.5) * 0.006;
      }
    }
    // 突进中刀尖微颤
    if (s.skillT >= DASH_IN) {
      out[3] += (Math.random() - 0.5) * 0.02;
      out[4] += (Math.random() - 0.5) * 0.02;
    }
    return out;
  }

  /**
   * 悬浮阵重排：在场的刃片按满阵时的阵位角从左到右排序，均匀铺在半角 max(FAN_HALF_MIN, FAN_HALF × n / 18) 的扇面里，
   * 内外层交替（左右对称，两端在外层）；刚出现（飞回）或刚切到这把刀时直接落位，其余以 FAN_DAMP 平滑过去。
   * 下一批要离开的总在阵中央，飞离中的刃片保持原阵位。
   */
  private layoutFan(dt: number, bl: BladeVm): void {
    const order = bl.rig.shardOrder;
    let n = 0;
    for (let i = 0; i < BLADE_SHARDS; i++) if (bl.present[i]) n++;
    if (n === 0) return;
    const half = Math.max(FAN_HALF_MIN, (FAN_HALF * n) / BLADE_SHARDS);
    let j = 0;
    for (let q = 0; q < RANKS_BY_ANGLE.length; q++) {
      const i = order[RANKS_BY_ANGLE[q]];
      if (i === undefined || !bl.present[i]) continue;
      const phi = n > 1 ? -half + (2 * half * j) / (n - 1) : 0;
      const outer = Math.min(j, n - 1 - j) % 2 === 0;
      const r = outer ? FAN_OUTER_R : FAN_INNER_R;
      const dz = outer ? 0 : FAN_INNER_DZ;
      j++;
      if (bl.snap || bl.appearT[i] <= 0) {
        bl.fanAng[i] = phi;
        bl.fanR[i] = r;
        bl.fanDz[i] = dz;
      } else {
        bl.fanAng[i] = damp(bl.fanAng[i], phi, FAN_DAMP, dt);
        bl.fanR[i] = damp(bl.fanR[i], r, FAN_DAMP, dt);
        bl.fanDz[i] = damp(bl.fanDz[i], dz, FAN_DAMP, dt);
      }
    }
  }

  /** 刀身伸缩、刃片（变形 / 悬浮 / 投掷 / 召回）、符纹亮度、枪口位置、刀光拖尾与流苏 */
  private animateBlade(dt: number, e: VmEntry, bl: BladeVm, s: ViewmodelState, time: number): void {
    const rig = bl.rig;
    const R = rangedAmount(s);

    // ── 刀脊：变形前段沿 Z 缩回兽口 ──
    const bodyK = 1 - smooth((R - 0.22) / 0.38);
    rig.body.visible = bodyK > 0.01;
    if (rig.body.visible) {
      const w = 0.55 + 0.45 * bodyK;
      rig.body.scale.set(w, w, bodyK);
    }

    // ── 刃片：数量 = 剩余飞刃（召回中按进度逐片飞回）；阵中央 / 刀尖先离开 ──
    let frac = clamp01(s.blades / Math.max(1, s.bladesMax));
    if (s.reloading && R > 0.5) frac += (1 - frac) * clamp01(s.reloadP);
    const nVis = Math.round(frac * BLADE_SHARDS);
    const canLaunch = R > 0.85 && !s.reloading;
    for (let i = 0; i < BLADE_SHARDS; i++) {
      const want = bl.rank[i] >= BLADE_SHARDS - nVis;
      if (bl.snap) {
        bl.present[i] = want;
        bl.appearT[i] = APPEAR_TIME;
        bl.launchT[i] = -1;
      } else if (want && !bl.present[i]) {
        bl.present[i] = true;
        bl.appearT[i] = 0;
        bl.launchT[i] = -1;
        bl.jit[i * 2] = Math.random() * 2 - 1;
        bl.jit[i * 2 + 1] = Math.random() * 2 - 1;
      } else if (!want && bl.present[i]) {
        bl.present[i] = false;
        bl.launchT[i] = canLaunch ? 0 : -1;
      }
    }
    this.layoutFan(dt, bl);

    const sway = 0.05 * Math.sin(time * 0.9);
    for (let i = 0; i < BLADE_SHARDS; i++) {
      const k = bl.rank[i];
      const mesh = rig.shards[i];
      let launch = bl.launchT[i];
      if (launch >= 0) {
        launch += dt;
        bl.launchT[i] = launch = launch >= LAUNCH_TIME ? -1 : launch;
      }
      mesh.visible = bl.present[i] || launch >= 0;
      if (!mesh.visible) continue;

      // 变形：自刀尖向护手依次脱离，沿上拱的弧线飞到阵位（倒放即召回重组），途中绕刃身自转一圈
      const home = rig.shardHome[i].pos;
      const start = MORPH_SHARD_START + MORPH_SHARD_STEP * (k >> 1) + 0.012 * (k & 1);
      const f = smooth((R - start) / MORPH_SHARD_FLY);
      const pos = mesh.position;
      if (f <= 0) {
        pos.copy(home);
        mesh.quaternion.identity();
      } else {
        fanSlot(bl.fanAng[i], bl.fanR[i], bl.fanDz[i], _slotP, _slotQ);
        const g = 1 - f;
        // 二次贝塞尔：控制点在两端中点上方
        const cx = (home.x + _slotP.x) * 0.5, cy = (home.y + _slotP.y) * 0.5 + 0.08, cz = (home.z + _slotP.z) * 0.5 + 0.04;
        pos.set(
          g * g * home.x + 2 * g * f * cx + f * f * _slotP.x,
          g * g * home.y + 2 * g * f * cy + f * f * _slotP.y,
          g * g * home.z + 2 * g * f * cz + f * f * _slotP.z,
        );
        mesh.quaternion.identity().slerp(_slotQ, f);
        if (f < 1) mesh.quaternion.multiply(_qSpin.setFromAxisAngle(Z_AXIS, TAU * f));
        // 悬浮：各自上下浮动，整阵缓摆
        const dx = pos.x - FAN_CENTER.x, dy = pos.y - FAN_CENTER.y;
        pos.x += -dy * sway * f;
        pos.y += (dx * sway + Math.sin(time * 2 + i) * 0.004) * f;
      }
      let scale = 1 + (FAN_SCALE - 1) * f;
      const ap = bl.appearT[i];
      if (ap < APPEAR_TIME) {
        // 飞回：从前方远处（随机偏移）射回原位并放大
        const t = ap / APPEAR_TIME;
        const ee = easeOutCubic(t);
        const u = 1 - ee;
        pos.x += (bl.jit[i * 2] * 0.12) * u;
        pos.y += (0.04 + bl.jit[i * 2 + 1] * 0.08) * u;
        pos.z += -0.55 * u;
        scale *= 0.35 + 0.65 * ee;
        mesh.quaternion.multiply(_qSpin.setFromAxisAngle(Z_AXIS, Math.PI * u));
        bl.appearT[i] = ap + dt;
      }
      if (launch >= 0) {
        // 投掷：从阵位向前射出并缩小（真正的飞刃由 Ballistics 从枪口发射）
        const t = launch / LAUNCH_TIME;
        const w = t ** 1.5;
        pos.x += (RANGED_MUZZLE.x - pos.x) * w;
        pos.y += (RANGED_MUZZLE.y - pos.y) * w;
        pos.z += (RANGED_MUZZLE.z - 0.9 - pos.z) * w;
        scale *= 1 - 0.5 * t;
      }
      mesh.scale.setScalar(scale);
    }
    bl.snap = false;

    // ── 刃片自发光：千刃形态朱红（元素色）；最后一轮（≤ 一轮的柄数）时脉动 ──
    const perVolley = e.def.projectile ? Math.max(1, e.def.projectile.count) : 3;
    const lastVolley = R > 0.5 && !s.reloading && s.blades > 0 && s.blades <= perVolley;
    const lastPulse = lastVolley ? 1.5 + 0.5 * Math.sin(time * TAU * LAST_PULSE_HZ) : 1;
    const glow = SHARD_GLOW * smooth((R - 0.3) / 0.5) * lastPulse;
    for (const m of bl.shardMats) {
      m.emissive.setHex(bl.color);
      m.emissiveIntensity = glow;
    }

    // ── 符纹亮度：呼吸；换形一击窗口内闪烁增亮；变形时 ×2.5；命中闪一下；最后一轮 ×1–2 脉动 ──
    let I = 0.85 + 0.15 * Math.sin(time * 3);
    if (s.strikeT > 0) I += (0.7 + 0.35 * Math.sin(time * 16)) * Math.min(1, s.strikeT * 4);
    if (s.morphT < 1) I += 1.5 * Math.sin(Math.PI * s.morphT);
    this.hitFlash = Math.max(0, this.hitFlash - dt / 0.12);
    I += 1.2 * this.hitFlash;
    if (s.swing >= 0) I += 0.25;
    I *= lastPulse;
    const hot = Math.max(0, I - 1) * 0.2;
    bl.runeMat.color.setHex(BLADE_RUNE_COLOR).multiplyScalar(I);
    bl.runeMat.color.r += hot;
    bl.runeMat.color.g += hot;
    bl.runeMat.color.b += hot;

    // ── 枪口：斩形态在刀尖，千刃形态在悬浮阵中心前方 ──
    e.gun.muzzle.position.lerpVectors(rig.tip, RANGED_MUZZLE, smooth(R));

    // ── 刀光拖尾（武器场景空间：root 下与 pivot 同级） ──
    this.pivot.updateMatrix();
    const pm = this.pivot.matrix;
    if (this.trailOn) {
      this.trail.push(_v2.copy(rig.trailInner).applyMatrix4(pm), _v3.copy(rig.tip).applyMatrix4(pm));
    }
    this.trail.update(dt);

    this.updateTassel(dt, rig);
  }

  /**
   * 流苏：各节方向在主场景世界空间里用阻尼弹簧追随「重力 + 速度反向」的目标方向（自上而下越来越软、越滞后），
   * 所以挥砍、转视角、移动、跳跃都会让它甩起来并回摆；再换算回各节父节点的本地旋转。
   */
  private updateTassel(dt: number, rig: BladeRig): void {
    const links = rig.tassel;
    if (links.length === 0) return;
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    // 挂点：root 空间（= 武器相机空间）→ 当作挂在主相机上换算到世界
    _v2.copy(links[0].position).applyMatrix4(this.pivot.matrix).applyMatrix4(cam.matrixWorld);
    if (!this.tasselInit || dt <= 0 || _v2.distanceToSquared(this.tasselPrev) > 2.25) {
      for (let i = 0; i < this.tasselDir.length; i++) {
        this.tasselDir[i].copy(DOWN);
        this.tasselVel[i].set(0, 0, 0);
      }
      this.tasselInit = true;
    } else {
      _v3.subVectors(_v2, this.tasselPrev).multiplyScalar(1 / dt);
      const sp = _v3.length();
      if (sp > TASSEL_VMAX) _v3.multiplyScalar(TASSEL_VMAX / sp);
      _v3.multiplyScalar(-TASSEL_DRAG).add(DOWN).normalize();
      const h = Math.min(dt, 1 / 30);
      for (let i = 0; i < this.tasselDir.length; i++) {
        const d = this.tasselDir[i], vel = this.tasselVel[i];
        const k = TASSEL_K[Math.min(i, TASSEL_K.length - 1)], c = TASSEL_C[Math.min(i, TASSEL_C.length - 1)];
        vel.x += ((_v3.x - d.x) * k - vel.x * c) * h;
        vel.y += ((_v3.y - d.y) * k - vel.y * c) * h;
        vel.z += ((_v3.z - d.z) * k - vel.z * c) * h;
        d.addScaledVector(vel, h);
        if (d.lengthSq() < 1e-8) d.copy(DOWN);
        else d.normalize();
        // 只保留切向速度（方向是单位向量）
        vel.addScaledVector(d, -vel.dot(d));
      }
    }
    this.tasselPrev.copy(_v2);
    // 父节点世界朝向：主相机 × pivot（gun.root 为单位变换）× 上一节
    _q.copy(cam.quaternion).multiply(this.pivot.quaternion);
    for (let i = 0; i < links.length; i++) {
      const d = this.tasselDir[Math.min(i, this.tasselDir.length - 1)];
      _q2.copy(_q).invert();
      _v3.copy(d).applyQuaternion(_q2).normalize();
      links[i].quaternion.setFromUnitVectors(DOWN, _v3);
      _q.multiply(links[i].quaternion);
    }
  }

  private animateParts(dt: number, e: VmEntry, s: ViewmodelState, time: number): void {
    const g = e.gun;
    const mo = this.magOut;
    // 弹匣 / 能量罐 / 弹箱
    if (g.mag && g.mag !== g.cylinder) {
      const b = e.magBase;
      switch (e.def.reloadStyle) {
        case 'cell': {
          // 顶置能量罐向上抽出，枪身下方的燃料罐向下卸出
          const up = b.y >= 0;
          g.mag.position.set(b.x + 0.03 * mo, b.y + (up ? 0.12 : -0.16) * mo, b.z);
          break;
        }
        case 'tube':
          g.mag.position.set(b.x, b.y - 0.02 * mo, b.z + 0.12 * mo);
          g.mag.visible = mo < 0.85;
          break;
        case 'box':
          g.mag.position.set(b.x - 0.02 * mo, b.y - 0.24 * mo, b.z);
          break;
        default: {
          // 枪身下方的弹匣向下抽出，顶置箭匣（弩）向上提起
          const up = b.y > 0.06;
          g.mag.position.set(b.x, b.y + (up ? 0.13 : -0.2) * mo, b.z + 0.03 * mo);
          g.mag.rotation.x = e.magRotX + (up ? -0.25 : 0.3) * mo;
          break;
        }
      }
    }
    // 转轮：每发转一格；换弹时甩出并快速旋转
    if (g.cylinder) {
      if (mo > 0.3) {
        this.cylAngle += dt * 14;
        this.cylTarget = this.cylAngle;
      } else {
        if (s.cycleIndex >= 0) {
          // 元素轮转：转轮锁定到「下一发」所在弹膛（换弹收尾时按归零后的位置），只向前转。
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
      g.cylinder.position.set(b.x - 0.045 * mo, b.y, b.z);
    }
    // 机炮转管
    if (g.spinner) g.spinner.rotation.z += s.spin * 42 * dt;
    // 霰弹泵动：开火后与装填结束时各拉一次
    if (g.pump) {
      let pz = 0;
      const t1 = (s.sinceShot - 0.12) / 0.32;
      if (t1 > 0 && t1 < 1) pz = Math.sin(t1 * Math.PI) * 0.075;
      this.rackT += dt;
      const t2 = this.rackT / 0.3;
      if (t2 < 1) pz = Math.max(pz, Math.sin(t2 * Math.PI) * 0.075);
      g.pump.position.z = e.pumpBase + pz;
    }
    // 弩：弦与箭
    if (g.stringHalves) {
      const c = smooth(s.cock);
      setCrossbowString(g, c);
      if (g.bolt) g.bolt.visible = s.cock >= 0.98;
    }
    // 元素轮转：能量槽（灵纹）显示下一发的元素
    if (s.elementHint) e.baseColor.setHex(ELEMENT_COLORS[s.elementHint]);
    // 能量槽脉动；蓄力武器随蓄力逐渐增亮，满蓄后快速闪烁
    let pulse: number;
    if (e.def.mode === 'charge' && s.firing) {
      pulse = 0.8 + 0.7 * s.spin + (s.spin >= 1 ? Math.sin(time * 34) * 0.22 : Math.sin(time * 18) * 0.06);
    } else {
      pulse = s.firing ? 1.3 + Math.sin(time * 40) * 0.25 : 0.82 + Math.sin(time * 3) * 0.14;
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
      // 蓄力：枪口聚起一团逐渐增大的灵光（能量色）
      const c = s.spin;
      this.flash.visible = true;
      this.flashMat.color.copy(e.baseColor);
      this.flashMat.opacity = 0.2 + 0.45 * c + (c >= 1 ? Math.random() * 0.2 : 0);
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
      // 蓄力辉光：灯色取能量色，峰值取该武器的开火闪光
      const cur = this.cur;
      this.light.color.copy(cur.baseColor);
      this.vmLight.color.copy(cur.baseColor);
      this.lightPeak = 6 + cur.def.flash * 60;
      i = 0.06 + 0.16 * s.spin;
    }
    if (i <= 0.001 || !this.visible) {
      this.light.intensity = 0;
      this.vmLight.intensity = 0;
      return;
    }
    this.getMuzzleWorld(this.light.position);
    this.light.intensity = i * this.lightPeak;
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
    const cam = ctx.camera;
    const e = this.cur;
    if (e) {
      e.gun.muzzle.updateWorldMatrix(true, false);
      _v.setFromMatrixPosition(e.gun.muzzle.matrixWorld);
      ctx.viewCamera.worldToLocal(_v);
    } else {
      _v.set(0.18, -0.15, -0.6);
    }
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
