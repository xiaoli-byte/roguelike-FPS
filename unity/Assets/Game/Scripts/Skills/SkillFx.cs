using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>冲击波参数（Three.js skills/common.ts 的 ShockwaveOptions）</summary>
    public struct ShockwaveOptions
    {
        /// <summary>最终半径（已乘范围倍率）</summary>
        public float radius;
        /// <summary>中心伤害（技能来源）；0 = 只击退不伤害</summary>
        public float damage;
        public Element element;
        public float elementChance;
        /// <summary>中心处的水平击退速度（m/s，边缘减半）</summary>
        public float knockback;
        /// <summary>中心处的上抛速度（m/s）：敌人还没有上抛接口，先记着（HC2 / E1）</summary>
        public float lift;
        /// <summary>眩晕秒数（0 = 不眩晕）</summary>
        public float stun;
        /// <summary>边缘伤害比例（缺省 0.45）</summary>
        public float falloff;
        public Color color, secondaryColor;
        /// <summary>地面裂纹</summary>
        public bool crack;

        public ShockwaveOptions(float radius, float damage, Color color)
        {
            this.radius = radius;
            this.damage = damage;
            this.color = secondaryColor = color;
            element = Element.None;
            elementChance = 0;
            knockback = lift = stun = 0;
            falloff = 0.45f;
            crack = false;
        }
    }

    /// <summary>
    /// 技能工具包（Three.js skills/common.ts 的对应物）：出手点 / 投掷速度、范围倍率、敌人查询与选目标、冲击波、地面裂纹、彩色粒子爆散、扩散环。
    /// 三位英雄共用；特效先用运行时生成的材质与粒子（F1 / FX 单元的预设落地后只换这里的实现）。
    /// 敌人查询走 <see cref="Enemies"/>：E1 的 EnemyRegistry 落地前遍历 <see cref="EnemyAI.All"/>（与投射物选目标同一来源）。
    /// </summary>
    public static class SkillFx
    {
        /// <summary>技能配色（Three.js SKILL_COLORS）</summary>
        public static readonly Color Fire = Hex.Rgb(0xff6a1f), FireCore = Hex.Rgb(0xffd27a), Ember = Hex.Rgb(0xff9a3c),
            Shock = Hex.Rgb(0x6fd8ff), ShockCore = Hex.Rgb(0xe8fbff), Earth = Hex.Rgb(0xc9a36b), Gold = Hex.Rgb(0xffc861), Dust = Hex.Rgb(0x9c8466);

        // ───────────── 出手 ─────────────

        /// <summary>
        /// 第一人称「手部」出手点：眼前略偏右下（side = 1 右手 / −1 左手）。从眼睛往那个点扫一个半径 radius 的球，
        /// 半路碰到墙就停在墙前——贴墙出手时投射物不会生在墙里（以前直接在墙里生成，手雷当场炸在自己脸上或者穿墙）。
        /// </summary>
        public static Vector3 SafeHandOrigin(Transform eye, float side = 1, float radius = 0.2f)
        {
            if (!eye) return Vector3.zero;
            var from = eye.position;
            var want = from + eye.right * (0.24f * side) - eye.up * 0.2f + eye.forward * 0.45f;
            var d = want - from;
            float len = d.magnitude;
            if (len < 1e-4f) return from;
            float r = Mathf.Clamp(radius, 0.02f, 0.3f);
            if (Physics.SphereCast(from, r, d / len, out var hit, len, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                return from + d / len * Mathf.Max(0, hit.distance - 0.02f);
            return want;
        }

        /// <summary>投掷速度：沿准星 speed，额外上抛 lift，并继承 35% 的玩家水平速度（边跑边扔不会砸到自己脚下，Three.js throwVelocity）</summary>
        public static Vector3 ThrowVelocity(HeroSkills owner, float speed, float lift)
        {
            var eye = owner ? owner.Eye : null;
            var v = (eye ? eye.forward : Vector3.forward) * speed + Vector3.up * lift;
            if (owner && owner.Motor)
            {
                var pv = owner.Motor.Velocity;
                v.x += pv.x * 0.35f;
                v.z += pv.z * 0.35f;
            }
            return v;
        }

        /// <summary>范围类技能的半径倍率（属性「爆炸范围」）</summary>
        public static float RadiusScale(HeroSkills owner)
        {
            var stats = owner ? owner.Stats : Combat.playerStats;
            return stats != null ? stats.Mult(Stat.ExplosionRadiusPct) : 1f;
        }

        /// <summary>技能伤害请求（来源 = 技能，吃「技能伤害」）</summary>
        public static DamageInfo SkillHit(float amount, Element element, float statusChance)
        {
            var info = DamageInfo.Simple(amount, DamageSource.Skill, Vector3.zero, Vector3.zero);
            info.tags = DamageTag.Skill;
            info.element = element;
            info.statusChance = statusChance;
            return info;
        }

        // ───────────── 敌人查询 ─────────────

        /// <summary>
        /// center 周围 radius 内（到碰撞体表面）活着、可选中的敌人，写进 into（先清空）。needLos = 要求 center 到身体中心没有地形遮挡。
        /// TODO(E1)：EnemyRegistry 落地后改走它的空间查询。
        /// </summary>
        public static List<Damageable> Enemies(Vector3 center, float radius, List<Damageable> into, bool needLos = false)
        {
            into.Clear();
            var all = EnemyAI.All;
            for (int i = 0; i < all.Count; i++)
            {
                var ai = all[i];
                if (!ai || ai.Dead) continue;
                var d = ai.Health;
                if (!d || d.Dead || d.untargetable) continue;
                var col = d.GetComponent<Collider>();
                var closest = col && col.enabled ? col.ClosestPoint(center) : d.transform.position;
                if ((closest - center).sqrMagnitude > radius * radius) continue;
                if (needLos && Combat.Blocked(center, ProjectileTargeting.Center(d), col)) continue;
                into.Add(d);
            }
            return into;
        }

        /// <summary>
        /// 前方 range 内挑一个目标（越正对、越近越好；被墙挡住的扣分；penalty 让多发分散到不同目标）。
        /// TODO(E1)：EnemyRegistry 落地后由 PlayerProjectile.PickTarget 一并改走它。
        /// </summary>
        public static Damageable PickTarget(Vector3 from, Vector3 forward, float range, System.Func<Damageable, float> penalty = null) =>
            PlayerProjectile.PickTarget(from, forward, range, penalty);

        /// <summary>爆心能不能波及敌人：到身体中心或头顶附近任一点没有地形遮挡（同爆炸的判定）</summary>
        public static bool Exposed(Damageable d, Vector3 center)
        {
            var col = d.GetComponent<Collider>();
            var body = ProjectileTargeting.Center(d);
            if (Combat.LineClear(center, body)) return true;
            var head = col && col.enabled ? new Vector3(body.x, col.bounds.max.y - 0.2f, body.z) : body + Vector3.up * 0.6f;
            return Combat.LineClear(center, head);
        }

        // ───────────── 冲击波 ─────────────

        static readonly List<Damageable> waveTargets = new();

        /// <summary>
        /// 以脚底点 feet 为圆心的冲击波（Three.js shockwave）：范围伤害（技能来源，不加爆炸标签——这是砸地不是爆炸）+ 向外击退 + 可选眩晕 + 地面冲击环。
        /// 伤害按到敌人竖直胶囊表面的距离从中心 100% 衰减到边缘 falloff；被墙挡住（身体和头都看不见）的不受影响。击退 / 眩晕每个敌人只一次。
        /// 返回造成了伤害的敌人数。
        /// </summary>
        public static int Shockwave(Vector3 feet, in ShockwaveOptions o)
        {
            if (!(o.radius > 0) || !float.IsFinite(o.radius) || !float.IsFinite(feet.x + feet.y + feet.z)) return 0;
            float R = o.radius, falloff = Mathf.Clamp01(o.falloff);
            var wave = feet + Vector3.up * 0.9f;
            // 拷一份：伤害结算会同步派发事件，监听者可能嵌套查询
            var targets = new List<Damageable>(Enemies(wave, R, waveTargets));
            waveTargets.Clear();
            int hits = 0;
            foreach (var d in targets)
            {
                if (!d || d.Dead || d.untargetable || !Exposed(d, wave)) continue;
                var col = d.GetComponent<Collider>();
                var dir = d.transform.position - feet;
                dir.y = 0;
                if (dir.sqrMagnitude < 1e-6f)
                {
                    float a = Random.value * Mathf.PI * 2;
                    dir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                }
                else dir.Normalize();
                float surf = col && col.enabled ? Vector3.Distance(col.ClosestPoint(wave), wave) : Vector3.Distance(d.transform.position, feet);
                float t = Mathf.Clamp01(surf / R);
                if (o.damage > 0)
                {
                    var info = SkillHit(o.damage * (1 - (1 - falloff) * t), o.element, o.elementChance);
                    info.point = col && col.enabled ? new Vector3(col.bounds.center.x, col.bounds.max.y, col.bounds.center.z) : d.transform.position + Vector3.up;
                    info.direction = new Vector3(dir.x, 0.35f, dir.z).normalized;
                    info.knockback = 0;
                    if (Combat.DamageEnemy(d, info).total > 0) hits++;
                }
                if (d.Dead) continue;
                float k = 1 - 0.5f * t;
                if (o.knockback > 0)
                {
                    var ai = d.GetComponent<EnemyAI>();
                    if (ai) ai.Knockback(dir * (o.knockback * k));
                }
                // TODO(HC2 / E1)：o.lift × k 的上抛（敌人击飞）等 EnemyAI 有离地接口后接上
                if (o.stun > 0) EnemyStatus.Stun(d, o.stun);
            }

            // 特效：两道扩散环 + 尘土 + 副色火星 + 可选裂纹
            var sec = o.secondaryColor.a > 0 ? o.secondaryColor : o.color;
            Ring(feet, R, o.color, 0.45f);
            Ring(feet, R * 0.55f, sec, 0.3f);
            Burst(feet + Vector3.up * 0.3f, Dust, 28, R * 1.1f, 0.7f, 0.14f, 0.3f);
            Burst(feet + Vector3.up * 0.3f, sec, 14, R * 1.4f, 0.4f, 0.06f, 0.2f);
            if (o.crack) GroundCrack(feet, R * 0.8f, sec, 1.6f);
            return hits;
        }

        // ───────────── 特效原语 ─────────────

        /// <summary>贴地扩散环：seconds 秒内从 0 扩到 radius（Telegraph.Wave）</summary>
        public static void Ring(Vector3 feet, float radius, Color color, float seconds = 0.45f)
        {
            if (!(radius > 0)) return;
            Telegraph.Wave(feet + Vector3.up * 0.05f, radius, radius / Mathf.Max(0.05f, seconds), color);
        }

        static ParticleSystem burst;

        /// <summary>
        /// 彩色粒子爆散（Three.js fx.burst）：count 颗，初速 ≤ speed（向上偏一点），寿命 life，大小 size；rise &gt; 0 往上飘的成分更多（火星），&lt; 0 往下落（碎石）
        /// </summary>
        public static void Burst(Vector3 at, Color color, int count, float speed, float life, float size, float rise = 0)
        {
            if (count <= 0 || !float.IsFinite(at.x + at.y + at.z)) return;
            var ps = BurstSystem();
            for (int i = 0; i < count; i++)
            {
                var v = Random.insideUnitSphere * speed;
                v.y += speed * 0.25f * (1 + rise);
                var e = new ParticleSystem.EmitParams
                {
                    position = at, velocity = v, startColor = color, startSize = size * Random.Range(0.6f, 1.2f),
                    startLifetime = life * Random.Range(0.6f, 1f), applyShapeToPosition = false,
                };
                ps.Emit(e, 1);
            }
        }

        static ParticleSystem BurstSystem()
        {
            if (burst) return burst;
            var go = new GameObject("Skill Bursts");
            Object.DontDestroyOnLoad(go);
            burst = go.AddComponent<ParticleSystem>();
            burst.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = burst.main;
            main.loop = false;
            main.playOnAwake = false;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.gravityModifier = 0.6f;
            main.maxParticles = 1500;
            var em = burst.emission;
            em.enabled = false;
            var shape = burst.shape;
            shape.enabled = false;
            var col = burst.colorOverLifetime;
            col.enabled = true;
            var g = new Gradient();
            g.SetKeys(new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) },
                new[] { new GradientAlphaKey(1, 0), new GradientAlphaKey(0, 1) });
            col.color = g;
            var drag = burst.limitVelocityOverLifetime;
            drag.enabled = true;
            drag.limit = 0.5f;
            drag.dampen = 0.08f;
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.sharedMaterial = FxMaterials.Glow;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            return burst;
        }

        static Mesh crackMesh;

        /// <summary>地面发光裂纹（Three.js spawnGroundCrack）：贴着 center 下方的地面，duration 秒内迅速张开、后半段淡出</summary>
        public static void GroundCrack(Vector3 center, float radius, Color color, float duration = 1.6f)
        {
            if (!(radius > 0)) return;
            var pos = center;
            var normal = Vector3.up;
            if (Physics.Raycast(center + Vector3.up * 0.35f, Vector3.down, out var hit, 3f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                pos = hit.point;
                normal = hit.normal;
            }
            var go = new GameObject("Ground Crack");
            go.transform.SetPositionAndRotation(pos + normal * 0.03f,
                Quaternion.FromToRotation(Vector3.up, normal) * Quaternion.Euler(0, Random.value * 360f, 0));
            go.AddComponent<MeshFilter>().sharedMesh = CrackMesh();
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = FxMaterials.Additive;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            mr.receiveShadows = false;
            go.AddComponent<GroundCrackFx>().Init(radius, color, duration);
        }

        /// <summary>放射状裂纹（XZ 平面、半径约 1）：13 道主裂纹 + 六成概率的分叉 + 中心凹坑（同 Three.js getCrackGeometry，只生成一次）</summary>
        static Mesh CrackMesh()
        {
            if (crackMesh) return crackMesh;
            var rng = new System.Random(7);
            float R() => (float)rng.NextDouble();
            var v = new List<Vector3>();
            void Tri(Vector3 a, Vector3 b, Vector3 c)
            {
                v.Add(a);
                v.Add(b);
                v.Add(c);
            }
            const int spikes = 13;
            for (int i = 0; i < spikes; i++)
            {
                float a = i / (float)spikes * Mathf.PI * 2 + (R() - 0.5f) * 0.35f;
                float len = 0.55f + R() * 0.45f, w = 0.05f + R() * 0.05f, r0 = 0.14f;
                Tri(new Vector3(Mathf.Cos(a - w) * r0, 0, Mathf.Sin(a - w) * r0), new Vector3(Mathf.Cos(a) * len, 0, Mathf.Sin(a) * len),
                    new Vector3(Mathf.Cos(a + w) * r0, 0, Mathf.Sin(a + w) * r0));
                if (R() < 0.6f)
                {
                    float mid = len * (0.45f + R() * 0.2f);
                    float ba = a + (R() < 0.5f ? -1 : 1) * (0.3f + R() * 0.3f), bl = mid + len * 0.35f;
                    float mx = Mathf.Cos(a) * mid, mz = Mathf.Sin(a) * mid;
                    Tri(new Vector3(mx - Mathf.Sin(a) * 0.025f, 0, mz + Mathf.Cos(a) * 0.025f), new Vector3(Mathf.Cos(ba) * bl, 0, Mathf.Sin(ba) * bl),
                        new Vector3(mx + Mathf.Sin(a) * 0.025f, 0, mz - Mathf.Cos(a) * 0.025f));
                }
            }
            const int seg = 12;
            for (int i = 0; i < seg; i++)
            {
                float a0 = i / (float)seg * Mathf.PI * 2, a1 = (i + 1) / (float)seg * Mathf.PI * 2;
                Tri(Vector3.zero, new Vector3(Mathf.Cos(a1) * 0.2f, 0, Mathf.Sin(a1) * 0.2f), new Vector3(Mathf.Cos(a0) * 0.2f, 0, Mathf.Sin(a0) * 0.2f));
            }
            var idx = new int[v.Count];
            for (int i = 0; i < idx.Length; i++) idx[i] = i;
            crackMesh = new Mesh { name = "Ground Crack" };
            crackMesh.SetVertices(v);
            crackMesh.SetTriangles(idx, 0);
            crackMesh.RecalculateNormals();
            crackMesh.RecalculateBounds();
            return crackMesh;
        }

        /// <summary>裂纹的生长与淡出（结束时自毁）</summary>
        sealed class GroundCrackFx : MonoBehaviour
        {
            float radius, duration, t;
            Color color;
            Renderer r;
            MaterialPropertyBlock block;

            public void Init(float radius, Color color, float duration)
            {
                this.radius = radius;
                this.color = color;
                this.duration = Mathf.Max(0.1f, duration);
                r = GetComponent<Renderer>();
                block = new MaterialPropertyBlock();
                Apply(0);
            }

            void Update()
            {
                t += Time.deltaTime / duration;
                if (t >= 1)
                {
                    Destroy(gameObject);
                    return;
                }
                Apply(t);
            }

            void Apply(float k)
            {
                float grow = 1 - Mathf.Pow(1 - Mathf.Min(1, k * 6), 3);
                transform.localScale = Vector3.one * (radius * (0.3f + 0.7f * grow));
                float a = k < 0.5f ? 1 : 1 - (k - 0.5f) / 0.5f;
                block.SetColor("_BaseColor", new Color(color.r * 1.6f, color.g * 1.6f, color.b * 1.6f, a));
                r.SetPropertyBlock(block);
            }
        }
    }
}
