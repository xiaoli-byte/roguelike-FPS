/**
 * 4-4 神山海子（雷泽雷神的擂台，章节终局）的关卡数据。设计见 docs/level-design/chuanzang-combat-v1.md 4.5。
 * 圆形冰川湖（原型稻城亚丁牛奶海、然乌湖）：湖心 (0, 0)，湖面以外一圈能走的碎石湖岸，再外面是围成冰斗的雪山坡；
 * 北偏东的冰碛垭口低下去，正对远处的神山——从南岸出生点越过湖心岛看过去，神山和它在湖面上的倒影就是登场画面。
 * 坐标同第四章其他图：x 东、z 南（北 = −z），湖面高度 0。
 */
import type { PeakSpec } from '../plateau/backdrop';
import type { Placement } from '../plateau/spec';

export type V2 = readonly [number, number];
export type V3 = readonly [number, number, number];

export const MAP = {
  id: '4-4',
  chapter: '雪域天路',
  name: '神山海子',
  bounds: { minX: -230, maxX: 230, minZ: -230, maxZ: 230 },
  /** 海拔显示：湖面约 4600 m（牛奶海一带），只作氛围 */
  altitudeBase: 4600,
  /** 可玩区半径：到它的有符号距离就是软边界函数（区内为负） */
  playRadius: 78,
  /** 超出可玩区多少米开始起风雪把人推回湖岸（软边界，同 4-1 / 4-2） */
  softBoundary: 4,
};

/** 湖：deepR 以内是深水（走不进去）；deepR–shoreR 是浅水 / 碎石滩过渡；shoreR–shoreOuterR 是能走的湖岸，再往外是雪山坡 */
export const LAKE = {
  deepR: 46,
  shoreR: 52,
  shoreOuterR: 75,
  /** 正常水位（世界 y） */
  level: 0,
  /** 湖底最深处（湖心岛和湖岸之间的那一圈） */
  bottom: -7,
  /** 牛奶海的乳白青绿：深处 / 近岸 */
  deep: '#2f8f98',
  shallow: '#7fd1c6',
};

/** 湖心岛：顶面高出水面 h，上面是终局的灵火坛 */
export const ISLAND = { x: 0, z: 0, r: 9, h: 1.5 };

/**
 * 雷泽雷神的龙身沿这一圈盘在湖里，6 段身子轮流拱出水面——拱起来的身段是从湖岸到湖心岛的路（首领战里做，这里只记数据）。
 * 头和上身从湖心岛北侧的漩涡里升起。
 */
export const COIL = { r: 28, segments: 6, headAt: [0, -16] as V2 };

/** 导雷石柱：湖岸东南西北各一根，柱顶一块雷晶（雷劈中充电，首领战里打雷晶把雷劈回雷神） */
export interface PillarSpec { id: string; name: string; x: number; z: number; height: number }
export const PILLARS: PillarSpec[] = [
  { id: 'N', name: '北柱', x: 0, z: -60, height: 7 },
  { id: 'E', name: '东柱', x: 60, z: 0, height: 7 },
  { id: 'S', name: '南柱', x: 0, z: 60, height: 7 },
  { id: 'W', name: '西柱', x: -60, z: 0, height: 7 },
];

/** 出生点：南岸偏西，面朝湖心岛（南柱在右前方，不挡湖心） */
export const SPAWN = { x: -18, z: 67.6, face: [0, 0] as V2 };

/** 神山：北偏东远处的雪峰，正好落在「出生点 → 湖心岛」的延长线上 */
export const SACRED_PEAK = { x: 360, z: -1390, height: 640, radius: 900 };

/** 冰斗缺口的方位（从湖心看神山，弧度：0 = 北，顺时针为正） */
export const PEAK_BEARING = Math.atan2(SACRED_PEAK.x, -SACRED_PEAK.z);

