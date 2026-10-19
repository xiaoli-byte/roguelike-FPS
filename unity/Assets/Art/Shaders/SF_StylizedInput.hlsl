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
CBUFFER_END

TEXTURE2D(_ORMMap);     SAMPLER(sampler_ORMMap);

#endif
