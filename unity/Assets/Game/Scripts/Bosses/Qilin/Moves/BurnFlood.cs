using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟 · 焚身 · 熔流轮转（TS Qilin 'flood'）：换形后的第一招；之后熔流没在轮的时候按权重出（冷却 34 s，一轮约 32 s）。
    ///   长啸 2 s：飞到熔池上空靠玩家一侧 5.5 m 高（16 m/s，不钻进池心的熔岩柱）、对着玩家吼，熔岩柱翻涌；1.2 s 时开始一轮熔流（<see cref="QilinFlood"/>：
    ///   从玩家所在的象限起顺时针，每个象限预警 1.5 s → 夹着它的两条渠的外段涨宽到 4 m、6 s（狂怒 4 s）→ 退，地上先亮预警条带）。
    ///   熔流在招式结束后继续轮（首领照常出别的招），所以这一招本身只是开闸。
    /// </summary>
    public sealed class BurnFlood : QilinMove
    {
        public const string MoveId = "burn_flood";
        /// <summary>飞向池心的高度、速度；开闸时刻（秒，从出招算）</summary>
        public const float Alt = 5.5f, Speed = 16f, OpenAt = 1.2f;

        public override string Id => MoveId;
        public override string Name => "熔流轮转";

        /// <summary>累计开闸次数；本次开闸时玩家所在的象限</summary>
        public int Opened { get; private set; }
        public int FirstQuadrant { get; private set; } = -1;

        public BurnFlood()
        {
            cooldown = 34f;
            recovery = 0.6f;
            weight = 3f;
            firstDelay = 0;
            windup = 0.4f;
            active = 1.6f;
            recover = 0.1f;
            forms = new[] { QilinDef.BurnForm };
        }

        /// <summary>熔流还在轮的时候不出</summary>
        public override float Weight(BossBrain b) => b is QilinBrain q && q.Flood != null && q.Flood.Active ? 0 : weight;

        protected override void Prepare()
        {
            FirstQuadrant = -1;
            if (Qilin) Qilin.SkyTarget = Alt;
        }

        protected override void OnTelegraph()
        {
            Brain.PlayAct("roar", WindupTime + active);
            Sfx("boss_roar", 1f, 0.7f);
            Qilin?.Tell("flood", "熔岩溢进四条渠——渠会顺时针轮流涨宽，淹掉一个象限的外侧，看地上的预警条带！", Hex.Rgb(0xff9a4a));
        }

        protected override void OnWindup(float dt) => Hold(dt);

        protected override void OnActive(float dt) => Hold(dt);

        void Hold(float dt)
        {
            var q = Qilin;
            var f = Furnace;
            if (q)
            {
                q.SkyTarget = Alt;
                if (f) q.FlyTo(q.PoolEdgeToward(Brain.PlayerPosition), Speed, 1.5f);
                else q.Hover();
                if (q.Effects) q.Effects.Eruption(T < 1.6f ? 0.45f : 0);
            }
            TurnToward(YawToPlayer, 115f, dt);
            if (!At(OpenAt) || !q || q.Flood == null || !f) return;
            FirstQuadrant = f.QuadrantOf(Brain.PlayerPosition);
            if (!q.Flood.Start(FirstQuadrant)) return;
            Opened++;
            // 熔流的两条预警条带由 QilinFlood 画在危险物组里（招式结束不撤回）
            CountWarning();
            CountWarning();
            Brain.Shake(0.4f, 0.5f);
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
