import * as THREE from 'three';

/**
 * 空气透视与云影（docs/art/composition.md 第 8 节）。接管 Three 内置的雾片段，叠在场景原有的雾（scene.fog）之前：
 *   低雾  贴着谷底，密度随高度按指数变薄；太阳照得到的地方染上日光，朝太阳看最亮——谷底泡在发光的薄雾里，高处的山头露出来。
 *   空气  密度均匀，只随距离叠加，颜色偏天色——每一排山都比前一排更淡、更冷、更平。
 *   云影  一张可平铺的「日照份额」图，落在地面上、沿光线带到高处（影子到来时顺着崖面滑下来），只压平行光。
 * 场景原有的线性 / 指数雾照常叠在最后，所以天气、软边界白化、雾终点处与远景的相接都不变。
 *
 * 用法（每张图三行）：
 *   Atmosphere.bind(scene, atmosphereForChapter(1), { baseY });   // 场景的雾、太阳、环境光建好之后
 *   Atmosphere.update(seconds);                                    // 每帧
 *   Atmosphere.unbind();                                           // 卸载这张图时
 * 颜色不写死：每帧读 scene.fog 的颜色、太阳的颜色和方向、半球光的天色，所以天气改雾、首领改光时自动跟上。
 * scene.fog 为空时这一层整个不生效（Three 不给材质开 USE_FOG）。
 *
 * 实现：模块加载时改 THREE.ShaderChunk 的四个雾片段和平行光片段，并把共享 uniform 挂到 THREE.ShaderLib 每种内置材质上。
 * uniform 的值是 Float32Array：Three 克隆材质 uniform 时不复制它，所有材质读的是同一块内存，改一次全场生效，
 * 材质自己有没有 onBeforeCompile 都不影响。自己写的 ShaderMaterial（fog: true 且 include 了雾片段）要把
 * `Atmosphere.uniforms` 并进它的 uniforms，否则这一层对它不生效（密度为 0，原样输出）。
 * 雾片段在色调映射和色彩空间转换之后执行，所以这里的颜色都是显示空间（sRGB）的值。
 */
export interface AtmosphereProfile {
  /** 低雾在基准高度处的密度（1/m）。0.0026 ≈ 平视 270 m 处一半被雾盖住 */
  mistDensity: number;
  /** 标高（m）：每升高这么多，低雾密度降到 37%。小 = 雾压在谷底，山头露得多 */
  mistScaleHeight: number;
  /** 低雾色 = 场景雾色 × 这个倍率 */
  mistTint: number;
  /** 空气密度（1/m） */
  airDensity: number;
  /** 空气色从场景雾色往天色偏多少：越大，远处越冷 */
  airSkyBlend: number;
  /** 高处（基准以上 40 → 260 m）空气变淡多少 */
  airHighFade: number;
  /** 日光散进雾里的量：朝太阳看时雾发亮的程度 */
  sunScatter: number;
  /** 起始距离（m）：交战距离内不起雾（敌人优先） */
  startDistance: number;
  /** 不透明度上限：再远也不盖死 */
  maxOpacity: number;
  /** 云影里平行光被压掉多少（0 = 没有云影） */
  cloudShadow: number;
  /** 云影图平铺一次的边长（m）：大云块直径约为它的 1/8 */
  cloudTile: number;
  /** 云影漂移速度（m/s） */
  cloudSpeed: number;
}

/**
 * 章节默认值。沙寺：低而暖的浮尘，云影清楚；霜山：寒雾压得更低更浓；熔火：烟厚、太阳弱，不要云影（天是烟）；
 * 雪域：空气通透，云影最重、跑得快。各图拿到之后可以再改（展开成新对象再传给 bind）。
 */
