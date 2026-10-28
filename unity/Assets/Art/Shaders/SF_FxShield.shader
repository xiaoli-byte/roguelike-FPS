// 护盾球壳（特效打磨 B 路）：罩在有护盾的敌人身上的六边形能量壳（ShieldBubble：戈德堡多面体，30 个六边形 + 12 个五边形的大龟甲格，单位球、按身体包围盒缩放成椭球）。
// 网格顶点：uv0.x = 格内径向坐标（0 格心 → 1 格边，画格边亮线），uv0.y = 每格随机数；uv1.xyz = 格心方向（整格共用：涟漪按格点亮，读作「六边形一格一格亮过去」）。
// 每个实例的参数走 MaterialPropertyBlock：
//   _Params x = 可见度（受击时亮起、1 s 后淡出），y = 破碎进度（0..1：每一格沿格心方向飞出、缩小、下坠、淡掉），z = 整体闪白，w = 种子；
//   _Hit0..3 xyz = 命中方向（物体空间），w = 距命中过了几秒（> 1.2 = 没有）：命中那一格闪白，一圈涟漪以 4 rad/s 沿球面扩散。
// 混合：预乘、几乎纯加法（只压暗身后 30%）；双面（看得到球壳背面的格子，更像一个罩子）。HDR 偏亮让 Bloom 吃到格边。
Shader "Spiritfire/FxShield"
{
    Properties
    {
        [HDR] _Color("Color (linear)", Color) = (0.3, 0.85, 2.2, 1)
        _Params("Params (x Visible, y Shatter, z Flash, w Seed)", Vector) = (1, 0, 0, 0)
        _Hit0("Hit 0 (xyz dir, w age)", Vector) = (0, 1, 0, 99)
        _Hit1("Hit 1", Vector) = (0, 1, 0, 99)
        _Hit2("Hit 2", Vector) = (0, 1, 0, 99)
        _Hit3("Hit 3", Vector) = (0, 1, 0, 99)
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent-10" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }

        Pass
        {
            Name "ForwardShield"
            Tags { "LightMode"="UniversalForward" }
            Blend One OneMinusSrcAlpha
            ZWrite Off
            Cull Off

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _Color;
                float4 _Params;
                float4 _Hit0;
                float4 _Hit1;
                float4 _Hit2;
                float4 _Hit3;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                float3 cell : TEXCOORD1;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                float3 cell : TEXCOORD3;
                half fog : TEXCOORD4;
            };

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                float3 p = v.positionOS.xyz;
                float3 cc = v.cell;
                float s = _Params.y;
                if (s > 0.0)
                {
                    // 破碎：每格绕着格心缩小、沿格心方向飞出、下坠（物体空间：单位 = 身体半径）
                    float rnd = v.uv.y;
                    float fly = s * (0.9 + rnd * 1.1) + s * s * 0.5;
                    p = cc + (p - cc) * (1.0 - s * 0.55);
                    p += cc * fly;
                    p.y -= s * s * (0.7 + rnd * 0.8);
                }
                VertexPositionInputs pi = GetVertexPositionInputs(p);
                o.positionCS = pi.positionCS;
                o.positionWS = pi.positionWS;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.uv = v.uv;
                o.cell = cc;
                o.fog = ComputeFogFactor(pi.positionCS.z);
                return o;
            }

            void Ripple(float4 hit, float3 cell, inout half wave, inout half flash)
            {
                float age = hit.w;
                if (age > 1.2) return;
                float3 d = normalize(hit.xyz + 1e-5);
                float ang = acos(clamp(dot(cell, d), -1.0, 1.0));
                float r = age * 4.0;
                // 格子是 42 格的大龟甲：涟漪带、命中那一格的角宽都按格距放大
                wave = max(wave, saturate(1.0 - abs(ang - r) / 0.62) * saturate(1.0 - age / 0.85));
                flash = max(flash, saturate(1.0 - ang / 0.5) * saturate(1.0 - age / 0.32));
            }

            half4 Frag(Varyings i, FRONT_FACE_TYPE face : FRONT_FACE_SEMANTIC) : SV_Target
            {
                float3 cell = normalize(i.cell);
                half wave = 0, flash = 0;
                Ripple(_Hit0, cell, wave, flash);
                Ripple(_Hit1, cell, wave, flash);
                Ripple(_Hit2, cell, wave, flash);
                Ripple(_Hit3, cell, wave, flash);

                half3 N = normalize(i.normalWS);
                half3 V = GetWorldSpaceNormalizeViewDir(i.positionWS);
                half fres = pow(1.0 - saturate(abs(dot(N, V))), 2.2);
                half e = i.uv.x;
                half ew = max(fwidth(e), 1e-3);
                half edgeLine = saturate((e - 0.8) / (ew * 1.5) + 0.5);
                half vis = saturate(_Params.x);
                half s = saturate(_Params.y);
                // 背面淡一半（看得到另一侧的格子，但不抢正面）
                half side = IS_FRONT_VFACE(face, 1.0, 0.45);

                // 平时只看得到一层淡淡的格边（菲涅尔边缘更亮）；涟漪扫过的格子、命中的那一格才亮起来
                // 风格审查：命中格、破盾的闪白收一档（原来整壳一下子白成一个蛋），亮的是格边，格面只淡淡一层
                half fill = 0.015 + 0.07 * fres + wave * 0.28 + flash * 0.5 + _Params.z * 0.18;
                half edge = edgeLine * (0.14 + 0.45 * fres + wave * 1.2 + flash * 0.9 + _Params.z * 0.55);
                // 破碎时每一格先亮一下再淡掉
                half burst = s > 0.0 ? (1.0 + 0.6 * (1.0 - s)) : 1.0;
                half k = vis * side * (1.0 - s * s);
                // 加色部分直接按强度出（不再乘一次不透明度，否则亮度是强度的平方，平时的格子几乎看不见）
                half3 col = _Color.rgb * (fill + edge * 1.5) * burst * k;
                half a = saturate(fill + edge) * k;
                col = MixFogColor(col, half3(0, 0, 0), i.fog);
                return half4(col, a * 0.2);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
