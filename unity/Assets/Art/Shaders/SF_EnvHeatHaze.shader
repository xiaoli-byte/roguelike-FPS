// 灵火破晓 · 热浪扭曲（特效打磨 D 路，EnvHeatHaze）：熔岩面上立着的一片竖直面片，读 URP 的相机不透明贴图（_CameraOpaqueTexture，PC 管线开着），
// 按两层往上走的噪声错开采样坐标——身后的景物在熔岩上方微微抖动。底部最强、往上和左右两边淡掉；离相机远了也淡掉（远处一片抖动会糊）；
// 再按 _Fade（EnvHeatHaze 用 MaterialPropertyBlock 写）淡入淡出。整片只是挪像素，不加颜色，只带一点点暖色偏移。
// 透明队列最后画（Transparent+50）：它身后的半透明物体（火星、预警）会被不透明贴图盖掉一点，所以强度压得很低、面积不大。
Shader "Spiritfire/EnvHeatHaze"
{
    Properties
    {
        _Strength("Distortion (screen uv)", Range(0, 0.02)) = 0.004
        _Scale("Noise Scale", Float) = 2.2
        _Speed("Rise Speed", Float) = 0.9
        _Warm("Warm Tint", Range(0, 0.2)) = 0.04
        _Fade("Fade", Range(0, 1)) = 1
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+50" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }

        Pass
        {
            Name "HeatHaze"
            Tags { "LightMode"="UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            ZTest LEqual
            Cull Off

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareOpaqueTexture.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half _Strength;
                float _Scale;
                float _Speed;
                half _Warm;
                half _Fade;
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
                float3 positionWS : TEXCOORD1;
            };

            float H21(float2 p) { return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }

            float VNoise(float2 p)
            {
                float2 i = floor(p), f = frac(p), u = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(H21(i), H21(i + float2(1, 0)), u.x), lerp(H21(i + float2(0, 1)), H21(i + float2(1, 1)), u.x), u.y);
            }

            Varyings Vert(Attributes v)
            {
                Varyings o;
                o.positionWS = TransformObjectToWorld(v.positionOS.xyz);
                o.positionCS = TransformWorldToHClip(o.positionWS);
                o.uv = v.uv;
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                float t = _Time.y * _Speed;
                float2 p = float2(i.positionWS.x + i.positionWS.z, i.positionWS.y) * _Scale;
                float2 n = float2(VNoise(p + float2(0, -t * 2.0)), VNoise(p * 1.7 + float2(5.3, -t * 3.1))) - 0.5;
                // 底部最强，往上、往两边淡
                float mask = (1.0 - smoothstep(0.15, 1.0, i.uv.y)) * smoothstep(0.0, 0.25, i.uv.x) * (1.0 - smoothstep(0.75, 1.0, i.uv.x));
                float dist = length(i.positionWS - _WorldSpaceCameraPos);
                mask *= saturate(1.0 - (dist - 14.0) / 14.0) * _Fade;
                float2 suv = GetNormalizedScreenSpaceUV(i.positionCS);
                float2 off = n * _Strength * mask * 2.0;
                half3 c = SampleSceneColor(suv + off);
                c *= 1.0 + half3(_Warm, _Warm * 0.4, -_Warm * 0.3) * mask;
                return half4(c, saturate(mask * 1.5));
            }
            ENDHLSL
        }
    }

    Fallback Off
}
