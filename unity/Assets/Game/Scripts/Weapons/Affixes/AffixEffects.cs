using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 触发效果要碰的外部世界：时间、随机数、按 uid 找枪、敌人状态、找最近的敌人、造成伤害 / 挂状态 / 引爆 / 强制反应、回填弹匣、加护盾、特效。
    /// 游戏里是 <see cref="GameAffixEnv"/>（转给 Combat / ReactionSystem / PlayerVitals）；EditMode 测试换成记录调用的假环境。
    /// </summary>
    public interface IAffixEnv
    {
        /// <summary>游戏时间（秒）</summary>
        float Now { get; }
        /// <summary>[0, 1) 随机数</summary>
        float Random();
        /// <summary>玩家手上（两个槽里）uid 对应的枪；换下 / 丢掉的找不到（它的投射物不再吃词条，同 TS host.find）</summary>
        WeaponInstance Find(int uid);
        ResolvedWeapon Resolve(WeaponInstance w);
        /// <summary>敌人身上此刻的状态（刚被打死的：死亡瞬间的状态）</summary>
        StatusMask Statuses(Damageable e);
        /// <summary>玩家「反应急速」</summary>
        float ReactionHaste { get; }
        Vector3 Center(Damageable e);
        /// <summary>from 附近 range 米内最近的活着、可选中的敌人（排除 exclude，不要求视线）；没有为 null</summary>
        Damageable Nearest(Vector3 from, float range, Damageable exclude);
        /// <summary>回填弹匣 rounds 发（不超过容量；已满不响）</summary>
        void Refill(WeaponInstance w, int rounds);
        /// <summary>给玩家加护盾（玩家死了不加）</summary>
        void AddShield(float amount);
        /// <summary>范围爆炸；ring = 另画一圈冲击波（殉爆）</summary>
        void Explode(in ExplosionOptions o, bool ring);
        /// <summary>对单个敌人造成伤害，并从 from 画一道曳光（弹射）</summary>
        void Strike(Damageable target, in DamageInfo info, Vector3 from, Color tracer);
        void ApplyStatus(Damageable e, Element element, float power, in StatusApplyOpts o);
        void Detonate(Damageable e, in DetonateOpts o);
        /// <summary>强制反应；被预算 / 深度 / 冷却拒绝返回 false</summary>
        bool Trigger(Damageable e, Reaction id, in TriggerOpts o);
        /// <summary>连线特效（蛊种传染）</summary>
        void Beam(Vector3 from, Vector3 to, Color color);
    }

    /// <summary>
    /// 触发类词条与传说特性的派发器（同 TS src/weapons/AffixEffects.ts 的框架部分）。由 <see cref="AffixRuntime"/> 持有，订阅 GameEvents 转进来：
    ///   · <see cref="OnDamaged"/>：本武器的直接命中（带 weaponUid 的武器伤害、深度 0，含武器投射物的爆炸；免疫不算）→ 各词条的 <see cref="IAffixEffect.OnHit"/>；
    ///   · <see cref="OnKilled"/>：带 weaponUid 的武器伤害打死了敌人（任意深度，词条自己看深度）→ <see cref="IAffixEffect.OnKill"/>；
    ///   · <see cref="OnReaction"/>：先处理「蛊种」传染（任何来源的反应），再把归属本武器的反应 → <see cref="IAffixEffect.OnReaction"/>。
    /// 词条只判定、记状态；会再次造成伤害 / 挂状态的效果（爆头爆炸、弹射、殉爆、万象 / 副元素附着、破势引爆、涅槃、蛊种传染）调 Queue* 入队，
    /// 由 <see cref="Flush"/> 在下一帧开头执行（AffixRuntime 的执行顺序早于武器、投射物、状态、反应），避免在伤害结算 / 事件派发中重入。
    /// 同帧合并：一帧内武器对同一敌人的直接伤害累加；Flush 时副元素附着与引爆的强度取「上一帧对该敌人的总伤害」（一发霰弹 / 一次爆炸按整发算），
    /// 同一把枪对同一敌人的同种副元素附着在队列里只留一条。执行中再触发的效果排到下一次 Flush。换关（<see cref="Clear"/>）丢弃未执行的。
    /// </summary>
    public sealed class AffixEffects
    {
        /// <summary>爆头爆炸：半径（× 玩家爆炸范围）、同一把枪两次爆炸的最短间隔（一发霰弹多颗弹丸爆头只炸一次）</summary>
        public const float HeadBlastRadius = 2.2f, HeadBlastGap = 0.08f;
        /// <summary>弹射：找目标的范围、伤害比例</summary>
        public const float RicochetRange = 10f, RicochetDamage = 0.5f;
        /// <summary>附着 / 引爆强度上限 = 敌人最大生命 × 0.5（与状态系统一致）</summary>
        public const float PowerCap = 0.5f;
        /// <summary>「万象」附着引发的反应威力倍率</summary>
        public const float PrismReactionScale = 0.6f;
        /// <summary>「破势」同一把枪两次引爆的最短间隔</summary>
        public const float DetonateIcd = 1.5f;
        /// <summary>归一化后的「每次命中几率」上限（斩击放大后封顶）</summary>
        public const float PerHitCap = 0.75f;
        /// <summary>「回元」「化盾」最短间隔；「疾化」持续时间</summary>
        public const float RxnProcGap = 0.3f, RxnHasteTime = 3f;
        /// <summary>蛊种持续时间、传染范围</summary>
        public const float SeedDuration = 6f, EchoRange = 8f;
        /// <summary>「涅槃」引发的反应深度（中心已死，只结算范围部分；范围击杀是状态来源，不会再触发涅槃）</summary>
        public const int NirvanaDepth = 1;
        /// <summary>蛊种传染的连线颜色（#9dff4a）</summary>
        public static readonly Color EchoColor = new(0x9d / 255f, 1f, 0x4a / 255f);

        enum Kind { Blast, Ricochet, Status, Sub, Detonate, Nirvana, Echo }

        sealed class Proc
        {
            public Kind kind;
            public int uid;
            /// <summary>弹射源 / 附着与引爆目标 / 涅槃的死者 / 带蛊种的敌人（选目标时排除）</summary>
            public Damageable enemy;
            public Vector3 point;
            /// <summary>伤害 / 强度 / 威力（蛊种传染：fixedBase = base × scale）</summary>
            public float amount;
            public Element element, status;
            public float elementChance, critMult, radius, scale, mult, knockback;
            public int depth;
            public Reaction reaction;
            public string procId;
            public bool ring;
        }

        /// <summary>敌人身上的标记：蛊种（截止时刻、威力比例、种下它的枪）、「合璧」下次可强制附着的时刻</summary>
        sealed class Marks
        {
            public float seedUntil = -1, seedValue;
            public int seedUid;
            public float bondAt = -1;
        }

        readonly IAffixEnv env;
        List<Proc> queue = new(), spare = new();
        readonly Stack<Proc> pool = new();
        Dictionary<Damageable, float> dealtNow = new(), dealtPrev = new();
        readonly Dictionary<Damageable, Marks> marks = new();
        readonly List<Damageable> stale = new();
        bool flushing;

        public AffixEffects(IAffixEnv env) => this.env = env ?? throw new ArgumentNullException(nameof(env));

        public IAffixEnv Env => env;
        public float Now => env.Now;
        public float Random() => env.Random();
        /// <summary>等待下一次 <see cref="Flush"/> 的效果数</summary>
        public int Pending => queue.Count;

        // ───────────── 事件 ─────────────

        /// <summary>敌人受到伤害（GameEvents.EnemyDamaged）：本武器的直接命中派发 OnHit，并累加同帧伤害</summary>
        public void OnDamaged(in HitEvent e)
        {
            var enemy = e.enemy;
            if (!enemy || e.result.immune || e.info.depth > 0 || !IsWeaponHit(in e.info)) return;
            if (e.result.total > 0) dealtNow[enemy] = (dealtNow.TryGetValue(enemy, out var d) ? d : 0) + e.result.total;
            var w = env.Find(e.info.weaponUid);
            if (w == null || w.affixes.Count == 0) return;
            var r = env.Resolve(w);
            if (r == null) return;
            float now = env.Now;
            var list = w.affixes;
            for (int i = 0; i < list.Count; i++)
            {
                if (!FirstOf(list, i)) continue;
                var fx = AffixLibrary.Get(list[i].id)?.Effect;
                if (fx == null) continue;
                try { fx.OnHit(new AffixHook(w, r, ValueOf(w, r, list[i].id), this, now), in e); }
                catch (Exception ex) { Debug.LogException(ex); }
            }
        }

        /// <summary>敌人被打死（GameEvents.EnemyKilled）：带 weaponUid 的武器伤害派发 OnKill（深度由词条自己判断：击杀回填只认直接击杀，殉爆允许两级连锁）</summary>
        public void OnKilled(in KillEvent e)
        {
            if (ReferenceEquals(e.enemy, null) || !IsWeaponHit(in e.info)) return;
            var w = env.Find(e.info.weaponUid);
            if (w == null || w.affixes.Count == 0) return;
            var r = env.Resolve(w);
            if (r == null) return;
            float now = env.Now;
            var list = w.affixes;
            for (int i = 0; i < list.Count; i++)
            {
                if (!FirstOf(list, i)) continue;
                var fx = AffixLibrary.Get(list[i].id)?.Effect;
                if (fx == null) continue;
                try { fx.OnKill(new AffixHook(w, r, ValueOf(w, r, list[i].id), this, now), in e); }
                catch (Exception ex) { Debug.LogException(ex); }
            }
        }

        /// <summary>
        /// 反应执行完毕（GameEvents.Reacted，在伤害管线之外）：「蛊种」——任何来源的反应都会传染给附近 1 名敌人（传染出的反应不再传染、深度到顶的不传）；
        /// 然后只把归属本武器（weaponUid）的反应派发给 OnReaction（回元、疾化、化盾、鼎沸）。
        /// </summary>
        public void OnReaction(in ReactionEvent e)
        {
            float now = env.Now;
            if (e.tag != DamageTag.Echo && e.depth + 1 < CombatTuning.MaxReactionDepth && !ReferenceEquals(e.enemy, null) &&
                marks.TryGetValue(e.enemy, out var m) && m.seedUntil > now)
            {
                m.seedUntil = -1;
                var p = Alloc(Kind.Echo, m.seedUid);
                p.enemy = e.enemy;
                p.point = e.point;
                p.reaction = e.id;
                p.amount = e.B;
                p.scale = m.seedValue;
                p.depth = e.depth + 1;
            }
            if (e.weaponUid == 0) return;
            var w = env.Find(e.weaponUid);
            if (w == null || w.affixes.Count == 0) return;
            var r = env.Resolve(w);
            if (r == null) return;
            var list = w.affixes;
            for (int i = 0; i < list.Count; i++)
            {
                if (!FirstOf(list, i)) continue;
                var fx = AffixLibrary.Get(list[i].id)?.Effect;
                if (fx == null) continue;
                try { fx.OnReaction(new AffixHook(w, r, ValueOf(w, r, list[i].id), this, now), in e); }
                catch (Exception ex) { Debug.LogException(ex); }
            }
        }

        /// <summary>执行上一帧累积的触发效果（每帧一次，在武器 / 投射物 / 状态 / 反应更新之前）。执行中入队的效果留到下一次</summary>
        public void Flush()
        {
            if (flushing) return;
            flushing = true;
            try
            {
                // 同帧合并：dealtPrev = 上一帧全部武器直接伤害；dealtNow 换成上次执行完已清空的那张表
                (dealtNow, dealtPrev) = (dealtPrev, dealtNow);
                if (queue.Count > 0)
                {
                    var list = queue;
                    queue = spare;
                    spare = list;
                    for (int i = 0; i < list.Count; i++)
                    {
                        var p = list[i];
                        try { Run(p); }
                        catch (Exception ex) { Debug.LogException(ex); }
                        Release(p);
                    }
                    list.Clear();
                }
                dealtPrev.Clear();
                if (marks.Count > 64) PruneMarks();
            }
            finally { flushing = false; }
        }

        /// <summary>换关 / 场景卸载：丢弃未执行的触发、同帧伤害与敌人身上的标记</summary>
        public void Clear()
        {
            foreach (var p in queue) Release(p);
            queue.Clear();
            dealtNow.Clear();
            dealtPrev.Clear();
            marks.Clear();
        }

        // ───────────── 入队（给词条效果用）─────────────

        /// <summary>
        /// 范围爆炸（爆头爆炸、殉爆）：武器来源 + Proc 标签（procId 写明是谁），不暴击，按 elementChance 附着 element；depth = 衍生深度（≥ 1）
        /// </summary>
        public void QueueBlast(in AffixHook h, string procId, Vector3 point, float damage, float radius, Element element, float elementChance,
            int depth, float knockback, bool ring = false)
        {
            if (!(damage > 0) || !(radius > 0)) return;
            var p = Alloc(Kind.Blast, h.weapon.uid);
            p.procId = procId;
            p.point = point;
            p.amount = damage;
            p.radius = radius;
            p.element = element;
            p.elementChance = elementChance;
            p.critMult = h.stats.critMult;
            p.depth = Mathf.Max(1, depth);
            p.knockback = knockback;
            p.ring = ring;
        }

        /// <summary>弹射：从 from（敌人）身上的 point 弹向 <see cref="RicochetRange"/> 米内最近的另一名敌人，造成 damage（可暴击，深度 1）</summary>
        public void QueueRicochet(in AffixHook h, Damageable from, Vector3 point, float damage, Element element)
        {
            if (!(damage > 0)) return;
            var p = Alloc(Kind.Ricochet, h.weapon.uid);
            p.procId = "ricochet";
            p.enemy = from;
            p.point = point;
            p.amount = damage;
            p.element = element;
            p.elementChance = h.stats.elementChance;
            p.critMult = h.stats.critMult;
            p.depth = 1;
        }

        /// <summary>直接挂元素状态（「万象」）：power = 状态强度（命中时已按 <see cref="DamageCalc.StatusPowerFromDealt"/> 折算），reactionScale = 由它引发的反应威力倍率</summary>
        public void QueueStatus(in AffixHook h, Damageable e, Element status, float power, float reactionScale = 1)
        {
            if (!e || status == Element.None || !(power > 0)) return;
            var p = Alloc(Kind.Status, h.weapon.uid);
            p.enemy = e;
            p.status = status;
            p.amount = power;
            p.scale = reactionScale;
        }

        /// <summary>
        /// 副元素类附着（副·焚 / 副·雷 / 副·蚀、合璧、轮回）：执行时强度 = 上一帧该敌人受到的武器总伤害（没有记录用 dealt），折算成状态强度。
        /// 同一把枪对同一敌人的同种状态在队列里只留一条（一发霰弹 / 一次爆炸只附着一次）
        /// </summary>
        public void QueueSub(in AffixHook h, Damageable e, Element status, float dealt)
        {
            if (!e || status == Element.None) return;
            int uid = h.weapon.uid;
            for (int i = 0; i < queue.Count; i++)
            {
                var o = queue[i];
                if (o.kind == Kind.Sub && o.uid == uid && o.enemy == e && o.status == status) return;
            }
            var p = Alloc(Kind.Sub, uid);
            p.enemy = e;
            p.status = status;
            p.amount = dealt;
        }

        /// <summary>引爆目标身上的元素状态（破势）：强度同副元素（上一帧合并伤害），× mult</summary>
        public void QueueDetonate(in AffixHook h, Damageable e, float dealt, float mult)
        {
            if (!e) return;
            var p = Alloc(Kind.Detonate, h.weapon.uid);
            p.enemy = e;
            p.amount = dealt;
            p.mult = mult;
        }

        /// <summary>于尸身强制引发反应（涅槃）：power 作为附着强度，无视冷却，深度 <see cref="NirvanaDepth"/>，标签 Nirvana</summary>
        public void QueueNirvana(in AffixHook h, Damageable corpse, Vector3 point, Reaction id, float power)
        {
            if (ReferenceEquals(corpse, null) || !(power > 0)) return;
            var p = Alloc(Kind.Nirvana, h.weapon.uid);
            p.enemy = corpse;
            p.point = point;
            p.reaction = id;
            p.amount = power;
            p.depth = NirvanaDepth;
        }

        /// <summary>种下（或刷新）蛊种：until 之前它身上发生的反应会以 value 威力传染给附近 1 名敌人（只传一次），归属 uid 那把枪</summary>
        public void PlantSeed(Damageable e, float value, int uid, float until)
        {
            if (!e || !(value > 0)) return;
            var m = MarksOf(e);
            m.seedUntil = until;
            m.seedValue = value;
            m.seedUid = uid;
        }

        /// <summary>敌人身上的蛊种还在不在（测试、调试显示）</summary>
        public bool HasSeed(Damageable e) => e && marks.TryGetValue(e, out var m) && m.seedUntil > env.Now;

        /// <summary>「合璧」：这名敌人下次可被强制附着的时刻（没有记录为 −1）</summary>
        public float BondReadyAt(Damageable e) => e && marks.TryGetValue(e, out var m) ? m.bondAt : -1;

        public void SetBondReadyAt(Damageable e, float at)
        {
            if (e) MarksOf(e).bondAt = at;
        }

        // ───────────── 执行 ─────────────

        void Run(Proc p)
        {
            switch (p.kind)
            {
                case Kind.Blast:
                {
                    var info = new DamageInfo
                    {
                        amount = p.amount, element = p.element, source = DamageSource.Weapon, tags = DamageTag.Weapon | DamageTag.Proc, procId = p.procId,
                        statusChance = p.elementChance, noCrit = true, critMult = p.critMult, weaponUid = p.uid, depth = p.depth,
                        knockback = p.knockback, point = p.point, direction = Vector3.up,
                    };
                    var o = new ExplosionOptions(p.point, p.radius, info) { color = BlastColor(p.element) };
                    env.Explode(in o, p.ring);
                    break;
                }
                case Kind.Ricochet:
                {
                    var t = env.Nearest(p.point, RicochetRange, p.enemy);
                    if (!t || t.Dead) break;
                    var c = env.Center(t);
                    var info = new DamageInfo
                    {
                        amount = p.amount, element = p.element, source = DamageSource.Weapon, tags = DamageTag.Weapon | DamageTag.Proc, procId = p.procId,
                        statusChance = p.elementChance, critMult = p.critMult, weaponUid = p.uid, depth = p.depth,
                        knockback = 0.5f, point = c, direction = (c - p.point).normalized,
                    };
                    env.Strike(t, in info, p.point, BlastColor(p.element));
                    break;
                }
                case Kind.Status:
                {
                    var e = p.enemy;
                    if (!e || e.Dead) break;
                    env.ApplyStatus(e, p.status, p.amount, new StatusApplyOpts { depth = 0, weaponUid = p.uid, reactionScale = p.scale });
                    break;
                }
                case Kind.Sub:
                {
                    var e = p.enemy;
                    if (!e || e.Dead) break;
                    // 合并后的强度是命中伤害（已含属性加成）：折算成状态强度，免得持续伤害把加成算两次（反应强度会乘回去）
                    float power = DamageCalc.StatusPowerFromDealt(e, p.status, MergedPower(e, p.amount));
                    if (power > 0) env.ApplyStatus(e, p.status, power, new StatusApplyOpts { depth = 0, weaponUid = p.uid });
                    break;
                }
                case Kind.Detonate:
                {
                    var e = p.enemy;
                    if (!e || e.Dead) break;
                    env.Detonate(e, new DetonateOpts { power = MergedPower(e, p.amount), mult = p.mult, depth = 0, weaponUid = p.uid });
                    break;
                }
                case Kind.Nirvana:
                    env.Trigger(p.enemy, p.reaction, new TriggerOpts
                    {
                        power = p.amount, depth = p.depth, weaponUid = p.uid, point = p.point, ignoreIcd = true, tag = DamageTag.Nirvana,
                    });
                    break;
                case Kind.Echo:
                {
                    var t = env.Nearest(p.point, EchoRange, p.enemy);
                    if (!t || t.Dead) break;
                    var opts = new TriggerOpts { depth = p.depth, weaponUid = p.uid, fixedBase = p.amount * p.scale, tag = DamageTag.Echo };
                    if (env.Trigger(t, p.reaction, in opts)) env.Beam(p.point, env.Center(t), EchoColor);
                    break;
                }
            }
        }

        /// <summary>附着 / 引爆强度：上一帧武器对该敌人的总伤害（同帧合并），没有记录时用入队时这一击的伤害；上限最大生命 × 0.5</summary>
        float MergedPower(Damageable e, float dealt) =>
            Mathf.Min(dealtPrev.TryGetValue(e, out var merged) ? merged : dealt, e.maxHealth * PowerCap);

        Proc Alloc(Kind kind, int uid)
        {
            var p = pool.Count > 0 ? pool.Pop() : new Proc();
            p.kind = kind;
            p.uid = uid;
            p.enemy = null;
            p.point = default;
            p.amount = 0;
            p.element = p.status = Element.None;
            p.elementChance = 0;
            p.critMult = 2;
            p.radius = 0;
            p.scale = 1;
            p.mult = 1;
            p.knockback = 0;
            p.depth = 0;
            p.reaction = Reaction.Thunderfire;
            p.procId = null;
            p.ring = false;
            queue.Add(p);
            return p;
        }

        void Release(Proc p)
        {
            p.enemy = null;
            pool.Push(p);
        }

        Marks MarksOf(Damageable e)
        {
            if (!marks.TryGetValue(e, out var m)) marks[e] = m = new Marks();
            return m;
        }

        /// <summary>清掉已销毁敌人的标记</summary>
        void PruneMarks()
        {
            foreach (var k in marks.Keys)
                if (!k) stale.Add(k);
            foreach (var k in stale) marks.Remove(k);
            stale.Clear();
        }

        // ───────────── 判定工具 ─────────────

        /// <summary>
        /// 武器伤害：带 weaponUid 的武器直接命中 / 近战斩击 / 武器投射物的爆炸（来源 Weapon 或 Melee；兼容旧约定「来源 Explosion + Weapon 标签」），
        /// 不含反应伤害与持续伤害（它们的来源是 Status）。同 TS weaponUidOf
        /// </summary>
        public static bool IsWeaponHit(in DamageInfo i) =>
            i.weaponUid != 0 && !DamageCalc.IsReaction(i) &&
            (i.source == DamageSource.Weapon || i.source == DamageSource.Melee || (i.source == DamageSource.Explosion && i.Has(DamageTag.Weapon)));

        /// <summary>斩击（碎刃）：副元素 / 万象几率乘 meleeHitScale 归一化，弹射不按弹体数折算</summary>
        public static bool IsSlash(in DamageInfo i) => i.source == DamageSource.Melee || i.Has(DamageTag.Melee);

        /// <summary>爆头：命中弱点，或被改判为弱点</summary>
        public static bool IsWeak(in DamageInfo i) => i.weakpoint || i.forcedWeakpoint;

        /// <summary>这一击之后敌人仍存活</summary>
        public static bool Live(in HitEvent e) => !e.result.killed && e.enemy && !e.enemy.Dead;

        /// <summary>副元素每次命中几率：k = 1（普通命中）原样；斩击乘归一化系数并封顶</summary>
        public static float SubChance(float v, float k) => k == 1 ? v : Mathf.Min(PerHitCap, v * k);

        /// <summary>敌人身上的状态：有派发器时问它的环境（测试可替换），否则按游戏读</summary>
        public static StatusMask StatusesOf(in AffixHook h, Damageable e) => h.effects != null ? h.effects.Env.Statuses(e) : GameAffixEnv.StatusesOf(e);

        /// <summary>元素状态（灼烧 / 雷殛 / 蚀化）</summary>
        public const StatusMask ElementMask = StatusMask.Burn | StatusMask.Shock | StatusMask.Corrode;

        /// <summary>元素 → 它附着的状态位；None 为 0</summary>
        public static StatusMask MaskOf(Element e) => e switch
        {
            Element.Fire => StatusMask.Burn,
            Element.Shock => StatusMask.Shock,
            Element.Corrode => StatusMask.Corrode,
            _ => StatusMask.None,
        };

        /// <summary>身上元素状态的种数（0–3）</summary>
        public static int CountElements(StatusMask m) =>
            ((m & StatusMask.Burn) != 0 ? 1 : 0) + ((m & StatusMask.Shock) != 0 ? 1 : 0) + ((m & StatusMask.Corrode) != 0 ? 1 : 0);

        /// <summary>身上有除 e 以外的元素状态</summary>
        public static bool HasOtherElement(StatusMask m, Element e) => (m & ElementMask & ~MaskOf(e)) != 0;

        /// <summary>身上状态对应的反应：三种齐聚 → 归墟；否则 焚雷 &gt; 熔金 &gt; 封脉；不足两种 → null</summary>
        public static Reaction? ReactionOf(StatusMask m)
        {
            bool b = (m & StatusMask.Burn) != 0, k = (m & StatusMask.Shock) != 0, c = (m & StatusMask.Corrode) != 0;
            if (b && k && c) return Reaction.Abyss;
            if (b && k) return Reaction.Thunderfire;
            if (b && c) return Reaction.Meltdown;
            if (k && c) return Reaction.Veinseal;
            return null;
        }

        /// <summary>爆炸 / 弹射曳光的颜色：无元素橙色（#ffa040），否则元素色</summary>
        public static Color BlastColor(Element e) => e == Element.None ? new Color(1f, 0xa0 / 255f, 0x40 / 255f) : DamageTable.ElementColor(e);

        /// <summary>第 i 条是不是该 id 在这把枪上第一次出现（同 id 只派发一次，值取合计）</summary>
        public static bool FirstOf(IReadOnlyList<WeaponAffix> list, int i)
        {
            var id = list[i].id;
            if (string.IsNullOrEmpty(id)) return false;
            for (int j = 0; j < i; j++)
                if (list[j].id == id) return false;
            return true;
        }

        /// <summary>派发给效果的值：传说特性取解析器记下的特性数值，其余取同 id 词条之和</summary>
        public static float ValueOf(WeaponInstance w, ResolvedWeapon r, string id)
        {
            if (r.legendary == id) return r.legendaryValue;
            return AffixIds.IsLegendary(id) ? w.AffixTotal(id) : r.Total(id);
        }
    }
}
