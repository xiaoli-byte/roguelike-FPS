import * as THREE from 'three';
import { Atmosphere, ATMOSPHERE_FUNCTIONS_GLSL, ATMOSPHERE_WIND_GLSL, atmosphereNoise } from '../Atmosphere';
import { MistStreams, type MistKey, type MistStream } from '../MistStreams';
import type { UnitySceneDocument } from '../UnityLevelLibrary';
import { heightSampler } from './document';
import type { DesertBuild, DesertPart, Rgb, Vec3 } from './spec';

/**
 * 沙漠环境动势层（docs/art/level-art.md「特效」、fx-style.md 第三节「环境粒子」、composition.md 8.2–8.3）：
 * 让第一章的画面「活着」的五样东西，都是环境层——低对比、低频、数量少、个头大、动得慢，不抢敌人：
 *   1. 沙丘脊吹沙  RidgeSand    沿脊线一排顺风扯开的薄沙带（叠在 MistStreams 上：拉长、撕碎、向阳偏置）；findRidges 从高度场自动找脊
 *   2. 远处尘卷风  DustDevils   2–3 层开口漏斗、旋转条纹 + 噪声啃边、暖沙两阶色，沿路线慢慢游走，偶尔散掉再起；只在 40 m 以外画
 *   3. 烽燧狼烟    BeaconSmoke  从烽燧顶升起、到高处被风吹弯的一根烟柱：暖灰 → 浅灰的团块，逆光时薄边透亮，慢慢翻滚
 *   4. 落沙        SandFalls    从崖沿 / 门洞 / 屋檐倾泻的沙瀑：顺着崖面往下的竖条带 + 纵向滚动的条纹，底部一小团扬尘
 *   5. 贴地流沙    GroundDrift  贴着开阔地顺风滑过的极淡沙带（避开交战区）
 * 共同的规矩：
 *   - 每一样整组一次绘制调用（五样全开 = 5 次），位置在顶点着色器里算；都读 Atmosphere 的同一个风（sfWind）和阵风表（sfGust），
 *     一阵风扫过来时脊上的沙、尘卷风、烟、落沙、地上的流沙一起动。不用每帧调 update（时间也读 sfWind.w）。
 *   - 沙尘用普通混合 + 向阳偏置：加法混合在亮沙地上会整个消失；颜色读当前的低雾色和日光（显示空间，同 MistStreams），
 *     逆光时散射发亮，远处照常吃空气透视和场景雾，雾终点之外不画。
 *   - 离相机 12–22 m 以内淡掉（尘卷风 40 m 以内不画），近处和交战距离保持干净。
 *   - 先 Atmosphere.bind（UnitySceneView 搭环境时已经接上），时间、风、日光、雾色都读它的。
 *
 * 用法（DesertMapArt.build 或演示模块里）：
 *   return sandFx(b, {
 *     ridges: [...findRidges(b.document, { wind: b.art.wind }), { points: [[x, y, z], …] }],
 *     devils: [{ path: [[x, z], [x, z], …] }],
 *     smoke: [{ origin: [x, y, z], height: 70 }],
 *     falls: [{ top: [x, y, z], out: [ox, oz] }],
 *     drift: [{ center: [x, z], size: [60, 30] }],
 *   });
 * 每一样也可以单独建：ridgeSand(b, …) / dustDevils(b, …) / beaconSmoke(b, …) / sandFalls(b, …) / groundDrift(b, …)，
 * 或者直接 new 对应的类、把 .mesh 挂到自己的组上。
 */

type XZ = [number, number];
/** 地面高度：从 top 往下找第一个面（DesertBuild.groundHeight）；只有地形时可以忽略 top */
export type GroundFn = (x: number, z: number, top?: number) => number;

// ───────────── 共用 ─────────────

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unit(v: XZ): XZ {
  const l = Math.hypot(v[0], v[1]);
  return l > 1e-6 ? [v[0] / l, v[1] / l] : [0, 1];
}

/** 给定的风向，或 Atmosphere 当前的风向 */
function windOf(w?: XZ): XZ {
  return unit(w ?? [Atmosphere.wind.x, Atmosphere.wind.z]);
}

/** 风向转一个方位角（度，同 spec.ts 的方位角：0 = +Z，90 = +X） */
function veer(w: XZ, degrees: number): XZ {
  if (!degrees) return w;
  const az = Math.atan2(w[0], w[1]) + degrees * Math.PI / 180;
  return [Math.sin(az), Math.cos(az)];
}

/** 顶点着色器共用：雾片段的声明、同一个风、空气透视函数；sfxAir 在顶点里算好空气透视 / 日照 / 场景雾的份额（同 MistStreams） */
const AIR_VERTEX = /* glsl */ `
#include <fog_pars_vertex>
${ATMOSPHERE_WIND_GLSL}
${ATMOSPHERE_FUNCTIONS_GLSL}
#ifdef USE_FOG
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
varying vec4 vHaze; // rgb 空气透视加进来的颜色, a 原色剩下的份额
varying vec3 vSun;  // 云影外的日照份额, 逆光散射, 场景雾份额
// 场景雾在某个距离上的份额；没有雾时 1（整层不画，同 MistStreams）
float sfxFogAt( float d ) {
	#ifdef USE_FOG
		#ifdef FOG_EXP2
			return 1.0 - exp( -fogDensity * fogDensity * d * d );
		#else
			return smoothstep( fogNear, fogFar, d );
		#endif
	#else
		return 1.0;
	#endif
}
void sfxAir( vec3 wp, float depth ) {
	#ifdef USE_FOG
		vec3 h0 = sfAtmosphere( vec3( 0.0 ), wp ), h1 = sfAtmosphere( vec3( 1.0 ), wp );
		vHaze = vec4( h0, h1.r - h0.r );
		float fw = max( dot( normalize( wp - cameraPosition ), sfAtmoSunDir.xyz ), 0.0 ), f2 = fw * fw, f8 = f2 * f2 * f2 * f2;
		vSun = vec3( sfSunShare( wp ), 0.45 * f2 + f8, sfxFogAt( depth ) );
	#else
		vHaze = vec4( 0.0, 0.0, 0.0, 1.0 );
		vSun = vec3( 1.0, 0.0, 0.0 );
	#endif
}
const vec4 SFX_CULL = vec4( 2.0, 2.0, 2.0, 1.0 );
`;

/** 片段着色器共用：沙尘色（低雾色打底 + 向阳的日光 + 逆光散射，不烧白）、空气透视 + 场景雾、雾终点处收掉 */
const AIR_FRAGMENT = /* glsl */ `
#include <fog_pars_fragment>
${ATMOSPHERE_WIND_GLSL}
uniform vec4 sfSunLight;
uniform sampler2D tNoise;
varying vec4 vHaze;
varying vec3 vSun;
#ifdef USE_FOG
vec3 sfxClamp( vec3 c, float peak ) {
	return c / max( 1.0, max( c.r, max( c.g, c.b ) ) / peak );
}
// tint 乘在低雾色上（1 = 和雾带同色）；sh 0..1 向阳份额；lit 向阳偏置（比沙地亮一档才读得出来）
vec3 sfxSand( vec3 tint, float sh, float lit ) {
	vec3 c = sfAtmoMist.rgb * tint * ( 0.8 + 0.2 * sh ) + sfSunLight.rgb * ( vSun.x * ( 0.06 + 0.24 * sh + 0.3 * lit ) ) + sfAtmoSun.rgb * ( vSun.x * vSun.y );
	// 偏置越大越往奶白里收：饱和的橙压到 0.97 以内时亮度和晒着的沙地一样（实测在沙丘前整个看不见），淡一点才浮得起来
	c = mix( c, vec3( dot( c, vec3( 0.3, 0.5, 0.2 ) ) ), 0.12 + 0.45 * lit );
	return sfxClamp( c, 0.98 );
}
// 成股的沙（落沙）：按本色上光——天光（空气色 + 低雾色）+ 云影外的日光 × 向阳份额，逆光再加一点散射
vec3 sfxLitSand( vec3 albedo, float sh ) {
	vec3 sky = sfAtmoAir.rgb * 0.75 + sfAtmoMist.rgb * 0.35;
	vec3 c = albedo * ( sky * ( 0.7 + 0.3 * sh ) + sfSunLight.rgb * ( vSun.x * ( 0.25 + 0.55 * sh ) ) ) + sfAtmoSun.rgb * ( vSun.x * vSun.y );
	return sfxClamp( c, 0.98 );
}
vec3 sfxFog( vec3 c ) {
	return mix( c * vHaze.a + vHaze.rgb, fogColor, vSun.z );
}
float sfxFar() {
	return 1.0 - smoothstep( 0.72, 1.0, vSun.z );
}
#endif
`;

