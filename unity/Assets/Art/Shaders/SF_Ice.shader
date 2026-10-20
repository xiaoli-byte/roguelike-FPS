// 灵火破晓 · 风格化冰面（docs/unity-parity.md L8；冰河、冰潭、敌人留下的冰斑 / 冻带）。半透明、不写深度，贴在地面 / 白盒条带的顶面上。
// 全部按世界坐标 XZ 取样（白盒方块、圆片、方片都不用 UV），所以拼接的冰面纹理连续：
//   · 两层 Voronoi 裂纹（细胞边界 F2 − F1 的细线），大裂纹亮、细裂纹淡；细胞内部按到中心的距离在浅冰色 / 深冰色之间过渡（冰层厚薄）；
//   · 霜：低频噪声把一部分冰面盖成雾白（_Frost）；
//   · 主光：半兰伯特 + 环境球谐，高光尖锐，外加按视角闪烁的冰晶亮点（_Sparkle）；掠射角菲涅尔泛白、也更不透明；
//   · _Fade：限时冰斑 / 冻带的淡出（MaterialPropertyBlock 写）；_EdgeSoft > 0 时按 uv 圆心距做软边（圆片冰斑，同样走 MaterialPropertyBlock）。
// 接收场景雾。不投影、不收影（透明物体没有屏幕空间阴影）。
Shader "Spiritfire/Ice"
{
    Properties
    {
        _ShallowColor("Shallow Color", Color) = (0.74, 0.9, 1, 0.55)
        _DeepColor("Deep Color", Color) = (0.22, 0.48, 0.74, 0.85)
        _CrackColor("Crack Color", Color) = (0.93, 0.98, 1, 1)
        _RimColor("Rim Color", Color) = (0.86, 0.95, 1, 1)
        _CrackScale("Crack Scale (m)", Float) = 1.6
        _CrackWidth("Crack Width", Range(0.005, 0.25)) = 0.05
        _Frost("Frost", Range(0, 1)) = 0.3
        _Sparkle("Sparkle", Range(0, 3)) = 0.8
        _Alpha("Opacity", Range(0, 1)) = 1
        _Fade("Fade", Range(0, 1)) = 1
        _EdgeSoft("Edge Softness (disc uv)", Range(0, 1)) = 0
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent-50" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" "PreviewType"="Plane" }

        Pass
        {
            Name "Ice"
            Tags { "LightMode"="UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Back
            Offset -1, -1

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _ShallowColor;
                half4 _DeepColor;
                half4 _CrackColor;
                half4 _RimColor;
                float _CrackScale;
                float _CrackWidth;
                half _Frost;
                half _Sparkle;
                half _Alpha;
                half _Fade;
                half _EdgeSoft;
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
                float3 positionWS : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                float fogFactor : TEXCOORD3;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            float2 Hash22(float2 p)
            {
                p = float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3)));
                return frac(sin(p) * 43758.5453);
            }

            float Hash21(float2 p)
            {
                return frac(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
            }

            float ValueNoise(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                float2 u = f * f * (3.0 - 2.0 * f);
                float a = Hash21(i), b = Hash21(i + float2(1, 0)), c = Hash21(i + float2(0, 1)), d = Hash21(i + float2(1, 1));
                return lerp(lerp(a, b, u.x), lerp(c, d, u.x), u.y);
            }

            // Voronoi：x = 到最近细胞中心的距离（F1），y = 细胞边界距离（F2 − F1，裂纹）
            float2 Voronoi(float2 p)
            {
                float2 n = floor(p);
                float2 f = frac(p);
                float f1 = 8.0, f2 = 8.0;
                [unroll] for (int j = -1; j <= 1; j++)
                [unroll] for (int i = -1; i <= 1; i++)
                {
                    float2 g = float2(i, j);
                    float2 r = g + Hash22(n + g) - f;
                    float d = dot(r, r);
                    if (d < f1) { f2 = f1; f1 = d; }
                    else if (d < f2) { f2 = d; }
                }
                f1 = sqrt(f1);
                f2 = sqrt(f2);
                return float2(f1, f2 - f1);
            }

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                VertexPositionInputs pos = GetVertexPositionInputs(v.positionOS.xyz);
                o.positionCS = pos.positionCS;
                o.positionWS = pos.positionWS;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.uv = v.uv;
                o.fogFactor = ComputeFogFactor(pos.positionCS.z);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float3 N = normalize(i.normalWS);
                float3 V = GetWorldSpaceNormalizeViewDir(i.positionWS);
                float2 xz = i.positionWS.xz;

                // 裂纹与冰层厚薄
                float scale = max(_CrackScale, 0.05);
                float2 big = Voronoi(xz / scale);
                float2 fine = Voronoi(xz / (scale * 0.37) + 13.17);
                float px = max(fwidth(xz.x), fwidth(xz.y)) / scale;
                float w = max(_CrackWidth, px * 1.5);
                float crack = (1.0 - smoothstep(0.0, w, big.y)) + 0.45 * (1.0 - smoothstep(0.0, w * 0.7, fine.y));
                float thick = smoothstep(0.05, 0.75, big.x) * 0.7 + ValueNoise(xz * 0.35) * 0.3;
                half3 col = lerp(_ShallowColor.rgb, _DeepColor.rgb, thick);
                half alpha = lerp(_ShallowColor.a, _DeepColor.a, thick);

                // 霜
                float frost = smoothstep(0.55, 0.85, ValueNoise(xz * 0.22 + 4.1) * 0.7 + ValueNoise(xz * 1.3) * 0.3) * _Frost;
                col = lerp(col, half3(0.92, 0.96, 1.0), frost);
                alpha = max(alpha, frost * 0.9);

                // 光照：半兰伯特 + 球谐
                Light light = GetMainLight();
                half ndl = saturate(dot(N, light.direction)) * 0.5 + 0.5;
                half3 lit = col * (light.color * ndl * 0.85 + SampleSH(N) * 0.45);
                lit = lerp(lit, _CrackColor.rgb * (light.color * 0.6 + 0.5), saturate(crack) * 0.75);

                // 高光 + 冰晶闪点（按视角跳动，不随时间闪）
                float3 H = normalize(light.direction + V);
                half spec = pow(saturate(dot(N, H)), 160.0) * 1.6;
                float2 cell = floor(xz * 9.0);
                float glintSeed = Hash21(cell);
                half glint = step(0.993, frac(glintSeed * 7.13 + dot(V, float3(2.7, 1.9, 3.3)))) * step(0.6, glintSeed) * _Sparkle;
                lit += light.color * (spec + glint) * (1.0 - frost * 0.6);

                // 菲涅尔：掠射角泛白、更不透明
                half fres = pow(1.0 - saturate(dot(N, V)), 3.0);
                lit = lerp(lit, _RimColor.rgb * (light.color * 0.5 + 0.6), fres * 0.55);
                alpha = saturate(alpha + fres * 0.25 + saturate(crack) * 0.2) * _Alpha;

                // 圆片软边（uv 中心 0.5）与淡出
                half edge = 1.0;
                if (_EdgeSoft > 0.001)
                {
                    float r = length(i.uv - 0.5) * 2.0;
                    edge = 1.0 - smoothstep(1.0 - _EdgeSoft, 1.0, r);
                }
                alpha *= edge * _Fade;

                lit = MixFog(lit, i.fogFactor);
                return half4(lit, saturate(alpha));
            }
            ENDHLSL
        }
    }

    Fallback Off
}
