/**
 * 4-1 折多垭口·天路草甸（开放盆地）—— 关卡数据（docs/level-design/chuanzang-v1.md 第 2 节）。
 * 坐标：x 向东，z 向南（北 = −z），y 向上，单位米。高程由地貌函数算出，这里只给形状和位置。
 * 这份数据是网页检视页和以后 Unity LevelSpec 的共同来源：只放「哪里、多高、多大」，不放怎么画。
 */

export type V2 = readonly [number, number];
export type V3 = readonly [number, number, number];

export const MAP = {
  id: '4-1',
  chapter: '雪域天路',
  name: '折多垭口·天路草甸',
  /** 高度图范围（盆地外留出一圈山坡） */
  bounds: { minX: -345, maxX: 350, minZ: -295, maxZ: 295 },
  /** 高程显示：海拔 = base + y（垭口约 4298 m，只作氛围） */
  altitudeBase: 4245,
  roadHalfWidth: 3,
  trailHalfWidth: 1.2,
  snowLine: 78,
  /** 离开盆地多远开始起风雪（软边界） */
  softBoundary: 24,
};

/** 盆地轮廓：轮廓以内都能走（除了陡崖和深水），轮廓以外是环山 */
export const BASIN: V2[] = [
  [-305, 165], [-255, 240], [-120, 258], [40, 252], [185, 238], [282, 172], [308, 40], [292, -92],
  [262, -168], [165, -238], [40, -252], [-92, -246], [-212, -212], [-292, -122], [-312, 20],
];

/** 环山缺口：垭口与河流出口（缺口处山低，强度 0..1） */
export const RING_NOTCHES: { x: number; z: number; r: number; k: number }[] = [
  { x: 262, z: -185, r: 48, k: 0.8 },
  { x: -312, z: 152, r: 34, k: 0.65 },
];

/** 宏观倾斜面：西南低（出生点约 0 m），东北高（垭口脚下约 26 m） */
export const TILT = { ax: 0.028, az: -0.032, x0: -300, z0: 250, c: -3 };

export interface HillSpec {
  id: string; x: number; z: number; rx: number; rz: number; rot: number; h: number;
  /** dome：圆丘；mesa：平顶台地（top = 平顶占半径的比例） */
  kind: 'dome' | 'mesa'; top?: number;
  /** 平顶台地的缓坡一侧（xz 平面角，0 = +x，π/2 = +z），缓坡长度倍数 */
  rampDir?: number; ramp?: number;
  rocky?: boolean;
}

export const HILLS: HillSpec[] = [
  { id: 'spur', x: -185, z: -35, rx: 62, rz: 46, rot: 0.45, h: 20, kind: 'mesa', top: 0.55, rampDir: Math.PI / 4, ramp: 1.6, rocky: true },
  { id: 'flagHill', x: 90, z: -70, rx: 74, rz: 66, rot: 0.2, h: 32, kind: 'dome' },
  { id: 'hillA', x: -60, z: -95, rx: 42, rz: 32, rot: 0.6, h: 13, kind: 'dome' },
  { id: 'hillB', x: 178, z: 172, rx: 48, rz: 36, rot: -0.3, h: 12, kind: 'dome' },
  { id: 'hillC', x: 20, z: 160, rx: 40, rz: 30, rot: 0.2, h: 9, kind: 'dome' },
  { id: 'hillD', x: -172, z: 148, rx: 34, rz: 24, rot: 0.5, h: 9, kind: 'dome' },
  { id: 'hillE', x: -248, z: 40, rx: 34, rz: 52, rot: 0, h: 12, kind: 'dome' },
  { id: 'hillF', x: 228, z: 82, rx: 40, rz: 34, rot: 0.3, h: 10, kind: 'dome' },
  { id: 'moraineW', x: 6, z: -212, rx: 10, rz: 34, rot: 0.15, h: 7, kind: 'dome', rocky: true },
  { id: 'moraineE', x: 76, z: -212, rx: 10, rz: 34, rot: -0.15, h: 7, kind: 'dome', rocky: true },
];

