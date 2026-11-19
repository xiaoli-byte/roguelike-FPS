/**
 * 各图专属的机关脚本（Unity G/World/Levels/*.cs 与 LoreNote.cs）：
 *   FoundryChannels（3-3 神范台熔铜渠：领主战里涨落）、FireGodThrone（3-3 王座熔岩柱跟着渠涨）、FoundryWindGate（3-3 风闸）、
 *   FoundryLordGate（3-3 / 3-4：关卡目标完成前领主战不开）、ForgeWellDirector（3-2 铸神井：链桥崩断、挂钩、铸门、熔泉齐喷）、
 *   LoreNote（4-3 修鼓旧簿）、ZheduoLevel（4-1：穷奇游猎）。
 * 网页里「据点肃清 / 开波 / 关卡目标完成」从 ctx.stage.exploration 的据点阶段和 'wave:started' 事件读。
 */
import * as THREE from 'three';
import type { IEnemy } from '../../core/types';
import type { MechanismHost } from './Host';
import type { LavaVolumeRuntime } from './Lava';
import { LAVA_GOLD, LAVA_ORANGE } from './Lava';
import type { LavaGeyser } from './LavaFeatures';
import type {
  FireGodThroneData, FoundryChannelsData, ForgeWellData, LordGateData, LoreNoteData, ObjectiveData, WindGateData, ZheduoData,
} from './MechanismData';
import { PartGroup } from './Parts';
import type { FoundryChannelsHook } from './StageGates';

const _v = new THREE.Vector3();
const moveTowards = (c: number, t: number, d: number): number => (Math.abs(t - c) <= d ? t : c + Math.sign(t - c) * d);

/** 关卡目标（Unity LevelObjective）：required 据点全部肃清；没给目标时 = 所有非可选、非首领场的据点 */
export function objectiveComplete(host: MechanismHost, objective: ObjectiveData | null): boolean {
  const list = host.ctx.stage.exploration?.encounters ?? [];
  // 关卡导演的据点表还没建（场景视图先于遭遇搭好）：当没完成
  if (list.length === 0) return false;
  if (objective && objective.required.length) return objective.required.every(t => host.site(t) === 'cleared' || !list.some(e => e.id === t));
  const regular = list.filter(e => !e.id.startsWith('boss:') && !e.optional);
  return regular.length > 0 && regular.every(e => e.phase === 'cleared');
}

// ───────────────────────────── 熔铜渠 ─────────────────────────────

export class FoundryChannels implements FoundryChannelsHook {
  floods = 0;
  private holdUntil = -1;
  readonly surge: LavaVolumeRuntime[];

  constructor(private readonly host: MechanismHost, readonly d: FoundryChannelsData) {
    this.surge = d.surge.map(p => host.volume(p)).filter((v): v is LavaVolumeRuntime => !!v);
  }

  get count(): number { return this.surge.length; }
  get rise(): number { return this.d.rise; }
  get warn(): number { return this.d.warn; }
  get riseTime(): number { return this.d.riseTime; }
  get flooding(): boolean { return this.surge.some(v => v.flooding); }
  get overflowing(): boolean { return this.surge.some(v => v.level >= v.baseLevel + this.d.rise * 0.8); }
  get holdLeft(): number { return this.holdUntil > 0 ? Math.max(0, this.holdUntil - this.host.ctx.time.now) : 0; }

  get surges(): FoundryChannelsHook['surges'] {
    return this.surge.map(v => ({ center: [v.body.center.x, v.body.center.y, v.body.center.z] as [number, number, number], yaw: v.body.yaw, shape: v.shape, size: v.size }));
  }

  flood(hold: number, warnSeconds = -1): boolean {
    const now = this.host.ctx.time.now;
    const w = warnSeconds >= 0 ? warnSeconds : this.d.warn;
    const until = now + w + this.d.riseTime + Math.max(0, hold);
    if (this.holdUntil > 0 && this.flooding) {
      this.holdUntil = Math.max(this.holdUntil, until);
      return false;
    }
    for (const v of this.surge) v.riseTo(v.baseLevel + this.d.rise, this.d.riseTime, w);
    this.holdUntil = until;
    this.floods++;
    return true;
  }

