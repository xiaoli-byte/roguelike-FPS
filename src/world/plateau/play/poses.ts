/**
 * 招式姿势表：每种生物一张，按「招式 id + 段（前摇 / 出手 / 收招）+ 段内进度 k + 权重 w」在步态之上叠加骨骼转动。
 * 招式 id 和 foes.ts / bosses.ts 的招式表一致（= 动画状态名）。轴见 anim.ts 文件头：
 * 绕 X 正转 = 往前低头 / 腿往后摆（手臂往前抬用负值）；绕 Y 正转 = 往左转；绕 Z 正转 = 左侧往上抬（右侧乘 −1）。
 * 设计见 docs/level-design/chuanzang-combat-v1.md 第 3、4 节。
 */
import * as THREE from 'three';
import type { AnimState, CreatureAnimator, Stage } from './anim';
import { AX, AY, AZ } from './anim';

export type PoseFn = (A: CreatureAnimator, name: string, w: number, stage: Stage, k: number, s: AnimState, t: number) => void;

const ease = (x: number): number => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };
/** 前摇从 0 涨到 1、出手保持、收招落回 0 */
const hold = (stage: Stage, k: number): number => (stage === 'windup' ? ease(k) : stage === 'active' ? 1 : stage === 'recover' ? 1 - ease(k) : 0);
/** 只在出手段（0 → 1 → 0 的一下） */
const strike = (stage: Stage, k: number): number => (stage === 'active' ? Math.sin(Math.min(1, k) * Math.PI) : 0);

type Rot = (bone: string, axis: typeof AX, a: number) => void;
const rotator = (A: CreatureAnimator, w: number): Rot => (b, axis, a) => A.P.rotate(b, axis, a * w);
const both = (R: Rot, bone: string, axis: typeof AX, a: number, mirror = false): void => {
  R(`${bone}_L`, axis, a);
  R(`${bone}_R`, axis, mirror ? -a : a);
};

// ───────────────────────────── 啸獭 ─────────────────────────────

const marmot: PoseFn = (A, name, w, stage, k, s, t) => {
  const R = rotator(A, w), P = A.P;
  if (name === 'scream') {
    // 直立、仰头、两爪抱胸，尖啸时整个身子往后挺、抖
    const h = hold(stage, k), shout = stage === 'active' || stage === 'windup' && k > 0.5 ? 1 : 0;
    R('hips', AX, -0.15 * h);
    R('spine', AX, -0.25 * h);
    R('neck', AX, -0.35 * h);
    R('head', AX, -0.45 * h + 0.06 * shout * Math.sin(t * 40));
    both(R, 'upperarm', AX, -0.7 * h);
    both(R, 'forearm', AX, -1.3 * h);
    both(R, 'ear', AX, 0.6 * h);
  } else if (name === 'bite') {
    // 前摇伏低炸毛；出手往前一扑；收招坐起来
    const crouch = stage === 'windup' ? ease(k) : stage === 'active' ? 1 - k : 0;
    const lunge = strike(stage, k);
    P.translate('hips', 0, -0.12 * crouch * w, 0);
    R('hips', AX, 0.9 * crouch + 1.2 * lunge + (stage === 'recover' ? 0.4 * (1 - k) : 0));
    R('neck', AX, -0.5 * crouch - 0.3 * lunge);
    R('head', AX, -0.3 * crouch);
    both(R, 'upperarm', AX, -1.1 * lunge - 0.4 * crouch);
    both(R, 'forearm', AX, 0.5 * lunge);
    both(R, 'thigh', AX, -0.6 * crouch + 0.5 * lunge);
    both(R, 'shin', AX, 0.9 * crouch);
    both(R, 'ear', AX, 0.8 * (crouch + lunge));
    for (let i = 1; i <= 4; i++) R(`tail_${i}`, AX, -0.25 * crouch);
  } else if (name === 'burrow') {
    // 前摇一头扎下去，出手在地下（隐藏），收招从洞口探头
    if (stage === 'windup') { R('hips', AX, 1.7 * ease(k)); P.translate('hips', 0, -0.3 * ease(k) * w, 0); both(R, 'upperarm', AX, -2.2 * ease(k)); }
    else if (stage === 'recover') {
      const pop = Math.sin(Math.min(1, k * 1.5) * Math.PI * 0.5);
      P.translate('hips', 0, -0.4 * (1 - pop) * w, 0);
      R('head', AY, 0.6 * Math.sin(t * 6));
      both(R, 'upperarm', AX, -0.5);
    }
  }
};

// ───────────────────────────── 天狗 ─────────────────────────────