export const ATMOSPHERE_PROFILES = {
  desert: {
    mistDensity: 0.0028, mistScaleHeight: 22, mistTint: 0.96, airDensity: 0.0005, airSkyBlend: 0.55, airHighFade: 0.12,
    sunScatter: 0.3, startDistance: 16, maxOpacity: 0.82, cloudShadow: 0.38, cloudTile: 700, cloudSpeed: 4,
  },
  frost: {
    mistDensity: 0.0032, mistScaleHeight: 18, mistTint: 0.96, airDensity: 0.0006, airSkyBlend: 0.5, airHighFade: 0.12,
    sunScatter: 0.22, startDistance: 16, maxOpacity: 0.82, cloudShadow: 0.32, cloudTile: 700, cloudSpeed: 5,
  },
  inferno: {
    mistDensity: 0.0026, mistScaleHeight: 26, mistTint: 0.96, airDensity: 0.0004, airSkyBlend: 0.3, airHighFade: 0.12,
    sunScatter: 0.12, startDistance: 16, maxOpacity: 0.78, cloudShadow: 0, cloudTile: 900, cloudSpeed: 2,
  },
  plateau: {
    mistDensity: 0.0009, mistScaleHeight: 40, mistTint: 0.96, airDensity: 0.0003, airSkyBlend: 0.7, airHighFade: 0.12,
    sunScatter: 0.18, startDistance: 30, maxOpacity: 0.82, cloudShadow: 0.45, cloudTile: 1000, cloudSpeed: 9,
  },
} satisfies Record<string, AtmosphereProfile>;

/** 按章节号（1 沙寺 / 2 霜山 / 3 熔火 / 4 雪域）取一份新的默认值 */
export function atmosphereForChapter(chapter: number): AtmosphereProfile {
  const p = chapter === 2 ? ATMOSPHERE_PROFILES.frost : chapter === 3 ? ATMOSPHERE_PROFILES.inferno : chapter === 4 ? ATMOSPHERE_PROFILES.plateau : ATMOSPHERE_PROFILES.desert;
  return { ...p };
}

export interface AtmosphereBinding {
  /** 低雾的基准高度（世界 y）：这张图的低处（谷底、水面）。默认 0 */
  baseY?: number;
  /** 太阳；不给就取场景里第一盏平行光 */
  sun?: THREE.DirectionalLight | null;
  /** 云影往哪边漂（XZ）；默认东北风 (−0.82, −0.57) */
  wind?: [number, number];
  /** 云影图的起始偏移（uv），换一组云的位置 */
  cloudPhase?: [number, number];
}

// ───────────── 着色器 ─────────────

const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	#define SF_ATMOSPHERE
	varying vec3 vSfWorld;
	uniform sampler2D sfCloudTex;
	uniform vec4 sfAtmoA;      // x 低雾密度, y 1 / 标高, z 基准高度, w 空气密度
	uniform vec4 sfAtmoB;      // x 不透明度上限, y 起始距离, z 高处空气变淡, w 云影强度
	uniform vec4 sfAtmoMist;   // rgb 低雾色
	uniform vec4 sfAtmoAir;    // rgb 空气色
	uniform vec4 sfAtmoSun;    // rgb 散进雾里的日光
	uniform vec4 sfAtmoSunDir; // xyz 指向太阳
	uniform vec4 sfCloud;      // x 1 / 平铺边长, yz 漂移偏移, w 保留
	uniform vec4 sfCloudSlope; // xy 太阳方向 xz / y：沿光线投到地面
	// 某点拿到的直射日光份额（1 = 全日照）
	float sfSunShare( vec3 wp ) {
		vec2 g = wp.xz - sfCloudSlope.xy * wp.y;
		return 1.0 - sfAtmoB.w * ( 1.0 - texture2D( sfCloudTex, g * sfCloud.x + sfCloud.yz ).r );
	}
	vec3 sfAtmosphere( vec3 col, vec3 wp ) {
		vec3 v = wp - cameraPosition;
		float d = length( v );
		v /= max( d, 1e-4 );
		float dist = max( d - sfAtmoB.y, 0.0 );
		// 低雾：指数高度雾沿视线积分的解析式
		float b = max( sfAtmoA.y, 1e-4 ); // 这一层归零时（1 / 标高 = 0）也不能出 0 / 0
		float y0 = max( cameraPosition.y - sfAtmoA.z, -10.0 ), y1 = max( wp.y - sfAtmoA.z, -10.0 ), dy = y1 - y0;
		float e0 = exp( -b * y0 ), e1 = exp( -b * y1 );
		float avg = abs( dy ) > 0.02 ? ( e0 - e1 ) / ( b * dy ) : e0;
		float tm = sfAtmoA.x * dist * avg, ta = sfAtmoA.w * dist;
		// 向阳散射：朝太阳看时雾最亮，背着太阳只剩天光
		float fw = max( dot( v, sfAtmoSunDir.xyz ), 0.0 );
		float f2 = fw * fw, f4 = f2 * f2, f14 = f4 * f4 * f4 * f2;
		vec3 key = sfAtmoSun.rgb * sfSunShare( cameraPosition + v * min( d * 0.6, 160.0 ) );
		vec3 mist = sfAtmoMist.rgb + key * ( 0.36 + 0.43 * f2 + 1.1 * f14 );
		vec3 air = sfAtmoAir.rgb * mix( 1.0, 1.0 - sfAtmoB.z, smoothstep( 40.0, 260.0, y1 ) ) + key * ( 0.10 + 0.55 * f2 + 1.2 * f14 );
		vec3 haze = ( mist * tm + air * ta ) / max( tm + ta, 1e-6 );
		return mix( col, haze, min( 1.0 - exp( -( tm + ta ) ), sfAtmoB.x ) );
	}
