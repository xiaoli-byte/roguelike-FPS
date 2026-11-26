import * as THREE from 'three';
import { Atmosphere } from '../Atmosphere';
import type { DesertPart, Rgb } from './spec';

/**
 * 远景剪影层（docs/art/level-art.md「远中近三层：远景只管剪影和气氛」「雾分层：远景一层层退进雾里」，composition.md 8.1 / 8.2）。
 * 看得见走不到的远景一律程序化（不用 Tripo）：围着可玩区摆 3–5 排错开高度和进深的剪影环——
 *   沙丘脊  迎风坡缓（约 15°）、背风落沙坡陡（约 31°），脊线是一道尖角；侧着看是一排锯齿，顺着风看是一道长长的缓脊；
 *   台地    赭红方山：平顶、上半截陡崖（盖岩）、下半截凹进去的碎屑坡；三成带一级低台；
 *   雅丹    船形长丘，顺风排成一队：迎风的船头钝而陡、背风的船尾拖长变低；三五条一簇（舰群）。
 * 每排一条「帘子」：一圈轮廓带（正面按种类往外倾，台地带平顶；底边往下拖一截裙边，相机升高时也盖得住地平线以下），
 * 一排一个网格、一次绘制调用。构图上要的地物用 pins 钉在指定方位（太阳底下的逆光方山），缺口用 sectors 留。
 *
 * 画在相机 far 之外也不被裁（同 CloudSky 的天球卡）：顶点在真实的世界位置（走动时远景有真实的视差），裁剪空间的 z 换成
 * w × (1 − 1e-6)，不被远裁面切掉；深度在片段里自己写（gl_FragDepth）：按到相机的真实距离（对数）压进远裁面前一条很窄的带子
 * ——24 位深度里约 160 级，带子的前沿在 far × 0.87（雾终点 × 1.3，那里的场景件早已全白进雾色）。于是场景件都挡得住它、
 * 它挡得住云（云在 z = w 上），同一排里的台地顶面 / 正面 / 高低相邻的列也按真实远近互相遮挡（只靠三角形顺序的话，
 * 从高处俯看会穿插成一片碎块）。在不透明队列里画，renderOrder −995…−991（天球 −1000 之后、场景 0 之前；远的排先画）。
 *
 * 颜色（显示空间，同 Atmosphere；每帧读，不写死）：
 *   本色    平涂三档：背光面 = 天光（Atmosphere 的空气色）往蓝紫灰里偏；受光面 = 反照率 × 日光（sfSunLight，已乘主光能量）。
 *           法线是「假」的：帘子面朝中心，按轮廓的坡度往两侧偏、按种类往上抬——逆光时整排是暗的剪影，顺光时陡崖受光、背光的侧面偏冷。
 *   空气    每排一个空气透视值（不给按距离算）：越远越淡、越冷、越接近背后那一片天——着色器里照场景渐变天球的公式
 *           （UnityEnvironment 的 SKY_FRAGMENT，去掉日盘，同样做色调映射 / 编码）逐像素算出这个方向的天色，最远一排几乎化进天里、
 *           顶沿和天接得上；近排偏雾色。剪影永远比背后的天暗（逆光出剪影，天是画面里最亮的）。没有渐变天球就用雾色往亮里偏。
 *   轮廓光  顶沿一道约 2 像素的暖金边：逆光（朝太阳看）最强，侧光时只在朝太阳的坡上；越远越弱；只镶在天际线上（从高处俯看不镶）。
 *   脚下雾  每排底部融进雾：最近一排融进当前雾色（= 远景地面在相机 far 处的颜色，接缝看不出），远的排融进比雾色亮一点的空气。
 *   天气    雾终点被天气拉近（沙暴）时整层按比例退进雾色，不会在沙暴里还立着一圈清楚的山。
 *   纱幕    可选的方位纱幕（veils）：某个方向天际压着沙暴 / 浮尘，那一段的剪影再淡一截、偏沙尘色。
 *
 * 用法（第一章重做版 redo/runtime.ts）：
 *   const far = createFarLayer({ center: 可玩区中心, baseY: 远景地面高度, wind, rows: [...] });
 *   group.add(far.group);      // DesertPart：卸载时 far.dispose()
 */

/** 剪影的地物种类 */
export type FarKind = 'dunes' | 'mesas' | 'yardangs';

/** 一排剪影环 */
export interface FarRowSpec {
  /** 离中心的水平距离（m）。建议 ≥ 相机 far（雾终点 × 1.5），这样它总在远景地面被裁掉的那条线之外 */
  distance: number;
  /** 地物顶的高度范围（m，基准高度以上）：每个地物在这个范围里取，矮的多、高的少（6:3:1） */
  height: [number, number];
  /** 地物种类；混排给权重表，如 { mesas: 3, yardangs: 1 } */
  kind: FarKind | Partial<Record<FarKind, number>>;
  /**
   * 方位角段（度，同 spec.ts 的 azimuth：0 = +Z，90 = +X），每段 [起, 止] 从「起」顺着方位角增大的方向转到「止」（可以跨 360 / 用负数）。
   * 只在这些段里起地物，段外只剩低低的地平线起伏（留缺口：让地标、出口方向的天际线空出来）。不给 = 一整圈
   */
  sectors?: [number, number][];
  /** 段内两头多少度里地物逐渐矮下去，默认 8° */
  sectorFade?: number;
  /** 段外的地物压到原高的多少（0..1）：0 = 段外只剩地平线起伏（缺口），0.4 = 段外还有一道矮的（「压低」而不是挖空）。默认 0 */
  outside?: number;
  /** 疏密 0..1：1 = 一个挨一个连成一道墙，0.3 = 稀疏、一簇一簇留空。默认 0.6 */
  density?: number;
  /** 地平线起伏（段外 / 地物之间的底线）的高度（m），默认 height[0] × 0.14 */
  base?: number;
  /** 空气透视 0..1（0 = 本色，1 = 完全化进天际），不给按距离算 */
  aerial?: number;
  /** 脚下雾的高度（m），0 = 不要。默认：最近一排 = 平均高度 × 0.45，其余 × 0.3 */
  footFog?: number;
  /** 反照率（sRGB 0..1），不给按种类（沙丘沙黄 / 台地赭红 / 雅丹土黄偏红），每个地物再随机浮动一点 */
  albedo?: Rgb;
  /** 这一排的随机种子（不给按排号） */
  seed?: number;
  /** 钉死的地物：在指定方位上一定起一座（不受 sectors 管）。构图用——太阳底下立一座逆光的方山、地标两侧夹一对 */
  pins?: FarPin[];
}