  recede(): void {
    this.holdUntil = -1;
    for (const v of this.surge) v.recede(this.d.fallTime);
  }

  update(): void {
    if (this.holdUntil > 0 && this.host.ctx.time.now >= this.holdUntil) this.recede();
  }
}

/** 3-3 火神王座：熔岩柱跟着熔铜渠涨（水平放大 45%、发光变强）；王座 / 圆环的美术件导出时已经选好（Procedural 回退在场景里是停用的） */
export class FireGodThrone {
  surge = 0;
  private shown = -1;
  private readonly fall: PartGroup | null;
  private readonly materials: THREE.ShaderMaterial[] = [];

  constructor(host: MechanismHost, readonly d: FireGodThroneData, private readonly channels: FoundryChannels | null) {
    this.fall = d.fallRoot ? new PartGroup(host.parts.rootsUnder(d.fallRoot.scenePath), d.fallRoot.position, d.fallRoot.rotation) : null;
    for (const path of d.fallRenderers) for (const r of host.parts.rootsUnder(path)) r.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (m && (m as THREE.ShaderMaterial).isShaderMaterial && m.uniforms?.uAgitation) this.materials.push(m);
    });
  }

  update(dt: number): void {
    let target = 0;
    const c = this.channels;
    if (c) {
      if (c.flooding) target = 0.45;
      const rise = Math.max(0.05, c.rise);
      for (const v of c.surge) target = Math.max(target, Math.min(1, Math.max(0, (v.level - v.baseLevel) / rise)));
    }
    this.surge = moveTowards(this.surge, target, dt * 1.4);
    if (Math.abs(this.surge - this.shown) < 0.005) return;
    this.shown = this.surge;
    this.fall?.set(null, null, _v.set(1 + this.surge * 0.45, 1, 1 + this.surge * 0.45));
    for (const m of this.materials) {
      m.uniforms.uAgitation.value = this.surge;
      if (m.uniforms.uEmission) m.uniforms.uEmission.value = 2.35 + (3.5 - 2.35) * this.surge;
    }
  }
}

// ───────────────────────────── 风闸 ─────────────────────────────

const FIRE_TINT = 0xff7a26;

interface FloorFire { at: THREE.Vector3; radius: number; until: number; nextTick: number; damage: number; interval: number; cancel: () => void }

export class FoundryWindGate {
  phase: 'locked' | 'ready' | 'pulled' = 'locked';
  jetsFired = 0;
  firesSpawned = 0;
  bellowsScale: number;
  pulledAt = -1;
  private leverAngle = -35;
  private emberAcc = 0;
  private nextJetAt = -1;
  private jetFireAt = -1;
  private lockHintAt = 0;
  private nextLane = 0;
  private pendingLane = -1;
  private jetsDone = false;
  private readonly bellows: { part: PartGroup; baseY: number }[];
  private readonly lever: PartGroup | null;
  private readonly fires: FloorFire[] = [];
  private readonly off: (() => void)[] = [];

  constructor(private readonly host: MechanismHost, readonly d: WindGateData, gate: (fn: (id: string) => boolean) => () => void) {
    this.bellowsScale = d.bellowsRest;
    this.bellows = d.bellows.map(b => ({ part: new PartGroup(host.parts.rootsUnder(b.scenePath), b.position, b.rotation), baseY: b.scale[1] || 1 }));
    this.lever = d.lever ? new PartGroup(host.parts.rootsUnder(d.lever.scenePath), d.lever.position, d.lever.rotation) : null;
    this.applyBellows();
    // 第二次进殿：拉开风闸前不触发（Unity 在 Start 里把它的 autoTrigger 关掉）
    if (d.secondVisit) this.off.push(gate(id => id === d.secondVisit && this.phase !== 'pulled'));
    const focus = new THREE.Vector3(d.position[0], d.position[1] + 1.4, d.position[2]);
    this.off.push(host.ctx.interact.add({
      position: focus, radius: 3.2,
      get enabled() { return true; },
      prompt: () => ({
        title: '风闸',
        subtitle: this.phase === 'pulled' ? '已拉开' : this.phase === 'locked' ? '卡死' : '拉开',
        lines: this.phase === 'locked' ? ['铁栓被殿里的守军锁着——先肃清鼓风正殿'] : ['鼓风正殿的风箱会鼓起来，炉门大开', '殿里会换一批守军；全图的熔铜渠开始涨落'],
        color: '#ff7a26',
      }),
      onInteract: () => this.interact(focus),
    } as never));
  }

