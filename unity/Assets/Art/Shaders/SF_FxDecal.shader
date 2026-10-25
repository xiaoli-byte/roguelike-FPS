// 战斗贴花（docs/unity-parity.md FX1 / FX2，D21）：弹孔、焦痕、溅痕（图集格），熔池、出生法阵、归墟涡旋（程序纹理）。
// 由 URP DecalProjector 投射（DecalRendererFeature 用 Screen Space 技术，见 SF_Telegraph 的说明）：从深度图重建世界坐标、变换到投影盒空间，
// 天然贴合墙面 / 坡面 / 台阶。和预警不同，这里的投影轴可以是任意方向（弹孔贴在墙上），所以侧壁淡出按「表面法线 · 投影轴」算，不按世界 y。
//
// 每个投影器自己的参数不放材质，走 URP 贴花系统本来就逐实例上传的 _NormalToWorld（同 Shader Graph 贴花：旋转矩阵空出来的一行一列）：
//   [0][3] = DecalProjector.fadeFactor（不透明度，已乘距离淡出）；
//   [3][0..3] = uvScale.xy、uvBias.xy —— 这里不当 UV 用，当 4 个自定义参数 P（含义按模式，见 FxDecals.cs）。
// 所以同一种贴花共用一份材质，能合批（材质开了 GPU Instancing）。
//
// 模式（材质的 _Mode）：0 图集格（P = 格号, 余热, 发光色号, 提亮色混沙）、1 熔池（P = 进度, 种子）、2 出生法阵（P = 进度, 颜色 rgb）、3 归墟涡旋（P = 进度）。
// 预乘 alpha（Blend One OneMinusSrcAlpha）：压暗、提亮、HDR 发光一次画完；纯加色的部分 alpha 写 0。
Shader "Spiritfire/FxDecal"
{
    Properties
    {
        _DecalMap("Decal Atlas (R dark, G heat, B light)", 2D) = "black" {}
        _Mode("Mode (0 sprite, 1 pool, 2 rune, 3 vortex)", Float) = 0
        // URP 贴花系统会读这些（缺了也能跑，留着与 Shader Graph 贴花一致）
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
            "Queue" = "Geometry+10"
            "PreviewType" = "Plane"
            "IgnoreProjector" = "True"
        }

        HLSLINCLUDE
        #pragma target 3.5
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

        #define SF_TAU 6.28318531

        CBUFFER_START(UnityPerMaterial)
            float4 _DecalMap_ST;
            float _Mode;
            float _DrawOrder;
            float _DecalMeshBiasType;
            float _DecalMeshDepthBias;
            float _DecalMeshViewBias;
        CBUFFER_END

        TEXTURE2D(_DecalMap);
        SAMPLER(sampler_DecalMap);

        // 与 URP Shader Graph 贴花同名同布局：DecalDrawSystem 逐实例写进来
        UNITY_INSTANCING_BUFFER_START(Decal)
            UNITY_DEFINE_INSTANCED_PROP(float4x4, _NormalToWorld)
        UNITY_INSTANCING_BUFFER_END(Decal)

        // ───────────── 噪声 ─────────────

        float SFHash12(float2 p)
        {
            float3 p3 = frac(float3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return frac((p3.x + p3.y) * p3.z);
        }

        float SFNoise(float2 p)
        {
            float2 i = floor(p), f = frac(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = SFHash12(i), b = SFHash12(i + float2(1, 0)), c = SFHash12(i + float2(0, 1)), d = SFHash12(i + float2(1, 1));
            return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
        }

        float SFFbm(float2 p)
        {
            float s = 0, amp = 0.5;
            [unroll] for (int k = 0; k < 3; k++)
            {
                s += amp * SFNoise(p);
                p = p * 2.03 + float2(1.7, -0.9);
                amp *= 0.5;
            }
            return s / 0.875;
        }

        // ───────────── 模式 0：图集格（弹孔 / 焦痕 / 溅痕） ─────────────

        // P.x 格号（0..7，第 0 格在左上），P.y 余热 0..1，P.z 发光色（0 橙红 / 1 冰蓝 / 2 蚀绿），P.w 提亮色往沙色混的比例
        float4 ShadeSprite(float2 uv, float4 P)
        {
            float cell = clamp(round(P.x), 0.0, 7.0);
            float col = fmod(cell, 4.0), row = floor(cell / 4.0);
            float2 cuv = float2((col + uv.x) * 0.25, 1.0 - (row + 1.0 - uv.y) * 0.5);
            float3 m = SAMPLE_TEXTURE2D(_DecalMap, sampler_DecalMap, cuv).rgb;
            float g = round(P.z);
            float3 glowCol = g > 1.5 ? float3(0.62, 1.0, 0.29) : g > 0.5 ? float3(0.45, 0.9, 1.0) : float3(1.0, 0.42, 0.1);
            float3 lightCol = lerp(float3(0.9, 0.94, 1.0), float3(0.95, 0.84, 0.62), saturate(P.w));
            float aDark = m.r * 0.92;
            float aLight = m.b * 0.85 * (1.0 - aDark);
            float3 rgb = float3(0.035, 0.03, 0.028) * aDark + lightCol * aLight;
            rgb += glowCol * (m.g * saturate(P.y)) * 1.7;
            return float4(rgb, saturate(aDark + aLight));
        }

        // ───────────── 模式 1：熔池 ─────────────

        // P.x 进度 0..1（出现 → 冷却淡出），P.y 种子
        float4 ShadePool(float2 q, float4 P)
        {
            float t = saturate(P.x), seed = P.y, time = _Time.y;
            float d = length(q);
            float ang = atan2(q.y, q.x);
            float grow = 0.55 + 0.45 * saturate(t * 9.0);
            float edgeN = SFFbm(float2(ang * 1.6 + seed * 7.0, time * 0.45 + seed));
            float R = (0.78 + 0.16 * (edgeN - 0.5) * 2.0) * grow;
            float inside = saturate((R - d) / 0.05);
            // 熔铜：两层错开流动的噪声，差值小的地方是亮纹
            float2 p = q * 3.2 + seed * 13.0;
            float flow = SFFbm(p + float2(time * 0.35, -time * 0.22));
            float flow2 = SFFbm(p * 1.9 - float2(time * 0.5, time * 0.3));
            float cracks = 1.0 - smoothstep(0.02, 0.09, abs(flow - flow2));
            // 亮度只给到 HDR 1.2–1.6：再高 Bloom 一吃就成了一摊白，看不出熔铜的橙
            float3 col = lerp(float3(0.22, 0.05, 0.015), float3(1.0, 0.36, 0.05) * 1.25, saturate(flow * 1.5 - 0.3));
            col = lerp(col, float3(1.0, 0.7, 0.18) * 1.6, cracks * 0.75);
            // 蚀绿：边缘一圈 + 鼓起又破掉的泡
            float3 corrode = float3(0.45, 1.0, 0.15) * 1.1;
            col = lerp(col, corrode, smoothstep(R - 0.24, R - 0.02, d) * 0.6);
            float2 g = q * 5.0 + seed * 3.1;
            float2 cell = floor(g);
            float2 f = frac(g) - 0.5;
            float h = SFHash12(cell + seed);
            float phase = frac(time * (0.6 + h) + h * 7.0);
            float br = 0.08 + 0.24 * phase;
            float2 off = (float2(SFHash12(cell + 3.1), SFHash12(cell + 7.3)) - 0.5) * 0.4;
            float bubble = (1.0 - smoothstep(br - 0.05, br, length(f - off))) * step(0.55, h) * (1.0 - phase);
            col = lerp(col, corrode * 1.25, bubble * 0.8);
            // 末段冷却变暗
            col *= lerp(1.0, 0.3, smoothstep(0.7, 1.0, t));
            float life = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.84, 1.0, t));
            float a = inside * 0.92 * life;
            return float4(col * a, a);
        }

        // ───────────── 模式 2：出生法阵 ─────────────

        // P.x 进度 0..1，P.yzw 颜色（线性 rgb）
        float4 ShadeRune(float2 q, float4 P)
        {
            float t = saturate(P.x), time = _Time.y;
            float3 c = max(P.yzw, 0.0);
            float scale = lerp(0.35, 1.0, 1.0 - pow(1.0 - saturate(t / 0.2), 3.0));
            q /= max(scale, 0.05);
            float d = length(q);
            float ang = atan2(q.y, q.x);
            float px = max(fwidth(d), 1e-4);
            float ring1 = 1.0 - smoothstep(0.0, 0.035 + px, abs(d - 0.9));
            float ring2 = 1.0 - smoothstep(0.0, 0.022 + px, abs(d - 0.72));
            float ticks = step(0.5, frac(ang / SF_TAU * 36.0 - time * 0.4)) * step(0.75, d) * step(d, 0.87) * 0.5;
            float seg = step(0.6, frac((ang + time * 1.6) / SF_TAU * 3.0)) * (1.0 - smoothstep(0.0, 0.03 + px, abs(d - 0.81)));
            // 六芒星：两个正三角形（内切 0.33、外接 0.66）反向慢转
            float star = 0;
            [unroll] for (int k = 0; k < 2; k++)
            {
                float rot = k * 1.0471976 + (k == 0 ? -time : time) * 0.7;
                float a3 = ang - rot + SF_TAU * 8.0;
                float sector = fmod(a3, 2.0943951) - 1.0471976;
                float pd = d * cos(sector);
                star = max(star, (1.0 - smoothstep(0.0, 0.022 + px, abs(pd - 0.33))) * step(d, 0.67));
            }
            float core = (1.0 - smoothstep(0.0, 0.55, d)) * 0.16;
            float shape = saturate(ring1 + ring2 * 0.8 + ticks + seg + star * 0.75 + core) * step(d, 1.0);
            float env = saturate(t / 0.12) * (1.0 - smoothstep(0.86, 1.0, t));
            float flash = exp(-pow((t - 0.8) / 0.06, 2.0));
            float pulse = 0.85 + 0.15 * sin(time * 14.0);
            // 敌人色本身已经很亮（沙黄、冰蓝），倍率压在 1 左右，保住饱和度
            float3 col = c * (1.0 + flash * 1.2) * pulse + flash * 0.25;
            return float4(col * shape * (env + flash * 0.4), 0);
        }

        // ───────────── 模式 3：归墟涡旋 ─────────────

        // P.x 进度 0..1：三色旋臂（火 / 雷 / 蚀）越转越快地向中心收，中心一团压暗的紫黑
        float4 ShadeVortex(float2 q, float4 P)
        {
            float t = saturate(P.x), time = _Time.y;
            float d = length(q);
            float ang = atan2(q.y, q.x);
            float swirl = ang + d * 5.5 - time * (4.0 + 10.0 * t);
            float k = swirl * 3.0 / SF_TAU;
            float arm = pow(0.5 + 0.5 * cos(k * SF_TAU), 3.0);
            float idx = fmod(floor(k + 0.5) + 300.0, 3.0);
            float3 armCol = idx < 0.5 ? float3(1.0, 0.42, 0.12) : idx < 1.5 ? float3(0.44, 0.85, 1.0) : float3(0.62, 1.0, 0.29);
            float rad = (1.0 - smoothstep(0.7, 1.0, d)) * smoothstep(0.08, 0.3, d);
            float core = exp(-d * d * 18.0);
            float3 violet = float3(0.78, 0.6, 1.0);
            float3 col = armCol * arm * rad * 1.6 + violet * (core * 1.6 * t + rad * 0.25);
            float env = saturate(t * 5.0) * (1.0 - smoothstep(0.92, 1.0, t));
            // 旋臂底下压一层暗紫（预乘 alpha），亮地面上也看得清涡旋
            float voidA = saturate((1.0 - smoothstep(0.0, 0.45, d)) * 0.7 * (0.4 + 0.6 * t) + rad * 0.35);
            return float4(col * env, voidA * env);
        }

        // ───────────── 投影通道 ─────────────

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

        float4 FragDecalCommon(Varyings i, bool flipScreen)
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

            // 投影盒空间：x / z 是贴图平面，y 是投射深度
            float3 ds = TransformWorldToObject(positionWS) * float3(1.0, -1.0, 1.0);
            float3 nrm = cross(ddy(positionWS), ddx(positionWS));
            float3 axis = TransformObjectToWorldDir(float3(0, 1, 0));
            float facing = abs(dot(nrm, axis)) * rsqrt(max(dot(nrm, nrm), 1e-12));
            clip(0.5 - max(abs(ds.x), max(abs(ds.y), abs(ds.z))));

            float4x4 n2w = UNITY_ACCESS_INSTANCED_PROP(Decal, _NormalToWorld);
            float fade = saturate(n2w[0][3]);
            float4 P = float4(n2w[3][0], n2w[3][1], n2w[3][2], n2w[3][3]);
            float2 uv = ds.xz + 0.5;
            float2 q = uv * 2.0 - 1.0;
            float4 c;
            if (_Mode < 0.5) c = ShadeSprite(uv, P);
            else if (_Mode < 1.5) c = ShadePool(q, P);
            else if (_Mode < 2.5) c = ShadeRune(q, P);
            else c = ShadeVortex(q, P);
            // 侧壁（与投影轴夹角大的面）淡掉，免得拉成长条；盒子两端 14% 渐隐
            float edge = smoothstep(0.3, 0.55, facing) * (1.0 - smoothstep(0.36, 0.5, abs(ds.y)));
            return c * (fade * edge);
        }
        ENDHLSL

        // URP DecalRendererFeature（Screen Space 技术）在不透明物体之后画这个通道
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
                return FragDecalCommon(i, true);
            }
            ENDHLSL
        }

        // DBuffer 技术时 URP 用这个通道叠发光；本项目设成 Screen Space，留着做兜底
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
                return FragDecalCommon(i, false);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
