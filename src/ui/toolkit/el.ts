/**
 * 界面元素工厂（照译 Unity HudArt.El / Text / Fill 与 ScreenKit 的同名工具）：
 *   元素一律是 div（UI Toolkit 的 VisualElement：纵向 flex，见 css/sf-base.css）；文字标签带 .sf-text（= FitLabel）；
 *   只在值变了时写文字 / 显隐 / 类（避免每帧标脏排版，同 Unity）；填充条按 scale 的 X 表示比例（轴心在左端）。
 *   Unity 的 style.translate / rotate / scale 是独立的三个属性，网页同样写 CSS 的独立变换属性 translate / rotate / scale。
 */
import { UIFontRole, fontClass } from './UIFonts';

export function addClasses(e: Element, classes: string | null | undefined): void {
  if (!classes) return;
  for (const c of classes.split(' ')) if (c) e.classList.add(c);
}

/** 一个元素（div）：classes 用空格分隔 */
export function el(classes?: string | null, parent?: HTMLElement | null, name?: string): HTMLDivElement {
  const e = document.createElement('div');
  addClasses(e, classes);
  if (name) e.dataset.name = name;
  parent?.appendChild(e);
  return e;
}

/** 文字标签（FitLabel）：role = 标题 / 数字字体；rich = Unity 富文本（<color> / <size> / <b> / <i>） */
export function text(classes: string | null, parent?: HTMLElement | null, value = '', role: UIFontRole = UIFontRole.Body, rich = false): HTMLDivElement {
  const e = el('sf-text ' + (classes ?? ''), parent);
  if (role !== UIFontRole.Body) e.classList.add(fontClass(role));
  if (rich) {
    e.dataset.rich = '1';
    e.classList.add('sf-rich');
    e.innerHTML = richToHtml(value);
  } else e.textContent = value;
  return e;
}

/** 只在值变了时写文字（富文本标签按富文本写） */
export function setText(e: HTMLElement, s: string): void {
  if (e.dataset.rich === '1') {
    if (e.dataset.src === s) return;
    e.dataset.src = s;
    e.innerHTML = richToHtml(s);
    return;
  }
  if (e.textContent !== s) e.textContent = s;
}

/** 只在值变了时写显隐（display） */
export function show(e: HTMLElement, on: boolean): void {
  const d = on ? '' : 'none';
  if (e.style.display !== d) e.style.display = d;
}

export function shown(e: HTMLElement): boolean {
  return e.style.display !== 'none';
}

export function toggle(e: Element, cls: string, on: boolean): void {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

/** 铺满父元素的填充层（轴心在左端中点，按 X 缩放表示比例） */
export function fill(parent: HTMLElement, classes?: string | null): HTMLDivElement {
  const e = el('sf-fill ' + (classes ?? ''), parent);
  e.style.transformOrigin = '0% 50%';
  return e;
}

/** 按 X 缩放的填充条 */
export function setFill(e: HTMLElement, f: number): void {
  const v = !(f > 0) ? 0 : f > 1 ? 1 : f;
  const s = `${round4(v)} 1`;
  if (e.style.scale !== s) e.style.scale = s;
}

export function setScale(e: HTMLElement, s: number | null, sy?: number): void {
  const v = s === null ? '' : `${round4(s)} ${round4(sy ?? s)}`;
  if (e.style.scale !== v) e.style.scale = v;
}

export function setTranslate(e: HTMLElement, x: number | null, y = 0): void {
  const v = x === null ? '' : `${round2(x)}px ${round2(y)}px`;
  if (e.style.translate !== v) e.style.translate = v;
}

export function setOpacity(e: HTMLElement, a: number | null): void {
  const v = a === null ? '' : String(Math.round(Math.min(1, Math.max(0, a)) * 1000) / 1000);
  if (e.style.opacity !== v) e.style.opacity = v;
}

/** 当前写进去的不透明度（没写过为 1） */
export function opacityOf(e: HTMLElement): number {
  return e.style.opacity === '' ? 1 : Number(e.style.opacity);
}

export function setColor(e: HTMLElement, color: string): void {
  if (e.style.color !== color) e.style.color = color;
}

/** 四边边框同色 */
export function setBorderColor(e: HTMLElement, color: string): void {
  if (e.style.borderColor !== color) e.style.borderColor = color;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 1,280 这样的千分位整数（同 Unity HudArt.FormatNum：InvariantCulture 的 N0） */
export function formatNum(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return v < 0 ? '-' + s : s;
}

/** 冷却秒数：≥ 1 秒取整（向上），< 1 秒一位小数；不在冷却为空 */
export function cooldownText(left: number): string {
  if (!(left > 0)) return '';
  return left >= 1 ? String(Math.ceil(left)) : (Math.ceil(left * 10) / 10).toFixed(1);
}

/** 指数阻尼（同 Unity HudArt.Damp / core/math damp） */
export function damp(a: number, b: number, lambda: number, dt: number): number {
  return b + (a - b) * Math.exp(-lambda * Math.max(0, dt));
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

/**
 * Unity 富文本 → 安全的 HTML：认 <color=#rrggbb|名字>、<size=N|N%>、<b>、<i>、<br>，换行符换成 <br>，其余字符全部转义。
 * 标签不配对时按出现顺序收尾（同 TextCore：缺的闭合标签在末尾补上）
 */
export function richToHtml(src: string): string {
  let out = '';
  const open: string[] = [];
  const re = /<(\/?)(color|size|b|i|br)(?:=([^>]*))?>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out += escapeHtml(src.slice(last, m.index)).replace(/\n/g, '<br>');
    last = re.lastIndex;
    const close = m[1] === '/', tag = m[2].toLowerCase(), arg = (m[3] ?? '').trim().replace(/^["']|["']$/g, '');
    if (tag === 'br') {
      out += '<br>';
      continue;
    }
    if (close) {
      const i = open.lastIndexOf(tag);
      if (i < 0) continue;
      while (open.length > i) out += closeTag(open.pop()!);
      continue;
    }
    if (tag === 'color') {
      if (!/^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(arg)) continue;
      out += `<span style="color:${arg}">`;
    } else if (tag === 'size') {
      const n = /^(\d+(?:\.\d+)?)(%|px)?$/.exec(arg);
      if (!n) continue;
      out += n[2] === '%' ? `<span style="font-size:${n[1]}%">` : `<span style="font-size:${n[1]}px">`;
    } else out += tag === 'b' ? '<b>' : '<i>';
    open.push(tag);
  }
  out += escapeHtml(src.slice(last)).replace(/\n/g, '<br>');
  while (open.length) out += closeTag(open.pop()!);
  return out;
}

function closeTag(tag: string): string {
  return tag === 'b' ? '</b>' : tag === 'i' ? '</i>' : '</span>';
}
