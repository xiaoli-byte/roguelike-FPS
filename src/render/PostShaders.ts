/**
 * 后处理各遍的 GLSL，逐段照 URP 17.5 的着色器（路径见 UrpColor.ts 开头）：
 *   Bloom.shader       FragPrefilter（LQ）/ FragBlurH / FragBlurV / FragUpsample（Gaussian 金字塔）
 *   LutBuilderLdr      调色 LUT（32³ 条带）
 *   UberPost.shader    色差 → 泛光 → 暗角 → 后曝光 → 色调映射（Neutral）→ LUT → sRGB
 * 输入的场景缓冲是 sRGB 编码过的 HDR（PostStack 的说明），每次取样先解码回线性，再按 alpha（枪模覆盖率）补第一人称曝光。
 */

export const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = position.xy * 0.5 + 0.5;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/** 场景缓冲的取样：sRGB → 线性（three 的 sRGBTransferOETF 的逆，> 1 照样外推），再按枪模覆盖率乘第一人称曝光 */
const SCENE_SAMPLE = /* glsl */ `
uniform sampler2D tColor;
uniform vec4 uFp; // x 系数, y 伽马, z 这一帧画了枪模（0 / 1）
vec3 sfDecode( vec3 c ) {
	c = max( c, vec3( 0.0 ) );
	return mix( pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), c / 12.92, vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) );
}
// FirstPersonView：颜色 = 系数 × 颜色^伽马（SF_StylizedLit 末尾，只在画 FirstPerson 层时）。这里按覆盖率在像素上补
vec3 sfFirstPerson( vec3 c, float a ) {
	a = clamp( a, 0.0, 1.0 ) * uFp.z;
	return a > 0.0 ? mix( c, uFp.x * pow( c, vec3( uFp.y ) ), a ) : c;
}
vec3 sceneColor( vec2 uv ) {
	vec4 s = texture2D( tColor, uv );
	return sfFirstPerson( sfDecode( s.rgb ), s.a );
}
`;

export const PREFILTER_FRAGMENT = /* glsl */ `
${SCENE_SAMPLE}
uniform vec2 uTexel;  // 源（全分辨率）一个像素
uniform vec4 uParams; // x 散射, y 上限, z 门槛（线性）, w 软膝
varying vec2 vUv;
void main() {
	// URP 的 LQ 版是目标像素中心一次双线性取样 = 源上 2×2 的平均；这里先解码再平均（缓冲是 sRGB 编码的）
	vec3 color = 0.25 * ( sceneColor( vUv + uTexel * vec2( -0.5, -0.5 ) ) + sceneColor( vUv + uTexel * vec2( 0.5, -0.5 ) )
		+ sceneColor( vUv + uTexel * vec2( -0.5, 0.5 ) ) + sceneColor( vUv + uTexel * vec2( 0.5, 0.5 ) ) );
	color = min( vec3( uParams.y ), color );
	float brightness = max( color.r, max( color.g, color.b ) );
	float softness = clamp( brightness - uParams.z + uParams.w, 0.0, 2.0 * uParams.w );
	softness = ( softness * softness ) / ( 4.0 * uParams.w + 1e-4 );
	float multiplier = max( brightness - uParams.z, softness ) / max( brightness, 1e-4 );
	color *= multiplier;
	gl_FragColor = vec4( max( color, vec3( 0.0 ) ), 1.0 );
}
`;

export const BLUR_H_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel; // 源（上一级，大一倍）一个像素
varying vec2 vUv;
void main() {
	float t = uTexel.x * 2.0;
	vec3 c = texture2D( tSource, vUv - vec2( t * 4.0, 0.0 ) ).rgb * 0.01621622
		+ texture2D( tSource, vUv - vec2( t * 3.0, 0.0 ) ).rgb * 0.05405405
		+ texture2D( tSource, vUv - vec2( t * 2.0, 0.0 ) ).rgb * 0.12162162
		+ texture2D( tSource, vUv - vec2( t, 0.0 ) ).rgb * 0.19459459
		+ texture2D( tSource, vUv ).rgb * 0.22702703
		+ texture2D( tSource, vUv + vec2( t, 0.0 ) ).rgb * 0.19459459
		+ texture2D( tSource, vUv + vec2( t * 2.0, 0.0 ) ).rgb * 0.12162162
		+ texture2D( tSource, vUv + vec2( t * 3.0, 0.0 ) ).rgb * 0.05405405
		+ texture2D( tSource, vUv + vec2( t * 4.0, 0.0 ) ).rgb * 0.01621622;
	gl_FragColor = vec4( c, 1.0 );
}
`;

export const BLUR_V_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel; // 源（同尺寸）一个像素
varying vec2 vUv;
void main() {
	vec3 c = texture2D( tSource, vUv - vec2( 0.0, uTexel.y * 3.23076923 ) ).rgb * 0.07027027
		+ texture2D( tSource, vUv - vec2( 0.0, uTexel.y * 1.38461538 ) ).rgb * 0.31621622
		+ texture2D( tSource, vUv ).rgb * 0.22702703
		+ texture2D( tSource, vUv + vec2( 0.0, uTexel.y * 1.38461538 ) ).rgb * 0.31621622
		+ texture2D( tSource, vUv + vec2( 0.0, uTexel.y * 3.23076923 ) ).rgb * 0.07027027;
	gl_FragColor = vec4( c, 1.0 );
}
`;

