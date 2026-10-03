/**
 * 按住 Tab 显示：已获得秘卷、关键属性、两把武器详情。
 * 只在打开时、且内容签名变化时重建 DOM。
 */
import type { GameContext, StatKey, WeaponDescription, WeaponInstance } from '../core/types';
import { RARITY_CSS, RARITY_NAMES, ELEMENT_NAMES } from '../core/types';
import { STAT_INFO, formatStat } from '../core/Stats';
import { h, clearChildren, fillStacks } from './dom';
import { ELEMENT_GLYPH, elementCss, weaponName } from './labels';

/** 常驻显示的关键属性（其余属性只有偏离基础值时才显示） */
export const KEY_STATS: StatKey[] = [
  'maxHp', 'maxShield', 'damageReduction', 'moveSpeed',
  'damagePct', 'critChance', 'critDamagePct', 'fireRatePct', 'reloadSpeedPct',
  'elementChancePct', 'elementDamagePct', 'skillDamagePct', 'skillHaste', 'luck',
];

/** 数值越低越好的属性 */
const LOWER_IS_BETTER = new Set<StatKey>(['shieldRegenDelay', 'dashCooldown', 'spreadPct', 'recoilPct']);

/** 显示为带符号加成（+N%）的非 Pct 属性 */
const SIGNED_STATS = new Set<StatKey>(['skillHaste', 'reactionHaste']);

/** 三相元素（elementLabel）的文字颜色：三才转轮的鎏金色 */
const TRI_ELEMENT_CSS = '#e8d6a0';

const ALL_STATS = Object.keys(STAT_INFO) as StatKey[];

/** 属性的「绝对值」显示：Pct 类显示为带符号加成，其余显示当前值 */
export function formatStatValue(key: StatKey, v: number): string {
  if (key.endsWith('Pct') || SIGNED_STATS.has(key)) return formatStat(key, v);
  switch (STAT_INFO[key].format) {
    case 'pct':
      return `${Math.round(v * 100)}%`;
    case 'sec':
      return `${v.toFixed(1)}秒`;
    case 'int':
      return String(Math.round(v));
    default:
      return String(Math.round(v * 10) / 10);
  }
}

/**
 * 把属性列表渲染成两列网格（Tab 面板与暂停菜单共用）。
 * @param full true 时追加所有偏离基础值的属性
 */
export function renderStatGrid(ctx: GameContext, parent: HTMLElement, keys: readonly StatKey[], full: boolean): void {
  clearChildren(parent);
  const stats = ctx.player.stats;
  const list: StatKey[] = keys.slice();
  if (full) {
    for (const k of ALL_STATS) {
      if (list.includes(k)) continue;
      if (Math.abs(stats.get(k) - stats.getBase(k)) > 1e-6) list.push(k);
    }
  }
  for (const k of list) {
    const v = stats.get(k);
    const base = stats.getBase(k);
    const row = h('div', 'gf-stat', parent);
    h('span', 'gf-stat__name', row, STAT_INFO[k].name);
    const val = h('span', 'gf-stat__val', row, formatStatValue(k, v));
    const delta = v - base;
    if (Math.abs(delta) > 1e-6) {
      const better = LOWER_IS_BETTER.has(k) ? delta < 0 : delta > 0;
      val.classList.add(better ? 'is-buff' : 'is-debuff');
      if (!(k.endsWith('Pct') || SIGNED_STATS.has(k))) h('span', 'gf-stat__delta', row, formatStat(k, delta));
    }
  }
}

/** 渲染已获得秘卷列表（Tab 面板与暂停菜单共用） */
export function renderScrollList(ctx: GameContext, parent: HTMLElement, detailed: boolean): number {
  clearChildren(parent);
  const owned = ctx.scrolls.owned();
  if (owned.length === 0) {
    h('div', 'gf-empty', parent, '尚未获得秘卷。清关宝箱与商店都能找到它们。');
    return 0;
  }
  const sorted = owned.slice().sort((a, b) => b.def.rarity - a.def.rarity || b.stacks - a.stacks);
  for (const { def, stacks } of sorted) {
    const row = h('div', detailed ? 'gf-owned gf-owned--detailed' : 'gf-owned', parent);
    row.style.setProperty('--rarity', RARITY_CSS[def.rarity] ?? RARITY_CSS[0]);
    const head = h('div', 'gf-owned__head', row);
    h('span', 'gf-owned__name', head, def.name);
    h('span', 'gf-owned__stacks', head, def.maxStacks > 1 ? `${stacks} / ${def.maxStacks} 层` : RARITY_NAMES[def.rarity] ?? '');
    if (detailed) h('div', 'gf-owned__desc', row, fillStacks(def.description, stacks));
    else row.title = fillStacks(def.description, stacks);
  }
  return owned.length;
}