#endif
`;

const SUN_HOOK = 'getDirectionalLightInfo( directionalLight, directLight );';

function f4(): { value: Float32Array } {
  return { value: new Float32Array(4) };
}

const shared = {
  sfCloudTex: { value: null as THREE.Texture | null },
  sfAtmoA: f4(), sfAtmoB: f4(), sfAtmoMist: f4(), sfAtmoAir: f4(), sfAtmoSun: f4(), sfAtmoSunDir: f4(), sfCloud: f4(), sfCloudSlope: f4(),
  // 下面两个内置材质不读，给同一套风向 / 光照的模块用（MistStreams、CloudSky、SunShafts……）
  sfWind: f4(),     // xy 风向（XZ，单位向量）, z 风速 m/s（= 云影漂移速度）, w 游戏时间（秒）
  sfSunLight: f4(), // rgb 日光色（显示空间，太阳落到地平线下时收到 0）, w 太阳还在地平线上的份额 0..1
};

/**
 * 自己写的着色器要读「同一个风」时拼进去（顶点、片段都行）：sfWind 的声明，加一张阵风表。
 * 阵风是一道道顺风扫过的锋面（每 9 秒一道，26 m/s，强弱不一，锋线带一点弯）；所有读它的东西
 * （雾、落叶、尘）在同一道锋面到来时一起动，一阵风才能从一样东西跟到另一样东西上。
 *   sfGust( xz ).x  被推着走的量 0..1：锋面过后 0.5 秒冲到头，三秒多松回去（软的东西：雾、烟）
 *   sfGust( xz ).y  锋面刚到的那一下 0..1（密度鼓一下、叶子被掀起来）
 */
export const ATMOSPHERE_WIND_GLSL = /* glsl */ `
uniform vec4 sfWind;
vec2 sfGust( vec2 xz ) {
	float ph = ( sfWind.w - dot( xz, sfWind.xy ) / 26.0 ) / 9.0 + 0.07 * sin( dot( xz, vec2( -sfWind.y, sfWind.x ) ) * 0.013 );
	float k = floor( ph ), tau = ( ph - k ) * 9.0;
	float a = 0.35 + 0.65 * fract( sin( k * 12.9898 ) * 43758.5453 );
	float q = tau - 0.3;
	return vec2( a * ( 1.0 - exp( -tau / 0.45 ) ) * exp( -tau / 3.2 ), a * exp( -q * q / 0.10 ) );
}
`;

let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  const chunk = THREE.ShaderChunk as Record<string, string>;
  chunk.fog_pars_vertex += '\n#ifdef USE_FOG\n\tvarying vec3 vSfWorld;\n#endif\n';
  // mvPosition 已经含实例化 / 合批 / 蒙皮；视图矩阵的旋转是正交的，转置就是逆
  chunk.fog_vertex += '\n#ifdef USE_FOG\n\tvSfWorld = cameraPosition + mvPosition.xyz * mat3( viewMatrix );\n#endif\n';
  chunk.fog_pars_fragment += PARS_FRAGMENT;
  chunk.fog_fragment = '#ifdef USE_FOG\n\tgl_FragColor.rgb = sfAtmosphere( gl_FragColor.rgb, vSfWorld );\n#endif\n' + chunk.fog_fragment;
  if (chunk.lights_fragment_begin.includes(SUN_HOOK)) {
    chunk.lights_fragment_begin = chunk.lights_fragment_begin.replace(SUN_HOOK,
      `${SUN_HOOK}\n\t\t#if defined( USE_FOG ) && defined( SF_ATMOSPHERE )\n\t\tdirectLight.color *= sfSunShare( vSfWorld );\n\t\t#endif`);
  } else {
    console.warn('[Atmosphere] 平行光片段变了，云影没接上（空气透视不受影响）');
  }
  shared.sfCloudTex.value = cloudTexture();
  for (const lib of Object.values(THREE.ShaderLib)) Object.assign(lib.uniforms, shared);
}

