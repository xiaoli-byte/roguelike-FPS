/**
 * URP Volume 的网页版（纯数据 + 混合，不依赖 three，node --test 直接测）。
 *
 * 数据：scripts/web/export-volume-profiles.mjs 把 Unity 的 Volume Profile（*.asset）和每个场景里的 Volume 物体导成
 * public/assets/unity-levels/volumes.json。组件名、参数名、数值单位全部照 Unity（Inspector 里看到的数），不换算。
 *
 * 混合照 core/Runtime/Volume/VolumeManager.cs：
 *   1. 栈先回到默认值（URP 各组件的构造默认值；工程的 DefaultVolumeProfile 全是默认值）；
 *   2. 按优先级从低到高逐个 Volume（同级按登记顺序）：只有勾了 override 的参数参与，
 *      stateParam.Interp(stateParam, toParam, t)——浮点 / 颜色 / 向量线性插值，整数截断，布尔 / 枚举 t > 0 就取新值；
 *   3. 全局 Volume：t = clamp01(weight)；局部 Volume：相机到碰撞盒最近点的距离平方 d²，
 *      d² > blend² 不起作用，否则 t = (1 − d² / blend²) × clamp01(weight)（blend = 0 时 t = weight）。
 * 组件的 active = false 时整个组件跳过。
 */

export type ParamKind = 'float' | 'int' | 'bool' | 'enum' | 'color' | 'vector';

/** 网页用到的组件和参数（其余组件 / 参数导出器会报出来） */
export const VOLUME_SCHEMA = {
  Bloom: {
    threshold: 'float', intensity: 'float', scatter: 'float', clamp: 'float', tint: 'color',
    highQualityFiltering: 'bool', filter: 'enum', downscale: 'enum', maxIterations: 'int', dirtIntensity: 'float',
  },
  Tonemapping: { mode: 'enum' },
  ColorAdjustments: { postExposure: 'float', contrast: 'float', colorFilter: 'color', hueShift: 'float', saturation: 'float' },
  WhiteBalance: { temperature: 'float', tint: 'float' },
  LiftGammaGain: { lift: 'vector', gamma: 'vector', gain: 'vector' },
  ShadowsMidtonesHighlights: {
    shadows: 'vector', midtones: 'vector', highlights: 'vector',
    shadowsStart: 'float', shadowsEnd: 'float', highlightsStart: 'float', highlightsEnd: 'float',
  },
  Vignette: { color: 'color', center: 'vector', intensity: 'float', smoothness: 'float', rounded: 'bool' },
  ChromaticAberration: { intensity: 'float' },
  FirstPersonExposure: { multiplier: 'float', gamma: 'float', effects: 'float', effectsSaturation: 'float', flash: 'float' },
} as const satisfies Record<string, Record<string, ParamKind>>;

export type VolumeComponentName = keyof typeof VOLUME_SCHEMA;

type ValueOf<K> = K extends 'color' | 'vector' ? number[] : K extends 'bool' ? boolean : number;
export type ComponentParams<C extends VolumeComponentName> = { -readonly [P in keyof (typeof VOLUME_SCHEMA)[C]]: ValueOf<(typeof VOLUME_SCHEMA)[C][P]> };

/** 混合完的整个栈（每个参数都有值） */
export type VolumeParams = { [C in VolumeComponentName]: ComponentParams<C> };

/** 一个 Profile 里的组件：只有勾了 override 的参数；active = false 时整个组件不起作用 */
export type VolumeOverrides = { [C in VolumeComponentName]?: Partial<ComponentParams<C>> & { active?: boolean } };

/** TonemappingMode */
export const TONEMAP_NONE = 0, TONEMAP_NEUTRAL = 1, TONEMAP_ACES = 2;

/** URP 17 各组件的默认值（Runtime/Overrides/*.cs 的构造参数）+ 本工程的 FirstPersonExposure（全 1 = 不补偿） */
export function defaultVolumeParams(): VolumeParams {
  return {
    Bloom: {
      threshold: 0.9, intensity: 0, scatter: 0.7, clamp: 65472, tint: [1, 1, 1, 1],
      highQualityFiltering: false, filter: 0, downscale: 0, maxIterations: 6, dirtIntensity: 0,
    },
    Tonemapping: { mode: TONEMAP_NONE },
    ColorAdjustments: { postExposure: 0, contrast: 0, colorFilter: [1, 1, 1, 1], hueShift: 0, saturation: 0 },
    WhiteBalance: { temperature: 0, tint: 0 },
    LiftGammaGain: { lift: [1, 1, 1, 0], gamma: [1, 1, 1, 0], gain: [1, 1, 1, 0] },
    ShadowsMidtonesHighlights: {
      shadows: [1, 1, 1, 0], midtones: [1, 1, 1, 0], highlights: [1, 1, 1, 0],
      shadowsStart: 0, shadowsEnd: 0.3, highlightsStart: 0.55, highlightsEnd: 1,
    },
    Vignette: { color: [0, 0, 0, 1], center: [0.5, 0.5], intensity: 0, smoothness: 0.2, rounded: false },
    ChromaticAberration: { intensity: 0 },
    FirstPersonExposure: { multiplier: 1, gamma: 1, effects: 1, effectsSaturation: 1, flash: 1 },
  };
}