/** 一排里钉死的地物 */
export interface FarPin {
  /** 方位角（度，同 spec.ts），从剪影环的中心量 */
  azimuth: number;
  /** 种类，默认这一排权重最大的那种 */
  kind?: FarKind;
  /** 顶高（m，基准高度以上），默认这一排高度范围的上限 */
  height?: number;
  /** 宽度倍率（台地的平顶宽 / 沙丘的坡长 / 雅丹的船长），默认 1 */
  width?: number;
}

/** 方位纱幕：某个方向的天际压着沙暴 / 浮尘，那一段剪影再淡一截、偏沙尘色 */
export interface FarVeil {
  /** 中心方位角（度，同 spec.ts） */
  azimuth: number;
  /** 半宽（度）：中心 ± 这么多度内由浓到淡 */
  width: number;
  /** 浓度 0..1：空气透视再加这么多（乘 look.veil） */
  amount: number;
}

/** 颜色和轮廓光的微调（都有默认值） */
export interface FarLook {
  /** 顶沿暖边的强度，默认 1 */
  rim: number;
  /** 顶沿暖边的宽度（像素），默认 2.2 */
  rimWidth: number;
  /** 受光面亮度倍率，默认 0.95 */
  lit: number;
  /** 背光面亮度倍率，默认 1 */
  shade: number;
  /** 背光面往蓝紫灰偏的程度 0..1，默认 0.55 */
  cool: number;
  /** 朝太阳看时额外散进来的日光（天球的日晕已经算在天色里，这里只是补一点），默认 0.12 */
  scatter: number;
  /** 空气色从雾色往背后天色偏多少（乘每排的空气透视）：1 = 空气透视 0.8 的那排几乎就是天色。默认 1.1 */
  horizonReach: number;
  /** 纱幕的总倍率，默认 0.75 */
  veil: number;
  /**
   * 相机升高时空气透视往雾里推多少（0..1），默认 0.5：从台顶 / 俯瞰往远看时，视线前面是一整片已经白进雾色的地面，
   * 远景再清楚就「跳」出来了（比前面的地面还近似的）。眼睛高出基准 15 m 起作用，120 m 到满
   */
  heightHaze: number;
  /** 写死的天色（sRGB 0..1）。不给就逐像素照场景的渐变天球算，没有渐变天球用雾色往亮里偏 */
  horizon?: Rgb;
}

export interface FarLayerOptions {
  /** 剪影环的中心（网页 XZ），一般是可玩区中心 */
  center: [number, number];
  /** 基准高度（世界 y）：远景地面的高度（重做版：图外地形最外一圈收回到的高度） */
  baseY: number;
  /** 风吹向的方向（网页 XZ）：沙丘的背风陡坡、雅丹的船尾都朝它 */
  wind: [number, number];
  /** 3–5 排（顺序随意，按距离排；超过 5 排只取最近的 5 排） */
  rows: FarRowSpec[];
  /** 方位纱幕 */
  veils?: FarVeil[];
  /** 总种子，默认 1 */
  seed?: number;
  /** 颜色微调 */
  look?: Partial<FarLook>;
  /** 每一圈的列数（方位分辨率），默认 1440（0.25° 一列） */
  columns?: number;
}

/** createFarLayer 的产物：DesertPart（卸载时 dispose），网格挂在 group 下 */
export interface FarLayer extends DesertPart {
  readonly group: THREE.Group;
  /** 由远到近，每排一个网格 */
  readonly meshes: readonly THREE.Mesh[];
  /** 可以随时改字段，下一帧生效（horizon 除外：它在第一帧读定） */
  readonly look: FarLook;
  /** 某一排在某方位上的轮廓顶高（世界 y；调试 / 摆别的东西用）。rowIndex 按距离由近到远 */
  heightAt(rowIndex: number, azimuthDeg: number): number;
}

const DEFAULT_LOOK: FarLook = { rim: 1, rimWidth: 2.2, lit: 0.95, shade: 1, cool: 0.55, scatter: 0.12, horizonReach: 1.1, veil: 0.75, heightHaze: 0.5 };

/** 各种类的反照率（sRGB） */
const ALBEDO: Record<FarKind, Rgb> = {
  dunes: [0.8, 0.62, 0.42],
  mesas: [0.64, 0.37, 0.25],
  yardangs: [0.71, 0.5, 0.34],
};

/** 假法线：帘子朝中心的分量、往上的分量、按轮廓坡度往两侧偏的倍率 */
const FACING: Record<FarKind | 'base', [number, number, number]> = {
  dunes: [0.5, 0.85, 1],
  mesas: [1, 0.1, 0.45],
  yardangs: [0.85, 0.35, 0.7],
  base: [0.45, 0.9, 0.6],
};

/** 正面往外倾多少（水平 / 竖直）：下半截、上半截。沙丘约 35°–40°，台地下半截碎屑坡缓、上半截盖岩近乎竖直，雅丹陡 */
const LEAN: Record<FarKind | 'base', [number, number]> = {
  dunes: [1.4, 1.1],
  mesas: [1.3, 0.2],
  yardangs: [0.8, 0.5],
  base: [2.5, 2.5],
};

const MAX_ROWS = 5;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
/** 裙边往基准高度以下拖多深（× 这一排的距离）：相机升到 150 m 也盖得住地平线以下 */
const SKIRT = 0.3;

/**
 * 按距离给的默认空气透视：900 m ≈ 0.16，1350 m ≈ 0.24，2100 m ≈ 0.34，3000 m ≈ 0.45。
 * 比真实的雾浅得多（雾终点才 500 m 上下）：远景是画出来的层次，每排要读得出，只是一排比一排淡；
 * 场景自己的雾带（unityAtmosphereLayout 的外圈雾、MistStreams）还会叠在它前面再洗一层
 */
export function farAerial(distance: number): number {
  return Math.min(0.85, Math.max(0.1, 1 - Math.exp(-distance * 0.0002)));
}

// ───────────── 轮廓 ─────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 方位角差（弧度）折到 [−π, π] */
function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

/** 方位角（度）在段里的权重：段外 0，段内离两头 fade 度以内逐渐升到 1 */
function sectorWeight(azDeg: number, sectors: [number, number][] | undefined, fade: number): number {
  if (!sectors?.length) return 1;
  let best = 0;
  for (const [a0, a1] of sectors) {
    const span = (((a1 - a0) % 360) + 360) % 360 || 360;
    const rel = (((azDeg - a0) % 360) + 360) % 360;
    if (rel > span) continue;
    const d = Math.min(rel, span - rel);
    const t = fade > 0 ? Math.min(1, d / fade) : 1;
    best = Math.max(best, t * t * (3 - 2 * t));
  }
  return best;
}

/** 方位纱幕的浓度 0..1 */
function veilAt(azDeg: number, veils: FarVeil[] | undefined): number {
  let v = 0;
  for (const veil of veils ?? []) {
    const d = Math.abs(wrapAngle((azDeg - veil.azimuth) * DEG)) / DEG;
    const t = Math.max(0, 1 - d / Math.max(1, veil.width));
    v = Math.max(v, veil.amount * t * t * (3 - 2 * t));
  }
  return Math.min(1, v);
}

