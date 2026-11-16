/**
 * 旱魃的六个招式（Unity Hanba/Moves/HanbaMove.cs、Phase1SunSweep / Phase1HotWind / Phase1SandWraiths / Phase2CrackLine / Phase2ApsaraCall / Phase3Eclipse 逐个翻译）。
 * 常量与时间轴在 HanbaPlans.ts（一处改数）；角度一律世界 yaw（度，0 = +Z，方向 = (sin, 0, cos)），设朝向时换成弧度。
 * 动作：act / actAt 播 HanbaAnimator 的片段，整段按「出手事件落在前摇结束（提前约一帧）」拉伸；windupDone 是 cue(出手事件, 前摇)——事件先到先算，没事件按时间兜底。
 * 特效走 HanbaFx（ctx.fx 的组合，精神对齐）；与 Unity 不同的地方写在各招注释里。
 */
import * as THREE from 'three';
import { clamp, clamp01 } from '../../core/math';
import { BossMove } from './framework/BossMove';
import type { BeamMesh } from './Visuals';
import type { Hanba } from './Hanba';
import { HanbaDef } from './HanbaDef';
import * as Fx from './HanbaFx';
import { actAtSeconds, ApsaraCall, clipSeconds, CrackLine, Eclipse, HotWind, SandWraiths, SunSweep } from './HanbaPlans';

const DEG = Math.PI / 180;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _r = new THREE.Vector3(), _u = new THREE.Vector3();
const _hit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as never };

export function dirOf(yawDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.sin(yawDeg * DEG), 0, Math.cos(yawDeg * DEG));
}

export abstract class HanbaMove extends BossMove {
  /** 本次出招的阶段节奏 / 实际前摇 */
  paceNow = 1;
  windNow = 0;
  private readonly seen = new Set<string>();

  constructor(spec: BossMove['spec'], protected readonly h: Hanba) {
    super(spec);
  }

  protected get ctx() {
    return this.h.ctx;
  }

  protected get hz() {
    return this.h.hazards;
  }

  protected override onStart(): void {
    this.paceNow = this.h.pace;
    this.seen.clear();
    this.prepare();
  }

  protected prepare(): void {}

  protected act(state: string, seconds: number): void {
    this.h.act(state, seconds);
  }

  /** 播招式动作，让出手事件（片段里的位置 = hitFraction）落在 hitAt 秒之前约一帧 */
  protected actAt(state: string, hitFraction: number, hitAt: number): void {
    this.act(state, actAtSeconds(hitFraction, hitAt));
  }

  /** 前摇 = 定义前摇 ÷ 阶段节奏 × 狂怒前摇倍率 */
  protected windupFor(base: number): number {
    return (this.windNow = Math.max(0.25, base / Math.max(0.5, this.paceNow) * this.host.windupScale));
  }

  protected fixedWindup(seconds: number): number {
    return (this.windNow = Math.max(0.05, seconds));
  }

  override onAnimEvent(name: string): void {
    super.onAnimEvent(name);
    if (!name) return;
    this.seen.add(name);
    if (name.startsWith('fx:') && name !== 'fx:shake') this.onFxCue(name.slice(3));
  }

  protected onFxCue(_cue: string): void {}

  /** 释放帧的分量：她自己的动作顿 hold 秒 + 震屏；出手按时间兜底先到时，顿帧等事件到了再顿 */
  protected impact(hold: number, shake: number, shakeSeconds = 0.4, range = 60, cue: string | null = null): void {
    if (cue !== null && !this.seen.has(cue)) this.h.impactHoldOn(cue, hold);
    else this.h.impactHold(hold);
    if (shake > 0) this.h.quake(shake, shakeSeconds, range);
  }

  protected get facingDeg(): number {
    return this.h.facing / DEG;
  }

  protected get yawToPlayer(): number {
    const p = this.ctx.player.position, b = this.h.position;
    const dx = p.x - b.x, dz = p.z - b.z;
    return dx * dx + dz * dz > 1e-4 ? Math.atan2(dx, dz) / DEG : this.facingDeg;
  }

  protected setFacing(yawDeg: number): void {
    this.h.facing = yawDeg * DEG;
  }

  protected turnTo(yawDeg: number, degPerSec: number, dt: number): void {
    this.h.turnToward(yawDeg * DEG, degPerSec * DEG, dt);
  }

  /** 首领脚下水平面上的点贴到地面 */
  protected onGround(p: THREE.Vector3, above = 6): THREE.Vector3 {
    p.y = this.h.groundY(p.x, p.z, this.h.position.y + above);
    return p;
  }

  protected sfx(id: string, volume = 1, pitch = 1): void {
    this.h.playSfx(id, volume, pitch);
  }

  protected override onEnd(_cancelled: boolean): void {
    this.h.ring.idle();
    this.h.glow(0, 0);
  }
}

// ───────────────────────────── 日轮扫射 ─────────────────────────────

