/**
 * 熔心魔将的姿势解算（art/source/characters/SK_Boss_Warlord/anim/warlord_anims_humanoid.py 的 build / Rest 逐步照译，Blender → three）：
 * 把 WarlordPoses.ts 的骨架无关姿势解成 v006 人形骨架上各骨的局部旋转，片段的关键帧在网页里现场烘焙（{@link bakeClip}），运行时按帧插值。
 *   放松底姿 → 髋（平移 / 转身 / 前倾，脚够不着地时把髋往下放）→ 上身 → 头 → 右臂（grip 两骨 IK 或直接给方向）→ 握剑（整只右手按剑身 / 刃朝向转，
 *   socket_sword 相对右手固定握法）→ 左手握剑柄（够不着时把整副握法往左肩挪，最多 6 次）→ 肩甲跟上臂 → 五指收拳 → 腿（IK 踩回地面、脚掌放平 / 悬空腿）。
 * 坐标：Blender（角色朝 −Y、右手 −X、Z 上）→ three 模型空间（X = 生物左、Y = 上、Z = 前）：(x, y, z)_b → (x, z, −y)_t，是正交旋转，叉积与转向不变。
 * 解算在一份脱离场景的骨架副本上做（根节点在原点：世界空间 = 模型空间），只读写骨骼的局部变换。
 */
import * as THREE from 'three';
import { CLIPS, type Clip, type Pose, type V3 } from './WarlordPoses';

/** 左拳握心离右拳握心（米，往剑首方向）、手的转动里分给小臂的比例、肩甲跟上臂的比例 */
const L_GRIP = 0.27, FOREARM_TWIST = 0.6, PAULDRON_FOLLOW = 0.45;
/** 握剑的五指弯曲（度：第 1 / 2 节；拇指另给）、放松的手 */
const FIST: readonly [number, number] = [42, 52], FIST_THUMB: readonly [number, number] = [25, 30], RELAXED: readonly [number, number] = [16, 20];
/** 待机放松的手臂方向（角色坐标；绑定姿势是 A 字，姿势没写到的那只手先垂下来） */
const REST_RELAX: readonly (readonly [string, V3])[] = [
  ['arm_R', [0.28, 0.05, -0.96]], ['forearm_R', [0.2, 0.25, -0.95]], ['arm_L', [-0.28, 0.05, -0.96]], ['forearm_L', [-0.2, 0.25, -0.95]],
];
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
const SIDES = ['L', 'R'] as const;
type Side = typeof SIDES[number];

/** 每个关键帧都写的骨（弹簧链、锁骨、其余挂点不写） */
export const KEYED: readonly string[] = [
  'hips', 'spine', 'chest', 'neck', 'head', 'socket_sword',
  ...['arm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'pauldron'].flatMap(b => SIDES.map(s => `${b}_${s}`)),
  ...FINGERS.flatMap(f => [1, 2].flatMap(k => SIDES.map(s => `${f}_${k}_${s}`))),
];

/** 姿势解算必需的骨（缺了就不解，退回程序化体） */
export const REQUIRED: readonly string[] = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'socket_sword', 'socket_sword_tip', 'socket_core', 'socket_helm',
  ...['shoulder', 'arm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'pauldron'].flatMap(b => SIDES.map(s => `${b}_${s}`)),
  ...SIDES.flatMap(s => [`index_1_${s}`, `middle_1_${s}`, `pinky_1_${s}`]),
];

/** 骨头的「尾」= 它指向的子关节（Blender 的 tail；glTF 里没有尾，用子骨的位置） */
const TAIL: Readonly<Record<string, string>> = {
  arm_R: 'forearm_R', forearm_R: 'hand_R', arm_L: 'forearm_L', forearm_L: 'hand_L',
  thigh_R: 'shin_R', shin_R: 'foot_R', thigh_L: 'shin_L', shin_L: 'foot_L',
  ...Object.fromEntries(FINGERS.flatMap(f => SIDES.map(s => [`${f}_1_${s}`, `${f}_2_${s}`]))),
};

const UP = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0), ROLL = new THREE.Vector3(0, 0, -1);
const DEG = Math.PI / 180;

