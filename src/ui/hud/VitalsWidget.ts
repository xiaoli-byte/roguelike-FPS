/**
 * 左下 生命 / 护盾（照译 Unity G/UI/Widgets/VitalsWidget.cs）：
 *   英雄徽记（圆框 + 单字，英雄色描边，低血量时朱红呼吸）；
 *   护盾细条（青）+ 生命主条（朱红，每 10% 一道刻度），都带「延迟掉血」拖尾（受伤后停 0.42 s / 0.25 s 再以 1.2 / s 追上）；
 *   数值：护盾数、生命「当前 / 上限」；没有护盾上限时护盾条半透明；低于 30% 生命条闪烁、数字变红；
 *   护盾被打碎（player:shieldBroken）：条内斜纹闪过 + 外框青光往外炸开 0.65 s。动画全部用不缩放时间。
 */
import { heroGlyph } from '../labels';
import { el, fill, setFill, setOpacity, setScale, setText, setTranslate, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { Gold, HpHi, JadeHi, type RGBA, barShade, css, glow, lerpColor, paint, rgb, stripes, withAlpha } from '../toolkit/UITheme';
import { HudColors, type HudFrame, HudWidget } from './HudWidget';

const TrailHold = 0.42, TrailRate = 1.2, ShatterTime = 0.65;

export class VitalsWidget extends HudWidget {
  readonly id = 'vitals';
  override readonly order = 50;

  private crest!: HTMLDivElement;
  private crestGlow!: HTMLDivElement;
  private glyph!: HTMLDivElement;
  private shieldBar!: HTMLDivElement;
  private shieldFill!: HTMLDivElement;
  private shieldTrail!: HTMLDivElement;
  private shatter!: HTMLDivElement;
  private burst!: HTMLDivElement;
  private shieldVal!: HTMLDivElement;
  private hpBar!: HTMLDivElement;
  private hpFill!: HTMLDivElement;
  private hpTrail!: HTMLDivElement;
  private hpVal!: HTMLDivElement;
  private hpMax!: HTMLDivElement;

  private heroId = '\0';
  private hpInt = -1;
  private maxInt = -1;
  private shInt = -1;
  private hpFrac = -1;
  private shFrac = -1;
  private hpTrailV = -1;
  private shTrailV = -1;
  private hpHold = 0;
  private shHold = 0;
  private shatterAt = -10;
  private low = false;
  private noShield = false;
  private heroColor: RGBA = Gold;
  private hpTint = '';
  private crestBorder = '';

  protected build(): HTMLElement {
    const root = el('sf-vitals');
    this.crest = el('sf-vitals__crest', root);
    this.crestGlow = el('sf-vitals__crestglow', this.crest);
    paint(this.crestGlow, glow(withAlpha(this.heroColor, 0.45)));
    this.glyph = text('sf-vitals__glyph', this.crest, '侠', UIFontRole.Title);

    const bars = el('sf-vitals__bars', root);
    this.shieldBar = el('sf-bar sf-bar--shield', bars);
    const sTrack = el('sf-bar__track', this.shieldBar);
    this.shieldTrail = fill(sTrack, 'sf-bar__trail');
    this.shieldTrail.style.backgroundColor = css([0.9, 0.97, 1, 0.75]);
    this.shieldFill = fill(sTrack, 'sf-bar__fill');
    paint(this.shieldFill, barShade(JadeHi));
    this.shatter = el('sf-bar__shatter', sTrack);
    paint(this.shatter, stripes([0.85, 0.95, 1, 1]));
    setOpacity(this.shatter, 0);
    this.shieldVal = text('sf-bar__val sf-bar__val--shield', this.shieldBar, '0', UIFontRole.Number);
    this.burst = el('sf-bar__burst', this.shieldBar);
    setOpacity(this.burst, 0);

    this.hpBar = el('sf-bar sf-bar--hp', bars);
    const hTrack = el('sf-bar__track', this.hpBar);
    this.hpTrail = fill(hTrack, 'sf-bar__trail');
    this.hpTrail.style.backgroundColor = css(withAlpha(HudColors.Trail, 0.9));
    this.hpFill = fill(hTrack, 'sf-bar__fill');
    this.setHpTint(HpHi);
    // 每 10% 一格的刻度
    for (let i = 1; i < 10; i++) {
      const tick = el('sf-bar__tick', hTrack);
      tick.style.left = `${i * 10}%`;
    }
    const val = el('sf-bar__valrow', this.hpBar);
    this.hpVal = text('sf-bar__val sf-bar__val--hp', val, '0', UIFontRole.Number);
    this.hpMax = text('sf-bar__max', val, ' / 0', UIFontRole.Number);
    return root;
  }

  protected override onAttach(): void {
    this.listen(this.game.events.on('player:shieldBroken', () => (this.shatterAt = performance.now() / 1000)));
  }

  override resetState(): void {
    this.hpFrac = this.shFrac = -1;
    this.hpTrailV = this.shTrailV = -1;
    this.hpInt = this.maxInt = this.shInt = -1;
    this.heroId = '\0';
    this.shatterAt = -10;
  }

  override tick(f: HudFrame): void {
    const p = this.game.player;
    this.visible = !!p;
    if (!p) return;
    const now = f.unscaledTime, step = Math.min(0.1, f.unscaledDt);

    const hero = p.hero;
    const id = hero?.id ?? '';
    if (id !== this.heroId) {
      this.heroId = id;
      setText(this.glyph, heroGlyph(hero));
      this.heroColor = hero ? rgb(hero.color) : Gold;
      paint(this.crestGlow, glow(withAlpha(this.heroColor, 0.45)));
    }

    // 防御性：任何一方写出 NaN 时不显示「NaN」
    const maxHp = Math.max(1, finite(p.maxHp(), 1));
    const hp = clamp(finite(p.hp, 0), 0, maxHp);
    const maxSh = Math.max(0, finite(p.maxShield(), 0));
    const sh = clamp(finite(p.shield, 0), 0, maxSh);

    const hi = Math.ceil(hp);
    if (hi !== this.hpInt) {
      this.hpInt = hi;
      this.hpVal.textContent = String(hi);
    }
    const mi = Math.round(maxHp);
    if (mi !== this.maxInt) {
      this.maxInt = mi;
      this.hpMax.textContent = ' / ' + mi;
    }
    const si = Math.ceil(sh);
    if (si !== this.shInt) {
      this.shInt = si;
      this.shieldVal.textContent = String(si);
    }
    const none = maxSh <= 0;
    if (none !== this.noShield) {
      this.noShield = none;
      toggle(this.shieldBar, 'is-none', none);
    }

    // 生命：延迟掉血
    const hf = hp / maxHp;
    if (Math.abs(hf - this.hpFrac) > 0.0008) {
      if (hf < this.hpFrac) this.hpHold = now + TrailHold;
      this.hpFrac = hf;
      setFill(this.hpFill, hf);
    }
    this.hpTrailV = trail(this.hpTrailV, hf, now >= this.hpHold, step, this.hpTrail);

    const sf = maxSh > 0 ? sh / maxSh : 0;
    if (Math.abs(sf - this.shFrac) > 0.0008) {
      if (sf < this.shFrac) this.shHold = now + TrailHold * 0.6;
      this.shFrac = sf;
      setFill(this.shieldFill, sf);
    }
    this.shTrailV = trail(this.shTrailV, sf, now >= this.shHold, step, this.shieldTrail);

    const isLow = p.alive && hf < 0.3;
    if (isLow !== this.low) {
      this.low = isLow;
      toggle(this.hpBar, 'is-low', isLow);
      toggle(this.crest, 'is-low', isLow);
      if (!isLow) this.setHpTint(HpHi);
    }
    if (this.low) {
      // 生命条 0.7 s 往返提亮、徽记边框 0.9 s 朱红呼吸
      const k = 0.5 + 0.5 * Math.sin((now * Math.PI) / 0.7);
      this.setHpTint(lerpColor(HpHi, [1, 0.75, 0.6, 1], k * 0.6));
      const kc = 0.5 + 0.5 * Math.sin((now * Math.PI) / 0.9);
      const dim: RGBA = [HpHi[0] * 0.7, HpHi[1] * 0.7, HpHi[2] * 0.7, 1];
      this.setCrestBorder(css(withAlpha(lerpColor(dim, HpHi, kc), 1)));
    } else this.setCrestBorder(css(this.heroColor));

    // 护盾碎裂
    const e = (now - this.shatterAt) / ShatterTime;
    if (e >= 0 && e < 1) {
      setOpacity(this.shatter, 1 - e);
      setTranslate(this.shatter, 18 * e, 0);
      setOpacity(this.burst, 1 - e);
      setScale(this.burst, 1 + 0.12 * e, 1 + 0.9 * e);
    } else if (this.shatter.style.opacity !== '0') {
      setOpacity(this.shatter, 0);
      setOpacity(this.burst, 0);
    }
  }

  private setHpTint(c: RGBA): void {
    const bg = barShade(c);
    if (bg === this.hpTint) return;
    this.hpTint = bg;
    paint(this.hpFill, bg);
  }

  private setCrestBorder(c: string): void {
    if (c === this.crestBorder) return;
    this.crestBorder = c;
    this.crest.style.borderColor = c;
  }
}

function trail(cur: number, target: number, release: boolean, step: number, e: HTMLElement): number {
  let v = cur;
  // 刚换玩家（-1）：拖尾直接对齐，不从满格往下掉
  if (v < 0 || v < target) v = target;
  else if (v > target && release) v = Math.max(target, v - step * TrailRate);
  if (v !== cur) setFill(e, v);
  return v;
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