/** 线状山脊：沿 a→b 高度从 hA 渐变到 hB，两侧在 halfWidth 内落回地面 */
export const RIDGES: { id: string; a: V2; b: V2; hA: number; hB: number; halfWidth: number; core: number }[] = [
  { id: 'passRamp', a: [216, -40], b: [256, -182], hA: 0, hB: 24, halfWidth: 80, core: 0.35 },
  { id: 'northRidge', a: [92, -216], b: [236, -192], hA: 12, hB: 25, halfWidth: 24, core: 0.35 },
];

/** 冰川：沿 snout→top 的 U 形谷，冰面向北抬升；冰舌末端是一道冰崖 */
export const GLACIER = { snout: [40, -203] as V2, top: [58, -330] as V2, halfWidth: 34, cliff: 11, rise: 0.33 };

export interface LakeSpec {
  id: string; x: number; z: number; rx: number; rz: number; rot: number; depth: number;
  deep: string; shallow: string; island?: { x: number; z: number; r: number; h: number };
}

export const LAKES: LakeSpec[] = [
  { id: 'holy', x: -140, z: -150, rx: 48, rz: 32, rot: 0.25, depth: 4, deep: '#0c6a80', shallow: '#2a9f9c', island: { x: -152, z: -153, r: 7, h: 1.6 } },
  { id: 'glacial', x: 40, z: -186, rx: 18, rz: 12, rot: 0, depth: 2.5, deep: '#5aa6b6', shallow: '#a6d6da' },
];

/** 冰川河：冰湖南端 → 盆地中部 → 西南峡谷流出 */
export const RIVER = {
  points: [
    [40, -172], [34, -150], [22, -128], [14, -104], [-2, -84], [-6, -62], [-20, -44], [-24, -22], [-38, -2],
    [-36, 20], [-48, 40], [-52, 58], [-66, 72], [-78, 88], [-98, 96], [-118, 110], [-138, 112], [-160, 124],
    [-182, 120], [-204, 132], [-228, 134], [-250, 146], [-272, 144], [-296, 154], [-318, 152], [-350, 158],
  ] as V2[],
  channelHalf: 2.6, channelDepth: 1.3, valleyFloorHalf: 7, valleyDepth: 4.5, valleySide: 0.55,
};

/** 天路：贴着地形走（高程由地形平滑得到，坡度 ≤ 10%）。terrace = 本点到下一点是盘山的一折 */
export interface RoadNode { x: number; z: number; terrace?: boolean }

export const ROAD: RoadNode[] = [
  { x: -262, z: 214 }, { x: -232, z: 200 }, { x: -195, z: 186 }, { x: -160, z: 174 }, { x: -122, z: 156 },
  { x: -86, z: 134 }, { x: -50, z: 112 }, { x: -20, z: 94 }, { x: 10, z: 90 }, { x: 45, z: 98 },
  { x: 80, z: 106 }, { x: 112, z: 110 }, { x: 140, z: 108 }, { x: 172, z: 98 }, { x: 198, z: 72 },
  { x: 213, z: 34 }, { x: 219, z: -4 }, { x: 222, z: -38, terrace: true },
  { x: 268, z: -54 }, { x: 277, z: -63 }, { x: 270, z: -73, terrace: true },
  { x: 214, z: -86 }, { x: 205, z: -95 }, { x: 213, z: -105, terrace: true },
  { x: 266, z: -116 }, { x: 275, z: -125 }, { x: 267, z: -135, terrace: true },
  { x: 224, z: -146 }, { x: 219, z: -156 }, { x: 232, z: -167 }, { x: 252, z: -178 }, { x: 282, z: -192 }, { x: 314, z: -205 },
];

