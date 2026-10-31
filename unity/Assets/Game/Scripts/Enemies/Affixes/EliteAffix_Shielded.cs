using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 坚盾（TS shielded）：额外护盾 = 最大生命（精英、等级已乘）的 60%（取整），叠在护盾层上；
    /// 离上次受伤超过 4 s 就回盾，每秒 22% 护盾上限，回满为止。
    /// 外观：身上淡淡一层蓝；一团蓝色护罩光（亮度跟护盾比例走，挨打时闪一下，回盾时呼吸）；金环里的六角甲框亮度也跟护盾（Q 路）：
    /// 破盾时六角甲片从身上崩飞（<see cref="Fx.EliteShieldBreak"/>）、框暗下去，回满那一刻六角格往里一合（<see cref="Fx.EliteShieldRestore"/>）。
    /// </summary>
    [Defs(20)]
    public sealed class EliteAffix_Shielded : EliteAffix
    {
        /// <summary>额外护盾占最大生命的比例、脱战多久开始回盾、每秒回护盾上限的比例</summary>
        public const float ShieldFrac = 0.6f, RegenDelay = 4f, RegenRate = 0.22f;

        public override string Id => "shielded";
        public override string Name => "坚盾";
        public override Color Color => Hex.Rgb(0x4f8dff);
        public override string Hint => "额外护盾，脱战回盾";

        public override EliteAffixController Create() => new Controller();

        /// <summary>坚盾的控制器（测试读 <see cref="Regenerating"/>）</summary>
        public sealed class Controller : EliteAffixController
        {
            Transform bubble;
            EliteAura aura;
            float flash, lastHurt = float.NegativeInfinity, bubbleSize;
            bool wasFull = true;

            /// <summary>正在回盾</summary>
            public bool Regenerating { get; private set; }
            /// <summary>加上的额外护盾</summary>
            public float Extra { get; private set; }

            protected override void OnInstall()
            {
                var hp = Host.hp;
                if (hp)
                {
                    Extra = EnemyAI.RoundHp(hp.maxHealth * ShieldFrac);
                    hp.maxShield += Extra;
                    hp.shield += Extra;
                }
                Overlay(Affix.Color, 0.08f);
                bubbleSize = 2 * Mathf.Max(Host.radius * 1.7f, Host.height * 0.62f) * (Host.transform ? Host.transform.lossyScale.x : 1);
                bubble = Glow(new Vector3(0, Host.height * 0.5f, 0), bubbleSize, new Color(0.31f, 0.55f, 1f, 0.2f));
                aura = Host.transform ? Host.transform.GetComponent<EliteAura>() : null;
            }

            public override void Tick(float dt, float now)
            {
                var hp = Host.hp;
                if (!hp || hp.Dead) return;
                if (hp.shield < hp.maxShield && now - lastHurt > RegenDelay)
                {
                    if (!Regenerating && Application.isPlaying) Fx.Burst(Host.Center, Affix.Color, 10, 2.5f, 0.5f, 0.08f, 0);
                    Regenerating = true;
                    hp.shield = Mathf.Min(hp.maxShield, hp.shield + hp.maxShield * RegenRate * dt);
                }
                else Regenerating = false;
                flash = Mathf.Max(0, flash - dt * 4);
                float frac = hp.maxShield > 0 ? hp.shield / hp.maxShield : 0;
                // 金环里的六角甲：亮度跟护盾（破了只剩暗框），回满那一刻合拢一闪
                if (aura) aura.Level = 0.3f + 0.9f * frac + 0.4f * flash;
                bool full = frac >= 0.999f;
                if (full && !wasFull && Application.isPlaying)
                {
                    if (aura) aura.Pulse(0.8f);
                    Fx.EliteShieldRestore(Host.Center, Host.radius * (Host.transform ? Host.transform.lossyScale.x : 1f) * 1.4f, Affix.Color);
                }
                wasFull = full;
                if (!bubble) return;
                bubble.gameObject.SetActive(frac > 0.01f || flash > 0.01f);
                float a = 0.05f + frac * 0.16f + flash * 0.45f + (Regenerating ? 0.06f * (1 + Mathf.Sin(now * 12)) : 0);
                Tint(bubble, new Color(0.31f, 0.55f, 1f, Mathf.Clamp01(a)));
            }

            public override void OnDamaged(in DamageInfo info, in DamageResult r, float now)
            {
                if (r.immune || !(r.total > 0 || r.blocked)) return;
                lastHurt = now;
                if (r.shield > 0) flash = 1;
                if (r.shieldBroken && Application.isPlaying)
                {
                    Fx.EliteShieldBreak(Host.Center, Host.radius * (Host.transform ? Host.transform.lossyScale.x : 1f) * 1.4f, Affix.Color);
                    if (aura) aura.Pulse(1f);
                }
            }

            public override void Dispose()
            {
                base.Dispose();
                Kill(bubble);
            }
        }
    }
}
