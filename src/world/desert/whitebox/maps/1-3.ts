import type { V2, WbBlock, WhiteboxSpec } from '../types';

/**
 * 1-3 沉沙古城 · 白盒（版面见 docs/art/concepts/ch1-routes/1-3_route_concept.jpg）。
 * 一座不规则圆角的夯土城，西北三分之一被巨型横沙丘压住：沙从两座残门楼之间灌进城（① 灌沙城门），
 * 西坊被埋到屋檐（屋顶沙台 +4 m），北墙西头和西墙北头被沙漫过（从沙上直接走上墙头 +8 m）。
 * 三层并行：墙头 +8（北墙 → 东墙，三条马道下沙台、一条马道下集市）/ 屋顶沙台 +4（北排店铺背后、西坊埋屋）/ 街面 0。
 * 长街自西向东再折向东南进下沉的集市井台（−2 m），穿门楼进寺院前庭，绕过寺塔到塔后塌坑，沿坑壁坡道下到 −10 m 的暗渠口。
 * 风从西北来：沙丘在西北，落沙朝东南（朝城里）。
 *
 * 体块按已发布的沙漠件摆（assets.ts）：尺寸 = 资产包围盒 × 整体缩放，asset 字段写换哪件；
 * 一件资产拆成几块的（门墩 + 门楣、回廊后墙 + 楼板）用同一个 name。
 */
const WALL_TOP = 8;
const ROOF = 4;

/** 城墙中线（三段：西北残门东侧 → 北墙 → 东墙豁口北；豁口南 → 南门东；南门西 → 西墙 → 西北残门西侧） */
const WALL_NE: V2[] = [[140, 100], [176, 86], [214, 79], [250, 77], [288, 83], [322, 102], [334, 142], [338, 184], [338, 197]];
const WALL_SE: V2[] = [[338, 215], [334, 258], [318, 294], [270, 305], [222, 309], [184, 309]];
const WALL_SW: V2[] = [[170, 309], [130, 303], [102, 284], [90, 242], [84, 200], [88, 160], [112, 120]];
const flat = (pts: V2[], h: number): number[] => pts.map(() => h);

/** 圆弧上的点：角度 0 = 东、90 = 南（z 向南） */
const arc = (c: V2, r: number, a0: number, a1: number, n: number): V2[] =>
  Array.from({ length: n + 1 }, (_, i): V2 => {
    const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
    return [Math.round((c[0] + Math.cos(a) * r) * 10) / 10, Math.round((c[1] + Math.sin(a) * r) * 10) / 10];
  });

/** 塌坑：坑口西南的平台（头 20° 是平的）→ 贴坑壁顺着南、东两面绕下去（140°，约 37 m 降 10 m ≈ 15°，9 m 宽） */
const PIT: V2 = [284, 258];
const PIT_ARC = arc(PIT, 15, 150, -10, 8);
const PIT_RAMP: V2[] = [[258, 268], ...PIT_ARC];
const PIT_RAMP_H = [0, ...PIT_ARC.map((_, i) => -10 * Math.max(0, i - 1) / (PIT_ARC.length - 2))];

// ───────────── 已有资产 → 体块 ─────────────
let seq = 0;
const uid = (p: string): string => `${p}${++seq}`;
/** 体块自己的 (dx, dz) 转到世界坐标（rot 俯视逆时针，和 WbBlock.rot 一致） */
const off = (at: V2, rot: number, dx: number, dz: number): V2 => {
  const a = rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [Math.round((at[0] + dx * c + dz * s) * 100) / 100, Math.round((at[1] - dx * s + dz * c) * 100) / 100];
};
/** 沿长向连排 n 件：每件一个体块（换件时一对一） */
const row = (b: WbBlock, n: number): WbBlock[] =>
  Array.from({ length: n }, (_, i) => ({ ...b, at: off(b.at, b.rot ?? 0, (i - (n - 1) / 2) * b.size[0], 0) }));

/** 二层店铺楼 ShopHouse（6.32 × 8 × 3.09）：n 座沿街连排，整体放大 s 倍（进深浅，建议 1.3 倍） */
const shops = (at: V2, n: number, s: number, rot = 0): WbBlock[] =>
  row({ kind: 'box', at, size: [6.32 * s, 3.09 * s], top: 8 * s, rot, mat: 'timber', asset: 'SM_Tripo_DesertShopHouse' }, n);
/**
 * 平顶土坯房 BuriedRoofFlat（3.56 × 3.6 × 3.87，放大 1.8 倍：屋面 3.6 m、屋顶小间 6.5 m）。
 * roof 给了 = 埋到屋檐，屋面在这个高度（比沙面高一脚，走得上去；小间是屋顶上的全身掩体）；不给 = 立在街面上。
 */
const flatHouse = (at: V2, rot = 0, roof?: number): WbBlock[] => {
  const name = uid('平顶屋'), asset = 'SM_Tripo_DesertBuriedRoofFlat', hut = off(at, rot, -1.5, -1.7);
  return roof === undefined
    ? [{ name, asset, kind: 'box', at, size: [6.4, 7], h: 3.6, rot, mat: 'mud' }, { name, asset, kind: 'box', at: hut, size: [3, 3.2], h: 6.48, rot, mat: 'mud' }]
    : [{ name, asset, kind: 'box', at, size: [6.4, 7], top: roof, rot, mat: 'earth', sink: 3.3 }, { name, asset, kind: 'box', at: hut, size: [3, 3.2], top: roof + 2.88, rot, mat: 'mud', sink: 3.3 }];
};
/** 两坡顶民居 BuriedRoofHouse（4.76 × 4.5 × 3.16）× s，往沙里埋 sink 米 */
const gable = (at: V2, rot = 0, s = 1.6, sink = 0): WbBlock =>
  ({ kind: 'box', at, size: [4.76 * s, 3.16 * s], h: 4.5 * s - sink, rot, mat: 'mud', asset: 'SM_Tripo_DesertBuriedRoofHouse', ...(sink ? { sink } : {}) });
