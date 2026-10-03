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

// ───────────────────────────── 自适应缩放 ─────────────────────────────

/**
 * 当前界面缩放（UIManager 在构造与 resize 时更新）。
 *  - s：居中面板 / 横幅 / toast 的基准缩放（1920×1080 = 1）
 *  - hud：HUD 四角、Boss 条、交互提示、Tab 面板的缩放
 * 注意：敌人头顶血条与伤害数字依赖屏幕坐标，绝不能对 #ui-root 整体缩放。
 */
export const uiScale = { s: 1, hud: 1 };

/** 由视口尺寸计算缩放：大屏按比例放大，小屏只做温和压缩（避免文字过小） */
export function computeUiScale(w: number, h: number): { s: number; hud: number } {
  const raw = Math.min(w / 1920, h / 1080);
  let s = raw >= 1 ? raw : 1 - (1 - raw) * 0.45;
  if (!Number.isFinite(s)) s = 1;
  s = Math.min(1.75, Math.max(0.7, s));
  const hud = Math.min(1.75, Math.max(0.78, s));
  return { s, hud };
}

/**
 * 把居中面板等比缩放到父容器可用区域内：先用 uiScale.s，若内容仍放不下则继续缩小（不低于 min）。
 * 要求：el 是父容器（自身不缩放、可带 padding）的直接子元素；el 的 CSS 用 max-height: 100% + overflow: auto 兜底。
 * offset/scroll 尺寸是元素自身（未缩放）的设计像素，与当前 zoom 无关，所以可以直接比较。
 * measureCls：测量期间临时加到 el 上的类（例如让展开动画立即到终态）。
 */
export function fitPanel(el: HTMLElement, min = 0.6, measureCls?: string): void {
  const parent = el.parentElement;
  if (!parent || el.hidden || !el.isConnected) return;
  const base = uiScale.s;
  const ps = getComputedStyle(parent);
  const availW = parent.clientWidth - (parseFloat(ps.paddingLeft) || 0) - (parseFloat(ps.paddingRight) || 0);
  const availH = parent.clientHeight - (parseFloat(ps.paddingTop) || 0) - (parseFloat(ps.paddingBottom) || 0);
  if (!(availW > 0 && availH > 0)) return;
  if (measureCls) el.classList.add(measureCls);
  let z = base;
  el.style.zoom = z.toFixed(4);
  // 宽度受 100% 限制时，zoom 变小会让设计宽度变大、内容变矮，所以迭代几次收敛
  for (let i = 0; i < 5; i++) {
    const needH = el.scrollHeight;
    const needW = el.scrollWidth;
    if (!(needH > 0 && needW > 0)) break;
    // 向下取整，避免舍入误差导致出现 1px 滚动条
    let next = Math.floor(Math.min(base, availH / needH, availW / needW) * 1000) / 1000;
    // 只允许单调变小，避免在两个值之间来回跳
    if (i > 0) next = Math.min(next, z);
    next = Math.max(min, next);
    if (Math.abs(next - z) < 0.002) break;
    z = next;
    el.style.zoom = z.toFixed(4);
  }
  if (measureCls) el.classList.remove(measureCls);
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
