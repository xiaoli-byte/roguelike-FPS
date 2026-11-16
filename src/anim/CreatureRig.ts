import * as THREE from 'three';

/**
 * 生物的运行时动画层（Unity CreatureRig.cs 逐段照译 + CreatureRigBuilder.cs 的骨骼识别），叠在动画片段之上，每帧动画求值之后：
 *   1. 脚步：每条腿向下探地，脚按「动画里离地多高」落到真实地面；支撑相锁住落脚点（防滑步）；骨盆按最需要下探 / 抬起的脚整体升降；
 *      两骨解析 IK，膝 / 肘保持动画里的弯曲平面。
 *   2. 看向：头颈链按权重转向目标，水平 ±75° / 俯仰 ±35° 限角、带阻尼；目标在身后（超过 1.6 倍限角）放开。
 *   3. 晕眩：头左右甩、骨盆打晃。
 *   4. 受击：按受击方向推开脊柱链，二阶弹簧（k 160、c 14，1/120 s 子步）回弹，最多压歪 25°。
 *   5. 弹簧骨：尾巴、飘带、耳朵、铃铛……以动画姿势为目标叠加惯性与过冲。
 * 姿势保护（Guard）：本层的修正都叠在当前姿势上；没被动画重写的骨骼每帧先还原成上一帧修正前的值，修正不会一帧帧累积。
 *
 * 坐标：Unity 左手系、glTF / three 右手系（镜像 X）。用叉积构造的转轴两边公式一样；绕固定轴（上 / 前 / 右）的转角要换号，
 * 每处都按「Unity AngleAxis(θ, a) ↔ three 绕镜像轴 −θ」换算过，注释里写了对应关系。
 * 探地走回调（GroundProbe），网页里接 CollisionWorld / 地形高度场。
 */

/** 从 (x, y, z) 竖直向下探 maxDistance 米，返回命中点高度；没打到返回 null */
export type GroundProbe = (x: number, y: number, z: number, maxDistance: number) => number | null;

export interface RigLeg {
  upper: THREE.Object3D;
  mid: THREE.Object3D;
  end: THREE.Object3D;
  /** 静止姿势下踝离地高度（设计尺寸） */
  restLift: number;
  locked: boolean;
  lockPos: THREE.Vector3;
  weight: number;
  lockBlend: number;
}

export interface SpringChain {
  family: string;
  bones: THREE.Object3D[];
  stiffness: number;
  damping: number;
  gravity: number;
  pos: THREE.Vector3[] | null;
  vel: THREE.Vector3[] | null;
}

export interface CreatureRigSpec {
  pelvis: THREE.Object3D | null;
  legs: RigLeg[];
  lookBones: THREE.Object3D[];
  spineBones: THREE.Object3D[];
  springs: SpringChain[];
  legLength: number;
}

// ───────────── 骨骼识别（CreatureRigBuilder.Setup）─────────────
const FootRe = /(^|_)(foot|paw|hoof|fhoof|hhoof)(_[LR])?$|^(Left|Right)Foot$|^leg\d+_foot_[LR]$|^leg_[LR]\d+c$/i;
const NeckRe = /^neck(_?\d+)?$/i;
const HeadRe = /^head$/i;
const SpineRe = /^(spine\d?|chest|waist|torso|body|abdomen(_?\d+)?)$/i;
const PelvisRe = /^(hips|pelvis)$/i;

/** 弹簧族：名字前缀 → (刚度, 阻尼, 重力) */
const Families: { re: RegExp; family: string; stiff: number; damp: number; gravity: number }[] = [
  { re: /^tail/i, family: 'tail', stiff: 0.2, damp: 0.12, gravity: 0 },
  { re: /^(ribbon|robe|skirt|apron|sleeve|banner|scarf|tassel|streamer|cloth)/i, family: 'cloth', stiff: 0.09, damp: 0.08, gravity: 3 },
  { re: /^ear/i, family: 'ear', stiff: 0.32, damp: 0.2, gravity: 0 },
  { re: /^(bell|chain|lock|pompom|string)/i, family: 'pendant', stiff: 0.06, damp: 0.04, gravity: 5 },
  { re: /^(mane|beard|crest|feather|quill|frill|tent|hair|braid)/i, family: 'fur', stiff: 0.22, damp: 0.15, gravity: 1 },
];

