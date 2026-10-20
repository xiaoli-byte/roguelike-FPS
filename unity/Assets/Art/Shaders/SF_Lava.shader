// 灵火破晓 · 熔岩面（docs/unity-parity.md L7；Three.js 版 src/world/Lava.ts 的 LAVA_FRAG 照搬后改成 URP）。
// 每片熔岩一张平面网格（LavaVolume.BuildMesh），着色器要的数据都烘在顶点里，材质全场共用（SRP Batcher）：
//   uv0 = 形状局部 XZ（米）；uv1 = (半宽, 半长, 形状 0 盒 / 1 圆, 岸边按场景深度 0 / 1)；uv2 = (流动 x, 流动 z（局部，米 / 秒）, 相位种子, 0)。
// 画法（与 TS 一致）：缓慢翻涌的域扭曲 fbm 当热度；Voronoi 结壳板块（种子点随时间漂移），板块缝发亮；热度 → 暗红 → 橙 → 白热四段色带，
// 整体呼吸式脉动；岸边一圈暗色硬壳，往里逐渐熔开。噪声用局部坐标（第三章的图在世界 x ≈ 1 万米处，世界坐标喂 sin 哈希会失真）。
// 岸边硬壳两种来源取较强者：形状边缘往里 _ShoreWidth 米（平地上的熔岩条带只靠它）；湖、渠（uv1.w = 1）再按场景深度——
// 熔岩面下面的床离熔岩面不到 _ShoreDepth 米的地方结壳（岸线随涨落自动移动，不用烘距离图）。所以渲染队列放在不透明物体之后（Transparent-100），
// 读 URP 的相机深度图（PC 管线开着 Depth Texture；没有深度图时这一项自动失效，只剩形状边缘）。
// 结壳部分走风格化光照（SF_StylizedShading.hlsl：冷暗部、阶梯明暗、点光），所以熔岩点光、主光都照得到；发光部分是 HDR 自发光，交给 Bloom。
// _Agitation（0..1，LavaVolume 用 MaterialPropertyBlock 写）：涨潮预警 / 涨潮中更亮、缝更宽、翻涌更快。
// 不投影、不写阴影；ZWrite 开（后面的透明特效被正确遮挡），混合是覆盖（视觉上是不透明的）。
Shader "Spiritfire/Lava"
{
    Properties
    {
        [Header(Colors)]
        _CrustColor("Crust Albedo", Color) = (0.085, 0.06, 0.05, 1)
        [HDR] _DeepColor("Dim Glow", Color) = (0.42, 0.045, 0.01, 1)
        [HDR] _HotColor("Molten", Color) = (1, 0.33, 0.035, 1)
        [HDR] _CoreColor("White Hot", Color) = (1, 0.82, 0.38, 1)
        _Emission("Emission Strength", Range(0, 4)) = 1.55

        [Header(Flow)]
        _NoiseScale("Heat Noise Frequency (1 per m)", Float) = 0.28
        _WarpScale("Churn Frequency (1 per m)", Float) = 0.11
        _PlateScale("Crust Plate Frequency (1 per m)", Float) = 0.32
        _FlowSpeed("Churn Speed", Float) = 1
        _Agitation("Agitation (tide warning)", Range(0, 1)) = 0

        [Header(Shore)]
        _ShoreWidth("Shore Crust Width at Footprint Edge (m)", Float) = 1.5
        _ShoreDepth("Shore Crust by Scene Depth (m)", Float) = 0.6

        [Header(Stylized Lighting)]
        _ShadowTint("Shadow Tint", Color) = (0.66, 0.5, 0.52, 1)
        _RampThreshold("Ramp Threshold", Range(-1,1)) = 0.0
        _RampSoftness("Ramp Softness", Range(0.001,1)) = 0.3
        _ShadowLift("Shadow Lift", Range(0,1)) = 0.3
        _AmbientStrength("Ambient Strength", Range(0,2)) = 1
        _RimColor("Rim Color", Color) = (1, 0.6, 0.35, 1)
        _RimPower("Rim Power", Range(0.5,8)) = 5
        _RimStrength("Rim Strength", Range(0,2)) = 0.1
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "Queue" = "Transparent-100"
            "RenderPipeline" = "UniversalPipeline"
            "IgnoreProjector" = "True"
            "PreviewType" = "Plane"
        }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            ZWrite On
            ZTest LEqual
            Blend One Zero
            Cull Back

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile _ _LIGHT_LAYERS
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/RenderingLayers.hlsl"
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"
            #include "SF_StylizedShading.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _CrustColor;
                half4 _DeepColor;
                half4 _HotColor;
                half4 _CoreColor;
                half _Emission;
                float _NoiseScale;
                float _WarpScale;
                float _PlateScale;
                float _FlowSpeed;
                half _Agitation;
                float _ShoreWidth;
                float _ShoreDepth;
                half4 _ShadowTint;
                half4 _RimColor;
                half _RampThreshold;
                half _RampSoftness;
                half _ShadowLift;
                half _AmbientStrength;
                half _RimPower;
                half _RimStrength;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float2 uv0        : TEXCOORD0;
                float4 uv1        : TEXCOORD1;
                float4 uv2        : TEXCOORD2;
            };

            struct Varyings
            {
                float4 positionCS  : SV_POSITION;
                float3 positionWS  : TEXCOORD0;
                float2 local       : TEXCOORD1;
                float4 info        : TEXCOORD2; // 半宽, 半长, 形状, 岸边按深度
                float4 flow        : TEXCOORD3; // 流动 x, z, 种子
                half3  normalWS    : TEXCOORD4;
                half3  vertexLight : TEXCOORD5;
            };

            Varyings Vert(Attributes v)
            {
                Varyings o;
                VertexPositionInputs p = GetVertexPositionInputs(v.positionOS.xyz);
                o.positionCS = p.positionCS;
                o.positionWS = p.positionWS;
                o.local = v.uv0;
                o.info = v.uv1;
                o.flow = v.uv2;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.vertexLight = VertexLighting(p.positionWS, o.normalWS);
                return o;
            }

            float H21(float2 p) { return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }

            float VNoise(float2 p)
            {
                float2 i = floor(p), f = frac(p), u = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(H21(i), H21(i + float2(1, 0)), u.x), lerp(H21(i + float2(0, 1)), H21(i + float2(1, 1)), u.x), u.y);
            }

            float Fbm(float2 p)
            {
                float v = 0.0, a = 0.5;
                [unroll] for (int k = 0; k < 4; k++)
                {
                    v += a * VNoise(p);
                    p = p * 2.03 + float2(1.7, 9.2);
                    a *= 0.5;
                }
                return v;
            }

            // 结壳板块：到最近 / 次近种子点的距离（板块缝 = 两者之差小的地方）；种子点随时间缓慢漂移
            float2 Plates(float2 p, float t)
            {
                float2 n = floor(p), f = frac(p);
                float d1 = 8.0, d2 = 8.0;
                [unroll] for (int j = -1; j <= 1; j++)
                [unroll] for (int i = -1; i <= 1; i++)
                {
                    float2 g = float2(i, j);
                    float2 o = float2(H21(n + g), H21(n + g + 19.19));
                    o = 0.5 + 0.38 * sin(t * 0.22 + 6.2831 * o);
                    float d = length(g + o - f);
                    if (d < d1) { d2 = d1; d1 = d; }
                    else if (d < d2) { d2 = d; }
                }
                return float2(d1, d2);
            }

            half4 Frag(Varyings i) : SV_Target
            {
                half agit = saturate(_Agitation);
                float t = _Time.y * _FlowSpeed * (1.0 + agit * 1.5);
                // 局部坐标 + 每片熔岩一个相位种子；渠里的熔岩顺流平移
                float2 p = i.local + i.flow.z * 37.0 - i.flow.xy * _Time.y;

                // 缓慢翻涌的流向（域扭曲）→ 热度；结壳板块与板块缝
                float2 q = float2(Fbm(p * _WarpScale + float2(t * 0.035, 0.0)), Fbm(p * _WarpScale + float2(5.2, 1.3) - float2(0.0, t * 0.03)));
                float heat = Fbm(p * _NoiseScale + q * 2.6 + float2(t * 0.06, -t * 0.045));
                float2 v = Plates(p * _PlateScale + q * 1.4, t);
                float seam = 1.0 - smoothstep(0.0, 0.16 + agit * 0.08, v.y - v.x);
                float plate = smoothstep(0.15, 0.75, v.x);

                // 岸边硬壳：形状边缘往里 _ShoreWidth 米
                float edge = i.info.z < 0.5 ? min(i.info.x - abs(i.local.x), i.info.y - abs(i.local.y)) : i.info.x - length(i.local);
                float rim = 1.0 - smoothstep(0.1, max(0.11, _ShoreWidth), edge);
                // 湖、渠：熔岩面下的床离得近（浅）的地方也结壳
                if (i.info.w > 0.5)
                {
                    float2 suv = GetNormalizedScreenSpaceUV(i.positionCS);
                    #if UNITY_REVERSED_Z
                    float raw = SampleSceneDepth(suv);
                    #else
                    float raw = lerp(UNITY_NEAR_CLIP_VALUE, 1, SampleSceneDepth(suv));
                    #endif
                    float3 bed = ComputeWorldSpacePosition(suv, raw, UNITY_MATRIX_I_VP);
                    float below = i.positionWS.y - bed.y;
                    // 床在熔岩面上方（没有深度图 / 深度图无效）时不算
                    if (below > -0.05) rim = max(rim, 1.0 - smoothstep(0.02, max(0.03, _ShoreDepth), below));
                }

                float tt = heat * 0.95 + seam * 0.75 - plate * 0.25 - 0.18 + agit * 0.22;
                tt = saturate(tt * (1.0 - rim * 0.9));

                // 自发光：暗红 → 橙 → 白热，呼吸式脉动（涨潮预警时更快更亮）
                half3 glow = _DeepColor.rgb * smoothstep(0.08, 0.32, tt);
                glow = lerp(glow, _HotColor.rgb, smoothstep(0.3, 0.68, tt));
                glow = lerp(glow, _CoreColor.rgb, smoothstep(0.74, 1.0, tt));
                float pulse = 0.88 + 0.12 * sin(t * (1.6 + agit * 2.0) + heat * 7.0);
                glow *= _Emission * pulse * (1.0 + agit * 0.35);

                // 结壳：暗色玄武岩，按风格化光照受光；板块之间明暗略有起伏
                half crustMask = 1.0 - smoothstep(0.08, 0.32, tt);
                half3 N = normalize(half3((q.x - 0.5) * 0.6, 1.0, (q.y - 0.5) * 0.6));
                StylizedStyle st;
                st.shadowTint = _ShadowTint.rgb; st.rampThreshold = _RampThreshold; st.rampSoftness = _RampSoftness;
                st.shadowLift = _ShadowLift; st.ambient = _AmbientStrength; st.specStrength = 0; st.specSize = 0.1;
                st.rimColor = _RimColor.rgb; st.rimPower = _RimPower; st.rimStrength = _RimStrength;
                float fogFactor = ComputeFogFactor(TransformWorldToHClip(i.positionWS).z);
                half mainLit;
                half3 crust = SFShade(_CrustColor.rgb * (0.75 + 0.5 * plate), N, i.positionWS, i.positionCS, 1, 0, 1, i.vertexLight, fogFactor, st, mainLit);

                half3 color = crust * crustMask + glow;
                return half4(MixFog(color, fogFactor), 1);
            }
            ENDHLSL
        }
    }
    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
