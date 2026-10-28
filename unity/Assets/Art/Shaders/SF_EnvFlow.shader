// 灵火破晓 · 流动水膜（特效打磨 D 路，EnvIcefall）：贴着冰瀑冰面往下淌的融水 / 水膜——一条按冰面射线贴出来的竖直窄带网格，
// uv.x = 带内横向 0..1，uv.y = 从顶往下的累计距离（米），uv2 = (种子, 段内距离, 段长)：冰挂一层层凸出来，一条带会断成几段，每段头尾各自淡出。两层沿 uv.y 往下滚的拉长噪声叠成一道道水痕，亮的地方是反光的水线；
// 左右两边、顶上起头、底下落进雾里都淡掉。半加法（颜色加上去，按 _Alpha 压一点身后），卡通硬边：水痕按阈值分出亮 / 淡两档。
// 每条带的相位走 uv2.x（种子），速度 _Speed 米 / 秒。接收场景雾。
Shader "Spiritfire/EnvFlow"
{
    Properties
    {
        [HDR] _Color("Streak Color", Color) = (1.1, 1.3, 1.5, 1)
        _Tint("Film Tint", Color) = (0.55, 0.8, 1, 0.25)
        _Speed("Flow Speed (m/s)", Float) = 2.6
        _Streaks("Streaks Across", Float) = 7
        _Length("Streak Length (m)", Float) = 2.4
        _Alpha("Opacity", Range(0, 1)) = 0.6
        _Fade("Fade", Range(0, 1)) = 1
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent-20" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }

        Pass
        {
            Name "EnvFlow"
            Tags { "LightMode"="UniversalForward" }
            Blend One OneMinusSrcAlpha
            ZWrite Off
            Cull Off

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _Color;
                half4 _Tint;
                float _Speed;
                float _Streaks;
                float _Length;
                half _Alpha;
                half _Fade;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                float4 uv2 : TEXCOORD1;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float4 info : TEXCOORD1; // x 种子, y 段内长度, z 段长（米）, w 雾
            };

            float H21(float2 p) { return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }

            float VNoise(float2 p)
            {
                float2 i = floor(p), f = frac(p), u = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(H21(i), H21(i + float2(1, 0)), u.x), lerp(H21(i + float2(0, 1)), H21(i + float2(1, 1)), u.x), u.y);
            }

            Varyings Vert(Attributes v)
            {
                Varyings o;
                float3 ws = TransformObjectToWorld(v.positionOS.xyz);
                o.positionCS = TransformWorldToHClip(ws);
                o.uv = v.uv;
                o.info = float4(v.uv2.x, v.uv2.y, v.uv2.z, ComputeFogFactor(o.positionCS.z));
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                float t = _Time.y * _Speed;
                float seed = i.info.x;
                float seg = i.info.y, len = max(1.0, i.info.z);
                float2 p = float2(i.uv.x * _Streaks + seed * 13.0, (i.uv.y - t) / max(0.2, _Length));
                float a = VNoise(p);
                float b = VNoise(p * float2(1.9, 2.3) + float2(7.1, -t * 0.35));
                float s = a * 0.65 + b * 0.35;
                // 卡通两档：亮水线 + 淡水膜
                half line_ = smoothstep(0.62, 0.68, s);
                half film = 0.35 + 0.65 * smoothstep(0.35, 0.55, s);
                // 两边、头、尾淡掉
                half edge = smoothstep(0.0, 0.22, i.uv.x) * (1.0 - smoothstep(0.78, 1.0, i.uv.x));
                half head = smoothstep(0.0, 1.2, seg) * (1.0 - smoothstep(len - 2.0, len, seg));
                half k = edge * head * _Fade;
                half3 col = _Tint.rgb * film * _Tint.a + _Color.rgb * line_;
                half alpha = saturate((_Tint.a * film + line_ * 0.5) * _Alpha) * k;
                col *= k;
                col = MixFogColor(col, half3(0, 0, 0), i.info.w);
                return half4(col, alpha);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
