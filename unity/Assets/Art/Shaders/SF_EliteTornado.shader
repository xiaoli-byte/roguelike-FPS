// 精英龙卷风体。实现参考 Scenes3D/vfx-tornado 的 twistedCylinder 双层噪声与地面径向 UV；按本项目 URP / 手绘色阶重写。
Shader "Spiritfire/EliteTornado"
{
    Properties
    {
        _ColorA("Dark / Body", Color) = (0.12, 0.24, 0.3, 1)
        _ColorB("Bright / Flow", Color) = (0.55, 0.85, 0.82, 1)
        _Mode("0 Dark, 1 Flow, 2 Ground", Float) = 1
        _Alpha("Global Alpha", Range(0, 1)) = 1
        _TimeScale("Flow Speed", Float) = 0.8
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Name "ForwardEliteTornado"
            Tags { "LightMode"="UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Off
            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _ColorA;
                half4 _ColorB;
                float _Mode;
                float _Alpha;
                float _TimeScale;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                half fog : TEXCOORD1;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output = (Varyings)0;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                output.fog = ComputeFogFactor(output.positionCS.z);
                return output;
            }

            float Hash(float2 p)
            {
                float3 p3 = frac(float3(p.xyx) * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return frac((p3.x + p3.y) * p3.z);
            }
            float Noise(float2 p)
            {
                float2 i = floor(p), f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(Hash(i), Hash(i + float2(1, 0)), f.x), lerp(Hash(i + float2(0, 1)), Hash(i + float2(1, 1)), f.x), f.y);
            }
            float2 Skew(float2 p, float2 amount)
            {
                return float2(p.x + p.y * amount.x, p.y + p.x * amount.y);
            }
            float BodyEffect(float2 p, float t)
            {
                float2 p1 = Skew(p + float2(t, -t), float2(-1, 0)) * float2(2, 0.25);
                float2 p2 = Skew(p + float2(t * 0.5, -t), float2(-1, 0)) * float2(5, 1);
                float fade = smoothstep(0, 0.1, p.y) * (1.0 - smoothstep(0.6, 1.0, p.y));
                return Noise(p1) * Noise(p2) * fade;
            }
            float GroundEffect(float2 p, float t)
            {
                float2 centered = p - 0.5;
                float distanceToCenter = length(centered);
                float angle = atan2(centered.y, centered.x) / 6.2831853 + 0.5;
                float2 radial = float2(angle, distanceToCenter);
                float2 p1 = Skew(radial * 0.5 + t, float2(-1, 0)) * float2(4, 1);
                float2 p2 = Skew(radial * float2(2, 8) + t * float2(2, 8), float2(-0.25, 0)) * float2(2, 0.25);
                float fade = (1.0 - smoothstep(0.1, 0.5, distanceToCenter)) * smoothstep(0, 0.2, distanceToCenter);
                return Noise(p1) * Noise(p2) * fade;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float t = _Time.y * _TimeScale;
                half3 col = _ColorA.rgb;
                float a = 0;
                if (_Mode < 0.5)
                {
                    float effect = BodyEffect(input.uv, t + 12.34);
                    col = _ColorA.rgb * lerp(0.65, 1.05, smoothstep(0.05, 0.5, effect));
                    a = effect * 0.7;
                }
                else if (_Mode < 1.5)
                {
                    float effect = BodyEffect(input.uv, t);
                    col = lerp(_ColorA.rgb, _ColorB.rgb, smoothstep(0.06, 0.52, effect));
                    a = effect * 0.9;
                }
                else
                {
                    float effect = GroundEffect(input.uv, t);
                    col = lerp(_ColorA.rgb, _ColorB.rgb, smoothstep(0.04, 0.45, effect));
                    a = effect * 1.1;
                }
                a = saturate(a * _Alpha);
                clip(a - 0.004);
                return half4(MixFog(col, input.fog), a);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
