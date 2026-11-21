/**
 * 主菜单（照译 Unity G/UI/Screens/MainMenuScreen.cs，样式 css/unity/menu.css 的 .sf-menu）：
 *   左：导航（[继续征程] / 开始游戏 / 天赋 / 图鉴 / 设置 / 操作说明），悬停或键盘焦点时朱砂笔触从左扫开；
 *   右：书法标题「灵火破晓」逐字落墨 +「烈焰为弹 · 破此轮回」+ 朱印「不熄」盖下；左上魂晶余额，底部生涯统计（出征 / 通关 / 最远 / 最多清关 / 累计斩敌）。
 * 「继续征程」（M11d，Unity I5）：有未完成的征程（续玩档）时排在最前、当主按钮，小字写「关卡 · 英雄 · 用时 · 灵石」；
 *   「开始游戏」退成普通按钮，小字写明会放弃它；出征前弹确认框（{@link startNewRun}，Unity MenuFlow.StartRun）。
 * 其余页（选英雄、天赋、图鉴、设置、操作说明）叠在上面，主菜单本体淡出；回来时淡入、刷新余额、未完成的征程与统计。
 * 不挡游戏、不停时间；返回键在主菜单上什么都不做。
 * 网页差异：Unity 叠在主菜单场景的 3D 远景上（MenuDirector），网页没有菜单场景——背景是 MenuBackdrop 的 CSS 远景（旧主菜单的那套）；
 *   场景清单（备选图在不在）可能比主菜单晚到：清单一到就重看一次有没有可以继续的征程；浏览器不能退出，「退出游戏」不列。
 */
import type { GameContext } from '../../core/types';
import { isDemo, final as finalStage, playable } from '../../progression/RunPlan';
import { stageCatalogVersion } from '../../progression/StagePlan';
import { careerItems, firstRunText, forfeitConfirmText, menuHints } from '../ScreenData';
import type { Codex, CodexCatalog } from '../codex/Codex';
import { el, show, text, toggle } from '../toolkit/el';
import { UIFontRole, warmup } from '../toolkit/UIFonts';
import { UIIcon } from '../toolkit/UIIcons';
import { type BlockState, type IScreen, type ScreenRouter, UIScreen } from '../toolkit/UIRouter';
import { fadeRight, paint } from '../toolkit/UITheme';
import { CODEX_ID } from './CodexScreen';
import { ConfirmScreen } from './ConfirmScreen';
import { CONTROLS_ID } from './ControlsScreen';
import { card, easeBack, easeOut, icon, num } from './ScreenKit';
import { SETTINGS_ID } from './SettingsScreen';

export const MAIN_MENU_ID = 'main-menu';
export const HERO_SELECT_ID = 'hero-select';
export const TALENTS_ID = 'talents';

type Suspended = NonNullable<ReturnType<NonNullable<GameContext['game']['suspendedRun']>>>;

/** 主菜单当前档里未完成的征程（续玩档；没有 / 坏档 / 读出错为 null） */
function suspendedOf(ctx: GameContext): Suspended | null {
  try {
    return ctx.game.suspendedRun?.() ?? null;
  } catch (err) {
    console.error('[UI] 读未完成的征程失败', err);
    return null;
  }
}

/**
 * 出征（Unity MenuFlow.StartRun）：有未完成的征程时先弹确认框（不可撤销：旧局按败北结算），确认后才开新局；
 * 没有确认框界面时直接开（ConfirmScreen.ask 当作确认）。返回这次有没有直接开局
 */
export function startNewRun(ctx: GameContext, router: ScreenRouter | null, heroId: string): boolean {
  const s = suspendedOf(ctx);
  if (s && router) {
    ConfirmScreen.ask(router, { ...forfeitConfirmText(s.stageCode), onConfirm: () => ctx.game.startRun(heroId) });
    return false;
  }
  ctx.game.startRun(heroId);
  return true;
}

export class MainMenuScreen extends UIScreen {
  readonly id = MAIN_MENU_ID;
  override get blockState(): BlockState | null {
    return null;
  }
  override get freezeTime(): boolean {
    return false;
  }
  override get defaultFocus(): HTMLElement | null {
    return this.suspendedV ? this.continueBtn : this.startBtn;
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
  private startHint!: HTMLDivElement;
  private continueBtn: HTMLButtonElement | null = null;
  private continueHint!: HTMLDivElement;
  private suspendedV: Suspended | null = null;
  /** 上次看续玩档时的场景清单版本（清单晚到时重看一次） */
  private catalogSeen = -1;
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
    const cont = this.navItem(nav, '继续征程', '', () => this.continueRun(), true);
    this.continueBtn = cont.b;
    this.continueHint = cont.hint;
    show(cont.b, false);
    const start = this.navItem(nav, '开始游戏', '选择英雄，踏入第一章', () => this.startGame(), true);
    this.startBtn = start.b;
    this.startHint = start.hint;
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

  /** 「开始游戏」：选英雄页（没有选英雄页时直接用第一位英雄出征；有未完成的征程时先确认） */
  startGame(): void {
    if (this.router?.get(HERO_SELECT_ID)) this.router.open(HERO_SELECT_ID);
    else startNewRun(this.ctx, this.router, this.ctx.heroes[0]?.id ?? '');
  }

  /** 有未完成的征程（「继续征程」显示着，I5） */
  get suspended(): Suspended | null {
    return this.suspendedV;
  }

  /** 「继续征程」（Unity MainMenuScreen.ContinueRun）：读续玩档，从那一关开头接着打；读不了（坏档已丢弃、提示由 Game 给）就刷新入口 */
  continueRun(): void {
    let ok = false;
    try {
      ok = this.ctx.game.continueRun?.() ?? false;
    } catch (err) {
      console.error('[UI] 继续征程失败', err);
    }
    if (!ok) this.refresh();
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
    void warmup('灵火破晓不熄烈焰为弹破此轮回继续征程开始游戏天赋图鉴设置操作说明', UIFontRole.Title);
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

  /** 刷新魂晶余额、未完成的征程、图鉴收录数与生涯统计 */
  refresh(): void {
    const meta = this.ctx.meta;
    let essence = 0;
    try {
      essence = meta.save.essence;
    } catch {
      essence = 0;
    }
    this.essence.textContent = num(essence);
    this.refreshSuspended();
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

  /** 「继续征程」显不显示、两个按钮的小字、谁是主按钮（Unity MainMenuScreen.Refresh 的续玩部分） */
  private refreshSuspended(): void {
    this.catalogSeen = stageCatalogVersion();
    const s = (this.suspendedV = suspendedOf(this.ctx));
    const cont = this.continueBtn, start = this.startBtn;
    if (!cont || !start) return;
    show(cont, !!s);
    cont.style.pointerEvents = this.covered || !s ? 'none' : 'auto';
    toggle(start, 'sf-nav--primary', !s);
    const hero = s ? this.ctx.heroes.find((h) => h.id === s.heroId) : undefined;
    const hints = menuHints(s ? { stageLabel: s.stageLabel, heroName: hero?.name ?? s.heroId, time: s.time, coins: s.coins } : null);
    this.continueHint.textContent = hints.continueHint;
    this.startHint.textContent = hints.startHint;
  }

  override tick(): void {
    // 场景清单晚到（备选图在不在要看它）：到了就重看一次有没有可以继续的征程
    if (!this.covered && this.catalogSeen !== stageCatalogVersion()) this.refreshSuspended();
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
