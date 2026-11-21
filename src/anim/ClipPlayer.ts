import * as THREE from 'three';
import { loadAnimManifest, loadCreatureAnimData } from './AnimData';
import type { AnimManifest, CreatureAnimData } from './AnimData';
import type { AnimatorEvent } from './AnimatorStateMachine';
import { CreatureAnimator } from './CreatureAnimator';
import type { GroundProbe } from './CreatureRig';

/**
 * 敌人 / 首领的片段播放器（M12 第二期）：Unity 预制体上 Animator + CreatureLocomotion + CreatureRig 三件套，加上 EnemyAI 的
 * Play / PlayTimed / PlayLocomotion 与 EnemyBody 的受击（Rig.Hit + 「Hit」触发器）。
 *
 * 动画数据（public/assets/anim/<资产>.json）异步读：读好之前 ready = false，调用方继续用程序化摆姿势；
 * 这期间要播的状态记下最后一个，读好后补播。清单里没有这个资产（没有片段）就一直不 ready —— 程序化摆姿势是退路。
 *
 * 顺序：玩法移动根节点、程序化摆姿势（若还在跑）→ update(dt)：步态参数 → 状态机求值（覆盖片段驱动的骨骼）→ CreatureRig（脚步 IK、看向、受击弹簧）。
 */
let manifest: Promise<AnimManifest | null> | null = null;
const cache = new Map<string, Promise<CreatureAnimData | null>>();

/** 资产的动画数据（每个资产只读一次）；清单里没有、或读不到 → null */
export function clipData(asset: string): Promise<CreatureAnimData | null> {
  let p = cache.get(asset);
  if (!p) {
    manifest ??= loadAnimManifest().catch((err) => {
      console.warn('[anim] 动画清单读不到，敌人退回程序化摆姿势', err);
      return null;
    });
    p = manifest.then((m) => (m?.assets[asset] ? loadCreatureAnimData(asset) : null)).catch((err) => {
      console.warn(`[anim] ${asset} 动画数据读不到`, err);
      return null;
    });
    cache.set(asset, p);
  }
  return p;
}

export interface ClipPlayerOptions {
  /** 玩法移动的根节点（Speed / 转身倾斜从它的运动推导） */
  root: THREE.Object3D;
  /** 探地（脚步 IK）；不给就不做脚步 IK */
  ground?: GroundProbe | null;
  /** 原地播放（减掉烘进骨骼的根节点离地高度）；默认开 */
  inPlace?: boolean;
  /** 运行时动画层（CreatureRig）；默认开 */
  rig?: boolean;
  /** 已经读好的数据（测试 / 首领自己管缓存时）：同步建好，不走 fetch */
  data?: CreatureAnimData | null;
}

interface Request {
  state: string;
  seconds: number;
  fade: number;
}

export class ClipPlayer {
  readonly asset: string;
  anim: CreatureAnimator | null = null;
  /** 动画事件（片段里的 hit / release / sfx:… / fx:…） */
  onEvent: ((e: AnimatorEvent) => void) | null = null;
  /** 读好以后（建好状态机那一刻）回调一次 */
  onReady: ((p: ClipPlayer) => void) | null = null;
  /** 冻住（死亡：Unity 没有布娃娃时关掉 Animator，停在最后一帧） */
  frozen = false;
  /** 看向（CreatureRig.lookTarget；读好之前设也算数） */
  private look: THREE.Vector3 | null = null;
  private pending: Request | null = null;
  private disposed = false;
  /** 绑定姿势快照：数据读好时骨骼可能已经被程序化摆过，CreatureRig 要在绑定姿势下量腿长 / 脚高 */
  private readonly bind: { o: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3; s: THREE.Vector3 }[] = [];

  constructor(asset: string, readonly model: THREE.Object3D, private readonly opts: ClipPlayerOptions) {
    this.asset = asset;
    model.traverse((o) => this.bind.push({ o, q: o.quaternion.clone(), p: o.position.clone(), s: o.scale.clone() }));
    if (opts.data !== undefined) this.build(opts.data);
    else void clipData(asset).then((d) => this.build(d));
  }

