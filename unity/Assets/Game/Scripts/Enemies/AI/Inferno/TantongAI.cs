using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 炭童（Three.js 版 src/enemies/types/Tantong.ts）：第三章群怪，成群扑脸、抛炭，死了不补刀会复燃。
    ///   小跑包围：远处直扑（每段方向偏一点，难瞄），5 m 内在 1.6–3 m 的近身带上打转、合围。
    ///   扑抓：2.6 m 内蹲身举爪 0.35 s → 一跳扑上来（约 2 m）→ 落地双手乱抓两下（各 ×0.55）→ 收势 0.5 s（输出窗口）。
    ///   抛炭：6–14 m、看得到玩家：0.4 s 前摇（先从肩上掰炭、再抡过头）→ 抛物线砸过去（只预判三分之一的移动），落点朱红预警圈；
    ///         落地炸开 1 m 一小团火（×0.8），留下一片烧 2 s 的地火（×0.15 / 0.5 s，祸斗能吃）。全队每 0.6 s 最多一块。
    ///   余烬复燃：死后碎成余烬炭堆（<see cref="TantongEmberAI"/>，另一只敌人），4 s 后复燃成 <see cref="RebornId"/>（半血、不掉落、再死碎成灰）；
    ///         死在熔岩上 / 悬空处、清场处决不留炭堆。
    ///   吹火：3 m 内有同伴的炭堆（还没人在吹、离复燃还早）就跑过去蹲下吹 1.2 s，炭堆当场复燃——先杀蹲着吹火的那只。
    /// 状态：chase → pounceWindup → pounce → flail → recover → chase；chase → throwWindup → throwRelease → recover；chase → blowGo → blow → chase。
    /// </summary>
    public class TantongAI : InfernoEnemyAI
    {
        /// <summary>复燃站起来的炭童 / 余烬炭堆的名册 id</summary>
        public const string RebornId = "tantong_reborn", EmberId = "tantong_ember";

        /// <summary>扑抓：触发距离、前摇、扑跳水平 / 竖直速度、最长时间、乱抓两下的时刻、总时长、距离、每下倍率、收势</summary>
        public const float PounceRange = 2.6f, PounceWindup = 0.35f, PounceSpeed = 7.5f, PounceVy = 3.2f, PounceMax = 0.5f;
        public static readonly float[] FlailHits = { 0.06f, 0.26f };
        public const float FlailTime = 0.42f, FlailRange = 1.3f, FlailMult = 0.55f, PounceRecover = 0.5f;
        /// <summary>抛炭：距离带、前摇（前 BreakFrac 掰炭）、全队间隔、炭块重力、炸开半径 / 倍率、地火半径 / 时长 / 倍率</summary>
        public const float ThrowMin = 6, ThrowMax = 14, ThrowWindup = 0.4f, BreakFrac = 0.45f, ThrowGap = 0.6f, CoalGravity = 22f;
        public const float CoalRadius = 1.0f, CoalMult = 0.8f, BurnRadius = 1.0f, BurnTime = 2f, BurnMult = 0.15f;
        /// <summary>近身合围带</summary>
        public const float CloseMin = 1.6f, CloseMax = 3.0f;
        /// <summary>余烬：复燃时间、复燃血量比例、找同伴炭堆的距离、吹火时长、吹火站位离炭堆多远、跑去吹火的超时</summary>
        public const float RekindleTime = 4f, RekindleHp = 0.5f, BlowSeek = 3f, BlowTime = 1.2f, BlowStand = 0.75f, BlowGoTimeout = 2.5f;

        /// <summary>美术网格实测：头顶火苗弱点球心、右手掌心（掰下来的炭块）</summary>
        static readonly Vector3 FlamePoint = new(0, 0.86f, 0), PalmPoint = new(-0.16f, 0.42f, 0.08f);

        /// <summary>全队上一次抛炭的时刻</summary>
        static float throwGate = float.NegativeInfinity;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => throwGate = float.NegativeInfinity;

        /// <summary>复燃过的（再死不留炭堆）</summary>
        public bool Reborn { get; private set; }
        /// <summary>正在去吹 / 正在吹的同伴炭堆</summary>
        public TantongEmberAI BlowTarget { get; internal set; }
        /// <summary>最近一次抛出的炭块（测试 / 冒烟用）</summary>
        public EnemyProjectile LastCoal { get; private set; }

        float windTime = PounceWindup, recoverTime = 0.4f, zig, zigYaw, breathAcc;
        int flailHits;
        Vector3 pounceDir;
        bool coalShown;
        Transform coal;

        protected override void Awake()
        {
            base.Awake();
            GlowStyle(0.35f, 0.1f, 9f, 0.6f, false);
            // 弱点 = 头顶火苗：罩住头顶和火苗的球，挂在 head 骨上
            InfernoKit.PlaceWeak(body, "head", FlamePoint, 0.15f);
            // 掰下来的红炭：挂右手（平时收着）
            var hand = InfernoKit.FindBone(transform, "hand_R") ?? transform;
            var root = new GameObject("Coal").transform;
            root.SetParent(hand, false);
            root.position = InfernoKit.ModelToWorld(transform, PalmPoint);
            float k = 0.09f * Mathf.Abs(transform.lossyScale.x) / Mathf.Max(1e-3f, Mathf.Abs(hand.lossyScale.x));
            InfernoKit.Primitive(PrimitiveType.Cube, "Lump", root, Vector3.zero, Vector3.one * k * 1.6f, InfernoKit.Coal).transform.localRotation = Quaternion.Euler(20, 35, 10);
            InfernoKit.Primitive(PrimitiveType.Sphere, "Glow", root, Vector3.zero, Vector3.one * k * 2.2f, InfernoKit.Crack * 0.8f, true);
            coal = root;
            coal.gameObject.SetActive(false);
            hp.Died += OnTantongDied;
        }

        public override void Spawn(float lvl, bool isElite)
        {
            base.Spawn(lvl, isElite);
            Reborn = enemyId == RebornId;
        }

        protected override void Start()
        {
            base.Start();
            cooldown = Reborn ? 0.8f : Rand(0.6f, 1.8f);
        }

        /// <summary>由炭堆复燃生成：半血，炭块从炭堆飞回身上</summary>
        public void RekindledFrom(Vector3 pile)
        {
            Reborn = true;
            hp.health = Mathf.Max(1, RoundHp(hp.maxHealth * RekindleHp));
            cooldown = 0.8f;
            for (int i = 0; i < 5; i++)
                Fx.Burst(Vector3.Lerp(pile, transform.position + Vector3.up * 0.5f * Size, i / 4f), InfernoKit.Coal, 2, 1.5f, 0.35f, 0.08f * Size, -1);
            Fx.Burst(transform.position + Vector3.up * 0.5f * Size, InfernoKit.Spark, 14, 3f, 0.45f, 0.06f, 1);
        }

        protected override string InitialState => "chase";

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            ShowCoal(state == "throwWindup" && stateTime >= windTime * BreakFrac);
            switch (state)
            {
                case "chase":
                    Chase(dt, d);
                    break;
                case "pounceWindup":
                {
                    // 蹲身、双爪举过头，眼睛和炭缝越来越亮
                    Stop();
                    FacePlayer(10 * Mathf.Rad2Deg, dt);
                    Glow = 0.4f + 0.6f * Mathf.Clamp01(stateTime / windTime);
                    if (stateTime >= windTime) LaunchPounce();
                    break;
                }
                case "pounce":
                {
                    Glow = 1;
                    var v = ManualVelocity;
                    SetManualVelocity(new Vector3(pounceDir.x * PounceSpeed, v.y, pounceDir.z * PounceSpeed));
                    if ((ManualGrounded && stateTime > 0.15f) || (d <= 1.0f && stateTime > 0.08f) || stateTime >= PounceMax || (HitWall && stateTime > 0.08f))
                    {
                        EndManualMotion();
                        flailHits = 0;
                        Act("flail", 0.05f);
                        SetState("flail");
                    }
                    break;
                }
                case "flail":
                    // 双手乱抓两下
                    Stop();
                    FacePlayer(12 * Mathf.Rad2Deg, dt);
                    while (flailHits < FlailHits.Length && stateTime >= FlailHits[flailHits])
                    {
                        flailHits++;
                        if (Melee(FlailRange, Damage * FlailMult, 0f)) Fx.Burst(TargetChest, InfernoKit.Spark, 6, 2.5f, 0.3f, 0.05f, 3);
                    }
                    if (stateTime >= FlailTime) ToRecover(PounceRecover);
                    break;
                case "throwWindup":
                {
                    Stop();
                    FacePlayer(8 * Mathf.Rad2Deg, dt);
                    float t = Mathf.Clamp01(stateTime / windTime);
                    Glow = 0.3f + 0.6f * t;
                    // 从肩上掰下炭块的一瞬间：一团火星
                    if (t >= BreakFrac && stateTime - dt < windTime * BreakFrac)
                    {
                        Fx.Burst(coal.position, InfernoKit.Spark, 10, 2.5f, 0.35f, 0.05f, 4);
                        GameAudio.PlayAt("land", coal.position, 0.35f, 2.1f);
                    }
                    if (stateTime >= windTime)
                    {
                        ThrowCoal();
                        Act("throwRelease", 0.05f);
                        SetState("throwRelease");
                    }
                    break;
                }
                case "throwRelease":
                    Stop();
                    if (stateTime >= 0.2f) ToRecover(0.3f);
                    break;
                case "blowGo":
                    BlowGo(dt);
                    break;
                case "blow":
                    Blow(dt);
                    break;
                case "recover":
                    Stop();
                    Glow = 0.15f;
                    FacePlayer(5 * Mathf.Rad2Deg, dt);
                    if (stateTime >= recoverTime / Mathf.Sqrt(Mathf.Max(0.1f, auraAttackRate)))
                    {
                        ReleaseAttack();
                        ToChase();
                    }
                    break;
                default:
                    ToChase();
                    break;
            }
        }

        void ToChase()
        {
            Loco();
            SetState("chase");
        }

        void ToRecover(float time)
        {
            recoverTime = time;
            Act("recover");
            SetState("recover");
        }

        /// <summary>追击：先看身边有没有要吹的同伴炭堆，再看能不能出手（扑抓 / 抛炭），否则小跑包围</summary>
        void Chase(float dt, float d)
        {
            Glow = 0.15f + 0.08f * Mathf.Sin(age * 3.3f);
            var pile = FindPile();
            if (pile)
            {
                pile.Blower = this;
                BlowTarget = pile;
                Act("blowGo", 0.12f);
                SetState("blowGo");
                return;
            }
            bool reach = VerticalReach(1.3f);
            if (cooldown <= 0 && sees && reach && d <= PounceRange && RequestAttack(AttackTokens.Kind.Melee, 1.6f))
            {
                windTime = Windup(PounceWindup, 0.25f);
                Stop();
                ActTimed("pounceWindup", windTime);
                SetState("pounceWindup");
                Sfx("enemy_alert", 0.4f, 1.7f);
                return;
            }
            float now = Time.time;
            if (throwGate > now + ThrowGap) throwGate = float.NegativeInfinity; // 时钟回退（新开一局）
            if (cooldown <= 0 && sees && d >= ThrowMin && d <= ThrowMax && now - throwGate >= ThrowGap
                && RequestAttack(AttackTokens.Kind.Ranged, ThrowWindup + 0.6f))
            {
                throwGate = now;
                windTime = Windup(ThrowWindup, 0.3f);
                Stop();
                ActTimed("throwWindup", windTime);
                SetState("throwWindup");
                return;
            }
            if (!sees && blindTime > 0.5f)
            {
                MoveTo(PlayerPos, moveSpeed);
                FaceMovement(10 * Mathf.Rad2Deg, dt);
                return;
            }
            if (d > 5 || !reach)
            {
                // 视野内的开阔地：每段方向偏一点（小鬼一蹦一跳地扑过来）
                zig -= dt;
                if (zig <= 0)
                {
                    zig = Rand(0.35f, 0.7f);
                    zigYaw = Rand(-0.45f, 0.45f);
                }
                var to = PlayerPos - transform.position;
                to.y = 0;
                if (sees && d > 5 && to.sqrMagnitude > 0.01f)
                {
                    var dir = Quaternion.Euler(0, zigYaw * Mathf.Rad2Deg, 0) * to.normalized;
                    MoveTo(transform.position + dir * Mathf.Min(d - CloseMax, 5f), moveSpeed);
                }
                else MoveTo(PlayerPos - (to.sqrMagnitude > 0.01f ? to.normalized : Vector3.zero) * CloseMax, moveSpeed);
                FaceMovement(10 * Mathf.Rad2Deg, dt);
                return;
            }
            // 近身：在合围带上打转（冷却好了就往里挤，进扑抓距离）
            if (cooldown > 0.2f) KeepRange(CloseMin, CloseMax, moveSpeed * 0.85f, 1f);
            else MoveTo(PlayerPos, moveSpeed);
            FacePlayer(9 * Mathf.Rad2Deg, dt);
        }

        /// <summary>3 m 内、还没人在吹、离复燃还早（剩余 ≥ 吹火时长的 0.6）的同伴炭堆</summary>
        TantongEmberAI FindPile()
        {
            TantongEmberAI best = null;
            float bestD = BlowSeek;
            foreach (var e in EnemyRegistry.Live)
            {
                if (e is not TantongEmberAI pile || !pile.AwaitingBlow(this) || pile.Blower) continue;
                if (pile.Remaining < BlowTime * 0.6f) continue;
                var dd = pile.transform.position - transform.position;
                if (Mathf.Abs(dd.y) >= 1f) continue;
                dd.y = 0;
                if (dd.magnitude >= bestD) continue;
                bestD = dd.magnitude;
                best = pile;
            }
            return best;
        }

        void BlowGo(float dt)
        {
            var pile = BlowTarget;
            if (!pile || !pile.AwaitingBlow(this))
            {
                DropBlow();
                return;
            }
            // 走到炭堆旁边（靠自己这一侧）
            var away = transform.position - pile.transform.position;
            away.y = 0;
            float len = away.magnitude;
            if (len <= BlowStand + 0.2f)
            {
                Stop();
                Act("blow", 0.1f);
                SetState("blow");
                Sfx("enemy_charge", 0.35f, 1.9f);
                return;
            }
            var stand = pile.transform.position + (len > 1e-3f ? away / len : transform.forward) * BlowStand;
            MoveTo(stand, moveSpeed);
            FaceMovement(12 * Mathf.Rad2Deg, dt);
            if (stateTime > BlowGoTimeout) DropBlow();
        }

        /// <summary>蹲下鼓腮，对着炭堆吹；吹满 1.2 s 炭堆当场复燃</summary>
        void Blow(float dt)
        {
            var pile = BlowTarget;
            Stop();
            if (!pile || !pile.AwaitingBlow(this))
            {
                DropBlow();
                return;
            }
            FaceTowards(pile.transform.position, 10 * Mathf.Rad2Deg, dt);
            Glow = 0.5f + 0.3f * Mathf.Sin(stateTime * 12);
            pile.BlowProgress = Mathf.Clamp01(stateTime / BlowTime);
            breathAcc += dt;
            if (breathAcc > 0.06f)
            {
                breathAcc = 0;
                var mouth = Local(0, 0.5f, 0.2f);
                var at = pile.transform.position + Vector3.up * 0.15f;
                Fx.Burst(Vector3.Lerp(mouth, at, Random.value), InfernoKit.Ash, 1, 0.5f, 0.3f, 0.08f, 0);
                Fx.Burst(at, InfernoKit.Spark, 2, 1.4f, 0.35f, 0.05f, -2);
            }
            if (stateTime >= BlowTime)
            {
                BlowTarget = null;
                pile.Rekindle();
                RollCooldown(0.5f, 1.0f);
                ToChase();
            }
        }

        void DropBlow()
        {
            var pile = BlowTarget;
            if (pile && pile.Blower == this)
            {
                pile.Blower = null;
                pile.BlowProgress = 0;
            }
            BlowTarget = null;
            if (state is "blowGo" or "blow") ToChase();
        }

        /// <summary>扑跳：朝玩家此刻的位置（轻微预判 0.15 s）跳出去</summary>
        void LaunchPounce()
        {
            var to = PlayerPos + PlayerVelocity * 0.15f - transform.position;
            to.y = 0;
            pounceDir = to.sqrMagnitude > 1e-4f ? to.normalized : transform.forward;
            transform.rotation = Quaternion.LookRotation(pounceDir);
            BeginManualMotion(new Vector3(pounceDir.x * PounceSpeed, PounceVy, pounceDir.z * PounceSpeed), LaunchGravity);
            HitWall = false;
            Act("pounce", 0.05f);
            SetState("pounce");
            Sfx("jump", 0.4f, 1.6f);
            Fx.Burst(transform.position + Vector3.up * 0.05f, InfernoKit.Ash, 5, 1.4f, 0.4f, 0.14f, 1);
        }

        /// <summary>抛炭的飞行时间（秒）：0.5 + 水平距离 × 0.04（同 TS）</summary>
        public static float CoalFlightTime(float distance) => 0.5f + Mathf.Max(0, distance) * 0.04f;

        /// <summary>重力 g 下 T 秒从 from 落到 target 的初速度</summary>
        public static Vector3 BallisticVelocity(Vector3 from, Vector3 target, float T, float g)
        {
            T = Mathf.Max(0.05f, T);
            var v = (target - from) / T;
            v.y += 0.5f * g * T;
            return v;
        }

        /// <summary>抛炭：从手里的炭块位置抛向玩家脚下（预判三分之一），落点有朱红预警圈</summary>
        void ThrowCoal()
        {
            var from = coal.position;
            var flat = PlayerPos - from;
            flat.y = 0;
            float T = CoalFlightTime(flat.magnitude);
            var target = PlayerPos + PlayerVelocity * (T * 0.33f);
            float gy = InfernoKit.GroundAt(target, PlayerPos.y + 0.5f, 6f);
            if (float.IsFinite(gy)) target.y = gy;
            float dmg = Damage;
            var warn = Telegraph.Circle(target, CoalRadius, T, InfernoKit.Warn);
            var self = this;
            LastCoal = EnemyProjectile.Spawn(new EnemyProjectileSpec(from, BallisticVelocity(from, target, T, CoalGravity), dmg * CoalMult, 0.12f * Size, T + 0.8f)
            {
                gravity = CoalGravity, explosionRadius = CoalRadius, explosionFalloff = 0.6f, element = Element.Fire, source = this,
                visual = "chunk", color = InfernoKit.Crack, scale = 0.9f,
                onImpact = (at, hitPlayer) =>
                {
                    if (!hitPlayer) warn.FadeOut();
                    Fx.Burst(at, InfernoKit.Spark, 14, 4, 0.5f, 0.07f, 6);
                    Fx.Burst(at, InfernoKit.Coal, 6, 2.5f, 0.6f, 0.06f, 9);
                    GameAudio.PlayAt("land", at, 0.6f, 1.3f);
                    // 落地 / 砸在玩家身上 / 撞墙：炭块碎在脚下的地面上烧起来（悬空太高就不留）
                    float g = InfernoKit.GroundAt(at, at.y + (hitPlayer ? 0.2f : 1f), 4f);
                    if (!float.IsFinite(g) || at.y - g > 2.2f) return;
                    FloorFire.Spawn(new Vector3(at.x, g, at.z), BurnRadius, BurnTime, dmg * BurnMult, 0.5f, self);
                },
                onBlocked = _ => warn.FadeOut(),
            });
            Sfx("skill_throw", 0.5f, 1.4f);
            ReleaseAttack();
            RollCooldown(2.2f, 3.4f);
        }

        void ShowCoal(bool on)
        {
            if (!coal || coalShown == on) return;
            coalShown = on;
            coal.gameObject.SetActive(on);
        }

        protected override void CancelAttack()
        {
            DropBlow();
            ShowCoal(false);
            if (state is not ("chase" or IdleState or "spawn"))
            {
                SetState("chase");
                RollCooldown(0.6f, 1.2f);
            }
        }

        void OnTantongDied(DamageInfo info)
        {
            ShowCoal(false);
            if (EnemyRegistry.Purging || Reborn || info.Has(DamageTag.Purge))
            {
                // 复燃过的再死 / 清场：彻底碎成灰
                Fx.Burst(transform.position + Vector3.up * 0.5f * Size, InfernoKit.Ash, 18, 2.5f, 0.8f, 0.12f, -0.5f);
                return;
            }
            LeavePile();
        }

        /// <summary>碎成一堆余烬炭（另一只敌人）：死在熔岩里、悬空处不留；延后一点生成（不在伤害结算里改敌人表）</summary>
        void LeavePile()
        {
            var at = transform.position;
            if (!PileAllowed(at, out at)) return;
            Fx.Burst(at + Vector3.up * 0.4f * Size, InfernoKit.Spark, 16, 3, 0.5f, 0.07f, 6);
            Fx.Burst(at + Vector3.up * 0.4f * Size, InfernoKit.Smoke, 6, 1, 0.9f, 0.3f, -1);
            float lvl = level;
            bool wasElite = elite;
            string affix = EliteAffixes.AffixOf(this);
            var parent = transform.parent;
            var rot = Quaternion.Euler(0, Random.value * 360f, 0);
            HazardClock.Delay(0.05f, () =>
            {
                var e = EnemyRoster.Spawn(EmberId, at, rot, lvl, false, new SpawnOptions { parent = parent ? parent : null });
                if (e is TantongEmberAI pile) pile.Bind(lvl, wasElite, affix);
            });
        }

        /// <summary>这里能留炭堆：脚下 1.5 m 内有地面、不在熔岩上；at 改成地面点</summary>
        public static bool PileAllowed(Vector3 p, out Vector3 at)
        {
            at = p;
            float gy = InfernoKit.GroundAt(p, p.y + 0.5f, 6f);
            if (!float.IsFinite(gy) || p.y - gy > 1.5f) return false;
            at.y = gy;
            return !InfernoKit.Lava.IsLava(at);
        }
    }
}
