/**
 * 熔岩的两个机关：间歇熔泉（Unity LavaGeyser.cs）与熔流闸（Unity LavaSluice.cs）。
 *
 * 间歇熔泉：休止 → 预警 warnTime（品红圈填满、鼓泡、壳缝变亮）→ 喷发 eruptTime（熔柱冲起 height 米）→ 休止；周期 period、相位 phase。
 *   熔柱里的东西每次喷发只挨一次：玩家扣最大生命 playerDamage + 往上掀（playerLaunch m/s，带 2.5 m/s 离开喷口）；
 *   地面敌人（非首领）扣最大生命 enemyDamage（精英减半）+ 往外推，之后落进熔岩算被打进去；飞行敌人只扣血。
 *   岩壳：一个周期里玩家累计打够 shellHp × 难度就提前引爆（只预警 detonateWarn）。activeSite 给了就只在那个据点交战时按周期喷。
 * 熔流闸：射断吊钩（Destructible）或按 F 拉闸 → 预警 warn 秒（整条熔流道铺危险色长条）→ 熔流头按 frontSpeed 往下游推进，
 *   到哪一段那一段就从槽底下涨到槽岸以上 floodRise（涨的那一帧烧掉段里的地面敌人），duration 秒里走进 / 被打进的照样烧；
 *   再 fallTime 秒退回、熔岩段停用；还有次数就冷却 cooldown 秒。熔岩段第一次放的时候运行时建（LavaVolume.Create）。
 * 与 Unity 的差异：敌人「掀起」（LaunchUp）网页没有，熔泉只给水平推力 + 记击退；喷口壳缝的发光遮罩（cracks）这几张图都是空的。
 */
import * as THREE from 'three';
import type { IEnemy } from '../../core/types';
import { LavaTuning, type V3 } from './LavaCore';
import { LAVA_GOLD, LAVA_ORANGE, LavaVolumeRuntime, executeEnemy, findLavaTemplate } from './Lava';
import type { Activatable, MechanismHost } from './Host';
import type { LavaGeyserData, LavaSluiceData } from './MechanismData';
import { PartGroup } from './Parts';
import { DANGER, DANGER_INFERNO } from './Telegraph';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const flat = (dx: number, dz: number): number => Math.hypot(dx, dz);

export type GeyserState = 'idle' | 'warning' | 'erupting';

/** 熔泉的纯节奏（测试直接驱动）：给 now 推进状态，返回这一帧的事件 */
export class GeyserClock {
  state: GeyserState = 'idle';
  cycling = false;
  stateT = 0;
  stateLen = 0;
  nextAt = 0;
  eruptions = 0;

  constructor(readonly period: number, readonly phase: number, readonly warnTime: number, readonly eruptTime: number) {}

  /** 开 / 关按周期喷（开的时候从 now 起按相位排第一次预警：phase × period + 0.3 s） */
  setCycling(on: boolean, now: number): void {
    if (on === this.cycling) return;
    this.cycling = on;
    if (on) this.nextAt = now + ((this.phase % 1) + 1) % 1 * Math.max(0.5, this.period) + 0.3;
  }

  beginWarn(len: number): void {
    this.state = 'warning';
    this.stateT = 0;
    this.stateLen = Math.max(0.05, len);
  }

  /** 马上喷一次（warn 秒后）：正在喷的不打断，预警中的只会提前 */
  eruptNow(warn: number): void {
    if (this.state === 'erupting') return;
    if (this.state === 'warning') {
      this.stateLen = Math.min(this.stateLen, this.stateT + warn);
      return;
    }
    this.beginWarn(warn);
  }

  /** 推进 dt；返回 'warn' / 'erupt' / 'end' / null（这一帧发生的转换） */
  step(dt: number, now: number): 'warn' | 'erupt' | 'end' | null {
    switch (this.state) {
      case 'idle':
        if (this.cycling && now >= this.nextAt) {
          this.beginWarn(this.warnTime);
          return 'warn';
        }
        return null;
      case 'warning':
        this.stateT += dt;
        if (this.stateT >= this.stateLen) {
          this.state = 'erupting';
          this.stateT = 0;
          this.eruptions++;
          return 'erupt';
        }
        return null;
      case 'erupting':
        this.stateT += dt;
        if (this.stateT >= this.eruptTime) {
          this.state = 'idle';
          this.nextAt = now + Math.max(0.5, this.period - this.warnTime - this.eruptTime);
          return 'end';
        }
        return null;
    }
  }
}