/**
 * 日轮扫射（一阶段「烈日」）：前摇 1.4 s ÷ 节奏举手召日，地面亮起始长条 + 扫射扇区，日轮到起始落点拉一根细瞄准线；
 * 出手：日轮心射出光束，落点在出招时玩家的距离（7–26 m）那一圈上，从玩家一侧 55° 扫到另一侧 55°（48°/s × 节奏）；
 * 光束从轮心朝落点打射线，中途被岩岛、楼阁、沙丘挡住就停在那里（挡板后面就是影子）。每帧按落点每 0.5 m 一段细分判定，
 * 碰到玩家就灼伤（每 0.45 s 至多一次）并额外叠日晒。收招 1 s 泉珠露出。
 * 与 Unity 的差异：落点一路烧出的日火贴花（FxDecals.Fire）与火苗（FlameTongues）换成火星粒子。
 */
export class SunSweepMove extends HanbaMove {
  range = 0;
  startYaw = 0;
  swept = 0;
  hits = 0;
  totalHits = 0;
  blocked = 0;
  private yaw = 0;
  private sign = 1;
  private speed = 0;
  private wind = 0;
  private nextHit = 0;
  private soundAcc = 0;
  private sprayAcc = 0;
  private scorchAcc = 0;
  private readonly lastEnd = new THREE.Vector3();
  private aim: BeamMesh | null = null;
  private beam: BeamMesh | null = null;
  private halo: BeamMesh | null = null;

  constructor(h: Hanba) {
    super(SunSweep.spec, h);
  }

  override weightNow(): number {
    return SunSweep.weight(this.weight, this.h.distToPlayerXZ());
  }

  protected override prepare(): void {
    this.range = clamp(this.h.distToPlayerXZ(), SunSweep.MinRange, SunSweep.MaxRange);
    this.sign = this.ctx.rng.next() < 0.5 ? -1 : 1;
    this.startYaw = this.yawToPlayer - this.sign * SunSweep.Arc * 0.5;
    this.yaw = this.startYaw;
    this.swept = this.hits = this.blocked = 0;
    this.nextHit = 0;
    this.speed = SunSweep.Speed * this.paceNow;
    this.wind = this.windupFor(this.windup);
    this.h.halt();
    this.h.ring.setBlaze(1, 3);
    this.aim = this.hz.beam(Fx.AIM);
  }

  protected override onTelegraph(): void {
    const o = this.onGround(_a.copy(this.h.position));
    this.track(this.hz.lineWarning(o.x, o.y, o.z, this.startYaw * DEG, this.range, 1.1, this.wind, HanbaDef.Warn));
    this.track(this.hz.sectorWarning(o.x, o.y, o.z, (this.startYaw + this.sign * SunSweep.Arc * 0.5) * DEG, SunSweep.Arc * 0.5 * DEG, this.range + 2, this.wind, HanbaDef.Warn));
    Fx.focusSeal(this.ctx, this.endPoint(this.startYaw, _b).point, 1.6, this.wind);
    this.actAt('sunSweep', SunSweep.ClipHit, this.wind);
    this.sfx('telegraph', 1, 0.9);
    this.sfx('enemy_charge', 0.9, 0.6);
  }

  protected override get windupDone(): boolean {
    return this.cue('beamStart', this.wind);
  }

  protected override onWindup(dt: number): void {
    this.turnTo(this.startYaw, 150, dt);
    const u = clamp01(this.stageT / Math.max(0.01, this.wind));
    this.h.glow(0, u);
    const c = this.h.ring.center(_c);
    this.aim?.set(c, this.endPoint(this.startYaw, _b).point, 0.03 + 0.05 * u);
    const radius = this.h.ring.frame(_r, _u);
    Fx.ringGather(this.ctx, c, _r, _u, radius, u * u);
  }

  protected override onActiveBegin(): void {
    this.hz.releaseBeam(this.aim);
    this.aim = null;
    this.beam = this.hz.beam(Fx.BEAM);
    this.halo = this.hz.beam(0xffbd47);
    this.h.ring.flash(1);
    const hub = this.h.ring.center(_c);
    const radius = this.h.ring.frame(_r, _u);
    const first = this.endPoint(this.yaw, _b).point;
    Fx.sunFlare(this.ctx, hub, 2.4);
    Fx.sunStrike(this.ctx, hub, first, radius);
    this.lastEnd.copy(first);
    this.sfx('shot_beam', 1, 0.5);
    this.sfx('explosion', 0.35, 1.5);
    this.impact(0.07, 0.35, 0.35, 60, 'beamStart');
  }

