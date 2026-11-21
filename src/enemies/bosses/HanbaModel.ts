/**
 * 旱魃的模型层：程序化兜底体（正式美术 SK_Boss_Hanba.glb 经 BossBase 的 attachEnemyArt 挂上来时程序化实体件自动隐去）+ 动作片段播放器。
 *   · 挂点照正式美术的骨骼位置摆：心口泉珠 socket_core（3.25 m、身前 0.56 m）、日轮支点 sunring（头顶 4 m、身后 1.8 m——Unity SunRing 的跟随距离，
 *     正式美术的 SM_BossPart_HanbaSunRing 按 bind.attachment = "sunring" 挂在它上面）。
 *   · 动作：手 K 片段（art/source/characters/SK_Boss_Hanba/anim/hanba_anims.py）已由 M12 第二期导成 public/assets/anim/SK_Boss_Hanba.json：
 *     正式美术挂上、数据读好后骨骼由片段驱动（HanbaAnimator.bindClips：按播放器自己的状态 / 归一化时刻取样，顿帧倍率、拉伸、事件时刻都不变）；
 *     读好之前和程序化兜底体仍用每个片段的关键帧时刻摆几个程序化姿势（举臂、前推、俯身、上浮），出手事件按 events.json 的归一化时刻派发（{@link HanbaAnimator}），
 *     招式的判定跟事件走——和 Unity 的 act_<状态> + ActScale 一样：整段按「出手事件落在前摇结束」拉伸。
 *   · 正式美术在时，姿势写在它的原生骨骼上（NativePose：arm_L / arm_R / spine，模型空间的轴）；没有时写在程序化手臂上。
 */
import * as THREE from 'three';
import { NativePose } from '../../assets/NativeRig';
import { buildClips, type CreatureAnimData } from '../../anim/AnimData';
import { clipData } from '../../anim/ClipPlayer';
import { actScale, clipSeconds, HANBA_CLIPS } from './HanbaPlans';
import { anchor, geo, glow, glowMesh, mesh, pivot, std } from './parts';

export interface HanbaRig {
  root: THREE.Group;
  body: THREE.Object3D;
  pearl: THREE.Object3D;
  pearlGlow: THREE.Mesh;
  /** 日轮支点（挂点名 sunring） */
  ring: THREE.Group;
  /** 程序化日轮（正式美术挂上来时隐去） */
  ringProc: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  torso: THREE.Group;
}

export function buildHanba(): HanbaRig {
  const root = new THREE.Group();
  const skin = std(0x9b7054, { rough: 0.88 });
  const cloth = std(0x5e3027, { rough: 0.95 });
  const trim = std(0xbc8348, { metal: 0.5, rough: 0.5 });
  const gold = glow(0xffd27a);
  mesh(root, geo.cone(0.85, 2.4, 10), cloth, 0, 1.2, 0);
  const torso = pivot(root, 0, 2.5, 0.36);
  mesh(torso, geo.cyl(0.36, 0.58, 1.5, 9), skin, 0, 0.55, 0);
  mesh(torso, geo.sphere(0.39, 12, 9), skin, 0, 1.25, 0);
  mesh(torso, geo.cone(0.43, 1.15, 8), cloth, 0, 1.62, -0.18).rotation.x = -0.3;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const veil = mesh(root, geo.box(0.1, 2.25, 0.035), i % 2 ? cloth : trim, Math.sin(angle) * 0.72, 1.7, Math.cos(angle) * 0.52);
    veil.rotation.set(0.2 * Math.cos(angle), angle, 0.15 * Math.sin(angle));
  }
  // 手臂：肩在 (±0.33, 3.33)，绑定姿势下斜向下外（同正式美术的 A 字）
  const armL = pivot(torso, 0.33, 0.83, 0), armR = pivot(torso, -0.33, 0.83, 0);
  for (const [arm, sign] of [[armL, 1], [armR, -1]] as const) {
    mesh(arm, geo.cyl(0.095, 0.13, 1.18, 7), skin, sign * 0.33, -0.45, 0).rotation.z = sign * 0.6;
    mesh(arm, geo.sphere(0.13, 8, 6), trim, sign * 0.62, -0.92, 0);
  }
  const body = anchor(root, 0, 2.6, 0.3);
  const pearl = anchor(torso, 0, 0.75, 0.2);
  pearl.name = 'socket_core';
  const pearlGlow = glowMesh(pearl, geo.sphere(0.2, 12, 8), glow(0xa5f5f1), 0, 0, 0, 'pearl');
  const ring = pivot(root, 0, 4, -1.8);
  ring.name = 'sunring';
  const ringProc = new THREE.Group();
  ring.add(ringProc);
  mesh(ringProc, geo.torus(2.85, 0.14, 8, 64), trim);
  glowMesh(ringProc, geo.torus(2.55, 0.04, 6, 48), gold, 0, 0, 0, 'sun');
  for (let i = 0; i < 8; i++) {
    const spoke = mesh(ringProc, geo.cyl(0.035, 0.12, 5.6, 5), trim);
    spoke.rotation.z = i * Math.PI / 4;
    glowMesh(ringProc, geo.sphere(0.11, 8, 6), gold, Math.sin(i * Math.PI / 4) * 2.85, Math.cos(i * Math.PI / 4) * 2.85, 0, 'sun');
  }
  glowMesh(ringProc, geo.sphere(0.48, 12, 8), gold, 0, 0, 0, 'sun');
  return { root, body, pearl, pearlGlow, ring, ringProc, armL, armR, torso };
}

