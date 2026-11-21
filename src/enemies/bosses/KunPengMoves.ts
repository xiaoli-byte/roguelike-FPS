/**
 * 鲲鹏的八个招式（Unity KunPeng/Moves/KunPengMove.cs、KunInhale / KunSlam / KunDive / KunSpit / PengGust / PengSwoop / PengFeatherRain / PengPerch 逐个翻译）。
 * 常量与调度参数在 KunPengPlans.ts；时间轴 = 前摇 / 出手 / 收招（framework/BossMove），段内时刻用 stageAt。角度一律世界 yaw（度，0 = +Z），设朝向时换成弧度。
 * 伤害：Unity 的 Dmg(TS 原值) = 招式伤害（含狂怒倍率）；难度倍率由危险物 hurt 再乘（HazardSet），与 Three.js 原值同口径。
 * 与 Unity 的差异（特效精神对齐，M11b 再做逐粒子一致）：水冠 / 浪墙 / 咬合月牙 / 扶摇柱这些 Fx.Kun* / Fx.Peng* 体积特效换成 ctx.fx 的粒子、冲击环、爆炸；
 * 吐冰的落点预警不跟着瞄准点滑动（前摇里先画一遍，出手时按当时的瞄准重新落点、冰弹自带落点预警）。
 * 动作（M12）：act(state, seconds) 同时切程序化姿势和片段（Unity KunPengMove.Act）；Unity 招式不叫、由控制器连段的（吞吸 → 扑咬、蓄力 → 猛砸、
 * 下潜 → 破水）与招式中途回待机的地方用 act(…, false) 只换程序化姿势，片段照原样播完；落台 / 起飞 / 收羽三处片段的时刻照 Unity（clipAct）。
 * 释放帧的顿帧 kp.impactHold 与 Unity 同帧同秒数（只顿首领自己的片段，程序化摆姿势时不起作用）。
 */
import * as THREE from 'three';
import { BossMove } from './framework/BossMove';
import type { BossMoveSpec } from './framework/BossDef';
import type { KunPeng } from './KunPeng';
import { KunPengDef, KunPengMath } from './KunPengDef';
import { KunDive, KunInhale, KunSlam, KunSpit, PengFeatherRain, PengGust, PengPerch, PengSwoop } from './KunPengPlans';

const DEG = Math.PI / 180;
const WARN = KunPengDef.Warn;
const ICE = KunPengDef.Ice;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _imp = new THREE.Vector3();
const { dir, yaw: yawOf, deltaAngle } = KunPengMath;

export abstract class KunPengMove extends BossMove {
  /** 经危险物画的预警个数（扇形、长条、持续区、落点；测试用） */
  warned = 0;

  constructor(spec: BossMoveSpec, protected readonly kp: KunPeng) {
    super(spec);
  }

  protected get ctx() {
    return this.kp.ctx;
  }

  protected get hz() {
    return this.kp.hazards;
  }

  protected get hole() {
    return this.kp.hole;
  }

  protected get floor(): number {
    return this.kp.hole.floorY;
  }

  protected get kdef(): KunPengDef {
    return this.kp.kdef;
  }

  /** Three.js 原值伤害换算成本首领的招式伤害（含狂怒） */
  protected dmg(tsBase: number): number {
    return this.damage(tsBase / Math.max(1, this.kp.bdef.damage));
  }

  /** 换动作：程序化姿势 + 片段；clip = false 只换程序化姿势（见文件头） */
  protected act(state: string, seconds: number, clip = true): void {
    this.kp.playAct(state, seconds, clip);
  }

  /** 只播片段、不换程序化姿势（Unity 招式播片段的时刻和网页程序化姿势的切换点不同的地方） */
  protected clipAct(state: string, seconds: number): void {
    this.kp.clipAct(state, seconds);
  }

  protected sfx(id: string, volume = 1, pitch = 1): void {
    this.kp.playSfx(id, volume, pitch);
  }

  /** 同一水平位置，高度放到环台地面 */
  protected atFloor(p: THREE.Vector3, out = p): THREE.Vector3 {
    return out.set(p.x, this.floor, p.z);
  }

  /** 地面圆形预警（招式组：招式结束 / 被打断时撤回没填满的） */
  protected warnCircle(p: THREE.Vector3, radius: number, seconds: number): void {
    this.track(this.hz.groundWarning(p.x, p.y, p.z, radius, seconds, WARN));
    this.warned++;
  }

  /** 记一个危险物组的预警（随危险物照常兑现，不撤回） */
  protected countHazardWarning(): void {
    this.track(() => {});
    this.warned++;
  }

  protected get facingDeg(): number {
    return this.kp.facingDeg;
  }

  protected rng(min: number, max: number): number {
    return this.ctx.rng.range(min, max);
  }
}

// ───────────────────────────── 鲲 · 吞吸 ─────────────────────────────

/**
 * 吞吸（4.6 s）：前摇 0.9 s 仰头张口，口前 22 m、半角 35.5° 的扇形预警；出手 3.0 s 每 0.15 s 把扇形里（半角 43°、30 m 内）、看得见冰沿的玩家往口部拉一下
 * （冰柱 / 矮墙 / 祭台挡得住气流；冰窟边缘段不挡），出手 2.2 s 时冰沿亮 5.5 m 的扑咬预警；收招 0.7 s 一口咬在冰沿上（32，击退 13 / 上抛 6）。
 */
export class KunInhaleMove extends KunPengMove {
  pulses = 0;
  blockedPulses = 0;
  totalPulses = 0;
  biteHit = false;
  readonly lastPull = new THREE.Vector3();
  private readonly mouth = new THREE.Vector3();
  private pullAcc = 0;
  private biteWound = false;

  override weightNow(): number {
    return KunInhale.weight(this.kp.distToPlayerXZ());
  }

  protected override onStart(): void {
    this.kp.aimKunAtPlayer(1);
    this.kp.mouthPoint(this.mouth);
    this.pullAcc = 0;
    this.pulses = this.blockedPulses = 0;
    this.biteHit = this.biteWound = false;
  }

  protected override onTelegraph(): void {
    const m = this.mouth;
    this.track(this.hz.sectorWarning(m.x, this.floor, m.z, this.kp.facing, KunInhale.SectorHalf * DEG, KunInhale.SectorRange, this.windupTime, WARN));
    this.warned++;
    this.act('inhale', this.windupTime + this.active);
    this.sfx('telegraph', 1, 0.7);
    this.sfx('enemy_charge', 0.9, 0.5);
    this.kp.tellOnce('inhale', '鲲在吞吸——离开它面前的扇形，或者躲到冰柱后面！', '#8fe3ff');
    // 起手身下水退、口前冷雾往回收
    this.ctx.fx.burst(_a.set(this.kp.position.x, this.hole.waterY + 0.2, this.kp.position.z), ICE, 14, 4, 0.8, 0.3, 4);
  }

  protected override onWindup(): void {
    this.kp.placeKun();
  }

  protected override onActiveBegin(): void {
    this.kp.fx?.suction(true, this.mouth, this.kp.facing);
    this.kp.fx?.setAgitation(1);
    this.pullAcc = 0;
  }