/** 不挂弹簧的链：主动控制的肢体（蝎尾弩卫的尾巴举着毒囊瞄准） */
const NoSprings: Record<string, string[]> = { SK_Enemy_ScorpionArcher: ['tail'] };

const isRenderable = (o: THREE.Object3D) => (o as THREE.Mesh).isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints;

/**
 * 按骨骼名识别结构（Tripo 语义重绑 thigh_L / fhoof_R / tail_3… 与 Mixamo LeftUpLeg / LeftFoot…）。
 * model = 骨骼所在的模型根（Unity 的 Animator 物体），在绑定姿势、单位缩放下调用（restLift / legLength 是设计尺寸）。
 */
export function buildCreatureRigSpec(model: THREE.Object3D, assetId = ''): CreatureRigSpec {
  model.updateMatrixWorld(true);
  const bones: THREE.Object3D[] = [];
  model.traverse((o) => { if (o !== model && !isRenderable(o) && !o.name.startsWith('socket_')) bones.push(o); });
  const wp = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  const rootY = wp(model).y;

  const legs: RigLeg[] = [];
  for (const foot of bones.filter((b) => FootRe.test(b.name))) {
    const mid = foot.parent;
    const upper = mid?.parent ?? null;
    if (!mid || !upper || upper === model || PelvisRe.test(mid.name) || PelvisRe.test(upper.name)) continue;
    legs.push({ upper, mid, end: foot, restLift: Math.max(0, wp(foot).y - rootY), locked: false, lockPos: new THREE.Vector3(), weight: 0, lockBlend: 0 });
  }
  let legLength = 0.5;
  let pelvis: THREE.Object3D | null = null;
  if (legs.length > 0) {
    legLength = legs.reduce((a, l) => a + wp(l.upper).distanceTo(wp(l.mid)) + wp(l.mid).distanceTo(wp(l.end)), 0) / legs.length;
    pelvis = bones.find((b) => PelvisRe.test(b.name)) ?? commonAncestor(legs.map((l) => l.upper.parent!).filter(Boolean), model);
  }

  const lookBones: THREE.Object3D[] = [];
  const head = bones.find((b) => HeadRe.test(b.name));
  if (head) {
    for (let t = head.parent; t && t !== model; t = t.parent) if (NeckRe.test(t.name)) lookBones.unshift(t);
    lookBones.push(head);
  }
  const depth = (o: THREE.Object3D) => { let d = 0; for (let t: THREE.Object3D | null = o; t; t = t.parent) d++; return d; };
  // 稳定排序（Unity OrderBy 稳定）
  const spineBones = bones.filter((b) => SpineRe.test(b.name) && b !== pelvis).map((b, i) => ({ b, i, d: depth(b) }))
    .sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.b);

  // 弹簧链：族内链头 = 父骨骼不属于同一族；分叉处主干收尾，每个分支各起一条链（主干排在分支前面）
  const springs: SpringChain[] = [];
  const grow = (start: THREE.Object3D, fam: (typeof Families)[number]) => {
    const chain = [start];
    let t = start;
    let kids: THREE.Object3D[];
    while ((kids = t.children.filter((c) => fam.re.test(c.name))).length === 1) {
      t = kids[0];
      chain.push(t);
    }
    springs.push({ family: fam.family, bones: chain, stiffness: fam.stiff, damping: fam.damp, gravity: fam.gravity, pos: null, vel: null });
    for (const k of kids) grow(k, fam);
  };
  for (const b of bones) {
    const fam = Families.find((f) => f.re.test(b.name));
    if (!fam || (b.parent && fam.re.test(b.parent.name))) continue;
    if (NoSprings[assetId]?.includes(fam.family)) continue;
    grow(b, fam);
  }
  return { pelvis, legs, lookBones, spineBones, springs, legLength };
}

