/**
 * 飞廉的七招（Unity Feilian/Moves/FeilianMoves.cs 逐个翻译）：蓄风狂风、低头冲撞、回旋冲撞、风刃、侧跃、龙卷风柱、风雷爆。
 * 常量与调度参数在 FeilianPlans.ts；时间轴 = 前摇 / 出手 / 收招（framework/BossMove），出手跟片段事件（hit / release）走，按时间兜底。
 * 角度是网页世界 yaw（度）。网页场景是 Unity 的镜像：Unity 的 transform.right（解剖学右侧）= 网页模型局部 −X，Unity yaw 增大（往右转）= 网页 yaw 减小。
 * 与 Unity 的差异：风痕 / 风刃月牙 / 拖尾这些 Fx.Feilian* 换成 ctx.fx 的粒子（LordFx）；风刃是敌方投射物（orb 外观）；冲撞的球扫用两道射线近似。
 */
import * as THREE from 'three';
import type { BossMoveSpec } from '../framework/BossDef';
import type { Feilian } from './Feilian';
import { FeilianDef } from './FeilianDef';
import {
  FeilianBladesPlan, FeilianChargePlan, FeilianGustPlan, FeilianPalette, FeilianSidestepPlan, FeilianStormBurstPlan, FeilianTornadoBody,
  FeilianTornadoPlan, FeilianWheelPlan,
} from './FeilianPlans';
import { LordBrain } from './LordBrain';
import { LordFx } from './LordFx';
import { LordMove } from './LordMove';

const DEG = Math.PI / 180;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _hit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as never };
const { dir, flat, deltaAngle } = { dir: LordBrain.dir, flat: LordBrain.flat, deltaAngle: LordBrain.deltaAngle };

/** 飞廉招式的底座 */
export abstract class FeilianMove extends LordMove {
  constructor(spec: BossMoveSpec, protected readonly fei: Feilian) {
    super(spec, fei);
  }

  protected get fdef(): FeilianDef {
    return this.fei.fdef;
  }

  protected orbPos(out = _c): THREE.Vector3 {
    return this.fei.bonePos(FeilianDef.WeakBone, out);
  }

  protected glint(at: number): void {
    if (this.cue('glint', at)) LordFx.glint(this.ctx, this.orbPos(), FeilianPalette.OrbCore);
  }
}

/**
 * 蓄风狂风（gust，1.0 / 0.6 / 0.8，冷却 4 s）：人立、尾羽扇张开，风痕往珠子收；危险扇形 50° / 40 m；0.75 s 珠上白星；前蹄踏地 = 出手（片段 hit）。
 * 出手：锥里、没躲在冰脊 / 巨石后面的人挨 6 并被顺风猛推 0.6 s（约 9 m/s）
 */
export class FeilianGust extends FeilianMove {
  private yaw = 0;
  lastHit = false;
  lastCovered = false;

  protected override prepare(): void {
    this.lord.halt();
    this.yaw = this.yawToPlayer;
  }

  protected override telegraph(): void {
    this.warnSector(this.lord.position, this.yaw, FeilianGustPlan.HalfAngle, FeilianGustPlan.Range, this.windupTime);
  }

  protected override onWindup(dt: number): void {
    this.lord.halt();
    this.turnToward(this.yawToPlayer, 143, dt);
    this.yaw = this.facing;
    if (this.ctx.rng.next() < dt * 12) LordFx.gather(this.ctx, this.orbPos(), FeilianPalette.Wind, 6, this.stageT / Math.max(0.05, this.windupTime));
    this.glint(this.windupTime - 0.25);
  }

  protected override get windupDone(): boolean {
    return this.cue('hit', this.windupTime);
  }

  protected override onActiveBegin(): void {
    this.markRelease();
    const d = dir(this.yaw, _a);
    LordFx.gust(this.ctx, _b.copy(this.lord.position).addScaledVector(d, 2), d, FeilianGustPlan.Range, FeilianPalette.Wind);
    this.lord.shake(0.25, 0.3, 40);
    this.lord.impactHold(0.05);
    this.lastHit = this.lastCovered = false;
    if (!this.lord.playerFeet(_c)) return;
    const o = this.lord.position;
    if (flat(_c, o) > FeilianGustPlan.Range || Math.abs(deltaAngle(this.yaw, this.yawTo(_c))) > FeilianGustPlan.HalfAngle + 9) return;
    if (this.fei.covered(this.orbPos(_d))) {
      this.lastCovered = true;
      this.fei.tell('feilian_cover', '躲在掩体后面，狂风吹不到', FeilianPalette.Wind, 6, 1.2);
      return;
    }
    this.lastHit = true;
    this.hurtPlayer(this.dmg(FeilianGustPlan.WebDamage), 'none', o, _b.copy(d).multiplyScalar(6));
    this.fei.gustLeft = FeilianGustPlan.PushSeconds;
    this.fei.gustDir.copy(d);
  }

