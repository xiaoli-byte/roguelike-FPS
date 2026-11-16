import * as THREE from 'three';

/**
 * 网页动画数据（scripts/web/export-native-anims.mjs 生成的 public/assets/anim/<资产>.json）→ THREE.AnimationClip。
 * 片段按 GLB 节点名绑定（与 GLTFLoader 一样经 PropertyBinding.sanitizeNodeName），挂点 socket_<名> 由 ensureSockets 建在模型根下。
 * Unity 对照：NativeClipBuilder（片段换算、事件、Flinch 叠加片段）与它生成的 AC_<资产>.controller（状态机定义原样带过来）。
 */

export interface AnimEventDef {
  /** 片段内时刻（秒） */
  t: number;
  name: string;
  /** Unity AnimationEvent.floatParameter（叠加表的 float） */
  f?: number;
}

/** [节点序号, 'q' 朝向 | 'p' 位置, 帧序号（Uint16 base64；null = 每帧都有）, 数值（朝向 Int16×32767 / 位置 Float32，base64）] */
export type TrackDef = [number, 'q' | 'p', string | null, string];

export interface ClipDef {
  frames: number;
  duration: number;
  loop: boolean;
  /** 采样时紧跟的状态（连段）；控制器里已经是 exit-time 转换，这里留给玩法查 */
  next?: string;
  /** Walk / Move 录制时的移动速度（米 / 秒） */
  speed?: number;
  /** 派生片段（Flinch = Idle 第 0 帧 + Hit）：不算采样片段 */
  derived?: string;
  /** Unity 里这个状态换成了 Blender 手 K 片段（网页暂用采样片段） */
  unity?: string;
  events: AnimEventDef[];
  tracks: TrackDef[];
}

export interface SocketDef {
  name: string;
  /** 模型空间静止姿势 [qx, qy, qz, qw, px, py, pz] */
  rest: number[];
  /** 挂件缩放 */
  scale: number;
}

export type ConditionMode = 'if' | 'ifNot' | 'greater' | 'less' | 'equals' | 'notEqual';
export interface ConditionDef { mode: ConditionMode; param: string; threshold: number }
export interface TransitionDef {
  to: string | null;
  exit?: boolean;
  conditions: ConditionDef[];
  hasExitTime: boolean;
  exitTime: number;
  /** 秒（fixedDuration）或源状态长度的比例 */
  duration: number;
  fixedDuration: boolean;
  /** 目标状态的起始归一化时刻 */
  offset: number;
  canTransitionToSelf: boolean;
}
export interface BlendChildDef { clip: string | null; threshold: number; timeScale: number }
export interface MotionDef {
  clip?: string | null;
  blend?: { type: string; param: string; children: BlendChildDef[] };
}
export interface StateDef {
  name: string;
  motion: MotionDef | null;
  speed: number;
  speedParam: string | null;
  writeDefaults: boolean;
  transitions: TransitionDef[];
}
export interface LayerDef {
  name: string;
  blending: 'override' | 'additive';
  weight: number;
  defaultState: string | null;
  states: StateDef[];
  anyState: TransitionDef[];
}
export type ParameterType = 'float' | 'int' | 'bool' | 'trigger';
export interface ParameterDef { name: string; type: ParameterType; default: number | boolean }
export interface ControllerDef { name: string; parameters: ParameterDef[]; layers: LayerDef[] }

export interface CreatureAnimData {
  schema: number;
  asset: string;
  defId: string | null;
  fps: number;
  /** 绑定骨架的 GLB（相对 public/） */
  glb: string;
  source: { sha1: string; baked: string | null };
  /** 最快移动片段的录制速度（Unity ArtAssetInfo.moveSpeed） */
  moveSpeed: number;
  nodes: string[];
  sockets: SocketDef[];
  clips: Record<string, ClipDef>;
  controller: ControllerDef | null;
}

export interface ClipEvent { time: number; name: string; float: number }

/** 挂在 AnimationClip.userData 上的元数据 */
export interface ClipMeta {
  loop: boolean;
  next: string | null;
  speed: number | null;
  events: ClipEvent[];
  derived: string | null;
  unity: string | null;
  frames: number;
}

export const clipMeta = (clip: THREE.AnimationClip): ClipMeta => clip.userData as unknown as ClipMeta;

function decodeBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** base64 → 对齐的类型化数组（小端，与导出端一致） */
function typed<T extends Int16Array | Uint16Array | Float32Array>(s: string, Ctor: { new (b: ArrayBuffer): T }): T {
  const bytes = decodeBase64(s);
  return new Ctor(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

/** 曲线绑定名：与 GLTFLoader 给节点起名的规则一致 */
export const trackNodeName = (name: string) => THREE.PropertyBinding.sanitizeNodeName(name);

/** 一个片段 → THREE.AnimationClip（userData = ClipMeta）。 */
export function buildClip(data: CreatureAnimData, name: string): THREE.AnimationClip {
  const def = data.clips[name];
  if (!def) throw new Error(`${data.asset}: 没有片段 ${name}`);
  const dt = 1 / data.fps;
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [node, kind, timesB64, valuesB64] of def.tracks) {
    const frames = timesB64 ? typed(timesB64, Uint16Array) : null;
    const count = frames ? frames.length : def.frames;
    const times = new Float32Array(count);
    for (let i = 0; i < count; i++) times[i] = (frames ? frames[i] : i) * dt;
    const target = `${trackNodeName(data.nodes[node])}.${kind === 'q' ? 'quaternion' : 'position'}`;
    if (kind === 'q') {
      const raw = typed(valuesB64, Int16Array);
      const v = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i += 4) {
        const x = raw[i] / 32767, y = raw[i + 1] / 32767, z = raw[i + 2] / 32767, w = raw[i + 3] / 32767;
        const k = 1 / (Math.hypot(x, y, z, w) || 1);
        v[i] = x * k; v[i + 1] = y * k; v[i + 2] = z * k; v[i + 3] = w * k;
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(target, times, v));
    } else {
      tracks.push(new THREE.VectorKeyframeTrack(target, times, typed(valuesB64, Float32Array)));
    }
  }
  const clip = new THREE.AnimationClip(`${data.asset}_${name}`, def.duration, tracks);
  const meta: ClipMeta = {
    loop: def.loop,
    next: def.next ?? null,
    speed: def.speed ?? null,
    events: def.events.map((e) => ({ time: e.t, name: e.name, float: e.f ?? 0 })),
    derived: def.derived ?? null,
    unity: def.unity ?? null,
    frames: def.frames,
  };
  clip.userData = meta as unknown as Record<string, unknown>;
  return clip;
}

/** 全部片段（键 = 状态里引用的片段名：Idle / Move / charge / Flinch…） */
export function buildClips(data: CreatureAnimData): Map<string, THREE.AnimationClip> {
  const out = new Map<string, THREE.AnimationClip>();
  for (const name of Object.keys(data.clips)) out.set(name, buildClip(data, name));
  return out;
}

/**
 * 叠加片段：每帧相对参考帧（默认第 0 帧）的增量，朝向 Δ = ref⁻¹ · q（局部空间左乘），位置 Δ = p − ref。
 * 三的叠加混合是 base · Δ，于是 base 等于参考姿势时结果正好是片段本身（同 Unity 叠加层以片段第 0 帧为参考的语义）；
 * AnimationUtils.makeClipAdditive 存的是 q · ref⁻¹，base 不是单位时会被共轭一下，这里不用它。
 */
export function makeAdditiveClip(source: THREE.AnimationClip, referenceTime = 0): THREE.AnimationClip {
  const clip = source.clone();
  const ref = new THREE.Quaternion(), cur = new THREE.Quaternion();
  for (const track of clip.tracks) {
    const interp = track.InterpolantFactoryMethodLinear(); // 片段都是线性插值（四元数轨道给的是球面线性）
    const r = interp.evaluate(referenceTime).slice() as unknown as number[];
    const v = track.values;
    if (track instanceof THREE.QuaternionKeyframeTrack) {
      ref.fromArray(r).normalize().invert();
      for (let i = 0; i < v.length; i += 4) {
        cur.fromArray(v, i);
        cur.premultiply(ref).toArray(v, i);
      }
    } else {
      const n = track.getValueSize();
      for (let i = 0; i < v.length; i++) v[i] -= r[i % n];
    }
  }
  clip.blendMode = THREE.AdditiveAnimationBlendMode;
  clip.userData = { ...source.userData };
  return clip;
}

/** 挂点节点 socket_<名>：模型根下，按静止姿势放好（片段的挂点曲线写它；挂件挂在它下面，按 scale 缩放） */
export function ensureSockets(model: THREE.Object3D, data: CreatureAnimData): Map<string, THREE.Object3D> {
  const out = new Map<string, THREE.Object3D>();
  for (const s of data.sockets) {
    let node = model.getObjectByName(trackNodeName(s.name));
    if (!node) {
      node = new THREE.Object3D();
      node.name = trackNodeName(s.name);
      node.quaternion.fromArray(s.rest, 0);
      node.position.fromArray(s.rest, 4);
      node.userData.socketScale = s.scale;
      model.add(node);
    }
    out.set(s.name, node);
  }
  return out;
}

/** 读一个资产的动画（浏览器：fetch）。base 默认相对页面的 assets/anim/ */
export async function loadCreatureAnimData(asset: string, base = `${import.meta.env?.BASE_URL ?? '/'}assets/anim/`): Promise<CreatureAnimData> {
  const res = await fetch(`${base}${asset}.json`);
  if (!res.ok) throw new Error(`${asset}: 动画数据读不到（${res.status}）`);
  return (await res.json()) as CreatureAnimData;
}

