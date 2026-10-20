// 灵火破晓 · 风格化水面 / 流沙（docs/unity-parity.md L8）。半透明、不写深度，全部按世界坐标 XZ 取样（白盒方块、方片、圆片都不用 UV）：
//   · 三层移动的值噪声叠成「水面高度」，有限差分出法线（只扰动朝上的面）；顶面顶点随两道正弦轻轻起伏（_WaveHeight，物理不跟着动，保持很小）；
//   · 流向 = _Flow（xy 方向、z 速度：河、瀑下）+ 全局 _WindDir（WeatherDirector 写：xy 风向、z 风力）× _Flow.w——起风时涟漪顺风跑；
//   · 颜色：浅水色 → 深水色按菲涅尔与高度混合；波峰起白沫（_FoamAmount）；主光半兰伯特 + 球谐，尖锐太阳高光与天空反射按 _Gloss（流沙几乎为 0）；
//   · 旋涡模式（_Swirl = 1，流沙）：采样坐标绕 _SwirlCenter.xy 旋转，越靠圆心转得越快、颜色越深，白沫成了螺旋沙纹；
//     _SwirlCenter = (圆心 x, 圆心 z, 芯半径, 半径)，每块流沙用 MaterialPropertyBlock 写；
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
                half _Swirl;
                float _SwirlSpeed;
                float4 _SwirlCenter;
                half _Fade;
                half _EdgeSoft;
            CBUFFER_END

            // WeatherDirector 写的全局风：xy = 风向（XZ），z = 风力 0..1
            float4 _WindDir;

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
                float3 V = GetWorldSpaceNormalizeViewDir(i.positionWS);
                float2 xz = i.positionWS.xz;

                // 旋涡（流沙）：绕圆心转，越近越快
                half swirlMask = 0;
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
                float3 bumped = normalize(float3((h - hx) / e * 0.12, 1.0, (h - hz) / e * 0.12));
                float3 N = baseN.y > 0.5 ? bumped : baseN;

                // 颜色
                half fres = pow(1.0 - saturate(dot(N, V)), 4.0);
                half3 col = lerp(_ShallowColor.rgb, _DeepColor.rgb, saturate(0.3 + fres * 0.6 + (h - 0.5) * 0.5));
                col = lerp(col, _DeepColor.rgb, swirlMask * 0.55);
                half foam = smoothstep(0.66, 0.8, h) * _FoamAmount;
                col = lerp(col, _FoamColor.rgb, foam);

                // 光照
                Light light = GetMainLight();
                half ndl = saturate(dot(N, light.direction)) * 0.5 + 0.5;
                half3 lit = col * (light.color * ndl * 0.8 + SampleSH(N) * 0.5);
                float3 H = normalize(light.direction + V);
                half spec = pow(saturate(dot(N, H)), 220.0) * 2.0 * _Gloss;
                lit += light.color * spec;
                half3 sky = SampleSH(reflect(-V, N)) * 1.1;
                lit = lerp(lit, sky, fres * 0.45 * _Gloss);

                half alpha = saturate(lerp(_Alpha, max(_Alpha, _DeepColor.a), fres) + foam * 0.5);
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