/** 一个地物：在弧长坐标 x（m，离地物中心，沿方位角增大的方向为正）处的高度 */
interface Feature {
  az: number;
  kind: FarKind;
  /** 弧长方向的半跨度（m）：超出就是 0 */
  reach: number;
  albedo: Rgb;
  eval(x: number): number;
  /** 台地平顶往后延伸多深（m）：从高处看得见顶面；其它种类没有 */
  cap?(x: number): number;
}

/**
 * 沙丘：横向沙丘的剖面，迎风坡缓（Ww ≈ 5.1 H，脊下坡度约 15°，略凹）、背风落沙坡陡（Wl ≈ 1.66 H，约 31°），脊是尖角。
 * tau = 风向在这一点切向上的分量（+ = 风往方位角增大的方向吹，背风坡在 + 侧）。|tau| 小 = 顺着风看，沙丘脊横在眼前，剖面拉长、两边都缓。
 */
function dune(h: number, tau: number, stretch: number): { left: number; right: number; eval: (x: number) => number } {
  const ww = h * 5.1 * stretch, wl = h * 1.66 * stretch, crest = h * 2.6 * stretch;
  const k = Math.pow(Math.abs(tau), 0.7);
  const windward = crest + (ww - crest) * k, lee = crest + (wl - crest) * k;
  const left = tau >= 0 ? windward : lee, right = tau >= 0 ? lee : windward;
  // 坡形：顺着风看两边都是凹坡（脊尖、坡脚拖开）；侧着看迎风坡微凹、落沙坡是一道直坡（休止角）
  const pw = 1.5 - 0.2 * k, pl = 1.5 - 0.5 * k;
  const lp = tau >= 0 ? pw : pl, rp = tau >= 0 ? pl : pw;
  return {
    left, right,
    eval: x => {
      if (x < 0) {
        const t = -x / left;
        return t >= 1 ? 0 : h * Math.pow(1 - t, lp);
      }
      const t = x / right;
      return t >= 1 ? 0 : h * Math.pow(1 - t, rp);
    },
  };
}

/** 台地：平顶（微微起伏）、上半截陡崖（盖岩，高 cliff × H）、下半截凹进去的碎屑坡（约 32°） */
function mesa(h: number, top: number, cliff: number, tilt: number, depth: number): { reach: number; eval: (x: number) => number; cap: (x: number) => number } {
  const run = h * cliff * 0.14, apronH = h * (1 - cliff), apron = apronH * 1.7 + h * 0.08;
  const half = top / 2;
  return {
    reach: half + run + apron,
    cap: x => (Math.abs(x) <= half ? depth : 0),
    eval: x => {
      const d = Math.abs(x) - half;
      if (d <= 0) return h * (1 + tilt * (x / Math.max(1, half)));
      if (d < run) return h - h * cliff * Math.pow(d / run, 1.6);
      const t = (d - run) / apron;
      return t >= 1 ? 0 : apronH * (1 - t) * (1 - t);
    },
  };
}

/**
 * 雅丹：船形长丘，长 L（顺风）、宽 W。侧着看（|tau| 大）：迎风的船头又钝又陡，甲板往船尾慢慢降低，船尾拖长收尖；
 * 顺着风看（|tau| 小）：只剩一截窄的、两边都陡的平顶土台。
 */
function yardang(h: number, length: number, width: number, tau: number): { reach: number; eval: (x: number) => number } {
  const k = Math.abs(tau), span = length * k + width * (1 - k);
  const head = 0.5 + (0.06 - 0.5) * Math.pow(k, 0.6);
  const tail = 0.5 + (0.38 - 0.5) * k;
  const sign = tau >= 0 ? 1 : -1;
  return {
    reach: span / 2,
    eval: x => {
      const p = (x * sign + span / 2) / span;
      if (p <= 0 || p >= 1) return 0;
      const rise = Math.min(1, p / head), fall = Math.min(1, (1 - p) / tail);
      const headShape = 1 - Math.pow(1 - rise, 5);
      const tailShape = fall * fall * (3 - 2 * fall);
      return h * headShape * tailShape * (1 - 0.32 * p * k);
    },
  };
}

interface RowProfile {
  radius: Float32Array;
  top: Float32Array;
  /** 平顶往后延伸的深度（m），只有台地有 */
  cap: Float32Array;
  slope: Float32Array;
  kind: (FarKind | 'base')[];
  albedo: Float32Array;
}

