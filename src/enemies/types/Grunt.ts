/**
 * 沙匪刀客（grunt）：近战冲锋。0.35 秒举刀前摇后劈砍；中距离偶尔蓄势突进。
 *
 * 状态机：chase → windup → slash → recover → chase
 *                chase → lungeWindup → lunge → recover → chase
 */
import * as THREE from 'three';
import type { EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import { Geo, applyCrouch, applyWalk, buildHumanoid, flat, joint, part, type HumanoidRig } from '../Models';

export const GRUNT_DEF: EnemyDef = {
  id: 'grunt',
  name: '沙匪刀客',
  hp: 80,
  speed: 6.5,
  radius: 0.42,
  height: 1.8,
  damage: 12,
  coins: [2, 4],
  essence: 1,
  // 头部 = 缠头巾的头（颈 1.52 → 巾顶 1.92，宽 0.37）；判定球随头骨移动（见 setHeadAnchor）
  headY: 1.71,
  headRadius: 0.22,
  knockbackResist: 0,
  color: 0xe0913a,
};

const SLASH_RANGE = 2.0;
const ENGAGE_RANGE = 2.2;
const SLASH_WINDUP = 0.35;
const LUNGE_WINDUP = 0.45;
const LUNGE_SPEED = 15;
const LUNGE_TIME = 0.4;
const LUNGE_DAMAGE_MULT = 1.6;
/** 突进预判比例 */
const LUNGE_LEAD = 0.6;
/** 举刀前摇期间的贴近速度（相对移速） */
const WINDUP_CHASE = 0.55;

const C = {
  robe: 0xbf9458, vest: 0x7a5436, sash: 0xa3282b, pants: 0x5a4130, shin: 0x4a3526, boot: 0x2e2119,
  skin: 0x8a5a3c, wrap: 0xdcc89a, veil: 0x3a2a22, steel: 0xcfd6de, gold: 0xc9a24a, grip: 0x2a1d14,
  eye: 0xffa33a, eyeHot: 0xfff0b0, edge: 0x8f98a2, edgeHot: 0xffa640,
};

const _dir = new THREE.Vector3();
const _imp = new THREE.Vector3();

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

export class Grunt extends StandardEnemy {
  private rig!: HumanoidRig;
  private windTime = SLASH_WINDUP;
  private recoverTime = 0.42;
  private lungeCd: number;
  private lungeHit = false;
  private readonly lungeDir = new THREE.Vector3();
  // 平滑后的姿态参数
  private pArm = -0.5;
  private pElbow = -0.9;
  private pLean = 0;
  private pTwist = 0;
  private pCrouch = 0;
  private pArmL = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, GRUNT_DEF, opts);
    this.lungeCd = ctx.rng.range(2, 5);
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const r = buildHumanoid(root, {
      hipY: 0.86, hipX: 0.13, thigh: 0.44, legW: 0.17,
      legColor: C.pants, shinColor: C.shin, footColor: C.boot,
      torsoW: 0.5, torsoH: 0.62, torsoD: 0.3, torsoColor: C.robe,
      shoulderX: 0.31, shoulderY: 0.52, upperArm: 0.3, foreArm: 0.28, armW: 0.13,
      armColor: C.robe, foreColor: C.skin, handColor: C.veil,
      neckY: 0.62,
    });
    this.rig = r;
    const t = r.torso;
    // 皮甲背心、腰带、飘带
    part(t, Geo.box(0.53, 0.3, 0.33), flat(C.vest), 0, 0.42, 0);
    part(t, Geo.box(0.55, 0.1, 0.34), flat(C.sash), 0, 0.06, 0);
    part(t, Geo.box(0.08, 0.32, 0.03, 'top'), flat(C.sash), 0.16, 0.06, -0.18, 0.2, 0, 0.1);
    part(r.armL, Geo.box(0.2, 0.1, 0.24), flat(C.vest), 0, 0.02, 0);
    // 下摆
    part(r.hips, Geo.box(0.52, 0.22, 0.32, 'top'), flat(C.robe), 0, -0.02, 0);

    // 头：缠头巾 + 面纱 + 发光眼
    const h = r.head;
    part(h, Geo.box(0.16, 0.08, 0.16), flat(C.skin), 0, 0.02, 0);
    part(h, Geo.box(0.33, 0.33, 0.33), flat(C.wrap), 0, 0.2, 0);
    part(h, Geo.box(0.34, 0.14, 0.06), flat(C.veil), 0, 0.12, 0.155);
    this.glowPart(h, Geo.box(0.075, 0.035, 0.02), C.eye, C.eyeHot, 0.075, 0.235, 0.17);
    this.glowPart(h, Geo.box(0.075, 0.035, 0.02), C.eye, C.eyeHot, -0.075, 0.235, 0.17);
    part(h, Geo.box(0.37, 0.12, 0.37), flat(C.wrap), 0, 0.38, -0.01);
    part(h, Geo.ico(0.075), flat(C.sash), 0.1, 0.44, -0.12);
    part(h, Geo.box(0.08, 0.3, 0.05, 'top'), flat(C.wrap), 0, 0.36, -0.19, 0.35, 0, 0);
    // 头心：头骨关节上方 0.23（静止时离地 0.86 + 0.62 + 0.23 = 1.71，与 GRUNT_DEF.headY 一致）
    this.setHeadAnchor(h, 0, 0.23, 0.02);

    // 弯刀：握把朝下时刀身指向前方
    const blade = joint(r.handR, 0, -0.06, 0);
    blade.name = 'scimitar'; // 挂点名：美术资产按它绑定（art/pipeline/registry.toml 的 blockout.attachment）
    blade.rotation.x = -0.25;
    part(blade, Geo.box(0.045, 0.045, 0.18), flat(C.grip), 0, 0, -0.03);
    part(blade, Geo.box(0.14, 0.05, 0.05), flat(C.gold, { metal: 0.6, rough: 0.4 }), 0, 0, 0.08);
    part(blade, Geo.box(0.025, 0.085, 0.44), flat(C.steel, { metal: 0.7, rough: 0.3 }), 0, 0.01, 0.32);
    part(blade, Geo.box(0.025, 0.075, 0.3), flat(C.steel, { metal: 0.7, rough: 0.3 }), 0, 0.06, 0.62, -0.28, 0, 0);
    this.glowPart(blade, Geo.box(0.03, 0.02, 0.72), C.edge, C.edgeHot, 0, -0.035, 0.45);
    return root;
  }

  protected override ai(dt: number): void {
    const p = this.ctx.player.position;
    const d = this.distToPlayerXZ();
    switch (this.state) {
      case 'chase': {
        this.glowTarget[0] = 0;
        if (this.lungeCd > 0) this.lungeCd -= dt * this.attackRate;
        const reach = this.verticalReach(1.4);
        if (d <= ENGAGE_RANGE && this.cooldown <= 0 && reach && this.sees && this.requestAttack('melee', 1.4)) {
          this.windTime = this.windup(SLASH_WINDUP, 0.28);
          this.setState('windup');
          // 举刀低吼：身后的刀客也能听出来
          this.ctx.audio.play('enemy_alert', { position: this.position, volume: 0.42, pitch: 1.25 + this.ctx.rng.range(0, 0.15) });
          break;
        }
        if (this.lungeCd <= 0 && d >= 4.5 && d <= 9 && reach && this.sees) {
          if (this.directPathClear(p) && this.requestAttack('melee', 1.8)) {
            this.windTime = this.windup(LUNGE_WINDUP, 0.36);
            this.setState('lungeWindup');
            this.ctx.audio.play('enemy_charge', { position: this.position, volume: 0.55, pitch: 1.35 });
            break;
          }
          this.lungeCd = 0.7;
        }
        if (d > 3.2 || !this.sees || !reach) {
          this.approachPlayer(this.speed, 1.4);
          if (d < 4) this.facePlayer(10, dt);
          else this.faceMovement(10, dt);
        } else {
          // 近身时绕着玩家小幅横移再逼近，避免扎堆成一条线
          const dx = p.x - this.position.x;
          const dz = p.z - this.position.z;
          const s = this.strafeSign;
          const fwd = d > 1.5 ? 1 : 0;
          this.setMove(dx * fwd - dz * s * 0.6, dz * fwd + dx * s * 0.6, this.speed * 0.7);
          this.facePlayer(10, dt);
        }
        break;
      }
      case 'windup': {
        this.glowTarget[0] = 1;
        this.facePlayer(4.5, dt);
        // 举刀时仍以约一半速度贴近（原地站桩会被轻易拉开）
        if (d > 1.3) this.setMove(p.x - this.position.x, p.z - this.position.z, this.speed * WINDUP_CHASE);
        if (this.stateTime >= this.windTime) {
          this.melee(SLASH_RANGE, this.def.damage, 0.3);
          this.setState('slash');
        }
        break;
      }
      case 'slash': {
        this.glowTarget[0] = 0.4;
        this.setMove(Math.sin(this.facing), Math.cos(this.facing), 2.5);
        if (this.stateTime >= 0.16) {
          this.recoverTime = 0.42;
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        this.glowTarget[0] = 0;
        this.facePlayer(3, dt);
        if (this.stateTime >= this.recoverTime / Math.sqrt(this.attackRate)) {
          this.releaseAttack();
          this.rollCooldown(0.9, 1.7);
          this.setState('chase');
        }
        break;
      }
      case 'lungeWindup': {
        this.glowTarget[0] = 1;
        this.facePlayer(7, dt);
        if (this.stateTime >= this.windTime) {
          this.aimLunge();
          this.lungeHit = false;
          this.accel = 90;
          this.setState('lunge');
          this.ctx.audio.play('dash', { position: this.position, volume: 0.6, pitch: 0.8 });
        }
        break;
      }
      case 'lunge': {
        this.glowTarget[0] = 1;
        this.setMove(this.lungeDir.x, this.lungeDir.z, LUNGE_SPEED);
        this.checkLungeHit();
        const blocked = this.moveResult.hitWall && this.stateTime > 0.08;
        if (this.lungeHit || this.stateTime >= LUNGE_TIME || blocked) {
          this.accel = 28;
          this.lungeCd = this.ctx.rng.range(5, 8);
          this.recoverTime = 0.6;
          this.setState(this.lungeHit ? 'slash' : 'recover');
        }
        break;
      }
      default:
        this.setState('chase');
    }
  }

  /** 突进方向：朝玩家并按其水平速度预判一部分（变向或冲刺即可躲开） */
  private aimLunge(): void {
    const pl = this.ctx.player;
    const dx = pl.position.x - this.position.x;
    const dz = pl.position.z - this.position.z;
    const t = (Math.hypot(dx, dz) / LUNGE_SPEED) * LUNGE_LEAD;
    this.lungeDir.set(dx + pl.velocity.x * t, 0, dz + pl.velocity.z * t);
    if (this.lungeDir.lengthSq() < 1e-4) this.lungeDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    this.lungeDir.normalize();
    this.facing = Math.atan2(this.lungeDir.x, this.lungeDir.z);
  }

  private checkLungeHit(): void {
    if (this.lungeHit) return;
    const pl = this.ctx.player;
    const dx = pl.position.x - this.position.x;
    const dz = pl.position.z - this.position.z;
    if (Math.hypot(dx, dz) > this.radius + pl.radius + 0.55 || !this.verticalReach(1.4)) return;
    this.lungeHit = true;
    this.ctx.combat.damagePlayer(this.def.damage * LUNGE_DAMAGE_MULT * this.damageMult, 'none', this, this.position);
    _imp.copy(this.lungeDir).multiplyScalar(6);
    _imp.y = 2.5;
    pl.applyImpulse(_imp);
    this.ctx.fx.shake(0.35, 0.2);
    this.ctx.audio.play('enemy_melee', { position: this.position });
    _dir.set(pl.position.x, pl.position.y + 1.1, pl.position.z);
    this.ctx.fx.impact(_dir, null, 0xffc080, 0.8);
  }

  protected override cancelAttack(): void {
    this.accel = 28;
    this.glowTarget[0] = 0;
    if (this.state !== 'chase' && this.state !== 'idle') {
      this.setState('chase');
      this.rollCooldown(0.5, 1.0);
    }
  }

  protected override pose(dt: number): void {
    const r = this.rig;
    applyWalk(r, this.walkPhase, this.walkAmp);
    let arm = -0.45 - this.walkAmp * 0.2;
    let elbow = -0.9;
    let lean = 0;
    let twist = 0;
    let crouch = 0;
    let armL = r.armL.rotation.x;
    let rate = 16;
    switch (this.state) {
      case 'windup': {
        const t = clamp01(this.stateTime / this.windTime);
        arm = -2.75;
        elbow = -0.45;
        lean = -0.14;
        twist = -0.35;
        crouch = 0.06 * t;
        armL = -0.7;
        break;
      }
      case 'slash':
        arm = -0.3;
        elbow = -0.1;
        lean = 0.38;
        twist = 0.4;
        armL = 0.3;
        rate = 30;
        break;
      case 'recover':
        arm = -0.5;
        elbow = -0.45;
        lean = 0.12;
        twist = 0.15;
        break;
      case 'lungeWindup':
        arm = 0.75;
        elbow = -1.2;
        lean = 0.55;
        twist = -0.3;
        crouch = 0.24;
        armL = -0.9;
        break;
      case 'lunge':
        arm = -1.55;
        elbow = -0.05;
        lean = 0.5;
        crouch = 0.12;
        armL = 0.6;
        rate = 30;
        break;
    }
    const k = 1 - Math.exp(-rate * dt);
    this.pArm = mix(this.pArm, arm, k);
    this.pElbow = mix(this.pElbow, elbow, k);
    this.pLean = mix(this.pLean, lean, k);
    this.pTwist = mix(this.pTwist, twist, k);
    this.pCrouch = mix(this.pCrouch, crouch, k);
    this.pArmL = mix(this.pArmL, armL, k);
    r.armR.rotation.x = this.pArm;
    r.armR.rotation.z = -0.12;
    r.elbowR.rotation.x = this.pElbow;
    r.armL.rotation.x = this.pArmL;
    r.torso.rotation.x += this.pLean;
    r.torso.rotation.y += this.pTwist;
    applyCrouch(r, this.pCrouch);
    this.applyHurtAndStun(r);
  }
}
