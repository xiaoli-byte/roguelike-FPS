import * as THREE from 'three';
import { clipMeta, makeAdditiveClip } from './AnimData';
import type { ClipMeta, ControllerDef, LayerDef, ParameterDef, StateDef, TransitionDef } from './AnimData';

/**
 * Unity Animator（Mecanim）在 THREE.AnimationMixer 上的复刻：照 AC_<资产>.controller 的拓扑跑——
 * 参数（float / int / bool / trigger）、多层（覆盖 / 叠加，层权重）、状态（单片段或一维混合树，速度 × 速度参数）、
 * 任意状态转换、退出时刻转换、固定 / 归一化过渡时长、目标起始偏移、触发器在转换发生时消耗；
 * 玩法直接 CrossFadeInFixedTime / Play；动画事件逐帧派发（片段时间跨过事件时刻就发，循环片段跨圈也算）。
 *
 * 时间由这里管：每个播放实例自己记归一化时刻，每帧把动作的 time / weight 写好后 mixer.update(0) 求值。
 * 混合树按 Unity 的同步规则：子片段共用归一化时刻，长度 = Σ 权重 × 子片段长度。
 * 过渡：目标实例权重线性升到 1，其余实例按各自起始权重同比降到 0（被新转换打断时也一样，近似 Unity 打断时冻结混合姿势）。
 * 事件：Unity 在过渡中源、目标两个状态的片段都会发事件，这里同样对权重 > 0 的实例都派发；混合树只发权重最大的子片段的事件。
 */

export interface AnimatorEvent {
  name: string;
  /** 叠加表的 float 参数 */
  float: number;
  layer: number;
  state: string;
  clip: string;
  /** 事件在片段里的时刻（秒） */
  time: number;
}

interface ClipSlot {
  key: string;
  clip: THREE.AnimationClip | null;
  meta: ClipMeta | null;
  threshold: number;
  timeScale: number;
}

interface RuntimeState {
  def: StateDef;
  layer: number;
  slots: ClipSlot[];
  blendParam: string | null;
  loops: boolean;
}

interface Playback {
  state: RuntimeState;
  /** 归一化时刻（非循环片段可以超过 1，停在最后一帧） */
  norm: number;
  prev: number;
  /** 刚进入：本帧派发 [norm, norm] 的事件（含起点） */
  fresh: boolean;
  weight: number;
  startWeight: number;
  /** 本实例每个子片段占用的动作 */
  actions: (THREE.AnimationAction | null)[];
  blend: number[];
}

interface ActiveTransition {
  target: Playback;
  /** 固定秒数，或 null = 按源状态长度的比例（durationNorm） */
  seconds: number;
  elapsed: number;
}

interface RuntimeLayer {
  def: LayerDef;
  index: number;
  weight: number;
  states: Map<string, RuntimeState>;
  playbacks: Playback[];
  current: Playback | null;
  transition: ActiveTransition | null;
}

export interface AnimatorOptions {
  /** 找不到片段的状态（只有 Blender 手 K 来源、还没导出）：按 1 秒空状态处理 */
  missingClipLength?: number;
}

const EPS = 1e-6;

export class AnimatorStateMachine {
  readonly mixer: THREE.AnimationMixer;
  readonly controller: ControllerDef;
  readonly layers: RuntimeLayer[] = [];
  /** 动画事件（Unity CreatureRig.OnAnimEvent → AnimEvent） */
  onEvent: ((e: AnimatorEvent) => void) | null = null;

  private readonly params = new Map<string, { def: ParameterDef; value: number | boolean }>();
  private readonly clips: Map<string, THREE.AnimationClip>;
  private readonly additive = new Map<string, THREE.AnimationClip>();
  private readonly pool = new Map<THREE.AnimationClip, THREE.AnimationAction[]>();
  private readonly missingLength: number;
  private readonly root: THREE.Object3D;

