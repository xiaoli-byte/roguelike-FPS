// 涌流体积（特效打磨 C 路：首领登场 / 招式里的水柱、水墙、水面漩涡、熔浆柱、下坠火尾、沙瀑）：程序网格（Surge.cs 生成的柱、冠、弧幕、圆盘、锥尾、穹顶）上的流动条纹。
// 网格 uv：u 绕一圈（弧幕沿弧）0..1，v 自下而上 0..1（圆盘是由内向外）。条纹 = 两层沿 v 拉长的噪声按 _Params.z 的速度流动（正 = 往上涌，负 = 往下淌）。
// 轮廓：视线掠过的侧边按法线 · 视线淡掉（柱子不会是一根硬边圆筒），上下两端按 _Shape.xy 渐隐；_Shape.z 是消散量（噪声阈值从稀到无，水柱塌落、火尾熄灭）。
// 模式（_Params.w）——按 docs/art/fx-style.md 的手绘风格化：每种只有 3 个色阶（_ColorA 暗 / 两者之间的主色 / _ColorB 亮），阶与阶之间是窄的软阶梯，
// 受光也只有两阶；起伏用中尺度的团块，不做细颗粒噪点：
//   0 水：深色水身 / 浅色水身 / 白沫块，轮廓一道亮边；
//   1 沙：暗赭 / 沙色 / 亮沙，边缘是成团的缺口；
//   2 熔浆 / 熔铜：暗紫褐的壳 / 铜橙熔流 / 金黄亮芯，不受光；
//   3 火：赭红边 / 橙 / 金黄芯，半加法（叠色的同时压暗身后），不受光。
//   4 泉（收尾一轮：旱魃的月牙泉水柱 / 水幕 / 喷泉）：深青水身 / 泉水主色（_ColorA 提亮一档）/ 白沫块，几乎不透明（半透明的青绿叠在亮沙上会混成灰白），
//     轮廓一圈白沫亮边。
// 混合：预乘 alpha（Blend One OneMinusSrcAlpha），_Params2.w = 加法比例（0 普通混合 … 1 纯加法）。每个实例的参数走 MaterialPropertyBlock。
Shader "Spiritfire/FxSurge"
{
    Properties
    {
        [HDR] _ColorA("Color A (body / crust / edge)", Color) = (0.55, 0.85, 0.9, 1)
        [HDR] _ColorB("Color B (foam / glow / core)", Color) = (1, 1, 1, 1)
        _Params("Seed, Alpha, Flow, Mode", Vector) = (0, 1, 1, 0)
        _Params2("Noise U, Noise V, Edge Softness, Additive", Vector) = (6, 2, 0.35, 0)
        _Shape("Top Fade, Bottom Fade, Dissolve, Rim Light", Vector) = (0.75, 0.08, 0, 0.3)
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+2" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }

        Pass
        {
            Name "ForwardSurge"
            Tags { "LightMode"="UniversalForward" }
            Blend One OneMinusSrcAlpha
            ZWrite Off
            Cull Off

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _ColorA;
                half4 _ColorB;
                float4 _Params;
                float4 _Params2;
                float4 _Shape;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float3 positionWS : TEXCOORD2;
                half fog : TEXCOORD3;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            float SFSurgeHash(float2 p)
            {
                float3 p3 = frac(float3(p.xyx) * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return frac((p3.x + p3.y) * p3.z);
            }

            // 绕 u 方向周期为 period 的值噪声（柱面接缝处无缝）
            float SFSurgeNoise(float2 p, float period)
            {
                float2 i = floor(p), f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                float2 i1 = float2(fmod(i.x + 1.0, period), i.y);
                float2 i0 = float2(fmod(i.x, period), i.y);
                float a = SFSurgeHash(i0), b = SFSurgeHash(i1);
                float c = SFSurgeHash(i0 + float2(0, 1)), d = SFSurgeHash(i1 + float2(0, 1));
                return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
            }

            // 软阶梯：在 edge 两侧 ±0.03 里过渡（色阶分明，但不出锯齿）
            float SFBand(float x, float edge) { return smoothstep(edge - 0.03, edge + 0.03, x); }

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                VertexPositionInputs p = GetVertexPositionInputs(v.positionOS.xyz);
                o.positionCS = p.positionCS;
                o.positionWS = p.positionWS;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.uv = v.uv;
                o.fog = ComputeFogFactor(o.positionCS.z);
                return o;
            }

            half4 Frag(Varyings i, bool front : SV_IsFrontFace) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                float seed = _Params.x, alpha = saturate(_Params.y), flow = _Params.z, mode = _Params.w;
                float nu = max(1.0, round(_Params2.x)), nv = max(0.25, _Params2.y);
                float t = _Time.y * flow;
                float2 uv = i.uv;
                // 两层沿 v 拉长、往 flow 方向流的噪声 → 条纹；第三层是中尺度的团块（白沫块 / 沙团 / 火团的轮廓起伏，不做细颗粒）
                float n1 = SFSurgeNoise(float2(uv.x * nu + seed * 7.0, uv.y * nv - t + seed * 3.0), nu);
                float n2 = SFSurgeNoise(float2(uv.x * nu * 2.0 + 11.0, uv.y * nv * 1.8 - t * 1.55 + seed), nu * 2.0);
                float n3 = SFSurgeNoise(float2(uv.x * nu * 3.0 + 3.0, uv.y * nv * 2.4 - t * 1.8 + seed * 5.0), nu * 3.0);
                float streak = n1 * 0.62 + n2 * 0.38;

                // 轮廓：视线掠过的侧边淡掉
                float3 n = normalize(i.normalWS) * (front ? 1.0 : -1.0);
                float3 view = normalize(GetWorldSpaceViewDir(i.positionWS));
                float facing = abs(dot(n, view));
                float soft = max(0.02, _Params2.z);
                float edge = smoothstep(0.0, soft, facing);
                // 上下两端渐隐（顶端再被条纹啃一下，像水花 / 火苗的碎边）
                float top = saturate(_Shape.x);
                float vfade = smoothstep(0.0, max(1e-3, _Shape.y), uv.y) * (1.0 - smoothstep(top, 1.0, uv.y + (streak - 0.5) * 0.25));
                // 消散：噪声阈值从 0 升到 1 时一片片化掉（越往上越先化），硬一点的边
                float dis = saturate(_Shape.z);
                float keep = SFBand(streak * 0.85 + (1.0 - uv.y) * 0.15 + 0.05, dis);

                // 手绘风格化（docs/art/fx-style.md）：每种只有 3 个色阶（暗 / 主 / 亮），阶与阶之间是窄的软阶梯，受光也是两阶
                half3 col;
                float a;
                float add = saturate(_Params2.w);
                Light light = GetMainLight();
                float lit = SFBand(saturate(dot(n, light.direction) * 0.5 + 0.5), 0.5);
                half3 lo = _ColorA.rgb, hi = _ColorB.rgb, mid = lerp(lo, hi, 0.45);
                if (mode < 0.5)
                {
                    // 水：深色水身 / 浅色水身 / 白沫块
                    float t1 = SFBand(streak, 0.44), t2 = SFBand(streak + (n3 - 0.5) * 0.3, 0.64);
                    col = lerp(lerp(lo, mid, t1), hi, t2);
                    col *= lerp(0.84, 1.05, lit);
                    // 轮廓一道亮边（也是一阶）
                    col = lerp(col, hi, SFBand(1.0 - facing, 0.78) * _Shape.w);
                    a = lerp(0.6, 0.96, t2);
                }
                else if (mode < 1.5)
                {
                    // 沙：暗赭 / 沙色 / 亮沙，边缘是成团的缺口（不是细沙粒）
                    float t1 = SFBand(streak, 0.45), t2 = SFBand(streak + (n3 - 0.5) * 0.35, 0.66);
                    col = lerp(lerp(lo, mid, t1), hi, t2);
                    col *= lerp(0.8, 1.04, lit);
                    a = 0.88 * SFBand(streak + (n3 - 0.5) * 0.4, 0.34);
                }
                else if (mode < 2.5)
                {
                    // 熔浆：暗紫褐的壳 / 铜橙熔流 / 金黄亮芯（粗而少的熔流纹）
                    float t1 = SFBand(streak, 0.5), t2 = SFBand(streak + (n3 - 0.5) * 0.2, 0.7);
                    col = lerp(lerp(lo, hi * 0.6, t1), hi, t2);
                    a = lerp(0.88, 1.0, t1);
                }
                else if (mode < 3.5)
                {
                    // 火：赭红边 / 橙 / 金黄芯，外轮廓是硬一点的火舌边
                    float t1 = SFBand(streak, 0.44), t2 = SFBand(streak + (n3 - 0.5) * 0.2, 0.64);
                    col = lerp(lerp(lo, mid, t1), hi, t2);
                    a = SFBand(streak + (n3 - 0.5) * 0.25, 0.3);
                }
                else
                {
                    // 泉：深青水身 / 泉水主色 / 白沫块（中尺度的团块），轮廓一圈白沫亮边；几乎不透明
                    half3 main = saturate(lo * 1.75 + 0.03);
                    float t1 = SFBand(streak, 0.4), t2 = SFBand(streak + (n3 - 0.5) * 0.34, 0.68);
                    col = lerp(lerp(lo, main, t1), hi, t2);
                    col *= lerp(0.86, 1.04, lit);
                    float foamRim = SFBand(1.0 - facing, 0.7) * max(_Shape.w, 0.35);
                    col = lerp(col, hi, foamRim);
                    a = lerp(0.86, 0.97, max(t2, foamRim));
                }
                // 贴脸淡出：镜头钻进水柱 / 火尾里时不糊满屏（0.6 m 内全透明，3 m 外不淡）
                float camDist = distance(i.positionWS, _WorldSpaceCameraPos);
                a *= edge * vfade * keep * alpha * smoothstep(0.6, 3.0, camDist);
                clip(a - 0.004);
                // 雾：普通混合的部分混进雾色，加法的部分往黑里收（加法叠雾色会在远处发白）
                col = lerp(MixFog(col, i.fog), MixFogColor(col, half3(0, 0, 0), i.fog), add);
                // 预乘：加法比例 add 越大，越不压暗身后
                return half4(col * a, a * (1.0 - add));
            }
            ENDHLSL
        }
    }

    Fallback Off
}
