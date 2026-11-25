import type { V2, WbBlock, WhiteboxSpec } from '../types';

/**
 * 1-4 鸣沙山月牙泉 · 旱魃（首领场）· 白盒（版面见 docs/art/concepts/ch1-routes/1-4_route_concept.jpg）。
 * 露天沙洼：一圈刀刃脊大沙山（南面最高）围住约 125 × 125 m 的盆底，盆底一弯月牙泉（凸面朝北），
 * 南岸月牙怀里是月泉阁、一排回廊、庭院和白杨林；北岸两座新月丘、一段残祠、枯木。出生在西北垭口的观景台（+16 m），之字木栈道下到北岸进场。
 * 母题是「日晒与荫蔽」：太阳在西北偏北（左上来光），影子朝东南偏南倒——遮荫物的位置和高度是玩法度量。
 * 风和日光同向：北、西两面沙山的落沙面朝里（陡），东、南两面是迎风面朝里（坡脚陡、往上放缓）；新月丘的落沙面朝泉。
 *
 * 体块照已有资产的实际尺寸摆（assets.ts；asset = 换正式件时用哪件，sink = 埋进地里几米，needs = 现有资产里没有的件）：
 *   月泉阁 = SM_Tripo_DesertCrescentPavilion × 1.2（10.24 × 13.2 × 9.16 m，正面朝北临水）。实测它的碰撞网格：台基高 1.1 m、正面石阶、
 *     一层 10 根柱（开间净宽只有 1.8–2.8 m）、二层台 5.9 m（前半露天、后半有顶）、自带的外楼梯在东沿，约 50° —— 人走不上去。
 *   回廊 = SM_Tripo_DesertCloister × 1.2（一跨 7.4 × 9 × 3.42 m，后墙实心、正面敞开）四跨连排，后墙朝北挡太阳，檐影落在南面的环线上。
 * 地形做的件：观景台木平台 + 之字木栈道 + 阁东的贴墙木梯沿用旧场景的程序化木梯件（踏板 + 立柱，不是 Tripo 件）；泉床贴 SM_Decal_DesertCrackedBed（龟裂泉床，泉干了才露）；
 *   芦苇是散布件（旧场景用程序灌丛占位，这里只涂了一圈岸色）。
 */
const WIND: V2 = [0.616, 0.788];      // 吹向东南偏南（也是日光在地面上的走向：太阳方位 322°）
const ACROSS: V2 = [0.788, -0.616];   // 垂直于风，指向东北偏东
const r1 = (v: number): number => Math.round(v * 10) / 10;

/** 月牙：北缘（外弧）和南缘（内弧）两段圆弧，凸面朝北；apexZ = 凸顶中线，width = 凸顶处宽，两尖在 (cx ± tipHalf, tipZ) */
function crescent(cx: number, apexZ: number, tipZ: number, tipHalf: number, width: number, n = 16): V2[] {
  const arc = (edgeZ: number): { c: number; r: number; a: number } => {
    const c = (tipHalf * tipHalf + tipZ * tipZ - edgeZ * edgeZ) / (2 * (tipZ - edgeZ));
    return { c, r: c - edgeZ, a: Math.atan2(tipHalf, c - tipZ) };
  };
  const outer = arc(apexZ - width / 2), inner = arc(apexZ + width / 2), pts: V2[] = [];
  for (let k = 0; k <= n; k++) {
    const t = -outer.a + 2 * outer.a * k / n;
    pts.push([r1(cx + outer.r * Math.sin(t)), r1(outer.c - outer.r * Math.cos(t))]);
  }
  for (let k = 1; k < n; k++) {
    const t = inner.a - 2 * inner.a * k / n;
    pts.push([r1(cx + inner.r * Math.sin(t)), r1(inner.c - inner.r * Math.cos(t))]);
  }
  return pts;
}

/** 从 at 顺风挪 d 米（负数 = 逆风） */
const lee = (at: V2, d: number): V2 => [r1(at[0] + WIND[0] * d), r1(at[1] + WIND[1] * d)];
/**
 * 新月丘 = 一座圆丘（迎风背，余弦剖面，最陡 h·π / 2r）在下风侧被一个圆咬掉一口：咬口的边就是弧形的落沙面（slip 米内从脊落到地），
 * 两角顺风收低。r = 圆丘半径，bite = 咬口圆的半径（圆心在丘心下风 r 米处）。
 */