/** 角色坐标（右、前、上）→ 模型空间方向（单位向量） */
export function D(v: V3): THREE.Vector3 {
  return new THREE.Vector3(-v[0], v[2], v[1]).normalize();
}

/** 角色坐标的偏移（不归一化） */
function off3(r: number, f: number, u: number): THREE.Vector3 {
  return new THREE.Vector3(-r, u, f);
}

/** 正交基（列）：u、v 去掉 u 分量、u × v（同 Python 的 frame） */
function frame(u: THREE.Vector3, v: THREE.Vector3): THREE.Matrix4 {
  const a = u.clone().normalize();
  const b = v.clone().addScaledVector(a, -v.dot(a));
  if (b.lengthSq() < 1e-12) {
    b.set(1, 0, 0);
    if (Math.abs(a.x) > 0.9) b.set(0, 1, 0);
    b.addScaledVector(a, -b.dot(a));
  }
  b.normalize();
  const c = a.clone().cross(b);
  return new THREE.Matrix4().makeBasis(a, b, c);
}

function col(m: THREE.Matrix4, i: number): THREE.Vector3 {
  const e = m.elements;
  return new THREE.Vector3(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]);
}

function quatOf(m: THREE.Matrix4): THREE.Quaternion {
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** 一帧烘好的姿势：KEYED 各骨的局部旋转 + 髋的局部位置 */
export interface BakedPose {
  q: Map<string, THREE.Quaternion>;
  hips: THREE.Vector3;
}

/** 一段片段烘好的关键帧 */
export interface BakedClip {
  frames: number;
  keys: { frame: number; pose: BakedPose }[];
}

/**
 * 姿势解算器：skeleton 是脱离场景的骨架副本（根在原点、无缩放），按骨骼名找骨。
 */
export class WarlordPoser {
  private readonly bones = new Map<string, THREE.Object3D>();
  private readonly restQ = new Map<string, THREE.Quaternion>();
  private readonly restP = new Map<string, THREE.Vector3>();
  // 静止姿势里量出来的东西
  private readonly sole: Record<Side, THREE.Vector3> = {} as never;
  private readonly footQ: Record<Side, THREE.Quaternion> = {} as never;
  private readonly handM: Record<Side, THREE.Quaternion> = {} as never;
  private readonly gripFrame: Record<Side, THREE.Matrix4> = {} as never;
  private readonly knuckle: Record<Side, THREE.Vector3> = {} as never;
  private readonly fist: Record<Side, THREE.Vector3> = {} as never;
  private readonly curl: Record<Side, Record<string, THREE.Vector3>> = { L: {}, R: {} };
  private readonly shoulderM: Record<Side, THREE.Quaternion> = {} as never;
  private readonly armDir: Record<Side, THREE.Vector3> = {} as never;
  private sockM = new THREE.Quaternion();
  private sockS = new THREE.Quaternion();
  readonly missing: string[];

  constructor(private readonly root: THREE.Object3D) {
    root.traverse((o) => {
      if (o.name && !this.bones.has(o.name)) {
        this.bones.set(o.name, o);
        this.restQ.set(o.name, o.quaternion.clone());
        this.restP.set(o.name, o.position.clone());
      }
    });
    this.missing = REQUIRED.filter(n => !this.bones.has(n));
    if (this.missing.length === 0) this.measureRest();
  }

  get ok(): boolean {
    return this.missing.length === 0;
  }

  /** 从一份骨骼层级（Bone 树或任何 Object3D 树）拷一份脱离场景的骨架做解算 */
  static fromBones(rootBone: THREE.Object3D): WarlordPoser {
    const copy = cloneTree(rootBone);
    copy.position.set(0, 0, 0);
    copy.quaternion.identity();
    copy.scale.set(1, 1, 1);
    copy.updateMatrixWorld(true);
    return new WarlordPoser(copy);
  }

  bone(name: string): THREE.Object3D | null {
    return this.bones.get(name) ?? null;
  }

  // ───────────── 骨骼工具（世界空间 = 模型空间） ─────────────

  private b(name: string): THREE.Object3D {
    const b = this.bones.get(name);
    if (!b) throw new Error(`[WarlordPoser] 缺骨 ${name}`);
    return b;
  }

  pos(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.b(name);
    b.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(b.matrixWorld);
  }

  private wq(name: string, out = new THREE.Quaternion()): THREE.Quaternion {
    const b = this.b(name);
    b.updateWorldMatrix(true, false);
    return b.getWorldQuaternion(out);
  }

  private setWorldQ(name: string, q: THREE.Quaternion): void {
    const b = this.b(name);
    const pq = b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    b.quaternion.copy(pq.invert().multiply(q)).normalize();
    b.updateMatrixWorld(true);
  }

  /** 绕骨头自己的关节转 q（世界空间；子骨跟着转） */
  private rotAboutHead(name: string, q: THREE.Quaternion): void {
    this.setWorldQ(name, q.clone().multiply(this.wq(name)));
  }

  private turn(name: string, axis: THREE.Vector3, deg: number): void {
    if (Math.abs(deg) > 1e-4) this.rotAboutHead(name, new THREE.Quaternion().setFromAxisAngle(axis, deg * DEG));
  }

  private len(name: string): number {
    return this.pos(name).distanceTo(this.pos(TAIL[name]));
  }

  private vec(name: string): THREE.Vector3 {
    return this.pos(TAIL[name]).sub(this.pos(name));
  }

  private aim(name: string, target: THREE.Vector3, share = 1, limitDeg = 180): void {
    const v = this.vec(name);
    if (v.lengthSq() < 1e-12 || target.lengthSq() < 1e-12) return;
    const q = new THREE.Quaternion().setFromUnitVectors(v.normalize(), target.clone().normalize());
    const { axis, angle } = axisAngle(q);
    const ang = Math.min(angle * share, limitDeg * DEG);
    if (ang > 1e-5) this.rotAboutHead(name, new THREE.Quaternion().setFromAxisAngle(axis, ang));
  }

  /** 骨头此刻相对静止姿势的转动（世界空间） */
  private rel(name: string, rest: THREE.Quaternion): THREE.Quaternion {
    return this.wq(name).multiply(rest.clone().invert());
  }

  /** 全部骨骼回到绑定姿势 */
  reset(): void {
    for (const [name, b] of this.bones) {
      b.quaternion.copy(this.restQ.get(name)!);
      b.position.copy(this.restP.get(name)!);
    }
    this.root.updateMatrixWorld(true);
  }

  private measureRest(): void {
    this.reset();
    const sock = this.pos('socket_sword');
    for (const s of SIDES) {
      this.sole[s] = this.pos(`foot_${s}`);
      this.footQ[s] = this.wq(`foot_${s}`);
      this.handM[s] = this.wq(`hand_${s}`);
      const lat = this.pos(`pinky_1_${s}`).sub(this.pos(`index_1_${s}`));
      const knk = this.pos(`middle_1_${s}`).sub(this.pos(`hand_${s}`));
      this.gripFrame[s] = frame(lat, knk);
      this.knuckle[s] = col(this.gripFrame[s], 1);
      const n = col(this.gripFrame[s], 2);
      if (n.x * (s === 'L' ? 1 : -1) > 0) n.negate(); // 掌心朝身体内侧
      const c = s === 'R' ? sock.clone() : new THREE.Vector3(-sock.x, sock.y, sock.z);
      this.fist[s] = c.sub(this.pos(`hand_${s}`));
      for (const f of FINGERS) {
        const first = `${f}_1_${s}`;
        if (!this.bones.has(first) || !this.bones.has(`${f}_2_${s}`)) continue;
        const v = this.vec(first).normalize();
        let to: THREE.Vector3;
        if (f === 'thumb' && this.bones.has(`middle_2_${s}`)) {
          const t = this.pos(`middle_2_${s}`).sub(this.pos(`thumb_2_${s}`));
          to = t.addScaledVector(v, -t.dot(v)).normalize();
        } else to = n.clone();
        this.curl[s][f] = v.clone().cross(to).normalize();
      }
      this.shoulderM[s] = this.wq(`shoulder_${s}`);
      this.armDir[s] = this.vec(`arm_${s}`).normalize();
    }
    this.sockM = this.wq('socket_sword');
    // 握法（常量）：静止姿势里剑身朝下（−Y）、刃朝 ±X；握住时剑首方向（+Y）= 右手食指→小指，刃（X）= 指节方向
    const m = frame(col(this.gripFrame.R, 0), this.knuckle.R).multiply(frame(UP, AX).transpose());
    this.sockS = quatOf(m);
  }

  // ───────────── 握剑 / 两骨 IK ─────────────

  /** 手转到「相对静止姿势转 R」：其中绕小臂轴的那一份先按 FOREARM_TWIST 分给小臂，再把手精确对上 */
  private placeHand(s: Side, R: THREE.Quaternion): void {
    const target = R.clone().multiply(this.handM[s]);
    const delta = target.clone().multiply(this.wq(`hand_${s}`).invert());
    const ax = this.pos(`hand_${s}`).sub(this.pos(`forearm_${s}`)).normalize();
    const pv = new THREE.Vector3(delta.x, delta.y, delta.z);
    const proj = ax.clone().multiplyScalar(pv.dot(ax));
    const tw = new THREE.Quaternion(proj.x, proj.y, proj.z, delta.w);
    if (tw.length() > 1e-6) {
      tw.normalize();
      const { axis, angle } = axisAngle(tw, true);
      if (Math.abs(angle) > 1e-4) this.rotAboutHead(`forearm_${s}`, new THREE.Quaternion().setFromAxisAngle(axis, angle * FOREARM_TWIST));
    }
    this.setWorldQ(`hand_${s}`, target);
  }

  /** 握剑的手相对静止姿势的转动：食指→小指方向 = 剑首方向（−b），指节朝 knuckle */
  private gripRot(s: Side, b: THREE.Vector3, knuckle: THREE.Vector3): THREE.Quaternion {
    return quatOf(frame(b.clone().negate(), knuckle).multiply(this.gripFrame[s].clone().transpose()));
  }

  /** 右手按剑身方向 b（和刃朝向 e，可无）整只转过去，socket_sword 相对右手固定；返回右手此刻的指节方向 */
  private holdSword(b: THREE.Vector3, e: THREE.Vector3 | null): THREE.Vector3 {
    const cur = this.knuckle.R.clone().applyQuaternion(this.rel('hand_R', this.handM.R));
    const L = b.clone().normalize().negate();
    const want = e ?? cur;
    let k = want.clone().addScaledVector(L, -want.dot(L));
    if (k.length() < 1e-4) k = cur.clone().addScaledVector(L, -cur.dot(L));
    k.normalize();
    if (k.dot(cur) < 0) k.negate(); // 两面刃：取离当前手腕近的那一面
    this.placeHand('R', this.gripRot('R', b, k));
    const R = this.rel('hand_R', this.handM.R);
    this.setWorldQ('socket_sword', R.clone().multiply(this.sockS).multiply(this.sockM));
    return this.knuckle.R.clone().applyQuaternion(R);
  }

  private followPauldrons(): void {
    for (const s of SIDES) {
      const a0 = this.armDir[s].clone().applyQuaternion(this.rel(`shoulder_${s}`, this.shoulderM[s])).normalize();
      const a1 = this.vec(`arm_${s}`).normalize();
      const full = new THREE.Quaternion().setFromUnitVectors(a0, a1);
      const part = new THREE.Quaternion().slerp(full, PAULDRON_FOLLOW);
      if (axisAngle(part).angle > 1e-4) this.rotAboutHead(`pauldron_${s}`, part);
    }
  }

  /** 两骨 IK：end 的关节（手腕 / 脚踝）放到 target，中间关节朝 pole */
  private twoBone(upper: string, lower: string, end: string, target: THREE.Vector3, pole: THREE.Vector3): void {
    const a = this.pos(upper);
    const l1 = this.pos(lower).distanceTo(a), l2 = this.pos(end).distanceTo(this.pos(lower));
    const t = target.clone().sub(a);
    const d = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(l1 + l2 - 1e-3, t.length()));
    const u = t.lengthSq() > 1e-12 ? t.normalize() : new THREE.Vector3(0, -1, 0);
    let w = pole.clone().addScaledVector(u, -pole.dot(u));
    w = w.lengthSq() > 1e-12 ? w.normalize() : new THREE.Vector3(0, 0, 1);
    const x = (d * d + l1 * l1 - l2 * l2) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const joint = a.clone().addScaledVector(u, x).addScaledVector(w, h);
    this.aim(upper, joint.clone().sub(a));
    this.aim(lower, a.clone().addScaledVector(u, d).sub(this.pos(lower)));
  }

  private fingers(s: Side, curl: readonly [number, number], thumb: readonly [number, number]): void {
    const R = this.rel(`hand_${s}`, this.handM[s]);
    for (const f of FINGERS) {
      const axis = this.curl[s][f];
      if (!axis) continue;
      const [a, b] = f === 'thumb' ? thumb : curl;
      const ax = axis.clone().applyQuaternion(R);
      this.turn(`${f}_1_${s}`, ax, a);
      this.turn(`${f}_2_${s}`, ax, b);
    }
  }

  // ───────────── 一个姿势 ─────────────

  /** 解一个姿势（骨架停在这个姿势上，返回 KEYED 各骨的局部旋转与髋的位置） */
  build(p: Pose): BakedPose {
    this.reset();
    for (const [name, v] of REST_RELAX) this.aim(name, D(v));
    const drop = p.drop ?? 0, fwd = p.fwd ?? 0, yaw = p.yaw ?? 0;
    const hips = this.b('hips');
    hips.position.add(new THREE.Vector3(0, -drop, fwd));
    hips.updateMatrixWorld(true);
    this.turn('hips', UP, yaw);
    this.turn('hips', AX, p.hips ?? 0);
    const spin = new THREE.Quaternion().setFromAxisAngle(UP, yaw * DEG);
    const soleOf = (s: Side): THREE.Vector3 => {
      const o = p.feet?.[s] ?? [0, 0];
      return this.sole[s].clone().add(off3(o[0], o[1], o[2] ?? 0)).applyQuaternion(spin);
    };
    if (!p.air) {
      // 脚要踩得到地：髋往上提或脚往外放时两骨 IK 够不着，把髋往下放到正好够得着（只改髋高）
      let lower = 0;
      for (const s of SIDES) {
        const d = soleOf(s).sub(this.pos(`thigh_${s}`));
        const reach = this.pos(`shin_${s}`).distanceTo(this.pos(`thigh_${s}`)) + this.pos(`foot_${s}`).distanceTo(this.pos(`shin_${s}`)) - 0.012;
        const horiz = Math.hypot(d.x, d.z);
        if (d.length() > reach && horiz < reach) lower = Math.max(lower, -Math.sqrt(reach * reach - horiz * horiz) - d.y);
      }
      if (lower > 1e-4) {
        hips.position.y -= lower;
        hips.updateMatrixWorld(true);
      }
    }
    for (const [bone, share] of [['spine', 0.4], ['chest', 0.6]] as const) {
      this.turn(bone, UP, (p.twist ?? 0) * share);
      this.turn(bone, ROLL, (p.roll ?? 0) * share);
      this.turn(bone, AX, (p.pitch ?? 0) * share);
    }
    const [hp, hy] = p.head ?? [0, 0];
    for (const [bone, share] of [['neck', 0.3], ['head', 0.7]] as const) {
      this.turn(bone, UP, hy * share);
      this.turn(bone, AX, hp * share);
    }
    // 双手握剑时左手要够得着剑柄：够不着时把整副握法沿「左手腕目标 → 左肩」挪过去，重解右臂，剑的方向、刃朝向不变
    const snap = new Map<string, [THREE.Quaternion, THREE.Vector3]>();
    for (const [name, b] of this.bones) snap.set(name, [b.quaternion.clone(), b.position.clone()]);
    const shift = new THREE.Vector3();
    const b = p.sword ? D(p.sword) : new THREE.Vector3(0, -1, 0);
    let RL: THREE.Quaternion | null = null;
    let wrist = new THREE.Vector3();
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt) {
        for (const [name, bn] of this.bones) {
          const [q, pp] = snap.get(name)!;
          bn.quaternion.copy(q);
          bn.position.copy(pp);
        }
        this.root.updateMatrixWorld(true);
      }
      if (p.grip) {
        const g = p.grip;
        const mid = this.pos('arm_L').add(this.pos('arm_R')).multiplyScalar(0.5);
        this.twoBone('arm_R', 'forearm_R', 'hand_R', mid.add(off3(g[0], g[1], g[2])).add(shift), D([1, -0.2, -0.6]));
      } else {
        if (p.arm_R) this.aim('arm_R', D(p.arm_R));
        if (p.fore_R) this.aim('forearm_R', D(p.fore_R));
        if (shift.lengthSq() > 1e-8) {
          const elbow = this.pos('forearm_R').sub(this.pos('arm_R'));
          this.twoBone('arm_R', 'forearm_R', 'hand_R', this.pos('hand_R').add(shift), elbow);
        }
      }
      const knuckle = this.holdSword(b, p.edge ? D(p.edge) : null);
      if (!p.grip_L) break;
      // 左拳握心放到剑柄上（右拳往剑首 L_GRIP 米），指节和右手同一侧；反解左手腕
      RL = this.gripRot('L', b, knuckle);
      const fist = this.pos('socket_sword').addScaledVector(b.clone().normalize(), -L_GRIP);
      wrist = fist.sub(this.fist.L.clone().applyQuaternion(RL));
      const sh = this.pos('arm_L');
      const over = wrist.distanceTo(sh) - (this.len('arm_L') + this.len('forearm_L') - 0.01);
      if (over <= 0.01) break;
      shift.add(sh.clone().sub(wrist).normalize().multiplyScalar(over));
    }
    if (p.grip_L && RL) {
      this.twoBone('arm_L', 'forearm_L', 'hand_L', wrist, D([-0.8, -0.3, -0.5]));
      this.placeHand('L', RL);
    } else {
      if (p.arm_L) this.aim('arm_L', D(p.arm_L));
      if (p.fore_L) this.aim('forearm_L', D(p.fore_L));
    }
    this.followPauldrons();
    this.fingers('R', FIST, FIST_THUMB);
    this.fingers('L', p.grip_L ? FIST : RELAXED, p.grip_L ? FIST_THUMB : RELAXED);
    if (p.air) {
      const [th, shn] = p.legs ?? [0, 0];
      for (const s of SIDES) {
        this.turn(`thigh_${s}`, AX, -th);
        this.turn(`shin_${s}`, AX, shn);
      }
    } else {
      const pole = new THREE.Vector3(0, 0.15, 1).applyQuaternion(spin);
      for (const s of SIDES) {
        this.twoBone(`thigh_${s}`, `shin_${s}`, `foot_${s}`, soleOf(s), pole);
        // 脚掌放平：脚的世界朝向回到静止姿势（跟着转身转）
        this.setWorldQ(`foot_${s}`, spin.clone().multiply(this.footQ[s]));
      }
    }
    return this.capture();
  }

  private capture(): BakedPose {
    const q = new Map<string, THREE.Quaternion>();
    for (const name of KEYED) {
      const b = this.bones.get(name);
      if (b) q.set(name, b.quaternion.clone());
    }
    return { q, hips: this.b('hips').position.clone() };
  }

  /** 烘一段片段的全部关键帧 */
  bake(clip: Clip): BakedClip {
    const keys = clip.keys.map(([frame, pose]) => ({ frame, pose: this.build(pose) }));
    this.reset();
    return { frames: clip.frames, keys };
  }
}

