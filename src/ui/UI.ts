/**
 * UI 管理器（IUI 实现；Unity G/UI/GameUI.cs 门面 + UIRoot 的网页对应）。
 * 层级照 Unity 的四层（toolkit/UILayers）：
 *   Hud      战斗 HUD（hud/Hud.ts 的部件：生命护盾、武器、技能、信息角、准星、受击、伤害数字、头顶血条、首领血条、提示卡、反应教学）
 *            + 第二期之前沿用的旧件（行旅图、Tab 行囊、狙击镜遮罩）
 *   Overlay  横幅、全屏闪光、中央大字
 *   Modal    路由界面（toolkit/UIRouter：暂停、设置）+ 还没迁的旧界面（主菜单、结算、秘卷三选一，挂在本层不缩放的壳里）
 *   Toast    提示队列、黑幕
 * 第二期的新界面（图鉴、地图 + 罗盘条、关卡卡片、确认框、按键说明、灵宠面板、精英灵契、秘卷弹字、瞄准镜）在 SCREEN_SLOTS 里留了层位。
 * 监听 game:stateChanged 管理各界面显隐；所有 DOM 挂在 ctx.dom.ui 下。
 */
import type * as THREE from 'three';
import type { DamageNumberOpts, GameContext, GameState, IEnemy, InteractPrompt, IUI, RunSummary, ScrollDef } from '../core/types';
import { MainMenu } from './MainMenu';
import { SummaryScreen } from './SummaryScreen';
import { ScrollChoice } from './ScrollChoice';
import { computeUiScale, uiScale } from './dom';
import { UILayer } from './toolkit/UILayers';
import { UIRoot, realNow } from './toolkit/UIRoot';
import { type RGBA, parseCss } from './toolkit/UITheme';
import { Hud } from './hud/Hud';
import { BossBar } from './hud/BossBar';
import { CenterTextWidget } from './hud/CenterTextWidget';
import { DamageNumbers, kindOf } from './hud/DamageNumbers';
import { HurtWidget } from './hud/HurtWidget';
import { InfoWidget } from './hud/InfoWidget';
import { PromptWidget } from './hud/PromptWidget';
import { PAUSE_ID, PauseScreen } from './screens/PauseScreen';
import { SETTINGS_ID, SettingsScreen } from './screens/SettingsScreen';

/**
 * 界面层位（Unity 各界面的 Layer）：这一期接上的和第二期要做的都列在这里，路由按 id 打开时挂到对应层。
 * done = 本期已照译（其余是第二期的位置，现在打开会报「没有登记」）
 */
export const SCREEN_SLOTS: { id: string; layer: UILayer; title: string; done: boolean }[] = [
  { id: PAUSE_ID, layer: UILayer.Modal, title: '暂停', done: true },
  { id: SETTINGS_ID, layer: UILayer.Modal, title: '设置', done: true },
  { id: 'codex', layer: UILayer.Modal, title: '图鉴（含运行时缩略图棚）', done: false },
  { id: 'map', layer: UILayer.Modal, title: '地图（+ HUD 层罗盘条）', done: false },
  { id: 'stage-card', layer: UILayer.Modal, title: '关卡卡片', done: false },
  { id: 'confirm', layer: UILayer.Modal, title: '确认框', done: false },
  { id: 'controls', layer: UILayer.Modal, title: '按键说明', done: false },
  { id: 'pet-panel', layer: UILayer.Hud, title: '灵宠面板（HUD 部件）', done: false },
  { id: 'elite-seal', layer: UILayer.Hud, title: '精英灵契（头顶血条上的印章）', done: false },
  { id: 'scroll-proc', layer: UILayer.Hud, title: '秘卷触发弹字（HUD 部件）', done: false },
  { id: 'scope', layer: UILayer.Hud, title: '瞄准镜遮罩（HUD 部件，现在沿用网页旧遮罩）', done: false },
];

export class UIManager implements IUI {
  readonly root: UIRoot;
  readonly hud: Hud;
  private menu: MainMenu;
  private summary: SummaryScreen;
  private choice: ScrollChoice;
  private pause: PauseScreen;
  private settings: SettingsScreen;
  private offs: (() => void)[] = [];
  private resizeTimer = 0;
  private lastNow = -1;
  private hudShown = false;

