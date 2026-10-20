using System;
using System.Collections;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.SceneManagement;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 局外与局内界面冒烟（bridge.sh playtest menu；场景 MainMenu，S7 / U4 / U5 / U6 验收）：
    ///   1. 启动 → 主菜单：MenuDirector 就绪、主菜单界面打开、状态 Menu、时间 ×1、主菜单在构建设置里（打包版 Core 启动后转过来）；
    ///   2. 天赋（给调试档 500 魂晶，买一级，等级 +1、魂晶扣对）、设置（控件数 = GameSettings 条目数，切到「按键」页）、操作说明，各开一次再返回；
    ///   3. 选英雄：镜头推到祭台、祭台站着当前选中的英雄；逐个切换三位英雄（祭台换人、截图）；拖拽转 120 px 再松手，1.6 s 后转回默认朝向；
    ///      手柄式导航（↓）换人；
    ///   4. 出征：整场景切到 Core、叠加加载第一关（1-1）、玩家组装好、英雄是选的那位、界面栈清空、正常游玩；
    ///   5. 暂停：弹出、时间停；叠设置页再返回；「放弃本局」按一次进入待确认（不结束）；返回键继续、时间恢复；
    ///   6. Tab 行囊：打开、停时间、武器卡 ≥ 1、切灵宠页；返回关掉；
    ///   7. 秘卷三选一：弹出、停时间、截图；选第一张后层数 +1、时间恢复；触发弹字出现；
    ///   8. 强制结束本局（RunEnd.Force）：结算界面弹出、停时间、计数滚完、生涯 +1 局；「主菜单」回到主菜单场景。
    /// 全程用调试档（SaveService.ForceDev），不碰正式存档；结束时还原。
    /// </summary>
    public sealed class MenuSuite : PlaytestSuite
    {
        public override string Id => "menu";
        public override string Scene => MenuFlow.MenuScenePath;

        const float LoadTimeout = 90f;

        protected override IEnumerator Steps()
        {
            bool forceDev = SaveService.ForceDev;
            SaveService.ForceDev = true;
            try
            {
                yield return Run();
            }
            finally
            {
                SaveService.ForceDev = forceDev;
            }
        }

        IEnumerator Run()
        {
            // ── 1. 启动 → 主菜单 ──
            float t0 = Time.realtimeSinceStartup;
            while ((!MenuDirector.Instance || !MenuDirector.Instance.Ready) && Time.realtimeSinceStartup - t0 < 10f) yield return null;
            if (!MenuDirector.Instance)
            {
                Fail("主菜单场景里没有 MenuDirector（先 bridge.sh menu 生成 MainMenu.unity）");
                yield break;
            }
            yield return new WaitForSecondsRealtime(1.6f);
            var main = UIRouter.Find(MainMenuScreen.ScreenId) as MainMenuScreen;
            Line($"主菜单：界面 {(main != null ? "已打开" : "没有")}，状态 {GameStateMachine.Current}，时间 ×{Time.timeScale}，" +
                 $"构建设置里{(SceneUtility.GetBuildIndexByScenePath(MenuFlow.MenuScenePath) >= 0 ? "有" : "没有")}主菜单（Core 第 {SceneUtility.GetBuildIndexByScenePath(SceneFlow.CorePath)} 个）");
            if (main == null) Fail("主菜单界面没有打开");
            if (GameStateMachine.Current != GameState.Menu) Fail($"主菜单里状态是 {GameStateMachine.Current}，应为 Menu");
            if (Time.timeScale != 1) Fail($"主菜单里时间 ×{Time.timeScale}");
            if (SceneUtility.GetBuildIndexByScenePath(MenuFlow.MenuScenePath) < 0) Fail("主菜单场景不在构建设置里（打包版进不了主菜单）");
            if (Cursor.lockState != CursorLockMode.None) Fail("主菜单里鼠标被锁住了");
            var cam = MenuCamera.Instance ? MenuCamera.Instance.Camera : Camera.main;
            Shot(cam, "menu_home");

            // ── 2. 天赋 / 设置 / 操作说明 ──
            var meta = MetaSave.Current;
            meta.AddEssence(500);
            UIRouter.Open(TalentScreen.ScreenId);
            yield return new WaitForSecondsRealtime(0.5f);
            var talents = UIRouter.Find(TalentScreen.ScreenId) as TalentScreen;
            var first = TalentLibrary.All.FirstOrDefault(t => meta.TalentLevel(t.id) < t.maxLevel);
            if (talents == null) Fail("天赋界面没有打开");
            else if (first != null)
            {
                int lv = meta.TalentLevel(first.id), have = meta.Essence, cost = first.Cost(lv);
                bool ok = talents.Buy(first);
                Line($"天赋：买「{first.name}」{lv} → {meta.TalentLevel(first.id)} 级，魂晶 {have} → {meta.Essence}（价 {cost}）");
                if (!ok || meta.TalentLevel(first.id) != lv + 1) Fail("买天赋没有升级");
                if (meta.Essence != have - cost) Fail($"买天赋扣了 {have - meta.Essence} 魂晶，应为 {cost}");
                if (main != null && !main.Covered) Fail("天赋页打开时主菜单本体没有让开");
                Shot(cam, "menu_talents");
            }
            UIRouter.Back();
            yield return new WaitForSecondsRealtime(0.3f);
            if (UIRouter.IsOpen(TalentScreen.ScreenId)) Fail("返回后天赋页还开着");

            UIRouter.Open(SettingsScreen.ScreenId);
            yield return new WaitForSecondsRealtime(0.4f);
            if (UIRouter.Find(SettingsScreen.ScreenId) is SettingsScreen settings)
            {
                Line($"设置：自动生成控件 {settings.GeneratedControls} 个（GameSettings {GameSettings.All.Count} 条），页签 {settings.CurrentTab}");
                if (settings.GeneratedControls != GameSettings.All.Count) Fail("设置控件数和 GameSettings 条目数对不上");
                Shot(cam, "menu_settings");
                if (!settings.Select(SettingsScreen.KeysTab)) Fail("设置里没有「按键」页");
                yield return new WaitForSecondsRealtime(0.3f);
                Shot(cam, "menu_settings_keys");
            }
            else Fail("设置界面没有打开");
            UIRouter.Back();
            UIRouter.Open(ControlsScreen.ScreenId);
            yield return new WaitForSecondsRealtime(0.4f);
            if (!UIRouter.IsOpen(ControlsScreen.ScreenId)) Fail("操作说明没有打开");
            Shot(cam, "menu_controls");
            UIRouter.Back();
            yield return new WaitForSecondsRealtime(0.4f);
            if (UIRouter.Top != main) Fail($"关掉子页后栈顶是 {UIRouter.Top?.Id}，应为主菜单");

            // ── 3. 选英雄 ──
            main?.StartGame();
            yield return new WaitForSecondsRealtime(1.4f);
            var select = UIRouter.Find(HeroSelectScreen.ScreenId) as HeroSelectScreen;
            var stage = HeroStage.Instance;
            if (select == null || !stage)
            {
                Fail($"选英雄{(select == null ? "界面没有打开" : "祭台 HeroStage 不在场景里")}");
                yield break;
            }
            Line($"选英雄：镜头 {MenuCamera.Instance?.Current}，祭台上 {stage.Current}（{(stage.Placeholder ? "占位体" : stage.Shown ? stage.Shown.name : "无")}），选中 {select.Selected?.id}");
            if (MenuCamera.Instance && MenuCamera.Instance.Current != MenuCamera.Pose.Heroes) Fail("选英雄时镜头没有推到祭台");
            if (stage.Current != select.Selected?.id) Fail("祭台上的英雄和选中的不一致");
            var heroes = HeroLibrary.All;
            for (int i = 0; i < heroes.Count; i++)
            {
                int shows = stage.ShowCount;
                select.Select(i, true);
                yield return new WaitForSecondsRealtime(1.3f);
                Line($"  {heroes[i].id}：祭台 {stage.Current}，{(stage.Placeholder ? "占位体" : stage.Shown ? stage.Shown.name : "无")}");
                if (stage.Current != heroes[i].id) Fail($"选 {heroes[i].name} 后祭台上是 {stage.Current}");
                if (i != 0 && stage.ShowCount == shows) Fail("换人后祭台没有重新亮相");
                if (stage.Placeholder) Fail($"{heroes[i].name} 没有展示模型，用的是占位体");
                Shot(cam, $"menu_hero_{heroes[i].id}");
            }
            float yaw0 = stage.Yaw;
            stage.BeginDrag();
            for (int i = 0; i < 6; i++)
            {
                stage.Drag(20);
                yield return null;
            }
            stage.EndDrag();
            float dragged = Mathf.DeltaAngle(yaw0, stage.Yaw);
            yield return new WaitForSecondsRealtime(3.2f);
            float back = Mathf.Abs(Mathf.DeltaAngle(stage.DefaultYaw, stage.Yaw));
            Line($"拖拽：120 px 转了 {dragged:F0}°，松手 3.2 s 后离默认朝向 {back:F1}°");
            if (Mathf.Abs(dragged) < 30) Fail("拖拽没有转动英雄");
            if (back > 6) Fail("松手后英雄没有转回默认朝向");
            var before = select.Selected;
            UIRouter.Navigate(new Vector2Int(0, -1));
            yield return new WaitForSecondsRealtime(0.3f);
            if (select.Selected == before && heroes.Count > 1) Fail("名录上按 ↓ 没有换人");
            select.Select(0, false);
            yield return new WaitForSecondsRealtime(0.5f);
            var hero = select.Selected;

            // ── 4. 出征 → 1-1 ──
            select.Confirm();
            t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < LoadTimeout)
            {
                var flow = SceneFlow.Instance;
                if (flow && !flow.Busy && flow.Player != null && flow.CurrentScene.IsValid() && !MenuFlow.Busy) break;
                yield return null;
            }
            var f = SceneFlow.Instance;
            if (!f || f.Player == null)
            {
                Fail($"出征后 {LoadTimeout:F0} s 内没有进第一关（Core 场景 / 1-1 场景在不在？）");
                yield break;
            }
            yield return new WaitForSecondsRealtime(1f);
            var run = RunState.Current;
            Line($"出征：{f.Current?.Label ?? f.CurrentScene.path}，英雄 {run?.heroId}（选的 {hero?.id}），调试局 {run?.dev}，界面栈 {UIRouter.Count}，状态 {GameStateMachine.Current}，时间 ×{Time.timeScale}");
            if (f.Current == null || f.Current != RunPlan.First) Fail($"出征后进的不是第一关（{f.Current?.Label}）");
            if (run == null || run.heroId != hero?.id) Fail("出征的英雄不是选的那位");
            if (UIRouter.Count != 0) Fail($"进关后还有界面开着：{UIRouter.Top?.Id}");
            if (!GameStateMachine.IsPlaying) Fail($"进关后不在游玩状态（{GameStateMachine.Current}）");
            var weapons = f.Player.weapons;
            var gameCam = weapons ? weapons.eye : Camera.main;
            Shot(gameCam, "menu_run_start");

            // ── 5. 暂停 ──
            var session = GameSession.Instance;
            session.SetPaused(true);
            yield return null;
            var pause = UIRouter.Find(PauseScreen.ScreenId) as PauseScreen;
            Line($"暂停：菜单 {(PauseMenu.Open ? "已打开" : "没有")}，时间 ×{Time.timeScale}");
            if (!PauseMenu.Open || pause == null) Fail("暂停后没有弹出暂停菜单");
            if (Time.timeScale != 0) Fail("暂停后时间没有停");
            yield return new WaitForSecondsRealtime(0.4f);
            Shot(gameCam, "menu_pause");
            UIRouter.Open(SettingsScreen.ScreenId);
            yield return new WaitForSecondsRealtime(0.3f);
            Shot(gameCam, "menu_pause_settings");
            UIRouter.Back();
            yield return null;
            if (UIRouter.Top != (IScreen)pause) Fail("设置页返回后没有回到暂停菜单");
            pause?.Press("abandon");
            Line($"放弃本局按一次：待确认 {pause?.Armed}，局还在 {RunState.Current != null && RunState.Current.Flag(MetaSave.BankedFlag) == 0}");
            if (pause != null && pause.Armed != "abandon") Fail("放弃本局按一次没有进入待确认");
            if (RunState.Current == null || RunState.Current.Flag(MetaSave.BankedFlag) != 0) Fail("放弃本局只按一次就结算了");
            UIRouter.Back();
            yield return null;
            if (PauseMenu.Open) Fail("返回键没有关掉暂停菜单");
            if (session.Paused) Fail("返回键关掉暂停菜单后游戏仍是暂停状态");
            if (Time.timeScale != 1) Fail($"继续游戏后时间 ×{Time.timeScale}");

            // ── 6. Tab 行囊 ──
            UIRouter.Open(InventoryPanel.ScreenId);
            yield return new WaitForSecondsRealtime(0.4f);
            if (UIRouter.Find(InventoryPanel.ScreenId) is InventoryPanel inv)
            {
                Line($"行囊：秘卷 {inv.ScrollRows} 卷，武器卡 {inv.WeaponCards} 张，时间 ×{Time.timeScale}");
                if (inv.WeaponCards < 1) Fail("行囊里没有武器卡");
                if (Time.timeScale != 0) Fail("行囊打开时时间没有停");
                Shot(gameCam, "menu_inventory");
                inv.Select(1);
                yield return new WaitForSecondsRealtime(0.2f);
                if (inv.CurrentTab != InventoryPanel.PetTab) Fail("行囊切不到灵宠页");
                Shot(gameCam, "menu_inventory_pet");
            }
            else Fail("行囊面板没有打开");
            UIRouter.Back();
            yield return null;
            if (UIRouter.IsOpen(InventoryPanel.ScreenId)) Fail("返回后行囊还开着");
            if (Time.timeScale != 1) Fail($"关掉行囊后时间 ×{Time.timeScale}");

            // ── 7. 秘卷三选一 + 触发弹字 ──
            var scrolls = ScrollList.Inventory;
            if (scrolls != null)
            {
                var choices = ScrollLibrary.Roll(scrolls, 3);
                ScrollDef picked = null;
                ScrollChoice.Show(choices, scrolls, d =>
                {
                    picked = d;
                    scrolls.Gain(d, PlayerVitals.Instance);
                });
                yield return new WaitForSecondsRealtime(1.2f);
                Line($"秘卷三选一：{(ScrollChoice.Open ? "已弹出" : "没有")}，{string.Join(" / ", choices.Select(c => $"{c.name}（{Rarity.Name(c.rarity)}）"))}，时间 ×{Time.timeScale}");
                if (!ScrollChoice.Open) Fail("秘卷三选一没有弹出");
                if (Time.timeScale != 0) Fail("秘卷三选一时时间没有停");
                Shot(gameCam, "menu_scroll_choice");
                int stacks0 = scrolls.TotalStacks;
                ScrollChoice.Pick(0);
                yield return null;
                if (picked == null || scrolls.TotalStacks != stacks0 + 1) Fail("选了秘卷但层数没有增加");
                if (ScrollChoice.Open) Fail("选完秘卷三选一还开着");
                if (Time.timeScale != 1) Fail($"选完秘卷后时间 ×{Time.timeScale}");
                if (picked != null)
                {
                    GameEvents.RaiseScrollProc(picked.id);
                    yield return null;
                    var pop = Hud.Instance ? Hud.Instance.Widget<ScrollProcPop>() : null;
                    Line($"触发弹字：{(pop != null ? $"{pop.Count} 行" : "没有部件")}");
                    if (pop == null || pop.Count < 1) Fail("秘卷触发后没有弹字");
                    yield return new WaitForSecondsRealtime(0.05f);
                    Shot(gameCam, "menu_scroll_proc");
                }
            }
            else Fail("没有本局秘卷持有（LootDirector）");

            // ── 8. 强制结束 → 结算 → 主菜单 ──
            int runs0 = CareerStats.Current.Runs;
            var summary = RunEnd.Force(false);
            yield return new WaitForSecondsRealtime(0.2f);
            var sum = UIRouter.Find(MenuFlow.SummaryScreenId) as SummaryScreen;
            Line($"结算：界面 {(sum != null ? "已弹出" : "没有")}，状态 {GameStateMachine.Current}，时间 ×{Time.timeScale}，魂晶 +{summary?.essenceEarned}，生涯 {runs0} → {CareerStats.Current.Runs} 局");
            if (sum == null) Fail("强制结束本局后没有弹出结算界面");
            if (GameStateMachine.Current != GameState.Summary) Fail($"结算时状态是 {GameStateMachine.Current}");
            if (Time.timeScale != 0) Fail("结算时时间没有停");
            if (CareerStats.Current.Runs != runs0 + 1) Fail("结算后生涯局数没有 +1");
            t0 = Time.realtimeSinceStartup;
            while (sum != null && !sum.Settled && Time.realtimeSinceStartup - t0 < 4f) yield return null;
            Shot(gameCam, "menu_summary");
            sum?.ToMenu();
            t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < LoadTimeout && (!MenuDirector.Instance || !MenuDirector.Instance.Ready || MenuFlow.Busy)) yield return null;
            yield return new WaitForSecondsRealtime(1f);
            Line($"回主菜单：{SceneManager.GetActiveScene().name}，主菜单界面 {(UIRouter.IsOpen(MainMenuScreen.ScreenId) ? "已打开" : "没有")}，局 {(RunState.Current == null ? "已清空" : "还在")}");
            if (!MenuFlow.InMenu) Fail("结算点「主菜单」后没有回到主菜单场景");
            if (!UIRouter.IsOpen(MainMenuScreen.ScreenId)) Fail("回主菜单后主菜单界面没有打开");
            if (RunState.Current != null) Fail("回主菜单后局状态没有清空");
            if (Time.timeScale != 1) Fail($"回主菜单后时间 ×{Time.timeScale}");
            Shot(MenuCamera.Instance ? MenuCamera.Instance.Camera : Camera.main, "menu_back_home");
        }
    }
}