/** 牧道：细土路，连接据点；只提示方向，不强制 */
export const TRAILS: { id: string; points: V2[] }[] = [
  { id: '白塔—碉楼寨', points: [[-34, 70], [-60, 54], [-95, 36], [-128, 16], [-150, 2], [-166, -16], [-182, -30]] },
  { id: '碉楼寨—圣湖', points: [[-192, -52], [-182, -84], [-162, -108], [-128, -116]] },
  { id: '圣湖—冰川口', points: [[-96, -152], [-52, -170], [-12, -180], [18, -188]] },
  { id: '白塔—经幡山头', points: [[-22, 62], [10, 32], [40, -4], [62, -36], [84, -62]] },
  { id: '经幡山头—冰川口', points: [[88, -84], [76, -120], [64, -150], [60, -172]] },
  { id: '营地—经幡山头', points: [[136, 104], [130, 62], [118, 20], [104, -20], [94, -56]] },
  { id: '山脊高路', points: [[72, -194], [100, -212], [150, -208], [200, -198], [238, -184]] },
];

export type SiteKind = 'spawn' | 'site' | 'exit';
export interface SiteSpec {
  id: string; name: string; kind: SiteKind; x: number; z: number; r: number;
  /** 灵火坛位置 */
  altar?: V2;
  /** 从远处辨认这个据点的地标顶点（y 相对地面） */
  mark: V3;
}

export const SITES: SiteSpec[] = [
  { id: 'spawn', name: '出生 · 道班', kind: 'spawn', x: -262, z: 214, r: 18, mark: [-272, 4, 224] },
  { id: 's1', name: '① 碉楼寨', kind: 'site', x: -185, z: -32, r: 45, altar: [-188, -38], mark: [-200, 24, -52] },
  { id: 's2', name: '② 白塔溪谷', kind: 'site', x: -30, z: 64, r: 40, altar: [-18, 60], mark: [-28, 12, 58] },
  { id: 's3', name: '③ 牧民营地', kind: 'site', x: 140, z: 125, r: 45, altar: [140, 132], mark: [152, 3, 140] },
  { id: 's4', name: '④ 圣湖海子', kind: 'site', x: -135, z: -148, r: 62, altar: [-96, -144], mark: [-152, 5, -153] },
  { id: 's5', name: '⑤ 冰川口', kind: 'site', x: 42, z: -186, r: 40, altar: [64, -178], mark: [40, 10, -203] },
  { id: 's6', name: '⑥ 经幡山头', kind: 'site', x: 90, z: -70, r: 35, altar: [82, -62], mark: [90, 9, -70] },
  { id: 'pass', name: '⑦ 垭口（出口）', kind: 'exit', x: 252, z: -178, r: 30, mark: [272, 7, -186] },
];

/** 点亮几处灵火解锁出口 */
export const FIRES_TO_UNLOCK = 3;

/** 小兴趣点：只在平面图和位置提示里出名字 */
export const POIS: { name: string; x: number; z: number; r: number }[] = [
  { name: '温泉', x: 12, z: -122, r: 16 },
  { name: '残碉', x: 20, z: 158, r: 22 },
  { name: '塔林', x: -96, z: -168, r: 14 },
  { name: '修行洞', x: -150, z: -203, r: 14 },
  { name: '盘山天路', x: 242, z: -95, r: 45 },
  { name: '山脊高路', x: 160, z: -208, r: 40 },
];

/** 田地：碉楼寨东南缓坡上的青稞梯田 */
export const FIELDS: { x: number; z: number; r: number }[] = [{ x: -142, z: 12, r: 24 }];

/** 裸土斑：帐篷和房子周围踩出来的地 */
export const DIRT_SPOTS: { x: number; z: number; r: number }[] = [
  { x: -268, z: 220, r: 12 }, { x: 140, z: 124, r: 26 }, { x: -186, z: -34, r: 18 }, { x: 250, z: -178, r: 12 },
];