function commonAncestor(ts: THREE.Object3D[], stop: THREE.Object3D): THREE.Object3D | null {
  if (ts.length === 0) return null;
  const isChildOf = (x: THREE.Object3D, p: THREE.Object3D) => { for (let t: THREE.Object3D | null = x; t; t = t.parent) if (t === p) return true; return false; };
  for (let t: THREE.Object3D | null = ts[0]; t && t !== stop.parent; t = t.parent) if (ts.every((x) => isChildOf(x, t!))) return t;
  return ts[0];
}

// ───────────── 世界空间小工具 ─────────────
const _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _pq = new THREE.Quaternion();

function worldPos(o: THREE.Object3D, out = new THREE.Vector3()) { return out.setFromMatrixPosition(o.matrixWorld); }
function worldQuat(o: THREE.Object3D, out = new THREE.Quaternion()) { o.matrixWorld.decompose(_v, out, _s); return out; }

/** 设世界朝向：local = parent⁻¹ · q；随后刷新它和子孙的世界矩阵 */
function setWorldQuat(o: THREE.Object3D, q: THREE.Quaternion) {
  if (o.parent) { worldQuat(o.parent, _pq).invert(); o.quaternion.copy(_pq.multiply(q)); } else o.quaternion.copy(q);
  o.updateMatrixWorld(true);
}

function setWorldPos(o: THREE.Object3D, p: THREE.Vector3) {
  if (o.parent) o.position.copy(o.parent.worldToLocal(_v.copy(p))); else o.position.copy(p);
  o.updateMatrixWorld(true);
}

const DEG = Math.PI / 180;
const angleBetween = (u: THREE.Vector3, v: THREE.Vector3) => {
  const d = u.length() * v.length();
  return d < 1e-10 ? 0 : Math.acos(THREE.MathUtils.clamp(u.dot(v) / d, -1, 1));
};
const moveTowards = (a: number, b: number, d: number) => (Math.abs(b - a) <= d ? b : a + Math.sign(b - a) * d);

/** Vector3.Slerp 对单位方向：按夹角球面插值 */
function slerpDir(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) {
  const ang = angleBetween(a, b);
  if (ang < 1e-6) return out.copy(b);
  const s = Math.sin(ang);
  return out.copy(a).multiplyScalar(Math.sin((1 - t) * ang) / s).addScaledVector(b, Math.sin(t * ang) / s);
}

const MaxHitAngle = 25 * DEG, MaxHitVel = 10, HitStep = 1 / 120;
const SpringStep = 1 / 120, SpringMaxAngle = 60;

export interface CreatureRigOptions {
  /** 角色根（玩法移动的物体；Unity characterRoot）。缩放（名册体型、精英）按它的世界缩放 y 换算腿长 */
  root: THREE.Object3D;
  /** 探地；不给就不做脚步 IK */
  ground?: GroundProbe | null;
  assetId?: string;
  spec?: CreatureRigSpec;
}

export class CreatureRig {
  readonly root: THREE.Object3D;
  readonly model: THREE.Object3D;
  readonly pelvis: THREE.Object3D | null;
  readonly legs: RigLeg[];
  readonly lookBones: THREE.Object3D[];
  readonly spineBones: THREE.Object3D[];
  readonly springs: SpringChain[];
  readonly legLength: number;

  ground: GroundProbe | null;
  feetIK = true;
  /** 动画里离地超过腿长这个比例就当作在空中（跳跃 / 飞行），这条腿不做 IK */
  airborneLift = 0.55;
  /** 看向目标（世界坐标）；null = 放开 */
  lookTarget: THREE.Vector3 | null = null;
  lookYawLimit = 75;
  lookPitchLimit = 35;
  lookWeight = 1;
  hitStiffness = 160;
  hitDamping = 14;
  /** 转弯倾斜（度，正 = 向右压），CreatureLocomotion 每帧设置 */
  lean = 0;
  /** 晕眩 0–1，玩法每帧设置 */
  daze = 0;