const tiangou: PoseFn = (A, name, w, stage, k, s, t) => {
  const R = rotator(A, w), P = A.P;
  if (name === 'howl') {
    // 坐低（后腿屈、屁股下沉），前腿撑直，脖子和头往上仰，嘴张开
    const h = hold(stage, k);
    P.translate('hips', 0, -0.18 * h * w, 0);
    R('hips', AX, -0.55 * h);
    both(R, 'thigh', AX, -0.35 * h);
    both(R, 'shin', AX, 0.9 * h);
    both(R, 'upperarm', AX, 0.4 * h);
    R('neck', AX, -0.7 * h);
    R('head', AX, -0.5 * h + (stage === 'active' ? 0.05 * Math.sin(t * 30) : 0));
    both(R, 'ear', AX, 0.5 * h);
    for (let i = 1; i <= 5; i++) R(`tail_${i}`, AX, -0.15 * h);
  } else if (name === 'pounce') {
    const crouch = stage === 'windup' ? ease(k) : 0;
    const air = stage === 'active' ? 1 : 0;
    const land = stage === 'recover' ? 1 - ease(k) : 0;
    P.translate('hips', 0, -0.2 * (crouch + land * 0.6) * w, 0);
    R('hips', AX, 0.25 * crouch - 0.25 * air * Math.cos(k * Math.PI) + 0.2 * land);
    // 蹲：四腿屈；空中：前腿往前伸、后腿往后蹬
    both(R, 'upperarm', AX, 0.35 * crouch - 1.1 * air + 0.3 * land);
    both(R, 'forearm', AX, -0.6 * crouch + 0.3 * air);
    both(R, 'thigh', AX, -0.7 * crouch + 1.0 * air - 0.4 * land);
    both(R, 'shin', AX, 1.0 * crouch - 0.3 * air + 0.6 * land);
    R('neck', AX, -0.2 * crouch + 0.2 * air + 0.35 * land);
    both(R, 'ear', AX, 0.7 * (crouch + air));
  }
};

// ───────────────────────────── 獓狠 / 雷牦 ─────────────────────────────

const aoyin: PoseFn = (A, name, w, stage, k, s, t) => {
  const R = rotator(A, w), P = A.P;
  if (name === 'stampede') {
    if (stage === 'windup') {
      // 刨地：右前蹄往后刨两下、低头
      const scrape = Math.max(0, Math.sin(k * Math.PI * 4));
      R('upperarm_R', AX, 0.5 * scrape - 0.3 * (1 - scrape));
      R('forearm_R', AX, 0.6 * scrape);
      R('neck', AX, 0.45 * ease(k));
      R('head', AX, 0.3 * ease(k));
      R('hips', AX, 0.08 * ease(k));
    } else if (stage === 'active') {
      R('neck', AX, 0.55); R('head', AX, 0.35);
    } else {
      // 打滑停下：屁股往前坐、前腿撑直往前
      const skid = 1 - ease(k);
      R('hips', AX, -0.2 * skid);
      both(R, 'upperarm', AX, -0.5 * skid);
      both(R, 'thigh', AX, -0.5 * skid);
      R('neck', AX, 0.4 * skid);
    }
  } else if (name === 'gore') {
    // 头往一侧压低，出手横甩到另一侧往上挑
    const side = s.side;
    const wind = stage === 'windup' ? ease(k) : stage === 'active' ? 1 - k : 0;
    const flick = strike(stage, k);
    R('neck', AX, 0.55 * wind + 0.1 * flick);
    R('neck', AY, 0.6 * side * wind - 0.8 * side * flick);
    R('head', AX, 0.35 * wind - 0.7 * flick);
    R('head', AZ, 0.4 * side * wind - 0.5 * side * flick);
    R('chest', AY, 0.15 * side * wind - 0.2 * side * flick);
  } else if (name === 'slam') {
    // 人立：后腿撑地、前腿收起，雷球举高；出手前腿砸地
    const rear = stage === 'windup' ? ease(k) : stage === 'active' ? 1 - ease(k) : 0;
    const slam = stage === 'active' ? ease(k) : stage === 'recover' ? 1 - ease(k) : 0;
    P.translate('hips', 0, 0.15 * rear * w, 0);
    R('hips', AX, -0.85 * rear + 0.12 * slam);
    both(R, 'thigh', AX, 0.7 * rear);
    both(R, 'shin', AX, -0.3 * rear);
    both(R, 'upperarm', AX, -0.9 * rear + 0.25 * slam);
    both(R, 'forearm', AX, 1.4 * rear);
    R('neck', AX, 0.4 * rear + 0.4 * slam);
    R('head', AX, -0.2 * rear + 0.2 * slam + 0.04 * Math.sin(t * 35) * rear);
  }
};

// ───────────────────────────── 举父 ─────────────────────────────

