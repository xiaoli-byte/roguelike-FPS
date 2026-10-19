using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    public enum Reaction { Thunderfire, Meltdown, Veinseal, Abyss }

    /// <summary>反应是怎么来的：两种元素相遇（Status）、引爆身上的状态（Detonate）、秘卷 / 词条强制引发（Forced）</summary>
    public enum ReactionOrigin { Status, Detonate, Forced }

    /// <summary>引爆的结果：引发了某个反应，或单一状态的「崩解」</summary>
    public enum DetonateOutcome { Thunderfire, Meltdown, Veinseal, Abyss, Collapse }

    /// <summary>一次反应执行完毕（<see cref="GameEvents.Reacted"/>）</summary>
    public struct ReactionEvent
    {
        /// <summary>中心敌人（可能已经死了 / 销毁）</summary>
        public Damageable enemy;
        public Reaction id;
        /// <summary>反应中心</summary>
        public Vector3 point;
        /// <summary>威力 B</summary>
        public float B;
        /// <summary>引发这次反应的附着深度（0 = 直接命中引发）</summary>
        public int depth;
        /// <summary>受到伤害的敌人数</summary>
        public int hits;
        public ReactionOrigin origin;
        /// <summary>强制反应的来源标签（Echo / Nirvana / Kalpa），其他为 None</summary>
        public DamageTag tag;
        /// <summary>归属武器（引发这次附着的那一击的 weaponUid；0 = 不是武器引发的）</summary>
        public int weaponUid;
        /// <summary>执行完时中心敌人已死</summary>
        public bool centerKilled;
        /// <summary>这次反应把中心敌人眩晕了（封脉）</summary>
        public bool stunned;
    }

    /// <summary>引爆参数（<see cref="ReactionSystem.Detonate"/>）</summary>
    public struct DetonateOpts
    {
        /// <summary>引爆这一击的强度（通常 = 该次实际伤害；内部钳到最大生命 × 0.5）</summary>
        public float power;
        /// <summary>强度倍率，0（未设）视为 1</summary>
        public float mult;
        public int depth;
        public int weaponUid;
        /// <summary>反应中心（null = 敌人身体中心）</summary>
        public Vector3? point;
    }

    /// <summary>强制反应参数（<see cref="ReactionSystem.Trigger"/>）</summary>
    public struct TriggerOpts
    {
        public int depth;
        public int weaponUid;
        /// <summary>反应中心；敌人已死时必须给</summary>
        public Vector3? point;
        /// <summary>无视该敌人该反应的内置冷却</summary>
        public bool ignoreIcd;
        /// <summary>直接指定威力 B（跳过 k × 强度与上下限）</summary>
        public float? fixedBase;
        /// <summary>威力倍率，0（未设）视为 1</summary>
        public float scale;
        /// <summary>透传到 <see cref="ReactionEvent.tag"/>（Echo / Nirvana / Kalpa）</summary>
        public DamageTag tag;
    }

    /// <summary>
    /// 元素反应（docs/arsenal-expansion.md 第 2 节，Three.js 版 src/combat/Reactions.ts）：
    ///   焚雷 = 灼烧 + 雷殛：中心火伤 B，3 m 爆炸 0.6B（击退 7）并把灼烧扩散给周围（0.2B）
    ///   熔金 = 灼烧 + 蚀化：中心蚀伤 B（有护甲 ×2），脚下 2.5 m 熔池 3 s（每 0.5 s 0.12B 火伤，首次踩到附蚀 0.25B）
    ///   封脉 = 雷殛 + 蚀化：中心雷伤 B（有护盾 ×2），眩晕 0.7 s（同一敌人 3.5 s 一次）+ 减速 40% 3 s，向 8 m 内 3 个敌人导流（0.3B + 附蚀 0.35B）
    ///   归墟 = 三种齐聚再补一种：消耗灼烧（结清剩余伤害）与雷殛，0.35 s 收束后三色天雷 3 × B/3，3 m 余波 0.3B（中心已死 0.6B）
    /// 威力 B = clamp(k × 附着强度, 下限 × S, 上限 × S)，S = 1 + (等级 − 1) × 0.85；两两反应不消耗状态，频率由逐敌冷却封顶。
    /// 防递归：深度 ≥ 2 的附着不反应；反应伤害深度 +1、source Status（不再附着）；扩散出去的元素深度 +1，最多再连锁一级（延后 0.15 s）。
    /// 预算：每帧最多接受 8 次反应、队列 32 条、熔池同时 4 个。判定只入队，效果在 Update 里执行（不在伤害结算里嵌套造成伤害）。
    /// 每条执行完派发 <see cref="GameEvents.Reacted"/>（旧的 <see cref="Reacted"/> 照常转发）。
    /// 引爆 <see cref="Detonate"/> 与强制反应 <see cref="Trigger"/> 的签名已定，由 C1 单元实现。
    /// </summary>
    public sealed class ReactionSystem : MonoBehaviour
    {
        struct Tuning
        {
            public float k, floor, cap, icd;
            public Tuning(float k, float floor, float cap, float icd) { this.k = k; this.floor = floor; this.cap = cap; this.icd = icd; }
        }

        static readonly Tuning[] Tune =
        {
            new(1.0f, 14, 80, 1.0f),   // 焚雷
            new(1.0f, 14, 100, 1.2f),  // 熔金
            new(1.0f, 14, 90, 1.2f),   // 封脉
            new(1.5f, 40, 320, 6.0f),  // 归墟
        };

        public static readonly string[] Names = { "焚雷", "熔金", "封脉", "归墟" };
        public static readonly Color[] Colors =
        {
            new(1f, 0.85f, 0.29f), new(1f, 0.48f, 0.1f), new(0.35f, 1f, 0.82f), new(0.78f, 0.61f, 1f),
        };

        const int MaxDepth = 2, FrameBudget = 8, QueueCap = 32, MaxPools = 4;
        const float CascadeDelay = 0.15f, AbyssWindup = 0.35f, IcdFloor = 0.3f, SealStunIcd = 3.5f;

        static readonly EventChannel<Action<Damageable, Reaction, Vector3, float, int>> reacted = new();

        /// <summary>旧事件（转发，第 4 批删除）：(中心敌人, 反应, 中心点, 威力 B, 受到伤害的敌人数)。新代码订阅 <see cref="GameEvents.Reacted"/></summary>
        public static event Action<Damageable, Reaction, Vector3, float, int> Reacted { add => reacted.Add(value); remove => reacted.Remove(value); }

        static bool warnedDetonate, warnedTrigger;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            reacted.Clear();
            warnedDetonate = warnedTrigger = false;
        }

        sealed class Pending
        {
            public Reaction id;
            public Damageable enemy;
            public Vector3 point;
            public float pin, cash, at, scale;
            public int depth, weaponUid;
            public bool killed;
            public ReactionOrigin origin;
            public DamageTag tag;
        }

        sealed class Pool
        {
            public Vector3 center;
            public float radius, b, age, next;
            public int ticks, depth, weaponUid;
            public readonly HashSet<Damageable> touched = new();
        }

        static ReactionSystem instance;
        readonly List<Pending> queue = new();
        readonly List<Pending> batch = new();
        readonly List<Pool> pools = new();
        readonly Dictionary<Damageable, float[]> icd = new();
        readonly Dictionary<Damageable, float> sealStunReady = new();
        int frame = -1, used;

        static ReactionSystem Instance
        {
            get
            {
                if (!instance) instance = new GameObject("Reaction System").AddComponent<ReactionSystem>();
                return instance;
            }
        }

        void OnDestroy()
        {
            if (instance == this) instance = null;
        }

        static float Radius(float r) => r * (Combat.playerStats?.Mult(Stat.ExplosionRadiusPct) ?? 1f);

        static float LevelScale(Damageable d)
        {
            var ai = d ? d.GetComponent<EnemyAI>() : null;
            return 1 + Mathf.Max(0, (ai ? ai.level : 1) - 1) * 0.85f;
        }

        static float Base(Reaction id, float pin, float s)
        {
            var t = Tune[(int)id];
            return Mathf.Clamp(t.k * Mathf.Max(0, pin), t.floor * s, t.cap * s);
        }

        // ───────────── 判定 ─────────────

        /// <summary>
        /// 元素附着前的反应判定（Combat 在附着状态之前调用）：判定成功则记冷却、（归墟）消耗状态、入队，返回反应；
        /// 之后调用方照常附着 incoming。击杀那一击只能引发两两反应。weaponUid = 引发它的那一击出自哪把武器（反应伤害沿用）。
        /// </summary>
        public static Reaction? TryReact(Damageable enemy, Element incoming, float pin, int depth, bool killed, int weaponUid = 0)
        {
            if (depth >= MaxDepth || incoming == Element.None || !enemy) return null;
            if (!killed && enemy.Dead) return null;
            var st = EnemyStatus.Of(enemy);
            if (!st) return null;
            bool hb = incoming != Element.Fire && st.Burning;
            bool hs = incoming != Element.Shock && st.Shocked;
            bool hc = incoming != Element.Corrode && st.Corroded;
            int others = (hb ? 1 : 0) + (hs ? 1 : 0) + (hc ? 1 : 0);
            if (others == 0) return null;
            var sys = Instance;
            float now = Time.time;
            Reaction? id = null;
            if (others == 2 && !killed && sys.Ready(enemy, Reaction.Abyss, now)) id = Reaction.Abyss;
            else
            {
                // 优先级：焚雷 > 熔金 > 封脉
                bool fire = incoming == Element.Fire, shock = incoming == Element.Shock, cor = incoming == Element.Corrode;
                if (((fire && hs) || (shock && hb)) && sys.Ready(enemy, Reaction.Thunderfire, now)) id = Reaction.Thunderfire;
                else if (((fire && hc) || (cor && hb)) && sys.Ready(enemy, Reaction.Meltdown, now)) id = Reaction.Meltdown;
                else if (((shock && hc) || (cor && hs)) && sys.Ready(enemy, Reaction.Veinseal, now)) id = Reaction.Veinseal;
            }
            if (id == null || !sys.CanAccept()) return null;
            sys.SetCooldown(enemy, id.Value, now);
            var p = new Pending
            {
                id = id.Value, enemy = enemy, point = CenterOf(enemy), pin = Mathf.Min(pin, enemy.maxHealth * 0.5f),
                depth = depth, killed = killed, scale = 1, at = now + (depth >= 1 ? CascadeDelay : 0),
                weaponUid = weaponUid, origin = ReactionOrigin.Status,
            };
            if (id == Reaction.Abyss)
            {
                // 收束：消耗灼烧（结清剩余伤害）与雷殛，蚀化保留；0.35 s 预警后劈下
                if (hb) p.cash = st.ConsumeBurn();
                if (hs) st.ConsumeShock();
                p.at += AbyssWindup;
                Telegraph.Circle(Ground(p.point), 1.6f, AbyssWindup, Colors[(int)Reaction.Abyss]);
            }
            sys.queue.Add(p);
            return id;
        }

        /// <summary>
        /// 引爆敌人身上已有的元素状态：三相 → 归墟，两相 → 按优先级的两两反应，单相 → 崩解。只入队，不同步造成伤害。
        /// 被冷却 / 预算 / 深度拒绝、或身上没有状态时返回 null。（C1 单元实现；在那之前打一次警告并返回 null）
        /// </summary>
        public static DetonateOutcome? Detonate(Damageable enemy, in DetonateOpts opts)
        {
            if (!warnedDetonate)
            {
                warnedDetonate = true;
                Debug.LogWarning("[Reaction] Detonate 还没实现（单元 C1），这次调用被忽略");
            }
            return null;
        }

        /// <summary>
        /// 强制引发一次反应（不需要、也不消耗元素状态）：被预算 / 深度 / 冷却拒绝时返回 null，否则返回入队的反应。只入队，不同步造成伤害。
        /// （C1 单元实现；在那之前打一次警告并返回 null）
        /// </summary>
        public static Reaction? Trigger(Damageable enemy, Reaction id, in TriggerOpts opts)
        {
            if (!warnedTrigger)
            {
                warnedTrigger = true;
                Debug.LogWarning("[Reaction] Trigger 还没实现（单元 C1），这次调用被忽略");
            }
            return null;
        }

        bool Ready(Damageable e, Reaction id, float now) => !icd.TryGetValue(e, out var t) || now >= t[(int)id];

        void SetCooldown(Damageable e, Reaction id, float now)
        {
            if (!icd.TryGetValue(e, out var t)) icd[e] = t = new float[4];
            float haste = 1 + (Combat.playerStats?.Get(Stat.ReactionHaste) ?? 0);
            t[(int)id] = now + Mathf.Max(IcdFloor, Tune[(int)id].icd / haste);
        }

        bool CanAccept()
        {
            if (Time.frameCount != frame)
            {
                frame = Time.frameCount;
                used = 0;
            }
            if (used >= FrameBudget || queue.Count >= QueueCap) return false;
            used++;
            return true;
        }

        // ───────────── 执行 ─────────────

        void Update()
        {
            float now = Time.time, dt = Time.deltaTime;
            batch.Clear();
            for (int i = queue.Count - 1; i >= 0; i--)
                if (queue[i].at <= now)
                {
                    batch.Add(queue[i]);
                    queue.RemoveAt(i);
                }
            for (int i = batch.Count - 1; i >= 0; i--) Execute(batch[i]);
            UpdatePools(dt);
            if (Time.frameCount % 300 == 0)
            {
                // 回收已销毁敌人的冷却记录
                var dead = new List<Damageable>();
                foreach (var k in icd.Keys) if (!k) dead.Add(k);
                foreach (var k in dead) { icd.Remove(k); sealStunReady.Remove(k); }
            }
        }

        void Execute(Pending p)
        {
            var e = p.enemy;
            bool alive = e && !e.Dead;
            var c = alive ? CenterOf(e) : p.point;
            float b = Base(p.id, p.pin, e ? LevelScale(e) : 1) * p.scale;
            bool center = alive && !p.killed;
            int hits = 0;
            bool stunned = false;
            int uid = p.weaponUid;
            var color = Colors[(int)p.id];
            switch (p.id)
            {
                case Reaction.Thunderfire:
                {
                    if (center && Hit(e, b, Element.Fire, p.depth, c, p.id, uid)) hits++;
                    var hitList = new List<Damageable>();
                    var info = ReactionHit(b * 0.6f, Element.Fire, p.depth, c, p.id, uid);
                    info.knockback = 7;
                    float r = Radius(3f);
                    Combat.Explode(c, r, info, true, 0, e, 0.6f, hitList);
                    hits += hitList.Count;
                    // 扩散：周围的敌人也烧起来（带雷殛的再焚雷、带蚀化的熔金）
                    foreach (var o in Nearest(c, r, 16, e, false))
                        Combat.AttachFromReaction(o, Element.Fire, b * 0.2f, p.depth + 1, uid);
                    for (int i = 0; i < hitList.Count && i < 4; i++)
                        Lightning.Spawn(c, CenterOf(hitList[i]), new Color(0.44f, 0.85f, 1f));
                    ShotFx.Instance?.Impact(c, Vector3.up, true, 9f);
                    ShotFx.Instance?.MuzzleFlash(c, 5f);
                    GameAudio.PlayAt("shock_zap", c, 0.5f, 1.1f);
                    Telegraph.Wave(Ground(c), r, 18f, color);
                    break;
                }
                case Reaction.Meltdown:
                {
                    if (center && Hit(e, b * (e.armor > 0 ? 2 : 1), Element.Corrode, p.depth, c, p.id, uid)) hits++;
                    var foot = alive ? e.transform.position : Ground(c);
                    SpawnPool(foot + Vector3.up * 0.05f, Radius(2.5f), b, p.depth, uid);
                    ShotFx.Instance?.Impact(c, Vector3.up, true, 6f);
                    GameAudio.PlayAt("skill_fire", c, 0.55f, 0.75f);
                    GameAudio.PlayAt("corrode_tick", c, 0.7f);
                    break;
                }
                case Reaction.Veinseal:
                {
                    if (center)
                    {
                        if (Hit(e, b * (e.shield > 0 ? 2 : 1), Element.Shock, p.depth, c, p.id, uid)) hits++;
                        float now = Time.time;
                        if (!sealStunReady.TryGetValue(e, out var ready) || now >= ready)
                        {
                            sealStunReady[e] = now + SealStunIcd;
                            stunned = EnemyStatus.Stun(e, 0.7f);
                        }
                        EnemyStatus.Slow(e, 0.4f, 3f);
                    }
                    // 导流：8 m 内最近的 3 个敌人（要有视线）
                    foreach (var o in Nearest(c, 8f, 3, e, true))
                    {
                        var oc = CenterOf(o);
                        Lightning.Spawn(c, oc, color);
                        if (Hit(o, b * 0.3f, Element.Shock, p.depth, oc, p.id, uid)) hits++;
                        Combat.AttachFromReaction(o, Element.Corrode, b * 0.35f, p.depth + 1, uid);
                    }
                    Telegraph.Wave(Ground(c), 1.6f, 8f, color);
                    ShotFx.Instance?.Impact(c + Vector3.up * 0.8f, Vector3.up, false, 3f);
                    GameAudio.PlayAt("skill_shock", c, 0.5f, 0.8f);
                    GameAudio.PlayAt("shock_zap", c, 0.6f, 0.7f);
                    break;
                }
                case Reaction.Abyss:
                {
                    GameAudio.PlayAt("hit_crit", c, 0.8f, 0.8f);
                    if (alive && p.cash > 0)
                    {
                        // 灼烧结清：普通持续伤害（不带反应标记）
                        var cash = DamageInfo.Simple(p.cash, DamageSource.Status, c, Vector3.up);
                        cash.element = Element.Fire;
                        cash.depth = p.depth + 1;
                        cash.tags = DamageTag.Dot;
                        cash.weaponUid = uid;
                        Combat.DamageEnemy(e, cash);
                    }
                    if (alive)
                    {
                        // 三色天雷：火打血、雷打盾、蚀打甲，各 B/3
                        foreach (var el in new[] { Element.Fire, Element.Shock, Element.Corrode })
                        {
                            if (e.Dead) break;
                            if (Hit(e, b / 3f, el, p.depth, c, p.id, uid)) hits++;
                        }
                    }
                    bool centerDead = !e || e.Dead;
                    var after = ReactionHit(b * (centerDead ? 0.6f : 0.3f), Element.None, p.depth, c, p.id, uid);
                    after.knockback = 9;
                    var hitList = new List<Damageable>();
                    Combat.Explode(c, Radius(3f), after, true, 0, e, 0.6f, hitList);
                    hits += hitList.Count;
                    int i = 0;
                    foreach (var el in new[] { Element.Fire, Element.Shock, Element.Corrode })
                        Lightning.Spawn(c + Vector3.up * 7f + new Vector3((i++ - 1) * 0.6f, 0, 0), c, DamageTable.ElementColor(el), 0.12f);
                    Telegraph.Wave(Ground(c), 3f, 12f, color);
                    ShotFx.Instance?.Impact(c, Vector3.up, false, 10f);
                    ShotFx.Instance?.MuzzleFlash(c, 8f);
                    break;
                }
            }
            Hud.Instance?.FloatText(c + Vector3.up * 0.9f, Names[(int)p.id], color, p.id == Reaction.Abyss ? 1.9f : 1.35f);
            var ev = new ReactionEvent
            {
                enemy = e, id = p.id, point = c, B = b, depth = p.depth, hits = hits, origin = p.origin, tag = p.tag, weaponUid = uid,
                centerKilled = !e || e.Dead, stunned = stunned,
            };
            GameEvents.RaiseReacted(in ev);
            reacted.Raise(e, p.id, c, b, hits);
        }

        /// <summary>反应 → 伤害标签（Reaction + 反应自己的标签）</summary>
        public static DamageTag TagOf(Reaction id) => DamageTag.Reaction | id switch
        {
            Reaction.Thunderfire => DamageTag.Thunderfire,
            Reaction.Meltdown => DamageTag.Meltdown,
            Reaction.Veinseal => DamageTag.Veinseal,
            _ => DamageTag.Abyss,
        };

        static DamageInfo ReactionHit(float amount, Element element, int depth, Vector3 point, Reaction id, int weaponUid, DamageTag extra = DamageTag.None)
        {
            var info = DamageInfo.Simple(amount, DamageSource.Status, point, Vector3.up);
            info.weaponUid = weaponUid;
            info.element = element;
            info.depth = depth + 1;
            info.reaction = true;
            info.reactionId = id;
            info.tags = TagOf(id) | extra;
            info.noCrit = true;
            return info;
        }

        static bool Hit(Damageable d, float amount, Element element, int depth, Vector3 point, Reaction id, int weaponUid, DamageTag extra = DamageTag.None)
        {
            if (!d || d.Dead) return false;
            var r = Combat.DamageEnemy(d, ReactionHit(amount, element, depth, point, id, weaponUid, extra));
            return r.total > 0;
        }

        void SpawnPool(Vector3 center, float radius, float b, int depth, int weaponUid)
        {
            if (pools.Count >= MaxPools) pools.RemoveAt(0);
            var pool = new Pool { center = center, radius = radius, b = b, depth = depth, weaponUid = weaponUid, next = 0.5f };
            pools.Add(pool);
            Telegraph.Circle(center, radius, 3f, new Color(1f, 0.48f, 0.1f, 0.55f));
        }

        void UpdatePools(float dt)
        {
            for (int i = pools.Count - 1; i >= 0; i--)
            {
                var pool = pools[i];
                pool.age += dt;
                if (pool.age < pool.next) continue;
                pool.next += 0.5f;
                pool.ticks++;
                foreach (var ai in EnemyAI.All.ToArray())
                {
                    if (!ai || ai.Dead) continue;
                    var d = ai.Health;
                    var pos = ai.transform.position;
                    var flat = pos - pool.center;
                    float dy = flat.y;
                    flat.y = 0;
                    if (flat.magnitude > pool.radius || dy > 1.5f || dy < -1f) continue;
                    Hit(d, pool.b * 0.12f, Element.Fire, pool.depth, CenterOf(d), Reaction.Meltdown, pool.weaponUid, DamageTag.Dot);
                    if (pool.touched.Add(d)) Combat.AttachFromReaction(d, Element.Corrode, pool.b * 0.25f, pool.depth + 1, pool.weaponUid);
                }
                for (int k = 0; k < 2; k++)
                {
                    var off = UnityEngine.Random.insideUnitCircle * pool.radius * 0.8f;
                    ShotFx.Instance?.Impact(pool.center + new Vector3(off.x, 0.1f, off.y), Vector3.up, true, 0.8f);
                }
                if (pool.ticks >= 6) pools.RemoveAt(i);
            }
        }

        // ───────────── 工具 ─────────────

        public static Vector3 CenterOf(Damageable d)
        {
            var col = d.GetComponent<Collider>();
            return col && col.enabled ? col.bounds.center : d.transform.position + Vector3.up;
        }

        static Vector3 Ground(Vector3 p)
        {
            if (Physics.Raycast(p + Vector3.up * 0.5f, Vector3.down, out var hit, 6f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                return hit.point + Vector3.up * 0.05f;
            return p;
        }

        /// <summary>from 附近 range 内最近的若干个活着、可选中的敌人（排除 exclude；needSight 时要求视线不被地形挡住）</summary>
        public static List<Damageable> Nearest(Vector3 from, float range, int count, Damageable exclude, bool needSight)
        {
            var list = new List<(float d, Damageable e)>();
            foreach (var ai in EnemyAI.All.ToArray())
            {
                if (!ai || ai.Dead) continue;
                var d = ai.Health;
                if (!d || d == exclude || d.untargetable) continue;
                var c = CenterOf(d);
                float dist = Vector3.Distance(from, c);
                if (dist > range) continue;
                list.Add((dist, d));
            }
            list.Sort((a, b) => a.d.CompareTo(b.d));
            var picked = new List<Damageable>();
            foreach (var (_, e) in list)
            {
                if (picked.Count >= count) break;
                if (needSight && Combat.Blocked(from, CenterOf(e), e.GetComponent<Collider>())) continue;
                picked.Add(e);
            }
            return picked;
        }
    }
}
