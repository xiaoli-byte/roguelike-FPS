import type { GameContext, InteractPrompt, WeaponInstance } from '../../core/types';
import { ELEMENT_NAMES } from '../../core/types';

/**
 * 武器交互提示：名称 / 稀有度 / 类别 / 元素 / 属性，并逐项对比当前手持武器。
 * action 为动词（「拾取」「购买」），cost 为价格（商店）。
 */
export function weaponPrompt(ctx: GameContext, inst: WeaponInstance, action: string, cost?: number): InteractPrompt {
  const w = ctx.weapons;
  const d = w.describe(inst);
  const cur = w.active && w.active.uid !== inst.uid ? w.active : null;
  const cd = cur ? w.describe(cur) : null;

  const lines: string[] = [];
  for (const s of d.stats) {
    const c = cd?.stats.find((x) => x.label === s.label);
    lines.push(c && c.value !== s.value ? `${s.label}  ${s.value}（当前 ${c.value}）` : `${s.label}  ${s.value}`);
  }
  for (const t of d.traits) lines.push(`◆ ${t}`);
  if (cd) {
    const full = w.slots.every((s) => s !== null);
    lines.push(full ? `将替换当前武器：${cd.name}` : `放入空槽位（当前：${cd.name}）`);
  }

  const parts = [action, d.rarityName || '', d.category || ''].filter((x) => x.length > 0);
  if (d.element !== 'none') parts.push(ELEMENT_NAMES[d.element]);
  if (inst.level > 0) parts.push(`强化 +${inst.level}`);
  return { title: d.name, subtitle: parts.join(' · '), lines, color: d.color, cost };
}
