/**
 * 蜃楼蟾（mirage_toad，第一章 · 赤沙古道的炮击怪）：背驮半座倒塌佛塔的沙漠巨蟾。
 * 跳跃移动，保持 13–26 米；鼓起喉囊 1 秒（喉囊发光胀大、地面预警）后吐出一枚抛物线日火球（精英两枚），
 * 落点爆炸。可以越过掩体曲射（24 米内不需要视线）。
 * 每 13–17 秒投出两只蜃景分身（精英三只）：外形相同但半透明闪烁，血量很低，吐的火球是幻影（半路消散、不伤人），
 * 10 秒后或本体死亡时消散，不掉落。喉囊是弱点（头部判定）。
 *
 * 状态机：move → puff → spit → recover → move
 *          move → mirage → recover → move
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, EnemyDef, GameContext, IEnemy, SpawnOptions } from '../../core/types';
import { ballisticVelocity, clamp, clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import { boneHull, type NativeBody, type NativePose } from '../../assets/NativeRig';
import { Geo, flat, joint, part } from '../Models';
import { launchMirageFireball } from '../fx/MirageFireball';

export const MIRAGE_TOAD_DEF: EnemyDef = {
  id: 'mirage_toad',
  name: '蜃楼蟾',
  hp: 170,
  speed: 2.6,
  radius: 1.0,
  // 含背上佛塔（塔刹顶离地约 3.05）：打中佛塔算身体
  height: 3.0,
  damage: 24,
  coins: [3, 5],
  essence: 1,
  // 弱点 = 下颌的喉囊（球心离地 0.78，半径 0.42）；判定球跟着喉囊移动
  headY: 0.78,
  headRadius: 0.42,
  knockbackResist: 0.7,
  color: 0xffd27a,
};

/** 蜃景分身：同一具身体（共用美术），血量很低、不掉落、只会虚张声势 */
export const MIRAGE_TOAD_DECOY_DEF: EnemyDef = {
  ...MIRAGE_TOAD_DEF,
  id: 'mirage_toad_decoy',
  name: '蜃景',
  hp: 30,
  coins: [0, 0],
  essence: 0,
  knockbackResist: 0.3,
};

const MIN_RANGE = 13;
const MAX_RANGE = 26;
/** 不需要视线的曲射距离 */
const BLIND_FIRE_RANGE = 24;
const PUFF_TIME = 1.0;
const BALL_GRAVITY = 16;
const BALL_RADIUS = 3.2;
const MIRAGE_CHANNEL = 0.8;
const DECOY_LIFE = 10;
const BODY_Y = 0.78;
/** 一次跳跃的时长（秒）：蹲伏蓄力 → 蹬地腾空 → 落地缓冲 → 站稳 */
const HOP_TIME = 0.95;
/** 只在腾空段前进：腾空时的移速倍率与着地时的残余倍率（整段平均约等于 1） */
const HOP_AIR = [0.3, 0.68] as const;
const HOP_AIR_SPEED = 2.3;
const HOP_GROUND_SPEED = 0.2;
/** 美术喉囊半径（米，管线拟合值），白模喉囊发光件按它放大 */
const ART_SAC_RADIUS = 0.55;
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/** 二阶弹簧（佛塔、幡的惯性摆动） */
class Spring {
  x = 0;
  v = 0;
  constructor(private readonly k: number, private readonly d: number) {}
  step(target: number, dt: number): number {
    const h = Math.min(dt, 1 / 30);
    this.v += (this.k * (target - this.x) - this.d * this.v) * h;
    this.x += this.v * h;
    return this.x;
  }
}

/** 鼓囊前摇时喉囊的最大放大量（白模 / 原生骨架美术） */
const SAC_SWELL = 0.65;
const NATIVE_SAC_SWELL = 0.32;

const C = {
  skin: 0xc9a46a, belly: 0xe2cc98, spot: 0x4f9e92, toe: 0xb08850,
  brick: 0xa4785a, roof: 0x4f8f7e, bronze: 0x9a7a3a, cloth: 0xa8443a,
  eye: 0xffb02a, eyeHot: 0xfff0b0, sac: 0xc88a3a, sacHot: 0xfff2c0,
};

const _mouth = new THREE.Vector3();
const _target = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _foot = new THREE.Vector3();
const _plant = new THREE.Vector3();

