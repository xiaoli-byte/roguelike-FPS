/**
 * 驼碑力士（camel_stele，第一章 · 赤沙古道的坦克）：双峰骆驼化成的巨汉，驼峰上绑着两块石碑，手里扛一面石碑当塔盾。
 * 弱点是两座驼峰之间发光的碑文（头部判定，在背上）：正面有石碑挡着，要绕到侧后方打。
 *
 * - 举碑推进：缓慢逼近，石碑挡在身前；正面来的伤害只吃 12%（打在碑上冒火星、铛的一声）。
 *   转身很慢（每秒约 1.4 弧度），绕侧后方就能打到背上的碑文。
 * - 砸地冲击波：6–15 米、看得见玩家时双手把石碑举过头（正面露出来）1.1 秒，地面出现一条直线预警，
 *   砸下后冲击波沿直线推进 15 米（撞墙停下），扫到地上的玩家造成重伤并掀起来；跳起来能躲。
 *   砸完石碑嵌在地上 1 秒：硬直、不格挡，是最好的输出窗口。精英一次推出三道（扇形 ±20°）。
 * - 碑撞：贴身 3 米内蓄力 0.55 秒，用石碑猛推：中等伤害、强击退（把玩家推出贴脸距离）。
 *
 * 状态机：advance → slamWindup → slam → recover → advance
 *         advance → shoveWindup → shove → advance
 */
