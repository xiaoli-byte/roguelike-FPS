/**
 * 暂停菜单（照译 Unity G/UI/Screens/PauseScreen.cs + PauseMenu.cs）：
 *   左列：继续 / 设置 / 放弃本局 / 返回主菜单——「放弃本局」「返回主菜单」要二次确认（第一次按变成「再按一次确认」，2.6 s 内再按才生效）；
 *   右列：本局概况（英雄徽记、关卡、用时 / 击杀 / 灵石 / 魂晶）、已获得秘卷（小签）、精简属性网格。
 *   打开时 0.3 s 淡入上移；打开时收起横幅与提示。
 * 关闭 = 继续游戏：Esc（路由的返回）、「继续」按钮都回调 ctx.game.resume()；P 键由 Game 自己处理。
 * 「设置」把设置页叠在上面（路由），返回回到这里。挡游戏：paused（网页的暂停状态由 Game 管：Game.pause → UI.showPause → 打开本界面）。
 * 「返回主菜单」（M11d，照 Unity I5）：这一局有续玩档时是暂离（ctx.game.suspendRun：不结算，下次从本关开头「继续征程」），一按就走；
 *   没有续玩档（调试局）时会结算，同样二次确认。
 */
import type { GameContext } from '../../core/types';
import { sfx } from '../dom';
import { el, text } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { UIIcon } from '../toolkit/UIIcons';
import { type BlockState, UIScreen } from '../toolkit/UIRouter';
import { paint, vignette } from '../toolkit/UITheme';
import { PAUSE_STATS, btn, clock, crest, easeOut, icon, num, renderScrollList, renderStatGrid, scroll, setCrest } from './ScreenKit';

export const PAUSE_ID = 'pause';
const ArmSeconds = 2.6;
type ArmKey = 'abandon' | 'menu';

export class PauseScreen extends UIScreen {
  readonly id = PAUSE_ID;
  override get blockState(): BlockState {
    return 'paused';
  }
  override get defaultFocus(): HTMLElement | null {
    return this.resumeBtn;
  }

  private resumeBtn: HTMLButtonElement | null = null;
  private abandonBtn!: HTMLButtonElement;
  private menuBtn!: HTMLButtonElement;
  private frame!: HTMLDivElement;
  private crestEl!: HTMLDivElement;
  private scrolls!: HTMLDivElement;
  private stats!: HTMLDivElement;
  private hintLabel!: HTMLDivElement;
  private stageLabel!: HTMLDivElement;
  private heroName!: HTMLDivElement;
  private timeVal!: HTMLDivElement;
  private killsVal!: HTMLDivElement;
  private coinsVal!: HTMLDivElement;
  private essenceVal!: HTMLDivElement;
  private scrollCount!: HTMLDivElement;
  private armed: ArmKey | null = null;
  private armedAt = 0;
  private openedAt = 0;
  /** UI.showPause(false) 正在收起（不回调 resume：Game 自己在恢复） */
  hiding = false;

  constructor(private readonly ctx: GameContext, private readonly openSettings: () => void, private readonly now: () => number) {
    super();
  }

  /** 待确认的按钮（测试用） */
  get Armed(): ArmKey | null {
    return this.armed;
  }

  protected build(): HTMLElement {
    const ctx = this.ctx;
    const root = el('sf-pause', null, 'pause');
    const backdrop = el('sf-backdrop sf-pause__backdrop', root);
    paint(el('sf-fill-abs', backdrop), vignette([0.02, 0.016, 0.03, 0.85]));

    this.frame = el('sf-frame sf-pause__main', root);
    const head = el('sf-pause__head', this.frame);
    const title = el('sf-pause__titlerow', head);
    text('sf-pause__title', title, '暂停', UIFontRole.Title);
    text('sf-seal sf-pause__seal', title, '止', UIFontRole.Title);
    this.stageLabel = text('sf-pause__stage', head, '', UIFontRole.Title);

    const cols = el('sf-pause__cols', this.frame);
    const nav = el('sf-pause__nav', cols);
    this.resumeBtn = btn(ctx, '继续', 'sf-btn--primary sf-btn--block sf-sound-confirm', nav, () => this.resume());
    btn(ctx, '设置', 'sf-btn--block', nav, () => {
      this.disarm();
      this.openSettings();
    });
    this.abandonBtn = btn(ctx, '放弃本局', 'sf-btn--block sf-btn--danger', nav, () => this.press('abandon'));
    this.menuBtn = btn(ctx, '返回主菜单', 'sf-btn--block sf-btn--ghost', nav, () => this.press('menu'));
    this.hintLabel = text('sf-pause__hint', nav, '');

    const info = el('sf-pause__info', cols);
    const hero = el('sf-pause__hero', info);
    this.crestEl = crest(null, hero);
    const hn = el('sf-pause__heroinfo', hero);
    this.heroName = text('sf-pause__heroname', hn, '', UIFontRole.Title);
    const facts = el('sf-facts', hn);
    this.timeVal = fact(facts, UIIcon.Hourglass, '用时', null);
    this.killsVal = fact(facts, UIIcon.Skull, '击杀', null);
    this.coinsVal = fact(facts, UIIcon.Coin, '灵石', 'sf-icon--coin');
    this.essenceVal = fact(facts, UIIcon.Essence, '魂晶', 'sf-icon--essence');

    const sh = el('sf-section', info);
    text('sf-section__title', sh, '秘卷', UIFontRole.Title);
    this.scrollCount = text('sf-section__count', sh, '', UIFontRole.Number);
    const sv = scroll('sf-pause__scrolls', info);
    this.scrolls = el('sf-chips', sv);
    const st = el('sf-section', info);
    text('sf-section__title', st, '属性', UIFontRole.Title);
    this.stats = el('sf-statgrid', info);
    return root;
  }

