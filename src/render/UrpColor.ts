/**
 * URP 调色的数学（纯函数，不依赖 three，node --test 直接测）。逐行照 Unity 工程用的 URP 17.5 源码
 * （unity/Library/PackageCache/com.unity.render-pipelines.{core,universal}@*）：
 *   NeutralTonemap            core/ShaderLibrary/Color.hlsl（Hable / Hejl 的 Neutral 曲线，white level 5.3）
 *   ColorBalanceToLMSCoeffs   core/Runtime/Utilities/ColorUtils.cs
 *   PrepareLiftGammaGain      同上
 *   PrepareShadowsMidtonesHighlights 同上
 *   LutBuilderLdr             universal/Shaders/PostProcessing/LutBuilderLdr.shader
 *   ColorGradingLutPass       universal/Runtime/Passes/ColorGradingLutPass.cs（_HueSatCon 等常量怎么算）
 *
 * 为什么是 LDR 版：PC_RPAsset 的 m_ColorGradingMode = 0（LowDynamicRange）、m_ColorGradingLutSize = 32。
 * 这一档 URP 的顺序是：后曝光 → 色调映射（在 UberPost 里按公式算，结果 saturate）→ 32³ 的线性 LUT（RGBA8，
 * 输入是色调映射之后的线性 [0, 1]）。所以 LUT 里只有白平衡 / 对比 / 色彩滤镜 / 阴影中间调高光 / Lift-Gamma-Gain /
 * 色相 / 饱和度，色调映射不进 LUT（HDR 档才把 Neutral 烘进 LogC 的 LUT）。
 * 分色调（SplitToning）、通道混合（ChannelMixer）、曲线（ColorCurves）没有关卡用到，按默认值（恒等）处理；
 * 默认曲线不是严格恒等：TextureCurve 128 格、第 i 格存 i / 128，采到 1 时只有 127 / 128——这里照样夹到 127 / 128。
 */

export const LUT_SIZE = 32;

/** 曲线贴图的上限（TextureCurve：128 格，第 i 格 = i / 128，最后一格 127 / 128） */
export const CURVE_MAX = 127 / 128;

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

// ───────────── 色彩空间 ─────────────

/** Unity Mathf.GammaToLinearSpace（精确版：分段 sRGB，> 1 时按 2.2 次幂） */
export function gammaToLinear(v: number): number {
  if (v <= 0.04045) return v / 12.92;
  if (v < 1) return Math.pow((v + 0.055) / 1.055, 2.4);
  return Math.pow(v, 2.2);
}

/** Color.hlsl SRGBToLinear */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Color.hlsl LinearToSRGB */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.9232102 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Color.hlsl Luminance（Rec.709 线性） */
export function luminance(r: number, g: number, b: number): number {
  return r * 0.2126729 + g * 0.7151522 + b * 0.072175;
}

// ───────────── 色调映射 ─────────────

const NA = 0.2, NB = 0.29, NC = 0.24, ND = 0.272, NE = 0.02, NF = 0.3, WHITE_LEVEL = 5.3, WHITE_CLIP = 1;

/** Color.hlsl NeutralCurve */
export function neutralCurve(x: number): number {
  return ((x * (NA * x + NC * NB) + ND * NE) / (x * (NA * x + NB) + ND * NF)) - NE / NF;
}

/** 1 / NeutralCurve(5.3) ≈ 1.31338 */
export const NEUTRAL_WHITE_SCALE = 1 / neutralCurve(WHITE_LEVEL);

/** Color.hlsl NeutralTonemap（单通道；先夹掉负数）。UberPost 的 ApplyTonemap 之后还要 saturate */
export function neutralTonemap(x: number): number {
  x = Math.max(0, x);
  return neutralCurve(x * NEUTRAL_WHITE_SCALE) * NEUTRAL_WHITE_SCALE / WHITE_CLIP;
}

// ───────────── 调色常量（C# 一侧） ─────────────

function standardIlluminantY(x: number): number {
  return 2.87 * x - 3 * x * x - 0.27509507;
}

function cieXyToLms(x: number, y: number): Vec3 {
  const Y = 1, X = Y * x / y, Z = Y * (1 - x - y) / y;
  return [
    0.7328 * X + 0.4296 * Y - 0.1624 * Z,
    -0.7036 * X + 1.6975 * Y + 0.0061 * Z,
    0.003 * X + 0.0136 * Y + 0.9834 * Z,
  ];
}

