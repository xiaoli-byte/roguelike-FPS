using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 4-1 三领主（夔、飞廉、化蛇）的定义、定档、时间轴与登场镜头表（第四章移植 B1 路）：
    ///   定义自检、血条刻度 66% / 33%、领主梯度（lordLevel = 4-1、转阶段只出横幅）、破防条按网页值 × 耐久比例换算；
    ///   定档：4-1 难度 3.4 下第 1 / 2 / 3 个打（血 × 1 / 1.15 / 1.3）的模拟击杀用时都在 60–120 s；
    ///   招式：前摇 / 出手 / 收招和 docs/art/ch4-move-events.json 一致（状态名 = 招式 id），events.json 里的出手事件落在释放帧上（≤ 1 帧）；
    ///   登场：镜头表的段落起止和 ch4-boss-intros.json 一致（最后一段 land = 过肩机位 + 落回），首领自己的登场动作在交还前播完；
    ///   圣湖的游线在湖里；BossEncounter 的据点模式默认关（前三章不变）。
    /// </summary>
    public sealed class LordTests
    {
        static IEnumerable<LordDef> Defs() => new LordDef[] { new KuiDef(), new FeilianDef(), new HuasheDef() };

        [Test]
        public void Defs_Validate_TicksLordLevelAndBreakBar()
        {
            foreach (var d in Defs())
            {
                var errs = d.Validate();
                Assert.IsEmpty(errs, $"{d.id}：{string.Join("；", errs)}");
                CollectionAssert.AreEqual(new[] { 0.66f, 0.33f }, d.BarTicks.ToArray(), $"{d.id} 血条刻度");
                Assert.AreEqual(LordDef.Level, d.lordLevel, $"{d.id} 按 4-1 的领主梯度");
                Assert.IsFalse(d.phaseCinematic, $"{d.id}：4-1 领主转阶段只出横幅");
                Assert.IsNotNull(d.breakBar, $"{d.id} 有破防条");
                Assert.AreEqual(d.StageHp / d.webHp, d.WebScale, 1e-4f);
                Assert.That(d.phases.All(p => !string.IsNullOrEmpty(p.toast)), $"{d.id} 两次转阶段都有阶段名横幅");
                Assert.IsNotNull(Bosses.Get(d.id), $"{d.id} 已登记");
            }
            Assert.AreEqual(900f * KuiDef.TierHp / KuiDef.Web, new KuiDef().breakBar.max, 1e-2f, "夔的破鼓按网页 900 换算");
            Assert.AreEqual("破鼓", new KuiDef().breakBar.label);
            Assert.AreEqual("珠碎", new FeilianDef().breakBar.label);
            Assert.AreEqual("噎住", new HuasheDef().breakBar.label);
            Assert.IsNotNull(new HuasheDef().breakBar.fillWhen, "化蛇只在张嘴时填破防条");
        }

        [Test]
        public void Tiers_KillTimesWithin60To120Seconds()
        {
            foreach (var d in Defs())
                for (int n = 0; n < 3; n++)
                {
                    float s = d.EstimateKillSeconds(n);
                    Assert.That(s, Is.InRange(60f, 120f), $"{d.id} 第 {n + 1} 个打：{s:F0} s");
                    if (n == 0) Assert.That(s, Is.InRange(65f, 85f), $"{d.id} 第一个打：{s:F0} s");
                }
            // 网页的血量比例（12k : 11k : 10.5k）保留
            Assert.Greater(new KuiDef().StageHp, new FeilianDef().StageHp);
            Assert.Greater(new FeilianDef().StageHp, new HuasheDef().StageHp);
        }

        // ───────────── 招式时间轴（docs/art/ch4-move-events.json）─────────────

        /// <summary>ch4-move-events.json 的 moves：招式 id → (前摇, 出手, 收招)</summary>
        static readonly Dictionary<string, Dictionary<string, (float w, float a, float r)>> Table = new()
        {
            [KuiDef.Id] = new()
            {
                ["hop"] = (0.3f, 0.55f, 0.25f), ["leap"] = (0.75f, 1.05f, 0.8f), ["leapChain"] = (0.5f, 0.9f, 0.35f), ["turnLeap"] = (0.3f, 0.5f, 0.3f),
                ["knuckle"] = (0f, 3.9f, 0f), ["clap"] = (0.6f, 0.2f, 0.6f), ["drum"] = (0.8f, 1.8f, 1f), ["drum5"] = (0.8f, 3f, 1f),
            },
            [FeilianDef.Id] = new()
            {
                ["gust"] = (1f, 0.6f, 0.8f), ["charge"] = (0.8f, 1.4f, 1f), ["blades"] = (0.6f, 0.1f, 0.6f), ["sidestep"] = (0.1f, 0.6f, 0.2f),
                ["tornado"] = (1f, 0.2f, 0.6f), ["wheel"] = (0.8f, 2.2f, 1.2f), ["stormburst"] = (4f, 0.3f, 1.5f),
            },
            [HuasheDef.Id] = new()
            {
                ["spit"] = (0.6f, 1.35f, 0.6f), ["lunge"] = (0.7f, 0.35f, 1.2f), ["wingslap"] = (0.8f, 0.4f, 0.6f), ["roar"] = (0.6f, 2.4f, 0.8f),
                ["dive"] = (1.5f, 0.35f, 1.2f), ["tailsweep"] = (0.7f, 0.5f, 0.8f),
            },
        };

        [Test]
        public void Moves_MatchCh4MoveTable()
        {
            foreach (var d in Defs())
            {
                var moves = d.moves.Select(m => m()).Cast<LordMove>().ToList();
                var want = Table[d.id];
                CollectionAssert.AreEquivalent(want.Keys, moves.Select(m => m.Id), $"{d.id} 的招式 = 表里的招式");
                foreach (var m in moves)
                {
                    var (w, a, r) = want[m.Id];
                    Assert.AreEqual(w, m.windup, 1e-4f, $"{d.id}.{m.Id} 前摇");
                    Assert.AreEqual(a, m.active, 1e-4f, $"{d.id}.{m.Id} 出手");
                    Assert.AreEqual(r, m.recover, 1e-4f, $"{d.id}.{m.Id} 收招");
                    Assert.AreEqual(w + a + r, m.DesignSeconds, 1e-4f, $"{d.id}.{m.Id} 片段设计时长");
                }
            }
            // 阶段限定（ch4 combat 4.1–4.3）
            Assert.AreEqual(1, new KuiChestDrum().minPhase, "捶胸二阶段起");
            Assert.AreEqual(2, new KuiChestDrum5().minPhase, "捶胸五下三阶段");
            Assert.AreEqual(2, new KuiLeapChain().minPhase, "连环大跳三阶段");
            Assert.AreEqual(1, new FeilianTornadoMove().minPhase);
            Assert.AreEqual(2, new FeilianStormBurst().minPhase);
            Assert.IsFalse(new FeilianStormBurst().stunnable, "风雷爆霸体");
            Assert.AreEqual(1, new HuasheRoar().minPhase);
            Assert.AreEqual(2, new HuasheTailSweep().minPhase);
        }

        /// <summary>片段里的出手事件（events.json，归一化）：招式 → (事件名, 招式时间里的秒数)</summary>
        static readonly (string asset, string state, string evt, float at)[] Releases =
        {
            ("SK_Boss_Kui", "hop", "land", 0.85f), ("SK_Boss_Kui", "leap", "land", 1.8f), ("SK_Boss_Kui", "leap", "glint", 0.5f),
            ("SK_Boss_Kui", "turnLeap", "land", 0.8f), ("SK_Boss_Kui", "leapChain", "land", 1.4f), ("SK_Boss_Kui", "clap", "hit", 0.6f),
            ("SK_Boss_Kui", "drum", "beat", 0.8f), ("SK_Boss_Kui", "drum5", "beat", 0.8f), ("SK_Boss_Kui", "knuckle", "step", 1.3f),
            ("SK_Boss_Feilian", "gust", "hit", 1f), ("SK_Boss_Feilian", "charge", "hit", 0.8f), ("SK_Boss_Feilian", "wheel", "hit", 0.8f),
            ("SK_Boss_Feilian", "blades", "release", 0.6f), ("SK_Boss_Feilian", "tornado", "release", 1f), ("SK_Boss_Feilian", "stormburst", "hit", 4f),
            ("SK_Boss_Huashe", "spit", "release", 0.6f), ("SK_Boss_Huashe", "lunge", "hit", 0.7f), ("SK_Boss_Huashe", "wingslap", "hit", 0.8f),
            ("SK_Boss_Huashe", "dive", "hit", 1.5f), ("SK_Boss_Huashe", "tailsweep", "hit", 0.7f),
        };

        [Test]
        public void EventsJson_ReleaseEventsOnTheReleaseFrame()
        {
            var cache = new Dictionary<string, string>();
            foreach (var (asset, state, evt, at) in Releases)
            {
                string path = Path.Combine(Application.dataPath, "Art/Characters", asset, "Anim", asset + ".events.json");
                Assert.That(File.Exists(path), $"{asset}.events.json");
                if (!cache.TryGetValue(path, out var text)) cache[path] = text = File.ReadAllText(path);
                var block = Regex.Match(text, "\"" + state + "\"\\s*:\\s*(\\[[^\\]]*\\]|\\{[^\\}]*\\[[^\\]]*\\][^\\}]*\\})");
                Assert.That(block.Success, $"{asset}：events.json 里没有 {state}");
                float total = Table[AssetToBoss(asset)][state].w + Table[AssetToBoss(asset)][state].a + Table[AssetToBoss(asset)][state].r;
                var hits = Regex.Matches(block.Value, "\"at\"\\s*:\\s*([0-9.]+)\\s*,\\s*\"name\"\\s*:\\s*\"" + evt + "\"").Cast<Match>()
                    .Select(m => float.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture) * total).ToList();
                Assert.IsNotEmpty(hits, $"{asset}.{state} 没有事件 {evt}");
                float best = hits.Min(h => Mathf.Abs(h - at));
                Assert.LessOrEqual(best, 1f / 30f + 1e-3f, $"{asset}.{state} 的 {evt} 离释放帧 {best * 30f:F1} 帧（> 1 帧）");
            }
        }

        static string AssetToBoss(string asset) => asset switch
        {
            "SK_Boss_Kui" => KuiDef.Id,
            "SK_Boss_Feilian" => FeilianDef.Id,
            _ => HuasheDef.Id,
        };

        // ───────────── 登场镜头表（docs/art/ch4-boss-intros.json）─────────────

        [Test]
        public void Intros_MatchCh4IntroTables()
        {
            var table = new (string id, float dur, float[] starts, float card)[]
            {
                (KuiDef.Id, 8.0f, new[] { 0f, 2.3f, 4.9f, 6.6f }, 5.0f),
                (FeilianDef.Id, 7.8f, new[] { 0f, 2.2f, 4.4f, 6.4f }, 4.6f),
                (HuasheDef.Id, 7.8f, new[] { 0f, 2.0f, 4.2f, 6.4f }, 4.4f),
            };
            foreach (var (id, dur, starts, card) in table)
            {
                var s = BossIntroScript.For(id);
                Assert.IsNotNull(s);
                Assert.AreEqual(id, s.Id, $"{id} 用的是专属演出");
                Assert.IsEmpty(s.Validate(), string.Join("；", s.Validate()));
                Assert.AreEqual(dur, s.Seconds, 0.011f, $"{id} 整段");
                CollectionAssert.AreEqual(new[] { "establish", "reveal", "closeup", "land" }, s.shots.Select(x => x.name).ToArray(), $"{id} 镜头");
                for (int i = 0; i < starts.Length; i++) Assert.AreEqual(starts[i], s.ShotStart(i), 0.011f, $"{id} 第 {i + 1} 镜起点");
                // land：过肩机位（看着首领身体）+ 落回，合计 1.4 s
                Assert.AreEqual(1.4f, s.shots[3].seconds + s.landSeconds, 0.011f, $"{id} land 段 1.4 s");
                Assert.AreEqual(IntroAnchors.Eye, s.shots[3].from.anchor, "过肩机位挂在玩家眼睛上");
                Assert.Greater(s.shots[0].blendIn, 0f, "第一镜从玩家眼睛平滑过渡");
                var nc = s.cues.Single(c => c.kind == IntroCue.KindNameCard);
                Assert.AreEqual(card, nc.at, 0.011f, $"{id} 名字卡");
                var def = Bosses.Get(id);
                Assert.LessOrEqual(s.spawnAt + def.intro.seconds, s.Seconds, $"{id}：首领的登场动作在交还前播完");
                Assert.That(s.epithet, Does.StartWith("4-1"));
            }
        }

        [Test]
        public void DeathSpecs_ShowPlusLandIsSixSeconds()
        {
            foreach (var d in Defs())
            {
                Assert.AreEqual(6f, d.death.seconds, 1e-4f, $"{d.id} 死亡演出 6 s");
                Assert.AreEqual(1.2f, d.death.landSeconds, 1e-4f, $"{d.id} 落回 1.2 s");
                Assert.AreEqual(4.8f, d.death.ShowSeconds, 1e-4f);
                Assert.AreEqual(3f, d.death.cardAt, 1e-4f);
                Assert.That(d.death.cardTitle, Does.StartWith(d.name));
                Assert.That(d.death.slowScale, Is.InRange(0.29f, 0.31f));
                Assert.AreEqual(1f, d.defeat.slowMo, "通用溃散不另放慢动作（死亡演出放）");
            }
        }

        // ───────────── 场地 ─────────────

        [Test]
        public void HuasheLake_SwimLineStaysInTheLake()
        {
            var go = new GameObject("Lake Arena (test)");
            try
            {
                var arena = go.AddComponent<BossArena>();
                arena.radius = 52f;
                var lake = new HuasheLake(arena, Vector3.zero);
                Assert.IsFalse(lake.Real, "没有摆湖：虚拟湖");
                for (float a = -3f; a < 3.2f; a += 0.4f)
                {
                    var p = lake.SwimPoint(a, -0.3f, out _);
                    Assert.IsTrue(lake.InLake(p), $"游线 {a:F1} 在湖里");
                    Assert.AreEqual(0f, Mathf.DeltaAngle(lake.AngleOf(p) * Mathf.Rad2Deg, a * Mathf.Rad2Deg), 0.5f, "AngleOf 是 SwimPoint 的反函数");
                    Assert.AreEqual(lake.Level - 0.3f, p.y, 1e-4f);
                }
                lake.Flood = 1.2f;
                lake.Surge = 0.8f;
                Assert.AreEqual(lake.BaseLevel + 2f, lake.Level, 1e-4f, "水位 = 基础 + 常驻 + 吼叫");
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void BossEncounter_StrongholdOffByDefault()
        {
            var go = new GameObject("Encounter (test)");
            try
            {
                go.SetActive(false);
                var enc = go.AddComponent<BossEncounter>();
                Assert.IsFalse(enc.stronghold, "前三章的首领关不是据点模式");
                Assert.IsNull(enc.altar);
                Assert.Greater(BossEncounter.StrongholdSettleDelay, new KuiDef().death.seconds, "据点结算等死亡演出放完");
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }
    }
}
