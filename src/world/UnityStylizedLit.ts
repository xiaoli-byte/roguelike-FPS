import * as THREE from 'three';
import type { UnityEnvironment } from './UnityLevelLibrary';

/**
 * Unity 风格化着色器的网页版（M11a 材质部分）：
 *   Spiritfire/StylizedLit   ← unity/Assets/Art/Shaders/SF_StylizedLit.shader + SF_StylizedShading.hlsl + SF_StylizedInput.hlsl
 *   Spiritfire/StylizedTerrain ← SF_StylizedTerrain.shader
 *   Spiritfire/Foliage       ← SF_Foliage.shader
 *
 * 做法：MeshStandardMaterial + onBeforeCompile，只换光照片段（lights_fragment_begin / maps / end、aomap、outgoingLight），
 * 贴图 / 法线 / 蒙皮 / 实例化 / 投影 / 雾的片段原样保留；Atmosphere.ts 改过的雾片段照常生效，
 * 它挂在平行光上的云影这里接进主光的阴影衰减（云影里同样走冷色暗部，而不是只压暗）。
 *
 * 光照模型（SFShade）：环境光 = 三色环境光的球谐 × 固有色；主光 N·L 与投影经软阶梯分亮 / 暗两块，
 * 暗部叠 shadowTint × 主光色 × shadowLift；阶梯高光只给低粗糙度区；菲涅尔经阶梯成边缘光。
 * 和 Unity 一样不除 π：光色 = 线性颜色 × 强度，直接乘固有色。
 *
 * 颜色空间：工程是线性空间，导出器写的是 Material.GetColor（sRGB 编码的「伽马」值，HDR 颜色也是），
 * Unity 上传 GPU 前按 GammaToLinearSpaceExact 转成线性（≥ 1 的分量按 pow 2.2），这里照做。
 * glTF 的 baseColorFactor / emissiveFactor 也是导出器直接抄的伽马值，所以不用 GLTFLoader 给的 color / emissive。
 */

export type Rgba = [number, number, number, number];

export interface UnityMaterialProperties {
  unityShader?: string;
  unityFloats?: Record<string, number>;
  unityColors?: Record<string, Rgba>;
  unityVectors?: Record<string, Rgba>;
}

/** Unity GammaToLinearSpaceExact（UnityCG.cginc；Mathf.GammaToLinearSpace 同式）：HDR 分量 ≥ 1 时按 pow 2.2 */
export function unityGammaToLinear(value: number): number {
  if (value <= 0.04045) return value / 12.92;
  if (value < 1) return Math.pow((value + 0.055) / 1.055, 2.4);
  return Math.pow(value, 2.2);
}

/** 材质颜色属性（导出的伽马值）→ Unity 送进着色器的线性值 */
export function unityColor(rgba: Rgba | undefined, fallback: Rgba): THREE.Color {
  const c = rgba ?? fallback;
  return new THREE.Color(unityGammaToLinear(c[0]), unityGammaToLinear(c[1]), unityGammaToLinear(c[2]));
}

// ───────────── 场景共享：三色环境光、主光投影强度、时间 ─────────────

/**
 * 所有风格化材质共用的 uniform（同一个对象挂进每个材质，改一次全场生效）。
 * uSflAmbient0/1/2：环境光球谐的 L0 / L1 / L2 带状系数（只随世界 y 变化），uSflAmbientMode 0 = 没给环境时退回 Three 的环境光 / 半球光。
 */
export const stylizedShared = {
  uSflAmbient0: { value: new THREE.Vector3(0.4, 0.4, 0.4) },
  uSflAmbient1: { value: new THREE.Vector3() },
  uSflAmbient2: { value: new THREE.Vector3() },
  uSflAmbientMode: { value: 0 },
  uSflShadowStrength: { value: 1 },
  uSflTime: { value: 0 },
  /** Unity 全局 _WindDir（WeatherDirector 写）：xy = XZ 风向（Unity 坐标），z = 风力 0..1；全 0 = 着色器里的默认风 */
  uSflWindDir: { value: new THREE.Vector4(0, 0, 0, 0) },
};

/**
 * 三色环境光（RenderSettings.ambientMode = Trilight）→ 球谐。Unity 在原生代码里把「上天色 / 侧赤道色 / 下地色」的环境投到
 * L2 球谐，SampleSH 取的是余弦卷积后的辐照度。这里按同一路子解析地算：辐射度沿世界 y 线性渐变（y > 0 赤道 → 天，y < 0 赤道 → 地），
 * 投到 Legendre 带状系数再乘余弦卷积系数 (1, 2/3, 1/4)。三色相同时等于平光；Flat 模式只用 L0。
 * 返回 [c0, c1, c2]：E(y) = c0 + c1·y + c2·(1.5y² − 0.5)，线性颜色 × ambientIntensity。
 */
export function trilightCoefficients(ambient: UnityEnvironment['ambient']): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const k = ambient.intensity ?? 1;
  if (ambient.mode === 3 || ambient.mode === 4) {
    const flat = unityColor(ambient.light, [0.4, 0.4, 0.4, 1]);
    return [new THREE.Vector3(flat.r, flat.g, flat.b).multiplyScalar(k), new THREE.Vector3(), new THREE.Vector3()];
  }
  const s = unityColor(ambient.sky, [0.4, 0.45, 0.55, 1]), e = unityColor(ambient.equator, [0.4, 0.4, 0.4, 1]), g = unityColor(ambient.ground, [0.25, 0.22, 0.2, 1]);
  const v = (c: THREE.Color) => new THREE.Vector3(c.r, c.g, c.b);
  const S = v(s), E = v(e), G = v(g);
  // f0 = (S + G + 2E) / 4；f1 = (S − G) / 2；f2 = 5 (S + G − 2E) / 16
  const c0 = S.clone().add(G).addScaledVector(E, 2).multiplyScalar(0.25 * k);
  const c1 = S.clone().sub(G).multiplyScalar(0.5 * (2 / 3) * k);
  const c2 = S.clone().add(G).addScaledVector(E, -2).multiplyScalar((5 / 16) * 0.25 * k);
  return [c0, c1, c2];
}

