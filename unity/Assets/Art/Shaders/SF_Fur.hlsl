// 灵火破晓 · 毛发 / 羽毛（StylizedLit 的 _FUR 细节与 FurShell 壳层共用）
// 毛向与遮罩由导入时按骨架和蒙皮权重烘进网格（ArtImportPostprocessor → FurBake）：
//   TEXCOORD2.xyz = 绑定姿势下的位置（模型根空间，米）：发丝图案贴在皮肤上，动画时不游走；
//   TEXCOORD3 = (毛向在切线 T / 副切线 B 上的分量, 毛发遮罩 0..1, 0)：切线随蒙皮转动，毛向跟着骨骼走；
//   TEXCOORD4.xyz = 绑定空间的毛向：发丝图案沿它拉长（顺毛的短线，而不是一颗颗圆点）。
// _SFFurDetail 是全局开关（ArtQuality：中、高 = 1，低 = 0）。
#ifndef SF_FUR_INCLUDED
#define SF_FUR_INCLUDED

half _SFFurDetail;

float3 SFFurHash33(float3 p3)
{
    p3 = frac(p3 * float3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return frac((p3.xxy + p3.yxx) * p3.zyx);
}

// 三维值噪声（0..1）
half SFFurValue(float3 p)
{
    float3 i = floor(p);
    float3 f = frac(p);
    float3 u = f * f * (3.0 - 2.0 * f);
    half a = SFFurHash33(i).x;
    half b = SFFurHash33(i + float3(1, 0, 0)).x;
    half c = SFFurHash33(i + float3(0, 1, 0)).x;
    half d = SFFurHash33(i + float3(1, 1, 0)).x;
    half e = SFFurHash33(i + float3(0, 0, 1)).x;
    half f1 = SFFurHash33(i + float3(1, 0, 1)).x;
    half g = SFFurHash33(i + float3(0, 1, 1)).x;
    half h = SFFurHash33(i + float3(1, 1, 1)).x;
    return lerp(lerp(lerp(a, b, u.x), lerp(c, d, u.x), u.y), lerp(lerp(e, f1, u.x), lerp(g, h, u.x), u.y), u.z);
}

// 一根发丝：绑定空间的抖动网格，每格一根，随机高度，越往上越细。返回 > 0 表示在发丝里。
// 发丝中心限制在格子中部（0.3..0.7），半径不超过 0.3 格，所以只查本格就不会在格子边界上被切掉。
half SFFurStrand(float3 p, half h, half thickness, half clump)
{
    float3 r = SFFurHash33(floor(p));
    float3 centre = 0.3 + 0.4 * r;
    half top = (0.45 + 0.55 * frac(r.x * 13.7 + r.z * 5.3)) * clump;
    half rad = thickness * saturate(1.0 - h / max(top, 0.05));
    return rad - length(frac(p) - centre);
}

// 把绑定空间的点沿毛向压缩（stretch < 1）：在压缩后的空间里取各向同性的格子 / 噪声，回到皮肤上就是沿毛向拉长的形状
float3 SFFurAlongFlow(float3 p, half3 flowBind, half stretch)
{
    return p - flowBind * (dot(p, flowBind) * (1.0 - stretch));
}

// 壳层在高度 h（0 = 根，1 = 最长的发梢）处的发丝覆盖：两套错开半格的网格叠加（更密），沿毛向拉长成顺毛的短线；
// 低频「毛簇」噪声调制发丝高度，和 Tripo 模型上雕出来的大毛簇是同一种读感
half SFFurCoverage(float3 bindPos, half3 flowBind, half density, half h, half thickness, half stretch)
{
    float3 p = SFFurAlongFlow(bindPos, flowBind, stretch) * density;
    half clump = lerp(0.5, 1.0, SFFurValue(p * 0.17));
    return max(SFFurStrand(p, h, thickness, clump), SFFurStrand(p + 0.5, h, thickness, clump));
}

// 顺毛向的各向异性光泽（Kajiya-Kay 式高光带，按风格化的阶梯收窄）；shift 把高光带沿法线方向挪开一点
half SFFurSheen(half3 flowWS, half3 N, half3 V, half3 L, half shift)
{
    half3 T = SafeNormalize(flowWS + N * shift);
    half3 H = SafeNormalize(L + V);
    half th = dot(T, H);
    return smoothstep(0.86, 0.97, sqrt(saturate(1.0 - th * th)));
}

// 画质「中」的发丝明暗：沿毛向拉长的两层值噪声（0..1），压成一道道顺毛的笔触
half SFFurStreaks(float3 bindPos, half3 flowBind, float density)
{
    float3 p = SFFurAlongFlow(bindPos, flowBind, 0.22) * density;
    return SFFurValue(p * 0.8) * 0.6 + SFFurValue(p * 2.1 + 17.0) * 0.4;
}

// TEXCOORD3 → 世界空间毛向
half3 SFFurFlowWS(half2 flowTB, half3 normalWS, half4 tangentWS)
{
    half3 T = SafeNormalize(tangentWS.xyz);
    half3 B = tangentWS.w * cross(SafeNormalize(normalWS), T);
    return SafeNormalize(flowTB.x * T + flowTB.y * B);
}

#endif
