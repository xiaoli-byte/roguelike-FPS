/**
 * 熔心魔将的模型层：程序化兜底体（正式美术 SK_Boss_Warlord.glb 没载入时用；载入后整体隐去）+ 片段播放器（Unity Animator + act_ 触发 + ActScale）。
 *   · 正式美术：v006 人形骨架（root → hips → spine → chest → neck → head，四肢、五指、肩甲，挂点 socket_sword / socket_sword_tip / socket_core /
 *     socket_helm / socket_pauldron_L/R）。11-07 换骨架后采样片段作废：片段按 WarlordPoses.ts 的姿势表在网页里现场解算烘焙（WarlordPoser.ts），
 *     关键帧之间插值，出手事件按片段表的帧位置派发——同 Unity 的「Blender 手 K 片段 + events.json」。
 *   · 大剑：程序化体里命名为 greatsword 的挂点（清单 bind.attachment = greatsword 的 SM_BossWeapon_Greatsword 挂在它上面），
 *     正式美术在时整组挪到 socket_sword 握点下（剑身 −Y 对准握点 → 剑尖，绑定姿势下剑尖朝下、刃朝 ±X），跟着握法转。
 *   · 播放：play(state, seconds) 把整段拉伸到 seconds 秒（倍率夹在 0.4–2.5）；playFrom 从片段中途接着播（登场停顿 → 咆哮的缩身帧）；
 *     片段有 next 时播完接下一段（同一倍率）；非循环片段播完回到步态（Idle / Walk / Move 按移动速度挑，0.2 s 过渡）；speed 是顿帧用的整体倍率。
 */
import * as THREE from 'three';
import { anchor, geo, glow, glowMesh, mesh, pivot, scaled, std } from './parts';
import { bakeClip, blendPose, copyPose, emptyPose, KEYED, sampleClip, WarlordPoser, type BakedPose } from './WarlordPoser';
import { CLIPS, clipSeconds } from './WarlordPoses';

export interface WarlordRig {
  root: THREE.Group;
  /** 程序化兜底体（正式美术在时整体隐去） */
  proc: THREE.Group;
  torso: THREE.Group;
  armS: THREE.Group; elbowS: THREE.Group;
  armO: THREE.Group;
  /** 大剑挂点（名字 greatsword）、剑尖 */
  sword: THREE.Group;
  bladeTip: THREE.Object3D;
  head: THREE.Group;
  chest: THREE.Object3D;
  core: THREE.Object3D;
  pauldronL: THREE.Object3D; pauldronR: THREE.Object3D;
  kneeL: THREE.Object3D; kneeR: THREE.Object3D;
}

const mats = () => ({
  iron: std(0x3a3438, { rough: 0.55, metal: 0.6 }),
  ironDark: std(0x241f22, { rough: 0.6, metal: 0.5 }),
  gold: std(0x9c6b2a, { rough: 0.4, metal: 0.7 }),
  bone: std(0x2a1f1a, { rough: 0.8 }),
  cloth: std(0x7a1414, { rough: 0.9 }),
  blade: std(0x2a2226, { rough: 0.35, metal: 0.8, emissive: 0x3a0a00, ei: 1 }),
  ember: glow(0xff7a2a),
  core: glow(0xffb45a),
  eye: glow(0xffc070),
});

type Mats = ReturnType<typeof mats>;

function buildLeg(hips: THREE.Object3D, side: number, m: Mats): THREE.Object3D {
  const leg = pivot(hips, 0.3 * side, -0.1, 0);
  mesh(leg, geo.box(0.36, 0.72, 0.42), m.ironDark, 0, -0.36, 0);
  const knee = pivot(leg, 0, -0.74, 0);
  mesh(knee, geo.cone(0.15, 0.4, 5), m.iron, 0, 0.02, 0.2, Math.PI / 2);
  mesh(knee, geo.cyl(0.19, 0.24, 0.66, 6), m.iron, 0, -0.34, 0);
  mesh(knee, geo.box(0.34, 0.16, 0.6), m.ironDark, 0, -0.7, 0.1);
  return anchor(knee, 0, -0.3, 0);
}

function buildArm(torso: THREE.Object3D, side: number, m: Mats): { arm: THREE.Group; elbow: THREE.Group } {
  const arm = pivot(torso, 0.86 * side, 0.88, 0);
  mesh(arm, geo.box(0.3, 0.68, 0.32), m.ironDark, 0, -0.34, 0);
  const elbow = pivot(arm, 0, -0.7, 0);
  mesh(elbow, geo.dodeca(0.17), m.iron, 0, 0, 0);
  mesh(elbow, geo.cyl(0.16, 0.2, 0.6, 6), m.iron, 0, -0.3, 0);
  mesh(elbow, geo.box(0.28, 0.26, 0.3), m.ironDark, 0, -0.68, 0);
  return { arm, elbow };
}

