/**
 * 游戏内 HUD：生命 / 护盾、武器与弹药（含双形态武器的形态徽记）、武器技能图标、Q/E 技能与冲刺、
 * 右上角关卡信息与金币，并组合准星反馈、敌人血条、Boss 血条、Tab 面板。
 * 每帧只写变化了的文本 / 样式（缓存上次值），不重建 DOM。
 */
import type {
  DamageResult, GameContext, GameState, IEnemy, SkillState, StageNode, WeaponForm, WeaponInstance, WeaponSkillState,
} from '../core/types';
import { RARITY_CSS } from '../core/types';
import { clamp, clamp01 } from '../core/math';
import type * as THREE from 'three';
import { h, icon, formatNum } from './dom';
import { ICON_BLADES, ICON_COIN, ICON_ESSENCE } from './icons';
import { ELEMENT_GLYPH, elementCss, heroColor, heroGlyph, weaponName } from './labels';
import { Crosshair } from './Crosshair';
import { EnemyBars } from './EnemyBars';
import { BossBar } from './BossBar';
import { InventoryPanel } from './InventoryPanel';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TRAIL_HOLD = 420;

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

// ───────────────────────────── 生命 / 护盾 ─────────────────────────────

class Vitals {
  readonly root: HTMLDivElement;
  private crest: HTMLDivElement;
  private glyph: HTMLSpanElement;
  private shieldBar: HTMLDivElement;
  private shieldFill: HTMLDivElement;
  private shieldTrail: HTMLDivElement;
  private shieldVal: HTMLSpanElement;
  private hpBar: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpTrail: HTMLDivElement;
  private hpVal: HTMLSpanElement;
  private hpMaxEl: HTMLSpanElement;

  private heroId = '\u0000';
  private hpInt = -1;
  private maxInt = -1;
  private shInt = -1;
  private hpFrac = -1;
  private shFrac = -1;
  private hpTrailV = 1;
  private shTrailV = 1;
  private hpHold = 0;
  private shHold = 0;
  private low = false;
  private noShield = false;
  private lastNow = 0;

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-vitals', parent);
    this.crest = h('div', 'gf-vitals__crest', this.root);
    this.glyph = h('span', 'gf-vitals__glyph', this.crest);
    const bars = h('div', 'gf-vitals__bars', this.root);

    this.shieldBar = h('div', 'gf-bar gf-bar--shield', bars);
    const sTrack = h('div', 'gf-bar__track', this.shieldBar);
    this.shieldTrail = h('div', 'gf-bar__trail', sTrack);
    this.shieldFill = h('div', 'gf-bar__fill', sTrack);
    h('i', 'gf-bar__shatter', sTrack);
    this.shieldVal = h('span', 'gf-bar__val', this.shieldBar);

    this.hpBar = h('div', 'gf-bar gf-bar--hp', bars);
    const hTrack = h('div', 'gf-bar__track', this.hpBar);
    this.hpTrail = h('div', 'gf-bar__trail', hTrack);
    this.hpFill = h('div', 'gf-bar__fill', hTrack);
    const val = h('span', 'gf-bar__val', this.hpBar);
    this.hpVal = h('b', null, val);
    this.hpMaxEl = h('small', null, val);
  }

  reset(): void {
    this.hpFrac = this.shFrac = -1;
    this.hpTrailV = this.shTrailV = 1;
    this.hpInt = this.maxInt = this.shInt = -1;
  }

  shieldBroken(): void {
    this.shieldBar.classList.remove('is-broken');
    void this.shieldBar.offsetWidth;
    this.shieldBar.classList.add('is-broken');
  }

  update(now: number): void {
    const p = this.ctx.player;
    const step = Math.min(100, Math.max(0, now - this.lastNow));
    this.lastNow = now;

    const hero = p.hero;
    const heroId = hero?.id ?? '';
    if (heroId !== this.heroId) {
      this.heroId = heroId;
      this.glyph.textContent = heroGlyph(hero);
      this.root.style.setProperty('--hero', heroColor(hero));
    }

    // 防御性：任何一方写出 NaN 时 HUD 不显示「NaN」
    const maxHp = Math.max(1, finite(p.maxHp(), 1));
    const hp = clamp(finite(p.hp, 0), 0, maxHp);
    const maxSh = Math.max(0, finite(p.maxShield(), 0));
    const sh = clamp(finite(p.shield, 0), 0, maxSh);

    const hpInt = Math.ceil(hp);
    if (hpInt !== this.hpInt) {
      this.hpInt = hpInt;
      this.hpVal.textContent = String(hpInt);
    }
    const maxInt = Math.round(maxHp);
    if (maxInt !== this.maxInt) {
      this.maxInt = maxInt;
      this.hpMaxEl.textContent = ` / ${maxInt}`;
    }
    const shInt = Math.ceil(sh);
    if (shInt !== this.shInt) {
      this.shInt = shInt;
      this.shieldVal.textContent = String(shInt);
    }
    const noShield = maxSh <= 0;
    if (noShield !== this.noShield) {
      this.noShield = noShield;
      this.shieldBar.classList.toggle('is-none', noShield);
    }

    // 生命：延迟掉血
    const hf = hp / maxHp;
    if (Math.abs(hf - this.hpFrac) > 0.0008) {
      if (hf < this.hpFrac) this.hpHold = now + TRAIL_HOLD;
      this.hpFrac = hf;
      this.hpFill.style.transform = `scaleX(${hf.toFixed(4)})`;
    }
    this.hpTrailV = this.trail(this.hpTrailV, hf, now >= this.hpHold, step, this.hpTrail);

    const sf = maxSh > 0 ? sh / maxSh : 0;
    if (Math.abs(sf - this.shFrac) > 0.0008) {
      if (sf < this.shFrac) this.shHold = now + TRAIL_HOLD * 0.6;
      this.shFrac = sf;
      this.shieldFill.style.transform = `scaleX(${sf.toFixed(4)})`;
    }
    this.shTrailV = this.trail(this.shTrailV, sf, now >= this.shHold, step, this.shieldTrail);

    const low = p.alive && hf < 0.3;
    if (low !== this.low) {
      this.low = low;
      this.hpBar.classList.toggle('is-low', low);
      this.crest.classList.toggle('is-low', low);
    }
  }

  private trail(cur: number, target: number, release: boolean, stepMs: number, el: HTMLDivElement): number {
    let v = cur;
    if (v < target) v = target;
    else if (v > target && release) v = Math.max(target, v - stepMs * 0.0012);
    if (v !== cur) el.style.transform = `scaleX(${v.toFixed(4)})`;
    return v;
  }
}