/** 每张图建好环境时调（applyUnityMaterial / applyUnityTerrain 自动调）：环境光球谐、主光投影强度 */
export function setStylizedEnvironment(environment?: Pick<UnityEnvironment, 'ambient' | 'sun'> | null): void {
  if (!environment) return;
  const [c0, c1, c2] = trilightCoefficients(environment.ambient);
  stylizedShared.uSflAmbient0.value.copy(c0);
  stylizedShared.uSflAmbient1.value.copy(c1);
  stylizedShared.uSflAmbient2.value.copy(c2);
  stylizedShared.uSflAmbientMode.value = 1;
  stylizedShared.uSflShadowStrength.value = environment.sun ? THREE.MathUtils.clamp(environment.sun.shadowStrength ?? 1, 0, 1) : 1;
}

// ───────────── 风格参数 ─────────────

export interface StylizedStyle {
  shadowTint: THREE.Color;
  rampThreshold: number;
  rampSoftness: number;
  shadowLift: number;
  ambientStrength: number;
  specStrength: number;
  specSize: number;
  rimColor: THREE.Color;
  rimPower: number;
  rimStrength: number;
}

function readStyle(properties: UnityMaterialProperties, defaults: { [K in keyof StylizedStyle]: StylizedStyle[K] extends THREE.Color ? Rgba : number }): StylizedStyle {
  const f = properties.unityFloats ?? {}, c = properties.unityColors ?? {};
  return {
    shadowTint: unityColor(c._ShadowTint, defaults.shadowTint),
    rampThreshold: f._RampThreshold ?? defaults.rampThreshold,
    rampSoftness: Math.max(0.001, f._RampSoftness ?? defaults.rampSoftness),
    shadowLift: f._ShadowLift ?? defaults.shadowLift,
    ambientStrength: f._AmbientStrength ?? defaults.ambientStrength,
    specStrength: f._SpecStrength ?? defaults.specStrength,
    specSize: f._SpecSize ?? defaults.specSize,
    rimColor: unityColor(c._RimColor, defaults.rimColor),
    rimPower: f._RimPower ?? defaults.rimPower,
    rimStrength: f._RimStrength ?? defaults.rimStrength,
  };
}

/** SF_StylizedLit.shader 的 Properties 默认值 */
const LIT_DEFAULTS = {
  shadowTint: [0.62, 0.66, 0.86, 1] as Rgba, rampThreshold: 0.05, rampSoftness: 0.18, shadowLift: 0.32, ambientStrength: 1,
  specStrength: 0.5, specSize: 0.12, rimColor: [1, 0.93, 0.8, 1] as Rgba, rimPower: 3.5, rimStrength: 0.35,
};

/** SF_Foliage.shader 的默认值（没有高光：Unity 里 specStrength = 0） */
const FOLIAGE_DEFAULTS = {
  shadowTint: [0.55, 0.62, 0.86, 1] as Rgba, rampThreshold: 0, rampSoftness: 0.3, shadowLift: 0.4, ambientStrength: 1,
  specStrength: 0, specSize: 0.1, rimColor: [1, 0.92, 0.75, 1] as Rgba, rimPower: 3, rimStrength: 0.25,
};

/** 没导出 ORM 贴图时的替代（导出器只写 BC / N / E）：Unity 里带法线贴图的场景件都开了 _ORMMAP，
 * 取 unity/Assets/Art/Props 下 ORM 贴图的平均值：AO ≈ 0.74、粗糙度 ≈ 0.86、金属 ≈ 0.05（几乎全是非金属） */
export const ORM_FALLBACK = { ao: 0.75, roughness: 0.86, metallic: 0 };

// ───────────── 着色器片段 ─────────────

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 uSflShadowTint;
uniform vec3 uSflRimColor;
uniform vec4 uSflRamp;      // x 阶梯阈值, y 柔边, z 暗部抬升, w 环境光强度
uniform vec4 uSflSpec;      // x 高光强度, y 高光大小, z 边缘光幂, w 边缘光强度
uniform vec4 uSflSurface;   // x 去饱和, y 常量 AO, z 闪白量, w 保留
uniform vec3 uSflTint;
uniform vec3 uSflFlashColor;
uniform vec3 uSflAmbient0;
uniform vec3 uSflAmbient1;
uniform vec3 uSflAmbient2;
uniform float uSflAmbientMode;
uniform float uSflShadowStrength;
#ifdef SFL_FOLIAGE
	uniform vec3 uSflTranslucency;  // 逆光透光色 × 强度
#endif

float sflRampOf( const in float ndl ) {
	return smoothstep( uSflRamp.x - uSflRamp.y, uSflRamp.x + uSflRamp.y, ndl );
}

// SampleSH：三色环境光的带状球谐（世界 y）；没给环境时用 Three 的环境光 / 半球光
vec3 sflAmbient( const in vec3 viewDir ) {
	if ( uSflAmbientMode > 0.5 ) {
		float y = inverseTransformDirection( viewDir, viewMatrix ).y;
		return max( uSflAmbient0 + uSflAmbient1 * y + uSflAmbient2 * ( 1.5 * y * y - 0.5 ), vec3( 0.0 ) );
	}
	vec3 irradiance = ambientLightColor;
	#if NUM_HEMI_LIGHTS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], viewDir );
		}
		#pragma unroll_loop_end
	#endif
	return irradiance;
}

// SFLight：一盏灯的软阶梯漫反射 + 阶梯高光（lightColor 已含距离 / 聚光衰减）
vec3 sflLight( const in vec3 L, const in vec3 lightColor, const in float shadow, const in vec3 albedo, const in vec3 N, const in vec3 V,
		const in float metallic, const in float roughness, out float lit ) {
	lit = sflRampOf( dot( N, L ) ) * smoothstep( 0.0, 0.6, shadow );
	vec3 c = albedo * lit * ( 1.0 - metallic * 0.5 );
	#ifdef SFL_SPEC
		vec3 h = L + V;
		vec3 H = h * inversesqrt( max( dot( h, h ), 1e-8 ) );
		float ndh = saturate( dot( N, H ) );
		float gloss = 1.0 - roughness;
		float specEdge = 1.0 - uSflSpec.y * ( 0.35 + roughness );
		float spec = smoothstep( specEdge - 0.015, specEdge + 0.015, ndh ) * gloss * gloss * uSflSpec.x * lit;
		c += mix( vec3( 0.9 ), albedo, metallic ) * spec;
	#endif
	return c * lightColor;
}
`;

/** 换掉 <lights_fragment_begin>：SFShade 全套（环境光、主光、附加点光 / 聚光、暗部冷色、金属反射、边缘光、逆光透光） */
const LIGHTING = /* glsl */ `
// ── SF_StylizedShading.hlsl · SFShade（src/world/UnityStylizedLit.ts）──
vec3 sflN = normal;
vec3 sflV = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
vec3 sflPos = - vViewPosition;
vec3 sflAlbedo = diffuseColor.rgb;
float sflMetal = metalnessFactor;
float sflRough = roughnessFactor;
float sflAO = uSflSurface.y;
vec3 sflColor = sflAlbedo * sflAmbient( sflN ) * uSflRamp.w * sflAO;
float sflMainLit = 0.0;
vec3 sflMainColor = vec3( 0.0 );
vec3 sflMainDir = vec3( 0.0, 1.0, 0.0 );
IncidentLight directLight;
float sflShadow = 1.0;
float sflLit = 0.0;

