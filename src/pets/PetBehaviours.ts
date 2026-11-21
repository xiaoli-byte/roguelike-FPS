import * as THREE from 'three';
import type { Element, GameContext, IEnemy, StatusId } from '../core/types';
import { addForceWeakpoint } from '../combat/PetContract';
import { type Pet, flat, groundY } from './Pet';
import { type RGB, PET_GOLD, lerpRgb, rgbHex } from './PetDefs';
import { marker } from './PetFx';
import type { RoutineGen } from './Routine';

/**
 * 一只灵宠的能力（照译 Unity G/Pets/PetBehaviours.cs；docs/pet-system.md 第 4 节）：普攻（attack，按 attackInterval 由 Pet 调度）、
 * 被动（onBind 登记、tick 每帧）、灵技 G（skill，冷却由 Pet 管）、3 级觉醒（onAwaken）。
 * 玩家身上的加成一律登记在来源「pet:<id>」下；事件监听、Combat 的输出修饰器 / 改判弱点在 unbind 里撤掉（漏撤会一直生效）。
 * 数值为灵契 1 级，伤害再乘 Pet.damageMult。常量对象的键名与 C# 常量同名（tests/unity-pets.test.mjs 逐个读 C# 比）。
 * 动作：出手时 playAct（状态名见 docs/pet-system.md 7.3），玩法时机仍由这里的代码决定；程序前冲 / 甩尾照常叠上。
 * 特效：Unity ShotFx / Telegraph / Lightning → ctx.fx 的 impact / ring / groundWarning / beam / lightning；光晕、光柱、标记走 PetFx。
 */

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const WHITE: RGB = [1, 1, 1];
/** Unity DamageTable.ElementColor */
export const ELEMENT_RGB: Record<Element, RGB> = { none: [1, 1, 1], fire: [1, 0.55, 0.2], shock: [0.55, 0.75, 1], corrode: [0.6, 0.9, 0.3] };
const STATUS_OF: Record<Exclude<Element, 'none'>, StatusId> = { fire: 'burn', shock: 'shock', corrode: 'corrode' };

const v = () => new THREE.Vector3();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = (a: number, bExclusive: number) => a + Math.floor(Math.random() * (bExclusive - a));
/** 水平方向（单位向量；长度为 0 时 +Z） */
function flatten(d: THREE.Vector3): THREE.Vector3 {
  d.y = 0;
  return d.lengthSq() > 1e-12 ? d.normalize() : d.set(0, 0, 1);
}

export abstract class PetBehaviour {
  protected pet!: Pet;

  get attackInterval(): number { return 1; }
  get attackRange(): number { return 2; }

  protected get ctx(): GameContext { return this.pet.ctx; }
  protected get source(): string { return 'pet:' + this.pet.def.id; }
  protected get fxColor(): RGB { return this.pet.def.fx; }
  protected get now(): number { return this.pet.ctx.time.now; }
  protected get playerPos(): THREE.Vector3 { return this.pet.ctx.player.position; }

  bind(p: Pet): void {
    this.pet = p;
    this.onBind();
  }

  protected onBind(): void {}

  /** 撤销被动（可重复调用） */
  unbind(): void {
    this.ctx.player.stats.removeSource(this.source);
  }

  tick(_dt: number): void {}
  /** 交战时站哪儿；null = 留在跟随位 */
  engagePoint(_t: IEnemy): THREE.Vector3 | null { return null; }
  canAttack(t: IEnemy): boolean { return this.pet.distTo(t) <= this.attackRange && this.pet.sees(t); }
  abstract attack(target: IEnemy): void;
  /** 灵技：返回 false 表示没放出去（不进冷却） */
  abstract skill(): boolean;
  onAwaken(): void {}
  /** 一处据点肃清了（Unity EncounterSite.AnySiteCleared；PetSystem 看遭遇状态从开打变成肃清时调） */
  onSiteCleared(): void {}

  // ── 工具 ──
  /** 站在目标朝灵宠这一侧、离它身体表面 dist 米处 */
  protected approach(t: IEnemy, dist: number): THREE.Vector3 {
    dist += t.radius;
    const c = t.position;
    const from = v().subVectors(this.pet.position, c);
    from.y = 0;
    if (from.lengthSq() < 0.01) from.subVectors(this.playerPos, c).setY(0);
    return v().copy(c).addScaledVector(from.lengthSq() > 0.01 ? from.normalize() : from.set(0, 0, 1), dist);
  }

  /** 离玩家 playerRange 内、离 near 最近的若干个敌人 */
  protected enemiesAround(near: THREE.Vector3, range: number, playerRange: number): IEnemy[] {
    const p = this.playerPos;
    return this.pet.enemiesNear(near, range).filter((d) => flat(d.position, p) <= playerRange);
  }

  protected noTarget(): void {
    this.pet.say('没有目标', [0.8, 0.8, 0.8], 0.9);
  }

  protected centerOf(e: IEnemy): THREE.Vector3 {
    return e.getBodyCenter(v());
  }

  /** 敌人头顶（Unity PetFx.TopOf：碰撞体包围盒顶） */
  protected topOf(e: IEnemy): number {
    return e.position.y + e.height;
  }

  protected stun(e: IEnemy, seconds: number): void {
    if (seconds > 0 && e.alive) this.ctx.combat.applyStatus(e, 'stun', 0, seconds);
  }

  protected slow(e: IEnemy, strength: number, seconds: number): void {
    if (e.alive) this.ctx.combat.applyStatus(e, 'slow', strength, seconds);
  }

  // ── 特效（Unity ShotFx / Telegraph / Lightning 的对应） ──
  protected impact(p: THREE.Vector3, normal: THREE.Vector3, size: number): void {
    this.ctx.fx.impact(p, normal, undefined, size);
  }

  /** 枪口闪光（Unity ShotFx.MuzzleFlash）：一团短促的光晕 */
  protected muzzle(p: THREE.Vector3, scale: number, c: RGB = [1, 0.9, 0.7]): void {
    this.pet.host.fx.burst(p, c, 0.7 * scale, 0.12);
  }

  /** 地面扩散环（Telegraph.Wave：半径 radius、速度 speed m/s） */
  protected wave(center: THREE.Vector3, radius: number, speed: number, c: RGB): void {
    this.ctx.fx.ring(center, radius, rgbHex(c), radius / Math.max(0.1, speed));
  }

  /** 地面预警圈（Telegraph.Circle，自己的颜色） */
  protected circle(center: THREE.Vector3, radius: number, seconds: number, c: RGB): void {
    this.ctx.fx.groundWarning(center, radius, seconds, rgbHex(c));
  }

  /** 地面预警线（Telegraph.Line）：网页没有线形预警，贴地画一道光束 */
  protected line(a: THREE.Vector3, b: THREE.Vector3, width: number, seconds: number, c: RGB): void {
    const ga = v().copy(a), gb = v().copy(b);
    ga.y = groundY(this.ctx, a) + 0.08;
    gb.y = groundY(this.ctx, b) + 0.08;
    this.ctx.fx.beam(ga, gb, rgbHex(c), Math.min(2, width * 0.25), seconds);
  }

  protected lightning(a: THREE.Vector3, b: THREE.Vector3, c: RGB): void {
    this.ctx.fx.lightning(a, b, rgbHex(c));
  }

