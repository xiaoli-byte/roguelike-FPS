using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 碎刃第一人称（WC7）：三段斩剪辑（代码生成）的判定帧事件与控制器的命中结算对齐、剪辑姿态、构图约束（60° 枪模相机 16:9 / 4:3）、
    /// 伸刃时间线、刀光（FX1 预设 + 速度 → 亮度 + 断条）、剑指（左手手势与补出的两根手指）。
    /// </summary>
    public sealed class BladeFirstPersonTests
    {
        const float VmFov = 60f;
        static readonly float[] Aspects = { 16f / 9f, 4f / 3f };

        static BladeSlash[] Combo => DemonBladeDef.CreateSpec().combo;

        /// <summary>相机局部点 → 归一化屏幕坐标（−1..1 在画面内）</summary>
        static Vector2 Ndc(Vector3 p, float aspect)
        {
            float t = Mathf.Tan(VmFov * 0.5f * Mathf.Deg2Rad);
            return new Vector2(p.x / (p.z * t * aspect), p.y / (p.z * t));
        }

        // ───────────── 三段斩剪辑 ─────────────

        [Test]
        public void BladeSlashClipsPutTheStrikeEventOnTheJudgementFrame()
        {
            var combo = Combo;
            Assert.That(combo.Length, Is.EqualTo(3));
            for (int i = 0; i < combo.Length; i++)
            {
                var seg = combo[i];
                var c = new BladeSwingClip(i, seg, false);
                try
                {
                    Assert.That(c.clip.length, Is.EqualTo(seg.duration).Within(1e-4f), $"第 {i + 1} 段剪辑长度");
                    var ev = c.Events;
                    Assert.That(ev.Select(e => e.functionName), Is.EqualTo(new[] { BladeSwing.WindupEvent, BladeSwing.StrikeEvent, BladeSwing.RecoverEvent }));
                    Assert.That(ev.All(e => e.intParameter == i), $"第 {i + 1} 段事件的段号");
                    // 判定帧事件 = 控制器 swingT ≥ windup 结算命中的那一刻
                    Assert.That(ev[1].time, Is.EqualTo(seg.windup).Within(1e-4f), $"第 {i + 1} 段判定帧事件");
                    Assert.That(c.HitP, Is.EqualTo(seg.windup / seg.duration).Within(1e-4f));
                    Assert.That(ev[0].time, Is.EqualTo(seg.windup * BladeSwing.WindFrac).Within(1e-4f));
                    Assert.That(ev[2].time, Is.EqualTo(seg.duration * BladeSwing.RecoverP).Within(1e-4f));
                    Assert.That(ev[0].time < ev[1].time && ev[1].time < ev[2].time && ev[2].time < seg.duration);
                    Assert.That(c.Matches(seg));
                    Assert.That(c.Matches(new BladeSlash { windup = seg.windup * 1.5f, duration = seg.duration, stretch = seg.stretch }), Is.False, "判定帧改了要重建剪辑");
                }
                finally { Object.DestroyImmediate(c.clip); }
            }
        }

        [Test]
        public void BladeSlashClipsHitTheKeyPosesOnTheirEvents()
        {
            var combo = Combo;
            for (int i = 0; i < combo.Length; i++)
            {
                var c = new BladeSwingClip(i, combo[i], true);
                try
                {
                    Assert.That(c.clip.legacy, "运行时用的剪辑是 legacy（运行时只有 legacy 剪辑能 SetCurve）");
                    var keys = BladeSwing.Swings[i];
                    void Near(BladeHoldPose a, BladeSwing.Key k, string what)
                    {
                        Assert.That(Vector3.Distance(a.pos, k.p), Is.LessThan(1e-3f), $"第 {i + 1} 段 {what} 位置");
                        Assert.That(Quaternion.Angle(a.rot, k.Rotation), Is.LessThan(0.5f), $"第 {i + 1} 段 {what} 朝向");
                    }
                    Near(c.Sample(c.windupTime), keys[0], "出刀（蓄势末）");
                    Near(c.Sample(c.strikeTime), keys[1], "判定帧");
                    Near(c.Sample(c.duration), keys[2], "收势");
                    // 采样之间是线性插值：剪辑和解析时间线处处吻合（关键帧够密）
                    for (float p = c.WindupP; p <= 1; p += 0.013f)
                    {
                        var a = c.SampleP(p);
                        var b = BladeSwing.Sample(i, p, c.HitP, BladeSwing.Idle.Pose);
                        Assert.That(Vector3.Distance(a.pos, b.pos), Is.LessThan(0.006f), $"第 {i + 1} 段 p={p:F3} 位置");
                        Assert.That(Quaternion.Angle(a.rot, b.rot), Is.LessThan(3f), $"第 {i + 1} 段 p={p:F3} 朝向");
                    }
                }
                finally { Object.DestroyImmediate(c.clip); }
            }
        }

        [Test]
        public void BladeSwingsKeepTheGripOnScreenAndTheTipForward()
        {
            var combo = Combo;
            var idle = BladeSwing.Idle.Pose;
            for (int i = 0; i < combo.Length; i++)
            {
                float hitP = combo[i].windup / combo[i].duration;
                for (float p = 0; p <= 1.0001f; p += 0.02f)
                {
                    var pose = BladeSwing.Sample(i, p, hitP, idle);
                    Assert.That(pose.Tip.z, Is.GreaterThan(-0.05f), $"第 {i + 1} 段 p={p:F2}：刀尖转向了镜头（{pose.Tip}）");
                    foreach (float aspect in Aspects)
                    {
                        var g = Ndc(pose.pos, aspect);
                        Assert.That(Mathf.Abs(g.x) < 1 && Mathf.Abs(g.y) < 1, $"第 {i + 1} 段 p={p:F2}：握刀点出了画面（{g}，宽高比 {aspect:F2}）");
                    }
                }
                // 判定帧：刀身中段穿过画面中部
                var strike = BladeSwing.Sample(i, hitP, hitP, idle);
                var mid = strike.BladePoint(0, (float)BladeShape.BladeLen * 0.5f, BladeView.ModelScale, BladeMeshes.GripY);
                foreach (float aspect in Aspects)
                {
                    var g = Ndc(mid, aspect);
                    Assert.That(Mathf.Abs(g.x) < 0.8f && Mathf.Abs(g.y) < 0.8f, $"第 {i + 1} 段判定帧时刀身中段不在画面中部（{g}）");
                }
            }
            foreach (BladeGesture gst in System.Enum.GetValues(typeof(BladeGesture)))
            {
                var k = BladeSwing.GestureKey(gst).Pose;
                Assert.That(k.Tip.z, Is.GreaterThan(-0.05f), $"手势 {gst} 刀尖转向了镜头");
                foreach (float aspect in Aspects)
                {
                    var g = Ndc(k.pos, aspect);
                    Assert.That(Mathf.Abs(g.x) < 1 && Mathf.Abs(g.y) < 1, $"手势 {gst} 握刀点出了画面（{g}）");
                }
            }
        }

        [Test]
        public void BladeThirdSlashStretchesAroundTheStrike()
        {
            var combo = Combo;
            for (int i = 0; i < 2; i++)
            for (float p = 0; p <= 1; p += 0.05f)
                Assert.That(BladeSwing.Stretch(p, combo[i].windup / combo[i].duration, combo[i].stretch), Is.EqualTo(1).Within(1e-5f), $"第 {i + 1} 段不伸刃");
            var s3 = combo[2];
            float h = s3.windup / s3.duration;
            Assert.That(s3.stretch, Is.EqualTo(2.2f).Within(1e-4f));
            Assert.That(BladeSwing.Stretch(0, h, s3.stretch), Is.EqualTo(1).Within(1e-5f), "起手不伸");
            Assert.That(BladeSwing.Stretch(h * BladeSwing.WindFrac, h, s3.stretch), Is.EqualTo(1).Within(1e-4f), "出刀那一刻开始伸");
            Assert.That(BladeSwing.Stretch(h, h, s3.stretch), Is.EqualTo(2.2f).Within(1e-4f), "判定帧伸满");
            Assert.That(BladeSwing.Stretch(BladeSwing.RecoverP, h, s3.stretch), Is.EqualTo(2.2f).Within(1e-4f), "收势前保持");
            Assert.That(BladeSwing.Stretch(1, h, s3.stretch), Is.EqualTo(1).Within(1e-4f), "收势缩回");
            float prev = 1;
            for (float p = h * BladeSwing.WindFrac; p <= h; p += 0.01f)
            {
                float s = BladeSwing.Stretch(p, h, s3.stretch);
                Assert.That(s, Is.GreaterThanOrEqualTo(prev - 1e-5f), "伸刃单调");
                prev = s;
            }
            // 剪辑里也带着这条曲线（判定帧时 2.2）
            var c = new BladeSwingClip(2, s3, true);
            try { Assert.That(c.Stretch(c.strikeTime), Is.EqualTo(2.2f).Within(0.01f)); }
            finally { Object.DestroyImmediate(c.clip); }
            // 刀根一截不动，刀尖按倍率拉长
            Assert.That(BladeSwing.StretchY(0.05f, 2.2f), Is.EqualTo(0.05f));
            float tip = (float)BladeShape.BladeLen;
            Assert.That(BladeSwing.StretchY(tip, 2.2f), Is.EqualTo(BladeSwing.StretchBaseY + (tip - BladeSwing.StretchBaseY) * 2.2f).Within(1e-5f));
        }

        // ───────────── 刀光 ─────────────

        [Test]
        public void BladeTrailUsesTheFxPresetAndBrightensWithSwingSpeed()
        {
            var preset = Registry<FxPreset>.Get(BladeTrailPreset.PresetId) as FxTrailPreset;
            Assert.That(preset, Is.Not.Null, "刀光走 FX1 预设体系：BladeTrail 应登记为 FxTrailPreset");
            Assert.That(preset.Layers.Length, Is.GreaterThan(0), "判定帧甩出的火星层");
            var spec = preset.Trail;
            Assert.That(spec.Brightness(0), Is.EqualTo(spec.minBrightness).Within(1e-5f));
            Assert.That(spec.Brightness(spec.fastSpeed * 2), Is.EqualTo(1).Within(1e-5f));
            float prev = 0;
            for (float v = 0; v <= spec.fastSpeed * 1.2f; v += 0.5f)
            {
                float b = spec.Brightness(v);
                Assert.That(b, Is.GreaterThanOrEqualTo(prev - 1e-6f), "越快越亮");
                prev = b;
            }
            Assert.That(spec.Brightness(float.NaN), Is.EqualTo(spec.minBrightness).Within(1e-5f));
            Assert.That(BladeTrail.ResolveSpec(), Is.SameAs(spec));
        }

        [Test]
        public void BladeTrailAgesOutAndBreaksBetweenSlashes()
        {
            var parent = new GameObject("trail test");
            try
            {
                var trail = BladeTrail.Create(parent.transform);
                var spec = trail.Spec;
                trail.Push(Vector3.zero, Vector3.up, 0);
                trail.Tick(0, Color.magenta);
                Assert.That(trail.Visible, Is.False, "一个采样点画不出带子");
                trail.Push(Vector3.right * 0.1f, Vector3.right * 0.1f + Vector3.up, spec.fastSpeed * 2);
                trail.Tick(0.01f, Color.magenta);
                Assert.That(trail.Visible, "两个相连的采样点画出带子");
                Assert.That(trail.PeakBrightness, Is.EqualTo(1).Within(1e-5f));
                Assert.That(trail.LastBrightness, Is.EqualTo(1).Within(1e-5f));
                // 新一段另起一条：只有一个点的新条不跟旧条连起来；旧条过期后整条消失
                trail.Break();
                trail.Push(Vector3.left, Vector3.left + Vector3.up, 0);
                trail.Tick(spec.life * 0.9f, Color.magenta);
                Assert.That(trail.Count, Is.EqualTo(3));
                trail.Tick(spec.life * 0.06f, Color.magenta);
                Assert.That(trail.Count, Is.EqualTo(1), "旧的两个点过期了");
                Assert.That(trail.Visible, Is.False, "剩下的那一点自成一条，画不出带子");
                // 采样点上限：最老的挤掉
                trail.Clear();
                for (int i = 0; i < spec.maxSamples + 10; i++) trail.Push(Vector3.right * i, Vector3.right * i + Vector3.up, 5);
                Assert.That(trail.Count, Is.EqualTo(spec.maxSamples));
            }
            finally { Object.DestroyImmediate(parent); }
        }

        // ───────────── 剑指 ─────────────

        [Test]
        public void BladeLeftHandRisesOnlyForSwordSigns()
        {
            Assert.That(BladeSwing.LeftHandWeight(BladeGesture.None), Is.EqualTo(0));
            Assert.That(BladeSwing.LeftHandWeight(BladeGesture.Point), Is.EqualTo(1));
            Assert.That(BladeSwing.LeftHandWeight(BladeGesture.Raise), Is.EqualTo(1));
            Assert.That(BladeSwing.LeftHandWeight(BladeGesture.Shield), Is.EqualTo(0.8f));
            Assert.That(BladeSwing.GestureKey(BladeGesture.None).p, Is.EqualTo(BladeSwing.Idle.p));
            Assert.That(BladeSwing.GestureKey(BladeGesture.Point).p, Is.EqualTo(BladeSwing.Point.p));
        }

        [Test]
        public void BladeSwordSignFingersPointWhereTheGestureAims()
        {
            foreach (var arm in new[] { "SM_Arms_RedPandaL", "SM_Arms_PangolinL", "SM_Arms_FlyingSquirrelL", "unknown" })
            {
                var fit = BladeSwordSign.For(arm);
                Assert.That(fit, Is.Not.Null);
                foreach (var g in new[] { BladeGesture.Point, BladeGesture.Shield, BladeGesture.Raise })
                {
                    BladeView.LeftTarget(g, out var palm, out var fingers, out var fore);
                    var q = BladeView.LeftRotation(fit.dir, fingers, fore);
                    Assert.That(Vector3.Angle(q * fit.dir, fingers), Is.LessThan(0.5f), $"{arm} {g}：手指没指向手势方向");
                    Assert.That(Vector3.Dot(q * BladeView.LeftForearmLocal, fore), Is.GreaterThan(0.3f), $"{arm} {g}：前臂没朝画面左下方");
                    // 前臂朝下伸出画面、指尖在画面里（左半边）
                    Assert.That((q * BladeView.LeftForearmLocal).y, Is.LessThan(0), $"{arm} {g}：前臂朝上了");
                    var tip = palm + q * (BladeSwordSign.IndexTip(fit) * 0.76f);
                    foreach (float aspect in Aspects)
                    {
                        var n = Ndc(tip, aspect);
                        Assert.That(n.x > -1 && n.x < 0.2f && Mathf.Abs(n.y) < 1, $"{arm} {g}：指尖不在画面左半边（{n}）");
                    }
                }
                var mesh = BladeSwordSign.Build(fit);
                try
                {
                    Assert.That(mesh.vertexCount, Is.GreaterThan(40));
                    Assert.That(mesh.triangles.Length % 3, Is.EqualTo(0));
                    // 两根手指从指根伸出、长度对得上
                    Assert.That(mesh.bounds.Contains(fit.index) || Vector3.Distance(mesh.bounds.ClosestPoint(fit.index), fit.index) < 0.002f);
                    Assert.That(Vector3.Distance(mesh.bounds.ClosestPoint(BladeSwordSign.IndexTip(fit)), BladeSwordSign.IndexTip(fit)), Is.LessThan(0.002f));
                    var uvs = mesh.uv;
                    Assert.That(uvs.Distinct().Count(), Is.EqualTo(2), "指根手套色 + 指尖皮肤色两处 UV");
                }
                finally { Object.DestroyImmediate(mesh); }
            }
        }

        [Test]
        public void BladeViewHandsShardsOverAtTheSameScreenPoint()
        {
            // 枪模相机（60°）里的点换到主相机（80°）：深度不变，屏幕位置不变
            var p = new Vector3(0.21f, -0.13f, 0.6f);
            var m = BladeView.ToMainLocal(p, 80, VmFov);
            Assert.That(m.z, Is.EqualTo(p.z));
            float tv = Mathf.Tan(VmFov * 0.5f * Mathf.Deg2Rad), tm = Mathf.Tan(40 * Mathf.Deg2Rad);
            Assert.That(m.x / (m.z * tm), Is.EqualTo(p.x / (p.z * tv)).Within(1e-5f));
            Assert.That(m.y / (m.z * tm), Is.EqualTo(p.y / (p.z * tv)).Within(1e-5f));
            Assert.That(BladeView.FovRatio(60, 60), Is.EqualTo(1).Within(1e-6f));
        }
    }
}