/** ColorUtils.ColorBalanceToLMSCoeffs：白平衡（色温 / 色调，−100..100）→ LMS 系数 */
export function colorBalanceToLms(temperature: number, tint: number): Vec3 {
  const t1 = temperature / 65, t2 = tint / 65;
  const x = 0.31271 - t1 * (t1 < 0 ? 0.1 : 0.05);
  const y = standardIlluminantY(x) + t2 * 0.05;
  const w1: Vec3 = [0.949237, 1.03542, 1.08728];
  const w2 = cieXyToLms(x, y);
  return [w1[0] / w2[0], w1[1] / w2[1], w1[2] / w2[2]];
}

/** ColorUtils.PrepareLiftGammaGain（输入是 Volume 上的 Vector4：rgb = 轨迹球颜色，w = 偏移） */
export function prepareLiftGammaGain(lift: readonly number[], gamma: readonly number[], gain: readonly number[]): { lift: Vec3; gamma: Vec3; gain: Vec3 } {
  const l: Vec3 = [gammaToLinear(lift[0]) * 0.15, gammaToLinear(lift[1]) * 0.15, gammaToLinear(lift[2]) * 0.15];
  const lumLift = luminance(l[0], l[1], l[2]);
  const liftOut: Vec3 = [l[0] - lumLift + lift[3], l[1] - lumLift + lift[3], l[2] - lumLift + lift[3]];

  const g: Vec3 = [gammaToLinear(gamma[0]) * 0.8, gammaToLinear(gamma[1]) * 0.8, gammaToLinear(gamma[2]) * 0.8];
  const lumGamma = luminance(g[0], g[1], g[2]), gw = gamma[3] + 1;
  const gammaOut: Vec3 = [
    1 / Math.max(g[0] - lumGamma + gw, 1e-3), 1 / Math.max(g[1] - lumGamma + gw, 1e-3), 1 / Math.max(g[2] - lumGamma + gw, 1e-3),
  ];

  const n: Vec3 = [gammaToLinear(gain[0]) * 0.8, gammaToLinear(gain[1]) * 0.8, gammaToLinear(gain[2]) * 0.8];
  const lumGain = luminance(n[0], n[1], n[2]), nw = gain[3] + 1;
  const gainOut: Vec3 = [n[0] - lumGain + nw, n[1] - lumGain + nw, n[2] - lumGain + nw];
  return { lift: liftOut, gamma: gammaOut, gain: gainOut };
}

/** ColorUtils.PrepareShadowsMidtonesHighlights */
export function prepareShadowsMidtonesHighlights(shadows: readonly number[], midtones: readonly number[], highlights: readonly number[]): { shadows: Vec3; midtones: Vec3; highlights: Vec3 } {
  const prep = (c: readonly number[]): Vec3 => {
    const w = c[3] * (Math.sign(c[3]) < 0 ? 1 : 4);
    return [Math.max(gammaToLinear(c[0]) + w, 0), Math.max(gammaToLinear(c[1]) + w, 0), Math.max(gammaToLinear(c[2]) + w, 0)];
  };
  return { shadows: prep(shadows), midtones: prep(midtones), highlights: prep(highlights) };
}

// ───────────── LUT ─────────────

/** 进 LUT 的那部分参数（Volume 混合之后的值，单位同 Unity Inspector） */
export interface GradingInput {
  temperature: number;
  tint: number;
  /** ColorAdjustments */
  contrast: number;
  colorFilter: readonly number[];
  hueShift: number;
  saturation: number;
  lift: readonly number[];
  gamma: readonly number[];
  gain: readonly number[];
  shadows: readonly number[];
  midtones: readonly number[];
  highlights: readonly number[];
  shadowsStart: number;
  shadowsEnd: number;
  highlightsStart: number;
  highlightsEnd: number;
}

/** LutBuilderLdr 的 uniform（ColorGradingLutPass 算好的） */
export interface LutUniforms {
  colorBalance: Vec3;
  colorFilter: Vec3;
  /** x 色相偏移 / 360, y 饱和度 / 100 + 1, z 对比 / 100 + 1 */
  hueSatCon: Vec3;
  lift: Vec3;
  gamma: Vec3;
  gain: Vec3;
  shadows: Vec3;
  midtones: Vec3;
  highlights: Vec3;
  shaHiLimits: Vec4;
}

export function lutUniforms(p: GradingInput): LutUniforms {
  const lgg = prepareLiftGammaGain(p.lift, p.gamma, p.gain);
  const smh = prepareShadowsMidtonesHighlights(p.shadows, p.midtones, p.highlights);
  return {
    colorBalance: colorBalanceToLms(p.temperature, p.tint),
    // colorFilter 是 HDR 颜色：.linear
    colorFilter: [gammaToLinear(p.colorFilter[0]), gammaToLinear(p.colorFilter[1]), gammaToLinear(p.colorFilter[2])],
    hueSatCon: [p.hueShift / 360, p.saturation / 100 + 1, p.contrast / 100 + 1],
    lift: lgg.lift, gamma: lgg.gamma, gain: lgg.gain,
    shadows: smh.shadows, midtones: smh.midtones, highlights: smh.highlights,
    shaHiLimits: [p.shadowsStart, p.shadowsEnd, p.highlightsStart, p.highlightsEnd],
  };
}

