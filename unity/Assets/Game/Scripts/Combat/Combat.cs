using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>输出修饰器看到的这一击：暴击已经掷过（crit），weak = 命中弱点或被改判为弱点</summary>
    public struct HitContext
    {
        public Damageable target;
        public DamageInfo info;
        public bool crit, weak;
    }

    /// <summary>输出修饰器（英雄被动「余烬」、灵宠的易伤标记…）：返回倍率（1 = 不变）</summary>
    public delegate float Outgoing(in HitContext c);

    /// <summary>
    /// 范围爆炸的参数（<see cref="Combat.Explode(in ExplosionOptions)"/>）。用构造函数建：falloff 默认 0.5（同 Three.js）。
    /// </summary>
    public struct ExplosionOptions
    {
        public Vector3 center;
        public float radius;
        /// <summary>每个敌人收到的请求模板：伤害按距离衰减、point / direction 改成各自的，并加上 Explosion 标签</summary>
        public DamageInfo info;
        /// <summary>边缘伤害比例：中心 100% → 范围边缘 falloff（按到碰撞体表面的距离线性插值）</summary>
        public float falloff;
        /// <summary>对玩家的伤害（0 = 不伤玩家），同样按距离衰减到 falloff</summary>
        public float playerDamage;
        /// <summary>不伤敌人（敌人的自爆、敌方炮弹）</summary>
        public bool noEnemies;
        /// <summary>不播爆炸特效与爆炸声</summary>
        public bool noFx;
        /// <summary>击退不随距离衰减（旧接口的行为）；默认按伤害同样的比例衰减</summary>
        public bool flatKnockback;
        /// <summary>不受这次爆炸伤害的单位（反应的中心敌人已经吃过中心伤害）</summary>
        public Damageable excludeOne;
        public ICollection<Damageable> exclude;
        /// <summary>收集被炸到（造成了伤害）的敌人：画雷弧、计数</summary>
        public List<Damageable> hitList;
        /// <summary>爆炸特效颜色（null = 按元素取色）；特效单元接入前不使用</summary>
        public Color? color;

        public ExplosionOptions(Vector3 center, float radius, DamageInfo info)
        {
            this.center = center;
            this.radius = radius;
            this.info = info;
            falloff = 0.5f;
            playerDamage = 0;
            noEnemies = noFx = flatKnockback = false;
            excludeOne = null;
            exclude = null;
            hitList = null;
            color = null;
        }
    }

    /// <summary>
    /// 伤害结算（Three.js 版 src/combat/Combat.ts 的 damageEnemy / damagePlayer）：
    ///   暴击 = 强制暴击 ∨ 命中弱点 ∨ (可随机暴击 ∧ 掷骰 &lt; 暴击率)（持续伤害、反应不暴击；弱点必暴）
    ///   倍率 = 属性乘区（按标签：<see cref="DamageCalc.StatMultiplier(StatSheet, in DamageInfo, Damageable)"/>）× 雷殛标记
    ///          × 输出修饰器（<see cref="Outgoing"/>，在暴击掷骰之后求值）× 暴击（critMult × (1 + 暴伤%)）× 弱点加成
    ///   然后交给目标按护盾 / 护甲 / 生命分层结算。
    /// 元素：带元素的命中按概率附着状态，附着前先判定元素反应（<see cref="ReactionSystem"/>）。
    /// 结果以事件广播（<see cref="GameEvents"/>；这里的旧事件照常转发）：伤害数字、命中标记、击杀掉落都订阅事件，不互相引用。
    /// 事件顺序：（破盾 / 破甲）→ 元素附着与反应判定 → EnemyDamaged → EnemyKilled。监听者互相隔离，抛异常不会打断结算。
    /// </summary>
    public static class Combat
    {
        public static StatSheet playerStats;

        /// <summary>输出修饰器：Add 返回句柄，Dispose 即撤销。在暴击掷骰之后求值（c.crit 可用）</summary>
        public static readonly ModifierList<Outgoing> Outgoing = new();

        /// <summary>旧接口（Func 返回倍率）：Add / Remove 照旧可用，内部转登记到 <see cref="Outgoing"/></summary>
        public static readonly LegacyOutgoingModifiers OutgoingModifiers = new();

        /// <summary>把玩家的直接命中（武器 / 技能 / 爆炸）改判为弱点（神兽白泽「万鬼图」）：任一返回 true 即算弱点</summary>
        public static readonly List<Func<Damageable, DamageInfo, bool>> ForceWeakpoint = new();

        static readonly EventChannel<Action<Damageable, DamageInfo, DamageResult>> enemyDamaged = new();
        static readonly EventChannel<Action<Damageable, DamageInfo>> enemyKilled = new();
        static readonly EventChannel<Action<float, Vector3>> playerDamaged = new();

        /// <summary>旧事件（转发，第 4 批删除）：新代码订阅 <see cref="GameEvents.EnemyDamaged"/></summary>
        public static event Action<Damageable, DamageInfo, DamageResult> EnemyDamaged { add => enemyDamaged.Add(value); remove => enemyDamaged.Remove(value); }
        /// <summary>旧事件（转发，第 4 批删除）：新代码订阅 <see cref="GameEvents.EnemyKilled"/></summary>
        public static event Action<Damageable, DamageInfo> EnemyKilled { add => enemyKilled.Add(value); remove => enemyKilled.Remove(value); }
        /// <summary>玩家受到伤害（数值已扣减，死亡判定之后才发）：来源位置用于受击方向指示。新代码订阅 <see cref="GameEvents.PlayerHit"/></summary>
        public static event Action<float, Vector3> PlayerDamaged { add => playerDamaged.Add(value); remove => playerDamaged.Remove(value); }

        /// <summary>爆炸嵌套上限：超过这一层的爆炸不再伤敌人（只出声、伤玩家），再深一倍直接忽略（连锁自爆不爆栈）</summary>
        public const int MaxExplodeDepth = 6;

        static int explodeDepth;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Outgoing.Clear();
            OutgoingModifiers.Clear();
            enemyDamaged.Clear();
            enemyKilled.Clear();
            playerDamaged.Clear();
            explodeDepth = 0;
        }

        struct OutgoingCall : IModifierCall<Outgoing>
        {
            public HitContext c;
            public float Invoke(Outgoing fn, float current) => fn(in c);
        }

        public static DamageResult DamageEnemy(Damageable target, DamageInfo info, float extraMult = 1f)
        {
            if (!target || target.Dead) return default;
            var stats = playerStats;
            bool reaction = DamageCalc.IsReaction(info);
            if (!info.weakpoint && !reaction && ForceWeakpoint.Count > 0 &&
                info.source is DamageSource.Weapon or DamageSource.Skill or DamageSource.Explosion)
                for (int i = 0; i < ForceWeakpoint.Count; i++)
                {
                    bool yes;
                    try
                    {
                        yes = ForceWeakpoint[i](target, info);
                    }
                    catch (Exception e)
                    {
                        Debug.LogException(e);
                        continue;
                    }
                    if (yes)
                    {
                        info.forcedWeakpoint = true;
                        break;
                    }
                }
            if (info.source == DamageSource.Status && !info.instigator) info.instigator = target.lastElementBy;
            bool weak = info.weakpoint || info.forcedWeakpoint;
            // 灵宠不随机暴击（狰、白泽自己决定 forceCrit）；noCrit 只关掉随机暴击
            bool crit = !reaction && info.source != DamageSource.Status &&
                        (info.forceCrit || weak ||
                         (!info.noCrit && info.source != DamageSource.Pet && UnityEngine.Random.value < (stats?.Get(Stat.CritChance) ?? 0.05f)));
            // 反应伤害只吃「反应伤害」加成：附着强度来自那一击的实际伤害，已经含了其他加成
            float mult = extraMult * DamageCalc.StatMultiplier(stats, info, target);
            if (info.element == Element.Shock && EnemyStatus.Has(target, Element.Shock)) mult *= EnemyStatus.ShockMarkBonus;
            if (Outgoing.Count > 0)
            {
                var call = new OutgoingCall { c = new HitContext { target = target, info = info, crit = crit, weak = weak } };
                mult = Outgoing.Apply(mult, ref call);
            }
            if (crit) mult *= (info.critMult > 0 ? info.critMult : 2f) * (stats?.Mult(Stat.CritDamagePct) ?? 1f);
            if (weak) mult *= stats?.Mult(Stat.WeakpointDamagePct) ?? 1f;
            var r = target.ApplyLayers(info, info.amount * mult, crit);
            bool purge = info.Has(DamageTag.Purge);
            // 破盾 / 破甲事件不带请求，监听者认不出静默处决，所以 purge 时不发（result 上的标记照常保留）
            if (r.shieldBroken && !purge) GameEvents.RaiseEnemyShieldBroken(target);
            if (r.armorBroken && !purge) GameEvents.RaiseEnemyArmorBroken(target);
            // 元素附着（持续伤害、反应伤害、静默处决不再附着）：反应强度 = 这一击的实际伤害（上限最大生命一半），
            // 状态强度再除掉每一跳会乘回的属性倍率；击杀那一击也判定两两反应。
            // 附着出错也不能打断后面的事件（掉落、击杀计数）
            bool attach = !reaction && info.source != DamageSource.Status && !purge && r.total > 0;
            try
            {
                if (attach && info.element != Element.None)
                {
                    float chance = info.statusChance + (stats?.Get(Stat.ElementChancePct) ?? 0);
                    if (chance > 0 && UnityEngine.Random.value < chance)
                    {
                        if (AttachHit(target, info.element, r.total, info, r.killed, out var rx)) r.statusApplied = info.element;
                        r.reaction = rx;
                    }
                }
                if (attach && info.subElement != Element.None && info.subChance > 0 && UnityEngine.Random.value < info.subChance)
                {
                    if (AttachHit(target, info.subElement, r.total, info, r.killed, out var rx) && r.statusApplied == Element.None)
                        r.statusApplied = info.subElement;
                    r.reaction ??= rx;
                }
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
            if (r.total > 0 || r.immune || r.blocked)
            {
                var hit = new HitEvent { enemy = target, info = info, result = r };
                GameEvents.RaiseEnemyDamaged(in hit);
                enemyDamaged.Raise(target, info, r);
            }
            if (r.killed)
            {
                var kill = new KillEvent { enemy = target, info = info, result = r };
                GameEvents.RaiseEnemyKilled(in kill);
                enemyKilled.Raise(target, info);
            }
            return r;
        }

        static bool AttachHit(Damageable target, Element element, float dealt, in DamageInfo info, bool killed, out Reaction? rx)
        {
            float pin = Mathf.Min(dealt, target.maxHealth * 0.5f);
            return Attach(target, element, pin, pin / DamageCalc.DotStatMultiplier(target, element), info.depth, killed, info.instigator, info.weaponUid, out rx);
        }

        /// <summary>
        /// 附着元素：先判定反应（要看附着前身上有什么），再挂状态。pin = 反应强度（含属性加成），power = 状态强度（不含元素 / 精英 / 首领加成）。
        /// 返回状态是否挂上（击杀那一击只做雷殛弹射）；rx = 引发的反应
        /// </summary>
        static bool Attach(Damageable target, Element element, float pin, float power, int depth, bool killed, UnityEngine.Object by, int weaponUid,
            out Reaction? rx)
        {
            target.lastElementBy = by;
            rx = ReactionSystem.TryReact(target, element, pin, depth, killed, weaponUid);
            return EnemyStatus.Apply(target, element, power, depth, killed);
        }

        /// <summary>反应扩散出去的元素（焚雷点燃周围、熔池附蚀、封脉导流）：深度由调用方 +1，可以再引发最多一级反应</summary>
        public static void AttachFromReaction(Damageable target, Element element, float power, int depth, int weaponUid = 0)
        {
            if (!target || target.Dead || target.untargetable || power <= 0) return;
            float pin = Mathf.Min(power, target.maxHealth * 0.5f);
            Attach(target, element, pin, pin / DamageCalc.DotStatMultiplier(target, element), depth, false, target.lastElementBy, weaponUid, out _);
        }

        /// <summary>技能 / 秘卷直接挂元素（不经过伤害），同样判定反应。power = 状态强度（不含属性加成），反应强度按它乘回</summary>
        public static void ApplyElement(Damageable target, Element element, float power, int depth = 0, UnityEngine.Object instigator = null,
            int weaponUid = 0)
        {
            if (!target || target.Dead || target.untargetable || power <= 0) return;
            float cap = target.maxHealth * 0.5f;
            float statusPower = Mathf.Min(power, cap);
            float pin = Mathf.Min(DamageCalc.ReactionPowerFromStatus(target, element, statusPower), cap);
            Attach(target, element, pin, statusPower, depth, false, instigator, weaponUid, out _);
        }

        /// <summary>
        /// 处决：一击打死（不暴击、不附着元素，按处决处理）。purge = 静默处决（清场）：带 <see cref="DamageTag.Purge"/>，
        /// 不算玩家战果（掉落 / 击杀时效果由监听者按标签过滤）。伤害被免疫（不可选中、修饰器返回 0）而没死的直接走死亡流程
        /// （同 Three.js forceKill：不派发击杀事件）。
        /// </summary>
        public static DamageResult Execute(Damageable d, bool purge)
        {
            if (!d || d.Dead) return default;
            var info = DamageInfo.Simple(DamageCalc.ExecuteBase, DamageSource.Status, ReactionSystem.CenterOf(d), Vector3.up);
            info.noCrit = true;
            info.depth = 2;
            if (purge) info.tags = DamageTag.Purge;
            var r = DamageEnemy(d, info);
            if (!d.Dead)
            {
                d.Kill(info);
                r.killed = true;
            }
            return r;
        }

        /// <summary>敌人打玩家：交给 <see cref="PlayerVitals"/>（无敌帧、减伤、受伤修饰器在那边处理）；source = 出手者（敌人 AI 等，可为 null）</summary>
        public static float DamagePlayer(float amount, Vector3 from, Element element = Element.None, UnityEngine.Object source = null)
        {
            var p = PlayerVitals.Instance;
            if (!p) return 0;
            float dealt = p.TakeDamage(amount, from, element, source);
            if (dealt > 0) playerDamaged.Raise(dealt, from);
            return dealt;
        }

        /// <summary>
        /// 范围爆炸（旧接口）：球形范围内的敌人按到碰撞体表面的距离线性衰减（中心 100% → 边缘 edge，默认 30%），墙后不受伤；
        /// 击退不衰减。hurtPlayer 时同样衰减地伤害玩家。新代码用 <see cref="Explode(in ExplosionOptions)"/>。
        /// </summary>
        /// <param name="exclude">不受这次爆炸伤害的单位（反应的中心敌人已经吃过中心伤害）</param>
        /// <param name="edge">边缘伤害比例（默认 30%；反应余波 60%）</param>
        /// <param name="hitList">收集被炸到的敌人（画雷弧、计数）</param>
        public static void Explode(Vector3 center, float radius, DamageInfo info, bool hurtEnemies = true, float playerDamage = 0,
            Damageable exclude = null, float edge = 0.3f, List<Damageable> hitList = null)
        {
            var o = new ExplosionOptions(center, radius, info)
            {
                noEnemies = !hurtEnemies, playerDamage = playerDamage, excludeOne = exclude, falloff = edge, hitList = hitList, flatKnockback = true,
            };
            Explode(in o);
        }

        /// <summary>
        /// 范围爆炸：球形范围内的敌人按到碰撞体表面的距离线性衰减（中心 100% → 边缘 falloff），墙后不受伤；击退同样衰减（flatKnockback 除外）。
        /// 每个敌人收到的请求都加上 <see cref="DamageTag.Explosion"/>（吃「爆炸伤害」；武器投射物的爆炸同时吃「武器伤害」），来源 / 武器 / 深度照旧。
        /// 嵌套（爆炸炸死的敌人又爆炸…）超过 <see cref="MaxExplodeDepth"/> 层不再伤敌人。返回造成了伤害的敌人数。
        /// </summary>
        public static int Explode(in ExplosionOptions o)
        {
            if (!(o.radius > 0) || float.IsInfinity(o.radius)) return 0;
            if (explodeDepth >= MaxExplodeDepth * 2) return 0;
            int depth = explodeDepth++;
            try
            {
                return ExplodeAt(depth, o);
            }
            finally
            {
                explodeDepth = Mathf.Max(0, explodeDepth - 1);
            }
        }

        // 按嵌套深度分配的复用缓冲：查询结果与去重集合（嵌套的爆炸用更深一层的，不会互相覆盖）
        static readonly Collider[][] overlapBufs = new Collider[MaxExplodeDepth][];
        static readonly HashSet<Damageable>[] seenSets = new HashSet<Damageable>[MaxExplodeDepth];

        static int ExplodeAt(int depth, in ExplosionOptions o)
        {
            var center = o.center;
            float radius = o.radius;
            // 爆炸声：半径越大越响、越沉（同 Three.js Combat.explode）
            if (!o.noFx) GameAudio.PlayAt("explosion", center, Mathf.Clamp(0.5f + radius * 0.09f, 0.5f, 1f), Mathf.Clamp(1.25f - radius * 0.06f, 0.75f, 1.2f));
            int hits = 0;
            if (!o.noEnemies && depth < MaxExplodeDepth)
            {
                var buf = overlapBufs[depth] ??= new Collider[64];
                int n;
                while ((n = Physics.OverlapSphereNonAlloc(center, radius, buf, ~0, QueryTriggerInteraction.Ignore)) >= buf.Length)
                    buf = overlapBufs[depth] = new Collider[buf.Length * 2];
                var seen = seenSets[depth] ??= new HashSet<Damageable>();
                var info = o.info;
                info.tags |= DamageTag.Explosion;
                info.weakpoint = false;
                try
                {
                    for (int i = 0; i < n; i++)
                    {
                        var c = buf[i];
                        if (!c) continue;
                        var hb = c.GetComponent<Hitbox>();
                        var d = hb ? hb.owner : c.GetComponentInParent<Damageable>();
                        if (!d || d.Dead || d == o.excludeOne || (o.exclude != null && o.exclude.Contains(d)) || !seen.Add(d)) continue;
                        var closest = c.ClosestPoint(center);
                        if (Blocked(center, closest, c)) continue;
                        float k = Mathf.Lerp(1f, o.falloff, Mathf.Clamp01(Vector3.Distance(center, closest) / radius));
                        var hit = info;
                        hit.amount = info.amount * k;
                        hit.point = closest;
                        hit.direction = (closest - center).normalized;
                        if (!o.flatKnockback) hit.knockback = info.knockback * k;
                        var res = DamageEnemy(d, hit);
                        if (res.total > 0)
                        {
                            hits++;
                            o.hitList?.Add(d);
                        }
                    }
                }
                finally
                {
                    seen.Clear();
                    Array.Clear(buf, 0, n);
                }
            }
            if (o.playerDamage > 0 && PlayerVitals.Instance)
            {
                var p = PlayerVitals.Instance.transform.position + Vector3.up * 0.9f;
                float dist = Vector3.Distance(center, p) - 0.35f;
                if (dist < radius && !Blocked(center, p, null))
                    DamagePlayer(o.playerDamage * Mathf.Lerp(1f, o.falloff, Mathf.Clamp01(dist / radius)), center, o.info.element);
            }
            return hits;
        }

        static RaycastHit[] rayBuf = new RaycastHit[16];

        /// <summary>两点之间被地形 / 建筑挡住（忽略角色层与目标自身）</summary>
        public static bool Blocked(Vector3 a, Vector3 b, Collider target)
        {
            var dir = b - a;
            float len = dir.magnitude;
            if (len < 0.05f) return false;
            int n;
            while ((n = Physics.RaycastNonAlloc(a, dir / len, rayBuf, len, Layers.WorldMask, QueryTriggerInteraction.Ignore)) >= rayBuf.Length)
                rayBuf = new RaycastHit[rayBuf.Length * 2];
            for (int i = 0; i < n; i++)
            {
                var c = rayBuf[i].collider;
                if (c != target && !c.GetComponent<Hitbox>()) return true;
            }
            return false;
        }
    }

    /// <summary>
    /// <see cref="Combat.OutgoingModifiers"/> 的兼容层：旧代码 Add(Func) / Remove(Func) 照旧，内部转登记到 <see cref="Combat.Outgoing"/>
    /// （同优先级按登记顺序求值，和原来的 List 一致）。
    /// </summary>
    public sealed class LegacyOutgoingModifiers
    {
        readonly List<(Func<Damageable, DamageInfo, float> fn, IDisposable handle)> list = new();

        public int Count => list.Count;

        public void Add(Func<Damageable, DamageInfo, float> fn)
        {
            if (fn == null) return;
            list.Add((fn, Combat.Outgoing.Add((in HitContext c) => fn(c.target, c.info))));
        }

        public bool Remove(Func<Damageable, DamageInfo, float> fn)
        {
            for (int i = 0; i < list.Count; i++)
                if (list[i].fn.Equals(fn))
                {
                    list[i].handle.Dispose();
                    list.RemoveAt(i);
                    return true;
                }
            return false;
        }

        public void Clear()
        {
            foreach (var (_, handle) in list) handle.Dispose();
            list.Clear();
        }
    }

    /// <summary>层：与 ShowcaseSceneBuilder 的 FirstPerson(6) / Character(7) 一致，Ignore Raycast(2) 是边界墙</summary>
    public static class Layers
    {
        public const int IgnoreRaycast = 2, FirstPerson = 6, Character = 7;
        /// <summary>地形与建筑（子弹、视线、地面检测用）</summary>
        public static readonly int WorldMask = ~((1 << IgnoreRaycast) | (1 << FirstPerson) | (1 << Character));
        /// <summary>子弹：世界 + 角色（敌人的碰撞体都在 Character 层）</summary>
        public static readonly int ShotMask = ~((1 << IgnoreRaycast) | (1 << FirstPerson));
    }
}
