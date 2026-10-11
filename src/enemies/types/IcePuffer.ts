/**
 * 冰河豚（ice_puffer，第二章 · 北冥冰海的自爆怪）：一条冻在冰海里的河豚，像气球一样飘在半空，浑身短粗的冰刺。
 * 和冰棘豪彘（地面冲锋、炸出一圈水平冰刺）互补：河豚走空中，俯冲贴脸后鼓气，炸开留下一团减速冻雾——
 * 一个逼玩家抬头、一个逼玩家找掩体。按真实河豚的样子动：平时胸鳍飞快地扇、尾鳍慢慢摆，靠胸鳍「悬停」；
 * 受惊时吞气把身体鼓成两倍大、刺全部竖起来。
 *
 * - 飘近：在玩家头顶上方 2–3 米的高度慢慢飘过来，身体随胸鳍一顿一顿地晃，看不到玩家时升高。
 * - 俯冲：身体中心离玩家胸口 8 米内、看得到时，鼻尖朝玩家一头扎下来（最高 11 米/秒，转向有限：横移能躲开）。
 * - 鼓气：俯冲到 2.4 米内就地停住，0.8 秒鼓成原来的两倍大（刺根亮起青光、越来越抖），地面预警圈同步填满；
 *   随后炸开（3 米，近重远轻）。这 0.8 秒里打爆它或跑出圈都行。
 * - 冻雾：炸点下方留下 3 米的冻雾 4 秒，站在里面移速 −40%。
 * - 俯冲落空（1.6 秒没贴上、撞墙）：刹住、晃晃悠悠浮回高处，过一会儿再冲。
 * - 被提前打死：没鼓气时只碎成一团冰屑；鼓气中被打爆时冰爆照样炸开，但只伤其他敌人，并留下一小团冻雾。
 * 弱点 = 整个身体（判定球罩住身体，鼓气时跟着变大）。
 *
 * 状态机：drift → dive → inflate →（自爆）
 *         dive →（落空）recover → drift
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { clamp01, damp, rotateTowards } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { blastPlayer } from '../Hazards';
import { Geo, flat, joint, part } from '../Models';
import { FROST_FX_TIME, Spring, applyFrostGlow, iceShatter, spawnFrostFog, type FrostGlowHandle } from '../fx/FrostSkirmishFx';

export const ICE_PUFFER_DEF: ScaledEnemyDef = {
  id: 'ice_puffer',
  name: '冰河豚',
  // 美术按 1.0 米（含上下冰刺）制作，游戏里原大
  scale: 1,
  hp: 34,
  speed: 4.5,
  radius: 0.36,
  height: 1.0,
  flying: true,
  damage: 24,
  coins: [1, 3],
  essence: 1,
  // 弱点 = 整个身体：判定球心在身体球心（离模型底 0.47），罩住不含冰刺的身体
  headY: 0.47,
  headRadius: 0.34,
  knockbackResist: 0.1,
  color: 0x7fe6ff,
};

/** 飘行：身体底部离地（或离玩家脚底）的高度区间、上下浮动 */
const HOVER = [2.2, 3.0] as const;
/** 俯冲触发：身体中心到玩家胸口的距离 */
const DIVE_RANGE = 8;
const DIVE_START = 6;
const DIVE_SPEED = 11;
const DIVE_RAMP = 14;
/** 俯冲的水平转向角速度（弧度/秒）：横移能甩开 */
const DIVE_TURN = 2.0;
const DIVE_MAX_TIME = 1.6;
/** 贴到这么近就停下鼓气 */
const INFLATE_RANGE = 2.4;
const INFLATE_TIME = 0.8;
/** 鼓满时身体放大倍数 */
const INFLATE_SCALE = 2;
const BURST_RADIUS = 3;
const FOG_RADIUS = 3;
const FOG_TIME = 4;
const FOG_SLOW = 0.4;
/** 鼓气中被打爆：对其他敌人的冰爆基础伤害（× 等级）、留下的小冻雾 */
const DEATH_BLAST_BASE = 30;
const DEATH_FOG = { radius: 2.2, time: 2.5, slow: 0.3 } as const;
const RECOVER_TIME = 1.2;
/** 身体球心（模型单位，脚底原点：美术网格实测 (0, 0.47, 0.05)） */
const BODY_CENTER = new THREE.Vector3(0, 0.47, 0.05);

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