  protected override onActive(dt: number): void {
    this.kp.placeKun();
    const interval = this.kdef.pullInterval;
    this.pullAcc += dt;
    while (this.pullAcc >= interval) {
      this.pullAcc -= interval;
      this.pull();
    }
    if (this.stageAt(KunInhale.BiteWarnAt)) this.warnCircle(this.kp.biteSpot(_a), KunInhale.BiteRadius, Math.max(0.2, this.active - KunInhale.BiteWarnAt));
    if (!this.biteWound && this.stageT >= KunInhale.BiteWindAt + 0.05) {
      // 收头蓄咬：口里一记冰晶星
      this.biteWound = true;
      this.ctx.fx.burst(this.kp.muzzle(_a), 0xffffff, 10, 3, 0.4, 0.3, 0);
    }
  }

  /** 扇形里、气流够得着（没被掩体挡住）的玩家往口部拉一下 */
  private pull(): void {
    const pl = this.ctx.player;
    if (!pl.alive) return;
    const feet = pl.position;
    const tx = this.mouth.x - feet.x, tz = this.mouth.z - feet.z;
    const d = Math.hypot(tx, tz);
    if (d < 0.5 || d > KunInhale.PullReach) return;
    const off = Math.abs(deltaAngle(this.facingDeg, yawOf({ x: -tx, z: -tz })));
    if (off > KunInhale.PullHalf) return;
    // 气流从冰沿上方吹过来：从咬点胸口高度连到玩家胸口，冰柱 / 矮墙 / 祭台挡住就不受影响
    const src = this.kp.biteSpot(_a);
    src.y += 1.3;
    if (this.kp.coverBlocks(src, _b.set(feet.x, feet.y + 1.2, feet.z))) {
      this.blockedPulses++;
      return;
    }
    const k = Math.min(1.1, Math.max(0.5, 1.25 - d / 32));
    const imp = this.kdef.pullImpulse * k / 1.1;
    this.lastPull.set(tx / d, 0, tz / d);
    pl.applyImpulse(_imp.copy(this.lastPull).multiplyScalar(imp));
    this.pulses++;
    this.totalPulses++;
  }

  protected override onRecoverBegin(): void {
    this.kp.fx?.suction(false);
    // 片段：inhale 自己连到 bite（控制器连段），这里只换程序化姿势
    this.act('bite', this.recover, false);
    const b = this.kp.biteSpot(_a);
    this.biteHit = this.hz.blast(b.x, b.y + 0.3, b.z, KunInhale.BiteRadius, this.dmg(32), { maxHeight: 4, knockback: 13, knockUp: 6 });
    // 一口咬合（释放帧）：冰屑、水花往外炸
    this.ctx.fx.burst(_b.set(b.x, b.y + 1, b.z), ICE, 26, 9, 0.8, 0.35, 10);
    this.ctx.fx.burst(_b.set(b.x, b.y + 0.4, b.z), 0xeefcff, 18, 6, 0.7, 0.3, 9);
    this.ctx.fx.ring(_b.set(b.x, b.y + 0.1, b.z), KunInhale.BiteRadius, WARN, 0.5);
    this.kp.impactHold(0.07);
    this.kp.quake(0.45, 0.35);
    this.sfx('enemy_melee', 1, 0.5);
    this.sfx('boss_slam', 0.6, 1.2);
  }

  protected override onRecover(): void {
    this.kp.placeKun();
  }

  protected override onEnd(): void {
    this.kp.fx?.suction(false);
    this.kp.fx?.setAgitation(0.35);
  }
}

// ───────────────────────────── 鲲 · 猛砸冰浪 ─────────────────────────────

/**
 * 猛砸冰浪（2.5 s）：前摇 1.1 s 人立蓄力，落点 5 m 圆 + 冰浪扇形（26 m、半角 31.5°）；鲲怒时两侧再各一道窄扇（± 43°、半角 17.2°、18 m）；
 * 出手 0.85 s：落点重击（30，击退 9 / 上抛 7）+ 贴地冰浪（20）；鲲怒时两侧两道（16）、0.45 s 后再补一道（18 m/s）。头趴在环台上、鲛珠大亮；收招 0.55 s。
 * 冰浪对刚被落点重击打中的玩家不再伤害（spare）。
 */
export class KunSlamMove extends KunPengMove {
  readonly impact = new THREE.Vector3();
  yaw = 0;
  fury = false;
  waves = 0;
  blastHit = false;
  private wave2 = false;
  private apexed = false;
  private pushed = false;

  protected override onStart(): void {
    this.kp.aimKunAtPlayer(0.9);
    this.yaw = this.facingDeg;
    const reach = this.kdef.kunInset + 3.2;
    this.atFloor(this.impact.copy(this.kp.position).add(dir(this.yaw, _a).multiplyScalar(reach)));
    this.fury = this.kp.kunFury;
    this.waves = 0;
    this.blastHit = this.wave2 = this.apexed = this.pushed = false;
  }

  protected override onTelegraph(): void {
    const I = this.impact;
    this.warnCircle(I, KunSlam.BlastRadius, this.windupTime);
    this.track(this.hz.sectorWarning(I.x, I.y, I.z, this.yaw * DEG, KunSlam.WaveHalf * DEG, KunSlam.WaveRange, this.windupTime, WARN));
    this.warned++;
    if (this.fury) {
      for (const s of [-1, 1]) {
        this.track(this.hz.sectorWarning(I.x, I.y, I.z, (this.yaw + KunSlam.SideYaw * s) * DEG, KunSlam.SideHalf * DEG, KunSlam.SideRange, this.windupTime, WARN));
        this.warned++;
      }
    }
    this.act('slamWind', this.windupTime);
    this.sfx('boss_roar', 0.8, 0.8);
  }

  protected override onWindup(dt: number): void {
    this.kp.placeKun();
    // 前摇里落点的冰屑往回收；顶点一记冰晶星
    if (Math.random() < dt / 0.08) {
      const a = Math.random() * Math.PI * 2, r = KunSlam.BlastRadius * (0.6 + Math.random() * 0.5);
      this.ctx.fx.burst(_a.set(this.impact.x + Math.sin(a) * r, this.floor + 0.2, this.impact.z + Math.cos(a) * r), ICE, 2, 1.5, 0.5, 0.18, -2);
    }
    if (!this.apexed && this.stageT >= this.windupTime * KunSlam.ApexAt + 0.05) {
      this.apexed = true;
      this.ctx.fx.burst(_a.copy(this.impact).setY(this.floor + 0.6), 0xffffff, 12, 3, 0.4, 0.35, 0);
    }
  }

  protected override onActiveBegin(): void {
    const I = this.impact;
    this.kp.pearlBright = true;
    // 片段：slamWind 自己连到 slam（控制器连段），这里只换程序化姿势
    this.act('slam', this.active, false);
    this.blastHit = this.hz.blast(I.x, I.y, I.z, KunSlam.BlastRadius, this.dmg(30), { maxHeight: 3, knockback: 9, knockUp: 7 });
    this.wave(this.yaw, KunSlam.WaveHalf, 15, KunSlam.WaveRange, this.dmg(20), 1.2, 9);
    if (this.fury) for (const s of [-1, 1]) this.wave(this.yaw + KunSlam.SideYaw * s, KunSlam.SideHalf, 13, KunSlam.SideRange, this.dmg(16), 1.1, 8);
    // 释放帧（水击三千里）：冰爆、水冠、冲击环
    const fx = this.ctx.fx;
    fx.explosion(_a.set(I.x, I.y + 0.6, I.z), 4.5, ICE);
    fx.burst(_a, ICE, 40, 11, 1.0, 0.45, 16);
    fx.burst(_a.set(I.x, I.y + 0.3, I.z), 0xeefcff, 24, 7, 0.9, 0.35, 12);
    fx.ring(_b.set(I.x, I.y + 0.1, I.z), 9, WARN, 0.7);
    this.kp.impactHold(0.08);
    this.kp.quake(0.7, 0.5);
    this.sfx('boss_slam');
    this.sfx('explosion', 0.8, 0.7);
  }

