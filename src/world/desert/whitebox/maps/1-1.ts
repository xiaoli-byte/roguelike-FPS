import type { WhiteboxSpec } from '../types';

/**
 * 1-1 古道穿越戈壁 · 白盒（版面见 docs/art/concepts/ch1-routes/1-1_route_concept.jpg）。
 * 整片能走的戈壁盆地：西边两座石丘夹着驿站，汉长城自北向南横贯（主缺口 / 北豁口 / 南端绕河床三处能过），
 * 干河床从东北斜向西南（下沉的侧翼路），雅丹石阵在北、烽燧台地在全场最高处、驼队营地在东南沙洼，出口在东边两座沙丘的豁口。
 * 风从东北吹向西南：雅丹头朝东北、沙丘落沙面朝西南。
 */
const WIND_ROT = 215; // 雅丹长轴：头（迎风）在东北，尾拖向西南

export const WB_1_1: WhiteboxSpec = {
  id: '1-1',
  name: '古道穿越戈壁',
  motif: '开阔',
  mood: '破晓后一小时，迎着朝阳向东赶路：长影朝玩家倒过来，烽燧狼烟逆光直上，东边天际压着将来的沙暴。',
  size: [420, 320],
  sun: { azimuth: 102, elevation: 19 },
  wind: [-0.82, 0.57],
  terrain: [
    { op: 'base', h: 0, mat: 'gravel' },
    { op: 'noise', amp: 1.1, scale: 55, seed: 11, keep: [{ at: [118, 165], r: 26 }, { at: [185, 84], r: 22 }, { at: [330, 215], r: 24 }, { at: [30, 165], r: 16 }] },
    // 西：两座石丘夹出驿站所在的垭口
    { op: 'mound', at: [26, 104], r: [38, 32], h: 14, mat: 'rock' },
    { op: 'mound', at: [26, 230], r: [40, 36], h: 16, mat: 'rock' },
    // 北：沙丘带（落沙面朝南 = 朝盆地）
    { op: 'ridge', pts: [[36, 42], [95, 27], [150, 35], [205, 22], [262, 30], [318, 22], [374, 38]], h: [9, 16, 13, 18, 14, 17, 12], stoss: 34, side: 1, mat: 'dune' },
    // 东：两段沙丘，中间留出口的豁口
    { op: 'ridge', pts: [[386, 50], [404, 100], [397, 162]], h: [12, 17, 9], stoss: 28, side: 1, mat: 'dune' },
    { op: 'ridge', pts: [[402, 232], [396, 268], [378, 304]], h: [9, 14, 10], stoss: 28, side: 1, mat: 'dune' },
    // 南：戈壁尽头的冲沟陡坎（往下 9 m）
    { op: 'poly', pts: [[-10, 294], [430, 294], [430, 330], [-10, 330]], h: -9, edge: 4, mode: 'min', mat: 'rock' },
    // 干河床：自东北向西南，比两岸低 1.6 m
    { op: 'channel', pts: [[252, 94], [230, 116], [207, 140], [188, 166], [172, 194], [152, 222], [130, 246], [106, 268], [86, 290], [66, 318]], half: 7, h: -1.6, bank: 3, mat: 'mud' },
    // 古道过河的浅滩（两岸放缓）
    { op: 'ramp', pts: [[168, 164], [182, 164], [194, 160], [208, 156]], hs: [0, -1.4, -1.4, 0], half: 5, edge: 4, mat: 'road' },
    // ② 雅丹石阵：矮 / 中 / 高三座鲸背丘 + 矮丘的上顶沙坡。
    // 陡壁平顶（flat 0.82，同 1-2 的雅丹岛）：构成复核（2026-11-26）时圆鼓包把岩件整个吞掉，画面上只剩光滑的沙包；
    // 陡壁上的岩层纹自己就读成层层的雅丹崖，岩件只在顶上和两头露出来
    { op: 'mound', at: [170, 98], r: [17, 7], h: 3.5, rot: WIND_ROT, shape: 'yardang', flat: 0.82, mat: 'rock', asset: 'SM_Tripo_DesertYardangSmall' },
    { op: 'mound', at: [193, 68], r: [21, 8], h: 6, rot: WIND_ROT, shape: 'yardang', flat: 0.82, mat: 'rock', asset: 'SM_Tripo_DesertYardangMedium' },
    { op: 'mound', at: [214, 50], r: [25, 9.5], h: 9, rot: WIND_ROT, shape: 'yardang', flat: 0.82, mat: 'rock', asset: 'SM_Tripo_DesertYardangMedium' },
    { op: 'ramp', pts: [[157, 110], [166, 102]], hs: [0, 3.3], half: 3, edge: 3, mode: 'max', mat: 'sand' },
    // ③ 烽燧台地：6 m 夯土台 + 东西两条夯土坡道
    { op: 'poly', pts: [[267, 110], [303, 110], [303, 146], [267, 146]], h: 6, edge: 1.2, mode: 'max', mat: 'earth' },
    { op: 'ramp', pts: [[240, 136], [268, 136]], hs: [0, 6], half: 4.5, edge: 2, mode: 'max', mat: 'earth' },
    { op: 'ramp', pts: [[302, 138], [331, 152]], hs: [6, 0], half: 4.5, edge: 2, mode: 'max', mat: 'earth' },
    // ④ 驼队残骸营地：沙洼（−2.5 m），南、东有沙丘围着
    { op: 'disc', at: [330, 215], r: 30, h: -2.5, edge: 16, mode: 'min', mat: 'sand' },
    { op: 'ridge', pts: [[286, 250], [316, 262], [350, 258], [374, 242]], h: [3, 6, 5, 3], stoss: 16, side: 1, mat: 'dune' },
    // 南戈壁的孤岩（商队遗货藏在背风面）
    { op: 'mound', at: [204, 246], r: [17, 8], h: 6, rot: WIND_ROT, shape: 'yardang', flat: 0.82, mat: 'rock', asset: 'SM_Tripo_DesertYardangSmall' },
    // 古道
    { op: 'paint', mat: 'road', half: 3.5, pts: [[8, 165], [84, 165], [118, 165], [168, 164]] },
    { op: 'paint', mat: 'road', half: 3.5, pts: [[208, 156], [240, 138]] },
    { op: 'paint', mat: 'road', half: 3.5, pts: [[331, 152], [330, 190], [334, 215], [368, 206], [400, 196]] },
  ],
  blocks: [
    // 体块尺寸照已有资产的实际尺寸（assets.ts）：asset = 换正式件时用哪件，sink = 埋进地里几米，needs = 现有资产里没有、要新做的
    // 驿站废墟：驿站残墙连排（北 3 段；南 2 段缩到 2.6 m）、残屋、残门（旧套件的门，门洞框住长城缺口和远处的狼烟）
    { kind: 'box', at: [22, 150], size: [14.6, 1], h: 3.2, mat: 'earth', asset: 'SM_Tripo_DesertPosthouseWall' },
    { kind: 'box', at: [20, 180], size: [9.7, 1], h: 2.6, mat: 'earth', asset: 'SM_Tripo_DesertPosthouseWall' },
    { kind: 'box', at: [12, 141], size: [4.8, 1.6], h: 4.3, rot: 20, mat: 'earth', asset: 'SM_Env_DesertRuin' },
    { name: '驿站残门', kind: 'box', at: [42, 160.2], size: [1.4, 1.2], h: 6.8, mat: 'timber', asset: 'SM_Env_DesertGate' },
    { name: '驿站残门', kind: 'box', at: [42, 169.8], size: [1.4, 1.2], h: 6.8, mat: 'timber', asset: 'SM_Env_DesertGate' },
    { name: '驿站残门', kind: 'box', at: [42, 165], size: [1.4, 10.9], top: 6.8, clear: 5.4, canopy: true, mat: 'timber', landmark: '驿站残门', asset: 'SM_Env_DesertGate' },
    // 汉长城（直段 5.33 m 一段连排）：北段（放大到 4.5 m）→ 角楼墩（转角件 ×1.6）→ 北豁口 → 中段 → 主缺口 12 m（两侧断口件）→ 南段，南端埋进干河床
    { kind: 'box', at: [86, 70], size: [1.8, 44], h: 4.5, mat: 'earth', asset: 'SM_Tripo_DesertHanWall' },
    { kind: 'box', at: [86, 96], size: [7.5, 7.5], h: 5.6, mat: 'earth', landmark: '长城角楼', asset: 'SM_Tripo_DesertHanWallCorner' },
    { kind: 'box', at: [84, 133], size: [1.6, 52], h: 4, mat: 'earth', asset: 'SM_Tripo_DesertHanWall' },
    { kind: 'box', at: [84, 156.2], size: [2.2, 5.65], h: 3.6, mat: 'earth', asset: 'SM_Tripo_DesertHanWallEnd' },
    { kind: 'box', at: [83, 173.8], size: [2.2, 5.65], h: 3.5, mat: 'earth', asset: 'SM_Tripo_DesertHanWallEnd' },
    { kind: 'box', at: [83, 209], size: [1.4, 76], h: 3.5, mat: 'earth', asset: 'SM_Tripo_DesertHanWall' },
    { kind: 'box', at: [82, 250], size: [1.4, 5.3], h: 1.8, mat: 'earth', asset: 'SM_Tripo_DesertHanWall', sink: 1.7 },
    // 缺口两侧的半埋矮墙（半身掩体：长城直段埋下去 2.4 m）
    { kind: 'box', at: [91, 153], size: [5.3, 1.4], h: 1.1, mat: 'earth', asset: 'SM_Tripo_DesertHanWall', sink: 2.4 },
    { kind: 'box', at: [93, 178], size: [1.4, 5.3], h: 1.1, mat: 'earth', asset: 'SM_Tripo_DesertHanWall', sink: 2.4 },
    // ① 黑戈壁砾石滩：砂岩巨砾（3.4 × 2.9 × 2.5 m）埋下去 1.8 m 就是低宽的半身掩体，成簇；两块露全高当全身掩体
    { kind: 'box', at: [106, 150], size: [3.4, 2.5], h: 1.05, rot: 25, mat: 'rock', asset: 'SM_Env_DesertSandstone', sink: 1.8 },
    { kind: 'box', at: [110.5, 146], size: [3.4, 2.5], h: 1.1, rot: -10, mat: 'rock', asset: 'SM_Env_DesertSandstone', sink: 1.8 },
    { kind: 'box', at: [126, 182], size: [3.4, 2.5], h: 1.05, rot: -20, mat: 'rock', asset: 'SM_Env_DesertSandstone', sink: 1.8 },
    { kind: 'box', at: [131, 178], size: [3.4, 2.5], h: 1.1, rot: 15, mat: 'rock', asset: 'SM_Env_DesertSandstone', sink: 1.8 },
    { kind: 'box', at: [132, 152], size: [3.4, 2.5], h: 1.05, rot: 40, mat: 'rock', asset: 'SM_Env_DesertSandstone', sink: 1.8 },
    { kind: 'box', at: [112, 184], size: [3.4, 2.5], h: 2.6, rot: 10, mat: 'rock', asset: 'SM_Env_DesertSandstone', sink: 0.3 },
    { kind: 'box', at: [140, 166], size: [3.4, 2.5], h: 2.6, rot: -30, mat: 'rock', asset: 'SM_Env_DesertSandstone', sink: 0.3 },
    // ② 雅丹石阵：倒伏石柱（残柱件埋 0.5 m）、压低的砂岩
    { kind: 'box', at: [180, 90], size: [4.2, 3.4], h: 1.05, rot: 30, mat: 'stone', asset: 'SM_Tripo_DesertColumnRuin', sink: 0.5 },
    { kind: 'box', at: [194, 86], size: [3.4, 2.5], h: 1.05, rot: -15, mat: 'rock', asset: 'SM_Env_DesertSandstone', sink: 1.8 },
    { kind: 'box', at: [176, 76], size: [3.4, 2.5], h: 1.1, rot: 50, mat: 'rock', asset: 'SM_Env_DesertSandstone', sink: 1.8 },
    // ③ 烽燧（19 m = 资产放大 1.36 倍，立在 6 m 台上）+ 台沿垛墙（1.1 m，1.89 m 一段连排，留出两条坡道口）+ 积薪（放大 1.7 倍）
    // 构成复核（2026-11-26）：原大 14 m 时从出生门框里望过去只有一根火柴，全图的方向感全靠它（狼烟是特效那一步）
    { kind: 'box', at: [277.5, 119.5], size: [10.2, 7.4], top: 25, mat: 'earth', landmark: '烽燧', asset: 'SM_Tripo_DesertBeaconTower' },
    { kind: 'box', at: [285, 110.6], size: [36, 0.8], top: 7.1, mat: 'earth', asset: 'SM_Tripo_DesertBeaconParapet' },
    { kind: 'box', at: [302.4, 121], size: [0.8, 22], top: 7.1, mat: 'earth', asset: 'SM_Tripo_DesertBeaconParapet' },
    { kind: 'box', at: [280, 145.4], size: [26, 0.8], top: 7.1, mat: 'earth', asset: 'SM_Tripo_DesertBeaconParapet' },
    { kind: 'box', at: [267.6, 121], size: [0.8, 20], top: 7.1, mat: 'earth', asset: 'SM_Tripo_DesertBeaconParapet' },
    { kind: 'box', at: [292, 128], size: [2, 2], top: 8.2, mat: 'timber', asset: 'SM_Tripo_DesertBrushwoodPile' },
    { kind: 'box', at: [284, 138], size: [2, 2], top: 8.2, mat: 'timber', asset: 'SM_Tripo_DesertBrushwoodPile' },
    // ④ 驼队残骸营地：残车 ×2、货堆（埋 0.5 m 成半身）、拒马、货摊（柜台 + 篷）、驼骨
    { kind: 'box', at: [318, 208], size: [3.8, 4], h: 1.8, rot: 20, mat: 'timber', asset: 'SM_Tripo_DesertCaravanWreck' },
    { kind: 'box', at: [342, 223], size: [3.8, 4], h: 1.8, rot: -35, mat: 'timber', asset: 'SM_Tripo_DesertCaravanWreck' },
    { kind: 'box', at: [326, 227], size: [1.7, 1.3], h: 1.1, rot: 10, mat: 'timber', asset: 'SM_Tripo_DesertGoodsPile', sink: 0.5 },
    { kind: 'box', at: [328.2, 228.4], size: [1.7, 1.3], h: 1.1, rot: 70, mat: 'timber', asset: 'SM_Tripo_DesertGoodsPile', sink: 0.5 },
    { kind: 'box', at: [337, 203], size: [1.7, 1.3], h: 1.1, mat: 'timber', asset: 'SM_Tripo_DesertGoodsPile', sink: 0.5 },
    { kind: 'box', at: [322, 196], size: [4.8, 1.2], h: 1.2, rot: -15, mat: 'timber', asset: 'SM_Tripo_DesertBarricade' },
    { name: '货摊', kind: 'box', at: [347, 211], size: [3.7, 1], h: 1, rot: 90, mat: 'timber', asset: 'SM_Tripo_DesertMarketStall' },
    { name: '货摊', kind: 'box', at: [347, 211], size: [2.2, 3.7], h: 3.6, clear: 2.4, canopy: true, mat: 'roof', asset: 'SM_Tripo_DesertMarketStall' },
    { kind: 'box', at: [330, 234], size: [3, 1.5], h: 0.8, rot: 30, mat: 'stone', needs: '半埋驼骨：侧卧的骆驼骨架半埋在沙里，约 3 × 1 × 1.5 m（近景叙事件）' },
    // ④ 营地南沿（构成复核 2026-11-26）：从北边进场看过去营地后面只有一道空沙丘线——补一处塌了一角的驿站院墙当背景块面（全身掩体），
    // 西南角残屋、第二个货摊、一辆整车、红柳收边；营地中心 12 m 内不加东西（交战区留干净）
    { kind: 'box', at: [322, 243], size: [14.6, 1], h: 3.2, rot: -8, mat: 'earth', asset: 'SM_Tripo_DesertPosthouseWall' },
    { kind: 'box', at: [305.5, 233], size: [9.7, 1], h: 2.6, rot: 75, mat: 'earth', asset: 'SM_Tripo_DesertPosthouseWall' },
    { kind: 'box', at: [310, 240.5], size: [4.8, 1.6], h: 4.3, rot: -20, mat: 'earth', asset: 'SM_Env_DesertRuin' },
    { name: '货摊2', kind: 'box', at: [309, 219], size: [3.7, 1], h: 1, rot: 70, mat: 'timber', asset: 'SM_Tripo_DesertMarketStall' },
    { name: '货摊2', kind: 'box', at: [309, 219], size: [2.2, 3.7], h: 3.6, clear: 2.4, canopy: true, rot: -20, mat: 'roof', asset: 'SM_Tripo_DesertMarketStall' },
    { kind: 'box', at: [354, 233], size: [4.93, 5.24], h: 2.37, rot: 55, mat: 'timber', asset: 'SM_Tripo_DesertCaravanWreck' },
    { kind: 'cyl', at: [298, 213], size: [1.3, 1.3], h: 3.4, mat: 'plant', asset: 'SM_Env_DesertTamarisk' },
    { kind: 'cyl', at: [362, 244], size: [1.3, 1.3], h: 3.4, mat: 'plant', asset: 'SM_Env_DesertTamarisk' },
    { kind: 'cyl', at: [337, 247], size: [1.3, 1.3], h: 3, mat: 'plant', asset: 'SM_Env_DesertTamarisk' },
    // 出口祭坛（传送门件，门面朝西对着来路）
    { kind: 'box', at: [405, 196], size: [3.3, 9.7], h: 11, mat: 'stone', landmark: '出口祭坛', asset: 'SM_Tripo_DesertPortalShrine' },
    // 驻守点的摆件：倒毙驼队（残车）、戍卒残营（拒马 + 火盆）
    { kind: 'box', at: [158, 122], size: [3.8, 4], h: 1.8, rot: 60, mat: 'timber', asset: 'SM_Tripo_DesertCaravanWreck' },
    { kind: 'box', at: [316, 171], size: [4.8, 1.2], h: 1.2, rot: 40, mat: 'timber', asset: 'SM_Tripo_DesertBarricade' },
    { kind: 'cyl', at: [327, 180], size: [0.65, 0.65], h: 2.4, mat: 'stone', asset: 'SM_Tripo_DesertBrazier' },
    // 藏宝：戍卒窖藏（角楼背后的宝藏堆）、商队遗货（孤岩背风面的宝藏堆 + 货堆）
    { kind: 'box', at: [96, 91], size: [2.6, 1.9], h: 1.8, mat: 'timber', asset: 'SM_Tripo_DesertTreasureHoard' },
    { kind: 'box', at: [212, 257], size: [2.6, 1.9], h: 1.8, rot: 20, mat: 'timber', asset: 'SM_Tripo_DesertTreasureHoard' },
    { kind: 'box', at: [208, 259], size: [1.7, 1.3], h: 1.1, rot: -20, mat: 'timber', asset: 'SM_Tripo_DesertGoodsPile', sink: 0.5 },
    // 干河床两岸的枯胡杨（给尺度；现有资产里没有，白盒里是 5–6 m 的细柱）
    { kind: 'cyl', at: [222, 108], size: [0.45, 0.45], h: 5.5, mat: 'plant', needs: '胡杨枯木：主干粗壮扭曲、三四根断头粗枝、无叶，高约 5.5 m' },
    { kind: 'cyl', at: [214, 146], size: [0.45, 0.45], h: 6, mat: 'plant', needs: '胡杨枯木：主干粗壮扭曲、三四根断头粗枝、无叶，高约 5.5 m' },
    { kind: 'cyl', at: [176, 172], size: [0.45, 0.45], h: 5, mat: 'plant', needs: '胡杨枯木：主干粗壮扭曲、三四根断头粗枝、无叶，高约 5.5 m' },
    { kind: 'cyl', at: [182, 206], size: [0.45, 0.45], h: 6, mat: 'plant', needs: '胡杨枯木：主干粗壮扭曲、三四根断头粗枝、无叶，高约 5.5 m' },
    { kind: 'cyl', at: [140, 222], size: [0.45, 0.45], h: 5.5, mat: 'plant', needs: '胡杨枯木：主干粗壮扭曲、三四根断头粗枝、无叶，高约 5.5 m' },
    { kind: 'cyl', at: [138, 256], size: [0.45, 0.45], h: 5, mat: 'plant', needs: '胡杨枯木：主干粗壮扭曲、三四根断头粗枝、无叶，高约 5.5 m' },
  ],
  play: [[6, 148], [46, 132], [66, 60], [96, 34], [150, 40], [205, 28], [262, 36], [318, 28], [372, 42], [394, 70], [410, 110], [406, 164],
    [412, 196], [408, 236], [400, 270], [384, 290], [350, 290], [250, 290], [150, 290], [96, 290], [72, 300], [60, 262], [52, 206], [6, 184]],
  spawn: { id: 'S', name: '出生 · 驿站残门', at: [30, 165], yaw: 90 },
  strongholds: [
    { id: '1', name: '黑戈壁砾石滩', at: [118, 165], r: 28, note: '入口战 6 只：跳鼠 ×4 + 蝎卫 ×2' },
    { id: '2', name: '雅丹石阵', at: [185, 84], r: 28, note: '2 波 8 只：蜃楼蟾 ×2、跳鼠 ×5、沙魇 ×1；矮丘可上顶俯射' },
    { id: '3', name: '烽燧台地', at: [287, 130], r: 28, note: '2 波 6 只：镇墓兽冲坡 + 邪飞天，台下援军；② ③ 先后不限' },
    { id: '4', name: '驼队残骸营地', at: [330, 215], r: 28, note: '2 波 12 只含 2 精英；周期沙暴从东边来；要先清 ② ③' },
  ],
  guards: [
    { id: 'G1', name: '倒毙驼队', at: [152, 126], note: '跳鼠 ×3 + 蝎卫' },
    { id: 'G2', name: '河源沙洲', at: [240, 104], note: '蜃楼蟾 + 跳鼠 ×3' },
    { id: 'G3', name: '戍卒残营', at: [322, 176], note: '火浣鼠 ×2 + 跳鼠 ×2 + 蝎卫' },
    { id: 'G4', name: '商队遗货守军', at: [218, 262], note: '跳鼠 ×2 + 蝎卫（守藏宝）' },
  ],
  entries: [
    { id: 'N1', name: '北沙丘背后（西）', at: [128, 56], mode: 'walk' },
    { id: 'N2', name: '北沙丘背后（东）', at: [258, 54], mode: 'walk' },
    { id: 'N3', name: '雅丹高丘跃下', at: [223, 62], mode: 'jump', from: [217, 55] },
    { id: 'N4', name: '营地东侧 · 沙暴来向', at: [372, 204], mode: 'walk' },
    { id: 'N5', name: '干河床下游', at: [104, 270], mode: 'walk' },
    { id: 'N6', name: '南冲沟沿', at: [272, 280], mode: 'walk' },
  ],
  caches: [
    { id: 'C1', name: '戍卒窖藏', at: [94, 92], r: 14, note: '长城角楼背后，无守军，金币' },
    { id: 'C2', name: '商队遗货', at: [212, 260], r: 14, note: '孤岩背风面，有守军，武器 +1' },
  ],
  exit: { id: 'E', name: '出口祭坛', at: [398, 196] },
  routes: [
    { id: 'main', name: '古道主线', kind: 'main', via: ['S', [84, 165], '1', 'G1', '2', 'G2', [240, 136], '3', [331, 152], 'G3', '4', 'E'] },
    { id: 'A', name: '北线：长城北豁口 → 戍卒窖藏 → ②', kind: 'alt', via: ['S', [72, 104], [86, 104], 'C1', '2'] },
    { id: 'B', name: '南线：绕长城南端下河床 → 商队遗货 → ④', kind: 'alt', via: ['1', [96, 230], [112, 262], 'C2', '4'] },
    { id: 'C', name: '古道线：浅滩 → 烽燧西坡道（先打 ③）', kind: 'alt', via: ['1', [188, 163], [240, 136], '3'] },
  ],
  sights: [
    { from: 'S', to: '烽燧', why: '出生第一眼就看见烽燧' },
    { from: '1', to: '烽燧', why: '① 看得见烽燧' },
    { from: '2', to: '烽燧', why: '② 看得见烽燧' },
    { from: [299, 140], to: '4', why: '烽燧台东南角（东坡道口）俯看 ④ 营地' },
    { from: '4', to: '出口祭坛', why: '④ 看得见出口' },
  ],
  views: [
    { name: 'concept', title: '概念图机位（自南向北斜俯瞰）', eye: [210, 205, 520], look: [210, 0, 150], fov: 36 },
  ],
};
