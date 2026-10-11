/**
 * 屏幕中心与全屏战斗反馈：动态准星（近战形态为左右弧形括号，攻击距离内变朱红收紧、距离外变淡；换形一击窗口内朱红脉动）、
 * 换弹环、蓄力环、狙击镜遮罩、命中 / 暴击 / 击杀标记、受击方向指示、受击闪屏、低血量暗角、
 * 武器技能贯穿的朱红暗角闪与视野外刃印方向刃光。
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, IEnemy } from '../core/types';
import { angleDiff, clamp, clamp01, damp, yawFromDir } from '../core/math';
import { h } from './dom';

const _dir = new THREE.Vector3();
const DEG_PER_RAD = 180 / Math.PI;
/** 狙击镜阈值：fovKick 低于此值视为开镜 */
const SCOPE_KICK = -30;
const RELOAD_RING_C = 2 * Math.PI * 17;
/** 蓄力环进度量化步数（只有量化值变化才写 DOM） */
const CHARGE_STEPS = 100;

/** 命中标记种类 */
const HitKind = { None: -1, Normal: 0, Crit: 1, Kill: 2 } as const;
type HitKind = (typeof HitKind)[keyof typeof HitKind];

interface DirIndicator {
  el: HTMLDivElement;
  x: number;
  z: number;
  source: IEnemy | null;
  start: number;
  strength: number;
  active: boolean;
  lastOpacity: number;
}

const DIR_POOL = 6;
const DIR_MS = 1150;
/** 近战形态：敌人在攻击距离内时准星括号收紧的像素 */
const MELEE_INRANGE_TIGHTEN = 4;
/** 贯穿反馈：暗角闪时长、方向刃光时长与池大小、视为「视野外」的水平夹角（16:9 下水平视野约 ±56°） */
const BLADE_FLASH_MS = 120;
const BLADE_DIR_MS = 520;
const BLADE_DIR_POOL = 6;
const BLADE_OFFSCREEN = (50 * Math.PI) / 180;

interface BladeDir {
  el: HTMLDivElement;
  x: number;
  z: number;
  start: number;
  active: boolean;
}

export class Crosshair {
  readonly root: HTMLDivElement;
  private reticle: HTMLDivElement;
  private reloadRing: SVGCircleElement;
  private chargeEl: HTMLDivElement;
  private hitEl: HTMLDivElement;
  private scopeEl: HTMLDivElement;
  private dirRoot: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private lowEl: HTMLDivElement;
  private bladeFlashEl: HTMLDivElement;

  private gap = 10;
  private shownGap = -1;
  private scoped = false;
  private onTarget = false;
  private frame = 0;
  private reloadShown = -1;
  /** 已写入 DOM 的蓄力量化值（0 = 隐藏，CHARGE_STEPS = 满蓄） */
  private chargeShown = 0;
  /** 双形态武器处于近战形态（魔刀「斩」）：准星换成弧形括号 */
  private melee = false;
  /** 换形一击窗口内：准星朱红脉动 */
  private strike = false;
  private bladeDirs: BladeDir[] = [];
  private bladeFlashAt = -1e9;
  private bladeFlashActive = false;

  private hitAt = -1e9;
  private hitKind: HitKind = HitKind.None;
  private hitShownKind: HitKind = HitKind.None;
  private hitActive = false;

  private dirs: DirIndicator[] = [];
  private flashAt = -1e9;
  private flashPeak = 0;
  private flashActive = false;
  private flashShield = false;
  private lowShown = -1;