  protected override onActive(): void {
    this.kp.placeKun();
    if (!this.fury || this.wave2 || !this.cue('wave2', this.windupTime + KunSlam.Wave2At)) return;
    this.wave2 = true;
    this.wave(this.yaw, KunSlam.WaveHalf, 18, KunSlam.WaveRange, this.dmg(16), 1.1, 8);
    this.sfx('boss_slam', 0.6, 1.3);
  }

  private wave(yaw: number, half: number, speed: number, range: number, dmg: number, width: number, knock: number): void {
    const I = this.impact;
    this.hz.wave({
      x: I.x, y: I.y, z: I.z, speed, maxRadius: range, damage: dmg, color: WARN, startRadius: 2.5, width, height: 0.9,
      arcCenter: yaw * DEG, arcHalf: half * DEG, knockback: knock, dust: ICE, spare: this.blastHit,
    });
    this.waves++;
  }

  protected override onRecoverBegin(): void {
    this.kp.pearlBright = false;
    // 片段：slam 播完自己回 Locomotion（Unity 收招不叫待机）
    this.act('idle', this.recover, false);
  }

  protected override onRecover(): void {
    this.kp.placeKun();
    // 撑起：头离开台面带起一圈水帘
    if (!this.pushed && this.stageT >= 0.15) {
      this.pushed = true;
      this.ctx.fx.burst(_a.copy(this.impact).setY(this.floor + 0.8), 0xeefcff, 14, 4, 0.7, 0.25, 10);
    }
  }

  protected override onEnd(): void {
    this.kp.pearlBright = false;
  }
}

// ───────────────────────────── 鲲 · 潜袭 ─────────────────────────────

/**
 * 潜袭（3.0 s）：前摇 2.0 s 沉入冰窟（0.15–0.8 s 扎下去，0.5 s 起不可选中）；0.7 s 在玩家那一侧（± 20°）的冰沿外 1.5 m 亮 4.5 m 的破冰预警、
 * 那一侧水面冒泡；1.2 s 水下换位；1.6 s 破水而出（可选中）；出手 0.3 s 扑咬：爆点重击（26，击退 10 / 上抛 8）+ 向外 ± 68.75° 的冰浪（14）；收招 0.7 s。
 * 玩家离鲲越远（方位差 > 68.75°）越爱出这一招。
 */
export class KunDiveMove extends KunPengMove {
  readonly impact = new THREE.Vector3();
  nextTheta = 0;
  relocated = false;
  blastHit = false;
  breached = false;
  private bubbleAcc = 0;
  private domed = false;

  override weightNow(): number {
    return KunDive.weight(deltaAngle(this.kp.theta, this.kp.playerAngle));
  }

  protected override onStart(): void {
    this.act('sink', this.windupTime);
    this.sfx('telegraph', 1, 0.6);
    this.bubbleAcc = 0;
    this.relocated = this.blastHit = this.domed = this.breached = false;
    this.nextTheta = this.kp.theta;
    this.atFloor(this.hole.point(this.nextTheta, this.hole.radius + 1.5, this.impact));
  }

  /** 鲲身下（方位 theta）的水面点 */
  private waterAt(theta: number, out: THREE.Vector3): THREE.Vector3 {
    this.hole.point(theta, Math.max(1, this.hole.radius - this.kdef.kunInset), out);
    out.y = this.hole.waterY;
    return out;
  }

  private relocate(): void {
    if (this.relocated) return;
    this.relocated = true;
    this.kp.theta = this.nextTheta;
    this.kp.setFacingDeg(this.nextTheta);
  }

  /** 破水而出：水柱炸开、鲲竖着冲出来（之后可选中） */
  private breach(): void {
    this.breached = true;
    this.kp.submerged = false;
    this.relocate();
    // 片段：sink 自己连到 erupt（控制器连段，破水在 sink 的第 48 帧），这里只换程序化姿势
    this.act('erupt', 1, false);
    const w = this.waterAt(this.nextTheta, _a);
    const fx = this.ctx.fx;
    for (let i = 0; i < 5; i++) fx.burst(_b.copy(w).setY(w.y + 1.2 * i), 0xeefcff, 10, 3, 0.8, 0.32, 7);
    fx.burst(w, ICE, 30, 9, 1.1, 0.4, 9);
    fx.ring(w, 6, WARN, 0.8);
    this.sfx('boss_slam', 0.8, 0.75);
  }

  protected override onWindup(dt: number): void {
    const kp = this.kp;
    // 下潜那一下的水冠白沫
    if (this.cue('plunge', KunDive.PlungeAt)) {
      const w = this.waterAt(kp.theta, _a);
      this.ctx.fx.burst(w, 0xeefcff, 26, 7, 0.9, 0.35, 10);
      this.ctx.fx.ring(w, 5, WARN, 0.6);
    }
    if (!this.breached && this.cue('breach', KunDive.BreachAt)) this.breach();
    kp.sunk = KunDive.sunkAt(this.t);
    if (this.stageT >= KunDive.SubmergeAt && !this.breached) kp.submerged = true;
    if (this.stageAt(KunDive.WarnAt)) {
      this.nextTheta = kp.playerAngle + this.rng(-KunDive.Spread, KunDive.Spread);
      this.atFloor(this.hole.point(this.nextTheta, this.hole.radius + 1.5, this.impact));
      this.warnCircle(this.impact, KunDive.BlastRadius, Math.max(0.2, this.windupTime - KunDive.WarnAt));
      this.sfx('telegraph', 1, 0.6);
    }
    if (this.stageT > KunDive.WarnAt) {
      this.bubbleAcc += dt;
      if (this.bubbleAcc >= 0.12) {
        this.bubbleAcc = 0;
        const p = this.hole.point(this.nextTheta, this.hole.radius - 1.5 - Math.random() * 3, _a);
        p.y = this.hole.waterY + 0.3;
        this.ctx.fx.burst(p, ICE, 5, 4, 0.6, 0.3, 6);
      }
    }
    if (!this.domed && this.stageT >= KunDive.BreachAt - KunDive.DomeLead) {
      // 破水前水面鼓起
      this.domed = true;
      const w = this.waterAt(this.nextTheta, _a);
      this.ctx.fx.ring(w, 4.2, 0xeefcff, KunDive.DomeLead);
      this.ctx.fx.burst(w, 0xeefcff, 14, 2, 0.5, 0.3, 3);
    }
    if (!this.relocated && this.stageT >= KunDive.RelocateAt) this.relocate();
    kp.placeKun();
  }