// ───────────────────────────── 武器 ─────────────────────────────

/** 双形态武器没有给出形态名时的兜底 [近战, 远程] */
const DEFAULT_FORM_NAMES: readonly [string, string] = ['近战', '远程'];
/** 形态徽记下的「右键 ⇄ 另一形态」提示：本次会话前几次变形后淡出 */
const FORM_HINT_MORPHS = 5;
/** 本次会话已变形的次数（跨关卡 / 跨局保留，提示只教一次） */
let formHintMorphs = 0;

/**
 * 武器槽。双形态 / 召回武器（魔刀千刃，`IWeaponSystem.activeForm !== null`）额外显示：
 * 形态徽记（斩 / 千刃）、近战形态弹药 ∞ + 「刃 N」回刃进度、远程形态备弹 ∞ 与「召回」提示、
 * 变形中徽记翻转（is-morphing）、换形一击窗口边框发光（is-strike）。新字段全部可选，缺省按普通武器显示。
 */
class WeaponPanel {
  readonly root: HTMLDivElement;
  private main: HTMLDivElement;
  private formEl: HTMLSpanElement;
  private formHintEl: HTMLDivElement;
  private elemEl: HTMLSpanElement;
  private nameEl: HTMLSpanElement;
  private lvlEl: HTMLSpanElement;
  private magEl: HTMLSpanElement;
  private sepEl: HTMLSpanElement;
  private reserveEl: HTMLSpanElement;
  private reloadRow: HTMLDivElement;
  private reloadFill: HTMLDivElement;
  private hintEl: HTMLSpanElement;
  private secRoot: HTMLDivElement;
  private secName: HTMLSpanElement;
  private secElem: HTMLSpanElement;

  // 上次显示的武器（逐字段比较，避免每帧拼接字符串）
  private uid = -2;
  private lvl = -1;
  private rar = -1;
  private elem = '';
  private aff = -1;
  private sUid = -2;
  private sLvl = -1;
  private sRar = -1;
  private sElem = '';
  private mag = -1;
  private cap = -1;
  private reserve = -1;
  private infinite = false;
  private low = false;
  private hint = '';
  private reloadQ = -2;
  private hasWeapon = true;
  /** 当前显示的形态（null = 普通武器）与形态名（随武器变化从 describe 取） */
  private form: WeaponForm | null = null;
  private formNames: readonly [string, string] = DEFAULT_FORM_NAMES;
  private morphing = false;
  private strike = false;

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-weapon', parent);
    this.secRoot = h('div', 'gf-weapon__sec', this.root);
    h('span', 'gf-weapon__seckey', this.secRoot, 'X');
    this.secElem = h('span', 'gf-weapon__elem gf-weapon__elem--sm', this.secRoot);
    this.secName = h('span', 'gf-weapon__secname', this.secRoot);

    this.main = h('div', 'gf-weapon__main', this.root);
    const title = h('div', 'gf-weapon__title', this.main);
    this.formEl = h('span', 'gf-weapon__form', title);
    this.formEl.hidden = true;
    this.elemEl = h('span', 'gf-weapon__elem', title);
    this.nameEl = h('span', 'gf-weapon__name', title);
    this.lvlEl = h('span', 'gf-weapon__lvl', title);
    // 双形态：徽记下方「右键 ⇄ 另一形态」（新玩家不知道右键已经不是开镜），前几次变形后淡出
    this.formHintEl = h('div', 'gf-weapon__formhint', this.main);
    this.formHintEl.hidden = true;

    const ammo = h('div', 'gf-weapon__ammo', this.main);
    this.magEl = h('span', 'gf-weapon__mag', ammo);
    this.sepEl = h('span', 'gf-weapon__sep', ammo, '/');
    this.reserveEl = h('span', 'gf-weapon__reserve', ammo);

