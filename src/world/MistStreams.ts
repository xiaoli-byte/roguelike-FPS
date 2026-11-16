import * as THREE from 'three';
import { Atmosphere, ATMOSPHERE_WIND_GLSL, atmosphereNoise } from './Atmosphere';

/**
 * 流动雾带（docs/art/composition.md 第 8.2 节「雾带摆在层与层的交界」）。
 * 一条雾带 = 沿一条路径顺风流动的一串软雾团（实例化四边形，整组一次绘制调用）：
 *   流动  雾团按 Atmosphere 的风速沿路径前进，到头回到起点，首尾淡入淡出；阵风锋面扫过时一起往前涌一下。
 *   一整条  侵蚀噪声放在「雾带自己的空间」里（横向几米、沿流向几米，跟着雾一起走）：叠在一起的雾团被同样地撕碎，
 *           看起来是一条被撕开的雾，不是一堆圆盘。
 *   光  颜色读 Atmosphere 当前的低雾色和日光：朝太阳的一侧更亮，逆光看整条发亮，云影扫过时跟着暗下去；远处的雾团
 *       照常被空气透视和场景雾吃掉，雾终点之外不画。
 *   让开交战  离相机近的雾团整个淡掉（默认 22 m 以内不画，约 60 m + 雾团直径处才到全浓），中近景保持干净。
 *   相交  默认只有深度测试；给了场景深度（useSceneDepth）时和后面的表面软相交。平地 / 水面上的雾带用 floorY 裁掉扎进地里的下半截。
 *
 * 用法（先 Atmosphere.bind，时间和风都读它的，不用每帧调别的）：
 *   const mist = new MistStreams([
 *     { keys: [{ position: [120, 14, -80], halfWidth: 20, size: 34, opacity: 0 }, …, { position: [-120, 18, -90], halfWidth: 20, size: 34, opacity: 0 }] },
 *     mistBand([0, 30, -260], 420, { halfWidth: 40, size: 60 }, { opacity: 0.6, speed: 0.5 }),   // 顺风的一条直雾带
 *   ]);
 *   group.add(mist.mesh);
 *   mist.dispose();   // 卸载这张图时
 * 摆放：只摆在层与层的交界（两排山之间、崖沿、水面、瀑布脚），浓的（opacity ≥ 0.5）只放在交战场地以外。
 */
export interface MistKey {
  /** 路径上的一点（世界坐标）：雾团中心走的线 */
  position: [number, number, number];
  /** 雾带在这一点的半宽（m）：雾团左右散开的范围 */
  halfWidth: number;
  /** 雾团直径（m） */
  size: number;
  /** 这一点的不透明度倍率 0..1，默认 1。首尾两个点给 0，雾团就在两头淡入淡出 */
  opacity?: number;
  /** 雾团上下散开的半高（m），默认直径的 0.15 */
  halfHeight?: number;
}

export interface MistStream {
  /** 至少两个点，按流向排（上风 → 下风） */
  keys: MistKey[];
  /** 雾团个数；不给就按路径长度、宽度和雾团大小估 */
  count?: number;
  /** 整条的不透明度，默认 0.4。0.15 是飘过的碎絮，0.8 是山间的云海 */
  opacity?: number;
  /** 流速 = Atmosphere 风速 × 这个倍率，默认 1。压在谷底的雾比高处的云慢，给 0.4–0.7 */
  speed?: number;
  /** 雾团沿流向拉长的倍数，默认 1.4（长轴顺着路径：山间的雾是横着铺开的，不是一团团棉花）；1 = 圆的，2 以上是被风拉成丝的碎絮 */
  stretch?: number;
  /** 平铺：朝上的四边形贴着水面 / 地面，不朝向镜头 */
  flat?: boolean;
  /** 低于这个世界高度的部分淡掉（水面、平地的高度）；不给不裁 */
  floorY?: number;
  /** 软相交距离（m），默认 6：floorY 以上这么高之内渐显；有场景深度时，离后面的表面这么近之内渐隐 */
  soft?: number;
  /** 向阳偏置：大于 0 整条更亮（瀑布脚的水雾 0.1–0.2） */
  lit?: number;
  /** 撕碎程度 0..0.3，默认 0：越大越碎越稀 */
  torn?: number;
  /** 离相机这么近（m）以内完全不画，默认 22 */
  clearDistance?: number;
}