  protected beam(a: THREE.Vector3, b: THREE.Vector3, c: RGB, width: number, life = 0.16): void {
    this.pet.host.fx.beam(a, b, c, width, life);
  }

  /** 头顶浮字 / 灵火一闪 */
  protected burst(p: THREE.Vector3, c: RGB, size: number, life = 0.45): void {
    this.pet.host.fx.burst(p, c, size, life);
  }
}

// ═════════════ 凡灵 ═════════════

export const DANGKANG = {
  ChargeRange: 12, ChargeDamage: 22, ChargeStun: 0.5, AwakenStun: 0.3, ChargeSpeed: 16,
  RushLength: 18, RushDamage: 90, RushStun: 1.2, RushSpeed: 26, RushWidth: 1.6,
  AttackInterval: 2.4,
} as const;

/** 当康：冲撞眩晕；清场后拱出一袋灵石；灵技「丰年冲」沿准星冲 18 米 */
export class DangkangBehaviour extends PetBehaviour {
  override get attackInterval(): number { return DANGKANG.AttackInterval; }
  override get attackRange(): number { return DANGKANG.ChargeRange; }
  private stunFor(s: number): number { return s + (this.pet.awakened ? DANGKANG.AwakenStun : 0); }

  override engagePoint(t: IEnemy): THREE.Vector3 | null {
    return flat(t.position, this.pet.position) > 9 ? this.approach(t, 6) : v().copy(this.pet.position);
  }

  attack(t: IEnemy): void {
    this.pet.act(this.charge(t));
  }

  private *charge(t: IEnemy): RoutineGen {
    const pet = this.pet, C = DANGKANG;
    let dir = flatten(v().subVectors(t.position, pet.position));
    pet.playAct('chargeWindup', 0.18);
    pet.lunge(v().copy(dir).negate(), 0.25, 0.25); // 蓄力后坐
    this.impact(pet.position, UP, 0.8);
    yield 0.18;
    if (!t.alive) return;
    const c = t.position.clone();
    dir = flatten(v().subVectors(c, pet.position));
    const reach = flat(c, pet.position);
    const run = Math.max(0, reach - 0.6 - t.radius);
    let dust = 0;
    const dashFrom = pet.position.clone();
    // 冲撞片段（蓄力之后接着播）对到冲刺 + 撞上的时长
    pet.playAct('ram', run / C.ChargeSpeed + 0.2);
    yield pet.dashTo(v().copy(pet.position).addScaledVector(dir, run), C.ChargeSpeed, (a, b) => {
      dust += a.distanceTo(b);
      if (dust < 0.8) return;
      dust = 0;
      this.impact(b, UP, 0.5);
    }, 1.2);
    if (!t.alive || pet.distTo(t) > 1.8) return;
    pet.playAct('ram'); // 撞上：冲撞片段还在播就不重来
    pet.lunge(dir, 0.45, 0.2);
    pet.hit(t, C.ChargeDamage, { knockback: 4 });
    this.stun(t, this.stunFor(C.ChargeStun));
    const tc = this.centerOf(t);
    this.impact(tc, v().copy(dir).negate(), 2);
    this.burst(tc, this.fxColor, 1.4, 0.3);
    this.beam(v().copy(dashFrom).addScaledVector(UP, 0.4), v().copy(pet.position).addScaledVector(UP, 0.4), this.fxColor, 0.12, 0.25);
    yield 0.15;
  }

  override onSiteCleared(): void {
    this.pet.run(this.harvest());
  }

  /** 丰穰：拱一拱地，拱出一袋灵石（觉醒附带回血球），稍后吸向玩家 */
  private *harvest(): RoutineGen {
    yield 0.6;
    const pet = this.pet;
    if (pet.released) return;
    pet.playAct('dig', 0.6, true);
    const fwd = pet.forward(v());
    for (let i = 0; i < 3; i++) {
      pet.lunge(v().copy(fwd).addScaledVector(DOWN, 0.6), 0.25, 0.18);
      this.impact(v().copy(pet.position).addScaledVector(fwd, 0.4), UP, 1.2);
      yield 0.2;
    }
    const at = v().copy(pet.position).addScaledVector(pet.forward(v()), 0.5).addScaledVector(UP, 0.3);
    const amount = randInt(20, 36);
    this.ctx.loot.dropCoins(at, amount);
    if (pet.awakened) this.ctx.loot.dropHealth(at);
    const gold: RGB = [1, 0.85, 0.4];
    this.burst(pet.socketPos('coin', pet.center()), gold, 1.2, 0.35); // 铜钱坠一闪
    pet.say(`丰穰 +${amount}`, gold, 1.2);
    this.wave(at, 2.5, 8, gold);
    yield 1.1;
    (this.ctx.loot as unknown as { vacuum?(delay: number): void }).vacuum?.(0);
  }

  skill(): boolean {
    const C = DANGKANG;
    const dir = this.pet.ownerForward(v());
    const right = v().set(-dir.z, 0, dir.x);
    const start = v().copy(this.playerPos).addScaledVector(right, 0.9).addScaledVector(dir, 0.5);
    this.line(start, v().copy(start).addScaledVector(dir, C.RushLength), C.RushWidth * 2, 0.35, this.fxColor);
    this.pet.act(this.rush(start, dir));
    return true;
  }

  private *rush(start: THREE.Vector3, dir: THREE.Vector3): RoutineGen {
    const pet = this.pet, C = DANGKANG;
    if (flat(pet.position, start) > 1.5) pet.teleport(start);
    pet.say('丰年冲！', this.fxColor, 1.2);
    pet.playAct('chargeWindup', 0.2, true);
    pet.lunge(v().copy(dir).negate(), 0.3, 0.2);
    yield 0.2;
    pet.playAct('ram', C.RushLength / C.RushSpeed, true);
    const hit = new Set<IEnemy>();
    let dust = 0;
    yield pet.dashTo(v().copy(pet.position).addScaledVector(dir, C.RushLength), C.RushSpeed, (a, b) => {
      dust += a.distanceTo(b);
      if (dust > 0.7) {
        dust = 0;
        this.impact(b, UP, 0.8);
      }
      for (const d of pet.enemiesNear(b, C.RushWidth + 1.5)) {
        if (hit.has(d) || segmentDistance(d.position, a, b) > C.RushWidth) continue;
        hit.add(d);
        pet.hit(d, C.RushDamage, { knockback: 8, from: a });
        this.stun(d, this.stunFor(C.RushStun));
        const dc = this.centerOf(d);
        this.impact(dc, dir, 3);
        this.muzzle(dc, 1.5);
        this.burst(dc, this.fxColor, 1.8, 0.35);
      }
    }, 1.4);
  }
}

/** 点到线段的水平距离（Unity DangkangBehaviour.SegmentDistance） */
export function segmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x, abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  const t = l2 > 1e-6 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2)) : 0;
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

export const HUAN = {
  ClawDamage: 4, MimicEvery: 10, MimicRadius: 10, MimicTime: 3, SkillRadius: 16, SkillTime: 5, SkillTaken: 1.25, AwakenSlow: 0.3,
  Claws: 3, AttackInterval: 1, AttackRange: 1.9,
} as const;
export const HUAN_PHRASES = ['这边！', '来打我呀～', '喵！', '看这儿看这儿！', '（学你说话）', '嘿，打不着！'] as const;