  /** 落脚：腿序号、落脚点（重型怪扬尘 / 震地） */
  onFootfall: ((leg: number, at: THREE.Vector3) => void) | null = null;

  private pelvisOffset = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private lookBlend = 0;
  private leanCur = 0;
  private dazeCur = 0;
  private time = 0;
  private readonly hitAngle = new THREE.Vector3();
  private readonly hitVel = new THREE.Vector3();
  private readonly lastRootPos = new THREE.Vector3();
  private initialized = false;

  private readonly guarded: THREE.Object3D[];
  private readonly guardBase: THREE.Quaternion[];
  private readonly guardWrote: THREE.Quaternion[];
  private readonly pelvisBase = new THREE.Vector3();
  private readonly pelvisWrote = new THREE.Vector3();
  private guardValid = false;

  constructor(model: THREE.Object3D, opts: CreatureRigOptions) {
    const spec = opts.spec ?? buildCreatureRigSpec(model, opts.assetId);
    this.model = model;
    this.root = opts.root;
    this.ground = opts.ground ?? null;
    this.pelvis = spec.pelvis;
    this.legs = spec.legs;
    this.lookBones = spec.lookBones;
    this.spineBones = spec.spineBones;
    this.springs = spec.springs;
    this.legLength = spec.legLength;
    const set: THREE.Object3D[] = [];
    const add = (t: THREE.Object3D | null | undefined) => { if (t && !set.includes(t)) set.push(t); };
    add(this.pelvis);
    for (const l of this.legs) { add(l.upper); add(l.mid); add(l.end); }
    for (const b of this.lookBones) add(b);
    for (const b of this.spineBones) add(b);
    for (const c of this.springs) for (const b of c.bones) add(b);
    this.guarded = set;
    this.guardBase = set.map(() => new THREE.Quaternion());
    this.guardWrote = set.map(() => new THREE.Quaternion());
  }

  /** 受击压歪的角度（度） */
  get hitAngleDeg() { return this.hitAngle.length() / DEG; }

  /** 一次受击：dir = 力的方向（攻击者 → 本体，世界空间），strength 0–1（≈ 伤害 / 最大生命 × 4） */
  hit(dir: THREE.Vector3, strength: number) {
    const d = _v.set(dir.x, 0, dir.z);
    if (d.lengthSq() < 1e-6) {
      // 没有方向：往身后推（Unity −Root.forward；模型前方 +Z）
      d.set(0, 0, -1).applyQuaternion(this.root.getWorldQuaternion(_pq));
      d.y = 0;
    }
    // 转轴 = 上 × 方向（叉积构造，左右手系公式相同）：身体顶部倒向受力方向
    const axis = new THREE.Vector3(0, 1, 0).cross(d.normalize());
    this.hitVel.addScaledVector(axis, THREE.MathUtils.lerp(1.2, 9, THREE.MathUtils.clamp(strength, 0, 1)));
    if (this.hitVel.length() > MaxHitVel) this.hitVel.setLength(MaxHitVel);
  }

  /** 传送 / 重生后：弹簧与脚锁重置到当前动画姿势 */
  resetState() {
    this.initialized = false;
    this.guardValid = false;
    for (const l of this.legs) { l.locked = false; l.lockBlend = 0; }
    this.pelvisOffset = 0;
    this.hitAngle.set(0, 0, 0);
    this.hitVel.set(0, 0, 0);
  }

