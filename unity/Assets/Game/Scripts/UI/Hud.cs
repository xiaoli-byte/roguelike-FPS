using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.UIElements;
using Image = UnityEngine.UI.Image;

namespace Spiritfire.Game
{
    /// <summary>
    /// 战斗 HUD 的宿主（U2 起 UI 在 UI Toolkit，docs/unity-parity.md 3.12 / 4.8）：
    ///   · 起来时按 [HudWidget] 登记（<see cref="HudWidgets"/>）给每个部件建一个实例，挂进 <see cref="UIRoot"/> 对应层里本 HUD 的容器（加 Resources/UI/hud.uss），
    ///     LateUpdate 统一刷新（玩家、相机都已就位；单个部件出错只报一次）；换玩家（<see cref="PlayerFactory.Bind"/> 改了 vitals）时让部件清瞬态；
    ///     有模态界面 / 暂停（<see cref="GameStateMachine.Blocked"/>）时 HUD 层整体淡出（旧的 uGUI 暂停菜单、三选一画在相机上，UI Toolkit 会盖住它们）。
    ///   · 部件：生命 / 护盾（<see cref="VitalsWidget"/>）、武器槽（<see cref="WeaponWidget"/>）、Q/E 技能与冲刺（<see cref="SkillWidget"/>）、信息角（<see cref="InfoWidget"/>）、
    ///     准星（<see cref="CrosshairWidget"/>）、受击方向 / 闪屏 / 低血量（<see cref="HurtWidget"/>）、交互提示卡（<see cref="PromptWidget"/>）、
    ///     灵宠面板（<see cref="PetPanelWidget"/>）、中央大字（<see cref="CenterTextWidget"/>）；
    ///     U3：伤害数字与世界浮字（<see cref="DamageNumbers"/>）、敌人头顶血条（<see cref="EnemyBars"/>）、首领血条（<see cref="BossBar"/>）、反应首遇教学（<see cref="ReactionTips"/>）。
    ///   · 玩法代码走 <see cref="GameUI"/> 门面，不直接找 Hud；这里的旧成员（coins、Banner、Toast、SetPrompt…）只是转发，给旧调用方和冒烟测试用。
    ///   · 还留着一张 uGUI Canvas（<see cref="Root"/> / <see cref="Rect"/> / <see cref="Img"/> / <see cref="Label"/>）：暂停菜单与秘卷三选一（U4 / S7 迁走之前）画在上面。
    /// Canvas 用 Screen Space - Camera 挂在主相机上（编辑器里相机截图也能拍到）；UI Toolkit 部件由截图的屏幕抓取拍到（<see cref="UICapture"/>）。
    /// </summary>
    [DefaultExecutionOrder(900)]
    public sealed class Hud : MonoBehaviour
    {
        public static Hud Instance { get; private set; }

        public Camera cam;
        public PlayerVitals vitals;
        public WeaponController weapons;
        public PlayerMotor motor;

        Font font;
        RectTransform root;

        // ── UI Toolkit 部件 ──
        readonly List<HudWidget> widgets = new();
        readonly Dictionary<UILayer, VisualElement> containers = new();
        readonly HashSet<string> failed = new();
        HudContext ctx;
        PlayerVitals boundVitals;
        float hudAlpha = -1;

        /// <summary>本局灵石（转发 <see cref="RunState.coins"/>；旧 API，冒烟测试在读）</summary>
        public int coins => RunState.Current?.coins ?? 0;
        /// <summary>旧 uGUI Canvas 的根（暂停菜单、秘卷三选一画在上面）</summary>
        internal RectTransform Root => root;
        /// <summary>当前首领（<see cref="GameUI.SetBoss(Damageable, string)"/>；转发首领血条）</summary>
        public Damageable Boss
        {
            get
            {
                // 首领倒下后血条还要播一小段收起动画，但对旧 API 来说首领已经没了
                var b = Widget<BossBar>()?.Source?.BarHealth;
                return b && !b.Dead ? b : null;
            }
        }

        public string BossTitle => Widget<BossBar>() is { Source: not null } bar ? bar.Title : null;
        /// <summary>部件实例（按层、Order 排好）</summary>
        public IReadOnlyList<HudWidget> Widgets => widgets;
        /// <summary>部件上下文（测试、截图用）</summary>
        public HudContext Context => ctx;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => Instance = null;

