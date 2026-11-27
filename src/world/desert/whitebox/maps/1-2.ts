import type { TerrainOp, V2, WbBlock, WhiteboxSpec } from '../types';

/**
 * 1-2 雅丹迷城 · 白盒（版面见 docs/art/concepts/ch1-routes/1-2_route_concept.jpg，定稿 raw/1-2_v3.png）。
 * 一片顺风（自西向东）排列的赭红雅丹岛：迎风头在西、背风尾在东，岛与岛之间是分分合合的沙河道，每隔 30–50 m 一个风口垭口。
 *   北：北河道 → 屋脊之海（下沉沙盆，古城只露屋顶）；中：中河道，轴线正对佛塔塔尖；南：南河道，经供养窟绕到岩拱门。
 *   屋脊之海和塔尖广场之间隔一道岩脊，只有一个沙垭口能过（垭口正对塔尖：从 ② 透过豁口看得见它）；
 *   东端河道收成 V 字，穿过最后一道岩墙上的岩拱就是出口平台。
 * 外圈是更高的崖壁（两级，天际线留豁口）；入场点只开在崖壁的豁口（北 ×2、南 ×2）和两处岩台的跃下点。
 * 竖向：流沙盆 −1.6 / 河道 0 / 屋顶 +0.6（比盆底高 2.2 m）/ 广场 +1 / 环台 3.6、6 / 矮丘 4.6、5 / 雅丹岛 8–20 / 外崖 18–33 / 塔座 10 / 塔尖 29.8。
 *
 * 体块全部对着已发布的沙漠件摆（src/world/desert/whitebox/assets.ts，尺寸 = 资产尺寸 × 注释里的倍数）：
 * 大岛、外崖、环台、沙坡是地形；狮身雅丹 / 佛塔 / 岩拱 / 半埋屋顶 / 残车 / 巨砾 / 祭坛都是现成的件，没有要新做的。
 */

/** 顺风的雅丹岛：xa = 迎风头（西端）、xb = 背风尾（东端）、z = 轴线、w = 半宽。flat 取大 = 四面都是陡壁（背风尾也 ≥ 60°），岛顶上不去 */
const isle = (xa: number, xb: number, z: number, w: number, h: number, o: { rot?: number; flat?: number; base?: number; asset?: string } = {}): TerrainOp => {
  const r0 = (xb - xa) / 1.4;
  return { op: 'mound', shape: 'yardang', at: [xa + r0 * 0.4, z], r: [r0, w], h, rot: o.rot ?? 0, flat: o.flat ?? 0.84, base: o.base ?? 0, mat: 'rock', asset: o.asset };
};

/** 佛塔 / 环台的圆心 */
const STUPA: V2 = [248, 190];
/** 屋顶链的走向（西 → 东略偏北），半埋的屋顶都按它转 */
const ROOF_ROT = 10.6;
/** 中小岛搭正式场景时用雅丹件沿长向连排（大岛和外崖是高度场） */
const YARDANG_M = 'SM_Tripo_DesertYardangMedium';
const YARDANG_S = 'SM_Tripo_DesertYardangSmall';

// ── 现成的件（尺寸 = 资产包围盒 × 倍数；sink = 换件时埋进地里几米）──
/** 砂岩巨砾 3.38 × 2.88 × 2.54：整块 = 全身掩体；半埋 1.83 m = 半身掩体 */
/** 半身掩体：风蚀卧石（Tripo 2026-11-27）长 / 块交替——卧石 A 3.6 × 1.0 × 1.6（低长流线形）、卧石 B 2.2 × 1.2 × 1.8（蘑菇形，埋 0.1 m 露 1.1 m）；原来是砂岩巨砾埋掉 1.8 m 只露个顶 */
let lowRockSeq = 0;
const lowRock = (at: V2, rot = 0): WbBlock => (lowRockSeq++ % 2 === 0
  ? { kind: 'box', at, size: [3.65, 1.9], h: 1.0, rot, mat: 'rock', asset: 'SM_Tripo_DesertLowRockA' }
  : { kind: 'box', at, size: [1.8, 1.6], h: 1.1, rot, mat: 'rock', asset: 'SM_Tripo_DesertLowRockB', sink: 0.1 });
const boulder = (at: V2, rot: number, half = false): WbBlock => half
  ? lowRock(at, rot)
  : { kind: 'box', at, size: [3.38, 2.54], h: 2.88, rot, mat: 'rock', asset: 'SM_Env_DesertSandstone' };
/** 半埋屋顶 · 平顶土坯房 ×1.8（6.41 × 6.48 × 6.97）：只露屋顶 */
const flatRoof = (at: V2, top: number, sink: number): WbBlock =>
  ({ kind: 'box', at, size: [6.41, 6.97], top, rot: ROOF_ROT, mat: 'earth', asset: 'SM_Tripo_DesertBuriedRoofFlat', sink });
