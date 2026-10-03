/**
 * 英雄选择：三张卡片（名称、称号、描述、主题色、基础属性、Q/E 技能与被动、初始武器）。
 * 点击选中，「出征」或双击卡片开始；键盘 1/2/3 选择、Enter 确认。
 */
import type { GameContext, HeroDef, SkillDef, StatKey } from '../core/types';
import { BASE_STATS, STAT_INFO } from '../core/Stats';
import { h, icon, button, bindButton, sfx, clearChildren, formatNum } from './dom';
import { ICON_ESSENCE, ICON_LOCK } from './icons';
import { WEAPON_NAMES, fmtStat, heroColor, heroGlyph } from './labels';

/** 未解锁英雄的解锁价格（魂晶）。目前设计中三名英雄默认解锁，这里只是兜底。 */
const HERO_UNLOCK_COST = 300;

/** 卡片上固定显示的三项基础属性 */
const CORE_STATS: { key: StatKey; label: string }[] = [
  { key: 'maxHp', label: '生命' },
  { key: 'maxShield', label: '护盾' },
  { key: 'moveSpeed', label: '移速' },
];

export class HeroSelect {
  readonly root: HTMLDivElement;
  private grid: HTMLDivElement;
  private confirmBtn: HTMLButtonElement;
  private cards: HTMLElement[] = [];
  private selected = 0;
  private built = false;

  constructor(private readonly ctx: GameContext, onBack: () => void) {
    this.root = h('div', 'gf-heroes');
    const head = h('div', 'gf-panel__head', this.root);
    h('h2', 'gf-panel__title', head, '选择英雄');
    h('p', 'gf-panel__sub', head, '每位英雄有独立的技能、被动与初始武器。按 1 / 2 / 3 快速选择。');
    this.grid = h('div', 'gf-heroes__grid', this.root);
    const foot = h('div', 'gf-panel__foot', this.root);
    button(ctx, 'gf-btn gf-btn--ghost', foot, '返回', () => onBack());
    this.confirmBtn = button(ctx, 'gf-btn gf-btn--primary gf-btn--wide', foot, '出征', () => this.confirm());
  }

  refresh(): void {
    if (!this.built) {
      this.built = true;
      this.build();
    }
    this.syncLocks();
    this.select(Math.min(this.selected, Math.max(0, this.cards.length - 1)), false);
  }

  /** 返回 true 表示已处理该按键 */
  handleKey(e: KeyboardEvent): boolean {
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (m) {
      const n = Number(m[1]) - 1;
      if (n < this.cards.length) {
        this.select(n, true);
        return true;
      }
      return false;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      this.confirm();
      return true;
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const d = e.code === 'ArrowLeft' ? -1 : 1;
      this.select((this.selected + d + this.cards.length) % Math.max(1, this.cards.length), true);
      return true;
    }
    return false;
  }

  private heroes(): readonly HeroDef[] {
    return this.ctx.heroes ?? [];
  }

  private unlocked(id: string): boolean {
    try {
      return this.ctx.meta.isHeroUnlocked(id);
    } catch {
      return true;
    }
  }

  private select(i: number, withSound: boolean): void {
    if (this.cards.length === 0) return;
    this.selected = i;
    this.cards.forEach((c, k) => {
      c.classList.toggle('is-selected', k === i);
      c.setAttribute('aria-pressed', String(k === i));
    });
    const hero = this.heroes()[i];
    if (hero) {
      const ok = this.unlocked(hero.id);
      this.confirmBtn.textContent = ok ? `出征 · ${hero.name}` : '尚未解锁';
      this.confirmBtn.disabled = !ok;
      this.confirmBtn.classList.toggle('is-disabled', !ok);
      this.root.style.setProperty('--hero', heroColor(hero));
    }
    if (withSound) sfx(this.ctx, 'ui_hover');
  }

  /** 在点击处理函数里同步调用 startRun */
  private confirm(): void {
    const hero = this.heroes()[this.selected];
    if (!hero) return;
    if (!this.unlocked(hero.id)) {
      sfx(this.ctx, 'ui_deny');
      return;
    }
    sfx(this.ctx, 'ui_confirm');
    this.ctx.game.startRun(hero.id);
  }

  private syncLocks(): void {
    const heroes = this.heroes();
    this.cards.forEach((card, i) => {
      const hero = heroes[i];
      if (!hero) return;
      const locked = !this.unlocked(hero.id);
      card.classList.toggle('is-locked', locked);
      const lock = card.querySelector<HTMLElement>('.gf-hero__lock');
      if (lock) lock.hidden = !locked;
    });
  }

  private build(): void {
    clearChildren(this.grid);
    this.cards = [];
    this.heroes().forEach((hero, i) => {
      const card = this.buildCard(hero, i);
      this.cards.push(card);
    });
  }

