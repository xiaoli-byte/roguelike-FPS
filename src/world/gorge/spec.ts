/**
 * 4-2 大渡河·铁索桥峡谷（Y 形三江口）—— 关卡数据（docs/level-design/chuanzang-v1.md 第 3 节）。
 * 坐标同 4-1：x 向东，z 向南（北 = −z），y 向上，单位米；y = 0 约是汇口的水面。
 * 地形由「到三条河的距离」决定：每块岸地对每条河有一条横断面（离河心多远、比水面高多少），
 * 再叠上平台（据点、桥头、溜索架）和凿出来的骡道。这里只放「哪里、多高、多大」，不放怎么画。
 */
import type { Encounter, FlagLine, MonsterKind, Placement, V2, V3 } from '../plateau/spec';

export type { MonsterKind, V2, V3 };

export const MAP = {
  id: '4-2',
  chapter: '雪域天路',
  name: '大渡河·铁索桥峡谷',
  bounds: { minX: -300, maxX: 300, minZ: -270, maxZ: 270 },
  /** 海拔显示：汇口水面约 1960 m（丹巴三江口附近），只作氛围 */
  altitudeBase: 1960,
  trailHalfWidth: 1.2,
  /** 超出坡顶多少米开始起风把人吹回峡谷（软边界） */
  softBoundary: 14,
  /** 离地图边缘这么近就算出界（上下游的河谷尽头） */
  edgeMargin: 34,
};

// ───────────────────────────── 河 ─────────────────────────────

export type RiverId = 'dj' | 'xj' | 'dd';

export interface RiverSpec {
  id: RiverId; name: string;
  /** 中线，顺水流方向；首尾各多一点伸到图外（远景地形接着用） */
  points: V2[];
  /** 起点、终点的水面高度（中间按沿程线性） */
  water: [number, number];
  /** 河槽半宽、水深 */
  half: number; depth: number;
}

/** 汇口（三条河交汇处） */
export const CONFLUENCE: V2 = [-8, -18];

export const RIVERS: RiverSpec[] = [
  {
    id: 'dj', name: '大金川', half: 8, depth: 3.2, water: [9, 0.6],
    points: [[-560, -350], [-420, -282], [-300, -215], [-245, -188], [-195, -158], [-150, -126], [-108, -94], [-70, -64], [-40, -40], CONFLUENCE],
  },
  {
    id: 'xj', name: '小金川', half: 8, depth: 3.2, water: [9, 0.6],
    points: [[560, -350], [420, -270], [300, -205], [248, -182], [198, -156], [150, -128], [106, -98], [66, -67], [32, -40], CONFLUENCE],
  },
  {
    id: 'dd', name: '大渡河', half: 11, depth: 3.6, water: [0.5, -6],
    points: [CONFLUENCE, [-12, 12], [-8, 42], [2, 75], [6, 110], [-2, 150], [-4, 185], [8, 220], [24, 250], [34, 275], [70, 420], [110, 640]],
  },
];

// ───────────────────────────── 岸地与横断面 ─────────────────────────────

/** 三块岸地：西岸寨子坡、北面江嘴、东岸绝壁 */
export type BankId = 'W' | 'N' | 'E';
export const BANK_NAMES: Record<BankId, string> = { W: '西岸', N: '江嘴', E: '东岸' };

/** 每块岸地挨着哪两条河（汇口处取两条河各自断面的较低者，中间自然隆起成山脊） */
export const BANK_RIVERS: Record<BankId, [RiverId, RiverId]> = { W: ['dd', 'dj'], N: ['dj', 'xj'], E: ['dd', 'xj'] };

/**
 * 横断面：[离岸线多远, 比水面高多少]（岸线 = 河槽边，离河心 half 米），中间线性。
 * 两个点挨得很近就是崖（陡于 40° 走不上去），拉得开就是缓坡或台地。
 * rim：坡顶（L3）离岸线多远——再往外就算出界，起风。
 */
export interface Profile { knots: V2[]; rim: number }