export interface MistOptions {
  /** 透明队列里的先后，默认 -5（先于水面、粒子画，不盖住它们）。贴水面的雾带单独建一组，给一个比水面大的值 */
  renderOrder?: number;
  /** 换一组雾团的排布 */
  seed?: number;
}

const PATH_SAMPLES = 32;

const VERTEX = /* glsl */ `
#include <fog_pars_vertex>
${ATMOSPHERE_WIND_GLSL}
attribute vec4 aP; // 第几条, 起始相位, 横向 -1..1, 纵向 -1..1
attribute vec4 aQ; // 大小倍率, 种子, 不透明度倍率, 速度抖动
uniform sampler2D tPath;
uniform vec4 sfAtmoSunDir;
varying vec2 vUv;
varying vec2 vNuv;
varying vec2 vAL; // 不透明度, 向阳份额
varying vec4 vK;  // 软相交距离, 撕碎, floorY, 近处清空距离
void main() {
	int row = int( aP.x + 0.5 ) * 3;
	vec4 K0 = texelFetch( tPath, ivec2( 0, row + 2 ), 0 ); // 流速（每米风程走多少路径）, 拉长, 软相交, 平铺
	vec4 K1 = texelFetch( tPath, ivec2( 1, row + 2 ), 0 ); // 不透明度, 向阳偏置, 撕碎, floorY
	vec4 K2 = texelFetch( tPath, ivec2( 2, row + 2 ), 0 ); // 路径长度, 噪声缩放（1/m）, 近处清空距离
	float t = sfWind.w, sd = aQ.y;
	float u = fract( aP.y + sfWind.z * t * K0.x * ( 0.97 + 0.06 * aQ.w ) );
	float f = u * ${(PATH_SAMPLES - 1).toFixed(1)}, i = min( floor( f ), ${(PATH_SAMPLES - 2).toFixed(1)} ), k = f - i;
	ivec2 at = ivec2( int( i ), row );
	vec4 A0 = texelFetch( tPath, at, 0 ), A1 = texelFetch( tPath, at + ivec2( 1, 0 ), 0 );
	vec4 A = mix( A0, A1, k ), B = mix( texelFetch( tPath, at + ivec2( 0, 1 ), 0 ), texelFetch( tPath, at + ivec2( 1, 1 ), 0 ), k );
	vec3 tg = A1.xyz - A0.xyz;
	vec3 th = vec3( tg.x, 0.0, tg.z );
	float thl = length( th );
	th = thl > 1e-4 ? th / thl : vec3( 0.0, 0.0, 1.0 );
	vec3 side = vec3( th.z, 0.0, -th.x );
	float size = B.x * aQ.x;
	vec3 c = A.xyz + side * ( aP.z * A.w ) + vec3( 0.0, aP.w * B.z, 0.0 );
	c += vec3( sin( t * 0.21 + sd * 40.0 ), 0.4 * sin( t * 0.17 + sd * 71.0 ), cos( t * 0.19 + sd * 53.0 ) ) * ( 0.05 * size + 0.3 );
	// 阵风：锋面扫到时顺风涌出去、三秒多松回来，刚到的那一下鼓一点
	vec2 gust = sfGust( c.xz );
	c.xz += sfWind.xy * ( gust.x * ( 3.0 + 0.1 * size ) );
	// 四边形：朝向镜头（拉长的顺着路径在画面里的走向），或平铺
	vec3 cr = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] ), cu = vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] ), ex = cr, ey = cu;
	float stretch = K0.y;
	if ( K0.w > 0.5 ) {
		ex = th;
		ey = side;
	} else if ( K0.y > 1.05 ) {
		// 路径横在画面里时顺着它拉长；路径正对着镜头来（走向在画面里缩成一点）时退回不拉长的横放，否则会被拉成一道道斜纹
		vec2 tv = vec2( dot( tg, cr ), dot( tg, cu ) );
		float tl = length( tv ), across = smoothstep( 0.25, 0.75, tl / max( length( tg ), 1e-4 ) );
		tv = tl > 1e-5 ? tv / tl * ( tv.x < 0.0 ? -1.0 : 1.0 ) : vec2( 1.0, 0.0 );
		tv = normalize( mix( vec2( 1.0, 0.0 ), tv, across ) );
		ex = cr * tv.x + cu * tv.y;
		ey = cu * tv.x - cr * tv.y;
		stretch = mix( 1.0, K0.y, across );
	}
	vec3 off = ( ex * ( position.x * stretch ) + ey * position.y ) * size;
	vec3 wp = c + off;
	vUv = position.xy + 0.5;
	// 侵蚀噪声的坐标在雾带自己的空间里（横向, 沿流向），用起始相位而不是当前位置：噪声跟着雾一起走
	float hv = ( aP.w * B.z + off.y ) * 0.7;
	vNuv = vec2( aP.z * A.w + dot( off, side ) + hv, aP.y * K2.x + dot( off, th ) + hv * 0.7 ) * K2.y + vec2( t * 0.004, -t * 0.003 );
	float ends = smoothstep( 0.0, 0.06, u ) * ( 1.0 - smoothstep( 0.92, 1.0, u ) );
	float a = K1.x * B.y * ends * aQ.z * ( 0.78 + 0.22 * sin( t * 0.13 + sd * 31.0 ) ) * ( 1.0 + 0.35 * gust.y );
	// 让开交战距离：按雾团中心到相机的距离整团淡掉
	float dc = length( c - cameraPosition );
	a *= smoothstep( K2.z + 0.3 * size, K2.z + 38.0 + size, dc );
	vAL = vec2( a, dot( off, sfAtmoSunDir.xyz ) / ( 0.5 * size ) + K1.y );
	vK = vec4( K0.z, K1.z, K1.w, K2.z );
	vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
	#ifndef USE_FOG
		a = 0.0;
	#endif
	if ( a < 0.004 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
#include <packing>
#include <fog_pars_fragment>
uniform sampler2D tNoise;
uniform sampler2D tDepth;
uniform vec4 uDepth; // 近裁面, 远裁面, 有没有场景深度, 0
uniform vec2 uViewport;
uniform vec4 sfSunLight;
varying vec2 vUv;
varying vec2 vNuv;
varying vec2 vAL;
varying vec4 vK;
void main() {
	#ifdef USE_FOG
		vec2 q = vUv * 2.0 - 1.0;
		float puff = 1.0 - smoothstep( 0.0, 1.0, dot( q, q ) );
		puff *= puff;
		vec3 nz = texture2D( tNoise, vNuv ).rgb;
		// 中心实、边上被噪声撕开；噪声是整条雾带共用的，相邻的雾团撕在同一个地方
		float a = puff * smoothstep( 0.30 + vK.y, 0.58 + 2.2 * vK.y, nz.r * 0.60 + nz.b * 0.40 + puff * 0.34 - 0.10 ) * vAL.x;
		a *= smoothstep( vK.w, vK.w + 14.0, vFogDepth );
		if ( vK.z > -1e5 ) a *= smoothstep( vK.z, vK.z + vK.x, vSfWorld.y );
		if ( uDepth.z > 0.5 ) {
			float sceneZ = -perspectiveDepthToViewZ( texture2D( tDepth, gl_FragCoord.xy / uViewport ).x, uDepth.x, uDepth.y );
			a *= clamp( ( sceneZ - vFogDepth ) / vK.x, 0.0, 1.0 );
		}
		// 雾终点之外不画：那里的东西已经全是雾色，再画只是天上一块平的色斑
		#ifdef FOG_EXP2
			float ff = 1.0 - exp( -fogDensity * fogDensity * vFogDepth * vFogDepth );
		#else
			float ff = smoothstep( fogNear, fogFar, vFogDepth );
		#endif
		a *= 1.0 - smoothstep( 0.72, 1.0, ff );
		if ( a < 0.003 ) discard;
		// 雾很薄，背光的一侧也差不多亮：向阳份额只在 0.3–1 之间走
		float sh = clamp( 0.56 + 0.24 * vAL.y + ( puff - 0.5 ) * 0.3 + ( nz.g - 0.5 ) * 0.6, 0.0, 1.0 );
		vec3 v = normalize( vSfWorld - cameraPosition );
		float fw = max( dot( v, sfAtmoSunDir.xyz ), 0.0 ), f2 = fw * fw, f8 = f2 * f2 * f2 * f2;
		float share = sfSunShare( vSfWorld );
		vec3 c = sfAtmoMist.rgb * ( 0.84 + 0.16 * sh ) + sfSunLight.rgb * share * ( 0.05 + 0.20 * sh ) + sfAtmoSun.rgb * share * ( 0.45 * f2 + 1.0 * f8 );
		// 不烧成一块白：过亮的部分压回去
		float peak = max( c.r, max( c.g, c.b ) );
		c *= 1.0 / max( 1.0, peak / 0.97 );
		gl_FragColor = vec4( c, a );
		#include <fog_fragment>
	#else
		discard;
	#endif
}
`;

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 顺着当前风向的一条直雾带：以 center 为中点、长 length（m），两头自动淡出。先 Atmosphere.bind 再调（否则按默认风向）。
 * shape.rise：到下风一头比上风一头抬高多少米（被风带着往上走的雾，默认 0）；shape.bow：中段往侧面鼓出多少米（默认 0，别是一把尺子）。
 */
