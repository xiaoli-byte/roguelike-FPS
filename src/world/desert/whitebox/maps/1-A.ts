import { WB_ASSETS } from '../assets';
import type { V2, WbBlock, WbMat, WhiteboxSpec } from '../types';

/**
 * 1-A 千佛崖 · 白盒（版面见 docs/art/concepts/ch1-routes/1-A_route_concept.jpg，定稿 raw/1-A_v3.png）。
 * 河湾外侧一道朝南的月牙形赭色长崖，母题是竖向分层，三层都能走能打：崖脚 0 m / 窟檐层 +8 m / 崖顶 +18 m。
 * 整张图是一场从河床到崖顶的攀登，据点按登高顺序编号：① 河洲驼队 → ② 大佛窟前 → ③ 西崖窟檐 → ④ 崖顶塔院。
 * 九层楼只是地标（两翼和大佛是实心的，只有脚下的敞厅能进）；上下层只走四条看得见的路：
 *   ① 楼左侧贴崖的木栈梯（两跑一平台，崖脚 → 窟檐层）  ② 西端崩塌碎石坡（窟檐层 → 崖顶）
 *   ③ 沙堆坡（河滩 → 窟檐层，宽、缓）                    ④ 东端之字石阶（崖脚 → 窟檐层东头 → 崖顶）
 * 月牙两角一直伸到河边，把崖脚阶地收住；河床上下游、崖顶北侧台地靠 play 软边界。
 * 竖向：河床 −0.6（河槽 −1.1）/ 沙洲 +0.8 / 崖脚 0 / 渡口台 +1.6 / 窟檐层 +8 / 崖顶 +18 / 九层楼顶 +35 / 寺塔顶 +42.6。
 *
 * 坡道的折线：每个拐角前后各留一段和半宽一样长的平段（同高），不然拐角内侧两段的高度对不上，会裂出一道迈不过去的坎。
 * 体块尽量对上已有资产（assets.ts）：尺寸直接取资产包围盒 × 缩放，换件时一对一；现有资产里没有的只有九层楼、木栈梯、白杨三样。
 */

