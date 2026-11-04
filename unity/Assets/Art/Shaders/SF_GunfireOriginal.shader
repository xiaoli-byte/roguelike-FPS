Shader "Spiritfire/Gunfire/Original Character"
{
    Properties
    {
        _WorkflowMode ("WorkflowMode", Float) = 1
        _RenderQueueOffset ("RenderQueueOffset", Float) = 0
        _Color ("Color", Color) = (1,1,1,1)
        _MainTex ("Albedo", 2D) = "white" {}
        _OverlayColor ("OverlayColor", Color) = (0,0,0,0)
        _Cutoff ("Alpha Cutoff", Range(0,1)) = 0.5
        _DitherClip ("Dither Clip", Float) = 0
        _DitherScale ("Dither Scale", Range(0,1)) = 0
        _Glossiness ("Smoothness", Range(0,1)) = 0.5
        _GlossMapScale ("Smoothness Scale", Range(0,1)) = 1
        _SmoothnessTextureChannel ("Smoothness texture channel", Float) = 0
        _Metallic ("Metallic", Range(0,1)) = 0
        _MetallicGlossMap ("Metallic", 2D) = "white" {}
        _SpecColor ("Specular", Color) = (0.2,0.2,0.2,1)
        _SpecGlossMap ("Specular", 2D) = "white" {}
        _SpecularHighlights ("Specular Highlights", Float) = 1
        _GlossyReflections ("Glossy Reflections", Float) = 1
        _ReflectionRatio ("Reflection Ratio", Float) = 1
        _MainLightIntensity ("MainLight Intensity", Float) = 1
        _AdditionLightIntensity ("AdditionLight Intensity", Float) = 1
        _OcclusionStrength ("Strength", Range(0,1)) = 1
        _OcclusionMap ("Occlusion", 2D) = "white" {}
        _EmissionColor ("Emission", Color) = (0,0,0,1)
        _EmissionMap ("Emission", 2D) = "white" {}
        _FogFactor ("FogFactor", Range(0,1)) = 1
        _Surface ("__surface", Float) = 0
        _Blend ("__blend", Float) = 0
        _AlphaClip ("__clip", Float) = 0
        _SrcBlend ("__src", Float) = 1
        _DstBlend ("__dst", Float) = 0
        _ZWrite ("__zw", Float) = 1
        _Cull ("__cull", Float) = 2
        _StencilZfail ("__stencilzfail", Float) = 0
        _ReceiveShadows ("Receive Shadows", Float) = 1
        _ENABLE_OUTLINE ("Outline", Float) = 1
        [HDR] _OutlineColor ("OutlineColor", Color) = (0,0,0,1)
        _OutlineWidth ("OutlineWidth", Range(0,1)) = 0.015
        _OutLineRef ("OutLineRef(1~255)", Float) = 65
        _HideOutLineRef ("HideOutLineRef(1~255)", Float) = 65
        _OutLineReadMask ("OutLineReadMask(1~255)", Float) = 127
        _OutLineWriteMask ("OutLineWriteMask(1~255)", Float) = 127
        _HideOutLineComp ("HideOutLineComp", Float) = 6
        _InfluenceByViewDis ("InfluenceByViewDis", Float) = 0
        _ENABLE_HIDE_OUTLINE ("HideOutline", Float) = 0
        _HideOutlineColor ("HideOutlineColor", Color) = (1,0,0,1)
        _ENABLE_DISSOLVE ("Dissolve", Float) = 0
        _EnableDirectionalDissolve ("DirectionalDissolve", Float) = 0
        _DissolveNoise ("Dissolve Noise", 2D) = "white" {}
        [HDR] _DissolveEdgeAlbedo ("Dissolve Edge Albedo", Color) = (1,1,1,1)
        _DissolveEdgeWidth ("Dissolve Edge Width", Range(0,0.5)) = 0.1
        _DissolveEdgeTex ("Dissolve Edge Tex", 2D) = "black" {}
        _DissolveAmount ("Dissolve Amount", Range(0,1)) = 0.3
        _DissolveStart ("Dissolve Start", Vector) = (1,0,0,1)
        _DissolveEnd ("Dissolve End", Vector) = (0,0,0,1)
        _DissolveBand ("Dissolve Band", Float) = 0.3
        _DirChange ("DirChange", Float) = 0
        _DirChangeTex ("DirChangeTex", 2D) = "white" {}
        _DirChangeColor ("DirChangeColor", Color) = (1,1,1,1)
        _EnableShield ("EnableShield", Float) = 0
        [HDR] _EdgeColor ("Edge Color", Color) = (0,1.2,6,0)
        _EdgeRatio ("Edge Ratio", Float) = 2
        _FresnelAniDir ("Shield Dir", Vector) = (0,0.2,0,1)
        _FresnelAniTex ("Shield Tex", 2D) = "white" {}
        _FresnelAniRatio ("Shield Ani Ratio", Range(0,1)) = 1
        _EnableSmoothFresnel ("EnableSmoothFresnel", Float) = 0
        _FresnelMap1 ("FresnelMap1", 2D) = "black" {}
        _FresnelScale1 ("FresnelScale1", Float) = 1
        _FresnelMap2 ("FresnelMap2", 2D) = "black" {}
        _FresnelScale2 ("FresnelScale2", Float) = 1
        _FresnelDissolveNoise ("FresnelDissolveNoise", 2D) = "white" {}
        _Frozen ("Frozen", Float) = 0
        _EnableFresnelAnimation ("EnableFresnelAnimation", Float) = 0
        _FresnelAnimationTex ("FresnelAnimationTex", 2D) = "white" {}
        _FresnelAnimationDir ("FresnelAnimationDir", Vector) = (0,0,0,0)
        _FresnelAnimationColor ("FresnelAnimationColor", Color) = (1,1,1,1)
        _ENABLE_UV_ANIMATION ("EnableUVAnimation", Float) = 0
        _AnimationDir ("AnimationDir", Vector) = (0,0,0,0)
        _AnimationMask ("AnimationMask", 2D) = "black" {}
        _AnimationTex ("AnimationTex", 2D) = "white" {}
        _AnimationTex2 ("AnimationTex2", 2D) = "white" {}
        _AnimationRatio ("AnimationRatio", Float) = 1
        _AnimationColor ("AnimationColor", Color) = (1,1,1,1)
        _Use2UV ("Use 2UV", Float) = 0
        _AnimationBlendFunc ("AnimationBlendFunc", Float) = 0
        _ZTest ("ZTest", Float) = 4
    }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "RenderType"="Opaque" "Queue"="Geometry" }
        Pass
        {
            Name "Forward"
            Tags { "LightMode"="UniversalForward" }
            Blend [_SrcBlend] [_DstBlend]
            Cull [_Cull]
            ZWrite [_ZWrite]
            ZTest [_ZTest]
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma shader_feature_local_fragment _EMISSION
            #pragma shader_feature_local_fragment _METALLICSPECGLOSSMAP
            #pragma shader_feature_local_fragment _OCCLUSIONMAP
            #pragma shader_feature_local_fragment _RECEIVE_SHADOWS_OFF
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile _ _ADDITIONAL_LIGHTS
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "GunfireOriginalInput.hlsl"
            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
            TEXTURE2D(_MetallicGlossMap); SAMPLER(sampler_MetallicGlossMap);
            TEXTURE2D(_OcclusionMap); SAMPLER(sampler_OcclusionMap);
            TEXTURE2D(_EmissionMap); SAMPLER(sampler_EmissionMap);
            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float4 tangentOS : TANGENT;
                float2 uv : TEXCOORD0;
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                float3 normalWS : TEXCOORD2;
            };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.uv = TRANSFORM_TEX(input.uv, _MainTex);
                return output;
            }
            half3 OriginalLight(half3 normal, half3 view, half3 direction, half3 color,
                half3 diffuse, half3 specular, half roughness)
            {
                half halfLambert = saturate(dot(normal, direction) * 0.5h + 0.5h);
                half3 halfDirection = normalize(direction + view);
                half nh = saturate(dot(normal, halfDirection));
                half lh = saturate(dot(direction, halfDirection));
                half roughness2 = roughness * roughness;
                half term = nh * nh * (roughness2 - 1) + 1.00001h;
                half denominator = max(0.1h, lh * lh) * term * term * (4 * roughness2 + 2);
                half distribution = roughness2 * roughness2 / max(0.000001h, denominator);
                return (diffuse + specular * distribution) * halfLambert * color;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                half3 baseColor = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, input.uv).rgb;
                half3 albedo = baseColor * _Color.rgb;
                half metallic = _Metallic;
                half smoothness = _Glossiness;
                half occlusion = 1;
                half emissionMask = 0;
                #if defined(_METALLICSPECGLOSSMAP)
                    half4 packed = SAMPLE_TEXTURE2D(_MetallicGlossMap, sampler_MetallicGlossMap, input.uv);
                    metallic = packed.r;
                    smoothness = packed.a * _GlossMapScale;
                    emissionMask = packed.b;
                #endif
                #if defined(_OCCLUSIONMAP)
                    occlusion = SAMPLE_TEXTURE2D(_OcclusionMap, sampler_OcclusionMap, input.uv).g;
                    occlusion = lerp(1, occlusion, _OcclusionStrength);
                #endif
                half3 normal = NormalizeNormalPerPixel(input.normalWS);
                half3 view = normalize(GetWorldSpaceViewDir(input.positionWS));
                half oneMinusReflectivity = 0.96h * (1 - metallic);
                half reflectivity = 1 - oneMinusReflectivity;
                half3 diffuse = albedo * oneMinusReflectivity;
                half3 specular = lerp(0.04h, albedo - 0.04h, metallic);
                half roughness = 1 - smoothness;
                half3 color = SampleSH(normal) * diffuse * occlusion;
                half grazing = saturate(smoothness + reflectivity);
                half fresnel = 1 - saturate(dot(normal, view));
                fresnel *= fresnel;
                fresnel *= fresnel;
                half3 reflectionColor = lerp(specular, grazing.xxx, fresnel);
                half3 reflection = GlossyEnvironmentReflection(reflect(-view, normal), roughness, occlusion);
                color += reflection * reflectionColor * _ReflectionRatio / (roughness * roughness + 1);
                Light mainLight = GetMainLight();
                #if !defined(_RECEIVE_SHADOWS_OFF) && (defined(_MAIN_LIGHT_SHADOWS) || defined(_MAIN_LIGHT_SHADOWS_CASCADE))
                    mainLight = GetMainLight(TransformWorldToShadowCoord(input.positionWS));
                #endif
                color += OriginalLight(normal, view, mainLight.direction,
                    mainLight.color * mainLight.shadowAttenuation * _MainLightIntensity,
                    diffuse, specular, roughness);
                #if defined(_ADDITIONAL_LIGHTS)
                    uint count = GetAdditionalLightsCount();
                    for (uint i = 0u; i < count; ++i)
                    {
                        Light light = GetAdditionalLight(i, input.positionWS);
                        uint lightIndex = GetPerObjectLightIndex(i);
                        #if USE_STRUCTURED_BUFFER_FOR_LIGHT_DATA
                            float4 lightPosition = _AdditionalLightsBuffer[lightIndex].position;
                        #else
                            float4 lightPosition = _AdditionalLightsPosition[lightIndex];
                        #endif
                        float3 lightVector = lightPosition.xyz - input.positionWS * lightPosition.w;
                        float distanceSqr = max(dot(lightVector, lightVector), 0.000061);
                        half3 direction = lightPosition.w > 0 ? lightVector * rsqrt(distanceSqr) : light.direction;
                        half attenuation = lightPosition.w > 0 ? 1 - min(distanceSqr / (lightPosition.w * lightPosition.w), 1) : 1;
                        color += OriginalLight(normal, view, direction,
                            light.color * attenuation * light.shadowAttenuation * _AdditionLightIntensity,
                            diffuse, specular, roughness);
                    }
                #endif
                #if defined(_EMISSION)
                    #if !defined(_METALLICSPECGLOSSMAP)
                        emissionMask = SAMPLE_TEXTURE2D(_EmissionMap, sampler_EmissionMap, input.uv).b;
                    #endif
                    color += baseColor * emissionMask * _EmissionColor.b;
                #endif
                half outline = 1 - saturate(_ProjectionParams.x * dot(normal, view));
                if (outline < 0.9h) color += _OutlineColor.rgb;
                return half4(color, 1);
            }
            ENDHLSL
        }
        Pass
        {
            Name "Outline"
            Tags { "LightMode"="SRPDefaultUnlit" }
            Cull Front
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "GunfireOriginalInput.hlsl"
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct Varyings { float4 positionCS : SV_POSITION; };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                float3 normal = TransformObjectToWorldNormal(input.normalOS);
                float3 position = TransformObjectToWorld(input.positionOS.xyz) + normal * _OutlineWidth;
                output.positionCS = TransformWorldToHClip(position);
                return output;
            }
            half4 Frag(Varyings input) : SV_Target { return _OutlineColor; }
            ENDHLSL
        }
    }
}
