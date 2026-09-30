/**
 * 局外天赋：用魂晶购买，每项多级。数据来自 ctx.meta（talents / talentLevel / buyTalent）。
 */
import type { GameContext, TalentDef } from '../core/types';
import { formatStat } from '../core/Stats';
import { h, icon, button, sfx, clearChildren, formatNum } from './dom';
import { ICON_ESSENCE } from './icons';

export class TalentPanel {
  readonly root: HTMLDivElement;
  private grid: HTMLDivElement;
  private essenceEl: HTMLSpanElement;
  private totalEl: HTMLSpanElement;

  constructor(private readonly ctx: GameContext, onBack: () => void) {
    this.root = h('div', 'gf-talents');
    const head = h('div', 'gf-panel__head gf-panel__head--split', this.root);
    const titles = h('div', null, head);
    h('h2', 'gf-panel__title', titles, '天赋');
    h('p', 'gf-panel__sub', titles, '魂晶在每局结束时结算。天赋对之后的每一局永久生效。');
    const wallet = h('div', 'gf-wallet', head);
    icon(ICON_ESSENCE, 'gf-icon gf-icon--essence', wallet);
    h('span', 'gf-wallet__label', wallet, '魂晶');
    this.essenceEl = h('span', 'gf-wallet__num', wallet);

    this.grid = h('div', 'gf-talents__grid', this.root);
    const foot = h('div', 'gf-panel__foot', this.root);
    this.totalEl = h('span', 'gf-talents__total', foot);
    button(ctx, 'gf-btn gf-btn--primary', foot, '返回', () => onBack());
  }

  refresh(): void {
    const meta = this.ctx.meta;
    this.essenceEl.textContent = formatNum(meta.save.essence);
    clearChildren(this.grid);
    const talents = meta.talents ?? [];
    if (talents.length === 0) {
      h('div', 'gf-empty', this.grid, '暂无可强化的天赋。');
      this.totalEl.textContent = '';
      return;
    }
    let owned = 0;
    let total = 0;
    talents.forEach((t, i) => {
      const lvl = this.level(t);
      owned += lvl;
      total += t.maxLevel;
      this.buildRow(t, lvl, i);
    });
    this.totalEl.textContent = `已点亮 ${owned} / ${total}`;
  }

  private level(t: TalentDef): number {
    try {
      return Math.max(0, Math.min(t.maxLevel, this.ctx.meta.talentLevel(t.id)));
    } catch {
      return 0;
    }
  }

  private buildRow(t: TalentDef, lvl: number, i: number): void {
    const ctx = this.ctx;
    const essence = ctx.meta.save.essence;
    const maxed = lvl >= t.maxLevel;
    const cost = maxed ? 0 : t.cost(lvl);
    const afford = !maxed && essence >= cost;

    const row = h('div', 'gf-talent', this.grid);
    row.style.setProperty('--i', String(i));
    row.classList.toggle('is-maxed', maxed);
    const info = h('div', 'gf-talent__info', row);
    const name = h('div', 'gf-talent__name', info, t.name);
    h('span', 'gf-talent__lvl', name, `${lvl} / ${t.maxLevel}`);
    h('div', 'gf-talent__desc', info, t.description);
    const pips = h('div', 'gf-talent__pips', info);
    for (let k = 0; k < t.maxLevel; k++) h('i', k < lvl ? 'gf-talent__pip is-on' : 'gf-talent__pip', pips);
    const eff = h('div', 'gf-talent__effect', info);
    h('span', null, eff, `当前 ${lvl > 0 ? formatStat(t.stat, t.perLevel * lvl) : '—'}`);
    if (!maxed) h('span', 'gf-talent__next', eff, `下一级 ${formatStat(t.stat, t.perLevel * (lvl + 1))}`);

    const buy = button(ctx, 'gf-btn gf-btn--buy', row, '', () => this.buy(t, row));
    if (maxed) {
      buy.textContent = '已满级';
      buy.disabled = true;
      buy.classList.add('is-disabled');
    } else {
      icon(ICON_ESSENCE, 'gf-icon gf-icon--essence', buy);
      h('span', null, buy, formatNum(cost));
      buy.classList.toggle('is-short', !afford);
      buy.title = afford ? `花费 ${cost} 魂晶强化` : `还差 ${cost - essence} 魂晶`;
    }
  }

  private buy(t: TalentDef, row: HTMLElement): void {
    const ctx = this.ctx;
    let ok = false;
    try {
      ok = ctx.meta.buyTalent(t.id);
      if (ok) ctx.meta.persist();
    } catch (err) {
      console.error('[UI] 购买天赋失败', err);
    }
    if (!ok) {
      sfx(ctx, 'ui_deny');
      row.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }],
        { duration: 240, easing: 'ease-out' },
      );
      return;
    }
    sfx(ctx, 'ui_confirm');
    this.refresh();
    const fresh = this.grid.children[Array.from(ctx.meta.talents).indexOf(t)] as HTMLElement | undefined;
    fresh?.animate([{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 480, easing: 'ease-out' });
  }
}
