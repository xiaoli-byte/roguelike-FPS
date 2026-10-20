using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰灯水母（Three.js 版 src/enemies/types/LanternJelly.ts）：北冥深海里提灯的水母，漂在半空（触须末端离地约 0.95 m，上下浮动 0.12 m），
    /// 用发光的触须连着同伴给它们续命。
    ///   站位：漂在同伴（22 m 内）质心后方 3 m、离玩家 9–15 m；没有同伴就和玩家保持 9–15 m
    ///   回血连线：12 m 内最多连 3 个同伴（先连缺血比例最大的，一样时连近的），光触须从一条朝向同伴的触须末端伸过去（0.5 s 连上），
    ///         连上后每秒回同伴最大生命的 4%（精英 ×1.25）。断开：
    ///         1. 挡住视线：灯芯到同伴之间有遮挡（墙、掩体、狐巫的冰壁），每 0.2 s 查一次 → 断开，2.5 s 内不再连它；
    ///         2. 打断连线：玩家身体穿过已经伸出去的那段光触须 → 「啪」地断开，3 s 内不再连它；
    ///         3. 打灯芯：灯芯（弱点）累计吃到最大生命 12%（每秒衰减 6%）→ 水母一缩（stagger 1.2 s），全部连线断开，1.2 s 内不能重连。
    ///         同伴离灯芯超过 12 m × 1.15 也会松开。不连别的冰灯水母（两只互相续命会变成打不死的一对）、不连首领。
    ///   电冻：玩家进入 5.5 m 内（脚底比水母脚下的地面高 −1 到 3.5 m）、拿到近战名额 → 触须张开亮起 0.8 s（脚下预警圈，攻速加成最多缩到 55%），
    ///         放出一圈冻电：伤害（雷）+ 寒意 40% 1 s。冷却 4–5 s。
    ///   弱点：伞盖里的灯芯（core 骨）。眩晕 / 死亡 / 玩家阵亡时全部连线断开。
    /// 连线是 Fx 光束（每根一条，伸出时跟着触须末端和同伴身体中心走），不另做动画片段（采样报告：连线不是状态）。
    /// </summary>
    public sealed class LanternJellyAI : FlyingEnemyAI
    {
        public const float LinkRange = 12, LinkHeal = 0.04f, LinkReach = 0.5f, LosRetry = 2.5f, CrossRetry = 3f, StaggerRetry = 1.2f, LinkSlack = 1.15f;
        public const int LinkMax = 3;
        public const float StaggerFrac = 0.12f, StaggerTime = 1.2f, CoreHitDecay = 0.06f;
        public const float ShockRange = 5.5f, ShockWindup = 0.8f, ShockSlow = 0.4f, ShockSlowTime = 1f, ShockRise = 3.5f;
        public const float HoverHeight = 0.95f, BobAmp = 0.12f, BobRate = 1.3f, KeepMin = 9, KeepMax = 15, Behind = 3, AllyRange = 22;
        /// <summary>八条触须（四节，末节是 4）：L / R 两条长的垂到地面，前 FL / FR、后 BL / BR、后中 CL / CR</summary>
        static readonly string[] Tentacles = { "L", "R", "FL", "FR", "BL", "BR", "CL", "CR" };

        static readonly Color LinkColor = Hex.Rgb(0x7ff0d8), ShockColor = Hex.Rgb(0x9fe8ff), CoreHot = Hex.Rgb(0xe8ffff);

        /// <summary>一根回血连线</summary>
        public sealed class Link
        {
            public EnemyAI ally;
            /// <summary>用哪条触须（<see cref="Tentacles"/> 下标）</summary>
            public int tent;
            /// <summary>伸出进度 0..1（1 = 连上，开始回血）、累计回了多少血</summary>
            public float extend, healed;
            public FxHandle line;
        }

        /// <summary>连线候选（纯数据，排序用）：缺血比例、到灯芯的距离</summary>
        public struct LinkCandidate
        {
            public int index;
            public float fraction, distance;
        }

        readonly List<Link> links = new();
        readonly Dictionary<EnemyAI, float> cutUntil = new();
        readonly List<EnemyAI> scratch = new();
        readonly List<LinkCandidate> cands = new();
        readonly Transform[] tips = new Transform[8], roots = new Transform[8];
        float shockCd, windTime = 1, coreHits, staggerTime, losTimer, pickTimer;
        TelegraphHandle warn;

        /// <summary>当前的连线（最多 3 根）</summary>
        public IReadOnlyList<Link> Links => links;
        protected override string InitialState => "drift";

        protected override void Awake()
        {
            base.Awake();
            cruiseHeight = HoverHeight;
            spawnLift = 0;
            accel = 9f;
            GlowStyle(0.1f, 0.05f, 2.6f, 0.9f);
            shockCd = Random.Range(1.5f, 2.5f);
            hp.Damaged += OnHurt;
        }

        protected override void Start()
        {
            base.Start();
            var all = GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < Tentacles.Length; i++)
                foreach (var t in all)
                {
                    if (t.name == "tent_" + Tentacles[i] + "4") tips[i] = t;
                    else if (t.name == "tent_" + Tentacles[i] + "1") roots[i] = t;
                }
        }

        // ───────────── 纯计算（EditMode 测试直接调） ─────────────

        /// <summary>先连缺血比例大的（剩余生命比例小的），一样时连近的</summary>
        public static int CompareNeed(LinkCandidate a, LinkCandidate b)
        {
            int c = a.fraction.CompareTo(b.fraction);
            return c != 0 ? c : a.distance.CompareTo(b.distance);
        }

        /// <summary>
        /// 玩家身体（脚底 feet、高 height、半径 radius + pad）穿过线段 a → b（同 TS bodyCrossesSegment）：线段上 11 个采样点，
        /// 在身体高度范围内（±0.1 m）且水平距离 &lt; 半径 + pad 就算
        /// </summary>
        public static bool BodyCrossesSegment(Vector3 a, Vector3 b, Vector3 feet, float height, float radius, float pad = 0.15f)
        {
            float r = radius + pad;
            for (int i = 1; i < 12; i++)
            {
                float u = i / 12f;
                var p = Vector3.LerpUnclamped(a, b, u);
                if (p.y < feet.y - 0.1f || p.y > feet.y + height + 0.1f) continue;
                float dx = p.x - feet.x, dz = p.z - feet.z;
                if (dx * dx + dz * dz < r * r) return true;
            }
            return false;
        }

        /// <summary>一根连上的触须每秒回同伴最大生命的比例（精英 ×1.25）× dt，不超过缺的血</summary>
        public static float HealStep(float health, float maxHealth, bool elite, float dt) =>
            Mathf.Max(0, Mathf.Min(maxHealth - health, maxHealth * LinkHeal * (elite ? 1.25f : 1f) * dt));

        // ───────────── 行为 ─────────────

        Vector3 Core => body.WeakPoint ? body.WeakPoint.position : transform.TransformPoint(new Vector3(0, 1.07f, 0));
        Vector3 GroundPoint => new(transform.position.x, GroundHeight, transform.position.z);

        protected override void Think(float dt)
        {
            SetAltitude(HoverHeight + Mathf.Sin(age * BobRate) * BobAmp);
            shockCd -= dt * auraAttackRate;
            coreHits = Mathf.Max(0, coreHits - dt * CoreHitDecay);
            staggerTime = Mathf.Max(0, staggerTime - dt);
            switch (state)
            {
                case "drift":
                {
                    FollowAllies();
                    FacePlayer(69, dt);
                    Glow = 0.3f + 0.15f * Mathf.Sin(age * 2.6f) + 0.25f * Mathf.Min(1, links.Count);
                    var feet = PlayerPos;
                    float dy = feet.y - GroundHeight;
                    if (shockCd <= 0 && DistToPlayer <= ShockRange && dy > -1 && dy < ShockRise && RequestAttack(AttackTokens.Kind.Melee, ShockWindup + 0.4f))
                    {
                        windTime = Windup(ShockWindup, 0.55f);
                        warn.Cancel();
                        warn = Telegraph.Circle(GroundPoint, ShockRange, windTime, ShockColor);
                        Sfx("telegraph", 0.5f, 1.6f);
                        PlayTimed("shockWindup", windTime, 0.08f);
                        SetState("shockWindup");
                    }
                    break;
                }
                case "shockWindup":
                    // 前摇里不再移动，触须张开颤抖
                    Hover();
                    FacePlayer(69, dt);
                    Glow = 0.6f + 0.4f * Mathf.Clamp01(stateTime / windTime);
                    if (stateTime >= windTime)
                    {
                        ReleaseShock();
                        ReleaseAttack();
                        shockCd = Random.Range(4f, 5f);
                        PlayLocomotion();
                        SetState("drift");
                    }
                    break;
                case "stagger":
                    Hover();
                    Glow = 0.1f;
                    if (stateTime >= StaggerTime)
                    {
                        PlayLocomotion();
                        SetState("drift");
                    }
                    break;
                default:
                    PlayLocomotion();
                    SetState("drift");
                    break;
            }
            UpdateLinks(dt);
        }

        /// <summary>能连的同伴：活着、不是首领、不是冰灯水母</summary>
        bool Linkable(EnemyAI e) => e && e != this && !e.Dead && e is not LanternJellyAI && e.Health && !e.Health.IsBoss;

        /// <summary>漂在同伴质心后方 3 m（离玩家 9–15 m）；没有同伴就和玩家保持距离</summary>
        void FollowAllies()
        {
            EnemyRegistry.InRadius(transform.position, AllyRange, scratch, EnemyQuery.Alive, this);
            var q = Vector3.zero;
            int n = 0;
            foreach (var e in scratch)
            {
                if (!Linkable(e)) continue;
                q += e.transform.position;
                n++;
            }
            scratch.Clear();
            if (n == 0)
            {
                KeepRangeAir(KeepMin, KeepMax, moveSpeed, 0.4f);
                return;
            }
            q /= n;
            var p = PlayerPos;
            var away = new Vector3(q.x - p.x, 0, q.z - p.z);
            float d = away.magnitude;
            var dir = d > 1e-3f ? away / d : -transform.forward;
            q += dir * Behind;
            var fromP = new Vector3(q.x - p.x, 0, q.z - p.z);
            if (fromP.magnitude < KeepMin) q = new Vector3(p.x, q.y, p.z) + dir * KeepMin;
            if (!FlyTo(q, moveSpeed, 1.2f)) return;
            Hover();
        }

        // ───────────── 回血连线 ─────────────

        /// <summary>
        /// 每帧：松开失效的连线（同伴死了 / 走远了），检查视线（0.2 s 一次）和玩家是否穿过触须，
        /// 按需补连新的同伴（0.25 s 一次），伸出触须，连上的回血
        /// </summary>
        void UpdateLinks(float dt)
        {
            var core = Core;
            bool live = !Dead && !Stunned && staggerTime <= 0 && state != "stagger";
            losTimer -= dt;
            bool recheck = losTimer <= 0;
            if (recheck) losTimer = 0.2f;
            var pv = PlayerVitals.Instance;
            var cc = pv ? pv.GetComponent<CharacterController>() : null;
            for (int i = links.Count - 1; i >= 0; i--)
            {
                var L = links[i];
                var e = L.ally;
                if (!live || !Linkable(e))
                {
                    Drop(i);
                    continue;
                }
                var to = EnemyRegistry.Center(e);
                if (Vector3.Distance(core, to) > LinkRange * LinkSlack)
                {
                    Drop(i);
                    continue;
                }
                if (recheck && Combat.Blocked(core, to, null))
                {
                    Cut(i, LosRetry);
                    continue;
                }
                // 玩家穿过已经伸出去的那一段
                var from = LinkStart(L.tent, core);
                var tip = Vector3.Lerp(from, to, L.extend);
                if (pv && !pv.Dead && L.extend > 0.15f && BodyCrossesSegment(from, tip, pv.transform.position, cc ? cc.height : 1.8f, cc ? cc.radius : 0.35f))
                    Cut(i, CrossRetry);
            }
            pickTimer -= dt;
            if (live && pickTimer <= 0 && links.Count < LinkMax)
            {
                pickTimer = 0.25f;
                PickLinks(core);
            }
            foreach (var L in links)
            {
                L.extend = Mathf.Min(1, L.extend + dt / LinkReach);
                var from = LinkStart(L.tent, core);
                var to = EnemyRegistry.Center(L.ally);
                var tip = Vector3.Lerp(from, to, L.extend);
                // 每条触须的颜色差一点点：Fx.Beam 会把同色、同起点附近、刚刷新过的光束合并成一条，几根连线不能互相吞掉
                if (!L.line.Alive) L.line = Fx.Beam(from, tip, new Color(LinkColor.r, LinkColor.g, LinkColor.b, 1f - L.tent * 0.004f), 0.05f, 10f);
                else L.line.Retarget(from, tip);
                if (L.extend < 1) continue;
                var h = L.ally.Health;
                float add = HealStep(h.health, h.maxHealth, elite, dt);
                if (add <= 0) continue;
                h.Heal(add);
                L.healed += add;
            }
        }

        void PickLinks(Vector3 core)
        {
            EnemyRegistry.InRadius(core, LinkRange + 2f, scratch, EnemyQuery.Alive, this);
            cands.Clear();
            float now = Time.time;
            for (int i = 0; i < scratch.Count; i++)
            {
                var e = scratch[i];
                if (!Linkable(e) || IsLinked(e)) continue;
                if (cutUntil.TryGetValue(e, out var until) && until > now) continue;
                var c = EnemyRegistry.Center(e);
                float dist = Vector3.Distance(core, c);
                if (dist > LinkRange || Combat.Blocked(core, c, null)) continue;
                cands.Add(new LinkCandidate { index = i, fraction = e.Health.Fraction, distance = dist });
            }
            cands.Sort(CompareNeed);
            foreach (var c in cands)
            {
                if (links.Count >= LinkMax) break;
                var e = scratch[c.index];
                links.Add(new Link { ally = e, tent = PickTentacle(e) });
            }
            scratch.Clear();
        }

        bool IsLinked(EnemyAI e)
        {
            foreach (var L in links)
                if (L.ally == e)
                    return true;
            return false;
        }

        /// <summary>选一条朝向同伴、还没被占用的触须（按触须根部相对伞盖中心的水平方向）</summary>
        int PickTentacle(EnemyAI e)
        {
            var to = e.transform.position - transform.position;
            to.y = 0;
            to = to.sqrMagnitude > 1e-4f ? to.normalized : transform.forward;
            int best = 0;
            float bestDot = float.NegativeInfinity;
            for (int i = 0; i < Tentacles.Length; i++)
            {
                bool used = false;
                foreach (var L in links)
                    if (L.tent == i) { used = true; break; }
                if (used) continue;
                var r = roots[i];
                var outDir = r ? r.position - transform.position : transform.TransformDirection(new Vector3(i % 2 == 0 ? 1 : -1, 0, 0));
                outDir.y = 0;
                float d = outDir.sqrMagnitude > 1e-6f ? Vector3.Dot(outDir.normalized, to) : -1;
                if (d > bestDot)
                {
                    bestDot = d;
                    best = i;
                }
            }
            return best;
        }

        /// <summary>连线的起点：那条触须的末端；没有骨骼（占位体）时用灯芯</summary>
        Vector3 LinkStart(int tent, Vector3 core) => tent >= 0 && tent < tips.Length && tips[tent] ? tips[tent].position : core;

        /// <summary>松开（同伴死了 / 走远了）：不记重连冷却</summary>
        void Drop(int i)
        {
            links[i].line.Cancel();
            links.RemoveAt(i);
        }

        /// <summary>断开第 i 根：retry 秒内不再连它；断口炸出一点冰屑</summary>
        void Cut(int i, float retry)
        {
            var L = links[i];
            links.RemoveAt(i);
            L.line.Cancel();
            if (L.ally) cutUntil[L.ally] = Time.time + retry;
            if (L.extend <= 0.05f || !L.ally) return;
            var mid = Vector3.Lerp(LinkStart(L.tent, Core), EnemyRegistry.Center(L.ally), L.extend * 0.5f);
            Fx.Burst(mid, LinkColor, 10, 2.5f, 0.35f, 0.05f, 2);
            GameAudio.PlayAt("shock_zap", mid, 0.45f, 1.6f);
        }

        void CutAll(float retry)
        {
            for (int i = links.Count - 1; i >= 0; i--) Cut(i, retry);
        }

        // ───────────── 电冻 ─────────────

        /// <summary>一圈冻电：地面圆形判定（5.5 m，脚底高差 −0.6 到 3.5 m），命中伤害（雷）+ 寒意；触须末端各拉一道电光</summary>
        void ReleaseShock()
        {
            warn = default;
            var center = GroundPoint;
            Fx.Ring(center + Vector3.up * 0.1f, ShockRange, ShockColor, 0.45f);
            Fx.Burst(transform.position + Vector3.up * 1.1f * Size, ShockColor, 24, 5, 0.4f, 0.06f, 0);
            GameAudio.PlayAt("shock_zap", transform.position + Vector3.up * Size, 0.9f, 0.8f);
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var cc = pv.GetComponent<CharacterController>();
            float pr = cc ? cc.radius : 0.35f;
            if (!HazardZone.Contains(center, ShockRange, 0, pr * 0.5f, -0.6f, ShockRise, PlayerPos)) return;
            if (Taunted)
            {
                DecoyBlocked(Target);
                return;
            }
            if (Combat.DamagePlayer(Damage, center, Element.Shock, this) <= 0) return;
            PlayerStatus.Chill(ShockSlow, ShockSlowTime);
            var chest = PlayerPos + Vector3.up * 1.1f;
            for (int i = 0; i < 3; i++) Fx.Lightning(LinkStart(i * 2, Core), chest, ShockColor);
        }

        // ───────────── 受击 ─────────────

        void OnHurt(DamageInfo info, DamageResult r)
        {
            if (Dead || !info.weakpoint || r.total <= 0 || hp.maxHealth <= 0) return;
            coreHits += r.total / hp.maxHealth;
            if (coreHits < StaggerFrac || state == "stagger" || state == "spawn") return;
            coreHits = 0;
            staggerTime = StaggerTime;
            warn.Cancel();
            ReleaseAttack();
            CutAll(StaggerRetry);
            Play("stagger", 0.05f);
            SetState("stagger");
            Fx.Burst(Core, CoreHot, 16, 3, 0.4f, 0.06f, 2);
            GameAudio.PlayAt("hit_shield", Core, 0.8f, 1.4f);
        }

        protected override void CancelAttack()
        {
            // 眩晕 / 死亡 / 玩家阵亡：全部连线断开
            warn.Cancel();
            CutAll(StaggerRetry);
        }
    }
}
