using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟 · 玄鳞 · 麟火（TS Qilin 'breath'）：玩家在 15 m 以内才出。
    ///   前摇 0.8 s：转向玩家、张口，面前扇形预警（半角 24°、14 m）；
    ///   出手 1.6 s：短距离吐火，口部朝玩家慢慢转（28.6°/s），每 0.15 s 判一次：在扇形里、口到玩家胸口不被挡（石柱挡得住）→ 6（火）。
    /// 焚身的占位吐息（<see cref="BurnPlaceholderBreath"/>）继承它，只改 id / 形态 / 距离。
    /// </summary>
    public class ScaleBreath : QilinMove
    {
        public const string MoveId = "breath";
        public const float HalfAngle = 24f, Range = 14f, TurnRate = 28.6f, TickEvery = 0.15f, TickDamage = 6f;

        public override string Id => MoveId;
        public override string Name => "麟火";

        /// <summary>累计：判定次数、烧到玩家、玩家在扇形里却被挡住</summary>
        public int Ticks { get; private set; }
        public int Hits { get; private set; }
        public int Blocked { get; private set; }

        /// <summary>多近才出（米）</summary>
        protected float maxDistance = 15f;

        float acc, fxAcc, yaw;

        public ScaleBreath()
        {
            cooldown = 7f;
            recovery = 0.9f;
            weight = 2.4f;
            firstDelay = 1.5f;
            windup = 0.8f;
            active = 1.6f;
            recover = 0.3f;
            forms = new[] { QilinDef.XuanForm };
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer < maxDistance ? weight : 0;

        protected override void Prepare()
        {
            Brain.Halt();
            yaw = YawToPlayer;
            SetFacing(yaw);
            acc = fxAcc = 0;
        }

        protected Vector3 MouthGround => OnFloor(Qilin ? Qilin.MouthPoint : Brain.BodyCenter + Brain.transform.forward * 2f);

        protected override void OnTelegraph()
        {
            Hazards.SectorWarning(MouthGround, yaw, HalfAngle, Range, WindupTime, QilinDef.Warn);
            CountWarning();
            Brain.PlayAct("breath", WindupTime + active);
            Sfx("enemy_charge", 0.9f, 0.6f);
        }

        protected override void OnWindup(float dt) => Brain.Halt();

        protected override void OnActiveBegin() => Sfx("skill_fire", 0.9f, 0.7f);

        protected override void OnActive(float dt)
        {
            Brain.Halt();
            yaw = Mathf.MoveTowardsAngle(yaw, YawToPlayer, TurnRate * dt);
            SetFacing(yaw);
            BreatheAlong(yaw, dt);
        }

        /// <summary>沿 yaw 吐火：火焰粒子 + 每 0.15 s 判定一次（扇形、射程、口到玩家胸口不被挡）</summary>
        void BreatheAlong(float yawDeg, float dt)
        {
            var mouth = Qilin ? Qilin.MouthPoint : Brain.BodyCenter + Brain.transform.forward * 2f;
            var d = Dir(yawDeg);
            fxAcc += dt;
            if (fxAcc >= 0.05f)
            {
                fxAcc = 0;
                for (int i = 1; i <= 3; i++)
                {
                    float along = Range * i / 3.5f;
                    var p = mouth + d * along;
                    p.y = Mathf.Lerp(mouth.y, Floor + 0.8f, i / 3f);
                    Fx.Burst(p, i == 1 ? QilinDef.Hot : QilinDef.Fire, 3, 2.5f, 0.35f, 0.25f + 0.2f * i, 1.5f);
                }
            }
            acc += dt;
            if (acc < TickEvery) return;
            acc = 0;
            Ticks++;
            if (!PlayerFeet(out var feet)) return;
            var m = OnFloor(mouth);
            var off = feet - m;
            off.y = 0;
            if (off.magnitude > Range || Mathf.Abs(Mathf.DeltaAngle(yawDeg, Mathf.Atan2(off.x, off.z) * Mathf.Rad2Deg)) > HalfAngle) return;
            var chest = feet + Vector3.up * 1.2f;
            if (!Combat.LineClear(mouth, chest))
            {
                Blocked++;
                return;
            }
            if (Hazards.Hurt(Dmg(TickDamage), Element.Fire, mouth) > 0) Hits++;
        }
    }
}
