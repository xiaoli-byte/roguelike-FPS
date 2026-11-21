/**
 * 火麒麟的十个招式（Unity Qilin/Moves/QilinMove.cs、ScaleGallop / ScaleBlades / ScaleBreath / ScaleDrink / BurnFlood / BurnDives / BurnPant / BurnSweep /
 * BurnRain / BurnRage 逐个翻译；网页原有的 'gallop' / 'scales' / 'breath' / 'drink' / 'dives' / 'pant' / 'sweep' / 'flood' / 'rain' 招式逻辑并进来，按 Unity 重新定时、改数）。
 * 常量与调度参数在 QilinDef.ts（一处改数）；角度一律世界 yaw（度，0 = +Z），设朝向时换成弧度。
 * 伤害：Unity Dmg(TS 原值) = 难度 1 的绝对伤害 × 狂怒倍率；网页危险物（HazardSet.hurt）再乘难度倍率（同 Unity MoveDamage）。
 * 与 Unity 的差异（特效精神对齐，M11b 再做逐粒子一致）：Surge / FlameTongues / FxDecals / Fx.Qilin* 的专属特效换成 ctx.fx 的粒子、冲击环与爆炸；
 * 鳞刃是 QilinFx 的实例化薄片（挡板判定照旧），不是 EnemyProjectile。
 * 动作（M12）：act(state, seconds, fade) = Unity Brain.PlayAct（片段按 seconds 拉伸、交叉淡入 fade 秒，缺省 0.1）；正式美术的片段事件（hit 等）进 cue，
 * 先到者算，没有片段（程序化兜底体）时按时间兜底（cue 的 fallback）。
 */
import * as THREE from 'three';
import { BossMove } from './framework/BossMove';
import type { BossMoveSpec } from './framework/BossDef';
import type { Qilin } from './Qilin';
import {
  BurnDives, BurnFlood, BurnPant, BurnRage, BurnRain, BurnSweep, QilinDef, ScaleBlades, ScaleBreath, ScaleDrink, ScaleGallop, SKY,
} from './QilinDef';
import { deltaAngle, sweepPlan } from './QilinFurnace';

const DEG = Math.PI / 180;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _hit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as never };

export function dirOf(yawDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.sin(yawDeg * DEG), 0, Math.cos(yawDeg * DEG));
}

/** Mathf.MoveTowardsAngle（度） */
function moveTowardsAngle(cur: number, target: number, maxDelta: number): number {
  const d = deltaAngle(cur, target);
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}

const easeInOut = (k: number) => k * k * (3 - 2 * k);

export abstract class QilinMove extends BossMove {
  /** 经扇形 / 条带等画的预警个数（招式组预警也计在 telegraphCount） */
  extraWarnings = 0;
  private baseRecovery = -1;

  constructor(spec: BossMoveSpec, protected readonly q: Qilin) {
    super(spec);
  }

  get warned(): number {
    return this.telegraphCount + this.extraWarnings;
  }

  protected get ctx() {
    return this.q.ctx;
  }

  protected get hz() {
    return this.q.hazards;
  }

  protected get f() {
    return this.q.furnace;
  }

  protected get floor(): number {
    return this.q.hallFloor;
  }

  /** 出招第一帧：一阶段 70% 以下喘息 × 0.85（TS restFactor），再交给子类 */
  protected override onStart(): void {
    if (this.baseRecovery < 0) this.baseRecovery = this.recovery;
    this.recovery = this.baseRecovery * (this.q.phase === 0 && this.q.phaseFraction() <= 0.7 ? 0.85 : 1);
    this.q.holdGround = false;
    this.prepare();
  }

  protected prepare(): void {}

  /** TS 原值伤害（难度 1 的绝对值）→ 本首领的招式伤害（含狂怒；难度由危险物再乘） */
  protected dmg(tsBase: number): number {
    return this.q.dmg(tsBase);
  }

  protected countWarning(): void {
    this.extraWarnings++;
    this.q.notifyTelegraph(this);
  }

  protected warnCircle(p: THREE.Vector3, radius: number, seconds: number): () => void {
    return this.track(this.hz.groundWarning(p.x, this.floor, p.z, radius, seconds, QilinDef.Warn));
  }

  protected warnLine(from: THREE.Vector3, yawDeg: number, length: number, width: number, seconds: number): () => void {
    return this.track(this.hz.lineWarning(from.x, this.floor, from.z, yawDeg * DEG, length, width * 0.5, seconds, QilinDef.Warn));
  }

  protected get facingDeg(): number {
    return this.q.facing / DEG;
  }

  protected yawTo(p: { x: number; z: number }): number {
    const b = this.q.position;
    const dx = p.x - b.x, dz = p.z - b.z;
    return dx * dx + dz * dz > 1e-4 ? Math.atan2(dx, dz) / DEG : this.facingDeg;
  }

  protected get yawToPlayer(): number {
    return this.yawTo(this.ctx.player.position);
  }

  protected setFacing(yawDeg: number): void {
    this.q.facing = yawDeg * DEG;
  }

  protected turnToward(yawDeg: number, degPerSec: number, dt: number): void {
    this.setFacing(moveTowardsAngle(this.facingDeg, yawDeg, degPerSec * dt));
  }

  protected sfx(id: string, volume = 1, pitch = 1): void {
    this.q.playSfx(id, volume, pitch);
  }

  /** Unity Brain.PlayAct(state, seconds, fade)：片段按 seconds 拉伸（0 = 原速），交叉淡入 fade 秒 */
  protected act(state: string, seconds: number, fade = 0.1): void {
    this.q.act(state, seconds, fade);
  }

  /** 给玩家一下冲量（击退 / 掀飞） */
  protected push(x: number, y: number, z: number): void {
    const p = this.ctx.player;
    if (p.alive) p.applyImpulse(_d.set(x, y, z));
  }

  protected rng(min: number, max: number): number {
    return this.ctx.rng.range(min, max);
  }
}

// ───────────────────────────── 玄鳞 · 踏火奔驰 + 横穿冲撞 ─────────────────────────────

type GallopLeg = 'toTrack' | 'run' | 'aim' | 'charge' | 'crash' | 'recover' | 'done';

/**
 * 踏火奔驰（Unity ScaleGallop）：前摇 0.35 s 长啸 → 上跑道（≤ 2.5 s，15 m/s）→ 沿外环跑道狂奔 3.2–4.6 s（18 m/s，左右蹄交替落燃烧的蹄印；撞到跑道上的人 24 + 掀开，1 s 一次）；
 * 玩家落在前方 28–75° 时（或跑够了）停步刨蹄：地上亮一条 4 m 宽的冲撞线（1 s），过玩家（预判 0.35 s）冲到对面跑道（10 m ≤ 线长 ≤ 跑道直径；吊着的巨鼎挡在线上时在它前面刹住）；
 * 30 m/s 冲过去（≤ 2.4 s），胸—臀线段扫到玩家撞一下 34 + 侧向掀飞；撞上石柱晕 1.6 s，冲到殿墙跟前收步 0.5 s。
 */
export class GallopMove extends QilinMove {
  leg: GallopLeg = 'done';
  prints = 0;
  tramples = 0;
  chargeHits = 0;
  chargeLength = 0;
  charges = 0;
  crashes = 0;
  private legT = 0;
  private runFor = 4;
  private dirSign = 1;
  private trampleAt = -10;
  private travel = 0;
  private chargeYaw = 0;
  private hitDone = false;
  private printAcc = 0;
  private readonly chargeDir = new THREE.Vector3();
  private readonly lastPos = new THREE.Vector3();

