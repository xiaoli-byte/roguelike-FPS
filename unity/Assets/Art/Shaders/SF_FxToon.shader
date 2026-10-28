// 卡通序列帧粒子（特效打磨 B 路：爆炸火团 / 烟柱 / 冲击环 / 爆闪星 / 火舌）。贴图 T_Fx_Blast（scripts/unity/fx_blast_atlas.py 生成）的四个通道是数据：
//   R = 形状场，G = 热度，B = 受光，A = 覆盖（兜底用）。
// 消散方式不是「透明度慢慢变淡」，而是按粒子年龄把形状阈值往上抬（_Erode），团块从边缘被一圈一圈硬边「啃掉」——卡通爆炸的干脆收尾，不留灰雾糊屏。
// 顶点流（FxSetup 的 FlipbookStreams）：TEXCOORD0 = 本帧 uv.xy + 下一帧 uv.zw；TEXCOORD1 = x 帧混合、y 年龄比例（0..1）、z 稳定随机数；COLOR = 粒子色 × 透明度曲线。
// _Mode：
//   0 火：热度按年龄冷却（_Cool），分五段硬色阶：白热 → 黄 → 主色 → 深色（主色²）→ 烟；受光两段（亮面 / 暗面），团块边缘一圈深色描边；发光部分 HDR（Bloom 吃得到）
//   1 烟：不发光的实心团块，粒子色是烟的底色，亮面 ×1.12、暗面 ×0.7 且偏冷，边缘一圈同色更深的描边（烟色按章节，见 FxTone）
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
                // 阈值不能低于 0.02：形状场在格子外是 0，阈值一旦 ≤ 0 整张面片都会显出来（方块）
                float thr = max(0.02, lerp(_Erode.x, _Erode.y, pow(age, max(0.05, _Erode.z))) + (rnd - 0.5) * 0.05);
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
                    // 暗面往下降一档色阶（卡通火的明暗：亮面黄、暗面橙），边缘一圈再降一档
                    half heat = saturate(t.g * _Cool.y * (1.0 - _Cool.x * age) - rim * 0.06 - (1.0 - lit) * 0.16);
                    half hw = max(fwidth(heat), 1e-3) * 1.2;
                    half b1 = Band(heat, 0.12, hw), b2 = Band(heat, 0.34, hw), b3 = Band(heat, 0.6, hw), b4 = Band(heat, 0.84, hw);
                    half3 hot = lerp(tint, half3(1.0, 0.97, 0.86), 0.85);
                    half3 yel = lerp(tint, half3(1.0, 0.88, 0.36), 0.5);
                    // 深色一档往赭红偏（黄火团的暗部是赭、橙火团的暗部是赭红，不发橄榄绿）
                    half3 deep = tint * tint * half3(0.78, 0.6, 0.48);
                    // 冷下来的那一段是暖褐烟（风格审查：火的暗边 / 烟是赭红、暖褐，不用灰黑），描边是赭红的深色（不是灰线）
                    half3 smk = lerp(half3(0.3, 0.19, 0.13), tint * 0.36, 0.25);
                    col = lerp(smk, deep, b1);
                    col = lerp(col, tint, b2);
                    col = lerp(col, yel, b3);
                    col = lerp(col, hot, b4);
                    // 受光两段（火的明暗已经在色阶里，这里只轻轻压一点）+ 描边
                    col *= lerp(0.9, 1.0, lit);
                    // 描边：火团还热的时候是赭红的深色，整团冷成烟以后才是暖褐（按年龄，不按这一点的热度：否则边缘总是落到最冷的那档，读成一圈灰线）
                    half3 rimCol = lerp(deep * 0.75 + half3(0.06, 0.015, 0.0), smk * 0.85, saturate(age * 1.8 - 0.7));
                    col = lerp(col, rimCol, rim * 0.6);
                    // 发光部分 HDR：主色以上提亮
                    col *= lerp(1.0, _Bright, b2 * (0.6 + 0.4 * b4));
                    opacity = lerp(1.0, _Cool.z, b1);
                }
                else if (_Mode < 1.5)
                {
                    // 烟：粒子色是底色；暗面偏冷一点（StylizedLit 的冷暗部），描边是同色更深一档，不压成黑线
                    col = lerp(tint * half3(0.68, 0.7, 0.8), tint * 1.12, lit);
                    // 描边淡一点：几团烟叠在一起时，里面那几圈描边不该读成一道道裂缝（鹅卵石）
                    col = lerp(col, tint * half3(0.6, 0.6, 0.72), rim * 0.35);
                    opacity = 1.0;
                }
                else
                {
                    // 光：平涂
                    half heat = saturate(t.g * _Cool.y * (1.0 - _Cool.x * age));
                    half hw = max(fwidth(heat), 1e-3) * 1.2;
                    half3 hot = lerp(tint, half3(1.0, 0.98, 0.92), 0.7);
                    col = lerp(tint, hot, Band(heat, 0.9, hw)) * _Bright;
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
