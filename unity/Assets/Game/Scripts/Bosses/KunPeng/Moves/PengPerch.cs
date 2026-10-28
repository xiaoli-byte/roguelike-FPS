using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鹏 · 落台歇翼（Three.js KunPeng.ts 'perch'；二阶段的主要输出窗口）：飞累了（上次歇翼后出过两招）才出。
    ///   前摇（接近 ≤ 3 s + 下降 0.9 s）：挑落台点（<see cref="PickSpot"/>：玩家所在方位往一侧偏 31.5–63° 的环台中线，优先脚下整个碰撞方块都是平地的点——
    ///     东西两座 2.5 m 祭台和冰柱都不落；实在找不到平地就按实际落脚高度结算），以 9 m（飞越冰窟时 11.5 m）飞过去；到了就地垂直落下、收住冲过头的速度，
    ///     落点亮 5 m 的预警（0.9 s）；
    ///   出手 4.8 s：落地冲击（18，击退 9）+ 一圈 11 m 的冰浪（10）；收翼歇着（act_perch），额头的鲛珠离地近、大亮；4.0 s 时脚下亮 7 m 的起飞预警（0.8 s）；
    ///   收招 0.8 s：起飞翼风冲击（7 m、14 伤、击退 13），回到盘旋高度（act_takeoff）。
    /// </summary>
    public sealed class PengPerch : KunPengMove
    {
        public const string MoveId = "perch";
        public const float ApproachAlt = 9f, ApproachMax = 3f, DescendSeconds = 0.9f, RestSeconds = 4.8f, TakeoffWarnAt = 4f, LandRadius = 5f, TakeoffRadius = 7f;

        enum Sub { Approach, Descend }

        public override string Id => MoveId;
        public override string Name => "鹏 · 落台歇翼";

        /// <summary>本次的落点（y = 实际落脚高度）、是否落在平地、落地冲击打中没有（测试用）</summary>
        public Vector3 Spot { get; private set; }
        public bool SpotFlat { get; private set; }
        public bool Landed { get; private set; }

        Sub sub;
        float subT;

        public PengPerch()
        {
            forms = new[] { KunPengDef.PengForm };
            cooldown = 14f;
            recovery = 0.6f;
            firstDelay = 10f;
            weight = 3.4f;
            windup = ApproachMax + DescendSeconds;
            active = RestSeconds;
            recover = 0.8f;
        }

        public override float Weight(BossBrain b) => b is KunPengBrain kp && kp.MovesSincePerch >= 2 ? weight : 0;

        /// <summary>
        /// 落台点（Three.js pickPerchSpot）：玩家方位 base、随机一侧 side、首个偏角 first（31.5–63°），依次试 first、first + 20、first − 17、first + 40、−first、−first − 20、
        /// first + 63、−first + 17 处的环台中线（贴到 3 m 内的导航网格）；脚印（身体半径 × 0.85 + 0.3）范围内最高的地面离环台地面不到 0.3 m 就用它，都不平就用第一个
        /// </summary>
        public Vector3 PickSpot(out bool flat)
        {
            var kp = KP;
            float baseYaw = Hole.Angle(Brain.PlayerPosition);
            int side = Rng.Sign();
            float first = Rng.Range(31.5f, 63f);
            float foot = Brain.BodyRadius * 0.85f + 0.3f;
            float[] tries = { first, first + 20f, first - 17.2f, first + 40.1f, -first, -first - 20f, first + 63f, -first + 17.2f };
            Vector3? fallback = null;
            foreach (float off in tries)
            {
                var p = Hole.Point(baseYaw + side * off, Hole.MidRing);
                if (NavMesh.SamplePosition(p, out var hit, 3f, NavMesh.AllAreas)) p = hit.position;
                float top = kp ? kp.GroundUnder(p, foot) : Floor;
                var spot = new Vector3(p.x, Mathf.Max(top, Floor), p.z);
                fallback ??= spot;
                if (top - Floor < 0.3f)
                {
                    flat = true;
                    return spot;
                }
            }
            flat = false;
            return fallback ?? AtFloor(Hole.Point(baseYaw + side * first, Hole.MidRing));
        }

        protected override void OnStart()
        {
            sub = Sub.Approach;
            subT = 0;
            Landed = false;
            Spot = PickSpot(out bool flat);
            SpotFlat = flat;
            if (KP)
            {
                KP.HoverAlt = Mathf.Max(ApproachAlt, KP.OverHoleAlt(ApproachAlt));
                KP.Accel = 30f;
            }
        }

        protected override bool WindupDone => false;

        protected override void OnWindup(float dt)
        {
            subT += dt;
            var kp = KP;
            if (sub == Sub.Approach)
            {
                if (kp) kp.HoverAlt = kp.OverHoleAlt(ApproachAlt);
                bool arrived = !kp || kp.FlyTo(Spot, 16f, 1.2f);
                Brain.Face(Spot, 172f, dt);
                if (!arrived && subT <= ApproachMax) return;
                sub = Sub.Descend;
                subT = 0;
                // 离落点不远时就地落下；落地冲击按脚下实际的地面高度结算
                var p = Brain.transform.position;
                var s = Spot;
                if (new Vector2(p.x - s.x, p.z - s.z).magnitude < 2.5f)
                {
                    s.x = p.x;
                    s.z = p.z;
                }
                s.y = kp ? Mathf.Max(Floor, kp.GroundUnder(s)) : Floor;
                Spot = s;
                if (kp)
                {
                    kp.HoverAlt = s.y - Floor;
                    var v = kp.FlyVelocity;
                    kp.SetFlyVelocity(new Vector3(v.x * 0.25f, v.y, v.z * 0.25f));
                }
                Hazards.GroundWarning(Spot, LandRadius, DescendSeconds, KunPengDef.Warn);
                CountWarning();
                Sfx("telegraph", 1f, 0.9f);
                return;
            }
            Brain.Face(Brain.PlayerPosition, 115f, dt);
            kp?.FlyTo(Spot, 6f, 0.3f);
            if (subT >= DescendSeconds) EndWindup();
        }

        protected override void OnActiveBegin()
        {
            var kp = KP;
            var p = Brain.transform.position;
            Spot = new Vector3(p.x, kp ? Mathf.Max(Floor, kp.GroundUnder(p)) : Floor, p.z);
            Landed = true;
            if (kp)
            {
                kp.Perched = true;
                kp.PearlBright = true;
                kp.HoverAlt = Spot.y - Floor;
                kp.MovesSincePerch = 0;
            }
            Act("perch", 2.4f);
            Hazards.Blast(Spot, LandRadius, Dmg(18), new BossBlastOpts { maxHeight = 3f, knockback = 9f, knockUp = 4f });
            Hazards.Wave(new BossWaveSpec(Spot, 12f, 11f, Dmg(10), KunPengDef.Warn)
            {
                startRadius = 3f, width = 0.9f, height = 0.8f, knockback = 6f, dust = true, dustColor = KunPengDef.Ice,
            });
            Brain.Shake(0.55f, 0.4f);
            Fx.Burst(Spot + Vector3.up * 0.5f, KunPengDef.Ice, 30, 9f, 0.9f, 0.4f, 12f);
            // 落台：冰刺环 + 一圈往外推的雪浪（整圈弧幕，和冲击波同速）
            Fx.IceRing(Spot, LandRadius, 14);
            Surge.Sheet(Spot, 0, 3f, 360f, 1.4f, SurgeKind.Water, 0.12f, 0.55f, 0.3f, new Color(0.7f, 0.85f, 0.96f), Color.white, 2.4f, 0.8f, grow: 1f + 11f / 3f);
            CuedSfx("boss_slam", 1f, 0.9f);
            KP?.TellOnce("perch", "鹏落台歇翼——趁现在打它额头的鲛珠！", Hex.Rgb(0xffe08a));
        }

        protected override void OnActive(float dt)
        {
            KP?.Hover();
            Brain.Face(Brain.PlayerPosition, 46f, dt);
            if (!StageAt(TakeoffWarnAt)) return;
            Hazards.GroundWarning(Spot, TakeoffRadius, Mathf.Max(0.2f, RestSeconds - TakeoffWarnAt), KunPengDef.Warn);
            CountWarning();
            Sfx("telegraph", 1f, 1.1f);
        }

        protected override void OnRecoverBegin()
        {
            Act("takeoff", recover);
            Hazards.Blast(Spot, TakeoffRadius, Dmg(14), new BossBlastOpts { maxHeight = 4f, knockback = 13f, knockUp = 5f });
            Fx.Ring(Spot + Vector3.up * 0.1f, 8f, KunPengDef.Gust, 0.6f);
            Fx.Burst(Spot + Vector3.up, KunPengDef.Ice, 26, 10f, 0.8f, 0.4f, 4f);
            // 振翅起飞：翅下压出一圈贴地旋转的雪风
            Surge.Annulus(Spot + Vector3.up * 0.2f, TakeoffRadius * 0.4f, TakeoffRadius * 1.2f, SurgeKind.Water, 0.9f, 320f, 2f, new Color(0.75f, 0.88f, 0.98f), Color.white, 0.55f);
            Fx.FrostVapour(Spot + Vector3.up * 0.5f, 2.2f, FrostPalette.Snow);
            CuedSfx("boss_roar", 0.8f, 1.3f);
            if (!KP) return;
            KP.Perched = false;
            KP.PearlBright = false;
            KP.HoverAlt = KDef != null ? KDef.pengHover : 13.5f;
        }

        protected override void OnRecover(float dt) => KP?.Hover();

        protected override void OnEnd(bool cancelled)
        {
            if (!KP) return;
            KP.Perched = false;
            KP.PearlBright = false;
            KP.Accel = KDef != null ? KDef.pengAccel : 22f;
            if (!KP.Staggered) KP.HoverAlt = KDef != null ? KDef.pengHover : 13.5f;
            if (Landed) KP.MovesSincePerch = 0;
        }
    }
}