#if NUM_DIR_LIGHTS > 0
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
		DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		sflShadow = 1.0;
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
			directionalLightShadow = directionalLightShadows[ i ];
			sflShadow = receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		#if UNROLLED_LOOP_INDEX == 0
			// 主光：Unity 的 shadowStrength；空气透视层的云影也当投影进阶梯
			sflShadow = mix( 1.0, sflShadow, uSflShadowStrength );
			#if defined( USE_FOG ) && defined( SF_ATMOSPHERE )
				sflShadow *= sfSunShare( vSfWorld );
			#endif
		#endif
		sflColor += sflLight( directLight.direction, directLight.color, sflShadow, sflAlbedo, sflN, sflV, sflMetal, sflRough, sflLit );
		#if UNROLLED_LOOP_INDEX == 0
			sflMainLit = sflLit;
			sflMainColor = directLight.color;
			sflMainDir = directLight.direction;
		#endif
	}
	#pragma unroll_loop_end
#endif

#if NUM_POINT_LIGHTS > 0
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
		PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, sflPos, directLight );
		sflShadow = 1.0;
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
			pointLightShadow = pointLightShadows[ i ];
			sflShadow = ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		sflColor += sflLight( directLight.direction, directLight.color, sflShadow, sflAlbedo, sflN, sflV, sflMetal, sflRough, sflLit );
	}
	#pragma unroll_loop_end
#endif

#if NUM_SPOT_LIGHTS > 0
	SpotLight spotLight;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
		SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, sflPos, directLight );
		sflShadow = 1.0;
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			spotLightShadow = spotLightShadows[ i ];
			sflShadow = ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		sflColor += sflLight( directLight.direction, directLight.color, sflShadow, sflAlbedo, sflN, sflV, sflMetal, sflRough, sflLit );
	}
	#pragma unroll_loop_end
#endif

// 暗部冷色偏移：shadowTint × 主光 × 抬升，避免背光面发黑发灰
sflColor += sflAlbedo * uSflShadowTint * sflMainColor * uSflRamp.z * ( 1.0 - sflMainLit ) * sflAO;

#ifdef SFL_METAL_ENV
	// 金属反射：只给低粗糙度的金属区（网页没有反射探针，环境取同一份环境光球谐）
	sflColor += sflAmbient( reflect( - sflV, sflN ) ) * sflAlbedo * sflMetal * ( 1.0 - sflRough ) * 0.6;
#endif

#ifdef SFL_RIM
	// 边缘光：菲涅尔经阶梯成一道细边，受光侧更亮
	float sflFres = pow( 1.0 - saturate( dot( sflN, sflV ) ), uSflSpec.z );
	sflColor += uSflRimColor * ( smoothstep( 0.35, 0.6, sflFres ) * uSflSpec.w * ( 0.45 + 0.55 * sflMainLit ) ) * sflMainColor * sflAlbedo * 1.5;
#endif

#ifdef SFL_FOLIAGE
	// 逆光透光：视线对着太阳时枝叶透出一层光，按摆动权重只给枝叶
	float sflSway = 1.0;
	#ifdef USE_COLOR_ALPHA
		sflSway = vColor.a;
	#endif
	float sflBack = pow( saturate( dot( - sflV, sflMainDir ) ), 5.0 ) * sflSway;
	sflColor += sflAlbedo * uSflTranslucency * sflMainColor * sflBack;
#endif
`;

/** 固有色修饰（放在 <color_fragment> 之后）：_Desaturate 按亮度往灰里收，再乘 _Tint */
const ALBEDO_MODIFIERS = /* glsl */ `
#ifdef SFL_DESATURATE
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), uSflSurface.x );
#endif
diffuseColor.rgb *= uSflTint;
`;

// ───────────── 地形（SF_StylizedTerrain.shader） ─────────────

const TERRAIN_VERTEX_PARS = /* glsl */ `
varying vec3 vSflPos;
varying vec3 vSflNormal;
`;

const TERRAIN_VERTEX_MAIN = /* glsl */ `
vec4 sflWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	sflWorld = instanceMatrix * sflWorld;
#endif
vSflPos = ( modelMatrix * sflWorld ).xyz;
vSflNormal = mat3( modelMatrix ) * objectNormal;
`;

const TERRAIN_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uSflControl;
uniform sampler2D uSflLayer0;
uniform sampler2D uSflLayer1;
uniform sampler2D uSflLayer2;
uniform sampler2D uSflLayer3;
uniform sampler2D uSflMacro;
uniform vec4 uSflLayerTile;  // 每层一张贴图覆盖的米数
uniform vec4 uSflTerrainA;   // x 高度混合强度, y 混合深度, z 宏观色斑尺度（米）, w 宏观色斑强度
uniform vec4 uSflTerrainB;   // x 坡度压暗, y 岩层三平面尺度（米）, z 岩层 UV 扭曲, w 第二尺度明暗
#ifdef SFL_STEEP_TRIPLANAR
	uniform sampler2D uSflWarp;
	uniform vec4 uSflSteepFade;  // 1 − N.y：雪 从 / 到，冻土 从 / 到
	uniform float uSflWarpScale;
#endif
varying vec3 vSflPos;
varying vec3 vSflNormal;
vec4 sflTri( sampler2D tex, const in vec2 px, const in vec2 py, const in vec2 pz, const in float size, const in vec3 tw ) {
	return texture2D( tex, px / size ) * tw.x + texture2D( tex, py / size ) * tw.y + texture2D( tex, pz / size ) * tw.z;
}
`;