// ───────────────────────────── 姿势 ─────────────────────────────

/** 一个姿势：右 / 左臂上举（弧度，绕身体前后轴往外上方抬）、前伸（绕左右轴往前抬，负 = 甩到身后）、俯身（正 = 前倾）、上浮（米） */
interface Pose {
  rUp: number; lUp: number; rFwd: number; lFwd: number; lean: number; lift: number;
}

const P = (rUp = 0, lUp = 0, rFwd = 0, lFwd = 0, lean = 0, lift = 0): Pose => ({ rUp, lUp, rFwd, lFwd, lean, lift });
const BASE = P();

/** 每个片段的关键帧（帧, 姿势）：照 hanba_anims.py 的关键姿势时刻（起手、极限、蓄力、释放帧、过冲、收）摆 */
const KEYS: Record<string, readonly (readonly [number, Pose])[]> = {
  Idle: [[0, BASE], [45, P(0.08, 0.08, 0.05, 0.05, -0.03, 0.02)], [90, BASE]],
  intro: [[0, P(-0.1, -0.1, 0.6, 0.6, 0.7, -0.4)], [25, P(0.1, 0.1, 0.5, 0.5, 0.45, -0.2)], [70, P(1.7, 1.7, 0.2, 0.2, -0.25, 0.2)],
    [85, P(1.9, 1.9, 0.1, 0.1, -0.35, 0.25)], [120, BASE]],
  sunSweep: [[0, BASE], [7, P(-0.3, 0, -0.3, 0, 0.15, -0.1)], [17, P(2.7, 0.3, 0.3, 0, -0.15, 0.3)], [23, P(2.5, 0.3, 0.3, 0, -0.1, 0.25)],
    [31, P(2.6, 0.35, 0.35, 0, -0.12, 0.25)], [34, P(1.6, 0.3, 0.9, 0, 0.05, 0.2)], [36, P(0.9, 0.25, 1.35, 0, 0.12, 0.15)],
    [41, P(1.05, 0.3, 1.2, 0, 0.05, 0.18)], [95, P(0.85, 0.3, 1.3, 0, 0.1, 0.15)], [101, P(0.7, 0.25, 1.1, 0, 0.12, 0.1)], [110, P(0.3, 0.1, 0.4, 0, 0.05, 0.05)], [121, BASE]],
  droughtGale: [[0, BASE], [7, P(0, 0, 0.8, 0.8, 0.2, -0.05)], [19, P(0.5, 0.5, -0.9, -0.9, -0.3, 0.25)], [26, P(0.55, 0.55, -1, -1, -0.32, 0.25)],
    [28, P(0.3, 0.3, 0.4, 0.4, 0, 0.15)], [30, P(0.2, 0.2, 1.55, 1.55, 0.28, 0.05)], [34, P(0.25, 0.25, 1.65, 1.65, 0.32, 0.05)],
    [46, P(0.2, 0.2, 1.5, 1.5, 0.25, 0.05)], [58, P(0.1, 0.1, 1, 1, 0.15, 0)], [72, P(0, 0, 0.4, 0.4, 0.05, 0)], [84, BASE]],
  summonWraiths: [[0, BASE], [7, P(0, 0, 0.2, 0.2, 0.1, -0.15)], [24, P(2.9, 2.9, 0.2, 0.2, -0.2, 0.35)], [30, P(2.7, 2.7, 0.2, 0.2, -0.15, 0.3)],
    [42, P(2.8, 2.8, 0.25, 0.25, -0.18, 0.3)], [46, P(1.5, 1.5, 0.7, 0.7, 0.1, 0.1)], [48, P(0.25, 0.25, 0.95, 0.95, 0.35, -0.25)],
    [52, P(0.15, 0.15, 1, 1, 0.42, -0.3)], [64, P(0.2, 0.2, 0.9, 0.9, 0.35, -0.22)], [84, BASE]],
  crackPalm: [[0, BASE], [7, P(-0.4, 0, -0.5, 0, 0.1, -0.05)], [19, P(2.9, 0.3, 0.2, 0, -0.25, 0.35)], [25, P(2.7, 0.3, 0.2, 0, -0.2, 0.3)],
    [31, P(2.8, 0.35, 0.25, 0, -0.22, 0.3)], [34, P(1.4, 0.3, 0.9, 0, 0.3, 0)], [36, P(0.1, 0.3, 1.25, 0.2, 0.75, -0.66)],
    [39, P(0.05, 0.35, 1.3, 0.25, 0.85, -0.75)], [46, P(0.1, 0.3, 1.25, 0.2, 0.75, -0.66)], [112, P(0.1, 0.3, 1.25, 0.2, 0.75, -0.66)],
    [120, P(0.6, 0.3, 0.9, 0.1, 0.4, -0.3)], [134, P(0.2, 0.1, 0.3, 0, 0.1, 0)], [150, BASE]],
  apsaraCall: [[0, BASE], [8, P(0.3, 0.3, 0.2, 0.2, 0, 0)], [30, P(-0.2, -0.2, 1.2, 1.2, 0.2, 0.05)], [46, P(-0.25, -0.25, 1.25, 1.25, 0.25, 0.05)],
    [52, P(1, 1, 0.8, 0.8, 0, 0.15)], [54, P(2.2, 2.2, 0.3, 0.3, -0.2, 0.3)], [58, P(2.4, 2.4, 0.2, 0.2, -0.25, 0.35)], [70, P(2.1, 2.1, 0.3, 0.3, -0.15, 0.25)], [90, BASE]],
  eclipse: [[0, BASE], [7, P(-0.2, -0.2, 1.1, 1.1, 0.3, -0.05)], [18, P(0.2, 0.2, 0, 0, 0, 0.05)], [20, P(0.5, 0.5, -0.9, -0.9, -0.35, 0.15)],
    [24, P(0.55, 0.55, -1, -1, -0.4, 0.18)], [95, P(0.5, 0.5, -0.9, -0.9, -0.35, 0.15)], [104, P(-0.1, -0.1, 0.8, 0.8, 0.25, -0.05)],
    [110, P(-0.15, -0.15, 0.9, 0.9, 0.3, -0.08)], [116, P(1.2, 1.2, 0.4, 0.4, 0, 0.15)], [118, P(2.8, 2.8, 0.2, 0.2, -0.4, 0.35)],
    [123, P(3, 3, 0.15, 0.15, -0.45, 0.4)], [135, BASE]],
  Hit: [[0, BASE], [4, P(0.9, 0.9, 0.2, 0.2, -0.3, 0.05)], [21, BASE]],
  death: [[0, BASE], [22, P(1.6, 1.6, 0.4, 0.4, -0.4, 0.1)], [60, P(-0.2, -0.2, 0.6, 0.6, 0.9, -0.8)], [95, P(-0.3, -0.3, 0.7, 0.7, 0.6, -1.25)], [120, P(-0.3, -0.3, 0.7, 0.7, 0.6, -1.25)]],
};

