/**
 * UI 管理器（IUI 实现）：组合 HUD、主菜单、暂停、结算、秘卷三选一、提示与黑幕，
 * 监听 game:stateChanged 管理各界面显隐；元素反应首次出现时弹出教学提示（ReactionTips）。
 * 所有 DOM 挂在 ctx.dom.ui 下。
 *
 * 层级（由下到上）：HUD（含敌人血条 / 准星 / Boss 条 / 交互提示 / Tab 面板）→ 横幅 →
 * 主菜单 / 暂停 / 结算 / 秘卷选择 → toast → 黑幕。
 */
import type { GameContext, GameState, IEnemy, InteractPrompt, IUI, RunSummary, ScrollDef } from '../core/types';
import { HUD } from './HUD';
import { MainMenu } from './MainMenu';
import { PauseMenu } from './PauseMenu';
import { SummaryScreen } from './SummaryScreen';
import { ScrollChoice } from './ScrollChoice';
import { Banner, PromptCard, Toasts } from './Notify';
import { Fade } from './Fade';
import { computeUiScale, uiScale } from './dom';
import { ReactionTips } from './ReactionTips';

/** 元素反应教学提示的显示时长（文案较长，比普通 toast 多留一会儿） */
const REACTION_TIP_MS = 4500;

export class UIManager implements IUI {
  private hud: HUD;
  private prompt: PromptCard;
  private bannerView: Banner;
  private menu: MainMenu;
  private pause: PauseMenu;
  private summary: SummaryScreen;
  private choice: ScrollChoice;
  private toasts: Toasts;
  private fader: Fade;
  private offs: (() => void)[] = [];
  private resizeTimer = 0;

  constructor(readonly ctx: GameContext) {
    // 构造阶段只创建 DOM，不访问其他系统
    const root = ctx.dom.ui;
    root.classList.add('gf-ui');
    this.applyScale();
    this.hud = new HUD(root, ctx);
    this.prompt = new PromptCard(this.hud.root);
    this.bannerView = new Banner(root);
    this.menu = new MainMenu(root, ctx);
    this.pause = new PauseMenu(root, ctx);
    this.summary = new SummaryScreen(root, ctx);
    this.choice = new ScrollChoice(root, ctx);
    this.toasts = new Toasts(root);
    this.fader = new Fade(root);
  }