interface Leg {
  pivot: THREE.Group;
  foot: THREE.Group | null;
  side: number;
  hind: boolean;
}

export class MirageToad extends StandardEnemy {
  protected body!: THREE.Group;
  protected head!: THREE.Group;
  protected jaw!: THREE.Group;
  protected sac!: THREE.Group;
  protected pagoda!: THREE.Group;
  private readonly legs: Leg[] = [];
  private sacGlow!: THREE.Mesh;
  private readonly eyeGlows: THREE.Mesh[] = [];
  /** 跳跃相位 0..1（0 = 站立；移动时循环） */
  private hopPhase = 0;
  private readonly prevVel = new THREE.Vector3();
  private readonly pagodaX = new Spring(60, 7);
  private readonly pagodaZ = new Spring(60, 7);
  private readonly bannerX = new Spring(26, 3.2);
  private readonly bannerZ = new Spring(26, 3.2);
  /** 背旗骨骼 → 轮廓点（骨骼局部，见 afterInit） */
  private readonly bannerHull = new Map<string, THREE.Vector3[]>();
  private windTime = PUFF_TIME;
  /** 鼓囊聚火粒子的节拍累加器 */
  private chargeAcc = 0;
  private recoverTime = 0.8;
  private spitAge = Infinity;
  private shots = 0;
  private mirageCd: number;
  private readonly decoys: MirageToadDecoy[] = [];

  constructor(ctx: GameContext, opts: SpawnOptions, def: EnemyDef = MIRAGE_TOAD_DEF) {
    super(ctx, def, opts);
    this.walkScale = 1;
    this.stepRate = 1.1;
    // 跳着走：落地要很快刹住，不然每跳之间会滑行
    this.accel = 22;
    this.mirageCd = ctx.rng.range(4, 6);
  }

  protected override afterInit(): void {
    // 美术身体的喉囊和眼睛本身就画成发光的：白模发光件只在鼓囊前摇时叠加，平时不遮挡美术
    if (this.hasArtBody) this.glowsAsOverlay();
    const sacBone = this.nativeBody?.pose.bone('sac');
    if (sacBone) {
      // 原生骨架：弱点判定与鼓囊发光跟着美术的喉囊骨骼；白模的眼睛发光件对不上美术的眼睛，收起
      sacBone.add(this.sacGlow);
      this.sacGlow.position.set(0, 0, 0);
      this.sacGlow.scale.setScalar(ART_SAC_RADIUS / 0.42 * 0.9);
      this.setHeadAnchor(sacBone, 0, 0, 0);
      for (const g of this.eyeGlows) g.visible = false;
      // 有美术发光壳时（贴合喉囊表面、带喉囊花纹），白模的发光球不再显示
      if (this.nativeBody?.glowShell) this.sacGlow.visible = false;
    }
    // 背旗末两节的轮廓点（近似凸包）：身体侧倾 / 落地压低时旗角会扫进地面，每帧贴地保护只检查这些点
    if (this.nativeBody) {
      for (const side of ['L', 'R']) {
        for (const i of [2, 3]) this.bannerHull.set(`banner_${side}${i}`, boneHull(this.nativeBody, `banner_${side}${i}`));
      }
    }
  }

  /** 只在跳跃的腾空段前进（整段平均移速不变） */
  override get speed(): number {
    const airborne = this.hopPhase >= HOP_AIR[0] && this.hopPhase < HOP_AIR[1];
    return super.speed * (airborne ? HOP_AIR_SPEED : HOP_GROUND_SPEED);
  }