/** 四元数 → 轴角（角度 0–π；signed = true 时 w < 0 的取 θ − 2π，同 Python 的 tw.angle > π 时减 2π） */
function axisAngle(q: THREE.Quaternion, signed = false): { axis: THREE.Vector3; angle: number } {
  const s = Math.hypot(q.x, q.y, q.z);
  if (s < 1e-9) return { axis: new THREE.Vector3(1, 0, 0), angle: 0 };
  let angle = 2 * Math.atan2(s, q.w);
  const axis = new THREE.Vector3(q.x / s, q.y / s, q.z / s);
  if (angle > Math.PI) {
    if (signed) angle -= 2 * Math.PI;
    else {
      angle = 2 * Math.PI - angle;
      axis.negate();
    }
  }
  return { axis, angle };
}

/** 只拷名字与变换的骨架树（不带网格、蒙皮） */
function cloneTree(src: THREE.Object3D): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = src.name;
  o.position.copy(src.position);
  o.quaternion.copy(src.quaternion);
  o.scale.copy(src.scale);
  for (const c of src.children) {
    if ((c as THREE.Mesh).isMesh) continue;
    o.add(cloneTree(c));
  }
  return o;
}

// ───────────── 烘焙缓存（同一份资产所有实例共用） ─────────────

const baked = new Map<string, BakedClip>();
let bakedSignature = '';

