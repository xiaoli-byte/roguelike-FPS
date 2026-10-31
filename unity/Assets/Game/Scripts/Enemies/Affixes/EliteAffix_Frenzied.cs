using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 狂暴（TS frenzied）：生命降到 40% 以下的那一刻狂暴（只一次）：移速 ×1.35、攻速 ×1.6、伤害 ×1.2（加成通道 <see cref="Channel"/>），
    /// 一圈锯齿血环 + 往上窜的血焰 + 尖刺（<see cref="Fx.EliteFrenzy"/>）+ 警觉吼声。外观：狂暴前金环里的锯齿牙暗着慢转；
    /// 狂暴后锯齿牙亮起、高速转、心跳般收放，身上跟着同一个心跳一明一暗地泛红，头顶一片跳动的卡通血焰（Q 路，docs/art/vfx/elite-affixes.md）。
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
            FlameTongue flame;
            EliteAura aura;
            float t, flameSize;

            /// <summary>已经狂暴</summary>
            public bool Frenzied { get; private set; }

            protected override void OnInstall()
            {
                flameSize = Host.radius * 1.8f * (Host.transform ? Host.transform.lossyScale.x : 1);
                // 头顶血焰：卡通火舌（S 形往上翻、顶端分舌），狂暴前不画
                if (Application.isPlaying && Host.transform)
                {
                    flame = FlameTongue.Attach(Host.transform, new Vector3(0, Host.height * 0.98f, 0), Vector3.one * flameSize, Hex.Rgb(0xffd2b0), Hex.Rgb(0xff3a1c),
                        Hex.Rgb(0x6a0a18));
                    if (flame) flame.Set(0);
                }
                aura = Host.transform ? Host.transform.GetComponent<EliteAura>() : null;
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
                // 心跳（和金环里锯齿牙的节奏一样：咚—咚、停，1.9 Hz）
                float ph = Mathf.Repeat(t * 1.9f, 1f);
                float pulse = Mathf.Exp(-ph * 14f) + (ph > 0.22f ? 0.6f * Mathf.Exp(-(ph - 0.22f) * 14f) : 0f);
                Overlay(Affix.Color, 0.25f + 0.22f * Mathf.Clamp01(pulse));
                if (flame)
                {
                    float k = 1 + pulse * 0.18f;
                    flame.Set(0.85f, new Vector3(flameSize * 0.75f * k, flameSize * (1.15f + 0.25f * pulse), flameSize));
                }
            }

            void Trigger()
            {
                Frenzied = true;
                Host.buffs?.Set(Channel, this, Mods);
                Overlay(Affix.Color, 0.45f);
                if (aura)
                {
                    // 金环里的锯齿牙醒过来：亮起来、高速转、打一下
                    aura.Level = 1.2f;
                    aura.SpinBoost = 190f;
                    aura.Pulse(1f);
                }
                if (!Application.isPlaying) return;
                float s = Host.transform ? Host.transform.lossyScale.x : 1f;
                Fx.EliteFrenzy(Host.transform.position, Host.Center, Host.radius * s, Affix.Color);
                GameAudio.PlayAt("enemy_alert", Host.transform.position, 1f, 0.8f);
            }

            public override void Dispose()
            {
                base.Dispose();
                if (flame) Kill(flame.transform);
            }
        }
    }
}