/** 换掉 <map_fragment>：四层高度混合 + 宏观色斑 + 坡度压暗（坐标先换回 Unity 的：x 取反） */
const TERRAIN_ALBEDO = /* glsl */ `
vec3 sflP = vec3( - vSflPos.x, vSflPos.y, vSflPos.z );
vec3 sflNw = normalize( vec3( - vSflNormal.x, vSflNormal.y, vSflNormal.z ) );
// 分层图：网格 UV 的 u 和 Unity 地形的 u 相反（高度场按 x 镜像打包）
vec4 sflCtrl = texture2D( uSflControl, vec2( 1.0 - vMapUv.x, vMapUv.y ) );
// 权重全 0（发布的 WebP 把 alpha = 0 处的 RGB 清掉了）时退回第 0 层
if ( sflCtrl.r + sflCtrl.g + sflCtrl.b + sflCtrl.a < 0.004 ) sflCtrl.r = 1.0;
vec3 sflTw = pow( abs( sflNw ), vec3( 4.0 ) );
sflTw /= sflTw.x + sflTw.y + sflTw.z;
vec2 sflWuv = sflP.xz;
#ifdef SFL_STEEP_TRIPLANAR
	vec2 sflPx = sflP.zy, sflPz = sflP.xy;
	vec4 sflC0 = sflTri( uSflLayer0, sflPx, sflWuv, sflPz, uSflLayerTile.x, sflTw );
	vec4 sflC1 = sflTri( uSflLayer1, sflPx, sflWuv, sflPz, uSflLayerTile.y, sflTw );
	vec4 sflC2 = sflTri( uSflLayer2, sflPx, sflWuv, sflPz, uSflLayerTile.z, sflTw );
	vec2 sflWx = texture2D( uSflWarp, sflPx / uSflWarpScale ).rg - 0.5;
	vec2 sflWy = texture2D( uSflWarp, sflWuv / uSflWarpScale ).rg - 0.5;
	vec2 sflWz = texture2D( uSflWarp, sflPz / uSflWarpScale ).rg - 0.5;
	vec4 sflC3 = texture2D( uSflLayer3, sflPx / uSflTerrainB.y + sflWx * uSflTerrainB.z ) * sflTw.x
		+ texture2D( uSflLayer3, sflWuv / uSflLayerTile.w + sflWy * uSflTerrainB.z ) * sflTw.y
		+ texture2D( uSflLayer3, sflPz / uSflTerrainB.y + sflWz * uSflTerrainB.z ) * sflTw.z;
	// 第二个尺度：大 2.7 倍、转 17°、错开，按它的高度调明暗（平均高度取最小一级 mip）
	mat2 sflRot = mat2( 0.956, 0.292, -0.292, 0.956 );
	float sflBig = uSflTerrainB.y * 2.7;
	vec4 sflB3 = texture2D( uSflLayer3, sflRot * sflPx / sflBig + vec2( 0.37, 0.11 ) ) * sflTw.x
		+ texture2D( uSflLayer3, sflRot * sflWuv / sflBig + vec2( 0.37, 0.11 ) ) * sflTw.y
		+ texture2D( uSflLayer3, sflRot * sflPz / sflBig + vec2( 0.37, 0.11 ) ) * sflTw.z;
	float sflMeanH = textureLod( uSflLayer3, vec2( 0.5 ), 12.0 ).a;
	sflC3.rgb *= 1.0 + ( sflB3.a - sflMeanH ) * 2.0 * uSflTerrainB.w;
	// 陡坡挂不住雪：退掉的份额给岩
	float sflSteep = 1.0 - sflNw.y;
	float sflSnowOff = smoothstep( uSflSteepFade.x, uSflSteepFade.y, sflSteep ) * sflCtrl.r;
	float sflSoilOff = smoothstep( uSflSteepFade.z, uSflSteepFade.w, sflSteep ) * sflCtrl.g;
	sflCtrl.r -= sflSnowOff;
	sflCtrl.g -= sflSoilOff;
	sflCtrl.a += sflSnowOff + sflSoilOff;
#else
	vec4 sflC0 = texture2D( uSflLayer0, sflWuv / uSflLayerTile.x );
	vec4 sflC1 = texture2D( uSflLayer1, sflWuv / uSflLayerTile.y );
	vec4 sflC2 = texture2D( uSflLayer2, sflWuv / uSflLayerTile.z );
	vec4 sflC3 = texture2D( uSflLayer3, sflP.zy / uSflTerrainB.y ) * sflTw.x + texture2D( uSflLayer3, sflP.xy / uSflTerrainB.y ) * sflTw.z
		+ texture2D( uSflLayer3, sflWuv / uSflLayerTile.w ) * sflTw.y;
#endif
// 高度混合：权重 + 高度，只留最高的一段
vec4 sflHw = sflCtrl + vec4( sflC0.a, sflC1.a, sflC2.a, sflC3.a ) * uSflTerrainA.x * step( 0.001, sflCtrl );
float sflTop = max( max( sflHw.x, sflHw.y ), max( sflHw.z, sflHw.w ) ) - uSflTerrainA.y;
vec4 sflB = max( sflHw - sflTop, 0.0 );
sflB /= max( 1e-4, sflB.x + sflB.y + sflB.z + sflB.w );
vec3 sflTerrain = sflC0.rgb * sflB.x + sflC1.rgb * sflB.y + sflC2.rgb * sflB.z + sflC3.rgb * sflB.w;
#ifdef SFL_STEEP_TRIPLANAR
	float sflMacro = texture2D( uSflMacro, sflPx / uSflTerrainA.z ).r * sflTw.x + texture2D( uSflMacro, sflWuv / uSflTerrainA.z ).r * sflTw.y
		+ texture2D( uSflMacro, sflPz / uSflTerrainA.z ).r * sflTw.z;
#else
	float sflMacro = texture2D( uSflMacro, sflWuv / uSflTerrainA.z ).r;
#endif
sflTerrain *= 1.0 + ( sflMacro - 0.5 ) * 2.0 * uSflTerrainA.w;
sflTerrain *= 1.0 - uSflTerrainB.x * smoothstep( 0.55, 0.9, 1.0 - sflNw.y );
diffuseColor.rgb *= sflTerrain;
`;