  constructor(parent: HTMLElement, private readonly ctx: GameContext) {
    // 全屏层（在准星之下）
    this.lowEl = h('div', 'gf-lowhp', parent);
    h('div', 'gf-lowhp__pulse', this.lowEl);
    this.flashEl = h('div', 'gf-dmgflash', parent);
    this.bladeFlashEl = h('div', 'gf-bladeflash', parent);
    this.dirRoot = h('div', 'gf-dmgdir', parent);
    for (let i = 0; i < DIR_POOL; i++) {
      const el = h('div', 'gf-dmgdir__arc', this.dirRoot);
      el.style.opacity = '0';
      this.dirs.push({ el, x: 0, z: 0, source: null, start: -1e9, strength: 0, active: false, lastOpacity: 0 });
    }
    for (let i = 0; i < BLADE_DIR_POOL; i++) {
      const el = h('div', 'gf-dmgdir__arc gf-dmgdir__arc--blade', this.dirRoot);
      el.style.opacity = '0';
      this.bladeDirs.push({ el, x: 0, z: 0, start: -1e9, active: false });
    }
    this.scopeEl = h('div', 'gf-scope', parent);
    const lens = h('div', 'gf-scope__lens', this.scopeEl);
    h('i', 'gf-scope__h', lens);
    h('i', 'gf-scope__v', lens);
    h('i', 'gf-scope__dot', lens);
    for (let i = 1; i <= 4; i++) {
      h('i', `gf-scope__mil gf-scope__mil--x gf-scope__mil--${i}`, lens);
      h('i', `gf-scope__mil gf-scope__mil--y gf-scope__mil--${i}`, lens);
    }

    this.root = h('div', 'gf-xhair', parent);
    this.reticle = h('div', 'gf-xhair__reticle', this.root);
    for (const side of ['t', 'b', 'l', 'r']) h('i', `gf-xhair__line gf-xhair__line--${side}`, this.reticle);
    h('i', 'gf-xhair__dot', this.reticle);

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('class', 'gf-xhair__reload');
    const ring = document.createElementNS(svgNS, 'circle');
    ring.setAttribute('cx', '20');
    ring.setAttribute('cy', '20');
    ring.setAttribute('r', '17');
    ring.style.strokeDasharray = RELOAD_RING_C.toFixed(2);
    ring.style.strokeDashoffset = RELOAD_RING_C.toFixed(2);
    svg.appendChild(ring);
    this.root.appendChild(svg);
    this.reloadRing = ring;

    // 蓄力环（贯虹灵炮等蓄力武器）：--p 为 0..1 进度，满蓄加 is-full
    this.chargeEl = h('div', 'gf-xhair__charge', this.root);
    this.chargeEl.hidden = true;

    this.hitEl = h('div', 'gf-hitmark', this.root);
    for (let i = 0; i < 4; i++) h('i', `gf-hitmark__l gf-hitmark__l--${i}`, this.hitEl);
    this.hitEl.style.opacity = '0';
  }

  /** 命中反馈（来自 enemy:damaged / enemy:killed） */
  onEnemyHit(result: DamageResult, killed: boolean): void {
    const now = performance.now();
    if (killed) {
      this.hitKind = HitKind.Kill;
      this.hitAt = now;
      this.hitActive = true;
      return;
    }
    const req = result.request;
    if (req.source === 'status' || (req.procDepth ?? 0) > 0 || result.dealt <= 0) return;
    // 击杀标记显示期间不被普通命中覆盖
    if (this.hitKind === HitKind.Kill && now - this.hitAt < 260) return;
    const kind = result.isCrit ? HitKind.Crit : HitKind.Normal;
    if (this.hitKind === HitKind.Crit && kind === HitKind.Normal && now - this.hitAt < 90) return;
    this.hitKind = kind;
    this.hitAt = now;
    this.hitActive = true;
  }

