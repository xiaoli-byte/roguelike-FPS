import * as THREE from 'three';
import { Atmosphere, ATMOSPHERE_WIND_GLSL, atmosphereNoise } from './Atmosphere';

/**
 * 云天（docs/art/composition.md 第 8 节）：叠在原有天空（渐变天球 / 天空盒 / 纯色背景）之上的三层云，只画在天空像素上。
 *   低云  读的就是 Atmosphere 的云影图，按云底高度沿光线投回天上：天上的云和地上的影子是同一批、同向同速——
 *         影子从谷那头走过来的时候，抬头能看到那朵云。边缘和内部用共用噪声撕出团块。
 *   中云  噪声生成的大片碎云，更高、风更大，但离得远，看上去比低云慢（层与层之间有视差）。
 *   高云  顺风拉成丝的卷云，最高最慢，很薄。
 * 光：从下面看云——厚的地方是云底，偏冷偏暗（空气色）；薄的边缘透光，朝太阳的一侧偏暖发亮，太阳附近的薄边有一圈银边。
 *     越靠近地平线越淡、越偏雾色（云也吃空气透视）。
 * 熔火章的天是烟：white = 0 时不发白，亮面只到雾色，底下被地面的火映红（ember），不要白云。
 * 日晕（sunGlow）：烘焙的天空盒里往往没有太阳，开了之后在平行光的方向画日盘和光晕，被云遮住；
 *     逆光的光柱（SunShafts）就是从这块够亮的天取光的。原天空已经画了太阳的图给 0。
 *     天空盒（scene.background 是立方体贴图）里画没画太阳会自己查一遍：六个面里有一小团烧白的像素就算有，
 *     这时不再画日晕——天空盒里的太阳和平行光往往不在一个方向（2-1），再画一个就是两个太阳。
 * 颜色是显示空间的（和 Atmosphere 一样，直接出到画布）。
 *
 * 用法（先 Atmosphere.bind；风、时间、日光、雾色都读它的，不用每帧调别的）：
 *   const clouds = new CloudSky(cloudSkyForChapter(chapter));
 *   group.add(clouds.mesh);
 *   clouds.dispose();   // 卸载这张图时
 */
export interface CloudSkyProfile {
  /** 低云（投下云影的那一层）的浓度 0..1。0 = 没有低云（熔火章） */
  low: number;
  /** 中云的云量 0..1 */
  mid: number;
  /** 高云（卷云）的云量 0..1 */
  high: number;
  /** 低云云底的高度（Atmosphere 基准高度以上，m）。中云在它的 2.2 倍高，高云 5 倍高 */
  height: number;
  /** 亮面发白的程度 0..1：1 = 白云（日光色往白里偏），0 = 烟（亮面只到雾色） */
  white: number;
  /** 亮面的亮度倍率 */
  lit: number;
  /** 云底 / 背阳面 = 空气色 × 这个倍率（偏冷） */
  shade: number;
  /** 烟的底下被地面的火映上的颜色（显示空间）；白云给 [0, 0, 0] */
  ember: [number, number, number];
  /** 日盘和光晕的强度；原天空已经有太阳的图给 0 */
  sunGlow: number;
}

/**
 * 章节默认值。沙寺：云少、高处有丝；霜山：云厚、偏冷；熔火：没有白云，两层慢慢滚的烟、底下映红；雪域：一朵朵清楚的积云、天最透。
 */
export const CLOUD_SKY_PROFILES = {
  desert: { low: 0.7, mid: 0.3, high: 0.55, height: 520, white: 1, lit: 1, shade: 0.82, ember: [0, 0, 0], sunGlow: 0.7 },
  frost: { low: 0.7, mid: 0.5, high: 0.3, height: 430, white: 0.9, lit: 0.9, shade: 0.74, ember: [0, 0, 0], sunGlow: 0.5 },
  inferno: { low: 0, mid: 0.8, high: 0.65, height: 380, white: 0, lit: 0.8, shade: 0.42, ember: [0.26, 0.08, 0.03], sunGlow: 0 },
  plateau: { low: 0.95, mid: 0.22, high: 0.4, height: 650, white: 1, lit: 1.04, shade: 0.84, ember: [0, 0, 0], sunGlow: 0.7 },
} satisfies Record<string, CloudSkyProfile>;