  private get trackR(): number {
    return this.f.trackRadius;
  }

  protected override prepare(): void {
    this.q.halt();
    const me = this.f.yawOf(this.q.position), pa = this.f.yawOf(this.ctx.player.position);
    this.dirSign = deltaAngle(me, pa) >= 0 ? 1 : -1;
    this.runFor = this.rng(3.2, 4.6);
    this.printAcc = 0;
    this.prints = this.tramples = this.chargeHits = 0;
    this.chargeLength = 0;
    this.leg = 'toTrack';
  }

  protected override onTelegraph(): void {
    this.act('roar', this.windupTime + 0.6);
    this.sfx('boss_roar', 0.7, 1.1);
    this.q.tell('gallop', '火麒麟沿外环跑道狂奔——别站在跑道上，蹄印上的火会烧人');
  }

  protected override onActiveBegin(): void {
    this.leg = 'toTrack';
    this.legT = 0;
    this.lastPos.copy(this.q.position);
    this.q.accel = 34;
    this.act('Locomotion', 0);
  }

  protected override get activeDone(): boolean {
    return this.leg === 'done';
  }

  protected override onActive(dt: number): void {
    this.legT += dt;
    const f = this.f, q = this.q, p = q.position;
    const R = this.trackR;
    switch (this.leg) {
      case 'toTrack': {
        const th = f.yawOf(p) + this.dirSign * 14.3;
        this.steer(f.point(th, R, _a), this.q.qdef.toTrackSpeed, dt);
        if (Math.abs(f.radiusOf(p) - R) < 1.2 || this.legT > 2.5) this.next('run');
        break;
      }
      case 'run': {
        const th = f.yawOf(p) + this.dirSign * 17.2;
        this.steer(f.point(th, R, _a), this.q.qdef.gallopSpeed, dt);
        this.dropPrints(dt, 0.13);
        this.trample();
        const ahead = deltaAngle(f.yawOf(p), f.yawOf(this.ctx.player.position)) * this.dirSign;
        if (this.legT >= this.runFor || (this.legT > 2 && ahead > 28.6 && ahead < 74.5)) this.beginAim();
        break;
      }
      case 'aim':
        q.halt();
        this.turnToward(this.chargeYaw, 400, dt);
        if (this.legT >= 1) {
          this.next('charge');
          this.travel = 0;
          this.hitDone = false;
          this.lastPos.copy(p);
          this.charges++;
          q.accel = 90;
          this.act('Locomotion', 0, 0.05);
          this.sfx('boss_roar', 0.9, 1.3);
          // 后蹄一蹬：尘环 + 火星
          this.ctx.fx.ring(_a.set(p.x, this.floor + 0.1, p.z), 4, 0x6a5040, 0.5);
          this.ctx.fx.burst(_a.set(p.x, this.floor + 0.4, p.z), QilinDef.Ember, 20, 6, 0.6, 0.3, 4);
        }
        break;
      case 'charge': {
        const speed = this.q.qdef.chargeSpeed;
        q.steer(this.chargeDir.x, this.chargeDir.z, speed);
        this.setFacing(this.chargeYaw);
        this.travel += Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
        this.lastPos.copy(p);
        this.dropPrints(dt, 0.1);
        if (!this.hitDone) this.chargeHit();
        // 火尾
        if (Math.random() < 0.7) q.fx?.emit(q.chestPoint(_b), _c.set(-this.chargeDir.x * 4, 1.5, -this.chargeDir.z * 4), 0.45, 0.4, QilinDef.Fire, 2, 1);
        const ahead = this.wallAhead(this.chargeDir, speed * dt + 0.2);
        const crashed = (q.moveHitWall || (ahead !== null && ahead.obstacle)) && this.legT > 0.1;
        const atWall = ahead !== null && !ahead.obstacle;
        const outside = !q.arenaContains(p, q.radius * 0.5);
        if (this.travel < this.chargeLength && !crashed && !atWall && !outside && this.legT <= 2.4) break;
        q.halt();
        q.velocity.x = q.velocity.z = 0;
        q.accel = SKY.Accel;
        if (crashed) {
          this.next('crash');
          this.crashes++;
          this.act('stun', 1.6);
          const h = q.headPoint(_a);
          this.ctx.fx.burst(h, 0x4a4040, 30, 8, 1, 0.4, 14);
          this.ctx.fx.burst(h, 0xffe08a, 12, 4, 0.8, 0.2, 2);
          q.quake(0.6, 0.4);
          this.sfx('boss_slam', 1, 0.9);
          q.tell('crash', '火麒麟一头撞上石柱，晕了——快打角根的火珠！', '#ffe08a');
        } else this.next('recover');
        break;
      }
      case 'crash':
      case 'recover':
        q.halt();
        this.turnToward(this.yawToPlayer, 115, dt);
        if (this.legT >= (this.leg === 'crash' ? 1.6 : 0.5)) this.next('done');
        break;
    }
  }

  private next(l: GallopLeg): void {
    this.leg = l;
    this.legT = 0;
  }

  /** 朝 target 以 speed 推进，朝向跟着速度转；头前面是石柱就顺着它的表面滑过去 */
  private steer(target: THREE.Vector3, speed: number, dt: number): void {
    const p = this.q.position;
    let vx = target.x - p.x, vz = target.z - p.z;
    const len = Math.hypot(vx, vz);
    if (len < 0.1) return;
    vx /= len;
    vz /= len;
    const wall = this.wallAhead(_b.set(vx, 0, vz), speed * 0.12);
    if (wall && wall.obstacle) {
      const nx = wall.normal.x, nz = wall.normal.z, nl = Math.hypot(nx, nz);
      if (nl > 1e-2) {
        const ux = nx / nl, uz = nz / nl;
        const dot = vx * ux + vz * uz;
        let sx = vx - dot * ux, sz = vz - dot * uz;
        if (sx * sx + sz * sz < 0.04) {
          sx = -uz * this.dirSign;
          sz = ux * this.dirSign;
        }
        const sl = Math.hypot(sx, sz) || 1;
        vx = sx / sl;
        vz = sz / sl;
      }
    }
    this.q.steer(vx, vz, speed);
    this.turnToward(Math.atan2(vx, vz) / DEG, 360, dt);
  }

  /**
   * 沿 dir 头的前沿再往前 lead 米有没有石柱 / 墙（离地 2 m 的射线，近乎竖直的面）。obstacle = 殿里的东西（石柱、坠池的鼎），不是殿墙那一圈
   */
  private wallAhead(dir: THREE.Vector3, lead: number): { normal: THREE.Vector3; obstacle: boolean } | null {
    const p = this.q.position;
    const len = Math.hypot(dir.x, dir.z);
    if (len < 1e-3) return null;
    _c.set(dir.x / len, 0, dir.z / len);
    const head = this.q.headPoint(_d);
    let reach = Math.max(this.q.radius, (head.x - p.x) * _c.x + (head.z - p.z) * _c.z);
    reach = Math.min(6, Math.max(0.5, reach));
    _a.set(p.x, this.floor + 2, p.z);
    const hit = this.ctx.world.raycast(_a, _c, reach + Math.max(0.05, lead), _hit);
    if (!hit || hit.normal.y >= 0.5) return null;
    return { normal: hit.normal, obstacle: this.f.radiusOf(hit.point) < this.f.wallRadius - 0.8 };
  }

