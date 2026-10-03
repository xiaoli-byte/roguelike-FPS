/**
 * 主菜单：竖排书法标题 + 朱印、导航（开始游戏 / 天赋 / 设置 / 操作说明）、
 * 局外统计与魂晶。背景用 CSS 做动态氛围：朱日、流云、远山、飘散的火星、纸纹。
 */
import type { GameContext, MetaSave } from '../core/types';
import { h, icon, button, Presence, formatNum, clearChildren, fitPanel } from './dom';
import { ICON_CLOUD, ICON_ESSENCE } from './icons';
import { CONTROLS, cnNum } from './labels';
import { HeroSelect } from './HeroSelect';
import { TalentPanel } from './TalentPanel';
import { SettingsPanel } from './SettingsPanel';

type SubView = 'heroes' | 'talents' | 'settings' | 'controls';
type View = 'home' | SubView;

const EMBER_COUNT = 34;

export class MainMenu {
  readonly root: HTMLDivElement;
  private presence: Presence;
  private homeEl: HTMLDivElement;
  private homePresence: Presence;
  private subHost: HTMLDivElement;
  private subs: Record<SubView, { el: HTMLElement; presence: Presence; refresh(): void }>;
  private view: View = 'home';
  private essenceEl: HTMLSpanElement;
  private statsEl: HTMLDivElement;
  private heroSelect: HeroSelect;
  private parallaxRaf = 0;
  private px = 0;
  private py = 0;

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-menu gf-screen', parent);
    this.presence = new Presence(this.root, 420);
    this.buildBackground();

    // ───── 顶栏：魂晶 ─────
    const top = h('div', 'gf-menu__top', this.root);
    const wallet = h('div', 'gf-wallet gf-wallet--menu', top);
    icon(ICON_ESSENCE, 'gf-icon gf-icon--essence', wallet);
    h('span', 'gf-wallet__label', wallet, '魂晶');
    this.essenceEl = h('span', 'gf-wallet__num', wallet);
    h('div', 'gf-menu__latin', top, 'SPIRITFIRE · DAWN');

    // ───── 首页 ─────
    this.homeEl = h('div', 'gf-menu__home', this.root);
    this.homePresence = new Presence(this.homeEl, 320);
    const nav = h('nav', 'gf-menu__nav', this.homeEl);
    this.navItem(nav, '开始游戏', '选择英雄，踏入第一章', () => this.go('heroes'), true);
    this.navItem(nav, '天赋', '用魂晶强化之后的每一局', () => this.go('talents'));
    this.navItem(nav, '设置', '画面、声音与操作', () => this.go('settings'));
    this.navItem(nav, '操作说明', '按键一览', () => this.go('controls'));

    const brand = h('div', 'gf-menu__brand', this.homeEl);
    h('div', 'gf-menu__sub', brand, '烈焰为弹 · 破此轮回');
    const title = h('h1', 'gf-menu__title', brand);
    for (const ch of '灵火破晓') h('span', 'gf-menu__char', title, ch);
    const seal = h('div', 'gf-seal gf-menu__seal', brand);
    h('span', null, seal, '不');
    h('span', null, seal, '熄');

    this.statsEl = h('div', 'gf-menu__stats', this.homeEl);

    // ───── 子页面 ─────
    this.subHost = h('div', 'gf-menu__subs', this.root);
    const back = () => this.go('home');
    this.heroSelect = new HeroSelect(ctx, back);
    const talents = new TalentPanel(ctx, back);
    const settings = new SettingsPanel(ctx, back);
    const controls = this.buildControls(back);
    const mk = (el: HTMLElement, refresh: () => void) => {
      const wrap = h('div', 'gf-menu__panel gf-frame', this.subHost);
      wrap.appendChild(el);
      return { el: wrap, presence: new Presence(wrap, 300), refresh };
    };
    this.subs = {
      heroes: mk(this.heroSelect.root, () => {
        this.heroSelect.refresh();
        this.heroSelect.activate();
      }),
      talents: mk(talents.root, () => {
        talents.refresh();
        this.refreshWallet();
      }),
      settings: mk(settings.root, () => settings.refresh()),
      controls: mk(controls, () => undefined),
    };
    this.subs.heroes.el.classList.add('gf-menu__panel--wide', 'gf-menu__panel--heroes');
    this.subs.talents.el.classList.add('gf-menu__panel--talents');
    this.subs.settings.el.classList.add('gf-menu__panel--settings');

