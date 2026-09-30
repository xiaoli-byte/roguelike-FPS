/**
 * Boss 血条：顶部居中。名称、护盾（蓝）/ 护甲（金）细条、生命主条（带延迟掉血与 50% / 25% 刻度）。
 */
import type { IEnemy } from '../core/types';
import { clamp01 } from '../core/math';
import { h, icon, formatNum } from './dom';
import { ICON_CLOUD } from './icons';

const TICKS = [0.5, 0.25];

export class BossBar {
  readonly root: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private shieldRow: HTMLDivElement;
  private shieldFill: HTMLDivElement;
  private armorRow: HTMLDivElement;
  private armorFill: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpTrail: HTMLDivElement;
  private numEl: HTMLSpanElement;
  private layerEl: HTMLSpanElement;
  private tickEls: HTMLElement[] = [];

  private enemy: IEnemy | null = null;
  private visible = false;
  private hideTimer = 0;
  private deadAt = 0;

  private shield = -1;
  private armor = -1;
  private hp = -1;
  private trail = 1;
  private trailHoldUntil = 0;
  private lastNow = 0;
  private numCur = -1;
  private numMax = -1;
  private layerText = '';
  private passed: boolean[] = [false, false];

  constructor(parent: HTMLElement) {
    this.root = h('div', 'gf-boss', parent);
    this.root.hidden = true;
    const head = h('div', 'gf-boss__head', this.root);
    icon(ICON_CLOUD, 'gf-boss__cloud gf-boss__cloud--l', head);
    this.nameEl = h('div', 'gf-boss__name', head);
    icon(ICON_CLOUD, 'gf-boss__cloud gf-boss__cloud--r', head);

    const bars = h('div', 'gf-boss__bars', this.root);
    this.shieldRow = h('div', 'gf-boss__row gf-boss__row--shield', bars);
    this.shieldFill = h('div', 'gf-boss__fill', this.shieldRow);
    this.armorRow = h('div', 'gf-boss__row gf-boss__row--armor', bars);
    this.armorFill = h('div', 'gf-boss__fill', this.armorRow);
    const hpRow = h('div', 'gf-boss__row gf-boss__row--hp', bars);
    this.hpTrail = h('div', 'gf-boss__trail', hpRow);
    this.hpFill = h('div', 'gf-boss__fill', hpRow);
    for (const t of TICKS) {
      const tick = h('i', 'gf-boss__tick', hpRow);
      tick.style.left = `${t * 100}%`;
      this.tickEls.push(tick);
    }
    const foot = h('div', 'gf-boss__foot', this.root);
    this.layerEl = h('span', 'gf-boss__layer', foot);
    this.numEl = h('span', 'gf-boss__num', foot);
  }

  set(enemy: IEnemy | null): void {
    window.clearTimeout(this.hideTimer);
    if (!enemy) {
      this.enemy = null;
      if (!this.visible) return;
      this.visible = false;
      this.root.classList.remove('is-open');
      this.hideTimer = window.setTimeout(() => {
        if (!this.visible) this.root.hidden = true;
      }, 500);
      return;
    }
    this.enemy = enemy;
    this.deadAt = 0;
    this.nameEl.textContent = enemy.displayName || enemy.def.name;
    this.shield = this.armor = this.hp = -1;
    this.numCur = this.numMax = -1;
    this.layerText = '';
    this.trail = clamp01(enemy.hp / Math.max(1, enemy.maxHp));
    this.hpTrail.style.transform = `scaleX(${this.trail.toFixed(4)})`;
    this.passed = TICKS.map((t) => this.trail <= t);
    this.tickEls.forEach((el, i) => el.classList.toggle('is-passed', this.passed[i]));
    this.shieldRow.hidden = !(enemy.maxShield > 0);
    this.armorRow.hidden = !(enemy.maxArmor > 0);
    this.root.classList.remove('is-dead');
    this.visible = true;
    this.root.hidden = false;
    void this.root.offsetWidth;
    this.root.classList.add('is-open');
  }

  update(now: number): void {
    const e = this.enemy;
    const step = Math.min(100, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    if (!e || !this.visible) return;

    // 护盾 / 护甲可能在战斗中出现（例如妖后召唤冰晶回盾）
    const hasShield = e.maxShield > 0;
    if (this.shieldRow.hidden === hasShield) this.shieldRow.hidden = !hasShield;
    const hasArmor = e.maxArmor > 0;
    if (this.armorRow.hidden === hasArmor) this.armorRow.hidden = !hasArmor;

    const sh = hasShield ? clamp01(e.shield / e.maxShield) : 0;
    if (Math.abs(sh - this.shield) > 0.001) {
      this.shield = sh;
      this.shieldFill.style.transform = `scaleX(${sh.toFixed(4)})`;
    }
    const ar = hasArmor ? clamp01(e.armor / e.maxArmor) : 0;
    if (Math.abs(ar - this.armor) > 0.001) {
      this.armor = ar;
      this.armorFill.style.transform = `scaleX(${ar.toFixed(4)})`;
    }
    const hp = e.alive ? clamp01(e.hp / Math.max(1, e.maxHp)) : 0;
    if (Math.abs(hp - this.hp) > 0.0005) {
      if (hp < this.hp) this.trailHoldUntil = now + 450;
      this.hp = hp;
      this.hpFill.style.transform = `scaleX(${hp.toFixed(4)})`;
      for (let i = 0; i < TICKS.length; i++) {
        const passed = hp <= TICKS[i];
        if (passed !== this.passed[i]) {
          this.passed[i] = passed;
          this.tickEls[i].classList.toggle('is-passed', passed);
          if (passed) this.root.animate([{ filter: 'brightness(1.9)' }, { filter: 'brightness(1)' }], { duration: 520, easing: 'ease-out' });
        }
      }
    }
    let trail = this.trail;
    if (trail < hp) trail = hp;
    else if (trail > hp && now >= this.trailHoldUntil) trail = Math.max(hp, trail - step * 0.00045);
    if (trail !== this.trail) {
      this.trail = trail;
      this.hpTrail.style.transform = `scaleX(${trail.toFixed(4)})`;
    }

    // 当前受击层 + 数值
    const layer = !e.alive ? '已击破' : e.shield > 0 ? '护盾' : e.armor > 0 ? '护甲' : '生命';
    if (layer !== this.layerText) {
      this.layerText = layer;
      this.layerEl.textContent = layer;
      this.layerEl.dataset.layer = !e.alive ? 'dead' : e.shield > 0 ? 'shield' : e.armor > 0 ? 'armor' : 'hp';
    }
    const cur = e.alive ? (e.shield > 0 ? e.shield : e.armor > 0 ? e.armor : e.hp) : 0;
    const max = e.alive ? (e.shield > 0 ? e.maxShield : e.armor > 0 ? e.maxArmor : e.maxHp) : e.maxHp;
    const curInt = Math.ceil(cur);
    if (curInt !== this.numCur || max !== this.numMax) {
      this.numCur = curInt;
      this.numMax = max;
      this.numEl.textContent = `${formatNum(curInt)} / ${formatNum(max)}`;
    }

    // Boss 死亡：显示击破后自动收起（即使 StageDirector 没有调用 setBoss(null)）
    if (!e.alive) {
      if (!this.deadAt) {
        this.deadAt = now;
        this.root.classList.add('is-dead');
      } else if (now - this.deadAt > 1800) this.set(null);
    }
  }
}
