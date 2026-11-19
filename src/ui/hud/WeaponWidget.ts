/**
 * 右下 武器槽（照译 Unity G/UI/Widgets/WeaponWidget.cs；数据来自网页 IWeaponSystem）：
 *   副槽一行：切枪键 + 元素小徽 + 名字（品质色压暗）；
 *   主槽：右边框 = 品质色、墨色右实左透底；标题行 元素徽（火 / 雷 / 蚀；元素轮转武器加金圈）+ 名字（标题字体、品质色）+「+N」强化；
 *   弹药 大号弹匣 / 备弹（无限弹药显示 ∞、鎏金；余弹 ≤ 25% 变红）；
 *   计量条：蓄力武器显示蓄力（满蓄转金）、预热武器显示转速（网页武器系统没有转速读数，这一档暂不出现）；
 *   换弹条 + 提示（换弹中 / 按 R 换弹 / 弹药耗尽，后两者红字闪烁）；切枪时主槽从右滑入。
 * 碎刃（Unity 的接管者 DemonBladeController）：弹匣 = 刃气（0–100），备弹 ∞（无限弹药显示），刃气 / 杀意的竖条在 V 技能盘旁（BladeSkillWidget）。
 */
import type { WeaponInstance } from '../../core/types';
import { weaponName } from '../labels';
import { el, fill, setFill, setOpacity, setText, setTranslate, show, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { CinnabarHi, GoldHi, Paper2, Paper3, css, elementColor, fadeLeft, lerpColor, paint, rarityColor } from '../toolkit/UITheme';
import { HudColors, type HudFrame, HudWidget, elementGlyph, keyLabel } from './HudWidget';

const PulseTime = 0.22;

export class WeaponWidget extends HudWidget {
  readonly id = 'weapon';
  override readonly order = 50;

  private sec!: HTMLDivElement;
  private main!: HTMLDivElement;
  private elemBadge!: HTMLDivElement;
  private secElem!: HTMLDivElement;
  private gaugeRow!: HTMLDivElement;
  private gaugeFill!: HTMLDivElement;
  private reloadRow!: HTMLDivElement;
  private reloadTrack!: HTMLDivElement;
  private reloadFill!: HTMLDivElement;
  private secKey!: HTMLDivElement;
  private secName!: HTMLDivElement;
  private elemGlyph!: HTMLDivElement;
  private secElemGlyph!: HTMLDivElement;
  private nameLabel!: HTMLDivElement;
  private lvl!: HTMLDivElement;
  private mag!: HTMLDivElement;
  private reserve!: HTMLDivElement;
  private gaugeLabel!: HTMLDivElement;
  private hint!: HTMLDivElement;

  private uid = -2;
  private lvlV = -1;
  private rar = -1;
  private sUid = -2;
  private sLvl = -1;
  private sRar = -1;
  private magV = -1;
  private capV = -1;
  private resV = -1;
  private reloadQ = -2;
  private gaugeQ = -2;
  private elemV = '\0';
  private sElem = '\0';
  private infinite = false;
  private lowV = false;
  private hasWeapon = true;
  private gaugeFull = false;
  private pulsing = false;
  private hintV = '\0';
  private gaugeMode = '\0';
  private pulseAt = -10;

  protected build(): HTMLElement {
    const root = el('sf-weapon');
    this.sec = el('sf-weapon__sec', root);
    this.secKey = text('sf-weapon__seckey', this.sec, 'X', UIFontRole.Number);
    this.secElem = el('sf-weapon__elem sf-weapon__elem--sm', this.sec);
    this.secElemGlyph = text('sf-weapon__elemglyph', this.secElem, '', UIFontRole.Title);
    this.secName = text('sf-weapon__secname', this.sec);

    this.main = el('sf-weapon__main', root);
    paint(this.main, fadeLeft([0.027, 0.024, 0.04, 0.8]));
    const title = el('sf-weapon__title', this.main);
    this.elemBadge = el('sf-weapon__elem', title);
    this.elemGlyph = text('sf-weapon__elemglyph', this.elemBadge, '', UIFontRole.Title);
    this.nameLabel = text('sf-weapon__name', title, '', UIFontRole.Title);
    this.lvl = text('sf-weapon__lvl', title, '', UIFontRole.Number);

    const ammo = el('sf-weapon__ammo', this.main);
    this.mag = text('sf-weapon__mag', ammo, '0', UIFontRole.Number);
    text('sf-weapon__sep', ammo, '/', UIFontRole.Number);
    this.reserve = text('sf-weapon__reserve', ammo, '0', UIFontRole.Number);

    this.gaugeRow = el('sf-weapon__gauge', this.main);
    this.gaugeLabel = text('sf-weapon__gaugelabel', this.gaugeRow);
    const gTrack = el('sf-weapon__track', this.gaugeRow);
    this.gaugeFill = fill(gTrack, 'sf-weapon__trackfill');
    show(this.gaugeRow, false);

    this.reloadRow = el('sf-weapon__reload', this.main);
    this.reloadTrack = el('sf-weapon__track', this.reloadRow);
    this.reloadFill = fill(this.reloadTrack, 'sf-weapon__trackfill');
    this.reloadFill.style.backgroundColor = css(GoldHi);
    this.hint = text('sf-weapon__hint', this.reloadRow);
    setOpacity(this.reloadRow, 0);
    return root;
  }

  protected override onAttach(): void {
    this.listen(this.game.events.on('weapon:switched', () => (this.pulseAt = performance.now() / 1000)));
  }

  override resetState(): void {
    this.uid = this.sUid = -2;
    this.magV = this.capV = this.resV = -1;
    this.reloadQ = this.gaugeQ = -2;
    this.hintV = '\0';
    this.gaugeMode = '\0';
  }

  override tick(f: HudFrame): void {
    const ws = this.game.weapons;
    this.visible = !!ws;
    if (!ws) return;
    const now = f.unscaledTime;
    const w = ws.active;
    const has = !!w;
    if (has !== this.hasWeapon) {
      this.hasWeapon = has;
      toggle(this.main, 'is-empty', !has);
    }
    if (w) this.syncMain(w);
    else if (this.uid !== -1) {
      this.uid = -1;
      setText(this.nameLabel, '空手');
      show(this.elemBadge, false);
      show(this.lvl, false);
      setText(this.mag, '–');
      setText(this.reserve, '–');
      this.magV = this.resV = -1;
    }

    // 副槽：另一个槽里的枪
    const other = ws.slots[ws.activeSlot === 0 ? 1 : 0] ?? null;
    const su = other?.uid ?? -1;
    if (su !== this.sUid || (other && (other.level !== this.sLvl || other.rarity !== this.sRar || other.element !== this.sElem))) {
      this.sUid = su;
      this.sLvl = other?.level ?? -1;
      this.sRar = other?.rarity ?? -1;
      this.sElem = other?.element ?? 'none';
      show(this.sec, !!other);
      if (other) {
        const d = this.describe(other);
        setText(this.secName, other.level > 0 ? `${d.name} +${other.level}` : d.name);
        this.secName.style.color = css(lerpColor(rarityColor(other.rarity), Paper3, 0.3));
        setElem(this.secElem, this.secElemGlyph, other.element, d.cycleLabel);
      }
    }
    if (other) setText(this.secKey, keyLabel(this.game, 'swapWeapon', now));

    // 计量条：蓄力（网页没有预热武器的转速读数）
    const charge = ws.chargeProgress ?? 0;
    const charging = charge > 0.001;
    const gm = charging ? 'charge' : '';
    if (gm !== this.gaugeMode) {
      this.gaugeMode = gm;
      show(this.gaugeRow, gm.length > 0);
      setText(this.gaugeLabel, charging ? '蓄力' : '');
      this.gaugeQ = -2;
    }
    if (gm.length > 0) {
      const q = Math.round(Math.min(1, Math.max(0, charge)) * 100);
      const full = q >= 100;
      if (q !== this.gaugeQ || full !== this.gaugeFull) {
        this.gaugeQ = q;
        this.gaugeFull = full;
        setFill(this.gaugeFill, q / 100);
        this.gaugeFill.style.backgroundColor = css(full ? HudColors.ArmorHi : [0.886, 0.831, 1, 1]);
        this.gaugeLabel.style.color = css(full ? HudColors.ArmorHi : Paper2);
      }
    }

    // 换弹进度与提示
    const reloading = ws.isReloading;
    const rq = reloading ? Math.round(Math.min(1, Math.max(0, ws.reloadProgress)) * 100) : -1;
    if (rq !== this.reloadQ) {
      if (rq >= 0 !== this.reloadQ >= 0) show(this.reloadTrack, rq >= 0);
      this.reloadQ = rq;
      if (rq >= 0) setFill(this.reloadFill, rq / 100);
    }
    let h = '';
    if (reloading) h = '换弹中';
    else if (has && !this.infinite && this.magV === 0) h = this.resV > 0 ? `按 ${keyLabel(this.game, 'reload', now)} 换弹` : '弹药耗尽';
    if (h !== this.hintV) {
      this.hintV = h;
      this.hint.textContent = h;
      toggle(this.reloadRow, 'is-alert', h.length > 0 && !reloading);
    }
    const alert = h.length > 0 && !reloading;
    // 告警：0.9 s 两段闪（steps(2)）
    setOpacity(this.hint, alert ? (now % 0.9 < 0.45 ? 1 : 0.35) : 1);
    setOpacity(this.reloadRow, reloading || h.length > 0 ? 1 : 0);

    // 切枪：主槽从右滑入
    const k = (now - this.pulseAt) / PulseTime;
    if (k >= 0 && k < 1) {
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      setTranslate(this.main, 14 * (1 - e), 0);
      setOpacity(this.main, 0.3 + 0.7 * e);
      this.pulsing = true;
    } else if (this.pulsing) {
      this.pulsing = false;
      setTranslate(this.main, null);
      setOpacity(this.main, null);
    }
  }

  private syncMain(w: WeaponInstance): void {
    const ws = this.game.weapons;
    if (w.uid !== this.uid || w.level !== this.lvlV || w.rarity !== this.rar || w.element !== this.elemV) {
      this.uid = w.uid;
      this.lvlV = w.level;
      this.rar = w.rarity;
      this.elemV = w.element;
      const d = this.describe(w);
      const rc = css(rarityColor(w.rarity));
      setText(this.nameLabel, d.name);
      this.nameLabel.style.color = rc;
      this.main.style.borderRightColor = rc;
      show(this.lvl, w.level > 0);
      setText(this.lvl, '+' + w.level);
      // 元素徽：元素轮转武器（三才转轮）显示金圈「三」（网页没有「下一发」的元素读数）
      setElem(this.elemBadge, this.elemGlyph, w.element, d.cycleLabel);
    }

    // 碎刃：弹匣 = 刃气，备弹 ∞（同 Unity DemonBladeController 的 IWeaponHudSource）
    const blade = ws.bladeHud ?? null;
    const cap = blade ? 100 : Math.max(1, ws.magCapacity(w));
    const m = blade ? Math.round(Math.min(1, Math.max(0, blade.qi)) * 100) : Math.max(0, Math.floor(w.mag));
    const r = blade ? 0 : Math.max(0, Math.floor(w.reserve));
    const inf = !!blade || (this.game.run.flags.infiniteAmmo ?? 0) > 0;
    if (m !== this.magV) {
      this.magV = m;
      this.mag.textContent = String(m);
    }
    if (r !== this.resV || inf !== this.infinite) {
      this.resV = r;
      this.reserve.textContent = inf ? '∞' : String(r);
    }
    if (inf !== this.infinite) {
      this.infinite = inf;
      toggle(this.main, 'is-infinite', inf);
    }
    const isLow = !inf && m <= Math.max(1, Math.ceil(cap * 0.25));
    if (isLow !== this.lowV || cap !== this.capV) {
      this.lowV = isLow;
      this.capV = cap;
      toggle(this.mag, 'is-low', isLow);
    }
  }

  private describe(w: WeaponInstance): { name: string; cycleLabel: string | null } {
    try {
      const d = this.game.weapons.describe(w);
      return { name: d.name || weaponName(w.defId), cycleLabel: d.elementLabel || null };
    } catch {
      return { name: weaponName(w.defId), cycleLabel: null };
    }
  }
}

/** 元素徽：元素色底 + 单字；元素轮转（cycleLabel 非空）加金圈 is-tri，显示标签首字（Unity：「三」） */
function setElem(badge: HTMLElement, glyph: HTMLElement, element: string, cycleLabel: string | null): void {
  const cycle = !!cycleLabel;
  show(badge, element !== 'none' || cycle);
  if (element === 'none' && !cycle) return;
  const c = cycle ? GoldHi : element !== 'none' ? elementColor(element) : GoldHi;
  badge.style.backgroundColor = css(c);
  toggle(badge, 'is-tri', cycle);
  setText(glyph, cycle ? cycleLabel!.charAt(0) : elementGlyph(element));
}

// 预热武器的转速色（Unity：橙 → 朱红），网页武器系统接上转速读数后用
export const HEAT_COLOR = (q: number) => lerpColor([1, 0.62, 0.25, 1], CinnabarHi, q / 100);
