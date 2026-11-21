/**
 * 主菜单（照译 Unity G/UI/Screens/MainMenuScreen.cs，样式 css/unity/menu.css 的 .sf-menu）：
 *   左：导航（开始游戏 / 天赋 / 图鉴 / 设置 / 操作说明），悬停或键盘焦点时朱砂笔触从左扫开；
 *   右：书法标题「灵火破晓」逐字落墨 +「烈焰为弹 · 破此轮回」+ 朱印「不熄」盖下；左上魂晶余额，底部生涯统计（出征 / 通关 / 最远 / 最多清关 / 累计斩敌）。
 * 其余页（选英雄、天赋、图鉴、设置、操作说明）叠在上面，主菜单本体淡出；回来时淡入、刷新余额与统计。
 * 不挡游戏、不停时间；返回键在主菜单上什么都不做。
 * 网页差异：Unity 叠在主菜单场景的 3D 远景上（MenuDirector），网页没有菜单场景——背景是 MenuBackdrop 的 CSS 远景（旧主菜单的那套）；
 *   没有续玩档（M11d），「继续征程」不出现；浏览器不能退出，「退出游戏」不列。
 */
import type { GameContext } from '../../core/types';
import { isDemo, final as finalStage, playable } from '../../progression/RunPlan';
import { careerItems, firstRunText } from '../ScreenData';
import type { Codex, CodexCatalog } from '../codex/Codex';
import { el, text, toggle } from '../toolkit/el';
import { UIFontRole, warmup } from '../toolkit/UIFonts';
import { UIIcon } from '../toolkit/UIIcons';
import { type BlockState, type IScreen, UIScreen } from '../toolkit/UIRouter';
import { fadeRight, paint } from '../toolkit/UITheme';
import { CODEX_ID } from './CodexScreen';
import { CONTROLS_ID } from './ControlsScreen';
import { card, easeBack, easeOut, icon, num } from './ScreenKit';
import { SETTINGS_ID } from './SettingsScreen';

export const MAIN_MENU_ID = 'main-menu';
export const HERO_SELECT_ID = 'hero-select';
export const TALENTS_ID = 'talents';

export class MainMenuScreen extends UIScreen {
  readonly id = MAIN_MENU_ID;
  override get blockState(): BlockState | null {
    return null;
  }
  override get freezeTime(): boolean {
    return false;
  }
  override get defaultFocus(): HTMLElement | null {
    return this.startBtn;
  }

  private readonly chars: HTMLDivElement[] = [];
  private readonly navItems: HTMLButtonElement[] = [];
  private home!: HTMLDivElement;
  private seal!: HTMLDivElement;
  private stats!: HTMLDivElement;
  private sub!: HTMLDivElement;
  private essence!: HTMLDivElement;
  private codexHint!: HTMLDivElement;
  private startBtn: HTMLButtonElement | null = null;
  private openedAt = 0;
  private offs: (() => void)[] = [];
  /** 被别的页盖住（选英雄、天赋…） */
  covered = false;

  constructor(private readonly ctx: GameContext, private readonly book: Codex | null, private readonly catalog: (() => CodexCatalog) | null, private readonly now: () => number) {
    super();
  }

  protected build(): HTMLElement {
    const root = el('sf-menu', null, 'main-menu');
    root.style.pointerEvents = 'none';
    this.home = el('sf-menu__home', root);
    paint(el('sf-menu__shade sf-menu__shade--l', this.home), fadeRight([0.02, 0.016, 0.024, 0.92]));
    paint(el('sf-menu__shade sf-menu__shade--r', this.home), fadeRight([0.02, 0.016, 0.024, 0.8]));
    el('sf-menu__shade sf-menu__shade--b', this.home).style.backgroundColor = 'rgba(5,4,6,0.55)';

    const top = el('sf-menu__top', this.home);
    const wallet = el('sf-wallet sf-wallet--menu', top);
    icon(UIIcon.Essence, 'sf-icon--essence', wallet);
    text('sf-wallet__label', wallet, '魂晶');
    this.essence = text('sf-wallet__num', wallet, '0', UIFontRole.Number);
    text('sf-menu__latin', top, 'SPIRITFIRE · DAWN', UIFontRole.Number);

    const nav = el('sf-menu__nav', this.home);
    const open = (id: string) => () => this.router?.open(id);
    this.startBtn = this.navItem(nav, '开始游戏', '选择英雄，踏入第一章', () => this.startGame(), true).b;
    this.navItem(nav, '天赋', '用魂晶强化之后的每一局', open(TALENTS_ID));
    this.codexHint = this.navItem(nav, '图鉴', '武器、秘卷、敌人与灵宠', open(CODEX_ID)).hint;
    this.navItem(nav, '设置', '画面、声音与按键', open(SETTINGS_ID));
    this.navItem(nav, '操作说明', '按键一览', open(CONTROLS_ID));

    const brand = el('sf-menu__brand', this.home);
    const title = el('sf-menu__title', brand);
    for (const ch of '灵火破晓') this.chars.push(text('sf-menu__char', title, ch, UIFontRole.Title));
    this.seal = el('sf-seal sf-menu__seal', title);
    text('sf-menu__sealchar', this.seal, '不\n熄', UIFontRole.Title);
    this.sub = text('sf-menu__sub', brand, '烈焰为弹 · 破此轮回');
    this.stats = el('sf-menu__stats', this.home);
    return root;
  }

