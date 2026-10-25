using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// I5 中途续玩与图鉴（docs/unity-parity.md I5）：
    ///   续玩档 run.json 往返逐项一致（含词条 / 传说、秘卷顺序、灵宠、随机流）、原子写不留临时文件；
    ///   坏档（不是 JSON、截断、空文件、缺字段、英雄 / 关卡不存在、已结算、数值离谱）读不了时丢弃成 .corrupt 并给出提示、不抛异常；新版本的档原样留着；
    ///   一局结算（阵亡 / 放弃 / 胜利）删档、开新局前放弃旧局按败北结算；暂离判定；
    ///   图鉴收录写进存档的 codex 段、重读还在、不随一局结算清掉、调试档隔离、「新」标记、坏段宽容读取；条目清单（附属单位不单列、测试首领不进）。
    /// 每个测试把存档根目录指到独立的临时目录，不碰真实存档。
    /// </summary>
    public sealed class RunSuspendTests
    {
        string root;
        RunState prevRun;

        [SetUp]
        public void SetUp()
        {
            root = Path.Combine(Path.GetTempPath(), "spiritfire-suspend-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            SaveService.UseRoot(root);
            SaveService.ForceDev = false;
            prevRun = RunState.Current;
            RunState.Current = null;
            RunSuspend.Enabled = true;
            RunSuspend.TakeProblem();
        }

        [TearDown]
        public void TearDown()
        {
            RunState.Current = prevRun;
            SaveService.ForceDev = false;
            SaveService.UseRoot(null);
            RunSuspend.TakeProblem();
            try { Directory.Delete(root, true); }
            catch (Exception) { /* 临时目录 */ }
        }

        void Reopen() => SaveService.UseRoot(root);

        string MainPath => RunSuspend.PathFor(false);

        /// <summary>一局打到 1-2 开头的样子：两把枪（一把带词条和传说特性）、三卷秘卷、灵宠、半血、标记…</summary>
        static RunState SampleRun()
        {
            var run = new RunState { heroId = "fox", seed = 123456789, dev = false };
            run.EnterStage(RunPlan.Get("1-2"));
            run.time = 431.5f;
            run.damageDealt = 98765.25f;
            run.coins = 287;
            run.essence = 19;
            run.kills = 64;
            run.stagesCleared = 1;
            run.flags["story.camel"] = 2;
            run.flags[WeaponController.InfiniteAmmoFlag] = 0;
            var scrolls = ScrollLibrary.All;
            Assert.GreaterOrEqual(scrolls.Count, 3, "秘卷表至少三卷");
            // 故意不按注册顺序：顺序 = 获得顺序，要原样回来
            run.scrolls[scrolls[2].id] = 1;
            run.scrolls[scrolls[0].id] = Math.Min(2, scrolls[0].maxStacks);
            run.scrolls[scrolls[1].id] = 1;
            var rollable = AffixLibrary.Rollable();
            Assert.Greater(rollable.Count, 0);
            run.weapons.Add(new WeaponSave
            {
                id = "revolver", rarity = 4, level = 3, element = Element.Fire, mag = 4, reserve = 31, active = false,
                affixes = new[] { new AffixSave(rollable[0].id, 0.18f), new AffixSave("lg_boil", 0.06f) },
            });
            run.weapons.Add(new WeaponSave { id = "smg", rarity = 1, level = 0, element = Element.None, mag = 22, reserve = 140, active = true, affixes = Array.Empty<AffixSave>() });
            run.pet = new PetSave { id = PetLibrary.All[0].id, level = 3, xp = 7.5f, cooldownLeft = 4.25f };
            run.hp = 63.5f;
            run.shield = 12f;
            return run;
        }

        // ───────────── 续玩档往返 ─────────────

        [Test]
        public void RoundTripKeepsEveryField()
        {
            var run = SampleRun();
            Assert.IsTrue(RunSuspend.Write(run, false));
            Assert.IsTrue(File.Exists(MainPath));
            Assert.IsFalse(File.Exists(MainPath + ".tmp"), "原子写不留 .tmp");
            Assert.IsFalse(File.Exists(MainPath + ".bak"), "续玩档不留 .bak");

            Assert.AreEqual(SuspendStatus.Ok, RunSuspend.Read(false, out var s, out var error), error);
            var got = s.run;
            Assert.AreNotSame(run, got);
            // 整体：公有字段序列化后逐字一致
            Assert.AreEqual(RunStateJson.Serialize(run), RunStateJson.Serialize(got));
            // 逐项（失败时好看）
            Assert.AreEqual("fox", got.heroId);
            Assert.AreEqual(123456789, got.seed);
            Assert.AreEqual("1-2", got.stageCode);
            Assert.AreEqual(1, got.chapter);
            Assert.AreEqual(1, got.stage);
            Assert.AreEqual(RunPlan.Get("1-2").difficulty, got.difficulty, 1e-6f);
            Assert.AreEqual(431.5f, got.time);
            Assert.AreEqual(98765.25f, got.damageDealt);
            Assert.AreEqual(287, got.coins);
            Assert.AreEqual(19, got.essence);
            Assert.AreEqual(64, got.kills);
            Assert.AreEqual(1, got.stagesCleared);
            Assert.AreEqual(2, got.Flag("story.camel"));
            CollectionAssert.AreEqual(run.scrolls.Keys.ToList(), got.scrolls.Keys.ToList(), "秘卷按获得顺序");
            CollectionAssert.AreEqual(run.scrolls.Values.ToList(), got.scrolls.Values.ToList());
            Assert.AreEqual(2, got.weapons.Count);
            var w = got.weapons[0];
            Assert.AreEqual(("revolver", 4, 3, Element.Fire, 4, 31, false), (w.id, w.rarity, w.level, w.element, w.mag, w.reserve, w.active));
            Assert.AreEqual(2, w.affixes.Length);
            Assert.AreEqual("lg_boil", w.affixes[1].id, "传说特性");
            Assert.AreEqual(0.18f, w.affixes[0].value, 1e-6f);
            Assert.IsTrue(got.weapons[1].active);
            Assert.AreEqual(run.pet.id, got.pet.id);
            Assert.AreEqual(3, got.pet.level);
            Assert.AreEqual(7.5f, got.pet.xp);
            Assert.AreEqual(4.25f, got.pet.cooldownLeft);
            Assert.AreEqual(63.5f, got.hp);
            Assert.AreEqual(12f, got.shield);
            Assert.IsFalse(got.dev);
            Assert.IsNotNull(s.savedAt);
            Assert.AreEqual(RunPlan.Get("1-2"), s.Stage);
        }

        [Test]
        public void RandomStreamsResumeFromTheStageOrigin()
        {
            var run = SampleRun();
            // 进关后这一关的流还在起点：读回来的局同一个流名给出同一串数
            var expect = Enumerable.Range(0, 6).Select(_ => run.Stream("loot").NextUInt()).ToArray();
            var fresh = SceneFlow.CloneRun(run);
            Assert.IsTrue(RunSuspend.Write(fresh, false));
            Assert.AreEqual(SuspendStatus.Ok, RunSuspend.Read(false, out var s, out _));
            var got = Enumerable.Range(0, 6).Select(_ => s.run.Stream("loot").NextUInt()).ToArray();
            CollectionAssert.AreEqual(expect, got);
            // 不同流互不相干
            Assert.AreNotEqual(s.run.Stream("enc").NextUInt(), RunRng.Stream(run.seed, "1-2/loot").NextUInt());
        }

        [Test]
        public void WriteOverwritesThePreviousStage()
        {
            var run = SampleRun();
            Assert.IsTrue(RunSuspend.Write(run, false));
            run.EnterStage(RunPlan.Get("1-3"));
            run.coins = 500;
            Assert.IsTrue(RunSuspend.Write(run, false));
            Assert.AreEqual(SuspendStatus.Ok, RunSuspend.Read(false, out var s, out _));
            Assert.AreEqual("1-3", s.run.stageCode);
            Assert.AreEqual(500, s.run.coins);
            Assert.IsFalse(File.Exists(MainPath + ".bak"));
        }

        [Test]
        public void DevRunsGoToTheirOwnFile()
        {
            var run = SampleRun();
            run.dev = true;
            Assert.IsFalse(RunSuspend.ShouldWrite(run), "调试局在调试档没开时不写续玩档");
            SaveService.ForceDev = true;
            Assert.IsTrue(RunSuspend.ShouldWrite(run));
            Assert.IsTrue(RunSuspend.DevFor(run));
            Assert.IsTrue(RunSuspend.Write(run, RunSuspend.DevFor(run)));
            Assert.IsTrue(File.Exists(RunSuspend.PathFor(true)));
            Assert.IsFalse(File.Exists(MainPath), "调试局不碰正式档的续玩档");
            Assert.IsNull(RunSuspend.Peek(false));
            Assert.IsNotNull(RunSuspend.Peek(true));
        }

        // ───────────── 坏档 ─────────────

        static readonly string[] Broken =
        {
            "",
            "   ",
            "{ not json",
            "[1, 2, 3]",
            "{\"version\": 1}",
            "{\"version\": 1, \"game\": \"spiritfire\", \"kind\": \"run\"}",
            "{\"version\": \"x\", \"game\": \"spiritfire\", \"kind\": \"run\", \"run\": {}}",
            "{\"version\": 1, \"game\": \"other\", \"kind\": \"run\", \"run\": {}}",
            "{\"version\": 1, \"game\": \"spiritfire\", \"kind\": \"run\", \"run\": {\"heroId\": \"nobody\", \"stageCode\": \"1-2\"}}",
            "{\"version\": 1, \"game\": \"spiritfire\", \"kind\": \"run\", \"run\": {\"heroId\": \"fox\", \"stageCode\": \"9-9\"}}",
            "{\"version\": 1, \"game\": \"spiritfire\", \"kind\": \"run\", \"run\": {\"heroId\": \"fox\", \"stageCode\": \"1-2\", \"coins\": -5}}",
            "{\"version\": 1, \"game\": \"spiritfire\", \"kind\": \"run\", \"run\": {\"heroId\": \"fox\", \"stageCode\": \"1-2\", \"coins\": \"lots\"}}",
            "{\"version\": 1, \"game\": \"spiritfire\", \"kind\": \"run\", \"run\": {\"heroId\": \"fox\", \"stageCode\": \"1-2\", \"flags\": {\"meta.banked\": 1}}}",
            "{\"version\": 1, \"game\": \"spiritfire\", \"kind\": \"run\", \"run\": {\"heroId\": \"fox\", \"stageCode\": \"1-2\", \"weapons\": [{\"id\": \"smg\", \"rarity\": 9}]}}",
            "{\"version\": 1, \"game\": \"spiritfire\", \"kind\": \"run\", \"run\": {\"heroId\": \"fox\", \"stageCode\": \"1-2\"}} trailing",
        };

        [Test]
        public void CorruptFilesAreDiscardedWithANotice([ValueSource(nameof(Broken))] string text)
        {
            File.WriteAllText(MainPath, text);
            Assert.AreEqual(SuspendStatus.Corrupt, RunSuspend.Read(false, out var s, out var error));
            Assert.IsNull(s);
            Assert.IsFalse(string.IsNullOrEmpty(error));
            Assert.DoesNotThrow(() => Assert.IsNull(RunSuspend.Peek(false)));
            Assert.IsFalse(File.Exists(MainPath), "坏档不再提供「继续征程」");
            Assert.IsTrue(File.Exists(RunSuspend.CorruptPathFor(false)), "坏档留一份 .corrupt 排查");
            Assert.IsNotNull(RunSuspend.TakeProblem(), "主菜单要提示一次");
            Assert.IsNull(RunSuspend.TakeProblem(), "只提示一次");
        }

        [Test]
        public void TruncatedFileIsCorrupt()
        {
            Assert.IsTrue(RunSuspend.Write(SampleRun(), false));
            var full = File.ReadAllText(MainPath);
            File.WriteAllText(MainPath, full.Substring(0, full.Length / 2));
            Assert.IsNull(RunSuspend.Peek(false));
            Assert.IsNotNull(RunSuspend.TakeProblem());
            Assert.IsFalse(RunSuspend.Exists(false));
        }

        [Test]
        public void NewerVersionIsKeptButNotOffered()
        {
            File.WriteAllText(MainPath, "{\"version\": 99, \"game\": \"spiritfire\", \"kind\": \"run\", \"run\": {}}");
            Assert.AreEqual(SuspendStatus.Newer, RunSuspend.Read(false, out _, out var error));
            Assert.IsNotNull(error);
            Assert.IsNull(RunSuspend.Peek(false));
            Assert.IsTrue(File.Exists(MainPath), "新版本的档原样留着");
            Assert.IsNotNull(RunSuspend.TakeProblem());
        }

        [Test]
        public void MissingFileIsNone()
        {
            Assert.AreEqual(SuspendStatus.None, RunSuspend.Read(false, out var s, out var error));
            Assert.IsNull(s);
            Assert.IsNull(error);
            Assert.IsNull(RunSuspend.Peek(false));
            Assert.IsNull(RunSuspend.TakeProblem());
        }

        // ───────────── 删档 / 放弃 / 暂离 ─────────────

        [Test]
        public void BankingARunDeletesItsSuspendFile()
        {
            RunSuspend.EnsureInstalled();
            var run = SampleRun();
            Assert.IsTrue(RunSuspend.Write(run, false));
            var s = MetaSave.BankRun(run, false);
            Assert.IsNotNull(s);
            Assert.IsFalse(RunSuspend.Exists(false), "阵亡 / 放弃结算后删掉续玩档");

            Assert.IsTrue(RunSuspend.Write(SampleRun(), false));
            var win = SampleRun();
            win.seed = 42;
            Assert.IsNotNull(MetaSave.BankRun(win, true));
            Assert.IsFalse(RunSuspend.Exists(false), "胜利结算后也删");
        }

        [Test]
        public void ForfeitBanksTheSuspendedRunAsADefeat()
        {
            var run = SampleRun();
            Assert.IsTrue(RunSuspend.Write(run, false));
            var career = SaveService.Main.Section<CareerStats>();
            var meta = SaveService.Main.Section<MetaSave>();
            int runs = career.Runs, essence = meta.Essence;
            var s = RunSuspend.Forfeit(false);
            Assert.IsNotNull(s);
            Assert.IsFalse(s.victory);
            Assert.AreEqual("1-2", s.stageCode);
            Assert.AreEqual(runs + 1, career.Runs);
            Assert.AreEqual(essence + run.essence, meta.Essence, "放弃的局魂晶照常入账");
            Assert.IsFalse(RunSuspend.Exists(false));
            Assert.IsNull(RunSuspend.Forfeit(false), "没有档时什么都不结");
        }

        [Test]
        public void CanSuspendOnlyWithItsOwnSnapshotOnDisk()
        {
            var run = SampleRun();
            Assert.IsFalse(RunSuspend.CanSuspend(run), "还没写档");
            Assert.IsTrue(RunSuspend.Write(SceneFlow.CloneRun(run), false));
            Assert.IsTrue(RunSuspend.CanSuspend(run));
            var other = SampleRun();
            other.seed = 7;
            Assert.IsFalse(RunSuspend.CanSuspend(other), "别的局不算");
            run.SetFlag(MetaSave.BankedFlag, 1);
            Assert.IsFalse(RunSuspend.CanSuspend(run), "结算过的局（阵亡后练习）不能暂离");
            run.SetFlag(MetaSave.BankedFlag, 0);
            RunSuspend.Discard(false);
            Assert.IsFalse(RunSuspend.CanSuspend(run));
            RunSuspend.Enabled = false;
            Assert.IsFalse(RunSuspend.ShouldWrite(run));
        }

        // ───────────── 图鉴 ─────────────

        [Test]
        public void CodexUnlocksPersistAcrossReload()
        {
            var codex = SaveService.Main.Section<Codex>();
            var enemy = CodexCatalog.Of(CodexKind.Enemy)[0].id;
            var scroll = CodexCatalog.Of(CodexKind.Scroll)[0].id;
            var pet = CodexCatalog.Of(CodexKind.Pet)[0].id;
            var heard = new List<string>();
            void OnUnlocked(CodexKind k, string id) => heard.Add($"{k}:{id}");
            Codex.Unlocked += OnUnlocked;
            try
            {
                Assert.IsTrue(codex.Unlock(CodexKind.Weapon, "smg"));
                Assert.IsFalse(codex.Unlock(CodexKind.Weapon, "smg"), "已经收录过");
                Assert.IsTrue(codex.Unlock(CodexKind.Enemy, enemy));
                Assert.IsTrue(codex.Unlock(CodexKind.Scroll, scroll));
                Assert.IsTrue(codex.Unlock(CodexKind.Pet, pet));
                Assert.IsTrue(codex.Unlock(CodexKind.Enemy, "future_enemy"), "认不出的 id 也收（以后的版本）");
                Assert.IsFalse(codex.Unlock(CodexKind.Enemy, null));
            }
            finally
            {
                Codex.Unlocked -= OnUnlocked;
            }
            Assert.AreEqual(5, heard.Count);
            Assert.AreEqual(4, codex.TotalCount, "收录数只数清单里有的");
            Assert.IsTrue(codex.IsFresh(CodexKind.Weapon, "smg"));
            Assert.IsTrue(SaveService.Main.Save());

            Reopen();
            var c = Codex.Current;
            Assert.IsTrue(c.IsUnlocked(CodexKind.Weapon, "smg"));
            Assert.IsTrue(c.IsUnlocked(CodexKind.Enemy, enemy));
            Assert.IsTrue(c.IsUnlocked(CodexKind.Scroll, scroll));
            Assert.IsTrue(c.IsUnlocked(CodexKind.Pet, pet));
            Assert.IsTrue(c.IsUnlocked(CodexKind.Enemy, "future_enemy"));
            Assert.IsFalse(c.IsUnlocked(CodexKind.Weapon, "revolver"));
            CollectionAssert.AreEqual(new[] { enemy, "future_enemy" }, c.UnlockedIds(CodexKind.Enemy).ToArray(), "按收录先后");
            Assert.IsTrue(c.IsFresh(CodexKind.Weapon, "smg"), "「新」标记也存着");
            Assert.AreEqual(1, c.FreshCount(CodexKind.Weapon));

            c.MarkSeen(CodexKind.Weapon, "smg");
            Assert.IsTrue(SaveService.Main.Save());
            Reopen();
            Assert.IsFalse(Codex.Current.IsFresh(CodexKind.Weapon, "smg"));
            Assert.IsTrue(Codex.Current.IsUnlocked(CodexKind.Weapon, "smg"));
        }

        [Test]
        public void CodexSurvivesRunEndAndStaysPerProfile()
        {
            var run = SampleRun();
            Codex.For(run).Unlock(CodexKind.Weapon, "revolver");
            Assert.IsNotNull(MetaSave.BankRun(run, false), "BankRun 写盘（把图鉴段一起写下去）");
            Reopen();
            Assert.IsTrue(Codex.Current.IsUnlocked(CodexKind.Weapon, "revolver"), "图鉴是元进度，一局结束不清");

            var dev = SampleRun();
            dev.dev = true;
            Codex.For(dev).Unlock(CodexKind.Weapon, "smg");
            Assert.IsFalse(Codex.For(run).IsUnlocked(CodexKind.Weapon, "smg"), "调试局只记调试档");
            Assert.IsTrue(SaveService.Dev.Section<Codex>().IsUnlocked(CodexKind.Weapon, "smg"));
        }

        [Test]
        public void CodexReadsBrokenSectionLeniently()
        {
            File.WriteAllText(Path.Combine(root, SaveService.MainName + ".json"),
                "{\"version\": 2, \"game\": \"spiritfire\", \"sections\": {\"codex\": {\"v\": 1, \"data\": {\"weapon\": 5, \"enemy\": [\"apsara\", 3, \"apsara\", \"\"], \"fresh\": \"x\"}}}}");
            Reopen();
            var c = Codex.Current;
            Assert.AreEqual(0, c.Count(CodexKind.Weapon));
            Assert.IsTrue(c.IsUnlocked(CodexKind.Enemy, "apsara"));
            Assert.AreEqual(1, c.UnlockedIds(CodexKind.Enemy).Count, "去重、跳过不是字符串的项");
            Assert.AreEqual(0, c.FreshCount(CodexKind.Enemy));
        }

        [Test]
        public void CatalogListsFourKindsWithoutSidekicksOrTestBosses()
        {
            foreach (CodexKind k in Enum.GetValues(typeof(CodexKind)))
            {
                var list = CodexCatalog.Of(k);
                Assert.Greater(list.Count, 0, $"{k} 没有条目");
                foreach (var e in list)
                {
                    Assert.IsFalse(string.IsNullOrEmpty(e.name), $"{e} 没有名字");
                    Assert.IsNotNull(e.def, $"{e} 没有定义");
                }
                Assert.AreEqual(list.Count, list.Select(e => e.id).Distinct().Count(), $"{k} 有重复条目");
            }
            Assert.AreEqual(WeaponLibrary.All.Count, CodexCatalog.Of(CodexKind.Weapon).Count);
            Assert.AreEqual(ScrollLibrary.All.Count, CodexCatalog.Of(CodexKind.Scroll).Count);
            Assert.AreEqual(PetLibrary.All.Length, CodexCatalog.Of(CodexKind.Pet).Count);
            var enemies = CodexCatalog.Of(CodexKind.Enemy).Select(e => e.id).ToList();
            CollectionAssert.DoesNotContain(enemies, "mirage_toad_decoy");
            CollectionAssert.DoesNotContain(enemies, "tantong_ember");
            CollectionAssert.DoesNotContain(enemies, "tantong_reborn");
            CollectionAssert.DoesNotContain(enemies, "boss_proxy");
            CollectionAssert.DoesNotContain(enemies, "boss_hazard_lab");
            foreach (var b in new[] { "boss_hanba", "boss_kunpeng", "boss_warlord", "boss_qilin" }) CollectionAssert.Contains(enemies, b);
            Assert.AreEqual("tantong", CodexCatalog.EnemyId("tantong_reborn"), "复燃的炭童算炭童");
            Assert.IsNull(CodexCatalog.EnemyId("mirage_toad_decoy"));
            // 按章排，首领在本章末尾
            var list2 = CodexCatalog.Of(CodexKind.Enemy);
            int hanba = enemies.IndexOf("boss_hanba"), kunpeng = enemies.IndexOf("boss_kunpeng");
            Assert.IsTrue(list2.Take(hanba).All(e => e.chapter <= 1), "旱魃之前都是第一章");
            Assert.IsTrue(list2.Skip(hanba + 1).Take(kunpeng - hanba - 1).All(e => e.chapter == 2), "旱魃与鲲鹏之间都是第二章");
            foreach (var e in list2) Assert.IsFalse(string.IsNullOrEmpty(CodexCatalog.Describe(e)), $"{e} 没有描述");
        }
    }
}