/** 能被嘲讽的敌人（EnemyBase.taunt） */
interface Tauntable {
  taunt?(decoy: { readonly position: THREE.Vector3; readonly alive: boolean }, seconds: number, eyeHeight?: number): void;
}

/** 讙：三连爪击；每 10 秒学舌嘲讽 10 米内敌人 3 秒；灵技「百声惑」嘲讽 16 米 5 秒且受伤 +25%；觉醒被嘲讽者减速 30% */
export class HuanBehaviour extends PetBehaviour {
  override get attackInterval(): number { return HUAN.AttackInterval; }
  override get attackRange(): number { return HUAN.AttackRange; }
  private mimicTimer = 4;
  private cleanTimer = 0;
  private readonly amplified = new Map<IEnemy, number>();
  private removeModifier: (() => void) | null = null;
  /** 最近一次学舌嘲讽到几只（测试 / 调试） */
  lastMimic = 0;

  protected override onBind(): void {
    this.removeModifier = this.ctx.combat.addOutgoingModifier((e) => {
      const until = this.amplified.get(e);
      return until !== undefined && this.now < until ? HUAN.SkillTaken : 1;
    });
  }

  override unbind(): void {
    this.removeModifier?.();
    this.removeModifier = null;
    super.unbind();
  }

  override engagePoint(t: IEnemy): THREE.Vector3 | null {
    return this.approach(t, 1.2);
  }

  attack(t: IEnemy): void {
    this.pet.act(this.clawRound(t));
  }

  private *clawRound(t: IEnemy): RoutineGen {
    const pet = this.pet;
    for (let i = 0; i < HUAN.Claws; i++) {
      if (!t.alive) return;
      const tc = this.centerOf(t);
      const dir = v().subVectors(tc, pet.center());
      pet.playAct('claw', 0.12, false, true, 0.04); // 每一爪从头播
      pet.lunge(dir, 0.28, 0.13);
      pet.hit(t, HUAN.ClawDamage);
      this.impact(tc, v().copy(dir).normalize().negate(), 0.5);
      const side = pet.right(v()).multiplyScalar((i - 1) * 0.15);
      this.beam(v().copy(tc).addScaledVector(UP, 0.3).add(side), v().copy(tc).addScaledVector(UP, -0.3), this.fxColor, 0.03, 0.1);
      yield 0.12;
    }
  }

  override tick(dt: number): void {
    this.mimicTimer -= dt;
    // 附近没有敌人就过 1 秒再看，学到了才进 10 秒间隔
    if (this.mimicTimer <= 0) this.mimicTimer = this.mimic(HUAN.MimicRadius, HUAN.MimicTime, false) > 0 ? HUAN.MimicEvery : 1;
    this.cleanTimer -= dt;
    if (this.cleanTimer <= 0 && this.amplified.size > 0) {
      this.cleanTimer = 2;
      for (const [d, until] of [...this.amplified]) if (!d.alive || this.now >= until) this.amplified.delete(d);
    }
  }

  /** 夺百声：学玩家说话，radius 内敌人改打讙 seconds 秒（灵体：打它无效） */
  mimic(radius: number, seconds: number, skill: boolean): number {
    const pet = this.pet;
    let n = 0;
    const eye = Math.max(0.4, pet.height * 0.6);
    for (const e of [...this.ctx.enemies.list]) {
      if (!e.alive || e.untargetable) continue;
      if (flat(e.position, pet.position) > radius) continue;
      (e as unknown as Tauntable).taunt?.(pet, seconds, eye);
      if (pet.awakened) this.slow(e, HUAN.AwakenSlow, seconds);
      if (skill) this.amplified.set(e, this.now + seconds);
      n++;
    }
    this.lastMimic = n;
    if (n === 0 && !skill) return 0;
    this.wave(pet.position, radius, radius * 2.4, this.fxColor);
    pet.playAct('taunt', 0, skill);
    pet.lunge(UP, 0.3, 0.3);
    pet.whipTails();
    pet.say(HUAN_PHRASES[randInt(0, HUAN_PHRASES.length)], this.fxColor, 1.1);
    return n;
  }

  skill(): boolean {
    if (this.pet.enemiesNear(this.pet.position, HUAN.SkillRadius).length === 0) {
      this.noTarget();
      return false;
    }
    this.mimic(HUAN.SkillRadius, HUAN.SkillTime, true);
    this.pet.say('百声惑！', [1, 0.85, 0.5], 1.4);
    this.muzzle(this.pet.center(), 2);
    return true;
  }
}

export const JINGWEI = {
  StoneDamage: 16, StoneBurn: 0.5, RainDamage: 24, RainRadius: 5, Gravity: 22, PebbleRegrow: 0.6, PebbleSize: 0.16, RainCount: 10,
  AttackInterval: 1.3,
} as const;
const JINGWEI_FIRE: RGB = [1, 0.45, 0.12];

/** 精卫：飞到目标上空投火石；灵技「衔石填海」准星处 2 秒落 10 颗；觉醒火石范围 2.8 米 */
export class JingweiBehaviour extends PetBehaviour {
  override get attackInterval(): number { return JINGWEI.AttackInterval; }
  private get radius(): number { return this.pet.awakened ? 2.8 : 2; }

  override engagePoint(t: IEnemy): THREE.Vector3 | null {
    const c = t.position;
    const toPlayer = flatten(v().subVectors(this.playerPos, c));
    return v().set(c.x, this.topOf(t) + 2.6, c.z).addScaledVector(toPlayer, 0.8);
  }

  override canAttack(t: IEnemy): boolean {
    const pet = this.pet;
    return flat(t.position, pet.position) < 2.6 && pet.position.y > this.centerOf(t).y + 0.8 && pet.sees(t);
  }

  attack(t: IEnemy): void {
    const pet = this.pet;
    const from = pet.partPos(pet.socketPos('pebble', pet.mouth())); // 口中衔的火石
    const to = this.centerOf(t);
    pet.playAct('drop');
    pet.lunge(DOWN, 0.3, 0.2);
    pet.hidePart(JINGWEI.PebbleRegrow); // 松口：嘴里的火石扔出去了，过一会儿再衔一颗
    this.dropStone(from, to, JINGWEI.StoneDamage, JINGWEI.StoneBurn, 0.35);
  }

  private dropStone(from: THREE.Vector3, to: THREE.Vector3, dmg: number, burn: number, flight: number): void {
    const g = JINGWEI.Gravity;
    // EnemyProjectile.Ballistic：flight 秒后正好落在 to
    const vel = v().subVectors(to, from).divideScalar(flight);
    vel.y += 0.5 * g * flight;
    const r = this.radius;
    const pet = this.pet;
    const req = pet.info(dmg, 'fire', burn);
    pet.host.throwStone({
      from, velocity: vel, gravity: g, radius: 0.15, life: flight + 1.5, explodeRadius: r, request: req,
      partId: pet.def.partId, size: JINGWEI.PebbleSize, glow: JINGWEI_FIRE,
      onImpact: (at) => {
        this.impact(at, UP, 1.8);
        this.muzzle(v().copy(at).addScaledVector(UP, 0.3), 0.8, JINGWEI_FIRE);
        this.wave(at, r, r * 7, JINGWEI_FIRE);
      },
    });
  }