const C = {
  skin: 0x3f78a8, belly: 0xdfeef4, spine: 0xbfe6f6, fin: 0x6f9ab8, lip: 0xc8a49a, eye: 0xf2ecd8, pupil: 0x183048,
  glow: 0x6ff0ff, glowHot: 0xe8ffff, fog: 0xbfeaff,
};

const _c = new THREE.Vector3();
const _p = new THREE.Vector3();

export class IcePuffer extends StandardEnemy {
  /** 白模身体（球心关节：鼓气时整体缩放） */
  private bodyJoint!: THREE.Group;
  private finL!: THREE.Group;
  private finR!: THREE.Group;
  private tailJoint!: THREE.Group;
  /** 白模冰刺的发光芯（鼓气时亮起） */
  private spineGlows: THREE.Mesh[] = [];
  private readonly baseHover: number;
  private readonly bobPhase: number;
  private climb = 0;
  private diveYaw = 0;
  private inflateTime = INFLATE_TIME;
  private warning: (() => void) | null = null;
  private detonated = false;
  /** 鼓气进度 0..1（平滑后，驱动缩放、发光、判定球） */
  private pInflate = 0;
  private readonly baseHeadRadius: number;
  private glow: FrostGlowHandle | null = null;
  private readonly finSpring = new Spring(90, 0.5);
  private readonly pitch = new Spring(40, 0.8);
  private readonly roll = new Spring(40, 0.8);
  private finPhase = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, ICE_PUFFER_DEF, opts);
    this.baseHover = ctx.rng.range(HOVER[0], HOVER[1]);
    this.hoverHeight = this.baseHover;
    this.bobPhase = ctx.rng.range(0, Math.PI * 2);
    this.baseHeadRadius = this.headRadius;
    this.accel = 12;
    this.deathDuration = 0.3;
    this.cooldown = ctx.rng.range(0.4, 1.4);
    this.setState('drift');
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const skin = flat(C.skin, { rough: 0.7 }), belly = flat(C.belly, { rough: 0.8 }), spine = flat(C.spine, { rough: 0.35 });
    const fin = flat(C.fin, { rough: 0.6 });
    const body = joint(root, BODY_CENTER.x, BODY_CENTER.y, BODY_CENTER.z);
    this.bodyJoint = body;
    part(body, Geo.ico(0.32, 2), skin, 0, 0.02, 0).scale.set(1, 0.95, 1.05);
    part(body, Geo.ico(0.29, 2), belly, 0, -0.07, 0.03).scale.set(0.95, 0.8, 1.0);
    // 冰刺：黄金角螺旋撒在球面上（脸前方留空），每根一个发光芯
    for (let i = 0; i < 26; i++) {
      const y = 1 - (2 * (i + 0.5)) / 26, r = Math.sqrt(1 - y * y), a = i * 2.39996;
      const n = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      if (n.z > 0.7 && Math.abs(n.y) < 0.45) continue;
      const g = joint(body, n.x * 0.3, n.y * 0.3, n.z * 0.3);
      g.quaternion.setFromUnitVectors(AY, n);
      part(g, Geo.cone(0.045, 0.16, 5, 'bottom'), spine, 0, 0, 0);
      this.spineGlows.push(this.glowPart(g, Geo.cone(0.02, 0.07, 4, 'bottom'), 0x000000, C.glowHot, 0, -0.01, 0, 0, true));
    }
    // 脸：一对怒目（白眼球 + 深色瞳孔 + 压低的冰眉）、噘起的厚嘴唇
    for (const s of [1, -1]) {
      part(body, Geo.ico(0.075, 1), flat(C.eye, { rough: 0.4 }), s * 0.13, 0.08, 0.25).scale.set(1, 1, 0.6);
      part(body, Geo.ico(0.035, 1), flat(C.pupil), s * 0.12, 0.07, 0.295);
      part(body, Geo.box(0.12, 0.035, 0.05), spine, s * 0.12, 0.16, 0.26, 0.2, 0, s * 0.35);
    }
    part(body, Geo.torus(0.05, 0.03, 6, 10), flat(C.lip, { rough: 0.6 }), 0, -0.04, 0.33);
    // 胸鳍：立着的小扇子
    const fanFin = (parent: THREE.Object3D, s: number): THREE.Group => {
      const g = joint(parent, s * 0.3, -0.02, 0);
      part(g, Geo.box(0.02, 0.2, 0.12), fin, s * 0.06, 0, -0.02, 0, s * 0.3, 0);
      return g;
    };
    this.finL = fanFin(body, 1);
    this.finR = fanFin(body, -1);
    // 尾柄 + 尾鳍
    const tail = joint(body, 0, 0.02, -0.3);
    this.tailJoint = tail;
    part(tail, Geo.cyl(0.05, 0.07, 0.1, 6), skin, 0, 0, -0.03, Math.PI / 2, 0, 0);
    part(tail, Geo.box(0.03, 0.3, 0.14), fin, 0, 0, -0.14);
    this.setHeadAnchor(body, 0, 0, 0);
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (!n) return;
    // 白模身体整组隐藏（含冰刺的发光芯：美术版改用贴图上的冰刺本身发光）
    this.bodyJoint.visible = false;
    // 弱点判定球挂到 body 骨上（跟着鼓气的缩放走：锚点放在骨骼原点 = 球心）
    const body = n.pose.bone('body');
    if (body) {
      const host = this.model.children[0];
      host.updateWorldMatrix(true, true);
      const anchor = new THREE.Object3D();
      body.add(anchor);
      anchor.position.copy(body.worldToLocal(host.localToWorld(BODY_CENTER.clone())));
      this.setHeadAnchor(anchor, 0, 0, 0);
    }
    // 冰刺发光：贴图里发白、偏冷的冰刺（低饱和、高明度）从刺根亮起
    this.glow = applyFrostGlow(n.materials[0], 'puffer', [
      { color: C.glow, hue: [0.55, 0.12], minVal: 0.72, maxSat: 0.42, shimmer: 0.5 },
      // 整个身体的冷光（鼓满前的最后一下）
      { color: C.glow, hue: [0.58, 0.15], minSat: 0.2, shimmer: 0.3 },
    ]);
  }

  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.localPoint(0, BODY_CENTER.y, 0.4, out);
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    return this.localPoint(BODY_CENTER.x, BODY_CENTER.y, BODY_CENTER.z, out);
  }

  /** 身体中心到玩家胸口的距离 */
  private chestDistance(): number {
    this.getBodyCenter(_c);
    this.playerChest(_p);
    return _c.distanceTo(_p);
  }

  protected override ai(dt: number): void {
    const pl = this.ctx.player;
    switch (this.state) {
      case 'chase':
      case 'drift': {
        this.updateHover(dt);
        this.glowTarget[0] = 0.1;
        const d = this.chestDistance();
        if (this.cooldown <= 0 && this.sees && d <= DIVE_RANGE) {
          this.startDive();
          break;
        }
        // 飘过来：直线（飞行单位不走导航网格），加一点左右摇摆
        this.navigate(pl.position, this.speed, 1.2);
        const w = Math.sin(this.age * 1.7 + this.bobPhase) * 0.45;
        if (Math.abs(this.desiredX) + Math.abs(this.desiredZ) > 0.01) {
          this.setMove(this.desiredX - this.desiredZ * w, this.desiredZ + this.desiredX * w, this.speed);
        }
        this.facePlayer(3, dt);
        break;
      }
      case 'dive': {
        // 鼻尖朝玩家胸口扎下来：水平方向有限转向，竖直方向追胸口高度
        _p.subVectors(pl.position, this.position);
        this.diveYaw = rotateTowards(this.diveYaw, Math.atan2(_p.x, _p.z), DIVE_TURN * (this.isElite ? 1.25 : 1) * dt);
        const v = Math.min(DIVE_SPEED, DIVE_START + this.stateTime * DIVE_RAMP);
        this.setMove(Math.sin(this.diveYaw), Math.cos(this.diveYaw), v);
        this.facing = this.diveYaw;
        this.flyTargetY = pl.position.y + 1.1 - BODY_CENTER.y * this.sizeScale;
        this.glowTarget[0] = 0.5;
        if (this.chestDistance() <= INFLATE_RANGE * this.sizeScale && this.verticalReach(2.5)) {
          this.startInflate();
          break;
        }
        if (this.stateTime >= DIVE_MAX_TIME || (this.moveResult.hitWall && this.stateTime > 0.25)) this.miss();
        break;
      }
      case 'inflate': {
        // 原地停住鼓气（预警圈和炸点一致）
        this.stopMoving();
        this.facePlayer(4, dt);
        const t = clamp01(this.stateTime / this.inflateTime);
        this.glowTarget[0] = 0.4 + 0.6 * t;
        this.tintBody(0x5fdcff, t * 0.55);
        if (this.stateTime >= this.inflateTime) this.burst();
        break;
      }
      case 'recover': {
        // 刹住、浮回高处
        this.updateHover(dt);
        this.stopMoving();
        this.facePlayer(2, dt);
        this.glowTarget[0] = 0.1;
        if (this.stateTime >= RECOVER_TIME) {
          this.accel = 12;
          this.setState('drift');
        }
        break;
      }
      default:
        this.setState('drift');
    }
  }

  /** 飘行高度：随玩家所在高度抬升，看不到玩家时再高一些，撞到障碍临时爬升 */
  private updateHover(dt: number): void {
    const floor = this.ctx.stage.arena?.floorY ?? 0;
    const pl = this.ctx.player.position;
    if (this.moveResult.hitWall) this.climb = 1.0;
    else this.climb = Math.max(0, this.climb - dt);
    let y = Math.max(floor + this.baseHover, pl.y + this.baseHover);
    if (this.blindTime > 0.8) y += 1.2;
    if (this.climb > 0) y += 2;
    this.flyTargetY = y + Math.sin(this.age * 1.9 + this.bobPhase) * 0.25;
  }

  private startDive(): void {
    this.setState('dive');
    this.diveYaw = this.facing;
    this.accel = 40;
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.6, pitch: 1.9 });
    this.getBodyCenter(_c);
    this.ctx.fx.burst(_c, C.spine, 6, 1.6, 0.35, 0.05, 0);
  }

  private startInflate(): void {
    this.inflateTime = this.windup(INFLATE_TIME, 0.6);
    this.setState('inflate');
    this.stopMoving();
    this.accel = 30;
    this.getBodyCenter(_c);
    const gy = this.ctx.world.groundHeight(_c.x, _c.z, _c.y);
    const ground = new THREE.Vector3(_c.x, Number.isFinite(gy) ? gy : this.position.y, _c.z);
    this.warning = this.ctx.fx.groundWarning(ground, BURST_RADIUS, this.inflateTime, 0x1a8cff);  // 饱和蓝：浅青色在冰面上看不见
    this.ctx.audio.play('telegraph', { position: _c, volume: 0.9, pitch: 1.4 });
  }

  /** 俯冲落空：刹住，浮回高处再来 */
  private miss(): void {
    this.setState('recover');
    this.accel = 10;
    this.rollCooldown(1.5, 2.6);
    this.getBodyCenter(_c);
    this.ctx.fx.burst(_c, C.spine, 8, 2.2, 0.5, 0.05, 4);
  }

  /** 鼓满炸开：伤害玩家、留下冻雾，自身死亡（不经过 combat：不算玩家击杀、不掉落） */
  private burst(): void {
    if (this.detonated || !this.alive) return;
    this.detonated = true;
    // 预警如期兑现：让它自然收尾，下面 onKilled → cancelAttack 不再撤销它
    this.warning = null;
    const center = this.getBodyCenter(new THREE.Vector3());
    this.ctx.fx.explosion(center, BURST_RADIUS, 0x9fe8ff);
    this.ctx.audio.play('explosion', { position: center, pitch: 1.35, volume: 0.9 });
    iceShatter(this.ctx, center, 1.3 * this.sizeScale);
    this.ctx.fx.ring(center, BURST_RADIUS, 0xcff4ff, 0.4);
    blastPlayer(this.ctx, center, BURST_RADIUS, this.def.damage * this.damageMult, 'none', this, 0.45, 0.6, 4);
    spawnFrostFog(this.ctx, center, FOG_RADIUS * (this.isElite ? 1.2 : 1), FOG_TIME, FOG_SLOW);
    this.hp = 0;
    this.shield = 0;
    this.armor = 0;
    const req: DamageRequest = { base: 0, element: 'none', source: 'explosion' };
    const res: DamageResult = {
      request: req, dealt: 0, isCrit: false, killed: true, layer: 'health',
      shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null,
    };
    this.onKilled(res);
  }

  protected override onDeath(r: DamageResult): void {
    const inflating = this.state === 'inflate';
    super.onDeath(r);
    if (this.detonated || attackDirector.purging) return;
    this.detonated = true;
    const ctx = this.ctx;
    const center = this.getBodyCenter(new THREE.Vector3());
    if (!inflating) {
      // 没鼓气时被打死：碎成一团冰屑
      iceShatter(ctx, center, 0.8 * this.sizeScale);
      return;
    }
    // 鼓气中被打爆：冰爆照样炸开，只伤其他敌人（延后结算，避免在 combat 结算里递归），留一小团冻雾
    const base = DEATH_BLAST_BASE * this.level * (this.isElite ? 1.5 : 1);
    iceShatter(ctx, center, 1.2 * this.sizeScale);
    spawnFrostFog(ctx, center, DEATH_FOG.radius, DEATH_FOG.time, DEATH_FOG.slow);
    ctx.tasks.delay(0.06, () => {
      ctx.combat.explode(center, BURST_RADIUS, {
        base, element: 'none', source: 'explosion', procDepth: 1, canCrit: false, knockback: 5,
      }, { playerDamage: 0, color: 0x9fe8ff, falloff: 0.5 });
    });
  }

  protected override cancelAttack(): void {
    const warn = this.warning;
    this.warning = null;
    warn?.();
    if (this.alive && (this.state === 'inflate' || this.state === 'dive')) {
      // 眩晕 / 清理 / 玩家死亡：泄气，浮回高处
      this.setState('recover');
      this.restoreTint();
      this.accel = 10;
      this.rollCooldown(1.2, 2.2);
    }
  }

  protected override animateDeath(t: number): void {
    // 炸开：一下膨胀后缩没
    const k = this.detonated && this.pInflate > 0.5 ? 1.3 : 1;
    const s = this.sizeScale * k * (t < 0.3 ? 1 + t * 1.5 : Math.max(0.01, 1.45 * (1 - (t - 0.3) / 0.7)));
    this.model.scale.setScalar(s);
  }

  protected override pose(dt: number): void {
    const inflating = this.state === 'inflate';
    const target = inflating ? clamp01(this.stateTime / this.inflateTime) : 0;
    this.pInflate = damp(this.pInflate, target, inflating ? 16 : 5, dt);
    const k = this.pInflate;
    // 膨胀曲线：先快后慢（吞气），鼓满前越来越抖
    const swell = 1 + (INFLATE_SCALE - 1) * Math.pow(k, 0.7);
    const shake = k > 0.6 ? Math.sin(this.age * 70) * 0.025 * (k - 0.6) / 0.4 : 0;
    const breathe = 1 + 0.03 * Math.sin(this.age * 3.1 + this.bobPhase) * (1 - k);
    const s = swell * breathe + shake;
    this.headRadius = this.baseHeadRadius * swell;

    // 整体姿态：俯冲时鼻尖朝运动方向，横移时侧倾；受击后仰
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const sn = Math.sin(this.facing), cs = Math.cos(this.facing);
    const fwd = this.velocity.x * sn + this.velocity.z * cs;
    const lat = this.velocity.x * cs - this.velocity.z * sn;
    const dive = this.state === 'dive';
    const pitchT = dive ? Math.atan2(-this.velocity.y, Math.max(1, sp)) * 0.9 + 0.15 : fwd * 0.04;
    const pitch = this.pitch.step(THREE.MathUtils.clamp(pitchT, -0.9, 0.9) - this.hurtKick * 0.5, dt);
    const roll = this.roll.step(THREE.MathUtils.clamp(-lat * 0.06, -0.4, 0.4) + (this.stunTime > 0 ? Math.sin(this.age * 9) * 0.4 : 0), dt);
    const host = this.model.children[0];
    host.rotation.set(pitch, 0, roll);
    // 绕身体球心转：抵消绕脚底原点转带来的位移
    _c.copy(BODY_CENTER).applyEuler(host.rotation);
    host.position.set(BODY_CENTER.x - _c.x, BODY_CENTER.y - _c.y, BODY_CENTER.z - _c.z);

    // 胸鳍：河豚靠胸鳍悬停，平时快速扇动；俯冲时贴紧身体，鼓气时张开僵住发抖
    this.finPhase += dt * (dive ? 6 : 14 + 4 * Math.sin(this.age * 0.7));
    const finBeat = Math.sin(this.finPhase);
    const finOpen = this.finSpring.step(dive ? -0.5 : inflating ? 0.5 : 0, dt);
    const finA = (dive ? 0.12 : 0.38) * (1 - k * 0.8);
    const tail = Math.sin(this.age * (dive ? 9 : 4.2) + this.bobPhase) * (dive ? 0.35 : 0.28) * (1 - k * 0.6);

    if (this.nativeBody) this.poseNative(this.nativeBody, s, finBeat * finA, finOpen, tail, k);
    else this.poseBlockout(s, finBeat * finA, finOpen, tail, k);

    FROST_FX_TIME.value = this.ctx.time.now;
    const flick = k > 0.75 ? (Math.sin(this.stateTime * 40) > 0 ? 1 : 0.55) : 1;
    if (this.glow) {
      this.glow.strength[0].value = (0.12 + 1.6 * k * flick) * (this.alive ? 1 : 0.3);
      this.glow.strength[1].value = 0.5 * Math.max(0, k - 0.5) * 2 * flick;
    }
  }

  /** 美术骨骼：body 整体缩放（鼓气），胸鳍扇动，尾柄 → 尾鳍摆动（尾鳍滞后），嘴噘起 */
  private poseNative(n: NativeBody, s: number, fin: number, finOpen: number, tail: number, k: number): void {
    const P = n.pose;
    P.reset();
    P.scale('body', s);
    // 胸鳍绕竖轴前后扇（左右镜像），张开 = 鳍面向外翻
    P.rotate('fin_L', AY, fin - finOpen * 0.4);
    P.rotate('fin_R', AY, -fin + finOpen * 0.4);
    P.rotate('fin_L', AZ, -finOpen * 0.3);
    P.rotate('fin_R', AZ, finOpen * 0.3);
    P.rotate('tail_1', AY, tail);
    P.rotate('tail_2', AY, Math.sin(this.age * 4.2 + this.bobPhase - 0.9) * 0.3 * (1 - k * 0.6));
    // 鼓气时尾巴被撑得翘起来
    P.rotate('tail_1', AX, -0.25 * k);
    P.scale('mouth', 1 + 0.08 * Math.sin(this.age * 2.3) + 0.25 * k);
    P.rotate('mouth', AX, 0.04 * Math.sin(this.age * 2.3));
  }

  private poseBlockout(s: number, fin: number, finOpen: number, tail: number, k: number): void {
    this.bodyJoint.scale.setScalar(s);
    this.finL.rotation.set(0, fin - finOpen * 0.4, -finOpen * 0.3);
    this.finR.rotation.set(0, -fin + finOpen * 0.4, finOpen * 0.3);
    this.tailJoint.rotation.set(-0.25 * k, tail, 0);
    for (const g of this.spineGlows) g.scale.setScalar(0.6 + 1.2 * k);
  }
}