export const PROFILES: Record<string, Profile> = {
  /** 西岸 · 大渡河：内崖 → L1 台地（西桥头）→ 寨坡缓坡 → L2 高台 → 坡顶 */
  W_dd: { rim: 195, knots: [[0, 0], [2, 0.6], [5, 12], [7, 17.5], [30, 20], [85, 47], [130, 54], [195, 80], [260, 112], [420, 150], [900, 185]] },
  /** 西岸 · 大金川 */
  W_dj: { rim: 172, knots: [[0, 0], [2, 0.6], [4, 9], [6, 14], [20, 16], [70, 46], [118, 54], [172, 78], [240, 112], [400, 150], [900, 185]] },
  /** 江嘴（两条河都用它）：内崖 → 窄岩台（L1）→ 崖 → 缓坡 → 台地顶（L2） */
  N: { rim: 152, knots: [[0, 0], [2, 0.5], [4, 8], [6, 13.5], [15, 15.5], [18, 18], [27, 31], [52, 46], [100, 52], [152, 78], [230, 118], [400, 155], [900, 190]] },
  /** 东岸 · 大渡河北段（汇口到桥北）：一整面绝壁，栈道挂在上面 */
  E_dd_cliff: { rim: 140, knots: [[0, 0], [2, 0.6], [5, 14], [17, 40], [21, 44], [80, 50], [140, 80], [210, 116], [380, 150], [900, 185]] },
  /** 东岸 · 大渡河南段（东桥头往南）：L1 台地 → 崖（骡道之字上去）→ L2 */
  E_dd_bench: { rim: 150, knots: [[0, 0], [2, 0.6], [4, 10], [6, 17], [30, 21], [46, 40], [52, 44], [98, 50], [150, 80], [225, 116], [390, 150], [900, 185]] },
  /** 东岸 · 小金川 */
  E_xj: { rim: 132, knots: [[0, 0], [2, 0.6], [4, 10], [12, 30], [20, 42], [78, 50], [132, 78], [210, 116], [380, 150], [900, 185]] },
  /** 下游河滩：岸边换成这条缓坡（和原断面取低的），内崖变成卵石滩和缓坡，坡上不变 */
  ford: { rim: 195, knots: [[0, 0], [16, 0.3], [28, 1.2], [42, 4], [58, 13], [82, 30], [106, 52], [300, 300]] },
};

/** 东岸大渡河从绝壁过渡到台地的沿程位置（汇口起算的河长，米）；铁索桥在约 81 m 处 */
export const E_CLIFF_TO_BENCH: V2 = [52, 70];

/** 下游河滩：大渡河这一段（沿程 s）变宽变浅，水深 ≤ 1 m 可以涉水 */
export const FORD = { from: 172, to: 236, blend: 22, half: 27, depth: 0.85 };

/** 上下游地图边缘：离边缘这么近，横断面逐渐收紧（台地收成崖，河谷收成深槽） */
export const EDGE_PINCH = 60;

// ───────────────────────────── 平台与路 ─────────────────────────────

/**
 * 贴着河写的节点：在河 r 的 bank 一侧、沿程 s 处，离岸线 off 米；
 * 栈道节点可以不给 off，按高度 y 自动找崖面上那个高度的位置（栈道就贴着崖走）。
 * 沿程：大渡河从汇口起算（铁索桥约 75 m）；大金川全长约 646 m、小金川约 659 m，都在汇口结束。
 */
export interface RiverNode { r: RiverId; bank: BankId; s: number; off?: number; y?: number }
/** 路径节点：[x, z] / [x, z, y]，或贴着河写 */
export type PathNode = readonly number[] | RiverNode;

/** 平台：半径 r 内压平到 y（不给就取中心原地形高度），外圈 fall 米内接回；dirt = 踩出来的土地面 */
export interface PadSpec { id: string; x: number; z: number; r: number; y?: number; fall?: number; dirt?: boolean }

/** 骡道：节点不给 y 就贴地形；割角平滑后凿成 2.4 m 宽的路（崖上就是凿出来的岩台路） */
export interface TrailSpec { id: string; name: string; pts: PathNode[] }

/** 栈道：挂在崖上的木栈道（陡的地方是台阶），节点都要有高度；breakable = 能被落石砸断的段（节点下标区间） */
export interface PlankSpec { id: string; name: string; pts: PathNode[]; breakable?: [number, number][] }

// ───────────────────────────── 据点 ─────────────────────────────

export type SiteKind = 'spawn' | 'site' | 'exit';
export interface SiteSpec {
  id: string; name: string; kind: SiteKind; x: number; z: number; r: number; bank: BankId;
  altar?: V2;
  /** 从远处辨认这个据点的地标顶点（y 相对地面） */
  mark: V3;
}

export const SITES: SiteSpec[] = [
  { id: 'spawn', name: '出生 · 西岸坡顶', kind: 'spawn', bank: 'W', x: -180, z: 120, r: 16, mark: [-176, 3, 114] },
  { id: 's1', name: '① 甲居寨坡', kind: 'site', bank: 'W', x: -126, z: -14, r: 46, altar: [-122, -4], mark: [-150, 24, -40] },
  { id: 's2', name: '② 铁索桥', kind: 'site', bank: 'W', x: -2, z: 62, r: 50, altar: [-52, 84], mark: [-2, 4, 62] },
  { id: 's3', name: '③ 江嘴 · 鹗巢', kind: 'site', bank: 'N', x: 0, z: -100, r: 56, altar: [12, -114], mark: [-4, 26, -128] },
  { id: 's4', name: '④ 绝壁驿站', kind: 'site', bank: 'E', x: 92, z: -20, r: 40, altar: [94, -10], mark: [104, 8, -6] },
  { id: 's5', name: '⑤ 河滩磨坊', kind: 'site', bank: 'W', x: -12, z: 192, r: 50, altar: [-52, 194], mark: [-44, 4, 182] },
  { id: 'exit', name: '⑦ 出口 · 古驿道', kind: 'exit', bank: 'E', x: 206, z: 2, r: 24, mark: [214, 7, 2] },
];

