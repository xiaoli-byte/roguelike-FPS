using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 碎刃的武器技能图标（docs/demon-blade-v2.md 第 9 节 HUD；docs/unity-parity.md 3.12「武器技能图标（V）」）：复用 Q / E 的 <see cref="SkillDisc"/>，
    /// 排在技能栏右边（与 Q / E 盘顶对齐）。握着碎刃时显示：
    ///   盘 = 杀气爆发冷却（单字「爆」）；杀意满时变为「人刀合一」（单字「合」、金环就绪）；爆发过程 / 人刀合一期间金圈呼吸；
    ///   右侧两根竖条：杀意（满时转金）与刃气（右键 / R 共用）。放出时盘闪一下，冷却中按 V 盘闪红。
    /// </summary>
    [HudWidget("blade-skill", Order = 51)]
    public sealed class BladeSkillWidget : HudWidget
    {
        const float DiscSize = 64, BarH = 64, BarW = 5;
        static readonly Color IntentColor = Hex.Rgb(0xb07cff), IntentFull = Hex.Rgb(0xf4d893), QiColor = Hex.Rgb(0xd8c2ff);

        SkillDisc disc;
        VisualElement intentFill, qiFill;
        int unionShown = -1, intentQ = -1, qiQ = -1;

        /// <summary>V 盘（测试、截图用）</summary>
        public SkillDisc Disc => disc;

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-blade-skill");
            root.style.position = Position.Absolute;
            root.style.left = new Length(50, LengthUnit.Percent);
            // 技能栏：Q / E 各 76 px + 左右 10 px 居中排开，E 的右缘在中线右侧 96 px；技能栏底 20 px + 冲刺格 21 px
            root.style.marginLeft = 100;
            root.style.bottom = 41;
            root.style.flexDirection = FlexDirection.Row;
            root.style.alignItems = Align.FlexStart;
            disc = new SkillDisc("V", DiscSize);
            root.Add(disc);
            var bars = HudArt.El(null, root);
            bars.style.flexDirection = FlexDirection.Row;
            bars.style.marginTop = 0;
            bars.style.marginLeft = -2;
            intentFill = Bar(bars, IntentColor);
            qiFill = Bar(bars, QiColor);
            root.style.display = DisplayStyle.None;
            return root;
        }

        static VisualElement Bar(VisualElement parent, Color c)
        {
            var track = HudArt.El(null, parent);
            track.style.width = BarW;
            track.style.height = BarH;
            track.style.marginRight = 3;
            track.style.backgroundColor = new Color(0.03f, 0.02f, 0.04f, 0.65f);
            track.style.borderTopWidth = track.style.borderBottomWidth = track.style.borderLeftWidth = track.style.borderRightWidth = 1;
            track.style.borderTopColor = track.style.borderBottomColor = track.style.borderLeftColor = track.style.borderRightColor = new Color(0.83f, 0.66f, 0.33f, 0.25f);
            var fill = HudArt.El(null, track);
            fill.style.position = Position.Absolute;
            fill.style.left = fill.style.right = fill.style.top = fill.style.bottom = 0;
            fill.style.backgroundColor = c;
            fill.style.transformOrigin = new TransformOrigin(new Length(50, LengthUnit.Percent), new Length(100, LengthUnit.Percent));
            fill.style.scale = new Scale(new Vector3(1, 0, 1));
            return fill;
        }

        protected override void OnAttach()
        {
            DemonBladeController.SkillUsed += OnUsed;
            DemonBladeController.SkillDenied += OnDenied;
        }

        protected override void OnDetach()
        {
            DemonBladeController.SkillUsed -= OnUsed;
            DemonBladeController.SkillDenied -= OnDenied;
        }

        void OnUsed(string id) => disc?.Flash(Time.unscaledTime);
        void OnDenied() => disc?.Deny(Time.unscaledTime);

        public override void ResetState()
        {
            unionShown = intentQ = qiQ = -1;
        }

        public override void Tick(in HudFrame f)
        {
            var c = DemonBladeController.Instance;
            var wc = Ctx.Weapons;
            bool show = c && wc && Ctx.Vitals && c.Active && ReferenceEquals(wc.Takeover, c);
            Visible = show;
            if (!show) return;
            float now = f.unscaledTime;
            bool union = c.IntentFull;
            int u = union ? 1 : 0;
            if (u != unionShown)
            {
                unionShown = u;
                disc.SetSkill(DemonBladeDef.SkillName(union), DemonBladeDef.SkillGlyph(union));
                disc.Accent = union ? UITheme.GoldHi : UITheme.Gold;
            }
            disc.Key = HudArt.Key(GameAction.WeaponSkill);
            float left = c.SkillCooldownLeft, total = Mathf.Max(0.1f, c.SkillCooldownTotal);
            float prog = left > 0 ? Mathf.Clamp01(1 - left / total) : 1;
            disc.Set(prog, left, left > 0 ? 0 : 1, 1, c.SkillBusy, now);

            int iq = Mathf.RoundToInt(c.IntentFraction * 50);
            if (iq != intentQ)
            {
                intentQ = iq;
                intentFill.style.scale = new Scale(new Vector3(1, iq / 50f, 1));
                intentFill.style.backgroundColor = iq >= 50 ? IntentFull : IntentColor;
            }
            int qq = Mathf.RoundToInt(c.QiFraction * 50);
            if (qq != qiQ)
            {
                qiQ = qq;
                qiFill.style.scale = new Scale(new Vector3(1, qq / 50f, 1));
            }
        }
    }
}
