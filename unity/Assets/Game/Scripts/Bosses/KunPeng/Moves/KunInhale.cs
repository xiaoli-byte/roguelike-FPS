using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鲲 · 吞吸（Three.js KunPeng.ts 'inhale'，4.6 s）：
    ///   前摇 0.9 s：仰头张口（act_inhale，片段 3.9 s 一路吸到扑咬），口前亮一片 22 m、半角 35.5° 的扇形预警；
    ///   出手 3.0 s（0.9–3.9）：冰屑气流（<see cref="KunPengFx.Suction"/>），每 0.15 s 把扇形里（半角 43°、30 m 内）、看得见冰沿的玩家往口部拉一下
    ///     （冰柱 / 矮墙 / 祭台挡得住气流；冰窟边缘段不挡——气流从冰沿上方吹过来）；出手 2.2 s 时冰沿亮 5.5 m 的扑咬预警（0.8 s）；
    ///   收招 0.7 s（3.9–4.6）：一口咬在冰沿上（bite 片段接在 inhale 后面，hit 事件），被拉到冰沿的人吃重击并被甩开（32，击退 13 / 上抛 6）。
    /// 拉力：Three.js 每 0.18 s 一下 3.4 m/s × k；这里每 0.15 s 一下、最多 2.95 m/s（见 <see cref="KunPengDef.pullImpulse"/>），单位时间的拉力相同、不会一直失控。
    /// </summary>
    public sealed class KunInhale : KunPengMove
    {
        public const string MoveId = "inhale";
        public const float SectorRange = 22f, SectorHalf = 35.5f, PullHalf = 43f, PullReach = 30f, BiteRadius = 5.5f, BiteWarnAt = 2.2f;

        public override string Id => MoveId;
        public override string Name => "鲲 · 吞吸";

        /// <summary>本次拉了几下 / 被掩体挡住几下、扑咬打中没有；累计拉动（测试用）</summary>
        public int Pulses { get; private set; }
        public int BlockedPulses { get; private set; }
        public bool BiteHit { get; private set; }
        public int TotalPulses { get; private set; }
        /// <summary>最近一下拉动的方向（水平单位向量）</summary>
        public Vector3 LastPull { get; private set; }

        Vector3 mouth;
        float pullAcc;

        public KunInhale()
        {
            forms = new[] { KunPengDef.KunForm };
            cooldown = 11f;
            recovery = 1.2f;
            firstDelay = 2f;
            weight = 1.8f;
            windup = 0.9f;
            active = 3f;
            recover = 0.7f;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer > 14f ? 3f : 1.8f;

        protected override void OnStart()
        {
            if (KP) KP.AimKunAtPlayer(1f);
            mouth = KP ? KP.MouthPoint : Brain.BodyCenter;
            pullAcc = 0;
            Pulses = BlockedPulses = 0;
            BiteHit = false;
        }

        protected override void OnTelegraph()
        {
            float yaw = Brain.transform.eulerAngles.y;
            Hazards.SectorWarning(AtFloor(mouth), yaw, SectorHalf, SectorRange, WindupTime, KunPengDef.Warn);
            CountWarning();
            Act("inhale", WindupTime + active);
            CuedSfx("telegraph", 1f, 0.7f);
            Sfx("enemy_charge", 0.9f, 0.5f);
            KP?.TellOnce("inhale", "鲲在吞吸——离开它面前的扇形，或者躲到冰柱后面！", Hex.Rgb(0x8fe3ff));
        }

        protected override void OnWindup(float dt) => KP?.PlaceKun();

        protected override void OnActiveBegin()
        {
            KP?.HoleFx?.Suction(true, mouth, Brain.transform.eulerAngles.y);
            pullAcc = 0;
        }

        protected override void OnActive(float dt)
        {
            KP?.PlaceKun();
            float interval = KDef != null ? KDef.pullInterval : 0.15f;
            pullAcc += dt;
            while (pullAcc >= interval)
            {
                pullAcc -= interval;
                Pull();
            }
            if (StageAt(BiteWarnAt) && KP) WarnCircle(AtFloor(KP.BiteSpot), BiteRadius, Mathf.Max(0.2f, active - BiteWarnAt));
        }

        /// <summary>扇形里、气流够得着（没被掩体挡住）的玩家往口部拉一下</summary>
        void Pull()
        {
            var motor = KP ? KP.Motor : null;
            if (!motor || !PlayerFeet(out var feet)) return;
            var to = mouth - feet;
            to.y = 0;
            float d = to.magnitude;
            if (d < 0.5f || d > PullReach) return;
            float off = Mathf.Abs(Mathf.DeltaAngle(Brain.transform.eulerAngles.y, KunPengMath.Yaw(-to)));
            if (off > PullHalf) return;
            // 气流从冰沿上方吹过来：从咬点胸口高度连到玩家胸口，冰柱 / 矮墙 / 祭台挡住就不受影响
            var src = KP.BiteSpot + Vector3.up * 1.3f;
            if (KP.CoverBlocks(src, feet + Vector3.up * 1.2f))
            {
                BlockedPulses++;
                return;
            }
            float k = Mathf.Clamp(1.25f - d / 32f, 0.5f, 1.1f);
            float imp = (KDef != null ? KDef.pullImpulse : 2.95f) * k / 1.1f;
            LastPull = to / d;
            motor.AddImpulse(LastPull * imp);
            Pulses++;
            TotalPulses++;
        }

        protected override void OnRecoverBegin()
        {
            KP?.HoleFx?.Suction(false);
            if (!KP) return;
            var b = KP.BiteSpot + Vector3.up * 0.3f;
            int hits0 = Hazards.PlayerHits;
            Hazards.Blast(b, BiteRadius, Dmg(32), new BossBlastOpts { maxHeight = 4f, knockback = 13f, knockUp = 6f });
            BiteHit = Hazards.PlayerHits > hits0;
            Fx.Burst(b + Vector3.up, KunPengDef.Ice, 26, 9f, 0.8f, 0.35f, 10f);
            Brain.Shake(0.45f, 0.35f);
            CuedSfx("enemy_melee", 1f, 0.5f);
            Sfx("boss_slam", 0.6f, 1.2f);
        }

        protected override void OnRecover(float dt) => KP?.PlaceKun();

        protected override void OnEnd(bool cancelled)
        {
            KP?.HoleFx?.Suction(false);
            KP?.HoleFx?.SetAgitation(0.35f);
        }
    }
}
