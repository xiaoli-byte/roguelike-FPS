// 弹孔 / 焦痕贴花（特效打磨 A 路，替代 SF_FxDecal 模式 0 的单帧程序弹孔）：手绘风图集 + 法线，受主光照出凹凸，余热由里往外熄、颜色从黄白退到暗红。
// 投射方式同 SF_FxDecal（URP DecalProjector，Screen Space 技术：从深度图重建世界坐标 → 投影盒空间），每个投影器的参数也同样走 _NormalToWorld：
//   [0][3] = DecalProjector.fadeFactor；[3][0..3] = uvScale.xy、uvBias.xy 当 4 个参数 P：
//   P.x 格号（0–15 弹孔：行 = 地表 0 石 / 1 沙 / 2 冰 / 3 金属，列 = 变体；16–19 焦痕变体）、P.y 余热 0..1（C# 按时间冷却）、
//   P.z 地表（0 石 / 1 沙 / 2 冰 / 3 金属 / 4 焦痕：决定提亮色、坑底色、凹凸强度）、P.w 闪烁种子。
// 图集（scripts/unity/fx_shot_textures.py 生成）：_HoleMap R 压暗 / G 余热 / B 提亮 / A 高度，_HoleNormal 由高度求出的切线空间法线（u 右、v 上）。
//
// 光照：贴花不知道底下原来的颜色，所以凹凸按「比值」改底色：主光照在凹凸法线上 ÷ 照在原表面法线上 = 这一点该亮 / 暗多少倍；
//   暗的部分走预乘 alpha 的乘法（dst × (1 − a)），亮的部分按地表的近似底色加上去；再叠坑底焦黑、提亮（崩白 / 翻沙 / 擦亮金属）、余热自发光。
// 平的地方（法线不变、没有遮罩）输出 (0, 0)：不画出方框。
Shader "Spiritfire/FxHole"
{
    Properties
    {
        _HoleMap("Hole Atlas (R dark, G heat, B light, A height)", 2D) = "black" {}
        [Normal] _HoleNormal("Hole Normals", 2D) = "bump" {}
        _Relief("Relief Strength", Range(0, 2)) = 1
        [HideInInspector] _DrawOrder("Draw Order", Range(-50, 50)) = 0
        [HideInInspector] _DecalMeshBiasType("DecalMesh BiasType", Float) = 0
        [HideInInspector] _DecalMeshDepthBias("DecalMesh DepthBias", Float) = 0
        [HideInInspector] _DecalMeshViewBias("DecalMesh ViewBias", Float) = 0
    }

    SubShader
    {
        Tags
        {
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry+8"
            "PreviewType" = "Plane"
            "IgnoreProjector" = "True"
        }

        HLSLINCLUDE
        #pragma target 3.5
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

        CBUFFER_START(UnityPerMaterial)
            float4 _HoleMap_ST;
            float4 _HoleNormal_ST;
            float _Relief;
            float _DrawOrder;
            float _DecalMeshBiasType;
            float _DecalMeshDepthBias;
            float _DecalMeshViewBias;
        CBUFFER_END

        TEXTURE2D(_HoleMap);
        SAMPLER(sampler_HoleMap);
        TEXTURE2D(_HoleNormal);
        SAMPLER(sampler_HoleNormal);

        UNITY_INSTANCING_BUFFER_START(Decal)
            UNITY_DEFINE_INSTANCED_PROP(float4x4, _NormalToWorld)
        UNITY_INSTANCING_BUFFER_END(Decal)

        // 图集格：xy = 左下角 uv，zw = 大小
        float4 CellRect(float cell)
        {
            if (cell < 15.5)
            {
                float col = fmod(cell, 4.0), row = floor(cell / 4.0);
                return float4(col / 8.0, 1.0 - (row + 1.0) / 4.0, 1.0 / 8.0, 1.0 / 4.0);
            }
            float k = cell - 16.0;
            float col = 4.0 + 2.0 * fmod(k, 2.0), row = 2.0 * floor(k / 2.0);
            return float4(col / 8.0, 1.0 - (row + 2.0) / 4.0, 2.0 / 8.0, 2.0 / 4.0);
        }

        // 余热色：暗红 → 橙 → 黄白（t 0..1），HDR
        float3 HeatRamp(float t)
        {
            float3 c = lerp(float3(0.45, 0.03, 0.01), float3(1.0, 0.32, 0.04), saturate(t * 2.0));
            c = lerp(c, float3(1.0, 0.82, 0.45), saturate(t * 2.0 - 1.0));
            return c * (0.8 + 2.6 * t * t);
        }

        struct Attributes
        {
            float4 positionOS : POSITION;
            UNITY_VERTEX_INPUT_INSTANCE_ID
        };

        struct Varyings
        {
            float4 positionCS : SV_POSITION;
            UNITY_VERTEX_INPUT_INSTANCE_ID
            UNITY_VERTEX_OUTPUT_STEREO
        };

        Varyings VertDecal(Attributes v)
        {
            Varyings o = (Varyings)0;
            UNITY_SETUP_INSTANCE_ID(v);
            UNITY_TRANSFER_INSTANCE_ID(v, o);
            UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
            o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
            return o;
        }

        float4 FragHole(Varyings i, bool flipScreen)
        {
            UNITY_SETUP_INSTANCE_ID(i);
            UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
            float2 pixel = i.positionCS.xy;
            if (flipScreen) TransformScreenUV(pixel, _ScreenSize.y);
        #if UNITY_REVERSED_Z
            float depth = LoadSceneDepth(uint2(pixel));
        #else
            float depth = lerp(UNITY_NEAR_CLIP_VALUE, 1, LoadSceneDepth(uint2(pixel)));
        #endif
            float2 positionSS = i.positionCS.xy * _ScreenSize.zw;
            float3 positionWS = ComputeWorldSpacePosition(positionSS, depth, UNITY_MATRIX_I_VP);

            float3 ds = TransformWorldToObject(positionWS) * float3(1.0, -1.0, 1.0);
            float3 nrm = cross(ddy(positionWS), ddx(positionWS));
            float3 axis = TransformObjectToWorldDir(float3(0, 1, 0));
            float facing = abs(dot(nrm, axis)) * rsqrt(max(dot(nrm, nrm), 1e-12));
            clip(0.5 - max(abs(ds.x), max(abs(ds.y), abs(ds.z))));

            float4x4 n2w = UNITY_ACCESS_INSTANCED_PROP(Decal, _NormalToWorld);
            float fade = saturate(n2w[0][3]);
            float4 P = float4(n2w[3][0], n2w[3][1], n2w[3][2], n2w[3][3]);
            float2 uv = ds.xz + 0.5;
            float4 rect = CellRect(clamp(round(P.x), 0.0, 19.0));
            float2 auv = rect.xy + saturate(uv) * rect.zw;
            float4 m = SAMPLE_TEXTURE2D(_HoleMap, sampler_HoleMap, auv);
            float3 nts = UnpackNormal(SAMPLE_TEXTURE2D(_HoleNormal, sampler_HoleNormal, auv));
            float surf = round(P.z);

            // 原表面法线（深度导数，朝向相机）与凹凸法线（投影盒 x / z 轴 = 贴图 u / v）
            float3 N0 = normalize(nrm);
            float3 V = GetCameraPositionWS() - positionWS;
            if (dot(N0, V) < 0) N0 = -N0;
            float3 T = TransformObjectToWorldDir(float3(1, 0, 0));
            T = normalize(T - N0 * dot(T, N0) + 1e-5);
            float3 B = TransformObjectToWorldDir(float3(0, 0, 1));
            B = normalize(B - N0 * dot(B, N0) - T * dot(B, T) + 1e-5);
            float reliefK = surf > 3.5 ? 0.7 : surf > 1.5 && surf < 2.5 ? 0.8 : 1.0;
            nts.xy *= _Relief * reliefK;
            float3 Nd = normalize(T * nts.x + B * nts.y + N0 * max(nts.z, 0.05));

            Light ml = GetMainLight();
            float3 L = ml.direction;
            float lum = dot(ml.color, float3(0.2126, 0.7152, 0.0722));
            float3 amb = SampleSH(N0);
            float ambL = dot(amb, float3(0.2126, 0.7152, 0.0722));
            float d0 = saturate(dot(N0, L)), d1 = saturate(dot(Nd, L));
            float base = ambL + d0 * lum;
            float relief = (ambL + d1 * lum) / max(1e-3, base);
            // 坑里的遮蔽：越深越暗
            float ao = 1.0 - saturate((0.5 - m.a) * 2.4) * 0.5;
            float mul = clamp(relief * ao, 0.0, 2.0);

            // 各地表的近似底色（亮面往上加）、提亮色、坑底色
            float3 tint = surf < 0.5 ? float3(0.55, 0.5, 0.45) : surf < 1.5 ? float3(0.85, 0.68, 0.48) : surf < 2.5 ? float3(0.78, 0.88, 0.98)
                        : surf < 3.5 ? float3(0.62, 0.64, 0.68) : float3(0.5, 0.42, 0.34);
            float3 lightCol = surf < 0.5 ? float3(0.85, 0.8, 0.72) : surf < 1.5 ? float3(0.98, 0.87, 0.66) : surf < 2.5 ? float3(0.93, 0.97, 1.0)
                            : surf < 3.5 ? float3(1.0, 0.97, 0.92) : float3(0.62, 0.6, 0.58);
            float3 soot = surf > 1.5 && surf < 2.5 ? float3(0.05, 0.08, 0.12) : float3(0.03, 0.024, 0.02);
            float3 lit1 = amb + d1 * ml.color;
            // 金属擦亮的地方带一点高光
            float spec = 0;
            if (surf > 2.5 && surf < 3.5)
            {
                float3 H = normalize(L + normalize(V));
                spec = pow(saturate(dot(Nd, H)), 24.0) * 1.5;
            }

            float3 rgb = 0;
            float a = 0;
            if (mul < 1.0) a = 1.0 - mul;
            else rgb = tint * base * (mul - 1.0);
            float k = saturate(m.r) * 0.92;
            rgb = rgb * (1.0 - k) + soot * lit1 * k;
            a = a * (1.0 - k) + k;
            float k2 = saturate(m.b) * 0.85;
            rgb = rgb * (1.0 - k2) + lightCol * (lit1 + spec * ml.color) * k2;
            a = a * (1.0 - k2) + k2;

            // 余热：遮罩高的地方最后熄（P.y 降下来，外圈先暗），温度高的偏黄白
            float heat = saturate(P.y);
            if (heat > 0.001 && !(surf > 1.5 && surf < 2.5))
            {
                float on = saturate((m.g - (1.0 - heat)) / 0.3);
                float t = saturate(m.g * heat * 1.25);
                float flick = surf > 3.5 ? 0.82 + 0.18 * sin(_Time.y * 7.0 + m.g * 23.0 + P.w * 6.3) : 1.0;
                rgb += HeatRamp(t) * on * flick * 1.6;
            }

            float edge = smoothstep(0.3, 0.55, facing) * (1.0 - smoothstep(0.36, 0.5, abs(ds.y)));
            return float4(rgb, saturate(a)) * (fade * edge);
        }
        ENDHLSL

        Pass
        {
            Name "DecalScreenSpaceProjector"
            Tags { "LightMode" = "DecalScreenSpaceProjector" }
            Blend One OneMinusSrcAlpha
            Cull Front
            ZTest Greater
            ZWrite Off

            HLSLPROGRAM
            #pragma vertex VertDecal
            #pragma fragment Frag
            #pragma multi_compile_instancing

            float4 Frag(Varyings i) : SV_Target
            {
                return FragHole(i, true);
            }
            ENDHLSL
        }

        Pass
        {
            Name "DecalProjectorForwardEmissive"
            Tags { "LightMode" = "DecalProjectorForwardEmissive" }
            Blend One OneMinusSrcAlpha
            Cull Front
            ZTest Greater
            ZWrite Off

            HLSLPROGRAM
            #pragma vertex VertDecal
            #pragma fragment Frag
            #pragma multi_compile_instancing

            float4 Frag(Varyings i) : SV_Target
            {
                return FragHole(i, false);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