/** 点亮几处灵火解锁出口 */
export const FIRES_TO_UNLOCK = 3;

/** 小兴趣点：只在平面图和位置提示里出名字 */
export const POIS: { name: string; x: number; z: number; r: number }[] = [
  { name: '汇口', x: -8, z: -18, r: 18 },
  { name: '伸臂木桥', x: -220, z: -173, r: 18 },
  { name: '藤索吊桥', x: 171, z: -144, r: 24 },
  { name: '河心跳石', x: 14, z: -30, r: 12 },
  { name: '东岸栈道', x: 16, z: 6, r: 22 },
  { name: '穷奇岩洞', x: -236, z: 52, r: 14 },
];

// ───────────────────────────── 过河 ─────────────────────────────

/** 桥：iron = 铁索桥（会晃、导电），rope = 藤索吊桥，cantilever = 伸臂木桥；a、b 是两头桥面 [x, y, z] */
export interface SpanSpec { id: string; name: string; kind: 'iron' | 'rope' | 'cantilever'; a: V3; b: V3; width: number; sag: number; banks: [BankId, BankId] }

export const SPANS: SpanSpec[] = [
  { id: 'iron', name: '铁索桥', kind: 'iron', a: [-40, 19.5, 74], b: [36, 19.5, 51], width: 3, sag: 2.4, banks: ['W', 'E'] },
  { id: 'rope', name: '藤索吊桥', kind: 'rope', a: [156, 35, -170], b: [186, 35, -118], width: 1.6, sag: 3.2, banks: ['N', 'E'] },
  { id: 'cant', name: '伸臂木桥', kind: 'cantilever', a: [-227, 17, -162], b: [-213, 17, -185], width: 2.4, sag: 0, banks: ['W', 'N'] },
];

/** 溜索：from 是起点平台 [x, z, 平台高度]，to 是终点平台；只能从高往低滑 */
export interface ZipSpec { id: string; name: string; from: V3; to: V3; banks: [BankId, BankId] }

export const ZIPS: ZipSpec[] = [
  { id: 'zipA', name: '溜索甲', from: [-150, -52, 40], to: [-82, -101, 17], banks: ['W', 'N'] },
  { id: 'zipB', name: '溜索乙', from: [-96, -146, 43], to: [-180, -114, 18], banks: ['N', 'W'] },
];

/** 河心跳石：a → b 之间一排石墩（a 在东岸，b 在江嘴），石顶比正常水面高 top 米 */
export const STONES = { id: 'stones', name: '河心跳石', a: [20, -19] as V2, b: [8, -41] as V2, n: 9, top: 0.6, banks: ['E', 'N'] as [BankId, BankId] };

/** 河滩涉水：大渡河这一段水浅可以走过去 */
export const FORD_CROSSING = { id: 'ford', name: '河滩涉水', x: -2, z: 196, banks: ['W', 'E'] as [BankId, BankId] };

export const PADS: PadSpec[] = [
  // 东岸之字路的回头弯平台
  { id: 'e2turn', x: 61, z: 115, r: 4.5, y: 29.8, fall: 4 },
  { id: 'exit', x: 206, z: 2, r: 12, fall: 12, dirt: true },
  // 铁索桥两头的桥头台地
  { id: 'ironW', x: -46, z: 78, r: 9, y: 19.5, fall: 8, dirt: true },
  { id: 'ironE', x: 41, z: 49, r: 8, y: 19.5, fall: 8, dirt: true },
  // 吊桥、伸臂桥两头
  { id: 'ropeN', x: 154.5, z: -172.6, r: 5, y: 35, fall: 8, dirt: true },
  { id: 'ropeE', x: 187.5, z: -115.4, r: 5.5, y: 35, fall: 8, dirt: true },
  { id: 'cantW', x: -229, z: -159.5, r: 4.5, y: 17, fall: 7, dirt: true },
  { id: 'cantN', x: -211.4, z: -187.6, r: 4.5, y: 17, fall: 7, dirt: true },
  // 溜索平台
  { id: 'zipA0', x: -150, z: -52, r: 5, y: 40, fall: 8, dirt: true },
  { id: 'zipA1', x: -82, z: -101, r: 5, y: 17, fall: 6, dirt: true },
  { id: 'zipB0', x: -96, z: -146, r: 5, y: 43, fall: 8, dirt: true },
  { id: 'zipB1', x: -180, z: -114, r: 5, y: 18, fall: 6, dirt: true },
  // 跳石两头的卵石滩
  { id: 'stoneE', x: 21, z: -16, r: 3.5, y: 1.3, fall: 3 },
  { id: 'stoneN', x: 6, z: -45, r: 4.5, y: 1.3, fall: 3 },
  // 鹗巢平台（江嘴尖的崖上）
  { id: 'nest', x: -1, z: -57, r: 6, y: 25, fall: 5 },
  // 甲居寨坡的房基、碉楼
  { id: 'h1', x: -100, z: 8, r: 6.5, fall: 5, dirt: true },
  { id: 'h2', x: -118, z: -10, r: 6.5, fall: 5, dirt: true },
  { id: 'h3', x: -138, z: 10, r: 6.5, fall: 5, dirt: true },
  { id: 'h4', x: -128, z: -34, r: 6.5, fall: 5, dirt: true },
  { id: 'h5', x: -152, z: -14, r: 6.5, fall: 5, dirt: true },
  { id: 'dl1', x: -150, z: -40, r: 5, fall: 5, dirt: true },
  // 江嘴碉楼、驿站
  { id: 'dl3', x: -4, z: -128, r: 9, fall: 8, dirt: true },
  { id: 'post', x: 92, z: -20, r: 16, fall: 10, dirt: true },
  // 河滩磨坊
  { id: 'mill', x: -46, z: 188, r: 9, y: 2.4, fall: 8, dirt: true },
];