/** 崖面线（18 m 崖顶的南沿），自西向东；第 i 段 = FACE[i] → FACE[i + 1] */
const FACE: V2[] = [[-10, 224], [40, 200], [66, 170], [88, 148], [114, 126], [158, 108], [196, 101], [234, 101], [264, 106], [292, 117.5], [316, 135.5], [342, 161], [372, 190], [430, 218]];
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;
/** 第 i 段的走向（单位向量） */
const dir = (i: number): V2 => {
  const a = FACE[i], b = FACE[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
};
/** 崖面第 i 段上的点：t = 从这一段西端沿崖面走多少米，out = 离崖面多远（正 = 朝外 / 朝河，负 = 进崖体） */
const onFace = (i: number, t: number, out = 0): V2 => {
  const a = FACE[i], d = dir(i);
  return [r1(a[0] + d[0] * t - d[1] * out), r1(a[1] + d[1] * t + d[0] * out)];
};
/** 顺着第 i 段崖面摆的体块该转多少度 */
const faceRot = (i: number): number => {
  const d = dir(i);
  return r1(Math.atan2(-d[1], d[0]) * 180 / Math.PI);
};
/** 崖面线第 from…to 个顶点整体往外推 out 米（窟檐层的中线） */
const offsetFace = (from: number, to: number, out: number): V2[] => {
  const pts: V2[] = [];
  for (let i = from; i <= to; i++) {
    const p = dir(Math.max(from, i - 1)), q = dir(Math.min(to - 1, i));
    const n0: V2 = [-p[1], p[0]], n1: V2 = [-q[1], q[0]];
    let bx = n0[0] + n1[0], bz = n0[1] + n1[1];
    const l = Math.hypot(bx, bz);
    bx /= l;
    bz /= l;
    const k = out / (bx * n0[0] + bz * n0[1]);
    pts.push([r1(FACE[i][0] + bx * k), r1(FACE[i][1] + bz * k)]);
  }
  return pts;
};

/** 窟檐层：进深 12 m（崖面外 0…12），中线离崖面 5 m、半宽 7（往崖体里多压 2 m 不留缝） */
const GALLERY_DEPTH = 12;
/** 窟檐层中线：从西头藏经洞（第 3 个顶点）到东头之字石阶的中段平台 */
const GALLERY: V2[] = [...offsetFace(3, 9, 5), onFace(9, 4.5, 5)];
/** ① 木栈梯（第 5 段崖面外）：下跑朝西升到 4 m 平台，折回来上跑朝东升到 8 m，末段平着贴在窟檐层和九层楼前廊边上 */
const STAIR: V2[] = [onFace(5, 32, 24.6), onFace(5, 18.5, 24.6), onFace(5, 14, 24.6), onFace(5, 14, 15.6), onFace(5, 18.5, 15.6), onFace(5, 28.5, 15.6), onFace(5, 35, 15.6)];
const STAIR_H = [0, 4, 4, 4, 4, 8, 8];
/** 栈梯脚（下跑起步前 2 m）、两跑之间的平台中心、上跑顶上的平段中心 */
const STAIR_FOOT = onFace(5, 34, 24.6), STAIR_LANDING = onFace(5, 14, 20.1), STAIR_HEAD = onFace(5, 31.5, 15.6);
/** ② 碎石坡（第 3 段）：从窟檐层里沿进崖体朝西北升到 12.2 m 的歇脚台，折向东北上崖顶 */
const RUBBLE_TURN = onFace(3, 22, -14), RUBBLE_TOP: V2 = [113, 107];
const RUBBLE: V2[] = [onFace(3, 22, 3), onFace(3, 22, -9.5), RUBBLE_TURN,
  [r1(RUBBLE_TURN[0] + (RUBBLE_TOP[0] - RUBBLE_TURN[0]) * 0.19), r1(RUBBLE_TURN[1] + (RUBBLE_TOP[1] - RUBBLE_TURN[1]) * 0.19)], RUBBLE_TOP];
const RUBBLE_H = [8, 12.2, 12.2, 12.2, 18];
/** ③ 沙堆坡：河滩 → 窟檐层（③ 平台东侧的墙角） */
const DRIFT: V2[] = [[151, 160], [158.2, 126.4], [156.9, 119]];
/**
 * ④ 之字石阶（第 9 段）：引阶朝崖走到 4 m → 贴崖朝西升到 8 m（窟檐层东头）→ 凿进崖体的两折 13 m、18 m 上崖顶。
 * 相邻两折中线隔 6 m（= 2 × 半宽），只在折返的平台处同高相通。
 */
const ZIG: V2[] = [
  onFace(9, 23.5, 18), onFace(9, 23.5, 6.5), onFace(9, 23.5, 3), onFace(9, 20, 3), onFace(9, 10, 3), onFace(9, 6.5, 3),
  onFace(9, 6.5, -3), onFace(9, 10, -3), onFace(9, 20, -3), onFace(9, 23.5, -3),
  onFace(9, 23.5, -9), onFace(9, 20, -9), onFace(9, 10, -9), onFace(9, 6.5, -9), onFace(9, 6.5, -13),
];
const ZIG_H = [0, 4, 4, 4, 8, 8, 8, 8, 13, 13, 13, 13, 18, 18, 18];

// ───────────── 已有资产 ─────────────
const CLIFF = 'SM_Env_DesertCliff', PLATFORM = 'SM_Tripo_DesertPlatformBlock', CLOISTER = 'SM_Tripo_DesertCloister', ARCH = 'SM_Tripo_DesertRockArch';
const POSTWALL = 'SM_Tripo_DesertPosthouseWall', COVERWALL = 'SM_Tripo_DesertCoverWall', PARAPET = 'SM_Tripo_DesertBeaconParapet', GATEWAY = 'SM_Tripo_DesertGateway';
const PAGODA = 'SM_Tripo_DesertTemplePagoda', FINIAL = 'SM_Tripo_DesertFinial', STUPA = 'SM_Tripo_DesertStupaBuried', SHRINE = 'SM_Tripo_DesertPortalShrine';
const BUDDHA = 'SM_Tripo_DesertSeatedColossus', STELE = 'SM_Prop_DesertStele', BURNER = 'SM_Prop_DesertIncenseBurner', BRAZIER = 'SM_Tripo_DesertBrazier';
const COLUMN_RUIN = 'SM_Tripo_DesertColumnRuin', RUIN = 'SM_Env_DesertRuin', BOULDER = 'SM_Env_DesertSandstone', GATE_OLD = 'SM_Env_DesertGate';
const WRECK = 'SM_Tripo_DesertCaravanWreck', GOODS = 'SM_Tripo_DesertGoodsPile', BARRICADE = 'SM_Tripo_DesertBarricade', STALL = 'SM_Tripo_DesertMarketStall';
const HOARD = 'SM_Tripo_DesertTreasureHoard', RELIQUARY = 'SM_Prop_DesertReliquary';
// ───────────── 现有资产里没有、要新做的 ─────────────
const NEED_PAVILION = '九层楼：贴崖的九层木构楼阁立面（底层是只有柱子的敞厅，正中通高佛龛，龛里坐已有的敦煌坐像）；宽 28 × 深 14 × 高 35 m，敞厅向前再出 12 m';
const NEED_STAIR = '贴崖木栈梯：立在木柱上的外挂楼梯，两跑一平台、带栏杆；每跑宽 8 m、升 4 m、水平 10–14 m';
const NEED_POPLAR = '白杨：金叶高树，8–11 m，南岸成林（散布件）';

interface PieceOpt { s?: number; n?: number; rot?: number; sink?: number; mat?: WbMat; name?: string; landmark?: string }
/**
 * 一件已有资产：体块 = 资产包围盒 × 缩放 s；n = 沿长向连排几件；sink = 半埋几米（露出地面的高度 = 资产高 × s − sink）。
 * 资产正面朝 +Z、长向沿 X，rot 是俯视逆时针。
 */
const piece = (asset: string, at: V2, o: PieceOpt = {}): WbBlock => {
  const [w, h, d] = WB_ASSETS[asset].size, s = o.s ?? 1;
  const b: WbBlock = { kind: 'box', at, size: [r2(w * s * (o.n ?? 1)), r2(d * s)], h: r2(h * s - (o.sink ?? 0)), mat: o.mat ?? 'stone', asset };
  if (o.rot) b.rot = o.rot;
  if (o.sink) b.sink = o.sink;
  if (o.name) b.name = o.name;
  if (o.landmark) b.landmark = o.landmark;
  return b;
};

/**
 * 回廊（寺院回廊 · 二层，一跨 6.17 × 7.5 × 2.85，前敞后实）沿第 i 段崖面连排 n 跨：从 t0 起，背贴 inner，立在 base 高度上。
 * 每跨 = 一块悬空的二层楼板和屋顶（人从底层柱廊下走得过去）+ 檐柱；同名的体块算同一件。
 */
const cloister = (tag: string, i: number, t0: number, n: number, base: number, inner: number): WbBlock[] => {
  const [w, h, d] = WB_ASSETS[CLOISTER].size, rot = faceRot(i), out: WbBlock[] = [];
  const post = (k: number, name: string): WbBlock => ({ name, kind: 'cyl', at: onFace(i, t0 + w * k, inner + d - 0.3), size: [0.3, 0.3], top: base + h, mat: 'timber', asset: CLOISTER });
  for (let k = 0; k < n; k++) {
    const name = `${tag} ${k + 1}`;
    out.push({ name, kind: 'box', at: onFace(i, t0 + w * (k + 0.5), inner + d / 2), size: [w, d], top: base + h, clear: base + 3, rot, canopy: true, mat: 'roof', asset: CLOISTER }, post(k, name));
    if (k === n - 1) out.push(post(n, name));
  }
  return out;
};

/**
 * 窟檐层上的洞口：一座岩拱（15.68 × 13 × 6.61 缩到 10 m 高，顶和崖顶齐平）背靠崖面，两条拱脚实心、拱顶悬空，拱下是进深 4.5 m 的龛。
 * 藏经洞是封着的洞门，另两处是怪出来的洞口。
 */
const caveMouth = (name: string, i: number, t: number): WbBlock[] => {
  const [w, h, d] = WB_ASSETS[ARCH].size, s = 10 / h, foot = w * s * 0.27, rot = faceRot(i);
  const pier = (side: 1 | -1): WbBlock => ({ name, kind: 'box', at: onFace(i, t + side * (w * s - foot) / 2, 2), size: [r2(foot), r2(d * s)], top: 18, rot, mat: 'rock', asset: ARCH });
  return [pier(-1), pier(1), { name, kind: 'box', at: onFace(i, t, 2), size: [r2(w * s), r2(d * s)], top: 18, clear: 14.5, rot, canopy: true, mat: 'rock', asset: ARCH }];
};

/** 白杨（给尺度的细高柱；现有资产里没有树） */
const poplar = (x: number, z: number, h = 10): WbBlock => ({ kind: 'cyl', at: [x, z], size: [0.5, 0.5], h, mat: 'plant', needs: NEED_POPLAR });
/** 九层楼的零件（同一件新资产） */
const pavilion = (b: Omit<WbBlock, 'name' | 'needs'>): WbBlock => ({ ...b, name: '九层楼', needs: NEED_PAVILION });

/** 塔院：围墙里沿 x 164…220、z 44…82；塔基台 3 × 3 块台基块 */
const PLAT_D = WB_ASSETS[PLATFORM].size[2], PLAT_TOP = 2.4, PLAT_SINK = r2(WB_ASSETS[PLATFORM].size[1] - PLAT_TOP);
const PAGODA_AT: V2 = [192, 54], PAGODA_TOP = r2(18 + PLAT_TOP + WB_ASSETS[PAGODA].size[1]);
/** 山门（城门缩到 0.8 倍）：两侧门墩实心、门楼悬空，门洞约 3.6 m */
const GATE_S = 0.8, [GATE_W, GATE_H, GATE_D] = WB_ASSETS[GATEWAY].size, GATE_FOOT = GATE_W * GATE_S / 3;
/** 渡口门架（旧门件）：两根柱 + 门楣，框住对岸的崖 */
const [FRAME_W, FRAME_H, FRAME_D] = WB_ASSETS[GATE_OLD].size;

export const WB_1_A: WhiteboxSpec = {
  id: '1-A',
  name: '千佛崖',
  motif: '竖向分层',
  mood: '午后斜阳从西南照过来，把千佛崖照成一面金壁；崖脚的河床还在冷影里，寺塔的塔尖是全场最亮的一点。',
  size: [420, 320],
  sun: { azimuth: 236, elevation: 33 },
  wind: [0.94, 0.34],
  terrain: [
    { op: 'base', h: 0, mat: 'sand' },
    { op: 'noise', amp: 0.6, scale: 48, seed: 21, keep: [{ at: [215, 138], r: 30 }, { at: [250, 200], r: 28 }, { at: [165, 252], r: 16 }] },
    // 南岸尽头的沙垄（缓面朝北 = 朝图里，白杨林长在它脚下）
    { op: 'ridge', pts: [[-10, 314], [100, 310], [210, 315], [320, 310], [430, 314]], h: [5, 6, 4.5, 6, 5], stoss: 20, side: 1, mat: 'dune' },
    // 宕泉河：宽阔的干河床（−0.6 m）绕着崖脚向北鼓出去，里面两股河槽（−1.1 m）加两条辫流
    { op: 'channel', pts: [[-10, 268], [40, 245], [90, 223], [150, 201], [205, 193], [262, 198], [310, 211], [345, 226], [380, 244], [430, 268]], half: 32, h: -0.6, bank: 8, mat: 'mud' },
    { op: 'channel', pts: [[-10, 251], [40, 228], [90, 206], [150, 185], [205, 176], [250, 177], [300, 192], [345, 212], [380, 230], [430, 252]], half: 7, h: -1.1, bank: 4, mat: 'gravel' },
    { op: 'channel', pts: [[-10, 285], [40, 262], [90, 240], [150, 218], [205, 211], [250, 220], [300, 229], [345, 240], [380, 258], [430, 284]], half: 7, h: -1.1, bank: 4, mat: 'gravel' },
    { op: 'channel', pts: [[90, 206], [120, 207], [150, 218]], half: 5, h: -1, bank: 3, mat: 'gravel' },
    { op: 'channel', pts: [[300, 229], [322, 217], [345, 212]], half: 5, h: -1, bank: 3, mat: 'gravel' },
    // ① 河心沙洲（+0.8 m，四面缓坡上得去）
    { op: 'mound', at: [250, 200], r: [28, 14], h: 1.4, base: -0.6, rot: -5, shape: 'mesa', flat: 0.6, mat: 'sand' },
    // ② 大佛窟前的广场（平，石铺）
    { op: 'disc', at: [215, 139], r: 20, h: 0, edge: 8, mode: 'set', mat: 'stone' },
    // ③ 沙堆坡：一堆靠在崖脚墙角里的沙（圆丘）+ 顶上踩实的一条脊，坡顶和窟檐层齐平。排在窟檐层和崖体前面：只抬不压，沙色不会染到窟檐层和崖顶上
    { op: 'mound', at: [157.3, 122.5], r: [38, 18], h: 7.7, rot: 78, mat: 'dune' },
    { op: 'ramp', pts: DRIFT, hs: [0, 8, 8], half: 5, edge: 4, mode: 'max', mat: 'dune' },
    // 窟檐层（+8 m）：贴着崖面的一条岩台 / 栈道，外沿直壁（下崖壁用崖壁段贴面）；③ 那段加宽成一块平台，九层楼脚下鼓出一圈前廊
    { op: 'ramp', pts: GALLERY, hs: GALLERY.map(() => 8), half: 7, edge: 0, mode: 'max', mat: 'timber', asset: CLIFF },
    { op: 'poly', pts: [onFace(4, 2, -2), onFace(4, 34, -2), onFace(4, 34, 20), onFace(4, 2, 20)], h: 8, edge: 0, mode: 'max', mat: 'timber' },
    { op: 'poly', pts: [[194, 103], [236, 103], [236, 120], [194, 120]], h: 8, edge: 0, mode: 'max', mat: 'timber' },
    // 崖体（+18 m）：月牙形，崖面近乎直立；崖顶是平的砾石台地，北边远处两道矮台地收天际线。
    // 上崖壁（窟檐层以上 10 m）搭景时还是那件崖壁段放大 1.16 倍贴面——这里不标 asset：复用清单按图章的绝对高度 18 m 算缩放，会误报
    { op: 'poly', pts: [...FACE, [430, -10], [-10, -10]], h: 18, edge: 1.2, mode: 'max', mat: 'rock' },
    { op: 'paint', mat: 'gravel', closed: true, pts: [...FACE.map((p): V2 => [p[0], p[1] - 4.5]), [430, -10], [-10, -10]] },
    { op: 'mound', at: [110, 8], r: [70, 13], h: 8, base: 18, shape: 'mesa', mat: 'rock' },
    { op: 'mound', at: [330, 6], r: [80, 12], h: 10, base: 18, shape: 'mesa', mat: 'rock' },
    // ① 木栈梯：每跑宽 8 m，下跑 17°、上跑 22°，西头一个 4 m 高的平台
    { op: 'ramp', pts: STAIR, hs: STAIR_H, half: 4, edge: 0, mode: 'max', mat: 'timber' },
    // ② 崩塌碎石坡：在崖体上豁开一道口子，8 → 12.2 → 18 m（17–19°），两侧是塌下来的碎石斜面
    { op: 'ramp', pts: RUBBLE, hs: RUBBLE_H, half: 4, edge: 4, mode: 'set', mat: 'stone' },
    // ④ 之字石阶：0 → 4 → 8（窟檐层东头）→ 13 → 18 m，下两折 19–22°、上两折 27°
    { op: 'ramp', pts: ZIG, hs: ZIG_H, half: 3, edge: 0, mode: 'set', mat: 'stone' },
    // S 渡口残台（+1.6 m 的石台，台基块拼）+ 朝东北下河床的石阶
    { op: 'poly', pts: [[153, 242], [177, 242], [177, 262], [153, 262]], h: 1.6, edge: 0.8, mode: 'max', mat: 'stone', asset: PLATFORM },
    { op: 'ramp', pts: [[175.5, 249], [191, 230]], hs: [1.6, -0.4], half: 4, edge: 1.5, mode: 'set', mat: 'stone' },
    // 铺地：塔院、崖顶香道（碎石坡顶 → 塔院西南角的豁口；东南角的豁口 → 沿崖沿白塔 → 出口）、河滩上的车辙
    { op: 'paint', mat: 'stone', closed: true, pts: [[164, 44], [220, 44], [220, 82], [164, 82]] },
    { op: 'paint', mat: 'road', half: 3, pts: [RUBBLE_TOP, [140, 94], [170, 78], [192, 70], [214, 78], [236, 88], [262, 94], [284, 100], [305, 102]] },
    { op: 'paint', mat: 'road', half: 3, pts: [[191, 230], [208, 224], [236, 206]] },
  ],
  blocks: [
    // 九层楼：贯通三层的高木构立面，只是地标。两翼实心、正中佛龛里坐大佛（已有的敦煌坐像 × 0.85，坐在窟檐层高度），上面几层收分的楼阁是悬空的
    pavilion({ kind: 'box', at: [205.4, 101], size: [9.2, 14], top: 25, mat: 'timber' }),
    pavilion({ kind: 'box', at: [224.6, 101], size: [9.2, 14], top: 25, mat: 'timber' }),
    { name: '大佛', kind: 'box', at: [215, 103.2], size: [r2(WB_ASSETS[BUDDHA].size[0] * 0.85), r2(WB_ASSETS[BUDDHA].size[2] * 0.85)], top: 8 + WB_ASSETS[BUDDHA].size[1] * 0.85, mat: 'stone', asset: BUDDHA },
    pavilion({ kind: 'box', at: [215, 101], size: [28, 14], top: 29, clear: 25, canopy: true, mat: 'timber' }),
    pavilion({ kind: 'box', at: [215, 100.5], size: [22, 11], top: 32, clear: 29, canopy: true, mat: 'timber' }),
    pavilion({ kind: 'box', at: [215, 100], size: [14, 8], top: 35, clear: 32, canopy: true, mat: 'roof', landmark: '九层楼' }),
    // 底层敞厅（九层楼的一部分）：只有柱子和悬空的屋顶，人从柱间穿过去
    pavilion({ kind: 'box', at: [215, 126], size: [30, 12], top: 6.8, clear: 6, canopy: true, mat: 'roof' }),
    ...[203, 211, 219, 227].flatMap((x): WbBlock[] => [122, 130].map((z): WbBlock => pavilion({ kind: 'cyl', at: [x, z], size: [0.6, 0.6], h: 6, mat: 'timber' }))),
    // 前廊（窟檐层）外沿的垛墙：俯射广场的远程位
    piece(PARAPET, [205, 119.6], { n: 4, mat: 'timber' }),
    piece(PARAPET, [225, 119.6], { n: 4, mat: 'timber' }),
    // ② 广场：龟趺碑、香炉、火盆（全身），掩体矮墙半埋、倒伏石柱（半身），中间留跑道
    piece(STELE, [203, 146]),
    piece(STELE, [227, 146]),
    piece(BURNER, [215, 151], { s: 1.3 }),
    piece(BRAZIER, [199, 135]),
    piece(BRAZIER, [231, 135]),
    piece(COVERWALL, [199, 155], { sink: 1.5 }),
    piece(COVERWALL, [231, 155], { sink: 1.5 }),
    piece(COLUMN_RUIN, [195, 143], { s: 0.7, rot: 70 }),
    piece(COLUMN_RUIN, [237, 141], { s: 0.7, rot: -60 }),
    // 窟檐：贴崖的二层回廊连排（跃下点、洞口那几段留空）；崖脚广场东侧还有一排下寺回廊
    ...cloister('窟檐回廊 · 西', 4, 22.5, 2, 8, 1),
    ...cloister('窟檐回廊 · 栈梯后', 5, 3, 4, 8, 1),
    ...cloister('窟檐回廊 · 东', 7, 4, 4, 8, 1),
    ...cloister('窟檐回廊 · 东头甲', 8, 2, 1, 8, 1),
    ...cloister('窟檐回廊 · 东头乙', 8, 21.5, 1, 8, 1),
    ...cloister('下寺回廊', 7, 6, 3, 0, GALLERY_DEPTH + 0.1),
    // 洞口：藏经洞（窟檐层最西头，封着）、西 / 东两个怪出来的洞口
    ...caveMouth('藏经洞', 3, 6.5),
    ...caveMouth('洞口 · 西', 4, 8),
    ...caveMouth('洞口 · 东', 8, 15),
    piece(RELIQUARY, onFace(3, 6.5, 1.7), { rot: faceRot(3) }),
    // ③ 西崖窟檐平台：外沿垛墙（半身）、碑和香炉（全身）、货堆（半身）；贴崖一侧留 8 m 跑道
    piece(PARAPET, onFace(4, 8, 19.6), { n: 4, rot: faceRot(4), mat: 'timber' }),
    piece(PARAPET, onFace(4, 19, 19.6), { n: 4, rot: faceRot(4), mat: 'timber' }),
    piece(PARAPET, onFace(4, 29.5, 19.6), { n: 4, rot: faceRot(4), mat: 'timber' }),
    piece(STELE, onFace(4, 11, 14.5), { rot: faceRot(4) }),
    piece(BURNER, onFace(4, 26, 14.5), { s: 1.3, rot: faceRot(4) }),
    piece(GOODS, onFace(4, 18.5, 15.5), { s: 0.7, n: 2, rot: faceRot(4), mat: 'timber' }),
    piece(GOODS, onFace(4, 4.5, 15.5), { s: 0.7, n: 2, rot: faceRot(4) + 90, mat: 'timber' }),
    // 东段窟檐：洞口旁的货堆
    piece(GOODS, onFace(8, 24.5, 10), { s: 0.7, n: 2, rot: faceRot(8), mat: 'timber' }),
    // ① 木栈梯平台角上的望柱（木栈梯是要新做的件，走的面是上面那条坡道）
    { name: '木栈梯', kind: 'cyl', at: onFace(5, 11.4, 27.2), size: [0.3, 0.3], h: 2.4, mat: 'timber', needs: NEED_STAIR },
    // 碎石坡两侧的塌石（砂岩巨砾，都在斜面上，不占坡道）
    piece(BOULDER, [106.5, 124.5], { rot: 30, mat: 'rock' }),
    piece(BOULDER, [88.5, 124], { rot: -20, mat: 'rock' }),
    piece(BOULDER, [100, 109], { rot: 15, mat: 'rock' }),
    // ④ 崖顶塔院：驿站残墙连排的院墙（3.2 m）。北墙和东西墙的北段还在，西南、东南两个墙角整段塌了（各 18 m 宽的豁口，主线从这儿进出）；
    // 朝南一座山门、两侧各剩一小段墙，北墙下两间残屋
    piece(POSTWALL, [192, 44], { n: 12, mat: 'earth' }),
    piece(POSTWALL, [164, 56.7], { n: 5, rot: 90, mat: 'earth' }),
    piece(POSTWALL, [220, 56.7], { n: 5, rot: 90, mat: 'earth' }),
    piece(POSTWALL, [181.7, 82], { n: 2, mat: 'earth' }),
    piece(POSTWALL, [202.3, 82], { n: 2, mat: 'earth' }),
    ...[-1, 1].map((side): WbBlock => ({ name: '山门', kind: 'box', at: [192 + side * (GATE_W * GATE_S - GATE_FOOT) / 2, 82], size: [r2(GATE_FOOT), r2(GATE_D * GATE_S)], h: r2(GATE_H * GATE_S), mat: 'earth', asset: GATEWAY })),
    { name: '山门', kind: 'box', at: [192, 82], size: [r2(GATE_W * GATE_S), r2(GATE_D * GATE_S)], top: 18 + r2(GATE_H * GATE_S), clear: 23, canopy: true, mat: 'roof', asset: GATEWAY },
    piece(RUIN, [176, 46.5], { mat: 'earth' }),
    piece(RUIN, [208, 46.5], { mat: 'earth' }),
    // 塔基台（+2.4 m）：台基块 3 × 3（每排 3 块连排，下面埋 0.46 m）
    ...[-1, 0, 1].map((row): WbBlock => piece(PLATFORM, [PAGODA_AT[0], PAGODA_AT[1] + row * PLAT_D], { n: 3, sink: PLAT_SINK })),
    // 寺塔（22 m，立在塔基台上，塔尖 +42.6 m）：塔身实心（圆柱，半径 3.3 m），三层出檐悬空。sink 是负的 = 垫高 2.4 m（站在台上，不是埋进地里）
    { name: '寺塔', kind: 'cyl', at: PAGODA_AT, size: [3.3, 3.3], top: PAGODA_TOP, sink: -PLAT_TOP, mat: 'earth', landmark: '寺塔', asset: PAGODA },
    { name: '寺塔', kind: 'box', at: PAGODA_AT, size: [WB_ASSETS[PAGODA].size[0], WB_ASSETS[PAGODA].size[2]], top: 24.6, clear: 23.6, canopy: true, mat: 'roof', asset: PAGODA },
    { name: '寺塔', kind: 'box', at: PAGODA_AT, size: [8.8, 8.8], top: 30.6, clear: 29.8, canopy: true, mat: 'roof', asset: PAGODA },
    { name: '寺塔', kind: 'box', at: PAGODA_AT, size: [7.8, 7.8], top: 36.6, clear: 35.8, canopy: true, mat: 'roof', asset: PAGODA },
    // 塔院里的掩体：香炉、火盆（全身），掩体矮墙半埋、倒伏石柱（半身），碑；两个豁口之间（西南 → ④ → 东南）留 10 m 跑道
    piece(BURNER, [192, 61.4], { s: 1.3 }),
    piece(BRAZIER, [182, 61]),
    piece(BRAZIER, [202, 61]),
    piece(COVERWALL, [176, 66], { sink: 1.5 }),
    piece(COVERWALL, [208, 66], { sink: 1.5 }),
    piece(COLUMN_RUIN, [192, 77.5], { s: 0.7, rot: 20 }),
    piece(STELE, [172, 53]),
    piece(STELE, [212, 53]),
    // 崖沿一排小白塔（塔刹，贴着崖沿立 = 从河床看是崖顶天际线上的一排剪影；香道走在塔的北侧）+ 西头碎石坡顶的半埋佛塔
    piece(FINIAL, [248, 98.8]), piece(FINIAL, [259.5, 100.7]), piece(FINIAL, [271, 104.4]), piece(FINIAL, [282, 108.9]),
    piece(STUPA, [128, 106], { s: 0.6 }),
    // 出口祭坛（传送门缩到 0.8 倍，门面朝西 = 朝来路）
    piece(SHRINE, [312, 101], { s: 0.8, rot: 90, landmark: '出口祭坛' }),
    // ① 河洲驼队：残车（放大到全身）、货摊、货堆半埋和拒马（半身）
    piece(WRECK, [239, 194.5], { s: 1.25, rot: 20, mat: 'timber' }),
    piece(WRECK, [259.5, 204], { s: 1.25, rot: -30, mat: 'timber' }),
    piece(STALL, [253, 189.5], { rot: 10, mat: 'roof' }),
    piece(GOODS, [247, 208.5], { n: 2, sink: 0.5, rot: 10, mat: 'timber' }),
    piece(GOODS, [258, 195], { n: 2, sink: 0.5, rot: -75, mat: 'timber' }),
    piece(BARRICADE, [232, 199.5], { s: 0.9, rot: -70, mat: 'timber' }),
    piece(BARRICADE, [266.5, 196], { s: 0.9, rot: 25, mat: 'timber' }),
    // S 渡口残台：驿站残墙（全身）、掩体矮墙半埋（半身）、门架（框住对岸的崖）
    piece(POSTWALL, [155, 252], { n: 2, rot: 90, mat: 'earth' }),
    piece(COVERWALL, [165, 261], { n: 3, sink: 1.5, mat: 'earth' }),
    ...[-1, 1].map((side): WbBlock => ({ name: '渡口门架', kind: 'cyl', at: [168 + side * (FRAME_W / 2 - 0.5), 243.5], size: [0.5, 0.5], h: FRAME_H, mat: 'timber', asset: GATE_OLD })),
    { name: '渡口门架', kind: 'box', at: [168, 243.5], size: [FRAME_W, FRAME_D], top: 1.6 + FRAME_H, clear: 1.6 + FRAME_H - 1.2, canopy: true, mat: 'timber', asset: GATE_OLD },
    // 河滩遗骸（藏宝）：宝藏堆
    piece(HOARD, [241.5, 267.5], { rot: 20, mat: 'timber' }),
    // 崖脚阶地的落石（整块全身 / 半埋半身）
    piece(BOULDER, [112, 160], { rot: 20, mat: 'rock' }),
    piece(BOULDER, [100, 168], { rot: -10, sink: 1.8, mat: 'rock' }),
    piece(BOULDER, [282, 153], { rot: 35, mat: 'rock' }),
    // 南岸白杨林（成簇，出生点到地标的视线上不种）
    poplar(140, 256), poplar(133, 266, 11), poplar(144, 272), poplar(128, 278, 9), poplar(150, 282, 11), poplar(136, 288), poplar(120, 262, 9),
    poplar(190, 268, 11), poplar(198, 280), poplar(210, 266, 9), poplar(184, 286), poplar(216, 288, 11),
    poplar(268, 256), poplar(280, 268, 11), poplar(292, 254, 9), poplar(304, 266), poplar(286, 284, 11), poplar(318, 258), poplar(322, 280, 9),
    // 崖顶塔院外的树
    poplar(156, 52, 8), poplar(228, 50, 8), poplar(142, 74, 7),
  ],
  play: [[82, 28], [334, 28], [338, 120], [348, 152], [362, 186], [384, 232], [384, 268], [370, 300], [56, 300], [30, 262], [28, 236], [46, 204], [70, 172], [80, 140]],
  // 出生点退到渡口台后半：门架在前面 12 m，正好把九层楼和寺塔框在两根柱子中间
  spawn: { id: 'S', name: '出生 · 对岸渡口台', at: [165, 256], yaw: 14 },
  strongholds: [
    { id: '1', name: '河洲驼队', at: [250, 200], r: 24, note: '2 波 13 只（驼队残兵 → 河床伏兵）；残车、拒马、货堆' },
    { id: '2', name: '大佛窟前', at: [215, 140], r: 22, note: '3 波 15 只；九层楼脚下的广场，前廊垛墙后有远程位' },
    { id: '3', name: '西崖窟檐', at: onFace(4, 18, 9), r: 20, note: '3 波 14 只；8 m 高的平台，崖顶有怪跃下、飞天飞临' },
    { id: '4', name: '崖顶塔院', at: [192, 70], r: 20, note: '3 波 16 只含 2 精英（千佛护法）；寺塔 + 塔基台远程位' },
  ],
  guards: [
    { id: 'G1', name: '河床伏兵', at: [208, 224], note: '跳鼠 ×2 + 火浣鼠，朝渡口来路' },
    { id: 'G2', name: '栈梯平台', at: STAIR_LANDING, note: '跳鼠 ×2 + 蝎卫，守两跑之间的平台' },
    { id: 'G3', name: '崖沿白塔', at: [262, 94], note: '蝎卫 ×2 + 跳鼠，守香道' },
    { id: 'G4', name: '遗骸守军', at: [230, 258], note: '5 只，调查遗骸时惊动（守藏宝）' },
  ],
  entries: [
    { id: 'N1', name: '崖沿跃下 · 落到西崖窟檐', at: onFace(4, 17, 5.5), mode: 'jump', from: onFace(4, 17, -2.5) },
    { id: 'N2', name: '宕泉河上游', at: [46, 240], mode: 'walk' },
    { id: 'N3', name: '白杨林后', at: [148, 296], mode: 'walk' },
    { id: 'N4', name: '窟檐洞口（西）', at: onFace(4, 8, 2.6), mode: 'walk' },
    { id: 'N5', name: '窟檐洞口（东）', at: onFace(8, 15, 2.6), mode: 'walk' },
    { id: 'N6', name: '寺塔上空飞临', at: [170, 36], mode: 'fly' },
    { id: 'N7', name: '窟檐跃下 · 落到崖脚', at: onFace(7, 14, GALLERY_DEPTH + 4.6), mode: 'jump', from: onFace(7, 14, GALLERY_DEPTH - 1.5) },
  ],
  caches: [
    { id: 'C1', name: '藏经洞', at: onFace(3, 6.5, 3.4), r: 10, note: '窟檐层最西头的洞门前，无守军，秘卷' },
    { id: 'C2', name: '河滩遗骸', at: [238, 266], r: 14, note: '南岸白杨林边，有守军，武器（保底精良）' },
  ],
  exit: { id: 'E', name: '出口祭坛', at: [305, 102] },
  routes: [
    {
      id: 'main', name: '登崖主线', kind: 'main',
      via: ['S', 'G1', '1', '2', STAIR_FOOT, 'G2', STAIR_HEAD, '3', RUBBLE[0], RUBBLE_TURN, RUBBLE_TOP, '4', 'G3', 'E'],
      note: '渡口 → 河洲 → 大佛窟前 → 木栈梯 → 窟檐层向西 → 西崖窟檐 → 碎石坡 → 崖顶塔院 → 沿崖沿白塔 → 出口',
    },
    { id: 'A', name: '东线：① → 之字石阶直上崖顶', kind: 'alt', via: ['1', ZIG[0], ZIG[2], ZIG[6], ZIG[10], ZIG[14], 'E'] },
    { id: 'B', name: '西线：河床 → 沙堆坡 → 窟檐层 → ③', kind: 'alt', via: ['S', [160, 196], DRIFT[0], DRIFT[1], '3'] },
    { id: 'C', name: '窟檐线：栈梯顶向东 → 九层楼前廊 → 东段窟檐 → 之字石阶上段', kind: 'alt', via: ['G2', STAIR_HEAD, [215, 114], onFace(7, 14, 8), ZIG[5], ZIG[10], 'E'] },
  ],
  sights: [
    { from: 'S', to: '九层楼', why: '出生第一眼看见九层楼' },
    { from: 'S', to: '寺塔', why: '出生第一眼看见崖顶寺塔' },
    { from: '1', to: '九层楼', why: '① 河洲看得见九层楼（下一处在它脚下）' },
    { from: '3', to: '九层楼', why: '③ 窟檐上回头看得见九层楼' },
    { from: RUBBLE_TOP, to: '寺塔', why: '碎石坡一上崖顶就看见寺塔' },
    { from: [232, 90], to: '出口祭坛', why: '出塔院东南豁口、绕过九层楼背后，就看得见出口祭坛' },
  ],
  views: [
    { name: 'concept', title: '概念图机位（自南向北斜俯瞰）', eye: [212, 150, 420], look: [212, 0, 150], fov: 36 },
  ],
};