export class LavaGeyser {
  readonly clock: GeyserClock;
  readonly base: THREE.Vector3;
  playerHits = 0;
  enemiesLaunched = 0;
  detonations = 0;
  shellDamage = 0;
  private forced = false;
  private playerHit = false;
  private readonly hit = new Set<IEnemy>();
  private readonly column: PartGroup | null;
  private readonly shell: PartGroup | null;
  private readonly shellBoxes: ReturnType<MechanismHost['parts']['collidersUnder']>;
  private bubbleAt = 0;
  private idleSparkAt = 0;
  private cancelTele: (() => void) | null = null;

  constructor(private readonly host: MechanismHost, readonly d: LavaGeyserData) {
    this.clock = new GeyserClock(d.period, d.phase, d.warnTime, d.eruptTime);
    this.base = new THREE.Vector3(...d.position);
    const colRoots = d.column ? host.parts.rootsUnder(d.column.scenePath) : [];
    this.column = colRoots.length ? new PartGroup(colRoots, d.column!.position, d.column!.rotation) : null;
    this.column?.setVisible(false);
    const shellRoots = d.shell ? host.parts.rootsUnder(d.shell) : [];
    this.shell = shellRoots.length ? new PartGroup(shellRoots, null) : null;
    this.shellBoxes = d.shell ? host.parts.collidersUnder(d.shell) : [];
    // 岩壳是靶子：玩家的子弹 / 近战打上去累计伤害
    for (const box of this.shellBoxes) box.onHit = (damage = 0) => this.onShellDamaged(damage);
    if (d.startActive && !d.activeSite) this.setCycling(true);
  }

  get state(): GeyserState { return this.clock.state; }
  get eruptions(): number { return this.clock.eruptions; }

  setCycling(on: boolean): void {
    this.forced = on;
    this.clock.setCycling(on, this.host.ctx.time.now);
  }

  eruptNow(warn = 0.6): void {
    if (this.clock.state === 'erupting') return;
    const w = warn > 0 ? warn : this.d.detonateWarn;
    const wasIdle = this.clock.state === 'idle';
    this.clock.eruptNow(w);
    if (wasIdle) this.onWarn();
  }

  /** 岩壳受击（Unity OnShellDamaged：持续伤害 / 敌人 / 环境不算；喷发中不算） */
  onShellDamaged(amount: number): void {
    if (this.clock.state === 'erupting' || !(amount > 0)) return;
    this.shellDamage += amount;
    this.host.ctx.fx.burst(_v.copy(this.base).setY(this.base.y + 0.6), LAVA_ORANGE, 3, 2, 0.35, 0.08, -4);
    if (this.shellDamage < this.d.shellHp * this.host.difficulty()) return;
    this.detonations++;
    this.host.ctx.audio.play('shield_break', { position: this.base, volume: 0.7, pitch: 0.7 });
    this.host.ctx.fx.burst(_v.copy(this.base).setY(this.base.y + 0.5), 0x332926, 14, 6, 0.6, 0.16, -12);
    this.showShell(false);
    this.eruptNow(this.d.detonateWarn);
  }

  update(dt: number): void {
    const ctx = this.host.ctx, now = ctx.time.now, d = this.d;
    if (d.activeSite && !this.forced) this.clock.setCycling(this.host.site(d.activeSite) === 'active', now);
    const ev = this.clock.step(dt, now);
    if (ev === 'warn') this.onWarn();
    else if (ev === 'erupt') this.onErupt();
    else if (ev === 'end') this.onEnd();
    switch (this.clock.state) {
      case 'idle':
        if (now >= this.idleSparkAt) {
          this.idleSparkAt = now + 0.8 + Math.random() * 0.8;
          ctx.fx.burst(_v.copy(this.base).setY(this.base.y + 0.5), LAVA_ORANGE, 2, 1.2, 0.6, 0.07, -2);
        }
        break;
      case 'warning': {
        const k = Math.min(1, this.clock.stateT / Math.max(0.05, this.clock.stateLen));
        if (now >= this.bubbleAt) {
          this.bubbleAt = now + 0.16 + (0.05 - 0.16) * k;
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * d.radius * 0.6;
          const c = new THREE.Color(LAVA_ORANGE).lerp(new THREE.Color(LAVA_GOLD), k).getHex();
          ctx.fx.burst(_v.set(this.base.x + Math.cos(a) * r, this.base.y + 0.4, this.base.z + Math.sin(a) * r), c, 3, 1.5 + 2 * k, 0.4, 0.1, -3);
        }
        break;
      }
      case 'erupting':
        this.stepColumn();
        this.affect();
        break;
    }
  }