  skill(): boolean {
    // 落点：准星落点往下找地面；朝天瞄（准星没打到东西、下方也没地面）就落在玩家前方 20 米
    const pet = this.pet;
    let point = pet.aimPoint(60);
    const g = this.ctx.world.groundHeight(point.x, point.z, point.y + 2);
    if (g > -Infinity) point.y = g;
    else {
      point = v().copy(this.playerPos).addScaledVector(pet.ownerForward(v()), 20);
      point.y = groundY(this.ctx, v().copy(point).addScaledVector(UP, 30));
    }
    this.circle(point, JINGWEI.RainRadius, 2.4, JINGWEI_FIRE);
    pet.act(this.rain(point));
    return true;
  }

  private *rain(point: THREE.Vector3): RoutineGen {
    const pet = this.pet, C = JINGWEI;
    pet.say('衔石填海！', JINGWEI_FIRE, 1.3);
    yield pet.dashTo(v().copy(point).addScaledVector(UP, 6), 24, null, 0.8);
    for (let i = 0; i < C.RainCount; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * C.RainRadius;
      const g = v().set(point.x + Math.cos(a) * rr, point.y, point.z + Math.sin(a) * rr);
      g.y = groundY(this.ctx, v().copy(g).addScaledVector(UP, 2));
      const from = v().copy(g).add(v().set(rand(-1, 1), 9, rand(-1, 1)));
      this.dropStone(from, g, C.RainDamage, 1, 0.4);
      pet.playAct('drop'); // 0.2 秒一颗：片段没播到 90% 就不重来
      pet.hidePart(C.PebbleRegrow); // 落完最后一颗 0.6 秒后嘴里才再有
      pet.lunge(DOWN, 0.2, 0.15);
      yield 0.2;
    }
  }
}

// ═════════════ 灵兽 ═════════════

export const CHONGMING = {
  BoltDamage: 9, BoltShock: 0.4, Range: 20, Bounce: 8, ChainDamage: 60, ChainRange: 12, Bolts: 2, ChainHops: 8,
  AttackInterval: 0.7,
} as const;
const SHOCK = ELEMENT_RGB.shock;

/** 重明鸟：双瞳雷光；重瞳标记准星下的敌人（受伤 +15% / 觉醒 +25%）；灵技「辟邪」连锁闪电 8 跳 */
export class ChongmingBehaviour extends PetBehaviour {
  override get attackInterval(): number { return CHONGMING.AttackInterval; }
  override get attackRange(): number { return CHONGMING.Range; }
  mark: IEnemy | null = null;
  private markHold = 0;
  private markerObj: THREE.Group | null = null;
  private removeModifier: (() => void) | null = null;
  get markBonus(): number { return this.pet.awakened ? 1.25 : 1.15; }

  protected override onBind(): void {
    this.markerObj = marker(SHOCK, true);
    this.markerObj.visible = false;
    this.pet.host.fx.group.add(this.markerObj);
    this.removeModifier = this.ctx.combat.addOutgoingModifier((e) => (e === this.mark && e.alive ? this.markBonus : 1));
  }

  override unbind(): void {
    this.removeModifier?.();
    this.removeModifier = null;
    if (this.markerObj) {
      this.markerObj.removeFromParent();
      this.markerObj.traverse((o) => ((o as THREE.Sprite).material as THREE.Material | undefined)?.dispose());
      this.markerObj = null;
    }
    this.mark = null;
    super.unbind();
  }

  override tick(): void {
    // 重瞳：准星指着的敌人；移开后保留 0.3 s，免得标记闪烁
    const aimed = this.pet.aimedEnemy(80);
    if (aimed) {
      this.mark = aimed;
      this.markHold = this.now + 0.3;
    } else if (this.now > this.markHold) this.mark = null;
    if (this.mark && !this.mark.alive) this.mark = null;
    const m = this.markerObj;
    if (!m) return;
    m.visible = !!this.mark;
    if (this.mark) {
      const p = this.mark.position;
      m.position.set(p.x, this.topOf(this.mark) + 0.5, p.z);
      m.scale.setScalar((this.pet.awakened ? 1.15 : 1) + Math.sin(this.now * 7) * 0.08);
      // 两颗瞳仁沿屏幕左右排开（精灵本身朝相机，位置按相机的右方向摆）
      const right = v().setFromMatrixColumn(this.ctx.camera.matrixWorld, 0).normalize().multiplyScalar(0.11);
      m.getObjectByName('pupilL')?.position.copy(right).negate();
      m.getObjectByName('pupilR')?.position.copy(right);
    }
  }

  attack(t: IEnemy): void {
    const pet = this.pet, C = CHONGMING;
    const c = this.centerOf(t);
    pet.playAct('gaze');
    const eye = pet.socketPos('eyefx', pet.mouth()); // 双瞳
    const right = pet.right(v());
    this.lightning(v().copy(eye).addScaledVector(right, -0.07), c, SHOCK);
    this.lightning(v().copy(eye).addScaledVector(right, 0.07), c, SHOCK);
    for (let i = 0; i < C.Bolts; i++) pet.hit(t, C.BoltDamage, { element: 'shock', statusChance: C.BoltShock });
    pet.lunge(v().subVectors(c, pet.center()), 0.15, 0.15);
    if (!pet.awakened) return;
    // 觉醒：雷光再弹一个敌人
    let extra: IEnemy | null = null;
    for (const d of pet.enemiesNear(c, C.Bounce)) {
      if (d !== t && !this.ctx.world.segmentBlocked(c, this.centerOf(d))) {
        extra = d;
        break;
      }
    }
    if (!extra) return;
    this.lightning(c, this.centerOf(extra), SHOCK);
    for (let i = 0; i < C.Bolts; i++) pet.hit(extra, C.BoltDamage, { element: 'shock', statusChance: C.BoltShock, from: c, depth: 1 });
  }

  skill(): boolean {
    let first: IEnemy | null = this.mark && this.mark.alive ? this.mark : this.pet.target;
    if (!first) {
      const near = this.enemiesAround(this.playerPos, 25, 25);
      if (near.length > 0) first = near[0];
    }
    if (!first) {
      this.noTarget();
      return false;
    }
    this.pet.run(this.chain(first));
    return true;
  }

  /** 辟邪：从重明鸟出发连跳 8 次，每跳 60 + 必定雷殛；敌人不够时可以跳回打过的 */
  private *chain(first: IEnemy): RoutineGen {
    const pet = this.pet, C = CHONGMING;
    pet.say('辟邪！', SHOCK, 1.3);
    pet.playAct('cry', 0, true);
    const visited = new Set<IEnemy>();
    let from = pet.mouth();
    let cur: IEnemy | null = first;
    for (let hop = 0; hop < C.ChainHops && cur; hop++) {
      const c = this.centerOf(cur);
      this.lightning(from, c, SHOCK);
      pet.hit(cur, C.ChainDamage, { element: 'shock', statusChance: 1, from });
      this.impact(c, v().subVectors(from, c).normalize(), 1.5);
      visited.add(cur);
      from = c;
      let next: IEnemy | null = null, revisit: IEnemy | null = null;
      for (const d of pet.enemiesNear(c, C.ChainRange)) {
        if (d === cur || this.ctx.world.segmentBlocked(c, this.centerOf(d))) continue;
        if (!visited.has(d)) {
          next = d;
          break;
        }
        revisit ??= d;
      }
      cur = next ?? revisit;
      yield 0.09;
    }
  }
}

