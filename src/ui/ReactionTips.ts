/**
 * 元素反应首次提示：每局每种反应第一次出现时弹出一条 toast 教学（docs/arsenal-expansion.md 第 9.E 节）。
 * 只监听 'enemy:reaction'；「已提示」记录写在 ctx.run.flags['rx:<id>']，每局新建 RunState 时自动重置。
 */
import type { GameContext, ReactionId } from '../core/types';
import { REACTION_COLORS, REACTION_IDS } from '../core/types';
import { cssHex } from './dom';

/** 首次触发某反应时的教学文案 */
export const REACTION_TIPS: Record<ReactionId, string> = {
  thunderfire: '元素反应「焚雷」：灼烧 × 雷殛 → 雷火爆炸，点燃周围敌人',
  meltdown: '元素反应「熔金」：灼烧 × 蚀化 → 熔穿护甲，留下熔池',
  veinseal: '元素反应「封脉」：雷殛 × 蚀化 → 击碎护盾，麻痹并导流蚀化',
  abyss: '元素反应「归墟」：三相齐聚 → 三段重击，余波震退',
};

// 预先拼好 flags 键与 CSS 颜色，事件回调里不拼字符串
const FLAG_KEYS = {} as Record<ReactionId, string>;
const TIP_COLORS = {} as Record<ReactionId, string>;
for (const id of REACTION_IDS) {
  FLAG_KEYS[id] = 'rx:' + id;
  TIP_COLORS[id] = cssHex(REACTION_COLORS[id]);
}

export class ReactionTips {
  private off: (() => void) | null = null;

  /** @param toast 提示输出（UIManager.toast） */
  constructor(
    private readonly ctx: GameContext,
    private readonly toast: (text: string, color?: string) => void,
  ) {}

  init(): void {
    if (this.off) return;
    this.off = this.ctx.events.on('enemy:reaction', ({ reaction }) => this.onReaction(reaction));
  }

  dispose(): void {
    this.off?.();
    this.off = null;
  }

  private onReaction(id: ReactionId): void {
    const key = FLAG_KEYS[id];
    if (!key) return;
    const flags = this.ctx.run.flags;
    if (flags[key]) return;
    flags[key] = 1;
    try {
      this.toast(REACTION_TIPS[id], TIP_COLORS[id]);
    } catch (err) {
      console.error('[UI] 反应提示显示失败', err);
    }
  }
}