  private get unlocked(): boolean { return !this.d.firstVisit || this.host.site(this.d.firstVisit) === 'cleared'; }

  private interact(focus: THREE.Vector3): void {
    if (this.phase === 'pulled') return;
    if (this.phase === 'locked' && !this.unlocked) {
      const now = this.host.ctx.time.now;
      if (now >= this.lockHintAt) {
        this.lockHintAt = now + 1.5;
        this.host.ctx.ui.toast('风闸被铁栓卡死——先肃清鼓风正殿的守军', '#ff9973');
        this.host.ctx.audio.play('enemy_melee', { position: focus, volume: 0.5, pitch: 0.6 });
      }
      return;
    }
    this.pull();
  }

  /** 拉开风闸：风箱鼓起、炉门喷火开始、熔铜渠自动涨落、第二次进殿的据点可以触发 */
  pull(force = false): boolean {
    if (this.phase === 'pulled') return false;
    if (!force && !this.unlocked) return false;
    const ctx = this.host.ctx, d = this.d;
    this.phase = 'pulled';
    this.pulledAt = ctx.time.now;
    for (const path of d.tides) {
      const v = this.host.volume(path);
      if (v) v.driver.tide.enabled = true;
    }
    this.nextJetAt = ctx.time.now + 2.5;
    ctx.ui.banner('风闸大开', '风箱鼓起 · 炉门喷火 · 鼓风正殿换了一批守军', 3);
    const focus = new THREE.Vector3(d.position[0], d.position[1] + 1.4, d.position[2]);
    ctx.audio.play('boss_slam', { position: focus, volume: 0.7, pitch: 0.55 });
    ctx.audio.play('skill_fire', { position: d.furnaceMouth ? new THREE.Vector3(...d.furnaceMouth) : focus, volume: 1, pitch: 0.6 });
    ctx.fx.shake(0.35, 1.2);
    ctx.fx.burst(focus, FIRE_TINT, 24, 6, 0.7, 0.18, 2);
    if (d.secondVisit && this.host.site(d.secondVisit) === 'undiscovered') ctx.ui.toast(`回到${d.secondVisit}`, '#ffda82');
    return true;
  }

