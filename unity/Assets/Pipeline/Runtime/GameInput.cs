using System;
using UnityEngine;
using UnityEngine.InputSystem;
using Object = UnityEngine.Object;

namespace Spiritfire.Art
{
    /// <summary>玩法动作（Gameplay 动作表）：同 Three.js Input.ts 的 Action，另加手柄</summary>
    public enum GameAction
    {
        Move, Look, Jump, Dash, Fire, Aim, Reload, Interact, SkillQ, SkillE, WeaponSkill,
        Weapon1, Weapon2, Swap, Pause, Inventory, PetSkill, Map,
    }

    /// <summary>界面动作（UI 动作表）：指针、点击、导航、确认 / 取消、三选一的 1 / 2 / 3</summary>
    public enum UIAction
    {
        Point, Click, Navigate, Submit, Cancel, Choice1, Choice2, Choice3,
    }

    /// <summary>
    /// 输入门面（docs/unity-parity.md D19 / 4.7）：Input System 动作全部在代码里定义（不需要 .inputactions 资产和生成的包装类），
    /// Gameplay + UI 两张表，键鼠和手柄各一套绑定（控制方案 KeyboardMouse / Gamepad）。
    /// 玩法代码只问这里：<see cref="Down(GameAction)"/>（按住）/ <see cref="Pressed(GameAction)"/>（这一帧按下）/ <see cref="Released(GameAction)"/>，
    /// <see cref="Move"/>、<see cref="LookDelta"/>（鼠标像素当量）、<see cref="PointerPosition"/>。
    /// 键鼠：WASD / 方向键 移动 · 鼠标 视角 · 空格 跳 · Shift 冲刺 · 左键 开火 · 右键 开镜 · R 换弹 · F 交互 · Q / E 技能 ·
    ///       V / 中键 武器技能 · 1 / 2 / X / 滚轮 切枪 · Esc / P 暂停 · Tab 背包 · G 灵技 · M 地图
    /// 手柄：左摇杆 移动 · 右摇杆 视角 · A 跳 · B 冲刺 · RT 开火 · LT 开镜 · X 换弹 · Y 交互 · LB / RB 技能 · 右摇杆按下 武器技能 ·
    ///       十字键 左 / 右 1 / 2 号枪、上 切枪、下 灵技 · Start 暂停 · Back 背包 · 左摇杆按下 地图
    /// 改键：<see cref="StartRebind"/>，结果（只存覆盖项）以 JSON 存进 PlayerPrefs，下次启动自动读回。
    /// 两张表一直开着（模态界面时由各系统自己判断要不要响应，同改造前）；切表留给 U1 的 UIRouter。
    /// </summary>
    public static class GameInput
    {
        public const string KeyboardMouseScheme = "KeyboardMouse", GamepadScheme = "Gamepad";
        const string PrefsKey = "spiritfire.input.bindings";

        /// <summary>右摇杆满推时的视角速度（鼠标像素当量 / 秒；视角 0.1°/像素 → 180°/s）</summary>
        public static float StickLookSpeed = 1800f;

        static InputActionAsset asset;
        static InputActionMap gameplay, ui;
        static InputAction[] game, menu;
        static InputAction lookStick, swapScroll;
        static InputActionRebindingExtensions.RebindingOperation rebinding;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            rebinding?.Dispose();
            rebinding = null;
            if (asset)
            {
                asset.Disable();
                Object.Destroy(asset);
            }
            asset = null;
            gameplay = ui = null;
            game = menu = null;
            lookStick = swapScroll = null;
        }

        /// <summary>进场景前就建好并启用动作表：第一帧的按键也算数</summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Boot() => Ensure();

        /// <summary>动作资产（调试 / 改键界面用）</summary>
        public static InputActionAsset Asset
        {
            get
            {
                Ensure();
                return asset;
            }
        }

        public static InputActionMap GameplayMap
        {
            get
            {
                Ensure();
                return gameplay;
            }
        }