  /** 横穿冲撞：从当前位置过玩家（预判 0.35 s）一直冲到对面跑道 */
  private beginAim(): void {
    const f = this.f, q = this.q, p = q.position;
    const aim = q.predict(0.35, _a);
    let ax = aim.x - p.x, az = aim.z - p.z;
    if (ax * ax + az * az > 0.25) {
      const l = Math.hypot(ax, az);
      ax /= l;
      az /= l;
    } else {
      ax = Math.sin(q.facing);
      az = Math.cos(q.facing);
    }
    this.chargeDir.set(ax, 0, az);
    this.chargeYaw = Math.atan2(ax, az) / DEG;
    const R = this.trackR;
    const ox = p.x - f.center.x, oz = p.z - f.center.z;
    const b = ox * ax + oz * az, c = ox * ox + oz * oz - R * R, disc = b * b - c;
    const len = disc > 0 ? -b + Math.sqrt(disc) : 20;
    this.chargeLength = Math.min(2 * R, Math.max(10, len));
    this.chargeLength = this.clearOfCauldron(p, this.chargeDir, this.chargeLength);
    this.next('aim');
    q.halt();
    q.velocity.x = q.velocity.z = 0;
    this.warnLine(_b.set(p.x, this.floor, p.z), this.chargeYaw, this.chargeLength, 4, 1);
    this.act('paw', 1, 0.08);
    this.sfx('telegraph');
    q.tell('charge', '地上亮线——火麒麟要横穿象限冲撞，侧移躲开！');
  }

  /** 吊着 / 斜挂的巨鼎挡在冲撞线上（没有碰撞体）：头、胸、膝三个高度沿线每 0.5 m 查一次落没落进鼎（局部盒外扩 0.4 m），碰上之前 0.6 m 刹住 */
  private clearOfCauldron(p: THREE.Vector3, dir: THREE.Vector3, len: number): number {
    const cd = this.q.cauldron;
    if (!cd || cd.state === 'falling' || cd.state === 'fallen') return len;
    const q = this.q;
    const head = q.headPoint(_c);
    const fx = Math.sin(q.facing), fz = Math.cos(q.facing);
    const fwd = Math.max(q.radius, (head.x - p.x) * fx + (head.z - p.z) * fz);
    const headY = Math.max(1.5, head.y - p.y), chestY = Math.max(1, q.chestPoint(_d).y - p.y);
    for (let t = 0; t <= len; t += 0.5) {
      for (const y of [headY, chestY, 1.2]) {
        _a.set(p.x + dir.x * (t + fwd), p.y + y, p.z + dir.z * (t + fwd));
        if (cd.insideLocal(_a, 0.4)) return Math.max(0.5, t - 0.6);
      }
    }
    return len;
  }

  private dropPrints(dt: number, every: number): void {
    this.printAcc += dt;
    if (this.printAcc < every) return;
    this.printAcc = 0;
    const at = this.q.nextHoofPoint(_a);
    this.q.dropPrint(at);
    this.prints++;
    if (this.prints % 2 === 1) this.ctx.fx.burst(_b.copy(at).setY(this.floor + 0.2), QilinDef.Gold, 3, 3, 0.4, 0.14, 6);
  }

  /** 奔驰时撞到跑道上的玩家：24 + 往外掀开，1 s 一次 */
  private trample(): void {
    const pl = this.ctx.player;
    if (!pl.alive || this.ctx.time.now - this.trampleAt < 1) return;
    const c = this.q.getBodyCenter(_a);
    const ox = pl.position.x - c.x, oz = pl.position.z - c.z;
    const d = Math.hypot(ox, oz);
    if (d > this.q.radius + 1 || pl.position.y - this.floor > 3) return;
    this.trampleAt = this.ctx.time.now;
    if (this.hz.hurt(this.dmg(24), 'none', _b.copy(this.q.position).setY(this.q.position.y + 1)) <= 0) return;
    this.tramples++;
    const ux = d > 0.01 ? ox / d : Math.cos(this.q.facing), uz = d > 0.01 ? oz / d : -Math.sin(this.q.facing);
    this.push(ux * 11, 6, uz * 11);
    this.q.quake(0.4, 0.3);
    this.sfx('enemy_melee', 1, 0.7);
  }

  /** 冲撞判定：胸—臀线段（离地 1.2 m）扫到玩家胶囊（半径 1.6）就撞一下，往冲撞方向的侧前方掀飞 */
  private chargeHit(): void {
    const a = this.q.chestPoint(_a), b = this.q.hipsPoint(_b);
    a.y = b.y = this.floor + 1.2;
    if (!this.hz.segmentHitsPlayer(a, b, this.q.qdef.chargeRadius)) return;
    this.hitDone = true;
    if (this.hz.hurt(this.dmg(34), 'none', _c.copy(this.q.position).setY(this.q.position.y + 1)) <= 0) return;
    this.chargeHits++;
    const pl = this.ctx.player.position;
    const ox = pl.x - this.q.position.x, oz = pl.z - this.q.position.z;
    const side = ox * this.chargeDir.z - oz * this.chargeDir.x >= 0 ? 1 : -1;
    const d = dirOf(this.chargeYaw + side * 68.8, _d);
    this.push(d.x * 13, 7, d.z * 13);
    this.q.quake(0.55, 0.35);
    this.sfx('enemy_melee', 1, 0.6);
  }

  protected override onEnd(_cancelled: boolean): void {
    this.q.accel = SKY.Accel;
    this.leg = 'done';
  }
}

// ───────────────────────────── 玄鳞 · 张鳞 ─────────────────────────────

/**
 * 张鳞（Unity ScaleBlades）：前摇 1 s 人立（脚下 6.5 m 预警圈，鳞冠从身上竖起、张到每片鳞刃的出手位置）→ 360° 射出一圈 36 片红热鳞刃
 * （离地 1.2 m 的竖薄片，21 m/s，飞到殿墙两倍远）；生命 85% 以下 0.4 s 后再射一圈，错开半格。鳞刃撞到石柱 / 墙就碎；打中玩家 20（火）并往外推。
 */
export class ScalesMove extends QilinMove {
  rings = 0;
  bladesFired = 0;
  twoRings = false;
  private fxAcc = 0;

  protected override prepare(): void {
    this.q.halt();
    this.twoRings = this.q.phaseFraction() <= ScaleBlades.SecondRingAt;
  }

  protected override get windupDone(): boolean {
    return this.cue('hit', this.windupTime);
  }

  protected override onTelegraph(): void {
    this.warnCircle(this.q.position, 6.5, this.windupTime);
    this.act('rear', this.windupTime, 0.08);
    this.sfx('telegraph', 1, 0.75);
    this.sfx('boss_roar', 0.8, 0.9);
    this.q.crown?.begin(this.q.position, this.facingDeg, ScaleBlades.Count, ScaleBlades.StartRadius, this.floor + ScaleBlades.Height, this.windupTime);
    this.q.tell('scales', '火麒麟人立张鳞——躲到玄武岩柱后面！', '#ff9a4a');
  }

  protected override onWindup(dt: number): void {
    this.q.halt();
    this.fxAcc += dt;
    if (this.fxAcc < 0.09) return;
    this.fxAcc = 0;
    const c = this.q.getBodyCenter(_a).add(_b.set(this.rng(-1, 1), this.rng(0, 2), this.rng(-1, 1)));
    this.ctx.fx.burst(c, QilinDef.Gold, 2, 3, 0.45, 0.16, -2);
  }

  protected override onActiveBegin(): void {
    this.fireRing(0);
    if (this.twoRings) this.q.crown?.begin(this.q.position, this.facingDeg, ScaleBlades.Count, ScaleBlades.StartRadius, this.floor + ScaleBlades.Height, ScaleBlades.SecondDelay, 0.5);
  }