function sfxMaterial(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, extra: THREE.ShaderMaterialParameters = {}): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), tNoise: { value: atmosphereNoise() }, ...uniforms },
    vertexShader, fragmentShader, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true, ...extra,
  });
  // 空气透视的共享 uniform 原样挂上（不克隆）：风、时间、日光、雾色、云影都读它
  Object.assign(material.uniforms, Atmosphere.uniforms);
  return material;
}

const QUAD = [-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0];

/** 一个网格 + 自己的几何 / 材质 / 贴图：dispose 一起收掉（共用的噪声图不收） */
abstract class SfxMesh implements DesertPart {
  abstract readonly mesh: THREE.Mesh;
  protected readonly owned: { dispose(): void }[] = [];

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    for (const item of this.owned) item.dispose();
    this.owned.length = 0;
  }
}

/** 近处淡掉的距离：clear 以内不画，clear + span 处全浓（默认 12 → 22 m） */
export interface NearFade {
  clearDistance?: number;
  fadeSpan?: number;
}

function nearUniform(o: NearFade, clear = 12, span = 10): { value: THREE.Vector2 } {
  return { value: new THREE.Vector2(o.clearDistance ?? clear, Math.max(1, o.fadeSpan ?? span)) };
}

/** 折线按弧长每隔 spacing 取一点（取段中点，首尾各留半段） */
function resample(points: readonly Vec3[], spacing: number): Vec3[] {
  if (points.length === 1) return [points[0]];
  const at: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    at.push(at[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]));
  }
  const length = at[at.length - 1], n = Math.max(1, Math.round(length / spacing)), out: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    const s = length * (k + 0.5) / n;
    let i = 1;
    while (i < points.length - 1 && s > at[i]) i++;
    const t = Math.min(1, Math.max(0, (s - at[i - 1]) / Math.max(1e-6, at[i] - at[i - 1]))), a = points[i - 1], b = points[i];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

// ───────────── 1. 沙丘脊吹沙 ─────────────

export interface RidgeLine {
  /** 脊顶折线（世界坐标，y = 脊顶高度），沿着脊排，哪头先都行 */
  points: Vec3[];
  /** 沙被吹出去多远（m，顺风），默认 18 */
  reach?: number;
  /** 沙团直径（m），默认 6（个头大、数量少：小团在百米外只有十几个像素，读不出来） */
  size?: number;
  /** 不透明度，默认 0.75（每一缕再随机 0.6–1.15 倍；雾团边上软、中间被噪声撕开，实际最浓处约三成） */
  opacity?: number;
  /** 沿脊每隔多少米一缕，默认 9 */
  spacing?: number;
  /** 吹过脊以后顺着背风坡往下落多少（m），默认 reach × 0.3 */
  drop?: number;
}

export interface RidgeSandOptions {
  /** 风吹向（XZ）；默认读 Atmosphere 的风 */
  wind?: XZ;
  /** 向阳偏置，默认 0.45（沙色对沙色，要亮一档） */
  lit?: number;
  /** 撕碎程度，默认 0.1（MistStreams 的 torn：0.2 以上整团只剩中心 5% 的浓度，实测整条脊上什么都看不见） */
  torn?: number;
  /** 沙团顺风拉长的倍数，默认 3.4（被风扯成丝） */
  stretch?: number;
  /** 流速 = 风速 × 这个倍率，默认 1.25（比山间的雾快，仍然是慢的） */
  speed?: number;
  /** 离相机这么近以内不画（MistStreams 的 clearDistance），默认 14 */
  clearDistance?: number;
  seed?: number;
  /** 低画质：缕数约减到六成 */
  low?: boolean;
}

/**
 * 脊线 → 一组短雾带（MistStream）：每隔 spacing 一缕，从脊顶稍上风处起、顺风吹出 reach 米，先扬到脊上方（背后是天时读得出），
 * 再顺着背风坡往下落、散开。随机跳掉约两成，浓淡不一：断断续续，不是一把梳子。可以和别的雾带并进同一个 MistStreams。
 */
export function ridgeStreams(ridges: readonly RidgeLine[], options: RidgeSandOptions = {}): MistStream[] {
  const [wx, wz] = windOf(options.wind), rnd = mulberry(options.seed ?? 4409);
  const streams: MistStream[] = [];
  for (const ridge of ridges) {
    if (!ridge.points.length) continue;
    const size = ridge.size ?? 6, reach = ridge.reach ?? 18, drop = ridge.drop ?? reach * 0.3;
    const spacing = (ridge.spacing ?? 9) * (options.low ? 1.6 : 1), hw = spacing * 0.6;
    for (const p of resample(ridge.points, spacing)) {
      if (rnd() < 0.18) continue;
      const r = reach * (0.8 + 0.4 * rnd()), s = size * (0.85 + 0.3 * rnd());
      const key = (k: number, up: number, scale: number, opacity: number): MistKey => ({
        position: [p[0] + wx * k * r, p[1] + up, p[2] + wz * k * r], halfWidth: hw * (1 + 0.25 * k), size: s * scale, opacity, halfHeight: s * 0.12,
      });
      streams.push({
        keys: [key(-0.08, 0.15 * s, 0.7, 0), key(0.3, 0.38 * s, 1, 1), key(0.65, 0.32 * s - 0.45 * drop, 1.3, 0.75), key(1, 0.2 * s - drop, 1.6, 0)],
        opacity: (ridge.opacity ?? 0.75) * (0.6 + 0.55 * rnd()),
        speed: (options.speed ?? 1.25) * (0.9 + 0.2 * rnd()), stretch: options.stretch ?? 3.4, torn: options.torn ?? 0.1, lit: options.lit ?? 0.45,
        clearDistance: options.clearDistance ?? 14,
      });
    }
  }
  return streams;
}

/** 沙丘脊吹沙：一次绘制调用（一个 MistStreams）。沙团个数 = this.count */
export class RidgeSand implements DesertPart {
  readonly mist: MistStreams | null;
  readonly mesh: THREE.Object3D;
  readonly count: number;

  constructor(ridges: readonly RidgeLine[], options: RidgeSandOptions = {}) {
    const streams = ridgeStreams(ridges, options);
    this.mist = streams.length ? new MistStreams(streams, { seed: options.seed ?? 4409, renderOrder: -4 }) : null;
    this.mesh = this.mist?.mesh ?? new THREE.Group();
    this.mesh.name = 'SandFx.ridges';
    this.count = this.mist?.count ?? 0;
  }

  dispose(): void {
    this.mist?.dispose();
    this.mesh.removeFromParent();
  }
}

export interface RidgeSearch {
  /** 风吹向（XZ） */
  wind: XZ;
  /** 从哪儿看（世界坐标眼位）：只要看得见的脊，背后是天的优先。默认出生点 + 各遭遇场地中心（眼高 1.7 m） */
  eyes?: Vec3[];
  /** 找的范围 [x0, z0, x1, z1]；默认整片高度场（去掉最外一圈） */
  bounds?: [number, number, number, number];
  /** 离可走范围至少多远（m），默认 18：吹沙只在场地外 */
  minWalkDistance?: number;
  /** 离最近的眼位最远多远（m），默认雾终点 × 0.7 */
  maxDistance?: number;
  /** 网格边长（m），默认 4 */
  cell?: number;
  /** 脊至少高出一侧坡脚多少（m，12 m 内），默认 2.5 */
  prominence?: number;
  /** 背风坡比迎风坡陡多少（落差 / 水平距离），默认 0.12；给负数 = 两边一样陡也要 */
  asymmetry?: number;
  /** 最短脊长（m），默认 16 */
  minLength?: number;
  /** 最多几条，默认 6 */
  max?: number;
  /** 选中的脊之间至少隔多远（m），默认 24 */
  minGap?: number;
}

/**
 * 从高度场自动找沙丘脊：可走范围之外、沿风向是局部最高、背风坡明显比迎风坡陡（落沙坡）的格子连成横风的折线，
 * 再从眼位查视线——看不见的不要，背后是天的排前面（吹沙衬着天最读得出来）。纯数据（node 里也能跑），返回值直接给 RidgeSand。
 */
