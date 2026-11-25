/**
 * 程序生成的「印片」调色 LUT（33³，显示空间 sRGB 进 → sRGB 出），启动时在 CPU 上算一次。
 *
 * 思路照《听雨园》（docs/art/reference-tingyuyuan.md 3.1，原作 MIT：github.com/Wode44398/tingyuyuan 的 src/core/fx/camera/lut.js），
 * 这里是按它的描述重写的，参数按我们的章节定：
 *   在 OkLab / OkLCh（感知均匀）里做——中灰附近一条轻 S 曲线、白点压一点（像印片，白不顶到 1）、黑底抬一点（雾和镜头眩光的乳白）、
 *   饱和色略加深（染料密度）、高光和暗部轻微去饱和、按色相分别照顾（暖色光保住琥珀、绿偏玉、蓝收一点）、
 *   阴影偏冷高光偏暖（只作用在接近中性的颜色上，红色的东西不会被拉灰）。整体色度基本不变，只重新分配。
 */
import * as THREE from 'three';

export const LUT_SIZE = 33;

export interface FilmLook {
  /** 中灰附近 S 曲线的强度（0 = 不改） */
  contrast: number;
  /** S 曲线的支点（OkLab L） */
  pivot: number;
  /** 白点（1 = 不压） */
  shoulder: number;
  /** 黑底抬升（线性） */
  toeLift: number;
  /** 总饱和度倍率 */
  sat: number;
  /** 高光 / 暗部去饱和比例 */
  satHi: number;
  satLo: number;
  /** 饱和色压暗（染料密度） */
  density: number;
  /** 暖色（琥珀，色相约 70°）加饱和、色相偏移（弧度） */
  warm: number;
  warmHue: number;
  /** 绿（约 140°）、蓝（约 250°）、红（约 25°）的饱和度倍率，绿的色相偏移（弧度，正 = 偏青玉） */
  green: number;
  greenHue: number;
  blue: number;
  red: number;
  /** 分离色调：阴影 / 高光往 OkLab a、b 加多少（只作用在接近中性的颜色上） */
  shadowTint: [number, number];
  highTint: [number, number];
}

const DEG = Math.PI / 180;

/** 第四章（川藏高原）：清冷的晨光——阴影偏青蓝、高光象牙暖，绿收成青玉色，琥珀灵火保色 */
export const LOOK_PLATEAU: FilmLook = {
  contrast: 0.12, pivot: 0.6, shoulder: 0.982, toeLift: 0.0008,
  sat: 1.03, satHi: 0.16, satLo: 0.06, density: 0.06,
  warm: 0.06, warmHue: 3 * DEG, green: 0.97, greenHue: 4 * DEG, blue: 0.97, red: 1.03,
  shadowTint: [-0.004, -0.012], highTint: [0.003, 0.010],
};

/** 什么都不改（对照用） */
export const LOOK_NEUTRAL: FilmLook = {
  contrast: 0, pivot: 0.6, shoulder: 1, toeLift: 0, sat: 1, satHi: 0, satLo: 0, density: 0,
  warm: 0, warmHue: 0, green: 1, greenHue: 0, blue: 1, red: 1, shadowTint: [0, 0], highTint: [0, 0],
};

const srgbToLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function linToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLin(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** 色相上的高斯包（弧度，环绕） */
function hueBump(h: number, centre: number, width: number): number {
  const d = Math.atan2(Math.sin(h - centre), Math.cos(h - centre));
  return Math.exp(-(d / width) * (d / width));
}

/** 一个显示空间颜色过一遍「印片」 */
export function filmGrade(look: FilmLook, r: number, g: number, b: number): [number, number, number] {
  let [L, A, B] = linToOklab(srgbToLin(r), srgbToLin(g), srgbToLin(b));
  let C = Math.hypot(A, B), h = Math.atan2(B, A);
  // S 曲线：端点 0、1 不动，支点处斜率 × (1 + 4·contrast·p·(1−p))
  L = L + look.contrast * (L - look.pivot) * 4 * L * (1 - L);
  // 白点压一点（软肩）
  L -= (1 - look.shoulder) * smooth(0.72, 1.0, L);
  // 饱和度：总倍率 × 高光 / 暗部去饱和
  C *= look.sat * (1 - look.satHi * smooth(0.72, 1.0, L)) * (1 - look.satLo * (1 - smooth(0.06, 0.32, L)));
  // 分色相照顾
  const warm = hueBump(h, 70 * DEG, 28 * DEG), green = hueBump(h, 140 * DEG, 32 * DEG), blue = hueBump(h, 250 * DEG, 35 * DEG), red = hueBump(h, 25 * DEG, 22 * DEG);
  C *= (1 + look.warm * warm) * (1 + (look.green - 1) * green) * (1 + (look.blue - 1) * blue) * (1 + (look.red - 1) * red);
  h += look.warmHue * warm + look.greenHue * green;
  // 染料密度：饱和的颜色压暗一点
  L -= look.density * Math.min(C, 0.3);
  A = Math.cos(h) * C; B = Math.sin(h) * C;
  // 分离色调：只给接近中性的颜色（色度小于约 0.05）
  const neutral = 1 - smooth(0.0, 0.06, C);
  const hi = smooth(0.25, 0.85, L);
  A += neutral * ((1 - hi) * look.shadowTint[0] + hi * look.highTint[0]);
  B += neutral * ((1 - hi) * look.shadowTint[1] + hi * look.highTint[1]);
  let [lr, lg, lb] = oklabToLin(clamp(L, 0, 1), A, B);
  // 黑底抬一点
  lr = lr + look.toeLift * (1 - lr); lg = lg + look.toeLift * (1 - lg); lb = lb + look.toeLift * (1 - lb);
  return [linToSrgb(clamp(lr, 0, 1)), linToSrgb(clamp(lg, 0, 1)), linToSrgb(clamp(lb, 0, 1))];
}

/** 生成 33³ 的 3D LUT（半浮点，线性过滤），取样坐标 = 显示空间颜色 × (N−1)/N + 0.5/N */
export function buildFilmLut(look: FilmLook): THREE.Data3DTexture {
  const N = LUT_SIZE;
  const data = new Uint16Array(N * N * N * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  let i = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const [r, g, b] = filmGrade(look, x / (N - 1), y / (N - 1), z / (N - 1));
    data[i++] = toHalf(r); data[i++] = toHalf(g); data[i++] = toHalf(b); data[i++] = toHalf(1);
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
