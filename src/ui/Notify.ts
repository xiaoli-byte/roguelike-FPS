/**
 * 提示类界面：toast 队列、大标题横幅、交互提示卡片。
 * 计时一律使用真实时间，暂停 / 慢动作时也能正常消失。
 */
import type { InteractPrompt } from '../core/types';
import { h, icon, clearChildren, formatNum } from './dom';
import { ICON_CLOUD, ICON_COIN } from './icons';

// ───────────────────────────── Toast ─────────────────────────────

interface ToastItem {
  el: HTMLDivElement;
  countEl: HTMLSpanElement;
  text: string;
  count: number;
  timer: number;
  leaving: boolean;
  /** 显示时长（毫秒） */
  ms: number;
}

const TOAST_MAX = 4;
const TOAST_MS = 2800;

export class Toasts {
  readonly root: HTMLDivElement;
  private items: ToastItem[] = [];

  constructor(parent: HTMLElement) {
    this.root = h('div', 'gf-toasts', parent);
    this.root.setAttribute('aria-live', 'polite');
  }

  /** ms：显示时长，缺省 2.8 秒（教学类长文案可以更长） */
  push(text: string, color?: string, ms = TOAST_MS): void {
    if (!text) return;
    // 与最新一条相同：合并计数并刷新计时
    const last = this.items[this.items.length - 1];
    if (last && !last.leaving && last.text === text) {
      last.count++;
      last.countEl.textContent = `×${last.count}`;
      last.el.animate([{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' });
      last.ms = Math.max(last.ms, ms);
      this.schedule(last);
      return;
    }
    while (this.items.length >= TOAST_MAX) this.dismiss(this.items[0], true);

    const el = h('div', 'gf-toast', this.root);
    if (color) el.style.setProperty('--toast-color', color);
    h('span', 'gf-toast__mark', el);
    h('span', 'gf-toast__text', el, text);
    const countEl = h('span', 'gf-toast__count', el);
    const item: ToastItem = { el, countEl, text, count: 1, timer: 0, leaving: false, ms };
    this.items.push(item);
    this.schedule(item);
  }

  clear(): void {
    for (const it of this.items.slice()) this.dismiss(it, true);
  }

  private schedule(item: ToastItem): void {
    window.clearTimeout(item.timer);
    item.timer = window.setTimeout(() => this.dismiss(item, false), item.ms);
  }

  private dismiss(item: ToastItem, fast: boolean): void {
    if (item.leaving) return;
    item.leaving = true;
    window.clearTimeout(item.timer);
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    item.el.classList.add(fast ? 'is-leaving-fast' : 'is-leaving');
    window.setTimeout(() => item.el.remove(), fast ? 160 : 360);
  }
}

// ───────────────────────────── Banner ─────────────────────────────

export class Banner {
  readonly root: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private timer = 0;
  private hideTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = h('div', 'gf-banner', parent);
    this.root.hidden = true;
    const row = h('div', 'gf-banner__row', this.root);
    icon(ICON_CLOUD, 'gf-banner__cloud gf-banner__cloud--l', row);
    this.titleEl = h('div', 'gf-banner__title', row);
    icon(ICON_CLOUD, 'gf-banner__cloud gf-banner__cloud--r', row);
    h('div', 'gf-banner__rule', this.root);
    this.subEl = h('div', 'gf-banner__sub', this.root);
  }

  show(title: string, subtitle?: string, duration = 2.4): void {
    if (!title && !subtitle) return;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.hideTimer);
    this.titleEl.textContent = title;
    this.subEl.textContent = subtitle ?? '';
    this.subEl.hidden = !subtitle;
    this.root.hidden = false;
    this.root.classList.remove('is-out');
    // 每次出现都重播笔刷展开动画
    this.root.classList.remove('is-in');
    void this.root.offsetWidth;
    this.root.classList.add('is-in');
    const ms = Math.max(0.6, Number.isFinite(duration) ? duration : 2.4) * 1000;
    this.timer = window.setTimeout(() => this.hide(), ms);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    if (this.root.hidden) return;
    this.root.classList.remove('is-in');
    this.root.classList.add('is-out');
    this.hideTimer = window.setTimeout(() => {
      this.root.hidden = true;
      this.root.classList.remove('is-out');
    }, 520);
  }
}

// ───────────────────────────── 交互提示 ─────────────────────────────

/**
 * 交互提示卡片。setInteractPrompt 可能每帧被调用（prompt() 每帧拉取），
 * 这里逐字段比较，只有内容变化时才重建 DOM。
 */
export class PromptCard {
  readonly root: HTMLDivElement;
  private keyEl: HTMLSpanElement;
  private titleEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private linesEl: HTMLDivElement;
  private costEl: HTMLDivElement;
  private costNum: HTMLSpanElement;

