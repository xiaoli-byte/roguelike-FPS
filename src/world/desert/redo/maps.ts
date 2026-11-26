import type { V2 } from '../whitebox/types';
import type { AtmosphereProfile } from '../../Atmosphere';
import type { CloudSkyProfile } from '../../CloudSky';
import type { VolumeOverrides } from '../../../render/UrpVolume';
import type { DesertLayoutTuning, DesertLight } from '../spec';
import type { FarLook, FarRowSpec, FarVeil } from '../farLayer';

/**
 * 第一章重做：每张图编进游戏时、白盒以外要补的东西（白盒只管可玩区的版面）。
 * 图外一圈的地形怎么续、远景地标、白杨的叶色、沙暴从哪边来……都是构图概念图（docs/art/concepts/ch1-routes/views/）里定下来的。
 */
export interface FarLandmark {
  name: string;
  /** public/assets/props/<asset>.glb */
  asset: string;
  at: V2;
  /** 整体缩放 */
  scale: number;
  /** 俯视逆时针（度）；资产正面朝 +Z */
  yaw: number;
  /** 往地里埋多少米 */
  sink?: number;
  /** 脚下垫一座沙丘（半径、高）：远景地标坐在丘顶上 */
  mound?: { r: number; h: number };
}

export interface RedoMapConfig {
  /** 图外一圈（MARGIN 米）的地形：从图边的高度起，每 100 m 抬多少米、沙丘起伏多大 */
  margin: { rise: number; dunes: number };
  /** 远景地面的高度（缺省 = 图边一圈高度的中位数） */
  farBase?: number;
  /** 白杨叶色 */
  poplar?: 'green' | 'gold';
  /** 看得见走不到的远景地标（摆在图外，不进碰撞和导航） */
  far?: FarLandmark[];
  /** 周期沙暴：从哪个据点（白盒点位 id）、从哪边刮来（网页 XZ） */
  storm?: { site: string; from: V2; radius: number };
  /** 流沙（白盒里画成泥色圆斑的位置、半径） */
  quicksand?: { at: V2; r: number }[];
  /** 光影雾（level-art.md 第二步）：每张图一句话的氛围目标定光、天、雾、调色 */
  look?: RedoLook;
}

/**
 * 一张图的光影雾。太阳的方位 / 仰角取白盒（spec.sun，影子是构图的一部分），这里只给颜色和强度；
 * 其余照 DesertMapArt（src/world/desert/spec.ts）的字段：空气透视、云天、逆光光柱、逆光轮廓、调色（叠在 play.ts 的旧场景调色上）、雾带摆位。
 */
export interface RedoLook {
  light: Omit<DesertLight, 'sun'> & { sun: { color: [number, number, number]; intensity: number; shadowStrength?: number } };
  atmosphere?: Partial<AtmosphereProfile>;
  clouds?: Partial<CloudSkyProfile>;
  shafts?: { strength?: number; threshold?: number } | false;
  rimBack?: number;
  grade?: VolumeOverrides;
  layout?: DesertLayoutTuning;
  /** 地形暗部的色调（sRGB + 1，风格化地形的 shadowTint；缺省沙漠章的 [0.7, 0.64, 0.82]）：越低越深、越偏蓝紫越冷 */
  terrainShadow?: [number, number, number, number];
  /** 远景剪影环（farLayer.ts）：3–5 排沙丘 / 台地 / 雅丹一层层退进雾里；veils = 某个方向天际压着沙暴 / 浮尘 */
  far?: { rows: FarRowSpec[]; veils?: FarVeil[]; look?: Partial<FarLook> };
}

