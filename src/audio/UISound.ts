/**
 * 按钮音（Unity UISound.cs）：ui_click / ui_hover / ui_confirm / ui_deny，界面音走混音台的 UI 总线（不被暂停压低）。
 *   点击 → 按按钮的类挑音：sf-silent 不出声；禁用的（disabled / is-disabled）出 ui_deny；sf-sound-confirm / sf-sound-deny 换音；其余 ui_click
 *   悬停 / 焦点移到按钮上 → ui_hover（不缩放时间节流 40 ms，扫过一排按钮时不连响）
 * 「按钮」= <button>、带 sf-btn 类的元素。音量 = UISound.volume（Unity 的 UISound.Volume，缺省 1；玩家的界面音量在 UI 推子上）。
 * 网页的按钮由 ui/dom.ts 的 bindButton 逐个绑（Unity 是在每层根元素上挂一次 Attach），经 IAudio.uiClick / uiHover 到这里
 * （dom.ts 不直接 import 本模块：界面测试按模块名打桩加载 dom.ts）；attach() 留给整层委托的界面用。
 */
import type { GameContext, SfxId } from '../core/types';
import { UI_CLASS, UI_HOVER, UI_HOVER_GAP, uiClickSound } from './AudioRules';

let lastHover = -1;

export const UISound = {
  volume: 1,

  play(ctx: GameContext, id: string): void {
    if (!(UISound.volume > 0)) return;
    try {
      ctx.audio.play(id as SfxId, { volume: UISound.volume });
    } catch (err) {
      console.warn('[UI] audio.play failed', err);
    }
  },

  /** 按钮被激活：按它的类挑音（确认 / 拒绝 / 点击 / 静音） */
  click(ctx: GameContext, button: Element | null): void {
    const id = uiClickSound(button ? {
      silent: button.classList.contains(UI_CLASS.silent),
      disabled: isDisabled(button),
      confirm: button.classList.contains(UI_CLASS.confirm),
      deny: button.classList.contains(UI_CLASS.deny),
    } : null);
    if (id) UISound.play(ctx, id);
  },

  /** 悬停 / 焦点移到按钮上（节流） */
  hover(ctx: GameContext, button: Element | null): void {
    if (!button || button.classList.contains(UI_CLASS.silent)) return;
    const now = performance.now() / 1000;
    if (now - lastHover < UI_HOVER_GAP) return;
    lastHover = now;
    UISound.play(ctx, UI_HOVER);
  },

  isButton(e: Element | null): boolean {
    return !!e && (e.tagName === 'BUTTON' || e.classList.contains(UI_CLASS.button));
  },

  /** 往上找最近的按钮（点在按钮里的文字 / 图标上也算点按钮） */
  buttonOf(e: Element | null): Element | null {
    for (let p = e; p; p = p.parentElement) if (UISound.isButton(p)) return p;
    return null;
  },

  /** 整层委托：点击冒泡、指针进入只认「进入的就是按钮本身」 */
  attach(ctx: GameContext, root: HTMLElement): void {
    root.addEventListener('click', e => UISound.click(ctx, UISound.buttonOf(e.target as Element | null)));
    root.addEventListener('pointerenter', e => {
      const t = e.target as Element | null;
      if (UISound.isButton(t) && !isDisabled(t!)) UISound.hover(ctx, t);
    }, true);
  },
};

function isDisabled(e: Element): boolean {
  return e.classList.contains('is-disabled') || (e as HTMLButtonElement).disabled === true || e.getAttribute('aria-disabled') === 'true';
}
