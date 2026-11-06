using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 可阅读的遗物 / 碑记（叙事投放，docs/story-draft.md 第 6 节「藏宝点遗物」；第一处是 4-3 守鼓人鼓楼的「修鼓旧簿」）：
    ///   · 走近、看着它：提示卡标题「阅读 · 标题」，副标题是地点，正文分几行直接写在提示卡里（不用另开界面，读完也能再看）；
    ///   · 第一次按交互键：大横幅（<see cref="bannerTitle"/> / <see cref="bannerSub"/>）+ 英雄的一两句台词（<see cref="afterLines"/>，左侧提示条），
    ///     抛 <see cref="AnyRead"/>（以后图鉴 / 残简收集接这个事件）。之后再按只重复台词，不再出横幅。
    /// 模型由关卡构建器摆（石案、经架…），这个组件只管交互，挂在模型前面一点、离地 1 m 的位置读起来最顺手。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class LoreNote : MonoBehaviour, IInteractable
    {
        [Tooltip("遗物名（提示卡标题「阅读 · 名字」）")]
        public string title = "残简";
        [Tooltip("地点（提示卡副标题）")]
        public string place = "";
        [Tooltip("正文，一行一句（提示卡里逐行显示）")]
        [TextArea] public string[] lines = Array.Empty<string>();
        [Tooltip("第一次读时的大横幅：主标题 / 小字")]
        public string bannerTitle = "", bannerSub = "";
        [Tooltip("读完后英雄的台词（「鼯：……」），左侧提示条")]
        public string[] afterLines = Array.Empty<string>();
        public float radius = 2.8f;

        /// <summary>第一次被读（图鉴 / 残简收集、测试用）</summary>
        public static event Action<LoreNote> AnyRead;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => AnyRead = null;

        static readonly Color Ink = new(0.72f, 0.9f, 1f);

        public bool Read { get; private set; }

        void OnEnable() => Interaction.Add(this);
        void OnDisable() => Interaction.Remove(this);

        public Vector3 Focus => transform.position + Vector3.up * 1.0f;
        public float Radius => radius;
        public bool CanInteract => isActiveAndEnabled;
        public string Prompt => $"阅读 · {title}";
        public InteractPrompt PromptCard => new() { title = Prompt, subtitle = place, lines = lines, color = CachePOI.Gold };

        public void Interact()
        {
            bool first = !Read;
            Read = true;
            if (first && !string.IsNullOrEmpty(bannerTitle)) GameUI.Banner(bannerTitle, bannerSub, 4f);
            foreach (var l in afterLines)
                if (!string.IsNullOrEmpty(l)) GameUI.Toast(l, Ink, 7f);
            if (first) AnyRead?.Invoke(this);
        }
    }
}
