// 地面预警（docs/unity-parity.md F2，D21；Three.js src/fx/Ground.ts 的 MODE_WARNING / MODE_RING 与 bosses/Visuals.ts 的 GroundDecal）。
// 三种投射方式（Telegraph.ChooseMode 选）：
//   · 体积投射（首选，管线开着深度图时）：Telegraph 用一个单位立方体的 MeshRenderer 当投影盒，在透明队列里（2970 左右：熔岩面 2900、冰面 2950、水面 2960 之后，
//     冰晶特效 2980 和粒子 3000+ 之前）用 UniversalForwardOnly 通道画——从深度图重建世界坐标、变换到盒子空间、按形状算遮罩，所以贴合坡面 / 台阶，
//     而且画在熔岩 / 冰面 / 水面这些透明队列的地表之上（URP 贴花在不透明物体之后、透明物体之前画，会被它们盖住或洗白）。
//     熔岩、水不写进深度图：深度图里是它们下面的床，Telegraph 把液面高度写进 _Plane，重建点比液面低出一截时改用视线与液面的交点。
//   · URP 贴花（没有深度图、但渲染器有贴花特性时）：DecalScreenSpaceProjector 通道。
//   · 平放 Quad（都没有时）：同一个 UniversalForwardOnly 通道的网格模式（uv 即形状坐标）。
//
// 形状（_Mode.x）：0 圆 / 环 / 扇形（内半径 _Shape0.y、半角 _Shape0.z）、1 长条（原点在近端中点，沿 +y 延伸）、2 辐条、3 正多边形。
// 样式（_Mode.y）：0 预警、1 冲击环、2 持续区域。_Mode.z = 1 表示加法混合（不画暗衬边）。
// 预警的读法（第一人称 15–20 m 外也要一眼读出范围和倒计时）：
//   · 一圈暗衬边（_Color2，形状外侧）+ 一圈亮边（_Color，形状内侧）：两者都按屏幕像素保底宽度（由边界距离的屏幕导数换算），远处 / 掠射角不会细成一根线；
//     亮暗夹边在亮沙、冰雪上靠暗边、在熔岩、玄武岩上靠亮边，都读得出轮廓；
//   · 整片淡底 + 倒计时填充：圆类（圆、环、扇形、多边形）从外沿往里收，长条 / 辐条由近到远推；填充前沿是一道亮线；
//   · 亮边随进度变亮（紧迫度 = 进度²）并脉动，脉动相位由 CPU 按 10 → 32 rad/s 积分写进来（避免着色器里变频造成的相位跳变）；收尾闪一下、略放大。
// 动画全部由 CPU 推进后写进材质（每个预警一份材质实例）。
// 投影盒内还有两道淡出：竖直面（由重建坐标导数得到的法线 |n.y| < 0.25）不画，避免墙面 / 角色侧面被拉成长条；盒子上下 12% 渐隐，不在穿过盒边的物体上切出硬边。
Shader "Spiritfire/Telegraph"
{
    Properties
    {
        [HDR] _Color("Color", Color) = (1, 0.19, 0.19, 1)
        _Color2("Backing Color (dark outline, alpha = strength)", Color) = (0.05, 0, 0.02, 0.6)
        _Anim("Progress, Opacity, Pulse, Flash", Vector) = (0, 1, 1, 0)
        _Anim2("Grow, Time, Seed, Urgency", Vector) = (0, 0, 0, 0)
        _Shape0("Outer or Length, Inner, Half Angle, Count", Vector) = (1, 0, 4, 0)
        _Shape1("Half Width, Rotation, Rim, Backing Max", Vector) = (0.5, 0, 0.12, 0.3)
        _Extent("Box Size XY, Origin XY", Vector) = (2, 2, 0, 0)
        _Mode("Shape, Style, Additive", Vector) = (0, 0, 0, 0)
        _Plane("Liquid Plane Y, Enabled, Box Height", Vector) = (0, 0, 0, 0)
        [HideInInspector] _SrcBlend("Src Blend", Float) = 5
        [HideInInspector] _DstBlend("Dst Blend", Float) = 10
        // 网格通道的两种模式：体积投射（Cull Front + ZTest Greater）/ 平放 Quad（Cull Off + ZTest LEqual + Offset）
        [HideInInspector] _Volume("Volume Mode", Float) = 0
        [HideInInspector] _Cull("Cull", Float) = 0
        [HideInInspector] _ZTest("ZTest", Float) = 4
        [HideInInspector] _OffsetFactor("Offset Factor", Float) = -2
        [HideInInspector] _OffsetUnits("Offset Units", Float) = -2
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

        #define SF_PI 3.14159265
        #define SF_TAU 6.28318531

        CBUFFER_START(UnityPerMaterial)
            float4 _Color;
            float4 _Color2;  // 暗衬边色，alpha = 强度
            float4 _Anim;    // x 填充进度 0..1，y 不透明度，z 脉动亮度，w 收尾闪光
            float4 _Anim2;   // x 收尾放大 0..1，y 时间（秒），z 随机种子，w 紧迫度
            float4 _Shape0;  // x 外半径 / 长度（米），y 内半径（米），z 扇形半角（弧度，≥ π 为整圈），w 辐条数 / 边数
            float4 _Shape1;  // x 半宽（米，长条 / 辐条），y 旋转（弧度，辐条 / 多边形），z 亮边宽（米），w 暗衬边最宽（米，投影盒留的余量）
            float4 _Extent;  // xy 投影盒尺寸（米），zw 形状原点相对盒心的偏移（米）
            float4 _Mode;    // x 形状，y 样式，z 加法混合
            float4 _Plane;   // x 液面高度（世界 y），y 1 = 有液面，z 投影盒高（米，0 = 按比例渐隐）
            float _SrcBlend;
            float _DstBlend;
            float _Volume;
            float _Cull;
            float _ZTest;
            float _OffsetFactor;
            float _OffsetUnits;
            float _DrawOrder;
            float _DecalMeshBiasType;
            float _DecalMeshDepthBias;
            float _DecalMeshViewBias;
        CBUFFER_END

        struct TeleShape
        {
            float edge;   // 到形状边界的距离（米，里面为正）
            float prog;   // 填充坐标 0..1（圆类：由内向外；长条 / 辐条：由近到远）
            float span;   // 填充坐标 1 对应多少米（前沿线宽换算用）
            float ang;    // 绕原点的角度（0 = 前方 +y）
            float along;  // 沿长条 / 辐条的距离（米）
            float lane;   // 横向偏移（米）
        };

        TeleShape EvalShape(float2 q)
        {
            TeleShape s;
            float d = length(q);
            float ang = atan2(q.x, q.y);
            s.ang = ang;
            s.along = d;
            s.lane = 0;
            float kind = _Mode.x;
            if (kind < 0.5)
            {
                // 圆 / 环 / 扇形
                float outer = _Shape0.x, inner = _Shape0.y, halfAngle = _Shape0.z;
                float e = outer - d;
                if (inner > 0) e = min(e, d - inner);
                if (halfAngle < 3.1)
                {
                    float da = abs(ang) - halfAngle;
                    e = min(e, -d * sin(clamp(da, -1.5707, 1.5707)));
                }
                s.edge = e;
                s.span = max(outer - inner, 1e-3);
                s.prog = saturate((d - inner) / s.span);
            }
            else if (kind < 1.5)
            {
                // 长条：原点在近端中点，沿 +y 延伸 _Shape0.x 米，半宽 _Shape1.x
                float w = _Shape1.x, len = _Shape0.x;
                s.edge = min(w - abs(q.x), min(q.y, len - q.y));
                s.span = max(len, 1e-3);
                s.prog = saturate(q.y / s.span);
                s.along = q.y;
                s.lane = q.x;
            }
            else if (kind < 2.5)
            {
                // 辐条：_Shape0.w 条，从内半径 _Shape0.y 伸到 _Shape0.x，半宽 _Shape1.x，第一条朝 _Shape1.y
                float n = max(1.0, _Shape0.w), seg = SF_TAU / n, rot = _Shape1.y;
                float phi = rot + round((ang - rot) / seg) * seg;
                float2 dir = float2(sin(phi), cos(phi));
                float along = dot(q, dir);
                float across = q.x * dir.y - q.y * dir.x;
                float len = _Shape0.x, inner = _Shape0.y, w = _Shape1.x;
                s.edge = min(w - abs(across), min(along - inner, len - along));
                s.span = max(len - inner, 1e-3);
                s.prog = saturate((along - inner) / s.span);
                s.along = along;
                s.lane = across;
            }
            else
            {
                // 正多边形：外接圆半径 _Shape0.x，_Shape0.w 条边，一条边的法线朝 _Shape1.y
                float n = max(3.0, _Shape0.w), seg = SF_TAU / n;
                float a = ang - _Shape1.y + seg * 0.5;
                a = a - seg * floor(a / seg) - seg * 0.5;
                float pd = d * cos(a);
                float apothem = _Shape0.x * cos(SF_PI / n);
                s.edge = apothem - pd;
                s.span = max(apothem, 1e-3);
                s.prog = saturate(pd / s.span);
            }
            return s;
        }

        // q：形状局部坐标（米，+y 前方，+x 右）。线宽都按「每像素多少米」保底（由边界距离 / 填充坐标的屏幕导数得到，深度不连续处夹住上限）
        float4 ShadeTelegraph(float2 q)
        {
            q /= 1.0 + 0.06 * _Anim2.x;
            TeleShape s = EvalShape(q);
            float fw = clamp(fwidth(s.edge), 1e-4, 0.6);
            float fwp = clamp(fwidth(s.prog) * s.span, 1e-4, 0.6);
            float inside = saturate(s.edge / fw + 0.5);
            float rimM = _Shape1.z;
            // 亮边至少 3.4 像素：第一人称 15–20 m 外掠射角下也是一道实线，不是发丝
            float rimW = max(rimM, fw * 3.4);
            float rim = inside * (1.0 - saturate((s.edge - rimW) / fw + 0.5));
            // 暗衬边：形状外侧一圈，至少 2.6 像素、不超过投影盒留的余量
            float backW = min(max(rimM * 0.6, fw * 2.6), max(_Shape1.w, fw));
            float backing = (1.0 - inside) * (1.0 - saturate((-s.edge - backW) / fw + 0.5));
            float progress = _Anim.x, opacity = _Anim.y, pulse = _Anim.z, flash = _Anim.w;
            float t = _Anim2.y, u = _Anim2.w;
            bool additive = _Mode.z > 0.5;
            float3 base = _Color.rgb;
            float3 col;
            float a;
            if (_Mode.y < 0.5)
            {
                // 预警：圆类从外沿往里收，长条 / 辐条由近到远推
                bool closing = _Mode.x < 0.5 || _Mode.x > 2.5;
                float f = closing ? 1.0 - progress : progress;
                float frontM = (s.prog - f) * s.span;
                float filled = (closing ? saturate(frontM / fwp + 0.5) : saturate(-frontM / fwp + 0.5)) * step(0.001, progress);
                float front = (1.0 - saturate((abs(frontM) - fwp * 1.3) / fwp)) * step(0.02, progress) * step(progress, 0.995);
                float deco = 0;
                if (_Mode.x < 0.5)
                {
                    // 内侧一圈转动的刻度
                    float r01 = length(q) / max(_Shape0.x, 1e-3);
                    deco = step(0.55, frac(s.ang / SF_TAU * 28.0 + t * 0.35)) * step(0.8, r01) * step(r01, 0.86) * 0.22;
                }
                else if (_Mode.x < 2.5)
                {
                    // 长条 / 辐条：往前流的斜纹
                    deco = step(0.55, frac(s.along * 0.3 - abs(s.lane) * 0.3 - t * 1.6)) * 0.1;
                }
                float body = 0.15 + 0.05 * u + filled * (0.19 + 0.13 * u) + deco;  // 填满时约 0.52：暗地表上不糊成一片
                // 亮边一出现就近乎不透明（形状第一帧就读得出），紧迫时只略微提亮：HDR 提太多会被泛光 + 冷色调白平衡洗成粉白
                float glow = lerp(1.0, 1.3, u) * lerp(0.85, 1.0, pulse);
                float rimA = lerp(0.88, 1.0, u) * lerp(0.85, 1.0, pulse);
                col = base * lerp(0.85, 1.0, filled);
                col = lerp(col, lerp(base, float3(1.0, 1.0, 1.0), 0.35) * 1.4, front);
                col = lerp(col, base * glow, rim);
                a = max(max(body, front * 0.9), rim * rimA);
            }
            else if (_Mode.y < 1.5)
            {
                // 冲击环：亮环在 prog = 进度处，越往外越细（至少 2.5 像素）；内侧淡淡的余波
                float th = max((0.035 + 0.09 * (1.0 - progress)) * s.span, fwp * 2.5);
                float dm = abs(s.prog - progress) * s.span;
                float ring = 1.0 - smoothstep(th * 0.5, th, dm);
                float wake = s.prog < progress ? pow(s.prog / max(progress, 1e-3), 4.0) * 0.3 : 0.0;
                a = ring + wake;
                col = additive ? base + 0.7 * ring * ring * ring : base * (1.0 + 0.6 * ring);
                // 普通混合的冲击环在亮地表上也要读得出：环外侧一道暗衬
                if (!additive)
                {
                    float outside = (s.prog - progress) * s.span;
                    float shade = step(0.0, outside - th * 0.5) * (1.0 - smoothstep(fwp * 2.0, fwp * 3.5 + th * 0.4, outside - th * 0.5)) * step(0.02, progress);
                    col = lerp(col, _Color2.rgb, shade * (1.0 - ring));
                    a = max(a, shade * _Color2.a * 0.8);
                }
                backing = 0;
            }
            else
            {
                // 持续区域：流动的熔岩 / 火焰纹理 + 亮边
                float n = sin(q.x * 1.3 + t * 1.2) * sin(q.y * 1.5 - t * 0.9);
                n += 0.6 * sin((q.x - q.y) * 0.8 + t * 2.3);
                n += 0.35 * sin(length(q) * 2.2 - t * 3.0);
                float hot = saturate(0.5 + 0.3 * n);
                col = lerp(base * 0.55, base * 1.35 + float3(0.25, 0.18, 0.05), hot);
                a = 0.38 + 0.3 * hot + rim * 0.5;
                col *= 1.0 + rim * 0.5;
            }
            col = lerp(col, col * 1.6 + 0.15, saturate(flash * 0.5));
            a = saturate(a) * inside;
            if (!additive)
            {
                // 形状外侧的暗衬边（与亮边不重叠：inside 在边界处抗锯齿过渡）
                float back = backing * _Color2.a;
                col = lerp(_Color2.rgb, col, inside);
                a = max(a, back);
            }
            a *= opacity * _Color.a;
            return float4(col, a);
        }

        // 盒子空间（x 右、y 投射深度、z 前，各在 −0.5..0.5）里的着色：裁掉盒外、竖直面、盒子上下边缘渐隐
        float4 ShadeInBox(float3 ds, float3 positionWS)
        {
            float2 uv = ds.xz + 0.5;
            float2 q = (uv - 0.5) * _Extent.xy - _Extent.zw;
            // 由重建坐标导数得到的表面法线：竖直面（墙、角色侧面）不画
            float3 nrm = cross(ddy(positionWS), ddx(positionWS));
            float facing = abs(nrm.y) * rsqrt(max(dot(nrm, nrm), 1e-12));
            float4 c = ShadeTelegraph(q);
            clip(0.5 - max(abs(ds.x), max(abs(ds.y), abs(ds.z))));
            // 盒子上下面附近渐隐：按米算（_Plane.z = 盒高），盒子为包住液面下的床拉得很高时，地面也不会落进按比例算的渐隐带里变淡
            float fadeY = _Plane.z > 0.0
                ? saturate((0.5 - abs(ds.y)) * _Plane.z / 0.2)
                : 1.0 - smoothstep(0.38, 0.5, abs(ds.y));
            c.a *= smoothstep(0.25, 0.5, facing) * fadeY;
            return c;
        }

        // ───────────── URP 贴花通道（DecalProjector 画的单位立方体） ─────────────

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
            // 只有 Screen Space 通道需要按渲染目标翻转读深度的坐标（同 URP ShaderPassDecal.hlsl）
            if (flipScreen) TransformScreenUV(pixel, _ScreenSize.y);
        #if UNITY_REVERSED_Z
            float depth = LoadSceneDepth(uint2(pixel));
        #else
            float depth = lerp(UNITY_NEAR_CLIP_VALUE, 1, LoadSceneDepth(uint2(pixel)));
        #endif
            float2 positionSS = i.positionCS.xy * _ScreenSize.zw;
            float3 positionWS = ComputeWorldSpacePosition(positionSS, depth, UNITY_MATRIX_I_VP);
            // 投影盒空间：x 右、z 前（贴图 u / v），y 是投射深度（翻转后 −0.5 在投影器一端）
            float3 ds = TransformWorldToObject(positionWS) * float3(1.0, -1.0, 1.0);
            return ShadeInBox(ds, positionWS);
        }
        ENDHLSL

        // URP DecalRendererFeature（Screen Space 技术）在不透明物体之后画这个通道（没有深度图时的退路）
        Pass
        {
            Name "DecalScreenSpaceProjector"
            Tags { "LightMode" = "DecalScreenSpaceProjector" }
            Blend [_SrcBlend] [_DstBlend]
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

        // DBuffer 技术时 URP 用这个通道叠发光（加法）；本项目设成 Screen Space，留着做兜底
        Pass
        {
            Name "DecalProjectorForwardEmissive"
            Tags { "LightMode" = "DecalProjectorForwardEmissive" }
            Blend SrcAlpha One
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

        // 透明队列的网格通道，两种模式（_Volume）：
        //   体积投射：MeshRenderer 画单位立方体（Telegraph 按投影盒缩放），画背面、ZTest Greater（场景表面在背面之前 = 可能在盒里），从深度图重建坐标；
        //   平放 Quad：渲染器没有贴花特性也没有深度图时，uv 即形状坐标。
        // 用贴花投影时 Telegraph 会按材质关掉这个通道（否则投影立方体会被前向通道当普通网格画出来）。
        Pass
        {
            Name "UniversalForwardOnly"
            Tags { "LightMode" = "UniversalForwardOnly" }
            Blend [_SrcBlend] [_DstBlend]
            Cull [_Cull]
            ZWrite Off
            ZTest [_ZTest]
            Offset [_OffsetFactor], [_OffsetUnits]

            HLSLPROGRAM
            #pragma vertex VertMesh
            #pragma fragment FragMesh
            #pragma multi_compile_instancing

            struct MeshAttributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct MeshVaryings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            MeshVaryings VertMesh(MeshAttributes v)
            {
                MeshVaryings o = (MeshVaryings)0;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.uv = v.uv;
                return o;
            }

            float4 FragMesh(MeshVaryings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                if (_Volume > 0.5)
                {
                    // 同 URP 屏幕空间贴花（ShaderPassDecal.hlsl）：读深度的像素坐标按当前渲染目标翻转（_ScaleBiasRt，DrawObjectsPass 每次都设），
                    // 重建坐标用不翻转的屏幕坐标；渲到屏幕（相机叠加 + MSAA）和渲到贴图（截图）两条路都核对过
                    float2 pixel = i.positionCS.xy;
                    float2 fetch = pixel;
                    TransformScreenUV(fetch, _ScreenSize.y);
                #if UNITY_REVERSED_Z
                    float depth = LoadSceneDepth(uint2(fetch));
                #else
                    float depth = lerp(UNITY_NEAR_CLIP_VALUE, 1, LoadSceneDepth(uint2(fetch)));
                #endif
                    float3 positionWS = ComputeWorldSpacePosition(pixel * _ScreenSize.zw, depth, UNITY_MATRIX_I_VP);
                    // 熔岩 / 水面不在深度图里：重建点比液面低出一截（看到的是床），改用视线与液面的交点
                    if (_Plane.y > 0.5 && positionWS.y < _Plane.x - 0.3)
                    {
                        float3 ray = positionWS - _WorldSpaceCameraPos;
                        if (ray.y < -1e-4)
                        {
                            float k = (_Plane.x - _WorldSpaceCameraPos.y) / ray.y;
                            if (k > 0.0 && k < 1.0) positionWS = _WorldSpaceCameraPos + ray * k;
                        }
                    }
                    // 单位立方体：x 右、y 上、z 前
                    float3 os = TransformWorldToObject(positionWS);
                    return ShadeInBox(float3(os.x, os.y, os.z), positionWS);
                }
                float2 q = (i.uv - 0.5) * _Extent.xy - _Extent.zw;
                return ShadeTelegraph(q);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