  protected override onActive(dt: number): void {
    const prev = this.yaw;
    let step = this.speed * dt;
    if (this.swept + step > SunSweep.Arc) step = Math.max(0, SunSweep.Arc - this.swept);
    this.yaw += this.sign * step;
    this.swept += step;
    this.setFacing(this.yaw);
    this.h.glow(0, 1);
    const c = this.h.ring.center(_c);
    const n = Math.max(1, Math.ceil(Math.abs(this.yaw - prev) * DEG * this.range / SunSweep.SubStep));
    const end = _d.copy(c);
    for (let i = 1; i <= n; i++) {
      const a = prev + (this.yaw - prev) * i / n;
      const e = this.endPoint(a, _b);
      end.copy(e.point);
      if (i === n && e.blocked) this.blocked++;
      if (this.ctx.time.now < this.nextHit || !this.hz.segmentHitsPlayer(c, end, SunSweep.HitRadius)) continue;
      this.nextHit = this.ctx.time.now + SunSweep.HitEvery;
      if (this.hz.hurt(this.damage(SunSweep.DamageMult), 'fire', c) > 0) {
        this.hits++;
        this.totalHits++;
      }
      this.h.exposure.burnFor(SunSweep.BurnSeconds, c);
    }
    this.beam?.set(c, end, SunSweep.VisualRadius);
    this.halo?.set(c, end, 1.5 * 0.5);
    this.halo?.setOpacity(0.35);
    Fx.beamEdge(this.ctx, end);
    this.lastEnd.copy(end);
    this.scorchAcc += dt;
    if (this.scorchAcc >= 0.12) {
      this.scorchAcc = 0;
      this.ctx.fx.burst(end, Fx.CRACK, 3, 1.8, 0.7, 0.16, -1.5);
    }
    this.sprayAcc += dt;
    if (this.sprayAcc >= 0.18) {
      this.sprayAcc = 0;
      Fx.sandBlast(this.ctx, _a.copy(end).setY(end.y + 0.1), 0.5);
    }
    this.soundAcc += dt;
    if (this.soundAcc >= 0.35) {
      this.soundAcc = 0;
      this.sfx('shot_beam', 0.45, 0.55);
    }
  }

  protected override get activeDone(): boolean {
    return this.swept >= SunSweep.Arc - 1e-3;
  }

  protected override onRecoverBegin(): void {
    Fx.beamFade(this.ctx, this.h.ring.center(_c), this.lastEnd);
    this.h.ring.idle();
    this.h.glow(0, 0);
    this.hz.releaseBeam(this.halo);
    this.halo = null;
  }

  protected override onRecover(_dt: number): void {
    if (!this.beam) return;
    if (this.stageT >= SunSweep.FadeSeconds) {
      this.hz.releaseBeam(this.beam);
      this.beam = null;
      return;
    }
    const k = 1 - this.stageT / SunSweep.FadeSeconds;
    this.beam.set(this.h.ring.center(_c), this.lastEnd, SunSweep.VisualRadius * k * k);
  }

  /** fx:raise（手举到顶那一下）：日轮先亮一下 */
  protected override onFxCue(cue: string): void {
    if (cue === 'raise') this.h.ring.flash(0.45);
  }

  /** 角度 a 处的光束终点：落点 = 首领脚下沿 a 方向 range 米处的地面；轮心朝落点打射线，中途打到世界几何就停在那里 */
  endPoint(a: number, out: THREE.Vector3): { point: THREE.Vector3; blocked: boolean } {
    const c = this.h.ring.center(new THREE.Vector3());
    const g = this.onGround(out.copy(this.h.position).addScaledVector(dirOf(a, _a), this.range));
    const d = _a.subVectors(g, c);
    const len = d.length();
    if (len < 0.1) return { point: g, blocked: false };
    d.multiplyScalar(1 / len);
    const hit = this.ctx.world.raycast(c, d, len - 0.05, _hit as never);
    if (hit) return { point: g.copy(hit.point), blocked: true };
    return { point: g, blocked: false };
  }

  protected override onEnd(cancelled: boolean): void {
    this.hz.releaseBeam(this.aim);
    this.hz.releaseBeam(this.beam);
    this.hz.releaseBeam(this.halo);
    this.aim = this.beam = this.halo = null;
    super.onEnd(cancelled);
  }
}

// ───────────────────────────── 旱风 ─────────────────────────────

/**
 * 旱风（一阶段）：前摇 1.1 s ÷ 节奏双臂后收蓄力，前半段还跟着玩家转；地面亮一片 22 m、半角 38° 的沙色扇区。
 * 出手：向前推掌，掀起一道扇形热浪（26 m/s 扩到 22 m，环带 3 m 厚、4.5 m 高——跳不过去，只能躲到掩体后或出扇区），
 * 打中：灼伤 + 水平 15 m/s 推开 + 扬沙闪屏 + 额外叠 1 s 日晒。二阶段起 0.35 s 后补一道余波（半伤、推力减半）。收招 0.9 s。
 * 与 Unity 的差异：贴着冲击波前沿往外推的沙幕（Surge.Sheet）换成热浪光墙自带的扬沙。
 */
export class HotWindMove extends HanbaMove {
  hitThisCast = false;
  yaw = 0;
  totalHits = 0;
  waves = 0;
  private wind = 0;
  private hits0 = 0;
  private aftershock = false;

  constructor(h: Hanba) {
    super(HotWind.spec, h);
  }

  override weightNow(): number {
    return HotWind.weight(this.weight, this.h.distToPlayerXZ());
  }

  protected override prepare(): void {
    this.h.halt();
    this.yaw = this.yawToPlayer;
    this.setFacing(this.yaw);
    this.wind = this.windupFor(this.windup);
    this.hitThisCast = this.aftershock = false;
    this.waves = 0;
    this.hits0 = this.h.playerHits;
    this.h.ring.setBlaze(0.7, 1.6);
  }

