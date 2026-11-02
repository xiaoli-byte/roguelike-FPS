// Scenes3D/vfx-tornado 实现级移植：原始 perlinTexture、双层噪声、暗层 / 发光层与地面径向 UV。
Shader "Spiritfire/ScenesTornado"
{
    Properties
    {
        _MainTex("Perlin", 2D) = "white" {}
        _EmissiveColor("Emissive", Color) = (1, 0.545, 0.302, 1)
        _TimeScale("Time Scale", Float) = 0.15
        _Mode("0 Dark, 1 Emissive, 2 Floor", Float) = 1
        _Alpha("Global Alpha", Float) = 1
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Name "ForwardScenesTornado"
            Tags { "LightMode"="UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Off
            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            TEXTURE2D(_MainTex);
            SAMPLER(sampler_MainTex);
            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                half4 _EmissiveColor;
                float _TimeScale;
                float _Mode;
                float _Alpha;
            CBUFFER_END
            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                return output;
            }
            float2 Skew(float2 p, float2 skew) { return float2(p.x + p.y * skew.x, p.y + p.x * skew.y); }
            float Remap(float v, float low, float high) { return saturate((v - low) / (high - low)); }
            float2 RadialUv(float2 p, float2 multiplier, float rotation, float offset)
            {
                float2 centered = p - 0.5;
                float distanceToCenter = length(centered);
                float angle = atan2(centered.y, centered.x);
                float2 radial = float2((angle + 3.1415926) / 6.2831853, distanceToCenter) * multiplier;
                radial.x += rotation;
                radial.y += offset;
                return radial;
            }
            float BodyEffect(float2 p, float t)
            {
                float2 p1 = Skew(p + float2(t, -t), float2(-1, 0)) * float2(2, 0.25);
                float2 p2 = Skew(p + float2(t * 0.5, -t), float2(-1, 0)) * float2(5, 1);
                float n1 = Remap(SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, p1).r, 0.45, 0.7);
                float n2 = Remap(SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, p2).g, 0.45, 0.7);
                float fade = min(smoothstep(0, 0.1, p.y), 1.0 - smoothstep(0.6, 1.0, p.y));
                return n1 * n2 * fade;
            }
            float DarkEffect(float2 p, float t)
            {
                float2 p1 = Skew(p + float2(t, -t), float2(-1, 0)) * float2(2, 0.25);
                float2 p2 = Skew(p + float2(t * 0.5, -t), float2(-1, 0)) * float2(5, 1);
                float n1 = Remap(SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, p1).g, 0.45, 0.7);
                float n2 = Remap(SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, p2).b, 0.45, 0.7);
                float fade = min(smoothstep(0, 0.2, p.y), 1.0 - smoothstep(0.6, 1.0, p.y));
                return n1 * n2 * fade;
            }
            float FloorEffect(float2 p, float t)
            {
                float2 p1 = Skew(RadialUv(p, 0.5, t, t), float2(-1, 0)) * float2(4, 1);
                float2 p2 = Skew(RadialUv(p, float2(2, 8), t * 2, t * 8), float2(-0.25, 0)) * float2(2, 0.25);
                float n1 = Remap(SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, p1).r, 0.45, 0.7);
                float n2 = Remap(SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, p2).b, 0.45, 0.7);
                float2 centered = p - 0.5;
                float d = length(centered);
                float fade = min(1.0 - smoothstep(0.1, 0.5, d), smoothstep(0, 0.2, d));
                return n1 * n2 * fade;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                float t = _Time.y * _TimeScale;
                half3 col = 0;
                float a = 0;
                if (_Mode < 0.5)
                {
                    a = smoothstep(0, 0.01, DarkEffect(input.uv, t + 123.4)) * 0.72;
                }
                else if (_Mode < 1.5)
                {
                    float effect = BodyEffect(input.uv, t);
                    float luminance = dot(_EmissiveColor.rgb, half3(0.2126, 0.7152, 0.0722));
                    col = _EmissiveColor.rgb * 0.65 / max(0.001, luminance);
                    a = smoothstep(0, 0.01, effect);
                }
                else
                {
                    float effect = FloorEffect(input.uv, t);
                    col = _EmissiveColor.rgb * step(0.2, effect) * 3;
                    a = smoothstep(0, 0.01, effect);
                }
                a *= _Alpha;
                clip(a - 0.002);
                return half4(col, a);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
