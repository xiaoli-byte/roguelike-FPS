/**
 * 伤害数字与世界浮字（照译 Unity G/UI/Widgets/DamageNumbers.cs）：标签对象池（80 个，数字字体），每帧把世界锚点投影到 HUD 面板，
 * 上浮 + 随机漂移 + 淡出，相机背后 / 屏外隐藏。
 *   聚合：同一帧打在同一个敌人、同一层、同一元素、同为 / 同不为持续伤害的命中先合成一笔（combat/Feedback 已经按帧合过；这里再按目标合一次）；
 *     再按「同一个目标」并进还在合并窗口里的旧数字（直接命中 0.45 s；持续伤害跳伤间隔 ≤ 0.75 s、最长 4 s），合并时弹一下、锚点向新命中点靠拢——
 *     旧的 fx/DamageNumbers 没有目标身份只能按距离 / 跳伤节拍猜，这里直接认敌人（Feedback 把敌人放进 opts.target），挨在一起的两个敌人不会被加到一起。
 *   每帧最多新出 24 个（多出来的并不进去就丢掉），池满了回收最老的。
 *   颜色：护盾层青、护甲层金、生命层白；带元素的取元素色；无元素的暴击亮金；免疫灰；字号 / 动画：暴击更大、金色描边发光、弹跳缩放；
 *   持续伤害小一号、压暗、半透明、不弹跳，只上浮一点后停住、锚点平滑跟随目标。
 *   开关：设置「伤害数字」关掉时清掉并不再出（反应名这类世界浮字照常）。
 *   世界浮字（反应名「焚雷」、「格挡」）：不参与合并；scale ≥ 1.25 的加墨底描边框，≥ 1.6 再大一号（归墟）。
 * 时间用缩放时间（暂停时数字停住）。
 */
