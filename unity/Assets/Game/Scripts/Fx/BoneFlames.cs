using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一组挂在骨骼上的火舌（FX4；Three.js 各火系敌人 buildFlameFx 里「按网格坐标挂一串 createFlameTongue」的公共写法）：
    /// 定义给的是 Three.js 网格坐标（模型空间、未缩放：x = 生物左侧、y 上、z 前）和设计尺寸，绑定姿势下（Awake）换算到骨骼局部；
    /// 之后每帧 <see cref="Update"/> 给亮度和蹿高倍率，每片火舌自己按相位一跳一跳。敌人死后 <see cref="Hide"/>。
    /// </summary>
    public sealed class BoneFlames
    {
        readonly List<(FlameTongue t, float size, float phase)> items = new();
        readonly Transform root;

        public int Count => items.Count;

        BoneFlames(Transform root) => this.root = root;

        /// <summary>
        /// 按定义挂火舌：bone = 骨骼名（找不到挂在 fallback 骨上，再找不到挂在根上），at = 网格坐标，size = 设计尺寸（世界尺寸 = size × 根节点缩放）
        /// </summary>
        public static BoneFlames Build(Transform root, IReadOnlyList<(string bone, Vector3 at, float size)> defs, Color hot, Color mid, Color tip, string fallback = null)
        {
            var f = new BoneFlames(root);
            if (!root || !Application.isPlaying) return f;
            float k = Mathf.Abs(root.lossyScale.x);
            foreach (var (boneName, at, size) in defs)
            {
                var bone = InfernoKit.FindBone(root, boneName);
                if (!bone && fallback != null) bone = InfernoKit.FindBone(root, fallback);
                if (!bone) bone = root;
                var t = FlameTongue.Attach(bone, bone.InverseTransformPoint(InfernoKit.ModelToWorld(root, at)), Vector3.one * size * k, hot, mid, tip);
                if (t) f.items.Add((t, size, Random.value * 10f));
            }
            return f;
        }

        /// <summary>
        /// 每帧：alpha = 亮度，grow = 蹿高倍率（1 = 设计尺寸），width = 宽度比例，height = 额外的高度比例，flicker = 一跳一跳的幅度
        /// </summary>
        public void Update(float age, float alpha, float grow, float width = 0.9f, float height = 1f, float flicker = 0.15f, float rate = 13f)
        {
            if (!root) return;
            float k = Mathf.Abs(root.lossyScale.x);
            foreach (var (t, size, phase) in items)
            {
                if (!t) continue;
                float flick = 1 + flicker * Mathf.Sin(age * rate + phase) + flicker * 0.5f * Mathf.Sin(age * rate * 2.3f + phase * 2);
                float b = size * k * grow;
                t.Set(alpha, new Vector3(b * width, b * flick * height, b));
            }
        }

        public void Hide()
        {
            foreach (var (t, _, _) in items)
                if (t)
                    t.Set(0);
        }
    }
}
