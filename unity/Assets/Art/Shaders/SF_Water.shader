// 灵火破晓 · 风格化水面 / 流沙（docs/unity-parity.md L8；特效打磨 D 路重做）。半透明、不写深度，全部按世界坐标 XZ 取样（白盒方块、方片、圆片都不用 UV）：
//   · 三层移动的值噪声叠成「水面高度」，有限差分出法线（只扰动朝上的面）；顶面顶点随两道正弦轻轻起伏（_WaveHeight，物理不跟着动，保持很小）；
//   · 流向 = _Flow（xy 方向、z 速度：河、瀑下）+ 全局 _WindDir（WeatherDirector 写：xy 风向、z 风力）× _Flow.w——起风时涟漪顺风跑；
//   · 颜色（卡通分层）：浅水色 → 深水色按水深（读相机深度图：水面到水底的视线厚度）、菲涅尔、波高分三档；波峰起白沫（_FoamAmount）；
//   · 岸边白沫（_ShoreFoam）：水薄的地方一圈碎白沫，外加一道道往岸上推的沫线——岸线随水位自动移动（1-4 月牙泉被抽干时白沫跟着水退）；
//   · 涟漪：全局 _SFRipple[8]（EnvWater 每帧写：x, z, 当前半径, 振幅）——每道一圈波峰 + 波谷，波峰上起白沫（水面扰动、鲲破水、涉水）；
//   · 光照：主光半兰伯特 + 球谐；太阳反射区里一闪一闪的星点高光（_Sparkle），一道硬边的卡通高光，天空反射按 _Gloss（流沙几乎为 0）；
//   · 旋涡模式（_Swirl = 1，流沙）：采样坐标绕 _SwirlCenter.xy 旋转，越靠圆心转得越快、颜色越深；
//     再叠几条往里卷的螺旋沙纹和外圈一道道往里收的沙浪，读成「沙在往中心流」。_SwirlCenter = (圆心 x, 圆心 z, 芯半径, 半径)，每块流沙用 MaterialPropertyBlock 写；
//   · _Fade 淡出、_EdgeSoft 按 uv 圆心距做软边（圆片流沙与地面融在一起）。
// 接收场景雾。不投影、不收影。
Shader "Spiritfire/Water"
{
    Properties
    {
        _ShallowColor("Shallow Color", Color) = (0.24, 0.62, 0.72, 0.5)
        _DeepColor("Deep Color", Color) = (0.05, 0.22, 0.4, 0.88)
        _FoamColor("Foam Color", Color) = (0.9, 0.97, 1, 1)
        _Alpha("Base Opacity", Range(0, 1)) = 0.72
        _WaveScale("Wave Scale (m)", Float) = 3
        _WaveSpeed("Wave Speed", Float) = 0.6
        _WaveHeight("Wave Height (m)", Float) = 0.035
        _FoamAmount("Foam", Range(0, 1)) = 0.35
        _Gloss("Gloss", Range(0, 1)) = 1
        _Flow("Flow (xy dir, z speed, w wind response)", Vector) = (0, 0, 0, 1)
        _ShoreFoam("Shore Foam", Range(0, 1)) = 0.85
        _ShoreDepth("Shore Foam Depth (m)", Float) = 0.35
        _DeepDepth("Depth Where Water Reads Deep (m)", Float) = 2.5
        _Sparkle("Sun Sparkles", Range(0, 2)) = 1
        _RippleStrength("Ripple Strength", Range(0, 2)) = 1
        _Swirl("Swirl (quicksand)", Range(0, 1)) = 0
        _SwirlSpeed("Swirl Speed", Float) = 0.5
        _SwirlCenter("Swirl Center (x, z, core, radius)", Vector) = (0, 0, 2, 6)
        _Fade("Fade", Range(0, 1)) = 1
        _EdgeSoft("Edge Softness (disc uv)", Range(0, 1)) = 0
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent-40" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" "PreviewType"="Plane" }

        Pass
        {
            Name "Water"
            Tags { "LightMode"="UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Back

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _ShallowColor;
                half4 _DeepColor;
                half4 _FoamColor;
                half _Alpha;
                float _WaveScale;
                float _WaveSpeed;
                float _WaveHeight;
                half _FoamAmount;
                half _Gloss;
                float4 _Flow;
                half _ShoreFoam;
                float _ShoreDepth;
                float _DeepDepth;
                half _Sparkle;
                half _RippleStrength;
                half _Swirl;
                float _SwirlSpeed;
                float4 _SwirlCenter;
                half _Fade;
                half _EdgeSoft;
            CBUFFER_END

            // WeatherDirector 写的全局风：xy = 风向（XZ），z = 风力 0..1
            float4 _WindDir;
            // EnvWater 写的涟漪表：x, z, 当前半径（米）, 振幅（0 = 空）
            float4 _SFRipple[8];
            float _SFRippleCount;

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                float fogFactor : TEXCOORD3;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            float Hash21(float2 p)
            {
                return frac(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
            }

            float ValueNoise(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                float2 u = f * f * (3.0 - 2.0 * f);
                float a = Hash21(i), b = Hash21(i + float2(1, 0)), c = Hash21(i + float2(0, 1)), d = Hash21(i + float2(1, 1));
                return lerp(lerp(a, b, u.x), lerp(c, d, u.x), u.y);
            }

            // 水面高度 0..1：三层值噪声，按流向与时间平移（flow 已除以波长）
            float WaveHeight(float2 p, float t, float2 flow)
            {
                float s = _WaveSpeed;
                float a = ValueNoise(p + flow * t + float2(0.0, t * s * 0.3));
                float b = ValueNoise(p * 2.1 - flow * t * 0.6 + float2(t * s * 0.45, 7.3));
                float c = ValueNoise(p * 4.3 + flow * t * 1.4 + float2(-t * s * 0.7, t * s * 0.5) + 19.1);
                return a * 0.55 + b * 0.3 + c * 0.15;
            }

            // 涟漪：返回 (高度, 沿 x 的斜率, 沿 z 的斜率, 波峰白沫)
            float4 Ripples(float2 xz)
            {
                float4 acc = 0;
                int n = (int)min(8.0, _SFRippleCount);
                [loop] for (int k = 0; k < n; k++)
                {
                    float4 r = _SFRipple[k];
                    if (r.w <= 0.001) continue;
                    float2 d = xz - r.xy;
                    float dist = max(1e-3, length(d));
                    float w = 0.3 + r.z * 0.06;
                    float x = dist - r.z;
                    float crest = exp(-(x * x) / (w * w));
                    float x2 = x + w * 1.4;
                    float trough = exp(-(x2 * x2) / (w * w));
                    float h = r.w * (crest - 0.6 * trough);
                    // d h / d dist
                    float dh = r.w * (-2.0 * x / (w * w) * crest + 0.6 * 2.0 * x2 / (w * w) * trough);
                    acc.x += h;
                    acc.yz += dh * d / dist;
                    acc.w += r.w * crest;
                }
                return acc;
            }

            Varyings Vert(Attributes v)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                float3 ws = TransformObjectToWorld(v.positionOS.xyz);
                float3 nws = TransformObjectToWorldNormal(v.normalOS);
                if (nws.y > 0.5)
                {
                    float t = _Time.y;
                    ws.y += _WaveHeight * 0.5 * (sin(ws.x * 0.9 + t * 1.3) + sin(ws.z * 1.1 - t * 1.1));
                }
                o.positionWS = ws;
                o.positionCS = TransformWorldToHClip(ws);
                o.normalWS = nws;
                o.uv = v.uv;
                o.fogFactor = ComputeFogFactor(o.positionCS.z);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float t = _Time.y;
                float3 baseN = normalize(i.normalWS);
                bool top = baseN.y > 0.5;
                float3 V = GetWorldSpaceNormalizeViewDir(i.positionWS);
                float2 xz = i.positionWS.xz;
                float2 xz0 = xz;

                // 旋涡（流沙）：绕圆心转，越近越快
                half swirlMask = 0;
                half sandBands = 0;
                if (_Swirl > 0.001)
                {
                    float2 c = _SwirlCenter.xy;
                    float2 d = xz - c;
                    float r = length(d);
                    float R = max(_SwirlCenter.w, 0.5);
                    float ang = t * _SwirlSpeed * (1.5 / (0.3 + r / R));
                    float sn = sin(ang), cs = cos(ang);
                    float2 rd = float2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
                    xz = lerp(xz, c + rd, _Swirl);
                    swirlMask = saturate(1.0 - r / R) * _Swirl;
                    // 螺旋沙纹：四条往里卷的臂（对数螺线），随时间往里收；外圈一道道往里收的沙浪
                    float th = atan2(d.y, d.x);
                    float arms = frac(th / 6.2831 * 4.0 + log(max(r, 0.05)) * 1.6 + t * _SwirlSpeed * 0.6);
                    float spiral = smoothstep(0.0, 0.18, arms) * (1.0 - smoothstep(0.35, 0.6, arms));
                    float rings = 1.0 - smoothstep(0.0, 0.22, abs(frac(r * 0.9 + t * _SwirlSpeed * 0.7) - 0.5));
                    float body = saturate(r / R);
                    sandBands = _Swirl * (spiral * (1.0 - body) * 0.9 + rings * smoothstep(0.35, 0.9, body) * (1.0 - smoothstep(0.92, 1.0, body)) * 0.5);
                }

                // 高度与法线
                float scale = max(_WaveScale, 0.05);
                float2 flowWS = _Flow.xy * _Flow.z + _WindDir.xy * _WindDir.z * _Flow.w * 0.6;
                float2 flow = flowWS / scale;
                float2 p = xz / scale;
                const float e = 0.08;
                float h = WaveHeight(p, t, flow);
                float hx = WaveHeight(p + float2(e, 0), t, flow);
                float hz = WaveHeight(p + float2(0, e), t, flow);
                float3 bumped = float3((h - hx) / e * 0.12, 1.0, (h - hz) / e * 0.12);
                float4 rip = top && _Swirl < 0.5 ? Ripples(xz0) * _RippleStrength : 0;
                bumped.xz -= rip.yz * 0.55;
                float3 N = top ? normalize(bumped) : baseN;

                // 水深：水面到水底（相机深度图里的不透明物）沿视线的厚度
                float2 suv = GetNormalizedScreenSpaceUV(i.positionCS);
                float sceneEye = LinearEyeDepth(SampleSceneDepth(suv), _ZBufferParams);
                float thick = max(0.0, sceneEye - i.positionCS.w);
                // 深度图无效（远平面 / 没开）时当成很深
                thick = sceneEye > 0.0 ? thick : 100.0;
                float vertical = thick * saturate(abs(V.y) + 0.15);
                float deep01 = saturate(vertical / max(0.1, _DeepDepth));

                // 颜色：浅 → 深三档（卡通分层），波高轻轻推一下
                half fres = pow(1.0 - saturate(dot(N, V)), 4.0);
                float tone = saturate(deep01 * 0.75 + fres * 0.45 + (h - 0.5) * 0.35 + rip.x * 0.4);
                // 卡通三档（docs/art/fx-style.md：风格化，不做写实流体）
                if (_Swirl < 0.5) tone = floor(tone * 3.0 + 0.5) / 3.0 * 0.85 + tone * 0.15;
                else tone = saturate(0.3 + fres * 0.6 + (h - 0.5) * 0.5);
                half3 col = lerp(_ShallowColor.rgb, _DeepColor.rgb, tone);
                col = lerp(col, _DeepColor.rgb, swirlMask * 0.55);
                col = lerp(col, _FoamColor.rgb, sandBands * 0.55);
                col = lerp(col, _DeepColor.rgb * 0.82, sandBands * swirlMask * 0.35);

                // 白沫：波峰 + 涟漪的波峰 + 岸边（水薄处一圈碎沫 + 一道道往岸上推的沫线）
                half foam = smoothstep(0.66, 0.8, h) * _FoamAmount;
                foam = max(foam, smoothstep(0.25, 0.6, rip.w));
                half shore = 0;
                if (top && _Swirl < 0.5 && _ShoreFoam > 0.001)
                {
                    float sd = max(0.05, _ShoreDepth);
                    float s01 = saturate(vertical / sd);
                    float n1 = ValueNoise(xz0 * 2.3 + float2(t * 0.25, -t * 0.2));
                    float edgeFoam = step(s01, 0.22 + 0.3 * n1);
                    float lines = step(0.74, frac(s01 * 2.2 - t * 0.35 + n1 * 0.4)) * step(s01, 0.8) * step(0.35, n1);
                    shore = saturate(edgeFoam + lines * 0.8) * _ShoreFoam;
                    foam = max(foam, shore);
                }
                col = lerp(col, _FoamColor.rgb, foam);

                // 光照
                Light light = GetMainLight();
                half ndl = saturate(dot(N, light.direction)) * 0.5 + 0.5;
                half3 lit = col * (light.color * ndl * 0.8 + SampleSH(N) * 0.5);
                float3 H = normalize(light.direction + V);
                half ndh = saturate(dot(N, H));
                // 卡通高光：一块硬边的太阳倒影 + 外圈一闪一闪的星点
                half spec = smoothstep(0.992, 0.996, ndh) * 1.6 * _Gloss;
                half glint = 0;
                if (top && _Sparkle > 0.001 && _Swirl < 0.5)
                {
                    float2 gc = floor(xz0 * 1.7);
                    float2 gf = frac(xz0 * 1.7);
                    float gh = Hash21(gc + 3.7);
                    float2 gp = 0.2 + 0.6 * float2(Hash21(gc + 11.1), gh);
                    float tw = saturate(sin(t * (2.0 + gh * 3.0) + gh * 40.0) * 3.0 - 2.0);
                    float dot_ = 1.0 - smoothstep(0.0, 0.045, length(gf - gp));
                    float lobe = smoothstep(0.86, 0.985, ndh);
                    glint = dot_ * tw * lobe * step(0.72, gh) * _Sparkle * (1.0 - foam);
                }
                lit += light.color * (spec + glint * 2.2) * (1.0 - _Swirl * 0.8);
                half3 sky = SampleSH(reflect(-V, N)) * 1.1;
                lit = lerp(lit, sky, fres * lerp(0.25, 0.45, deep01) * _Gloss);

                // 透明度：浅水清、深水实，白沫不透
                half alpha = lerp(_Alpha * lerp(0.8, 1.05, saturate(deep01 * 2.0)), max(_Alpha, _DeepColor.a), saturate(fres + deep01 * 0.6));
                if (_Swirl > 0.5) alpha = saturate(lerp(_Alpha, max(_Alpha, _DeepColor.a), fres));
                alpha = saturate(alpha + foam * 0.5);
                half edge = 1.0;
                if (_EdgeSoft > 0.001)
                {
                    float r01 = length(i.uv - 0.5) * 2.0;
                    edge = 1.0 - smoothstep(1.0 - _EdgeSoft, 1.0, r01);
                }
                alpha *= edge * _Fade;

                lit = MixFog(lit, i.fogFactor);
                return half4(lit, saturate(alpha));
            }
            ENDHLSL
        }
    }

    Fallback Off
}
