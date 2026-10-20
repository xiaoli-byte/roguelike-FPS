// 灵火破晓 · 远景剪影（LevelKit.Backdrop：远景环的远山 / 台地 / 火山，远景地标剪影）
// 不受场景雾影响：远景在雾的终点之外，交给雾会被整片吞成雾色。空气透视由生成器按距离烘进顶点色——
// 环脚 = 地平线色 = 雾色（线性空间），与雾里的远地面无缝相接；越远的一圈越接近雾色。不受光，只读剪影。
// _UseVertexColor = 0 时只用 _Tint（套在现成模型上做剪影替身，模型没有顶点色）。
Shader "Spiritfire/Backdrop"
{
    Properties
    {
        _Tint("Tint", Color) = (1, 1, 1, 1)
        [ToggleUI] _UseVertexColor("Use Vertex Color", Float) = 1
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry+50" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }
        Cull Off

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        CBUFFER_START(UnityPerMaterial)
            half4 _Tint;
            half _UseVertexColor;
        CBUFFER_END
        ENDHLSL

        Pass
        {
            Name "Backdrop"
            Tags { "LightMode"="UniversalForwardOnly" }

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_instancing

            struct Attributes { float4 positionOS : POSITION; half4 color : COLOR; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings { float4 positionCS : SV_POSITION; half4 color : COLOR; UNITY_VERTEX_OUTPUT_STEREO };

            Varyings Vert(Attributes v)
            {
                Varyings o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.color = lerp(half4(1, 1, 1, 1), v.color, _UseVertexColor) * _Tint;
                return o;
            }

            half4 Frag(Varyings i) : SV_Target { return half4(i.color.rgb, 1); }
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode"="DepthOnly" }
            ZWrite On ColorMask R

            HLSLPROGRAM
            #pragma vertex DepthVert
            #pragma fragment DepthFrag
            #pragma multi_compile_instancing
            struct Attributes { float4 positionOS : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
            float4 DepthVert(Attributes v) : SV_POSITION
            {
                UNITY_SETUP_INSTANCE_ID(v);
                return TransformObjectToHClip(v.positionOS.xyz);
            }
            half DepthFrag(float4 positionCS : SV_POSITION) : SV_Target { return positionCS.z; }
            ENDHLSL
        }

        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode"="DepthNormalsOnly" }
            ZWrite On

            HLSLPROGRAM
            #pragma vertex DNVert
            #pragma fragment DNFrag
            #pragma multi_compile_instancing
            struct Attributes { float4 positionOS : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
            float4 DNVert(Attributes v) : SV_POSITION
            {
                UNITY_SETUP_INSTANCE_ID(v);
                return TransformObjectToHClip(v.positionOS.xyz);
            }
            half4 DNFrag(float4 positionCS : SV_POSITION) : SV_Target { return half4(0, 1, 0, 0); }
            ENDHLSL
        }
    }
    FallBack Off
}
