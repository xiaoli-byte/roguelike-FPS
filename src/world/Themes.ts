/**
 * 三章主题：契约里的 ThemeDef（雾、天空、主色）+ 世界模块内部使用的扩展画风参数 ThemeStyle。
 * 所有颜色均为 sRGB 十六进制。
 */
import type { ThemeDef, ThemeId } from '../core/types';

export type ParticleKind = 'dust' | 'snow' | 'ember';
export type WallTopKind = 'merlon' | 'eave' | 'spike';

export interface ThemeStyle {
  /** 围墙高度（米） */
  wallHeight: number;
  /** 墙顶装饰：城垛 / 檐角 / 黑曜石尖刺 */
  wallTop: WallTopKind;
  /** 墙体石色 */
  stone: number;
  /** 深色石（壁柱、基座、角楼） */
  stone2: number;
  /** 高台顶面、台阶铺石 */
  paving: number;
  /** 勾缝 / 深色饰条 */
  trim: number;
  wood: number;
  woodDark: number;
  /** 朱漆（柱子、牌坊） */
  lacquer: number;
  metal: number;
  gold: number;
  cloth: number;
  cloth2: number;
  /** 灯火 / 熔岩 */
  glow: number;
  glowHot: number;
  /** 纸灯笼 */
  paper: number;
  foliage: number;
  foliage2: number;
  snow: number;
  ice: number;
  obsidian: number;
  roof: number;
  sand: number;
  clay: number;
  /** 远山 */
  far: number;
  farCap: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunIntensity: number;
  /** 太阳方向（指向太阳，未归一化） */
  sunDir: readonly [number, number, number];
  /** 点光源（火盆 / 灯笼） */
  lampColor: number;
  lampIntensity: number;
  particle: { kind: ParticleKind; color: number; size: number; speed: number; opacity: number; additive: boolean; density: number };
  cloud: { color: number; amount: number; speed: number };
  /** 天空太阳光晕强度 */
  sunGlow: number;
  /** 日月角半径、地平线层宽与夜空星光；只驱动现有穹顶材质。 */
  sky: { celestial: 'sun' | 'moon'; diskRadius: number; horizonFalloff: number; stars: number; cloudStretch: number };
  /** 地面熔岩裂缝发光强度（0 = 无） */
  floorGlow: number;
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  desert: {
    id: 'desert',
    name: '荒漠遗迹',
    fogColor: 0xb9aaa0,
    skyTop: 0x254d64,
    skyBottom: 0xd8b28b,
    ambient: 0xd6dedb,
    sun: 0xffd8a0,
    floor: 0xc6a378,
    wall: 0xb99469,
    accent: 0xa6382c,
  },
  frost: {
    id: 'frost',
    name: '霜雪古寺',
    fogColor: 0x6f829d,
    skyTop: 0x172d50,
    skyBottom: 0x627b9c,
    ambient: 0xbacee6,
    sun: 0xc5dcff,
    floor: 0xcfdae4,
    wall: 0x7b8ba2,
    accent: 0xb3202e,
  },
  inferno: {
    id: 'inferno',
    name: '熔火深渊',
    fogColor: 0x5b465b,
    skyTop: 0x18152d,
    skyBottom: 0x754550,
    ambient: 0xbdabc8,
    sun: 0xffbc7c,
    floor: 0x51475a,
    wall: 0x61566a,
    accent: 0xf7782b,
  },
};