export type LandmarkKind =
  | 'diaolou' | 'diaolouRuin' | 'house' | 'chorten' | 'stupa' | 'chortenRow' | 'maniWall' | 'wheelHouse'
  | 'waterWheel' | 'lhatse' | 'maniPile' | 'sangBurner' | 'blackTent' | 'whiteTent' | 'yak' | 'barleyRack'
  | 'daoban' | 'drums' | 'gravel' | 'milestone' | 'fieldWall' | 'dungWall' | 'fence' | 'boulder' | 'darchor'
  | 'shelter' | 'stele' | 'flagGate' | 'flagPole' | 'altar' | 'glacierSnout' | 'iceBlock' | 'hotSpring' | 'cave';

export interface Placement {
  kind: LandmarkKind; x: number; z: number;
  /** 朝向：正面（+z 本地方向）对准这个点；不给就用 yaw */
  face?: V2; yaw?: number;
  /** 长度类物件（墙、栅栏、冰崖、塔林）的长度 */
  len?: number; scale?: number; big?: boolean; seed?: number; count?: number;
}

export const PLACEMENTS: Placement[] = [
  // 出生 · 道班
  { kind: 'daoban', x: -274, z: 226, face: [-200, 180] },
  { kind: 'drums', x: -262, z: 230 },
  { kind: 'gravel', x: -282, z: 206 },
  { kind: 'milestone', x: -252, z: 207, face: [-262, 232] },
  // ① 碉楼寨
  { kind: 'diaolou', x: -200, z: -52, face: [-160, -10] },
  { kind: 'diaolouRuin', x: -164, z: -14, face: [-120, 20] },
  { kind: 'house', x: -181, z: -27, face: [-150, 0] },
  { kind: 'house', x: -206, z: -24, face: [-160, -20] },
  { kind: 'house', x: -176, z: -56, face: [-185, -30] },
  { kind: 'barleyRack', x: -193, z: -8, yaw: 0.4 },
  { kind: 'barleyRack', x: -158, z: -40, yaw: -0.3 },
  { kind: 'fieldWall', x: -150, z: 2, yaw: Math.PI / 4, len: 22 },
  { kind: 'fieldWall', x: -138, z: 14, yaw: Math.PI / 4, len: 20 },
  { kind: 'fieldWall', x: -126, z: 26, yaw: Math.PI / 4, len: 18 },
  { kind: 'maniPile', x: -178, z: -6 },
  { kind: 'boulder', x: -216, z: -4, scale: 2.2 },
  { kind: 'boulder', x: -148, z: -50, scale: 2.0 },
  { kind: 'yak', x: -132, z: 34, yaw: 0.8, seed: 1 },
  // ② 白塔溪谷
  { kind: 'chorten', x: -28, z: 58, face: [-20, 92] },
  { kind: 'maniWall', x: -4, z: 74, yaw: 0.25, len: 24 },
  { kind: 'wheelHouse', x: -42, z: 82, face: [-20, 94] },
  { kind: 'waterWheel', x: -70, z: 77, face: [-40, 70] },
  { kind: 'boulder', x: -12, z: 46, scale: 2.4 },
  { kind: 'boulder', x: -36, z: 38, scale: 2.0 },
  { kind: 'maniPile', x: 2, z: 50, scale: 0.8 },
  { kind: 'yak', x: -6, z: 34, yaw: 2.2, seed: 2 },
  { kind: 'yak', x: 14, z: 56, yaw: -0.6, seed: 3 },
  // ③ 牧民营地
  { kind: 'blackTent', x: 124, z: 114, yaw: -0.2 },
  { kind: 'blackTent', x: 154, z: 141, yaw: 0.4 },
  { kind: 'blackTent', x: 163, z: 112, yaw: -0.6, scale: 0.85 },
  { kind: 'whiteTent', x: 132, z: 144, face: [140, 125] },
  { kind: 'dungWall', x: 110, z: 131, yaw: 1.2, len: 9 },
  { kind: 'dungWall', x: 172, z: 128, yaw: 1.5, len: 7 },
  { kind: 'fence', x: 105, z: 146, yaw: 0, len: 16 },
  { kind: 'fence', x: 105, z: 166, yaw: 0, len: 16 },
  { kind: 'fence', x: 97, z: 156, yaw: Math.PI / 2, len: 20 },
  { kind: 'fence', x: 113, z: 152, yaw: Math.PI / 2, len: 12 },
  { kind: 'sangBurner', x: 146, z: 124 },
  { kind: 'darchor', x: 178, z: 140 },
  { kind: 'yak', x: 102, z: 153, yaw: 0.3, seed: 4 },
  { kind: 'yak', x: 108, z: 160, yaw: 2.0, seed: 5 },
  { kind: 'yak', x: 100, z: 161, yaw: -1.2, seed: 6 },
  { kind: 'yak', x: 88, z: 122, yaw: 1.0, seed: 7 },
  { kind: 'yak', x: 172, z: 162, yaw: -2.4, seed: 8 },
  { kind: 'yak', x: 150, z: 92, yaw: 0.5, seed: 9 },
  { kind: 'yak', x: 120, z: 92, yaw: 2.8, seed: 10 },
  // ④ 圣湖海子
  { kind: 'stupa', x: -152, z: -153, face: [-140, -100] },
  { kind: 'chortenRow', x: -96, z: -167, yaw: 1.15, count: 7, len: 18 },
  { kind: 'maniPile', x: -96, z: -122 },
  { kind: 'maniPile', x: -186, z: -124, scale: 1.2 },
  { kind: 'maniPile', x: -92, z: -182, scale: 0.8 },
  { kind: 'cave', x: -150, z: -204, face: [-150, -150] },
  { kind: 'boulder', x: -114, z: -112, scale: 2.2 },
  { kind: 'boulder', x: -192, z: -150, scale: 2.4 },
  { kind: 'yak', x: -86, z: -114, yaw: 1.4, seed: 11 },
  { kind: 'yak', x: -80, z: -124, yaw: -0.4, seed: 12 },
  // ⑤ 冰川口
  { kind: 'glacierSnout', x: 40, z: -205, face: [40, -150], len: 66 },
  { kind: 'iceBlock', x: 34, z: -190, scale: 1.6 },
  { kind: 'iceBlock', x: 47, z: -184, scale: 1.1 },
  { kind: 'iceBlock', x: 42, z: -193, scale: 0.9 },
  { kind: 'boulder', x: 8, z: -194, scale: 2.6 },
  { kind: 'boulder', x: 12, z: -216, scale: 2.2 },
  { kind: 'boulder', x: 74, z: -196, scale: 2.4 },
  { kind: 'boulder', x: 70, z: -219, scale: 2.0 },
  { kind: 'boulder', x: 28, z: -168, scale: 1.6 },
  { kind: 'boulder', x: 57, z: -165, scale: 1.8 },
  { kind: 'maniPile', x: 62, z: -160 },
  // ⑥ 经幡山头
  { kind: 'lhatse', x: 90, z: -70, face: [0, 50] },
  { kind: 'sangBurner', x: 100, z: -62, big: true },
  { kind: 'maniPile', x: 75, z: -80 },
  { kind: 'maniPile', x: 104, z: -82, scale: 0.9 },
  // ⑦ 垭口
  { kind: 'stele', x: 238, z: -165, face: [218, -140] },
  { kind: 'shelter', x: 266, z: -194, face: [250, -175] },
  { kind: 'maniPile', x: 238, z: -186 },
  { kind: 'maniPile', x: 262, z: -164, scale: 1.1 },
  { kind: 'darchor', x: 246, z: -192 },
  { kind: 'sangBurner', x: 232, z: -177 },
  { kind: 'flagGate', x: 272, z: -187, face: [250, -178] },
  // 灵火坛
  ...SITES.filter(s => s.altar).map(s => ({ kind: 'altar' as const, x: s.altar![0], z: s.altar![1], face: [s.x, s.z] as V2 })),
  // 小兴趣点
  { kind: 'hotSpring', x: 12, z: -122 },
  { kind: 'diaolouRuin', x: 20, z: 158, face: [0, 100], scale: 0.85 },
  { kind: 'maniPile', x: -80, z: 40 },
  { kind: 'maniPile', x: 45, z: -8, scale: 0.9 },
  { kind: 'maniPile', x: 66, z: -138 },
  { kind: 'maniPile', x: -172, z: -82, scale: 0.9 },
  { kind: 'maniPile', x: 122, z: 40 },
  { kind: 'maniPile', x: 205, z: 42, scale: 1.1 },
  { kind: 'maniPile', x: -200, z: 162 },
  { kind: 'maniPile', x: 150, z: -207, scale: 0.9 },
  { kind: 'maniPile', x: -58, z: -176 },
  { kind: 'yak', x: -60, z: -124, yaw: 0.9, seed: 13 },
  { kind: 'yak', x: -52, z: -117, yaw: -2.0, seed: 14 },
  { kind: 'yak', x: -67, z: -112, yaw: 2.4, seed: 15 },
  { kind: 'boulder', x: 0, z: 20, scale: 3.0 },
  { kind: 'boulder', x: 182, z: 20, scale: 2.6 },
  { kind: 'boulder', x: -100, z: 182, scale: 2.4 },
  { kind: 'boulder', x: 60, z: 62, scale: 2.2 },
  { kind: 'boulder', x: -240, z: -100, scale: 2.6 },
  { kind: 'boulder', x: 210, z: -22, scale: 2.2 },
];

