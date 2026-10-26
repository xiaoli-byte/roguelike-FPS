// 卡通序列帧粒子（特效打磨 B 路：爆炸火团 / 烟柱 / 冲击环 / 爆闪星 / 火舌）。贴图 T_Fx_Blast（scripts/unity/fx_blast_atlas.py 生成）的四个通道是数据：
//   R = 形状场，G = 热度，B = 受光，A = 覆盖（兜底用）。
// 消散方式不是「透明度慢慢变淡」，而是按粒子年龄把形状阈值往上抬（_Erode），团块从边缘被一圈一圈硬边「啃掉」——卡通爆炸的干脆收尾，不留灰雾糊屏。
// 顶点流（FxSetup 的 FlipbookStreams）：TEXCOORD0 = 本帧 uv.xy + 下一帧 uv.zw；TEXCOORD1 = x 帧混合、y 年龄比例（0..1）、z 稳定随机数；COLOR = 粒子色 × 透明度曲线。
// _Mode：
//   0 火：热度按年龄冷却（_Cool），分五段硬色阶：白热 → 黄 → 主色 → 深色（主色²）→ 烟；受光两段（亮面 / 暗面），团块边缘一圈深色描边；发光部分 HDR（Bloom 吃得到）
//   1 烟：不发光的实心团块，粒子色是烟的底色，亮面 ×1.3、暗面 ×0.68，边缘一圈更深的描边
//   2 光：平涂发光（冲击环、爆闪星、刻符）：热度高的部分白热、其余主色，几乎纯加法（只压暗身后 25%）
// 混合：预乘 alpha（Blend One OneMinusSrcAlpha），同一个材质里既能画实心烟、也能画发光火；贴脸 0.25–1 m 淡出。
Shader "Spiritfire/FxToon"
{
    Properties
    {
        _BaseMap("Atlas (R shape, G heat, B light)", 2D) = "white" {}
        _Mode("Mode (0 Fire, 1 Smoke, 2 Glow)", Float) = 0
        _Erode("Erode (x start, y end, z power, w soft)", Vector) = (0.04, 1, 1.3, 0.02)
        _Cool("Cool (x by age, y heat gain, z opacity)", Vector) = (0.85, 1, 0.92, 0)
        _Bright("HDR Brightness", Float) = 1.7
        _QueueOffset("Queue Offset", Float) = 0
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" "PreviewType"="Plane" }

        Pass
        {
            Name "ForwardToon"
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

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                float _Mode;
                float4 _Erode;
                float4 _Cool;
                float _Bright;
                float _QueueOffset;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                half4 color : COLOR;
                float4 uv : TEXCOORD0;
                float3 custom : TEXCOORD1;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                half4 color : COLOR;
                float4 uv : TEXCOORD0;
                float3 custom : TEXCOORD1;
                float2 fogDepth : TEXCOORD2;
            };

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                VertexPositionInputs p = GetVertexPositionInputs(v.positionOS.xyz);
                o.positionCS = p.positionCS;
                o.color = v.color;
                o.uv = v.uv;
                o.custom = v.custom;
                o.fogDepth = float2(ComputeFogFactor(p.positionCS.z), -p.positionVS.z);
                return o;
            }

            // 带抗锯齿的硬台阶：edge 附近 1–2 像素过渡
            half Band(half v, half edge, half w)
            {
                return saturate((v - edge) / w + 0.5);
            }

            half4 Frag(Varyings i) : SV_Target
            {
                half4 ta = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv.xy);
                half4 tb = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv.zw);
                half4 t = lerp(ta, tb, saturate(i.custom.x));
                float age = saturate(i.custom.y);
                float rnd = i.custom.z;

                // 硬边消散：阈值随年龄抬高（每颗粒子错开一点）
                float thr = lerp(_Erode.x, _Erode.y, pow(age, max(0.05, _Erode.z))) + (rnd - 0.5) * 0.05;
                float d = t.r;
                float w = max(fwidth(d), 1e-3) * 1.2 + _Erode.w;
                half mask = saturate((d - thr) / w + 0.5);
                // 贴脸淡出（0.25–1 m），粒子色的透明度曲线照乘
                half nearFade = saturate((i.fogDepth.y - 0.25) / 0.75);
                mask *= i.color.a * nearFade;
                clip(mask - 0.004);

                half3 tint = i.color.rgb;
                // 边缘一圈（刚高过阈值的那一段）：卡通描边
                half rim = 1.0 - saturate((d - thr) / 0.07);
                half lw = max(fwidth(t.b), 1e-3) * 1.5;
                half lit = Band(t.b, 0.46, lw);
                half3 col;
                half opacity;

                [branch] if (_Mode < 0.5)
                {
                    // 火：冷却、五段色阶
                    half heat = saturate(t.g * _Cool.y * (1.0 - _Cool.x * age) - rim * 0.18);
                    half hw = max(fwidth(heat), 1e-3) * 1.2;
                    half b1 = Band(heat, 0.10, hw), b2 = Band(heat, 0.30, hw), b3 = Band(heat, 0.52, hw), b4 = Band(heat, 0.76, hw);
                    half3 hot = lerp(tint, half3(1.0, 0.97, 0.86), 0.85);
                    half3 yel = lerp(tint, half3(1.0, 0.88, 0.36), 0.5);
                    half3 deep = tint * tint * 0.78;
                    half3 smk = lerp(half3(0.17, 0.15, 0.14), tint * 0.3, 0.22);
                    col = lerp(smk, deep, b1);
                    col = lerp(col, tint, b2);
                    col = lerp(col, yel, b3);
                    col = lerp(col, hot, b4);
                    // 受光两段 + 描边
                    col *= lerp(0.74, 1.0, lit);
                    col = lerp(col, lerp(smk * 0.7, deep * 0.62, b1), rim * 0.75);
                    // 发光部分 HDR：主色以上提亮
                    col *= lerp(1.0, _Bright, b2 * (0.6 + 0.4 * b4));
                    opacity = lerp(1.0, _Cool.z, b1);
                }
                else if (_Mode < 1.5)
                {
                    // 烟：粒子色是底色
                    col = tint * lerp(0.68, 1.3, lit);
                    col = lerp(col, tint * 0.5, rim * 0.7);
                    opacity = 1.0;
                }
                else
                {
                    // 光：平涂
                    half heat = saturate(t.g * _Cool.y * (1.0 - _Cool.x * age));
                    half hw = max(fwidth(heat), 1e-3) * 1.2;
                    half3 hot = lerp(tint, half3(1.0, 0.98, 0.92), 0.8);
                    col = lerp(tint, hot, Band(heat, 0.7, hw)) * _Bright;
                    opacity = _Cool.z;
                }

                col = MixFog(col, i.fogDepth.x);
                return half4(col * mask, opacity * mask);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
