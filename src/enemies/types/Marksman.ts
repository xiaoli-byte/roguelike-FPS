/**
 * 狙击手（marksman）：兜帽黑衣、单片镜发红光，手持长火枪。保持 18–32 米、寻找有视线的远处站位。
 * 瞄准共 1.5 秒：红色激光跟随玩家（略有滞后）；最后 0.25 秒锁定位置（激光吸附到玩家当前位置、
 * 变亮变粗、提示音），随后一次命中扫描：线段对玩家胶囊判定 + 静态几何遮挡，命中 30 伤害。
 * 瞄准中丢失视线超过 0.45 秒会放弃并换位；开火后也会换到另一个有视线的站位。
 *
 * 状态机：move → aim → lock → recover → relocate → move
 */
import * as THREE from 'three';
import type { EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import type { StaticBox, WorldRayHit } from '../../world/Collision';
import { clamp01, rayVerticalCapsule } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import { Geo, applyWalk, buildHumanoid, flat, joint, newAdditive, part, reachWeaponGrip, type HumanoidRig } from '../Models';

export const MARKSMAN_DEF: EnemyDef = {
  id: 'marksman',
  name: '狙击手',
  hp: 80,
  speed: 4.6,
  radius: 0.4,
  height: 1.8,
  damage: 30,
  coins: [3, 5],
  essence: 1,
  // 头部 = 兜帽（1.50 → 1.87，宽 0.35）；判定球随头骨移动，瞄准低头时跟着走
  headY: 1.69,
  headRadius: 0.22,
  knockbackResist: 0,
  color: 0xff3040,
};

const MIN_RANGE = 18;
const MAX_RANGE = 32;
/** 总瞄准时长与其中的锁定时长 */
const AIM_TOTAL = 1.5;
const LOCK_TIME = 0.25;
/** 锁定瞬间对玩家水平速度的预判比例（很小：全速移动即可闪开，慢走 / 开镜平移会被命中） */
const LOCK_LEAD = 0.25;
const MAX_SHOT = 90;
/** 枪的挂点（相对髋）与枪长 */
const HIP_Y = 0.88;
const GUN_X = -0.12;
const GUN_Y = 0.46;
const GUN_Z = 0.18;
const GUN_LEN = 1.3;

const C = {
  coat: 0x2e3650, cloak: 0x1f2536, leg: 0x2a2f3e, shin: 0x232733, boot: 0x16181f, glove: 0x1a1a1f,
  scarf: 0x8a1f24, shadow: 0x0a0a10, wood: 0x5a3a22, metal: 0x2a2a30, gold: 0xb8913e,
  eye: 0xa01818, eyeHot: 0xffffff, eye2: 0x601010, eye2Hot: 0xff6060, lens: 0x801010, lensHot: 0xffe0e0,
};

const _muzzle = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _hit: WorldRayHit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as unknown as StaticBox };

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