  /** 动画求值之后调用 */
  tick(dt: number) {
    if (dt <= 0) return;
    this.time += dt;
    this.root.updateMatrixWorld(true);
    const rootPos = worldPos(this.root, new THREE.Vector3());
    if (!this.initialized || rootPos.distanceToSquared(this.lastRootPos) > 4) {
      this.initSprings();
      this.initialized = true;
    }
    this.lastRootPos.copy(rootPos);
    this.guardBegin();
    // 转弯倾斜：骨盆绕前进轴压向弯内侧（Unity AngleAxis(−lean, forward) ↔ three 绕前进轴 +lean）
    this.leanCur = THREE.MathUtils.lerp(this.leanCur, this.lean, 1 - Math.exp(-6 * dt));
    if (this.pelvis && Math.abs(this.leanCur) > 0.05) {
      const q = new THREE.Quaternion().setFromAxisAngle(this.rootAxis(0, 0, 1), this.leanCur * DEG);
      setWorldQuat(this.pelvis, q.multiply(worldQuat(this.pelvis)));
    }
    if (this.feetIK && this.ground && this.legs.length > 0 && this.pelvis) this.feet(rootPos, dt);
    if (this.lookBones.length > 0) this.look(dt);
    this.dazeStep(dt);
    this.hitReaction(dt);
    this.springStep(dt);
    this.guardEnd();
  }