const jufu: PoseFn = (A, name, w, stage, k, s, t) => {
  const R = rotator(A, w), P = A.P;
  if (name === 'throw') {
    // 前摇：弯腰抠石 → 双手举过头顶；出手：往前甩；收招：双臂垂下
    let lift = 0, bend = 0, sling = 0;
    if (stage === 'windup') { bend = Math.sin(Math.min(1, k * 2) * Math.PI * 0.5) * (1 - ease((k - 0.4) / 0.6)); lift = ease((k - 0.35) / 0.65); }
    else if (stage === 'active') { lift = 1 - k; sling = Math.sin(k * Math.PI * 0.5); }
    else { sling = 1 - ease(k); }
    R('hips', AX, 0.5 * bend - 0.25 * lift + 0.35 * sling);
    R('spine', AX, 0.4 * bend - 0.2 * lift + 0.2 * sling);
    R('chest', AX, -0.15 * lift);
    both(R, 'arm', AX, 0.3 * bend - 2.6 * lift - 1.2 * sling);
    both(R, 'arm', AZ, 0.25 * lift, true);
    both(R, 'forearm', AX, -0.3 * bend - 0.6 * lift + 0.2 * sling);
    both(R, 'thigh', AX, -0.35 * bend - 0.25 * sling);
    both(R, 'shin', AX, 0.6 * bend + 0.3 * sling);
    R('head', AX, -0.25 * lift);
  } else if (name === 'shove') {
    const open = stage === 'windup' ? ease(k) : stage === 'active' ? 1 - k : 0;
    const sweep = strike(stage, k);
    both(R, 'arm', AZ, 0.9 * open - 0.3 * sweep, true);
    both(R, 'arm', AX, -0.7 * open - 1.3 * sweep);
    both(R, 'forearm', AX, -0.4 * open);
    R('chest', AX, -0.15 * open + 0.3 * sweep);
    R('head', AX, -0.15 * open);
  } else if (name === 'climb') {
    // 跳上高处：蹲 → 空中收腿举手 → 落地四肢着地
    const crouch = stage === 'windup' ? ease(k) : 0, air = stage === 'active' ? 1 : 0, land = stage === 'recover' ? 1 - ease(k) : 0;
    P.translate('hips', 0, -0.25 * (crouch + land) * w, 0);
    R('hips', AX, 0.5 * crouch + 0.6 * land);
    both(R, 'thigh', AX, -0.9 * crouch - 1.0 * air - 0.6 * land);
    both(R, 'shin', AX, 1.3 * crouch + 1.4 * air + 0.9 * land);
    both(R, 'arm', AX, 0.6 * crouch - 2.4 * air + 0.2 * land);
  } else if (name === 'fall') {
    // 从屋顶摔下来：四肢乱挥
    R('hips', AX, -0.6);
    both(R, 'arm', AX, -1.8 + 0.6 * Math.sin(t * 14));
    both(R, 'thigh', AX, -0.6 + 0.5 * Math.sin(t * 12 + 1));
  }
};

// ───────────────────────────── 蛮蛮 ─────────────────────────────

const manman: PoseFn = (A, name, w, stage, k, s, t) => {
  const R = rotator(A, w);
  if (name === 'sweep') {
    // 前摇：翅膀高举、脖子伸长；出手：俯冲平飞（身子前倾、腿往后收）；收招：慢慢爬升
    const up = stage === 'windup' ? ease(k) : 0;
    const dive = stage === 'active' ? 1 : stage === 'recover' ? 1 - ease(k) : 0;
    R('wing_1_L', AZ, 0.9 * up);
    R('hips', AX, 0.55 * dive);
    R('neck', AX, -0.3 * up - 0.3 * dive);
    both(R, 'thigh', AX, 0.9 * dive);
    both(R, 'shin', AX, -0.6 * dive);
  } else if (name === 'bolt') {
    const jab = strike(stage, k) + (stage === 'windup' ? -0.6 * ease(k) : 0);
    R('neck', AX, 0.6 * jab);
    R('head', AX, 0.4 * jab);
  } else if (name === 'hop') {
    // 落地追啄：一蹦一蹦、啄
    const peck = Math.max(0, Math.sin(t * 9));
    R('neck', AX, 0.7 * peck);
    R('head', AX, 0.4 * peck);
    R('wing_1_L', AZ, 0.4 * Math.sin(t * 18));
  }
};

// ───────────────────────────── 帝江 ─────────────────────────────

const dijiang: PoseFn = (A, name, w, stage, k, s, t) => {
  const R = rotator(A, w), P = A.P;
  if (name === 'swell') {
    // 原地转圈、胀大、六足乱蹬、四翼张开
    const g = stage === 'windup' ? ease(k) : 1;
    P.scale('body', 1 + 0.5 * g * w);
    for (const s2 of ['L', 'R']) {
      const sd = s2 === 'L' ? 1 : -1;
      for (let n = 1; n <= 3; n++) R(`leg${n}_thigh_${s2}`, AZ, sd * (0.5 * g + 0.3 * Math.sin(t * 30 + n)));
      R(`wing_upper_${s2}`, AZ, sd * (0.8 * g + 0.4 * Math.sin(t * 40)));
      R(`wing_lower_${s2}`, AZ, sd * (0.6 * g + 0.4 * Math.sin(t * 40 + 1)));
    }
  }
};

// ───────────────────────────── 穷奇 ─────────────────────────────

