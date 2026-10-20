using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 迅捷（TS swift）：移速、攻速 ×1.5（加成通道 <see cref="Channel"/>，和光环等其他通道相乘）。
    /// 外观：身上淡淡一层青色，腰间两团青色风旋反向绕身（半径 1.35 × 身体半径），跑快了（&gt; 3 m/s）身后拖青色残影。
    /// </summary>
    [Defs(10)]
    public sealed class EliteAffix_Swift : EliteAffix
    {
        public const string Channel = "elite.swift";
        public static readonly BuffMods Mods = new(1, 1.5f, 1.5f, 1);

        public override string Id => "swift";
        public override string Name => "迅捷";
        public override Color Color => Hex.Rgb(0x49d8ff);
        public override string Hint => "移速与攻速提高";

        public override EliteAffixController Create() => new Controller();

        sealed class Controller : EliteAffixController
        {
            readonly Transform[] swirls = new Transform[2];
            float angle, trailTimer;
            Vector3 lastPos;

            protected override void OnInstall()
            {
                Host.buffs?.Set(Channel, this, Mods);
                Overlay(Affix.Color, 0.12f);
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
                if (!Host.transform || dt <= 0) return;
                var p = Host.transform.position;
                var v = (p - lastPos) / dt;
                lastPos = p;
                trailTimer -= dt;
                if (trailTimer <= 0 && new Vector2(v.x, v.z).magnitude > 3 && Application.isPlaying)
                {
                    trailTimer = 0.14f;
                    Fx.Burst(Host.Local(0, Host.height * 0.4f, 0), Affix.Color, 2, 0.6f, 0.35f, 0.06f, 0);
                }
            }

            public override void Dispose()
            {
                base.Dispose();
                foreach (var s in swirls) Kill(s);
            }
        }
    }
}
