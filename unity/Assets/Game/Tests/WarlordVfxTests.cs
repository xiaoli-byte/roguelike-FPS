using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 熔心魔将的动作 · 特效调优（W 路，docs/art/vfx/warlord.md）：手 K 片段的释放帧事件和招式判定时刻的约定。
    /// 片段由 art/source/characters/SK_Boss_Warlord/anim/warlord_anims.py 生成，事件写在 Anim/SK_Boss_Warlord.events.json；
    /// WarlordBrain 按这些位置拉伸片段（ActScale），招式改了时长或脚本改了帧，这里会先红：
    ///   · 连斩每刀按 <see cref="WarlordBrain.SlashClip"/> 拉伸，刀到（hit）落在 0.5 s 的判定上（±1 帧）；收尾刀是 slashC；
    ///   · 陨石雨 raise 的 cast 在 33%、熔铜渠 plant 的 hit 在 35%（WarlordBrain 按这两个比例拉伸）；
    ///   · 横扫 / 反手的 hit 在头两帧（前摇片段拉伸到前摇，接上就是刀到）；落地 land 的 hit 在第 0 帧（落地那一刻才触发）；
    ///   · 跃击腾空 leap 不自动接 land（落地由招式判定触发）；
    ///   · 狂怒色阶的两端。
    /// </summary>
    public sealed class WarlordVfxTests
    {
        const string EventsPath = "Assets/Art/Characters/SK_Boss_Warlord/Anim/SK_Boss_Warlord.events.json";
        const float Frame = 1f / 30f;

        static string events;

        static string Events => events ??= File.Exists(EventsPath) ? File.ReadAllText(EventsPath) : null;

        /// <summary>某段片段里第一个名为 name 的事件的归一化时刻（找不到 NaN）</summary>
        static float At(string clip, string name)
        {
            var json = Events;
            if (json == null) return float.NaN;
            var block = Regex.Match(json, "\"" + clip + "\": \\{(.*?)\\]", RegexOptions.Singleline);
            if (!block.Success) return float.NaN;
            var m = Regex.Match(block.Groups[1].Value, "\"at\": ([0-9.]+),\\s*\"name\": \"" + Regex.Escape(name) + "\"");
            return m.Success ? float.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture) : float.NaN;
        }

        [Test]
        public void SlashOrder_LastIsTheOverheadChop()
        {
            CollectionAssert.AreEqual(new[] { "slashA", "slashB", "slashC" }, new[] { 0, 1, 2 }.Select(k => WarlordBrain.SlashState(k, 3)).ToArray());
            CollectionAssert.AreEqual(new[] { "slashA", "slashB", "slashA", "slashC" }, new[] { 0, 1, 2, 3 }.Select(k => WarlordBrain.SlashState(k, 4)).ToArray());
            Assert.Greater(WarlordBrain.SlashClip, WarlordRef.ComboPer, "每刀片段要比每斩间隔长：下一刀触发时这一刀还没开始退回待机");
        }

        [Test]
        public void SlashHit_LandsOnTheJudgement()
        {
            Assume.That(Events, Is.Not.Null, "没有事件叠加表（先跑 warlord_anims.py）");
            foreach (var clip in new[] { "slashA", "slashB", "slashC" })
            {
                float hit = At(clip, "hit");
                Assert.IsFalse(float.IsNaN(hit), $"{clip} 没有 hit 事件");
                Assert.AreEqual(WarlordRef.ComboWindup, hit * WarlordBrain.SlashClip, Frame, $"{clip} 的刀到 {hit * WarlordBrain.SlashClip:F3} s 没对上 0.5 s 的判定");
                Assert.Less(At(clip, "smear"), hit, $"{clip} 的拖影要在刀到之前开始");
                Assert.Greater(At(clip, "smearEnd"), hit, $"{clip} 的拖影要在刀到之后才停");
            }
        }

        [Test]
        public void StretchedClips_KeepTheirReleaseRatios()
        {
            Assume.That(Events, Is.Not.Null, "没有事件叠加表（先跑 warlord_anims.py）");
            Assert.AreEqual(0.33f, At("raise", "cast"), 0.01f, "WarlordBrain 按 cast 在 33% 拉伸 raise");
            Assert.AreEqual(0.35f, At("plant", "hit"), 0.01f, "WarlordBrain 按 hit 在 35% 拉伸 plant");
            Assert.LessOrEqual(At("sweep", "hit") * 0.8f, 2 * Frame, "横扫的刀到要在 sweep 头两帧");
            Assert.LessOrEqual(At("sweepBack", "hit") * 0.8f, 2 * Frame, "反手的刀到要在 sweepBack 头两帧");
            Assert.AreEqual(0f, At("land", "hit"), 1e-4f, "落地那一刻才触发 land，hit 在第 0 帧");
            Assert.AreEqual(0f, At("crash", "impact"), 1e-4f, "撞墙那一刻才触发 crash，impact 在第 0 帧");
        }

        [Test]
        public void Leap_DoesNotChainIntoLand()
        {
            Assume.That(Events, Is.Not.Null, "没有事件叠加表（先跑 warlord_anims.py）");
            var leap = Regex.Match(Events, "\"leap\": \\{(.*?)\\}\\s*,\\s*\"", RegexOptions.Singleline);
            Assert.IsTrue(leap.Success);
            StringAssert.DoesNotContain("\"next\"", leap.Groups[1].Value, "落地由招式判定触发（WarlordBrain.LeapLand），腾空片段不能按时长自动接 land");
            StringAssert.Contains("\"next\": \"leap\"", Regex.Match(Events, "\"crouch\": \\{(.*?)\\}\\s*,\\s*\"", RegexOptions.Singleline).Groups[1].Value);
        }

        [Test]
        public void Palette_FuryShiftsTowardWhiteHotCopper()
        {
            Assert.AreEqual(WarlordPalette.Copper, WarlordPalette.CopperAt(0));
            Assert.AreEqual(WarlordPalette.FuryCopper, WarlordPalette.CopperAt(1));
            Assert.Greater(WarlordPalette.HotAt(1).b, WarlordPalette.HotAt(0).b, "狂怒的亮芯更白");
            Color.RGBToHSV(WarlordPalette.Smoke, out float h, out float s, out _);
            Assert.That(h > 0.75f || h < 0.05f, $"烟要偏紫褐（色相 {h:F2}）");
            Assert.Less(s, 0.6f);
        }
    }
}