export const TRAILS: TrailSpec[] = [
  { id: 'w1', name: '出生—寨坡', pts: [[-180, 120], [-176, 100], [-166, 66], [-154, 30], [-140, 8]] },
  { id: 'w2', name: '寨坡—西桥头', pts: [[-112, -2], [-90, 18], [-72, 40], [-58, 62], [-48, 76, 19.5]] },
  { id: 'w3', name: '西桥头—河滩', pts: [[-46, 86, 19.5], [-48, 112, 19], [-58, 132, 15], [-62, 146, 10], [-52, 158, 6], [-46, 170, 3]] },
  { id: 'w4', name: '寨坡—溜索甲', pts: [[-130, -28], [-140, -40], [-150, -52, 40]] },
  { id: 'w5', name: '溜索乙落点—寨坡', pts: [[-180, -114, 18], [-176, -96], [-168, -76], [-158, -60], [-150, -52, 40]] },
  { id: 'w6', name: '伸臂桥—西岸', pts: [[-230, -157, 17], [-222, -140], [-206, -128], [-180, -114, 18]] },
  { id: 'e1', name: '河滩—东桥头', pts: [[22, 176, 1.6], [40, 160, 6], [50, 146, 12], [42, 128, 17], [38, 100, 19], [40, 60, 19.5]] },
  { id: 'e2', name: '东桥头—驿站（之字路）', pts: [[44, 60, 19.5], [50, 88, 24], [57, 108, 28.6], [61, 115, 29.8], [66, 110, 31], [71, 94, 35], [71, 74, 39.5], [77, 52, 44], [84, 24, 46], [92, -6]] },
  { id: 'e3', name: '驿站—古驿道（之字路）', pts: [[104, -14, 47], [150, -30, 55], [176, -18, 62], [162, 0, 66], [190, 8, 73], [206, 2]] },
  { id: 'e4', name: '驿站—吊桥', pts: [[100, -36], [128, -66], [156, -86], [172, -98, 43], [182, -106, 39], [189, -112, 35]] },
  {
    id: 'n1', name: '溜索甲落点—江嘴台地（之字路）', pts: [
      // 每个回头弯是一小段平的（两个同高的节点），割角平滑后弯里不会变陡
      [-82, -101, 17], { r: 'dj', bank: 'N', s: 510, off: 13, y: 18.5 }, { r: 'dj', bank: 'N', s: 510, off: 17, y: 18.5 },
      { r: 'dj', bank: 'N', s: 546, off: 22, y: 26 }, { r: 'dj', bank: 'N', s: 546, off: 26, y: 26 },
      { r: 'dj', bank: 'N', s: 506, off: 31, y: 33.5 }, { r: 'dj', bank: 'N', s: 506, off: 35, y: 33.5 },
      { r: 'dj', bank: 'N', s: 542, off: 40, y: 41 }, { r: 'dj', bank: 'N', s: 542, off: 44, y: 41 }, [-62, -130, 44], [-56, -137],
    ],
  },
  { id: 'n2', name: '江嘴台地—溜索乙', pts: [[-20, -126], [-56, -136], [-96, -146, 43]] },
  { id: 'n3', name: '江嘴台地—吊桥', pts: [[14, -132], [60, -146], [104, -156], [136, -166], [152, -176, 35]] },
  { id: 'n4', name: '江嘴台地—伸臂桥', pts: [[-96, -146, 43], [-140, -168], [-176, -184], [-200, -192], [-210, -190, 17]] },
  { id: 'n5', name: '江嘴台地—鹗巢（之字路）', pts: [[-4, -112], [16, -104, 45.5], [-12, -94, 41], [14, -84, 36.5], [-12, -72, 30], [-3, -63, 25.4]] },
];

