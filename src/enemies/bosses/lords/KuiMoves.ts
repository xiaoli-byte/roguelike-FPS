/**
 * 夔的八招（Unity Kui/Moves/KuiJumps.cs + KuiGround.cs 逐个翻译）：小跳、大跳、连环大跳、转身跳（KuiJump：蓄力下蹲 → 腾空 → 落地）、
 * 拄拳、雷掌、捶胸引雷（三下 / 五下）。常量与调度参数在 KuiPlans.ts。
 * 《庄子·秋水》「夔以一足趻踔而行」：蹄子只在蓄力和落地时着地，水平位移和转身全在空中（不滑步）；落地那一帧 = 片段的 land 事件（按时间兜底）。
 * 落雷（捶胸每捶两道）经 KuiStorm 的适配层交给 M7；没接上时捶胸照样捶、只是不劈雷。
 * 与 Unity 的差异：鼓皮环 / 雷云 / 掌心电弧这些 Fx.Kui* 换成 ctx.fx 的粒子、冲击环、闪电。
 */
import * as THREE from 'three';
import type { BossMoveSpec } from '../framework/BossDef';
import type { Kui } from './Kui';
import { KuiDef } from './KuiDef';
import { KuiClapPlan, KuiDrum5Plan, KuiDrumPlan, KuiHopPlan, KuiKnucklePlan, KuiLeapChainPlan, KuiLeapPlan, KuiPalette, KuiTurnLeapPlan } from './KuiPlans';
import { kuiStrike } from './KuiStorm';
import { LordBrain } from './LordBrain';
import { LordFx } from './LordFx';
import { LordMove } from './LordMove';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const { dir, flat, deltaAngle, smooth } = { dir: LordBrain.dir, flat: LordBrain.flat, deltaAngle: LordBrain.deltaAngle, smooth: LordBrain.smooth };

/** 夔招式的底座：选招计数（每出一招「距上次捶胸」+1） */
export abstract class KuiMove extends LordMove {
  constructor(spec: BossMoveSpec, protected readonly kui: Kui) {
    super(spec, kui);
  }

  protected get kdef(): KuiDef {
    return this.kui.kdef;
  }

  protected override prepare(): void {
    this.kui.sinceDrum++;
    this.kuiPrepare();
  }

  protected kuiPrepare(): void {}

  protected coreGlint(at: number, size = 1.4): void {
    if (this.cue('glint', at)) LordFx.glint(this.ctx, this.kui.bonePos(KuiDef.WeakBone, _d), KuiPalette.ThunderCore);
    void size;
  }
}

/** 玩家在身后（偏离朝向 > 115°） */
function playerBehind(kui: Kui): boolean {
  const p = kui.ctx.player.position;
  const dx = p.x - kui.position.x, dz = p.z - kui.position.z;
  if (dx * dx + dz * dz < 1e-4) return false;
  return Math.abs(deltaAngle(kui.facingDeg, Math.atan2(dx, dz) * 180 / Math.PI)) > KuiTurnLeapPlan.BehindDeg;
}

/**
 * 夔的蹦跳：蓄力下蹲 → 腾空 → 落地。前摇 = 蓄力（单腿蹲），出手段 = 腾空（抛物线，代码驱动根节点），落地那一帧 = 片段的 land 事件。
 * 子类定：跳多远（reach，离玩家留 keep）、多高、落地判定
 */
export abstract class KuiJump extends KuiMove {
  readonly from = new THREE.Vector3();
  readonly to = new THREE.Vector3();
  protected height = 1.4;
  protected reach = 3.5;
  protected keep = 3;
  private dashing = false;
  landings = 0;

  protected override kuiPrepare(): void {
    this.from.copy(this.lord.position);
    this.target(this.to);
    this.jumpPrepare();
  }

  protected jumpPrepare(): void {}