  protected override onActiveBegin(): void {
    const kp = this.kp;
    kp.submerged = false;
    this.relocate();
    kp.placeKun();
    const I = this.impact;
    this.blastHit = this.hz.blast(I.x, I.y, I.z, KunDive.BlastRadius, this.dmg(26), { maxHeight: 4, knockback: 10, knockUp: 8 });
    this.hz.wave({
      x: I.x, y: I.y, z: I.z, speed: 12, maxRadius: 12, damage: this.dmg(14), color: WARN, startRadius: 2, width: 1, height: 0.85,
      arcCenter: this.nextTheta * DEG, arcHalf: KunDive.WaveHalf * DEG, knockback: 7, dust: ICE, spare: this.blastHit,
    });
    if (!this.breached) this.breach();
    const fx = this.ctx.fx;
    fx.explosion(_a.set(I.x, I.y + 0.8, I.z), 4, ICE);
    fx.burst(_a, ICE, 36, 12, 1.0, 0.45, 14);
    fx.ring(_b.set(I.x, I.y + 0.1, I.z), 3.5, WARN, 0.5);
    kp.impactHold(0.07);
    kp.quake(0.55, 0.45);
    this.sfx('boss_roar', 1, 0.9);
  }

  protected override onActive(): void {
    this.kp.sunk = KunDive.sunkAt(this.t);
    this.kp.placeKun();
  }

  protected override onRecover(): void {
    this.onActive();
  }

  protected override onEnd(): void {
    this.kp.submerged = false;
  }
}

// ───────────────────────────── 鲲 · 吐冰 ─────────────────────────────

/**
 * 吐冰（1.3 s）：只在玩家离得远（> 12 m）时出。前摇 0.7 s 扬头蓄力、一路转头盯着玩家，前摇一开始就亮出各块的落点预警；
 * 出手：朝玩家 0.6 s 后的位置和两侧（± 3.2 m，鲲怒时再加一块 6.2 m）各吐一块抛物线冰弹（1.15 s 落地、拱高 7 m、落点 2.6 m、16 伤），落点夹在环台上；收招 0.5 s。
 */
export class KunSpitMove extends KunPengMove {
  lobs = 0;
  totalLobs = 0;
  private readonly targets: THREE.Vector3[] = [];

  override weightNow(): number {
    return KunSpit.weight(this.kp.distToPlayerXZ());
  }

  private get count(): number {
    return this.kp.kunFury ? 4 : 3;
  }

  /** 此刻出手的话各块冰弹的落点 */
  private plan(n: number): void {
    const aim = this.atFloor(this.kp.predict(KunSpit.Lead, _a));
    const tx = aim.x - this.kp.position.x, tz = aim.z - this.kp.position.z;
    const yaw = tx * tx + tz * tz > 1e-4 ? yawOf({ x: tx, z: tz }) : this.facingDeg;
    const side = dir(yaw + 90, _b);
    while (this.targets.length < n) this.targets.push(new THREE.Vector3());
    this.targets.length = n;
    for (let i = 0; i < n; i++) {
      const t = this.targets[i].copy(aim).addScaledVector(side, KunSpit.side(i));
      if (this.hole.found) this.hole.clampToRing(t, 1, 1.5, t);
    }
  }

  protected override onStart(): void {
    this.lobs = 0;
    this.act('spit', this.windupTime + this.active + this.recover);
    this.sfx('enemy_charge', 1, 0.7);
  }

  protected override onTelegraph(): void {
    this.plan(this.count);
    for (const t of this.targets) this.warnCircle(t, KunSpit.Radius, this.windupTime);
  }

  protected override onWindup(dt: number): void {
    this.kp.turnKunToward(69, dt);
    this.kp.placeKun();
    // 蓄冰珠：口前冷雾、冰屑往嘴里收
    if (this.stageT < this.windupTime - 0.1 && Math.random() < dt / 0.06) {
      const m = this.kp.muzzle(_c);
      this.ctx.fx.burst(m, ICE, 2, 1.2, 0.35, 0.16, 0);
    }
  }

  protected override onActiveBegin(): void {
    const from = this.kp.muzzle(_c).clone();
    this.plan(this.count);
    for (const t of this.targets) {
      this.hz.lob({ from, to: t.clone(), time: KunSpit.Flight, arc: KunSpit.Arc, radius: KunSpit.Radius, damage: this.dmg(16), color: WARN, kind: 'ice', scale: 1.4 });
      this.countHazardWarning();
      this.lobs++;
      this.totalLobs++;
    }
    this.sfx('enemy_shot', 0.9, 0.6);
    this.ctx.fx.burst(from, ICE, 18, 7, 0.6, 0.3, 4);
    this.ctx.fx.burst(from, 0xffffff, 8, 3, 0.3, 0.35, 0);
  }

  protected override onActive(): void {
    this.kp.placeKun();
  }

  protected override onRecover(): void {
    this.kp.placeKun();
  }
}

// ───────────────────────────── 鹏 · 扇翼狂风 ─────────────────────────────

/**
 * 扇翼狂风（5.8 s；化鹏后的第一招）：前摇 2.0 s 飞到冰窟上空（12.5 m）蓄力，前摇一开始环台外缘就亮起一圈冻风带的预警（r 外缘 − 5 … 外缘 + 1，
 * 预警 = 整段前摇，之后 3.6 s 每 0.4 s 一跳 8 伤，脚底 3 m 以内）；出手 3.4 s 每 0.15 s 把玩家往外缘推一下（冰柱 / 矮墙 / 祭台背后不受风）；收招 0.4 s。
 */
export class PengGustMove extends KunPengMove {
  pushes = 0;
  blockedPushes = 0;
  flaps = 0;
  readonly lastPush = new THREE.Vector3();
  band: { readonly ended: boolean; expire(): void } | null = null;
  private pushAcc = 0;
  private shakeAcc = 0;
  private lastFlap = -99;
  private apexed = false;

  protected override onStart(): void {
    this.act('gust', this.windup + this.active + this.recover);
    this.apexed = false;
    this.lastFlap = -99;
    this.flaps = 0;
    this.kp.hoverAlt = this.kdef.pengOverHole + 1;
    this.kp.accel = 26;
    this.kp.movesSincePerch++;
    this.pushAcc = this.shakeAcc = 0;
    this.pushes = this.blockedPushes = 0;
    this.band = null;
  }

  /** 前摇一开始就铺冻风带：预警（环形）= 整段前摇，前摇结束那一刻生效 */
  protected override onTelegraph(): void {
    const h = this.hole;
    const band = this.hz.zone({
      x: h.center.x, y: this.floor, z: h.center.z, radius: h.outer + 1, innerRadius: Math.max(h.radius + 4, h.outer - 5),
      duration: PengGust.ZoneSeconds, arm: Math.max(PengGust.ZoneArm, this.windupTime), damage: this.dmg(8), interval: 0.4,
      color: KunPengDef.Gust, element: 'none', maxHeight: 3, embers: 0xeaf8ff,
    });
    this.band = band;
    // 前摇里被打断就作废（还没生效的冻风带）
    this.track(() => {
      if (!this.reachedActive && !band.ended) band.expire();
    });
    this.warned++;
    this.sfx('telegraph', 1, 0.8);
    this.kp.tellOnce('gust', '鹏扇起狂风——躲到冰柱后面，别被吹到环台外缘的冻风带里！', '#bfe9ff');
  }