export const PLANKS: PlankSpec[] = [
  {
    id: 'plankA', name: '栈道 A（东岸绝壁）',
    pts: [
      [44, 43, 19.5],
      { r: 'dd', bank: 'E', s: 58, y: 21 }, { r: 'dd', bank: 'E', s: 44, y: 23.5 }, { r: 'dd', bank: 'E', s: 30, y: 26 },
      { r: 'dd', bank: 'E', s: 14, y: 29 }, { r: 'xj', bank: 'E', s: 622, y: 32.5 }, { r: 'xj', bank: 'E', s: 604, y: 36.5 },
      { r: 'xj', bank: 'E', s: 586, y: 40.5 }, [80, -46, 43.5], [90, -44, 45.4],
    ],
    breakable: [[2, 3], [5, 6]],
  },
  {
    // 从栈道 A 的第三个节点往南，贴着更靠河的崖面一路下到汇口边的卵石滩（在栈道 A 下面，不和它重叠）
    id: 'plankA2', name: '栈道 A 岔路（下到跳石）',
    pts: [
      // 先往河那边平着拐出 4 m，和往南继续爬的栈道 A 错开，再往下走
      { r: 'dd', bank: 'E', s: 44, y: 23.5 }, [6.2, 21.4, 23.5], { r: 'dd', bank: 'E', s: 26, y: 17.5 }, { r: 'dd', bank: 'E', s: 12, y: 10.5 },
      { r: 'dd', bank: 'E', s: 1, y: 5 }, [21, -16, 1.3],
    ],
  },
  {
    // 鹗巢往小金川上游方向贴崖下到岩台，再折回来下到江嘴尖的卵石滩（跳石北头）
    id: 'plankB', name: '栈道 B（鹗巢—岩台—江嘴尖）',
    pts: [[-1, -57, 25], { r: 'xj', bank: 'N', s: 620, y: 19 }, { r: 'xj', bank: 'N', s: 606, y: 12 }, [6, -45, 1.3]],
  },
];

/** 青稞梯田（甲居寨坡）：只上色，地形本身已经是台地 */
export const FIELDS: { x: number; z: number; r: number }[] = [
  { x: -96, z: -18, r: 22 }, { x: -112, z: 30, r: 20 }, { x: -152, z: 20, r: 16 },
];

// ───────────────────────────── 地标 ─────────────────────────────

/** 本图专有的物件：桥楼、雷桩、水磨坊、马厩、关楼、鹗巢、烽火、危岩、渡口桩、穷奇岩洞 */
export type GorgeKind = 'bridgeTower' | 'thunderPost' | 'mill' | 'stable' | 'gateTower' | 'nest' | 'beacon' | 'looseRock' | 'ferryPost' | 'lair';
export interface GorgePlacement { kind: GorgeKind; x: number; z: number; face?: V2; yaw?: number; scale?: number }