const STYLES: Record<ThemeId, ThemeStyle> = {
  desert: {
    wallHeight: 9,
    wallTop: 'merlon',
    stone: 0xb99469,
    stone2: 0x826c57,
    paving: 0xc7b18d,
    trim: 0x655951,
    wood: 0x87603c,
    woodDark: 0x5a3a22,
    lacquer: 0xb02a1e,
    metal: 0x80745e,
    gold: 0xd4aa60,
    cloth: 0xc23a2a,
    cloth2: 0x36606b,
    glow: 0xffa040,
    glowHot: 0xffe08a,
    paper: 0xff6a3c,
    foliage: 0x6c8f3c,
    foliage2: 0x88a84c,
    snow: 0xfff6e8,
    ice: 0xa0e0ff,
    obsidian: 0x3a2a24,
    roof: 0x655548,
    sand: 0xcdae80,
    clay: 0xb2653a,
    far: 0x7b8c91,
    farCap: 0xa8a69b,
    fogNear: 46,
    fogFar: 205,
    hemiSky: 0xc4d8de,
    hemiGround: 0x927e66,
    hemiIntensity: 1.1,
    sunIntensity: 2,
    sunDir: [-0.72, 0.36, 0.42],
    lampColor: 0xffa24a,
    lampIntensity: 12,
    particle: { kind: 'dust', color: 0xf1d7aa, size: 0.045, speed: 0.16, opacity: 0.25, additive: true, density: 0.75 },
    cloud: { color: 0xcab5a3, amount: 0.38, speed: 0.0035 },
    sunGlow: 0.75,
    sky: { celestial: 'sun', diskRadius: 0.025, horizonFalloff: 8, stars: 0, cloudStretch: 0.6 },
    floorGlow: 0,
  },
  frost: {
    wallHeight: 10,
    wallTop: 'eave',
    stone: 0x7b8ba2,
    stone2: 0x52657c,
    paving: 0x9cacc0,
    trim: 0x3e5169,
    wood: 0x62432e,
    woodDark: 0x3b2618,
    lacquer: 0xa8202c,
    metal: 0x4d5864,
    gold: 0xd8b25a,
    cloth: 0xa8202c,
    cloth2: 0xeadfc4,
    glow: 0xffbb66,
    glowHot: 0xfff0c0,
    paper: 0xff7a4a,
    foliage: 0x2f5a46,
    foliage2: 0x3f6e56,
    snow: 0xdce7f2,
    ice: 0x91bbda,
    obsidian: 0x2a3440,
    roof: 0x3c5068,
    sand: 0xc8d5e4,
    clay: 0x8a5a44,
    far: 0x566e8c,
    farCap: 0xb3c8dd,
    fogNear: 40,
    fogFar: 190,
    hemiSky: 0xb5ceee,
    hemiGround: 0x7c91a9,
    hemiIntensity: 1.2,
    sunIntensity: 1.3,
    sunDir: [0.62, 0.64, -0.5],
    lampColor: 0xffb45a,
    lampIntensity: 18,
    particle: { kind: 'snow', color: 0xd6e6fa, size: 0.065, speed: -0.75, opacity: 0.6, additive: false, density: 1.1 },
    cloud: { color: 0x627998, amount: 0.44, speed: 0.0025 },
    sunGlow: 0.35,
    sky: { celestial: 'moon', diskRadius: 0.019, horizonFalloff: 10, stars: 0.22, cloudStretch: 0.72 },
    floorGlow: 0,
  },
  inferno: {
    wallHeight: 11,
    wallTop: 'spike',
    stone: 0x61566a,
    stone2: 0x453b53,
    paving: 0x615765,
    trim: 0x342b41,
    wood: 0x55434b,
    woodDark: 0x382d3b,
    lacquer: 0x701913,
    metal: 0x5c5366,
    gold: 0xcb9560,
    cloth: 0x7c1511,
    cloth2: 0x453447,
    glow: 0xf77728,
    glowHot: 0xffcd74,
    paper: 0xff5a2a,
    foliage: 0x4c3d4e,
    foliage2: 0x3e3247,
    snow: 0x5a5050,
    ice: 0xff8a3a,
    obsidian: 0x362b48,
    roof: 0x3e324b,
    sand: 0x5b4b59,
    clay: 0x71494a,
    far: 0x4c3c58,
    farCap: 0xe38646,
    fogNear: 34,
    fogFar: 172,
    // 冷紫散射光照清岩壁阴面，橙金只留给火源与受光的边缘。
    hemiSky: 0xc4d0f0,
    hemiGround: 0x8a758b,
    hemiIntensity: 1.7,
    sunIntensity: 1.9,
    sunDir: [-0.48, 0.72, 0.38],
    lampColor: 0xffb068,
    lampIntensity: 14,
    particle: { kind: 'ember', color: 0xffa252, size: 0.045, speed: 0.65, opacity: 0.68, additive: true, density: 0.85 },
    cloud: { color: 0x3c324b, amount: 0.5, speed: 0.0045 },
    sunGlow: 0.22,
    sky: { celestial: 'sun', diskRadius: 0.022, horizonFalloff: 8.5, stars: 0, cloudStretch: 0.55 },
    floorGlow: 0.58,
  },
};

export function themeDef(id: ThemeId): ThemeDef {
  return THEMES[id] ?? THEMES.desert;
}

export function themeStyle(id: ThemeId): ThemeStyle {
  return STYLES[id] ?? STYLES.desert;
}
