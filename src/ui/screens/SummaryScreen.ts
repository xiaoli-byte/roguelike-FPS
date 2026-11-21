/**
 * 整局结算（照译 Unity G/UI/Screens/SummaryScreen.cs，样式 css/unity/menu.css 的 .sf-summary）：
 *   大字「胜利 / 败北」（逐字落墨）+ 题记、英雄徽记与止步关卡、六格数值（用时 / 清关 / 击杀 / 总伤害 / 灵石 / 获得魂晶，错开滚动计数）、
 *   魂晶来源（局内收集 + 通关奖励）、秘卷 chips（稀有度色、×层数）、武器 chips；按钮「再来一局 · 英雄名」/「主菜单」。
 * 参数是 RunSummary（Game.endRun → UI.showSummary 传进来）。挡游戏：summary；返回键不关（二选一）。
 */
import type { GameContext, RunSummary } from '../../core/types';
import { CHAPTER_COUNT } from '../../core/types';
import { isLast, specOf } from '../../progression/RunPlan';
import { epitaphText, essenceNote, reachText } from '../ScreenData';
import { sfx } from '../dom';
import { el, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { UIIcon } from '../toolkit/UIIcons';
import { type BlockState, UIScreen } from '../toolkit/UIRouter';
import { Cinnabar, Gold, paint, radialSoft, rarityClass, withAlpha } from '../toolkit/UITheme';
import { btn, clock, crest, easeOut, icon, num, setCrest } from './ScreenKit';

export const SUMMARY_ID = 'summary';
export const COUNT_TIME = 0.9, COUNT_DELAY = 0.35, COUNT_STAGGER = 0.09;
/** 通关奖励的魂晶（Game.endRun 里胜利时加的那一笔） */
export const VICTORY_BONUS = 200;

interface Counter {
  label: HTMLDivElement;
  cell: HTMLDivElement;
  value: number;
  format: (v: number) => string;
  index: number;
}

export class SummaryScreen extends UIScreen {
  readonly id = SUMMARY_ID;
  override get blockState(): BlockState {
    return 'summary';
  }
  override get defaultFocus(): HTMLElement | null {
    return this.retryBtn;
  }

  private readonly counters: Counter[] = [];
  private readonly titleChars: HTMLDivElement[] = [];
  private rootEl!: HTMLDivElement;
  private glow!: HTMLDivElement;
  private panel!: HTMLDivElement;
  private stats!: HTMLDivElement;
  private scrollChips!: HTMLDivElement;
  private weaponChips!: HTMLDivElement;
  private crestEl!: HTMLDivElement;
  private heroRow!: HTMLDivElement;
  private epitaph!: HTMLDivElement;
  private heroName!: HTMLDivElement;
  private reach!: HTMLDivElement;
  private essenceNoteEl!: HTMLDivElement;
  private retryBtn: HTMLButtonElement | null = null;
  private openedAt = 0;
  /** 当前显示的结算（测试用） */
  summary: RunSummary | null = null;

  constructor(private readonly ctx: GameContext, private readonly now: () => number) {
    super();
  }

  /** 计数滚动都到终值了（测试用） */
  get settled(): boolean {
    return this.now() - this.openedAt >= COUNT_DELAY + COUNT_STAGGER * this.counters.length + COUNT_TIME;
  }

  protected build(): HTMLElement {
    const ctx = this.ctx;
    const root = (this.rootEl = el('sf-summary', null, 'summary'));
    el('sf-summary__bg', root);
    this.glow = el('sf-summary__glow', root);
    this.panel = el('sf-summary__panel', root);
    const title = el('sf-summary__title', this.panel);
    for (let i = 0; i < 2; i++) this.titleChars.push(text('sf-summary__char', title, '', UIFontRole.Title));
    this.epitaph = text('sf-summary__epitaph', this.panel, '');
    this.heroRow = el('sf-summary__hero', this.panel);
    this.crestEl = crest(null, this.heroRow);
    const hi = el('sf-summary__heroinfo', this.heroRow);
    this.heroName = text('sf-summary__heroname', hi, '', UIFontRole.Title);
    this.reach = text('sf-summary__reach', hi, '');
    this.stats = el('sf-summary__stats', this.panel);
    this.essenceNoteEl = text('sf-summary__essence', this.panel, '');
    const lists = el('sf-summary__lists', this.panel);
    const sc = el('sf-summary__list', lists);
    text('sf-summary__listtitle', sc, '秘卷', UIFontRole.Title);
    this.scrollChips = el('sf-chips', sc);
    const wc = el('sf-summary__list', lists);
    text('sf-summary__listtitle', wc, '武器', UIFontRole.Title);
    this.weaponChips = el('sf-chips', wc);
    const foot = el('sf-summary__foot', this.panel);
    this.retryBtn = btn(ctx, '再来一局', 'sf-btn--primary sf-btn--wide sf-sound-confirm', foot, () => this.retry());
    this.retryBtn.dataset.name = 'summary-retry';
    btn(ctx, '主菜单', 'sf-btn--ghost sf-btn--wide', foot, () => this.toMenu()).dataset.name = 'summary-menu';
    return root;
  }

  /** 「再来一局」：同英雄新开一局 */
  retry(): void {
    const id = this.summary?.heroId ?? this.ctx.heroes[0]?.id ?? '';
    this.close();
    this.ctx.game.startRun(id);
  }

  /** 「主菜单」（这一局已经结算过） */
  toMenu(): void {
    this.close();
    this.ctx.game.toMenu();
  }

  /** 返回键不关 */
  override onBack(): boolean {
    return true;
  }

  override onOpen(arg?: unknown): void {
    const s = (this.summary = (arg as RunSummary | null) ?? this.summary ?? ({ victory: false, heroId: '', chapter: 0, stageIndex: 0, stagesCleared: 0, kills: 0, damageDealt: 0, time: 0, coins: 0, essenceEarned: 0, scrolls: [], weapons: [] } as RunSummary));
    this.openedAt = this.now();
    const hero = this.ctx.heroes.find((h) => h.id === s.heroId) ?? null;
    toggle(this.rootEl, 'sf-summary--victory', s.victory);
    toggle(this.rootEl, 'sf-summary--defeat', !s.victory);
    paint(this.glow, radialSoft(s.victory ? withAlpha(Gold, 0.32) : withAlpha(Cinnabar, 0.36)));
    const word = s.victory ? '胜利' : '败北';
    this.titleChars.forEach((ch, i) => (ch.textContent = word[i] ?? ''));
    let spec: ReturnType<typeof specOf> = null, last = true;
    try {
      spec = specOf(this.ctx.run ?? null, this.ctx.run?.stage);
      last = !spec || isLast(spec);
    } catch {
      spec = null;
    }
    this.epitaph.textContent = epitaphText(s.victory, s.victory && !last, CHAPTER_COUNT);
    setCrest(this.crestEl, hero);
    this.heroName.textContent = hero ? `${hero.name} · ${hero.title}` : '无名侠客';
    this.reach.textContent = reachText(s, spec, last);
    this.retryBtn!.textContent = hero ? `再来一局 · ${hero.name}` : '再来一局';

    this.stats.replaceChildren();
    this.counters.length = 0;
    this.add(UIIcon.Hourglass, null, '用时', s.time, clock);
    this.add(UIIcon.Gate, null, '清关', s.stagesCleared, (v) => `${Math.round(v)} 关`);
    this.add(UIIcon.Skull, null, '击杀', s.kills, num);
    this.add(UIIcon.Spark, null, '总伤害', s.damageDealt, num);
    this.add(UIIcon.Coin, 'sf-icon--coin', '灵石', s.coins, num);
    this.add(UIIcon.Essence, 'sf-icon--essence', '获得魂晶', s.essenceEarned, (v) => '+' + num(v)).cell.classList.add('sf-summary__stat--essence');
    this.essenceNoteEl.textContent = essenceNote(s.essenceEarned, s.victory ? VICTORY_BONUS : 0);

    this.scrollChips.replaceChildren();
    const list = (s.scrolls ?? []).slice().sort((a, b) => b.rarity - a.rarity);
    if (list.length === 0) text('sf-empty', this.scrollChips, '本局未获得秘卷');
    for (const e of list) {
      const chip = el('sf-chip ' + rarityClass(e.rarity), this.scrollChips);
      text('sf-chip__name', chip, e.name);
      if (e.stacks > 1) text('sf-chip__count', chip, '×' + e.stacks, UIFontRole.Number);
    }
    this.weaponChips.replaceChildren();
    if (!s.weapons?.length) text('sf-empty', this.weaponChips, '—');
    else for (const name of s.weapons) text('sf-chip__name', el('sf-chip sf-chip--weapon', this.weaponChips), name);
    this.tick();
    sfx(this.ctx, 'ui_confirm');
  }

  private add(i: UIIcon, iconClass: string | null, label: string, value: number, format: (v: number) => string): Counter {
    const cell = el('sf-summary__stat', this.stats);
    icon(i, iconClass, cell);
    text('sf-summary__slabel', cell, label);
    const c: Counter = { label: text('sf-summary__sval', cell, format(0), UIFontRole.Number), cell, value, format, index: this.counters.length };
    this.counters.push(c);
    return c;
  }

  override tick(): void {
    const t = this.now() - this.openedAt;
    // 大字逐字落墨：放大 1.25 → 1、淡入、下落
    this.titleChars.forEach((ch, i) => {
      const k = easeOut((t - 0.05 - i * 0.16) / 0.8);
      ch.style.opacity = k.toFixed(3);
      const s = 1.25 + (1 - 1.25) * k;
      ch.style.scale = `${s.toFixed(4)} ${s.toFixed(4)}`;
      ch.style.translate = `0px ${(-18 * (1 - k)).toFixed(2)}px`;
    });
    this.epitaph.style.opacity = easeOut((t - 0.45) / 0.8).toFixed(3);
    this.heroRow.style.opacity = easeOut((t - 0.25) / 0.6).toFixed(3);
    this.panel.style.opacity = Math.min(1, Math.max(0, t / 0.25)).toFixed(3);
    for (const c of this.counters) {
      const start = COUNT_DELAY + c.index * COUNT_STAGGER;
      const o = easeOut((t - start + 0.25) / 0.5);
      c.cell.style.opacity = o.toFixed(3);
      c.cell.style.translate = `0px ${(10 * (1 - o)).toFixed(2)}px`;
      const s = c.format(c.value * easeOut((t - start) / COUNT_TIME));
      if (c.label.textContent !== s) c.label.textContent = s;
    }
  }
}