import * as THREE from 'three';
import type { DamageNumberOpts } from '../../core/types';
import { el, setOpacity, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { type RGBA, css, elementColor, rgb } from '../toolkit/UITheme';
import { HudColors, type HudFrame, HudWidget } from './HudWidget';

/** 数字种类：按层（生命 / 护盾 / 护甲）、免疫、格挡、世界浮字；治疗 / 玩家受伤是网页旧调用方的两种（Unity 没有） */
export const Kind = { Health: 0, Shield: 1, Armor: 2, Immune: 3, Blocked: 4, Text: 5, Heal: 6, Player: 7 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export const POOL_SIZE = 80, MAX_SPAWN_PER_FRAME = 24;
const MaxPending = 48;
const MergeWindow = 0.45, DotGap = 0.75, DotMaxAge = 4, DotHold = 0.8, DotFade = 0.3, DotRise = 24, DotRiseTime = 0.5, DotDrift = 32;
const DotAlpha = 0.8, DotDim = 0.78, DotFollow = 10, TextLife = 0.9, MaxShown = 999999;

const ShieldColor = HudColors.ShieldBlue, ArmorColor = HudColors.ArmorGold, ImmuneColor = rgb(0xb9bec8), BlockedColor = rgb(0xc9d0e0);
const CritColor = rgb(0xffe46b), ReactionColor = rgb(0xffd84a), HealColor = rgb(0x6dff8a), PlayerColor = rgb(0xff4a3d);

interface Pending {
  target: object | null;
  pos: THREE.Vector3;
  amount: number;
  crit: boolean;
  dot: boolean;
  element: string;
  kind: Kind;
}

interface DN {
  anchor: HTMLDivElement;
  label: HTMLDivElement;
  active: boolean;
  shown: boolean;
  crit: boolean;
  dot: boolean;
  boxed: boolean;
  kind: Kind;
  element: string;
  target: object | null;
  pos: THREE.Vector3;
  goal: THREE.Vector3;
  offset: THREE.Vector3;
  age: number;
  life: number;
  pop: number;
  driftX: number;
  rise: number;
  amount: number;
  lastHit: number;
  opacity: number;
  scale: number;
  stamp: number;
  cls: string;
  font: UIFontRole;
}

/** 数字颜色：护盾 / 护甲 / 免疫 / 格挡按种类；生命层带元素取元素色；无元素暴击亮金；持续伤害压暗 */
export function colorFor(kind: Kind, element: string, crit: boolean, dot: boolean): RGBA {
  let c: RGBA;
  switch (kind) {
    case Kind.Shield: c = ShieldColor; break;
    case Kind.Armor: c = ArmorColor; break;
    case Kind.Immune: c = ImmuneColor; break;
    case Kind.Blocked: c = BlockedColor; break;
    case Kind.Heal: c = HealColor; break;
    case Kind.Player: c = PlayerColor; break;
    default: c = element !== 'none' ? elementColor(element) : crit ? CritColor : [1, 1, 1, 1];
  }
  if (dot) c = [c[0] * DotDim, c[1] * DotDim, c[2] * DotDim, 1];
  return [c[0], c[1], c[2], 1];
}

/** 数字文字：免疫 / 格挡；不足 1 显示 1；上限 999999 */
export function formatAmount(amount: number, kind: Kind): string {
  if (kind === Kind.Immune) return '免疫';
  if (kind === Kind.Blocked) return '格挡';
  return String(amount < 1 ? 1 : Math.round(Math.min(amount, MaxShown)));
}

/** 网页的 DamageNumberOpts.kind → 种类 */
export function kindOf(kind: DamageNumberOpts['kind']): Kind {
  switch (kind) {
    case 'shield': return Kind.Shield;
    case 'armor': return Kind.Armor;
    case 'immune': return Kind.Immune;
    case 'heal': return Kind.Heal;
    case 'player': return Kind.Player;
    case 'reaction': return Kind.Text;
    default: return Kind.Health;
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const _p = { x: 0, y: 0, z: 0 };
const _half = new THREE.Vector3();

export class DamageNumbers extends HudWidget {
  readonly id = 'damage-numbers';
  override readonly order = 5;

  private readonly pool: DN[] = [];
  private readonly pending: Pending[] = [];
  private stamp = 0;
  private spawnedThisFrame = 0;
  private frame = -1;
  private activeCount = 0;
  /** 统计（测试 / 调试）：出过的数字、并进旧数字的次数、因每帧上限丢掉的次数 */
  spawned = 0;
  merged = 0;
  dropped = 0;

  get ActiveCount(): number {
    return this.activeCount;
  }

  protected build(): HTMLElement {
    const root = el('sf-dn-layer');
    for (let i = 0; i < POOL_SIZE; i++) {
      const anchor = el('sf-dn-anchor', root);
      anchor.style.display = 'none';
      anchor.style.willChange = 'translate';
      const label = text('sf-dn', anchor, '', UIFontRole.Number);
      this.pool.push({
        anchor, label, active: false, shown: false, crit: false, dot: false, boxed: false, kind: Kind.Health, element: 'none', target: null,
        pos: new THREE.Vector3(), goal: new THREE.Vector3(), offset: new THREE.Vector3(),
        age: 0, life: 0, pop: 0, driftX: 0, rise: 0, amount: 0, lastHit: 0, opacity: -1, scale: -1, stamp: 0, cls: 'sf-dn', font: UIFontRole.Number,
      });
    }
    return root;
  }

  override resetState(): void {
    this.clear(true);
  }

  /** 排队一个伤害数字（同帧同目标同层同元素、同为 / 同不为持续伤害的合成一笔，本帧 tick 时刷出） */
  queue(target: object | null, pos: THREE.Vector3, amount: number, crit: boolean, element: string, kind: Kind, dot: boolean): void {
    if (!Number.isFinite(amount) || amount < 0) return;
    if (!Number.isFinite(pos.x + pos.y + pos.z)) return;
    amount = Math.min(amount, MaxShown);
    if (kind !== Kind.Immune && kind !== Kind.Blocked && target) {
      for (const p of this.pending) {
        if (p.target !== target || p.kind !== kind || p.element !== element || p.dot !== dot) continue;
        p.amount = Math.min(MaxShown, p.amount + amount);
        p.crit ||= crit;
        return;
      }
    }
    if (this.pending.length >= MaxPending) this.flush();
    this.pending.push({ target, pos: pos.clone(), amount, crit, element, kind, dot });
  }

  /** 世界浮字（反应名、「格挡」）：不合并；scale ≥ 1.25 加墨底描边框，≥ 1.6 大号 */
  float(world: THREE.Vector3, value: string, color: RGBA | null, scale = 1.3): void {
    if (!value || !Number.isFinite(world.x + world.y + world.z)) return;
    const d = this.take();
    const big = scale >= 1.6, boxed = scale >= 1.25;
    d.active = true;
    d.target = null;
    d.offset.set(rand(-0.1, 0.1), 0, rand(-0.1, 0.1));
    d.pos.copy(world).add(d.offset);
    d.goal.copy(d.pos);
    d.age = d.pop = d.lastHit = 0;
    d.life = TextLife * (boxed ? 1 : 1.2);
    d.driftX = rand(-12, 12);
    d.rise = big ? 46 : 40;
    d.crit = d.dot = false;
    d.kind = Kind.Text;
    d.element = 'none';
    d.amount = 0;
    d.stamp = ++this.stamp;
    d.boxed = boxed;
    this.setClass(d, 'sf-dn' + (boxed ? ' sf-dn--text' : ' sf-dn--say') + (big ? ' sf-dn--big' : scale < 1 ? ' sf-dn--small' : ''));
    this.setFont(d, UIFontRole.Title);
    const col = css(color && color[3] > 0 ? [color[0], color[1], color[2], 1] : ReactionColor);
    d.label.style.color = col;
    d.label.style.borderColor = boxed ? col : '';
    d.label.textContent = value;
    d.opacity = d.scale = -1;
  }

  /** 清掉（textToo = 连世界浮字一起） */
  clear(textToo: boolean): void {
    this.pending.length = 0;
    for (const d of this.pool) if (d.active && (textToo || d.kind !== Kind.Text)) this.hide(d);
  }

  // ───────────── 生成 / 合并 ─────────────

  private flush(): void {
    for (const p of this.pending) this.spawnOrMerge(p);
    this.pending.length = 0;
  }

  private spawnOrMerge(p: Pending): void {
    if (p.kind !== Kind.Immune && p.kind !== Kind.Blocked && p.target) {
      let best: DN | null = null;
      for (const d of this.pool) {
        if (!d.active || d.target !== p.target || d.kind !== p.kind || d.dot !== p.dot || d.crit !== p.crit || d.element !== p.element) continue;
        if (p.dot) {
          if (d.age > DotMaxAge || d.age - d.lastHit > DotGap) continue;
        } else if (d.age > MergeWindow) continue;
        if (!best || d.stamp > best.stamp) best = d;
      }
      if (best) {
        this.merge(best, p);
        return;
      }
    }
    if (this.spawnedThisFrame >= MAX_SPAWN_PER_FRAME) {
      this.dropped++;
      return;
    }
    this.spawnedThisFrame++;
    this.spawn(p);
  }

  private spawn(p: Pending): void {
    const d = this.take();
    const plain = p.kind === Kind.Immune || p.kind === Kind.Blocked;
    const crit = p.crit && !plain;
    const dot = p.dot && !crit && p.kind !== Kind.Immune;
    d.active = true;
    d.target = p.target;
    d.offset.set(rand(-0.175, 0.175), rand(-0.1, 0.1) + 0.15, rand(-0.175, 0.175));
    d.pos.copy(p.pos).add(d.offset);
    d.goal.copy(d.pos);
    d.age = d.pop = d.lastHit = 0;
    d.life = dot ? DotHold : crit ? 1.2 : plain ? 0.8 : 0.95;
    d.driftX = rand(-0.5, 0.5) * (dot ? DotDrift : crit ? 70 : 55);
    d.rise = dot ? DotRise : crit ? 70 : 58;
    d.crit = crit;
    d.dot = dot;
    d.kind = p.kind;
    d.element = p.element;
    d.amount = plain ? 0 : p.amount;
    d.stamp = ++this.stamp;
    d.boxed = false;
    let cls = 'sf-dn';
    if (crit) cls += ' sf-dn--crit';
    else if (dot) cls += ' sf-dn--dot';
    else if (plain) cls += ' sf-dn--immune';
    this.setClass(d, cls);
    this.setFont(d, plain ? UIFontRole.Title : UIFontRole.Number);
    d.label.style.color = css(colorFor(p.kind, p.element, crit, dot));
    d.label.style.borderColor = '';
    d.label.textContent = formatAmount(d.amount, p.kind);
    d.opacity = d.scale = -1;
    this.spawned++;
  }

  private merge(d: DN, p: Pending): void {
    d.amount = Math.min(MaxShown, d.amount + p.amount);
    d.label.textContent = formatAmount(d.amount, d.kind);
    this.merged++;
    if (d.dot) {
      // 持续伤害：不弹跳；最后一跳后再停留 DotHold 秒；锚点平滑跟上
      d.life = Math.max(d.life, d.age + DotHold);
      d.lastHit = d.age;
      d.goal.copy(p.pos).add(d.offset);
      return;
    }
    d.pop = 0;
    d.life = Math.min(d.life + 0.12, d.crit ? 1.6 : 1.3);
    d.lastHit = d.age;
    // 锚点向最新命中点靠拢一半：跟得上移动的敌人，合并时的弹跳掩盖了这一下位移
    _half.copy(d.pos).sub(d.offset).sub(p.pos).multiplyScalar(0.5);
    d.pos.sub(_half);
    d.goal.copy(d.pos);
  }

  private take(): DN {
    let oldest = this.pool[0];
    for (const d of this.pool) {
      if (!d.active) return d;
      if (d.stamp < oldest.stamp) oldest = d;
    }
    this.hide(oldest);
    return oldest;
  }

  private hide(d: DN): void {
    if (!d.active) return;
    d.active = false;
    d.target = null;
    this.setShown(d, false);
  }

  private setShown(d: DN, on: boolean): void {
    if (d.shown === on) return;
    d.shown = on;
    d.anchor.style.display = on ? '' : 'none';
    this.activeCount += on ? 1 : -1;
  }

  private setClass(d: DN, cls: string): void {
    if (d.cls === cls) return;
    d.label.className = 'sf-text ' + cls + (d.font === UIFontRole.Title ? ' sf-title' : ' sf-num');
    d.cls = cls;
  }

  private setFont(d: DN, role: UIFontRole): void {
    if (d.font === role) return;
    d.font = role;
    toggle(d.label, 'sf-title', role === UIFontRole.Title);
    toggle(d.label, 'sf-num', role === UIFontRole.Number);
  }

  // ───────────── 每帧 ─────────────

  override tick(f: HudFrame): void {
    if (f.frame !== this.frame) {
      this.frame = f.frame;
      this.spawnedThisFrame = 0;
    }
    const ctx = this.game;
    if (!ctx.settings.damageNumbers) {
      this.pending.length = 0;
      this.clear(false);
    } else this.flush();

    const dt = f.dt;
    const camPos = ctx.camera.position;
    const size = this.ctx.panelSize;
    for (const d of this.pool) {
      if (!d.active) continue;
      d.age += dt;
      d.pop += dt;
      if (d.age >= d.life) {
        this.hide(d);
        continue;
      }
      if (d.dot && dt > 0) d.pos.lerp(d.goal, 1 - Math.exp(-dt * DotFollow));
      if (!this.ctx.project(d.pos, _p)) {
        this.setShown(d, false);
        continue;
      }
      if (_p.x < -0.1 * size.x || _p.x > 1.1 * size.x || _p.y < -0.1 * size.y || _p.y > 1.1 * size.y) {
        this.setShown(d, false);
        continue;
      }
      const dist = d.pos.distanceTo(camPos);
      const distScale = Math.min(1.15, Math.max(0.62, 1.25 - dist * 0.014));
      let s: number, a: number;
      if (d.dot) {
        // 只在出生后小幅上浮然后停住（合并会延长寿命，位移不能跟着寿命走）；不弹跳；更暗
        const r = Math.min(1, d.age / DotRiseTime);
        const e = 1 - (1 - r) * (1 - r) * (1 - r);
        _p.x += d.driftX * e;
        _p.y -= d.rise * e;
        s = distScale;
        a = Math.min(1, d.age / 0.08) * Math.min(1, (d.life - d.age) / DotFade) * DotAlpha;
      } else {
        const t = d.age / d.life;
        const e = 1 - (1 - t) * (1 - t) * (1 - t);
        _p.x += d.driftX * e;
        _p.y -= d.rise * e;
        const q = d.pop;
        if (d.crit) s = q < 0.07 ? 0.5 + 1.4 * (q / 0.07) : 1 + 0.9 * Math.exp(-(q - 0.07) * 9) * Math.cos((q - 0.07) * 24);
        else s = q < 0.05 ? 0.7 + 0.65 * (q / 0.05) : 1 + 0.35 * Math.exp(-(q - 0.05) * 14);
        s *= d.kind === Kind.Text ? 1 : distScale;
        a = t < 0.62 ? 1 : 1 - (t - 0.62) / 0.38;
      }
      this.setShown(d, true);
      d.anchor.style.translate = `${_p.x.toFixed(1)}px ${_p.y.toFixed(1)}px`;
      if (Math.abs(s - d.scale) > 0.004) {
        d.scale = s;
        d.label.style.scale = s.toFixed(3);
      }
      const ar = Math.round(a * 50) / 50;
      if (ar !== d.opacity) {
        d.opacity = ar;
        setOpacity(d.label, ar);
      }
    }
  }
}