/** 歇山顶殿堂 BuriedRoofHall（6.48 × 5.5 × 3.7）× s，往沙里埋 sink 米 */
const hall = (at: V2, rot = 0, s = 1.5, sink = 0): WbBlock =>
  ({ kind: 'box', at, size: [6.48 * s, 3.7 * s], h: 5.5 * s - sink, rot, mat: 'mud', asset: 'SM_Tripo_DesertBuriedRoofHall', ...(sink ? { sink } : {}) });
/** 城墙角楼 CornerTower（7.39 × 13 × 5.25）× s；sink = 被墙芯 / 沙埋住的高度 */
const tower = (at: V2, s = 1, rot = 0, sink = 0): WbBlock =>
  ({ kind: 'box', at, size: [7.39 * s, 5.25 * s], top: 13 * s, rot, mat: 'earth', asset: 'SM_Tripo_DesertCornerTower', ...(sink ? { sink } : {}) });
/** 城门 / 门楼 Gateway（13.52 × 11 × 4.01）× s：两座门墩实心，门洞上方悬空 */
const gateway = (name: string, at: V2, s: number, rot: number): WbBlock[] => {
  const asset = 'SM_Tripo_DesertGateway', W = 13.52 * s, D = 4.01 * s, H = 11 * s, pier = 3 * s;
  return [
    { name, asset, kind: 'box', at: off(at, rot, -(W - pier) / 2, 0), size: [pier, D], top: H, rot, mat: 'earth' },
    { name, asset, kind: 'box', at: off(at, rot, (W - pier) / 2, 0), size: [pier, D], top: H, rot, mat: 'earth' },
    { name, asset, kind: 'box', at, size: [W, D], top: H, clear: H * 0.55, rot, canopy: true, mat: 'roof', landmark: name },
  ];
};
/**
 * 二层回廊一跨 Cloister（6.17 × 7.5 × 2.85，放大 1.2 倍 = 7.4 × 9 × 3.42），沿长向连排：后墙实心，廊下能走。
 * rot 0 = 敞开的一面朝南，90 = 朝东，−90 = 朝西
 */
const cloister = (at: V2, rot: number): WbBlock[] => {
  const name = uid('回廊'), asset = 'SM_Tripo_DesertCloister', L = 7.4, D = 3.42, H = 9;
  return [
    { name, asset, kind: 'box', at: off(at, rot, 0, -(D / 2 - 0.4)), size: [L, 0.8], top: H, rot, mat: 'earth' },
    { name, asset, kind: 'cyl', at: off(at, rot, -L / 2, D / 2 - 0.3), size: [0.3, 0.3], top: H, mat: 'timber' },
    { name, asset, kind: 'cyl', at: off(at, rot, L / 2, D / 2 - 0.3), size: [0.3, 0.3], top: H, mat: 'timber' },
    { name, asset, kind: 'box', at, size: [L, D], top: 3.9, clear: 3.6, rot, canopy: true, mat: 'timber' },
    { name, asset, kind: 'box', at, size: [L, D + 0.6], top: H, clear: H - 0.5, rot, canopy: true, mat: 'roof' },
  ];
};
/** 院墙 PosthouseWall（4.87 × 3.2 × 0.99）× s，n 段连排成一道（一个体块） */
const yardWall = (at: V2, n: number, s: number, rot = 0): WbBlock =>
  ({ kind: 'box', at, size: [4.87 * s * n, 0.99 * s], h: 3.2 * s, rot, mat: 'earth', asset: 'SM_Tripo_DesertPosthouseWall' });
/** 墙头垛墙 BeaconParapet（1.89 × 1.1 × 0.38），n 件连排成一道（一个体块） */
const parapet = (at: V2, n: number, rot: number): WbBlock =>
  ({ kind: 'box', at, size: [1.89 * n, 0.4], top: WALL_TOP + 1.1, rot, mat: 'earth', asset: 'SM_Tripo_DesertBeaconParapet' });
/** 货摊 MarketStall（3.7 × 3.6 × 2.2）：柜台实心（半身掩体）+ 篷布悬空 */
const stall = (at: V2, rot = 0): WbBlock[] => {
  const name = uid('货摊'), asset = 'SM_Tripo_DesertMarketStall';
  return [
    { name, asset, kind: 'box', at, size: [3.7, 1.4], h: 1.05, rot, mat: 'timber' },
    { name, asset, kind: 'box', at, size: [3.7, 2.2], h: 3.6, rot, canopy: true, mat: 'plant' },
  ];
};
/** 拒马 Barricade（4.77 × 1.2 × 1.18）：半身 */
const barricade = (at: V2, rot = 0): WbBlock => ({ kind: 'box', at, size: [4.77, 1.18], h: 1.1, rot, mat: 'timber', asset: 'SM_Tripo_DesertBarricade', sink: 0.1 });
/** 货堆 GoodsPile（1.68 × 1.6 × 1.28）：半埋 0.5 m 是半身；放大 1.5 倍是全身 */
const goods = (at: V2, rot = 0, full = false): WbBlock => full
  ? { kind: 'box', at, size: [2.52, 1.92], h: 2.4, rot, mat: 'timber', asset: 'SM_Tripo_DesertGoodsPile' }
  : { kind: 'box', at, size: [1.68, 1.28], h: 1.1, rot, mat: 'timber', asset: 'SM_Tripo_DesertGoodsPile', sink: 0.5 };