  private onWarn(): void {
    const ctx = this.host.ctx;
    this.bubbleAt = 0;
    this.cancelTele?.();
    this.cancelTele = this.host.tele.circle(_v.copy(this.base).setY(this.base.y + 0.05), this.d.radius, this.clock.stateLen, this.host.inferno ? DANGER_INFERNO : DANGER);
    ctx.audio.play('burn_tick', { position: this.base, volume: 0.8, pitch: 0.55 });
    ctx.audio.play('telegraph', { position: this.base, volume: 0.5, pitch: 0.8 });
  }

  private onErupt(): void {
    const ctx = this.host.ctx, d = this.d;
    this.playerHit = false;
    this.hit.clear();
    this.column?.setVisible(true);
    this.column?.set(null, null, new THREE.Vector3(1, 0.01, 1));
    ctx.fx.burst(_v.copy(this.base).setY(this.base.y + 0.5), LAVA_ORANGE, 26, 9, 0.9, 0.16, -9);
    ctx.fx.burst(_v.copy(this.base).setY(this.base.y + d.height), LAVA_GOLD, 18, 5, 1.1, 0.12, -10);
    ctx.fx.ring(_v.copy(this.base).setY(this.base.y + 0.05), d.radius * 1.15, LAVA_ORANGE, 0.45);
    ctx.audio.play('skill_fire', { position: this.base, volume: 1, pitch: 0.55 });
    ctx.audio.play('explosion', { position: this.base, volume: 0.55, pitch: 0.7 });
    if (ctx.player.position.distanceTo(this.base) < 18) ctx.fx.shake(0.18, 0.35);
  }

  private onEnd(): void {
    this.column?.setVisible(false);
    this.host.ctx.fx.burst(_v.copy(this.base).setY(this.base.y + this.d.height * 0.6), LAVA_ORANGE, 10, 3, 0.8, 0.12, -12);
    this.shellDamage = 0;
    this.showShell(true);
  }

  /** 熔柱：0.15 s 冲到顶，喷的时候上下颤，最后 0.3 s 落回去 */
  private stepColumn(): void {
    if (!this.column) return;
    const t = this.clock.stateT, e = this.d.eruptTime;
    const up = Math.min(1, t / 0.15), down = Math.min(1, Math.max(0, (e - t) / 0.3));
    const h = this.d.height * Math.min(up, down) * (1 + 0.06 * Math.sin(t * 31));
    const w = (0.6 + 0.4 * up) * (1 + 0.05 * Math.sin(t * 23 + 1.3));
    this.column.set(null, null, _w.set(w, Math.max(0.01, h), w));
    if (Math.random() < 0.35) this.host.ctx.fx.burst(_v.copy(this.base).setY(this.base.y + h), LAVA_GOLD, 2, 3, 0.6, 0.1, -10);
  }