const qiongqi: PoseFn = (A, name, w, stage, k, s, t) => {
  const R = rotator(A, w), P = A.P;
  const wings = (spread: number, beat: number): void => {
    for (const s2 of ['L', 'R']) {
      const sd = s2 === 'L' ? 1 : -1;
      R(`wing_1_${s2}`, AZ, sd * (0.9 * spread + beat));
      R(`wing_1_${s2}`, AY, -sd * 0.6 * spread);
      R(`wing_2_${s2}`, AY, -sd * 0.7 * spread);
      R(`wing_3_${s2}`, AY, -sd * 0.4 * spread);
    }
  };
  if (name === 'glide') {
    const crouch = stage === 'windup' ? ease(k) : 0;
    const fly = stage === 'active' ? 1 : 0;
    const land = stage === 'recover' ? 1 - ease(k) : 0;
    P.translate('hips', 0, -0.25 * (crouch + land) * w, 0);
    R('hips', AX, 0.2 * crouch + 0.3 * fly * (k > 0.7 ? 1 : 0) + 0.25 * land);
    both(R, 'upperarm', AX, 0.5 * crouch - 1.2 * fly + 0.4 * land);
    both(R, 'forearm', AX, -0.7 * crouch + 0.2 * fly);
    both(R, 'thigh', AX, -0.8 * crouch + 0.9 * fly - 0.5 * land);
    both(R, 'shin', AX, 1.0 * crouch + 0.5 * land);
    wings(Math.max(crouch * 0.7, fly), fly * 0.15 * Math.sin(t * 5));
    R('neck', AX, -0.3 * crouch + 0.2 * fly);
  } else if (name === 'spin') {
    const flare = hold(stage, k);
    wings(flare, 0);
    R('hips', AX, 0.15 * flare);
    R('neck', AX, 0.3 * flare);
  } else if (name === 'claw') {
    // 两下爪击：左、右前爪轮流抬起拍下
    const a = stage === 'windup' ? ease(k) : 0;
    const k1 = stage === 'active' ? Math.sin(Math.min(1, k * 2) * Math.PI) : 0;
    const k2 = stage === 'active' ? Math.sin(Math.max(0, k * 2 - 1) * Math.PI) : 0;
    R('upperarm_L', AX, -1.4 * a - 1.0 * k1 + 0.6 * k1);
    R('upperarm_R', AX, -1.0 * k2);
    R('forearm_L', AX, 0.8 * a);
    R('hips', AX, -0.25 * a + 0.15 * (k1 + k2));
  } else if (name === 'absorb') {
    // 人立接雷：后腿撑、前腿抬、仰头，双翼半张
    const rear = hold(stage, k);
    R('hips', AX, -0.8 * rear);
    both(R, 'thigh', AX, 0.6 * rear);
    both(R, 'upperarm', AX, -0.8 * rear);
    both(R, 'forearm', AX, 1.0 * rear);
    R('neck', AX, -0.5 * rear);
    wings(0.5 * rear, 0.1 * rear * Math.sin(t * 20));
  } else if (name === 'flee') {
    wings(1, 0.5 * Math.sin(t * 9));
    both(R, 'thigh', AX, 0.9);
    both(R, 'upperarm', AX, 0.6);
  }
};

// ───────────────────────────── 夔 ─────────────────────────────

const _k1 = new THREE.Vector3();
const _k2 = new THREE.Vector3();
/** 用两骨 IK 把一只拳头拉到模型空间的 target（按权重从现在的位置插过去）；先把前臂往前弯一点定下肘的弯曲平面（肘朝外后、拳朝前） */
function reach(A: CreatureAnimator, w: number, s2: 'L' | 'R', x: number, y: number, z: number): void {
  if (w <= 0.001) return;
  const P = A.P;
  P.rotate(`forearm_${s2}`, AX, -0.35);
  P.hostPosition(`fist_${s2}`, _k1);
  _k2.set(s2 === 'L' ? x : -x, y, z);
  _k1.lerp(_k2, w);
  P.twoBoneIK(`arm_${s2}`, `forearm_${s2}`, `fist_${s2}`, _k1, 0.6);
}
/** 独腿踩在地上：蹄子钉在静止时的位置（身子蹲下去时膝盖往前弯） */
function plant(A: CreatureAnimator, w: number, dz = 0): void {
  if (w <= 0.001) return;
  const P = A.P;
  P.rotate('shin', AX, 0.3);
  P.hostPosition('hoof', _k1);
  _k2.copy(P.restPosition('hoof')!).add(new THREE.Vector3(0, 0, dz));
  _k1.lerp(_k2, w);
  P.twoBoneIK('thigh', 'shin', 'hoof', _k1, 1);
}

