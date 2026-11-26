/**
 * 秘卷触发弹字（照译 Unity G/UI/Widgets/ScrollProcPop.cs，样式 css/screens/scrolls.css 的 .sf-procs）：秘卷效果触发一次，
 * 就在准星右上方弹一行「◆ 卷名」，菱形和字按稀有度上色。
 *   · 同一卷 0.6 s 内再触发：合并成 ×N 并重新弹一下；最多 4 行，满了先收走最老的；
 *   · 每行 0.12 s 弹出（1.3 → 1 倍）→ 停 0.7 s → 0.35 s 上飘淡出；用不缩放时间。不认识的 id 不弹。
 * 网页差异：秘卷系统还没有「触发」事件（Unity GameEvents.ScrollProc 由 ScrollScope.Proc 发）——入口是 push(id)（UIManager.scrollProc 转发），
 * 秘卷的触发点接上之前不会自己弹。行的合并 / 淘汰规则在 ProcRows（不碰 DOM，测试直接用）。
 */
import { el, setOpacity, setScale, setTranslate, show, text } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { css, fadeRight, lerpColor, paint, rarityColor } from '../toolkit/UITheme';
import { type HudFrame, HudWidget } from './HudWidget';

export const PROC_MAX_ROWS = 4;
export const PROC_MERGE_WINDOW = 0.6, PROC_POP = 0.12, PROC_HOLD = 0.7, PROC_FADE = 0.35;
const RowHeight = 26;

export interface ProcRow<T = unknown> {
  id: string;
  n: number;
  born: number;
  last: number;
  view: T | null;
}

/** 行表：合并、淘汰、到期（纯数据） */
export class ProcRows<T = unknown> {
  readonly rows: ProcRow<T>[] = [];

  /** 触发一次：返回这一行与发生了什么（merged = 并进已有行，dropped = 被挤掉的最老的行） */
  push(id: string, now: number): { row: ProcRow<T>; merged: boolean; dropped: ProcRow<T>[] } {
    const i = this.rows.findIndex((r) => r.id === id && now - r.last <= PROC_MERGE_WINDOW);
    if (i >= 0) {
      const r = this.rows[i];
      r.n++;
      r.last = r.born = now;
      // 合并的那行挪到最新
      this.rows.splice(i, 1);
      this.rows.push(r);
      return { row: r, merged: true, dropped: [] };
    }
    const dropped: ProcRow<T>[] = [];
    while (this.rows.length >= PROC_MAX_ROWS) dropped.push(this.rows.shift()!);
    const row: ProcRow<T> = { id, n: 1, born: now, last: now, view: null };
    this.rows.push(row);
    return { row, merged: false, dropped };
  }

  /** 收走到期的行（返回它们） */
  expire(now: number): ProcRow<T>[] {
    const out: ProcRow<T>[] = [];
    for (let i = this.rows.length - 1; i >= 0; i--)
      if (now - this.rows[i].born >= PROC_POP + PROC_HOLD + PROC_FADE) out.push(...this.rows.splice(i, 1));
    return out;
  }

  clear(): ProcRow<T>[] {
    return this.rows.splice(0);
  }
}

/** 一行在出生后 t 秒的样子：缩放、不透明度、上飘（设计像素） */
export function procPose(t: number): { scale: number; opacity: number; y: number } {
  const pop = Math.min(1, Math.max(0, t / PROC_POP));
  const u = 1 - pop;
  const fade = Math.min(1, Math.max(0, (t - PROC_POP - PROC_HOLD) / PROC_FADE));
  return { scale: 1.3 + (1 - 1.3) * (1 - u * u * u), opacity: (1 - fade) * Math.min(1, pop * 2.5), y: -RowHeight * 0.6 * fade };
}

interface View {
  el: HTMLDivElement;
  mark: HTMLDivElement;
  name: HTMLDivElement;
  count: HTMLDivElement;
}

export class ScrollProcPop extends HudWidget {
  readonly id = 'scroll-proc';
  override readonly order = 45;

  private readonly model = new ProcRows<View>();
  private readonly pool: View[] = [];
  private list!: HTMLDivElement;
  private nowV = 0;

  /** 显示中的行数 / 卷 id（测试用） */
  get count(): number {
    return this.model.rows.length;
  }

  get ids(): string[] {
    return this.model.rows.map((r) => r.id);
  }

  protected build(): HTMLElement {
    const root = el('sf-procs');
    this.list = el('sf-procs__list', root);
    return root;
  }

  override resetState(): void {
    for (const r of this.model.clear()) this.recycle(r.view);
  }

  /** 弹一行 */
  push(id: string, now = this.nowV || performance.now() / 1000): void {
    const def = this.game.scrolls?.get(id);
    if (!def || !this.list) return;
    const { row, merged, dropped } = this.model.push(id, now);
    for (const d of dropped) this.recycle(d.view);
    if (merged && row.view) {
      row.view.count.textContent = '×' + row.n;
      show(row.view.count, true);
      this.list.appendChild(row.view.el);
      return;
    }
    const v = this.pool.pop() ?? this.make();
    const color = rarityColor(def.rarity);
    v.mark.style.backgroundColor = css(color);
    v.name.textContent = def.name;
    v.name.style.color = css(lerpColor(color, [1, 1, 1, 1], 0.35));
    show(v.count, false);
    v.count.style.color = css(color);
    v.el.style.display = '';
    this.list.appendChild(v.el);
    row.view = v;
  }

  private make(): View {
    const e = el('sf-proc');
    paint(e, fadeRight([0.02, 0.016, 0.02, 0.55]));
    const mark = el('sf-proc__mark', e, 'mark');
    const name = text('sf-proc__name', e, '', UIFontRole.Title);
    const count = text('sf-proc__count', e, '', UIFontRole.Number);
    return { el: e, mark, name, count };
  }

  private recycle(v: View | null): void {
    if (!v) return;
    v.el.remove();
    this.pool.push(v);
  }

  override tick(f: HudFrame): void {
    const now = (this.nowV = f.unscaledTime);
    if (this.model.rows.length === 0) return;
    for (const r of this.model.expire(now)) this.recycle(r.view);
    for (const r of this.model.rows) {
      if (!r.view) continue;
      const p = procPose(now - r.born);
      setScale(r.view.el, p.scale);
      setOpacity(r.view.el, p.opacity);
      setTranslate(r.view.el, 0, p.y);
    }
  }
}