  /** 角色根的世界轴（模型空间 x, y, z 转到世界、单位化） */
  private rootAxis(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).applyQuaternion(this.root.getWorldQuaternion(_pq)).normalize();
  }

  private guardBegin() {
    this.guarded.forEach((b, i) => {
      if (this.guardValid && b.quaternion.equals(this.guardWrote[i])) b.quaternion.copy(this.guardBase[i]);
      this.guardBase[i].copy(b.quaternion);
    });
    if (this.pelvis) {
      if (this.guardValid && this.pelvis.position.equals(this.pelvisWrote)) this.pelvis.position.copy(this.pelvisBase);
      this.pelvisBase.copy(this.pelvis.position);
    }
    this.root.updateMatrixWorld(true);
  }

  private guardEnd() {
    this.guarded.forEach((b, i) => this.guardWrote[i].copy(b.quaternion));
    if (this.pelvis) this.pelvisWrote.copy(this.pelvis.position);
    this.guardValid = true;
  }

  // ───────────── 脚步 ─────────────
  private feet(rootPos: THREE.Vector3, dt: number) {
    const ground = this.ground!;
    const sc = Math.max(0.01, this.root.getWorldScale(_s).y);
    const leg = this.legLength * sc;
    const floor = rootPos.y;
    const n = this.legs.length;
    // 身体离地（飞行 / 悬浮 / 跳起）：根节点比脚下地面高 12 厘米以上就不做 IK
    const under = ground(rootPos.x, rootPos.y + 0.5, rootPos.z, 0.5 + leg * 2);
    const bodyAirborne = under === null || rootPos.y - under > 0.12;
    const targets = this.legs.map(() => new THREE.Vector3());
    const weights = new Array<number>(n).fill(0);
    let minOffset = Infinity;
    let any = false;
    for (let i = 0; i < n; i++) {
      const l = this.legs[i];
      const animEnd = worldPos(l.end, new THREE.Vector3());
      const lift = animEnd.y - floor;
      const airborne = bodyAirborne || lift - l.restLift * sc > leg * this.airborneLift;
      let w = 0;
      const target = targets[i].copy(animEnd);
      const hitY = airborne ? null : ground(animEnd.x, animEnd.y + leg * 0.6, animEnd.z, leg * 1.6 + lift);
      if (hitY !== null) {
        // 落脚高度至少是「地面 + 踝高」：脚底不插进地里
        target.y = hitY + Math.max(lift, l.restLift * sc);
        w = 1;
        // 支撑相：动画里脚贴近地面就锁住世界位置；抬脚或被拉太远才松开
        const stance = lift - l.restLift * sc < leg * 0.08;
        if (stance && !l.locked) {
          l.locked = true;
          l.lockPos.copy(target);
          this.onFootfall?.(i, target.clone());
        }
        if (l.locked && (!stance || Math.hypot(l.lockPos.x - target.x, l.lockPos.z - target.z) > leg * 0.3)) l.locked = false;
        l.lockBlend = moveTowards(l.lockBlend, l.locked ? 1 : 0, dt * 8);
        if (l.lockBlend > 0) {
          target.x += (l.lockPos.x - target.x) * l.lockBlend;
          target.z += (l.lockPos.z - target.z) * l.lockBlend;
        }
        minOffset = Math.min(minOffset, target.y - animEnd.y);
        any = true;
      }
      l.weight = moveTowards(l.weight, w, dt * 6);
      weights[i] = l.weight;
    }
    // 骨盆：按最需要下探的那只脚整体升降（限幅、平滑）
    const want = any ? THREE.MathUtils.clamp(minOffset, -leg * 0.45, leg * 0.45) : 0;
    this.pelvisOffset = THREE.MathUtils.lerp(this.pelvisOffset, want, 1 - Math.exp(-12 * dt));
    const pelvis = this.pelvis!;
    setWorldPos(pelvis, worldPos(pelvis, new THREE.Vector3()).add(new THREE.Vector3(0, this.pelvisOffset, 0)));
    for (let i = 0; i < n; i++) {
      const l = this.legs[i];
      if (weights[i] <= 0.001) continue;
      const animEnd = worldPos(l.end, new THREE.Vector3());
      const up = worldPos(l.upper, new THREE.Vector3()), mid = worldPos(l.mid, new THREE.Vector3());
      // 够不着（腾跃、扑击）：这一帧当作没着地
      const reach = up.distanceTo(mid) + mid.distanceTo(animEnd);
      if (up.distanceTo(targets[i]) > reach * 0.98) {
        l.locked = false;
        l.weight = Math.min(l.weight, 0.5);
        continue;
      }
      solveTwoBone(l.upper, l.mid, l.end, animEnd.lerp(targets[i], weights[i]));
    }
  }

  // ───────────── 看向 ─────────────
  private look(dt: number) {
    let wantYaw = 0, wantPitch = 0, wantBlend = 0;
    const head = this.lookBones[this.lookBones.length - 1];
    if (this.lookTarget && head) {
      const dir = this.lookTarget.clone().sub(worldPos(head));
      const local = dir.applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()).invert());
      // three：yaw 正 = 目标在 +X（Unity 的左），绕上轴 +yaw 正好转过去（Unity yaw = −这里的 yaw）
      const yaw = Math.atan2(local.x, local.z) / DEG;
      const pitch = -Math.atan2(local.y, Math.hypot(local.x, local.z)) / DEG;
      wantBlend = (Math.abs(yaw) < this.lookYawLimit * 1.6 ? this.lookWeight : 0) * (1 - this.dazeCur);
      wantYaw = THREE.MathUtils.clamp(yaw, -this.lookYawLimit, this.lookYawLimit);
      wantPitch = THREE.MathUtils.clamp(pitch, -this.lookPitchLimit, this.lookPitchLimit);
    }
    const k = 1 - Math.exp(-6 * dt);
    this.lookYaw = THREE.MathUtils.lerp(this.lookYaw, wantYaw, k);
    this.lookPitch = THREE.MathUtils.lerp(this.lookPitch, wantPitch, k);
    this.lookBlend = THREE.MathUtils.lerp(this.lookBlend, wantBlend, k);
    if (this.lookBlend < 1e-3) return;
    // Unity AngleAxis(yaw, up) · AngleAxis(pitch, right) ↔ three 绕上轴 yaw · 绕模型 +X（three 的左 = Unity 右的镜像，角度再换号）pitch
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.lookYaw * this.lookBlend * DEG)
      .multiply(new THREE.Quaternion().setFromAxisAngle(this.rootAxis(1, 0, 0), this.lookPitch * this.lookBlend * DEG));
    // 沿链分摊：每节 1/n，子骨骼继承父骨骼的转动
    const share = new THREE.Quaternion().slerp(q, 1 / this.lookBones.length);
    for (const b of this.lookBones) setWorldQuat(b, share.clone().multiply(worldQuat(b)));
  }

  // ───────────── 晕眩 ─────────────
  private dazeStep(dt: number) {
    this.dazeCur = moveTowards(this.dazeCur, THREE.MathUtils.clamp(this.daze, 0, 1), dt * 4);
    if (this.dazeCur < 0.01) return;
    const t = this.time;
    // Unity 绕固定轴的角度在 three 里换号（同一个摆动、同相位）
    if (this.pelvis) setWorldQuat(this.pelvis, new THREE.Quaternion().setFromAxisAngle(this.rootAxis(0, 0, 1), -Math.sin(t * 7) * 4.6 * this.dazeCur * DEG).multiply(worldQuat(this.pelvis)));
    const head = this.lookBones[this.lookBones.length - 1];
    const up = this.rootAxis(0, 1, 0);
    if (head) setWorldQuat(head, new THREE.Quaternion().setFromAxisAngle(up, -Math.sin(t * 11) * 20 * this.dazeCur * DEG).multiply(worldQuat(head)));
    if (this.lookBones.length > 1) {
      const neck = this.lookBones[0];
      setWorldQuat(neck, new THREE.Quaternion().setFromAxisAngle(up, -Math.sin(t * 11 - 0.6) * 8 * this.dazeCur * DEG).multiply(worldQuat(neck)));
    }
  }

  // ───────────── 受击 ─────────────
  private hitReaction(dt: number) {
    // 二阶弹簧 θ'' = −kθ − cθ'，1/120 s 定步长子步（低帧率下单步显式积分会发散）
    const steps = THREE.MathUtils.clamp(Math.ceil(dt / HitStep), 1, 30);
    const h = dt / steps;
    const acc = new THREE.Vector3();
    for (let i = 0; i < steps; i++) {
      acc.copy(this.hitAngle).multiplyScalar(-this.hitStiffness).addScaledVector(this.hitVel, -this.hitDamping);
      this.hitVel.addScaledVector(acc, h);
      this.hitAngle.addScaledVector(this.hitVel, h);
    }
    if (this.hitAngle.length() > MaxHitAngle) {
      this.hitAngle.setLength(MaxHitAngle);
      const n = this.hitAngle.clone().normalize();
      const outward = this.hitVel.dot(n);
      if (outward > 0) this.hitVel.addScaledVector(n, -outward);
    }
    const ang = this.hitAngle.length();
    if (ang < 1e-4) return;
    const chain = this.spineBones.length > 0 ? this.spineBones : this.pelvis ? [this.pelvis] : [];
    const q = new THREE.Quaternion().setFromAxisAngle(this.hitAngle.clone().divideScalar(ang), ang / Math.max(1, chain.length));
    for (const b of chain) setWorldQuat(b, q.clone().multiply(worldQuat(b)));
  }

  // ───────────── 弹簧骨 ─────────────
  private initSprings() {
    for (const s of this.springs) {
      s.pos = s.bones.map((_, i) => this.tip(s, i));
      s.vel = s.bones.map(() => new THREE.Vector3());
    }
  }

  /** 第 i 节骨骼的末端：下一节的位置；最后一节沿上一节方向外推一半 */
  private tip(s: SpringChain, i: number): THREE.Vector3 {
    const b = s.bones[i];
    if (i + 1 < s.bones.length) return worldPos(s.bones[i + 1]);
    const bp = worldPos(b);
    const upAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuat(b));
    const p = b.parent ? worldPos(b.parent) : bp.clone().addScaledVector(upAxis, -0.05);
    const d = bp.clone().sub(p);
    return d.lengthSq() > 1e-8 ? bp.addScaledVector(d, 0.5) : bp.addScaledVector(upAxis, 0.05);
  }

  /**
   * 每节末端一个质点，二阶弹簧追向动画姿势里的末端（固有频率 ω = 32·√刚度，阻尼比 ζ = 0.35 + 2·阻尼，1/120 s 子步），
   * 约束骨长、最大偏摆 60°，再把骨骼转向质点
   */
  private springStep(dt: number) {
    if (dt > 0.25) { this.initSprings(); return; }
    const steps = THREE.MathUtils.clamp(Math.ceil(dt / SpringStep), 1, 30);
    const h = dt / steps;
    const acc = new THREE.Vector3(), off = new THREE.Vector3(), dir = new THREE.Vector3(), rest = new THREE.Vector3();
    for (const s of this.springs) {
      if (!s.pos || s.pos.length !== s.bones.length || !s.vel) { this.initSprings(); return; }
      const w = 32 * Math.sqrt(Math.max(0.01, s.stiffness));
      const zeta = 0.35 + 2 * s.damping;
      const k = w * w, c = 2 * zeta * w;
      for (let i = 0; i < s.bones.length; i++) {
        const b = s.bones[i];
        const target = this.tip(s, i);
        const origin = worldPos(b);
        const len = target.distanceTo(origin);
        if (len < 1e-5) continue;
        const x = s.pos[i], v = s.vel[i];
        for (let j = 0; j < steps; j++) {
          acc.copy(target).sub(x).multiplyScalar(k).addScaledVector(v, -c);
          acc.y -= s.gravity;
          v.addScaledVector(acc, h);
          x.addScaledVector(v, h);
        }
        off.copy(x).sub(origin);
        rest.copy(target).sub(origin).divideScalar(len);
        if (off.lengthSq() > 1e-10) dir.copy(off).normalize(); else dir.copy(rest);
        const ang = angleBetween(rest, dir) / DEG;
        if (ang > SpringMaxAngle) slerpDir(rest, dir, SpringMaxAngle / ang, dir).normalize();
        x.copy(origin).addScaledVector(dir, len);
        v.addScaledVector(dir, -v.dot(dir));
        setWorldQuat(b, new THREE.Quaternion().setFromUnitVectors(rest, dir).multiply(worldQuat(b)));
      }
    }
  }
}

