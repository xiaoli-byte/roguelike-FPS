/**
 * 界面主题在代码这一侧的部分（照译 Unity G/UI/Toolkit/UITheme.cs；样式本体在 src/ui/css/unity/theme.css，由 theme.uss 转出）：
 *   调色板（与 theme.uss 的 --变量 同值，代码里拼颜色时用）、常用类名、USS 做不了的程序贴图。
 * Unity 用程序贴图 + tint 画渐变（横向渐隐、径向暗角、条形明暗）；网页直接写成同曲线的 CSS 渐变（paint* 函数，色标按 C# 的公式取样）。
 */

export type RGBA = readonly [number, number, number, number];

export function rgb(hex: number, a = 1): RGBA {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, a];
}

export function withAlpha(c: RGBA, a: number): RGBA {
  return [c[0], c[1], c[2], a];
}

export function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
}

/** RGBA（0..1）→ CSS rgba() */
export function css(c: RGBA, alphaMul = 1): string {
  const r = Math.round(clamp01(c[0]) * 255), g = Math.round(clamp01(c[1]) * 255), b = Math.round(clamp01(c[2]) * 255);
  const a = Math.round(clamp01(c[3] * alphaMul) * 1000) / 1000;
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** CSS 颜色串（#rrggbb）→ RGBA；认不出返回 null */
export function parseCss(s: string | undefined | null): RGBA | null {
  if (!s) return null;
  const m = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (m) return rgb(parseInt(m[1], 16));
  const m3 = /^#([0-9a-f]{3})$/i.exec(s.trim());
  if (m3) {
    const [r, g, b] = m3[1].split('').map((x) => parseInt(x + x, 16));
    return [r / 255, g / 255, b / 255, 1];
  }
  const mr = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s.trim());
  if (mr) return [+mr[1] / 255, +mr[2] / 255, +mr[3] / 255, mr[4] !== undefined ? +mr[4] : 1];
  return null;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0;
}

// ── 调色板（base.css 设计令牌，= theme.uss 的 --变量）──
export const Ink0 = rgb(0x07060a), Ink1 = rgb(0x0f0d12), Ink2 = rgb(0x18151c), Ink3 = rgb(0x251f29);
export const Paper = rgb(0xefe4cc), Paper2 = rgb(0xc8b999), Paper3 = rgb(0x8a7f6d);
export const Cinnabar = rgb(0xc9372a), CinnabarHi = rgb(0xff5a3c), CinnabarLo = rgb(0x6b1b13);
export const Gold = rgb(0xd4a955), GoldHi = rgb(0xf4d893), GoldLo = rgb(0x6f5626);
export const Jade = rgb(0x52b6ec), JadeHi = rgb(0xb8eaff);
export const Hp = rgb(0xd33a2c), HpHi = rgb(0xff7a5a), Armor = rgb(0xe0b23c), Good = rgb(0x86dc8f), Bad = rgb(0xff6a4d);
export const Coin = rgb(0xe8b64a), Essence = rgb(0x9fd6ff);

/** 稀有度颜色（= G/Core/Rarity.cs；USS 里是 .sf-rarity-0 … 4） */
export const RARITY_COLORS: readonly RGBA[] = [rgb(0xcfd3da), rgb(0x62d36a), rgb(0x4aa3ff), rgb(0xb45cff), rgb(0xffa726)];
export function rarityColor(r: number): RGBA {
  return RARITY_COLORS[Math.max(0, Math.min(4, r | 0))];
}

/** 元素颜色（= DamageTable.ElementColor；USS 里是 .sf-el-fire / -shock / -corrode） */
export const ELEMENT_COLORS: Record<string, RGBA> = {
  none: rgb(0xffffff),
  fire: rgb(0xff8c33),
  shock: rgb(0x8cbfff),
  corrode: rgb(0x99e64d),
};
export function elementColor(e: string): RGBA {
  return ELEMENT_COLORS[e] ?? ELEMENT_COLORS.none;
}