// ───────────── 树冠（SF_Foliage.shader） ─────────────

const FOLIAGE_VERTEX_PARS = /* glsl */ `
uniform float uSflTime;
uniform vec4 uSflWind;     // x 枝梢摆幅（米）, y 风速, z 细颤（米）
uniform vec4 uSflWindDir;  // Unity _WindDir：xy 风向（Unity XZ）, z 风力
// FoliageWind：整棵树绕根部摆 + 枝梢细颤，相位按树根世界位置错开（在 Unity 坐标里算：x 取反）
vec3 sflFoliageWind( const in vec3 positionWS, const in vec3 rootWS, const in float sway ) {
	vec3 p = vec3( - positionWS.x, positionWS.y, positionWS.z );
	vec2 root = vec2( - rootWS.x, rootWS.z );
	float phase = dot( root, vec2( 0.137, 0.173 ) );
	vec2 dir = dot( uSflWindDir.xy, uSflWindDir.xy ) > 1e-4 ? normalize( uSflWindDir.xy ) : vec2( 0.8, 0.6 );
	float force = 0.55 + uSflWindDir.z;
	float t = uSflTime * uSflWind.y;
	float bend = ( sin( t + phase ) * 0.6 + sin( t * 2.3 + phase * 1.7 ) * 0.25 + 0.4 ) * uSflWind.x * force * sway;
	p.xz += dir * bend;
	float flutter = sin( t * 5.7 + p.x * 0.9 + p.z * 1.3 + phase * 3.0 ) * uSflWind.z * force * sway * sway;
	p += vec3( flutter, flutter * 0.4, - flutter * 0.7 );
	return vec3( - p.x, p.y, p.z );
}
`;

const FOLIAGE_PROJECT = /* glsl */ `
vec4 sflWorld = vec4( transformed, 1.0 );
vec4 sflRoot = vec4( 0.0, 0.0, 0.0, 1.0 );
#ifdef USE_INSTANCING
	sflWorld = instanceMatrix * sflWorld;
	sflRoot = instanceMatrix * sflRoot;
#endif
sflWorld = modelMatrix * sflWorld;
sflRoot = modelMatrix * sflRoot;
float sflSwayWeight = 1.0;
#ifdef USE_COLOR_ALPHA
	sflSwayWeight = color.a;
#endif
sflWorld.xyz = sflFoliageWind( sflWorld.xyz, sflRoot.xyz, sflSwayWeight );
vec4 mvPosition = viewMatrix * sflWorld;
gl_Position = projectionMatrix * mvPosition;
`;

const FOLIAGE_WORLDPOS = /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = sflWorld;
#endif
`;

// ───────────── 打补丁 ─────────────

interface PatchOptions {
  kind: 'lit' | 'terrain' | 'foliage';
  style: StylizedStyle;
  defines: Record<string, string>;
  /** 本材质自己的 uniform（共享的 stylizedShared 自动挂上） */
  uniforms: Record<string, THREE.IUniform>;
  fragmentPars?: string;
  /** 换掉 <map_fragment>（地形的四层混合） */
  albedo?: string;
  vertexPars?: string;
  /** 接在 <fog_vertex> 之后 */
  vertexMain?: string;
  /** 换掉 <project_vertex> 与 <worldpos_vertex>（树冠的风） */
  project?: string;
  worldpos?: string;
}

function replaceOnce(source: string, search: string, replacement: string, what: string): string {
  if (!source.includes(search)) throw new Error(`[UnityStylizedLit] ${what}：着色器里找不到 ${search}`);
  return source.replace(search, replacement);
}

/** 本材质的风格 uniform（每个材质一份；程序按 define 组合共享） */
function styleUniforms(style: StylizedStyle, surface: { desaturate: number; ao: number }, tint: THREE.Color): Record<string, THREE.IUniform> {
  return {
    uSflShadowTint: { value: style.shadowTint },
    uSflRimColor: { value: style.rimColor },
    uSflRamp: { value: new THREE.Vector4(style.rampThreshold, style.rampSoftness, style.shadowLift, style.ambientStrength) },
    uSflSpec: { value: new THREE.Vector4(style.specStrength, style.specSize, style.rimPower, style.rimStrength) },
    uSflSurface: { value: new THREE.Vector4(surface.desaturate, surface.ao, 0, 0) },
    uSflTint: { value: tint },
    uSflFlashColor: { value: new THREE.Color(1, 1, 1) },
  };
}

function patchMaterial(material: THREE.MeshStandardMaterial, options: PatchOptions): void {
  material.defines = { ...(material.defines ?? {}), ...options.defines };
  const uniforms = { ...options.uniforms };
  material.userData.sflUniforms = uniforms;
  material.userData.sflKind = options.kind;
  const key = `sfl-${options.kind}|${Object.keys(options.defines).sort().join(',')}`;
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, stylizedShared);
    let fragment = shader.fragmentShader;
    fragment = replaceOnce(fragment, 'void main() {', `${FRAGMENT_PARS}\n${options.fragmentPars ?? ''}\nvoid main() {`, 'fragment pars');
    // Unity 的双面材质不按 VFACE 翻法线：背面照样按正面法线受光
    fragment = replaceOnce(fragment, '#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'), 'normal');
    if (options.albedo) fragment = replaceOnce(fragment, '#include <map_fragment>', options.albedo, 'terrain albedo');
    fragment = replaceOnce(fragment, '#include <color_fragment>', `#include <color_fragment>\n${ALBEDO_MODIFIERS}`, 'albedo');
    fragment = replaceOnce(fragment, '#include <lights_fragment_begin>', LIGHTING, 'lighting');
    fragment = replaceOnce(fragment, '#include <lights_fragment_maps>', '', 'lighting maps');
    fragment = replaceOnce(fragment, '#include <lights_fragment_end>', '', 'lighting end');
    fragment = replaceOnce(fragment, '#include <aomap_fragment>', '', 'ao');
    fragment = replaceOnce(fragment, 'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
      'vec3 outgoingLight = sflColor + totalEmissiveRadiance;\n\toutgoingLight = mix( outgoingLight, uSflFlashColor, uSflSurface.z );', 'outgoing');
    shader.fragmentShader = fragment;
    if (options.vertexPars || options.vertexMain || options.project) {
      let vertex = shader.vertexShader;
      vertex = replaceOnce(vertex, 'void main() {', `${options.vertexPars ?? ''}\nvoid main() {`, 'vertex pars');
      if (options.project) vertex = replaceOnce(vertex, '#include <project_vertex>', options.project, 'project');
      if (options.worldpos) vertex = replaceOnce(vertex, '#include <worldpos_vertex>', options.worldpos, 'worldpos');
      if (options.vertexMain) vertex = replaceOnce(vertex, '#include <fog_vertex>', `#include <fog_vertex>\n${options.vertexMain}`, 'vertex main');
      shader.vertexShader = vertex;
    }
  };
  material.needsUpdate = true;
}