export function findRidges(doc: UnitySceneDocument, search: RidgeSearch): RidgeLine[] {
  const height = heightSampler(doc), [wx, wz] = unit(search.wind), ax = -wz, az = wx;
  const cell = search.cell ?? 4, minWalk = search.minWalkDistance ?? 18, prominence = search.prominence ?? 2.5, asym = search.asymmetry ?? 0.12;
  const fogEnd = doc.environment?.fog?.mode === 1 ? doc.environment.fog.end : 400, maxDistance = search.maxDistance ?? fogEnd * 0.7;
  let [x0, z0, x1, z1] = search.bounds ?? [Infinity, Infinity, -Infinity, -Infinity];
  if (!search.bounds) {
    for (const f of doc.heightfields) {
      x0 = Math.min(x0, f.origin[0]); z0 = Math.min(z0, f.origin[2]);
      x1 = Math.max(x1, f.origin[0] + f.scale[0] * (f.resolution - 1)); z1 = Math.max(z1, f.origin[2] + f.scale[2] * (f.resolution - 1));
    }
    x0 += 3 * cell; z0 += 3 * cell; x1 -= 3 * cell; z1 -= 3 * cell;
  }
  const W = Math.max(1, Math.floor((x1 - x0) / cell)), H = Math.max(1, Math.floor((z1 - z0) / cell));
  if (!Number.isFinite(W * H) || W * H > 400000) return [];
  const cx = (i: number): number => x0 + (i + 0.5) * cell, cz = (j: number): number => z0 + (j + 0.5) * cell;

  // 到可走范围的距离（导航网格栅格化 + 两遍 chamfer，同 unityAtmosphereLayout）
  const dist = new Float32Array(W * H).fill(1e9), nav = doc.navigation?.vertices ?? [], tris = doc.navigation?.indices ?? [];
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const a = nav[tris[t]], b = nav[tris[t + 1]], c = nav[tris[t + 2]];
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - x0) / cell)), i1 = Math.min(W - 1, Math.floor((Math.max(a[0], b[0], c[0]) - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - z0) / cell)), j1 = Math.min(H - 1, Math.floor((Math.max(a[2], b[2], c[2]) - z0) / cell));
    for (const v of [a, b, c]) {
      const i = Math.floor((v[0] - x0) / cell), j = Math.floor((v[2] - z0) / cell);
      if (i >= 0 && j >= 0 && i < W && j < H) dist[j * W + i] = 0;
    }
    const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(den) < 1e-9) continue;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = cx(i) - c[0], pz = cz(j) - c[2];
      const u = ((b[2] - c[2]) * px + (c[0] - b[0]) * pz) / den, v = ((c[2] - a[2]) * px + (a[0] - c[0]) * pz) / den;
      if (u >= 0 && v >= 0 && u + v <= 1) dist[j * W + i] = 0;
    }
  }
  const relax = (k: number, i: number, j: number, di: number, dj: number, cost: number): void => {
    const ni = i + di, nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= W || nj >= H) return;
    const d = dist[nj * W + ni] + cost;
    if (d < dist[k]) dist[k] = d;
  };
  const diagonal = cell * Math.SQRT2;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; relax(k, i, j, -1, 0, cell); relax(k, i, j, 0, -1, cell); relax(k, i, j, -1, -1, diagonal); relax(k, i, j, 1, -1, diagonal); }
  for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) { const k = j * W + i; relax(k, i, j, 1, 0, cell); relax(k, i, j, 0, 1, cell); relax(k, i, j, 1, 1, diagonal); relax(k, i, j, -1, 1, diagonal); }

  // 脊格：沿风向局部最高，两侧都往下，背风坡比迎风坡陡
  const L = 3 * cell, ridge = new Uint8Array(W * H), crest = new Float32Array(W * H), lee = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (dist[k] < minWalk) continue;
    const x = cx(i), z = cz(j), h = height(x, z);
    if (!Number.isFinite(h)) continue;
    const hu1 = height(x - wx * cell, z - wz * cell), hd1 = height(x + wx * cell, z + wz * cell);
    if (!(h >= hu1 && h >= hd1)) continue;
    const rise = h - height(x - wx * L, z - wz * L), drop = h - height(x + wx * L, z + wz * L);
    if (!(rise > 0.2 && drop > 0.2) || Math.max(rise, drop) < prominence) continue;
    if ((drop - rise) / L < asym) continue;
    ridge[k] = 1;
    crest[k] = h;
    lee[k] = drop;
  }

  // 连通块 → 沿横风轴分箱、每箱取最高的一格 → 折线（中间断开两箱以上就拆开）
  const eyes = search.eyes ?? [
    [doc.spawn.position[0], height(doc.spawn.position[0], doc.spawn.position[2]) + 1.7, doc.spawn.position[2]] as Vec3,
    ...doc.encounters.map(e => [e.position[0], height(e.position[0], e.position[2]) + 1.7, e.position[2]] as Vec3),
  ].filter(e => Number.isFinite(e[1]));
  const seen = new Uint8Array(W * H), lines: { line: RidgeLine; score: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!ridge[start] || seen[start]) continue;
    const cells: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!, i = k % W, j = Math.floor(k / W);
      cells.push(k);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ni = i + di, nj = j + dj, nk = nj * W + ni;
        if ((di || dj) && ni >= 0 && nj >= 0 && ni < W && nj < H && ridge[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
      }
    }
    const bins = new Map<number, number>();
    for (const k of cells) {
      const b = Math.round((cx(k % W) * ax + cz(Math.floor(k / W)) * az) / cell), cur = bins.get(b);
      if (cur === undefined || crest[k] > crest[cur]) bins.set(b, k);
    }
    const order = [...bins.keys()].sort((a, b) => a - b);
    let run: number[] = [];
    const flush = (): void => {
      if (run.length * cell >= (search.minLength ?? 16)) {
        const pts = run.map(k => [cx(k % W), crest[k], cz(Math.floor(k / W))] as Vec3);
        const meanLee = run.reduce((s, k) => s + lee[k], 0) / run.length;
        // 视线：每段查一次，看得见 = 1，背后是天 = 再加 1.5
        let vis = 0;
        for (const p of pts) {
          let best = 0;
          for (const e of eyes) {
            const dx = p[0] - e[0], dz = p[2] - e[2], len = Math.hypot(dx, dz);
            if (len > maxDistance || len < 8) continue;
            const top = p[1] + 1.5, steps = Math.ceil(len / cell);
            let clear = true;
            for (let s = 1; s < steps && clear; s++) {
              const t = s / steps;
              if (height(e[0] + dx * t, e[2] + dz * t) > e[1] + (top - e[1]) * t - 0.3) clear = false;
            }
            if (!clear) continue;
            let sky = true;
            for (let s = 1; s <= Math.ceil(150 / cell) && sky; s++) {
              const t = 1 + s * cell / len, g = height(e[0] + dx * t, e[2] + dz * t);
              if (Number.isFinite(g) && g > e[1] + (top - e[1]) * t) sky = false;
            }
            best = Math.max(best, sky ? 2.5 : 1);
          }
          vis += best;
        }
        vis /= pts.length;
        if (vis > 0.2) {
          lines.push({
            score: vis * run.length * cell * Math.min(meanLee, 12),
            line: {
              points: pts, size: Math.min(8, Math.max(4.5, 2.5 + meanLee * 0.6)), reach: Math.min(30, Math.max(14, meanLee * 3.2)),
              drop: Math.min(8, Math.max(2, meanLee * 0.6)),
            },
          });
        }
      }
      run = [];
    };
    for (let n = 0; n < order.length; n++) {
      if (n > 0 && order[n] - order[n - 1] > 2) flush();
      run.push(bins.get(order[n])!);
    }
    flush();
  }

  // 挑分高的，彼此隔开
  lines.sort((a, b) => b.score - a.score);
  const picked: RidgeLine[] = [], gap = search.minGap ?? 24;
  for (const { line } of lines) {
    if (picked.length >= (search.max ?? 6)) break;
    const near = picked.some(p => p.points.some(a => line.points.some(b => Math.hypot(a[0] - b[0], a[2] - b[2]) < gap)));
    if (!near) picked.push(line);
  }
  return picked;
}

// ───────────── 2. 远处尘卷风 ─────────────

export interface DustDevil {
  /** 游走路线（世界 XZ，首尾相连成一圈）；只给一个点 = 绕它慢慢转（半径 wander） */
  path: XZ[];
  /** 只给一个点时绕圈的半径（m），默认 12 */
  wander?: number;
  /** 高（m），默认 24 */
  height?: number;
  /** 底部半径（m），默认 1.7；往上张开到约 4.5 倍 */
  radius?: number;
  /** 游走速度（m/s），默认 1.6 */
  speed?: number;
  /** 一轮多少秒（起 → 旋 → 散 → 歇），默认 52；每轮从路线上另一处起 */
  cycle?: number;
  /** 起始相位 0..1（0 = 开局正从地上卷起来）；默认按序号错开（0.12、0.53、0.94…），同时只有一个在歇 */
  phase?: number;
  /** 不透明度，默认 0.8 */
  opacity?: number;
}

export interface DustDevilOptions extends NearFade {
  /** 几层，默认 3（低画质 2） */
  layers?: 2 | 3;
  /** 暖沙两阶色：受光面 / 背光面的本色（显示空间，按天光 + 日光照亮，同落沙），默认 [0.98, 0.82, 0.6] / [0.74, 0.57, 0.42] */
  light?: Rgb;
  shade?: Rgb;
  seed?: number;
}

