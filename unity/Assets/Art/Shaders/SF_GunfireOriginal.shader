Shader "Spiritfire/Gunfire/Original Character"
{
    Properties
    {
        _Color ("Color", Color) = (1,1,1,1)
        _MainTex ("Albedo", 2D) = "white" {}
        _BumpMap ("Normal", 2D) = "bump" {}
        _BumpScale ("Normal Scale", Float) = 1
        _MetallicGlossMap ("Metallic Gloss", 2D) = "white" {}
        _OcclusionMap ("Occlusion", 2D) = "white" {}
        _EmissionMap ("Emission", 2D) = "white" {}
        _EmissionColor ("Emission", Color) = (0,0,0,1)
        _Metallic ("Metallic", Range(0,1)) = 0
        _Glossiness ("Smoothness", Range(0,1)) = 0.5
        _GlossMapScale ("Smoothness Scale", Range(0,1)) = 1
        _OcclusionStrength ("Occlusion Strength", Range(0,1)) = 1
        _ReflectionRatio ("Reflection Ratio", Float) = 1
        _MainLightIntensity ("Main Light Intensity", Float) = 1
        _AdditionLightIntensity ("Additional Light Intensity", Float) = 1
        [HDR] _OutlineColor ("Outline Color", Color) = (0,0,0,1)
        _OutlineWidth ("Outline Width", Float) = 0
        _Cull ("Cull", Float) = 2
    }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "RenderType"="Opaque" "Queue"="Geometry" }
        Pass
        {
            Name "Forward"
            Tags { "LightMode"="UniversalForward" }
            Cull [_Cull]
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
            TEXTURE2D(_BumpMap); SAMPLER(sampler_BumpMap);
            TEXTURE2D(_MetallicGlossMap); SAMPLER(sampler_MetallicGlossMap);
            TEXTURE2D(_OcclusionMap); SAMPLER(sampler_OcclusionMap);
            TEXTURE2D(_EmissionMap); SAMPLER(sampler_EmissionMap);
            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST, _Color, _EmissionColor, _OutlineColor;
                float _BumpScale, _Metallic, _Glossiness, _GlossMapScale, _OcclusionStrength;
                float _ReflectionRatio, _MainLightIntensity, _AdditionLightIntensity, _OutlineWidth, _Cull;
            CBUFFER_END
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
                float4 tangentWS : TEXCOORD3;
            };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs normals = GetVertexNormalInputs(input.normalOS, input.tangentOS);
                output.positionCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.normalWS = normals.normalWS;
                output.tangentWS = float4(normals.tangentWS, input.tangentOS.w * GetOddNegativeScale());
                output.uv = TRANSFORM_TEX(input.uv, _MainTex);
                return output;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                half4 packed = SAMPLE_TEXTURE2D(_MetallicGlossMap, sampler_MetallicGlossMap, input.uv);
                half3 albedo = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, input.uv).rgb * _Color.rgb;
                half3 normalTS = UnpackNormalScale(SAMPLE_TEXTURE2D(_BumpMap, sampler_BumpMap, input.uv), _BumpScale);
                float sign = input.tangentWS.w;
                float3 bitangent = sign * cross(input.normalWS, input.tangentWS.xyz);
                half3 normal = NormalizeNormalPerPixel(TransformTangentToWorld(normalTS, half3x3(input.tangentWS.xyz, bitangent, input.normalWS)));
                half metallic = packed.b;
                half smoothness = packed.a * _GlossMapScale;
                half roughness = max(0.035h, 1 - smoothness);
                half occlusion = lerp(1, SAMPLE_TEXTURE2D(_OcclusionMap, sampler_OcclusionMap, input.uv).g, _OcclusionStrength);
                half3 view = normalize(GetWorldSpaceViewDir(input.positionWS));
                half3 f0 = lerp(0.04h, albedo, metallic);
                half3 diffuse = albedo * (1 - metallic);
                half3 lightSum = SampleSH(normal) * occlusion * albedo;
                Light mainLight = GetMainLight(TransformWorldToShadowCoord(input.positionWS));
                half3 lightColor = mainLight.color * mainLight.shadowAttenuation * _MainLightIntensity;
                half ndl = saturate(dot(normal, mainLight.direction));
                half3 halfDir = normalize(mainLight.direction + view);
                half spec = pow(saturate(dot(normal, halfDir)), exp2(1 + 10 * smoothness));
                lightSum += (diffuse * ndl + f0 * spec * ndl * (0.25h + smoothness)) * lightColor;
                #if defined(_ADDITIONAL_LIGHTS)
                    uint count = GetAdditionalLightsCount();
                    for (uint i = 0u; i < count; ++i)
                    {
                        Light light = GetAdditionalLight(i, input.positionWS);
                        half additionalNdl = saturate(dot(normal, light.direction));
                        lightSum += diffuse * additionalNdl * light.color * light.distanceAttenuation * light.shadowAttenuation * _AdditionLightIntensity;
                    }
                #endif
                half3 reflection = GlossyEnvironmentReflection(reflect(-view, normal), roughness, 1) * f0 * _ReflectionRatio * smoothness * occlusion;
                half3 emission = SAMPLE_TEXTURE2D(_EmissionMap, sampler_EmissionMap, input.uv).bbb * _EmissionColor.rgb;
                return half4(lightSum + reflection + emission, 1);
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
            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST, _Color, _EmissionColor, _OutlineColor;
                float _BumpScale, _Metallic, _Glossiness, _GlossMapScale, _OcclusionStrength;
                float _ReflectionRatio, _MainLightIntensity, _AdditionLightIntensity, _OutlineWidth, _Cull;
            CBUFFER_END
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