  /** 一下下扇的风：身下一圈贴地风环 + 卷起的雪 */
  private flap(strong: boolean): void {
    this.lastFlap = this.t;
    this.flaps++;
    const p = this.kp.position;
    const ground = _a.set(p.x, this.hole.found && this.hole.overHole(p) ? this.hole.waterY : this.floor, p.z);
    this.ctx.fx.ring(ground.setY(ground.y + 0.1), strong ? 9 : 6, KunPengDef.Gust, 0.5);
    this.ctx.fx.burst(ground.setY(ground.y + 0.4), 0xeaf8ff, strong ? 26 : 12, strong ? 10 : 6, 0.7, 0.3, 2);
  }

  protected override onWindup(dt: number): void {
    if (!this.apexed && this.stageT >= PengGust.ApexAt) {
      this.apexed = true;
      this.ctx.fx.burst(this.kp.wingTip(true, _a), 0xffffff, 8, 2, 0.4, 0.35, 0);
      this.ctx.fx.burst(this.kp.wingTip(false, _a), 0xffffff, 8, 2, 0.4, 0.35, 0);
    }
    if (this.stageT < PengGust.FlyIn) this.kp.flyTo(this.hole.center, 14, 1);
    else this.kp.hover();
    this.kp.faceDeg(this.ctx.player.position, 115, dt);
  }

  protected override onActiveBegin(): void {
    this.kp.fx?.gust(true, this.hole.center, this.hole.radius, this.hole.outer);
    this.ctx.fx.burst(this.kp.getBodyCenter(_a), 0xeaf8ff, 30, 9, 1, 0.45, 1);
    this.flap(true);
    this.kp.impactHold(0.06);
    this.kp.quake(0.3, 0.35);
  }

  protected override onActive(dt: number): void {
    if (this.t - this.lastFlap > PengGust.FlapPeriod * 1.35) this.flap(false);
    this.kp.hover();
    this.kp.faceDeg(this.ctx.player.position, 115, dt);
    const interval = this.kdef.pullInterval;
    this.pushAcc += dt;
    while (this.pushAcc >= interval) {
      this.pushAcc -= interval;
      this.push();
    }
    this.shakeAcc += dt;
    if (this.shakeAcc < 0.5) return;
    this.shakeAcc = 0;
    this.kp.quake(0.12, 0.3);
    this.sfx('enemy_charge', 0.5, 0.4);
  }

  /** 从冰窟上空吹向外缘：从玩家方向的冰沿外 0.5 m、2 m 高连到玩家胸口，掩体挡住就不受风（冰窟里的不算） */
  private push(): void {
    const pl = this.ctx.player;
    if (!pl.alive) return;
    const feet = pl.position, c = this.hole.center;
    const dx = feet.x - c.x, dz = feet.z - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1) return;
    const src = this.hole.point(yawOf({ x: dx, z: dz }), this.hole.radius + 0.5, _a);
    src.y += 2;
    if (dist > this.hole.radius + 1 && this.kp.coverBlocks(src, _b.set(feet.x, feet.y + 1.2, feet.z))) {
      this.blockedPushes++;
      return;
    }
    this.lastPush.set(dx / dist, 0, dz / dist);
    pl.applyImpulse(_imp.copy(this.lastPush).multiplyScalar(this.kdef.pullImpulse));
    this.pushes++;
  }

  protected override onRecoverBegin(): void {
    this.kp.fx?.gust(false);
  }

  protected override onEnd(cancelled: boolean): void {
    if (cancelled && this.band && !this.reachedActive && !this.band.ended) this.band.expire();
    this.kp.fx?.gust(false);
    this.kp.hoverAlt = this.kdef.pengHover;
    this.kp.accel = this.kdef.pengAccel;
  }
}

// ───────────────────────────── 鹏 · 俯冲掠台 ─────────────────────────────

type SwoopSub = 'aim' | 'tele' | 'dive' | 'pause';

/**
 * 俯冲掠台：前摇（瞄准 ≤ 1.8 s + 预警 0.9 s）定一条过玩家方位、沿环台切线的俯冲线（从鹏所在的那一头进场），飞到起点、降到 7 m，地面亮半宽 2.3 m 的长条预警；
 * 出手：贴地 0.6 m、26 m/s 沿预警线掠过，双爪到胸口的一段碰到玩家就是一下（30，往前 12 m/s 掀飞）；掠完猛刹车拉起；狂怒时停 0.6 s 再瞄一次、连掠两次；收招 0.6 s。
 * 撞柱：双爪上方 1.5 m 的探针撞上陡面（法线朝上分量 < 0.5；冰窟边缘段不算）就硬直 1.8 s（crash，鲛珠大亮），招式打断。
 * 瞄线时沿线模拟一遍：陡面在玩家之前 = 引撞，照常俯冲；在玩家之后 = 线截到它前面 8 m，掠过玩家就拉起。
 */
export class PengSwoopMove extends KunPengMove {
  dives = 0;
  hits = 0;
  crashed = false;
  readonly from = new THREE.Vector3();
  yaw = 0;
  length = 0;
  lowestAlt = Infinity;
  wallAt = Infinity;
  lured = false;
  trimmed = false;
  sub: SwoopSub = 'aim';
  private subT = 0;
  private travel = 0;
  private trailAcc = 0;
  private left = 0;
  private hit = false;
  private cocked = false;
  private readonly prevTalons = new THREE.Vector3();

  override weightNow(): number {
    return PengSwoop.weight(this.kp.distToPlayerXZ());
  }

  protected override get windupDone(): boolean {
    return false;
  }

  protected override get activeDone(): boolean {
    return false;
  }

  protected override onStart(): void {
    this.left = this.kp.enraged ? 2 : 1;
    this.dives = this.hits = 0;
    this.crashed = false;
    this.lowestAlt = Infinity;
    this.kp.movesSincePerch++;
    this.beginAim();
  }

  private beginAim(): void {
    this.sub = 'aim';
    this.subT = 0;
    this.act('swoopReady', 2.4);
    this.cocked = false;
    const player = this.ctx.player.position;
    const side = KunPengMath.swoopSide(this.hole, player, this.kp.position, this.ctx.rng.sign());
    const line = KunPengMath.swoopLine(this.hole, player, side);
    this.atFloor(line.from, this.from);
    this.yaw = line.yaw;
    const d = dir(this.yaw, _d);
    const playerAt = (player.x - this.from.x) * d.x + (player.z - this.from.z) * d.z;
    this.wallAt = this.wallOnLine(this.from, d, line.length);
    this.lured = KunPengMath.swoopLured(line.length, playerAt, this.wallAt);
    this.length = KunPengMath.trimSwoop(line.length, playerAt, this.wallAt, Math.max(PengSwoop.PullUp, this.reach(0.05) + 4), PengSwoop.PastPlayer);
    this.trimmed = this.length < line.length - 0.01;
    this.kp.hoverAlt = this.kp.overHoleAlt(this.kdef.pengOverHole + 0.5);
    this.kp.accel = 40;
    this.sfx('enemy_alert', 1, 0.7);
  }

  protected override onWindup(dt: number): void {
    this.tick(dt);
  }

  protected override onActive(dt: number): void {
    this.tick(dt);
  }

