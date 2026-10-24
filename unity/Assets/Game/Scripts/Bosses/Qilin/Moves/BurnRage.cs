using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟 · 焚身 · 狂怒长啸（BS5；TS 的狂怒只改数值，这里给它一个读得出来的节点）：生命层跌破 15% 时排上（<see cref="QilinBrain"/> OnEnrage），只出一次。
    ///   飞到熔池上空靠玩家一侧 7.5 m 高人立长啸 1.3 s（池边亮一圈预警环、熔岩柱涌起）→ 熔岩柱冲天，一圈火浪从池边扫到殿墙（14 m/s，14（火）+ 击退，跳起来躲）；
    ///   熔流从玩家所在的象限重新开闸，之后按狂怒的数值轮（涨 4 s、隔 0.3 s）。
    /// 狂怒本身（框架）：喘息 × 0.72（连同焚身的 0.9 ≈ TS 的 0.65）、前摇 × 0.85、伤害 × 1.15；俯冲蓄势 0.7 s、火云雨 14 颗。
    /// </summary>
    public sealed class BurnRage : QilinMove
    {
        public const string MoveId = "burn_rage";
        /// <summary>火浪速度、伤害（TS 坠鼎火浪的写法，难度 1）</summary>
        public const float WaveSpeed = 14f, WaveDamage = 14f;

        public override string Id => MoveId;
        public override string Name => "狂怒长啸";

        /// <summary>累计：放出的火浪</summary>
        public int Waves { get; private set; }

        public BurnRage()
        {
            cooldown = 0;
            recovery = 0.4f;
            weight = 0;
            windup = 1.3f;
            active = 0.4f;
            recover = 0.5f;
            forms = new[] { QilinDef.BurnForm };
        }

        public override float Weight(BossBrain b) => 0;

        protected override void Prepare()
        {
            if (Qilin) Qilin.SkyTarget = QilinBrain.HighAlt;
        }

        protected override void OnTelegraph()
        {
            var f = Furnace;
            var c = f ? f.Center : OnFloor(Brain.transform.position);
            // 火浪的起点：池边一圈亮起来（火浪本身扩散时自带一圈环形预警）
            float r0 = f ? f.poolRadius : 4f;
            Hazards.AnnulusWarning(c, r0, r0 + 1.6f, WindupTime, QilinDef.Warn);
            CountWarning();
            Brain.PlayAct("rear", WindupTime + 0.2f);
            Sfx("boss_roar", 1f, 0.75f);
            Brain.Shake(0.5f, WindupTime);
            Qilin?.Tell("rage", "焚身狂怒——火浪要从熔池扫过整座殿，跳起来躲！熔流轮转也更快了", Hex.Rgb(0xff7a4a));
        }

        protected override void OnWindup(float dt)
        {
            var q = Qilin;
            var f = Furnace;
            if (q)
            {
                q.SkyTarget = QilinBrain.HighAlt;
                if (f) q.FlyTo(q.PoolEdgeToward(Brain.PlayerPosition), 16f, 1.5f);
                else q.Hover();
                if (q.Effects) q.Effects.Eruption(0.3f + 0.5f * Mathf.Clamp01(StageT / Mathf.Max(0.05f, WindupTime)));
            }
            TurnToward(YawToPlayer, 115f, dt);
        }

        protected override void OnActiveBegin()
        {
            var q = Qilin;
            var f = Furnace;
            var c = f ? f.Center : OnFloor(Brain.transform.position);
            float start = f ? f.poolRadius : 4f, end = f ? f.wallRadius + 1f : 24f;
            Hazards.Wave(new BossWaveSpec(c, WaveSpeed, end, Dmg(WaveDamage), QilinDef.Warn)
            {
                startRadius = start, width = 1.1f, height = 0.95f, knockback = 7f, element = Element.Fire, dust = true, dustColor = QilinDef.Ember,
            });
            Waves++;
            if (q)
            {
                if (q.Effects) q.Effects.Burst();
                q.RageRoars++;
                if (q.Flood != null && f) q.Flood.Start(f.QuadrantOf(Brain.PlayerPosition), true);
            }
            Fx.Burst(c + Vector3.up * 1f, QilinDef.Fire, 60, 14f, 1.2f, 0.45f, 8f);
            GameAudio.PlayAt("explosion", c, 1f, 0.55f);
            Brain.Shake(0.8f, 0.6f);
        }

        protected override void OnActive(float dt)
        {
            if (Qilin) Qilin.Hover();
        }

        protected override void OnEnd(bool cancelled)
        {
            var q = Qilin;
            if (!q) return;
            if (q.Effects) q.Effects.Eruption(0);
            q.SkyTarget = QilinBrain.SkyAlt;
        }
    }
}
