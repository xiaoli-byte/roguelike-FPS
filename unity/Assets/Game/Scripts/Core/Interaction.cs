using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 交互提示卡（同 Three.js InteractPrompt）：标题、副标题、多行说明、颜色、价格（灵石）、按键提示。
    /// 现在由 Hud 拼成一行富文本；U2 换成卡片 Widget，调用方不用改。
    /// </summary>
    public struct InteractPrompt : IEquatable<InteractPrompt>
    {
        public string title, subtitle;
        public string[] lines;
        /// <summary>标题颜色（a = 0 表示用默认白色）</summary>
        public Color color;
        /// <summary>价格（灵石，0 = 不要钱）；canAfford = 钱够不够（不够时标红），用 <see cref="WithCost"/> 按当前灵石填</summary>
        public int cost;
        public bool canAfford;
        /// <summary>按键提示（null = 交互键）</summary>
        public string action;

        /// <summary>只有一行标题的提示（旧的 string Prompt）</summary>
        public static InteractPrompt Of(string title) => new() { title = title };

        /// <summary>带价格：按当前局的灵石判断够不够</summary>
        public InteractPrompt WithCost(int price)
        {
            var p = this;
            p.cost = price;
            p.canAfford = (RunState.Current?.coins ?? 0) >= price;
            return p;
        }

        public bool Equals(InteractPrompt o)
        {
            if (title != o.title || subtitle != o.subtitle || color != o.color || cost != o.cost || canAfford != o.canAfford || action != o.action) return false;
            if (ReferenceEquals(lines, o.lines)) return true;
            if (lines == null || o.lines == null || lines.Length != o.lines.Length) return false;
            for (int i = 0; i < lines.Length; i++)
                if (lines[i] != o.lines[i]) return false;
            return true;
        }

        public override bool Equals(object obj) => obj is InteractPrompt p && Equals(p);
        public override int GetHashCode() => HashCode.Combine(title, subtitle, cost, canAfford, action);
    }

    /// <summary>可交互物（宝箱、地上的枪、传送门…）：在 <see cref="Interaction"/> 里登记，由玩家身上的 <see cref="Interactor"/> 挑一个最近、最正对的提示并响应交互键</summary>
    public interface IInteractable
    {
        Vector3 Focus { get; }
        float Radius { get; }
        bool CanInteract { get; }
        /// <summary>一行提示文字（旧接口；要副标题 / 价格 / 多行说明就覆盖 <see cref="PromptCard"/>）</summary>
        string Prompt { get; }
        /// <summary>提示卡：默认包住 <see cref="Prompt"/></summary>
        InteractPrompt PromptCard => InteractPrompt.Of(Prompt);
        void Interact();
    }

    public static class Interaction
    {
        static readonly List<IInteractable> all = new();
        public static IReadOnlyList<IInteractable> All => all;
        public static void Add(IInteractable i) { if (!all.Contains(i)) all.Add(i); }
        public static void Remove(IInteractable i) => all.Remove(i);

        /// <summary>从 eye 看过去最合适的交互物：在半径内；离得稍远时要大致正对（准星 ±53°）</summary>
        public static IInteractable Pick(Transform eye)
        {
            IInteractable best = null;
            float bestScore = float.MaxValue;
            foreach (var i in all)
            {
                if (i == null || !i.CanInteract) continue;
                var v = i.Focus - eye.position;
                float d = v.magnitude;
                if (d > i.Radius) continue;
                float dot = d > 1e-3f ? Vector3.Dot(eye.forward, v / d) : 1;
                if (d > 1.3f && dot < 0.6f) continue;
                float score = d * (2 - dot);
                if (score < bestScore) { bestScore = score; best = i; }
            }
            return best;
        }
    }
}
