using System.Collections;
using System.IO;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.TextCore.Text;
using UnityEngine.UIElements;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// UI Toolkit 基座冒烟（bridge.sh playtest ui；场景 TestArena）——docs/unity-parity.md U1 / 7.3「UI U」：
    ///   · 四层面板都建好（资产 / 运行时兜底各记一行），正文 / 标题 / 数字三套 SDF 字体在，常用字齐全，子集外的字能从余量回退出来；
    ///   · 9 个图标都能解析成矢量图；
    ///   · Toast：叠放、相同合并 ×N、最多 4 条，暂停（时间 ×0）中照常到时消失；横幅：显示 / 旧式两行标题拆成标题 + 副标题；闪光、黑幕都用不缩放时间；
    ///   · 路由：打开测试界面 → 压模态栈、停时间、关 Gameplay 动作表、自动聚焦第一个按钮；方向导航、确认点按钮、滑条左右调值；返回关掉、一切复原；
    ///   · 截图：提示 + 横幅、路由界面、黑幕各拍一张，走屏幕抓取（含 UI Toolkit 叠层）。
    /// </summary>
    public sealed class UiSuite : PlaytestSuite
    {
        public override string Id => "ui";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        /// <summary>测试用界面：三个竖排按钮 + 一个滑条（不登记 [UIScreen]，只在本套件里手动登记）</summary>
        sealed class ProbeScreen : UIScreen
        {
            public override string Id => "ui-probe";
            public int[] clicks = new int[3];
            public Button[] buttons = new Button[3];
            public Slider slider;

            protected override VisualElement Build()
            {
                var root = new VisualElement();
                var backdrop = new VisualElement();
                backdrop.AddToClassList(UITheme.Backdrop);
                root.Add(backdrop);
                var frame = new VisualElement();
                frame.AddToClassList(UITheme.Frame);
                var title = new Label("界面路由自检");
                title.AddToClassList(UITheme.PanelTitle);
                frame.Add(title);
                for (int i = 0; i < 3; i++)
                {
                    int k = i;
                    var b = new Button(() => clicks[k]++) { text = $"选项 {i + 1}" };
                    b.AddToClassList(UITheme.Button);
                    if (i == 0) b.AddToClassList(UITheme.ButtonPrimary);
                    b.style.marginBottom = 10;
                    frame.Add(b);
                    buttons[i] = b;
                }
                slider = new Slider("音量", 0, 1) { value = 0.5f };
                frame.Add(slider);
                var keys = new VisualElement { style = { flexDirection = FlexDirection.Row, marginTop = 12 } };
                foreach (var icon in new[] { UIIcon.Coin, UIIcon.Essence, UIIcon.Skull, UIIcon.Spark, UIIcon.Gate, UIIcon.Hourglass, UIIcon.Lock, UIIcon.Blades })
                    keys.Add(UIIcons.Make(icon));
                var key = new Label("F");
                key.AddToClassList(UITheme.Key);
                keys.Add(key);
                var num = new Label("1234 ×5");
                num.AddToClassList(UITheme.NumberFont);
                keys.Add(num);
                frame.Add(keys);
                root.Add(frame);
                return root;
            }
        }

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var weapons = FindAnyObjectByType<WeaponController>();
            var cam = weapons ? weapons.eye : Camera.main;
            var ui = UIRoot.Ensure();
            if (!ui)
            {
                Fail("UIRoot 没建起来");
                yield break;
            }

            // ── 面板与字体 ──
            for (int i = 0; i < UILayers.Count; i++)
            {
                var layer = (UILayer)i;
                var doc = ui.Document(layer);
                bool asset = Resources.Load<PanelSettings>(UILayers.ResourcePath(layer));
                Line($"层 {UILayers.Name(layer)}：面板 {(doc && doc.rootVisualElement?.panel != null ? "就绪" : "缺失")}，排序 {ui.Panel(layer).sortingOrder}，缩放 ×{ui.Panel(layer).scale:0.00}（{(asset ? "资产" : "运行时兜底")}）");
                if (!doc || doc.rootVisualElement?.panel == null) Fail($"{UILayers.Name(layer)} 层没有面板");
            }
            Line($"字体：正文 {Name(UIFonts.Body)}、标题 {Name(UIFonts.Title)}、数字 {Name(UIFonts.Number)}、余量 {UIFonts.BodyExt.Count} 份（{(UIFonts.RuntimeFallback ? "运行时现建" : "UIBuilder 资产")}）");
            if (!UIFonts.Body) Fail("没有正文 SDF 字体（Resources/UI/Fonts 缺打包字体？）");
            if (UIFonts.Title == UIFonts.Body) Fail("标题字体缺失（退回了正文）");
            if (UIFonts.Number == UIFonts.Body) Fail("数字字体缺失（退回了正文）");
            if (UIFonts.BodyExt.Count == 0) Fail("没有正文余量字体：子集外的字会显示成方块");
            if (UIFonts.Legacy == null) Fail("没有 uGUI 用的正文 Font（UIFonts.Legacy）");
            if (UIFonts.Body)
            {
                const string sample = "灵火破晓 · 古道穿越戈壁　区域肃清！出口已开启，秘卷「焚雷」×3 魂晶 1,280";
                if (!UIFonts.Body.HasCharacters(sample, out uint[] miss, true, true))
                    Fail($"正文字体缺常用字：{string.Concat(miss.Select(u => char.ConvertFromUtf32((int)u)))}");
                // 子集外的字（GB2312 一级之外、代码里也没写过）：用码位拼，免得扫描脚本把它收进子集
                string rare = char.ConvertFromUtf32(0x9F98) + char.ConvertFromUtf32(0x5EB9) + char.ConvertFromUtf32(0x7CC5);
                bool inSubset = UIFonts.Body.HasCharacters(rare, out uint[] _, false, true);
                bool viaFallback = UIFonts.Body.HasCharacters(rare, out uint[] miss2, true, true);
                Line($"回退：子集外的字 {rare} 子集{(inSubset ? "里有" : "里没有")}，经回退链{(viaFallback ? "能显示" : $"缺 {miss2?.Length} 个")}");
                if (!viaFallback) Fail("子集外的字从余量字体回退不出来");
            }

            // ── 图标 ──
            int icons = 0;
            for (int i = 0; i < UIIcons.Count; i++)
            {
                var img = UIIcons.Get((UIIcon)i);
                if (img && img.width > 0) icons++;
                else Fail($"图标 {(UIIcon)i} 解析失败");
            }
            Line($"图标 {icons}/{UIIcons.Count} 个解析成矢量图");

            // ── Toast / 横幅 / 闪光 ──
            ui.Toasts.Clear();
            yield return new WaitForSecondsRealtime(0.3f);
            GameUI.Toast("拾取 灵石 ×12");
            GameUI.Toast("秘卷「焚雷」叠到 2 层", new Color(1f, 0.55f, 0.2f));
            GameUI.Toast("强化至 +3", UITheme.Good);
            GameUI.Toast("强化至 +3", UITheme.Good);
            Line($"Toast：{ui.Toasts.Count} 条 → {string.Join(" | ", ui.Toasts.Texts)}");
            if (ui.Toasts.Count != 3 || !ui.Toasts.Texts.Last().EndsWith("×2")) Fail("Toast 没有合并相同的一条（应为 3 条，最后一条 ×2）");
            GameUI.Toast("第四条");
            GameUI.Toast("第五条：挤掉最老的");
            if (ui.Toasts.Count != UIToasts.Max) Fail($"Toast 上限应为 {UIToasts.Max}，现在 {ui.Toasts.Count}");
            GameUI.Banner("1-1\n古道穿越戈壁", null, 6f);
            Line($"横幅：标题「{ui.Banner.Title}」副标题「{ui.Banner.Subtitle}」");
            if (ui.Banner.Title != "古道穿越戈壁" || ui.Banner.Subtitle != "1-1") Fail("旧式两行横幅没拆成「标题 = 地名、副标题 = 关卡号」");
            yield return new WaitForSecondsRealtime(1.2f);
            Shot(cam, "ui_toast_banner");
            yield return UICapture.CaptureScreen(Path.Combine(ShotDir ?? "", "playtest_ui_toast_banner_screen.png"), Line);

            // 暂停中计时照走（不缩放时间）
            ui.Toasts.Clear();
            var freeze = TimeScaleArbiter.Request(this, 0, TimeScaleArbiter.Priority.Modal);
            yield return null;
            GameUI.Toast("暂停中的提示", null, 0.5f);
            GameUI.ScreenFlash(new Color(1f, 0.82f, 0.4f, 0.45f), 0.5f);
            bool flashing = ui.Flash.Active;
            yield return new WaitForSecondsRealtime(1.1f);
            Line($"暂停（×{Time.timeScale}）中：0.5 s 的提示 {(ui.Toasts.Count == 0 ? "已消失" : "还在")}，闪光 {(flashing ? "出现过" : "没出现")}、现在{(ui.Flash.Active ? "还亮着" : "已淡完")}");
            if (ui.Toasts.Count != 0) Fail("暂停中 Toast 没有按真实时间消失");
            if (!flashing || ui.Flash.Active) Fail("闪光没有按真实时间淡完");
            freeze.Dispose();
            yield return null;

            // ── 路由 ──
            var probe = new ProbeScreen();
            UIRouter.Register(probe);
            var stateBefore = GameStateMachine.Current;
            if (!UIRouter.Open("ui-probe")) Fail("UIRouter.Open(ui-probe) 失败");
            for (int i = 0; i < 12 && UIRouter.Focused == null; i++) yield return null;
            Line($"打开界面：状态 {stateBefore} → {GameStateMachine.Current}，时间 ×{Time.timeScale}，Gameplay 动作表{(GameInput.GameplayMap.enabled ? "开着" : "已关")}，焦点 {Describe(UIRouter.Focused)}");
            if (GameStateMachine.Current != GameState.Modal) Fail("打开界面没有压模态栈");
            if (Time.timeScale != 0) Fail("打开界面没有停时间");
            if (GameInput.GameplayMap.enabled) Fail("打开界面没有关 Gameplay 动作表");
            if (UIRouter.Focused != probe.buttons[0]) Fail("打开界面没有聚焦第一个按钮");
            UIRouter.Navigate(Vector2Int.down);
            bool movedDown = UIRouter.Focused == probe.buttons[1];
            UIRouter.Submit();
            yield return null;
            yield return new WaitForSecondsRealtime(0.25f);
            Line($"导航：下 → {Describe(UIRouter.Focused)}；确认 → 点击次数 {string.Join("/", probe.clicks)}");
            if (!movedDown) Fail("方向键下没有把焦点移到第二个按钮");
            if (probe.clicks[1] != 1) Fail("确认没有点到焦点按钮");
            UIRouter.Navigate(Vector2Int.down);
            UIRouter.Navigate(Vector2Int.down);
            var onSlider = UIRouter.Focused as VisualElement;
            float v0 = probe.slider.value;
            UIRouter.Navigate(Vector2Int.right);
            Line($"滑条：焦点 {Describe(UIRouter.Focused)}，右 → {v0:0.00} → {probe.slider.value:0.00}");
            if (onSlider == null || !(onSlider == probe.slider || probe.slider.Contains(onSlider))) Fail("连按两次下没有走到滑条");
            else if (!(probe.slider.value > v0)) Fail("焦点在滑条上时方向键右没有调值");
            UIRouter.Navigate(Vector2Int.up);
            UIRouter.Navigate(Vector2Int.up);
            UIRouter.Navigate(Vector2Int.up);
            yield return new WaitForSecondsRealtime(0.4f);
            Shot(cam, "ui_router");
            UIRouter.Back();
            yield return null;
            Line($"返回：界面{(UIRouter.IsOpen("ui-probe") ? "还开着" : "已关")}，状态 {GameStateMachine.Current}，时间 ×{Time.timeScale}，Gameplay 动作表{(GameInput.GameplayMap.enabled ? "开着" : "已关")}");
            if (UIRouter.IsOpen("ui-probe")) Fail("返回键没有关掉界面");
            if (GameStateMachine.Current != stateBefore) Fail($"关掉界面后状态没复原（{GameStateMachine.Current}，应为 {stateBefore}）");
            if (Time.timeScale != 1) Fail($"关掉界面后时间没复原（×{Time.timeScale}）");
            if (!GameInput.GameplayMap.enabled) Fail("关掉界面后 Gameplay 动作表没恢复");

            // ── 黑幕 ──
            _ = GameUI.Fade(1, 0.3f);
            yield return new WaitForSecondsRealtime(0.6f);
            float black = GameUI.FadeValue;
            Shot(cam, "ui_curtain");
            _ = GameUI.Fade(0, 0.3f);
            yield return new WaitForSecondsRealtime(0.6f);
            Line($"黑幕：淡入后 {black:0.00}，淡出后 {GameUI.FadeValue:0.00}");
            if (black < 0.99f || GameUI.FadeValue > 0.01f) Fail("黑幕淡入淡出没有到位");
            ui.Toasts.Clear();
            ui.Banner.Hide(true);
            Line($"缩放：1920×1080 ×{UILayers.Scale(UILayer.Modal, 1920, 1080):0.00}，Steam Deck 1280×800 ×{UILayers.Scale(UILayer.Modal, 1280, 800):0.00}，2560×1440 ×{UILayers.Scale(UILayer.Modal, 2560, 1440):0.00}");
        }

        static string Name(FontAsset fa) => fa ? fa.name : "无";

        static string Describe(Focusable f) => f switch
        {
            null => "无",
            Button b => $"按钮「{b.text}」",
            Slider s => $"滑条「{s.label}」",
            VisualElement v => v.GetType().Name + (string.IsNullOrEmpty(v.name) ? "" : $"#{v.name}"),
            _ => f.GetType().Name,
        };
    }
}