  constructor(readonly ctx: GameContext) {
    // 构造阶段只创建 DOM，不访问其他系统
    const container = ctx.dom.ui;
    container.classList.add('gf-ui');
    this.applyScale();
    this.root = new UIRoot(container);
    this.hud = new Hud(this.root, ctx);
    const modal = this.root.host(UILayer.Modal);
    this.menu = new MainMenu(modal, ctx);
    this.summary = new SummaryScreen(modal, ctx);
    this.choice = new ScrollChoice(modal, ctx);
    const router = this.root.router;
    this.settings = router.register(new SettingsScreen(ctx, realNow)) as SettingsScreen;
    this.pause = router.register(new PauseScreen(ctx, () => router.open(SETTINGS_ID), realNow)) as PauseScreen;
    const info = this.hud.widget(InfoWidget);
    if (info) info.boss = () => this.hud.widget(BossBar)?.enemy ?? null;
  }

  init(): void {
    const ev = this.ctx.events;
    this.offs.push(
      ev.on('game:stateChanged', ({ from, to }) => this.onState(from, to)),
      ev.on('run:started', () => {
        this.hud.reset();
        this.choice.hide(true);
      }),
      ev.on('stage:loaded', () => this.hud.reset()),
    );
    // 捕获阶段处理 UI 快捷键：命中时阻止冒泡，避免 Input 把数字键 / Esc 当成游戏操作
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('resize', this.onResize);
  }

  clear(): void {
    this.hud.reset();
    this.setInteractPrompt(null);
  }

