using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 狂暴（TS frenzied）：生命降到 40% 以下的那一刻狂暴（只一次）：移速 ×1.35、攻速 ×1.6、伤害 ×1.2（加成通道 <see cref="Channel"/>），
    /// 爆一团血色火光 + 一圈冲击环 + 警觉吼声。外观：狂暴后身上一明一暗地泛红，头顶一团跳动的血焰。
    /// </summary>
    [Defs(40)]
    public sealed class EliteAffix_Frenzied : EliteAffix
    {
        public const string Channel = "elite.frenzied";
        /// <summary>触发线（生命比例）</summary>
        public const float Threshold = 0.4f;
        public static readonly BuffMods Mods = new(1.2f, 1.6f, 1.35f, 1);

        public override string Id => "frenzied";
        public override string Name => "狂暴";
        public override Color Color => Hex.Rgb(0xff2a18);
        public override string Hint => "低血量时狂暴";

        public override EliteAffixController Create() => new Controller();

        /// <summary>狂暴的控制器（测试读 <see cref="Frenzied"/>）</summary>
        public sealed class Controller : EliteAffixController
        {
            Transform flame;
            float t, flameSize;

            /// <summary>已经狂暴</summary>
            public bool Frenzied { get; private set; }

            protected override void OnInstall()
            {
                flameSize = Host.radius * 1.8f * (Host.transform ? Host.transform.lossyScale.x : 1);
                flame = Glow(new Vector3(0, Host.height * 1.05f, 0), flameSize, new Color(1f, 0.16f, 0.09f, 0.6f));
                if (flame) flame.gameObject.SetActive(false);
            }

            public override void Tick(float dt, float now)
            {
                t += dt;
                var hp = Host.hp;
                if (!Frenzied)
                {
                    if (hp && !hp.Dead && hp.health <= hp.maxHealth * Threshold) Trigger();
                    return;
                }
                float pulse = 0.5f + 0.5f * Mathf.Sin(t * 11);
                Overlay(Affix.Color, 0.25f + 0.2f * pulse);
                if (flame)
                {
                    float k = 1 + pulse * 0.12f;
                    flame.localScale = new Vector3(k, k * (1 + Mathf.Sin(t * 17) * 0.15f), 1) * (flameSize / Mathf.Max(1e-3f, Host.transform.lossyScale.x));
                    Tint(flame, new Color(1f, 0.16f, 0.09f, 0.35f + pulse * 0.3f));
                }
            }

            void Trigger()
            {
                Frenzied = true;
                Host.buffs?.Set(Channel, this, Mods);
                Overlay(Affix.Color, 0.45f);
                if (flame) flame.gameObject.SetActive(true);
                if (!Application.isPlaying) return;
                Fx.Burst(Host.Center, Affix.Color, 26, 5, 0.6f, 0.12f, 2);
                Fx.Ring(Host.transform.position, 3.2f, Affix.Color, 0.5f);
                GameAudio.PlayAt("enemy_alert", Host.transform.position, 1f, 0.8f);
            }

            public override void Dispose()
            {
                base.Dispose();
                Kill(flame);
            }
        }
    }
}