export const PEAKS: PeakSpec[] = [
  { x: SACRED_PEAK.x, z: SACRED_PEAK.z, height: SACRED_PEAK.height, radius: SACRED_PEAK.radius, ridges: 4, sharp: 1.95, seed: 21.4, snow: 0.42, green: 0 },
  { x: -420, z: -1250, height: 420, radius: 620, ridges: 4, sharp: 1.35, seed: 22.1, snow: 0.38, green: 0 },
  { x: 980, z: -1150, height: 460, radius: 640, ridges: 3, sharp: 1.4, seed: 23.7, snow: 0.36, green: 0 },
  { x: 1250, z: -100, height: 380, radius: 620, ridges: 4, sharp: 1.3, seed: 24.4, snow: 0.42, green: 0.1 },
  { x: -1250, z: -300, height: 420, radius: 680, ridges: 4, sharp: 1.3, seed: 25.2, snow: 0.4, green: 0.1 },
  { x: -1000, z: 1000, height: 360, radius: 680, ridges: 4, sharp: 1.25, seed: 26.6, snow: 0.45, green: 0.2 },
  { x: 900, z: 1100, height: 320, radius: 680, ridges: 5, sharp: 1.15, seed: 27.9, snow: 0.5, green: 0.3 },
  { x: 0, z: 1500, height: 260, radius: 720, ridges: 5, sharp: 1.0, seed: 28.3, snow: 0.7, green: 0.5 },
];

/**
 * 湖岸的掩体和小件（复用 4-1 的地标搭法）：玛尼堆、巨石当掩体（1.4–2.2 m 高），出生点旁一簇达觉经幡，湖心岛上的灵火坛。
 * 避开出生点看湖心的视线和四根石柱。
 */
export const PLACEMENTS: Placement[] = [
  { kind: 'altar', x: 0, z: 0 },
  { kind: 'maniPile', x: 52, z: -34, scale: 1.1 },
  { kind: 'maniPile', x: -58, z: 30, scale: 1.0 },
  { kind: 'maniPile', x: 36, z: -50, scale: 1.25 },
  { kind: 'maniPile', x: -42, z: -46, scale: 1.05 },
  { kind: 'boulder', x: 54, z: 32, scale: 2.2 },
  { kind: 'boulder', x: -64, z: -22, scale: 1.8 },
  { kind: 'boulder', x: 22, z: 62, scale: 1.6 },
  { kind: 'boulder', x: -27, z: 57, scale: 1.4 },
  { kind: 'darchor', x: -42, z: 63 },
];

/** 经幡绳（两端离地高度） */
export const FLAG_LINES: { a: V2; ha: number; b: V2; hb: number; sag?: number; poles?: boolean }[] = [
  { a: [-58, 30], ha: 1.7, b: [-60, 0], hb: 6.2, sag: 0.05 },
  { a: [36, -50], ha: 2.0, b: [0, -60], hb: 6.2, sag: 0.05 },
];

export interface Viewpoint { id: string; name: string; pos: V3; look: V3; walk: boolean }

export const VIEWPOINTS: Viewpoint[] = [
  { id: 'spawn', name: '出生点（南岸）', pos: [SPAWN.x, 0, SPAWN.z], look: [0, 2, 0], walk: true },
  { id: 'mirror', name: '神山倒影（水边）', pos: [-6, 0, 51.5], look: [SACRED_PEAK.x * 0.05, 4, SACRED_PEAK.z * 0.05], walk: true },
  { id: 'island', name: '湖心岛', pos: [3, 0, 4], look: [0, 3, 60], walk: true },
  { id: 'pillar', name: '东柱旁', pos: [64, 0, 6], look: [0, 3, 0], walk: true },
  { id: 'above', name: '俯瞰全景', pos: [70, 95, 135], look: [0, 0, 0], walk: false },
  { id: 'peak', name: '远眺神山（飞行）', pos: [-30, 26, 110], look: [SACRED_PEAK.x, 300, SACRED_PEAK.z], walk: false },
];