  init(): void {
    const ev = this.ctx.events;
    this.offs.push(
      ev.on('game:stateChanged', ({ from, to }) => this.onState(from, to)),
      ev.on('enemy:damaged', ({ result }) => this.hud.onEnemyDamaged(result)),
      ev.on('enemy:killed', ({ result }) => this.hud.onEnemyKilled(result)),
      ev.on('player:damaged', ({ amount, toHp, from, source }) => this.hud.onPlayerDamaged(amount, toHp, from, source)),
      ev.on('player:shieldBroken', () => this.hud.onShieldBroken()),
      ev.on('coins:changed', ({ delta }) => this.hud.onCoins(delta)),
      ev.on('skill:used', ({ slot }) => this.hud.onSkillUsed(slot)),
      ev.on('weapon:switched', () => this.hud.onWeaponSwitched()),
      ev.on('weapon:skillUsed', () => this.hud.onWeaponSkillUsed()),
      ev.on('weapon:formChanged', () => this.hud.onWeaponFormChanged()),
      ev.on('weapon:skillImpale', ({ points }) => this.hud.onWeaponImpale(points)),
      ev.on('run:started', () => {
        this.hud.reset();
        this.choice.hide(true);
      }),
      ev.on('stage:loaded', () => this.hud.reset()),
    );
    // 元素反应首次提示（每局每种反应一次）
    const tips = new ReactionTips(this.ctx, (text, color) => this.toasts.push(text, color, REACTION_TIP_MS));
    tips.init();
    this.offs.push(() => tips.dispose());
    // 捕获阶段处理 UI 快捷键：命中时阻止冒泡，避免 Input 把数字键 / Esc 当成游戏操作
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onResize);
  }

  clear(): void {
    this.hud.reset();
    this.prompt.set(null);
  }

  update(dt: number): void {
    const now = performance.now();
    const state = this.ctx.game.state;
    this.hud.update(dt, now, state);
    try {
      this.prompt.update(this.ctx.run.coins);
    } catch (err) {
      console.error('[UI] 交互提示更新失败', err);
    }
  }

  // ───────────── IUI ─────────────

  showMainMenu(): void {
    this.pause.hide();
    this.summary.hide();
    this.choice.hide(true);
    this.menu.show();
  }

  showPause(visible: boolean): void {
    if (visible) this.pause.show();
    else this.pause.hide();
  }

  showSummary(summary: RunSummary): void {
    this.pause.hide();
    this.choice.hide(true);
    this.menu.hide();
    this.summary.show(summary);
    // 结算层在黑幕之下：若仍有残留黑幕则淡出
    if (this.fader.opacity > 0.01) void this.fader.to(0, 0.4);
  }

  showScrollChoice(options: ScrollDef[], onPick: (s: ScrollDef) => void): void {
    if (!options || options.length === 0) {
      this.ctx.game.closeModal();
      return;
    }
    // 若调用方尚未打开模态框，这里补上（openModal 只在 playing 时生效）
    if (this.ctx.game.state === 'playing') this.ctx.game.openModal();
    this.choice.show(options, onPick);
  }

  showHUD(visible: boolean): void {
    this.hud.setVisible(visible);
    if (!visible) this.prompt.set(null);
  }

  toast(text: string, color?: string): void {
    this.toasts.push(text, color);
  }

  banner(title: string, subtitle?: string, duration?: number): void {
    this.bannerView.show(title, subtitle, duration);
  }

  setBoss(enemy: IEnemy | null): void {
    this.hud.boss.set(enemy);
  }

  setInteractPrompt(p: InteractPrompt | null): void {
    this.prompt.set(p);
  }

  fade(to: number, duration: number): Promise<void> {
    return this.fader.to(to, duration);
  }

  // ───────────── 内部 ─────────────

  /** 按视口写入缩放变量（CSS 用 --ui-s / --ui-up / --hud-s；JS 读 uiScale） */
  private applyScale(): void {
    const { s, hud } = computeUiScale(window.innerWidth, window.innerHeight);
    uiScale.s = s;
    uiScale.hud = hud;
    const st = this.ctx.dom.ui.style;
    st.setProperty('--ui-s', s.toFixed(4));
    st.setProperty('--ui-up', Math.max(1, s).toFixed(4));
    st.setProperty('--hud-s', hud.toFixed(4));
  }

  /**
   * resize 去抖后再重排（拖动窗口时不反复强制布局）。
   * 用 setTimeout 而不是 rAF：标签页在后台时 rAF 不触发，回到前台会带着旧缩放。
   */
  private onResize = (): void => {
    if (this.resizeTimer) return;
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = 0;
      try {
        this.applyScale();
        this.menu.refit();
        this.pause.refit();
        this.summary.refit();
        this.choice.refit();
      } catch (err) {
        console.error('[UI] 自适应缩放失败', err);
      }
    }, 60);
  };

  private onState(_from: GameState, to: GameState): void {
    this.hud.root.classList.toggle('is-idle', to !== 'playing');
    switch (to) {
      case 'playing':
        this.menu.hide();
        this.summary.hide();
        this.pause.hide();
        // 选择后 ScrollChoice 自己播放收起动画；未选择就回到游戏则直接收起
        if (this.choice.pending) this.choice.hide();
        blurActive();
        break;
      case 'transition':
        this.menu.hide();
        this.summary.hide();
        this.pause.hide();
        if (this.choice.pending) this.choice.hide();
        blurActive();
        break;
      case 'menu':
        this.pause.hide();
        this.summary.hide();
        this.choice.hide(true);
        // 上一局残留的 toast / 横幅不应带进主菜单
        this.toasts.clear();
        this.bannerView.hide(true);
        break;
      case 'summary':
        this.pause.hide();
        this.menu.hide();
        this.choice.hide(true);
        this.prompt.set(null);
        break;
      default:
        break;
    }
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
      // 滑条获得焦点时 Esc 仍然用于返回
      if (e.code !== 'Escape') return;
    }
    // 焦点在按钮上时，Enter / 空格交给按钮自身的点击行为
    if (t instanceof HTMLButtonElement && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space')) return;
    let handled = false;
    try {
      const state = this.ctx.game.state;
      if (this.choice.pending) handled = this.choice.handleKey(e);
      else if (state === 'paused') handled = this.pause.handleKey(e);
      else if (state === 'menu') handled = this.menu.handleKey(e);
    } catch (err) {
      console.error('[UI] 快捷键处理失败', err);
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
}

function blurActive(): void {
  const el = document.activeElement as HTMLElement | null;
  if (el && el !== document.body && typeof el.blur === 'function') el.blur();
}
