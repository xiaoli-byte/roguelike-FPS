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
        _CrackWidth("Crack Width (plate units)", Range(0.01, 0.4)) = 0.1
        _MoltenAmount("Open Molten Amount", Range(0, 1)) = 0.35
        _FlowStretch("Stretch Along Fast Flow", Range(0, 1)) = 1
        _BubbleRate("Bubble Rate", Range(0, 3)) = 1
        _EdgeGlow("Shore Contact Glow", Range(0, 2)) = 1

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
                half _CrackWidth;
                half _MoltenAmount;
                half _FlowStretch;
                half _BubbleRate;
                half _EdgeGlow;
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

            float Fbm2(float2 p) { return VNoise(p) * 0.65 + VNoise(p * 2.07 + float2(3.1, 7.7)) * 0.35; }

            // 结壳板块：到最近 / 次近种子点的距离（板块缝 = 两者之差小的地方）+ 最近那块的编号哈希；种子点随时间缓慢漂移
            float3 Plates(float2 p, float t)
            {
                float2 n = floor(p), f = frac(p);
                float d1 = 8.0, d2 = 8.0, id = 0.0;
                [unroll] for (int j = -1; j <= 1; j++)
                [unroll] for (int i = -1; i <= 1; i++)
                {
                    float2 g = float2(i, j);
                    float2 o = float2(H21(n + g), H21(n + g + 19.19));
                    float h = o.x;
                    o = 0.5 + 0.38 * sin(t * 0.22 + 6.2831 * o);
                    float d = length(g + o - f);
                    if (d < d1) { d2 = d1; d1 = d; id = h; }
                    else if (d < d2) { d2 = d; }
                }
                return float3(d1, d2, id);
            }

            // 温度 → 自发光色阶：冷壳（不发光）/ 暗红 / 橙 / 白热，阶与阶之间是窄的软阶梯（同 StylizedLit 的 smoothstep 明暗阶梯；
            // docs/art/fx-style.md：色阶分明，不做写实的连续渐变）。配色同 FX4 熔铜流 / 地火
            half3 Ramp(float T)
            {
                half3 c = _DeepColor.rgb * smoothstep(0.17, 0.23, T);
                c = lerp(c, _HotColor.rgb, smoothstep(0.44, 0.5, T));
                c = lerp(c, _CoreColor.rgb, smoothstep(0.8, 0.86, T));
                return c;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                half agit = saturate(_Agitation);
                float t = _Time.y * _FlowSpeed * (1.0 + agit * 1.5);

                // ── 坐标：沿流向的局部系（横向, 顺流）。渠、熔瀑顺流平移，流得越快纹理沿流向拉得越长（熔瀑读成一道道下泻的亮流）──
                float2 flowV = i.flow.xy;
                float speed = length(flowV);
                float2 fdir = speed > 1e-3 ? flowV / speed : float2(0.0, 1.0);
                float2 perp = float2(fdir.y, -fdir.x);
                float stretch = saturate((speed - 0.5) / 2.5) * _FlowStretch;
                float2 p0 = i.local + i.flow.z * 37.0;
                float2 pf = float2(dot(p0, perp), dot(p0, fdir) - speed * _Time.y);
                float2 w = float2(pf.x, pf.y * lerp(1.0, 0.28, stretch));

                // ── 翻涌：慢速域扭曲（湖面没有流向也在缓缓打转）→ 热度场（壳薄的地方）──
                float2 q = float2(Fbm2(w * _WarpScale + float2(t * 0.04, 0.0)), Fbm2(w * _WarpScale + float2(5.2, 1.3) - float2(0.0, t * 0.035)));
                float2 wp = w + (q - 0.5) * 5.0;
                float heat = Fbm(wp * _NoiseScale * 0.8 + float2(t * 0.05, -t * 0.04));

                // ── 岸边：形状边缘往里 _ShoreWidth 米；湖、渠再按场景深度（床离熔岩面近 = 浅 = 结壳）；最贴岸那一线是接触亮边 ──
                float edge = i.info.z < 0.5 ? min(i.info.x - abs(i.local.x), i.info.y - abs(i.local.y)) : i.info.x - length(i.local);
                float rim = 1.0 - smoothstep(0.1, max(0.11, _ShoreWidth), edge);
                // 接触亮边：平地上的条带按形状边缘；湖、渠只按深度（渠是一段段盒子拼的，按形状边缘会在接缝处画出亮线）
                float contact = i.info.w > 0.5 ? 0.0 : 1.0 - smoothstep(0.0, 0.3, edge);
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
                    if (below > -0.05)
                    {
                        rim = max(rim, 1.0 - smoothstep(0.02, max(0.03, _ShoreDepth), below));
                        contact = max(contact, 1.0 - smoothstep(0.0, 0.1, below));
                    }
                }

                // ── 结壳板块与裂缝：裂缝在热的地方更宽，岸边收窄；热度高处板块化开成成片的熔流 ──
                // 远处一个像素盖住好几厘米：细节（裂缝、冷却纹、泡）按像素尺寸淡成平均亮度，不闪、不糊成一片乱纹
                float fwPlate = max(fwidth(w.x), fwidth(w.y)) * _PlateScale * 0.75;
                float detail = saturate(1.6 - fwPlate * 18.0);
                float3 v = Plates(wp * _PlateScale * 0.75, t);
                float gap = v.y - v.x;
                float crackW = (_CrackWidth + 0.1 * smoothstep(0.4, 0.7, heat) + agit * 0.08 + stretch * 0.12) * (1.0 - rim * 0.6);
                crackW = max(crackW, fwPlate * 1.5);
                float crack = 1.0 - smoothstep(crackW * 0.4, crackW, gap);
                float core = 1.0 - smoothstep(0.0, crackW * 0.4, gap);
                float bleed = 1.0 - smoothstep(0.0, crackW * 2.5 + 0.06, gap);
                crack = lerp(0.3, crack, detail);
                core = core * detail;
                float c0 = 0.72 - _MoltenAmount * 0.25;
                float open = smoothstep(c0 - 0.06, c0 + 0.06, heat + agit * 0.12 + stretch * 0.3) * (1.0 - rim);
                // 熔流里顺流的亮纹（湖面跟着翻涌走）
                float streak = Fbm2(float2(wp.x * 1.1, wp.y * 0.3 - t * 0.55) + q * 2.0);

                // ── 冒泡：每 3 m 一格，有的格子隔几秒鼓起一个亮泡、胀大、破开成一圈往外散的亮环 ──
                float bubble = 0.0, popRing = 0.0;
                {
                    float2 bp = pf / 3.0;
                    float2 bc = floor(bp), bf = frac(bp);
                    float h = H21(bc + 7.13);
                    float period = (3.0 + h * 5.0) / max(0.2, _BubbleRate * (1.0 + agit * 1.5));
                    float cyc = _Time.y / period + h * 13.7;
                    float ph = frac(cyc);
                    float on = step(0.55 - agit * 0.25, H21(bc + floor(cyc) * 0.731));
                    float2 cpos = 0.25 + 0.5 * float2(H21(bc + 3.3), H21(bc + 9.1));
                    float r = length(bf - cpos) * 3.0;
                    float rad = 0.12 + 0.5 * smoothstep(0.0, 0.85, ph);
                    float swell = ph < 0.88 ? 1.0 : 0.0;
                    bubble = (1.0 - smoothstep(rad * 0.7, rad, r)) * swell * on;
                    float pr = rad + (ph - 0.88) * 9.0;
                    popRing = ph >= 0.88 ? (1.0 - smoothstep(0.0, 0.1, abs(r - pr))) * (1.0 - (ph - 0.88) / 0.12) * on : 0.0;
                    float wet = saturate(open + crack + 0.25) * (1.0 - rim);
                    bubble *= wet * detail;
                    popRing *= wet * detail;
                }

                // ── 温度：壳（近缝处透出暗红）/ 缝（橙到白热）/ 熔流（橙，带亮纹）/ 泡（亮）/ 接触边（橙）──
                // 壳不是死黑：底下透出暗红（热的地方更红），靠缝的地方渐渐发亮
                float Tcrust = 0.08 + heat * 0.14 + bleed * 0.32;
                float Tmolten = 0.52 + streak * 0.42;
                float T = lerp(Tcrust, Tmolten, open);
                T = max(T, crack * (0.5 + core * 0.45));
                T = max(T, bubble * 0.86);
                T = max(T, popRing * 0.95);
                T = max(T, contact * _EdgeGlow * 0.72 * (0.85 + 0.15 * sin(t * 2.3 + heat * 9.0)));
                T = saturate(T + agit * 0.12);

                // 自发光：暗红 → 橙 → 白热，呼吸式脉动（涨潮预警时更快更亮）
                float pulse = 0.9 + 0.1 * sin(t * (1.6 + agit * 2.0) + heat * 7.0);
                half3 glow = Ramp(T) * _Emission * pulse * (1.0 + agit * 0.35);

                // 结壳：暗色玄武岩，按风格化光照受光；每块板子明暗略有不同
                half crustMask = 1.0 - smoothstep(0.17, 0.3, T);
                half3 N = normalize(half3((q.x - 0.5) * 0.6, 1.0, (q.y - 0.5) * 0.6));
                StylizedStyle st;
                st.shadowTint = _ShadowTint.rgb; st.rampThreshold = _RampThreshold; st.rampSoftness = _RampSoftness;
                st.shadowLift = _ShadowLift; st.ambient = _AmbientStrength; st.specStrength = 0; st.specSize = 0.1;
                st.rimColor = _RimColor.rgb; st.rimPower = _RimPower; st.rimStrength = _RimStrength;
                float fogFactor = ComputeFogFactor(TransformWorldToHClip(i.positionWS).z);
                half mainLit;
                half3 albedo = _CrustColor.rgb * (0.7 + 0.6 * v.z) * (0.85 + 0.3 * smoothstep(0.1, 0.6, v.x));
                half3 crust = SFShade(albedo, N, i.positionWS, i.positionCS, 1, 0, 1, i.vertexLight, fogFactor, st, mainLit);

                half3 color = crust * crustMask + glow;
                return half4(MixFog(color, fogFactor), 1);
            }
            ENDHLSL
        }
    }
    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
