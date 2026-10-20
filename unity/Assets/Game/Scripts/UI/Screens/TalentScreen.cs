using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 局外天赋（U5；Three.js src/ui/TalentPanel.ts + css/panels.css .gf-talents）：花魂晶升级，对之后的每一局永久生效。
    /// 两列天赋行：名字 + 等级、说明、等级菱形 +「当前 / 下一级」效果、购买按钮（魂晶图标 + 价格；不够时变暗、按了抖一下出拒绝音；满级禁用）。
    /// 右上魂晶余额，页脚「已点亮 n / 总级数」。数据都来自 <see cref="MetaSave.Current"/> 和 <see cref="TalentLibrary"/>（加一个天赋 = 加一个 Talent_*.cs）。
    /// 主菜单里打开，不挡游戏；返回回主菜单。
    /// </summary>
    [UIScreen(ScreenId)]
    public sealed class TalentScreen : UIScreen
    {
        public const string ScreenId = "talents";

        public override string Id => ScreenId;
        public override GameState? BlockState => null;
        public override bool FreezeTime => false;

        sealed class Row
        {
            public TalentDef def;
            public VisualElement el;
            public Button buy;
            public float shakeAt = -1, flashAt = -1;
        }

        readonly List<Row> rows = new();
        VisualElement frame, grid;
        Label essence, total;
        Button backBtn;
        float openedAt;

        public override VisualElement DefaultFocus => rows.Count > 0 ? rows[0].buy : backBtn;

        protected override VisualElement Build()
        {
            var root = new VisualElement { name = "talents" };
            ScreenKit.Style(root, ScreenKit.ScreensStyle);
            ScreenKit.Style(root, ScreenKit.MenuStyle);
            root.AddToClassList("sf-talents-screen");
            ScreenKit.El("sf-backdrop sf-menu-sub__backdrop", root);
            frame = ScreenKit.El("sf-frame sf-talents", root);
            var head = ScreenKit.El("sf-panel__head sf-panel__head--split", frame);
            var titles = ScreenKit.El("sf-panel__titles", head);
            ScreenKit.Text("sf-panel__title", titles, "天赋", UIFontRole.Title);
            ScreenKit.Text("sf-panel__sub", titles, "魂晶在每局结束时结算。天赋对之后的每一局永久生效。");
            var wallet = ScreenKit.El("sf-wallet", head);
            ScreenKit.Icon(UIIcon.Essence, "sf-icon--essence", wallet);
            ScreenKit.Text("sf-wallet__label", wallet, "魂晶");
            essence = ScreenKit.Text("sf-wallet__num", wallet, "0", UIFontRole.Number);

            grid = ScreenKit.El("sf-talents__grid", ScreenKit.Scroll("sf-talents__scroll", frame));
            var foot = ScreenKit.El("sf-panel__foot", frame);
            total = ScreenKit.Text("sf-talents__total", foot, "", UIFontRole.Number);
            ScreenKit.El("sf-grow", foot);
            backBtn = ScreenKit.Btn("返回", "sf-btn--primary", foot, () => Close());
            return root;
        }

        public override void OnOpen(object arg)
        {
            openedAt = Time.unscaledTime;
            BuildRows();
            Refresh();
            GameEvents.MetaChanged -= OnMeta;
            GameEvents.MetaChanged += OnMeta;
        }

        public override void OnClose() => GameEvents.MetaChanged -= OnMeta;

        void OnMeta(MetaSave _) => Refresh();

        void BuildRows()
        {
            grid.Clear();
            rows.Clear();
            var all = TalentLibrary.All;
            if (all.Count == 0)
            {
                ScreenKit.Text("sf-empty", grid, "暂无可强化的天赋。");
                return;
            }
            foreach (var def in all)
            {
                var r = new Row { def = def };
                r.el = ScreenKit.El("sf-talent", grid);
                r.el.name = "talent-" + def.id;
                ScreenKit.El("sf-talent__info", r.el);
                var d = def;
                r.buy = ScreenKit.Card("sf-buy", r.el, () => Buy(d));
                r.buy.name = "buy-" + def.id;
                rows.Add(r);
            }
        }

        /// <summary>按当前存档刷新全部行、余额、合计</summary>
        public void Refresh()
        {
            var meta = MetaSave.Current;
            int have = meta.Essence;
            essence.text = ScreenKit.Num(have);
            total.text = $"已点亮 {meta.TalentLevelsOwned} / {MetaSave.TalentLevelsTotal}";
            foreach (var r in rows)
            {
                var t = r.def;
                int lv = meta.TalentLevel(t.id);
                bool maxed = lv >= t.maxLevel;
                int cost = maxed ? 0 : t.Cost(lv);
                r.el.EnableInClassList("sf-talent--maxed", maxed);

                var info = r.el.Q(className: "sf-talent__info");
                info.Clear();
                var name = ScreenKit.El("sf-talent__namerow", info);
                ScreenKit.Text("sf-talent__name", name, t.name, UIFontRole.Title);
                ScreenKit.Text("sf-talent__lvl", name, $"{lv} / {t.maxLevel}", UIFontRole.Number);
                ScreenKit.Text("sf-talent__desc", info, t.description);
                var eff = ScreenKit.El("sf-talent__effect", info);
                var pips = ScreenKit.El("sf-talent__pips", eff);
                for (int k = 0; k < t.maxLevel; k++) ScreenKit.El(k < lv ? "sf-talent__pip sf-talent__pip--on" : "sf-talent__pip", pips);
                ScreenKit.Text("sf-talent__now", eff, $"当前 {t.Effect(lv)}");
                if (!maxed) ScreenKit.Text("sf-talent__next", eff, $"下一级 {t.Effect(lv + 1)}");

                r.buy.Clear();
                r.buy.EnableInClassList("sf-buy--maxed", maxed);
                r.buy.EnableInClassList("sf-buy--short", !maxed && have < cost);
                if (maxed) ScreenKit.Text("sf-buy__label", r.buy, "已满级");
                else
                {
                    ScreenKit.Icon(UIIcon.Essence, "sf-icon--essence", r.buy);
                    ScreenKit.Text("sf-buy__cost", r.buy, ScreenKit.Num(cost), UIFontRole.Number);
                }
                r.buy.tooltip = maxed ? "" : have >= cost ? $"花费 {cost} 魂晶强化" : $"还差 {cost - have} 魂晶";
            }
        }

        /// <summary>买一级（按钮和测试都走这里）：成功返回 true</summary>
        public bool Buy(TalentDef def)
        {
            var r = rows.Find(x => x.def == def);
            bool ok = def != null && MetaSave.Current.BuyTalent(def.id);
            if (r != null)
            {
                if (ok) r.flashAt = Time.unscaledTime;
                else r.shakeAt = Time.unscaledTime;
            }
            UISound.Play(ok ? UISound.ConfirmId : UISound.DenyId);
            Refresh();
            return ok;
        }

        public override void Tick(float dt)
        {
            float now = Time.unscaledTime;
            float k = ScreenKit.EaseOut((now - openedAt) / 0.28f);
            frame.style.opacity = k;
            frame.style.translate = new Translate(0, 14 * (1 - k));
            for (int i = 0; i < rows.Count; i++)
            {
                var r = rows[i];
                float rk = ScreenKit.EaseOut((now - openedAt - 0.04f * i) / 0.35f);
                float x = 0;
                if (r.shakeAt >= 0)
                {
                    float s = (now - r.shakeAt) / 0.24f;
                    if (s >= 1) r.shakeAt = -1;
                    else x = Mathf.Sin(s * Mathf.PI * 3) * 6 * (1 - s);
                }
                r.el.style.translate = new Translate(x, 10 * (1 - rk));
                r.el.style.opacity = rk;
                if (r.flashAt >= 0)
                {
                    float f = (now - r.flashAt) / 0.48f;
                    if (f >= 1)
                    {
                        r.flashAt = -1;
                        r.el.style.backgroundColor = StyleKeyword.Null;
                    }
                    else r.el.style.backgroundColor = new Color(0.83f, 0.66f, 0.33f, 0.3f * (1 - f));
                }
            }
        }
    }
}
