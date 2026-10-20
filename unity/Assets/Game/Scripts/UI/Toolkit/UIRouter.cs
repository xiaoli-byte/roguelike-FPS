using System;
using System.Collections.Generic;
using System.Reflection;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Scripting;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一个界面（暂停、设置、三选一、主菜单、结算…，docs/unity-parity.md 4.8）。一般继承 <see cref="UIScreen"/>；
    /// 类上标 [UIScreen("id")] 且有无参构造函数就自动登记，<see cref="UIRouter.Open(string, object)"/> 按 id 打开。
    /// </summary>
    public interface IScreen
    {
        /// <summary>路由 id（如 pause、settings、scroll-choice）</summary>
        string Id { get; }
        /// <summary>挂在哪一层（缺省界面层 Modal）</summary>
        UILayer Layer { get; }
        /// <summary>打开时压进 <see cref="GameStateMachine"/> 的状态（Modal / Paused / Summary…）；null = 不挡游戏（不放鼠标、不停时间）</summary>
        GameState? BlockState { get; }
        /// <summary>挡游戏时是否同时停住时间</summary>
        bool FreezeTime { get; }
        /// <summary>建界面（每个实例只调一次，之后复用）</summary>
        VisualElement CreateRoot();
        /// <summary>打开（每次都调；arg = Open 的参数）</summary>
        void OnOpen(object arg);
        /// <summary>关上（从栈里拿掉之后）</summary>
        void OnClose();
        /// <summary>返回键（Esc / 手柄 B）：自己处理了（如收起子面板）返回 true，否则路由关掉这个界面</summary>
        bool OnBack();
        /// <summary>在栈顶时每帧调用（不缩放时间）</summary>
        void Tick(float unscaledDeltaTime);
        /// <summary>打开后先聚焦的元素（null = 第一个可聚焦元素）</summary>
        VisualElement DefaultFocus { get; }
        /// <summary>方向键 / 摇杆：自己处理了返回 true，否则路由按空间位置移动焦点</summary>
        bool OnNavigate(Vector2 direction);
    }

    /// <summary>界面登记：[UIScreen("pause")] 标在 <see cref="IScreen"/> 的实现类上（继承 PreserveAttribute，IL2CPP 裁剪时保留）</summary>
    [AttributeUsage(AttributeTargets.Class, Inherited = false)]
    public sealed class UIScreenAttribute : PreserveAttribute
    {
        public string Id { get; }
        public UIScreenAttribute(string id) => Id = id;
    }

    /// <summary>界面基类：缺省在界面层、挡游戏（Modal）并停时间，返回键关自己；子类只写 <see cref="Build"/> 和需要的钩子</summary>
    public abstract class UIScreen : IScreen
    {
        public abstract string Id { get; }
        public virtual UILayer Layer => UILayer.Modal;
        public virtual GameState? BlockState => GameState.Modal;
        public virtual bool FreezeTime => true;
        public virtual VisualElement DefaultFocus => null;
        /// <summary>界面根元素（<see cref="Build"/> 的结果；打开过一次之后才有）</summary>
        public VisualElement Root { get; private set; }
        /// <summary>在栈里（打开着）</summary>
        public bool IsOpen => UIRouter.IsOpen(this);

        public VisualElement CreateRoot()
        {
            Root = Build();
            Root.AddToClassList(UITheme.Screen);
            return Root;
        }

        /// <summary>建界面：返回根元素（铺满全屏的 .sf-screen 由基类加上类名）</summary>
        protected abstract VisualElement Build();
        public virtual void OnOpen(object arg) { }
        public virtual void OnClose() { }
        public virtual bool OnBack() => false;
        public virtual void Tick(float unscaledDeltaTime) { }
        public virtual bool OnNavigate(Vector2 direction) => false;
        /// <summary>关掉自己</summary>
        public void Close() => UIRouter.Close(this);
    }

    /// <summary>
    /// 界面路由（docs/unity-parity.md 4.8 / U1）：<see cref="Open(string, object)"/> / <see cref="Close(IScreen)"/> / <see cref="Back"/> 管一个界面栈。
    ///   · 挡游戏的界面（<see cref="IScreen.BlockState"/> 非空）打开时压 <see cref="GameStateMachine"/>（owner = 界面实例，按需停时间，
    ///     GameSession 跟着放开鼠标、关玩家输入），关上时弹出；同时关掉 GameInput 的 Gameplay 动作表（只在有这类界面时）。
    ///   · 输入走 <see cref="GameInput"/> 的 UI 动作表（可改键、键鼠 + 手柄）：Navigate 按空间位置移焦点（按住 0.4 s 后每 0.11 s 连发），
    ///     Submit 激活焦点元素（按钮 / 开关…，并出按钮音），Cancel = <see cref="Back"/>；滑条在左右方向上直接调值。
    ///     UI Toolkit 自带的导航事件在界面层被拦下（否则方向键 / 回车会被处理两次）。
    ///   · 鼠标照常：UI Toolkit 自己处理指针，按钮音由 <see cref="UISound"/> 全局挂上。
    /// 测试接口：<see cref="IsOpen(string)"/>、<see cref="Top"/>、<see cref="Focused"/>、<see cref="Submit"/>、<see cref="Navigate"/>。
    /// 现有的 uGUI 界面（PauseMenu / ScrollChoice）还没迁过来（U4 / S7），它们自己压 GameStateMachine，不经过这里。
    /// </summary>
    public static class UIRouter
    {
        sealed class Entry
        {
            public IScreen screen;
            public VisualElement root;
            public Focusable restoreFocus;
            public bool focusPending;
            public int focusTries;
        }

        const float RepeatDelay = 0.4f, RepeatInterval = 0.11f, Deadzone = 0.5f;

        static readonly List<Entry> stack = new();
        static readonly Dictionary<IScreen, VisualElement> roots = new();
        static readonly Dictionary<string, IScreen> instances = new(StringComparer.Ordinal);
        static Dictionary<string, Type> types;
        static bool gameplayDisabled;
        static Vector2Int heldDir;
        static float nextRepeat;
        static EventBase synthesized;

        /// <summary>打开 / 关上界面时（打开在 OnOpen 之后，关上在 OnClose 之后）</summary>
        public static event Action<IScreen> Opened, Closed;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            stack.Clear();
            roots.Clear();
            instances.Clear();
            types = null;
            gameplayDisabled = false;
            heldDir = default;
            synthesized = null;
            Opened = Closed = null;
        }

        // ───────────── 查询 ─────────────

        /// <summary>栈顶界面（没有为 null）</summary>
        public static IScreen Top => stack.Count > 0 ? stack[stack.Count - 1].screen : null;
        public static int Count => stack.Count;
        /// <summary>有挡游戏的界面开着</summary>
        public static bool Blocking
        {
            get
            {
                foreach (var e in stack)
                    if (e.screen.BlockState != null) return true;
                return false;
            }
        }

        public static bool IsOpen(IScreen screen) => IndexOf(screen) >= 0;
        public static bool IsOpen(string id) => Find(id) != null;

        /// <summary>栈里 id 对应的界面（没打开为 null）</summary>
        public static IScreen Find(string id)
        {
            for (int i = stack.Count - 1; i >= 0; i--)
                if (stack[i].screen.Id == id) return stack[i].screen;
            return null;
        }

        /// <summary>界面层当前的焦点元素</summary>
        public static Focusable Focused
        {
            get
            {
                var root = UIRoot.Instance ? UIRoot.Instance.Document(UILayer.Modal)?.rootVisualElement : null;
                return root?.focusController?.focusedElement;
            }
        }

        /// <summary>已登记的界面 id（[UIScreen] 扫描 + <see cref="Register"/>）</summary>
        public static IEnumerable<string> Ids
        {
            get
            {
                EnsureTypes();
                var set = new SortedSet<string>(types.Keys, StringComparer.Ordinal);
                foreach (var k in instances.Keys) set.Add(k);
                return set;
            }
        }

        // ───────────── 登记 ─────────────

        /// <summary>手动登记一个界面实例（不用 [UIScreen] 时）；同 id 覆盖</summary>
        public static void Register(IScreen screen)
        {
            if (screen == null || string.IsNullOrEmpty(screen.Id)) return;
            instances[screen.Id] = screen;
        }

        static void EnsureTypes()
        {
            if (types != null) return;
            types = new Dictionary<string, Type>(StringComparer.Ordinal);
            Type[] all;
            try { all = typeof(UIRouter).Assembly.GetTypes(); }
            catch (ReflectionTypeLoadException e) { all = Array.FindAll(e.Types, t => t != null); }
            foreach (var t in all)
            {
                if (t.IsAbstract || !typeof(IScreen).IsAssignableFrom(t) || t.GetConstructor(Type.EmptyTypes) == null) continue;
                var attr = t.GetCustomAttribute<UIScreenAttribute>(false);
                if (attr == null || string.IsNullOrEmpty(attr.Id)) continue;
                if (types.TryGetValue(attr.Id, out var other)) Debug.LogError($"[UI] 界面 id「{attr.Id}」重复：{other.FullName} 和 {t.FullName}，后一个忽略");
                else types[attr.Id] = t;
            }
        }

        /// <summary>按 id 取界面实例（每个 id 一个实例，第一次用时 new）；没登记为 null</summary>
        public static IScreen Get(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            if (instances.TryGetValue(id, out var s)) return s;
            EnsureTypes();
            if (!types.TryGetValue(id, out var t)) return null;
            s = (IScreen)Activator.CreateInstance(t);
            instances[id] = s;
            return s;
        }

        // ───────────── 开 / 关 ─────────────

        /// <summary>按 id 打开（已经开着就提到栈顶并再调一次 OnOpen）；没登记返回 false</summary>
        public static bool Open(string id, object arg = null)
        {
            var s = Get(id);
            if (s == null)
            {
                Debug.LogError($"[UI] 没有登记界面「{id}」");
                return false;
            }
            return Open(s, arg);
        }

        /// <summary>打开一个界面实例</summary>
        public static bool Open(IScreen screen, object arg = null)
        {
            var ui = UIRoot.Ensure();
            if (screen == null || !ui) return false;
            if (!roots.TryGetValue(screen, out var root) || root == null)
            {
                root = screen.CreateRoot();
                if (root == null) return false;
                roots[screen] = root;
            }
            int existing = IndexOf(screen);
            Focusable restore = Focused;
            if (existing >= 0)
            {
                restore = stack[existing].restoreFocus;
                stack.RemoveAt(existing);
            }
            var layerRoot = ui.Layer(screen.Layer);
            if (root.parent != layerRoot) layerRoot.Add(root);
            root.BringToFront();
            root.style.display = DisplayStyle.Flex;
            var entry = new Entry { screen = screen, root = root, restoreFocus = restore, focusPending = true };
            stack.Add(entry);
            if (screen.BlockState is GameState state) GameStateMachine.Push(screen, state, screen.FreezeTime);
            heldDir = default;
            UpdateInputMaps();
            screen.OnOpen(arg);
            Opened?.Invoke(screen);
            return true;
        }

        public static bool Close(string id)
        {
            var s = Find(id);
            return s != null && Close(s);
        }

        /// <summary>关掉一个界面（不必在栈顶）；没开着返回 false</summary>
        public static bool Close(IScreen screen)
        {
            int i = IndexOf(screen);
            if (i < 0) return false;
            var entry = stack[i];
            bool wasTop = i == stack.Count - 1;
            stack.RemoveAt(i);
            entry.root.style.display = DisplayStyle.None;
            entry.root.RemoveFromHierarchy();
            if (screen.BlockState != null) GameStateMachine.Pop(screen);
            UpdateInputMaps();
            screen.OnClose();
            if (wasTop && stack.Count > 0)
            {
                // 焦点回到下面那个界面里打开它之前的元素
                var top = stack[stack.Count - 1];
                if (entry.restoreFocus is VisualElement v && v.panel != null && top.root.Contains(v)) v.Focus();
                else top.focusPending = true;
            }
            else if (wasTop) (Focused as VisualElement)?.Blur();
            Closed?.Invoke(screen);
            return true;
        }

        /// <summary>返回：栈顶界面先自己处理（OnBack），不处理就关掉它。栈空返回 false</summary>
        public static bool Back()
        {
            var top = Top;
            if (top == null) return false;
            if (!top.OnBack()) Close(top);
            UISound.Play(UISound.ClickId);
            return true;
        }

        /// <summary>全部关掉（换场景、回主菜单）</summary>
        public static void CloseAll()
        {
            for (int i = stack.Count - 1; i >= 0; i--)
                if (i < stack.Count) Close(stack[i].screen);
        }

        static int IndexOf(IScreen screen)
        {
            for (int i = stack.Count - 1; i >= 0; i--)
                if (ReferenceEquals(stack[i].screen, screen)) return i;
            return -1;
        }

        /// <summary>有挡游戏的界面时关掉 Gameplay 动作表（只恢复自己关的）</summary>
        static void UpdateInputMaps()
        {
            bool block = Blocking;
            if (block && !gameplayDisabled)
            {
                var map = GameInput.GameplayMap;
                if (map.enabled)
                {
                    map.Disable();
                    gameplayDisabled = true;
                }
            }
            else if (!block && gameplayDisabled)
            {
                GameInput.GameplayMap.Enable();
                gameplayDisabled = false;
            }
        }

        // ───────────── 输入（UIRoot 每帧调）─────────────

        /// <summary>每帧（不缩放时间）：栈顶界面的 Tick、等待中的聚焦、UI 动作表的导航 / 确认 / 返回</summary>
        internal static void Tick(float dt)
        {
            if (stack.Count == 0)
            {
                heldDir = default;
                return;
            }
            var entry = stack[stack.Count - 1];
            if (entry.root.panel == null) return;
            if (entry.focusPending) TryInitialFocus(entry);
            entry.screen.Tick(dt);
            if (stack.Count == 0 || stack[stack.Count - 1] != entry) return;

            if (GameInput.Pressed(UIAction.Cancel))
            {
                Back();
                return;
            }
            if (GameInput.Pressed(UIAction.Submit))
            {
                Submit();
                return;
            }
            var v = GameInput.Get(UIAction.Navigate).ReadValue<Vector2>();
            var dir = Mathf.Abs(v.x) >= Mathf.Abs(v.y)
                ? new Vector2Int(Mathf.Abs(v.x) > Deadzone ? (int)Mathf.Sign(v.x) : 0, 0)
                : new Vector2Int(0, Mathf.Abs(v.y) > Deadzone ? (int)Mathf.Sign(v.y) : 0);
            float now = Time.unscaledTime;
            if (dir == Vector2Int.zero)
            {
                heldDir = default;
                return;
            }
            if (dir != heldDir)
            {
                heldDir = dir;
                nextRepeat = now + RepeatDelay;
                Navigate(dir);
            }
            else if (now >= nextRepeat)
            {
                nextRepeat = now + RepeatInterval;
                Navigate(dir);
            }
        }

        static void TryInitialFocus(Entry entry)
        {
            // 新加进面板的元素要等一帧样式解析完才能拿焦点：拿不到就下一帧再试（最多 10 帧）
            var target = entry.screen.DefaultFocus;
            if (target == null || !CanFocus(target)) target = FirstFocusable(entry.root);
            if (target != null && CanFocus(target))
            {
                target.Focus();
                entry.focusPending = false;
            }
            else if (++entry.focusTries > 10) entry.focusPending = false;
        }

        /// <summary>激活焦点元素（手柄 A / 回车）：发一个 NavigationSubmitEvent 给它（按钮点击、开关切换都走它自己的处理），并出按钮音</summary>
        public static bool Submit()
        {
            if (!(Focused is VisualElement v) || v.panel == null || !IsInTop(v)) return false;
            UISound.Click(UISound.ButtonOf(v) ?? v);
            if (!v.enabledInHierarchy) return false;
            using var e = NavigationSubmitEvent.GetPooled();
            e.target = v;
            synthesized = e;
            v.SendEvent(e);
            synthesized = null;
            return true;
        }

        /// <summary>方向导航：界面自己先处理；滑条左右直接调值；否则按空间位置把焦点移到那个方向最近的元素（到头了绕回另一端）</summary>
        public static bool Navigate(Vector2Int dir)
        {
            var top = stack.Count > 0 ? stack[stack.Count - 1] : null;
            if (top == null || dir == Vector2Int.zero) return false;
            var d = new Vector2(dir.x, dir.y);
            if (top.screen.OnNavigate(d)) return true;
            var current = Focused as VisualElement;
            if (current != null && !IsInTop(current)) current = null;
            if (current != null && dir.y == 0 && Nudge(current, dir.x)) return true;
            var next = current == null ? FirstFocusable(top.root) : Spatial(top.root, current, d);
            if (next == null || next == current) return false;
            next.Focus();
            UISound.Hover(next);
            return true;
        }

        /// <summary>焦点在滑条（或滑条内部的拖动区）上时左右直接调值：每次 1/20 量程</summary>
        static bool Nudge(VisualElement focused, int sign)
        {
            VisualElement e = focused;
            while (e != null && !(e is Slider) && !(e is SliderInt)) e = e.parent;
            switch (e)
            {
                case Slider s:
                    s.value = Mathf.Clamp(s.value + sign * (s.highValue - s.lowValue) / 20f, Mathf.Min(s.lowValue, s.highValue), Mathf.Max(s.lowValue, s.highValue));
                    UISound.Hover(s);
                    return true;
                case SliderInt si:
                    int step = Mathf.Max(1, Mathf.Abs(si.highValue - si.lowValue) / 20);
                    si.value = Mathf.Clamp(si.value + sign * step, Mathf.Min(si.lowValue, si.highValue), Mathf.Max(si.lowValue, si.highValue));
                    UISound.Hover(si);
                    return true;
            }
            return false;
        }

        static bool IsInTop(VisualElement v) => stack.Count > 0 && stack[stack.Count - 1].root.Contains(v);

        static bool CanFocus(VisualElement e) =>
            e != null && e.panel != null && e.focusable && e.canGrabFocus && e.enabledInHierarchy && e.tabIndex >= 0 &&
            e.resolvedStyle.display != DisplayStyle.None && e.resolvedStyle.visibility == Visibility.Visible && e.worldBound.width > 0 && e.worldBound.height > 0;

        static readonly List<VisualElement> candidates = new();
        static readonly HashSet<VisualElement> candidateSet = new();

        /// <summary>可聚焦元素（文档顺序）；复合控件（滑条等）只算最外层那个，它内部可聚焦的子元素不单独占一格</summary>
        static void Collect(VisualElement root)
        {
            candidates.Clear();
            candidateSet.Clear();
            root.Query<VisualElement>().ForEach(e =>
            {
                if (!CanFocus(e)) return;
                for (var p = e.parent; p != null && p != root; p = p.parent)
                    if (candidateSet.Contains(p)) return;
                candidates.Add(e);
                candidateSet.Add(e);
            });
        }

        /// <summary>第一个可聚焦元素（文档顺序）</summary>
        public static VisualElement FirstFocusable(VisualElement root)
        {
            Collect(root);
            return candidates.Count > 0 ? candidates[0] : null;
        }

        /// <summary>
        /// 空间导航：方向上（屏幕坐标 y 向下，所以 dir.y = 1 是向上）中心点在前方的候选里，取「前进距离 + 2 × 横向偏移」最小的；
        /// 前方没有就绕回：取反方向最远、横向偏移最小的
        /// </summary>
        static VisualElement Spatial(VisualElement root, VisualElement from, Vector2 dir)
        {
            Collect(root);
            var screenDir = new Vector2(dir.x, -dir.y);
            var c0 = from.worldBound.center;
            VisualElement best = null, wrap = null;
            float bestScore = float.MaxValue, wrapScore = float.MaxValue;
            foreach (var e in candidates)
            {
                if (e == from) continue;
                var delta = e.worldBound.center - c0;
                float along = Vector2.Dot(delta, screenDir);
                float across = Mathf.Abs(screenDir.x != 0 ? delta.y : delta.x);
                if (along > 1f)
                {
                    float score = along + across * 2f;
                    if (score < bestScore)
                    {
                        bestScore = score;
                        best = e;
                    }
                }
                else if (along < -1f)
                {
                    float score = along + across * 2f; // 越负越远
                    if (score < wrapScore)
                    {
                        wrapScore = score;
                        wrap = e;
                    }
                }
            }
            return best ?? wrap;
        }

        // ───────────── 拦截 UI Toolkit 自带的导航（UIRoot 挂在界面层上）─────────────

        /// <summary>
        /// 界面层根元素的下沉阶段：栈里有界面时，拦下 UI Toolkit 自己从键盘 / 手柄生成的导航事件（移动 / 确认 / 取消），
        /// 改由 <see cref="Tick"/> 按 GameInput 处理；路由自己发的确认事件放行
        /// </summary>
        internal static void InstallNavigationFilter(VisualElement layerRoot)
        {
            layerRoot.RegisterCallback<NavigationMoveEvent>(Filter, TrickleDown.TrickleDown);
            layerRoot.RegisterCallback<NavigationSubmitEvent>(Filter, TrickleDown.TrickleDown);
            layerRoot.RegisterCallback<NavigationCancelEvent>(Filter, TrickleDown.TrickleDown);
        }

        static void Filter(EventBase evt)
        {
            if (stack.Count == 0 || ReferenceEquals(evt, synthesized)) return;
            evt.StopPropagation();
            (evt.target as VisualElement)?.focusController?.IgnoreEvent(evt);
        }
    }
}