  private tick(dt: number): void {
    this.subT += dt;
    const kp = this.kp;
    switch (this.sub) {
      case 'aim': {
        const arrived = kp.flyTo(this.from, 22, 2.5);
        kp.faceDeg(this.from, 230, dt);
        if (!arrived && this.subT <= PengSwoop.AimMax) return;
        this.sub = 'tele';
        this.subT = 0;
        kp.hoverAlt = PengSwoop.TeleAlt;
        const F = this.from;
        this.track(this.hz.lineWarning(F.x, F.y, F.z, this.yaw * DEG, this.length, PengSwoop.HalfWidth, PengSwoop.TeleSeconds, WARN));
        this.warned++;
        this.sfx('telegraph');
        return;
      }
      case 'tele':
        if (!this.cocked && this.subT >= PengSwoop.TeleSeconds * 0.45) {
          this.cocked = true;
          this.ctx.fx.burst(kp.wingTip(true, _a), 0xffffff, 8, 2, 0.35, 0.3, 0);
          this.ctx.fx.burst(kp.wingTip(false, _a), 0xffffff, 8, 2, 0.35, 0.3, 0);
        }
        // 瞄准超时没飞到起点时，预警期间接着往起点靠
        kp.flyTo(this.from, 22, 1);
        kp.setFacingDeg(KunPengMath.moveTowardsAngle(this.facingDeg, this.yaw, 286 * dt));
        if (this.subT < PengSwoop.TeleSeconds) return;
        if (this.stage === 'windup') this.endWindup();
        this.beginDive();
        return;
      case 'dive':
        this.stepDive(dt);
        return;
      case 'pause':
        kp.hover();
        kp.faceDeg(this.ctx.player.position, 143, dt);
        if (this.subT >= 0.6) this.beginAim();
        return;
    }
  }

  private beginDive(): void {
    this.sub = 'dive';
    this.subT = this.travel = this.trailAcc = 0;
    this.hit = false;
    this.left--;
    this.dives++;
    const kp = this.kp;
    kp.accel = 90;
    kp.hoverAlt = PengSwoop.DiveAlt;
    kp.diving = true;
    kp.velocity.y = Math.min(kp.velocity.y, -10);
    kp.setFacingDeg(this.yaw);
    this.act('dive', 1.2);
    this.sfx('boss_roar', 0.8, 1.5);
    kp.talons(this.prevTalons);
    // 破空：一支箭冲下来那一刻的白环
    const c = kp.getBodyCenter(_a);
    this.ctx.fx.ring(c, 4, 0xffffff, 0.35);
    this.ctx.fx.burst(c, 0xeaf8ff, 16, 8, 0.5, 0.3, 0);
  }

  private stepDive(dt: number): void {
    const kp = this.kp;
    const d = dir(this.yaw, _d);
    // 沿预警线：进度按在线上的投影算，横向偏差拉回线上
    const rx = kp.position.x - this.from.x, rz = kp.position.z - this.from.z;
    const ax = d.z, az = -d.x;
    const off = rx * ax + rz * az;
    const side = Math.min(PengSwoop.LineMaxSide, Math.max(-PengSwoop.LineMaxSide, off * PengSwoop.LineGain));
    kp.flyVelocityTo(d.x * PengSwoop.DiveSpeed - ax * side, d.z * PengSwoop.DiveSpeed - az * side);
    kp.setFacingDeg(this.yaw);
    this.travel = Math.max(this.travel, rx * d.x + rz * d.z);
    this.lowestAlt = Math.min(this.lowestAlt, kp.position.y - this.floor);
    const talons = kp.talons(_a);
    const chest = kp.chest(_b);
    if (!this.hit && (this.hz.segmentHitsPlayer(talons, chest, PengSwoop.HitRadius) || this.hz.segmentHitsPlayer(this.prevTalons, talons, PengSwoop.HitRadius))) {
      this.hit = true;
      this.hits++;
      this.hz.hurt(this.dmg(30), 'none', kp.position);
      this.ctx.player.applyImpulse(_imp.set(d.x * 12, 6, d.z * 12));
      kp.impactHold(0.05);
      kp.quake(0.5, 0.35);
      this.sfx('enemy_melee', 1, 0.7);
    }
    this.prevTalons.copy(talons);
    this.trailAcc += dt;
    if (this.trailAcc >= 0.05) {
      this.trailAcc = 0;
      this.ctx.fx.burst(talons, ICE, 4, 2, 0.6, 0.35, -1);
      if (kp.position.y - this.floor < 2.5) this.ctx.fx.burst(_c.set(talons.x, this.floor + 0.2, talons.z), 0xeaf8ff, 5, 4, 0.5, 0.3, 4);
    }
    const crashed = this.subT > 0.2 && this.wallAhead(d, dt);
    if (this.travel < this.length && !crashed && this.subT <= PengSwoop.DiveMax) return;
    kp.diving = false;
    kp.hover();
    if (crashed) kp.accel = this.kdef.pengAccel;
    else {
      // 拉起：猛刹车、往上一抬
      kp.accel = PengSwoop.PullBrake;
      kp.velocity.y = Math.max(kp.velocity.y, PengSwoop.PullLift);
    }
    if (crashed) {
      this.crashed = true;
      this.ctx.fx.burst(talons, ICE, 24, 8, 0.9, 0.4, 12);
      this.ctx.fx.explosion(_c.copy(talons), 2.6, ICE);
      this.ctx.fx.ring(_c.set(talons.x, this.floor + 0.1, talons.z), 3.5, WARN, 0.5);
      this.sfx('boss_slam', 1, 1.1);
      kp.impactHold(0.09);
      kp.quake(0.55, 0.4);
      // 撞晕：脚本化硬直（打断招式，crash 动作，鲛珠大亮）
      kp.stagger(PengSwoop.CrashStagger, 'crash');
      return;
    }
    kp.hoverAlt = this.kdef.pengHover;
    if (this.left > 0) {
      this.sub = 'pause';
      this.subT = 0;
      return;
    }
    this.endActive();
  }

  /** 探针往前伸多远：这一帧飞的距离 + 胸口到双爪的前伸 + 0.5 m */
  private reach(dt: number): number {
    return PengSwoop.DiveSpeed * dt + this.kp.radius * 0.6 + 0.5;
  }

  private wallAhead(d: THREE.Vector3, dt: number): boolean {
    const p = this.kp.position;
    return this.kp.steepAhead(_c.set(p.x, p.y + PengSwoop.ProbeLift, p.z), d, this.reach(dt)) < Infinity;
  }

  /** 瞄线时沿线模拟一遍撞柱判定（每 0.5 m 一步；高度按预警悬停的 7 m 往下压到贴地），返回陡面离起点多远（不会撞 = ∞） */
  private wallOnLine(from: THREE.Vector3, d: THREE.Vector3, len: number): number {
    const step = 0.5;
    const p = new THREE.Vector3();
    for (let s = 0; s <= len; s += step) {
      p.copy(from).addScaledVector(d, s);
      p.y = this.floor + Math.max(PengSwoop.DiveAlt, PengSwoop.TeleAlt - PengSwoop.DescentRate * s / PengSwoop.DiveSpeed);
      const g = this.kp.groundBelow(p);
      if (Number.isFinite(g)) p.y = Math.max(p.y, g);
      p.y += PengSwoop.ProbeLift;
      const at = this.kp.steepAhead(p, d, step + 0.05);
      if (at < Infinity) return s + at;
    }
    return Infinity;
  }