function pickKind(kind: FarRowSpec['kind'], rnd: () => number): FarKind {
  if (typeof kind === 'string') return kind;
  const entries = (Object.entries(kind) as [FarKind, number][]).filter(([, w]) => w > 0);
  if (!entries.length) return 'dunes';
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rnd() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

/** 一排的轮廓：先沿着圈摆地物（疏密、段、风向），再逐列取所有地物和底线的最高处 */
function buildProfile(row: FarRowSpec, wind: [number, number], seed: number, columns: number): RowProfile {
  const rnd = mulberry32(seed);
  const R = row.distance;
  const [h0, h1] = row.height[0] <= row.height[1] ? row.height : [row.height[1], row.height[0]];
  const density = Math.min(1, Math.max(0.05, row.density ?? 0.6));
  const fade = row.sectorFade ?? 8;
  const spacing = 1.65 - 1.1 * density; // 1 = 刚好挨着；< 1 叠起来
  const wl = Math.hypot(wind[0], wind[1]) || 1, wx = wind[0] / wl, wz = wind[1] / wl;
  /** 方位角 a（弧度）处的切向（方位角增大的方向）上风的分量 */
  const tauAt = (a: number) => wx * Math.cos(a) - wz * Math.sin(a);
  const tint = (k: FarKind): Rgb => {
    const c = row.albedo ?? ALBEDO[k], j = 1 + (rnd() - 0.5) * 0.12, w = (rnd() - 0.5) * 0.04;
    return [c[0] * j + w, c[1] * j, c[2] * j - w];
  };
  const pickHeight = () => h0 + (h1 - h0) * Math.pow(rnd(), 1.6);

  const features: Feature[] = [];
  /**
   * 在方位 a（弧度）起一个地物（或一簇），返回它沿圈占的弧长（m）。weight = 段权重（段两头 / 段外的地物只压矮、不变窄：
   * 宽度按原高算，高度乘 weight，地物之间不会裂出空当）；widthMul = 宽度倍率（平顶宽 / 坡长 / 船长）
   */
  const place = (kind: FarKind, a: number, h: number, weight: number, widthMul: number): number => {
    const tau = tauAt(a);
    if (kind === 'dunes') {
      const stretch = (0.85 + rnd() * 0.35) * widthMul;
      const main = dune(h, tau, stretch);
      // 沙山链：主峰两侧再接一到三个矮一些的尖顶，鞍部落在五到七成高——顺着风看（|tau| 小）是一道连着几个尖顶的长脊，
      // 侧着风看是一两个不对称的剖面（缓迎风坡 + 陡落沙坡）。单独一个对称的尖顶远看就是金字塔，顺风方向至少接一个
      const k = Math.pow(Math.abs(tau), 0.7);
      const crests: { off: number; d: ReturnType<typeof dune> }[] = [{ off: 0, d: main }];
      const extra = Math.floor(rnd() * (1.6 + 1.8 * (1 - k))) + (k < 0.5 ? 1 : 0);
      let lo = -main.left, hi = main.right;
      for (let i = 0; i < extra; i++) {
        const side = rnd() < 0.5 ? -1 : 1;
        const d = dune(h * (0.45 + rnd() * 0.4), tau, stretch * (0.6 + rnd() * 0.35));
        // 接在链的这一头：离链端的尖顶 0.45–0.75 个半宽，两道坡交出一个鞍部
        const end = side < 0 ? crests.reduce((m, c) => Math.min(m, c.off), 0) : crests.reduce((m, c) => Math.max(m, c.off), 0);
        const off = end + side * (side < 0 ? main.left : main.right) * (0.45 + rnd() * 0.3) * (0.6 + 0.4 * d.left / Math.max(1, main.left));
        crests.push({ off, d });
        lo = Math.min(lo, off - d.left);
        hi = Math.max(hi, off + d.right);
      }
      if (weight > 0.03) {
        // 复合沙丘：两到四条小沙丘，多数骑在迎风坡上（大的靠近脊），少数挂在落沙坡下半截——长直坡被切成一级一级，远看不再是一个三角
        const windSide = tau >= 0 ? -1 : 1, flank = windSide < 0 ? main.left : main.right;
        const riders: { off: number; eval: (x: number) => number; left: number; right: number }[] = [];
        const count = 2 + Math.floor(rnd() * 3);
        for (let i = 0; i < count; i++) {
          const stoss = rnd() < 0.75, side = stoss ? windSide : -windSide, span = stoss ? flank : (windSide < 0 ? main.right : main.left);
          const at = stoss ? 0.15 + rnd() * 0.65 : 0.45 + rnd() * 0.35;
          const r = dune(h * (0.06 + rnd() * 0.14) * (stoss ? 1.6 - at : 0.8), tau, 0.6 + rnd() * 0.5);
          riders.push({ off: side * span * at, ...r });
        }
        features.push({
          az: a, kind, reach: Math.max(-lo, hi), albedo: tint(kind),
          eval: x => {
            if (x < lo || x > hi) return 0;
            let y = 0;
            for (const c of crests) {
              const u = x - c.off;
              if (u > -c.d.left && u < c.d.right) y = Math.max(y, c.d.eval(u));
            }
            for (const r of riders) {
              const u = x - r.off;
              if (u > -r.left && u < r.right) y += r.eval(u);
            }
            return y * weight;
          },
        });
      }
      return hi - lo;
    }
    if (kind === 'mesas') {
      // 平顶宽：孤峰（比高还窄）到长条方山（三倍高），最宽不过约 10°，别让一座方山横跨半个画面
      const top = Math.min(h * (0.6 + Math.pow(rnd(), 1.5) * 2.6) * widthMul, R * 0.18);
      const m = mesa(h, top, 0.38 + rnd() * 0.24, (rnd() - 0.5) * 0.06, top * (0.5 + rnd() * 0.6));
      if (weight > 0.03) {
        features.push({ az: a, kind, reach: m.reach, albedo: tint(kind), eval: x => m.eval(x) * weight, cap: m.cap });
        // 三成带一级低台（侵蚀退下去的那一级）
        if (rnd() < 0.3) {
          const side = rnd() < 0.5 ? -1 : 1, hs = h * (0.45 + rnd() * 0.2);
          const stepTop = top * (0.5 + rnd() * 0.6), step = mesa(hs, stepTop, 0.45, 0, stepTop * 0.7);
          features.push({ az: a + (side * (top * 0.5 + step.reach * 0.5)) / R, kind, reach: step.reach, albedo: tint(kind), eval: x => step.eval(x) * weight, cap: step.cap });
        }
      }
      return m.reach * 2;
    }
    // 舰群：一条大的领头，两三条小的错开跟着
    const length = h * (4 + rnd() * 5) * widthMul, width = length * (0.16 + rnd() * 0.1);
    const lead = yardang(h, length, width, tau);
    let lo = -lead.reach, hi = lead.reach;
    if (weight > 0.03) {
      features.push({ az: a, kind, reach: lead.reach, albedo: tint(kind), eval: x => lead.eval(x) * weight });
      const n = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const hs = h * (0.4 + rnd() * 0.4), ls = length * (0.5 + rnd() * 0.4);
        const y = yardang(hs, ls, ls * 0.2, tau);
        const off = (rnd() - 0.5) * 2 * (lead.reach + y.reach) * 0.8;
        features.push({ az: a + off / R, kind, reach: y.reach, albedo: tint(kind), eval: x => y.eval(x) * weight });
        lo = Math.min(lo, off - y.reach);
        hi = Math.max(hi, off + y.reach);
      }
    }
    return hi - lo;
  };

  const start = rnd() * TAU;
  let a = start;
  while (a < start + TAU) {
    const kind = pickKind(row.kind, rnd);
    const weight = Math.max(Math.min(1, row.outside ?? 0), sectorWeight(((a / DEG) % 360 + 360) % 360, row.sectors, fade));
    const extent = place(kind, a, pickHeight(), weight, 1);
    // 聚散：稀疏的排（density < 0.7）偶尔空出一段（簇间留空），最多 20° 左右
    const gap = rnd() < Math.max(0, 0.7 - density) * 0.8 ? Math.min(extent * (0.6 + rnd() * 1.2), R * 0.35) : 0;
    a += (Math.max(extent, h0 * 2) * spacing * (0.75 + rnd() * 0.5) + gap) / R;
  }
  // 钉死的地物（不受段管）：随机摆完再起，和旁边的地物取高的那个
  const firstKind: FarKind = typeof row.kind === 'string' ? row.kind
    : ((Object.entries(row.kind) as [FarKind, number][]).filter(([, w]) => w > 0).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'dunes');
  for (const pin of row.pins ?? []) place(pin.kind ?? firstKind, pin.azimuth * DEG, pin.height ?? h1, 1, pin.width ?? 1);

  // 底线：低低的地平线起伏；半径：帘子沿圈前后错一点（±3.5%），走动时同一排里也有视差
  const baseH = row.base ?? Math.max(1.5, h0 * 0.14);
  const ph = Array.from({ length: 6 }, () => rnd() * TAU);
  const radius = new Float32Array(columns), top = new Float32Array(columns), slope = new Float32Array(columns), albedo = new Float32Array(columns * 3);
  const cap = new Float32Array(columns);
  const kind: (FarKind | 'base')[] = new Array(columns);
  const baseAlbedo = row.albedo ?? ALBEDO.dunes;
  const da = TAU / columns;
  for (let j = 0; j < columns; j++) {
    const az = j * da;
    radius[j] = R * (1 + 0.035 * (0.5 * Math.sin(3 * az + ph[0]) + 0.3 * Math.sin(7 * az + ph[1]) + 0.2 * Math.sin(13 * az + ph[2])));
    let best = baseH * (0.55 + 0.45 * (0.5 + 0.5 * (0.5 * Math.sin(9 * az + ph[3]) + 0.3 * Math.sin(23 * az + ph[4]) + 0.2 * Math.sin(47 * az + ph[5]))));
    let owner: Feature | null = null, ownerX = 0;
    for (const f of features) {
      const x = wrapAngle(az - f.az) * R;
      if (x < -f.reach || x > f.reach) continue;
      const y = f.eval(x);
      if (y > best) {
        best = y;
        owner = f;
        ownerX = x;
      }
    }
    top[j] = best;
    cap[j] = owner?.cap?.(ownerX) ?? 0;
    kind[j] = owner ? owner.kind : 'base';
    const c = owner ? owner.albedo : baseAlbedo;
    albedo[j * 3] = c[0];
    albedo[j * 3 + 1] = c[1];
    albedo[j * 3 + 2] = c[2];
  }
  // 假法线用的坡度：在 ±1.2° 的窗口上取（先盒式平滑再差分）——只认大的坡面（地物的左坡 / 右坡），
  // 逐列取的话底线的小起伏会让受光 / 背光一列一列地翻，从高处俯看就是一排竖条纹
  const k = Math.max(2, Math.round(columns / 300));
  const smooth = new Float32Array(columns);
  let sum = 0;
  for (let i = -k; i <= k; i++) sum += top[(i + columns) % columns];
  for (let j = 0; j < columns; j++) {
    smooth[j] = sum / (2 * k + 1);
    sum += top[(j + k + 1) % columns] - top[(j - k + columns) % columns];
  }
  for (let j = 0; j < columns; j++) {
    const p = (j + columns - k) % columns, n = (j + k) % columns;
    slope[j] = (smooth[n] - smooth[p]) / (2 * k * radius[j] * da);
  }
  return { radius, top, cap, slope, kind, albedo };
}

