// 首领 / 章节贴花（特效打磨 C 路）：三章主题出生法阵（沙印 / 冰晶 / 火卦）、熔铜泼溅（落地冷却成壳）、湿痕（出水后脚下的深色湿沙）。
// 投射方式同 SF_FxDecal：URP DecalProjector（Screen Space），从深度图重建世界坐标、变换到投影盒空间，贴合坡面 / 台阶；侧壁按「表面法线 · 投影轴」淡掉。
// 每个投影器自己的参数走 _NormalToWorld（同 SF_FxDecal）：[0][3] = fadeFactor；[3][0..3] = P（DecalProjector 的 uvScale.xy、uvBias.xy）：
//   P.x 进度 0..1（出现 → 停留 → 收尾闪一下 → 淡出），P.y 模式，P.z 种子，P.w 附加（法阵：1 = 精英金边；熔铜：初始余热 0..1）。
// 模式：0 沙印（第一章：双环 + 一圈篆文方块 + 方印叠八角 + 日纹）、1 冰晶（第二章：冰刺外环 + 六角环 + 六条带枝的辐 + 霜花底）、
//       2 火卦（第三章：外缘一圈跳动的火舌 + 八卦三爻 + 中心火眼）、3 熔铜泼溅（指状溅痕，白热 → 橙 → 暗壳 + 发光裂缝）、4 湿痕（压暗的湿沙，慢慢干掉）。
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

        // ───────────── 模式 0：沙印 ─────────────
        float4 ShadeSand(float2 q, float4 P)
        {
            float grow, vis, flash;
            SGTiming(P.x, grow, vis, flash);
            q /= grow;
            float time = _Time.y;
            float d = length(q);
            float aa = max(fwidth(d), 1e-4) * 1.2;
            float ang = atan2(q.y, q.x);
            float lit = 0, back = 0;
            // 双环
            lit = max(lit, SGLine(d - 0.93, 0.018, aa));
            lit = max(lit, SGLine(d - 0.79, 0.011, aa));
            back = max(back, SGLine(d - 0.86, 0.085, aa) * 0.55);
            // 篆文方块：两环之间 18 格，每格 3 × 2 的块按种子取
            float rot = time * 0.35 + P.z;
            float a01 = frac((ang + rot) / SG_TAU);
            float segs = 18.0;
            float si = floor(a01 * segs);
            float su = frac(a01 * segs);
            float sr = (d - 0.81) / 0.1;
            if (sr > 0.0 && sr < 1.0 && su > 0.12 && su < 0.88)
            {
                float2 cell = floor(float2((su - 0.12) / 0.76 * 3.0, sr * 2.0));
                float on = step(0.42, SGHash(float2(si * 3.1 + cell.x, cell.y * 7.3 + P.z * 13.0)));
                float2 fc = frac(float2((su - 0.12) / 0.76 * 3.0, sr * 2.0));
                float inner = step(0.14, fc.x) * step(fc.x, 0.86) * step(0.16, fc.y) * step(fc.y, 0.84);
                lit = max(lit, on * inner * 0.85);
            }
            // 方印叠八角：两个 45° 错开的方框（慢慢反向转）
            float2 r1 = SGRot(q, -time * 0.5 - P.z);
            float sq1 = max(abs(r1.x), abs(r1.y));
            float2 r2 = SGRot(r1, SG_PI * 0.25);
            float sq2 = max(abs(r2.x), abs(r2.y));
            lit = max(lit, SGLine(sq1 - 0.5, 0.013, aa));
            lit = max(lit, SGLine(sq2 - 0.5, 0.013, aa) * 0.8);
            back = max(back, SGLine(sq1 - 0.5, 0.045, aa) * 0.4);
            // 日纹：中心圆 + 12 道光芒
            lit = max(lit, SGLine(d - 0.17, 0.014, aa));
            float ray = abs(frac((ang + time * 0.8) / SG_TAU * 12.0) - 0.5);
            lit = max(lit, (1.0 - smoothstep(0.06, 0.06 + aa * 6.0, ray)) * step(0.2, d) * step(d, 0.38) * 0.75);
            float core = 1.0 - smoothstep(0.07, 0.07 + aa, d);
            lit = max(lit, core);
            // 沙纹淡底
            float ripple = 0.5 + 0.5 * sin(q.x * 14.0 + sin(q.y * 3.0 + P.z) * 1.6 - time * 0.6);
            float fill = (1.0 - smoothstep(0.88, 0.95, d)) * (0.18 + 0.12 * ripple);
            float3 glow = float3(1.0, 0.48, 0.1) * 1.35;
            if (P.w > 0.5)
            {
                // 精英：外面一道金边
                lit = max(lit, SGLine(d - 0.99, 0.02, aa));
                glow = lerp(glow, float3(1.0, 0.85, 0.3) * 1.9, step(0.97, d));
            }
            float4 c = SGCompose(lit, back * 0.85, fill, glow, float3(0.1, 0.05, 0.015), float3(0.55, 0.32, 0.12), flash);
            c.a *= step(d, 1.02);
            return c * vis;
        }

        // ───────────── 模式 1：冰晶 ─────────────
        float4 ShadeFrost(float2 q, float4 P)
        {
            float grow, vis, flash;
            SGTiming(P.x, grow, vis, flash);
            q /= grow;
            float time = _Time.y;
            float d = length(q);
            float aa = max(fwidth(d), 1e-4) * 1.2;
            float ang = atan2(q.y, q.x);
            float lit = 0, back = 0;
            // 外环 + 一圈向外的冰刺（24 根，长短交替）
            lit = max(lit, SGLine(d - 0.84, 0.014, aa));
            float rot = time * 0.25 + P.z;
            float sa = frac((ang + rot) / SG_TAU * 24.0) - 0.5;
            float idx = floor((ang + rot) / SG_TAU * 24.0);
            float len = fmod(abs(idx), 2.0) < 0.5 ? 0.15 : 0.08;
            float spikeR = (d - 0.84) / len;
            float spike = step(0.0, spikeR) * step(spikeR, 1.0) * (1.0 - smoothstep((1.0 - spikeR) * 0.22, (1.0 - spikeR) * 0.22 + aa * 8.0, abs(sa)));
            lit = max(lit, spike);
            back = max(back, SGLine(d - 0.86, 0.09, aa) * 0.5);
            // 六角环（反向慢转）
            float2 r = SGRot(q, -time * 0.4);
            float hx = SGPolyDist(r, 6.0);
            lit = max(lit, SGLine(hx - 0.6, 0.013, aa));
            lit = max(lit, SGLine(hx - 0.66, 0.007, aa) * 0.7);
            // 六条辐，每条两对 60° 的枝
            float seg = SG_TAU / 6.0;
            float a6 = atan2(r.y, r.x);
            float phi = round(a6 / seg) * seg;
            float2 dir = float2(cos(phi), sin(phi));
            float along = dot(r, dir);
            float across = r.x * dir.y - r.y * dir.x;
            float spoke = SGLine(across, 0.011, aa) * step(0.1, along) * step(along, 0.6);
            lit = max(lit, spoke);
            [unroll] for (int b = 0; b < 2; b++)
            {
                float at = b == 0 ? 0.3 : 0.45;
                float bl = b == 0 ? 0.12 : 0.08;
                float2 local = float2(along - at, abs(across));
                // 枝：从 (0,0) 朝 (cos60, sin60) 方向伸 bl
                float2 bd = float2(0.5, 0.866);
                float t2 = clamp(dot(local, bd), 0.0, bl);
                float dist = length(local - bd * t2);
                lit = max(lit, SGLine(dist, 0.009, aa) * 0.9);
            }
            // 中心六角
            float hc = SGPolyDist(r, 6.0);
            lit = max(lit, 1.0 - smoothstep(0.08, 0.08 + aa, hc));
            lit = max(lit, SGLine(hc - 0.14, 0.008, aa));
            // 霜花淡底
            float frost = SGFbm(q * 6.0 + P.z * 9.0);
            float fill = (1.0 - smoothstep(0.82, 0.9, d)) * (0.12 + 0.28 * smoothstep(0.55, 0.85, frost));
            float3 glow = float3(0.35, 0.78, 1.0) * 1.3;
            if (P.w > 0.5)
            {
                lit = max(lit, SGLine(d - 1.0, 0.02, aa));
                glow = lerp(glow, float3(1.0, 0.85, 0.3) * 1.9, step(0.98, d));
            }
            float4 c = SGCompose(lit, back, fill, glow, float3(0.02, 0.05, 0.1), float3(0.85, 0.95, 1.0), flash);
            c.a *= step(d, 1.04);
            return c * vis;
        }

        // ───────────── 模式 2：火卦 ─────────────
        float4 ShadeFire(float2 q, float4 P)
        {
            float grow, vis, flash;
            SGTiming(P.x, grow, vis, flash);
            q /= grow;
            float time = _Time.y;
            float d = length(q);
            float aa = max(fwidth(d), 1e-4) * 1.2;
            float ang = atan2(q.y, q.x);
            float lit = 0, back = 0;
            // 外缘火舌：基环 0.78，往外跳 0.06–0.2
            float a01 = ang / SG_TAU + 0.5;
            float h = 0.06 + 0.16 * SGNoise(float2(a01 * 22.0 + P.z * 5.0, time * 2.6)) * SGNoise(float2(a01 * 9.0 - time * 0.7, P.z));
            float fr = (d - 0.78) / max(h, 1e-3);
            float tongue = step(0.0, fr) * (1.0 - smoothstep(0.75, 1.0, fr));
            float3 flameCol = lerp(float3(1.0, 0.62, 0.18) * 1.5, float3(0.95, 0.18, 0.03) * 1.3, saturate(fr));
            lit = max(lit, SGLine(d - 0.78, 0.016, aa));
            back = max(back, SGLine(d - 0.8, 0.1, aa) * 0.55);
            lit = max(lit, SGLine(d - 0.7, 0.008, aa) * 0.8);
            // 八卦三爻：8 个方向，r 0.47 / 0.54 / 0.61 三道横杠，阴爻中间断开
            float rot = -time * 0.3 + P.z;
            float seg = SG_TAU / 8.0;
            float aRot = ang + rot;
            float k = round(aRot / seg);
            float phi = k * seg;
            float2 dir = float2(cos(phi - rot), sin(phi - rot));
            float along = dot(q, dir);
            float across = q.x * dir.y - q.y * dir.x;
            float gi = fmod(fmod(k, 8.0) + 8.0, 8.0);
            [unroll] for (int b = 0; b < 3; b++)
            {
                float rr = 0.47 + 0.07 * b;
                float bit = fmod(floor(gi / pow(2.0, b)), 2.0);
                float bar = SGLine(along - rr, 0.017, aa) * step(abs(across), 0.13);
                bar *= bit > 0.5 ? 1.0 : step(0.03, abs(across));
                lit = max(lit, bar);
            }
            back = max(back, step(0.42, d) * step(d, 0.66) * 0.25);
            // 中心火眼
            lit = max(lit, SGLine(d - 0.3, 0.012, aa));
            float eye = 1.0 - smoothstep(0.1, 0.1 + aa, d);
            float swirl = 0.5 + 0.5 * sin(ang * 3.0 - d * 20.0 + time * 3.0);
            lit = max(lit, eye);
            float fill = (1.0 - smoothstep(0.3, 0.32, d)) * (0.2 + 0.25 * swirl) + (1.0 - smoothstep(0.76, 0.8, d)) * 0.1;
            float3 glow = float3(1.0, 0.3, 0.04) * 1.45;
            if (P.w > 0.5)
            {
                lit = max(lit, SGLine(d - 1.0, 0.02, aa));
                glow = lerp(glow, float3(1.0, 0.85, 0.3) * 1.9, step(0.98, d));
            }
            float4 c = SGCompose(lit, back, fill, glow, float3(0.09, 0.015, 0.0), float3(1.0, 0.35, 0.05), flash);
            // 火舌是加色
            c.rgb += flameCol * tongue * (1.0 + flash);
            c.a = max(c.a, tongue * 0.25);
            c.a *= step(d, 1.05);
            return c * vis;
        }

        // ───────────── 模式 3：熔铜泼溅 ─────────────
        float4 ShadeMolten(float2 q, float4 P)
        {
            float t = saturate(P.x);
            float d = length(q);
            float ang = atan2(q.y, q.x);
            float a01 = ang / SG_TAU + 0.5;
            float seed = P.z;
            // 主团 + 指状溅痕
            float blobR = 0.5 + 0.12 * (SGNoise(float2(a01 * 7.0, seed * 3.0)) - 0.5) * 2.0;
            float fingers = pow(SGNoise(float2(a01 * 26.0, seed * 5.0 + 2.0)), 3.0);
            float R = blobR + fingers * 0.45;
            float spread = 0.35 + 0.65 * saturate(t * 12.0);
            R *= spread;
            float aa = max(fwidth(d), 1e-4) * 1.5;
            float inside = 1.0 - smoothstep(R - aa, R + aa, d);
            // 散点小滴
            float2 cell = floor(q * 9.0);
            float2 fc = frac(q * 9.0) - 0.5;
            float dropOn = step(0.86, SGHash(cell + seed * 17.0)) * step(0.55, d) * step(d, 0.98);
            float drop = dropOn * (1.0 - smoothstep(0.18, 0.24, length(fc)));
            float cover = max(inside, drop);
            // 冷却：余热从 P.w 往 0 掉；表面流纹
            float heat = saturate(P.w) * saturate(1.0 - t * 3.2);
            float flow = SGFbm(q * 5.0 + float2(seed, -seed) + _Time.y * 0.15);
            float crack = 1.0 - smoothstep(0.0, 0.07, abs(flow - 0.5));
            float3 hot = lerp(float3(1.5, 0.3, 0.03), float3(2.0, 0.85, 0.18), smoothstep(0.45, 0.9, flow));
            float3 crust = lerp(float3(0.06, 0.04, 0.035), float3(0.18, 0.09, 0.04), flow);
            float3 rgb = lerp(crust, hot, heat);
            // 冷壳上的发光裂缝比整体冷得慢
            rgb += float3(1.5, 0.32, 0.04) * crack * saturate(heat * 2.0 + 0.35 * (1.0 - t)) * step(heat, 0.95);
            float fade = 1.0 - smoothstep(0.8, 1.0, t);
            float a = cover * fade;
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
            // 水光：几粒高光
            float2 cell = floor(q * 14.0);
            float glint = step(0.93, SGHash(cell + P.z * 3.0)) * (1.0 - smoothstep(0.08, 0.2, length(frac(q * 14.0) - 0.5)));
            float3 rgb = float3(0.0, 0.0, 0.0) + float3(0.6, 0.75, 0.8) * glint * inside * (1.0 - t) * 0.6;
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
