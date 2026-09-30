/**
 * 骨弩手（archer）：保持 12–20 米并横移；举弩 0.55 秒前摇（弩矢发光）后连射 3 发慢速弩矢。
 * 没有视线时寻找能看到玩家的站位。
 *
 * 状态机：move → aim → fire → recover → move
 */
import * as THREE from 'three';
import type { EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { StandardEnemy } from '../StandardEnemy';
import { Geo, applyWalk, buildHumanoid, flat, joint, part, type HumanoidRig } from '../Models';

export const ARCHER_DEF: EnemyDef = {
  id: 'archer',
  name: '骨弩手',
  hp: 70,
  speed: 5.0,
  radius: 0.4,
  height: 1.75,
  damage: 8,
  coins: [2, 4],
  essence: 1,
  headY: 1.58,
  headRadius: 0.33,
  knockbackResist: 0,
  color: 0x9dff7a,
};

const MIN_RANGE = 12;
const MAX_RANGE = 20;
const AIM_TIME = 0.55;
const SHOTS = 3;
const SHOT_GAP = 0.22;
const BOLT_SPEED = 16;
/** 弩在躯干上的挂点（相对髋）与弩长 */
const BOW_Y = 0.44;
const BOW_Z = 0.22;
const BOW_LEN = 0.56;

const C = {
  bone: 0xe3d8bd, boneDark: 0xc8b996, cloak: 0x2f3a30, cloakDark: 0x222b23, wood: 0x6b4a2a,
  string: 0xd8d0b8, eye: 0x48c060, eyeHot: 0xd8ffc0, bolt: 0x3a7a40, boltHot: 0xc8ffb0,
};

const _muzzle = new THREE.Vector3();
const _chest = new THREE.Vector3();

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

export class Archer extends StandardEnemy {
  private rig!: HumanoidRig;
  private bow!: THREE.Group;
  private aimTime = AIM_TIME;
  private shots = 0;
  private shotTimer = 0;
  private pitch = 0;
  private recoil = 0;
  private pAim = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, ARCHER_DEF, opts);
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const r = buildHumanoid(root, {
      hipY: 0.84, hipX: 0.11, thigh: 0.42, legW: 0.085,
      legColor: C.bone, footColor: C.boneDark,
      torsoW: 0.1, torsoH: 0.58, torsoD: 0.09, torsoColor: C.boneDark,
      shoulderX: 0.24, shoulderY: 0.5, upperArm: 0.29, foreArm: 0.27, armW: 0.07,
      armColor: C.bone, handColor: C.boneDark,
      neckY: 0.6,
    });
    this.rig = r;
    const t = r.torso;
    // 骨盆与肋骨
    part(r.hips, Geo.box(0.3, 0.12, 0.16), flat(C.boneDark), 0, 0.02, 0);
    for (let i = 0; i < 4; i++) {
      const w = 0.36 - i * 0.03;
      part(t, Geo.box(w, 0.045, 0.24 - i * 0.02), flat(C.bone), 0, 0.2 + i * 0.1, 0.01);
    }
    // 破烂斗篷与披肩
    part(t, Geo.box(0.46, 0.12, 0.3), flat(C.cloak), 0, 0.56, -0.01);
    part(t, Geo.box(0.44, 0.78, 0.04, 'top'), flat(C.cloakDark), 0, 0.6, -0.15, 0.12, 0, 0);
    part(t, Geo.box(0.16, 0.3, 0.04, 'top'), flat(C.cloak), 0.14, -0.16, -0.19, 0.2, 0, 0.1);
    part(t, Geo.cyl(0.06, 0.06, 0.46, 5), flat(C.wood), 0.13, 0.36, -0.2, 0.25, 0, -0.35);

    // 骷髅头 + 兜帽 + 绿色鬼火眼
    const h = r.head;
    part(h, Geo.box(0.06, 0.1, 0.06), flat(C.boneDark), 0, 0.02, 0);
    part(h, Geo.box(0.3, 0.29, 0.32), flat(C.bone), 0, 0.2, 0.01);
    part(h, Geo.box(0.23, 0.08, 0.22), flat(C.boneDark), 0, 0.04, 0.05);
    this.glowPart(h, Geo.box(0.085, 0.065, 0.02), C.eye, C.eyeHot, 0.075, 0.22, 0.17);
    this.glowPart(h, Geo.box(0.085, 0.065, 0.02), C.eye, C.eyeHot, -0.075, 0.22, 0.17);
    part(h, Geo.box(0.37, 0.2, 0.37), flat(C.cloak), 0, 0.36, -0.03);
    part(h, Geo.box(0.37, 0.32, 0.08), flat(C.cloak), 0, 0.22, -0.18);

    // 弩（挂在躯干上，按俯仰瞄准）
    const bow = joint(t, 0.02, BOW_Y, BOW_Z);
    this.bow = bow;
    part(bow, Geo.box(0.07, 0.08, 0.62), flat(C.wood), 0, 0, 0.14);
    part(bow, Geo.box(0.24, 0.045, 0.05), flat(C.bone), 0.11, 0.02, 0.42, 0, 0.32, 0);
    part(bow, Geo.box(0.24, 0.045, 0.05), flat(C.bone), -0.11, 0.02, 0.42, 0, -0.32, 0);
    part(bow, Geo.box(0.4, 0.012, 0.012), flat(C.string), 0, 0.03, 0.34);
    this.glowPart(bow, Geo.box(0.025, 0.025, 0.36), C.bolt, C.boltHot, 0, 0.055, 0.3);
    part(bow, Geo.cone(0.035, 0.08, 4), flat(C.boneDark), 0, 0.055, 0.5, Math.PI / 2, 0, 0);
    return root;
  }

  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    const L = BOW_LEN;
    return this.localPoint(0.02, 0.84 + BOW_Y + Math.sin(this.pitch) * L, BOW_Z + Math.cos(this.pitch) * L, out);
  }

  protected override ai(dt: number): void {
    const d = this.distToPlayerXZ();
    this.getMuzzle(_muzzle);
    this.pitch = Math.max(-0.9, Math.min(0.9, this.pitchTo(_muzzle, this.playerChest(_chest))));
    switch (this.state) {
      case 'chase':
      case 'move': {
        this.glowTarget[0] = 0;
        if (this.seekSight(MIN_RANGE - 2, MAX_RANGE, this.speed)) {
          this.faceMovement(8, dt);
          break;
        }
        const close = d < 6;
        this.keepRange(MIN_RANGE, MAX_RANGE, close ? this.speed * 1.15 : this.speed);
        this.facePlayer(6, dt);
        if (this.cooldown <= 0 && this.sees && d >= 4 && d <= 28 && this.facingDot() > 0.8) {
          if (this.requestAttack('ranged', AIM_TIME + SHOTS * SHOT_GAP + 0.6)) {
            this.aimTime = this.windup(AIM_TIME, 0.35);
            this.setState('aim');
          } else {
            this.cooldown = this.ctx.rng.range(0.3, 0.7);
          }
        }
        break;
      }
      case 'aim': {
        this.glowTarget[0] = Math.min(1, this.stateTime / this.aimTime);
        this.facePlayer(7, dt);
        this.setMove(-Math.cos(this.facing) * this.strafeSign, Math.sin(this.facing) * this.strafeSign, this.speed * 0.2);
        if (!this.sees && this.blindTime > 0.3) {
          this.abortAim();
          break;
        }
        if (this.stateTime >= this.aimTime) {
          this.shots = 0;
          this.shotTimer = 0;
          this.setState('fire');
        }
        break;
      }
      case 'fire': {
        this.glowTarget[0] = 1;
        this.facePlayer(6, dt);
        this.shotTimer -= dt;
        if (this.shotTimer <= 0) {
          this.shoot({
            speed: BOLT_SPEED, damage: this.def.damage, radius: 0.16, color: 0x9dff7a,
            lead: 0.3, spread: 0.018, visual: 'arrow', lifetime: 4, from: this.getMuzzle(_muzzle),
          });
          this.recoil = 1;
          this.shots++;
          this.shotTimer = SHOT_GAP / Math.sqrt(this.attackRate);
          if (this.shots >= SHOTS) this.setState('recover');
        }
        break;
      }
      case 'recover': {
        this.glowTarget[0] = 0;
        this.keepRange(MIN_RANGE, MAX_RANGE, this.speed * 0.7);
        this.facePlayer(5, dt);
        if (this.stateTime >= 0.35) {
          this.releaseAttack();
          this.rollCooldown(2.2, 3.4);
          this.setState('move');
        }
        break;
      }
      default:
        this.setState('move');
    }
  }

  private abortAim(): void {
    this.releaseAttack();
    this.glowTarget[0] = 0;
    this.cooldown = 0.6;
    this.setState('move');
  }

  protected override cancelAttack(): void {
    this.glowTarget[0] = 0;
    if (this.state === 'aim' || this.state === 'fire' || this.state === 'recover') {
      this.setState('move');
      this.rollCooldown(0.8, 1.4);
    }
  }

  protected override pose(dt: number): void {
    const r = this.rig;
    applyWalk(r, this.walkPhase, this.walkAmp, 0.4);
    const aiming = this.state === 'aim' || this.state === 'fire';
    const k = 1 - Math.exp(-12 * dt);
    this.pAim = mix(this.pAim, aiming ? 1 : 0.35, k);
    this.recoil = Math.max(0, this.recoil - dt * 7);
    // 双手托弩：右手扣扳机、左手托前端
    const a = this.pAim;
    r.armR.rotation.set(-0.7 - a * 0.55, 0, -0.15);
    r.elbowR.rotation.x = -1.0 + a * 0.25;
    r.armL.rotation.set(-0.9 - a * 0.55, 0, 0.35);
    r.elbowL.rotation.x = -0.7;
    const pitch = aiming ? this.pitch : this.pitch * 0.3 - 0.35;
    this.bow.rotation.x = mix(this.bow.rotation.x, -pitch, k);
    this.bow.position.z = BOW_Z - this.recoil * 0.07;
    this.bow.position.y = BOW_Y + (aiming ? 0 : -0.12);
    r.torso.rotation.x -= this.recoil * 0.08;
    r.head.rotation.x = -pitch * 0.4;
    this.applyHurtAndStun(r);
  }
}
