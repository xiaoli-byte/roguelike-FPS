/**
 * 通用确认框（照译 Unity G/UI/Screens/ConfirmScreen.cs，样式 css/unity/dialog.css）：标题、正文、补充说明、确认 / 取消两个按钮。
 *   返回键 = 取消；危险操作（danger，缺省）确认按钮朱砂色、默认聚焦在「取消」上，连按确认键不会误点。
 *   不挡游戏、不停时间（主菜单场景要动），叠在当前界面上。0.22 s 淡入 + 0.96 → 1 放大。
 *   按钮和测试都走 confirm() / cancel()：先关自己再回调（回调里可以再开别的界面）。
 * 用法：ConfirmScreen.ask(router, { message, onConfirm })——界面没登记时直接当作确认（不会卡死），返回 false。
 */
import type { GameContext } from '../../core/types';
import { el, show, text, toggle } from '../toolkit/el';
import { UIFontRole, warmup } from '../toolkit/UIFonts';
import { type BlockState, type ScreenRouter, UIScreen } from '../toolkit/UIRouter';
import { btn, easeOut } from './ScreenKit';

export const CONFIRM_ID = 'confirm';

/** 确认框的内容 */
export interface ConfirmRequest {
  title?: string;
  message?: string;
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  /** 确认是不可撤销的操作（确认按钮朱砂色、默认聚焦在「取消」上）；缺省 true */
  danger?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export class ConfirmScreen extends UIScreen {
  readonly id = CONFIRM_ID;
  override get blockState(): BlockState | null {
    return null;
  }
  override get freezeTime(): boolean {
    return false;
  }
  override get defaultFocus(): HTMLElement | null {
    return this.req && this.req.danger !== false ? this.cancelBtn : this.okBtn;
  }

  private req: ConfirmRequest | null = null;
  private frame!: HTMLDivElement;
  private titleEl!: HTMLDivElement;
  private messageEl!: HTMLDivElement;
  private detailEl!: HTMLDivElement;
  private okBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private openedAt = 0;

  constructor(private readonly ctx: GameContext, private readonly now: () => number) {
    super();
  }

  /** 当前的请求（测试用） */
  get request(): ConfirmRequest | null {
    return this.req;
  }

  /** 弹一个确认框（已经开着就换内容）；界面没登记时直接当作确认，返回 false */
  static ask(router: ScreenRouter, request: ConfirmRequest | null): boolean {
    if (!request) return false;
    if (!router.get(CONFIRM_ID)) {
      console.warn(`[UI] 没有确认框界面，直接确认：${request.message ?? ''}`);
      request.onConfirm?.();
      return false;
    }
    if (router.isOpen(CONFIRM_ID)) router.close(CONFIRM_ID);
    return router.open(CONFIRM_ID, request);
  }

  protected build(): HTMLElement {
    const root = el('sf-dialog-screen', null, 'confirm');
    el('sf-backdrop sf-dialog__backdrop', root);
    this.frame = el('sf-frame sf-dialog', root);
    this.titleEl = text('sf-dialog__title', this.frame, '', UIFontRole.Title);
    this.messageEl = text('sf-dialog__message', this.frame, '');
    this.detailEl = text('sf-dialog__detail', this.frame, '');
    const foot = el('sf-dialog__foot', this.frame);
    this.cancelBtn = btn(this.ctx, '取消', 'sf-btn--ghost sf-btn--wide', foot, () => this.cancel());
    this.cancelBtn.dataset.name = 'confirm-cancel';
    this.okBtn = btn(this.ctx, '确定', 'sf-btn--primary sf-btn--wide sf-sound-confirm', foot, () => this.confirm());
    this.okBtn.dataset.name = 'confirm-ok';
    return root;
  }

  override onOpen(arg?: unknown): void {
    const r = (arg && typeof arg === 'object' ? arg : { message: '确定吗？' }) as ConfirmRequest;
    this.req = r;
    this.openedAt = this.now();
    this.titleEl.textContent = r.title ?? '确认';
    this.messageEl.textContent = r.message ?? '';
    this.detailEl.textContent = r.detail ?? '';
    show(this.detailEl, !!r.detail);
    this.okBtn!.textContent = r.confirmText ?? '确定';
    this.cancelBtn!.textContent = r.cancelText ?? '取消';
    toggle(this.okBtn!, 'sf-btn--danger-solid', r.danger !== false);
    void warmup((r.title ?? '') + (r.confirmText ?? '') + (r.cancelText ?? ''), UIFontRole.Title);
    this.tick();
  }

  /** 返回键 = 取消 */
  override onBack(): boolean {
    this.cancel();
    return true;
  }

  /** 确认：关掉自己，再回调 onConfirm */
  confirm(): void {
    this.finish(true);
  }

  /** 取消：关掉自己，再回调 onCancel */
  cancel(): void {
    this.finish(false);
  }

  private finish(ok: boolean): void {
    const r = this.req;
    this.req = null;
    if (this.isOpen) this.close();
    if (!r) return;
    try {
      if (ok) r.onConfirm?.();
      else r.onCancel?.();
    } catch (err) {
      console.error('[UI] 确认框回调失败', err);
    }
  }

  override tick(): void {
    const k = easeOut((this.now() - this.openedAt) / 0.22);
    this.frame.style.opacity = String(Math.round(k * 1000) / 1000);
    const s = 0.96 + 0.04 * k;
    this.frame.style.scale = `${s.toFixed(4)} ${s.toFixed(4)}`;
  }
}
