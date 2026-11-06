// 灵火破晓 · 风格化树冠 / 灌丛（彩林海子的落叶松、云杉；程序化网格，见 Level_LarchLake.Trees.cs）。
// 和 StylizedLit 同一套光照（SF_StylizedShading.hlsl：软阶梯亮暗两块 + 冷色暗部 + 边缘光），区别：
//   · 固有色取顶点色 rgb（网格里烘好：每层枝叶里暗外亮、下暗上亮，树干深褐），a = 摆动权重（树干根部 0、枝梢 1）；
//   · 法线是网格里烘的「球形法线」（从树轴往外 + 往上），整棵树按体积受光，不按一片片枝叶的面朝向碎成花斑；
//   · 风：整棵树绕根部轻摆（全局 _WindDir：WeatherDirector 写的 xy 风向、z 风力；没写时按默认方向）+ 枝梢细颤，相位按树的世界位置错开；
//   · 逆光透光：视线对着太阳时枝叶透出一层暖光（金色落叶松逆光时发亮），按摆动权重只给枝叶、不给树干。
// 双面（枝叶层是单层网格）、投影 / 收影、深度 / 深度法线 Pass 都带风，GPU instancing（地形树走 instancing）。
Shader "Spiritfire/Foliage"
{
    Properties
    {
        _BaseColor("Tint", Color) = (1,1,1,1)
        _ShadowTint("Shadow Tint", Color) = (0.55, 0.62, 0.86, 1)
        _RampThreshold("Ramp Threshold", Range(-1,1)) = 0.0
        _RampSoftness("Ramp Softness", Range(0.001,1)) = 0.3
        _ShadowLift("Shadow Lift", Range(0,1)) = 0.4
        _AmbientStrength("Ambient Strength", Range(0,2)) = 1
        _RimColor("Rim Color", Color) = (1, 0.92, 0.75, 1)
        _RimPower("Rim Power", Range(0.5,8)) = 3
        _RimStrength("Rim Strength", Range(0,2)) = 0.25
        _TranslucencyColor("Translucency Color", Color) = (1, 0.8, 0.4, 1)
        _Translucency("Translucency", Range(0,2)) = 0.6
        _WindStrength("Wind Sway (m at tip)", Float) = 0.18
        _WindSpeed("Wind Speed", Float) = 1.1
        _Flutter("Branch Flutter (m)", Float) = 0.04
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }
        Cull Off

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

        CBUFFER_START(UnityPerMaterial)
            half4 _BaseColor;
            half4 _ShadowTint;
            half _RampThreshold, _RampSoftness, _ShadowLift, _AmbientStrength;
            half4 _RimColor;
            half _RimPower, _RimStrength;
            half4 _TranslucencyColor;
            half _Translucency;
            float _WindStrength, _WindSpeed, _Flutter;
        CBUFFER_END

        // WeatherDirector 写的全局风：xy = 风向（XZ），z = 风力 0..1
        float4 _WindDir;

        // 风：整棵树绕根部摆（幅度随摆动权重 = 离根部的高度），枝梢再叠一层细颤；相位按树根的世界位置错开
        float3 FoliageWind(float3 positionWS, half sway)
        {
            float3 root = TransformObjectToWorld(float3(0, 0, 0));
            float phase = dot(root.xz, float2(0.137, 0.173));
            float2 dir = dot(_WindDir.xy, _WindDir.xy) > 1e-4 ? normalize(_WindDir.xy) : float2(0.8, 0.6);
            float force = 0.55 + _WindDir.z;
            float t = _Time.y * _WindSpeed;
            float bend = (sin(t + phase) * 0.6 + sin(t * 2.3 + phase * 1.7) * 0.25 + 0.4) * _WindStrength * force * sway;
            positionWS.xz += dir * bend;
            float flutter = sin(t * 5.7 + positionWS.x * 0.9 + positionWS.z * 1.3 + phase * 3.0) * _Flutter * force * sway * sway;
            positionWS += float3(flutter, flutter * 0.4, -flutter * 0.7);
            return positionWS;
        }
        ENDHLSL

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode"="UniversalForward" }

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag

            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fragment _ _SCREEN_SPACE_OCCLUSION
            #pragma multi_compile _ _LIGHT_LAYERS
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/RenderingLayers.hlsl"
            #pragma multi_compile _ SHADOWS_SHADOWMASK
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #pragma multi_compile_fog
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"
            #include "SF_StylizedShading.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                half4 color : COLOR;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                half4 color : TEXCOORD2;
                half4 fogAndVertexLight : TEXCOORD3;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                float3 ws = FoliageWind(TransformObjectToWorld(v.positionOS.xyz), v.color.a);
                o.positionWS = ws;
                o.positionCS = TransformWorldToHClip(ws);
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.color = v.color;
                half3 vertexLight = 0;
                #if defined(_ADDITIONAL_LIGHTS_VERTEX)
                vertexLight = VertexLighting(ws, o.normalWS);
                #endif
                o.fogAndVertexLight = half4(ComputeFogFactor(o.positionCS.z), vertexLight);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                #if defined(LOD_FADE_CROSSFADE)
                LODFadeCrossFade(i.positionCS);
                #endif
                half3 albedo = i.color.rgb * _BaseColor.rgb;
                half3 N = normalize(i.normalWS);

                StylizedStyle st;
                st.shadowTint = _ShadowTint.rgb; st.rampThreshold = _RampThreshold; st.rampSoftness = _RampSoftness;
                st.shadowLift = _ShadowLift; st.ambient = _AmbientStrength; st.specStrength = 0; st.specSize = 0.1;
                st.rimColor = _RimColor.rgb; st.rimPower = _RimPower; st.rimStrength = _RimStrength;

                half mainLit;
                half3 color = SFShade(albedo, N, i.positionWS, i.positionCS, 1, 0, 1, i.fogAndVertexLight.yzw, i.fogAndVertexLight.x, st, mainLit);

                // 逆光透光：视线对着太阳时枝叶透出一层光（只给枝叶：摆动权重）
                Light light = GetMainLight();
                half3 V = GetWorldSpaceNormalizeViewDir(i.positionWS);
                half back = pow(saturate(dot(-V, light.direction)), 5.0) * _Translucency * i.color.a;
                color += albedo * _TranslucencyColor.rgb * light.color * back;

                color = MixFog(color, i.fogAndVertexLight.x);
                return half4(color, 1);
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

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex ShadowVert
            #pragma fragment ShadowFrag
            #pragma multi_compile_instancing
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"

            float3 _LightDirection;
            float3 _LightPosition;

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; half4 color : COLOR; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings { float4 positionCS : SV_POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };

            Varyings ShadowVert(Attributes input)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, o);
                float3 positionWS = FoliageWind(TransformObjectToWorld(input.positionOS.xyz), input.color.a);
                float3 normalWS = TransformObjectToWorldNormal(input.normalOS);
                #if _CASTING_PUNCTUAL_LIGHT_SHADOW
                float3 lightDir = normalize(_LightPosition - positionWS);
                #else
                float3 lightDir = _LightDirection;
                #endif
                o.positionCS = ApplyShadowClamping(TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, lightDir)));
                return o;
            }

            half4 ShadowFrag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
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

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex DepthVert
            #pragma fragment DepthFrag
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"

            struct Attributes { float4 positionOS : POSITION; half4 color : COLOR; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings { float4 positionCS : SV_POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID UNITY_VERTEX_OUTPUT_STEREO };

            Varyings DepthVert(Attributes input)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformWorldToHClip(FoliageWind(TransformObjectToWorld(input.positionOS.xyz), input.color.a));
                return o;
            }

            half DepthFrag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
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

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex DNVert
            #pragma fragment DNFrag
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/RenderingLayers.hlsl"
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; half4 color : COLOR; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings { float4 positionCS : SV_POSITION; half3 normalWS : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID UNITY_VERTEX_OUTPUT_STEREO };

            Varyings DNVert(Attributes input)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformWorldToHClip(FoliageWind(TransformObjectToWorld(input.positionOS.xyz), input.color.a));
                o.normalWS = TransformObjectToWorldNormal(input.normalOS);
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
                #if defined(LOD_FADE_CROSSFADE)
                LODFadeCrossFade(i.positionCS);
                #endif
                outNormalWS = half4(NormalizeNormalPerPixel(i.normalWS), 0.0);
                #ifdef _WRITE_RENDERING_LAYERS
                outRenderingLayers = EncodeMeshRenderingLayer();
                #endif
            }
            ENDHLSL
        }
    }

    Fallback Off
}