export const UPSAMPLE_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;    // 高一级（同尺寸）
uniform sampler2D tLow;       // 低一级（小一半，双线性放大）
uniform float uScatter;
varying vec2 vUv;
void main() {
	gl_FragColor = vec4( mix( texture2D( tSource, vUv ).rgb, texture2D( tLow, vUv ).rgb, uScatter ), 1.0 );
}
`;

/** LutBuilderLdr（SplitToning / ChannelMixer / 曲线按默认值：恒等，曲线夹到 127 / 128） */
export const LUT_FRAGMENT = /* glsl */ `
uniform vec4 uLutParams;      // x 高, y 0.5 / 宽, z 0.5 / 高, w 高 / (高 − 1)
uniform vec3 uColorBalance;
uniform vec3 uColorFilter;
uniform vec3 uHueSatCon;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform vec3 uShadows;
uniform vec3 uMidtones;
uniform vec3 uHighlights;
uniform vec4 uShaHiLimits;

const float LOGC_A = 5.555556, LOGC_B = 0.047996, LOGC_C = 0.244161, LOGC_D = 0.386036;
const float ACESCC_MIDGRAY = 0.4135884;

vec3 linearToLogC( vec3 x ) {
	// log10；max 的下限给一个极小正数（GLSL 里 log(0) 没有定义，结果和 −∞ 一样：最后夹成 0）
	return LOGC_C * ( log2( max( LOGC_A * x + LOGC_B, vec3( 1e-10 ) ) ) * 0.30102999566 ) + LOGC_D;
}
vec3 logCToLinear( vec3 x ) {
	return ( pow( vec3( 10.0 ), ( x - LOGC_D ) / LOGC_C ) - LOGC_B ) / LOGC_A;
}
float sfLuminance( vec3 c ) {
	return dot( c, vec3( 0.2126729, 0.7151522, 0.0721750 ) );
}
vec3 rgbToHsv( vec3 c ) {
	const vec4 K = vec4( 0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0 );
	vec4 p = mix( vec4( c.bg, K.wz ), vec4( c.gb, K.xy ), step( c.b, c.g ) );
	vec4 q = mix( vec4( p.xyw, c.r ), vec4( c.r, p.yzx ), step( p.x, c.r ) );
	float d = q.x - min( q.w, q.y );
	const float e = 1.0e-4;
	return vec3( abs( q.z + ( q.w - q.y ) / ( 6.0 * d + e ) ), d / ( q.x + e ), q.x );
}
vec3 hsvToRgb( vec3 c ) {
	const vec4 K = vec4( 1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0 );
	vec3 p = abs( fract( c.xxx + K.xyz ) * 6.0 - K.www );
	return c.z * mix( K.xxx, clamp( p - K.xxx, 0.0, 1.0 ), c.y );
}
float rotateHue( float value, float low, float hi ) {
	return value < low ? value + hi : ( value > hi ? value - hi : value );
}