  protected override onActive(_dt: number): void {
    this.q.halt();
    if (this.twoRings && this.stageAt(ScaleBlades.SecondDelay)) this.fireRing(0.5);
  }

  protected override onEnd(_cancelled: boolean): void {
    this.q.crown?.release();
  }

  private fireRing(offsetFrac: number): void {
    this.q.crown?.release();
    this.act('scalesFire', 0.6, 0.03);
    const p = this.q.position;
    const origin = _a.set(p.x, this.floor, p.z);
    const n = this.q.fx?.fireRing(origin, ScaleBlades.Count, this.q.facing + (offsetFrac * Math.PI * 2) / ScaleBlades.Count, ScaleBlades.Speed,
      this.f.wallRadius * 2.2, ScaleBlades.StartRadius) ?? 0;
    this.bladesFired += n;
    this.rings++;
    this.ctx.fx.ring(_b.set(p.x, this.floor + 0.1, p.z), 6.5, QilinDef.Gold, 0.5);
    this.ctx.fx.burst(_b.set(p.x, this.floor + 3, p.z), QilinDef.Ember, 30, 10, 0.6, 0.3, 6);
    if (offsetFrac === 0) this.ctx.fx.burst(_b.set(p.x + Math.sin(this.q.facing) * 1.6, this.floor + 0.2, p.z + Math.cos(this.q.facing) * 1.6), 0x6a5040, 16, 5, 0.6, 0.3, 6);
    this.q.quake(0.35, 0.3);
    this.sfx('enemy_shot', 1, 0.55);
    this.sfx('shield_break', 0.6, 1.4);
  }
}

// ───────────────────────────── 玄鳞 · 麟火 ─────────────────────────────

/**
 * 麟火（Unity ScaleBreath）：玩家在 15 m 以内才出。前摇 0.8 s 转向玩家、张口，面前扇形预警（半角 24°、14 m）；
 * 出手 1.6 s 短距离吐火，口部朝玩家慢慢转（28.6°/s），每 0.15 s 判一次：在扇形里、口到玩家胸口不被挡（石柱挡得住）→ 6（火）。
 */
export class BreathMove extends QilinMove {
  ticks = 0;
  hits = 0;
  blocked = 0;
  private acc = 0;
  private yaw = 0;

  override weightNow(): number {
    return this.q.distToPlayer() < ScaleBreath.MaxDistance ? this.weight : 0;
  }

  protected override prepare(): void {
    this.q.halt();
    this.yaw = this.yawToPlayer;
    this.setFacing(this.yaw);
    this.acc = 0;
  }

  protected override onTelegraph(): void {
    const m = this.q.mouthPoint(_a);
    this.track(this.hz.sectorWarning(m.x, this.floor, m.z, this.yaw * DEG, ScaleBreath.HalfAngle * DEG, ScaleBreath.Range, this.windupTime, QilinDef.Warn));
    this.act('breath', this.windupTime + this.active);
    this.sfx('enemy_charge', 0.9, 0.6);
  }

  protected override onWindup(dt: number): void {
    this.q.halt();
    // 火星往口里吸
    if (Math.random() < dt * 30) {
      const m = this.q.mouthPoint(_a);
      _b.set(this.rng(-2, 2), this.rng(-1, 1.5), this.rng(-2, 2));
      this.q.fx?.emit(_c.copy(m).add(_b), _b.multiplyScalar(-2.5), 0.4, 0.2, QilinDef.Hot, 0, 0);
    }
  }

  protected override onActiveBegin(): void {
    this.sfx('skill_fire', 0.9, 0.7);
    this.ctx.fx.burst(this.q.mouthPoint(_a), QilinDef.Hot, 14, 5, 0.3, 0.3, 0);
  }

  protected override onActive(dt: number): void {
    this.q.halt();
    this.yaw = moveTowardsAngle(this.yaw, this.yawToPlayer, ScaleBreath.TurnRate * dt);
    this.setFacing(this.yaw);
    const r = this.q.breatheAlong(this.yaw, ScaleBreath.HalfAngle, ScaleBreath.Range, this.dmg(ScaleBreath.TickDamage), dt, this, 0.42);
    if (r) {
      this.ticks++;
      if (r === 'hit') this.hits++;
      else if (r === 'blocked') this.blocked++;
    }
  }

  /** 判定节拍（Qilin.breatheAlong 调） */
  tick(dt: number): boolean {
    this.acc += dt;
    if (this.acc < ScaleBreath.TickEvery) return false;
    this.acc = 0;
    return true;
  }
}

// ───────────────────────────── 玄鳞 · 饮熔 ─────────────────────────────

/**
 * 饮熔（Unity ScaleDrink）：只由 85% / 70% 两道生命刻度排上。选点：离自己最近、锁扣还在、链还拴着的象限，饮熔点在象限中线上、池外 3.1 m，背朝锁扣；
 * 前摇 1 s：前 28% 原地蹲身蓄跳，再抛物线跃向饮熔点（高 6 m），落点亮 4.5 m 预警圈；落地 4.5 m 内 24 + 掀开；两座炉口钻出 4 只炭童；它身后的锁扣大亮；
 * 低头饮熔 4 s（锁扣碎了、鼎角还在落时最多多等 2 s）；喝完：鳞甲回满、伤害 × 1.08、火鬃满。
 */
export class DrinkMove extends QilinMove {
  quadrant = -1;
  readonly spot = new THREE.Vector3();
  summoned = 0;
  completed = 0;
  private finished = false;
  private readonly from = new THREE.Vector3();
  private faceYaw = 0;
  private fxAcc = 0;

  override weightNow(): number {
    return 0;
  }

  get sipping(): boolean {
    return this.stage === 'active' && !this.finished;
  }

  protected override prepare(): void {
    this.finished = false;
    this.summoned = 0;
    const f = this.f, q = this.q;
    this.from.copy(q.position);
    this.quadrant = q.pickDrinkQuadrant();
    const qy = f.quadrantYaw(this.quadrant);
    f.point(qy, f.poolRadius + q.qdef.drinkSpotOut, this.spot);
    this.faceYaw = qy + 180;
  }

  protected override onTelegraph(): void {
    this.warnCircle(this.spot, ScaleDrink.LandRadius, this.windupTime);
    this.act('leap', this.windupTime);
    this.sfx('boss_roar', 1, 0.85);
  }

  protected override onWindup(dt: number): void {
    const wind = Math.max(0.05, this.windupTime), crouch = wind * ScaleDrink.CrouchFrac;
    const k = easeInOut(Math.min(1, Math.max(0, (this.stageT - crouch) / Math.max(0.05, wind - crouch))));
    _a.lerpVectors(this.from, this.spot, k);
    _a.y = this.from.y + (this.spot.y - this.from.y) * k + Math.sin(Math.PI * k) * ScaleDrink.LeapHeight;
    this.q.place(_a);
    this.turnToward(this.faceYaw, 290, dt);
    if (this.stageAt(wind * ScaleDrink.CrouchFrac)) this.ctx.fx.ring(_b.copy(this.from).setY(this.floor + 0.1), 3, 0x6a5040, 0.4);
  }