  update(dt: number): void {
    const ctx = this.host.ctx, d = this.d, now = ctx.time.now;
    if (this.phase === 'locked' && this.unlocked) this.phase = 'ready';
    const pulled = this.phase === 'pulled';
    this.leverAngle = moveTowards(this.leverAngle, pulled ? 55 : -35, dt * 180);
    this.lever?.set(null, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (this.leverAngle + 35) * Math.PI / 180));
    const target = pulled ? d.bellowsLow + (d.bellowsHigh - d.bellowsLow) * (0.5 + 0.5 * Math.sin((now - this.pulledAt) * Math.PI * 2 / Math.max(0.5, d.pumpPeriod))) : d.bellowsRest;
    this.bellowsScale = moveTowards(this.bellowsScale, target, dt * (pulled ? 0.6 : 1));
    this.applyBellows();
    if (pulled && d.furnaceMouth) {
      this.emberAcc += dt;
      if (this.emberAcc >= 0.22) {
        this.emberAcc = 0;
        ctx.fx.burst(new THREE.Vector3(...d.furnaceMouth), FIRE_TINT, 6, 4, 0.6, 0.16, -3);
      }
    }
    if (pulled) this.stepJets(now);
    this.stepFires(now);
  }

  private applyBellows(): void {
    for (const b of this.bellows) b.part.set(null, null, _v.set(1, this.bellowsScale / b.baseY, 1));
  }

  private stepJets(now: number): void {
    const d = this.d;
    if (this.jetsDone) return;
    if (d.secondVisit && this.host.site(d.secondVisit) === 'cleared') {
      this.jetsDone = true;
      return;
    }
    const lanes = Math.min(d.laneFrom.length, d.laneTo.length);
    if (lanes === 0) return;
    if (this.pendingLane >= 0 && now >= this.jetFireAt) {
      this.fireLane(this.pendingLane);
      this.pendingLane = -1;
    }
    if (this.pendingLane >= 0 || now < this.nextJetAt) return;
    this.nextJetAt = now + Math.max(1, d.jetEvery);
    if (!this.playerNear()) return;
    this.pendingLane = this.nextLane % lanes;
    this.nextLane++;
    this.jetFireAt = now + d.jetWarn;
    const a = new THREE.Vector3(...d.laneFrom[this.pendingLane]), b = new THREE.Vector3(...d.laneTo[this.pendingLane]);
    this.host.tele.lane(a, b, d.jetRadius * 2, Math.max(0.1, d.jetWarn), FIRE_TINT);
    this.host.ctx.audio.play('telegraph', { position: a, volume: 0.6, pitch: 0.8 });
  }

  private playerNear(): boolean {
    const p = this.host.ctx.player;
    if (!p.alive) return false;
    const enc = this.d.secondVisit ? this.host.ctx.stage.exploration?.encounters?.find(e => e.id === this.d.secondVisit) : null;
    const c = enc?.position ?? new THREE.Vector3(...this.d.position);
    return Math.hypot(p.position.x - c.x, p.position.z - c.z) <= this.d.jetRange;
  }

  /** 沿风箱道落一串地火（Unity FloorFire.Spawn：半径 jetRadius、jetDuration 秒，每 jetTickInterval 秒烫一下） */
  private fireLane(i: number): void {
    const ctx = this.host.ctx, d = this.d;
    this.jetsFired++;
    const a = new THREE.Vector3(...d.laneFrom[i]), b = new THREE.Vector3(...d.laneTo[i]);
    const diff = Math.max(0.5, this.host.difficulty());
    const dmg = d.jetTick * (1 + (diff - 1) * 0.55);
    const n = Math.max(1, d.jetSpots);
    for (let k = 0; k < n; k++) {
      const p = a.clone().lerp(b, n === 1 ? 0.5 : k / (n - 1));
      const g = ctx.world.groundHeight(p.x, p.z, p.y + 1);
      if (Number.isFinite(g) && g > p.y - 6) p.y = g;
      const now = ctx.time.now;
      this.fires.push({ at: p, radius: d.jetRadius, until: now + d.jetDuration, nextTick: now, damage: dmg, interval: d.jetTickInterval,
        cancel: ctx.fx.groundWarning(p, d.jetRadius, d.jetDuration, FIRE_TINT) });
      this.firesSpawned++;
    }
    ctx.fx.burst(a.clone().setY(a.y + 1.2), FIRE_TINT, 18, 9, 0.6, 0.2, -2);
    ctx.audio.play('skill_fire', { position: a, volume: 0.9, pitch: 0.7 });
    if (d.furnaceMouth && ctx.player.position.distanceTo(new THREE.Vector3(...d.furnaceMouth)) < 40) ctx.fx.shake(0.2, 0.4);
  }

  private stepFires(now: number): void {
    const ctx = this.host.ctx, p = ctx.player;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (now >= f.until) {
        f.cancel();
        this.fires.splice(i, 1);
        continue;
      }
      if (Math.random() < 0.3) ctx.fx.burst(_v.set(f.at.x + (Math.random() - 0.5) * f.radius, f.at.y + 0.2, f.at.z + (Math.random() - 0.5) * f.radius), FIRE_TINT, 2, 1.5, 0.5, 0.12, -2);
      if (now < f.nextTick) continue;
      f.nextTick = now + f.interval;
      if (p.alive && Math.hypot(p.position.x - f.at.x, p.position.z - f.at.z) <= f.radius && Math.abs(p.position.y - f.at.y) < 2) {
        ctx.combat.damagePlayer(f.damage, 'fire', null, f.at);
      }
    }
  }

  dispose(): void {
    for (const off of this.off) off();
    for (const f of this.fires) f.cancel();
  }
}