  /** 落点：朝玩家跳 min(reach, 距离 − keep)，夹进擂台，贴地 */
  protected target(out: THREE.Vector3): THREE.Vector3 {
    const p = this.ctx.player.position, o = this.lord.position;
    const dx = p.x - o.x, dz = p.z - o.z;
    const dist = Math.hypot(dx, dz);
    const r = Math.min(this.reach, Math.max(0, dist - this.keep));
    const ux = dist > 0.1 ? dx / dist : Math.sin(this.lord.facing), uz = dist > 0.1 ? dz / dist : Math.cos(this.lord.facing);
    out.set(o.x + ux * r, o.y, o.z + uz * r);
    this.lord.clampToArena(out, this.lord.arenaMargin);
    out.y = Math.max(o.y, p.y) + 3;
    return this.onGround(out);
  }

  protected override onWindup(dt: number): void {
    this.lord.halt();
    if (flat(this.to, this.from) > 0.05) this.turnToward(this.yawTo(this.to), 240, dt);
    if (this.ctx.rng.next() < dt * 6) LordFx.dust(this.ctx, this.lord.position, 0.5 + this.stageT / Math.max(0.05, this.windupTime), 1, KuiPalette.Dust);
  }

  protected override onActiveBegin(): void {
    this.lord.beginDash();
    this.dashing = true;
    LordFx.dust(this.ctx, this.lord.position, this.takeoffSize, 3, KuiPalette.Dust);
  }

  protected get takeoffSize(): number {
    return 1;
  }

  protected override onActive(dt: number): void {
    const k = Math.min(1, Math.max(0, this.stageT / Math.max(0.05, this.active)));
    const p = _a.lerpVectors(this.from, this.to, k);
    p.y += this.height * 4 * k * (1 - k);
    this.lord.drive(p);
    this.airborne(k, dt);
  }

  protected airborne(_k: number, _dt: number): void {}

  /** 落地：片段的 land 事件（按时间兜底 = 前摇 + 腾空） */
  protected override get activeDone(): boolean {
    return this.cue('land', this.windupTime + this.active);
  }

  protected override onRecoverBegin(): void {
    this.lord.drive(this.to);
    if (this.dashing) {
      this.lord.endDash();
      this.dashing = false;
    }
    this.landings++;
    this.markRelease();
    this.land(this.to);
  }

  /** 落地的判定和特效 */
  protected abstract land(at: THREE.Vector3): void;

  protected override onRecover(): void {
    this.lord.halt();
  }

  protected override onEnd(_cancelled: boolean): void {
    if (!this.dashing) return;
    this.dashing = false;
    const p = _a.copy(this.lord.position);
    p.y = this.lord.groundAt(_b.copy(p).setY(p.y + 2));
    this.lord.drive(p);
    this.lord.endDash();
  }

  /** 落地小冲击：radius 内、站在地上的玩家挨 web 伤害 + 往外推 */
  protected smallImpact(at: THREE.Vector3, radius: number, web: number): void {
    this.ctx.fx.ring(_a.copy(at).setY(at.y + 0.1), radius, KuiPalette.Skin, 0.3);
    LordFx.dust(this.ctx, at, radius * 0.4, 4, KuiPalette.Dust);
    this.lord.shake(0.15, 0.25, 20);
    if (!this.lord.playerFeet(_b) || !this.lord.playerGrounded) return;
    if (flat(_b, at) > radius) return;
    const d = _c.set(_b.x - at.x, 0, _b.z - at.z);
    if (d.lengthSq() > 1e-4) d.normalize();
    else dir(this.facing, d);
    this.hurtPlayer(this.dmg(web), 'none', at, d.multiplyScalar(6).setY(4));
  }
}

/** 小跳（hop，0.3 / 0.55 / 0.25）：挪位、追人；3.5 m 一跳，落地 3.5 m 小冲击 8。不画地面预警（小招） */
export class KuiHop extends KuiJump {
  constructor(spec: BossMoveSpec, kui: Kui) {
    super(spec, kui);
    this.height = KuiHopPlan.Height;
    this.reach = KuiHopPlan.Reach;
    this.keep = KuiHopPlan.Keep;
  }

  protected override jumpPrepare(): void {
    this.kui.hops++;
  }

