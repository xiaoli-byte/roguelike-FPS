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

// 一根发丝的截面（有符号距离，格为单位，> 0 在发丝里）：只量切平面里的距离（去掉沿表面法线 n 的分量），
// 所以不管表面从格子的哪一层穿过，截面都是同样大小的圆，而不是忽大忽小的斑点；越往上越细（锥形）
half SFFurStrandSD(float3 p, float3 n, half h, half thickness, half clump)
{
    float3 r = SFFurHash33(floor(p));
    float3 e = frac(p) - (0.3 + 0.4 * r);
    e -= n * dot(e, n);
    half top = (0.45 + 0.55 * frac(r.x * 13.7 + r.z * 5.3)) * clump;
    half rad = thickness * pow(saturate(1.0 - h / max(top, 0.05)), 0.75);
    return rad - length(e);
}

// 有符号距离 → 抗锯齿覆盖率（alpha-to-coverage 用：边缘在一个像素宽度内过渡，MSAA 下发丝是柔边，不闪）
half SFFurAA(half sd)
{
    return saturate(sd / max(fwidth(sd), 1e-4) + 0.5);
}

// 壳层在高度 h（0 = 根，1 = 最长的发梢）处的发丝覆盖率（0..1，给 AlphaToMask）：
//   两套错开半格的网格叠加（更密），沿毛向拉长成顺毛的短线；低频「毛簇」噪声调制发丝高度（和雕出来的大毛簇同一种读感）；
//   远处一格发丝不到两个像素时逐渐换成该高度的平均覆盖率（预滤波，代替贴图的 mipmap），否则发丝会闪成噪点。
half SFFurShellAlpha(float3 bindPos, half3 flowBind, float density, half h, half thickness, half stretch)
{
    float3 q = SFFurAlongFlow(bindPos, flowBind, stretch) * density;
    float3 dqx = ddx(q), dqy = ddy(q);
    float3 n = SafeNormalize(cross(dqx, dqy));
    half clump = lerp(0.5, 1.0, SFFurValue(q * 0.17));
    half sd = max(SFFurStrandSD(q, n, h, thickness, clump), SFFurStrandSD(q + 0.5, n, h, thickness, clump));
    half rad = thickness * pow(saturate(1.0 - h / (0.75 * clump)), 0.75);
    // 远处：外层整层淡出（毛边随距离变短），内层换成平均覆盖率；不把外层的稀疏发梢留成一粒粒飘在空中的散点
    half avg = saturate(6.2832 * rad * rad) * saturate(1.0 - 1.4 * h);
    half far = saturate((max(length(dqx), length(dqy)) - 0.35) / 0.4);
    return lerp(SFFurAA(sd), avg, far);
}

// 轮廓发丝面片（fins）上的发丝：x = 沿边的位置（格），y = 0（根）..1（梢）；与壳层同一种锥形发丝，两套错开的格子
half SFFurFinAlpha(float x, half y, half thickness)
{
    float c = floor(x);
    float3 r = SFFurHash33(float3(c, c * 0.37 + 11.0, 5.0));
    float3 r2 = SFFurHash33(float3(c + 0.5, c * 0.61 + 3.0, 9.0));
    half top1 = 0.45 + 0.55 * r.y, top2 = 0.45 + 0.55 * r2.y;
    half sd1 = thickness * pow(saturate(1.0 - y / top1), 0.75) - abs(frac(x) - (0.3 + 0.4 * r.x));
    half sd2 = thickness * pow(saturate(1.0 - y / top2), 0.75) - abs(frac(x + 0.5) - (0.3 + 0.4 * r2.x));
    half sd = max(sd1, sd2);
    half avg = saturate(3.0 * thickness * (1.0 - y / 0.75));
    half far = saturate((fwidth(x) - 0.35) / 0.4);
    return lerp(SFFurAA(sd), avg, far);
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
