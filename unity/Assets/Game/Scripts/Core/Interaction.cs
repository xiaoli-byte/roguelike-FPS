using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>可交互物（宝箱、地上的枪、传送门…）：在 <see cref="Interaction"/> 里登记，由玩家身上的 <see cref="Interactor"/> 挑一个最近、最正对的提示并响应 F</summary>
    public interface IInteractable
    {
        Vector3 Focus { get; }
        float Radius { get; }
        bool CanInteract { get; }
        string Prompt { get; }
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