// ───────────────────────────── 领主战门槛 ─────────────────────────────

export class FoundryLordGate {
  unlocked = false;
  lockedHints = 0;
  private hintAt = 0;
  private readonly off: (() => void) | null;
  private readonly arena: { center: THREE.Vector3; radius: number; floorY: number } | null;

  constructor(private readonly host: MechanismHost, readonly d: LordGateData, gate: (fn: (id: string) => boolean) => () => void) {
    const bossId = d.encounter?.bossId ?? '';
    const index = host.document.bosses.findIndex(b => b.id === bossId);
    const boss = index >= 0 ? host.document.bosses[index] : null;
    this.arena = boss ? { center: new THREE.Vector3(...boss.center), radius: boss.radius, floorY: boss.floorY } : null;
    const fightId = boss ? `boss:${boss.id}:${index}` : null;
    this.off = fightId ? gate(id => id === fightId && !this.unlocked) : null;
    if (!d.objective) this.unlock(false);
  }

  /** Unity Start：开局目标已经完成（没有必清据点）就不声不响地解锁；之后完成才横幅 */
  private primed = false;

  /** 启用领主战（目标完成）：横幅 + 首领的吼声 */
  unlock(announce = true): void {
    if (this.unlocked) return;
    this.unlocked = true;
    if (!announce) return;
    const ctx = this.host.ctx, d = this.d;
    ctx.ui.banner(d.wakeTitle, d.wakeSub, 3);
    if (this.arena) ctx.audio.play('boss_roar', { position: this.arena.center.clone().setY(this.arena.floorY + 3), volume: 0.55, pitch: 0.6 });
    if (d.wakeObjective) ctx.ui.toast(d.wakeObjective, '#ffda82');
  }

  update(): void {
    if (this.unlocked) return;
    const ready = (this.host.ctx.stage.exploration?.encounters?.length ?? 0) > 0;
    if (ready && objectiveComplete(this.host, this.d.objective)) {
      this.unlock(this.primed);
      return;
    }
    if (ready) this.primed = true;
    const ctx = this.host.ctx, p = ctx.player;
    if (!this.arena || !p.alive || ctx.time.now < this.hintAt) return;
    const f = p.position;
    if (Math.hypot(f.x - this.arena.center.x, f.z - this.arena.center.z) > this.arena.radius + 2 || Math.abs(f.y - this.arena.floorY) > 6) return;
    this.hintAt = ctx.time.now + 6;
    this.lockedHints++;
    ctx.ui.toast(this.d.lockedHint, '#ff8c4d');
  }

  dispose(): void { this.off?.(); }
}

// ───────────────────────────── 3-2 铸神井 ─────────────────────────────

export class ForgeWellDirector {
  bridgeBroken = false;
  bridgeShaken = false;
  hookLowered = 0;
  gateRise = 0;
  gateTarget = 0;
  gateStage = 0;
  private gateWarnLeft = -1;
  private hookT = -1;
  private readonly gate: PartGroup | null;
  private readonly gateBoxes: ReturnType<MechanismHost['parts']['collidersUnder']>;
  private readonly glow: PartGroup[];
  private readonly hookPart: PartGroup | null;
  private readonly hookHome: THREE.Vector3 | null;
  private readonly off: (() => void)[] = [];

  constructor(private readonly host: MechanismHost, readonly d: ForgeWellData, private readonly geysers: () => LavaGeyser[]) {
    this.gate = d.gate ? new PartGroup(host.parts.rootsUnder(d.gate.scenePath), d.gate.position, d.gate.rotation) : null;
    this.gateBoxes = d.gate ? host.parts.collidersUnder(d.gate.scenePath) : [];
    this.glow = d.gateGlow.map(p => new PartGroup(host.parts.rootsUnder(p), null));
    for (const g of this.glow) g.setVisible(false);
    this.hookPart = d.hook ? new PartGroup(host.parts.rootsUnder(d.hook.scenePath), d.hook.position, d.hook.rotation) : null;
    this.hookHome = d.hook ? new THREE.Vector3(...d.hook.position) : null;
    // Awake：挂钩收着（hookUp）
    if (this.hookPart && this.hookHome) this.hookPart.setWorldOffset(new THREE.Vector3(...d.hookUp).sub(this.hookHome));
    this.off.push(host.ctx.events.on('wave:started', ({ index }) => {
      if (index >= 1 && d.forgeSite && host.activeSite() === d.forgeSite) this.openGateHalf();
    }));
  }

