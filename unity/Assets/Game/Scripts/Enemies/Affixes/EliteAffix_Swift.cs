using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 迅捷：移速、攻速 ×1.5；定期蓄风挥出一道直线前行的龙卷。词缀招式接管期间基础 AI 暂停，避免与原攻击同时出手。
    /// 外观沿用青色风旋、跑动风线与卷云钩；龙卷使用项目的三阶手绘风带、章节尘色与敌方月牙刀光。
    /// </summary>
    [Defs(10)]
    public sealed class EliteAffix_Swift : EliteAffix
    {
        public const string Channel = "elite.swift";
        public static readonly BuffMods Mods = new(1, 1.5f, 1.5f, 1);

        public override string Id => "swift";
        public override string Name => "迅捷";
        public override Color Color => Hex.Rgb(0x49d8ff);
        public override string Hint => "移速与攻速提高；定期挥出前行龙卷";

        public override EliteAffixController Create() => new Controller();

        public sealed class Controller : EliteAffixController
        {
            readonly Transform[] swirls = new Transform[2];
            float angle, trailTimer, tornadoCooldown, windLeft, recovery;
            Vector3 lastPos, lockedDirection, windOrigin;
            TelegraphHandle warning;
            EliteTornadoVisual charge;
            bool token;

            public bool Winding => windLeft > 0;

            protected override void OnInstall()
            {
                Host.buffs?.Set(Channel, this, Mods);
                Overlay(Affix.Color, 0.12f);
                tornadoCooldown = Random.Range(4.5f, 6.5f);
                for (int i = 0; i < swirls.Length; i++) swirls[i] = Glow(Vector3.zero, 0.35f, new Color(0.29f, 0.85f, 1f, 0.8f));
                if (Host.transform) lastPos = Host.transform.position;
            }

            public override void Tick(float dt, float now)
            {
                angle += dt;
                float r = Host.radius * 1.35f;
                for (int i = 0; i < swirls.Length; i++)
                {
                    if (!swirls[i]) continue;
                    float a = angle * (i == 0 ? 7 : -9) + i * Mathf.PI;
                    swirls[i].localPosition = new Vector3(Mathf.Cos(a) * r, Host.height * (0.3f + i * 0.32f), Mathf.Sin(a) * r);
                }
                TickTrail(dt);
                TickTornado(dt);
            }

            void TickTrail(float dt)
            {
                if (!Host.transform || dt <= 0) return;
                var p = Host.transform.position;
                var v = (p - lastPos) / dt;
                lastPos = p;
                trailTimer -= dt;
                if (trailTimer <= 0 && new Vector2(v.x, v.z).magnitude > 3 && Application.isPlaying)
                {
                    trailTimer = 0.12f;
                    float s = Host.transform.lossyScale.x;
                    Fx.EliteWindStreak(Host.Local(0, Host.height * 0.45f, 0), -v, Host.radius * s * 1.2f, Affix.Color);
                }
            }

            void TickTornado(float dt)
            {
                var ai = Host.ai;
                if (!ai || !Application.isPlaying || dt <= 0) return;
                if (recovery > 0)
                {
                    recovery -= dt;
                    if (recovery <= 0) ai.AffixAttackBusy = false;
                }
                if (windLeft > 0)
                {
                    if (Interrupted(ai))
                    {
                        CancelTornado();
                        return;
                    }
                    windLeft -= dt;
                    if (charge)
                    {
                        charge.transform.position = Ground(ai.transform.position);
                        float k = 1f - Mathf.Clamp01(windLeft / EliteTornado.Windup);
                        charge.SetCharge(k);
                    }
                    if (windLeft <= 0) ReleaseTornado();
                    return;
                }
                if (recovery > 0) return;
                tornadoCooldown -= dt;
                if (tornadoCooldown > 0 || Interrupted(ai) || AttackTokens.Holding(ai)) return;
                var player = PlayerVitals.Instance;
                var offset = player.transform.position - ai.transform.position;
                float distance = new Vector2(offset.x, offset.z).magnitude;
                if (distance < 4f || distance > 24f || Mathf.Abs(offset.y) > 4f) return;
                if (!Combat.LineClear(Host.Center, player.transform.position + Vector3.up * 1.2f)) return;
                if (!AttackTokens.Request(AttackTokens.Kind.Heavy, ai, EliteTornado.Windup + 0.4f)) return;

                token = true;
                ai.AffixAttackBusy = true;
                lockedDirection = offset;
                lockedDirection.y = 0;
                lockedDirection.Normalize();
                windOrigin = Ground(ai.transform.position);
                windLeft = EliteTornado.Windup;
                warning = Telegraph.Lane(windOrigin, windOrigin + lockedDirection * EliteTornado.Range, EliteTornado.Radius * 2f, EliteTornado.Windup, Affix.Color);
                charge = EliteTornadoVisual.Create(windOrigin, 4.6f, 1.2f);
                GameAudio.PlayAt("telegraph", ai.transform.position, 0.8f);
                GameAudio.PlayAt("enemy_charge", ai.transform.position, 0.65f, 1.25f);
            }

            bool Interrupted(EnemyAI ai)
            {
                var player = PlayerVitals.Instance;
                var status = ai.GetComponent<EnemyStatus>();
                return !Host.Alive || ai.State == "spawn" || ai.Taunted || (status && status.Stunned) || !player || player.Dead;
            }

            void ReleaseTornado()
            {
                var ai = Host.ai;
                warning.End();
                if (charge)
                {
                    charge.SetAlpha(0);
                    charge.FadeOut(0.08f);
                    charge = null;
                }
                float size = ai.transform.lossyScale.x;
                var at = windOrigin + lockedDirection * (Host.radius * size + 0.65f);
                EliteTornado.Spawn(ai, at, lockedDirection, EliteTornado.BaseDamage * Host.DamageMult);
                float yaw = Mathf.Atan2(lockedDirection.x, lockedDirection.z) * Mathf.Rad2Deg;
                Fx.Slash(Host.Center + lockedDirection * 0.45f, yaw, 2.15f * size, 1.55f, 1, 0.65f, 0.62f * size, 0.28f, Hex.Rgb(0xc6e7dc), true);
                Fx.Burst(at + Vector3.up * 0.5f, Affix.Color, 8, 4f, 0.35f, 0.12f);
                var dust = FxTone.Ground(Hex.Rgb(0xa08a6a));
                Surge.Crown(at, 1.25f, 1.1f, SurgeKind.Sand, 0.58f, dust, FxTone.Ground(Hex.Rgb(0xd5bd91)), 0.82f);
                CameraShake.Quake(at, 0.22f, 14f, 0.25f);
                GameAudio.PlayAt("enemy_melee", ai.transform.position, 0.9f);
                GameAudio.PlayAt("boss_slam", at, 0.45f, 1.35f);
                if (token)
                {
                    AttackTokens.Release(ai);
                    token = false;
                }
                tornadoCooldown = Random.Range(EliteTornado.CooldownMin, EliteTornado.CooldownMax);
                recovery = 0.22f;
            }

            static Vector3 Ground(Vector3 at)
            {
                return Physics.Raycast(at + Vector3.up * 2f, Vector3.down, out var hit, 12f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                    ? hit.point + Vector3.up * 0.04f : at;
            }

            void CancelTornado()
            {
                warning.Cancel();
                if (charge)
                {
                    charge.FadeOut(0.12f);
                    charge = null;
                }
                windLeft = recovery = 0;
                if (Host.ai) Host.ai.AffixAttackBusy = false;
                if (token)
                {
                    AttackTokens.Release(Host.ai);
                    token = false;
                }
            }

            public override void OnDeath(in DamageInfo info) => CancelTornado();

            public override void Dispose()
            {
                CancelTornado();
                base.Dispose();
                foreach (var s in swirls) Kill(s);
            }
        }
    }
}