/** 和 4-1 共用的物件（碉楼、民居、青稞架、梯田墙、玛尼堆、巨石、经幡、灵火坛、经幡门……） */
export const PLACEMENTS: Placement[] = [
  { kind: 'maniPile', x: -175, z: 112, scale: 1.1 },
  // ① 甲居寨坡
  { kind: 'house', x: -100, z: 8, face: [-40, 40] },
  { kind: 'house', x: -118, z: -10, face: [-40, 20] },
  { kind: 'house', x: -138, z: 10, face: [-60, 40] },
  { kind: 'house', x: -128, z: -34, face: [-60, -10] },
  { kind: 'house', x: -152, z: -14, face: [-80, 10] },
  { kind: 'diaolou', x: -150, z: -40, face: [-80, 0] },
  { kind: 'barleyRack', x: -108, z: 24, yaw: 0.6 },
  { kind: 'barleyRack', x: -142, z: -24, yaw: -0.2 },
  { kind: 'fieldWall', x: -92, z: -8, yaw: 0.9, len: 16 },
  { kind: 'fieldWall', x: -106, z: 38, yaw: 0.7, len: 14 },
  { kind: 'darchor', x: -126, z: 18 },
  { kind: 'boulder', x: -162, z: 4, scale: 2.0 },
  // ② 铁索桥（桥本身在过河设施里）
  { kind: 'maniPile', x: -56, z: 70, scale: 0.9 },
  { kind: 'boulder', x: 50, z: 62, scale: 1.8 },
  // ③ 江嘴
  { kind: 'diaolou', x: -4, z: -128, face: [0, 0] },
  { kind: 'house', x: 18, z: -134, face: [10, -60] },
  { kind: 'maniPile', x: -20, z: -112 },
  { kind: 'boulder', x: 30, z: -104, scale: 2.2 },
  // ④ 绝壁驿站
  { kind: 'house', x: 80, z: -28, face: [40, 10] },
  { kind: 'house', x: 104, z: -6, face: [40, 10] },
  { kind: 'yak', x: 96, z: -46, yaw: 0.6, seed: 21 },
  { kind: 'yak', x: 102, z: -48, yaw: -1.4, seed: 22 },
  { kind: 'maniPile', x: 76, z: -8, scale: 0.9 },
  // ⑤ 河滩磨坊
  { kind: 'boulder', x: -24, z: 166, scale: 2.4 },
  { kind: 'boulder', x: 14, z: 216, scale: 2.0 },
  { kind: 'boulder', x: -6, z: 180, scale: 1.6 },
  // ⑦ 古驿道
  { kind: 'flagGate', x: 216, z: 2, face: [150, 0] },
  { kind: 'maniPile', x: 196, z: -10 },
  { kind: 'darchor', x: 200, z: 16 },
  // 灵火坛
  ...SITES.filter(s => s.altar).map(s => ({ kind: 'altar' as const, x: s.altar![0], z: s.altar![1], face: [s.x, s.z] as V2 })),
  // 灵宠飞渡的起飞台：玛尼堆 + 一根高高的风马旗杆，从对岸也看得见
  { kind: 'darchor', x: -166, z: 99 }, { kind: 'maniPile', x: -171, z: 98, scale: 0.8 },
  { kind: 'darchor', x: 17, z: -149 }, { kind: 'maniPile', x: 10, z: -150, scale: 0.8 },
  { kind: 'darchor', x: 197, z: 27 }, { kind: 'maniPile', x: 191, z: 28, scale: 0.8 },
  // 小兴趣点
  { kind: 'maniPile', x: -170, z: 70, scale: 0.9 },
  { kind: 'maniPile', x: 140, z: -150, scale: 0.9 },
  { kind: 'maniPile', x: 60, z: 110 },
  { kind: 'boulder', x: -84, z: 122, scale: 2.4 },
  { kind: 'boulder', x: 120, z: 60, scale: 2.2 },
  { kind: 'boulder', x: -60, z: -170, scale: 2.4 },
];

export const GORGE_PLACEMENTS: GorgePlacement[] = [
  { kind: 'bridgeTower', x: -45, z: 76, face: [36, 51] },
  { kind: 'bridgeTower', x: 41, z: 49, face: [-40, 74] },
  { kind: 'thunderPost', x: -38, z: 84 },
  { kind: 'thunderPost', x: 46, z: 42 },
  { kind: 'beacon', x: -4, z: -128 },
  { kind: 'beacon', x: -150, z: -40 },
  { kind: 'nest', x: -1, z: -57, face: [-6, 0] },
  { kind: 'looseRock', x: -1, z: -66, face: [-6, 0] },
  { kind: 'mill', x: -46, z: 184, face: [0, 186] },
  { kind: 'mill', x: -44, z: 196, face: [0, 198], scale: 0.85 },
  { kind: 'ferryPost', x: -28, z: 198 },
  { kind: 'ferryPost', x: 22, z: 192 },
  { kind: 'stable', x: 98, z: -38, face: [60, -20] },
  { kind: 'gateTower', x: 196, z: 2, face: [150, 0] },
  { kind: 'lair', x: -236, z: 52, face: [-150, 40] },
];

/** 经幡绳 */
export const FLAG_LINES: FlagLine[] = [
  { a: [-190, 112], ha: 4, b: [-182, 130], hb: 4, poles: true },
  { a: [-130, 2], ha: 5, b: [-112, -4], hb: 5, poles: true },
  { a: [-8, -116], ha: 5, b: [10, -120], hb: 5, poles: true },
  { a: [84, -10], ha: 4.5, b: [98, -22], hb: 4.5, poles: true },
  { a: [192, -6], ha: 4, b: [202, 10], hb: 4, poles: true },
  { a: [144, -172], ha: 4, b: [150, -184], hb: 3.5, poles: true },
];

// ───────────────────────────── 动态环境 ─────────────────────────────

/** 落石区：top 是石头开始掉的崖顶；plank / segs = 区里会被砸断的栈道段 */
export interface RockfallZone { id: string; name: string; x: number; z: number; r: number; top: V3; plank?: string; seg?: number }
export const ROCKFALL: RockfallZone[] = [
  { id: 'rfA', name: '东岸绝壁', x: 14, z: 14, r: 14, top: [32, 50, 12], plank: 'plankA', seg: 0 },
  { id: 'rfA2', name: '小金川口', x: 42, z: -36, r: 12, top: [58, 50, -46], plank: 'plankA', seg: 1 },
  { id: 'rfNest', name: '鹗巢危岩', x: -1, z: -58, r: 8, top: [-1, 42, -68] },
  { id: 'rfW', name: '西岸内崖', x: -30, z: 30, r: 12, top: [-46, 28, 30] },
];

