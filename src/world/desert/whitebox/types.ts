/**
 * 第一章「全部场景重做」的白盒数据格式（2026-11-24，路线概念图定稿后的第一步，见 docs/art/concepts/ch1-routes/）。
 * 一张图 = 一份 `WhiteboxSpec`：地形（一串按顺序执行的图章）+ 体块（墙、台、屋）+ 点位（出生 / 据点 / 驻守点 / 入场点 / 藏宝 / 出口）+ 走法。
 * 同一份数据给三处用：terrain.ts 生成高度场（纯数据，node 里也能跑）、probe.ts 实测可达 / 坡度 / 宽度、view.ts 搭检视页画面。
 *
 * 坐标：x 向东，z 向南（北 = −z），y 向上，单位米。每张图占 x ∈ [0, size[0]]、z ∈ [0, size[1]]：
 * 俯视图上北在上，和路线概念图（从南往北斜俯瞰）左右、远近一一对应。
 *
 * 全章统一的度量（level-art.md「战斗场地」）：
 *   玩家 半径 0.35 m、高 1.8 m、眼高 1.6 m、跑速 7.5 m/s、跳高 1.42 m、迈台阶 0.45 m
 *   能走的坡 ≤ 40°（路按 ≤ 24° 设计，台阶 / 坡道 ≤ 32°）；主线不靠跳
 *   掩体 半身 1.0–1.1 m、全身 ≥ 2.2 m；主路宽 ≥ 8 m，最窄通道 ≥ 4 m；据点场地半径 24–30 m
 */
export type V2 = [number, number];
export type V3 = [number, number, number];

/** 白盒材质（只管平涂颜色和「这是什么面」，不是正式材质） */
export type WbMat = 'sand' | 'dune' | 'gravel' | 'road' | 'mud' | 'rock' | 'earth' | 'timber' | 'roof' | 'stone' | 'water' | 'plant';

interface OpBase {
  /** 这一步写进哪种材质（不给就不改材质） */
  mat?: WbMat;
  /** 这块地形在正式场景里用哪件已有资产来做（如雅丹丘 → SM_Tripo_DesertYardangMedium）；纯地形不用给 */
  asset?: string;
  /**
   * 这块地形在正式场景里由新做的件代替（木栈梯、阁的木梯、之字木栈道）：值 = 件名。白盒 / 探针照常把它当行走面，
   * 编进游戏时不压进地形高度场（件自己有踏板和碰撞），下面露出原来的地面。
   */
  piece?: string;
}

/**
 * 地形图章，按顺序执行。高度都是绝对高度（y）或相对当前地面的增量，各图章自己写明。
 * mode：'max' 只抬不压（丘、台）、'min' 只挖不填（洼、渠）、'set' 直接改成目标高度（边上按 edge 过渡）、'add' 叠加。
 */
export type TerrainOp =
  /** 整张图铺平到 h */
  | (OpBase & { op: 'base'; h: number })
  /** 低频起伏：±amp/2，scale = 一个起伏的尺度（m）。keep 里的圆内不起伏（据点场地保持平整） */
  | (OpBase & { op: 'noise'; amp: number; scale: number; seed?: number; keep?: { at: V2; r: number }[] })
  /**
   * 沙丘脊 / 土垄：沿折线一道脊。迎风面宽 stoss（缓），落沙面宽 slip（陡，不给就按 32° 安息角算），side = 落沙面在折线前进方向的哪一侧（1 右 / −1 左）。
   * h 给数组就是沿线各顶点的脊高（线性插值）；两端 taper 米内收到 0。高度从 base（缺省 0）算起，mode 缺省 max。
   */
  | (OpBase & { op: 'ridge'; pts: V2[]; h: number | number[]; stoss: number; slip?: number; side: 1 | -1; base?: number; taper?: number; mode?: 'max' | 'add' })
  /**
   * 椭圆丘 / 台地 / 雅丹：中心 at，半轴 r = [沿 rot 方向, 垂直方向]，rot = 长轴方位（度，0 = 朝东，逆时针为负 z 方向即朝北）。
   * shape：dome 圆丘；mesa 平顶陡壁（flat = 平顶占半径的比例）；yardang 鲸背（迎风头钝、背风尾尖，头在长轴负方向）。
   */
  | (OpBase & { op: 'mound'; at: V2; r: V2; h: number; rot?: number; shape?: 'dome' | 'mesa' | 'yardang'; flat?: number; base?: number; mode?: 'max' | 'add' | 'min' })
  /** 多边形：内部改到 h，边外 edge 米内过渡回原地面（edge 小 = 陡壁）。台地用 max，洼地用 min，平整场地用 set */
  | (OpBase & { op: 'poly'; pts: V2[]; h: number; edge: number; mode: 'set' | 'max' | 'min' })
  /** 圆：同 poly */
  | (OpBase & { op: 'disc'; at: V2; r: number; h: number; edge: number; mode: 'set' | 'max' | 'min' })
  /** 河床 / 沟：沿折线挖到 h（绝对高度），槽底半宽 half，两岸 bank 米内过渡 */
  | (OpBase & { op: 'channel'; pts: V2[]; half: number; h: number; bank: number })
  /**
   * 坡道 / 台阶 / 栈道：沿折线一条带，hs = 各顶点处的高度（线性插值），半宽 half。mode 缺省 set（硬边）。
   * 带外 edge 米内过渡回原地面（缺省 0 = 两侧是直壁，像栈梯；给 3–6 就是土坡道）。
   */
  | (OpBase & { op: 'ramp'; pts: V2[]; hs: number[]; half: number; edge?: number; mode?: 'set' | 'max' | 'min' })
  /** 只改材质：折线带（half）或多边形（给 pts 且 closed）或圆（at + r） */
  | { op: 'paint'; mat: WbMat; pts?: V2[]; half?: number; closed?: boolean; at?: V2; r?: number };

