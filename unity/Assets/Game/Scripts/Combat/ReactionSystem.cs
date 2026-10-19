using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    public enum Reaction { Thunderfire, Meltdown, Veinseal, Abyss }

    /// <summary>
    /// 元素反应（docs/arsenal-expansion.md 第 2 节，Three.js 版 src/combat/Reactions.ts）：
    ///   焚雷 = 灼烧 + 雷殛：中心火伤 B，3 m 爆炸 0.6B（击退 7）并把灼烧扩散给周围（0.2B）
    ///   熔金 = 灼烧 + 蚀化：中心蚀伤 B（有护甲 ×2），脚下 2.5 m 熔池 3 s（每 0.5 s 0.12B 火伤，首次踩到附蚀 0.25B）
    ///   封脉 = 雷殛 + 蚀化：中心雷伤 B（有护盾 ×2），眩晕 0.7 s（同一敌人 3.5 s 一次）+ 减速 40% 3 s，向 8 m 内 3 个敌人导流（0.3B + 附蚀 0.35B）
    ///   归墟 = 三种齐聚再补一种：消耗灼烧（结清剩余伤害）与雷殛，0.35 s 收束后三色天雷 3 × B/3，3 m 余波 0.3B（中心已死 0.6B）
    /// 威力 B = clamp(k × 附着强度, 下限 × S, 上限 × S)，S = 1 + (等级 − 1) × 0.85；两两反应不消耗状态，频率由逐敌冷却封顶。
    /// 防递归：深度 ≥ 2 的附着不反应；反应伤害深度 +1、source Status（不再附着）；扩散出去的元素深度 +1，最多再连锁一级（延后 0.15 s）。
    /// 预算：每帧最多接受 8 次反应、队列 32 条、熔池同时 4 个。判定只入队，效果在 Update 里执行（不在伤害结算里嵌套造成伤害）。
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

        /// <summary>反应执行完毕：(中心敌人, 反应, 中心点, 威力 B, 受到伤害的敌人数)</summary>
        public static event Action<Damageable, Reaction, Vector3, float, int> Reacted;

        sealed class Pending
        {
            public Reaction id;
            public Damageable enemy;
            public Vector3 point;
            public float pin, cash, at, scale;
            public int depth;
            public bool killed;
        }

        sealed class Pool
        {
            public Vector3 center;
            public float radius, b, age, next;
            public int ticks, depth;
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
        /// 之后调用方照常附着 incoming。击杀那一击只能引发两两反应。
        /// </summary>
        public static Reaction? TryReact(Damageable enemy, Element incoming, float pin, int depth, bool killed)
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
            var color = Colors[(int)p.id];
            switch (p.id)
            {
                case Reaction.Thunderfire:
                {
                    if (center && Hit(e, b, Element.Fire, p.depth, c, p.id)) hits++;
                    var hitList = new List<Damageable>();
                    var info = ReactionHit(b * 0.6f, Element.Fire, p.depth, c, p.id);
                    info.knockback = 7;
                    float r = Radius(3f);
                    Combat.Explode(c, r, info, true, 0, e, 0.6f, hitList);
                    hits += hitList.Count;
                    // 扩散：周围的敌人也烧起来（带雷殛的再焚雷、带蚀化的熔金）
                    foreach (var o in Nearest(c, r, 16, e, false))
                        Combat.AttachFromReaction(o, Element.Fire, b * 0.2f, p.depth + 1);
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
                    if (center && Hit(e, b * (e.armor > 0 ? 2 : 1), Element.Corrode, p.depth, c, p.id)) hits++;
                    var foot = alive ? e.transform.position : Ground(c);
                    SpawnPool(foot + Vector3.up * 0.05f, Radius(2.5f), b, p.depth);
                    ShotFx.Instance?.Impact(c, Vector3.up, true, 6f);
                    GameAudio.PlayAt("skill_fire", c, 0.55f, 0.75f);
                    GameAudio.PlayAt("corrode_tick", c, 0.7f);
                    break;
                }
                case Reaction.Veinseal:
                {
                    if (center)
                    {
                        if (Hit(e, b * (e.shield > 0 ? 2 : 1), Element.Shock, p.depth, c, p.id)) hits++;
                        float now = Time.time;
                        if (!sealStunReady.TryGetValue(e, out var ready) || now >= ready)
                        {
                            sealStunReady[e] = now + SealStunIcd;
                            EnemyStatus.Stun(e, 0.7f);
                        }
                        EnemyStatus.Slow(e, 0.4f, 3f);
                    }
                    // 导流：8 m 内最近的 3 个敌人（要有视线）
                    foreach (var o in Nearest(c, 8f, 3, e, true))
                    {
                        var oc = CenterOf(o);
                        Lightning.Spawn(c, oc, color);
                        if (Hit(o, b * 0.3f, Element.Shock, p.depth, oc, p.id)) hits++;
                        Combat.AttachFromReaction(o, Element.Corrode, b * 0.35f, p.depth + 1);
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
                        Combat.DamageEnemy(e, cash);
                    }
                    if (alive)
                    {
                        // 三色天雷：火打血、雷打盾、蚀打甲，各 B/3
                        foreach (var el in new[] { Element.Fire, Element.Shock, Element.Corrode })
                        {
                            if (e.Dead) break;
                            if (Hit(e, b / 3f, el, p.depth, c, p.id)) hits++;
                        }
                    }
                    bool centerDead = !e || e.Dead;
                    var after = ReactionHit(b * (centerDead ? 0.6f : 0.3f), Element.None, p.depth, c, p.id);
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
            Reacted?.Invoke(e, p.id, c, b, hits);
        }

        /// <summary>反应 → 伤害标签（Reaction + 反应自己的标签）</summary>
        public static DamageTag TagOf(Reaction id) => DamageTag.Reaction | id switch
        {
            Reaction.Thunderfire => DamageTag.Thunderfire,
            Reaction.Meltdown => DamageTag.Meltdown,
            Reaction.Veinseal => DamageTag.Veinseal,
            _ => DamageTag.Abyss,
        };

        static DamageInfo ReactionHit(float amount, Element element, int depth, Vector3 point, Reaction id, DamageTag extra = DamageTag.None)
        {
            var info = DamageInfo.Simple(amount, DamageSource.Status, point, Vector3.up);
            info.element = element;
            info.depth = depth + 1;
            info.reaction = true;
            info.reactionId = id;
            info.tags = TagOf(id) | extra;
            info.noCrit = true;
            return info;
        }

        static bool Hit(Damageable d, float amount, Element element, int depth, Vector3 point, Reaction id, DamageTag extra = DamageTag.None)
        {
            if (!d || d.Dead) return false;
            var r = Combat.DamageEnemy(d, ReactionHit(amount, element, depth, point, id, extra));
            return r.total > 0;
        }

        void SpawnPool(Vector3 center, float radius, float b, int depth)
        {
            if (pools.Count >= MaxPools) pools.RemoveAt(0);
            var pool = new Pool { center = center, radius = radius, b = b, depth = depth, next = 0.5f };
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
                    Hit(d, pool.b * 0.12f, Element.Fire, pool.depth, CenterOf(d), Reaction.Meltdown, DamageTag.Dot);
                    if (pool.touched.Add(d)) Combat.AttachFromReaction(d, Element.Corrode, pool.b * 0.25f, pool.depth + 1);
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
