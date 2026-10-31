using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟 · 焚身 · 火云雨 + 神火飞鸦（TS Qilin 'rain'）：
    ///   升到 7.5 m 悬停长啸 0.7 s；然后顶上落下 10 颗火球（狂怒 14 颗，每 0.16 s 一颗）：前三颗砸玩家 0.5 / 0.75 / 1 s 后的位置，其余落在玩家身边 2.5–10.5 m，
    ///   每颗从落点上方 22 m 坠下 1.25 s、落点亮 2.4 m 预警圈，砸中 18（火）+ 掀开——看着地上的圈走位；
    ///   落点圈在长啸（前摇）一开始就全部亮出，放出前跟着玩家挪、放出那一刻锁定（落点规则不变）；
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

        /// <summary>每颗火球的落点预警（前摇一开始就画，跟着玩家挪，放出那一刻锁定）、随机落点的方位 / 距离、是否已放出</summary>
        readonly List<TelegraphHandle> marks = new(MeteorsRage);
        readonly List<Vector2> offsets = new(MeteorsRage);
        readonly List<bool> launched = new(MeteorsRage);

        /// <summary>
        /// 前摇一开始就把每颗火球的落点圈画出来（D21 整改：原来出手后才逐颗画，前摇里地上什么都没有）：
        /// 落点照原规则在放出那一刻才定（前三颗砸玩家的预判位置，其余在玩家身边），所以放出前圈跟着玩家挪；预警时长 = 到落地的总时长
        /// </summary>
        protected override void OnTelegraph()
        {
            Brain.PlayAct("roar", WindupTime + active);
            Sfx("telegraph", 1f, 1.2f);
            Sfx("boss_roar", 0.7f, 1.1f);
            Cloud(WindupTime + active + FallTime + 0.6f);
            marks.Clear();
            offsets.Clear();
            launched.Clear();
            int n = Brain.Enraged ? MeteorsRage : Meteors;
            for (int k = 0; k < n; k++)
            {
                offsets.Add(k < 3 ? Vector2.zero : new Vector2(Rng.Range(0f, 360f) * Mathf.Deg2Rad, 2.5f + Rng.Range(0f, 8f)));
                launched.Add(false);
                marks.Add(Hazards.AimWarning(TargetFor(Brain, Furnace, Floor, k), Radius, WindupTime + k * Every + FallTime, QilinDef.Warn));
            }
            CountWarning();
        }

        /// <summary>第 k 颗此刻放出的落点：前三颗砸玩家 0.5 / 0.75 / 1 s 后的位置，其余在玩家身边 2.5–10.5 m；夹在殿墙内 1 m</summary>
        Vector3 TargetFor(BossBrain brain, QilinFurnace f, float floor, int k)
        {
            Vector3 to;
            if (k < 3 || k >= offsets.Count) to = brain.Predict(0.5f + Mathf.Min(k, 2) * 0.25f);
            else
            {
                float a = offsets[k].x, r = offsets[k].y;
                to = brain.PlayerPosition + new Vector3(Mathf.Sin(a) * r, 0, Mathf.Cos(a) * r);
            }
            to.y = floor;
            if (f)
            {
                float max = f.wallRadius - 1f;
                if (f.RadiusOf(to) > max) to = f.Point(f.YawOf(to), max);
            }
            return to;
        }

        /// <summary>还没放出的火球：落点圈跟着玩家挪</summary>
        void TrackMarks()
        {
            var f = Furnace;
            float floor = Floor;
            for (int k = 0; k < marks.Count; k++)
                if (!launched[k] && marks[k].Alive)
                    marks[k].MoveTo(TargetFor(Brain, f, floor, k));
        }

        protected override void OnWindup(float dt)
        {
            Hold(dt);
            TrackMarks();
        }

        protected override void OnActiveBegin() => FireRain();

        /// <summary>
        /// 火云：殿顶一圈环形的暗紫褐火云带 + 下面挂着的大火云团（<see cref="Fx.QilinFireClouds"/>）。Q 路：原来是两张整片旋转的圆盘，第一人称一抬头整屏都是橙色的星形火盘、
        /// 落下来的火球反而看不见；改成中间空着的环带，火球从云带内沿落下来
        /// </summary>
        void Cloud(float seconds)
        {
            var f = Furnace;
            var c = f ? f.Center : OnFloor(Brain.transform.position);
            Fx.QilinFireClouds(c, f ? f.wallRadius : 18f, seconds);
        }

        protected override void OnActive(float dt)
        {
            Hold(dt);
            TrackMarks();
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
            var hz = Hazards;
            // 火球已经排上危险物时钟（招式收招后照样落）：落点圈从招式组转进危险物组，招式结束不撤
            // 前摇比估计的长 / 短时，按「第 k 颗放出 + 坠落」重新计时，填满那一刻正好落地
            for (int k = 0; k < marks.Count; k++)
            {
                marks[k].Retime(k * Every + FallTime);
                hz.Commit(marks[k]);
            }
            for (int i = 0; i < n; i++)
            {
                int k = i;
                hz.Later(k * Every, () =>
                {
                    if (!brain || brain.Dead) return;
                    // 狂怒时可能比前摇里画的多（前摇开始时还没狂怒）：多出来的那几颗现在才定随机落点、放出时自己画预警
                    while (offsets.Count <= k) offsets.Add(new Vector2(Rng.Range(0f, 360f) * Mathf.Deg2Rad, 2.5f + Rng.Range(0f, 8f)));
                    var to = TargetFor(brain, f, floor, k);
                    var from = new Vector3(to.x + Rng.Range(-4f, 4f), floor + Height, to.z + Rng.Range(-4f, 4f));
                    var mark = k < marks.Count && !launched[k] ? marks[k] : TelegraphHandle.None;
                    if (k < launched.Count) launched[k] = true;
                    hz.Lob(new BossLobSpec(from, to, FallTime, 1f, Radius, dmg, QilinDef.Warn, LobKind.Meteor) { element = Element.Fire, scale = 1.1f, look = LobLook.Fireball }, mark);
                    MeteorsFired++;
                });
            }
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