/**
 * 一排的网格。每列六个顶点：裙边底 / 基准 / 中段 / 轮廓顶（正面），平顶前沿 / 平顶后沿（台地的顶面，其它种类退化成一点）。
 * 正面不是竖直的：中段、轮廓顶按种类往外倾（沙丘缓、台地上半截陡），从高处（俯瞰机位、台顶）看是一道坡，不是一堵纸墙。
 * 三角形的顺序就是遮挡顺序（同一排深度都一样，后画的盖先画的）：先画所有平顶，再画正面——
 * 从低处看平顶在正面后面被盖住，从高处看平顶露在正面的上沿之上。
 */
function buildGeometry(profile: RowProfile, center: [number, number], baseY: number, distance: number, veils: FarVeil[] | undefined): THREE.BufferGeometry {
  const columns = profile.top.length, da = TAU / columns, V = 6;
  const position = new Float32Array(columns * V * 3), normal = new Float32Array(columns * V * 3);
  const albedo = new Float32Array(columns * V * 3), topAttr = new Float32Array(columns * V), veilAttr = new Float32Array(columns * V);
  const skirt = baseY - distance * SKIRT;
  const nTop = new THREE.Vector3(), nLow = new THREE.Vector3(), nCap = new THREE.Vector3();
  for (let j = 0; j < columns; j++) {
    const az = j * da, s = Math.sin(az), c = Math.cos(az), r = profile.radius[j], h = profile.top[j];
    const kind = profile.kind[j];
    const [f, u, k] = FACING[kind];
    const [leanLow, leanHigh] = LEAN[kind];
    const g = Math.max(-3, Math.min(3, profile.slope[j]));
    // 朝中心 (−s, 0, −c)，切向 (c, 0, −s)：轮廓往切向升高（g > 0）的坡面朝 −切向
    nTop.set(-s * f - c * g * k, u, -c * f + s * g * k).normalize();
    nLow.set(-s * f * 0.6 - c * g * k * 0.5, u + 0.5, -c * f * 0.6 + s * g * k * 0.5).normalize();
    nCap.set(-s * 0.12, 1, -c * 0.12).normalize();
    const rMid = r + h * 0.55 * leanLow, rTop = rMid + h * 0.45 * leanHigh, rBack = rTop + profile.cap[j];
    const rings: [number, number][] = [[r, skirt], [r, baseY], [rMid, baseY + h * 0.55], [rTop, baseY + h], [rTop, baseY + h], [rBack, baseY + h]];
    const veil = veilAt(az / DEG, veils);
    for (let i = 0; i < V; i++) {
      const v = j * V + i, n = i >= 4 ? nCap : i >= 2 ? nTop : nLow;
      position.set([center[0] + s * rings[i][0], rings[i][1], center[1] + c * rings[i][0]], v * 3);
      normal.set([n.x, n.y, n.z], v * 3);
      albedo.set([profile.albedo[j * 3], profile.albedo[j * 3 + 1], profile.albedo[j * 3 + 2]], v * 3);
      // 平顶上不镶顶沿暖边：把它的「轮廓顶」抬到很高
      topAttr[v] = baseY + h + (i >= 4 ? 1e4 : 0);
      veilAttr[v] = veil;
    }
  }
  const index = new Uint32Array(columns * 4 * 6);
  let o = 0;
  const quad = (a: number, b: number, i: number, i2: number) => {
    index[o++] = a + i; index[o++] = a + i2; index[o++] = b + i;
    index[o++] = b + i; index[o++] = a + i2; index[o++] = b + i2;
  };
  for (let j = 0; j < columns; j++) quad(j * V, ((j + 1) % columns) * V, 4, 5);
  for (let j = 0; j < columns; j++) for (let i = 0; i < 3; i++) quad(j * V, ((j + 1) % columns) * V, i, i + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('aAlbedo', new THREE.BufferAttribute(albedo, 3));
  geometry.setAttribute('aTop', new THREE.BufferAttribute(topAttr, 1));
  geometry.setAttribute('aVeil', new THREE.BufferAttribute(veilAttr, 1));
  geometry.setIndex(new THREE.BufferAttribute(columns * V > 65535 ? index : new Uint16Array(index), 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(center[0], baseY, center[1]), distance * 1.5);
  return geometry;
}

// ───────────── 着色器 ─────────────

const VERTEX = /* glsl */ `
attribute vec3 aAlbedo;
attribute float aTop;
attribute float aVeil;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vAlbedo;
varying float vTop;
varying float vVeil;
void main() {
	vec4 world = modelMatrix * vec4( position, 1.0 );
	vWorld = world.xyz;
	vNormal = normalize( mat3( modelMatrix ) * normal );
	vAlbedo = aAlbedo;
	vTop = aTop + modelMatrix[ 3 ].y;
	vVeil = aVeil;
	vec4 clip = projectionMatrix * viewMatrix * world;
	// 远裁面之外也照画：只换深度，贴着远裁面、比天空（z = w）近一丝——场景里所有东西挡得住它，它挡得住云
	clip.z = clip.w * ( 1.0 - 1e-6 );
	gl_Position = clip;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uFog;       // 当前雾色 = 远景地面在相机 far 处的颜色
uniform vec3 uHorizon;   // 没有渐变天球时的天色（显示空间）
uniform float uSkyOn;    // 1 = 照场景的渐变天球逐像素算天色
uniform vec3 uSkyTop;    // 渐变天球的 uniform（线性），每帧从天球材质拷过来
uniform vec3 uSkyHorizon;
uniform vec3 uSkySun;
uniform vec3 uSkySunDir;
uniform vec4 uSky;       // x sharpness, y horizonGlow, z sunHalo, w exposure
uniform vec3 uAir;       // 天光色（Atmosphere 的空气色）：背光面的来源
uniform vec3 uSunDir;    // 指向太阳
uniform vec3 uSunColor;  // 日光（已乘主光能量、地平线份额）
uniform float uVis;      // 能见度：1 = 平常，0 = 沙暴把雾终点拉到很近
uniform vec4 uLook;      // x 轮廓光强度, y 轮廓光宽（像素）, z 受光倍率, w 背光倍率
uniform vec4 uLook2;     // x 背光偏冷, y 向阳散射, z 远排趋近天色, w 纱幕倍率
uniform float uHeightHaze; // 相机升高时空气透视往雾里推多少
uniform vec4 uRow;       // x 空气透视, y 脚下雾高（m）, z 基准高度, w 脚下雾提亮（0 = 融进雾色）
uniform vec3 uDepth;     // x 深度带宽（窗口深度）, y ln(带子最近的距离), z 1 / ln(最远 / 最近)
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vAlbedo;
varying float vTop;
varying float vVeil;

float luma( vec3 c ) { return dot( c, vec3( 0.3, 0.5, 0.2 ) ); }

// 这个方向上背后那一片天（显示空间）：同 UnityEnvironment 的 SKY_FRAGMENT，去掉日盘，地平线以下按地平线算
vec3 skyAt( vec3 dir ) {
	if ( uSkyOn < 0.5 ) return uHorizon;
	float up = clamp( dir.y, 0.0, 1.0 );
	vec3 s = mix( uSkyHorizon, uSkyTop, pow( up, 1.0 / max( uSky.x, 1e-3 ) ) );
	s += uSkyHorizon * uSky.y * exp( -up * 12.0 );
	float sd = clamp( dot( dir, normalize( uSkySunDir ) ), 0.0, 1.0 );
	float sd2 = sd * sd, sd4 = sd2 * sd2, sd8 = sd4 * sd4, sd16 = sd8 * sd8, sd64 = sd16 * sd16 * sd16 * sd16;
	s += uSkySun * ( sd64 * uSky.z + sd8 * uSky.z * 0.25 );
	s *= uSky.w;
	#ifdef TONE_MAPPING
	s = toneMapping( s );
	#endif
	return linearToOutputTexel( vec4( s, 1.0 ) ).rgb;
}

void main() {
	vec3 v = normalize( vWorld - cameraPosition );
	vec3 sun = normalize( uSunDir );
	float fw = max( dot( v, sun ), 0.0 ), f2 = fw * fw, f4 = f2 * f2, f14 = f4 * f4 * f4 * f2;
	vec2 hv = normalize( v.xz + vec2( 1e-5 ) ), hs = sun.xz / max( length( sun.xz ), 1e-3 );
	float back = max( dot( hv, hs ), 0.0 );
	back *= back; // 朝太阳看 = 逆光

	// 本色：平涂三档（背光 / 半受光 / 受光）
	vec3 n = normalize( vNormal );
	float ndl = dot( n, sun );
	float lit = 0.5 * smoothstep( 0.0, 0.07, ndl ) + 0.5 * smoothstep( 0.24, 0.32, ndl );
	vec3 shade = mix( vAlbedo * uAir * 1.3, vec3( 0.8, 0.82, 1.0 ) * ( luma( uAir ) * 0.85 ), uLook2.x ) * uLook.w;
	vec3 body = mix( shade, vAlbedo * uSunColor * uLook.z + shade * 0.4, lit );

	// 空气：越远越淡、越冷、越接近背后那一片天（近排偏雾色）；朝太阳看再补一点散射；纱幕方向偏沙尘色；沙暴里退成雾色
	float a = clamp( uRow.x + vVeil * uLook2.w, 0.0, 1.0 );
	a = mix( a, 1.0, uHeightHaze * smoothstep( 15.0, 120.0, cameraPosition.y - uRow.z ) );
	a = mix( 1.0, a, uVis );
	vec3 sky = skyAt( v );
	vec3 haze = mix( uFog, sky, clamp( uRow.x * uLook2.z, 0.0, 1.0 ) );
	haze += uSunColor * ( ( 0.02 + 0.2 * f2 + 0.5 * f14 ) * uLook2.y );
	// 剪影不比背后的天亮（逆光出剪影；近排的雾色在低太阳下可能比天还亮，压到天的亮度）
	haze *= min( 1.0, ( luma( sky ) + 0.02 ) / max( luma( haze ), 1e-3 ) );
	haze = mix( haze, uFog, vVeil * 0.5 );
	haze = mix( uFog, haze, uVis );
	vec3 col = mix( body, haze, a );

	// 顶沿暖边：轮廓顶往下 rimWidth 个像素；逆光整条镶边，侧光只在朝太阳的坡上；底线（地平线起伏）上不镶
	float px = max( fwidth( vWorld.y ), 1e-4 );
	float edge = 1.0 - smoothstep( max( uLook.y - 1.0, 0.0 ), uLook.y, ( vTop - vWorld.y ) / px );
	float facing = clamp( ndl * 2.0 + 0.3, 0.0, 1.0 );
	float rim = edge * uLook.x * mix( facing * 0.55, 1.0, back ) * ( 1.0 - a * 0.65 ) * uVis * smoothstep( 3.0, 9.0, vTop - uRow.z );
	// 只镶在天际线上：从高处往下看（轮廓顶低于眼睛 2° 以上），顶沿不再是剪影，镶出来是一圈假的亮线
	rim *= smoothstep( -0.035, -0.005, ( vTop - cameraPosition.y ) / max( length( vWorld.xz - cameraPosition.xz ), 1.0 ) );
	// 暖金色：日光色和它的平方各半（饱和一些，别镶成白边）
	vec3 rimColor = mix( uSunColor, uSunColor * uSunColor, 0.5 ) * 1.12 + vec3( 0.04, 0.02, 0.0 );
	col = mix( col, rimColor, clamp( rim, 0.0, 1.0 ) );

	// 脚下融进雾：最近一排融进雾色，远的排融进比雾色亮一点的空气；基准高度以下的裙边一律是雾色（和远景地面被裁的那条线接上）
	vec3 footColor = mix( uFog, haze, uRow.w );
	float foot = uRow.y > 0.0 ? smoothstep( -0.3, 1.0, ( vWorld.y - uRow.z ) / uRow.y ) : 1.0;
	col = mix( footColor, col, foot );
	col = mix( uFog, col, smoothstep( uRow.z - 40.0, uRow.z, vWorld.y ) );
	gl_FragColor = vec4( col, 1.0 );
	// 深度：真实距离（对数）压进远裁面前的窄带，近的小、远的大
	float dt = clamp( ( log( max( length( vWorld - cameraPosition ), 1.0 ) ) - uDepth.y ) * uDepth.z, 0.0, 1.0 );
	gl_FragDepth = 1.0 - uDepth.x * ( 1.0 - dt );
}
`;

// ───────────── 每帧取色 ─────────────

const _color = new THREE.Color(), _sky = new THREE.Color(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _rgb = { r: 0, g: 0, b: 0 };

function displayOf(color: THREE.Color): [number, number, number] {
  color.getRGB(_rgb, THREE.SRGBColorSpace);
  return [_rgb.r, _rgb.g, _rgb.b];
}

/** 渐变天球（UnityEnvironment 的 SKY_FRAGMENT）的 uniform */
type SkyUniforms = {
  horizonColor: { value: THREE.Color };
  topColor?: { value: THREE.Color };
  sunColor?: { value: THREE.Color };
  sunDirection?: { value: THREE.Vector3 };
  sharpness?: { value: number };
  horizonGlow?: { value: number };
  sunHalo?: { value: number };
  exposure?: { value: number };
};

class FarSilhouettes implements FarLayer {
  readonly group = new THREE.Group();
  readonly meshes: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
  readonly look: FarLook;
  private readonly profiles: RowProfile[] = [];
  private readonly rowsByDistance: FarRowSpec[];
  private readonly baseY: number;
  private readonly frame = {
    uFog: { value: new THREE.Vector3(0.8, 0.7, 0.6) },
    uHorizon: { value: new THREE.Vector3(0.95, 0.85, 0.7) },
    uSkyOn: { value: 0 },
    uSkyTop: { value: new THREE.Color(0.3, 0.4, 0.6) },
    uSkyHorizon: { value: new THREE.Color(0.9, 0.7, 0.5) },
    uSkySun: { value: new THREE.Color(1, 0.8, 0.6) },
    uSkySunDir: { value: new THREE.Vector3(0, 0.3, 1) },
    uSky: { value: new THREE.Vector4(2.5, 0.4, 0.6, 1) },
    uAir: { value: new THREE.Vector3(0.6, 0.6, 0.65) },
    uSunDir: { value: new THREE.Vector3(0, 0.3, 1) },
    uSunColor: { value: new THREE.Vector3(1, 0.85, 0.7) },
    uVis: { value: 1 },
    uLook: { value: new THREE.Vector4() },
    uLook2: { value: new THREE.Vector4() },
    uHeightHaze: { value: 0.5 },
    uDepth: { value: new THREE.Vector3(1e-5, Math.log(500), 1 / Math.log(20)) },
  };
  private lastFrame = -1;
  private lastScene: THREE.Scene | null = null;
  private sky: SkyUniforms | null | undefined = undefined;
  private sun: THREE.DirectionalLight | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private sunBase = 0;
  private fogBase = 0;

  constructor(options: FarLayerOptions) {
    this.look = { ...DEFAULT_LOOK, ...options.look };
    this.baseY = options.baseY;
    this.group.name = 'desert-far-layer';
    const rows = [...options.rows].sort((a, b) => a.distance - b.distance);
    if (rows.length > MAX_ROWS) console.warn(`[farLayer] 最多 ${MAX_ROWS} 排，多出来的 ${rows.length - MAX_ROWS} 排（最远的）不画`);
    this.rowsByDistance = rows.slice(0, MAX_ROWS);
    const columns = Math.max(180, Math.floor(options.columns ?? 1440));
    const seed = options.seed ?? 1;
    const count = this.rowsByDistance.length;
    // 深度带的对数刻度：最近一排往里让 400 m（相机不在圈心、帘子前后错 3.5%），最远一排往外放到 1.6 倍再加 2 km（台地顶面、斜看）
    if (count) {
      const near = Math.max(50, this.rowsByDistance[0].distance * 0.96 - 400), far = this.rowsByDistance[count - 1].distance * 1.6 + 2000;
      this.frame.uDepth.value.y = Math.log(near);
      this.frame.uDepth.value.z = 1 / Math.log(far / near);
    }
    // 由远到近建：远的先画（renderOrder 小），近的盖上去
    for (let i = count - 1; i >= 0; i--) {
      const row = this.rowsByDistance[i];
      const profile = buildProfile(row, options.wind, (Math.imul(seed, 7919) + Math.imul(i + 1, 104729) + (row.seed ?? 0) * 31) >>> 0, columns);
      this.profiles[i] = profile;
      const meanH = (row.height[0] + row.height[1]) / 2;
      const aerial = row.aerial ?? farAerial(row.distance);
      const footFog = row.footFog ?? meanH * (i === 0 ? 0.45 : 0.3);
      // 脚下雾提亮：最近一排 0（接远景地面），越远越接近空气色
      const footLift = i === 0 ? 0 : Math.min(0.6, 0.25 + 0.12 * i);
      const material = new THREE.ShaderMaterial({
        uniforms: { ...this.frame, uRow: { value: new THREE.Vector4(aerial, footFog, options.baseY, footLift) } },
        vertexShader: VERTEX, fragmentShader: FRAGMENT,
        // toneMapped: true 只是让 three 在前缀里给出 toneMapping()（天色那一项要和天球一样做色调映射）；
        // 片段末尾不 include tonemapping_fragment，其余颜色本来就是显示空间的值（同 Atmosphere 的雾片段）
        side: THREE.DoubleSide, depthTest: true, depthWrite: true, fog: false, toneMapped: true,
      });
      const mesh = new THREE.Mesh(buildGeometry(profile, options.center, options.baseY, row.distance, options.veils), material);
      mesh.name = `desert-far-row-${i}`;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = -991 - i;
      mesh.onBeforeRender = (renderer, scene, camera) => this.refresh(renderer, scene as THREE.Scene, camera);
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  heightAt(rowIndex: number, azimuthDeg: number): number {
    const p = this.profiles[rowIndex];
    if (!p) return -Infinity;
    const n = p.top.length, f = ((((azimuthDeg % 360) + 360) % 360) / 360) * n;
    const j0 = Math.floor(f) % n, j1 = (j0 + 1) % n, t = f - Math.floor(f);
    return this.baseY + p.top[j0] + (p.top[j1] - p.top[j0]) * t;
  }

  /** 每帧一次（第一排画之前）：雾色、天际色、日光、天光、能见度 */
  private refresh(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const f = this.frame;
    // 深度带（每次都算：同一帧里可能换相机）：前沿 D = far × 0.87，窗口深度 1 − w(D) = n·f / (f − n) · (1/D − 1/f)，
    // 夹在 32–1024 级（24 位）之间
    const persp = camera as THREE.PerspectiveCamera;
    if (persp.isPerspectiveCamera) {
      const n = persp.near, fa = persp.far, D = fa * 0.87;
      const band = (n * fa / Math.max(1e-6, fa - n)) * (1 / D - 1 / fa);
      f.uDepth.value.x = Math.min(1024, Math.max(32, band * 16777216)) / 16777216;
    } else f.uDepth.value.x = 64 / 16777216;
    const frameNo = renderer.info.render.frame;
    if (frameNo === this.lastFrame && scene === this.lastScene) return;
    if (scene !== this.lastScene) this.bindScene(scene);
    this.lastFrame = frameNo;
    this.lastScene = scene;
    const look = this.look;
    f.uLook.value.set(look.rim, look.rimWidth, look.lit, look.shade);
    f.uLook2.value.set(look.cool, look.scatter, look.horizonReach, look.veil);
    f.uHeightHaze.value = look.heightHaze;

    const fog = scene.fog;
    const fogColor = fog ? displayOf(_color.copy(fog.color)) : scene.background instanceof THREE.Color ? displayOf(_color.copy(scene.background)) : [0.8, 0.7, 0.6];
    f.uFog.value.fromArray(fogColor);
    // 能见度：雾终点（或指数雾密度）比第一帧时近了多少；拉到四成以下整层退成雾色
    let vis = 1;
    if (fog instanceof THREE.Fog) {
      if (this.fogBase <= 0) this.fogBase = fog.far;
      vis = (fog.far / this.fogBase - 0.4) / 0.6;
    } else if (fog instanceof THREE.FogExp2) {
      if (this.fogBase <= 0) this.fogBase = fog.density;
      vis = (this.fogBase / Math.max(1e-6, fog.density) - 0.4) / 0.6;
    }
    f.uVis.value = Math.min(1, Math.max(0, vis));

    // 背后的天色：给了就用写死的；否则拷渐变天球的 uniform，着色器里逐像素照天球公式算；都没有用雾色往亮里偏
    f.uSkyOn.value = !look.horizon && this.sky ? 1 : 0;
    if (look.horizon) f.uHorizon.value.fromArray(look.horizon);
    else if (this.sky) {
      const u = this.sky;
      f.uSkyHorizon.value.copy(u.horizonColor.value);
      if (u.topColor) f.uSkyTop.value.copy(u.topColor.value);
      if (u.sunColor) f.uSkySun.value.copy(u.sunColor.value);
      if (u.sunDirection) f.uSkySunDir.value.copy(u.sunDirection.value);
      f.uSky.value.set(u.sharpness?.value ?? 2.5, u.horizonGlow?.value ?? 0, u.sunHalo?.value ?? 0, u.exposure?.value ?? 1);
    } else f.uHorizon.value.set(Math.min(1, fogColor[0] * 1.08 + 0.03), Math.min(1, fogColor[1] * 1.08 + 0.03), Math.min(1, fogColor[2] * 1.08 + 0.03));

    // 日光、天光：空气透视接上时读它的共享 uniform（已含首领压光 / 天气），没接上时自己从灯上算
    if (Atmosphere.active) {
      const u = Atmosphere.uniforms;
      const dir = u.sfAtmoSunDir.value as Float32Array, sunLight = u.sfSunLight.value as Float32Array, air = u.sfAtmoAir.value as Float32Array;
      f.uSunDir.value.set(dir[0], dir[1], dir[2]);
      f.uSunColor.value.set(sunLight[0], sunLight[1], sunLight[2]);
      f.uAir.value.set(air[0], air[1], air[2]);
    } else {
      const sun = this.sun;
      if (sun && sun.visible && sun.intensity > 0) {
        sun.getWorldPosition(_a).sub(sun.target.getWorldPosition(_b)).normalize();
        const up = Math.min(1, Math.max(0, _a.y * 6 + 0.3)), energy = this.sunBase > 1e-4 ? Math.min(1.5, sun.intensity / this.sunBase) : 1;
        const c = displayOf(_color.copy(sun.color));
        f.uSunDir.value.copy(_a);
        f.uSunColor.value.set(c[0] * up * energy, c[1] * up * energy, c[2] * up * energy);
      } else f.uSunColor.value.set(0, 0, 0);
      const sky = this.hemi ? displayOf(_sky.copy(this.hemi.color)) : fogColor;
      f.uAir.value.set(fogColor[0] + (sky[0] - fogColor[0]) * 0.55, fogColor[1] + (sky[1] - fogColor[1]) * 0.55, fogColor[2] + (sky[2] - fogColor[2]) * 0.55);
    }
  }

  /** 换了场景（第一帧）：找渐变天球、太阳、半球光，记下主光强度的基准 */
  private bindScene(scene: THREE.Scene): void {
    this.sky = null;
    this.sun = null;
    this.hemi = null;
    scene.traverse(object => {
      if (!this.sun && object instanceof THREE.DirectionalLight) this.sun = object;
      if (!this.hemi && object instanceof THREE.HemisphereLight) this.hemi = object;
      const mesh = object as THREE.Mesh;
      if (!this.sky && mesh.isMesh && mesh.material instanceof THREE.ShaderMaterial) {
        const u = mesh.material.uniforms as Partial<SkyUniforms>;
        if (u.horizonColor?.value instanceof THREE.Color) this.sky = u as SkyUniforms;
      }
    });
    this.sunBase = this.sun ? (this.sun as THREE.DirectionalLight).intensity : 0;
    this.fogBase = 0;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.meshes.length = 0;
    this.group.removeFromParent();
  }
}

/** 建远景剪影层（3–5 排，每排一个网格、一次绘制调用）。返回 DesertPart：group 挂进场景，卸载时 dispose */
export function createFarLayer(options: FarLayerOptions): FarLayer {
  return new FarSilhouettes(options);
}