// ───────────── StylizedLit ─────────────

const warned = new Set<string>();

/**
 * Unity 里由运行时脚本（MaterialPropertyBlock）驱动的可选段：导出的场景里全是默认值（= 整段跳过），网页暂不移植。
 * 返回参数不是默认值的段名，好在出现时提醒（M11b 特效 / M6 首领移植时补）。
 */
export function unsupportedStylizedBlocks(properties: UnityMaterialProperties): string[] {
  const f = properties.unityFloats ?? {}, c = properties.unityColors ?? {}, v = properties.unityVectors ?? {};
  const out: string[] = [];
  const variant = v._VariantParams;
  if (variant && variant[0] + variant[1] > 0.001) out.push('variant');
  if ((v._DissolveParams?.[0] ?? 0) > 0.0001) out.push('dissolve');
  const glow = [c._GlowMaskColor0, c._GlowMaskColor1, c._GlowMaskColor2].reduce((sum, color) => sum + (color ? color[0] + color[1] + color[2] : 0), 0);
  if (glow > 0.0001) out.push('glowMask');
  if ((v._RegionParams?.[0] ?? 0) > 0.5) out.push('region');
  if ((v._FlameKey?.[0] ?? 0) > 0.0001) out.push('flameKey');
  if ((f._Fur ?? 0) > 0.5) out.push('fur');
  return out;
}

interface LitSurface {
  metallic: number;
  roughness: number;
  ao: number;
}

/** _ORMMAP 没导出：带法线贴图的件（Unity 里都绑了 ORM）用平均 ORM 替代，没法线贴图的件按材质的 _Metallic / _Roughness */
function litSurface(properties: UnityMaterialProperties, hasNormalMap: boolean): LitSurface {
  const f = properties.unityFloats ?? {};
  const metallic = f._Metallic ?? 1, roughness = f._Roughness ?? 1, occlusion = f._OcclusionStrength ?? 1;
  if (!hasNormalMap) return { metallic, roughness, ao: 1 };
  return {
    metallic: metallic * ORM_FALLBACK.metallic,
    roughness: roughness * ORM_FALLBACK.roughness,
    ao: 1 + (ORM_FALLBACK.ao - 1) * occlusion,
  };
}

/** 按材质参数开的 define（customProgramCacheKey 跟着变，同一组合共享一个程序） */
export function stylizedLitDefines(properties: UnityMaterialProperties, hasNormalMap = false): Record<string, string> {
  const f = properties.unityFloats ?? {};
  const surface = litSurface(properties, hasNormalMap);
  const defines: Record<string, string> = {};
  if ((f._Desaturate ?? 0) > 0) defines.SFL_DESATURATE = '';
  if ((f._SpecStrength ?? LIT_DEFAULTS.specStrength) > 0 && surface.roughness < 1) defines.SFL_SPEC = '';
  if ((f._RimStrength ?? LIT_DEFAULTS.rimStrength) > 0) defines.SFL_RIM = '';
  if (surface.metallic > 0 && surface.roughness < 1) defines.SFL_METAL_ENV = '';
  return defines;
}

/** Unity BlendMode → Three 混合因子 */
const BLEND_FACTORS: Record<number, THREE.BlendingSrcFactor> = {
  0: THREE.ZeroFactor, 1: THREE.OneFactor, 2: THREE.DstColorFactor, 3: THREE.SrcColorFactor, 4: THREE.OneMinusDstColorFactor,
  5: THREE.SrcAlphaFactor, 6: THREE.OneMinusSrcColorFactor, 7: THREE.DstAlphaFactor, 8: THREE.OneMinusDstAlphaFactor,
  9: THREE.SrcAlphaSaturateFactor, 10: THREE.OneMinusSrcAlphaFactor,
};

const litCache = new WeakMap<THREE.Material, THREE.MeshStandardMaterial>();

/** Spiritfire/StylizedLit：同一个源材质只转一次（克隆出来的渲染节点共用） */
export function createStylizedLit(source: THREE.MeshStandardMaterial, environment?: Pick<UnityEnvironment, 'ambient' | 'sun'> | null): THREE.MeshStandardMaterial {
  setStylizedEnvironment(environment);
  const cached = litCache.get(source);
  if (cached) return cached;
  const properties = source.userData as UnityMaterialProperties;
  const f = properties.unityFloats ?? {}, c = properties.unityColors ?? {};
  for (const block of unsupportedStylizedBlocks(properties)) {
    if (warned.has(block)) continue;
    warned.add(block);
    console.warn(`[UnityStylizedLit] ${source.name} 的「${block}」段参数不是默认值，网页还没移植这一段`);
  }
  const material = source.clone();
  material.name = source.name;
  material.vertexColors = false;
  material.color.copy(unityColor(c._BaseColor, [1, 1, 1, 1]));
  material.opacity = c._BaseColor?.[3] ?? 1;
  const hasNormalMap = !!source.normalMap;
  const surface = litSurface(properties, hasNormalMap);
  material.metalness = surface.metallic;
  material.roughness = surface.roughness;
  if (material.normalMap) material.normalScale.copy(source.normalScale).multiplyScalar(f._BumpScale ?? 1);
  const emission = unityColor(c._EmissionColor, [0, 0, 0, 1]);
  material.emissive.copy(emission);
  material.emissiveIntensity = 1;
  if (emission.r + emission.g + emission.b <= 0) material.emissiveMap = null;
  const cull = f._Cull ?? 2;
  material.side = cull < 0.5 ? THREE.DoubleSide : cull < 1.5 ? THREE.BackSide : THREE.FrontSide;
  const src = Math.round(f._SrcBlend ?? 1), dst = Math.round(f._DstBlend ?? 0);
  if (src !== 1 || dst !== 0) {
    material.transparent = true;
    material.blending = THREE.CustomBlending;
    material.blendSrc = BLEND_FACTORS[src] ?? THREE.OneFactor;
    material.blendDst = (BLEND_FACTORS[dst] ?? THREE.ZeroFactor) as THREE.BlendingDstFactor;
    material.opacity = c._Tint?.[3] ?? 1;
  }
  material.depthWrite = (f._ZWrite ?? 1) > 0.5;
  const style = readStyle(properties, LIT_DEFAULTS);
  const tint = unityColor(c._Tint, [1, 1, 1, 1]);
  patchMaterial(material, {
    kind: 'lit',
    style,
    defines: stylizedLitDefines(properties, hasNormalMap),
    uniforms: styleUniforms(style, { desaturate: f._Desaturate ?? 0, ao: surface.ao }, tint),
  });
  litCache.set(source, material);
  return material;
}

