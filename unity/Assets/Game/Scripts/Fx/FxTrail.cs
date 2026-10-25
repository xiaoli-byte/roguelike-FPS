using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 程序拖尾（刀光）的外观参数（FX1 预设体系的一种：<see cref="FxTrailPreset"/> 带它，拖尾组件按预设 id 取）。
    /// 拖尾是一条两边沿（内沿 / 外沿）随时间采样的带子：每个采样点活 <see cref="life"/> 秒，透明度按 (1 − 年龄 / 寿命)² 收掉；
    /// 横截面三圈：内沿（透明）→ 外沿（最亮，白热）→ 外缘晕（加色的一道窄光边，宽度 = 带宽 × <see cref="fringe"/>）。
    /// 亮度跟着外沿的速度走：速度 ≤ <see cref="slowSpeed"/> 时只剩 <see cref="minBrightness"/>，≥ <see cref="fastSpeed"/> 时满亮（挥得快就更亮）。
    /// </summary>
    public sealed class FxTrailSpec
    {
        /// <summary>采样点寿命（秒，游戏时间：顿帧时拖尾跟着停住）</summary>
        public float life = 0.16f;
        /// <summary>最新的这一小段（秒）额外提亮</summary>
        public float headTime = 0.04f;
        /// <summary>最多保留的采样点</summary>
        public int maxSamples = 64;
        /// <summary>外缘晕的宽度（占带宽的比例）</summary>
        public float fringe = 0.1f;
        /// <summary>带身（普通混合）的最大不透明度：亮背景（沙漠、雪地）上加色几乎看不见，所以带身用普通混合（同 TS）</summary>
        public float bodyAlpha = 0.72f;
        /// <summary>外沿混向白色的比例（越大越白热）：基础 + 刀头额外</summary>
        public float hotMix = 0.3f, headHotMix = 0.45f;
        /// <summary>HDR 强度（&gt; 1 让 Bloom 吃到）：带身、外缘晕</summary>
        public float bodyIntensity = 1.25f, fringeIntensity = 2f;
        /// <summary>速度 → 亮度：慢于 slowSpeed（米 / 秒，第一人称相机空间）只剩 minBrightness，快于 fastSpeed 满亮</summary>
        public float slowSpeed = 2.5f, fastSpeed = 18f, minBrightness = 0.25f;

        /// <summary>外沿速度对应的亮度 0..1（<see cref="minBrightness"/> → 1，smoothstep）</summary>
        public float Brightness(float speed)
        {
            float k = Mathf.InverseLerp(slowSpeed, fastSpeed, float.IsFinite(speed) ? speed : 0);
            k = k * k * (3 - 2 * k);
            return Mathf.Lerp(minBrightness, 1, k);
        }
    }

    /// <summary>
    /// 带拖尾外观的特效预设：<see cref="Trail"/> 给拖尾组件（刀光），<see cref="FxPreset.Layers"/> 是拖尾在判定帧顺带甩出的粒子（按世界坐标播，
    /// 用 <see cref="Fx.Play(FxPreset, Vector3, Vector3, Color, float)"/>，法线 = 挥动方向）。
    /// </summary>
    public abstract class FxTrailPreset : FxPreset
    {
        public FxTrailSpec Trail { get; protected set; } = new();
    }
}