  protected land(at: THREE.Vector3): void {
    this.smallImpact(at, KuiHopPlan.ImpactRadius, KuiHopPlan.WebDamage);
  }
}

/**
 * 大跳（leap，0.75 / 1.05 / 0.8）：蹲得更深、双拳甩到身后，落点 4 m 预警圈在起手那一刻出现、腾空 1.05 s 填满；
 * 双拳砸地 → 鼓皮冲击环扩到 16 m（环经过时在地上就挨 22，跳起来躲）+ 顿帧；双拳插在地里 0.8 s = 打鼓心的窗口。
 * 落在带电的经幡杆 4.5 m 内会被回劈（Kui.tryBacklash，经 M7 的导体）
 */
export class KuiLeap extends KuiJump {
  rings = 0;

  constructor(spec: BossMoveSpec, kui: Kui) {
    super(spec, kui);
    this.height = KuiLeapPlan.Height;
    this.reach = KuiLeapPlan.Reach;
    this.keep = KuiLeapPlan.Keep;
  }

  override weightNow(): number {
    const due = this.kui.hops % this.kdef.leapEvery === 3 || this.lord.distToPlayer() > this.kdef.leapBeyond;
    return due ? this.weight : 0;
  }

  protected override telegraph(): void {
    this.warnCircle(this.to, KuiLeapPlan.LandWarn, this.windupTime + this.active);
    this.kui.tell('kui_leap', '夔要大跳——落地的冲击环跳起来躲', KuiPalette.Thunder, 30, 2);
  }

  protected override onWindup(dt: number): void {
    super.onWindup(dt);
    this.coreGlint(this.windupTime - 0.25, 1.6);
  }

  protected override get takeoffSize(): number {
    return 1.4;
  }

  protected override airborne(_k: number, dt: number): void {
    if (this.ctx.rng.next() < dt * 14) this.ctx.fx.burst(this.kui.bonePos('chest', _a), KuiPalette.Cloud, 3, 1.5, 0.6, 0.5, 0);
  }

  protected get last(): boolean {
    return false;
  }

  protected land(at: THREE.Vector3): void {
    this.hz.wave({
      x: at.x, y: at.y, z: at.z, speed: KuiLeapPlan.RingRadius / KuiLeapPlan.RingSeconds, maxRadius: KuiLeapPlan.RingRadius,
      damage: this.dmg(KuiLeapPlan.RingDamage), color: KuiPalette.Skin, width: 1.3, height: 0.85, knockback: 10, dust: KuiPalette.Dust,
    });
    this.rings++;
    this.countWarning();
    if (this.last) this.ctx.fx.ring(_a.copy(at).setY(at.y + 0.1), KuiLeapPlan.RingRadius * 0.6, KuiPalette.Thunder, 0.6);
    LordFx.dust(this.ctx, at, 2.4, 8, KuiPalette.Dust);
    this.lord.shake(0.6, 0.45, 20);
    this.lord.impactHold(0.08);
    this.kui.tryBacklash();
  }

  protected override onRecover(): void {
    super.onRecover();
  }
}

/**
 * 连环大跳（leapChain，三阶段，0.5 / 0.9 / 0.35 × 3）：三连砸，每跳的蹲更浅、冲击环一个接一个；第三跳后跪得更久（收招 + 0.6 s）。
 * 一跳一个招式，前两跳收招后直接排下一跳（queueMove，不喘息）
 */
export class KuiLeapChain extends KuiLeap {
  /** 这一串还剩几跳（含这一跳） */
  left = 0;

  constructor(spec: BossMoveSpec, kui: Kui) {
    super(spec, kui);
    this.height = KuiLeapChainPlan.Height;
    this.reach = KuiLeapChainPlan.Reach;
  }

  protected override jumpPrepare(): void {
    if (this.left <= 0) this.left = KuiLeapChainPlan.Count;
    if (this.left === 1) this.recover += KuiLeapChainPlan.LastExtraRecover;
  }

  protected override get last(): boolean {
    return this.left === 1;
  }