  override onOpen(): void {
    this.openedAt = this.now();
    this.disarm();
    this.refresh();
    this.tick(0);
  }

  override onClose(): void {
    this.disarm();
    if (this.hiding) return;
    // 用户关掉（继续 / Esc）：恢复游戏（在按键 / 点击处理里同步调，才能重新锁定鼠标）
    if (this.ctx.game.state === 'paused') this.ctx.game.resume();
  }

  /** 「继续」：关掉自己（onClose 回调 resume） */
  resume(): void {
    this.close();
  }

  override tick(_dt = 0): void {
    const now = this.now();
    const k = easeOut((now - this.openedAt) / 0.3);
    this.frame.style.opacity = String(Math.round(k * 1000) / 1000);
    this.frame.style.translate = `0px ${(14 * (1 - k)).toFixed(2)}px`;
    if (this.armed && now - this.armedAt > ArmSeconds) this.disarm();
  }

  /** 刷新右列（打开时调；时间是停的，开着期间不变） */
  refresh(): void {
    const ctx = this.ctx;
    const run = ctx.run;
    this.hintLabel.textContent = this.canSuspend
      ? '放弃本局：结算已获得的魂晶并显示结算。\n返回主菜单：本局保留，下次从本关开头「继续征程」（本关内的进度不保留）。'
      : '放弃本局：结算已获得的魂晶并显示结算。\n返回主菜单：同样结算，直接回到主菜单。';
    const hero = ctx.player?.hero ?? ctx.heroes.find((x) => x.id === run?.heroId) ?? null;
    setCrest(this.crestEl, hero);
    this.heroName.textContent = hero ? `${hero.name} · ${hero.title}` : '无名侠客';
    let label = '';
    try {
      label = run ? ctx.runPlan.stageLabel(run.stage) : '';
    } catch {
      label = run ? `${run.chapter + 1}-${run.stageIndex + 1}` : '';
    }
    this.stageLabel.textContent = label;
    this.timeVal.textContent = clock(run?.time ?? 0);
    this.killsVal.textContent = num(run?.kills ?? 0);
    this.coinsVal.textContent = num(run?.coins ?? 0);
    this.essenceVal.textContent = num(run?.essence ?? 0);
    try {
      const n = renderScrollList(ctx, this.scrolls, false);
      this.scrollCount.textContent = n > 0 ? String(n) : '';
    } catch (err) {
      console.error('[UI] 暂停菜单秘卷列表失败', err);
    }
    try {
      renderStatGrid(ctx, this.stats, PAUSE_STATS, false, true);
    } catch (err) {
      console.error('[UI] 暂停菜单属性失败', err);
    }
  }

  /** 二次确认：第一次按进入待确认（按钮字变成「再按一次确认」）返回 false，确认期内再按返回 true */
  private arm(key: ArmKey): boolean {
    if (this.armed === key) {
      this.disarm();
      return true;
    }
    this.disarm();
    this.armed = key;
    this.armedAt = this.now();
    const b = key === 'abandon' ? this.abandonBtn : this.menuBtn;
    b.textContent = '再按一次确认';
    b.classList.add('sf-btn--armed');
    sfx(this.ctx, 'ui_deny');
    return false;
  }

  private disarm(): void {
    this.armed = null;
    if (!this.abandonBtn) return;
    this.abandonBtn.textContent = '放弃本局';
    this.menuBtn.textContent = '返回主菜单';
    this.abandonBtn.classList.remove('sf-btn--armed');
    this.menuBtn.classList.remove('sf-btn--armed');
  }

  /** 这一局有续玩档：「返回主菜单」= 暂离，不结算（I5） */
  get canSuspend(): boolean {
    try {
      return this.ctx.game.canSuspend?.() ?? false;
    } catch {
      return false;
    }
  }

  /**
   * 按一次「放弃本局」/「返回主菜单」：放弃要二次确认；返回主菜单在能暂离时一按就走（不结算、不丢东西），
   * 否则（会结算）同样二次确认
   */
  press(key: ArmKey): void {
    const game = this.ctx.game;
    if (key === 'menu' && this.canSuspend) {
      this.disarm();
      game.suspendRun?.();
      return;
    }
    if (!this.arm(key)) return;
    if (key === 'abandon') game.endRun(false);
    else if (game.suspendRun) game.suspendRun();
    else game.toMenu();
  }
}

function fact(parent: HTMLElement, i: UIIcon, label: string, iconClass: string | null): HTMLDivElement {
  const e = el('sf-fact', parent);
  icon(i, iconClass, e);
  text('sf-fact__label', e, label);
  return text('sf-fact__val', e, '', UIFontRole.Number);
}
