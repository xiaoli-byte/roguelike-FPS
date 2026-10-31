using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 精英头顶印章（第二批收尾 D 路，2026-10-31；挂在 <see cref="EnemyBars"/> 的精英血条顶上）：
    /// 小体型精英（跳鼠刀兵 0.4 m）在 10 m 外，脚下金环里的词缀纹样只剩几十个像素——印章把「精英 + 哪种词缀」竖起来放到头顶，远处也读得出。
    ///   · 样子：鎏金印章（<see cref="EliteSealTextures.Frame"/>：墨底 + 粗金带 + 四颗菱形钉 + 底下朝下的金尖），里面套金环同款的词缀纹样、同一个词缀色
    ///     （<see cref="EliteAura.Sigil"/> / <see cref="EliteAura.Accent"/>）；没有词缀的是一颗四芒金星。坚盾亮度跟护盾、狂暴醒前暗——跟着金环的 <see cref="EliteAura.Level"/>。
    ///   · 距离：<see cref="NearHide"/> m 以内不画（近处金环、名字都看得清，印章只会挡视线），到 <see cref="NearFull"/> m 淡满；
    ///     屏幕上的大小按距离从 <see cref="PxNear"/> 涨到 <see cref="PxFar"/> 像素（抵掉血条本身随距离缩小），远处不跟着缩没；
    ///     40–45 m 和血条一起淡出、被墙挡住时和血条一起半透明（锚点的透明度）。
    ///   · 准星：印章中心离屏幕中心 <see cref="AimClear"/> 像素以内时淡到 <see cref="AimAlpha"/>（瞄着它打时不和准星抢）。
    /// 每帧只在变化超过阈值时写样式（缩放、透明度、亮度），元素随血条槽位复用。
    /// </summary>
    public sealed class EliteSeal
    {
        /// <summary>设计尺寸（面板像素）：宽 × 高（高里含金尖）</summary>
        public const float Width = 32f, Height = Width * EliteSealTextures.H / EliteSealTextures.W;
        /// <summary>近处隐藏 / 淡满的距离（米）</summary>
        public const float NearHide = 6f, NearFull = 9f;
        /// <summary>屏幕上的宽度（面板像素）：NearFull 处 → 30 m 处</summary>
        public const float PxNear = 30f, PxFar = 35f, FarAt = 30f;
        /// <summary>离准星多近开始让（面板像素）、让到多淡</summary>
        public const float AimClear = 70f, AimTight = 30f, AimAlpha = 0.35f;
        /// <summary>印章和血条之间的空隙（面板像素，设计尺寸）</summary>
        const float Gap = 2f;

        /// <summary>金框的颜色（金环同色 #ffc233，界面不走 HDR）</summary>
        public static readonly Color Gold = new(EliteAura.Gold.r, EliteAura.Gold.g, EliteAura.Gold.b, 1f);

        readonly VisualElement root, inner;
        EliteAura aura;
        EliteSigil shown = (EliteSigil)(-1);
        Color shownTint = Color.clear;
        float alpha = -1, scale = -1, level = -1;

        /// <summary>这一帧的不透明度（0 = 没画；测试 / 套件读）</summary>
        public float Alpha => alpha < 0 ? 0 : alpha;
        /// <summary>这一帧在屏幕上的宽度（面板像素，不含锚点透明度）</summary>
        public float Pixels { get; private set; }
        /// <summary>印章里画的是哪种词缀（None = 四芒金星）</summary>
        public EliteSigil Sigil => shown < 0 ? EliteSigil.None : shown;
        public VisualElement Root => root;

        public EliteSeal(VisualElement bar)
        {
            root = new VisualElement { name = "elite-seal", pickingMode = PickingMode.Ignore };
            root.AddToClassList("sf-ebar__seal");
            root.usageHints = UsageHints.DynamicTransform | UsageHints.DynamicColor;
            var s = root.style;
            s.position = Position.Absolute;
            s.left = Length.Percent(50);
            s.bottom = Length.Percent(100);
            s.width = Width;
            s.height = Height;
            s.marginLeft = -Width * 0.5f;
            s.marginBottom = Gap;
            s.transformOrigin = new TransformOrigin(Length.Percent(50), Length.Percent(100));
            UITheme.Paint(root, EliteSealTextures.Frame, Gold);
            // 内圈：圆心离顶边半宽，词缀纹样铺满内圈墨底
            inner = new VisualElement { name = "elite-seal-sigil", pickingMode = PickingMode.Ignore };
            inner.usageHints = UsageHints.DynamicColor;
            float d = Width * EliteSealTextures.Inner;
            var si = inner.style;
            si.position = Position.Absolute;
            si.left = (Width - d) * 0.5f;
            si.top = (Width - d) * 0.5f;
            si.width = d;
            si.height = d;
            root.Add(inner);
            bar.Add(root);
            root.style.display = DisplayStyle.None;
        }

        /// <summary>血条槽位分给一只敌人时调：精英挂印章，不是精英藏起来</summary>
        public void Bind(EnemyAI e, bool elite)
        {
            aura = elite && e ? e.GetComponent<EliteAura>() : null;
            shown = (EliteSigil)(-1);
            alpha = scale = level = -1;
            Pixels = 0;
            root.style.display = elite ? DisplayStyle.Flex : DisplayStyle.None;
            root.style.opacity = 0;
            alpha = 0;
            if (elite) Sync();
        }

        public void Unbind()
        {
            aura = null;
            root.style.display = DisplayStyle.None;
        }

        /// <summary>纹样 / 颜色跟着金环（爆裂死亡、去词缀都会改）；亮度跟金环的 Level</summary>
        void Sync()
        {
            var sig = aura && aura.Accent.HasValue ? aura.Sigil : EliteSigil.None;
            var tint = sig == EliteSigil.None ? Gold : aura.Accent.Value;
            tint.a = 1;
            if (sig != shown || tint != shownTint)
            {
                shown = sig;
                shownTint = tint;
                UITheme.Paint(inner, sig == EliteSigil.None ? EliteSealTextures.Core : EliteSigilTextures.Sigil(sig), tint);
                level = -1;
            }
            // 坚盾跟护盾（破盾只剩暗框）、狂暴醒前暗：0.45 → 1
            float lv = sig == EliteSigil.None || !aura ? 1f : Mathf.Clamp01(0.4f + 0.6f * Mathf.Min(1f, aura.Level));
            if (Mathf.Abs(lv - level) > 0.04f)
            {
                level = lv;
                inner.style.opacity = lv;
            }
        }

        /// <summary>
        /// 每帧：dist = 到相机的距离（米），barScale = 血条这一帧的缩放，head = 锚点（头顶）的面板坐标，barHeight = 血条的排版高度（设计像素）
        /// </summary>
        public void Tick(float dist, float barScale, Vector2 head, Vector2 panel, float barHeight)
        {
            if (root.style.display == DisplayStyle.None) return;
            float px = PixelsAt(dist);
            float k = px / Width / Mathf.Max(0.05f, barScale);
            if (Mathf.Abs(k - scale) > 0.01f)
            {
                scale = k;
                root.style.scale = new Scale(new Vector3(k, k, 1));
            }
            Pixels = px;
            // 印章中心的面板坐标：头顶往上 = 血条高 × 缩放 + 空隙 + 半个印章
            float up = (float.IsNaN(barHeight) ? 24f : barHeight) * barScale + Gap * barScale + px * Height / Width * 0.5f;
            var c = new Vector2(head.x, head.y - up);
            float a = FadeAt(dist) * AimFade(Vector2.Distance(c, panel * 0.5f));
            if (Mathf.Abs(a - alpha) > 0.02f || (a == 0) != (alpha == 0))
            {
                alpha = a;
                root.style.opacity = a;
            }
            if (a > 0) Sync();
        }

        /// <summary>距离淡入：NearHide 以内 0，到 NearFull 满（smoothstep）</summary>
        public static float FadeAt(float dist)
        {
            float t = Mathf.Clamp01((dist - NearHide) / (NearFull - NearHide));
            return t * t * (3 - 2 * t);
        }

        /// <summary>屏幕上的宽度（面板像素）：NearFull → FarAt 从 PxNear 涨到 PxFar</summary>
        public static float PixelsAt(float dist) => Mathf.Lerp(PxNear, PxFar, Mathf.InverseLerp(NearFull, FarAt, dist));

        /// <summary>离准星的让位：AimClear 像素以外 1，AimTight 以内 AimAlpha</summary>
        public static float AimFade(float pxFromCenter) => Mathf.Lerp(AimAlpha, 1f, Mathf.InverseLerp(AimTight, AimClear, pxFromCenter));
    }
}