/** 经幡绳：两端离地高度 ha/hb，poles = 两端立杆 */
export interface FlagLine { a: V2; ha: number; b: V2; hb: number; sag?: number; poles?: boolean }

export const FLAG_LINES: FlagLine[] = [
  { a: [-250, 196], ha: 4.5, b: [-236, 216], hb: 4.5, poles: true },
  { a: [-92, -138], ha: 4, b: [-112, -114], hb: 4, poles: true },
  { a: [-180, -131], ha: 4, b: [-162, -118], hb: 4, poles: true },
  { a: [122, -210], ha: 4, b: [162, -206], hb: 4, poles: true },
  { a: [190, -200], ha: 4, b: [226, -189], hb: 4, poles: true },
  { a: [190, 86], ha: 5, b: [205, 62], hb: 5, poles: true },
  { a: [-198, -40], ha: 6, b: [-176, -46], hb: 5, poles: true },
];

/** 贡嘎：北偏东，盆地大部分地方都看得见 */
export const GONGGA = { x: 430, z: -1550, height: 950, radius: 1100 };

export interface Viewpoint { id: string; name: string; pos: V3; look: V3; walk: boolean }
export const VIEWPOINTS: Viewpoint[] = [
  { id: 'spawn', name: '出生点', pos: [-255, 0, 205], look: [90, 60, -70], walk: true },
  { id: 's1', name: '① 碉楼寨', pos: [-148, 0, 8], look: [-200, 30, -52], walk: true },
  { id: 's2', name: '② 白塔溪谷', pos: [-10, 0, 82], look: [-32, 8, 56], walk: true },
  { id: 's3', name: '③ 牧民营地', pos: [128, 0, 172], look: [148, 6, 118], walk: true },
  { id: 's4', name: '④ 圣湖海子', pos: [-90, 0, -128], look: [-160, 4, -165], walk: true },
  { id: 's5', name: '⑤ 冰川口', pos: [58, 0, -150], look: [40, 30, -215], walk: true },
  { id: 's6', name: '⑥ 经幡山头', pos: [94, 0, -56], look: [-120, -10, 120], walk: true },
  { id: 'pass', name: '⑦ 垭口望贡嘎', pos: [258, 0, -182], look: [430, 420, -1550], walk: true },
  { id: 'over', name: '鸟瞰全图', pos: [-330, 230, 330], look: [20, 0, -30], walk: false },
  { id: 'kui', name: '夔的擂台（看步态）', pos: [100, 72, 0], look: [98, 50, -60], walk: false },
];