  private navItem(parent: HTMLElement, label: string, hint: string, onClick: () => void, primary = false): { b: HTMLButtonElement; hint: HTMLDivElement } {
    const b = card(this.ctx, primary ? 'sf-nav sf-nav--primary' : 'sf-nav', parent, onClick);
    b.dataset.name = 'nav-' + label;
    b.style.pointerEvents = 'auto';
    paint(el('sf-nav__brush', b), fadeRight([0.79, 0.22, 0.16, 0.95]));
    el('sf-nav__mark', b);
    const col = el('sf-nav__text', b);
    text('sf-nav__label', col, label, UIFontRole.Title);
    const h = text('sf-nav__hint', col, hint);
    this.navItems.push(b);
    return { b, hint: h };
  }

  /** 「开始游戏」：选英雄页（没有选英雄页时直接用第一位英雄出征） */
  startGame(): void {
    if (this.router?.get(HERO_SELECT_ID)) this.router.open(HERO_SELECT_ID);
    else this.ctx.game.startRun(this.ctx.heroes[0]?.id ?? '');
  }

  override onOpen(): void {
    this.openedAt = this.now();
    this.setCovered(false);
    for (const off of this.offs.splice(0)) off();
    const r = this.router;
    if (r)
      this.offs.push(
        r.onOpened((s: IScreen) => {
          if (s !== this && this.isOpen) this.setCovered(true);
        }),
        r.onClosed((s: IScreen) => {
          if (s !== this && r.top === this) this.setCovered(false);
        }),
      );
    void warmup('灵火破晓不熄烈焰为弹破此轮回开始游戏天赋图鉴设置操作说明', UIFontRole.Title);
    this.tick();
  }

  override onClose(): void {
    for (const off of this.offs.splice(0)) off();
  }

  /** 主菜单上返回键不关 */
  override onBack(): boolean {
    return true;
  }

  private setCovered(on: boolean): void {
    this.covered = on;
    toggle(this.home, 'sf-menu__home--covered', on);
    for (const b of this.navItems) b.style.pointerEvents = on ? 'none' : 'auto';
    if (!on) this.refresh();
  }

  /** 刷新魂晶余额、图鉴收录数与生涯统计 */
  refresh(): void {
    const meta = this.ctx.meta;
    let essence = 0;
    try {
      essence = meta.save.essence;
    } catch {
      essence = 0;
    }
    this.essence.textContent = num(essence);
    if (this.book && this.catalog) this.codexHint.textContent = `武器、秘卷、敌人与灵宠 · 已收录 ${this.book.totalCount} / ${this.catalog().total}`;
    this.stats.replaceChildren();
    let items: ReturnType<typeof careerItems> = null;
    try {
      items = careerItems(meta.save.stats);
    } catch {
      items = null;
    }
    if (!items) {
      let line = '尚无出征记录。';
      try {
        line = firstRunText(playable().length, isDemo(), finalStage().label);
      } catch {
        /* 规划表读不到就只写第一句 */
      }
      text('sf-menu__stat sf-menu__stat--first', this.stats, line);
      return;
    }
    items.forEach((it, i) => {
      if (i > 0) el('sf-menu__dot', this.stats);
      const e = el('sf-menu__stat', this.stats);
      text('sf-menu__statk', e, it.k);
      text('sf-menu__statv', e, it.v, UIFontRole.Number);
    });
  }

  override tick(): void {
    const t = this.now() - this.openedAt;
    // 标题逐字落墨（放大 + 淡入）
    this.chars.forEach((ch, i) => {
      const k = easeOut((t - 0.1 - i * 0.12) / 1.1);
      ch.style.opacity = k.toFixed(3);
      const s = 1.35 + (1 - 1.35) * k;
      ch.style.scale = `${s.toFixed(4)} ${s.toFixed(4)}`;
      ch.style.translate = `0px ${(-14 * (1 - k)).toFixed(2)}px`;
    });
    const sk = easeOut((t - 0.8) / 0.9);
    this.sub.style.opacity = sk.toFixed(3);
    this.sub.style.translate = `0px ${(10 * (1 - sk)).toFixed(2)}px`;
    const st = Math.min(1, Math.max(0, (t - 1.05) / 0.45));
    this.seal.style.opacity = st > 0 ? '1' : '0';
    const ss = st > 0 ? 1.9 + (1 - 1.9) * easeBack(st, 2.2) : 1.9;
    this.seal.style.scale = `${ss.toFixed(4)} ${ss.toFixed(4)}`;
    this.navItems.forEach((b, i) => {
      const k = easeOut((t - 0.12 - i * 0.08) / 0.5);
      b.style.opacity = k.toFixed(3);
      b.style.translate = `${(-26 * (1 - k)).toFixed(2)}px 0px`;
    });
    this.stats.style.opacity = easeOut((t - 1.1) / 0.8).toFixed(3);
  }
}
