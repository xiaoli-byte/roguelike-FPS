/**
 * 界面共用的小工具（照译 Unity G/UI/Screens/ScreenKit.cs + StatGrid.cs + ScrollList.cs，路由界面用）：
 *   按钮 = <button>（鼠标点击、回车都走 onClick；悬停 / 点击音走 dom.ts 的 bindButton → ctx.audio.uiHover / uiClick，按 sf-sound-* 类换音）；
 *   卡片按钮（页签、分段、开关）去掉 sf-btn 的样式，内容自己往里加；竖向滚动区；英雄徽记；数字 / 时间格式；
 *   属性网格（两列「名称 · 数值」，偏离基础值的按增益 / 减益上色）与已获得秘卷列表（一排小签 / 每卷一行带说明）。
 */
import type { GameContext, HeroDef, StatKey } from '../../core/types';
import { RARITY_NAMES } from '../../core/types';
import { STAT_INFO } from '../../core/Stats';
import { bindButton, fillStacks } from '../dom';
import { DOWNSIDE_PREFIX, splitDownside } from '../ScreenData';
import { heroGlyph, fmtStat } from '../labels';
import { addClasses, el, formatNum, text } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { UIIcon, makeIcon } from '../toolkit/UIIcons';
import { Gold, css, lerpColor, rarityColor, rgb } from '../toolkit/UITheme';

/** 主题按钮（.sf-btn + classes） */
export function btn(ctx: GameContext, label: string, classes: string, parent: HTMLElement | null, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sf-btn';
  addClasses(b, classes);
  b.textContent = label;
  bindButton(ctx, b, () => onClick());
  parent?.appendChild(b);
  return b;
}

/** 自绘按钮（页签、分段、开关、步进器）：不带 sf-btn 的样式，内容自己往里加 */
export function card(ctx: GameContext, classes: string, parent: HTMLElement | null, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  addClasses(b, classes);
  bindButton(ctx, b, () => onClick());
  parent?.appendChild(b);
  return b;
}

/** 图标 */
export function icon(i: UIIcon, classes: string | null, parent: HTMLElement): HTMLDivElement {
  const e = makeIcon(i, classes);
  parent.appendChild(e);
  return e;
}

/** 竖向滚动区（焦点移进看不见的地方时浏览器自己会滚过去） */
export function scroll(classes: string, parent: HTMLElement): HTMLDivElement {
  return el('sf-scrollview ' + classes, parent);
}

/** 千分位整数 */
export function num(v: number): string {
  return formatNum(v);
}

/** 用时：m:ss（≥ 1 小时 h:mm:ss） */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** 三次缓出 */
export function easeOut(k: number): number {
  const u = 1 - Math.min(1, Math.max(0, k));
  return 1 - u * u * u;
}

/** 圆形徽记：英雄色描边 + 暗底 + 单字（暂停、结算用） */
export function crest(hero: HeroDef | null, parent: HTMLElement, classes?: string): HTMLDivElement {
  const c = el('sf-crest ' + (classes ?? ''), parent);
  text('sf-crest__glyph', c, heroGlyph(hero), UIFontRole.Title).dataset.name = 'glyph';
  setCrest(c, hero);
  return c;
}

export function setCrest(c: HTMLElement, hero: HeroDef | null): void {
  const col = hero ? rgb(hero.color) : Gold;
  c.style.borderColor = css(col);
  c.style.backgroundColor = css(lerpColor([0.04, 0.03, 0.05, 1], col, 0.32));
  const g = c.querySelector<HTMLElement>('[data-name="glyph"]');
  if (g) g.textContent = heroGlyph(hero);
}

// ───────────── 属性网格（StatGrid）─────────────

/** 暂停菜单的精简属性（Unity StatGrid.PauseStats） */
export const PAUSE_STATS: StatKey[] = ['maxHp', 'maxShield', 'damagePct', 'critChance', 'critDamagePct', 'fireRatePct', 'reloadSpeedPct', 'moveSpeed', 'skillHaste', 'damageReduction'];
const LOWER_IS_BETTER = new Set<StatKey>(['shieldRegenDelay', 'dashCooldown', 'spreadPct', 'recoilPct']);
const SIGNED = (k: StatKey) => k.endsWith('Pct') || k === 'skillHaste' || k === 'reactionHaste';

/** 数值文字：加成类带符号（+12%），其余是当前值（暴击率 17%、护盾恢复延迟 2.5秒、冲刺次数 3、移速 7.5） */
export function statValue(k: StatKey, v: number): string {
  if (!Number.isFinite(v)) v = 0;
  if (SIGNED(k)) return fmtStat(k, v);
  switch (STAT_INFO[k]?.format) {
    case 'pct': return `${Math.round(v * 100)}%`;
    case 'sec': return `${v.toFixed(1)}秒`;
    case 'int': return String(Math.round(v));
    default: return String(Math.round(v * 100) / 100);
  }
}

