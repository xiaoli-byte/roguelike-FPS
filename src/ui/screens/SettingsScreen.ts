/**
 * 设置（照译 Unity G/UI/Screens/SettingsScreen.cs）：叠在暂停菜单上，返回回去。
 * 控件按设置表（SETTING_DEFS，= Unity GameSettings.All 里网页有对应的项）自动生成：
 *   分组 → 页签（操作 / 画面 / 声音，按登记顺序），数值 → 滑条（方向键左右直接调）+ 读数，开关 → 拨钮，多选一 → 分段按钮。
 *   页签：点击，或 Q / E 切换。改动即时生效、自动保存（ctx.game.applySettings / saveSettings）。不挡游戏（叠在暂停上时由暂停挡着）。
 * 「按键」页（改键表，KeyBinds）：每个动作一行，点键位框后按下新键（Esc 取消）；「恢复默认」在本页恢复全部默认键位。
 * 网页差异：Unity 的显示模式 / 分辨率 / 垂直同步 / 手柄瞄准辅助在网页没有对应设置，不列；
 * 网页独有「阴影精度」放在画面页；改键页的手柄一列写「—」（没有手柄输入），鼠标键与暂停键写死（core/Input、Game）只显示不改。
 */
import type { GameContext, Settings } from '../../core/types';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { GAME_SETTINGS, settingDisplay } from '../../core/GameSettings';
import { sfx } from '../dom';
import { BIND_DEFS, type BindId, type KeyBinds, keyName } from '../KeyBinds';
import { el, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { type BlockState, UIScreen } from '../toolkit/UIRouter';
import { btn, card, easeOut, scroll } from './ScreenKit';

export const SETTINGS_ID = 'settings';
/** 改键页的页签名（open(SETTINGS_ID, KEYS_TAB) 直接打开它） */
export const KEYS_TAB = '按键';

type Def =
  | { key: keyof Settings; label: string; group: string; type: 'float'; min: number; max: number; step: number; display?: (v: number) => string }
  | { key: keyof Settings; label: string; group: string; type: 'bool' }
  | { key: keyof Settings; label: string; group: string; type: 'choice'; options: string[]; values: (string | number)[] };

/**
 * 设置表（登记顺序 = 页签顺序与页内顺序，同 Unity GameSettings）：数据在 core/GameSettings.ts 的 GAME_SETTINGS
 * （键 / 范围 / 步长 / 默认值照 Unity；M11d 补了帧率上限、屏幕特效，震屏上限 1.5），这里只转成控件用的形状
 */
export const SETTING_DEFS: Def[] = GAME_SETTINGS.map((d): Def => {
  const { key, label, group } = d;
  if (d.type === 'float') return { key, label, group, type: 'float', min: d.min, max: d.max, step: d.step, display: (v) => settingDisplay(d, v) };
  if (d.type === 'bool') return { key, label, group, type: 'bool' };
  const options = [...(d.options ?? [])];
  return { key, label, group, type: 'choice', options, values: d.values ? [...d.values] : options.map((_, i) => i) };
});

const NOTES: Record<string, string> = {
  画面: '画质：高 = 原生分辨率 + 全部效果；中 / 低降渲染比例、阴影和粒子。画质为「低」时不渲染阴影。帧率上限在后台标签页不生效（浏览器自己限）。',
  操作: '方向键移动焦点，左右键直接调滑条；Q / E 切换页签。',
};

export class SettingsScreen extends UIScreen {
  readonly id = SETTINGS_ID;
  override get blockState(): BlockState | null {
    return null;
  }
  override get freezeTime(): boolean {
    return false;
  }
  override get defaultFocus(): HTMLElement | null {
    return this.tabs[this.current]?.tab ?? this.backBtn;
  }

  private readonly tabs: { name: string; tab: HTMLButtonElement; page: HTMLDivElement }[] = [];
  private readonly syncs: (() => void)[] = [];
  private frame!: HTMLDivElement;
  private body!: HTMLDivElement;
  private backBtn: HTMLButtonElement | null = null;
  private current = 0;
  private openedAt = 0;
  /** 自动生成的设置控件个数（测试用：= SETTING_DEFS 的条数） */
  generated = 0;
  private readonly bindButtons: { b: HTMLButtonElement; label: HTMLDivElement; id: BindId }[] = [];
  /** 正在等按键的动作（null = 没在改键） */
  private waiting: BindId | null = null;
  private rebindEndAt = -10;

  constructor(private readonly ctx: GameContext, private readonly now: () => number, private readonly keys: KeyBinds | null = null) {
    super();
  }

  /** 正在改键（等玩家按键） */
  get rebinding(): boolean {
    return this.waiting !== null;
  }

  get CurrentTab(): string | null {
    return this.tabs[this.current]?.name ?? null;
  }

  protected build(): HTMLElement {
    const ctx = this.ctx;
    const root = el('sf-settings-screen', null, 'settings');
    el('sf-backdrop sf-settings-screen__backdrop', root);
    this.frame = el('sf-frame sf-settings', root);
    const head = el('sf-panel__head', this.frame);
    text('sf-panel__title', head, '设置', UIFontRole.Title);
    text('sf-panel__sub', head, '改动即时生效，并自动保存');

    const tabRow = el('sf-tabs', this.frame);
    this.body = scroll('sf-settings__body', this.frame);
    const groups: string[] = [];
    for (const d of SETTING_DEFS) if (!groups.includes(d.group)) groups.push(d.group);
    this.generated = 0;
    for (const g of groups) {
      const page = this.addTab(tabRow, g);
      for (const d of SETTING_DEFS) {
        if (d.group !== g) continue;
        this.buildControl(page, d);
        this.generated++;
      }
      if (NOTES[g]) text('sf-settings__note', page, NOTES[g]);
    }
    if (this.keys) this.buildKeys(this.addTab(tabRow, KEYS_TAB));

    const foot = el('sf-panel__foot', this.frame);
    btn(ctx, '恢复默认', 'sf-btn--ghost', foot, () => {
      if (this.tabs[this.current]?.name === KEYS_TAB) {
        this.cancelRebind();
        this.keys?.reset();
        this.syncAll();
      } else {
        for (const d of SETTING_DEFS) (ctx.settings as unknown as Record<string, unknown>)[d.key] = DEFAULT_SETTINGS[d.key];
        this.apply(true);
      }
      sfx(ctx, 'ui_confirm');
    });
    el('sf-grow', foot);
    text('sf-panel__hint', foot, 'Q / E 切换页签');
    this.backBtn = btn(ctx, '返回', 'sf-btn--primary', foot, () => this.close());
    this.select(0);
    return root;
  }

  private addTab(row: HTMLElement, name: string): HTMLDivElement {
    const index = this.tabs.length;
    const tab = card(this.ctx, 'sf-tab', row, () => this.select(index));
    text('sf-tab__label', tab, name, UIFontRole.Title);
    const page = el('sf-settings__page', this.body);
    this.tabs.push({ name, tab, page });
    return page;
  }

  /** 切到第 i 个页签（循环） */
  select(i: number | string): boolean {
    if (this.tabs.length === 0) return false;
    if (typeof i === 'string') {
      const k = this.tabs.findIndex((t) => t.name === i);
      if (k < 0) return false;
      i = k;
    }
    this.cancelRebind();
    this.current = ((i % this.tabs.length) + this.tabs.length) % this.tabs.length;
    this.tabs.forEach((t, k) => {
      toggle(t.tab, 'sf-tab--on', k === this.current);
      t.page.style.display = k === this.current ? '' : 'none';
    });
    this.body.scrollTop = 0;
    return true;
  }

  override onOpen(arg?: unknown): void {
    this.openedAt = this.now();
    if (typeof arg === 'string') this.select(arg);
    this.syncAll();
    this.tick();
  }

  override onClose(): void {
    this.cancelRebind();
  }

  /** 改键等按键中：Esc 交给改键操作取消；刚改完 / 刚取消的一瞬也吞掉，不连带关掉设置页 */
  override onBack(): boolean {
    if (this.waiting) {
      this.cancelRebind();
      sfx(this.ctx, 'ui_click');
      return true;
    }
    return this.now() - this.rebindEndAt <= 0.05;
  }

  /** 改键中方向键也是候选键（路由先把方向键转成导航） */
  override onNavigate(dx: number, dy: number): boolean {
    if (!this.waiting) return false;
    this.finishRebind(dx > 0 ? 'ArrowRight' : dx < 0 ? 'ArrowLeft' : dy > 0 ? 'ArrowUp' : 'ArrowDown');
    return true;
  }

  override tick(): void {
    const k = easeOut((this.now() - this.openedAt) / 0.25);
    this.frame.style.opacity = String(Math.round(k * 1000) / 1000);
    this.frame.style.translate = `0px ${(12 * (1 - k)).toFixed(2)}px`;
  }

  /** 改键中：下一个键（任何键，回车 / 空格也算）就是新键位。UI.ts 在别的处理之前先问这里 */
  captureKey(code: string): boolean {
    if (!this.waiting || code === 'Escape' || code.startsWith('Arrow')) return false;
    this.finishRebind(code);
    return true;
  }

  /** 键盘：Q / E 切页签（Unity 读 SkillQ / SkillE 的按键） */
  onKey(code: string): boolean {
    if (this.waiting) return this.captureKey(code);
    const q = this.ctx.input.bindings.skillPrimary?.[0] ?? 'KeyQ', e = this.ctx.input.bindings.skillSecondary?.[0] ?? 'KeyE';
    if (code === q) return this.select(this.current - 1);
    if (code === e) return this.select(this.current + 1);
    return false;
  }

  private syncAll(): void {
    for (const s of this.syncs) s();
    this.syncBindings();
  }

  // ───────────── 按键页 ─────────────

  private buildKeys(page: HTMLElement): void {
    const head = el('sf-keys__row sf-keys__row--head', page);
    text('sf-keys__name', head, '动作');
    text('sf-keys__col', head, '键鼠');
    text('sf-keys__col', head, '手柄');
    const fixedRow = el('sf-keys__row', page);
    text('sf-keys__name', fixedRow, '移动 / 视角');
    text('sf-keys__fixed', fixedRow, 'W A S D · 鼠标');
    text('sf-keys__fixed', fixedRow, '—');
    for (const d of BIND_DEFS) {
      const row = el('sf-keys__row', page);
      text('sf-keys__name', row, d.label);
      const b = card(this.ctx, 'sf-bind', row, () => this.rebind(d.id));
      b.dataset.name = `bind-${d.id}`;
      const label = text('sf-bind__label', b, '', UIFontRole.Number);
      b.disabled = !!d.fixed;
      this.bindButtons.push({ b, label, id: d.id });
      text('sf-keys__fixed', row, '—');
    }
    text('sf-settings__note', page, '点击按键框后按下新的键（Esc 取消）。「恢复默认」在本页恢复全部默认键位。射击 / 瞄准的鼠标键与暂停键（Esc / P）不能改；网页版没有手柄。');
  }

  private syncBindings(): void {
    const keys = this.keys;
    if (!keys) return;
    for (const { b, label, id } of this.bindButtons) {
      const d = BIND_DEFS.find((x) => x.id === id)!;
      // 写死的多键动作（暂停 Esc / P）把键都列出来；纯鼠标动作写鼠标键名
      const s = d.fixed ? (d.mouse ?? keys.codes(id).map(keyName).join(' / ')) : keys.label(id);
      label.textContent = s || '—';
      toggle(b, 'sf-bind--waiting', false);
    }
  }

  /** 点键位框：开始等按键（刚改完的那一下回车 / 点击不重新开始） */
  rebind(id: BindId): void {
    const keys = this.keys;
    if (!keys || this.waiting || this.now() - this.rebindEndAt <= 0.25) return;
    const hit = this.bindButtons.find((x) => x.id === id);
    if (!hit || hit.b.disabled) return;
    this.waiting = id;
    toggle(hit.b, 'sf-bind--waiting', true);
    hit.label.textContent = '按下新按键…';
  }

  private finishRebind(code: string): void {
    const id = this.waiting;
    if (!id) return;
    this.waiting = null;
    this.rebindEndAt = this.now();
    const ok = !!this.keys?.set(id, code);
    sfx(this.ctx, ok ? 'ui_confirm' : 'ui_click');
    this.syncBindings();
  }

  private cancelRebind(): void {
    if (!this.waiting) return;
    this.waiting = null;
    this.rebindEndAt = this.now();
    this.syncBindings();
  }

  private apply(save: boolean): void {
    try {
      this.ctx.game.applySettings();
      if (save) this.ctx.game.saveSettings();
    } catch (err) {
      console.error('[UI] 应用设置失败', err);
    }
    this.syncAll();
  }

  // ───────────── 自动生成的控件 ─────────────

  private row(page: HTMLElement, label: string): HTMLDivElement {
    const row = el('sf-setting', page);
    text('sf-setting__label', row, label);
    return el('sf-setting__ctrl', row);
  }

  private buildControl(page: HTMLElement, d: Def): void {
    const ctx = this.ctx;
    const s = ctx.settings as unknown as Record<string, unknown>;
    const ctrl = this.row(page, d.label);
    if (d.type === 'float') {
      const slider = new Slider(d.min, d.max, d.step);
      slider.el.dataset.name = 'setting-' + d.key;
      ctrl.appendChild(slider.el);
      const val = text('sf-setting__val', ctrl, '', UIFontRole.Number);
      slider.onInput = (v, done) => {
        s[d.key] = v;
        this.apply(done);
        if (done && d.group === '声音') sfx(ctx, 'ui_confirm');
      };
      slider.onHover = () => ctx.audio.uiHover?.(slider.el);
      this.syncs.push(() => {
        const v = Number(s[d.key]);
        slider.value = v;
        val.textContent = d.display ? d.display(v) : String(v);
      });
    } else if (d.type === 'bool') {
      const sw = card(ctx, 'sf-switch', ctrl, () => {
        s[d.key] = !s[d.key];
        this.apply(true);
      });
      sw.dataset.name = 'setting-' + d.key;
      el('sf-switch__knob', sw);
      const val = text('sf-setting__val', ctrl, '');
      this.syncs.push(() => {
        toggle(sw, 'sf-switch--on', !!s[d.key]);
        val.textContent = s[d.key] ? '开启' : '关闭';
      });
    } else {
      const seg = el('sf-seg', ctrl);
      const buttons = d.options.map((label, i) => {
        const b = card(ctx, 'sf-seg__opt', seg, () => {
          s[d.key] = d.values[i];
          this.apply(true);
        });
        b.dataset.name = `setting-${d.key}-${i}`;
        text('sf-seg__label', b, label);
        return b;
      });
      this.syncs.push(() => buttons.forEach((b, i) => toggle(b, 'sf-seg__opt--on', s[d.key] === d.values[i])));
    }
  }
}

/**
 * 滑条（Unity Slider 的元素结构：.unity-base-slider__drag-container > __tracker / __dragger，screens.css 的 .sf-slider 规则直接作用）。
 * 拖动 / 点击轨道调值，松手时 done = true（保存、声音页出确认音）；焦点在它上面时方向键左右调 1/20 量程（路由调 sfNudge）
 */
export class Slider {
  readonly el: HTMLDivElement;
  private readonly dragger: HTMLDivElement;
  private readonly container: HTMLDivElement;
  private v = 0;
  onInput: ((v: number, done: boolean) => void) | null = null;
  onHover: (() => void) | null = null;

  constructor(readonly min: number, readonly max: number, readonly step: number) {
    this.el = el('sf-slider unity-base-slider');
    this.el.tabIndex = 0;
    this.el.setAttribute('role', 'slider');
    this.container = el('unity-base-slider__drag-container', this.el);
    el('unity-base-slider__tracker', this.container);
    this.dragger = el('unity-base-slider__dragger', this.container);
    let dragging = false;
    const at = (e: PointerEvent) => {
      const r = this.container.getBoundingClientRect();
      const k = r.width > 0 ? (e.clientX - r.left) / r.width : 0;
      this.set(this.min + Math.min(1, Math.max(0, k)) * (this.max - this.min), false);
    };
    this.el.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.el.setPointerCapture?.(e.pointerId);
      this.el.focus({ preventScroll: true });
      at(e);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (dragging) at(e);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      this.onInput?.(this.v, true);
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('lostpointercapture', end);
    this.el.addEventListener('pointerenter', () => this.onHover?.());
    (this.el as HTMLElement & { sfNudge?: (s: number) => void }).sfNudge = (sign: number) => {
      this.set(this.v + (sign * (this.max - this.min)) / 20, true);
      this.onHover?.();
    };
  }

  get value(): number {
    return this.v;
  }

  set value(v: number) {
    this.v = Math.min(this.max, Math.max(this.min, Number.isFinite(v) ? v : this.min));
    const k = this.max > this.min ? (this.v - this.min) / (this.max - this.min) : 0;
    this.dragger.style.left = `calc(${(k * 100).toFixed(2)}% - 8px)`;
  }

  private set(v: number, done: boolean): void {
    const snapped = Math.round(v / this.step) * this.step;
    const nv = Math.min(this.max, Math.max(this.min, Math.round(snapped * 1e4) / 1e4));
    if (nv === this.v && !done) return;
    this.value = nv;
    this.onInput?.(nv, done);
  }
}