  protected override onTelegraph(): void {
    const o = this.onGround(_a.copy(this.h.position));
    this.track(this.hz.sectorWarning(o.x, o.y, o.z, this.yaw * DEG, HotWind.HalfAngle * DEG, HotWind.Range, this.wind, HanbaDef.Sand));
    this.actAt('droughtGale', HotWind.ClipHit, this.wind);
    this.sfx('telegraph', 1, 0.8);
  }

  protected override get windupDone(): boolean {
    return this.cue('hit', this.wind);
  }

  protected override onWindup(dt: number): void {
    if (this.stageT < this.wind * 0.5) {
      let d = this.yawToPlayer - this.yaw;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      this.yaw += clamp(d, -12, 12) * Math.min(1, dt * 4);
      this.turnTo(this.yaw, 180, dt);
    }
    const u = clamp01(this.stageT / Math.max(0.01, this.wind));
    this.h.glow(0, u);
    Fx.galeInhale(this.ctx, this.onGround(_a.copy(this.h.position)), this.yaw * DEG, HotWind.HalfAngle, u);
  }

  protected override onActiveBegin(): void {
    this.setFacing(this.yaw);
    this.gust(this.damage(HotWind.DamageMult), HotWind.Knockback);
    this.h.ring.flash(0.9);
    const palms = this.h.hand(true, _c).lerp(this.h.hand(false, _d), 0.5);
    Fx.galeFront(this.ctx, this.onGround(_a.copy(this.h.position)).addScaledVector(dirOf(this.yaw, _b), this.h.radius + 0.8), palms);
    this.impact(0.06, 0.45, 0.4, 40, 'hit');
    this.sfx('boss_roar', 0.55, 1.45);
    this.sfx('explosion', 0.4, 0.6);
  }

  private gust(damage: number, knock: number): void {
    const o = this.onGround(_a.copy(this.h.position)).addScaledVector(dirOf(this.yaw, _b), this.h.radius * 0.5);
    o.y = this.lipY(o);
    this.hz.wave({
      x: o.x, y: o.y, z: o.z, speed: HotWind.Speed, maxRadius: HotWind.Range, startRadius: this.h.radius + 0.5, width: HotWind.Width,
      height: HotWind.Height, damage, color: Fx.HEAT, arcCenter: this.yaw * DEG, arcHalf: HotWind.HalfAngle * DEG, knockback: knock,
      element: 'fire', dust: HanbaDef.Sand,
    });
    this.waves++;
    for (let i = 0; i < 6; i++) {
      const p = _c.copy(o).addScaledVector(dirOf(this.yaw + this.ctx.rng.range(-HotWind.HalfAngle, HotWind.HalfAngle), _d), this.ctx.rng.range(3, HotWind.Range * 0.7));
      this.onGround(p).y += 0.5;
      this.ctx.fx.burst(p, HanbaDef.Sand, 5, 5, 0.8, 0.3, -0.3);
    }
  }

  /** 热浪贴地铺开的高度：悬在低洼里（泉床，比岸上低 1.4 m）时按正前方 8 m 内的岸坎高度铺出去，最多抬 2 m */
  private lipY(o: THREE.Vector3): number {
    let y = o.y;
    const dir = dirOf(this.yaw, _d);
    for (let d = 1; d <= 8; d++) y = Math.max(y, this.h.groundY(o.x + dir.x * d, o.z + dir.z * d, o.y + 6));
    return Math.min(y, o.y + 2);
  }

  protected override onActive(_dt: number): void {
    if (!this.aftershock && this.paceNow > 1.01 && this.stageT >= 0.35) {
      this.aftershock = true;
      this.gust(this.damage(HotWind.DamageMult * 0.5), HotWind.Knockback * 0.5);
    }
    if (this.hitThisCast || this.h.playerHits <= this.hits0) return;
    this.hitThisCast = true;
    this.totalHits++;
    Fx.screenFlash(this.ctx, 'rgb(217,168,102)', 0.45, 0.6);
    this.h.exposure.burnFor(HotWind.BurnSeconds, this.h.getBodyCenter(_a));
  }

  protected override get activeDone(): boolean {
    return this.stageT >= HotWind.activeSeconds(this.paceNow);
  }
}

// ───────────────────────────── 召沙魇 ─────────────────────────────

/**
 * 召沙魇（一阶段）：前摇 1.6 s ÷ 节奏双臂高举 → 掌心下压；脚下亮一圈沙色预警。出手：按名册取前 3 只（二阶段起 4 只），
 * 落点预警 0.9 s 后破沙而出（Summons：受首领召唤上限约束，首领倒下时全部崩解）；场上（在场 + 预警中）加上这次的超过上限时权重为 0。
 */
export class SandWraithsMove extends HanbaMove {
  lastQueued = 0;
  totalQueued = 0;
  private wind = 0;

  constructor(h: Hanba) {
    super(SandWraiths.spec, h);
  }

  override weightNow(): number {
    const s = this.h.summons;
    return SandWraiths.weight(this.weight, s.alive, s.pendingCount, this.h.phase, s.cap);
  }

  protected override prepare(): void {
    this.h.halt();
    this.wind = this.windupFor(this.windup);
    this.h.ring.setBlaze(0.6, 0.6);
  }