  /** 分身没有幻术，也不吐真火 */
  protected get isDecoy(): boolean {
    return false;
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const skin = flat(C.skin), belly = flat(C.belly), spot = flat(C.spot), toe = flat(C.toe);
    // 身体：压扁的球体，前低后高
    const body = joint(root, 0, BODY_Y, 0);
    this.body = body;
    const torso = part(body, Geo.ico(0.82, 1), skin, 0, 0.12, -0.12);
    torso.scale.set(1.0, 0.72, 1.18);
    const under = part(body, Geo.ico(0.66, 1), belly, 0, -0.18, 0.1);
    under.scale.set(1.05, 0.55, 1.05);
    for (const [x, y, z, r] of [[0.42, 0.5, -0.3, 0.13], [-0.5, 0.42, 0.05, 0.11], [0.3, 0.32, 0.45, 0.1], [-0.25, 0.55, -0.55, 0.12], [0.6, 0.15, 0.1, 0.1]]) {
      part(body, Geo.ico(r, 0), spot, x, y, z);
    }
    // 头：宽扁的蟾蜍脸，眼睛鼓在头顶
    const head = joint(body, 0, 0.18, 0.78);
    this.head = head;
    const skull = part(head, Geo.ico(0.5, 1), skin, 0, 0.06, 0.05);
    skull.scale.set(1.25, 0.6, 0.95);
    for (const s of [1, -1]) {
      part(head, Geo.ico(0.15, 0), skin, s * 0.36, 0.3, 0.1);
      this.eyeGlows.push(this.glowPart(head, Geo.ico(0.1, 0), C.eye, C.eyeHot, s * 0.38, 0.33, 0.2, 1));
    }
    // 下颌（吐火时张开）与喉囊（弱点）
    const jaw = joint(head, 0, -0.08, 0.02);
    this.jaw = jaw;
    const chin = part(jaw, Geo.ico(0.44, 1), belly, 0, -0.06, 0.12);
    chin.scale.set(1.2, 0.35, 0.95);
    const sac = joint(jaw, 0, -0.26, 0.12);
    this.sac = sac;
    this.sacGlow = this.glowPart(sac, Geo.ico(0.42, 2), C.sac, C.sacHot, 0, 0, 0, 0);
    this.setHeadAnchor(sac, 0, 0, 0);
    // 四条腿：前腿短直，后腿粗大（跳跃时蹬直）
    for (const s of [1, -1]) {
      const front = joint(body, s * 0.62, -0.2, 0.55);
      part(front, Geo.box(0.26, 0.62, 0.26, 'top'), skin, 0, 0, 0, 0, 0, s * 0.25);
      part(front, Geo.box(0.42, 0.08, 0.4), toe, s * 0.14, -0.58, 0.12);
      this.legs.push({ pivot: front, foot: null, side: s, hind: false });
      const hind = joint(body, s * 0.7, -0.05, -0.45);
      const thigh = part(hind, Geo.ico(0.36, 1), skin, s * 0.12, -0.12, 0.05);
      thigh.scale.set(0.9, 0.85, 1.35);
      const foot = joint(hind, s * 0.2, -0.62, 0.3);
      part(foot, Geo.box(0.5, 0.09, 0.58), toe, 0, -0.08, 0.1);
      this.legs.push({ pivot: hind, foot, side: s, hind: true });
    }
    // 背上半座倒塌的佛塔：塔基、两层塔身、飞檐、塔刹，挂着铜铃和破幡
    const pagoda = joint(body, 0, 0.62, -0.3);
    this.pagoda = pagoda;
    const brick = flat(C.brick), roof = flat(C.roof), bronze = flat(C.bronze, { metal: 0.5, rough: 0.5 });
    part(pagoda, Geo.box(0.78, 0.3, 0.7, 'bottom'), brick, 0, -0.08, 0, 0.08, 0, -0.06);
    part(pagoda, Geo.box(0.58, 0.42, 0.52, 'bottom'), brick, 0, 0.22, 0);
    part(pagoda, Geo.cone(0.6, 0.2, 4), roof, 0, 0.72, 0, 0, Math.PI / 4, 0);
    part(pagoda, Geo.box(0.42, 0.34, 0.38, 'bottom'), brick, 0, 0.8, 0);
    part(pagoda, Geo.cone(0.46, 0.18, 4), roof, 0, 1.22, 0, 0, Math.PI / 4, 0);
    part(pagoda, Geo.cyl(0.04, 0.06, 0.38, 6, 'bottom'), bronze, 0, 1.3, 0);
    for (const [x, z] of [[0.42, 0.38], [-0.42, 0.38], [0.42, -0.38], [-0.42, -0.38]]) {
      part(pagoda, Geo.cone(0.07, 0.14, 6), bronze, x, 0.56, z);
    }
    for (const s of [1, -1]) part(pagoda, Geo.box(0.16, 0.7, 0.03, 'top'), flat(C.cloth), s * 0.36, 0.62, -0.3, 0.1, 0, s * 0.15);
    return root;
  }