/** 涨水：水面 up 秒内涨 rise 米，保持 hold 秒，down 秒退去；自动模式每 period 秒一次 */
export const FLOOD = { rise: 1.8, up: 8, hold: 20, down: 10, period: 95 };

/** 峡谷风：顺着河往上游吹（谷风）；每隔 every 秒起一阵 dur 秒的强阵风 */
export const GUST = { every: [20, 30] as V2, dur: 5, base: 0.22 };

// ───────────────────────────── 遇敌 ─────────────────────────────

/** 兽群：at 的 y 是离脚下地面（地形、桥面、屋顶）的高度 */
export const ENCOUNTERS: Encounter[] = [
  { id: 'g1', site: 's1', x: -126, z: -10, r: 40, units: [
    { kind: 'jufu', at: [-100, 0, 8] }, { kind: 'jufu', at: [-138, 0, 10] },
    { kind: 'tiangou', at: [-108, 0, -22] }, { kind: 'tiangou', at: [-96, 0, -12] }, { kind: 'tiangou', at: [-114, 0, -30] },
    { kind: 'liangu', at: [-124, 3.2, -2] },
  ] },
  { id: 'g2', site: 's2', x: -2, z: 62, r: 46, units: [
    { kind: 'manman', at: [-10, 7, 66] }, { kind: 'manman', at: [6, 7, 59] },
    { kind: 'dijiang', at: [-20, 0, 68] }, { kind: 'dijiang', at: [-4, 0, 63] }, { kind: 'dijiang', at: [14, 0, 57] },
    { kind: 'liangu', at: [46, 3.2, 56] },
  ] },
  { id: 'g3', site: 's3', x: 0, z: -110, r: 44, units: [
    { kind: 'tiangou', at: [-22, 0, -100] }, { kind: 'tiangou', at: [14, 0, -96] }, { kind: 'tiangou', at: [-6, 0, -90] },
    { kind: 'jufu', at: [18, 0, -134] },
  ] },
  { id: 'g4', site: 's4', x: 92, z: -20, r: 38, units: [
    { kind: 'aoyin', at: [76, 0, 4] }, { kind: 'leiyak', at: [68, 0, 14] }, { kind: 'leiyak', at: [84, 0, 14] },
    { kind: 'jufu', at: [104, 0, -6] },
  ] },
  { id: 'g5', site: 's5', x: -14, z: 194, r: 46, burrows: [[-30, 172], [-18, 178], [-26, 186], [-14, 168], [-34, 180]], units: [
    { kind: 'marmot', at: [-24, 2.2, 166], sentinel: true },
    { kind: 'marmot', at: [-30, 0, 176] }, { kind: 'marmot', at: [-20, 0, 174] }, { kind: 'marmot', at: [-24, 0, 182] },
    { kind: 'marmot', at: [-16, 0, 170] }, { kind: 'marmot', at: [-32, 0, 184] },
    { kind: 'dijiang', at: [10, 0, 206] }, { kind: 'dijiang', at: [16, 0, 200] }, { kind: 'dijiang', at: [6, 0, 212] },
    { kind: 'manman', at: [-4, 8, 196] }, { kind: 'manman', at: [6, 10, 186] },
  ] },
  { id: 'g6', site: 'exit', x: 196, z: 4, r: 26, units: [
    { kind: 'tiangou', at: [184, 0, -4] }, { kind: 'tiangou', at: [190, 0, 12] }, { kind: 'tiangou', at: [178, 0, 8] }, { kind: 'tiangou', at: [196, 0, -10] },
    { kind: 'liangu', at: [200, 3.2, 4] },
  ] },
  { id: 'g7', site: 'rope', x: 171, z: -144, r: 20, units: [
    { kind: 'dijiang', at: [164, 0, -158] }, { kind: 'dijiang', at: [178, 0, -132] },
  ] },
];

/** 啸獭哨兵尖啸能叫醒的范围（同 4-1） */
export const ALERT_RADIUS = 60;

/** 穷奇：本图不滑翔，只在西岸的寨坡、桥头和河滩之间游猎；巢在西岸坡顶的岩洞 */
export const ROAMER = {
  kind: 'qiongqi' as MonsterKind,
  speed: 5,
  path: [[-170, 60], [-150, 20], [-110, -40], [-80, 20], [-58, 90], [-56, 130], [-46, 170], [-90, 150], [-140, 120]] as V2[],
  lair: [-236, 52] as V2,
};

// ───────────────────────────── 领主 · 大鹗 ─────────────────────────────