/** 受击闪白（Unity _FlashColor / _FlashAmount）：运行时写 */
export function setStylizedFlash(material: THREE.Material, amount: number, color?: THREE.ColorRepresentation): void {
  const uniforms = material.userData.sflUniforms as Record<string, THREE.IUniform> | undefined;
  if (!uniforms) return;
  (uniforms.uSflSurface.value as THREE.Vector4).z = THREE.MathUtils.clamp(amount, 0, 1);
  if (color !== undefined) (uniforms.uSflFlashColor.value as THREE.Color).set(color);
}

// ───────────── Foliage ─────────────

const foliageCache = new WeakMap<THREE.Material, THREE.MeshStandardMaterial>();

/** Spiritfire/Foliage：顶点色固有色、球形法线、风、逆光透光；双面不翻法线 */
export function createStylizedFoliage(source: THREE.MeshStandardMaterial, environment?: Pick<UnityEnvironment, 'ambient' | 'sun'> | null): THREE.MeshStandardMaterial {
  setStylizedEnvironment(environment);
  const cached = foliageCache.get(source);
  if (cached) return cached;
  const properties = source.userData as UnityMaterialProperties;
  const f = properties.unityFloats ?? {}, c = properties.unityColors ?? {};
  const material = source.clone();
  material.name = source.name;
  material.vertexColors = true;
  material.map = null;
  material.normalMap = null;
  material.emissiveMap = null;
  material.emissive.setRGB(0, 0, 0);
  material.color.copy(unityColor(c._BaseColor, [1, 1, 1, 1]));
  material.metalness = 0;
  material.roughness = 1;
  material.side = THREE.DoubleSide;
  const style = readStyle(properties, FOLIAGE_DEFAULTS);
  style.specStrength = 0;
  const translucency = unityColor(c._TranslucencyColor, [1, 0.8, 0.4, 1]).multiplyScalar(f._Translucency ?? 0.6);
  const uniforms = {
    ...styleUniforms(style, { desaturate: 0, ao: 1 }, new THREE.Color(1, 1, 1)),
    uSflTranslucency: { value: translucency },
    uSflWind: { value: new THREE.Vector4(f._WindStrength ?? 0.18, f._WindSpeed ?? 1.1, f._Flutter ?? 0.04, 0) },
  };
  const defines: Record<string, string> = { SFL_FOLIAGE: '' };
  if (style.rimStrength > 0) defines.SFL_RIM = '';
  patchMaterial(material, {
    kind: 'foliage', style, defines, uniforms,
    vertexPars: FOLIAGE_VERTEX_PARS, project: FOLIAGE_PROJECT, worldpos: FOLIAGE_WORLDPOS,
  });
  // _Time.y：画到树的时候推进共享时间
  material.onBeforeRender = () => { stylizedShared.uSflTime.value = performance.now() / 1000; };
  foliageCache.set(source, material);
  return material;
}

// ───────────── Terrain ─────────────

export interface TerrainStyle {
  shadowTint: Rgba;
  macroStrength: number;
  rockScale: number;
  rockWarp: number;
  rockDetile: number;
  steepTriplanar: boolean;
}

/** 各章 / 各图的地形材质参数：unity/Assets/Levels/<图>/M_Terrain_*.mat（LevelKit.TerrainMaterial 生成；场景导出里没带地形材质） */
const DESERT: TerrainStyle = { shadowTint: [0.7, 0.64, 0.82, 1], macroStrength: 0.2, rockScale: 8, rockWarp: 0, rockDetile: 0, steepTriplanar: false };
const FROST: TerrainStyle = { shadowTint: [0.55, 0.64, 0.9, 1], macroStrength: 0.14, rockScale: 16, rockWarp: 0.3, rockDetile: 0.45, steepTriplanar: true };
const INFERNO: TerrainStyle = { shadowTint: [0.55, 0.5, 0.74, 1], macroStrength: 0.12, rockScale: 18, rockWarp: 0.25, rockDetile: 0.35, steepTriplanar: true };
export const TERRAIN_STYLES: Record<string, TerrainStyle> = {
  '1-1': DESERT, '1-2': DESERT, '1-3': DESERT, '1-4': DESERT, '1-A': DESERT,
  '2-1': FROST, '2-2': FROST, '2-3': FROST, '2-4': FROST, '2-A': FROST,
  '3-1': INFERNO, '3-2': { ...INFERNO, shadowTint: [0.52, 0.48, 0.8, 1], macroStrength: 0.2 }, '3-3': INFERNO, '3-4': INFERNO, '3-A': INFERNO,
  '4-1': { shadowTint: [0.56, 0.64, 0.86, 1], macroStrength: 0.16, rockScale: 14, rockWarp: 0.3, rockDetile: 0.4, steepTriplanar: true },
  '4-3': { shadowTint: [0.55, 0.62, 0.86, 1], macroStrength: 0.3, rockScale: 18, rockWarp: 0.3, rockDetile: 0.45, steepTriplanar: true },
};

/** 按图号取地形参数；表里没有的图按章节号（第一位数字）退回该章的默认 */
export function terrainStyle(stageId?: string): TerrainStyle {
  if (stageId && TERRAIN_STYLES[stageId]) return TERRAIN_STYLES[stageId];
  const chapter = Number.parseInt(stageId ?? '1', 10);
  return chapter === 2 ? FROST : chapter === 3 ? INFERNO : chapter === 4 ? TERRAIN_STYLES['4-1'] : DESERT;
}