  protected override onTelegraph(): void {
    const o = this.onGround(_a.copy(this.h.position));
    this.track(this.hz.groundWarning(o.x, o.y, o.z, this.h.radius + 2.5, this.wind, HanbaDef.Sand));
    this.actAt('summonWraiths', SandWraiths.ClipHit, this.wind);
    this.sfx('telegraph', 1, 0.7);
  }

  protected override get windupDone(): boolean {
    return this.cue('summon', this.wind);
  }

  protected override onWindup(dt: number): void {
    this.h.facePlayerRate(120 * DEG, dt);
    this.h.glow(0, clamp01(this.stageT / Math.max(0.01, this.wind)));
    if (Math.random() < 0.4) {
      const p = _a.copy(this.h.position).addScaledVector(dirOf(Math.random() * 360, _b), 1.5 + Math.random() * (this.h.radius + 1));
      this.onGround(p).y += 0.2;
      this.ctx.fx.burst(p, HanbaDef.Sand, 3, 1.2, 0.7, 0.22, -1.2);
    }
  }

  protected override onActiveBegin(): void {
    const roster = this.h.hdef.wraithRoster;
    const want = Math.min(SandWraiths.countFor(this.h.phase), roster.length);
    const groups = new Map<string, number>();
    for (let i = 0; i < want; i++) groups.set(roster[i], (groups.get(roster[i]) ?? 0) + 1);
    const o = this.h.summonOptsFor({ warn: 0.9, minRadius: 4, maxRadius: 9, warnColor: HanbaDef.Sand });
    this.lastQueued = 0;
    for (const [id, n] of groups) this.lastQueued += this.h.summons.spawn(id, n, o);
    this.totalQueued += this.lastQueued;
    this.h.ring.flash(0.8);
    this.ctx.fx.burst(this.h.getBodyCenter(_a), HanbaDef.Sand, 24, 6, 0.9, 0.35, 3);
    Fx.summonPress(this.ctx, this.onGround(_b.copy(this.h.position)));
    this.impact(0.06, 0.35, 0.35, 60, 'summon');
    this.sfx('boss_roar', 0.5, 1.3);
  }
}

// ───────────────────────────── 焦裂 ─────────────────────────────

/**
 * 焦裂（二阶段起）：前摇 1.2 s ÷ 节奏右手扬起，朝玩家亮一条长条（宽 2.6 m、长 = 玩家距离 + 8 m，14–28 m），三阶段起左右再各一条（±28°）。
 * 出手：俯冲按掌；裂缝沿每条线以 18 m/s 蔓延（每 1.5 m 一段），走到头停 0.45 s，再从近到远逐段爆开（半径 1.7 m、2.5 m 高以内、不看掩体）——
 * 同一次施放最多伤玩家一次。蔓延与爆炸挂在危险物时钟上：招式被打断后已经裂开的照样爆。收招 0.9 s。
 * 与 Unity 的差异：裂口的日火贴花与火柱（FxDecals.Fire / FlameTongues.Pillar）换成火星 + 爆炸。
 */
export class CrackLineMove extends HanbaMove {
  lines = 0;
  length = 0;
  explosions = 0;
  totalHits = 0;
  castExplosions = 0;
  private wind = 0;
  private yaw = 0;
  private readonly origin = new THREE.Vector3();
  private volley = { hit: false };
  private readonly yaws: number[] = [];

  constructor(h: Hanba) {
    super(CrackLine.spec, h);
  }

  override weightNow(): number {
    return CrackLine.weight(this.weight, this.h.distToPlayerXZ());
  }

  protected override prepare(): void {
    this.h.halt();
    this.yaw = this.yawToPlayer;
    this.setFacing(this.yaw);
    this.wind = this.windupFor(this.windup);
    this.length = clamp(this.h.distToPlayerXZ() + 8, CrackLine.MinLength, CrackLine.MaxLength);
    this.lines = CrackLine.countFor(this.h.phase);
    this.castExplosions = 0;
    this.volley = { hit: false };
    this.yaws.length = 0;
    this.yaws.push(this.yaw);
    if (this.lines >= 3) this.yaws.push(this.yaw - CrackLine.FanAngle, this.yaw + CrackLine.FanAngle);
    this.ground(this.origin.copy(this.h.position).addScaledVector(dirOf(this.yaw, _a), this.h.radius + 0.6));
    this.h.ring.setBlaze(0.75, 1.8);
  }

  protected override onTelegraph(): void {
    for (const a of this.yaws) {
      this.track(this.hz.lineWarning(this.origin.x, this.origin.y, this.origin.z, a * DEG, this.length, CrackLine.HalfWidth, this.wind, HanbaDef.Warn,
        CrackLine.activeSeconds(this.length) - 0.1));
    }
    Fx.focusSeal(this.ctx, this.origin, 1.4, this.wind);
    this.actAt('crackPalm', CrackLine.ClipHit, this.wind);
    this.sfx('telegraph', 1, 0.75);
  }

  protected override get windupDone(): boolean {
    return this.cue('hit', this.wind);
  }

  protected override onWindup(_dt: number): void {
    const u = clamp01(this.stageT / Math.max(0.01, this.wind));
    this.h.glow(0, u);
    if (u > 0.18) Fx.palmCharge(this.ctx, this.h.hand(true, _a), (u - 0.18) / 0.82);
  }