function sample(state: string, u: number, out: Pose): Pose {
  const keys = KEYS[state] ?? KEYS.Idle;
  const frames = HANBA_CLIPS[state]?.frames ?? 90;
  const f = Math.min(1, Math.max(0, u)) * frames;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1][0] < f) i++;
  const [fa, a] = keys[i];
  const [fb, b] = keys[Math.min(keys.length - 1, i + 1)];
  const k = fb > fa ? Math.min(1, Math.max(0, (f - fa) / (fb - fa))) : 1;
  const s = k * k * (3 - 2 * k);
  out.rUp = a.rUp + (b.rUp - a.rUp) * s;
  out.lUp = a.lUp + (b.lUp - a.lUp) * s;
  out.rFwd = a.rFwd + (b.rFwd - a.rFwd) * s;
  out.lFwd = a.lFwd + (b.lFwd - a.lFwd) * s;
  out.lean = a.lean + (b.lean - a.lean) * s;
  out.lift = a.lift + (b.lift - a.lift) * s;
  return out;
}

const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);

/**
 * 片段播放器（Unity Animator + act_<状态> 触发 + ActScale + 叠加事件表）：play(state, seconds) 把整段拉伸到 seconds 秒（倍率夹在 0.4–2.5），
 * 推进时越过事件的归一化时刻就派发（"hit" / "beamStart" / "summon" / "fx:*" / "sfx:*"…）；非循环片段播完回到 Idle（0.2 s 过渡）。
 * speed 是顿帧用的整体倍率（Unity anim.speed）。
 */