  protected override onActive(): void {
    this.lord.halt();
  }
}

/**
 * 低头冲撞（charge，0.8 / ≤ 1.4 / 1.0，冷却 3 s）：低头、右前蹄刨冰两下；危险冲撞线 30 m × 3 m；0.55 s 珠上白星；后蹄蹬冰 = 冲出（片段 hit）：
 * 24 m/s，撞到人 22 + 击退；撞上冰脊 / 巨石就晕 2 s（侧倒）。第三个打的领主：冲撞接风刃（变体）
 */
export class FeilianCharge extends FeilianMove {
  protected yaw = 0;
  protected turnRate = 0;
  private dashing = false;
  private hit = false;
  travelled = 0;
  crashed = false;

  get hitPlayer(): boolean {
    return this.hit;
  }

  override weightNow(): number {
    return this.weight * FeilianChargePlan.weight(this.lord.distToPlayer());
  }

  protected override prepare(): void {
    this.lord.halt();
    this.yaw = this.yawToPlayer;
    this.travelled = 0;
    this.crashed = this.hit = false;
    this.turnRate = 0;
  }

  protected override telegraph(): void {
    const o = this.lord.position;
    this.warnLine(o, _a.copy(o).addScaledVector(dir(this.yaw, _b), FeilianChargePlan.Length), FeilianChargePlan.Width, this.windupTime);
  }

  /** 刨冰的那只前蹄（镜像片段换左前蹄） */
  protected get pawHoof(): string {
    return 'fhoof_R';
  }

  protected override onWindup(dt: number): void {
    this.lord.halt();
    this.turnToward(this.yaw, 286, dt);
    this.glint(this.windupTime - 0.25);
    if (this.stageAt(14 / 30) || this.stageAt(19 / 30)) LordFx.dust(this.ctx, this.fei.bonePos(this.pawHoof, _a), 0.6, 2, FeilianPalette.Snow);
  }

  protected override get windupDone(): boolean {
    return this.cue('hit', this.windupTime);
  }

  protected override onActiveBegin(): void {
    this.markRelease();
    this.setFacing(this.yaw);
    this.lord.beginDash();
    this.dashing = true;
    LordFx.snowCrown(this.ctx, _a.copy(this.lord.position).addScaledVector(dir(this.yaw, _b), -1.5), 0.8);
  }

  protected override onActive(dt: number): void {
    this.yaw += this.turnRate * dt;
    this.setFacing(this.yaw);
    const d = dir(this.yaw, _a);
    const p = _b.copy(this.lord.position);
    const step = FeilianChargePlan.Speed * dt;
    // 撞上冰脊 / 巨石：晕（Unity SphereCast 半径 1.1、胸口高 1.5 m：这里两道射线近似）
    for (const h of [1.0, 1.9]) {
      _c.copy(p).setY(p.y + h);
      const hit = this.ctx.world.raycast(_c, d, step + 1.6 + 1.1, _hit as never);
      if (hit && hit.normal.y < 0.6) {
        this.crash(hit.box.minY !== -Infinity);
        return;
      }
    }
    const next = _c.copy(p).addScaledVector(d, step);
    if (!this.lord.arenaContains(next, 1.5)) {
      this.endActive();
      return;
    }
    const gy = this.lord.groundAt(_d.copy(next).setY(p.y + 2));
    if (gy < p.y - 4) {
      // 不下冰崖
      this.endActive();
      return;
    }
    next.y = gy;
    this.lord.drive(next);
    this.travelled += step;
    if (!this.hit && this.lord.playerFeet(_d) && flat(_d, next) < FeilianChargePlan.HitRadius && _d.y < next.y + 3) {
      this.hit = true;
      if (this.hurtPlayer(this.dmg(FeilianChargePlan.WebDamage), 'none', next, _d.copy(d).multiplyScalar(16).setY(5)) > 0) {
        LordFx.impact(this.ctx, this.fei.bonePos('head', _d), FeilianPalette.Wind, false);
      }
    }
  }

