using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 迅捷精英挥出的前行龙卷：锁定方向直线推进，碰到玩家只结算一次，撞墙或寿命结束即散开。
    /// 主形复用手绘螺旋风带；脚下尘团与碎石按章节换色，不使用像素粒子或贴图序列。
    /// </summary>
    public sealed class EliteTornado : MonoBehaviour
    {
        public const float Windup = 0.85f, Range = 20f, Speed = 8f, Radius = 1.35f, Height = 4.2f, BaseDamage = 18f;
        public const float CooldownMin = 7.5f, CooldownMax = 10.5f;

        EnemyAI source;
        Vector3 direction;
        float damage, life, dustTimer;
        bool spent;
        FeilianSpiral look;

        public int PlayerHits { get; private set; }
        public Vector3 Direction => direction;
        public float Damage => damage;

        public static EliteTornado Spawn(EnemyAI source, Vector3 ground, Vector3 direction, float damage)
        {
            var go = new GameObject("Elite Tornado") { layer = Layers.IgnoreRaycast };
            if (source && source.gameObject.scene.IsValid()) UnityEngine.SceneManagement.SceneManager.MoveGameObjectToScene(go, source.gameObject.scene);
            go.transform.position = ground;
            var t = go.AddComponent<EliteTornado>();
            t.source = source;
            t.direction = Flat(direction).normalized;
            t.damage = damage;
            t.life = Range / Speed;
            t.look = FeilianSpiral.Create(ground, 0.32f, Radius, Height, 430f, go.transform, false, 0.58f);
            return t;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            life -= dt;
            if (life <= 0)
            {
                End();
                return;
            }

            var from = transform.position;
            var step = direction * (Speed * dt);
            var to = from + step;
            if (!Combat.LineClear(from + Vector3.up * 1.1f, to + Vector3.up * 1.1f, 0.05f))
            {
                Fx.Burst(from + Vector3.up * 0.7f, FeilianPalette.Wind, 7, 3.5f, 0.35f, 0.16f);
                End();
                return;
            }
            to.y = GroundAt(to, from.y);
            transform.position = to;

            dustTimer -= dt;
            if (dustTimer <= 0)
            {
                dustTimer = 0.14f;
                EmitDust(to);
            }

            var player = PlayerVitals.Instance;
            if (!spent && player && !player.Dead)
            {
                var motor = player.GetComponent<Spiritfire.Art.PlayerMotor>();
                var cc = player.GetComponent<CharacterController>();
                float playerRadius = cc ? cc.radius : 0.35f;
                if (SweepOverlaps(from, to, player.transform.position, playerRadius))
                {
                    spent = true;
                    float dealt = Combat.DamagePlayer(damage, to + Vector3.up, Element.None, source);
                    if (dealt > 0)
                    {
                        PlayerHits++;
                        if (motor)
                        {
                            var side = Vector3.Cross(Vector3.up, direction);
                            motor.AddImpulse(direction * 3.5f + side * 2.2f + Vector3.up * 6.2f);
                        }
                        Fx.Ring(to + Vector3.up * 0.08f, Radius * 1.5f, FeilianPalette.WindCore, 0.28f, false);
                        Fx.Burst(player.transform.position + Vector3.up, FeilianPalette.WindCore, 10, 5f, 0.35f, 0.13f);
                    }
                }
            }
        }

        void EmitDust(Vector3 at)
        {
            var dust = FxTone.Ground(Hex.Rgb(0xa08a6a));
            var side = Vector3.Cross(Vector3.up, direction);
            Fx.LdMany("ToonSmoke", 1, i =>
            {
                var offset = side * Random.Range(-0.65f, 0.65f) - direction * Random.Range(0.1f, 0.7f);
                return (at + offset + Vector3.up * 0.25f, offset * 2f + Vector3.up * 1.2f, Random.Range(0.75f, 1.1f), 0.55f);
            }, Fx.LdAlpha(dust, 0.78f));
            Fx.LdMany("Chunk", 2, i =>
            {
                var offset = side * (i == 0 ? -0.55f : 0.55f);
                return (at + offset + Vector3.up * 0.18f, offset * 3.2f + Vector3.up * Random.Range(2.2f, 3.8f), 0.11f, 0.65f);
            }, dust);
        }

        /// <summary>水平扫掠圆与玩家圆相交，并检查龙卷竖直范围；低帧率下跨过玩家也不会漏判。</summary>
        public static bool SweepOverlaps(Vector3 from, Vector3 to, Vector3 playerFeet, float playerRadius)
        {
            if (playerFeet.y > Mathf.Max(from.y, to.y) + Height || playerFeet.y + 1.8f < Mathf.Min(from.y, to.y) - 0.2f) return false;
            var a = new Vector2(from.x, from.z);
            var ab = new Vector2(to.x, to.z) - a;
            var ap = new Vector2(playerFeet.x, playerFeet.z) - a;
            float t = ab.sqrMagnitude > 1e-6f ? Mathf.Clamp01(Vector2.Dot(ap, ab) / ab.sqrMagnitude) : 0;
            float r = Radius + Mathf.Max(0, playerRadius);
            return (ap - ab * t).sqrMagnitude <= r * r;
        }

        static float GroundAt(Vector3 at, float fallback)
        {
            return Physics.Raycast(at + Vector3.up * 2.5f, Vector3.down, out var hit, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point.y : fallback;
        }

        static Vector3 Flat(Vector3 v)
        {
            v.y = 0;
            return v.sqrMagnitude > 1e-5f ? v : Vector3.forward;
        }

        public void Dissipate() => life = Mathf.Min(life, 0.15f);

        void End()
        {
            if (look)
            {
                look.transform.SetParent(null, true);
                look.FadeOut(0.3f);
                look = null;
            }
            Destroy(gameObject);
        }

        void OnDestroy()
        {
            if (look) Destroy(look.gameObject);
        }
    }
}
