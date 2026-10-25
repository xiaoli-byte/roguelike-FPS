// 灵火破晓 · 风格化着色器公共输入（所有 Pass 共用同一个 UnityPerMaterial，保证 SRP Batcher 兼容）
#ifndef SF_STYLIZED_INPUT_INCLUDED
#define SF_STYLIZED_INPUT_INCLUDED

#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/SurfaceInput.hlsl"

CBUFFER_START(UnityPerMaterial)
    float4 _BaseMap_ST;
    half4  _BaseColor;
    half4  _Tint;
    half   _Cutoff;
    half   _BumpScale;
    half   _Metallic;
    half   _Roughness;
    half   _OcclusionStrength;
    half4  _EmissionColor;
    // 风格化光照
    half4  _ShadowTint;
    half   _RampThreshold;
    half   _RampSoftness;
    half   _ShadowLift;
    half   _AmbientStrength;
    half   _SpecStrength;
    half   _SpecSize;
    half4  _RimColor;
    half   _RimPower;
    half   _RimStrength;
    // 运行时状态（受击闪白 / 词缀着色可用 MaterialPropertyBlock 覆盖）
    half4  _FlashColor;
    half   _FlashAmount;
    // 毛发细节（_FUR；画质「中」以上由全局 _SFFurDetail 打开）
    float  _FurDensity;
    half   _FurDetailStrength;
    half   _FurSheen;
    half   _FurFuzz;
    // 材质变体（EnemyVariant，沙魇的沙化 + 裂纹发光；MaterialPropertyBlock 覆盖，x = y = 0 时整段跳过、输出不变）
    half4  _VariantParams;     // x = 沙化 0..1，y = 裂纹 0..1，z = 裂纹密度（每 UV 单位的格数），w = 裂纹脉动角频率
    half4  _VariantSandColor;
    half4  _VariantCrackColor; // HDR：裂缝里透出的光
    // 溶解（FX2 死亡化灰 / 出生显形：DeathDissolve、SpawnMaterialize 用 MaterialPropertyBlock 覆盖；x = 0 时整段跳过、输出不变）
    half4  _DissolveParams;    // x = 溶解量 0..1（0 完整、1 全没），y = 发光前沿宽度，z = 噪声密度（每 UV 单位的格数），w = 高度渐变的权重 0..1
    float4 _DissolvePlane;     // x = 渐变起点的世界高度，y = 每米的变化量（负 = 上面先溶 / 下面先显形），zw 未用
    half4  _DissolveEdgeColor; // HDR：溶解前沿的发光
    // 发光遮罩（FX3 _E：R / G / B = 三个发光层的范围，GlowMask 用 MaterialPropertyBlock 写「层色 × 强度」；三个颜色全黑时整段跳过、输出不变）
    half4  _GlowMaskColor0;    // HDR
    half4  _GlowMaskColor1;
    half4  _GlowMaskColor2;
    half4  _GlowMaskShimmer;   // xyz = 三层的闪烁幅度 0..1（冰里流动的光），w = 噪声频率（每米）
CBUFFER_END

TEXTURE2D(_ORMMap);     SAMPLER(sampler_ORMMap);
TEXTURE2D(_GlowMask);   SAMPLER(sampler_GlowMask);

// 溶解场：返回到溶解前沿的「距离」（< 0 的像素被溶掉，调用方 clip）。UV 空间的两层值噪声（蒙皮网格上图案跟着身体走、不游动），
// 再按权重混进世界高度渐变；溶解量 0 时恒为正（没有像素被裁），1 时恒为负。所有 Pass 共用，阴影 / 深度跟着一起溶。
float SFDissolveHash(float2 p)
{
    p = frac(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return frac(p.x * p.y);
}

float SFDissolveNoise(float2 p)
{
    float2 i = floor(p), f = frac(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = SFDissolveHash(i), b = SFDissolveHash(i + float2(1, 0)), c = SFDissolveHash(i + float2(0, 1)), d = SFDissolveHash(i + float2(1, 1));
    return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
}

half SFDissolveField(float2 uv, float3 positionWS)
{
    float2 p = uv * max(1.0, (float)_DissolveParams.z);
    float n = SFDissolveNoise(p) * 0.65 + SFDissolveNoise(p * 2.7 + 17.1) * 0.35;
    float g = saturate((positionWS.y - _DissolvePlane.x) * _DissolvePlane.y);
    float v = lerp(n, g * 0.8 + n * 0.2, saturate((float)_DissolveParams.w));
    float t = (float)_DissolveParams.x * 1.08 - 0.04;
    return (half)(v - t);
}

#endif