const kui: PoseFn = (A, name, w, stage, k, s, t) => {
  const R = rotator(A, w), P = A.P;
  const down = (y: number): void => P.translate('hips', 0, y * w, 0);
  if (name === 'hop' || name === 'turnLeap') {
    // 蹲：单腿屈、身子前倾、双拳往后；空中：腿伸直、双拳往前摆；落地：缓冲
    const crouch = stage === 'windup' ? ease(k) * 0.6 : stage === 'recover' ? (1 - ease(k)) * 0.5 : 0;
    const air = stage === 'active' ? Math.sin(k * Math.PI) : 0;
    down(-0.7 * crouch);
    R('hips', AX, 0.3 * crouch - 0.12 * air);
    if (stage !== 'active') plant(A, w);
    for (const s2 of ['L', 'R'] as const) reach(A, w, s2, 1.3, 1.2 + 1.6 * air, -0.9 * crouch + 1.2 * air);
  } else if (name === 'leap' || name === 'leapChain') {
    // 大跳：蹲得更深、双拳甩到身后（预警）；空中双拳举过头；落地双拳砸地、胸口压低到 2.5 m
    const deep = name === 'leapChain' ? 0.75 : 1;
    const crouch = stage === 'windup' ? ease(k) * deep : 0;
    const air = stage === 'active' ? 1 : 0;
    const slam = stage === 'recover' ? 1 - ease(Math.max(0, k - 0.4) / 0.6) : 0;
    down(-1.1 * crouch - 0.9 * slam);
    R('hips', AX, 0.4 * crouch - 0.2 * air * (1 - k) + 0.75 * slam);
    R('spine', AX, 0.15 * crouch + 0.2 * slam);
    if (stage !== 'active') plant(A, w);
    else R('thigh', AX, 0.3 * (1 - k));
    const up = air ? 1 - ease((k - 0.55) / 0.45) : 0;
    for (const s2 of ['L', 'R'] as const) {
      if (crouch > 0) reach(A, w * crouch, s2, 1.5, 2.4, -1.8);
      else if (air) reach(A, w, s2, 0.9 + 0.5 * (1 - up), 1.2 + 5.6 * up, 0.6 + 1.4 * (1 - up));
      else reach(A, w * slam, s2, 1.3, 0.1, 2.0);
    }
    R('head', AX, -0.3 * crouch + 0.2 * slam);
  } else if (name === 'clap') {
    // 双臂往两边张开（胸前空门大开）→ 正前方拍掌
    const open = stage === 'windup' ? ease(k) : stage === 'active' ? 1 - ease(k) : 0;
    const clap = stage === 'active' ? ease(k) : stage === 'recover' ? 1 - ease(k) : 0;
    R('spine', AX, -0.15 * open + 0.2 * clap);
    plant(A, w);
    for (const s2 of ['L', 'R'] as const) {
      reach(A, w * Math.max(open, clap), s2, 3.0 * open + 0.3 * clap, 3.9 * open + 3.1 * clap, 0.6 * open + 2.7 * clap);
    }
    R('head', AX, -0.2 * open + 0.15 * clap);
  } else if (name === 'drum' || name === 'drum5') {
    // 人立捶胸：拳头轮流砸鼓面，鼓面跟着震
    const up = hold(stage, k);
    R('hips', AX, -0.2 * up);
    R('spine', AX, -0.12 * up);
    R('head', AX, -0.35 * up);
    plant(A, w);
    for (const s2 of ['L', 'R'] as const) {
      const ph = s2 === 'L' ? 0 : Math.PI;
      const beat = stage === 'active' ? Math.max(0, Math.sin(t * 10.5 + ph)) : 0;
      // 捶下去时拳头贴到鼓面（模型空间 z 0.85），抬起来时往外上方收
      reach(A, w * up, s2, 0.35 + 0.9 * (1 - beat), 3.4 + 0.9 * (1 - beat), 1.05 + 0.5 * (1 - beat));
    }
    if (stage === 'active') P.scale('drum', 1 + 0.06 * w * Math.abs(Math.sin(t * 21)));
  } else if (name === 'roar' || name === 'rise') {
    // 仰头吼：双臂张开往上
    const h = name === 'rise' && stage === 'windup' ? 0.4 * k : hold(stage, k);
    R('spine', AX, -0.3 * h);
    R('neck', AX, -0.4 * h);
    R('head', AX, -0.4 * h + 0.04 * Math.sin(t * 30) * h);
    plant(A, w);
    for (const s2 of ['L', 'R'] as const) reach(A, w * h, s2, 2.8, 5.0, 0.6);
  } else if (name === 'kneel') {
    // 破鼓：独腿跪下、双拳撑地、头垂下
    const h = hold(stage, k);
    down(-1.4 * h);
    R('hips', AX, 0.5 * h);
    R('thigh', AX, -1.2 * h);
    R('shin', AX, 1.9 * h);
    for (const s2 of ['L', 'R'] as const) reach(A, w * h, s2, 1.4, 0.1, 1.4);
    R('neck', AX, 0.5 * h);
    R('head', AY, 0.25 * h * Math.sin(t * 2.5));
  } else if (name === 'knuckle') {
    // 拄拳：两拳往前撑住，身子和腿从两拳之间荡过去，脚落地后拳再往前伸（k = 整段进度，3 步）
    const ph = (k * 3) % 1;
    const swing = Math.sin(ph * Math.PI);
    down(-0.5 - 0.3 * swing);
    R('hips', AX, 0.55 + 0.1 * swing);
    // 拳：前半步撑在身前（随身子往前荡相对往后走），后半步抬起往前伸
    const fz = ph < 0.6 ? 2.2 - 3.2 * (ph / 0.6) : -1.0 + 3.2 * ((ph - 0.6) / 0.4);
    const fy = ph < 0.6 ? 0.1 : 0.1 + 0.8 * Math.sin((ph - 0.6) / 0.4 * Math.PI);
    for (const s2 of ['L', 'R'] as const) reach(A, w, s2, 1.3, fy, fz);
    // 腿：拳撑住时腿往前荡
    R('thigh', AX, -0.9 * swing);
    R('shin', AX, 0.6 * swing);
  }
};

// ───────────────────────────── 飞廉 ─────────────────────────────