  /** 玩家受击（来自 player:damaged） */
  onPlayerDamaged(amount: number, toHp: number, from: THREE.Vector3 | null, source: IEnemy | null): void {
    const now = performance.now();
    const p = this.ctx.player;
    const maxTotal = Math.max(1, p.maxHp() + p.maxShield());
    const strength = clamp(0.45 + (amount / maxTotal) * 4, 0.45, 1);
    // 闪屏：扣血为红，只扣盾为蓝
    this.flashAt = now;
    this.flashPeak = clamp(0.25 + (amount / maxTotal) * 3, 0.25, 0.75);
    this.flashActive = true;
    const shieldOnly = toHp <= 0;
    if (shieldOnly !== this.flashShield) {
      this.flashShield = shieldOnly;
      this.flashEl.classList.toggle('is-shield', shieldOnly);
    }

    const src = source && source.alive ? source.position : from;
    if (!src) return;
    const dx = src.x - p.position.x;
    const dz = src.z - p.position.z;
    if (dx * dx + dz * dz < 0.25) return;
    // 复用方向相近的指示器，其次空闲的，最后取最旧的
    const ang = yawFromDir(dx, dz);
    let pick: DirIndicator | null = null;
    for (const d of this.dirs) {
      if (d.active && Math.abs(angleDiff(yawFromDir(d.x - p.position.x, d.z - p.position.z), ang)) < 0.35) {
        pick = d;
        break;
      }
    }
    let oldest: DirIndicator = this.dirs[0];
    if (!pick) {
      for (const d of this.dirs) {
        if (!d.active) {
          oldest = d;
          break;
        }
        if (d.start < oldest.start) oldest = d;
      }
    }
    const d = pick ?? oldest;
    d.x = src.x;
    d.z = src.z;
    d.source = source && source.alive ? source : null;
    d.start = now;
    d.strength = Math.max(pick ? d.strength : 0, strength);
    d.active = true;
  }

  /**
   * 武器技能贯穿结算（weapon:skillImpale）：0.12 秒朱红暗角闪；视野外（水平夹角 > BLADE_OFFSCREEN）的每个刃印
   * 在屏幕边缘朝它的方向亮一道刃光（突进后刃印常在身后，贯穿本身看不到）
   */
  onBladeImpale(points: readonly THREE.Vector3[]): void {
    const now = performance.now();
    this.bladeFlashAt = now;
    this.bladeFlashActive = true;
    const p = this.ctx.player;
    let slot = 0;
    for (const pt of points) {
      if (slot >= this.bladeDirs.length) break;
      const dx = pt.x - p.position.x;
      const dz = pt.z - p.position.z;
      if (dx * dx + dz * dz < 0.25) continue;
      if (Math.abs(angleDiff(p.yaw, yawFromDir(dx, dz))) < BLADE_OFFSCREEN) continue;
      const d = this.bladeDirs[slot++];
      d.x = pt.x;
      d.z = pt.z;
      d.start = now;
      d.active = true;
    }
  }

  reset(): void {
    this.hitActive = false;
    this.hitKind = HitKind.None;
    this.hitEl.style.opacity = '0';
    this.hitShownKind = HitKind.None;
    for (const d of this.dirs) {
      d.active = false;
      d.source = null;
      d.lastOpacity = 0;
      d.el.style.opacity = '0';
    }
    this.flashActive = false;
    this.flashEl.style.opacity = '0';
    for (const d of this.bladeDirs) {
      d.active = false;
      d.el.style.opacity = '0';
    }
    this.bladeFlashActive = false;
    this.bladeFlashEl.style.opacity = '0';
    this.setCharge(0);
    this.setMelee(false);
    this.setStrike(false);
  }

  update(dt: number, now: number, playing = true): void {
    this.frame++;
    this.updateReticle(dt, playing);
    this.updateHitMarker(now);
    this.updateDirs(now);
    this.updateBladeFx(now);
    this.updateFlash(now);
    this.updateLowHp();
  }

  // ───────────── 准星 ─────────────