export const SUANNI = {
  ConeRange: 6, ConeHalfAngle: 32, TickDamage: 4, CorrodeChance: 0.25, ShieldBonus: 20,
  RoarShield: 30, RoarRadius: 5, RoarStun: 1, RoarCooldown: 15,
  SkillRadius: 10, SkillStun: 1.5, SkillReduction: 0.4, SkillBuff: 5,
  MistEvery: 1, MistRadius: 2.2, MistTime: 3,
  AttackInterval: 0.25,
} as const;
const CORRODE = ELEMENT_RGB.corrode;

/** 灵宠留在地上的持续伤害区（狻猊觉醒的蚀雾）：PetSystem 每帧结算 */
export interface PetZoneHandle {
  readonly center: THREE.Vector3;
  readonly alive: boolean;
  refresh(seconds: number): void;
}

/** 狻猊：吐蚀香锥形持续伤害；护主（护盾上限 +20、破盾怒吼）；灵技「镇宅狮吼」；觉醒蚀香留下蚀雾 */
export class SuanniBehaviour extends PetBehaviour {
  override get attackInterval(): number { return SUANNI.AttackInterval; }
  override get attackRange(): number { return SUANNI.ConeRange; }
  private roarReady = 0;
  private buffUntil = 0;
  private mistTimer = 0;
  private mist: PetZoneHandle | null = null;
  private offShield: (() => void) | null = null;
  private get buffSource(): string { return this.source + ':roar'; }

  protected override onBind(): void {
    // 只加上限、不顺带回盾（否则反复换宠就能白回 20 护盾）：玩家按上限涨了多少就补多少护盾，这里先结算再夹回原值
    const player = this.ctx.player;
    const before = player.shield;
    player.stats.add('maxShield', SUANNI.ShieldBonus, this.source);
    (player as unknown as { syncStatCaps?(): void }).syncStatCaps?.();
    player.shield = Math.min(before, player.maxShield());
    this.offShield = this.ctx.events.on('player:shieldBroken', () => this.onShieldBroken());
  }

  override unbind(): void {
    this.offShield?.();
    this.offShield = null;
    this.ctx.player.stats.removeSource(this.buffSource);
    super.unbind();
  }

  override engagePoint(t: IEnemy): THREE.Vector3 | null {
    return flat(t.position, this.pet.position) > SUANNI.ConeRange - 1.5 ? this.approach(t, 3.5) : v().copy(this.pet.position);
  }

  attack(t: IEnemy): void {
    const pet = this.pet, C = SUANNI;
    const mouth = pet.mouth();
    const dir = v().subVectors(this.centerOf(t), mouth).normalize();
    pet.playAct('breathe'); // 0.25 秒一跳：片段没播到 90% 就不重来，连着吐就是一口长气
    this.smoke(mouth, dir, 5);
    const cosHalf = Math.cos(C.ConeHalfAngle * Math.PI / 180);
    for (const d of pet.enemiesNear(mouth, C.ConeRange + 0.5)) {
      const to = v().subVectors(this.centerOf(d), mouth);
      const len = to.length();
      if (len > 1.2 && to.dot(dir) / Math.max(1e-6, len) < cosHalf) continue;
      if (this.ctx.world.segmentBlocked(mouth, this.centerOf(d))) continue;
      pet.hit(d, C.TickDamage, { element: 'corrode', statusChance: C.CorrodeChance, from: mouth });
    }
    // 觉醒：蚀香在目标脚下留一片蚀雾
    this.mistTimer -= this.attackInterval;
    if (pet.awakened && this.mistTimer <= 0) {
      this.mistTimer = C.MistEvery;
      const g = v().copy(t.position);
      g.y = groundY(this.ctx, v().copy(g).addScaledVector(UP, 1));
      // 目标还在上一片蚀雾里就续期，不叠第二片（同一处最多一片）
      if (this.mist && this.mist.alive && flat(t.position, this.mist.center) <= C.MistRadius) this.mist.refresh(C.MistTime);
      else this.mist = pet.host.spawnZone(pet, g, C.MistRadius, C.MistTime, C.TickDamage, 'corrode', C.CorrodeChance, CORRODE);
    }
  }

  /** 香炉吐的蚀香（Unity 粒子锥：5–8.5 m/s、0.5–0.85 s）：沿方向几团柔光 */
  private smoke(from: THREE.Vector3, dir: THREE.Vector3, n: number): void {
    const fx = this.pet.host.fx;
    const k = Math.min(4, Math.ceil(n / 3));
    for (let i = 1; i <= k; i++) fx.burst(v().copy(from).addScaledVector(dir, i * 1.1), CORRODE, 0.6 + i * 0.35, 0.5, 0.35);
  }

  override tick(): void {
    if (this.buffUntil > 0 && this.now >= this.buffUntil) {
      this.buffUntil = 0;
      this.ctx.player.stats.removeSource(this.buffSource);
    }
  }

  /** 护主：护盾被打破时怒吼——补 30 护盾、震晕玩家 5 米内的敌人 1 秒（15 秒冷却） */
  onShieldBroken(): void {
    const pet = this.pet, C = SUANNI;
    const player = this.ctx.player;
    if (pet.released || this.now < this.roarReady || !player.alive) return;
    this.roarReady = this.now + C.RoarCooldown;
    player.addShield(C.RoarShield);
    for (const d of pet.enemiesNear(v().copy(this.playerPos).addScaledVector(UP, 1), C.RoarRadius + 1)) {
      if (flat(d.position, this.playerPos) <= C.RoarRadius) this.stun(d, C.RoarStun);
    }
    this.wave(this.playerPos, C.RoarRadius, 16, CORRODE);
    pet.playAct('roar', 0, true);
    pet.lunge(v().subVectors(this.playerPos, pet.position), 0.3, 0.25);
    pet.say('护主！', CORRODE, 1.3);
    pet.host.toast(`狻猊怒吼：护盾 +${C.RoarShield.toFixed(0)}`, undefined, 1.6);
  }

  skill(): boolean {
    this.pet.act(this.roar());
    return true;
  }

