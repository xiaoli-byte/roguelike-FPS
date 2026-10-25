using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 中途续玩与图鉴（I5；bridge.sh playtest suspend，场景 MainMenu）：
    ///   1. 主菜单（调试档，先清掉旧的续玩档和调试档图鉴）：没有「继续征程」；
    ///   2. 出征 → 1-1：续玩档写入（1-1）；在 1-1 攒一身家当——灵石 / 魂晶 / 击杀 / 用时 / 剧情标记、第二把枪（传说品质 +2、雷元素、一条随机词条 + 传说特性「鼎沸」）、
    ///      三卷秘卷（一卷两层）、灵宠（3 级）、生命六成；打一只跳鼠刀兵（图鉴收录敌人）；
    ///   3. 进到 1-2 开头（F8 同款换关）：续玩档换成 1-2 的进关快照（种子 / 英雄一致），记下进关快照、手上的东西、一条没用过的随机流的前几个数；
    ///   4. 暂停「返回主菜单」= 暂离：回主菜单、局清空、不结算（生涯局数不变）、续玩档还在，主菜单出现「继续征程」（写着 1-2）；
    ///   5. 图鉴：这一局拿到的武器 / 秘卷 / 敌人 / 灵宠都已收录、写进了 profile.dev.json；打开图鉴，四个页签逐个看、武器 / 秘卷翻页、
    ///      缩略图拍出来，未收录的显示「？？？」，截图；
    ///   6.「继续征程」→ 回到 1-2 开头：进关快照逐项一致（英雄、种子、关卡、难度、用时、伤害、灵石、魂晶、击杀、清关数、标记、
    ///      秘卷及顺序、两把枪的品质 / 强化 / 元素 / 弹药 / 词条 / 传说、灵宠等级 / 经验 / 冷却、生命护盾），手上的枪 / 秘卷 / 灵宠与暂离前一致，随机流接着同一串；
    ///   7. 放弃这一局（暂停「放弃本局」两次）→ 结算 → 主菜单：续玩档已删、没有「继续征程」；
    ///   8. 坏档：往 run.dev.json 写半截 JSON →「继续征程」提示损坏并丢弃（挪成 .corrupt），不崩、不进局。
    /// 天赋开局锁定（穿插在上面几步里）：出征前把调试档的天赋定成「生命 1 级、护盾 0 级」；第 4 步暂离后在天赋页买生命、护盾各一级（元进度照常涨），
    ///   第 6 步继续征程后玩家身上的天赋修正、生命 / 护盾上限和暂离前一模一样（续玩档里是开局快照）；
    ///   第 7 步放弃后再出征一局：新局的快照和玩家身上都是新买的等级，然后放弃回主菜单。调试档的天赋结束时还原。
    /// 全程调试档（SaveService.ForceDev），结束时还原。
    /// </summary>
    public sealed class SuspendSuite : PlaytestSuite
    {
        public override string Id => "suspend";
        public override string Scene => MenuFlow.MenuScenePath;

        const float LoadTimeout = 90f;
        const string ProbeStream = "suspend-suite-probe";
        const string VitalityId = "vitality", BarrierId = "barrier";

        /// <summary>调试档原来的天赋等级（结束时还原）</summary>
        Dictionary<string, int> talentRestore;

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
                RestoreTalents();
                SaveService.ForceDev = forceDev;
                WeaponController.TestMode = false;
            }
        }

        void RestoreTalents()
        {
            if (talentRestore == null) return;
            var meta = SaveService.Dev.Section<MetaSave>();
            foreach (var kv in talentRestore) meta.SetTalentLevel(kv.Key, kv.Value, false);
            SaveService.Dev.Save();
            talentRestore = null;
        }

        static Camera MenuCam => MenuCamera.Instance ? MenuCamera.Instance.Camera : Camera.main;

        IEnumerator Run()
        {
            yield return WaitMenu("启动");
            if (!MenuDirector.Instance) yield break;
            bool dev = RunSuspend.MenuDev;
            RunSuspend.Discard(dev);
            var book = Codex.Current;
            book.Clear();
            // 天赋：先定成「生命 1 级、护盾 0 级」，这一局开局锁定的就是它（结束时还原调试档原来的等级）
            var meta = SaveService.Dev.Section<MetaSave>();
            talentRestore = TalentLibrary.All.ToDictionary(t => t.id, t => meta.TalentLevel(t.id));
            meta.SetTalentLevel(VitalityId, 1, false);
            meta.SetTalentLevel(BarrierId, 0, false);
            SaveService.Dev.Save();
            var main = UIRouter.Find(MainMenuScreen.ScreenId) as MainMenuScreen;
            main?.Refresh();
            Line($"主菜单：调试档 {dev}，续玩档 {RunSuspend.PathFor(dev)}，「继续征程」{(main?.Suspended != null ? "有" : "没有")}，图鉴已清空（共 {CodexCatalog.Total} 条）");
            if (!dev) Fail("套件应该用调试档");
            if (main == null) Fail("主菜单界面没有打开");
            else if (main.Suspended != null) Fail("清掉续玩档后主菜单还有「继续征程」");

            // ── 2. 出征 → 1-1，攒家当 ──
            if (!MenuFlow.StartRun(HeroLibrary.DefaultHero))
            {
                Fail("出征失败");
                yield break;
            }
            yield return WaitReady("出征进 1-1", -1);
            var flow = SceneFlow.Instance;
            if (!flow || flow.Player == null) yield break;
            var run = RunState.Current;
            CheckFile(dev, "1-1", run);
            var lockedTalents = Join(run?.talents);
            Line($"开局天赋快照：{lockedTalents}");
            if (run?.talents == null || run.talents.GetValueOrDefault(VitalityId) != 1 || run.talents.ContainsKey(BarrierId))
                Fail($"开局天赋快照应为「{VitalityId}=1」，实际「{lockedTalents}」");
            yield return Stock(flow, run);
            CodexTracker.Poll();

            // ── 3. 进到 1-2 开头 ──
            var s12 = RunPlan.Get("1-2");
            int tr = flow.Transitions;
            if (!flow.GoTo(s12))
            {
                Fail("换不到 1-2（场景没生成？）");
                yield break;
            }
            yield return WaitReady("换到 1-2", tr);
            flow = SceneFlow.Instance;
            if (!flow || flow.Player == null || flow.Current != s12)
            {
                Fail($"换关后是 {flow?.Current?.Label ?? "（没有）"}，应为 1-2");
                yield break;
            }
            run = RunState.Current;
            CheckFile(dev, "1-2", run);
            var expect = SceneFlow.CloneRun(flow.EntrySnapshot);
            var liveBefore = Live();
            var talentsBefore = LiveTalents();
            var probe = Probe(run);
            Line($"1-2 开头：{Describe(expect)}；随机流探针 {string.Join(" ", probe)}");
            yield return MenuShot("suspend_12_before");

            // 图鉴：这一局拿到的都收录了
            var got = new List<(CodexKind, string)>
            {
                (CodexKind.Weapon, "smg"), (CodexKind.Weapon, "revolver"), (CodexKind.Enemy, "jerboa_blade"), (CodexKind.Pet, petId),
            };
            got.AddRange(scrollIds.Select(id => (CodexKind.Scroll, id)));
            var codex = Codex.For(run);
            var missing = got.Where(g => !codex.IsUnlocked(g.Item1, g.Item2)).ToList();
            Line($"图鉴（局内）：收录 {codex.TotalCount} 条，应有 {string.Join("、", got.Select(g => $"{CodexCatalog.KindName(g.Item1)}:{g.Item2}"))}{(missing.Count > 0 ? $"，缺 {string.Join("、", missing)}" : " 全有")}");
            if (missing.Count > 0) Fail($"图鉴没有收录：{string.Join("、", missing.Select(m => $"{m.Item1}:{m.Item2}"))}");

            // ── 4. 暂离 ──
            int runs0 = CareerStats.Current.Runs;
            GameSession.Instance.SetPaused(true);
            yield return null;
            var pause = UIRouter.Find(PauseScreen.ScreenId) as PauseScreen;
            if (pause == null)
            {
                Fail("暂停后没有暂停菜单");
                yield break;
            }
            if (!PauseScreen.CanSuspend) Fail("有续玩档的局，暂停「返回主菜单」却不是暂离");
            yield return new WaitForSecondsRealtime(0.5f);
            yield return MenuShot("suspend_pause");
            pause.Press("menu");
            yield return WaitMenu("暂离 → 主菜单");
            main = UIRouter.Find(MainMenuScreen.ScreenId) as MainMenuScreen;
            var sus = main?.Suspended;
            Line($"暂离 → 主菜单：{SceneManager.GetActiveScene().name}，局 {(RunState.Current == null ? "已清空" : "还在")}，生涯 {runs0} → {CareerStats.Current.Runs} 局，" +
                 $"续玩档 {(RunSuspend.Exists(dev) ? "在" : "没了")}，「继续征程」{(sus != null ? $"{sus.Stage?.Label}" : "没有")}");
            if (!MenuFlow.InMenu) Fail("暂离后没有回到主菜单");
            if (RunState.Current != null) Fail("暂离后局状态没有清空");
            if (CareerStats.Current.Runs != runs0) Fail("暂离结算了这一局");
            if (sus == null || sus.run.stageCode != "1-2") Fail("主菜单的「继续征程」不是 1-2");
            yield return new WaitForSecondsRealtime(1.4f);
            yield return MenuShot("suspend_menu_continue");

            // 暂离期间买天赋：进元进度，但这一局（续玩档里的开局快照）不变
            yield return BuyTalents();

            // ── 5. 图鉴 ──
            yield return CheckCodex(got);

            // ── 6. 继续征程 ──
            main = UIRouter.Find(MainMenuScreen.ScreenId) as MainMenuScreen;
            if (main == null)
            {
                Fail("图鉴关掉后主菜单不在了");
                yield break;
            }
            main.ContinueRun();
            yield return WaitReady("继续征程进 1-2", -1);
            flow = SceneFlow.Instance;
            if (!flow || flow.Player == null)
            {
                Fail("继续征程后没有进到关卡");
                yield break;
            }
            run = RunState.Current;
            var entry = flow.EntrySnapshot;
            var diffs = Diff(expect, entry);
            var liveAfter = Live();
            var liveDiffs = DiffLive(liveBefore, liveAfter);
            var probe2 = Probe(run);
            Line($"继续征程 → {flow.Current?.Label}：{Describe(entry)}");
            if (flow.Current != s12) Fail($"继续征程进的是 {flow.Current?.Label}，应为 1-2");
            if (diffs.Count > 0) Fail($"进关快照和暂离前不一致：{string.Join("；", diffs)}");
            else Line($"  ✓ 进关快照逐项一致（{FieldCount} 个字段、{expect.weapons.Count} 把枪、{expect.scrolls.Count} 卷秘卷、灵宠 {expect.pet?.id}）");
            if (liveDiffs.Count > 0) Fail($"手上的东西和暂离前不一致：{string.Join("；", liveDiffs)}");
            else Line($"  ✓ 手上的枪 / 秘卷 / 灵宠与暂离前一致：{liveAfter.weapons}｜{liveAfter.scrolls}｜{liveAfter.pet}");
            if (!probe.SequenceEqual(probe2)) Fail($"随机流没有接着同一串：{string.Join(" ", probe)} → {string.Join(" ", probe2)}");
            else Line("  ✓ 随机流接着同一串（种子 + 关卡 + 流名）");
            var talentsAfter = LiveTalents();
            if (talentsAfter != talentsBefore) Fail($"暂离期间买的天赋带进了续玩：{talentsBefore} → {talentsAfter}");
            else Line($"  ✓ 天赋效果不变（开局快照 {Join(run?.talents)}；档里现在 {Join(MetaSave.For(run).TalentSnapshot())}）：{talentsAfter}");
            if (run == null || run.Flag(MetaSave.BankedFlag) != 0) Fail("继续的局被标成了已结算");
            CheckFile(dev, "1-2", run);
            yield return new WaitForSecondsRealtime(0.6f);
            yield return MenuShot("suspend_12_resumed");

            // ── 7. 放弃 → 删档 ──
            runs0 = CareerStats.Current.Runs;
            GameSession.Instance.SetPaused(true);
            yield return null;
            pause = UIRouter.Find(PauseScreen.ScreenId) as PauseScreen;
            if (pause == null)
            {
                Fail("暂停后没有暂停菜单");
                yield break;
            }
            pause.Press("abandon");
            yield return null;
            if (UIRouter.IsOpen(MenuFlow.SummaryScreenId)) Fail("「放弃本局」按一次就结束了（应先待确认）");
            pause.Press("abandon");
            float t0 = Time.realtimeSinceStartup;
            SummaryScreen sum = null;
            while (Time.realtimeSinceStartup - t0 < 4f && (sum = UIRouter.Find(MenuFlow.SummaryScreenId) as SummaryScreen) == null) yield return null;
            Line($"放弃：结算 {(sum != null ? "已弹出" : "没有")}，生涯 {runs0} → {CareerStats.Current.Runs} 局，续玩档 {(RunSuspend.Exists(dev) ? "还在" : "已删")}");
            if (sum == null) Fail("放弃后没有弹出结算");
            if (CareerStats.Current.Runs != runs0 + 1) Fail("放弃后生涯局数没有 +1");
            if (RunSuspend.Exists(dev)) Fail("放弃结算后续玩档还在");
            if (sum != null) sum.ToMenu();
            else MenuFlow.ToMenu();
            yield return WaitMenu("放弃 → 主菜单");
            main = UIRouter.Find(MainMenuScreen.ScreenId) as MainMenuScreen;
            if (main?.Suspended != null) Fail("放弃后主菜单还有「继续征程」");

            // 放弃后开新局：新买的天赋生效
            yield return NewRunTalents();

            // ── 8. 坏档 ──
            yield return CorruptFile(dev);
        }

        // ───────────── 攒家当 ─────────────

        string petId;
        readonly List<string> scrollIds = new();

        IEnumerator Stock(SceneFlow flow, RunState run)
        {
            var p = flow.Player;
            run.Credit(321, "suite");
            run.CreditEssence(17, "suite");
            run.kills += 5;
            run.time += 100;
            run.damageDealt += 1234.5f;
            run.SetFlag("suite.suspend", 3);

            var wc = p.weapons;
            var rev = new WeaponInstance(WeaponLibrary.Get("revolver"), 4) { level = 2, element = Element.Shock };
            var rollable = AffixLibrary.Rollable();
            AffixSave.Restore(rev, new[] { new AffixSave(rollable[rollable.Count / 2].id, 0.15f), new AffixSave("lg_boil", 0.06f) });
            rev.mag = 3;
            wc.Give(rev);
            if (wc.slots[0] != null) wc.slots[0].reserve = Mathf.Max(1, wc.slots[0].reserve - 37);

            var inv = LootDirector.Instance ? LootDirector.Instance.scrolls : null;
            scrollIds.Clear();
            if (inv != null)
            {
                var pool = ScrollLibrary.All.Where(s => s.maxStacks >= 2 && string.IsNullOrEmpty(s.heroOnly)).Take(3).ToList();
                foreach (var s in pool)
                {
                    inv.Gain(s, p.vitals);
                    scrollIds.Add(s.id);
                }
                if (pool.Count > 0) inv.Gain(pool[0], p.vitals);
            }
            else Fail("没有 LootDirector（秘卷清单）");

            var pet = PetLibrary.All[0];
            petId = pet.id;
            var owner = PetOwner.Instance;
            if (owner) owner.Bind(pet, 3, 2f, null, Time.time + 6f, true);
            else Fail("没有 PetOwner");

            yield return new WaitForSecondsRealtime(0.4f);
            p.vitals.health = Mathf.Round(p.vitals.MaxHealth * 0.6f);

            // 打一只跳鼠刀兵：图鉴收录敌人
            var e = SpawnAhead(p.motor, "jerboa_blade", 9f, 1f);
            if (e)
            {
                yield return new WaitForSeconds(1.2f);
                var c = BodyCenter(e.Health);
                Combat.DamageEnemy(e.Health, DamageInfo.Simple(5f, DamageSource.Weapon, c, Vector3.forward));
                yield return null;
                var kill = DamageInfo.Simple(99999f, DamageSource.Weapon, c, Vector3.forward);
                kill.noCrit = true;
                Combat.DamageEnemy(e.Health, kill);
            }
            yield return new WaitForSecondsRealtime(0.6f);
            Line($"1-1 攒家当：灵石 {run.coins}、魂晶 {run.essence}、手上 {LiveWeapons(wc)}、秘卷 {string.Join("、", scrollIds)}（{inv?.TotalStacks} 层）、" +
                 $"灵宠 {owner?.Current?.def.id} Lv{owner?.Current?.Level}、生命 {p.vitals.health:F0}/{p.vitals.MaxHealth:F0}");
        }

        // ───────────── 图鉴 ─────────────

        IEnumerator CheckCodex(List<(CodexKind, string)> got)
        {
            var book = Codex.Current;
            var miss = got.Where(g => !book.IsUnlocked(g.Item1, g.Item2)).ToList();
            yield return new WaitForSecondsRealtime(1f);
            SaveService.Flush();
            string path = Path.Combine(SaveService.Root, SaveService.DevName + ".json");
            string text = File.Exists(path) ? File.ReadAllText(path) : "";
            bool onDisk = text.Contains("\"codex\"") && got.All(g => text.Contains($"\"{g.Item2}\""));
            Line($"图鉴（主菜单）：收录 {book.TotalCount} / {CodexCatalog.Total}，这一局的 {got.Count} 条{(miss.Count > 0 ? $"缺 {miss.Count} 条" : "都在")}，" +
                 $"{(onDisk ? "已写进" : "没写进")} {Path.GetFileName(path)}");
            if (miss.Count > 0) Fail($"回主菜单后图鉴少了：{string.Join("、", miss.Select(m => $"{m.Item1}:{m.Item2}"))}");
            if (!onDisk) Fail("图鉴收录没有写进存档文件");

            if (!UIRouter.Open(CodexScreen.ScreenId, CodexKind.Weapon))
            {
                Fail("图鉴界面打不开");
                yield break;
            }
            yield return new WaitForSecondsRealtime(0.5f);
            var screen = UIRouter.Find(CodexScreen.ScreenId) as CodexScreen;
            var main = UIRouter.Find(MainMenuScreen.ScreenId) as MainMenuScreen;
            if (screen == null)
            {
                Fail("图鉴界面没有打开");
                yield break;
            }
            if (main != null && !main.Covered) Fail("图鉴打开时主菜单本体没有让开");
            foreach (CodexKind k in Enum.GetValues(typeof(CodexKind)))
            {
                screen.Select(k);
                yield return WaitThumbs(screen, 12f);
                var entries = screen.PageEntries.ToList();
                int unlocked = entries.Count(e => book.IsUnlocked(e.kind, e.id));
                string name = k.ToString().ToLowerInvariant();
                Line($"  {CodexCatalog.KindName(k)}：{book.Count(k)} / {CodexCatalog.Of(k).Count}，{screen.PageCount} 页，第 1 页 {entries.Count} 格（收录 {unlocked}），" +
                     $"缩略图 {(screen.PageThumbsReady ? "拍好了" : "没拍完")}（累计 {CodexThumbs.Count} 张），选中「{screen.DetailName}」");
                if (screen.Kind != k) Fail($"换不到「{CodexCatalog.KindName(k)}」页签");
                if (entries.Count == 0) Fail($"「{CodexCatalog.KindName(k)}」第一页是空的");
                if (!screen.PageThumbsReady) Fail($"「{CodexCatalog.KindName(k)}」的缩略图 12 s 内没拍完");
                // 选一条收录了的看详情，再选一条没收录的
                var have = entries.FirstOrDefault(e => book.IsUnlocked(e.kind, e.id));
                var locked = entries.FirstOrDefault(e => !book.IsUnlocked(e.kind, e.id));
                if (have != null)
                {
                    screen.Reveal(have);
                    yield return null;
                    if (screen.DetailName != have.name) Fail($"选中收录的「{have.name}」，详情写的是「{screen.DetailName}」");
                    if (string.IsNullOrEmpty(screen.DetailText) && k != CodexKind.Weapon) Fail($"「{have.name}」没有描述");
                    if (book.IsFresh(have.kind, have.id)) Fail($"看过「{have.name}」后「新」标记没清");
                }
                else if (k != CodexKind.Scroll || scrollIds.Count == 0) Line($"  （{CodexCatalog.KindName(k)}第一页没有收录的条目）");
                yield return new WaitForSecondsRealtime(0.3f);
                yield return MenuShot($"suspend_codex_{name}");
                if (locked != null)
                {
                    screen.Reveal(locked);
                    yield return null;
                    if (screen.DetailName != "？？？") Fail($"没收录的「{locked.name}」详情露了名字（{screen.DetailName}）");
                }
                // 翻页
                if (screen.PageCount > 1)
                {
                    screen.NextPage();
                    yield return WaitThumbs(screen, 12f);
                    int p1 = screen.Page;
                    var first = screen.PageEntries.FirstOrDefault();
                    Line($"    翻页 → 第 {p1 + 1} / {screen.PageCount} 页，首格「{(first != null && book.IsUnlocked(first.kind, first.id) ? first.name : "？？？")}」");
                    if (p1 != 1) Fail($"「{CodexCatalog.KindName(k)}」翻页后在第 {p1 + 1} 页，应为第 2 页");
                    if (first == null || first == CodexCatalog.Of(k)[0]) Fail("翻页后格子内容没变");
                    if (k == CodexKind.Weapon || k == CodexKind.Enemy) yield return MenuShot($"suspend_codex_{name}_p2");
                    screen.PrevPage();
                    yield return null;
                    if (screen.Page != 0) Fail("上一页没有回到第 1 页");
                    screen.GoPage(-1);
                    yield return null;
                    if (screen.Page != screen.PageCount - 1) Fail("第 1 页再往前没有绕到最后一页");
                }
            }
            UIRouter.Back();
            yield return new WaitForSecondsRealtime(0.4f);
            if (UIRouter.IsOpen(CodexScreen.ScreenId)) Fail("返回后图鉴还开着");
            if (UIRouter.Top is not MainMenuScreen) Fail($"关掉图鉴后栈顶是 {UIRouter.Top?.Id}，应为主菜单");
        }

        static IEnumerator WaitThumbs(CodexScreen screen, float seconds)
        {
            float t0 = Time.realtimeSinceStartup;
            yield return null;
            while (!screen.PageThumbsReady && Time.realtimeSinceStartup - t0 < seconds) yield return null;
            yield return null;
        }

        // ───────────── 天赋开局锁定 ─────────────

        /// <summary>玩家身上的天赋修正 + 生命 / 护盾上限（真实属性表上的）</summary>
        static string LiveTalents()
        {
            var v = SceneFlow.Instance ? SceneFlow.Instance.Player?.vitals : null;
            if (!v || v.stats == null) return "（没有玩家）";
            var mods = v.stats.ModsFrom(MetaSave.TalentSource);
            return $"[{string.Join(",", mods.Select(m => $"{m.stat}+{m.value.ToString("0.###", CultureInfo.InvariantCulture)}"))}] 生命上限 {v.MaxHealth:F1} 护盾上限 {v.MaxShield:F1}";
        }

        /// <summary>暂离期间（主菜单）在天赋页买生命、护盾各一级：元进度照常涨，续玩档里的开局快照不变</summary>
        IEnumerator BuyTalents()
        {
            bool dev = RunSuspend.MenuDev;
            var meta = MetaSave.Current;
            if (meta.File != SaveService.Dev) Fail("主菜单的元进度不是调试档");
            string locked = RunSuspend.Read(dev, out var before, out _) == SuspendStatus.Ok ? Join(before.run.talents) : "（读不到续玩档）";
            meta.AddEssence(2000);
            if (!UIRouter.Open(TalentScreen.ScreenId))
            {
                Fail("天赋页打不开");
                yield break;
            }
            yield return new WaitForSecondsRealtime(0.4f);
            var screen = UIRouter.Find(TalentScreen.ScreenId) as TalentScreen;
            if (screen == null)
            {
                Fail("天赋页没有打开");
                yield break;
            }
            int v0 = meta.TalentLevel(VitalityId), b0 = meta.TalentLevel(BarrierId);
            bool okV = screen.Buy(TalentLibrary.Get(VitalityId));
            bool okB = screen.Buy(TalentLibrary.Get(BarrierId));
            yield return new WaitForSecondsRealtime(0.3f);
            var st = RunSuspend.Read(dev, out var after, out _);
            string now = st == SuspendStatus.Ok ? Join(after.run.talents) : $"（{st}）";
            Line($"暂离期间买天赋：生命 {v0} → {meta.TalentLevel(VitalityId)} 级、护盾 {b0} → {meta.TalentLevel(BarrierId)} 级（档里现在 {Join(meta.TalentSnapshot())}），" +
                 $"续玩档里的开局快照 {locked} → {now}");
            if (!okV || !okB || meta.TalentLevel(VitalityId) != v0 + 1 || meta.TalentLevel(BarrierId) != b0 + 1) Fail("暂离期间买天赋没有升级");
            if (now != locked) Fail($"买天赋改了续玩档里的开局快照：{locked} → {now}");
            yield return MenuShot("suspend_menu_talents");
            UIRouter.Back();
            yield return new WaitForSecondsRealtime(0.3f);
            if (UIRouter.IsOpen(TalentScreen.ScreenId)) Fail("返回后天赋页还开着");
        }

        /// <summary>放弃后再出征一局：新局的开局快照 = 现在档里的天赋（含暂离期间买的），玩家身上也是；然后放弃回主菜单</summary>
        IEnumerator NewRunTalents()
        {
            bool dev = RunSuspend.MenuDev;
            var meta = SaveService.Dev.Section<MetaSave>();
            var want = meta.TalentSnapshot();
            if (!MenuFlow.StartRun(HeroLibrary.DefaultHero))
            {
                Fail("放弃后再出征失败（还有续玩档？）");
                yield break;
            }
            yield return WaitReady("再出征进 1-1", -1);
            var flow = SceneFlow.Instance;
            var run = RunState.Current;
            if (!flow || flow.Player == null || run == null)
            {
                Fail("再出征后没有进到关卡");
                yield break;
            }
            var mods = flow.Player.vitals.stats.ModsFrom(MetaSave.TalentSource).ToList();
            var expectMods = MetaSave.TalentMods(want);
            bool same = mods.Count == expectMods.Count && mods.Zip(expectMods, (a, b) => a.stat == b.stat && Mathf.Abs(a.value - b.value) < 1e-4f).All(x => x);
            Line($"放弃后再出征：开局快照 {Join(run.talents)}（档里 {Join(want)}），身上 {LiveTalents()}");
            if (Join(run.talents) != Join(want)) Fail($"新局的开局快照 {Join(run.talents)} 不是现在档里的 {Join(want)}");
            if (run.talents == null || run.talents.GetValueOrDefault(VitalityId) != 2 || run.talents.GetValueOrDefault(BarrierId) != 1)
                Fail("新局没有带上暂离期间买的天赋（应为生命 2 级、护盾 1 级）");
            if (!same) Fail("新局玩家身上的天赋修正和新买的等级对不上");
            else Line("  ✓ 新买的天赋在新局生效");

            GameSession.Instance.SetPaused(true);
            yield return null;
            var pause = UIRouter.Find(PauseScreen.ScreenId) as PauseScreen;
            if (pause != null)
            {
                pause.Press("abandon");
                yield return null;
                pause.Press("abandon");
            }
            else Fail("再出征后暂停没有暂停菜单");
            float t0 = Time.realtimeSinceStartup;
            SummaryScreen sum = null;
            while (Time.realtimeSinceStartup - t0 < 4f && (sum = UIRouter.Find(MenuFlow.SummaryScreenId) as SummaryScreen) == null) yield return null;
            if (sum != null) sum.ToMenu();
            else MenuFlow.ToMenu();
            yield return WaitMenu("再出征放弃 → 主菜单");
            if (RunSuspend.Exists(dev)) Fail("再出征放弃后续玩档还在");
            if (!MenuFlow.InMenu) Fail("再出征放弃后没有回到主菜单");
        }

        // ───────────── 坏档 ─────────────

        IEnumerator CorruptFile(bool dev)
        {
            string path = RunSuspend.PathFor(dev);
            File.WriteAllText(path, "{\"version\": 1, \"game\": \"spiritfire\", \"kind\": \"run\", \"run\": {\"heroId\": \"fox\", \"stage");
            bool ok = MenuFlow.ResumeRun();
            yield return new WaitForSecondsRealtime(0.4f);
            var main = UIRouter.Find(MainMenuScreen.ScreenId) as MainMenuScreen;
            main?.Refresh();
            Line($"坏档：「继续征程」{(ok ? "进局了" : "没进局")}，续玩档 {(File.Exists(path) ? "还在" : "已丢弃")}，.corrupt {(File.Exists(RunSuspend.CorruptPathFor(dev)) ? "留着" : "没有")}，" +
                 $"主菜单「继续征程」{(main?.Suspended != null ? "还在" : "没有")}，状态 {GameStateMachine.Current}");
            if (ok || MenuFlow.Busy) Fail("坏档也进局了");
            if (File.Exists(path)) Fail("坏档没有丢弃");
            if (!File.Exists(RunSuspend.CorruptPathFor(dev))) Fail("坏档没有留 .corrupt");
            if (main?.Suspended != null) Fail("坏档丢弃后主菜单还有「继续征程」");
            if (!MenuFlow.InMenu) Fail("坏档后不在主菜单了");
            yield return MenuShot("suspend_corrupt_toast");
            try { File.Delete(RunSuspend.CorruptPathFor(dev)); }
            catch (IOException) { }
        }

        // ───────────── 比较 ─────────────

        static int FieldCount => typeof(RunState).GetFields(System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public).Count(f => !f.IsNotSerialized);

        /// <summary>两份局状态逐字段比（浮点容差 0.01；集合逐项、秘卷按顺序）</summary>
        static List<string> Diff(RunState a, RunState b)
        {
            var d = new List<string>();
            if (a == null || b == null)
            {
                d.Add(a == null ? "暂离前没有进关快照" : "继续后没有进关快照");
                return d;
            }
            void Eq<T>(string name, T x, T y)
            {
                if (!EqualityComparer<T>.Default.Equals(x, y)) d.Add($"{name} {x} → {y}");
            }
            void Near(string name, float x, float y)
            {
                if (Mathf.Abs(x - y) > 0.01f) d.Add($"{name} {x.ToString("0.###", CultureInfo.InvariantCulture)} → {y.ToString("0.###", CultureInfo.InvariantCulture)}");
            }
            Eq("英雄", a.heroId, b.heroId);
            Eq("种子", a.seed, b.seed);
            Eq("章", a.chapter, b.chapter);
            Eq("关序", a.stage, b.stage);
            Eq("关卡", a.stageCode, b.stageCode);
            Near("难度", a.difficulty, b.difficulty);
            Near("用时", a.time, b.time);
            Near("伤害", a.damageDealt, b.damageDealt);
            Eq("灵石", a.coins, b.coins);
            Eq("魂晶", a.essence, b.essence);
            Eq("击杀", a.kills, b.kills);
            Eq("清关", a.stagesCleared, b.stagesCleared);
            Eq("调试局", a.dev, b.dev);
            Eq("标记", Join(a.flags), Join(b.flags));
            Eq("秘卷", Join(a.scrolls), Join(b.scrolls));
            Eq("武器数", a.weapons.Count, b.weapons.Count);
            for (int i = 0; i < Mathf.Min(a.weapons.Count, b.weapons.Count); i++)
            {
                var x = a.weapons[i];
                var y = b.weapons[i];
                Eq($"第 {i + 1} 把枪", Weapon(x), Weapon(y));
            }
            Eq("灵宠", a.pet?.id, b.pet?.id);
            if (a.pet != null && b.pet != null)
            {
                Eq("灵宠等级", a.pet.level, b.pet.level);
                Near("灵宠经验", a.pet.xp, b.pet.xp);
                Near("灵技冷却", a.pet.cooldownLeft, b.pet.cooldownLeft);
            }
            Near("生命", a.hp, b.hp);
            Near("护盾", a.shield, b.shield);
            Eq("开局天赋", Join(a.talents), Join(b.talents));
            return d;
        }

        static string Join(Dictionary<string, int> m) => m == null ? "" : string.Join(",", m.Select(kv => $"{kv.Key}={kv.Value}"));

        static string Weapon(WeaponSave w) =>
            $"{w.id}|{Rarity.Name(w.rarity)}|+{w.level}|{w.element}|{w.mag}/{w.reserve}|{(w.active ? "手上" : "背上")}|" +
            string.Join(",", (w.affixes ?? Array.Empty<AffixSave>()).Select(x => $"{x.id}:{x.value.ToString("0.####", CultureInfo.InvariantCulture)}"));

        sealed class LiveState
        {
            public string weapons, scrolls, pet;
            public int coins;
        }

        static string LiveWeapons(WeaponController wc) =>
            wc ? string.Join(" ", wc.slots.Where(w => w != null).Select(w => $"{w.def.id}({Rarity.Name(w.rarity)}+{w.level},{w.element},{w.mag}/{w.reserve},词条 {string.Join("/", w.affixes.Select(a => a.id))})")) : "—";

        /// <summary>手上的东西（真实组件上的，不是快照）：两把枪、秘卷清单（顺序 + 层数）、灵宠种类 / 等级、灵石</summary>
        static LiveState Live()
        {
            var p = SceneFlow.Instance?.Player;
            var inv = LootDirector.Instance ? LootDirector.Instance.scrolls : null;
            var pet = PetOwner.Instance ? PetOwner.Instance.Current : null;
            return new LiveState
            {
                weapons = LiveWeapons(p?.weapons),
                scrolls = inv != null ? string.Join(",", inv.Order.Select(id => $"{id}={inv.Stacks(id)}")) : "",
                pet = pet ? $"{pet.def.id} Lv{pet.Level}" : "无",
                coins = RunState.Current?.coins ?? -1,
            };
        }

        static List<string> DiffLive(LiveState a, LiveState b)
        {
            var d = new List<string>();
            if (a.weapons != b.weapons) d.Add($"武器 {a.weapons} → {b.weapons}");
            if (a.scrolls != b.scrolls) d.Add($"秘卷 {a.scrolls} → {b.scrolls}");
            if (a.pet != b.pet) d.Add($"灵宠 {a.pet} → {b.pet}");
            if (a.coins != b.coins) d.Add($"灵石 {a.coins} → {b.coins}");
            return d;
        }

        /// <summary>一条游戏里没人用的随机流的前四个数（新局 / 读档的这一关都从起点开始）</summary>
        static uint[] Probe(RunState run) => run == null ? Array.Empty<uint>() : Enumerable.Range(0, 4).Select(_ => run.Stream(ProbeStream).NextUInt()).ToArray();

        static string Describe(RunState r) => r == null ? "（没有快照）" :
            $"{r.stageCode} 英雄 {r.heroId} 种子 {r.seed} 灵石 {r.coins} 魂晶 {r.essence} 击杀 {r.kills} 用时 {r.time:F0} s，枪 {string.Join(" ", r.weapons.Select(Weapon))}，" +
            $"秘卷 {Join(r.scrolls)}，灵宠 {r.pet?.id ?? "无"} Lv{r.pet?.level}，生命 {r.hp:F1} 护盾 {r.shield:F1}";

        void CheckFile(bool dev, string stage, RunState run)
        {
            var st = RunSuspend.Read(dev, out var s, out var error);
            if (st != SuspendStatus.Ok) Fail($"{stage}：续玩档没写（{st}，{error}）");
            else if (s.run.stageCode != stage || run == null || s.run.seed != run.seed) Fail($"{stage}：续玩档是 {s.run.stageCode}（种子 {s.run.seed}），应为这一局的 {stage}");
            else Line($"  ✓ 续玩档已写入：{Path.GetFileName(RunSuspend.PathFor(dev))} → {s.run.stageCode}（{s.savedAt}）");
        }

        /// <summary>截图一律帧末抓屏（含 HUD / 界面；主菜单镜头一直在缓动，相机截图再升级的路子用不上）</summary>
        IEnumerator MenuShot(string name)
        {
            if (string.IsNullOrEmpty(ShotDir))
            {
                Shot(SceneFlow.Instance && SceneFlow.Instance.Player != null ? SceneFlow.Instance.Player.cam : MenuCam, name);
                yield break;
            }
            yield return UICapture.CaptureScreen(Path.Combine(ShotDir, $"playtest_{name}.png"), Line);
        }

        // ───────────── 等待 ─────────────

        IEnumerator WaitReady(string what, int transitionsBefore)
        {
            float t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < LoadTimeout)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Player != null && f.Player.root && f.CurrentScene.IsValid() && !MenuFlow.Busy && f.Transitions > transitionsBefore)
                {
                    yield return new WaitForSecondsRealtime(0.6f);
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