  /** 熔柱里的东西：玩家（每次喷发一次）扣血 + 掀起；地面敌人扣血 + 往外推；飞行敌人只扣血 */
  private affect(): void {
    const ctx = this.host.ctx, d = this.d, b = this.base;
    const r = d.radius + 0.4, top = b.y + d.height * Math.min(1, this.clock.stateT / 0.15);
    const p = ctx.player;
    if (!this.playerHit && p.alive) {
      const pp = p.position;
      if (flat(pp.x - b.x, pp.z - b.z) <= r && pp.y >= b.y - 1 && pp.y <= top) {
        this.playerHit = true;
        this.playerHits++;
        ctx.combat.damagePlayer(p.maxHp() * d.playerDamage, 'fire', null, b);
        const dx = pp.x - b.x, dz = pp.z - b.z, l = Math.hypot(dx, dz);
        const ax = l > 0.1 ? dx / l : 0, az = l > 0.1 ? dz / l : 0;
        p.applyImpulse(_w.set(ax * 2.5, d.playerLaunch, az * 2.5));
      }
    }
    const list = ctx.enemies.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e?.alive || this.hit.has(e)) continue;
      const ep = e.position;
      if (flat(ep.x - b.x, ep.z - b.z) > r + 0.3 || ep.y < b.y - 1 || ep.y > top) continue;
      this.hit.add(e);
      if (e.isBoss) continue;
      const frac = e.isElite ? d.enemyDamage * 0.5 : d.enemyDamage;
      ctx.combat.damageEnemy(e, { base: e.maxHp * frac, element: 'none', source: 'status', canCrit: false, point: _v.copy(ep).setY(ep.y + 1) });
      if (!e.alive || e.flying) continue;
      let dx = ep.x - b.x, dz = ep.z - b.z, l = Math.hypot(dx, dz);
      if (l < 0.1) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); l = 1; }
      e.knockback(_w.set(dx / l * d.enemyPush, d.enemyLaunch, dz / l * d.enemyPush));
      this.enemiesLaunched++;
      this.host.lava.noteKnocked(e);
    }
  }

  private showShell(on: boolean): void {
    if (!this.d.hideShellOnBurst || !this.shell) return;
    this.shell.setVisible(on);
    for (const box of this.shellBoxes) {
      const i = this.host.ctx.world.boxes.indexOf(box);
      if (on && i < 0) this.host.ctx.world.boxes.push(box);
      else if (!on && i >= 0) this.host.ctx.world.remove(box);
    }
  }

  dispose(): void {
    this.cancelTele?.();
  }
}

// ───────────────────────────── 熔流闸 ─────────────────────────────

export type SluiceState = 'ready' | 'warning' | 'flowing' | 'receding' | 'cooldown' | 'spent';

export interface SluiceSegment { center: V3; yaw: number; length: number; start: number; ground: number }

/**
 * 沿折线切段（Unity BuildSegments）：每段 ≤ segmentLength，段与段首尾相接；拐角处各往外多盖 0.35 × 宽，免得拐角漏一块。
 * yaw = 段的朝向（度，网页：atan2(dx, dz)；同 Quaternion.LookRotation(dir).eulerAngles.y 在镜像后的值）
 */
export function sluiceSegments(path: readonly (readonly number[])[], width: number, segmentLength: number): { segments: SluiceSegment[]; length: number } {
  const segments: SluiceSegment[] = [];
  let acc = 0;
  if (path.length < 2) return { segments, length: 0 };
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    const fx = b[0] - a[0], fz = b[2] - a[2];
    const len = Math.hypot(fx, fz);
    if (len < 0.05) continue;
    const dx = fx / len, dz = fz / len;
    const n = Math.max(1, Math.ceil(len / Math.max(1, segmentLength)));
    for (let k = 0; k < n; k++) {
      const s0 = len * k / n, s1 = len * (k + 1) / n;
      const pad0 = k === 0 && i > 0 ? width * 0.35 : 0, pad1 = k === n - 1 && i + 2 < path.length ? width * 0.35 : 0;
      const p0x = a[0] + dx * (s0 - pad0), p0z = a[2] + dz * (s0 - pad0);
      const p1x = a[0] + dx * (s1 + pad1), p1z = a[2] + dz * (s1 + pad1);
      const ground = a[1] + (b[1] - a[1]) * ((s0 + s1) * 0.5 / len);
      segments.push({
        center: { x: (p0x + p1x) * 0.5, y: ground, z: (p0z + p1z) * 0.5 }, yaw: Math.atan2(dx, dz) * 180 / Math.PI,
        length: (s1 + pad1) - (s0 - pad0), start: acc + s0, ground,
      });
    }
    acc += len;
  }
  return { segments, length: acc };
}

export class LavaSluice implements Activatable {
  phase: SluiceState = 'ready';
  fired = 0;
  kills = 0;
  flowStartedAt = -1;
  readonly segments: SluiceSegment[];
  readonly length: number;
  private readonly volumes: (LavaVolumeRuntime | null)[] = [];
  private readonly started: boolean[] = [];
  private phaseAt = 0;
  private readyAt = 0;
  private emberAcc = 0;
  private tilt = 0;
  private leverAngle = -35;
  private readonly ladle: PartGroup | null;
  private readonly lever: PartGroup | null;
  private readonly pour: PartGroup | null;
  private readonly hookOff: (() => void) | null = null;
  private readonly interactOff: (() => void) | null = null;
  private readonly tiltAxis: THREE.Vector3;

