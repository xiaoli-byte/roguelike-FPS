#ifndef SPIRITFIRE_GUNFIRE_ORIGINAL_INPUT
#define SPIRITFIRE_GUNFIRE_ORIGINAL_INPUT

CBUFFER_START(UnityPerMaterial)
    float4 _MainTex_ST, _Color, _SpecColor, _EmissionColor, _OutlineColor;
    float _WorkflowMode, _Metallic, _Glossiness, _GlossMapScale;
    float _OcclusionStrength, _ReflectionRatio, _MainLightIntensity, _AdditionLightIntensity;
    float _OutlineWidth, _Cull, _ZWrite, _ZTest, _SrcBlend, _DstBlend;
CBUFFER_END

#endif