export class InventoryPanel {
  readonly root: HTMLDivElement;
  private scrollsEl: HTMLDivElement;
  private scrollCount: HTMLSpanElement;
  private statsEl: HTMLDivElement;
  private armsEl: HTMLDivElement;
  private open = false;
  private sig = '';
  private checkAt = 0;

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-tab', parent);
    this.root.hidden = true;

    const colScrolls = h('section', 'gf-tab__col gf-tab__col--scrolls', this.root);
    const head1 = h('h3', 'gf-tab__head', colScrolls, '秘卷');
    this.scrollCount = h('span', 'gf-tab__count', head1);
    this.scrollsEl = h('div', 'gf-tab__list', colScrolls);

    const colStats = h('section', 'gf-tab__col gf-tab__col--stats', this.root);
    h('h3', 'gf-tab__head', colStats, '属性');
    this.statsEl = h('div', 'gf-statgrid', colStats);

    const colArms = h('section', 'gf-tab__col gf-tab__col--arms', this.root);
    h('h3', 'gf-tab__head', colArms, '武器');
    this.armsEl = h('div', 'gf-tab__arms', colArms);
  }

  setOpen(v: boolean, now: number): void {
    if (v === this.open) return;
    this.open = v;
    if (v) {
      this.sig = '';
      this.checkAt = 0;
      this.update(now);
      this.root.hidden = false;
      void this.root.offsetWidth;
      this.root.classList.add('is-open');
    } else {
      this.root.classList.remove('is-open');
      this.root.hidden = true;
    }
  }

  update(now: number): void {
    if (!this.open || now < this.checkAt) return;
    this.checkAt = now + 250;
    const sig = this.signature();
    if (sig === this.sig) return;
    this.sig = sig;
    this.rebuild();
  }

  private signature(): string {
    const ctx = this.ctx;
    let s = `${ctx.player.stats.version}|${ctx.weapons.activeSlot}|`;
    for (const o of ctx.scrolls.owned()) s += `${o.def.id}:${o.stacks},`;
    for (const w of ctx.weapons.slots) s += w ? `|${w.uid}.${w.level}.${w.rarity}.${w.element}.${w.affixes.length}` : '|-';
    return s;
  }

  private rebuild(): void {
    const ctx = this.ctx;
    const n = renderScrollList(ctx, this.scrollsEl, true);
    this.scrollCount.textContent = n > 0 ? String(n) : '';
    renderStatGrid(ctx, this.statsEl, KEY_STATS, true);

    clearChildren(this.armsEl);
    const slots = ctx.weapons.slots;
    for (let i = 0; i < slots.length; i++) {
      const w = slots[i];
      const card = h('div', 'gf-arm', this.armsEl);
      if (i === ctx.weapons.activeSlot) card.classList.add('is-active');
      h('span', 'gf-arm__slot', card, String(i + 1));
      if (!w) {
        card.classList.add('is-empty');
        h('div', 'gf-arm__name', card, '空槽');
        continue;
      }
      this.renderWeapon(card, w);
    }
  }

  private renderWeapon(card: HTMLElement, w: WeaponInstance): void {
    let desc: WeaponDescription | null;
    try {
      desc = this.ctx.weapons.describe(w);
    } catch {
      desc = null;
    }
    const color = desc?.color || RARITY_CSS[w.rarity] || RARITY_CSS[0];
    card.style.setProperty('--rarity', color);
    const name = h('div', 'gf-arm__name', card, desc?.name || weaponName(w.defId));
    if (w.level > 0) h('span', 'gf-arm__lvl', name, `+${w.level}`);
    const meta = h('div', 'gf-arm__meta', card);
    h('span', null, meta, desc?.rarityName || RARITY_NAMES[w.rarity] || '');
    if (desc?.category) h('span', null, meta, desc.category);
    if (desc?.elementLabel) {
      // 特殊元素显示（三才转轮：火 → 雷 → 蚀 轮转）
      const el = h('span', 'gf-arm__elem', meta, `${desc.elementLabel} 轮转`);
      el.style.color = TRI_ELEMENT_CSS;
    } else if (w.element !== 'none') {
      const el = h('span', 'gf-arm__elem', meta, `${ELEMENT_GLYPH[w.element]} ${ELEMENT_NAMES[w.element]}`);
      el.style.color = elementCss(w.element);
    }
    if (desc && desc.stats.length) {
      const grid = h('div', 'gf-arm__stats', card);
      for (const s of desc.stats) {
        const row = h('div', 'gf-arm__stat', grid);
        h('span', null, row, s.label);
        h('b', null, row, s.value);
      }
    }
    if (desc && desc.traits.length) {
      const traits = h('ul', 'gf-arm__traits', card);
      for (const t of desc.traits) h('li', null, traits, t);
    }
  }
}