/** 按章节号（1 沙寺 / 2 霜山 / 3 熔火 / 4 雪域）取一份新的默认值 */
export function cloudSkyForChapter(chapter: number): CloudSkyProfile {
  const p = chapter === 2 ? CLOUD_SKY_PROFILES.frost : chapter === 3 ? CLOUD_SKY_PROFILES.inferno : chapter === 4 ? CLOUD_SKY_PROFILES.plateau : CLOUD_SKY_PROFILES.desert;
  return { ...p, ember: [...p.ember] as [number, number, number] };
}

const VERTEX = /* glsl */ `
uniform float uOn;
varying vec3 vDir;
void main() {
	vDir = position;
	// 只取视图矩阵的旋转：天球永远以相机为中心；z = w 落在远裁面上，只有没被任何东西盖住的天空像素过得了深度测试
	vec4 clip = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
	gl_Position = uOn > 0.5 ? clip.xyww : vec4( 2.0, 2.0, 2.0, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
${ATMOSPHERE_WIND_GLSL}
uniform sampler2D sfCloudTex;
uniform sampler2D tNoise;
uniform vec4 sfCloud;      // x 1 / 云影图边长, yz 漂移偏移
uniform vec4 sfCloudSlope; // xy 太阳方向 xz / y
uniform vec4 sfAtmoA;      // z 基准高度
uniform vec4 sfAtmoSunDir;
uniform vec4 sfSunLight;
uniform vec4 sfAtmoAir;
uniform vec4 sfAtmoMist;
uniform vec4 uCover; // 低, 中, 高, 发白
uniform vec4 uShape; // 云底高度（基准以上）, 亮面倍率, 暗面倍率, 日晕
uniform vec3 uEmber;
varying vec3 vDir;

// 低云：云影图沿光线投回云底高度。云影图的边是硬的（影子要清楚），云要的是厚度：取模糊过的那几级（边缘成了一道缓坡，
// 零碎的小云絮被抹掉，只剩大块），再用噪声把缓坡撕成团块。噪声的坐标在云影图自己的平铺空间里，跟着云一起走
float lowCloud( vec2 p, float h ) {
	vec2 uv = ( p - sfCloudSlope.xy * h ) * sfCloud.x + sfCloud.yz;
	float m = 1.0 - texture2D( sfCloudTex, uv, 3.6 ).r;
	vec4 n = texture2D( tNoise, uv * 2.0 );
	return m + ( n.r * 0.6 + n.b * 0.4 - 0.5 ) * 0.6 + ( n.a - 0.5 ) * 0.22 - 0.34;
}
float midCloud( vec2 q ) {
	vec4 n = texture2D( tNoise, q );
	return ( n.r * 0.6 + n.b * 0.22 + n.a * 0.18 - mix( 0.86, 0.34, uCover.y ) ) * 2.2;
}
float highCloud( vec2 q ) {
	vec4 n = texture2D( tNoise, q );
	return smoothstep( 0.0, 0.36, n.g * 0.62 + n.r * 0.38 - mix( 0.9, 0.36, uCover.z ) );
}
// 低云 / 中云返回的是「云量超出门槛多少」：刚过门槛就不透明（云的轮廓），再往里才慢慢变厚（明暗的渐变）
float cloudAlpha( float raw ) { return smoothstep( -0.04, 0.4, raw ); }
float cloudThick( float raw ) { return smoothstep( 0.0, 0.95, raw ); }
// 一层云的颜色：raw 这一点、toSun 往太阳方向挪一步之后的云量（那边更薄 = 这一点朝着太阳）
vec3 shadeCloud( float raw, float toSun, vec3 lit, vec3 shade, float rim ) {
	// 薄处透光最亮，越厚越接近云底的颜色；朝太阳的一侧再亮一点。底限 0.25：云底也不是一块灰板
	float thick = cloudThick( raw ), edge = cloudAlpha( raw );
	float bright = clamp( 1.0 - thick * 0.72 + ( thick - cloudThick( toSun ) ) * 1.3, 0.25, 1.0 );
	return min( mix( shade, lit, bright ) + sfSunLight.rgb * ( rim * edge * ( 1.0 - thick ) * 1.2 ), vec3( 0.95 ) );
}

void main() {
	vec3 d = normalize( vDir );
	float up = d.y;
	vec3 sun = sfAtmoSunDir.xyz;
	float toward = max( dot( d, sun ), 0.0 ), t2 = toward * toward, t4 = t2 * t2, t16 = t4 * t4 * t4 * t4;
	vec3 fog = sfAtmoMist.rgb, sunColor = sfSunLight.rgb;
	vec3 lit = mix( fog, mix( vec3( 1.0 ), sunColor, 0.5 ), uCover.w ) * uShape.y * ( 0.55 + 0.45 * sfSunLight.w );
	// 云底：空气色往蓝灰里偏（云下偏冷）；烟（white = 0）不偏，就是雾色压暗
	vec3 air = mix( fog, sfAtmoAir.rgb, 0.6 );
	vec3 shade = mix( air, vec3( 0.86, 0.93, 1.08 ) * dot( air, vec3( 0.3, 0.5, 0.2 ) ), 0.6 * uCover.w ) * uShape.z;
	float rim = t16 * uCover.w * 0.45;

	vec3 color = vec3( 0.0 );
	float alpha = 0.0;
	if ( up > 0.004 ) {
		float base = uShape.x, rise = 1.0 / max( up, 0.03 );
		vec2 heading = sfWind.xy, drift = heading * ( sfWind.z * sfWind.w ), sunXZ = sun.xz / max( length( sun.xz ), 1e-3 );
		float horizon = smoothstep( 0.012, 0.17, up );

		// 高云：顺风拉成丝（沿风向 9 km 一格、横向 2.4 km 一格），最薄
		if ( uCover.z > 0.0 ) {
			float h = base * 5.0;
			vec2 p = cameraPosition.xz + d.xz * ( h * rise ) - drift * 1.6;
			float rho = highCloud( vec2( dot( p, heading ) / 9000.0, dot( p, vec2( -heading.y, heading.x ) ) / 2400.0 ) ) * 0.55 * horizon;
			vec3 c = mix( shade, lit, 0.8 ) + sunColor * ( rim * 0.5 );
			color = c * rho;
			alpha = rho;
		}
		// 中云：大片碎云，3.4 km 一格
		if ( uCover.y > 0.0 ) {
			float h = base * 2.2;
			vec2 p = ( cameraPosition.xz + d.xz * ( h * rise ) - drift * 1.3 ) / 3400.0;
			float raw = midCloud( p ), rho = cloudAlpha( raw );
			float a = rho * 0.92 * horizon;
			vec3 c = shadeCloud( raw, midCloud( p + sunXZ * 0.022 ), lit, shade, rim ) + uEmber * ( rho * ( 1.0 - up ) * ( 1.0 - up ) );
			color = color * ( 1.0 - a ) + c * a;
			alpha = alpha * ( 1.0 - a ) + a;
		}
		// 低云：和地上的云影是同一批。云影图是平铺的，远处会看出重复，三四格之外淡掉交给中云
		if ( uCover.x > 0.0 ) {
			float h = sfAtmoA.z + base;
			float reach = max( h - cameraPosition.y, 0.0 ) * rise;
			vec2 p = cameraPosition.xz + d.xz * reach;
			float raw = lowCloud( p, h ), rho = cloudAlpha( raw );
			float a = rho * uCover.x * horizon * ( 1.0 - smoothstep( 1.8, 3.4, reach * length( d.xz ) * sfCloud.x ) );
			vec3 c = shadeCloud( raw, lowCloud( p + sunXZ * ( 0.05 / sfCloud.x ), h ), lit, shade, rim ) + uEmber * ( rho * ( 1.0 - up ) * ( 1.0 - up ) );
			color = color * ( 1.0 - a ) + c * a;
			alpha = alpha * ( 1.0 - a ) + a;
		}
		// 云也吃空气透视：越靠近地平线越偏雾色
		color = mix( color, fog * alpha, ( 1.0 - horizon ) * 0.7 + 0.12 );
	}
	// 日盘和光晕：被云遮住；地平线以下收掉
	if ( uShape.w > 0.0 ) {
		float disc = smoothstep( 0.99988, 0.99994, toward );
		float glow = disc * 2.4 + pow( toward, 700.0 ) * 0.9 + pow( toward, 60.0 ) * 0.26 + t4 * t4 * 0.07;
		color += sunColor * ( glow * uShape.w * ( 1.0 - 0.88 * alpha ) * smoothstep( -0.03, 0.04, up ) );
	}
	if ( alpha < 0.002 && dot( color, vec3( 1.0 ) ) < 0.004 ) discard;
	gl_FragColor = vec4( color, alpha ); // 预乘：云盖住后面的天，日晕加上去
}
`;