        public static InputActionMap UIMap
        {
            get
            {
                Ensure();
                return ui;
            }
        }

        public static InputAction Get(GameAction a)
        {
            Ensure();
            return game[(int)a];
        }

        public static InputAction Get(UIAction a)
        {
            Ensure();
            return menu[(int)a];
        }

        // ───────────── 查询 ─────────────

        /// <summary>按住</summary>
        public static bool Down(GameAction a) => Get(a).IsPressed();

        /// <summary>这一帧按下（切枪也算滚轮滚了一格）</summary>
        public static bool Pressed(GameAction a) => Get(a).WasPressedThisFrame() || (a == GameAction.Swap && Mathf.Abs(swapScroll.ReadValue<float>()) > 0.1f);

        /// <summary>这一帧松开</summary>
        public static bool Released(GameAction a) => Get(a).WasReleasedThisFrame();

        public static bool Down(UIAction a) => Get(a).IsPressed();
        public static bool Pressed(UIAction a) => Get(a).WasPressedThisFrame();
        public static bool Released(UIAction a) => Get(a).WasReleasedThisFrame();

        /// <summary>移动（-1..1，斜向已归一）</summary>
        public static Vector2 Move => Get(GameAction.Move).ReadValue<Vector2>();

        /// <summary>这一帧的视角位移（鼠标像素当量：鼠标位移 + 右摇杆 × <see cref="StickLookSpeed"/> × 不缩放时间）。灵敏度 / 反转 Y 由 PlayerMotor 乘</summary>
        public static Vector2 LookDelta
        {
            get
            {
                var d = Get(GameAction.Look).ReadValue<Vector2>();
                var s = lookStick.ReadValue<Vector2>();
                if (s.sqrMagnitude > 0) d += s * (StickLookSpeed * Time.unscaledDeltaTime);
                return d;
            }
        }

        /// <summary>指针位置（屏幕像素）</summary>
        public static Vector2 PointerPosition
        {
            get
            {
                var p = Get(UIAction.Point).ReadValue<Vector2>();
                // 动作在没有指针事件之前读到的是 0：退回直接读鼠标
                if (p == Vector2.zero && Mouse.current != null) p = Mouse.current.position.ReadValue();
                return p;
            }
        }

        /// <summary>调试热键（DevCommands）：直接查某个键这一帧有没有按下（不走动作表，不能改键）</summary>
        public static bool KeyPressed(Key key)
        {
            var kb = Keyboard.current;
            return kb != null && key != Key.None && kb[key].wasPressedThisFrame;
        }

        /// <summary>按键提示文字（「F」「LMB」「Y」…）：取指定控制方案下的第一个绑定</summary>
        public static string BindingLabel(GameAction a, string scheme = KeyboardMouseScheme)
        {
            var action = Get(a);
            for (int i = 0; i < action.bindings.Count; i++)
            {
                var b = action.bindings[i];
                if (b.isComposite || b.isPartOfComposite) continue;
                if (!string.IsNullOrEmpty(scheme) && !InputBinding.MaskByGroup(scheme).Matches(b)) continue;
                var s = action.GetBindingDisplayString(i);
                if (!string.IsNullOrEmpty(s)) return s;
            }
            return a.ToString();
        }

        // ───────────── 改键 ─────────────

        /// <summary>
        /// 交互式改键：等玩家按一个键（Esc 取消），替换 action 的第 bindingIndex 个绑定，完成后自动保存。done(true) = 改了
        /// </summary>
        public static void StartRebind(GameAction a, int bindingIndex, Action<bool> done = null)
        {
            var action = Get(a);
            if (bindingIndex < 0 || bindingIndex >= action.bindings.Count)
            {
                done?.Invoke(false);
                return;
            }
            rebinding?.Cancel();
            bool wasEnabled = action.enabled;
            action.Disable();
            rebinding = action.PerformInteractiveRebinding(bindingIndex)
                .WithCancelingThrough("<Keyboard>/escape")
                .OnComplete(op => Finish(op, true))
                .OnCancel(op => Finish(op, false))
                .Start();

            void Finish(InputActionRebindingExtensions.RebindingOperation op, bool ok)
            {
                op.Dispose();
                if (rebinding == op) rebinding = null;
                if (wasEnabled) action.Enable();
                if (ok) SaveBindings();
                done?.Invoke(ok);
            }
        }

