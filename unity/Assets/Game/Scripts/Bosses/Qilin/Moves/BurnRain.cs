using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟 · 焚身 · 火云雨 + 神火飞鸦（TS Qilin 'rain'）：
    ///   升到 7.5 m 悬停长啸 0.7 s；然后顶上落下 10 颗火球（狂怒 14 颗，每 0.16 s 一颗）：前三颗砸玩家 0.5 / 0.75 / 1 s 后的位置，其余落在玩家身边 2.5–10.5 m，
    ///   每颗从落点上方 22 m 坠下 1.25 s、落点亮 2.4 m 预警圈，砸中 18（火）+ 掀开——看着地上的圈走位；
    ///   0.3 s 后高处排烟口飞出 4 只神火飞鸦（受首领召唤上限约束，<see cref="QilinBrain.SummonCrows"/>）——在空中打爆它们。
    /// </summary>
    public sealed class BurnRain : QilinMove
    {
        public const string MoveId = "burn_rain";
        /// <summary>火球数（狂怒）、间隔、坠落时长、落点半径、伤害（TS 原值，难度 1）、起落高度；召飞鸦的时刻（出手段内，秒）</summary>
        public const int Meteors = 10, MeteorsRage = 14;
        public const float Every = 0.16f, FallTime = 1.25f, Radius = 2.4f, Damage = 18f, Height = 22f, CrowsAt = 0.3f;

        public override string Id => MoveId;
        public override string Name => "火云雨";

        /// <summary>累计：放出的火球、召出的飞鸦</summary>
        public int MeteorsFired { get; private set; }
        public int Crows { get; private set; }

        public BurnRain()
        {
            cooldown = 13f;
            recovery = 1f;
            weight = 1.8f;
            firstDelay = 4f;
            windup = 0.7f;
            active = 1.9f;
            recover = 0;
            forms = new[] { QilinDef.BurnForm };
        }

        protected override void Prepare()
        {
            if (Qilin) Qilin.SkyTarget = QilinBrain.HighAlt;
        }

        protected override void OnTelegraph()
        {
            Brain.PlayAct("roar", WindupTime + active);
            Sfx("telegraph", 1f, 1.2f);
            Sfx("boss_roar", 0.7f, 1.1f);
        }

        protected override void OnWindup(float dt) => Hold(dt);

        protected override void OnActiveBegin() => FireRain();

        protected override void OnActive(float dt)
        {
            Hold(dt);
            if (StageAt(CrowsAt) && Qilin) Crows += Qilin.SummonCrows(QDef?.rainCrows ?? 4);
        }

        void Hold(float dt)
        {
            if (Qilin)
            {
                Qilin.SkyTarget = QilinBrain.HighAlt;
                Qilin.Hover();
            }
            TurnToward(YawToPlayer, 115f, dt);
        }

        /// <summary>顶上落火球（危险物时钟上排开；首领倒下 / 清场时还没落的取消）</summary>
        void FireRain()
        {
            int n = Brain.Enraged ? MeteorsRage : Meteors;
            float dmg = Dmg(Damage);
            var brain = Brain;
            var f = Furnace;
            float floor = Floor;
            for (int i = 0; i < n; i++)
            {
                int k = i;
                Hazards.Later(k * Every, () =>
                {
                    if (!brain || brain.Dead) return;
                    Vector3 to;
                    if (k < 3) to = brain.Predict(0.5f + k * 0.25f);
                    else
                    {
                        float a = Rng.Range(0f, 360f) * Mathf.Deg2Rad, r = 2.5f + Rng.Range(0f, 8f);
                        to = brain.PlayerPosition + new Vector3(Mathf.Sin(a) * r, 0, Mathf.Cos(a) * r);
                    }
                    to.y = floor;
                    if (f)
                    {
                        float max = f.wallRadius - 1f;
                        if (f.RadiusOf(to) > max) to = f.Point(f.YawOf(to), max);
                    }
                    var from = new Vector3(to.x + Rng.Range(-4f, 4f), floor + Height, to.z + Rng.Range(-4f, 4f));
                    Hazards.Lob(new BossLobSpec(from, to, FallTime, 1f, Radius, dmg, QilinDef.Warn, LobKind.Meteor) { element = Element.Fire, scale = 1.1f });
                    MeteorsFired++;
                });
            }
            CountWarning();
            Brain.Shake(0.3f, 0.4f);
            Sfx("boss_roar", 0.7f, 1.1f);
            Qilin?.Tell("rain", "火云雨——看地上的落点圈走位", Hex.Rgb(0xff9a4a));
        }

        protected override void OnEnd(bool cancelled)
        {
            if (Qilin) Qilin.SkyTarget = QilinBrain.SkyAlt;
        }
    }
}