// ───────────── 云影图 ─────────────

function hash(x: number, y: number, s: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** 可平铺的值噪声：f × f 的格点，边界回绕 */
function noise(u: number, v: number, f: number, seed: number): number {
  const x = u * f, y = v * f, xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % f) + f) % f, x1 = (x0 + 1) % f, y0 = ((yi % f) + f) % f, y1 = (y0 + 1) % f;
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  return a + (b - a) * fx + (c + (d - c) * fx - a - (b - a) * fx) * fy;
}

/**
 * 可平铺的「日照份额」图（R8，255 = 全日照）：抖动网格上的大云块 + 夹在中间的小云絮，边缘用噪声撕碎。
 * 约四成在云影里；小云絮让开阔地上随时有一条影子的边在走。确定性（整数哈希）。
 */
function cloudTexture(): THREE.DataTexture {
  const N = 256;
  const blobs: { u: number; v: number; r: number; e: number; cs: number; sn: number }[] = [];
  const grid = (cells: number, skip: number, r0: number, r1: number, jitter: number, seed: number): void => {
    for (let cj = 0; cj < cells; cj++) for (let ci = 0; ci < cells; ci++) {
      if (hash(ci, cj, seed) < skip) continue;
      const a = hash(ci, cj, seed + 5) * Math.PI;
      blobs.push({
        u: (ci + 0.5 + (hash(ci, cj, seed + 1) - 0.5) * jitter) / cells, v: (cj + 0.5 + (hash(ci, cj, seed + 2) - 0.5) * jitter) / cells,
        r: r0 + (r1 - r0) * hash(ci, cj, seed + 3), e: 1 + 0.45 * hash(ci, cj, seed + 4), cs: Math.cos(a), sn: Math.sin(a),
      });
    }
  };
  grid(6, 0.4, 0.042, 0.088, 0.62, 31);
  grid(12, 0.6, 0.015, 0.029, 0.8, 51);
  const soft = 0.011, rim = 0.024, px = new Uint8Array(N * N);
  for (let j = 0, k = 0; j < N; j++) for (let i = 0; i < N; i++, k++) {
    const u = (i + 0.5) / N, v = (j + 0.5) / N;
    let m = -1;
    for (const q of blobs) {
      let du = u - q.u, dv = v - q.v;
      du -= Math.round(du);
      dv -= Math.round(dv);
      if (Math.abs(du) > 0.2 || Math.abs(dv) > 0.2) continue;
      const al = du * q.cs + dv * q.sn, ac = -du * q.sn + dv * q.cs;
      m = Math.max(m, q.r - Math.hypot(al / q.e, ac));
    }
    const edge = Math.max(m, -0.09) + (0.55 * noise(u, v, 22, 1) + 0.3 * noise(u, v, 45, 2) + 0.15 * noise(u, v, 90, 3) - 0.5) * rim;
    const t = Math.min(1, Math.max(0, (edge + soft) / (2 * soft)));
    px[k] = Math.round(255 * (1 - t * t * (3 - 2 * t)));
  }
  const tex = new THREE.DataTexture(px, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let noiseTex: THREE.DataTexture | null = null;

/**
 * 一张共用的可平铺噪声（RGBA8，256²，每个通道拉满 0..1），第一次要的时候才生成：
 *   r 大块 fbm（雾带的侵蚀、云的大形）  g 另一组 fbm（明暗起伏）  b 细碎 fbm（边缘撕碎）  a 鼓包（脊状 fbm，云的团块感）
 */
export function atmosphereNoise(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const N = 256, px = new Uint8Array(N * N * 4), channel = new Float32Array(N * N);
  const fill = (c: number, f0: number, seed: number, billow: boolean): void => {
    let lo = Infinity, hi = -Infinity;
    for (let j = 0, k = 0; j < N; j++) for (let i = 0; i < N; i++, k++) {
      const u = (i + 0.5) / N, v = (j + 0.5) / N;
      let sum = 0, w = 0.5;
      for (let o = 0, f = f0; o < 4; o++, f *= 2, w *= 0.5) {
        const n = noise(u, v, f, seed + o * 7);
        sum += w * (billow ? 1 - Math.abs(2 * n - 1) : n);
      }
      channel[k] = sum;
      if (sum < lo) lo = sum;
      if (sum > hi) hi = sum;
    }
    for (let k = 0; k < N * N; k++) px[k * 4 + c] = Math.round(255 * (channel[k] - lo) / (hi - lo));
  };
  fill(0, 4, 101, false);
  fill(1, 6, 211, false);
  fill(2, 10, 307, false);
  fill(3, 5, 401, true);
  noiseTex = new THREE.DataTexture(px, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.colorSpace = THREE.NoColorSpace;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

// ───────────── 每张图 ─────────────

const DEFAULT_WIND: [number, number] = [-0.82, -0.57];
const tmpColor = new THREE.Color(), tmpSky = new THREE.Color(), tmpDir = new THREE.Vector3(), tmpTarget = new THREE.Vector3();
const rgb = { r: 0, g: 0, b: 0 };

let bound: { scene: THREE.Scene; profile: AtmosphereProfile; baseY: number; sun: THREE.DirectionalLight | null; sky: THREE.Light | null; wind: [number, number]; phase: [number, number] } | null = null;

function zero(): void {
  for (const u of [shared.sfAtmoA, shared.sfAtmoB, shared.sfAtmoSun, shared.sfCloud, shared.sfSunLight]) u.value.fill(0);
}

function display(color: THREE.Color): typeof rgb {
  return color.getRGB(rgb, THREE.SRGBColorSpace);
}

export const Atmosphere = {
  /** 自己写的 ShaderMaterial（fog: true）并进 uniforms 用 */
  uniforms: shared as Record<string, THREE.IUniform>,

  get active(): boolean {
    return bound !== null;
  },

  /** 当前的风：XZ 单位向量 + 风速（m/s）。没接上时是默认风向、风速 0 */
  get wind(): { x: number; z: number; speed: number } {
    return bound ? { x: bound.wind[0], z: bound.wind[1], speed: bound.profile.cloudSpeed } : { x: DEFAULT_WIND[0], z: DEFAULT_WIND[1], speed: 0 };
  },

  /** 给当前这张图接上空气透视：场景的雾、太阳、环境光建好之后调。profile 之后还可以直接改字段，下一帧生效 */
  bind(scene: THREE.Scene, profile: AtmosphereProfile, options: AtmosphereBinding = {}): void {
    install();
    let sun = options.sun ?? null, sky: THREE.Light | null = null;
    scene.traverse(object => {
      if (!sun && object instanceof THREE.DirectionalLight) sun = object;
      if (!sky && (object instanceof THREE.HemisphereLight || object instanceof THREE.AmbientLight)) sky = object;
    });
    const wind = options.wind ?? DEFAULT_WIND, len = Math.hypot(wind[0], wind[1]) || 1;
    bound = { scene, profile, baseY: options.baseY ?? 0, sun, sky, wind: [wind[0] / len, wind[1] / len], phase: options.cloudPhase ?? [0, 0] };
    Atmosphere.update(0);
  },

  /** 卸载这张图时调：这一层归零，材质原样输出 */
  unbind(): void {
    bound = null;
    zero();
  },

  /** 每帧调一次（seconds = 游戏时间，秒）：跟上场景当前的雾色 / 日光 / 天色，推进云影 */
  update(seconds: number): void {
    if (!bound) return;
    const { scene, profile: p, sun, sky } = bound;
    shared.sfWind.value.set([bound.wind[0], bound.wind[1], p.cloudSpeed, seconds]);
    const fog = scene.fog;
    if (!fog) {
      zero();
      return;
    }
    const fogRgb = display(tmpColor.copy(fog.color));
    const fr = fogRgb.r, fg = fogRgb.g, fb = fogRgb.b;
    const skyRgb = display(sky ? tmpSky.copy(sky.color) : tmpSky.copy(fog.color));
    const k = p.airSkyBlend;
    shared.sfAtmoA.value.set([Math.max(0, p.mistDensity), 1 / Math.max(1, p.mistScaleHeight), bound.baseY, Math.max(0, p.airDensity)]);
    shared.sfAtmoMist.value.set([fr * p.mistTint, fg * p.mistTint, fb * p.mistTint, 1]);
    shared.sfAtmoAir.value.set([fr + (skyRgb.r - fr) * k, fg + (skyRgb.g - fg) * k, fb + (skyRgb.b - fb) * k, 1]);

    let cloud = 0;
    tmpDir.set(0, 1, 0);
    if (sun && sun.visible && sun.intensity > 0) {
      sun.getWorldPosition(tmpDir).sub(sun.target.getWorldPosition(tmpTarget)).normalize();
      // 太阳贴近地平线以下时散射收掉，别让地底下的光把雾照亮
      const up = Math.min(1, Math.max(0, tmpDir.y * 6 + 0.3));
      const c = display(tmpColor.copy(sun.color));
      const s = p.sunScatter * up;
      shared.sfAtmoSun.value.set([c.r * s, c.g * s, c.b * s, 0]);
      shared.sfSunLight.value.set([c.r * up, c.g * up, c.b * up, up]);
      cloud = Math.min(1, Math.max(0, p.cloudShadow));
    } else {
      shared.sfAtmoSun.value.fill(0);
      shared.sfSunLight.value.fill(0);
    }
    shared.sfAtmoB.value.set([Math.min(1, Math.max(0, p.maxOpacity)), Math.max(0, p.startDistance), Math.min(1, Math.max(0, p.airHighFade)), cloud]);
    shared.sfAtmoSunDir.value.set([tmpDir.x, tmpDir.y, tmpDir.z, 0]);
    const tile = Math.max(50, p.cloudTile), shift = p.cloudSpeed * seconds / tile;
    let ou = bound.phase[0] - bound.wind[0] * shift, ov = bound.phase[1] - bound.wind[1] * shift;
    ou -= Math.floor(ou);
    ov -= Math.floor(ov);
    shared.sfCloud.value.set([1 / tile, ou, ov, 0]);
    const sy = Math.max(0.2, tmpDir.y);
    shared.sfCloudSlope.value.set([tmpDir.x / sy, tmpDir.z / sy, 0, 0]);
  },
};

install();