const feilian: PoseFn = (A, name, w, stage, k, s, t) => {
  const R = rotator(A, w), P = A.P;
  const rear = (h: number): void => {
    // 人立：以后腿为支点把身子往上扳，后蹄用 IK 钉在地上（膝往前弯），前腿收起来蹬
    P.translate('hips', 0, -0.35 * h * w, -0.3 * h * w);
    R('hips', AX, -0.9 * h);
    for (const s2 of ['L', 'R'] as const) {
      P.rotate(`shin_${s2}`, AX, -0.2 * w);
      P.hostPosition(`hcannon_${s2}`, _k1);
      _k2.copy(P.restPosition(`hcannon_${s2}`)!);
      _k1.lerp(_k2, w * h);
      P.twoBoneIK(`thigh_${s2}`, `shin_${s2}`, `hcannon_${s2}`, _k1, 1);
    }
    both(R, 'upperarm', AX, -1.0 * h + 0.25 * h * Math.sin(t * 8));
    both(R, 'forearm', AX, 1.5 * h);
    R('neck', AX, 0.3 * h);
  };
  if (name === 'gust' || name === 'stormburst' || name === 'tornado' || name === 'roar') {
    const h = hold(stage, k);
    rear(h);
    R('head', AX, -0.35 * h);
    for (let i = 1; i <= 7; i++) R(`tail_${i}`, AX, -0.18 * h);
    if (name === 'gust' && stage === 'active') { R('neck', AX, 0.5 * strike(stage, k)); }
  } else if (name === 'charge' || name === 'wheel') {
    // 低头、鹿角对准（风雷珠降到 3 m）
    const h = stage === 'windup' ? ease(k) : stage === 'active' ? 1 : 1 - ease(k);
    R('neck', AX, 0.75 * h);
    R('head', AX, 0.55 * h);
    R('hips', AX, 0.12 * h);
    if (stage === 'windup') R('upperarm_R', AX, 0.5 * Math.max(0, Math.sin(k * Math.PI * 3)));
  } else if (name === 'blades') {
    // 尾羽往后一甩：尾巴先往一侧收，出手甩到另一侧
    const wind = stage === 'windup' ? ease(k) : 0, whip = strike(stage, k);
    for (let i = 1; i <= 7; i++) { R(`tail_${i}`, AY, 0.35 * wind - 0.5 * whip); R(`tail_${i}`, AX, -0.25 * (wind + whip)); }
    R('chest', AY, -0.2 * wind + 0.25 * whip);
    R('head', AY, 0.3 * wind);
  } else if (name === 'sidestep') {
    const air = stage === 'active' ? Math.sin(k * Math.PI) : 0;
    both(R, 'upperarm', AX, -0.9 * air);
    both(R, 'thigh', AX, 0.9 * air);
    R('hips', AX, -0.2 * air);
  } else if (name === 'down') {
    // 珠碎 / 撞冰脊：侧倒、腿蹬
    const h = hold(stage, k);
    P.rotate('hips', AZ, 1.3 * h * w);
    for (const s2 of ['L', 'R']) { R(`upperarm_${s2}`, AX, 0.3 * Math.sin(t * 7)); R(`thigh_${s2}`, AX, 0.3 * Math.sin(t * 7 + 1)); }
    R('neck', AX, -0.4 * h);
  }
};

// ───────────────────────────── 化蛇 ─────────────────────────────

const huashe: PoseFn = (A, name, w, stage, k, s, t) => {
  const R = rotator(A, w), P = A.P;
  const raise = (h: number): void => {
    // 前半身抬起：脊柱一节节往上弯
    R('spine2', AX, -0.25 * h); R('spine3', AX, -0.35 * h); R('chest', AX, -0.35 * h);
    R('neck', AX, 0.2 * h); R('head', AX, 0.15 * h);
  };
  const wings = (spread: number, beat: number): void => {
    for (const s2 of ['L', 'R']) {
      const sd = s2 === 'L' ? 1 : -1;
      R(`wing_1_${s2}`, AZ, sd * (1.0 * spread + beat));
      R(`wing_2_${s2}`, AZ, sd * 0.4 * spread);
    }
  };
  if (name === 'spit') {
    const h = hold(stage, k);
    raise(h);
    R('jaw', AX, 0.7 * h);
    if (stage === 'active') R('head', AX, 0.25 * Math.max(0, Math.sin(k * Math.PI * 3 * 2)));
    wings(0.3 * h, 0);
  } else if (name === 'lunge' || name === 'dive') {
    // 头往后缩成 S 形 → 往前猛扑、张嘴
    const coil = stage === 'windup' ? ease(k) : 0, strikeK = stage === 'active' ? 1 : stage === 'recover' ? 1 - ease(k) : 0;
    R('spine3', AY, 0.5 * coil); R('chest', AY, -0.8 * coil); R('neck', AY, 0.6 * coil);
    R('chest', AX, -0.4 * coil + 0.3 * strikeK);
    R('neck', AX, -0.3 * coil + 0.25 * strikeK);
    R('jaw', AX, 0.3 * coil + 0.8 * strikeK);
    both(R, 'upperarm', AX, -0.9 * strikeK);
  } else if (name === 'wingslap') {
    const up = stage === 'windup' ? ease(k) : 0, down = stage === 'active' ? ease(k) : stage === 'recover' ? 1 - ease(k) : 0;
    raise(0.6 * up + 0.3 * down);
    wings(1.3 * up - 0.6 * down, 0);
  } else if (name === 'roar') {
    const h = hold(stage, k);
    raise(1.2 * h);
    R('jaw', AX, 1.0 * h);
    R('head', AX, -0.35 * h + 0.05 * Math.sin(t * 35) * (stage === 'active' ? 1 : 0));
    wings(0.9 * h, 0.15 * h * Math.sin(t * 6));
  } else if (name === 'tailsweep') {
    const wind = stage === 'windup' ? ease(k) : 0, sw = strike(stage, k);
    for (let i = 1; i <= 8; i++) { R(`tail_${i}`, AX, -0.2 * wind); R(`tail_${i}`, AY, 0.3 * wind - 0.45 * sw); }
  } else if (name === 'choke') {
    // 噎住：翻肚子浮在水面、翅膀摊开、尾巴抽
    const h = hold(stage, k);
    P.rotate('hips', AZ, 2.6 * h * w);
    wings(-0.3 * h, 0.2 * Math.sin(t * 5) * h);
    R('jaw', AX, 0.6 * h);
    for (let i = 1; i <= 8; i++) R(`tail_${i}`, AY, 0.25 * Math.sin(t * 6 - i) * h);
  } else if (name === 'rise') {
    const h = hold(stage, k);
    raise(1.3 * h);
    wings(1.2 * h, 0.2 * Math.sin(t * 7) * h);
    R('jaw', AX, 0.8 * h * (k > 0.5 ? 1 : 0));
  }
};