export interface AnimManifest {
  schema: number;
  fps: number;
  assets: Record<string, { file: string; glb: string; defId: string | null; clips: number; nativeClips: number; eventClips: number; events: number;
    keyframed: string[]; pending: string[]; bytes: number }>;
  skipped: Record<string, string>;
  keyframedOnly: Record<string, string[]>;
}

export async function loadAnimManifest(base = `${import.meta.env?.BASE_URL ?? '/'}assets/anim/`): Promise<AnimManifest> {
  const res = await fetch(`${base}manifest.json`);
  if (!res.ok) throw new Error(`动画清单读不到（${res.status}）`);
  return (await res.json()) as AnimManifest;
}

/**
 * 资产没有 AC_ 控制器时按 NativeClipBuilder.BuildController 的规则现搭（与 Unity 生成的控制器逐项相同，测试里对照过）：
 * Locomotion 一维混合树（Idle 0 / Walk / Move 按录制速度）× MoveScale；Hit（exit 0.95，0.1 s 回 Locomotion）；
 * 招式：连段只有段首挂 act_<状态> 触发（任意状态，0.12 s），播完按 next（0.05 s）或回 Locomotion（0.2 s），持续型（loop）不自动退出；
 * 叠加层 Flinch：触发 Hit（0.03 s，可重入）→ Flinch → exit 0.9、0.1 s 回 FlinchNone。
 */
export function buildDefaultController(data: CreatureAnimData): ControllerDef {
  const clips = data.clips;
  const names = Object.keys(clips);
  const T = (to: string, o: Partial<TransitionDef>): TransitionDef => ({
    to, exit: false, conditions: [], hasExitTime: false, exitTime: 0.75, duration: 0.25, fixedDuration: true, offset: 0, canTransitionToSelf: true, ...o,
  });
  const params: ParameterDef[] = [
    { name: 'Speed', type: 'float', default: 0 },
    { name: 'Hit', type: 'trigger', default: false },
    { name: 'MoveScale', type: 'float', default: 1 },
  ];
  const children: BlendChildDef[] = [];
  if (clips.Idle) children.push({ clip: 'Idle', threshold: 0, timeScale: 1 });
  for (const n of ['Walk', 'Move']) if (clips[n]) children.push({ clip: n, threshold: clips[n].speed ?? (n === 'Walk' ? 1 : 2), timeScale: 1 });
  const states: StateDef[] = [{ name: 'Locomotion', motion: { blend: { type: '1d', param: 'Speed', children } }, speed: 1, speedParam: 'MoveScale', writeDefaults: true, transitions: [] }];
  if (clips.Hit) states.push({ name: 'Hit', motion: { clip: 'Hit' }, speed: 1, speedParam: null, writeDefaults: true, transitions: [T('Locomotion', { hasExitTime: true, exitTime: 0.95, duration: 0.1 })] });
  const layers: LayerDef[] = [{ name: 'Base Layer', blending: 'override', weight: 1, defaultState: 'Locomotion', states, anyState: [] }];
  if (clips.Flinch) {
    layers.push({
      name: 'Flinch', blending: 'additive', weight: 1, defaultState: 'FlinchNone',
      states: [
        { name: 'FlinchNone', motion: null, speed: 1, speedParam: null, writeDefaults: false, transitions: [] },
        { name: 'Flinch', motion: { clip: 'Flinch' }, speed: 1, speedParam: null, writeDefaults: false, transitions: [T('FlinchNone', { hasExitTime: true, exitTime: 0.9, duration: 0.1 })] },
      ],
      anyState: [T('Flinch', { conditions: [{ mode: 'if', param: 'Hit', threshold: 0 }], duration: 0.03 })],
    });
  }
  const actions = names.filter((n) => !['Idle', 'Walk', 'Move', 'Hit', 'Flinch'].includes(n));
  params.push({ name: 'ActScale', type: 'float', default: 1 });
  const next = (n: string) => clips[n]?.next ?? null;
  const held = (n: string) => clips[n]?.loop === true;
  const chained = new Set(actions.map(next).filter((n): n is string => !!n && actions.includes(n)));
  const base = layers[0];
  for (const name of actions) base.states.push({ name, motion: { clip: name }, speed: 1, speedParam: 'ActScale', writeDefaults: true, transitions: [] });
  for (const name of actions) {
    const st = base.states.find((s) => s.name === name)!;
    if (!chained.has(name) || held(name)) {
      params.push({ name: `act_${name}`, type: 'trigger', default: false });
      base.anyState.push(T(name, { conditions: [{ mode: 'if', param: `act_${name}`, threshold: 0 }], duration: 0.12 }));
    }
    if (held(name)) continue;
    const n = next(name);
    const inStates = !!n && actions.includes(n);
    st.transitions.push(T(inStates && n !== name ? n! : 'Locomotion', { hasExitTime: true, exitTime: 0.98, duration: inStates ? 0.05 : 0.2 }));
  }
  return { name: `AC_${data.asset}`, parameters: params, layers };
}
