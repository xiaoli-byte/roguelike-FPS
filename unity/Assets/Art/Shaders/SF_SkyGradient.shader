// 灵火破晓 · 风格化渐变天空：天顶 / 地平线 / 地面三色渐变 + 地平线辉光 + 太阳光晕（方向取主光）。
// 比 Skybox/Procedural 好控：章节主题直接给颜色，不经过大气散射（高散射 + 暖色调在程序化天空里会偏出绿色）。
Shader "Spiritfire/SkyGradient"
{
    Properties
    {
        _TopColor("Zenith", Color) = (0.3, 0.45, 0.75, 1)
        _HorizonColor("Horizon", Color) = (0.85, 0.75, 0.6, 1)
        _BottomColor("Ground", Color) = (0.4, 0.33, 0.25, 1)
        _HorizonSharpness("Horizon Sharpness", Range(0.5, 8)) = 2.5
        _HorizonGlow("Horizon Glow", Range(0, 2)) = 0.4
        _SunColor("Sun Color", Color) = (1, 0.9, 0.7, 1)
        _SunSize("Sun Size", Range(0.001, 0.2)) = 0.03
        _SunHalo("Sun Halo", Range(0, 2)) = 0.6
        _Exposure("Exposure", Range(0, 4)) = 1
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

            half4 Frag(Varyings i) : SV_Target
            {
                float3 d = normalize(i.dir);
                float up = d.y;
                // 上半球：地平线 → 天顶；下半球：地平线 → 地面（更快过渡，地平线以下很快压暗）
                half3 sky = lerp(_HorizonColor.rgb, _TopColor.rgb, pow(saturate(up), 1.0 / _HorizonSharpness));
                half3 ground = lerp(_HorizonColor.rgb, _BottomColor.rgb, saturate(-up * 4.0));
                half3 c = up >= 0 ? sky : ground;
                c += _HorizonColor.rgb * _HorizonGlow * exp(-abs(up) * 12.0);

                float3 sunDir = _MainLightPosition.xyz;
                float s = dot(d, sunDir);
                half disc = smoothstep(1.0 - _SunSize, 1.0 - _SunSize * 0.6, s);
                half halo = pow(saturate(s), 64.0) * _SunHalo + pow(saturate(s), 8.0) * _SunHalo * 0.25;
                c += _SunColor.rgb * (disc * 6.0 + halo);
                return half4(c * _Exposure, 1);
            }
            ENDHLSL
        }
    }
}
