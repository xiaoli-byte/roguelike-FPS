/**
 * 化蛇的六招（Unity Huashe/Moves/HuasheMoves.cs 逐个翻译）：吐水弹、扑岸、潜游突袭、翼拍浪、吼叫涨水、尾扫。
 * 常量与调度参数在 HuashePlans.ts。位置全由代码驱动（Huashe 一直在 dash 状态，drive 写位置）。
 * 与 Unity 的差异：水花 / 水帘 / 吼叫环 / 尾鳍扇面这些 Fx.Huashe* 换成 ctx.fx 的粒子；吐水弹是敌方抛射物（orb 外观，落地爆开溅射）。
 */
import * as THREE from 'three';
import type { BossMoveSpec } from '../framework/BossDef';
import type { Huashe } from './Huashe';
import { HuasheDef } from './HuasheDef';
import { HuasheDivePlan, HuasheLungePlan, HuashePalette, HuasheRoarPlan, HuasheSpitPlan, HuasheTailSweepPlan, HuasheWingSlapPlan } from './HuashePlans';
import { LordBrain } from './LordBrain';
import { LordFx } from './LordFx';
import { LordMove } from './LordMove';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const { dir, flat, deltaAngle } = { dir: LordBrain.dir, flat: LordBrain.flat, deltaAngle: LordBrain.deltaAngle };

/** 化蛇招式的底座：嘴张没张（出招第一帧按招式定，结束时合上）、水位 */
export abstract class HuasheMove extends LordMove {
  constructor(spec: BossMoveSpec, protected readonly hua: Huashe) {
    super(spec, hua);
  }

  protected get level(): number {
    return this.hua.lake ? this.hua.lake.level : this.lord.position.y;
  }

  protected mouth(out = _c): THREE.Vector3 {
    return this.hua.bonePos(HuasheDef.MouthBone, out);
  }

  protected head(out = _d): THREE.Vector3 {
    return this.hua.bonePos('head', out);
  }

  /** 这一招张嘴（嘴是弱点、破防条只在张嘴时填） */
  protected get opensMouth(): boolean {
    return false;
  }

  protected override prepare(): void {
    this.hua.mouthForced = this.opensMouth;
    this.huashePrepare();
  }

  protected huashePrepare(): void {}

  protected override onEnd(cancelled: boolean): void {
    this.hua.mouthForced = false;
    this.hua.driven = false;
    this.huasheEnd(cancelled);
  }

  protected huasheEnd(_cancelled: boolean): void {}

  /** 浮到水面附近（出招中） */
  protected float(depth: number, dt: number): void {
    const p = _a.copy(this.lord.position);
    p.y += (this.level + depth - p.y) * Math.min(1, dt * 4);
    this.lord.drive(p);
  }

  protected glint(at: number): void {
    if (this.cue('glint', at)) LordFx.glint(this.ctx, this.mouth(), HuashePalette.MouthCore);
  }

  protected near(): number {
    const h = this.head(_b);
    const p = this.ctx.player.position;
    return Math.hypot(h.x - p.x, h.z - p.z);
  }
}

/**
 * 吐水弹（spit，0.6 / 1.35 / 0.6，冷却 3 s）：浮起来、仰头、张嘴；连吐三发（0.6 / 1.05 / 1.5 s，片段 release）：
 * 每发瞄玩家（带一点提前量和散布），落点危险圈 2.6 m 在吐出的那一刻出现、飞 1.1 s 填满，落地 2.6 m 溅射 12（网页值）
 */
export class HuasheSpit extends HuasheMove {
  fired = 0;

  protected override get opensMouth(): boolean {
    return true;
  }

  override weightNow(): number {
    return this.lord.distToPlayer() < 60 ? this.weight : 0;
  }

  protected override onWindup(dt: number): void {
    this.float(-0.1, dt);
    this.turnToward(this.yawToPlayer, 115, dt);
  }