/** 程序化大剑：原点 = 握点、剑身朝 −Y（同 SM_BossWeapon_Greatsword） */
function buildSword(hand: THREE.Object3D, m: Mats): { sword: THREE.Group; tip: THREE.Object3D } {
  const sword = pivot(hand, 0, -0.72, 0.06);
  sword.name = 'greatsword'; // 挂点名：美术资产按它绑定（清单 bind.attachment）
  mesh(sword, geo.cyl(0.045, 0.045, 0.45, 6), m.bone, 0, 0.2, 0);
  mesh(sword, geo.dodeca(0.075), m.gold, 0, 0.46, 0);
  mesh(sword, geo.box(0.62, 0.1, 0.16), m.iron, 0, -0.06, 0);
  mesh(sword, geo.box(0.2, 2.3, 0.06), m.blade, 0, -1.27, 0);
  glowMesh(sword, geo.box(0.04, 2.2, 0.08), m.ember, 0.11, -1.27, 0, 'blade');
  glowMesh(sword, geo.box(0.04, 2.2, 0.08), m.ember, -0.11, -1.27, 0, 'blade');
  mesh(sword, geo.cone(0.1, 0.35, 4), m.blade, 0, -2.55, 0, Math.PI);
  const tip = anchor(sword, 0, -2.65, 0);
  return { sword, tip };
}

/** 程序化兜底体（约 3.7 米高，朝 +Z，脚底在原点；持剑手在 −X = 模型自身的右侧） */
export function buildWarlord(): WarlordRig {
  const m = mats();
  const root = new THREE.Group();
  const proc = pivot(root, 0, 0, 0);
  const hips = pivot(proc, 0, 1.62, 0);
  mesh(hips, geo.box(0.95, 0.42, 0.62), m.ironDark, 0, 0, 0);
  mesh(hips, geo.box(1.0, 0.14, 0.68), m.gold, 0, 0.2, 0);
  for (const s of [-1, 1]) {
    mesh(hips, geo.box(0.4, 0.7, 0.07), m.iron, 0.26 * s, -0.38, 0.34, -0.18);
    mesh(hips, geo.box(0.4, 0.7, 0.07), m.iron, 0.26 * s, -0.38, -0.34, 0.18);
  }
  const kneeR = buildLeg(hips, -1, m);
  const kneeL = buildLeg(hips, 1, m);
  const torso = pivot(proc, 0, 1.9, 0);
  mesh(torso, geo.cyl(0.5, 0.42, 0.5, 7), m.ironDark, 0, 0.2, 0);
  mesh(torso, geo.cyl(0.75, 0.52, 0.8, 6), m.iron, 0, 0.72, 0);
  mesh(torso, geo.box(0.95, 0.62, 0.26), m.iron, 0, 0.75, 0.4, -0.12);
  glowMesh(torso, geo.octa(0.2), m.core, 0, 0.72, 0.56, 'core');
  const pauldrons: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    scaled(mesh(torso, geo.dodeca(0.42), m.iron, 0.84 * s, 1.02, 0), 1.25, 0.85, 1.1);
    mesh(torso, geo.cone(0.09, 0.5, 5), m.bone, 0.98 * s, 1.38, 0, 0, 0, -0.4 * s);
    pauldrons.push(anchor(torso, 0.84 * s, 1.02, 0));
  }
  const chest = anchor(torso, 0, 0.5, 0.05);
  const core = anchor(torso, 0, 0.72, 0.56);
  const cape = pivot(torso, 0, 1.05, -0.42);
  mesh(cape, geo.box(1.25, 2.0, 0.05), m.cloth, 0, -1.0, -0.02);
  const AS = buildArm(torso, -1, m);
  const AO = buildArm(torso, 1, m);
  const S = buildSword(AS.elbow, m);
  mesh(torso, geo.cyl(0.16, 0.2, 0.25, 6), m.ironDark, 0, 1.08, 0);
  const head = pivot(torso, 0, 1.28, 0.03);
  mesh(head, geo.cyl(0.27, 0.31, 0.5, 6), m.iron, 0, 0, 0);
  mesh(head, geo.cone(0.28, 0.25, 6), m.iron, 0, 0.37, 0);
  mesh(head, geo.box(0.44, 0.34, 0.12), m.ironDark, 0, -0.06, 0.25);
  glowMesh(head, geo.box(0.32, 0.06, 0.04), m.eye, 0, 0.03, 0.32, 'eye');
  for (const s of [-1, 1]) {
    const h1 = pivot(head, 0.26 * s, 0.22, -0.02);
    h1.rotation.z = -0.95 * s;
    mesh(h1, geo.cone(0.1, 0.55, 5), m.bone, 0, 0.27, 0);
  }
  return {
    root, proc, torso, armS: AS.arm, elbowS: AS.elbow, armO: AO.arm, sword: S.sword, bladeTip: S.tip, head, chest, core,
    pauldronR: pauldrons[0], pauldronL: pauldrons[1], kneeL, kneeR,
  };
}