export function mistBand(
  center: [number, number, number], length: number,
  shape: { halfWidth: number; size: number; halfHeight?: number; rise?: number; bow?: number },
  stream: Omit<MistStream, 'keys'> = {},
): MistStream {
  const wind = Atmosphere.wind, rise = shape.rise ?? 0, bow = shape.bow ?? 0;
  const key = (k: number, opacity: number): MistKey => {
    const along = (k - 0.5) * length, out = bow * (1 - (2 * k - 1) ** 2);
    return {
      position: [center[0] + wind.x * along + wind.z * out, center[1] + (k - 0.5) * rise, center[2] + wind.z * along - wind.x * out],
      halfWidth: shape.halfWidth, size: shape.size, halfHeight: shape.halfHeight, opacity,
    };
  };
  return { ...stream, keys: [key(0, 0), key(0.12, 1), key(0.5, 1), key(0.88, 1), key(1, 0)] };
}

export class MistStreams {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  /** 雾团总数 */
  readonly count: number;
  private readonly path: THREE.DataTexture;
  private readonly viewport = new THREE.Vector2();

  constructor(streams: readonly MistStream[], options: MistOptions = {}) {
    const rnd = mulberry(options.seed ?? 7201);
    const data = new Float32Array(PATH_SAMPLES * Math.max(1, streams.length) * 3 * 4), tmp = new Float32Array(PATH_SAMPLES * 7);
    const counts: number[] = [];
    streams.forEach((stream, r) => {
      const keys = stream.keys;
      if (keys.length < 2) throw new Error('[MistStreams] 一条雾带至少要两个关键点');
      // 关键点按弧长铺开：雾团匀速走完整条
      const at: number[] = [0];
      for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1].position, b = keys[i].position;
        at.push(at[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      }
      const length = Math.max(1e-3, at[at.length - 1]);
      const field = (key: MistKey, c: number): number => c < 3 ? key.position[c] : c === 3 ? key.halfWidth : c === 4 ? key.size : c === 5 ? key.opacity ?? 1 : key.halfHeight ?? key.size * 0.15;
      for (let j = 0; j < PATH_SAMPLES; j++) {
        const s = length * j / (PATH_SAMPLES - 1);
        let i = 1;
        while (i < keys.length - 1 && s > at[i]) i++;
        const k = Math.min(1, Math.max(0, (s - at[i - 1]) / Math.max(1e-6, at[i] - at[i - 1])));
        for (let c = 0; c < 7; c++) tmp[j * 7 + c] = field(keys[i - 1], c) + (field(keys[i], c) - field(keys[i - 1], c)) * k;
      }
      // 抹两遍：折线的拐角变圆，首尾不动
      for (let pass = 0; pass < 2; pass++) {
        const old = tmp.slice();
        for (let j = 1; j < PATH_SAMPLES - 1; j++) for (let c = 0; c < 7; c++) tmp[j * 7 + c] = 0.25 * old[(j - 1) * 7 + c] + 0.5 * old[j * 7 + c] + 0.25 * old[(j + 1) * 7 + c];
      }
      let size = 0, halfWidth = 0;
      for (let j = 0; j < PATH_SAMPLES; j++) {
        data.set([tmp[j * 7], tmp[j * 7 + 1], tmp[j * 7 + 2], tmp[j * 7 + 3]], ((r * 3) * PATH_SAMPLES + j) * 4);
        data.set([tmp[j * 7 + 4], tmp[j * 7 + 5], tmp[j * 7 + 6], 0], ((r * 3 + 1) * PATH_SAMPLES + j) * 4);
        size += tmp[j * 7 + 4] / PATH_SAMPLES;
        halfWidth += tmp[j * 7 + 3] / PATH_SAMPLES;
      }
      size = Math.max(0.5, size);
      // 噪声一格约 1.5 个雾团大；整条的长度取整数格，雾团回到起点时和前面的接得上
      const cells = Math.max(1, Math.round(length / (1.5 * size + 5)));
      const params = (r * 3 + 2) * PATH_SAMPLES * 4;
      data.set([(stream.speed ?? 1) / length, stream.stretch ?? 1.4, Math.max(0.1, stream.soft ?? 6), stream.flat ? 1 : 0], params);
      data.set([stream.opacity ?? 0.4, stream.lit ?? 0, stream.torn ?? 0, stream.floorY ?? -1e6], params + 4);
      data.set([length, cells / length, stream.clearDistance ?? 22, 0], params + 8);
      counts.push(stream.count ?? Math.round(Math.min(96, Math.max(6, 1.6 * (length / size) * (1 + halfWidth / size)))));
    });
    this.path = new THREE.DataTexture(data, PATH_SAMPLES, Math.max(1, streams.length) * 3, THREE.RGBAFormat, THREE.FloatType);
    this.path.minFilter = this.path.magFilter = THREE.NearestFilter;
    this.path.generateMipmaps = false;
    this.path.needsUpdate = true;

    const total = counts.reduce((sum, n) => sum + n, 0);
    const aP = new Float32Array(total * 4), aQ = new Float32Array(total * 4);
    let o = 0;
    counts.forEach((n, row) => {
      for (let i = 0; i < n; i++, o++) {
        aP.set([row, (i + rnd()) / n, rnd() * 2 - 1, (rnd() + rnd() + rnd()) / 1.5 - 1], o * 4);
        aQ.set([0.72 + 0.62 * rnd(), rnd(), 0.5 + 0.5 * rnd(), rnd()], o * 4);
      }
    });
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.instanceCount = total;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
    geometry.setIndex([0, 1, 2, 1, 3, 2]);
    geometry.setAttribute('aP', new THREE.InstancedBufferAttribute(aP, 4));
    geometry.setAttribute('aQ', new THREE.InstancedBufferAttribute(aQ, 4));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        tPath: { value: this.path }, tNoise: { value: atmosphereNoise() }, tDepth: { value: null },
        uDepth: { value: new THREE.Vector4(0.05, 3000, 0, 0) }, uViewport: { value: this.viewport },
      },
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    // 空气透视的共享 uniform 原样挂上（不克隆），雾色、日光、风、时间都读它
    Object.assign(material.uniforms, Atmosphere.uniforms);
    this.count = total;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'MistStreams';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = options.renderOrder ?? -5;
    this.mesh.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(this.viewport);
      const lens = camera as THREE.PerspectiveCamera;
      material.uniforms.uDepth.value.x = lens.near;
      material.uniforms.uDepth.value.y = lens.far;
    };
  }

  /**
   * 给一张这一帧的场景深度（THREE.DepthTexture，和画布同一个机位），雾团就和后面的表面软相交；传 null 关掉。
   * 主游戏直接画到画布、没有深度贴图：有水面的图已经为水面画过一遍深度，把那张传进来就行；没有的图不必为雾另画一遍。
   */
  useSceneDepth(texture: THREE.Texture | null): void {
    this.mesh.material.uniforms.tDepth.value = texture;
    this.mesh.material.uniforms.uDepth.value.z = texture ? 1 : 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.path.dispose();
  }
}
