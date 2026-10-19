/**
 * 第四章生物的程序化动作：按骨骼名找出腿、脊柱、尾巴、翅膀，用正向运动学摆（不做脚步 IK——游玩版先求读得清）。
 * 轴是模型空间：X = 生物左侧，Y = 上，Z = 前；绕 X 正转 = 往前低头 / 腿往后摆。
 * 每帧：reset() → 按状态叠加。走动节奏 phase 由调用方按移动距离推进，脚步和位移对得上。
 */
import * as THREE from 'three';
import type { NativePose } from '../../../assets/NativeRig';

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

export type Gait = 'quad' | 'upright' | 'biped' | 'bird' | 'hexa' | 'serpent' | 'kui';

export interface AnimState {
  /** 移动快慢 0..1（相对这只的最快速度） */
  move: number;
  /** 步态相位（弧度），按走过的距离推进 */
  phase: number;
  /** 出招 0..1：蓄力时往上涨，出手后回落 */
  attack: number;
  /** 头要转向的偏角（弧度，左正） */
  look: number;
  /** 扇翅强度 0..1（落地收翅为 0） */
  flap: number;
  /** 蹲伏 0..1（蓄跳、落地缓冲） */
  crouch: number;
  /** 受击抖动 0..1，自己衰减 */
  hurt: number;
  /** 张嘴 0..1 */
  jaw: number;
  /** 死亡倒地 0..1 */
  dead: number;
}

export function newAnimState(): AnimState {
  return { move: 0, phase: 0, attack: 0, look: 0, flap: 0, crouch: 0, hurt: 0, jaw: 0, dead: 0 };
}

interface Leg { upper: string; lower: string; end?: string; side: number; front: boolean; off: number }

export class CreatureAnimator {
  private readonly legs: Leg[] = [];
  private readonly spine: string[];
  private readonly tail: string[];
  private readonly wings: { bones: string[]; side: number }[] = [];
  private readonly neck: string | null;
  private readonly head: string | null;
  private readonly jawBone: string | null;

  constructor(private readonly P: NativePose, readonly gait: Gait) {
    const has = (n: string): boolean => P.has(n);
    const side = (n: string): number => ((P.restPosition(n)?.x ?? 0) >= 0 ? 1 : -1);
    for (const s of ['L', 'R']) {
      const front = [['upperarm', 'forearm', 'paw'], ['upperarm', 'forearm', 'fhoof'], ['arm', 'forearm', 'fist'], ['arm', 'forearm', 'hand']]
        .find(([u, l]) => has(`${u}_${s}`) && has(`${l}_${s}`));
      if (front) this.legs.push({ upper: `${front[0]}_${s}`, lower: `${front[1]}_${s}`, end: front[2] && has(`${front[2]}_${s}`) ? `${front[2]}_${s}` : undefined, side: side(`${front[0]}_${s}`), front: true, off: 0 });
      if (has(`thigh_${s}`) && has(`shin_${s}`)) this.legs.push({ upper: `thigh_${s}`, lower: `shin_${s}`, end: has(`foot_${s}`) ? `foot_${s}` : has(`hhoof_${s}`) ? `hhoof_${s}` : undefined, side: side(`thigh_${s}`), front: false, off: 0 });
      for (let n = 1; n <= 3; n++) {
        if (has(`leg${n}_thigh_${s}`)) this.legs.push({ upper: `leg${n}_thigh_${s}`, lower: `leg${n}_foot_${s}`, side: side(`leg${n}_thigh_${s}`), front: n === 1, off: n });
      }
      const wing = ['wing_1', 'wing_2', 'wing_3', 'wing_upper', 'wing_lower'].map(w => `${w}_${s}`).filter(has);
      if (wing.length) this.wings.push({ bones: wing, side: side(wing[0]) });
    }
    if (has('thigh') && has('shin')) this.legs.push({ upper: 'thigh', lower: 'shin', end: 'hoof', side: 0, front: false, off: 0 });
    // 对角小跑：左前 + 右后同相，右前 + 左后同相；双足左右交替；六足三角步态
    for (const L of this.legs) {
      if (gait === 'hexa') L.off = ((L.off + (L.side > 0 ? 0 : 1)) % 2) * Math.PI;
      else if (gait === 'biped' || gait === 'upright' || gait === 'bird') L.off = L.side > 0 ? 0 : Math.PI;
      else L.off = (L.front ? L.side > 0 : L.side < 0) ? 0 : Math.PI;
    }
    this.spine = ['spine', 'spine1', 'spine2', 'spine3', 'chest'].filter(has);
    this.tail = Array.from({ length: 9 }, (_, k) => `tail_${k + 1}`).filter(has);
    this.neck = has('neck') ? 'neck' : null;
    this.head = has('head') ? 'head' : null;
    this.jawBone = has('jaw') ? 'jaw' : null;
  }

