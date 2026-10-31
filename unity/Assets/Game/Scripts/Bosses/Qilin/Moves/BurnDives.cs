using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟 · 焚身 · 踏云俯冲（TS Qilin 'dives'）：连踏三次，三次之后排上落地喘息（<see cref="BurnPant"/>，二阶段主要的输出窗口）。每一次：
    ///   飞到玩家头顶：落点 = 玩家 0.5 s 后的位置（夹在殿墙内 2.5 m、推开石柱 / 倒鼎），升到 7.5 m、22 m/s 飞过去（≤ 1.4 s）；
    ///   蓄势 0.9 s（狂怒 0.7 s）：悬在落点正上方蜷身（tuck），落点亮 4.2 m 预警圈——走出圈子；
    ///   俯冲 0.3 s 砸下：4.2 m 内 30（火）+ 掀飞，炸出一圈贴地火环（13 m/s 扩到 15 m，16（火）+ 击退，跳起来躲；被落点砸中的这一下火环不再打）；
    ///   落地收势 0.45 s，然后下一次。
    /// 位移：飞的段落走踏云积分（<see cref="QilinBrain.FlyTo"/>），俯冲一段直接驱动位置（<see cref="QilinBrain.SkyPlace"/>）。
    /// 手感：落点只在起飞那一刻定一次、不追踪；预警圈填满的那一刻正好砸到。
    /// Q 路（2026-10-31，docs/art/vfx/qilin.md「踏云俯冲」）：蓄势是手 K 片段 tuck（收腿 → 蜷成一团、弓背低头盯着落点、尾巴 S 形卷起），火星往胸口吸（<see cref="Fx.QilinGather"/>）；
    /// 俯冲是 stomp（反向预备 → 伸展拖影 → 第 12 / 26 帧前蹄砸地），片段按「砸到的时刻 / 0.4615」拉伸，砸地姿势正好落在 0.3 s 的落地帧上；
    /// 落地是白热芯一闪 + 一圈火云团贴地滚出去（<see cref="Fx.QilinCloudImpact"/>，祥云化火云），装饰性的 8 m 环去掉了（真正要跳的是火环）。
    /// </summary>
    public sealed class BurnDives : QilinMove
    {
        public const string MoveId = "burn_dives";
        public const int Count = 3;
        /// <summary>飞向落点的速度、最长用时；蓄势（狂怒）、俯冲、落地收势（秒）</summary>
        public const float RiseSpeed = 22f, RiseMax = 1.4f, Tele = 0.9f, TeleRage = 0.7f, DiveTime = 0.3f, LandRecover = 0.45f;
        /// <summary>落点预判、落点半径、火环速度 / 半径、伤害（TS 原值，难度 1）</summary>
        public const float Lead = 0.5f, Radius = 4.2f, RingSpeed = 13f, RingRadius = 15f, BlastDamage = 30f, RingDamage = 16f;

        public enum Leg { Rise, Tele, Dive, Recover, Done }

        /// <summary>stomp 片段里砸地那一帧的归一化时刻（qilin_anims.py：第 12 / 26 帧）</summary>
        public const float StompHitAt = 12f / 26f;

        public override string Id => MoveId;
        public override string Name => "踏云俯冲";

        public Leg Phase { get; private set; } = Leg.Done;
        /// <summary>本次第几踏（0 起）、本次的落点；累计：落地次数、落点砸中玩家次数</summary>
        public int DiveIndex { get; private set; }
        public Vector3 Target { get; private set; }
        public int Landings { get; private set; }
        public int BlastHits { get; private set; }

        float legT;
        Vector3 diveFrom;

        public BurnDives()
        {
            cooldown = 10f;
            recovery = 0.4f;
            weight = 2.8f;
            firstDelay = 2.5f;
            windup = 0.35f;
            active = 14f;
            recover = 0.05f;
            forms = new[] { QilinDef.BurnForm };
        }

        float TeleTime => Brain.Enraged ? TeleRage : Tele;

        protected override void Prepare()
        {
            DiveIndex = 0;
            Phase = Leg.Rise;
            if (!Qilin) return;
            Qilin.SkyTarget = QilinBrain.HighAlt;
            Qilin.Accel = 40f;
        }

        protected override void OnTelegraph()
        {
            Brain.PlayAct("roar", WindupTime + 0.3f);
            Sfx("boss_roar", 0.8f, 1.15f);
            Qilin?.Tell("dives", "焚身俯冲踏地——落点会炸出一圈火环，跳起来躲；连踏三次之后它会落地喘息", Hex.Rgb(0xffb070));
        }

        protected override void OnWindup(float dt)
        {
            if (Qilin) Qilin.Hover();
            TurnToward(YawToPlayer, 240f, dt);
        }

        protected override void OnActiveBegin() => BeginDive();

        protected override bool ActiveDone => Phase == Leg.Done;

        /// <summary>定这一踏的落点（玩家 0.5 s 后的位置），飞过去</summary>
        void BeginDive()
        {
            Target = PickTarget();
            Phase = Leg.Rise;
            legT = 0;
            if (Qilin) Qilin.SkyTarget = QilinBrain.HighAlt;
            Brain.PlayAct("Locomotion");
        }

        /// <summary>落点：玩家 0.5 s 后的位置，夹在殿墙内 2.5 m；不压在倒鼎上、不插进石柱</summary>
        Vector3 PickTarget()
        {
            var a = OnFloor(Brain.Predict(Lead));
            var f = Furnace;
            var q = Qilin;
            if (f)
            {
                float r = f.RadiusOf(a), max = f.wallRadius - 2.5f;
                if (r > max) a = f.Point(f.YawOf(a), max);
                // 熔池中央的倒鼎（池中掩体）：落到它外沿
                var cd = q ? q.Cauldron : null;
                if (cd && cd.Cover)
                {
                    float keep = QilinCauldron.Half * 1.35f + Brain.BodyRadius * 0.6f;
                    if (f.RadiusOf(a) < keep) a = f.Point(f.RadiusOf(a) > 0.3f ? f.YawOf(a) : f.YawOf(Brain.transform.position), keep);
                }
            }
            if (q) a = q.PushClear(a);
            return OnFloor(a);
        }

        protected override void OnActive(float dt)
        {
            legT += dt;
            var q = Qilin;
            switch (Phase)
            {
                case Leg.Rise:
                {
                    bool there = q ? q.FlyTo(Target, RiseSpeed, 1.2f) : true;
                    TurnToward(YawTo(Target), 290f, dt);
                    if (!there && legT <= RiseMax) break;
                    Phase = Leg.Tele;
                    legT = 0;
                    if (q) q.Brake();
                    WarnCircle(Target, Radius, TeleTime);
                    Brain.PlayAct("tuck", TeleTime, 0.08f);
                    Sfx("telegraph", 1f, 1f);
                    break;
                }
                case Leg.Tele:
                    if (q)
                    {
                        // 悬在落点正上方（只收住水平速度，竖直由踏云积分追 7.5 m）
                        q.FlyTo(Target, 6f, 0.3f);
                        q.SkyTarget = QilinBrain.HighAlt;
                    }
                    TurnToward(YawToPlayer, 170f, dt);
                    Fx.QilinGather(q ? q.ChestPoint : Brain.BodyCenter, 3.5f, Mathf.Clamp01(legT / TeleTime), dt);
                    if (legT < TeleTime) break;
                    Phase = Leg.Dive;
                    legT = 0;
                    diveFrom = Brain.transform.position;
                    // 俯冲拖一道火尾
                    Surge.Trail(Brain.Model?.root ? Brain.Model.root.transform : Brain.transform, Vector3.up * 1.2f, 1.1f, 8f, SurgeKind.Fire, DiveTime + 0.1f);
                    Brain.PlayAct("stomp", DiveTime / StompHitAt, 0.04f);
                    Sfx("boss_roar", 0.8f, 1.4f);
                    break;
                case Leg.Dive:
                {
                    float k = Mathf.Min(1f, legT / DiveTime);
                    var p = Vector3.Lerp(diveFrom, Target, k);
                    p.y = Mathf.Lerp(diveFrom.y, Target.y, k * k);
                    if (q) q.SkyPlace(p);
                    else Brain.transform.position = p;
                    if (k >= 1f) Land();
                    break;
                }
                case Leg.Recover:
                    if (q)
                    {
                        q.SkyTarget = 0;
                        q.Hover();
                    }
                    TurnToward(YawToPlayer, 120f, dt);
                    if (legT < LandRecover) break;
                    DiveIndex++;
                    if (DiveIndex < Count) BeginDive();
                    else
                    {
                        Phase = Leg.Done;
                        // 三踏之后落地喘息（下一招）：招式间隙里也待在地上，不先飞起来再落下
                        Brain.QueueMove(BurnPant.MoveId);
                        if (q) q.HoldGround = true;
                    }
                    break;
            }
        }

        /// <summary>砸下：落点重击 + 贴地火环（被重击打中的这一下火环放过玩家）</summary>
        void Land()
        {
            var a = Target;
            Phase = Leg.Recover;
            legT = 0;
            Landings++;
            if (Qilin) Qilin.SkyTarget = 0;
            bool hit = Hazards.Blast(a, Radius, Dmg(BlastDamage), new BossBlastOpts { maxHeight = 3f, knockback = 10f, knockUp = 6f, element = Element.Fire });
            if (hit) BlastHits++;
            Hazards.Wave(new BossWaveSpec(a, RingSpeed, RingRadius, Dmg(RingDamage), QilinDef.Warn)
            {
                startRadius = 2f, width = 1f, height = 0.85f, knockback = 6f, element = Element.Fire, dust = true, dustColor = QilinDef.Ember, spare = hit,
            });
            Fx.Explosion(a + Vector3.up * 0.6f, 4f, QilinDef.Fire);
            Fx.QilinCloudImpact(a, Radius, RingRadius, (RingRadius - 2f) / RingSpeed);
            // 踏云火环：一圈贴地往外推的火墙（整圈弧幕，和火环冲击波同速）+ 落点熔浆四溅、一圈残火
            Surge.Sheet(a, 0, 2f, 360f, 1.5f, SurgeKind.Fire, 0.08f, Mathf.Max(0.05f, (RingRadius - 2f) / RingSpeed - 0.3f), 0.25f, null, null, 2.6f, 0.9f,
                grow: RingRadius / 2f);
            Fx.MoltenBurst(a + Vector3.up * 0.3f, 2.2f, false);
            FlameTongues.Ground(a, Radius * 0.7f, 7, 1.6f, 0.7f);
            Brain.Shake(0.65f, 0.45f);
            Sfx("boss_slam");
        }

        protected override void OnEnd(bool cancelled)
        {
            Phase = Leg.Done;
            var q = Qilin;
            if (q) q.Accel = QilinBrain.SkyAccel;
            if (!q || (!cancelled && q.HoldGround)) return;
            q.HoldGround = false;
            q.SkyTarget = QilinBrain.SkyAlt;
        }
    }
}