const DEVIL_PATH = 32, DEVIL_RADIAL = 20, DEVIL_RINGS = 12;

const DEVIL_VERTEX = /* glsl */ `
${AIR_VERTEX}
uniform sampler2D tPath;
uniform vec2 uNear;
attribute vec4 aA; // 第几个, 起始相位, 种子, 第几层
attribute vec4 aB; // 高, 底部半径, 每秒走多少圈, 一轮秒数
attribute vec4 aC; // 不透明度, 半径倍率, 自转（圈 / 秒）, 啃边
varying vec2 vUv;
varying vec4 vD;   // 不透明度, 啃边, 自转相位, 0
varying vec3 vN;
varying float vFacing;
void main() {
	float t = sfWind.w, seed = aA.z;
	// 一轮：0–0.08 从地上卷起来，0.62 起顶上先散，0.86 以后歇着（一成半的时间）；每一轮从路线上另一处起。起始相位按个错开，同时只有一个在歇
	float life = t / aB.w + aA.y, lap = floor( life ), k = life - lap;
	float hop = fract( sin( ( lap + 1.0 ) * ( 12.9898 + seed * 3.1 ) ) * 43758.5453 );
	float grow = smoothstep( 0.0, 0.08, k ), fade = 1.0 - smoothstep( 0.72, 0.86, k ), loose = smoothstep( 0.62, 0.86, k );
	float u = fract( aA.y + hop * 0.5 + t * aB.z ), f = u * ${DEVIL_PATH.toFixed(1)}, i0 = floor( f ), fk = f - i0;
	int row = int( aA.x + 0.5 );
	vec3 p0 = texelFetch( tPath, ivec2( int( mod( i0, ${DEVIL_PATH.toFixed(1)} ) ), row ), 0 ).xyz;
	vec3 p1 = texelFetch( tPath, ivec2( int( mod( i0 + 1.0, ${DEVIL_PATH.toFixed(1)} ) ), row ), 0 ).xyz;
	vec3 base = mix( p0, p1, fk ) - vec3( 0.0, 0.4, 0.0 );
	float h = uv.y, H = aB.x * mix( 0.3, 1.0, grow ) * ( 1.0 + 0.15 * loose );
	// 轴：越高越顺风歪，慢慢摆；阵风锋面过来时整根被推一下
	vec2 sway = vec2( sin( t * 0.41 + seed * 17.0 + h * 2.2 ), cos( t * 0.33 + seed * 11.0 + h * 1.7 ) ) * ( 0.4 + 2.0 * h * h );
	vec2 lean = sfWind.xy * ( H * 0.16 * h * h + sfGust( base.xz ).x * 2.5 * h );
	vec3 axis = base + vec3( sway.x + lean.x, h * H, sway.y + lean.y );
	// 漏斗：底细顶粗，散的时候张开；最外一层脚下多一圈扬起的裙边
	float r = aB.y * aC.y * ( 0.55 + 2.9 * pow( h, 1.5 ) ) * ( 1.0 + 0.8 * loose * h );
	r *= 1.0 + ( aA.w > 1.5 ? 1.6 : 0.35 ) * exp( -h * 16.0 );
	vec3 radial = vec3( position.x, 0.0, position.z );
	vec3 wp = axis + radial * r;
	vUv = vec2( uv.x, h );
	vN = radial;
	vFacing = abs( dot( radial, normalize( cameraPosition - wp ) ) );
	// 只在远处：按脚下离相机的水平距离整根淡入
	float near = smoothstep( uNear.x, uNear.x + uNear.y, length( base.xz - cameraPosition.xz ) );
	vD = vec4( aC.x * grow * fade * near, aC.w + 0.4 * loose * ( 0.3 + h ), aC.z, 0.0 );
	vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
	sfxAir( wp, -mvPosition.z );
	// 整根看不见（歇着 / 太近 / 雾终点外）：整个实例不画（这些量整根相同，不会只扔掉一半顶点）
	if ( vD.x < 0.003 || sfxFogAt( length( base - cameraPosition ) - aB.x ) > 0.995 ) gl_Position = SFX_CULL;
}
`;

const DEVIL_FRAGMENT = /* glsl */ `
${AIR_FRAGMENT}
uniform vec3 uLight, uShade;
varying vec2 vUv;
varying vec4 vD;
varying vec3 vN;
varying float vFacing;
void main() {
	#ifdef USE_FOG
		float t = sfWind.w, h = vUv.y;
		// 旋转条纹：斜着往上绕，噪声跟着条纹一起转，边被啃出缺口
		float s = vUv.x + h * 1.4 - t * vD.z;
		float band = 0.5 + 0.5 * sin( s * 18.85 );
		vec3 nz = texture2D( tNoise, vec2( s, h * 0.9 - t * 0.05 ) ).rgb;
		float body = smoothstep( 0.0, 0.08, h ) * ( 1.0 - smoothstep( 0.62, 1.0, h ) );
		// 下半截密一点、阶梯放软：读成一根卷着的尘柱，不是一把细丝（实测窄阶梯 + 上下一样密像一束麦秆）
		float a = smoothstep( 0.28, 0.7, band * 0.36 + nz.r * 0.5 + nz.b * 0.25 + 0.12 * ( 1.0 - h ) - vD.y ) * body * vD.x;
		// 轮廓边上（掠射）淡掉：读成一团旋着的尘，不是一根管子
		a *= smoothstep( 0.0, 0.55, vFacing ) * sfxFar();
		if ( a < 0.003 ) discard;
		// 两阶：向阳面亮沙、背阳面暗沙，中间一道软阶梯。按沙的本色上光（同落沙），不乘低雾色——
		// 乘在偏紫灰的雾色上整根发灰，和狼烟一个颜色，三根灰柱子抢地标（实测）
		vec3 sd = normalize( vec3( sfAtmoSunDir.x, 0.0, sfAtmoSunDir.z ) + vec3( 1e-4 ) );
		float sh = smoothstep( -0.12, 0.22, dot( normalize( vN ), sd ) );
		vec3 c = sfxLitSand( mix( uShade, uLight, sh ), sh );
		// 逆光：啃出来的薄边透亮（尘是暖的，逆光发金，不是一根暗烟）
		c += sfSunLight.rgb * ( vSun.x * vSun.y * 0.35 * ( 1.0 - smoothstep( 0.0, 0.6, a / max( vD.x, 1e-3 ) ) ) );
		gl_FragColor = vec4( sfxFog( c ), a );
	#else
		discard;
	#endif
}
`;

/** 远处尘卷风：所有的风、所有层一次绘制调用（实例 = 个数 × 层数），只在 minDistance（默认 40 m）以外画 */
export class DustDevils extends SfxMesh {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly count: number;

