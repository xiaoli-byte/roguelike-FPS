/**
 * 敌人头顶血条（照译 Unity G/UI/Widgets/EnemyBars.cs）：
 *   对象：活着、可选中的非首领敌人里，精英或任一层没满的，45 m 内、在视野前方，最多 28 条（元素池复用，不每帧重建）。
 *   内容：精英名（标题字体、鎏金；带词缀时前面一枚词缀色标签）、状态小标（灼 / 雷 / 蚀 / 晕，带层数）、护盾 / 护甲细条、生命条（延迟掉血拖尾，精英加粗描金）。
 *   元素反应提示：身上两种元素状态 = 可反应（小标 1.2 s 呼吸发光），三种 = 归墟就绪（紫光、0.6 s 急促）。
 *   位置：投影头顶（身体顶上 + 0.3 m），按距离缩放（13 / 距离，夹在 0.62–1.12，精英 ×1.12）；被墙挡住时半透明（每条约 0.13 s 测一次），40–45 m 渐隐。
 * 精英头顶印章（EliteSeal，「精英灵契」）挂在精英血条顶上：鎏金印章 + 词缀纹样，6 m 内不画、远处不跟着缩没、瞄着它时让准星。
 */
import * as THREE from 'three';
import type { IEnemy, StatusId } from '../../core/types';
import { el, fill, setFill, setOpacity, setScale, show, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { HpHi, JadeHi, type RGBA, barShade, css, elementColor, glow, paint, rgb } from '../toolkit/UITheme';
import { EliteSeal } from './EliteSeal';
import { HudColors, type HudFrame, HudWidget } from './HudWidget';

export const MAX_BARS = 28;
export const MAX_DIST = 45;
const TrailHold = 0.38, TrailRate = 1.1, HeadLift = 0.3;

/** 词缀显示：名字、颜色、说明（同 Unity AffixLabels） */
export const AFFIX_LABELS: Record<string, { name: string; color: RGBA; hint: string }> = {
  swift: { name: '迅捷', color: rgb(0x49d8ff), hint: '移速与攻速提高' },
  shielded: { name: '坚盾', color: rgb(0x6f9dff), hint: '额外护盾，脱战回盾' },
  volatile: { name: '爆裂', color: rgb(0xff7a3a), hint: '死亡时爆炸，别贴身击杀' },
  frenzied: { name: '狂暴', color: rgb(0xff4a32), hint: '低血量时狂暴' },
};

/** 状态小标（同 Unity Badges） */
const BADGES: { id: StatusId; glyph: string; color: RGBA }[] = [
  { id: 'burn', glyph: '灼', color: elementColor('fire') },
  { id: 'shock', glyph: '雷', color: elementColor('shock') },
  { id: 'corrode', glyph: '蚀', color: elementColor('corrode') },
  { id: 'stun', glyph: '晕', color: HudColors.StunBadge },
];

interface Slot {
  anchor: HTMLDivElement;
  bar: HTMLDivElement;
  nameRow: HTMLDivElement;
  status: HTMLDivElement;
  shieldRow: HTMLDivElement;
  shieldFill: HTMLDivElement;
  armorRow: HTMLDivElement;
  armorFill: HTMLDivElement;
  hpRow: HTMLDivElement;
  hpFill: HTMLDivElement;
  hpTrail: HTMLDivElement;
  nameText: HTMLDivElement;
  affix: HTMLDivElement;
  badges: HTMLDivElement[];
  glows: HTMLDivElement[];
  stacks: HTMLDivElement[];
  stackV: number[];
  enemy: IEnemy | null;
  stamp: number;
  statusMask: number;
  react: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  shield: number;
  armor: number;
  hp: number;
  trail: number;
  trailHold: number;
  occlNext: number;
  hasShield: boolean;
  hasArmor: boolean;
  occluded: boolean;
  elite: boolean;
  name: string;
  affixId: string;
  seed: number;
  seal: EliteSeal;
  barH: number;
}

const _head = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _body = new THREE.Vector3();
const _p = { x: 0, y: 0, z: 0 };

/** 头顶：身体顶上 + 0.3 m（Unity 用碰撞体包围盒顶） */
export function headOf(e: IEnemy, out: THREE.Vector3): THREE.Vector3 {
  e.getHeadCenter(out);
  const top = Math.max(out.y + 0.2, e.position.y + e.height);
  out.y = top + HeadLift;
  return out;
}

export class EnemyBars extends HudWidget {
  readonly id = 'enemy-bars';
  override readonly order = 0;

  private root2!: HTMLDivElement;
  private readonly poolList: Slot[] = [];
  private readonly active: Slot[] = [];
  private readonly byEnemy = new Map<IEnemy, Slot>();
  private stampN = 0;
  private seedN = 0;

  /** 正在显示的血条数（测试用） */
  get count(): number {
    return this.active.length;
  }

  /** 某只敌人的头顶印章（没有血条为 null；测试 / 截图用） */
  sealOf(e: IEnemy): EliteSeal | null {
    return this.byEnemy.get(e)?.seal ?? null;
  }

  has(e: IEnemy): boolean {
    return this.byEnemy.has(e);
  }

  protected build(): HTMLElement {
    this.root2 = el('sf-ebars');
    return this.root2;
  }

  override resetState(): void {
    for (const s of this.active) this.release(s);
    this.active.length = 0;
    this.byEnemy.clear();
  }

  override tick(f: HudFrame): void {
    const ctx = this.game;
    const cam = ctx.camera;
    const now = f.unscaledTime;
    const camPos = cam.position;
    cam.getWorldDirection(_fwd);
    const trailStep = Math.min(0.1, f.unscaledDt) * TrailRate;
    const st = ++this.stampN;
    let shown = 0;
    const size = this.ctx.panelSize;
    const live = ctx.enemies.list;
    for (let i = 0; i < live.length && shown < MAX_BARS; i++) {
      const e = live[i];
      if (!e || !e.alive || e.isBoss || e.untargetable) continue;
      const elite = e.isElite;
      const damaged = e.hp < e.maxHp - 0.01 || e.shield < e.maxShield - 0.01 || e.armor < e.maxArmor - 0.01;
      if (!elite && !damaged) continue;

      let slot = this.byEnemy.get(e) ?? null;
      headOf(e, _head);
      _rel.copy(_head).sub(camPos);
      const dist = _rel.length();
      if (dist > MAX_DIST || _rel.dot(_fwd) < 0.2 * dist) continue;
      if (!this.ctx.project(_head, _p)) continue;
      if (_p.x < -0.04 * size.x || _p.x > 1.04 * size.x || _p.y < -0.04 * size.y || _p.y > 1.05 * size.y) continue;

      if (!slot) {
        slot = this.acquire(e, now);
        this.byEnemy.set(e, slot);
        this.active.push(slot);
      }
      slot.stamp = st;
      shown++;

      const scale = Math.min(1.12, Math.max(0.62, 13 / Math.max(1, dist))) * (slot.elite ? 1.12 : 1);
      if (Number.isNaN(slot.x) || Math.abs(_p.x - slot.x) > 0.4 || Math.abs(_p.y - slot.y) > 0.4) {
        slot.x = _p.x;
        slot.y = _p.y;
        slot.anchor.style.translate = `${_p.x.toFixed(1)}px ${_p.y.toFixed(1)}px`;
      }
      if (Math.abs(scale - slot.scale) > 0.01) {
        slot.scale = scale;
        setScale(slot.bar, scale);
      }

      if (slot.elite) slot.seal.tick(dist, scale, _p.x, _p.y, size.x, size.y, slot.barH);

      // 被墙挡住时半透明（每条约 0.13 s 测一次，错开）
      if (now >= slot.occlNext) {
        slot.occlNext = now + 0.13 + (slot.seed & 7) * 0.012;
        if (slot.elite) slot.barH = slot.bar.offsetHeight || 24;
        // 测到身体中心，跳过敌人自己的碰撞体（同 Unity）：网页的持盾怪把盾牌登记成世界碰撞体，终点往相机方向收回 半径 + 0.5 m
        e.getBodyCenter(_body);
        const back = _rel.copy(camPos).sub(_body);
        const bl = back.length();
        if (bl > e.radius + 0.6) _body.addScaledVector(back, (e.radius + 0.5) / bl);
        slot.occluded = ctx.world.segmentBlocked(camPos, _body);
      }
      const fade = dist > MAX_DIST - 6 ? Math.min(1, Math.max(0, (MAX_DIST - dist) / 6)) : 1;
      const op = (slot.occluded ? 0.35 : 1) * fade;
      if (Math.abs(op - slot.opacity) > 0.02) {
        slot.opacity = op;
        setOpacity(slot.anchor, op);
      }
      this.syncLayers(slot, e, now, trailStep);
      this.syncStatus(slot, e, now);
    }

    // 回收本帧没用到的
    let j = 0;
    for (let i = 0; i < this.active.length; i++) {
      const s = this.active[i];
      if (s.stamp === st) this.active[j++] = s;
      else {
        if (s.enemy && this.byEnemy.get(s.enemy) === s) this.byEnemy.delete(s.enemy);
        this.release(s);
      }
    }
    this.active.length = j;
  }

  private syncLayers(s: Slot, e: IEnemy, now: number, trailStep: number): void {
    const hasShield = e.maxShield > 0;
    if (hasShield !== s.hasShield) {
      s.hasShield = hasShield;
      show(s.shieldRow, hasShield);
    }
    const hasArmor = e.maxArmor > 0;
    if (hasArmor !== s.hasArmor) {
      s.hasArmor = hasArmor;
      show(s.armorRow, hasArmor);
    }
    if (hasShield) {
      const v = Math.min(1, Math.max(0, e.shield / e.maxShield));
      if (Math.abs(v - s.shield) > 0.004) {
        s.shield = v;
        setFill(s.shieldFill, v);
      }
    }
    if (hasArmor) {
      const v = Math.min(1, Math.max(0, e.armor / e.maxArmor));
      if (Math.abs(v - s.armor) > 0.004) {
        s.armor = v;
        setFill(s.armorFill, v);
      }
    }
    const hp = Math.min(1, Math.max(0, e.hp / Math.max(1, e.maxHp)));
    if (Math.abs(hp - s.hp) > 0.002) {
      if (hp < s.hp) s.trailHold = now + TrailHold;
      s.hp = hp;
      setFill(s.hpFill, hp);
    }
    let t = s.trail;
    if (t < hp) t = hp;
    else if (t > hp && now >= s.trailHold) t = Math.max(hp, t - trailStep);
    if (t !== s.trail) {
      s.trail = t;
      setFill(s.hpTrail, t);
    }
  }

  private syncStatus(s: Slot, e: IEnemy, now: number): void {
    let mask = 0, elems = 0;
    for (let i = 0; i < BADGES.length; i++) {
      const view = e.statuses.get(BADGES[i].id);
      const on = BADGES[i].id === 'stun' ? e.stunTime > 0 || !!view : !!view;
      if (!on) continue;
      mask |= 1 << i;
      if (i < 3) elems++;
      const stacks = BADGES[i].id === 'stun' ? 0 : view?.stacks ?? 0;
      if (stacks !== s.stackV[i]) {
        s.stackV[i] = stacks;
        s.stacks[i].textContent = stacks > 1 ? String(stacks) : '';
      }
    }
    if (mask !== s.statusMask) {
      for (let i = 0; i < BADGES.length; i++) show(s.badges[i], (mask & (1 << i)) !== 0);
      show(s.status, mask !== 0);
      s.statusMask = mask;
    }
    // 元素反应提示：两种相遇即可反应；三种齐聚再补一种就是「归墟」
    const react = elems >= 3 ? 2 : elems === 2 ? 1 : 0;
    if (react !== s.react) {
      s.react = react;
      for (let i = 0; i < 3; i++) {
        paint(s.glows[i], glow(react === 2 ? HudColors.Primed : BADGES[i].color));
        if (react === 0) setOpacity(s.glows[i], 0);
      }
    }
    if (react > 0) {
      const period = react === 2 ? 0.6 : 1.2;
      const a = 0.2 + 0.8 * (0.5 - 0.5 * Math.cos((now * Math.PI * 2) / period));
      for (let i = 0; i < 3; i++) setOpacity(s.glows[i], a);
    }
  }

  private acquire(e: IEnemy, now: number): Slot {
    const s = this.poolList.pop() ?? this.create();
    s.enemy = e;
    s.x = NaN;
    s.scale = s.opacity = -1;
    s.shield = s.armor = s.hp = -1;
    s.trail = Math.min(1, Math.max(0, e.hp / Math.max(1, e.maxHp)));
    setFill(s.hpTrail, s.trail);
    s.trailHold = 0;
    s.hasShield = !(e.maxShield > 0);
    s.hasArmor = !(e.maxArmor > 0);
    s.occluded = false;
    s.occlNext = now;
    s.statusMask = -1;
    s.react = -1;
    for (let i = 0; i < 4; i++) s.stackV[i] = -1;

    s.elite = e.isElite;
    toggle(s.bar, 'is-elite', s.elite);
    // 精英词缀：用词缀色单独标出（爆裂等词缀直接影响玩家怎么打）
    const affixId = s.elite ? e.affix ?? '' : '';
    const info = affixId ? AFFIX_LABELS[affixId] : undefined;
    s.seal.bind(s.elite, affixId || null, info?.color ?? null);
    s.barH = 24;
    if (affixId !== s.affixId) {
      s.affixId = affixId;
      show(s.affix, !!info);
      if (info) {
        s.affix.textContent = info.name;
        s.affix.style.backgroundColor = css(info.color);
      }
    }
    let name = s.elite ? e.displayName || e.def.name : '';
    // 名字里已经带了词缀（「精英·爆裂 沙匪刀客」）时去掉重复的词
    if (info && name.includes(info.name)) name = name.replace(info.name, '').replace('· ', '·').replace('  ', ' ').trim();
    if (name !== s.name) {
      s.name = name;
      s.nameText.textContent = name;
    }
    show(s.nameRow, name.length > 0 || !!info);
    s.anchor.style.display = '';
    return s;
  }

  private release(s: Slot): void {
    s.enemy = null;
    s.seal.unbind();
    s.anchor.style.display = 'none';
    this.poolList.push(s);
  }

  private create(): Slot {
    const anchor = el('sf-ebar-anchor', this.root2);
    const bar = el('sf-ebar', anchor);
    bar.style.transformOrigin = '50% 100%';
    const nameRow = el('sf-ebar__name', bar);
    const affix = text('sf-ebar__affix', nameRow);
    show(affix, false);
    const nameText = text('sf-ebar__nametext', nameRow, '', UIFontRole.Title);
    const status = el('sf-ebar__status', bar);
    const badges: HTMLDivElement[] = [], glows: HTMLDivElement[] = [], stacks: HTMLDivElement[] = [];
    for (const b of BADGES) {
      const badge = el('sf-ebar__badge', status);
      badge.style.backgroundColor = css(b.color);
      const g = el('sf-ebar__glow', badge);
      paint(g, glow(b.color));
      setOpacity(g, 0);
      text('sf-ebar__glyph', badge, b.glyph, UIFontRole.Title);
      stacks.push(text('sf-ebar__stacks', badge, '', UIFontRole.Number));
      badges.push(badge);
      glows.push(g);
      show(badge, false);
    }
    show(status, false);
    const shieldRow = el('sf-ebar__row sf-ebar__row--shield', bar);
    const shieldFill = fill(shieldRow);
    paint(shieldFill, barShade(JadeHi));
    const armorRow = el('sf-ebar__row sf-ebar__row--armor', bar);
    const armorFill = fill(armorRow);
    paint(armorFill, barShade(HudColors.ArmorHi));
    const hpRow = el('sf-ebar__row sf-ebar__row--hp', bar);
    const hpTrail = fill(hpRow);
    hpTrail.style.backgroundColor = css(HudColors.Trail);
    const hpFill = fill(hpRow);
    paint(hpFill, barShade(HpHi));
    anchor.style.display = 'none';
    return {
      anchor, bar, nameRow, status, shieldRow, shieldFill, armorRow, armorFill, hpRow, hpFill, hpTrail, nameText, affix, badges, glows, stacks,
      stackV: [-1, -1, -1, -1], enemy: null, stamp: 0, statusMask: -1, react: -1, x: NaN, y: 0, scale: -1, opacity: -1, shield: -1, armor: -1, hp: -1,
      trail: 1, trailHold: 0, occlNext: 0, hasShield: true, hasArmor: true, occluded: false, elite: false, name: '\0', affixId: '\0', seed: this.seedN++ * 7919, seal: new EliteSeal(bar), barH: 24,
    };
  }
}
