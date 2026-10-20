using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 技能圆盘（Three.js HUD.ts SkillIcon + css/hud.css .gf-skill）：64 px 墨色圆盘 + Painter2D 冷却环（12 点起顺时针）+ 单字 + 冷却秒数 +
    /// 充能角标（朱砂圆角，最大充能 &gt; 1 才显示）+ 顶上的键帽 + 下方技能名。
    /// 状态：冷却（单字淡到 0.25、环转灰）、生效中（金圈呼吸）、放出（亮一下、放大 1.12 回弹 0.32 s）、拒绝（框闪红 + 左右抖 0.3 s）。
    /// Q / E、灵宠 G 技、以后的武器技能 V（WC6）共用这一个元素。时间一律传不缩放时间。
    /// </summary>
    public sealed class SkillDisc : VisualElement
    {
        const float FlashTime = 0.32f, DenyTime = 0.3f;

        readonly VisualElement disc, flash;
        readonly RingElement ring;
        readonly Label glyph, cd, charges, key, nameLabel;
        float flashAt = -10, denyAt = -10;
        bool cooling, active, animating;
        int chargesV = -1, maxV = -1;
        Color ringColor = UITheme.Gold;

        public SkillDisc(string keyText, float size = 64)
        {
            pickingMode = PickingMode.Ignore;
            AddToClassList("sf-skill");
            disc = HudArt.El("sf-skill__disc", this);
            disc.style.width = disc.style.height = size;
            disc.style.borderTopLeftRadius = disc.style.borderTopRightRadius = disc.style.borderBottomLeftRadius = disc.style.borderBottomRightRadius = size * 0.5f;
            HudArt.Origin(disc, 50, 50);
            var shade = HudArt.El("sf-skill__shade", disc);
            HudArt.Paint(shade, HudArt.Glow, new Color(0.145f, 0.118f, 0.16f, 1f));
            ring = new RingElement(3) { Track = new Color(1, 1, 1, 0.08f), Color = UITheme.Gold };
            ring.AddToClassList("sf-skill__ring");
            disc.Add(ring);
            glyph = HudArt.Text("sf-skill__glyph", disc, "", UIFontRole.Title);
            glyph.style.fontSize = Mathf.Round(size * 0.45f);
            cd = HudArt.Text("sf-skill__cd", disc, "", UIFontRole.Number);
            cd.style.fontSize = Mathf.Round(size * 0.33f);
            flash = HudArt.El("sf-skill__flash", disc);
            flash.style.borderTopLeftRadius = flash.style.borderTopRightRadius = flash.style.borderBottomLeftRadius = flash.style.borderBottomRightRadius = size * 0.5f;
            flash.style.opacity = 0;
            charges = HudArt.Text("sf-skill__charges", disc, "", UIFontRole.Number);
            HudArt.Show(charges, false);
            key = HudArt.Text("sf-skill__key", disc, keyText, UIFontRole.Number);
            nameLabel = HudArt.Text("sf-skill__name", this);
        }

        public string Key
        {
            set => HudArt.SetText(key, value ?? "");
        }

        /// <summary>技能名（单字取首字）</summary>
        public void SetSkill(string name, string glyphText = null)
        {
            name = string.IsNullOrEmpty(name) ? "技能" : name;
            HudArt.SetText(nameLabel, name);
            HudArt.SetText(glyph, string.IsNullOrEmpty(glyphText) ? name.Substring(0, 1) : glyphText);
        }

        /// <summary>环与描边的强调色（灵宠技按品阶色）</summary>
        public Color Accent
        {
            set
            {
                ringColor = value;
                if (!cooling && !active) ring.Color = value;
            }
        }

        /// <summary>
        /// 刷新：progress = 冷却进度 0..1（1 = 就绪）、cooldownLeft = 剩余秒数（只在没有充能时显示）、充能 / 最大充能、生效中。
        /// 充能变多时自动闪一下
        /// </summary>
        public void Set(float progress, float cooldownLeft, int chargesNow, int maxCharges, bool isActive, float now)
        {
            ring.Progress = progress;
            maxCharges = Mathf.Max(1, maxCharges);
            if (chargesNow != chargesV || maxCharges != maxV)
            {
                if (chargesV >= 0 && chargesNow > chargesV) Flash(now);
                chargesV = chargesNow;
                maxV = maxCharges;
                HudArt.Show(charges, maxCharges > 1);
                HudArt.SetText(charges, chargesNow.ToString());
            }
            bool c = chargesNow <= 0;
            if (c != cooling || isActive != active)
            {
                cooling = c;
                active = isActive;
                HudArt.Toggle(this, "is-cooling", c);
                HudArt.Toggle(this, "is-active", isActive);
                ring.Color = isActive ? UITheme.GoldHi : c ? UITheme.Paper3 : ringColor;
            }
            HudArt.SetText(cd, c ? HudArt.CooldownText(cooldownLeft) : "");
            Animate(now);
        }

        /// <summary>放出：亮一下、放大回弹</summary>
        public void Flash(float now) => flashAt = now;

        /// <summary>放不出来：框闪红、左右抖</summary>
        public void Deny(float now) => denyAt = now;

        void Animate(float now)
        {
            float kf = (now - flashAt) / FlashTime;
            float kd = (now - denyAt) / DenyTime;
            bool f = kf >= 0 && kf < 1, d = kd >= 0 && kd < 1;
            if (f)
            {
                float e = 1 - kf;
                flash.style.opacity = 0.6f * e * e;
                disc.style.scale = new Scale(Vector3.one * (1 + 0.12f * e * e));
            }
            if (d)
            {
                float e = 1 - kd;
                disc.style.translate = new Translate(Mathf.Sin(now * 70f) * 6f * e, 0);
                var red = new Color(1f, 0.18f, 0.12f, 1f);
                disc.style.borderTopColor = disc.style.borderBottomColor = disc.style.borderLeftColor = disc.style.borderRightColor = Color.Lerp(new Color(0.83f, 0.66f, 0.33f, 0.25f), red, e);
            }
            if (active)
            {
                // 生效中：金圈 0.8 s 往返呼吸
                float k = 0.5f + 0.5f * Mathf.Sin(now * Mathf.PI / 0.8f);
                if (!d) disc.style.borderTopColor = disc.style.borderBottomColor = disc.style.borderLeftColor = disc.style.borderRightColor = Color.Lerp(UITheme.Gold, UITheme.GoldHi, k);
            }
            if (f || d || active)
            {
                animating = true;
                return;
            }
            if (!animating) return;
            animating = false;
            flash.style.opacity = 0;
            disc.style.scale = StyleKeyword.Null;
            disc.style.translate = StyleKeyword.Null;
            disc.style.borderTopColor = disc.style.borderBottomColor = disc.style.borderLeftColor = disc.style.borderRightColor = StyleKeyword.Null;
        }
    }

    /// <summary>
    /// 底部居中 Q / E 技能盘 + 冲刺充能格（Three.js HUD.ts SkillIcon / DashPips；css/hud.css .gf-skills / .gf-dash）。
    /// 技能取 <see cref="HudContext.Skills"/>（<see cref="SkillHud"/> 挂点绑的那一份）；放出闪光听 <see cref="GameEvents.SkillUsed"/>，
    /// 拒绝闪红听 <see cref="GameUI.SkillDeniedShown"/>。冲刺格数 = PlayerMotor.dashCharges（1–6），每格按回充进度从中心长满，满格发青光。
    /// </summary>
    [HudWidget("skills", Order = 50)]
    public sealed class SkillWidget : HudWidget
    {
        SkillDisc q, e;
        VisualElement dash;
        readonly List<(VisualElement pip, VisualElement fill)> pips = new();
        readonly float[] pipQ = new float[6];
        int maxPips = -1;
        Skill shownQ, shownE;

        /// <summary>Q / E 盘（测试、截图用）</summary>
        public SkillDisc Primary => q;
        public SkillDisc Secondary => e;

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-skillbar");
            var row = HudArt.El("sf-skills", root);
            q = new SkillDisc("Q");
            e = new SkillDisc("E");
            row.Add(q);
            row.Add(e);
            dash = HudArt.El("sf-dash", root);
            return root;
        }

        protected override void OnAttach()
        {
            GameEvents.SkillUsed += OnUsed;
            GameUI.SkillDeniedShown += OnDenied;
        }

        protected override void OnDetach()
        {
            GameEvents.SkillUsed -= OnUsed;
            GameUI.SkillDeniedShown -= OnDenied;
        }

        void OnUsed(SkillSlot slot, string id) => (slot == SkillSlot.Primary ? q : e)?.Flash(Time.unscaledTime);
        void OnDenied(SkillSlot slot) => (slot == SkillSlot.Primary ? q : e)?.Deny(Time.unscaledTime);

        public override void ResetState()
        {
            shownQ = shownE = null;
            maxPips = -1;
        }

        public override void Tick(in HudFrame f)
        {
            var skills = Ctx.Skills;
            var motor = Ctx.Motor;
            Visible = Ctx.Vitals && (skills || motor);
            if (!Ctx.Vitals) return;
            float now = f.unscaledTime;
            Sync(q, skills ? skills.primary : null, ref shownQ, GameAction.SkillQ, now);
            Sync(e, skills ? skills.secondary : null, ref shownE, GameAction.SkillE, now);
            UpdateDash(motor);
        }

        static void Sync(SkillDisc disc, Skill sk, ref Skill shown, GameAction action, float now)
        {
            HudArt.Show(disc, sk != null);
            if (sk == null) return;
            if (sk != shown)
            {
                shown = sk;
                disc.SetSkill(sk.name);
            }
            disc.Key = HudArt.Key(action);
            float rem = Mathf.Max(0, sk.CooldownLeft);
            float total = sk.cooldown > 0 ? sk.cooldown : 1;
            float prog = rem > 0 ? Mathf.Clamp01(1 - rem / total) : 1;
            disc.Set(prog, rem, sk.charges, sk.maxCharges, sk.Busy, now);
        }

        void UpdateDash(PlayerMotor motor)
        {
            HudArt.Show(dash, motor);
            if (!motor) return;
            int max = Mathf.Clamp(motor.dashCharges, 1, 6);
            if (max != maxPips)
            {
                maxPips = max;
                while (pips.Count < max)
                {
                    var pip = HudArt.El("sf-dash__pip", dash);
                    var fill = HudArt.El("sf-dash__fill", pip);
                    fill.style.scale = new Scale(Vector3.zero);
                    pips.Add((pip, fill));
                }
                for (int i = 0; i < pips.Count; i++)
                {
                    HudArt.Show(pips[i].pip, i < max);
                    pipQ[i] = -1;
                }
            }
            float level = motor.DashChargeLevel;
            for (int i = 0; i < max; i++)
            {
                float qv = Mathf.Round(Mathf.Clamp01(level - i) * 20) / 20;
                if (Mathf.Approximately(qv, pipQ[i])) continue;
                pipQ[i] = qv;
                pips[i].fill.style.scale = new Scale(new Vector3(qv, qv, 1));
                HudArt.Toggle(pips[i].pip, "is-full", qv >= 1);
            }
        }
    }
}