// ───────────────────────────── 片段播放器 ─────────────────────────────

const LOCOMOTION = ['Idle', 'Walk', 'Move'] as const;

/** 片段倍率（Unity ActScale）：整段拉伸到 seconds 秒播完，夹在 0.4–2.5 */
export function actScale(state: string, seconds: number): number {
  const len = clipSeconds(state);
  return len > 0 && seconds > 0.05 ? Math.min(2.5, Math.max(0.4, len / seconds)) : 1;
}

export class WarlordAnimator {
  /** 当前片段（步态时是 Idle / Walk / Move） */
  state = 'Idle';
  u = 0;
  scale = 1;
  /** 顿帧倍率（Unity anim.speed） */
  speed = 1;
  /** 正在播招式片段（不是步态） */
  acting = false;
  plays = 0;
  events = 0;
  /** 本帧的水平移动速度（米/秒；挑步态） */
  moveSpeed = 0;
  private poser: WarlordPoser | null = null;
  private signature = '';
  private readonly live = new Map<string, THREE.Object3D>();
  private hipsRest = new THREE.Vector3();
  private readonly cur = emptyPose();
  private readonly from = emptyPose();
  private readonly out = emptyPose();
  private blendT = 1;
  private blendLen = 0.1;
  private hasPose = false;
  /** 兜底：最近一次出手动作的进度（程序化体摆臂用） */
  private procSwing = 0;

  constructor(private readonly rig: WarlordRig, private readonly emit: (evt: string) => void) {}

  /** 正式美术的骨骼（init 之后找）；骨架不全时返回 false（只摆程序化体） */
  bindNative(model: THREE.Object3D): boolean {
    let rootBone: THREE.Object3D | null = null;
    model.traverse((o) => {
      if (!rootBone && o.name === 'root' && ((o as THREE.Bone).isBone || o.children.some(c => (c as THREE.Bone).isBone))) rootBone = o;
    });
    if (!rootBone) return false;
    const poser = WarlordPoser.fromBones(rootBone);
    if (!poser.ok) {
      console.warn('[Warlord] 正式模型缺骨，退回程序化体：', poser.missing.join(', '));
      return false;
    }
    this.poser = poser;
    this.signature = `${poser.pos('hand_R').toArray().map(v => v.toFixed(3)).join(',')}`;
    (rootBone as THREE.Object3D).traverse((o) => {
      if (o.name) this.live.set(o.name, o);
    });
    this.hipsRest = this.live.get('hips')!.position.clone();
    return true;
  }

  get hasNative(): boolean {
    return this.poser !== null;
  }

  bone(name: string): THREE.Object3D | null {
    return this.live.get(name) ?? null;
  }

  /** 状态机里有没有这个状态（没有 = 不会有片段事件，释放帧当帧就放） */
  hasState(state: string): boolean {
    return !!CLIPS[state];
  }

  /** 触发一个动作：整段拉伸到 seconds 秒（Unity Act：act_ 触发器 + ActScale） */
  play(state: string, seconds: number, fade = 0.1): void {
    this.playFrom(state, seconds, 0, fade);
  }

  /** 从片段的 offset（0–1）处交叉淡入一个状态，整段仍按 seconds 拉伸 */
  playFrom(state: string, seconds: number, offset: number, fade = 0.1): void {
    if (!CLIPS[state]) return;
    this.startBlend(fade);
    this.state = state;
    this.u = Math.min(1, Math.max(0, offset));
    this.scale = actScale(state, seconds);
    this.acting = !LOCOMOTION.includes(state as typeof LOCOMOTION[number]);
    this.plays++;
    this.procSwing = 0;
    this.fire(this.u > 0 ? this.u : -1, this.u);
  }

