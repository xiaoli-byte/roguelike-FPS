using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>技能出手的覆盖姿态（HC3）：六个技能都有动作，时间线首尾归零、幅度和时长在手感底线以内</summary>
    public class CastPoseTests
    {
        static readonly string[] Skills =
        {
            "fox_blaze_grenade", "fox_nine_tails", "falcon_storm_beacon", "falcon_hawk_verdict", "bear_earth_splitter", "bear_bastion",
        };

        [Test]
        public void EveryHeroSkillHasACastStyle()
        {
            foreach (var id in Skills)
                Assert.That(CastPose.StyleFor(id), Is.Not.EqualTo(CastStyle.None), id);
            Assert.That(CastPose.StyleFor("unknown_skill"), Is.EqualTo(CastStyle.None));
        }

        [Test]
        public void TimelinesStartAndEndAtRestAndStayShort()
        {
            foreach (CastStyle s in System.Enum.GetValues(typeof(CastStyle)))
            {
                if (s == CastStyle.None) continue;
                var keys = CastPose.Timeline(s);
                Assert.That(keys.Length, Is.GreaterThanOrEqualTo(3), $"{s} 至少 3 个关键帧");
                Assert.That(keys[0].pos, Is.EqualTo(Vector3.zero), $"{s} 从原姿态开始");
                Assert.That(keys[^1].pos, Is.EqualTo(Vector3.zero), $"{s} 回到原姿态");
                Assert.That(keys[^1].rot, Is.EqualTo(Vector3.zero));
                Assert.That(keys[^1].t, Is.InRange(0.3f, 0.65f), $"{s} 0.3–0.65 s 放完（出手干脆，不拖）");
                for (int i = 1; i < keys.Length; i++)
                    Assert.That(keys[i].t, Is.GreaterThan(keys[i - 1].t), $"{s} 关键帧时间递增");

                float maxPos = 0, maxRot = 0;
                for (float t = 0; t <= keys[^1].t + 0.05f; t += 0.01f)
                {
                    CastPose.Evaluate(keys, t, out var p, out var r);
                    maxPos = Mathf.Max(maxPos, p.magnitude);
                    maxRot = Mathf.Max(maxRot, r.magnitude);
                }
                Assert.That(maxPos, Is.InRange(0.02f, 0.13f), $"{s} 位移看得出、但枪不出画面");
                Assert.That(maxRot, Is.LessThan(0.6f), $"{s} 转角不超过 ~34°");
                CastPose.Evaluate(keys, keys[^1].t + 0.01f, out var endP, out var endR);
                Assert.That(endP, Is.EqualTo(Vector3.zero));
                Assert.That(endR, Is.EqualTo(Vector3.zero));
            }
        }
    }
}