    this.reloadRow = h('div', 'gf-weapon__reload', this.main);
    const track = h('div', 'gf-weapon__reloadtrack', this.reloadRow);
    this.reloadFill = h('div', 'gf-weapon__reloadfill', track);
    this.hintEl = h('span', 'gf-weapon__hint', this.reloadRow);
  }

  pulse(): void {
    this.main.animate(
      [{ transform: 'translateX(14px)', opacity: 0.3 }, { transform: 'translateX(0)', opacity: 1 }],
      { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }

  /** 切换形态：武器槽提亮一下（与切枪的横移区分开；徽记翻转由 is-morphing 的 CSS 动画负责） */
  morphPulse(): void {
    this.main.animate([{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 320, easing: 'ease-out' });
  }

  /** 变形计数：够 FORM_HINT_MORPHS 次后右键提示淡出（不再显示） */
  onMorph(): void {
    if (formHintMorphs >= FORM_HINT_MORPHS) return;
    formHintMorphs++;
    if (formHintMorphs >= FORM_HINT_MORPHS) this.formHintEl.classList.add('is-off');
  }

  /** 右键提示：「右键 ⇄ 另一形态名」；普通武器隐藏。已学会（is-off）时由 CSS 淡出并收起高度 */
  private syncFormHint(form: WeaponForm | null): void {
    this.formHintEl.hidden = form === null;
    this.formHintEl.classList.toggle('is-off', formHintMorphs >= FORM_HINT_MORPHS);
    if (form !== null) this.formHintEl.textContent = `右键 ⇄ ${this.formNames[form === 'melee' ? 1 : 0]}`;
  }

  reset(): void {
    this.uid = this.sUid = -2;
    this.mag = this.cap = this.reserve = -1;
    this.reloadQ = -2;
    this.hint = '\u0000';
  }

  update(): void {
    const ws = this.ctx.weapons;
    const w = ws.active;
    const has = !!w;
    if (has !== this.hasWeapon) {
      this.hasWeapon = has;
      this.main.classList.toggle('is-empty', !has);
    }
    if (w) this.syncMain(w);
    else if (this.uid !== -1) {
      this.uid = -1;
      this.nameEl.textContent = '空手';
      this.elemEl.hidden = true;
      this.lvlEl.hidden = true;
      this.setForm(null);
      this.setMorphState(false, false);
      this.magEl.textContent = '–';
      this.reserveEl.textContent = '–';
      // 下次拿到武器时强制重写弹药数字
      this.mag = this.reserve = -1;
    }

    // 副武器
    const other = ws.slots[ws.activeSlot === 0 ? 1 : 0] ?? null;
    const sUid = other ? other.uid : -1;
    if (sUid !== this.sUid || (other && (other.level !== this.sLvl || other.rarity !== this.sRar || other.element !== this.sElem))) {
      this.sUid = sUid;
      this.sLvl = other ? other.level : -1;
      this.sRar = other ? other.rarity : -1;
      this.sElem = other ? other.element : '';
      this.secRoot.hidden = !other;
      if (other) {
        const d = this.describe(other);
        this.secName.textContent = other.level > 0 ? `${d.name} +${other.level}` : d.name;
        this.secRoot.style.setProperty('--rarity', d.color);
        this.setElem(this.secElem, other, d.elementLabel);
      }
    }

    // 换弹进度与提示
    const reloading = ws.isReloading;
    const q = reloading ? Math.round(clamp01(ws.reloadProgress) * 100) : -1;
    if (q !== this.reloadQ) {
      if ((q >= 0) !== (this.reloadQ >= 0)) this.reloadRow.classList.toggle('is-reloading', q >= 0);
      this.reloadQ = q;
      if (q >= 0) this.reloadFill.style.transform = `scaleX(${(q / 100).toFixed(2)})`;
    }
    // 召回式武器（远程形态）：换弹 = 召回、打空提示按 R 召回，永不「弹药耗尽」；近战形态不耗弹、无提示
    let hint = '';
    const form = w ? this.form : null;
    if (reloading) hint = form === 'ranged' ? '召回中' : '换弹中';
    else if (w && form === 'ranged' && this.mag === 0) hint = '按 R 召回';
    else if (w && form === null && !this.infinite && this.mag === 0) hint = this.reserve > 0 ? '按 R 换弹' : '弹药耗尽';
    if (hint !== this.hint) {
      this.hint = hint;
      this.hintEl.textContent = hint;
      this.reloadRow.classList.toggle('has-hint', !!hint);
      this.reloadRow.classList.toggle('is-alert', hint === '按 R 换弹' || hint === '弹药耗尽' || hint === '按 R 召回');
    }
  }

  private syncMain(w: WeaponInstance): void {
    const ws = this.ctx.weapons;
    let named = false;
    if (w.uid !== this.uid || w.level !== this.lvl || w.rarity !== this.rar || w.element !== this.elem || w.affixes.length !== this.aff) {
      this.uid = w.uid;
      this.lvl = w.level;
      this.rar = w.rarity;
      this.elem = w.element;
      this.aff = w.affixes.length;
      const d = this.describe(w);
      this.nameEl.textContent = d.name;
      this.main.style.setProperty('--rarity', d.color);
      this.lvlEl.hidden = w.level <= 0;
      this.lvlEl.textContent = `+${w.level}`;
      this.setElem(this.elemEl, w, d.elementLabel);
      this.formNames = d.formNames ?? DEFAULT_FORM_NAMES;
      named = true;
    }

    // 形态（双形态武器）：徽记、变形中、换形一击窗口
    const form = ws.activeForm ?? null;
    if (form !== this.form || named) this.setForm(form);
    this.setMorphState(
      form !== null && (ws.formMorphProgress ?? 1) < 1,
      form !== null && (ws.formStrikeTime ?? 0) > 0,
    );

    const cap = Math.max(1, ws.magCapacity(w));
    const mag = Math.max(0, Math.floor(w.mag));
    const reserve = Math.max(0, Math.floor(w.reserve));
    const infinite = (this.ctx.run.flags.infiniteAmmo ?? 0) > 0;
    if (form === 'melee') {
      // 近战形态不耗弹：主数字 ∞（缩小），备弹位置显示弹匣里的飞刃数（回刃进度，放大并按储量着色）
      if (mag !== this.mag || cap !== this.cap) {
        this.mag = mag;
        this.magEl.textContent = '∞';
        this.reserveEl.textContent = `刃 ${mag}`;
        this.reserveEl.style.setProperty('--fill', clamp01(mag / cap).toFixed(2));
      }
    } else {
      if (mag !== this.mag) {
        this.mag = mag;
        this.magEl.textContent = String(mag);
      }
      // 召回式武器不需要备弹：恒显示 ∞（-3 为它的缓存标记）
      const rv = form === 'ranged' ? -3 : reserve;
      if (rv !== this.reserve || infinite !== this.infinite) {
        this.reserve = rv;
        this.reserveEl.textContent = infinite || form === 'ranged' ? '∞' : String(reserve);
      }
    }
    if (infinite !== this.infinite) {
      this.infinite = infinite;
      this.main.classList.toggle('is-infinite', infinite);
    }
    const low = form !== 'melee' && !infinite && mag <= Math.max(1, Math.ceil(cap * 0.25));
    if (low !== this.low || cap !== this.cap) {
      this.low = low;
      this.cap = cap;
      this.magEl.classList.toggle('is-low', low);
    }
  }

  /** 形态显示切换（含切到普通武器 / 空手时 form = null）：徽记、弹药显示方式 */
  private setForm(form: WeaponForm | null): void {
    const changed = form !== this.form;
    this.form = form;
    this.formEl.hidden = form === null;
    if (form !== null) this.formEl.textContent = this.formNames[form === 'melee' ? 0 : 1];
    this.syncFormHint(form);
    if (!changed) return;
    this.formEl.classList.toggle('is-melee', form === 'melee');
    this.formEl.classList.toggle('is-ranged', form === 'ranged');
    this.magEl.classList.toggle('is-inf', form === 'melee');
    this.sepEl.hidden = form === 'melee';
    this.reserveEl.classList.toggle('is-blades', form === 'melee');
    // 弹药的显示方式随形态变化：强制重写
    this.mag = this.reserve = -1;
  }

  private setMorphState(morphing: boolean, strike: boolean): void {
    if (morphing !== this.morphing) {
      this.morphing = morphing;
      this.main.classList.toggle('is-morphing', morphing);
    }
    if (strike !== this.strike) {
      this.strike = strike;
      this.main.classList.toggle('is-strike', strike);
    }
  }

  /**
   * 元素徽记：武器描述给出特殊元素显示（如三才转轮的「三相」）时取其首字并加 is-tri（三色渐变），
   * 否则沿用元素单字。只在武器变化时调用（见 syncMain / 副武器的缓存条件）。
   */
  private setElem(el: HTMLSpanElement, w: WeaponInstance, label: string | undefined): void {
    el.hidden = !label && w.element === 'none';
    el.classList.toggle('is-tri', !!label);
    if (label) {
      el.textContent = label.charAt(0);
    } else if (w.element !== 'none') {
      el.textContent = ELEMENT_GLYPH[w.element];
      el.style.setProperty('--elem', elementCss(w.element));
    }
  }

  private describe(w: WeaponInstance): { name: string; color: string; elementLabel?: string; formNames?: [string, string] } {
    try {
      const d = this.ctx.weapons.describe(w);
      return {
        name: d.name || weaponName(w.defId),
        color: d.color || RARITY_CSS[w.rarity] || RARITY_CSS[0],
        elementLabel: d.elementLabel || undefined,
        formNames: d.formNames,
      };
    } catch {
      return { name: weaponName(w.defId), color: RARITY_CSS[w.rarity] || RARITY_CSS[0] };
    }
  }
}

// ───────────────────────────── 技能 ─────────────────────────────

const RING_R = 27;
const RING_C = 2 * Math.PI * RING_R;

/** 圆盘 + SVG 冷却环（SkillIcon / WeaponSkillIcon 共用结构），返回进度圆 */
function buildRing(disc: HTMLElement): SVGCircleElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'gf-skill__ring');
  const track = document.createElementNS(SVG_NS, 'circle');
  track.setAttribute('class', 'gf-skill__track');
  const prog = document.createElementNS(SVG_NS, 'circle');
  prog.setAttribute('class', 'gf-skill__prog');
  for (const c of [track, prog]) {
    c.setAttribute('cx', '32');
    c.setAttribute('cy', '32');
    c.setAttribute('r', String(RING_R));
    svg.appendChild(c);
  }
  prog.style.strokeDasharray = RING_C.toFixed(2);
  disc.appendChild(svg);
  return prog;
}

