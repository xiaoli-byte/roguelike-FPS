using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 地面火焰区（镇墓兽冲锋犁出的日火裂痕、火浣鼠的余火）：圆形区域，持续 duration 秒，
    /// 每 tick 秒对站在里面（贴地）的玩家结算一次火伤；视觉是贴地的火色圆 + 零星火星。
    /// </summary>
    public sealed class FireZone : MonoBehaviour
    {
        float radius, damage, tick, life, timer;

        static readonly Color Fire = new(1f, 0.45f, 0.12f);

        public static void Spawn(Vector3 center, float radius, float duration, float damagePerTick, float tick = 0.5f)
        {
            var go = new GameObject("Fire Zone");
            go.transform.position = center;
            var z = go.AddComponent<FireZone>();
            z.radius = radius;
            z.damage = damagePerTick;
            z.tick = tick;
            z.life = duration;
            z.timer = tick * 0.5f;
            Telegraph.Circle(center, radius, duration, Fire);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            life -= dt;
            if (life <= 0)
            {
                Destroy(gameObject);
                return;
            }
            if (Random.value < dt * 10f)
            {
                var c = Random.insideUnitCircle * radius * 0.8f;
                ShotFx.Instance?.Impact(transform.position + new Vector3(c.x, 0.05f, c.y), Vector3.up, true, 0.5f);
            }
            timer -= dt;
            if (timer > 0) return;
            timer += tick;
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var to = pv.transform.position - transform.position;
            if (Mathf.Abs(to.y) > 1.2f) return;
            to.y = 0;
            if (to.magnitude <= radius + 0.35f) Combat.DamagePlayer(damage, transform.position, Element.Fire);
        }
    }
}
