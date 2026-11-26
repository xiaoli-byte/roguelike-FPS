/**
 * 操作说明（照译 Unity G/UI/Screens/ControlsScreen.cs，样式 css/screens/menu.css 的 .sf-controls）：每个动作一行，键鼠一列、手柄一列——
 * 键位从改键表（KeyBinds）现取（改过键就显示改后的）。底下两条要诀。「改键」直接打开设置的「按键」页，回来按新键位重建。
 * 主菜单里打开，不挡游戏；0.28 s 淡入上移。
 * 网页差异：没有手柄输入，手柄一列写「—」。
 */
import type { GameContext } from '../../core/types';
import { CONTROL_ROWS, type KeyBinds } from '../KeyBinds';
import { el, text } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { type BlockState, type IScreen, UIScreen } from '../toolkit/UIRouter';
import { btn, easeOut, scroll } from './ScreenKit';
import { KEYS_TAB, SETTINGS_ID } from './SettingsScreen';

export const CONTROLS_ID = 'controls';

export class ControlsScreen extends UIScreen {
  readonly id = CONTROLS_ID;
  override get blockState(): BlockState | null {
    return null;
  }
  override get freezeTime(): boolean {
    return false;
  }
  override get defaultFocus(): HTMLElement | null {
    return this.backBtn;
  }

  private frame!: HTMLDivElement;
  private list!: HTMLDivElement;
  private backBtn: HTMLButtonElement | null = null;
  private openedAt = 0;
  private off: (() => void) | null = null;

  constructor(private readonly ctx: GameContext, private readonly keys: KeyBinds, private readonly now: () => number) {
    super();
  }

  /** 表里的行数（测试用） */
  get rowCount(): number {
    return this.list?.children.length ?? 0;
  }

  protected build(): HTMLElement {
    const ctx = this.ctx;
    const root = el('sf-controls-screen', null, 'controls');
    el('sf-backdrop sf-menu-sub__backdrop', root);
    this.frame = el('sf-frame sf-controls', root);
    const head = el('sf-panel__head', this.frame);
    text('sf-panel__title', head, '操作说明', UIFontRole.Title);
    text('sf-panel__sub', head, '键位随设置里的改键实时变化；Esc 暂停并放开鼠标。');
    const cols = el('sf-controls__row sf-controls__row--head', this.frame);
    text('sf-controls__action', cols, '动作');
    text('sf-controls__keys', cols, '键鼠');
    text('sf-controls__keys', cols, '手柄');
    this.list = el('sf-controls__list', scroll('sf-controls__scroll', this.frame));
    const tips = el('sf-controls__tips', this.frame);
    text('sf-controls__tip', tips, '爆头即暴击。敌人的强力攻击都有前摇与地面预警，留意并闪避。');
    text('sf-controls__tip', tips, '肃清据点后开启出口；途中留意宝箱、灵兽封印与补给营，地图是开放的，据点顺序随你。');
    const foot = el('sf-panel__foot', this.frame);
    btn(ctx, '改键', 'sf-btn--ghost', foot, () => this.router?.open(SETTINGS_ID, KEYS_TAB));
    el('sf-grow', foot);
    this.backBtn = btn(ctx, '返回', 'sf-btn--primary', foot, () => this.close());
    return root;
  }

  override onOpen(): void {
    this.openedAt = this.now();
    this.rebuild();
    this.off?.();
    // 从「改键」回来：按新键位重建
    this.off = this.router?.onClosed((s: IScreen) => {
      if (s.id === SETTINGS_ID) this.rebuild();
    }) ?? null;
    this.tick();
  }

  override onClose(): void {
    this.off?.();
    this.off = null;
  }

  private rebuild(): void {
    this.list.replaceChildren();
    for (const r of CONTROL_ROWS) {
      const row = el('sf-controls__row', this.list);
      text('sf-controls__action', row, r.label);
      // 组合绑定（移动 / 视角）按空格拆成几个键帽；其余是一个绑定一个键帽
      keyCaps(row, r.id ? [this.keys.label(r.id)] : (r.fixedKb ?? '').split(' '));
      keyCaps(row, ['—']);
    }
  }

  override tick(): void {
    const k = easeOut((this.now() - this.openedAt) / 0.28);
    this.frame.style.opacity = String(Math.round(k * 1000) / 1000);
    this.frame.style.translate = `0px ${(14 * (1 - k)).toFixed(2)}px`;
  }
}

function keyCaps(row: HTMLElement, keys: string[]): void {
  const cell = el('sf-controls__keys', row);
  for (const k of keys) if (k) text('sf-key sf-controls__key', cell, k, UIFontRole.Number);
}