void main() {
	// GetLutStripValue
	vec2 uv = gl_FragCoord.xy / vec2( uLutParams.x * uLutParams.x, uLutParams.x );
	uv.x *= uLutParams.x;
	float lutBase = floor( uv.x );
	uv.x -= lutBase;
	vec3 colorLinear = vec3( uv - uLutParams.zz, lutBase * 2.0 * uLutParams.z ) * uLutParams.w;

	// 白平衡（LMS）
	const mat3 LIN_2_LMS = mat3( 3.90405e-1, 7.08416e-2, 2.31082e-2, 5.49941e-1, 9.63172e-1, 1.28021e-1, 8.92632e-3, 1.35775e-3, 9.36245e-1 );
	const mat3 LMS_2_LIN = mat3( 2.85847e+0, -2.10182e-1, -4.18120e-2, -1.62879e+0, 1.15820e+0, -1.18169e-1, -2.48910e-2, 3.24281e-4, 1.06867e+0 );
	colorLinear = LMS_2_LIN * ( ( LIN_2_LMS * colorLinear ) * uColorBalance );

	// 对比（LogC 里绕中灰）
	vec3 colorLog = linearToLogC( colorLinear );
	colorLog = ( colorLog - ACESCC_MIDGRAY ) * uHueSatCon.z + ACESCC_MIDGRAY;
	colorLinear = logCToLinear( colorLog );

	colorLinear *= uColorFilter;
	colorLinear = max( vec3( 0.0 ), colorLinear );

	// 阴影 / 中间调 / 高光
	float luma = sfLuminance( colorLinear );
	float shadowsFactor = 1.0 - smoothstep( uShaHiLimits.x, uShaHiLimits.y, luma );
	float highlightsFactor = smoothstep( uShaHiLimits.z, uShaHiLimits.w, luma );
	float midtonesFactor = 1.0 - shadowsFactor - highlightsFactor;
	colorLinear = colorLinear * uShadows * shadowsFactor + colorLinear * uMidtones * midtonesFactor + colorLinear * uHighlights * highlightsFactor;

	// Lift / Gamma / Gain
	colorLinear = colorLinear * uGain + uLift;
	colorLinear = sign( colorLinear ) * pow( abs( colorLinear ), uGamma );

	// 色相偏移（曲线默认：偏移 0，饱和倍率 1）
	vec3 hsv = rgbToHsv( colorLinear );
	hsv.x = rotateHue( hsv.x + uHueSatCon.x, 0.0, 1.0 );
	colorLinear = hsvToRgb( hsv );

	// 全局饱和度
	luma = sfLuminance( colorLinear );
	colorLinear = vec3( luma ) + uHueSatCon.y * ( colorLinear - vec3( luma ) );

	gl_FragColor = vec4( clamp( colorLinear, 0.0, 127.0 / 128.0 ), 1.0 );
}
`;

/** UberPost（LDR 调色档）。定义 VM_PASS 时只出枪模覆盖到的像素（alpha = 覆盖率），叠在光柱之上 */
export const UBER_FRAGMENT = /* glsl */ `
${SCENE_SAMPLE}
uniform sampler2D tBloom;
uniform sampler2D tLut;
uniform vec4 uBloom;      // x 强度, yzw 色调（线性、按亮度归一）
uniform float uBloomOn;
uniform float uChroma;    // 色差强度 × 0.05
uniform vec4 uVignette1;  // rgb 颜色, w 圆度
uniform vec4 uVignette2;  // xy 中心, z 强度 × 3, w 柔和 × 5
uniform vec4 uLutParams;  // x 1 / 宽, y 1 / 高, z 高 − 1, w 后曝光（线性倍数）
uniform float uTonemap;   // 1 = Neutral
varying vec2 vUv;

vec3 neutralCurve( vec3 x ) {
	const float a = 0.2, b = 0.29, c = 0.24, d = 0.272, e = 0.02, f = 0.3;
	return ( ( x * ( a * x + c * b ) + d * e ) / ( x * ( a * x + b ) + d * f ) ) - e / f;
}
vec3 neutralTonemap( vec3 x ) {
	x = max( vec3( 0.0 ), x );
	const float whiteLevel = 5.3;
	vec3 whiteScale = vec3( 1.0 ) / neutralCurve( vec3( whiteLevel ) );
	x = neutralCurve( x * whiteScale );
	return x * whiteScale;
}
vec3 applyLut2D( vec3 uvw, vec3 scaleOffset ) {
	uvw.z *= scaleOffset.z;
	float shift = floor( uvw.z );
	uvw.xy = uvw.xy * scaleOffset.z * scaleOffset.xy + scaleOffset.xy * 0.5;
	uvw.x += shift * scaleOffset.y;
	return mix( texture2D( tLut, uvw.xy ).rgb, texture2D( tLut, uvw.xy + vec2( scaleOffset.y, 0.0 ) ).rgb, uvw.z - shift );
}
vec3 linearToSrgb( vec3 c ) {
	return mix( 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, c * 12.9232102, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
}

void main() {
	vec2 uv = vUv;
	vec4 source = texture2D( tColor, uv );
	vec3 color = sfFirstPerson( sfDecode( source.rgb ), source.a );

	if ( uChroma > 0.0 ) {
		vec2 coords = 2.0 * uv - 1.0;
		vec2 end = uv - coords * dot( coords, coords ) * uChroma;
		vec2 delta = ( end - uv ) / 3.0;
		color = vec3( color.r, sceneColor( delta + uv ).g, sceneColor( delta * 2.0 + uv ).b );
	}

	if ( uBloomOn > 0.0 ) color += texture2D( tBloom, uv ).rgb * uBloom.x * uBloom.yzw;

	if ( uVignette2.z > 0.0 ) {
		vec2 dist = abs( uv - uVignette2.xy ) * uVignette2.z;
		dist.x *= uVignette1.w;
		float vfactor = pow( clamp( 1.0 - dot( dist, dist ), 0.0, 1.0 ), uVignette2.w );
		color *= mix( uVignette1.rgb, vec3( 1.0 ), vfactor );
	}

	color *= uLutParams.w;
	if ( uTonemap > 0.5 ) color = neutralTonemap( color );
	color = clamp( color, 0.0, 1.0 );
	color = applyLut2D( color, uLutParams.xyz );
	color = linearToSrgb( color );

	#ifdef VM_PASS
	float a = clamp( source.a, 0.0, 1.0 ) * uFp.z;
	if ( a < 0.004 ) discard;
	gl_FragColor = vec4( color, a );
	#else
	gl_FragColor = vec4( color, 1.0 );
	#endif
}
`;

/** 画枪模之前把场景缓冲的 alpha 清成 0（颜色不动）：之后 alpha = 枪模覆盖率 */
export const ALPHA_CLEAR_FRAGMENT = /* glsl */ `
void main() {
	gl_FragColor = vec4( 0.0 );
}
`;
