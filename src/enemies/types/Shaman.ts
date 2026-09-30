/**
 * 巫祝（shaman）：戴傩面、执法杖的施法者。保持 13–21 米横移；
 *  - 法阵：举杖 0.45 秒后在玩家脚下落下 3.5 米法阵（1.2 秒地面预警），到时结算伤害。
 *  - 护佑：每 8–11 秒引导 0.7 秒，为 10 米内友军加护盾（光束 + 扩散环）；
 *    身边没有需要护佑的友军时，会走向最近的需要者（通常是前线的近战）再施法。
 *
 * 状态机：move → castCircle → recover → move
 *          move → (seekAllies →) ward → recover → move
 */
import * as THREE from 'three';
import type { EnemyDef, GameContext, IEnemy, SpawnOptions } from '../../core/types';
import { clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import { zonePlayer } from '../Hazards';
import { Geo, applyWalk, buildHumanoid, flat, joint, part, type HumanoidRig } from '../Models';

export const SHAMAN_DEF: EnemyDef = {
  id: 'shaman',
  name: '巫祝',
  hp: 90,
  shield: 80,
  speed: 4.2,
  radius: 0.42,
  height: 1.95,
  damage: 22,
  coins: [3, 5],
  essence: 1,
  headY: 1.7,
  headRadius: 0.35,
  knockbackResist: 0,
  color: 0xb070ff,
};

const MIN_RANGE = 13;
const MAX_RANGE = 21;
const CAST_WINDUP = 0.45;
const CIRCLE_RADIUS = 3.5;
const CIRCLE_DELAY = 1.2;
const WARD_RANGE = 10;
const WARD_CHANNEL = 0.7;
/** 走向友军时：搜索范围与停下施法的距离 */
const WARD_SEEK_RANGE = 30;
const WARD_APPROACH = 7;
/** 护佑量 = 友军最大生命 × 此值（精英巫祝再 ×1.3） */
const WARD_FRACTION = 0.4;

const C = {
  robe: 0x4b2a6e, skirt: 0x3e2260, trim: 0xc9a24a, sash: 0x2a9d8f, leg: 0x2a1c30, hand: 0xc9a27a,
  mask: 0xb8322a, hair: 0x1e1422, paper: 0xe8d070, staff: 0x5a3a22,
  eye: 0x9a50ff, eyeHot: 0xf0d8ff, orb: 0x6a3aa0, orbHot: 0xf0d0ff,
  circle: 0xb070ff, ward: 0x5fffd0,
};

/** 被护佑过的敌人原始护盾上限（多次护佑不会无限叠加） */
const wardBase = new WeakMap<IEnemy, number>();
const _scratch: IEnemy[] = [];
const _tip = new THREE.Vector3();
const _chest = new THREE.Vector3();

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

export class Shaman extends StandardEnemy {
  private rig!: HumanoidRig;
  private staff!: THREE.Group;
  private runeCircle!: THREE.Mesh;
  private runeWard!: THREE.Mesh;
  private wardCd: number;
  private wardCheck = 0;
  private wardTarget: IEnemy | null = null;
  private windTime = CAST_WINDUP;
  private recoverTime = 0.6;
  private placed = false;
  private pLift = 0;
  private pTilt = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, SHAMAN_DEF, opts);
    this.wardCd = ctx.rng.range(2.5, 4.5);
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const r = buildHumanoid(root, {
      hipY: 0.86, hipX: 0.12, thigh: 0.44, legW: 0.13,
      legColor: C.leg,
      torsoW: 0.44, torsoH: 0.6, torsoD: 0.28, torsoColor: C.robe,
      shoulderX: 0.29, shoulderY: 0.52, upperArm: 0.28, foreArm: 0.27, armW: 0.13,
      armColor: C.robe, handColor: C.hand,
      neckY: 0.64,
    });
    this.rig = r;
    const t = r.torso;
    // 长袍下摆（挂在髋上随步伐起伏）+ 金边
    part(r.hips, Geo.cyl(0.27, 0.43, 0.8, 6, 'top'), flat(C.skirt), 0, 0.02, 0);
    part(r.hips, Geo.cyl(0.44, 0.44, 0.05, 6), flat(C.trim, { metal: 0.5 }), 0, -0.76, 0);
    part(t, Geo.box(0.47, 0.09, 0.31), flat(C.sash), 0, 0.06, 0);
    part(t, Geo.box(0.5, 0.1, 0.33), flat(C.trim, { metal: 0.5 }), 0, 0.55, 0);
    // 符纸
    for (let i = 0; i < 3; i++) {
      part(t, Geo.box(0.07, 0.24, 0.012, 'top'), flat(C.paper, { emissive: 0x3a2a00, ei: 0.6 }), -0.12 + i * 0.12, 0.02, 0.16, 0.08, 0, (i - 1) * 0.12);
    }

    // 头：傩面 + 高冠 + 羽饰
    const h = r.head;
    part(h, Geo.box(0.3, 0.32, 0.28), flat(C.hair), 0, 0.17, -0.02);
    part(h, Geo.box(0.32, 0.37, 0.08), flat(C.mask, { rough: 0.6 }), 0, 0.18, 0.13);
    part(h, Geo.box(0.33, 0.05, 0.09), flat(C.trim, { metal: 0.5 }), 0, 0.3, 0.14);
    this.glowPart(h, Geo.box(0.075, 0.045, 0.02), C.eye, C.eyeHot, 0.075, 0.23, 0.175);
    this.glowPart(h, Geo.box(0.075, 0.045, 0.02), C.eye, C.eyeHot, -0.075, 0.23, 0.175);
    part(h, Geo.box(0.12, 0.03, 0.02), flat(C.trim), 0, 0.08, 0.175);
    part(h, Geo.cyl(0.1, 0.19, 0.36, 6, 'bottom'), flat(C.robe), 0, 0.33, -0.02);
    part(h, Geo.cyl(0.195, 0.195, 0.05, 6), flat(C.trim, { metal: 0.5 }), 0, 0.36, -0.02);
    for (let i = 0; i < 3; i++) {
      part(h, Geo.box(0.04, 0.42, 0.02, 'bottom'), flat(i === 1 ? C.trim : C.mask), 0, 0.5, -0.12, -0.2, 0, (i - 1) * 0.35);
    }

    // 法杖（挂在躯干右侧，抬举时整体上移前倾）
    const st = joint(t, -0.36, 0.05, 0.14);
    this.staff = st;
    part(st, Geo.box(0.045, 1.75, 0.045), flat(C.staff), 0, 0.12, 0);
    part(st, Geo.torus(0.12, 0.02, 4, 12), flat(C.trim, { metal: 0.6 }), 0, 1.05, 0);
    part(st, Geo.cone(0.05, 0.14, 4), flat(C.trim, { metal: 0.6 }), 0, 1.22, 0);
    this.glowPart(st, Geo.ico(0.075), C.orb, C.orbHot, 0, 1.05, 0, 0);
    this.glowPart(st, Geo.ico(0.16, 1), 0x000000, C.ward, 0, 1.05, 0, 1, true);

    // 脚下符阵（平时不可见）
    this.runeCircle = this.glowPart(root, Geo.ring(0.62, 0.9, 32), 0x000000, C.circle, 0, 0.04, 0, 0, true);
    this.runeWard = this.glowPart(root, Geo.ring(0.95, 1.1, 32), 0x000000, C.ward, 0, 0.05, 0, 1, true);
    return root;
  }

  /** 杖头世界坐标 */
  private staffTip(out: THREE.Vector3): THREE.Vector3 {
    const lift = this.pLift;
    const tilt = this.pTilt;
    const y = 0.86 + 0.05 + lift + Math.cos(tilt) * 1.05;
    const z = 0.14 + Math.sin(tilt) * 1.05;
    return this.localPoint(-0.36, y, z, out);
  }

  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.staffTip(out);
  }

  protected override ai(dt: number): void {
    const d = this.distToPlayerXZ();
    if (this.wardCd > 0) this.wardCd -= dt * this.attackRate;
    switch (this.state) {
      case 'chase':
      case 'move': {
        this.glowTarget[0] = 0;
        this.glowTarget[1] = 0;
        this.wardCheck -= dt;
        if (this.wardCd <= 0 && this.wardCheck <= 0) {
          this.wardCheck = 0.5;
          if (this.alliesNeedWard()) {
            this.beginWard();
            break;
          }
          // 身边没有需要护佑的友军：走向最近的需要者（前线）
          const ally = this.findWardTarget();
          if (ally) {
            this.wardTarget = ally;
            this.setState('seekAllies');
            break;
          }
        }
        if (this.seekSight(MIN_RANGE - 3, MAX_RANGE, this.speed)) {
          this.faceMovement(6, dt);
          break;
        }
        this.keepRange(MIN_RANGE, MAX_RANGE, this.speed);
        this.facePlayer(5, dt);
        if (this.cooldown <= 0 && this.sees && d <= 30) {
          if (this.requestAttack('heavy', CAST_WINDUP + CIRCLE_DELAY + 0.4)) {
            this.windTime = this.windup(CAST_WINDUP, 0.35);
            this.placed = false;
            this.setState('castCircle');
          } else {
            this.cooldown = this.ctx.rng.range(0.4, 0.9);
          }
        }
        break;
      }
      case 'castCircle': {
        this.glowTarget[0] = 1;
        this.facePlayer(6, dt);
        if (!this.placed && this.stateTime >= this.windTime) {
          this.placed = true;
          this.placeCircle();
          this.recoverTime = 0.6;
          this.setState('recover');
        }
        break;
      }
      case 'seekAllies': {
        this.glowTarget[1] = 0.35;
        const ally = this.wardTarget;
        if (!ally || !ally.alive || this.stateTime > 4) {
          this.wardTarget = null;
          this.wardCd = 1.5;
          this.setState('move');
          break;
        }
        const ax = ally.position.x - this.position.x;
        const az = ally.position.z - this.position.z;
        if (ax * ax + az * az <= WARD_APPROACH * WARD_APPROACH) {
          this.wardTarget = null;
          this.beginWard();
          break;
        }
        this.navigate(ally.position, this.speed * 1.15, WARD_APPROACH * 0.8);
        this.faceMovement(6, dt);
        break;
      }
      case 'ward': {
        this.glowTarget[1] = 1;
        this.glowTarget[0] = 0;
        this.facePlayer(3, dt);
        if (this.stateTime >= WARD_CHANNEL) {
          this.castWard();
          this.wardCd = this.ctx.rng.range(8, 11);
          this.recoverTime = 0.5;
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        this.glowTarget[0] = 0;
        this.glowTarget[1] = 0;
        this.keepRange(MIN_RANGE, MAX_RANGE, this.speed * 0.6);
        this.facePlayer(4, dt);
        if (this.stateTime >= this.recoverTime) {
          this.rollCooldown(3.2, 4.8);
          this.setState('move');
          // 法阵落地后继续持有令牌直到结算，避免多个法阵同时叠在玩家脚下
          this.ctx.tasks.delay(CIRCLE_DELAY * 0.6, () => this.releaseAttack());
        }
        break;
      }
      default:
        this.setState('move');
    }
  }

  /** 在玩家当前位置（落到地面）放下法阵，1.2 秒后结算 */
  private placeCircle(): void {
    const ctx = this.ctx;
    const pl = ctx.player.position;
    const gy = ctx.world.groundHeight(pl.x, pl.z, pl.y + 0.1);
    const center = new THREE.Vector3(pl.x, Number.isFinite(gy) ? gy : pl.y, pl.z);
    const damage = this.def.damage * this.damageMult;
    ctx.fx.groundWarning(center, CIRCLE_RADIUS, CIRCLE_DELAY, C.circle);
    ctx.audio.play('telegraph', { position: center, volume: 0.8 });
    this.staffTip(_tip);
    ctx.fx.beam(_tip.clone(), center, C.circle, 0.05, 0.25);
    ctx.tasks.delay(CIRCLE_DELAY, () => {
      ctx.fx.ring(center, CIRCLE_RADIUS, C.circle, 0.45);
      _chest.set(center.x, center.y + 0.3, center.z);
      ctx.fx.burst(_chest, C.circle, 28, 6, 0.7, 0.14, -3);
      ctx.fx.explosion(_chest.clone(), CIRCLE_RADIUS * 0.6, C.circle);
      ctx.audio.play('explosion', { position: center, volume: 0.55, pitch: 1.4 });
      zonePlayer(ctx, center, CIRCLE_RADIUS, damage, 'corrode', this);
    });
  }

  private beginWard(): void {
    this.setState('ward');
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.6, pitch: 1.5 });
  }

  /** 是否需要护佑：护盾低于（原始上限 + 护佑量）的 60% */
  private needsWard(e: IEnemy): boolean {
    if (e === this || !e.alive || e.isBoss) return false;
    const base = wardBase.get(e) ?? e.maxShield;
    return e.shield < (base + this.wardAmount(e)) * 0.6;
  }

  /** 30 米内最近的需要护佑的友军 */
  private findWardTarget(): IEnemy | null {
    let best: IEnemy | null = null;
    let bestD = WARD_SEEK_RANGE * WARD_SEEK_RANGE;
    for (const e of this.ctx.enemies.list) {
      if (!this.needsWard(e)) continue;
      const dx = e.position.x - this.position.x;
      const dz = e.position.z - this.position.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private wardAmount(ally: IEnemy): number {
    return Math.round(ally.maxHp * WARD_FRACTION * (this.isElite ? 1.3 : 1));
  }

  private alliesNeedWard(): boolean {
    const list = this.ctx.enemies.queryRadius(this.position, WARD_RANGE, _scratch);
    for (const e of list) if (this.needsWard(e)) return true;
    return false;
  }

  private castWard(): void {
    const ctx = this.ctx;
    this.staffTip(_tip);
    ctx.fx.ring(this.position.clone(), WARD_RANGE, C.ward, 0.7);
    ctx.fx.burst(_tip, C.ward, 18, 3, 0.6, 0.1, -1);
    ctx.audio.play('skill_buff', { position: this.position, volume: 0.6, pitch: 1.2 });
    const list = ctx.enemies.queryRadius(this.position, WARD_RANGE, _scratch);
    for (const e of list) {
      if (e === this || !e.alive || e.isBoss) continue;
      let base = wardBase.get(e);
      if (base === undefined) {
        base = e.maxShield;
        wardBase.set(e, base);
      }
      const amount = this.wardAmount(e);
      e.maxShield = Math.max(e.maxShield, base + amount);
      e.shield = Math.min(e.maxShield, e.shield + amount);
      e.getBodyCenter(_chest);
      ctx.fx.beam(_tip.clone(), _chest.clone(), C.ward, 0.06, 0.4);
      ctx.fx.burst(_chest, C.ward, 12, 2.5, 0.5, 0.09, -1);
    }
  }

  protected override cancelAttack(): void {
    this.glowTarget[0] = 0;
    this.glowTarget[1] = 0;
    this.wardTarget = null;
    if (this.state === 'castCircle' || this.state === 'ward' || this.state === 'seekAllies') {
      this.setState('move');
      this.rollCooldown(1, 1.8);
    }
  }

  protected override pose(dt: number): void {
    const r = this.rig;
    applyWalk(r, this.walkPhase, this.walkAmp, 0.6);
    let lift = 0;
    let tilt = 0.08;
    let armR = -0.35;
    let armL = r.armL.rotation.x;
    let elbowL = r.elbowL.rotation.x;
    const casting = this.state === 'castCircle';
    const warding = this.state === 'ward';
    if (casting) {
      const t = clamp01(this.stateTime / this.windTime);
      lift = 0.2 + 0.2 * t;
      tilt = 0.55 * t;
      armR = -1.2;
      armL = -1.6;
      elbowL = -0.6;
    } else if (warding) {
      lift = 0.45;
      tilt = 0;
      armR = -2.0;
      armL = -2.4;
      elbowL = -0.3;
    }
    const k = 1 - Math.exp(-12 * dt);
    this.pLift = mix(this.pLift, lift, k);
    this.pTilt = mix(this.pTilt, tilt, k);
    this.staff.position.y = 0.05 + this.pLift;
    this.staff.rotation.x = this.pTilt;
    r.armR.rotation.x = mix(r.armR.rotation.x, armR, 0.8);
    r.armR.rotation.z = -0.25;
    r.elbowR.rotation.x = -1.0;
    r.armL.rotation.x = armL;
    r.elbowL.rotation.x = elbowL;
    // 符阵旋转
    this.runeCircle.rotation.y += dt * 1.5;
    this.runeWard.rotation.y -= dt * 2.2;
    const hover = warding ? Math.sin(this.age * 6) * 0.03 : 0;
    r.hips.position.y += hover;
    this.applyHurtAndStun(r);
  }
}
