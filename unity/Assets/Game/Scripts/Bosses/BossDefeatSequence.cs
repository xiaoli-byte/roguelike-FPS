using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 首领溃散演出（Three.js BossBase.onDeath + updateDeathFx）：倒下那一刻大爆炸、震屏、吼声，可选慢动作（<see cref="TimeScaleArbiter"/> 的 DeathSlowMo，
    /// 按真实时间撤销）；之后每 0.2 s 在身上炸一团，到 <see cref="BossDefeatDef.seconds"/> 的 88% 时最后一下大爆炸 + 地面冲击环，模型隐去。
    /// 首领倒下时由 <see cref="BossBrain"/> 挂到自己身上（行为组件那时已经停用）；物体由 EnemyBody 按 despawnAfter 回收。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BossDefeatSequence : MonoBehaviour
    {
        BossBrain boss;
        Color color;
        float t, acc, seconds, radius, height, slowUntil;
        TimeScaleArbiter.Handle slow;

        /// <summary>最后一下大爆炸已经放过（模型已隐去）</summary>
        public bool Finished { get; private set; }

        public void Begin(BossBrain b)
        {
            boss = b;
            var def = b.Def;
            var d = def != null ? def.defeat : new BossDefeatDef();
            seconds = Mathf.Max(0.2f, d.seconds);
            color = def != null ? def.color : new Color(1f, 0.55f, 0.25f);
            radius = Mathf.Max(0.5f, b.BodyRadius);
            var cap = b.GetComponent<CapsuleCollider>();
            height = cap ? Mathf.Max(1f, cap.height * Mathf.Abs(b.transform.lossyScale.y)) : 3f;
            var c = b.BodyCenter;
            SkillFx.Burst(c, color, 36, 9f, 1.1f, 0.5f, 3f);
            Combat.ExplosionShake(c, radius * 2.2f, 1.2f);
            CameraShake.Quake(b.transform.position, 0.8f, 80f, 1.1f);
            GameAudio.PlayAt("boss_roar", c, 1f, 0.7f);
            GameAudio.PlayAt("boss_slam", c, 1f, 1f);
            if (d.slowMo > 0 && d.slowMo < 1 && d.slowMoSeconds > 0)
            {
                slow = TimeScaleArbiter.Request(this, d.slowMo, TimeScaleArbiter.Priority.DeathSlowMo);
                slowUntil = Time.unscaledTime + d.slowMoSeconds;
            }
        }

        void Update()
        {
            if (slow != null && Time.unscaledTime >= slowUntil) ReleaseSlow();
            if (Finished || !boss) return;
            float dt = Time.deltaTime;
            t += dt;
            acc += dt;
            float end = seconds * 0.88f;
            // 炸点跟着模型走（鹏倒下时模型根从 13 m 高摔到冰面上、物体本身还停在半空：按物体位置炸会全浮在天上）
            var root = boss.Model?.root;
            var basePos = root ? root.transform.position : boss.transform.position;
            if (acc >= 0.2f && t < end)
            {
                acc = 0;
                float a = Random.value * Mathf.PI * 2, r = radius * (0.2f + Random.value * 0.8f);
                var p = basePos + new Vector3(Mathf.Sin(a) * r, (0.15f + Random.value * 0.75f) * height, Mathf.Cos(a) * r);
                SkillFx.Burst(p, color, 12, 6f, 0.7f, 0.35f, 2f);
                GameAudio.PlayAt("explosion", p, 0.4f, 0.8f + Random.value * 0.4f);
            }
            if (t < end) return;
            Finished = true;
            var c = basePos + Vector3.up * height * 0.5f;
            SkillFx.Burst(c, color, 40, 12f, 1.4f, 0.5f, 10f);
            SkillFx.Ring(basePos + Vector3.up * 0.1f, 14f, color, 0.9f);
            // 溃散那一下：一记大星芒 + 贴地尘浪（身体隐去的那一刻有个看得见的「没了」）
            Fx.SunFlare(c, Mathf.Clamp(height * 0.9f, 2f, 7f), color);
            Fx.Slam(new Vector3(basePos.x, basePos.y, basePos.z), Mathf.Clamp(radius * 2.5f, 3f, 8f));
            CameraShake.Quake(basePos, 0.9f, 80f, 0.8f);
            GameAudio.PlayAt("explosion", c, 1f, 0.6f);
            foreach (var r in boss.GetComponentsInChildren<Renderer>()) r.enabled = false;
        }

        void ReleaseSlow()
        {
            slow?.Dispose();
            slow = null;
        }

        void OnDisable() => ReleaseSlow();
    }
}