  protected override onActiveBegin(): void {
    Fx.palmSlam(this.ctx, this.origin);
    this.impact(0.08, 0.55, 0.4, 40, 'hit');
    this.sfx('boss_slam', 0.9, 0.9);
    this.h.ring.flash(0.8);
    for (const a of this.yaws) this.spread(a);
  }

  /** 沿 a 方向排一条裂缝：逐段裂开，走到头后逐段爆开（都在危险物时钟上） */
  private spread(a: number): void {
    const dir = dirOf(a);
    const n = Math.max(1, Math.ceil(this.length / CrackLine.Step));
    const end = this.length / CrackLine.CrackSpeed + CrackLine.ExplodeDelay;
    const volley = this.volley;
    for (let i = 1; i <= n; i++) {
      const p = this.ground(this.origin.clone().addScaledVector(dir, Math.min(this.length, i * CrackLine.Step)));
      const sound = i % 4 === 1;
      this.hz.later(i * CrackLine.Step / CrackLine.CrackSpeed, () => this.split(p, sound));
      this.hz.later(end + i * CrackLine.ChainGap, () => this.explode(p, sound, volley));
    }
  }

  private split(p: THREE.Vector3, sound: boolean): void {
    Fx.crackHead(this.ctx, p);
    this.ctx.fx.burst(_a.copy(p).setY(p.y + 0.15), Fx.CRACK, 3, 2.2, 0.6, 0.14, -0.5);
    this.ctx.fx.burst(_a.copy(p).setY(p.y + 0.1), HanbaDef.Sand, 3, 2.5, 0.5, 0.2, 4);
    if (sound) this.ctx.audio.play('skill_earth', { position: p, volume: 0.45, pitch: 1.4 });
  }

  private explode(p: THREE.Vector3, sound: boolean, volley: { hit: boolean }): void {
    if (!this.h.alive) return;
    this.explosions++;
    this.castExplosions++;
    if (!volley.hit && this.hz.blast(p.x, p.y, p.z, CrackLine.BlastRadius, this.damage(CrackLine.DamageMult), { maxHeight: 2.5, knockUp: 5.5, knockback: 3, element: 'fire' })) {
      volley.hit = true;
      this.totalHits++;
    }
    this.ctx.fx.explosion(_a.copy(p).setY(p.y + 0.3), CrackLine.BlastRadius, Fx.BLAST);
    this.ctx.fx.burst(_a.copy(p).setY(p.y + 0.5), Fx.CRACK, 6, 3, 0.6, 0.2, -3);
    Fx.sandBlast(this.ctx, _a.copy(p).setY(p.y + 0.2), 1.1);
    if (sound) {
      this.ctx.audio.play('explosion', { position: p, volume: 0.6, pitch: 1.1 });
      this.h.quakeAt(p, 0.22, 0.2, 20);
    }
  }

  protected override onActive(_dt: number): void {
    this.h.glow(0, 1 - clamp01(this.stageT / 0.6));
  }

  protected override onFxCue(cue: string): void {
    if (cue === 'palmOut') Fx.palmOut(this.ctx, this.h.hand(true, _a), this.origin);
  }

  /** 贴地：从首领脚下高度往上 20 m 往下找（裂缝会爬上沙丘坡、下到泉床） */
  private ground(p: THREE.Vector3): THREE.Vector3 {
    p.y = this.h.groundY(p.x, p.z, this.h.position.y + 20);
    return p;
  }

  protected override get activeDone(): boolean {
    return this.stageT >= CrackLine.activeSeconds(this.length);
  }
}

// ───────────────────────────── 飞天之殇 ─────────────────────────────

/**
 * 飞天之殇（二阶段起；二阶段演出结束后的第一招）：前摇 1.8 s ÷ 节奏双手捧到心口，落点（场地没有栖落点时在她身侧 6 m）亮一圈金色预警；
 * 出手：邪飞天在落点现身（同首领难度、不算召唤上限，名字「日灼·邪飞天」），旱魃立刻披上琵琶护体。邪飞天还活着或护体还在时权重为 0。收招 1 s。
 */
export class ApsaraCallMove extends HanbaMove {
  summoned = 0;
  readonly spot = new THREE.Vector3();
  private wind = 0;

  constructor(h: Hanba) {
    super(ApsaraCall.spec, h);
  }

  override weightNow(): number {
    return this.h.apsaraAlive || this.h.ward.up ? 0 : this.weight;
  }

  protected override prepare(): void {
    this.h.halt();
    this.wind = this.windupFor(this.windup);
    // 落点：她身侧 6 m（右手边），夹进场地、贴导航网格
    const right = _a.set(-Math.cos(this.h.facing), 0, Math.sin(this.h.facing));
    this.spot.copy(this.h.position).addScaledVector(right, 6);
    this.h.clampToArena(this.spot, 3);
    if (this.ctx.nav.nearestWalkable(this.spot, _b) && _b.distanceToSquared(this.spot) <= 16) this.spot.copy(_b);
    else this.onGround(this.spot);
    this.h.ring.setBlaze(0.6, 0.7);
  }