  protected override onRecover(dt: number): void {
    this.kp.hover();
    this.kp.faceDeg(this.ctx.player.position, 143, dt);
  }

  protected override onEnd(): void {
    this.kp.diving = false;
    this.kp.accel = this.kdef.pengAccel;
    if (!this.kp.staggered) this.kp.hoverAlt = this.kdef.pengHover;
  }
}

// ───────────────────────────── 鹏 · 羽刃雨 ─────────────────────────────

/**
 * 羽刃雨：前摇 0.9 s 拔高到 17 m、展翅；出手每 0.11 s 从两翼翼尖交替洒下一枚冰羽刃，共 10 枚（狂怒 14 枚）——前三枚瞄准玩家（预判 0.6 / 0.85 / 1.1 s），
 * 其余散落在玩家周围 2.5–9.5 m；落点都夹在环台上、都有预警（危险物组：招式被打断后照常落地），1.05 s 后落地炸开（2.1 m、15 伤）；收招 0.6 s。
 */
export class PengFeatherRainMove extends KunPengMove {
  count = 0;
  fired = 0;
  totalFired = 0;

  protected override get activeDone(): boolean {
    return this.fired >= this.count && this.stageT >= this.count * PengFeatherRain.Interval;
  }

  protected override onStart(): void {
    this.count = this.kp.enraged ? PengFeatherRain.RageFeathers : PengFeatherRain.Feathers;
    this.fired = 0;
    this.kp.hoverAlt = PengFeatherRain.RainAlt;
    this.kp.movesSincePerch++;
    this.act('spread', this.windupTime);
    this.sfx('telegraph', 1, 1.3);
  }

  protected override onWindup(dt: number): void {
    this.kp.hover();
    this.kp.faceDeg(this.ctx.player.position, 115, dt);
    if (this.cue('flap', 0.43)) {
      // 升空那一记猛扇：身下一圈风环、卷起的雪
      const c = this.kp.getBodyCenter(_a);
      this.ctx.fx.ring(_b.set(c.x, this.floor + 0.1, c.z), 6, KunPengDef.Gust, 0.5);
      this.ctx.fx.burst(c, 0xeaf8ff, 18, 7, 0.6, 0.3, 1);
    }
  }

  protected override onActiveBegin(): void {
    this.fire(this.fired++);
  }

  protected override onActive(dt: number): void {
    this.kp.hover();
    this.kp.faceDeg(this.ctx.player.position, 115, dt);
    while (this.fired < this.count && this.stageT >= this.fired * PengFeatherRain.Interval) this.fire(this.fired++);
  }

  private fire(i: number): void {
    const kp = this.kp;
    const tip = kp.wingTip(i % 2 === 1, new THREE.Vector3());
    const target = new THREE.Vector3();
    if (i < 3) kp.predict(0.6 + i * 0.25, target);
    else {
      const a = this.rng(0, 360), r = 2.5 + this.rng(0, 7);
      target.copy(this.ctx.player.position).addScaledVector(dir(a, _a), r);
    }
    this.atFloor(target);
    if (this.hole.found) this.hole.clampToRing(target, 1, 1.5, target);
    const flight = PengFeatherRain.Flight, radius = PengFeatherRain.Radius, damage = this.dmg(15);
    const ok = kp.fx?.launchFeather(tip, target, flight, (p) => {
      if (!kp.alive) return;
      this.hz.blast(p.x, p.y, p.z, radius, damage, { maxHeight: 2.2, knockback: 4, knockUp: 3 });
      this.ctx.fx.burst(_c.set(p.x, p.y + 0.3, p.z), ICE, 10, 6, 0.6, 0.3, 14);
      this.ctx.audio.play('enemy_shot', { position: _c, pitch: 1.6, volume: 0.45 });
    });
    if (ok) this.hz.groundWarning(target.x, target.y, target.z, radius, flight, WARN, 'hazard');
    else this.hz.lob({ from: tip, to: target, time: flight, arc: 1.5, radius, damage, color: WARN, kind: 'ice', scale: 0.7 });
    this.countHazardWarning();
    this.totalFired++;
    // 翼尖甩出羽刃的那一下：一记冰晶星芒
    this.ctx.fx.burst(tip, 0xffffff, 4, 2, 0.25, 0.25, 0);
    if (i % 3 === 0) this.sfx('enemy_shot', 0.5, 1.3);
  }

  protected override onRecoverBegin(): void {
    // 片段：收羽 spreadEnd（Unity PengFeatherRain.OnRecoverBegin），程序化姿势回待机
    this.act('idle', this.recover, false);
    this.clipAct('spreadEnd', this.recover);
  }

  protected override onRecover(): void {
    this.kp.hover();
  }

  protected override onEnd(): void {
    this.kp.hoverAlt = this.kdef.pengHover;
  }
}

// ───────────────────────────── 鹏 · 落台歇翼 ─────────────────────────────

/**
 * 落台歇翼（二阶段的主要输出窗口）：飞累了（上次歇翼后出过两招）才出。
 *   前摇（接近 ≤ 3 s + 下降 0.9 s）：挑落台点（玩家方位往一侧偏 31.5–63° 的环台中线，优先脚下整个碰撞方块都是平地的点），以 9 m（飞越冰窟时 11.5 m）飞过去；
 *     到了就地垂直落下、收住冲过头的速度，落点亮 5 m 的预警（0.9 s）；
 *   出手 4.8 s：落地冲击（18，击退 9）+ 一圈 11 m 的冰浪（10）；收翼歇着，额头的鲛珠离地近、大亮；4.0 s 时脚下亮 7 m 的起飞预警（0.8 s）；
 *   收招 0.8 s：起飞翼风冲击（7 m、14 伤、击退 13），回到盘旋高度。
 */
export class PengPerchMove extends KunPengMove {
  readonly spot = new THREE.Vector3();
  spotFlat = false;
  landed = false;
  sub: 'approach' | 'descend' = 'approach';
  private subT = 0;
  private descendT0 = -1;
  private takeoffArmed = false;

  override weightNow(): number {
    return PengPerch.weight(this.kp.movesSincePerch);
  }

  /** 落台点：依次试几个偏角处的环台中线，脚印范围内最高的地面离环台地面不到 0.3 m 就用它，都不平就用第一个 */
  pickSpot(out = this.spot): { spot: THREE.Vector3; flat: boolean } {
    const kp = this.kp;
    const baseYaw = this.hole.angle(this.ctx.player.position);
    const side = this.ctx.rng.sign();
    const first = this.rng(31.5, 63);
    const foot = kp.radius * 0.85 + 0.3;
    let fallback: THREE.Vector3 | null = null;
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    for (const off of PengPerch.tries(first)) {
      this.hole.point(baseYaw + side * off, this.hole.midRing, p);
      if (this.ctx.nav.nearestWalkable(p, q) && Math.hypot(q.x - p.x, q.z - p.z) <= 3) p.set(q.x, p.y, q.z);
      const top = kp.groundUnder(p, foot);
      const spot = new THREE.Vector3(p.x, Math.max(top, this.floor), p.z);
      fallback ??= spot;
      if (top - this.floor < 0.3) {
        out.copy(spot);
        return { spot: out, flat: true };
      }
    }
    out.copy(fallback ?? this.atFloor(this.hole.point(baseYaw + side * first, this.hole.midRing)));
    return { spot: out, flat: false };
  }

