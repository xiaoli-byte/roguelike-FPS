using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 顶部罗盘条（docs/unity-parity.md U7；Three.js AdventureHUD 的方向指示，D：不做常驻小地图）：
    ///   · 一条 560 设计像素宽的方位带，覆盖视线左右各 75°：每 15° 一道刻度，45° 长刻度，北 / 东 / 南 / 西大字、东北等小字，两端渐隐；正中一枚鎏金小三角是准心朝向；
    ///   · 地点徽记（<see cref="MapMarkers"/>：场地「战」、藏宝「宝」、补给营「营」、出口「门」、首领「首」、灵火坛「火」）按方位落在带上，只显示发现过的；
    ///     颜色跟状态走（交战红、肃清青绿、未动琥珀…）；
    ///   · 目标：金色菱框 + 下方距离「128 米」；转到视线外时贴在带子内侧并加 ← / →；准心对着它（±25°）时带子下面写「前往 · 雅丹石阵」。
    /// 首领血条在场时收起（两者都在顶部正中，首领战里目标就是首领）。朝向取眼睛（不含镜头震动），只写变化了的样式。
    /// </summary>
    [HudWidget("compass", Order = 45)]
    public sealed class CompassStrip : HudWidget
    {
        public const float Width = 560f, Span = 150f, Half = Span * 0.5f, CaptionCone = 25f;
        const float PxPerDeg = Width / Span, BadgeSize = 20f, EdgeClamp = Half - 6f;
        static readonly string[] Dir8 = { "北", "东北", "东", "东南", "南", "西南", "西", "西北" };

        public override string StyleSheet => MapScreen.StylePath;

        sealed class Notch
        {
            public VisualElement root;
            public Label label;
            public float deg;
            public float x = float.NaN, a = -1;
        }

        sealed class Mark
        {
            public VisualElement root, badge;
            public Label glyph, dist, arrow;
            public MapMarker marker;
            public bool shown, target;
            public float x = float.NaN;
            public int meters = -1;
            public string arrowText = "";
            public Color color;
        }

        VisualElement strip, ticksLayer, marksLayer;
        Label caption;
        readonly List<Notch> ticks = new();
        readonly List<Mark> marks = new();
        int builtVersion = -1;
        float lastYaw = float.NaN;
        string captionText = "";

        /// <summary>当前朝向（度，0 = 北；测试用）</summary>
        public float Heading { get; private set; }

        /// <summary>带上显示着的徽记（测试用：名字、相对视线的角度、是不是目标、距离文字）</summary>
        public IEnumerable<(string name, float x, bool target, string distance)> Shown
        {
            get
            {
                foreach (var m in marks)
                    if (m.shown) yield return (m.marker.name, m.x - Width * 0.5f, m.target, m.dist.text);
            }
        }

        /// <summary>带子下方的目标说明（测试用）</summary>
        public string Caption => captionText;

        protected override VisualElement Build()
        {
            var root = HudArt.El("sf-compass");
            strip = HudArt.El("sf-compass__strip", root);
            UITheme.Paint(strip, UITheme.FadeBoth, new Color(0.027f, 0.024f, 0.04f, 0.72f));
            HudArt.El("sf-compass__rule", strip);
            ticksLayer = HudArt.El("sf-compass__layer", strip);
            marksLayer = HudArt.El("sf-compass__layer", strip);
            HudArt.El("sf-compass__notch", strip);
            for (int i = 0; i < 24; i++)
            {
                float deg = i * 15f;
                bool cardinal = i % 6 == 0, inter = !cardinal && i % 3 == 0;
                var t = new Notch { deg = deg, root = HudArt.El("sf-compass__tick" + (cardinal ? " is-cardinal" : inter ? " is-major" : ""), ticksLayer) };
                HudArt.El("sf-compass__line", t.root);
                if (cardinal || inter) t.label = HudArt.Text("sf-compass__dir", t.root, Dir8[i / 3], cardinal ? UIFontRole.Title : UIFontRole.Body);
                ticks.Add(t);
            }
            caption = HudArt.Text("sf-compass__caption", root, "", UIFontRole.Title);
            caption.style.opacity = 0;
            return root;
        }

        public override void ResetState()
        {
            builtVersion = -1;
            lastYaw = float.NaN;
        }

        void RebuildMarks()
        {
            builtVersion = MapMarkers.Version;
            var all = MapMarkers.All;
            while (marks.Count < all.Count)
            {
                var m = new Mark { root = HudArt.El("sf-compass__mark", marksLayer) };
                HudArt.El("sf-compass__diamond", m.root);
                m.badge = HudArt.El("sf-compass__badge", m.root);
                m.glyph = HudArt.Text("sf-compass__glyph", m.badge, "", UIFontRole.Title);
                m.arrow = HudArt.Text("sf-compass__arrow", m.root, "");
                m.dist = HudArt.Text("sf-compass__dist", m.root, "", UIFontRole.Number);
                m.root.style.display = DisplayStyle.None;
                marks.Add(m);
            }
            for (int i = 0; i < marks.Count; i++)
            {
                var m = marks[i];
                m.marker = i < all.Count ? all[i] : null;
                m.shown = false;
                m.x = float.NaN;
                m.meters = -1;
                m.target = false;
                m.color = default;
                m.arrowText = "";
                m.arrow.text = "";
                HudArt.Toggle(m.root, "is-target", false);
                m.root.style.display = DisplayStyle.None;
                if (m.marker != null) m.glyph.text = MapMarkers.Glyph(m.marker.kind);
            }
        }

        public override void Tick(in HudFrame f)
        {
            var pv = Ctx.Vitals;
            var motor = Ctx.Motor;
            var cam = Ctx.Cam;
            Transform eye = motor && motor.eye ? motor.eye : cam ? cam.transform : null;
            bool show = pv && eye && GameUI.Boss == null;
            Visible = show;
            if (!show) return;

            MapMarkers.Tick(pv.transform.position);
            float yaw = MapMarkers.Heading(eye);
            Heading = yaw;
            if (float.IsNaN(lastYaw) || Mathf.Abs(Mathf.DeltaAngle(yaw, lastYaw)) > 0.05f)
            {
                lastYaw = yaw;
                foreach (var t in ticks) PlaceTick(t, Mathf.DeltaAngle(yaw, t.deg));
            }
            if (builtVersion != MapMarkers.Version) RebuildMarks();

            var player = pv.transform.position;
            var target = MapMarkers.Target;
            string cap = "";
            foreach (var m in marks)
            {
                var k = m.marker;
                if (k == null) continue;
                bool isTarget = k == target;
                float rel = Mathf.DeltaAngle(yaw, MapMarkers.Bearing(player, k.position));
                bool inView = Mathf.Abs(rel) <= Half;
                bool shown = k.Visible && (inView || isTarget);
                if (shown != m.shown)
                {
                    m.shown = shown;
                    m.root.style.display = shown ? DisplayStyle.Flex : DisplayStyle.None;
                }
                if (!shown) continue;
                if (isTarget != m.target)
                {
                    m.target = isTarget;
                    HudArt.Toggle(m.root, "is-target", isTarget);
                    m.meters = -1;
                    if (!isTarget) m.dist.text = "";
                }
                float clamped = Mathf.Clamp(rel, -EdgeClamp, EdgeClamp); // 两端留 6°：视线外的目标贴在带子内侧
                float x = Mathf.Round((Width * 0.5f + clamped * PxPerDeg) * 2) * 0.5f;
                if (!Mathf.Approximately(x, m.x))
                {
                    m.x = x;
                    m.root.style.left = x - BadgeSize * 0.5f;
                }
                string arrow = !isTarget || inView ? "" : rel < 0 ? "←" : "→";
                if (arrow != m.arrowText)
                {
                    m.arrowText = arrow;
                    m.arrow.text = arrow;
                    HudArt.Toggle(m.arrow, "is-right", rel > 0);
                }
                var c = MapMarkers.Color(k);
                if (c != m.color)
                {
                    m.color = c;
                    m.badge.style.borderTopColor = m.badge.style.borderRightColor = m.badge.style.borderBottomColor = m.badge.style.borderLeftColor = c;
                    m.glyph.style.color = c;
                }
                // 两端渐隐（目标贴边时不淡）
                float a = isTarget ? 1 : 1 - Mathf.SmoothStep(0, 1, Mathf.InverseLerp(Half * 0.72f, Half, Mathf.Abs(rel)));
                a *= k.state == MarkerState.Done ? 0.7f : 1;
                float qa = Mathf.Round(a * 20) / 20;
                if (!Mathf.Approximately(m.root.style.opacity.value, qa)) m.root.style.opacity = qa;
                if (isTarget)
                {
                    int meters = Mathf.RoundToInt(k.distance);
                    if (meters != m.meters)
                    {
                        m.meters = meters;
                        m.dist.text = meters + " 米";
                    }
                    if (Mathf.Abs(rel) <= CaptionCone)
                        cap = string.IsNullOrEmpty(MapMarkers.TargetVerb) ? k.name : $"{MapMarkers.TargetVerb} · {k.name}";
                }
            }
            if (cap != captionText)
            {
                if (cap.Length > 0) caption.text = cap;
                captionText = cap;
            }
            float ca = caption.style.opacity.value;
            float want = captionText.Length > 0 ? 1 : 0;
            if (!Mathf.Approximately(ca, want)) caption.style.opacity = Mathf.MoveTowards(ca, want, f.unscaledDt / 0.18f);
        }

        void PlaceTick(Notch t, float rel)
        {
            bool on = Mathf.Abs(rel) <= Half;
            float a = on ? 1 - Mathf.SmoothStep(0, 1, Mathf.InverseLerp(Half * 0.6f, Half, Mathf.Abs(rel))) : 0;
            a = Mathf.Round(a * 20) / 20;
            if (!Mathf.Approximately(a, t.a))
            {
                t.a = a;
                t.root.style.opacity = a;
                t.root.style.display = a > 0 ? DisplayStyle.Flex : DisplayStyle.None;
            }
            if (a <= 0) return;
            float x = Mathf.Round((Width * 0.5f + rel * PxPerDeg) * 2) * 0.5f;
            if (!Mathf.Approximately(x, t.x))
            {
                t.x = x;
                t.root.style.left = x;
            }
        }
    }
}