/** 把一个 Volume 的覆盖值按 t 混进栈（VolumeComponent.Override + 各参数的 Interp） */
export function blendVolume(state: VolumeParams, overrides: VolumeOverrides, t: number): void {
  if (!(t > 0)) return;
  for (const name of Object.keys(overrides) as VolumeComponentName[]) {
    const from = overrides[name];
    const schema = VOLUME_SCHEMA[name] as Record<string, ParamKind> | undefined;
    if (!from || !schema || from.active === false) continue;
    const to = state[name] as Record<string, unknown>;
    for (const [param, value] of Object.entries(from)) {
      const kind = schema[param];
      if (!kind || value === undefined) continue;
      const current = to[param];
      switch (kind) {
        case 'float':
          to[param] = (current as number) + ((value as number) - (current as number)) * t;
          break;
        case 'int':
          to[param] = Math.trunc((current as number) + ((value as number) - (current as number)) * t);
          break;
        case 'color':
        case 'vector': {
          const a = current as number[], b = value as number[];
          to[param] = a.map((x, i) => x + ((b[i] ?? x) - x) * t);
          break;
        }
        default:
          if (t > 0) to[param] = value;
      }
    }
  }
}

// ───────────── 场景数据（volumes.json） ─────────────

/** 局部 Volume 的盒形碰撞体（网页坐标：x 已取反；rotation 是网页四元数 xyzw） */
export interface VolumeBox {
  center: [number, number, number];
  halfSize: [number, number, number];
  rotation: [number, number, number, number];
}

export interface SceneVolume {
  name: string;
  /** Profile 的资产路径（volumes.json 的 profiles 键） */
  profile: string;
  global: boolean;
  priority: number;
  weight: number;
  blendDistance: number;
  boxes?: VolumeBox[];
}

export interface VolumeProfileData {
  guid: string;
  components: VolumeOverrides;
}

export interface SceneVolumeData {
  scene: string;
  volumes: SceneVolume[];
  /** 只有全局 Volume 时的栈（导出时混好的；局部 Volume、玩法 Volume 运行时再叠） */
  resolved: VolumeParams;
}

export interface VolumesDocument {
  schema: number;
  pipeline: { colorGradingMode: 'LowDynamicRange' | 'HighDynamicRange'; lutSize: number; hdr: boolean; msaa: number };
  profiles: Record<string, VolumeProfileData>;
  scenes: Record<string, SceneVolumeData>;
}

/** 运行时的一层（玩法屏效、天气、首领……）：和场景 Volume 一起按优先级混 */
export interface VolumeLayer {
  priority: number;
  /** 0..1；≤ 0 跳过 */
  weight: number;
  overrides: VolumeOverrides;
}

/** 点到盒的最近距离平方（BoxCollider.ClosestPoint；盒内为 0） */
export function boxDistanceSq(box: VolumeBox, x: number, y: number, z: number): number {
  // 换到盒的局部坐标：p' = q⁻¹ (p − c)。共轭四元数 u = −q.xyz：t = 2 u × v，v' = v + w t + u × t
  const ux = -box.rotation[0], uy = -box.rotation[1], uz = -box.rotation[2], qw = box.rotation[3];
  let px = x - box.center[0], py = y - box.center[1], pz = z - box.center[2];
  const tx = 2 * (uy * pz - uz * py), ty = 2 * (uz * px - ux * pz), tz = 2 * (ux * py - uy * px);
  const lx = px + qw * tx + uy * tz - uz * ty, ly = py + qw * ty + uz * tx - ux * tz, lz = pz + qw * tz + ux * ty - uy * tx;
  px = Math.max(0, Math.abs(lx) - box.halfSize[0]);
  py = Math.max(0, Math.abs(ly) - box.halfSize[1]);
  pz = Math.max(0, Math.abs(lz) - box.halfSize[2]);
  return px * px + py * py + pz * pz;
}

/** 局部 Volume 对某点的混合系数（VolumeManager.UpdateVolumes 的局部分支）；不起作用 = 0 */
export function localVolumeFactor(volume: Pick<SceneVolume, 'boxes' | 'blendDistance' | 'weight'>, x: number, y: number, z: number): number {
  if (!volume.boxes?.length) return 0;
  let d2 = Infinity;
  for (const box of volume.boxes) d2 = Math.min(d2, boxDistanceSq(box, x, y, z));
  const b2 = volume.blendDistance * volume.blendDistance;
  if (d2 > b2) return 0;
  const f = b2 > 0 ? 1 - d2 / b2 : 1;
  return f * Math.min(1, Math.max(0, volume.weight));
}

/**
 * 整个栈：默认值 → 场景的 Volume（全局 / 局部）+ 运行时层，按优先级从低到高（同级：场景的在前、运行时按登记顺序）。
 * camera = null 时只算全局（同 Unity trigger 为空）。
 */
export function evaluateVolumes(
  doc: Pick<VolumesDocument, 'profiles'> | null, scene: Pick<SceneVolumeData, 'volumes'> | null,
  layers: Iterable<VolumeLayer>, camera: readonly [number, number, number] | null,
): VolumeParams {
  const state = defaultVolumeParams();
  const entries: { priority: number; order: number; apply: () => void }[] = [];
  let order = 0;
  for (const v of scene?.volumes ?? []) {
    const profile = doc?.profiles[v.profile];
    if (!profile || !(v.weight > 0)) continue;
    entries.push({
      priority: v.priority, order: order++,
      apply: () => {
        if (v.global) blendVolume(state, profile.components, Math.min(1, Math.max(0, v.weight)));
        else if (camera) blendVolume(state, profile.components, localVolumeFactor(v, camera[0], camera[1], camera[2]));
      },
    });
  }
  for (const layer of layers) {
    if (!(layer.weight > 0)) continue;
    entries.push({ priority: layer.priority, order: order++, apply: () => blendVolume(state, layer.overrides, Math.min(1, layer.weight)) });
  }
  entries.sort((a, b) => a.priority - b.priority || a.order - b.order);
  for (const e of entries) e.apply();
  return state;
}