  protected override onEnd(cancelled: boolean): void {
    super.onEnd(cancelled);
    if (cancelled) {
      this.left = 0;
      return;
    }
    this.left--;
    if (this.left > 0) {
      this.recovery = 0;
      this.kui.queueMove(this.id);
    } else this.recovery = this.spec.recovery;
  }
}

/** 转身跳（turnLeap，0.3 / 0.5 / 0.3）：玩家绕到身后（> 115°、12 m 内），原地一蹲、空中转 180°，落地 5 m 冲击 10 */
export class KuiTurnLeap extends KuiJump {
  private turnFrom = 0;

  constructor(spec: BossMoveSpec, kui: Kui) {
    super(spec, kui);
    this.height = KuiTurnLeapPlan.Height;
  }

  override weightNow(): number {
    return playerBehind(this.kui) && this.lord.distToPlayer() < KuiTurnLeapPlan.Near ? this.weight : 0;
  }

  protected override target(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.lord.position);
  }

  protected override jumpPrepare(): void {
    this.turnFrom = this.facing;
  }

  protected override airborne(k: number): void {
    this.setFacing(this.turnFrom + 180 * smooth(k));
  }

  protected land(at: THREE.Vector3): void {
    this.smallImpact(at, KuiTurnLeapPlan.ImpactRadius, KuiTurnLeapPlan.WebDamage);
  }
}

/**
 * 拄拳（knuckle，— / 3 步 × 1.3 s / —）：长臂当拐，绕拉则挪位（2.5 m/s），胸口低到约 2.5 m：窗口。不攻击；每步落蹄扬尘。远于 12 m 时偶尔出
 */
export class KuiKnuckle extends KuiMove {
  private angle = 0;
  private radius = 8;
  private dirSign = 1;
  private dashing = false;
  steps = 0;
  travelled = 0;

  override weightNow(): number {
    return this.lord.distToPlayer() > KuiKnucklePlan.Far ? this.weight : 0;
  }

  protected override kuiPrepare(): void {
    const c = this.kui.bossCenter;
    const ox = this.lord.position.x - c.x, oz = this.lord.position.z - c.z;
    this.radius = Math.max(8, Math.hypot(ox, oz));
    this.angle = Math.atan2(ox, oz);
    // 往玩家那一侧绕
    const p = this.ctx.player.position;
    const pa = Math.atan2(p.x - c.x, p.z - c.z);
    this.dirSign = Math.sign(deltaAngle(this.angle * 180 / Math.PI, pa * 180 / Math.PI)) || 1;
    this.steps = 0;
    this.travelled = 0;
  }

  protected override onActiveBegin(): void {
    this.lord.beginDash();
    this.dashing = true;
  }

  protected override onActive(dt: number): void {
    const c = this.kui.bossCenter;
    this.angle += this.dirSign * dt * KuiKnucklePlan.Speed / this.radius;
    const t = _a.set(c.x + Math.sin(this.angle) * this.radius, this.lord.position.y + 3, c.z + Math.cos(this.angle) * this.radius);
    this.lord.clampToArena(t, this.lord.arenaMargin);
    this.onGround(t);
    const prev = _b.copy(this.lord.position);
    this.turnToward(this.yawTo(t), 180, dt);
    this.lord.drive(t);
    this.travelled += flat(prev, t);
    for (let i = 1; i <= 3; i++) {
      if (!this.stageAt(KuiKnucklePlan.StepSeconds * i - 0.01)) continue;
      this.steps++;
      LordFx.dust(this.ctx, this.onGround(this.kui.bonePos('fist_L', _c).setY(t.y + 2)), 0.5, 2, KuiPalette.Dust);
      LordFx.dust(this.ctx, this.onGround(this.kui.bonePos('fist_R', _c).setY(t.y + 2)), 0.5, 2, KuiPalette.Dust);
    }
  }

  protected override onEnd(): void {
    if (!this.dashing) return;
    this.dashing = false;
    this.lord.endDash();
  }
}

