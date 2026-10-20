using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 爆裂（TS volatile）：死后 1 s 原地爆炸——死亡位置正下方的地面 / 台面上立刻亮出 4.5 m 预警圈（飞行单位死在半空也一样），
    /// 1 s 后在离地 0.8 m 处炸开，对玩家 26 × 伤害倍率的火伤（边缘 50%，按死亡那一刻的倍率）。只伤玩家，别贴身击杀；清场不炸。
    /// 外观：三颗橙色余烬绕身转（半径 1.35 × 身体半径），身上的橙色一明一暗地脉动。
    /// </summary>
    [Defs(30)]
    public sealed class EliteAffix_Volatile : EliteAffix
    {
        /// <summary>爆炸半径、引信（死后多久炸）、基础伤害（× 伤害倍率）</summary>
        public const float Radius = 4.5f, Fuse = 1f, BaseDamage = 26f;

        public override string Id => "volatile";
        public override string Name => "爆裂";
        public override Color Color => Hex.Rgb(0xff6a1f);
        public override string Hint => "死亡时爆炸，别贴身击杀";

        public override EliteAffixController Create() => new Controller();

        /// <summary>爆裂的控制器（测试读 <see cref="Armed"/>）</summary>
        public sealed class Controller : EliteAffixController
        {
            readonly Transform[] embers = new Transform[3];
            float t = Random.value * 10;

            /// <summary>已经安排了死后爆炸（中心、伤害）</summary>
            public bool Armed { get; private set; }
            public Vector3 BlastCenter { get; private set; }
            public float BlastDamage { get; private set; }

            protected override void OnInstall()
            {
                for (int i = 0; i < embers.Length; i++) embers[i] = Glow(Vector3.zero, 0.3f, new Color(1f, 0.42f, 0.12f, 0.95f));
                Tick(0, 0);
            }

            public override void Tick(float dt, float now)
            {
                t += dt;
                float r = Host.radius * 1.35f, h = Host.height * 0.6f;
                for (int i = 0; i < embers.Length; i++)
                {
                    if (!embers[i]) continue;
                    float a = t * 2.6f + i * Mathf.PI * 2 / 3;
                    embers[i].localPosition = new Vector3(Mathf.Cos(a) * r, h + Mathf.Sin(t * 3 + i * 2) * 0.18f, Mathf.Sin(a) * r);
                }
                Overlay(Affix.Color, 0.1f + 0.15f * (0.5f + 0.5f * Mathf.Sin(t * 6)));
            }

            /// <summary>死了：亮预警圈，1 s 后炸（伤害按死亡这一刻的倍率）</summary>
            public override void OnDeath(in DamageInfo info)
            {
                if (Armed) return;
                Armed = true;
                foreach (var e in embers) Kill(e);
                var p = Host.transform ? Host.transform.position : Vector3.zero;
                float gy = Physics.Raycast(p + Vector3.up * 0.1f, Vector3.down, out var hit, 60f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point.y : p.y;
                var ground = new Vector3(p.x, gy + 0.05f, p.z);
                BlastCenter = ground + Vector3.up * 0.8f;
                BlastDamage = BaseDamage * Host.DamageMult;
                var color = Affix.Color;
                var c = BlastCenter;
                float dmg = BlastDamage;
                var src = Host.ai;
                if (Application.isPlaying) Telegraph.Circle(ground, Radius, Fuse, color);
                GameAudio.PlayAt("telegraph", ground, 0.8f);
                HazardClock.Delay(Fuse, () =>
                {
                    if (EnemyRegistry.Purging) return;
                    if (Application.isPlaying) Fx.Explosion(c, Radius, color);
                    GameAudio.PlayAt("explosion", c);
                    Blast.Player(c, Radius, dmg, Element.Fire, src ? src : null, 0.5f, 0.7f);
                });
            }

            public override void Dispose()
            {
                base.Dispose();
                foreach (var e in embers) Kill(e);
            }
        }
    }
}