/** 擂台在汇口上空；perches = 会落脚的地方（鹗巢、铁索桥中间、江嘴碉楼顶、寨坡碉楼顶） */
export const LORD = {
  id: 'dae', name: '大鹗', site: 's3',
  at: [-6, 0, -10] as V3, r: 90,
  circle: { x: -6, z: -10, r: 70, y: 82 },
  perches: [
    { id: 'nest', name: '鹗巢', at: [-1, 25.4, -58] as V3, face: [-4, 0] as V2 },
    { id: 'bridge', name: '铁索桥', at: [-2, 17.2, 62.5] as V3, face: [36, 51] as V2 },
    { id: 'tower', name: '江嘴碉楼顶', at: [-4, 0, -128] as V3, face: [0, 0] as V2 },
  ],
};

// ───────────────────────────── 彩蛋 · 灵宠飞渡 ─────────────────────────────

/** 起飞台：带着会飞的灵宠（精卫、重明鸟、应龙）站在这里按 F，灵宠变大，抓着它的爪子从高处飞下去（3.8） */
export interface FlightPerch { id: string; name: string; x: number; z: number; r: number }
export const FLIGHT_PERCHES: FlightPerch[] = [
  { id: 'fw', name: '西岸坡顶·风马旗台', x: -168, z: 102, r: 6 },
  { id: 'fn', name: '江嘴碉楼·风马旗台', x: 14, z: -146, r: 6 },
  { id: 'fe', name: '古驿道山口·风马旗台', x: 194, z: 24, r: 6 },
];

// ───────────────────────────── 机位与视线 ─────────────────────────────

export interface Viewpoint { id: string; name: string; pos: V3; look: V3; walk: boolean }
export const VIEWPOINTS: Viewpoint[] = [
  { id: 'spawn', name: '出生点', pos: [-178, 0, 118], look: [-2, 14, 50], walk: true },
  { id: 's1', name: '① 甲居寨坡', pos: [-86, 0, 28], look: [-140, 22, -30], walk: true },
  { id: 's2', name: '② 铁索桥（桥上）', pos: [-2, 0, 62.5], look: [-8, 30, -60], walk: true },
  { id: 's3', name: '③ 江嘴碉楼', pos: [14, 0, -104], look: [-4, 24, -132], walk: true },
  { id: 's4', name: '④ 绝壁驿站', pos: [68, 0, -2], look: [100, 6, -26], walk: true },
  { id: 's5', name: '⑤ 河滩磨坊', pos: [-30, 0, 216], look: [10, 4, 170], walk: true },
  { id: 'exit', name: '⑦ 古驿道', pos: [186, 0, 2], look: [216, 6, 2], walk: true },
  { id: 'plank', name: '东岸栈道', pos: [41, 0, 43], look: [0, 22, -10], walk: true },
  { id: 'over', name: '鸟瞰全图', pos: [-330, 230, 300], look: [0, 0, -20], walk: false },
  { id: 'nest', name: '鹗巢（看大鹗）', pos: [-60, 60, 30], look: [-4, 30, -50], walk: false },
  { id: 'bridgeAir', name: '铁索桥（空中）', pos: [-28, 34, 90], look: [-2, 19, 62], walk: false },
  { id: 'plankAir', name: '东岸栈道（空中）', pos: [-34, 42, 34], look: [22, 24, 2], walk: false },
  { id: 'villageAir', name: '甲居寨坡（空中）', pos: [-66, 74, 44], look: [-130, 40, -16], walk: false },
  { id: 'fordAir', name: '河滩磨坊（空中）', pos: [-90, 44, 236], look: [-12, 0, 190], walk: false },
  { id: 'perch', name: '灵宠飞渡（西岸起飞台）', pos: [-170, 0, 106], look: [-2, 14, 50], walk: true },
];

/** 视线检查：from 处人眼高度看 to（rel = to 的 y 相对地面） */
export interface SightCheck { name: string; from: V2; to: V3; rel?: boolean }
const S3 = SITES.find(s => s.id === 's3')!;
export const SIGHT_CHECKS: SightCheck[] = [
  { name: '出生点 → 江嘴碉楼', from: [-180, 120], to: S3.mark, rel: true },
  { name: '出生点 → 铁索桥', from: [-180, 120], to: [-2, 18, 62] },
  { name: '出生点 → 甲居碉楼', from: [-180, 120], to: [-150, 24, -40], rel: true },
  ...SITES.filter(s => s.kind === 'site' && s.id !== 's3').map(s => ({ name: `${s.name} → 江嘴碉楼`, from: [s.x, s.z] as V2, to: S3.mark, rel: true })),
  { name: '② 铁索桥 → 鹗巢', from: [-30, 72], to: [-1, 28, -57] },
  { name: '④ 绝壁驿站 → 古驿道', from: [92, -20], to: [214, 7, 2], rel: true },
];