/** 冷却秒数的显示量化：≥ 1 秒取整，< 1 秒保留一位小数；-1 = 不显示 */
function cooldownQ(rem: number): number {
  return rem > 0 ? (rem >= 1 ? Math.ceil(rem) : Math.ceil(rem * 10) / 10) : -1;
}

function cooldownText(q: number): string {
  return q < 0 ? '' : q >= 1 ? String(q) : q.toFixed(1);
}

class SkillIcon {
  readonly root: HTMLDivElement;
  private ring: SVGCircleElement;
  private glyphEl: HTMLSpanElement;
  private cdEl: HTMLSpanElement;
  private chargesEl: HTMLSpanElement;
  private nameEl: HTMLDivElement;

  private defId = '\u0000';
  private charges = -1;
  private maxCharges = -1;
  private prog = -1;
  private cdQ = -2;
  private active = false;
  private empty = false;
  private present = true;

  constructor(parent: HTMLElement, key: string, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-skill', parent);
    const disc = h('div', 'gf-skill__disc', this.root);
    this.ring = buildRing(disc);
    this.glyphEl = h('span', 'gf-skill__glyph', disc);
    this.cdEl = h('span', 'gf-skill__cd', disc);
    this.chargesEl = h('span', 'gf-skill__charges', disc);
    h('span', 'gf-skill__key', disc, key);
    this.nameEl = h('div', 'gf-skill__name', this.root);
  }

