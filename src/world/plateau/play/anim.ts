/**
 * 第四章生物的程序化动作：按骨骼名找出腿、脊柱、尾巴、翅膀，用正向运动学摆（不做脚步 IK——游玩版先求读得清）。
 * 轴是模型空间：X = 生物左侧，Y = 上，Z = 前；绕 X 正转 = 往前低头 / 腿往后摆；绕 Y 正转 = 往左转；绕 Z 正转 = 左翼往上抬。
 *
 * 每帧：reset() → 步态（走 / 跑 / 飞）→ 招式姿势层 → 受击 / 硬直 / 眩晕 / 死亡。
 * 招式姿势层按「招式 id + 所在段（前摇 / 出手 / 收招）+ 段内进度」摆（poses.ts 里每种生物一张表）；
 * 切招时旧姿势 0.15 秒淡出、新姿势淡入。状态名就是招式 id，以后烘焙 Unity 片段按它切。
 * 走动节奏 phase 由调用方按移动距离推进，脚步和位移对得上。
 */
import * as THREE from 'three';
import type { NativePose } from '../../../assets/NativeRig';
import { POSES, type PoseFn } from './poses';

export const AX = new THREE.Vector3(1, 0, 0);
export const AY = new THREE.Vector3(0, 1, 0);
export const AZ = new THREE.Vector3(0, 0, 1);

export type Gait = 'quad' | 'upright' | 'biped' | 'bird' | 'hexa' | 'serpent' | 'kui';
export type DeathKind = 'normal' | 'weak' | 'blast' | 'pop' | 'fall';
export type Stage = 'windup' | 'active' | 'recover' | '';

export interface AnimState {
  /** 移动快慢 0..1（相对这只的最快速度） */
  move: number;
  /** 步态相位（弧度），按走过的距离推进 */
  phase: number;
  /** 出招 0..1（老的通用前倾，招式姿势层没覆盖时用） */
  attack: number;
  /** 头要转向的偏角（弧度，左正） */
  look: number;
  /** 扇翅强度 0..1（落地收翅为 0） */
  flap: number;
  /** 蹲伏 0..1（蓄跳、落地缓冲） */
  crouch: number;
  /** 受击抖动 0..1，自己衰减；hurtX / hurtZ 是挨打的方向（模型空间，打哪边往另一边歪） */
  hurt: number;
  hurtX: number;
  hurtZ: number;
  /** 张嘴 0..1 */
  jaw: number;
  /** 硬直 0..1（踉跄） */
  stagger: number;
  /** 眩晕 0..1（趴下 / 跪下、晃头） */
  stun: number;
  /** 死亡倒地 0..1 */
  dead: number;
  deathKind: DeathKind;
  /** 往哪边倒（±1） */
  deathSide: number;
  /** 左右交替的招（獓狠挑角、穷奇爪击）这一下用哪边（±1） */
  side: number;
  /** 当前招式（= 动画状态名）、所在段、段内进度 */
  pose: string;
  stage: Stage;
  k: number;
}

export function newAnimState(): AnimState {
  return {
    move: 0, phase: 0, attack: 0, look: 0, flap: 0, crouch: 0, hurt: 0, hurtX: 0, hurtZ: -1, jaw: 0, stagger: 0, stun: 0,
    dead: 0, deathKind: 'normal', deathSide: 1, side: 1, pose: '', stage: '', k: 0,
  };
}

interface Leg { upper: string; lower: string; end?: string; side: number; front: boolean; off: number }
interface PoseSlot { w: number; stage: Stage; k: number }

export class CreatureAnimator {
  readonly legs: Leg[] = [];
  readonly spine: string[];
  readonly tail: string[];
  readonly wings: { bones: string[]; side: number }[] = [];
  readonly neck: string | null;
  readonly head: string | null;
  readonly jawBone: string | null;
  readonly root: string | null;
  private readonly slots = new Map<string, PoseSlot>();
  private readonly poseFn: PoseFn | null;
  private lastT = 0;

  constructor(readonly P: NativePose, readonly gait: Gait, model = '') {
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
    this.root = has('hips') ? 'hips' : has('body') ? 'body' : null;
    this.poseFn = POSES[model] ?? null;
  }

  /** 当前各招式姿势的权重（调试） */
  weights(): Record<string, number> {
    return Object.fromEntries([...this.slots.entries()].filter(([, v]) => v.w > 0.01).map(([k, v]) => [k, Math.round(v.w * 100) / 100]));
  }