  protected override ai(dt: number): void {
    const d = this.distToPlayerXZ();
    this.spitAge += dt;
    if (!this.isDecoy && this.mirageCd > 0) this.mirageCd -= dt;
    switch (this.state) {
      case 'chase':
      case 'move': {
        this.glowTarget[0] = 0.2 + 0.1 * Math.sin(this.age * 2.4);
        const canLob = this.sees || d <= BLIND_FIRE_RANGE;
        if (!this.isDecoy && this.mirageCd <= 0 && this.sees && d <= MAX_RANGE + 6) {
          this.setState('mirage');
          this.ctx.audio.play('telegraph', { position: this.position, volume: 0.6, pitch: 1.4 });
          break;
        }
        if (!canLob && this.seekSight(MIN_RANGE - 3, MAX_RANGE, this.speed)) {
          this.faceMovement(4, dt);
          break;
        }
        this.keepRange(MIN_RANGE, MAX_RANGE, d < 7 ? this.speed * 1.4 : this.speed, 0.45);
        this.facePlayer(3, dt);
        if (this.cooldown <= 0 && canLob && d >= 5 && d <= 32) {
          if (this.isDecoy || this.requestAttack('heavy', PUFF_TIME + 1.2)) {
            this.windTime = this.windup(PUFF_TIME, 0.6);
            this.setState('puff');
            this.ctx.audio.play('telegraph', { position: this.position, volume: 0.75, pitch: 0.55 });
          } else {
            this.cooldown = this.ctx.rng.range(0.5, 1.0);
          }
        }
        break;
      }
      case 'puff': {
        this.stopMoving();
        this.facePlayer(4, dt);
        const charge = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.3 + 0.7 * charge;
        // 嘴前聚火：越接近吐出火星越密、越亮（幻影只有零星冷光）
        this.chargeAcc += dt * (4 + charge * 22);
        if (this.chargeAcc >= 1) {
          this.chargeAcc = 0;
          this.getMuzzle(_mouth);
          const k = this.sizeScale;
          if (this.isDecoy) this.ctx.fx.burst(_mouth, 0xd8f0ff, 1, 0.4, 0.25, 0.1 * k, 0);
          else {
            this.ctx.fx.burst(_mouth, charge > 0.7 ? 0xfff0c0 : 0xffb040, 2, 0.3 + charge * 0.6, 0.22, (0.1 + charge * 0.16) * k, -0.5);
            if (charge > 0.5) this.ctx.fx.burst(_mouth, 0xff7a20, 1, 1.6, 0.35, 0.05 * k, -2);
          }
        }
        if (this.stateTime >= this.windTime) {
          this.shots = 0;
          this.setState('spit');
        }
        break;
      }
      case 'spit': {
        this.stopMoving();
        this.facePlayer(4, dt);
        this.glowTarget[0] = 1;
        const count = this.isElite && !this.isDecoy ? 2 : 1;
        if (this.shots < count && this.stateTime >= this.shots * 0.32) {
          this.spit(this.shots);
          this.shots++;
        }
        if (this.shots >= count) {
          this.recoverTime = 0.7;
          this.setState('recover');
        }
        break;
      }
      case 'mirage': {
        this.stopMoving();
        this.glowTarget[0] = 0.6 + 0.4 * Math.sin(this.stateTime * 30);
        if (this.stateTime >= MIRAGE_CHANNEL) {
          this.castMirage();
          this.mirageCd = this.ctx.rng.range(13, 17);
          this.recoverTime = 0.4;
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        this.facePlayer(2.5, dt);
        this.glowTarget[0] = 0.2;
        if (this.stateTime >= this.recoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          if (this.cooldown <= 0.5) this.rollCooldown(3.5, 5);
          this.setState('move');
        }
        break;
      }
      default:
        this.setState('move');
    }
  }

  /** 张嘴点（世界坐标）：喉囊上方、嘴巴前沿 */
  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    const sacBone = this.nativeBody?.pose.bone('sac');
    if (!sacBone) return this.jaw.localToWorld(out.set(0, 0.05, 0.55));
    sacBone.getWorldPosition(out);
    const k = this.sizeScale;
    out.x += Math.sin(this.facing) * 0.4 * k;
    out.z += Math.cos(this.facing) * 0.4 * k;
    out.y += 0.4 * k;
    return out;
  }