  flash(): void {
    this.root.animate([{ filter: 'brightness(2.2)', transform: 'scale(1.12)' }, { filter: 'brightness(1)', transform: 'scale(1)' }], {
      duration: 320,
      easing: 'ease-out',
    });
  }

  reset(): void {
    this.defId = '\u0000';
    this.charges = this.maxCharges = -1;
    this.prog = -1;
    this.cdQ = -2;
  }

  update(s: SkillState | null): void {
    const present = !!s;
    if (present !== this.present) {
      this.present = present;
      this.root.hidden = !present;
    }
    if (!s) return;

    if (s.def.id !== this.defId) {
      this.defId = s.def.id;
      const name = s.def.name || '技能';
      this.glyphEl.textContent = name.charAt(0);
      this.nameEl.textContent = name;
      this.root.title = s.def.description || name;
    }
    const maxC = Math.max(1, s.maxCharges);
    if (s.charges !== this.charges || maxC !== this.maxCharges) {
      // 充能恢复时闪一下
      if (this.charges >= 0 && s.charges > this.charges) this.flash();
      this.charges = s.charges;
      this.maxCharges = maxC;
      this.chargesEl.hidden = maxC <= 1;
      this.chargesEl.textContent = String(s.charges);
    }
    const rem = Math.max(0, s.cooldownRemaining);
    const total = s.cooldownTotal > 0 ? s.cooldownTotal : s.def.cooldown;
    const prog = rem > 0 && total > 0 ? Math.round(clamp01(1 - rem / total) * 200) / 200 : 1;
    if (prog !== this.prog) {
      this.prog = prog;
      this.ring.style.strokeDashoffset = (RING_C * (1 - prog)).toFixed(2);
    }
    const empty = s.charges <= 0;
    if (empty !== this.empty) {
      this.empty = empty;
      this.root.classList.toggle('is-cooling', empty);
    }
    const cdQ = empty ? cooldownQ(rem) : -1;
    if (cdQ !== this.cdQ) {
      this.cdQ = cdQ;
      this.cdEl.textContent = cooldownText(cdQ);
    }
    let active = false;
    try {
      active = !!s.def.isActive?.(this.ctx);
    } catch {
      active = false;
    }
    if (active !== this.active) {
      this.active = active;
      this.root.classList.toggle('is-active', active);
    }
  }
}

/**
 * 武器技能图标（魔刀千刃「千刃·无间」，docs/demon-blade.md 10.9）：结构与 SkillIcon 相同
 * （圆盘 + 冷却环 + 单字 + 冷却秒数 + 按键角标），放在右下角武器槽左侧。
 * 当前武器没有武器技能（IWeaponSystem.weaponSkill 为 null 或未提供）时隐藏；冷却转好时闪一下。
 */
class WeaponSkillIcon {
  readonly root: HTMLDivElement;
  private ring: SVGCircleElement;
  private glyphEl: HTMLSpanElement;
  private cdEl: HTMLSpanElement;
  private keyEl: HTMLSpanElement;
  private nameEl: HTMLDivElement;