    // 鼠标视差（只在移动时写一次 CSS 变量）
    this.root.addEventListener('pointermove', (e) => {
      this.px = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      this.py = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
      if (this.parallaxRaf) return;
      this.parallaxRaf = requestAnimationFrame(() => {
        this.parallaxRaf = 0;
        this.root.style.setProperty('--mx', this.px.toFixed(3));
        this.root.style.setProperty('--my', this.py.toFixed(3));
      });
    });
  }

  get visible(): boolean {
    return this.presence.visible;
  }

  show(): void {
    this.refreshWallet();
    this.refreshStats();
    this.go('home', true);
    this.presence.show();
  }

  hide(): void {
    this.heroSelect.deactivate();
    this.presence.hide();
  }

  /** 视口变化时重新缩放当前子页面 */
  refit(): void {
    if (!this.presence.visible || this.view === 'home') return;
    fitPanel(this.subs[this.view].el);
  }

  /** 返回 true 表示已处理 */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.presence.visible) return false;
    if (e.code === 'Escape') {
      if (this.view !== 'home') {
        this.go('home');
        return true;
      }
      return false;
    }
    if (this.view === 'heroes') return this.heroSelect.handleKey(e);
    if (this.view === 'home' && e.code === 'Enter') {
      this.go('heroes');
      return true;
    }
    return false;
  }

  private go(view: View, instant = false): void {
    const prev = this.view;
    this.view = view;
    this.root.dataset.view = view;
    // 离开英雄选择页时停止 3D 预览渲染
    if (view !== 'heroes') this.heroSelect.deactivate();
    for (const key of Object.keys(this.subs) as SubView[]) {
      const s = this.subs[key];
      if (key === view) {
        s.refresh();
        s.presence.show();
        fitPanel(s.el);
        s.el.scrollTop = 0;
      } else s.presence.hide(instant || prev !== key);
    }
    if (view === 'home') {
      this.refreshWallet();
      this.refreshStats();
      this.homePresence.show();
    } else this.homePresence.hide(instant);
  }

  private navItem(parent: HTMLElement, label: string, hint: string, onClick: () => void, primary = false): void {
    const b = button(this.ctx, primary ? 'gf-nav gf-nav--primary' : 'gf-nav', parent, '', onClick);
    h('span', 'gf-nav__mark', b);
    h('span', 'gf-nav__label', b, label);
    h('span', 'gf-nav__hint', b, hint);
  }

  private refreshWallet(): void {
    let essence = 0;
    try {
      essence = this.ctx.meta.save.essence;
    } catch {
      essence = 0;
    }
    this.essenceEl.textContent = formatNum(essence);
  }

  private refreshStats(): void {
    clearChildren(this.statsEl);
    let s: MetaSave['stats'] | null;
    try {
      s = this.ctx.meta.save.stats;
    } catch {
      s = null;
    }
    if (!s || s.runs <= 0) {
      h('span', 'gf-menu__stat gf-menu__stat--first', this.statsEl, '尚无出征记录。三章十五关，击败三位首领即可通关。');
      return;
    }
    const items: [string, string][] = [
      ['出征', `${formatNum(s.runs)} 次`],
      ['通关', `${formatNum(s.wins)} 次`],
      ['最远', s.bestChapter > 0 ? `第${cnNum(s.bestChapter)}章` : '—'],
      ['最多清关', `${formatNum(s.bestStages)} 关`],
      ['累计斩敌', formatNum(s.totalKills)],
    ];
    items.forEach(([k, v], i) => {
      if (i > 0) h('i', 'gf-menu__dot', this.statsEl);
      const el = h('span', 'gf-menu__stat', this.statsEl);
      h('span', null, el, k);
      h('b', null, el, v);
    });
  }

  private buildControls(onBack: () => void): HTMLElement {
    const root = h('div', 'gf-controls');
    const head = h('div', 'gf-panel__head', root);
    h('h2', 'gf-panel__title', head, '操作说明');
    h('p', 'gf-panel__sub', head, '点击画面锁定鼠标；Esc 释放鼠标并暂停。');
    const list = h('div', 'gf-controls__list', root);
    for (const c of CONTROLS) {
      const row = h('div', 'gf-controls__row', list);
      const keys = h('span', 'gf-controls__keys', row);
      c.keys.forEach((k, i) => {
        if (i > 0 && !c.together) h('span', 'gf-controls__or', keys, '/');
        h('kbd', 'gf-key', keys, k);
      });
      h('span', 'gf-controls__action', row, c.action);
    }
    const tips = h('div', 'gf-controls__tips', root);
    h('p', null, tips, '爆头即暴击。敌人的强力攻击都有前摇与地面预警，留意并闪避。');
    h('p', null, tips, '清关后会出现多个传送门，门上标明下一关的类型与奖励。');
    const foot = h('div', 'gf-panel__foot', root);
    button(this.ctx, 'gf-btn gf-btn--primary', foot, '返回', () => onBack());
    return root;
  }

  private buildBackground(): void {
    const bg = h('div', 'gf-menu__bg', this.root);
    h('div', 'gf-menu__sky', bg);
    const sun = h('div', 'gf-menu__sun', bg);
    h('div', 'gf-menu__sunhalo', sun);
    for (let i = 1; i <= 4; i++) h('div', `gf-menu__mist gf-menu__mist--${i}`, bg);
    const clouds = h('div', 'gf-menu__clouds', bg);
    for (let i = 1; i <= 3; i++) icon(ICON_CLOUD, `gf-menu__cloud gf-menu__cloud--${i}`, clouds);
    h('div', 'gf-menu__range gf-menu__range--far', bg);
    h('div', 'gf-menu__range gf-menu__range--mid', bg);
    h('div', 'gf-menu__range gf-menu__range--near', bg);
    const embers = h('div', 'gf-menu__embers', bg);
    for (let i = 0; i < EMBER_COUNT; i++) {
      const e = h('i', 'gf-ember', embers);
      // 纯视觉随机
      const size = 1.5 + Math.random() * 3;
      e.style.left = `${(Math.random() * 100).toFixed(1)}%`;
      e.style.width = e.style.height = `${size.toFixed(1)}px`;
      e.style.setProperty('--dur', `${(7 + Math.random() * 9).toFixed(1)}s`);
      e.style.setProperty('--delay', `${(-Math.random() * 16).toFixed(1)}s`);
      e.style.setProperty('--sway', `${((Math.random() - 0.5) * 120).toFixed(0)}px`);
      if (Math.random() < 0.35) e.classList.add('gf-ember--gold');
    }
    h('div', 'gf-menu__grain', bg);
    h('div', 'gf-menu__vignette', bg);
  }
}