  protected override get windupDone(): boolean {
    return false;
  }

  protected override get activeDone(): boolean {
    return this.stageT >= PengPerch.RestSeconds;
  }

  protected override onStart(): void {
    this.sub = 'approach';
    this.subT = 0;
    this.descendT0 = -1;
    this.takeoffArmed = false;
    this.landed = false;
    this.spotFlat = this.pickSpot().flat;
    this.kp.hoverAlt = Math.max(PengPerch.ApproachAlt, this.kp.overHoleAlt(PengPerch.ApproachAlt));
    this.kp.accel = 30;
    // 片段：飞过去时保持步态（Unity 这里不播动作）
    this.act('idle', 1, false);
  }

  protected override onWindup(dt: number): void {
    this.subT += dt;
    const kp = this.kp;
    if (this.sub === 'approach') {
      kp.hoverAlt = kp.overHoleAlt(PengPerch.ApproachAlt);
      const arrived = kp.flyTo(this.spot, 16, 1.2);
      kp.faceDeg(this.spot, 172, dt);
      if (!arrived && this.subT <= PengPerch.ApproachMax) return;
      this.sub = 'descend';
      this.subT = 0;
      // 离落点不远时就地落下；落地冲击按脚下实际的地面高度结算
      const s = this.spot;
      if (Math.hypot(kp.position.x - s.x, kp.position.z - s.z) < 2.5) {
        s.x = kp.position.x;
        s.z = kp.position.z;
      }
      s.y = Math.max(this.floor, kp.groundUnder(s));
      kp.hoverAlt = s.y - this.floor;
      kp.velocity.x *= 0.25;
      kp.velocity.z *= 0.25;
      this.warnCircle(s, PengPerch.LandRadius, PengPerch.DescendSeconds);
      this.sfx('telegraph', 1, 0.9);
      this.descendT0 = this.t;
      // 落台片段从下降开始播：0.9 s 的刹风、伸爪，第 27 帧触地（hit），之后循环栖落（perchRest）
      this.clipAct('perch', PengPerch.PerchClip);
      return;
    }
    kp.faceDeg(this.ctx.player.position, 115, dt);
    kp.flyTo(this.spot, 6, 0.3);
    if (this.cue('flap', this.descendT0 + 0.47)) {
      const c = kp.getBodyCenter(_a);
      this.ctx.fx.ring(_b.set(c.x, this.spot.y + 0.1, c.z), 5, KunPengDef.Gust, 0.4);
    }
    if (this.cue('hit', this.descendT0 + PengPerch.DescendSeconds + 0.05)) this.endWindup();
  }

  protected override onActiveBegin(): void {
    const kp = this.kp;
    const p = kp.position;
    const S = this.spot.set(p.x, Math.max(this.floor, kp.groundUnder(p)), p.z);
    this.landed = true;
    kp.perched = true;
    kp.pearlBright = true;
    kp.hoverAlt = S.y - this.floor;
    kp.movesSincePerch = 0;
    // 片段已经在下降时播起（触地 = 片段的 hit），这里只换程序化姿势
    this.act('perch', this.active, false);
    this.hz.blast(S.x, S.y, S.z, PengPerch.LandRadius, this.dmg(18), { maxHeight: 3, knockback: 9, knockUp: 4 });
    this.hz.wave({ x: S.x, y: S.y, z: S.z, speed: 12, maxRadius: 11, damage: this.dmg(10), color: WARN, startRadius: 3, width: 0.9, height: 0.8, knockback: 6, dust: ICE });
    kp.quake(0.55, 0.4);
    this.ctx.fx.burst(_a.set(S.x, S.y + 0.5, S.z), ICE, 30, 9, 0.9, 0.4, 12);
    this.ctx.fx.ring(_a.set(S.x, S.y + 0.1, S.z), PengPerch.LandRadius, KunPengDef.Gust, 0.6);
    kp.impactHold(0.06);
    this.sfx('boss_slam', 1, 0.9);
    kp.tellOnce('perch', '鹏落台歇翼——趁现在打它额头的鲛珠！', '#ffe08a');
  }

  protected override onActive(dt: number): void {
    this.kp.hover();
    this.kp.faceDeg(this.ctx.player.position, 46, dt);
    if (this.takeoffArmed && Math.random() < dt / 0.1) {
      // 起飞蓄力：脚下的雪往爪下收
      const a = Math.random() * Math.PI * 2, r = PengPerch.TakeoffRadius * 0.8;
      this.ctx.fx.burst(_a.set(this.spot.x + Math.sin(a) * r, this.spot.y + 0.2, this.spot.z + Math.cos(a) * r), 0xeaf8ff, 3, 2, 0.5, 0.2, -1);
    }
    if (!this.stageAt(PengPerch.TakeoffWarnAt)) return;
    this.warnCircle(this.spot, PengPerch.TakeoffRadius, Math.max(0.2, PengPerch.RestSeconds - PengPerch.TakeoffWarnAt));
    this.sfx('telegraph', 1, 1.1);
    this.takeoffArmed = true;
    // 起飞片段：0.8 s 的蹲身蓄力，第 24 帧 liftoff 离台 = 收招段开始
    this.clipAct('takeoff', PengPerch.TakeoffClip);
  }

  protected override onRecoverBegin(): void {
    const S = this.spot;
    // 片段在起飞预警亮起时已经播起（蹲身蓄力），这一帧是它的 liftoff；没走到预警（被提前结束）时补播
    this.act('takeoff', this.recover, !this.takeoffArmed);
    this.hz.blast(S.x, S.y, S.z, PengPerch.TakeoffRadius, this.dmg(14), { maxHeight: 4, knockback: 13, knockUp: 5 });
    this.ctx.fx.ring(_a.set(S.x, S.y + 0.1, S.z), 8, KunPengDef.Gust, 0.6);
    this.ctx.fx.burst(_a.set(S.x, S.y + 1, S.z), ICE, 26, 10, 0.8, 0.4, 4);
    this.sfx('boss_roar', 0.8, 1.3);
    const kp = this.kp;
    kp.perched = false;
    kp.pearlBright = false;
    kp.hoverAlt = this.kdef.pengHover;
  }

  protected override onRecover(): void {
    this.kp.hover();
  }

  protected override onEnd(): void {
    const kp = this.kp;
    kp.perched = false;
    kp.pearlBright = false;
    kp.accel = this.kdef.pengAccel;
    if (!kp.staggered) kp.hoverAlt = this.kdef.pengHover;
    if (this.landed) kp.movesSincePerch = 0;
  }
}

/** 按定义里的招式 id 造运行时招式 */
export function createKunPengMove(kp: KunPeng, id: string): BossMove | null {
  const spec = kp.bdef.move(id);
  if (!spec) return null;
  switch (id) {
    case KunInhale.id: return new KunInhaleMove(spec, kp);
    case KunSlam.id: return new KunSlamMove(spec, kp);
    case KunDive.id: return new KunDiveMove(spec, kp);
    case KunSpit.id: return new KunSpitMove(spec, kp);
    case PengGust.id: return new PengGustMove(spec, kp);
    case PengSwoop.id: return new PengSwoopMove(spec, kp);
    case PengFeatherRain.id: return new PengFeatherRainMove(spec, kp);
    case PengPerch.id: return new PengPerchMove(spec, kp);
    default: return null;
  }
}
