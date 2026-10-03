/**
 * 重炮兵（mortar）：戴斗笠、肩扛铜炮的重装兵。缓慢，保持 15–27 米。
 * 架炮 0.9 秒（炮口发光、炮身前倾）后连抛 3 发炮弹：第一发落在玩家预判位置，
 * 另两发散布在周围包夹；每发落点都有与飞行时间同步的地面预警。
 * 可以越过掩体曲射（26 米内不需要视线）；被贴身时用炮托砸人。
 *
 * 状态机：move → brace → fire → recover → move
 *          move → smashWindup → smash → recover → move
 */
import * as THREE from 'three';
import type { EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { ballisticVelocity, clamp, clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import { Geo, applyCrouch, applyWalk, buildHumanoid, flat, joint, part, type HumanoidRig } from '../Models';

export const MORTAR_DEF: EnemyDef = {
  id: 'mortar',
  name: '重炮兵',
  hp: 150,
  armor: 60,
  speed: 2.8,
  radius: 0.55,
  height: 1.95,
  damage: 20,
  coins: [3, 5],
  essence: 1,
  // 头部 = 蒙面的脸 + 斗笠顶（脸 1.60 → 1.92，宽 0.34；宽帽檐外缘不算）；判定球随头骨移动
  headY: 1.8,
  headRadius: 0.3,
  knockbackResist: 0.5,
  color: 0xffa040,
};

const MIN_RANGE = 15;
const MAX_RANGE = 27;
/** 不需要视线的曲射距离 */
const BLIND_FIRE_RANGE = 26;
const BRACE_TIME = 0.9;
const SHELLS = 3;
const SHELL_GAP = 0.35;
const SHELL_GRAVITY = 20;
const SHELL_RADIUS = 3;
/** 炮弹在离落点超过此距离（米）的地方就炸了，视为被拦截：撤掉落点预警 */
const SHELL_OFF_TARGET = 1.5;
const SMASH_RANGE = 2.3;
const SMASH_WINDUP = 0.55;
const SMASH_DAMAGE_MULT = 0.7;
/** 炮管挂点（相对髋）与长度 */
const TUBE_X = -0.3;
const TUBE_Y = 0.62;
const TUBE_Z = -0.05;
const TUBE_LEN = 1.0;
const HIP_Y = 0.9;

const C = {
  leg: 0x3a3226, shin: 0x2e2820, foot: 0x1e1a16, leather: 0x6b4a2e, bronze: 0x8a6a3a, brass: 0xa07a3a,
  dark: 0x2a2018, face: 0x7a5a40, scarf: 0x6a2a20, straw: 0xc8a866, strawDark: 0x9a7e48,
  eye: 0xffb040, eyeHot: 0xffe0a0, mouth: 0x2a1206, mouthHot: 0xffa040, ember: 0xff7a20, emberHot: 0xffe080,
};

const _muzzle = new THREE.Vector3();
const _target = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _imp = new THREE.Vector3();

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

export class Mortar extends StandardEnemy {
  private rig!: HumanoidRig;
  private tube!: THREE.Group;
  private windTime = BRACE_TIME;
  private recoverTime = 0.8;
  private shots = 0;
  private shotTimer = 0;
  private smashCd = 0;
  private kick = 0;
  private pTilt = -0.35;
  private pCrouch = 0;
  private pArmL = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, MORTAR_DEF, opts);
    this.walkScale = 0.45;
    this.stepRate = 2.4;
    this.cooldown = ctx.rng.range(1.5, 3);
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const r = buildHumanoid(root, {
      hipY: HIP_Y, hipX: 0.17, thigh: 0.46, legW: 0.22,
      legColor: C.leg, shinColor: C.shin, footColor: C.foot,
      torsoW: 0.66, torsoH: 0.66, torsoD: 0.44, torsoColor: C.leather,
      shoulderX: 0.42, shoulderY: 0.56, upperArm: 0.32, foreArm: 0.3, armW: 0.18,
      armColor: C.leather, handColor: C.dark,
      neckY: 0.7,
    });
    this.rig = r;
    const t = r.torso;
    const bronze = flat(C.bronze, { metal: 0.45, rough: 0.5 });
    // 胸甲 + 铆钉 + 弹带
    part(t, Geo.box(0.6, 0.4, 0.06), bronze, 0, 0.36, 0.23);
    for (const x of [-0.22, 0.22]) for (const y of [0.22, 0.5]) part(t, Geo.box(0.05, 0.05, 0.03), flat(C.dark), x, y, 0.27);
    part(t, Geo.box(0.7, 0.1, 0.46), flat(C.dark), 0, 0.05, 0);
    for (let i = 0; i < 4; i++) part(t, Geo.cyl(0.035, 0.035, 0.12, 6), flat(C.brass, { metal: 0.6 }), -0.18 + i * 0.12, 0.06, 0.25);
    part(r.hips, Geo.box(0.64, 0.24, 0.46, 'top'), flat(C.leather), 0, -0.02, 0);
    // 背包弹药箱
    part(t, Geo.box(0.5, 0.5, 0.24), flat(C.dark), 0, 0.36, -0.32);
    for (let i = 0; i < 3; i++) part(t, Geo.cyl(0.06, 0.06, 0.3, 6), flat(C.brass, { metal: 0.6 }), -0.14 + i * 0.14, 0.74, -0.32);

    // 头：面巾 + 斗笠
    const h = r.head;
    part(h, Geo.box(0.34, 0.32, 0.32), flat(C.face), 0, 0.16, 0);
    part(h, Geo.box(0.36, 0.16, 0.34), flat(C.scarf), 0, 0.07, 0.01);
    this.glowPart(h, Geo.box(0.075, 0.035, 0.02), C.eye, C.eyeHot, 0.075, 0.22, 0.165);
    this.glowPart(h, Geo.box(0.075, 0.035, 0.02), C.eye, C.eyeHot, -0.075, 0.22, 0.165);
    part(h, Geo.cone(0.64, 0.26, 8, 'bottom'), flat(C.straw, { rough: 1 }), 0, 0.31, 0);
    part(h, Geo.cyl(0.2, 0.2, 0.05, 8), flat(C.strawDark), 0, 0.34, 0);
    // 头心：0.9 + 0.7 + 0.2 = 1.8（与 MORTAR_DEF.headY 一致）
    this.setHeadAnchor(h, 0, 0.2, 0);

    // 肩扛铜炮：挂点在右肩，按 rotation.x 前后倾
    const tube = joint(t, TUBE_X, TUBE_Y, TUBE_Z);
    tube.name = 'cannon'; // 挂点名：美术资产按它绑定（art/pipeline/registry.toml 的 blockout.attachment）
    this.tube = tube;
    const brass = flat(C.brass, { metal: 0.55, rough: 0.4 });
    part(tube, Geo.cyl(0.16, 0.19, TUBE_LEN, 8, 'bottom'), brass, 0, 0, 0);
    for (const y of [0.18, 0.62]) part(tube, Geo.torus(0.19, 0.03, 4, 10), flat(C.dark), 0, y, 0, Math.PI / 2, 0, 0);
    part(tube, Geo.torus(0.17, 0.04, 4, 10), brass, 0, TUBE_LEN, 0, Math.PI / 2, 0, 0);
    part(tube, Geo.ico(0.2), flat(C.dark), 0, -0.02, 0);
    this.glowPart(tube, Geo.disc(0.13, 10), C.mouth, C.mouthHot, 0, TUBE_LEN - 0.02, 0);

    // 左手引火绳
    const torch = joint(r.handL, 0, -0.06, 0.04);
    part(torch, Geo.cyl(0.02, 0.02, 0.22, 5), flat(C.dark), 0, 0, 0.06, Math.PI / 2, 0, 0);
    this.glowPart(torch, Geo.octa(0.05), C.ember, C.emberHot, 0, 0, 0.18);
    return root;
  }

  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    const a = this.pTilt;
    return this.localPoint(TUBE_X, HIP_Y + TUBE_Y + Math.cos(a) * TUBE_LEN, TUBE_Z + Math.sin(a) * TUBE_LEN, out);
  }

  protected override ai(dt: number): void {
    const d = this.distToPlayerXZ();
    if (this.smashCd > 0) this.smashCd -= dt * this.attackRate;
    switch (this.state) {
      case 'chase':
      case 'move': {
        this.glowTarget[0] = 0;
        if (d <= SMASH_RANGE && this.smashCd <= 0 && this.verticalReach(1.5) && this.requestAttack('melee', 1.3)) {
          this.windTime = this.windup(SMASH_WINDUP, 0.4);
          this.setState('smashWindup');
          this.ctx.audio.play('enemy_alert', { position: this.position, volume: 0.45, pitch: 0.9 });
          break;
        }
        const canLob = this.sees || d <= BLIND_FIRE_RANGE;
        if (!canLob && this.seekSight(MIN_RANGE - 3, MAX_RANGE, this.speed)) {
          this.faceMovement(4, dt);
          break;
        }
        this.keepRange(MIN_RANGE, MAX_RANGE, d < 7 ? this.speed * 1.3 : this.speed, 0.4);
        this.facePlayer(3, dt);
        if (this.cooldown <= 0 && canLob && d >= 6 && d <= 32) {
          if (this.requestAttack('heavy', BRACE_TIME + SHELLS * SHELL_GAP + 0.8)) {
            this.windTime = this.windup(BRACE_TIME, 0.6);
            this.setState('brace');
            this.ctx.audio.play('telegraph', { position: this.position, volume: 0.7, pitch: 0.7 });
          } else {
            this.cooldown = this.ctx.rng.range(0.5, 1.0);
          }
        }
        break;
      }
      case 'brace': {
        this.glowTarget[0] = clamp01(this.stateTime / this.windTime);
        this.facePlayer(3, dt);
        if (this.stateTime >= this.windTime) {
          this.shots = 0;
          this.shotTimer = 0;
          this.setState('fire');
        }
        break;
      }
      case 'fire': {
        this.glowTarget[0] = 1;
        this.facePlayer(2, dt);
        this.shotTimer -= dt;
        if (this.shotTimer <= 0) {
          this.fireShell(this.shots);
          this.shots++;
          this.shotTimer = SHELL_GAP / Math.sqrt(this.attackRate);
          if (this.shots >= SHELLS) {
            this.recoverTime = 0.8;
            this.setState('recover');
          }
        }
        break;
      }
      case 'smashWindup': {
        this.glowTarget[0] = 0.6;
        this.facePlayer(4, dt);
        if (this.stateTime >= this.windTime) {
          if (this.melee(SMASH_RANGE, this.def.damage * SMASH_DAMAGE_MULT, 0.3)) {
            const pl = this.ctx.player;
            _imp.set(pl.position.x - this.position.x, 0, pl.position.z - this.position.z);
            if (_imp.lengthSq() > 1e-4) {
              _imp.normalize().multiplyScalar(7);
              _imp.y = 3;
              pl.applyImpulse(_imp);
            }
            this.ctx.fx.shake(0.3, 0.2);
          }
          this.smashCd = this.ctx.rng.range(1.8, 2.8);
          this.recoverTime = 0.6;
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        this.glowTarget[0] = 0;
        this.facePlayer(2.5, dt);
        if (this.stateTime >= this.recoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          if (this.cooldown <= 0.5) this.rollCooldown(4.5, 6.5);
          this.setState('move');
        }
        break;
      }
      default:
        this.setState('move');
    }
  }

  /** 发射一发炮弹：落点按飞行时间做地面预警 */
  private fireShell(index: number): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    this.getMuzzle(_muzzle);
    const dist = Math.hypot(pl.position.x - _muzzle.x, pl.position.z - _muzzle.z);
    const T = clamp(1.1 + (dist / 30) * 0.5, 1.1, 1.6);
    if (index === 0) {
      // 预判一部分玩家移动
      _target.set(pl.position.x + pl.velocity.x * T * 0.5, pl.position.y, pl.position.z + pl.velocity.z * T * 0.5);
    } else {
      const a = ctx.rng.range(0, Math.PI * 2);
      const r = ctx.rng.range(2.2, 4);
      _target.set(pl.position.x + Math.cos(a) * r, pl.position.y, pl.position.z + Math.sin(a) * r);
    }
    const gy = ctx.world.groundHeight(_target.x, _target.z, pl.position.y + 1);
    _target.y = Number.isFinite(gy) ? gy : pl.position.y;
    const h = Math.hypot(_target.x - _muzzle.x, _target.z - _muzzle.z);
    ballisticVelocity(_muzzle, _target, Math.max(1, h / T), SHELL_GRAVITY, _vel);
    // 炮弹出膛后，落点预警不随炮兵死亡 / 眩晕撤销（炮弹照样落地）。
    // 只有炮弹半路就炸了（撞上高台边沿、掩体顶，或在空中撞上玩家）时撤掉落点预警，免得预警圈填满却没有爆炸。
    const landing = _target.clone();
    const cancelWarning = ctx.fx.groundWarning(landing, SHELL_RADIUS, T, 0xff7a2a);
    ctx.projectiles.spawn({
      owner: 'enemy',
      position: _muzzle.clone(),
      velocity: _vel.clone(),
      gravity: SHELL_GRAVITY,
      radius: 0.26,
      lifetime: T + 2,
      enemyDamage: this.def.damage * this.damageMult,
      explosionRadius: SHELL_RADIUS,
      explodeOnExpire: true,
      element: 'fire',
      color: 0xff9a3a,
      visual: 'grenade',
      scale: 1.4,
      sourceEnemy: this,
      onImpact: (point) => {
        if (point.distanceToSquared(landing) > SHELL_OFF_TARGET * SHELL_OFF_TARGET) cancelWarning();
      },
    });
    ctx.fx.burst(_muzzle, 0xffc070, 10, 4, 0.35, 0.1, 2);
    ctx.fx.burst(_muzzle, 0x6a5a4a, 8, 1.5, 0.9, 0.16, -1);
    ctx.audio.play('shot_launcher', { position: _muzzle, volume: 0.9, pitch: 0.7 });
    this.kick = 1;
  }

  protected override cancelAttack(): void {
    // 架炮阶段还没有地面预警；已经出膛的炮弹照样落地，它们的预警也不撤（见 fireShell）
    this.glowTarget[0] = 0;
    if (this.state === 'brace' || this.state === 'fire' || this.state === 'smashWindup' || this.state === 'recover') {
      this.setState('move');
      this.rollCooldown(1.5, 2.5);
    }
  }

  protected override pose(dt: number): void {
    const r = this.rig;
    applyWalk(r, this.walkPhase, this.walkAmp, 0.5);
    let tilt = -0.35;
    let crouch = 0;
    let armL = -0.5;
    let rate = 8;
    switch (this.state) {
      case 'brace': {
        const t = clamp01(this.stateTime / this.windTime);
        tilt = -0.35 + 1.05 * t;
        crouch = 0.14 * t;
        armL = -1.3;
        break;
      }
      case 'fire':
        tilt = 0.7;
        crouch = 0.14;
        armL = -1.3;
        break;
      case 'smashWindup':
        tilt = -1.2;
        armL = -0.3;
        rate = 10;
        break;
      case 'recover':
        tilt = this.shots >= SHELLS ? 0.4 : 0.9;
        crouch = 0.05;
        break;
    }
    const k = 1 - Math.exp(-rate * dt);
    this.pTilt = mix(this.pTilt, tilt, k);
    this.pCrouch = mix(this.pCrouch, crouch, k);
    this.pArmL = mix(this.pArmL, armL, k);
    this.kick = Math.max(0, this.kick - dt * 6);
    this.tube.rotation.x = this.pTilt - this.kick * 0.25;
    this.tube.position.y = TUBE_Y - this.kick * 0.06;
    // 右手扶炮、左手持引火绳
    r.armR.rotation.set(-2.4 + this.pTilt * 0.4, 0, -0.35);
    r.elbowR.rotation.x = -0.9;
    r.armL.rotation.x = this.pArmL;
    r.elbowL.rotation.x = -1.1;
    r.torso.rotation.x += this.kick * -0.08;
    applyCrouch(r, this.pCrouch);
    this.applyHurtAndStun(r);
  }
}
