/**
 * UI 管理器（IUI 实现；Unity G/UI/GameUI.cs 门面 + UIRoot + ScreenHotkeys 的网页对应）。
 * 层级照 Unity 的四层（toolkit/UILayers）：
 *   Hud      战斗 HUD（hud/Hud.ts 的部件：生命护盾、武器、技能、信息角、准星、狙击镜、受击、伤害数字、头顶血条 + 精英印章、首领血条、
 *            提示卡、反应教学、罗盘条、秘卷触发弹字、灵宠面板）
 *   Overlay  横幅、全屏闪光、中央大字、秘卷三选一选中后的离场卡面
 *   Modal    路由界面（toolkit/UIRouter）：主菜单、选英雄、天赋、图鉴、设置、操作说明、确认框、暂停、行囊、全图、关卡卡片、秘卷三选一、整局结算；
 *            最下面垫着主菜单的 CSS 远景（MenuBackdrop，网页没有菜单场景）
 *   Toast    提示队列、黑幕
 * 全部界面的层位登记在 SCREEN_SLOTS。监听 game:stateChanged 管理各界面显隐；所有 DOM 挂在 ctx.dom.ui 下。
 * 局内热键（Unity ScreenHotkeys）：Tab 开行囊、M 开全图——只在正常游玩时响应，关掉由界面自己处理。
 */
import type * as THREE from 'three';
import type { DamageNumberOpts, GameContext, GameState, IEnemy, InteractPrompt, IUI, RunSummary, ScrollDef, StageNode } from '../core/types';
import { RARITY_NAMES } from '../core/types';
import { allEnemyIds, getEnemyDef } from '../enemies/Registry';
import { specOf } from '../progression/RunPlan';
import { WEAPON_DEFS } from '../weapons/WeaponDefs';
import { KeyBinds } from './KeyBinds';
import { MapModel } from './MapMarkers';
import { type PetSource, EMPTY_PETS } from './PetData';
import type { StageBrief, StageCardInfo } from './ScreenData';
import { Codex, CodexCatalog } from './codex/Codex';
import { CodexThumbs } from './codex/CodexThumbs';
import { CodexTracker } from './codex/CodexTracker';
import { UILayer } from './toolkit/UILayers';
import { UIRoot, realNow } from './toolkit/UIRoot';
import { GoldHi, type RGBA, css, elementColor, parseCss, rarityColor } from './toolkit/UITheme';
import { Hud } from './hud/Hud';
import { BossBar } from './hud/BossBar';
import { CenterTextWidget } from './hud/CenterTextWidget';
import { CompassStrip } from './hud/CompassStrip';
import { DamageNumbers, kindOf } from './hud/DamageNumbers';
import { HurtWidget } from './hud/HurtWidget';
import { InfoWidget } from './hud/InfoWidget';
import { PetPanelWidget } from './hud/PetPanelWidget';
import { PromptWidget } from './hud/PromptWidget';
import { ScrollProcPop } from './hud/ScrollProcPop';
import { CODEX_ID, CodexScreen } from './screens/CodexScreen';
import { CONFIRM_ID, ConfirmScreen } from './screens/ConfirmScreen';
import { CONTROLS_ID, ControlsScreen } from './screens/ControlsScreen';
import { HERO_SELECT_SCREEN_ID, HeroSelectScreen } from './screens/HeroSelectScreen';
import { INVENTORY_ID, InventoryScreen } from './screens/InventoryScreen';
import { MAIN_MENU_ID, MainMenuScreen } from './screens/MainMenuScreen';
import { MAP_ID, MapScreen } from './screens/MapScreen';
import { MenuBackdrop } from './screens/MenuBackdrop';
import { PAUSE_ID, PauseScreen } from './screens/PauseScreen';
import { SCROLL_CHOICE_ID, ScrollChoiceScreen } from './screens/ScrollChoiceScreen';
import { SETTINGS_ID, SettingsScreen } from './screens/SettingsScreen';
import { STAGE_CARD_ID, StageCardScreen } from './screens/StageCardScreen';
import { SUMMARY_ID, SummaryScreen } from './screens/SummaryScreen';
import { TALENTS_SCREEN_ID, TalentScreen } from './screens/TalentScreen';