// ── 类名（theme.css）──
export const Cls = {
  Layer: 'sf-layer', Screen: 'sf-screen', Backdrop: 'sf-backdrop',
  TitleFont: 'sf-title', NumberFont: 'sf-num', BodyText: 'sf-body',
  Button: 'sf-btn', ButtonPrimary: 'sf-btn--primary', ButtonGhost: 'sf-btn--ghost', ButtonDanger: 'sf-btn--danger',
  Frame: 'sf-frame', PanelTitle: 'sf-panel__title', Key: 'sf-key', Seal: 'sf-seal', Chip: 'sf-chip', Icon: 'sf-icon',
  /** 按钮音：缺省点击 ui_click；加 sf-sound-confirm / sf-sound-deny 换音，sf-silent 不出声（audio/UISound.ts 读） */
  SoundConfirm: 'sf-sound-confirm', SoundDeny: 'sf-sound-deny', Silent: 'sf-silent',
} as const;

export function rarityClass(r: number): string {
  return 'sf-rarity-' + Math.max(0, Math.min(4, r | 0));
}

export function elementClass(e: string): string {
  return e === 'fire' || e === 'shock' || e === 'corrode' ? 'sf-el-' + e : 'sf-el-none';
}

// ── 程序贴图 → CSS 渐变（白色 + alpha × tint）──

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 左实右透（toast 底）：alpha 0.88 → 0.55（80%）→ 0 */
export function fadeRight(tint: RGBA): string {
  return `linear-gradient(90deg, ${css(tint, 0.88)} 0%, ${css(tint, 0.55)} 80%, ${css(tint, 0)} 100%)`;
}

/** 两端透明、中间实（横幅分割线）：smoothstep(1 - |2x - 1|) */
export function fadeBoth(tint: RGBA): string {
  const stops: string[] = [];
  for (let i = 0; i <= 10; i++) {
    const x = i / 10;
    stops.push(`${css(tint, smooth(1 - Math.abs(x * 2 - 1)))} ${(x * 100).toFixed(0)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** 径向：中心实、边缘透明（横幅 / 中央大字的淡墨衬底）：中心 0.62 → 0.38（60%）→ 0（100%），椭圆贴满元素 */
export function radialSoft(tint: RGBA): string {
  return `radial-gradient(closest-side, ${css(tint, 0.62)} 0%, ${css(tint, 0.38)} 60%, ${css(tint, 0)} 100%)`;
}

/** 屏幕暗角：0.42 半径内透明，到 1.02 渐浓到满（smoothstep），椭圆铺满全屏（HudArt.Vignette） */
export function vignette(tint: RGBA): string {
  const stops: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    stops.push(`${css(tint, smooth(u))} ${((0.42 + 0.6 * u) * 100).toFixed(1)}%`);
  }
  return `radial-gradient(closest-side, ${stops.join(', ')})`;
}

/** 柔光圆：中心实、边缘透明（1 - smoothstep(d)） */
export function glow(tint: RGBA): string {
  const stops: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const d = i / 8;
    stops.push(`${css(tint, 1 - smooth(d))} ${(d * 100).toFixed(1)}%`);
  }
  return `radial-gradient(closest-side, ${stops.join(', ')})`;
}

/** 条形明暗（竖向）：顶上 35% 高光、往下渐暗到 0.5（tint 上色后 = 高光色 → 本色 → 暗色；HudArt.BarShade） */
export function barShade(tint: RGBA): string {
  const k = (v: number): RGBA => [tint[0] * v, tint[1] * v, tint[2] * v, tint[3]];
  return `linear-gradient(180deg, ${css(k(1))} 0%, ${css(k(0.86))} 35%, ${css(k(0.5))} 100%)`;
}

/** 右实左透（武器槽 / 信息角底：alpha 1 → 0.62（70%）→ 0；HudArt.FadeLeft） */
export function fadeLeft(tint: RGBA): string {
  return `linear-gradient(270deg, ${css(tint, 1)} 0%, ${css(tint, 0.62)} 70%, ${css(tint, 0)} 100%)`;
}

/** 斜纹（护盾碎裂的裂纹闪光：118° 每 13 px 一道 1.5 px 亮线，其余 0.25；HudArt.Stripes） */
export function stripes(tint: RGBA): string {
  return `repeating-linear-gradient(118deg, ${css(tint, 0.95)} 0px, ${css(tint, 0.95)} 1.5px, ${css(tint, 0.25)} 1.5px, ${css(tint, 0.05)} 13px)`;
}

/** 给元素铺一张「程序贴图」（拉伸铺满；画在样式表的 background-color 上面，同 UI Toolkit） */
export function paint(e: HTMLElement, background: string): void {
  if (e.style.backgroundImage !== background) e.style.backgroundImage = background;
}