  protected override onActiveBegin(): void {
    const q = this.q, s = this.spot;
    q.place(s);
    this.setFacing(this.faceYaw);
    q.halt();
    this.act('drink', q.qdef.drinkSeconds);
    this.hz.blast(s.x, this.floor, s.z, ScaleDrink.LandRadius, this.dmg(ScaleDrink.LandDamage), { maxHeight: 3, knockback: 9, knockUp: 5 });
    q.quake(0.5, 0.4);
    this.ctx.fx.ring(_a.set(s.x, this.floor + 0.1, s.z), ScaleDrink.LandRadius * 0.7, 0x6a5040, 0.5);
    this.ctx.fx.burst(_a.set(s.x, this.floor + 0.4, s.z), QilinDef.Ember, 26, 8, 0.8, 0.3, 10);
    this.sfx('boss_slam', 1, 0.9);
    this.summoned = q.summonTantong();
    if (this.quadrant >= 0) q.beginSip(this.quadrant);
    q.tell('drink', '火麒麟在熔池边饮熔——打碎它身后外墙上发亮的锁扣，让巨鼎砸它！', '#ffe08a');
  }

  protected override onActive(dt: number): void {
    const q = this.q;
    q.halt();
    const drink = q.qdef.drinkSeconds;
    q.fx?.eruption(0.18);
    q.maneHeat = Math.min(1, q.maneHeat + dt / drink * 0.5);
    this.fxAcc += dt;
    if (this.fxAcc >= 0.06) {
      // 熔岩从池面被吸进嘴里
      this.fxAcc = 0;
      const f = this.f;
      const src = f.point(f.quadrantYaw(Math.max(0, this.quadrant)) + this.rng(-14, 14), f.poolRadius * this.rng(0.4, 0.9), _a);
      src.y += 0.2;
      const mouth = q.mouthPoint(_b);
      _c.subVectors(mouth, src).multiplyScalar(1.6);
      q.fx?.emit(src, _c, 0.6, 0.25, Math.random() < 0.5 ? QilinDef.Hot : QilinDef.Fire, 0, 0);
    }
    const pending = q.cornerPending;
    if ((this.stageT >= drink && !pending) || this.stageT >= drink + 2) this.finishDrink();
  }

  /** 喝完：鳞甲回满、伤害 × 1.08、火鬃满 */
  private finishDrink(): void {
    if (this.finished) return;
    this.finished = true;
    const q = this.q;
    q.armor = q.maxArmor;
    q.damageMult *= q.qdef.drinkDamageGrowth;
    this.completed++;
    q.maneHeat = 1;
    q.drinksFinished++;
    if (q.sipping) q.endSip();
    this.ctx.fx.burst(q.getBodyCenter(_a).setY(_a.y + 1), QilinDef.Gold, 40, 9, 0.9, 0.4, 4);
    this.sfx('boss_roar', 1, 0.95);
    this.ctx.ui.toast('火麒麟饮完熔岩——鳞甲回满，火鬃更旺了', '#ff9a4a');
    this.endActive();
  }

  protected override onEnd(_cancelled: boolean): void {
    const q = this.q;
    if (q.sipping) q.endSip();
    q.fx?.eruption(0);
    if (q.position.y > this.floor + 0.1) q.place(_a.copy(q.position).setY(this.floor));
  }
}

// ───────────────────────────── 焚身 · 熔流轮转 ─────────────────────────────

/**
 * 熔流轮转（Unity BurnFlood）：换形后第一招；之后熔流没在轮的时候按权重出。长啸 2 s：飞到熔池上空靠玩家一侧 5.5 m 高，对着玩家吼，熔岩柱翻涌；
 * 1.2 s 时开始一轮熔流（QilinFlood：从玩家所在的象限起顺时针）。熔流在招式结束后继续轮，这一招本身只是开闸。
 */
export class FloodMove extends QilinMove {
  opened = 0;
  firstQuadrant = -1;

  override weightNow(): number {
    return this.q.flood?.active ? 0 : this.weight;
  }

  protected override prepare(): void {
    this.firstQuadrant = -1;
    this.q.skyTarget = BurnFlood.Alt;
  }

  protected override onTelegraph(): void {
    this.act('roar', this.windupTime + this.active);
    this.sfx('boss_roar', 1, 0.7);
    this.q.tell('flood', '熔岩溢进四条渠——渠会顺时针轮流涨宽，淹掉一个象限的外侧，看地上的预警条带！', '#ff9a4a');
  }

  protected override onWindup(dt: number): void {
    this.hold(dt);
  }

  protected override onActive(dt: number): void {
    this.hold(dt);
  }

  private hold(dt: number): void {
    const q = this.q;
    q.skyTarget = BurnFlood.Alt;
    q.flyTo(q.poolEdgeToward(this.ctx.player.position, _a), BurnFlood.Speed, 1.5);
    q.fx?.eruption(this.t < 1.6 ? 0.45 : 0);
    this.turnToward(this.yawToPlayer, 115, dt);
    if (!this.at(BurnFlood.OpenAt) || !q.flood) return;
    this.firstQuadrant = this.f.quadrantOf(this.ctx.player.position);
    if (!q.flood.start(this.firstQuadrant)) return;
    this.opened++;
    this.countWarning();
    this.countWarning();
    q.quake(0.4, 0.5);
  }

  protected override onEnd(_cancelled: boolean): void {
    this.q.fx?.eruption(0);
    this.q.skyTarget = SKY.Alt;
  }
}

// ───────────────────────────── 焚身 · 踏云俯冲 ─────────────────────────────

type DiveLeg = 'rise' | 'tele' | 'dive' | 'recover' | 'done';

/**
 * 踏云俯冲（Unity BurnDives）：连踏三次，三次之后排上落地喘息。每一次：飞到玩家 0.5 s 后的位置上空（7.5 m、22 m/s，≤ 1.4 s）；
 * 蓄势 0.9 s（狂怒 0.7）落点亮 4.2 m 预警圈；俯冲 0.3 s 砸下：4.2 m 内 30（火）+ 掀飞，炸出一圈贴地火环（13 m/s 扩到 15 m，16（火），被落点砸中的这一下放过）；收势 0.45 s。
 */
export class DivesMove extends QilinMove {
  leg: DiveLeg = 'done';
  diveIndex = 0;
  readonly target = new THREE.Vector3();
  landings = 0;
  blastHits = 0;
  private legT = 0;
  private readonly diveFrom = new THREE.Vector3();

  private get teleTime(): number {
    return this.q.enraged ? BurnDives.TeleRage : BurnDives.Tele;
  }

  protected override prepare(): void {
    this.diveIndex = 0;
    this.leg = 'rise';
    this.q.skyTarget = SKY.High;
    this.q.accel = 40;
  }

  protected override onTelegraph(): void {
    this.act('roar', this.windupTime + 0.3);
    this.sfx('boss_roar', 0.8, 1.15);
    this.q.tell('dives', '焚身俯冲踏地——落点会炸出一圈火环，跳起来躲；连踏三次之后它会落地喘息');
  }

  protected override onWindup(dt: number): void {
    this.q.hover();
    this.turnToward(this.yawToPlayer, 240, dt);
  }

  protected override onActiveBegin(): void {
    this.beginDive();
  }

  protected override get activeDone(): boolean {
    return this.leg === 'done';
  }

  private beginDive(): void {
    this.pickTarget();
    this.leg = 'rise';
    this.legT = 0;
    this.q.skyTarget = SKY.High;
    this.act('Locomotion', 0);
  }

