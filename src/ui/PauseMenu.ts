/**
 * 暂停菜单：继续 / 设置 / 放弃本局 / 返回主菜单，右侧显示本局概况、秘卷与属性摘要。
 * 「放弃本局」「返回主菜单」需要二次点击确认。
 */
import type { GameContext, StatKey } from '../core/types';
import { formatTime } from '../core/math';
import { h, icon, button, Presence, formatNum } from './dom';
import { ICON_COIN, ICON_ESSENCE, ICON_HOURGLASS, ICON_SKULL } from './icons';
import { heroColor, heroGlyph } from './labels';
import { SettingsPanel } from './SettingsPanel';
import { renderScrollList, renderStatGrid } from './InventoryPanel';

const PAUSE_STATS: StatKey[] = ['maxHp', 'maxShield', 'damagePct', 'critChance', 'critDamagePct', 'fireRatePct', 'reloadSpeedPct', 'moveSpeed', 'skillHaste', 'damageReduction'];
const ARM_MS = 2600;

type ArmKey = 'abandon' | 'menu';

export class PauseMenu {
  readonly root: HTMLDivElement;
  private presence: Presence;
  private mainEl: HTMLDivElement;
  private mainPresence: Presence;
  private settingsWrap: HTMLDivElement;
  private settingsPresence: Presence;
  private settings: SettingsPanel;
  private inSettings = false;

  private crestGlyph: HTMLSpanElement;
  private heroName: HTMLDivElement;
  private stageEl: HTMLDivElement;
  private timeEl: HTMLElement;
  private killsEl: HTMLElement;
  private coinsEl: HTMLElement;
  private essEl: HTMLElement;
  private scrollsEl: HTMLDivElement;
  private scrollCount: HTMLSpanElement;
  private statsEl: HTMLDivElement;

  private armed: ArmKey | null = null;
  private armTimer = 0;
  private armButtons: Record<ArmKey, { el: HTMLButtonElement; label: string }>;

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-pause gf-screen', parent);
    this.presence = new Presence(this.root, 260);
    h('div', 'gf-pause__backdrop', this.root);

    // ───── 主视图 ─────
    this.mainEl = h('div', 'gf-pause__main gf-frame', this.root);
    this.mainPresence = new Presence(this.mainEl, 220);
    const head = h('div', 'gf-pause__head', this.mainEl);
    const t = h('h2', 'gf-pause__title', head, '暂停');
    const seal = h('span', 'gf-seal gf-seal--sm', t);
    h('span', null, seal, '止');
    this.stageEl = h('div', 'gf-pause__stage', head);

    const cols = h('div', 'gf-pause__cols', this.mainEl);
    const nav = h('div', 'gf-pause__nav', cols);
    button(ctx, 'gf-btn gf-btn--primary gf-btn--block', nav, '继续', () => {
      // 在点击处理函数中同步调用，以便重新锁定鼠标
      this.ctx.game.resume();
    });
    button(ctx, 'gf-btn gf-btn--block', nav, '设置', () => this.openSettings());
    const abandon = button(ctx, 'gf-btn gf-btn--block gf-btn--danger', nav, '放弃本局', () => {
      if (this.arm('abandon')) this.ctx.game.endRun(false);
    });
    const toMenu = button(ctx, 'gf-btn gf-btn--block gf-btn--ghost', nav, '返回主菜单', () => {
      if (this.arm('menu')) this.ctx.game.toMenu();
    });
    this.armButtons = { abandon: { el: abandon, label: '放弃本局' }, menu: { el: toMenu, label: '返回主菜单' } };
    h('p', 'gf-pause__hint', nav, '放弃本局会结算已获得的魂晶；返回主菜单不结算。');

    const info = h('div', 'gf-pause__info', cols);
    const hero = h('div', 'gf-pause__hero', info);
    const crest = h('div', 'gf-pause__crest', hero);
    this.crestGlyph = h('span', null, crest);
    const hn = h('div', 'gf-pause__heroinfo', hero);
    this.heroName = h('div', 'gf-pause__heroname', hn);
    const facts = h('div', 'gf-pause__facts', hn);
    this.timeEl = this.fact(facts, ICON_HOURGLASS, '用时');
    this.killsEl = this.fact(facts, ICON_SKULL, '击杀');
    this.coinsEl = this.fact(facts, ICON_COIN, '金币', 'gf-icon--coin');
    this.essEl = this.fact(facts, ICON_ESSENCE, '魂晶', 'gf-icon--essence');

