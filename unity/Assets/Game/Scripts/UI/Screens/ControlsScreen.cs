using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 操作说明（U5；Three.js MainMenu.buildControls + labels.ts CONTROLS）：每个动作一行，键鼠一列、手柄一列——
    /// 键位从 <see cref="GameInput"/> 的当前绑定现取（改过键就显示改后的），不像 Three.js 那样写死在文案表里。
    /// 底下两条要诀（爆头即暴击、前摇与地面预警；清关开出口）。「改键」直接打开设置的「按键」页。主菜单里打开，不挡游戏。
    /// </summary>
    [UIScreen(ScreenId)]
    public sealed class ControlsScreen : UIScreen
    {
        public const string ScreenId = "controls";

        public override string Id => ScreenId;
        public override GameState? BlockState => null;
        public override bool FreezeTime => false;

        /// <summary>说明表：动作、说明（null = 移动 / 视角这类组合绑定，用 fixedKeys）</summary>
        static readonly (GameAction? action, string label, string fixedKb, string fixedPad)[] Rows =
        {
            (null, "移动", "W A S D", "左摇杆"),
            (null, "视角", "鼠标", "右摇杆"),
            (GameAction.Jump, "跳跃（部分英雄可二段跳）", null, null),
            (GameAction.Dash, "冲刺（有充能与冷却）", null, null),
            (GameAction.Fire, "射击", null, null),
            (GameAction.Aim, "瞄准（缩放视野、降低散布）", null, null),
            (GameAction.Reload, "换弹", null, null),
            (GameAction.Swap, "切换武器（也可 1 / 2、滚轮）", null, null),
            (GameAction.SkillQ, "主技能（长冷却）", null, null),
            (GameAction.SkillE, "副技能（多充能投掷类）", null, null),
            (GameAction.WeaponSkill, "武器技能", null, null),
            (GameAction.PetSkill, "灵技（结契灵宠后）", null, null),
            (GameAction.Interact, "交互：拾取武器、开宝箱、购买、结契、进入出口", null, null),
            (GameAction.Inventory, "行囊：秘卷、属性、武器、灵宠", null, null),
            (GameAction.Pause, "暂停", null, null),
        };

        VisualElement frame, list;
        Button backBtn;
        float openedAt;

        public override VisualElement DefaultFocus => backBtn;

        protected override VisualElement Build()
        {
            var root = new VisualElement { name = "controls" };
            ScreenKit.Style(root, ScreenKit.ScreensStyle);
            ScreenKit.Style(root, ScreenKit.MenuStyle);
            ScreenKit.El("sf-backdrop sf-menu-sub__backdrop", root);
            frame = ScreenKit.El("sf-frame sf-controls", root);
            var head = ScreenKit.El("sf-panel__head", frame);
            ScreenKit.Text("sf-panel__title", head, "操作说明", UIFontRole.Title);
            ScreenKit.Text("sf-panel__sub", head, "键位随设置里的改键实时变化；Esc / 手柄 Start 暂停并放开鼠标。");
            var cols = ScreenKit.El("sf-controls__row sf-controls__row--head", frame);
            ScreenKit.Text("sf-controls__action", cols, "动作");
            ScreenKit.Text("sf-controls__keys", cols, "键鼠");
            ScreenKit.Text("sf-controls__keys", cols, "手柄");
            list = ScreenKit.El("sf-controls__list", ScreenKit.Scroll("sf-controls__scroll", frame));
            var tips = ScreenKit.El("sf-controls__tips", frame);
            ScreenKit.Text("sf-controls__tip", tips, "爆头即暴击。敌人的强力攻击都有前摇与地面预警，留意并闪避。");
            ScreenKit.Text("sf-controls__tip", tips, "肃清据点后开启出口；途中留意宝箱、灵兽封印与补给营，地图是开放的，据点顺序随你。");
            var foot = ScreenKit.El("sf-panel__foot", frame);
            ScreenKit.Btn("改键", "sf-btn--ghost", foot, () => UIRouter.Open(SettingsScreen.ScreenId, SettingsScreen.KeysTab));
            ScreenKit.El("sf-grow", foot);
            backBtn = ScreenKit.Btn("返回", "sf-btn--primary", foot, () => Close());
            return root;
        }

        public override void OnOpen(object arg)
        {
            openedAt = Time.unscaledTime;
            Rebuild();
            UIRouter.Closed -= OnClosed;
            UIRouter.Closed += OnClosed;
        }

        public override void OnClose() => UIRouter.Closed -= OnClosed;

        // 从「改键」回来：按新键位重建
        void OnClosed(IScreen s)
        {
            if (s is SettingsScreen) Rebuild();
        }

        void Rebuild()
        {
            list.Clear();
            foreach (var (action, label, fixedKb, fixedPad) in Rows)
            {
                var row = ScreenKit.El("sf-controls__row", list);
                ScreenKit.Text("sf-controls__action", row, label);
                // 组合绑定（移动 / 视角）按空格拆成几个键帽；其余是一个绑定一个键帽（「Left Shift」不拆）
                Keys(row, action is { } a ? new[] { ScreenKit.KeyLabel(a) } : fixedKb.Split(' '));
                Keys(row, action is { } b ? new[] { ScreenKit.KeyLabel(b, GameInput.GamepadScheme) } : fixedPad.Split(' '));
            }
        }

        static void Keys(VisualElement row, string[] keys)
        {
            var cell = ScreenKit.El("sf-controls__keys", row);
            foreach (var k in keys)
                if (!string.IsNullOrEmpty(k))
                    ScreenKit.Text(UITheme.Key + " sf-controls__key", cell, k, UIFontRole.Number);
        }

        public override void Tick(float dt)
        {
            float k = ScreenKit.EaseOut((Time.unscaledTime - openedAt) / 0.28f);
            frame.style.opacity = k;
            frame.style.translate = new Translate(0, 14 * (1 - k));
        }
    }
}
