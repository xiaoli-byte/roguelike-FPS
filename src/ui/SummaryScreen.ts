/**
 * 结算界面：胜利 / 失败大标题、英雄、到达的章节关卡、用时、击杀、总伤害、金币、魂晶、
 * 秘卷与武器列表。按钮：再来一局（同英雄）/ 主菜单。
 */
import type { GameContext, RunSummary } from '../core/types';
import { RARITY_CSS, STAGES_PER_CHAPTER } from '../core/types';
import { formatTime } from '../core/math';
import { h, icon, button, Presence, formatNum, countUp, clearChildren } from './dom';
import { ICON_COIN, ICON_ESSENCE, ICON_GATE, ICON_HOURGLASS, ICON_SKULL, ICON_SPARK } from './icons';
import { cnNum, heroColor, heroGlyph } from './labels';

export class SummaryScreen {
  readonly root: HTMLDivElement;
  private presence: Presence;
  private titleEl: HTMLHeadingElement;
  private epitaphEl: HTMLDivElement;
  private crestGlyph: HTMLSpanElement;
  private heroEl: HTMLDivElement;
  private reachEl: HTMLDivElement;
  private statsEl: HTMLDivElement;
  private scrollsEl: HTMLDivElement;
  private weaponsEl: HTMLDivElement;
  private retryBtn: HTMLButtonElement;
  private summary: RunSummary | null = null;

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-summary gf-screen', parent);
    this.presence = new Presence(this.root, 360);
    h('div', 'gf-summary__bg', this.root);
    const panel = h('div', 'gf-summary__panel', this.root);

    this.titleEl = h('h1', 'gf-summary__title', panel);
    this.epitaphEl = h('div', 'gf-summary__epitaph', panel);

    const hero = h('div', 'gf-summary__hero', panel);
    const crest = h('div', 'gf-summary__crest', hero);
    this.crestGlyph = h('span', null, crest);
    const hi = h('div', null, hero);
    this.heroEl = h('div', 'gf-summary__heroname', hi);
    this.reachEl = h('div', 'gf-summary__reach', hi);

    this.statsEl = h('div', 'gf-summary__stats', panel);

    const lists = h('div', 'gf-summary__lists', panel);
    const sc = h('section', 'gf-summary__list', lists);
    h('h3', null, sc, '秘卷');
    this.scrollsEl = h('div', 'gf-chips', sc);
    const wc = h('section', 'gf-summary__list', lists);
    h('h3', null, wc, '武器');
    this.weaponsEl = h('div', 'gf-chips', wc);

    const foot = h('div', 'gf-summary__foot', panel);
    this.retryBtn = button(ctx, 'gf-btn gf-btn--primary gf-btn--wide', foot, '再来一局', () => {
      const s = this.summary;
      if (s) this.ctx.game.startRun(s.heroId);
    });
    button(ctx, 'gf-btn gf-btn--ghost gf-btn--wide', foot, '主菜单', () => this.ctx.game.toMenu());
  }

  get visible(): boolean {
    return this.presence.visible;
  }

  show(s: RunSummary): void {
    this.summary = s;
    const ctx = this.ctx;
    const hero = ctx.heroes.find((x) => x.id === s.heroId) ?? null;
    this.root.classList.toggle('is-victory', s.victory);
    this.root.classList.toggle('is-defeat', !s.victory);
    this.root.style.setProperty('--hero', heroColor(hero));

    clearChildren(this.titleEl);
    for (const ch of s.victory ? '胜利' : '败北') h('span', null, this.titleEl, ch);
    this.epitaphEl.textContent = s.victory ? '三章尽破，烈焰长明' : '魂火未熄，再入轮回';

    this.crestGlyph.textContent = heroGlyph(hero);
    this.heroEl.textContent = hero ? `${hero.name} · ${hero.title}` : '无名侠客';
    const stageNo = s.stageIndex >= STAGES_PER_CHAPTER - 1 ? '首领关' : `第 ${s.stageIndex + 1} 关`;
    this.reachEl.textContent = s.victory ? '已击败全部首领' : `止步于 第${cnNum(s.chapter + 1)}章 · ${stageNo}`;
    this.retryBtn.textContent = hero ? `再来一局 · ${hero.name}` : '再来一局';

    // 数值（滚动计数）
    clearChildren(this.statsEl);
    const items: { svg: string; label: string; value: number; fmt: (v: number) => string; cls?: string }[] = [
      { svg: ICON_HOURGLASS, label: '用时', value: s.time, fmt: (v) => formatTime(v) },
      { svg: ICON_GATE, label: '清关', value: s.stagesCleared, fmt: (v) => `${Math.round(v)} 关` },
      { svg: ICON_SKULL, label: '击杀', value: s.kills, fmt: (v) => formatNum(v) },
      { svg: ICON_SPARK, label: '总伤害', value: s.damageDealt, fmt: (v) => formatNum(v) },
      { svg: ICON_COIN, label: '金币', value: s.coins, fmt: (v) => formatNum(v), cls: 'gf-icon--coin' },
      { svg: ICON_ESSENCE, label: '获得魂晶', value: s.essenceEarned, fmt: (v) => `+${formatNum(v)}`, cls: 'gf-icon--essence' },
    ];
    items.forEach((it, i) => {
      const cell = h('div', 'gf-summary__stat', this.statsEl);
      cell.style.setProperty('--i', String(i));
      if (it.label === '获得魂晶') cell.classList.add('is-essence');
      icon(it.svg, `gf-icon ${it.cls ?? ''}`.trim(), cell);
      h('span', 'gf-summary__slabel', cell, it.label);
      const v = h('b', 'gf-summary__sval', cell);
      countUp(v, it.value, 900, it.fmt, 350 + i * 90);
    });

    clearChildren(this.scrollsEl);
    if (s.scrolls.length === 0) h('span', 'gf-empty', this.scrollsEl, '本局未获得秘卷');
    for (const sc of s.scrolls.slice().sort((a, b) => b.rarity - a.rarity)) {
      const chip = h('span', 'gf-chip', this.scrollsEl, sc.name);
      chip.style.setProperty('--rarity', RARITY_CSS[sc.rarity] ?? RARITY_CSS[0]);
      if (sc.stacks > 1) h('small', null, chip, `×${sc.stacks}`);
    }
    clearChildren(this.weaponsEl);
    if (s.weapons.length === 0) h('span', 'gf-empty', this.weaponsEl, '—');
    for (const w of s.weapons) h('span', 'gf-chip gf-chip--weapon', this.weaponsEl, w);

    this.presence.show();
  }

  hide(): void {
    this.presence.hide();
  }
}
