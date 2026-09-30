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
  /** 地面熔岩裂缝发光强度（0 = 无） */
  floorGlow: number;
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  desert: {
    id: 'desert',
    name: '荒漠遗迹',
    fogColor: 0xe4c49b,
    skyTop: 0x3a78c2,
    skyBottom: 0xf2d6ac,
    ambient: 0xfff0da,
    sun: 0xffe1b4,
    floor: 0xdcb682,
    wall: 0xcc9a64,
    accent: 0xc23a2a,
  },
  frost: {
    id: 'frost',
    name: '霜雪古寺',
    fogColor: 0xbfd3e3,
    skyTop: 0x2f5c8c,
    skyBottom: 0xd4e5f0,
    ambient: 0xe2eefa,
    sun: 0xf0f6ff,
    floor: 0xe8f0f6,
    wall: 0x8093a6,
    accent: 0xb3202e,
  },
  inferno: {
    id: 'inferno',
    name: '熔火深渊',
    fogColor: 0x3e150d,
    skyTop: 0x100509,
    skyBottom: 0x6c2512,
    ambient: 0x9a5a48,
    sun: 0xff9a5a,
    floor: 0x3d3532,
    wall: 0x3b3231,
    accent: 0xff5a1a,
  },
};

const STYLES: Record<ThemeId, ThemeStyle> = {
  desert: {
    wallHeight: 9,
    wallTop: 'merlon',
    stone: 0xcc9a64,
    stone2: 0x9d6c42,
    paving: 0xe2c291,
    trim: 0x7a5232,
    wood: 0x8e5d35,
    woodDark: 0x5a3a22,
    lacquer: 0xb02a1e,
    metal: 0x8f6c3a,
    gold: 0xe2b04e,
    cloth: 0xc23a2a,
    cloth2: 0x2f5d8a,
    glow: 0xffa040,
    glowHot: 0xffe08a,
    paper: 0xff6a3c,
    foliage: 0x6c8f3c,
    foliage2: 0x88a84c,
    snow: 0xfff6e8,
    ice: 0xa0e0ff,
    obsidian: 0x3a2a24,
    roof: 0x7c3b22,
    sand: 0xe4c28c,
    clay: 0xb2653a,
    far: 0xc99a6a,
    farCap: 0xe6c192,
    fogNear: 34,
    fogFar: 175,
    hemiSky: 0xfff1dc,
    hemiGround: 0xa47a52,
    hemiIntensity: 1.15,
    sunIntensity: 2.9,
    sunDir: [-0.55, 0.92, 0.38],
    lampColor: 0xffa24a,
    lampIntensity: 12,
    particle: { kind: 'dust', color: 0xfff0d0, size: 0.07, speed: 0.25, opacity: 0.4, additive: true, density: 1 },
    cloud: { color: 0xfff8ee, amount: 0.35, speed: 0.006 },
    sunGlow: 1,
    floorGlow: 0,
  },
  frost: {
    wallHeight: 10,
    wallTop: 'eave',
    stone: 0x8093a6,
    stone2: 0x5b6b7d,
    paving: 0xa9b7c4,
    trim: 0x3f4c5a,
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
    snow: 0xf5f9fd,
    ice: 0x8fdcff,
    obsidian: 0x2a3440,
    roof: 0x34404f,
    sand: 0xdfe8ef,
    clay: 0x8a5a44,
    far: 0x94aac0,
    farCap: 0xf2f7fb,
    fogNear: 24,
    fogFar: 142,
    hemiSky: 0xe6f0ff,
    hemiGround: 0x8c9aaa,
    hemiIntensity: 1.3,
    sunIntensity: 2.1,
    sunDir: [0.62, 0.64, -0.5],
    lampColor: 0xffb45a,
    lampIntensity: 14,
    particle: { kind: 'snow', color: 0xffffff, size: 0.09, speed: -1.1, opacity: 0.85, additive: false, density: 1.4 },
    cloud: { color: 0xf2f6fa, amount: 0.62, speed: 0.004 },
    sunGlow: 0.45,
    floorGlow: 0,
  },
  inferno: {
    wallHeight: 11,
    wallTop: 'spike',
    stone: 0x3b3231,
    stone2: 0x251e1e,
    paving: 0x4b413d,
    trim: 0x1a1414,
    wood: 0x3e2b21,
    woodDark: 0x241812,
    lacquer: 0x701913,
    metal: 0x302929,
    gold: 0xc47c30,
    cloth: 0x7c1511,
    cloth2: 0x2a1a1a,
    glow: 0xff5a14,
    glowHot: 0xffc050,
    paper: 0xff5a2a,
    foliage: 0x3a2a24,
    foliage2: 0x2a201c,
    snow: 0x5a5050,
    ice: 0xff8a3a,
    obsidian: 0x1d1325,
    roof: 0x221a1a,
    sand: 0x4c3c35,
    clay: 0x5c3127,
    far: 0x2c1510,
    farCap: 0xff6a20,
    fogNear: 18,
    fogFar: 118,
    hemiSky: 0xb46c52,
    hemiGround: 0x2c1515,
    hemiIntensity: 1.0,
    sunIntensity: 1.8,
    sunDir: [0.28, 1.0, 0.32],
    lampColor: 0xff6a24,
    lampIntensity: 16,
    particle: { kind: 'ember', color: 0xff8a3a, size: 0.07, speed: 0.9, opacity: 0.95, additive: true, density: 1.1 },
    cloud: { color: 0x2a0e0a, amount: 0.6, speed: 0.008 },
    sunGlow: 0.3,
    floorGlow: 1,
  },
};

export function themeDef(id: ThemeId): ThemeDef {
  return THEMES[id] ?? THEMES.desert;
}

export function themeStyle(id: ThemeId): ThemeStyle {
  return STYLES[id] ?? STYLES.desert;
}
