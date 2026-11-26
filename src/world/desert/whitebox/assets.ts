// 自动生成：node scripts/desert/whitebox-assets.mjs —— 别手改；资产有增减就重跑（用途说明在脚本的 USE 表里）。
// 第一章已发布的沙漠美术资产（public/assets/props/<ID>.glb）：白盒体块用 asset 字段对上它们，搭正式场景时直接换件。

export interface WbAsset {
  /** 发布后的包围盒 [宽 x, 高 y, 深 z]（m，正面朝 +Z，轴心在底面中心） */
  size: [number, number, number];
  /** GLB 根空间里的包围盒（public/assets/manifest.json 的 bounds）：编进场景时按它对齐件的底面和中心 */
  min: [number, number, number];
  max: [number, number, number];
  use: string;
  /** 不要再用的件（题材不对 / 方案已废） */
  avoid?: boolean;
}

export const WB_ASSETS: Record<string, WbAsset> = {
  SM_Decal_DesertCartRuts: { size: [2.4, 0, 8], min: [-1.2, 0.02, -4], max: [1.2, 0.02, 4], use: "古道车辙贴花" },
  SM_Decal_DesertCrackedBed: { size: [8, 0, 8], min: [-4, 0.02, -4], max: [4, 0.02, 4], use: "龟裂泉床贴花" },
  SM_Env_DesertCaveCeilingRift: { size: [20.09, 9, 9.04], min: [-10.045, 0, -4.52], max: [10.045, 9, 4.52], use: "穴顶裂缝岩体（1-4 旧的地下穴方案，已不用）", avoid: true },
  SM_Env_DesertCliff: { size: [15.11, 8.63, 6.23], min: [-7.352, 0.002, -2.979], max: [7.759, 8.627, 3.249], use: "崖壁段（旧件）" },
  SM_Env_DesertGate: { size: [10.91, 6.76, 1.41], min: [-5.46, 0.001, -0.706], max: [5.452, 6.757, 0.704], use: "门（旧件）" },
  SM_Env_DesertRuin: { size: [4.82, 4.31, 1.63], min: [-2.346, 0.002, -0.59], max: [2.47, 4.314, 1.042], use: "残屋" },
  SM_Env_DesertSandstone: { size: [3.38, 2.88, 2.54], min: [-1.71, 0.001, -1.137], max: [1.667, 2.883, 1.408], use: "砂岩巨砾（掩体：整块全身，压扁半身）" },
  SM_Env_DesertTamarisk: { size: [1.72, 2.27, 2.02], min: [-0.861, 0, -1.011], max: [0.861, 2.272, 1.011], use: "红柳（散布，高灌木）" },
  SM_Env_DesertWall: { size: [7.09, 4.26, 1.4], min: [-3.547, 0.001, -0.672], max: [3.546, 4.257, 0.726], use: "墙段（旧件）" },
  SM_Prop_DesertIncenseBurner: { size: [1.33, 2.6, 1.16], min: [-0.664, 0, -0.582], max: [0.664, 2.6, 0.582], use: "寺院香炉" },
  SM_Prop_DesertReliquary: { size: [1.52, 2.46, 0.58], min: [-0.764, 0.001, -0.239], max: [0.758, 2.464, 0.344], use: "经函 / 圣物匣（藏宝点）" },
  SM_Prop_DesertStele: { size: [1.68, 3.8, 2.14], min: [-0.84, 0, -1.07], max: [0.84, 3.8, 1.07], use: "龟趺碑" },
  SM_Prop_DesertUrns: { size: [0.82, 0.84, 0.79], min: [-0.461, 0, -0.388], max: [0.358, 0.842, 0.4], use: "陶罐" },
  SM_Tripo_DesertBarricade: { size: [4.77, 1.2, 1.18], min: [-2.385, 0, -0.588], max: [2.385, 1.2, 0.588], use: "拒马" },
  SM_Tripo_DesertBeaconParapet: { size: [1.89, 1.1, 0.38], min: [-0.944, 0, -0.189], max: [0.944, 1.1, 0.189], use: "烽燧台垛墙（1.1 m，半身掩体，沿台沿连排）" },
  SM_Tripo_DesertBeaconTower: { size: [7.52, 14, 5.46], min: [-3.758, 0, -2.732], max: [3.758, 14, 2.732], use: "烽燧（1-1 主地标）" },
  SM_Tripo_DesertBrazier: { size: [1.32, 2.4, 1.2], min: [-0.661, 0, -0.602], max: [0.661, 2.4, 0.602], use: "火盆（补光来源）" },
  SM_Tripo_DesertBrushwoodPile: { size: [1.2, 1.3, 1.19], min: [-0.602, 0, -0.593], max: [0.602, 1.3, 0.593], use: "积薪（柴堆，可放大 1.5–1.8 倍）" },
  SM_Tripo_DesertBuriedRoofFlat: { size: [3.56, 3.6, 3.87], min: [-1.781, 0, -1.934], max: [1.781, 3.6, 1.934], use: "半埋屋顶 · 平顶土坯房（屋脊之海的落脚平台）" },
  SM_Tripo_DesertBuriedRoofHall: { size: [6.48, 5.5, 3.7], min: [-3.241, 0, -1.851], max: [3.241, 5.5, 1.851], use: "半埋屋顶 · 殿堂歇山顶" },
  SM_Tripo_DesertBuriedRoofHouse: { size: [4.76, 4.5, 3.16], min: [-2.378, 0, -1.579], max: [2.378, 4.5, 1.579], use: "半埋屋顶 · 民居两坡顶" },
  SM_Tripo_DesertCamelthorn: { size: [1.36, 0.74, 1.24], min: [-0.679, 0, -0.62], max: [0.679, 0.74, 0.62], use: "骆驼刺（散布）" },
  SM_Tripo_DesertCaravanWreck: { size: [3.79, 1.82, 4.03], min: [-1.896, 0, -2.016], max: [1.896, 1.818, 2.016], use: "驼队残车" },
  SM_Tripo_DesertCloister: { size: [6.17, 7.5, 2.85], min: [-3.083, 0, -1.427], max: [3.083, 7.5, 1.427], use: "寺院回廊 · 二层（一跨，沿长向连排）" },
  SM_Tripo_DesertColossus: { size: [8.76, 16, 9.53], min: [-4.381, 0, -4.764], max: [4.381, 16, 4.764], use: "胡狼头巨像（题材不对，不要再用）", avoid: true },
  SM_Tripo_DesertColumn: { size: [1.88, 5, 1.89], min: [-0.942, 0, -0.944], max: [0.942, 5, 0.944], use: "石柱（竖着像人影，交战区里放倒用）" },
  SM_Tripo_DesertColumnRuin: { size: [4.24, 1.56, 3.36], min: [-2.122, 0, -1.68], max: [2.122, 1.565, 1.68], use: "残柱 / 倒伏石柱（半身掩体）" },
  SM_Tripo_DesertCornerTower: { size: [7.39, 13, 5.25], min: [-3.693, 0, -2.626], max: [3.693, 13, 2.626], use: "城墙角楼" },
  SM_Tripo_DesertCoverWall: { size: [4.91, 2.6, 0.99], min: [-2.457, 0, -0.493], max: [2.457, 2.6, 0.493], use: "掩体矮墙（半身）" },
  SM_Tripo_DesertCrescentPavilion: { size: [8.53, 11, 7.63], min: [-4.264, 0, -3.813], max: [4.264, 11, 3.813], use: "月牙阁（1-4：一层敞廊、二层台）" },
  SM_Tripo_DesertFinial: { size: [2.53, 5.5, 2.28], min: [-1.267, 0, -1.141], max: [1.267, 5.5, 1.141], use: "塔刹（半埋，掩体）" },
  SM_Tripo_DesertGateway: { size: [13.52, 11, 4.01], min: [-6.762, 0, -2.005], max: [6.762, 11, 2.005], use: "城门 / 门楼" },
  SM_Tripo_DesertGoodsPile: { size: [1.68, 1.6, 1.28], min: [-0.842, 0, -0.64], max: [0.842, 1.6, 0.64], use: "货堆（半身掩体）" },
  SM_Tripo_DesertGravelScatter: { size: [1.05, 0.45, 1.04], min: [-0.524, 0, -0.521], max: [0.524, 0.45, 0.521], use: "黑戈壁砾石（散布）" },
  SM_Tripo_DesertHanWall: { size: [5.33, 3.5, 1.37], min: [-2.667, 0, -0.687], max: [2.667, 3.5, 0.687], use: "汉长城直段（夯土夹芦苇层，半埋）" },
  SM_Tripo_DesertHanWallCorner: { size: [4.69, 3.5, 4.69], min: [-0.687, 0, -4], max: [4, 3.5, 0.687], use: "汉长城转角 / 墩台" },
  SM_Tripo_DesertHanWallEnd: { size: [5.65, 3.5, 2.17], min: [-2.827, 0, -1.084], max: [2.827, 3.5, 1.084], use: "汉长城断口（缺口两侧）" },
  SM_Tripo_DesertMarketStall: { size: [3.7, 3.6, 2.2], min: [-1.851, 0, -1.1], max: [1.851, 3.6, 1.1], use: "货摊（带篷）" },
  SM_Tripo_DesertPlatformBlock: { size: [4.48, 2.86, 3.97], min: [-2.24, 0, -1.984], max: [2.24, 2.865, 1.984], use: "台基块（拼台地、环台）" },
  SM_Tripo_DesertPortalShrine: { size: [9.68, 11, 3.3], min: [-4.839, 0, -1.652], max: [4.839, 11, 1.652], use: "出口祭坛（传送门）" },
  SM_Tripo_DesertPosthouseWall: { size: [4.87, 3.2, 0.99], min: [-2.435, 0, -0.496], max: [2.435, 3.2, 0.496], use: "驿站残墙（院墙一段，两端平切可连排，矮段按高度缩放）" },
  SM_Tripo_DesertRampart: { size: [7.97, 9, 2.85], min: [-3.986, 0, -1.427], max: [3.986, 9, 1.427], use: "城墙段（带垛口）" },
  SM_Tripo_DesertRampartEndL: { size: [1.74, 8.99, 2.85], min: [-3.986, 0.009, -1.427], max: [-2.25, 9, 1.427], use: "城墙端头 · 左（派生件）" },
  SM_Tripo_DesertRampartEndR: { size: [1.74, 9, 2.7], min: [2.25, 0, -1.273], max: [3.985, 9, 1.427], use: "城墙端头 · 右（派生件）" },
  SM_Tripo_DesertRampartPanel: { size: [4.5, 8.93, 2.85], min: [-2.25, 0.009, -1.427], max: [2.25, 8.943, 1.427], use: "城墙面板（派生件）" },
  SM_Tripo_DesertRampartPlain: { size: [8.47, 9, 1.83], min: [-4.236, 0, -0.917], max: [4.236, 9, 0.917], use: "城墙段（无垛口）" },
  SM_Tripo_DesertRampartPlainPanel: { size: [6.5, 9, 1.83], min: [-3.25, 0, -0.914], max: [3.25, 9, 0.916], use: "城墙面板 · 无垛口（派生件）" },
  SM_Tripo_DesertRockArch: { size: [15.68, 13, 6.61], min: [-7.841, 0, -3.306], max: [7.841, 13, 3.306], use: "岩拱（1-2 出口，拱洞前后通透）" },
  SM_Tripo_DesertSeatedColossus: { size: [11.97, 20, 9.76], min: [-5.984, 0, -4.88], max: [5.984, 20, 4.88], use: "敦煌坐像（1-1 远景地标；1-3 寺院前庭巨像）" },
  SM_Tripo_DesertShopHouse: { size: [6.32, 8, 3.09], min: [-3.16, 0, -1.546], max: [3.16, 8, 1.546], use: "二层店铺楼（一层敞开店面，二层前廊）" },
  SM_Tripo_DesertStairs: { size: [3.61, 3, 3.17], min: [-1.807, 0, -1.585], max: [1.807, 3, 1.585], use: "台阶" },
  SM_Tripo_DesertStupaBuried: { size: [9.45, 11, 8.88], min: [-4.726, 0, -4.441], max: [4.726, 11, 4.441], use: "半埋佛塔（1-2 塔尖广场地标，带两级环台）" },
  SM_Tripo_DesertTemplePagoda: { size: [9.93, 22.16, 10.08], min: [-4.964, 0, -5.04], max: [4.964, 22.163, 5.04], use: "寺塔（1-3 地标，22 m）" },
  SM_Tripo_DesertTreasureHoard: { size: [2.6, 1.8, 1.93], min: [-1.298, 0, -0.965], max: [1.298, 1.8, 0.965], use: "宝藏堆（藏宝点）" },
  SM_Tripo_DesertWell: { size: [2.82, 3.4, 2.48], min: [-1.408, 0, -1.242], max: [1.408, 3.4, 1.242], use: "集市井台" },
  SM_Tripo_DesertYardangFleet: { size: [4.49, 10, 13.49], min: [-2.246, 0, -6.746], max: [2.246, 10, 6.746], use: "雅丹岩丘 · 舰形（20 m 级）" },
  SM_Tripo_DesertYardangMedium: { size: [6.21, 9, 14.01], min: [-3.104, 0, -7.005], max: [3.104, 9, 7.005], use: "雅丹岩丘 · 中（9 m）" },
  SM_Tripo_DesertYardangSmall: { size: [3.76, 4, 5.74], min: [-1.882, 0, -2.869], max: [1.882, 4, 2.869], use: "雅丹岩丘 · 小（4 m，可沿长轴拉伸）" },
  SM_Tripo_DesertYardangSphinx: { size: [9.57, 13, 17.47], min: [-4.784, 0, -8.736], max: [4.784, 13, 8.736], use: "狮身雅丹（1-2 出生点地标）" },
};
