using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// Tab 行囊面板（U4；Three.js src/ui/InventoryPanel.ts + css/panels.css .gf-tab，外加 Unity 独有的灵宠页）：
    ///   「行囊」页三栏——已获得秘卷（带当前层数下的说明、代价行）、属性网格（关键属性 + 所有偏离基础值的）、两把武器卡
    ///   （槽位、传说前缀 + 名字 + 强化、品质 · 类别 · 元素、按玩家属性结算后的伤害 / 射速 / 弹匣 / 换弹 / 暴击 / 秒伤、特性与词条，传说特性金字）；
    ///   「灵宠」页——结契灵宠的品阶、称号、灵契等级与经验、攻击方式、被动、灵技、觉醒（没有灵宠时写怎么结契）。
    /// 和 Three.js 的「按住 Tab 看」不同：这里 Tab 开 / 关，开着时停时间（要翻页、手柄要能操作）。关：Tab / Esc / 手柄 Back、B。
    /// 页签：点击，或 Q / E（手柄 LB / RB）。打开时按当前状态重建（时间是停的，开着期间不变）。
    /// </summary>
    [UIScreen(ScreenId)]
    public sealed class InventoryPanel : UIScreen
    {
        public const string ScreenId = "inventory";
        public const string BagTab = "行囊", PetTab = "灵宠";

        public override string Id => ScreenId;

        readonly List<(string name, Button tab, VisualElement page)> tabs = new();
        VisualElement frame, scrollsList, statsGrid, arms, petPage;
        Label scrollCount;
        int current, openedFrame;
        float openedAt;

        public override VisualElement DefaultFocus => tabs.Count > 0 ? tabs[current].tab : null;

        /// <summary>当前页签（测试用）</summary>
        public string CurrentTab => tabs.Count > 0 ? tabs[current].name : null;

        /// <summary>上次重建时的秘卷数 / 武器卡数（测试用）</summary>
        public int ScrollRows { get; private set; }
        public int WeaponCards { get; private set; }

        protected override VisualElement Build()
        {
            var root = new VisualElement { name = "inventory" };
            ScreenKit.Style(root, ScreenKit.ScreensStyle);
            root.AddToClassList("sf-inv");
            ScreenKit.El("sf-backdrop sf-inv__backdrop", root);
            frame = ScreenKit.El("sf-frame sf-inv__frame", root);

            var head = ScreenKit.El("sf-inv__head", frame);
            var tabRow = ScreenKit.El("sf-tabs sf-tabs--inline", head);
            ScreenKit.El("sf-grow", head);
            ScreenKit.Text("sf-panel__hint", head, "Tab / Esc 关闭　·　Q / E 切换");

            var bag = AddTab(tabRow, BagTab);
            bag.AddToClassList("sf-inv__bag");
            var colS = ScreenKit.El("sf-inv__col sf-inv__col--scrolls", bag);
            var sh = ScreenKit.El("sf-section", colS);
            ScreenKit.Text("sf-section__title", sh, "秘卷", UIFontRole.Title);
            scrollCount = ScreenKit.Text("sf-section__count", sh, "", UIFontRole.Number);
            scrollsList = ScreenKit.El("sf-inv__list", ScreenKit.Scroll("sf-inv__scroll", colS));

            var colT = ScreenKit.El("sf-inv__col sf-inv__col--stats", bag);
            ScreenKit.Text("sf-section__title", ScreenKit.El("sf-section", colT), "属性", UIFontRole.Title);
            statsGrid = ScreenKit.El("sf-statgrid", ScreenKit.Scroll("sf-inv__scroll", colT));

            var colA = ScreenKit.El("sf-inv__col sf-inv__col--arms", bag);
            ScreenKit.Text("sf-section__title", ScreenKit.El("sf-section", colA), "武器", UIFontRole.Title);
            arms = ScreenKit.El("sf-inv__arms", ScreenKit.Scroll("sf-inv__scroll", colA));

            petPage = AddTab(tabRow, PetTab);
            petPage.AddToClassList("sf-inv__petpage");
            Select(0);
            return root;
        }

        VisualElement AddTab(VisualElement row, string name)
        {
            int index = tabs.Count;
            var tab = ScreenKit.Card("sf-tab", row, () => Select(index));
            tab.name = "tab-" + name;
            ScreenKit.Text("sf-tab__label", tab, name, UIFontRole.Title);
            var page = ScreenKit.El("sf-inv__page", frame);
            tabs.Add((name, tab, page));
            return page;
        }

        /// <summary>切到第 i 个页签</summary>
        public void Select(int i)
        {
            if (tabs.Count == 0) return;
            current = (i % tabs.Count + tabs.Count) % tabs.Count;
            for (int k = 0; k < tabs.Count; k++)
            {
                tabs[k].tab.EnableInClassList("sf-tab--on", k == current);
                ScreenKit.Show(tabs[k].page, k == current);
            }
        }

        public override void OnOpen(object arg)
        {
            openedAt = Time.unscaledTime;
            openedFrame = Time.frameCount;
            if (arg is string name)
                for (int k = 0; k < tabs.Count; k++)
                    if (tabs[k].name == name) Select(k);
            Rebuild();
            GameUI.ClearMessages();
        }

        public override void Tick(float dt)
        {
            float k = ScreenKit.EaseOut((Time.unscaledTime - openedAt) / 0.22f);
            frame.style.opacity = k;
            frame.style.scale = new Scale(new Vector3(0.985f + 0.015f * k, 0.985f + 0.015f * k, 1));
            if (Time.frameCount == openedFrame) return;
            // Tab / 手柄 Back 再按一次关（Gameplay 表关着，直接读按键）
            if (ScreenKit.PressedRaw(GameAction.Inventory))
            {
                Close();
                return;
            }
            if (ScreenKit.PressedRaw(GameAction.SkillQ)) Select(current - 1);
            else if (ScreenKit.PressedRaw(GameAction.SkillE)) Select(current + 1);
        }

        /// <summary>按当前状态重建三栏和灵宠页</summary>
        public void Rebuild()
        {
            int n = ScrollList.Render(scrollsList, ScrollList.Inventory, true);
            ScrollRows = n;
            scrollCount.text = n > 0 ? n.ToString() : "";
            var pv = PlayerVitals.Instance;
            StatGrid.Render(statsGrid, pv ? pv.stats : null, StatGrid.KeyStats, true);
            BuildArms();
            BuildPet();
        }

        // ───────────── 武器卡 ─────────────

        static WeaponController Weapons
        {
            get
            {
                var p = SceneFlow.Instance ? SceneFlow.Instance.Player : null;
                if (p != null && p.weapons) return p.weapons;
                var pv = PlayerVitals.Instance;
                return pv ? pv.GetComponentInChildren<WeaponController>() : Object.FindAnyObjectByType<WeaponController>();
            }
        }

        void BuildArms()
        {
            arms.Clear();
            WeaponCards = 0;
            var wc = Weapons;
            if (!wc)
            {
                ScreenKit.Text("sf-empty", arms, "没有武器数据。");
                return;
            }
            for (int i = 0; i < wc.slots.Length; i++)
            {
                WeaponCard.Build(arms, wc.slots[i], i, i == wc.ActiveSlot);
                if (wc.slots[i] != null) WeaponCards++;
            }
        }

        // ───────────── 灵宠页 ─────────────

        void BuildPet()
        {
            petPage.Clear();
            var owner = PetOwner.Instance;
            var pet = owner ? owner.Current : null;
            if (!pet)
            {
                var empty = ScreenKit.El("sf-pet-empty", petPage);
                ScreenKit.Text("sf-pet-empty__title", empty, "尚未结契灵宠", UIFontRole.Title);
                ScreenKit.Text("sf-pet-empty__text", empty, "击败灵兽或打开宝箱掉出灵兽封印后，走近按 F 结契。灵宠跟随作战、升级觉醒，跨关一直陪着你。");
                return;
            }
            var def = pet.def;
            var rc = def.RarityColor;
            var card = ScreenKit.El("sf-petcard", petPage);
            card.style.borderLeftColor = rc;
            var head = ScreenKit.El("sf-petcard__head", card);
            var name = ScreenKit.Text("sf-petcard__name", head, def.name, UIFontRole.Title);
            name.style.color = rc;
            ScreenKit.Text("sf-petcard__sub", head, $"{PetRarities.Name(def.rarity)} · {def.title}{(string.IsNullOrEmpty(def.role) ? "" : " · " + def.role)}");
            if (def.element != Element.None)
            {
                var el = ScreenKit.Text("sf-chip", head, $"{HudArt.ElementGlyph(def.element)} {WeaponCard.ElementName(def.element)}");
                el.style.color = UITheme.ElementColor(def.element);
            }

            var lv = ScreenKit.El("sf-petcard__level", card);
            string state = pet.Level >= Pet.MaxLevel ? "觉醒 · 满级" : pet.Awakened ? "觉醒" : $"{Pet.AwakenLevel} 级觉醒";
            ScreenKit.Text("sf-petcard__lv", lv, $"灵契 Lv.{pet.Level}", UIFontRole.Number);
            ScreenKit.Text("sf-petcard__state", lv, state);
            var bar = ScreenKit.El("sf-petcard__xp", card);
            var fill = ScreenKit.El("sf-petcard__xpfill", bar);
            float xp = pet.XpNext > 0 ? Mathf.Clamp01(pet.Xp / pet.XpNext) : 1;
            fill.style.width = Length.Percent(xp * 100);
            ScreenKit.Text("sf-petcard__xptext", card, pet.XpNext > 0 ? $"经验 {Mathf.FloorToInt(pet.Xp)} / {Mathf.CeilToInt(pet.XpNext)}" : "经验已满", UIFontRole.Number);

            if (!string.IsNullOrEmpty(def.lore)) ScreenKit.Text("sf-petcard__lore", card, def.lore);
            var grid = ScreenKit.El("sf-petcard__grid", card);
            PetBlock(grid, "攻击", null, def.attackDesc);
            PetBlock(grid, "被动", def.passiveName, def.passiveDesc);
            PetBlock(grid, $"灵技 · {ScreenKit.KeyLabel(GameAction.PetSkill)}", def.skillName, $"{def.skillDesc}（冷却 {ScreenKit.Num1(pet.SkillCooldown)} 秒）");
            PetBlock(grid, "觉醒", null, def.awakenDesc, !pet.Awakened);
            ScreenKit.Text("sf-petcard__foot", card, $"本局灵宠造成伤害 {ScreenKit.Num(pet.DamageDealt)}", UIFontRole.Number);
        }

        static void PetBlock(VisualElement parent, string label, string name, string desc, bool dim = false)
        {
            if (string.IsNullOrEmpty(desc) && string.IsNullOrEmpty(name)) return;
            var b = ScreenKit.El("sf-petblock", parent);
            if (dim) b.AddToClassList("sf-petblock--locked");
            var h = ScreenKit.El("sf-petblock__head", b);
            ScreenKit.Text("sf-petblock__label", h, label);
            if (!string.IsNullOrEmpty(name)) ScreenKit.Text("sf-petblock__name", h, name, UIFontRole.Title);
            if (!string.IsNullOrEmpty(desc)) ScreenKit.Text("sf-petblock__desc", b, desc);
        }
    }
}