  private build(data: CreatureAnimData | null): void {
    if (!data || this.disposed || this.anim) return;
    try {
      for (const b of this.bind) {
        b.o.quaternion.copy(b.q);
        b.o.position.copy(b.p);
        b.o.scale.copy(b.s);
      }
      this.model.updateWorldMatrix(true, true);
      const a = new CreatureAnimator(data, this.model, {
        root: this.opts.root, ground: this.opts.ground ?? null, rig: this.opts.rig, inPlace: this.opts.inPlace ?? true,
      });
      a.onEvent = (e) => this.onEvent?.(e);
      if (a.rig) a.rig.lookTarget = this.look;
      this.anim = a;
      const p = this.pending;
      this.pending = null;
      if (p) this.request(p.state, p.seconds, p.fade);
      this.onReady?.(this);
    } catch (err) {
      console.error(`[anim] ${this.asset} 片段没接上，退回程序化摆姿势`, err);
      this.anim = null;
    }
  }

  /** 状态机建好了：片段驱动骨骼（调用方的程序化骨骼姿势让位） */
  get ready(): boolean {
    return this.anim !== null && !this.disposed;
  }

  has(state: string): boolean {
    return this.anim?.hasState(state) ?? false;
  }

  clipLength(state: string): number {
    return this.anim?.clipLength(state) ?? 0;
  }

  /** 当前（第 0 层）状态名；没建好为 null */
  get state(): string | null {
    return this.anim?.animator.currentState(0)?.name ?? null;
  }

  /** EnemyAI.Play：ActScale 复位后 CrossFadeInFixedTime（没有这个状态：Unity 报警告、什么也不做） */
  play(state: string, fade = 0.08): void {
    this.request(state, 0, fade);
  }

  /** EnemyAI.PlayTimed：片段拉伸到 seconds 正好播完（ActScale = 片段长 / seconds，钳在 0.4–2.5） */
  playTimed(state: string, seconds: number, fade = 0.08): void {
    this.request(state, seconds, fade);
  }

  /** EnemyAI.PlayLocomotion */
  playLocomotion(): void {
    this.request('Locomotion', 0, 0.15);
  }

  private request(state: string, seconds: number, fade: number): void {
    const a = this.anim;
    if (!a) {
      if (!this.disposed) this.pending = { state, seconds, fade };
      return;
    }
    if (!a.hasState(state)) return;
    if (seconds > 0.05) a.playTimed(state, seconds, fade);
    else a.play(state, fade);
  }

  /** 招式触发器（控制器里的 act_<状态>） */
  act(state: string): void {
    this.anim?.act(state);
  }

  /** EnemyBody.OnDamaged：方向性受击弹簧（strength 0–1）；stagger = 伤害够大，叠加层播 Flinch */
  hit(dir: THREE.Vector3, strength: number, stagger: boolean): void {
    if (!this.anim || this.frozen) return;
    this.anim.hit(dir, strength, stagger);
  }

  set lookTarget(v: THREE.Vector3 | null) {
    this.look = v;
    if (this.anim?.rig) this.anim.rig.lookTarget = v;
  }

  get lookTarget(): THREE.Vector3 | null {
    return this.look;
  }

  /** CreatureRig 的晕眩叠加（Unity body.Rig.daze）：0 / 1 */
  set daze(v: number) {
    if (this.anim?.rig) this.anim.rig.daze = v;
  }

  /** animDt：片段走的时间（首领顿帧时 ≠ dt，见 CreatureAnimator.update） */
  update(dt: number, animDt = dt): void {
    if (!this.anim || this.frozen || !(dt > 0)) return;
    this.anim.update(dt, animDt);
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
    this.anim?.dispose();
    this.anim = null;
  }
}
