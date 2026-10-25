// 铁链（docs/unity-parity.md FX4；Three.js InfernoRangedFx.ChainLinks）：马面狱卒的勾魂索，程序化链环合成的一个动态网格（FxChain 每帧重建）。
// 顶点色 rgb = 铁色（每环略有深浅），a = 这一环的热度 0..1（甩圈时从腕铐往外逐节烧红、拖拽时整条发红）。
// 受光：主光软阴影（同 StylizedLit 的暗部偏冷）+ 球谐环境光 + 一道金属高光 + 边缘光；热度按「暗红 → 橙 → 黄白」叠成 HDR 自发光，
// 越热铁色越被烧没（发光盖过固有色）。不透明、不投影（细链子的影子只会变成噪点）。
Shader "Spiritfire/FxChain"
{
    Properties
    {
        _BaseColor("Iron Tint", Color) = (1, 1, 1, 1)
        [HDR] _HeatLow("Heat Low (dull red)", Color) = (0.6, 0.07, 0.01, 1)
        [HDR] _HeatHigh("Heat High (white-hot)", Color) = (1.9, 0.78, 0.22, 1)
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" "RenderPipeline"="UniversalPipeline" }

        Pass
        {
            Name "ForwardChain"
            Tags { "LightMode"="UniversalForward" }
            Cull Back
            ZWrite On

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #pragma multi_compile_fog
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                half4 _HeatLow;
                half4 _HeatHigh;
            CBUFFER_END

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
                half fog : TEXCOORD3;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                VertexPositionInputs p = GetVertexPositionInputs(v.positionOS.xyz);
                o.positionCS = p.positionCS;
                o.positionWS = p.positionWS;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.color = v.color;
                o.fog = ComputeFogFactor(p.positionCS.z);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                half3 N = normalize(i.normalWS);
                half3 V = GetWorldSpaceNormalizeViewDir(i.positionWS);
                Light L = GetMainLight(TransformWorldToShadowCoord(i.positionWS));
                half ndl = saturate(dot(N, L.direction));
                half lit = smoothstep(0.0, 0.25, ndl) * L.shadowAttenuation;
                half3 iron = i.color.rgb * _BaseColor.rgb;
                half heat = saturate(i.color.a);
                half3 diffuse = iron * (SampleSH(N) * 0.9 + L.color * lerp(0.25, 1.0, lit) * lerp(half3(0.62, 0.66, 0.86), 1, lit));
                half3 H = normalize(L.direction + V);
                half spec = pow(saturate(dot(N, H)), 48.0) * lit * 0.9;
                half rim = pow(1.0 - saturate(dot(N, V)), 3.5) * 0.25;
                half3 col = diffuse * (1.0 - 0.8 * heat) + L.color * spec * (1.0 - heat) + rim * half3(0.9, 0.85, 0.8) * (1.0 - heat);
                half3 glow = lerp(_HeatLow.rgb, _HeatHigh.rgb, smoothstep(0.35, 1.0, heat)) * smoothstep(0.02, 0.4, heat) * (0.6 + 0.6 * heat);
                col += glow;
                col = MixFog(col, i.fog);
                return half4(col, 1);
            }
            ENDHLSL
        }

        // 深度预通道（URP 开了深度预填充时，不透明物体的主通道是 ZTest Equal：没有这个通道的物体整个画不出来）
        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode"="DepthOnly" }
            ZWrite On
            ColorMask R
            Cull Back

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex DepthVert
            #pragma fragment DepthFrag
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                half4 _HeatLow;
                half4 _HeatHigh;
            CBUFFER_END

            struct A { float4 positionOS : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct V { float4 positionCS : SV_POSITION; UNITY_VERTEX_OUTPUT_STEREO };

            V DepthVert(A v)
            {
                V o = (V)0;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                return o;
            }

            half DepthFrag(V i) : SV_Target { return i.positionCS.z; }
            ENDHLSL
        }

        // 深度 + 法线（SSAO / 深度法线预通道用）
        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode"="DepthNormals" }
            ZWrite On
            Cull Back

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex DNVert
            #pragma fragment DNFrag
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                half4 _HeatLow;
                half4 _HeatHigh;
            CBUFFER_END

            struct A { float4 positionOS : POSITION; float3 normalOS : NORMAL; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct V { float4 positionCS : SV_POSITION; half3 normalWS : TEXCOORD0; UNITY_VERTEX_OUTPUT_STEREO };

            V DNVert(A v)
            {
                V o = (V)0;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                return o;
            }

            half4 DNFrag(V i) : SV_Target { return half4(NormalizeNormalPerPixel(i.normalWS), 0.0); }
            ENDHLSL
        }
    }

    Fallback Off
}
