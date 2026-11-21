/**
 * UI 通用 DOM 工具：元素创建、内联 SVG、按钮音效绑定、秘卷层数占位。
 * 只依赖 core/types 的接口。旧 gf-* 界面用的显隐过渡（Presence）、自适应缩放（uiScale / fitPanel）、数字滚动等随 M11c 第二期删掉了
 * （新界面的缩放在 toolkit/UIRoot，数字格式在 toolkit/el）。
 */
import type { GameContext, SfxId } from '../core/types';

/** 创建元素并可选挂到父节点 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string | null,
  parent?: HTMLElement | null,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

/** 把静态内联 SVG（本模块自带的可信字符串）包进 span */
export function icon(markup: string, cls: string, parent?: HTMLElement | null): HTMLSpanElement {
  const el = h('span', cls, parent);
  el.innerHTML = markup;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** 0xRRGGBB → '#rrggbb' */
export function cssHex(n: number): string {
  return '#' + (n >>> 0 & 0xffffff).toString(16).padStart(6, '0');
}

/** 安全播放音效：音频系统出错不应影响按钮逻辑 */
export function sfx(ctx: GameContext, id: SfxId, volume?: number): void {
  try {
    ctx.audio.play(id, volume !== undefined ? { volume } : undefined);
  } catch (err) {
    console.warn('[UI] audio.play failed', err);
  }
}

export function unlockAudio(ctx: GameContext): void {
  try {
    ctx.audio.unlock();
  } catch (err) {
    console.warn('[UI] audio.unlock failed', err);
  }
}

/**
 * 绑定按钮：悬停播放 ui_hover，点击先解锁音频再出按钮音，再执行回调。按钮音的规则（节流 40 ms、禁用出 ui_deny、
 * sf-sound-confirm / sf-sound-deny / sf-silent 换音）照 Unity UISound，由音频系统实现（audio/UISound.ts）。
 * 回调在 click 处理函数内同步执行（便于重新锁定鼠标等需要用户手势的操作）。
 */
export function bindButton(ctx: GameContext, el: HTMLElement, onClick: (e: MouseEvent) => void): void {
  el.addEventListener('pointerenter', () => {
    if (el.classList.contains('is-disabled') || (el as HTMLButtonElement).disabled) return;
    buttonSound(ctx, el, false);
  });
  el.addEventListener('click', (e) => {
    unlockAudio(ctx);
    buttonSound(ctx, el, true);
    onClick(e);
  });
}

/** 按钮音交给音频系统（IAudio.uiClick / uiHover，可选）：音频系统出错不应影响按钮逻辑 */
function buttonSound(ctx: GameContext, el: HTMLElement, click: boolean): void {
  try {
    if (click) ctx.audio.uiClick?.(el);
    else ctx.audio.uiHover?.(el);
  } catch (err) {
    console.warn('[UI] button sound failed', err);
  }
}

/** 把 {n} 占位替换为层数 */
export function fillStacks(text: string, n: number): string {
  return text.replace(/\{n\}/g, String(n));
}