  private crash(stun: boolean): void {
    this.crashed = stun;
    this.stopDash();
    LordFx.impact(this.ctx, this.fei.bonePos('head', _d), FeilianPalette.Snow, true);
    this.lord.shake(0.35, 0.35, 30);
    if (!stun) {
      this.endActive();
      return;
    }
    this.fei.crashes++;
    this.fei.tell('feilian_crash', '撞上冰脊，撞晕了——打风雷珠！', FeilianPalette.Wind, 6, 2);
    this.lord.stagger(FeilianChargePlan.CrashStun, 'down', 1);
  }

  private stopDash(): void {
    if (!this.dashing) return;
    this.dashing = false;
    this.lord.endDash();
  }

  protected override onRecoverBegin(): void {
    this.stopDash();
  }

  protected override onRecover(): void {
    this.lord.halt();
  }

  protected override onEnd(cancelled: boolean): void {
    this.stopDash();
    if (!cancelled && this.fei.variant && this.id === FeilianChargePlan.id) this.fei.queueMove(FeilianBladesPlan.id);
  }
}

/**
 * 回旋冲撞（wheel，二阶段起，0.8 / ≤ 2.2 / 1.2，冷却 6 s）：同冲撞，冲出去再绕回来一次（2.2 s 转 150°），整身往弧心倾。
 * 往哪边绕随机：往左绕播 wheel、往右绕播镜像片段 wheelR（网页没导出，退回 wheel）
 */
export class FeilianWheel extends FeilianCharge {
  right = false;

  protected override get clip(): string {
    return this.right ? 'wheelR' : 'wheel';
  }

  protected override get pawHoof(): string {
    return this.right ? 'fhoof_L' : 'fhoof_R';
  }

  /** 出手段每秒转多少度（网页 yaw；Unity 往右绕 = yaw 增大，网页镜像后减小） */
  private get rate(): number {
    return (this.right ? -1 : 1) * FeilianWheelPlan.Sweep / this.active / DEG;
  }

  protected override prepare(): void {
    super.prepare();
    this.right = this.chance(0.5);
  }

  protected override telegraph(): void {
    // 弧形冲撞线：按出手段第一秒的弧画三段
    const o = _a.copy(this.lord.position);
    let y = this.yaw;
    const rate = this.rate;
    for (let i = 0; i < 3; i++) {
      const a = _b.copy(o);
      y += rate / 3 * 0.5;
      const b = _c.copy(a).addScaledVector(dir(y, _d), FeilianChargePlan.Speed / 3);
      y += rate / 3 * 0.5;
      this.warnLine(a, b, FeilianChargePlan.Width, this.windupTime);
      o.copy(b);
    }
  }

  protected override onActiveBegin(): void {
    super.onActiveBegin();
    this.turnRate = this.rate;
  }
}

/**
 * 风刃（blades，0.6 / 0.1 / 0.6，冷却 2.5 s）：尾羽甩到右边 = 出手（片段 release）：扇形三道月牙风刃（±15°，20 m/s，各 10）。不画地面预警（弹体自己是读点）
 */
export class FeilianBlades extends FeilianMove {
  fired = 0;
  bladeHits = 0;

  override weightNow(): number {
    return FeilianBladesPlan.weight(this.lord.distToPlayer());
  }

  protected override prepare(): void {
    this.lord.halt();
  }

  protected override onWindup(dt: number): void {
    this.lord.halt();
    this.turnToward(this.yawToPlayer, 143, dt);
    if (this.ctx.rng.next() < dt * 20) LordFx.gather(this.ctx, this.fei.bonePos('tail_6', _a), FeilianPalette.Wind, 2, 0.5);
  }

  protected override get windupDone(): boolean {
    return this.cue('release', this.windupTime);
  }