export class HanbaAnimator {
  state = 'Idle';
  u = 0;
  scale = 1;
  speed = 1;
  /** 累计：播过几个片段、派发过几个事件 */
  plays = 0;
  events = 0;
  private readonly pose = P();
  private readonly prevPose = P();
  private blendT = 1;
  private native: NativePose | null = null;
  /** 片段取样器（M12）：每个状态一个动作，时刻由 u 直接给，权重做 0.2 s 的交叉淡入 */
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private prevState = 'Idle';
  private prevU = 0;

  constructor(private readonly rig: HanbaRig, private readonly emit: (evt: string) => void) {}

  /** 正式美术的原生骨骼（init 之后找；没有时只摆程序化手臂） */
  bindNative(host: THREE.Object3D): void {
    let model: THREE.Object3D | null = null;
    for (const c of host.children) {
      let found = false;
      c.traverse((o) => { if ((o as THREE.Bone).isBone && o.name === 'arm_R') found = true; });
      if (found) {
        model = c;
        break;
      }
    }
    if (!model) return;
    try {
      this.native = new NativePose(model, host);
    } catch (err) {
      console.warn('[Hanba] 原生骨骼姿势层建不起来，退回程序化手臂', err);
      this.native = null;
    }
    const m = model;
    void clipData('SK_Boss_Hanba').then((d) => this.bindClips(m, d));
  }

  /** 手 K 片段接到正式美术的骨骼上（数据读不到 / 片段不全时保持程序化姿势） */
  bindClips(model: THREE.Object3D, data: CreatureAnimData | null): void {
    if (!data || this.mixer) return;
    try {
      const clips = buildClips(data);
      const mixer = new THREE.AnimationMixer(model);
      for (const name of Object.keys(HANBA_CLIPS)) {
        const clip = clips.get(name);
        if (!clip) throw new Error(`没有片段 ${name}`);
        const a = mixer.clipAction(clip);
        a.timeScale = 0;
        a.setEffectiveWeight(0);
        a.play();
        this.actions.set(name, a);
      }
      this.mixer = mixer;
    } catch (err) {
      console.warn('[Hanba] 片段没接上，保持程序化姿势', err);
      this.actions.clear();
      this.mixer = null;
    }
  }