  protected override onActiveBegin(): void {
    this.markRelease();
    this.spit();
  }

  protected override onActive(dt: number): void {
    this.float(-0.1, dt);
    this.turnToward(this.yawToPlayer, 115, dt);
    for (let i = 1; i < HuasheSpitPlan.Releases.length; i++) if (this.at(HuasheSpitPlan.Releases[i])) this.spit();
  }

  private spit(): void {
    const from = this.mouth(new THREE.Vector3());
    const feet = _a.copy(this.ctx.player.position);
    const lead = this.lord.predict(0.8, _b).sub(this.ctx.player.position).setY(0);
    const to = new THREE.Vector3(feet.x + lead.x + this.rng(-2.5, 2.5), feet.y + 2, feet.z + lead.z + this.rng(-2.5, 2.5));
    this.onGround(to);
    if (this.hua.lake && to.y < this.level) to.y = this.level;
    this.warnCircle(to, HuasheSpitPlan.Splash, HuasheSpitPlan.Flight);
    const f = HuasheSpitPlan.Flight, g = HuasheSpitPlan.Gravity;
    const v = to.clone().sub(from).divideScalar(f).add(new THREE.Vector3(0, 0.5 * g * f, 0));
    this.ctx.projectiles.spawn({
      owner: 'enemy', position: from, velocity: v, gravity: g, radius: 0.45, lifetime: f + 0.6,
      enemyDamage: this.dmg(HuasheSpitPlan.WebDamage) * this.lord.damageMult, explosionRadius: HuasheSpitPlan.Splash,
      element: 'none', color: HuashePalette.Water, visual: 'orb', scale: 2.2, sourceEnemy: this.lord,
      onImpact: (p) => {
        LordFx.splash(this.ctx, p, 1);
        const pl = this.ctx.player.position;
        if (Math.hypot(p.x - pl.x, p.z - pl.z) < HuasheSpitPlan.Splash) this.hits++;
      },
    });
    this.fired++;
    LordFx.splash(this.ctx, from, 0.4);
  }
}

/**
 * 扑岸（lunge，0.7 / 0.35 / 1.2，冷却 4 s）：玩家在岸边 9 m 内；头往后缩成 S 形，危险扑线指向岸上；0.45 s 嘴里白星；拉直扑出 = 出手（片段 hit）：
 * 冲上岸 8 m（最多 10），咬 20 + 击退；搁浅在岸上 1.2 s（最后 30% 滑回水里）。第三个打的领主：扑岸接翼拍浪（变体）
 */
export class HuasheLunge extends HuasheMove {
  protected readonly from = new THREE.Vector3();
  protected readonly to = new THREE.Vector3();
  protected yaw = 0;
  bit = false;

  protected override get opensMouth(): boolean {
    return true;
  }

  get landed(): THREE.Vector3 {
    return this.to;
  }

  override weightNow(): number {
    return this.near() < 10 ? this.weight : 0;
  }

  /** 从 p 沿 d 往前第一处地面高出水面 0.1 m（上岸）的距离；max 米内没有岸为 −1 */
  protected shoreAhead(p: THREE.Vector3, d: THREE.Vector3, max: number): number {
    for (let s = 0.5; s <= max; s += 0.5) {
      _a.copy(p).addScaledVector(d, s);
      _a.y = this.level + 2;
      if (this.lord.groundAt(_a) > this.level + 0.1) return s;
    }
    return -1;
  }

