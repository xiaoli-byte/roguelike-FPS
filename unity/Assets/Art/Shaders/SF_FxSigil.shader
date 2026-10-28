// 首领 / 章节贴花（特效打磨 C 路）：三章主题出生法阵（沙印 / 冰晶 / 火卦）、熔铜泼溅（落地冷却成壳）、湿痕（出水后脚下的深色湿沙）。
// 投射方式同 SF_FxDecal：URP DecalProjector（Screen Space），从深度图重建世界坐标、变换到投影盒空间，贴合坡面 / 台阶；侧壁按「表面法线 · 投影轴」淡掉。
// 每个投影器自己的参数走 _NormalToWorld（同 SF_FxDecal）：[0][3] = fadeFactor；[3][0..3] = P（DecalProjector 的 uvScale.xy、uvBias.xy）：
//   P.x 进度 0..1（出现 → 停留 → 收尾闪一下 → 淡出），P.y 模式，P.z 种子，P.w 附加（法阵：1 = 精英金边；熔铜：初始余热 0..1）。
// 模式（按 docs/art/fx-style.md：同心圆 + 简化符文、线条粗而少、墨 / 朱 / 金 + 章节符文色、每种 2–3 个色阶，不做噪点纹理和细刻花）：
//   0 沙印（第一章：鎏金双环 + 一圈 12 块印章字 + 朱红方印 + 金色日纹）、1 冰晶（第二章：冰蓝外环 + 12 根冰刺 + 六角环 + 带枝六辐 + 白色冰核）、
//   2 火卦（第三章：外缘 8 条卡通火舌 + 朱红环 + 八卦三爻 + 金色火眼）、3 熔铜泼溅（金黄 → 铜橙 → 冷成暗紫褐的壳 + 几道粗裂缝）、4 湿痕（压暗的湿沙，慢慢干掉）。
// 每条线外侧垫一道墨边（偏冷紫，不发黑），亮沙 / 雪地上也托得出线。
// 预乘 alpha（Blend One OneMinusSrcAlpha）。
Shader "Spiritfire/FxSigil"
{
    Properties
    {
        // URP 贴花系统会读这些（缺了也能跑，留着与 Shader Graph 贴花一致）
        [HideInInspector] _DrawOrder("Draw Order", Range(-50, 50)) = 2
        [HideInInspector] _DecalMeshBiasType("DecalMesh BiasType", Float) = 0
        [HideInInspector] _DecalMeshDepthBias("DecalMesh DepthBias", Float) = 0
        [HideInInspector] _DecalMeshViewBias("DecalMesh ViewBias", Float) = 0
    }

    SubShader
    {
        Tags
        {
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry+12"
            "PreviewType" = "Plane"
            "IgnoreProjector" = "True"
        }

        HLSLINCLUDE
        #pragma target 3.5
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

        #define SG_TAU 6.28318531
        #define SG_PI 3.14159265

        CBUFFER_START(UnityPerMaterial)
            float _DrawOrder;
            float _DecalMeshBiasType;
            float _DecalMeshDepthBias;
            float _DecalMeshViewBias;
        CBUFFER_END

        UNITY_INSTANCING_BUFFER_START(Decal)
            UNITY_DEFINE_INSTANCED_PROP(float4x4, _NormalToWorld)
        UNITY_INSTANCING_BUFFER_END(Decal)

        float SGHash(float2 p)
        {
            float3 p3 = frac(float3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return frac((p3.x + p3.y) * p3.z);
        }

        float SGNoise(float2 p)
        {
            float2 i = floor(p), f = frac(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = SGHash(i), b = SGHash(i + float2(1, 0)), c = SGHash(i + float2(0, 1)), d = SGHash(i + float2(1, 1));
            return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
        }

        float SGFbm(float2 p)
        {
            float s = 0, amp = 0.5;
            [unroll] for (int k = 0; k < 4; k++)
            {
                s += amp * SGNoise(p);
                p = p * 2.07 + float2(1.3, -0.7);
                amp *= 0.5;
            }
            return s / 0.9375;
        }

        // 线：到中心线的距离 dist，半宽 w（米 / 归一化单位），aa = 抗锯齿宽度
        float SGLine(float dist, float w, float aa) { return 1.0 - smoothstep(w, w + aa, abs(dist)); }

        float2 SGRot(float2 q, float a)
        {
            float s = sin(a), c = cos(a);
            return float2(c * q.x - s * q.y, s * q.x + c * q.y);
        }

        // 正 n 边形的「边距」：外接圆半径 1 的正多边形上 = cos(π/n)
        float SGPolyDist(float2 q, float n)
        {
            float seg = SG_TAU / n;
            float a = atan2(q.y, q.x);
            a = a - seg * floor(a / seg) - seg * 0.5;
            return length(q) * cos(a);
        }

        // 法阵的公共节奏：t 进度 → 放大、淡入淡出、收尾闪光
        void SGTiming(float t, out float grow, out float vis, out float flash)
        {
            float k = saturate(t / 0.18);
            grow = 0.55 + 0.45 * (1.0 - (1.0 - k) * (1.0 - k) * (1.0 - k));
            vis = saturate(t / 0.06) * (1.0 - smoothstep(0.86, 1.0, t));
            float fx = (t - 0.8) / 0.06;
            flash = exp(-fx * fx);
        }

        // 合成：亮线 line（发光色 glow）压在暗衬 back（衬色 dark）上，再加一层淡底 fill（底色 base）
        float4 SGCompose(float lit, float back, float fill, float3 glow, float3 dark, float3 base, float flash)
        {
            float3 rgb = base * fill;
            float a = fill * 0.5;
            // 暗衬：压暗地面
            rgb = rgb * (1.0 - back) + dark * back;
            a = max(a, back);
            // 亮线：发光（加色部分不占 alpha）
            rgb += glow * lit * (1.0 + flash * 0.9);
            a = max(a, lit * 0.85);
            return float4(rgb, saturate(a));
        }

        // ───────────── 手绘风格化的公共件（docs/art/fx-style.md：同心圆 + 简化符文、线条粗而少、墨 / 朱 / 金、2–3 个色阶） ─────────────

        // 墨（暗衬，偏冷紫不发黑）/ 朱 / 鎏金
        static const float3 SG_INK = float3(0.07, 0.05, 0.09);
        static const float3 SG_VERMILION = float3(0.92, 0.22, 0.12);
        static const float3 SG_GOLD = float3(1.0, 0.72, 0.28);

        // 粗线：线宽至少 1.6 个像素（远处 / 掠射角不细成发丝）
        float SGStroke(float dist, float w, float aa) { w = max(w, aa * 1.6); return 1.0 - smoothstep(w, w + aa, abs(dist)); }

        // 一层符文：col = 线色；backW = 线外侧的墨边宽
        void SGLayer(inout float3 rgb, inout float a, float dist, float w, float aa, float3 col, float backW)
        {
            float back = SGStroke(dist, w + backW, aa) * 0.62;
            rgb = lerp(rgb, SG_INK, back * (1.0 - a * 0.3));
            a = max(a, back);
            float ln = SGStroke(dist, w, aa);
            rgb = lerp(rgb, col, ln);
            a = max(a, ln);
        }

        // 实心块（填色 + 墨边）
        void SGFill(inout float3 rgb, inout float a, float inside, float edgeInk, float3 col)
        {
            rgb = lerp(rgb, SG_INK, edgeInk * 0.62 * (1.0 - inside));
            a = max(a, edgeInk * 0.62);
            rgb = lerp(rgb, col, inside);
            a = max(a, inside);
        }

        // 收尾一下：整片提亮一阶（不是加法刷白）
        float4 SGFinish(float3 rgb, float a, float flash, float vis, float d)
        {
            rgb = lerp(rgb, rgb * 1.35 + 0.05, flash * 0.6);
            a *= step(d, 1.04) * vis;
            // 预乘
            return float4(rgb * a, a);
        }

        // ───────────── 模式 0：沙印（第一章：鎏金双环 + 一圈印章块 + 朱红方印 + 日纹） ─────────────
        float4 ShadeSand(float2 q, float4 P)
        {
            float grow, vis, flash;
            SGTiming(P.x, grow, vis, flash);
            q /= grow;
            float time = _Time.y;
            float d = length(q);
            float aa = max(fwidth(d), 1e-4);
            float ang = atan2(q.y, q.x);
            float3 rgb = float3(0, 0, 0);
            float a = 0;
            // 底：淡淡一层暖砂色（一个色块，不做纹理）
            float fillIn = 1.0 - smoothstep(0.9, 0.9 + aa, d);
            rgb = float3(0.55, 0.36, 0.16);
            a = fillIn * 0.16;
            SGLayer(rgb, a, d - 0.93, 0.035, aa, SG_GOLD, 0.03);
            SGLayer(rgb, a, d - 0.7, 0.02, aa, SG_GOLD, 0.02);
            // 印章块：两环之间 12 块，每块按种子取四种简化字形之一（满块 / 回字 / 两横 / 一竖）
            float rot = time * 0.35 + P.z;
            float a01 = frac((ang + rot) / SG_TAU);
            float si = floor(a01 * 12.0);
            float2 c = float2(frac(a01 * 12.0), (d - 0.735) / 0.16);
            if (c.y > 0.0 && c.y < 1.0)
            {
                float2 b = abs(c - 0.5);
                float box = 1.0 - smoothstep(0.32, 0.36, max(b.x, b.y));
                float kind = floor(SGHash(float2(si, P.z * 13.0)) * 4.0);
                float glyph = box;
                if (kind > 0.5 && kind < 1.5) glyph = box * smoothstep(0.12, 0.16, max(b.x, b.y));
                else if (kind > 1.5 && kind < 2.5) glyph = box * (1.0 - smoothstep(0.06, 0.1, abs(b.y - 0.16)));
                else if (kind > 2.5) glyph = box * (1.0 - smoothstep(0.08, 0.12, b.x));
                SGFill(rgb, a, glyph, 0, SG_GOLD);
            }
            // 朱红方印（慢慢反向转）
            float2 r1 = SGRot(q, -time * 0.5 - P.z);
            float sq = max(abs(r1.x), abs(r1.y));
            SGLayer(rgb, a, sq - 0.44, 0.03, aa, SG_VERMILION, 0.025);
            // 日纹：金色实心日轮 + 8 道粗光芒
            float sun = 1.0 - smoothstep(0.16, 0.16 + aa, d);
            SGFill(rgb, a, sun, 1.0 - smoothstep(0.2, 0.2 + aa, d), SG_GOLD);
            float ray = abs(frac((ang + time * 0.6) / SG_TAU * 8.0) - 0.5);
            float rays = (1.0 - smoothstep(0.1, 0.1 + aa * 4.0, ray)) * step(0.22, d) * step(d, 0.34);
            SGFill(rgb, a, rays, 0, SG_GOLD);
            if (P.w > 0.5) SGLayer(rgb, a, d - 1.0, 0.03, aa, SG_GOLD * 1.15, 0.02);
            return SGFinish(rgb, a, flash, vis, d);
        }

        // ───────────── 模式 1：冰晶（第二章：冰蓝外环 + 一圈冰刺 + 六角环 + 带枝六辐 + 白色冰核） ─────────────
        float4 ShadeFrost(float2 q, float4 P)
        {
            float grow, vis, flash;
            SGTiming(P.x, grow, vis, flash);
            q /= grow;
            float time = _Time.y;
            float d = length(q);
            float aa = max(fwidth(d), 1e-4);
            float ang = atan2(q.y, q.x);
            float3 ice = float3(0.42, 0.78, 1.0), white = float3(0.92, 0.97, 1.0);
            float3 rgb = float3(0.75, 0.88, 1.0);
            float a = (1.0 - smoothstep(0.84, 0.84 + aa, d)) * 0.14;
            SGLayer(rgb, a, d - 0.84, 0.03, aa, ice, 0.03);
            // 12 根冰刺（三角块）
            float rot = time * 0.25 + P.z;
            float sa = frac((ang + rot) / SG_TAU * 12.0) - 0.5;
            float sr = (d - 0.86) / 0.13;
            float spike = step(0.0, sr) * step(sr, 1.0) * (1.0 - smoothstep((1.0 - sr) * 0.3, (1.0 - sr) * 0.3 + aa * 6.0, abs(sa)));
            SGFill(rgb, a, spike, 0, ice);
            // 六角环（反向慢转）
            float2 r = SGRot(q, -time * 0.4);
            float hx = SGPolyDist(r, 6.0);
            SGLayer(rgb, a, hx - 0.58, 0.025, aa, ice, 0.02);
            // 六条粗辐 + 一对 60° 的枝
            float seg = SG_TAU / 6.0;
            float phi = round(atan2(r.y, r.x) / seg) * seg;
            float2 dir = float2(cos(phi), sin(phi));
            float along = dot(r, dir);
            float across = r.x * dir.y - r.y * dir.x;
            float spokeD = abs(across) + max(0.0, max(0.12 - along, along - 0.56));
            SGLayer(rgb, a, spokeD, 0.022, aa, white, 0.018);
            float2 local = float2(along - 0.36, abs(across));
            float2 bd = float2(0.5, 0.866);
            float tb = clamp(dot(local, bd), 0.0, 0.11);
            SGLayer(rgb, a, length(local - bd * tb), 0.018, aa, white, 0.015);
            // 冰核：白色实心六角
            float hc = SGPolyDist(r, 6.0);
            SGFill(rgb, a, 1.0 - smoothstep(0.1, 0.1 + aa, hc), 1.0 - smoothstep(0.14, 0.14 + aa, hc), white);
            if (P.w > 0.5) SGLayer(rgb, a, d - 1.0, 0.03, aa, SG_GOLD * 1.15, 0.02);
            return SGFinish(rgb, a, flash, vis, d);
        }

        // ───────────── 模式 2：火卦（第三章：外缘一圈卡通火舌 + 朱红环 + 八卦三爻 + 金色火眼） ─────────────
        float4 ShadeFire(float2 q, float4 P)
        {
            float grow, vis, flash;
            SGTiming(P.x, grow, vis, flash);
            q /= grow;
            float time = _Time.y;
            float d = length(q);
            float aa = max(fwidth(d), 1e-4);
            float ang = atan2(q.y, q.x);
            float3 rgb = float3(0.32, 0.08, 0.06);
            float a = (1.0 - smoothstep(0.78, 0.78 + aa, d)) * 0.2;
            // 外缘 8 条大火舌：两阶（朱红外沿 / 金黄内芯），舌尖随时间一起一伏
            float a01 = ang / SG_TAU + 0.5;
            float k = frac(a01 * 8.0 + P.z) - 0.5;
            float h = 0.12 + 0.06 * sin(time * 5.0 + floor(a01 * 8.0 + P.z) * 2.3);
            float fr = (d - 0.8) / h;
            float tongue = step(0.0, fr) * (1.0 - smoothstep(0.0, aa * 4.0, abs(k) - 0.42 * (1.0 - saturate(fr))));
            float core = tongue * (1.0 - smoothstep(0.0, aa * 4.0, abs(k) - 0.22 * (1.0 - saturate(fr * 1.6))));
            SGFill(rgb, a, tongue, 0, SG_VERMILION * 1.15);
            SGFill(rgb, a, core, 0, SG_GOLD * 1.1);
            SGLayer(rgb, a, d - 0.78, 0.032, aa, SG_VERMILION, 0.03);
            // 八卦三爻：8 个方向，三道粗杠，阴爻中间断开
            float rot = -time * 0.3 + P.z;
            float seg = SG_TAU / 8.0;
            float kk = round((ang + rot) / seg);
            float2 dir = float2(cos(kk * seg - rot), sin(kk * seg - rot));
            float along = dot(q, dir);
            float across = q.x * dir.y - q.y * dir.x;
            float gi = fmod(fmod(kk, 8.0) + 8.0, 8.0);
            [unroll] for (int b = 0; b < 3; b++)
            {
                float rr = 0.46 + 0.085 * b;
                float bit = fmod(floor(gi / pow(2.0, b)), 2.0);
                float barD = max(abs(along - rr) - 0.022, abs(across) - 0.13);
                float bar = 1.0 - smoothstep(0.0, aa, barD);
                if (bit < 0.5) bar *= smoothstep(0.03, 0.03 + aa, abs(across));
                SGFill(rgb, a, bar, 1.0 - smoothstep(0.0, aa, barD - 0.018), SG_GOLD);
            }
            // 火眼：金色实心 + 朱红环
            SGFill(rgb, a, 1.0 - smoothstep(0.12, 0.12 + aa, d), 1.0 - smoothstep(0.16, 0.16 + aa, d), SG_GOLD);
            SGLayer(rgb, a, d - 0.28, 0.024, aa, SG_VERMILION, 0.02);
            if (P.w > 0.5) SGLayer(rgb, a, d - 1.02, 0.03, aa, SG_GOLD * 1.15, 0.02);
            return SGFinish(rgb, a, flash, vis, d);
        }

        // ───────────── 模式 3：熔铜泼溅（三阶：铜橙 → 冷成暗紫褐的壳，几道粗的发光裂缝） ─────────────
        float4 ShadeMolten(float2 q, float4 P)
        {
            float t = saturate(P.x);
            float d = length(q);
            float ang = atan2(q.y, q.x);
            float a01 = ang / SG_TAU + 0.5;
            float seed = P.z;
            // 主团 + 几根粗的指状溅痕（中尺度，不碎）
            float blobR = 0.52 + 0.1 * (SGNoise(float2(a01 * 5.0, seed * 3.0)) - 0.5) * 2.0;
            float fingers = pow(SGNoise(float2(a01 * 12.0, seed * 5.0 + 2.0)), 3.0);
            float R = (blobR + fingers * 0.4) * (0.35 + 0.65 * saturate(t * 12.0));
            float aa = max(fwidth(d), 1e-4) * 1.5;
            float inside = 1.0 - smoothstep(R - aa, R + aa, d);
            // 冷却：余热从 P.w 往 0 掉（约前 30% 寿命里冷完）
            float heat = saturate(P.w) * saturate(1.0 - t * 3.2);
            float flow = SGNoise(q * 2.4 + float2(seed, -seed));
            float3 crust = float3(0.17, 0.07, 0.09), copper = float3(1.25, 0.42, 0.06), gold = float3(1.55, 0.95, 0.3);
            // 三阶：冷壳 / 铜橙 / 金黄，按余热分阶（软阶梯）
            float3 rgb = lerp(crust, copper, smoothstep(0.15, 0.2, heat + (flow - 0.5) * 0.2));
            rgb = lerp(rgb, gold, smoothstep(0.62, 0.67, heat + (flow - 0.5) * 0.25));
            // 冷壳上几道粗裂缝，比整体冷得慢
            float crack = 1.0 - smoothstep(0.0, 0.06, abs(flow - 0.5));
            rgb = lerp(rgb, copper, crack * step(heat, 0.2) * saturate(0.5 * (1.0 - t)));
            float a = inside * (1.0 - smoothstep(0.8, 1.0, t));
            return float4(rgb * a, a);
        }

        // ───────────── 模式 4：湿痕 ─────────────
        float4 ShadeWet(float2 q, float4 P)
        {
            float t = saturate(P.x);
            float d = length(q);
            float n = SGFbm(q * 3.0 + P.z * 7.0);
            float R = 0.7 + 0.25 * (n - 0.5) * 2.0;
            R *= 0.6 + 0.4 * saturate(t * 10.0);
            float inside = 1.0 - smoothstep(R - 0.12, R, d);
            // 慢慢干：从边缘往里收
            float dry = smoothstep(0.25, 1.0, t);
            inside *= 1.0 - smoothstep(R * (1.0 - dry) - 0.1, R * (1.0 - dry), d) * step(0.001, dry);
            float a = inside * 0.42 * (1.0 - smoothstep(0.85, 1.0, t));
            // 压暗的湿沙（偏冷的暗色，不是纯黑；不加细碎高光）
            float3 rgb = float3(0.05, 0.05, 0.08) * a;
            return float4(rgb, a);
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

            float3 ds = TransformWorldToObject(positionWS) * float3(1.0, -1.0, 1.0);
            float3 nrm = cross(ddy(positionWS), ddx(positionWS));
            float3 axis = TransformObjectToWorldDir(float3(0, 1, 0));
            float facing = abs(dot(nrm, axis)) * rsqrt(max(dot(nrm, nrm), 1e-12));
            clip(0.5 - max(abs(ds.x), max(abs(ds.y), abs(ds.z))));

            float4x4 n2w = UNITY_ACCESS_INSTANCED_PROP(Decal, _NormalToWorld);
            float fade = saturate(n2w[0][3]);
            float4 P = float4(n2w[3][0], n2w[3][1], n2w[3][2], n2w[3][3]);
            float2 q = (ds.xz + 0.5) * 2.0 - 1.0;
            float mode = P.y;
            float4 c;
            if (mode < 0.5) c = ShadeSand(q, P);
            else if (mode < 1.5) c = ShadeFrost(q, P);
            else if (mode < 2.5) c = ShadeFire(q, P);
            else if (mode < 3.5) c = ShadeMolten(q, P);
            else c = ShadeWet(q, P);
            float edge = smoothstep(0.3, 0.55, facing) * (1.0 - smoothstep(0.36, 0.5, abs(ds.y)));
            return c * (fade * edge);
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
                return FragDecalCommon(i, true);
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
                return FragDecalCommon(i, false);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