// ───────────────────────────── 大鹗（4-2） ─────────────────────────────

/**
 * 大鹗的底层（每个招式都先摆它）：绑定姿势就是四视图里双翼上举的 V 形站姿，也是停在落脚点的姿势。
 * 飞的时候（s.tuck → 1）DaeBoss 的 tilt 组把整只鸟往前扳约 66°：翼面从正面转成接近水平，这里再把翅膀在体轴的正面里压到和脊柱垂直，
 * 头颈抬回来看前方，虎腿顺势拖在身后。扇翼同鹏（KunPeng.animatePeng）：上半扇（wing_*_1..3）外下压为负，
 * 下半扇（wing_*_low）反向外张、补满翼面，整扇像折扇；s.flap 扇翅强度。
 */
function daeBase(A: CreatureAnimator, w: number, s: AnimState, t: number): void {
  const R = rotator(A, w);
  const air = s.tuck, amp = s.flap, ph = t * (2.4 + 2.2 * amp);
  const beat = Math.sin(ph);
  const w1 = air * -(0.95 + 0.4 * amp * beat) - (1 - air) * (0.12 + 0.06 * amp * beat) * (1 - s.fold * 0.5);
  const w2 = air * -(0.1 + 0.14 * amp * Math.sin(ph - 0.4));
  const w3 = air * -(0.05 + 0.12 * amp * Math.sin(ph - 0.8));
  const wl = air * (0.85 - 0.3 * amp * beat) + (1 - air) * 0.05;
  for (const s2 of ['L', 'R'] as const) {
    const sd = s2 === 'L' ? 1 : -1;
    R(`wing_1_${s2}`, AZ, sd * w1);
    R(`wing_2_${s2}`, AZ, sd * w2);
    R(`wing_3_${s2}`, AZ, sd * w3);
    R(`wing_low_${s2}`, AZ, sd * wl);
    // 网格的翅膀比设计短（压平只有约 11 m）：飞的时候整扇翅膀等比放大 1.45 倍，翼展到约 15 m；停着收回原大
    //（缩放不按权重叠加，所有招式槽给的都是同一个 air，取哪一次都一样）
    A.P.scale(`wing_1_${s2}`, 1 + 0.45 * air);
    A.P.scale(`wing_low_${s2}`, 1 + 0.45 * air);
    // 虎腿：飞的时候再往后收一点、爪子攥起来
    R(`thigh_${s2}`, AX, 0.3 * air);
    R(`shin_${s2}`, AX, 0.2 * air);
    R(`talon_${s2}`, AX, 0.4 * air);
  }
  // 身子前扳了，头颈抬回来看前方
  R('neck', AX, -0.5 * air);
  R('head', AX, -0.55 * air);
  R('tail_1', AX, -0.15 * air);
}