  private buildCard(hero: HeroDef, i: number): HTMLElement {
    const ctx = this.ctx;
    const card = h('article', 'gf-hero', this.grid);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.style.setProperty('--hero', heroColor(hero));
    card.style.setProperty('--i', String(i));
    bindButton(ctx, card, () => this.select(i, false));
    card.addEventListener('dblclick', () => {
      this.select(i, false);
      this.confirm();
    });

    h('span', 'gf-hero__index', card, String(i + 1));
    const top = h('header', 'gf-hero__top', card);
    const medal = h('div', 'gf-hero__medal', top);
    h('span', 'gf-hero__glyph', medal, heroGlyph(hero));
    const names = h('div', 'gf-hero__names', top);
    h('h3', 'gf-hero__name', names, hero.name);
    h('div', 'gf-hero__title', names, hero.title);
    if (hero.description) h('p', 'gf-hero__desc', card, hero.description);

    // 基础属性
    const stats = h('div', 'gf-hero__stats', card);
    for (const s of CORE_STATS) {
      const v = hero.base[s.key] ?? BASE_STATS[s.key];
      const chip = h('div', 'gf-hero__stat', stats);
      h('span', null, chip, s.label);
      h('b', null, chip, String(Math.round(v * 10) / 10));
    }
    const extras = h('div', 'gf-hero__extras', card);
    for (const key of Object.keys(hero.base) as StatKey[]) {
      if (CORE_STATS.some((c) => c.key === key)) continue;
      const v = hero.base[key];
      if (v === undefined || v === BASE_STATS[key]) continue;
      const delta = v - BASE_STATS[key];
      h('span', 'gf-hero__extra', extras, `${STAT_INFO[key]?.name ?? key} ${fmtStat(key, delta)}`);
    }
    if (!extras.childElementCount) extras.remove();

    // 技能
    const skills = h('div', 'gf-hero__skills', card);
    this.skillRow(skills, 'Q', hero.primary, false);
    this.skillRow(skills, 'E', hero.secondary, true);
    const passive = h('div', 'gf-hero__skill gf-hero__skill--passive', skills);
    h('span', 'gf-hero__key', passive, '被动');
    const pb = h('div', 'gf-hero__sbody', passive);
    h('div', 'gf-hero__sname', pb, hero.passive.name || '—');
    if (hero.passive.description) h('div', 'gf-hero__sdesc', pb, hero.passive.description);

    // 初始武器
    const wpn = h('footer', 'gf-hero__weapon', card);
    const info = WEAPON_NAMES[hero.startingWeapon];
    h('span', 'gf-hero__wlabel', wpn, '初始武器');
    h('b', null, wpn, info?.name ?? hero.startingWeapon);
    if (info) h('span', 'gf-hero__wcat', wpn, info.category);

    // 未解锁遮罩
    const lock = h('div', 'gf-hero__lock', card);
    lock.hidden = true;
    icon(ICON_LOCK, 'gf-icon gf-hero__lockicon', lock);
    h('div', 'gf-hero__locktext', lock, '尚未解锁');
    const unlockBtn = h('button', 'gf-btn gf-btn--primary gf-btn--sm', lock);
    unlockBtn.type = 'button';
    icon(ICON_ESSENCE, 'gf-icon gf-icon--essence', unlockBtn);
    h('span', null, unlockBtn, `${formatNum(HERO_UNLOCK_COST)} 解锁`);
    bindButton(ctx, unlockBtn, (e) => {
      e.stopPropagation();
      let ok = false;
      try {
        ok = ctx.meta.unlockHero(hero.id, HERO_UNLOCK_COST);
        if (ok) ctx.meta.persist();
      } catch (err) {
        console.error('[UI] 解锁英雄失败', err);
      }
      if (ok) {
        sfx(ctx, 'ui_confirm');
        ctx.ui.toast(`已解锁 ${hero.name}`, heroColor(hero));
      } else {
        sfx(ctx, 'ui_deny');
        ctx.ui.toast('魂晶不足', '#ff6a4d');
      }
      this.syncLocks();
      this.select(i, false);
    });
    return card;
  }

  private skillRow(parent: HTMLElement, key: string, def: SkillDef, secondary: boolean): void {
    const row = h('div', 'gf-hero__skill', parent);
    h('span', 'gf-hero__key', row, key);
    const body = h('div', 'gf-hero__sbody', row);
    const name = h('div', 'gf-hero__sname', body, def.name || '—');
    const meta: string[] = [];
    if (def.cooldown > 0) meta.push(`冷却 ${Math.round(def.cooldown * 10) / 10} 秒`);
    if (secondary || def.charges > 1) meta.push(`${Math.max(1, def.charges)} 充能`);
    if (meta.length) h('span', 'gf-hero__smeta', name, meta.join(' · '));
    if (def.description) h('div', 'gf-hero__sdesc', body, def.description);
  }
}