/** 掩体矮墙 CoverWall（4.91 × 2.6 × 0.99）：埋 1.55 m 是半身；整段立着是全身 */
const coverWall = (at: V2, rot = 0, full = false): WbBlock => full
  ? { kind: 'box', at, size: [4.91, 0.99], h: 2.6, rot, mat: 'earth', asset: 'SM_Tripo_DesertCoverWall' }
  : { kind: 'box', at, size: [4.91, 0.99], h: 1.05, rot, mat: 'earth', asset: 'SM_Tripo_DesertCoverWall', sink: 1.55 };
/** 倒伏石柱 ColumnRuin（4.24 × 1.56 × 3.36）：埋 0.5 m，半身 */
const columnRuin = (at: V2, rot = 0): WbBlock => ({ kind: 'box', at, size: [4.24, 3.36], h: 1.06, rot, mat: 'stone', asset: 'SM_Tripo_DesertColumnRuin', sink: 0.5 });
/** 驼队残车 CaravanWreck（3.79 × 1.82 × 4.03）：埋 0.75 m 是半身；放大 1.3 倍是全身 */
const wreck = (at: V2, rot = 0, full = false): WbBlock => full
  ? { kind: 'box', at, size: [4.93, 5.24], h: 2.37, rot, mat: 'timber', asset: 'SM_Tripo_DesertCaravanWreck' }
  : { kind: 'box', at, size: [3.79, 4.03], h: 1.07, rot, mat: 'timber', asset: 'SM_Tripo_DesertCaravanWreck', sink: 0.75 };
/** 砂岩巨砾 Sandstone（3.38 × 2.88 × 2.54）：整块全身；埋 1.78 m 是半身 */
const boulder = (at: V2, rot = 0, full = false): WbBlock => full
  ? { kind: 'box', at, size: [3.38, 2.54], h: 2.88, rot, mat: 'rock', asset: 'SM_Env_DesertSandstone' }
  : { kind: 'box', at, size: [3.38, 2.54], h: 1.1, rot, mat: 'rock', asset: 'SM_Env_DesertSandstone', sink: 1.78 };
/** 香炉 IncenseBurner（1.33 × 2.6 × 1.16）、火盆 Brazier（1.32 × 2.4 × 1.2）、红柳 Tamarisk（1.72 × 2.27 × 2.02，放大 1.5 倍） */
const burner = (at: V2): WbBlock => ({ kind: 'cyl', at, size: [0.65, 0.65], h: 2.6, mat: 'stone', asset: 'SM_Prop_DesertIncenseBurner' });
const brazier = (at: V2): WbBlock => ({ kind: 'cyl', at, size: [0.65, 0.65], h: 2.4, mat: 'rock', asset: 'SM_Tripo_DesertBrazier' });
const tamarisk = (at: V2): WbBlock => ({ kind: 'cyl', at, size: [1.3, 1.3], h: 3.4, mat: 'plant', asset: 'SM_Env_DesertTamarisk' });
/** 龟趺碑 Stele（1.68 × 3.8 × 2.14）：全身 */
const stele = (at: V2, rot = 0): WbBlock => ({ kind: 'box', at, size: [1.68, 2.14], h: 3.8, rot, mat: 'stone', asset: 'SM_Prop_DesertStele' });

const PAGODA = 'SM_Tripo_DesertTemplePagoda', WELL = 'SM_Tripo_DesertWell', SHRINE = 'SM_Tripo_DesertPortalShrine';
/** 寺塔的层檐（悬空，只画不挡路） */
const eave = (size: number, top: number): WbBlock => ({ name: '寺塔', asset: PAGODA, kind: 'box', at: [230, 246], size: [size, size], top, clear: top - 0.5, canopy: true, mat: 'roof' });