/** 屋顶北沿的女儿墙：烽燧垛墙 1.89 × 1.1 × 0.38，三段连排 */
const parapet = (at: V2): WbBlock =>
  ({ kind: 'box', at, size: [5.67, 0.38], top: 1.7, rot: ROOF_ROT, mat: 'earth', asset: 'SM_Tripo_DesertBeaconParapet' });
/** 半埋屋顶 · 民居两坡顶 ×1.5（7.14 × 6.75 × 4.74）：露 2.4 m = 全身掩体；只露屋脊 1.05 m = 半身掩体 */
const gableRoof = (at: V2, rot: number, deep = false): WbBlock =>
  ({ kind: 'box', at, size: [7.14, 4.74], top: deep ? -0.55 : 0.8, rot, mat: 'roof', asset: 'SM_Tripo_DesertBuriedRoofHouse', sink: deep ? 5.7 : 4.35 });
/** 塔刹 2.53 × 5.5 × 2.28：半埋，露 3 m */
const finial = (at: V2): WbBlock => ({ kind: 'box', at, size: [2.53, 2.28], h: 3, mat: 'stone', asset: 'SM_Tripo_DesertFinial', sink: 2.5 });
/** 掩体矮墙 4.91 × 2.6 × 0.99：整段 = 全身；半埋 1.5 m = 半身 */
const coverWall = (at: V2, rot: number, half = false): WbBlock =>
  ({ kind: 'box', at, size: [4.91, 0.99], h: half ? 1.1 : 2.6, rot, mat: 'earth', asset: 'SM_Tripo_DesertCoverWall', ...(half ? { sink: 1.5 } : {}) });
/** 倒伏石柱 4.24 × 1.56 × 3.36，埋 0.5 m = 半身掩体 */
const fallenColumn = (at: V2, rot: number): WbBlock =>
  ({ kind: 'box', at, size: [4.24, 3.36], h: 1.06, rot, mat: 'stone', asset: 'SM_Tripo_DesertColumnRuin', sink: 0.5 });
/** 货堆 ×1.2（2.02 × 1.92 × 1.54），半埋在沙里露 1.1 m */
const goods = (at: V2, rot: number): WbBlock =>
  ({ kind: 'box', at, size: [2.02, 1.54], h: 1.1, rot, mat: 'timber', asset: 'SM_Tripo_DesertGoodsPile', sink: 0.82 });
/** 陶罐 ×1.25（1.03 × 1.05 × 0.99） */
const urn = (at: V2): WbBlock => ({ kind: 'box', at, size: [1.03, 0.99], h: 1.05, mat: 'earth', asset: 'SM_Prop_DesertUrns' });
/**
 * 岩拱 15.68 × 13 × 6.61 × s：两根岩柱（实心）+ 拱顶（悬空）。洞口宽 6 s、净高 7.5 s。
 * axis = 'x'：人沿东西向穿过（拱横在南北向）；'z'：人沿南北向穿过。
 */
const rockArch = (name: string, at: V2, s: number, axis: 'x' | 'z', landmark?: string): WbBlock[] => {
  const pillar = 4.84 * s, open = 6 * s, deep = 6.61 * s, top = 13 * s, off = (open + pillar) / 2;
  const size = (w: number): V2 => axis === 'x' ? [deep, w] : [w, deep];
  const shift = (d: number): V2 => axis === 'x' ? [at[0], at[1] + d] : [at[0] + d, at[1]];
  const base = { name, kind: 'box' as const, mat: 'rock' as const, asset: 'SM_Tripo_DesertRockArch', top };
  return [
    { ...base, at: shift(-off), size: size(pillar) },
    { ...base, at: shift(off), size: size(pillar) },
    { ...base, at, size: size(open), canopy: true, clear: 7.5 * s, ...(landmark ? { landmark } : {}) },
  ];
};

