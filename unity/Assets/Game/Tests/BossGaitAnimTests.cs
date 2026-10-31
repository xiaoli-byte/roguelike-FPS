using System.IO;
using System.Text.RegularExpressions;
using NUnit.Framework;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 第二批 B 路（2026-10-31，docs/art/vfx/qilin.md §2.9–2.12、warlord.md §12）：火麒麟的跃起 / 饮熔 / 硬直 / 喘息 / 焚身踏云步态、
    /// 熔心魔将的双手持剑待机 / 步态 / 登场落地停顿——手 K 片段的事件叠加表和代码里按片段位置写死的常数要对得上。
    /// 片段和事件表由 art/source/characters/SK_Boss_Qilin/anim/qilin_anims.py、SK_Boss_Warlord/anim/warlord_anims.py 生成；改了帧号这里先红。
    /// </summary>
    public sealed class BossGaitAnimTests
    {
        const string QilinEvents = "Assets/Art/Characters/SK_Boss_Qilin/Anim/SK_Boss_Qilin.events.json";
        const string BurnEvents = "Assets/Art/Characters/SK_Boss_QilinBurn/Anim/SK_Boss_QilinBurn.events.json";
        const string WarlordEvents = "Assets/Art/Characters/SK_Boss_Warlord/Anim/SK_Boss_Warlord.events.json";
        const float Frame = 1f / 30f;

        static string Read(string path) => File.Exists(path) ? File.ReadAllText(path) : null;

        /// <summary>某个状态的条目（数组简写或对象写法）原文；找不到为 null</summary>
        static string Block(string json, string clip)
        {
            if (json == null) return null;
            var m = Regex.Match(json, "\"" + Regex.Escape(clip) + "\": (\\[.*?\\]|\\{.*?\\n    \\})", RegexOptions.Singleline);
            return m.Success ? m.Groups[1].Value : null;
        }

        /// <summary>条目里第一个名为 name 的事件的归一化时刻（找不到 NaN）</summary>
        static float At(string block, string name)
        {
            if (block == null) return float.NaN;
            var m = Regex.Match(block, "\"at\": ([0-9.]+),\\s*\"name\": \"" + Regex.Escape(name) + "\"");
            return m.Success ? float.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture) : float.NaN;
        }

        static float Number(string block, string key)
        {
            var m = block == null ? Match.Empty : Regex.Match(block, "\"" + key + "\": ([0-9.]+)");
            return m.Success ? float.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture) : float.NaN;
        }

        [Test]
        public void QilinLeap_TakesOffWhenTheDrinkArcStarts_AndChainsIntoDrink()
        {
            var json = Read(QilinEvents);
            Assume.That(json, Is.Not.Null, "没有事件叠加表（先跑 qilin_anims.py）");
            var leap = Block(json, "leap");
            Assert.IsNotNull(leap, "玄鳞没有手 K 的 leap");
            StringAssert.Contains("\"next\": \"drink\"", leap, "跃起落地接饮熔（leap → drink 连段）");
            // ScaleDrink 前摇前 CrouchFrac 原地蹲，抛物线这一刻才离地：片段的起跳事件要落在同一帧（±1 帧，片段 1.0 s）
            Assert.AreEqual(ScaleDrink.CrouchFrac, At(leap, "fx:qLeap"), Frame, "起跳帧没对上 ScaleDrink.CrouchFrac");
            Assert.Greater(At(leap, "hit"), 0.95f, "前蹄落地在片段最后（= 饮熔第 0 帧）");
            Assert.IsNotNull(Block(json, "drink"), "玄鳞没有饮熔片段");
        }

        [Test]
        public void QilinStun_DefeatStopsBeforeGettingUp()
        {
            var json = Read(QilinEvents);
            Assume.That(json, Is.Not.Null, "没有事件叠加表（先跑 qilin_anims.py）");
            var stun = Block(json, "stun");
            float down = At(stun, "fx:qStunDown");
            Assert.IsFalse(float.IsNaN(down), "stun 没有瘫倒事件");
            // 倒下只播到 StunLieUntil：要在瘫倒之后、撑起身子（第 100 / 120 帧）之前
            Assert.Greater(QilinBrain.StunLieUntil, down + 0.1f, "倒下时还没瘫下去就冻住了");
            Assert.Less(QilinBrain.StunLieUntil, 100f / 120f, "倒下时已经开始撑起身子");
        }

        [Test]
        public void BurnGait_LoopsAtMoveSpeed_WithPairedCloudSteps()
        {
            var json = Read(BurnEvents);
            Assume.That(json, Is.Not.Null, "没有事件叠加表（先跑 qilin_burn_anims.py）");
            var move = Block(json, "Move");
            Assert.IsNotNull(move, "焚身的 Move 槽位不是手 K 的踏云步态");
            StringAssert.Contains("\"loop\": true", move);
            Assert.AreEqual(16f, Number(move, "speed"), 1e-3f, "录制速度沿用 Move 的 16 m/s（混合树阈值、maxClipSpeed 不变）");
            float h = At(move, "fx:qCloudH"), f = At(move, "fx:qCloudF");
            Assert.IsFalse(float.IsNaN(h) || float.IsNaN(f), "步态要有后蹄 / 前蹄踏云事件");
            Assert.AreEqual(0.5f, f - h, 0.02f, "前后蹄对踏相隔半个周期");
            Assert.IsNull(Block(Read(QilinEvents), "Move"), "玄鳞在地上跑，Move 仍是采样的地面奔跑");
        }

        [Test]
        public void WarlordLocomotion_TwoHandedLoopsAtRecordedSpeeds()
        {
            var json = Read(WarlordEvents);
            Assume.That(json, Is.Not.Null, "没有事件叠加表（先跑 warlord_anims.py）");
            foreach (var (clip, speed) in new[] { ("Walk", 2.3f), ("Move", 4.6f) })
            {
                var b = Block(json, clip);
                Assert.IsNotNull(b, $"{clip} 不是手 K 片段");
                StringAssert.Contains("\"loop\": true", b, $"{clip} 要循环");
                Assert.AreEqual(speed, Number(b, "speed"), 1e-3f, $"{clip} 的录制速度（混合树阈值）");
                Assert.Less(At(b, "sfx:footstep"), 0.1f, $"{clip} 的第一声脚步在右脚落地");
            }
            StringAssert.Contains("\"loop\": true", Block(json, "Idle"), "待机要循环");
        }

        [Test]
        public void WarlordIntroLand_HandsOverToRoarAtItsGatherFrame()
        {
            var json = Read(WarlordEvents);
            Assume.That(json, Is.Not.Null, "没有事件叠加表（先跑 warlord_anims.py）");
            var land = Block(json, WarlordBrain.IntroLandState);
            Assert.IsNotNull(land, "没有登场落地片段 introLand");
            Assert.AreEqual(0f, At(land, "hit"), 1e-4f, "落地那一刻才触发，hit 在第 0 帧");
            float glare = At(land, "glare");
            Assert.That(glare > 0.5f && glare < 0.95f, $"抬头怒视要在停顿之后、起身之前（{glare:F2}）");
            StringAssert.DoesNotContain("\"next\"", land, "停顿片段不自动接别的状态（咆哮由 IntroTick 按时刻接）");
            Assert.AreEqual(At(Block(json, "roar"), "gather"), WarlordBrain.RoarGatherAt, 0.01f, "咆哮从缩身那一帧接着播：RoarGatherAt 要等于 roar 的 gather 事件");
        }
    }
}