function barchan(at: V2, r: number, h: number, bite: number, slip: number): WhiteboxSpec['terrain'] {
  return [
    { op: 'mound', at, r: [r, r], h, shape: 'dome', mat: 'dune' },
    { op: 'disc', at: lee(at, r), r: bite, h: 0, edge: slip, mode: 'min', mat: 'sand' },
  ];
}

const PAVILION = 'SM_Tripo_DesertCrescentPavilion', CLOISTER = 'SM_Tripo_DesertCloister', SANDSTONE = 'SM_Env_DesertSandstone';
const NEED_POPLAR = '白杨：通直灰白树干 + 柱状树冠（树冠要有碰撞、能挡日晒射线），高 11–13 m；旧场景是程序占位（树干 + 五团叶团），原计划件名 SM_Tripo_DesertPoplar';
const NEED_DEADWOOD = '胡杨枯木：主干粗壮扭曲、三四根断头粗枝、无叶，高约 5.5 m';

/** 月泉阁一层的柱（站在 1.1 m 的台基上，顶到二层台底） */
const hallCol = (x: number, z: number): WbBlock => ({ name: '月泉阁', kind: 'cyl', at: [x, z], size: [0.35, 0.35], top: 5.4, mat: 'timber', asset: PAVILION });
/** 回廊一跨（x0 = 西端）：后墙（实心，朝北）+ 二层廊板 + 单坡顶（后高前低）+ 正面三根柱 */
const cloisterBay = (k: number): WbBlock[] => {
  const x0 = 165.5 + 7.4 * k, cx = r1(x0 + 3.7), part = { name: `回廊 ${k + 1}`, asset: CLOISTER };
  return [
    { ...part, kind: 'box', at: [cx, 159.65], size: [7.4, 0.9], top: 9, mat: 'earth' },
    { ...part, kind: 'box', at: [cx, 161.35], size: [7.4, 2.5], top: 3.4, clear: 3, canopy: true, mat: 'timber' },
    { ...part, kind: 'box', at: [cx, 160.3], size: [7.4, 2.2], top: 9, clear: 8.2, canopy: true, mat: 'roof' },
    { ...part, kind: 'box', at: [cx, 161.9], size: [7.4, 1.6], top: 7.9, clear: 7.2, canopy: true, mat: 'roof' },
    ...[1.2, 3.7, 6.2].map((dx): WbBlock => ({ ...part, kind: 'cyl', at: [Math.round((x0 + dx) * 2) / 2, 161.5], size: [0.3, 0.3], top: 3, mat: 'timber' })),
  ];
};
/** 白杨：细高的干（挡路）+ 悬空的柱状树冠（只投影，不挡路） */
const poplar = (x: number, z: number, tall = 12): WbBlock[] => [
  { kind: 'cyl', at: [x, z], size: [0.45, 0.45], top: tall - 1, mat: 'plant', needs: NEED_POPLAR },
  { kind: 'cyl', at: [x, z], size: [1.7, 1.7], top: tall, clear: 3, canopy: true, mat: 'plant', needs: NEED_POPLAR },
];
/** 砂岩巨砾：整块露出 2.6 m（全身掩体），或埋掉 1.8 m 只露 1.05–1.1 m（半身） */
const boulder = (x: number, z: number, rot: number, full = false): WbBlock =>
  ({ kind: 'box', at: [x, z], size: [3.4, 2.5], h: full ? 2.6 : 1.08, rot, mat: 'rock', asset: SANDSTONE, sink: full ? 0.3 : 1.8 });
/** 掩体矮墙埋到只露 1.1 m（半身） */
const lowWall = (x: number, z: number, alongZ = false): WbBlock =>
  ({ kind: 'box', at: [x, z], size: alongZ ? [0.99, 4.91] : [4.91, 0.99], h: 1.1, mat: 'earth', asset: 'SM_Tripo_DesertCoverWall', sink: 1.5 });
