// 状态皮（特效打磨 B 路）：挂了状态的敌人身上多画一遍的「皮」（StatusFx 把这个材质追加到身体渲染器的材质表末尾：单子网格的网格不用再蒙皮一次），
// 沿法线往外鼓一点点（不和身体打架），近看是细节、远看是一圈状态色的轮廓光：
//   冰（减速）：从脚往上长的冰壳——噪声 + 离地高度决定覆盖，冰面是一块块大切面冰晶（亮面白、暗面冰蓝，晶格边深蓝灰），前沿一道霜白；
//   蚀：一块块腐蚀斑（墨绿芯 + 鲜绿边）、斑里冒泡（少而大的泡一亮一灭），沿世界竖直方向往下淌的蚀液条纹；
//   冰晶 / 蚀斑 / 泡按 TEXCOORD2 = 绑定姿势位置（米，导入时 FurBake 烘，角色都有）算 3D 晶格和噪声：贴在皮肤上，
//   不被网格 uv 的图集岛缝切出直边，动画、转身时也不游走；没有这份数据的网格（静态件）退回网格 uv；
//   雷：贴着皮肤乱窜的电纹（脊线噪声，每 1/14 s 换一次形状），亮蓝白；
//   火：皮肤上发亮的炭火裂纹（慢慢往上爬）；
//   眩晕：只有淡黄的轮廓光。
// 参数（MaterialPropertyBlock，渲染器级，和 EnemyBody / DeathDissolve 的写法一样先 Get 再 Set）：
//   _StatusAmt x 冰、y 蚀、z 雷、w 火（0..1，C# 端缓入缓出）；_StatusMisc x 眩晕、y 种子、z 地面高度（世界 y）、w 1 / 身高；
//   _StatusRim rgb = 轮廓光颜色（HDR，按最强的状态混），a = 轮廓光强度。
// 混合：预乘 alpha（冰壳 / 蚀斑是实的，电纹 / 炭火 / 轮廓光是发光的）。不写深度、没有阴影 / 深度通道。
Shader "Spiritfire/FxStatusSkin"
{
    Properties
    {
        _StatusAmt("Amount (x Frost, y Corrode, z Shock, w Burn)", Vector) = (0, 0, 0, 0)
        _StatusMisc("Misc (x Stun, y Seed, z GroundY, w 1/Height)", Vector) = (0, 0, 0, 1)
        [HDR] _StatusRim("Rim (rgb, a strength)", Color) = (0, 0, 0, 0)
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent-30" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }

        Pass
        {
            Name "ForwardStatusSkin"
            Tags { "LightMode"="UniversalForward" }
            Blend One OneMinusSrcAlpha
            ZWrite Off
            ZTest LEqual
            Cull Back

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _StatusAmt;
                float4 _StatusMisc;
                half4 _StatusRim;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                float3 rest : TEXCOORD2;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                half fog : TEXCOORD3;
                // 相对物体原点的世界坐标（米）：电纹 / 炭火纹用 3D 噪声（网格 uv 是一块块图集岛，岛缝会把细线切成方块）
                float3 local : TEXCOORD4;
                // xyz = 绑定姿势位置（米），w = 1 有这份数据 / 0 没有（退回网格 uv）
                float4 rest : TEXCOORD5;
            };

            float SkHash3(float3 p) { return frac(sin(dot(p, float3(17.1, 113.7, 51.3))) * 43758.5453); }

            float SkNoise3(float3 p)
            {
                float3 i = floor(p);
                float3 f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(lerp(SkHash3(i), SkHash3(i + float3(1, 0, 0)), f.x), lerp(SkHash3(i + float3(0, 1, 0)), SkHash3(i + float3(1, 1, 0)), f.x), f.y),
                            lerp(lerp(SkHash3(i + float3(0, 0, 1)), SkHash3(i + float3(1, 0, 1)), f.x), lerp(SkHash3(i + float3(0, 1, 1)), SkHash3(i + float3(1, 1, 1)), f.x), f.y), f.z);
            }

            float SkHash(float2 p) { return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
            float2 SkHash2(float2 p) { return frac(sin(float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3)))) * 43758.5453); }

            float SkNoise(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(SkHash(i), SkHash(i + float2(1, 0)), f.x), lerp(SkHash(i + float2(0, 1)), SkHash(i + float2(1, 1)), f.x), f.y);
            }

            float SkFbm(float2 p)
            {
                return SkNoise(p) * 0.55 + SkNoise(p * 2.03 + 7.1) * 0.3 + SkNoise(p * 4.1 + 3.7) * 0.15;
            }

            // 晶格：到最近点的距离 x、到第二近的距离 y（y − x 小 = 晶格边）、最近格的随机数 z
            float3 SkVoronoi(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                float d1 = 8.0, d2 = 8.0, id = 0.0;
                for (int y = -1; y <= 1; y++)
                for (int x = -1; x <= 1; x++)
                {
                    float2 g = float2(x, y);
                    float2 o = SkHash2(i + g);
                    float2 r = g + o - f;
                    float d = dot(r, r);
                    if (d < d1) { d2 = d1; d1 = d; id = SkHash(i + g + 3.1); }
                    else if (d < d2) { d2 = d; }
                }
                return float3(sqrt(d1), sqrt(d2), id);
            }

            // 3D 晶格（同上，绑定姿势空间里求）
            float3 SkVoronoi3(float3 p)
            {
                float3 i = floor(p);
                float3 f = frac(p);
                float d1 = 8.0, d2 = 8.0, id = 0.0;
                for (int z = -1; z <= 1; z++)
                for (int y = -1; y <= 1; y++)
                for (int x = -1; x <= 1; x++)
                {
                    float3 g = float3(x, y, z);
                    float3 c = i + g;
                    float3 r = g + float3(SkHash3(c), SkHash3(c + 19.7), SkHash3(c + 47.3)) - f;
                    float d = dot(r, r);
                    if (d < d1) { d2 = d1; d1 = d; id = SkHash3(c + 3.1); }
                    else if (d < d2) { d2 = d; }
                }
                return float3(sqrt(d1), sqrt(d2), id);
            }

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                float3 posWS = TransformObjectToWorld(v.positionOS.xyz);
                float3 nWS = TransformObjectToWorldNormal(v.normalOS);
                // 往外鼓：底子 6 mm，冰壳再厚 2 cm、蚀斑 8 mm
                float puff = 0.006 + 0.02 * _StatusAmt.x + 0.008 * _StatusAmt.y;
                posWS += nWS * puff;
                o.positionWS = posWS;
                o.positionCS = TransformWorldToHClip(posWS);
                o.normalWS = nWS;
                o.uv = v.uv;
                o.fog = ComputeFogFactor(o.positionCS.z);
                o.local = posWS - TransformObjectToWorld(float3(0, 0, 0));
                o.rest = float4(v.rest, dot(v.rest, v.rest) > 1e-8 ? 1.0 : 0.0);
                return o;
            }

            half Band(half v, half edge, half w) { return saturate((v - edge) / w + 0.5); }

            half4 Frag(Varyings i) : SV_Target
            {
                float frost = saturate(_StatusAmt.x), corrode = saturate(_StatusAmt.y), shock = saturate(_StatusAmt.z), burn = saturate(_StatusAmt.w);
                float seed = _StatusMisc.y;
                float t = _Time.y;
                half3 N = normalize(i.normalWS);
                half3 V = GetWorldSpaceNormalizeViewDir(i.positionWS);
                half ndv = saturate(dot(N, V));
                half fres = pow(1.0 - ndv, 2.0);
                float2 uv = i.uv + seed * 3.17;
                float h01 = saturate((i.positionWS.y - _StatusMisc.z) * _StatusMisc.w);
                bool hasRest = i.rest.w > 0.5;
                float3 rest = i.rest.xyz + seed * 1.73;

                half3 col = 0;
                half a = 0;

                // ── 冰壳 ──
                [branch] if (frost > 0.001)
                {
                    // 绑定姿势空间：每米 4.5 格（一块冰晶二十来厘米）；没有就按网格 uv（9 格 / uv，跨图集岛缝会切直边）
                    float n = hasRest ? SkNoise3(rest * 3.6) * 0.6 + SkNoise3(rest * 7.4 + 3.7) * 0.4 : SkFbm(uv * 9.0);
                    // 从脚往上长：覆盖阈值 = 高度 − 进度（噪声让前沿参差）
                    float cover = (frost * 1.35 - h01) + (n - 0.5) * 0.55;
                    half cw = max(fwidth(cover), 1e-3) * 1.2;
                    half ice = Band(cover, 0.0, cw);
                    // 风格审查：冰晶是块面清楚的大切面（低多边形的感觉），亮面白、暗面冰蓝，晶格边是一道深一点的蓝灰——
                    // 原来 26 格 / uv 的细晶格 + 亮白格边 + 闪点读成一层发白的细裂纹
                    float3 vo = hasRest ? SkVoronoi3(rest * 4.5) : SkVoronoi(uv * 9.0);
                    half facet = 1.0 - saturate((vo.y - vo.x) / 0.07);
                    Light L = GetMainLight();
                    half ndl = saturate(dot(N, L.direction) * 0.5 + 0.5);
                    // 每块晶面自己的朝向（格随机数）+ 主光：两段色阶
                    half face = Band(vo.z * 0.55 + ndl * 0.75, 0.76, 0.05);
                    half3 iceCol = lerp(half3(0.33, 0.6, 0.86), half3(0.74, 0.89, 0.99), face) * (0.78 + 0.3 * ndl);
                    iceCol = lerp(iceCol, half3(0.27, 0.42, 0.6), facet * 0.55);
                    // 前沿一道霜白（只是一条边）
                    half rim = Band(cover, 0.0, cw) * (1.0 - Band(cover, 0.07, cw));
                    iceCol = lerp(iceCol, half3(1.0, 1.1, 1.2), rim * 0.6);
                    half ia = ice * (0.56 + 0.18 * fres) * saturate(frost * 1.5);
                    col = col * (1 - ia) + iceCol * ia;
                    a = a + ia * (1 - a);
                }

                // ── 蚀斑 ──
                [branch] if (corrode > 0.001)
                {
                    // 斑块用贴着身体的 3D 噪声（米为单位，一块十几厘米）：网格 uv 是一块块图集岛，按 uv 算的斑会被岛缝切成方块；
                    // 优先用绑定姿势位置（跟着皮肤走），没有才用相对物体原点的世界坐标（转身时斑会在身上滑）
                    float3 qc = (hasRest ? rest : i.local) * 4.2 + float3(seed * 2.1, t * 0.05, seed);
                    float n = SkNoise3(qc) * 0.6 + SkNoise3(qc * 2.05 + 4.3) * 0.3 + SkNoise3(qc * 4.1 + 1.7) * 0.1;
                    float blot = n - (1.0 - corrode * 0.36);
                    half bw = max(fwidth(blot), 1e-3) * 1.2;
                    half inside = Band(blot, 0.0, bw);
                    half edgeBand = inside * (1.0 - Band(blot, 0.05, bw));
                    // 斑里冒泡：少而大的泡（风格审查：原来 30 格 / uv 的小泡是一层细碎的噪点）
                    float3 vb = hasRest ? SkVoronoi3(rest * 6.5 + float3(0, -t * 0.12, 0)) : SkVoronoi(uv * 13.0 + float2(0, -t * 0.25));
                    half bub = (1.0 - Band(vb.x, 0.2, 0.04)) * step(0.78, frac(vb.z * 7.0 + t * 0.6)) * inside;
                    // 往下淌的蚀液：世界竖直方向的条纹（粗一点、少一点）
                    float drip = SkNoise(float2(uv.x * 18.0 + uv.y * 3.0, i.positionWS.y * 2.2 + t * 1.4 + seed * 5.0));
                    half dr = Band(drip, 0.84 - corrode * 0.08, 0.03) * corrode;
                    // 三段：墨绿斑芯 / 鲜绿斑边 / 黄绿的泡（元素色表「蚀」），HDR 收一档，不比模型亮一截
                    half3 dark = half3(0.05, 0.17, 0.07);
                    half3 acid = half3(0.48, 1.15, 0.14);
                    half3 cc = lerp(dark, acid, edgeBand);
                    cc += acid * bub * 0.9;
                    half ca = saturate(inside * 0.9 + dr * 0.75) * corrode;
                    cc = lerp(cc, acid * 0.9, dr * (1 - inside));
                    col = col * (1 - ca) + cc * ca;
                    a = a + ca * (1 - a);
                }

                // ── 电纹 ──
                [branch] if (shock > 0.001)
                {
                    float jump = floor(t * 14.0);
                    float2 off = SkHash2(float2(jump, seed)) * 17.0;
                    float3 q = i.local * 6.0 + off.xyx;
                    float r = SkNoise3(q) * 0.7 + SkNoise3(q * 2.3 + 5.1) * 0.3;
                    half ridge = 1.0 - abs(r * 2.0 - 1.0);
                    half vein = Band(ridge, 0.945, clamp(fwidth(ridge) * 1.2, 1e-3, 0.03));
                    half flick = step(0.35, SkHash(float2(jump, seed + 1.7)));
                    half sa = vein * shock * (0.6 + 0.4 * flick);
                    col += half3(1.1, 2.2, 3.6) * sa;
                    a = a + sa * 0.25 * (1 - a);
                }

                // ── 炭火裂纹 ──
                [branch] if (burn > 0.001)
                {
                    float3 q = i.local * 3.2 + float3(seed, -t * 0.35, seed * 0.7);
                    float r = SkNoise3(q) * 0.7 + SkNoise3(q * 2.2 + 3.1) * 0.3;
                    half ridge = 1.0 - abs(r * 2.0 - 1.0);
                    half crack = Band(ridge, 0.93 - burn * 0.03, clamp(fwidth(ridge) * 1.2, 1e-3, 0.03));
                    half pulse = 0.75 + 0.25 * sin(t * 7.0 + uv.y * 12.0);
                    half ba = crack * burn * pulse;
                    col += half3(2.6, 0.9, 0.18) * ba;
                    a = a + ba * 0.3 * (1 - a);
                }

                // ── 轮廓光（远处只看颜色就分得清） ──
                half rimK = pow(1.0 - ndv, 3.0) * _StatusRim.a;
                col += _StatusRim.rgb * rimK;
                a = a + saturate(rimK) * 0.12 * (1 - a);

                clip(a + dot(col, 1) - 0.002);
                col = MixFogColor(col, unity_FogColor.rgb * a, i.fog);
                return half4(col, saturate(a));
            }
            ENDHLSL
        }
    }

    Fallback Off
}
