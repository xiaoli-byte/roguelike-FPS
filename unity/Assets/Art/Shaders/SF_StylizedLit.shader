// 灵火破晓 · 风格化 Lit（URP 17）
// 手绘固有色为主，光照只负责体积：主光 N·L 经软阶梯（ramp）分成亮 / 暗两大块，暗部带冷色偏移而不是变黑；
// 环境光取球谐，ORM 的 AO 与 SSAO 取小；金属 / 低粗糙度区域加一圈阶梯高光与环境反射；
// 边缘光（菲涅尔）勾出剪影，受击闪白 / 词缀着色走 _FlashAmount / _Tint。
// _Tint.a = 输出 alpha（默认 1；不透明材质的混合是 One Zero，不受影响）：幻影类实例把材质切到 SrcAlpha 混合后靠它淡化 / 闪烁。
Shader "Spiritfire/StylizedLit"
{
    Properties
    {
        [MainTexture] _BaseMap("Base Color (BC)", 2D) = "white" {}
        [MainColor] _BaseColor("Base Color", Color) = (1,1,1,1)
        _Tint("Instance Tint", Color) = (1,1,1,1)
        [Normal] _BumpMap("Normal (N)", 2D) = "bump" {}
        _BumpScale("Normal Scale", Float) = 1
        _ORMMap("ORM (R=AO G=Rough B=Metal)", 2D) = "white" {}
        _Metallic("Metallic", Range(0,1)) = 1
        _Roughness("Roughness", Range(0,1)) = 1
        _OcclusionStrength("AO Strength", Range(0,1)) = 1
        _EmissionMap("Emission (E)", 2D) = "white" {}
        [HDR] _EmissionColor("Emission", Color) = (0,0,0,1)

        [Header(Stylized Lighting)]
        _ShadowTint("Shadow Tint", Color) = (0.62, 0.66, 0.86, 1)
        _RampThreshold("Ramp Threshold", Range(-1,1)) = 0.05
        _RampSoftness("Ramp Softness", Range(0.001,1)) = 0.18
        _ShadowLift("Shadow Lift", Range(0,1)) = 0.32
        _AmbientStrength("Ambient Strength", Range(0,2)) = 1
        _SpecStrength("Spec Strength", Range(0,2)) = 0.5
        _SpecSize("Spec Size", Range(0,1)) = 0.12
        _RimColor("Rim Color", Color) = (1, 0.93, 0.8, 1)
        _RimPower("Rim Power", Range(0.5,8)) = 3.5
        _RimStrength("Rim Strength", Range(0,2)) = 0.35

        [Header(Runtime)]
        _FlashColor("Flash Color", Color) = (1,1,1,1)
        _FlashAmount("Flash Amount", Range(0,1)) = 0

        [Header(Surface)]
        _Cutoff("Alpha Cutoff", Range(0,1)) = 0.5
        [Enum(UnityEngine.Rendering.CullMode)] _Cull("Cull", Float) = 2
        [Enum(UnityEngine.Rendering.BlendMode)] _SrcBlend("Src Blend", Float) = 1
        [Enum(UnityEngine.Rendering.BlendMode)] _DstBlend("Dst Blend", Float) = 0
        [ToggleUI] _ZWrite("ZWrite", Float) = 1
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" "UniversalMaterialType"="Lit" "Queue"="Geometry" }
        LOD 300

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode"="UniversalForward" }
            Blend [_SrcBlend] [_DstBlend]
            ZWrite [_ZWrite]
            Cull [_Cull]

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag

            #pragma shader_feature_local _NORMALMAP
            #pragma shader_feature_local_fragment _ORMMAP
            #pragma shader_feature_local_fragment _EMISSION
            #pragma shader_feature_local_fragment _ALPHATEST_ON
            #pragma shader_feature_local_fragment _ADDITIVE

            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fragment _ _SCREEN_SPACE_OCCLUSION
            #pragma multi_compile_fragment _ _REFLECTION_PROBE_BLENDING
            #pragma multi_compile_fragment _ _REFLECTION_PROBE_BOX_PROJECTION
            #pragma multi_compile_fragment _ _LIGHT_COOKIES
            #pragma multi_compile _ _LIGHT_LAYERS
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/RenderingLayers.hlsl"
            #pragma multi_compile _ SHADOWS_SHADOWMASK
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"

            #include "SF_StylizedInput.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"
            #include "SF_StylizedShading.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float4 tangentOS  : TANGENT;
                float2 uv         : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv         : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                half3  normalWS   : TEXCOORD2;
                #if defined(_NORMALMAP)
                half4  tangentWS  : TEXCOORD3;
                #endif
                half4  fogAndVertexLight : TEXCOORD4; // x = 雾，yzw = 顶点光
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings Vert(Attributes input)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

                VertexPositionInputs pos = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs nrm = GetVertexNormalInputs(input.normalOS, input.tangentOS);
                o.positionCS = pos.positionCS;
                o.positionWS = pos.positionWS;
                o.normalWS = nrm.normalWS;
                #if defined(_NORMALMAP)
                o.tangentWS = half4(nrm.tangentWS, input.tangentOS.w * GetOddNegativeScale());
                #endif
                o.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                half3 vertexLight = VertexLighting(pos.positionWS, nrm.normalWS);
                o.fogAndVertexLight = half4(ComputeFogFactor(pos.positionCS.z), vertexLight);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);

                half4 base = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv) * _BaseColor;
                #if defined(_ALPHATEST_ON)
                clip(base.a - _Cutoff);
                #endif
                #if defined(LOD_FADE_CROSSFADE)
                LODFadeCrossFade(i.positionCS);
                #endif
                half3 albedo = base.rgb * _Tint.rgb;

                half ao = 1.0, roughness = _Roughness, metallic = _Metallic;
                #if defined(_ORMMAP)
                half3 orm = SAMPLE_TEXTURE2D(_ORMMap, sampler_ORMMap, i.uv).rgb;
                ao = lerp(1.0, orm.r, _OcclusionStrength);
                roughness *= orm.g;
                metallic *= orm.b;
                #endif

                half3 N = normalize(i.normalWS);
                #if defined(_NORMALMAP)
                half3 nTS = UnpackNormalScale(SAMPLE_TEXTURE2D(_BumpMap, sampler_BumpMap, i.uv), _BumpScale);
                half3 B = i.tangentWS.w * cross(i.normalWS, i.tangentWS.xyz);
                N = normalize(TransformTangentToWorld(nTS, half3x3(i.tangentWS.xyz, B, i.normalWS)));
                #endif
                half3 V = GetWorldSpaceNormalizeViewDir(i.positionWS);

                #if defined(_ADDITIVE)
                // 发光壳 / 光团：只输出自发光，叠加混合
                half3 glow = albedo;
                #if defined(_EMISSION)
                glow = SAMPLE_TEXTURE2D(_EmissionMap, sampler_EmissionMap, i.uv).rgb * _EmissionColor.rgb;
                #endif
                return half4(MixFogColor(glow * _Tint.a, half3(0,0,0), i.fogAndVertexLight.x), 1);
                #endif

                StylizedStyle st;
                st.shadowTint = _ShadowTint.rgb; st.rampThreshold = _RampThreshold; st.rampSoftness = _RampSoftness;
                st.shadowLift = _ShadowLift; st.ambient = _AmbientStrength; st.specStrength = _SpecStrength; st.specSize = _SpecSize;
                st.rimColor = _RimColor.rgb; st.rimPower = _RimPower; st.rimStrength = _RimStrength;
                half mainLit;
                half3 color = SFShade(albedo, N, i.positionWS, i.positionCS, ao, metallic, roughness, i.fogAndVertexLight.yzw,
                                      i.fogAndVertexLight.x, st, mainLit);

                #if defined(_EMISSION)
                color += SAMPLE_TEXTURE2D(_EmissionMap, sampler_EmissionMap, i.uv).rgb * _EmissionColor.rgb;
                #endif

                color = lerp(color, _FlashColor.rgb, _FlashAmount);
                color = MixFog(color, i.fogAndVertexLight.x);
                return half4(color, _Tint.a);
            }
            ENDHLSL
        }

        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode"="ShadowCaster" }
            ZWrite On
            ZTest LEqual
            ColorMask 0
            Cull [_Cull]

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex ShadowVert
            #pragma fragment ShadowFrag
            #pragma shader_feature_local _ALPHATEST_ON
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW

            #include "SF_StylizedInput.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"

            float3 _LightDirection;
            float3 _LightPosition;

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };

            Varyings ShadowVert(Attributes input)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, o);
                float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);
                float3 normalWS = TransformObjectToWorldNormal(input.normalOS);
                #if _CASTING_PUNCTUAL_LIGHT_SHADOW
                float3 lightDir = normalize(_LightPosition - positionWS);
                #else
                float3 lightDir = _LightDirection;
                #endif
                o.positionCS = ApplyShadowClamping(TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, lightDir)));
                o.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                return o;
            }

            half4 ShadowFrag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                #if defined(_ALPHATEST_ON)
                clip(SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).a * _BaseColor.a - _Cutoff);
                #endif
                #if defined(LOD_FADE_CROSSFADE)
                LODFadeCrossFade(i.positionCS);
                #endif
                return 0;
            }
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode"="DepthOnly" }
            ZWrite On
            ColorMask R
            Cull [_Cull]

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex DepthVert
            #pragma fragment DepthFrag
            #pragma shader_feature_local _ALPHATEST_ON
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"

            #include "SF_StylizedInput.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"

            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID UNITY_VERTEX_OUTPUT_STEREO };

            Varyings DepthVert(Attributes input)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                o.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                return o;
            }

            half DepthFrag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                #if defined(_ALPHATEST_ON)
                clip(SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).a * _BaseColor.a - _Cutoff);
                #endif
                #if defined(LOD_FADE_CROSSFADE)
                LODFadeCrossFade(i.positionCS);
                #endif
                return i.positionCS.z;
            }
            ENDHLSL
        }

        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode"="DepthNormals" }
            ZWrite On
            Cull [_Cull]

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex DNVert
            #pragma fragment DNFrag
            #pragma shader_feature_local _NORMALMAP
            #pragma shader_feature_local _ALPHATEST_ON
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/RenderingLayers.hlsl"
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"

            #include "SF_StylizedInput.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float4 tangentOS : TANGENT; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                half4 tangentWS : TEXCOORD2;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings DNVert(Attributes input)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                VertexNormalInputs nrm = GetVertexNormalInputs(input.normalOS, input.tangentOS);
                o.normalWS = nrm.normalWS;
                o.tangentWS = half4(nrm.tangentWS, input.tangentOS.w * GetOddNegativeScale());
                o.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                return o;
            }

            void DNFrag(Varyings i, out half4 outNormalWS : SV_Target0
            #ifdef _WRITE_RENDERING_LAYERS
                , out uint outRenderingLayers : SV_Target1
            #endif
            )
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                #if defined(_ALPHATEST_ON)
                clip(SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).a * _BaseColor.a - _Cutoff);
                #endif
                #if defined(LOD_FADE_CROSSFADE)
                LODFadeCrossFade(i.positionCS);
                #endif
                float3 N = i.normalWS;
                #if defined(_NORMALMAP)
                float3 nTS = UnpackNormalScale(SAMPLE_TEXTURE2D(_BumpMap, sampler_BumpMap, i.uv), _BumpScale);
                float3 B = i.tangentWS.w * cross(i.normalWS, i.tangentWS.xyz);
                N = TransformTangentToWorld(nTS, half3x3(i.tangentWS.xyz, B, i.normalWS));
                #endif
                outNormalWS = half4(NormalizeNormalPerPixel(N), 0.0);
                #ifdef _WRITE_RENDERING_LAYERS
                outRenderingLayers = EncodeMeshRenderingLayer();
                #endif
            }
            ENDHLSL
        }
    }

    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
