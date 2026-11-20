import * as THREE from 'three';
import { buildClips, buildDefaultController, ensureSockets, loadCreatureAnimData } from './AnimData';
import type { CreatureAnimData } from './AnimData';
import { AnimatorStateMachine } from './AnimatorStateMachine';
import type { AnimatorEvent } from './AnimatorStateMachine';
import { CreatureLocomotion } from './CreatureLocomotion';
import { CreatureRig } from './CreatureRig';
import type { GroundProbe } from './CreatureRig';

/**
 * 一只生物的完整动画栈（Unity 预制体上 Animator + CreatureLocomotion + CreatureRig 三件套）：
 *   const anim = await CreatureAnimator.load('SK_Enemy_Fuzhu', model, { root, ground });
 *   每帧（玩法移动根节点之后）：anim.update(dt)
 *   出招：anim.playTimed('charge', chargeTime)；回移动：anim.playLocomotion()；受击：anim.hit(dir, strength, stagger)
 *   事件：anim.onEvent = (e) => { if (e.name === 'hit') … }
 * 玩法辅助照 Unity EnemyAI：Play / PlayTimed（ActScale = 片段长 / 期望秒数，钳在 0.4–2.5）/ PlayLocomotion（0.15 s）/
 * ClipLength；EnemyBody 的受击：rig.Hit + 伤害够大（staggerFraction）时触发叠加层 Hit。
 */
export interface CreatureAnimatorOptions {
  /** 角色根（玩法移动的物体）；默认 model.parent ?? model */
  root?: THREE.Object3D;
  /** 探地（脚步 IK）；不给就不做脚步 IK */
  ground?: GroundProbe | null;
  /** 不要运行时动画层（检视页逐片段看原始数据时） */
  rig?: boolean;
  /** 原地播放：减掉烘进骨骼的根节点离地高度（见 BuildClipOptions.inPlace）；玩法自己抬降根节点的敌人开 */
  inPlace?: boolean;
}

export class CreatureAnimator {
  readonly data: CreatureAnimData;
  readonly model: THREE.Object3D;
  readonly root: THREE.Object3D;
  readonly clips: Map<string, THREE.AnimationClip>;
  readonly animator: AnimatorStateMachine;
  readonly locomotion: CreatureLocomotion;
  readonly rig: CreatureRig | null;
  readonly sockets: Map<string, THREE.Object3D>;
  /** 动画事件（伤害判定、弹体、特效、音效的时刻；sfx:<id>、fx:shake…） */
  onEvent: ((e: AnimatorEvent) => void) | null = null;

  static async load(asset: string, model: THREE.Object3D, opts: CreatureAnimatorOptions = {}) {
    return new CreatureAnimator(await loadCreatureAnimData(asset), model, opts);
  }

  constructor(data: CreatureAnimData, model: THREE.Object3D, opts: CreatureAnimatorOptions = {}) {
    this.data = data;
    this.model = model;
    this.root = opts.root ?? model.parent ?? model;
    this.sockets = ensureSockets(model, data);
    this.clips = buildClips(data, { inPlace: opts.inPlace });
    // 骨骼识别要在绑定姿势下做（restLift / legLength）：先于第一次动画求值
    this.rig = opts.rig === false ? null : new CreatureRig(model, { root: this.root, ground: opts.ground ?? null, assetId: data.asset });
    this.animator = new AnimatorStateMachine(model, data.controller ?? buildDefaultController(data), this.clips);
    this.animator.onEvent = (e) => this.onEvent?.(e);
    this.locomotion = new CreatureLocomotion(this.root, this.animator, this.rig, data.moveSpeed);
  }

  update(dt: number) {
    this.locomotion.tick(dt);
    this.animator.update(dt);
    this.rig?.tick(dt);
  }

  hasState(state: string) { return this.animator.hasState(state); }
  clipLength(state: string) { return this.animator.clipLength(state); }

  /** EnemyAI.Play：ActScale 复位后 CrossFadeInFixedTime */
  play(state: string, fade = 0.08) {
    if (this.animator.hasParameter('ActScale')) this.animator.setFloat('ActScale', 1);
    this.animator.crossFadeInFixedTime(state, fade);
  }

  /** EnemyAI.PlayTimed：把片段拉伸到 seconds 正好播完（前摇被光环加速、或录制时长与玩法计时不一致时） */
  playTimed(state: string, seconds: number, fade = 0.08) {
    const len = this.clipLength(state);
    if (this.animator.hasParameter('ActScale')) this.animator.setFloat('ActScale', len > 0 && seconds > 0.05 ? THREE.MathUtils.clamp(len / seconds, 0.4, 2.5) : 1);
    this.animator.crossFadeInFixedTime(state, fade);
  }

  playLocomotion() { this.play('Locomotion', 0.15); }

  /** 招式触发器（AC_ 里的 act_<状态>，任意状态 0.12 s 过渡） */
  act(state: string) { this.animator.setTrigger(`act_${state}`); }

  /**
   * 受击（EnemyBody.OnDamaged）：dir = 攻击者 → 本体，strength ≈ 伤害 / 最大生命 × 4（0–1）；
   * stagger = 伤害达到硬直比例：叠加层播 Flinch（不打断出招、移动中也不滑步）
   */
  hit(dir: THREE.Vector3, strength: number, stagger = false) {
    this.rig?.hit(dir, strength);
    if (stagger && this.animator.hasParameter('Hit')) this.animator.setTrigger('Hit');
  }

  dispose() { this.animator.dispose(); }
}