  private *roar(): RoutineGen {
    const pet = this.pet, C = SUANNI;
    // 离玩家远就先瞬移回身边再吼
    if (flat(pet.position, this.playerPos) > 5) pet.teleport(v().copy(this.playerPos).addScaledVector(pet.ownerForward(v()), 1.5));
    pet.playAct('roar', 0, true);
    pet.lunge(pet.forward(v()).negate(), 0.25, 0.2);
    yield 0.15;
    const c = pet.position.clone();
    pet.lunge(pet.forward(v()), 0.5, 0.35);
    pet.say('镇宅狮吼！', CORRODE, 1.4);
    this.wave(c, C.SkillRadius, 22, CORRODE);
    this.muzzle(pet.mouth(), 2.5, CORRODE);
    // 香炉喷出一大团烟（没有 ember 挂点就从嘴里）
    this.smoke(pet.socketPos('ember', pet.mouth()), UP, 40);
    for (const d of pet.enemiesNear(v().copy(c).addScaledVector(UP, 1), C.SkillRadius + 1)) {
      if (flat(d.position, c) > C.SkillRadius) continue;
      this.stun(d, C.SkillStun);
      this.ctx.combat.applyStatus(d, 'corrode', 40 * pet.damageMult, undefined, { depth: 0 });
    }
    const stats = this.ctx.player.stats;
    stats.removeSource(this.buffSource);
    stats.add('damageReduction', C.SkillReduction, this.buffSource);
    this.buffUntil = this.now + C.SkillBuff;
    pet.host.toast(`伤害减免 +${(C.SkillReduction * 100).toFixed(0)}%（${C.SkillBuff.toFixed(0)} 秒）`, undefined, 1.8);
    yield 0.3;
  }
}

export const ZHENG = {
  TailDamage: 7, PounceRange: 8, StoneRange: 6, StoneRate: 0.08, StoneTime: 5, RendDamage: 100, RendRange: 18, RendSpeed: 34,
  StoneMax: 3, RendTargets: 5, AttackInterval: 1.4,
} as const;

/** 狰：扑击 + 五尾连抽（吃玩家暴击率）；击石（附近击杀给射速）；灵技「五尾裂石」；觉醒一轮 7 尾 */
export class ZhengBehaviour extends PetBehaviour {
  override get attackInterval(): number { return ZHENG.AttackInterval; }
  override get attackRange(): number { return ZHENG.PounceRange; }
  get tails(): number { return this.pet.awakened ? 7 : 5; }
  /** 击石层数的到期时刻 */
  readonly stacks: number[] = [];
  private offKilled: (() => void) | null = null;
  private get stoneSource(): string { return this.source + ':stone'; }

  protected override onBind(): void {
    this.offKilled = this.ctx.events.on('enemy:killed', ({ enemy, result }) => {
      if (result.request.tags?.includes('purge')) return;
      this.onKilled(enemy);
    });
  }

  override unbind(): void {
    this.offKilled?.();
    this.offKilled = null;
    this.ctx.player.stats.removeSource(this.stoneSource);
    this.stacks.length = 0;
    super.unbind();
  }

  override engagePoint(t: IEnemy): THREE.Vector3 | null {
    return this.approach(t, 1.6);
  }

  attack(t: IEnemy): void {
    this.pet.act(this.flurry(t));
  }

  private *flurry(target: IEnemy): RoutineGen {
    const pet = this.pet, C = ZHENG;
    let t = target;
    if (pet.distTo(t) > 1.8) {
      // 扑击：低伏一下再扑上去（片段对到伏身 + 扑过去的时长）
      const dir = flatten(v().subVectors(t.position, pet.position));
      const leap = Math.min(0.6, Math.max(0, flat(t.position, pet.position) - 0.9 - t.radius) / 20);
      pet.playAct('pounce', 0.12 + leap);
      pet.lunge(v().copy(dir).negate(), 0.2, 0.15);
      yield 0.12;
      if (!t.alive) return;
      const dest = v().copy(t.position).addScaledVector(flatten(v().subVectors(t.position, pet.position)), -(0.9 + t.radius));
      yield pet.dashTo(dest, 20, null, 0.6);
    }
    pet.playAct('tailLash', this.tails * 0.07, false, true); // 五尾（觉醒七尾）连抽，片段对到整轮
    pet.whipTails();
    const crit = this.ctx.player.stats.get('critChance');
    for (let i = 0; i < this.tails; i++) {
      if (!t.alive || pet.distTo(t) > 2.6) {
        // 目标倒了：顺手抽旁边的
        const near = pet.enemiesNear(pet.center(), 3);
        if (near.length === 0) return;
        t = near[0];
      }
      const isCrit = Math.random() < crit;
      const c = this.centerOf(t);
      const side = pet.right(v()).multiplyScalar(i % 2 === 0 ? 0.5 : -0.5);
      const from = pet.center().addScaledVector(pet.forward(v()), -0.3).add(side).addScaledVector(UP, 0.4);
      this.beam(from, c, this.fxColor, 0.05, 0.12);
      pet.hit(t, C.TailDamage, { forceCrit: isCrit });
      this.impact(c, v().subVectors(pet.center(), c).normalize(), isCrit ? 1.5 : 0.7);
      pet.lunge(v().subVectors(c, pet.center()), 0.12, 0.08);
      yield 0.07;
    }
  }

  /** 击石：狰附近 6 米内的击杀给玩家射速 +8%（5 秒，最多 3 层，层数各自计时） */
  private onKilled(d: IEnemy): void {
    const pet = this.pet, C = ZHENG;
    if (pet.released || flat(d.position, pet.position) > C.StoneRange) return;
    this.stacks.push(this.now + C.StoneTime);
    if (this.stacks.length > C.StoneMax) this.stacks.shift();
    this.refresh();
    pet.say(`击石 ×${this.stacks.length}`, this.fxColor, 0.95);
  }

  override tick(): void {
    if (this.stacks.length === 0) return;
    const before = this.stacks.length;
    for (let i = this.stacks.length - 1; i >= 0; i--) if (this.now >= this.stacks[i]) this.stacks.splice(i, 1);
    if (this.stacks.length !== before) this.refresh();
  }

  private refresh(): void {
    const s = this.ctx.player.stats;
    s.removeSource(this.stoneSource);
    if (this.stacks.length > 0) s.add('fireRatePct', ZHENG.StoneRate * this.stacks.length, this.stoneSource);
  }

