import type { ScrollDef } from '../core/types';
import { OFFENSE_SCROLLS } from './scrolls/defsOffense';
import { ELEMENT_SCROLLS } from './scrolls/defsElement';
import { UTILITY_SCROLLS } from './scrolls/defsUtility';
import { LEGEND_SCROLLS } from './scrolls/defsLegend';
import { REACTION_SCROLLS } from './scrolls/defsReaction';

/**
 * 全部秘卷定义（DESIGN.md 第 10 节；反应秘卷 24 个见 docs/arsenal-expansion.md 第 6 节，共 98 个）。
 * 每个效果都真实生效：属性修饰（source = scroll:<id>）或事件 / 修饰器 / 常驻任务触发。
 */
export const SCROLL_DEFS: readonly ScrollDef[] = (() => {
  const all = [...OFFENSE_SCROLLS, ...ELEMENT_SCROLLS, ...UTILITY_SCROLLS, ...LEGEND_SCROLLS, ...REACTION_SCROLLS];
  const seen = new Set<string>();
  for (const d of all) {
    if (seen.has(d.id)) console.warn(`[Scrolls] 重复的秘卷 id：${d.id}`);
    seen.add(d.id);
  }
  return all;
})();