const dae: PoseFn = (A, name, w, stage, k, s, t) => {
  const R = rotator(A, w);
  daeBase(A, w, s, t);
  const both2 = (bone: string, axis: typeof AX, a: number, mirror = false): void => both(R, bone, axis, a, mirror);
  if (name === 'dive' || name === 'diveChain') {
    // 前摇：翅膀高举、头往下盯；出手：收翼俯冲（翅膀往上收、往后掠），虎爪往前探；收招：贴地拉起，翅膀大开
    const up = stage === 'windup' ? ease(k) : 0;
    const stoop = stage === 'active' ? 1 : 0;
    const pull = stage === 'recover' ? 1 - ease(k) : 0;
    both2('wing_1', AZ, 0.3 * up + 0.35 * stoop, true);
    both2('wing_1', AX, -0.45 * stoop);
    both2('wing_low', AX, -0.25 * stoop);
    R('neck', AX, 0.3 * up + 0.15 * stoop);
    R('head', AX, 0.2 * up);
    both2('thigh', AX, -1.0 * stoop - 0.6 * pull);
    both2('talon', AX, -0.6 * stoop);
  } else if (name === 'grab') {
    // 擒拿：虎爪攥在身下、大力扇翅
    both2('thigh', AX, -1.0);
    both2('shin', AX, 0.6);
    both2('talon', AX, 0.5);
    R('neck', AX, 0.35);
  } else if (name === 'feathers' || name === 'perch') {
    // 抖翅放羽刃：前摇翅膀往后蓄、抖；出手往前一甩
    const wind = stage === 'windup' ? ease(k) : 0, fling = strike(stage, k);
    const shiver = 0.08 * Math.sin(t * 38) * (stage === 'windup' ? 1 : 0);
    both2('wing_1', AY, (-0.4 * wind + 0.5 * fling) * (name === 'perch' ? 0.4 : 1), true);
    both2('wing_1', AZ, 0.25 * wind + shiver, true);
    R('chest', AX, -0.15 * wind + 0.15 * fling);
    R('head', AX, 0.2 * fling);
  } else if (name === 'shake') {
    // 落桥摇链：虎爪抓着铁链往下拽、身子一起一伏、翅膀半张着扇
    const pump = stage === 'active' ? Math.abs(Math.sin(k * Math.PI * 5)) : hold(stage, k) * 0.5;
    A.P.translate('hips', 0, -0.35 * pump * w, 0);
    R('hips', AX, 0.25 * pump);
    both2('thigh', AX, -0.6 * pump);
    both2('shin', AX, 0.9 * pump);
    R('neck', AX, 0.3 * pump);
  } else if (name === 'nestGust') {
    // 巢中扇风：人立、双翼往前大扇
    const h = hold(stage, k), fan = stage === 'active' ? Math.sin(t * 9) : 0;
    R('hips', AX, -0.25 * h);
    both2('wing_1', AZ, 0.3 * h + 0.25 * fan, true);
    both2('wing_1', AY, 0.5 * h + 0.35 * fan, true);
    R('neck', AX, -0.2 * h);
    R('head', AX, -0.15 * h);
  } else if (name === 'fall') {
    // 坠江 / 缠翼：一侧翅膀缠住、另一侧乱扑，腿乱蹬
    const h = hold(stage, k);
    R('wing_1_L', AZ, -1.0 * h);
    R('wing_2_L', AY, -1.2 * h);
    R('wing_1_R', AZ, -(0.6 + 0.5 * Math.sin(t * 11)) * h);
    both2('thigh', AX, (-0.6 + 0.5 * Math.sin(t * 9)) * h);
    R('neck', AX, -0.4 * h);
    R('head', AY, 0.4 * Math.sin(t * 5) * h);
  } else if (name === 'cry') {
    // 长唳：仰头、翅膀半张
    const h = hold(stage, k);
    R('neck', AX, -0.45 * h);
    R('head', AX, -0.35 * h + 0.04 * Math.sin(t * 30) * h);
  }
};

// ───────────────────────────── 雷泽雷神（4-4） ─────────────────────────────

/**
 * 雷泽雷神的招式姿势只管头颈和腹鼓：上身的前倾 / 低头和双爪的落点由 leize.ts 按招式状态算（前倾分到脊柱、双爪两骨 IK），
 * 这里在它之前叠上表情性的部分——拍腹时昂首、鼓面一下下鼓起，雷息低头往两边扫，天雷阵仰天，神颓垂头。
 */
const leize: PoseFn = (A, name, w, stage, k, s, t) => {
  const R = rotator(A, w), P = A.P;
  if (name === 'bellyDrum' || name === 'tripleDrum') {
    const h = hold(stage, k);
    R('neck', AX, -0.12 * h);
    R('head', AX, -0.18 * h);
    if (stage === 'active') P.scale('drum', 1 + 0.1 * w * Math.abs(Math.sin(k * Math.PI * (name === 'tripleDrum' ? 3 : 2))));
    else if (stage === 'windup') P.scale('drum', 1 + 0.05 * w * ease(k));
  } else if (name === 'breath') {
    const h = hold(stage, k);
    R('head', AX, 0.18 * h);
    if (stage === 'active') R('head', AY, 0.35 * Math.sin(k * Math.PI - Math.PI / 2));
  } else if (name === 'clawSlam' || name === 'sweep') {
    const h = hold(stage, k);
    R('head', AX, 0.12 * h);
    R('chest', AY, (name === 'sweep' ? 0.25 : 0.1) * (stage === 'windup' ? -ease(k) : stage === 'active' ? -1 + 2 * ease(k) : 1 - ease(k)));
  } else if (name === 'skyArray' || name === 'rise') {
    const h = name === 'rise' && stage === 'windup' ? 0.5 * k : hold(stage, k);
    R('neck', AX, -0.25 * h);
    R('head', AX, -0.35 * h + 0.03 * Math.sin(t * 30) * (stage === 'active' ? h : 0));
  } else if (name === 'slump') {
    const h = hold(stage, k);
    R('neck', AX, 0.25 * h);
    R('head', AY, 0.2 * h * Math.sin(t * 2.2));
  }
};

export const POSES: Record<string, PoseFn> = {
  SK_Enemy_Marmot: marmot,
  SK_Enemy_Tiangou: tiangou,
  SK_Enemy_Aoyin: aoyin,
  SK_Enemy_Jufu: jufu,
  SK_Enemy_Manman: manman,
  SK_Enemy_Dijiang: dijiang,
  SK_Enemy_Qiongqi: qiongqi,
  SK_Boss_Kui: kui,
  SK_Boss_Feilian: feilian,
  SK_Boss_Huashe: huashe,
  SK_Boss_Dae: dae,
  SK_Boss_Leize: leize,
};