  /** ② 悬炉锻台肃清：北链桥崩断、挂钩放下 */
  collapseBridge(): void {
    if (this.bridgeBroken) return;
    const ctx = this.host.ctx, d = this.d;
    this.bridgeBroken = true;
    const bridge = this.host.activatable(d.northBridge) as unknown as { breakAll?: (origin: number) => void } | null;
    bridge?.breakAll?.(d.collapseFrom);
    if (d.forgeBelly) ctx.fx.burst(new THREE.Vector3(...d.forgeBelly), LAVA_ORANGE, 24, 6, 0.9, 0.14, -6);
    ctx.fx.shake(0.35, 0.6);
    ctx.ui.toast('北链桥崩断了 · 顺着西吊臂下到风箱窟（回上层走南链桥 / 井底升降台）', '#ffc766');
  }

  lowerHook(): void {
    if (this.hookT >= 0) return;
    this.hookT = 0;
    if (this.hookHome) this.host.ctx.audio.play('enemy_melee', { position: this.hookHome, volume: 0.6, pitch: 0.45 });
  }

  /** ④ 第二波：铸门先亮、再沉到半开 */
  openGateHalf(): void {
    if (this.gateStage >= 1) return;
    this.gateStage = 1;
    this.gateWarnLeft = Math.max(0, this.d.gateWarn);
    for (const g of this.glow) g.setVisible(true);
    if (this.d.gate) this.host.ctx.audio.play('boss_roar', { position: new THREE.Vector3(...this.d.gate.position), volume: 0.7, pitch: 0.55 });
  }

  /** 关卡目标完成：铸门全开 + 四口熔泉同时喷一次 */
  openGateFull(): void {
    if (this.gateStage >= 3) return;
    for (const g of this.glow) g.setVisible(true);
    this.gateStage = 3;
    this.gateTarget = this.d.gateFull;
    this.gateWarnLeft = -1;
    this.removeGateBoxes();
    if (this.d.gate) {
      this.host.ctx.audio.play('boss_slam', { position: new THREE.Vector3(...this.d.gate.position), volume: 0.8, pitch: 0.6 });
      this.host.ctx.fx.shake(0.25, 0.5);
    }
    for (const g of this.geysers()) if (this.d.geysers.includes(g.d.scenePath)) g.eruptNow(0.6);
  }

  private removeGateBoxes(): void {
    for (const b of this.gateBoxes) this.host.ctx.world.remove(b);
  }

  update(dt: number): void {
    const d = this.d;
    if (!this.bridgeBroken && d.deckSite && this.host.site(d.deckSite) === 'cleared') {
      this.collapseBridge();
      this.lowerHook();
    }
    if (this.gateStage < 3 && objectiveComplete(this.host, d.objective)) this.openGateFull();
    this.stepBridgeShake();
    if (this.gateWarnLeft >= 0) {
      this.gateWarnLeft -= dt;
      if (this.gateWarnLeft < 0) {
        if (this.gateStage < 2) this.gateStage = 2;
        this.gateTarget = Math.max(this.gateTarget, d.gateHalf);
        this.removeGateBoxes();
        if (d.gate) this.host.ctx.audio.play('boss_slam', { position: new THREE.Vector3(...d.gate.position), volume: 0.6, pitch: 0.75 });
      }
    }
    if (this.gate && this.gateRise < this.gateTarget) {
      this.gateRise = moveTowards(this.gateRise, this.gateTarget, d.gateSpeed * dt);
      this.gate.setWorldOffset(_v.set(0, this.gateRise * (d.gateDirection < 0 ? -1 : 1), 0));
    }
    if (this.hookT >= 0 && this.hookT < 1 && this.hookPart && this.hookHome) {
      this.hookT = Math.min(1, this.hookT + dt / Math.max(0.1, d.hookTime));
      const k = this.hookT * this.hookT * (3 - 2 * this.hookT);
      const at = new THREE.Vector3(...d.hookUp).lerp(new THREE.Vector3(...d.hookDown), k);
      this.hookPart.setWorldOffset(at.sub(this.hookHome));
      this.hookLowered = k;
    }
  }

