using System;
using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// R2 存档（docs/unity-parity.md D22 / 7.3「坏档能从 .bak 恢复；天赋生效」）：
    /// 往返、坏主文件从 .bak 恢复、两份都坏回到默认、网页版 v1 存档迁移、段级版本、新版本文件只读、天赋价格与属性、调试档隔离、设置搬进共享文件。
    /// 每个测试把存档根目录指到独立的临时目录（<see cref="SaveService.UseRoot"/>），不碰真实存档。
    /// </summary>
    public sealed class SaveServiceTests
    {
        string root;
        RunState prevRun;

        [SetUp]
        public void SetUp()
        {
            root = Path.Combine(Path.GetTempPath(), "spiritfire-save-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            SaveService.UseRoot(root);
            SaveService.ForceDev = false;
            prevRun = RunState.Current;
            RunState.Current = null;
        }

        [TearDown]
        public void TearDown()
        {
            RunState.Current = prevRun;
            SaveService.ForceDev = false;
            SaveService.UseRoot(null);
            try { Directory.Delete(root, true); }
            catch (Exception) { /* 临时目录，删不掉无所谓 */ }
        }

        /// <summary>丢掉内存里的文件，下次访问重新读盘</summary>
        void Reopen() => SaveService.UseRoot(root);

        string MainPath => Path.Combine(root, SaveService.MainName + ".json");

        // ───────────── 往返 ─────────────

        [Test]
        public void RoundTripKeepsMetaAndCareer()
        {
            var file = SaveService.Main;
            var meta = file.Section<MetaSave>();
            Assert.AreEqual(SaveLoadStatus.Fresh, file.Status);
            Assert.AreEqual(0, meta.Essence);

            meta.AddEssence(1000);
            Assert.IsTrue(meta.BuyTalent("vitality"));
            Assert.IsTrue(meta.BuyTalent("vitality"));
            Assert.IsTrue(meta.BuyTalent("fortune"));
            Assert.AreEqual(1000 - 60 - 120 - 60, meta.Essence);

            var career = file.Section<CareerStats>();
            career.Record(new RunSummary { victory = false, heroId = "fox", chapter = 2, stagesCleared = 5, kills = 120, time = 900, damageDealt = 5000, essenceEarned = 80 });
            career.Record(new RunSummary { victory = true, heroId = "fox", chapter = 3, stagesCleared = 12, kills = 400, time = 3000, damageDealt = 90000, essenceEarned = 300 });
            Assert.IsTrue(file.Save());
            Assert.IsFalse(File.Exists(MainPath + ".tmp"), "原子写不留临时文件");

            Reopen();
            file = SaveService.Main;
            var m = file.Section<MetaSave>();
            var c = file.Section<CareerStats>();
            Assert.AreEqual(SaveLoadStatus.Loaded, file.Status);
            Assert.IsFalse(file.Migrated);
            Assert.AreEqual(SaveService.CurrentVersion, file.FileVersion);
            Assert.AreEqual(760, m.Essence);
            Assert.AreEqual(2, m.TalentLevel("vitality"));
            Assert.AreEqual(1, m.TalentLevel("fortune"));
            Assert.AreEqual(0, m.TalentLevel("mastery"));
            Assert.AreEqual(200, m.NextTalentCost("vitality"));
            foreach (var h in MetaSave.DefaultHeroes) Assert.IsTrue(m.IsHeroUnlocked(h), $"D8：{h} 默认解锁");

            Assert.AreEqual(2, c.Runs);
            Assert.AreEqual(1, c.Wins);
            Assert.AreEqual(1, c.Deaths);
            Assert.AreEqual(1, c.DeathsInChapter(2));
            Assert.AreEqual(0, c.DeathsInChapter(1));
            Assert.AreEqual(3, c.BestChapter);
            Assert.AreEqual(12, c.BestStages);
            Assert.AreEqual(520, c.TotalKills);
            Assert.AreEqual(400, c.MostKills);
            Assert.AreEqual(3000f, c.FastestWin, 1e-3f);
            Assert.AreEqual(3900.0, c.TotalTime, 1e-3);
            Assert.AreEqual(95000.0, c.TotalDamage, 1e-3);
            Assert.AreEqual(380L, c.TotalEssence);
            Assert.AreEqual(2, c.RunsAs("fox"));
            Assert.AreEqual(1, c.WinsAs("fox"));
        }

        // ───────────── 坏档 ─────────────

        [Test]
        public void CorruptMainRecoversFromBackup()
        {
            var file = SaveService.Main;
            var meta = file.Section<MetaSave>();
            meta.AddEssence(100); // 第一次写：只有主文件
            Assert.IsFalse(File.Exists(file.BackupPath));
            meta.AddEssence(50); // 第二次写：旧主文件（100）轮换成 .bak
            Assert.IsTrue(File.Exists(file.BackupPath));

            // 写到一半断电：截断的 JSON
            File.WriteAllText(MainPath, "{\"version\":2,\"sections\":{\"meta\":{\"v\":1,\"data\":{\"essence\":99");
            Reopen();
            file = SaveService.Main;
            var m = file.Section<MetaSave>();
            Assert.AreEqual(SaveLoadStatus.RecoveredFromBackup, file.Status);
            Assert.AreEqual(100, m.Essence, "回到 .bak 里的上一份");
            Assert.IsTrue(File.Exists(file.CorruptPath), "坏文件留作排查");
            Assert.IsFalse(File.Exists(MainPath), "坏文件挪开了，不会被轮换进 .bak");

            // 下一次保存写出新主文件，.bak 仍是好的那份
            m.AddEssence(1);
            Assert.IsTrue(File.Exists(MainPath));
            Reopen();
            Assert.AreEqual(SaveLoadStatus.Loaded, SaveService.Main.Status);
            Assert.AreEqual(101, SaveService.Main.Section<MetaSave>().Essence);

            // 主文件变成一堆 0 字节（断电后常见），也从 .bak 恢复
            File.WriteAllBytes(MainPath, new byte[64]);
            Reopen();
            Assert.AreEqual(SaveLoadStatus.RecoveredFromBackup, SaveService.Main.Status);
            Assert.AreEqual(100, SaveService.Main.Section<MetaSave>().Essence);
        }

        [Test]
        public void BothCorruptFallsBackToDefaultsWithoutLosingTheFile()
        {
            File.WriteAllText(MainPath, "not json");
            File.WriteAllText(MainPath + ".bak", "[1, 2, 3]");
            var file = SaveService.Main;
            var m = file.Section<MetaSave>();
            Assert.AreEqual(SaveLoadStatus.Corrupt, file.Status);
            Assert.AreEqual(0, m.Essence);
            Assert.IsTrue(File.Exists(file.CorruptPath));
            Assert.AreEqual("not json", File.ReadAllText(file.CorruptPath));

            m.AddEssence(7);
            Reopen();
            Assert.AreEqual(SaveLoadStatus.Loaded, SaveService.Main.Status);
            Assert.AreEqual(7, SaveService.Main.Section<MetaSave>().Essence);
        }

        // ───────────── 迁移 ─────────────

        /// <summary>v1 = 网页版 localStorage 的 gunflame.meta.v1 原样：迁成 v2 的 meta / career 段，按网页版 sanitize 的规则清洗</summary>
        [Test]
        public void MigratesWebV1Save()
        {
            const string web = "{\"version\":1,\"essence\":345.7," +
                               "\"talents\":{\"vitality\":3,\"mastery\":9,\"bogus\":-2,\"lethal\":\"x\",\"future\":2}," +
                               "\"unlockedHeroes\":[\"fox\",\"ghost\",\"\",7]," +
                               "\"stats\":{\"runs\":7,\"wins\":2,\"bestChapter\":3,\"bestStages\":11,\"totalKills\":812}}";
            File.WriteAllText(MainPath, web);

            var file = SaveService.Main;
            var meta = file.Section<MetaSave>();
            var career = file.Section<CareerStats>();
            Assert.AreEqual(SaveLoadStatus.Loaded, file.Status);
            Assert.IsTrue(file.Migrated);
            Assert.AreEqual(1, file.FileVersion);

            Assert.AreEqual(345, meta.Essence, "小数向下取整");
            Assert.AreEqual(3, meta.TalentLevel("vitality"));
            Assert.AreEqual(5, meta.TalentLevel("mastery"), "超过满级夹到 5");
            Assert.AreEqual(0, meta.TalentLevel("lethal"), "类型不对当 0");
            Assert.IsTrue(meta.IsHeroUnlocked("ghost"), "网页版解锁过的保留");
            Assert.IsTrue(meta.IsHeroUnlocked("falcon"), "默认英雄总在");

            Assert.AreEqual(7, career.Runs);
            Assert.AreEqual(2, career.Wins);
            Assert.AreEqual(5, career.Deaths, "网页版没有阵亡数：按 局数 − 胜场 补");
            Assert.AreEqual(3, career.BestChapter);
            Assert.AreEqual(11, career.BestStages);
            Assert.AreEqual(812, career.TotalKills);

            Assert.IsTrue(file.Save());
            var text = File.ReadAllText(MainPath);
            StringAssert.Contains("\"version\": 2", text);
            StringAssert.Contains("\"sections\"", text);
            StringAssert.Contains("\"future\"", text, "不认识的天赋 id 原样保留");

            Reopen();
            file = SaveService.Main;
            Assert.AreEqual(SaveLoadStatus.Loaded, file.Status);
            Assert.IsFalse(file.Migrated);
            Assert.AreEqual(2, file.FileVersion);
            Assert.AreEqual(345, file.Section<MetaSave>().Essence);
            Assert.AreEqual(7, file.Section<CareerStats>().Runs);
        }

        /// <summary>段级迁移钩子：Restore 拿到写盘时的段版本；没人认领的段原样写回</summary>
        [Test]
        public void SectionVersionsAndUnknownSectionsSurvive()
        {
            var probe = SaveService.Main.Section<ProbeV1>();
            probe.n = 5;
            Assert.IsTrue(SaveService.Main.Save());

            // 这次没人认领 probe：保存时原样写回
            Reopen();
            SaveService.Main.Section<MetaSave>().AddEssence(3);
            Reopen();
            Assert.IsTrue(SaveService.Main.Has("probe"));

            // 新版本的段读到 v1 数据，自己升级
            var v2 = SaveService.Main.Section<ProbeV2>();
            Assert.AreEqual(1, v2.restoredFrom);
            Assert.AreEqual(50, v2.tenths, "v1 的 n 是整数，v2 改存十分之一");
            Assert.AreEqual(3, SaveService.Main.Section<MetaSave>().Essence);

            Assert.Throws<InvalidOperationException>(() => SaveService.Main.Section<ProbeV1>(), "同一文件里段名重复直接报错");
        }

        [Test]
        public void NewerFileIsReadOnly()
        {
            const string future = "{\"version\":99,\"sections\":{\"meta\":{\"v\":3,\"data\":{\"essence\":5}}}}";
            File.WriteAllText(MainPath, future);
            var file = SaveService.Main;
            Assert.IsTrue(file.ReadOnly);
            Assert.AreEqual(5, file.Section<MetaSave>().Essence, "认识的字段照读");
            Assert.IsFalse(file.Save(), "不把新版本的存档写坏");
            Assert.AreEqual(future, File.ReadAllText(MainPath));
        }

        // ───────────── 天赋 ─────────────

        [Test]
        public void TalentTableMatchesThreeJs()
        {
            string[] ids = { "vitality", "barrier", "mastery", "lethal", "swift", "reload", "affinity", "haste", "wealth", "fortune" };
            Assert.AreEqual(ids.Length, TalentLibrary.All.Count);
            for (int i = 0; i < ids.Length; i++) Assert.AreEqual(ids[i], TalentLibrary.All[i].id, "顺序同 TS TALENTS");

            foreach (var t in TalentLibrary.All)
            {
                Assert.AreEqual(5, t.maxLevel);
                CollectionAssert.AreEqual(new[] { 60, 120, 200, 300, 450 }, new[] { t.NextCost(0), t.NextCost(1), t.NextCost(2), t.NextCost(3), t.NextCost(4) });
                Assert.AreEqual(-1, t.NextCost(5));
                Assert.AreEqual(1130, t.TotalCost);
            }
            Assert.AreEqual("+8%", TalentLibrary.Get("wealth").Effect(1));
            Assert.AreEqual("+40", TalentLibrary.Get("vitality").Effect(5));

            var meta = SaveService.Main.Section<MetaSave>();
            Assert.IsFalse(meta.BuyTalent("vitality"), "没魂晶买不了");
            meta.AddEssence(59);
            Assert.IsFalse(meta.BuyTalent("vitality"), "差 1 也买不了");
            meta.AddEssence(1);
            Assert.IsTrue(meta.BuyTalent("vitality"));
            Assert.AreEqual(0, meta.Essence);
            Assert.IsFalse(meta.BuyTalent("nope"));
            meta.SetTalentLevel("vitality", 5);
            meta.AddEssence(10000);
            Assert.IsFalse(meta.BuyTalent("vitality"), "满级不能再买");
            Assert.AreEqual(10000, meta.Essence);
        }

        [Test]
        public void TalentsApplyToStatSheetUnderTalentSource()
        {
            var meta = SaveService.Main.Section<MetaSave>();
            meta.SetTalentLevel("vitality", 2, false);
            meta.SetTalentLevel("barrier", 5, false);
            meta.SetTalentLevel("mastery", 3, false);
            meta.SetTalentLevel("lethal", 1, false);
            meta.SetTalentLevel("swift", 4, false);
            meta.SetTalentLevel("reload", 2, false);
            meta.SetTalentLevel("affinity", 5, false);
            meta.SetTalentLevel("haste", 1, false);
            meta.SetTalentLevel("wealth", 3, false);
            meta.SetTalentLevel("fortune", 99, false);
            Assert.AreEqual(5, meta.TalentLevel("fortune"), "设等级也夹到满级");

            var s = StatSheet.Default(); // 生命 100、护盾 50、移速 7.5、暴击 5%
            Assert.IsTrue(meta.ApplyTalents(s));
            Assert.AreEqual(116f, s.Get(Stat.MaxHp), 1e-4f);
            Assert.AreEqual(80f, s.Get(Stat.MaxShield), 1e-4f);
            Assert.AreEqual(0.12f, s.Get(Stat.DamagePct), 1e-4f);
            Assert.AreEqual(0.07f, s.Get(Stat.CritChance), 1e-4f);
            Assert.AreEqual(8.1f, s.Get(Stat.MoveSpeed), 1e-4f);
            Assert.AreEqual(0.10f, s.Get(Stat.ReloadSpeedPct), 1e-4f);
            Assert.AreEqual(0.15f, s.Get(Stat.ElementChancePct), 1e-4f);
            Assert.AreEqual(0.05f, s.Get(Stat.SkillHaste), 1e-4f);
            Assert.AreEqual(0.24f, s.Get(Stat.CoinGainPct), 1e-4f);
            Assert.AreEqual(5f, s.Get(Stat.Luck), 1e-4f);
            Assert.AreEqual(10, s.ModsFrom(MetaSave.TalentSource).Count);

            // 重复套用不动属性表（不发 Changed：PlayerVitals 撤上限再加回会白送生命）
            int version = s.Version;
            Assert.IsFalse(meta.ApplyTalents(s));
            Assert.AreEqual(version, s.Version);

            // 等级变了：旧的整体撤掉再加
            meta.SetTalentLevel("vitality", 0, false);
            Assert.IsTrue(meta.ApplyTalents(s));
            Assert.AreEqual(100f, s.Get(Stat.MaxHp), 1e-4f);
            Assert.AreEqual(9, s.ModsFrom(MetaSave.TalentSource).Count);

            // 全部清零：来源撤掉，其他来源不受影响
            s.Add("scroll", Stat.MaxHp, 30);
            foreach (var t in TalentLibrary.All) meta.SetTalentLevel(t.id, 0, false);
            Assert.IsTrue(meta.ApplyTalents(s));
            Assert.IsFalse(s.HasSource(MetaSave.TalentSource));
            Assert.AreEqual(130f, s.Get(Stat.MaxHp), 1e-4f);
            Assert.IsFalse(meta.ApplyTalents(s));
        }

        // ───────────── 调试档 ─────────────

        [Test]
        public void DevRunsNeverTouchTheRealProfile()
        {
            var main = SaveService.Main.Section<MetaSave>();
            main.AddEssence(100);
            var mainBytes = File.ReadAllBytes(MainPath);

            var run = new RunState { dev = true, essence = 40, kills = 12, chapter = 1, stagesCleared = 1, heroId = "fox", time = 300 };
            Assert.AreSame(SaveService.Dev, SaveService.ProfileFor(run));
            var summary = MetaSave.BankRun(run, false);
            Assert.NotNull(summary);
            Assert.IsTrue(summary.dev);
            Assert.AreEqual(40, summary.essenceEarned);
            Assert.AreEqual(0, summary.victoryBonus);
            Assert.IsNull(MetaSave.BankRun(run, false), "同一局只结算一次");

            Assert.AreEqual(40, SaveService.Dev.Section<MetaSave>().Essence);
            Assert.AreEqual(1, SaveService.Dev.Section<CareerStats>().Runs);
            Assert.AreEqual(1, SaveService.Dev.Section<CareerStats>().DeathsInChapter(1));
            Assert.AreEqual(100, main.Essence);
            Assert.AreEqual(0, SaveService.Main.Section<CareerStats>().Runs);
            CollectionAssert.AreEqual(mainBytes, File.ReadAllBytes(MainPath), "调试局结算不写正式档");
            Assert.IsTrue(File.Exists(Path.Combine(root, SaveService.DevName + ".json")));

            // 当前局是调试局 → 当前档是调试档；没有局 → 正式档；ForceDev → 调试档
            RunState.Current = run;
            Assert.IsTrue(SaveService.DevActive);
            Assert.AreSame(SaveService.Dev.Section<MetaSave>(), MetaSave.Current);
            RunState.Current = null;
            Assert.AreSame(main, MetaSave.Current);
            SaveService.ForceDev = true;
            Assert.AreSame(SaveService.Dev, SaveService.Profile);
            Assert.AreSame(SaveService.Dev, SaveService.ProfileFor(new RunState()));
            SaveService.ForceDev = false;

            // 正式局通关：局内魂晶 + 200 记进正式档
            var real = new RunState { essence = 10, chapter = 3, stagesCleared = 12, heroId = "fox", time = 1800 };
            var s2 = MetaSave.BankRun(real, true);
            Assert.AreEqual(200, s2.victoryBonus);
            Assert.AreEqual(210, s2.essenceEarned);
            Assert.AreEqual(310, main.Essence);
            Assert.AreEqual(1, SaveService.Main.Section<CareerStats>().Wins);
            Assert.AreEqual(40, SaveService.Dev.Section<MetaSave>().Essence, "正式局也不碰调试档");
        }

        // ───────────── 设置 ─────────────

        [Test]
        public void SettingsLiveInTheSharedFile()
        {
            GameSettings.Fov.Set(61);
            GameSettings.Fov.Set(97);
            var shared = Path.Combine(root, SaveService.SharedName + ".json");
            Assert.IsTrue(File.Exists(shared), "编辑模式下改设置立即写盘");
            Assert.IsFalse(File.Exists(MainPath), "设置不进正式档");

            Reopen();
            Assert.AreEqual(97f, GameSettings.Fov.Value, 1e-4f, "换了文件对象后重新读盘");
            SaveService.ForceDev = true;
            Assert.AreEqual(97f, GameSettings.Fov.Value, 1e-4f, "调试档和正式档共用设置");
        }

        // ───────────── 测试用的段 ─────────────

        [Serializable]
        struct ProbeData
        {
            public int n;
        }

        sealed class ProbeV1 : ISaveSection
        {
            public int n;
            public string Key => "probe";
            public int Version => 1;
            public string Capture() => JsonUtility.ToJson(new ProbeData { n = n });
            public void Restore(string json, int version) => n = json == null ? 0 : JsonUtility.FromJson<ProbeData>(json).n;
        }

        sealed class ProbeV2 : ISaveSection
        {
            public int tenths, restoredFrom = -1;
            public string Key => "probe";
            public int Version => 2;
            public string Capture() => "{\"tenths\":" + tenths + "}";

            public void Restore(string json, int version)
            {
                restoredFrom = version;
                if (json == null) return;
                tenths = version < 2 ? JsonUtility.FromJson<ProbeData>(json).n * 10 : JsonUtility.FromJson<V2Data>(json).tenths;
            }

            [Serializable]
            struct V2Data
            {
                public int tenths;
            }
        }
    }
}