/**
 * 体块：墙、台、屋、柱、地标。底面压进地里（不留缝），顶 = top（绝对高度）或 地面 + h。
 * canopy：悬空的顶（拱顶、门楣、敞厅屋顶、二层楼板）——只画不挡路，底面在 clear 高度；其余体块都是实心的。
 */
export interface WbBlock {
  name?: string;
  kind: 'box' | 'cyl';
  at: V2;
  /** box：[东西向宽, 南北向深]（再按 rot 转）；cyl：[半径, 半径] */
  size: V2;
  /** 比脚下地面高多少（和 top 二选一） */
  h?: number;
  /** 顶面的绝对高度 */
  top?: number;
  /** 绕 y 轴转（度，俯视逆时针） */
  rot?: number;
  mat: WbMat;
  canopy?: boolean;
  /** canopy 的底面高度（绝对） */
  clear?: number;
  /** 地标（检视页里标名字，探针查「从哪儿看得见」） */
  landmark?: string;
  /**
   * 搭正式场景时换成哪件**已有**美术资产（assets.ts 的 WB_ASSETS 里的 ID，public/assets/props/<ID>.glb）。
   * 用户 2026-11-24：「尽量复用原来的已生成的美术资产」——体块的尺寸照资产的实际尺寸摆（可整体缩放 0.6–1.8 倍、连排、半埋），
   * 让白盒换件时是一对一的。
   */
  asset?: string;
  /** 现有资产里确实没有的件：写清要新做什么（名字 + 一句话）。能用已有件拼出来的不要写这个 */
  needs?: string;
  /** 换件时整件往地里埋多少米（半埋的墙、压成半身掩体的巨砾）：露出地面的高度 = 资产高 × 缩放 − sink。只给复用清单算缩放用 */
  sink?: number;
}

export type EntryMode = 'walk' | 'jump' | 'fly';

export interface WbSite {
  id: string;
  name: string;
  at: V2;
  /** 据点场地半径 / 藏宝发现半径 */
  r?: number;
  note?: string;
  /** 入场点：现身（走进来）/ 跃下 / 飞临 */
  mode?: EntryMode;
  /** 跃下的起跳点 */
  from?: V2;
}

export interface WbRoute {
  id: string;
  name: string;
  /** main = 金线主线；alt = 白线侧翼 / 备选 */
  kind: 'main' | 'alt';
  /** 途经：点位 id，或直接给坐标（强制路线贴着某处走） */
  via: (string | V2)[];
  note?: string;
}

/** 视线检查：从某点（眼高）看某个地标 / 点位的顶 */
export interface WbSight {
  from: string | V2;
  /** 地标名（WbBlock.landmark）或点位 id */
  to: string;
  why: string;
}

export interface WbView {
  name: string;
  title: string;
  /** 透视机位；ortho 给了就是正交俯视（看全图） */
  eye?: V3;
  look?: V3;
  fov?: number;
  ortho?: boolean;
}

export interface WhiteboxSpec {
  id: string;
  name: string;
  motif: string;
  mood: string;
  /** [东西向, 南北向]（m） */
  size: V2;
  /** 太阳在哪：azimuth = 俯视图上从北顺时针的方位角（度，90 = 正东），elevation = 仰角 */
  sun: { azimuth: number; elevation: number };
  /** 风吹向哪（[x, z] 单位向量） */
  wind: V2;
  terrain: TerrainOp[];
  blocks: WbBlock[];
  /** 水面：多边形 + 水位 */
  water?: { pts: V2[]; level: number }[];
  /** 可玩区（软边界）：不给 = 整张图里走得到的都算；给了就只在这个多边形里验 */
  play?: V2[];
  /** yaw = 出生朝向（度，从北顺时针：90 = 朝东） */
  spawn: WbSite & { yaw: number };
  strongholds: WbSite[];
  guards: WbSite[];
  entries: WbSite[];
  caches: WbSite[];
  exit: WbSite;
  /** 补给营 / 首领 / 俯射位 / 荫蔽点等其它点位（只标注 + 查可达） */
  extras?: (WbSite & { kind: 'camp' | 'boss' | 'perch' | 'shade' | 'summon' })[];
  routes: WbRoute[];
  sights: WbSight[];
  views: WbView[];
}

/** 白盒配色（sRGB 0..1）：比正式场景更灰、材质分得开，能一眼读出「沙 / 砾石 / 路 / 岩 / 夯土 / 木 / 瓦」 */
export const WB_COLORS: Record<WbMat, [number, number, number]> = {
  sand: [0.82, 0.71, 0.55],
  dune: [0.88, 0.76, 0.56],
  gravel: [0.56, 0.52, 0.49],
  road: [0.7, 0.6, 0.48],
  mud: [0.74, 0.68, 0.6],
  rock: [0.7, 0.44, 0.33],
  earth: [0.72, 0.58, 0.4],
  timber: [0.5, 0.34, 0.26],
  roof: [0.3, 0.3, 0.33],
  stone: [0.62, 0.6, 0.56],
  water: [0.25, 0.68, 0.7],
  plant: [0.62, 0.62, 0.3],
};

export const WB_METRICS = {
  cell: 0.5,
  playerRadius: 0.35,
  enemyRadius: 1.05,
  eye: 1.6,
  step: 0.45,
  /** 能走的最陡坡（度） */
  maxSlope: 40,
  /** 主线：持续坡度上限（度）、最窄宽度（m） */
  mainSlope: 32,
  mainWidth: 4,
  /** 侧翼：最窄宽度（m） */
  altWidth: 2,
  runSpeed: 7.5,
};
