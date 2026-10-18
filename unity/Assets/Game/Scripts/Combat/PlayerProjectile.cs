using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 玩家投射物（技能的手雷、追踪火灵…）：逐帧推进 + 重力 + 追踪（转向速度 rad/s，目标死了就重新找前方最近的敌人），
    /// 球体扫掠检测敌人与地形（忽略玩家自己）。explodeRadius &gt; 0 时命中 / 触地 / 到期爆炸，否则只伤直接命中的敌人。
    /// 外观由调用方挂在 visual 下（手雷模型、火灵光球…）。
    /// </summary>
    public sealed class PlayerProjectile : MonoBehaviour
    {
        public Vector3 velocity;
        public float gravity, radius = 0.2f, lifetime = 4f, explodeRadius, homing;
        public bool explodeOnExpire = true;
        /// <summary>撞墙 / 地面反弹次数（弹回 60% 速度）；用完后 rollAfter 时贴地滚动直到时间耗尽，否则触地即炸</summary>
        public int bounces;
        public bool rollAfter;
        bool rolling;
        public DamageInfo damage;
        public Damageable target;
        public Action<Vector3> onImpact;
        float age;
        bool done;

        public static PlayerProjectile Spawn(Vector3 pos, Vector3 velocity, DamageInfo damage, float radius, float lifetime, float gravity = 0,
            float explodeRadius = 0, float homing = 0, Damageable target = null)
        {
            var go = new GameObject("Player Projectile");
            go.transform.position = pos;
            if (velocity.sqrMagnitude > 0.01f) go.transform.rotation = Quaternion.LookRotation(velocity);
            var p = go.AddComponent<PlayerProjectile>();
            p.velocity = velocity;
            p.damage = damage;
            p.radius = radius;
            p.lifetime = lifetime;
            p.gravity = gravity;
            p.explodeRadius = explodeRadius;
            p.homing = homing;
            p.target = target;
            return p;
        }

        void Update()
        {
            if (done) return;
            float dt = Time.deltaTime;
            age += dt;
            if (homing > 0) Steer(dt);
            velocity.y -= gravity * dt;
            var from = transform.position;
            var step = velocity * dt;
            float len = step.magnitude;
            if (len > 1e-4f && Cast(from, step / len, len, out var hit, out var enemy))
            {
                if (!enemy && (bounces > 0 || (rollAfter && !rolling)))
                {
                    // 撞到地形：反弹（或开始贴地滚动），继续飞到时间耗尽 / 碰到敌人
                    transform.position = hit.point + hit.normal * (radius + 0.02f);
                    if (bounces > 0)
                    {
                        bounces--;
                        velocity = Vector3.Reflect(velocity, hit.normal) * 0.6f;
                        ShotFx.Instance?.Impact(hit.point, hit.normal, false, 0.8f);
                    }
                    else
                    {
                        rolling = true;
                        velocity = Vector3.ProjectOnPlane(velocity, hit.normal) * 0.7f;
                    }
                    return;
                }
                if (!enemy && rolling)
                {
                    // 滚动中：贴着地面走，摩擦减速
                    transform.position = hit.point + hit.normal * (radius + 0.01f);
                    velocity = Vector3.ProjectOnPlane(velocity, hit.normal) * Mathf.Exp(-2.5f * dt);
                    return;
                }
                transform.position = hit.point;
                Impact(hit.point, hit.normal, enemy);
                return;
            }
            transform.position = from + step;
            if (velocity.sqrMagnitude > 0.01f) transform.rotation = Quaternion.LookRotation(velocity);
            if (age >= lifetime)
            {
                if (explodeOnExpire && explodeRadius > 0) Impact(transform.position, Vector3.up, null);
                else Finish();
            }
        }

        void Steer(float dt)
        {
            if (!target || target.Dead || target.untargetable) target = PickTarget(transform.position, velocity.normalized, 30f, null);
            if (!target) return;
            var want = Center(target) - transform.position;
            velocity = Vector3.RotateTowards(velocity, want.normalized * velocity.magnitude, homing * dt, 0);
        }

        public static Vector3 Center(Damageable d)
        {
            var col = d.GetComponent<Collider>();
            return col && col.enabled ? col.bounds.center : d.transform.position + Vector3.up;
        }

        /// <summary>前方（与 forward 夹角余弦 &gt; -0.2）range 内的敌人：越正对、越近越优先</summary>
        public static Damageable PickTarget(Vector3 from, Vector3 forward, float range, Func<Damageable, float> penalty)
        {
            Damageable best = null;
            float bestScore = float.NegativeInfinity;
            foreach (var ai in FindObjectsByType<EnemyAI>())
            {
                if (ai.Dead) continue;
                var d = ai.GetComponent<Damageable>();
                if (!d || d.untargetable || d.noReward) continue;
                var to = Center(d) - from;
                float dist = to.magnitude;
                if (dist > range || dist < 1e-3f) continue;
                float dot = Vector3.Dot(to / dist, forward);
                if (dot < -0.2f) continue;
                float score = dot - dist / 150f - (penalty?.Invoke(d) ?? 0);
                if (score > bestScore - 0.6f && Combat.Blocked(from, Center(d), d.GetComponent<Collider>())) score -= 0.6f;
                if (score > bestScore)
                {
                    bestScore = score;
                    best = d;
                }
            }
            return best;
        }

        bool Cast(Vector3 from, Vector3 dir, float len, out RaycastHit best, out Damageable enemy)
        {
            best = default;
            enemy = null;
            float bestD = float.MaxValue;
            bool found = false;
            foreach (var h in Physics.SphereCastAll(from, radius, dir, len, Layers.ShotMask, QueryTriggerInteraction.Ignore))
            {
                if (h.collider.GetComponentInParent<PlayerVitals>()) continue;
                float d = h.distance;
                if (d >= bestD) continue;
                var hb = h.collider.GetComponent<Hitbox>();
                var dmg = hb ? hb.owner : h.collider.GetComponentInParent<Damageable>();
                if (dmg && dmg.Dead) continue;
                bestD = d;
                best = h;
                // 起点就重叠的命中：SphereCast 给的 point 是零向量，改用起点
                if (d <= 0) best.point = from;
                enemy = dmg;
                found = true;
            }
            return found;
        }

        void Impact(Vector3 point, Vector3 normal, Damageable enemy)
        {
            if (done) return;
            if (explodeRadius > 0)
            {
                var info = damage;
                info.point = point;
                Combat.Explode(point + normal * 0.1f, explodeRadius, info);
            }
            else if (enemy)
            {
                var info = damage;
                info.point = point;
                info.direction = velocity.normalized;
                Combat.DamageEnemy(enemy, info);
            }
            onImpact?.Invoke(point);
            Finish();
        }

        void Finish()
        {
            done = true;
            // 拖尾留一会儿再销毁
            foreach (var r in GetComponentsInChildren<Renderer>())
                if (r is not TrailRenderer) r.enabled = false;
            Destroy(gameObject, 0.3f);
        }
    }
}
