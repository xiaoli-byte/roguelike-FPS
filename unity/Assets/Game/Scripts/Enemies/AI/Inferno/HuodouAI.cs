using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 祸斗（Three.js 版 src/enemies/types/Huodou.ts）：第三章群怪，食火吐火的黑犬。
    ///   包抄：同一群按编号分角色——0 号守在玩家正前方 6 m 吠叫（吸引视线），其余绕到玩家两侧和身后 4.5 m；绕到身后时低吼（听声辨位）。
    ///         就位、冷却好了就从侧后扑上来。
    ///   扑咬：3 m 内压低前身 0.3 s（张嘴、火腹一亮）→ 扑出约 2.5 m 咬一口 → 收势 0.55 s。
    ///   食火：8 m 内有火（炭童余烬、地火、熔岩边，<see cref="FireFeed"/> / <see cref="InfernoKit.LavaEdge"/>）就跑过去，
    ///         侧身对着玩家低头吃 1 s（吃的时候侧腹正对玩家，是打弱点的好时机）；每吃一次体型大一圈（+8%）、火腹判定 +15%，最多 3 次。
    ///   吐火：吃过火才会。腹部起伏 0.6 s（扇形预警由内向外填满）→ 喷 0.8 s 扇形火（半角 26°，射程 6.5 + 1.5 × 吃火次数，每 0.2 s 一跳 ×0.3，掩体挡得住）
    ///         → 肚子空了（体型、火光回到原样）→ 收势 0.9 s。
    ///   弱点：两侧肋间的熔火腹（左右各一个命中区，从侧面打）。
    /// 状态：run → biteWindup → bite → recover；run → seekFire → eat → run；run → spitWindup → spit → recover。
    /// </summary>
    public sealed class HuodouAI : InfernoEnemyAI
    {
        /// <summary>包抄：正面守位距离、侧后包抄距离、就位判定、各角色相对玩家视线的方位（弧度，0 = 正前方）</summary>
        public const float FrontR = 6f, FlankR = 4.5f, SlotArrive = 1.8f;
        public static readonly float[] SlotAngles = { 0, 1.4f, -1.4f, Mathf.PI, 2.35f, -2.35f };
        /// <summary>吠叫间隔、低吼间隔、「在玩家视线后方」的余弦阈值</summary>
        public const float BarkMin = 1.0f, BarkMax = 1.6f, GrowlGap = 3.5f, BehindCos = -0.3f;
        /// <summary>扑咬：触发距离、前摇、扑出速度 / 最长时间、命中距离、收势</summary>
        public const float BiteRange = 3f, BiteWindup = 0.3f, BiteSpeed = 10f, BiteTime = 0.3f, BiteHit = 1.3f, BiteRecover = 0.55f;
        /// <summary>食火：找火的距离、吃的时长、最多吃几次、吃完的间隔、站位离火多远（放大前）、跑过去的超时</summary>
        public const float EatSeek = 8f, EatTime = 1f, EatGap = 1.2f, EatReach = 0.35f, SeekTimeout = 3.5f;
        public const int MaxMeals = 3;
        /// <summary>每吃一次：体型、火腹判定放大多少</summary>
        public const float GrowPerMeal = 0.08f, WeakPerMeal = 0.15f;
        /// <summary>吐火：前摇、时长、跳伤间隔与倍率、扇形半角（弧度）、射程（基础 + 每次吃火）、收势</summary>
        public const float SpitWindup = 0.6f, SpitTime = 0.8f, SpitTick = 0.2f, SpitTickMult = 0.3f, SpitHalf = 0.45f, SpitBase = 6.5f, SpitPerMeal = 1.5f, SpitRecover = 0.9f;

        /// <summary>美术网格实测（模型单位，脚底原点，面朝 +Z，X = 左）：嘴、左肋火腹</summary>
        static readonly Vector3 MouthPoint = new(0, 0.87f, 0.47f), FlankPoint = new(0.075f, 0.56f, 0.1f);

        /// <summary>同一群的编号（按出生先后）与刷新时间</summary>
        static readonly Dictionary<HuodouAI, int> roles = new();
        static readonly List<HuodouAI> pack = new();
        static float roleStamp = float.NegativeInfinity;
        static int serialCounter;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            roles.Clear();
            pack.Clear();
            roleStamp = float.NegativeInfinity;
            serialCounter = 0;
        }

        /// <summary>吃过几次火（0..3），吐火后清零</summary>
        public int Meals { get; private set; }
        /// <summary>正在去吃 / 正在吃的火</summary>
        public IFireSource FireTarget { get; private set; }
        /// <summary>最近一次低吼的时刻（测试 / 冒烟用）</summary>
        public float LastGrowl { get; private set; } = float.NegativeInfinity;
        /// <summary>本只在群里的编号（0 = 正面吠叫）</summary>
        public int Role => RoleOf(this);
        /// <summary>当前吐火射程（米）</summary>
        public float SpitReach => SpitRangeFor(Meals);

        int serial;
        float growth = 1, eatCooldown, eatYaw, windTime = BiteWindup, recoverTime = 0.5f, spitYaw, spitRange = SpitBase, spitTick;
        float barkTimer, growlTimer, barkUntil, suckAcc, flameAcc;
        bool biteHit;
        Vector3 stand, biteDir, baseScale = Vector3.one;
        Transform mouth;
        HitZone flankR;
        TelegraphHandle cone;
        /// <summary>FX4：肋间火腹的火舌（同 TS FLANK_TONGUES）、嘴里的火（吐火 / 吃火时蹿出来）</summary>
        BoneFlames flankFire, mouthFire;
        static readonly Color TongueHot = Hex.Rgb(0xfff0c0), TongueMid = Hex.Rgb(0xff9a30), TongueTip = Hex.Rgb(0xd8401a);
        static readonly (string, Vector3, float)[] FlankTongues =
        {
            ("chest", new(0.085f, 0.55f, 0.12f), 0.1f), ("spine", new(0.08f, 0.6f, -0.02f), 0.1f),
            ("chest", new(-0.085f, 0.55f, 0.12f), 0.1f), ("spine", new(-0.08f, 0.6f, -0.02f), 0.1f),
        };
        static readonly (string, Vector3, float)[] MouthTongue = { ("jaw", new(0, 0.85f, 0.45f), 0.12f) };

        /// <summary>吃过 meals 次火的吐火射程</summary>
        public static float SpitRangeFor(int meals) => SpitBase + SpitPerMeal * Mathf.Max(1, meals);

        protected override void Awake()
        {
            base.Awake();
            serial = ++serialCounter;
            GlowStyle(0.25f, 0.06f, 6f, 0.7f, false);
            // 弱点 = 两侧肋间的熔火腹：左侧是身体的弱点球，右侧另加一个弱点区
            InfernoKit.PlaceWeak(body, "chest", FlankPoint, 0.11f);
            flankR = InfernoKit.AddSphereZone(body, "chest", new Vector3(-FlankPoint.x, FlankPoint.y, FlankPoint.z), 0.11f, "weak_r", true, 10, true);
            mouth = InfernoKit.Anchor(transform, "head", MouthPoint, "Mouth");
            barkTimer = Rand(0.3f, 1.2f);
            hp.Died += OnHuodouDied;
            // FX4：炭黑毛里的熔岩光（火腹裂口、嘴、眼睛）按色键自发光（_FLAMEKEY）+ 火腹 / 嘴里的火舌
            if (Application.isPlaying && !GetComponent<PlaceholderBody>())
            {
                FlameKey.Attach(this, () => Dead ? 0 : 0.35f + 0.25f * Meals + 0.6f * Mathf.Max(state == "spit" ? 1 : 0, Heave) + 0.06f * Mathf.Sin(age * 6f), Hex.Rgb(0xff7a22));
                flankFire = BoneFlames.Build(transform, FlankTongues, TongueHot, TongueMid, TongueTip);
                mouthFire = BoneFlames.Build(transform, MouthTongue, TongueHot, TongueMid, TongueTip, "head");
            }
        }

        /// <summary>吐火前摇时火腹一鼓一鼓（同 TS heave）</summary>
        float Heave => state == "spitWindup" ? 0.5f + 0.5f * Mathf.Sin(stateTime * 22f) : 0;

        /// <summary>火舌跟着吃火次数 / 吐火蹿高（同 TS：火腹随吃火变亮变大，嘴里的火吐火时蹿出来）</summary>
        void UpdateFlames()
        {
            float heave = Heave;
            flankFire?.Update(age, Mathf.Clamp01(0.25f + 0.22f * Meals + 0.4f * heave), 0.5f + 0.35f * Meals + 0.6f * heave, 0.8f, 1f, 0.15f, 14f);
            float m = Mathf.Max(state == "spit" ? 1 : 0, state == "eat" ? 0.4f : 0, Meals > 0 ? 0.15f : 0);
            mouthFire?.Update(age, m > 0.05f ? Mathf.Clamp01(m * 1.3f) : 0, (0.3f + 1.2f * m) * (1 + 0.15f * Mathf.Sin(age * 25f)), 0.8f, 1f, 0f);
        }

        protected override void Start()
        {
            base.Start();
            cooldown = Rand(0.8f, 1.8f);
            baseScale = transform.localScale;
        }

        protected override string InitialState => "run";

        /// <summary>同一群的编号（每半秒按出生先后重排一次）</summary>
        static int RoleOf(HuodouAI self)
        {
            float now = Time.time;
            if (now - roleStamp > 0.5f || now < roleStamp)
            {
                roleStamp = now;
                roles.Clear();
                pack.Clear();
                foreach (var e in EnemyRegistry.Live)
                    if (e is HuodouAI h && !h.Dead)
                        pack.Add(h);
                pack.Sort((a, b) => a.serial.CompareTo(b.serial));
                for (int i = 0; i < pack.Count; i++) roles[pack[i]] = i;
            }
            return roles.TryGetValue(self, out int r) ? r : 0;
        }

        /// <summary>第 role 号的包抄站位：玩家位置 + 视线方向转 SlotAngles[role] 后 × 距离（0 号 6 m、其余 4.5 m）</summary>
        public static Vector3 SlotFor(int role, Vector3 playerPos, Vector3 playerForward)
        {
            var f = playerForward;
            f.y = 0;
            f = f.sqrMagnitude > 1e-6f ? f.normalized : Vector3.forward;
            float a = SlotAngles[Mathf.Abs(role) % SlotAngles.Length];
            float r = role == 0 ? FrontR : FlankR;
            var s = new Vector3(f.x * Mathf.Cos(a) - f.z * Mathf.Sin(a), 0, f.x * Mathf.Sin(a) + f.z * Mathf.Cos(a));
            return playerPos + s * r;
        }

        protected override void Think(float dt)
        {
            float d = DistToPlayer;
            if (eatCooldown > 0) eatCooldown -= dt;
            growlTimer -= dt;
            UpdateGrowth(dt);
            UpdateFlames();
            switch (state)
            {
                case "run":
                    Run(dt, d);
                    break;
                case "biteWindup":
                    // 压低前身、张嘴，火腹一亮
                    Stop();
                    FacePlayer(10 * Mathf.Rad2Deg, dt);
                    Glow = 0.4f + 0.6f * Mathf.Clamp01(stateTime / windTime);
                    if (stateTime >= windTime) LaunchBite();
                    break;
                case "bite":
                {
                    Glow = 1;
                    var v = ManualVelocity;
                    SetManualVelocity(new Vector3(biteDir.x * BiteSpeed, v.y, biteDir.z * BiteSpeed));
                    if (!biteHit && d <= BiteHit + 0.4f && VerticalReach(1.4f))
                    {
                        biteHit = Melee(BiteHit, Damage, 0.3f);
                        if (biteHit) Fx.Burst(TargetChest, InfernoKit.Spark, 8, 3, 0.3f, 0.06f, 4);
                    }
                    if (stateTime >= BiteTime || biteHit || (HitWall && stateTime > 0.1f))
                    {
                        EndManualMotion();
                        ToRecover(BiteRecover);
                    }
                    break;
                }
                case "seekFire":
                    SeekFire(dt);
                    break;
                case "eat":
                {
                    // 低头吃火：侧腹对着玩家（站位就是按这个挑的）
                    var src = FireTarget;
                    Stop();
                    Facing = eatYaw + Mathf.Sin(stateTime * 9) * 0.03f;
                    Glow = 0.4f + 0.4f * Mathf.Clamp01(stateTime / EatTime);
                    if (src == null || !src.Edible)
                    {
                        DropFire();
                        break;
                    }
                    SuckFx(src, dt);
                    if (stateTime >= EatTime) FinishEat(src);
                    break;
                }
                case "spitWindup":
                {
                    // 腹部起伏、喉咙发亮；朝向锁死（扇形预警与喷火方向一致）
                    Stop();
                    Facing = spitYaw;
                    Glow = 0.5f + 0.5f * Mathf.Clamp01(stateTime / windTime);
                    if (stateTime >= windTime)
                    {
                        spitTick = 0;
                        Act("spit", 0.05f);
                        SetState("spit");
                        Sfx("skill_fire", 0.9f, 0.8f);
                    }
                    break;
                }
                case "spit":
                    Stop();
                    Facing = spitYaw;
                    Glow = 1;
                    spitTick -= dt;
                    if (spitTick <= 0)
                    {
                        spitTick += SpitTick;
                        BreathDamage();
                    }
                    FlameFx(dt);
                    if (stateTime >= SpitTime)
                    {
                        cone.FadeOut();
                        // 肚子空了：体型、火光回到原样
                        Meals = 0;
                        ReleaseAttack();
                        RollCooldown(1.8f, 2.8f);
                        ToRecover(SpitRecover);
                    }
                    break;
                case "recover":
                    Stop();
                    Glow = 0.15f;
                    FacePlayer(4 * Mathf.Rad2Deg, dt);
                    if (stateTime >= recoverTime / Mathf.Sqrt(Mathf.Max(0.1f, auraAttackRate)))
                    {
                        ReleaseAttack();
                        ToRun();
                    }
                    break;
                default:
                    ToRun();
                    break;
            }
        }

        void ToRun()
        {
            Loco();
            SetState("run");
        }

        void ToRecover(float time)
        {
            recoverTime = time;
            Act("recover");
            SetState("recover");
        }

        /// <summary>体型随吃火次数平滑变化（5/s），火腹判定跟着放大</summary>
        void UpdateGrowth(float dt)
        {
            growth = Mathf.Lerp(growth, 1 + GrowPerMeal * Meals, 1 - Mathf.Exp(-5f * dt));
            transform.localScale = baseScale * growth;
            float weak = 1 + WeakPerMeal * Meals;
            if (body.WeakZone) body.WeakZone.SetRadiusScale(weak);
            if (flankR) flankR.SetRadiusScale(weak);
        }

        /// <summary>追击：近了扑咬；吃过火就吐火；身边有火就去吃；否则按角色包抄</summary>
        void Run(float dt, float d)
        {
            Glow = 0.15f + 0.1f * Meals;
            bool reach = VerticalReach(1.4f);
            if (cooldown <= 0 && sees && reach && d <= BiteRange && RequestAttack(AttackTokens.Kind.Melee, 1.4f))
            {
                windTime = Windup(BiteWindup, 0.22f);
                Stop();
                ActTimed("biteWindup", windTime);
                SetState("biteWindup");
                Sfx("enemy_alert", 0.5f, 1.1f);
                return;
            }
            if (Meals > 0 && cooldown <= 0 && sees && reach && d >= 2 && d <= SpitReach * 0.85f
                && RequestAttack(AttackTokens.Kind.Ranged, SpitWindup + SpitTime + 0.5f))
            {
                StartSpit();
                return;
            }
            if (Meals < MaxMeals && eatCooldown <= 0 && !(d < BiteRange + 0.5f && cooldown <= 0))
            {
                var src = FireFeed.Find(transform.position, EatSeek, this) ?? InfernoKit.LavaEdge(transform.position, EatSeek);
                if (src != null && ClaimFire(src)) return;
            }
            if (!sees && blindTime > 0.6f)
            {
                MoveTo(PlayerPos, moveSpeed);
                FaceMovement(8 * Mathf.Rad2Deg, dt);
                return;
            }
            // 包抄：按角色去玩家正前方 / 两侧 / 身后的站位
            int role = Role;
            var fwd = Taunted || !player ? transform.forward * -1 : player.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-6f ? fwd.normalized : Vector3.forward;
            var slot = OnNav(SlotFor(role, PlayerPos, fwd));
            var toSlot = slot - transform.position;
            toSlot.y = 0;
            float slotDist = toSlot.magnitude;
            var away = transform.position - PlayerPos;
            away.y = 0;
            // 绕到身后：低吼
            bool behind = Vector3.Dot(away, fwd) / Mathf.Max(0.01f, d) < BehindCos;
            if (behind && d < 10 && growlTimer <= 0)
            {
                growlTimer = GrowlGap;
                LastGrowl = Time.time;
                Sfx("enemy_alert", 0.7f, 0.42f);
            }
            float r = role == 0 ? FrontR : FlankR;
            if (role == 0)
            {
                // 正面：守在前方吠叫，冷却好了自己压上去
                barkTimer -= dt;
                if (barkTimer <= 0 && sees && d < 14)
                {
                    barkTimer = Rand(BarkMin, BarkMax);
                    Sfx("enemy_alert", 0.6f, 0.95f);
                    // 吠叫片段是站着录的：只在站住时播
                    if (agent.velocity.sqrMagnitude < 1f && barkUntil <= Time.time)
                    {
                        barkUntil = Time.time + 0.5f;
                        Act("bark", 0.06f);
                    }
                }
                if (barkUntil > 0 && Time.time >= barkUntil)
                {
                    barkUntil = 0;
                    Loco();
                }
                if (cooldown <= 0 && d < FrontR + 1) MoveTo(PlayerPos - (d > 0.01f ? -away / d : Vector3.zero) * 1.5f, moveSpeed);
                else if (slotDist > 1) MoveTo(slot, moveSpeed);
                else KeepRange(FrontR - 1, FrontR + 1, moveSpeed * 0.4f, 1);
                if (d < 12) FacePlayer(8 * Mathf.Rad2Deg, dt);
                else FaceMovement(8 * Mathf.Rad2Deg, dt);
                return;
            }
            // 侧后：先绕到位，就位且冷却好了就扑上来
            if (cooldown <= 0 && (slotDist <= SlotArrive || d <= BiteRange + 1.5f))
            {
                MoveTo(PlayerPos + (d > 0.01f ? away / d : Vector3.zero) * 1.5f, moveSpeed);
                FaceMovement(10 * Mathf.Rad2Deg, dt);
                return;
            }
            if (slotDist > 0.8f)
            {
                // 绕：离玩家太近时先往外拐一点，免得从玩家脸前穿过去
                if (d < r - 1 && d > 0.01f)
                {
                    var dir = (toSlot / Mathf.Max(0.01f, slotDist) + away / d * 0.6f).normalized;
                    MoveTo(transform.position + dir * 2.5f, moveSpeed);
                }
                else MoveTo(slot, moveSpeed);
                FaceMovement(10 * Mathf.Rad2Deg, dt);
            }
            else
            {
                Stop();
                FacePlayer(6 * Mathf.Rad2Deg, dt);
            }
        }

        /// <summary>
        /// 吃火的站位：侧身对着玩家（嘴对着火、身体与玩家视线垂直），挑离自己近的那一侧；熔岩边就近站在岸上（导航网格）。
        /// reach = 站位离火中心多远
        /// </summary>
        public static Vector3 EatStand(Vector3 fire, Vector3 playerPos, Vector3 self, float reach)
        {
            var p = new Vector3(-(playerPos.z - fire.z), 0, playerPos.x - fire.x);
            p = p.sqrMagnitude > 1e-6f ? p.normalized : Vector3.right;
            if (Vector3.Dot(self - fire, p) < 0) p = -p;
            return new Vector3(fire.x + p.x * reach, self.y, fire.z + p.z * reach);
        }

        /// <summary>占住一处火，挑站位，跑过去</summary>
        bool ClaimFire(IFireSource src)
        {
            bool lava = src.Kind == FireKind.Lava;
            if (lava)
            {
                // 熔岩点 → 最近的岸（导航网格不含熔岩）
                if (!UnityEngine.AI.NavMesh.SamplePosition(src.Position, out var hit, 3f, UnityEngine.AI.NavMesh.AllAreas)) return false;
                var dd = hit.position - src.Position;
                dd.y = 0;
                if (dd.magnitude > 3f) return false;
                stand = hit.position;
            }
            else
            {
                if (!FireFeed.Claim(src, this)) return false;
                float reach = EatReach * Mathf.Abs(baseScale.x) * growth + src.Radius * 0.3f;
                stand = OnNav(EatStand(src.Position, PlayerPos, transform.position, reach), 1.5f);
            }
            FireTarget = src;
            Loco();
            SetState("seekFire");
            return true;
        }

        void SeekFire(float dt)
        {
            var src = FireTarget;
            if (src == null || !src.Edible || (src.ClaimedBy != null && !ReferenceEquals(src.ClaimedBy, this)) || stateTime > SeekTimeout)
            {
                DropFire();
                return;
            }
            var to = stand - transform.position;
            to.y = 0;
            float len = to.magnitude;
            if (len <= 0.35f || (len <= 1.0f && stateTime > 1.5f))
            {
                StartEat();
                return;
            }
            MoveTo(stand, moveSpeed * 1.05f);
            FaceMovement(10 * Mathf.Rad2Deg, dt);
        }

        void DropFire()
        {
            FireFeed.Release(this);
            FireTarget = null;
            if (state is "seekFire" or "eat")
            {
                eatCooldown = 0.6f;
                ToRun();
            }
        }

        void StartEat()
        {
            var src = FireTarget;
            Stop();
            var to = src.Position - transform.position;
            to.y = 0;
            eatYaw = to.sqrMagnitude > 1e-4f ? InfernoKit.Yaw(to) : Facing;
            Facing = eatYaw;
            suckAcc = 0;
            ActTimed("eat", EatTime);
            SetState("eat");
            Sfx("burn_tick", 0.8f, 0.6f);
        }

        /// <summary>火一股一股吸进嘴里</summary>
        void SuckFx(IFireSource src, float dt)
        {
            suckAcc += dt;
            if (suckAcc < 0.07f) return;
            suckAcc = 0;
            var from = src.Position + Vector3.up * 0.1f;
            var to = mouth ? mouth.position : Local(MouthPoint.x, MouthPoint.y, MouthPoint.z);
            Fx.Burst(Vector3.Lerp(from, to, Random.value), Random.value < 0.5f ? InfernoKit.Ember : InfernoKit.Spark, 2, 0.6f, 0.25f, 0.12f, -1);
        }

        /// <summary>吃完：火被吃掉，体型大一圈、火腹更亮</summary>
        void FinishEat(IFireSource src)
        {
            src.Consume();
            FireFeed.Release(this);
            FireTarget = null;
            Meals = Mathf.Min(MaxMeals, Meals + 1);
            eatCooldown = EatGap;
            RollCooldown(0.3f, 0.7f);
            var c = Local(0, 0.6f, 0.05f);
            Fx.Burst(c, InfernoKit.Spark, 18, 3, 0.45f, 0.07f, -1);
            Fx.Burst(c, InfernoKit.Ember, 6, 1.4f, 0.5f, 0.25f, -1);
            Sfx("enemy_alert", 0.7f, 0.6f);
            ToRun();
        }

        void StartSpit()
        {
            spitYaw = YawToTarget;
            Facing = spitYaw;
            spitRange = SpitReach;
            windTime = Windup(SpitWindup, 0.45f);
            Stop();
            cone.FadeOut();
            cone = Telegraph.Sector(transform.position, spitYaw * Mathf.Rad2Deg, SpitHalf * Mathf.Rad2Deg, spitRange, windTime, InfernoKit.Warn);
            ActTimed("spitWindup", windTime);
            SetState("spitWindup");
            Sfx("telegraph", 0.8f, 0.75f);
        }

        /// <summary>玩家脚底 feet 在吐火扇形里（距离、角度留出玩家身宽、高差 1.8 m）</summary>
        public static bool InCone(Vector3 origin, float yaw, float range, Vector3 feet)
        {
            var to = feet - origin;
            if (Mathf.Abs(to.y) > 1.8f) return false;
            to.y = 0;
            float d = to.magnitude;
            if (d > range + InfernoKit.PlayerRadius) return false;
            if (d <= 0.4f) return true;
            float da = Mathf.Abs(InfernoKit.WrapRad(InfernoKit.Yaw(to) - yaw));
            return da <= SpitHalf + Mathf.Atan2(InfernoKit.PlayerRadius, d);
        }

        /// <summary>吐火的一跳：玩家在扇形里且嘴到胸口没有遮挡</summary>
        bool BreathDamage()
        {
            if (!vitals || vitals.Dead || !InCone(transform.position, spitYaw, spitRange, PlayerPos)) return false;
            var from = mouth ? mouth.position : Local(MouthPoint.x, MouthPoint.y, MouthPoint.z);
            if (!Combat.LineClear(from, TargetChest)) return false;
            return HitPlayer(Damage * SpitTickMult, from, Element.Fire);
        }

        /// <summary>喷出来的火（FX4，同 TS BreathCone）：一串火舌团从嘴里沿扇形往外冲、边飞边往上卷，贴地拖火星</summary>
        void FlameFx(float dt)
        {
            flameAcc += dt;
            var from = mouth ? mouth.position : Local(MouthPoint.x, MouthPoint.y, MouthPoint.z);
            while (flameAcc >= 0.025f)
            {
                flameAcc -= 0.025f;
                float a = spitYaw + Random.Range(-SpitHalf, SpitHalf) * 0.85f;
                var dir = InfernoKit.YawDir(a) + Vector3.down * 0.12f;
                Fx.FlameJet(from, dir, spitRange * Random.Range(2.6f, 3.4f), Random.Range(0.35f, 0.6f) * Size, Random.value < 0.6f ? InfernoKit.Ember : InfernoKit.Hot);
                if (Random.value < 0.3f)
                {
                    var p = transform.position + InfernoKit.YawDir(a) * spitRange * Random.Range(0.3f, 0.9f) + Vector3.up * 0.1f;
                    Fx.Burst(p, InfernoKit.Spark, 1, 1.4f, 0.35f, 0.05f, -2);
                }
            }
        }

        void LaunchBite()
        {
            var to = PlayerPos + PlayerVelocity * 0.12f - transform.position;
            to.y = 0;
            biteDir = to.sqrMagnitude > 1e-4f ? to.normalized : transform.forward;
            transform.rotation = Quaternion.LookRotation(biteDir);
            biteHit = false;
            HitWall = false;
            BeginManualMotion(biteDir * (BiteSpeed * 0.6f), LaunchGravity);
            Act("bite", 0.05f);
            SetState("bite");
            Sfx("dash", 0.45f, 1.1f);
        }

        protected override void CancelAttack()
        {
            cone.FadeOut();
            FireFeed.Release(this);
            FireTarget = null;
            if (state is not ("run" or IdleState or "spawn"))
            {
                SetState("run");
                RollCooldown(0.6f, 1.2f);
            }
        }

        void OnHuodouDied(DamageInfo info)
        {
            flankFire?.Hide();
            mouthFire?.Hide();
            cone.FadeOut();
            FireFeed.Release(this);
            if (EnemyRegistry.Purging || info.Has(DamageTag.Purge)) return;
            // 火腹炸开：一团火星（吃得越多越大）
            var c = Local(0, 0.6f, 0.05f);
            Fx.Burst(c, InfernoKit.Spark, 14 + Meals * 8, 3 + Meals, 0.5f, 0.07f, 2);
            Fx.Burst(c, InfernoKit.Ember, 4 + Meals * 3, 1.5f, 0.6f, 0.25f, -1);
        }
    }
}