        /// <summary>取一个部件（没有为 null）</summary>
        public T Widget<T>() where T : HudWidget
        {
            foreach (var w in widgets)
                if (w is T t) return t;
            return null;
        }

        void Awake()
        {
            Instance = this;
            // 打包的正文字体（Noto Sans SC 子集，导入设置里带余量做回退，D18）；没有时才退回系统字体（Deck / Linux 上会是豆腐块）
            font = UIFonts.Legacy;
            if (!font) font = Font.CreateDynamicFontFromOSFont(new[] { "Microsoft YaHei UI", "Microsoft YaHei", "SimHei", "Arial" }, 32);
            BuildCanvas();
            BuildWidgets();
        }

        void OnEnable()
        {
            foreach (var c in containers.Values) c.style.display = DisplayStyle.Flex;
        }

        void OnDisable()
        {
            foreach (var c in containers.Values) c.style.display = DisplayStyle.None;
        }

        void OnDestroy()
        {
            foreach (var w in widgets)
                try { w.Detach(); }
                catch (Exception e) { Debug.LogException(e); }
            widgets.Clear();
            foreach (var c in containers.Values) c.RemoveFromHierarchy();
            containers.Clear();
            if (Instance == this) Instance = null;
        }

        // ───────────── UI Toolkit 部件 ─────────────

        void BuildWidgets()
        {
            var ui = UIRoot.Ensure();
            if (!ui) return;
            var list = HudWidgets.CreateAll();
            ctx = new HudContext(this, containers, widgets);
            foreach (var w in list)
            {
                if (!containers.TryGetValue(w.Layer, out var c))
                {
                    c = HudArt.El("sf-hud sf-hud--" + UILayers.Name(w.Layer).ToLowerInvariant(), null, "hud-" + UILayers.Name(w.Layer).ToLowerInvariant());
                    ui.Layer(w.Layer).Add(c);
                    containers[w.Layer] = c;
                }
                AddStyle(c, w.StyleSheet);
                try
                {
                    w.Attach(ctx, c);
                    widgets.Add(w);
                }
                catch (Exception e)
                {
                    Debug.LogError($"[UI] HUD 部件 {w.Id} 挂不上：{e}");
                }
            }
            if (containers.TryGetValue(UILayer.Hud, out var hud)) hud.style.opacity = 0;
        }

        static void AddStyle(VisualElement c, string path)
        {
            if (string.IsNullOrEmpty(path)) return;
            var sheet = Resources.Load<StyleSheet>(path);
            if (!sheet)
            {
                Debug.LogWarning($"[UI] 找不到 HUD 样式表 Resources/{path}.uss");
                return;
            }
            if (!c.styleSheets.Contains(sheet)) c.styleSheets.Add(sheet);
        }

        void TickWidgets()
        {
            if (ctx == null) return;
            if (vitals != boundVitals)
            {
                boundVitals = vitals;
                foreach (var w in widgets)
                    try { w.ResetState(); }
                    catch (Exception e) { Fail(w, e); }
            }
            bool playing = !GameStateMachine.Blocked;
            var f = new HudFrame(Time.deltaTime, Time.unscaledDeltaTime, Time.time, Time.unscaledTime, Time.frameCount, playing && Time.timeScale > 0);
            // 有模态界面 / 暂停：HUD 层淡出（0.15 s）；进场 0.45 s 淡入
            if (containers.TryGetValue(UILayer.Hud, out var hud))
            {
                float target = playing && vitals ? 1 : 0;
                hudAlpha = hudAlpha < 0 ? 0 : Mathf.MoveTowards(hudAlpha, target, f.unscaledDt / (target > hudAlpha ? 0.45f : 0.15f));
                float q = Mathf.Round(hudAlpha * 100) / 100;
                if (!Mathf.Approximately(hud.style.opacity.value, q)) hud.style.opacity = q;
            }
            foreach (var w in widgets)
                try { w.Tick(f); }
                catch (Exception e) { Fail(w, e); }
        }