/** 两骨解析 IK：转 upper、mid 让 end 的关节点到 t；弯曲平面取当前（动画）姿势，脚掌保持动画朝向 */
export function solveTwoBone(A: THREE.Object3D, B: THREE.Object3D, C: THREE.Object3D, t: THREE.Vector3) {
  const a = worldPos(A), b = worldPos(B), c = worldPos(C);
  const lab = b.distanceTo(a), lcb = c.distanceTo(b);
  if (lab < 1e-4 || lcb < 1e-4) return;
  const lat = THREE.MathUtils.clamp(t.distanceTo(a), 1e-4, lab + lcb - 1e-4);
  const ca = c.clone().sub(a), ba = b.clone().sub(a), ta = t.clone().sub(a);
  const acab0 = angleBetween(ca, ba), babc0 = angleBetween(a.clone().sub(b), c.clone().sub(b)), acat0 = angleBetween(ca, ta);
  const acab1 = Math.acos(THREE.MathUtils.clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
  const babc1 = Math.acos(THREE.MathUtils.clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
  const axis0 = ca.clone().cross(ba);
  if (axis0.lengthSq() < 1e-10) axis0.copy(ca).cross(new THREE.Vector3(0, 0, 1).applyQuaternion(worldQuat(A)));
  axis0.normalize();
  const axis1 = ca.clone().cross(ta);
  const r2 = axis1.lengthSq() > 1e-10 ? new THREE.Quaternion().setFromAxisAngle(axis1.normalize(), acat0) : new THREE.Quaternion();
  const r0 = new THREE.Quaternion().setFromAxisAngle(axis0, acab1 - acab0);
  const r1 = new THREE.Quaternion().setFromAxisAngle(axis0, babc1 - babc0);
  const aG = worldQuat(A), bG = worldQuat(B), cG = worldQuat(C);
  setWorldQuat(A, r2.clone().multiply(r0).multiply(aG));
  setWorldQuat(B, r2.clone().multiply(r0).multiply(r1).multiply(bG));
  setWorldQuat(C, cG);
}