  private spit(index: number): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    this.root.updateMatrixWorld(true);
    this.getMuzzle(_mouth);
    const dist = Math.hypot(pl.position.x - _mouth.x, pl.position.z - _mouth.z);
    const T = clamp(1.2 + (dist / 30) * 0.6, 1.2, 1.8);
    _target.set(pl.position.x + pl.velocity.x * T * 0.45, pl.position.y, pl.position.z + pl.velocity.z * T * 0.45);
    if (index > 0) {
      const a = ctx.rng.range(0, Math.PI * 2), r = ctx.rng.range(2.5, 4);
      _target.x += Math.cos(a) * r;
      _target.z += Math.sin(a) * r;
    }
    const gy = ctx.world.groundHeight(_target.x, _target.z, pl.position.y + 1);
    _target.y = Number.isFinite(gy) ? gy : pl.position.y;
    const h = Math.hypot(_target.x - _mouth.x, _target.z - _mouth.z);
    ballisticVelocity(_mouth, _target, Math.max(1, h / T), BALL_GRAVITY, _vel);
    // 蜃火珠（真 / 幻影）：弹道、碰撞、预警、爆炸与余火都在 MirageFireball 里
    launchMirageFireball(ctx, {
      from: _mouth, velocity: _vel, gravity: BALL_GRAVITY, flightTime: T, target: _target,
      radius: BALL_RADIUS, damage: this.def.damage * this.damageMult, source: this,
      illusion: this.isDecoy, scale: this.sizeScale,
    });
    ctx.audio.play('shot_launcher', { position: _mouth, volume: 0.8, pitch: 0.55 });
    this.spitAge = 0;
  }

  /** 在身边投出蜃景分身（导航网格上的可走点） */
  private castMirage(): void {
    const ctx = this.ctx;
    this.pruneDecoys();
    const want = (this.isElite ? 3 : 2) - this.decoys.length;
    for (let i = 0; i < want; i++) {
      const a = this.facing + (i - (want - 1) / 2) * 1.9 + ctx.rng.range(-0.3, 0.3) + Math.PI / 2;
      const r = ctx.rng.range(4, 7);
      _pos.set(this.position.x + Math.sin(a) * r, this.position.y, this.position.z + Math.cos(a) * r);
      const at = new THREE.Vector3();
      if (!ctx.nav.nearestWalkable(_pos, at)) continue;
      const e = ctx.enemies.spawn(MIRAGE_TOAD_DECOY_DEF.id, { position: at, level: this.level });
      if (e instanceof MirageToadDecoy) {
        e.bindHost(this);
        this.decoys.push(e);
      }
      ctx.fx.burst(at.clone().setY(at.y + 0.8), 0xfff0c8, 14, 2.5, 0.6, 0.18, -0.5);
    }
    this.getBodyCenter(_pos);
    ctx.fx.ring(_pos.setY(this.position.y + 0.1), 7, 0xffe2a0, 0.6);
  }

  private pruneDecoys(): void {
    let n = 0;
    for (const d of this.decoys) if (d.alive) this.decoys[n++] = d;
    this.decoys.length = n;
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    for (const d of this.decoys) d.vanish();
    this.decoys.length = 0;
  }

  protected override cancelAttack(): void {
    // 鼓囊阶段还没有预警；已经吐出的火球照样落地，预警不撤（同重炮兵）
    if (this.state === 'puff' || this.state === 'spit' || this.state === 'mirage' || this.state === 'recover') {
      this.setState('move');
      this.rollCooldown(1.5, 2.5);
    }
  }

  protected override pose(dt: number): void {
    // 跳跃相位：想移动时循环；停下时把当前这一跳跳完再站定
    const wantsMove = Math.hypot(this.desiredX, this.desiredZ) > 0.05;
    if (wantsMove || this.hopPhase > 0) {
      this.hopPhase += dt / (HOP_TIME / Math.sqrt(Math.max(0.5, this.speedMult)));
      if (this.hopPhase >= 1) this.hopPhase = wantsMove ? this.hopPhase - 1 : 0;
    }
    if (this.nativeBody) {
      this.poseNative(this.nativeBody, dt);
      return;
    }
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const amp = Math.min(1, sp / 2);
    // 跳跃步态：每个周期一次腾起，后腿蹬直、前腿前探
    const hop = Math.max(0, Math.sin(this.walkPhase * 1.6)) * amp;
    const puffing = this.state === 'puff';
    const t = puffing ? clamp01(this.stateTime / this.windTime) : 0;
    const spitKick = Math.exp(-this.spitAge * 7);
    const breathe = Math.sin(this.age * 2.2) * 0.025;

    this.body.position.y = BODY_Y + hop * 0.32 + breathe * 0.5;
    this.body.rotation.x = -hop * 0.12 - this.hurtKick * 0.3 - t * 0.12 + spitKick * 0.1;
    this.body.scale.set(1 + breathe, 1 - breathe, 1 + breathe);
    this.head.rotation.x = -t * 0.22 - spitKick * 0.2;
    this.jaw.rotation.x = spitKick * 0.55 + (this.state === 'mirage' ? 0.25 : 0);
    const swell = 1 + t * SAC_SWELL + 0.05 * Math.sin(this.age * 5) - spitKick * 0.25;
    this.sac.scale.setScalar(Math.max(0.6, swell));
    for (const l of this.legs) {
      if (l.hind) {
        l.pivot.rotation.x = hop * 0.7;
        if (l.foot) l.foot.rotation.x = -hop * 0.5;
      } else {
        l.pivot.rotation.x = -hop * 0.45;
      }
      l.pivot.rotation.z = puffing ? -l.side * 0.08 * t : 0;
    }
    // 佛塔随跳跃滞后摇晃
    this.pagoda.rotation.x = hop * 0.08 + Math.sin(this.age * 1.7) * 0.02;
    this.pagoda.rotation.z = Math.sin(this.age * 1.3) * 0.025;
    if (this.stunTime > 0) this.body.rotation.z = Math.sin(this.age * 8) * 0.18;
    else this.body.rotation.z = Math.sin(this.walkPhase * 1.6) * 0.04 * amp;
    void dt;
  }

  /** 把一条腿的踝 / 腕按权重 w 拉回绑定位置（贴地），并保证不低于绑定高度 */
  private plantLeg(P: NativePose, upper: string, lower: string, end: string, w: number): void {
    const rest = P.restPosition(end);
    if (!rest) return;
    P.hostPosition(end, _foot);
    _plant.lerpVectors(_foot, rest, w);
    _plant.y = Math.max(_plant.y, rest.y);
    // 脚踝还没真正离地时脚掌保持平贴：美术后脚的脚蹼伸到踝前 0.6 米，蹬地时一点点前倾就会把脚趾压进地面
    const lifted = clamp01((_plant.y - rest.y) / 0.15);
    const flat = Math.max(w, 1 - lifted);
    if (_plant.distanceToSquared(_foot) < 1e-6 && flat <= w) return;
    P.twoBoneIK(upper, lower, end, _plant, flat);
  }

  /**
   * 原生骨架动画（Tripo 绑定 + 管线重整的语义骨骼）。模型空间：X = 蟾蜍左侧，Y = 上，Z = 前；
   * 绕 +X 正转 = 前端下压（低头）/ 腿向后摆，负转 = 抬头 / 腿向前伸。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    const h = this.hopPhase;
    const k = this.sizeScale;
    // 跳跃分段：蹲伏蓄力（0–0.3）→ 蹬地（0.3–0.55）→ 腾空（0.3–0.68）→ 落地缓冲（0.62–0.9）
    const crouch = h < 0.3 ? smooth(h / 0.3) : h < 0.4 ? 1 - smooth((h - 0.3) / 0.1) : 0;
    const push = h >= 0.3 && h < 0.55 ? Math.sin(Math.PI * (h - 0.3) / 0.25) : 0;
    const air = h >= HOP_AIR[0] && h < HOP_AIR[1] ? Math.sin(Math.PI * (h - HOP_AIR[0]) / (HOP_AIR[1] - HOP_AIR[0])) : 0;
    const land = h >= 0.62 && h < 0.9 ? Math.sin(Math.PI * (h - 0.62) / 0.28) : 0;
    const t = this.state === 'puff' ? clamp01(this.stateTime / this.windTime) : 0;
    const spit = Math.exp(-this.spitAge * 6);
    const squeeze = Math.exp(-this.spitAge * 11);
    const mirage = this.state === 'mirage' ? clamp01(this.stateTime / MIRAGE_CHANNEL) : 0;
    const breathe = Math.sin(this.age * 1.7);

    // 整体：腾空抬高、蹲伏 / 落地压低；起跳抬头、落地低头；受击后仰；眩晕摇晃
    P.translate('root', 0, (air * 0.55 - crouch * 0.16 - land * 0.12 + breathe * 0.012) * k, 0);
    P.rotate('hips', AX, -0.26 * push + 0.16 * land + 0.06 * crouch - 0.12 * t + 0.1 * spit - 0.28 * this.hurtKick);
    if (this.stunTime > 0) P.rotate('root', AZ, Math.sin(this.age * 8) * 0.14);
    P.rotate('chest', AX, breathe * 0.02 - 0.06 * t + 0.05 * squeeze);
    // 头：鼓囊时仰头，吐火瞬间向前一甩，施幻术时左右摆
    P.rotate('head', AX, -0.26 * t + 0.32 * spit - 0.14 * squeeze - 0.18 * this.hurtKick + 0.06 * land);
    P.rotate('head', AY, Math.sin(this.age * 9) * 0.16 * mirage + Math.sin(this.age * 0.7) * 0.05);
    // 喉囊：呼吸起伏，鼓囊胀大并抖动，吐出瞬间收缩，幻术时闪动
    // 美术喉囊本来就大：鼓起量比白模小，并向前下方鼓出（不往上盖住脸）
    const sac = 1 + 0.03 * Math.sin(this.age * 2.2) + t * NATIVE_SAC_SWELL + t * 0.035 * Math.sin(this.age * 30)
      - 0.28 * squeeze + 0.08 * mirage * Math.sin(this.age * 22);
    P.scale('sac', Math.max(0.65, sac), Math.max(0.65, sac * (1 - 0.1 * t)), Math.max(0.65, sac * (1 + 0.06 * t)));
    P.translate('sac', 0, -0.1 * t * k, 0.12 * t * k);

    for (const side of ['L', 'R']) {
      // 后腿：蹲伏时折叠，蹬地时整条腿向后伸直，腾空收拢，落地前探
      P.rotate(`thigh_${side}`, AX, -0.22 * crouch + 0.75 * push - 0.18 * air * (1 - push) - 0.12 * land);
      P.rotate(`shin_${side}`, AX, -0.25 * crouch + 0.55 * push - 0.1 * land);
      P.rotate(`foot_${side}`, AX, 0.45 * push - 0.1 * crouch);
      // 前腿：腾空向前探，落地撑住缓冲；鼓囊时撑地后仰
      P.rotate(`arm_${side}`, AX, -0.5 * air + 0.28 * land + 0.1 * crouch + 0.12 * t);
      P.rotate(`forearm_${side}`, AX, 0.2 * crouch - 0.3 * land + 0.15 * air);
      P.rotate(`hand_${side}`, AX, 0.35 * air - 0.15 * land);
    }

    // 落脚：着地段把四只脚钉在地上（两骨 IK，脚掌贴地）；离地段放开，但踝永远不低于绑定高度（不穿地）。
    // 后脚蹬地最晚离地、最晚落地；前脚先离地、先落地撑住
    const plantHind = h < 0.36 ? 1 : h < 0.44 ? 1 - smooth((h - 0.36) / 0.08) : h < 0.7 ? 0 : h < 0.78 ? smooth((h - 0.7) / 0.08) : 1;
    const plantFront = h < 0.3 ? 1 : h < 0.36 ? 1 - smooth((h - 0.3) / 0.06) : h < 0.62 ? 0 : h < 0.68 ? smooth((h - 0.62) / 0.06) : 1;
    for (const side of ['L', 'R']) {
      this.plantLeg(P, `thigh_${side}`, `shin_${side}`, `foot_${side}`, plantHind);
      this.plantLeg(P, `arm_${side}`, `forearm_${side}`, `hand_${side}`, plantFront);
    }

    // 弱点发光壳：平时微光呼吸，鼓囊前摇时随发光通道亮起
    if (n.glowShell) {
      const gl = this.glowLevel[0];
      n.glowShell.opacity = clamp01(0.05 + 0.03 * Math.sin(this.age * 2.4) + gl * gl * 0.5);
    }

    // 佛塔与幡：跟着身体加速度的惯性摆动（换算到模型空间的前后 / 左右加速度）
    const ax = dt > 0 ? (this.velocity.x - this.prevVel.x) / dt : 0;
    const az = dt > 0 ? (this.velocity.z - this.prevVel.z) / dt : 0;
    this.prevVel.copy(this.velocity);
    const sinF = Math.sin(this.facing), cosF = Math.cos(this.facing);
    const fwdAcc = ax * sinF + az * cosF;
    const sideAcc = ax * cosF - az * sinF;
    const pitchKick = 0.18 * land - 0.1 * push + 0.12 * spit;
    const px = this.pagodaX.step(-0.012 * fwdAcc + pitchKick, dt);
    const pz = this.pagodaZ.step(0.012 * sideAcc + Math.sin(this.age * 1.3) * 0.015, dt);
    P.rotate('pagoda', AX, px);
    P.rotate('pagoda', AZ, pz);
    const bx = this.bannerX.step(-0.03 * fwdAcc + 0.4 * pitchKick + 0.6 * air, dt);
    const bz = this.bannerZ.step(0.03 * sideAcc + Math.sin(this.age * 2.1) * 0.05, dt);
    for (const side of ['L', 'R']) {
      for (const [i, w] of [0.5, 0.35, 0.3].entries()) {
        P.rotate(`banner_${side}${i + 1}`, AX, -bx * w);
        P.rotate(`banner_${side}${i + 1}`, AZ, bz * w * (side === 'L' ? 1 : -1));
      }
    }
    // 旗角碰到地面就往外撩起（布料被地面顶开），不插进地里
    const groundY = this.onGround
      ? this.position.y
      : this.ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 0.01, this.radius * 0.5);
    if (groundY > this.position.y - 0.6) {
      const floor = P.hostHeight(groundY);
      for (const [name, hull] of this.bannerHull) P.liftAbove(name, hull, AZ, floor, name.includes('_L') ? 1 : -1);
    }
  }
}

/** 蜃景分身：半透明闪烁，一碰就散；本体死亡或 10 秒后自行消散（不掉落） */
export class MirageToadDecoy extends MirageToad {
  private host: IEnemy | null = null;
  private life = DECOY_LIFE;
  private vanished = false;
  private readonly fadeMats: THREE.Material[] = [];

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, opts, MIRAGE_TOAD_DECOY_DEF);
    this.deathDuration = 0.35;
  }

  protected override get isDecoy(): boolean {
    return true;
  }

  /** 与本体共用美术资产 */
  protected override artId(): string {
    return MIRAGE_TOAD_DEF.id;
  }

  bindHost(host: IEnemy): void {
    this.host = host;
    this.facing = (host as MirageToad).facing;
    this.cooldown = this.ctx.rng.range(0.6, 1.8);
  }

  protected override afterInit(): void {
    super.afterInit();
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        // 加法混合的发光件 / 发光壳由本体逻辑控制亮度，不参与幻影淡化
        if (this.fadeMats.includes(mat) || mat.blending === THREE.AdditiveBlending) continue;
        mat.transparent = true;
        mat.opacity = 0.55;
        this.fadeMats.push(mat);
      }
    });
  }

  protected override ai(dt: number): void {
    this.life -= dt;
    if (this.life <= 0 || (this.host && !this.host.alive)) {
      this.vanish();
      return;
    }
    super.ai(dt);
  }

  protected override pose(dt: number): void {
    super.pose(dt);
    const flicker = 0.42 + 0.16 * Math.sin(this.age * 9 + this.id) + (Math.sin(this.age * 31) > 0.85 ? -0.2 : 0);
    for (const m of this.fadeMats) m.opacity = flicker;
  }

  /** 消散：不经过 combat，不算击杀、不掉落 */
  vanish(): void {
    if (this.vanished || !this.alive) return;
    this.vanished = true;
    this.hp = 0;
    this.shield = 0;
    this.armor = 0;
    this.getBodyCenter(_pos);
    this.ctx.fx.burst(_pos, 0xfff0c8, 16, 2.2, 0.5, 0.16, -0.6);
    const req: DamageRequest = { base: 0, element: 'none', source: 'explosion' };
    const res: DamageResult = {
      request: req, dealt: 0, isCrit: false, killed: true, layer: 'health',
      shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null,
    };
    this.onKilled(res);
  }

  protected override animateDeath(t: number): void {
    // 散成热浪：横向拉宽、压扁、淡出
    const s = this.sizeScale;
    this.model.scale.set(s * (1 + t * 0.8), s * Math.max(0.02, 1 - t), s * (1 + t * 0.8));
    for (const m of this.fadeMats) m.opacity = 0.5 * (1 - t);
  }
}