/** 视线检查：from 处人眼高度看 to（rel = to 的 y 相对地面） */
export interface SightCheck { name: string; from: V2; to: V3 | 'gongga'; rel?: boolean }
const S6 = SITES.find(s => s.id === 's6')!;
export const SIGHT_CHECKS: SightCheck[] = [
  { name: '出生点 → 碉楼', from: [-262, 214], to: [-200, 24, -52], rel: true },
  { name: '出生点 → 经幡山头', from: [-262, 214], to: [90, 9, -70], rel: true },
  { name: '出生点 → 贡嘎', from: [-262, 214], to: 'gongga' },
  ...SITES.filter(s => s.kind === 'site' && s.id !== 's6').map(s => ({
    name: `${s.name} → 经幡山头`, from: [s.x, s.z] as V2, to: [S6.mark[0], S6.mark[1], S6.mark[2]] as V3, rel: true,
  })),
  { name: '⑥ 经幡山头 → 垭口', from: [94, -62], to: [272, 7, -186], rel: true },
  { name: '⑦ 垭口 → 贡嘎', from: [258, -182], to: 'gongga' },
];

// ───────────────────────────── 遇敌（docs/art/enemy-roster-v2.md 第四章） ─────────────────────────────

/** 第四章雷魅：啸獭、天狗、獓狠（+ 雷牦）、举父、蛮蛮、连鼓灵、帝江、穷奇 */
export type MonsterKind = 'marmot' | 'tiangou' | 'aoyin' | 'leiyak' | 'jufu' | 'manman' | 'liangu' | 'dijiang' | 'qiongqi';