  constructor(ground: GroundFn, devils: readonly DustDevil[], options: DustDevilOptions = {}) {
    super();
    const rnd = mulberry(options.seed ?? 5503), layers = options.layers ?? 3;
    const rows = Math.max(1, devils.length), data = new Float32Array(DEVIL_PATH * rows * 4);
    const aA: number[] = [], aB: number[] = [], aC: number[] = [];
    // 各层：核心窄、密、转得快；外层宽、淡、慢、啃得碎
    const LAYERS = layers === 2
      ? [{ scale: 0.7, alpha: 0.85, spin: 0.28, erode: 0.08 }, { scale: 1.3, alpha: 0.42, spin: 0.16, erode: 0.22 }]
      : [{ scale: 0.62, alpha: 0.85, spin: 0.3, erode: 0.08 }, { scale: 1, alpha: 0.58, spin: 0.21, erode: 0.16 }, { scale: 1.45, alpha: 0.32, spin: 0.14, erode: 0.26 }];
    devils.forEach((devil, row) => {
      let loop = devil.path;
      if (loop.length < 2) {
        const c = loop[0] ?? [0, 0], r = devil.wander ?? 12;
        loop = Array.from({ length: 8 }, (_, i) => [c[0] + Math.cos(i / 8 * Math.PI * 2) * r, c[1] + Math.sin(i / 8 * Math.PI * 2) * r * 0.7] as XZ);
      }
      // 闭合路线按弧长取 32 个点，高度落到地面上
      const at: number[] = [0];
      for (let i = 1; i <= loop.length; i++) {
        const a = loop[i - 1], b = loop[i % loop.length];
        at.push(at[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
      const length = Math.max(1, at[at.length - 1]);
      for (let k = 0; k < DEVIL_PATH; k++) {
        const s = length * k / DEVIL_PATH;
        let i = 1;
        while (i < loop.length && s > at[i]) i++;
        const a = loop[i - 1], b = loop[i % loop.length], t = (s - at[i - 1]) / Math.max(1e-6, at[i] - at[i - 1]);
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, y = ground(x, z);
        data.set([x, Number.isFinite(y) ? y : 0, z, 0], (row * DEVIL_PATH + k) * 4);
      }
      const phase = devil.phase ?? (0.12 + 0.41 * row) % 1, seed = rnd();
      LAYERS.forEach((layer, l) => {
        aA.push(row, phase, seed, layers === 2 && l === 1 ? 2 : l);
        aB.push(devil.height ?? 24, devil.radius ?? 1.7, (devil.speed ?? 1.6) / length, devil.cycle ?? 52);
        aC.push((devil.opacity ?? 0.8) * layer.alpha, layer.scale, layer.spin * (0.85 + 0.3 * rnd()), layer.erode);
      });
    });
    const path = new THREE.DataTexture(data, DEVIL_PATH, rows, THREE.RGBAFormat, THREE.FloatType);
    path.minFilter = path.magFilter = THREE.NearestFilter;
    path.generateMipmaps = false;
    path.needsUpdate = true;
    this.owned.push(path);

    // 开口圆筒：半径 1、高 1（y 0..1），uv.x 绕一圈 0..1（接缝处顶点重复）
    const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
    for (let j = 0; j <= DEVIL_RINGS; j++) for (let i = 0; i <= DEVIL_RADIAL; i++) {
      const a = i / DEVIL_RADIAL * Math.PI * 2;
      pos.push(Math.cos(a), j / DEVIL_RINGS, Math.sin(a));
      uvs.push(i / DEVIL_RADIAL, j / DEVIL_RINGS);
    }
    for (let j = 0; j < DEVIL_RINGS; j++) for (let i = 0; i < DEVIL_RADIAL; i++) {
      const a = j * (DEVIL_RADIAL + 1) + i, b = a + 1, c = a + DEVIL_RADIAL + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(idx);
    geometry.setAttribute('aA', new THREE.InstancedBufferAttribute(new Float32Array(aA), 4));
    geometry.setAttribute('aB', new THREE.InstancedBufferAttribute(new Float32Array(aB), 4));
    geometry.setAttribute('aC', new THREE.InstancedBufferAttribute(new Float32Array(aC), 4));
    this.count = aA.length / 4;
    geometry.instanceCount = this.count;
    const material = sfxMaterial(DEVIL_VERTEX, DEVIL_FRAGMENT, {
      tPath: { value: path }, uNear: nearUniform(options, 40, 18),
      uLight: { value: new THREE.Vector3(...(options.light ?? [0.98, 0.82, 0.6])) }, uShade: { value: new THREE.Vector3(...(options.shade ?? [0.74, 0.57, 0.42])) },
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'SandFx.devils';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -3;
  }
}

// ───────────── 3. 烽燧狼烟 ─────────────

export interface SmokeColumn {
  /** 烟从哪儿冒（世界坐标：烽燧顶上的火塘） */
  origin: Vec3;
  /** 烟柱高（m），默认 70 */
  height?: number;
  /** 风吹向（XZ）；默认读 Atmosphere 的风 */
  wind?: XZ;
  /** 高处的风比地面的风转多少度（方位角，同 spec.ts），默认 0。烟正对着镜头吹过来时弯读不出来，可以偏 20–30° */
  veer?: number;
  /** 底部粗细（直径，m），默认 3；往上散到约 6 倍 */
  width?: number;
  /** 从多高开始被风吹弯（× height），默认 0.45 */
  bendStart?: number;
  /** 吹弯以后往下风拖多远（× height），默认 0.9 */
  drift?: number;
  /** 不透明度（底部那一截），默认 0.9；往上淡到约四成 */
  opacity?: number;
  /** 上升速度（m/s），默认 2.2 */
  rise?: number;
  /** 烟团个数，默认 64（低画质 43） */
  count?: number;
}

export interface SmokeOptions extends NearFade {
  /** 暖灰（底）/ 浅灰（顶），显示空间，默认 [0.74, 0.68, 0.62] / [0.93, 0.91, 0.88] */
  low?: Rgb;
  high?: Rgb;
  /** 低画质：烟团减到三分之二 */
  lowQuality?: boolean;
  seed?: number;
}

const MAX_SMOKE = 4;

const SMOKE_VERTEX = /* glsl */ `
${AIR_VERTEX}
uniform vec4 uO[ ${MAX_SMOKE} ]; // 起点 xyz, 高
uniform vec4 uW[ ${MAX_SMOKE} ]; // 风向 xz（已偏转）, 底部直径, 开始吹弯的高度（× 高）
uniform vec4 uK[ ${MAX_SMOKE} ]; // 往下风拖多远（× 高）, 不透明度, 上升速度, 烟团个数
uniform vec2 uNear;
attribute vec4 aP; // 第几根, 起始相位, 种子, 横向摆动
attribute vec4 aQ; // 大小倍率, 翻滚速度（带正负）, 不透明度倍率, 0
varying vec2 vUv;
varying vec4 vS;   // 不透明度, 年龄 0..1, 种子, 翻滚角
varying vec3 vL;   // 太阳方向在 镜头右 / 镜头上 / 朝镜头 三个轴上的分量（假球面法线打光）
void main() {
	int ci = int( aP.x + 0.5 );
	vec4 O = uO[ ci ], W = uW[ ci ], K = uK[ ci ];
	float t = sfWind.w, sd = aP.z, H = O.w;
	// 年龄 = 走到烟柱的哪一截；匀速往上冒，到头从火塘重新出来
	float s = fract( aP.y + t * K.z / H );
	float bend = pow( max( s - W.w, 0.0 ) / max( 1.0 - W.w, 1e-3 ), 1.6 );
	vec2 dir = W.xy, side = vec2( -dir.y, dir.x );
	vec3 c = O.xyz + vec3( 0.0, s * H * ( 1.0 - 0.25 * bend ), 0.0 );
	c.xz += dir * ( K.x * H * bend + 0.03 * H * s );
	// 阵风：越高被推得越远（软的东西），锋面过去后慢慢松回来
	c.xz += dir * ( sfGust( c.xz ).x * ( 1.0 + 5.0 * s ) );
	float size = W.z * ( 1.0 + 5.0 * pow( s, 1.15 ) ) * aQ.x;
	// 横着慢慢摆、上下错开一点：不是一串珠子
	c.xz += side * ( ( sin( t * 0.23 + s * 7.0 + sd * 31.0 ) * 0.5 + aP.w ) * size * 0.28 );
	c.y += ( fract( sd * 7.7 ) - 0.5 ) * size * 0.25;
	vec3 cr = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] ), cu = vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] );
	// 竖直那一截的烟团竖着拉长（相邻的团叠得多，读成一根柱子，不是一串珠子）；吹弯以后恢复成圆团
	float tall = mix( 1.9, 1.0, smoothstep( 0.0, W.w + 0.1, s ) );
	vec3 wp = c + ( cr * position.x + cu * ( position.y * tall ) ) * size;
	// 不透明度：整根烟柱的目标浓度（底浓顶淡）按烟团间距换算到每一团（叠多少团都是这个浓度）
	float spacing = H / K.w * ( 1.0 + 1.2 * bend );
	float target = K.y * mix( 1.0, 0.4, smoothstep( 0.25, 1.0, s ) );
	float a = 1.0 - pow( 1.0 - min( target, 0.98 ), clamp( spacing / ( 0.55 * size * tall ), 0.02, 1.0 ) );
	a *= smoothstep( 0.0, 0.035, s ) * ( 1.0 - smoothstep( 0.7, 1.0, s ) ) * aQ.z;
	float dc = length( c - cameraPosition );
	a *= smoothstep( uNear.x, uNear.x + uNear.y, dc );
	vS = vec4( a, s, sd, sd * 6.2832 + t * aQ.y );
	vUv = position.xy * 2.0;
	vec3 F = normalize( cameraPosition - c );
	vL = vec3( dot( cr, sfAtmoSunDir.xyz ), dot( cu, sfAtmoSunDir.xyz ), dot( F, sfAtmoSunDir.xyz ) );
	vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
	sfxAir( c, -mvPosition.z );
	if ( a < 0.003 || sfxFogAt( dc - size ) > 0.995 ) gl_Position = SFX_CULL;
}
`;

const SMOKE_FRAGMENT = /* glsl */ `
${AIR_FRAGMENT}
uniform vec3 uLow, uHigh;
varying vec2 vUv;
varying vec4 vS;
varying vec3 vL;
void main() {
	#ifdef USE_FOG
		vec2 q = vUv;
		// 翻滚：每团的噪声跟着自己的角度慢慢转；轮廓被鼓包噪声啃出团块，越老啃得越深
		float ca = cos( vS.w ), sa = sin( vS.w );
		vec2 rq = mat2( ca, sa, -sa, ca ) * q;
		vec4 nz = texture2D( tNoise, rq * 0.21 + vec2( vS.z * 5.3, vS.z * 3.1 ) );
		vec4 nz2 = texture2D( tNoise, rq * 0.47 + vec2( vS.z * 2.7, vS.y * 0.4 ) );
		float r = length( q );
		float edge = r + ( nz.a - 0.5 ) * ( 0.36 + 0.5 * vS.y ) + ( nz2.b - 0.5 ) * 0.2;
		float dens = 1.0 - smoothstep( 0.42, 0.95, edge );
		float a = dens * vS.x * sfxFar();
		if ( a < 0.003 ) discard;
		// 假球面法线打光，两阶明暗（亮面 / 暗面中间一道软阶梯）
		float z = sqrt( max( 0.0, 1.0 - r * r ) );
		float sh = smoothstep( -0.18, 0.3, q.x * vL.x + q.y * vL.y + z * vL.z + ( nz.g - 0.5 ) * 0.35 );
		vec3 base = mix( uLow, uHigh, smoothstep( 0.04, 0.5, vS.y ) );
		vec3 sky = sfAtmoAir.rgb * 0.85 + sfAtmoMist.rgb * 0.3;
		vec3 c = base * sky * ( 0.72 + 0.28 * sh ) + base * sfSunLight.rgb * ( vSun.x * 0.45 * sh );
		// 逆光：外沿薄的地方透亮
		float rim = smoothstep( 0.3, 0.85, edge );
		c += sfSunLight.rgb * ( vSun.x * vSun.y * ( 0.18 + 1.1 * rim ) );
		// 火塘上方那一截被火映暖
		c *= mix( vec3( 1.0 ), vec3( 1.22, 0.96, 0.74 ), ( 1.0 - smoothstep( 0.0, 0.05, vS.y ) ) * 0.6 );
		gl_FragColor = vec4( sfxFog( sfxClamp( c, 1.05 ) ), a );
	#else
		discard;
	#endif
}
`;

/** 烽燧狼烟：最多 4 根，一次绘制调用（实例 = 烟团总数） */
export class BeaconSmoke extends SfxMesh {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly count: number;

  constructor(columns: readonly SmokeColumn[], options: SmokeOptions = {}) {
    super();
    if (columns.length > MAX_SMOKE) console.warn(`[sandFx] 狼烟最多 ${MAX_SMOKE} 根，多的不画`);
    const rnd = mulberry(options.seed ?? 6607), list = columns.slice(0, MAX_SMOKE);
    const O = Array.from({ length: MAX_SMOKE }, () => new THREE.Vector4()), Wv = Array.from({ length: MAX_SMOKE }, () => new THREE.Vector4()), K = Array.from({ length: MAX_SMOKE }, () => new THREE.Vector4());
    const aP: number[] = [], aQ: number[] = [];
    list.forEach((col, ci) => {
      const n = Math.max(8, Math.round((col.count ?? 64) * (options.lowQuality ? 0.67 : 1))), w = veer(windOf(col.wind), col.veer ?? 0);
      O[ci].set(col.origin[0], col.origin[1], col.origin[2], col.height ?? 70);
      Wv[ci].set(w[0], w[1], col.width ?? 3, col.bendStart ?? 0.45);
      K[ci].set(col.drift ?? 0.9, col.opacity ?? 0.9, col.rise ?? 2.2, n);
      for (let i = 0; i < n; i++) {
        aP.push(ci, (i + rnd()) / n, rnd(), (rnd() - 0.5) * 0.8);
        aQ.push(0.8 + 0.4 * rnd(), (0.08 + 0.12 * rnd()) * (rnd() < 0.5 ? -1 : 1), 0.8 + 0.2 * rnd(), 0);
      }
    });
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(QUAD, 3));
    geometry.setIndex([0, 1, 2, 1, 3, 2]);
    geometry.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(aP), 4));
    geometry.setAttribute('aQ', new THREE.InstancedBufferAttribute(new Float32Array(aQ), 4));
    this.count = aP.length / 4;
    geometry.instanceCount = this.count;
    const material = sfxMaterial(SMOKE_VERTEX, SMOKE_FRAGMENT, {
      uO: { value: O }, uW: { value: Wv }, uK: { value: K }, uNear: nearUniform(options),
      uLow: { value: new THREE.Vector3(...(options.low ?? [0.74, 0.68, 0.62])) }, uHigh: { value: new THREE.Vector3(...(options.high ?? [0.93, 0.91, 0.88])) },
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'SandFx.smoke';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -2;
  }
}

// ───────────── 4. 落沙 ─────────────

export interface SandFall {
  /** 沙从哪儿落（世界坐标：崖沿 / 门洞 / 屋檐上的一点） */
  top: Vec3;
  /** 往外的方向（XZ：崖面朝外 / 檐口朝外），默认顺风 */
  out?: XZ;
  /** 落到多低（世界 y）；默认顺着 out 往外找到地面不再往下的地方 */
  bottom?: number;
  /** 宽（m），默认 1.6；往下散到约 1.6 倍 */
  width?: number;
  /** 不透明度，默认 0.5 */
  opacity?: number;
  /** 流量 0..1：小 = 断断续续的一股股，1 = 连续的沙瀑；默认 0.65 */
  flow?: number;
  /** 离开崖沿时的水平速度（m/s），默认 0.8：门洞 / 屋檐给 1.2–1.5 */
  lip?: number;
}

export interface SandFallOptions extends NearFade {
  /** 沙的本色（显示空间，按天光 + 日光照亮；不跟雾色走——1-2 的雾偏粉灰，跟它走落沙像一道白瀑布），默认 [0.95, 0.8, 0.58] */
  color?: Rgb;
  /** 向阳份额（落沙是薄薄一层，正反面差不多亮），默认 0.7 */
  sun?: number;
  seed?: number;
}

const FALL_ROWS = 18;

const FALL_VERTEX = /* glsl */ `
${AIR_VERTEX}
uniform vec2 uNear;
attribute vec4 aT; // 条带：落线切线 xyz, 左右 ±1；扬尘团：四角 xy
attribute vec4 aF; // 落下的份额 0..1, 落了多少秒, 这一处的宽, 种子
attribute vec4 aG; // 不透明度, 流量, 第几种（0 条带 / 1–3 扬尘团）, 落差
varying vec2 vUv;
varying vec4 vF;   // 落了多少秒, 种子, 宽, 流量
varying vec4 vG;   // 不透明度, 第几种, 年龄, 落下的份额
void main() {
	float t = sfWind.w;
	vec3 cr = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] ), cu = vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] );
	vec3 wp, p = position;
	float a = aG.x, age = 0.0;
	if ( aG.z < 0.5 ) {
		// 条带：顺着 CPU 算好的落线，宽度方向绕落线转向镜头；下半截被风吹斜一点，阵风来时多一点
		float v = aF.x;
		p.xz += sfWind.xy * ( v * v * ( 0.5 + 1.6 * sfGust( p.xz ).x ) );
		vec3 T = normalize( aT.xyz ), toCam = normalize( cameraPosition - p ), side = cross( T, toCam );
		float sl = length( side );
		side = sl > 1e-3 ? side / sl : cr;
		wp = p + side * ( aT.w * aF.z * 0.5 );
		vUv = vec2( aT.w, v );
	} else {
		// 底部扬尘：三团轮流鼓起来、顺风飘开、散掉
		float k = aG.z - 1.0;
		age = fract( t / 2.8 + k / 3.0 + aF.w * 5.0 );
		float size = aF.z * ( 1.1 + 1.9 * age );
		vec3 c = p + vec3( 0.0, 0.25 + 1.3 * age, 0.0 );
		float ang = k * 2.1 + aF.w * 9.0;
		c.xz += sfWind.xy * ( 1.6 * age ) + vec2( cos( ang ), sin( ang ) ) * ( 0.5 * size * age );
		wp = c + ( cr * aT.x + cu * aT.y ) * ( 0.5 * size );
		a *= 0.42 * smoothstep( 0.0, 0.15, age ) * pow( 1.0 - age, 1.5 );
		vUv = aT.xy;
		p = c;
	}
	a *= smoothstep( uNear.x, uNear.x + uNear.y, length( p - cameraPosition ) );
	vF = vec4( aF.y, aF.w, aF.z, aG.y );
	vG = vec4( a, aG.z, age, aF.x );
	vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
	sfxAir( wp, -mvPosition.z );
}
`;

const FALL_FRAGMENT = /* glsl */ `
${AIR_FRAGMENT}
uniform vec3 uColor;
uniform float uSunShare;
varying vec2 vUv;
varying vec4 vF;
varying vec4 vG;
void main() {
	#ifdef USE_FOG
		float t = sfWind.w, a;
		if ( vG.y < 0.5 ) {
			// 纵向条纹：噪声沿「落了多少秒」滚动——越往下拉得越长、走得越快，读得出是在加速往下掉
			float u = vUv.x, v = vG.w, ft = vF.x - t;
			vec3 n1 = texture2D( tNoise, vec2( u * vF.z * 0.16 + vF.y * 7.0, ft * 0.5 ) ).rgb;
			vec3 n2 = texture2D( tNoise, vec2( u * vF.z * 0.38 + vF.y * 3.0, ft * 1.2 ) ).rgb;
			float core = 1.0 - smoothstep( 0.15, 1.0, abs( u ) + ( n2.b - 0.5 ) * 0.9 );
			float streak = smoothstep( 0.4, 0.66, n1.r * 0.62 + n2.g * 0.42 + core * 0.2 - 0.22 * v );
			// 断流：流量小时一股一股往下走
			float gate = smoothstep( 0.85 - vF.w, 1.15 - vF.w, texture2D( tNoise, vec2( vF.y * 3.0, ft * 0.11 ) ).r + 0.3 );
			a = core * streak * gate * smoothstep( 0.0, 0.05, v ) * ( 1.0 - smoothstep( 0.78, 1.0, v ) ) * vG.x;
		} else {
			vec2 q = vUv * 2.0;
			vec3 nz = texture2D( tNoise, q * 0.18 + vec2( vF.y * 4.0 + vG.y * 0.37, vG.z * 0.3 ) ).rgb;
			a = ( 1.0 - smoothstep( 0.35, 1.0, length( q ) + ( nz.r - 0.5 ) * 0.6 ) ) * vG.x;
		}
		a *= sfxFar();
		if ( a < 0.003 ) discard;
		vec3 c = sfxLitSand( uColor, uSunShare );
		gl_FragColor = vec4( sfxFog( c ), a );
	#else
		discard;
	#endif
}
`;

/** 一股落沙的落线：从 top 往下，自由落体的抛物线和「贴着崖面、离开 0.5 m」取更靠外的那个（崖不竖直时沙顺着崖面淌下来） */
export function fallSpine(fall: SandFall, ground: GroundFn, wind: XZ): { points: Vec3[]; tau: number[]; drop: number } {
  const top = fall.top, out = unit(fall.out ?? wind), lip = fall.lip ?? 0.8;
  let bottom = fall.bottom;
  if (bottom === undefined) {
    // 顺着 out 往外找：先走到崖沿（top 可能离崖沿还有几米），开始往下以后一直跟着，平下来（每 0.5 m 降不到 0.12 m）连续 2 m 就是坡脚
    let low = top[1], flat = 0, falling = false;
    for (let a = 0.5; a <= 40; a += 0.5) {
      const g = ground(top[0] + out[0] * a, top[2] + out[1] * a, top[1] + 0.5);
      if (!Number.isFinite(g)) break;
      if (g < low - 0.12) { low = g; flat = 0; falling = true; } else if (falling && ++flat >= 4) break;
    }
    bottom = low;
  }
  const drop = Math.max(1, top[1] - bottom), points: Vec3[] = [], tau: number[] = [];
  let last = 0;
  for (let j = 0; j < FALL_ROWS; j++) {
    const v = j / (FALL_ROWS - 1), y = top[1] - drop * v, ff = Math.sqrt(2 * drop * v / 9.8);
    // 离崖面留 0.5 m，快到坡脚时收到 0（坡脚是平的，再要求留空就会一路往外找出去十几米）；每节最多往外挪 2.5 m
    const clear = Math.min(0.5, Math.max(0, y - bottom) * 0.5), reach = j === 0 ? 40 : last + 2.5;
    let surf = last;
    while (surf < reach) {
      const g = ground(top[0] + out[0] * surf, top[2] + out[1] * surf, y + 0.5);
      if (!Number.isFinite(g) || g <= y - clear + 1e-3) break;
      surf += 0.1;
    }
    last = Math.max(last, Math.min(surf, reach), lip * ff);
    points.push([top[0] + out[0] * last, y, top[2] + out[1] * last]);
    // 落了多少秒：自由落体的时间，贴着崖面淌的时候慢一些
    tau.push(ff * (1 + 0.6 * Math.min(1, Math.max(0, last - lip * ff) / Math.max(1, drop * 0.5))));
  }
  return { points, tau, drop };
}

/** 落沙：所有沙瀑一次绘制调用（每股 18 节条带 + 底部 3 团扬尘，合成一份几何） */
export class SandFalls extends SfxMesh {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly count: number;

  constructor(ground: GroundFn, falls: readonly SandFall[], options: SandFallOptions & { wind?: XZ } = {}) {
    super();
    const rnd = mulberry(options.seed ?? 7709), wind = windOf(options.wind);
    const pos: number[] = [], aT: number[] = [], aF: number[] = [], aG: number[] = [], idx: number[] = [];
    for (const fall of falls) {
      const { points, tau, drop } = fallSpine(fall, ground, wind), seed = rnd(), width = fall.width ?? 1.6;
      const opacity = fall.opacity ?? 0.5, flow = fall.flow ?? 0.65, base = pos.length / 3;
      for (let j = 0; j < FALL_ROWS; j++) {
        const p = points[j], a = points[Math.max(0, j - 1)], b = points[Math.min(FALL_ROWS - 1, j + 1)], v = j / (FALL_ROWS - 1);
        for (const side of [-1, 1]) {
          pos.push(p[0], p[1], p[2]);
          aT.push(b[0] - a[0], b[1] - a[1], b[2] - a[2], side);
          aF.push(v, tau[j], width * (0.85 + 0.8 * v), seed);
          aG.push(opacity, flow, 0, drop);
        }
      }
      for (let j = 0; j < FALL_ROWS - 1; j++) {
        const a = base + j * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      // 底部扬尘：三团，四角各一个顶点，位置都在坡脚
      const foot = points[FALL_ROWS - 1];
      for (let k = 1; k <= 3; k++) {
        const q = pos.length / 3;
        for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          pos.push(foot[0], foot[1] - 0.2, foot[2]);
          aT.push(x, y, 0, 0);
          aF.push(1, 0, width * 1.1, seed);
          aG.push(opacity, flow, k, drop);
        }
        idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 4));
    geometry.setAttribute('aF', new THREE.Float32BufferAttribute(aF, 4));
    geometry.setAttribute('aG', new THREE.Float32BufferAttribute(aG, 4));
    geometry.setIndex(idx);
    this.count = falls.length;
    const material = sfxMaterial(FALL_VERTEX, FALL_FRAGMENT, {
      uNear: nearUniform(options), uColor: { value: new THREE.Vector3(...(options.color ?? [0.95, 0.8, 0.58])) }, uSunShare: { value: options.sun ?? 0.7 },
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'SandFx.falls';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -3;
  }
}

// ───────────── 5. 贴地流沙 ─────────────

export interface DriftPatch {
  /** 中心（世界 XZ） */
  center: XZ;
  /** 顺风的长、横风的宽（m），默认 60 × 30；四边各留两成淡入淡出 */
  size?: XZ;
  /** 不透明度，默认 0.3（纹路最浓处；平均下来极淡） */
  opacity?: number;
}

export interface GroundDriftOptions extends NearFade {
  /** 风吹向（XZ）；默认读 Atmosphere 的风 */
  wind?: XZ;
  /** 避开的圆（交战区）：圆里不画，外沿 margin（默认 10 m）淡入 */
  avoid?: { x: number; z: number; r: number }[];
  margin?: number;
  /** 额外的遮罩 (x, z) → 0..1 */
  mask?: (x: number, z: number) => number;
  /** 网格边长（m），默认 1.5：贴着地形起伏 */
  cell?: number;
  /** 几层（离地 0.2 / 0.5 m），默认 2，低画质 1 */
  layers?: 1 | 2;
  /** 滑动速度 = 风速 × 这个倍率，默认 1.1 */
  speed?: number;
  /** 沙色（乘在低雾色上），默认 [1.05, 1.0, 0.94] */
  tint?: Rgb;
  /** 多远以外淡掉（m），默认 [110, 170]：再远是几个像素高的细纹，会闪 */
  far?: XZ;
}

const DRIFT_VERTEX = /* glsl */ `
${AIR_VERTEX}
uniform vec2 uNear, uFar;
attribute vec4 aD; // 顺风 m, 横风 m, 遮罩, 第几层
varying vec4 vD;
varying float vGust;
void main() {
	vec3 wp = position;
	float d = length( wp - cameraPosition );
	vD = vec4( aD.xy, aD.z * smoothstep( uNear.x, uNear.x + uNear.y, d ) * ( 1.0 - smoothstep( uFar.x, uFar.y, d ) ), aD.w );
	vGust = sfGust( wp.xz ).x;
	vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
	sfxAir( wp, -mvPosition.z );
}
`;

const DRIFT_FRAGMENT = /* glsl */ `
${AIR_FRAGMENT}
uniform vec4 uDrift; // 不透明度, 速度倍率, 0, 0
uniform vec3 uTint;
varying vec4 vD;
varying float vGust;
void main() {
	#ifdef USE_FOG
		if ( vD.z < 0.002 ) discard;
		float t = sfWind.w, v = sfWind.z * uDrift.y;
		// 顺风拉长的细纹（长约为宽的六倍）蛇行着往下风滑；两层速度不同，纹路一会儿合一会儿散
		float across = vD.y + sin( vD.x * 0.045 + t * 0.15 + vD.w * 2.0 ) * 1.6;
		vec3 n1 = texture2D( tNoise, vec2( across * 0.045, ( vD.x - t * v ) * 0.0075 ) + vD.w * 0.37 ).rgb;
		vec3 n2 = texture2D( tNoise, vec2( across * 0.09 + 0.3, ( vD.x - t * v * 1.6 ) * 0.012 ) + vD.w * 0.61 ).rgb;
		float a = smoothstep( 0.42, 0.64, n1.r * 0.62 + n2.b * 0.55 - 0.14 ) * vD.z * uDrift.x * ( 0.75 + 0.7 * vGust ) * sfxFar();
		if ( a < 0.003 ) discard;
		gl_FragColor = vec4( sfxFog( sfxSand( uTint, 1.0, 0.9 ) ), a );
	#else
		discard;
	#endif
}
`;

/** 贴地流沙：所有块合成一份贴着地形的网格，一次绘制调用 */
export class GroundDrift extends SfxMesh {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** 三角形数 */
  readonly triangles: number;

  constructor(ground: GroundFn, patches: readonly DriftPatch[], options: GroundDriftOptions = {}) {
    super();
    const [wx, wz] = windOf(options.wind), sx = -wz, sz = wx, cell = options.cell ?? 1.5, layers = options.layers ?? 2, margin = options.margin ?? 10;
    const lifts = [0.2, 0.5], pos: number[] = [], aD: number[] = [], idx: number[] = [];
    for (const patch of patches) {
      const [len, wid] = patch.size ?? [60, 30], nu = Math.max(2, Math.round(len / cell)) + 1, nv = Math.max(2, Math.round(wid / cell)) + 1;
      const opacity = patch.opacity ?? 0.3;
      for (let l = 0; l < layers; l++) {
        const base = pos.length / 3;
        for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
          const u = (i / (nu - 1) - 0.5) * len, v = (j / (nv - 1) - 0.5) * wid;
          const x = patch.center[0] + wx * u + sx * v, z = patch.center[1] + wz * u + sz * v, g = ground(x, z);
          const edge = Math.min(1, (0.5 - Math.abs(i / (nu - 1) - 0.5)) / 0.2) * Math.min(1, (0.5 - Math.abs(j / (nv - 1) - 0.5)) / 0.2);
          let m = edge * edge * (3 - 2 * edge);
          for (const c of options.avoid ?? []) m *= Math.min(1, Math.max(0, (Math.hypot(x - c.x, z - c.z) - c.r) / margin));
          if (options.mask) m *= Math.min(1, Math.max(0, options.mask(x, z)));
          if (!Number.isFinite(g)) m = 0;
          pos.push(x, (Number.isFinite(g) ? g : 0) + lifts[l], z);
          // 世界里的顺风 / 横风坐标（不是块内的）：相邻的块纹路接得上
          aD.push(x * wx + z * wz, x * sx + z * sz, m * opacity * (l === 0 ? 1 : 0.55), l);
        }
        for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
          const a = base + j * nu + i, b = a + 1, c = a + nu, d = c + 1;
          // 整格都被遮掉的不出三角形
          if (aD[a * 4 + 2] + aD[b * 4 + 2] + aD[c * 4 + 2] + aD[d * 4 + 2] <= 1e-4) continue;
          idx.push(a, c, b, b, c, d);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('aD', new THREE.Float32BufferAttribute(aD, 4));
    geometry.setIndex(idx);
    this.triangles = idx.length / 3;
    const material = sfxMaterial(DRIFT_VERTEX, DRIFT_FRAGMENT, {
      uNear: nearUniform(options), uFar: { value: new THREE.Vector2(...(options.far ?? [110, 170])) },
      uDrift: { value: new THREE.Vector4(1, options.speed ?? 1.1, 0, 0) }, uTint: { value: new THREE.Vector3(...(options.tint ?? [1.05, 1, 0.94])) },
    }, { side: THREE.FrontSide });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'SandFx.drift';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -6;
  }
}

// ───────────── 按 DesertBuild 建 ─────────────

function attach<T extends { mesh: THREE.Object3D }>(b: DesertBuild, part: T): T {
  b.group.add(part.mesh);
  return part;
}

/** 沙丘脊吹沙，挂到 b.group；风向默认这张图的风 */
export function ridgeSand(b: DesertBuild, ridges: readonly RidgeLine[], options: RidgeSandOptions = {}): RidgeSand {
  return attach(b, new RidgeSand(ridges, { wind: b.art.wind, low: b.low, ...options }));
}

/** 远处尘卷风，挂到 b.group（路线高度落在地形 + 碰撞体上） */
export function dustDevils(b: DesertBuild, devils: readonly DustDevil[], options: DustDevilOptions = {}): DustDevils {
  return attach(b, new DustDevils((x, z) => b.groundHeight(x, z), devils, { layers: b.low ? 2 : 3, ...options }));
}

/** 烽燧狼烟，挂到 b.group；风向默认这张图的风 */
export function beaconSmoke(b: DesertBuild, columns: readonly SmokeColumn[], options: SmokeOptions = {}): BeaconSmoke {
  return attach(b, new BeaconSmoke(columns.map(c => ({ wind: b.art.wind, ...c })), { lowQuality: b.low, ...options }));
}

/** 落沙，挂到 b.group；落线顺着地形 + 碰撞体（崖面 / 屋檐下的地面）算 */
export function sandFalls(b: DesertBuild, falls: readonly SandFall[], options: SandFallOptions = {}): SandFalls {
  return attach(b, new SandFalls((x, z, top) => b.groundHeight(x, z, top), falls, { wind: b.art.wind, ...options }));
}

/**
 * 贴地流沙，挂到 b.group；默认避开所有遭遇场地（场地半径 + 6 m）和首领场。
 * 网格贴的是地面高度（地形 + 碰撞体，同 b.groundHeight；高度场采样和地形网格差 0.1–0.4 m，实测贴高度场会半截埋进沙丘）：块不要摆到房子 / 大石头上。
 */
export function groundDrift(b: DesertBuild, patches: readonly DriftPatch[], options: GroundDriftOptions = {}): GroundDrift {
  const avoid = options.avoid ?? [
    ...b.document.encounters.map(e => ({ x: e.position[0], z: e.position[2], r: e.arenaRadius + 6 })),
    ...b.document.bosses.map(e => ({ x: e.center[0], z: e.center[2], r: e.radius + 6 })),
  ];
  return attach(b, new GroundDrift((x, z) => b.groundHeight(x, z), patches, { wind: b.art.wind, layers: b.low ? 1 : 2, ...options, avoid }));
}

export interface SandFxSpec {
  /** 脊线；'auto' = findRidges 按默认条件找 */
  ridges?: readonly RidgeLine[] | 'auto';
  ridgeOptions?: RidgeSandOptions;
  devils?: readonly DustDevil[];
  devilOptions?: DustDevilOptions;
  smoke?: readonly SmokeColumn[];
  smokeOptions?: SmokeOptions;
  falls?: readonly SandFall[];
  fallOptions?: SandFallOptions;
  drift?: readonly DriftPatch[];
  driftOptions?: GroundDriftOptions;
}

/** 一张图的整套沙漠动势层（给了哪样建哪样，每样一次绘制调用，全开 5 次） */
export function sandFx(b: DesertBuild, spec: SandFxSpec): DesertPart[] {
  const parts: DesertPart[] = [];
  const ridges = spec.ridges === 'auto' ? findRidges(b.document, { wind: b.art.wind }) : spec.ridges;
  if (ridges?.length) parts.push(ridgeSand(b, ridges, spec.ridgeOptions));
  if (spec.devils?.length) parts.push(dustDevils(b, spec.devils, spec.devilOptions));
  if (spec.smoke?.length) parts.push(beaconSmoke(b, spec.smoke, spec.smokeOptions));
  if (spec.falls?.length) parts.push(sandFalls(b, spec.falls, spec.fallOptions));
  if (spec.drift?.length) parts.push(groundDrift(b, spec.drift, spec.driftOptions));
  return parts;
}
