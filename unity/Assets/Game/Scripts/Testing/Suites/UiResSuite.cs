using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 多分辨率排版（bridge.sh playtest ui-res；场景 MainMenu；只能在编辑器里跑）：把 Game 视图依次切到 1280×720 / 1366×768 / 1600×900 / 1920×1080 / 2560×1440，
    /// 每种分辨率下打开各个界面，用 <see cref="UiLayoutProbe"/> 查文字有没有断行（单行放得下却折了行）、出屏 / 溢出裁剪框、两段文字重叠，并各拍一张：
    ///   主菜单：主菜单、设置（每个页签都查，拍第一页和按键页）、图鉴（四个类别都查，拍武器和敌人）、天赋、操作说明、确认框、选英雄；
    ///   局内（出征进 1-1）：HUD（交互提示卡 + 提示条）、暂停、行囊（先塞三卷秘卷；行囊页 + 灵宠页）、关间结算卡、秘卷三选一、行旅图、整局结算。
    /// 先查面板缩放：四层都是「按参考分辨率 1920×1080 缩放、Expand」，16:9 下逻辑尺寸都是 1920×1080；
    /// 再自检 <see cref="FitLabel"/>：会换行、按内容收缩的标签量宽时留出余量（字距 6px 的短句不断行）。
    /// 截图 playtest_uires_&lt;宽&gt;x&lt;高&gt;_&lt;界面&gt;.png。全程调试档（SaveService.ForceDev），结束时还原 Game 视图原来的尺寸、回主菜单（局按放弃结算进调试档）。
    /// </summary>
    public sealed class UiResSuite : PlaytestSuite
    {
        public override string Id => "ui-res";
        public override string Scene => MenuFlow.MenuScenePath;

        public static readonly Vector2Int[] Resolutions = { new(1280, 720), new(1366, 768), new(1600, 900), new(1920, 1080), new(2560, 1440) };
        const float LoadTimeout = 90f;

        Vector2Int res;
        int screensChecked, issueCount, shotCount;
        readonly Dictionary<string, int> perRes = new();

        protected override IEnumerator Steps()
        {
            if (!GameViewResolution.Supported)
            {
                Fail("ui-res 只能在编辑器里跑（要切 Game 视图分辨率）");
                yield break;
            }
            bool forceDev = SaveService.ForceDev;
            SaveService.ForceDev = true;
            var saved = GameViewResolution.Save();
            var original = new Vector2Int(Screen.width, Screen.height);
            Line($"Game 视图原来 {original.x}×{original.y}（尺寸项 {saved ?? "记不下"}）");
            try
            {
                yield return Run();
            }
            finally
            {
                Line("收尾：" + GameViewResolution.Restore(saved, original));
                SaveService.ForceDev = forceDev;
                GameUI.SetPrompt(null);
            }
        }

        IEnumerator Run()
        {
            yield return WaitMenu("启动");
            if (!MenuDirector.Instance) yield break;
            CheckPanels();
            yield return CheckProbe();
            UiLayoutProbe.Scanned = 0;
            RunSuspend.Discard(RunSuspend.MenuDev);

            // ── 主菜单里的界面 ──
            foreach (var r in Resolutions)
            {
                yield return SetRes(r);
                yield return MenuScreens();
            }

            // ── 局内 ──
            if (!MenuFlow.StartRun(HeroLibrary.DefaultHero))
            {
                Fail("出征失败");
                yield break;
            }
            yield return WaitReady("出征进 1-1");
            if (!SceneFlow.Instance || SceneFlow.Instance.Player == null) yield break;
            foreach (var r in Resolutions)
            {
                yield return SetRes(r);
                yield return GameScreens();
            }

            Line($"合计：{Resolutions.Length} 种分辨率，查了 {screensChecked} 个画面，问题 {issueCount} 处（{string.Join("，", perRes.Select(kv => $"{kv.Key} {kv.Value}"))}），截图 {shotCount} 张；" +
                 $"共扫文字 {UiLayoutProbe.Scanned} 次");

            // 回主菜单（局按放弃结算进调试档）
            MenuFlow.ToMenu();
            yield return WaitMenu("回主菜单");
        }

        // ───────────── 面板缩放 ─────────────

        void CheckPanels()
        {
            var ui = UIRoot.Instance;
            if (!ui)
            {
                Fail("没有 UIRoot");
                return;
            }
            for (int i = 0; i < UILayers.Count; i++)
            {
                var layer = (UILayer)i;
                var ps = ui.Panel(layer);
                Line($"面板 {UILayers.Name(layer)}：{ps.scaleMode} 参考 {ps.referenceResolution.x}×{ps.referenceResolution.y} {ps.screenMatchMode} match {ps.match:0.##}");
                if (ps.scaleMode != PanelScaleMode.ScaleWithScreenSize || ps.referenceResolution != UILayers.ReferenceResolution || ps.screenMatchMode != UILayers.MatchMode)
                    Fail($"{UILayers.Name(layer)} 层没有按参考分辨率缩放（{ps.scaleMode} / {ps.screenMatchMode}）");
            }
        }

        /// <summary>
        /// FitLabel 自检（界面层里临时放两个按内容收缩、会换行的标签，字距 6px 的「操作说明」）：
        /// FitLabel 的内容宽 ≥ 量出来的单行宽 + 余量，在自己的内容宽下量是 1 行；普通 Label 只记一笔内容宽作对照（= 单行宽，取整一丢就断）。
        /// </summary>
        IEnumerator CheckProbe()
        {
            var layer = UIRoot.Instance ? UIRoot.Instance.Layer(UILayer.Modal) : null;
            if (layer == null) yield break;
            var box = new VisualElement { pickingMode = PickingMode.Ignore };
            box.style.position = Position.Absolute;
            box.style.left = 40.5f;
            box.style.top = 40;
            box.style.alignItems = Align.Center;
            box.style.opacity = 0.01f;
            layer.Add(box);
            Label Make(Label l)
            {
                l.style.whiteSpace = WhiteSpace.Normal;
                l.style.fontSize = 18;
                l.style.letterSpacing = 6;
                box.Add(l);
                return l;
            }
            var fit = Make(new FitLabel("操作说明"));
            var plain = Make(new Label("操作说明"));
            for (int i = 0; i < 3; i++) yield return null;
            var one = fit.MeasureTextSize(fit.text, 0, VisualElement.MeasureMode.Undefined, 0, VisualElement.MeasureMode.Undefined);
            var at = fit.MeasureTextSize(fit.text, fit.contentRect.width, VisualElement.MeasureMode.Exactly, 0, VisualElement.MeasureMode.Undefined);
            Line($"FitLabel 自检：字距 6 的「操作说明」单行宽 {one.x:F2}，FitLabel 内容宽 {fit.contentRect.width:F2}（{at.y / Mathf.Max(1, one.y):0.#} 行），普通 Label 内容宽 {plain.contentRect.width:F2}");
            if (fit.contentRect.width < one.x + FitLabel.Slack - 0.1f || at.y > one.y * 1.5f)
                Fail($"FitLabel 没有留出余量（内容宽 {fit.contentRect.width:F2}，单行宽 {one.x:F2}）");
            box.RemoveFromHierarchy();
        }

        IEnumerator SetRes(Vector2Int r)
        {
            res = r;
            GameViewResolution.Set(r.x, r.y);
            yield return GameViewResolution.WaitFor(r.x, r.y);
            yield return new WaitForSecondsRealtime(0.3f);
            var top = UIRoot.Instance ? UIRoot.Instance.Layer(UILayer.Modal)?.panel?.visualTree : null;
            var size = top != null ? top.worldBound.size : Vector2.zero;
            float expect = UILayers.Scale(UILayer.Modal, Screen.width, Screen.height);
            Line($"── {r.x}×{r.y}：屏幕 {Screen.width}×{Screen.height}，面板逻辑尺寸 {size.x:F0}×{size.y:F0}（缩放 ×{expect:0.###}）");
            if (Screen.width != r.x || Screen.height != r.y) Fail($"Game 视图没切到 {r.x}×{r.y}（现在 {Screen.width}×{Screen.height}）");
            if (size.x < UILayers.ReferenceResolution.x - 2 || size.y < UILayers.ReferenceResolution.y - 2)
                Fail($"{r.x}×{r.y} 下面板逻辑尺寸 {size.x:F0}×{size.y:F0} 小于参考分辨率（界面会被挤）");
        }

        // ───────────── 主菜单 ─────────────

        IEnumerator MenuScreens()
        {
            var main = UIRouter.Find(MainMenuScreen.ScreenId) as MainMenuScreen;
            if (main == null)
            {
                Fail("主菜单界面没有打开");
                yield break;
            }
            main.Refresh();
            yield return new WaitForSecondsRealtime(0.4f);
            yield return Check("menu", "主菜单", UILayer.Modal, UILayer.Toast);

            if (UIRouter.Open(SettingsScreen.ScreenId) && UIRouter.Find(SettingsScreen.ScreenId) is SettingsScreen settings)
            {
                yield return new WaitForSecondsRealtime(0.5f);
                var tabs = new List<string>();
                for (int i = 0; i < 12; i++)
                {
                    settings.Select(i);
                    if (tabs.Contains(settings.CurrentTab)) break;
                    tabs.Add(settings.CurrentTab);
                    yield return new WaitForSecondsRealtime(0.15f);
                    bool shoot = i == 0 || settings.CurrentTab == SettingsScreen.KeysTab;
                    yield return Check(shoot ? (i == 0 ? "settings" : "settings_keys") : null, $"设置·{settings.CurrentTab}", UILayer.Modal);
                }
                settings.Select(0);
                UIRouter.Back();
                yield return new WaitForSecondsRealtime(0.3f);
            }
            else Fail("设置打不开");

            if (UIRouter.Open(CodexScreen.ScreenId, CodexKind.Weapon) && UIRouter.Find(CodexScreen.ScreenId) is CodexScreen codex)
            {
                yield return new WaitForSecondsRealtime(0.6f);
                foreach (CodexKind k in Enum.GetValues(typeof(CodexKind)))
                {
                    codex.Select(k);
                    yield return new WaitForSecondsRealtime(0.25f);
                    string shot = k == CodexKind.Weapon ? "codex" : k == CodexKind.Enemy ? "codex_enemy" : null;
                    yield return Check(shot, $"图鉴·{CodexCatalog.KindName(k)}（{codex.DetailName}）", UILayer.Modal);
                }
                UIRouter.Back();
                yield return new WaitForSecondsRealtime(0.35f);
                if (UIRouter.IsOpen(CodexScreen.ScreenId)) Fail("返回后图鉴还开着");
            }
            else Fail("图鉴打不开");
            yield return Sub(TalentScreen.ScreenId, null, "talents", "天赋", 0.5f);
            yield return Sub(ControlsScreen.ScreenId, null, "controls", "操作说明", 0.5f);

            ConfirmScreen.Ask(new ConfirmRequest
            {
                title = "开始新征程",
                message = "开始新征程会放弃当前的征程（第 1-2 关），确定吗？",
                detail = "放弃的征程按败北结算：已收集的魂晶照常入账，此操作不能撤销。",
                confirmText = "放弃并出征",
                cancelText = "取消",
            });
            yield return new WaitForSecondsRealtime(0.5f);
            if (!UIRouter.IsOpen(ConfirmScreen.ScreenId)) Fail("确认框没有打开");
            yield return Check("confirm", "确认框", UILayer.Modal);
            UIRouter.Close(ConfirmScreen.ScreenId);
            yield return new WaitForSecondsRealtime(0.3f);

            main.StartGame();
            yield return new WaitForSecondsRealtime(1.4f);
            if (UIRouter.IsOpen(HeroSelectScreen.ScreenId))
            {
                yield return Check("heroes", "选英雄", UILayer.Modal);
                UIRouter.Back();
                yield return new WaitForSecondsRealtime(1.2f);
            }
            else Fail("选英雄界面没有打开");
            if (UIRouter.Top is not MainMenuScreen) Fail($"子页关完后栈顶是 {UIRouter.Top?.Id}，应为主菜单");
        }

        IEnumerator Sub(string id, object arg, string shot, string label, float wait)
        {
            if (!UIRouter.Open(id, arg))
            {
                Fail($"{label}打不开");
                yield break;
            }
            yield return new WaitForSecondsRealtime(wait);
            yield return Check(shot, label, UILayer.Modal);
            UIRouter.Back();
            yield return new WaitForSecondsRealtime(0.35f);
            if (UIRouter.IsOpen(id)) Fail($"返回后{label}还开着");
        }

        // ───────────── 局内 ─────────────

        IEnumerator GameScreens()
        {
            var flow = SceneFlow.Instance;
            var session = GameSession.Instance;
            if (!flow || flow.Player == null || !session)
            {
                Fail("不在关卡里");
                yield break;
            }
            // HUD + 交互提示卡 + 提示条
            GameUI.SetPrompt(new InteractPrompt
            {
                title = "宝箱 · 秘卷", subtitle = "开启", color = Rarity.Color(Rarity.Epic), cost = 120, canAfford = true,
                lines = new[] { "从三个精良及以上的秘卷中选择一个", "已有 2 卷同名秘卷" },
            });
            GameUI.Toast("获得秘卷「利刃」 ×2");
            yield return new WaitForSecondsRealtime(0.6f);
            yield return Check("hud", "HUD + 提示卡", UILayer.Hud, UILayer.Overlay, UILayer.Toast);
            GameUI.SetPrompt(null);

            // 暂停
            session.SetPaused(true);
            yield return new WaitForSecondsRealtime(0.5f);
            if (UIRouter.IsOpen(PauseScreen.ScreenId)) yield return Check("pause", "暂停", UILayer.Modal);
            else Fail("暂停后没有暂停菜单");
            session.SetPaused(false);
            yield return new WaitForSecondsRealtime(0.3f);

            // 行囊（先塞三卷秘卷：一卷带代价的传说卷，行囊里有说明、代价两种段落）+ 灵宠页
            var inv = LootDirector.Instance ? LootDirector.Instance.scrolls : null;
            if (inv != null && inv.Count == 0)
            {
                var grant = ScrollLibrary.All.Where(s => string.IsNullOrEmpty(s.heroOnly)).OrderByDescending(s => s.rarity).Take(2)
                    .Concat(ScrollLibrary.All.Where(s => string.IsNullOrEmpty(s.heroOnly) && s.rarity <= 1).Take(1));
                foreach (var d in grant) inv.Gain(d, PlayerVitals.Instance);
                UIRoot.Instance?.Toasts.Clear();
            }
            if (UIRouter.Open(InventoryPanel.ScreenId, InventoryPanel.BagTab) && UIRouter.Find(InventoryPanel.ScreenId) is InventoryPanel bag)
            {
                yield return new WaitForSecondsRealtime(0.5f);
                yield return Check("inventory", $"行囊（秘卷 {bag.ScrollRows} 卷）", UILayer.Modal);
                bag.Select(1);
                yield return new WaitForSecondsRealtime(0.25f);
                yield return Check("inventory_pet", $"行囊·{bag.CurrentTab}", UILayer.Modal);
                UIRouter.Close(InventoryPanel.ScreenId);
                yield return new WaitForSecondsRealtime(0.3f);
            }
            else Fail("行囊打不开");

            // 关间结算卡
            var first = RunPlan.First;
            var card = new StageCardInfo
            {
                stage = first, next = RunPlan.Next(first), time = 263.4f, kills = 37, coins = 1284, coinsDelta = 356, scrolls = 6, scrollsGained = 3,
                nextReady = true,
            };
            if (UIRouter.Open(StageCardScreen.ScreenId, card))
            {
                yield return new WaitForSecondsRealtime(1.0f);
                yield return Check("stagecard", "关间结算卡", UILayer.Modal);
                UIRouter.Close(StageCardScreen.ScreenId);
                yield return new WaitForSecondsRealtime(0.3f);
            }
            else Fail("关间结算卡打不开");

            // 秘卷三选一
            var picks = ScrollLibrary.All.Where(s => string.IsNullOrEmpty(s.heroOnly)).OrderByDescending(s => s.rarity).Take(3).ToList();
            var args = new ScrollChoiceArgs { choices = picks, inventory = LootDirector.Instance ? LootDirector.Instance.scrolls : null };
            if (UIRouter.Open(ScrollChoiceScreen.ScreenId, args))
            {
                yield return new WaitForSecondsRealtime(1.1f);
                yield return Check("scrolls", "秘卷三选一", UILayer.Modal, UILayer.Overlay);
                UIRouter.Close(ScrollChoiceScreen.ScreenId);
                yield return new WaitForSecondsRealtime(0.6f);
            }
            else Fail("秘卷三选一打不开");

            // 行旅图
            if (UIRouter.Open(MapScreen.ScreenId))
            {
                yield return new WaitForSecondsRealtime(0.6f);
                yield return Check("map", "行旅图", UILayer.Modal);
                UIRouter.Close(MapScreen.ScreenId);
                yield return new WaitForSecondsRealtime(0.3f);
            }
            else Fail("行旅图打不开");

            // 整局结算（只显示，不结算）
            var run = RunState.Current;
            if (run != null && UIRouter.Open(MenuFlow.SummaryScreenId, RunSummary.From(run, false)))
            {
                yield return new WaitForSecondsRealtime(1.2f);
                yield return Check("summary", "整局结算", UILayer.Modal);
                UIRouter.Close(MenuFlow.SummaryScreenId);
                yield return new WaitForSecondsRealtime(0.3f);
            }
            else Fail("整局结算打不开");
            if (UIRouter.Count != 0) Fail($"局内界面关完后还有 {UIRouter.Top?.Id}");
        }

        // ───────────── 检查 + 截图 ─────────────

        IEnumerator Check(string shot, string label, params UILayer[] layers)
        {
            yield return null;
            screensChecked++;
            var issues = UiLayoutProbe.InspectLayers(layers);
            string key = $"{res.x}×{res.y}";
            perRes[key] = perRes.TryGetValue(key, out var n) ? n + issues.Count : issues.Count;
            issueCount += issues.Count;
            if (issues.Count == 0) Line($"  {label}：✓ 不断行、不出屏、不重叠");
            else
            {
                Line($"  {label}：{issues.Count} 处问题");
                foreach (var i in issues.Take(12)) Line($"    {i}");
                if (issues.Count > 12) Line($"    …还有 {issues.Count - 12} 处");
                Fail($"{key} {label}：{string.Join("；", issues.Take(3))}{(issues.Count > 3 ? $" 等 {issues.Count} 处" : "")}");
            }
            if (shot == null) yield break;
            string name = $"uires_{res.x}x{res.y}_{shot}";
            shotCount++;
            if (string.IsNullOrEmpty(ShotDir))
            {
                var cam = SceneFlow.Instance && SceneFlow.Instance.Player != null ? SceneFlow.Instance.Player.cam : MenuCamera.Instance ? MenuCamera.Instance.Camera : Camera.main;
                Shot(cam, name);
            }
            else yield return UICapture.CaptureScreen(Path.Combine(ShotDir, $"playtest_{name}.png"), shotCount == 1 ? Line : null);
        }

        // ───────────── 等待 ─────────────

        IEnumerator WaitReady(string what)
        {
            float t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < LoadTimeout)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Player != null && f.Player.root && f.CurrentScene.IsValid() && !MenuFlow.Busy)
                {
                    yield return new WaitForSecondsRealtime(1.2f);
                    yield break;
                }
                yield return null;
            }
            Fail($"{what}：{LoadTimeout:F0} s 内没有就绪");
        }

        IEnumerator WaitMenu(string what)
        {
            float t0 = Time.realtimeSinceStartup;
            yield return null;
            while (Time.realtimeSinceStartup - t0 < LoadTimeout && (!MenuDirector.Instance || !MenuDirector.Instance.Ready || MenuFlow.Busy)) yield return null;
            if (!MenuDirector.Instance) Fail($"{what}：没有主菜单（MenuDirector）");
            yield return new WaitForSecondsRealtime(0.6f);
        }
    }
}
