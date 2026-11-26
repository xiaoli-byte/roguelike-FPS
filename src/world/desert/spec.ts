import type * as THREE from 'three';
import type { GameContext } from '../../core/types';
import type { AtmosphereProfile } from '../Atmosphere';
import type { CloudSkyProfile } from '../CloudSky';
import type { MistStream } from '../MistStreams';
import type { BirdFlock, MoteBox } from '../AirLife';
import type { UnitySceneDocument } from '../UnityLevelLibrary';
import type { SceneMechanisms } from '../mechanisms/MechanismData';
import type { VolumeOverrides } from '../../render/UrpVolume';

/**
 * 第一章（赤沙古道）美术重建层的每图规格。按 docs/art/level-art.md 的顺序：路线遭遇 → 白盒 → 构成 → 光影雾 → 特效 → 细节，
 * 每张图一份 `DesertMapArt`（src/world/desert/maps/<图>.ts），叠在 Unity 导出的场景文档之上：
 *   - patchDocument：搭场景之前改文档（光照 / 雾 / 天空、地形外圈的高度场、挪 / 删 / 加场景件、修据点锚点）；
 *   - patchMechanisms：改机关数据（天气的基础雾色 / 风向要和新光照、新风向一致）；
 *   - atmosphere / clouds / shafts / layout / grade：空气透视、云天、光柱、雾带摆位、调色；
 *   - build：场景搭好后加的网页件（远景剪影、沙丘脊、环境特效、补光、新模型……）。
 * 网址带 `desert=0` 整层关掉，看 Unity 原样。
 */

export type Rgb = [number, number, number];
export type Vec3 = [number, number, number];

/** 一张图的光：主光、三色环境光、雾、天空。颜色都是 sRGB 0..1（和 Unity 导出的一样） */
export interface DesertLight {
  /**
   * 太阳在哪：azimuth = 网页 XZ 平面里「朝太阳」的方位角（度，0 = +Z，90 = +X），elevation = 仰角（度）。
   * 平行光沿相反方向照下来。
   */
  sun: { azimuth: number; elevation: number; color: Rgb; intensity: number; shadowStrength?: number };
  /** 风格化材质读的三色环境光（改半球光没用，材质只认这三色） */
  ambient: { sky: Rgb; equator: Rgb; ground: Rgb; intensity?: number };
  /** 线性雾（接上空气透视后起点会被推到 ≥ 120 m，终点照用） */
  fog: { color: Rgb; start: number; end: number };
  /** 渐变天球（换掉 Unity 的天空盒）：顶 / 地平线 / 地下 / 日盘颜色 */
  sky: { top: Rgb; horizon: Rgb; bottom: Rgb; sun: Rgb; sharpness?: number; horizonGlow?: number; sunSize?: number; sunHalo?: number; exposure?: number };
}

/** unityAtmosphereLayout 的按图微调（同 unityAtmosphereLayout.ts 的 TUNING 条目） */
export interface DesertLayoutTuning {
  /** 各圈雾带的不透明度倍率（崖脚 / 内圈 / 外圈 / 最远一圈）；0 = 不要这一圈 */
  rings?: number[];
  /** 谷底雾的不透明度倍率 */
  interior?: number;
  /** 水面雾的不透明度倍率 */
  water?: number;
  /** false = 不放鸟 */
  birds?: boolean;
  /** 手摆的雾带 / 尘 / 鸟 */
  mist?: MistStream[];
  motes?: MoteBox[];
  flocks?: BirdFlock[];
}

/** build 产出的一件东西：每帧可选 update，卸载时 dispose */
export interface DesertPart {
  update?(dt: number, t: number): void;
  dispose(): void;
}

/** build 拿到的上下文 */
export interface DesertBuild {
  ctx: GameContext;
  /** 已经过 patchDocument 的文档 */
  document: UnitySceneDocument;
  /** 挂这一层所有网格的组（在 UnitySceneView.group 下） */
  group: THREE.Group;
  /** 这张图的规格 */
  art: DesertMapArt;
  /** 地形高度（高度场，已含 patchDocument 的修改）；不在任何高度场上返回 -Infinity */
  terrainHeight(x: number, z: number): number;
  /** 地形 + 碰撞体的地面高度（从 top 往下打，没有就退回地形） */
  groundHeight(x: number, z: number, top?: number): number;
  /** 场景文档里某个渲染件（按 name 或 scenePath 前缀找第一个）的网格地址，复用 Unity 套件件用 */
  rendererUrl(match: string | RegExp): string | null;
  /** 低画质 */
  low: boolean;
}

export interface DesertMapArt {
  id: string;
  /** 一句话氛围目标（时间、天气、情绪）：光、雾、天空、特效都为它服务 */
  mood: string;
  /** 一个风：网页 XZ 里风吹向的方向（单位向量）。云影、雾带、植被、天气粒子、吹沙都读它 */
  wind: [number, number];
  /** 基础风力（天气 baseWind，0..1） */
  windStrength?: number;
  light?: DesertLight;
  /** 空气透视（在章节默认值上覆写） */
  atmosphere?: Partial<AtmosphereProfile>;
  /** 云天（在章节默认值上覆写） */
  clouds?: Partial<CloudSkyProfile>;
  /** 逆光光柱；false = 不要 */
  shafts?: { strength?: number; threshold?: number } | false;
  /** 雾带摆位微调；给了就替换 unityAtmosphereLayout 里这张图的 TUNING */
  layout?: DesertLayoutTuning;
  /** 逆光轮廓光加强（风格化材质的全局 uSflRimBack，0 = Unity 原样；低太阳逆光的图给 1–1.5） */
  rimBack?: number;
  /** 运行时调色层（叠在 volumes.json 这张图的 Volume 之上，优先级 20） */
  grade?: VolumeOverrides;
  /** 搭场景之前改文档（拿到的是可以随便改的副本：environment / renderers / colliders / encounters / entries / heightfields 都已复制） */
  patchDocument?(doc: UnitySceneDocument): void;
  /** 改机关数据（副本） */
  patchMechanisms?(data: SceneMechanisms): void;
  /** 场景搭好后加的网页件 */
  build?(b: DesertBuild): Promise<DesertPart[]> | DesertPart[];
}
