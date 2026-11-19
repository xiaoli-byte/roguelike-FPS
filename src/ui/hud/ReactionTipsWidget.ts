/**
 * 元素反应首遇教学（照译 Unity G/UI/Widgets/ReactionTips.cs）：每局每种反应第一次出现（enemy:reaction）时，右上信息角下方滑出一张教学卡：
 *   反应名（标题字体、反应色）+「元素反应」小签；配方行 = 元素小标（灼 / 雷 / 蚀，归墟三相）→ 效果；一句说明。
 *   停 5.5 s（不缩放时间），右滑出场；同时来了几种就排队一张张出。
 * 「已教过」记在 ctx.run.flags（rx:<id>，同旧的网页 ReactionTips），每局新建 RunState 时自然重置。旧的网页版是一条 toast，这里换成 Unity 的卡片。
 */
import { REACTION_COLORS, REACTION_NAMES, type ReactionId } from '../../core/types';
import { el, setOpacity, setTranslate, text } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { css, elementColor, fadeLeft, paint, rgb } from '../toolkit/UITheme';
import { type HudFrame, HudWidget } from './HudWidget';

const ShowTime = 5.5, InTime = 0.35, OutTime = 0.4;

/** 每种反应的配方元素、效果与说明（文案同 Unity / Three.js REACTION_TIPS） */
export const TIPS: Record<ReactionId, { parts: ('fire' | 'shock' | 'corrode')[]; effect: string; desc: string }> = {
  thunderfire: { parts: ['fire', 'shock'], effect: '雷火爆炸', desc: '灼烧遇上雷殛：引爆雷火，点燃周围敌人' },
  meltdown: { parts: ['fire', 'corrode'], effect: '熔穿护甲', desc: '灼烧遇上蚀化：熔穿护甲，留下熔池' },
  veinseal: { parts: ['shock', 'corrode'], effect: '击碎护盾', desc: '雷殛遇上蚀化：击碎护盾，麻痹并导流蚀化' },
  abyss: { parts: ['fire', 'shock', 'corrode'], effect: '三段重击', desc: '三相齐聚：三段重击，余波震退' },
};

export class ReactionTipsWidget extends HudWidget {
  readonly id = 'reaction-tips';
  override readonly order = 58;

  private card!: HTMLDivElement;
  private recipe!: HTMLDivElement;
  private nameLabel!: HTMLDivElement;
  private tag!: HTMLDivElement;
  private effect!: HTMLDivElement;
  private desc!: HTMLDivElement;
  private readonly queue: ReactionId[] = [];
  private showing: ReactionId | null = null;
  private shownAt = -10;

  /** 正在显示的反应（测试用） */
  get Showing(): ReactionId | null {
    return this.showing;
  }

  protected build(): HTMLElement {
    const root = el('sf-rtips');
    this.card = el('sf-rtip', root);
    paint(this.card, fadeLeft([0.027, 0.024, 0.04, 0.9]));
    const head = el('sf-rtip__head', this.card);
    this.tag = text('sf-rtip__tag', head, '元素反应');
    this.nameLabel = text('sf-rtip__name', head, '', UIFontRole.Title);
    this.recipe = el('sf-rtip__recipe', this.card);
    this.effect = text('sf-rtip__effect', null, '', UIFontRole.Title);
    this.desc = text('sf-rtip__desc', this.card);
    this.card.style.display = 'none';
    return root;
  }

  protected override onAttach(): void {
    this.listen(this.game.events.on('enemy:reaction', ({ reaction }) => this.teach(reaction)));
  }

  override resetState(): void {
    this.queue.length = 0;
    this.showing = null;
    this.card.style.display = 'none';
  }

  /** 这一局第一次见到这种反应就排队教学（已经教过返回 false） */
  teach(r: ReactionId): boolean {
    if (!TIPS[r]) return false;
    const flags = this.game.run?.flags;
    const key = 'rx:' + r;
    if (flags) {
      if (flags[key]) return false;
      flags[key] = 1;
    }
    if (this.showing === r || this.queue.includes(r)) return false;
    this.queue.push(r);
    return true;
  }

  /** 立刻显示一张（不查「已教过」；测试 / 截图用） */
  show(r: ReactionId): void {
    this.showing = r;
    this.shownAt = performance.now() / 1000;
    const tip = TIPS[r];
    const c = css(rgb(REACTION_COLORS[r]));
    this.nameLabel.textContent = REACTION_NAMES[r];
    this.nameLabel.style.color = c;
    this.card.style.borderLeftColor = c;
    this.tag.style.borderColor = c;
    this.tag.style.color = c;
    // 配方：元素小标 × … → 效果
    this.recipe.replaceChildren();
    tip.parts.forEach((e, k) => {
      if (k > 0) text('sf-rtip__op', this.recipe, '×');
      const badge = el('sf-rtip__badge', this.recipe);
      badge.style.backgroundColor = css(elementColor(e));
      text('sf-rtip__glyph', badge, e === 'fire' ? '灼' : e === 'shock' ? '雷' : '蚀', UIFontRole.Title);
    });
    text('sf-rtip__op', this.recipe, '→');
    this.effect.textContent = tip.effect;
    this.effect.style.color = c;
    this.recipe.appendChild(this.effect);
    this.desc.textContent = tip.desc;
    this.card.style.display = '';
    this.animate(this.shownAt);
  }

  override tick(f: HudFrame): void {
    const now = f.unscaledTime;
    if (this.showing === null) {
      if (this.queue.length > 0) this.show(this.queue.shift()!);
      return;
    }
    if (now - this.shownAt >= ShowTime + OutTime || now < this.shownAt) {
      this.showing = null;
      this.card.style.display = 'none';
      return;
    }
    this.animate(now);
  }

  private animate(now: number): void {
    const t = now - this.shownAt;
    let k: number;
    if (t < InTime) k = 1 - Math.pow(1 - Math.min(1, Math.max(0, t / InTime)), 3);
    else if (t > ShowTime) k = 1 - Math.min(1, Math.max(0, (t - ShowTime) / OutTime));
    else k = 1;
    setOpacity(this.card, k);
    setTranslate(this.card, 36 * (1 - k), 0);
  }
}