  constructor(root: THREE.Object3D, controller: ControllerDef, clips: Map<string, THREE.AnimationClip>, opts: AnimatorOptions = {}) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.controller = controller;
    this.clips = clips;
    this.missingLength = opts.missingClipLength ?? 1;
    for (const p of controller.parameters) this.params.set(p.name, { def: p, value: p.type === 'trigger' ? false : p.default });
    controller.layers.forEach((def, index) => {
      const states = new Map<string, RuntimeState>();
      for (const s of def.states) states.set(s.name, this.buildState(s, def, index));
      const layer: RuntimeLayer = { def, index, weight: def.weight, states, playbacks: [], current: null, transition: null };
      this.layers.push(layer);
      const first = def.defaultState ?? def.states[0]?.name;
      if (first) this.enter(layer, first, 0, 1);
    });
  }

  // ───────────── 参数 ─────────────
  setFloat(name: string, v: number) { this.setParam(name, v); }
  setInteger(name: string, v: number) { this.setParam(name, Math.trunc(v)); }
  setBool(name: string, v: boolean) { this.setParam(name, v); }
  setTrigger(name: string) { this.setParam(name, true); }
  resetTrigger(name: string) { this.setParam(name, false); }
  getFloat(name: string): number { return Number(this.params.get(name)?.value ?? 0); }
  getBool(name: string): boolean { return !!this.params.get(name)?.value; }
  hasParameter(name: string): boolean { return this.params.has(name); }

  private setParam(name: string, v: number | boolean) {
    const p = this.params.get(name);
    if (p) p.value = v; // 控制器里没有的参数：Unity 只打警告，这里静默
  }

  // ───────────── 查询 ─────────────
  hasState(state: string, layer = 0): boolean { return !!this.layers[layer]?.states.has(state); }

  /** 状态里片段的时长（秒；混合树取第一个子片段）；找不到为 0（同 EnemyAI.ClipLength） */
  clipLength(state: string, layer = 0): number {
    const s = this.layers[layer]?.states.get(state);
    return s?.slots[0]?.clip?.duration ?? 0;
  }

  /** 当前（过渡中为目标）状态 */
  currentState(layer = 0): { name: string; normalizedTime: number; length: number; inTransition: boolean } | null {
    const l = this.layers[layer];
    const pb = l?.current;
    if (!pb) return null;
    return { name: pb.state.def.name, normalizedTime: pb.norm, length: this.stateLength(pb), inTransition: !!l.transition };
  }

  /** 每个实例的权重（调试 / 检视页） */
  layerWeights(layer = 0): { state: string; weight: number; normalizedTime: number }[] {
    return (this.layers[layer]?.playbacks ?? []).map((p) => ({ state: p.state.def.name, weight: p.weight, normalizedTime: p.norm }));
  }

  /** 每个片段当前的有效权重（层权重 × 实例权重 × 混合树权重，按片段名合计；调试 / 检视页 / 测试） */
  clipWeights(layer = 0): Record<string, number> {
    const out: Record<string, number> = {};
    const l = this.layers[layer];
    if (!l) return out;
    for (const pb of l.playbacks) {
      this.blendWeights(pb.state, pb.blend);
      pb.state.slots.forEach((s, i) => { if (s.key) out[s.key] = (out[s.key] ?? 0) + l.weight * pb.weight * pb.blend[i]; });
    }
    return out;
  }

  // ───────────── 玩法直接切状态 ─────────────
  /** Animator.CrossFadeInFixedTime：duration 秒过渡到 state，目标从 fixedTimeOffset 秒开始 */
  crossFadeInFixedTime(state: string, duration: number, layer = 0, fixedTimeOffset = 0) {
    const l = this.layers[layer];
    const s = l?.states.get(state);
    if (!l || !s) return;
    const len = this.lengthOf(s, null);
    this.startTransition(l, s, fixedTimeOffset / len, duration);
  }

  /** Animator.CrossFade：duration 与 offset 都按目标状态长度归一化 */
  crossFade(state: string, normalizedDuration: number, layer = 0, normalizedOffset = 0) {
    const l = this.layers[layer];
    const s = l?.states.get(state);
    if (!l || !s) return;
    this.startTransition(l, s, normalizedOffset, normalizedDuration * this.lengthOf(s, null));
  }

  /** Animator.Play：立刻切过去，不过渡 */
  play(state: string, layer = 0, normalizedTime = 0) {
    const l = this.layers[layer];
    if (!l?.states.has(state)) return;
    for (const pb of l.playbacks) this.release(pb);
    l.playbacks = [];
    l.transition = null;
    this.enter(l, state, normalizedTime, 1);
  }

  // ───────────── 每帧 ─────────────
  update(dt: number) {
    for (const l of this.layers) {
      // 1) 推进：所有实例按各自状态的速度走
      for (const pb of l.playbacks) {
        pb.prev = pb.norm;
        if (!pb.fresh) pb.norm += (dt * this.stateSpeed(pb.state)) / this.stateLength(pb);
      }
      // 2) 过渡进度
      if (l.transition) {
        const tr = l.transition;
        tr.elapsed += dt;
        const p = tr.seconds <= EPS ? 1 : Math.min(1, tr.elapsed / tr.seconds);
        for (const pb of l.playbacks) pb.weight = pb === tr.target ? pb.startWeight + (1 - pb.startWeight) * p : pb.startWeight * (1 - p);
        if (p >= 1) this.finishTransition(l);
      }
      // 3) 转换：任意状态先查；目标状态自己的转换在过渡结束后才查（Unity 不打断的默认设置）
      this.evaluate(l);
    }
    // 4) 姿势
    this.apply();
    // 5) 事件
    for (const l of this.layers) for (const pb of l.playbacks) {
      // 过渡目标刚进来时权重还是 0，起点（t = 0）的事件照样要发
      if (pb.weight > 0 || pb === l.current) this.dispatch(l, pb);
      pb.fresh = false;
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }

  // ───────────── 内部 ─────────────
  private buildState(def: StateDef, layer: LayerDef, index: number): RuntimeState {
    const additive = layer.blending === 'additive';
    const slots: ClipSlot[] = [];
    let blendParam: string | null = null;
    const add = (key: string | null | undefined, threshold: number, timeScale: number) => {
      const clip = key ? this.resolveClip(key, additive) : null;
      slots.push({ key: key ?? '', clip, meta: clip ? clipMeta(clip) : null, threshold, timeScale: timeScale || 1 });
    };
    if (def.motion?.blend) {
      blendParam = def.motion.blend.param;
      for (const c of [...def.motion.blend.children].sort((a, b) => a.threshold - b.threshold)) add(c.clip, c.threshold, c.timeScale);
    } else if (def.motion) add(def.motion.clip, 0, 1);
    const loops = slots.some((s) => s.meta?.loop);
    return { def, layer: index, slots, blendParam, loops };
  }

  private resolveClip(key: string, additive: boolean): THREE.AnimationClip | null {
    const clip = this.clips.get(key) ?? null;
    if (!clip || !additive) return clip;
    let a = this.additive.get(key);
    if (!a) {
      a = makeAdditiveClip(clip, 0);
      this.additive.set(key, a);
    }
    return a;
  }

  private stateSpeed(s: RuntimeState): number {
    const k = s.def.speedParam ? this.getFloat(s.def.speedParam) : 1;
    return s.def.speed * k;
  }

  /** 一维混合树权重（Unity Simple1D：相邻阈值间线性，两端钳住） */
  private blendWeights(s: RuntimeState, out: number[]): number[] {
    const n = s.slots.length;
    out.length = n;
    out.fill(0);
    if (n === 0) return out;
    if (!s.blendParam || n === 1) { out[0] = 1; return out; }
    const v = this.getFloat(s.blendParam);
    if (v <= s.slots[0].threshold) { out[0] = 1; return out; }
    if (v >= s.slots[n - 1].threshold) { out[n - 1] = 1; return out; }
    for (let i = 0; i < n - 1; i++) {
      const a = s.slots[i].threshold, b = s.slots[i + 1].threshold;
      if (v >= a && v <= b) {
        const t = b - a > EPS ? (v - a) / (b - a) : 0;
        out[i] = 1 - t;
        out[i + 1] = t;
        break;
      }
    }
    return out;
  }

  private lengthOf(s: RuntimeState, weights: number[] | null): number {
    if (s.slots.length === 0) return this.missingLength;
    const w = weights ?? this.blendWeights(s, []);
    let len = 0;
    s.slots.forEach((slot, i) => { len += w[i] * (slot.clip ? slot.clip.duration / slot.timeScale : this.missingLength); });
    return len > EPS ? len : this.missingLength;
  }

  private stateLength(pb: Playback): number {
    this.blendWeights(pb.state, pb.blend);
    return this.lengthOf(pb.state, pb.blend);
  }

  private enter(l: RuntimeLayer, state: string, norm: number, weight: number): Playback {
    const s = l.states.get(state)!;
    const pb: Playback = { state: s, norm, prev: norm, fresh: true, weight, startWeight: weight, actions: s.slots.map((slot) => (slot.clip ? this.acquire(slot.clip, l) : null)), blend: [] };
    l.playbacks.push(pb);
    l.current = pb;
    return pb;
  }

  private acquire(clip: THREE.AnimationClip, l: RuntimeLayer): THREE.AnimationAction {
    let free = this.pool.get(clip);
    if (!free) this.pool.set(clip, (free = []));
    const blendMode = l.def.blending === 'additive' ? THREE.AdditiveAnimationBlendMode : THREE.NormalAnimationBlendMode;
    // 第一个动作用混合器缓存的那个；同一片段同时有两个实例（自我过渡、连打 Flinch）时再建一个，属性绑定共用
    const a = free.pop()
      ?? (this.mixer.existingAction(clip, this.root) ? new THREE.AnimationAction(this.mixer, clip, this.root, blendMode) : this.mixer.clipAction(clip, this.root, blendMode));
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = false;
    a.timeScale = 0;
    a.weight = 0;
    a.enabled = true;
    a.play();
    return a;
  }

  private release(pb: Playback) {
    pb.actions.forEach((a, i) => {
      if (!a) return;
      a.stop();
      const clip = pb.state.slots[i].clip!;
      this.pool.get(clip)!.push(a);
    });
    pb.actions = [];
  }

  private startTransition(l: RuntimeLayer, s: RuntimeState, offset: number, seconds: number) {
    if (seconds <= EPS) {
      for (const pb of l.playbacks) this.release(pb);
      l.playbacks = [];
      l.transition = null;
      this.enter(l, s.def.name, offset, 1);
      return;
    }
    for (const pb of l.playbacks) pb.startWeight = pb.weight;
    const target = this.enter(l, s.def.name, offset, 0);
    l.transition = { target, seconds, elapsed: 0 };
  }

  private finishTransition(l: RuntimeLayer) {
    const target = l.transition!.target;
    for (const pb of l.playbacks) if (pb !== target) this.release(pb);
    l.playbacks = [target];
    target.weight = target.startWeight = 1;
    l.transition = null;
  }

  private conditionsMet(t: TransitionDef): boolean {
    for (const c of t.conditions) {
      const p = this.params.get(c.param);
      if (!p) return false;
      const v = p.value;
      switch (c.mode) {
        case 'if': if (!v) return false; break;
        case 'ifNot': if (v) return false; break;
        case 'greater': if (!(Number(v) > c.threshold)) return false; break;
        case 'less': if (!(Number(v) < c.threshold)) return false; break;
        case 'equals': if (Number(v) !== c.threshold) return false; break;
        case 'notEqual': if (Number(v) === c.threshold) return false; break;
      }
    }
    return true;
  }

  private consumeTriggers(t: TransitionDef) {
    for (const c of t.conditions) {
      const p = this.params.get(c.param);
      if (p?.def.type === 'trigger') p.value = false;
    }
  }

  /** 退出时刻：非循环状态到点就成立；循环状态 exitTime < 1 时每圈跨过一次成立 */
  private exitReached(pb: Playback, exitTime: number): boolean {
    if (!pb.state.loops || exitTime >= 1) return pb.norm >= exitTime;
    return Math.floor(pb.norm - exitTime) > Math.floor(pb.prev - exitTime);
  }

  private evaluate(l: RuntimeLayer) {
    const cur = l.current;
    if (!cur) return;
    const fire = (t: TransitionDef, durationSource: Playback) => {
      if (!t.to) return false;
      const dst = l.states.get(t.to);
      if (!dst) return false;
      this.consumeTriggers(t);
      const seconds = t.fixedDuration ? t.duration : t.duration * this.stateLength(durationSource);
      this.startTransition(l, dst, t.offset, seconds);
      return true;
    };
    for (const t of l.def.anyState) {
      if (t.to === cur.state.def.name && !t.canTransitionToSelf) continue;
      if (!t.hasExitTime && t.conditions.length === 0) continue;
      if (t.hasExitTime && !this.exitReached(cur, t.exitTime)) continue;
      if (!this.conditionsMet(t)) continue;
      if (fire(t, cur)) return;
    }
    if (l.transition) return;
    for (const t of cur.state.def.transitions) {
      if (t.hasExitTime && !this.exitReached(cur, t.exitTime)) continue;
      if (!t.hasExitTime && t.conditions.length === 0) continue; // Unity 不允许：没有条件也没有退出时刻的转换永不成立
      if (!this.conditionsMet(t)) continue;
      if (fire(t, cur)) return;
    }
  }

  /** 片段内时刻：循环取小数部分，非循环停在末帧 */
  private clipTime(slot: ClipSlot, norm: number): number {
    const d = slot.clip?.duration ?? 0;
    if (d <= 0) return 0;
    if (slot.meta?.loop) return (norm - Math.floor(norm)) * d;
    return Math.min(1, Math.max(0, norm)) * d;
  }

  private apply() {
    for (const l of this.layers) {
      for (const pb of l.playbacks) {
        this.blendWeights(pb.state, pb.blend);
        pb.actions.forEach((a, i) => {
          if (!a) return;
          a.time = this.clipTime(pb.state.slots[i], pb.norm);
          a.weight = l.weight * pb.weight * pb.blend[i];
        });
      }
    }
    this.mixer.update(0);
  }

  private dispatch(l: RuntimeLayer, pb: Playback) {
    if (!this.onEvent || pb.state.slots.length === 0) return;
    // 混合树：只发权重最大的子片段
    let best = 0;
    for (let i = 1; i < pb.blend.length; i++) if (pb.blend[i] > pb.blend[best]) best = i;
    const slot = pb.state.slots[best];
    const events = slot?.meta?.events;
    if (!slot?.clip || !events?.length) return;
    const d = slot.clip.duration;
    if (d <= 0) {
      if (pb.fresh) for (const e of events) this.emit(l, pb, slot, e.name, e.float, e.time);
      return;
    }
    const lo = pb.prev, hi = pb.norm;
    if (hi < lo || (!pb.fresh && hi === lo)) return;
    if (slot.meta!.loop) {
      for (let cycle = Math.floor(lo); cycle <= Math.floor(hi); cycle++) {
        for (const e of events) {
          const at = cycle + e.time / d;
          if ((pb.fresh ? at >= lo : at > lo) && at <= hi) this.emit(l, pb, slot, e.name, e.float, e.time);
        }
      }
    } else {
      const a = lo, b = Math.min(hi, 1);
      if (!pb.fresh && a >= 1) return;
      for (const e of events) {
        const at = e.time / d;
        if ((pb.fresh ? at >= a : at > a) && at <= b) this.emit(l, pb, slot, e.name, e.float, e.time);
      }
    }
  }

  private emit(l: RuntimeLayer, pb: Playback, slot: ClipSlot, name: string, float: number, time: number) {
    this.onEvent?.({ name, float, layer: l.index, state: pb.state.def.name, clip: slot.key, time });
  }
}
