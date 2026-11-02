Shader "Spiritfire/Gunfire/Original Particle"
{
    Properties
    {
        _MainTex ("Main Texture", 2D) = "white" {}
        _ParticleTexture ("Particle Texture", 2D) = "white" {}
        _DissolveNoise ("Dissolve Noise", 2D) = "white" {}
        _DissolveEdgeTex ("Dissolve Edge", 2D) = "black" {}
        [HDR] _MainColor ("Main Color", Color) = (1,1,1,1)
        _Color ("Color", Color) = (1,1,1,1)
        _DiffuseColor ("Diffuse Color", Color) = (1,1,1,1)
        _DissolveEdgeAlbedo ("Dissolve Edge Color", Color) = (1,1,1,1)
        _Alpha ("Alpha", Float) = 1
        _AlphaFactor ("Alpha Factor", Float) = 1
        _Cutoff ("Cutoff", Range(0,1)) = 0.5
        _DissolveAmount ("Dissolve Amount", Range(0,1)) = 0
        _DissolveEdgeWidth ("Dissolve Edge Width", Range(0,0.5)) = 0.1
        _tex_u ("U Speed", Float) = 0
        _tex_v ("V Speed", Float) = 0
        _UseParticleTexture ("Use Particle Texture", Float) = 0
        _EnableAlphaToDissolve ("Enable Dissolve", Float) = 0
        [Enum(UnityEngine.Rendering.BlendMode)] _SrcBlend ("Source Blend", Float) = 5
        [Enum(UnityEngine.Rendering.BlendMode)] _DstBlend ("Destination Blend", Float) = 1
        [Enum(UnityEngine.Rendering.CullMode)] _Cull ("Cull", Float) = 0
        [Enum(Off,0,On,1)] _ZZWrite ("Depth Write", Float) = 0
        [Enum(UnityEngine.Rendering.CompareFunction)] _ZTest ("Depth Test", Float) = 4
    }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "RenderType"="Transparent" "Queue"="Transparent" }
        Pass
        {
            Name "Particle"
            Tags { "LightMode"="UniversalForward" }
            Blend [_SrcBlend] [_DstBlend]
            Cull [_Cull]
            ZWrite [_ZZWrite]
            ZTest [_ZTest]
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
            TEXTURE2D(_ParticleTexture); SAMPLER(sampler_ParticleTexture);
            TEXTURE2D(_DissolveNoise); SAMPLER(sampler_DissolveNoise);
            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST, _ParticleTextureTilingAndOffset, _DissolveNoise_ST;
                float4 _MainColor, _Color, _DiffuseColor, _DissolveEdgeAlbedo;
                float _Alpha, _AlphaFactor, _Cutoff, _DissolveAmount, _DissolveEdgeWidth;
                float _tex_u, _tex_v, _UseParticleTexture, _EnableAlphaToDissolve;
                float _SrcBlend, _DstBlend, _Cull, _ZZWrite, _ZTest;
            CBUFFER_END
            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                float4 uv1 : TEXCOORD1;
                half4 color : COLOR;
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float2 noiseUv : TEXCOORD1;
                half4 color : COLOR;
            };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                float4 st = _UseParticleTexture > 0.5 ? _ParticleTextureTilingAndOffset : _MainTex_ST;
                output.uv = input.uv * st.xy + st.zw + _Time.y * float2(_tex_u, _tex_v);
                output.noiseUv = TRANSFORM_TEX(input.uv, _DissolveNoise);
                output.color = input.color;
                return output;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                half4 tex = _UseParticleTexture > 0.5
                    ? SAMPLE_TEXTURE2D(_ParticleTexture, sampler_ParticleTexture, input.uv)
                    : SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, input.uv);
                half4 color = tex * _MainColor * _Color * _DiffuseColor * input.color;
                color.a *= _Alpha * _AlphaFactor;
                if (_EnableAlphaToDissolve > 0.5)
                {
                    half noise = SAMPLE_TEXTURE2D(_DissolveNoise, sampler_DissolveNoise, input.noiseUv).r;
                    clip(noise - _DissolveAmount);
                }
                clip(color.a - 0.001);
                return color;
            }
            ENDHLSL
        }
    }
}
