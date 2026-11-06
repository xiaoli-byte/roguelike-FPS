// 灵火破晓 · 镜面海子（彩林海子：静水倒映雪山、金色落叶松林和天上的云）。
// 倒影来自 PlanarReflection（Game/Scripts/Fx/Env/PlanarReflection.cs）：水面高度处的镜像相机每帧画一张 _PlanarReflectionTex，
// 这里按屏幕坐标取样，用水面法线的 xz 推一点做涟漪扭曲。没有平面反射（组件关了 / 画质低）时退回天空反射探针。
//   · 水体色：浅 → 深按水深（相机深度图：水面到水底的视线厚度），浅水透出湖底的卵石（半透明），深处墨绿；
//   · 倒影：菲涅尔（_FresnelBase 起步，掠射角趋近 1）× _ReflectionStrength；倒影色 × _ReflectionTint（实景里倒影比实物暗、偏绿）；
//   · 水面：两层慢速值噪声叠成很小的起伏（湖是静的），外加沿风向拉长的「风痕」带——一道道略皱的水面，倒影在那里被打碎；
//   · 岸边一圈细白边（结霜 / 浅水反光），太阳方向的星点高光；接收场景雾。半透明、不写深度、不投影。
Shader "Spiritfire/MirrorLake"
{
    Properties
    {
        _ShallowColor("Shallow Color", Color) = (0.32, 0.4, 0.3, 1)
        _DeepColor("Deep Color", Color) = (0.04, 0.14, 0.12, 1)
        _ReflectionTint("Reflection Tint", Color) = (0.84, 0.9, 0.84, 1)
        _ReflectionStrength("Reflection Strength", Range(0, 1.5)) = 1
        _FresnelBase("Fresnel Base", Range(0, 1)) = 0.32
        _Distortion("Ripple Distortion", Range(0, 0.1)) = 0.012
        _WaveScale("Ripple Scale (m)", Float) = 4
        _WaveSpeed("Ripple Speed", Float) = 0.35
        _WaveAmp("Ripple Slope", Range(0, 1)) = 0.12
        _StreakAmp("Wind Streak Slope", Range(0, 1)) = 0.25
        _StreakScale("Wind Streak Scale (m)", Float) = 26
        _StreakCover("Wind Streak Cover", Range(0, 1)) = 0.35
        _ShoreColor("Shore Line Color", Color) = (0.86, 0.9, 0.88, 1)
        _ShoreLine("Shore Line", Range(0, 1)) = 0.55
        _ShoreDepth("Shore Line Depth (m)", Float) = 0.18
        _DeepDepth("Depth Where Water Reads Deep (m)", Float) = 3.5
        _ClearDepth("Clear Water Depth (m)", Float) = 1.2
        _Sparkle("Sun Sparkles", Range(0, 2)) = 0.8
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent-40" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" "PreviewType"="Plane" }

        Pass
        {
            Name "MirrorLake"
            Tags { "LightMode"="UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Back

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            #pragma multi_compile_fragment _ _REFLECTION_PROBE_BLENDING
            #pragma multi_compile_fragment _ _REFLECTION_PROBE_BOX_PROJECTION

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _ShallowColor, _DeepColor, _ReflectionTint, _ShoreColor;
                half _ReflectionStrength, _FresnelBase, _Distortion, _WaveAmp, _StreakAmp, _StreakCover, _ShoreLine, _Sparkle;
                float _WaveScale, _WaveSpeed, _StreakScale, _ShoreDepth, _DeepDepth, _ClearDepth;
            CBUFFER_END

            TEXTURE2D(_PlanarReflectionTex);
            SAMPLER(sampler_PlanarReflectionTex);
            // PlanarReflection 写：1 = 本帧有平面反射
            float _PlanarReflectionOn;
            // WeatherDirector 写的全局风：xy = 风向（XZ），z = 风力 0..1
            float4 _WindDir;

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float fogFactor : TEXCOORD1;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

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

            // 水面起伏：两层慢速值噪声（细涟漪）
            float Ripple(float2 p, float t)
            {
                return VNoise(p + float2(t * 0.31, t * 0.17)) * 0.6 + VNoise(p * 2.3 + float2(-t * 0.23, t * 0.29) + 7.1) * 0.4;
            }

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                float3 ws = TransformObjectToWorld(v.positionOS.xyz);
                o.positionWS = ws;
                o.positionCS = TransformWorldToHClip(ws);
                o.fogFactor = ComputeFogFactor(o.positionCS.z);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float t = _Time.y * _WaveSpeed;
                float3 V = GetWorldSpaceNormalizeViewDir(i.positionWS);
                float2 xz = i.positionWS.xz;

                // ── 法线：细涟漪 + 风痕带 ──
                float scale = max(_WaveScale, 0.1);
                float2 p = xz / scale;
                const float e = 0.07;
                float h = Ripple(p, t), hx = Ripple(p + float2(e, 0), t), hz = Ripple(p + float2(0, e), t);
                float2 slope = float2(h - hx, h - hz) / e * _WaveAmp;
                // 风痕：沿风向拉长的低频噪声决定哪里起皱，起皱处叠一层更密的涟漪
                float2 wd = dot(_WindDir.xy, _WindDir.xy) > 1e-4 ? normalize(_WindDir.xy) : float2(0.8, 0.6);
                float2 sp = float2(dot(xz, wd) / (_StreakScale * 3.0), dot(xz, float2(-wd.y, wd.x)) / _StreakScale);
                float streak = smoothstep(1.0 - _StreakCover, 1.0 - _StreakCover + 0.18, VNoise(sp + float2(_Time.y * 0.02, 0)));
                if (streak > 0.001)
                {
                    float2 q = xz / (scale * 0.35);
                    float g = Ripple(q, t * 2.0), gx = Ripple(q + float2(e, 0), t * 2.0), gz = Ripple(q + float2(0, e), t * 2.0);
                    slope += float2(g - gx, g - gz) / e * _StreakAmp * streak;
                }
                float3 N = normalize(float3(slope.x, 1.0, slope.y));

                // ── 水深 ──
                float2 suv = GetNormalizedScreenSpaceUV(i.positionCS);
                float sceneEye = LinearEyeDepth(SampleSceneDepth(suv), _ZBufferParams);
                float thick = sceneEye > 0.0 ? max(0.0, sceneEye - i.positionCS.w) : 100.0;
                float vertical = thick * saturate(abs(V.y) + 0.1);
                float deep01 = saturate(vertical / max(0.1, _DeepDepth));
                float clear01 = saturate(vertical / max(0.05, _ClearDepth));

                // ── 倒影 ──
                float2 ruv = suv + N.xz * _Distortion;
                half3 refl;
                if (_PlanarReflectionOn > 0.5)
                    refl = SAMPLE_TEXTURE2D(_PlanarReflectionTex, sampler_PlanarReflectionTex, ruv).rgb;
                else
                    refl = GlossyEnvironmentReflection(reflect(-V, N), i.positionWS, 0.05, 1.0, suv);
                half ndv = saturate(dot(N, V));
                half F = _FresnelBase + (1.0 - _FresnelBase) * pow(1.0 - ndv, 5.0);
                half reflAmt = saturate(F * _ReflectionStrength);

                // ── 水体 ──
                Light light = GetMainLight();
                half3 body = lerp(_ShallowColor.rgb, _DeepColor.rgb, deep01);
                body *= light.color * 0.45 + SampleSH(half3(0, 1, 0)) * 0.7;
                half3 col = lerp(body, refl * _ReflectionTint.rgb, reflAmt);

                // 太阳星点高光
                float3 H = normalize(light.direction + V);
                half ndh = saturate(dot(N, H));
                half spec = smoothstep(0.996, 0.999, ndh) * _Sparkle * 3.0;
                col += light.color * spec;

                // 岸边细白边（水很浅的一圈，带噪声断续）
                half shore = 0;
                if (_ShoreLine > 0.001)
                {
                    float n1 = VNoise(xz * 1.7 + 3.3);
                    shore = (1.0 - smoothstep(0.0, _ShoreDepth * (0.6 + n1), vertical)) * _ShoreLine;
                    col = lerp(col, _ShoreColor.rgb * (light.color * 0.6 + 0.5), shore);
                }

                // 透明度：浅水透出湖底，倒影和白边不透
                half alpha = saturate(max(clear01 * 0.85 + deep01 * 0.15, max(reflAmt * 0.95, shore)));
                alpha = saturate(alpha + spec);

                col = MixFog(col, i.fogFactor);
                return half4(col, alpha);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