/** 立方体天空盒里是不是已经画了太阳：每个面缩到 48×48，有三个以上烧白的像素（亮度 ≥ 0.95）就算有 */
function skyboxHasSun(texture: THREE.CubeTexture): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 48;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    for (const image of texture.image as CanvasImageSource[]) {
      context.drawImage(image, 0, 0, 48, 48);
      const data = context.getImageData(0, 0, 48, 48).data;
      let hot = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] * 0.3 + data[i + 1] * 0.5 + data[i + 2] * 0.2 >= 243) hot++;
      if (hot >= 3) return true;
    }
  } catch {
    // 读不了像素（没有 DOM、跨域贴图）：当作没有
  }
  return false;
}

export class CloudSky {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** 可以随时改字段，下一帧生效 */
  readonly profile: CloudSkyProfile;
  /** 当前的天空盒里已经画了太阳（这时不画日晕）；检视 / 调试用 */
  skyboxSun = false;
  private checked: unknown = undefined;

  constructor(profile: CloudSkyProfile) {
    this.profile = profile;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tNoise: { value: atmosphereNoise() }, uOn: { value: 0 },
        uCover: { value: new THREE.Vector4() }, uShape: { value: new THREE.Vector4() }, uEmber: { value: new THREE.Vector3() },
      },
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      side: THREE.BackSide, transparent: true, depthWrite: false, fog: false, toneMapped: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    });
    // 空气透视的共享 uniform 原样挂上（不克隆）：云影图、风、时间、日光、雾色
    Object.assign(material.uniforms, Atmosphere.uniforms);
    // 只要地平线以上的半球，往下多留一点给日晕落山
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), material);
    this.mesh.name = 'CloudSky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -900; // 透明队列里最先画：后面的雾带、水面、粒子都叠在云上
    this.mesh.onBeforeRender = (_renderer, scene) => {
      const p = this.profile, u = material.uniforms, background = (scene as THREE.Scene).background;
      // 天空盒是异步换上的：每次换了就重新查一遍里面有没有太阳
      if (background !== this.checked) {
        this.checked = background;
        this.skyboxSun = background instanceof THREE.CubeTexture && skyboxHasSun(background);
      }
      u.uOn.value = Atmosphere.active ? 1 : 0;
      u.uCover.value.set(p.low, p.mid, p.high, p.white);
      u.uShape.value.set(p.height, p.lit, p.shade, this.skyboxSun ? 0 : p.sunGlow);
      u.uEmber.value.fromArray(p.ember);
    };
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