  apply(s: AnimState, t: number): void {
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const P = this.P, g = this.gait, m = s.move * (1 - s.dead), p = s.phase;
    P.reset();
    // 招式姿势的淡入淡出
    if (s.pose) {
      let slot = this.slots.get(s.pose);
      if (!slot) this.slots.set(s.pose, slot = { w: 0, stage: s.stage, k: s.k });
      slot.stage = s.stage; slot.k = s.k;
    }
    for (const [name, slot] of this.slots) {
      const target = name === s.pose && s.dead === 0 ? 1 : 0;
      slot.w += (target - slot.w) * Math.min(1, dt / 0.12);
      if (slot.w < 0.005 && target === 0) this.slots.delete(name);
    }
    // 身体：小跑起伏、蹲伏、出招前倾
    const bob = Math.abs(Math.sin(p)) * (g === 'upright' ? 0.1 : 0.05) * m;
    const root = this.root;
    if (root) {
      P.translate(root, 0, bob - s.crouch * (g === 'kui' ? 0.9 : 0.15), 0);
      P.rotate(root, AX, 0.06 * m + 0.25 * s.attack + (g === 'upright' ? 0.95 * m : 0));
    }
    for (const [i, b] of this.spine.entries()) {
      P.rotate(b, AY, (g === 'serpent' ? Math.sin(t * 2.2 - i * 0.7) * 0.22 * (1 - s.dead) : Math.sin(p) * 0.04 * m));
      P.rotate(b, AX, 0.08 * s.attack);
    }
    // 腿：大腿前后摆，小腿在抬起段向后收
    const swing = g === 'kui' ? 0 : g === 'hexa' ? 0.5 : g === 'upright' ? 0.6 : 0.55;
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
      if (g === 'kui' && L.front) continue;
      if (L.front && (g === 'biped' || g === 'upright')) {
        // 双足的前肢是手臂；啸獭跑起来前倾、前爪着地当前腿用
        if (g === 'upright') {
          P.rotate(L.upper, AX, -0.4 * (1 - m) + (-Math.sin(ph) * 0.7 - 0.5) * m);
          P.rotate(L.lower, AX, -0.3 * (1 - m) + lo * 0.6 * m);
        } else {
          P.rotate(L.upper, AX, Math.sin(ph) * 0.45 * m);
          P.rotate(L.lower, AX, -0.3);
        }
        continue;
      }
      P.rotate(L.upper, AX, up);
      P.rotate(L.lower, AX, L.front ? lo : -lo * 0.6);
      if (L.end) P.rotate(L.end, AX, L.front ? -lo * 0.5 : lo * 0.4);
    }
    // 头：看向目标、张嘴
    const look = Math.max(-0.9, Math.min(0.9, s.look)) * (1 - s.dead) * (1 - s.stun);
    if (this.neck) { P.rotate(this.neck, AY, look * 0.5); P.rotate(this.neck, AX, 0.25 * s.attack - 0.1 * s.jaw - (g === 'upright' ? 0.6 * m : 0)); }
    if (this.head) { P.rotate(this.head, AY, look * 0.5 + Math.sin(t * 1.3) * 0.05); P.rotate(this.head, AX, 0.15 * s.attack - 0.2 * s.jaw - (g === 'upright' ? 0.3 * m : 0)); }
    if (this.jawBone) P.rotate(this.jawBone, AX, 0.6 * s.jaw);
    // 尾巴：一节一节传下去的摆
    for (const [k, b] of this.tail.entries()) {
      const amp = (g === 'serpent' ? 0.32 : 0.12 + 0.12 * m) * (1 - s.dead * 0.8);
      P.rotate(b, AY, Math.sin(t * (g === 'serpent' ? 2.2 : 3 + 3 * m) - k * 0.7) * amp);
    }
    // 翅膀：扇动（左 +Z 转是往上抬）；落地时半收
    for (const W of this.wings) {
      const beat = Math.sin(t * (g === 'bird' ? 14 : g === 'hexa' ? 22 : 7));
      const a = s.flap > 0 ? beat * 0.65 * s.flap : -0.25;
      W.bones.forEach((b, k) => P.rotate(b, AZ, W.side * (k === 0 ? a : a * 0.4)));
    }
    // 招式姿势层
    if (this.poseFn) for (const [name, slot] of this.slots) if (slot.w > 0.005) this.poseFn(this, name, slot.w, slot.stage, slot.k, s, t);
    this.reactions(s, t);
  }

  /** 受击（按方向歪一下）、硬直（踉跄）、眩晕（趴 / 跪、晃头）、死亡 */
  private reactions(s: AnimState, t: number): void {
    const P = this.P, root = this.root, g = this.gait;
    if (root && s.hurt > 0) {
      // 打哪边往另一边歪：前面挨打往后仰
      P.rotate(root, AX, 0.22 * s.hurt * s.hurtZ * -1 * (g === 'serpent' ? 0.3 : 1));
      P.rotate(root, AZ, 0.18 * s.hurt * s.hurtX);
      if (this.head) P.rotate(this.head, AX, -0.3 * s.hurt);
    }
    if (root && s.stagger > 0) {
      const w = Math.sin(Math.min(1, s.stagger) * Math.PI * 0.5);
      P.rotate(root, AX, -0.35 * w);
      P.rotate(root, AZ, 0.3 * w * Math.sin(t * 9));
      for (const L of this.legs) if (!L.front) P.rotate(L.upper, AX, -0.3 * w);
      if (this.head) P.rotate(this.head, AX, -0.4 * w);
    }
    if (s.stun > 0) {
      const w = s.stun;
      const sway = Math.sin(t * 3.2);
      if (root) {
        if (g === 'quad' || g === 'upright') {
          // 四足：前腿跪下、身子往一侧塌
          P.translate(root, 0, -0.25 * w, 0);
          P.rotate(root, AX, 0.18 * w);
          P.rotate(root, AZ, 0.12 * w * sway);
          for (const L of this.legs) { P.rotate(L.upper, AX, L.front ? 0.7 * w : -0.4 * w); P.rotate(L.lower, AX, L.front ? -1.3 * w : 0.9 * w); }
        } else if (g === 'biped' || g === 'kui') {
          P.translate(root, 0, (g === 'kui' ? -1.2 : -0.35) * w, 0);
          P.rotate(root, AX, 0.35 * w);
          for (const L of this.legs) if (!L.front) { P.rotate(L.upper, AX, -1.1 * w); P.rotate(L.lower, AX, 1.6 * w); }
        } else if (g === 'serpent') {
          P.rotate(root, AZ, 1.2 * w);
        } else {
          P.rotate(root, AZ, 0.6 * w * sway);
        }
      }
      if (this.neck) P.rotate(this.neck, AX, 0.45 * w);
      if (this.head) { P.rotate(this.head, AY, 0.35 * w * sway); P.rotate(this.head, AZ, 0.25 * w * Math.cos(t * 3.2)); }
    }
    if (s.dead > 0 && root) {
      const d = s.dead, side = s.deathSide;
      switch (g) {
        case 'biped':
          P.rotate(root, AX, -1.35 * d);
          P.translate(root, 0, -0.25 * d, 0);
          for (const L of this.legs) { P.rotate(L.upper, AX, (L.front ? -0.8 : -0.5) * d); P.rotate(L.lower, AX, (L.front ? -0.6 : 0.4) * d); }
          break;
        case 'kui':
          P.translate(root, 0, -1.6 * d, 0);
          P.rotate(root, AX, -0.9 * d);
          P.rotate(root, AZ, 0.4 * d * side);
          break;
        case 'upright':
          // 啸獭：翻肚子
          P.rotate(root, AX, -1.5 * d);
          P.rotate(root, AZ, 0.3 * d * side);
          for (const L of this.legs) P.rotate(L.upper, AX, -0.8 * d + 0.3 * (1 - d) * Math.sin(t * 18));
          break;
        case 'serpent':
          P.rotate(root, AZ, 2.6 * d * side);
          break;
        case 'hexa':
          break;
        default:
          P.rotate(root, AZ, 1.4 * d * side);
          for (const L of this.legs) { P.rotate(L.upper, AZ, -0.25 * d * side); P.rotate(L.lower, AX, 0.3 * d); }
      }
      if (this.neck) P.rotate(this.neck, AX, (s.deathKind === 'weak' ? -0.7 : 0.5) * d);
      if (this.head) P.rotate(this.head, AX, 0.3 * d);
      for (const W of this.wings) W.bones.forEach((b, k) => P.rotate(b, AZ, W.side * (k === 0 ? 0.4 : -0.6) * d));
    }
  }
}