import * as THREE from 'three';
import type { DamageRequest, EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { clamp01, rotateTowards } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { NativeBody } from '../../assets/NativeRig';
import { GroundDecal } from '../bosses/Visuals';
import { Geo, applyCrouch, applyWalk, buildHumanoid, flat, joint, part, reachWeaponGrip, type HumanoidRig } from '../Models';

export const CAMEL_STELE_DEF: EnemyDef = {
  id: 'camel_stele',
  name: '驼碑力士',
  hp: 300,
  armor: 80,
  speed: 2.8,
  radius: 0.75,
  height: 2.6,
  damage: 32,
  coins: [4, 6],
  essence: 2,
  // 弱点 = 两座驼峰之间的发光碑文（背上，离地约 2.2）；判定球挂在碑文骨上，弯腰砸碑时跟着走
  headY: 2.2,
  headRadius: 0.26,
  knockbackResist: 0.9,
  color: 0xd9a85a,
};

/** 正面格挡：举碑时，来自正面这个夹角（余弦）以内的伤害乘以 GUARD_FACTOR */
const GUARD_FACTOR = 0.12;
const GUARD_COS = 0.34;
/** 推进时转身的角速度（弧度/秒）：慢，绕侧后方才打得到弱点 */
const TURN_RATE = 1.4;
const SLAM_RANGE = [6, 15] as const;
const SLAM_WINDUP = 1.1;
const SLAM_COOLDOWN = [5, 7] as const;
/** 冲击波：起点在身前、长度、半宽、推进速度 */
const WAVE_START = 1.6;
const WAVE_LENGTH = 15;
const WAVE_HALF_WIDTH = 1.1;
const WAVE_SPEED = 15;
const WAVE_DAMAGE_MULT = 1.0;
/** 跳起高于这个高度（米）就躲过冲击波 */
const WAVE_JUMP_CLEAR = 0.6;
const RECOVER_TIME = 1.0;
const SHOVE_RANGE = 3.0;
const SHOVE_WINDUP = 0.55;
const SHOVE_DAMAGE_MULT = 0.6;
const SHOVE_KNOCK = 10;

const C = {
  fur: 0x9a6a3e, furDark: 0x6e4528, skin: 0xc49a6c, muzzle: 0xd8c09a, stone: 0x8f877a, stoneDark: 0x6e675c,
  rope: 0x9e2f2a, bronze: 0xb8913e, cloth: 0x3f7f7a, wrap: 0xd8c8a4, hoof: 0x4a3a2c,
  glyph: 0xc88a2a, glyphHot: 0xfff0b0, warn: 0xffb040, dust: 0xc8a06a, spark: 0xffe6a0,
};

/** 美术身体：白模躯干局部的石碑位姿 → 模型空间（美术髋部比白模高） */
const ART_STELE_Y = 1.3;
const ART_STELE_Z = 0.1;
/** 双足步态（美术骨骼）：步频、触地比例、抬脚高度、一步最多扫过多远 */
const GAIT_FREQ = [0.9, 1.4] as const;
const GAIT_DUTY = 0.62;
const GAIT_LIFT = 0.12;
const GAIT_SWEEP = 0.55;
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _g = new THREE.Vector3();
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();

/** 每个 GameContext 只注册一次全局伤害修正（正面格挡） */
const guardInstalled = new WeakSet<object>();

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

export class CamelStele extends StandardEnemy {
  private rig!: HumanoidRig;
  /** 石碑盾挂点（美术资产 SM_EnemyWeapon_CamelStele 挂在这里）：原点在碑心，正面朝 +Z */
  private stele!: THREE.Group;
  private windTime = SLAM_WINDUP;
  private slamCd: number;
  private shoveHit = false;
  private lane: GroundDecal | null = null;
  private blockFxAt = 0;
  // 平滑后的石碑位姿（躯干局部）与身体姿态
  private pSteleY = 0.15;
  private pSteleZ = 0.75;
  private pSteleTilt = 0;
  private pCrouch = 0;
  private pLean = 0;
  /** 步态相位（美术骨骼） */
  private gait = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, CAMEL_STELE_DEF, opts);
    this.walkScale = 0.45;
    this.stepRate = 1.8;
    this.slamCd = ctx.rng.range(2, 4);
    installGuard(ctx);
  }

  /** 举碑格挡中（推进、碑撞蓄力）；举过头、砸地、硬直时不挡 */
  get guarding(): boolean {
    return this.alive && this.stunTime <= 0 && (this.state === 'advance' || this.state === 'shoveWindup' || this.state === 'shove');
  }

  /** 这次伤害的倍率：正面被石碑挡住时大幅减伤，并在碑面冒火星 */
  guardFactor(req: DamageRequest): number {
    if (!this.guarding || req.source === 'status') return 1;
    // 来袭方向：有飞行方向就用它（子弹从哪边来），否则按玩家位置
    if (req.direction) _v.set(-req.direction.x, 0, -req.direction.z);
    else _v.set(this.ctx.player.position.x - this.position.x, 0, this.ctx.player.position.z - this.position.z);
    const len = _v.length();
    if (len < 1e-4) return 1;
    _f.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    if (_v.dot(_f) / len < GUARD_COS) return 1;
    const now = this.ctx.time.now;
    if (now - this.blockFxAt > 0.08) {
      this.blockFxAt = now;
      this.stele.updateWorldMatrix(true, false);
      _p.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.3) * 0.9, 0.16).applyMatrix4(this.stele.matrixWorld);
      this.ctx.fx.burst(_p, C.spark, 5, 4, 0.25, 0.05, 6);
      this.ctx.audio.play('shield_break', { position: _p, volume: 0.35, pitch: 1.6 });
    }
    // 从正面斜着擦到背上碑文的爆头也算挡住
    return req.headshot ? GUARD_FACTOR * 0.5 : GUARD_FACTOR;
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const r = buildHumanoid(root, {
      hipY: 1.12, hipX: 0.26, thigh: 0.54, legW: 0.3,
      legColor: C.fur, shinColor: C.wrap, footColor: C.hoof,
      torsoW: 1.0, torsoH: 0.84, torsoD: 0.66, torsoColor: C.skin,
      shoulderX: 0.64, shoulderY: 0.7, upperArm: 0.46, foreArm: 0.42, armW: 0.27,
      armColor: C.fur, foreColor: C.wrap, handColor: C.skin,
      neckY: 0.86,
    });
    this.rig = r;
    const t = r.torso;
    const stone = flat(C.stone, { rough: 0.9 }), rope = flat(C.rope), bronze = flat(C.bronze, { metal: 0.6, rough: 0.4 });
    // 毛领、肚腩、鞍毯裙
    part(t, Geo.box(1.16, 0.3, 0.78), flat(C.furDark), 0, 0.72, 0);
    part(t, Geo.box(0.8, 0.42, 0.12), flat(C.muzzle), 0, 0.32, 0.32);
    part(r.hips, Geo.box(0.98, 0.5, 0.7, 'top'), flat(C.cloth), 0, 0.02, 0);
    part(r.hips, Geo.box(1.0, 0.1, 0.72), bronze, 0, 0.02, 0);
    // 背上：两座驼峰，各绑一块竖着的石碑；碑间发光的碑文（弱点）
    for (const s of [1, -1]) {
      part(t, Geo.ico(0.24, 1), flat(C.fur), s * 0.26, 0.86, -0.3).scale.set(1, 0.8, 1);
      part(t, Geo.box(0.3, 0.95, 0.16), stone, s * 0.27, 1.2, -0.38, 0, 0, s * 0.06);
      part(t, Geo.box(0.32, 0.06, 0.18), rope, s * 0.27, 0.95, -0.38);
    }
    const glyph = this.glowPart(t, Geo.box(0.16, 0.42, 0.04), C.glyph, C.glyphHot, 0, 0.98, -0.42);
    this.setHeadAnchor(glyph, 0, 0, 0);
    // 铃铛项链
    for (let i = 0; i < 5; i++) part(t, Geo.ico(0.06, 0), bronze, (i - 2) * 0.16, 0.6 - Math.abs(i - 2) * 0.04, 0.36);
    // 头：长颈前探，长脸、厚唇、铜鼻环
    const h = r.head;
    part(h, Geo.box(0.26, 0.5, 0.26), flat(C.fur), 0, 0.2, 0.08, -0.35, 0, 0);
    part(h, Geo.box(0.3, 0.28, 0.5), flat(C.fur), 0, 0.5, 0.26);
    part(h, Geo.box(0.26, 0.2, 0.22), flat(C.muzzle), 0, 0.44, 0.56);
    part(h, Geo.torus(0.06, 0.012), bronze, 0, 0.38, 0.68, Math.PI / 2, 0, 0);
    for (const s of [1, -1]) part(h, Geo.box(0.06, 0.12, 0.05), flat(C.furDark), s * 0.13, 0.68, 0.14);

    // 石碑塔盾（挂点在碑心，正面朝 +Z；双手握在碑背面的两根铜把手上）
    const sl = joint(t, 0, 0.15, 0.75);
    sl.name = 'stele'; // 挂点名：美术资产按它绑定（registry.toml 的 blockout.attachment）
    this.stele = sl;
    part(sl, Geo.box(0.95, 1.75, 0.24), stone, 0, 0, 0);
    part(sl, Geo.box(0.8, 1.55, 0.04), flat(C.stoneDark, { rough: 0.95 }), 0, 0, 0.13);
    part(sl, Geo.box(0.98, 0.07, 0.26), rope, 0, 0.7, 0);
    for (const s of [1, -1]) part(sl, Geo.cyl(0.035, 0.035, 0.36, 6), bronze, s * 0.28, 0.05, -0.17);
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (!n) return;
    // 石碑挂点从白模躯干挪到模型根（白模骨架不再驱动它）；位姿在 poseNative 里按模型空间摆
    const host = this.model.children[0];
    host.attach(this.stele);
    const glyph = n.pose.bone('glyph');
    if (glyph) this.setHeadAnchor(glyph, 0, 0, 0);
  }

  protected override cancelAttack(): void {
    this.hideLane();
    this.accel = 28;
    this.glowTarget[0] = 0;
    if (this.state !== 'advance' && this.state !== 'idle') {
      this.setState('advance');
      this.slamCd = Math.max(this.slamCd, 2);
    }
  }

  protected override onDispose(): void {
    super.onDispose();
    this.hideLane();
  }

  private hideLane(): void {
    this.lane?.release();
    this.lane = null;
  }

  protected override ai(dt: number): void {
    const pl = this.ctx.player;
    const d = this.distToPlayerXZ();
    this.slamCd -= dt * this.attackRate;
    switch (this.state) {
      case 'advance': {
        this.glowTarget[0] = 0.25 + 0.1 * Math.sin(this.age * 2);
        // 慢慢转向玩家：举着碑的正面始终对着玩家，但转得慢
        this.facing = rotateTowards(this.facing, Math.atan2(pl.position.x - this.position.x, pl.position.z - this.position.z), TURN_RATE * dt);
        if (d <= SHOVE_RANGE && this.verticalReach(1.5) && this.cooldown <= 0) {
          this.setState('shoveWindup');
          this.shoveHit = false;
          this.stopMoving();
          this.ctx.audio.play('telegraph', { position: this.position, volume: 0.7, pitch: 0.7 });
          break;
        }
        if (this.slamCd <= 0 && d >= SLAM_RANGE[0] && d <= SLAM_RANGE[1] && this.sees && this.verticalReach(1.2) && this.facingDot() > 0.85) {
          this.beginSlam();
          break;
        }
        if (d > 2.4) this.approachPlayer(this.speed, 2.4);
        else this.stopMoving();
        break;
      }
      case 'slamWindup': {
        this.stopMoving();
        const t = clamp01(this.stateTime / this.windTime);
        // 前半段还能微调方向，后半段锁定（侧移可躲）
        if (t < 0.5) this.facing = rotateTowards(this.facing, Math.atan2(pl.position.x - this.position.x, pl.position.z - this.position.z), 0.8 * dt);
        this.updateLane(t);
        this.glowTarget[0] = 0.4 + 0.6 * t;
        if (this.stateTime >= this.windTime) this.slam();
        break;
      }
      case 'slam': {
        this.stopMoving();
        if (this.stateTime >= 0.12) this.setState('recover');
        break;
      }
      case 'recover': {
        this.stopMoving();
        this.glowTarget[0] = 0.6;
        if (this.stateTime >= RECOVER_TIME) {
          this.setState('advance');
          this.slamCd = this.ctx.rng.range(SLAM_COOLDOWN[0], SLAM_COOLDOWN[1]);
        }
        break;
      }
      case 'shoveWindup': {
        this.stopMoving();
        this.facePlayer(3, dt);
        if (this.stateTime >= this.windup(SHOVE_WINDUP, 0.35)) this.setState('shove');
        break;
      }
      case 'shove': {
        // 往前顶半步，碑面扫到玩家就推开
        this.setMove(Math.sin(this.facing), Math.cos(this.facing), 3.5);
        if (!this.shoveHit && this.stateTime >= 0.06) {
          if (this.melee(SHOVE_RANGE + 0.4, this.def.damage * this.damageMult * SHOVE_DAMAGE_MULT, 0.4)) {
            this.shoveHit = true;
            _v.set(pl.position.x - this.position.x, 0, pl.position.z - this.position.z).normalize().multiplyScalar(SHOVE_KNOCK);
            _v.y = 3.5;
            pl.applyImpulse(_v);
            this.ctx.fx.shake(0.5, 0.25);
          }
        }
        if (this.stateTime >= 0.3) {
          this.setState('advance');
          this.rollCooldown(1.6, 2.4);
        }
        break;
      }
      default:
        this.setState('advance');
    }
  }

  private beginSlam(): void {
    this.windTime = this.windup(SLAM_WINDUP, 0.7);
    this.setState('slamWindup');
    this.stopMoving();
    this.ctx.audio.play('boss_roar', { position: this.position, volume: 0.6, pitch: 1.4 });
    this.hideLane();
    this.lane = GroundDecal.acquire(this.ctx.stageGroup, C.warn);
    this.updateLane(0);
  }

  /** 地面直线预警：从身前起，沿朝向延伸，随蓄力填满 */
  private updateLane(t: number): void {
    const lane = this.lane;
    if (!lane) return;
    const sx = Math.sin(this.facing), sz = Math.cos(this.facing);
    lane.rect(this.position.x + sx * WAVE_START, this.position.y, this.position.z + sz * WAVE_START, this.facing, WAVE_LENGTH, WAVE_HALF_WIDTH);
    lane.fill = t;
    lane.opacity = 0.35 + 0.5 * t;
  }

  /** 砸地：冲击、扬沙，推出冲击波（精英三道扇形） */
  private slam(): void {
    this.setState('slam');
    this.hideLane();
    const ctx = this.ctx;
    const sx = Math.sin(this.facing), sz = Math.cos(this.facing);
    _p.set(this.position.x + sx * WAVE_START, this.position.y, this.position.z + sz * WAVE_START);
    ctx.audio.play('boss_slam', { position: _p, volume: 0.9 });
    ctx.fx.ring(_p, 2.2, 0xffd080, 0.35);
    ctx.fx.burst(_p, C.dust, 14, 4.5, 0.7, 0.18, 10);
    ctx.fx.shake(0.4 * clamp01(1 - this.distToPlayerXZ() / 20) + 0.15, 0.3);
    const yaws = this.isElite ? [-0.35, 0, 0.35] : [0];
    for (const dy of yaws) this.launchWave(_p.clone(), this.facing + dy);
  }

  /** 一道沿直线推进的冲击波：逐帧前推，撞墙停下；扫过地上的玩家（只打一次）造成重伤并掀起来 */
  private launchWave(start: THREE.Vector3, yaw: number): void {
    const ctx = this.ctx;
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const dmg = this.def.damage * this.damageMult * WAVE_DAMAGE_MULT;
    const source = this;
    const front = start.clone();
    const prev = start.clone();
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    let dist = 0, fxAcc = 0, hit = false;
    ctx.tasks.add((dt) => {
      prev.copy(front);
      dist = Math.min(WAVE_LENGTH, dist + WAVE_SPEED * dt);
      front.copy(start).addScaledVector(dir, dist);
      // 撞墙：地面以上半米的线段被挡住就停下
      a.copy(prev).setY(prev.y + 0.5);
      b.copy(front).setY(front.y + 0.5);
      const blocked = ctx.world.segmentBlocked(a, b);
      // 扫到玩家：玩家在这一帧扫过的线段两侧半宽以内、脚离波面不高
      const pl = ctx.player;
      if (!hit && pl.alive) {
        _v.subVectors(pl.position, start);
        const along = _v.dot(dir);
        const side = Math.abs(_v.x * dir.z - _v.z * dir.x);
        const rise = pl.position.y - start.y;
        if (along >= dist - WAVE_SPEED * dt - 0.3 && along <= dist + 0.3 && side <= WAVE_HALF_WIDTH + pl.radius * 0.5
          && rise > -0.6 && rise < WAVE_JUMP_CLEAR) {
          hit = true;
          ctx.combat.damagePlayer(dmg, 'none', source, front);
          _v.copy(dir).multiplyScalar(6);
          _v.y = 7;
          pl.applyImpulse(_v);
          ctx.fx.shake(0.6, 0.3);
        }
      }
      // 波面：裂地扬沙 + 碎石
      fxAcc += WAVE_SPEED * dt;
      while (fxAcc >= 0.7) {
        fxAcc -= 0.7;
        _p.copy(front).addScaledVector(dir, -fxAcc);
        ctx.fx.burst(_p, C.dust, 4, 3, 0.55, 0.22, 9);
        ctx.fx.burst(_p, C.stoneDark, 2, 5, 0.6, 0.08, 18);
      }
      if (blocked || dist >= WAVE_LENGTH) {
        ctx.fx.burst(front, C.dust, 10, 3.5, 0.6, 0.25, 8);
        return true;
      }
      return false;
    });
  }

  protected override pose(dt: number): void {
    const r = this.rig;
    applyWalk(r, this.walkPhase, this.walkAmp, 0.15);
    // 石碑位姿（躯干局部）：推进时挡在身前；举过头；砸到身前地上；碑撞时先收后推
    let y = 0.15, z = 0.75, tilt = 0, crouch = 0, lean = 0, rate = 8;
    switch (this.state) {
      case 'slamWindup': {
        const t = clamp01(this.stateTime / this.windTime);
        const e = t * t * (3 - 2 * t);
        y = mix(0.15, 1.45, e);
        z = mix(0.75, 0.05, e);
        tilt = -0.35 * e;
        lean = -0.2 * e;
        crouch = 0.05 * e;
        rate = 14;
        break;
      }
      case 'slam':
      case 'recover': {
        const out = this.state === 'recover' ? clamp01((this.stateTime - RECOVER_TIME * 0.6) / (RECOVER_TIME * 0.4)) : 0;
        y = mix(-0.55, 0.15, out);
        z = mix(1.25, 0.75, out);
        tilt = mix(1.25, 0, out);
        lean = mix(0.55, 0, out);
        crouch = mix(0.28, 0, out);
        rate = this.state === 'slam' ? 40 : 12;
        break;
      }
      case 'shoveWindup':
        z = 0.4;
        lean = -0.15;
        crouch = 0.1;
        break;
      case 'shove':
        z = 1.15;
        lean = 0.35;
        rate = 30;
        break;
    }
    const k = 1 - Math.exp(-rate * dt);
    this.pSteleY = mix(this.pSteleY, y, k);
    this.pSteleZ = mix(this.pSteleZ, z, k);
    this.pSteleTilt = mix(this.pSteleTilt, tilt, k);
    this.pCrouch = mix(this.pCrouch, crouch, k);
    this.pLean = mix(this.pLean, lean, k);
    if (this.nativeBody) {
      this.poseNative(this.nativeBody, dt);
      return;
    }
    this.stele.position.set(0, this.pSteleY, this.pSteleZ);
    this.stele.rotation.x = this.pSteleTilt;
    r.torso.rotation.x += this.pLean;
    applyCrouch(r, this.pCrouch);
    this.applyHurtAndStun(r);
    // 双手握住碑背面的两根铜把手
    reachWeaponGrip(r, 1, this.stele, 0.28, 0.05, -0.17);
    reachWeaponGrip(r, -1, this.stele, -0.28, 0.05, -0.17);
  }

  /**
   * 美术骨骼动画：双足步态（相位驱动的脚掌 IK，下蹲时腿自然弯曲），上身前倾 / 后仰，头看向玩家；
   * 石碑按状态摆在模型空间，双手用 IK 握住碑背面的两根把手。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    // 石碑：白模躯干局部位姿 → 模型空间
    this.stele.position.set(0, ART_STELE_Y + this.pSteleY, ART_STELE_Z + this.pSteleZ);
    this.stele.rotation.set(this.pSteleTilt, 0, 0);
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const sn = clamp01(sp / Math.max(0.5, this.speed));
    const move = clamp01(sp / 0.6);
    const freq = GAIT_FREQ[0] + (GAIT_FREQ[1] - GAIT_FREQ[0]) * sn;
    this.gait = (this.gait + freq * dt * move) % 1;
    const sweep = Math.min(GAIT_SWEEP, (sp * GAIT_DUTY) / freq) * move;
    const ph = this.gait * Math.PI * 2;
    // 身体：沉重的起伏、左右晃；蓄力 / 砸地时的前倾后仰；受击后仰；眩晕摇晃
    const crouch = this.pCrouch + 0.04 * sn * (1 - Math.cos(ph * 2)) * 0.5;
    P.translate('hips', 0, -crouch, this.pLean * 0.15);
    P.rotate('hips', AZ, Math.sin(ph) * 0.05 * sn);
    P.rotate('spine', AX, this.pLean * 0.5 + 0.06 * sn);
    P.rotate('chest', AX, this.pLean * 0.5 - this.hurtKick * 0.35);
    if (this.stunTime > 0) P.rotate('chest', AZ, Math.sin(this.age * 7) * 0.12);
    // 头：看向玩家（左右），蓄力砸碑时仰头吼
    const pl = this.ctx.player.position;
    const yawTo = Math.atan2(pl.x - this.position.x, pl.z - this.position.z);
    let dyaw = yawTo - this.facing;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const roar = this.state === 'slamWindup' ? clamp01(this.stateTime / this.windTime) : 0;
    P.rotate('neck', AY, THREE.MathUtils.clamp(dyaw, -0.6, 0.6) * 0.5);
    P.rotate('head', AX, -roar * 0.5 - this.hurtKick * 0.25 + (this.stunTime > 0 ? 0.3 : 0));
    // 腿：步态 IK（触地段脚掌从前往后扫，腾空段抬脚前摆）；站着时脚钉在绑定位置，下蹲时膝盖自然弯
    for (const [side, off] of [['L', 0], ['R', 0.5]] as const) {
      const rest = P.restPosition(`foot_${side}`);
      if (!rest) continue;
      const u = (this.gait + off) % 1;
      let dz: number, dy: number;
      if (u < GAIT_DUTY) {
        dz = sweep * (0.5 - u / GAIT_DUTY);
        dy = 0;
      } else {
        const t = (u - GAIT_DUTY) / (1 - GAIT_DUTY);
        dz = sweep * (-0.5 + t * t * (3 - 2 * t));
        dy = Math.sin(t * Math.PI) * GAIT_LIFT * move;
      }
      _g.set(rest.x, rest.y + dy, rest.z + dz);
      P.twoBoneIK(`thigh_${side}`, `shin_${side}`, `foot_${side}`, _g, 1);
    }
    // 双手握住石碑背面的两根把手（左手 = 碑的 +X 侧）
    this.stele.updateWorldMatrix(true, false);
    const host = this.model.children[0];
    for (const [side, gx] of [['L', 0.28], ['R', -0.28]] as const) {
      _g.set(gx, 0.05, -0.17).applyMatrix4(this.stele.matrixWorld);
      host.worldToLocal(_g);
      P.twoBoneIK(`arm_${side}`, `forearm_${side}`, `hand_${side}`, _g, 0);
    }
    // 碑文发光壳：跟着蓄力 / 硬直变亮
    if (n.glowShell) n.glowShell.opacity = clamp01(this.glowLevel[0]) * 0.9;
  }
}

/** 正面格挡：全局伤害修正，只对举碑中的驼碑力士生效 */
function installGuard(ctx: GameContext): void {
  if (guardInstalled.has(ctx)) return;
  guardInstalled.add(ctx);
  ctx.combat.addOutgoingModifier((enemy, req) => (enemy instanceof CamelStele ? enemy.guardFactor(req) : 1));
}