export const MONSTER_NAMES: Record<MonsterKind, string> = {
  marmot: '啸獭', tiangou: '天狗', aoyin: '獓狠', leiyak: '雷牦', jufu: '举父', manman: '蛮蛮', liangu: '连鼓灵', dijiang: '帝江', qiongqi: '穷奇',
};

/**
 * 一处遇敌：兽群占着一块领地（r），没被发现就可以绕开。
 * at：每只怪的位置，y 是离地高度（举父站在屋顶 / 巨石上；蛮蛮、连鼓灵悬空）；
 * sentinel：啸獭哨兵的位置（警戒半径 ALERT_RADIUS）；burrows：啸獭洞口。
 */
export interface Encounter {
  id: string; site: string; x: number; z: number; r: number;
  units: { kind: MonsterKind; at: V3; sentinel?: boolean }[];
  burrows?: V2[];
}

/** 啸獭哨兵尖啸能叫醒的范围 */
export const ALERT_RADIUS = 60;

export const ENCOUNTERS: Encounter[] = [
  { id: 'e1', site: 's1', x: -180, z: -28, r: 42, units: [
    { kind: 'jufu', at: [-181, 6.9, -27] }, { kind: 'jufu', at: [-206, 6.9, -24] },
    { kind: 'tiangou', at: [-160, 0, -6] }, { kind: 'tiangou', at: [-152, 0, -14] }, { kind: 'tiangou', at: [-166, 0, -20] },
    { kind: 'liangu', at: [-192, 3.2, -40] },
  ] },
  { id: 'e2', site: 's2', x: -8, z: 50, r: 36, burrows: [[-18, 36], [-4, 30], [6, 40], [-22, 48], [10, 52]], units: [
    { kind: 'marmot', at: [-12, 2.4, 46], sentinel: true },
    { kind: 'marmot', at: [-16, 0, 38] }, { kind: 'marmot', at: [-6, 0, 33] }, { kind: 'marmot', at: [3, 0, 39] },
    { kind: 'marmot', at: [-20, 0, 45] }, { kind: 'marmot', at: [7, 0, 49] },
    { kind: 'dijiang', at: [6, 0, 74] }, { kind: 'dijiang', at: [12, 0, 80] }, { kind: 'dijiang', at: [1, 0, 82] },
  ] },
  { id: 'e3', site: 's3', x: 150, z: 108, r: 46, units: [
    { kind: 'aoyin', at: [168, 0, 92] }, { kind: 'leiyak', at: [178, 0, 100] }, { kind: 'leiyak', at: [160, 0, 82] },
    { kind: 'dijiang', at: [118, 0, 140] }, { kind: 'dijiang', at: [124, 0, 148] },
  ] },
  { id: 'e4', site: 's4', x: -132, z: -146, r: 60, units: [
    { kind: 'manman', at: [-140, 9, -150] }, { kind: 'manman', at: [-130, 13, -158] },
    { kind: 'tiangou', at: [-100, 0, -118] }, { kind: 'tiangou', at: [-94, 0, -112] }, { kind: 'tiangou', at: [-106, 0, -110] },
    { kind: 'liangu', at: [-172, 3.4, -122] },
  ] },
  { id: 'e5', site: 's5', x: 40, z: -190, r: 40, burrows: [[20, -160], [32, -158], [24, -150], [36, -166]], units: [
    { kind: 'jufu', at: [6, 0.2, -212] }, { kind: 'jufu', at: [76, 0.2, -212] },
    { kind: 'marmot', at: [28, 1.6, -168], sentinel: true },
    { kind: 'marmot', at: [22, 0, -156] }, { kind: 'marmot', at: [34, 0, -154] }, { kind: 'marmot', at: [30, 0, -162] },
    { kind: 'manman', at: [42, 10, -188] },
  ] },
  { id: 'e6', site: 's6', x: 92, z: -64, r: 34, units: [
    { kind: 'liangu', at: [86, 3.2, -76] },
    { kind: 'tiangou', at: [104, 0, -50] }, { kind: 'tiangou', at: [110, 0, -58] }, { kind: 'tiangou', at: [98, 0, -44] }, { kind: 'tiangou', at: [112, 0, -46] },
    { kind: 'dijiang', at: [70, 0, -58] }, { kind: 'dijiang', at: [74, 0, -50] },
  ] },
  { id: 'e7', site: 'pass', x: 250, z: -172, r: 30, units: [
    { kind: 'aoyin', at: [242, 0, -158] }, { kind: 'leiyak', at: [232, 0, -150] },
    { kind: 'jufu', at: [266, 2.7, -194] },
  ] },
];

