using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌人弹丸（弩箭、火球）：逐帧推进 + 重力，扫掠检测地形 / 建筑；与玩家胶囊做球-胶囊距离判定（比物理触发器稳定，不漏判）。
    /// explodeRadius &gt; 0 时落地 / 命中后爆炸（范围伤害 + 地面火光），否则只打直接命中。
    /// spirit = 被嘲讽的敌人射出的（对着灵体诱饵打）：不伤玩家，穿过诱饵胶囊时被吸收；没被嘲讽的弹丸直接穿过灵体。
    /// </summary>
    public sealed class EnemyProjectile : MonoBehaviour
    {
        Vector3 velocity;
        float gravity, damage, radius, explodeRadius, life;
        Element element;
        bool fake, spirit;
        TrailRenderer trail;
        Light glow;

        public static EnemyProjectile Spawn(Vector3 pos, Vector3 velocity, float gravity, float damage, float radius, float explodeRadius,
            Color color, float lifetime = 4f, Element element = Element.None, bool fake = false, bool spirit = false)
        {
            // 外观：发白的热核（不透明小球）+ 朝向相机的加色光晕 + 加色拖尾（顶点色）
            var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            Destroy(go.GetComponent<Collider>());
            go.name = "Enemy Projectile";
            go.transform.position = pos;
            go.transform.localScale = Vector3.one * radius * 1.3f;
            var r = go.GetComponent<Renderer>();
            r.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(r, Color.Lerp(color, Color.white, 0.45f) * 1.4f);
            var p = go.AddComponent<EnemyProjectile>();
            p.velocity = velocity;
            p.gravity = gravity;
            p.damage = damage;
            p.radius = radius;
            p.explodeRadius = explodeRadius;
            p.life = lifetime;
            p.element = element;
            p.fake = fake;
            p.spirit = spirit;

            FxMaterials.GlowSprite(go.transform, explodeRadius > 0 ? 3.6f : 2.4f, new Color(color.r, color.g, color.b, 0.85f));

            p.trail = go.AddComponent<TrailRenderer>();
            p.trail.time = explodeRadius > 0 ? 0.28f : 0.18f;
            p.trail.startWidth = radius * 1.8f;
            p.trail.endWidth = 0;
            p.trail.sharedMaterial = FxMaterials.Additive;
            p.trail.startColor = new Color(color.r, color.g, color.b, 0.9f);
            p.trail.endColor = new Color(color.r * 0.6f, color.g * 0.3f, color.b * 0.2f, 0);
            p.trail.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            if (explodeRadius > 0)
            {
                p.glow = go.AddComponent<Light>();
                p.glow.type = LightType.Point;
                p.glow.color = color;
                p.glow.range = 4;
                p.glow.intensity = 2;
            }
            return p;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            life -= dt;
            velocity.y -= gravity * dt;
            var from = transform.position;
            var step = velocity * dt;
            float len = step.magnitude;

            // 灵体诱饵（被嘲讽的敌人对着它打）：穿过它的胶囊就被吸收；被嘲讽时射出的弹丸不伤玩家
            if (spirit)
                foreach (var d in Decoys.Active())
                {
                    var p0 = d.t.position + Vector3.up * 0.1f;
                    if (SegmentSegmentDistance(from, from + step, p0, p0 + Vector3.up * Mathf.Max(0.1f, d.height - 0.1f)) < radius + d.radius)
                    {
                        EnemyAI.DecoyBlocked(d.t);
                        fake = true;
                        Impact(from + step * 0.5f, false);
                        return;
                    }
                }
            // 玩家：线段（本帧移动）到玩家胶囊轴线的最近距离
            var pv = PlayerVitals.Instance;
            if (!spirit && pv && !pv.Dead)
            {
                var a = pv.transform.position + Vector3.up * 0.35f;
                var b = pv.transform.position + Vector3.up * 1.45f;
                if (SegmentSegmentDistance(from, from + step, a, b) < radius + 0.35f)
                {
                    Impact(from + step * 0.5f, true);
                    return;
                }
            }
            if (len > 1e-5f && Physics.SphereCast(from, radius * 0.5f, step / len, out var hit, len, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                Impact(hit.point, false);
                return;
            }
            transform.position = from + step;
            if (life <= 0) Impact(transform.position, false);
        }

        /// <summary>
        /// 抛物线初速度：从 from 经 flightTime 秒落到 to（重力 gravity），水平匀速、竖直按落差补偿
        /// </summary>
        public static Vector3 Ballistic(Vector3 from, Vector3 to, float flightTime, float gravity)
        {
            var d = to - from;
            var flat = new Vector3(d.x, 0, d.z) / flightTime;
            flat.y = (d.y + 0.5f * gravity * flightTime * flightTime) / flightTime;
            return flat;
        }

        void Impact(Vector3 at, bool hitPlayer)
        {
            if (fake)
            {
                // 蜃景火球：落地只是一阵冷光，没有伤害
                ShotFx.Instance?.Impact(at, Vector3.up, false, 1.5f);
                Destroy(gameObject);
                return;
            }
            if (explodeRadius > 0)
            {
                var info = DamageInfo.Simple(0, DamageSource.Enemy, at, velocity.normalized);
                info.element = element;
                Combat.Explode(at, explodeRadius, info, false, spirit ? 0 : damage);
                ShotFx.Instance?.Impact(at, Vector3.up, false, 3f);
                ShotFx.Instance?.Impact(at, Vector3.up, true, 3f);
            }
            else
            {
                if (hitPlayer && !spirit) Combat.DamagePlayer(damage, at - velocity.normalized, element);
                ShotFx.Instance?.Impact(at, -velocity.normalized, false, 0.8f);
            }
            Destroy(gameObject);
        }

        static float SegmentSegmentDistance(Vector3 p1, Vector3 q1, Vector3 p2, Vector3 q2)
        {
            var d1 = q1 - p1;
            var d2 = q2 - p2;
            var r = p1 - p2;
            float a = Vector3.Dot(d1, d1), e = Vector3.Dot(d2, d2), f = Vector3.Dot(d2, r);
            float s, t;
            if (a <= 1e-6f && e <= 1e-6f) return r.magnitude;
            if (a <= 1e-6f)
            {
                s = 0;
                t = Mathf.Clamp01(f / e);
            }
            else
            {
                float c = Vector3.Dot(d1, r);
                if (e <= 1e-6f)
                {
                    t = 0;
                    s = Mathf.Clamp01(-c / a);
                }
                else
                {
                    float b = Vector3.Dot(d1, d2), denom = a * e - b * b;
                    s = denom != 0 ? Mathf.Clamp01((b * f - c * e) / denom) : 0;
                    t = (b * s + f) / e;
                    if (t < 0) { t = 0; s = Mathf.Clamp01(-c / a); }
                    else if (t > 1) { t = 1; s = Mathf.Clamp01((b - c) / a); }
                }
            }
            return ((p1 + d1 * s) - (p2 + d2 * t)).magnitude;
        }
    }
}
