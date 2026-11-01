using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 魔将 · 焰刃连斩（剑士化 v2，设计单 §13.3）：贴身三到五刀，左右交替，末刀双手下劈；节奏「快、快、顿、重」，不是匀速。
    ///   · 一阶段（教招）：袈裟 → 逆袈裟 →（顿）→ 下劈，三刀；
    ///   · 二阶段：袈裟 → 逆袈裟 → 上挑（把人挑起来）→ 下劈，四刀——上挑接下劈；
    ///   · 狂怒：袈裟 → 逆袈裟 → 袈裟 → 上挑 → 下劈，五刀，每刀前摇压到 0.36–0.44 s，熔铜长刃射程 × 1.15。
    /// 每刀在前摇开始时画预警、起这一刀的动作（片段按刀到在第 15 / 25 帧拉伸到这一刀的前摇）：袈裟 / 逆袈裟 / 上挑是短扇形（预警 = 判定），
    /// 下劈是往前的一条长条（刀落处崩开的裂地线）。袈裟、逆袈裟之后小幅前冲。
    /// </summary>
    public sealed class WarlordBladeCombo : WarlordSwordMove
    {
        public const string MoveId = "warlord_combo";
        public override string Id => MoveId;
        public override string Name => "魔将 · 焰刃连斩";

        /// <summary>袈裟（右上 → 左下）/ 逆袈裟（左下 → 右上）/ 上挑 / 下劈</summary>
        public enum Stroke { Kesa, Gyaku, Rise, Cleave }

        /// <summary>一刀：warn = 画预警、起动作（相对整招，秒）；strike = 刀到</summary>
        public readonly struct Beat
        {
            public readonly Stroke stroke;
            public readonly float warn, strike;

            public Beat(Stroke s, float warn, float strike)
            {
                stroke = s;
                this.warn = warn;
                this.strike = strike;
            }

            public float Windup => strike - warn;
        }

        static readonly Beat[] P0 = { new(Stroke.Kesa, 0f, 0.5f), new(Stroke.Gyaku, 0.68f, 1.14f), new(Stroke.Cleave, 1.38f, 1.98f) };
        static readonly Beat[] P1 = { new(Stroke.Kesa, 0f, 0.46f), new(Stroke.Gyaku, 0.62f, 1.04f), new(Stroke.Rise, 1.2f, 1.62f), new(Stroke.Cleave, 1.8f, 2.3f) };
        static readonly Beat[] P2 =
        {
            new(Stroke.Kesa, 0f, 0.38f), new(Stroke.Gyaku, 0.52f, 0.88f), new(Stroke.Kesa, 1.02f, 1.38f), new(Stroke.Rise, 1.52f, 1.9f), new(Stroke.Cleave, 2.06f, 2.5f),
        };

        /// <summary>某阶段（狂怒 = 2）的刀序与节奏</summary>
        public static Beat[] Plan(int phase) => phase >= 2 ? P2 : phase >= 1 ? P1 : P0;

        /// <summary>每一刀的 Animator 状态名</summary>
        public static string StateOf(Stroke s) => s switch
        {
            Stroke.Kesa => "slashA",
            Stroke.Gyaku => "slashB",
            Stroke.Rise => "slashUp",
            _ => "slashC",
        };

        /// <summary>袈裟 / 逆袈裟扇形（半径、半角）、上挑扇形、下劈长条（一阶段 / 之后的长度、半宽）</summary>
        public const float SlashRange = 4.8f, SlashHalf = 52f, RiseRange = 4.4f, RiseHalf = 40f, CleaveLen0 = 9f, CleaveLen = 11f, CleaveHalfWidth = 1.25f;

        Beat[] plan;
        float[] yaws;
        Vector3[] origins;
        int warned, struck, planPhase;
        float lungeUntil = -1f, reach = 1f;

        public int Hits { get; private set; }
        /// <summary>这一招出了几刀（测试用）</summary>
        public int Struck => struck;
        public int Count => plan?.Length ?? 0;

        public WarlordBladeCombo()
        {
            cooldown = 3.5f;
            recovery = 0.9f;
            windup = 0.5f;
            recover = 0.1f;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer < 5.5f ? 6f : b.Phase >= 1 && b.DistanceToPlayer < 7f ? 1.5f : 0f;

        protected override void OnStart()
        {
            // 狂怒、射程在出招那一刻定下来（招式中途越过 20% 也不改这一套的预警 / 判定）
            planPhase = Fury ? 2 : Phase;
            reach = Reach;
            plan = Plan(planPhase);
            yaws = new float[plan.Length];
            origins = new Vector3[plan.Length];
            warned = struck = 0;
            lungeUntil = -1f;
            Brain.Halt();
            Sfx("telegraph", 1f, 1.1f);
        }

        protected override void OnTelegraph() => Warn();

        void Warn()
        {
            int k = warned++;
            var b = plan[k];
            yaws[k] = YawToPlayer;
            origins[k] = Brain.transform.position;
            var ground = OnGround(origins[k]);
            if (b.stroke == Stroke.Cleave)
                Hazards.LineWarning(ground, yaws[k], CleaveLength, CleaveHalfWidth, b.Windup, WarlordSword.Warn);
            else
            {
                bool rise = b.stroke == Stroke.Rise;
                Hazards.SectorWarning(ground, yaws[k], rise ? RiseHalf : SlashHalf, (rise ? RiseRange : SlashRange) * reach, b.Windup, WarlordSword.Warn);
            }
            Act(StateOf(b.stroke), b.Windup / WarlordSword.SlashHitAt);
            Brain.Glow(0, 1);
        }

        float CleaveLength => (planPhase >= 1 ? CleaveLen : CleaveLen0) * reach;

        protected override bool WindupDone => T >= plan[0].strike;

        protected override void OnWindup(float dt) => TurnToward(yaws[0], 570f, dt);

        protected override void OnActiveBegin() => Hit();

        protected override void OnActive(float dt)
        {
            float t = T;
            if (warned < plan.Length && t >= plan[warned].warn) Warn();
            if (struck < warned && t >= plan[struck].strike) Hit();
            if (warned > struck) TurnToward(yaws[warned - 1], 570f, dt);
            if (Time.time < lungeUntil && Brain.DistanceToPlayer > 2.4f) Brain.MoveToward(Brain.transform.position + Dir(Facing) * 2f, 1.1f);
            else Brain.Halt();
        }

        protected override bool ActiveDone => struck >= plan.Length && T >= plan[^1].strike + 0.45f;

        void Hit()
        {
            int k = struck++;
            var b = plan[k];
            float yaw = yaws[k];
            var o = origins[k];
            var fwd = Dir(yaw);
            bool hit = false;
            if (Player(out var feet, out float pr))
            {
                bool inside = b.stroke switch
                {
                    Stroke.Cleave => WarlordSword.InLane(o, fwd, CleaveLength, CleaveHalfWidth, feet, pr, 3f),
                    Stroke.Rise => WarlordSword.InSector(o, yaw, RiseHalf, RiseRange * reach, feet, pr, 3.4f),
                    _ => WarlordSword.InSector(o, yaw, SlashHalf, SlashRange * reach, feet, pr, 3.4f),
                };
                if (inside)
                    hit = b.stroke switch
                    {
                        Stroke.Cleave => Strike(Dmg(24), o + Vector3.up, fwd * 9f + Vector3.up * 4f),
                        // 上挑：把人挑起来（接下劈）
                        Stroke.Rise => Strike(Dmg(12), o + Vector3.up, fwd * 3f + Vector3.up * 8.5f),
                        _ => Strike(Dmg(18), o + Vector3.up, fwd * 7f + Vector3.up * 3f),
                    };
            }
            if (hit)
            {
                Hits++;
                Brain.Shake(0.3f, 0.2f);
                Sfx("enemy_melee");
            }
            else Sfx("enemy_melee", 0.8f, 0.75f);
            if (b.stroke is Stroke.Kesa or Stroke.Gyaku) lungeUntil = Time.time + 0.14f;
            Brain.Glow(0, 0);
            if (LordFx is { } lord)
            {
                lord.BladeStroke(StateOf(b.stroke), k, plan.Length, yaw, hit, b.stroke == Stroke.Cleave ? CleaveLength : 0f);
                return;
            }
            // 样机 / 对照：通用刀光
            Fx.Slash(Brain.BodyCenter, yaw, SlashRange * 0.8f, SlashHalf * 2f * Mathf.Deg2Rad, k % 2 == 0 ? 1 : -1, b.stroke == Stroke.Cleave ? -Mathf.PI * 0.5f : 0f,
                0.6f, 0.25f, WarlordSword.Fire, true);
        }

        protected override void OnEnd(bool cancelled)
        {
            Brain.Halt();
            Brain.Glow(0, 0);
        }
    }
}
