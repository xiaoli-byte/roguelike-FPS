// 灵火破晓 · 轮廓发丝面片（fins，画质「中」以上）
// 壳层只在表面朝向镜头时像毛：到了轮廓，壳层之间的缝隙露出来，毛边也薄。经典做法（Lengyel 2001 的 shells + fins）
// 是在网格的每条边上竖一片垂直于表面的发丝面片，只在它接近轮廓时显示。FurBake 在导入时按 LOD1 的边生成这些面片
// （<ID>_FurFins，与本体同一套骨骼和蒙皮权重），这里：
//   顶点：发梢一侧沿法线推出 _FurLength × 遮罩，与壳层同样顺毛梳、按重力下垂；面片法线与视线的夹角给出淡入
//         max(0, 2|p| − 1)，背离轮廓的面片整片收回到根部（退化成线，光栅化前就被丢掉，几乎不占开销）；
//   片元：沿边一格格的锥形发丝（SF_Fur.hlsl 的 SFFurFinAlpha），AlphaToMask 写成柔边，颜色取本体底色，根暗梢亮。
Shader "Spiritfire/FurFin"
{
    Properties
    {
        [MainTexture] _BaseMap("Base Color (BC)", 2D) = "white" {}
        [MainColor] _BaseColor("Base Color", Color) = (1,1,1,1)
        _Tint("Instance Tint", Color) = (1,1,1,1)

        [Header(Fur)]
        _FurLength("Length (m)", Float) = 0.02
        _FinDensity("Strands per m along the edge", Float) = 150
        _FurThickness("Strand Thickness (cell)", Range(0.05, 0.3)) = 0.27
        _FurComb("Comb Along Flow", Range(0, 2)) = 0.8
        _FurDroop("Gravity Droop", Range(0, 2)) = 0.4
        _FurRootShade("Root Shade", Range(0, 1)) = 0.8
        _FurTipLight("Tip Light", Range(0, 1)) = 0.06

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
        Tags { "RenderType"="TransparentCutout" "RenderPipeline"="UniversalPipeline" "Queue"="AlphaTest+5" }
        LOD 300

        Pass
        {
            Name "FurFin"
            Tags { "LightMode"="UniversalForward" }
            ZWrite On
            Cull Off
            AlphaToMask On

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
                float  _FinDensity;
                half   _FurThickness;
                half   _FurComb;
                half   _FurDroop;
                half   _FurRootShade;
                half   _FurTipLight;
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

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"
            #include "SF_StylizedShading.hlsl"
            #include "SF_Fur.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float4 tangentOS  : TANGENT;   // 本体顶点的切线（随蒙皮转动）
                float2 uv         : TEXCOORD0; // 本体贴图 UV（取底色）
                float2 finUV      : TEXCOORD1; // x = 沿边的位置（米），y = 0 根 / 1 梢
                float4 finNormal  : TEXCOORD2; // 面片法线在 (T, B, N) 上的分量
                float4 furFlow    : TEXCOORD3; // 毛向 T / B 分量、遮罩（同本体）
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv         : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                half3  normalWS   : TEXCOORD2;
                float2 finUV      : TEXCOORD3;
                half   fade       : TEXCOORD4;
                half4  fogAndVertexLight : TEXCOORD5;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings Vert(Attributes input)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

                float3 n = SafeNormalize(input.normalOS);
                float3 t = input.tangentOS.xyz;
                float3 b = cross(n, t) * input.tangentOS.w;
                float3 finN = SafeNormalize(input.finNormal.x * t + input.finNormal.y * b + input.finNormal.z * n);
                float3 comb = input.furFlow.x * t + input.furFlow.y * b;
                float3 gravity = TransformWorldToObjectDir(float3(0, -1, 0));
                float mask = input.furFlow.z;

                // 面片法线与视线：正对着看（贴近轮廓）时 |p| → 1，从正面看表面时面片是侧着的，|p| → 0。
                // Tripo 雕出来的毛簇表面起伏大，斜面上的面片也会 |p| 偏大，所以再乘「表面本身侧对视线」：只留真正的轮廓
                float3 baseWS = TransformObjectToWorld(input.positionOS.xyz);
                float3 viewWS = SafeNormalize(GetCameraPositionWS() - baseWS);
                half p = dot(TransformObjectToWorldNormal(finN), viewWS);
                half sil = saturate(1.0 - abs(dot(TransformObjectToWorldNormal(n), viewWS)) * 1.4);
                half fade = saturate((abs(p) - 0.6) / 0.3) * sil * saturate((mask - 0.05) * 10.0);
                // 看不到的面片整片收回到根部：发梢与根重合，三角形退化，光栅化前就被丢掉
                float len = 0.85 * _FurLength * mask * input.finUV.y * step(0.01, fade);
                float3 posOS = input.positionOS.xyz + (n + comb * _FurComb + gravity * _FurDroop) * len;

                VertexPositionInputs pos = GetVertexPositionInputs(posOS);
                VertexNormalInputs nrm = GetVertexNormalInputs(input.normalOS, input.tangentOS);
                o.positionCS = pos.positionCS;
                o.positionWS = pos.positionWS;
                o.normalWS = nrm.normalWS;
                o.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                o.finUV = input.finUV;
                o.fade = fade;
                o.fogAndVertexLight = half4(ComputeFogFactor(pos.positionCS.z), VertexLighting(pos.positionWS, nrm.normalWS));
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                half y = i.finUV.y;
                half alpha = SFFurFinAlpha(i.finUV.x * _FinDensity, y, _FurThickness) * i.fade;
                clip(alpha - 0.01);
                #if defined(LOD_FADE_CROSSFADE)
                LODFadeCrossFade(i.positionCS);
                #endif

                half3 albedo = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).rgb * _BaseColor.rgb * _Tint.rgb;
                albedo *= lerp(_FurRootShade, 1.0 + _FurTipLight, y);

                StylizedStyle st;
                st.shadowTint = _ShadowTint.rgb; st.rampThreshold = _RampThreshold; st.rampSoftness = _RampSoftness;
                st.shadowLift = _ShadowLift; st.ambient = _AmbientStrength; st.specStrength = 0; st.specSize = 0.1;
                st.rimColor = _RimColor.rgb; st.rimPower = _RimPower; st.rimStrength = _RimStrength * y;
                half mainLit;
                half3 color = SFShade(albedo, SafeNormalize(i.normalWS), i.positionWS, i.positionCS, 1.0, 0.0, 1.0,
                                      i.fogAndVertexLight.yzw, i.fogAndVertexLight.x, st, mainLit);
                color = lerp(color, _FlashColor.rgb, _FlashAmount);
                color = MixFog(color, i.fogAndVertexLight.x);
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