/**
 * 雷掌（clap，0.6 / 0.2 / 0.6，冷却 4 s）：正面 8 m 内——双臂往两边张开，扇形预警 60° / 8 m；0.35 s 鼓心白星；
 * 双掌合拢 = 出手（片段 hit）：正前 60° 扇形 8 m 内 16 + 雷殛 + 击退。第三个打的领主：雷掌接小跳（变体）
 */
export class KuiClap extends KuiMove {
  private yaw = 0;

  override weightNow(): number {
    return this.lord.distToPlayer() < KuiClapPlan.Range ? this.weight : 0;
  }

  protected override kuiPrepare(): void {
    this.lord.halt();
    this.yaw = this.yawToPlayer;
  }

  protected override telegraph(): void {
    this.warnSector(this.lord.position, this.yaw, KuiClapPlan.HalfAngle, KuiClapPlan.Range, this.windupTime);
  }

  protected override onWindup(dt: number): void {
    this.lord.halt();
    this.turnToward(this.yawToPlayer, 115, dt);
    this.yaw = this.facing;
    if (this.ctx.rng.next() < dt * 10) {
      this.ctx.fx.burst(this.kui.bonePos('fist_L', _a), KuiPalette.Thunder, 2, 1.2, 0.3, 0.16, 0);
      this.ctx.fx.burst(this.kui.bonePos('fist_R', _a), KuiPalette.Thunder, 2, 1.2, 0.3, 0.16, 0);
    }
    this.coreGlint(this.windupTime - 0.25);
  }

  protected override get windupDone(): boolean {
    return this.cue('hit', this.windupTime);
  }

  protected override onActiveBegin(): void {
    this.markRelease();
    const l = this.kui.bonePos('fist_L', _a), r = this.kui.bonePos('fist_R', _b);
    const palms = _c.addVectors(l, r).multiplyScalar(0.5);
    this.ctx.fx.lightning(palms, _d.copy(palms).addScaledVector(dir(this.yaw, _a), KuiClapPlan.Range), KuiPalette.Thunder);
    LordFx.blast(this.ctx, _a.copy(this.lord.position).addScaledVector(dir(this.yaw, _b), KuiClapPlan.Range * 0.5), 3, KuiPalette.Thunder, KuiPalette.ThunderCore);
    this.lord.shake(0.3, 0.3, 20);
    this.lord.impactHold(0.06);
    if (!this.lord.playerFeet(_b)) return;
    const o = this.lord.position;
    if (flat(_b, o) > KuiClapPlan.Range) return;
    if (Math.abs(deltaAngle(this.yaw, this.yawTo(_b))) > KuiClapPlan.HalfAngle + 11) return;
    const d = dir(this.yawTo(_b), _c);
    this.hurtPlayer(this.dmg(KuiClapPlan.WebDamage), 'shock', o, d.multiplyScalar(12).setY(4));
  }

  protected override onEnd(cancelled: boolean): void {
    if (!cancelled && this.kui.variant) this.kui.queueMove(KuiHopPlan.id);
  }
}

/**
 * 捶胸引雷（drum，二阶段，0.8 / 3 下 × 0.6 / 1.0；三阶段 drum5 五下）：人立、双拳举起、鼓面张开发亮（鼓心 × 1.4，霸体）；
 * 每捶一下（0.8 / 1.4 / 2.0 s…，片段 beat 事件同一时刻）：玩家脚下 + 随机一处各一道雷（1.2 s 预警、3.2 m、18；落点 5 m 内有经幡杆就劈杆——M7）。
 * 破防条满了照样破鼓（BossBrain 的破防打断霸体招）
 */
export class KuiChestDrum extends KuiMove {
  protected beatsTotal = KuiDrumPlan.Beats;
  private drumBone: THREE.Object3D | null = null;
  private readonly drumScale = new THREE.Vector3(1, 1, 1);
  bolts = 0;
  beats = 0;

  override weightNow(): number {
    return this.kui.sinceDrum >= this.every ? this.weight : 0;
  }

  protected get every(): number {
    return this.kdef.drumEvery;
  }

