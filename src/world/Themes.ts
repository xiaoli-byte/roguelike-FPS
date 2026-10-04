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
    fogColor: 0xcbb096,
    skyTop: 0x8c9393,
    skyBottom: 0xe4be88,
    ambient: 0xe2d7c9,
    sun: 0xffd8a0,
    floor: 0xe0b786,
    wall: 0xc69b6b,
    accent: 0xa6382c,
  },
  frost: {
    id: 'frost',
    name: '霜雪古寺',
    fogColor: 0x6688ad,
    skyTop: 0x15345e,
    skyBottom: 0x709cbe,
    ambient: 0xc7dcef,
    sun: 0xc5dcff,
    floor: 0xd7e8f2,
    wall: 0x7f99b1,
    accent: 0xb3202e,
  },
  inferno: {
    id: 'inferno',
    name: '熔火深渊',
    fogColor: 0x505770,
    skyTop: 0x171c36,
    skyBottom: 0x5c5c7c,
    ambient: 0xb4c2e0,
    sun: 0xe8c0a3,
    floor: 0x55576b,
    wall: 0x657087,
    accent: 0xf7782b,
  },
};

const STYLES: Record<ThemeId, ThemeStyle> = {
  desert: {
    wallHeight: 9,
    wallTop: 'merlon',
    stone: 0xc69b6b,
    stone2: 0x93694f,
    paving: 0xe4c595,
    trim: 0x785744,
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
    sand: 0xd9b080,
    clay: 0xb2653a,
    far: 0x997e75,
    farCap: 0xcbb69c,
    fogNear: 46,
    fogFar: 205,
    hemiSky: 0xd6d0c9,
    hemiGround: 0x9b7472,
    hemiIntensity: 1.1,
    sunIntensity: 2,
    sunDir: [-0.72, 0.36, 0.42],
    lampColor: 0xffa24a,
    lampIntensity: 12,
    particle: { kind: 'dust', color: 0xe6c49b, size: 0.035, speed: 0.16, opacity: 0.09, additive: false, density: 0.5 },
    cloud: { color: 0xd5bfa7, amount: 0.3, speed: 0.0035 },
    sunGlow: 0.75,
    sky: { celestial: 'sun', diskRadius: 0.025, horizonFalloff: 8, stars: 0, cloudStretch: 0.6 },
    floorGlow: 0,
  },
  frost: {
    wallHeight: 10,
    wallTop: 'eave',
    stone: 0x7f99b1,
    stone2: 0x4c6d90,
    paving: 0xb4cee4,
    trim: 0x3d5c7c,
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
    snow: 0xe2eef6,
    ice: 0x83b8dd,
    obsidian: 0x2a3440,
    roof: 0x3c5068,
    sand: 0xc8d5e4,
    clay: 0x8a5a44,
    far: 0x4e7396,
    farCap: 0xb8d5eb,
    fogNear: 40,
    fogFar: 190,
    hemiSky: 0xbcd9f5,
    hemiGround: 0x6f91b5,
    hemiIntensity: 1.2,
    sunIntensity: 1.3,
    sunDir: [0.62, 0.64, -0.5],
    lampColor: 0xffb45a,
    lampIntensity: 18,
    particle: { kind: 'snow', color: 0xd6e6fa, size: 0.065, speed: -0.75, opacity: 0.6, additive: false, density: 1.1 },
    cloud: { color: 0x638fb4, amount: 0.4, speed: 0.0025 },
    sunGlow: 0.35,
    sky: { celestial: 'moon', diskRadius: 0.019, horizonFalloff: 10, stars: 0.1, cloudStretch: 0.72 },
    floorGlow: 0,
  },
  inferno: {
    wallHeight: 11,
    wallTop: 'spike',
    stone: 0x657087,
    stone2: 0x3d435d,
    paving: 0x72748a,
    trim: 0x30364d,
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
    sand: 0x55576b,
    clay: 0x71494a,
    far: 0x414d68,
    farCap: 0xe38646,
    fogNear: 34,
    fogFar: 172,
    // 冷紫散射光照清岩壁阴面，橙金只留给火源与受光的边缘。
    hemiSky: 0xc4d0f0,
    hemiGround: 0x677391,
    hemiIntensity: 1.7,
    sunIntensity: 1.9,
    sunDir: [-0.48, 0.72, 0.38],
    lampColor: 0xffb068,
    lampIntensity: 14,
    particle: { kind: 'ember', color: 0xffa252, size: 0.035, speed: 0.65, opacity: 0.44, additive: true, density: 0.65 },
    cloud: { color: 0x39425f, amount: 0.44, speed: 0.0045 },
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
