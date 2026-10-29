// 冰晶碎块（特效打磨收尾一轮：冰爆 FrostNova 的主形，FrostBurst 池化的低多边形冰晶）。docs/art/fx-style.md §三「冰」：
//   块面清楚的冰晶多面体，亮面白、暗面冰蓝，不追求写实的透明折射——所以这里是不透明的卡通冰：
//   每个面按主光分三阶（亮面 _Light 近白 / 主色 _Main 冰蓝 / 暗面 _Dark 蓝灰），阶与阶之间是 1–2 像素的硬台阶，
//   面与面的明暗再按面法线哈希错开一点（低多边形的切面感）；棱边一道蓝灰的暗线（_Edge，「暗边蓝灰」），不是白线。
// 网格（FrostBurst.BuildCrystal）：每个三角形独立顶点、面法线；顶点色 rgb = 「到棱的距离」（重心坐标，四边形对角线那条边的分量抬高，不画）。
// 每个实例的参数走 MaterialPropertyBlock：_Params x = 碎掉（0..1：按面哈希一块块整面掉，冰晶碎成几片再消失），y = 闪亮（刚炸开那一下往亮面推），z = 种子。
// 离镜头 1.6 m 以内的面也一块块掉（贴脸的冰爆不挡屏）。不投影、不写阴影。
Shader "Spiritfire/FxCrystal"
{
    Properties
    {
        _Light("Lit Face", Color) = (0.8, 0.92, 0.99, 1)
        _Main("Main (Ice Blue)", Color) = (0.36, 0.66, 0.93, 1)
        _Dark("Dark Face (Blue Grey)", Color) = (0.22, 0.36, 0.58, 1)
        _Edge("Edge Line", Color) = (0.15, 0.25, 0.42, 1)
        _Params("Params (x Shatter, y Flash, z Seed)", Vector) = (0, 0, 0, 0)
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry+50" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }

        Pass
        {
            Name "ForwardCrystal"
            Tags { "LightMode"="UniversalForward" }
            ZWrite On
            Cull Back

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _Light;
                half4 _Main;
                half4 _Dark;
                half4 _Edge;
                float4 _Params;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                half4 color : COLOR;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                half3 bary : TEXCOORD2;
                half fog : TEXCOORD3;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

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
                o.bary = v.color.rgb;
                o.fog = ComputeFogFactor(p.positionCS.z);
                return o;
            }

            half CrystalStep(half v, half edge)
            {
                half w = max(fwidth(v), 1e-3) * 1.2;
                return saturate((v - edge) / w + 0.5);
            }

            half4 Frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                half3 N = normalize(i.normalWS);
                // 面哈希：同一个面上是常数（面法线 + 种子），决定这一面的明暗错位、碎掉的先后
                half facet = frac(sin(dot(round(N * 9.0) + _Params.z, half3(12.9898, 78.233, 37.719))) * 43758.5453);
                float camDist = distance(i.positionWS, _WorldSpaceCameraPos);
                half near = 1.0 - saturate((camDist - 0.5) / 1.1);
                clip(facet - max(saturate(_Params.x), near) * 1.02 + 0.01);

                Light L = GetMainLight();
                half ndl = dot(N, L.direction) * 0.5 + 0.5;
                half v = ndl + (facet - 0.5) * 0.3 + saturate(_Params.y) * 0.25;
                // 亮面只给最朝光的那几面（逆光、顺光都是冰蓝为主，不会整簇发白）
                half lit = CrystalStep(v, 0.8), mid = CrystalStep(v, 0.36);
                half3 col = lerp(_Dark.rgb, _Main.rgb, mid);
                col = lerp(col, _Light.rgb, lit);
                // 场景太暗时（夜里的冰窟）跟着压一点，但不压到发黑
                half lum = saturate(dot(L.color, half3(0.3, 0.59, 0.11)));
                col *= lerp(0.78, 1.0, lum);

                // 棱边：到棱的最近距离（按屏幕导数 1–1.5 像素宽），蓝灰暗线
                half e = min(i.bary.x, min(i.bary.y, i.bary.z));
                half ew = fwidth(e);
                half edge = 1.0 - smoothstep(ew * 0.5, ew * 1.5, e);
                col = lerp(col, _Edge.rgb, edge * 0.85);

                col = MixFog(col, i.fog);
                return half4(col, 1);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
