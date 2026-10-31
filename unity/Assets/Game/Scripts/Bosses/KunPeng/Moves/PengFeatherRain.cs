using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 鹏 · 羽刃雨（Three.js KunPeng.ts 'rain'）：
    ///   前摇 0.9 s：拔高到 17 m、展翅（act_spread，片段里每枚羽刃一个 projectile 事件）；
    ///   出手：每 0.11 s 从两翼翼尖交替洒下一枚冰羽刃，共 10 枚（狂怒 14 枚）——前三枚瞄准玩家（预判 0.6 / 0.85 / 1.1 s），其余散落在玩家周围 2.5–9.5 m；
    ///     落点都夹在环台上、都有预警（危险物组：招式被打断后照常落地），1.05 s 后落地炸开（2.1 m、15 伤）；
    ///   收招 0.6 s：回到盘旋高度。
    /// 羽刃的外观先用冰块抛射（BossHazards.Lob 的 Ice，缩小、拱高很低——近乎直线斜落），等专门的羽刃特效时只改这里。
    /// 动作（第二批 A 路，docs/art/vfx/kunpeng.md 第 14 节）：三段手 K 片段——spread（前摇 0.9 s：上收 → 第 13 帧一记猛扇升空 flap → 展翅到洒羽的架势）
    /// → spreadShed（循环 13 帧 ≈ 4 枚：哪边出羽哪边翼尖往下一甩、身子往那边一歪，右左交替，和 <see cref="Fire"/> 的翼尖顺序一致）→ spreadEnd（收招 0.6 s：收翼回盘旋）。
    /// 羽刃仍按时间出（每 0.11 s 一枚，数量 / 落点不变）；片段里的 projectile 事件和它对齐在 1 帧以内。
    /// </summary>
    public sealed class PengFeatherRain : KunPengMove
    {
        public const string MoveId = "rain";
        public const int Feathers = 10, RageFeathers = 14;
        public const float Interval = 0.11f, Flight = 1.05f, Radius = 2.1f, RainAlt = 17f;

        public override string Id => MoveId;
        public override string Name => "鹏 · 羽刃雨";

        /// <summary>本次要洒几枚、已洒几枚；累计</summary>
        public int Count { get; private set; }
        public int Fired { get; private set; }
        public int TotalFired { get; private set; }

        public PengFeatherRain()
        {
            forms = new[] { KunPengDef.PengForm };
            cooldown = 9f;
            recovery = 1f;
            firstDelay = 5f;
            weight = 2f;
            windup = 0.9f;
            active = Feathers * Interval;
            recover = 0.6f;
        }

        protected override void OnStart()
        {
            Count = Brain.Enraged ? RageFeathers : Feathers;
            Fired = 0;
            if (KP)
            {
                KP.HoverAlt = RainAlt;
                KP.MovesSincePerch++;
            }
            // 前摇片段 0.9 s 播完接循环的振翅洒羽（spreadShed），收招时 spreadEnd
            Act("spread", WindupTime);
            CuedSfx("telegraph", 1f, 1.3f);
        }

        protected override void OnWindup(float dt)
        {
            KP?.Hover();
            Brain.Face(Brain.PlayerPosition, 115f, dt);
            // 升空那一记猛扇（片段 flap 事件，代理按时间）：身下一圈风环、风线、卷起的雪
            if (Cue("flap", 0.43f))
            {
                var c = Brain.BodyCenter;
                float floor = Hole.found ? Hole.FloorY : Brain.transform.position.y - (KP ? KP.HoverAlt : 13.5f);
                Fx.PengFlap(c, new Vector3(c.x, floor, c.z), Brain.transform.eulerAngles.y, 4.2f, false);
            }
        }

        protected override void OnRecoverBegin() => Act("spreadEnd", recover);

        protected override bool ActiveDone => Fired >= Count && StageT >= Count * Interval;

        protected override void OnActiveBegin() => Fire(Fired++);

        protected override void OnActive(float dt)
        {
            KP?.Hover();
            Brain.Face(Brain.PlayerPosition, 115f, dt);
            while (Fired < Count && StageT >= Fired * Interval) Fire(Fired++);
        }

        void Fire(int i)
        {
            var right = Brain.transform.right;
            var tip = i % 2 == 1
                ? BonePos("wing_L_3", Brain.BodyCenter - right * 3f)
                : BonePos("wing_R_3", Brain.BodyCenter + right * 3f);
            Vector3 target;
            if (i < 3) target = Brain.Predict(0.6f + i * 0.25f);
            else
            {
                float a = Rng.Range(0f, 360f), r = 2.5f + Rng.Range(0f, 7f);
                target = Brain.PlayerPosition + Dir(a) * r;
            }
            target = AtFloor(target);
            if (Hole.found) target = Hole.ClampToRing(target);
            Hazards.Lob(new BossLobSpec(tip, target, Flight, 1.5f, Radius, Dmg(15), KunPengDef.Warn, LobKind.Ice) { scale = 0.7f, look = LobLook.Feather });
            // 翼尖甩出羽刃的那一下：一记冰晶星芒 + 顺着出手方向一条短风线（羽刃破风）
            Fx.FrostGlint(tip, 1.2f);
            Fx.PengFeatherLaunch(tip, target);
            CountWarning();
            TotalFired++;
            if (i % 3 == 0) Sfx("enemy_shot", 0.5f, 1.3f);
        }

        protected override void OnRecover(float dt) => KP?.Hover();

        protected override void OnEnd(bool cancelled)
        {
            if (KP) KP.HoverAlt = KDef != null ? KDef.pengHover : 13.5f;
        }
    }
}
