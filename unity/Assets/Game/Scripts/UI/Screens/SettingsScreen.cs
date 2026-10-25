using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 设置（U4；Three.js src/ui/SettingsPanel.ts + css/overlays.css .gf-settings）。主菜单和暂停菜单共用，叠在它们上面，返回回去。
    /// 控件按 <see cref="GameSettings.All"/> 的元数据自动生成（加一项设置不用改界面）：
    ///   分组 → 页签（操作 / 画面 / 声音，按登记顺序），数值 → 滑条（手柄左右直接调）+ 读数，开关 → 拨钮，多选一 → 分段按钮。
    /// 另有两块手写的：「画面」页「显示模式」下面的分辨率步进器（写 GameSettings 的隐藏项分辨率宽 / 高，GraphicsQuality 执行），「按键」页的改键表（键鼠、手柄各一列，
    /// <see cref="GameInput.StartRebind"/>，Esc 取消；移动 / 视角是组合绑定，只显示不改）。
    /// 页签：点击，或 Q / E（手柄 LB / RB）切换。改动即时生效、自动保存（GameSettings / GameInput 自己写盘）。
    /// 不挡游戏（叠在暂停菜单上时由暂停挡着；主菜单里不停时间）。
    /// </summary>
    [UIScreen(ScreenId)]
    public sealed class SettingsScreen : UIScreen
    {
        public const string ScreenId = "settings";
        public const string KeysTab = "按键";

        public override string Id => ScreenId;
        public override GameState? BlockState => null;
        public override bool FreezeTime => false;

        readonly List<(string name, Button tab, VisualElement page)> tabs = new();
        readonly List<System.Action> syncs = new();
        readonly List<(Button button, GameAction action, string scheme)> bindButtons = new();
        readonly List<(Button button, SettingDef def)> steppers = new();
        VisualElement frame;
        ScrollView body;
        Button backBtn, resolutionBtn;
        int current;
        float openedAt;
        bool rebinding;
        int rebindEndFrame = -10;
        List<Vector2Int> resolutions;
        int resolutionIndex;

        public override VisualElement DefaultFocus => tabs.Count > 0 ? tabs[current].tab : backBtn;

        /// <summary>当前页签名（测试用）</summary>
        public string CurrentTab => tabs.Count > 0 ? tabs[current].name : null;

        /// <summary>自动生成的设置控件个数（测试用：= GameSettings.All 的条数）</summary>
        public int GeneratedControls { get; private set; }

        /// <summary>正在等玩家按新键</summary>
        public bool Rebinding => rebinding;

        protected override VisualElement Build()
        {
            var root = new VisualElement { name = "settings" };
            ScreenKit.Style(root, ScreenKit.ScreensStyle);
            root.AddToClassList("sf-settings-screen");
            ScreenKit.El("sf-backdrop sf-settings-screen__backdrop", root);
            frame = ScreenKit.El("sf-frame sf-settings", root);

            var head = ScreenKit.El("sf-panel__head", frame);
            ScreenKit.Text("sf-panel__title", head, "设置", UIFontRole.Title);
            ScreenKit.Text("sf-panel__sub", head, "改动即时生效，并自动保存");

            var tabRow = ScreenKit.El("sf-tabs", frame);
            body = ScreenKit.Scroll("sf-settings__body", frame);

            // 按 GameSettings 的分组建页（登记顺序：操作 → 画面 → 声音），画面页先放显示模式 / 分辨率
            var groups = new List<string>();
            foreach (var d in GameSettings.All)
                if (!groups.Contains(d.group)) groups.Add(d.group);
            GeneratedControls = 0;
            foreach (var g in groups)
            {
                var page = AddTab(tabRow, g);
                foreach (var d in GameSettings.All)
                    if (d.group == g)
                    {
                        BuildControl(page, d);
                        GeneratedControls++;
                        if (d == GameSettings.DisplayMode) BuildResolution(page);
                    }
                if (g == GameSettings.GroupVideo)
                    ScreenKit.Text("sf-settings__note", page, "垂直同步开启时帧率上限不生效。画质：高 = 原生分辨率 + 全部效果；中 / 低降渲染比例（FSR 放大）、阴影和粒子。");
                if (g == GameSettings.GroupControls)
                    ScreenKit.Text("sf-settings__note", page, "手柄：右摇杆转视角，灵敏度与鼠标共用；按键在「按键」页里改。");
            }
            BuildKeys(AddTab(tabRow, KeysTab));

            var foot = ScreenKit.El("sf-panel__foot", frame);
            ScreenKit.Btn("恢复默认", "sf-btn--ghost", foot, () =>
            {
                if (tabs[current].name == KeysTab) GameInput.ResetBindings();
                else GameSettings.ResetAll();
                SyncAll();
                UISound.Play(UISound.ConfirmId);
            });
            ScreenKit.El("sf-grow", foot);
            ScreenKit.Text("sf-panel__hint", foot, "Q / E 切换页签");
            backBtn = ScreenKit.Btn("返回", "sf-btn--primary", foot, () => Close());
            Select(0);
            return root;
        }

        VisualElement AddTab(VisualElement row, string name)
        {
            int index = tabs.Count;
            var tab = ScreenKit.Card("sf-tab", row, () => Select(index));
            ScreenKit.Text("sf-tab__label", tab, name, UIFontRole.Title);
            var page = ScreenKit.El("sf-settings__page", body);
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
            body.scrollOffset = Vector2.zero;
        }

        /// <summary>按名字切页签（测试用）</summary>
        public bool Select(string name)
        {
            for (int k = 0; k < tabs.Count; k++)
                if (tabs[k].name == name)
                {
                    Select(k);
                    return true;
                }
            return false;
        }

        public override void OnOpen(object arg)
        {
            openedAt = Time.unscaledTime;
            if (arg is string tab) Select(tab);
            resolutions = null;
            SyncAll();
            GameSettings.Changed -= OnChanged;
            GameSettings.Changed += OnChanged;
        }

        public override void OnClose()
        {
            GameSettings.Changed -= OnChanged;
            rebinding = false;
        }

        void OnChanged(SettingDef d) => SyncAll();

        void SyncAll()
        {
            foreach (var s in syncs) s();
            SyncBindings();
            SyncResolution();
        }

        public override bool OnBack()
        {
            // 改键等按键中：Esc 交给改键操作取消；刚改完 / 刚取消的那一帧也吞掉，不连带关掉设置页
            return rebinding || Time.frameCount - rebindEndFrame <= 1;
        }

        public override bool OnNavigate(Vector2 direction)
        {
            if (rebinding) return true;
            if (direction.x != 0 && UIRouter.Focused == resolutionBtn && resolutionBtn != null)
            {
                StepResolution(direction.x > 0 ? 1 : -1);
                return true;
            }
            if (direction.x != 0)
                foreach (var (button, d) in steppers)
                    if (UIRouter.Focused == button)
                    {
                        StepChoice(d, direction.x > 0 ? 1 : -1);
                        UISound.Hover(button);
                        return true;
                    }
            return false;
        }

        void StepChoice(SettingDef d, int dir)
        {
            int n = d.options.Length;
            d.Set((d.Index + dir + n) % n);
        }

        public override void Tick(float dt)
        {
            float k = ScreenKit.EaseOut((Time.unscaledTime - openedAt) / 0.25f);
            frame.style.opacity = k;
            frame.style.translate = new Translate(0, 12 * (1 - k));
            if (rebinding) return;
            if (ScreenKit.PressedRaw(GameAction.SkillQ)) Select(current - 1);
            else if (ScreenKit.PressedRaw(GameAction.SkillE)) Select(current + 1);
        }

        // ───────────── 自动生成的控件 ─────────────

        VisualElement Row(VisualElement page, string label, out VisualElement ctrl)
        {
            var row = ScreenKit.El("sf-setting", page);
            ScreenKit.Text("sf-setting__label", row, label);
            ctrl = ScreenKit.El("sf-setting__ctrl", row);
            return row;
        }

        void BuildControl(VisualElement page, SettingDef d)
        {
            Row(page, d.label, out var ctrl);
            switch (d.type)
            {
                case SettingType.Float:
                {
                    var slider = new Slider(d.min, d.max) { name = "setting-" + d.key, value = d.Value };
                    slider.AddToClassList("sf-slider");
                    ctrl.Add(slider);
                    var val = ScreenKit.Text("sf-setting__val", ctrl, "", UIFontRole.Number);
                    slider.RegisterValueChangedCallback(e => GameSettings.Set(d, e.newValue));
                    if (d.group == GameSettings.GroupAudio)
                        slider.RegisterCallback<PointerCaptureOutEvent>(_ => UISound.Play(UISound.ConfirmId));
                    syncs.Add(() =>
                    {
                        slider.SetValueWithoutNotify(d.Value);
                        val.text = Display(d);
                    });
                    break;
                }
                case SettingType.Bool:
                {
                    var sw = ScreenKit.Card("sf-switch", ctrl, () => d.Set(!d.Bool));
                    sw.name = "setting-" + d.key;
                    ScreenKit.El("sf-switch__knob", sw);
                    var val = ScreenKit.Text("sf-setting__val", ctrl, "");
                    syncs.Add(() =>
                    {
                        sw.EnableInClassList("sf-switch--on", d.Bool);
                        val.text = d.Bool ? "开启" : "关闭";
                    });
                    break;
                }
                case SettingType.Choice when d.options != null && d.options.Length > 4:
                {
                    // 选项多（帧率上限 8 档）：步进器，点一下 / 手柄左右切
                    var step = ScreenKit.Card("sf-stepper", ctrl, () => StepChoice(d, 1));
                    step.name = "setting-" + d.key;
                    ScreenKit.Text("sf-stepper__arrow", step, "◀");
                    var val = ScreenKit.Text("sf-stepper__val", step, "", UIFontRole.Number);
                    ScreenKit.Text("sf-stepper__arrow", step, "▶");
                    steppers.Add((step, d));
                    syncs.Add(() => val.text = d.Display);
                    break;
                }
                default:
                {
                    var seg = ScreenKit.El("sf-seg", ctrl);
                    var opts = d.options ?? new string[0];
                    var buttons = new List<Button>();
                    for (int i = 0; i < opts.Length; i++)
                    {
                        int k = i;
                        var b = ScreenKit.Card("sf-seg__opt", seg, () => d.Set(k));
                        b.name = $"setting-{d.key}-{i}";
                        ScreenKit.Text("sf-seg__label", b, opts[i]);
                        buttons.Add(b);
                    }
                    syncs.Add(() =>
                    {
                        for (int i = 0; i < buttons.Count; i++) buttons[i].EnableInClassList("sf-seg__opt--on", d.Index == i);
                    });
                    break;
                }
            }
        }

        /// <summary>读数：视野 80°、灵敏度 1.25×，其余用设置项自己的显示</summary>
        static string Display(SettingDef d) => d.key switch
        {
            "fov" => $"{d.Value:0}°",
            "sensitivity" => $"{d.Value:0.00}×",
            "screenEffects" => d.Value <= 0.001f ? "关" : $"{d.Value * 100:0}%",
            _ => d.Display,
        };

        // ───────────── 分辨率（显示模式是自动生成的多选一）─────────────

        void BuildResolution(VisualElement page)
        {
            Row(page, "分辨率", out var rctrl);
            resolutionBtn = ScreenKit.Card("sf-stepper", rctrl, () => StepResolution(1));
            resolutionBtn.name = "setting-resolution";
            ScreenKit.Text("sf-stepper__arrow", resolutionBtn, "◀");
            ScreenKit.Text("sf-stepper__val", resolutionBtn, "", UIFontRole.Number).name = "value";
            ScreenKit.Text("sf-stepper__arrow", resolutionBtn, "▶");
        }

        List<Vector2Int> Resolutions()
        {
            if (resolutions != null) return resolutions;
            resolutions = new List<Vector2Int>();
            foreach (var r in Screen.resolutions)
            {
                var v = new Vector2Int(r.width, r.height);
                if (v.x >= 800 && !resolutions.Contains(v)) resolutions.Add(v);
            }
            var cur = GraphicsQuality.SavedResolution;
            if (!resolutions.Contains(cur)) resolutions.Add(cur);
            resolutions.Sort((a, b) => a.x != b.x ? a.x.CompareTo(b.x) : a.y.CompareTo(b.y));
            resolutionIndex = resolutions.IndexOf(cur);
            return resolutions;
        }

        void SyncResolution()
        {
            if (resolutionBtn == null) return;
            var list = Resolutions();
            if (resolutionIndex < 0 || resolutionIndex >= list.Count) resolutionIndex = list.Count - 1;
            var v = list[resolutionIndex];
            resolutionBtn.Q<Label>("value").text = $"{v.x} × {v.y}";
        }

        void StepResolution(int dir)
        {
            var list = Resolutions();
            if (list.Count == 0) return;
            resolutionIndex = (resolutionIndex + dir + list.Count) % list.Count;
            var v = list[resolutionIndex];
            // 存进设置（GraphicsQuality 跟着 Changed 切分辨率；编辑器里只存不切）
            GameSettings.ResolutionWidth.Set(v.x);
            GameSettings.ResolutionHeight.Set(v.y);
            UISound.Hover(resolutionBtn);
            SyncResolution();
        }

        // ───────────── 改键 ─────────────

        /// <summary>改键表里的动作和中文名（移动 / 视角是组合绑定，单独一行只显示）</summary>
        static readonly (GameAction action, string label)[] Actions =
        {
            (GameAction.Jump, "跳跃"), (GameAction.Dash, "冲刺"), (GameAction.Fire, "射击"), (GameAction.Aim, "瞄准"),
            (GameAction.Reload, "换弹"), (GameAction.Interact, "交互"), (GameAction.SkillQ, "主技能"), (GameAction.SkillE, "副技能"),
            (GameAction.WeaponSkill, "武器技能"), (GameAction.Weapon1, "一号武器"), (GameAction.Weapon2, "二号武器"), (GameAction.Swap, "切换武器"),
            (GameAction.PetSkill, "灵技"), (GameAction.Inventory, "行囊"), (GameAction.Map, "地图"), (GameAction.Pause, "暂停"),
        };

        void BuildKeys(VisualElement page)
        {
            var head = ScreenKit.El("sf-keys__row sf-keys__row--head", page);
            ScreenKit.Text("sf-keys__name", head, "动作");
            ScreenKit.Text("sf-keys__col", head, "键鼠");
            ScreenKit.Text("sf-keys__col", head, "手柄");
            var fixedRow = ScreenKit.El("sf-keys__row", page);
            ScreenKit.Text("sf-keys__name", fixedRow, "移动 / 视角");
            ScreenKit.Text("sf-keys__fixed", fixedRow, "W A S D · 鼠标");
            ScreenKit.Text("sf-keys__fixed", fixedRow, "左摇杆 · 右摇杆");
            foreach (var (action, label) in Actions)
            {
                var row = ScreenKit.El("sf-keys__row", page);
                ScreenKit.Text("sf-keys__name", row, label);
                foreach (var scheme in new[] { GameInput.KeyboardMouseScheme, GameInput.GamepadScheme })
                {
                    var a = action;
                    var s = scheme;
                    Button b = null;
                    b = ScreenKit.Card("sf-bind", row, () => Rebind(b, a, s));
                    b.name = $"bind-{action}-{scheme}";
                    ScreenKit.Text("sf-bind__label", b, "", UIFontRole.Number).name = "label";
                    bindButtons.Add((b, action, scheme));
                }
            }
            ScreenKit.Text("sf-settings__note", page, "点击按键框后按下新的键（Esc 取消）。「恢复默认」在本页恢复全部默认键位。");
        }

        static int BindingIndex(InputAction action, string scheme)
        {
            var mask = InputBinding.MaskByGroup(scheme);
            for (int i = 0; i < action.bindings.Count; i++)
            {
                var b = action.bindings[i];
                if (b.isComposite || b.isPartOfComposite) continue;
                if (mask.Matches(b)) return i;
            }
            return -1;
        }

        void SyncBindings()
        {
            foreach (var (button, action, scheme) in bindButtons)
            {
                var a = GameInput.Get(action);
                int i = BindingIndex(a, scheme);
                string text = i >= 0 ? a.GetBindingDisplayString(i) : "—";
                button.Q<Label>("label").text = string.IsNullOrEmpty(text) ? "—" : text;
                button.SetEnabled(i >= 0);
                button.RemoveFromClassList("sf-bind--waiting");
            }
        }

        void Rebind(Button b, GameAction action, string scheme)
        {
            // 改键刚结束的那一帧（回车 / A 既是新键又是「确认」）不重新开始
            if (rebinding || Time.frameCount - rebindEndFrame <= 2) return;
            int index = BindingIndex(GameInput.Get(action), scheme);
            if (index < 0) return;
            rebinding = true;
            b.AddToClassList("sf-bind--waiting");
            b.Q<Label>("label").text = "按下新按键…";
            GameInput.StartRebind(action, index, ok =>
            {
                rebinding = false;
                rebindEndFrame = Time.frameCount;
                UISound.Play(ok ? UISound.ConfirmId : UISound.ClickId);
                SyncBindings();
            });
        }
    }
}
