import { BANNER_COLORS } from '../banners';
import type { V2 } from '../whitebox/types';
import type { RedoFx } from './fx';

/**
 * 第一章重做版每张图的特效（fx.ts 摆、挂）。坐标都是白盒 / 场景坐标（x 向东、z 向南）。
 * 原则（level-art.md「特效」、composition.md 8.2–8.3）：环境特效低对比、慢、个头大、数量少，不进交战区、不抢敌人；
 * 每张图的特效服务那张图的氛围一句话——1-1 狼烟逆光直上、1-2 扬沙逆光、1-3 沙瀑从墙头倾进城、1-4 刀刃脊上吹沙、1-A 金叶和香烟。
 */

/** 1-2 雅丹岛的脊：isle(xa, xb, z, …) 的头尾（地形图章里的岛，从头到尾就是一道脊） */
const ISLES_1_2: [number, number, number][] = [
  [98, 128, 114], [138, 176, 114], [184, 203, 114], [214, 246, 113], [238, 292, 112], [136, 180, 148], [190, 222, 152],
  [96, 200, 206], [150, 206, 205], [46, 90, 196], [196, 226, 229], [280, 314, 210], [258, 308, 132],
];

export const REDO_FX: Record<string, RedoFx> = {
  '1-1': {
    // 地面散布（照概念图近景）：砾石滩上一丛丛枯草和碎石、古道两道车辙 + 压暗的砾石路肩
    ground: {
      grass: { gravel: 0.07, sand: 0.025, mud: 0.05, dune: 0.008, earth: 0.02 },
      pebbles: { gravel: 0.32, sand: 0.05, mud: 0.14, earth: 0.08, road: 0.03 },
      shoulder: { width: 3, grass: 0.22, pebbles: 0.55 },
    },
    // 北边沙丘带、东边两段沙丘：脊上的沙朝西南吹进盆地
    ridges: { reach: 1.4, opacity: 0.8 },
    smoke: [
      // 烽燧狼烟：塔顶（25 m）起，70 m 高，到半空被东北风吹弯；风正对着出生点吹，偏 30° 让弯从出生门框里读得出
      { origin: [277.5, 28.4, 119.5], height: 80, veer: 30, width: 5.5, opacity: 1 },
      // 戍卒残营的火盆：一缕细烟
      { origin: [327, 2.6, 180], height: 16, width: 0.9, opacity: 0.55, rise: 1.4, count: 24 },
    ],
    // 东边天际压着的沙暴墙（概念图「出生第一眼」右侧天边那一道褐黄尘墙；④ 营地的周期沙暴就从那边来）
    storm: { azimuth: [30, 76], distance: 750, height: 90 },
    // 狼烟是黑烟（烧狼粪 / 湿柴）：浅灰的烟逆着发亮的晨天整个化掉，压成深褐灰才立得住
    smokeOptions: { low: [0.3, 0.26, 0.23], high: [0.56, 0.52, 0.49] },
    // 尘卷风：南边戈壁、东北角，远远地游
    devils: [
      { path: [[236, 284], [290, 278], [340, 284], [300, 288]], height: 26 },
      { path: [[300, 58], [342, 68], [372, 60]], height: 22, phase: 0.55 },
    ],
    // 贴地流沙：戈壁上几块开阔地（交战区自动避开）
    drift: [{ center: [205, 205], size: [80, 30] }, { center: [125, 222], size: [60, 26] }, { center: [250, 168], size: [56, 24] }, { center: [370, 130], size: [50, 24] }],
    banners: [
      // 照概念图「出生第一眼」：木门框门楣北端伸出的旗杆上挂一条破幡（在北柱外侧，不挡门洞里的烽燧和狼烟）
      { kind: 'hang', at: [42, 6.3, 159.9], length: 3.6, width: 1.05, yaw: -90 },
      // 烽燧台东北角的令旗、营地两面
      { kind: 'pole', at: [300.5, 112.5], height: 6.5, length: 3.2, width: 0.8 },
      { kind: 'pole', at: [319.5, 201], height: 5.5, length: 2.8, width: 0.75, color: BANNER_COLORS.ochre },
      { kind: 'pole', at: [349, 226.5], height: 6, length: 3, width: 0.8 },
    ],
  },
  '1-2': {
    // 地面散布（照概念图近景）：砾石滩上一丛丛枯草和碎石、古道两道车辙 + 压暗的砾石路肩
    ground: {
      grass: { gravel: 0.06, sand: 0.02, mud: 0.04, road: 0.004 },
      pebbles: { gravel: 0.3, sand: 0.04, mud: 0.12, earth: 0.06, road: 0.04 },
      shoulder: { width: 2.5, grass: 0.15, pebbles: 0.4 },
    },
    ridges: false,
    // 起风的上午：每座雅丹岛的脊上都在起沙，逆光看是一缕缕发亮的沙带
    extraRidges: ISLES_1_2.map(([a, b, z]) => ({ points: [[a + 3, z], [(a + b) / 2, z], [b - 3, z]] as V2[], reach: 26, size: 8, opacity: 1 })),
    // 逆光扬沙：向阳偏置拉高，沙带比背后的岩壁亮一档（0.8 时近处一团发白像蒸汽，压到 0.6）
    ridgeOptions: { lit: 0.6 },
    devils: [{ path: [[150, 60], [200, 48], [250, 60]], height: 24 }, { path: [[120, 250], [180, 262], [240, 255]], height: 22, phase: 0.5 }],
    banners: [
      // 塔尖广场：环台南面两根幡杆夹着上环台的坡道
      { kind: 'pole', at: [233.5, 176], height: 8, length: 4, width: 0.95 },
      { kind: 'pole', at: [262.5, 176], height: 8, length: 4, width: 0.95, color: BANNER_COLORS.ochre },
    ],
  },
  '1-3': {
    // 地面散布（照概念图近景）：砾石滩上一丛丛枯草和碎石、古道两道车辙 + 压暗的砾石路肩
    ground: {
      grass: { sand: 0.01, gravel: 0.035, earth: 0.01 },
      pebbles: { sand: 0.03, gravel: 0.24, earth: 0.06, road: 0.05, mud: 0.06 },
      shoulder: { width: 1.8, grass: 0.06, pebbles: 0.3 },
    },
    // 城外的远丘（脊高 8–13 m）也吹；出生丘顶一带不吹（第一眼要看清城）
    ridges: { reach: 1.2, opacity: 0.7, skip: [{ at: [106, 78], r: 70 }] },
    // 沙瀑：北墙西段、西墙北段，沙丘漫过墙头的地方往城里倾泻
    falls: [
      { top: [168.2, 8.3, 92.6], out: [0.36, 0.93], width: 2.4, flow: 0.8, opacity: 0.55 },
      { top: [180, 8.3, 89.4], out: [0.25, 0.97], width: 1.8, flow: 0.6 },
      { top: [192, 8.3, 87.6], out: [0.18, 0.98], width: 1.4, flow: 0.45 },
      { top: [98, 8.3, 149.6], out: [0.86, 0.52], width: 2, flow: 0.7 },
      { top: [93, 8.3, 158], out: [0.95, 0.3], width: 1.4, flow: 0.5 },
    ],
    drift: [{ center: [160, 140], size: [50, 22] }, { center: [255, 116], size: [44, 16] }],
    devils: [{ path: [[40, 300], [60, 250], [30, 220]], height: 24 }],
    banners: [
      // 两座残门楼顶上的旗、长街北排店铺二层挂的幡、寺院门楼两侧的幡
      { kind: 'pole', at: [112, 120], height: 5, length: 2.6, width: 0.75 },
      { kind: 'pole', at: [140, 100], height: 5, length: 2.6, width: 0.75, color: BANNER_COLORS.ochre },
      { kind: 'hang', at: [218, 6.8, 107.4], length: 3, width: 0.75, yaw: 0 },
      { kind: 'hang', at: [250, 6.8, 107.4], length: 3, width: 0.75, yaw: 0, color: BANNER_COLORS.indigo },
      { kind: 'hang', at: [243.2, 5.2, 203.9], length: 3.4, width: 0.85, yaw: -90 },
      { kind: 'hang', at: [243.2, 5.2, 213.1], length: 3.4, width: 0.85, yaw: -90 },
    ],
    // 坐像殿里漏进来的光里浮着的尘
    motes: [{ center: [210, 7, 168], size: [14, 10, 14], count: 160 }],
  },
  '1-4': {
    // 地面散布（照概念图近景）：砾石滩上一丛丛枯草和碎石、古道两道车辙 + 压暗的砾石路肩
    ground: {
      grass: { sand: 0.006, mud: 0.05, gravel: 0.05 },
      pebbles: { sand: 0.015, mud: 0.08, gravel: 0.26, stone: 0.02 },
      shoulder: { width: 2, grass: 0.1, pebbles: 0.3 },
    },
    // 鸣沙山：四面刀刃脊上一直在吹沙（这张图的招牌）；出生观景台一带不吹
    ridges: { reach: 1, opacity: 1, size: 1.25, minHeight: 15, skip: [{ at: [95, 80], r: 34 }] },
    // 烈日下沙色对沙色：向阳偏置拉满、沙带拉长一点，脊顶上那一溜才读得出来
    ridgeOptions: { lit: 0.9, stretch: 4 },
    banners: [
      // 月泉阁二层北面挂下来的三条幡（概念图首领进场看泉心）
      { kind: 'hang', at: [154.4, 5.3, 150.1], length: 3.6, width: 0.9, yaw: 0 },
      { kind: 'hang', at: [160, 5.3, 150.1], length: 3.6, width: 0.9, yaw: 0, color: BANNER_COLORS.ochre },
      { kind: 'hang', at: [165.6, 5.3, 150.1], length: 3.6, width: 0.9, yaw: 0 },
    ],
    leaves: 0xa9b54a,
    motes: [{ center: [160, 2.6, 157], size: [16, 4, 10], count: 120 }],
  },
  '1-A': {
    // 地面散布（照概念图近景）：砾石滩上一丛丛枯草和碎石、古道两道车辙 + 压暗的砾石路肩
    ground: {
      grass: { gravel: 0.08, mud: 0.06, sand: 0.03, stone: 0.01 },
      pebbles: { gravel: 0.4, mud: 0.16, sand: 0.05, stone: 0.03, road: 0.03 },
      shoulder: { width: 2.5, grass: 0.2, pebbles: 0.5 },
    },
    ridges: { minHeight: 4 },
    // 崖顶的沙从崖沿上一股股往窟檐层上漏
    falls: [
      { top: [169.5, 18.1, 106.3], out: [0.18, 0.98], width: 1.4, flow: 0.45, opacity: 0.45 },
      { top: [249, 18.1, 103.8], out: [-0.16, 0.99], width: 1.2, flow: 0.4, opacity: 0.45 },
      { top: [280.7, 18.1, 113.3], out: [-0.38, 0.92], width: 1.6, flow: 0.55, opacity: 0.5 },
    ],
    // 香烟：大佛窟前的大香炉、塔院香炉
    smoke: [
      { origin: [215, 3.4, 151], height: 14, width: 0.7, opacity: 0.5, rise: 1.2, count: 24 },
      { origin: [192, 21.4, 61.4], height: 12, width: 0.6, opacity: 0.45, rise: 1.2, count: 20 },
    ],
    smokeOptions: { low: [0.86, 0.84, 0.8], high: [0.95, 0.94, 0.92] },
    devils: [{ path: [[40, 262], [100, 272], [140, 252]], height: 22 }, { path: [[330, 262], [380, 276], [400, 250]], height: 24, phase: 0.6 }],
    drift: [{ center: [150, 228], size: [60, 24] }, { center: [305, 232], size: [52, 22] }],
    banners: [
      // 九层楼前广场两根大幡杆、塔院寺塔前两根
      { kind: 'pole', at: [200, 127], height: 10, length: 5, width: 1.1 },
      { kind: 'pole', at: [230, 127], height: 10, length: 5, width: 1.1 },
      { kind: 'pole', at: [181, 63], height: 7, length: 3.4, width: 0.85, color: BANNER_COLORS.ochre },
      { kind: 'pole', at: [203, 63], height: 7, length: 3.4, width: 0.85, color: BANNER_COLORS.ochre },
    ],
    leaves: 0xd9a531,
    motes: [{ center: [215, 14, 104.5], size: [9, 12, 5], count: 140 }],
  },
};
