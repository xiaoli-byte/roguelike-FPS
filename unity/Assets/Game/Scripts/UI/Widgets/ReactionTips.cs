using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 元素反应首遇教学（Three.js src/ui/ReactionTips.ts；docs/arsenal-expansion.md 9.E；docs/unity-parity.md 3.2 / U3）：
    /// 每局每种反应第一次出现（<see cref="GameEvents.Reacted"/>）时，右上信息角下方滑出一张教学卡：
    ///   反应名（标题字体、反应色）+「元素反应」小签；配方行 = 元素小标（灼 / 雷 / 蚀，归墟三相）→ 效果；一句说明。
    ///   停 5.5 s（不缩放时间），右滑出场；同时来了几种就排队一张张出。
    /// 「已教过」记在 <see cref="RunState.flags"/>（rx:&lt;id&gt;，同 Three.js），每局新建 RunState 时自然重置；没有 RunState 时记在本部件里。
    /// </summary>
    [HudWidget("reaction-tips", Order = 58)]
    public sealed class ReactionTips : HudWidget
    {
        const float ShowTime = 5.5f, InTime = 0.35f, OutTime = 0.4f;

        /// <summary>每种反应的配方元素、效果与说明（文案同 Three.js REACTION_TIPS）</summary>
        static readonly (Element[] parts, string effect, string desc)[] Tips =
        {
            (new[] { Element.Fire, Element.Shock }, "雷火爆炸", "灼烧遇上雷殛：引爆雷火，点燃周围敌人"),
            (new[] { Element.Fire, Element.Corrode }, "熔穿护甲", "灼烧遇上蚀化：熔穿护甲，留下熔池"),
            (new[] { Element.Shock, Element.Corrode }, "击碎护盾", "雷殛遇上蚀化：击碎护盾，麻痹并导流蚀化"),
            (new[] { Element.Fire, Element.Shock, Element.Corrode }, "三段重击", "三相齐聚：三段重击，余波震退"),
        };

        VisualElement card, recipe;
        Label nameLabel, tag, effect, desc;
        readonly List<VisualElement> parts = new();
        readonly Queue<Reaction> queue = new();
        readonly HashSet<Reaction> taughtLocal = new();
        Reaction? showing;
        float shownAt = -10;

        /// <summary>正在显示的反应（测试用）</summary>
        public Reaction? Showing => showing;

        /// <summary>RunState 里的「已教过」键</summary>
        public static string FlagKey(Reaction r) => "rx:" + r.ToString().ToLowerInvariant();

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-rtips");
            card = HudArt.El("sf-rtip", root);
            HudArt.Paint(card, HudArt.FadeLeft, new Color(0.027f, 0.024f, 0.04f, 0.9f));
            var head = HudArt.El("sf-rtip__head", card);
            tag = HudArt.Text("sf-rtip__tag", head, "元素反应");
            nameLabel = HudArt.Text("sf-rtip__name", head, "", UIFontRole.Title);
            recipe = HudArt.El("sf-rtip__recipe", card);
            effect = HudArt.Text("sf-rtip__effect", null, "", UIFontRole.Title);
            desc = HudArt.Text("sf-rtip__desc", card);
            card.style.display = DisplayStyle.None;
            return root;
        }

        protected override void OnAttach() => GameEvents.Reacted += OnReacted;
        protected override void OnDetach() => GameEvents.Reacted -= OnReacted;

        public override void ResetState()
        {
            queue.Clear();
            showing = null;
            card.style.display = DisplayStyle.None;
        }

        void OnReacted(in ReactionEvent e) => Teach(e.id);

        /// <summary>这一局第一次见到这种反应就排队教学（已经教过返回 false）</summary>
        public bool Teach(Reaction r)
        {
            var run = RunState.Current;
            string key = FlagKey(r);
            if (run != null)
            {
                if (run.Flag(key) > 0) return false;
                run.SetFlag(key, 1);
            }
            else if (!taughtLocal.Add(r)) return false;
            if (showing == r || queue.Contains(r)) return false;
            queue.Enqueue(r);
            return true;
        }

        /// <summary>立刻显示一张（不查「已教过」；测试 / 图鉴预览用）</summary>
        public void Show(Reaction r)
        {
            showing = r;
            shownAt = Time.unscaledTime;
            int i = Mathf.Clamp((int)r, 0, Tips.Length - 1);
            var tip = Tips[i];
            var c = CombatTuning.ReactionColors[i];
            nameLabel.text = CombatTuning.ReactionNames[i];
            nameLabel.style.color = c;
            card.style.borderLeftColor = c;
            tag.style.borderTopColor = tag.style.borderBottomColor = tag.style.borderLeftColor = tag.style.borderRightColor = c;
            tag.style.color = c;
            // 配方：元素小标 × … → 效果
            foreach (var p in parts) p.RemoveFromHierarchy();
            parts.Clear();
            for (int k = 0; k < tip.parts.Length; k++)
            {
                if (k > 0) parts.Add(HudArt.Text("sf-rtip__op", recipe, "×"));
                var el = tip.parts[k];
                var badge = HudArt.El("sf-rtip__badge", recipe);
                badge.style.backgroundColor = DamageTable.ElementColor(el);
                HudArt.Text("sf-rtip__glyph", badge, el == Element.Fire ? "灼" : el == Element.Shock ? "雷" : "蚀", UIFontRole.Title);
                parts.Add(badge);
            }
            parts.Add(HudArt.Text("sf-rtip__op", recipe, "→"));
            effect.text = tip.effect;
            effect.style.color = c;
            recipe.Add(effect);
            parts.Add(effect);
            desc.text = tip.desc;
            card.style.display = DisplayStyle.Flex;
            Animate(shownAt);
        }

        public override void Tick(in HudFrame f)
        {
            float now = f.unscaledTime;
            if (showing == null)
            {
                if (queue.Count > 0 && Ctx.Vitals) Show(queue.Dequeue());
                return;
            }
            if (now - shownAt >= ShowTime + OutTime || now < shownAt)
            {
                showing = null;
                card.style.display = DisplayStyle.None;
                return;
            }
            Animate(now);
        }

        void Animate(float now)
        {
            float t = now - shownAt;
            float k;
            if (t < InTime) k = 1 - Mathf.Pow(1 - Mathf.Clamp01(t / InTime), 3);
            else if (t > ShowTime) k = 1 - Mathf.Clamp01((t - ShowTime) / OutTime);
            else k = 1;
            card.style.opacity = k;
            card.style.translate = new Translate(36 * (1 - k), 0);
        }
    }
}
