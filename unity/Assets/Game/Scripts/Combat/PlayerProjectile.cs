using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 玩家投射物（武器的榴弹 / 蛊弹 / 弩箭 / 飞弹，技能的手雷、追踪火灵…；Three.js 版 src/combat/Projectiles.ts 的 owner = player 部分）：
    ///   运动：速度 + 重力 + 追踪（发射 0.1 s 后开始转向，每 0.25 s 复查目标：死了 / 出了 40 m / 躲到掩体后就换，见 <see cref="ProjectileTargeting"/>）；
    ///   检测：每帧球体扫掠（忽略玩家自己），一帧最多拆 5 段——反弹、穿透之后继续走完这一帧剩下的路程，不会卡一帧；
    ///   敌人：直击伤害按弱点规则判爆头（与命中扫描同一条：打中身体后 1.5 m 内穿过同一单位的弱点就算，<see cref="WeakpointRule"/>），
    ///         × 命中盒倍率；pierce &gt; 0 时穿过（伤害不衰减，同 TS），每个敌人只吃一次；
    ///   爆炸弹（explodeRadius &gt; 0）：命中敌人 / 触地 / 到期时只结算爆炸伤害（爆炸不判爆头，同 TS）；
    ///   地形：bounces &gt; 0 时反弹（法向保留 55%、切向 78%，<see cref="ProjectileMath.Bounce"/>）；会反弹的投射物低速落地时改为贴地滚动（不耗反弹次数）；
    ///         反弹用完后 rollAfter 时贴地滚动到时间耗尽（青冥雷蛊），否则触地即炸；
    ///   到期：有爆炸半径且 explodeOnExpire 时原地爆炸；没有伤害也没有爆炸的「载体」到期时在原地回调一次 onImpact。
    /// 两种生命周期：
    ///   <see cref="Spawn(in PlayerProjectileSpec)"/>（及武器用的 <see cref="Spawn(Vector3, Vector3, DamageInfo, ProjectileSpec, int, Color?)"/>）走对象池，
    ///     外观按 visual id 从 <see cref="ProjectileVisuals"/> 取（同样池化）——不要往池化投射物的 transform 下挂东西；
    ///   旧接口 <see cref="Spawn(Vector3, Vector3, DamageInfo, float, float, float, float, float, Damageable)"/> 不池化：调用方自己往 transform 下挂外观（技能、灵宠），
    ///     结束时隐藏渲染器、拖尾留 0.3 s 再销毁（与原来一致）。
    /// </summary>
    public sealed class PlayerProjectile : MonoBehaviour
    {
        // ── 公开状态：旧调用方在 Spawn 之后直接改这些字段 ──
        public Vector3 velocity;
        public float gravity, radius = 0.2f, lifetime = 4f, explodeRadius, homing;
        public bool explodeOnExpire = true;
        /// <summary>撞墙 / 地面反弹次数；用完后 rollAfter 时贴地滚动直到时间耗尽，否则触地即炸</summary>
        public int bounces;
        public bool rollAfter;
        /// <summary>还能穿过几个敌人</summary>
        public int pierce;
        /// <summary>发射后多久开始追踪</summary>
        public float homingDelay = ProjectileMath.PlayerHomingDelay;
        /// <summary>爆炸边缘伤害比例、击退不衰减、爆炸对玩家自己的伤害</summary>
        public float explosionFalloff = 0.3f, selfDamage;
        public bool flatKnockback = true;
        public DamageInfo damage;
        public Damageable target;
        /// <summary>命中 / 触地 / 爆炸时回调（point）；载体到期时也回调</summary>
        public Action<Vector3> onImpact;
        /// <summary>每碰到一个敌人回调一次（穿透时每个一次）：带弱点判定与结算结果</summary>
        public Action<ProjectileHit> onHit;
        /// <summary>弹体颜色（爆炸特效取色）</summary>
        public Color color = new(1f, 0.851f, 0.627f);

        /// <summary>来自对象池（结束时回池，不销毁）</summary>
        public bool Pooled { get; private set; }
        /// <summary>还在飞（没命中、没到期）</summary>
        public bool Alive => !done;
        public float Age => age;
        /// <summary>池化外观（旧接口为 null）</summary>
        public ProjectileView View => view;
        /// <summary>已经穿过的敌人</summary>
        public IReadOnlyCollection<Damageable> HitSet => hitSet;

        bool rolling, done, started, canRoll;
        float age, retargetTimer;
        Vector3 heading = Vector3.forward;
        readonly HashSet<Damageable> hitSet = new();
        ProjectileView view;

        static readonly Stack<PlayerProjectile> free = new();
        static readonly List<PlayerProjectile> live = new();
        static RaycastHit[] castBuf = new RaycastHit[16];
        static bool registered;

        /// <summary>非爆炸投射物到期前的缩小淡出时长</summary>
        const float ExpireFade = 0.12f;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            free.Clear();
            live.Clear();
        }

        /// <summary>在飞的玩家投射物数</summary>
        public static int LiveCount => live.Count;

        static void Register()
        {
            if (registered) return;
            registered = true;
            ProjectilePools.OnClear(ClearAll);
        }

        // ───────────── 发射 ─────────────

        /// <summary>
        /// 旧接口（不池化）：调用方自己往 transform 下挂外观。追踪同样 0.1 s 后开始；target = 初始目标
        /// </summary>
        public static PlayerProjectile Spawn(Vector3 pos, Vector3 velocity, DamageInfo damage, float radius, float lifetime, float gravity = 0,
            float explodeRadius = 0, float homing = 0, Damageable target = null)
        {
            Register();
            var go = new GameObject("Player Projectile");
            var p = go.AddComponent<PlayerProjectile>();
            p.Pooled = false;
            p.Configure(new PlayerProjectileSpec(pos, velocity, damage, radius, lifetime)
            {
                gravity = gravity, explosionRadius = explodeRadius, homing = homing, target = target, visual = null,
            });
            return p;
        }

        /// <summary>武器发射：按武器表的 <see cref="ProjectileSpec"/> 配置（外观、反弹、滚动、追踪、到期爆炸），pierce 取武器的穿透数</summary>
        public static PlayerProjectile Spawn(Vector3 pos, Vector3 velocity, DamageInfo damage, ProjectileSpec spec, int pierce = 0, Color? color = null)
        {
            var s = new PlayerProjectileSpec(pos, velocity, damage, spec.radius, spec.lifetime)
            {
                gravity = spec.gravity, explosionRadius = spec.explosionRadius, bounces = spec.bounces, rollAfter = spec.rollAfter,
                explodeOnExpire = spec.explodeOnExpire, homing = spec.homing, pierce = pierce,
                visual = spec.visual, color = color ?? spec.color, scale = spec.scale,
            };
            return Spawn(in s);
        }

        /// <summary>池化发射。位置 / 速度不是有限值时（上游算出 NaN）照样返回一个实例，但它立刻结束、不触发任何效果</summary>
        public static PlayerProjectile Spawn(in PlayerProjectileSpec spec)
        {
            Register();
            var p = ProjectilePools.Take(free, "Player Projectile");
            p.Pooled = true;
            p.Configure(spec);
            return p;
        }

        void Configure(in PlayerProjectileSpec s)
        {
            bool valid = ProjectileMath.Finite(s.position) && ProjectileMath.Finite(s.velocity);
            velocity = valid ? s.velocity : Vector3.zero;
            damage = s.damage;
            radius = Mathf.Max(0.01f, ProjectileMath.Positive(s.radius, 0.1f));
            lifetime = ProjectileMath.Positive(s.lifetime, 5f);
            gravity = float.IsFinite(s.gravity) ? s.gravity : 0;
            explodeRadius = float.IsFinite(s.explosionRadius) ? Mathf.Max(0, s.explosionRadius) : 0;
            explosionFalloff = Mathf.Clamp01(float.IsFinite(s.explosionFalloff) ? s.explosionFalloff : 0.3f);
            flatKnockback = s.flatKnockback;
            selfDamage = Mathf.Max(0, s.selfDamage);
            pierce = Mathf.Max(0, s.pierce);
            bounces = Mathf.Max(0, s.bounces);
            rollAfter = s.rollAfter;
            explodeOnExpire = s.explodeOnExpire;
            homing = float.IsFinite(s.homing) ? Mathf.Max(0, s.homing) : 0;
            homingDelay = Mathf.Max(0, s.homingDelay);
            target = s.target;
            onImpact = s.onImpact;
            onHit = s.onHit;
            color = s.color;
            age = 0;
            retargetTimer = 0;
            rolling = done = started = canRoll = false;
            hitSet.Clear();
            heading = velocity.sqrMagnitude > 1e-8f ? velocity.normalized : Vector3.forward;
            var pos = valid ? s.position : Vector3.zero;
            transform.SetPositionAndRotation(pos, Quaternion.LookRotation(heading));
            live.Add(this);

            view = null;
            if (valid && !string.IsNullOrEmpty(s.visual))
            {
                view = ProjectileVisuals.Acquire(s.visual);
                float size = ProjectileVisuals.ViewSize(s.visual, radius, s.scale);
                var look = new ProjectileLook { color = s.color, size = size, trailWidth = TrailWidth(s, size), trailTime = 0.22f };
                if (s.visual == "rocket") look.trailColor = Color.Lerp(s.color, new Color(1f, 0.878f, 0.69f), 0.5f) * new Color(1, 1, 1, 0.85f);
                view.Setup(look, pos, heading);
            }
            if (!valid) Finish();
        }

        /// <summary>拖尾宽度（TS 规则）：火箭 0.11 × size、榴弹 0.06 × size，追踪弹 / 爆炸弹 0.7 × size，箭矢不要（Auto 时）</summary>
        static float TrailWidth(in PlayerProjectileSpec s, float size)
        {
            if (s.trail == ProjectileTrail.Off) return 0;
            string v = s.visual;
            float w = v == "rocket" ? 0.11f * size : v == "grenade" ? 0.06f * size : 0.7f * size;
            if (s.trail == ProjectileTrail.On) return w;
            bool auto = v == "rocket" || v == "grenade" || (s.homing > 0 && v != "arrow") || s.explosionRadius > 0;
            return auto ? w : 0;
        }

        // ───────────── 每帧 ─────────────

        void Update()
        {
            if (!done) Step(Time.deltaTime);
        }

        /// <summary>推进 dt 秒（Update 调用；EditMode 测试直接调）</summary>
        public void Step(float dt)
        {
            if (done) return;
            if (!started)
            {
                // 旧调用方在 Spawn 之后才设 bounces：第一帧再定「会不会低速滚动」
                started = true;
                canRoll = bounces > 0;
            }
            age += dt;
            if (homing > 0 && age >= homingDelay) Steer(dt);
            velocity.y -= gravity * dt;

            var pos = transform.position;
            float speed = velocity.magnitude;
            if (speed > 1e-4f)
            {
                var dir = velocity / speed;
                float remaining = speed * dt;
                for (int iter = 0; iter < ProjectileMath.MaxSubsteps && remaining > 1e-6f; iter++)
                {
                    if (!Sweep(pos, dir, remaining, radius, hitSet, out var c))
                    {
                        pos += dir * remaining;
                        remaining = 0;
                        break;
                    }
                    if (c.enemy)
                    {
                        transform.position = c.point;
                        EnemyContact(c, dir);
                        if (done) return;
                        // 穿透：从命中点继续这一帧剩下的路程
                        float adv = Mathf.Min(remaining, c.distance + 0.02f);
                        pos += dir * adv;
                        remaining -= adv;
                        continue;
                    }

                    // 地形 / 建筑
                    remaining -= c.distance;
                    var n = c.normal;
                    float vn = Vector3.Dot(velocity, n);
                    if (vn >= 0)
                    {
                        // 已经在远离表面（擦边）：推出一点继续
                        pos += dir * c.distance + n * 0.02f;
                        continue;
                    }
                    if (rolling)
                    {
                        // 滚动中：贴着表面走，摩擦减速
                        pos = c.point + n * (radius + 0.01f);
                        velocity = Vector3.ProjectOnPlane(velocity, n) * Mathf.Exp(-ProjectileMath.RollFriction * dt);
                    }
                    else if (canRoll && n.y > 0.7f && gravity > 0 && -vn < ProjectileMath.RollSpeed)
                    {
                        // 会反弹的投射物低速落地：贴地滚动（不耗反弹次数）
                        pos = c.point + n * (radius + 0.01f);
                        velocity -= n * vn;
                        float fr = Mathf.Exp(-ProjectileMath.RollFriction * dt);
                        velocity.x *= fr;
                        velocity.z *= fr;
                    }
                    else if (bounces > 0)
                    {
                        bounces--;
                        pos = c.point + n * (radius + 0.02f);
                        velocity = ProjectileMath.Bounce(velocity, n);
                        ShotFx.Instance?.Impact(c.point, n, false, 0.8f);
                    }
                    else if (rollAfter)
                    {
                        // 反弹用完：开始贴地滚动，直到时间耗尽 / 碰到敌人
                        rolling = true;
                        pos = c.point + n * (radius + 0.02f);
                        velocity = Vector3.ProjectOnPlane(velocity, n) * ProjectileMath.RollEntryKeep;
                    }
                    else
                    {
                        transform.position = c.point;
                        Impact(c.point, n);
                        return;
                    }
                    float ns = velocity.magnitude;
                    if (ns < 1e-4f) break;
                    remaining *= ns / speed;
                    speed = ns;
                    dir = velocity / ns;
                }
            }
            else
            {
                // 静止（滚停的蛊弹）：原地做一次重叠检测，敌人走进来照样命中
                float r = Mathf.Max(radius, 0.1f);
                if (Sweep(pos - heading * r, heading, 2 * r, radius, hitSet, out var c) && c.enemy)
                {
                    EnemyContact(c, heading);
                    if (done) return;
                }
            }

            transform.position = pos;
            if (pos.y < ProjectileMath.KillY)
            {
                Finish();
                return;
            }
            if (velocity.sqrMagnitude > 1e-6f) heading = velocity.normalized;
            if (velocity.sqrMagnitude > 0.01f) transform.rotation = Quaternion.LookRotation(velocity);
            if (age >= lifetime)
            {
                Expire();
                return;
            }
            if (view)
            {
                float fade = explodeOnExpire && explodeRadius > 0 ? 1 : Mathf.Clamp01((lifetime - age) / ExpireFade);
                view.Pose(pos, heading, age, lifetime, dt, fade);
            }
        }

        // ───────────── 追踪 ─────────────

        void Steer(float dt)
        {
            retargetTimer -= dt;
            var pos = transform.position;
            if (!ProjectileTargeting.Valid(target, hitSet))
            {
                // 目标死了 / 穿过了：马上换；一直没有候选时每 0.25 s 再找一次
                if (target || retargetTimer <= 0)
                {
                    target = ProjectileTargeting.PickHoming(pos, velocity, hitSet);
                    retargetTimer = ProjectileMath.HomingRetarget;
                }
            }
            else if (retargetTimer <= 0)
            {
                // 粘住当前目标（齐射按发射方向分到不同目标后不会再挤到同一个身上），只有跑出范围或躲到掩体后才换
                retargetTimer = ProjectileMath.HomingRetarget;
                if (!ProjectileTargeting.StillGood(target, pos)) target = ProjectileTargeting.PickHoming(pos, velocity, hitSet);
            }
            if (!target) return;
            var want = ProjectileTargeting.Center(target) - pos;
            float speed = velocity.magnitude;
            if (want.sqrMagnitude < 1e-8f || speed < 1e-4f) return;
            velocity = Vector3.RotateTowards(velocity, want.normalized * speed, homing * dt, 0);
        }

        // ───────────── 命中检测 ─────────────

        /// <summary>
        /// 沿 from + dir × [0, len] 扫掠半径 radius 的球（世界 + 角色，忽略玩家、死掉的单位和 exclude 里的敌人），返回最近的接触。
        /// 打中敌人身体时按 <see cref="WeakpointRule"/> 再往前看 1.5 m 找同一单位的弱点。起点就重叠的接触：point = 起点、normal = −dir。
        /// </summary>
        public static bool Sweep(Vector3 from, Vector3 dir, float len, float radius, ICollection<Damageable> exclude, out ProjectileHit hit)
        {
            hit = default;
            if (!(len > 0)) return false;
            float reach = len + WeakpointRule.Window;
            int n;
            while ((n = Physics.SphereCastNonAlloc(from, radius, dir, castBuf, reach, Layers.ShotMask, QueryTriggerInteraction.Ignore)) >= castBuf.Length)
                castBuf = new RaycastHit[castBuf.Length * 2];
            WeakpointRule.SortByDistance(castBuf, n);
            bool found = false;
            for (int i = 0; i < n; i++)
            {
                var h = castBuf[i];
                if (h.distance > len) break;
                var col = h.collider;
                if (!col || col.GetComponentInParent<PlayerVitals>()) continue;
                var hb = col.GetComponent<Hitbox>();
                var d = hb ? hb.owner : col.GetComponentInParent<Damageable>();
                if (d && (d.Dead || (exclude != null && exclude.Contains(d)))) continue;
                bool overlap = h.distance <= 0;
                hit.distance = Mathf.Max(0, h.distance);
                hit.point = overlap ? from : h.point;
                hit.normal = overlap ? -dir : h.normal;
                hit.enemy = d;
                hit.hitbox = hb;
                hit.weakpoint = hb && hb.weakpoint;
                hit.multiplier = hb ? hb.multiplier : 1f;
                if (d && hb && !hb.weakpoint)
                {
                    int j = WeakpointRule.FindWeakpoint(castBuf, n, i, d);
                    if (j >= 0)
                    {
                        var wb = castBuf[j].collider.GetComponent<Hitbox>();
                        hit.weakpoint = true;
                        hit.hitbox = wb;
                        hit.multiplier = wb.multiplier;
                        hit.point = castBuf[j].distance <= 0 ? from : castBuf[j].point;
                    }
                }
                found = true;
                break;
            }
            Array.Clear(castBuf, 0, n);
            return found;
        }

        // ───────────── 命中结算 ─────────────

        void EnemyContact(in ProjectileHit c, Vector3 dir)
        {
            var enemy = c.enemy;
            if (explodeRadius > 0)
            {
                // 爆炸弹只结算爆炸（爆炸不判爆头）
                InvokeHit(c);
                if (done) return;
                Impact(c.point, c.normal);
                return;
            }
            var h = c;
            if (damage.amount > 0)
            {
                var info = damage;
                info.point = c.point;
                info.direction = dir;
                if (c.weakpoint) info.weakpoint = true;
                info.amount *= c.multiplier;
                h.result = Combat.DamageEnemy(enemy, info);
            }
            InvokeHit(h);
            InvokeImpact(c.point);
            if (done) return;
            if (pierce > 0)
            {
                pierce--;
                hitSet.Add(enemy);
                if (target == enemy)
                {
                    // 穿过了追踪目标：下一帧马上换下一个
                    target = null;
                    retargetTimer = 0;
                }
                return;
            }
            Finish();
        }

        /// <summary>触地 / 命中爆炸 / 到期爆炸：有爆炸半径时在 point 外 0.1 m 处爆炸，然后回调、结束</summary>
        void Impact(Vector3 point, Vector3 normal)
        {
            if (done) return;
            if (explodeRadius > 0)
            {
                var info = damage;
                info.point = point;
                var o = new ExplosionOptions(point + normal * 0.1f, explodeRadius, info)
                {
                    falloff = explosionFalloff, flatKnockback = flatKnockback, playerDamage = selfDamage, color = color,
                };
                Combat.Explode(in o);
            }
            InvokeImpact(point);
            Finish();
        }

        void Expire()
        {
            if (explodeOnExpire && explodeRadius > 0)
            {
                Impact(transform.position, Vector3.up);
                return;
            }
            // 「载体」（没有伤害也没有爆炸，效果全在回调里）一直没碰到东西就到期：在原地触发一次，免得技能白放
            if (damage.amount <= 0 && explodeRadius <= 0) InvokeImpact(transform.position);
            Finish();
        }

        void InvokeImpact(Vector3 point)
        {
            var cb = onImpact;
            if (cb == null) return;
            try
            {
                cb(point);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        void InvokeHit(in ProjectileHit h)
        {
            var cb = onHit;
            if (cb == null) return;
            try
            {
                cb(h);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        // ───────────── 回收 ─────────────

        /// <summary>立刻结束（不爆炸、不回调）：换关、技能取消</summary>
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
            onHit = null;
            target = null;
            hitSet.Clear();
            if (Pooled)
            {
                ProjectilePools.Give(free, this);
                return;
            }
            // 旧接口：调用方挂的外观隐藏，拖尾留一会儿再销毁
            foreach (var r in GetComponentsInChildren<Renderer>())
                if (r is not TrailRenderer)
                    r.enabled = false;
            if (Application.isPlaying) Destroy(gameObject, 0.3f);
            else DestroyImmediate(gameObject);
        }

        void OnDestroy()
        {
            live.Remove(this);
            if (view) view.ForceRecycle();
            view = null;
        }

        /// <summary>回收全部在飞的玩家投射物（不爆炸、不回调）</summary>
        public static void ClearAll()
        {
            if (live.Count == 0) return;
            foreach (var p in live.ToArray())
                if (p)
                    p.Finish();
            live.Clear();
        }

        // ───────────── 工具（旧接口，技能 / 音效 / 冒烟测试在用）─────────────

        /// <summary>单位的身体中心</summary>
        public static Vector3 Center(Damageable d) => ProjectileTargeting.Center(d);

        /// <summary>
        /// 前方（与 forward 夹角余弦 &gt; −0.2）range 内的敌人：越正对、越近越优先（技能发射前挑初始目标用；penalty 让多发分散到不同目标）。
        /// 视线被挡的扣 0.6 分。遍历 <see cref="EnemyAI.All"/>。
        /// </summary>
        public static Damageable PickTarget(Vector3 from, Vector3 forward, float range, Func<Damageable, float> penalty)
        {
            Damageable best = null;
            float bestScore = float.NegativeInfinity;
            var all = EnemyAI.All;
            for (int i = 0; i < all.Count; i++)
            {
                var ai = all[i];
                if (!ai || ai.Dead) continue;
                var d = ai.Health;
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
    }
}