  /** 落点：玩家 0.5 s 后的位置，夹在殿墙内 2.5 m；不压在倒鼎上、不插进石柱 */
  private pickTarget(): void {
    const f = this.f, q = this.q;
    const a = q.predict(BurnDives.Lead, this.target);
    a.y = this.floor;
    const max = f.wallRadius - 2.5;
    if (f.radiusOf(a) > max) f.point(f.yawOf(a), max, a);
    if (q.cauldron?.isCover) {
      const keep = 2.6 * 1.35 + q.radius * 0.6;
      if (f.radiusOf(a) < keep) f.point(f.radiusOf(a) > 0.3 ? f.yawOf(a) : f.yawOf(q.position), keep, a);
    }
    q.pushClear(a);
    a.y = this.floor;
  }

  protected override onActive(dt: number): void {
    this.legT += dt;
    const q = this.q;
    switch (this.leg) {
      case 'rise': {
        const there = q.flyTo(this.target, BurnDives.RiseSpeed, 1.2);
        this.turnToward(this.yawTo(this.target), 290, dt);
        if (!there && this.legT <= BurnDives.RiseMax) break;
        this.leg = 'tele';
        this.legT = 0;
        q.brake();
        this.warnCircle(this.target, BurnDives.Radius, this.teleTime);
        this.act('tuck', this.teleTime, 0.08);
        this.sfx('telegraph', 1, 1);
        break;
      }
      case 'tele':
        q.flyTo(this.target, 6, 0.3);
        q.skyTarget = SKY.High;
        this.turnToward(this.yawToPlayer, 170, dt);
        // 火星往胸口吸
        if (Math.random() < dt * 25) {
          const c = q.chestPoint(_a);
          _b.set(this.rng(-3, 3), this.rng(-2, 2), this.rng(-3, 3));
          q.fx?.emit(_c.copy(c).add(_b), _b.multiplyScalar(-2.2), 0.45, 0.25, QilinDef.Hot, 0, 0);
        }
        if (this.legT < this.teleTime) break;
        this.leg = 'dive';
        this.legT = 0;
        this.diveFrom.copy(q.position);
        this.act('stomp', BurnDives.DiveTime / BurnDives.StompHitAt, 0.04);
        this.sfx('boss_roar', 0.8, 1.4);
        break;
      case 'dive': {
        const k = Math.min(1, this.legT / BurnDives.DiveTime);
        _a.lerpVectors(this.diveFrom, this.target, k);
        _a.y = this.diveFrom.y + (this.target.y - this.diveFrom.y) * k * k;
        q.skyPlace(_a);
        if (Math.random() < 0.8) q.fx?.emit(q.chestPoint(_b), _c.set(0, 3, 0), 0.4, 0.45, QilinDef.Fire, 2, 1);
        if (k >= 1) this.land();
        break;
      }
      case 'recover':
        q.skyTarget = 0;
        q.hover();
        this.turnToward(this.yawToPlayer, 120, dt);
        if (this.legT < BurnDives.LandRecover) break;
        this.diveIndex++;
        if (this.diveIndex < BurnDives.Count) this.beginDive();
        else {
          this.leg = 'done';
          // 三踏之后落地喘息（下一招）：招式间隙里也待在地上
          q.queueMove(BurnPant.id);
          q.holdGround = true;
        }
        break;
    }
  }

  /** 砸下：落点重击 + 贴地火环（被重击打中的这一下火环放过玩家） */
  private land(): void {
    const a = this.target, q = this.q;
    this.leg = 'recover';
    this.legT = 0;
    this.landings++;
    q.skyTarget = 0;
    const hit = this.hz.blast(a.x, this.floor, a.z, BurnDives.Radius, this.dmg(BurnDives.BlastDamage), { maxHeight: 3, knockback: 10, knockUp: 6, element: 'fire' });
    if (hit) this.blastHits++;
    this.hz.wave({
      x: a.x, y: this.floor, z: a.z, speed: BurnDives.RingSpeed, maxRadius: BurnDives.RingRadius, damage: this.dmg(BurnDives.RingDamage), color: QilinDef.Warn,
      startRadius: 2, width: 1, height: 0.85, knockback: 6, element: 'fire', dust: QilinDef.Ember, spare: hit,
    });
    const fx = this.ctx.fx;
    fx.explosion(_b.set(a.x, this.floor + 0.6, a.z), 4, QilinDef.Fire);
    fx.burst(_b, QilinDef.Hot, 30, 9, 0.7, 0.35, 8);
    fx.burst(_b.set(a.x, this.floor + 0.3, a.z), 0x5a2a20, 18, 6, 1, 0.5, 3);
    q.quake(0.65, 0.45);
    this.sfx('boss_slam');
  }

  protected override onEnd(cancelled: boolean): void {
    this.leg = 'done';
    const q = this.q;
    q.accel = SKY.Accel;
    if (!cancelled && q.holdGround) return;
    q.holdGround = false;
    q.skyTarget = SKY.Alt;
  }
}

// ───────────────────────────── 焚身 · 落地喘息 ─────────────────────────────

/**
 * 落地喘息（Unity BurnPant）：只在踏云俯冲三踏之后排上。降落 0.8 s（落点 = 脚下最近的能站的地面，亮 5 m 预警圈）；落地 5 m 内 16 + 掀开；
 * 喘 3.5 s——胸口火心大亮，角根火珠也亮；起飞前 0.8 s 脚下亮 6 m 预警圈 → 起飞：6 m 内 12（火）+ 击退，回到 4.5 m 踏云。
 */
export class PantMove extends QilinMove {
  readonly spot = new THREE.Vector3();
  landed = 0;
  takeoffs = 0;
  private readonly from = new THREE.Vector3();

  override weightNow(): number {
    return 0;
  }

  protected override prepare(): void {
    this.from.copy(this.q.position);
    this.q.landingSpot(this.from, this.spot);
    this.q.skyTarget = 0;
  }

  protected override onTelegraph(): void {
    this.warnCircle(this.spot, BurnPant.LandRadius, this.windupTime);
    this.act('stomp', this.windupTime / BurnDives.StompHitAt, 0.08);
  }

  protected override onWindup(dt: number): void {
    const k = Math.min(1, Math.max(0, this.stageT / Math.max(0.05, this.windupTime)));
    _a.lerpVectors(this.from, this.spot, easeInOut(k));
    _a.y = this.from.y + (this.spot.y - this.from.y) * k * k;
    this.q.skyPlace(_a);
    this.turnToward(this.yawToPlayer, 120, dt);
  }

  protected override onActiveBegin(): void {
    const q = this.q, s = this.spot;
    q.skyPlace(s);
    q.skyTarget = 0;
    q.heartBright = true;
    this.landed++;
    this.act('pant', this.active);
    this.hz.blast(s.x, this.floor, s.z, BurnPant.LandRadius, this.dmg(BurnPant.LandDamage), { maxHeight: 3, knockback: 8, knockUp: 4 });
    this.ctx.fx.ring(_a.set(s.x, this.floor + 0.1, s.z), BurnPant.LandRadius * 1.6, QilinDef.Warn, 0.6);
    this.ctx.fx.burst(_a.set(s.x, this.floor + 0.4, s.z), QilinDef.Fire, 24, 7, 0.7, 0.4, 3);
    q.quake(0.45, 0.35);
    this.sfx('boss_slam', 1, 1.1);
    q.tell('pant', '焚身落地喘息——胸口火心大亮，现在是输出时机！', '#ffe08a');
  }

  protected override onActive(dt: number): void {
    this.q.skyTarget = 0;
    this.q.hover();
    this.turnToward(this.yawToPlayer, 34, dt);
    if (this.stageAt(Math.max(0, this.active - BurnPant.TakeoffWarn))) {
      this.warnCircle(this.q.position, BurnPant.TakeoffRadius, BurnPant.TakeoffWarn);
      this.sfx('telegraph', 1, 1.1);
    }
  }

