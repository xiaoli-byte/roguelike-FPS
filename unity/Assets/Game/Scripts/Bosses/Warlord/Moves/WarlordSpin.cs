using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 魔将 · 回旋斩（剑士化 v2，设计单 §13.7；二阶段起）：拧腰把大剑拖到身后，原地转一整圈——以他为心 6.2 m 的圆形预警（0.8 s，狂怒 0.68 s × 0.9），
    /// 填满即斩：圈里挨 24、往外掀开。离开圆圈躲。
    /// 狂怒「回旋二连」：第一圈斩完不停，再转一圈甩出更远的一环——内圈 2.6 m 以内安全、外到 9 m（× 1.15），第一圈出手时画环形预警、0.48 s 后斩：
    /// 第一圈逼人往外跑，第二圈奖励贴身（射得爽：贴脸输出）。
    /// </summary>
    public sealed class WarlordSpin : WarlordSwordMove
    {
        public const string MoveId = "warlord_spin";
        public override string Id => MoveId;
        public override string Name => "魔将 · 回旋斩";

        public const float Radius = 6.2f, Inner2 = 2.6f, Outer2 = 9f;

        float w, gap, r1, outer2;
        bool twice, second;

        public int Spins { get; private set; }
        public int Hits { get; private set; }
        /// <summary>第二圈离第一圈多久（秒）</summary>
        public float LastGap => gap;

        public WarlordSpin()
        {
            cooldown = 7f;
            recovery = 1f;
            windup = 0.8f;
            recover = 0.1f;
            minPhase = 1;
        }

        public override float Weight(BossBrain b) => b.DistanceToPlayer < 7f ? 3.5f : 0.5f;

        /// <summary>二连：两圈之间的间隔（片段 spinTwice 两次出手在 18 / 54、32 / 54，整段按同一个倍率拉伸）</summary>
        public static float GapFor(float windupSeconds) => windupSeconds * (WarlordSword.SpinTwiceImpactAt / WarlordSword.SpinTwiceHitAt - 1f);

        protected override void OnStart()
        {
            twice = Fury;
            second = false;
            w = (twice ? 0.68f : 0.8f) * Brain.WindupScale;
            gap = twice ? GapFor(w) : 0f;
            r1 = Radius * Reach;
            outer2 = Outer2 * Reach;
            Brain.Halt();
            Act(twice ? "spinTwice" : "spin", twice ? w / WarlordSword.SpinTwiceHitAt : w / WarlordSword.SpinHitAt);
            Sfx("telegraph", 1f, 0.9f);
        }

        protected override void OnTelegraph() => WarnCircle(OnGround(Brain.transform.position), r1, w, WarlordSword.Warn);

        protected override bool WindupDone => StageT >= w;

        protected override void OnWindup(float dt)
        {
            Brain.Face(Brain.PlayerPosition, 120f, dt);
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, w)));
        }

        protected override void OnActiveBegin()
        {
            Spin(0);
            if (twice) Hazards.AnnulusWarning(OnGround(Brain.transform.position), Inner2, outer2, gap, WarlordSword.Warn);
        }

        protected override void OnActive(float dt)
        {
            Brain.Halt();
            if (!twice || second || StageT < gap) return;
            second = true;
            Spin(1);
        }

        protected override bool ActiveDone => (!twice || second) && StageT >= gap + 0.45f;

        void Spin(int k)
        {
            Spins++;
            var c = Brain.transform.position;
            bool hit = false;
            if (Player(out var feet, out float pr))
            {
                bool inside = k == 0 ? WarlordSword.InRing(c, 0f, r1, feet, pr, 2.2f) : WarlordSword.InRing(c, Inner2, outer2, feet, pr, 2.2f);
                if (inside)
                {
                    var away = feet - c;
                    away.y = 0;
                    away = away.sqrMagnitude > 0.01f ? away.normalized : Dir(Facing);
                    hit = Strike(Dmg(k == 0 ? 24 : 20), c + Vector3.up, away * 9f + Vector3.up * 4f);
                }
            }
            if (hit)
            {
                Hits++;
                Sfx("enemy_melee");
            }
            Sfx("skill_fire", 0.8f, k == 0 ? 0.9f : 1.1f);
            Brain.Glow(0, k == 0 && twice ? 1 : 0);
            if (LordFx is { } lord) lord.SpinStrike(k, twice, k == 0 ? r1 : outer2, k == 0 ? 0f : Inner2, hit);
            else
            {
                Fx.Slash(Brain.BodyCenter, Facing, (k == 0 ? r1 : outer2) * 0.7f, Mathf.PI * 2f, 1, 0, 0.7f, 0.3f, WarlordSword.Fire, true);
                Brain.Shake(0.4f, 0.3f);
            }
        }

        protected override void OnEnd(bool cancelled)
        {
            Brain.Halt();
            Brain.Glow(0, 0);
        }
    }
}