        /// <summary>改键结果（只含覆盖项）存进 PlayerPrefs</summary>
        public static void SaveBindings()
        {
            Ensure();
            PlayerPrefs.SetString(PrefsKey, asset.SaveBindingOverridesAsJson());
            PlayerPrefs.Save();
        }

        /// <summary>恢复默认键位（清掉存档里的覆盖项）</summary>
        public static void ResetBindings()
        {
            Ensure();
            asset.RemoveAllBindingOverrides();
            PlayerPrefs.DeleteKey(PrefsKey);
        }

        static void LoadBindings()
        {
            var json = PlayerPrefs.GetString(PrefsKey, "");
            if (string.IsNullOrEmpty(json)) return;
            try { asset.LoadBindingOverridesFromJson(json); }
            catch (Exception e) { Debug.LogWarning($"[GameInput] 改键存档读不了，用默认键位：{e.Message}"); }
        }

        // ───────────── 定义 ─────────────

        static void Ensure()
        {
            if (asset) return;
            asset = ScriptableObject.CreateInstance<InputActionAsset>();
            asset.name = "Spiritfire Input";
            asset.hideFlags = HideFlags.HideAndDontSave;
            asset.AddControlScheme(KeyboardMouseScheme).WithRequiredDevice("<Keyboard>").WithRequiredDevice("<Mouse>");
            asset.AddControlScheme(GamepadScheme).WithRequiredDevice("<Gamepad>");

            gameplay = asset.AddActionMap("Gameplay");
            game = new InputAction[Enum.GetValues(typeof(GameAction)).Length];
            const string K = KeyboardMouseScheme, G = GamepadScheme;

            var move = Value(GameAction.Move, "Vector2");
            foreach (var (up, down, left, right) in new[] { ("w", "s", "a", "d"), ("upArrow", "downArrow", "leftArrow", "rightArrow") })
                move.AddCompositeBinding("2DVector")
                    .With("Up", $"<Keyboard>/{up}", K).With("Down", $"<Keyboard>/{down}", K)
                    .With("Left", $"<Keyboard>/{left}", K).With("Right", $"<Keyboard>/{right}", K);
            move.AddBinding("<Gamepad>/leftStick", groups: G);

            Value(GameAction.Look, "Vector2").AddBinding("<Mouse>/delta", groups: K);
            // 右摇杆是「速度」不是「位移」，单独一个动作，LookDelta 里按帧时间换算后叠加
            lookStick = gameplay.AddAction("Look Stick", InputActionType.Value, expectedControlLayout: "Vector2");
            lookStick.AddBinding("<Gamepad>/rightStick", groups: G);

            Button(GameAction.Jump, "<Keyboard>/space", "<Gamepad>/buttonSouth");
            Button(GameAction.Dash, "<Keyboard>/leftShift", "<Gamepad>/buttonEast").AddBinding("<Keyboard>/rightShift", groups: K);
            Button(GameAction.Fire, "<Mouse>/leftButton", "<Gamepad>/rightTrigger");
            Button(GameAction.Aim, "<Mouse>/rightButton", "<Gamepad>/leftTrigger");
            Button(GameAction.Reload, "<Keyboard>/r", "<Gamepad>/buttonWest");
            Button(GameAction.Interact, "<Keyboard>/f", "<Gamepad>/buttonNorth");
            Button(GameAction.SkillQ, "<Keyboard>/q", "<Gamepad>/leftShoulder");
            Button(GameAction.SkillE, "<Keyboard>/e", "<Gamepad>/rightShoulder");
            Button(GameAction.WeaponSkill, "<Keyboard>/v", "<Gamepad>/rightStickPress").AddBinding("<Mouse>/middleButton", groups: K);
            Button(GameAction.Weapon1, "<Keyboard>/1", "<Gamepad>/dpad/left");
            Button(GameAction.Weapon2, "<Keyboard>/2", "<Gamepad>/dpad/right");
            Button(GameAction.Swap, "<Keyboard>/x", "<Gamepad>/dpad/up");
            Button(GameAction.Pause, "<Keyboard>/escape", "<Gamepad>/start").AddBinding("<Keyboard>/p", groups: K);
            Button(GameAction.Inventory, "<Keyboard>/tab", "<Gamepad>/select");
            Button(GameAction.PetSkill, "<Keyboard>/g", "<Gamepad>/dpad/down");
            Button(GameAction.Map, "<Keyboard>/m", "<Gamepad>/leftStickPress");
            // 滚轮切枪：滚轮是一个轴，滚动一格的那一帧算按下（Pressed(Swap) 里合并）
            swapScroll = gameplay.AddAction("Swap Scroll", InputActionType.Value, expectedControlLayout: "Axis");
            swapScroll.AddBinding("<Mouse>/scroll/y", groups: K);

            ui = asset.AddActionMap("UI");
            menu = new InputAction[Enum.GetValues(typeof(UIAction)).Length];
            UI(UIAction.Point, InputActionType.Value, "Vector2").AddBinding("<Mouse>/position", groups: K);
            UI(UIAction.Click, InputActionType.Button).AddBinding("<Mouse>/leftButton", groups: K);
            var nav = UI(UIAction.Navigate, InputActionType.PassThrough, "Vector2");
            nav.AddCompositeBinding("2DVector")
                .With("Up", "<Keyboard>/upArrow", K).With("Down", "<Keyboard>/downArrow", K)
                .With("Left", "<Keyboard>/leftArrow", K).With("Right", "<Keyboard>/rightArrow", K);
            nav.AddBinding("<Gamepad>/dpad", groups: G);
            nav.AddBinding("<Gamepad>/leftStick", groups: G);
            var submit = UI(UIAction.Submit, InputActionType.Button);
            submit.AddBinding("<Keyboard>/enter", groups: K);
            submit.AddBinding("<Gamepad>/buttonSouth", groups: G);
            var cancel = UI(UIAction.Cancel, InputActionType.Button);
            cancel.AddBinding("<Keyboard>/escape", groups: K);
            cancel.AddBinding("<Gamepad>/buttonEast", groups: G);
            UI(UIAction.Choice1, InputActionType.Button).AddBinding("<Keyboard>/1", groups: K);
            UI(UIAction.Choice2, InputActionType.Button).AddBinding("<Keyboard>/2", groups: K);
            UI(UIAction.Choice3, InputActionType.Button).AddBinding("<Keyboard>/3", groups: K);

            LoadBindings();
            asset.Enable();
        }

        static InputAction Value(GameAction a, string layout)
        {
            var action = gameplay.AddAction(a.ToString(), InputActionType.Value, expectedControlLayout: layout);
            game[(int)a] = action;
            return action;
        }

        static InputAction Button(GameAction a, string keyboardMouse, string gamepad)
        {
            var action = gameplay.AddAction(a.ToString(), InputActionType.Button);
            action.AddBinding(keyboardMouse, groups: KeyboardMouseScheme);
            action.AddBinding(gamepad, groups: GamepadScheme);
            game[(int)a] = action;
            return action;
        }

        static InputAction UI(UIAction a, InputActionType type, string layout = null)
        {
            var action = ui.AddAction(a.ToString(), type, expectedControlLayout: layout);
            menu[(int)a] = action;
            return action;
        }
    }
}
