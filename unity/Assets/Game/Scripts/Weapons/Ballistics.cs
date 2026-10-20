using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>一发的弹道参数（由控制器按 <see cref="ShotMods"/> 与实际数值组好）</summary>
    public struct ShotContext
    {
        public WeaponInstance weapon;
        public ResolvedWeapon stats;
        /// <summary>本发元素（元素轮转时与实例元素不同）</summary>
        public Element element;
        /// <summary>单发 / 单弹丸伤害（已乘蓄力等修饰；不含玩家伤害加成，Combat 会乘）</summary>
        public float damage;
        /// <summary>还能穿过几个敌人（实际穿透 + 满蓄加成）</summary>
        public int pierce;
        /// <summary>满蓄一击；命中引爆元素状态（满蓄且武器 chargeDetonate）</summary>
        public bool full, detonate;
        /// <summary>本发必定暴击（传说「天命」，<see cref="ShotMods.forceCrit"/>）</summary>
        public bool forceCrit;

        public readonly WeaponDef Def => stats != null ? stats.def : weapon?.def;
    }

    /// <summary>
    /// 弹道（同 TS Firing.ts 的 Ballistics）：射线从眼睛（准星）出发，曳光 / 投射物从枪口出发。
    ///   命中扫描：按距离排序的全部命中（NonAlloc），贴脸时起点所在的敌人直接算命中；身体命中后 1.5 m 内穿过同一单位的弱点按弱点算
    ///   （<see cref="WeakpointRule"/>，与投射物同一条规则）；穿透：每穿过一个敌人伤害 ×0.85，最多 8 个，地形挡住为止。
    ///   投射物：射向准星落点（最远 60 m），有重力时解抛物线；落点贴脸或枪口被墙挡住时从眼前发射；齐射可随机散开或按固定偏航排成扇形。
    ///   光束一跳：命中扫描（不画曳光）+ 向附近 1 个敌人弹射电弧。
    /// </summary>
    public sealed class Ballistics
    {
        /// <summary>每穿透一名敌人后保留的伤害比例；单次射线最多命中的敌人数</summary>
        public const float PierceKeep = 0.85f;
        public const int MaxPierceHits = 8;
        /// <summary>
        /// 投射物瞄准点的最远距离。TS 是 160 m（并把抛物线补偿封顶 2.4 s）；Unity 按飞行时间精确解抛物线，远了会在寿命内落不到，
        /// 先保留 60 m（榴弹的 160 m 瞄准由 WC4 连同补偿封顶一起做）
        /// </summary>
        public const float ProjectileAimMax = 60f;
        /// <summary>准星落点近于此距离时改从眼前发射（贴脸的敌人可能夹在眼睛与枪口之间）</summary>
        public const float PointBlankRange = 1.3f;
        /// <summary>曳光（物理暖白）与满蓄一击追加的虹光</summary>
        public static readonly Color TracerColor = new(1f, 0.82f, 0.5f, 1f);
        public static readonly Color FullChargeColor = new(0.79f, 0.66f, 1f, 1f);

        readonly Collider self;
        readonly Object instigator;
        /// <summary>最近一次 <see cref="SortedHits"/> 的结果（按距离升序）</summary>
        public readonly RaycastHit[] hits = new RaycastHit[64];
        static readonly Collider[] overlap = new Collider[8];
        readonly HashSet<Damageable> struck = new();
        readonly List<Damageable> chain = new(1);
        Vector3 volleyDir = Vector3.forward, volleyTarget;
        float volleyDist;

        public Ballistics(Collider self, Object instigator)
        {
            this.self = self;
            this.instigator = instigator;
        }

        /// <summary>沿 dir 的全部命中，按距离升序写进 <see cref="hits"/>；返回个数</summary>
        public int SortedHits(Vector3 origin, Vector3 dir, float range)
        {
            int n = Physics.RaycastNonAlloc(origin, dir, hits, range, Layers.ShotMask, QueryTriggerInteraction.Ignore);
            WeakpointRule.SortByDistance(hits, n);
            return n;
        }

        /// <summary>起点落在哪个活着的敌人碰撞体里（贴脸开枪）：返回那个命中盒，没有则 null</summary>
        public Hitbox PointBlank(Vector3 origin)
        {
            int n = Physics.OverlapSphereNonAlloc(origin, 0.05f, overlap, 1 << Layers.Character, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < n; i++)
            {
                var c = overlap[i];
                if (c == self) continue;
                var hb = c.GetComponent<Hitbox>();
                if (hb && hb.owner && !hb.owner.Dead) return hb;
            }
            return null;
        }

        /// <summary>
        /// 伤害模板：实例数值（随机元素、暴伤 / 元素率词条）；词条暴击率在这里掷，掷中 forceCrit（同 TS Firing.rollCrit），传说「天命」直接 forceCrit。
        /// 副元素（青冥雷蛊的固有「副·雷」）由词条派发（<see cref="AffixEffects"/>，同 TS innate），这里不再带 def.subElement，免得掷两次
        /// </summary>
        public DamageInfo HitInfo(in ShotContext s, float amount, Vector3 point, Vector3 dir)
        {
            var def = s.Def;
            var R = s.stats;
            return new DamageInfo
            {
                amount = amount, source = DamageSource.Weapon, tags = DamageTag.Weapon, weaponUid = s.weapon?.uid ?? 0,
                critMult = R?.critMult ?? def.critMult, point = point, direction = dir, knockback = def.knockback, element = s.element, instigator = instigator,
                statusChance = R?.elementChance ?? (def.element != Element.None ? def.elementChance : 0),
                forceCrit = s.forceCrit || (R != null && R.critChance > 0 && Random.value < R.critChance),
            };
        }

        /// <summary>圆锥内均匀分布的方向（半径取 sqrt 让中心不过密）；basis 给出锥的横 / 竖轴</summary>
        public static Vector3 Scatter(Vector3 dir, Transform basis, float halfAngle) =>
            halfAngle <= 0 ? dir : Scatter(dir, basis.right, basis.up, halfAngle);

        public static Vector3 Scatter(Vector3 dir, Vector3 right, Vector3 up, float halfAngle)
        {
            if (halfAngle <= 0) return dir;
            float r = Mathf.Sqrt(Random.value) * Mathf.Tan(halfAngle);
            float a = Random.value * Mathf.PI * 2;
            return (dir + right * (Mathf.Cos(a) * r) + up * (Mathf.Sin(a) * r)).normalized;
        }

        /// <summary>绕 dir 自己的横 / 竖轴散开（投射物扇形用）</summary>
        public static Vector3 ScatterAround(Vector3 dir, float halfAngle)
        {
            var right = Vector3.Cross(Vector3.up, dir);
            right = right.sqrMagnitude < 1e-6f ? Vector3.right : right.normalized;
            return Scatter(dir, right, Vector3.Cross(dir, right).normalized, halfAngle);
        }

        // ───────────── 命中扫描 ─────────────

        /// <summary>
        /// 一条射线的命中结算（含穿透）；返回打中的第一个单位（没打中 / 打在地形上为 null），end = 弹道终点。
        /// tracer 透明时不画曳光（光束）。地形、尸体挡住子弹；穿透只对活着（或出生中 / 遁地中显示「免疫」）的单位生效
        /// </summary>
        public Damageable Hitscan(in ShotContext s, Vector3 origin, Vector3 dir, Vector3 muzzle, float fxScale, Color tracer, float tracerWidth, out Vector3 end)
        {
            var def = s.Def;
            float range = def.range;
            int n = SortedHits(origin, dir, range);
            struck.Clear();
            Damageable first = null;
            int pierceLeft = Mathf.Max(0, s.pierce);
            float mult = 1;
            bool stopped = false;
            end = origin + dir * range;
            // 贴脸：射线起点已经在敌人胶囊里时射线打不到它（敌人走进玩家身上、大体型敌人），直接算命中这个敌人
            var inside = PointBlank(origin);
            if (inside)
            {
                var p = origin + dir * 0.3f;
                Strike(in s, inside.owner, inside, p, -dir, 0.3f, mult, dir, fxScale);
                first = inside.owner;
                struck.Add(first);
                if (pierceLeft <= 0)
                {
                    end = p;
                    stopped = true;
                }
                else
                {
                    pierceLeft--;
                    mult *= PierceKeep;
                }
            }
            for (int i = 0; i < n && !stopped; i++)
            {
                var h = hits[i];
                var c = h.collider;
                if (!c || c == self) continue;
                var hb = c.GetComponent<Hitbox>();
                var target = hb ? hb.owner : c.GetComponentInParent<Damageable>();
                if (target && struck.Contains(target)) continue;
                end = h.point;
                if (!target)
                {
                    ShotFx.Instance?.Impact(h.point, h.normal, false, fxScale);
                    stopped = true;
                    break;
                }
                if (target.Dead)
                {
                    stopped = true;
                    break;
                }
                // 身体胶囊往往把头 / 弱点包在里面：射线先进胶囊，1.5 m 内穿过同一单位的弱点就按弱点算
                if (hb && !hb.weakpoint)
                {
                    int j = WeakpointRule.FindWeakpoint(hits, n, i, target);
                    if (j >= 0)
                    {
                        h = hits[j];
                        hb = h.collider.GetComponent<Hitbox>();
                        end = h.point;
                    }
                }
                Strike(in s, target, hb, h.point, h.normal, h.distance, mult, dir, fxScale);
                first ??= target;
                struck.Add(target);
                if (pierceLeft <= 0 || struck.Count >= MaxPierceHits)
                {
                    stopped = true;
                    break;
                }
                pierceLeft--;
                mult *= PierceKeep;
            }
            if (!stopped) end = origin + dir * range;
            if (tracer.a > 0)
            {
                ShotFx.Instance?.Tracer(muzzle, end, tracer, tracerWidth);
                if (s.full) ShotFx.Instance?.Tracer(muzzle, end, FullChargeColor, tracerWidth * 1.8f);
            }
            return first;
        }

        /// <summary>结算打中一个单位：衰减 × 命中盒倍率 × 穿透衰减；满蓄引爆它身上的元素状态（只入队，同 TS）</summary>
        void Strike(in ShotContext s, Damageable target, Hitbox hb, Vector3 point, Vector3 normal, float dist, float mult, Vector3 dir, float fxScale)
        {
            var def = s.Def;
            // 出生中 / 遁地中（还露在外面时）：子弹停在身上，结算出「免疫」字样，让玩家知道不是没打中
            var info = HitInfo(in s, s.damage * mult * def.Falloff(dist) * (hb ? hb.multiplier : 1f), point, dir);
            info.weakpoint = hb && hb.weakpoint;
            var res = Combat.DamageEnemy(target, info);
            if (s.detonate && !res.immune && !res.killed && !target.Dead)
                Combat.Detonate(target, new DetonateOpts { power = Mathf.Min(res.total, target.maxHealth * 0.5f), weaponUid = s.weapon?.uid ?? 0, point = point });
            ShotFx.Instance?.Impact(point, normal, !target.untargetable, fxScale);
        }

        // ───────────── 投射物 ─────────────

        /// <summary>
        /// 发射一枚投射物：射向准星落点（射线找落点，最远 <see cref="ProjectileAimMax"/>），有重力时按飞行时间解抛物线（准星指哪儿落哪儿）。
        /// fan &gt; 0 时在该方向附近随机散开并略微上抬（蜂群）；yaw 为绕竖直轴的固定偏航（弧度，固定扇形）；
        /// shareAim = 复用上一次调用的散布方向与落点（同一轮固定扇形的第 2 枚起）。爆炸半径 / 弹速 / 穿透用实际数值
        /// </summary>
        public PlayerProjectile Projectile(in ShotContext s, Vector3 origin, Vector3 dir, Vector3 muzzle, float fan = 0, float yaw = 0, bool shareAim = false)
        {
            var def = s.Def;
            var spec = def.projectile;
            if (spec == null) return null;
            float dist;
            Vector3 aimPoint;
            if (shareAim)
            {
                dir = volleyDir;
                aimPoint = volleyTarget;
                dist = volleyDist;
            }
            else
            {
                dist = Mathf.Min(ProjectileAimMax, def.range);
                int n = SortedHits(origin, dir, dist);
                for (int i = 0; i < n; i++)
                {
                    if (hits[i].collider == self) continue;
                    dist = hits[i].distance;
                    break;
                }
                aimPoint = origin + dir * dist;
                volleyDir = dir;
                volleyTarget = aimPoint;
                volleyDist = dist;
            }
            // 准星落点贴脸、或枪口被墙挡住（贴墙）：从眼前发射，免得穿墙 / 越过目标（同 TS POINT_BLANK）
            bool fromEye = dist < PointBlankRange || Physics.Linecast(origin, muzzle, Layers.WorldMask, QueryTriggerInteraction.Ignore);
            var spawn = fromEye ? origin + dir * 0.15f : muzzle;
            float speed = s.stats != null && s.stats.projectileSpeed > 0 ? s.stats.projectileSpeed : spec.speed;
            Vector3 vel;
            if (spec.gravity > 0 && fan <= 0 && yaw == 0)
            {
                float t = Mathf.Max(0.05f, Vector3.Distance(spawn, aimPoint) / speed);
                vel = EnemyProjectile.Ballistic(spawn, aimPoint, t, spec.gravity);
            }
            else
            {
                var to = aimPoint - spawn;
                var heading = dist < 2.5f || to.sqrMagnitude < 0.25f ? dir : to.normalized;
                if (yaw != 0) heading = Quaternion.AngleAxis(yaw * Mathf.Rad2Deg, Vector3.up) * heading;
                if (fan > 0)
                {
                    heading = ScatterAround(heading, fan);
                    heading.y += fan * 0.6f;
                    heading.Normalize();
                }
                vel = heading * speed;
            }
            var info = HitInfo(in s, s.damage, spawn, dir);
            float blast = s.stats != null ? s.stats.explosionRadius : spec.explosionRadius;
            var ps = new PlayerProjectileSpec(spawn, vel, info, spec.radius, spec.lifetime)
            {
                gravity = spec.gravity, explosionRadius = blast, bounces = spec.bounces, rollAfter = spec.rollAfter,
                explodeOnExpire = spec.explodeOnExpire, homing = spec.homing, pierce = s.pierce,
                visual = spec.visual, color = spec.color, scale = spec.scale,
            };
            if (blast > 0)
            {
                bool fire = info.element == Element.Fire;
                var color = spec.color;
                ps.onImpact = point =>
                {
                    ShotFx.Instance?.Impact(point, Vector3.up, fire, blast * 2.2f);
                    ShotFx.Instance?.MuzzleFlash(point + Vector3.up * 0.4f, blast * 1.3f);
                    Telegraph.Wave(point + Vector3.up * 0.05f, blast, 20f, color);
                };
            }
            return PlayerProjectile.Spawn(in ps);
        }

        // ───────────── 光束 ─────────────

        /// <summary>光束一跳：命中扫描（不穿透、不画曳光）→ 伤害 + 元素几率；打中敌人时向 chainRange 米内最近的 1 个敌人弹射（伤害 × chainFraction）</summary>
        public Damageable BeamTick(in ShotContext s, Vector3 origin, Vector3 dir, Vector3 muzzle, out Vector3 end)
        {
            var one = s;
            one.pierce = 0;
            var target = Hitscan(in one, origin, dir, muzzle, 0.45f, Color.clear, 0, out end);
            var def = s.Def;
            if (!target || def.chainFraction <= 0) return target;
            ReactionSystem.Nearest(end, def.chainRange, 1, target, true, chain);
            foreach (var o in chain)
            {
                var oc = ReactionSystem.CenterOf(o);
                Lightning.Spawn(end, oc, DamageTable.ElementColor(s.element));
                var info = HitInfo(in s, s.damage * def.chainFraction, oc, (oc - end).normalized);
                info.depth = 1;
                info.tags |= DamageTag.Chain;
                Combat.DamageEnemy(o, info);
            }
            chain.Clear();
            return target;
        }
    }

    /// <summary>
    /// 光束的绘制（雷弧发射器）：每跳 <see cref="Hold"/> 刷新落点与持续时间，<see cref="Draw"/> 在 LateUpdate 从枪口画一条抖动的电弧
    /// （起点细、远端粗：枪口那头离相机很近，透视会把它放大成一大片）
    /// </summary>
    public sealed class BeamLine
    {
        LineRenderer line;
        Vector3 end;
        float until;

        public bool On => Time.time < until;

        public void Hold(Vector3 at, float seconds)
        {
            end = at;
            until = Time.time + seconds;
        }

        public void Stop() => until = 0;

        public void Draw(Vector3 from, Color c)
        {
            if (!On)
            {
                if (line) line.enabled = false;
                return;
            }
            if (!line)
            {
                var go = new GameObject("Beam");
                line = go.AddComponent<LineRenderer>();
                line.positionCount = 8;
                line.sharedMaterial = FxMaterials.Additive;
                line.widthCurve = new AnimationCurve(new Keyframe(0, 0.012f), new Keyframe(0.25f, 0.035f), new Keyframe(1, 0.07f));
                line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }
            line.enabled = true;
            float flicker = 0.75f + Random.value * 0.25f;
            line.startColor = new Color(c.r, c.g, c.b, 0.55f * flicker);
            line.endColor = new Color(Mathf.Lerp(c.r, 1, 0.3f), Mathf.Lerp(c.g, 1, 0.3f), 1f, 0.9f * flicker);
            var d = end - from;
            var side = Vector3.Cross(d, Vector3.up).normalized;
            var up = Vector3.Cross(side, d).normalized;
            for (int i = 0; i < 8; i++)
            {
                float t = i / 7f;
                float k = Mathf.Sin(t * Mathf.PI) * 0.12f;
                line.SetPosition(i, Vector3.Lerp(from, end, t) + side * Random.Range(-k, k) + up * Random.Range(-k, k));
            }
        }

        public void Hide()
        {
            until = 0;
            if (line) line.enabled = false;
        }

        public void Destroy()
        {
            if (line) Object.Destroy(line.gameObject);
            line = null;
        }
    }
}
