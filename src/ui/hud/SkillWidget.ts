/**
 * 技能盘（照译 Unity G/UI/Widgets/SkillWidget.cs 的 SkillDisc + SkillWidget，与 Weapons/DemonBlade/BladeSkillWidget.cs）：
 *   SkillDisc：64 px 墨色圆盘 + 冷却环（12 点起顺时针）+ 单字 + 冷却秒数 + 充能角标（最大充能 > 1 才显示）+ 顶上的键帽 + 下方技能名。
 *     状态：冷却（单字淡到 0.25、环转灰）、生效中（金圈 0.8 s 呼吸）、放出（亮一下、放大 1.12 回弹 0.32 s）、拒绝（框闪红 + 左右抖 0.3 s）。
 *   SkillWidget：底部居中 Q / E 盘 + 冲刺充能格（1–6 格，每格按回充进度从中心长满，满格发青光）。
 *     放出闪光听 skill:used；拒绝闪红：Unity 由技能系统调 GameUI.SkillDenied，网页的技能系统没有这个钩子——按下技能键时没有充能就闪红。
 *   BladeSkillWidget：武器技能 V 盘（碎刃「杀气爆发 / 人刀合一」），排在技能栏右边，右侧两根竖条：杀意（满时转金）与刃气。
 */
import type { SkillState } from '../../core/types';
import { cooldownText, el, setBorderColor, setOpacity, setScale, setText, setTranslate, show, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { Gold, GoldHi, Paper3, type RGBA, css, glow, lerpColor, paint, rgb } from '../toolkit/UITheme';
import { type HudFrame, HudWidget, keyLabel } from './HudWidget';
import { RingElement } from './shapes';

const FlashTime = 0.32, DenyTime = 0.3;
const DiscBorder: RGBA = [0.83, 0.66, 0.33, 0.25];

export class SkillDisc {
  readonly el: HTMLDivElement;
  private readonly disc: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly ring: RingElement;
  private readonly glyph: HTMLDivElement;
  private readonly cd: HTMLDivElement;
  private readonly charges: HTMLDivElement;
  private readonly key: HTMLDivElement;
  private readonly nameLabel: HTMLDivElement;
  private flashAt = -10;
  private denyAt = -10;
  private cooling = false;
  private active = false;
  private animating = false;
  private chargesV = -1;
  private maxV = -1;
  private ringColor: RGBA = Gold;

  constructor(keyText: string, size = 64) {
    this.el = el('sf-skill');
    this.disc = el('sf-skill__disc', this.el);
    this.disc.style.width = this.disc.style.height = `${size}px`;
    this.disc.style.borderRadius = `${size * 0.5}px`;
    this.disc.style.transformOrigin = '50% 50%';
    const shade = el('sf-skill__shade', this.disc);
    paint(shade, glow([0.145, 0.118, 0.16, 1]));
    this.ring = new RingElement(3, size, 'sf-skill__ring');
    this.ring.Track = [1, 1, 1, 0.08];
    this.ring.Color = Gold;
    this.disc.appendChild(this.ring.el);
    this.glyph = text('sf-skill__glyph', this.disc, '', UIFontRole.Title);
    this.glyph.style.fontSize = `${Math.round(size * 0.45)}px`;
    this.cd = text('sf-skill__cd', this.disc, '', UIFontRole.Number);
    this.cd.style.fontSize = `${Math.round(size * 0.33)}px`;
    this.flash = el('sf-skill__flash', this.disc);
    this.flash.style.borderRadius = `${size * 0.5}px`;
    setOpacity(this.flash, 0);
    this.charges = text('sf-skill__charges', this.disc, '', UIFontRole.Number);
    show(this.charges, false);
    this.key = text('sf-skill__key', this.disc, keyText, UIFontRole.Number);
    this.nameLabel = text('sf-skill__name', this.el);
  }

  set Key(v: string) {
    setText(this.key, v ?? '');
  }

  /** 技能名（单字取首字） */
  setSkill(name: string, glyphText?: string | null): void {
    name = name || '技能';
    setText(this.nameLabel, name);
    setText(this.glyph, glyphText || name.charAt(0));
  }

  /** 环与描边的强调色（灵宠技按品阶色） */
  set Accent(v: RGBA) {
    this.ringColor = v;
    if (!this.cooling && !this.active) this.ring.Color = v;
  }

  /**
   * 刷新：progress = 冷却进度 0..1（1 = 就绪）、cooldownLeft = 剩余秒数（只在没有充能时显示）、充能 / 最大充能、生效中。充能变多时自动闪一下
   */
  set(progress: number, cooldownLeft: number, chargesNow: number, maxCharges: number, isActive: boolean, now: number): void {
    this.ring.Progress = progress;
    maxCharges = Math.max(1, maxCharges);
    if (chargesNow !== this.chargesV || maxCharges !== this.maxV) {
      if (this.chargesV >= 0 && chargesNow > this.chargesV) this.Flash(now);
      this.chargesV = chargesNow;
      this.maxV = maxCharges;
      show(this.charges, maxCharges > 1);
      setText(this.charges, String(chargesNow));
    }
    const c = chargesNow <= 0;
    if (c !== this.cooling || isActive !== this.active) {
      this.cooling = c;
      this.active = isActive;
      toggle(this.el, 'is-cooling', c);
      toggle(this.el, 'is-active', isActive);
      this.ring.Color = isActive ? GoldHi : c ? Paper3 : this.ringColor;
    }
    setText(this.cd, c ? cooldownText(cooldownLeft) : '');
    this.animate(now);
  }

  /** 放出：亮一下、放大回弹 */
  Flash(now: number): void {
    this.flashAt = now;
  }

  /** 放不出来：框闪红、左右抖 */
  Deny(now: number): void {
    this.denyAt = now;
  }

  private animate(now: number): void {
    const kf = (now - this.flashAt) / FlashTime;
    const kd = (now - this.denyAt) / DenyTime;
    const f = kf >= 0 && kf < 1, d = kd >= 0 && kd < 1;
    if (f) {
      const e = 1 - kf;
      setOpacity(this.flash, 0.6 * e * e);
      setScale(this.disc, 1 + 0.12 * e * e);
    }
    if (d) {
      const e = 1 - kd;
      setTranslate(this.disc, Math.sin(now * 70) * 6 * e, 0);
      setBorderColor(this.disc, css(lerpColor(DiscBorder, [1, 0.18, 0.12, 1], e)));
    }
    if (this.active) {
      // 生效中：金圈 0.8 s 往返呼吸
      const k = 0.5 + 0.5 * Math.sin((now * Math.PI) / 0.8);
      if (!d) setBorderColor(this.disc, css(lerpColor(Gold, GoldHi, k)));
    }
    if (f || d || this.active) {
      this.animating = true;
      return;
    }
    if (!this.animating) return;
    this.animating = false;
    setOpacity(this.flash, 0);
    setScale(this.disc, null);
    setTranslate(this.disc, null);
    this.disc.style.borderColor = '';
  }
}

export class SkillWidget extends HudWidget {
  readonly id = 'skills';
  override readonly order = 50;

  q!: SkillDisc;
  e!: SkillDisc;
  private dash!: HTMLDivElement;
  private readonly pips: { pip: HTMLDivElement; fill: HTMLDivElement }[] = [];
  private readonly pipQ: number[] = [-1, -1, -1, -1, -1, -1];
  private maxPips = -1;
  private shownQ: string | null = null;
  private shownE: string | null = null;

  protected build(): HTMLElement {
    const root = el('sf-skillbar');
    const row = el('sf-skills', root);
    this.q = new SkillDisc('Q');
    this.e = new SkillDisc('E');
    row.append(this.q.el, this.e.el);
    this.dash = el('sf-dash', root);
    return root;
  }

  protected override onAttach(): void {
    this.listen(this.game.events.on('skill:used', ({ slot }) => (slot === 'primary' ? this.q : this.e).Flash(performance.now() / 1000)));
  }

  override resetState(): void {
    this.shownQ = this.shownE = null;
    this.maxPips = -1;
  }

  override tick(f: HudFrame): void {
    const p = this.game.player;
    this.visible = !!p;
    if (!p) return;
    const now = f.unscaledTime;
    const input = this.game.input;
    this.shownQ = this.sync(this.q, p.skills.primary, this.shownQ, 'skillPrimary', now, f.playing && input.pressed('skillPrimary'));
    this.shownE = this.sync(this.e, p.skills.secondary, this.shownE, 'skillSecondary', now, f.playing && input.pressed('skillSecondary'));
    this.updateDash();
  }

  private sync(disc: SkillDisc, sk: SkillState | null, shown: string | null, action: 'skillPrimary' | 'skillSecondary', now: number, pressed: boolean): string | null {
    show(disc.el, !!sk);
    if (!sk) return shown;
    if (sk.def.id !== shown) {
      shown = sk.def.id;
      disc.setSkill(sk.def.name);
    }
    disc.Key = keyLabel(this.game, action, now);
    const rem = Math.max(0, sk.cooldownRemaining);
    const total = sk.cooldownTotal > 0 ? sk.cooldownTotal : sk.def.cooldown > 0 ? sk.def.cooldown : 1;
    const prog = rem > 0 ? Math.min(1, Math.max(0, 1 - rem / total)) : 1;
    let busy = false;
    try {
      busy = !!sk.def.isActive?.(this.game);
    } catch {
      busy = false;
    }
    if (pressed && sk.charges <= 0) disc.Deny(now);
    disc.set(prog, rem, sk.charges, sk.maxCharges, busy, now);
    return shown;
  }

  private updateDash(): void {
    const p = this.game.player;
    const max = Math.min(6, Math.max(1, Math.round(p.stats.get('dashCharges'))));
    if (max !== this.maxPips) {
      this.maxPips = max;
      while (this.pips.length < max) {
        const pip = el('sf-dash__pip', this.dash);
        const fillEl = el('sf-dash__fill', pip);
        setScale(fillEl, 0);
        this.pips.push({ pip, fill: fillEl });
      }
      for (let i = 0; i < this.pips.length; i++) {
        show(this.pips[i].pip, i < max);
        this.pipQ[i] = -1;
      }
    }
    // 充能水位 = 满格数 + 正在回充那格的进度（PlayerController 的实际冷却下限 0.2 秒）
    const charges = Math.min(max, Math.max(0, Math.floor(p.dashCharges)));
    const total = Math.max(0.2, p.stats.get('dashCooldown') || 0);
    const level = charges + (charges < max ? Math.min(1, Math.max(0, 1 - p.dashCooldownRemaining / total)) : 0);
    for (let i = 0; i < max; i++) {
      const qv = Math.round(Math.min(1, Math.max(0, level - i)) * 20) / 20;
      if (qv === this.pipQ[i]) continue;
      this.pipQ[i] = qv;
      setScale(this.pips[i].fill, qv);
      toggle(this.pips[i].pip, 'is-full', qv >= 1);
    }
  }
}

/** Unity BladeSkillWidget：V 盘 + 杀意 / 刃气两根竖条（握着有武器技能的武器时显示） */
const DiscSize = 64, BarH = 64, BarW = 5;
const IntentColor = rgb(0xb07cff), IntentFull = rgb(0xf4d893), QiColor = rgb(0xd8c2ff);

export class BladeSkillWidget extends HudWidget {
  readonly id = 'blade-skill';
  override readonly order = 51;

  disc!: SkillDisc;
  private intentFill!: HTMLDivElement;
  private qiFill!: HTMLDivElement;
  private qiTrack!: HTMLDivElement;
  private shownId = '\0';
  private intentQ = -1;
  private qiQ = -1;
  private lastRem = -1;

  protected build(): HTMLElement {
    const root = el('sf-blade-skill');
    root.style.position = 'absolute';
    root.style.left = '50%';
    // 技能栏：Q / E 各 76 px + 左右 10 px 居中排开，E 的右缘在中线右侧 96 px；技能栏底 20 px + 冲刺格 21 px
    root.style.marginLeft = '100px';
    root.style.bottom = '41px';
    root.style.flexDirection = 'row';
    root.style.alignItems = 'flex-start';
    this.disc = new SkillDisc('V', DiscSize);
    root.appendChild(this.disc.el);
    const bars = el(null, root);
    bars.style.flexDirection = 'row';
    bars.style.marginLeft = '-2px';
    [this.intentFill] = bar(bars, IntentColor);
    [this.qiFill, this.qiTrack] = bar(bars, QiColor);
    root.style.display = 'none';
    return root;
  }

  protected override onAttach(): void {
    this.listen(this.game.events.on('weapon:skillUsed', () => this.disc.Flash(performance.now() / 1000)));
  }

  override resetState(): void {
    this.shownId = '\0';
    this.intentQ = this.qiQ = -1;
    this.lastRem = -1;
  }

  override tick(f: HudFrame): void {
    const ws = this.game.weapons;
    const s = ws?.weaponSkill ?? null;
    this.visible = !!s;
    if (!s) {
      this.lastRem = -1;
      return;
    }
    const now = f.unscaledTime;
    if (s.id !== this.shownId) {
      this.shownId = s.id;
      this.disc.setSkill(s.name, s.glyph);
      this.disc.Accent = s.id.includes('union') || s.glyph === '合' ? GoldHi : Gold;
    }
    this.disc.Key = s.key || keyLabel(this.game, 'weaponSkill', now);
    const left = Math.max(0, s.cooldownRemaining), total = Math.max(0.1, s.cooldownTotal);
    const prog = left > 0 ? Math.min(1, Math.max(0, 1 - left / total)) : 1;
    if (f.playing && this.game.input.pressed('weaponSkill') && left > 0) this.disc.Deny(now);
    if (this.lastRem > 0 && left <= 0) this.disc.Flash(now);
    this.lastRem = left;
    this.disc.set(prog, left, left > 0 ? 0 : 1, 1, !!s.active, now);

    const iq = Math.round(Math.min(1, Math.max(0, s.charge ?? 0)) * 50);
    if (iq !== this.intentQ) {
      this.intentQ = iq;
      setScale(this.intentFill, 1, iq / 50);
      this.intentFill.style.backgroundColor = css(iq >= 50 ? IntentFull : IntentColor);
    }
    const blade = ws.bladeHud ?? null;
    show(this.qiTrack, !!blade);
    const qq = Math.round(Math.min(1, Math.max(0, blade?.qi ?? 0)) * 50);
    if (qq !== this.qiQ) {
      this.qiQ = qq;
      setScale(this.qiFill, 1, qq / 50);
    }
  }
}

function bar(parent: HTMLElement, c: RGBA): [HTMLDivElement, HTMLDivElement] {
  const track = el(null, parent);
  track.style.width = `${BarW}px`;
  track.style.height = `${BarH}px`;
  track.style.marginRight = '3px';
  track.style.backgroundColor = css([0.03, 0.02, 0.04, 0.65]);
  track.style.borderWidth = '1px';
  track.style.borderColor = css(DiscBorder);
  const f = el(null, track);
  f.style.position = 'absolute';
  f.style.left = f.style.right = f.style.top = f.style.bottom = '0';
  f.style.backgroundColor = css(c);
  f.style.transformOrigin = '50% 100%';
  setScale(f, 1, 0);
  return [f, track];
}
