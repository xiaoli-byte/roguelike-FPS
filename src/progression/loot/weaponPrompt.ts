import type { GameContext, InteractPrompt, WeaponInstance } from '../../core/types';
import { ELEMENT_NAMES } from '../../core/types';

/**
 * 武器交互提示：名称 / 稀有度 / 类别 / 元素 / 属性，并逐项对比当前手持武器。
 * action 为动词（「拾取」「购买」），cost 为价格（商店）。
 *
 * 对比：同一项数值单位一致时标 ▲（更好）/ ▼（更差），UI 据此把整行染成绿 / 红。
 * 「强化」已写在副标题里，不再单列；「元素」为物理时不列。
 */

/** 数值越小越好的属性 */
const LOWER_IS_BETTER: ReadonlySet<string> = new Set(['换弹']);
const SKIP: ReadonlySet<string> = new Set(['强化']);
const NUM_RE = /-?\d+(?:\.\d+)?/;

/** 把属性值拆成「第一个数字」和「其余部分」（用来判断两者单位 / 格式是否可比） */
function splitNum(v: string): { n: number; shape: string } | null {
  const m = NUM_RE.exec(v);
  if (!m) return null;
  return { n: parseFloat(m[0]), shape: v.slice(0, m.index) + '#' + v.slice(m.index + m[0].length) };
}

function compareLine(label: string, value: string, cur: string | undefined): string {
  if (cur === undefined || cur === value) return `${label}  ${value}`;
  const a = splitNum(value);
  const b = splitNum(cur);
  let mark = '';
  if (a && b && a.shape === b.shape && a.n !== b.n) {
    const better = LOWER_IS_BETTER.has(label) ? a.n < b.n : a.n > b.n;
    mark = better ? ' ▲' : ' ▼';
  }
  return `${label}  ${value}${mark}（当前 ${cur}）`;
}

export function weaponPrompt(ctx: GameContext, inst: WeaponInstance, action: string, cost?: number): InteractPrompt {
  const w = ctx.weapons;
  const d = w.describe(inst);
  const cur = w.active && w.active.uid !== inst.uid ? w.active : null;
  const cd = cur ? w.describe(cur) : null;

  const lines: string[] = [];
  for (const s of d.stats) {
    if (SKIP.has(s.label)) continue;
    if (s.label === '元素' && d.element === 'none') continue;
    const c = cd?.stats.find((x) => x.label === s.label);
    lines.push(compareLine(s.label, s.value, c?.value));
  }
  for (const t of d.traits) lines.push(`◆ ${t}`);
  if (cd) {
    const full = w.slots.every((s) => s !== null);
    lines.push(full ? `将替换当前武器：${cd.name}` : `放入空槽位，保留${cd.name}`);
  }

  const parts = [action, d.rarityName || '', d.category || ''].filter((x) => x.length > 0);
  if (d.element !== 'none') parts.push(ELEMENT_NAMES[d.element]);
  if (inst.level > 0) parts.push(`强化 +${inst.level}`);
  return { title: d.name, subtitle: parts.join(' · '), lines, color: d.color, cost };
}
