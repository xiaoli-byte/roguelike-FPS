// 灵火破晓 · 风格化光照（角色 / 场景件的 StylizedLit 与地形的 StylizedTerrain 共用同一套光照模型）
// 主光 N·L 与投影一起经软阶梯分成亮 / 暗两块，暗部叠冷色偏移而不是变黑；环境光取球谐；
// 低粗糙度的金属区才有阶梯高光与环境反射；菲涅尔经阶梯成一道细的边缘光。
// 需要先 include URP 的 Lighting.hlsl。
#ifndef SF_STYLIZED_SHADING_INCLUDED
#define SF_STYLIZED_SHADING_INCLUDED

struct StylizedStyle
{
    half3 shadowTint;
    half rampThreshold, rampSoftness, shadowLift, ambient;
    half specStrength, specSize;
    half3 rimColor;
    half rimPower, rimStrength;
};

// 软阶梯：把 [-1,1] 的光照量压成亮 / 暗两块，中间留 rampSoftness 宽的手绘过渡
half SFRamp(half ndl, StylizedStyle s)
{
    return smoothstep(s.rampThreshold - s.rampSoftness, s.rampThreshold + s.rampSoftness, ndl);
}

half3 SFLight(Light light, half3 albedo, half3 N, half3 V, half metallic, half roughness, StylizedStyle s)
{
    half ndl = dot(N, light.direction);
    // 阴影衰减也进阶梯，投影边缘与明暗交界是同一种笔触；距离衰减保持连续（点光的光斑不分层）
    half lit = SFRamp(ndl, s) * smoothstep(0.0, 0.6, light.shadowAttenuation);
    half3 diffuse = albedo * lit;
    half3 H = SafeNormalize(light.direction + V);
    half ndh = saturate(dot(N, H));
    half gloss = 1.0 - roughness;
    half specEdge = 1.0 - s.specSize * (0.35 + roughness);
    half spec = smoothstep(specEdge - 0.015, specEdge + 0.015, ndh) * gloss * gloss * s.specStrength * lit;
    half3 specColor = lerp(half3(0.9, 0.9, 0.9), albedo, metallic);
    return (diffuse * (1.0 - metallic * 0.5) + specColor * spec) * light.color * light.distanceAttenuation;
}

/// 完整的风格化着色（不含自发光与雾）：环境光 + 冷暗部 + 主光 + 附加光（含 Forward+ 集群）+ 金属反射 + 边缘光
half3 SFShade(half3 albedo, half3 N, float3 positionWS, float4 positionCS, half ao, half metallic, half roughness,
              half3 vertexLight, half fogCoord, StylizedStyle s, out half mainLitOut)
{
    half3 V = GetWorldSpaceNormalizeViewDir(positionWS);
    InputData inputData = (InputData)0;
    inputData.positionWS = positionWS;
    inputData.normalWS = N;
    inputData.viewDirectionWS = V;
    inputData.shadowCoord = TransformWorldToShadowCoord(positionWS);
    inputData.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(positionCS);
    inputData.fogCoord = fogCoord;
    inputData.shadowMask = half4(1, 1, 1, 1);

    half4 shadowMask = CalculateShadowMask(inputData);
    AmbientOcclusionFactor aoFactor = (AmbientOcclusionFactor)0;
    aoFactor.directAmbientOcclusion = 1;
    aoFactor.indirectAmbientOcclusion = ao;
    #if defined(_SCREEN_SPACE_OCCLUSION)
    AmbientOcclusionFactor ssao = GetScreenSpaceAmbientOcclusion(inputData.normalizedScreenSpaceUV);
    aoFactor.indirectAmbientOcclusion = min(ssao.indirectAmbientOcclusion, ao);
    aoFactor.directAmbientOcclusion = ssao.directAmbientOcclusion;
    #endif

    uint meshLayers = GetMeshRenderingLayer();
    Light mainLight = GetMainLight(inputData, shadowMask, aoFactor);

    // 环境光：球谐 × 固有色；暗部再叠一层冷色偏移（shadowTint × 主光），避免背光面发黑发灰
    half3 color = albedo * SampleSH(N) * s.ambient * aoFactor.indirectAmbientOcclusion;
    half mainLit = SFRamp(dot(N, mainLight.direction), s) * smoothstep(0.0, 0.6, mainLight.shadowAttenuation);
    color += albedo * s.shadowTint * mainLight.color * s.shadowLift * (1.0 - mainLit) * aoFactor.indirectAmbientOcclusion;

    #ifdef _LIGHT_LAYERS
    if (IsMatchingLightLayer(mainLight.layerMask, meshLayers))
    #endif
        color += SFLight(mainLight, albedo, N, V, metallic, roughness, s);

    #if defined(_ADDITIONAL_LIGHTS)
    uint pixelLightCount = GetAdditionalLightsCount();
    #if USE_CLUSTER_LIGHT_LOOP
    [loop] for (uint lightIndex = 0; lightIndex < min(URP_FP_DIRECTIONAL_LIGHTS_COUNT, MAX_VISIBLE_LIGHTS); lightIndex++)
    {
        CLUSTER_LIGHT_LOOP_SUBTRACTIVE_LIGHT_CHECK
        Light light = GetAdditionalLight(lightIndex, inputData, shadowMask, aoFactor);
        #ifdef _LIGHT_LAYERS
        if (IsMatchingLightLayer(light.layerMask, meshLayers))
        #endif
            color += SFLight(light, albedo, N, V, metallic, roughness, s);
    }
    #endif
    LIGHT_LOOP_BEGIN(pixelLightCount)
        Light light = GetAdditionalLight(lightIndex, inputData, shadowMask, aoFactor);
        #ifdef _LIGHT_LAYERS
        if (IsMatchingLightLayer(light.layerMask, meshLayers))
        #endif
            color += SFLight(light, albedo, N, V, metallic, roughness, s);
    LIGHT_LOOP_END
    #endif
    #if defined(_ADDITIONAL_LIGHTS_VERTEX)
    color += vertexLight * albedo;
    #endif

    // 金属反射：只给低粗糙度的金属区，强度跟着手绘明暗走
    half3 R = reflect(-V, N);
    half3 env = GlossyEnvironmentReflection(R, positionWS, roughness, aoFactor.indirectAmbientOcclusion, inputData.normalizedScreenSpaceUV);
    color += env * albedo * metallic * (1.0 - roughness) * 0.6;

    // 边缘光：菲涅尔经阶梯成一道细边，受光侧更亮
    half fres = pow(1.0 - saturate(dot(N, V)), s.rimPower);
    half rim = smoothstep(0.35, 0.6, fres) * s.rimStrength * (0.45 + 0.55 * mainLit);
    color += s.rimColor * rim * mainLight.color * albedo * 1.5;

    mainLitOut = mainLit;
    return color;
}

#endif