  protected override onRecoverBegin(): void {
    const q = this.q, p = q.position;
    q.heartBright = false;
    q.skyTarget = SKY.Alt;
    this.takeoffs++;
    this.act('tuck', this.recover);
    this.hz.blast(p.x, this.floor, p.z, BurnPant.TakeoffRadius, this.dmg(BurnPant.TakeoffDamage), { maxHeight: 4, knockback: 12, knockUp: 5, element: 'fire' });
    this.ctx.fx.ring(_a.set(p.x, this.floor + 0.1, p.z), BurnPant.TakeoffRadius * 1.3, QilinDef.Warn, 0.5);
    this.ctx.fx.burst(_a.set(p.x, this.floor + 0.5, p.z), QilinDef.Fire, 20, 7, 0.6, 0.4, 2);
    this.sfx('boss_roar', 0.8, 1.3);
  }

  protected override onRecover(_dt: number): void {
    this.q.hover();
  }

  protected override onEnd(_cancelled: boolean): void {
    this.q.heartBright = false;
    this.q.skyTarget = SKY.Alt;
  }
}

// ───────────────────────────── 焚身 · 麟火扫象限 ─────────────────────────────

/**
 * 麟火扫象限（Unity BurnSweep）：飞到熔池对岸（3 m 高、20 m/s，≤ 2.2 s），落地；扇形预警在起飞那一刻就画出来（时长 = 估计飞行 + 蓄势）；
 * 蓄势 1.2 s 转向起扫的一侧（离玩家远的那条渠）；吐息 2.6 s：一道窄火（半角 8.6°）匀速扫满象限，每 0.15 s 判一次 → 9（火）；石柱和池中的倒鼎挡得住。
 */
export class SweepMove extends QilinMove {
  quadrant = -1;
  readonly spot = new THREE.Vector3();
  yaw0 = 0;
  yaw1 = 0;
  range = 24;
  ticks = 0;
  hits = 0;
  blocked = 0;
  swept = 0;
  private acc = 0;
  private lastYaw = 0;
  private arrived = false;
  private firing = false;
  private warnCancel: (() => void) | null = null;

  protected override prepare(): void {
    this.arrived = this.firing = false;
    this.acc = 0;
    this.swept = 0;
    const f = this.f, pl = this.ctx.player.position;
    this.quadrant = f.quadrantOf(pl);
    const plan = sweepPlan(f, this.quadrant, pl);
    this.q.landingSpot(plan.spot, this.spot);
    this.yaw0 = plan.yaw0;
    this.yaw1 = plan.yaw1;
    this.range = plan.range;
    this.q.skyTarget = BurnSweep.ApproachAlt;
  }

  private get warnMid(): number {
    return this.yaw0 + deltaAngle(this.yaw0, this.yaw1) * 0.5;
  }

  private get warnHalf(): number {
    return Math.abs(deltaAngle(this.yaw0, this.yaw1)) * 0.5 + BurnSweep.WarnPad;
  }

  protected override onTelegraph(): void {
    this.act('Locomotion', 0);
    this.sfx('boss_roar', 0.7, 1.2);
    const off = Math.hypot(this.spot.x - this.q.position.x, this.spot.z - this.q.position.z);
    const eta = Math.min(BurnSweep.ApproachMax, Math.max(BurnSweep.ApproachMax - BurnSweep.Tele, off / BurnSweep.ApproachSpeed + 0.25));
    this.warn(eta + BurnSweep.Tele);
  }

  private warn(seconds: number): void {
    this.warnCancel?.();
    const s = this.spot;
    this.warnCancel = this.hz.sectorWarning(s.x, this.floor, s.z, this.warnMid * DEG, this.warnHalf * DEG, this.range, seconds, QilinDef.Warn);
    this.countWarning();
  }

  protected override get windupDone(): boolean {
    return this.arrived || this.stageT >= BurnSweep.ApproachMax;
  }

  protected override onWindup(dt: number): void {
    this.q.skyTarget = BurnSweep.ApproachAlt;
    this.arrived = this.q.flyTo(this.spot, BurnSweep.ApproachSpeed, 1.2);
    this.turnToward(this.yawTo(this.spot), 230, dt);
  }

  protected override onActiveBegin(): void {
    this.q.skyTarget = 0;
    this.q.brake(0.3);
    // 网页的地面预警不能改时长：落地时按蓄势时长重画（前摇里画的那一张撤掉）
    this.warn(BurnSweep.Tele);
    this.act('breath', BurnSweep.Tele + BurnSweep.SweepTime);
    this.sfx('enemy_charge', 1, 0.5);
    this.q.tell('sweep', '焚身要吐息扫过整个象限——躲到石柱或池中倒鼎的后面！', '#ff9a4a');
  }

  protected override onActive(dt: number): void {
    const q = this.q;
    q.skyTarget = 0;
    q.flyTo(this.spot, 8, 0.4);
    if (this.stageT < BurnSweep.Tele) {
      this.turnToward(this.yaw0, 229, dt);
      if (Math.random() < dt * 30) {
        const m = q.mouthPoint(_a);
        _b.set(this.rng(-2.6, 2.6), this.rng(-1.3, 2), this.rng(-2.6, 2.6));
        q.fx?.emit(_c.copy(m).add(_b), _b.multiplyScalar(-2.5), 0.4, 0.22, QilinDef.Hot, 0, 0);
      }
      return;
    }
    if (!this.firing) {
      this.firing = true;
      this.lastYaw = this.yaw0;
      this.setFacing(this.yaw0);
      this.sfx('skill_fire', 1, 0.6);
      this.ctx.fx.burst(q.mouthPoint(_a), QilinDef.Hot, 18, 6, 0.3, 0.35, 0);
    }
    const k = Math.min(1, Math.max(0, (this.stageT - BurnSweep.Tele) / BurnSweep.SweepTime));
    const yaw = this.yaw0 + deltaAngle(this.yaw0, this.yaw1) * k;
    this.swept += Math.abs(deltaAngle(this.lastYaw, yaw));
    this.lastYaw = yaw;
    this.setFacing(yaw);
    if (k < 1) {
      const r = q.breatheAlong(yaw, BurnSweep.HalfBeam, this.range, this.dmg(BurnSweep.TickDamage), dt, this, 0.15, true);
      if (r) {
        this.ticks++;
        if (r === 'hit') this.hits++;
        else if (r === 'blocked') this.blocked++;
      }
    } else q.endBeam();
  }

  tick(dt: number): boolean {
    this.acc += dt;
    if (this.acc < BurnSweep.TickEvery) return false;
    this.acc = 0;
    return true;
  }

  protected override onEnd(_cancelled: boolean): void {
    this.q.endBeam();
    this.warnCancel = null;
    this.q.skyTarget = SKY.Alt;
  }
}

// ───────────────────────────── 焚身 · 火云雨 + 神火飞鸦 ─────────────────────────────

/**
 * 火云雨（Unity BurnRain）：升到 7.5 m 悬停长啸 0.7 s；然后顶上落下 10 颗火球（狂怒 14，每 0.16 s 一颗）：前三颗砸玩家 0.5 / 0.75 / 1 s 后的位置，
 * 其余落在玩家身边 2.5–10.5 m，每颗从落点上方 22 m 坠下 1.25 s、落点亮 2.4 m 预警圈，砸中 18（火）+ 掀开；0.3 s 后高处排烟口飞出 4 只神火飞鸦。
 * 与 Unity 的差异：Unity 的落点圈在前摇一开始就全部亮出、跟着玩家挪；网页的地面预警不能挪，落点圈在每颗放出时画（同 Three.js 原版）。
 */
