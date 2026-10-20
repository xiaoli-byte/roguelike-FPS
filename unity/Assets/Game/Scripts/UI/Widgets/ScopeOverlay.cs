using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 狙击镜遮罩（WC1，Three.js src/ui/Crosshair.ts 的 gf-scope + css/combat.css .gf-scope*）：
    /// 进了镜（视角层 &lt; −30°，<see cref="WeaponSight.Scoped"/>，只有鹰隼狙击的 −45° 够得到）且游戏在跑时显示——
    /// 全屏黑底挖出 70vmin 的圆形镜口（内缘一圈暗影）、镜口细金边 + 外圈黑环、十字细线 + 外侧四根粗柱、
    /// 两轴各 4 个密位点（±5 / ±10 vmin）、中心朱红点。淡入 0.12 s，镜口从 1.06 倍收到 1（同 TS 的 transform 过渡）。
    /// 显示期间把准星收起（<see cref="CrosshairWidget.Suppressed"/>），换弹环 / 命中标记照常；枪模由 <see cref="SightPart"/> 隐藏。
    /// 层序 35：在准星（40）之下、受击暗角（10）之上，同 TS 的 z-index。
    /// </summary>
    [HudWidget("scope", Order = 35)]
    public sealed class ScopeOverlay : HudWidget
    {
        /// <summary>淡入 / 淡出时长（秒，不缩放时间）</summary>
        public const float Fade = 0.12f;
        const float ZoomFrom = 1.06f;

        ScopeLensElement lens;
        float alpha, shownAlpha = -1, zoom = ZoomFrom;
        bool scoped, suppressing;

        /// <summary>镜内（遮罩在显示 / 淡入中；测试用）</summary>
        public bool Scoped => scoped;

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-scope");
            root.style.position = Position.Absolute;
            root.style.left = root.style.top = root.style.right = root.style.bottom = 0;
            lens = new ScopeLensElement();
            lens.style.position = Position.Absolute;
            lens.style.left = lens.style.top = lens.style.right = lens.style.bottom = 0;
            root.Add(lens);
            root.style.opacity = 0;
            HudArt.Show(root, false);
            return root;
        }

        protected override void OnDetach() => Suppress(false);

        public override void ResetState()
        {
            scoped = false;
            alpha = 0;
            zoom = ZoomFrom;
            Apply();
            Suppress(false);
        }

        public override void Tick(in HudFrame f)
        {
            var w = Ctx.Weapons;
            var v = Ctx.Vitals;
            bool on = f.playing && w && w.enabled && w.Active != null && w.Takeover == null && (!v || !v.Dead) && WeaponSight.Scoped(w.FovKick);
            scoped = on;
            Suppress(on);
            float dt = Mathf.Max(0, f.unscaledDt);
            alpha = Mathf.MoveTowards(alpha, on ? 1 : 0, dt / Fade);
            // 镜口：进镜时从 1.06 收到 1（0.2 s 量级），退镜后复位，下次进镜再收一次
            zoom = on ? HudArt.Damp(zoom, 1, 16, dt) : ZoomFrom;
            Apply();
        }

        void Apply()
        {
            if (Root == null) return;
            float a = Mathf.Round(alpha * 50) / 50;
            if (!Mathf.Approximately(a, shownAlpha))
            {
                shownAlpha = a;
                Root.style.opacity = a;
                HudArt.Show(Root, a > 0);
            }
            if (lens != null) lens.Zoom = a > 0 ? zoom : ZoomFrom;
        }

        void Suppress(bool on)
        {
            if (on == suppressing) return;
            suppressing = on;
            var x = Ctx?.Widget<CrosshairWidget>();
            if (x != null) x.Suppressed = on;
        }
    }

    /// <summary>
    /// 镜内画面（Painter2D）：尺寸按内容框的 vmin（较短边的 1%）算，与 TS 的 vmin 一致。
    /// 黑底用奇偶填充挖出圆形镜口（镜口半径 35 vmin 固定，同 TS 的 radial-gradient 不随镜口缩放）；其余（暗影、金边、十字、密位、红点）乘 <see cref="Zoom"/>
    /// </summary>
    public sealed class ScopeLensElement : VisualElement
    {
        static readonly Color Mask = new(0, 0, 0, 0.97f);
        static readonly Color Rim = new(0.831f, 0.663f, 0.333f, 0.28f);
        static readonly Color Hair = new(0, 0, 0, 0.85f);
        static readonly Color Post = Color.black;
        static readonly Color MilDot = new(0, 0, 0, 0.9f);

        float zoom = 1;

        public ScopeLensElement()
        {
            pickingMode = PickingMode.Ignore;
            generateVisualContent += Draw;
            RegisterCallback<GeometryChangedEvent>(_ => MarkDirtyRepaint());
        }

        /// <summary>镜口内容的缩放（1 = 静止）</summary>
        public float Zoom
        {
            get => zoom;
            set
            {
                float q = Mathf.Round(value * 400) / 400;
                if (Mathf.Approximately(q, zoom)) return;
                zoom = q;
                MarkDirtyRepaint();
            }
        }

        void Draw(MeshGenerationContext mgc)
        {
            var r = contentRect;
            if (r.width < 2 || r.height < 2) return;
            float vmin = Mathf.Min(r.width, r.height) / 100f;
            var c = r.center;
            float hole = 35 * vmin, R = hole * zoom;
            var p = mgc.painter2D;

            // 黑底挖圆（奇偶填充：外框 + 圆）
            p.fillColor = Mask;
            p.BeginPath();
            p.MoveTo(new Vector2(r.xMin - 2, r.yMin - 2));
            p.LineTo(new Vector2(r.xMax + 2, r.yMin - 2));
            p.LineTo(new Vector2(r.xMax + 2, r.yMax + 2));
            p.LineTo(new Vector2(r.xMin - 2, r.yMax + 2));
            p.ClosePath();
            p.MoveTo(new Vector2(c.x + hole, c.y));
            p.Arc(c, hole, Angle.Degrees(0), Angle.Degrees(180));
            p.Arc(c, hole, Angle.Degrees(180), Angle.Degrees(360));
            p.ClosePath();
            p.Fill(FillRule.OddEven);

            // 镜口内缘的暗影（TS inset box-shadow 6vmin）：几圈由外向内渐淡的描边
            const int shadeRings = 6;
            float band = 6 * vmin * zoom;
            for (int i = 0; i < shadeRings; i++)
            {
                float t = (i + 0.5f) / shadeRings;
                Circle(p, c, R - band * t, band / shadeRings + 0.5f, new Color(0, 0, 0, 0.72f * (1 - t) * (1 - t)));
            }
            // 外圈黑环 3 px + 细金边 1 px
            Circle(p, c, R + 1.5f, 3, new Color(0, 0, 0, 0.9f));
            Circle(p, c, R, 1, Rim);

            // 十字细线（贯穿镜口）+ 外侧粗柱（长 30% 镜口直径，宽 5 px）
            p.lineCap = LineCap.Butt;
            Line(p, new Vector2(c.x - R, c.y), new Vector2(c.x + R, c.y), 1, Hair);
            Line(p, new Vector2(c.x, c.y - R), new Vector2(c.x, c.y + R), 1, Hair);
            float post = 2 * R * 0.3f;
            Line(p, new Vector2(c.x - R, c.y), new Vector2(c.x - R + post, c.y), 5, Post);
            Line(p, new Vector2(c.x + R, c.y), new Vector2(c.x + R - post, c.y), 5, Post);
            Line(p, new Vector2(c.x, c.y - R), new Vector2(c.x, c.y - R + post), 5, Post);
            Line(p, new Vector2(c.x, c.y + R), new Vector2(c.x, c.y + R - post), 5, Post);

            // 密位点：两轴各 ±5 / ±10 vmin
            foreach (float k in new[] { -10f, -5f, 5f, 10f })
            {
                Dot(p, new Vector2(c.x + k * vmin * zoom, c.y), 2, MilDot);
                Dot(p, new Vector2(c.x, c.y + k * vmin * zoom), 2, MilDot);
            }

            // 中心朱红点 + 一圈辉光
            Dot(p, c, 5, new Color(1f, 0.235f, 0.157f, 0.35f));
            Dot(p, c, 2, UITheme.CinnabarHi);
        }

        static void Circle(Painter2D p, Vector2 c, float radius, float width, Color color)
        {
            if (radius <= 0.5f || color.a <= 0.001f) return;
            p.lineWidth = width;
            p.strokeColor = color;
            p.BeginPath();
            p.Arc(c, radius, Angle.Degrees(0), Angle.Degrees(180));
            p.Arc(c, radius, Angle.Degrees(180), Angle.Degrees(360));
            p.ClosePath();
            p.Stroke();
        }

        static void Line(Painter2D p, Vector2 a, Vector2 b, float width, Color color)
        {
            p.lineWidth = width;
            p.strokeColor = color;
            p.BeginPath();
            p.MoveTo(a);
            p.LineTo(b);
            p.Stroke();
        }

        static void Dot(Painter2D p, Vector2 c, float radius, Color color)
        {
            p.fillColor = color;
            p.BeginPath();
            p.Arc(c, radius, Angle.Degrees(0), Angle.Degrees(180));
            p.Arc(c, radius, Angle.Degrees(180), Angle.Degrees(360));
            p.ClosePath();
            p.Fill();
        }
    }
}
