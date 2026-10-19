using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌人弹丸（弩箭、火球、冰刺、投矛…；Three.js 版 src/combat/Projectiles.ts 的 owner = enemy 部分）：对象池复用，外观按 visual id 取（<see cref="ProjectileVisuals"/>）。
    /// 每帧：追踪（瞄准玩家胸口，飞过玩家后不再掉头）→ 重力 → 灵体诱饵 → 挡弹区（<see cref="ProjectileWard"/>，先于玩家判定）
    /// → 玩家胶囊（线段到胶囊轴线的距离，比物理触发器稳定，不漏判；冲刺无敌帧内穿过）→ 地形 / 建筑扫掠。
    /// explodeRadius &gt; 0 时落地 / 命中 / 被挡下后爆炸（范围伤害 + 地面火光），否则只打直接命中；到期时同样在原地结算一次。
    /// spirit = 被嘲讽的敌人射出的（对着灵体诱饵打）：不伤玩家，穿过诱饵胶囊时被吸收；没被嘲讽的弹丸直接穿过灵体。
    /// fake = 幻影弹（蜃景火球）：碰到什么都只是一阵冷光。
    /// </summary>
    public sealed class EnemyProjectile : MonoBehaviour
    {
        Vector3 velocity, heading = Vector3.forward;
        float gravity, damage, radius, explodeRadius, explosionFalloff, life, lifetime, age, homing;
        Element element;
        bool fake, spirit, blockable, done;
        UnityEngine.Object source;
        Action<Vector3, bool> onImpact;
        Action<Vector3> onBlocked;
        ProjectileView view;

        static readonly Stack<EnemyProjectile> free = new();
        static readonly List<EnemyProjectile> live = new();
        static bool registered;
        static PlayerVitals motorOwner;
        static PlayerMotor motor;

        /// <summary>玩家胶囊（脚底上方 0.35 → 1.45 m 的线段，半径 0.35）</summary>
        const float PlayerLow = 0.35f, PlayerHigh = 1.45f, PlayerRadius = 0.35f;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            free.Clear();
            live.Clear();
            motorOwner = null;
            motor = null;
        }

        /// <summary>在飞的敌方投射物数</summary>
        public static int LiveCount => live.Count;
        public bool Alive => !done;
        public float Damage => damage;

        /// <summary>旧接口：等价于 <see cref="Spawn(in EnemyProjectileSpec)"/>（外观 orb、拖尾开、爆炸弹带火光）</summary>
        public static EnemyProjectile Spawn(Vector3 pos, Vector3 velocity, float gravity, float damage, float radius, float explodeRadius,
            Color color, float lifetime = 4f, Element element = Element.None, bool fake = false, bool spirit = false) =>
            Spawn(new EnemyProjectileSpec(pos, velocity, damage, radius, lifetime)
            {
                gravity = gravity, explosionRadius = explodeRadius, color = color, element = element, fake = fake, spirit = spirit,
            });

        /// <summary>池化发射。位置 / 速度不是有限值时照样返回实例，但它立刻结束、不触发任何效果</summary>
        public static EnemyProjectile Spawn(in EnemyProjectileSpec s)
        {
            if (!registered)
            {
                registered = true;
                ProjectilePools.OnClear(ClearAll);
            }
            var p = ProjectilePools.Take(free, "Enemy Projectile");
            p.Configure(s);
            return p;
        }

        void Configure(in EnemyProjectileSpec s)
        {
            bool valid = ProjectileMath.Finite(s.position) && ProjectileMath.Finite(s.velocity);
            velocity = valid ? s.velocity : Vector3.zero;
            gravity = float.IsFinite(s.gravity) ? s.gravity : 0;
            damage = float.IsFinite(s.damage) ? Mathf.Max(0, s.damage) : 0;
            radius = Mathf.Max(0.01f, ProjectileMath.Positive(s.radius, 0.22f));
            lifetime = life = ProjectileMath.Positive(s.lifetime, 4f);
            explodeRadius = float.IsFinite(s.explosionRadius) ? Mathf.Max(0, s.explosionRadius) : 0;
            explosionFalloff = Mathf.Clamp01(float.IsFinite(s.explosionFalloff) ? s.explosionFalloff : 0.3f);
            element = s.element;
            homing = float.IsFinite(s.homing) ? Mathf.Max(0, s.homing) : 0;
            fake = s.fake;
            spirit = s.spirit;
            blockable = s.blockable;
            source = s.source;
            onImpact = s.onImpact;
            onBlocked = s.onBlocked;
            age = 0;
            done = false;
            heading = velocity.sqrMagnitude > 1e-8f ? velocity.normalized : Vector3.forward;
            var pos = valid ? s.position : Vector3.zero;
            transform.SetPositionAndRotation(pos, Quaternion.LookRotation(heading));
            live.Add(this);

            view = null;
            if (valid && !string.IsNullOrEmpty(s.visual))
            {
                view = ProjectileVisuals.Acquire(s.visual);
                var c = s.color;
                var look = new ProjectileLook
                {
                    color = c, hostile = true, size = ProjectileVisuals.ViewSize(s.visual, radius, s.scale), coreBoost = 1.3f,
                    // 拖尾（同原来的手调值）：宽 1.8 × 半径，爆炸弹拖得更长；爆炸弹带一盏火光
                    trailWidth = s.trail == ProjectileTrail.Off ? 0 : radius * 1.8f,
                    trailTime = explodeRadius > 0 ? 0.28f : 0.18f,
                    trailColor = new Color(c.r, c.g, c.b, 0.9f),
                    lightRange = explodeRadius > 0 ? 4f : 0, lightIntensity = 2f,
                };
                view.Setup(look, pos, heading);
            }
            if (!valid) Finish();
        }

        void Update()
        {
            if (!done) Step(Time.deltaTime);
        }

        /// <summary>推进 dt 秒（Update 调用；EditMode 测试直接调）</summary>
        public void Step(float dt)
        {
            if (done) return;
            age += dt;
            life -= dt;
            if (homing > 0 && !spirit && !fake) Steer(dt);
            velocity.y -= gravity * dt;
            var from = transform.position;
            var step = velocity * dt;
            float len = step.magnitude;
            var dir = len > 1e-6f ? step / len : heading;

            // 灵体诱饵（被嘲讽的敌人对着它打）：穿过它的胶囊就被吸收；被嘲讽时射出的弹丸不伤玩家
            if (spirit)
                foreach (var d in Decoys.Active())
                {
                    var p0 = d.t.position + Vector3.up * 0.1f;
                    if (ProjectileMath.SegmentSegmentDistance(from, from + step, p0, p0 + Vector3.up * Mathf.Max(0.1f, d.height - 0.1f)) < radius + d.radius)
                    {
                        EnemyAI.DecoyBlocked(d.t);
                        fake = true;
                        Impact(from + step * 0.5f, false);
                        return;
                    }
                }
            // 挡弹区：先于玩家判定
            if (blockable && ProjectileWard.ActiveCount > 0 && len > 1e-6f && ProjectileWard.TryBlock(from, dir, len, out var ward, out var wp))
            {
                Block(ward, wp, dir);
                return;
            }
            // 玩家：线段（本帧移动）到玩家胶囊轴线的最近距离
            if (!spirit && TouchesPlayer(from, step, out var at))
            {
                Impact(at, true);
                return;
            }
            if (len > 1e-5f && Physics.SphereCast(from, radius * 0.5f, dir, out var hit, len, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                Impact(hit.point, false);
                return;
            }
            var pos = from + step;
            transform.position = pos;
            if (pos.y < ProjectileMath.KillY)
            {
                Finish();
                return;
            }
            if (velocity.sqrMagnitude > 1e-6f) heading = velocity.normalized;
            if (life <= 0)
            {
                Impact(pos, false);
                return;
            }
            if (view) view.Pose(pos, heading, age, lifetime, dt, 1f);
        }

        /// <summary>追踪：转向玩家胸口；已经飞过玩家（速度背离玩家）就不再追，保证可以闪避</summary>
        void Steer(float dt)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var want = pv.transform.position + Vector3.up * ProjectileMath.PlayerChest - transform.position;
            if (Vector3.Dot(want, velocity) <= 0)
            {
                homing = 0;
                return;
            }
            float speed = velocity.magnitude;
            if (speed < 1e-4f || want.sqrMagnitude < 1e-8f) return;
            velocity = Vector3.RotateTowards(velocity, want.normalized * speed, homing * dt, 0);
        }

        /// <summary>冲刺无敌帧内敌方弹丸直接穿过玩家（闪避手感，同 TS）；其他无敌（复活保护、调试）只是不掉血，弹丸照常被吃掉</summary>
        public static bool PassesThroughPlayer(PlayerVitals pv)
        {
            if (!pv) return false;
            if (motorOwner != pv)
            {
                motorOwner = pv;
                motor = pv.GetComponent<PlayerMotor>();
            }
            return motor && motor.Dashing && motor.Invulnerable;
        }

        bool TouchesPlayer(Vector3 from, Vector3 step, out Vector3 at)
        {
            at = from;
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead || PassesThroughPlayer(pv)) return false;
            var p = pv.transform.position;
            float d = ProjectileMath.SegmentSegmentDistance(from, from + step, p + Vector3.up * PlayerLow, p + Vector3.up * PlayerHigh, out float s);
            at = from + step * s;
            return d < radius + PlayerRadius;
        }

        void Explode(Vector3 at, Vector3 dir)
        {
            var info = DamageInfo.Simple(0, DamageSource.Enemy, at, dir);
            info.element = element;
            info.instigator = source;
            var o = new ExplosionOptions(at, explodeRadius, info)
            {
                noEnemies = true, playerDamage = spirit ? 0 : damage, falloff = explosionFalloff, flatKnockback = true,
            };
            Combat.Explode(in o);
            ShotFx.Instance?.Impact(at, Vector3.up, false, 3f);
            ShotFx.Instance?.Impact(at, Vector3.up, true, 3f);
        }

        void Impact(Vector3 at, bool hitPlayer)
        {
            if (done) return;
            var dir = velocity.sqrMagnitude > 1e-8f ? velocity.normalized : heading;
            if (fake)
            {
                // 幻影弹：落地只是一阵冷光，没有伤害
                ShotFx.Instance?.Impact(at, Vector3.up, false, 1.5f);
            }
            else if (explodeRadius > 0) Explode(at, dir);
            else
            {
                if (hitPlayer && !spirit) Combat.DamagePlayer(damage, at - dir, element, source);
                ShotFx.Instance?.Impact(at, -dir, false, 0.8f);
            }
            var cb = onImpact;
            if (cb != null)
                try
                {
                    cb(at, hitPlayer);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            Finish();
        }

        /// <summary>被挡弹区挡下：不触发 onImpact，改调 onBlocked；爆炸弹在挡弹面上引爆</summary>
        void Block(ProjectileWard ward, Vector3 point, Vector3 dir)
        {
            if (fake) ShotFx.Instance?.Impact(point, -dir, false, 1.5f);
            else if (explodeRadius > 0) Explode(point, dir);
            else ShotFx.Instance?.Impact(point, -dir, false, 0.8f);
            transform.position = point;
            ward.NotifyBlocked(point, fake || spirit ? 0 : damage);
            var cb = onBlocked;
            if (cb != null)
                try
                {
                    cb(point);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            Finish();
        }

        /// <summary>立刻结束（不爆炸、不回调）：换关</summary>
        public void Kill() => Finish();

        void Finish()
        {
            if (done) return;
            done = true;
            live.Remove(this);
            if (view)
            {
                view.Release();
                view = null;
            }
            onImpact = null;
            onBlocked = null;
            source = null;
            ProjectilePools.Give(free, this);
        }

        void OnDestroy()
        {
            live.Remove(this);
            if (view) view.ForceRecycle();
            view = null;
        }

        /// <summary>回收全部在飞的敌方投射物（不爆炸、不回调）</summary>
        public static void ClearAll()
        {
            if (live.Count == 0) return;
            foreach (var p in live.ToArray())
                if (p)
                    p.Finish();
            live.Clear();
        }

        /// <summary>
        /// 抛物线初速度：从 from 经 flightTime 秒落到 to（重力 gravity），水平匀速、竖直按落差补偿
        /// </summary>
        public static Vector3 Ballistic(Vector3 from, Vector3 to, float flightTime, float gravity) => ProjectileMath.Ballistic(from, to, flightTime, gravity);
    }
}
