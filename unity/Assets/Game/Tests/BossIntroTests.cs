using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 首领登场演出的纯逻辑（docs/level-design/boss-intros.md）：缓动端点与单调、姿态混合在 w = 1 时原样等于目标（交接零误差）、
    /// 落回第一人称在各种帧率下最后一帧误差为零且没有跳变、跳过的短落地同样平滑、环绕插值不穿过看点、决斗坐标系、视线转向、
    /// 镜头表的时间查找、四个首领 + 通用演出的脚本自检（6–10 s、名字卡、锚点有定义、首领自己的登场在交还前播完）、锚点在没有场景时也给有限值、
    /// 跳过规则（第一次看满 1.5 s、看过随时）、「看过」存档的读写。
    /// </summary>
    public sealed class BossIntroTests
    {
        static readonly IntroEase[] Eases = { IntroEase.Linear, IntroEase.In, IntroEase.Out, IntroEase.InOut, IntroEase.Smoother };
        static readonly string[] BossIds = { HanbaDef.Id, KunPengDef.Id, WarlordDef.Id, QilinDef.Id };

        // ───────────── 缓动 / 混合 ─────────────

        [Test]
        public void Eases_HitEndpoints_AndAreMonotonic()
        {
            foreach (var e in Eases)
            {
                Assert.AreEqual(0f, IntroMath.Ease(e, 0f), $"{e}(0)");
                Assert.AreEqual(1f, IntroMath.Ease(e, 1f), $"{e}(1)");
                Assert.AreEqual(0f, IntroMath.Ease(e, -0.5f), $"{e} 小于 0 夹到 0");
                Assert.AreEqual(1f, IntroMath.Ease(e, 1.5f), $"{e} 大于 1 夹到 1");
                Assert.AreEqual(0f, IntroMath.Ease(e, float.NaN), $"{e}(NaN) = 0");
                float prev = 0;
                for (int i = 1; i <= 200; i++)
                {
                    float v = IntroMath.Ease(e, i / 200f);
                    Assert.GreaterOrEqual(v, prev - 1e-6f, $"{e} 在 {i / 200f:F3} 处回头了");
                    prev = v;
                }
            }
        }

        [Test]
        public void Smoother_StartsAndEndsAtRest()
        {
            const float h = 1e-3f;
            float v0 = (IntroMath.Ease(IntroEase.Smoother, h) - IntroMath.Ease(IntroEase.Smoother, 0)) / h;
            float v1 = (IntroMath.Ease(IntroEase.Smoother, 1) - IntroMath.Ease(IntroEase.Smoother, 1 - h)) / h;
            Assert.Less(v0, 1e-3f, "落地起步速度为 0");
            Assert.Less(v1, 1e-3f, "落地到达速度为 0（交接那一刻镜头是停稳的）");
            Assert.AreEqual(1f, IntroMath.LandWeight(1.3f, 1.3f), "u = 时长时权重正好是 1");
            Assert.AreEqual(1f, IntroMath.LandWeight(2f, 1.3f));
            Assert.AreEqual(1f, IntroMath.LandWeight(0.1f, 0f), "时长 0 = 直接到位");
            Assert.AreEqual(0f, IntroMath.LandWeight(0f, 1.3f));
        }

        [Test]
        public void Blend_ReturnsTargetExactly_AtFullWeight()
        {
            var rng = new System.Random(7);
            for (int i = 0; i < 50; i++)
            {
                var a = RandomPose(rng);
                var b = RandomPose(rng);
                var full = IntroMath.Blend(a, b, 1f);
                Assert.AreEqual(b.position, full.position, "w = 1 位置原样");
                Assert.AreEqual(b.rotation, full.rotation, "w = 1 朝向原样");
                Assert.AreEqual(b.fov, full.fov, "w = 1 视角原样");
                var over = IntroMath.Blend(a, b, 1.7f);
                Assert.AreEqual(b.position, over.position);
                var none = IntroMath.Blend(a, b, 0f);
                Assert.AreEqual(a.position, none.position, "w = 0 原样是起点");
                Assert.AreEqual(a.rotation, none.rotation);
                var eye = IntroMath.Land(a, b, 1.4f, 1.4f);
                IntroMath.Error(eye, b, out float m, out float deg, out float fov);
                Assert.AreEqual(0f, m, "落地最后一帧位置误差 0");
                Assert.AreEqual(0f, deg, 1e-3f, "落地最后一帧角度误差 0");
                Assert.AreEqual(0f, fov, "落地最后一帧视角误差 0");
            }
        }

        [Test]
        public void Landing_ConvergesToMovingEye_WithoutJumps_AtAnyFrameRate()
        {
            // 从首领面前 30 m、转了 140° 的机位落回一只在慢慢转头的眼睛
            var from = CamPose.Look(new Vector3(3, 4, 30), new Vector3(0, 3, 40), 38f, 4f);
            foreach (var dts in new[] { Fixed(1 / 60f), Fixed(1 / 30f), Fixed(1 / 144f), Jittery() })
            foreach (float seconds in new[] { 1.4f, 0.7f })
            {
                float u = 0, maxStep = 0, maxTurn = 0;
                var last = from;
                CamPose eye = default, pose = default;
                int frame = 0;
                IntroMath.Error(from, EyeAt(0), out float total, out float totalAngle, out _);
                while (true)
                {
                    float dt = dts(frame++);
                    u += dt;
                    eye = EyeAt(u);
                    pose = IntroMath.Land(from, eye, u, seconds);
                    maxStep = Mathf.Max(maxStep, Vector3.Distance(last.position, pose.position));
                    maxTurn = Mathf.Max(maxTurn, Quaternion.Angle(last.rotation, pose.rotation));
                    last = pose;
                    if (u >= seconds) break;
                    Assert.Less(frame, 10000);
                }
                IntroMath.Error(pose, eye, out float m, out float deg, out float fov);
                Assert.AreEqual(0f, m, $"{seconds}s 落地：最后一帧位置误差");
                Assert.AreEqual(0f, deg, 1e-3f, $"{seconds}s 落地：最后一帧角度误差");
                Assert.AreEqual(0f, fov, $"{seconds}s 落地：最后一帧视角误差");
                Assert.Less(maxStep / total, 0.25f, $"{seconds}s 落地：单帧位移 {maxStep:F2} m / 总 {total:F1} m（硬切 = 100%）");
                Assert.Less(maxTurn / totalAngle, 0.25f, $"{seconds}s 落地：单帧转角 {maxTurn:F1}° / 总 {totalAngle:F0}°");
            }
        }

        [Test]
        public void LandArcAndStretch_KeepHandoffExact()
        {
            Assert.AreEqual(0f, IntroMath.LandLift(3f, 0f), "起点不抬（接上一镜）");
            Assert.AreEqual(0f, IntroMath.LandLift(3f, 1f), "终点不抬（交接零误差）");
            Assert.AreEqual(0f, IntroMath.LandLift(3f, 1.2f));
            Assert.AreEqual(3f, IntroMath.LandLift(3f, 0.5f), 1e-5f, "中点抬满");
            Assert.AreEqual(0f, IntroMath.LandLift(float.NaN, 0.5f), "坏输入不抬");
            Assert.AreEqual(0f, IntroMath.LandLiftFor(1f), "太近不抬");
            Assert.AreEqual(4f, IntroMath.LandLiftFor(200f), "最多 4 m");
            Assert.AreEqual(1f, IntroMath.LandStretch(10f), "近的照脚本时长");
            Assert.AreEqual(1.45f, IntroMath.LandStretch(500f), 1e-5f, "最多 1.45 倍");
            Assert.AreEqual(1f, IntroMath.LandStretch(float.NaN));
            float prev = 0;
            for (float m = 0; m < 120; m += 2.5f)
            {
                float s = IntroMath.LandStretch(m);
                Assert.GreaterOrEqual(s, prev, "越远越长（不回头）");
                prev = s;
            }
            // 带抬升的落地：最后一帧仍然原样等于眼睛
            var from = CamPose.Look(new Vector3(4, 3, 50), new Vector3(0, 3, 60), 36f);
            var eye = EyeAt(0);
            float seconds = 1.3f * IntroMath.LandStretch(50f), lift = IntroMath.LandLiftFor(50f);
            var end = IntroMath.Land(from, eye, seconds, seconds);
            end.position += Vector3.up * IntroMath.LandLift(lift, IntroMath.LandWeight(seconds, seconds));
            IntroMath.Error(end, eye, out float m0, out float d0, out float f0);
            Assert.AreEqual(0f, m0, "抬升 + 拉长后最后一帧位置误差 0");
            Assert.AreEqual(0f, d0, 1e-3f);
            Assert.AreEqual(0f, f0);
        }

        static System.Func<int, float> Fixed(float dt) => _ => dt;

        static System.Func<int, float> Jittery()
        {
            var r = new System.Random(3);
            return i => i % 17 == 5 ? 0.09f : (float)(0.008 + r.NextDouble() * 0.03);
        }

        /// <summary>玩家眼睛：原地慢慢转向首领（落地期间视线跟随）</summary>
        static CamPose EyeAt(float t) => new(new Vector3(0, 1.62f, 0), Quaternion.Euler(-4f, 3f * t, 0), 80f);

        static CamPose RandomPose(System.Random r) =>
            new(new Vector3(F(r, -50, 50), F(r, 0, 30), F(r, -50, 50)), Quaternion.Euler(F(r, -80, 80), F(r, -180, 180), F(r, -10, 10)), F(r, 30, 100));

        static float F(System.Random r, float a, float b) => (float)(a + r.NextDouble() * (b - a));

        // ───────────── 几何 ─────────────

        [Test]
        public void Orbit_SweepsAroundPivot_WithoutCuttingThrough()
        {
            var a = new Vector3(-10, 6, -10);
            var b = new Vector3(10, 3, -10);
            Assert.That(Vector3.Distance(IntroMath.Orbit(a, b, 0), a), Is.LessThan(1e-4f));
            Assert.That(Vector3.Distance(IntroMath.Orbit(a, b, 1), b), Is.LessThan(1e-4f));
            float la = new Vector2(a.x, a.z).magnitude;
            for (int i = 0; i <= 20; i++)
            {
                var p = IntroMath.Orbit(a, b, i / 20f);
                Assert.AreEqual(la, new Vector2(p.x, p.z).magnitude, 1e-3f, "等距离的两端：一路保持水平距离（不穿过看点）");
                Assert.AreEqual(Mathf.Lerp(6, 3, i / 20f), p.y, 1e-4f, "高度线性");
            }
            Assert.Less(IntroMath.Orbit(a, b, 0.5f).z, -13f, "走的是看点前面的弧，不是直线（直线中点 z = −10）");
            Assert.That(IntroMath.Finite(IntroMath.Orbit(Vector3.zero, Vector3.up, 0.5f)), "退化输入不出 NaN");
        }

        [Test]
        public void DuelBasis_PointsFromPlayerToBoss()
        {
            IntroMath.DuelBasis(new Vector3(0, 0, -20), new Vector3(0, 3, 0), Vector3.right, out var f, out var r);
            Assert.That(Vector3.Distance(f, Vector3.forward), Is.LessThan(1e-5f), "+Z = 玩家 → 首领（水平）");
            Assert.That(Vector3.Distance(r, Vector3.right), Is.LessThan(1e-5f), "+X = 玩家右手");
            Assert.That(Vector3.Distance(IntroMath.ToWorld(new Vector3(1, 2, 3), f, r), new Vector3(1, 2, 3)), Is.LessThan(1e-5f));
            IntroMath.DuelBasis(Vector3.zero, new Vector3(0.1f, 5, 0), Vector3.left, out f, out _);
            Assert.That(Vector3.Distance(f, Vector3.left), Is.LessThan(1e-5f), "玩家站在出生点上：退回备用方向");
            IntroMath.DuelBasis(Vector3.zero, Vector3.zero, Vector3.zero, out f, out _);
            Assert.That(Vector3.Distance(f, Vector3.forward), Is.LessThan(1e-5f), "全退化：+Z");
        }

        [Test]
        public void YawPitch_LooksAtTarget_AndClampsPitch()
        {
            var eye = new Vector3(2, 1.6f, -5);
            var target = new Vector3(-6, 4, 12);
            IntroMath.YawPitch(eye, target, 60f, out float yaw, out float pitch);
            var dir = Quaternion.Euler(pitch, yaw, 0) * Vector3.forward;
            Assert.Greater(Vector3.Dot(dir, (target - eye).normalized), 0.9999f, "Euler(pitch, yaw) 正好看向目标（与 PlayerMotor 的写法一致）");
            IntroMath.YawPitch(eye, eye + new Vector3(0, 50, 1), 32f, out _, out pitch);
            Assert.AreEqual(-32f, pitch, 1e-4f, "仰角夹在上限");
        }

        [Test]
        public void LookRotation_NeverNaN()
        {
            foreach (var d in new[] { Vector3.zero, Vector3.up, Vector3.down * 3, new Vector3(float.NaN, 0, 1) })
            {
                var q = IntroMath.LookRotation(d, 5f);
                Assert.That(float.IsFinite(q.x) && float.IsFinite(q.y) && float.IsFinite(q.z) && float.IsFinite(q.w), $"{d}");
            }
            var r = IntroMath.LookRotation(Vector3.forward, 10f);
            Assert.AreEqual(10f, Mathf.DeltaAngle(0, r.eulerAngles.z), 1e-3f, "横滚");
        }

        // ───────────── 镜头表 ─────────────

        [Test]
        public void ShotTimeline_Lookup()
        {
            var s = new BossIntroScript { id = "t" };
            s.shots.Add(IntroShot.Make("a", 1f));
            s.shots.Add(IntroShot.Make("b", 2f));
            s.shots.Add(IntroShot.Make("c", 0.5f));
            Assert.AreEqual(3.5f, s.ShotsSeconds, 1e-5f);
            Assert.AreEqual(0, s.ShotIndexAt(0f, out float l));
            Assert.AreEqual(0f, l);
            Assert.AreEqual(0, s.ShotIndexAt(0.99f, out _));
            Assert.AreEqual(1, s.ShotIndexAt(1f, out l));
            Assert.AreEqual(0f, l, 1e-5f);
            Assert.AreEqual(1, s.ShotIndexAt(2.9f, out l));
            Assert.AreEqual(1.9f, l, 1e-5f);
            Assert.AreEqual(2, s.ShotIndexAt(3.2f, out _));
            Assert.AreEqual(-1, s.ShotIndexAt(3.6f, out l), "播完");
            Assert.AreEqual(0.1f, l, 1e-5f);
            Assert.AreEqual(3f, s.ShotStart(2), 1e-5f);
        }

        [Test]
        public void ShotPose_FollowsTable_AndBlendInStartsFromFirstPerson()
        {
            var script = new BossIntroScript { id = "t" };
            var shot = IntroShot.Make("x", 2f)
                .Move(IntroPoint.At(IntroAnchors.Spawn, 0, 2, -10), IntroPoint.At(IntroAnchors.Spawn, 0, 2, -6))
                .Look(IntroPoint.At(IntroAnchors.Spawn, 0, 2, 0)).Fov(50, 40).Ease(IntroEase.Linear);
            script.shots.Add(shot);
            var ctx = BossIntroContext.Preview(script, new Vector3(0, 0, -30), Vector3.zero);
            var p0 = IntroMath.ShotPose(shot, 0, ctx);
            var p1 = IntroMath.ShotPose(shot, 2, ctx);
            Assert.That(Vector3.Distance(p0.position, new Vector3(0, 2, -10)), Is.LessThan(1e-4f), "起点");
            Assert.That(Vector3.Distance(p1.position, new Vector3(0, 2, -6)), Is.LessThan(1e-4f), "终点");
            Assert.AreEqual(45f, IntroMath.ShotPose(shot, 1, ctx).fov, 1e-4f, "视角线性");
            Assert.Greater(Vector3.Dot(p0.rotation * Vector3.forward, Vector3.forward), 0.9999f, "看着出生点");
            // 第一镜的 blendIn 从第一人称的姿态出发：混合权重 0 时就是第一人称
            var fp = new CamPose(new Vector3(0, 1.6f, -30), Quaternion.identity, 80f);
            var start = IntroMath.Blend(fp, p0, IntroMath.Ease(IntroEase.InOut, 0f));
            Assert.AreEqual(fp.position, start.position);
            Assert.AreEqual(fp.fov, start.fov);
        }

        // ───────────── 四个首领的脚本 ─────────────

        [Test]
        public void EveryBossHasAValidIntro_6To10Seconds()
        {
            foreach (var id in BossIds)
            {
                var s = BossIntroScript.For(id);
                Assert.IsNotNull(s, $"{id} 没有演出");
                Assert.AreEqual(id, s.Id, $"{id} 用的是通用演出");
                var problems = s.Validate();
                Assert.IsEmpty(problems, $"{id}：{string.Join("；", problems)}");
                Assert.That(s.Seconds, Is.InRange(6f, 10f), $"{id} 整段 {s.Seconds:F1}s（设计 6–10 s）");
                Assert.That(s.shots.Count, Is.GreaterThanOrEqualTo(3), $"{id}：至少 建立全景 → 现身 → 特写 三镜");
                Assert.Greater(s.shots[0].blendIn, 0f, $"{id}：第一镜从玩家眼中平滑拔起");
                var def = Bosses.Get(id);
                Assert.IsNotNull(def, id);
                Assert.LessOrEqual(s.spawnAt + def.intro.seconds, s.Seconds, $"{id}：首领自己的登场动作要在镜头交还前播完（交还即开打）");
                Assert.Less(s.spawnAt, s.ShotStart(s.shots.Count - 1), $"{id}：特写之前首领就已经生成");
                Assert.That(s.epithet, Is.Not.Null.And.Not.Empty, $"{id}：名字卡的场地小字");
            }
            var generic = BossIntroScript.For("boss_no_such_boss");
            Assert.IsNotNull(generic, "没有专属演出的首领用通用演出");
            Assert.AreEqual(BossIntroScript.DefaultId, generic.Id);
            Assert.IsEmpty(generic.Validate(), string.Join("；", generic.Validate()));
        }

        [Test]
        public void IntroAnchors_ResolveToFiniteSpots_WithoutAScene()
        {
            foreach (var s in BossIntroScript.All)
            {
                var ctx = BossIntroContext.Preview(s, new Vector3(5, 0, -40), new Vector3(0, 0, 8));
                for (int i = 0; i < s.shots.Count; i++)
                {
                    var shot = s.shots[i];
                    foreach (float u in new[] { 0f, shot.seconds * 0.5f, shot.seconds })
                    {
                        var p = IntroMath.ShotPose(shot, u, ctx);
                        Assert.That(p.Finite, $"{s.Id} 第 {i + 1} 镜 {shot.name} @ {u:F2}s 姿态非法：{p}");
                        Assert.That(p.fov, Is.InRange(10f, 120f));
                    }
                }
                Assert.That(IntroMath.Finite(ctx.Anchor(IntroAnchors.Eye)));
                Assert.That(IntroMath.Finite(ctx.Anchor("no_such_anchor")), "没定义的锚点退回出生点");
            }
        }

        [Test]
        public void Validate_CatchesBrokenTables()
        {
            var s = new BossIntroScript { id = "broken", spawnAt = 9f, landSeconds = 0.1f };
            s.shots.Add(IntroShot.Make("a", 0f).Move(IntroPoint.At("nowhere"), default).Look(IntroPoint.At(IntroAnchors.Head)).Fov(5, 200));
            var p = s.Validate();
            Assert.That(p.Exists(x => x.Contains("时长")), "时长 0");
            Assert.That(p.Exists(x => x.Contains("nowhere")), "没定义的锚点");
            Assert.That(p.Exists(x => x.Contains("没有锚点")), "空的点");
            Assert.That(p.Exists(x => x.Contains("视角")), "视角越界");
            Assert.That(p.Exists(x => x.Contains("生成时刻")), "生成时刻在镜头表外");
            Assert.That(p.Exists(x => x.Contains("落回第一人称")), "落地太短");
            Assert.That(p.Exists(x => x.Contains("名字卡")), "没有名字卡");
        }

        // ───────────── 跳过 / 存档 ─────────────

        [Test]
        public void SkipRule_FirstViewWaits_SeenSkipsAnytime()
        {
            Assert.IsFalse(BossIntroDirector.SkipAllowed(false, 0f));
            Assert.IsFalse(BossIntroDirector.SkipAllowed(false, 1.49f), "第一次看不满 1.5 s 不能跳");
            Assert.IsTrue(BossIntroDirector.SkipAllowed(false, 1.5f));
            Assert.IsTrue(BossIntroDirector.SkipAllowed(true, 0f), "看过的一开始就能跳");
            Assert.AreEqual(1.5f, BossIntroDirector.FirstViewLock);
        }

        [Test]
        public void SeenLog_RoundTripsThroughSave()
        {
            string root = Path.Combine(Path.GetTempPath(), "spiritfire_intro_" + System.Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            bool forceDev = SaveService.ForceDev;
            try
            {
                SaveService.UseRoot(root);
                SaveService.ForceDev = true;
                var log = SaveService.Profile.Section<BossIntroLog>();
                Assert.IsFalse(log.Seen(HanbaDef.Id), "新档没看过");
                log.MarkSeen(HanbaDef.Id);
                log.MarkSeen(QilinDef.Id);
                Assert.IsTrue(SaveService.Profile.Save());
                SaveService.UseRoot(root);
                var again = SaveService.Profile.Section<BossIntroLog>();
                Assert.IsTrue(again.Seen(HanbaDef.Id), "写盘再读回来还记得");
                Assert.IsTrue(again.Seen(QilinDef.Id));
                Assert.IsFalse(again.Seen(KunPengDef.Id));
                Assert.IsTrue(again.Forget(HanbaDef.Id));
                Assert.IsFalse(again.Seen(HanbaDef.Id));
                var fresh = new BossIntroLog();
                fresh.Restore("{not json", 1);
                Assert.AreEqual(0, fresh.SeenIds.Count, "坏数据当没看过");
                fresh.Restore("{\"seen\":[\"a\",3,null,\"b\"]}", 1);
                CollectionAssert.AreEquivalent(new List<string> { "a", "b" }, fresh.SeenIds, "只认字符串");
                Assert.AreEqual("{\"seen\":[\"a\",\"b\"]}", fresh.Capture());
            }
            finally
            {
                SaveService.ForceDev = forceDev;
                SaveService.UseRoot(null);
                try { Directory.Delete(root, true); }
                catch (IOException) { }
            }
        }
    }
}