  protected override huashePrepare(): void {
    this.hua.driven = true;
    this.from.copy(this.lord.position);
    const head = this.head(new THREE.Vector3());
    const feet = this.ctx.player.position;
    const dx = feet.x - head.x, dz = feet.z - head.z;
    let reach = Math.min(HuasheLungePlan.Reach, Math.hypot(dx, dz) + 1);
    this.yaw = Math.atan2(dx, dz) * 180 / Math.PI;
    // 游线贴着湖岸时「头到人 + 1 m」可能不够冲上岸：至少冲到岸上 3 m（最多 10 m），头胸都搁浅在岸上
    const shore = this.shoreAhead(this.from, dir(this.yaw, _b), 12);
    if (shore >= 0) reach = Math.min(HuasheLungePlan.Reach, Math.max(reach, shore + 3));
    this.to.copy(this.from).addScaledVector(dir(this.yaw, _b), reach);
    _a.copy(this.to).setY(this.level + 2);
    const g = this.lord.groundAt(_a);
    this.to.y = Math.max(g, this.level) - 0.2;
    this.bit = false;
  }

  protected override telegraph(): void {
    const head = this.head(new THREE.Vector3());
    head.y = this.level;
    const end = head.clone().addScaledVector(dir(this.yaw, _b), flat(this.from, this.to) + 2);
    this.warnLine(head, end, HuasheLungePlan.Width, this.windupTime);
  }

  protected override onWindup(dt: number): void {
    this.turnToward(this.yaw, 230, dt);
    this.float(-0.2, dt);
    this.glint(this.windupTime - 0.25);
  }

  protected override get windupDone(): boolean {
    return this.cue('hit', this.windupTime);
  }

  protected override onActiveBegin(): void {
    this.markRelease();
    this.setFacing(this.yaw);
    const p = this.lord.position;
    LordFx.splash(this.ctx, _a.set(p.x, this.level, p.z), 0.8);
  }

  protected override onActive(): void {
    const k = Math.min(1, Math.max(0, this.stageT / Math.max(0.05, this.active)));
    const p = _a.lerpVectors(this.from, this.to, k);
    _b.copy(p).setY(Math.max(p.y, this.level) + 2);
    p.y = Math.max(p.y, this.lord.groundAt(_b) - 0.1);
    this.lord.drive(p);
    this.setFacing(this.yaw);
    if (this.bit || !this.lord.playerFeet(_b)) return;
    const head = this.head(_c);
    if (flat(_b, head) > HuasheLungePlan.BiteRadius) return;
    this.bit = true;
    LordFx.impact(this.ctx, head, HuashePalette.Mouth, false);
    const d = _d.set(_b.x - head.x, 0, _b.z - head.z);
    if (d.lengthSq() > 1e-4) d.normalize();
    else dir(this.yaw, d);
    this.hurtPlayer(this.dmg(HuasheLungePlan.WebDamage), 'none', head, d.multiplyScalar(9).setY(4));
  }

  protected override onRecoverBegin(): void {
    this.lord.drive(this.to);
    LordFx.dust(this.ctx, this.to, 1, 4, HuashePalette.Mud);
  }

  protected override onRecover(dt: number): void {
    const k = this.stageT / Math.max(0.05, this.recover);
    // 搁浅：最后 30% 滑回水里
    if (k > 0.7) {
      const s = LordBrain.smooth((k - 0.7) / 0.3);
      this.lord.drive(_a.lerpVectors(this.to, this.from, s));
    } else if (this.ctx.rng.next() < dt * 2.5) LordFx.dust(this.ctx, this.to, 0.7, 1, HuashePalette.Mud);
  }

  protected override huasheEnd(cancelled: boolean): void {
    if (this.hua.lake) this.hua.swimAngle = this.hua.lake.angleOf(this.lord.position);
    if (!cancelled && this.hua.variant && this.id === HuasheLungePlan.id) this.hua.queueMove(HuasheWingSlapPlan.id);
  }
}

/**
 * 潜游突袭（dive，二阶段起，1.5 / 0.35 / 1.2，冷却 7 s）：沉下去，一串气泡涟漪朝玩家最近的岸边游过来（前摇里挪 60% 的路）；危险扑线；1.25 s 白星；
 * 破水扑出 = 出手（片段 hit），之后同扑岸。玩家离 10–30 m 时出
 */
