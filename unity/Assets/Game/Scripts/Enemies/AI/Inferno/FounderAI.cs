using System.Collections.Generic;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔铜匠（Three.js 版 src/enemies/types/Founder.ts，第三章辅助）：驼背老铸匠，背上长着一口熔铜坩埚（流嘴弯过右肩），自己不直接打人。
    ///   躲后排：同伴（22 m 内）重心再往远离玩家的方向退 3 m，离玩家至少 10 m；没有同伴就和玩家保持 10–16 m。
    ///   浇铜甲（约每 7 s）：挑 14 m 内没有铜甲、不飞、流嘴到它头顶没有遮挡的同伴里最大生命最高的，弓背 0.8 s（同伴脚下一圈熔铜色预警），
    ///     坩埚一倾，熔铜沿抛物线 0.5 s 浇到同伴头上 → <see cref="Bronze"/>：护甲层 = 同伴最大生命 60%（精英熔铜匠 ×1.3），
    ///     前 2.5 s 通红、受伤 ×2（一打就碎），之后冷成青铜、受伤 ×0.5 再撑 12 s；打穿护甲层就碎、倍率随之撤掉。
    ///     铜甲是真的金属：熔铜匠死了、坩埚裂了，浇上的甲照样留着（来源是每一次浇铸，不是熔铜匠本人）。
    ///   泼铜（玩家进 6 m、高差 2 m 内，拿近战名额）：脚下 3 m 预警 0.6 s → 圈内烫一下（伤害 × 1.2）、地上留 3 m 熔铜区烧 4 s（每 0.5 s × 0.35），
    ///     然后往后退开 1.4 s。
    ///   裂锅：背上坩埚（熔铜液面 = 弱点，bronze 骨）累计吃到最大生命 30% → 裂开：踉跄 1.2 s，熔铜漏一地（2.2 m、5 s，也烫身边的同伴和他自己：
    ///     每跳 3% 最大生命），之后走到哪漏到哪（每 1.8 s 一小摊），再也不能浇甲。从正面平视时坩埚被他的头挡住（玩家视线穿过头部球就不算弱点），
    ///     要绕后或者从高处打。
    /// 状态机：enter → stalk → pourWindup → pouring → stalk；flingWindup → retreat → stalk；裂锅时 crackStagger → stalk。
    /// 动作片段：enter / pourWindup / pouring / flingWindup / retreat / crackStagger + Locomotion（待机 = stalk）。
    /// </summary>
    public sealed class FounderAI : EnemyAI
    {
        /// <summary>浇铜甲：距离、前摇、熔铜飞行、冷却带、浇完收势</summary>
        public const float PourRange = 14, PourWindup = 0.8f, PourFlight = 0.5f, PourCdMin = 6.5f, PourCdMax = 7.5f, PourRecover = 0.35f;
        /// <summary>铜甲：护甲层 = 同伴最大生命的比例；通红 / 冷却后的时长与受伤倍率</summary>
        public const float BronzeArmor = 0.6f, BronzeHot = 2.5f, BronzeCold = 12f, HotTaken = 2f, ColdTaken = 0.5f;
        /// <summary>泼铜：触发距离、半径、前摇、熔铜区持续、冷却、退开时长、烫伤倍率、熔铜区每跳倍率</summary>
        public const float FlingTrigger = 6, FlingRadius = 3, FlingWindup = 0.6f, FlingPool = 4, FlingCd = 5, FlingRetreat = 1.4f, FlingHit = 1.2f, FlingTick = 0.35f;
        /// <summary>裂锅：坩埚累计承受的伤害（相对最大生命）</summary>
        public const float CrucibleBreak = 0.3f;
        /// <summary>漏铜：大摊半径 / 持续、小摊间隔 / 半径 / 持续、烫同伴（每跳最大生命比例）、踉跄</summary>
        public const float LeakRadius = 2.2f, LeakLife = 5, DripEvery = 1.8f, DripRadius = 1.1f, DripLife = 3, LeakAllyFrac = 0.03f, CrackStagger = 1.2f;
        /// <summary>躲后排：离玩家的距离带、退到同伴后方多远、登场</summary>
        public const float KeepMin = 10, KeepMax = 16, BehindAllies = 3, EnterTime = 0.8f;

        /// <summary>模型空间（Three.js 坐标，未缩放）：流嘴口、真头中心</summary>
        static readonly Vector3 SpoutTip = new(-0.075f, 1.5f, 0.05f), HeadC = new(0, 1.2f, 0.17f);
        const float HeadR = 0.2f;

        public static readonly Color Molten = Hex.Rgb(0xffa030), MoltenHot = Hex.Rgb(0xfff0b0), BronzeColor = Hex.Rgb(0x9a6a32),
            Verdigris = Hex.Rgb(0x5f8f72), Slag = Hex.Rgb(0x3a2418), Spark = Hex.Rgb(0xffc860), Ember = Hex.Rgb(0xff6a20);

        float pourCd, flingCd, windTime = 1, crucibleDamage, dripTimer, strafeSign = 1, strafeTimer;
        bool entered, enterPlayed, poured, placed;
        EnemyAI target;
        TelegraphHandle targetMark, flingMark;
        Transform spoutBone, headBone;
        Vector3 spoutLocal, headLocal;
        Vector3 pourFrom, pourTo;
        readonly List<EnemyAI> scratch = new();

        /// <summary>坩埚裂了（或死了）：不再浇甲</summary>
        public bool Silenced { get; private set; }
        /// <summary>坩埚累计受伤占裂锅阈值的比例</summary>
        public float CrucibleCrack => Mathf.Clamp01(crucibleDamage / Mathf.Max(1, hp.maxHealth * CrucibleBreak));
        /// <summary>正在浇的同伴</summary>
        public EnemyAI PourTarget => target;

        protected override string InitialState => entered ? "stalk" : "enter";

        protected override void Awake()
        {
            base.Awake();
            pourCd = Random.Range(2f, 3.5f);
            flingCd = Random.Range(1f, 2f);
            hp.Died += OnDeath;
            GlowStyle(0.15f, 0.05f, 2f, 0.8f, false);
        }

        protected override void Start()
        {
            base.Start();
            PlaceParts();
        }

        Vector3 ModelPoint(Vector3 three) => transform.TransformPoint(new Vector3(-three.x, three.y, three.z));

        /// <summary>流嘴口、真头按绑定姿势换算到骨骼局部；坩埚命中的计数挂到弱点区上</summary>
        void PlaceParts()
        {
            if (placed) return;
            placed = true;
            if (!GetComponent<PlaceholderBody>())
                foreach (var t in GetComponentsInChildren<Transform>(true))
                {
                    if (t.name == "spout_tip" || (t.name == "crucible" && !spoutBone)) spoutBone = t;
                    else if (t.name == "head") headBone = t;
                }
            if (spoutBone) spoutLocal = spoutBone.InverseTransformPoint(ModelPoint(SpoutTip));
            if (headBone) headLocal = headBone.InverseTransformPoint(ModelPoint(HeadC));
            if (body.WeakZone) body.WeakZone.Damaged += OnCrucibleHit;
        }

        /// <summary>流嘴口（世界）</summary>
        public Vector3 Spout => spoutBone ? spoutBone.TransformPoint(spoutLocal) : ModelPoint(SpoutTip);

        /// <summary>真头中心（世界）：从正面挡住坩埚</summary>
        public Vector3 RealHead => headBone ? headBone.TransformPoint(headLocal) : ModelPoint(HeadC);

        // ───────────── AI ─────────────

        protected override void Update()
        {
            strafeTimer -= Time.deltaTime;
            if (strafeTimer <= 0)
            {
                strafeSign = -strafeSign;
                strafeTimer = Random.Range(1.5f, 3.2f);
            }
            base.Update();
        }

        protected override void Think(float dt)
        {
            pourCd -= dt * auraAttackRate;
            flingCd -= dt * auraAttackRate;
            if (Silenced) Drip(dt);
            float d = DistToPlayer;
            switch (state)
            {
                case "enter":
                    Stop();
                    if (!enterPlayed)
                    {
                        enterPlayed = true;
                        Play("enter", 0.05f);
                    }
                    FacePlayer(115, dt);
                    if (stateTime >= EnterTime)
                    {
                        entered = true;
                        PlayLocomotion();
                        SetState("stalk");
                    }
                    break;
                case "stalk":
                {
                    Glow = Silenced ? 0 : 0.2f + 0.1f * Mathf.Sin(age * 2);
                    SetGlow(1, 0);
                    if (flingCd <= 0 && d < FlingTrigger && Mathf.Abs(PlayerPos.y - transform.position.y) <= 2
                        && RequestAttack(AttackTokens.Kind.Melee, FlingWindup + 0.6f))
                    {
                        BeginFling();
                        break;
                    }
                    PositionBehindAllies(KeepMin, KeepMax, BehindAllies, strafeSign);
                    if (!Silenced && pourCd <= 0)
                    {
                        var t = PickPourTarget();
                        if (t)
                        {
                            BeginPour(t);
                            break;
                        }
                        pourCd = 0.6f;
                    }
                    FaceAimTravel(172, dt);
                    break;
                }
                case "pourWindup":
                {
                    Stop();
                    var t = target;
                    if (!t || t.Dead || Bronze.On(t) != null)
                    {
                        pourCd = 1;
                        InterruptAttack();
                        break;
                    }
                    FaceTowards(t.transform.position, 172, dt);
                    float k = Mathf.Clamp01(stateTime / windTime);
                    Glow = 0.5f + 0.5f * k;
                    SetGlow(1, k);
                    targetMark.MoveTo(t.transform.position);
                    if (stateTime >= windTime) StartStream();
                    break;
                }
                case "pouring":
                {
                    Stop();
                    if (target) FaceTowards(target.transform.position, 172, dt);
                    UpdateStream();
                    if (stateTime >= PourFlight + PourRecover)
                    {
                        target = null;
                        SetGlow(1, 0);
                        pourCd = Random.Range(PourCdMin, PourCdMax);
                        PlayLocomotion();
                        SetState("stalk");
                    }
                    break;
                }
                case "flingWindup":
                    Stop();
                    Glow = 0.6f + 0.4f * Mathf.Clamp01(stateTime / windTime);
                    if (stateTime >= windTime) ReleaseFling();
                    break;
                case "retreat":
                {
                    // 泼完往后退开：背离玩家、略带横移
                    var away = transform.position - PlayerPos;
                    away.y = 0;
                    var dir = away + new Vector3(away.z, 0, -away.x) * 0.3f * strafeSign;
                    MoveTo(transform.position + dir.normalized * 3f, moveSpeed * 1.3f);
                    FacePlayer(115, dt);
                    if (stateTime >= FlingRetreat)
                    {
                        PlayLocomotion();
                        SetState("stalk");
                    }
                    break;
                }
                case "crackStagger":
                    Stop();
                    if (stateTime >= CrackStagger)
                    {
                        PlayLocomotion();
                        SetState("stalk");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("stalk");
                    break;
            }
        }

        /// <summary>
        /// 躲在同伴身后（熔铜匠 / 傩巫共用）：22 m 内同伴（不含自己、首领）的重心再往远离玩家的方向退 behind 米，离玩家至少 keepMin；
        /// 离站位超过 1.8 m 才走；没有同伴就和玩家保持 [keepMin, keepMax]
        /// </summary>
        internal void PositionBehindAllies(float keepMin, float keepMax, float behind, float strafe)
        {
            var spot = BehindAlliesSpot(this, PlayerPos, keepMin, behind, scratch);
            if (spot == null)
            {
                KeepRange(keepMin, keepMax, moveSpeed, strafe);
                return;
            }
            var to = spot.Value - transform.position;
            to.y = 0;
            if (to.magnitude > 1.8f) MoveTo(spot.Value, moveSpeed);
            else Stop();
        }

        /// <summary>同伴重心后方的站位（纯计算，没有同伴返回 null）</summary>
        public static Vector3? BehindAlliesSpot(EnemyAI self, Vector3 playerPos, float keepMin, float behind, List<EnemyAI> scratch)
        {
            EnemyRegistry.InRadius(self.transform.position, 22, scratch, EnemyQuery.Alive, self);
            var pts = new List<Vector3>(scratch.Count);
            foreach (var e in scratch)
                if (e && e.Health && !e.Health.IsBoss)
                    pts.Add(e.transform.position);
            scratch.Clear();
            return BehindSpot(pts, playerPos, keepMin, behind);
        }

        /// <summary>站位算法：重心 + 远离玩家方向 × behind；离玩家不到 keepMin 时沿同一方向推到 keepMin。没有点返回 null</summary>
        public static Vector3? BehindSpot(IReadOnlyList<Vector3> allies, Vector3 playerPos, float keepMin, float behind)
        {
            if (allies == null || allies.Count == 0) return null;
            var c = Vector3.zero;
            foreach (var p in allies) c += p;
            c /= allies.Count;
            var v = new Vector3(c.x - playerPos.x, 0, c.z - playerPos.z);
            float d = v.magnitude;
            var dir = d > 1e-4f ? v / d : Vector3.forward;
            c += dir * behind;
            v = new Vector3(c.x - playerPos.x, 0, c.z - playerPos.z);
            if (v.magnitude < keepMin) c = new Vector3(playerPos.x, c.y, playerPos.z) + dir * keepMin;
            return c;
        }

        // ───────────── 浇铜甲 ─────────────

        /// <summary>14 m 内、没有铜甲、不飞、不是熔铜匠、流嘴到它头顶之间没有遮挡的同伴里，最大生命最高的那个</summary>
        public EnemyAI PickPourTarget()
        {
            EnemyRegistry.InRadius(transform.position, PourRange, scratch, EnemyQuery.Alive, this);
            EnemyAI best = null;
            var from = Spout;
            foreach (var e in scratch)
            {
                if (!e || !e.Health || e.Health.IsBoss || e is FlyingEnemyAI || e is FounderAI || Bronze.On(e) != null) continue;
                var head = AllyHead(e);
                if (Combat.Blocked(from, head, null)) continue;
                if (!best || e.Health.maxHealth > best.Health.maxHealth) best = e;
            }
            scratch.Clear();
            return best;
        }

        /// <summary>同伴头顶（浇铸落点）：碰撞体顶上，至少离地 0.6 m</summary>
        static Vector3 AllyHead(EnemyAI e)
        {
            var col = e.GetComponent<CapsuleCollider>();
            float h = col ? col.bounds.size.y : 1.6f;
            return e.transform.position + Vector3.up * Mathf.Max(0.6f, h * 0.95f);
        }

        void BeginPour(EnemyAI t)
        {
            target = t;
            windTime = Windup(PourWindup, 0.5f);
            SetState("pourWindup");
            PlayTimed("pourWindup", windTime);
            if (Application.isPlaying)
            {
                float r = Mathf.Max(0.9f, EnemyRegistry.BodyRadius(t) * 2.2f);
                targetMark = Telegraph.Circle(t.transform.position, r, windTime, Molten);
            }
            Sfx("telegraph", 0.45f, 0.8f);
        }

        /// <summary>前摇结束：坩埚一倾，熔铜从流嘴抛出去（一团熔铜沿抛物线飞向同伴头顶）</summary>
        void StartStream()
        {
            targetMark = default;
            if (!target)
            {
                InterruptAttack();
                return;
            }
            pourFrom = Spout;
            pourTo = AllyHead(target);
            poured = false;
            SetState("pouring");
            Play("pouring", 0.06f);
            GameAudio.PlayAt("skill_fire", pourFrom, 0.7f, 0.7f);
            if (!Application.isPlaying) return;
            Fx.Burst(pourFrom, Spark, 10, 2, 0.4f, 0.06f, 4);
            // FX4 熔铜流（同 TS MoltenStream）：液流头跟着流嘴甩到同伴头顶，停一下，尾巴再追过去
            var ally = target;
            Vector3 lastFrom = pourFrom, lastTo = pourTo;
            // 熔铜匠 / 同伴中途被打死、回收：液流停在最后的位置上收尾，不去读已经销毁的物体
            MoltenStream.Pour(() => this && !Dead ? lastFrom = Spout : lastFrom, () => ally && !ally.Dead ? lastTo = AllyHead(ally) : lastTo, PourFlight, 0.3f, Size);
        }

        /// <summary>液流：起点跟着流嘴、落点跟着同伴头顶，沿抛物线冒熔铜点；到点时浇上铜甲</summary>
        void UpdateStream()
        {
            var t = target;
            float u = stateTime / PourFlight;
            if (t && !t.Dead) pourTo = AllyHead(t);
            pourFrom = Spout;
            if (poured || u < 1) return;
            poured = true;
            if (t && !t.Dead && Bronze.Grant(t, elite ? 1.3f : 1f) != null && Application.isPlaying)
            {
                var c = EnemyRegistry.Center(t);
                Fx.MoltenSplash(pourTo, 0.8f, MoltenHot);
                Fx.Burst(c, Molten, 14, 2, 0.7f, 0.07f, 6);
                GameAudio.PlayAt("burn_tick", c, 0.8f, 0.6f);
            }
        }

        /// <summary>抛物线上参数 u（0 = 起点，1 = 终点）处的点：两端连线再向上抬 4·apex·u·(1−u)（同 TS pourArc）</summary>
        public static Vector3 PourArc(Vector3 from, Vector3 to, float apex, float u) =>
            Vector3.Lerp(from, to, u) + Vector3.up * (4 * apex * u * (1 - u));

        // ───────────── 泼铜 ─────────────

        void BeginFling()
        {
            windTime = Windup(FlingWindup, 0.4f);
            SetState("flingWindup");
            PlayTimed("flingWindup", windTime);
            if (Application.isPlaying) flingMark = Telegraph.Circle(transform.position, FlingRadius, windTime, Ember);
            Sfx("telegraph", 0.5f, 1.1f);
        }

        /// <summary>甩一圈：圈内烫一下，地上留 3 m 熔铜区烧 4 s，然后退开</summary>
        void ReleaseFling()
        {
            flingMark = default;
            ReleaseAttack();
            var c = transform.position;
            var pv = PlayerVitals.Instance;
            if (Taunted) DecoyBlocked(Target);
            else if (pv && HazardZone.Contains(c, FlingRadius, 0, 0.35f, -1.6f, 1.6f, pv.transform.position))
                Combat.DamagePlayer(Damage * FlingHit, c + Vector3.up, Element.Fire, this);
            MoltenPool(c, FlingRadius, FlingPool, Damage * FlingTick, 0, this);
            if (Application.isPlaying)
            {
                for (int i = 0; i < 10; i++)
                {
                    float a = i / 10f * Mathf.PI * 2;
                    Fx.MoltenSplash(c + new Vector3(Mathf.Sin(a) * FlingRadius * 0.7f, 0.9f, Mathf.Cos(a) * FlingRadius * 0.7f), 0.45f, Molten);
                }
                Fx.Ring(c, FlingRadius, Molten, 0.4f);
            }
            GameAudio.PlayAt("skill_fire", c, 0.8f, 0.9f);
            flingCd = FlingCd;
            Glow = 0.2f;
            Play("retreat", 0.1f);
            SetState("retreat");
        }

        /// <summary>
        /// 一摊熔铜（同 TS spawnFirePool）：对玩家是一片地火（<see cref="FloorFire"/>，每 0.5 s playerDamage，祸斗能吃）；
        /// allyFrac &gt; 0 时还每 0.5 s 烫站在里面的地面敌人（最大生命 × allyFrac 火伤，含熔铜匠自己；首领、飞行的不算），被吃掉 / 烧完就停
        /// </summary>
        public static FloorFire MoltenPool(Vector3 center, float radius, float life, float playerDamage, float allyFrac, Object source)
        {
            if (!Application.isPlaying) return null;
            var fire = FloorFire.Spawn(center, radius, life, playerDamage, 0.5f, source, look: FireBed.Molten);
            if (allyFrac > 0) ScheduleAllyBurn(fire, center, radius, Time.time + life - 0.3f, allyFrac, source);
            return fire;
        }

        static readonly List<EnemyAI> burnScratch = new();

        static void ScheduleAllyBurn(FloorFire fire, Vector3 center, float radius, float until, float allyFrac, Object source)
        {
            HazardClock.Delay(0.5f, () =>
            {
                if (!fire || fire.Eaten || fire.Ended || HazardClock.Now >= until || EnemyRegistry.Purging) return;
                EnemyRegistry.InRadius(center, radius + 0.5f, burnScratch, EnemyQuery.Targetable);
                foreach (var e in burnScratch.ToArray())
                {
                    if (!e || e.Dead || e is FlyingEnemyAI || !e.Health || e.Health.IsBoss) continue;
                    var p = e.transform.position;
                    if (Mathf.Abs(p.y - center.y) >= 1) continue;
                    if (new Vector2(p.x - center.x, p.z - center.z).magnitude > radius + EnemyRegistry.BodyRadius(e) * 0.5f) continue;
                    var info = DamageInfo.Simple(e.Health.maxHealth * allyFrac, DamageSource.Status, p + Vector3.up * 0.2f, Vector3.up);
                    info.element = Element.Fire;
                    info.noCrit = true;
                    info.depth = 2;
                    info.instigator = source ? source : null;
                    Combat.DamageEnemy(e.Health, info);
                }
                burnScratch.Clear();
                ScheduleAllyBurn(fire, center, radius, until, allyFrac, source);
            });
        }

        // ───────────── 裂锅 / 死亡 ─────────────

        /// <summary>
        /// 从玩家视点看过去，坩埚被他自己的头挡住：视线（眼 → 坩埚中心）穿过头部球（半径 0.2 × 体型）。纯函数，测试直接调
        /// </summary>
        public static bool HeadShields(Vector3 eye, Vector3 crucible, Vector3 head, float headRadius)
        {
            var seg = crucible - eye;
            float len2 = seg.sqrMagnitude;
            if (len2 < 1e-6f) return false;
            float t = Mathf.Clamp01(Vector3.Dot(head - eye, seg) / len2);
            // 头要在眼和坩埚之间（靠坩埚那一端的不算：头在坩埚后面不挡）
            if (t >= 0.999f) return false;
            return Vector3.Distance(eye + seg * t, head) <= headRadius;
        }

        void OnCrucibleHit(HitZone z, DamageInfo info, DamageResult r)
        {
            if (Silenced || Dead || !info.weakpoint || r.total <= 0) return;
            crucibleDamage += r.total;
            body.SetGlow(0, 1);
            if (crucibleDamage >= hp.maxHealth * CrucibleBreak) CrackCrucible();
            else GameAudio.PlayAt("hit_armor", info.point, 0.7f, 0.8f);
        }

        /// <summary>裂锅：不再浇甲，踉跄 1.2 s，熔铜漏一地（烫玩家、身边的同伴和他自己）</summary>
        void CrackCrucible()
        {
            Silenced = true;
            InterruptAttack();
            var p = body.WeakPoint ? body.WeakPoint.position : transform.position + Vector3.up;
            if (Application.isPlaying)
            {
                Fx.MoltenSplash(p, 1.4f, Molten);
                Fx.Basalt(p, 0.8f, Slag);
                GameUI.FloatText(p + Vector3.up * 0.3f, "坩埚裂了", Molten, 1f);
            }
            GameAudio.PlayAt("shield_break", p, 1f, 0.6f);
            Sfx("boss_roar", 0.35f, 1.8f);
            MoltenPool(transform.position + Vector3.up * 0.02f, LeakRadius, LeakLife, Damage * FlingTick, LeakAllyFrac, this);
            dripTimer = DripEvery;
            Play("crackStagger", 0.06f);
            SetState("crackStagger");
        }

        /// <summary>裂锅后走到哪漏到哪：每隔一阵在脚下留一小摊</summary>
        void Drip(float dt)
        {
            dripTimer -= dt;
            if (dripTimer > 0) return;
            dripTimer = DripEvery;
            MoltenPool(transform.position + Vector3.up * 0.02f, DripRadius, DripLife, Damage * 0.25f, LeakAllyFrac * 0.5f, this);
        }

        protected override void CancelAttack()
        {
            SetGlow(0, 0);
            SetGlow(1, 0);
            targetMark.Cancel();
            flingMark.Cancel();
            targetMark = default;
            flingMark = default;
            target = null;
            if (!Dead && state is not ("stalk" or "enter" or "crackStagger" or IdleState or "spawn"))
            {
                PlayLocomotion();
                SetState("stalk");
            }
        }

        void OnDeath(DamageInfo info)
        {
            Silenced = true;
            if (EnemyRegistry.Purging || info.Has(DamageTag.Purge) || !Application.isPlaying) return;
            var p = body.WeakPoint ? body.WeakPoint.position : transform.position + Vector3.up;
            Fx.MoltenSplash(p, 1.4f, Molten);
            Fx.Basalt(EnemyRegistry.Center(this), 0.9f, Slag);
            MoltenPool(transform.position + Vector3.up * 0.02f, 1.8f, 3, Damage * 0.25f, 0, null);
        }

        /// <summary>每帧（动画之后）：玩家视线被头挡住时坩埚不算弱点（正面平视打不到，绕后 / 居高才行）</summary>
        void LateUpdate()
        {
            if (Dead || !body.WeakZone || !body.WeakPoint) return;
            var pv = PlayerVitals.Instance;
            if (!pv) return;
            var motor = pv.GetComponent<Spiritfire.Art.PlayerMotor>();
            var eye = motor && motor.eye ? motor.eye.position : pv.transform.position + Vector3.up * Sight.PlayerEye;
            body.WeakZone.SetWeakPoint(!HeadShields(eye, body.WeakPoint.position, RealHead, HeadR * Size));
        }

        // ───────────── 铜甲 ─────────────

        /// <summary>
        /// 一副铜甲（TS grantBronze / tickBronze，一次浇铸 = 一个加成来源）：
        ///   浇上：护甲层 pool = round(同伴最大生命 × 0.6 × scale)，叠在原有护甲上（maxArmor += pool、armor = 原有 + pool），
        ///     加成通道 <see cref="Channel"/> 先登记「受伤 ×2」（通红）；
        ///   <see cref="Tick"/>：通红 2.5 s 后换成「受伤 ×0.5」（冷青铜）；剩余护甲（armor − 原有，夹到 [0, pool]）≤ 0.5 = 被打穿（碎）；
        ///     到 2.5 + 12 s 剥落；同伴死了 / 没了就撤。撤掉时把剩下的甲收回、加成撤销（熔铜匠死了不影响）。
        /// 纯逻辑（Damageable + EnemyBuffs），EditMode 可测；Play 里由挂在同伴身上的 <see cref="FounderBronze"/> 每帧推进并画铜色。
        /// </summary>
        public sealed class Bronze : IBuffSource
        {
            /// <summary>加成通道（同一时间一只同伴只有一副铜甲）</summary>
            public const string Channel = "founder.bronze";
            public static readonly BuffMods HotMods = new(1, 1, 1, HotTaken), ColdMods = new(1, 1, 1, ColdTaken);

            /// <summary>Tick 的结果：没事 / 刚冷却 / 被打碎 / 到时剥落（或同伴没了）</summary>
            public enum Step { None, Cooled, Shattered, Peeled }

            public readonly Damageable hp;
            readonly EnemyBuffs buffs;
            public float Pool { get; private set; }
            public float Base { get; private set; }
            public float Start { get; private set; }
            public float HotUntil { get; private set; }
            public float Until { get; private set; }
            public bool Cold { get; private set; }
            public bool Ended { get; private set; }

            public bool BuffActive => !Ended;

            /// <summary>剩余护甲（这副铜甲的部分）</summary>
            public float Left => hp ? Mathf.Clamp(hp.armor - Base, 0, Pool) : 0;

            Bronze(Damageable hp, EnemyBuffs buffs)
            {
                this.hp = hp;
                this.buffs = buffs;
            }

            static readonly Dictionary<Damageable, Bronze> live = new();

            [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
            static void ResetStatics() => live.Clear();

            /// <summary>这只同伴身上的铜甲（没有返回 null）</summary>
            public static Bronze On(Damageable d) => d && live.TryGetValue(d, out var b) && !b.Ended ? b : null;

            public static Bronze On(EnemyAI e) => e ? On(e.Health) : null;

            /// <summary>给同伴浇上铜甲（Play 里另挂 <see cref="FounderBronze"/> 推进）；已有铜甲 / 死了返回 null</summary>
            public static Bronze Grant(EnemyAI ally, float scale = 1)
            {
                if (!ally || ally.Dead) return null;
                var b = Grant(ally.Health, ally.Buffs, scale, Time.time);
                if (b != null && Application.isPlaying) ally.gameObject.AddComponent<FounderBronze>().Bind(b, ally);
                return b;
            }

            /// <summary>纯逻辑版本（测试用）：now = 浇上的时刻</summary>
            public static Bronze Grant(Damageable hp, EnemyBuffs buffs, float scale, float now)
            {
                if (!hp || hp.Dead || buffs == null || On(hp) != null) return null;
                var b = new Bronze(hp, buffs)
                {
                    Pool = Mathf.Max(1, RoundHp(hp.maxHealth * BronzeArmor * scale)),
                    Base = Mathf.Max(0, hp.armor),
                    Start = now,
                    HotUntil = now + BronzeHot,
                    Until = now + BronzeHot + BronzeCold,
                };
                hp.maxArmor += b.Pool;
                hp.armor = b.Base + b.Pool;
                buffs.Set(Channel, b, HotMods);
                live[hp] = b;
                return b;
            }

            /// <summary>推进到 now：返回这一步发生了什么（结束后总是 None）</summary>
            public Step Tick(float now)
            {
                if (Ended) return Step.None;
                if (!hp || hp.Dead)
                {
                    End(false);
                    return Step.Peeled;
                }
                if (Left <= 0.5f)
                {
                    End(true);
                    return Step.Shattered;
                }
                if (now >= Until)
                {
                    End(false);
                    return Step.Peeled;
                }
                if (!Cold && now >= HotUntil)
                {
                    // 冷却：通红那档到期，换上冷青铜那档
                    Cold = true;
                    buffs.Set(Channel, this, ColdMods);
                    return Step.Cooled;
                }
                return Step.None;
            }

            /// <summary>撤掉：把这副铜甲剩下的护甲收回（shatter 只是表现上的区别），加成撤销</summary>
            public void End(bool shatter)
            {
                if (Ended) return;
                Ended = true;
                Shattered = shatter;
                buffs.Remove(Channel, this);
                if (hp && live.TryGetValue(hp, out var cur) && cur == this) live.Remove(hp);
                if (!hp || hp.Dead) return;
                float left = Mathf.Clamp(hp.armor - Base, 0, Pool);
                hp.armor = Mathf.Max(0, hp.armor - left);
                hp.maxArmor = Mathf.Max(hp.armor, hp.maxArmor - Pool);
            }

            /// <summary>是被打碎的（而不是剥落）</summary>
            public bool Shattered { get; private set; }

            /// <summary>通红的程度：通红阶段 1，冷却后 0.9 s 内淡到 0</summary>
            public float Heat(float now) => !Cold ? 1 : Mathf.Max(0, 1 - (now - HotUntil) / 0.9f);
        }
    }

    /// <summary>
    /// 同伴身上的铜甲（<see cref="FounderAI.Bronze"/> 的 Play 外壳）：每帧推进阶段，画铜色——通红阶段熔铜色覆盖（随冷却淡掉），
    /// 冷青铜阶段整身染青铜色；被打碎崩飞铜片、到时剥落掉铜绿碎屑。结束时撤掉着色并移除自己
    /// </summary>
    [AddComponentMenu("")]
    public sealed class FounderBronze : MonoBehaviour
    {
        const string Tint = "founder.bronze";
        FounderAI.Bronze coat;
        EnemyAI ally;

        public FounderAI.Bronze Coat => coat;

        internal void Bind(FounderAI.Bronze b, EnemyAI who)
        {
            coat = b;
            ally = who;
        }

        void Update()
        {
            if (coat == null)
            {
                Destroy(this);
                return;
            }
            float now = Time.time;
            var step = coat.Tick(now);
            var body = ally ? ally.Body : null;
            var c = ally ? EnemyRegistry.Center(ally) : transform.position;
            if (step == FounderAI.Bronze.Step.Cooled) Fx.Burst(c, new Color(0.6f, 0.56f, 0.53f), 12, 1.2f, 1.2f, 0.12f, -1.5f);
            if (coat.Ended)
            {
                if (body)
                {
                    body.ClearOverlay(Tint);
                    body.ClearTint(Tint);
                }
                if (!EnemyRegistry.Purging && ally && !ally.Dead)
                {
                    if (coat.Shattered)
                    {
                        Fx.Burst(c, coat.Cold ? FounderAI.BronzeColor : FounderAI.Molten, 22, 4.5f, 0.8f, 0.08f, 12);
                        Fx.Burst(c, FounderAI.Spark, 10, 3, 0.4f, 0.06f, 4);
                        GameAudio.PlayAt("shield_break", c, 0.75f, coat.Cold ? 0.7f : 1.1f);
                    }
                    else Fx.Burst(c, FounderAI.Verdigris, 10, 1.6f, 0.8f, 0.07f, 6);
                }
                Destroy(this);
                return;
            }
            if (!body) return;
            float heat = coat.Heat(now);
            // 浇上的那一刻从头顶往下盖（0.45 s 盖满）：用覆盖色的强度表现
            float cover = Mathf.Clamp01((now - coat.Start) / 0.45f);
            float wear = 1 - coat.Left / Mathf.Max(1, coat.Pool);
            body.SetOverlay(Tint, Color.Lerp(FounderAI.BronzeColor, FounderAI.Molten, heat), cover * (0.25f + 0.35f * heat) * (1 - 0.5f * wear));
            if (coat.Cold) body.SetTint(Tint, Color.Lerp(Color.white, new Color(0.86f, 0.7f, 0.5f), 1 - heat));
        }

        void OnDestroy()
        {
            if (coat != null && !coat.Ended) coat.End(false);
        }
    }
}
