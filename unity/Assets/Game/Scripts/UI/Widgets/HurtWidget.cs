using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 受击反馈的全屏层（Three.js src/ui/Crosshair.ts 的受击部分 + css/combat.css .gf-dmgdir / .gf-dmgflash / .gf-lowhp）：
    ///   受击方向：6 道弧（约 41% 屏高半径、贴近屏幕边缘），指向伤害来源；来源敌人还活着时跟踪它的当前位置；同一方向（±20°）的复用同一道；
    ///     强度 = 0.45 + 伤害占（生命 + 护盾上限）× 4，淡入 0.09 s、1.15 s 淡完；
    ///   受击闪屏：扣到生命为红、只扣护盾为蓝（四周暗角），峰值 0.25–0.75 按伤害比例，0.38 s 平方淡出；
    ///   低血量（&lt; 30%）：深红暗角渐浓 + 1.05 s 心跳脉动。
    /// 来源：<see cref="GameEvents.PlayerHit"/>（在死亡判定之前派发，免死的那一下也照样闪）。时间用不缩放时间。
    /// 对外钩子（<see cref="GameUI.HurtFlash"/> / <see cref="GameUI.ThreatFrom"/> / <see cref="GameUI.SetVignetteBoost"/>）：
    /// <see cref="Flash"/>（技能 / 机关想闪一下受击色）、<see cref="Indicate"/>（不扣血的威胁方向提示）、<see cref="VignetteBoost"/>（寒意、日晒这类减益压暗四周）。
    /// </summary>
    [HudWidget("hurt", Order = 10)]
    public sealed class HurtWidget : HudWidget
    {
        const int Pool = 6;
        const float DirTime = 1.15f, FlashTime = 0.38f, HalfSpan = 23.6f, Fade = 0.7f;
        static readonly Color ArcColor = new(1f, 0.25f, 0.16f, 0.95f);
        static readonly Color FlashRed = new(0.7f, 0.08f, 0.04f, 0.85f), FlashBlue = new(0.16f, 0.45f, 0.86f, 0.65f);
        static readonly Color LowColor = new(0.3f, 0f, 0f, 0.85f), PulseColor = new(0.82f, 0.08f, 0.04f, 0.5f);

        sealed class Dir
        {
            public VisualElement el;
            public ArcElement glow, core;
            public Vector3 pos;
            public Transform source;
            public Damageable sourceHealth;
            public float start, strength, shown = -1;
            public bool active;
        }

        VisualElement low, pulse, flash, dirRoot;
        readonly Dir[] dirs = new Dir[Pool];
        float flashAt = -10, flashPeak, lowV, size = -1;

        /// <summary>暗角额外强度 0..1（叠在低血量之上，取大的那个）</summary>
        public float VignetteBoost { get; set; }
        bool flashActive, flashShield;

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-hurt");
            low = HudArt.El("sf-fullscreen", root, "low-hp");
            HudArt.Paint(low, HudArt.Vignette, LowColor);
            low.style.opacity = 0;
            pulse = HudArt.El("sf-fullscreen", low, "low-hp-pulse");
            HudArt.Paint(pulse, HudArt.Vignette, PulseColor);
            pulse.style.opacity = 0;
            flash = HudArt.El("sf-fullscreen", root, "damage-flash");
            HudArt.Paint(flash, HudArt.Vignette, FlashRed);
            flash.style.opacity = 0;
            dirRoot = HudArt.El("sf-fullscreen", root, "damage-dirs");
            for (int i = 0; i < Pool; i++)
            {
                var d = new Dir { el = HudArt.El("sf-dmgdir__arc", dirRoot) };
                d.glow = new ArcElement();
                d.glow.AddToClassList("sf-fullscreen");
                d.glow.Set(-90, HalfSpan + 2, Fade, 16, new Color(1f, 0.16f, 0.08f, 0.22f));
                d.core = new ArcElement();
                d.core.AddToClassList("sf-fullscreen");
                d.core.Set(-90, HalfSpan, Fade, 6, ArcColor, 5);
                d.el.Add(d.glow);
                d.el.Add(d.core);
                d.el.style.opacity = 0;
                dirs[i] = d;
            }
            return root;
        }

        protected override void OnAttach() => GameEvents.PlayerHit += OnPlayerHit;
        protected override void OnDetach() => GameEvents.PlayerHit -= OnPlayerHit;

        public override void ResetState()
        {
            foreach (var d in dirs)
            {
                d.active = false;
                d.source = null;
                d.sourceHealth = null;
                d.shown = 0;
                d.el.style.opacity = 0;
            }
            flashActive = false;
            flash.style.opacity = 0;
        }

        void OnPlayerHit(in PlayerHitEvent e)
        {
            var p = Ctx.Vitals;
            if (!p) return;
            float maxTotal = Mathf.Max(1, p.MaxHealth + p.MaxShield);
            float amount = Mathf.Max(0, e.amount);
            Flash(e.toHp <= 0, Mathf.Clamp(0.25f + amount / maxTotal * 3, 0.25f, 0.75f));
            var src = e.source as Component;
            Indicate(src ? src.transform : null, e.from, Mathf.Clamp(0.45f + amount / maxTotal * 4, 0.45f, 1f));
        }

        /// <summary>受击闪屏：shieldOnly = 蓝（只扣护盾），否则红；peak = 峰值不透明度</summary>
        public void Flash(bool shieldOnly, float peak)
        {
            flashAt = Time.unscaledTime;
            flashPeak = Mathf.Clamp01(peak);
            flashActive = true;
            if (shieldOnly != flashShield)
            {
                flashShield = shieldOnly;
                HudArt.Tint(flash, shieldOnly ? FlashBlue : FlashRed);
            }
        }

        /// <summary>方向指示：source 还活着时跟踪它，否则固定在 from；strength 0..1</summary>
        public void Indicate(Transform source, Vector3 from, float strength)
        {
            var p = Ctx.Vitals;
            if (!p) return;
            var origin = p.transform.position;
            var at = source ? source.position : from;
            var to = at - origin;
            to.y = 0;
            if (to.sqrMagnitude < 0.25f) return;
            float ang = Mathf.Atan2(to.x, to.z);
            float now = Time.unscaledTime;
            // 复用方向相近的，其次空闲的，最后最旧的
            Dir pick = null;
            foreach (var d in dirs)
            {
                if (!d.active) continue;
                var dv = d.pos - origin;
                if (Mathf.Abs(Mathf.DeltaAngle(Mathf.Atan2(dv.x, dv.z) * Mathf.Rad2Deg, ang * Mathf.Rad2Deg)) < 20f)
                {
                    pick = d;
                    break;
                }
            }
            bool reuse = pick != null;
            if (pick == null)
            {
                pick = dirs[0];
                foreach (var d in dirs)
                {
                    if (!d.active)
                    {
                        pick = d;
                        break;
                    }
                    if (d.start < pick.start) pick = d;
                }
            }
            pick.pos = at;
            pick.source = source;
            pick.sourceHealth = source ? source.GetComponent<Damageable>() : null;
            pick.start = now;
            pick.strength = Mathf.Max(reuse ? pick.strength : 0, strength);
            pick.active = true;
        }

        public override void Tick(in HudFrame f)
        {
            var p = Ctx.Vitals;
            Visible = p;
            if (!p) return;
            float now = f.unscaledTime;
            var size2 = Ctx.PanelSize;
            float s = 0.82f * Mathf.Min(size2.x, size2.y);
            if (Mathf.Abs(s - size) > 0.5f)
            {
                size = s;
                foreach (var d in dirs)
                {
                    d.el.style.width = d.el.style.height = s;
                    d.el.style.marginLeft = d.el.style.marginTop = -s * 0.5f;
                }
            }

            UpdateDirs(p, now);

            // 受击闪屏
            if (flashActive)
            {
                float e = (now - flashAt) / FlashTime;
                if (e >= 1 || e < 0)
                {
                    flashActive = false;
                    flash.style.opacity = 0;
                }
                else flash.style.opacity = flashPeak * (1 - e) * (1 - e);
            }

            // 低血量：暗角渐浓（0.4 s 过渡）+ 心跳
            float max = Mathf.Max(1, p.MaxHealth);
            float frac = p.Dead ? 0 : p.health / max;
            float target = frac < 0.3f && !p.Dead ? 0.45f + (1 - frac / 0.3f) * 0.55f : 0;
            target = Mathf.Max(target, Mathf.Clamp01(VignetteBoost));
            lowV = HudArt.Damp(lowV, target, 6f, f.unscaledDt);
            if (lowV < 0.004f && target <= 0) lowV = 0;
            float lq = Mathf.Round(lowV * 50) / 50;
            if (!Mathf.Approximately(low.style.opacity.value, lq)) low.style.opacity = lq;
            pulse.style.opacity = lq > 0 ? Heartbeat(now % 1.05f / 1.05f) : 0;
        }

        void UpdateDirs(PlayerVitals p, float now)
        {
            var cam = Ctx.Cam;
            var motor = Ctx.Motor;
            // 朝向取不抖的眼睛节点（震屏时弧不跟着抖）
            var fwd = motor && motor.eye ? motor.eye.forward : cam ? cam.transform.forward : p.transform.forward;
            float camYaw = Mathf.Atan2(fwd.x, fwd.z) * Mathf.Rad2Deg;
            var origin = p.transform.position;
            foreach (var d in dirs)
            {
                if (!d.active) continue;
                float e = (now - d.start) / DirTime;
                if (e >= 1 || e < 0)
                {
                    d.active = false;
                    d.source = null;
                    d.sourceHealth = null;
                    d.shown = 0;
                    d.el.style.opacity = 0;
                    continue;
                }
                // 来源还活着：跟踪当前位置
                if (d.source)
                {
                    if (d.sourceHealth && d.sourceHealth.Dead)
                    {
                        d.source = null;
                        d.sourceHealth = null;
                    }
                    else d.pos = d.source.position;
                }
                else d.source = null;
                var to = d.pos - origin;
                float srcYaw = Mathf.Atan2(to.x, to.z) * Mathf.Rad2Deg;
                // 来源在右侧 → 弧顺时针转到右边
                d.el.style.rotate = new Rotate(Angle.Degrees(Mathf.DeltaAngle(camYaw, srcYaw)));
                float op = d.strength * (e < 0.08f ? e / 0.08f : 1 - (e - 0.08f) / 0.92f);
                if (Mathf.Abs(op - d.shown) > 0.01f)
                {
                    d.shown = op;
                    d.el.style.opacity = op;
                }
            }
        }

        /// <summary>心跳曲线（Three.js gf-heartbeat：0 → 14% 1 → 28% 0.2 → 42% 0.8 → 70% 0）</summary>
        static float Heartbeat(float t)
        {
            if (t < 0.14f) return Ease(t / 0.14f);
            if (t < 0.28f) return Mathf.Lerp(1, 0.2f, Ease((t - 0.14f) / 0.14f));
            if (t < 0.42f) return Mathf.Lerp(0.2f, 0.8f, Ease((t - 0.28f) / 0.14f));
            if (t < 0.7f) return Mathf.Lerp(0.8f, 0, Ease((t - 0.42f) / 0.28f));
            return 0;
        }

        static float Ease(float k) => k * k * (3 - 2 * k);
    }
}