  private updateReticle(dt: number, playing: boolean): void {
    const ctx = this.ctx;
    const scoped = playing && ctx.cameraFx.fovKick < SCOPE_KICK;
    if (scoped !== this.scoped) {
      this.scoped = scoped;
      this.scopeEl.classList.toggle('is-on', scoped);
      this.reticle.classList.toggle('is-hidden', scoped);
    }

    // 近战形态（未提供 activeForm 的武器系统按普通武器处理）
    const w = ctx.weapons;
    const melee = (w.activeForm ?? null) === 'melee';
    this.setMelee(melee);
    // 换形一击窗口：准星朱红脉动（视线在准星上，比武器槽边框更容易注意到）
    this.setStrike((w.formStrikeTime ?? 0) > 0);

    // 散布（弧度）按相机竖直 FOV 投影成像素；近战形态敌人在攻击距离内时收紧
    const spread = Math.max(0, w.currentSpread || 0);
    const halfFov = (ctx.camera.fov * Math.PI) / 360;
    const px = (Math.tan(Math.min(spread, 1.2)) / Math.tan(halfFov)) * (window.innerHeight * 0.5);
    const target = clamp(4 + px - (melee && this.onTarget ? MELEE_INRANGE_TIGHTEN : 0), 4, 180);
    this.gap = this.shownGap < 0 ? target : damp(this.gap, target, 28, dt);
    if (Math.abs(this.gap - this.shownGap) > 0.25) {
      this.shownGap = this.gap;
      this.reticle.style.setProperty('--gap', `${this.gap.toFixed(1)}px`);
    }

    // 准星压到敌人身上时变红（每 3 帧检测一次，且被墙挡住不算；暂停 / 模态时不检测）；
    // 近战形态改为「下一段斩击此刻能砍到敌人」（武器系统按扇形判定给出），远处的敌人不再让括号变红
    if (this.frame % 3 === 0) {
      let on = false;
      const p = ctx.player;
      if (playing && p.alive) {
        if (melee) {
          on = w.meleeInRange ?? false;
        } else {
          p.getAimDirection(_dir);
          const hit = ctx.enemies.raycast(p.eye, _dir, 150);
          if (hit && hit.enemy.alive) on = !ctx.world.segmentBlocked(p.eye, hit.point);
        }
      }
      if (on !== this.onTarget) {
        this.onTarget = on;
        this.reticle.classList.toggle('is-target', on);
      }
    }

    // 换弹进度环
    const prog = w.isReloading ? clamp01(w.reloadProgress) : -1;
    const q = prog < 0 ? -1 : Math.round(prog * 100);
    if (q !== this.reloadShown) {
      if ((q < 0) !== (this.reloadShown < 0)) this.root.classList.toggle('is-reloading', q >= 0);
      this.reloadShown = q;
      if (q >= 0) this.reloadRing.style.strokeDashoffset = (RELOAD_RING_C * (1 - q / 100)).toFixed(2);
    }

    // 蓄力环：非蓄力武器 / 未蓄力时 chargeProgress 为 0（或未提供）
    // 只有真正蓄满才显示满格；未满时至少 1 格、至多 CHARGE_STEPS - 1 格
    const charge = w.chargeProgress ?? 0;
    this.setCharge(
      !(charge > 0) ? 0 : charge >= 1 ? CHARGE_STEPS : clamp(Math.round(charge * CHARGE_STEPS), 1, CHARGE_STEPS - 1),
    );
  }

  private setMelee(on: boolean): void {
    if (on === this.melee) return;
    this.melee = on;
    this.root.classList.toggle('is-melee', on);
  }

  private setStrike(on: boolean): void {
    if (on === this.strike) return;
    this.strike = on;
    this.root.classList.toggle('is-strike', on);
  }

  /** 写入蓄力环（量化值不变不写 DOM） */
  private setCharge(q: number): void {
    const prev = this.chargeShown;
    if (q === prev) return;
    this.chargeShown = q;
    if ((q > 0) !== (prev > 0)) this.chargeEl.hidden = q <= 0;
    if ((q >= CHARGE_STEPS) !== (prev >= CHARGE_STEPS)) this.chargeEl.classList.toggle('is-full', q >= CHARGE_STEPS);
    if (q > 0) this.chargeEl.style.setProperty('--p', (q / CHARGE_STEPS).toFixed(2));
  }

  private updateHitMarker(now: number): void {
    if (!this.hitActive) return;
    const kill = this.hitKind === HitKind.Kill;
    const dur = kill ? 420 : this.hitKind === HitKind.Crit ? 260 : 190;
    const e = (now - this.hitAt) / dur;
    if (e >= 1) {
      this.hitActive = false;
      this.hitEl.style.opacity = '0';
      return;
    }
    if (this.hitKind !== this.hitShownKind) {
      this.hitShownKind = this.hitKind;
      this.hitEl.classList.toggle('is-crit', this.hitKind === HitKind.Crit);
      this.hitEl.classList.toggle('is-kill', kill);
    }
    const scale = kill ? 1.5 - 0.35 * Math.min(1, e * 3) : this.hitKind === HitKind.Crit ? 1.2 - 0.2 * e : 1 + 0.12 * (1 - e);
    this.hitEl.style.opacity = (1 - e * e).toFixed(3);
    this.hitEl.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
  }

