Shader "Spiritfire/Gunfire/Original Particle"
{
    Properties
    {
        _MainTex ("Main Texture", 2D) = "white" {}
        [HDR] _MainColor ("Main Color", Color) = (1,1,1,1)
        _DissolveNoise ("Dissolve Noise", 2D) = "white" {}
        [HDR] _DissolveEdgeAlbedo ("Dissolve Edge Albedo", Color) = (1,1,1,1)
        _DissolveEdgeWidth ("Dissolve Edge Width", Range(0,0.5)) = 0.1
        [NoScaleOffset] _DissolveEdgeTex ("Dissolve Edge Tex", 2D) = "black" {}
        [Toggle(ENABLE_DISSOLVE_AMOUNT)] _EnableAlphaToDissolve ("Enable Dissolve Amount", Float) = 0
        [Toggle(ENABLE_COLOR_CONTROL_UV_AMOUNT)] _EnableColorControlUV ("Enable Color Control UV", Float) = 0
        _DissolveAmount ("Dissolve Amount", Range(0,1)) = 0.3
        _MaskTex ("Mask Tex", 2D) = "white" {}
        _UVXSpeed ("UV X Speed", Float) = 0
        _UVYSpeed ("UV Y Speed", Float) = 0
        _MaskTexUVXSpeed ("Mask Tex UV X Speed", Float) = 0
        _MaskTexUVYSpeed ("Mask Tex UV Y Speed", Float) = 0
        _M1GlobalShaderPower ("Global Shader Power", Float) = 1
        _ParticleTexture ("Particle Texture", 2D) = "white" {}
        _Color ("Color", Color) = (1,1,1,1)
        _DiffuseColor ("Diffuse Color", Color) = (1,1,1,1)
        _Alpha ("Alpha", Float) = 1
        _AlphaFactor ("Alpha Factor", Float) = 1
        _tex_u ("U Speed", Float) = 0
        _tex_v ("V Speed", Float) = 0
        _UseParticleTexture ("Use Particle Texture", Float) = 0
        _EffectMode ("Effect Mode", Float) = 0
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
            #pragma shader_feature_local_vertex ENABLE_COLOR_CONTROL_UV_AMOUNT
            #pragma shader_feature_local_fragment ENABLE_DISSOLVE_AMOUNT
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
            TEXTURE2D(_ParticleTexture); SAMPLER(sampler_ParticleTexture);
            TEXTURE2D(_DissolveNoise); SAMPLER(sampler_DissolveNoise);
            TEXTURE2D(_DissolveEdgeTex); SAMPLER(sampler_DissolveEdgeTex);
            TEXTURE2D(_MaskTex); SAMPLER(sampler_MaskTex);
            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST, _DissolveNoise_ST, _ParticleTextureTilingAndOffset, _MaskTex_ST;
                float4 _MainColor, _DissolveEdgeAlbedo, _Color, _DiffuseColor;
                float _DissolveEdgeWidth, _DissolveAmount, _EnableAlphaToDissolve, _EnableColorControlUV;
                float _UVXSpeed, _UVYSpeed, _MaskTexUVXSpeed, _MaskTexUVYSpeed, _M1GlobalShaderPower;
                float _Alpha, _AlphaFactor, _tex_u, _tex_v, _UseParticleTexture, _EffectMode;
                float _SrcBlend, _DstBlend, _Cull, _ZZWrite, _ZTest;
            CBUFFER_END
            struct Attributes
            {
                float4 positionOS : POSITION;
                float4 uv : TEXCOORD0;
                float4 uvControl : TEXCOORD1;
                half4 color : COLOR;
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float2 noiseUv : TEXCOORD1;
                half4 color : COLOR;
                float2 amount : TEXCOORD2;
                float2 maskUv : TEXCOORD3;
            };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                float2 uv = input.uv.xy;
                #if defined(ENABLE_COLOR_CONTROL_UV_AMOUNT)
                    uv = input.uv.xy * input.uvControl.xy + input.uvControl.zw;
                #endif
                output.uv = TRANSFORM_TEX(uv, _MainTex);
                output.noiseUv = TRANSFORM_TEX(input.uv.xy, _DissolveNoise);
                output.maskUv = TRANSFORM_TEX(input.uv.xy, _MaskTex);
                if (_EffectMode > 1.5)
                {
                    output.uv += _Time.y * float2(_UVXSpeed, _UVYSpeed);
                    output.maskUv += _Time.y * float2(_MaskTexUVXSpeed, _MaskTexUVYSpeed);
                }
                else if (_EffectMode < 0.5)
                {
                    float4 st = _UseParticleTexture > 0.5 ? _ParticleTextureTilingAndOffset : _MainTex_ST;
                    output.uv = uv * st.xy + st.zw + _Time.y * float2(_tex_u, _tex_v);
                }
                output.color = input.color;
                output.amount = input.uv.zw;
                return output;
            }
            half4 Dissolve(Varyings input)
            {
                half amount = input.amount.x;
                #if defined(ENABLE_DISSOLVE_AMOUNT)
                    amount = _DissolveAmount;
                #endif
                half4 noise = SAMPLE_TEXTURE2D(_DissolveNoise, sampler_DissolveNoise, input.noiseUv);
                half progress = noise.r * noise.a - (1 - amount);
                clip(progress);
                half edge = saturate(progress / _DissolveEdgeWidth);
                edge = 1 - (3 - 2 * edge) * edge * edge;
                half enabled = _DissolveEdgeWidth >= 0.001 ? 1 : 0;
                half4 baseColor = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, input.uv) * _MainColor;
                half4 edgeColor = SAMPLE_TEXTURE2D(_DissolveEdgeTex, sampler_DissolveEdgeTex, edge) * _DissolveEdgeAlbedo;
                half4 color = lerp(baseColor, edgeColor * baseColor.a, edge * enabled) * input.color;
                if (_EffectMode > 1.5)
                    color.a *= SAMPLE_TEXTURE2D(_MaskTex, sampler_MaskTex, input.maskUv).r;
                color.rgb *= _M1GlobalShaderPower;
                return color;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                if (_EffectMode > 0.5) return Dissolve(input);
                half4 tex = _UseParticleTexture > 0.5
                    ? SAMPLE_TEXTURE2D(_ParticleTexture, sampler_ParticleTexture, input.uv)
                    : SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, input.uv);
                half4 color = tex * _MainColor * _Color * _DiffuseColor * input.color;
                color.a *= _Alpha * _AlphaFactor;
                clip(color.a - 0.001);
                return color;
            }
            ENDHLSL
        }
    }
}
