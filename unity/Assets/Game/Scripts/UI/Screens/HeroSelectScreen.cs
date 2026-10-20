using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 选英雄（U6；Three.js src/ui/HeroSelect.ts + css/panels.css .gf-heroes）。主角是英雄本人：镜头推到广场中央的祭台（<see cref="HeroStage"/>），
    /// 英雄站在画面正中偏左、从光中升起亮相，界面只在两侧：
    ///   左：英雄名录（徽记、名字、称号、定位、序号；未解锁带锁）；
    ///   中：透明的拖拽区（拖动旋转英雄，带惯性，松手后转回；手柄右摇杆）+ 底部名牌「英雄名 · 称号」；
    ///   右：信息栏——大号名字（英雄色）/ 称号 / 定位与玩法标签 / 上手难度；描述与要诀；基础属性对比条（生命 / 护盾 / 移速，按全体英雄的最大值归一）
    ///       和额外属性；Q / E / 被动；初始武器卡（类别、开火方式、元素、伤害 / 射速 / 弹匣 / 暴击）；
    ///   右下：返回 /「出征 · 名字」。
    /// 操作：点名录选人（双击直接出征）；1 / 2 / 3；↑ ↓（手柄十字键）在名录里换人，→ 跳到「出征」；名录上按回车 / A 出征。
    /// 不挡游戏、不停时间（祭台的动画和粒子要动）；返回回主菜单（镜头拉回远景）。
    /// </summary>
    [UIScreen(ScreenId)]
    public sealed class HeroSelectScreen : UIScreen
    {
        public const string ScreenId = MainMenuScreen.HeroSelectId;

        public override string Id => ScreenId;
        public override GameState? BlockState => null;
        public override bool FreezeTime => false;

        sealed class StatBar
        {
            public string label;
            public System.Func<HeroDef, float> value;
            public VisualElement fill;
            public Label number;
        }

        readonly List<Button> tabs = new();
        readonly List<StatBar> bars = new();
        VisualElement root, roster, list, info, infoBody, plate, dragArea, extras, skills, weapon, lore, headBlock;
        Label sub, plateName, plateTitle;
        Button confirmBtn, backBtn;
        int selected;
        float openedAt, swapAt = -10f;
        bool dragging;

        public override VisualElement DefaultFocus => tabs.Count > 0 ? tabs[Mathf.Clamp(selected, 0, tabs.Count - 1)] : confirmBtn;

        /// <summary>选中的英雄（测试用）</summary>
        public HeroDef Selected => Heroes.Count > 0 ? Heroes[Mathf.Clamp(selected, 0, Heroes.Count - 1)] : null;

        static IReadOnlyList<HeroDef> Heroes => HeroLibrary.All;

        protected override VisualElement Build()
        {
            root = new VisualElement { name = "hero-select" };
            ScreenKit.Style(root, ScreenKit.ScreensStyle);
            ScreenKit.Style(root, ScreenKit.MenuStyle);
            root.AddToClassList("sf-heroes");
            root.pickingMode = PickingMode.Ignore;
            var shadeL = ScreenKit.El("sf-heroes__shade sf-heroes__shade--l", root);
            UITheme.Paint(shadeL, UITheme.FadeRight, new Color(0.02f, 0.016f, 0.024f, 0.9f));
            var shadeR = ScreenKit.El("sf-heroes__shade sf-heroes__shade--r", root);
            UITheme.Paint(shadeR, UITheme.FadeRight, new Color(0.02f, 0.016f, 0.024f, 0.92f));

            // 拖拽区（透明、接指针）：放在最底下，名录 / 信息栏盖在它上面
            dragArea = ScreenKit.El("sf-heroes__drag", root);
            dragArea.pickingMode = PickingMode.Position;
            dragArea.RegisterCallback<PointerDownEvent>(OnPointerDown);
            dragArea.RegisterCallback<PointerMoveEvent>(OnPointerMove);
            dragArea.RegisterCallback<PointerUpEvent>(OnPointerUp);
            dragArea.RegisterCallback<PointerCaptureOutEvent>(_ => EndDrag());

            var head = ScreenKit.El("sf-heroes__head", root);
            ScreenKit.Text("sf-panel__title sf-heroes__title", head, "选择英雄", UIFontRole.Title);
            sub = ScreenKit.Text("sf-panel__sub", head, "按 1 / 2 / 3 或 ↑ ↓ 切换英雄，回车出征；拖拽祭台旋转英雄（手柄右摇杆）。");

            roster = ScreenKit.El("sf-heroes__roster", root);
            ScreenKit.Text("sf-heroes__label", roster, "英雄名录");
            list = ScreenKit.El("sf-heroes__list", roster);

            plate = ScreenKit.El("sf-heroes__plate", root);
            var plaque = ScreenKit.El("sf-heroes__plaque", plate);
            plateName = ScreenKit.Text("sf-heroes__pname", plaque, "", UIFontRole.Title);
            ScreenKit.El("sf-heroes__pdot", plaque);
            plateTitle = ScreenKit.Text("sf-heroes__ptitle", plaque, "");
            ScreenKit.Text("sf-heroes__hint", plate, "拖拽旋转英雄");

            info = ScreenKit.El("sf-heroes__info", root);
            headBlock = ScreenKit.El("sf-hero-detail__head", info);
            var scroll = ScreenKit.Scroll("sf-heroes__scroll", info);
            infoBody = ScreenKit.El("sf-heroes__body", scroll);
            lore = ScreenKit.El("sf-hero-detail__lore", infoBody);
            var statSect = Section(infoBody, "基础属性", out var statHead);
            extras = ScreenKit.El("sf-hero-extras", statHead);
            var barsEl = ScreenKit.El("sf-hero-bars", statSect);
            AddBar(barsEl, "生命", h => h.maxHp);
            AddBar(barsEl, "护盾", h => h.maxShield);
            AddBar(barsEl, "移速", h => h.moveSpeed);
            skills = ScreenKit.El("sf-hero-skills", Section(infoBody, "技能", out _));
            weapon = ScreenKit.El("sf-hero-weapon", Section(infoBody, "初始武器", out _));

            var foot = ScreenKit.El("sf-heroes__foot", root);
            backBtn = ScreenKit.Btn("返回", "sf-btn--ghost", foot, () => Close());
            confirmBtn = ScreenKit.Btn("出征", "sf-btn--primary sf-btn--wide sf-sound-confirm", foot, Confirm);
            confirmBtn.name = "hero-confirm";
            return root;
        }

        static VisualElement Section(VisualElement parent, string title, out VisualElement head)
        {
            var sect = ScreenKit.El("sf-hero-sect", parent);
            head = ScreenKit.El("sf-hero-sect__head", sect);
            ScreenKit.Text("sf-hero-sect__title", head, title, UIFontRole.Title);
            return sect;
        }

        void AddBar(VisualElement parent, string label, System.Func<HeroDef, float> value)
        {
            var row = ScreenKit.El("sf-hero-bar", parent);
            ScreenKit.Text("sf-hero-bar__label", row, label);
            var track = ScreenKit.El("sf-hero-bar__track", row);
            var fill = ScreenKit.El("sf-hero-bar__fill", track);
            var num = ScreenKit.Text("sf-hero-bar__value", row, "", UIFontRole.Number);
            bars.Add(new StatBar { label = label, value = value, fill = fill, number = num });
        }

        // ───────────── 开 / 关 ─────────────

        public override void OnOpen(object arg)
        {
            openedAt = Time.unscaledTime;
            BuildRoster();
            string want = arg as string ?? MenuFlow.LastHero;
            int idx = 0;
            for (int i = 0; i < Heroes.Count; i++)
                if (Heroes[i].id == want) idx = i;
            Select(idx, false, true);
            if (MenuDirector.Instance) MenuDirector.Instance.Heroes();
            UIFonts.Warmup("选择英雄名录基础属性技能初始武器出征返回要诀上手简单中等进阶生命护盾移速被动冷却充能伤害射速弹匣暴击", UIFontRole.Body);
        }

        public override void OnClose() => EndDrag();

        void BuildRoster()
        {
            list.Clear();
            tabs.Clear();
            var meta = MetaSave.Current;
            for (int i = 0; i < Heroes.Count; i++)
            {
                var h = Heroes[i];
                int k = i;
                var tab = ScreenKit.Card("sf-hero-tab", list, () => Select(k, true));
                tab.name = "hero-tab-" + h.id;
                tab.RegisterCallback<ClickEvent>(e =>
                {
                    if (e.clickCount >= 2) Confirm();
                });
                tab.RegisterCallback<FocusInEvent>(_ =>
                {
                    if (selected != k) Select(k, true);
                });
                var medal = ScreenKit.Crest(h, tab, "sf-hero-tab__medal");
                medal.style.width = medal.style.height = 52;
                var names = ScreenKit.El("sf-hero-tab__names", tab);
                ScreenKit.Text("sf-hero-tab__name", names, h.name, UIFontRole.Title);
                ScreenKit.Text("sf-hero-tab__title", names, h.title);
                ScreenKit.Text("sf-hero-tab__role", names, h.role).style.color = Color.Lerp(h.color, Color.white, 0.25f);
                if (i < 9) ScreenKit.Text("sf-hero-tab__index", tab, (i + 1).ToString(), UIFontRole.Number);
                bool locked = !meta.IsHeroUnlocked(h.id);
                if (locked) ScreenKit.Icon(UIIcon.Lock, "sf-hero-tab__lock", tab);
                tab.EnableInClassList("sf-hero-tab--locked", locked);
                tab.style.borderLeftColor = h.color;
                tabs.Add(tab);
            }
            if (Heroes.Count == 0) ScreenKit.Text("sf-empty", list, "暂无可选的英雄。");
        }

        // ───────────── 选择 / 出征 ─────────────

        /// <summary>选中第 i 位：名录高亮、祭台换人、详情换内容（sound = 出悬停音）</summary>
        public void Select(int i, bool sound, bool force = false)
        {
            if (Heroes.Count == 0) return;
            i = (i % Heroes.Count + Heroes.Count) % Heroes.Count;
            if (i == selected && !force) return;
            selected = i;
            var h = Heroes[i];
            for (int k = 0; k < tabs.Count; k++) tabs[k].EnableInClassList("sf-hero-tab--on", k == i);
            if (HeroStage.Instance) HeroStage.Instance.Show(h.id, true);
            Render(h);
            swapAt = Time.unscaledTime;
            if (sound) UISound.Play(UISound.HoverId);
        }

        /// <summary>出征（未解锁时改成花魂晶解锁）</summary>
        public void Confirm()
        {
            var h = Selected;
            if (h == null) return;
            var meta = MetaSave.Current;
            if (!meta.IsHeroUnlocked(h.id))
            {
                bool ok = meta.UnlockHero(h.id, h.unlockCost);
                UISound.Play(ok ? UISound.ConfirmId : UISound.DenyId);
                GameUI.Toast(ok ? $"已解锁 {h.name}" : "魂晶不足", ok ? h.color : UITheme.Bad);
                BuildRoster();
                Select(selected, false, true);
                return;
            }
            if (HeroStage.Instance) HeroStage.Instance.Show(h.id, true);
            MenuFlow.StartRun(h.id);
        }

        public override bool OnNavigate(Vector2 direction)
        {
            var focused = UIRouter.Focused as VisualElement;
            int ti = tabs.IndexOf(focused as Button);
            if (ti < 0) return false;
            if (direction.y != 0)
            {
                int next = (ti + (direction.y > 0 ? -1 : 1) + tabs.Count) % tabs.Count;
                tabs[next].Focus();
                Select(next, true);
                return true;
            }
            if (direction.x > 0)
            {
                confirmBtn.Focus();
                UISound.Hover(confirmBtn);
                return true;
            }
            return false;
        }

        public override void Tick(float dt)
        {
            float now = Time.unscaledTime;
            float k = ScreenKit.EaseOut((now - openedAt) / 0.45f);
            roster.style.opacity = k;
            roster.style.translate = new Translate(-24 * (1 - k), 0);
            float ik = ScreenKit.EaseOut((now - openedAt - 0.1f) / 0.45f);
            info.style.opacity = ik;
            info.style.translate = new Translate(24 * (1 - ik), 0);
            // 换人：详情从淡出处淡入，名牌跟着
            float sk = ScreenKit.EaseOut((now - swapAt) / 0.25f);
            infoBody.style.opacity = sk;
            headBlock.style.opacity = sk;
            plate.style.opacity = sk * k;
            plate.style.translate = new Translate(0, 8 * (1 - sk));

            for (int i = 0; i < Heroes.Count && i < 3; i++)
                if (GameInput.Pressed(i == 0 ? UIAction.Choice1 : i == 1 ? UIAction.Choice2 : UIAction.Choice3))
                {
                    Select(i, true);
                    if (i < tabs.Count) tabs[i].Focus();
                }
            // 名录上按回车 / A：出征（Button 自己的确认只是选中）
            if (GameInput.Pressed(UIAction.Submit) && UIRouter.Focused is Button b && tabs.IndexOf(b) == selected)
            {
                Confirm();
                return;
            }
            // 手柄右摇杆转英雄
            var pad = Gamepad.current;
            if (pad != null && HeroStage.Instance) HeroStage.Instance.Spin(pad.rightStick.ReadValue().x, Time.unscaledDeltaTime);
        }

        // ───────────── 拖拽 ─────────────

        void OnPointerDown(PointerDownEvent e)
        {
            if (e.button != 0) return;
            dragging = true;
            dragArea.CapturePointer(e.pointerId);
            HeroStage.Instance?.BeginDrag();
            e.StopPropagation();
        }

        void OnPointerMove(PointerMoveEvent e)
        {
            if (!dragging || !dragArea.HasPointerCapture(e.pointerId)) return;
            HeroStage.Instance?.Drag(e.deltaPosition.x);
        }

        void OnPointerUp(PointerUpEvent e)
        {
            if (!dragging) return;
            if (dragArea.HasPointerCapture(e.pointerId)) dragArea.ReleasePointer(e.pointerId);
            EndDrag();
        }

        void EndDrag()
        {
            if (!dragging) return;
            dragging = false;
            HeroStage.Instance?.EndDrag();
        }

        // ───────────── 详情 ─────────────

        void Render(HeroDef h)
        {
            var c = h.color;
            plateName.text = h.name;
            plateTitle.text = h.title;
            plateName.style.color = Color.Lerp(c, Color.white, 0.35f);

            headBlock.Clear();
            var names = ScreenKit.El("sf-hero-detail__names", headBlock);
            ScreenKit.Text("sf-hero-detail__name", names, h.name, UIFontRole.Title).style.color = Color.Lerp(c, Color.white, 0.2f);
            ScreenKit.Text("sf-hero-detail__title", names, h.title, UIFontRole.Title);
            var metaRow = ScreenKit.El("sf-hero-detail__meta", headBlock);
            var role = ScreenKit.Text("sf-hero-role", metaRow, h.role);
            role.style.backgroundColor = ScreenKit.A(c, 0.22f);
            ScreenKit.Border(role, ScreenKit.A(c, 0.6f));
            if (h.tags != null)
                foreach (var t in h.tags)
                    ScreenKit.Text("sf-hero-tag", metaRow, t);
            var diff = ScreenKit.El("sf-hero-diff", headBlock);
            var pips = ScreenKit.El("sf-hero-diff__pips", diff);
            for (int k = 1; k <= 3; k++)
            {
                var pip = ScreenKit.El("sf-hero-diff__pip", pips);
                if (k <= h.difficulty) pip.style.backgroundColor = c;
            }
            ScreenKit.Text("sf-hero-diff__label", diff, "上手");
            ScreenKit.Text("sf-hero-diff__value", diff, HeroDef.DifficultyNames[Mathf.Clamp(h.difficulty, 0, HeroDef.DifficultyNames.Length - 1)]);

            lore.Clear();
            if (!string.IsNullOrEmpty(h.description)) ScreenKit.Text("sf-hero-detail__desc", lore, h.description);
            if (!string.IsNullOrEmpty(h.tip))
            {
                var tip = ScreenKit.El("sf-hero-detail__tip", lore);
                ScreenKit.Text("sf-hero-detail__tiplabel", tip, "要诀");
                ScreenKit.Text("sf-hero-detail__tiptext", tip, h.tip);
            }

            foreach (var b in bars)
            {
                float v = b.value(h), max = 0;
                foreach (var o in Heroes) max = Mathf.Max(max, b.value(o));
                b.fill.style.width = Length.Percent(max > 0 ? Mathf.Clamp01(v / max) * 100 : 0);
                b.fill.style.backgroundColor = Color.Lerp(c, UITheme.Gold, 0.35f);
                b.number.text = ScreenKit.Num1(v);
            }
            extras.Clear();
            var defaults = StatSheet.Default();
            if (h.baseStats != null)
                foreach (var (stat, value) in h.baseStats)
                {
                    float d = value - defaults.GetBase(stat);
                    if (Mathf.Abs(d) < 1e-5f) continue;
                    ScreenKit.Text("sf-hero-extra", extras, $"{StatInfo.Of(stat).name} {StatInfo.Format(stat, d)}");
                }

            skills.Clear();
            SkillRow(skills, "Q", Safe(h.CreatePrimary), false);
            SkillRow(skills, "E", Safe(h.CreateSecondary), true);
            var passive = SafePassive(h);
            var prow = ScreenKit.El("sf-hero-skill sf-hero-skill--passive", skills);
            ScreenKit.Text("sf-hero-skill__key", prow, "被动");
            var pbody = ScreenKit.El("sf-hero-skill__body", prow);
            ScreenKit.Text("sf-hero-skill__name", pbody, passive.name ?? "—", UIFontRole.Title);
            if (!string.IsNullOrEmpty(passive.desc)) ScreenKit.Text("sf-hero-skill__desc", pbody, passive.desc);

            RenderWeapon(h);
            bool unlocked = MetaSave.Current.IsHeroUnlocked(h.id);
            confirmBtn.text = unlocked ? $"出征 · {h.name}" : $"解锁 · {ScreenKit.Num(h.unlockCost)} 魂晶";
        }

        static Skill Safe(System.Func<Skill> make)
        {
            try { return make(); }
            catch (System.Exception e)
            {
                Debug.LogException(e);
                return null;
            }
        }

        static (string name, string desc) SafePassive(HeroDef h)
        {
            try
            {
                var p = h.CreatePassive();
                if (p != null) return (p.Name, p.Description);
            }
            catch (System.Exception e)
            {
                Debug.LogException(e);
            }
            return (h.passiveName, h.passiveDescription);
        }

        static readonly System.Text.RegularExpressions.Regex TimingTail =
            new(@"\s*(?:\d+\s*次充能[，,]\s*)?(?:每次充能|冷却)\s*[\d.]+\s*秒[。.]?\s*$");

        static void SkillRow(VisualElement parent, string key, Skill s, bool secondary)
        {
            var row = ScreenKit.El("sf-hero-skill", parent);
            ScreenKit.Text("sf-hero-skill__key", row, key, UIFontRole.Number);
            var body = ScreenKit.El("sf-hero-skill__body", row);
            var name = ScreenKit.El("sf-hero-skill__namerow", body);
            ScreenKit.Text("sf-hero-skill__name", name, s?.name ?? "—", UIFontRole.Title);
            if (s == null) return;
            var meta = new List<string>();
            if (s.cooldown > 0) meta.Add($"冷却 {ScreenKit.Num1(s.cooldown)} 秒");
            if (secondary || s.maxCharges > 1) meta.Add($"{Mathf.Max(1, s.maxCharges)} 次充能");
            if (meta.Count > 0) ScreenKit.Text("sf-hero-skill__meta", name, string.Join(" · ", meta));
            if (!string.IsNullOrEmpty(s.description))
            {
                // 描述末尾的「冷却 N 秒。」和名字旁的标注重复，去掉
                var d = s.cooldown > 0 ? TimingTail.Replace(s.description, "") : s.description;
                ScreenKit.Text("sf-hero-skill__desc", body, string.IsNullOrEmpty(d) ? s.description : d);
            }
        }

        static string FireModeName(WeaponDef d) => d.mode switch
        {
            FireMode.Semi => "半自动",
            FireMode.Auto => "全自动",
            FireMode.Burst => $"{ScreenKit.Cn(Mathf.Max(1, d.burstCount))}连发",
            FireMode.Beam => "持续光束",
            FireMode.Spinup => "预热全自动",
            FireMode.Charge => "蓄力",
            _ => "",
        };

        void RenderWeapon(HeroDef h)
        {
            weapon.Clear();
            var d = WeaponLibrary.Get(h.startWeapon);
            var head = ScreenKit.El("sf-hero-weapon__head", weapon);
            ScreenKit.Text("sf-hero-weapon__name", head, d != null ? d.name : h.startWeapon, UIFontRole.Title);
            if (d == null) return;
            if (!string.IsNullOrEmpty(d.category)) ScreenKit.Text("sf-hero-weapon__tag", head, d.category);
            var mode = FireModeName(d);
            if (mode.Length > 0) ScreenKit.Text("sf-hero-weapon__tag", head, mode);
            if (d.element != Element.None)
                ScreenKit.Text("sf-hero-weapon__tag", head, $"{HudArt.ElementGlyph(d.element)}属性").style.color = UITheme.ElementColor(d.element);
            var cells = ScreenKit.El("sf-hero-weapon__cells", weapon);
            int hits = Mathf.Max(1, d.HitsPerShot);
            Cell(cells, "伤害", hits > 1 ? $"{ScreenKit.Num1(d.damage)}×{hits}" : ScreenKit.Num1(d.damage), null);
            Cell(cells, "射速", d.ShotsPerSecond().ToString("0.0"), d.mode == FireMode.Beam ? "跳/秒" : "发/秒");
            Cell(cells, "弹匣", d.mag.ToString(), null);
            Cell(cells, "暴击", $"×{ScreenKit.Num1(d.critMult)}", null);
            if (!string.IsNullOrEmpty(d.description)) ScreenKit.Text("sf-hero-weapon__desc", weapon, d.description);
        }

        static void Cell(VisualElement parent, string label, string value, string unit)
        {
            var c = ScreenKit.El("sf-hero-weapon__cell", parent);
            var row = ScreenKit.El("sf-hero-weapon__numrow", c);
            ScreenKit.Text("sf-hero-weapon__num", row, value, UIFontRole.Number);
            if (unit != null) ScreenKit.Text("sf-hero-weapon__unit", row, unit);
            ScreenKit.Text("sf-hero-weapon__label", c, label);
        }
    }
}