/** 穷奇：每张图一只，绕着盆地中部的几座丘巡视领地；血少时飞回巢穴 */
export const ROAMER = {
  kind: 'qiongqi' as MonsterKind,
  speed: 5,
  path: [[-60, -95], [10, -30], [70, 20], [178, 40], [178, 165], [20, 158], [-100, 168], [-172, 148], [-248, 40], [-150, -60]] as V2[],
  lair: [-212, -196] as V2,
};

// ───────────────────────────── 领主（4-1 的三个首领级据点） ─────────────────────────────

/**
 * 三个领主各守一个据点：打败就点亮那里的灵火，更难、奖励更好。雷泽雷神留给 4-4 做章节终局。
 * storm：只在雷暴时现身（夔）。圣湖领主待定（相柳不用了，候选饕餮 / 冰夷 / 化蛇）。
 */
/** at / r：擂台中心与半径；perch：白模站的位置（默认擂台中心）；storm：只在雷暴时现身；water：从水里出来，擂台是一圈湖岸 */
export interface Lord { id: string; name: string; site: string; at: V3; r: number; perch?: V2; storm?: boolean; water?: boolean }

export const LORDS: Lord[] = [
  { id: 'kui', name: '夔', site: 's6', at: [92, 0, -74], r: 32, perch: [115, -61], storm: true },
  { id: 'feilian', name: '飞廉', site: 's5', at: [40, 0, -228], r: 34 },
  { id: 'huashe', name: '化蛇', site: 's4', at: [-140, 0, -150], r: 52, perch: [-138, -140], water: true },
];

/**
 * 风神飞廉的风场：基础风向往东略偏南；离巢穴 radius 以内，风越来越强、越来越指向巢穴（风被风涡吸过去）。
 * 经幡、桑烟、草浪、空中的风痕都按它吹，越靠近越明显——不用 HUD 箭头，顺着风就找得到它。
 */
export const WIND = { base: [1, 0.35] as V2, lair: [40, -228] as V2, radius: 300 };