  skill(): boolean {
    const C = ZHENG;
    // 从狰出发，每次挑离上一个最近的，最多 5 个
    const picked: IEnemy[] = [];
    const from = this.pet.position.clone();
    for (let i = 0; i < C.RendTargets; i++) {
      let best: IEnemy | null = null, bestD = Infinity;
      for (const d of this.enemiesAround(from, C.RendRange * 1.5, C.RendRange)) {
        if (picked.includes(d)) continue;
        const dist = flat(d.position, from);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      if (!best) break;
      picked.push(best);
      from.copy(best.position);
    }
    if (picked.length === 0) {
      this.noTarget();
      return false;
    }
    this.pet.act(this.rend(picked));
    return true;
  }

  private *rend(targets: IEnemy[]): RoutineGen {
    const pet = this.pet, C = ZHENG;
    pet.say('五尾裂石！', this.fxColor, 1.3);
    pet.whipTails();
    for (const t of targets) {
      if (!t.alive) continue;
      const start = pet.position.clone();
      const dir = flatten(v().subVectors(t.position, start));
      const dest = v().copy(t.position).addScaledVector(dir, 1.2 + t.radius);
      // 每一次穿刺从头播裂石，片段对到这一段冲刺；残影沿角尖走（没有挂点就离地 0.5 米）
      pet.playAct('rend', Math.min(0.7, flat(dest, start) / C.RendSpeed) + 0.1, true, true, 0.05);
      const hornFrom = pet.socketPos('horntip', v().copy(start).addScaledVector(UP, 0.5));
      yield pet.dashTo(dest, C.RendSpeed, null, 0.7);
      this.beam(hornFrom, pet.socketPos('horntip', v().copy(pet.position).addScaledVector(UP, 0.5)), this.fxColor, 0.12, 0.3);
      if (t.alive) {
        pet.hit(t, C.RendDamage, { forceCrit: true, knockback: 6, from: start });
        const tc = this.centerOf(t);
        this.impact(tc, dir, 3);
        this.muzzle(tc, 1.2);
      }
      yield 0.06;
    }
  }
}

// ═════════════ 神兽 ═════════════

export const BAIZE = {
  CritBonus: 0.5, AwakenCritBonus: 0.8, InsightRange: 25, InsightBonus: 1.2,
  ShotDamage: 30, ShotRange: 25, ScrollRadius: 30, ScrollStun: 1.5, ScrollTaken: 1.6, ScrollTime: 8, VacuumRange: 25, Shots: 3,
  AttackInterval: 1,
} as const;
const BAIZE_GOLD: RGB = [1, 0.78, 0.32];
const BAIZE_GOLD_RED: RGB = [1, 0.45, 0.3];

/**
 * 白泽：万鬼图（玩家每一次命中都算弱点、暴击伤害 +50% / 觉醒 +80%）、洞悉（25 米内敌人受玩家伤害 +20%）、
 * 金光三连射、灵技「白泽图」（30 米眩晕 1.5 秒、8 秒受伤 +60%、玩家技能冷却减半）、觉醒自动吸取 25 米掉落物
 */
export class BaizeBehaviour extends PetBehaviour {
  override get attackInterval(): number { return BAIZE.AttackInterval; }
  override get attackRange(): number { return BAIZE.ShotRange; }
  private removeWeakpoint: (() => void) | null = null;
  private removeModifier: (() => void) | null = null;
  readonly exposed = new Map<IEnemy, number>();
  private vacuumTimer = 0;
  private cleanTimer = 0;

  protected override onBind(): void {
    this.removeWeakpoint = addForceWeakpoint(() => true);
    this.removeModifier = this.ctx.combat.addOutgoingModifier((e, req) => {
      let m = 1;
      if (req.source !== 'pet' && flat(e.position, this.playerPos) <= BAIZE.InsightRange) m *= BAIZE.InsightBonus;
      const until = this.exposed.get(e);
      if (until !== undefined && this.now < until) m *= BAIZE.ScrollTaken;
      return m;
    });
    this.applyCrit();
  }

  override onAwaken(): void {
    this.applyCrit();
  }

  private applyCrit(): void {
    const s = this.ctx.player.stats;
    s.removeSource(this.source);
    s.add('critDamagePct', this.pet.awakened ? BAIZE.AwakenCritBonus : BAIZE.CritBonus, this.source);
  }

  override unbind(): void {
    this.removeWeakpoint?.();
    this.removeModifier?.();
    this.removeWeakpoint = null;
    this.removeModifier = null;
    super.unbind();
  }

  override tick(dt: number): void {
    if (this.pet.awakened) {
      this.vacuumTimer -= dt;
      if (this.vacuumTimer <= 0) {
        this.vacuumTimer = 0.4;
        (this.ctx.loot as unknown as { attract?(center: THREE.Vector3, range: number): void }).attract?.(this.playerPos, BAIZE.VacuumRange);
      }
    }
    this.cleanTimer -= dt;
    if (this.cleanTimer <= 0 && this.exposed.size > 0) {
      this.cleanTimer = 2;
      for (const [d, until] of [...this.exposed]) if (!d.alive || this.now >= until) this.exposed.delete(d);
    }
  }

  /** 金光三连射：额上第三只眼同时射出三道金光，各打一个目标 */
  attack(t: IEnemy): void {
    const pet = this.pet, C = BAIZE;
    pet.playAct('gaze');
    const eye = pet.socketPos('eyefx', pet.mouth().addScaledVector(UP, 0.15)); // 额上第三只眼
    const targets: IEnemy[] = [t];
    for (const d of pet.enemiesNear(this.centerOf(t), C.ShotRange)) {
      if (targets.length >= C.Shots) break;
      if (targets.includes(d) || eye.distanceTo(this.centerOf(d)) > C.ShotRange || !pet.sees(d)) continue;
      targets.push(d);
    }
    this.burst(eye, BAIZE_GOLD, 0.9, 0.25);
    this.muzzle(eye, 1, BAIZE_GOLD);
    for (const d of targets) {
      const c = this.centerOf(d);
      this.beam(eye, c, lerpRgb(BAIZE_GOLD, BAIZE_GOLD_RED, Math.random() * 0.5), 0.07, 0.18);
      pet.hit(d, C.ShotDamage, { from: eye });
      this.impact(c, v().subVectors(eye, c).normalize(), 1.2);
    }
    pet.lunge(v().subVectors(this.centerOf(t), pet.center()), 0.12, 0.15);
  }

  skill(): boolean {
    const pet = this.pet, C = BAIZE;
    const center = this.playerPos.clone();
    let n = 0;
    for (const d of pet.enemiesNear(v().copy(center).addScaledVector(UP, 1), C.ScrollRadius + 1)) {
      if (flat(d.position, center) > C.ScrollRadius) continue;
      this.stun(d, C.ScrollStun);
      this.exposed.set(d, this.now + C.ScrollTime);
      pet.host.fx.timedMarker(d, BAIZE_GOLD, C.ScrollTime);
      n++;
    }
    // 你的技能冷却立刻减半（剩余冷却）
    const player = this.ctx.player;
    for (const slot of ['primary', 'secondary'] as const) {
      const s = player.skills[slot];
      if (s && s.charges < s.maxCharges && s.cooldownRemaining > 0) player.reduceCooldowns(s.cooldownRemaining * 0.5, slot);
    }
    pet.playAct('scroll', 0, true);
    this.wave(center, C.ScrollRadius, 40, BAIZE_GOLD);
    pet.host.fx.pillar(pet.position, BAIZE_GOLD, 2, 14, 1.2);
    this.burst(pet.center(), BAIZE_GOLD, 6, 0.6);
    pet.lunge(UP, 0.4, 0.4);
    pet.host.flash([1, 0.85, 0.45, 0.35], 0.5);
    pet.host.toast(`白泽图 · 万鬼现形（${n}）`, undefined, 2);
    return true;
  }
}

export const YINGLONG = {
  RainRange: 28, RainDamage: 50, BreathDamage: 20, BreathRange: 22, BreathShock: 0.15,
  StormTime: 6, StormRate: 12, StormDamage: 70, StormRange: 30,
  PearlRise: 0.4, PearlHeight: 1.5, PearlReturn: 0.35, PearlSpin: 90,
  AttackInterval: 0.2,
} as const;
const CYCLE: readonly Exclude<Element, 'none'>[] = ['fire', 'shock', 'corrode'];

/**
 * 应龙：布雨（每 0.6 / 觉醒 0.4 秒对 28 米内随机敌人降天雷 50 + 必定雷殛，每第 3 道附蚀化）、龙息雷光（每秒 5 × 20）、
 * 灵技「杀蚩尤」（6 秒雷暴，每秒 12 道 70 伤害，火 → 雷 → 蚀轮转；释放时护盾回满）
 */
export class YinglongBehaviour extends PetBehaviour {
  override get attackInterval(): number { return YINGLONG.AttackInterval; }
  override get attackRange(): number { return YINGLONG.BreathRange; }
  private rainTimer = 0.6;
  rainCount = 0;

