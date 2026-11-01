using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 迅捷精英挥出的前行龙卷：锁定方向直线推进，碰到玩家只结算一次，撞墙或寿命结束即散开。
    /// 风体、断笔风纹、云顶与尘裙由 <see cref="EliteTornadoVisual"/> 分层绘制；玩法不依赖像素贴图或粒子序列。
    /// </summary>
    public sealed class EliteTornado : MonoBehaviour
    {
        public const float Windup = 0.85f, Range = 20f, Speed = 8f, Radius = 1.35f, Height = 5.8f, BaseDamage = 18f;
        public const float CooldownMin = 7.5f, CooldownMax = 10.5f;

        EnemyAI source;
        Vector3 direction;
        float damage, life, age;
        bool spent, nearRumble;
        EliteTornadoVisual look;

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
            t.look = EliteTornadoVisual.Create(ground, Height, 1.65f, go.transform);
            t.look.transform.localScale = Vector3.one * 0.45f;
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
            age += dt;
            if (look) look.transform.localScale = Vector3.one * Mathf.Lerp(0.45f, 1f, 1f - Mathf.Exp(-age * 13f));

            var from = transform.position;
            var step = direction * (Speed * dt);
            var to = from + step;
            if (!Combat.LineClear(from + Vector3.up * 1.1f, to + Vector3.up * 1.1f, 0.05f))
            {
                Fx.Burst(from + Vector3.up * 0.7f, Hex.Rgb(0x58a6b3), 7, 3.5f, 0.35f, 0.16f);
                End();
                return;
            }
            to.y = GroundAt(to, from.y);
            transform.position = to;

            var player = PlayerVitals.Instance;
            if (!player || player.Dead) return;
            float playerDistance = Vector3.Distance(player.transform.position, to);
            if (!nearRumble && playerDistance < 6f)
            {
                nearRumble = true;
                CameraShake.Quake(to, 0.08f, 7f, 0.22f);
            }
            if (spent) return;
            var motor = player.GetComponent<Spiritfire.Art.PlayerMotor>();
            var cc = player.GetComponent<CharacterController>();
            float playerRadius = cc ? cc.radius : 0.35f;
            if (!SweepOverlaps(from, to, player.transform.position, playerRadius)) return;

            spent = true;
            float dealt = Combat.DamagePlayer(damage, to + Vector3.up, Element.None, source);
            if (dealt <= 0) return;
            PlayerHits++;
            if (motor)
            {
                var side = Vector3.Cross(Vector3.up, direction);
                motor.AddImpulse(direction * 3.5f + side * 2.2f + Vector3.up * 6.2f);
            }
            CameraShake.Quake(to, 0.32f, 9f, 0.28f);
            Fx.Ring(to + Vector3.up * 0.08f, Radius * 1.5f, Hex.Rgb(0xc6e7dc), 0.28f, false);
            Fx.Burst(player.transform.position + Vector3.up, Hex.Rgb(0xc6e7dc), 10, 5f, 0.35f, 0.13f);
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
                look.FadeOut(0.35f);
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
