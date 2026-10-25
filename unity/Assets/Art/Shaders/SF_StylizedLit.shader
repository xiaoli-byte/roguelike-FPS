// 灵火破晓 · 风格化 Lit（URP 17）
// 手绘固有色为主，光照只负责体积：主光 N·L 经软阶梯（ramp）分成亮 / 暗两大块，暗部带冷色偏移而不是变黑；
// 环境光取球谐，ORM 的 AO 与 SSAO 取小；金属 / 低粗糙度区域加一圈阶梯高光与环境反射；
// 边缘光（菲涅尔）勾出剪影，受击闪白 / 词缀着色走 _FlashAmount / _Tint。
// _Tint.a = 输出 alpha（默认 1；不透明材质的混合是 One Zero，不受影响）：幻影类实例把材质切到 SrcAlpha 混合后靠它淡化 / 闪烁。
// 溶解（FX2）：_DissolveParams.x > 0 时按 UV 噪声 + 高度渐变裁掉像素、前沿发光（DeathDissolve 死亡化灰、SpawnMaterialize 出生显形），
// 阴影 / 深度 Pass 一起裁；默认 0 时和沙魇的变体段一样整段跳过。
// 发光遮罩（FX3）：_GlowMask（_E 贴图，R / G / B = 三层）× _GlowMaskColor0..2（GlowMask 每帧写「层色 × 强度」），按相对模型原点的位置叠一层流动的噪声闪烁；
// 三个颜色默认全黑时整段跳过、输出不变（同变体段 / 溶解段）。
// _FUR：带毛 / 羽的角色（sidecar 的 fur 配置）。画质「中」以上（全局 _SFFurDetail）加顺毛向的发丝明暗、各向异性光泽、
// 剪影绒边，明暗交界更软；画质「高」再由 FurShells 叠 Spiritfire/FurShell 壳层（见 SF_Fur.hlsl）。
Shader "Spiritfire/StylizedLit"
{
    Properties
    {
        [MainTexture] _BaseMap("Base Color (BC)", 2D) = "white" {}
        [MainColor] _BaseColor("Base Color", Color) = (1,1,1,1)
        _Tint("Instance Tint", Color) = (1,1,1,1)
        [Normal] _BumpMap("Normal (N)", 2D) = "bump" {}
        _BumpScale("Normal Scale", Float) = 1
        _ORMMap("ORM (R=AO G=Rough B=Metal)", 2D) = "white" {}
        _Metallic("Metallic", Range(0,1)) = 1
        _Roughness("Roughness", Range(0,1)) = 1
        _OcclusionStrength("AO Strength", Range(0,1)) = 1
        _EmissionMap("Emission (E)", 2D) = "white" {}
        [HDR] _EmissionColor("Emission", Color) = (0,0,0,1)

        [Header(Stylized Lighting)]
        _ShadowTint("Shadow Tint", Color) = (0.62, 0.66, 0.86, 1)
        _RampThreshold("Ramp Threshold", Range(-1,1)) = 0.05
        _RampSoftness("Ramp Softness", Range(0.001,1)) = 0.18
        _ShadowLift("Shadow Lift", Range(0,1)) = 0.32
        _AmbientStrength("Ambient Strength", Range(0,2)) = 1
        _SpecStrength("Spec Strength", Range(0,2)) = 0.5
        _SpecSize("Spec Size", Range(0,1)) = 0.12
        _RimColor("Rim Color", Color) = (1, 0.93, 0.8, 1)
        _RimPower("Rim Power", Range(0.5,8)) = 3.5
        _RimStrength("Rim Strength", Range(0,2)) = 0.35

        [Header(Fur)]
        [Toggle(_FUR)] _Fur("Fur Detail", Float) = 0
        _FurDensity("Strand Density (per m)", Float) = 200
        _FurDetailStrength("Strand Detail", Range(0,1)) = 0.6
        _FurSheen("Fur Sheen", Range(0,1)) = 0.25
        _FurFuzz("Fur Fuzz (silhouette)", Range(0,1)) = 0.5

        [Header(Runtime)]
        _FlashColor("Flash Color", Color) = (1,1,1,1)
        _FlashAmount("Flash Amount", Range(0,1)) = 0

        [Header(Variant)]
        _VariantParams("Variant (x Sand, y Crack, z Density, w Pulse)", Vector) = (0, 0, 14, 3)
        _VariantSandColor("Variant Sand Color", Color) = (0.85, 0.7, 0.48, 1)
        [HDR] _VariantCrackColor("Variant Crack Color", Color) = (0, 0, 0, 1)

        [Header(Dissolve)]
        _DissolveParams("Dissolve (x Amount, y Edge, z Density, w Height Weight)", Vector) = (0, 0.08, 9, 0)
        _DissolvePlane("Dissolve Plane (x Base Y, y Per Meter)", Vector) = (0, -0.5, 0, 0)
        [HDR] _DissolveEdgeColor("Dissolve Edge Color", Color) = (2.4, 1.1, 0.4, 1)

        [Header(Glow Mask)]
        _GlowMask("Glow Mask (E: R/G/B = layer 0/1/2)", 2D) = "black" {}
        [HDR] _GlowMaskColor0("Glow Layer 0", Color) = (0, 0, 0, 1)
        [HDR] _GlowMaskColor1("Glow Layer 1", Color) = (0, 0, 0, 1)
        [HDR] _GlowMaskColor2("Glow Layer 2", Color) = (0, 0, 0, 1)
        _GlowMaskShimmer("Glow Shimmer (xyz Amp, w Freq)", Vector) = (0.4, 0.4, 0.4, 9)

        [Header(Surface)]
        _Cutoff("Alpha Cutoff", Range(0,1)) = 0.5
        [Enum(UnityEngine.Rendering.CullMode)] _Cull("Cull", Float) = 2
        [Enum(UnityEngine.Rendering.BlendMode)] _SrcBlend("Src Blend", Float) = 1
        [Enum(UnityEngine.Rendering.BlendMode)] _DstBlend("Dst Blend", Float) = 0
        [ToggleUI] _ZWrite("ZWrite", Float) = 1
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" "UniversalMaterialType"="Lit" "Queue"="Geometry" }
        LOD 300

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode"="UniversalForward" }
            Blend [_SrcBlend] [_DstBlend]
            ZWrite [_ZWrite]
            Cull [_Cull]

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag

            #pragma shader_feature_local _NORMALMAP
            #pragma shader_feature_local_fragment _ORMMAP
            #pragma shader_feature_local_fragment _EMISSION
            #pragma shader_feature_local_fragment _ALPHATEST_ON
            #pragma shader_feature_local_fragment _ADDITIVE
            #pragma shader_feature_local _FUR

            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fragment _ _SCREEN_SPACE_OCCLUSION
            #pragma multi_compile_fragment _ _REFLECTION_PROBE_BLENDING
            #pragma multi_compile_fragment _ _REFLECTION_PROBE_BOX_PROJECTION
            #pragma multi_compile_fragment _ _LIGHT_COOKIES
            #pragma multi_compile _ _LIGHT_LAYERS
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/RenderingLayers.hlsl"
            #pragma multi_compile _ SHADOWS_SHADOWMASK
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"

            #include "SF_StylizedInput.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"
            #include "SF_StylizedShading.hlsl"
            #include "SF_Fur.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float4 tangentOS  : TANGENT;
                float2 uv         : TEXCOORD0;
                #if defined(_FUR)
                float4 furBind    : TEXCOORD2; // 绑定姿势位置（SF_Fur.hlsl）
                float4 furFlow    : TEXCOORD3; // 毛向 T / B 分量、遮罩
                float3 furFlowBind : TEXCOORD4; // 绑定空间毛向
                #endif
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv         : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                half3  normalWS   : TEXCOORD2;
                #if defined(_NORMALMAP) || defined(_FUR)
                half4  tangentWS  : TEXCOORD3;
                #endif
                half4  fogAndVertexLight : TEXCOORD4; // x = 雾，yzw = 顶点光
                #if defined(_FUR)
                float3 furBind    : TEXCOORD5;
                half3  furFlow    : TEXCOORD6;
                half3  furFlowBind : TEXCOORD7;
                #endif
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            // 材质变体（EnemyVariant）：沙化 = 去饱和后染成沙色 + 细颗粒；裂纹 = UV 空间的 Voronoi 裂缝（F2 − F1 小的地方），
            // 裂缝压暗反照率、透出 _VariantCrackColor 并按格子错开缓慢脉动。用 UV 而不是位置：蒙皮网格上裂纹跟着身体走，不会游动
            float2 SFVariantHash2(float2 p)
            {
                p = float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3)));
                return frac(sin(p) * 43758.5453);
            }

            half3 SFVariantSurface(half3 albedo, float2 uv, out half crack)
            {
                half sand = saturate(_VariantParams.x);
                half lum = dot(albedo, half3(0.3, 0.59, 0.11));
                half grain = (half)SFVariantHash2(floor(uv * 512.0)).x;
                half3 sandy = _VariantSandColor.rgb * (0.45 + 1.1 * lum) * (0.9 + 0.2 * grain);
                albedo = lerp(albedo, sandy, sand);
                float2 g = uv * max(1.0, (float)_VariantParams.z);
                float2 cell = floor(g);
                float2 f = frac(g);
                float d1 = 8.0;
                float d2 = 8.0;
                float2 n1 = cell;
                float2 n2 = cell;
                [unroll] for (int cy = -1; cy <= 1; cy++)
                {
                    [unroll] for (int cx = -1; cx <= 1; cx++)
                    {
                        float2 o = float2(cx, cy);
                        float2 r = o + SFVariantHash2(cell + o) - f;
                        float d = dot(r, r);
                        if (d < d1) { d2 = d1; n2 = n1; d1 = d; n1 = cell + o; }
                        else if (d < d2) { d2 = d; n2 = cell + o; }
                    }
                }
                float edge = sqrt(d2) - sqrt(d1);
                // 只有一部分格边是裂缝（按两侧格子的对称哈希挑），裂纹断断续续、不成整张网
                half open = step(0.42, SFVariantHash2(n1 + n2).y);
                half pulse = 0.7 + 0.3 * sin(_Time.y * _VariantParams.w + n1.x * 1.7 + n1.y * 2.3);
                crack = saturate(_VariantParams.y) * open * (half)(1.0 - smoothstep(0.012, 0.055, edge)) * pulse;
                // 裂缝两侧烧焦一圈（比裂缝宽一点的暗边）
                half char_ = saturate(_VariantParams.y) * open * (half)(1.0 - smoothstep(0.03, 0.12, edge));
                albedo *= 1.0 - 0.55 * char_;
                return albedo;
            }

            // 发光遮罩（FX3）：三层范围 × 层色，乘一层沿模型往上流的值噪声（同 Three.js applyFrostGlow 的 fgNoise(vFrostPos * 9 + 时间)）
            float SFGlowHash(float3 p)
            {
                p = frac(p * 0.3183099 + 0.1);
                p *= 17.0;
                return frac(p.x * p.y * p.z * (p.x + p.y + p.z));
            }

            float SFGlowNoise(float3 x)
            {
                float3 i = floor(x);
                float3 f = frac(x);
                f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(lerp(SFGlowHash(i), SFGlowHash(i + float3(1, 0, 0)), f.x), lerp(SFGlowHash(i + float3(0, 1, 0)), SFGlowHash(i + float3(1, 1, 0)), f.x), f.y),
                            lerp(lerp(SFGlowHash(i + float3(0, 0, 1)), SFGlowHash(i + float3(1, 0, 1)), f.x), lerp(SFGlowHash(i + float3(0, 1, 1)), SFGlowHash(i + float3(1, 1, 1)), f.x), f.y), f.z);
            }

            half3 SFGlowMask(float2 uv, float3 positionWS)
            {
                half3 m = SAMPLE_TEXTURE2D(_GlowMask, sampler_GlowMask, uv).rgb;
                float3 p = (positionWS - UNITY_MATRIX_M._m03_m13_m23) * max(1.0, (float)_GlowMaskShimmer.w);
                float t = _Time.y;
                half n = (half)SFGlowNoise(p + float3(0.0, t * 1.7, t * 0.6));
                half3 amp = saturate(_GlowMaskShimmer.xyz);
                half3 k = (1.0 - amp) + amp * 2.0 * n;
                return m.r * k.x * _GlowMaskColor0.rgb + m.g * k.y * _GlowMaskColor1.rgb + m.b * k.z * _GlowMaskColor2.rgb;
            }

            Varyings Vert(Attributes input)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

                VertexPositionInputs pos = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs nrm = GetVertexNormalInputs(input.normalOS, input.tangentOS);
                o.positionCS = pos.positionCS;
                o.positionWS = pos.positionWS;
                o.normalWS = nrm.normalWS;
                #if defined(_NORMALMAP) || defined(_FUR)
                o.tangentWS = half4(nrm.tangentWS, input.tangentOS.w * GetOddNegativeScale());
                #endif
                #if defined(_FUR)
                o.furBind = input.furBind.xyz;
                o.furFlow = input.furFlow.xyz;
                o.furFlowBind = input.furFlowBind;
                #endif
                o.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                half3 vertexLight = VertexLighting(pos.positionWS, nrm.normalWS);
                o.fogAndVertexLight = half4(ComputeFogFactor(pos.positionCS.z), vertexLight);
                return o;
            }

            half4 Frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);

                half4 base = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv) * _BaseColor;
                #if defined(_ALPHATEST_ON)
                clip(base.a - _Cutoff);
                #endif
                #if defined(LOD_FADE_CROSSFADE)
                LODFadeCrossFade(i.positionCS);
                #endif
                // 溶解（FX2）：默认 x = 0 整段跳过；溶掉的像素裁掉，前沿一圈发光
                half dissolveEdge = 0;
                [branch] if (_DissolveParams.x > 0.0001)
                {
                    half df = SFDissolveField(i.uv, i.positionWS);
                    clip(df);
                    dissolveEdge = 1.0 - smoothstep(0.0, max((half)_DissolveParams.y, 0.001), df);
                }
                half3 albedo = base.rgb * _Tint.rgb;
                half variantCrack = 0;
                [branch] if (_VariantParams.x + _VariantParams.y > 0.001)
                    albedo = SFVariantSurface(albedo, i.uv, variantCrack);

                half ao = 1.0, roughness = _Roughness, metallic = _Metallic;
                #if defined(_ORMMAP)
                half3 orm = SAMPLE_TEXTURE2D(_ORMMap, sampler_ORMMap, i.uv).rgb;
                ao = lerp(1.0, orm.r, _OcclusionStrength);
                roughness *= orm.g;
                metallic *= orm.b;
                #endif

                half3 N = normalize(i.normalWS);
                #if defined(_NORMALMAP)
                half3 nTS = UnpackNormalScale(SAMPLE_TEXTURE2D(_BumpMap, sampler_BumpMap, i.uv), _BumpScale);
                half3 B = i.tangentWS.w * cross(i.normalWS, i.tangentWS.xyz);
                N = normalize(TransformTangentToWorld(nTS, half3x3(i.tangentWS.xyz, B, i.normalWS)));
                #endif
                half3 V = GetWorldSpaceNormalizeViewDir(i.positionWS);

                #if defined(_ADDITIVE)
                // 发光壳 / 光团：只输出自发光，叠加混合
                half3 glow = albedo;
                #if defined(_EMISSION)
                glow = SAMPLE_TEXTURE2D(_EmissionMap, sampler_EmissionMap, i.uv).rgb * _EmissionColor.rgb;
                #endif
                return half4(MixFogColor(glow * _Tint.a, half3(0,0,0), i.fogAndVertexLight.x), 1);
                #endif

                StylizedStyle st;
                st.shadowTint = _ShadowTint.rgb; st.rampThreshold = _RampThreshold; st.rampSoftness = _RampSoftness;
                st.shadowLift = _ShadowLift; st.ambient = _AmbientStrength; st.specStrength = _SpecStrength; st.specSize = _SpecSize;
                st.rimColor = _RimColor.rgb; st.rimPower = _RimPower; st.rimStrength = _RimStrength;

                #if defined(_FUR)
                // 毛发细节（画质「中」以上）：沿毛向拉长的噪声压出一道道顺毛的笔触；明暗交界更软（毛是蓬的，不是硬壳）
                half furMask = i.furFlow.z * _SFFurDetail;
                half3 furFlow = SFFurFlowWS(i.furFlow.xy, i.normalWS, i.tangentWS);
                if (furMask > 0.001)
                {
                    half strands = SFFurStreaks(i.furBind, SafeNormalize(i.furFlowBind), _FurDensity);
                    albedo *= lerp(1.0, 0.74 + 0.42 * strands, furMask * _FurDetailStrength);
                    st.rampSoftness *= 1.0 + 0.35 * furMask;
                }
                #endif

                half mainLit;
                half3 color = SFShade(albedo, N, i.positionWS, i.positionCS, ao, metallic, roughness, i.fogAndVertexLight.yzw,
                                      i.fogAndVertexLight.x, st, mainLit);

                #if defined(_FUR)
                if (furMask > 0.001)
                {
                    // 顺毛向的光泽带 + 剪影处的绒边（掠射角把毛色往外透一点，轮廓不再是一条硬线）
                    Light furLight = GetMainLight();
                    half sheen = SFFurSheen(furFlow, N, V, furLight.direction, 0.15) * mainLit;
                    color += albedo * furLight.color * sheen * _FurSheen * furMask;
                    half fres = pow(1.0 - saturate(dot(N, V)), 4.0);
                    color += albedo * (SampleSH(N) * 0.5 + furLight.color * (0.3 + 0.7 * mainLit) * 0.35) * fres * _FurFuzz * furMask;
                }
                #endif

                #if defined(_EMISSION)
                color += SAMPLE_TEXTURE2D(_EmissionMap, sampler_EmissionMap, i.uv).rgb * _EmissionColor.rgb;
                #endif
                color += _VariantCrackColor.rgb * variantCrack;
                // 发光遮罩（FX3）：默认三色全黑 → 跳过
                half3 gmSum = _GlowMaskColor0.rgb + _GlowMaskColor1.rgb + _GlowMaskColor2.rgb;
                [branch] if (gmSum.r + gmSum.g + gmSum.b > 0.0001)
                    color += SFGlowMask(i.uv, i.positionWS);

                color = lerp(color, _FlashColor.rgb, _FlashAmount);
                color += _DissolveEdgeColor.rgb * dissolveEdge;
                color = MixFog(color, i.fogAndVertexLight.x);
                return half4(color, _Tint.a);
            }
            ENDHLSL
        }

        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode"="ShadowCaster" }
            ZWrite On
            ZTest LEqual
            ColorMask 0
            Cull [_Cull]

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex ShadowVert
            #pragma fragment ShadowFrag
            #pragma shader_feature_local _ALPHATEST_ON
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW

            #include "SF_StylizedInput.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"

            float3 _LightDirection;
            float3 _LightPosition;

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; float3 positionWS : TEXCOORD1; UNITY_VERTEX_INPUT_INSTANCE_ID };

            Varyings ShadowVert(Attributes input)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, o);
                float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);
                float3 normalWS = TransformObjectToWorldNormal(input.normalOS);
                #if _CASTING_PUNCTUAL_LIGHT_SHADOW
                float3 lightDir = normalize(_LightPosition - positionWS);
                #else
                float3 lightDir = _LightDirection;
                #endif
                o.positionCS = ApplyShadowClamping(TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, lightDir)));
                o.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                o.positionWS = positionWS;
                return o;
            }

            half4 ShadowFrag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                #if defined(_ALPHATEST_ON)
                clip(SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).a * _BaseColor.a - _Cutoff);
                #endif
                [branch] if (_DissolveParams.x > 0.0001) clip(SFDissolveField(i.uv, i.positionWS));
                #if defined(LOD_FADE_CROSSFADE)
                LODFadeCrossFade(i.positionCS);
                #endif
                return 0;
            }
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode"="DepthOnly" }
            ZWrite On
            ColorMask R
            Cull [_Cull]

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex DepthVert
            #pragma fragment DepthFrag
            #pragma shader_feature_local _ALPHATEST_ON
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"

            #include "SF_StylizedInput.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"

            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; float3 positionWS : TEXCOORD1; UNITY_VERTEX_INPUT_INSTANCE_ID UNITY_VERTEX_OUTPUT_STEREO };

            Varyings DepthVert(Attributes input)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                o.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                o.positionWS = TransformObjectToWorld(input.positionOS.xyz);
                return o;
            }

            half DepthFrag(Varyings i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                #if defined(_ALPHATEST_ON)
                clip(SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).a * _BaseColor.a - _Cutoff);
                #endif
                [branch] if (_DissolveParams.x > 0.0001) clip(SFDissolveField(i.uv, i.positionWS));
                #if defined(LOD_FADE_CROSSFADE)
                LODFadeCrossFade(i.positionCS);
                #endif
                return i.positionCS.z;
            }
            ENDHLSL
        }

        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode"="DepthNormals" }
            ZWrite On
            Cull [_Cull]

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex DNVert
            #pragma fragment DNFrag
            #pragma shader_feature_local _NORMALMAP
            #pragma shader_feature_local _ALPHATEST_ON
            #pragma multi_compile _ LOD_FADE_CROSSFADE
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/RenderingLayers.hlsl"
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"

            #include "SF_StylizedInput.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/LODCrossFade.hlsl"

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float4 tangentOS : TANGENT; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                half4 tangentWS : TEXCOORD2;
                float3 positionWS : TEXCOORD3;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings DNVert(Attributes input)
            {
                Varyings o = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                VertexNormalInputs nrm = GetVertexNormalInputs(input.normalOS, input.tangentOS);
                o.normalWS = nrm.normalWS;
                o.tangentWS = half4(nrm.tangentWS, input.tangentOS.w * GetOddNegativeScale());
                o.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                o.positionWS = TransformObjectToWorld(input.positionOS.xyz);
                return o;
            }

            void DNFrag(Varyings i, out half4 outNormalWS : SV_Target0
            #ifdef _WRITE_RENDERING_LAYERS
                , out uint outRenderingLayers : SV_Target1
            #endif
            )
            {
                UNITY_SETUP_INSTANCE_ID(i);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                #if defined(_ALPHATEST_ON)
                clip(SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv).a * _BaseColor.a - _Cutoff);
                #endif
                [branch] if (_DissolveParams.x > 0.0001) clip(SFDissolveField(i.uv, i.positionWS));
                #if defined(LOD_FADE_CROSSFADE)
                LODFadeCrossFade(i.positionCS);
                #endif
                float3 N = i.normalWS;
                #if defined(_NORMALMAP)
                float3 nTS = UnpackNormalScale(SAMPLE_TEXTURE2D(_BumpMap, sampler_BumpMap, i.uv), _BumpScale);
                float3 B = i.tangentWS.w * cross(i.normalWS, i.tangentWS.xyz);
                N = TransformTangentToWorld(nTS, half3x3(i.tangentWS.xyz, B, i.normalWS));
                #endif
                outNormalWS = half4(NormalizeNormalPerPixel(N), 0.0);
                #ifdef _WRITE_RENDERING_LAYERS
                outRenderingLayers = EncodeMeshRenderingLayer();
                #endif
            }
            ENDHLSL
        }
    }

    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