  protected override onTelegraph(): void {
    this.track(this.hz.groundWarning(this.spot.x, this.spot.y, this.spot.z, 1.8, this.wind, Fx.GOLD));
    this.actAt('apsaraCall', ApsaraCall.ClipHit, this.wind);
    this.sfx('telegraph', 1, 1.15);
    this.sfx('pipa_roll', 0.6, 0.7);
  }

  protected override get windupDone(): boolean {
    return this.cue('summon', this.wind);
  }

  protected override onWindup(dt: number): void {
    this.h.facePlayerRate(90 * DEG, dt);
    this.h.glow(0, clamp01(this.stageT / Math.max(0.01, this.wind)));
    if (Math.random() < 0.4) this.ctx.fx.burst(this.h.getBodyCenter(_a).addScaledVector(dirOf(this.facingDeg, _b), 0.6), Fx.GOLD, 2, 1.2, 0.6, 0.1, -0.4);
  }

  protected override onActiveBegin(): void {
    if (this.h.summonApsara(this.spot)) this.summoned++;
    this.h.ring.flash(0.8);
    this.ctx.fx.burst(_a.copy(this.spot).setY(this.spot.y + 1.2), Fx.GOLD, 26, 6, 1, 0.3, 2);
    Fx.heartBloom(this.ctx, this.h.pearlPos(_b));
    this.impact(0.05, 0.35, 0.35, 60, 'summon');
    this.sfx('pipa_bloom', 0.9, 0.7);
    this.sfx('boss_roar', 0.5, 1.35);
  }
}

// ───────────────────────────── 日蚀 ─────────────────────────────

/**
 * 日蚀（三阶段；三阶段演出结束后的第一招）：时间轴跟 eclipse 片段原速走（4.5 s，不吃节奏 / 狂怒，3 s 窗口对得上 eclipseStart / eclipseEnd）。
 *   前摇 0.67 s：日轮迅速暗下去，脚下亮一圈 7 m 的强光倒计时（前摇 + 窗口 + 0.27 s 填满）。
 *   出手 = 窗口 3 s：日轮熄灭（黑盘、不直射），升到头顶的日轮就是太阳——主光压到 0.12，天暗下来、不晒；泉珠露出，打泉珠 × 3（在必暴之外）。
 *   收招：日轮复燃（flare）——主光猛亮，看得到太阳的人受 1.6 倍伤害、额外叠 2.5 s 日晒，满屏白光；影子里的人只闪一下。
 * 被打断时日轮复原、窗口关闭，不放强光。
 * 与 Unity 的差异：龟裂裂光 / 日轮三层自发光的同帧点亮（GlowMask.Flash）没有移植。
 */
export class EclipseMove extends HanbaMove {
  windows = 0;
  flareHits = 0;
  flareShaded = 0;
  lastWindow = 0;
  flared = false;
  private window = 3;
  private openAt = 0;
  private open = false;
  private beads = 0;
  private beadAcc = 0;

  constructor(h: Hanba) {
    super(Eclipse.spec, h);
  }

  protected override prepare(): void {
    this.h.halt();
    this.h.faceNow(this.ctx.player.position);
    this.fixedWindup(Eclipse.Lead);
    this.window = Math.max(0.5, this.h.hdef.eclipseSeconds);
    this.active = this.window;
    this.flared = this.open = false;
    this.h.ring.setBlaze(0.05, 0.3);
    this.beads = 0;
    this.beadAcc = 0;
  }

  protected override onTelegraph(): void {
    const o = this.onGround(_a.copy(this.h.position));
    this.track(this.hz.groundWarning(o.x, o.y, o.z, Eclipse.WarnRadius, Eclipse.Lead + this.window + Eclipse.FlareAfter, Fx.FLARE));
    this.act('eclipse', clipSeconds('eclipse'));
    this.sfx('telegraph', 1, 0.55);
    this.sfx('enemy_charge', 0.8, 0.45);
  }

  protected override get windupDone(): boolean {
    return this.cue('eclipseStart', Eclipse.Lead);
  }

  protected override onWindup(_dt: number): void {
    this.h.glow(0, 1 - clamp01(this.stageT / Eclipse.Lead));
  }

  protected override onActiveBegin(): void {
    this.open = true;
    this.openAt = this.t;
    this.windows++;
    this.h.ring.setEclipse(true);
    this.h.openEclipse(this.h.hdef.eclipseWeakMult);
    this.sky()?.setDim(this.h.hdef.eclipseDim, 0.35);
    Fx.screenFlash(this.ctx, 'rgba(13,8,5,1)', 0.35, 0.5);
    this.ctx.fx.ring(_a.copy(this.h.position).setY(this.h.position.y + 0.15), 12, 0x59386f, 0.9);
    Fx.sunFlare(this.ctx, this.h.ring.center(_b), 3, 0xff8c40);
    this.ctx.ui.toast('日蚀！心口泉珠显露——集火！日轮复燃前躲进楼阁或沙丘檐下的深影', '#ffe2a0');
    this.sfx('boss_roar', 0.45, 0.6);
    this.impact(0.06, 0.3, 0.3, 60, 'eclipseStart');
  }