  constructor(private readonly host: MechanismHost, readonly d: LavaSluiceData) {
    const built = sluiceSegments(d.path, d.width, d.segmentLength);
    this.segments = built.segments;
    this.length = built.length;
    this.scenePath = d.scenePath;
    this.ladle = d.ladle ? new PartGroup(host.parts.rootsUnder(d.ladle.scenePath), d.ladle.position, d.ladle.rotation) : null;
    this.lever = d.lever ? new PartGroup(host.parts.rootsUnder(d.lever.scenePath), d.lever.position, d.lever.rotation) : null;
    const pourRoots = d.pour ? host.parts.rootsUnder(d.pour) : [];
    this.pour = pourRoots.length ? new PartGroup(pourRoots, null) : null;
    this.pour?.setVisible(false);
    this.tiltAxis = new THREE.Vector3(...d.tiltAxis).normalize();
    if (d.trigger !== 'lever' && d.hook) {
      const hook = host.activatable(d.hook) as (Activatable & { onBroken?: (fn: () => void) => void }) | null;
      hook?.onBroken?.(() => {
        if (this.release()) host.ctx.ui.toast(`${d.title} · 吊钩断了，浇包倾倒！`, '#ff801f');
      });
    }
    if (d.trigger !== 'hook') {
      const focus = this.focus();
      this.interactOff = host.ctx.interact.add({
        position: focus, radius: 3.2,
        get enabled() { return true; },
        prompt: () => ({
          title: d.title,
          subtitle: this.phase === 'ready' ? `拉闸（还能放 ${this.usesLeft} 次）` : this.promptText(),
          lines: ['熔流顺槽冲下去 6 秒：槽里和槽岸上的地面敌人一律烧死', '站在槽里的自己也会被烫——拉完离开熔流道'],
          color: '#ff801f',
        }),
        onInteract: () => this.interact(),
      } as never);
    }
  }

  readonly scenePath: string;

  private focus(): THREE.Vector3 {
    const p = this.d.lever?.position ?? this.d.position;
    return new THREE.Vector3(p[0], p[1] + 0.2, p[2]);
  }

  private get maxUses(): number { return this.d.trigger === 'hook' ? 1 : Math.max(1, this.d.uses); }
  get usesLeft(): number { return Math.max(0, this.maxUses - this.fired); }
  get canRelease(): boolean { return this.phase === 'ready' && this.fired < this.maxUses && this.segments.length > 0; }
  get cooldownLeft(): number { return this.phase === 'cooldown' ? Math.max(0, this.readyAt - this.host.ctx.time.now) : 0; }
  get volumesBuilt(): readonly (LavaVolumeRuntime | null)[] { return this.volumes; }

  private promptText(): string {
    switch (this.phase) {
      case 'ready': return `拉开${this.d.title}`;
      case 'cooldown': return `${this.d.title}冷却中 · ${this.cooldownLeft.toFixed(0)} s`;
      case 'spent': return `${this.d.title}已经放空`;
      default: return `${this.d.title}正在放熔流`;
    }
  }

  onActivated(on: boolean): void {
    if (on) this.release();
  }

  private interact(): void {
    if (this.phase === 'cooldown' || this.phase === 'spent' || !this.release()) return;
    this.host.ctx.audio.play('boss_slam', { position: this.focus(), volume: 0.6, pitch: 0.7 });
  }

  /** 放熔流（吊钩断了、拉闸、测试）。force = 不管冷却 / 次数 */
  release(force = false): boolean {
    if (this.segments.length === 0) return false;
    if (!force && !this.canRelease) return false;
    if (this.phase === 'warning' || this.phase === 'flowing') return false;
    const ctx = this.host.ctx, d = this.d;
    this.fired++;
    this.phase = 'warning';
    this.phaseAt = ctx.time.now;
    this.started.fill(false);
    const total = d.warn + this.length / Math.max(1, d.frontSpeed);
    const color = this.host.inferno ? DANGER_INFERNO : DANGER;
    for (let i = 0; i + 1 < d.path.length; i++) {
      this.host.tele.lane(new THREE.Vector3(...d.path[i]).setY(d.path[i][1] + 0.05), new THREE.Vector3(...d.path[i + 1]).setY(d.path[i + 1][1] + 0.05),
        d.width, Math.max(0.2, total), color);
    }
    const p0 = new THREE.Vector3(...d.path[0]);
    ctx.audio.play('telegraph', { position: p0, volume: 0.8, pitch: 0.7 });
    ctx.audio.play('burn_tick', { position: p0, volume: 0.9, pitch: 0.5 });
    return true;
  }

