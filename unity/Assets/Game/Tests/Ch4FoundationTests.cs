using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 第四章地基（docs/unity-ch4-port.md 第 2 节契约，F 路）：
    ///   带电（就反应而言等同雷殛：火 → 焚雷、蚀 → 封脉；时长取较大；常驻持有可叠；传电跳数上限）、
    ///   导体与落雷（引雷挑半径内顶最高的导体、要比落点高、排除；充电 / 放电；预警两层的配色）、
    ///   破防条（弱点 / 反应才填、满了破防、下一次 +25%、破防中 / 锁着不填、计时与事件）、
    ///   领主梯度（按这张图已打败的领主数：血 ×(1 + 0.15 n)、收招 ×(1 − 0.1 n)、n = 2 加变体；记账只算一次）、
    ///   受击四层（韧性伤害倍率、2 秒窗口、前三章默认值不挂韧性）、风场（基础风、吸引 / 推开、覆盖）、RunPlan 章节主题。
    /// 不进 Play：EditMode 下 Awake 不跑、FxRuntime 不建，落雷 / 雷暴的时序由试玩套件看。
    /// </summary>
    public sealed class Ch4FoundationTests
    {
        readonly List<GameObject> made = new();

        Damageable Body(string name, float hp = 100)
        {
            var go = new GameObject(name) { hideFlags = HideFlags.HideAndDontSave };
            made.Add(go);
            var d = go.AddComponent<Damageable>();
            d.maxHealth = hp;
            d.ResetVitals();
            return d;
        }

        Conductor Pole(string name, Vector3 at, float height, float radius = 5f)
        {
            var go = new GameObject(name) { hideFlags = HideFlags.HideAndDontSave };
            made.Add(go);
            go.transform.position = at;
            var c = go.AddComponent<Conductor>();
            c.height = height;
            c.attractRadius = radius;
            return c;
        }

        RunState savedRun;

        [SetUp]
        public void SetUp() => savedRun = RunState.Current;

        [TearDown]
        public void TearDown()
        {
            foreach (var go in made)
                if (go)
                    Object.DestroyImmediate(go);
            made.Clear();
            RunState.Current = savedRun;
            WindField.Reset();
        }

        // ───────────── 带电 ─────────────

        [Test]
        public void Charge_ApplyHoldAndClear()
        {
            var d = Body("charged");
            Assert.IsFalse(Charge.IsCharged(d));
            Assert.IsTrue(Charge.Apply(d, 6f));
            Assert.IsTrue(Charge.IsCharged(d));
            Assert.AreEqual(6f, Charge.Remaining(d), 1e-4f);
            Charge.Apply(d, 2f);
            Assert.AreEqual(6f, Charge.Remaining(d), 1e-4f, "续时长取较大，不累加");
            Charge.Apply(d, 9f);
            Assert.AreEqual(9f, Charge.Remaining(d), 1e-4f);
            Assert.IsNotNull(d.GetComponent<EnemyStatus>(), "带电时补一个状态宿主：反应判定要它");

            Charge.Clear(d);
            Assert.IsFalse(Charge.IsCharged(d));
            var a = Charge.Hold(d);
            var b = Charge.Hold(d);
            Assert.IsTrue(Charge.IsCharged(d));
            Assert.IsTrue(float.IsPositiveInfinity(Charge.Remaining(d)), "常驻 = +∞");
            a.Dispose();
            Assert.IsTrue(Charge.IsCharged(d), "还有一份持有");
            b.Dispose();
            b.Dispose();
            Assert.IsFalse(Charge.IsCharged(d));
            Charge.Clear(d);

            Assert.IsFalse(Charge.Apply(d, 0f));
            Assert.IsFalse(Charge.Apply(d, float.NaN));
            Assert.IsFalse(Charge.Apply(null, 5f));
            d.untargetable = true;
            Assert.IsFalse(Charge.Apply(d, 5f), "不可选中的不带电");
            d.untargetable = false;
            d.Kill(default);
            Assert.IsFalse(Charge.IsCharged(d), "死了就不算带电");
            Assert.AreEqual(0, Charge.Arc(null));
            Assert.AreEqual(0, Charge.Arc(d, 8f, 0), "跳数上限 0：一跳都不传");
        }

        [Test]
        public void Charge_CountsAsShockForReactions()
        {
            var d = Body("charged foe", 500);
            var env = GameReactionEnv.Instance;
            Charge.Apply(d, 6f);
            Assert.IsTrue(env.Has(d, StatusId.Shock), "带电 = 身上有雷殛");
            Assert.IsFalse(env.Has(d, StatusId.Burn));

            var fire = new ReactionScheduler(env);
            var j = fire.TryReact(d, Element.Fire, 40, 0, false, 0, 1, 100f, 1);
            Assert.IsNotNull(j, "燎的火一碰带电的就是焚雷");
            Assert.AreEqual(Reaction.Thunderfire, j.Reaction);

            var d2 = Body("charged foe 2", 500);
            Charge.Apply(d2, 6f);
            var corrode = new ReactionScheduler(env);
            var k = corrode.TryReact(d2, Element.Corrode, 40, 0, false, 0, 1, 100f, 1);
            Assert.IsNotNull(k);
            Assert.AreEqual(Reaction.Veinseal, k.Reaction, "带电 + 蚀化 = 封脉");

            var plain = Body("plain foe", 500);
            plain.gameObject.AddComponent<EnemyStatus>();
            Assert.IsNull(new ReactionScheduler(env).TryReact(plain, Element.Fire, 40, 0, false, 0, 1, 100f, 1), "不带电的单挂火不反应");
        }

        // ───────────── 导体与落雷 ─────────────

        [Test]
        public void Conductor_PicksHighestWithinRadius()
        {
            var low = Pole("low", new Vector3(2, 0, 0), 4f);
            var high = Pole("high", new Vector3(-3, 0, 1), 10f);
            var far = Pole("far", new Vector3(30, 0, 0), 30f);
            var all = new[] { low, high, far };
            var p = Vector3.zero;
            Assert.AreSame(high, Conductor.Best(p, all), "半径内挑顶最高的");
            Assert.AreSame(low, Conductor.Best(p, all, high), "排除一个之后挑下一个");
            Assert.IsNull(Conductor.Best(new Vector3(0, 20, 0), all), "落点比导体顶还高（山顶上）：不引");
            Assert.IsNull(Conductor.Best(new Vector3(100, 0, 100), all), "附近没有导体");
            high.gameObject.SetActive(false);
            Assert.AreSame(low, Conductor.Best(p, all), "停用的导体不引雷");
            Assert.AreEqual(new Vector3(-3, 10, 1), high.Top);
        }

        [Test]
        public void Conductor_ChargesOnStrike_AndDischarges()
        {
            var flag = Pole("flag pole", Vector3.zero, 6f);
            var tower = Pole("tower", Vector3.right * 20, 12f);
            tower.canCharge = false;
            var pillar = Pole("pillar", Vector3.left * 20, 8f);
            pillar.chargePerStrike = 0.34f;
            pillar.drainPerSecond = 0;
            int struck = 0;
            StrikeInfo got = default;
            flag.Struck += (c, s) =>
            {
                struck++;
                got = s;
            };
            var info = new StrikeInfo { point = Vector3.zero, conductor = flag, radius = 2, damage = 12 };
            flag.OnStruck(info);
            Assert.AreEqual(1, struck);
            Assert.AreSame(flag, got.conductor);
            Assert.AreEqual(1f, flag.charge, 1e-4f, "经幡杆劈一次充满");
            Assert.IsTrue(flag.Charged);
            float discharged = -1;
            flag.Discharged += (c, k) => discharged = k;
            Assert.AreEqual(1f, flag.Discharge(), 1e-4f);
            Assert.AreEqual(1f, discharged, 1e-4f);
            Assert.IsFalse(flag.Charged);
            Assert.AreEqual(0f, flag.Discharge(), "没电放不出");

            tower.OnStruck(info);
            Assert.IsFalse(tower.Charged, "碉楼只引雷、不带电");
            Assert.AreEqual(1, tower.Strikes);

            pillar.OnStruck(info);
            pillar.OnStruck(info);
            Assert.AreEqual(0.68f, pillar.charge, 1e-4f, "导雷石柱一劈攒一份");
            pillar.OnStruck(info);
            Assert.AreEqual(1f, pillar.charge, 1e-4f, "夹到 1");
            pillar.AddCharge(-5f);
            Assert.AreEqual(0f, pillar.charge);
        }

        [Test]
        public void Strike_WarningIsDangerFillPlusThunderMark()
        {
            var fill = new TelegraphSpec { style = TelegraphStyle.Warning, tone = TelegraphTone.Danger };
            var mark = new TelegraphSpec { style = TelegraphStyle.Warning, tone = TelegraphTone.Thunder };
            Assert.IsTrue(fill.Danger, "会挨打的范围是危险填充（正红）");
            Assert.IsFalse(mark.Danger, "紫红雷标只是身份层，不算危险（不进脚底提示）");
            Assert.AreEqual(TelegraphPalette.Thunder, TelegraphPalette.DangerFor(TelegraphTone.Thunder));
            Color.RGBToHSV(TelegraphPalette.Thunder, out float th, out _, out _);
            Color.RGBToHSV(TelegraphPalette.Crimson, out float ch, out _, out _);
            float gap = Mathf.Abs(th - ch);
            gap = Mathf.Min(gap, 1 - gap) * 360f;
            Assert.Greater(gap, 30f, "紫红雷标和正红的色相要拉开");
            Assert.AreEqual(3.2f, LightningStrike.DefaultRadius, 1e-4f);
            Assert.AreEqual(1.2f, LightningStrike.DefaultWarn, 1e-4f);
            Assert.IsFalse(LightningStrike.Strike(Vector3.zero, 1f, 3f, 10f, null).Alive, "EditMode 没有 Fx 根：不劈、不报错");
        }

        // ───────────── 破防条 ─────────────

        [Test]
        public void BreakBar_FillsFromWeakAndReactions_GrowsEachBreak()
        {
            var bar = new BreakBar(new BreakBarDef { max = 900, seconds = 4, takenMult = 1.3f, label = "破鼓" });
            int broke = 0, recovered = 0;
            bar.Broke += (b, n) => broke = n;
            bar.Recovered += b => recovered++;

            var body = DamageInfo.Simple(100, DamageSource.Weapon, Vector3.zero, Vector3.forward);
            var weak = body;
            weak.weakpoint = true;
            var rx = DamageInfo.Simple(100, DamageSource.Status, Vector3.zero, Vector3.forward);
            rx.tags = DamageTag.Reaction;
            Assert.AreEqual(0f, bar.FillFrom(body, 100), "打身体不填");
            Assert.AreEqual(100f, bar.FillFrom(weak, 100), "弱点 × 1");
            Assert.AreEqual(150f, bar.FillFrom(rx, 100), "反应 × 1.5");

            Assert.AreEqual(900f, bar.Threshold);
            Assert.IsFalse(bar.Add(899));
            Assert.AreEqual(899f / 900f, bar.Fill, 1e-4f);
            Assert.IsTrue(bar.Add(1), "填满就破");
            Assert.IsTrue(bar.Broken);
            Assert.AreEqual(1, broke);
            Assert.AreEqual(1f, bar.Fill, "破防中满格");
            Assert.IsFalse(bar.Add(5000), "破防中不填");
            bar.Tick(3.9f);
            Assert.IsTrue(bar.Broken);
            bar.Tick(0.2f);
            Assert.IsFalse(bar.Broken);
            Assert.AreEqual(1, recovered);
            Assert.AreEqual(0f, bar.Value, "破完清空");
            Assert.AreEqual(1125f, bar.Threshold, 1e-3f, "下一次多要 25%");

            bar.Locked = true;
            Assert.IsFalse(bar.Add(5000), "登场 / 转阶段时不填");
            bar.Locked = false;
            Assert.IsTrue(bar.Add(1125));
            Assert.AreEqual(2, broke);
            bar.Cancel();
            Assert.IsFalse(bar.Broken);
            Assert.AreEqual(1, recovered, "Cancel 不发 Recovered");
            bar.Reset();
            Assert.AreEqual(0, bar.Breaks);
            Assert.AreEqual(900f, bar.Threshold);
            Assert.IsFalse(bar.Add(float.NaN));
        }

        [Test]
        public void BossDef_Ch4FieldsDefaultToOldBehaviour()
        {
            var d = new BossDef();
            Assert.IsNull(d.breakBar, "前三章的首领没有破防条");
            Assert.IsTrue(string.IsNullOrEmpty(d.lordLevel), "不按领主梯度");
            Assert.IsTrue(d.phaseCinematic);
            var t = LordScaling.For(d);
            Assert.AreEqual(1f, t.HpMult);
            Assert.AreEqual(1f, t.RecoveryMult);
            foreach (var def in Registry<BossDef>.All)
                if (def != null && def.breakBar == null)
                    Assert.IsTrue(string.IsNullOrEmpty(def.lordLevel) || def.lordLevel.StartsWith("4-"), def.id);
        }

        // ───────────── 领主梯度 ─────────────

        [Test]
        public void LordScaling_ByDefeatsInThisMap()
        {
            RunState.Current = new RunState();
            Assert.AreEqual(0, LordScaling.For("4-1").index);
            var t0 = LordScaling.For("4-1");
            Assert.AreEqual(1f, t0.HpMult, 1e-5f);
            Assert.AreEqual(1f, t0.RecoveryMult, 1e-5f);
            Assert.IsFalse(t0.ExtraVariant);

            LordScaling.RecordDefeat("4-1", "boss_huashe");
            LordScaling.RecordDefeat("4-1", "boss_huashe");
            var t1 = LordScaling.For("4-1");
            Assert.AreEqual(1, t1.index, "同一个领主只算一次");
            Assert.AreEqual(1.15f, t1.HpMult, 1e-5f);
            Assert.AreEqual(0.9f, t1.RecoveryMult, 1e-5f);
            Assert.IsFalse(t1.ExtraVariant);
            Assert.IsTrue(LordScaling.IsDefeated("4-1", "boss_huashe"));

            LordScaling.RecordDefeat("4-1", "boss_feilian");
            var t2 = LordScaling.For("4-1");
            Assert.AreEqual(2, t2.index);
            Assert.AreEqual(1.3f, t2.HpMult, 1e-5f);
            Assert.AreEqual(0.8f, t2.RecoveryMult, 1e-5f);
            Assert.IsTrue(t2.ExtraVariant, "第三个打的：每阶段多一招变体");

            Assert.AreEqual(0, LordScaling.Defeated("4-2"), "别的图不受影响");
            var kui = new BossDef { id = "boss_kui", lordLevel = "4-1" };
            Assert.AreEqual(2, LordScaling.For(kui).index);
            var copy = SceneFlow.CloneRun(RunState.Current);
            Assert.AreEqual(2, copy.flags.Keys.Count(k => k.StartsWith("lord.4-1.")), "记在本局标记里：进关快照带着");

            RunState.Current = null;
            Assert.AreEqual(0, LordScaling.For("4-1").index, "没开局为 0");
            LordScaling.RecordDefeat("4-1", "boss_kui");
        }

        // ───────────── 受击四层 ─────────────

        [Test]
        public void HitLayers_PoiseDamageAndWindow()
        {
            var bullet = DamageInfo.Simple(10, DamageSource.Weapon, Vector3.zero, Vector3.forward);
            var weak = bullet;
            weak.weakpoint = true;
            var blast = DamageInfo.Simple(10, DamageSource.Explosion, Vector3.zero, Vector3.forward);
            var rx = DamageInfo.Simple(10, DamageSource.Status, Vector3.zero, Vector3.forward);
            rx.tags = DamageTag.Reaction;
            var dot = DamageInfo.Simple(10, DamageSource.Status, Vector3.zero, Vector3.forward);
            dot.tags = DamageTag.Dot;
            Assert.AreEqual(10f, HitReaction.PoiseDamage(bullet, 10));
            Assert.AreEqual(20f, HitReaction.PoiseDamage(weak, 10), "弱点 × 2");
            Assert.AreEqual(30f, HitReaction.PoiseDamage(blast, 10), "爆炸 × 3");
            Assert.AreEqual(30f, HitReaction.PoiseDamage(rx, 10), "反应 × 3");
            Assert.AreEqual(0f, HitReaction.PoiseDamage(dot, 10), "持续伤害不算韧性");

            var m = new PoiseMeter(30);
            Assert.IsFalse(m.Add(20));
            Assert.IsTrue(m.Add(10), "累计到韧性就硬直");
            Assert.AreEqual(0f, m.value, "破完清零");
            m.Add(20);
            m.Tick(1f);
            Assert.AreEqual(5f, m.value, 1e-4f, "每秒回落韧性的一半（2 秒窗口）");
            m.Tick(10f);
            Assert.AreEqual(0f, m.value);
            var none = new PoiseMeter(0);
            Assert.IsFalse(none.Add(1e6f), "韧性 0：不用韧性系统");
            var armor = new PoiseMeter(float.PositiveInfinity);
            Assert.IsFalse(armor.Add(1e6f), "+∞：永远不硬直");
        }

        [Test]
        public void HitLayers_OldChaptersUntouched()
        {
            var def = new EnemyDef();
            Assert.AreEqual(0f, def.poise);
            Assert.AreEqual(0f, def.hitch);
            foreach (var d in EnemyRoster.All)
            {
                if (d == null || d.ai == null || d.ai.Namespace != typeof(EnemyAI).Namespace) continue;
                bool ch4 = d.ai.FullName != null && d.ai.FullName.Contains("Plateau");
                if (ch4) continue;
                if (CodexCatalog.Lore.Chapter(CodexCatalog.EnemyId(d.id)) == 4) continue;
                Assert.AreEqual(0f, d.poise, $"{d.id}：前三章的敌人不用韧性（行为不变）");
                Assert.AreEqual(0f, d.hitch, d.id);
            }
            Assert.IsNull(Poise.Attach(new GameObject { hideFlags = HideFlags.HideAndDontSave }, def), "默认定义不挂韧性组件");
        }

        // ───────────── 风场 ─────────────

        [Test]
        public void WindField_BaseAttractorAndOverride()
        {
            WindField.Reset();
            WindField.BaseDir = new Vector2(1, 0);
            WindField.BaseStrength = 0.2f;
            var far = WindField.Sample(new Vector3(0, 0, 0));
            Assert.AreEqual(1f, far.dir.x, 1e-4f);
            Assert.AreEqual(0.2f, far.strength, 1e-4f);

            var a = WindField.AddAttractor(new Vector3(0, 0, 100), 300, 1f, 30);
            var near = WindField.Sample(new Vector3(0, 0, 90));
            Assert.Greater(near.dir.z, 0.95f, "吸引点附近几乎完全朝向它");
            Assert.AreEqual(1f, near.strength, 1e-4f, "核心半径内满强度");
            var mid = WindField.Sample(new Vector3(0, 0, -100));
            Assert.Greater(mid.dir.z, 0f, "远处轻轻偏过去");
            Assert.Less(mid.strength, near.strength);

            a.strength = -1f;
            var push = WindField.Sample(new Vector3(0, 0, 90));
            Assert.Less(push.dir.z, -0.95f, "负强度：往外推");
            a.Dispose();
            Assert.AreEqual(0, WindField.Attractors.Count);
            Assert.AreEqual(1f, WindField.Sample(new Vector3(0, 0, 90)).dir.x, 1e-4f);

            WindField.Override = p => new WindSample(new Vector3(0, 0, -3), 2f);
            var o = WindField.Sample(Vector3.zero);
            Assert.AreEqual(-1f, o.dir.z, 1e-4f, "覆盖（4-2 峡谷风）的方向归一化");
            Assert.AreEqual(1f, o.strength, 1e-4f, "强度夹到 1");

            WindField.Override = null;
            WindField.PlayerSpeedK = 0.25f;
            WindField.BaseStrength = 1f;
            Assert.AreEqual(1.25f, WindField.SpeedMult(Vector3.zero, Vector3.right), 1e-4f, "顺风快 25%");
            Assert.AreEqual(0.75f, WindField.SpeedMult(Vector3.zero, Vector3.left), 1e-4f, "逆风慢 25%");
            WindField.Reset();
            Assert.AreEqual(1f, WindField.SpeedMult(Vector3.zero, Vector3.left));
        }

        // ───────────── 章节主题 ─────────────

        [Test]
        public void Chapter4Theme_SpawnSigilAndTone()
        {
            Assert.AreEqual(SpawnTheme.Thunder, SpawnThemes.OfChapter(4));
            Assert.AreEqual(SpawnTheme.Thunder, SpawnThemes.OfScene("L4_1_Zheduo"));
            Assert.AreEqual(SpawnTheme.Fire, SpawnThemes.OfScene("L3_1_Causeway"), "前三章不变");
            Assert.AreEqual(5, (int)SigilMode.Thunder, "SF_FxSigil 的模式 5");
            Assert.AreEqual(WeatherProfiles.WhiteoutFrost, WeatherProfiles.WhiteoutFor("Plateau"), "雪域的软边界是风雪");
            var dust = FxTone.Ground(new Color(0.82f, 0.66f, 0.45f), 4);
            Assert.Less(Mathf.Abs(dust.r - dust.g), 0.12f, "第四章的尘是灰褐，不是沙黄");
            Assert.AreEqual(new Color(0.82f, 0.66f, 0.45f), FxTone.Ground(new Color(0.82f, 0.66f, 0.45f), 1), "第一章原样");
            Assert.AreEqual("boss_leize", BalanceModel.BossOf(RunPlan.Get("4-4")));
            CollectionAssert.AreEquivalent(new[] { "boss_kui", "boss_feilian", "boss_huashe" }, BalanceModel.LordsOf(RunPlan.Get("4-1")));
            Assert.AreEqual(BalanceModel.LordOf(RunPlan.Get("3-3")), BalanceModel.LordsOf(RunPlan.Get("3-3")).Single());
        }
    }
}
