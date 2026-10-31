// 第三章砸地的方形裂纹贴花（第二批收尾 C 路，2026-10-31；贴图 T_Fx_CrackCh3 由 scripts/unity/fx_crack_ch3.py 生成，2 × 2 个变体）。
// 熔心魔将跃击 / 竖劈 / 插剑 / 登场落地、第三章精英砸地用：中间压塌的方坑 + 从坑角坑边往外的方折主裂纹 + 一圈断续的方石板缝，
// 裂光铜橙、亮芯白热、两侧紫褐焦边（docs/art/fx-style.md §2.2 第三章：暗紫玄武岩、铜橙余烬、紫褐烟）。
// 投射方式同 SF_FxSigil / SF_FxDecal：URP DecalProjector（Screen Space），深度重建世界坐标、变换到投影盒空间，侧壁按「表面法线 · 投影轴」淡掉。
// 每个投影器自己的参数走 _NormalToWorld：[0][3] = fadeFactor；[3][0..3] = P（DecalProjector 的 uvScale.xy、uvBias.xy）：
//   P.x 进度 0..1（前 3% 裂纹从坑心往外蔓延 → 余热冷却 → 最后 20% 淡出），P.y 变体 0..3，P.z 初始余热 0..1，P.w 狂怒白热 0..1。
// 贴图通道：R 暗边（紫褐焦边 + 坑底）、G 裂光、B 白热中线、A 到坑心的距离（蔓延用）。
// 预乘 alpha（Blend One OneMinusSrcAlpha）：焦边压暗、裂光 HDR 加上去一次画完；裂光不占 alpha。
Shader "Spiritfire/FxCrack"
{
    Properties
    {
        _CrackMap("Crack (R dark, G glow, B hot, A radius)", 2D) = "black" {}
        _DarkColor("Scorch Rim (purple-brown)", Color) = (0.23, 0.14, 0.19, 1)
        _GlowColor("Crack Glow (copper)", Color) = (1, 0.54, 0.18, 1)
        _CoolColor("Cooled Seam (deep copper)", Color) = (0.72, 0.27, 0.1, 1)
        _HotColor("Hot Core (white-hot copper)", Color) = (1, 0.9, 0.65, 1)
        _GlowBoost("Glow HDR", Float) = 1.6
        // URP 贴花系统会读这些（缺了也能跑，留着与 Shader Graph 贴花一致）
        [HideInInspector] _DrawOrder("Draw Order", Range(-50, 50)) = 1
        [HideInInspector] _DecalMeshBiasType("DecalMesh BiasType", Float) = 0
        [HideInInspector] _DecalMeshDepthBias("DecalMesh DepthBias", Float) = 0
        [HideInInspector] _DecalMeshViewBias("DecalMesh ViewBias", Float) = 0
    }

    SubShader
    {
        Tags
        {
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry+11"
            "PreviewType" = "Plane"
            "IgnoreProjector" = "True"
        }

        HLSLINCLUDE
        #pragma target 3.5
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

        CBUFFER_START(UnityPerMaterial)
            float4 _CrackMap_ST;
            half4 _DarkColor;
            half4 _GlowColor;
            half4 _CoolColor;
            half4 _HotColor;
            float _GlowBoost;
            float _DrawOrder;
            float _DecalMeshBiasType;
            float _DecalMeshDepthBias;
            float _DecalMeshViewBias;
        CBUFFER_END

        TEXTURE2D(_CrackMap);
        SAMPLER(sampler_CrackMap);

        UNITY_INSTANCING_BUFFER_START(Decal)
            UNITY_DEFINE_INSTANCED_PROP(float4x4, _NormalToWorld)
        UNITY_INSTANCING_BUFFER_END(Decal)

        float4 ShadeCrack(float2 uv, float4 P)
        {
            float t = saturate(P.x);
            float v = clamp(round(P.y), 0.0, 3.0);
            float col = fmod(v, 2.0), row = floor(v / 2.0);
            // 第 0 格在贴图左上（PNG 第一行 = UV 的 v = 1）
            float2 cuv = float2((col + uv.x) * 0.5, 1.0 - (row + 1.0 - uv.y) * 0.5);
            float4 m = SAMPLE_TEXTURE2D(_CrackMap, sampler_CrackMap, cuv);
            // 蔓延：前 3% 的寿命里（约 0.15–0.2 s）裂纹从坑心往外走到头
            float reach = saturate(t / 0.03) * 1.05;
            float shown = 1.0 - smoothstep(reach - 0.06, reach, m.a);
            // 余热：刚砸下去最热，3% 之后开始冷，到 70% 冷透（只剩暗铜缝）；狂怒时整体更白
            float heat = saturate(P.z) * (1.0 - smoothstep(0.03, 0.7, t));
            float fury = saturate(P.w);
            float fade = 1.0 - smoothstep(0.8, 1.0, t);
            float k = shown * fade;
            float aDark = saturate(m.r * 0.85 + m.g * 0.1) * k;
            half3 glowCol = lerp(_CoolColor.rgb, lerp(_GlowColor.rgb, _HotColor.rgb, 0.3 * fury), saturate(heat * 1.3));
            float3 rgb = _DarkColor.rgb * aDark;
            rgb += glowCol * m.g * k * (0.12 + _GlowBoost * heat);
            rgb += _HotColor.rgb * m.b * k * heat * heat * (1.4 + 0.8 * fury);
            return float4(rgb, aDark);
        }

        struct Attributes
        {
            float4 positionOS : POSITION;
            UNITY_VERTEX_INPUT_INSTANCE_ID
        };

        struct Varyings
        {
            float4 positionCS : SV_POSITION;
            UNITY_VERTEX_INPUT_INSTANCE_ID
            UNITY_VERTEX_OUTPUT_STEREO
        };

        Varyings VertDecal(Attributes v)
        {
            Varyings o = (Varyings)0;
            UNITY_SETUP_INSTANCE_ID(v);
            UNITY_TRANSFER_INSTANCE_ID(v, o);
            UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
            o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
            return o;
        }

        float4 FragDecalCommon(Varyings i, bool flipScreen)
        {
            UNITY_SETUP_INSTANCE_ID(i);
            UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
            float2 pixel = i.positionCS.xy;
            if (flipScreen) TransformScreenUV(pixel, _ScreenSize.y);
        #if UNITY_REVERSED_Z
            float depth = LoadSceneDepth(uint2(pixel));
        #else
            float depth = lerp(UNITY_NEAR_CLIP_VALUE, 1, LoadSceneDepth(uint2(pixel)));
        #endif
            float2 positionSS = i.positionCS.xy * _ScreenSize.zw;
            float3 positionWS = ComputeWorldSpacePosition(positionSS, depth, UNITY_MATRIX_I_VP);

            float3 ds = TransformWorldToObject(positionWS) * float3(1.0, -1.0, 1.0);
            float3 nrm = cross(ddy(positionWS), ddx(positionWS));
            float3 axis = TransformObjectToWorldDir(float3(0, 1, 0));
            float facing = abs(dot(nrm, axis)) * rsqrt(max(dot(nrm, nrm), 1e-12));
            clip(0.5 - max(abs(ds.x), max(abs(ds.y), abs(ds.z))));

            float4x4 n2w = UNITY_ACCESS_INSTANCED_PROP(Decal, _NormalToWorld);
            float fade = saturate(n2w[0][3]);
            float4 P = float4(n2w[3][0], n2w[3][1], n2w[3][2], n2w[3][3]);
            float4 c = ShadeCrack(ds.xz + 0.5, P);
            float edge = smoothstep(0.3, 0.55, facing) * (1.0 - smoothstep(0.36, 0.5, abs(ds.y)));
            return c * (fade * edge);
        }
        ENDHLSL

        Pass
        {
            Name "DecalScreenSpaceProjector"
            Tags { "LightMode" = "DecalScreenSpaceProjector" }
            Blend One OneMinusSrcAlpha
            Cull Front
            ZTest Greater
            ZWrite Off

            HLSLPROGRAM
            #pragma vertex VertDecal
            #pragma fragment Frag
            #pragma multi_compile_instancing

            float4 Frag(Varyings i) : SV_Target
            {
                return FragDecalCommon(i, true);
            }
            ENDHLSL
        }

        Pass
        {
            Name "DecalProjectorForwardEmissive"
            Tags { "LightMode" = "DecalProjectorForwardEmissive" }
            Blend One OneMinusSrcAlpha
            Cull Front
            ZTest Greater
            ZWrite Off

            HLSLPROGRAM
            #pragma vertex VertDecal
            #pragma fragment Frag
            #pragma multi_compile_instancing

            float4 Frag(Varyings i) : SV_Target
            {
                return FragDecalCommon(i, false);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