  private stepBridgeShake(): void {
    const d = this.d;
    if (this.bridgeShaken || this.bridgeBroken || (d.bridgeMid[0] === 0 && d.bridgeMid[1] === 0 && d.bridgeMid[2] === 0)) return;
    const ctx = this.host.ctx, p = ctx.player.position;
    if (Math.hypot(p.x - d.bridgeMid[0], p.z - d.bridgeMid[2]) > d.bridgeMidRadius || Math.abs(p.y - d.bridgeMid[1]) > 2.5) return;
    this.bridgeShaken = true;
    if (d.forgeBelly) {
      const belly = new THREE.Vector3(...d.forgeBelly);
      ctx.fx.burst(belly, LAVA_ORANGE, 30, 7, 1.1, 0.14, -5);
      ctx.fx.burst(belly, LAVA_GOLD, 14, 4, 0.8, 0.09, -6);
      ctx.audio.play('skill_fire', { position: belly, volume: 0.9, pitch: 0.6 });
    }
    ctx.fx.shake(0.18, 0.35);
    ctx.audio.play('enemy_melee', { position: new THREE.Vector3(...d.bridgeMid), volume: 0.5, pitch: 0.4 });
  }

  dispose(): void {
    for (const off of this.off) off();
  }
}

// ───────────────────────────── 4-3 修鼓旧簿 ─────────────────────────────

export class LoreNote {
  read = false;
  private readonly off: () => void;

  constructor(private readonly host: MechanismHost, readonly d: LoreNoteData) {
    this.off = host.ctx.interact.add({
      position: new THREE.Vector3(d.position[0], d.position[1] + 1, d.position[2]), radius: d.radius,
      get enabled() { return true; },
      prompt: () => ({ title: `阅读 · ${d.title}`, subtitle: d.place, lines: d.lines, color: '#ffd982' }),
      onInteract: () => this.interact(),
    } as never);
  }

  update(): void {}

  interact(): void {
    const first = !this.read;
    this.read = true;
    if (first && this.d.bannerTitle) this.host.ctx.ui.banner(this.d.bannerTitle, this.d.bannerSub, 4);
    for (const l of this.d.afterLines) if (l) this.host.ctx.ui.toast(l, '#b8e5ff');
  }

  dispose(): void { this.off(); }
}

// ───────────────────────────── 4-1 折多垭口 ─────────────────────────────

/**
 * 穷奇游猎：开局 roamerDelay 秒后在游猎线第一个路点刷一只穷奇（名册精英）。网页的穷奇（enemies/plateau）还读不进巡视线 / 巢穴
 * （Unity QiongqiAI.route / lair，随 M5 第四章敌人并入主框架），先只按 Unity 的兜底：绕出生点转。啸獭洞口、三处领主据点随 M5 / M6
 */
export class ZheduoLevel {
  roamerSpawned = false;
  roamer: IEnemy | null = null;
  private readonly startAt: number;

  constructor(private readonly host: MechanismHost, readonly d: ZheduoData) {
    this.startAt = host.ctx.time.now;
  }

  update(): void {
    const ctx = this.host.ctx, d = this.d;
    if (this.roamerSpawned || ctx.time.now - this.startAt < d.roamerDelay || d.roamerRoute.length === 0 || !ctx.player.alive) return;
    this.roamerSpawned = true;
    const at = new THREE.Vector3(...d.roamerRoute[0]);
    const snapped = new THREE.Vector3();
    if (ctx.nav.nearestWalkable(at, snapped) && snapped.distanceTo(at) <= 6) at.copy(snapped);
    this.roamer = ctx.enemies.spawn(d.roamerId, { position: at, elite: true, level: ctx.run.difficulty });
    if (!this.roamer) console.warn(`[4-1] 刷不出穷奇（名册里没有 ${d.roamerId}？）`);
  }
}
