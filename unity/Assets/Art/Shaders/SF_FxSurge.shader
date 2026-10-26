// 涌流体积（特效打磨 C 路：首领登场 / 招式里的水柱、水墙、水面漩涡、熔浆柱、下坠火尾、沙瀑）：程序网格（Surge.cs 生成的柱、冠、弧幕、圆盘、锥尾、穹顶）上的流动条纹。
// 网格 uv：u 绕一圈（弧幕沿弧）0..1，v 自下而上 0..1（圆盘是由内向外）。条纹 = 两层沿 v 拉长的噪声按 _Params.z 的速度流动（正 = 往上涌，负 = 往下淌）。
// 轮廓：视线掠过的侧边按法线 · 视线淡掉（柱子不会是一根硬边圆筒），上下两端按 _Shape.xy 渐隐；_Shape.z 是消散量（噪声阈值从稀到无，水柱塌落、火尾熄灭）。
// 模式（_Params.w）：
//   0 水：半透明青绿，条纹亮处翻白沫，受主光（亮面略亮、背面略暗）；
//   1 沙：不透明一点的赭黄，细颗粒噪声啃出疏密，受主光；
//   2 熔浆 / 熔铜：暗壳 + 发光的熔流纹（_ColorB 是 HDR 亮色），不受光；
//   3 火：半加法的火舌条纹（同 SF_FxFlame 的混合：叠色的同时按 0.45 × 不透明度压暗身后），不受光。
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
                // 两层沿 v 拉长、往 flow 方向流的噪声 → 条纹；第三层高频给沙粒 / 白沫
                float n1 = SFSurgeNoise(float2(uv.x * nu + seed * 7.0, uv.y * nv - t + seed * 3.0), nu);
                float n2 = SFSurgeNoise(float2(uv.x * nu * 2.0 + 11.0, uv.y * nv * 1.8 - t * 1.55 + seed), nu * 2.0);
                float n3 = SFSurgeNoise(float2(uv.x * nu * 6.0 + 3.0, uv.y * nv * 5.0 - t * 2.2 + seed * 5.0), nu * 6.0);
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
                // 消散：噪声阈值从 0 升到 1 时一片片化掉（越往上越先化）
                float dis = saturate(_Shape.z);
                float keep = smoothstep(dis - 0.08, dis + 0.02, streak * 0.85 + (1.0 - uv.y) * 0.15 + 0.05);

                half3 col;
                float a;
                float add = saturate(_Params2.w);
                Light light = GetMainLight();
                float lambert = saturate(dot(n, light.direction) * 0.5 + 0.5);
                if (mode < 0.5)
                {
                    // 水：条纹亮处翻白沫，底色半透明
                    float foam = smoothstep(0.5, 0.78, streak) + smoothstep(0.7, 0.9, n3) * 0.7;
                    col = lerp(_ColorA.rgb, _ColorB.rgb, saturate(foam));
                    col *= lerp(0.72, 1.12, lambert);
                    col += _ColorB.rgb * pow(1.0 - facing, 3.0) * _Shape.w;
                    a = 0.5 + 0.42 * saturate(foam) + 0.15 * streak;
                }
                else if (mode < 1.5)
                {
                    // 沙：颗粒疏密
                    float grain = smoothstep(0.25, 0.75, n3 * 0.6 + streak * 0.6);
                    col = lerp(_ColorA.rgb, _ColorB.rgb, grain);
                    col *= lerp(0.65, 1.1, lambert);
                    a = (0.35 + 0.55 * grain) * smoothstep(0.2, 0.55, streak + n3 * 0.3);
                }
                else if (mode < 2.5)
                {
                    // 熔浆：暗壳 + 发光熔流纹
                    float vein = 1.0 - smoothstep(0.0, 0.07, abs(streak - 0.5));
                    float hot = saturate(smoothstep(0.58, 0.88, streak) * 0.55 + vein * 0.85 + smoothstep(0.8, 0.95, n3) * 0.3);
                    col = lerp(_ColorA.rgb, _ColorB.rgb, hot);
                    a = 0.75 + 0.25 * hot;
                }
                else
                {
                    // 火：芯亮、边暗红
                    float core = smoothstep(0.45, 0.85, streak);
                    col = lerp(_ColorA.rgb, _ColorB.rgb, core);
                    a = smoothstep(0.25, 0.65, streak + n3 * 0.2);
                }
                a *= edge * vfade * keep * alpha;
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
