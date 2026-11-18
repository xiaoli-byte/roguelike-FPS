/**
 * FitLabel（照译 Unity G/UI/Toolkit/FitLabel.cs 的用意）：会换行的标签按内容量宽时多留一点余量，免得「放得下的一行」被挤断成两行。
 * Unity 里要补两件事：排版把左右边各自取整到屏幕像素格（非整数倍缩放丢 1 个屏幕像素）、字距在测宽里只算进一部分。
 * 浏览器没有这两个问题（排版在缩放之前、字距全算进 max-content），网页的 FitLabel 就是 .sf-text：
 * css/sf-base.css 让它的 min-width 回到 auto（按内容收缩时不小于最长不可断的一段），短句不会被挤断；长句照常在 max-width 处换行。
 * Extra / LongestLine 照译保留（量宽余量的规则，对照测试用）。
 */

/** 固定余量（设计像素）：盖过 ×0.667 缩放下取整丢掉的 1 个屏幕像素（= 1.5 设计像素） */
export const FIT_SLACK = 2;

/** 测宽要补的量：Slack + 字距 × 最长一行的字数（富文本去掉标签再数） */
export function fitExtra(textValue: string, letterSpacing: number, rich = false): number {
  return FIT_SLACK + (letterSpacing > 0 && Number.isFinite(letterSpacing) ? letterSpacing * longestLine(textValue, rich) : 0);
}

/** 最长一行的字数（不算换行符；rich = 跳过 <…> 标签；代理对算一个字） */
export function longestLine(s: string, rich: boolean): number {
  if (!s) return 0;
  let best = 0, n = 0, tag = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = s.charCodeAt(i);
    if (rich && c === '<') tag = true;
    else if (tag) {
      if (c === '>') tag = false;
    } else if (c === '\n') {
      best = Math.max(best, n);
      n = 0;
    } else if (!(code >= 0xdc00 && code <= 0xdfff)) n++;
  }
  return Math.max(best, n);
}