        void Fail(HudWidget w, Exception e)
        {
            if (!failed.Add(w.Id)) return;
            Debug.LogError($"[UI] HUD 部件 {w.Id} 更新失败：{e}");
        }

        // ───────────── 旧接口（转发）─────────────

        public void Banner(string text, float seconds = 2.5f) => GameUI.Banner(text, null, seconds);

        /// <summary>单行提示；color = 强调色（缺省鎏金）</summary>
        public void Toast(string text, float seconds = 2.2f, Color? color = null) => GameUI.Toast(text, color, seconds);

        /// <summary>弹出模态界面前收起横幅与提示</summary>
        public void ClearMessages() => GameUI.ClearMessages();

        public void SetStage(string text) => GameUI.SetStage(text);
        public void SetObjective(string text) => GameUI.SetObjective(text);
        public void SetPrompt(string text) => GameUI.SetPrompt(string.IsNullOrEmpty(text) ? null : InteractPrompt.Of(text));
        public void ShowDeath(string text) => GameUI.SetCenterText(text);
        public void SetPromptCard(InteractPrompt? card) => GameUI.SetPrompt(card);

        /// <summary>旧 API：进账灵石（转发 <see cref="RunState.Credit"/>）</summary>
        public void AddCoins(int n) => RunState.Ensure().Credit(n, "hud");

        /// <summary>全屏闪光（转发 <see cref="GameUI.ScreenFlash"/>）</summary>
        public void ScreenFlash(Color c, float seconds) => GameUI.ScreenFlash(c, seconds);

        /// <summary>首领（null = 清掉；转发 <see cref="GameUI.SetBoss(Damageable, string)"/>）</summary>
        public void SetBoss(Damageable boss, string title) => GameUI.SetBoss(boss, title);

        /// <summary>世界空间浮字（转发 <see cref="GameUI.FloatText"/>）</summary>
        public void FloatText(Vector3 world, string text, Color c, float scale = 1.3f) => GameUI.FloatText(world, text, c, scale);

        /// <summary>全屏黑幕淡到 to（转发 <see cref="GameUI.Fade"/>）</summary>
        public Awaitable FadeTo(float to, float seconds) => GameUI.Fade(to, seconds);

        // ───────────── 旧 uGUI Canvas（暂停菜单 / 三选一）─────────────

        void BuildCanvas()
        {
            var canvasGo = new GameObject("HUD Canvas");
            canvasGo.transform.SetParent(transform, false);
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceCamera;
            canvas.worldCamera = cam;
            canvas.planeDistance = 0.3f;
            canvas.sortingOrder = 10;
            var scaler = canvasGo.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920, 1080);
            scaler.matchWidthOrHeight = 1;
            root = canvasGo.GetComponent<RectTransform>();
        }

        internal static RectTransform Rect(string name, Transform parent, Vector2 aMin, Vector2 aMax, Vector2 oMin, Vector2 oMax)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var r = go.GetComponent<RectTransform>();
            r.SetParent(parent, false);
            r.anchorMin = aMin;
            r.anchorMax = aMax;
            r.offsetMin = oMin;
            r.offsetMax = oMax;
            return r;
        }

        internal static Image Img(string name, Transform parent, Vector2 aMin, Vector2 aMax, Vector2 oMin, Vector2 oMax, Color c)
        {
            var img = Rect(name, parent, aMin, aMax, oMin, oMax).gameObject.AddComponent<Image>();
            img.color = c;
            img.raycastTarget = false;
            return img;
        }

        internal Text Label(string name, Transform parent, Vector2 aMin, Vector2 aMax, int size, TextAnchor anchor, Color c)
        {
            var t = Rect(name, parent, aMin, aMax, Vector2.zero, Vector2.zero).gameObject.AddComponent<Text>();
            t.font = font;
            t.fontSize = size;
            t.alignment = anchor;
            t.color = c;
            t.raycastTarget = false;
            t.horizontalOverflow = HorizontalWrapMode.Overflow;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            return t;
        }

        // ───────────── 每帧 ─────────────

        void LateUpdate()
        {
            if (root && cam && root.TryGetComponent<Canvas>(out var canvas) && canvas.worldCamera != cam) canvas.worldCamera = cam;
            TickWidgets();
        }
    }
}