export class HuasheDive extends HuasheLunge {
  private readonly start = new THREE.Vector3();
  private bubbleAcc = 0;

  override weightNow(): number {
    const d = this.near();
    return d > 10 && d < 30 ? this.weight : 0;
  }

  protected override huashePrepare(): void {
    super.huashePrepare();
    this.start.copy(this.from);
    this.hua.mouthForced = false;
  }

  protected override onWindup(dt: number): void {
    const k = this.stageT / Math.max(0.05, this.windupTime);
    const p = _a.lerpVectors(this.start, this.to, k * 0.6);
    p.y = this.level - 2.5;
    this.lord.drive(p);
    this.setFacing(this.yaw);
    this.from.copy(p);
    this.bubbleAcc += dt;
    if (this.bubbleAcc > 0.12) {
      this.bubbleAcc = 0;
      LordFx.ripple(this.ctx, _b.set(p.x, this.level, p.z).addScaledVector(dir(this.yaw, _c), 3), 1.1);
    }
    if (k > 0.9) this.hua.mouthForced = true;
    this.glint(this.windupTime - 0.25);
  }

  protected override onActiveBegin(): void {
    this.hua.mouthForced = true;
    this.from.copy(this.lord.position);
    this.from.y = this.level - 0.3;
    super.onActiveBegin();
    LordFx.splash(this.ctx, _a.set(this.from.x, this.level, this.from.z), 1.2);
  }
}

/**
 * 翼拍浪（wingslap，0.8 / 0.4 / 0.6，冷却 5 s）：双翼高高举起；脚下 6 m 危险圈；双翼拍在水面 = 出手（片段 hit）：
 * 一圈 1 m 高的浪往岸上推到 30 m（环经过时在地上就挨 10 + 推开，跳过）
 */
export class HuasheWingSlap extends HuasheMove {
  waves = 0;

  override weightNow(): number {
    return this.lord.distToPlayer() < 26 ? this.weight : 0.2;
  }

  protected override telegraph(): void {
    const o = _a.copy(this.lord.position);
    o.y = this.level;
    this.warnCircle(o, HuasheWingSlapPlan.Warn, this.windupTime);
  }

  protected override onWindup(dt: number): void {
    this.float(-0.1, dt);
    this.turnToward(this.yawToPlayer, 90, dt);
  }

  protected override get windupDone(): boolean {
    return this.cue('hit', this.windupTime);
  }

  protected override onActiveBegin(): void {
    this.markRelease();
    const c = _a.copy(this.lord.position);
    c.y = this.level;
    this.hz.wave({
      x: c.x, y: c.y, z: c.z, speed: HuasheWingSlapPlan.Range / HuasheWingSlapPlan.Seconds, maxRadius: HuasheWingSlapPlan.Range,
      damage: this.dmg(HuasheWingSlapPlan.WebDamage), color: HuashePalette.Water, startRadius: 2.5, width: 1.4, height: 1.0, knockback: 9,
      dust: HuashePalette.Foam,
    });
    this.waves++;
    this.countWarning();
    LordFx.splash(this.ctx, c, 1.6);
    this.lord.shake(0.25, 0.3, 40);
    this.lord.impactHold(0.06);
  }
}

/**
 * 吼叫涨水（roar，二阶段起，0.6 / 2.4 / 0.8，冷却 12 s，霸体）：昂首、嘴张到最大；湖水 2.4 s 内再涨 0.8 m，6 s 后退回。
 * 前摇 / 吼叫中打满破防条就噎住、不涨水（BossBrain 的破防打断霸体招）
 */
export class HuasheRoar extends HuasheMove {
  private ringAcc = 0;

  protected override get opensMouth(): boolean {
    return true;
  }

  override weightNow(): number {
    const lake = this.hua.lake;
    return lake && lake.surge > 0.05 ? 0 : this.hua.phase >= 2 ? 2 : 1;
  }