const LOGC = { cut: 0.011361, a: 5.555556, b: 0.047996, c: 0.244161, d: 0.386036, e: 5.301883, f: 0.092819 };
const ACESCC_MIDGRAY = 0.4135884;

/** Color.hlsl LinearToLogC（非精确版，USE_PRECISE_LOGC 0） */
export function linearToLogC(x: number): number {
  return LOGC.c * Math.log10(Math.max(LOGC.a * x + LOGC.b, 0)) + LOGC.d;
}

export function logCToLinear(x: number): number {
  return (Math.pow(10, (x - LOGC.d) / LOGC.c) - LOGC.b) / LOGC.a;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const fract = (x: number): number => x - Math.floor(x);

/** Color.hlsl RgbToHsv（带 1e-4 的 e：暗处的饱和度会被略微低估，照样保留） */
function rgbToHsv(r: number, g: number, b: number, out: Vec3): Vec3 {
  // K = (0, -1/3, 2/3, -1)
  const s1 = b <= g ? 1 : 0; // step(c.b, c.g)
  const p0 = s1 ? g : b, p1 = s1 ? b : g, p2 = s1 ? 0 : -1, p3 = s1 ? -1 / 3 : 2 / 3;
  const s2 = p0 <= r ? 1 : 0; // step(p.x, c.r)
  // q = lerp(float4(p.xyw, c.r), float4(c.r, p.yzx), s2)
  const qx = s2 ? r : p0, qy = p1, qz = s2 ? p2 : p3, qw = s2 ? p0 : r;
  const d = qx - Math.min(qw, qy), e = 1e-4;
  out[0] = Math.abs(qz + (qw - qy) / (6 * d + e));
  out[1] = d / (qx + e);
  out[2] = qx;
  return out;
}

/** Color.hlsl HsvToRgb */
function hsvToRgb(h: number, s: number, v: number, out: Vec3): Vec3 {
  const k = [1, 2 / 3, 1 / 3];
  for (let i = 0; i < 3; i++) {
    const p = Math.abs(fract(h + k[i]) * 6 - 3);
    out[i] = v * (1 + (Math.min(1, Math.max(0, p - 1)) - 1) * s);
  }
  return out;
}

function rotateHue(value: number, low: number, hi: number): number {
  return value < low ? value + hi : value > hi ? value - hi : value;
}

const _hsv: Vec3 = [0, 0, 0];

/**
 * LutBuilderLdr 的片段着色器（一个格点）：输入 / 输出都是线性 [0, 1]。
 * 着色器里的 half 精度、曲线贴图的 R16F 量化不模拟（差在 1e-3 以内）。
 */
export function gradeLdr(r: number, g: number, b: number, u: LutUniforms, out: Vec3 = [0, 0, 0]): Vec3 {
  // 白平衡（LMS）
  let L = 3.90405e-1 * r + 5.49941e-1 * g + 8.92632e-3 * b;
  let M = 7.08416e-2 * r + 9.63172e-1 * g + 1.35775e-3 * b;
  let S = 2.31082e-2 * r + 1.28021e-1 * g + 9.36245e-1 * b;
  L *= u.colorBalance[0]; M *= u.colorBalance[1]; S *= u.colorBalance[2];
  r = 2.85847e+0 * L - 1.62879e+0 * M - 2.48910e-2 * S;
  g = -2.10182e-1 * L + 1.15820e+0 * M + 3.24281e-4 * S;
  b = -4.18120e-2 * L - 1.18169e-1 * M + 1.06867e+0 * S;
  // 对比（LogC 里绕中灰）
  const con = u.hueSatCon[2];
  r = logCToLinear((linearToLogC(r) - ACESCC_MIDGRAY) * con + ACESCC_MIDGRAY);
  g = logCToLinear((linearToLogC(g) - ACESCC_MIDGRAY) * con + ACESCC_MIDGRAY);
  b = logCToLinear((linearToLogC(b) - ACESCC_MIDGRAY) * con + ACESCC_MIDGRAY);
  // 色彩滤镜
  r = Math.max(0, r * u.colorFilter[0]);
  g = Math.max(0, g * u.colorFilter[1]);
  b = Math.max(0, b * u.colorFilter[2]);
  // 分色调（默认灰 0.5 = 恒等）、通道混合（默认单位阵）：略
  // 阴影 / 中间调 / 高光
  let luma = luminance(r, g, b);
  const sh = 1 - smoothstep(u.shaHiLimits[0], u.shaHiLimits[1], luma);
  const hi = smoothstep(u.shaHiLimits[2], u.shaHiLimits[3], luma);
  const mi = 1 - sh - hi;
  r = r * u.shadows[0] * sh + r * u.midtones[0] * mi + r * u.highlights[0] * hi;
  g = g * u.shadows[1] * sh + g * u.midtones[1] * mi + g * u.highlights[1] * hi;
  b = b * u.shadows[2] * sh + b * u.midtones[2] * mi + b * u.highlights[2] * hi;
  // Lift / Gamma / Gain
  r = r * u.gain[0] + u.lift[0];
  g = g * u.gain[1] + u.lift[1];
  b = b * u.gain[2] + u.lift[2];
  r = Math.sign(r) * Math.pow(Math.abs(r), u.gamma[0]);
  g = Math.sign(g) * Math.pow(Math.abs(g), u.gamma[1]);
  b = Math.sign(b) * Math.pow(Math.abs(b), u.gamma[2]);
  // HSV：色相偏移（曲线默认 0.5 → 偏移 0、饱和倍率 1）
  const hsv = rgbToHsv(r, g, b, _hsv);
  hsv[0] = rotateHue(hsv[0] + u.hueSatCon[0], 0, 1);
  hsvToRgb(hsv[0], hsv[1], hsv[2], out);
  r = out[0]; g = out[1]; b = out[2];
  // 全局饱和度
  luma = luminance(r, g, b);
  const sat = u.hueSatCon[1];
  r = luma + sat * (r - luma);
  g = luma + sat * (g - luma);
  b = luma + sat * (b - luma);
  // YRGB 曲线（默认）：两次「+ 半格 → 采 128 格曲线」= 夹到 [0, 127/128]
  out[0] = Math.min(CURVE_MAX, Math.max(0, r));
  out[1] = Math.min(CURVE_MAX, Math.max(0, g));
  out[2] = Math.min(CURVE_MAX, Math.max(0, b));
  return out;
}

/**
 * CPU 烘一张 LDR LUT（条带：宽 size²、高 size，RGBA8，和 URP 的 _InternalColorGradingLut 同一排布）。
 * 运行时在 GPU 上烘（PostStack），这里给测试和对照用。
 */
export function bakeLutLdr(u: LutUniforms, size = LUT_SIZE): Uint8Array {
  const width = size * size, data = new Uint8Array(width * size * 4), c: Vec3 = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < width; x++) {
      const slice = Math.floor(x / size), i = x - slice * size;
      gradeLdr(i / (size - 1), y / (size - 1), slice / (size - 1), u, c);
      const k = (y * width + x) * 4;
      data[k] = Math.round(c[0] * 255);
      data[k + 1] = Math.round(c[1] * 255);
      data[k + 2] = Math.round(c[2] * 255);
      data[k + 3] = 255;
    }
  }
  return data;
}

