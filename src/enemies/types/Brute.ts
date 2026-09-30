/**
 * 铁甲盾卫（brute）：缓慢逼近；12 米内蓄力 0.8 秒（地面冲锋通道预警、面甲发红）后直线冲锋，
 * 撞到玩家造成重击并击飞，撞墙会眩晕一段时间（惩罚窗口）。贴身时用盾猛击。
 *
 * 状态机：advance → chargeWindup → charge → recover / stagger → advance
 *          advance → bashWindup → bash → recover → advance
 */
import * as THREE from 'three';
import type { EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import type { StaticBox, WorldRayHit } from '../../world/Collision';
import { clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import { Geo, applyCrouch, applyWalk, buildHumanoid, flat, joint, newAdditive, part, type HumanoidRig } from '../Models';

export const BRUTE_DEF: EnemyDef = {
  id: 'brute',
  name: '铁甲盾卫',
  hp: 160,
  armor: 140,
  speed: 3.4,
  radius: 0.65,
  height: 2.3,
  damage: 25,
  coins: [3, 5],
  essence: 1,
  headY: 2.08,
  headRadius: 0.52,
  knockbackResist: 0.6,
  color: 0xd04030,
};

const CHARGE_RANGE = 12;
const CHARGE_WINDUP = 0.8;
/** 前摇最后这段时间锁定方向（可侧闪） */
const CHARGE_LOCK = 0.2;
const CHARGE_SPEED = 15;
const CHARGE_TIME = 1.05;
const BASH_RANGE = 2.2;
const BASH_WINDUP = 0.5;
const BASH_DAMAGE_MULT = 0.55;

const C = {
  iron: 0x555b66, ironDark: 0x3b4048, leg: 0x4a4f58, shin: 0x3a3e46, foot: 0x2a2c30,
  gold: 0xb8913e, leather: 0x3a2a1c, bronze: 0x5a4028, horn: 0xe0d6c0,
  visor: 0x9a1c0c, visorHot: 0xffa060, emblem: 0x801808, emblemHot: 0xff5020,
};

const _v = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _hitTmp: WorldRayHit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as unknown as StaticBox };

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

export class Brute extends StandardEnemy {
  private rig!: HumanoidRig;
  private shieldObj!: THREE.Group;
  private lane: THREE.Mesh | null = null;
  private laneMat: THREE.MeshBasicMaterial | null = null;
  private laneLen = CHARGE_RANGE;
  private chargeCd: number;
  private bashCd = 0;
  private windTime = CHARGE_WINDUP;
  private recoverTime = 0.9;
  private chargeHit = false;
  private readonly chargeDir = new THREE.Vector3();
  private pCrouch = 0;
  private pShieldX = 0.3;
  private pShieldZ = 0.44;
  private pArmR = -0.3;
  private pLean = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, BRUTE_DEF, opts);
    this.chargeCd = ctx.rng.range(1.5, 3);
    this.walkScale = 0.5;
    this.stepRate = 2.2;
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const r = buildHumanoid(root, {
      hipY: 0.98, hipX: 0.21, thigh: 0.5, legW: 0.27,
      legColor: C.leg, shinColor: C.shin, footColor: C.foot,
      torsoW: 0.9, torsoH: 0.78, torsoD: 0.55, torsoColor: C.iron,
      shoulderX: 0.58, shoulderY: 0.64, upperArm: 0.38, foreArm: 0.36, armW: 0.22,
      armColor: C.iron, foreColor: C.ironDark, handColor: C.foot,
      neckY: 0.82,
    });
    this.rig = r;
    const t = r.torso;
    const goldMat = flat(C.gold, { metal: 0.65, rough: 0.35 });
    part(t, Geo.box(0.93, 0.08, 0.58), goldMat, 0, 0.68, 0);
    part(t, Geo.box(0.95, 0.13, 0.58), flat(C.leather), 0, 0.04, 0);
    part(t, Geo.box(0.18, 0.13, 0.05), goldMat, 0, 0.04, 0.3);
    part(t, Geo.box(0.6, 0.3, 0.06), flat(C.ironDark, { metal: 0.4 }), 0, 0.4, 0.28);
    // 护肩与尖刺
    for (const s of [1, -1]) {
      part(t, Geo.box(0.44, 0.22, 0.52), flat(C.ironDark, { metal: 0.4 }), s * 0.54, 0.72, 0);
      part(t, Geo.cone(0.07, 0.24, 4), flat(C.horn), s * 0.6, 0.93, 0);
    }
    // 腰甲裙
    part(r.hips, Geo.box(0.86, 0.3, 0.56, 'top'), flat(C.ironDark, { metal: 0.3 }), 0, -0.02, 0);

    // 头盔 + 红色面甲缝 + 双角
    const h = r.head;
    part(h, Geo.box(0.47, 0.45, 0.47), flat(C.ironDark, { metal: 0.45, rough: 0.5 }), 0, 0.2, 0);
    part(h, Geo.box(0.41, 0.28, 0.06), flat(C.iron, { metal: 0.5 }), 0, 0.15, 0.24);
    this.glowPart(h, Geo.box(0.32, 0.055, 0.03), C.visor, C.visorHot, 0, 0.23, 0.275);
    for (const s of [1, -1]) {
      part(h, Geo.cone(0.075, 0.38, 5), flat(C.horn), s * 0.27, 0.46, 0, 0, 0, -s * 0.65);
    }

    // 锤：握把朝下时锤头指向前方
    const mace = joint(r.handR, 0, -0.08, 0);
    mace.rotation.x = -0.3;
    part(mace, Geo.box(0.06, 0.06, 0.66), flat(C.leather), 0, 0, 0.22);
    part(mace, Geo.dodeca(0.17), flat(C.ironDark, { metal: 0.5 }), 0, 0, 0.58);
    part(mace, Geo.cone(0.05, 0.14, 4), flat(C.horn), 0, 0.16, 0.58);
    part(mace, Geo.cone(0.05, 0.14, 4), flat(C.horn), 0, -0.16, 0.58, Math.PI, 0, 0);

    // 塔盾（挂在躯干前方）
    const sh = joint(t, 0.3, 0.3, 0.44);
    this.shieldObj = sh;
    part(sh, Geo.box(0.93, 1.32, 0.06), goldMat, 0, 0, -0.03);
    part(sh, Geo.box(0.85, 1.24, 0.1), flat(C.bronze, { metal: 0.35, rough: 0.6 }), 0, 0, 0.02);
    part(sh, Geo.box(0.34, 0.32, 0.05), goldMat, 0, 0.18, 0.08);
    this.glowPart(sh, Geo.box(0.08, 0.045, 0.02), C.emblem, C.emblemHot, 0.08, 0.23, 0.115);
    this.glowPart(sh, Geo.box(0.08, 0.045, 0.02), C.emblem, C.emblemHot, -0.08, 0.23, 0.115);
    part(sh, Geo.cone(0.09, 0.2, 5), flat(C.ironDark, { metal: 0.5 }), 0, -0.2, 0.15, Math.PI / 2, 0, 0);
    return root;
  }

  protected override afterInit(): void {
    // 冲锋预警通道：挂在 root 上随朝向旋转
    this.laneMat = this.ownMaterial(newAdditive(0xff3a1a, 1));
    this.laneMat.color.setRGB(0, 0, 0);
    this.lane = new THREE.Mesh(Geo.lane(), this.laneMat);
    this.lane.position.y = 0.06;
    this.lane.visible = false;
    this.lane.renderOrder = 2;
    this.root.add(this.lane);
  }

  protected override ai(dt: number): void {
    const pl = this.ctx.player;
    const d = this.distToPlayerXZ();
    if (this.chargeCd > 0) this.chargeCd -= dt * this.attackRate;
    if (this.bashCd > 0) this.bashCd -= dt * this.attackRate;
    switch (this.state) {
      case 'chase':
      case 'advance': {
        this.glowTarget[0] = 0;
        const reach = this.verticalReach(1.6);
        if (d <= BASH_RANGE && this.bashCd <= 0 && reach && this.sees && this.requestAttack('melee', 1.4)) {
          this.windTime = this.windup(BASH_WINDUP, 0.35);
          this.setState('bashWindup');
          break;
        }
        if (this.chargeCd <= 0 && d >= 3.5 && d <= CHARGE_RANGE && reach && this.sees && this.directPathClear(pl.position)) {
          if (this.requestAttack('melee', CHARGE_WINDUP + CHARGE_TIME + 1.8)) {
            this.windTime = this.windup(CHARGE_WINDUP, 0.6);
            this.setState('chargeWindup');
            this.ctx.audio.play('enemy_charge', { position: this.position, volume: 1 });
            break;
          }
          this.chargeCd = 0.6;
        }
        this.navigate(pl.position, this.speed, 1.8);
        if (d < 6) this.facePlayer(3, dt);
        else this.faceMovement(3.5, dt);
        break;
      }
      case 'chargeWindup': {
        this.glowTarget[0] = clamp01(this.stateTime / this.windTime);
        if (this.stateTime < this.windTime - CHARGE_LOCK) this.facePlayer(4, dt);
        this.updateLane(clamp01(this.stateTime / this.windTime));
        if (this.stateTime >= this.windTime) {
          this.chargeDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
          this.chargeHit = false;
          this.accel = 70;
          this.setState('charge');
          this.ctx.fx.shake(0.15 * clamp01(1 - d / 20), 0.2);
        }
        break;
      }
      case 'charge': {
        this.glowTarget[0] = 1;
        this.updateLane(Math.max(0, 1 - this.stateTime * 4));
        this.setMove(this.chargeDir.x, this.chargeDir.z, CHARGE_SPEED);
        this.checkChargeHit();
        if (this.chargeHit) {
          this.endCharge('recover', 0.9);
        } else if (this.moveResult.hitWall && this.stateTime > 0.12) {
          this.getMuzzle(_v);
          this.ctx.fx.impact(_v, null, 0xffd8a0, 1.4);
          this.ctx.fx.burst(this.position, 0xb8a080, 16, 4, 0.6, 0.12, 8);
          this.ctx.fx.shake(0.35 * clamp01(1 - d / 16), 0.3);
          this.ctx.audio.play('boss_slam', { position: this.position, volume: 0.6, pitch: 1.4 });
          this.stunTime = Math.max(this.stunTime, 1.4);
          this.endCharge('recover', 0.5);
        } else if (this.stateTime >= CHARGE_TIME) {
          this.endCharge('recover', 0.9);
        }
        break;
      }
      case 'recover': {
        this.glowTarget[0] = 0;
        this.facePlayer(2, dt);
        if (this.stateTime >= this.recoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.setState('advance');
        }
        break;
      }
      case 'bashWindup': {
        this.glowTarget[0] = 1;
        this.facePlayer(3.5, dt);
        if (this.stateTime >= this.windTime) {
          if (this.melee(BASH_RANGE, this.def.damage * BASH_DAMAGE_MULT, 0.35)) {
            this.pushPlayer(5, 2);
            this.ctx.fx.shake(0.25, 0.2);
          }
          this.setState('bash');
        }
        break;
      }
      case 'bash': {
        this.glowTarget[0] = 0.3;
        if (this.stateTime >= 0.2) {
          this.bashCd = this.ctx.rng.range(1.6, 2.6);
          this.recoverTime = 0.55;
          this.setState('recover');
        }
        break;
      }
      default:
        this.setState('advance');
    }
  }

  private endCharge(next: string, recover: number): void {
    this.accel = 28;
    this.chargeCd = this.ctx.rng.range(4, 6);
    this.recoverTime = recover;
    this.hideLane();
    this.setState(next);
  }

  private checkChargeHit(): void {
    if (this.chargeHit) return;
    const pl = this.ctx.player;
    const dx = pl.position.x - this.position.x;
    const dz = pl.position.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d > this.radius + pl.radius + 0.35 || !this.verticalReach(1.8)) return;
    if (d > 0.05 && (dx * this.chargeDir.x + dz * this.chargeDir.z) / d < 0.2) return;
    this.chargeHit = true;
    this.ctx.combat.damagePlayer(this.def.damage * this.damageMult, 'none', this, this.position);
    this.pushPlayer(9, 3.5);
    this.ctx.fx.shake(0.55, 0.3);
    this.ctx.audio.play('enemy_melee', { position: this.position, volume: 1.2, pitch: 0.7 });
  }

  private pushPlayer(horizontal: number, up: number): void {
    const pl = this.ctx.player;
    _imp.set(pl.position.x - this.position.x, 0, pl.position.z - this.position.z);
    if (_imp.lengthSq() < 1e-4) _imp.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    _imp.normalize().multiplyScalar(horizontal);
    _imp.y = up;
    pl.applyImpulse(_imp);
  }

  /** 预警通道：长度按前方墙体裁剪，强度 t ∈ [0,1] */
  private updateLane(t: number): void {
    const lane = this.lane;
    const mat = this.laneMat;
    if (!lane || !mat) return;
    lane.visible = t > 0.01;
    if (!lane.visible) return;
    _v.set(this.position.x, this.position.y + 0.6, this.position.z);
    const dir = _imp.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    const hit = this.ctx.world.raycast(_v, dir, CHARGE_SPEED * CHARGE_TIME, _hitTmp);
    this.laneLen = hit ? Math.max(1, hit.distance) : CHARGE_SPEED * CHARGE_TIME;
    // 通道挂在未缩放的 root 上：宽度按精英体型放大，长度即世界长度
    lane.scale.set(this.radius * 2.2, 1, this.laneLen);
    const pulse = 0.75 + 0.25 * Math.sin(this.age * 22);
    mat.color.setRGB(1 * t * pulse, 0.23 * t * pulse, 0.1 * t * pulse);
  }

  private hideLane(): void {
    if (this.lane) this.lane.visible = false;
  }

  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.localPoint(0, 1.4, 0.9, out);
  }

  protected override cancelAttack(): void {
    this.accel = 28;
    this.glowTarget[0] = 0;
    this.hideLane();
    if (this.state !== 'advance' && this.state !== 'chase' && this.state !== 'idle') {
      this.setState('advance');
      this.chargeCd = Math.max(this.chargeCd, 1.5);
    }
  }

  protected override pose(dt: number): void {
    const r = this.rig;
    applyWalk(r, this.walkPhase, this.walkAmp, 0.5);
    let crouch = 0;
    let shieldX = 0.3;
    let shieldZ = 0.44;
    let armR = -0.3 - this.walkAmp * 0.3;
    let lean = 0;
    let rate = 10;
    switch (this.state) {
      case 'chargeWindup': {
        const t = clamp01(this.stateTime / this.windTime);
        crouch = 0.22 * t;
        shieldX = 0.08;
        shieldZ = 0.55;
        armR = 0.6;
        lean = 0.35 * t;
        // 跺脚蓄力
        r.legL.rotation.x += Math.max(0, Math.sin(this.stateTime * 16)) * -0.25;
        break;
      }
      case 'charge':
        crouch = 0.18;
        shieldX = 0.05;
        shieldZ = 0.62;
        armR = 0.5;
        lean = 0.5;
        rate = 20;
        break;
      case 'bashWindup':
        shieldX = 0.45;
        shieldZ = 0.2;
        armR = -0.2;
        lean = -0.12;
        break;
      case 'bash':
        shieldX = 0.1;
        shieldZ = 0.85;
        lean = 0.3;
        rate = 30;
        break;
      case 'recover':
        lean = 0.1;
        break;
    }
    const k = 1 - Math.exp(-rate * dt);
    this.pCrouch = mix(this.pCrouch, crouch, k);
    this.pShieldX = mix(this.pShieldX, shieldX, k);
    this.pShieldZ = mix(this.pShieldZ, shieldZ, k);
    this.pArmR = mix(this.pArmR, armR, k);
    this.pLean = mix(this.pLean, lean, k);
    this.shieldObj.position.x = this.pShieldX;
    this.shieldObj.position.z = this.pShieldZ;
    // 左臂扶盾
    r.armL.rotation.set(-0.95, 0, -0.25 + (0.3 - this.pShieldX) * 0.8);
    r.elbowL.rotation.x = -0.9;
    r.armR.rotation.x = this.pArmR;
    r.armR.rotation.z = -0.15;
    r.elbowR.rotation.x = -0.7;
    r.torso.rotation.x += this.pLean;
    applyCrouch(r, this.pCrouch);
    this.applyHurtAndStun(r);
  }
}