  private id = '\u0000';
  private prog = -1;
  private cdQ = -2;
  private cooling = false;
  private active = false;
  private present = true;
  /** 上一帧的剩余冷却；-1 = 刚出现 / 刚重置（不触发就绪闪光） */
  private lastRem = -1;

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-skill gf-wskill', parent);
    const disc = h('div', 'gf-skill__disc', this.root);
    this.ring = buildRing(disc);
    this.glyphEl = h('span', 'gf-skill__glyph', disc);
    this.cdEl = h('span', 'gf-skill__cd', disc);
    this.keyEl = h('span', 'gf-skill__key', disc, 'V');
    this.nameEl = h('div', 'gf-skill__name', this.root);
    this.update(null);
  }

  flash(): void {
    if (!this.present) return;
    this.root.animate([{ filter: 'brightness(2.2)', transform: 'scale(1.12)' }, { filter: 'brightness(1)', transform: 'scale(1)' }], {
      duration: 320,
      easing: 'ease-out',
    });
  }

  reset(): void {
    this.id = '\u0000';
    this.prog = -1;
    this.cdQ = -2;
    this.lastRem = -1;
  }

  update(s: WeaponSkillState | null): void {
    const present = !!s;
    if (present !== this.present) {
      this.present = present;
      this.root.hidden = !present;
      this.lastRem = -1;
    }
    if (!s) return;

    if (s.id !== this.id) {
      this.id = s.id;
      const name = s.name || '武器技能';
      this.glyphEl.textContent = s.glyph || name.charAt(0);
      this.nameEl.textContent = name;
      this.keyEl.textContent = s.key || 'V';
      this.root.title = this.describe(name);
    }
    const rem = Math.max(0, s.cooldownRemaining);
    const total = s.cooldownTotal;
    const prog = rem > 0 && total > 0 ? Math.round(clamp01(1 - rem / total) * 200) / 200 : rem > 0 ? 0 : 1;
    if (prog !== this.prog) {
      this.prog = prog;
      this.ring.style.strokeDashoffset = (RING_C * (1 - prog)).toFixed(2);
    }
    const cooling = rem > 0;
    if (cooling !== this.cooling) {
      this.cooling = cooling;
      this.root.classList.toggle('is-cooling', cooling);
    }
    // 冷却转好：闪一下提示可以再放
    if (this.lastRem > 0 && !cooling) this.flash();
    this.lastRem = rem;
    const cdQ = cooldownQ(rem);
    if (cdQ !== this.cdQ) {
      this.cdQ = cdQ;
      this.cdEl.textContent = cooldownText(cdQ);
    }
    const active = !!s.active;
    if (active !== this.active) {
      this.active = active;
      this.root.classList.toggle('is-active', active);
    }
  }

  /** 悬停说明：技能描述（只在技能变化时取一次 describe） */
  private describe(name: string): string {
    try {
      const ws = this.ctx.weapons;
      const w = ws.active;
      const sk = w ? ws.describe(w).skill : undefined;
      if (sk) return `${sk.name}（${sk.key} / 鼠标中键）：${sk.description}`;
    } catch {
      // 描述失败不影响图标本身
    }
    return name;
  }
}

class DashPips {
  readonly root: HTMLDivElement;
  private pips: { el: HTMLElement; fill: HTMLElement; q: number }[] = [];
  private max = -1;

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-dash', parent);
    this.root.title = '冲刺充能（Shift）';
  }

  reset(): void {
    this.max = -1;
  }

  update(): void {
    const p = this.ctx.player;
    const max = clamp(Math.round(p.stats.get('dashCharges')), 1, 6);
    if (max !== this.max) {
      this.max = max;
      while (this.pips.length < max) {
        const el = h('i', 'gf-dash__pip', this.root);
        const fill = h('b', 'gf-dash__fill', el);
        this.pips.push({ el, fill, q: -1 });
      }
      this.pips.forEach((pip, i) => {
        pip.el.hidden = i >= max;
        pip.q = -1;
      });
    }
    const charges = clamp(Math.floor(p.dashCharges), 0, max);
    // 与 PlayerController 一致：实际冷却下限 0.2 秒
    const total = Math.max(0.2, p.stats.get('dashCooldown') || 0);
    const partial = clamp01(1 - p.dashCooldownRemaining / total);
    for (let i = 0; i < max; i++) {
      const pip = this.pips[i];
      const q = i < charges ? 1 : i === charges ? Math.round(partial * 20) / 20 : 0;
      if (q === pip.q) continue;
      pip.q = q;
      pip.fill.style.transform = `scale(${q.toFixed(2)})`;
      pip.el.classList.toggle('is-full', q >= 1);
    }
  }
}

// ───────────────────────────── 右上角信息 ─────────────────────────────

class InfoPanel {
  readonly root: HTMLDivElement;
  private fpsEl: HTMLDivElement;
  private stageEl: HTMLDivElement;
  private waveEl: HTMLSpanElement;
  private enemyWrap: HTMLSpanElement;
  private enemyNum: HTMLSpanElement;
  private coinsWrap: HTMLSpanElement;
  private coinsNum: HTMLSpanElement;
  private essNum: HTMLSpanElement;
  private floatEl: HTMLSpanElement;