/** 界面层位（Unity 各界面的 Layer / HUD 部件的层）：路由界面按 id 打开时挂到对应层 */
export const SCREEN_SLOTS: { id: string; layer: UILayer; title: string; done: boolean }[] = [
  { id: PAUSE_ID, layer: UILayer.Modal, title: '暂停', done: true },
  { id: SETTINGS_ID, layer: UILayer.Modal, title: '设置（含「按键」改键页）', done: true },
  { id: CODEX_ID, layer: UILayer.Modal, title: '图鉴（含缩略图棚）', done: true },
  { id: MAP_ID, layer: UILayer.Modal, title: '地图（+ HUD 层罗盘条）', done: true },
  { id: STAGE_CARD_ID, layer: UILayer.Modal, title: '关卡卡片', done: true },
  { id: CONFIRM_ID, layer: UILayer.Modal, title: '确认框', done: true },
  { id: CONTROLS_ID, layer: UILayer.Modal, title: '按键说明', done: true },
  { id: MAIN_MENU_ID, layer: UILayer.Modal, title: '主菜单', done: true },
  { id: HERO_SELECT_SCREEN_ID, layer: UILayer.Modal, title: '选英雄', done: true },
  { id: TALENTS_SCREEN_ID, layer: UILayer.Modal, title: '天赋', done: true },
  { id: SUMMARY_ID, layer: UILayer.Modal, title: '整局结算', done: true },
  { id: SCROLL_CHOICE_ID, layer: UILayer.Modal, title: '秘卷三选一', done: true },
  { id: INVENTORY_ID, layer: UILayer.Modal, title: 'Tab 行囊（含灵宠页）', done: true },
  { id: 'pet-panel', layer: UILayer.Hud, title: '灵宠面板（HUD 部件；数据等 M9）', done: true },
  { id: 'elite-seal', layer: UILayer.Hud, title: '精英灵契（头顶血条上的印章）', done: true },
  { id: 'scroll-proc', layer: UILayer.Hud, title: '秘卷触发弹字（HUD 部件）', done: true },
  { id: 'scope', layer: UILayer.Hud, title: '瞄准镜遮罩（HUD 部件）', done: true },
];

