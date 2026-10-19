// 灵火破晓 · 壳层毛发 / 羽毛（画质「高」）
// FurShells 给 LOD0 的蒙皮渲染器追加 N 个本材质的副本（_ShellIndex = 0..N-1），每个副本把同一个已蒙皮的网格
// 沿法线推出 (i+1)/N × _FurLength × 遮罩，再顺毛向梳、按重力下垂，片元按绑定空间的发丝图案裁掉（SF_Fur.hlsl）。
// 光照与身体同一套风格化模型（SFShade），明暗交界更软；根部压暗、发梢提亮，剪影上是一圈蓬松的毛边。
// 只有 UniversalForward：壳层不投影、不进深度 / 法线预通道（SSAO 只看身体）。
// 受击闪白、词缀着色（_FlashAmount / _Tint）由渲染器上的 MaterialPropertyBlock 统一给到每一层。
Shader "Spiritfire/FurShell"
{
    Properties
    {
        [MainTexture] _BaseMap("Base Color (BC)", 2D) = "white" {}
        [MainColor] _BaseColor("Base Color", Color) = (1,1,1,1)
        _Tint("Instance Tint", Color) = (1,1,1,1)
        _ORMMap("ORM (R=AO)", 2D) = "white" {}

        [Header(Fur)]
        _FurLength("Length (m)", Float) = 0.02
        _FurDensity("Strand Density (per m)", Float) = 150
        _FurThickness("Strand Thickness (cell)", Range(0.05, 0.3)) = 0.27
        _FurStretch("Strand Stretch Along Flow", Range(0.1, 1)) = 0.4
        _FurFacing("Front-facing Thinning", Range(0, 1)) = 0.6
        _FurComb("Comb Along Flow", Range(0, 2)) = 0.8
        _FurDroop("Gravity Droop", Range(0, 2)) = 0.4
        _FurRootShade("Root Shade", Range(0, 1)) = 0.6
        _FurTipLight("Tip Light", Range(0, 1)) = 0.12
        _ShellIndex("Shell Index", Float) = 0
        _ShellCount("Shell Count", Float) = 8

        [Header(Stylized Lighting)]
        _ShadowTint("Shadow Tint", Color) = (0.58, 0.6, 0.86, 1)
        _RampThreshold("Ramp Threshold", Range(-1,1)) = 0.05
        _RampSoftness("Ramp Softness", Range(0.001,1)) = 0.35
        _ShadowLift("Shadow Lift", Range(0,1)) = 0.2
        _AmbientStrength("Ambient Strength", Range(0,2)) = 1
        _RimColor("Rim Color", Color) = (1, 0.92, 0.78, 1)
        _RimPower("Rim Power", Range(0.5,8)) = 2.5
        _RimStrength("Rim Strength", Range(0,2)) = 0.6

        [Header(Runtime)]
        _FlashColor("Flash Color", Color) = (1,1,1,1)
        _FlashAmount("Flash Amount", Range(0,1)) = 0
    }

    SubShader
    {
        Tags { "RenderType"="TransparentCutout" "RenderPipeline"="UniversalPipeline" "Queue"="AlphaTest+10" }
        LOD 300

        Pass
        {
            Name "FurShell"
            Tags { "LightMode"="UniversalForward" }
            ZWrite On
            Cull Back

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag

            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fragment _ _SCREEN_SPACE_OCCLUSION
            #pragma multi_compile_fragment _ _LIGHT_COOKIES
            #pragma multi_compile _ _LIGHT_LAYERS
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/RenderingLayers.hlsl"
            #pragma multi_compile _ SHADOWS_SHADOWMASK
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4  _BaseColor;
                half4  _Tint;
                float  _FurLength;
                float  _FurDensity;
                half   _FurThickness;
                half   _FurStretch;
                half   _FurFacing;
                half   _FurComb;
                half   _FurDroop;
                half   _FurRootShade;
                half   _FurTipLight;
                float  _ShellIndex;
                float  _ShellCount;
                half4  _ShadowTint;
                half   _RampThreshold;
                half   _RampSoftness;
                half   _ShadowLift;
                half   _AmbientStrength;
                half4  _RimColor;
                half   _RimPower;
                half   _RimStrength;
                half4  _FlashColor;
                half   _FlashAmount;
            CBUFFER_END

            TEXTURE2D(_BaseMap); SAMPLER(sampler_BaseMap);
            TEXTURE2D(_ORMMap);  SAMPLER(sampler_ORMMap);

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"
            #include "SF_StylizedShading.hlsl"
            #include "SF_Fur.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float4 tangentOS  : TANGENT;
                float2 uv         : TEXCOORD0;
                float4 furBind    : TEXCOORD2;
                float4 furFlow    : TEXCOORD3;
                float3 furFlowBind : TEXCOORD4;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv         : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                half3  normalWS   : TEXCOORD2;
                float3 furBind    : TEXCOORD3;
                half   furMask    : TEXCOORD4;
                half4  fogAndVertexLight : TEXCOORD5;
                half3  furFlowBind : TEXCOORD6;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            float ShellHeight() { return (_ShellIndex + 1.0) / max(_ShellCount, 1.0); }

            Varyings Vert(Attributes input)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

                float h = ShellHeight();
                float len = _FurLength * input.furFlow.z;
                float3 n = SafeNormalize(input.normalOS);
                float3 b = cross(n, input.tangentOS.xyz) * input.tangentOS.w;
                float3 comb = input.furFlow.x * input.tangentOS.xyz + input.furFlow.y * b;
                float3 gravity = TransformWorldToObjectDir(float3(0, -1, 0));
                // 发梢弯得比根部多（h 的平方）：顺毛向梳 + 重力下垂
                float3 posOS = input.positionOS.xyz + (n * h + (comb * _FurComb + gravity * _FurDroop) * (h * h)) * len;

                VertexPositionInputs pos = GetVertexPositionInputs(posOS);
                VertexNormalInputs nrm = GetVertexNormalInputs(input.normalOS, input.tangentOS);
                o.positionCS = pos.positionCS;
                o.positionWS = pos.positionWS;
                o.normalWS = nrm.normalWS;
                o.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                o.furBind = input.furBind.xyz;
                o.furMask = input.furFlow.z;
                o.furFlowBind = input.furFlowBind;
                o.fogAndVertexLight = half4(ComputeFogFactor(pos.positionCS.z), VertexLighting(pos.positionWS, nrm.normalWS));
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                half h = ShellHeight();
                clip(i.furMask - 0.08);
                // 正对镜头的面只留最长的发丝（俯看发丝是一颗颗点，像砂纸），剪影处给满：毛感集中在轮廓上
                half3 N = SafeNormalize(i.normalWS);
                half facing = saturate(dot(N, GetWorldSpaceNormalizeViewDir(i.positionWS)));
                half hEff = saturate(h + _FurFacing * facing * facing * (1.0 - h));
                clip(SFFurCoverage(i.furBind, SafeNormalize(i.furFlowBind), _FurDensity, hEff, _FurThickness, _FurStretch));
                #if defined(LOD_FADE_CROSSFADE)
                LODFadeCrossFade(i.positionCS);
                #endif

                half3 albedo = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).rgb * _BaseColor.rgb * _Tint.rgb;
                half ao = SAMPLE_TEXTURE2D(_ORMMap, sampler_ORMMap, i.uv).r;
                // 根部压暗（毛丛里的自遮挡）、发梢提亮
                albedo *= lerp(_FurRootShade * lerp(1.0, ao, 0.5), 1.0 + _FurTipLight, h);

                StylizedStyle st;
                st.shadowTint = _ShadowTint.rgb; st.rampThreshold = _RampThreshold; st.rampSoftness = _RampSoftness;
                st.shadowLift = _ShadowLift; st.ambient = _AmbientStrength; st.specStrength = 0; st.specSize = 0.1;
                st.rimColor = _RimColor.rgb; st.rimPower = _RimPower; st.rimStrength = _RimStrength * h;
                half mainLit;
                half3 color = SFShade(albedo, N, i.positionWS, i.positionCS, 1.0, 0.0, 1.0, i.fogAndVertexLight.yzw,
                                      i.fogAndVertexLight.x, st, mainLit);
                color = lerp(color, _FlashColor.rgb, _FlashAmount);
                color = MixFog(color, i.fogAndVertexLight.x);
                return half4(color, 1);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
