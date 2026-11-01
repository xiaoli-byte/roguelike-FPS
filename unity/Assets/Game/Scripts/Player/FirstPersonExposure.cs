using System;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第一人称曝光补偿（第二批 E 路，docs/performance-unity.md「第一人称渲染」）：关卡 Volume 上的一个系数，只作用于 FirstPerson 层（枪模、手臂、碎刃、枪口火焰）。
    /// 枪模不再是叠加相机以后，世界和枪模走同一遍后处理；前三章的 Volume 为了让世界看起来和以前（世界被后处理两遍）一样，调色更重（曝光更低、对比更高），
    /// 枪模跟着变暗。这里在枪模进后处理之前把它提亮回来：<see cref="FirstPersonView"/> 画 FirstPerson 层时设全局
    /// _FirstPersonExposureDelta = 系数 − 1、_FirstPersonGammaDelta = 伽马 − 1（SF_StylizedLit：颜色 = 系数 × 颜色^伽马，两个都是 0 时跳过、输出不变），
    /// 粒子 / 网格特效（刀光、刀上光点、枪口火焰的星芒）没法做伽马，按 <see cref="FirstPersonView.EffectsExposure"/>（特效）放大颜色，
    /// 枪口火焰的白芯再乘火焰倍数（<see cref="FirstPersonView.FlashExposure"/> = 特效 × 火焰），火焰颜色再按 effectsSaturation 拉饱和度。
    /// 全部默认 1 = 不补偿（第四章起按单遍调色，不用它）。
    /// 每章的值由 playtest fp-shots 拟合：开火 / 换弹 / 技能三个动作里枪模和手的平均亮度对齐改前（系数、伽马），
    /// 枪口火焰的像素 RGB 对齐改前（特效系数、饱和度；星芒平均亮度不低于改前），写在 ShowcaseTheme.fpExposure / fpGamma / fpEffects / fpEffectsSaturation / fpFlash。
    /// </summary>
    [Serializable, VolumeComponentMenu("Spiritfire/第一人称曝光补偿"), SupportedOnRenderPipeline(typeof(UniversalRenderPipelineAsset))]
    public sealed class FirstPersonExposure : VolumeComponent
    {
        /// <summary>FirstPerson 层颜色的倍数（进后处理之前）</summary>
        public ClampedFloatParameter multiplier = new(1f, 0.25f, 4f);

        /// <summary>FirstPerson 层颜色的伽马（&gt; 1 亮处多提、暗处少提；只作用于 SF_StylizedLit 的枪模和手臂）</summary>
        public ClampedFloatParameter gamma = new(1f, 0.7f, 1.5f);

        /// <summary>第一人称层的粒子 / 网格特效（刀光、刀上光点、枪口火焰）颜色的倍数</summary>
        public ClampedFloatParameter effects = new(1f, 0.25f, 4f);

        /// <summary>枪口火焰颜色的饱和度（绕亮度拉开，1 = 不变）：新调色下橙色火焰会偏淡黄，往回拉</summary>
        public ClampedFloatParameter effectsSaturation = new(1f, 0.5f, 2.5f);

        /// <summary>枪口火焰白芯在 <see cref="effects"/> 之外再乘的倍数（保证白芯不比改前暗）</summary>
        public ClampedFloatParameter flash = new(1f, 0.5f, 8f);
    }
}
