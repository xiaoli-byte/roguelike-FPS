using UnityEngine;
using UnityEngine.UIElements;

namespace Spiritfire.Game
{
    /// <summary>
    /// 会自动换行（white-space: normal / pre-wrap）的标签按内容量宽时多留一点余量，免得「放得下的一行」被挤断成两行。
    /// 按内容收缩的标签，排版给的宽度正好等于量出来的单行宽，再被两件事挤窄一点点就会把最后一个字折下去（秘卷名「玉⏎碎」、提示条「…⏎×2」、「武器伤害 +55%⏎。」）：
    ///   · 排版把左右边各自取整到屏幕像素格：居中摆放、非整数倍缩放（1280×720 是 ×0.667，1600×900 是 ×0.833）时宽度能丢掉 1 个屏幕像素；
    ///   · 字距（letter-spacing）在测宽里只算进一部分（高级文字生成器：字号 18、字距 6 的四个字只多量 4px）。
    /// 所以宽度不定（Undefined / AtMost）时补上 <see cref="Slack"/> + 字距 × 最长一行的字数（宁多勿少）；宽度给定（Exactly：被拉伸、写死宽度）时不动。
    /// 不换行（nowrap，theme.uss 的默认）的标签不受影响。HudArt.Text / ScreenKit.Text 建的标签和提示条都用它。
    /// </summary>
    public class FitLabel : Label
    {
        /// <summary>固定余量（设计像素）：盖过 ×0.667 缩放下取整丢掉的 1 个屏幕像素（= 1.5 设计像素）</summary>
        public const float Slack = 2f;

        public FitLabel() : this(string.Empty) { }

        public FitLabel(string text) : base(text) { }

        protected override Vector2 DoMeasure(float desiredWidth, MeasureMode widthMode, float desiredHeight, MeasureMode heightMode)
        {
            var size = base.DoMeasure(desiredWidth, widthMode, desiredHeight, heightMode);
            if (widthMode == MeasureMode.Exactly || float.IsNaN(size.x)) return size;
            var ws = resolvedStyle.whiteSpace;
            if (ws != WhiteSpace.Normal && ws != WhiteSpace.PreWrap) return size;
            float w = size.x + Extra(this);
            if (widthMode == MeasureMode.AtMost && w > desiredWidth) w = Mathf.Max(size.x, desiredWidth);
            return new Vector2(w, size.y);
        }

        /// <summary>测宽要补的量：<see cref="Slack"/> + 字距 × 最长一行的字数（富文本去掉标签再数）</summary>
        public static float Extra(TextElement te)
        {
            float ls = te.resolvedStyle.letterSpacing;
            return Slack + (ls > 0 && !float.IsNaN(ls) ? ls * LongestLine(te.text, te.enableRichText) : 0);
        }

        /// <summary>最长一行的字数（不算换行符；rich = 跳过 &lt;…&gt; 标签）</summary>
        public static int LongestLine(string s, bool rich)
        {
            if (string.IsNullOrEmpty(s)) return 0;
            int best = 0, n = 0;
            bool tag = false;
            foreach (char c in s)
            {
                if (rich && c == '<') tag = true;
                else if (tag)
                {
                    if (c == '>') tag = false;
                }
                else if (c == '\n')
                {
                    best = Mathf.Max(best, n);
                    n = 0;
                }
                else if (!char.IsLowSurrogate(c)) n++;
            }
            return Mathf.Max(best, n);
        }
    }
}
