using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 弱点判定（与 WeaponController 的命中扫描同一条规则，W1 的 Ballistics 可以直接复用）：
    /// 身体胶囊往往把头 / 弱点包在里面，射线 / 扫掠先进身体胶囊；沿着前进方向 <see cref="Window"/> 米内穿过同一单位的弱点命中盒，
    /// 就按弱点算（伤害 × 那个命中盒的 multiplier，必定暴击）。
    /// </summary>
    public static class WeakpointRule
    {
        /// <summary>身体命中之后再往前看多远（米）</summary>
        public const float Window = 1.5f;

        /// <summary>
        /// hits[0..count) 已按距离升序，index 是打中的身体命中盒；返回 index 之后 window 米内同一单位（owner）的弱点命中的下标，没有返回 −1
        /// </summary>
        public static int FindWeakpoint(RaycastHit[] hits, int count, int index, Damageable owner, float window = Window)
        {
            if (!owner || index < 0 || index >= count) return -1;
            float limit = hits[index].distance + window;
            for (int j = index + 1; j < count && hits[j].distance < limit; j++)
            {
                var c = hits[j].collider;
                if (!c) continue;
                var wb = c.GetComponent<Hitbox>();
                if (wb && wb.weakpoint && wb.owner == owner) return j;
            }
            return -1;
        }

        /// <summary>按距离升序原地排序（插入排序：投射物一次扫掠只有几个命中，不分配）</summary>
        public static void SortByDistance(RaycastHit[] hits, int count)
        {
            for (int i = 1; i < count; i++)
            {
                var h = hits[i];
                int j = i - 1;
                while (j >= 0 && hits[j].distance > h.distance)
                {
                    hits[j + 1] = hits[j];
                    j--;
                }
                hits[j + 1] = h;
            }
        }
    }

    /// <summary>
    /// 投射物选目标：遍历 <see cref="EnemyAI.All"/>（不再每帧 FindObjectsByType）。E1 的 EnemyRegistry 落地后改走它。
    /// </summary>
    public static class ProjectileTargeting
    {
        /// <summary>单位的身体中心（碰撞体包围盒中心，没有碰撞体时取脚底上方 1 m）</summary>
        public static Vector3 Center(Damageable d)
        {
            var col = d.GetComponent<Collider>();
            return col && col.enabled ? col.bounds.center : d.transform.position + Vector3.up;
        }

        /// <summary>能当追踪目标：活着、可选中、给奖励（蜃景分身之类的召唤物不追）、不在排除集合里</summary>
        public static bool Valid(Damageable d, ICollection<Damageable> exclude = null) =>
            d && !d.Dead && !d.untargetable && !d.noReward && (exclude == null || !exclude.Contains(d));

        /// <summary>
        /// 玩家追踪弹选目标（TS pickTarget）：以偏离当前飞行方向的角度为主、距离为辅（<see cref="ProjectileMath.HomingScore"/>），需要视线。
        /// 这样飞弹会去准星附近的敌人，而不是被侧面更近的敌人拐走。exclude = 已经穿过的敌人。
        /// </summary>
        public static Damageable PickHoming(Vector3 from, Vector3 velocity, ICollection<Damageable> exclude, float range = ProjectileMath.PlayerHomingRange)
        {
            float speed = velocity.magnitude;
            if (speed < 1e-4f) return null;
            var heading = velocity / speed;
            Damageable best = null;
            float bestScore = float.PositiveInfinity;
            var all = EnemyAI.All;
            for (int i = 0; i < all.Count; i++)
            {
                var ai = all[i];
                if (!ai) continue;
                var d = ai.Health;
                if (!Valid(d, exclude)) continue;
                var c = Center(d);
                var to = c - from;
                float dist = to.magnitude;
                if (dist > range || dist < 1e-3f) continue;
                float score = ProjectileMath.HomingScore(Vector3.Dot(to / dist, heading), dist);
                if (score >= bestScore) continue;
                if (Combat.Blocked(c, from, d.GetComponent<Collider>())) continue;
                best = d;
                bestScore = score;
            }
            return best;
        }

        /// <summary>当前目标还值得追：有效、在范围内、视线没被挡（每 0.25 s 复查一次）</summary>
        public static bool StillGood(Damageable d, Vector3 from, float range = ProjectileMath.PlayerHomingRange)
        {
            if (!Valid(d)) return false;
            var c = Center(d);
            return (c - from).sqrMagnitude <= range * range && !Combat.Blocked(c, from, d.GetComponent<Collider>());
        }
    }
}