  protected override onActiveBegin(): void {
    this.markRelease();
    const from = this.fei.bonePos('chest', new THREE.Vector3());
    const target = _a.copy(this.ctx.player.eye);
    target.y -= 0.5;
    const d0 = _b.subVectors(target, from);
    const y = Math.atan2(d0.x, d0.z) / DEG;
    const pitch = Math.atan2(d0.y, Math.hypot(d0.x, d0.z));
    const life = FeilianBladesPlan.Range / FeilianBladesPlan.Speed;
    const damage = this.dmg(FeilianBladesPlan.WebDamage) * this.lord.damageMult;
    for (const off of [-FeilianBladesPlan.Spread, 0, FeilianBladesPlan.Spread]) {
      const d = dir(y + off, new THREE.Vector3());
      const v = d.clone().multiplyScalar(Math.cos(pitch)).add(new THREE.Vector3(0, Math.sin(pitch), 0)).normalize().multiplyScalar(FeilianBladesPlan.Speed);
      const push = d.clone().multiplyScalar(6);
      this.ctx.projectiles.spawn({
        owner: 'enemy', position: from.clone().addScaledVector(d, 1.2), velocity: v, radius: 0.9, lifetime: life,
        enemyDamage: damage, element: 'none', color: FeilianPalette.Wind, visual: 'orb', scale: 1.6, sourceEnemy: this.lord,
        onImpact: (p, enemy) => {
          if (enemy) return;
          const pl = this.ctx.player;
          if (pl.alive && Math.hypot(p.x - pl.position.x, p.z - pl.position.z) < 1.6 && p.y > pl.position.y - 0.5 && p.y < pl.position.y + pl.height + 0.5) {
            this.bladeHits++;
            this.hits++;
            this.lord.pushPlayer(push);
          }
        },
      });
      this.fired++;
    }
    LordFx.gather(this.ctx, this.fei.bonePos('tail_6', _a), FeilianPalette.Wind, 1.5, 1);
  }
}

/** 侧跃（sidestep，0.1 / 0.6 / 0.2，冷却 4 s）：2 s 内挨打太多就往侧面跳 10 m（那一边出擂台就跳另一边） */
export class FeilianSidestep extends FeilianMove {
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private dashing = false;
  left = false;

  override weightNow(): number {
    return this.fei.recentDamage > this.fdef.sidestepDamage * this.fei.webScale ? this.weight : 0;
  }

  protected override get clip(): string {
    return this.left ? 'sidestepL' : 'sidestep';
  }

  protected override prepare(): void {
    this.lord.halt();
    this.from.copy(this.lord.position);
    this.left = this.chance(0.5);
    // Unity transform.right（解剖学右侧）= 网页模型局部 −X：(−cos f, 0, sin f)
    const f = this.lord.facing;
    const side = _a.set(-Math.cos(f), 0, Math.sin(f)).multiplyScalar(this.left ? -1 : 1);
    this.to.copy(this.from).addScaledVector(side, FeilianSidestepPlan.Distance);
    if (!this.lord.arenaContains(this.to, 2)) {
      this.left = !this.left;
      this.to.copy(this.from).addScaledVector(side, -FeilianSidestepPlan.Distance);
    }
    this.lord.clampToArena(this.to, this.lord.arenaMargin);
    this.to.y = this.from.y + 2;
    this.onGround(this.to);
  }

  protected override onActiveBegin(): void {
    this.markRelease();
    this.lord.beginDash();
    this.dashing = true;
    LordFx.dust(this.ctx, this.from, 0.8, 3, FeilianPalette.Snow);
  }

  protected override onActive(): void {
    const k = Math.min(1, Math.max(0, this.stageT / this.active));
    const p = _a.lerpVectors(this.from, this.to, k);
    p.y += 1.2 * 4 * k * (1 - k);
    this.lord.drive(p);
  }

  protected override onRecoverBegin(): void {
    this.lord.drive(this.to);
    LordFx.snowCrown(this.ctx, this.to, 0.7);
    this.stopDash();
  }

  private stopDash(): void {
    if (!this.dashing) return;
    this.dashing = false;
    this.lord.endDash();
  }

  protected override onEnd(): void {
    this.stopDash();
    this.fei.gustLeft = 0;
  }
}

/**
 * 龙卷风柱（tornado，二阶段起，1.0 / 0.2 / 0.6，冷却 9 s）：人立仰头长嘶；前蹄踏下 = 出手（片段 release）：两根（三阶段三根）龙卷落在玩家两侧 12 m。场上已有两根时不出
 */
export class FeilianTornadoMove extends FeilianMove {
  private readonly spots: THREE.Vector3[] = [];
  spawned = 0;

  override weightNow(): number {
    return this.fei.tornadoes.length < 2 ? this.weight : 0;
  }

  protected override prepare(): void {
    this.lord.halt();
    this.spots.length = 0;
    const p = this.ctx.player.position;
    const y = this.yawToPlayer;
    const offs = this.fei.phase >= 2 ? [0, 120, -120] : [70, -70];
    for (const a of offs) {
      const s = p.clone().addScaledVector(dir(y + 180 + a, _a), FeilianTornadoPlan.Offset);
      this.lord.clampToArena(s, 2);
      s.y = p.y + 2;
      this.spots.push(this.onGround(s));
    }
  }

