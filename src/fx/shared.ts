/**
 * 特效模块内部共享的小工具：颜色换算、随机、公共 GLSL 片段、渲染顺序。
 * 只被 src/fx/** 使用。
 */
import * as THREE from 'three';

/**
 * 渲染顺序：地面贴花最先（负值：在其他模块的半透明物体之前画，贴地的圈不会盖住空中的弹丸）
 * < 烟 < 发光类（加法混合放最后）。
 */
export const ORDER_DECAL = -10;
export const ORDER_SMOKE = 10;
export const ORDER_FLASH = 18;
export const ORDER_GLOW = 20;
export const ORDER_RIBBON = 22;

/** [a, b) 均匀随机（纯视觉，用 Math.random） */
export function rand(a: number, b: number): number {
  return a + (b - a) * Math.random();
}

/** 对称随机 [-a, a) */
export function jitter(a: number): number {
  return (Math.random() * 2 - 1) * a;
}

/**
 * 把十六进制 sRGB 颜色写入 out（three 会换算到线性工作空间）。
 * 模块级缓存最近一次的换算，热路径上同一颜色重复调用几乎零开销。
 */
let lastHex = -1;
const lastColor = new THREE.Color();
export function hexToColor(hex: number, out: THREE.Color): THREE.Color {
  if (hex !== lastHex) {
    lastHex = hex;
    lastColor.setHex(hex);
  }
  return out.copy(lastColor);
}

/** out = lerp(a, b, t) */
export function mixColor(a: THREE.Color, b: THREE.Color, t: number, out: THREE.Color): THREE.Color {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
  return out;
}

/** 在单位球内随机方向，写入 out（均匀方向） */
export function randomDir(out: THREE.Vector3): THREE.Vector3 {
  const u = Math.random() * 2 - 1;
  const th = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(th), u, s * Math.sin(th));
}

/** 向量三个分量都是有限数（NaN / Infinity 的输入一律丢弃，避免把非法值写进光源或贴花） */
export function finite3(v: THREE.Vector3 | null | undefined): v is THREE.Vector3 {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** 有限正数，否则返回 fallback */
export function posOr(v: number | undefined, fallback: number): number {
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * 「尘土 / 烟」色判定：不太亮、低彩度、偏暖（沙、土、灰烟）。
 * burst 用它把尘土类颜色改走普通混合的烟尘粒子——加法混合的灰褐色看起来像发光雾而不是尘土。
 * 冷灰白（普通稀有度 0xcfd3da）、高亮奶白（冰晶、雷光核心）仍按发光处理。
 */
let dustHex = -1;
let dustRes = false;
export function isDustColor(hex: number): boolean {
  if (hex === dustHex) return dustRes;
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  dustHex = hex;
  dustRes = max < 0.9 && max - min < 0.4 && r >= b - 0.02;
  return dustRes;
}

/** 共享的纯白 / 暖白常量颜色（线性空间） */
export const WHITE = new THREE.Color(1, 1, 1);
export const WARM_WHITE = new THREE.Color().setHex(0xfff1d6);

/**
 * 加法混合特效的雾：按雾因子削弱亮度（不是混向雾色，否则远处会凭空发光）。
 * 需要 fog_pars_fragment；变量 a 为输出 alpha。
 */
export const GLSL_FOG_FADE = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogF = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogF = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  a *= 1.0 - fogF;
#endif
`;

/** 普通混合（烟、碎屑）的雾：颜色混向雾色 */
export const GLSL_FOG_MIX = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogF = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogF = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  col = mix( col, fogColor, fogF );
#endif
`;
