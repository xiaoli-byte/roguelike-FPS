using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 伤害结算（Three.js 版 src/combat/Combat.ts 的 damageEnemy / damagePlayer）：
    ///   暴击 = 强制暴击 ∨ 命中弱点 ∨ 掷骰 &lt; 暴击率（持续伤害不暴击；弱点必暴）
    ///   倍率 = 来源加成（武器 → 伤害%，技能 → 技能伤害%，爆炸 → 爆炸伤害%）× 暴击（critMult × (1 + 暴伤%)）× 弱点加成
    ///   然后交给目标按护盾 / 护甲 / 生命分层结算。
    /// 元素：带元素的命中按概率附着状态，附着前先判定元素反应（<see cref="ReactionSystem"/>）。
    /// 结果以事件广播：伤害数字、命中标记、击杀掉落都订阅这里，不互相引用。
    /// </summary>
    public static class Combat
    {
        public static StatSheet playerStats;
        /// <summary>额外的增伤乘区（英雄被动「余烬」：打灼烧中的敌人 ×1.2…）：返回倍率</summary>
        public static readonly System.Collections.Generic.List<Func<Damageable, DamageInfo, float>> OutgoingModifiers = new();
        /// <summary>把玩家的直接命中（武器 / 技能 / 爆炸）改判为弱点（神兽白泽「万鬼图」）：任一返回 true 即算弱点</summary>
        public static readonly System.Collections.Generic.List<Func<Damageable, DamageInfo, bool>> ForceWeakpoint = new();
        public static event Action<Damageable, DamageInfo, DamageResult> EnemyDamaged;
        public static event Action<Damageable, DamageInfo> EnemyKilled;
        /// <summary>玩家受到伤害（数值已扣减）：来源位置用于受击方向指示</summary>
        public static event Action<float, Vector3> PlayerDamaged;

        public static DamageResult DamageEnemy(Damageable target, DamageInfo info, float extraMult = 1f)
        {
            if (!target || target.Dead) return default;
            var stats = playerStats;
            if (!info.weakpoint && !info.reaction && ForceWeakpoint.Count > 0 &&
                info.source is DamageSource.Weapon or DamageSource.Skill or DamageSource.Explosion)
                foreach (var f in ForceWeakpoint)
                    if (f(target, info)) { info.forcedWeakpoint = true; break; }
            if (info.source == DamageSource.Status && !info.instigator) info.instigator = target.lastElementBy;
            bool weak = info.weakpoint || info.forcedWeakpoint;
            // 灵宠不随机暴击（狰、白泽自己决定 forceCrit）
            bool crit = !info.reaction && info.source != DamageSource.Status &&
                        (info.forceCrit || weak ||
                         (info.source != DamageSource.Pet && UnityEngine.Random.value < (stats?.Get(Stat.CritChance) ?? 0.05f)));
            // 反应伤害只吃「反应伤害」加成：附着强度来自那一击的实际伤害，已经含了其他加成
            float mult = extraMult * (info.reaction ? stats?.Mult(Stat.ReactionDamagePct) ?? 1f : SourceMult(info.source, stats));
            if (info.element == Element.Shock && EnemyStatus.Has(target, Element.Shock)) mult *= EnemyStatus.ShockMarkBonus;
            foreach (var m in OutgoingModifiers) mult *= m(target, info);
            if (crit) mult *= (info.critMult > 0 ? info.critMult : 2f) * (stats?.Mult(Stat.CritDamagePct) ?? 1f);
            if (weak) mult *= stats?.Mult(Stat.WeakpointDamagePct) ?? 1f;
            var r = target.ApplyLayers(info, info.amount * mult, crit);
            // 元素附着（持续伤害、反应伤害不再附着）：附着强度 = 这一击的实际伤害（上限最大生命一半）；击杀那一击也判定两两反应
            if (!info.reaction && info.source != DamageSource.Status && info.element != Element.None && r.total > 0)
            {
                float chance = info.statusChance + (stats?.Get(Stat.ElementChancePct) ?? 0);
                if (chance > 0 && UnityEngine.Random.value < chance)
                    Attach(target, info.element, Mathf.Min(r.total, target.maxHealth * 0.5f), info.depth, r.killed, info.instigator);
            }
            if (!info.reaction && info.source != DamageSource.Status && info.subElement != Element.None && info.subChance > 0 && r.total > 0 &&
                UnityEngine.Random.value < info.subChance)
                Attach(target, info.subElement, Mathf.Min(r.total, target.maxHealth * 0.5f), info.depth, r.killed, info.instigator);
            if (r.total > 0 || r.immune || r.blocked) EnemyDamaged?.Invoke(target, info, r);
            if (r.killed) EnemyKilled?.Invoke(target, info);
            return r;
        }

        /// <summary>附着元素：先判定反应（要看附着前身上有什么），再挂状态</summary>
        static void Attach(Damageable target, Element element, float power, int depth, bool killed, UnityEngine.Object by)
        {
            target.lastElementBy = by;
            ReactionSystem.TryReact(target, element, power, depth, killed);
            EnemyStatus.Apply(target, element, power, depth, killed);
        }

        /// <summary>反应扩散出去的元素（焚雷点燃周围、熔池附蚀、封脉导流）：深度由调用方 +1，可以再引发最多一级反应</summary>
        public static void AttachFromReaction(Damageable target, Element element, float power, int depth)
        {
            if (!target || target.Dead || target.untargetable || power <= 0) return;
            Attach(target, element, Mathf.Min(power, target.maxHealth * 0.5f), depth, false, target.lastElementBy);
        }

        /// <summary>技能 / 秘卷直接挂元素（不经过伤害），同样判定反应</summary>
        public static void ApplyElement(Damageable target, Element element, float power, int depth = 0, UnityEngine.Object instigator = null)
        {
            if (!target || target.Dead || target.untargetable || power <= 0) return;
            Attach(target, element, Mathf.Min(power, target.maxHealth * 0.5f), depth, false, instigator);
        }

        static float SourceMult(DamageSource source, StatSheet s)
        {
            if (s == null) return 1f;
            return source switch
            {
                DamageSource.Weapon => s.Mult(Stat.DamagePct),
                DamageSource.Skill => s.Mult(Stat.SkillDamagePct),
                DamageSource.Explosion => s.Mult(Stat.ExplosionDamagePct),
                DamageSource.Pet => s.Mult(Stat.PetDamagePct),
                _ => 1f,
            };
        }

        /// <summary>敌人打玩家：交给 <see cref="PlayerVitals"/>（无敌帧、减伤在那边处理）</summary>
        public static float DamagePlayer(float amount, Vector3 from, Element element = Element.None)
        {
            var p = PlayerVitals.Instance;
            if (!p) return 0;
            float dealt = p.TakeDamage(amount, from);
            if (dealt > 0) PlayerDamaged?.Invoke(dealt, from);
            return dealt;
        }

        /// <summary>
        /// 范围爆炸：球形范围内的敌人按到碰撞体表面的距离线性衰减（中心 100% → 边缘 30%），墙后不受伤。
        /// hurtPlayer 时同样衰减地伤害玩家。
        /// </summary>
        /// <param name="exclude">不受这次爆炸伤害的单位（反应的中心敌人已经吃过中心伤害）</param>
        /// <param name="edge">边缘伤害比例（默认 30%；反应余波 60%）</param>
        /// <param name="hitList">收集被炸到的敌人（画雷弧、计数）</param>
        public static void Explode(Vector3 center, float radius, DamageInfo info, bool hurtEnemies = true, float playerDamage = 0,
            Damageable exclude = null, float edge = 0.3f, System.Collections.Generic.List<Damageable> hitList = null)
        {
            // 爆炸声：半径越大越响、越沉（同 Three.js Combat.explode）
            GameAudio.PlayAt("explosion", center, Mathf.Clamp(0.5f + radius * 0.09f, 0.5f, 1f), Mathf.Clamp(1.25f - radius * 0.06f, 0.75f, 1.2f));
            if (hurtEnemies)
            {
                var hits = Physics.OverlapSphere(center, radius, ~0, QueryTriggerInteraction.Ignore);
                var seen = new System.Collections.Generic.HashSet<Damageable>();
                foreach (var c in hits)
                {
                    var hb = c.GetComponent<Hitbox>();
                    var d = hb ? hb.owner : c.GetComponentInParent<Damageable>();
                    if (!d || d.Dead || d == exclude || !seen.Add(d)) continue;
                    var closest = c.ClosestPoint(center);
                    if (Blocked(center, closest, c)) continue;
                    float k = Mathf.Lerp(1f, edge, Mathf.Clamp01(Vector3.Distance(center, closest) / radius));
                    var hit = info;
                    hit.amount = info.amount * k;
                    hit.point = closest;
                    hit.direction = (closest - center).normalized;
                    var res = DamageEnemy(d, hit);
                    if (hitList != null && res.total > 0) hitList.Add(d);
                }
            }
            if (playerDamage > 0 && PlayerVitals.Instance)
            {
                var p = PlayerVitals.Instance.transform.position + Vector3.up * 0.9f;
                float dist = Vector3.Distance(center, p) - 0.35f;
                if (dist < radius && !Blocked(center, p, null))
                    DamagePlayer(playerDamage * Mathf.Lerp(1f, 0.3f, Mathf.Clamp01(dist / radius)), center, info.element);
            }
        }

        /// <summary>两点之间被地形 / 建筑挡住（忽略角色层与目标自身）</summary>
        public static bool Blocked(Vector3 a, Vector3 b, Collider target)
        {
            var dir = b - a;
            float len = dir.magnitude;
            if (len < 0.05f) return false;
            foreach (var h in Physics.RaycastAll(a, dir / len, len, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                if (h.collider != target && !h.collider.GetComponent<Hitbox>()) return true;
            return false;
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
