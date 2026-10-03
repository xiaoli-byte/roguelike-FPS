/**
 * Boss 血条：顶部居中。名称、护盾（蓝）/ 护甲（金）细条、生命主条（带延迟掉血与阶段刻度）。
 * 刻度按首领 id 取（与各 Boss 的阶段阈值一致）；首领不可选中（登场 / 阶段转换）时血条变灰并显示「无敌」锁。
 */
import type { IEnemy } from '../core/types';
import { clamp01 } from '../core/math';
import { h, icon, formatNum } from './dom';
import { ICON_CLOUD, ICON_LOCK } from './icons';

/** 各首领的阶段阈值（生命比例），血条上画对应刻度 */
const BOSS_TICKS: Readonly<Record<string, readonly number[]>> = {
  boss_colossus: [0.5, 0.25],
  boss_matriarch: [0.5],
  boss_warlord: [0.5, 0.2],
};
const DEFAULT_TICKS: readonly number[] = [0.5, 0.25];
/** 首领被击杀后血条保留「已击破」的时长（毫秒） */
const DEAD_LINGER_MS = 1600;

export class BossBar {
  readonly root: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private shieldRow: HTMLDivElement;
  private shieldFill: HTMLDivElement;
  private armorRow: HTMLDivElement;
  private armorFill: HTMLDivElement;
  private hpRow: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpTrail: HTMLDivElement;
  private numEl: HTMLSpanElement;
  private layerEl: HTMLSpanElement;
  private ticks: readonly number[] = [];
  private tickEls: HTMLElement[] = [];
  /** 当前是否处于「无敌」（不可选中）显示状态 */
  private invuln = false;

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
  private passed: boolean[] = [];

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
    this.hpRow = h('div', 'gf-boss__row gf-boss__row--hp', bars);
    this.hpTrail = h('div', 'gf-boss__trail', this.hpRow);
    this.hpFill = h('div', 'gf-boss__fill', this.hpRow);
    this.buildTicks(DEFAULT_TICKS);
    const foot = h('div', 'gf-boss__foot', this.root);
    const state = h('span', 'gf-boss__state', foot);
    icon(ICON_LOCK, 'gf-icon gf-boss__lock', state);
    this.layerEl = h('span', 'gf-boss__layer', state);
    this.numEl = h('span', 'gf-boss__num', foot);
  }

  /** 按阈值重建生命条刻度（阈值相同则保留现有元素） */
  private buildTicks(ticks: readonly number[]): void {
    const same = ticks.length === this.ticks.length && ticks.every((t, i) => t === this.ticks[i]);
    if (!same) {
      for (const el of this.tickEls) el.remove();
      this.tickEls = [];
      for (const t of ticks) {
        const tick = h('i', 'gf-boss__tick', this.hpRow);
        tick.style.left = `${t * 100}%`;
        this.tickEls.push(tick);
      }
      this.ticks = ticks;
    }
    this.passed = ticks.map(() => false);
  }

  private setInvuln(on: boolean): void {
    if (on === this.invuln) return;
    this.invuln = on;
    this.root.classList.toggle('is-invuln', on);
  }

  set(enemy: IEnemy | null): void {
    window.clearTimeout(this.hideTimer);
    if (!enemy) {
      // 首领刚被击杀（StageDirector 会立刻 setBoss(null)）：先显示「已击破」再收起，由 update 计时
      const cur = this.enemy;
      if (this.visible && cur && !cur.alive && (!this.deadAt || performance.now() - this.deadAt < DEAD_LINGER_MS)) {
        if (!this.deadAt) {
          this.deadAt = performance.now();
          this.root.classList.add('is-dead');
        }
        return;
      }
      this.hideNow(false);
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
    this.buildTicks(BOSS_TICKS[enemy.def.id] ?? DEFAULT_TICKS);
    this.passed = this.ticks.map((t) => this.trail <= t);
    this.tickEls.forEach((el, i) => el.classList.toggle('is-passed', this.passed[i]));
    this.shieldRow.hidden = !(enemy.maxShield > 0);
    this.armorRow.hidden = !(enemy.maxArmor > 0);
    this.setInvuln(enemy.alive && enemy.untargetable === true);
    this.root.classList.remove('is-dead');
    this.visible = true;
    this.root.hidden = false;
    void this.root.offsetWidth;
    this.root.classList.add('is-open');
  }

  /** 收起（换关 / 新开一局 / 隐藏 HUD 时立即收起，不保留「已击破」） */
  hideNow(immediate = true): void {
    window.clearTimeout(this.hideTimer);
    this.enemy = null;
    this.deadAt = 0;
    this.setInvuln(false);
    if (!this.visible && (this.root.hidden || !immediate)) return;
    this.visible = false;
    this.root.classList.remove('is-open');
    if (immediate) {
      this.root.hidden = true;
      return;
    }
    this.hideTimer = window.setTimeout(() => {
      if (!this.visible) this.root.hidden = true;
    }, 500);
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
      for (let i = 0; i < this.ticks.length; i++) {
        const passed = hp <= this.ticks[i];
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

    // 不可选中（登场 / 阶段转换）：血条变灰 + 锁，结束后恢复
    const invuln = e.alive && e.untargetable === true;
    this.setInvuln(invuln);

    // 当前受击层 + 数值
    const layer = !e.alive ? '已击破' : invuln ? '无敌' : e.shield > 0 ? '护盾' : e.armor > 0 ? '护甲' : '生命';
    if (layer !== this.layerText) {
      this.layerText = layer;
      this.layerEl.textContent = layer;
      this.layerEl.dataset.layer = !e.alive ? 'dead' : invuln ? 'invuln' : e.shield > 0 ? 'shield' : e.armor > 0 ? 'armor' : 'hp';
    }
    const cur = e.alive ? (e.shield > 0 ? e.shield : e.armor > 0 ? e.armor : e.hp) : 0;
    const max = e.alive ? (e.shield > 0 ? e.maxShield : e.armor > 0 ? e.maxArmor : e.maxHp) : e.maxHp;
    const curInt = Math.ceil(cur);
    if (curInt !== this.numCur || max !== this.numMax) {
      this.numCur = curInt;
      this.numMax = max;
      this.numEl.textContent = `${formatNum(curInt)} / ${formatNum(max)}`;
    }

    // Boss 死亡：显示击破后自动收起（无论 StageDirector 是否调用 setBoss(null)）
    if (!e.alive) {
      if (!this.deadAt) {
        this.deadAt = now;
        this.root.classList.add('is-dead');
      } else if (now - this.deadAt > DEAD_LINGER_MS) this.hideNow(false);
    }
  }
}
