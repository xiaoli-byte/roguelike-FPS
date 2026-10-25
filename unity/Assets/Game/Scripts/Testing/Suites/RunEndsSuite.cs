using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 一局的三种结束都能回主菜单（I1；bridge.sh playtest run-ends，场景 MainMenu）：
    ///   0. 暂离与开新局确认（I5）：出征 → 1-1（续玩档已写入）→ 暂停「返回主菜单」= 暂离（不结算、生涯局数不变）→ 主菜单出现「继续征程」→
    ///      再出征先弹确认框（写着当前征程的关卡）→ 取消：什么都不变 → 再出征、确认：旧局按败北结算（生涯 +1 局）、开新局进 1-1、续玩档换成新局的；
    ///   1. 阵亡：（接着第 0 步的新局）1-1 → 致命伤害 → 阵亡（结算一次，生涯 +1 局）→ 慢动作后自动弹整局结算（败北）→「主菜单」→ 回到主菜单、局已清空、续玩档已删；
    ///   2. 放弃：再出征 → 1-1 → 暂停 →「放弃本局」按两次（第一次待确认）→ 结算（败北）→「主菜单」→ 主菜单；
    ///   3. 试玩开关（demoEnd = 1-4）：再出征 → 直接换到 1-4 → 开战、打死旱魃（一刀，招式由 boss-hanba 验）→ 结算后不立出口、走胜利链 →
    ///      整局结算是胜利、止步处写「试玩通关 · 1-4 …」→「主菜单」→ 主菜单。
    /// 全程调试档（SaveService.ForceDev），结束时还原试玩开关。
    /// </summary>
    public sealed class RunEndsSuite : PlaytestSuite
    {
        public override string Id => "run-ends";
        public override string Scene => MenuFlow.MenuScenePath;

        const float LoadTimeout = 90f;

        protected override IEnumerator Steps()
        {
            bool forceDev = SaveService.ForceDev;
            string demo = RunPlan.DemoEnd;
            SaveService.ForceDev = true;
            RunPlan.DemoEnd = null;
            RunEnd.ShowDuringTests = true;
            try
            {
                yield return Run();
            }
            finally
            {
                SaveService.ForceDev = forceDev;
                RunPlan.DemoEnd = demo;
                RunEnd.ShowDuringTests = false;
                BossIntroDirector.Policy = BossIntroPolicy.Auto;
            }
        }

        IEnumerator Run()
        {
            yield return WaitMenu("启动");
            if (!MenuDirector.Instance) yield break;

            // ── 0. 暂离 → 继续征程 → 开新局要先确认 ──
            yield return SuspendAndConfirm();

            // ── 1. 阵亡（第 0 步确认后开的新局）──
            var flow = SceneFlow.Instance;
            if (!flow || flow.Player == null) yield break;
            int runs0 = CareerStats.Current.Runs;
            var p = flow.Player;
            Combat.DamagePlayer(99999, p.motor.transform.position + p.motor.transform.forward);
            yield return new WaitForSecondsRealtime(0.3f);
            if (!p.vitals.Dead) Fail("致命伤害后没有阵亡");
            var sum = default(SummaryScreen);
            yield return WaitSummary(s => sum = s, RunEnd.DeathDelay + 4f);
            Line($"阵亡 → 结算：{(sum != null ? $"已弹出（{(sum.Summary.victory ? "胜利" : "败北")}，{SummaryScreen.Reach(sum.Summary)}）" : "没有")}，生涯 {runs0} → {CareerStats.Current.Runs} 局");
            if (sum == null) Fail("阵亡后没有弹出整局结算");
            else if (sum.Summary.victory) Fail("阵亡的结算是胜利");
            if (CareerStats.Current.Runs != runs0 + 1) Fail("阵亡后生涯局数没有 +1");
            if (sum != null) Shot(p.cam, "runends_death");
            yield return ToMenu(sum, "阵亡");
            if (RunSuspend.Exists(RunSuspend.MenuDev)) Fail("阵亡结算后续玩档还在");

            // ── 2. 放弃 ──
            yield return Start("放弃");
            flow = SceneFlow.Instance;
            if (!flow || flow.Player == null) yield break;
            runs0 = CareerStats.Current.Runs;
            GameSession.Instance.SetPaused(true);
            yield return null;
            var pause = UIRouter.Find(PauseScreen.ScreenId) as PauseScreen;
            if (pause == null)
            {
                Fail("暂停后没有暂停菜单");
                yield break;
            }
            pause.Press("abandon");
            yield return null;
            if (UIRouter.IsOpen(MenuFlow.SummaryScreenId)) Fail("「放弃本局」按一次就结束了（应先待确认）");
            pause.Press("abandon");
            sum = null;
            yield return WaitSummary(s => sum = s, 3f);
            Line($"放弃 → 结算：{(sum != null ? $"已弹出（{(sum.Summary.victory ? "胜利" : "败北")}）" : "没有")}，生涯 {runs0} → {CareerStats.Current.Runs} 局");
            if (sum == null) Fail("放弃本局后没有弹出整局结算");
            else if (sum.Summary.victory) Fail("放弃的结算是胜利");
            if (CareerStats.Current.Runs != runs0 + 1) Fail("放弃后生涯局数没有 +1");
            if (sum != null) Shot(flow.Player.cam, "runends_abandon");
            yield return ToMenu(sum, "放弃");

            // ── 3. 试玩开关：1-4 打完就是胜利 ──
            RunPlan.DemoEnd = RunPlan.DemoDefault;
            Line($"试玩开关：demoEnd = {RunPlan.DemoEnd}，最后一关 {RunPlan.Final.Label}，路线 {RunPlan.Playable.Count} 关");
            yield return Start("试玩");
            flow = SceneFlow.Instance;
            if (!flow || flow.Player == null) yield break;
            var s14 = RunPlan.Get("1-4");
            if (!flow.GoTo(s14))
            {
                Fail("换不到 1-4");
                yield break;
            }
            yield return WaitReady("换到 1-4", flow.Transitions);
            flow = SceneFlow.Instance;
            if (flow.Current != s14)
            {
                Fail($"换关后是 {flow.Current?.Label}");
                yield break;
            }
            int wins0 = CareerStats.Current.Wins;
            var enc = FindAnyObjectByType<BossEncounter>();
            if (!enc)
            {
                Fail("1-4 没有 BossEncounter");
                yield break;
            }
            BossIntroDirector.Policy = BossIntroPolicy.Never;
            WeaponController.TestMode = true;
            flow.Player.vitals.invulnerableUntil = Time.time + 9999;
            enc.Begin();
            float t0 = Time.time;
            while (!enc.Boss && enc.State != BossEncounter.Phase.Settled && Time.time - t0 < 20f) yield return null;
            var boss = enc.Boss;
            if (!boss)
            {
                Fail($"旱魃没生成（{enc.State}）");
                yield break;
            }
            t0 = Time.time;
            while (!boss.Dead && Time.time - t0 < 20f)
            {
                if (!boss.Health.untargetable)
                {
                    var info = DamageInfo.Simple(99999f, DamageSource.Weapon, boss.BodyCenter, Vector3.forward);
                    info.noCrit = true;
                    Combat.DamageEnemy(boss.Health, info);
                }
                yield return null;
            }
            if (!boss.Dead)
            {
                Fail("旱魃打不死");
                yield break;
            }
            t0 = Time.time;
            while (enc.State != BossEncounter.Phase.Settled && Time.time - t0 < BossEncounter.SettleDelay + 3f) yield return null;
            Line($"试玩 1-4 首领结算：{enc.State}，去向 {enc.Result}");
            if (enc.Result != BossEncounter.Outcome.Victory) Fail($"试玩版 1-4 打完的去向是 {enc.Result}（应为胜利）");
            sum = null;
            yield return WaitSummary(s => sum = s, BossEncounter.VictoryDelay + RunEnd.VictoryDelay + 6f);
            string reach = sum != null ? SummaryScreen.Reach(sum.Summary) : null;
            Line($"试玩通关 → 结算：{(sum != null ? $"已弹出（{(sum.Summary.victory ? "胜利" : "败北")}，「{reach}」）" : "没有")}，出口 {(enc.OpenedExit ? "立了" : "没立")}，生涯胜场 {wins0} → {CareerStats.Current.Wins}");
            if (sum == null) Fail("试玩版打完 1-4 没有弹出整局结算");
            else
            {
                if (!sum.Summary.victory) Fail("试玩版打完 1-4 的结算不是胜利");
                if (reach == null || !reach.StartsWith("试玩通关")) Fail($"试玩通关的止步处写的是「{reach}」");
            }
            if (enc.OpenedExit) Fail("试玩版 1-4 打完还立了出口");
            if (CareerStats.Current.Wins != wins0 + 1) Fail("试玩通关后生涯胜场没有 +1");
            if (sum != null)
            {
                float r0 = Time.realtimeSinceStartup;
                while (!sum.Settled && Time.realtimeSinceStartup - r0 < 4f) yield return null;
                Shot(flow.Player != null ? flow.Player.cam : Camera.main, "runends_demo_victory");
            }
            WeaponController.TestMode = false;
            yield return ToMenu(sum, "试玩通关");
        }

        IEnumerator Start(string what)
        {
            Line($"── {what}：出征 ──");
            if (!MenuFlow.StartRun(HeroLibrary.DefaultHero))
            {
                // 有未完成的征程（不该有：上一局都结算过）时会先弹确认框
                if (UIRouter.Find(ConfirmScreen.ScreenId) is ConfirmScreen c)
                {
                    Fail($"{what}：出征时还有未完成的征程（{c.Message}）");
                    c.Confirm();
                }
                else
                {
                    Fail("出征失败");
                    yield break;
                }
            }
            yield return WaitReady($"{what}：出征进 1-1", -1);
        }

        /// <summary>主菜单这边的截图：菜单镜头一直在缓动，用帧末抓屏（含 UI Toolkit 界面）</summary>
        IEnumerator MenuShot(Camera cam, string name)
        {
            if (string.IsNullOrEmpty(ShotDir))
            {
                Shot(cam, name);
                yield break;
            }
            yield return UICapture.CaptureScreen(System.IO.Path.Combine(ShotDir, $"playtest_{name}.png"), Line);
        }

        /// <summary>第 0 步：暂离不结算 →「继续征程」出现 → 出征先确认（取消不变；确认后旧局按败北结算、开新局）</summary>
        IEnumerator SuspendAndConfirm()
        {
            bool dev = RunSuspend.MenuDev;
            RunSuspend.Discard(dev);
            yield return Start("暂离");
            var flow = SceneFlow.Instance;
            if (!flow || flow.Player == null) yield break;
            int seed0 = RunState.Current?.seed ?? 0;
            bool written = RunSuspend.Read(dev, out var saved, out var error) == SuspendStatus.Ok;
            Line($"暂离：进 1-1 后续玩档 {(written ? $"已写入（{saved.run.stageCode}，种子 {saved.run.seed}）" : $"没有（{error}）")}");
            if (!written || saved.run.seed != seed0 || saved.run.stageCode != "1-1") Fail("进 1-1 后续玩档没写对");
            int runs0 = CareerStats.Current.Runs;
            GameSession.Instance.SetPaused(true);
            yield return null;
            var pause = UIRouter.Find(PauseScreen.ScreenId) as PauseScreen;
            if (pause == null)
            {
                Fail("暂停后没有暂停菜单");
                yield break;
            }
            if (!PauseScreen.CanSuspend) Fail("这一局有续玩档，暂停里「返回主菜单」却不是暂离");
            pause.Press("menu");
            yield return WaitMenu("暂离 → 主菜单");
            var main = UIRouter.Find(MainMenuScreen.ScreenId) as MainMenuScreen;
            var cam = MenuCamera.Instance ? MenuCamera.Instance.Camera : Camera.main;
            Line($"暂离 → 主菜单：{SceneManager.GetActiveScene().name}，局 {(RunState.Current == null ? "已清空" : "还在")}，生涯 {runs0} → {CareerStats.Current.Runs} 局，" +
                 $"「继续征程」{(main?.Suspended != null ? $"有（{main.Suspended.run.stageCode}）" : "没有")}");
            if (!MenuFlow.InMenu) Fail("暂离后没有回到主菜单");
            if (RunState.Current != null) Fail("暂离后局状态没有清空");
            if (CareerStats.Current.Runs != runs0) Fail("暂离结算了这一局（生涯局数变了）");
            if (main?.Suspended == null) Fail("暂离回主菜单后没有「继续征程」");
            yield return new WaitForSecondsRealtime(1.2f);
            yield return MenuShot(cam, "runends_suspended_menu");

            // 有未完成的征程时出征：先弹确认框
            bool started = MenuFlow.StartRun(HeroLibrary.DefaultHero);
            yield return null;
            var confirm = UIRouter.Find(ConfirmScreen.ScreenId) as ConfirmScreen;
            Line($"有未完成的征程时出征：{(started ? "直接开了新局" : "没有直接开局")}，确认框 {(confirm != null ? $"「{confirm.Message}」" : "没有")}");
            if (started) Fail("有未完成的征程时出征没有先确认");
            if (confirm == null)
            {
                Fail("有未完成的征程时出征没有弹确认框");
                yield break;
            }
            if (confirm.Message == null || !confirm.Message.Contains("1-1")) Fail("确认框里没写当前征程的关卡");
            yield return new WaitForSecondsRealtime(0.5f);
            yield return MenuShot(cam, "runends_confirm_newrun");
            confirm.Cancel();
            yield return null;
            yield return null;
            Line($"取消：确认框 {(UIRouter.IsOpen(ConfirmScreen.ScreenId) ? "还开着" : "已关")}，续玩档 {(RunSuspend.Exists(dev) ? "还在" : "没了")}，生涯 {CareerStats.Current.Runs} 局，局 {(RunState.Current == null ? "没开" : "开了")}");
            if (UIRouter.IsOpen(ConfirmScreen.ScreenId)) Fail("取消后确认框还开着");
            if (!RunSuspend.Exists(dev)) Fail("取消后续玩档没了");
            if (CareerStats.Current.Runs != runs0) Fail("取消也结算了旧局");
            if (MenuFlow.Busy || RunState.Current != null || !MenuFlow.InMenu) Fail("取消后还是开了新局");

            // 再出征 → 确认：旧局按败北结算、开新局
            MenuFlow.StartRun(HeroLibrary.DefaultHero);
            yield return null;
            confirm = UIRouter.Find(ConfirmScreen.ScreenId) as ConfirmScreen;
            if (confirm == null)
            {
                Fail("第二次出征没有弹确认框");
                yield break;
            }
            confirm.Confirm();
            yield return WaitReady("确认放弃后出征进 1-1", -1);
            var run = RunState.Current;
            bool rewritten = RunSuspend.Read(dev, out saved, out _) == SuspendStatus.Ok;
            Line($"确认放弃：生涯 {runs0} → {CareerStats.Current.Runs} 局，新局种子 {seed0} → {run?.seed}，" +
                 $"续玩档 {(rewritten ? $"是新局的（{saved.run.seed}）" : "没有")}");
            if (CareerStats.Current.Runs != runs0 + 1) Fail("确认放弃后旧局没有按败北结算（生涯局数没 +1）");
            if (run == null || run.seed == seed0) Fail("确认放弃后没有开新局");
            if (!rewritten || run == null || saved.run.seed != run.seed) Fail("新局进 1-1 后续玩档没换成新局的");
        }

        IEnumerator WaitReady(string what, int transitionsBefore)
        {
            float t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < LoadTimeout)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Player != null && f.Player.root && f.CurrentScene.IsValid() && !MenuFlow.Busy && f.Transitions > transitionsBefore)
                {
                    yield return new WaitForSecondsRealtime(0.5f);
                    yield break;
                }
                yield return null;
            }
            Fail($"{what}：{LoadTimeout:F0} s 内没有就绪");
        }

        IEnumerator WaitSummary(System.Action<SummaryScreen> got, float seconds)
        {
            float t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < seconds)
            {
                if (UIRouter.Find(MenuFlow.SummaryScreenId) is SummaryScreen s)
                {
                    got(s);
                    yield break;
                }
                yield return null;
            }
        }

        IEnumerator ToMenu(SummaryScreen sum, string what)
        {
            if (sum != null) sum.ToMenu();
            else MenuFlow.ToMenu();
            yield return WaitMenu($"{what} → 主菜单");
            Line($"{what} → 主菜单：{SceneManager.GetActiveScene().name}，主菜单界面 {(UIRouter.IsOpen(MainMenuScreen.ScreenId) ? "已打开" : "没有")}，局 {(RunState.Current == null ? "已清空" : "还在")}，时间 ×{Time.timeScale}");
            if (!MenuFlow.InMenu) Fail($"{what}：结算点「主菜单」后没有回到主菜单场景");
            if (!UIRouter.IsOpen(MainMenuScreen.ScreenId)) Fail($"{what}：回主菜单后主菜单界面没有打开");
            if (RunState.Current != null) Fail($"{what}：回主菜单后局状态没有清空");
            if (Time.timeScale != 1) Fail($"{what}：回主菜单后时间 ×{Time.timeScale}");
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
