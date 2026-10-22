using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 鲲鹏（BS3；port tests/frost-boss.test.mjs 里与场景无关的部分）：定义自检（两个形态、50% 换形、4.6 s 演出 1.55 s 换模型、血条刻度、八招的形态归属与 Three.js 时长）、
    /// 定档与击杀用时（模拟秒伤，docs/unity-parity.md 7.4：60–120 s，±15% 秒伤也在里面）、平切口上限（Three.js kunCutCeiling）、冰窟几何（方位 / 圆周点 / 夹到环台 / 虚拟冰窟）、
    /// 俯冲掠台的路线（两端都在环台上、沿切线、过玩家方位），以及 EnemyBody.Rebind（换形后受伤体的 Animator 换到新模型上）。
    /// </summary>
    public sealed class KunPengTests
    {
        static KunPengDef Def => new();

        // ───────────── 定义 ─────────────

        [Test]
        public void Def_Validates_TwoForms_SwapAtHalf()
        {
            var d = Def;
            Assert.IsEmpty(d.Validate(), string.Join("；", d.Validate()));
            Assert.AreEqual(KunPengDef.Id, d.id);
            Assert.AreEqual(typeof(KunPengBrain), d.brain);
            Assert.AreEqual(2, d.forms.Count);
            Assert.AreEqual(KunPengDef.KunForm, d.FirstForm.id);
            Assert.IsFalse(d.FirstForm.flying, "鲲不是飞行形态（钉在冰窟里）");
            var peng = d.Form(KunPengDef.PengForm);
            Assert.IsNotNull(peng);
            Assert.IsTrue(peng.flying, "鹏是飞行形态");
            Assert.AreEqual(0.6f, peng.shieldRestore, 1e-4f, "化鹏后护盾重凝六成");
            Assert.AreEqual(PengGust.MoveId, peng.firstMove, "鹏的第一招是扇翼狂风");
            Assert.AreEqual("pearl", d.FirstForm.weakBone);
            Assert.AreEqual("pearl", peng.weakBone);
            Assert.AreEqual(1, d.phases.Count);
            var ph = d.phases[0];
            Assert.AreEqual(0.5f, ph.at, 1e-4f);
            Assert.AreEqual(KunPengDef.PengForm, ph.form);
            Assert.AreEqual(4.6f, ph.seconds, 1e-4f);
            Assert.AreEqual(1.55f, ph.SwapAt, 1e-4f, "冰雾最浓的一刻换模型");
            Assert.IsInstanceOf<KunPengDef>(Bosses.Get(KunPengDef.Id), "登记表里有鲲鹏");
        }

        [Test]
        public void BarTicks_AreFuryFormAndRage()
        {
            var ticks = Def.BarTicks;
            CollectionAssert.AreEqual(new[] { 0.75f, 0.5f, 0.25f }, ticks.ToArray(), "血条刻度：75% 鲲怒、50% 化鹏、25% 鹏狂怒（D23）");
        }

        [Test]
        public void Moves_BelongToTheirForm_AndKeepThreeJsDurations()
        {
            var moves = Def.moves.Select(m => m()).ToDictionary(m => m.Id);
            CollectionAssert.AreEquivalent(new[] { "inhale", "slam", "dive", "spit", "gust", "swoop", "rain", "perch" }, moves.Keys);
            foreach (var id in new[] { "inhale", "slam", "dive", "spit" }) CollectionAssert.AreEqual(new[] { KunPengDef.KunForm }, moves[id].forms, id);
            foreach (var id in new[] { "gust", "swoop", "rain", "perch" }) CollectionAssert.AreEqual(new[] { KunPengDef.PengForm }, moves[id].forms, id);
            float Total(string id) => moves[id].windup + moves[id].active + moves[id].recover;
            // Three.js tick 的结束时刻
            Assert.AreEqual(4.6f, Total("inhale"), 1e-3f);
            Assert.AreEqual(2.5f, Total("slam"), 1e-3f);
            Assert.AreEqual(3.0f, Total("dive"), 1e-3f);
            Assert.AreEqual(1.3f, Total("spit"), 1e-3f);
            Assert.AreEqual(5.8f, Total("gust"), 1e-3f);
            Assert.AreEqual(0.9f + 10 * 0.11f + 0.6f, Total("rain"), 1e-3f);
            // 冷却 / 喘息 / 首次可用延迟
            Assert.AreEqual(11f, moves["inhale"].cooldown);
            Assert.AreEqual(6f, moves["dive"].firstDelay);
            Assert.AreEqual(14f, moves["perch"].cooldown);
            Assert.AreEqual(10f, moves["perch"].firstDelay);
        }

        // ───────────── 定档 / 击杀用时 ─────────────

        [Test]
        public void Vitals_TierAtStageDifficulty()
        {
            var v = Def.VitalsAt(KunPengDef.StageDifficulty);
            Assert.AreEqual(KunPengDef.TierHp, v.hp, 0.5f);
            Assert.AreEqual(KunPengDef.TierShield, v.shield, 0.5f);
            var v1 = Def.VitalsAt(1f);
            Assert.AreEqual(KunPengDef.TierHp / KunPengDef.StageDifficulty, v1.hp, 1f, "难度 1 = 定档按难度等比折回");
        }

        [Test]
        public void KillTime_AtReferenceDps_IsWithin60To120s()
        {
            var d = Def;
            float dps = KunPengBalance.ReferenceDps;
            Assert.AreEqual(143.6f, dps, 0.5f, "章末参考秒伤 = 75 × 1.6 × 1.36 × 0.8 × 1.1");
            float t = KunPengBalance.KillSeconds(d, KunPengDef.StageDifficulty, dps);
            Assert.That(t, Is.InRange(60f, 120f), $"参考秒伤 {dps:F0} 下击杀用时 {t:F0} s");
            foreach (float k in new[] { 0.85f, 1.15f })
            {
                float tk = KunPengBalance.KillSeconds(d, KunPengDef.StageDifficulty, dps * k);
                Assert.That(tk, Is.InRange(60f, 120f), $"秒伤 × {k} 下击杀用时 {tk:F0} s");
            }
            // 有效耐久含化鹏时重凝的六成护盾；不可选中含登场、转换、潜袭
            Assert.AreEqual(8000f + 2400f + 2400f * 0.6f, KunPengBalance.EffectiveHp(d, KunPengDef.StageDifficulty), 1f);
            Assert.AreEqual(3f + 4.6f + 3 * 1.5f, KunPengBalance.UntargetableSeconds(d), 1e-3f);
            // Three.js 原值 × 难度在参考秒伤下贴着上限（定档的理由）
            float ts = (4000f + 1200f * 1.6f) * KunPengDef.StageDifficulty / dps + KunPengBalance.UntargetableSeconds(d);
            Assert.Greater(ts, t, "定档比 Three.js 原值 × 难度短");
        }

        // ───────────── 平切口 ─────────────

        [Test]
        public void CutCeiling_MatchesThreeJsFormula()
        {
            Assert.AreEqual(-0.3f, KunPengMath.CutCeiling(0, 0), 1e-5f, "不俯仰：切口在水面下 0.3 m");
            // 前倾 0.42 rad（猛砸）：后缘翘起 1.3 × 3 × sin(0.42)
            Assert.AreEqual(-0.3f - 1.3f * 3f * Mathf.Sin(0.42f), KunPengMath.CutCeiling(0.42f, 0), 1e-4f);
            // 后仰：前缘翘起 1.3 × 2.8 × sin
            Assert.AreEqual(-0.3f - 1.3f * 2.8f * Mathf.Sin(0.25f), KunPengMath.CutCeiling(-0.25f, 0), 1e-4f);
            // 侧倾：一侧翘起
            Assert.AreEqual(-0.3f - 1.3f * 2.8f * Mathf.Sin(0.03f), KunPengMath.CutCeiling(0, -0.03f), 1e-4f);
            Assert.Less(KunPengMath.CutCeiling(0.42f, 0), KunPengMath.CutCeiling(0.2f, 0), "越前倾越要往下沉");
            // 按上限放模型原点时，切口一圈的最高点正好在水面下 0.3 m
            foreach (float pitch in new[] { -0.25f, 0f, 0.35f, 0.42f })
            {
                float y = KunPengMath.CutCeiling(pitch, 0);
                var rot = Quaternion.Euler(pitch * Mathf.Rad2Deg, 0, 0);
                float top = KunPengMath.CutRim.Max(q => (rot * new Vector3(q.x, 0, q.y) * KunPengDef.KunScale).y) + y;
                Assert.LessOrEqual(top, -0.3f + 1e-3f, $"俯仰 {pitch}：切口最高点 {top:F3}");
            }
        }

        // ───────────── 冰窟几何 ─────────────

        [Test]
        public void IceHole_PointAngleRoundTrip_ClampToRing_Fallback()
        {
            var h = new IceHoleInfo(new Vector3(10, 2, -5), 15f, 44f, 2.06f, true);
            foreach (float yaw in new[] { 0f, 37f, 90f, -120f, 179f })
            {
                var p = h.Point(yaw, 20f);
                Assert.AreEqual(2f, p.y, 1e-5f, "圆周点在环台地面");
                Assert.AreEqual(20f, h.Distance(p), 1e-3f);
                Assert.AreEqual(0f, Mathf.DeltaAngle(yaw, h.Angle(p)), 1e-3f, $"方位 {yaw}");
            }
            Assert.AreEqual(29.5f, h.MidRing, 1e-4f);
            // 冰窟里的点夹到冰沿外 1 m，外缘外的夹到外缘内 1.5 m，方向不变
            var inner = h.ClampToRing(h.Point(60f, 3f));
            Assert.AreEqual(16f, h.Distance(inner), 1e-3f);
            Assert.AreEqual(60f, h.Angle(inner), 1e-2f);
            Assert.AreEqual(42.5f, h.Distance(h.ClampToRing(h.Point(200f, 80f))), 1e-3f);
            Assert.AreEqual(25f, h.Distance(h.ClampToRing(h.Point(10f, 25f))), 1e-3f, "环台上的点不动");
            Assert.IsTrue(h.OverHole(h.Point(0, 14.9f)));
            Assert.IsFalse(h.OverHole(h.Point(0, 15.1f)));
            // 没有场地 / 标记：虚拟冰窟（半径 6、没找到）
            var fb = IceHoleInfo.Fallback(null, new Vector3(1, 0, 1));
            Assert.IsFalse(fb.found);
            Assert.AreEqual(IceHoleInfo.FallbackRadius, fb.radius, 1e-5f);
            Assert.Greater(fb.outer, fb.radius + 2f);
            Assert.AreEqual(IceHole.DefaultWaterLevel, fb.waterY - fb.FloorY, 1e-5f);
        }

        [Test]
        public void SwoopLine_StaysOnTheRing_AlongTheTangent_ThroughThePlayersBearing()
        {
            var h = new IceHoleInfo(Vector3.zero, 15f, 44f, 0.06f, true);
            foreach (float yaw in new[] { 0f, 75f, 190f, 300f })
            foreach (float r in new[] { 10f, 18f, 30f, 43f })
            foreach (int side in new[] { -1, 1 })
            {
                var player = h.Point(yaw, r);
                var (from, lineYaw, len) = KunPengMath.SwoopLine(h, player, side);
                var to = from + KunPengMath.Dir(lineYaw) * len;
                Assert.LessOrEqual(len, 32f + 1e-3f);
                Assert.LessOrEqual(h.Distance(from), h.outer - 3f + 0.05f, "起点在外缘内 3 m");
                Assert.LessOrEqual(h.Distance(to), h.outer - 3f + 0.05f, "终点在外缘内 3 m");
                // 线的中点在玩家方位上、离圆心 rp（夹在 冰窟 + 3 … 外缘 − 4）
                var mid = (from + to) * 0.5f;
                Assert.AreEqual(0f, Mathf.DeltaAngle(yaw, h.Angle(mid)), 0.05f);
                Assert.AreEqual(Mathf.Clamp(r, h.radius + 3f, h.outer - 4f), h.Distance(mid), 1e-2f);
                // 沿切线：线的方向与径向垂直；整条线都在冰窟外
                Assert.AreEqual(90f, Mathf.Abs(Mathf.DeltaAngle(h.Angle(mid), lineYaw)), 1e-2f);
                for (int i = 0; i <= 10; i++) Assert.Greater(h.Distance(Vector3.Lerp(from, to, i / 10f)), h.radius + 2.9f);
            }
        }

        // ───────────── EnemyBody.Rebind ─────────────

        [Test]
        public void EnemyBodyRebind_SwitchesAnimatorToTheNewModel()
        {
            var root = new GameObject("boss");
            try
            {
                var a = new GameObject("model A");
                a.transform.SetParent(root.transform, false);
                var animA = a.AddComponent<Animator>();
                var b = new GameObject("model B");
                b.transform.SetParent(root.transform, false);
                var animB = b.AddComponent<Animator>();
                b.SetActive(false);
                var body = root.AddComponent<EnemyBody>();
                body.Rebind(a);
                Assert.AreSame(animA, body.Animator);
                a.SetActive(false);
                b.SetActive(true);
                body.Rebind(b);
                Assert.AreSame(animB, body.Animator, "换形后受伤体的 Animator 是新模型的");
                body.Rebind(null);
                Assert.IsNotNull(body.Animator, "没给模型时在整个首领下找（不清空）");
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }
    }
}
