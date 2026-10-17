// 灵火破晓 · 风格化地形（Unity Terrain 材质）
// 与 StylizedLit 同一套光照（SF_StylizedShading.hlsl）。地表 4 层（分层图 _ControlMap + _Layer0..3）：
//   - 高度混合：各层贴图的 Alpha 存高度，过渡处按「谁更高谁露出来」咬合（沙子填进砾石缝里，而不是两层半透明叠在一起）
//   - 宏观色斑：世界空间的大尺度噪声调亮 / 调暗，压掉近处一眼可见的平铺重复
//   - 坡度描边：陡坡（崖面、沙丘背风面）按坡度压暗一点，地形起伏更好读
// 地形关闭 drawInstanced（顶点直接带法线），basemapDistance 拉远（始终用本着色器，不用远处的 basemap）。
Shader "Spiritfire/StylizedTerrain"
{
    Properties
    {
        // 分层图与四层贴图由 LevelKit.TerrainMaterial 显式绑定（TerrainData 的 alphamap 纹理，编辑器里刷地表时实时更新），
        // 不依赖 Terrain 内部注入的 _Control / _Splat（自定义着色器拿不到可靠的 _Control_TexelSize）
        [NoScaleOffset] _ControlMap("Control (RGBA)", 2D) = "red" {}
        [NoScaleOffset] _Layer0("Layer 0 (R)", 2D) = "grey" {}
        [NoScaleOffset] _Layer1("Layer 1 (G)", 2D) = "grey" {}
        [NoScaleOffset] _Layer2("Layer 2 (B)", 2D) = "grey" {}
        [NoScaleOffset] _Layer3("Layer 3 (A, triplanar)", 2D) = "grey" {}
        _LayerTile("Layer Tile Size (m)", Vector) = (9, 5, 7, 8)

        [Header(Blending)]
        _HeightBlend("Height Blend Strength", Range(0, 2)) = 0.8
        _HeightBlendDepth("Height Blend Depth", Range(0.01, 1)) = 0.2
        _MacroTex("Macro Variation", 2D) = "grey" {}
        _MacroScale("Macro Scale (m)", Float) = 60
        _MacroStrength("Macro Strength", Range(0, 0.6)) = 0.18
        _SlopeDarken("Slope Darken", Range(0, 1)) = 0.25
        _RockScale("Rock Layer Triplanar Size (m)", Float) = 8

        [Header(Stylized Lighting)]
        _ShadowTint("Shadow Tint", Color) = (0.66, 0.62, 0.82, 1)
        _RampThreshold("Ramp Threshold", Range(-1,1)) = 0.0
        _RampSoftness("Ramp Softness", Range(0.001,1)) = 0.3
        _ShadowLift("Shadow Lift", Range(0,1)) = 0.22
        _AmbientStrength("Ambient Strength", Range(0,2)) = 1
        _RimColor("Rim Color", Color) = (1, 0.92, 0.8, 1)
        _RimPower("Rim Power", Range(0.5,8)) = 5
        _RimStrength("Rim Strength", Range(0,2)) = 0.05
    }

    SubShader
    {
        Tags { "Queue"="Geometry-100" "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" "TerrainCompatible"="True" }

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        CBUFFER_START(UnityPerMaterial)
            float4 _LayerTile;
            half _HeightBlend, _HeightBlendDepth, _MacroScale, _MacroStrength, _SlopeDarken, _RockScale;
            half4 _ShadowTint, _RimColor;
            half _RampThreshold, _RampSoftness, _ShadowLift, _AmbientStrength, _RimPower, _RimStrength;
        CBUFFER_END
        TEXTURE2D(_ControlMap); SAMPLER(sampler_ControlMap);
        TEXTURE2D(_Layer0);     SAMPLER(sampler_Layer0);
        TEXTURE2D(_Layer1);
        TEXTURE2D(_Layer2);
        TEXTURE2D(_Layer3);
        TEXTURE2D(_MacroTex);   SAMPLER(sampler_MacroTex);
        ENDHLSL

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode"="UniversalForward" }

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fragment _ _SCREEN_SPACE_OCCLUSION
            #pragma multi_compile _ _LIGHT_LAYERS
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/RenderingLayers.hlsl"
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "SF_StylizedShading.hlsl"

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                half3 normalWS : TEXCOORD2;
                half4 fogAndVertexLight : TEXCOORD3;
            };

            Varyings Vert(Attributes v)
            {
                Varyings o;
                VertexPositionInputs p = GetVertexPositionInputs(v.positionOS.xyz);
                o.positionCS = p.positionCS;
                o.positionWS = p.positionWS;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.uv = v.uv;
                o.fogAndVertexLight = half4(ComputeFogFactor(p.positionCS.z), VertexLighting(p.positionWS, o.normalWS));
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                // 分层图用地形网格 UV（0–1 覆盖整块地形）；各层按世界坐标平铺（米 / 张），与地形尺寸无关
                half4 ctrl = SAMPLE_TEXTURE2D(_ControlMap, sampler_ControlMap, i.uv);
                float2 wuv = i.positionWS.xz;
                half4 c0 = SAMPLE_TEXTURE2D(_Layer0, sampler_Layer0, wuv / _LayerTile.x);
                half4 c1 = SAMPLE_TEXTURE2D(_Layer1, sampler_Layer0, wuv / _LayerTile.y);
                half4 c2 = SAMPLE_TEXTURE2D(_Layer2, sampler_Layer0, wuv / _LayerTile.z);
                // 第 4 层（岩石 / 崖面）三平面投影：地形 UV 在陡坡上会被拉成长条，侧面改用世界坐标投影，层理沿高度方向保持水平
                half3 nAbs = abs(normalize(i.normalWS));
                half3 tw = pow(nAbs, 4); tw /= (tw.x + tw.y + tw.z);
                float2 rx = float2(i.positionWS.z, i.positionWS.y) / _RockScale, rz = float2(i.positionWS.x, i.positionWS.y) / _RockScale;
                half4 c3 = SAMPLE_TEXTURE2D(_Layer3, sampler_Layer0, rx) * tw.x + SAMPLE_TEXTURE2D(_Layer3, sampler_Layer0, rz) * tw.z
                         + SAMPLE_TEXTURE2D(_Layer3, sampler_Layer0, wuv / _LayerTile.w) * tw.y;

                // 高度混合：权重 + 高度，只保留最高的一段（深度 _HeightBlendDepth 内）
                half4 hw = ctrl + half4(c0.a, c1.a, c2.a, c3.a) * _HeightBlend * step(0.001, ctrl);
                half top = max(max(hw.x, hw.y), max(hw.z, hw.w)) - _HeightBlendDepth;
                half4 b = max(hw - top, 0);
                b /= max(1e-4, b.x + b.y + b.z + b.w);
                half3 albedo = c0.rgb * b.x + c1.rgb * b.y + c2.rgb * b.z + c3.rgb * b.w;

                // 宏观色斑 + 坡度压暗
                half macro = SAMPLE_TEXTURE2D(_MacroTex, sampler_MacroTex, i.positionWS.xz / _MacroScale).r;
                albedo *= 1.0 + (macro - 0.5) * 2.0 * _MacroStrength;
                half3 N = normalize(i.normalWS);
                albedo *= 1.0 - _SlopeDarken * smoothstep(0.55, 0.9, 1.0 - N.y);

                StylizedStyle st;
                st.shadowTint = _ShadowTint.rgb; st.rampThreshold = _RampThreshold; st.rampSoftness = _RampSoftness;
                st.shadowLift = _ShadowLift; st.ambient = _AmbientStrength; st.specStrength = 0; st.specSize = 0.1;
                st.rimColor = _RimColor.rgb; st.rimPower = _RimPower; st.rimStrength = _RimStrength;
                half mainLit;
                half3 color = SFShade(albedo, N, i.positionWS, i.positionCS, 1, 0, 1, i.fogAndVertexLight.yzw, i.fogAndVertexLight.x, st, mainLit);
                return half4(MixFog(color, i.fogAndVertexLight.x), 1);
            }
            ENDHLSL
        }

        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode"="ShadowCaster" }
            ZWrite On ZTest LEqual ColorMask 0

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex ShadowVert
            #pragma fragment ShadowFrag
            #pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"
            float3 _LightDirection, _LightPosition;
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            float4 ShadowVert(Attributes v) : SV_POSITION
            {
                float3 p = TransformObjectToWorld(v.positionOS.xyz);
                float3 n = TransformObjectToWorldNormal(v.normalOS);
                #if _CASTING_PUNCTUAL_LIGHT_SHADOW
                float3 l = normalize(_LightPosition - p);
                #else
                float3 l = _LightDirection;
                #endif
                return ApplyShadowClamping(TransformWorldToHClip(ApplyShadowBias(p, n, l)));
            }
            half4 ShadowFrag() : SV_Target { return 0; }
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode"="DepthOnly" }
            ZWrite On ColorMask R
            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex DepthVert
            #pragma fragment DepthFrag
            float4 DepthVert(float4 positionOS : POSITION) : SV_POSITION { return TransformObjectToHClip(positionOS.xyz); }
            half DepthFrag(float4 positionCS : SV_POSITION) : SV_Target { return positionCS.z; }
            ENDHLSL
        }

        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode"="DepthNormals" }
            ZWrite On
            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex DNVert
            #pragma fragment DNFrag
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/RenderingLayers.hlsl"
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct Varyings { float4 positionCS : SV_POSITION; half3 normalWS : TEXCOORD0; };
            Varyings DNVert(Attributes v)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                return o;
            }
            void DNFrag(Varyings i, out half4 outNormalWS : SV_Target0
            #ifdef _WRITE_RENDERING_LAYERS
                , out uint outRenderingLayers : SV_Target1
            #endif
            )
            {
                outNormalWS = half4(NormalizeNormalPerPixel(i.normalWS), 0);
                #ifdef _WRITE_RENDERING_LAYERS
                outRenderingLayers = EncodeMeshRenderingLayer();
                #endif
            }
            ENDHLSL
        }
    }
    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
