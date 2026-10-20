using System;
using System.Collections.Generic;
using Spiritfire.Art;
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
        /// <summary>对玩家的伤害（0 = 不伤玩家），按到玩家胶囊表面的距离同样衰减到 falloff，并把玩家掀开（<see cref="Combat.BlastPlayer"/>）</summary>
        public float playerDamage;
        /// <summary>对玩家伤害的出手者（受伤修饰器、PlayerHit 事件里的 source；可为 null）</summary>
        public UnityEngine.Object source;
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
            source = null;
            noEnemies = noFx = flatKnockback = false;
            excludeOne = null;
            exclude = null;
            hitList = null;
            color = null;
        }
    }

    /// <summary>
    /// 伤害结算（Three.js 版 src/combat/Combat.ts 的 damageEnemy / damagePlayer）：
    ///   不可选中（出生、遁地、首领登场）：完全不结算；直接命中弹「免疫」（同一敌人 0.4 s 最多一次），持续伤害跳伤与处决不弹
    ///   暴击 = 强制暴击 ∨ 命中弱点 ∨ (可随机暴击 ∧ 掷骰 &lt; 暴击率)（持续伤害、反应不暴击；弱点必暴）
    ///   倍率 = 属性乘区（按标签：<see cref="DamageCalc.StatMultiplier(StatSheet, in DamageInfo, Damageable)"/>）× 雷殛标记
    ///          × 输出修饰器（<see cref="Outgoing"/>，在暴击掷骰之后求值）× 暴击（critMult × (1 + 暴伤%)）× 弱点加成
    ///   然后交给目标按护盾 / 护甲 / 生命分层结算。
    /// 元素：带元素的命中按概率附着状态，附着前先判定元素反应（<see cref="ReactionSystem"/>）。持续伤害每一跳同样吃元素 / 精英 / 首领加成，
    ///   附着时已从状态强度里除掉（<see cref="DamageCalc.StatusPowerFromDealt"/>），同一份加成只算一次。
    /// 吸血：武器直接伤害（含武器投射物的爆炸）按实际伤害 × 吸血回血，单次上限最大生命 5%（至少 2 点）。
    /// 击杀：<see cref="KillResolver"/> 结算魂晶与精英死亡震屏，再派发击杀事件；灵石掉落仍由 LootDirector 订阅击杀事件处理。
    /// 处决（基础伤害 ≥ 1e6 或带 Purge）：不弹伤害数字、不出命中音（旧事件 EnemyDamaged 不转发）；
    ///   静默处决（Purge）另外不算玩家战果——不附着、不吸血、不破盾事件、不给魂晶，旧事件 EnemyKilled 也不转发（不掉落、不计击杀）。
    /// 结果以事件广播（<see cref="GameEvents"/>，总是带完整请求，新监听者按标签过滤；这里的旧事件按上面的规则转发）。
    /// 事件顺序：（破盾 / 破甲）→ 元素附着与反应判定 → EnemyDamaged → 吸血 → 击杀结算 → EnemyKilled。监听者互相隔离，抛异常不会打断结算。
    /// </summary>
    public static class Combat
    {
        public static StatSheet playerStats;

        /// <summary>单次吸血上限：玩家最大生命的 5%（至少 2 点）</summary>
        public const float LifestealCapRatio = 0.05f, LifestealCapMin = 2f;
        /// <summary>同一敌人两次「免疫」提示的最短间隔</summary>
        public const float ImmuneFeedbackGap = 0.4f;

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
            immuneAt.Clear();
        }

        struct OutgoingCall : IModifierCall<Outgoing>
        {
            public HitContext c;
            public float Invoke(Outgoing fn, float current) => fn(in c);
        }

        public static DamageResult DamageEnemy(Damageable target, DamageInfo info, float extraMult = 1f)
        {
            if (!target || target.Dead) return default;
            if (target.untargetable) return Immune(target, info);
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
            bool execute = DamageCalc.IsExecute(info);
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
                // 旧事件的监听者（伤害数字、命中音、灵宠记仇、冒烟统计）不认标签：处决不转发，首领倒下时残余爪牙不会一齐冒数字、刷音效
                if (!execute) enemyDamaged.Raise(target, info, r);
            }
            if (!purge && r.total > 0)
                try
                {
                    Lifesteal(in info, r.total);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            if (r.killed)
            {
                var kill = new KillEvent { enemy = target, info = info, result = r };
                KillResolver.Resolve(in kill);
                GameEvents.RaiseEnemyKilled(in kill);
                // 静默处决不算玩家战果：旧监听者（掉落、击杀回复、击杀计数、灵宠）不认标签，干脆不转发
                if (!purge) enemyKilled.Raise(target, info);
            }
            return r;
        }

        // 同一敌人上一次弹「免疫」的时间（节流）；敌人销毁后的残留键在表变大时清掉
        static readonly Dictionary<Damageable, float> immuneAt = new();
        static readonly List<Damageable> immuneStale = new();

        /// <summary>
        /// 不可选中的敌人挨打：不结算（不掷暴击、不跑修饰器、不附着、不吸血）。直接命中给「免疫」反馈——同一敌人 0.4 s 最多一次，
        /// 只有放行的这一次才派发 EnemyDamaged（result.immune）；持续伤害跳伤、处决、0 伤害不提示。同 Three.js damageEnemy 第 0 步。
        /// </summary>
        static DamageResult Immune(Damageable target, in DamageInfo info)
        {
            var r = new DamageResult { immune = true, layer = DamageLayer.Health, firstLayer = DamageLayer.Health };
            if (!(info.amount > 0) || DamageCalc.IsDot(info) || DamageCalc.IsExecute(info)) return r;
            float now = Time.time;
            if (immuneAt.TryGetValue(target, out var last) && now - last < ImmuneFeedbackGap && now >= last) return r;
            if (immuneAt.Count > 64)
            {
                foreach (var k in immuneAt.Keys)
                    if (!k) immuneStale.Add(k);
                foreach (var k in immuneStale) immuneAt.Remove(k);
                immuneStale.Clear();
            }
            immuneAt[target] = now;
            var hit = new HitEvent { enemy = target, info = info, result = r };
            GameEvents.RaiseEnemyDamaged(in hit);
            enemyDamaged.Raise(target, info, r);
            return r;
        }

        /// <summary>
        /// 吸血（Three.js afterHit 第 7 步）：只对武器直接伤害（来源 Weapon、深度 0，含武器投射物的爆炸），按实际伤害回血。
        /// 静默处决不吸（调用方已过滤）。
        /// </summary>
        static void Lifesteal(in DamageInfo info, float dealt)
        {
            if (info.source != DamageSource.Weapon || info.depth != 0) return;
            var s = playerStats;
            var p = PlayerVitals.Instance;
            if (s == null || !p || p.Dead) return;
            float heal = LifestealHeal(dealt, s.Get(Stat.Lifesteal), p.MaxHealth);
            if (heal > 0) p.Heal(heal);
        }

        /// <summary>一次吸血回多少：实际伤害 × 吸血，单次上限 max(2, 最大生命 × 5%)；吸血 ≤ 0 为 0</summary>
        public static float LifestealHeal(float dealt, float lifesteal, float maxHp)
        {
            if (!(lifesteal > 0) || !(dealt > 0)) return 0;
            float heal = Mathf.Min(dealt * lifesteal, Mathf.Max(LifestealCapMin, maxHp * LifestealCapRatio));
            return float.IsInfinity(heal) ? 0 : heal;
        }

        static bool AttachHit(Damageable target, Element element, float dealt, in DamageInfo info, bool killed, out Reaction? rx)
        {
            float pin = Mathf.Min(dealt, target.maxHealth * 0.5f);
            return Attach(target, element, pin, pin / DamageCalc.DotStatMultiplier(target, element), info.depth, killed, info.instigator, info.weaponUid, out rx);
        }

        /// <summary>
        /// 附着元素：先判定反应（要看附着前身上有什么），再挂状态。pin = 反应强度（含属性加成），power = 状态强度（不含元素 / 精英 / 首领加成）。
        /// 不可选中的敌人既不反应也不附着。返回状态是否挂上（击杀那一击只做雷殛弹射）；rx = 引发的反应
        /// </summary>
        static bool Attach(Damageable target, Element element, float pin, float power, int depth, bool killed, UnityEngine.Object by, int weaponUid,
            out Reaction? rx)
        {
            if (target.untargetable)
            {
                rx = null;
                return false;
            }
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

        /// <summary>引爆敌人身上的元素状态（<see cref="ReactionSystem.Detonate"/>）：死亡 / 不可选中的敌人直接返回 null（同 Three.js Combat.detonate）</summary>
        public static DetonateOutcome? Detonate(Damageable target, in DetonateOpts opts) =>
            !target || target.Dead || target.untargetable ? null : ReactionSystem.Detonate(target, opts);

        /// <summary>强制引发一次反应（<see cref="ReactionSystem.Trigger"/>）：不可选中的敌人直接返回 null；已死的交给反应系统判断（要给反应中心）</summary>
        public static Reaction? TriggerReaction(Damageable target, Reaction id, in TriggerOpts opts) =>
            !target || target.untargetable ? null : ReactionSystem.Trigger(target, id, opts);

        /// <summary>
        /// 按与玩家眼睛的距离震屏（Three.js Blast.explosionShake）：radius × 3 + 8 米外没有，强度 (0.1 + 0.055 × 半径) × k² × scale（≤ 0.75），
        /// 时长 0.2 + min(0.3, 0.03 × 半径)。精英死亡（半径 2、×0.8）用它；爆炸特效单元的大爆炸也可以用。
        /// </summary>
        public static void ExplosionShake(Vector3 center, float radius, float scale = 1f)
        {
            var p = PlayerVitals.Instance;
            if (!p || !(radius >= 0)) return;
            var motor = p.GetComponent<PlayerMotor>();
            var eye = motor && motor.eye ? motor.eye.position : p.transform.position + Vector3.up * 1.62f;
            float k = Mathf.Clamp01(1 - Vector3.Distance(eye, center) / (radius * 3 + 8));
            if (k <= 0) return;
            float intensity = Mathf.Min(0.75f, (0.1f + radius * 0.055f) * k * k * scale);
            if (intensity < 0.01f) return;
            CameraShake.Add(intensity, 0.2f + Mathf.Min(0.3f, radius * 0.03f));
        }

        /// <summary>
        /// 处决：一击打死（不暴击、不附着元素，按处决处理：不弹伤害数字、不出命中音）。purge = 静默处决（清场）：带 <see cref="DamageTag.Purge"/>，
        /// 不算玩家战果——不给魂晶、不吸血，旧的 EnemyKilled 不转发（不掉落、不计击杀、不触发击杀回复）；GameEvents 照常带标签派发。
        /// 伤害被免疫（不可选中、修饰器返回 0）而没死的直接走死亡流程（同 Three.js forceKill：不派发击杀事件、没有战果）。
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
        /// 击退不衰减。playerDamage &gt; 0 时同样衰减地伤害玩家并把玩家掀开（<see cref="BlastPlayer"/>）。新代码用 <see cref="Explode(in ExplosionOptions)"/>。
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
        /// 不可选中的敌人不吃爆炸、也不弹「免疫」。playerDamage &gt; 0 时经 <see cref="BlastPlayer"/> 波及玩家（胶囊表面距离、两点视线、冲击、无敌帧跳过）。
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
                        // 不可选中的敌人不吃爆炸，也不刷「免疫」提示（同 Three.js explodeAt）
                        if (!d || d.Dead || d.untargetable || d == o.excludeOne || (o.exclude != null && o.exclude.Contains(d)) || !seen.Add(d)) continue;
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
            if (o.playerDamage > 0) BlastPlayer(center, radius, o.playerDamage, o.falloff, o.info.element, o.source);
            return hits;
        }

        /// <summary>
        /// 爆炸波及玩家（Three.js 版 Blast.blastPlayer）：伤害按爆心到玩家胶囊（脚底到头顶）表面的距离线性衰减到边缘 falloff；
        /// 胸口与眼睛两点都被墙挡住时不受伤；冲刺无敌帧 / 无敌期间整个爆炸都不影响玩家（不扣血也不被掀飞——冲刺穿过爆炸是合法的闪避）。
        /// 命中时附带一个冲击：水平向外 6.5 × k、向上 3.2 × k m/s（k = 衰减系数）。返回实际扣除量。
        /// 敌人的自爆、敌方炮弹、首领的范围招式都走这里（<see cref="ExplosionOptions.playerDamage"/> 自动转来）。
        /// </summary>
        public static float BlastPlayer(Vector3 center, float radius, float damage, float falloff = 0.5f, Element element = Element.None,
            UnityEngine.Object source = null)
        {
            var p = PlayerVitals.Instance;
            if (!p || p.Dead || !(damage > 0) || !(radius > 0) || float.IsInfinity(radius) || float.IsNaN(center.x + center.y + center.z)) return 0;
            var pos = p.transform.position;
            var cc = p.GetComponent<CharacterController>();
            float r = cc ? cc.radius : 0.35f, h = cc ? cc.height : 1.8f;
            float feet = cc ? pos.y + cc.center.y - h * 0.5f : pos.y;
            // 胶囊轴线上离爆心最近的点
            var axis = new Vector3(pos.x, Mathf.Clamp(center.y, feet + r, feet + Mathf.Max(r, h - r)), pos.z);
            float surf = Mathf.Max(0, Vector3.Distance(axis, center) - r);
            if (surf > radius) return 0;
            var motor = p.GetComponent<PlayerMotor>();
            var chest = new Vector3(pos.x, feet + h * 0.55f, pos.z);
            var eye = motor && motor.eye ? motor.eye.position : new Vector3(pos.x, feet + h * 0.9f, pos.z);
            if (!LineClear(chest, center) && !LineClear(eye, center)) return 0;
            if (p.Invulnerable) return 0;
            float k = 1 - (1 - Mathf.Clamp01(falloff)) * Mathf.Clamp01(surf / radius);
            // 冲击方向先算好：DamagePlayer 会同步派发受伤事件，监听者可能重入
            var dir = new Vector3(axis.x - center.x, 0, axis.z - center.z);
            float flat = dir.magnitude;
            dir = flat > 1e-3f ? dir / flat : Vector3.zero;
            float dealt = DamagePlayer(damage * k, center, element, source);
            if (!p.Dead && motor) motor.AddImpulse(new Vector3(dir.x * 6.5f * k, 3.2f * k, dir.z * 6.5f * k));
            return dealt;
        }

        /// <summary>
        /// from → to 之间没有地形 / 建筑遮挡（Three.js lineClear）：射线在 to 前 margin 米停下，to 贴在墙面 / 地面上（爆炸点常见情况）也不算被挡。
        /// </summary>
        public static bool LineClear(Vector3 from, Vector3 to, float margin = 0.15f)
        {
            var d = to - from;
            float len = d.magnitude;
            if (len <= margin + 0.05f) return true;
            return !Blocked(from, from + d * ((len - margin) / len), null);
        }

        static RaycastHit[] rayBuf = new RaycastHit[16];

        /// <summary>两点之间被地形 / 建筑挡住（忽略角色层与目标自身；命中盒不挡，除非它标了 <see cref="Hitbox.blocksSight"/>，如冰壁）</summary>
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
                if (c == target) continue;
                var hb = c.GetComponent<Hitbox>();
                if (!hb || hb.blocksSight) return true;
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