/** 在主菜单上叠开的页（回到游戏 / 换关时一并收起） */
const MENU_SCREENS = [MAIN_MENU_ID, HERO_SELECT_SCREEN_ID, TALENTS_SCREEN_ID, CODEX_ID, CONTROLS_ID, CONFIRM_ID, SUMMARY_ID];

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export class UIManager implements IUI {
  readonly root: UIRoot;
  readonly hud: Hud;
  /** 键位表（改键页、按键说明、局内热键、关卡卡片） */
  readonly keys: KeyBinds;
  /** 图鉴（收录记录、条目清单、缩略图） */
  readonly codex: Codex;
  readonly thumbs: CodexThumbs;
  /** 行旅图地点（罗盘条与全图共用） */
  readonly map = new MapModel();
  private readonly tracker: CodexTracker;
  private readonly backdrop: MenuBackdrop;
  private pets: PetSource = EMPTY_PETS;
  private catalogV: CodexCatalog | null = null;
  private pause: PauseScreen;
  private settings: SettingsScreen;
  private heroSelect: HeroSelectScreen;
  private choice: ScrollChoiceScreen;
  private offs: (() => void)[] = [];
  private resizeTimer = 0;
  private lastNow = -1;
  private hudShown = false;
  /** 进关时的快照（关卡卡片算本关用时 / 击杀 / 灵石净变化 / 新得秘卷） */
  private entry = { time: 0, kills: 0, coins: 0, scrolls: 0 };

  constructor(readonly ctx: GameContext) {
    // 构造阶段只创建 DOM，不访问其他系统
    const container = ctx.dom.ui;
    container.classList.add('gf-ui');
    this.root = new UIRoot(container);
    this.hud = new Hud(this.root, ctx);
    const storage = safeStorage();
    this.keys = new KeyBinds(storage, ctx.input);
    this.codex = new Codex(storage);
    this.thumbs = new CodexThumbs(ctx);
    this.tracker = new CodexTracker(ctx, this.codex, () => this.catalog, () => this.pets);
    this.backdrop = new MenuBackdrop(this.root.host(UILayer.Modal));

    const router = this.root.router;
    const now = realNow;
    this.settings = router.register(new SettingsScreen(ctx, now, this.keys)) as SettingsScreen;
    this.pause = router.register(new PauseScreen(ctx, () => router.open(SETTINGS_ID), now)) as PauseScreen;
    router.register(new ConfirmScreen(ctx, now));
    router.register(new ControlsScreen(ctx, this.keys, now));
    router.register(new CodexScreen(ctx, this.codex, () => this.catalog, this.thumbs, now));
    router.register(new MapScreen(ctx, this.map, this.keys, this.root.panel, now));
    router.register(new StageCardScreen(ctx, this.keys, now));
    router.register(new MainMenuScreen(ctx, this.codex, () => this.catalog, now));
    this.heroSelect = router.register(new HeroSelectScreen(ctx, (t, c) => this.toast(t, c), now)) as HeroSelectScreen;
    router.register(new TalentScreen(ctx, now));
    router.register(new SummaryScreen(ctx, now));
    this.choice = router.register(new ScrollChoiceScreen(ctx, () => this.root.layer(UILayer.Overlay), now)) as ScrollChoiceScreen;
    router.register(new InventoryScreen(ctx, this.keys, () => this.pets, now));

    const boss = () => this.hud.widget(BossBar)?.enemy ?? null;
    const info = this.hud.widget(InfoWidget);
    if (info) info.boss = boss;
    const compass = this.hud.widget(CompassStrip);
    if (compass) {
      compass.model = this.map;
      compass.bossShown = () => !!boss();
    }
    const pet = this.hud.widget(PetPanelWidget);
    if (pet) pet.keys = this.keys;
  }

  /** 图鉴条目清单（第一次用到时按注册表建好；灵宠名录换了来源后重建） */
  get catalog(): CodexCatalog {
    if (!this.catalogV) {
      const ctx = this.ctx;
      let pets: ReturnType<PetSource['catalog']> = [];
      try {
        pets = this.pets.catalog();
      } catch {
        pets = [];
      }
      this.catalogV = new CodexCatalog({
        weapons: WEAPON_DEFS,
        scrolls: ctx.scrolls?.all ?? [],
        enemies: allEnemyIds().map((id) => getEnemyDef(id)!).filter(Boolean),
        pets,
        rarityName: (r) => RARITY_NAMES[r] ?? '',
        rarityColor,
        elementColor,
      });
      this.codex.catalog = this.catalogV;
    }
    return this.catalogV;
  }

  init(): void {
    const ev = this.ctx.events;
    this.offs.push(
      ev.on('game:stateChanged', ({ from, to }) => this.onState(from, to)),
      ev.on('run:started', () => {
        this.hud.reset();
        this.root.router.close(SCROLL_CHOICE_ID);
      }),
      ev.on('stage:loaded', () => {
        this.hud.reset();
        this.snapshotEntry();
      }),
    );
    // ?uishots（截图脚本）不弹「图鉴新收录」，免得挡截图
    if (!new URLSearchParams(location.search).has('uishots')) this.tracker.toast = (t) => this.toast(t, css(GoldHi), 2.2);
    this.tracker.init();
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
    try {
      this.tracker.tick(now);
    } catch (err) {
      console.error('[UI] 图鉴收录失败', err);
    }
  }

  // ───────────── IUI ─────────────

  showMainMenu(): void {
    const router = this.root.router;
    router.closeAll();
    this.backdrop.setVisible(true);
    router.open(MAIN_MENU_ID);
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
      router.close(CONFIRM_ID);
      router.close(SETTINGS_ID);
      router.close(PAUSE_ID);
    } finally {
      this.pause.hiding = false;
    }
  }

  showSummary(summary: RunSummary): void {
    this.showPause(false);
    const router = this.root.router;
    router.closeAll();
    router.open(SUMMARY_ID, summary);
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
    this.root.router.open(SCROLL_CHOICE_ID, { choices: options, onPick });
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

  /**
   * 关间结算卡（Game.advance 进下一关之前问这里）：弹出卡片并返回 true，玩家按「继续」后回调 proceed；
   * 没有规划表数据 / 界面打不开时返回 false（Game 直接换关）
   */
  stageCard(next: StageNode, proceed: () => void): boolean {
    const ctx = this.ctx;
    try {
      const run = ctx.run;
      if (!run || ctx.game.state !== 'playing') return false;
      const brief = (node: StageNode | null | undefined): StageBrief | null => {
        const s = node ? specOf(run, node) : null;
        if (!s || !node) return null;
        return { label: s.label, title: s.title, chapter: s.chapter, chapterName: s.chapterName, difficulty: s.difficulty, isBoss: s.isBoss, supplyCamp: s.supplyCamp, rewardLabel: node.reward && node.reward !== 'none' ? ctx.runPlan.rewardLabel(node.reward) : '' };
      };
      const scrolls = this.scrollLayers();
      const info: StageCardInfo = {
        stage: brief(run.stage), next: brief(next), title: run.stage ? ctx.runPlan.stageLabel(run.stage) : undefined,
        time: Math.max(0, run.time - this.entry.time), kills: Math.max(0, run.kills - this.entry.kills),
        coinsDelta: run.coins - this.entry.coins, coins: run.coins, scrolls, scrollsGained: Math.max(0, scrolls - this.entry.scrolls), nextReady: true,
      };
      return this.root.router.open(STAGE_CARD_ID, { info, onContinue: proceed });
    } catch (err) {
      console.error('[UI] 关卡卡片打不开，直接换关', err);
      return false;
    }
  }

  // ───────────── Unity GameUI 的其余门面 ─────────────

  /** 世界空间浮字（反应名「焚雷」、「格挡」…）：往上飘，不参与伤害数字的合并，也不受「伤害数字」开关影响。scale ≥ 1.25 带墨底描边框，≥ 1.6 大号 */
  floatText(pos: THREE.Vector3, text: string, color?: number | string, scale = 1.3): void {
    const c: RGBA | null = typeof color === 'number' ? [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, 1] : parseCss(color);
    this.hud.widget(DamageNumbers)?.float(pos, text, c, scale);
  }

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

  /** 秘卷效果触发了一次（Unity GameEvents.ScrollProc）：准星右上方弹一行卷名。秘卷系统接上触发点之前没有调用方 */
  scrollProc(id: string): void {
    this.hud.widget(ScrollProcPop)?.push(id);
  }

  /** 灵宠系统（M9）接进来时给：当前结契的灵宠 + 灵宠名录。HUD 面板、行囊灵宠页、图鉴灵宠页签都读它 */
  setPetSource(source: PetSource | null): void {
    this.pets = source ?? EMPTY_PETS;
    const w = this.hud.widget(PetPanelWidget);
    if (w) w.source = this.pets;
    this.catalogV = null;
  }

  // ───────────── 内部 ─────────────

  private scrollLayers(): number {
    let n = 0;
    try {
      for (const o of this.ctx.scrolls.owned()) n += o.stacks;
    } catch {
      n = 0;
    }
    return n;
  }

  private snapshotEntry(): void {
    const run = this.ctx.run;
    this.entry = { time: run?.time ?? 0, kills: run?.kills ?? 0, coins: run?.coins ?? 0, scrolls: this.scrollLayers() };
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
        this.root.resize(window.innerWidth, window.innerHeight);
        const map = this.root.router.find(MAP_ID);
        if (map) (map as MapScreen).rebuild();
      } catch (err) {
        console.error('[UI] 自适应缩放失败', err);
      }
    }, 60);
  };

  private onState(_from: GameState, to: GameState): void {
    const router = this.root.router;
    if (to !== 'menu') this.backdrop.setVisible(false);
    switch (to) {
      case 'playing':
        this.showPause(false);
        for (const id of MENU_SCREENS) router.close(id);
        // 选了之后三选一自己关；没选就回到游戏的直接收起
        if (this.choice.pending) router.close(SCROLL_CHOICE_ID);
        blurActive();
        break;
      case 'transition':
        this.showPause(false);
        router.closeAll();
        blurActive();
        break;
      case 'menu':
        this.showPause(false);
        router.closeAll();
        this.backdrop.setVisible(true);
        // 上一局残留的 toast / 横幅不应带进主菜单
        this.clearMessages();
        this.hud.widget(CenterTextWidget)?.set(null);
        break;
      case 'summary':
        this.showPause(false);
        for (const id of router.ids) if (id !== SUMMARY_ID) router.close(id);
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
    let handled = false;
    try {
      const router = this.root.router;
      const top = router.top;
      if (top === this.settings && this.settings.rebinding && !e.repeat && this.settings.captureKey(e.code)) handled = true; // 改键中：下一个键（回车 / 空格也算）就是新键位
      else if (top === this.heroSelect && !e.repeat && (e.code === 'Enter' || e.code === 'NumpadEnter') && this.heroSelect.submitOnTab(t)) handled = true; // 名录上回车 = 出征
      else if (t instanceof HTMLButtonElement && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space')) return; // 焦点在按钮上：交给按钮自身的点击
      else if (router.count > 0) {
        // 暂停（路由栈底）上按 Esc / P 交给 Game：它在恢复前检查暂停刚打开的 0.3 s（防止同一下按键既暂停又恢复）
        const onlyPause = router.count === 1 && top?.id === PAUSE_ID;
        if (!(onlyPause && (e.code === 'Escape' || e.code === 'KeyP'))) handled = router.key(e.code, true, e.repeat);
      } else if (!e.repeat) handled = this.hotkey(e.code);
    } catch (err) {
      console.error('[UI] 快捷键处理失败', err);
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /** 局内开界面的热键：只在正常游玩、玩家活着时响应 */
  private hotkey(code: string): boolean {
    const ctx = this.ctx;
    if (ctx.game.state !== 'playing' || !(ctx.player?.hp > 0)) return false;
    if (this.keys.matches('inventory', code)) return this.root.router.open(INVENTORY_ID);
    if (this.keys.matches('map', code)) return this.root.router.open(MAP_ID);
    return false;
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.root.router.count > 0 && e.code.startsWith('Arrow')) this.root.router.key(e.code, false);
  };
}

function blurActive(): void {
  const el = document.activeElement as HTMLElement | null;
  if (el && el !== document.body && typeof el.blur === 'function') el.blur();
}