  protected override prepare(): void {
    this.kui.sinceDrum = 0;
    this.lord.halt();
    this.beats = 0;
    this.drumBone = this.kui.bone('drum');
    if (this.drumBone) this.drumScale.copy(this.drumBone.scale);
  }

  protected override telegraph(): void {
    this.kui.tell('kui_drum', '夔在捶胸——鼓面张开（鼓心最痛）；快去经幡杆旁躲雷', KuiPalette.Thunder, 20, 2.2);
  }

  protected override onWindup(dt: number): void {
    this.lord.halt();
    this.turnToward(this.yawToPlayer, 115, dt);
  }

  protected override onActiveBegin(): void {
    this.markRelease();
    this.beat(false);
  }

  protected override onActive(): void {
    this.lord.halt();
    for (let i = 1; i < this.beatsTotal; i++) if (this.stageAt(i * KuiDrumPlan.Interval)) this.beat(i === this.beatsTotal - 1 && this.beatsTotal > 3);
    // 鼓面一震（采样器不采骨骼缩放：这里每捶一下缩骨）
    if (this.drumBone) {
      const ph = (this.stageT % KuiDrumPlan.Interval) / KuiDrumPlan.Interval;
      const s = ph < 0.15 ? 1 + (0.94 - 1) * ph / 0.15 : ph < 0.4 ? 0.94 + (1.08 - 0.94) * (ph - 0.15) / 0.25 : 1.08 + (1 - 1.08) * (ph - 0.4) / 0.6;
      this.drumBone.scale.copy(this.drumScale).multiplyScalar(s);
    }
  }

  private beat(big: boolean): void {
    this.beats++;
    const core = this.kui.bonePos(KuiDef.WeakBone, _a);
    this.ctx.fx.ring(core, big ? 4 : 2.5, KuiPalette.Skin, 0.35);
    this.ctx.fx.burst(core, KuiPalette.ThunderCore, big ? 24 : 12, 5, 0.4, 0.2, 0);
    this.lord.shake(big ? 0.25 : 0.12, 0.2, 30);
    this.lord.impactHold(0.04);
    const feet = _b.copy(this.ctx.player.position);
    for (let k = 0; k < 2; k++) {
      const a = this.ctx.rng.next() * Math.PI * 2, r = k === 0 ? 0 : this.rng(3, 8);
      const p = new THREE.Vector3(feet.x + Math.cos(a) * r, feet.y, feet.z + Math.sin(a) * r);
      kuiStrike(p, { warn: KuiDrumPlan.Warn, radius: KuiDrumPlan.BoltRadius, damage: this.dmg(KuiDrumPlan.WebDamage) * this.lord.damageMult, source: this.lord });
      this.bolts++;
    }
  }

  protected override onEnd(): void {
    if (this.drumBone) this.drumBone.scale.copy(this.drumScale);
  }
}

/** 捶胸引雷（五下，三阶段）：0.8 / 3.0 / 1.0，五捶在 0.8 / 1.4 / 2.0 / 2.6 / 3.2 s，最后一捶双拳一起砸、鼓皮环大一号 */
export class KuiChestDrum5 extends KuiChestDrum {
  protected override beatsTotal = KuiDrum5Plan.Beats;

  protected override get every(): number {
    return this.kdef.drumEvery3;
  }
}

export function createKuiMove(kui: Kui, spec: BossMoveSpec): LordMove | null {
  switch (spec.id) {
    case KuiHopPlan.id: return new KuiHop(spec, kui);
    case KuiLeapPlan.id: return new KuiLeap(spec, kui);
    case KuiLeapChainPlan.id: return new KuiLeapChain(spec, kui);
    case KuiTurnLeapPlan.id: return new KuiTurnLeap(spec, kui);
    case KuiKnucklePlan.id: return new KuiKnuckle(spec, kui);
    case KuiClapPlan.id: return new KuiClap(spec, kui);
    case KuiDrumPlan.id: return new KuiChestDrum(spec, kui);
    case KuiDrum5Plan.id: return new KuiChestDrum5(spec, kui);
    default: return null;
  }
}