/** 渲染属性网格（先清空）；compact = 暂停菜单的紧凑行。返回行数 */
export function renderStatGrid(ctx: GameContext, parent: HTMLElement, keys: readonly StatKey[], full: boolean, compact = false): number {
  parent.replaceChildren();
  parent.classList.add('sf-statgrid');
  parent.classList.toggle('sf-statgrid--compact', compact);
  const stats = ctx.player?.stats;
  if (!stats) {
    text('sf-empty', parent, '没有玩家数据。');
    return 0;
  }
  const list = keys.slice();
  if (full) for (const k of Object.keys(STAT_INFO) as StatKey[]) if (!list.includes(k) && Math.abs(stats.get(k) - stats.getBase(k)) > 1e-5) list.push(k);
  for (const k of list) {
    const v = stats.get(k), d = v - stats.getBase(k);
    const row = el('sf-stat', parent);
    text('sf-stat__name', row, STAT_INFO[k]?.name ?? k);
    const tail = el('sf-stat__tail', row);
    const val = text('sf-stat__val', tail, statValue(k, v), UIFontRole.Number);
    if (Math.abs(d) > 1e-5) {
      const good = LOWER_IS_BETTER.has(k) ? d < 0 : d > 0;
      val.classList.add(good ? 'sf-stat__val--buff' : 'sf-stat__val--debuff');
      if (!SIGNED(k)) text('sf-stat__delta', tail, fmtStat(k, d), UIFontRole.Number);
    }
  }
  return list.length;
}

// ───────────── 已获得秘卷（ScrollList）─────────────

/** 渲染进 parent（先清空），按稀有度、层数从高到低；detailed = 每卷一行带说明，否则一排小签。返回秘卷数 */
export function renderScrollList(ctx: GameContext, parent: HTMLElement, detailed: boolean): number {
  parent.replaceChildren();
  const owned = ctx.scrolls?.owned() ?? [];
  if (owned.length === 0) {
    text('sf-empty', parent, '尚未获得秘卷。清关宝箱与商店都能找到它们。');
    return 0;
  }
  const sorted = owned.slice().sort((a, b) => b.def.rarity - a.def.rarity || b.stacks - a.stacks);
  for (const { def, stacks } of sorted) {
    const rc = rarityColor(def.rarity);
    const row = el(detailed ? 'sf-owned sf-owned--detailed' : 'sf-owned', parent);
    row.style.borderLeftColor = css(rc);
    const head = el('sf-owned__head', row);
    const name = text('sf-owned__name', head, def.name, detailed ? UIFontRole.Title : UIFontRole.Body);
    name.style.color = css(lerpColor(rc, [1, 1, 1, 1], 0.25));
    text('sf-owned__stacks', head, def.maxStacks > 1 ? `${stacks} / ${def.maxStacks} 层` : RARITY_NAMES[def.rarity] ?? '', UIFontRole.Number);
    if (!detailed) {
      row.title = fillStacks(def.description, stacks);
      continue;
    }
    // 收益照常、代价另起一行红字「代价：…」（Unity ScrollList.Render：SplitDownside → sf-owned__desc + sf-owned__down）
    const { upside, downside } = splitDownside(def, stacks);
    text('sf-owned__desc', row, upside, UIFontRole.Body, true);
    if (downside) text('sf-owned__down', row, DOWNSIDE_PREFIX + downside);
  }
  return owned.length;
}

// ───────────── 第二期界面共用 ─────────────

/** 一位小数、去掉尾零（7.5、12） */
export function num1(v: number): string {
  return String(Math.round((Number.isFinite(v) ? v : 0) * 10) / 10);
}

/** 中文数字（1–99）：「一」「十二」「二十」 */
export function cn(n: number): string {
  const d = '零一二三四五六七八九';
  if (!(n >= 0 && n <= 99) || !Number.isInteger(n)) return String(n);
  if (n < 10) return d[n];
  const t = Math.floor(n / 10), o = n % 10;
  return (t === 1 ? '' : d[t]) + '十' + (o === 0 ? '' : d[o]);
}

/** 回弹缓出（印章盖下） */
export function easeBack(k: number, overshoot = 1.7): number {
  const u = Math.min(1, Math.max(0, k)) - 1;
  return 1 + u * u * ((overshoot + 1) * u + overshoot);
}

/** 点阵底纹（装裱绫绢、没有俯视图的地图）：tile = 点距（设计像素） */
export function paintDots(e: HTMLElement, tint: readonly [number, number, number, number], tile = 12): void {
  e.style.background = `radial-gradient(circle at 50% 50%, ${css(tint)} 0, ${css(tint)} 1px, transparent 1.6px) 0 0 / ${tile}px ${tile}px repeat`;
}

/** 四边边框同色 */
export function border(e: HTMLElement, color: readonly [number, number, number, number]): void {
  e.style.borderColor = css(color);
}

/**
 * 局内模态界面（全图、行囊、关卡卡片）挡游戏：网页的模态状态由 Game 管——打开时在 playing 就 openModal（冻结玩法、放开鼠标），
 * 关上时还在 modal 就 closeModal（在按键 / 点击处理里同步调，才能重新锁定鼠标）。别的原因关掉的（回主菜单、结算）不动状态。
 */
export function gameModal(ctx: () => GameContext): { open(): void; close(): void; readonly owned: boolean } {
  let owned = false;
  return {
    open() {
      const g = ctx().game;
      owned = g.state === 'playing';
      if (owned) g.openModal();
    },
    close() {
      const g = ctx().game;
      if (owned && g.state === 'modal') g.closeModal();
      owned = false;
    },
    get owned() {
      return owned;
    },
  };
}