export const REDO_MAPS: Record<string, RedoMapConfig> = {
  '1-1': {
    margin: { rise: 5, dunes: 6 },
    far: [
      // 用户 2026-11-25 看旧 1-1：「这个佛像远景做的很不错」。照旧场景的构图：出生点左前方约 40°（北偏东），
      // 旧的是 244 m 外放大 2.2 倍；这里推到图外 330 m，放大 3 倍保持同样的视角大小，面朝古道
      { name: '远景坐佛', asset: 'SM_Tripo_DesertSeatedColossus', at: [283, -47], scale: 3, yaw: -50, sink: 2, mound: { r: 70, h: 10 } },
    ],
    storm: { site: '4', from: [1, 0], radius: 30 },
    // 破晓后一小时，迎着朝阳向东赶路：长影朝玩家倒过来，烽燧逆光成剪影，天在太阳那一侧最亮、发金，东边天际压着沙暴
    look: {
      light: {
        sun: { color: [1, 0.8, 0.56], intensity: 1.6, shadowStrength: 0.9 },
        ambient: { sky: [0.48, 0.58, 0.78], equator: [0.66, 0.55, 0.43], ground: [0.36, 0.27, 0.2], intensity: 0.85 },
        fog: { color: [0.9, 0.74, 0.56], start: 70, end: 460 },
        sky: { top: [0.38, 0.54, 0.76], horizon: [0.98, 0.8, 0.58], bottom: [0.62, 0.48, 0.34], sun: [1, 0.86, 0.6], sharpness: 2.2, horizonGlow: 0.75, sunSize: 0.0012, sunHalo: 0.55, exposure: 1.2 },
      },
      atmosphere: { mistDensity: 0.0034, mistScaleHeight: 16, sunScatter: 0.6, airSkyBlend: 0.45, cloudShadow: 0.5 },
      clouds: { low: 0.1, mid: 0.25, high: 0.55, sunGlow: 0 },
      shafts: { strength: 0.32 },
      rimBack: 1.3,
      // 远景：近排低沙丘，二排台地（太阳底下钉一座逆光方山），三排更高更淡的台地；东边天际压一道沙暴纱幕
      far: {
        rows: [
          { distance: 850, height: [18, 36], kind: 'dunes', density: 0.5, aerial: 0.1 },
          { distance: 1250, height: [40, 85], kind: { mesas: 3, yardangs: 1 }, density: 0.45, aerial: 0.18, pins: [{ azimuth: 78, kind: 'mesas', height: 95, width: 1.4 }] },
          { distance: 1900, height: [75, 140], kind: 'mesas', density: 0.35, aerial: 0.3 },
        ],
        veils: [{ azimuth: 95, width: 40, amount: 0.55 }],
      },
      grade: { ColorAdjustments: { postExposure: -0.62, saturation: -2, contrast: 30 }, WhiteBalance: { temperature: 8, tint: 0 } },
    },
  },
  '1-2': {
    margin: { rise: 6, dunes: 7 }, quicksand: [{ at: [148, 97], r: 5 }, { at: [162, 96], r: 5.5 }, { at: [181, 100], r: 5 }],
    // 起风的上午，太阳在前进方向右前方：扬沙贴着河道往前流、逆光发亮，岩墙一面暖橙一面冷影，塔尖和岩拱是沙雾里的剪影
    look: {
      light: {
        sun: { color: [1, 0.86, 0.66], intensity: 1.7, shadowStrength: 0.8 },
        ambient: { sky: [0.52, 0.58, 0.74], equator: [0.68, 0.56, 0.44], ground: [0.4, 0.3, 0.22], intensity: 0.82 },
        fog: { color: [0.88, 0.72, 0.54], start: 50, end: 320 },
        sky: { top: [0.55, 0.62, 0.72], horizon: [0.95, 0.8, 0.62], bottom: [0.64, 0.5, 0.36], sun: [1, 0.9, 0.7], sharpness: 1.6, horizonGlow: 0.9, sunSize: 0.0012, sunHalo: 0.7, exposure: 1.2 },
      },
      atmosphere: { mistDensity: 0.0045, mistScaleHeight: 24, sunScatter: 0.75, airDensity: 0.0008, airSkyBlend: 0.3 },
      clouds: { low: 0.08, mid: 0.2, high: 0.4, sunGlow: 0 },
      shafts: { strength: 0.38 },
      rimBack: 1.2,
      // 远景：近排雅丹舰群，二排雅丹 + 台地，三排台地；太阳那一侧（右前方）压一层浮尘
      far: {
        rows: [
          { distance: 850, height: [24, 48], kind: 'yardangs', density: 0.7, aerial: 0.12 },
          { distance: 1300, height: [45, 95], kind: { mesas: 2, yardangs: 2 }, density: 0.5, aerial: 0.22 },
          { distance: 2000, height: [80, 150], kind: 'mesas', density: 0.35, aerial: 0.34 },
        ],
        veils: [{ azimuth: 68, width: 55, amount: 0.4 }],
      },
      grade: { ColorAdjustments: { postExposure: -0.62, saturation: -2, contrast: 30 }, WhiteBalance: { temperature: 6, tint: 0 } },
    },
  },
  '1-3': {
    margin: { rise: 5, dunes: 8 },
    // 午后高日：街巷里是又深又冷的影，沙瀑从墙头倾进城里发亮；寺塔始终立在天际线上
    look: {
      light: {
        sun: { color: [1, 0.92, 0.8], intensity: 1.85, shadowStrength: 1 },
        ambient: { sky: [0.46, 0.58, 0.84], equator: [0.62, 0.55, 0.47], ground: [0.36, 0.28, 0.22], intensity: 0.8 },
        fog: { color: [0.86, 0.78, 0.66], start: 80, end: 520 },
        sky: { top: [0.3, 0.5, 0.8], horizon: [0.86, 0.84, 0.78], bottom: [0.6, 0.5, 0.4], sun: [1, 0.95, 0.82], sharpness: 2.8, horizonGlow: 0.45, sunSize: 0.0011, sunHalo: 0.45, exposure: 1.15 },
      },
      atmosphere: { mistDensity: 0.0022, mistScaleHeight: 20, sunScatter: 0.3, airSkyBlend: 0.6 },
      clouds: { low: 0.22, mid: 0.3, high: 0.4, sunGlow: 0 },
      rimBack: 0.4,
      // 远景：城泡在沙海里——近排、二排都是沙丘，最远一排台地
      far: {
        rows: [
          { distance: 850, height: [22, 44], kind: 'dunes', density: 0.7, aerial: 0.12 },
          { distance: 1350, height: [40, 85], kind: 'dunes', density: 0.55, aerial: 0.22 },
          { distance: 2100, height: [80, 150], kind: 'mesas', density: 0.3, aerial: 0.34 },
        ],
      },
      grade: { ColorAdjustments: { postExposure: -0.6, saturation: -2, contrast: 32 } },
    },
  },
  '1-4': {
    margin: { rise: 10, dunes: 10 }, poplar: 'green',
    // 烈日下的露天沙洼：四面刀刃脊的沙山一面亮一面暗，月牙泉是全画面唯一的冷色，影子就是掩体
    look: {
      light: {
        sun: { color: [1, 0.95, 0.86], intensity: 2.2, shadowStrength: 1 },
        ambient: { sky: [0.5, 0.62, 0.86], equator: [0.7, 0.6, 0.48], ground: [0.45, 0.35, 0.26], intensity: 0.72 },
        fog: { color: [0.94, 0.86, 0.72], start: 90, end: 600 },
        sky: { top: [0.42, 0.6, 0.84], horizon: [0.97, 0.92, 0.84], bottom: [0.72, 0.6, 0.46], sun: [1, 0.98, 0.9], sharpness: 3.2, horizonGlow: 0.55, sunSize: 0.0012, sunHalo: 0.5, exposure: 1.18 },
      },
      atmosphere: { mistDensity: 0.002, mistScaleHeight: 26, sunScatter: 0.25, airSkyBlend: 0.5 },
      clouds: { low: 0.1, mid: 0.15, high: 0.35, sunGlow: 0 },
      shafts: false,
      rimBack: 0.3,
      // 沙山一面亮一面暗：背阳坡压深、偏冷（太阳也从 46° 压到 34°，和旱魃一阶段推到的 30° 接得上）
      terrainShadow: [0.56, 0.54, 0.82, 1],
      // 远景：沙山外面一层层更远、更高的沙海（鸣沙山的大沙山相对高 100–250 m），最远一排台地。
      // 构成复核（2026-11-26）：50–180 m 时全被 30–44 m 的近环挡住，出生台上只看得见一道碗沿；现在从出生台望出去，远沙山一层层高出近环 1–5°
      far: {
        rows: [
          { distance: 950, height: [140, 210], kind: 'dunes', density: 0.85, aerial: 0.14 },
          { distance: 1450, height: [190, 290], kind: 'dunes', density: 0.65, aerial: 0.26 },
          { distance: 2200, height: [250, 380], kind: { mesas: 2, dunes: 1 }, density: 0.45, aerial: 0.38 },
        ],
      },
      grade: { ColorAdjustments: { postExposure: -0.55, saturation: 0, contrast: 32 }, WhiteBalance: { temperature: 4, tint: 0 } },
    },
  },
  '1-A': {
    margin: { rise: 4, dunes: 5 }, poplar: 'gold',
    // 午后斜阳从西南照过来，把千佛崖照成一面金壁；崖脚的河床还在冷影里，寺塔的塔尖是全场最亮的一点
    look: {
      light: {
        sun: { color: [1, 0.8, 0.56], intensity: 1.75, shadowStrength: 0.95 },
        ambient: { sky: [0.44, 0.55, 0.8], equator: [0.6, 0.52, 0.45], ground: [0.34, 0.27, 0.22], intensity: 0.8 },
        fog: { color: [0.86, 0.72, 0.58], start: 80, end: 520 },
        sky: { top: [0.34, 0.5, 0.78], horizon: [0.96, 0.8, 0.6], bottom: [0.6, 0.48, 0.36], sun: [1, 0.86, 0.6], sharpness: 2.4, horizonGlow: 0.7, sunSize: 0.0012, sunHalo: 0.55, exposure: 1.15 },
      },
      atmosphere: { mistDensity: 0.004, mistScaleHeight: 10, sunScatter: 0.5, airSkyBlend: 0.5 },
      clouds: { low: 0.12, mid: 0.3, high: 0.5, sunGlow: 0 },
      shafts: { strength: 0.28 },
      rimBack: 1,
      // 远景：崖顶后面（北）一层层更高的台地，崖才显得高；南边对岸低沙垄
      far: {
        rows: [
          // 构成复核（2026-11-26）：崖只有 18 m，出生点看过去是一条矮带——北边两排台地抬高，从河滩上看越过崖顶 + 后崖一层层露出来
          { distance: 800, height: [80, 125], kind: 'mesas', density: 0.6, sectors: [[110, 250]], outside: 0.3, aerial: 0.14 },
          { distance: 1250, height: [120, 180], kind: 'mesas', density: 0.5, sectors: [[95, 265]], outside: 0.35, aerial: 0.24 },
          { distance: 1900, height: [120, 190], kind: { mesas: 3, dunes: 1 }, density: 0.35, aerial: 0.32 },
        ],
      },
      grade: { ColorAdjustments: { postExposure: -0.62, saturation: -2, contrast: 30 }, WhiteBalance: { temperature: 6, tint: 0 } },
    },
  },
};