const brazier = (x: number, z: number): WbBlock => ({ kind: 'cyl', at: [x, z], size: [0.65, 0.65], h: 2.4, mat: 'stone', asset: 'SM_Tripo_DesertBrazier' });
const tamarisk = (x: number, z: number, h = 2.5): WbBlock => ({ kind: 'cyl', at: [x, z], size: [0.95, 0.95], h, mat: 'plant', asset: 'SM_Env_DesertTamarisk' });

const SPRING: V2 = [160, 132];        // 月牙凸顶的中线 = 泉心（首领）
const BARCHAN_W: V2 = [141, 97.5];    // 西新月丘丘心（脊高约 7 m）
const BARCHAN_E: V2 = [187, 99];      // 东新月丘丘心（脊高约 5.6 m）
const ENTRY: V2 = [122, 112];         // 进场点 ①
/** 之字木栈道的中线和各顶点高度：观景台（16 m）→ 三跑 → 北岸 */
const STAIR: V2[] = [[95, 80], [105.5, 80], [117.5, 80], [120, 80], [120, 87.5], [117.5, 87.5], [105.5, 87.5], [103, 87.5], [103, 95], [105.5, 95], [117.5, 95], [120, 95]];
const STAIR_H = [16, 16, 10.67, 10.67, 10.67, 10.67, 5.33, 5.33, 5.33, 5.33, 0, 0];
/** 绕泉风筝环线（顺时针，从 ① 出发回到 ①）：北岸 → 东岸 → 回廊檐下 → 阁背檐下 → 白杨夹道 → 西岸 */
const LOOP: V2[] = [[138, 119], [160, 119.5], [182, 119], [199.5, 123], [209.5, 134.5], [210.5, 148], [206, 159.5], [198, 166],
  [184, 166], [160, 166], [150, 166], [137, 165.5], [125.5, 162], [116.5, 153], [112.5, 140], [113.5, 126]];

