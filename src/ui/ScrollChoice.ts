/**
 * 秘卷三选一：三张「挂轴」卡片依次展开。装裱绫绢的颜色 = 稀有度。
 * 点击或按 1/2/3 选择：在处理函数里同步调用 onPick(s)，然后 ctx.game.closeModal()。
 */
import type { GameContext, ScrollDef } from '../core/types';
import { RARITY_CSS, RARITY_NAMES } from '../core/types';
import { h, bindButton, sfx, Presence, clearChildren, fillStacks, unlockAudio } from './dom';
import { tagName } from './labels';

export class ScrollChoice {
  readonly root: HTMLDivElement;
  private presence: Presence;
  private cardsEl: HTMLDivElement;
  private options: ScrollDef[] = [];
  private cards: HTMLElement[] = [];
  private onPick: ((s: ScrollDef) => void) | null = null;
  private picked = true;
  private openedAt = 0;

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-choice gf-screen', parent);
    this.presence = new Presence(this.root, 420);
    h('div', 'gf-choice__backdrop', this.root);
    const head = h('div', 'gf-choice__head', this.root);
    h('h2', 'gf-choice__title', head, '择一秘卷');
    h('p', 'gf-choice__sub', head, '点击卡片，或按 1 / 2 / 3 选择');
    this.cardsEl = h('div', 'gf-choice__cards', this.root);
  }

  get visible(): boolean {
    return this.presence.visible;
  }

  /** 正在等待玩家选择 */
  get pending(): boolean {
    return this.presence.visible && !this.picked;
  }

  show(options: ScrollDef[], onPick: (s: ScrollDef) => void): void {
    this.options = options.slice(0, 3);
    this.onPick = onPick;
    this.picked = false;
    this.openedAt = performance.now();
    this.root.classList.remove('is-picked');
    clearChildren(this.cardsEl);
    this.cards = this.options.map((s, i) => this.buildCard(s, i));
    this.presence.show();
  }

  hide(immediate = false): void {
    this.picked = true;
    this.onPick = null;
    this.presence.hide(immediate);
  }

  /** 返回 true 表示已处理 */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.presence.visible || this.picked) return false;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (!m) return false;
    const i = Number(m[1]) - 1;
    if (i >= this.options.length) return false;
    unlockAudio(this.ctx);
    sfx(this.ctx, 'ui_click');
    this.pick(i);
    return true;
  }

  private pick(i: number): void {
    if (this.picked) return;
    // 刚弹出时的误触保护（例如正在连点射击）
    if (performance.now() - this.openedAt < 250) return;
    const s = this.options[i];
    if (!s) return;
    this.picked = true;
    const cb = this.onPick;
    this.onPick = null;
    this.cards.forEach((c, k) => c.classList.add(k === i ? 'is-chosen' : 'is-rejected'));
    this.root.classList.add('is-picked');
    sfx(this.ctx, 'ui_confirm');
    try {
      cb?.(s);
    } catch (err) {
      console.error('[UI] 秘卷选择回调出错', err);
    }
    // 必须在同一个用户手势内同步调用，才能重新锁定鼠标
    this.ctx.game.closeModal();
    window.setTimeout(() => {
      if (this.picked) this.presence.hide();
    }, 360);
  }

  private buildCard(s: ScrollDef, i: number): HTMLElement {
    const ctx = this.ctx;
    const cur = safeStacks(ctx, s.id);
    const next = Math.min(s.maxStacks, cur + 1);
    const rarity = RARITY_CSS[s.rarity] ?? RARITY_CSS[0];

    const card = h('button', 'gf-scroll', this.cardsEl);
    card.type = 'button';
    card.style.setProperty('--rarity', rarity);
    card.style.setProperty('--i', String(i));
    card.dataset.rarity = String(s.rarity);
    bindButton(ctx, card, () => this.pick(i));

    h('span', 'gf-scroll__rod gf-scroll__rod--top', card);
    const roll = h('span', 'gf-scroll__roll', card);
    const silk = h('span', 'gf-scroll__silk', roll);
    const paper = h('span', 'gf-scroll__paper', silk);

    const seal = h('span', 'gf-scroll__rarity', paper, RARITY_NAMES[s.rarity] ?? '');
    seal.title = `稀有度：${RARITY_NAMES[s.rarity] ?? ''}`;
    h('span', 'gf-scroll__state', paper, cur > 0 ? '升层' : '新得');
    h('span', 'gf-scroll__name', paper, s.name);
    h('span', 'gf-scroll__rule', paper);
    h('span', 'gf-scroll__desc', paper, fillStacks(s.description, next));

    const stacks = h('span', 'gf-scroll__stacks', paper);
    if (s.maxStacks > 1) {
      const pips = h('span', 'gf-scroll__pips', stacks);
      for (let k = 0; k < s.maxStacks; k++) {
        h('i', k < cur ? 'gf-scroll__pip is-owned' : k < next ? 'gf-scroll__pip is-next' : 'gf-scroll__pip', pips);
      }
      h('span', 'gf-scroll__count', stacks, `层数 ${cur} → ${next} / ${s.maxStacks}`);
    } else {
      h('span', 'gf-scroll__count', stacks, '唯一');
    }

    const tags = [...(s.tags ?? [])];
    const tagsEl = h('span', 'gf-scroll__tags', paper);
    if (s.heroOnly) {
      const hero = ctx.heroes.find((x) => x.id === s.heroOnly);
      h('span', 'gf-scroll__tag gf-scroll__tag--hero', tagsEl, `${hero ? hero.name : s.heroOnly}专属`);
    }
    for (const t of tags) h('span', 'gf-scroll__tag', tagsEl, tagName(t));
    if (!tagsEl.childElementCount) tagsEl.remove();

    h('span', 'gf-scroll__rod gf-scroll__rod--bottom', card);
    h('span', 'gf-scroll__key', card, String(i + 1));
    return card;
  }
}

function safeStacks(ctx: GameContext, id: string): number {
  try {
    return Math.max(0, ctx.scrolls.stacks(id));
  } catch {
    return 0;
  }
}