  private stageRef: StageNode | null = null;
  private waveKey = -2;
  private alive = -1;
  private cleared: boolean | null = null;
  private coins = -1;
  private ess = -1;
  private fps = -1;
  private debug: boolean | null = null;

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-info', parent);
    this.fpsEl = h('div', 'gf-info__fps', this.root);
    this.stageEl = h('div', 'gf-info__stage', this.root);
    const row = h('div', 'gf-info__row', this.root);
    this.waveEl = h('span', 'gf-info__wave', row);
    this.enemyWrap = h('span', 'gf-info__enemies', row);
    icon(ICON_BLADES, 'gf-icon', this.enemyWrap);
    this.enemyNum = h('span', null, this.enemyWrap);
    const purse = h('div', 'gf-info__purse', this.root);
    this.coinsWrap = h('span', 'gf-info__coins', purse);
    icon(ICON_COIN, 'gf-icon gf-icon--coin', this.coinsWrap);
    this.coinsNum = h('span', null, this.coinsWrap);
    this.floatEl = h('span', 'gf-info__float', this.coinsWrap);
    const ess = h('span', 'gf-info__ess', purse);
    icon(ICON_ESSENCE, 'gf-icon gf-icon--essence', ess);
    this.essNum = h('span', null, ess);
    ess.title = '本局获得的魂晶';
  }

  reset(): void {
    this.stageRef = null;
    this.waveKey = -2;
    this.alive = -1;
    this.cleared = null;
    this.coins = this.ess = -1;
  }

  onCoins(delta: number): void {
    if (!delta) return;
    this.floatEl.textContent = delta > 0 ? `+${delta}` : String(delta);
    this.floatEl.classList.toggle('is-neg', delta < 0);
    this.floatEl.getAnimations().forEach((a) => a.cancel());
    this.floatEl.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)', offset: 0.2 },
        { opacity: 0, transform: 'translateY(-14px)' },
      ],
      { duration: 900, easing: 'ease-out' },
    );
    this.coinsWrap.animate([{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
  }

  update(): void {
    const ctx = this.ctx;
    const debug = ctx.game.debug;
    if (debug !== this.debug) {
      this.debug = debug;
      this.fpsEl.hidden = !debug;
    }
    if (debug) {
      const fps = Math.round(ctx.game.fps);
      if (fps !== this.fps) {
        this.fps = fps;
        this.fpsEl.textContent = `FPS ${fps}`;
      }
    }

    const node = ctx.run.stage;
    if (node !== this.stageRef) {
      this.stageRef = node;
      let label = '';
      try {
        label = ctx.runPlan.stageLabel(node);
      } catch {
        label = `第${node.chapter + 1}章 · 第${node.index + 1}关`;
      }
      this.stageEl.textContent = label;
      this.stageEl.dataset.type = node.type;
    }

    const st = ctx.stage;
    // 契约：纯 Boss 关 waveCount 为 0，此时不显示波次；首领关额外按节点类型兜底（显示「第 1 / 1 波」没有意义）
    const count = node.type === 'boss' ? 0 : Math.max(0, st.waveCount | 0);
    const idx = clamp((st.waveIndex | 0) + 1, 1, Math.max(1, count));
    const waveKey = count === 0 ? -1 : idx * 100 + count;
    if (waveKey !== this.waveKey) {
      const grew = this.waveKey > 0 && waveKey > this.waveKey;
      this.waveKey = waveKey;
      this.waveEl.hidden = count === 0;
      if (count > 0) this.waveEl.textContent = `第 ${idx} / ${count} 波`;
      if (grew) this.waveEl.animate([{ color: '#fff3c4', transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
    }

    const cleared = !!st.cleared;
    const alive = ctx.enemies.aliveCount();
    if (alive !== this.alive || cleared !== this.cleared) {
      this.alive = alive;
      this.cleared = cleared;
      const showCount = alive > 0 || (count > 0 && !cleared);
      this.enemyWrap.hidden = !showCount && !(cleared && count > 0);
      this.enemyWrap.classList.toggle('is-cleared', cleared && alive === 0);
      this.enemyNum.textContent = cleared && alive === 0 ? '已肃清' : `余敌 ${alive}`;
    }

    const coins = Math.floor(ctx.run.coins);
    if (coins !== this.coins) {
      this.coins = coins;
      this.coinsNum.textContent = formatNum(coins);
    }
    const ess = Math.floor(ctx.run.essence);
    if (ess !== this.ess) {
      this.ess = ess;
      this.essNum.textContent = formatNum(ess);
    }
  }
}

// ───────────────────────────── HUD 根 ─────────────────────────────

export class HUD {
  readonly root: HTMLDivElement;
  private vitals: Vitals;
  private weapon: WeaponPanel;
  private wskill: WeaponSkillIcon;
  private skillQ: SkillIcon;
  private skillE: SkillIcon;
  private dash: DashPips;
  private info: InfoPanel;
  private crosshair: Crosshair;
  private bars: EnemyBars;
  readonly boss: BossBar;
  private tab: InventoryPanel;
  private visible = false;
  private failed = new Set<string>();

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-hud', parent);
    this.root.hidden = true;
    this.bars = new EnemyBars(this.root, ctx);
    this.crosshair = new Crosshair(this.root, ctx);

    const bl = h('div', 'gf-hud__corner gf-hud__corner--bl', this.root);
    this.vitals = new Vitals(bl, ctx);
    const br = h('div', 'gf-hud__corner gf-hud__corner--br', this.root);
    // 武器技能图标在武器槽左侧（没有武器技能时隐藏，不占位）
    this.wskill = new WeaponSkillIcon(br, ctx);
    this.weapon = new WeaponPanel(br, ctx);
    const bc = h('div', 'gf-hud__corner gf-hud__corner--bc', this.root);
    const skills = h('div', 'gf-skills', bc);
    this.skillQ = new SkillIcon(skills, 'Q', ctx);
    this.skillE = new SkillIcon(skills, 'E', ctx);
    this.dash = new DashPips(bc, ctx);
    const tr = h('div', 'gf-hud__corner gf-hud__corner--tr', this.root);
    this.info = new InfoPanel(tr, ctx);

    this.boss = new BossBar(this.root);
    this.tab = new InventoryPanel(this.root, ctx);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    if (v) {
      this.reset();
      this.root.hidden = false;
      void this.root.offsetWidth;
      this.root.classList.add('is-open');
    } else {
      this.root.classList.remove('is-open');
      this.root.hidden = true;
      this.tab.setOpen(false, performance.now());
      this.bars.reset();
      this.crosshair.reset();
      this.boss.hideNow();
    }
  }

  /** 新开一局 / 换关：清掉瞬态（血条池、指示器、Boss 条、缓存） */
  reset(): void {
    this.bars.reset();
    this.crosshair.reset();
    this.boss.hideNow();
    this.vitals.reset();
    this.weapon.reset();
    this.wskill.reset();
    this.skillQ.reset();
    this.skillE.reset();
    this.dash.reset();
    this.info.reset();
  }

  // ───────────── 事件入口 ─────────────

  onEnemyDamaged(result: DamageResult): void {
    if (!this.visible) return;
    this.crosshair.onEnemyHit(result, false);
  }

  onEnemyKilled(result: DamageResult): void {
    if (!this.visible) return;
    this.crosshair.onEnemyHit(result, true);
  }

  onPlayerDamaged(amount: number, toHp: number, from: THREE.Vector3 | null, source: IEnemy | null): void {
    if (!this.visible) return;
    this.crosshair.onPlayerDamaged(amount, toHp, from, source);
  }

  onShieldBroken(): void {
    if (this.visible) this.vitals.shieldBroken();
  }

  onCoins(delta: number): void {
    if (this.visible) this.info.onCoins(delta);
  }

  onSkillUsed(slot: 'primary' | 'secondary'): void {
    if (this.visible) (slot === 'primary' ? this.skillQ : this.skillE).flash();
  }

  onWeaponSwitched(): void {
    if (this.visible) this.weapon.pulse();
  }

  /** 释放武器技能（weapon:skillUsed） */
  onWeaponSkillUsed(): void {
    if (this.visible) this.wskill.flash();
  }

  /** 双形态武器开始切换形态（weapon:formChanged） */
  onWeaponFormChanged(): void {
    this.weapon.onMorph();
    if (this.visible) this.weapon.morphPulse();
  }

  /** 千刃贯穿结算（weapon:skillImpale）：朱红暗角闪 + 视野外刃印的方向刃光 */
  onWeaponImpale(points: readonly THREE.Vector3[]): void {
    if (this.visible) this.crosshair.onBladeImpale(points);
  }

  // ───────────── 每帧 ─────────────

  update(dt: number, now: number, state: GameState): void {
    if (!this.visible) return;
    const ctx = this.ctx;
    try { this.vitals.update(now); } catch (e) { this.fail('vitals', e); }
    try { this.weapon.update(); } catch (e) { this.fail('weapon', e); }
    try { this.wskill.update(ctx.weapons.weaponSkill ?? null); } catch (e) { this.fail('weaponSkill', e); }
    try {
      this.skillQ.update(ctx.player.skills.primary);
      this.skillE.update(ctx.player.skills.secondary);
      this.dash.update();
    } catch (e) { this.fail('skills', e); }
    try { this.info.update(); } catch (e) { this.fail('info', e); }
    try { this.crosshair.update(dt, now, state === 'playing'); } catch (e) { this.fail('crosshair', e); }
    try { this.bars.update(now); } catch (e) { this.fail('enemyBars', e); }
    try { this.boss.update(now); } catch (e) { this.fail('boss', e); }
    try {
      this.tab.setOpen(state === 'playing' && ctx.input.down('inventory'), now);
      this.tab.update(now);
    } catch (e) { this.fail('tab', e); }
  }

  /** 单个部件出错只打印一次，不影响其他部件 */
  private fail(part: string, err: unknown): void {
    if (this.failed.has(part)) return;
    this.failed.add(part);
    console.error(`[UI] HUD 部件 ${part} 更新失败`, err);
  }
}