/** 某段片段烘好的关键帧（第一次用到时烘；poser 换了骨架时清缓存） */
export function bakeClip(poser: WarlordPoser, state: string, signature: string): BakedClip | null {
  if (!poser.ok) return null;
  if (signature !== bakedSignature) {
    baked.clear();
    bakedSignature = signature;
  }
  let c = baked.get(state);
  if (c) return c;
  const clip = CLIPS[state];
  if (!clip) return null;
  c = poser.bake(clip);
  baked.set(state, c);
  return c;
}

/** 片段第 u（0–1）处的姿势（关键帧之间 smoothstep 插值；循环片段首尾相接），写进 out */
export function sampleClip(clip: BakedClip, u: number, out: BakedPose): BakedPose {
  const keys = clip.keys;
  const f = Math.min(1, Math.max(0, u)) * clip.frames;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].frame < f) i++;
  const a = keys[i], b = keys[Math.min(keys.length - 1, i + 1)];
  const span = b.frame - a.frame;
  const k = span > 0 ? Math.min(1, Math.max(0, (f - a.frame) / span)) : 1;
  const s = k * k * (3 - 2 * k);
  for (const [name, qa] of a.pose.q) {
    const qb = b.pose.q.get(name) ?? qa;
    let o = out.q.get(name);
    if (!o) {
      o = new THREE.Quaternion();
      out.q.set(name, o);
    }
    o.slerpQuaternions(qa, qb, s);
  }
  out.hips.lerpVectors(a.pose.hips, b.pose.hips, s);
  return out;
}

export function emptyPose(): BakedPose {
  return { q: new Map(), hips: new THREE.Vector3() };
}

/** 两个姿势混合（交叉淡入）：out = a → b 的 k */
export function blendPose(a: BakedPose, b: BakedPose, k: number, out: BakedPose): BakedPose {
  for (const [name, qb] of b.q) {
    const qa = a.q.get(name) ?? qb;
    let o = out.q.get(name);
    if (!o) {
      o = new THREE.Quaternion();
      out.q.set(name, o);
    }
    o.slerpQuaternions(qa, qb, k);
  }
  out.hips.lerpVectors(a.hips, b.hips, k);
  return out;
}

export function copyPose(src: BakedPose, out: BakedPose): BakedPose {
  for (const [name, q] of src.q) {
    const o = out.q.get(name);
    if (o) o.copy(q);
    else out.q.set(name, q.clone());
  }
  out.hips.copy(src.hips);
  return out;
}