/** Color.hlsl ApplyLut2D 的 CPU 版（双线性：条带内 xy 线性插值，切片之间再插一次） */
export function applyLut2D(lut: Uint8Array, size: number, r: number, g: number, b: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const width = size * size;
  const fetch = (x: number, y: number, ch: number): number => lut[(y * width + x) * 4 + ch] / 255;
  const bilinear = (u: number, v: number, ch: number): number => {
    // 纹理坐标 → 像素中心坐标（夹边）
    const px = Math.min(width - 1, Math.max(0, u * width - 0.5)), py = Math.min(size - 1, Math.max(0, v * size - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
    const fx = px - x0, fy = py - y0;
    const a = fetch(x0, y0, ch) + (fetch(x1, y0, ch) - fetch(x0, y0, ch)) * fx;
    const c = fetch(x0, y1, ch) + (fetch(x1, y1, ch) - fetch(x0, y1, ch)) * fx;
    return a + (c - a) * fy;
  };
  const scaleX = 1 / width, scaleY = 1 / size, n = size - 1;
  const z = b * n, shift = Math.floor(z), f = z - shift;
  const u0 = r * n * scaleX + scaleX * 0.5 + shift * scaleY, v0 = g * n * scaleY + scaleY * 0.5;
  for (let ch = 0; ch < 3; ch++) {
    const lo = bilinear(u0, v0, ch), hi = bilinear(u0 + scaleY, v0, ch);
    out[ch] = lo + (hi - lo) * f;
  }
  return out;
}