  // ───────────── 受击方向 ─────────────

  private updateDirs(now: number): void {
    const p = this.ctx.player;
    for (const d of this.dirs) {
      if (!d.active) continue;
      const e = (now - d.start) / DIR_MS;
      if (e >= 1) {
        d.active = false;
        d.source = null;
        d.lastOpacity = 0;
        d.el.style.opacity = '0';
        continue;
      }
      // 来源敌人仍活着则跟踪其当前位置
      if (d.source) {
        if (d.source.alive) {
          d.x = d.source.position.x;
          d.z = d.source.position.z;
        } else d.source = null;
      }
      const srcYaw = yawFromDir(d.x - p.position.x, d.z - p.position.z);
      // 正 yaw 向左转；来源在左侧时指示器应在屏幕左侧（CSS 逆时针为负角）
      const deg = -angleDiff(p.yaw, srcYaw) * DEG_PER_RAD;
      const op = d.strength * (e < 0.08 ? e / 0.08 : 1 - (e - 0.08) / 0.92);
      d.el.style.transform = `translate(-50%, -50%) rotate(${deg.toFixed(1)}deg)`;
      if (Math.abs(op - d.lastOpacity) > 0.01) {
        d.lastOpacity = op;
        d.el.style.opacity = op.toFixed(3);
      }
    }
  }

  /** 贯穿反馈：暗角闪（快起慢落）与方向刃光（跟随玩家转向） */
  private updateBladeFx(now: number): void {
    if (this.bladeFlashActive) {
      const e = (now - this.bladeFlashAt) / BLADE_FLASH_MS;
      if (e >= 1) {
        this.bladeFlashActive = false;
        this.bladeFlashEl.style.opacity = '0';
      } else {
        this.bladeFlashEl.style.opacity = ((1 - e) * (1 - e)).toFixed(3);
      }
    }
    const p = this.ctx.player;
    for (const d of this.bladeDirs) {
      if (!d.active) continue;
      const e = (now - d.start) / BLADE_DIR_MS;
      if (e >= 1) {
        d.active = false;
        d.el.style.opacity = '0';
        continue;
      }
      const deg = -angleDiff(p.yaw, yawFromDir(d.x - p.position.x, d.z - p.position.z)) * DEG_PER_RAD;
      const op = e < 0.1 ? e / 0.1 : 1 - (e - 0.1) / 0.9;
      d.el.style.transform = `translate(-50%, -50%) rotate(${deg.toFixed(1)}deg) scale(${(1 + 0.06 * (1 - e)).toFixed(3)})`;
      d.el.style.opacity = op.toFixed(3);
    }
  }

  private updateFlash(now: number): void {
    if (!this.flashActive) return;
    const e = (now - this.flashAt) / 380;
    if (e >= 1) {
      this.flashActive = false;
      this.flashEl.style.opacity = '0';
      return;
    }
    this.flashEl.style.opacity = (this.flashPeak * (1 - e) * (1 - e)).toFixed(3);
  }

  private updateLowHp(): void {
    const p = this.ctx.player;
    const max = Math.max(1, p.maxHp());
    const frac = p.alive ? p.hp / max : 0;
    const v = frac < 0.3 ? 0.45 + (1 - frac / 0.3) * 0.55 : 0;
    const q = Math.round(v * 50) / 50;
    if (q !== this.lowShown) {
      if ((q > 0) !== (this.lowShown > 0)) this.lowEl.classList.toggle('is-on', q > 0);
      this.lowShown = q;
      this.lowEl.style.opacity = q.toFixed(2);
    }
  }
}