export const WB_1_3: WhiteboxSpec = {
  id: '1-3',
  name: '沉沙古城',
  motif: '城市 · 三层并行',
  mood: '午后高日：街巷里是又深又冷的影，沙瀑从墙头倾进城里发亮；寺塔始终立在天际线上。',
  size: [400, 360],
  sun: { azimuth: 238, elevation: 52 },
  wind: [0.71, 0.71],
  terrain: [
    { op: 'base', h: 0, mat: 'sand' },
    { op: 'noise', amp: 1.4, scale: 60, seed: 13 },
    // 城外远丘：只管天际线（落沙面朝东南）
    { op: 'ridge', pts: [[226, 28], [290, 18], [352, 32]], h: [8, 13, 9], stoss: 30, side: 1, mat: 'dune' },
    { op: 'ridge', pts: [[386, 66], [393, 150], [385, 236], [391, 322]], h: [9, 13, 10, 12], stoss: 26, side: -1, mat: 'dune' },
    { op: 'ridge', pts: [[56, 348], [170, 353], [290, 347], [372, 351]], h: [8, 11, 12, 8], stoss: 22, side: 1, mat: 'dune' },
    { op: 'ridge', pts: [[30, 334], [24, 262], [34, 206]], h: [8, 12, 7], stoss: 24, side: 1, mat: 'dune' },
    // 城内铺平
    { op: 'poly', pts: [...WALL_NE, ...WALL_SE, ...WALL_SW], h: 0, edge: 8, mode: 'set', mat: 'sand' },
    // 干壕（东、南、西南三面，城墙外 20 m）
    { op: 'channel', pts: [[352, 92], [358, 142], [362, 200], [356, 262], [338, 306], [276, 326], [222, 330], [128, 324], [86, 300], [68, 246], [62, 204]], half: 4, h: -2.5, bank: 6, mat: 'gravel' },
    // 巨型横沙丘：丘顶在城外西北（出生点），东南坡穿过残门漫进城里，扇脚落在长街西口（最陡 ≈ 13°）
    { op: 'mound', at: [104, 76], r: [150, 90], rot: 45, h: 13, mat: 'dune' },
    // 西坊：沙埋到屋檐的沙台（+4），东、南两面是沙堆坡
    { op: 'poly', pts: [[88, 160], [100, 140], [120, 136], [146, 148], [152, 186], [150, 226], [130, 246], [96, 250], [90, 242], [84, 200]], h: ROOF, edge: 12, mode: 'max', mat: 'dune' },
    // 北排店铺背后的屋顶沙台（+4）：后巷被沙填平；店铺进深只有 4 m，各段店铺背后再把沙填到后墙（巷口留着走沙坡）
    { op: 'poly', pts: [[162, 91.4], [176, 86], [214, 79], [250, 77], [288, 83], [292, 85.2], [290, 100], [262, 99.5], [212, 99.6], [161, 109]], h: ROOF, edge: 1.5, mode: 'max', mat: 'dune' },
    { op: 'poly', pts: [[167.7, 107], [181.9, 104.4], [182.7, 108.8], [168.6, 111.5]], h: ROOF, edge: 1, mode: 'max', mat: 'dune' },
    { op: 'poly', pts: [[195.2, 101.9], [208.5, 99.4], [228.4, 99], [228.4, 103.5], [209.3, 103.8], [196, 106.3]], h: ROOF, edge: 1, mode: 'max', mat: 'dune' },
    { op: 'poly', pts: [[238, 99], [252.4, 99], [252.4, 103.5], [238, 103.5]], h: ROOF, edge: 1, mode: 'max', mat: 'dune' },
    { op: 'poly', pts: [[265, 99], [277, 99], [277, 104], [265, 104]], h: ROOF, edge: 1, mode: 'max', mat: 'dune' },
    // 城墙：6 m 厚的夯土墙芯，两侧直壁，顶面能走。两面贴 Rampart（7.97 × 9 × 2.85，缩到 8 m 高，约 7 m 一段连排）
    { op: 'ramp', pts: WALL_NE, hs: flat(WALL_NE, WALL_TOP), half: 3, edge: 0, mode: 'max', mat: 'earth', asset: 'SM_Tripo_DesertRampart' },
    { op: 'ramp', pts: WALL_SE, hs: flat(WALL_SE, WALL_TOP), half: 3, edge: 0, mode: 'max', mat: 'earth', asset: 'SM_Tripo_DesertRampart' },
    { op: 'ramp', pts: WALL_SW, hs: flat(WALL_SW, WALL_TOP), half: 3, edge: 0, mode: 'max', mat: 'earth', asset: 'SM_Tripo_DesertRampart' },
    // 沙丘漫过墙头的两处（北墙西头、西墙北头）：沙面高过墙顶，从沙上直接走上墙头
    { op: 'mound', at: [153, 93], r: [36, 28], rot: 20, h: 9.2 },
    { op: 'mound', at: [103, 134], r: [30, 26], rot: 59, h: 9.2 },
    { op: 'paint', mat: 'dune', at: [153, 93], r: 9 },
    { op: 'paint', mat: 'dune', at: [103, 134], r: 8 },
    // 北墙三条马道：沙台 +4 → 墙头 +8（贴着墙里皮，约 11°）
    { op: 'ramp', pts: [[203.4, 81], [204.4, 86.4], [184.6, 90]], hs: [8, 8, 4], half: 2.5, edge: 0, mode: 'max', mat: 'earth' },
    { op: 'ramp', pts: [[245, 77.3], [245.3, 82.8], [225.1, 83.9]], hs: [8, 8, 4], half: 2.5, edge: 0, mode: 'max', mat: 'earth' },
    { op: 'ramp', pts: [[286.1, 82.7], [285.2, 88.1], [265.1, 84.9]], hs: [8, 8, 4], half: 2.5, edge: 0, mode: 'max', mat: 'earth' },
    // 东墙马道：墙头 +8 → 集市东口 0（约 15°）
    { op: 'ramp', pts: [[325.6, 114], [320.3, 115.6], [328.7, 143.6]], hs: [8, 8, 0], half: 2.5, edge: 0, mode: 'max', mat: 'earth' },
    // 三处巷口沙坡：街面 0 → 沙台 +4（约 19°）
    { op: 'ramp', pts: [[190.8, 114.9], [188.5, 102.6]], hs: [0, 4], half: 3.5, edge: 2, mode: 'max', mat: 'dune' },
    { op: 'ramp', pts: [[233, 111], [233, 98.5]], hs: [0, 4], half: 3.5, edge: 2, mode: 'max', mat: 'dune' },
    { op: 'ramp', pts: [[259, 111], [259, 98.5]], hs: [0, 4], half: 3.5, edge: 2, mode: 'max', mat: 'dune' },
    // 沙台东头的沙坡：下到东北坊
    { op: 'ramp', pts: [[288, 93], [303, 104]], hs: [4, 0], half: 4, edge: 2, mode: 'max', mat: 'dune' },
    // 西坊沙台东沿的沙堆坡：下到寺院西巷（屋顶线从这里插进前庭）
    { op: 'ramp', pts: [[146, 222], [167, 222]], hs: [4, 0], half: 4, edge: 3, mode: 'max', mat: 'dune' },
    // ③ 集市井台：下沉 2 m，三面台阶（西北接长街、西南去门楼、东接马道）
    { op: 'disc', at: [292, 152], r: 15, h: -2, edge: 0.6, mode: 'min', mat: 'stone' },
    { op: 'ramp', pts: [[277, 137], [283.5, 143.5]], hs: [0, -2], half: 4.5, mat: 'stone' },
    { op: 'ramp', pts: [[282, 169.3], [285.8, 162.8]], hs: [0, -2], half: 4.5, mat: 'stone' },
    { op: 'ramp', pts: [[311, 148.4], [303.6, 149.6]], hs: [0, -2], half: 4.5, mat: 'stone' },
    // ④ 坐像的台基（1.7 m）：台基块 PlatformBlock（4.48 × 2.86 × 3.97）缩到 0.6 倍，5 × 5 拼成 13.4 × 11.9 m
    { op: 'poly', pts: [[205.3, 163], [218.7, 163], [218.7, 175], [205.3, 175]], h: 1.72, edge: 0.3, mode: 'max', mat: 'stone', asset: 'SM_Tripo_DesertPlatformBlock' },
    // 东墙豁口：塌下来的土石堆（走得过去）
    { op: 'mound', at: [338, 206], r: [9, 11], h: 2.4, mat: 'rock' },
    // 塔后塌坑（−10 m）+ 贴壁坡道
    { op: 'disc', at: PIT, r: 19, h: -10, edge: 0.8, mode: 'min', mat: 'rock' },
    { op: 'ramp', pts: PIT_RAMP, hs: PIT_RAMP_H, half: 4.5, mat: 'earth' },
    // 铺地：长街、去门楼的巷子、寺院前庭、南门大道
    { op: 'paint', mat: 'road', half: 7.5, pts: [[166, 123.6], [212, 115], [256, 115], [268, 124], [277, 137]] },
    { op: 'paint', mat: 'road', half: 4, pts: [[282, 169.3], [262, 192], [247, 208.5]] },
    { op: 'paint', mat: 'stone', closed: true, pts: [[182, 180.5], [242.5, 180.5], [244, 232], [206, 238], [180, 232]] },
    { op: 'paint', mat: 'road', half: 3.5, pts: [[177, 312], [177, 284], [210, 268], [232, 262], [258, 268]] },
  ],
  blocks: [
    // ── 城墙：残门楼（角楼被沙和墙芯埋住 8 m）、角楼、马面、南门 ──
    { ...tower([112, 120], 1.2, 36, 8), name: '西残门楼' },
    { ...tower([140, 100], 1, 36, 8), name: '东残门楼' },
    { ...tower([88, 160], 1.2, 0, 8), name: '西角楼（坐在墙芯上，把西墙墙头截断）' },
    { ...tower([250, 71.3]), name: '北墙马面' },
    { ...tower([328, 97]), name: '东北角楼' },
    { ...tower([323.5, 299.5]), name: '东南角楼' },
    { ...tower([96.5, 289.5]), name: '西南角楼' },
    ...gateway('南门', [177, 309], 1, 0),
    // 墙头外沿的垛墙（1.1 m，墙头线的半身掩体）
    parapet([194.6, 80.3], 19, 10.4),
    parapet([229.4, 75.9], 15, 3.2),
    parapet([270.8, 78.1], 17, -9),
    parapet([306.1, 90.6], 18, -29.2),
    parapet([330.5, 122.7], 18, -73.3),
    parapet([338.2, 162.8], 21, -84.6),
    // 东墙豁口的碎石
    boulder([341, 200], 20),
    boulder([334, 212], -15, true),

    // ── ① 灌沙城门：沙坡上的驼队残骸、塌柱、半埋塔刹（东西两簇，中间是冲下来的沙路）──
    wreck([120.5, 127], 30, true),
    goods([125.5, 123.5], -10),
    { kind: 'cyl', at: [126, 132.5], size: [1.2, 1.2], h: 2.5, mat: 'stone', asset: 'SM_Tripo_DesertFinial', sink: 3 },
    coverWall([146, 110.5], 35),
    coverWall([150, 130], 105),
    columnRuin([142, 133], -40),

    // ── ② 三路长街：北排店铺（背后是沙台）、南排店铺（留两处空档：正对寺塔的巷子、去集市的街口）──
    ...shops([175.9, 111.5], 2, 1.3, 10.6),
    ...shops([202.4, 106.6], 2, 1.15, 10.6),
    ...shops([221.2, 105], 2, 1.3),
    ...shops([245.2, 105], 2, 1.3),
    ...shops([270.3, 105.45], 2, 1),
    ...shops([182.55, 130.7], 2, 1.3, 10.6),
    ...shops([205.1, 126], 2, 1, 10.6),
    ...shops([230.2, 125], 2, 1.3),
    ...shops([253.3, 124.55], 2, 1),
    // 街口东侧、西侧各一排（把长街收向集市西北台阶）
    ...shops([280.35, 125.1], 2, 1, -55.3),
    ...shops([264.65, 135.9], 2, 1, -55.3),
    // 街面掩体：拒马、货堆、货摊、残车（靠两边摆，中间留 8 m 跑道）
    barricade([204.5, 122.5], 60),
    barricade([226, 109], -60),
    goods([222, 121], 0, true),
    goods([198, 111.5], 10, true),
    goods([231, 121.3], 20),
    wreck([239, 121.5], 15),
    ...stall([210, 108.8]),
    // 沙台上：埋到屋檐的平顶屋（屋面能走，屋顶小间是全身掩体）、矮墙（半身）
    ...flatHouse([178, 98.5], 10, ROOF + 0.3),
    ...flatHouse([199, 94], 10, ROOF + 0.3),
    ...flatHouse([241, 93.5], 0, ROOF + 0.3),
    ...flatHouse([272, 94.5], 0, ROOF + 0.3),
    coverWall([218, 93]),
    coverWall([254, 95], 90),

    // ── 中坊：长街和寺院之间的土坯房（成簇，中间留出正对寺塔的巷子 x 212–226）──
    hall([184, 139], 10),
    ...flatHouse([192.7, 139.5], 10),
    gable([203, 150], 94),
    ...flatHouse([176, 152], -5),
    gable([188.5, 158], 10),
    ...flatHouse([181, 168.5]),
    hall([236, 137], -6),
    ...flatHouse([244.2, 137.5], -6),
    gable([232, 150], 84),
    ...flatHouse([243, 152.5]),
    gable([254.5, 151], 93, 1.8),
    gable([241, 165.5]),
    ...flatHouse([197, 163], 6),
    ...flatHouse([231.5, 162], -4),
    // 沙扇脚下半埋的两座
    ...flatHouse([162, 144], 14),
    gable([155, 163], 82, 1.6, 1.8),

    // ── ③ 集市井台：井亭（Well 放大 1.8 倍，偏东南；③ 的落点留在井台中间）、货摊、拒马、货堆 ──
    { name: '井亭', asset: WELL, kind: 'cyl', at: [295.8, 155.1], size: [0.3, 0.3], top: 4.12, mat: 'timber' },
    { name: '井亭', asset: WELL, kind: 'cyl', at: [300.2, 155.1], size: [0.3, 0.3], top: 4.12, mat: 'timber' },
    { name: '井亭', asset: WELL, kind: 'cyl', at: [295.8, 158.9], size: [0.3, 0.3], top: 4.12, mat: 'timber' },
    { name: '井亭', asset: WELL, kind: 'cyl', at: [300.2, 158.9], size: [0.3, 0.3], top: 4.12, mat: 'timber' },
    { name: '井亭', asset: WELL, kind: 'cyl', at: [298, 157], size: [1.3, 1.3], top: -1, mat: 'stone' },
    { name: '井亭', asset: WELL, kind: 'box', at: [298, 157], size: [5.08, 4.46], top: 4.12, clear: 2.4, canopy: true, mat: 'roof', landmark: '井亭' },
    barricade([280.5, 152], 90),
    barricade([294.5, 164.2], 20),
    goods([294, 143.5], 15),
    goods([304, 159.5], -20),
    goods([301.5, 143.5], 20, true),
    goods([279.8, 158.5], 0, true),
    // 井台沿上的货摊（三面台阶之间）
    ...stall([275.5, 153], 90),
    ...stall([297, 134]),
    ...stall([309, 164], 60),
    ...stall([296, 171.5]),
    goods([308, 139], 25, true),

    // ── 东北坊、东坊：马道脚下和去门楼的巷子两侧 ──
    ...flatHouse([305, 116], 20),
    gable([313.5, 130.5], 106),
    gable([257.5, 181], 47, 1.8),
    hall([281, 195], 47),
    ...flatHouse([272, 206.5], 47),
    gable([266, 220]),
    hall([306, 187], 98),
    ...flatHouse([318, 170], -12),
    gable([298, 214], 10),
    ...flatHouse([315, 230], 6),
    ...flatHouse([250.5, 191], 0),
    ...flatHouse([291, 182], 47),
    gable([318, 201], 80),
    gable([322, 250], 80),

    // ── ④ 寺院前庭：坐像（北，露天坐在台基上）、两侧二层回廊（后墙实心，廊下能走）、门楼（东）、围墙 ──
    { name: '坐像', asset: 'SM_Tripo_DesertSeatedColossus', kind: 'box', at: [212, 169], size: [7.18, 5.86], top: 13.72, mat: 'stone', landmark: '坐像' },
    ...[184.1, 191.5, 198.9, 206.3].flatMap(z => cloister([180.3, z], 90)),
    ...[183.9, 191.3, 198.7].flatMap(z => cloister([244.3, z], -90)),
    // 回廊北头各折两跨朝南，和坐像一起围住前庭北面（坐像两侧各留一条 12 m 的巷口）
    ...cloister([182.3, 178.7], 0), ...cloister([189.7, 178.7], 0),
    ...cloister([234.9, 178.5], 0), ...cloister([242.3, 178.5], 0),
    ...gateway('门楼', [245.4, 208.5], 0.9, 90),
    // 寺院围墙（PosthouseWall 放大 1.4 倍，4.5 m 高）：门楼往南、再折向东隔开塌坑；东回廊往北接到民居（从集市来只能穿门楼）
    yardWall([245.4, 221.4], 2, 1.4, 90),
    yardWall([268.57, 228.9], 7, 1.4),
    yardWall([245.6, 173.4], 2, 1.4, 90),
    // 前庭掩体：香炉 ×2、碑 ×2、矮墙 ×2、塌柱
    burner([204, 196]),
    burner([220, 196]),
    stele([198, 214]),
    stele([226, 217]),
    coverWall([203, 224]),
    coverWall([233, 199], 90),
    columnRuin([194, 203], 25),

    // ── 寺塔（22 m，全图地标）：下半截塔身 + 收分的上半截，层檐悬空 ──
    { name: '寺塔', asset: PAGODA, kind: 'box', at: [230, 246], size: [9.93, 10.08], top: 13, mat: 'timber' },
    { name: '寺塔', asset: PAGODA, kind: 'box', at: [230, 246], size: [6.6, 6.7], top: 22.16, mat: 'timber', landmark: '寺塔' },
    eave(12.4, 4.9), eave(11.8, 9), eave(11.2, 13.1), eave(8.8, 16.4), eave(8.2, 19.5), eave(7.4, 22.16),
    tamarisk([247, 238]),
    tamarisk([251, 249]),

    // ── 塔院补给营：矮院墙（PosthouseWall 缩到 2.4 m）围出的小院，北、东南两处开口；商人的三座货摊 + 四只火盆 ──
    yardWall([179.5, 241], 3, 0.75),
    yardWall([197.7, 241], 3, 0.75),
    yardWall([174, 253.8], 7, 0.75, 90),
    yardWall([188.6, 266.6], 8, 0.75),
    yardWall([203.2, 248.3], 4, 0.75, 90),
    ...stall([181, 260], 20),
    ...stall([188.5, 261.5]),
    ...stall([196, 260], -20),
    brazier([179, 246.5]),
    brazier([198, 246.5]),
    brazier([177.5, 256]),
    brazier([199.5, 256]),

    // ── 塌坑：暗渠口（出口祭坛 PortalShrine 缩到 0.8 倍，立在坑底西北壁前）+ 坑口碎石 ──
    { name: '暗渠口', asset: SHRINE, kind: 'box', at: off([272, 246], 45, -2.92, 0), size: [1.9, 2.64], top: -1.2, rot: 45, mat: 'stone' },
    { name: '暗渠口', asset: SHRINE, kind: 'box', at: off([272, 246], 45, 2.92, 0), size: [1.9, 2.64], top: -1.2, rot: 45, mat: 'stone' },
    { name: '暗渠口', asset: SHRINE, kind: 'box', at: [272, 246], size: [7.74, 2.64], top: -1.2, clear: -5, rot: 45, canopy: true, mat: 'stone', landmark: '暗渠口' },
    boulder([262, 258], 20),
    boulder([296, 282], -25),
    boulder([308, 244], 15, true),

    // ── 西坊埋屋区（沙台 +4 上）：三簇埋到屋檐的平顶屋，各有一座还露着半截的殿 / 民居 ──
    ...flatHouse([108, 158], 8, ROOF + 0.3),
    ...flatHouse([123, 152], 0, ROOF + 0.3),
    gable([136, 163], -6, 1.4, 3.3),
    ...flatHouse([104, 178], 0, ROOF + 0.3),
    ...flatHouse([119, 181], 5, ROOF + 0.3),
    ...flatHouse([137, 187], 0, ROOF + 0.3),
    ...flatHouse([127, 168], -4, ROOF + 0.3),
    ...flatHouse([134, 176.5], 6, ROOF + 0.3),
    hall([105, 201], 0, 1.2, 3.6),
    ...flatHouse([126, 205], -8, ROOF + 0.3),
    ...flatHouse([140, 203], 3, ROOF + 0.3),
    ...flatHouse([110, 222], 0, ROOF + 0.3),
    ...flatHouse([121, 238], 10, ROOF + 0.3),
    gable([131, 231], 12, 1.4, 3.3),
    // 沙台东沿还露着半截的殿（怪从屋顶跃下寺院西巷）
    hall([153, 200], 90, 1.5, 3.6),
    // 埋屋藏宝：宝藏堆 + 两段矮墙
    { kind: 'box', at: [115, 227.5], size: [2.6, 1.93], h: 1.8, mat: 'timber', asset: 'SM_Tripo_DesertTreasureHoard' },
    coverWall([121, 216], 20),
    coverWall([113, 233.5], 90),
    // 墙头藏宝：经函
    { kind: 'box', at: [235.5, 76.2], size: [1.52, 0.58], h: 2.46, rot: 3, mat: 'timber', asset: 'SM_Prop_DesertReliquary' },

    // ── 西南坊、东南角：露在沙外的土坯房 ──
    hall([112, 264], 8),
    ...flatHouse([124.5, 274.5], 8),
    gable([150, 266], 85),
    hall([141, 290], 6),
    ...flatHouse([124, 291], 6),
    gable([209, 288], -10, 1.8),
    ...flatHouse([219.5, 293.5], -10),
    hall([252, 290], -12),
    gable([309, 272], 24),
    gable([137, 258], -10),
    ...flatHouse([161, 249]),
    ...flatHouse([163.5, 285], 4),
    gable([193, 289], 5),
    hall([283, 292], -14),
    ...flatHouse([299.5, 297], -20),
  ],
  // 可玩区：城里 + 走得到的墙头 + 城外的沙丘（西北）。别处的城墙外面够不着，南门、东墙豁口外各留一小块
  play: [[54, 56], [112, 32], [172, 42], [198, 62], [199.6, 79.2], [213.7, 76.5], [250, 74.5], [288.5, 80.5], [324.2, 100.2], [336.5, 141.5], [340.5, 184],
    [340.5, 196], [350, 198], [350, 214], [340.5, 216], [336.5, 258.3], [320, 296], [270.5, 307.5], [222, 311.5], [186, 311.5], [184, 320], [170, 320], [168, 311.5],
    [129.5, 305.5], [100, 286], [87.5, 242.5], [81.5, 200], [85.5, 159.5], [72, 150], [50, 112]],
  spawn: { id: 'S', name: '出生 · 城外丘顶', at: [106, 78], yaw: 146 },
  strongholds: [
    { id: '1', name: '灌沙城门', at: [134, 121], r: 24, note: '2 波 7 只：灌沙伏击（跳鼠 ×2 + 沙魇 + 墙头蝎卫）→ 沙坡滚火（火浣鼠 ×2 + 跳鼠）；沙坡上往下打' },
    { id: '2', name: '三路长街', at: [214, 115], r: 26, note: '2 波 9 只：街面 / 屋顶沙台 / 墙头三条线，镇墓兽沿街冲锋 + 邪飞天压街' },
    { id: '3', name: '集市井台', at: [289, 152], r: 26, note: '2 波 10 只：井台蜃影 → 集市乱战；下沉 2 m，三面台阶' },
    { id: '4', name: '寺院前庭', at: [212, 208], r: 28, note: '3 波 14 只含 2 精英（沙王卫队）；坐像 + 两侧二层回廊' },
  ],
  guards: [
    { id: 'G1', name: '长街西口', at: [178, 121], note: '跳鼠 ×3 + 沙魇（沙扇脚下）' },
    { id: 'G2', name: '街口折角', at: [264, 119], note: '蝎卫 ×2 + 跳鼠 ×2（长街折向集市处）' },
    { id: 'G3', name: '门楼内', at: [237, 208.5], note: '跳鼠 ×3 + 蝎卫（守门楼）' },
    { id: 'G4', name: '埋屋守军', at: [127, 216], note: '蝎卫 + 跳鼠 ×2 + 沙魇（守埋屋藏宝，调查时惊动）' },
  ],
  entries: [
    { id: 'N1', name: '西墙漫沙处', at: [95, 129], mode: 'walk' },
    { id: 'N2', name: '北墙漫沙处', at: [150, 84], mode: 'walk' },
    { id: 'N3', name: '南门', at: [177, 303], mode: 'walk' },
    { id: 'N4', name: '东墙豁口', at: [337, 206], mode: 'walk' },
    { id: 'N5', name: '北墙墙头跃下沙台', at: [258, 88.5], mode: 'jump', from: [258, 79.6] },
    { id: 'N6', name: '西坊屋顶跃下', at: [163, 200], mode: 'jump', from: [154.5, 200] },
  ],
  caches: [
    { id: 'C1', name: '墙头藏宝', at: [238, 77.7], r: 12, note: '北墙墙头、马面旁，无守军，强化' },
    { id: 'C2', name: '埋屋藏宝', at: [118.5, 226], r: 14, note: '西坊埋屋屋顶之间，有守军，武器（保底精良）' },
  ],
  exit: { id: 'E', name: '出口 · 暗渠口', at: [276.5, 250] },
  extras: [
    { id: 'camp', kind: 'camp', name: '塔院补给营', at: [188.5, 251], r: 10, note: '商人、安全区 10 m' },
  ],
  routes: [
    { id: 'main', name: '金线：丘顶 → ① → ② → ③ → 门楼 → ④ → 绕寺塔 → 坑口坡道 → 暗渠', kind: 'main',
      via: ['S', [126, 110], '1', 'G1', '2', 'G2', [280, 140], '3', [282, 169.3], [249, 208.5], 'G3', '4', [213, 246], [232, 262], [258, 268], 'E'] },
    { id: 'A', name: '墙头线：破口上墙 → 北墙（墙头藏宝）→ 东墙马道下到集市', kind: 'alt',
      via: ['1', [154, 93.5], [190, 83.4], 'C1', [300, 89.7], [320.3, 115.6], [328.7, 144.5], [312, 148.3], '3'] },
    { id: 'B', name: '屋顶线：西坊埋屋屋顶（埋屋藏宝）→ 沙堆坡直插寺院前庭', kind: 'alt',
      via: ['1', [122, 166], [116, 192], 'C2', [146, 222], [170, 222], '4'] },
  ],
  sights: [
    { from: 'S', to: '寺塔', why: '出生第一眼看得见寺塔' },
    { from: '1', to: '寺塔', why: '① 冲下沙扇时朝着寺塔' },
    { from: '2', to: '寺塔', why: '② 南排空档的巷子正对寺塔' },
    { from: 'C1', to: '寺塔', why: '墙头线的回报：越过两排屋顶看寺塔' },
    { from: '3', to: '寺塔', why: '③ 井台里望得见寺塔（往西南去前庭）' },
    { from: '4', to: '寺塔', why: '④ 看得见寺塔' },
    { from: '4', to: '坐像', why: '④ 前庭正对坐像' },
    { from: [272, 263.5], to: 'E', why: '坑口平台（坡道起点）俯看坑底的暗渠口' },
  ],
  views: [
    { name: 'concept', title: '概念图机位（自南向北斜俯瞰）', eye: [205, 230, 470], look: [205, 0, 195], fov: 36 },
  ],
};