// TerrainTextureGen 的周期值噪声（严格无缝；整数溢出语义照 C# unchecked）
function terrainHash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) >>> 0;
  h = Math.imul((h ^ (h >>> 13)) >>> 0, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 0xffffff) / 16777215;
}

function terrainValue(u: number, v: number, period: number, seed: number): number {
  const x = u * period, y = v * period;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  let fx = x - x0, fy = y - y0;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const wrap = (i: number) => ((i % period) + period) % period;
  const h00 = terrainHash(wrap(x0), wrap(y0), seed), h10 = terrainHash(wrap(x0 + 1), wrap(y0), seed);
  const h01 = terrainHash(wrap(x0), wrap(y0 + 1), seed), h11 = terrainHash(wrap(x0 + 1), wrap(y0 + 1), seed);
  const a = h00 + (h10 - h00) * fx, b = h01 + (h11 - h01) * fx;
  return a + (b - a) * fy;
}

/** TerrainTextureGen.Fbm */
export function terrainFbm(u: number, v: number, period: number, seed: number, octaves = 4): number {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += terrainValue(u, v, period << o, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

function noiseTexture(channels: (u: number, v: number) => [number, number]): THREE.DataTexture {
  const N = 512, data = new Uint8Array(N * N * 4);
  for (let y = 0, k = 0; y < N; y++) for (let x = 0; x < N; x++, k += 4) {
    const [r, g] = channels(x / N, y / N);
    data[k] = Math.round(r * 255);
    data[k + 1] = Math.round(g * 255);
    data[k + 2] = 128;
    data[k + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

let macroTexture: THREE.DataTexture | null = null;
let warpTexture: THREE.DataTexture | null = null;

/** T_Terrain_Macro（TerrainTextureGen.Macro(5)：周期 2、5 层 fbm，线性） */
export function terrainMacroTexture(): THREE.DataTexture {
  macroTexture ??= noiseTexture((u, v) => { const f = terrainFbm(u, v, 2, 5, 5); return [f, f]; });
  return macroTexture;
}

/** T_Terrain_Warp（TerrainTextureGen.Warp(9)：R、G 两路互不相关的周期 4 fbm） */
export function terrainWarpTexture(): THREE.DataTexture {
  warpTexture ??= noiseTexture((u, v) => [terrainFbm(u, v, 4, 9, 4), terrainFbm(u, v, 4, 109, 4)]);
  return warpTexture;
}

/** StylizedTerrain 的其余常量（LevelKit 里各图一样） */
const TERRAIN_CONSTANTS = {
  heightBlend: 0.8, heightBlendDepth: 0.2, macroScale: 70, slopeDarken: 0.25, warpScale: 17, steepFade: [0.43, 0.62, 0.58, 0.79] as Rgba,
  rampThreshold: 0, rampSoftness: 0.3, shadowLift: 0.22, ambientStrength: 1, rimColor: [1, 0.92, 0.8, 1] as Rgba, rimPower: 5, rimStrength: 0.05,
};

export interface TerrainTextures {
  control: THREE.Texture;
  /** 四层固有色（alpha = 高度）；不足四层时用第 0 层补 */
  layers: THREE.Texture[];
  /** 每层一张贴图覆盖的米数（= TerrainLayer.tileSize.x = 材质的 _LayerTile） */
  tiles: number[];
}

/** 把地形的 MeshStandardMaterial 改成 Spiritfire/StylizedTerrain */
export function stylizeTerrain(material: THREE.MeshStandardMaterial, textures: TerrainTextures, style: TerrainStyle, environment?: Pick<UnityEnvironment, 'ambient' | 'sun'> | null): void {
  setStylizedEnvironment(environment);
  const k = TERRAIN_CONSTANTS;
  const layer = (i: number) => textures.layers[i] ?? textures.layers[0];
  const tile = (i: number) => textures.tiles[i] ?? textures.tiles[0] ?? 8;
  const stylized: StylizedStyle = {
    shadowTint: unityColor(style.shadowTint, style.shadowTint), rampThreshold: k.rampThreshold, rampSoftness: k.rampSoftness, shadowLift: k.shadowLift,
    ambientStrength: k.ambientStrength, specStrength: 0, specSize: 0.1, rimColor: unityColor(k.rimColor, k.rimColor), rimPower: k.rimPower, rimStrength: k.rimStrength,
  };
  material.vertexColors = false;
  material.color.setRGB(1, 1, 1);
  material.metalness = 0;
  material.roughness = 1;
  material.emissive.setRGB(0, 0, 0);
  material.normalMap = null;
  const uniforms: Record<string, THREE.IUniform> = {
    ...styleUniforms(stylized, { desaturate: 0, ao: 1 }, new THREE.Color(1, 1, 1)),
    uSflControl: { value: textures.control },
    uSflLayer0: { value: layer(0) }, uSflLayer1: { value: layer(1) }, uSflLayer2: { value: layer(2) }, uSflLayer3: { value: layer(3) },
    uSflMacro: { value: terrainMacroTexture() },
    uSflLayerTile: { value: new THREE.Vector4(tile(0), tile(1), tile(2), tile(3)) },
    uSflTerrainA: { value: new THREE.Vector4(k.heightBlend, k.heightBlendDepth, k.macroScale, style.macroStrength) },
    uSflTerrainB: { value: new THREE.Vector4(k.slopeDarken, style.rockScale, style.rockWarp, style.rockDetile) },
  };
  const defines: Record<string, string> = { SFL_TERRAIN: '', SFL_RIM: '' };
  if (style.steepTriplanar) {
    defines.SFL_STEEP_TRIPLANAR = '';
    uniforms.uSflWarp = { value: terrainWarpTexture() };
    uniforms.uSflSteepFade = { value: new THREE.Vector4(...k.steepFade) };
    uniforms.uSflWarpScale = { value: k.warpScale };
  }
  patchMaterial(material, {
    kind: 'terrain', style: stylized, defines, uniforms,
    fragmentPars: TERRAIN_FRAGMENT_PARS, albedo: TERRAIN_ALBEDO,
    vertexPars: TERRAIN_VERTEX_PARS, vertexMain: TERRAIN_VERTEX_MAIN,
  });
}
