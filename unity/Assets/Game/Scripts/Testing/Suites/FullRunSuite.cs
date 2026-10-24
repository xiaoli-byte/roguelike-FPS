using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityEngine;
using UnityEngine.SceneManagement;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 整局自动化通关（I2，docs/unity-parity.md 7.5；bridge.sh playtest full-run，场景 MainMenu）：
    ///   主菜单 → 选英雄 → 出征 → 1-1 … 3-4，每关由 <see cref="RunBot"/> 清完必清场地 / 打赢首领 / 开宝箱 / 补给营买一件 / 进出口 →
    ///   关间结算卡（<see cref="StageCardScreen"/>：内容对得上 RunPlan 的下一关）→「继续」→ 下一关 → … → 3-4 火麒麟倒下 → 胜利链 →
    ///   整局结算（胜利、魂晶入账、生涯 +1 局 +1 胜）→「主菜单」→ 回到主菜单、局已清空。
    /// 每关检查：进的是 RunPlan 的下一关、局难度 = RunPlan 的难度、补给营与 RunPlan 一致、跨关状态原样带过去（武器 id / 品质 / 强化 / 元素、
    ///   秘卷层数、灵石、灵宠种类 / 等级、生命护盾；备弹只许因进关补给变多）、运行时没有报错（宿主记）。占位件 / 占位体敌人 / 首领代理模型只记不判。
    /// 每关输出：真实耗时 / 游戏耗时 / 换关载入、倒下次数、灵石进账 / 花费 / 余额、击杀 / 补刀、宝箱、秘卷层数、首领用时、帧时 P95、手上的枪；
    ///   结尾打整局汇总，并写 Assets/Art/_Review/fullrun_report.txt。
    ///
    /// 测试加速（见 <see cref="RunBot"/>）：玩家伤害 × 8、游戏时间 × 4、登场演出关掉、致命一击拦下回满（记「倒下」）、备弹补满、
    ///   场地 60 / 首领 150 游戏秒没打完补刀（记一条）、场地之间传送（路径完整性照算照记；走路可达性由各图 map-* 套件验）。
    /// 全程用调试档（SaveService.ForceDev），不碰正式存档；试玩开关强制关（完整版 12 关）。
    ///
    /// 一次试玩超过 600 s 的上限时按章分段跑（<see cref="FullRunCh1Suite"/> → <see cref="FullRunCh2Suite"/> → <see cref="FullRunCh3Suite"/>）：
    ///   第一段从主菜单选英雄出征，打完 1-4 继续进到 2-1 就绪，把 2-1 的进关快照和前面各关成绩写进接力档（<see cref="RunRelay"/>）；
    ///   第二段从主菜单读接力档、把它设成当前局直接进 Core（SceneFlow 从 2-1 接着走），打到 3-1 就绪再写接力档；第三段从 3-1 打到胜利结算 → 主菜单，
    ///   汇总三段的成绩。没有接力档时这一段从自己的第一关新开一局（记一条，不算串起来）。
    /// </summary>
    public class FullRunSuite : PlaytestSuite
    {
        public override string Id => "full-run";
        public override string Scene => MenuFlow.MenuScenePath;

        /// <summary>这一段从哪一关打到哪一关（含）</summary>
        protected virtual string FirstStage => "1-1";
        protected virtual string LastStage => "3-4";
        /// <summary>出征的英雄（缺省 = 默认英雄）</summary>
        protected virtual string Hero => HeroLibrary.DefaultHero;

        const float LoadTimeout = 90f;

        RunBot bot;
        readonly List<StageRecord> records = new();
        readonly List<float> segmentSeconds = new();
        int relayDowns;
        bool chained = true;
        float started;

        protected override IEnumerator Steps()
        {
            bool forceDev = SaveService.ForceDev;
            string demo = RunPlan.DemoEnd;
            SaveService.ForceDev = true;
            RunPlan.DemoEnd = null;
            started = Time.realtimeSinceStartup;
            bot = new RunBot(Runner, Line, Fail, (c, n) => Shot(c, n));
            try
            {
                yield return Run();
            }
            finally
            {
                bot.Uninstall();
                SaveService.ForceDev = forceDev;
                RunPlan.DemoEnd = demo;
            }
        }

        bool FromMenu => FirstStage == RunPlan.First.code;

        IEnumerator Run()
        {
            var first = RunPlan.Get(FirstStage);
            var last = RunPlan.Get(LastStage);
            Line($"整局冒烟 {Id}：{first.Label} → {last.Label}（加速：伤害 ×{RunBot.DamageMult}（首领 ×{RunBot.BossDamageMult}）、时间 ×{RunBot.TimeScale}、登场演出关、致命一击拦下记倒下、备弹补满、" +
                 $"场地 {RunBot.FightLimit:F0} / 首领 {RunBot.BossLimit:F0} 游戏秒补刀、场地间传送）");

            // ── 主菜单 ──
            float t0 = Time.realtimeSinceStartup;
            while ((!MenuDirector.Instance || !MenuDirector.Instance.Ready) && Time.realtimeSinceStartup - t0 < 15f) yield return null;
            if (!MenuDirector.Instance)
            {
                Fail("主菜单场景里没有 MenuDirector（先 bridge.sh menu）");
                yield break;
            }
            yield return new WaitForSecondsRealtime(0.8f);
            var meta = MetaSave.Current;
            int essence0 = meta.Essence, runs0 = CareerStats.Current.Runs, wins0 = CareerStats.Current.Wins;
            bot.Install();

            // ── 开局：主菜单出征（第一段）/ 接力档（后面的段）──
            if (FromMenu)
            {
                yield return StartFromMenu();
            }
            else
            {
                yield return StartFromRelay(first);
            }
            var flow = SceneFlow.Instance;
            if (!flow || flow.Player == null)
            {
                Fail("开局后没有进到关卡（SceneFlow / 玩家没就绪）");
                yield break;
            }
            if (flow.Current != first) Fail($"开局进的是 {flow.Current?.Label ?? flow.CurrentScene.path}，应为 {first.Label}");
            var run = RunState.Current;
            Line($"开局：{flow.Current?.Label}，英雄 {run?.heroId}，种子 {run?.seed}，调试局 {run?.dev}，灵石 {run?.coins}，武器 {Weapons()}");
            Shot(flow.Player.cam, $"fullrun_start_{first.code}");

            // ── 逐关 ──
            float load = 0;
            Carry carry = null;
            while (true)
            {
                flow = SceneFlow.Instance;
                var stage = flow.Current;
                if (stage == null)
                {
                    Fail("当前关卡不在 RunPlan 里");
                    yield break;
                }
                run = RunState.Current;
                Line($"══ {stage.Label}（难度 {run?.difficulty:0.00}{(stage.supplyCamp ? "，有补给营" : "")}{(stage.IsBoss ? "，首领关" : "")}）══");
                if (run == null || Mathf.Abs(run.difficulty - stage.difficulty) > 1e-4f) Fail($"{stage.code} 局难度 {run?.difficulty}，RunPlan 是 {stage.difficulty}");
                if (run != null && run.stageCode != stage.code) Fail($"RunState.stageCode = {run.stageCode}，当前关是 {stage.code}");
                if (carry != null) CheckCarry(carry, flow.EntrySnapshot, stage);
                var rec = bot.Begin(stage, load);
                records.Add(rec);
                yield return bot.PlayStage(stage);
                var session = GameSession.Instance;
                Line(Row(rec));
                if (!session || !session.Completed)
                {
                    Fail($"{stage.Label} 没有走到本关结算，整局停在这里");
                    yield return Report(false);
                    yield break;
                }
                if (RunPlan.IsFinal(stage))
                {
                    yield return Victory(essence0, runs0, wins0);
                    yield break;
                }

                // ── 关间结算卡 → 继续 ──
                var next = RunPlan.Next(stage);
                t0 = Time.realtimeSinceStartup;
                StageCardScreen card = null;
                while (Time.realtimeSinceStartup - t0 < 3f && (card = UIRouter.Find(StageCardScreen.ScreenId) as StageCardScreen) == null) yield return null;
                if (card == null)
                {
                    Fail($"{stage.Label} 结算后没有关间结算卡（栈顶 {UIRouter.Top?.Id ?? "无"}）");
                    if (!session.Completed) yield break;
                }
                else
                {
                    var info = card.Info;
                    Line($"关间结算卡：{info.StageLabel} 完成 · 用时 {info.time:F0} s · 击杀 {info.kills} · 灵石 {info.coinsDelta:+#;-#;0}（现有 {info.coins}）· 秘卷 {info.scrolls}（+{info.scrollsGained}）" +
                         $" → 下一关 {info.next?.Label ?? "无"}「{card.TagText}」");
                    if (info.next != next) Fail($"结算卡的下一关是 {info.next?.Label ?? "无"}，RunPlan 是 {next?.Label}");
                    if (!info.nextReady) Fail($"下一关 {next?.Label} 的场景加载不了（构建设置 / 磁盘上没有）");
                    if (Time.timeScale != 0) Fail($"结算卡打开时时间没停（×{Time.timeScale}）");
                    if (next != null && next.IsBoss && !card.TagText.Contains("首领")) Fail("下一关是首领关，结算卡上没写");
                    if (next != null && next.chapter != stage.chapter && !card.TagText.Contains("新章节")) Fail("换章了，结算卡上没写新章节");
                    yield return new WaitForSecondsRealtime(0.55f);
                    if (records.Count <= 2 || next != null && (next.IsBoss || next.chapter != stage.chapter)) Shot(flow.Player.cam, $"fullrun_card_{stage.code}");
                }
                carry = Carry.Take(flow.Player);
                int transitions = flow.Transitions;
                float l0 = Time.realtimeSinceStartup;
                if (card != null) card.Continue();
                else session.Continue();
                t0 = Time.realtimeSinceStartup;
                while (Time.realtimeSinceStartup - t0 < LoadTimeout)
                {
                    var f = SceneFlow.Instance;
                    if (f && !f.Busy && f.Transitions > transitions && f.Player != null && f.Player.root) break;
                    yield return null;
                }
                flow = SceneFlow.Instance;
                load = Time.realtimeSinceStartup - l0;
                if (!flow || flow.Busy || flow.Transitions <= transitions || flow.Player == null)
                {
                    Fail($"{stage.Label} → {next?.Label}：{LoadTimeout:F0} s 内没有换好关");
                    yield return Report(false);
                    yield break;
                }
                if (flow.Current != next) Fail($"{stage.Label} 之后进的是 {flow.Current?.Label ?? flow.CurrentScene.path}，RunPlan 是 {next?.Label}");
                Line($"换关 → {flow.Current?.Label}：{load:F1} s");
                if (UIRouter.IsOpen(StageCardScreen.ScreenId)) Fail("进了下一关结算卡还开着");

                // 这一段打完了：写接力档（下一章第一关的进关快照 + 各关成绩），交给下一段
                if (stage == RunPlan.Get(LastStage))
                {
                    CheckCarry(carry, flow.EntrySnapshot, flow.Current);
                    var relay = new RunRelay
                    {
                        writtenBy = Id, nextStage = flow.Current?.code, run = SceneFlow.CloneRun(flow.EntrySnapshot ?? RunState.Current),
                        records = records.ToList(), downs = relayDowns + bot.TotalDowns,
                    };
                    relay.segmentSeconds.AddRange(segmentSeconds);
                    relay.segmentSeconds.Add(Time.realtimeSinceStartup - started);
                    relay.Save();
                    Line($"接力档已写：下一段从 {relay.nextStage} 接着打（{RunRelay.FilePath}）");
                    Shot(flow.Player.cam, $"fullrun_handoff_{flow.Current?.code}");
                    yield return Report(true, segmentEnd: true);
                    yield break;
                }
            }
        }

        // ───────────── 开局 ─────────────

        IEnumerator StartFromMenu()
        {
            var main = UIRouter.Find(MainMenuScreen.ScreenId) as MainMenuScreen;
            if (main == null)
            {
                Fail("主菜单界面没有打开");
                yield break;
            }
            RunRelay.Delete();
            main.StartGame();
            float t0 = Time.realtimeSinceStartup;
            HeroSelectScreen select = null;
            while (Time.realtimeSinceStartup - t0 < 5f && (select = UIRouter.Find(HeroSelectScreen.ScreenId) as HeroSelectScreen) == null) yield return null;
            if (select == null)
            {
                Fail("「出征」后没有选英雄界面");
                yield break;
            }
            yield return new WaitForSecondsRealtime(0.6f);
            var heroes = HeroLibrary.All;
            for (int i = 0; i < heroes.Count; i++)
                if (heroes[i].id == Hero)
                {
                    select.Select(i, false);
                    break;
                }
            yield return new WaitForSecondsRealtime(0.4f);
            var hero = select.Selected;
            Line($"选英雄：{hero?.id}（{hero?.name}）");
            if (hero == null || hero.id != Hero) Fail($"选不到英雄 {Hero}");
            select.Confirm();
            yield return WaitReady("出征进第一关");
            if (RunState.Current == null || RunState.Current.heroId != hero?.id) Fail("出征的英雄不是选的那位");
        }

        IEnumerator StartFromRelay(StageSpec first)
        {
            var relay = RunRelay.Load(out var error);
            if (relay != null && relay.nextStage != first.code)
            {
                error = $"接力档是给 {relay.nextStage} 的（{relay.writtenBy} 写的），这一段从 {first.code} 开始";
                relay = null;
            }
            RunState run;
            if (relay == null)
            {
                chained = false;
                Line($"⚠ {error}：这一段从 {first.Label} 新开一局（不算和上一段串起来）");
                run = RunState.Begin(Hero, Environment.TickCount, first, true);
            }
            else
            {
                records.AddRange(relay.records ?? new List<StageRecord>());
                segmentSeconds.AddRange(relay.segmentSeconds ?? new List<float>());
                relayDowns = relay.downs;
                run = relay.run;
                run.dev = true;
                run.EnterStage(first);
                RunState.Current = run;
                Line($"读接力档（{relay.writtenBy}，{relay.writtenAt}）：前面 {records.Count} 关，英雄 {run.heroId}，灵石 {run.coins}，" +
                     $"武器 {string.Join("、", run.weapons.Select(w => $"{w.id}（{Rarity.Name(w.rarity)} +{w.level}）"))}，秘卷 {run.scrolls?.Values.Sum() ?? 0} 层，灵宠 {run.pet?.id ?? "无"}");
            }
            var expect = SceneFlow.CloneRun(run);
            // 同 MenuFlow 的切场景：整场景切到 Core，Core 的 SceneFlow 从当前局的关卡（RunState.stageCode）接着走
            GameStateMachine.Clear();
            UIRouter.CloseAll();
            var op = SceneManager.LoadSceneAsync(SceneFlow.CorePath, LoadSceneMode.Single);
            if (op == null)
            {
                Fail($"加载不了 {SceneFlow.CorePath}");
                yield break;
            }
            yield return WaitReady($"从接力档进 {first.Label}");
            if (relay != null && SceneFlow.Instance && SceneFlow.Instance.Player != null)
                CheckCarry(Carry.From(expect), SceneFlow.Instance.EntrySnapshot, first);
        }

        IEnumerator WaitReady(string what)
        {
            float t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < LoadTimeout)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Player != null && f.Player.root && f.CurrentScene.IsValid() && !MenuFlow.Busy) yield break;
                yield return null;
            }
            Fail($"{what}：{LoadTimeout:F0} s 内没有就绪");
        }

        // ───────────── 胜利 ─────────────

        IEnumerator Victory(int essence0, int runs0, int wins0)
        {
            Line("══ 胜利结算 ══");
            float t0 = Time.realtimeSinceStartup;
            SummaryScreen sum = null;
            while (Time.realtimeSinceStartup - t0 < 10f && (sum = UIRouter.Find(MenuFlow.SummaryScreenId) as SummaryScreen) == null) yield return null;
            var s = sum?.Summary ?? RunEnd.Last;
            var career = CareerStats.Current;
            int essence = MetaSave.Current.Essence;
            Line($"整局结算：界面 {(sum != null ? "已弹出" : "没有")}，{(s?.victory == true ? "胜利" : "不是胜利")}，清关 {s?.stagesCleared}，击杀 {s?.kills}，用时 {s?.time:F0} s，" +
                 $"魂晶 +{s?.essenceEarned}（局内 {s?.essenceCollected} + 通关 {s?.victoryBonus}），存档魂晶 {essence0} → {essence}，生涯 {runs0} → {career.Runs} 局 / {wins0} → {career.Wins} 胜");
            if (sum == null) Fail("3-4 打完没有弹出整局结算");
            if (s == null || !s.victory) Fail("整局结算不是胜利");
            if (s != null && essence < essence0 + s.essenceEarned) Fail($"魂晶没有入账（{essence0} + {s.essenceEarned} ≠ {essence}）");
            if (chained && career.Runs != runs0 + 1) Fail($"生涯局数 {runs0} → {career.Runs}（应 +1）");
            if (chained && career.Wins != wins0 + 1) Fail($"生涯胜场 {wins0} → {career.Wins}（应 +1）");
            if (s != null && SummaryScreen.Reach(s) != "已击败全部首领") Fail($"结算的止步处写的是「{SummaryScreen.Reach(s)}」");
            if (Time.timeScale != 0) Fail($"结算时时间没停（×{Time.timeScale}）");
            t0 = Time.realtimeSinceStartup;
            while (sum != null && !sum.Settled && Time.realtimeSinceStartup - t0 < 4f) yield return null;
            var cam = SceneFlow.Instance && SceneFlow.Instance.Player != null ? SceneFlow.Instance.Player.cam : Camera.main;
            Shot(cam, "fullrun_victory");

            // ── 回主菜单 ──
            bot.Uninstall();
            if (sum != null) sum.ToMenu();
            else MenuFlow.ToMenu(false);
            t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < LoadTimeout && (!MenuDirector.Instance || !MenuDirector.Instance.Ready || MenuFlow.Busy)) yield return null;
            yield return new WaitForSecondsRealtime(0.8f);
            Line($"回主菜单：{SceneManager.GetActiveScene().name}，主菜单界面 {(UIRouter.IsOpen(MainMenuScreen.ScreenId) ? "已打开" : "没有")}，局 {(RunState.Current == null ? "已清空" : "还在")}，时间 ×{Time.timeScale}");
            if (!MenuFlow.InMenu) Fail("结算点「主菜单」后没有回到主菜单场景");
            if (!UIRouter.IsOpen(MainMenuScreen.ScreenId)) Fail("回主菜单后主菜单界面没有打开");
            if (RunState.Current != null) Fail("回主菜单后局状态没有清空");
            Shot(MenuCamera.Instance ? MenuCamera.Instance.Camera : Camera.main, "fullrun_menu");
            RunRelay.Delete();
            yield return Report(true);
        }

        // ───────────── 跨关状态 ─────────────

        sealed class Carry
        {
            public List<string> weapons = new();
            public List<int> reserves = new();
            public Dictionary<string, int> scrolls = new();
            public int coins;
            public string pet;
            public int petLevel;
            public float hp, shield;

            public static Carry Take(PlayerRig p)
            {
                var c = new Carry();
                var run = RunState.Current;
                if (run != null) RunPersistence.CaptureAll(run);
                return From(run, c);
            }

            public static Carry From(RunState run, Carry c = null)
            {
                c ??= new Carry();
                if (run == null) return c;
                foreach (var w in run.weapons)
                {
                    c.weapons.Add($"{w.id}|{w.rarity}|+{w.level}|{w.element}|{(w.active ? "*" : "")}");
                    c.reserves.Add(w.reserve);
                }
                if (run.scrolls != null)
                    foreach (var kv in run.scrolls)
                        if (kv.Value > 0)
                            c.scrolls[kv.Key] = kv.Value;
                c.coins = run.coins;
                c.pet = run.pet?.id;
                c.petLevel = run.pet?.level ?? 0;
                c.hp = run.hp;
                c.shield = run.shield;
                return c;
            }
        }

        /// <summary>离关时的状态 vs 新关卡的进关快照：武器、秘卷、灵石、灵宠、生命护盾都原样带过去（备弹只许变多）</summary>
        void CheckCarry(Carry want, RunState entry, StageSpec stage)
        {
            if (want == null) return;
            if (entry == null)
            {
                Fail($"{stage?.code}：没有进关快照");
                return;
            }
            var got = Carry.From(entry);
            var problems = new List<string>();
            if (!want.weapons.SequenceEqual(got.weapons)) problems.Add($"武器 {string.Join(" ", want.weapons)} → {string.Join(" ", got.weapons)}");
            else
                for (int i = 0; i < want.reserves.Count && i < got.reserves.Count; i++)
                    if (got.reserves[i] < want.reserves[i]) problems.Add($"第 {i + 1} 把备弹 {want.reserves[i]} → {got.reserves[i]}");
            foreach (var kv in want.scrolls)
                if (!got.scrolls.TryGetValue(kv.Key, out var n) || n != kv.Value) problems.Add($"秘卷 {kv.Key} {kv.Value} → {n}");
            if (got.scrolls.Count != want.scrolls.Count) problems.Add($"秘卷种类 {want.scrolls.Count} → {got.scrolls.Count}");
            if (want.coins != got.coins) problems.Add($"灵石 {want.coins} → {got.coins}");
            if (want.pet != got.pet || want.petLevel != got.petLevel) problems.Add($"灵宠 {want.pet ?? "无"} Lv{want.petLevel} → {got.pet ?? "无"} Lv{got.petLevel}");
            if (want.hp >= 0 && Mathf.Abs(want.hp - got.hp) > 0.6f) problems.Add($"生命 {want.hp:F0} → {got.hp:F0}");
            if (want.shield >= 0 && Mathf.Abs(want.shield - got.shield) > 0.6f) problems.Add($"护盾 {want.shield:F0} → {got.shield:F0}");
            if (problems.Count > 0) Fail($"{stage?.code} 跨关状态没带过来：{string.Join("；", problems)}");
            else
                Line($"  ✓ 跨关状态带过来：武器 {want.weapons.Count} 把、秘卷 {want.scrolls.Values.Sum()} 层、灵石 {want.coins}、灵宠 {want.pet ?? "无"}" +
                     $"{(want.pet != null ? $" Lv{want.petLevel}" : "")}、生命 {got.hp:F0} 护盾 {got.shield:F0}");
        }

        string Weapons()
        {
            var wc = SceneFlow.Instance?.Player?.weapons;
            if (!wc) return "—";
            return string.Join("、", wc.slots.Where(w => w != null).Select(w => $"{w.def.name}（{Rarity.Name(w.rarity)} +{w.level}）"));
        }

        // ───────────── 报告 ─────────────

        static string Row(StageRecord r) =>
            $"  {r.code} {r.title}：{(r.completed ? "✓" : "✗")} 真实 {r.realSeconds:F0} s / 游戏 {r.gameSeconds:F0} s（载入 {r.loadSeconds:F1} s），倒下 {r.downs}，" +
            $"灵石 +{r.income} −{r.spent} = {r.coinsEnd}，魂晶 +{r.essence}，击杀 {r.kills}（补刀 {r.executed}），宝箱 {r.chests}，买 {r.bought}，秘卷 {r.scrolls} 层，" +
            (r.sitesRequired > 0 ? $"必清 {r.sitesCleared}/{r.sitesRequired}，" : "") + (r.bossSeconds > 0 ? $"首领 {r.bossSeconds:F0} 游戏秒，" : "") +
            $"帧时 P95 {r.frameP95Ms:F0} ms，路程 {r.pathMeters:F0} m，枪 {r.Weapons}";

        IEnumerator Report(bool ok, bool segmentEnd = false)
        {
            float segment = Time.realtimeSinceStartup - started;
            var all = new List<float>(segmentSeconds) { segment };
            var sb = new StringBuilder();
            sb.AppendLine($"整局冒烟报告 · {Id} · {DateTime.Now:yyyy-MM-dd HH:mm}{(segmentEnd ? "（分段，未到结尾）" : "")}{(chained ? "" : "（没有接上一段的接力档）")}");
            sb.AppendLine($"加速：伤害 ×{RunBot.DamageMult}（首领 ×{RunBot.BossDamageMult}），时间 ×{RunBot.TimeScale}，登场演出关，致命一击拦下记倒下，备弹补满，场地 {RunBot.FightLimit:F0} / 首领 {RunBot.BossLimit:F0} 游戏秒补刀，场地间传送");
            sb.AppendLine($"各段真实耗时：{string.Join(" + ", all.Select(x => $"{x:F0} s"))} = {all.Sum():F0} s");
            sb.AppendLine("关   名称                真实s  游戏s  载入s  倒下  进账  花费  余额  魂晶  击杀  补刀  宝箱  秘卷  首领s  P95ms");
            foreach (var r in records)
                sb.AppendLine($"{r.code,-4} {Pad(r.title, 18)} {r.realSeconds,5:F0}  {r.gameSeconds,5:F0}  {r.loadSeconds,5:F1}  {r.downs,4}  {r.income,4}  {r.spent,4}  {r.coinsEnd,4}  " +
                              $"{r.essence,4}  {r.kills,4}  {r.executed,4}  {r.chests,4}  {r.scrolls,4}  {r.bossSeconds,5:F0}  {r.frameP95Ms,5:F0}{(r.completed ? "" : "  ✗未完成")}");
            sb.AppendLine($"合计 {records.Count} 关：真实 {records.Sum(r => r.realSeconds):F0} s（+载入 {records.Sum(r => r.loadSeconds):F0} s），游戏 {records.Sum(r => r.gameSeconds):F0} s，" +
                          $"倒下 {records.Sum(r => r.downs)}，灵石进账 {records.Sum(r => r.income)} / 花费 {records.Sum(r => r.spent)}，魂晶 {records.Sum(r => r.essence)}，" +
                          $"击杀 {records.Sum(r => r.kills)}（补刀 {records.Sum(r => r.executed)}），宝箱 {records.Sum(r => r.chests)}");
            sb.AppendLine("手上的枪：");
            foreach (var r in records) sb.AppendLine($"  {r.code}：{r.Weapons}");
            var notes = records.Where(r => r.notes.Count > 0).ToList();
            if (notes.Count > 0)
            {
                sb.AppendLine("记录的问题（不判不合格）：");
                foreach (var r in notes)
                foreach (var n in r.notes.Distinct())
                    sb.AppendLine($"  {r.code}：{n}");
            }
            sb.AppendLine(ok ? (segmentEnd ? "这一段跑完" : "整局跑完") : "整局没跑完");
            string report = sb.ToString();
            foreach (var l in report.Split('\n'))
                if (!string.IsNullOrWhiteSpace(l)) Line(l.TrimEnd('\r'));
            try
            {
                if (!string.IsNullOrEmpty(ShotDir))
                {
                    Directory.CreateDirectory(ShotDir);
                    File.WriteAllText(Path.Combine(ShotDir, segmentEnd ? $"fullrun_report_{Id}.txt" : "fullrun_report.txt"), report, Encoding.UTF8);
                }
            }
            catch (IOException e)
            {
                Line($"报告写不了：{e.Message}");
            }
            yield break;
        }

        static string Pad(string s, int width)
        {
            // 中文按两格算
            int w = s.Sum(ch => ch > 0x2E80 ? 2 : 1);
            return w >= width ? s : s + new string(' ', width - w);
        }
    }

    /// <summary>整局冒烟 · 第一段（bridge.sh playtest full-run-ch1）：主菜单选英雄出征 → 1-1 … 1-4 → 进到 2-1 就绪，写接力档</summary>
    public sealed class FullRunCh1Suite : FullRunSuite
    {
        public override string Id => "full-run-ch1";
        protected override string LastStage => "1-4";
    }

    /// <summary>整局冒烟 · 第二段（bridge.sh playtest full-run-ch2）：读接力档从 2-1 接着打 → 2-4 → 进到 3-1 就绪，写接力档</summary>
    public sealed class FullRunCh2Suite : FullRunSuite
    {
        public override string Id => "full-run-ch2";
        protected override string FirstStage => "2-1";
        protected override string LastStage => "2-4";
    }

    /// <summary>整局冒烟 · 第三段（bridge.sh playtest full-run-ch3）：读接力档从 3-1 接着打 → 3-4 火麒麟 → 胜利结算 → 主菜单，汇总三段</summary>
    public sealed class FullRunCh3Suite : FullRunSuite
    {
        public override string Id => "full-run-ch3";
        protected override string FirstStage => "3-1";
    }
}