  update(dt: number): void {
    const now = this.host.ctx.time.now, d = this.d;
    this.stepLever(dt);
    this.stepLadle(dt);
    switch (this.phase) {
      case 'warning':
        if (now - this.phaseAt >= d.warn) this.beginFlow(now);
        break;
      case 'flowing':
        this.stepFlow(now, dt);
        if (now - this.phaseAt >= d.duration) this.beginRecede(now);
        break;
      case 'receding':
        if (now - this.phaseAt >= d.fallTime + 0.1) this.endFlow(now);
        break;
      case 'cooldown':
        if (now >= this.readyAt) this.phase = 'ready';
        break;
    }
  }

  private beginFlow(now: number): void {
    const ctx = this.host.ctx, p0 = new THREE.Vector3(...this.d.path[0]);
    this.phase = 'flowing';
    this.phaseAt = now;
    this.flowStartedAt = now;
    this.pour?.setVisible(true);
    if (ctx.player.position.distanceTo(p0) < 40) ctx.fx.shake(0.25, 0.5);
    ctx.audio.play('skill_fire', { position: p0, volume: 1, pitch: 0.55 });
    ctx.fx.burst(p0.setY(p0.y + 0.8), 0xff801f, 26, 7, 0.8, 0.18, -3);
  }

  private stepFlow(now: number, dt: number): void {
    const front = (now - this.phaseAt) * Math.max(1, this.d.frontSpeed);
    for (let i = 0; i < this.segments.length; i++) {
      if (this.started[i] || this.segments[i].start > front) continue;
      this.startSegment(i);
    }
    this.scorchAll(false);
    this.emberAcc += dt;
    if (this.emberAcc >= 0.25 && front < this.length + this.d.width) {
      this.emberAcc = 0;
      const head = this.pointAt(Math.min(front, this.length));
      this.host.ctx.fx.burst(head.setY(head.y + 0.4), 0xff801f, 10, 5, 0.6, 0.15, -3);
    }
  }

  private startSegment(i: number): void {
    this.started[i] = true;
    const s = this.segments[i];
    const v = this.volumeFor(i);
    v.setActive(true);
    v.riseTo(s.ground + this.d.floodRise, Math.max(0.05, this.d.riseTime), 0);
    this.scorchSegment(i, true);
    this.host.ctx.fx.burst(new THREE.Vector3(s.center.x, s.center.y + 0.3, s.center.z), 0xff801f, 8, 4, 0.5, 0.14, -2);
  }

  /** 第 i 段的熔岩（第一次放时建：中心在槽岸地面以下 restDrop，深 restDrop + 1，顺槽往下游流 1.4 m/s） */
  volumeFor(i: number): LavaVolumeRuntime {
    const existing = this.volumes[i];
    if (existing) return existing;
    const s = this.segments[i], d = this.d;
    const v = new LavaVolumeRuntime(this.host.lava, `${d.scenePath} · 熔流 ${i + 1}`, { x: s.center.x, y: s.ground - d.restDrop, z: s.center.z },
      // 段的局部 +Z 顺槽：s.yaw = atan2(dx, dz)（网页坐标）= −Unity eulerAngles.y，正是 LavaBody 在网页里要的 yaw
      s.yaw, 'box', [d.width, s.length], d.restDrop + 1, { enabled: false, height: 0, lowHold: 0, warn: 0, rise: 0, highHold: 0, fall: 0, offset: 0 }, [0, 1.4]);
    const template = findLavaTemplate(this.host.parts);
    if (template) v.buildSurface(this.host.group, template, true);
    this.host.lava.register(v);
    v.setActive(false);
    this.volumes[i] = v;
    return v;
  }

  private beginRecede(now: number): void {
    this.phase = 'receding';
    this.phaseAt = now;
    for (const v of this.volumes) if (v?.active) v.recede(this.d.fallTime);
    this.pour?.setVisible(false);
  }

  private endFlow(now: number): void {
    for (const v of this.volumes) v?.setActive(false);
    this.started.fill(false);
    if (this.fired < this.maxUses) {
      this.phase = 'cooldown';
      this.readyAt = now + Math.max(0, this.d.cooldown);
    } else this.phase = 'spent';
  }

