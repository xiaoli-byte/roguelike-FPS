/**
 * UI 通用 DOM 工具：元素创建、按钮音效绑定、显隐过渡、数字格式化。
 * 只依赖 core/types 的接口。
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
export function icon(markup: string, cls = 'gf-icon', parent?: HTMLElement | null): HTMLSpanElement {
  const el = h('span', cls, parent);
  el.innerHTML = markup;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

export function clearChildren(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
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

let lastHoverAt = 0;

/**
 * 绑定按钮：悬停播放 ui_hover（节流），点击先解锁音频并播放 ui_click，再执行回调。
 * 回调在 click 处理函数内同步执行（便于重新锁定鼠标等需要用户手势的操作）。
 */
export function bindButton(ctx: GameContext, el: HTMLElement, onClick: (e: MouseEvent) => void): void {
  el.addEventListener('pointerenter', () => {
    if (el.classList.contains('is-disabled') || (el as HTMLButtonElement).disabled) return;
    const now = performance.now();
    if (now - lastHoverAt < 70) return;
    lastHoverAt = now;
    sfx(ctx, 'ui_hover', 0.6);
  });
  el.addEventListener('click', (e) => {
    unlockAudio(ctx);
    sfx(ctx, 'ui_click');
    onClick(e);
  });
}

/** 创建一个按钮并绑定音效与回调 */
export function button(
  ctx: GameContext,
  cls: string,
  parent: HTMLElement | null,
  label: string,
  onClick: (e: MouseEvent) => void,
): HTMLButtonElement {
  const b = h('button', cls, parent, label);
  b.type = 'button';
  bindButton(ctx, b, onClick);
  return b;
}

/**
 * 进入 / 退出过渡：显示时去掉 hidden 并在下一帧加 is-open；
 * 隐藏时去掉 is-open，过渡结束后再设 hidden。重复调用安全。
 */
export class Presence {
  private timer = 0;
  private open = false;

  constructor(readonly el: HTMLElement, private readonly leaveMs = 280) {
    el.hidden = true;
  }

  get visible(): boolean {
    return this.open;
  }

  show(): void {
    window.clearTimeout(this.timer);
    if (this.open && !this.el.hidden) return;
    this.open = true;
    this.el.hidden = false;
    this.el.classList.remove('is-leaving');
    // 强制一次样式计算，保证过渡从初始状态开始（仅在显示时执行一次）
    void this.el.offsetWidth;
    this.el.classList.add('is-open');
  }

  hide(immediate = false): void {
    window.clearTimeout(this.timer);
    if (!this.open && this.el.hidden) return;
    this.open = false;
    this.el.classList.remove('is-open');
    if (immediate) {
      this.el.classList.remove('is-leaving');
      this.el.hidden = true;
      return;
    }
    this.el.classList.add('is-leaving');
    this.timer = window.setTimeout(() => {
      if (this.open) return;
      this.el.classList.remove('is-leaving');
      this.el.hidden = true;
    }, this.leaveMs);
  }
}

/** 整数千分位；超过十万用「万」 */
export function formatNum(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 100000) return `${(v / 10000).toFixed(1)}万`;
  return v.toLocaleString('zh-CN');
}

/** 把 {n} 占位替换为层数 */
export function fillStacks(text: string, n: number): string {
  return text.replace(/\{n\}/g, String(n));
}

/** 数字滚动动画（结算界面用），基于真实时间 */
export function countUp(el: HTMLElement, to: number, ms: number, format: (v: number) => string, delay = 0): void {
  const start = performance.now() + delay;
  el.textContent = format(0);
  const step = (t: number) => {
    const k = Math.min(1, Math.max(0, (t - start) / ms));
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = format(to * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // 后台标签页 rAF 暂停时也保证最终值正确
  window.setTimeout(() => {
    el.textContent = format(to);
  }, delay + ms + 400);
}