  /** 骨骼由片段驱动（正式美术 + 动画数据都在） */
  get clipDriven(): boolean {
    return this.mixer !== null;
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.actions.clear();
  }

  get hasNative(): boolean {
    return this.native !== null;
  }

  play(state: string, seconds: number): void {
    if (!HANBA_CLIPS[state]) return;
    Object.assign(this.prevPose, this.pose);
    this.prevState = this.state;
    this.prevU = Math.min(1, this.u);
    this.blendT = 0;
    this.state = state;
    this.u = 0;
    this.scale = actScale(state, seconds);
    this.plays++;
    this.fire(-1, 0);
  }

  /** 片段在当前倍率下还要多久播完（秒） */
  get remaining(): number {
    const len = clipSeconds(this.state);
    return len > 0 ? (1 - this.u) * len / Math.max(0.01, this.scale) : 0;
  }

  update(dt: number): void {
    const clip = HANBA_CLIPS[this.state];
    const len = clipSeconds(this.state);
    if (clip && len > 0) {
      const prev = this.u;
      this.u += dt * this.speed * this.scale / len;
      if (clip.loop) {
        if (this.u >= 1) this.u -= Math.floor(this.u);
      } else {
        this.fire(prev, Math.min(1, this.u));
        if (this.u >= 1 && this.state !== 'death') {
          Object.assign(this.prevPose, this.pose);
          this.prevState = this.state;
          this.prevU = 1;
          this.blendT = 0;
          this.state = 'Idle';
          this.u = 0;
          this.scale = 1;
        }
      }
    }
    this.blendT = Math.min(1, this.blendT + dt / 0.2);
    const target = sample(this.state, Math.min(1, this.u), P());
    const k = this.blendT;
    const p = this.pose;
    for (const key of ['rUp', 'lUp', 'rFwd', 'lFwd', 'lean', 'lift'] as const) p[key] = this.prevPose[key] + (target[key] - this.prevPose[key]) * k;
    this.apply(p);
  }

  /** 姿势里的上浮（米，加在悬浮高度上） */
  get lift(): number {
    // 片段里骨盆自己起伏（hips 的位置曲线），不再另外抬模型
    return this.mixer ? 0 : this.pose.lift;
  }

  private fire(prev: number, now: number): void {
    const clip = HANBA_CLIPS[this.state];
    if (!clip) return;
    for (const [at, name] of clip.events) {
      if (at > prev && at <= now || (prev < 0 && at <= 0)) {
        this.events++;
        this.emit(name);
      }
    }
  }

  private apply(p: Pose): void {
    const r = this.rig;
    r.armR.rotation.set(-p.rFwd, 0, -p.rUp);
    r.armL.rotation.set(-p.lFwd, 0, p.lUp);
    r.torso.rotation.x = p.lean * 0.6;
    if (this.mixer) {
      // 片段驱动：当前状态按 u 取样，和上一个状态（停在切走那一刻）交叉淡入
      for (const a of this.actions.values()) a.setEffectiveWeight(0);
      const set = (state: string, u: number, w: number): void => {
        const a = this.actions.get(state);
        if (!a || w <= 0) return;
        const d = a.getClip().duration;
        a.time = Math.min(Math.max(0, u) * d, d - 1e-4);
        a.setEffectiveWeight(a.getEffectiveWeight() + w);
      };
      const k = this.prevState === this.state ? 1 : this.blendT;
      set(this.state, Math.min(1, this.u), k);
      if (k < 1) set(this.prevState, this.prevU, 1 - k);
      this.mixer.update(0);
      return;
    }
    const n = this.native;
    if (!n) return;
    n.reset();
    n.rotate('spine', X, p.lean * 0.5);
    n.rotate('chest', X, p.lean * 0.3);
    n.rotate('arm_R', X, -p.rFwd);
    n.rotate('arm_R', Z, -p.rUp);
    n.rotate('arm_L', X, -p.lFwd);
    n.rotate('arm_L', Z, p.lUp);
  }
}
