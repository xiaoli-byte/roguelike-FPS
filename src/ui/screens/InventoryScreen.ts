/**
 * Tab 行囊面板（照译 Unity G/UI/Screens/InventoryPanel.cs + WeaponCard.cs，样式 css/unity/screens.css 的 .sf-inv / .sf-arm / .sf-petcard）：
 *   「行囊」页三栏——已获得秘卷（带当前层数下的说明）、属性网格（关键属性 + 所有偏离基础值的）、两把武器卡
 *   （槽位、名字 + 强化、品质 · 类别 · 元素、数值格、特性与词条）；
 *   「灵宠」页——结契灵宠的品阶、称号、灵契等级与经验、攻击方式、被动、灵技、觉醒（没有灵宠时写怎么结契）。
 * Tab 开 / 关，开着时停住游戏（Game 的 modal 状态）。关：Tab / Esc。页签：点击，或 Q / E。打开时按当前状态重建。
 * 网页差异：武器卡的数值格用武器系统的描述（ctx.weapons.describe 的 stats，条数随武器而定），Unity 固定六格；
 *   灵宠本体是 M9，数据走 PetSource，没接时灵宠页是空态。
 */
import type { GameContext, StatKey, WeaponInstance } from '../../core/types';
import { ELEMENT_NAMES, RARITY_NAMES } from '../../core/types';
import type { KeyBinds } from '../KeyBinds';
import { type PetSource, petStateText, petXpRatio } from '../PetData';
import { ELEMENT_GLYPH } from '../labels';
import { el, show, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { type BlockState, UIScreen } from '../toolkit/UIRouter';
import { css, elementColor, lerpColor, rarityColor, rgb } from '../toolkit/UITheme';
import { card, easeOut, gameModal, num, num1, renderScrollList, renderStatGrid, scroll } from './ScreenKit';

export const INVENTORY_ID = 'inventory';
export const BAG_TAB = '行囊', PET_TAB = '灵宠';
/** 行囊属性页的关键属性（Unity StatGrid.KeyStats；其余偏离基础值的自动补上） */
export const KEY_STATS: StatKey[] = ['maxHp', 'maxShield', 'damagePct', 'critChance', 'critDamagePct', 'fireRatePct', 'reloadSpeedPct', 'moveSpeed', 'skillHaste', 'damageReduction', 'dashCharges', 'luck'];

export class InventoryScreen extends UIScreen {
  readonly id = INVENTORY_ID;
  override get blockState(): BlockState {
    return 'modal';
  }
  override get defaultFocus(): HTMLElement | null {
    return this.tabs[this.current]?.tab ?? null;
  }

  private readonly tabs: { name: string; tab: HTMLButtonElement; page: HTMLDivElement }[] = [];
  private frame!: HTMLDivElement;
  private scrollsList!: HTMLDivElement;
  private statsGrid!: HTMLDivElement;
  private arms!: HTMLDivElement;
  private petPage!: HTMLDivElement;
  private scrollCount!: HTMLDivElement;
  private current = 0;
  private openedAt = 0;
  private readonly modal = gameModal(() => this.ctx);
  /** 上次重建时的秘卷数 / 武器卡数（测试用） */
  scrollRows = 0;
  weaponCards = 0;

  constructor(private readonly ctx: GameContext, private readonly keys: KeyBinds, private readonly pets: () => PetSource, private readonly now: () => number) {
    super();
  }

  get currentTab(): string | null {
    return this.tabs[this.current]?.name ?? null;
  }

  protected build(): HTMLElement {
    const root = el('sf-inv', null, 'inventory');
    el('sf-backdrop sf-inv__backdrop', root);
    this.frame = el('sf-frame sf-inv__frame', root);
    const head = el('sf-inv__head', this.frame);
    const tabRow = el('sf-tabs sf-tabs--inline', head);
    el('sf-grow', head);
    text('sf-panel__hint', head, 'Tab / Esc 关闭　·　Q / E 切换');

    const bag = this.addTab(tabRow, BAG_TAB);
    bag.classList.add('sf-inv__bag');
    const colS = el('sf-inv__col sf-inv__col--scrolls', bag);
    const sh = el('sf-section', colS);
    text('sf-section__title', sh, '秘卷', UIFontRole.Title);
    this.scrollCount = text('sf-section__count', sh, '', UIFontRole.Number);
    this.scrollsList = el('sf-inv__list', scroll('sf-inv__scroll', colS));
    const colT = el('sf-inv__col sf-inv__col--stats', bag);
    text('sf-section__title', el('sf-section', colT), '属性', UIFontRole.Title);
    this.statsGrid = el('sf-statgrid', scroll('sf-inv__scroll', colT));
    const colA = el('sf-inv__col sf-inv__col--arms', bag);
    text('sf-section__title', el('sf-section', colA), '武器', UIFontRole.Title);
    this.arms = el('sf-inv__arms', scroll('sf-inv__scroll', colA));

    this.petPage = this.addTab(tabRow, PET_TAB);
    this.petPage.classList.add('sf-inv__petpage');
    this.select(0);
    return root;
  }

  private addTab(row: HTMLElement, name: string): HTMLDivElement {
    const index = this.tabs.length;
    const tab = card(this.ctx, 'sf-tab', row, () => this.select(index));
    tab.dataset.name = 'tab-' + name;
    text('sf-tab__label', tab, name, UIFontRole.Title);
    const page = el('sf-inv__page', this.frame);
    this.tabs.push({ name, tab, page });
    return page;
  }

  /** 切到第 i 个页签 */
  select(i: number): void {
    if (this.tabs.length === 0) return;
    this.current = ((i % this.tabs.length) + this.tabs.length) % this.tabs.length;
    this.tabs.forEach((t, k) => {
      toggle(t.tab, 'sf-tab--on', k === this.current);
      show(t.page, k === this.current);
    });
  }

  override onOpen(arg?: unknown): void {
    this.openedAt = this.now();
    this.modal.open();
    if (typeof arg === 'string') {
      const k = this.tabs.findIndex((t) => t.name === arg);
      if (k >= 0) this.select(k);
    }
    this.rebuild();
    (this.ctx.ui as { clearMessages?: () => void }).clearMessages?.();
    this.tick();
  }

  override onClose(): void {
    this.modal.close();
  }

  /** Tab 再按一次关；Q / E 切页签（改过的键也认） */
  onKey(code: string): boolean {
    if (this.keys.matches('inventory', code)) {
      this.close();
      return true;
    }
    if (this.keys.matches('skillPrimary', code)) this.select(this.current - 1);
    else if (this.keys.matches('skillSecondary', code)) this.select(this.current + 1);
    else return false;
    return true;
  }

  override tick(): void {
    const k = easeOut((this.now() - this.openedAt) / 0.22);
    this.frame.style.opacity = k.toFixed(3);
    const s = 0.985 + 0.015 * k;
    this.frame.style.scale = `${s.toFixed(4)} ${s.toFixed(4)}`;
  }

  /** 按当前状态重建三栏和灵宠页 */
  rebuild(): void {
    const ctx = this.ctx;
    try {
      const n = renderScrollList(ctx, this.scrollsList, true);
      this.scrollRows = n;
      this.scrollCount.textContent = n > 0 ? String(n) : '';
    } catch (err) {
      console.error('[UI] 行囊秘卷列表失败', err);
    }
    try {
      renderStatGrid(ctx, this.statsGrid, KEY_STATS, true);
    } catch (err) {
      console.error('[UI] 行囊属性失败', err);
    }
    try {
      this.buildArms();
    } catch (err) {
      console.error('[UI] 行囊武器卡失败', err);
    }
    try {
      this.buildPet();
    } catch (err) {
      console.error('[UI] 行囊灵宠页失败', err);
    }
  }

  // ───────────── 武器卡 ─────────────

  private buildArms(): void {
    this.arms.replaceChildren();
    this.weaponCards = 0;
    const ws = this.ctx.weapons;
    if (!ws?.slots) {
      text('sf-empty', this.arms, '没有武器数据。');
      return;
    }
    ws.slots.forEach((w, i) => {
      weaponCard(this.ctx, this.arms, w, i, i === ws.activeSlot);
      if (w) this.weaponCards++;
    });
  }

  // ───────────── 灵宠页 ─────────────

  private buildPet(): void {
    const page = this.petPage;
    page.replaceChildren();
    const pet = this.pets().current();
    if (!pet) {
      const empty = el('sf-pet-empty', page);
      text('sf-pet-empty__title', empty, '尚未结契灵宠', UIFontRole.Title);
      text('sf-pet-empty__text', empty, '击败灵兽或打开宝箱掉出灵兽封印后，走近按 F 结契。灵宠跟随作战、升级觉醒，跨关一直陪着你。');
      return;
    }
    const def = pet.def;
    const rc = rgb(def.rarityColor);
    const c = el('sf-petcard', page);
    c.style.borderLeftColor = css(rc);
    const head = el('sf-petcard__head', c);
    text('sf-petcard__name', head, def.name, UIFontRole.Title).style.color = css(rc);
    text('sf-petcard__sub', head, `${def.rarityName} · ${def.title}${def.role ? ' · ' + def.role : ''}`);
    if (def.element !== 'none') text('sf-chip', head, `${ELEMENT_GLYPH[def.element]} ${ELEMENT_NAMES[def.element]}`).style.color = css(elementColor(def.element));
    const lv = el('sf-petcard__level', c);
    text('sf-petcard__lv', lv, `灵契 Lv.${pet.level}`, UIFontRole.Number);
    text('sf-petcard__state', lv, petStateText(pet));
    el('sf-petcard__xpfill', el('sf-petcard__xp', c)).style.width = `${(petXpRatio(pet) * 100).toFixed(1)}%`;
    text('sf-petcard__xptext', c, pet.xpNext > 0 ? `经验 ${Math.floor(pet.xp)} / ${Math.ceil(pet.xpNext)}` : '经验已满', UIFontRole.Number);
    if (def.lore) text('sf-petcard__lore', c, def.lore);
    const grid = el('sf-petcard__grid', c);
    petBlock(grid, '攻击', undefined, def.attackDesc);
    petBlock(grid, '被动', def.passiveName, def.passiveDesc);
    petBlock(grid, `灵技 · ${this.keys.label('petSkill')}`, def.skillName, `${def.skillDesc ?? ''}（冷却 ${num1(pet.skillCooldown)} 秒）`);
    petBlock(grid, '觉醒', undefined, def.awakenDesc, !pet.awakened);
    text('sf-petcard__foot', c, `本局灵宠造成伤害 ${num(pet.damageDealt)}`, UIFontRole.Number);
  }
}

function petBlock(parent: HTMLElement, label: string, name: string | undefined, desc: string | undefined, dim = false): void {
  if (!desc && !name) return;
  const b = el('sf-petblock', parent);
  if (dim) b.classList.add('sf-petblock--locked');
  const h = el('sf-petblock__head', b);
  text('sf-petblock__label', h, label);
  if (name) text('sf-petblock__name', h, name, UIFontRole.Title);
  if (desc) text('sf-petblock__desc', b, desc);
}

/** 武器卡（Unity WeaponCard.Build）：空槽写「空槽」 */
export function weaponCard(ctx: GameContext, parent: HTMLElement, w: WeaponInstance | null, slot: number, active: boolean): HTMLDivElement {
  const c = el('sf-arm', parent, 'weapon-' + (slot + 1));
  toggle(c, 'sf-arm--active', active);
  text('sf-arm__slot', c, String(slot + 1), UIFontRole.Number);
  if (!w) {
    c.classList.add('sf-arm--empty');
    text('sf-arm__name', c, '空槽', UIFontRole.Title);
    return c;
  }
  const d = ctx.weapons.describe(w);
  const rc = rarityColor(w.rarity);
  c.style.borderLeftColor = css(rc);
  const nameRow = el('sf-arm__namerow', c);
  text('sf-arm__name', nameRow, d.name, UIFontRole.Title).style.color = css(lerpColor(rc, [1, 1, 1, 1], 0.2));
  if (w.level > 0) text('sf-arm__lvl', nameRow, '+' + w.level, UIFontRole.Number);
  if (active) text('sf-arm__inhand', nameRow, '手持');
  const meta = el('sf-arm__meta', c);
  text('sf-arm__metaitem', meta, d.rarityName || RARITY_NAMES[w.rarity] || '').style.color = css(rc);
  if (d.category) text('sf-arm__metaitem', meta, d.category);
  if (d.elementLabel) text('sf-arm__metaitem sf-arm__tri', meta, d.elementLabel);
  else if (w.element !== 'none') text('sf-arm__metaitem', meta, `${ELEMENT_GLYPH[w.element]} ${ELEMENT_NAMES[w.element]}`).style.color = css(elementColor(w.element));
  if (d.stats.length > 0) {
    const grid = el('sf-arm__stats', c);
    for (const s of d.stats) {
      const cell = el('sf-arm__cell', grid);
      text('sf-arm__num', cell, s.value, UIFontRole.Number);
      text('sf-arm__label', cell, s.label);
    }
  }
  const traits = d.traits.slice();
  if (d.skill) traits.push(`${d.skill.key} · ${d.skill.name}：${d.skill.description}`);
  if (traits.length > 0) {
    const list = el('sf-arm__traits', c);
    traits.forEach((t, i) => (text('sf-arm__trait', list, t, UIFontRole.Body, true).dataset.name = 'trait-' + i));
  }
  return c;
}
