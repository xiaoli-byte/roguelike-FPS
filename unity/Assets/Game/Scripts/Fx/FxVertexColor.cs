using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 写进网格顶点色的颜色转换。工程是线性色彩空间（ProjectSettings m_ActiveColorSpace = 1），特效材质（URP Particles/Unlit / Lit：
    /// <see cref="FxMaterials.Additive"/>、<see cref="FxMaterials.AlphaBlend"/>、弹壳）把网格顶点色直接当线性值乘进去——
    /// 不像 Material.SetColor / 粒子颜色那样由引擎从 sRGB 转成线性。所以按 sRGB 写的调色板颜色写进 mesh.colors 会被抬亮：
    /// 中间调尤其明显，比如铜橙 #ff8a2e 的绿 0.54 显示成 0.76，整道刀光冲成奶白或淡桃色。
    /// 写顶点色前一律过一遍 <see cref="Linear(Color)"/>，屏幕上就是调色板上的颜色。
    /// 只用于「颜色」语义的顶点色；当数据用的顶点色（冰晶的重心坐标、铁链的明暗 / 热度这类按引擎里的观感调过的值）不要转。
    /// </summary>
    public static class FxVertexColor
    {
        /// <summary>sRGB 颜色 → 顶点色（线性色彩空间下转线性，alpha 不变；Gamma 工程原样返回）</summary>
        public static Color Linear(Color c) => QualitySettings.activeColorSpace == ColorSpace.Linear ? c.linear : c;
    }
}