    const sh = h('h3', 'gf-pause__section', info, '秘卷');
    this.scrollCount = h('span', 'gf-tab__count', sh);
    this.scrollsEl = h('div', 'gf-pause__scrolls', info);
    h('h3', 'gf-pause__section', info, '属性');
    this.statsEl = h('div', 'gf-statgrid gf-statgrid--compact', info);

    // ───── 设置视图 ─────
    this.settingsWrap = h('div', 'gf-pause__settings gf-frame', this.root);
    this.settingsPresence = new Presence(this.settingsWrap, 220);
    this.settings = new SettingsPanel(ctx, () => this.closeSettings());
    this.settingsWrap.appendChild(this.settings.root);
  }

  get visible(): boolean {
    return this.presence.visible;
  }

  show(): void {
    this.disarm();
    this.refresh();
    this.inSettings = false;
    this.settingsPresence.hide(true);
    this.mainPresence.show();
    this.presence.show();
  }

  hide(): void {
    this.disarm();
    this.presence.hide();
  }

  /** Esc 在设置子页时返回暂停主页（返回 true 表示已处理，阻止 Game 直接恢复游戏） */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.presence.visible) return false;
    if (e.code === 'Escape' && this.inSettings) {
      this.closeSettings();
      return true;
    }
    return false;
  }

  private fact(parent: HTMLElement, svg: string, label: string, iconCls = ''): HTMLElement {
    const el = h('div', 'gf-fact', parent);
    icon(svg, `gf-icon ${iconCls}`.trim(), el);
    h('span', 'gf-fact__label', el, label);
    return h('b', 'gf-fact__val', el);
  }

  private refresh(): void {
    const ctx = this.ctx;
    const run = ctx.run;
    const hero = ctx.player.hero ?? ctx.heroes.find((x) => x.id === run.heroId) ?? null;
    this.root.style.setProperty('--hero', heroColor(hero));
    this.crestGlyph.textContent = heroGlyph(hero);
    this.heroName.textContent = hero ? `${hero.name} · ${hero.title}` : '无名侠客';
    let label = '';
    try {
      label = ctx.runPlan.stageLabel(run.stage);
    } catch {
      label = `第${run.chapter + 1}章 · 第${run.stageIndex + 1}关`;
    }
    this.stageEl.textContent = label;
    this.timeEl.textContent = formatTime(run.time);
    this.killsEl.textContent = formatNum(run.kills);
    this.coinsEl.textContent = formatNum(run.coins);
    this.essEl.textContent = formatNum(run.essence);
    try {
      const n = renderScrollList(ctx, this.scrollsEl, false);
      this.scrollCount.textContent = n > 0 ? String(n) : '';
    } catch (err) {
      console.error('[UI] 暂停菜单秘卷列表失败', err);
    }
    try {
      renderStatGrid(ctx, this.statsEl, PAUSE_STATS, false);
    } catch (err) {
      console.error('[UI] 暂停菜单属性失败', err);
    }
  }

  private openSettings(): void {
    this.disarm();
    this.inSettings = true;
    this.settings.refresh();
    this.mainPresence.hide();
    this.settingsPresence.show();
  }

  private closeSettings(): void {
    this.inSettings = false;
    this.settingsPresence.hide();
    this.mainPresence.show();
  }

  /** 二次确认：第一次点击进入待确认状态并返回 false，确认期内再点返回 true */
  private arm(key: ArmKey): boolean {
    if (this.armed === key) {
      this.disarm();
      return true;
    }
    this.disarm();
    this.armed = key;
    const b = this.armButtons[key];
    b.el.textContent = '再次点击确认';
    b.el.classList.add('is-armed');
    this.armTimer = window.setTimeout(() => this.disarm(), ARM_MS);
    return false;
  }

  private disarm(): void {
    window.clearTimeout(this.armTimer);
    if (!this.armed) return;
    const b = this.armButtons[this.armed];
    b.el.textContent = b.label;
    b.el.classList.remove('is-armed');
    this.armed = null;
  }
}
