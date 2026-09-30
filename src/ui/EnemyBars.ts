/**
 * 敌人头顶血条：对活着的非 Boss 敌人（精英，或任一层未满）投影头顶位置，
 * 显示分层血条（护盾 / 护甲 / 生命）、精英名称与状态小标。DOM 池复用，不每帧重建。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../core/types';
import { clamp, clamp01 } from '../core/math';
import { h } from './dom';
import { STATUS_BADGES } from './labels';

const MAX_DIST = 45;
const MAX_BARS = 28;
/** 生命「延迟掉血」：受伤后停顿多久开始追赶（毫秒） */
const TRAIL_HOLD = 380;

const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _rel = new THREE.Vector3();

interface BarSlot {
  el: HTMLDivElement;
  nameEl: HTMLDivElement;
  shieldRow: HTMLDivElement;
  shieldFill: HTMLDivElement;
  armorRow: HTMLDivElement;
  armorFill: HTMLDivElement;
  hpFill: HTMLDivElement;
  hpTrail: HTMLDivElement;
  badges: HTMLSpanElement[];
  enemy: IEnemy | null;
  stamp: number;
  // 缓存（只写变化了的样式）
  x: number;
  y: number;
  scale: number;
  opacity: number;
  shield: number;
  armor: number;
  hp: number;
  trail: number;
  trailHoldUntil: number;
  hasShield: boolean;
  hasArmor: boolean;
  name: string;
  statusMask: number;
  stacks: number[];
  occluded: boolean;
  occlNext: number;
}

