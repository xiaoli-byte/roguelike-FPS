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
    /// HUD 组件登记（docs/unity-parity.md 4.8 / U2）：标在 <see cref="HudWidget"/> 的子类上、有无参构造函数就自动登记，
    /// <see cref="Hud"/> 起来时每个 id 建一个实例挂进对应的 UI Toolkit 层。加一个 HUD 部件 = 加一个文件，不用改 Hud。
    /// Order：同一层里的叠放顺序（小的在下）——敌人头顶血条 0、伤害数字 5、受击暗角 10、准星 40、四角 50、提示卡 60。
    /// 继承 PreserveAttribute：IL2CPP 裁剪时保留。
    /// </summary>
    [AttributeUsage(AttributeTargets.Class, Inherited = false)]
    public sealed class HudWidgetAttribute : PreserveAttribute
    {
        public string Id { get; }
        /// <summary>同层叠放顺序（小的在下）</summary>
        public int Order { get; set; } = 50;
        /// <summary>挂在哪一层（缺省 HUD 层；中央大字这类要盖过闪光的放 Overlay）</summary>
        public UILayer Layer { get; set; } = UILayer.Hud;

        public HudWidgetAttribute(string id) => Id = id;
    }

    /// <summary>每帧传给 HUD 组件的时间：缩放时间（跟着暂停 / 顿帧停的：伤害数字、头顶血条）与不缩放时间（界面动画：闪光、提示卡）</summary>
    public readonly struct HudFrame
    {
        public readonly float dt, unscaledDt, time, unscaledTime;
        public readonly int frame;
        /// <summary>游戏在跑（没有暂停 / 模态界面）</summary>
        public readonly bool playing;

        public HudFrame(float dt, float unscaledDt, float time, float unscaledTime, int frame, bool playing)
        {
            this.dt = dt;
            this.unscaledDt = unscaledDt;
            this.time = time;
            this.unscaledTime = unscaledTime;
            this.frame = frame;
            this.playing = playing;
        }
    }

    /// <summary>
    /// 一个 HUD 部件（生命条、武器槽、准星、伤害数字…）：<see cref="Build"/> 建元素树（每个实例一次），<see cref="Tick"/> 每帧刷新（只写变化了的样式），
    /// <see cref="OnAttach"/> / <see cref="OnDetach"/> 里成对订阅 / 退订事件。<see cref="ResetState"/> 在换玩家（换关、重来）时调用：清掉瞬态（池、指示器、缓存）。
    /// 元素一律不接指针（HUD 层整层不挡点击）：用 <see cref="HudArt"/> 的工厂建元素。
    /// 一个部件抛异常只报一次，不影响其他部件（同 Three.js HUD.fail）。
    /// </summary>
    public abstract class HudWidget
    {
        public string Id { get; internal set; }
        public UILayer Layer { get; internal set; }
        public int Order { get; internal set; }
        /// <summary>根元素（<see cref="Build"/> 的结果）</summary>
        public VisualElement Root { get; private set; }
        protected HudContext Ctx { get; private set; }

        /// <summary>样式表（Resources 路径，不带扩展名）：宿主把每个部件声明的样式表加到层容器上（同一张只加一次）</summary>
        public virtual string StyleSheet => HudArt.HudStyle;

        /// <summary>显示 / 隐藏整个部件（display）</summary>
        public bool Visible
        {
            get => Root != null && Root.resolvedStyle.display != DisplayStyle.None && Root.style.display != DisplayStyle.None;
            set
            {
                if (Root == null) return;
                var d = value ? DisplayStyle.Flex : DisplayStyle.None;
                if (Root.style.display != d) Root.style.display = d;
            }
        }

        internal void Attach(HudContext ctx, VisualElement parent)
        {
            Ctx = ctx;
            Root = Build() ?? HudArt.El("sf-widget");
            if (string.IsNullOrEmpty(Root.name)) Root.name = "hud-" + Id;
            Root.pickingMode = PickingMode.Ignore;
            parent.Add(Root);
            OnAttach();
        }

        internal void Detach()
        {
            try
            {
                OnDetach();
            }
            finally
            {
                Root?.RemoveFromHierarchy();
            }
        }

        /// <summary>建元素树：返回根元素（宿主把它加进层容器）</summary>
        protected abstract VisualElement Build();
        /// <summary>挂上之后：订阅事件</summary>
        protected virtual void OnAttach() { }
        /// <summary>拿下之前：退订事件</summary>
        protected virtual void OnDetach() { }
        /// <summary>每帧（宿主 LateUpdate，玩家与相机都已就位）</summary>
        public virtual void Tick(in HudFrame f) { }
        /// <summary>换玩家（换关 / 重来 / 新开一局）：清掉瞬态</summary>
        public virtual void ResetState() { }
    }

    /// <summary>
    /// HUD 组件看得到的世界：玩家（生命、武器、移动、技能）、相机、层容器、投影。字段都从宿主 <see cref="Hud"/> 现取
    /// （<see cref="PlayerFactory.Bind"/> 每关重新接线），部件不要缓存玩家组件。
    /// </summary>
    public sealed class HudContext
    {
        readonly Hud host;
        readonly Dictionary<UILayer, VisualElement> containers;
        readonly List<HudWidget> widgets;

        internal HudContext(Hud host, Dictionary<UILayer, VisualElement> containers, List<HudWidget> widgets)
        {
            this.host = host;
            this.containers = containers;
            this.widgets = widgets;
        }

        public Hud Host => host;
        public Camera Cam => host ? host.cam : null;
        public PlayerVitals Vitals => host ? host.vitals : null;
        public WeaponController Weapons => host ? host.weapons : null;
        public PlayerMotor Motor => host ? host.motor : null;

        /// <summary>武器 HUD 数据源（接管时是接管者的）；没有武器控制器为 null</summary>
        public IWeaponHudSource WeaponHud
        {
            get
            {
                var w = Weapons;
                return w ? w.Hud : null;
            }
        }

        /// <summary>技能：技能栏挂点（<see cref="SkillHud"/>）绑的那一份，没有就取玩家身上的</summary>
        public HeroSkills Skills
        {
            get
            {
                var sh = SkillHud.Current;
                if (sh && sh.skills) return sh.skills;
                var v = Vitals;
                return v ? v.GetComponent<HeroSkills>() : null;
            }
        }

        /// <summary>当前英雄（技能槽配置的；没有时按本局英雄 id 查）</summary>
        public HeroDef Hero
        {
            get
            {
                var s = Skills;
                if (s && s.Hero != null) return s.Hero;
                var id = RunState.Current?.heroId;
                return string.IsNullOrEmpty(id) ? null : HeroLibrary.Get(id);
            }
        }

        /// <summary>某一层里这个 HUD 的容器（铺满全屏）</summary>
        public VisualElement Container(UILayer layer) => containers.TryGetValue(layer, out var c) ? c : null;

        /// <summary>HUD 层的面板尺寸（设计像素：1920×1080 下约等于屏幕像素 ÷ 缩放）；还没排版时按屏幕和缩放估算</summary>
        public Vector2 PanelSize
        {
            get
            {
                var c = Container(UILayer.Hud);
                if (c != null)
                {
                    var r = c.layout;
                    if (r.width > 1 && r.height > 1 && !float.IsNaN(r.width)) return r.size;
                }
                float s = UILayers.Scale(UILayer.Hud, Screen.width, Screen.height);
                return new Vector2(Screen.width / s, Screen.height / s);
            }
        }

        /// <summary>
        /// 世界坐标 → HUD 面板坐标（左上原点）；在相机背后（深度 &lt; minDepth）返回 false。depth = 沿视线的距离。
        /// 按视口比例换算（不依赖面板缩放的细节）：面板铺满屏幕，相机也画满屏幕。
        /// </summary>
        public bool Project(Vector3 world, out Vector2 panel, out float depth, float minDepth = 0.3f)
        {
            panel = default;
            depth = 0;
            var cam = Cam;
            if (!cam) return false;
            var v = cam.WorldToViewportPoint(world);
            depth = v.z;
            if (!(v.z >= minDepth) || float.IsNaN(v.x) || float.IsNaN(v.y)) return false;
            var size = PanelSize;
            panel = new Vector2(v.x * size.x, (1 - v.y) * size.y);
            return true;
        }

        /// <summary>同一个宿主上的另一个部件（没有为 null）</summary>
        public T Widget<T>() where T : HudWidget
        {
            foreach (var w in widgets)
                if (w is T t) return t;
            return null;
        }
    }

    /// <summary>[HudWidget] 扫描：找出本程序集里全部 HUD 部件类型（按层、Order 排好），宿主每次起来各 new 一个</summary>
    public static class HudWidgets
    {
        public readonly struct Entry
        {
            public readonly Type type;
            public readonly HudWidgetAttribute attr;

            public Entry(Type type, HudWidgetAttribute attr)
            {
                this.type = type;
                this.attr = attr;
            }
        }

        static List<Entry> entries;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => entries = null;

        /// <summary>登记的部件（按层、Order、id 排序）</summary>
        public static IReadOnlyList<Entry> All
        {
            get
            {
                if (entries != null) return entries;
                entries = new List<Entry>();
                var seen = new HashSet<string>(StringComparer.Ordinal);
                Type[] types;
                try { types = typeof(HudWidgets).Assembly.GetTypes(); }
                catch (ReflectionTypeLoadException e) { types = Array.FindAll(e.Types, t => t != null); }
                foreach (var t in types)
                {
                    if (t.IsAbstract || !typeof(HudWidget).IsAssignableFrom(t) || t.GetConstructor(Type.EmptyTypes) == null) continue;
                    var attr = t.GetCustomAttribute<HudWidgetAttribute>(false);
                    if (attr == null || string.IsNullOrEmpty(attr.Id)) continue;
                    if (!seen.Add(attr.Id))
                    {
                        Debug.LogError($"[UI] HUD 部件 id「{attr.Id}」重复（{t.FullName}），忽略");
                        continue;
                    }
                    entries.Add(new Entry(t, attr));
                }
                entries.Sort((a, b) =>
                {
                    int c = a.attr.Layer.CompareTo(b.attr.Layer);
                    if (c == 0) c = a.attr.Order.CompareTo(b.attr.Order);
                    return c != 0 ? c : string.CompareOrdinal(a.attr.Id, b.attr.Id);
                });
                return entries;
            }
        }

        /// <summary>按登记建全部部件实例（还没挂）</summary>
        internal static List<HudWidget> CreateAll()
        {
            var list = new List<HudWidget>();
            foreach (var e in All)
            {
                try
                {
                    var w = (HudWidget)Activator.CreateInstance(e.type);
                    w.Id = e.attr.Id;
                    w.Layer = e.attr.Layer;
                    w.Order = e.attr.Order;
                    list.Add(w);
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[UI] HUD 部件 {e.attr.Id} 建不起来：{ex}");
                }
            }
            return list;
        }
    }
}