  override tick(dt: number): void {
    this.rainTimer -= dt;
    if (this.rainTimer > 0) return;
    this.rainTimer = this.pet.awakened ? 0.4 : 0.6;
    const list = this.enemiesAround(v().copy(this.playerPos).addScaledVector(UP, 1), YINGLONG.RainRange + 2, YINGLONG.RainRange);
    if (list.length === 0) return;
    this.rainCount++;
    this.strike(list[randInt(0, list.length)], YINGLONG.RainDamage, 'shock', this.rainCount % 3 === 0 ? 'corrode' : 'none');
  }

  /**
   * 天雷：从高空劈到敌人身上（sub = 副元素，必定附着：蚀雨）。source = 雷的出处（杀蚩尤时悬在头顶的宝珠）：
   * 主雷从它劈出，另有一道细白雷照旧从天上落下
   */
  private strike(d: IEnemy, dmg: number, element: Exclude<Element, 'none'>, sub: Element, source?: THREE.Vector3): void {
    const pet = this.pet;
    const c = this.centerOf(d);
    const sky = v().copy(c).add(v().set(rand(-2, 2), 16, rand(-2, 2)));
    const color = sub === 'corrode' ? lerpRgb(SHOCK, CORRODE, 0.6) : ELEMENT_RGB[element];
    this.lightning(source ?? sky, c, color);
    this.lightning(v().copy(sky).add(pet.right(v()).multiplyScalar(0.3)), c, WHITE);
    this.impact(v().copy(d.position).addScaledVector(UP, 0.1), UP, 1.5);
    const req = pet.info(dmg, element, 1);
    req.point = c;
    req.direction = DOWN.clone();
    const r = this.ctx.combat.damageEnemy(d, req);
    // 副元素（Unity DamageInfo.subElement，subChance 1）：按这一击的伤害再附着一次（同样判定反应）
    if (sub !== 'none' && r && !r.immune && d.alive) this.ctx.combat.applyStatus(d, STATUS_OF[sub], r.dealt, undefined, { depth: 0 });
  }

  /** 龙息雷光：张口一道粗雷光，0.2 秒一跳 */
  attack(t: IEnemy): void {
    const pet = this.pet, C = YINGLONG;
    const mouth = pet.mouth();
    const c = this.centerOf(t);
    pet.playAct('breath'); // 0.2 秒一跳：片段没播到 90% 就不重来
    this.beam(mouth, c, SHOCK, 0.14, 0.2);
    // 细雷从爪中宝珠窜出（雷暴时从头顶悬着的宝珠）；没有宝珠就从嘴里
    if (Math.random() < 0.5) this.lightning(pet.partPos(mouth), c, WHITE);
    this.burst(mouth, SHOCK, 0.8, 0.18);
    pet.hit(t, C.BreathDamage, { element: 'shock', statusChance: C.BreathShock, from: mouth });
  }

  skill(): boolean {
    const pet = this.pet;
    const player = this.ctx.player;
    player.addShield(player.maxShield());
    // 雷暴期间还会照常吐龙息：priority 让兴云布雨的动作播完再被龙息接上
    pet.playAct('storm', 0, true);
    this.burst(pet.partPos(pet.socketPos('pearl', pet.center())), SHOCK, 1.6, 0.45); // 爪中宝珠一亮
    pet.run(this.storm());
    return true;
  }

  private *storm(): RoutineGen {
    const pet = this.pet, C = YINGLONG;
    pet.say('杀蚩尤！', PET_GOLD, 1.5);
    pet.host.toast('杀蚩尤 · 雷暴 6 秒，护盾回满', undefined, 2);
    pet.host.flash([0.45, 0.6, 1, 0.3], 0.6);
    this.wave(this.playerPos, C.StormRange, 45, SHOCK);
    const start = this.now, end = start + C.StormTime;
    let next = start;
    let i = 0;
    // 宝珠离爪：0.4 秒升到龙头上方 1.5 米，雷暴期间悬着慢慢转、发亮，天雷从它劈出；结束后飞回爪中
    const pearl = pet.detachPart();
    const pearlFrom = pearl ? pearl.position.clone() : v();
    let dt = 0;
    while (this.now < end && !pet.released) {
      if (pearl) {
        const k = Math.min(1, Math.max(0, (this.now - start) / C.PearlRise));
        const hover = this.pearlHover();
        if (k < 1) pearl.position.lerpVectors(pearlFrom, hover, 1 - (1 - k) * (1 - k));
        else pearl.position.lerp(hover, 1 - Math.exp(-12 * dt));
        pearl.rotateOnWorldAxis(UP, C.PearlSpin * Math.PI / 180 * dt);
        pet.partBoost = k;
      }
      while (this.now >= next) {
        next += 1 / C.StormRate;
        const element = CYCLE[i++ % CYCLE.length];
        const source = pearl ? pearl.position.clone() : undefined;
        const list = this.enemiesAround(v().copy(this.playerPos).addScaledVector(UP, 1), C.StormRange + 2, C.StormRange);
        if (list.length > 0) this.strike(list[randInt(0, list.length)], C.StormDamage, element, 'none', source);
        else {
          // 没敌人也照样打雷（只有特效）
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 12;
          const g = v().set(this.playerPos.x + Math.cos(a) * rr, this.playerPos.y, this.playerPos.z + Math.sin(a) * rr);
          g.y = groundY(this.ctx, v().copy(g).addScaledVector(UP, 2));
          this.lightning(source ?? v().copy(g).addScaledVector(UP, 16), g, ELEMENT_RGB[element]);
        }
      }
      dt = yield null;
    }
    if (!pearl || pet.released) return;
    // 飞回爪中（挂点跟着龙在动：每帧追当前位置）
    const back = pearl.position.clone();
    for (let t = 0; t < C.PearlReturn; t += dt) {
      const k = t / C.PearlReturn;
      pearl.position.lerpVectors(back, pet.partHomePos(v()), k * k);
      pet.partBoost = 1 - k;
      dt = yield null;
    }
    pet.reattachPart();
    if (pet.part) this.burst(pet.part.getWorldPosition(v()), SHOCK, 0.6, 0.25);
  }

  /** 宝珠悬停点：龙头上方 1.5 米，轻轻起伏 */
  private pearlHover(): THREE.Vector3 {
    const pet = this.pet;
    return pet.socketPos('head', pet.center().addScaledVector(UP, pet.height * 0.4))
      .addScaledVector(UP, YINGLONG.PearlHeight + Math.sin(this.now * 2.2) * 0.08);
  }
}

/** 行为类名（PetDefsData.behaviour）→ 构造 */
export const BEHAVIOURS: Readonly<Record<string, () => PetBehaviour>> = {
  dangkang: () => new DangkangBehaviour(),
  huan: () => new HuanBehaviour(),
  jingwei: () => new JingweiBehaviour(),
  chongming: () => new ChongmingBehaviour(),
  suanni: () => new SuanniBehaviour(),
  zheng: () => new ZhengBehaviour(),
  baize: () => new BaizeBehaviour(),
  yinglong: () => new YinglongBehaviour(),
};