  private visible = false;
  private hideTimer = 0;
  private lastTitle = '';
  private lastSub = '';
  private lastColor = '';
  private lastKey = '';
  private lastCost = NaN;
  private lastLines: string[] = [];
  private short = false;

  constructor(parent: HTMLElement) {
    this.root = h('div', 'gf-prompt', parent);
    this.root.hidden = true;
    this.keyEl = h('span', 'gf-prompt__key', this.root, 'F');
    const body = h('div', 'gf-prompt__body', this.root);
    this.titleEl = h('div', 'gf-prompt__title', body);
    this.subEl = h('div', 'gf-prompt__sub', body);
    this.linesEl = h('div', 'gf-prompt__lines', body);
    this.costEl = h('div', 'gf-prompt__cost', body);
    icon(ICON_COIN, 'gf-icon gf-icon--coin', this.costEl);
    this.costNum = h('span', 'gf-prompt__costnum', this.costEl);
    this.subEl.hidden = true;
    this.linesEl.hidden = true;
    this.costEl.hidden = true;
  }

  set(p: InteractPrompt | null): void {
    if (!p) {
      if (!this.visible) return;
      this.visible = false;
      this.root.classList.remove('is-open');
      window.clearTimeout(this.hideTimer);
      this.hideTimer = window.setTimeout(() => {
        if (!this.visible) this.root.hidden = true;
      }, 200);
      return;
    }
    this.sync(p);
    if (!this.visible) {
      this.visible = true;
      window.clearTimeout(this.hideTimer);
      this.root.hidden = false;
      void this.root.offsetWidth;
      this.root.classList.add('is-open');
    }
  }

  /** 每帧：金币变化时更新「不足」标红 */
  update(coins: number): void {
    if (!this.visible || Number.isNaN(this.lastCost)) return;
    const short = coins < this.lastCost;
    if (short !== this.short) {
      this.short = short;
      this.costEl.classList.toggle('is-short', short);
    }
  }

  private sync(p: InteractPrompt): void {
    const title = p.title ?? '';
    if (title !== this.lastTitle) {
      this.lastTitle = title;
      this.titleEl.textContent = title;
    }
    const sub = p.subtitle ?? '';
    if (sub !== this.lastSub) {
      this.lastSub = sub;
      this.subEl.textContent = sub;
      this.subEl.hidden = !sub;
    }
    const color = p.color ?? '';
    if (color !== this.lastColor) {
      this.lastColor = color;
      this.root.style.setProperty('--prompt-color', color || 'var(--gold-hi)');
    }
    const key = p.key ?? 'F';
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.keyEl.textContent = key;
    }
    const cost = p.cost ?? NaN;
    if (!(cost === this.lastCost || (Number.isNaN(cost) && Number.isNaN(this.lastCost)))) {
      this.lastCost = cost;
      this.costEl.hidden = Number.isNaN(cost);
      this.costNum.textContent = Number.isNaN(cost) ? '' : formatNum(cost);
      this.short = false;
      this.costEl.classList.remove('is-short');
    }
    const lines = p.lines;
    if (!sameLines(lines, this.lastLines)) {
      this.lastLines = lines ? lines.slice() : [];
      clearChildren(this.linesEl);
      for (const line of this.lastLines) {
        const row = h('div', 'gf-prompt__line', this.linesEl, line);
        if (/[↑▲]/.test(line)) row.classList.add('is-up');
        else if (/[↓▼]/.test(line)) row.classList.add('is-down');
      }
      this.linesEl.hidden = this.lastLines.length === 0;
    }
  }
}

function sameLines(a: string[] | undefined, b: string[]): boolean {
  const n = a ? a.length : 0;
  if (n !== b.length) return false;
  for (let i = 0; i < n; i++) if (a![i] !== b[i]) return false;
  return true;
}