export class EnemyBars {
  readonly root: HTMLDivElement;
  private pool: BarSlot[] = [];
  private active: BarSlot[] = [];
  private byId = new Map<number, BarSlot>();
  private stamp = 0;
  private lastNow = 0;

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    this.root = h('div', 'gf-ebars', parent);
  }

  /** 释放全部（换关 / 隐藏 HUD） */
  reset(): void {
    for (const s of this.active) this.release(s);
    this.active.length = 0;
    this.byId.clear();
  }

  update(now: number): void {
    const ctx = this.ctx;
    const cam = ctx.camera;
    // 玩家控制器本帧刚改过相机，渲染前矩阵尚未更新：先同步，避免血条滞后一帧
    cam.updateMatrixWorld();
    const camPos = cam.position;
    cam.getWorldDirection(_fwd);
    const trailStep = Math.min(100, Math.max(0, now - this.lastNow)) * 0.0011;
    this.lastNow = now;
    const w = window.innerWidth;
    const hh = window.innerHeight;
    const stamp = ++this.stamp;
    let shown = 0;

    const list = ctx.enemies.list;
    for (let i = 0; i < list.length && shown < MAX_BARS; i++) {
      const e = list[i];
      if (!e.alive || e.isBoss || e.removed) continue;
      const damaged = e.hp < e.maxHp || e.shield < e.maxShield || e.armor < e.maxArmor;
      if (!e.isElite && !damaged) continue;

      e.getHeadCenter(_pos);
      _pos.y += 0.45 + e.height * 0.12;
      _rel.subVectors(_pos, camPos);
      const dist = _rel.length();
      if (dist > MAX_DIST || _rel.dot(_fwd) < 0.2) continue;
      _pos.project(cam);
      if (_pos.z > 1 || _pos.x < -1.08 || _pos.x > 1.08 || _pos.y < -1.08 || _pos.y > 1.1) continue;

      let slot = this.byId.get(e.id);
      if (!slot || slot.enemy !== e) {
        slot = this.acquire(e, now);
        this.byId.set(e.id, slot);
        this.active.push(slot);
      }
      slot.stamp = stamp;
      shown++;

      const sx = (_pos.x * 0.5 + 0.5) * w;
      const sy = (0.5 - _pos.y * 0.5) * hh;
      const scale = clamp(13 / Math.max(1, dist), 0.62, 1.12) * (e.isElite ? 1.12 : 1);
      if (Math.abs(sx - slot.x) > 0.4 || Math.abs(sy - slot.y) > 0.4 || Math.abs(scale - slot.scale) > 0.01) {
        slot.x = sx;
        slot.y = sy;
        slot.scale = scale;
        slot.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      }

      // 被墙挡住时降低透明度（每个血条约 0.15 秒检测一次）
      if (now >= slot.occlNext) {
        slot.occlNext = now + 130 + (e.id % 5) * 12;
        e.getHeadCenter(_pos);
        slot.occluded = ctx.world.segmentBlocked(camPos, _pos);
      }
      const fadeFar = dist > MAX_DIST - 6 ? clamp01((MAX_DIST - dist) / 6) : 1;
      const op = (slot.occluded ? 0.35 : 1) * fadeFar;
      if (Math.abs(op - slot.opacity) > 0.02) {
        slot.opacity = op;
        slot.el.style.opacity = op.toFixed(2);
      }

      this.syncLayers(slot, e, now, trailStep);
      this.syncStatus(slot, e);
    }

    // 回收本帧未使用的血条
    let j = 0;
    for (let i = 0; i < this.active.length; i++) {
      const s = this.active[i];
      if (s.stamp === stamp) {
        this.active[j++] = s;
      } else {
        if (s.enemy && this.byId.get(s.enemy.id) === s) this.byId.delete(s.enemy.id);
        this.release(s);
      }
    }
    this.active.length = j;
  }

  private syncLayers(s: BarSlot, e: IEnemy, now: number, trailStep: number): void {
    const hasShield = e.maxShield > 0;
    if (hasShield !== s.hasShield) {
      s.hasShield = hasShield;
      s.shieldRow.hidden = !hasShield;
    }
    const hasArmor = e.maxArmor > 0;
    if (hasArmor !== s.hasArmor) {
      s.hasArmor = hasArmor;
      s.armorRow.hidden = !hasArmor;
    }
    if (hasShield) {
      const v = clamp01(e.shield / e.maxShield);
      if (Math.abs(v - s.shield) > 0.004) {
        s.shield = v;
        s.shieldFill.style.transform = `scaleX(${v.toFixed(3)})`;
      }
    }
    if (hasArmor) {
      const v = clamp01(e.armor / e.maxArmor);
      if (Math.abs(v - s.armor) > 0.004) {
        s.armor = v;
        s.armorFill.style.transform = `scaleX(${v.toFixed(3)})`;
      }
    }
    const hp = clamp01(e.hp / Math.max(1, e.maxHp));
    if (Math.abs(hp - s.hp) > 0.002) {
      if (hp < s.hp) s.trailHoldUntil = now + TRAIL_HOLD;
      s.hp = hp;
      s.hpFill.style.transform = `scaleX(${hp.toFixed(3)})`;
    }
    // 延迟掉血：停顿后以固定速度追上
    let trail = s.trail;
    if (trail < hp) trail = hp;
    else if (trail > hp && now >= s.trailHoldUntil) trail = Math.max(hp, trail - trailStep);
    if (trail !== s.trail) {
      s.trail = trail;
      s.hpTrail.style.transform = `scaleX(${trail.toFixed(3)})`;
    }
  }

  private syncStatus(s: BarSlot, e: IEnemy): void {
    let mask = 0;
    for (let i = 0; i < STATUS_BADGES.length; i++) {
      const b = STATUS_BADGES[i];
      const st = e.statuses.get(b.id);
      const on = b.id === 'stun' ? e.stunTime > 0 || !!st : !!st;
      if (!on) continue;
      mask |= 1 << i;
      const stacks = st && b.id !== 'stun' ? st.stacks : 0;
      if (stacks !== s.stacks[i]) {
        s.stacks[i] = stacks;
        s.badges[i].dataset.stacks = stacks > 1 ? String(stacks) : '';
      }
    }
    if (mask !== s.statusMask) {
      for (let i = 0; i < STATUS_BADGES.length; i++) {
        const bit = 1 << i;
        if ((mask & bit) !== (s.statusMask & bit)) s.badges[i].hidden = !(mask & bit);
      }
      s.statusMask = mask;
    }
  }

  private acquire(e: IEnemy, now: number): BarSlot {
    const s = this.pool.pop() ?? this.create();
    s.enemy = e;
    s.x = s.y = -1;
    s.scale = -1;
    s.opacity = -1;
    s.shield = s.armor = -1;
    s.hp = -1;
    s.trail = clamp01(e.hp / Math.max(1, e.maxHp));
    s.hpTrail.style.transform = `scaleX(${s.trail.toFixed(3)})`;
    s.trailHoldUntil = 0;
    s.hasShield = !(e.maxShield > 0);
    s.hasArmor = !(e.maxArmor > 0);
    s.occluded = false;
    s.occlNext = now;
    const name = e.isElite ? e.displayName : '';
    if (name !== s.name) {
      s.name = name;
      s.nameEl.textContent = name;
    }
    s.nameEl.hidden = !name;
    s.el.classList.toggle('is-elite', e.isElite);
    s.el.hidden = false;
    return s;
  }

  private release(s: BarSlot): void {
    s.enemy = null;
    s.el.hidden = true;
    this.pool.push(s);
  }

  private create(): BarSlot {
    const el = h('div', 'gf-ebar', this.root);
    const nameEl = h('div', 'gf-ebar__name', el);
    const status = h('div', 'gf-ebar__status', el);
    const badges: HTMLSpanElement[] = [];
    for (const b of STATUS_BADGES) {
      const badge = h('span', 'gf-ebar__badge', status, b.glyph);
      badge.style.setProperty('--badge', b.color);
      badge.title = b.name;
      badge.hidden = true;
      badges.push(badge);
    }
    const shieldRow = h('div', 'gf-ebar__row gf-ebar__row--shield', el);
    const shieldFill = h('div', 'gf-ebar__fill', shieldRow);
    const armorRow = h('div', 'gf-ebar__row gf-ebar__row--armor', el);
    const armorFill = h('div', 'gf-ebar__fill', armorRow);
    const hpRow = h('div', 'gf-ebar__row gf-ebar__row--hp', el);
    const hpTrail = h('div', 'gf-ebar__trail', hpRow);
    const hpFill = h('div', 'gf-ebar__fill', hpRow);
    el.hidden = true;
    return {
      el, nameEl, shieldRow, shieldFill, armorRow, armorFill, hpFill, hpTrail, badges,
      enemy: null, stamp: 0, x: -1, y: -1, scale: -1, opacity: -1, shield: -1, armor: -1, hp: -1, trail: 1,
      trailHoldUntil: 0, hasShield: true, hasArmor: true, name: '\u0000', statusMask: 0, stacks: [0, 0, 0, 0],
      occluded: false, occlNext: 0,
    };
  }
}