  protected override telegraph(): void {
    this.hua.tell('huashe_roar', '化蛇张嘴吼叫——湖水要涨了，打它的嘴！', HuashePalette.Mouth, 14, 2.2);
  }

  protected override onWindup(dt: number): void {
    this.float(-0.1, dt);
    this.turnToward(this.yawToPlayer, 90, dt);
  }

  protected override onActiveBegin(): void {
    this.markRelease();
  }

  protected override onActive(dt: number): void {
    this.float(-0.1, dt);
    const h = this.hua.hdef, lake = this.hua.lake;
    if (lake) {
      lake.surge = Math.min(h.surge, lake.surge + dt * h.surge / Math.max(0.1, this.active));
      this.hua.surgeHold = h.surgeHold;
    }
    this.ringAcc += dt;
    if (this.ringAcc >= 0.4) {
      this.ringAcc = 0;
      const m = this.mouth();
      this.ctx.fx.ring(_a.set(m.x, this.level + 0.05, m.z), 6, HuashePalette.Mouth, 0.6);
    }
  }
}

/**
 * 尾扫（tailsweep，三阶段，0.7 / 0.5 / 0.8，冷却 5 s）：尾鳍高高翘出水面；危险扇形 120° / 14 m（朝尾巴那一侧）；尾巴横扫 = 出手（片段 hit）：
 * 扇形里、站在地上的人挨 14 + 推开（跳 / 冲刺躲）
 */
export class HuasheTailSweep extends HuasheMove {
  private yaw = 0;

  override weightNow(): number {
    return this.lord.distToPlayer() < HuasheTailSweepPlan.Range ? this.weight : 0;
  }

  protected override huashePrepare(): void {
    this.yaw = this.yawTo(this.hua.bonePos('tail_6', _a));
  }

  protected override telegraph(): void {
    const o = _a.copy(this.lord.position);
    o.y = this.level;
    this.warnSector(o, this.yaw, HuasheTailSweepPlan.HalfAngle, HuasheTailSweepPlan.Range, this.windupTime);
  }

  protected override onWindup(dt: number): void {
    this.float(-0.1, dt);
  }

  protected override get windupDone(): boolean {
    return this.cue('hit', this.windupTime);
  }

  protected override onActiveBegin(): void {
    this.markRelease();
    const o = _a.copy(this.lord.position);
    o.y = this.level;
    for (let i = -2; i <= 2; i++) LordFx.splash(this.ctx, _b.copy(o).addScaledVector(dir(this.yaw + i * 25, _c), HuasheTailSweepPlan.Range * 0.6), 0.6);
    this.lord.shake(0.2, 0.3, 30);
    if (!this.lord.playerFeet(_b) || !this.lord.playerGrounded) return;
    if (flat(_b, o) > HuasheTailSweepPlan.Range || Math.abs(deltaAngle(this.yaw, this.yawTo(_b))) > HuasheTailSweepPlan.HalfAngle) return;
    const d = _d.set(_b.x - o.x, 0, _b.z - o.z);
    if (d.lengthSq() > 1e-4) d.normalize();
    this.hurtPlayer(this.dmg(HuasheTailSweepPlan.WebDamage), 'none', o, d.multiplyScalar(10).setY(4));
  }
}

export function createHuasheMove(hua: Huashe, spec: BossMoveSpec): LordMove | null {
  switch (spec.id) {
    case HuasheSpitPlan.id: return new HuasheSpit(spec, hua);
    case HuasheLungePlan.id: return new HuasheLunge(spec, hua);
    case HuasheDivePlan.id: return new HuasheDive(spec, hua);
    case HuasheWingSlapPlan.id: return new HuasheWingSlap(spec, hua);
    case HuasheRoarPlan.id: return new HuasheRoar(spec, hua);
    case HuasheTailSweepPlan.id: return new HuasheTailSweep(spec, hua);
    default: return null;
  }
}