  update(dt: number): void {
    const now = realNow();
    const udt = this.lastNow < 0 ? 0 : Math.min(0.1, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    const state = this.ctx.game.state;
    const playing = state === 'playing';
    // 电影模式（首领登场演出把 HUD 藏起）：提示条一起淡出；菜单 / 结算里藏 HUD 不影响提示
    this.root.hudHidden = !this.hudShown && (state === 'playing' || state === 'transition');
    try {
      this.root.tick(now, udt);
    } catch (err) {
      console.error('[UI] 界面根更新失败', err);
    }
    this.hud.tick(playing ? dt : 0, udt, now, playing, false);
  }

  // ───────────── IUI ─────────────

  showMainMenu(): void {
    this.root.router.closeAll();
    this.summary.hide();
    this.choice.hide(true);
    this.menu.show();
  }

  showPause(visible: boolean): void {
    const router = this.root.router;
    if (visible) {
      if (!router.isOpen(PAUSE_ID)) router.open(PAUSE_ID);
      this.clearMessages();
      return;
    }
    // 收起暂停和叠在上面的设置页（Game 自己在恢复，不回调 resume）
    this.pause.hiding = true;
    try {
      router.close(SETTINGS_ID);
      router.close(PAUSE_ID);
    } finally {
      this.pause.hiding = false;
    }
  }

  showSummary(summary: RunSummary): void {
    this.showPause(false);
    this.choice.hide(true);
    this.menu.hide();
    this.summary.show(summary);
    // 结算层在黑幕之下：若仍有残留黑幕则淡出
    if (this.root.curtain.opacity > 0.01) void this.root.curtain.fadeTo(0, 0.4);
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
    this.hudShown = visible;
    this.hud.setVisible(visible);
  }

  /** 提示（屏幕左侧往下叠，最多 4 条，和上一条相同就合并 ×N）；color = 强调色（CSS），缺省鎏金 */
  toast(text: string, color?: string, seconds?: number): void {
    this.root.toasts.push(text, color, seconds);
  }

  /**
   * 大横幅；subtitle 是第二行小字。旧写法把两行塞进 title（"1-1\n古道穿越戈壁"）时：最后一行当标题、前面的当副标题（同 Unity GameUI.Banner）
   */
  banner(title: string, subtitle?: string, duration?: number): void {
    let t = title ?? '', sub = subtitle;
    if (!sub && t.includes('\n')) {
      const cut = t.lastIndexOf('\n');
      sub = t.slice(0, cut).replace(/\n/g, ' · ');
      t = t.slice(cut + 1);
    }
    this.root.banner.show(t, sub, duration ?? 2.6);
  }

  setBoss(enemy: IEnemy | null): void {
    this.hud.widget(BossBar)?.set(enemy);
  }

  setInteractPrompt(p: InteractPrompt | null): void {
    this.hud.widget(PromptWidget)?.set(p);
  }

  fade(to: number, duration: number): Promise<void> {
    return this.root.curtain.fadeTo(to, duration);
  }

  /** 伤害数字（combat/Feedback 调；opts.target = 挨打的敌人，按目标合并） */
  damageNumber(pos: THREE.Vector3, amount: number, opts?: DamageNumberOpts): void {
    const dn = this.hud.widget(DamageNumbers);
    if (!dn) return;
    if (opts?.kind === 'reaction') {
      this.floatText(pos, opts.text ?? '', opts.color, opts.big ? 1.6 : 1.3);
      return;
    }
    dn.queue(opts?.target ?? null, pos, amount, !!opts?.crit, opts?.element ?? 'none', kindOf(opts?.kind), !!opts?.dot);
  }

  /** 世界空间浮字（反应名「焚雷」、「格挡」…）：往上飘，不参与伤害数字的合并，也不受「伤害数字」开关影响。scale ≥ 1.25 带墨底描边框，≥ 1.6 大号 */
  floatText(pos: THREE.Vector3, text: string, color?: number | string, scale = 1.3): void {
    const c: RGBA | null = typeof color === 'number' ? [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, 1] : parseCss(color);
    this.hud.widget(DamageNumbers)?.float(pos, text, c, scale);
  }

  // ───────────── Unity GameUI 的其余门面（网页玩法还没有调用方）─────────────

  /** 目标文字（右上信息角；null = 按关卡状态自动拼） */
  setObjective(text: string | null): void {
    const info = this.hud.widget(InfoWidget);
    if (info) info.explicitObjective = text;
  }

  /** 屏幕中央的大字（Unity 富文本；null / 空 = 收起） */
  setCenterText(richText: string | null): void {
    this.hud.widget(CenterTextWidget)?.set(richText);
  }

  /** 全屏闪光（颜色含 alpha，按剩余时间平方淡出；不受暂停影响） */
  screenFlash(color: RGBA, seconds: number): void {
    this.root.flash.play(color, seconds);
  }

  /** 受击闪屏（shieldOnly = 蓝，否则红；peak = 峰值不透明度 0..1） */
  hurtFlash(shieldOnly: boolean, peak = 0.4): void {
    this.hud.widget(HurtWidget)?.flash(shieldOnly, peak);
  }

  /** 四周暗角的额外强度 0..1（寒意、日晒灼烧这类减益） */
  setVignetteBoost(strength: number): void {
    const w = this.hud.widget(HurtWidget);
    if (w) w.vignetteBoost = strength;
  }

  /** 收起横幅与提示（弹模态界面、结算前） */
  clearMessages(): void {
    this.root.toasts.clear();
    this.root.banner.hide(true);
  }

  // ───────────── 内部 ─────────────

  /** 旧界面的缩放变量（CSS 用 --ui-s / --ui-up / --hud-s；JS 读 uiScale）；新界面按 1920×1080 Expand 缩放（UIRoot.resize） */
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
        this.root.resize(window.innerWidth, window.innerHeight);
        this.menu.refit();
        this.summary.refit();
        this.choice.refit();
      } catch (err) {
        console.error('[UI] 自适应缩放失败', err);
      }
    }, 60);
  };

  private onState(_from: GameState, to: GameState): void {
    switch (to) {
      case 'playing':
        this.menu.hide();
        this.summary.hide();
        this.showPause(false);
        // 选择后 ScrollChoice 自己播放收起动画；未选择就回到游戏则直接收起
        if (this.choice.pending) this.choice.hide();
        blurActive();
        break;
      case 'transition':
        this.menu.hide();
        this.summary.hide();
        this.showPause(false);
        if (this.choice.pending) this.choice.hide();
        blurActive();
        break;
      case 'menu':
        this.showPause(false);
        this.root.router.closeAll();
        this.summary.hide();
        this.choice.hide(true);
        // 上一局残留的 toast / 横幅不应带进主菜单
        this.clearMessages();
        this.hud.widget(CenterTextWidget)?.set(null);
        break;
      case 'summary':
        this.showPause(false);
        this.menu.hide();
        this.choice.hide(true);
        this.setInteractPrompt(null);
        break;
      default:
        break;
    }
  }

  private onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
      // 滑条获得焦点时 Esc 仍然用于返回
      if (e.code !== 'Escape') return;
    }
    // 焦点在按钮上时，Enter / 空格交给按钮自身的点击行为
    if (t instanceof HTMLButtonElement && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space')) return;
    let handled = false;
    try {
      const router = this.root.router;
      if (router.count > 0) {
        // 暂停（路由栈底）上按 Esc / P 交给 Game：它在恢复前检查暂停刚打开的 0.3 s（防止同一下按键既暂停又恢复）
        const onlyPause = router.count === 1 && router.top?.id === PAUSE_ID;
        if (!(onlyPause && (e.code === 'Escape' || e.code === 'KeyP'))) handled = router.key(e.code, true, e.repeat);
      } else if (!e.repeat) {
        const state = this.ctx.game.state;
        if (this.choice.pending) handled = this.choice.handleKey(e);
        else if (state === 'menu') handled = this.menu.handleKey(e);
      }
    } catch (err) {
      console.error('[UI] 快捷键处理失败', err);
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.root.router.count > 0 && e.code.startsWith('Arrow')) this.root.router.key(e.code, false);
  };
}

function blurActive(): void {
  const el = document.activeElement as HTMLElement | null;
  if (el && el !== document.body && typeof el.blur === 'function') el.blur();
}
