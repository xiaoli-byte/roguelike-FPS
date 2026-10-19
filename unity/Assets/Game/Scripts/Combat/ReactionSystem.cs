using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    public enum Reaction { Thunderfire, Meltdown, Veinseal, Abyss }

    /// <summary>反应是怎么来的：两种元素相遇（Status）、引爆身上的状态（Detonate）、秘卷 / 词条强制引发（Forced）</summary>
    public enum ReactionOrigin { Status, Detonate, Forced }

    /// <summary>引爆的结果：引发了某个反应，或单一状态的「崩解」（前四项与 <see cref="Reaction"/> 同序，处理器也按它编号）</summary>
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
        /// <summary>强度：作为附着强度 Pin 代入威力公式（给了 <see cref="fixedBase"/> 时不用）</summary>
        public float power;
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

    /// <summary>直接挂元素的参数（<see cref="ReactionSystem.ApplyStatus"/>，Three.js StatusApplyOpts）</summary>
    public struct StatusApplyOpts
    {
        /// <summary>这次附着的深度（≥ 2 不引发反应；只有 0 会触发雷殛弹射）</summary>
        public int depth;
        /// <summary>归属武器（由它引发的反应带上该 weaponUid）</summary>
        public int weaponUid;
        /// <summary>由这次附着引发的反应的威力倍率，0（未设）视为 1（传说「万象」传 0.6）</summary>
        public float reactionScale;
        /// <summary>出手者（持续伤害 / 反应伤害的 instigator 沿用它）</summary>
        public UnityEngine.Object instigator;
    }

    /// <summary>
    /// 元素反应（docs/arsenal-expansion.md 第 2 节，Three.js 版 src/combat/Reactions.ts）：
    ///   焚雷 = 灼烧 + 雷殛 · 熔金 = 灼烧 + 蚀化 · 封脉 = 雷殛 + 蚀化 · 归墟 = 三种齐聚；崩解 = 引爆单一状态。
    /// 各自的效果在 Combat/Reactions/&lt;Id&gt;Handler.cs（<see cref="IReactionHandler"/>，注册表自动发现），数值在 <see cref="CombatTuning"/>。
    /// 威力 B = clamp(k × 附着强度, 下限 × S, 上限 × S) × scale，S = 1 + (等级 − 1) × 0.85；两两反应不消耗状态，频率由逐敌冷却封顶。
    /// 入口（都只入队、不同步造成伤害，可以在任意事件回调里调用）：
    ///   <see cref="TryReact"/>（元素附着前，Combat 调用）· <see cref="ApplyStatus"/>（技能 / 秘卷直接挂元素，带 reactionScale）·
    ///   <see cref="Detonate"/>（引爆：三相 → 归墟，两相 → 按优先级，单相 → 崩解；0.5 s 冷却、同一击并入）·
    ///   <see cref="Trigger"/>（强制反应：ignoreIcd / fixedBase / scale / tag）。
    /// 判定与排队在 <see cref="ReactionScheduler"/>，这里在 Update 里执行到时的条目、发浮字、派发 <see cref="GameEvents.Reacted"/>
    /// （origin = Status / Detonate / Forced；旧的 <see cref="Reacted"/> 照常转发；崩解不派发）。
    /// 防递归：深度 ≥ 2 的附着不反应；反应伤害深度 +1、source Status（不再附着）；扩散出去的元素深度 +1，最多再连锁一级（延后 0.15 s）。
    /// 预算：每帧接受 8 次反应、队列 32 条；大特效 3 个 / 帧、反应浮字 4 条 / 帧（同一敌人 0.3 s 一条）；熔池同时 4 个。
    /// 首领被封脉不眩晕，改为「脉滞」：4 s 内受到的伤害 ×1.12（登记在它的 <see cref="Damageable.Incoming"/> 上）。
    /// </summary>
    public sealed class ReactionSystem : MonoBehaviour
    {
        /// <summary>反应名（浮字），同 <see cref="CombatTuning.ReactionNames"/></summary>
        public static string[] Names => CombatTuning.ReactionNames;
        /// <summary>反应颜色，同 <see cref="CombatTuning.ReactionColors"/></summary>
        public static Color[] Colors => CombatTuning.ReactionColors;

        static readonly EventChannel<Action<Damageable, Reaction, Vector3, float, int>> reacted = new();

        /// <summary>旧事件（转发，第 4 批删除）：(中心敌人, 反应, 中心点, 威力 B, 受到伤害的敌人数)。新代码订阅 <see cref="GameEvents.Reacted"/></summary>
        public static event Action<Damageable, Reaction, Vector3, float, int> Reacted { add => reacted.Add(value); remove => reacted.Remove(value); }

        static readonly ReactionStats stats = new();

        /// <summary>反应计数（接受 / 执行 / 丢弃 / 预算峰值；调试叠层读）</summary>
        public static ReactionStats Stats => stats;

        static bool warnedMissing;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            reacted.Clear();
            stats.Reset();
            warnedMissing = false;
            instance = null;
        }

        static ReactionSystem instance;
        ReactionScheduler scheduler;
        readonly List<ReactionJob> batch = new();
        readonly FrameBudget bigFx = new(CombatTuning.BigFxBudget);
        readonly LabelThrottle labels = new();
        bool flushing;

        static ReactionSystem Instance
        {
            get
            {
                if (!instance) instance = new GameObject("Reaction System").AddComponent<ReactionSystem>();
                return instance;
            }
        }

        ReactionScheduler Scheduler => scheduler ??= new ReactionScheduler(GameReactionEnv.Instance, stats);

        void OnDestroy()
        {
            if (instance != this && instance) return;
            instance = null;
            scheduler?.Clear();
            labels.Clear();
            ReactionHandlers.ClearAll();
        }

        // ───────────── 判定入口 ─────────────

        /// <summary>
        /// 元素附着前的反应判定（Combat 在附着状态之前调用）：判定成功则记冷却、（归墟）消耗状态、入队，返回反应；
        /// 之后调用方照常附着 incoming。击杀那一击只能引发两两反应。weaponUid = 引发它的那一击出自哪把武器（反应伤害沿用）；
        /// scale = 反应威力倍率（附着的 reactionScale）。
        /// </summary>
        public static Reaction? TryReact(Damageable enemy, Element incoming, float pin, int depth, bool killed, int weaponUid = 0, float scale = 1f)
        {
            if (depth >= CombatTuning.MaxReactionDepth || incoming == Element.None || !enemy) return null;
            if (!killed && enemy.Dead) return null;
            if (!EnemyStatus.Of(enemy)) return null; // 从没挂过状态：不可能反应，也不必建反应系统
            var j = Instance.Scheduler.TryReact(enemy, incoming, pin, depth, killed, weaponUid, scale, Time.time, Time.frameCount);
            return j != null ? j.Reaction : null;
        }

        /// <summary>
        /// 技能 / 秘卷直接挂元素（不经过伤害，Three.js applyStatus）：先判定反应（威力 × opts.reactionScale），再挂状态。
        /// power = 状态强度（不含元素 / 精英 / 首领加成，钳到最大生命 × 0.5），反应强度按它乘回属性倍率。返回引发的反应（只是入队）。
        /// </summary>
        public static Reaction? ApplyStatus(Damageable target, Element element, float power, in StatusApplyOpts opts)
        {
            if (!target || target.Dead || target.untargetable || element == Element.None || !(power > 0)) return null;
            float cap = target.maxHealth * CombatTuning.PinCapOfMaxHp;
            float statusPower = Mathf.Min(power, cap);
            float pin = Mathf.Min(DamageCalc.ReactionPowerFromStatus(target, element, statusPower), cap);
            target.lastElementBy = opts.instigator;
            float scale = opts.reactionScale > 0 ? opts.reactionScale : 1f;
            Reaction? rx = null;
            if (opts.depth < CombatTuning.MaxReactionDepth)
            {
                var j = Instance.Scheduler.TryReact(target, element, pin, opts.depth, false, opts.weaponUid, scale, Time.time, Time.frameCount);
                if (j != null) rx = j.Reaction;
            }
            EnemyStatus.Apply(target, element, statusPower, opts.depth, false);
            return rx;
        }

        /// <summary>
        /// 引爆敌人身上已有的元素状态：三相 → 归墟，两相 → 按优先级的两两反应，单相 → 崩解（不消耗状态）。只入队，不同步造成伤害。
        /// 同一敌人 0.5 s 内只引爆一次；冷却内同一击（本帧 / 上一帧）的再次引爆并入还没执行的那次（取较高强度），返回那次的结果。
        /// 被冷却 / 预算 / 深度拒绝、敌人不存活 / 不可选中、或身上没有元素状态时返回 null。
        /// </summary>
        public static DetonateOutcome? Detonate(Damageable enemy, in DetonateOpts opts)
        {
            if (!enemy || enemy.Dead) return null;
            var j = Instance.Scheduler.Detonate(enemy, opts, Time.time, Time.frameCount);
            return j?.kind;
        }

        /// <summary>
        /// 强制引发一次反应（不需要、也不消耗元素状态；opts.power 作为附着强度，或 fixedBase 直接给 B）。只入队，不同步造成伤害。
        /// 被预算 / 深度 / 冷却拒绝时返回 null，否则返回入队的反应。敌人可以已死（必须给 opts.point）：中心伤害跳过，范围部分照常。
        /// </summary>
        public static Reaction? Trigger(Damageable enemy, Reaction id, in TriggerOpts opts)
        {
            if (ReferenceEquals(enemy, null)) return null;
            var j = Instance.Scheduler.Trigger(enemy, id, opts, Time.time, Time.frameCount);
            return j != null ? j.Reaction : null;
        }

        /// <summary>封脉首领「脉滞」倍率：生效中 1.12，否则 1（伤害预览用；实际伤害已经由修饰器乘上）</summary>
        public static float VulnMult(Damageable d) => instance && instance.scheduler != null ? instance.scheduler.VulnMult(d, Time.time) : 1f;

        // ───────────── 执行 ─────────────

        void Update()
        {
            float now = Time.time;
            int frame = Time.frameCount;
            var s = Scheduler;
            if (!flushing)
            {
                batch.Clear();
                s.TakeDue(now, batch);
                if (batch.Count > 0)
                {
                    flushing = true;
                    try
                    {
                        for (int i = 0; i < batch.Count; i++)
                        {
                            var j = batch[i];
                            try
                            {
                                Execute(j);
                            }
                            catch (Exception e)
                            {
                                stats.errors++;
                                Debug.LogException(e);
                            }
                            finally
                            {
                                s.Release(j);
                            }
                        }
                    }
                    finally
                    {
                        batch.Clear();
                        flushing = false;
                    }
                }
            }
            var table = ReactionHandlers.Table;
            for (int i = 0; i < table.Length; i++)
            {
                if (table[i] == null) continue;
                try
                {
                    table[i].Tick(Time.deltaTime);
                }
                catch (Exception e)
                {
                    stats.errors++;
                    Debug.LogException(e);
                }
            }
            if (frame % 300 == 0)
            {
                // 回收已销毁敌人的冷却 / 浮字记录
                s.Prune();
                labels.Prune();
            }
        }

        void Execute(ReactionJob j)
        {
            var h = ReactionHandlers.Get(j.kind);
            if (h == null)
            {
                if (!warnedMissing)
                {
                    warnedMissing = true;
                    Debug.LogError($"[Reaction] 没有 {j.kind} 的处理器（Combat/Reactions/*Handler 要带 [Defs]）");
                }
                return;
            }
            var e = j.enemy;
            if (j.kind == DetonateOutcome.Collapse)
            {
                if (!e || e.Dead) return;
                stats.executed[(int)j.kind]++;
                h.Execute(j);
                return;
            }

            bool alive = e && !e.Dead;
            j.center = alive ? CenterOf(e) : j.point;
            float strength = e ? Scheduler.Env.Strength(e) : j.strength;
            var id = j.Reaction;
            j.B = j.fixedBase ?? ReactionMath.Base(id, j.pin, strength) * j.scale;
            if (!(j.B > 0)) return;
            j.centerAlive = alive && !j.killed;
            j.hits = 0;
            j.stunned = false;
            stats.executed[(int)j.kind]++;
            h.Execute(j);

            Label(e, j.center, Names[(int)id], Colors[(int)id], id == Reaction.Abyss);
            var ev = new ReactionEvent
            {
                enemy = e, id = id, point = j.center, B = j.B, depth = j.depth, hits = j.hits, origin = j.origin, tag = j.tag, weaponUid = j.weaponUid,
                centerKilled = !e || e.Dead, stunned = j.stunned,
            };
            GameEvents.RaiseReacted(in ev);
            reacted.Raise(e, id, j.center, j.B, j.hits);
        }

        // ───────────── 处理器共用的工具 ─────────────

        /// <summary>本帧还能不能放一个「大」反应特效（爆炸声 + 大爆闪）：每帧最多 <see cref="CombatTuning.BigFxBudget"/> 个，能的话占一份</summary>
        public static bool TryBigFx()
        {
            if (!instance) return true;
            var b = instance.bigFx;
            bool ok = b.TryTake(Time.frameCount);
            if (ok) stats.bigFxFrameMax = Mathf.Max(stats.bigFxFrameMax, b.Peak);
            else stats.bigFxDenied++;
            return ok;
        }

        /// <summary>
        /// 反应浮字（「焚雷」「崩解」…）：画在 at 上方 0.9 m。每帧最多 <see cref="CombatTuning.LabelBudget"/> 条，
        /// 同一敌人 <see cref="CombatTuning.LabelGap"/> 秒一条（big = 大号，不受逐敌节流）。
        /// </summary>
        public static void Label(Damageable enemy, Vector3 at, string text, Color color, bool big)
        {
            if (!instance) return;
            var l = instance.labels;
            if (!l.Allow(enemy, big, Time.time, Time.frameCount))
            {
                stats.labelsDenied++;
                return;
            }
            stats.labelFrameMax = Mathf.Max(stats.labelFrameMax, l.Budget.Peak);
            var hud = Hud.Instance;
            if (hud) hud.FloatText(at + Vector3.up * 0.9f, text, color, big ? 1.9f : 1.35f);
        }

        /// <summary>封脉眩晕的独立冷却（3.5 s，不吃急速）：就绪则记下冷却并返回 true</summary>
        public static bool TryArmSealStun(Damageable enemy) => Instance.Scheduler.TryArmSealStun(enemy, Time.time);

        /// <summary>首领「脉滞」：seconds 秒内受到的伤害 ×1.12（第一次在它身上登记受伤修饰器，之后只续时间）</summary>
        public static void MarkVuln(Damageable enemy, float seconds) => Instance.Scheduler.MarkVuln(enemy, Time.time + seconds, vulnModifier);

        static readonly Incoming vulnModifier = VulnIncoming;

        // 敌人之间、环境的伤害不吃（脉滞只放大玩家方的伤害）
        static float VulnIncoming(in IncomingHit h) =>
            h.info.source is DamageSource.Enemy or DamageSource.Environment ? 1f : VulnMult(h.target);

        /// <summary>反应半径 × 玩家「爆炸范围」</summary>
        public static float Radius(float r) => r * (Combat.playerStats?.Mult(Stat.ExplosionRadiusPct) ?? 1f);

        /// <summary>反应 → 伤害标签（Reaction + 反应自己的标签）</summary>
        public static DamageTag TagOf(Reaction id) => DamageTag.Reaction | id switch
        {
            Reaction.Thunderfire => DamageTag.Thunderfire,
            Reaction.Meltdown => DamageTag.Meltdown,
            Reaction.Veinseal => DamageTag.Veinseal,
            _ => DamageTag.Abyss,
        };

        /// <summary>反应伤害请求：source Status、不暴击、深度 +1、标签 Reaction + 反应 id（+ extra），只吃「反应伤害」加成</summary>
        public static DamageInfo ReactionHit(float amount, Element element, int depth, Vector3 point, Reaction id, int weaponUid, DamageTag extra = DamageTag.None) =>
            ReactionHit(amount, element, depth, point, TagOf(id) | extra, id, weaponUid);

        /// <summary>反应类伤害请求（通用：崩解用 Reaction + Collapse、id 为 null）</summary>
        public static DamageInfo ReactionHit(float amount, Element element, int depth, Vector3 point, DamageTag tags, Reaction? id, int weaponUid)
        {
            var info = DamageInfo.Simple(amount, DamageSource.Status, point, Vector3.up);
            info.weaponUid = weaponUid;
            info.element = element;
            info.depth = depth + 1;
            info.reaction = true;
            info.reactionId = id;
            info.tags = tags | DamageTag.Reaction;
            info.noCrit = true;
            return info;
        }

        /// <summary>反应对单个敌人的伤害；造成了伤害返回 true</summary>
        public static bool Hit(Damageable d, float amount, Element element, int depth, Vector3 point, Reaction id, int weaponUid, DamageTag extra = DamageTag.None)
        {
            if (!d || d.Dead) return false;
            var r = Combat.DamageEnemy(d, ReactionHit(amount, element, depth, point, id, weaponUid, extra));
            return r.total > 0;
        }

        /// <summary>反应类伤害（通用标签版）；造成了伤害返回 true</summary>
        public static bool Hit(Damageable d, float amount, Element element, int depth, Vector3 point, DamageTag tags, Reaction? id, int weaponUid)
        {
            if (!d || d.Dead) return false;
            var r = Combat.DamageEnemy(d, ReactionHit(amount, element, depth, point, tags, id, weaponUid));
            return r.total > 0;
        }

        public static Vector3 CenterOf(Damageable d)
        {
            var col = d.GetComponent<Collider>();
            return col && col.enabled ? col.bounds.center : d.transform.position + Vector3.up;
        }

        /// <summary>p 正下方 6 m 内的地面（抬 5 cm）；没有地面返回 p</summary>
        public static Vector3 Ground(Vector3 p)
        {
            if (Physics.Raycast(p + Vector3.up * 0.5f, Vector3.down, out var hit, 6f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                return hit.point + Vector3.up * 0.05f;
            return p;
        }

        // Nearest 的候选缓冲（Nearest 内部只做射线检测、不回调外部代码，不会重入）
        static readonly List<Damageable> nearCand = new();
        static readonly List<float> nearDist = new();

        /// <summary>
        /// from 附近 range 内最近的若干个活着、可选中的敌人（排除 exclude；needSight 时要求视线不被地形挡住），按距离由近到远写进 results（先清空）。
        /// 不分配（调用方给结果列表）。返回个数。
        /// </summary>
        public static int Nearest(Vector3 from, float range, int count, Damageable exclude, bool needSight, List<Damageable> results)
        {
            results.Clear();
            if (count <= 0) return 0;
            var cand = nearCand;
            var dist = nearDist;
            cand.Clear();
            dist.Clear();
            var all = EnemyAI.All;
            for (int i = 0; i < all.Count; i++)
            {
                var ai = all[i];
                if (!ai || ai.Dead) continue;
                var d = ai.Health;
                if (!d || d == exclude || d.untargetable) continue;
                float dd = Vector3.Distance(from, CenterOf(d));
                if (dd > range) continue;
                cand.Add(d);
                dist.Add(dd);
            }
            while (results.Count < count)
            {
                int bi = -1;
                float bd = float.PositiveInfinity;
                for (int i = 0; i < dist.Count; i++)
                    if (dist[i] < bd)
                    {
                        bd = dist[i];
                        bi = i;
                    }
                if (bi < 0) break;
                dist[bi] = float.PositiveInfinity;
                var e = cand[bi];
                if (needSight && Combat.Blocked(from, CenterOf(e), e.GetComponent<Collider>())) continue;
                results.Add(e);
            }
            cand.Clear();
            dist.Clear();
            return results.Count;
        }

        /// <summary>同 <see cref="Nearest(Vector3, float, int, Damageable, bool, List{Damageable})"/>，返回新列表（旧接口，热路径用上面那个）</summary>
        public static List<Damageable> Nearest(Vector3 from, float range, int count, Damageable exclude, bool needSight)
        {
            var list = new List<Damageable>(Mathf.Clamp(count, 0, 16));
            Nearest(from, range, count, exclude, needSight, list);
            return list;
        }
    }
}