export class RainMove extends QilinMove {
  meteorsFired = 0;
  crows = 0;
  private readonly offsets: { a: number; r: number }[] = [];

  protected override prepare(): void {
    this.q.skyTarget = SKY.High;
  }

  protected override onTelegraph(): void {
    this.act('roar', this.windupTime + this.active);
    this.sfx('telegraph', 1, 1.2);
    this.sfx('boss_roar', 0.7, 1.1);
    this.q.fireClouds(this.windupTime + this.active + BurnRain.FallTime + 0.6);
    this.offsets.length = 0;
    const n = this.q.enraged ? BurnRain.MeteorsRage : BurnRain.Meteors;
    for (let k = 0; k < n; k++) this.offsets.push(k < 3 ? { a: 0, r: 0 } : { a: this.rng(0, Math.PI * 2), r: 2.5 + this.rng(0, 8) });
    this.countWarning();
  }

  /** 第 k 颗此刻放出的落点 */
  private targetFor(k: number, out: THREE.Vector3): THREE.Vector3 {
    const q = this.q, f = this.f;
    if (k < 3 || k >= this.offsets.length) q.predict(0.5 + Math.min(k, 2) * 0.25, out);
    else {
      const o = this.offsets[k], p = this.ctx.player.position;
      out.set(p.x + Math.sin(o.a) * o.r, 0, p.z + Math.cos(o.a) * o.r);
    }
    out.y = this.floor;
    const max = f.wallRadius - 1;
    if (f.radiusOf(out) > max) f.point(f.yawOf(out), max, out);
    return out;
  }

  protected override onWindup(dt: number): void {
    this.hold(dt);
  }

  protected override onActiveBegin(): void {
    this.fireRain();
  }

  protected override onActive(dt: number): void {
    this.hold(dt);
    if (this.stageAt(BurnRain.CrowsAt)) this.crows += this.q.summonCrows(this.q.qdef.rainCrows);
  }

  private hold(dt: number): void {
    this.q.skyTarget = SKY.High;
    this.q.hover();
    this.turnToward(this.yawToPlayer, 115, dt);
  }

  private fireRain(): void {
    const q = this.q;
    const n = q.enraged ? BurnRain.MeteorsRage : BurnRain.Meteors;
    const dmg = this.dmg(BurnRain.Damage);
    const floor = this.floor;
    for (let i = 0; i < n; i++) {
      const k = i;
      this.hz.later(k * BurnRain.Every, () => {
        if (!q.alive) return;
        while (this.offsets.length <= k) this.offsets.push({ a: this.rng(0, Math.PI * 2), r: 2.5 + this.rng(0, 8) });
        const to = this.targetFor(k, new THREE.Vector3());
        const from = new THREE.Vector3(to.x + this.rng(-4, 4), floor + BurnRain.Height, to.z + this.rng(-4, 4));
        this.hz.lob({ from, to, time: BurnRain.FallTime, arc: 1, radius: BurnRain.Radius, damage: dmg, color: QilinDef.Warn, kind: 'meteor', element: 'fire', scale: 1.1 });
        this.meteorsFired++;
      });
    }
    q.quake(0.3, 0.4);
    this.sfx('boss_roar', 0.7, 1.1);
    q.tell('rain', '火云雨——看地上的落点圈走位', '#ff9a4a');
  }

  protected override onEnd(_cancelled: boolean): void {
    this.q.skyTarget = SKY.Alt;
  }
}

// ───────────────────────────── 焚身 · 狂怒长啸 ─────────────────────────────

/**
 * 狂怒长啸（Unity BurnRage，Three.js 没有）：生命层跌破 15% 时排上，只出一次。飞到熔池上空靠玩家一侧 7.5 m 高人立长啸 1.3 s（池边亮一圈预警环、熔岩柱涌起）
 * → 熔岩柱冲天，一圈火浪从池边扫到殿墙（14 m/s，14（火）+ 击退，跳起来躲）；熔流从玩家所在的象限重新开闸，之后按狂怒的数值轮（涨 4 s、隔 0.3 s）。
 */
export class RageMove extends QilinMove {
  waves = 0;

  override weightNow(): number {
    return 0;
  }

  protected override prepare(): void {
    this.q.skyTarget = SKY.High;
  }

  protected override onTelegraph(): void {
    const f = this.f;
    // 火浪的起点：池边一圈亮起来（网页没有环形贴花：池沿外 1.6 m 的圆形预警盖住起点那一圈）
    this.warnCircle(f.center, f.poolRadius + 1.6, this.windupTime);
    this.act('rear', this.windupTime, 0.08);
    this.sfx('boss_roar', 1, 0.75);
    this.q.quake(0.5, this.windupTime);
    this.q.tell('rage', '焚身狂怒——火浪要从熔池扫过整座殿，跳起来躲！熔流轮转也更快了', '#ff7a4a');
  }

  protected override get windupDone(): boolean {
    return this.cue('hit', this.windupTime);
  }

  protected override onWindup(dt: number): void {
    const q = this.q;
    q.skyTarget = SKY.High;
    q.flyTo(q.poolEdgeToward(this.ctx.player.position, _a), 16, 1.5);
    q.fx?.eruption(0.3 + 0.5 * Math.min(1, this.stageT / Math.max(0.05, this.windupTime)));
    this.turnToward(this.yawToPlayer, 115, dt);
  }

  protected override onActiveBegin(): void {
    const q = this.q, f = this.f;
    const c = f.center;
    const start = f.poolRadius, end = f.wallRadius + 1;
    this.hz.wave({
      x: c.x, y: this.floor, z: c.z, speed: BurnRage.WaveSpeed, maxRadius: end, damage: this.dmg(BurnRage.WaveDamage), color: QilinDef.Warn,
      startRadius: start, width: 1.1, height: 0.95, knockback: 7, element: 'fire', dust: QilinDef.Ember,
    });
    this.waves++;
    q.fx?.eruption(1);
    q.rageRoars++;
    q.flood?.start(f.quadrantOf(this.ctx.player.position), true);
    this.ctx.fx.burst(_a.set(c.x, this.floor + 1, c.z), QilinDef.Fire, 60, 14, 1.2, 0.45, 8);
    this.ctx.fx.explosion(_a.set(c.x, this.floor + 2, c.z), 5, QilinDef.Fire);
    this.ctx.audio.play('explosion', { position: c, volume: 1, pitch: 0.55 });
    q.quake(0.8, 0.6);
  }

  protected override onActive(_dt: number): void {
    this.q.hover();
  }

  protected override onEnd(_cancelled: boolean): void {
    this.q.fx?.eruption(0);
    this.q.skyTarget = SKY.Alt;
  }
}

export function createQilinMove(q: Qilin, id: string): BossMove | null {
  const spec = q.qdef.move(id);
  if (!spec) return null;
  switch (id) {
    case ScaleGallop.id: return new GallopMove(spec, q);
    case ScaleBlades.id: return new ScalesMove(spec, q);
    case ScaleBreath.id: return new BreathMove(spec, q);
    case ScaleDrink.id: return new DrinkMove(spec, q);
    case BurnFlood.id: return new FloodMove(spec, q);
    case BurnDives.id: return new DivesMove(spec, q);
    case BurnPant.id: return new PantMove(spec, q);
    case BurnSweep.id: return new SweepMove(spec, q);
    case BurnRain.id: return new RainMove(spec, q);
    case BurnRage.id: return new RageMove(spec, q);
  }
  return null;
}