export const WB_1_2: WhiteboxSpec = {
  id: '1-2',
  name: '雅丹迷城',
  motif: '收紧',
  mood: '起风的上午，太阳在前进方向右前方：扬沙贴着河道往前流、逆光发亮，岩墙一面暖橙一面冷紫，塔尖和岩拱是沙雾里的剪影。',
  size: [400, 300],
  sun: { azimuth: 112, elevation: 33 },
  wind: [1, 0],
  terrain: [
    // 平地是砾石 / 压实的土（照构图概念图的近景：灰褐砾石地 + 枯草碎石；亮黄的沙只在沙丘、沙台上，2026-11-27 地面散布那一步改）
    { op: 'base', h: 0, mat: 'gravel' },
    { op: 'noise', amp: 0.7, scale: 42, seed: 12, keep: [{ at: [90, 160], r: 26 }, { at: [194, 88], r: 30 }, { at: [247, 180], r: 36 }, { at: [320, 144], r: 24 }, { at: [28, 159], r: 16 }, { at: [372, 142], r: 20 }] },
    // 古河床：三股辫状河道 + 一条辫流（刻下 0.4 m，颜色分得出走向）
    { op: 'channel', pts: [[40, 159], [88, 160], [130, 168], [170, 175], [212, 182]], half: 5, h: -0.4, bank: 6, mat: 'road' },
    { op: 'channel', pts: [[88, 158], [90, 130], [91, 108], [100, 94], [116, 91], [134, 86]], half: 5, h: -0.4, bank: 6, mat: 'road' },
    { op: 'channel', pts: [[42, 174], [44, 204], [62, 213], [86, 216], [102, 232], [140, 243], [190, 247], [226, 243], [250, 228], [284, 226], [302, 224], [319, 214], [320, 196], [321, 166], [326, 148], [345, 142], [360, 142]], half: 5, h: -0.4, bank: 6, mat: 'road' },
    { op: 'channel', pts: [[100, 131], [130, 130], [182, 131], [206, 134], [224, 146]], half: 4, h: -0.4, bank: 5, mat: 'road' },
    // ② 屋脊之海：下沉 1.6 m 的宽沙盆
    { op: 'poly', pts: [[134, 64], [150, 48], [180, 43], [214, 45], [236, 56], [240, 80], [236, 96], [214, 101], [170, 101], [140, 98], [131, 80]], h: -1.6, edge: 12, mode: 'min', mat: 'dune' },
    // S 河口沙扇（+3 m），向东缓缓落进河道
    { op: 'disc', at: [10, 159], r: 22, h: 3, edge: 30, mode: 'max', mat: 'dune' },
    // ③ 夯土广场（+1 m）、出口平台
    { op: 'disc', at: [246, 186], r: 32, h: 1, edge: 8, mode: 'set', mat: 'earth' },
    { op: 'poly', pts: [[353, 119], [392, 119], [392, 165], [353, 165]], h: 0.6, edge: 3, mode: 'set', mat: 'stone' },
    // ① 河心洲（砾石，+1.3 m，两头缓）
    { op: 'mound', at: [100, 169], r: [13, 5.5], h: 1.3, rot: -8, mat: 'gravel' },
    // 雅丹岛（头西尾东）。屋脊之海南缘一排：A / B / C /（沙垭口）/ C2 / 东北大岛；辫流南边一排：D / E；中、南河道之间的大岛 G（南壁有供养窟）
    isle(98, 128, 114, 9.5, 11, { asset: YARDANG_M }),
    isle(138, 176, 114, 10, 15, { base: -1.6, rot: 3 }),
    isle(184, 203, 114, 9, 11, { base: -1.6, asset: YARDANG_M }),
    isle(214, 246, 113, 11, 13),
    isle(238, 292, 112, 12, 16, { flat: 0.88 }),
    isle(136, 180, 148, 12, 14, { rot: -5, flat: 0.86 }),
    isle(190, 222, 152, 10, 10, { rot: -6, asset: YARDANG_M }),
    isle(96, 200, 206, 26, 20, { rot: -3, flat: 0.92 }),
    isle(150, 206, 205, 17, 14, { rot: -4, flat: 0.88 }),
    isle(46, 90, 196, 13, 11),
    isle(196, 226, 229, 7.5, 8, { asset: YARDANG_M }),
    isle(280, 314, 210, 9, 10, { rot: 8, asset: YARDANG_M }),
    isle(258, 308, 132, 12, 14, { rot: -4, flat: 0.88 }),
    // 两处矮鲸背丘（高路）：侧壁陡、背风尾缓，尾上再堆一道沙坡
    { op: 'mound', at: [101.4, 146], r: [18.6, 6.5], h: 4.6, shape: 'yardang', flat: 0.45, mat: 'rock', asset: YARDANG_S },
    { op: 'mound', at: [288.3, 175], r: [15.7, 6.5], h: 5, shape: 'yardang', flat: 0.45, mat: 'rock', asset: YARDANG_S },
    // ② → ③ 的岩脊（C 岛和 C2 岛之间的岩坎）+ 沙垭口：一条从沙盆爬上脊、再落到广场北口的缓沙坡，豁口正对塔尖
    { op: 'poly', pts: [[199, 103], [219, 103], [219, 126], [199, 126]], h: 6, edge: 2, mode: 'max', mat: 'rock' },
    { op: 'ramp', pts: [[197, 90], [203, 103]], hs: [-1.6, 1.2], half: 5, edge: 9, mode: 'max', mat: 'dune' },
    { op: 'ramp', pts: [[213.5, 126], [220, 142]], hs: [1.3, 0.5], half: 5, edge: 8, mode: 'max', mat: 'dune' },
    { op: 'ramp', pts: [[197, 90], [203, 103], [208.3, 115], [213.5, 126], [220, 142]], hs: [-1.6, 1.2, 2.6, 1.3, 0.5], half: 5, edge: 1.5, mode: 'set', mat: 'dune' },
    // 外圈崖壁（北 22–26 m，南 18–20 m——概念图机位从南往北看，南崖是前景）：西北 / 北 / 东北 / 西南 / 东南五段，段与段之间的缺口就是入场的豁口
    { op: 'poly', pts: [[-12, -12], [77, -12], [77, 50], [78, 76], [79, 90], [84, 100], [82, 112], [70, 118], [46, 120], [30, 124], [18, 132], [10, 140], [-12, 142]], h: 22, edge: 2.5, mode: 'max', mat: 'rock' },
    { op: 'poly', pts: [[91, -12], [91, 38], [92, 62], [98, 78], [116, 82], [130, 76], [136, 60], [140, 46], [150, 40], [164, 36], [164, -12]], h: 26, edge: 2.5, mode: 'max', mat: 'rock' },
    { op: 'poly', pts: [[178, -12], [178, 36], [200, 40], [226, 42], [242, 48], [248, 60], [250, 78], [262, 89], [300, 89], [316, 85], [328, 92], [336, 108], [360, 108], [412, 104], [412, -12]], h: 24, edge: 2.5, mode: 'max', mat: 'rock' },
    { op: 'poly', pts: [[-12, 177], [12, 177], [18, 198], [28, 216], [48, 232], [76, 239], [104, 239], [130, 252], [150, 257], [184, 257], [184, 312], [-12, 312]], h: 18, edge: 2.5, mode: 'max', mat: 'rock' },
    { op: 'poly', pts: [[196, 312], [196, 257], [206, 252], [232, 246], [272, 246], [292, 250], [310, 244], [324, 230], [326, 206], [328, 180], [346, 182], [412, 182], [412, 312]], h: 20, edge: 2.5, mode: 'max', mat: 'rock' },
    // 最后一道岩墙（17 m），中间留给岩拱的缺口（z 134.5–149.5，岩拱件的两根柱脚吃进墙里）
    { op: 'poly', pts: [[334, 104], [340.5, 134.5], [350, 134.5], [354, 116], [412, 116], [412, 100]], h: 17, edge: 1.5, mode: 'max', mat: 'rock' },
    { op: 'poly', pts: [[340.5, 149.5], [350, 149.5], [354, 168], [412, 168], [412, 186], [330, 186], [328, 172]], h: 17, edge: 1.5, mode: 'max', mat: 'rock' },
    // 岩台：屋脊之海东北角的岩肩（跃下点）、南河道东拐角的岩台（跃下点）、④ 北侧的守门岩台（俯射位）
    { op: 'poly', pts: [[238, 58], [248, 58], [252, 80], [244, 84], [238, 74]], h: 7, edge: 1.2, mode: 'max', mat: 'rock' },
    { op: 'poly', pts: [[292, 240], [308, 231], [318, 236], [314, 246], [294, 251]], h: 8, edge: 1.2, mode: 'max', mat: 'rock' },
    { op: 'poly', pts: [[319, 97], [328, 95], [335, 112], [339.5, 131], [333, 132], [327, 114]], h: 3.2, edge: 0.8, mode: 'max', mat: 'rock' },
    // 西南豁口：一条切穿崖壁的冲沟
    { op: 'channel', pts: [[44, 223], [30, 246], [14, 270], [2, 294]], half: 5, h: 0.3, bank: 2.5, mat: 'sand' },
    // 出口平台东缘：落到看得见古城的低地
    { op: 'poly', pts: [[394, 112], [412, 112], [412, 172], [394, 172]], h: -9, edge: 3, mode: 'min', mat: 'rock' },
    // 外崖第二级（28–33 m，往里退 12 m 以上）：给天际线高低和豁口
    { op: 'poly', pts: [[-12, -12], [58, -12], [62, 40], [60, 96], [30, 108], [8, 120], [-12, 122]], h: 29, edge: 3, mode: 'max', mat: 'rock' },
    { op: 'poly', pts: [[102, -12], [102, 28], [124, 40], [148, 26], [154, -12]], h: 33, edge: 3, mode: 'max', mat: 'rock' },
    { op: 'poly', pts: [[192, -12], [192, 22], [236, 30], [258, 54], [296, 72], [318, 66], [326, -12]], h: 31, edge: 3, mode: 'max', mat: 'rock' },
    { op: 'poly', pts: [[40, 312], [58, 262], [118, 268], [168, 278], [174, 312]], h: 28, edge: 3, mode: 'max', mat: 'rock' },
    { op: 'poly', pts: [[208, 312], [212, 278], [268, 276], [306, 268], [346, 216], [412, 210], [412, 312]], h: 31, edge: 3, mode: 'max', mat: 'rock' },
    // 藏宝的两处岩龛：往岩壁里凹进去 12–14 m 就到头（龛口各立一座小岩拱当门脸）
    { op: 'disc', at: [108, 75], r: 6.5, h: 0.2, edge: 1.2, mode: 'min', mat: 'sand' },
    { op: 'channel', pts: [[108, 74], [108, 88]], half: 3.2, h: 0.2, bank: 1.2, mat: 'sand' },
    { op: 'disc', at: [137, 226.5], r: 7.5, h: 0.2, edge: 1.2, mode: 'min', mat: 'sand' },
    // ② 屋顶链：一道积沙脊从沙盆西口爬上屋檐，把西边三块平顶屋连成能走的高路；第三块南檐一道沙坡下回盆底；东端一道沙坡接第五块
    { op: 'ramp', pts: [[135.05, 83.8], [146.85, 81.59], [173.2, 76.66]], hs: [-1.6, 0.3, 0.3], half: 2, edge: 6, mode: 'max', mat: 'dune' },
    { op: 'ramp', pts: [[170.5, 79.5], [174.2, 93]], hs: [0.5, -1.6], half: 3, edge: 5, mode: 'max', mat: 'dune' },
    { op: 'ramp', pts: [[201.5, 76.5], [193.6, 73]], hs: [-1.6, 0.6], half: 2.5, edge: 4, mode: 'max', mat: 'dune' },
    // ③ 两级环台（3.6 / 6 m；挡土壁用台基块 ×1.26 贴面，二层同样再叠一圈）+ 二层中央的塔座（10 m，上不去，把佛塔托到 30 m）+ 三条上一层的夯土坡道（西北、西南、东）+ 北面上二层的坡道。
    // 坡道是地形：现有台阶件是 43° 的陡梯，比「能走的坡 ≤ 30°」陡，不用它
    { op: 'disc', at: STUPA, r: 18.5, h: 3.6, edge: 0.8, mode: 'max', mat: 'stone', asset: 'SM_Tripo_DesertPlatformBlock' },
    { op: 'disc', at: STUPA, r: 13, h: 6, edge: 0.6, mode: 'max', mat: 'stone' },
    { op: 'disc', at: STUPA, r: 9.3, h: 10, edge: 0.5, mode: 'max', mat: 'stone' },
    { op: 'ramp', pts: [[236.6, 216.1], [240.8, 206.5]], hs: [1, 3.6], half: 3, mat: 'stone' },
    { op: 'ramp', pts: [[274.8, 199.75], [264.9, 196.2]], hs: [1, 3.6], half: 3, mat: 'stone' },
    { op: 'ramp', pts: [[233.75, 165.3], [239, 174.4]], hs: [1, 3.6], half: 3, mat: 'stone' },
    { op: 'ramp', pts: [[248, 173.5], [248, 179.5]], hs: [3.6, 6], half: 2.2, mat: 'stone' },
    // 矮鲸背丘的背风沙坡
    { op: 'ramp', pts: [[127, 146.4], [109.8, 146]], hs: [0, 3.84], half: 3, edge: 4, mode: 'max', mat: 'dune' },
    { op: 'ramp', pts: [[311, 175.4], [295.4, 175]], hs: [0, 4.17], half: 3, edge: 4, mode: 'max', mat: 'dune' },
    // ④ 守门岩台的坡道
    { op: 'ramp', pts: [[327, 142], [334, 128.5]], hs: [0.1, 3.2], half: 2.5, mat: 'dune' },
    // 流沙 ×3（示意）
    { op: 'paint', mat: 'mud', at: [148, 97], r: 5 },
    { op: 'paint', mat: 'mud', at: [162, 96], r: 5.5 },
    { op: 'paint', mat: 'mud', at: [181, 100], r: 5 },
  ],
  blocks: [
    // 狮身雅丹 ×1.3（12.4 × 16.9 × 22.7，头朝东守着河口，背靠西北崖）：卧着的身子 + 挺起的胸 + 头
    { name: '狮身雅丹', kind: 'box', at: [52, 128], size: [12.44, 22.71], rot: 90, top: 9.3, mat: 'rock', asset: 'SM_Tripo_DesertYardangSphinx' },
    { name: '狮身雅丹', kind: 'box', at: [58.6, 128], size: [9, 7.5], rot: 90, top: 12, mat: 'rock', asset: 'SM_Tripo_DesertYardangSphinx' },
    { name: '狮身雅丹', kind: 'box', at: [60.6, 128], size: [5, 5], rot: 90, top: 16.9, mat: 'rock', asset: 'SM_Tripo_DesertYardangSphinx', landmark: '狮身雅丹' },
    // ① 河口三叉：迷路商队的残车（×1.25）、货堆，砂岩巨砾成簇（留出东西向的跑道和往北河道的口子）
    { kind: 'box', at: [101, 156], size: [4.74, 5.04], h: 2.28, rot: 20, mat: 'timber', asset: 'SM_Tripo_DesertCaravanWreck' },
    goods([105.5, 159.5], -15),
    goods([106, 154], 30),
    boulder([78, 152], 25, true),
    boulder([84, 174], -20, true),
    boulder([99, 169], 10, true),
    boulder([75, 169], 10),
    boulder([112, 164], -30),
    // ② 屋脊之海：五块平顶屋（埋到屋檐，只露屋顶）。西三块坐在积沙脊上能走过去，东两块隔 3.8 m 要跳
    flatRoof([150, 81], 0.6, 6.18),
    flatRoof([160.03, 79.12], 0.6, 6.18),
    flatRoof([170.05, 77.25], 0.6, 6.18),
    flatRoof([180.08, 75.37], 0.7, 4.18),
    flatRoof([190.1, 73.49], 0.7, 4.18),
    parapet([149.4, 77.8]),
    parapet([159.43, 75.94]),
    parapet([169.45, 74.07]),
    // 歇山顶大殿 ×1.8（11.66 × 9.9 × 6.66）：只露檐口以上 4.4 m
    { kind: 'box', at: [207, 64], size: [11.66, 6.66], top: 2.8, rot: ROOF_ROT, mat: 'roof', asset: 'SM_Tripo_DesertBuriedRoofHall', sink: 5.5, landmark: '歇山顶大殿' },
    // 沙里冒出来的两坡顶、屋脊、塔刹（盆底的掩体）
    gableRoof([158, 63], ROOF_ROT),
    gableRoof([215, 86], -12),
    gableRoof([184, 91], 8, true),
    gableRoof([204, 80], ROOF_ROT, true),
    finial([176, 63]),
    finial([213, 96]),
    finial([152, 93]),
    // ③ 半埋佛塔 ×1.8（17 × 19.8 × 16，坐在 10 m 的塔座上，塔尖 29.8 m）：自带的两级小台 + 覆钵 + 相轮塔刹
    // 白色覆钵塔（Tripo 件 SM_Tripo_DesertWhiteStupa，2026-11-27 换掉暗色的半埋层塔，照概念图）：12.2 × 19.8 m 立在 10 m 塔座上；
    // 三段圆柱只是碰撞（方台 + 鼓座、覆钵、相轮），件按高度等比缩放
    { name: '佛塔', kind: 'cyl', at: STUPA, size: [6, 6], top: 13.6, mat: 'stone', asset: 'SM_Tripo_DesertWhiteStupa' },
    { name: '佛塔', kind: 'cyl', at: STUPA, size: [4.8, 4.8], top: 21.5, mat: 'stone', asset: 'SM_Tripo_DesertWhiteStupa' },
    { name: '佛塔', kind: 'cyl', at: STUPA, size: [1.2, 1.2], top: 29.8, mat: 'earth', asset: 'SM_Tripo_DesertWhiteStupa', landmark: '佛塔' },
    // ③ 北庭（据点场地）：残墙、倒柱、经函、陶罐、香炉
    coverWall([232, 152], 25),
    coverWall([262, 150], -10),
    coverWall([240, 150], -15, true),
    fallenColumn([256, 170], 30),
    fallenColumn([226, 160], -20),
    { kind: 'box', at: [252, 153], size: [1.52, 0.58], h: 2.46, rot: 15, mat: 'timber', asset: 'SM_Prop_DesertReliquary' },
    urn([258.6, 163.6]),
    { kind: 'box', at: [253, 170], size: [1.33, 1.16], h: 2.6, mat: 'stone', asset: 'SM_Prop_DesertIncenseBurner' },
    // ③ 南庭：残墙、倒柱、龟趺碑（概念图里环台前的废墟）
    coverWall([226, 208], 75),
    coverWall([232, 214], -20, true),
    fallenColumn([262, 212], 15),
    fallenColumn([254, 216], -25),
    { kind: 'box', at: [270, 210], size: [1.68, 2.14], h: 3.8, rot: 20, mat: 'stone', asset: 'SM_Prop_DesertStele' },
    // ④ 岩拱门 ×1.4（21.95 × 18.2 × 9.25，洞口宽 8.4、净高 10.5，人从拱下东西向穿过）；拱前的砂岩巨砾
    ...rockArch('岩拱', [345.25, 142], 1.4, 'x', '岩拱'),
    boulder([311, 137], 30, true),
    boulder([316, 161], -25, true),
    boulder([329, 153], 10, true),
    boulder([325, 133], 0, true),
    boulder([303, 158], -10),
    boulder([317, 128], 20),
    // 出口平台：祭坛 ×0.8（7.74 × 8.8 × 2.64，正面朝西对着拱洞）
    { kind: 'box', at: [384, 142], size: [7.74, 2.64], rot: -90, top: 9.4, mat: 'stone', asset: 'SM_Tripo_DesertPortalShrine', landmark: '出口祭坛' },
    // 藏宝：北河道岩龛（小岩拱 ×0.6 当龛口 + 宝藏堆）、南河道供养窟（岩拱 ×0.8 当窟口 + 经函 + 香炉）
    ...rockArch('北河道岩龛', [108, 79.6], 0.6, 'z'),
    { kind: 'box', at: [108, 71.5], size: [2.6, 1.93], h: 1.8, mat: 'timber', asset: 'SM_Tripo_DesertTreasureHoard' },
    ...rockArch('供养窟', [137, 230.5], 0.8, 'z', '供养窟'),
    { kind: 'box', at: [137, 220.8], size: [1.52, 0.58], h: 2.46, mat: 'timber', asset: 'SM_Prop_DesertReliquary' },
    { kind: 'box', at: [133.6, 223], size: [1.33, 1.16], h: 2.6, mat: 'stone', asset: 'SM_Prop_DesertIncenseBurner' },
    // 河道里的雅丹岩丘（中形）：把南河道两处宽口劈成两股；④ 北面的小岩丘
    { kind: 'box', at: [66, 222], size: [9.32, 21.02], rot: 86, h: 13.5, mat: 'rock', asset: YARDANG_M },
    { kind: 'box', at: [262, 239], size: [9.32, 21.02], rot: 94, h: 13.5, mat: 'rock', asset: YARDANG_M },
    { kind: 'box', at: [312, 110], size: [6.02, 9.18], rot: 90, h: 6.4, mat: 'rock', asset: YARDANG_S },
    // 北崖顶上的两座舰形雅丹 ×1.8（远景，天际线的记号）
    { kind: 'box', at: [128, 16], size: [8.08, 24.28], rot: 90, h: 18, mat: 'rock', asset: 'SM_Tripo_DesertYardangFleet' },
    { kind: 'box', at: [288, 46], size: [8.08, 24.28], rot: 96, h: 18, mat: 'rock', asset: 'SM_Tripo_DesertYardangFleet' },
  ],
  play: [[6, 138], [16, 131], [29, 121], [46, 117], [70, 115], [80, 110], [81, 100], [76, 90], [75, 76], [74, 46], [94, 46], [95, 62], [100, 75], [116, 79], [128, 73], [133, 58], [137, 44],
    [149, 37], [161, 33], [161, 26], [181, 26], [181, 33], [200, 37], [227, 39], [245, 46], [251, 59], [253, 77], [263, 85], [300, 87], [316, 83], [330, 90], [338, 106], [342, 132],
    [352, 132], [356, 117], [393, 116], [393, 168], [356, 167], [352, 152], [342, 152], [331, 173], [329, 206], [327, 231], [311, 247], [292, 252], [272, 249], [232, 250], [207, 255], [199, 260], [199, 274],
    [181, 274], [181, 260], [150, 260], [129, 255], [103, 243], [76, 241], [50, 235], [41.4, 242.6], [27.8, 234.2], [26, 218], [15, 199], [9, 181], [6, 180]],
  spawn: { id: 'S', name: '出生 · 河口沙扇', at: [28, 159], yaw: 92, note: '狮身雅丹旁；正前方中河道的尽头是塔尖，北河道口在狮身雅丹东侧，南河道口在右手沙扇尽头' },
  strongholds: [
    { id: '1', name: '河口三叉', at: [90, 160], r: 26, note: '2 波 10 只：河口伏击（跳鼠 ×3 + 蝎卫 ×2）→ 侧河道包抄（跳鼠 ×3 + 火浣鼠 ×2）；河心洲 + 矮岩台' },
    { id: '2', name: '屋脊之海', at: [194, 88], r: 28, note: '2 波 11 只：火浣鼠 ×3、沙魇 ×2、邪飞天 → 邪飞天、火浣鼠 ×2、蝎卫 ×2；盆底 3 处流沙，屋顶链是高路' },
    { id: '3', name: '塔尖广场', at: [246, 162], r: 28, note: '2 波 10 只含精英镇墓兽；半埋佛塔 + 两级环台（俯射位）' },
    { id: '4', name: '岩拱门', at: [320, 144], r: 24, note: '守门小队 7 只（升格 1 只精英）；北侧岩台有弩卫；穿过岩拱就是出口平台' },
  ],
  guards: [
    { id: 'G1', name: '北河道 · 岩龛前', at: [118, 93], note: '跳鼠 ×3 + 蝎卫' },
    { id: 'G2', name: '沙垭口', at: [208.3, 115], note: '蜃楼蟾 + 跳鼠 ×2 + 蝎卫' },
    { id: 'G3', name: '塔院东口', at: [286, 158], note: '跳鼠 ×2 + 沙魇 + 蝎卫' },
    { id: 'G4', name: '供养窟守军', at: [132, 242], note: '跳鼠 ×2 + 精英蝎卫（迅捷）+ 火浣鼠（守藏宝）' },
  ],
  entries: [
    { id: 'N1', name: '西北崖豁口', at: [84, 62], mode: 'walk' },
    { id: 'N2', name: '屋脊之海北缘豁口', at: [171, 40], mode: 'walk' },
    { id: 'N3', name: '东北岩肩跃下', at: [232.5, 73], mode: 'jump', from: [241, 72] },
    { id: 'N4', name: '西南冲沟', at: [39, 231], mode: 'walk' },
    { id: 'N5', name: '南崖豁口', at: [190, 261], mode: 'walk' },
    { id: 'N6', name: '东南岩台跃下', at: [300.5, 229.5], mode: 'jump', from: [304.5, 236.5] },
  ],
  caches: [
    { id: 'C1', name: '北河道岩龛 · 商队遗物', at: [108, 75.5], r: 14, note: '无守军，灵石' },
    { id: 'C2', name: '供养窟', at: [137, 224.5], r: 14, note: '有守军，灵兽封印；窟壁上是坐佛壁画（贴花，不是体块）' },
  ],
  exit: { id: 'E', name: '出口祭坛', at: [372, 142] },
  extras: [
    { id: 'P1', kind: 'perch', name: '河口矮岩台顶', at: [103, 146], note: '4.6 m，俯看 ①；东端背风沙坡上来' },
    { id: 'P2', kind: 'perch', name: '佛塔二层环台', at: [259.2, 190], note: '6 m，俯看广场四面' },
    { id: 'P3', kind: 'perch', name: '守门岩台', at: [331, 116], note: '3.2 m，守门弩卫的俯射位' },
    { id: 'P4', kind: 'perch', name: '塔院东矮丘顶', at: [290, 175], note: '5 m，俯看 ③ → ④ 的通道' },
  ],
  routes: [
    { id: 'main', name: '金线：沙扇 → ① → 北河道 → ② → 沙垭口 → ③ → ④ → 穿拱', kind: 'main', via: ['S', '1', [91, 112], 'G1', [150, 81], [170.05, 77.25], '2', 'G2', '3', 'G3', '4', [345.25, 142], 'E'] },
    { id: 'A', name: '白线 A：① 沿中河道直插 ③', kind: 'alt', via: ['1', [150, 170], [204, 178], '3'] },
    { id: 'B', name: '白线 B：南河道经供养窟 → ④', kind: 'alt', via: ['S', [40, 200], [104, 233], 'G4', [226, 243], [320, 200], '4'] },
    { id: 'H', name: '高路：① 矮岩台 → ③ 环台 → 东矮丘 → ④', kind: 'alt', via: ['1', [127, 146.4], 'P1', [127, 146.4], [204, 178], [233.75, 165.3], [232.25, 190], [274.8, 199.75], [311, 175.4], 'P4', [311, 175.4], '4'] },
  ],
  sights: [
    { from: 'S', to: '佛塔', why: '出生第一眼就看见塔尖' },
    { from: 'S', to: '狮身雅丹', why: '出生点看得见狮身雅丹' },
    { from: '1', to: '佛塔', why: '① 看得见塔尖（中河道轴线正对）' },
    { from: '2', to: '佛塔', why: '② 透过沙垭口看得见塔尖' },
    { from: '3', to: '岩拱', why: '③ 看得见岩拱' },
    { from: '4', to: '出口祭坛', why: '④ 从拱洞里看得见出口祭坛' },
  ],
  views: [
    { name: 'concept', title: '概念图机位（自南向北斜俯瞰）', eye: [200, 330, 455], look: [200, 0, 152], fov: 36 },
  ],
};