  protected override onActive(dt: number): void {
    this.h.glow(0, 0.35 + 0.25 * Math.sin(this.stageT * 18));
    const hub = this.h.ring.center(_c);
    const radius = this.h.ring.frame(_r, _u);
    Fx.corona(this.ctx, hub, _r, _u, radius);
    const total = this.window + Eclipse.FlareAfter;
    let lit = false;
    while (this.beads < Eclipse.Beads && this.stageT >= this.beads * total / Eclipse.Beads) {
      this.beads++;
      lit = true;
    }
    this.beadAcc += dt;
    if (lit || this.beadAcc >= 0.12) {
      this.beadAcc = 0;
      for (let k = 0; k < this.beads; k++) {
        const a = Math.PI * 0.5 - k * Math.PI * 2 / Eclipse.Beads;
        _a.copy(hub).addScaledVector(_r, Math.cos(a) * radius * 1.08).addScaledVector(_u, Math.sin(a) * radius * 1.08);
        Fx.coronaBead(this.ctx, _a, radius * 0.11, lit && k === this.beads - 1);
      }
    }
    const right = _b.set(-Math.cos(this.h.facing), 0, Math.sin(this.h.facing));
    Fx.pearlMark(this.ctx, this.h.pearlPos(_d).addScaledVector(dirOf(this.facingDeg, _a), 0.12), right, this.stageT);
  }

  protected override onFxCue(cue: string): void {
    if (cue !== 'gather' || this.flared) return;
    const left = Math.max(0.15, Eclipse.Lead + this.window + Eclipse.FlareAfter - this.t);
    Fx.flareGather(this.ctx, this.onGround(_a.copy(this.h.position)), Eclipse.WarnRadius * 0.8, left);
  }

  protected override get activeDone(): boolean {
    return this.stageT >= this.window;
  }

  protected override onRecoverBegin(): void {
    this.lastWindow = this.t - this.openAt;
    this.close();
    this.h.glow(0, 0);
  }

  protected override onRecover(_dt: number): void {
    if (!this.flared && this.cue('flare', Eclipse.Lead + this.window + Eclipse.FlareAfter)) this.flare();
  }

  /** 日轮复燃：强光覆盖全场（看得到太阳的人挨打 + 叠日晒，影子里的只闪一下） */
  private flare(): void {
    this.flared = true;
    const ring = this.h.ring;
    ring.flash(1);
    ring.setBlaze(1, 3);
    const c = ring.center(new THREE.Vector3());
    this.sky()?.flash(this.h.hdef.flareBright, 0.12, 0.9);
    this.impact(0.09, 0.7, 0.6, 90, 'flare');
    const radius = ring.frame(_r, _u);
    Fx.flareBurst(this.ctx, c, radius, this.h.getBodyCenter(_a), this.onGround(_b.copy(this.h.position)), Eclipse.WarnRadius);
    this.sfx('boss_roar', 1, 0.8);
    this.sfx('explosion', 0.8, 0.5);
    this.ctx.fx.burst(c, Fx.FLARE, 40, 14, 0.9, 0.5, 0);
    Fx.sunFlare(this.ctx, c, 6);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + (Math.random() * 0.6 - 0.3), rr = 4 + Math.random() * 7;
      const g = _d.set(this.h.position.x + Math.sin(a) * rr, 0, this.h.position.z + Math.cos(a) * rr);
      g.y = this.h.groundY(g.x, g.z, this.h.position.y + 6);
      this.ctx.fx.beam(c, g, Fx.FLARE, 0.7, 0.35);
      this.ctx.fx.burst(g, Fx.CRACK, 6, 2, 0.8, 0.2, -1);
    }
    const p = this.ctx.player;
    if (!p.alive) return;
    const chest = _a.set(p.position.x, p.position.y + p.height * 0.55, p.position.z);
    const lit = this.h.exposure.seesSun(chest) || this.h.exposure.seesSun(p.eye);
    if (!lit) {
      this.flareShaded++;
      Fx.screenFlash(this.ctx, 'rgb(255,242,204)', 0.3, 0.4);
      return;
    }
    Fx.screenFlash(this.ctx, 'rgb(255,247,224)', 0.85, 0.9);
    if (p.invulnerableTime > 0) return;
    if (this.hz.hurt(this.damage(this.h.hdef.flareDamage), 'fire', c) > 0) this.flareHits++;
    this.h.exposure.burnFor(this.h.hdef.flareBurn, c);
  }

  /** 露天场地的太阳驱动（日轮升到头顶之后才有） */
  private sky() {
    return this.h.ring.risen ? this.h.sunRise.driver : null;
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.h.ring.setEclipse(false);
    this.h.closeEclipse();
    if (!this.flared) this.sky()?.setDim(1, 0.3);
  }

  protected override onEnd(cancelled: boolean): void {
    this.close();
    super.onEnd(cancelled);
  }
}

export function createHanbaMove(h: Hanba, id: string): BossMove | null {
  switch (id) {
    case SunSweep.id: return new SunSweepMove(h);
    case HotWind.id: return new HotWindMove(h);
    case SandWraiths.id: return new SandWraithsMove(h);
    case CrackLine.id: return new CrackLineMove(h);
    case ApsaraCall.id: return new ApsaraCallMove(h);
    case Eclipse.id: return new EclipseMove(h);
  }
  return null;
}