export const WB_1_4: WhiteboxSpec = {
  id: '1-4',
  name: '鸣沙山月牙泉 · 旱魃',
  motif: '首领场 · 开阔 + 日晒与荫蔽',
  mood: '烈日下的露天沙洼：四面刀刃脊的沙山一面亮一面暗，月牙泉是全画面唯一的冷色，影子就是掩体。',
  size: [320, 300],
  sun: { azimuth: 322, elevation: 46 },
  wind: WIND,
  terrain: [
    { op: 'base', h: 0, mat: 'sand' },
    { op: 'noise', amp: 0.4, scale: 45, seed: 14, keep: [{ at: [172, 172], r: 34 }, { at: ENTRY, r: 12 }] },
    // 环形沙山 · 北、西两面：落沙面朝里（slip 24 m → 47–56°，走不上去）；西北垭口（17 m）留给观景台
    { op: 'ridge', pts: [[104, 206], [84, 180], [72, 152], [72, 122], [80, 96], [90, 74], [112, 55], [140, 46], [172, 48], [200, 57], [224, 74], [240, 100]],
      h: [22, 30, 33, 30, 27, 17, 30, 35, 29, 32, 28, 22], stoss: 44, slip: 24, side: 1, taper: 22, mat: 'dune' },
    // 环形沙山 · 东、南两面：迎风面朝里（坡脚 48–58°，往上才放缓），南面 40 m 最高；落沙面朝外
    { op: 'ridge', pts: [[206, 34], [240, 50], [264, 84], [276, 120], [276, 152], [268, 190], [246, 222], [206, 242], [160, 248], [116, 242], [78, 224], [56, 192], [48, 158]],
      h: [20, 27, 30, 28, 31, 30, 34, 38, 40, 37, 33, 28, 22], stoss: 50, slip: 30, side: -1, taper: 22, mat: 'dune' },
    // 北岸两座新月丘：迎风背（西北偏北）最陡 30°，走得上去；落沙面（朝泉）60° 以上
    ...barchan(BARCHAN_W, 21, 7.2, 19, 3.6),
    ...barchan(BARCHAN_E, 17.5, 5.6, 15.8, 2.9),
    // 观景台 + 之字木栈道（三跑，每跑 12 m 降 5.33 m = 24°，拐角各留 2.5 m 平台）—— 程序化木梯件；栈道下面先垫一道跟着它折的沙埂（跑与跑之间是陡坎，不留能横穿的缓坡）
    { op: 'ramp', pts: STAIR, hs: STAIR_H, half: 3.2, edge: 3, mode: 'max', mat: 'dune' },
    { op: 'disc', at: [93, 77], r: 8.5, h: 16, edge: 0, mode: 'set', mat: 'timber' },
    { op: 'ramp', pts: STAIR, hs: STAIR_H, half: 2.5, mat: 'timber' },
    // 月牙泉：芦苇岸 → 泉床挖到 −1.4 m（岸坡 5 m，蹚得下去）。水线约在挖槽外 2 m：尖到尖约 67 m、最宽约 13 m
    { op: 'paint', mat: 'plant', closed: true, pts: crescent(SPRING[0], SPRING[1], 149.6, 36.4, 17.6) },
    { op: 'poly', pts: crescent(SPRING[0], SPRING[1], 146.6, 31.6, 8.8), h: -1.4, edge: 5, mode: 'min', mat: 'mud' },
    // 月泉阁 · 回廊 · 庭院：一整片铺地；阁的台基 1.1 m + 正面（北）石阶（都是月泉阁那件资产自带的）
    { op: 'poly', pts: [[153.5, 152], [196.5, 152], [196.5, 163], [198, 163], [198, 191], [152, 191], [152, 163], [153.5, 163]], h: 0, edge: 2, mode: 'set', mat: 'stone' },
    { op: 'poly', pts: [[154.9, 155], [165.1, 155], [165.1, 162.4], [154.9, 162.4]], h: 1.1, edge: 0, mode: 'set', mat: 'stone' },
    { op: 'ramp', pts: [[160, 153], [160, 155], [160, 155.8]], hs: [0, 1.1, 1.1], half: 2.25, mat: 'stone' },
    // 上二层台的木梯：贴着回廊后墙，自东向西 11.8 m 上 5.9 m（27°，宽 3 m），接在阁自带楼梯的梯口 —— 程序化木梯件（阁自带的那道 50° 上不去）
    { op: 'ramp', pts: [[176.5, 157.5], [164.7, 157.5], [164, 157.5]], hs: [0, 5.9, 5.9], half: 1.5, mat: 'timber' },
    // 环线的硬沙路、栈道落地到 ① 的木板路
    { op: 'paint', mat: 'road', half: 3, pts: [ENTRY, ...LOOP.slice(0, 8)] },
    { op: 'paint', mat: 'road', half: 3, pts: [...LOOP.slice(10), ENTRY] },
    { op: 'paint', mat: 'timber', half: 2, pts: [[120, 95], ENTRY] },
  ],
  blocks: [
    // 观景台（补给营）：货摊、货堆、碑、台沿一对火盆（梯口北侧一个、南沿一个，都让开出生点看泉和阁的视线）
    { kind: 'box', at: [88.5, 74.5], size: [3.7, 2.2], h: 3.6, rot: 30, mat: 'roof', asset: 'SM_Tripo_DesertMarketStall', landmark: '观景台' },
    { kind: 'box', at: [92.5, 71], size: [1.68, 1.28], h: 1.6, rot: 15, mat: 'timber', asset: 'SM_Tripo_DesertGoodsPile' },
    { kind: 'box', at: [88, 81.5], size: [1.68, 2.14], h: 3.8, rot: -40, mat: 'stone', asset: 'SM_Prop_DesertStele' },
    brazier(100.3, 76.3), brazier(94, 85.3),

    // 月泉阁（一件资产的几个部分）：一层柱、二层台板、后半（南）屋顶、二层台东北角的站位（白盒只有一层行走面：用实心块代替「台面能站」）
    ...([[156, 156], [158.5, 156], [161.5, 156], [156, 158.5], [163.5, 159.5], [156, 161], [158.5, 161], [161.5, 161], [163.5, 161]] as V2[]).map(p => hallCol(p[0], p[1])),
    { name: '月泉阁', kind: 'box', at: [159.95, 158.4], size: [9.3, 6.4], top: 5.9, clear: 5.4, canopy: true, mat: 'timber', asset: PAVILION },
    { name: '月泉阁', kind: 'box', at: [160, 160.3], size: [10.2, 4.6], top: 13.2, clear: 9, canopy: true, mat: 'roof', asset: PAVILION, sink: 1.1, landmark: '月泉阁' },
    { name: '月泉阁', kind: 'box', at: [163.2, 157.3], size: [2.8, 3.4], top: 5.9, mat: 'timber', asset: PAVILION },
    ...([[156, 158.5], [160, 158.5], [163.5, 158.5], [156, 161], [160, 161], [163.5, 161]] as V2[]).map((p): WbBlock => ({ name: '月泉阁', kind: 'cyl', at: p, size: [0.3, 0.3], top: 9.2, clear: 5.9, canopy: true, mat: 'timber', asset: PAVILION })),
    brazier(155.5, 152.5), brazier(164.5, 152.5),

    // 回廊：四跨连排，接在阁的东侧；后墙朝北（挡太阳、也挡旱魃的日轮），正面朝南对着庭院
    ...[0, 1, 2, 3].flatMap(cloisterBay),

    // 庭院：出口祭坛（胜利后升起）、龟趺碑一对、香炉一对、南沿两段半身矮墙
    { kind: 'box', at: [160, 186.6], size: [7.7, 2.6], h: 8.8, mat: 'stone', asset: 'SM_Tripo_DesertPortalShrine', landmark: '出口祭坛' },
    { kind: 'box', at: [152.5, 177], size: [1.68, 2.14], h: 3.8, mat: 'stone', asset: 'SM_Prop_DesertStele' },
    { kind: 'box', at: [167.5, 177], size: [1.68, 2.14], h: 3.8, mat: 'stone', asset: 'SM_Prop_DesertStele' },
    { kind: 'box', at: [156, 172], size: [1.33, 1.16], h: 2.6, mat: 'stone', asset: 'SM_Prop_DesertIncenseBurner' },
    { kind: 'box', at: [164, 172], size: [1.33, 1.16], h: 2.6, mat: 'stone', asset: 'SM_Prop_DesertIncenseBurner' },
    lowWall(171.5, 189.6), lowWall(176.4, 189.6), lowWall(183.5, 189.6), lowWall(188.4, 189.6),

    // 白杨林（要新做的件）：阁西的夹道（两排之间净宽约 9 m，环线走中间）+ 西南一片 + 回廊东头三棵
    ...poplar(149, 161), ...poplar(144.5, 160.5, 13), ...poplar(139.5, 161), ...poplar(134.5, 159.5, 13), ...poplar(130, 157.5, 11),
    ...poplar(146.5, 155.5, 11), ...poplar(141.5, 155), ...poplar(136, 154, 11),
    ...poplar(149.5, 171), ...poplar(144.5, 171.5, 13), ...poplar(139.5, 171), ...poplar(134, 170.5, 13), ...poplar(128.5, 169.5, 11),
    ...poplar(147, 176.5, 13), ...poplar(141.5, 177.5), ...poplar(135.5, 176.5, 11), ...poplar(130, 175),
    ...poplar(144, 183), ...poplar(138, 183.5, 13), ...poplar(132, 181.5, 11),
    ...poplar(202, 170.5, 13), ...poplar(205.5, 177), ...poplar(201, 183.5, 11),

    // 北岸残祠：西北角的残屋和院墙还立着（3.2–4.3 m，浅影），东半只剩半身矮墙；山门一座
    { kind: 'box', at: [158.4, 80.6], size: [4.82, 1.63], h: 4.31, mat: 'earth', asset: 'SM_Env_DesertRuin' },
    { kind: 'box', at: [163.3, 80.6], size: [4.87, 0.99], h: 3.2, mat: 'earth', asset: 'SM_Tripo_DesertPosthouseWall' },
    { kind: 'box', at: [156.3, 84], size: [0.99, 4.87], h: 3.2, mat: 'earth', asset: 'SM_Tripo_DesertPosthouseWall' },
    lowWall(168.2, 80.6), lowWall(170.2, 84.2, true),
    { name: '残祠山门', kind: 'box', at: [160.2, 89], size: [0.9, 0.87], h: 4.2, mat: 'timber', asset: 'SM_Env_DesertGate' },
    { name: '残祠山门', kind: 'box', at: [166, 89], size: [0.9, 0.87], h: 4.2, mat: 'timber', asset: 'SM_Env_DesertGate' },
    { name: '残祠山门', kind: 'box', at: [163.1, 89], size: [6.76, 0.87], top: 4.2, clear: 3.3, canopy: true, mat: 'timber', asset: 'SM_Env_DesertGate' },
    // 北岸枯木（和 1-1 干河床边的胡杨枯木是同一件）、东北坡脚半埋的驼队残车
    { kind: 'cyl', at: [150, 79.5], size: [0.45, 0.45], h: 5, mat: 'plant', needs: NEED_DEADWOOD },
    { kind: 'cyl', at: [175, 80.5], size: [0.45, 0.45], h: 5.5, mat: 'plant', needs: NEED_DEADWOOD },
    { kind: 'cyl', at: [206.5, 111], size: [0.45, 0.45], h: 5, mat: 'plant', needs: NEED_DEADWOOD },
    { kind: 'cyl', at: [202, 99.5], size: [0.45, 0.45], h: 4.5, mat: 'plant', needs: NEED_DEADWOOD },
    { kind: 'box', at: [209, 104], size: [3.79, 4.03], h: 1.2, rot: 35, mat: 'timber', asset: 'SM_Tripo_DesertCaravanWreck', sink: 0.6 },

    // 东、西两岸坡脚的砂岩堆（环线外侧的掩体：半身 + 一块全身）
    boulder(101.5, 150, 20, true), boulder(104, 156.5, -10), boulder(100.5, 161.5, -15), boulder(103.5, 145, 35),
    boulder(219.5, 139, -20, true), boulder(218, 146, 30), boulder(221, 151.5, 10), boulder(218.5, 117, -25),
    // 红柳：泉两角和南岸（高灌木，软掩体）
    tamarisk(122.5, 151), tamarisk(121, 143.5, 2.8), tamarisk(197.5, 151), tamarisk(199, 143.5, 2.8), tamarisk(148, 148.5), tamarisk(172, 148.5, 2.8),
  ],
  water: [{ pts: crescent(SPRING[0], SPRING[1], 148.4, 34.6, 14), level: -0.85 }],
  play: [[98, 214], [86, 181], [74, 152], [74, 122], [81.5, 96.5], [82.5, 82], [84, 71], [91, 66], [101, 67.5], [113, 57], [140, 48], [172, 50], [199.5, 59],
    [222.5, 75.5], [260, 90], [273, 121], [273, 152], [265, 188.5], [244, 219.5], [205, 239], [160, 245], [117, 239], [96, 228]],
  spawn: { id: 'S', name: '出生 · 观景台', at: [95.5, 81.5], yaw: 136 },
  strongholds: [
    { id: '1', name: '进场 · 北岸', at: ENTRY, r: 20, note: '木栈道落地；往前几步进圈，旱魃自泉心升起' },
  ],
  guards: [],
  entries: [
    { id: 'N1', name: '北脊滑沙 · 残祠背后', at: [164, 75.5], mode: 'walk' },
    { id: 'N2', name: '东脊滑沙', at: [221, 128], mode: 'walk' },
    { id: 'N3', name: '西南脊滑沙 · 白杨林外', at: [118, 178], mode: 'walk' },
    { id: 'N4', name: '西脊滑沙 · 砂岩堆', at: [101, 138], mode: 'walk' },
  ],
  caches: [],
  exit: { id: 'E', name: '胜利后的出口 · 月泉阁庭院', at: [160, 180] },
  extras: [
    { id: 'K', kind: 'camp', name: '观景台补给营（安全区）', at: [89.5, 76.5] },
    { id: 'B', kind: 'boss', name: '旱魃 · 泉心', at: SPRING, note: '站在水里：水深约 0.55 m，蹚得到；二阶段泉水吸干，露出 −1.4 m 的泉床' },
    { id: 'M1', kind: 'summon', name: '沙魇召唤 · 北岸', at: [162, 107] },
    { id: 'M2', kind: 'summon', name: '沙魇召唤 · 西岸', at: [117, 137] },
    { id: 'M3', kind: 'summon', name: '沙魇召唤 · 东岸', at: [204, 137] },
    { id: 'M4', kind: 'summon', name: '沙魇召唤 · 东南岸', at: [190, 152] },
    { id: 'P1', kind: 'perch', name: '西新月丘顶（7 m）', at: lee(BARCHAN_W, -3) },
    { id: 'P2', kind: 'perch', name: '东新月丘顶（5.5 m）', at: lee(BARCHAN_E, -2.6) },
    { id: 'P3', kind: 'perch', name: '月泉阁二层台（+5.9 m，前半露天）', at: [163.2, 157.3] },
    { id: 'H1', kind: 'shade', name: '阁内敞厅（深影）', at: [159.5, 158.5] },
    { id: 'H2', kind: 'shade', name: '回廊檐下（深影）', at: [182, 163.2] },
    { id: 'H3', kind: 'shade', name: '西新月丘背阴脚（浅影）', at: lee(BARCHAN_W, 2.5) },
    { id: 'H4', kind: 'shade', name: '东新月丘背阴脚（浅影）', at: lee(BARCHAN_E, 2.1) },
    { id: 'H5', kind: 'shade', name: '白杨夹道（树影）', at: [141.5, 165.5] },
    { id: 'H6', kind: 'shade', name: '北岸残祠墙角（浅影）', at: [157.8, 82.3] },
  ],
  routes: [
    { id: 'loop', name: '绕泉风筝环线', kind: 'main', via: ['1', ...LOOP, '1'], note: '南段贴着回廊和阁背的檐影走，再穿白杨夹道' },
    { id: 'in', name: '进场：观景台 → 之字栈道 → ① → 泉北岸', kind: 'alt', via: ['S', [120, 80], [120, 87.5], [103, 87.5], [103, 95], [120, 95], '1', [158, 122]] },
    { id: 'a', name: '① → 西新月丘顶（迎风背上去）', kind: 'alt', via: ['1', 'P1'] },
    { id: 'b', name: '北岸 → 西新月丘背阴脚', kind: 'alt', via: [[146, 119], 'H3'] },
    { id: 'c', name: '北岸 → 山门 → 残祠墙角', kind: 'alt', via: [[160, 119.5], 'M1', [163, 91], 'H6'] },
    { id: 'd', name: '北岸 → 东新月丘背阴脚', kind: 'alt', via: [[190, 119], 'H4'] },
    { id: 'e', name: '北岸 → 东新月丘顶（从西角的缓背上去）', kind: 'alt', via: [[172, 119], 'P2'] },
    { id: 'f', name: '东岸 → 回廊背后的木梯 → 阁二层台', kind: 'alt', via: [[206, 159.5], [196.5, 154.5], [179, 157.5], 'P3'] },
    { id: 'g', name: '环线 → 庭院出口 → 回廊檐下', kind: 'alt', via: [[160, 166], 'E', 'H2'] },
    { id: 'h', name: '西岸 → 白杨夹道树影', kind: 'alt', via: [[116.5, 153], 'H5'] },
    { id: 'i', name: '白杨夹道 → 阁正面石阶 → 敞厅', kind: 'alt', via: [[150, 166], [152, 153.5], [160, 152], 'H1'] },
    { id: 'w', name: '① → 蹚水到泉心', kind: 'alt', via: ['1', 'B'] },
  ],
  sights: [
    { from: 'S', to: '月泉阁', why: '出生第一眼（观景台）看得见月泉阁' },
    { from: 'S', to: 'B', why: '观景台俯瞰泉心' },
    { from: '1', to: 'B', why: '进场点看得见首领' },
    { from: '1', to: '月泉阁', why: '进场点隔着泉看得见月泉阁' },
    { from: 'P1', to: 'B', why: '西新月丘顶俯射泉心' },
    { from: 'P2', to: 'B', why: '东新月丘顶俯射泉心' },
    { from: 'P3', to: 'B', why: '阁二层台俯射泉心' },
  ],
  views: [
    { name: 'concept', title: '概念图机位（自南向北斜俯瞰）', eye: [160, 140, 275], look: [160, 0, 140], fov: 42 },
  ],
};
