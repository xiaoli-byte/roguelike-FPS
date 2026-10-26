// 火舌（docs/unity-parity.md FX4；Three.js src/enemies/fx/FlameFx.ts 的 createFlameTongue；特效打磨 B 路改成卡通翻卷火）：一片朝镜头的面片——
// 水滴形主体按一道往上走的 S 形摆动 + 噪声翻卷，顶上分成两三条左右换位的火舌，上半段不时断开一团小火往上飘、越飘越小；
// 颜色是硬边色阶（外缘暗红描边 → 尖端色 → 中间色 → 底部白热芯），不再是柔和渐变。半加法混合（见下）、HDR。
// 网格：宽 0.6、高 1 的四边形，底边中点在原点（FlameTongues 生成），大小 = 物体缩放（跟着骨骼与整体缩放走）。
// 朝向：面片竖直方向 = 世界「上」投影到屏幕上的方向（火苗永远往上窜；镜头翻滚 / 震屏时不会跟着歪），宽度方向与它垂直；
// 镜头几乎正对着往下看时退回屏幕的「上」。
// 混合：预乘「半加法」——颜色照加法叠上去，同时按 0.7 × 不透明度压暗身后（纯加法在亮沙地 / 天空前会被洗成一片淡黄白，看不出橙红）。
// 每片的参数走 MaterialPropertyBlock：_Params x = 种子（错开相位），y = 不透明度；_Hot / _Mid / _Tip 三段颜色。时间用 _Time.y（全场共用）。
Shader "Spiritfire/FxFlame"
{
    Properties
    {
        [HDR] _Hot("Hot (core)", Color) = (1, 0.945, 0.753, 1)
        [HDR] _Mid("Mid", Color) = (1, 0.627, 0.188, 1)
        [HDR] _Tip("Tip", Color) = (0.847, 0.251, 0.102, 1)
        _Params("Params (x Seed, y Alpha)", Vector) = (0, 1, 0, 0)
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+5" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }

        Pass
        {
            Name "ForwardFlame"
            Tags { "LightMode"="UniversalForward" }
            Blend One OneMinusSrcAlpha
            ZWrite Off
            Cull Off

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _Hot;
                half4 _Mid;
                half4 _Tip;
                float4 _Params;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                half fog : TEXCOORD1;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            float SFFlameHash(float3 p) { return frac(sin(dot(p, float3(17.1, 113.7, 51.3))) * 43758.5453); }

            float SFFlameNoise(float3 p)
            {
                float3 i = floor(p);
                float3 f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(lerp(SFFlameHash(i), SFFlameHash(i + float3(1, 0, 0)), f.x), lerp(SFFlameHash(i + float3(0, 1, 0)), SFFlameHash(i + float3(1, 1, 0)), f.x), f.y),
                            lerp(lerp(SFFlameHash(i + float3(0, 0, 1)), SFFlameHash(i + float3(1, 0, 1)), f.x), lerp(SFFlameHash(i + float3(0, 1, 1)), SFFlameHash(i + float3(1, 1, 1)), f.x), f.y), f.z);
            }

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                float3 originWS = TransformObjectToWorld(float3(0, 0, 0));
                float3 originVS = TransformWorldToView(originWS);
                float sx = length(UNITY_MATRIX_M._m00_m10_m20);
                float sy = length(UNITY_MATRIX_M._m01_m11_m21);
                // 世界「上」投影到屏幕（观察空间 xy）：火苗往上窜；正对着往下看时投影退化，退回屏幕的上
                float3 upVS = TransformWorldToViewDir(float3(0, 1, 0), false);
                float2 up2 = upVS.xy;
                float len = length(up2);
                up2 = len > 0.25 ? up2 / len : normalize(lerp(float2(0, 1), up2 / max(len, 1e-4), len / 0.25));
                float2 right2 = float2(up2.y, -up2.x);
                float3 vs = originVS;
                vs.xy += right2 * (v.positionOS.x * sx) + up2 * (v.positionOS.y * sy);
                o.positionCS = TransformWViewToHClip(vs);
                o.uv = v.uv;
                o.fog = ComputeFogFactor(o.positionCS.z);
                return o;
            }

            float2 SFFlameHash2(float2 p)
            {
                return frac(sin(float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3)))) * 43758.5453);
            }

            // 带抗锯齿的硬台阶
            half SFBand(half v, half edge, half w)
            {
                return saturate((v - edge) / w + 0.5);
            }

            half4 Frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                float seed = _Params.x;
                float h = i.uv.y;
                float t = _Time.y * 2.2 + seed * 13.0;
                float x = (i.uv.x - 0.5) * 2.0;
                float n1 = SFFlameNoise(float3(i.uv.x * 2.5 + seed * 7.0, h * 2.2 - t, seed));
                float n2 = SFFlameNoise(float3(i.uv.x * 5.5, h * 4.5 - t * 1.6, seed + 3.0));
                // 翻卷：一道往上走的 S 形摆动 + 噪声扭动，越往上越厉害（火苗一卷一卷地往上翻）
                float sway = (sin(h * 5.2 - t * 2.3 + seed * 6.28) * 0.2 + (n1 - 0.5) * 0.6) * h;
                float xs = x + sway;
                // 水滴形主体
                float width = sqrt(max(h, 0.0)) * (1.0 - h * 0.78) + 0.05;
                float d = 1.0 - abs(xs) / width;
                // 顶上分成两三条火舌：顶边按 x 起伏，舌尖跟着时间左右换位
                float tongues = 0.5 + 0.5 * sin(xs * 7.0 + n2 * 3.0 + t * 0.7);
                float topCut = 0.6 + 0.32 * tongues * saturate(1.0 - abs(xs) * 0.8);
                d = min(d, (topCut - h) * 3.2);
                d += (n2 - 0.5) * 0.22;
                // 断开往上飘的小火团：上半段一格一格的圆团，越高越小
                float2 bp = float2(xs * 2.4 + seed * 3.1, h * 3.2 - t * 1.25);
                float2 cell = floor(bp);
                float2 rc = SFFlameHash2(cell + seed * 17.0);
                float2 f = frac(bp) - (0.3 + 0.4 * rc);
                float br = 0.3 * smoothstep(1.02, 0.5, h) * step(0.45, rc.x) * step(abs(x), 0.75) * step(0.45, h);
                float blob = br > 0.01 ? (1.0 - length(f) / br) * 0.6 : -1.0;
                d = max(d, blob);
                d *= smoothstep(0.0, 0.06, h);
                // 夹住再求导：格子之间的跳变不能把抗锯齿宽度撑大（否则整片面片变成半透明的方块）
                d = clamp(d, -0.5, 1.0);
                float aa = clamp(fwidth(d) * 1.2, 1e-3, 0.06);
                half body = SFBand(d, 0.0, aa);
                half a = (half)(body * saturate(_Params.y));
                clip(a - 0.01);
                // 卡通色阶：外缘一圈暗红描边 → 尖端色 → 中间色 → 底部白热芯
                half3 col = _Tip.rgb * 0.62;
                col = lerp(col, _Tip.rgb, SFBand(d, 0.07, aa));
                col = lerp(col, _Mid.rgb * 1.2, SFBand(d - h * 0.25, 0.2, aa));
                col = lerp(col, _Hot.rgb * 1.55, SFBand(d - h * 0.55, 0.3, aa));
                col = MixFogColor(col, half3(0, 0, 0), i.fog);
                // 半加法：叠色的同时压暗身后 70%（实心的卡通火苗，亮沙地前也看得出橙红）
                return half4(col * a, a * 0.7h);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
