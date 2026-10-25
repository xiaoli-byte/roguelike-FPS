// 特效冰（docs/unity-parity.md FX3）：霜甲壳、冰刺这类程序化的多面冰。
// 网格是平直着色的（每个三角形三个独立顶点，FxIceMeshes 生成）：顶点色 rgb = 重心坐标（三条棱的距离，画棱边高光），uv.y = 归一化高度（0 底、1 顶）。
// 半透明（_BaseColor.a = 厚度）：薄薄的冰体（环境光 + 主光的软阴影）+ 菲涅尔（边缘更厚、更白）+ 棱边一圈 HDR 冷光 + 一点阶梯高光；预乘 alpha（Blend One OneMinusSrcAlpha）。
// 每个实例的参数走 MaterialPropertyBlock：_Params x = 不透明度，y = 结冰进度（uv.y 高于它的部分裁掉，前沿一道亮线：「从脚下往上冻」），
//   z = 裂（0..1：冰体发白变浑、棱边更亮，快碎了），w = 额外发光（刚结上 / 前摇时提亮）。
Shader "Spiritfire/FxIce"
{
    Properties
    {
        _BaseColor("Ice Color", Color) = (0.62, 0.86, 1, 1)
        [HDR] _EdgeColor("Edge Color", Color) = (1.3, 2.0, 2.6, 1)
        _Params("Params (x Alpha, y Show, z Crack, w Glow)", Vector) = (1, 1, 0, 0)
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent-20" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }

        Pass
        {
            Name "ForwardIce"
            Tags { "LightMode"="UniversalForward" }
            Blend One OneMinusSrcAlpha
            ZWrite Off
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
                half4 _BaseColor;
                half4 _EdgeColor;
                float4 _Params;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                half4 color : COLOR;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                half3 bary : TEXCOORD3;
                half fog : TEXCOORD4;
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
                o.uv = v.uv;
                o.bary = v.color.rgb;
                o.fog = ComputeFogFactor(p.positionCS.z);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                float show = _Params.y;
                clip(show + 0.0005 - i.uv.y);
                half alpha0 = saturate(_Params.x);
                half crack = saturate(_Params.z);

                half3 N = normalize(i.normalWS);
                half3 V = GetWorldSpaceNormalizeViewDir(i.positionWS);
                Light L = GetMainLight();
                half ndl = saturate(dot(N, L.direction) * 0.55 + 0.45);
                half3 amb = SampleSH(N);
                half fres = pow(1.0 - saturate(dot(N, V)), 3.0);
                half3 H = normalize(L.direction + V);
                half spec = pow(saturate(dot(N, H)), 64.0);

                // 棱边：到三条边的最近距离（重心坐标的最小分量），按屏幕导数保持 1–2 像素的线宽
                half e = min(i.bary.x, min(i.bary.y, i.bary.z));
                half w = fwidth(e);
                half edge = 1.0 - smoothstep(w * 0.4, w * 1.1 + 0.004 * (1.0 + crack), e);
                // 棱边往里一圈磨砂的霜（比一条硬线更像冰）；每个面的通透度按面法线哈希错开一点
                half frost = 1.0 - smoothstep(0.0, 0.2, e);
                half facet = frac(sin(dot(round(N * 8.0), half3(12.9898, 78.233, 37.719))) * 43758.5453);
                // 结冰前沿：uv.y ≈ show 的一道亮线（冻满之后就没有了）
                half front = (1.0 - smoothstep(0.0, 0.05, abs(i.uv.y - show))) * step(show, 0.995);

                half3 tint = lerp(_BaseColor.rgb, half3(0.9, 0.96, 1.0), saturate(crack * 0.6 + frost * 0.5));
                half3 body = tint * (amb * 0.9 + L.color * ndl * 0.5);
                // _BaseColor.a = 冰的「厚度」：1 = 霜甲壳那样的薄壳，2 以上 = 冰刺这类几乎不透明的实冰
                half a = saturate(_BaseColor.a * (0.24 + 0.12 * facet + 0.55 * fres) + frost * 0.22 + 0.25 * crack + edge * 0.2) * alpha0;
                half glow = 1.0 + _Params.w;
                half3 col = body * a;
                col += (_EdgeColor.rgb * (edge * (0.16 + 0.4 * crack) + front * 1.2 + fres * 0.2) + L.color * spec * 0.35 * (1.0 - crack * 0.5)) * alpha0 * glow;
                col = MixFogColor(col, unity_FogColor.rgb * a, i.fog);
                return half4(col, a);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