  apply(s: AnimState, t: number): void {
    const P = this.P, g = this.gait, m = s.move, p = s.phase;
    P.reset();
    // 身体：小跑起伏、蹲伏、受击后仰、出招前倾
    const bob = Math.abs(Math.sin(p)) * (g === 'upright' ? 0.1 : 0.05) * m;
    const root = P.has('hips') ? 'hips' : P.has('body') ? 'body' : null;
    if (root) {
      P.translate(root, 0, bob - s.crouch * (g === 'kui' ? 0.9 : 0.15), 0);
      P.rotate(root, AX, 0.06 * m + 0.25 * s.attack - 0.3 * s.hurt + (g === 'upright' ? 0.35 * m : 0));
      if (s.dead > 0) P.rotate(root, AZ, s.dead * 1.4);
    }
    for (const [i, b] of this.spine.entries()) {
      P.rotate(b, AY, (g === 'serpent' ? Math.sin(t * 2.2 - i * 0.7) * 0.22 : Math.sin(p) * 0.04 * m));
      P.rotate(b, AX, 0.08 * s.attack - 0.1 * s.hurt);
    }
    // 腿：大腿前后摆，小腿在抬起段向后收
    const swing = g === 'kui' ? 0 : g === 'hexa' ? 0.5 : g === 'upright' ? 0.7 : 0.55;
    for (const L of this.legs) {
      const ph = p + L.off;
      let up = -Math.sin(ph) * swing * m;
      let lo = Math.max(0, Math.cos(ph)) * 0.7 * m;
      if (g === 'kui') { up = s.crouch * 0.9; lo = -s.crouch * 1.6; }
      if (g === 'bird' && s.flap > 0.2) { up = -0.6 * s.flap; lo = 0.9 * s.flap; }
      if (g === 'hexa') {
        P.rotate(L.upper, AX, up);
        P.rotate(L.upper, AZ, L.side * (0.15 + Math.max(0, Math.cos(ph)) * 0.35 * m));
        continue;
      }
      if (L.front && (g === 'biped' || g === 'upright')) {
        // 双足的前肢是手臂：反相摆臂；upright（啸獭）抱在胸前
        P.rotate(L.upper, AX, g === 'upright' ? -0.4 - 0.5 * s.attack : Math.sin(ph) * 0.45 * m - 1.2 * s.attack);
        P.rotate(L.lower, AX, -0.3 - 0.4 * s.attack);
        continue;
      }
      P.rotate(L.upper, AX, up - (L.front ? 0.35 * s.attack : 0));
      P.rotate(L.lower, AX, L.front ? lo : -lo * 0.6);
      if (L.end) P.rotate(L.end, AX, L.front ? -lo * 0.5 : lo * 0.4);
    }
    // 夔：拳头捶胸（attack 用来捶）
    if (g === 'kui') {
      for (const s2 of ['L', 'R']) {
        const k = s2 === 'L' ? 1 : -1, beat = s.attack * Math.max(0, Math.sin(t * 12 + (k > 0 ? 0 : Math.PI)));
        P.rotate(`arm_${s2}`, AX, -0.9 * beat - 0.4 * s.crouch);
        P.rotate(`arm_${s2}`, AZ, -k * 0.5 * beat);
        P.rotate(`forearm_${s2}`, AX, -1.2 * beat);
      }
    }
    // 头：看向目标、出招低头、张嘴
    const look = Math.max(-0.9, Math.min(0.9, s.look));
    if (this.neck) { P.rotate(this.neck, AY, look * 0.5); P.rotate(this.neck, AX, 0.25 * s.attack - 0.1 * s.jaw); }
    if (this.head) { P.rotate(this.head, AY, look * 0.5 + Math.sin(t * 1.3) * 0.05); P.rotate(this.head, AX, 0.15 * s.attack - 0.2 * s.jaw - 0.2 * s.hurt); }
    if (this.jawBone) P.rotate(this.jawBone, AX, 0.6 * s.jaw);
    // 尾巴：一节一节传下去的摆
    for (const [k, b] of this.tail.entries()) {
      const amp = g === 'serpent' ? 0.32 : 0.12 + 0.12 * m;
      P.rotate(b, AY, Math.sin(t * (g === 'serpent' ? 2.2 : 3 + 3 * m) - k * 0.7) * amp);
    }
    // 翅膀：扇动（左 +Z 转是往上抬）；落地时半收
    for (const W of this.wings) {
      const beat = Math.sin(t * (g === 'bird' ? 14 : g === 'hexa' ? 22 : 7));
      const a = s.flap > 0 ? beat * 0.65 * s.flap : -0.25;
      W.bones.forEach((b, k) => P.rotate(b, AZ, W.side * (k === 0 ? a : a * 0.4)));
    }
  }
}