  protected override telegraph(): void {
    for (const s of this.spots) this.warnCircle(s, FeilianTornadoBody.Radius, this.windupTime);
  }

  protected override onWindup(dt: number): void {
    this.lord.halt();
    this.turnToward(this.yawToPlayer, 143, dt);
    if (this.ctx.rng.next() < dt * 10) {
      for (const s of this.spots) LordFx.gather(this.ctx, _a.copy(s).setY(s.y + 2), FeilianPalette.Wind, 4, this.stageT / this.windupTime);
    }
  }

  protected override get windupDone(): boolean {
    return this.cue('release', this.windupTime);
  }

  protected override onActiveBegin(): void {
    this.markRelease();
    for (const s of this.spots) {
      if (this.fei.spawnTornado(s)) this.spawned++;
    }
    this.lord.shake(0.2, 0.3, 40);
  }
}

/**
 * 风雷爆（stormburst，三阶段，4.0 / 0.3 / 1.5，冷却 14 s，霸体）：人立、珠子胀大尖啸、风往里猛吸；危险圈 12 m；前蹄砸下 = 出手（片段 hit）：
 * 风雷冲击环，12 m 内 35 + 雷殛 + 击退。解法：前摇里打满破防条（珠碎打断），或顶着吸力冲出圈
 */
export class FeilianStormBurst extends FeilianMove {
  override weightNow(): number {
    return this.fei.orbIntact ? this.weight : 0;
  }

  protected override prepare(): void {
    this.lord.halt();
  }

  protected override telegraph(): void {
    this.warnCircle(this.lord.position, FeilianStormBurstPlan.Radius, this.windupTime);
    this.fei.tell('feilian_storm', '飞廉在蓄风雷爆——打碎风雷珠打断它，或者顶风冲出圈！', FeilianPalette.Orb, 14, 3);
  }

  protected override onWindup(dt: number): void {
    this.lord.halt();
    const k = this.stageT / Math.max(0.05, this.windupTime);
    this.fei.storm = k;
    if (this.ctx.rng.next() < dt * 14) LordFx.gather(this.ctx, this.orbPos(), FeilianPalette.Orb, FeilianStormBurstPlan.Radius * 0.5, k);
    this.glint(this.windupTime - 0.25);
  }

  protected override get windupDone(): boolean {
    return this.cue('hit', this.windupTime);
  }

  protected override onActiveBegin(): void {
    this.markRelease();
    this.fei.storm = 0;
    const o = this.lord.position;
    LordFx.blast(this.ctx, o, FeilianStormBurstPlan.Radius, FeilianPalette.Orb, FeilianPalette.OrbCore);
    this.ctx.fx.lightning(this.orbPos(), _a.copy(o).setY(o.y + 0.2), FeilianPalette.Orb);
    this.lord.shake(0.6, 0.45, 40);
    this.lord.impactHold(0.08);
    if (!this.lord.playerFeet(_b) || flat(_b, o) > FeilianStormBurstPlan.Radius) return;
    const d = _c.set(_b.x - o.x, 0, _b.z - o.z);
    if (d.lengthSq() > 1e-4) d.normalize();
    else dir(this.facing, d);
    this.hurtPlayer(this.dmg(FeilianStormBurstPlan.WebDamage), 'shock', o, d.multiplyScalar(14).setY(6));
  }

  protected override onEnd(): void {
    this.fei.storm = 0;
  }
}

/** 按定义里的招式 id 造运行时招式 */
export function createFeilianMove(fei: Feilian, spec: BossMoveSpec): LordMove | null {
  switch (spec.id) {
    case FeilianGustPlan.id: return new FeilianGust(spec, fei);
    case FeilianChargePlan.id: return new FeilianCharge(spec, fei);
    case FeilianWheelPlan.id: return new FeilianWheel(spec, fei);
    case FeilianBladesPlan.id: return new FeilianBlades(spec, fei);
    case FeilianSidestepPlan.id: return new FeilianSidestep(spec, fei);
    case FeilianTornadoPlan.id: return new FeilianTornadoMove(spec, fei);
    case FeilianStormBurstPlan.id: return new FeilianStormBurst(spec, fei);
    default: return null;
  }
}