  /** 片段在当前倍率下还要多久播完（秒） */
  get remaining(): number {
    const len = clipSeconds(this.state);
    return len > 0 ? (1 - this.u) * len / Math.max(0.01, this.scale) : 0;
  }

  private startBlend(len: number): void {
    if (this.hasPose) copyPose(this.out, this.from);
    this.blendT = this.hasPose ? 0 : 1;
    this.blendLen = Math.max(0.01, len);
  }

  update(dt: number): void {
    const clip = CLIPS[this.state];
    const len = clipSeconds(this.state);
    if (clip && len > 0) {
      const prev = this.u;
      let rate = this.scale;
      if (!this.acting && clip.speed) rate = Math.min(1.7, Math.max(0.6, this.moveSpeed / clip.speed));
      this.u += dt * this.speed * rate / len;
      if (clip.loop) {
        if (this.u >= 1) {
          this.fire(prev, 1);
          this.u -= Math.floor(this.u);
          this.fire(-1, this.u);
        } else this.fire(prev, this.u);
      } else {
        this.fire(prev, Math.min(1, this.u));
        if (this.u >= 1 && this.state !== 'death') {
          if (clip.next && CLIPS[clip.next]) {
            const scale = this.scale;
            this.playFrom(clip.next, 0, 0, 0.06);
            this.scale = scale;
          } else this.toLocomotion(0.2);
        }
      }
    }
    // 步态：没在出招时按移动速度挑 Idle / Walk / Move
    if (!this.acting) {
      const want = this.moveSpeed < 0.6 ? 'Idle' : this.moveSpeed < 3.4 ? 'Walk' : 'Move';
      if (want !== this.state) {
        this.startBlend(0.25);
        this.state = want;
        this.u = 0;
        this.scale = 1;
      }
    }
    this.blendT = Math.min(1, this.blendT + dt / this.blendLen);
    this.procSwing += dt * this.scale;
    this.apply();
  }

  private toLocomotion(fade: number): void {
    this.startBlend(fade);
    this.acting = false;
    this.state = this.moveSpeed < 0.6 ? 'Idle' : this.moveSpeed < 3.4 ? 'Walk' : 'Move';
    this.u = 0;
    this.scale = 1;
  }

  private fire(prev: number, now: number): void {
    const clip = CLIPS[this.state];
    if (!clip) return;
    for (const [frame, name] of clip.events) {
      const at = frame / clip.frames;
      if ((at > prev && at <= now) || (prev < 0 && at <= now && at <= 0)) {
        this.events++;
        this.emit(name);
      }
    }
  }

  private apply(): void {
    const poser = this.poser;
    if (!poser) {
      this.applyProc();
      return;
    }
    const baked = bakeClip(poser, this.state, this.signature);
    if (!baked) return;
    sampleClip(baked, this.u, this.cur);
    if (this.blendT < 1 && this.hasPose) {
      const k = this.blendT * this.blendT * (3 - 2 * this.blendT);
      blendPose(this.from, this.cur, k, this.out);
    } else copyPose(this.cur, this.out);
    this.hasPose = true;
    for (const name of KEYED) {
      const b = this.live.get(name);
      const q = this.out.q.get(name);
      if (b && q) b.quaternion.copy(q);
    }
    const hips = this.live.get('hips');
    if (hips) hips.position.copy(this.out.hips);
  }

  /** 程序化兜底体：出手片段时持剑臂抡一下（没有骨骼片段） */
  private applyProc(): void {
    const r = this.rig;
    const swing = this.acting ? Math.sin(Math.min(1, this.u) * Math.PI) : 0;
    r.armS.rotation.x = -swing * 1.6;
    r.elbowS.rotation.x = -swing * 0.6;
    r.armO.rotation.x = -swing * 0.5;
    r.torso.rotation.x = swing * 0.15;
  }

  /** 叠在动画之上：上身 / 头绕世界竖轴额外转 deg 度（转身时目光领先） */
  leadTurn(torsoDeg: number, headDeg: number): void {
    for (const [name, deg] of [['spine', torsoDeg], ['head', headDeg]] as const) {
      const b = this.live.get(name);
      if (!b || !b.parent || Math.abs(deg) < 0.05) continue;
      b.parent.updateWorldMatrix(true, false);
      const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg * Math.PI / 180);
      b.quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq));
    }
  }

  /** 髋在绑定姿势下的位置（测试 / 调试） */
  get hipsRestY(): number {
    return this.hipsRest.y;
  }

  /** 当前姿势（测试 / 调试） */
  get pose(): BakedPose {
    return this.out;
  }
}
