using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 声音遮挡（I6）：带位置的声音，听者到声源之间被地形 / 建筑挡住时发闷、轻一点——
    /// 墙后的爆炸、拐角后的敌人出招听得出「隔着东西」，开阔地上照常。
    /// 只做一条射线（世界层，不含触发器），首尾各让开 0.4 m（声源贴着地面 / 墙面时不算自己挡自己）；
    /// 太近（3 m 内）的不算遮挡（脚边的东西不该被一块石头闷住）。
    /// </summary>
    public static class AudioOcclusion
    {
        /// <summary>被挡住时的低通截止（Hz）与增益</summary>
        public const float CutoffHz = 1400f, Gain = 0.7f;
        const float MinDist = 3f, Inset = 0.4f;

        /// <summary>listener → source 之间是否被世界几何挡住</summary>
        public static bool Blocked(Vector3 listener, Vector3 source)
        {
            var d = source - listener;
            float dist = d.magnitude;
            if (dist < MinDist) return false;
            var dir = d / dist;
            return Physics.Raycast(listener + dir * Inset, dir, dist - 2 * Inset, Layers.WorldMask, QueryTriggerInteraction.Ignore);
        }

        /// <summary>把遮挡并进已有的低通 / 增益（lowpass = 0 表示原来不开低通）</summary>
        public static void Apply(ref float lowpass, ref float gain)
        {
            lowpass = lowpass > 0 ? Mathf.Min(lowpass, CutoffHz) : CutoffHz;
            gain *= Gain;
        }
    }
}
