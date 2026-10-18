using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 伤害结算（Three.js 版 src/combat/Combat.ts 的 damageEnemy / damagePlayer）：
    ///   暴击 = 强制暴击 ∨ 命中弱点 ∨ 掷骰 &lt; 暴击率（持续伤害不暴击；弱点必暴）
    ///   倍率 = 来源加成（武器 → 伤害%，技能 → 技能伤害%，爆炸 → 爆炸伤害%）× 暴击（critMult × (1 + 暴伤%)）× 弱点加成
    ///   然后交给目标按护盾 / 护甲 / 生命分层结算。
    /// 结果以事件广播：伤害数字、命中标记、击杀掉落都订阅这里，不互相引用。
    /// </summary>
    public static class Combat
    {
        public static StatSheet playerStats;
        /// <summary>额外的增伤乘区（英雄被动「余烬」：打灼烧中的敌人 ×1.2…）：返回倍率</summary>
        public static readonly System.Collections.Generic.List<Func<Damageable, DamageInfo, float>> OutgoingModifiers = new();
        public static event Action<Damageable, DamageInfo, DamageResult> EnemyDamaged;
        public static event Action<Damageable, DamageInfo> EnemyKilled;
        /// <summary>玩家受到伤害（数值已扣减）：来源位置用于受击方向指示</summary>
        public static event Action<float, Vector3> PlayerDamaged;

        public static DamageResult DamageEnemy(Damageable target, DamageInfo info, float extraMult = 1f)
        {
            if (!target || target.Dead) return default;
            var stats = playerStats;
            bool crit = info.source != DamageSource.Status &&
                        (info.forceCrit || info.weakpoint || UnityEngine.Random.value < (stats?.Get(Stat.CritChance) ?? 0.05f));
            float mult = extraMult * SourceMult(info.source, stats);
            foreach (var m in OutgoingModifiers) mult *= m(target, info);
            if (crit) mult *= (info.critMult > 0 ? info.critMult : 2f) * (stats?.Mult(Stat.CritDamagePct) ?? 1f);
            if (info.weakpoint) mult *= stats?.Mult(Stat.WeakpointDamagePct) ?? 1f;
            var r = target.ApplyLayers(info, info.amount * mult, crit);
            if (r.total > 0 || r.immune || r.blocked) EnemyDamaged?.Invoke(target, info, r);
            if (r.killed) EnemyKilled?.Invoke(target, info);
            else if (info.element == Element.Fire && info.source != DamageSource.Status && info.statusChance > 0 && r.total > 0 &&
                     UnityEngine.Random.value < info.statusChance)
                EnemyStatus.ApplyBurn(target, r.total);
            return r;
        }

        static float SourceMult(DamageSource source, StatSheet s)
        {
            if (s == null) return 1f;
            return source switch
            {
                DamageSource.Weapon => s.Mult(Stat.DamagePct),
                DamageSource.Skill => s.Mult(Stat.SkillDamagePct),
                DamageSource.Explosion => s.Mult(Stat.ExplosionDamagePct),
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
        public static void Explode(Vector3 center, float radius, DamageInfo info, bool hurtEnemies = true, float playerDamage = 0)
        {
            if (hurtEnemies)
            {
                var hits = Physics.OverlapSphere(center, radius, ~0, QueryTriggerInteraction.Ignore);
                var seen = new System.Collections.Generic.HashSet<Damageable>();
                foreach (var c in hits)
                {
                    var hb = c.GetComponent<Hitbox>();
                    var d = hb ? hb.owner : c.GetComponentInParent<Damageable>();
                    if (!d || d.Dead || !seen.Add(d)) continue;
                    var closest = c.ClosestPoint(center);
                    if (Blocked(center, closest, c)) continue;
                    float k = Mathf.Lerp(1f, 0.3f, Mathf.Clamp01(Vector3.Distance(center, closest) / radius));
                    var hit = info;
                    hit.amount = info.amount * k;
                    hit.point = closest;
                    hit.direction = (closest - center).normalized;
                    DamageEnemy(d, hit);
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
