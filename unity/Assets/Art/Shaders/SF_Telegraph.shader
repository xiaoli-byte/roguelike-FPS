// 地面预警贴花（docs/unity-parity.md F2，D21；Three.js src/fx/Ground.ts 的 MODE_WARNING / MODE_RING 与 bosses/Visuals.ts 的 GroundDecal）。
// 由 URP DecalProjector 投射（DecalRendererFeature 用 Screen Space 技术）：从深度图重建世界坐标、变换到投影盒空间、按形状算遮罩，
// 所以天然贴合坡面 / 台阶，不会像平面 Quad 那样在坡上穿地。另有一个普通网格通道，渲染器没有贴花特性时由 Telegraph 改用平放的 Quad 兜底。
//
// 形状（_Mode.x）：0 圆 / 环 / 扇形（内半径 _Shape0.y、半角 _Shape0.z）、1 长条（原点在近端中点，沿 +y 延伸）、2 辐条、3 正多边形。
// 样式（_Mode.y）：0 预警（淡底 + 脉动亮边 + 由内向外填充 + 推进前沿，收尾闪一下，取消时淡出）、1 冲击环（扩散的亮环 + 内侧余波）、2 持续区域（流动的熔岩 / 火焰纹理）。
// 动画全部由 CPU 推进后写进材质（每个预警一份材质实例）：脉动相位按 10 → 32 rad/s 积分（紧迫度 = 进度²），避免着色器里随时间变频造成的相位跳变。
// 投影盒内还有两道淡出：竖直面（由深度导数重建的法线 |n.y| < 0.25）不画，避免墙面 / 角色侧面被拉成长条；盒子上下 12% 渐隐，不在穿过盒边的物体上切出硬边。
Shader "Spiritfire/Telegraph"
{
    Properties
    {
        [HDR] _Color("Color", Color) = (1, 0.19, 0.19, 1)
        _Anim("Progress, Opacity, Pulse, Flash", Vector) = (0, 1, 1, 0)
        _Anim2("Grow, Time, Seed, Urgency", Vector) = (0, 0, 0, 0)
        _Shape0("Outer or Length, Inner, Half Angle, Count", Vector) = (1, 0, 4, 0)
        _Shape1("Half Width, Rotation, Rim, Unused", Vector) = (0.5, 0, 0.12, 0)
        _Extent("Box Size XY, Origin XY", Vector) = (2, 2, 0, 0)
        _Mode("Shape, Style", Vector) = (0, 0, 0, 0)
        [HideInInspector] _SrcBlend("Src Blend", Float) = 5
        [HideInInspector] _DstBlend("Dst Blend", Float) = 10
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
            float4 _Anim;    // x 填充进度 0..1，y 不透明度，z 脉动亮度，w 收尾闪光
            float4 _Anim2;   // x 收尾放大 0..1，y 时间（秒），z 随机种子，w 紧迫度
            float4 _Shape0;  // x 外半径 / 长度（米），y 内半径（米），z 扇形半角（弧度，≥ π 为整圈），w 辐条数 / 边数
            float4 _Shape1;  // x 半宽（米，长条 / 辐条），y 旋转（弧度，辐条 / 多边形），z 亮边宽（米）
            float4 _Extent;  // xy 投影盒尺寸（米），zw 形状原点相对盒心的偏移（米）
            float4 _Mode;    // x 形状，y 样式
            float _SrcBlend;
            float _DstBlend;
            float _DrawOrder;
            float _DecalMeshBiasType;
            float _DecalMeshDepthBias;
            float _DecalMeshViewBias;
        CBUFFER_END

        struct TeleShape
        {
            float edge;   // 到形状边界的距离（米，里面为正）
            float prog;   // 填充坐标 0..1（圆类：由内向外；长条 / 辐条：由近到远）
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
                s.prog = saturate((d - inner) / max(outer - inner, 1e-3));
            }
            else if (kind < 1.5)
            {
                // 长条：原点在近端中点，沿 +y 延伸 _Shape0.x 米，半宽 _Shape1.x
                float w = _Shape1.x, len = _Shape0.x;
                s.edge = min(w - abs(q.x), min(q.y, len - q.y));
                s.prog = saturate(q.y / max(len, 1e-3));
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
                s.prog = saturate((along - inner) / max(len - inner, 1e-3));
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
                s.prog = saturate(pd / max(apothem, 1e-3));
            }
            return s;
        }

        // q：形状局部坐标（米，+y 前方，+x 右）；px：每像素多少米（抗锯齿）
        float4 ShadeTelegraph(float2 q, float px)
        {
            q /= 1.0 + 0.06 * _Anim2.x;
            TeleShape s = EvalShape(q);
            float inside = saturate(s.edge / max(px, 1e-4) + 0.5);
            float rimW = max(_Shape1.z, px * 1.5);
            float rim = 1.0 - smoothstep(rimW * 0.3, rimW, s.edge);
            float progress = _Anim.x, opacity = _Anim.y, pulse = _Anim.z, flash = _Anim.w;
            float t = _Anim2.y;
            float3 col = _Color.rgb;
            float a;
            if (_Mode.y < 0.5)
            {
                // 预警：淡底 + 脉动亮边 + 刻度 / 箭纹 + 由内向外填满的内区 + 推进前沿
                float u = _Anim2.w;
                float fill = (1.0 - smoothstep(progress - 0.02, progress, s.prog)) * step(0.001, progress) * (0.32 + 0.12 * u);
                float front = (1.0 - smoothstep(0.0, 0.045, abs(s.prog - progress))) * step(0.02, progress);
                float deco = 0;
                if (_Mode.x < 0.5)
                {
                    float r01 = length(q) / max(_Shape0.x, 1e-3);
                    deco = step(0.55, frac(s.ang / SF_TAU * 28.0 + t * 0.35)) * step(0.83, r01) * step(r01, 0.88) * 0.4;
                }
                else if (_Mode.x < 2.5)
                {
                    deco = step(0.55, frac(s.along * 0.3 - abs(s.lane) * 0.3 - t * 1.6)) * 0.12;
                }
                a = rim * pulse + deco + 0.13 + fill + front * 0.55;
                col = lerp(col, float3(1.0, 0.92, 0.85), saturate(front * 0.45 + rim * 0.2));
                col *= 1.0 + rim * 0.5;
            }
            else if (_Mode.y < 1.5)
            {
                // 冲击环：亮环在 prog = 进度处，越往外越细；内侧淡淡的余波
                float th = 0.035 + 0.09 * (1.0 - progress);
                float ring = 1.0 - smoothstep(0.0, th, abs(s.prog - progress));
                float wake = s.prog < progress ? pow(s.prog / max(progress, 1e-3), 4.0) * 0.3 : 0.0;
                a = ring + wake;
                col += 0.7 * ring * ring * ring;
            }
            else
            {
                // 持续区域：流动的熔岩 / 火焰纹理 + 亮边
                float n = sin(q.x * 1.3 + t * 1.2) * sin(q.y * 1.5 - t * 0.9);
                n += 0.6 * sin((q.x - q.y) * 0.8 + t * 2.3);
                n += 0.35 * sin(length(q) * 2.2 - t * 3.0);
                float hot = saturate(0.5 + 0.3 * n);
                col = lerp(col * 0.55, col * 1.35 + float3(0.25, 0.18, 0.05), hot);
                a = 0.38 + 0.3 * hot + rim * 0.5;
                col *= 1.0 + rim * 0.5;
            }
            col = lerp(col, float3(1.0, 1.0, 1.0), saturate(flash * 0.35));
            a = saturate(a) * opacity * inside * _Color.a;
            return float4(col, a);
        }

        // ───────────── 投影通道（DecalProjector 画的单位立方体） ─────────────

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
            float2 uv = ds.xz + 0.5;
            float2 q = (uv - 0.5) * _Extent.xy - _Extent.zw;
            float px = max(fwidth(q.x), fwidth(q.y));
            // 由深度导数重建的表面法线：竖直面（墙、角色侧面）不画
            float3 nrm = cross(ddy(positionWS), ddx(positionWS));
            float facing = abs(nrm.y) * rsqrt(max(dot(nrm, nrm), 1e-12));

            clip(0.5 - max(abs(ds.x), max(abs(ds.y), abs(ds.z))));

            float4 c = ShadeTelegraph(q, px);
            c.a *= smoothstep(0.25, 0.5, facing) * (1.0 - smoothstep(0.38, 0.5, abs(ds.y)));
            return c;
        }
        ENDHLSL

        // URP DecalRendererFeature（Screen Space 技术）在不透明物体之后画这个通道
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

        // 兜底：渲染器没有贴花特性时，Telegraph 把同一份材质挂在平放的 Quad 上（uv 即形状坐标），透明队列里画。
        // 用贴花投影时 Telegraph 会按材质关掉这个通道（否则投影立方体会被前向通道当普通网格画出来）。
        Pass
        {
            Name "UniversalForwardOnly"
            Tags { "LightMode" = "UniversalForwardOnly" }
            Blend [_SrcBlend] [_DstBlend]
            Cull Off
            ZWrite Off
            ZTest LEqual
            Offset -2, -2

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
                float2 q = (i.uv - 0.5) * _Extent.xy - _Extent.zw;
                float px = max(fwidth(q.x), fwidth(q.y));
                return ShadeTelegraph(q, px);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