  private scorchAll(fresh: boolean): void {
    for (let i = 0; i < this.segments.length; i++) if (this.started[i]) this.scorchSegment(i, fresh);
  }

  /** 烧这一段里的地面敌人：刚涨（fresh）时整段一律烧；之后熔岩面要涨到槽岸以上（−0.2 m）才烧 */
  scorchSegment(i: number, fresh: boolean): void {
    const s = this.segments[i], d = this.d;
    const v = this.volumes[i];
    const level = v ? v.level : s.ground + d.floodRise;
    if (!fresh && level < s.ground - 0.2) return;
    const hx = d.width * 0.5 + 0.4, hz = s.length * 0.5 + 0.2;
    const top = (fresh ? s.ground + d.floodRise : level) + LavaTuning.StandRise + 0.3;
    // 段的局部坐标（同 LavaBody.toLocal，yaw 约定见 volumeFor）
    const r = s.yaw * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    for (const e of [...this.host.ctx.enemies.list]) {
      if (!e.alive || this.host.lava.isImmune(e)) continue;
      const f = e.position;
      if (f.y > top || f.y < s.ground - d.restDrop - 1) continue;
      const dx = f.x - s.center.x, dz = f.z - s.center.z;
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
      if (Math.abs(lx) > hx || Math.abs(lz) > hz) continue;
      this.scorch(e);
    }
  }

  private scorch(e: IEnemy): void {
    if (!e.alive) return;
    this.host.lava.noteKnocked(e);
    const at = e.position.clone().setY(e.position.y + 0.3);
    const ctx = this.host.ctx;
    ctx.fx.burst(at, LAVA_ORANGE, 30, 6, 1, 0.13, -3);
    ctx.fx.burst(at, LAVA_GOLD, 14, 4, 0.7, 0.08, -5);
    ctx.audio.play('skill_fire', { position: at, volume: 0.9, pitch: 0.65 });
    executeEnemy(ctx, e, at);
    this.kills++;
  }

  /** 熔流道上沿程 s 米处的点（y = 槽岸地面） */
  pointAt(s: number): THREE.Vector3 {
    const path = this.d.path;
    if (!path.length) return new THREE.Vector3(...this.d.position);
    let acc = 0;
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (acc + len >= s || i + 2 === path.length) {
        const t = len > 0 ? Math.min(1, Math.max(0, (s - acc) / len)) : 0;
        return new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
      }
      acc += len;
    }
    return new THREE.Vector3(...path[path.length - 1]);
  }

  private stepLadle(dt: number): void {
    if (!this.ladle || this.ladle.empty) return;
    const d = this.d;
    const tipped = this.phase === 'warning' || this.phase === 'flowing' || this.phase === 'receding' || (this.phase === 'spent' && this.fired > 0);
    const want = tipped ? d.tiltAngle : 0;
    if (Math.abs(this.tilt - want) < 1e-4) return;
    const rate = Math.abs(d.tiltAngle) / Math.max(0.1, tipped ? d.tiltSeconds : d.tiltSeconds * 2);
    this.tilt = Math.abs(want - this.tilt) <= dt * rate ? want : this.tilt + Math.sign(want - this.tilt) * dt * rate;
    const k = Math.abs(d.tiltAngle) > 0.01 ? this.tilt / d.tiltAngle : 0;
    const eased = k * k * (3 - 2 * k);
    this.ladle.set(null, new THREE.Quaternion().setFromAxisAngle(this.tiltAxis, d.tiltAngle * eased * Math.PI / 180));
  }

  private stepLever(dt: number): void {
    if (!this.lever || this.lever.empty || this.d.trigger === 'hook') return;
    const down = this.phase === 'warning' || this.phase === 'flowing' || this.phase === 'receding' || this.phase === 'spent';
    const want = down ? 55 : -35;
    const before = this.leverAngle;
    this.leverAngle = Math.abs(want - before) <= dt * 180 ? want : before + Math.sign(want - before) * dt * 180;
    // 杆绕本地 X 从 −35° 起（场景里摆的就是 −35°）：增量 = 现在 − (−35)
    this.lever.set(null, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (this.leverAngle + 35) * Math.PI / 180));
  }

  dispose(): void {
    this.interactOff?.();
    this.hookOff?.();
  }
}
