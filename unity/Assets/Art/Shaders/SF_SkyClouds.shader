// 灵火破晓 · 渐变天空 + 卡通积云（彩林海子：川西秋天的深蓝天、团团白云；镜面湖里倒映出同一片云）。
// 渐变 / 地平线辉光 / 太阳光晕同 SkyGradient；云是天穹投影到一块「云层平面」上的分形噪声（不加几何体，天空反射、反射探针都带着云）：
//   · 形状：两级扭曲的值噪声分形，按覆盖率阈值切出轮廓（_CloudSoftness 控制边缘软硬，卡通云边缘偏硬）；
//     _CloudRegion = 云多的方位（xz 方向 + 强度）：那边覆盖率加、对面减，画面一侧成团、另一侧晴空；
//   · 明暗：朝太阳方向偏移再取一次噪声，迎光边亮白、背光的云底压成灰蓝（两档阶梯），薄处透亮（银边）；
//   · 第二层高空丝缕云：沿风向拉长的噪声，很淡；
//   · 地平线附近淡出（云层平面投影在地平线处会无限拉长），整层随时间按 _CloudWind 缓慢漂移。
Shader "Spiritfire/SkyClouds"
{
    Properties
    {
        _TopColor("Zenith", Color) = (0.1, 0.36, 0.82, 1)
        _HorizonColor("Horizon", Color) = (0.62, 0.8, 0.96, 1)
        _BottomColor("Ground", Color) = (0.4, 0.45, 0.45, 1)
        _HorizonSharpness("Horizon Sharpness", Range(0.5, 8)) = 2.2
        _HorizonGlow("Horizon Glow", Range(0, 2)) = 0.25
        _SunColor("Sun Color", Color) = (1, 0.96, 0.88, 1)
        _SunSize("Sun Size", Range(0.001, 0.2)) = 0.02
        _SunHalo("Sun Halo", Range(0, 2)) = 0.5
        _Exposure("Exposure", Range(0, 4)) = 1

        _CloudLit("Cloud Lit", Color) = (1, 1, 1, 1)
        _CloudShadow("Cloud Shadow", Color) = (0.66, 0.74, 0.88, 1)
        _CloudCover("Cloud Cover", Range(0, 1)) = 0.42
        _CloudSoftness("Cloud Edge Softness", Range(0.005, 0.5)) = 0.06
        _CloudScale("Cloud Scale", Float) = 0.9
        _CloudOpacity("Cloud Opacity", Range(0, 1)) = 1
        _CloudRegion("Cloud Region (xz dir, z strength)", Vector) = (-0.7, 0.7, 0.25, 0)
        _CloudWind("Cloud Wind (xy dir, z speed)", Vector) = (1, 0.3, 0.004, 0)
        _CloudLightK("Cloud Light Contrast", Float) = 6
        _WispOpacity("Wisp Opacity", Range(0, 1)) = 0.35
    }
    SubShader
    {
        Tags { "Queue"="Background" "RenderType"="Background" "PreviewType"="Skybox" "RenderPipeline"="UniversalPipeline" }
        Cull Off ZWrite Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _TopColor, _HorizonColor, _BottomColor, _SunColor;
                half _HorizonSharpness, _HorizonGlow, _SunSize, _SunHalo, _Exposure;
                half4 _CloudLit, _CloudShadow;
                half _CloudCover, _CloudSoftness, _CloudOpacity, _WispOpacity;
                float _CloudScale, _CloudLightK;
                float4 _CloudRegion, _CloudWind;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings { float4 positionCS : SV_POSITION; float3 dir : TEXCOORD0; UNITY_VERTEX_OUTPUT_STEREO };

            Varyings Vert(Attributes v)
            {
                Varyings o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.dir = v.positionOS.xyz;
                return o;
            }

            float Hash21(float2 p)
            {
                p = frac(p * float2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return frac(p.x * p.y);
            }

            float VNoise(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                float2 u = f * f * (3.0 - 2.0 * f);
                float a = Hash21(i), b = Hash21(i + float2(1, 0)), c = Hash21(i + float2(0, 1)), d = Hash21(i + float2(1, 1));
                return lerp(lerp(a, b, u.x), lerp(c, d, u.x), u.y);
            }

            float Fbm(float2 p, int oct)
            {
                float s = 0, a = 0.5, n = 0;
                [unroll(6)] for (int k = 0; k < oct; k++)
                {
                    s += VNoise(p) * a;
                    n += a;
                    p = float2(p.x * 1.6 - p.y * 1.2, p.x * 1.2 + p.y * 1.6) + 17.3;
                    a *= 0.5;
                }
                return s / n;
            }

            // 积云密度：扭曲过的分形，偏「一团一团」（低频底子 × 中频鼓包）
            float CloudDensity(float2 p)
            {
                float2 w = float2(Fbm(p * 0.5 + 3.1, 3), Fbm(p * 0.5 - 7.7, 3));
                float2 q = p + (w - 0.5) * 1.6;
                float base = Fbm(q, 5);
                float puff = Fbm(q * 2.3 + 11.0, 3);
                return base * 0.75 + puff * 0.25;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                float3 d = normalize(i.dir);
                float up = d.y;
                half3 sky = lerp(_HorizonColor.rgb, _TopColor.rgb, pow(saturate(up), 1.0 / _HorizonSharpness));
                half3 ground = lerp(_HorizonColor.rgb, _BottomColor.rgb, saturate(-up * 4.0));
                half3 c = up >= 0 ? sky : ground;
                c += _HorizonColor.rgb * _HorizonGlow * exp(-abs(up) * 12.0);

                float3 sunDir = _MainLightPosition.xyz;
                float s = dot(d, sunDir);

                // ── 云 ──
                if (up > 0.0)
                {
                    float2 layer = d.xz / (up + 0.12) * _CloudScale;
                    float2 drift = normalize(_CloudWind.xy + 1e-4) * _CloudWind.z * _Time.y * 60.0;
                    float2 p = layer + drift;
                    float dens = CloudDensity(p);
                    float2 az = normalize(d.xz + 1e-5);
                    float cover = saturate(_CloudCover + dot(az, normalize(_CloudRegion.xy + 1e-4)) * _CloudRegion.z);
                    float th = 1.0 - cover;
                    float mask = smoothstep(th, th + _CloudSoftness, dens);
                    // 朝太阳偏一点再取：迎光边密度掉得快 → 亮
                    float2 toSun = normalize(sunDir.xz + 1e-4) * 0.09;
                    float dens2 = CloudDensity(p + toSun);
                    float lit = saturate(0.5 + (dens - dens2) * _CloudLightK);
                    // 厚处偏暗（云底），薄处透亮
                    float thick = saturate((dens - th) / max(0.05, 1.0 - th) * 1.6);
                    lit = saturate(lit + (1.0 - thick) * 0.45 - thick * 0.25);
                    lit = smoothstep(0.38, 0.62, lit);
                    half3 cloud = lerp(_CloudShadow.rgb, _CloudLit.rgb, lit);
                    // 太阳附近的云被照透
                    cloud += _SunColor.rgb * pow(saturate(s), 24.0) * 0.35 * (1.0 - thick);
                    float fade = smoothstep(0.02, 0.2, up);
                    c = lerp(c, cloud, mask * fade * _CloudOpacity);

                    // 高空丝缕云：沿风向拉长
                    float2 wd = normalize(_CloudWind.xy + 1e-4);
                    float2 wp = float2(dot(layer, wd) * 0.35, dot(layer, float2(-wd.y, wd.x)) * 2.6) + drift * 0.6 + 40.0;
                    float wisp = smoothstep(0.58, 0.8, Fbm(wp, 4)) * smoothstep(0.08, 0.35, up) * (1.0 - mask);
                    c = lerp(c, _CloudLit.rgb, wisp * _WispOpacity);
                }

                half disc = smoothstep(1.0 - _SunSize, 1.0 - _SunSize * 0.6, s);
                half halo = pow(saturate(s), 64.0) * _SunHalo + pow(saturate(s), 8.0) * _SunHalo * 0.25;
                c += _SunColor.rgb * (disc * 6.0 + halo);
                return half4(c * _Exposure, 1);
            }
            ENDHLSL
        }
    }
}