export class Marksman extends StandardEnemy {
  private rig!: HumanoidRig;
  private gun!: THREE.Group;
  private scarfTail!: THREE.Group;
  private laser: THREE.Group | null = null;
  private laserCore: THREE.MeshBasicMaterial | null = null;
  private laserHalo: THREE.MeshBasicMaterial | null = null;
  private laserCoreMesh: THREE.Mesh | null = null;
  private laserHaloMesh: THREE.Mesh | null = null;
  private readonly aimPoint = new THREE.Vector3();
  private trackTime = AIM_TOTAL - LOCK_TIME;
  private lostTime = 0;
  private pitch = 0;
  private recoil = 0;
  private pAim = 0;
  private readonly lastSpot = new THREE.Vector3();

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, MARKSMAN_DEF, opts);
    this.cooldown = ctx.rng.range(1.5, 3);
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const r = buildHumanoid(root, {
      hipY: HIP_Y, hipX: 0.12, thigh: 0.45, legW: 0.14,
      legColor: C.leg, shinColor: C.shin, footColor: C.boot,
      torsoW: 0.42, torsoH: 0.6, torsoD: 0.26, torsoColor: C.coat,
      shoulderX: 0.27, shoulderY: 0.52, upperArm: 0.3, foreArm: 0.28, armW: 0.11,
      armColor: C.coat, handColor: C.glove,
      neckY: 0.62,
    });
    this.rig = r;
    const t = r.torso;
    // 长披风、围巾（尾端随动）、皮带
    part(t, Geo.box(0.46, 0.95, 0.04, 'top'), flat(C.cloak), 0, 0.6, -0.15, 0.08, 0, 0);
    part(t, Geo.box(0.44, 0.1, 0.3), flat(C.scarf), 0, 0.57, 0);
    const tail = joint(t, 0.1, 0.56, -0.15);
    part(tail, Geo.box(0.1, 0.42, 0.03, 'top'), flat(C.scarf), 0, 0, 0);
    this.scarfTail = tail;
    part(t, Geo.box(0.44, 0.07, 0.28), flat(C.boot), 0, 0.08, 0);
    part(t, Geo.box(0.08, 0.1, 0.05), flat(C.gold, { metal: 0.6 }), 0, 0.08, 0.14);
    part(r.hips, Geo.box(0.44, 0.3, 0.28, 'top'), flat(C.coat), 0, -0.02, 0);

    // 兜帽 + 阴影脸 + 单片镜红眼
    const h = r.head;
    part(h, Geo.box(0.35, 0.37, 0.36), flat(C.cloak), 0, 0.18, -0.01);
    part(h, Geo.cone(0.14, 0.26, 4), flat(C.cloak), 0, 0.3, -0.2, -1.1, 0, 0);
    part(h, Geo.box(0.27, 0.25, 0.04), flat(C.shadow), 0, 0.15, 0.17);
    this.glowPart(h, Geo.box(0.085, 0.085, 0.02), C.eye, C.eyeHot, 0.07, 0.18, 0.195);
    this.glowPart(h, Geo.box(0.05, 0.03, 0.02), C.eye2, C.eye2Hot, -0.07, 0.18, 0.192);
    part(h, Geo.torus(0.055, 0.012, 4, 10), flat(C.gold, { metal: 0.7 }), 0.07, 0.18, 0.2);
    // 头心：0.88 + 0.62 + 0.19 = 1.69（与 MARKSMAN_DEF.headY 一致）
    this.setHeadAnchor(h, 0, 0.19, 0.02);

    // 长火枪（挂在右肩窝，瞄准时按俯仰抬起）
    const gun = joint(t, GUN_X, GUN_Y, GUN_Z);
    gun.name = 'musket'; // 挂点名：美术资产按它绑定（art/pipeline/registry.toml 的 blockout.attachment）
    this.gun = gun;
    part(gun, Geo.box(0.07, 0.13, 0.36), flat(C.wood), 0, -0.02, -0.02);
    part(gun, Geo.box(0.06, 0.07, 0.6), flat(C.wood), 0, 0, 0.42);
    part(gun, Geo.cyl(0.026, 0.032, 1.05, 6), flat(C.metal, { metal: 0.6, rough: 0.4 }), 0, 0.03, 0.78, Math.PI / 2, 0, 0);
    for (const z of [0.5, 0.95]) part(gun, Geo.box(0.07, 0.08, 0.03), flat(C.gold, { metal: 0.6 }), 0, 0.02, z);
    part(gun, Geo.cyl(0.035, 0.035, 0.3, 6), flat(C.metal, { metal: 0.6 }), 0, 0.1, 0.34, Math.PI / 2, 0, 0);
    this.glowPart(gun, Geo.octa(0.04), C.lens, C.lensHot, 0, 0.1, 0.51);
    return root;
  }

  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    const p = this.pitch;
    return this.localPoint(GUN_X, HIP_Y + GUN_Y + Math.sin(p) * GUN_LEN, GUN_Z + Math.cos(p) * GUN_LEN, out);
  }

  protected override ai(dt: number): void {
    const d = this.distToPlayerXZ();
    switch (this.state) {
      case 'chase':
      case 'move': {
        this.glowTarget[0] = 0;
        if (this.seekSight(MIN_RANGE - 4, MAX_RANGE, this.speed)) {
          this.faceMovement(6, dt);
          break;
        }
        this.keepRange(MIN_RANGE, MAX_RANGE, d < 10 ? this.speed * 1.2 : this.speed, 0.45);
        this.facePlayer(5, dt);
        if (this.cooldown <= 0 && this.sees && d >= 7 && d <= 60 && this.facingDot() > 0.85) {
          if (this.requestAttack('heavy', AIM_TOTAL + 0.8)) {
            this.startAim();
          } else {
            this.cooldown = this.ctx.rng.range(0.4, 0.9);
          }
        }
        break;
      }
      case 'aim': {
        this.facePlayer(8, dt);
        this.playerChest(_chest);
        // 激光略滞后地跟随玩家
        this.aimPoint.lerp(_chest, 1 - Math.exp(-7 * dt));
        this.lostTime = this.sees ? 0 : this.lostTime + dt;
        if (this.lostTime > 0.45) {
          this.abortAim();
          break;
        }
        const t = clamp01(this.stateTime / this.trackTime);
        this.glowTarget[0] = 0.3 + t * 0.5;
        this.updateLaser(0.25 + t * 0.35, 1);
        if (this.stateTime >= this.trackTime) {
          this.lockAim();
          this.setState('lock');
          this.ctx.audio.play('telegraph', { position: this.position, volume: 1, pitch: 1.8 });
        }
        break;
      }
      case 'lock': {
        this.glowTarget[0] = 1;
        const flash = 0.8 + 0.2 * Math.sin(this.stateTime * 80);
        this.updateLaser(flash, 2.2);
        if (this.stateTime >= LOCK_TIME) {
          this.fire();
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        this.glowTarget[0] = 0;
        if (this.stateTime >= 0.5) {
          this.releaseAttack();
          this.rollCooldown(3.0, 4.5);
          this.lastSpot.copy(this.position);
          // 开火后换一个离当前位置有一定距离的站位
          this.hasVantage = this.findRelocation();
          this.setState(this.hasVantage ? 'relocate' : 'move');
        }
        break;
      }
      case 'relocate': {
        this.glowTarget[0] = 0;
        const arrived = this.navigate(this.vantage, this.speed * 1.15, 0.8);
        this.faceMovement(7, dt);
        if (arrived || this.stateTime > 3.5) {
          this.hasVantage = false;
          this.setState('move');
        }
        break;
      }
      default:
        this.setState('move');
    }
  }

  private startAim(): void {
    this.trackTime = Math.max(1.0, this.windup(AIM_TOTAL - LOCK_TIME, 1.0));
    this.lostTime = 0;
    this.playerChest(this.aimPoint);
    this.setState('aim');
    this.ensureLaser();
  }

  /**
   * 锁定：瞄准点吸附到玩家当前位置（激光明显跳到玩家身上，作为提示），只做很小的速度预判。
   * 站桩或慢速平移会被命中；全速移动、变向或冲刺即可闪避。
   */
  private lockAim(): void {
    const pl = this.ctx.player;
    this.playerChest(this.aimPoint);
    this.aimPoint.x += pl.velocity.x * LOCK_TIME * LOCK_LEAD;
    this.aimPoint.z += pl.velocity.z * LOCK_TIME * LOCK_LEAD;
  }

  private findRelocation(): boolean {
    for (let i = 0; i < 3; i++) {
      if (this.findVantage(MIN_RANGE, MAX_RANGE, this.headY, _end, 5) && _end.distanceToSquared(this.lastSpot) > 25) {
        this.vantage.copy(_end);
        return true;
      }
    }
    return false;
  }

  /** 命中扫描：线段对玩家竖直胶囊 + 静态几何遮挡 */
  private fire(): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    this.getMuzzle(_muzzle);
    _dir.subVectors(this.aimPoint, _muzzle);
    if (_dir.lengthSq() < 1e-6) _dir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    _dir.normalize();
    const wall = ctx.world.raycast(_muzzle, _dir, MAX_SHOT, _hit);
    const wallDist = wall ? wall.distance : MAX_SHOT;
    const r = pl.radius + 0.1;
    const px = pl.position.x;
    const pz = pl.position.z;
    const tp = pl.alive
      ? rayVerticalCapsule(_muzzle, _dir, px, pz, pl.position.y + r, pl.position.y + Math.max(r, pl.height - r), r)
      : -1;
    let endDist = wallDist;
    if (tp >= 0 && tp < wallDist) {
      _end.copy(_muzzle).addScaledVector(_dir, tp);
      if (!ctx.world.segmentBlocked(_muzzle, _end)) {
        endDist = tp;
        ctx.combat.damagePlayer(this.def.damage * this.damageMult, 'none', this, _muzzle);
      }
    }
    _end.copy(_muzzle).addScaledVector(_dir, endDist);
    const from = _muzzle.clone();
    const to = _end.clone();
    ctx.fx.tracer(from, to, 0xff5040, 0.06);
    ctx.fx.beam(from, to, 0xff3020, 0.1, 0.12);
    if (wall && endDist === wallDist) ctx.fx.impact(_end, wall.normal, 0xff8060, 0.8);
    ctx.fx.burst(_muzzle, 0xffc080, 10, 5, 0.25, 0.08, 0);
    ctx.audio.play('shot_sniper', { position: _muzzle, volume: 1, pitch: 0.8 });
    this.recoil = 1;
    this.hideLaser();
  }

  /** 瞄准中丢失视线：收起激光并换位 */
  private abortAim(): void {
    this.hideLaser();
    this.releaseAttack();
    this.cooldown = 1.0;
    this.glowTarget[0] = 0;
    this.lastSpot.copy(this.position);
    this.hasVantage = this.findRelocation();
    this.setState(this.hasVantage ? 'relocate' : 'move');
  }

  // ───────────── 激光 ─────────────

  private ensureLaser(): void {
    if (!this.laser) {
      const g = new THREE.Group();
      this.laserCore = this.ownMaterial(newAdditive(0xff3030, 0.9));
      this.laserHalo = this.ownMaterial(newAdditive(0xff2010, 0.25));
      this.laserCoreMesh = new THREE.Mesh(Geo.beam(), this.laserCore);
      this.laserHaloMesh = new THREE.Mesh(Geo.beam(), this.laserHalo);
      this.laserCoreMesh.frustumCulled = false;
      this.laserHaloMesh.frustumCulled = false;
      g.add(this.laserCoreMesh, this.laserHaloMesh);
      g.renderOrder = 3;
      this.laser = g;
    }
    if (!this.laser.parent) this.ctx.stageGroup.add(this.laser);
    this.laser.visible = true;
  }

  /**
   * 每帧更新激光：从枪口指向瞄准点，终点裁剪到墙体或玩家。
   * @param intensity 亮度 0..1
   * @param widthMul 宽度倍率（锁定时变粗）
   */
  private updateLaser(intensity: number, widthMul: number): void {
    if (!this.laser || !this.laserCore || !this.laserHalo || !this.laserCoreMesh || !this.laserHaloMesh) return;
    if (!this.laser.parent) this.ctx.stageGroup.add(this.laser);
    const ctx = this.ctx;
    const pl = ctx.player;
    this.getMuzzle(_muzzle);
    _dir.subVectors(this.aimPoint, _muzzle);
    if (_dir.lengthSq() < 1e-6) return;
    _dir.normalize();
    const wall = ctx.world.raycast(_muzzle, _dir, MAX_SHOT, _hit);
    let len = wall ? wall.distance : MAX_SHOT;
    const r = pl.radius;
    const tp = rayVerticalCapsule(_muzzle, _dir, pl.position.x, pl.position.z, pl.position.y + r, pl.position.y + Math.max(r, pl.height - r), r);
    if (tp >= 0 && tp < len) len = tp;
    _end.copy(_muzzle).addScaledVector(_dir, len);
    this.laser.position.copy(_muzzle);
    this.laser.lookAt(_end);
    const w = 0.028 * widthMul;
    this.laserCoreMesh.scale.set(w, w, len);
    this.laserHaloMesh.scale.set(w * 4.5, w * 4.5, len);
    this.laserCore.opacity = 0.45 + intensity * 0.55;
    this.laserHalo.opacity = 0.08 + intensity * 0.22;
    this.laser.visible = true;
  }

  private hideLaser(): void {
    if (this.laser) {
      this.laser.visible = false;
      this.laser.removeFromParent();
    }
  }

  protected override cancelAttack(): void {
    this.hideLaser();
    this.glowTarget[0] = 0;
    if (this.state === 'aim' || this.state === 'lock') {
      this.setState('move');
      this.rollCooldown(1, 1.8);
    }
  }

  protected override onDispose(): void {
    super.onDispose();
    this.hideLaser();
    this.laser = null;
  }

  protected override pose(dt: number): void {
    const r = this.rig;
    applyWalk(r, this.walkPhase, this.walkAmp, 0.5);
    const aiming = this.state === 'aim' || this.state === 'lock';
    if (aiming) {
      this.getMuzzle(_muzzle);
      this.pitch = mix(this.pitch, Math.max(-0.8, Math.min(0.8, this.pitchTo(_muzzle, this.aimPoint))), 1 - Math.exp(-12 * dt));
    } else {
      this.pitch = mix(this.pitch, 0, 1 - Math.exp(-6 * dt));
    }
    const k = 1 - Math.exp(-10 * dt);
    this.pAim = mix(this.pAim, aiming || this.state === 'recover' ? 1 : 0, k);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    const a = this.pAim;
    // 平时斜持枪（枪口朝上），瞄准时抵肩平举
    this.gun.rotation.set(mix(-1.1, -this.pitch, a) - this.recoil * 0.35, mix(0.5, 0, a), mix(0.5, 0, a));
    this.gun.position.set(mix(GUN_X + 0.06, GUN_X, a), mix(GUN_Y - 0.12, GUN_Y, a), GUN_Z - this.recoil * 0.1);
    r.head.rotation.x = -this.pitch * 0.5;
    r.torso.rotation.x -= this.recoil * 0.12;
    this.scarfTail.rotation.x = 0.3 + Math.sin(this.age * 3) * 0.12 + Math.hypot(this.velocity.x, this.velocity.z) * 0.08;
    this.applyHurtAndStun(r);
    reachWeaponGrip(r, -1, this.gun, 0, -0.085, 0.025);
    reachWeaponGrip(r, 1, this.gun, 0, -0.055, 0.22);
  }
}
