using System;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 蛮蛮（第四章远程·扫线；combat 3.5，设计单第 5 节）：比翼鸟，一翼一目，成对出现（同群里先到的两只配成一对，后一只是 X 镜像的右翼），
    /// 两只之间一道电弧——电弧在，才飞得起来。成对时一直带电（火打一只 = 焚雷）。不走导航，运动学飞行。
    ///   · 盘旋 orbit：两只隔 4–7 m 绕玩家 15 m、离地 6–9 m。
    ///   · 电弧横扫 <c>sweep</c>（领头那只决定，两只同时出）：电弧变亮变粗、两只拉开到 10 m，地上一条 30 × 10 m 的走廊（正红危险填充 + 中线紫红身份线），
    ///     0.8 s 后两只降到离地 1 m 平行掠过；电弧离地 0.9 m：单跳跳过、冲刺穿过；碰到 10 + 雷殛 + 击退。扫完慢慢爬升 1 s。
    ///   · 电弹 <c>bolt</c>：张嘴、独眼一亮 → 24 m/s 慢速电弹，7 + 雷殛。
    ///   · 比翼坠落：打死一只，电弧断，另一只也飞不起来，落地一蹦一蹦追着啄（4 m/s、6），落地的吃 ×1.5。
    /// </summary>
    public sealed class ManmanAI : PlateauEnemyAI
    {
        public const float OrbitRadius = 15f, CruiseHeight = 7.5f, SweepHalf = 15f, SweepWidth = 10f, ArcLow = 1.0f;
        public const float SweepDamage = 10f, BoltSpeed = 24f, BoltDamage = 7f, HopSpeed = 4f, PeckDamage = 6f, DownedTaken = 1.5f;

        public ManmanAI Mate { get; private set; }
        public bool Lead { get; private set; }
        public bool Downed { get; private set; }
        public bool Paired => Mate && !Mate.Dead && !Mate.Downed && !Downed;
        public bool SweepHit { get; private set; }
        public int Sweeps { get; private set; }
        /// <summary>试玩套件：盘旋时不自己出招</summary>
        public bool holdFire;

        protected override bool Flies => true;

        FxHandle arc, arcHot;
        IDisposable pairHold;
        Vector3 S, E;
        float side = 1, boltCd, peckCd, featherT;

        protected override void Awake()
        {
            glowBoneName = "eye";
            glowSize = 0.8f;
            sight = 40f;
            centerY = 0.4f;
            base.Awake();
            hp.Incoming.Add((in IncomingHit h) => Downed ? DownedTaken : 1f);
            hp.Damaged += (info, r) =>
            {
                // 受击：掉一蓬羽毛
                if (r.total > 0 && Time.time > featherT)
                {
                    featherT = Time.time + 0.15f;
                    Fx.PlateauFeathers(info.point.sqrMagnitude > 0 ? info.point : Center, 5);
                }
            };
        }

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            // 出生抬到半空
            var p = transform.position;
            transform.position = new Vector3(p.x, Ground(p) + CruiseHeight * 0.6f, p.z);
        }

        protected override void OnJoined()
        {
            foreach (var m in Pack.Mates(this))
                if (m is ManmanAI o && !o.Mate)
                {
                    Pair(o);
                    return;
                }
        }

        /// <summary>配成一对：o 领头（左翼），自己是右翼（模型节点 X 镜像）</summary>
        void Pair(ManmanAI o)
        {
            o.Mate = this;
            o.Lead = true;
            o.side = 1;
            Mate = o;
            Lead = false;
            side = -1;
            var model = anim ? anim.transform : null;
            if (model && model != transform)
            {
                var s = model.localScale;
                model.localScale = new Vector3(-Mathf.Abs(s.x), s.y, s.z);
            }
        }

        protected override void Update()
        {
            base.Update();
            if (Dead) return;
            // 成对时常驻带电
            bool paired = Paired;
            if (paired && pairHold == null) pairHold = Charge.Hold(hp, this);
            else if (!paired && pairHold != null)
            {
                pairHold.Dispose();
                pairHold = null;
            }
            // 两只之间的电弧（领头的那只画）：横扫前摇越来越亮越粗
            if (Lead && paired && Alerted)
            {
                var a = BonePos(Bone("chest"));
                var b = Mate.BonePos(Mate.Bone("chest"));
                if (!arc.Alive) arc = Fx.PlateauArc(a, b, 0.05f);
                else arc.Retarget(a, b);
                bool hot = Move.Id == "sweep" && Move.Stage != MoveStage.Recover && (Move.Stage == MoveStage.Active || Move.StageK > 0.3f);
                if (hot)
                {
                    if (!arcHot.Alive) arcHot = Fx.PlateauArc(a, b, 0.09f);
                    else arcHot.Retarget(a, b);
                }
                else if (arcHot.Alive) arcHot.Cancel();
            }
            else
            {
                if (arc.Alive) arc.Cancel();
                if (arcHot.Alive) arcHot.Cancel();
            }
        }

        protected override void Roam(float dt)
        {
            // 没发现玩家：在领地上空慢慢盘
            float a = Time.time * 0.3f + home.x;
            var c = home + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * 6f;
            c.y = Ground(c) + CruiseHeight;
            FlyTowards(c, moveSpeed * 0.4f, dt);
            FaceMovement(200f, dt);
            if (hp.health < hp.maxHealth) hp.Heal(hp.maxHealth * 0.3f * dt);
            if (vitals && !vitals.Dead && DistToPlayer < Sight && sees) Notice(true);
        }

        protected override void Fight(float dt, float dist)
        {
            if (Downed)
            {
                // 落地追啄
                var p = transform.position;
                float g = Ground(p);
                if (p.y > g + 0.3f)
                {
                    transform.position = new Vector3(p.x, Mathf.Max(g, p.y - dt * 9f), p.z);
                    return;
                }
                ActLoop("hop");
                var to = PlayerPos - p;
                to.y = 0;
                if (to.magnitude > 1.0f) p += to.normalized * Mathf.Min(to.magnitude - 1f, HopSpeed * SpeedMult * dt);
                p.y = Ground(p) + Mathf.Abs(Mathf.Sin(Time.time * 9f)) * 0.25f;
                transform.position = p;
                FacePlayer(400f, dt);
                peckCd -= dt;
                if (dist < 1.5f && peckCd <= 0)
                {
                    peckCd = 1f;
                    Strike(PeckDamage, transform.position, Element.None, Vector3.zero);
                }
                return;
            }
            // 盘旋：两只隔 4–7 m 绕玩家 15 m
            var leadBird = Lead || !Paired ? this : Mate;
            float a = Time.time * 0.45f + leadBird.home.x * 0.3f;
            float R = OrbitRadius + 2f * Mathf.Sin(Time.time * 0.4f + leadBird.home.z);
            var c = PlayerPos + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * R;
            float spread = Paired ? 4f + 1.5f * Mathf.Sin(Time.time * 0.8f) : 0;
            c += new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * spread * side;
            c.y = Ground(c) + CruiseHeight + 1.5f * Mathf.Sin(Time.time + home.x);
            FlyTowards(c, moveSpeed, dt);
            FaceMovement(300f, dt);
            Loco();
            if (holdFire) return;
            if (Lead && Paired && cooldown <= 0 && dist < 34 && !Mate.Move.Busy && !Mate.Stunned && TakeToken(PlateauPack.Token.Ranged, AttackTokens.Kind.Ranged, 3.5f))
            {
                cooldown = PlateauMoves.ManmanSweep.cooldown + Random.value * 2;
                Mate.HoldCooldown(2f);
                StartSweep();
                return;
            }
            if (cooldown <= 0 && dist < 40 && sees && Time.time >= boltCd)
            {
                boltCd = Time.time + PlateauMoves.ManmanBolt.cooldown + Random.value * 1.5f;
                Begin(PlateauMoves.ManmanBolt);
            }
        }

        void HoldCooldown(float c) => cooldown = Mathf.Max(cooldown, c);

        /// <summary>领头的那只决定横扫，跟着的那只同步开始（试玩套件也调）</summary>
        public void StartSweep()
        {
            if (!Paired) return;
            var lead = Lead ? this : Mate;
            var mate = lead.Mate;
            var c = (lead.transform.position + mate.transform.position) * 0.5f;
            var dir = PlayerPos - c;
            dir.y = 0;
            if (dir.sqrMagnitude < 1f) dir = Vector3.right;
            dir.Normalize();
            var s = PlayerPos - dir * SweepHalf;
            var e = PlayerPos + dir * SweepHalf;
            s.y = Ground(s);
            e.y = Ground(e);
            foreach (var b in new[] { lead, mate })
            {
                b.Notice(false);
                b.S = s;
                b.E = e;
                b.SweepHit = false;
                b.Begin(PlateauMoves.ManmanSweep);
            }
            lead.Sweeps++;
        }

        protected override void OnMoveEvent(string id, string evt)
        {
            switch (id)
            {
                case "sweep" when evt == "warn" && Lead:
                    Warn(Telegraph.Lane(S, E, SweepWidth, PlateauMoves.ManmanSweep.windup / HasteMult + 0.2f, TelegraphPalette.Danger));
                    Warn(Telegraph.Lane(S, E, 0.45f, PlateauMoves.ManmanSweep.windup / HasteMult + 0.2f, TelegraphPalette.Thunder, 0, TelegraphTone.Thunder));
                    break;
                case "sweep" when evt == "hit":
                {
                    var at = BonePos(Bone("chest"));
                    Fx.Play("ToonBurst", at, Vector3.up, PlateauPalette.Core, 0.9f);
                    if (Lead)
                    {
                        var dir = (E - S).normalized;
                        for (int i = 0; i < 6; i++)
                        {
                            var p = Vector3.Lerp(S, E, i / 5f);
                            p.y = Ground(p) + 0.05f;
                            PlateauFxSeq.After(i * 0.18f, () => Fx.Burst(p, PlateauPalette.Grass, 5, 3f, 0.5f, 0.15f, 4));
                        }
                        Fx.PlateauBolt(at, Mate.BonePos(Mate.Bone("chest")), 0.12f, 0.18f, 1);
                    }
                    break;
                }
                case "bolt" when evt == "release":
                {
                    var from = BonePos(Bone("head"));
                    var dir = (TargetChest - from).normalized;
                    var spec = new EnemyProjectileSpec(from, dir * BoltSpeed, BoltDamage * DamageMult, 0.2f, 3f)
                    {
                        element = Element.Shock, visual = "orb", color = PlateauPalette.Bolt, scale = 1.2f, source = this, blockable = true,
                        onImpact = (p, hitP) =>
                        {
                            if (!hitP) Fx.Play("ToonBurst", p, Vector3.up, PlateauPalette.Bolt, 0.7f);
                        },
                    };
                    EnemyProjectile.Spawn(spec);
                    Fx.PlateauSparks(from, 4, 2f, 0.06f);
                    break;
                }
            }
        }

        protected override void MoveTick(float dt, MoveStage stage, float k)
        {
            if (Move.Id == "bolt")
            {
                FacePlayer(400f, dt);
                return;
            }
            if (Move.Id != "sweep") return;
            var dir = E - S;
            dir.y = 0;
            dir = dir.sqrMagnitude > 1e-3f ? dir.normalized : transform.forward;
            var lat = new Vector3(-dir.z, 0, dir.x) * (SweepWidth * 0.5f * side);
            if (stage == MoveStage.Windup)
            {
                var t = S + lat;
                t.y = Ground(t) + ArcLow + 4f * (1 - k);
                FlyTowards(t, moveSpeed * 2.2f, dt, 4f);
            }
            else if (stage == MoveStage.Active)
            {
                var p = Vector3.Lerp(S, E, k) + lat;
                p.y = Ground(p) + ArcLow;
                transform.position = p;
                // 电弧扫到玩家：玩家站在两只之间那条线上、没跳过去
                if (Lead && Paired && !SweepHit && !PlayerInvulnerable)
                {
                    var P = PlayerPos;
                    float d = PlateauGeo.SegDist(P, transform.position, Mate.transform.position);
                    if (d < 0.7f && P.y < Mathf.Min(transform.position.y, Mate.transform.position.y) - 0.05f)
                    {
                        SweepHit = true;
                        Strike(SweepDamage, transform.position, Element.Shock, dir * 9f + Vector3.up * 3f);
                    }
                }
            }
            else
            {
                var t = E + lat;
                t.y = Ground(t) + ArcLow + 6f * k;
                FlyTowards(t, moveSpeed * 0.8f, dt, 1.5f);
            }
            transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(dir), 600f * dt);
        }

        /// <summary>比翼断了：飞不起来</summary>
        void Fall()
        {
            if (Downed || Dead) return;
            Downed = true;
            InterruptAttack();
            GameUI.FloatText(Center + Vector3.up, "比翼断了", PlateauPalette.Bolt, 1f);
        }

        protected override void OnDeath(DamageInfo info, PlateauDeath kind)
        {
            if (arc.Alive) arc.Cancel();
            if (arcHot.Alive) arcHot.Cancel();
            // 电弧断开那一下：两段缩回 + 断口一团白闪
            if (Mate && !Mate.Dead)
            {
                var a = Center;
                var b = Mate.Center;
                Fx.Play("ToonBurst", (a + b) * 0.5f, Vector3.up, PlateauPalette.Core, 0.8f);
                Fx.PlateauBolt(a, (a + b) * 0.5f, 0.05f, 0.12f, 0);
                Fx.PlateauBolt(b, (a + b) * 0.5f, 0.05f, 0.12f, 0);
                Mate.Fall();
            }
            Fx.PlateauFeathers(Center, 16);
            // 打着旋掉下来：落地再炸一蓬羽毛
            var at = transform.position;
            float drop = Mathf.Max(0.2f, at.y - Ground(at));
            PlateauFxSeq.After(Mathf.Sqrt(2f * drop / 9.8f), () => Fx.PlateauFeathers(new Vector3(at.x, Ground(at) + 0.3f, at.z), 16));
            var rag = GetComponent<Spiritfire.Art.CreatureRagdoll>();
            if (rag && rag.Active)
                foreach (var p in rag.parts)
                    if (p.body)
                        p.body.angularVelocity += new Vector3(0, 9f, 3f);
        }
    }
}
