/**
 * 冰棘豪彘（haozhi，第二章 · 昆仑雪墟的自爆怪）：《山海经》「其状如豚而白毛，毛大如笄而黑端」的豪彘，
 * 冻成一头矮壮的豪猪野猪，背上一大丛冰棱刺，刺根透出青紫光。按真实野猪的体态和习性做：头低、肩高、四蹄短而快，
 * 冲锋前刨地喷鼻；豪猪受威胁时竖刺、侧身抖刺。
 *
 * 和冰河豚（空中俯冲、鼓气、冻雾）互补：豪彘只走地面，冲到近处后炸出一圈水平冰刺——要用掩体挡、或跳起来躲。
 * 和火浣鼠（滚过来贴身爆炸）的区别：豪彘不贴身，在 6 米外就停下，伤害靠飞出去的冰刺。
 *
 * - 小跑：对角小跑追玩家，能上下高台。
 * - 刨地：16 米内、看得到、直线畅通时，低头刨地两下、鼻孔喷白气（0.45 秒）——冲锋前摇。
 * - 冲锋：低头直线猛冲（最高 10.5 米/秒），转向迟钝（每秒约 1.1 弧度：横移能甩开）。
 * - 蓄刺：冲到玩家 6 米内急停（离得本来就近时直接蓄刺），全身冰刺竖起外张、刺根青紫光越来越亮（0.7 秒）；
 *   地面同时亮出 16 条辐条（冰刺的飞行路线），其中一条正对玩家，辐条之间的缝隙是安全方向。
 * - 冰刺新星：炸出一圈 16 根水平冰刺（离地约 0.9 米，射程 12 米，掩体能挡，跳起来能躲），本体死亡；
 *   爆点周围斜插一圈残刺 4 秒，走进去扎脚。
 * - 冲空：冲满 2.4 秒没到 6 米内、或撞墙时离玩家还远，撞得一晃、甩头愣 0.8 秒，再追。
 * - 提前打死（新星之前）：冰刺只射出一半（8 根）、伤害减半，不留残刺——远处先清掉它是奖励。
 * 弱点 = 整丛冰刺（判定球罩住背上的刺冠），身体是挂在骨骼上的三颗球（长条身体，竖直胶囊包不住）。
 *
 * 状态机：chase → scrape（刨地）→ charge → bristle（蓄刺）→（冰刺新星）
 *         chase → bristle（本来就在 6 米内）
 *         charge →（冲空）stagger → chase
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, GameContext, SpawnOptions } from '../../core/types';
import { clamp01, damp, rotateTowards } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { zonePlayer } from '../Hazards';
import { Geo, flat, joint, part } from '../Models';
import {
  FROST_FX_TIME, NovaSpokes, applyFrostGlow, hitAnchor, iceShatter, raycastSpheres, spawnQuillField,
  type FrostGlowHandle, type HitSphere,
} from '../fx/FrostSkirmishFx';

export const HAOZHI_DEF: ScaledEnemyDef = {
  id: 'haozhi',
  name: '冰棘豪彘',
  // 美术按体长 1.0 米（含刺冠高 0.9 米）制作，游戏里放大 1.4 倍：体长约 1.4 米、刺冠顶约 1.26 米
  scale: 1.4,
  hp: 36,
  speed: 5.2,
  radius: 0.3,
  height: 0.9,
  damage: 18,
  coins: [1, 3],
  essence: 1,
  // 弱点 = 背上的刺冠（球心离地 0.66，放大前）
  headY: 0.66,
  headRadius: 0.26,
  knockbackResist: 0.25,
  color: 0x9fd8ff,
};

const CHARGE_RANGE = 16;
/** 刨地前摇 */
const SCRAPE_TIME = 0.45;
const CHARGE_SPEED = 10.5;
const CHARGE_START = 5;
const CHARGE_RAMP = 16;
/** 冲锋转向角速度（弧度/秒）：迟钝，横移能甩开 */
const CHARGE_TURN = 1.1;
const CHARGE_MAX_TIME = 2.4;
/** 冲进这个距离就急停蓄刺 */
const NOVA_RANGE = 6;
const BRISTLE_TIME = 0.7;
const STAGGER_TIME = 0.8;
/** 冰刺新星：根数、速度、射程、离地高度（模型单位）、弹丸半径 */
const QUILLS = 16;
const QUILL_SPEED = 20;
const QUILL_RANGE = 12;
const QUILL_Y = 0.62;
const QUILL_RADIUS = 0.16;
/** 残刺阵：半径、持续、跳伤间隔、每跳伤害（相对冰刺伤害） */
const FIELD_RADIUS = 2.4;
const FIELD_TIME = 4;
const FIELD_TICK = 0.5;
const FIELD_RATIO = 0.3;
/** 美术网格实测（模型单位，脚底原点，面朝 +Z）：刺冠中心、身体中心 */
const CROWN = new THREE.Vector3(0, 0.66, 0.06);
const BODY = new THREE.Vector3(0, 0.38, 0);
/**
 * 四足步态（美术骨骼）：每条腿一个相位，触地段蹄子往后扫、腾空段抬蹄前摆，蹄位用两骨 IK 解。
 * 小跑是对角步（左前 + 右后同相）；冲锋过渡到野猪的横向奔跑（同侧前后腿错开、前后成对）。
 */
const GAIT_FREQ = [2.4, 3.6] as const;
const GAIT_DUTY = [0.6, 0.38] as const;
const GAIT_SWEEP = 0.22;
const GAIT_LIFT = [0.035, 0.08] as const;
const LEGS = [
  { u: 'upperarm_L', l: 'forearm_L', e: 'paw_L', front: true, trot: 0, gallop: 0 },
  { u: 'upperarm_R', l: 'forearm_R', e: 'paw_R', front: true, trot: 0.5, gallop: 0.12 },
  { u: 'thigh_L', l: 'shin_L', e: 'foot_L', front: false, trot: 0.5, gallop: 0.55 },
  { u: 'thigh_R', l: 'shin_R', e: 'foot_R', front: false, trot: 0, gallop: 0.65 },
] as const;
const QUILL_BONES = ['quill_1', 'quill_2', 'quill_3'] as const;
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

const C = {
  hide: 0x6f7f96, mane: 0xd8dee8, snout: 0x9a7e86, tusk: 0xf2ecdc, hoof: 0x3a4250, quill: 0xcfeaff, quillTip: 0xeef8ff,
  root: 0x9a7bff, rootHot: 0xe8dcff, eye: 0x7ff4ff, eyeHot: 0xffffff, steam: 0xeef6ff,
};

const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

export class Haozhi extends StandardEnemy {
  private body!: THREE.Group;
  private head!: THREE.Group;
  private crown!: THREE.Group;
  /** 白模刺冠的三段（前 / 中 / 后），蓄刺时依次竖起 */
  private readonly quillRows: THREE.Group[] = [];
  private readonly legs: { upper: THREE.Group; lower: THREE.Group; front: boolean; side: number }[] = [];
  private readonly hits: HitSphere[] = [];
  private chargeYaw = 0;
  private scrapeTime = SCRAPE_TIME;
  private bristleTime = BRISTLE_TIME;
  private novaYaw = 0;
  private spokes: NovaSpokes | null = null;
  private detonated = false;
  private clearTimer = 0;
  private pathClear = false;
  private gait = 0;
  private steamAcc = 0;
  // 平滑后的姿态参数
  private pBristle = 0;
  private pCharge = 0;
  private pScrape = 0;
  private glow: FrostGlowHandle | null = null;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, HAOZHI_DEF, opts);
    this.deathDuration = 0.35;
    this.accel = 30;
    this.walkScale = 0.8;
    this.stepRate = 2.2;
    this.cooldown = ctx.rng.range(0.4, 1.4);
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const hide = flat(C.hide, { rough: 0.85 }), mane = flat(C.mane, { rough: 0.9 }), hoof = flat(C.hoof, { rough: 0.5 });
    const quill = flat(C.quill, { rough: 0.25 }), tip = flat(C.quillTip, { rough: 0.2 });
    // 身体：桶形猪身，肩高臀低
    const body = joint(root, BODY.x, BODY.y, BODY.z);
    this.body = body;
    part(body, Geo.ico(0.24, 2), hide, 0, 0, 0).scale.set(1.05, 0.95, 1.9);
    part(body, Geo.ico(0.2, 2), mane, 0, 0.05, 0.26).scale.set(1.15, 1.05, 0.9);
    // 头：低垂的楔形头、扁平鼻盘、一对小獠牙、发光小眼、立耳
    const head = joint(body, 0, -0.02, 0.36);
    this.head = head;
    part(head, Geo.ico(0.15, 1), hide, 0, 0, 0.04).scale.set(1, 0.95, 1.2);
    part(head, Geo.cyl(0.07, 0.09, 0.1, 8), flat(C.snout, { rough: 0.6 }), 0, -0.04, 0.17, Math.PI / 2, 0, 0);
    for (const s of [1, -1]) {
      part(head, Geo.cone(0.022, 0.09, 5), flat(C.tusk, { rough: 0.4 }), s * 0.07, -0.05, 0.13, -0.6, 0, s * 0.5);
      this.glowPart(head, Geo.ico(0.022, 1), C.eye, C.eyeHot, s * 0.09, 0.05, 0.1);
      part(head, Geo.cone(0.05, 0.1, 4), hide, s * 0.1, 0.13, -0.02, 0, 0, -s * 0.4);
    }
    // 刺冠：三段，每段一排粗短的冰棱（尖朝后上方），刺根一圈青紫发光芯
    const crown = joint(body, 0, 0.16, 0);
    this.crown = crown;
    for (let row = 0; row < 3; row++) {
      const g = joint(crown, 0, 0, 0.22 - row * 0.24);
      this.quillRows.push(g);
      const n = row === 1 ? 7 : 6;
      for (let i = 0; i < n; i++) {
        const a = (i / (n - 1) - 0.5) * 2.2;
        const q = joint(g, Math.sin(a) * 0.16, Math.cos(a) * 0.04, (i % 2) * 0.05);
        q.rotation.set(-0.9, 0, -a * 0.6);
        const len = 0.3 - Math.abs(a) * 0.06;
        part(q, Geo.cone(0.045, len, 5, 'bottom'), quill, 0, 0, 0);
        part(q, Geo.cone(0.02, len * 0.3, 4, 'bottom'), tip, 0, len * 0.72, 0);
        this.glowPart(q, Geo.ico(0.035, 0), 0x000000, C.rootHot, 0, 0.01, 0, 0, true);
      }
    }
    // 四条短腿 + 偶蹄（前腿在肩下、后腿在臀下）
    for (const front of [true, false]) {
      for (const s of [1, -1]) {
        const upper = joint(body, s * 0.17, -0.08, front ? 0.2 : -0.32);
        part(upper, Geo.cyl(0.07, 0.055, 0.16, 6, 'top'), hide, 0, 0, 0);
        const lower = joint(upper, 0, -0.16, 0);
        part(lower, Geo.cyl(0.045, 0.04, 0.1, 6, 'top'), hide, 0, 0, 0);
        for (const t of [1, -1]) part(lower, Geo.box(0.035, 0.05, 0.06), hoof, t * 0.022, -0.12, 0.015);
        this.legs.push({ upper, lower, front, side: s });
      }
    }
    // 短尾
    part(body, Geo.cone(0.03, 0.12, 5), hide, 0, 0.02, -0.47, -2.2, 0, 0);
    this.setHeadAnchor(crown, 0, 0.12, 0.06);
    return root;
  }

  protected override afterInit(): void {
    const host = this.model.children[0];
    const n = this.nativeBody;
    const P = n?.pose;
    const at = (bone: string, fallback: THREE.Object3D): THREE.Object3D => P?.bone(bone) ?? fallback;
    // 命中球：刺冠（弱点，前后两颗）+ 身体三颗 + 头
    const crownAnchor = hitAnchor(at('quill_2', this.crown), host, CROWN.x, CROWN.y, CROWN.z);
    this.hits.push({ anchor: crownAnchor, r: HAOZHI_DEF.headRadius!, head: true });
    this.hits.push({ anchor: hitAnchor(at('quill_3', this.crown), host, 0, 0.58, -0.28), r: 0.2, head: true });
    this.hits.push({ anchor: hitAnchor(at('chest', this.body), host, 0, 0.38, 0.24), r: 0.24, head: false });
    this.hits.push({ anchor: hitAnchor(at('spine', this.body), host, 0, 0.36, -0.02), r: 0.25, head: false });
    this.hits.push({ anchor: hitAnchor(at('hips', this.body), host, 0, 0.36, -0.3), r: 0.24, head: false });
    this.hits.push({ anchor: hitAnchor(at('head', this.head), host, 0, 0.34, 0.44), r: 0.15, head: false });
    this.setHeadAnchor(crownAnchor, 0, 0, 0);
    if (!n) return;
    // 白模身体整组隐藏（含刺根发光芯）
    this.body.visible = false;
    this.glow = applyFrostGlow(n.materials[0], 'haozhi', [
      // 刺根：刺冠里发白的冰棱，越靠根越亮（青紫）
      { color: C.root, hue: [0.6, 0.14], minVal: 0.62, box: { min: [0, 0.44, -0.6], max: [0.36, 0.95, 0.5], soft: 0.04, absX: true }, fadeY: [0.5, 0.86], shimmer: 0.5 },
      // 眼睛（青色小眼）
      { color: C.eye, hue: [0.5, 0.1], minSat: 0.3, minVal: 0.55, box: { min: [0.05, 0.33, 0.33], max: [0.17, 0.45, 0.47], soft: 0.01, absX: true }, shimmer: 0.1 },
    ]);
  }

  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive) return false;
    if (this.hits.length === 0 || this.age < this.spawnDuration) return super.raycastHit(origin, dir, maxDist, out);
    return raycastSpheres(this.hits, this.sizeScale, origin, dir, maxDist, out);
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    return this.localPoint(BODY.x, BODY.y, BODY.z, out);
  }

  protected override ai(dt: number): void {
    const pl = this.ctx.player;
    const d = this.distToPlayerXZ();
    switch (this.state) {
      case 'chase': {
        this.glowTarget[0] = 0.15;
        this.clearTimer -= dt;
        if (this.clearTimer <= 0) {
          this.clearTimer = 0.2;
          this.pathClear = this.sees && d <= CHARGE_RANGE && this.verticalReach(1.2) && (d < 4 || this.directPathClear(pl.position));
        }
        if (this.cooldown <= 0 && this.sees && this.verticalReach(1.6) && d <= NOVA_RANGE) {
          this.startBristle();
          break;
        }
        if (this.cooldown <= 0 && this.pathClear && d <= CHARGE_RANGE) {
          this.scrapeTime = this.windup(SCRAPE_TIME, 0.3);
          this.setState('scrape');
          this.stopMoving();
          this.ctx.audio.play('telegraph', { position: this.position, volume: 0.7, pitch: 0.8 });
          break;
        }
        // 冷却没好时贴到 2.5 米就停下拱地，不往玩家身上撞
        if (this.approachPlayer(this.speed, 2.5)) this.facePlayer(5, dt);
        else this.faceMovement(8, dt);
        break;
      }
      case 'scrape': {
        // 刨地：低头对准玩家，前蹄往后刨两下，鼻孔喷白气
        this.stopMoving();
        this.facePlayer(7, dt);
        this.glowTarget[0] = 0.3 + 0.4 * clamp01(this.stateTime / this.scrapeTime);
        if (this.stateTime >= this.scrapeTime) {
          this.chargeYaw = this.facing;
          this.accel = 34;
          this.setState('charge');
          this.localPoint(0, 0.1, 0.3, _c);
          this.ctx.fx.burst(_c, 0xe8f4ff, 10, 3, 0.45, 0.1, 4);
        }
        break;
      }
      case 'charge': {
        _p.subVectors(pl.position, this.position);
        this.chargeYaw = rotateTowards(this.chargeYaw, Math.atan2(_p.x, _p.z), CHARGE_TURN * (this.isElite ? 1.25 : 1) * dt);
        const v = Math.min(CHARGE_SPEED * (this.isElite ? 1.1 : 1), CHARGE_START + this.stateTime * CHARGE_RAMP);
        this.setMove(Math.sin(this.chargeYaw), Math.cos(this.chargeYaw), v);
        this.facing = this.chargeYaw;
        this.glowTarget[0] = 0.6;
        if (d <= NOVA_RANGE && this.verticalReach(1.8)) {
          this.startBristle();
          break;
        }
        const wall = this.moveResult.hitWall && this.stateTime > 0.3;
        if (wall || this.stateTime >= CHARGE_MAX_TIME) this.stagger(wall);
        break;
      }
      case 'bristle': {
        // 急停（滑一小段）后竖刺；朝向锁死，辐条与冰刺方向一致
        this.stopMoving();
        const t = clamp01(this.stateTime / this.bristleTime);
        this.glowTarget[0] = 0.5 + 0.5 * t;
        this.tintBody(0x7a6cff, t * 0.45);
        this.spokes?.update(t);
        if (this.stateTime >= this.bristleTime) this.nova();
        break;
      }
      case 'stagger': {
        this.stopMoving();
        this.glowTarget[0] = 0.1;
        if (this.stateTime >= STAGGER_TIME) {
          this.accel = 30;
          this.setState('chase');
          this.rollCooldown(1.4, 2.4);
        }
        break;
      }
      default:
        this.setState('chase');
    }
  }

  private startBristle(): void {
    this.bristleTime = this.windup(BRISTLE_TIME, 0.5);
    this.setState('bristle');
    this.accel = 22;
    this.stopMoving();
    // 一条辐条正对玩家：站着不动必中，横移进缝隙或找掩体
    const pl = this.ctx.player.position;
    this.novaYaw = Math.atan2(pl.x - this.position.x, pl.z - this.position.z);
    this.spokes?.release();
    this.spokes = new NovaSpokes(this.ctx, this.position, QUILLS, this.novaYaw, QUILL_RANGE);
    this.ctx.audio.play('telegraph', { position: this.position, volume: 1, pitch: 1.1 });
    this.getBodyCenter(_c);
    this.ctx.fx.burst(_c, 0xd8ccff, 10, 2.5, 0.4, 0.08, 0);
  }

  private stagger(wall: boolean): void {
    this.setState('stagger');
    this.accel = 20;
    if (wall) {
      this.velocity.x *= -0.3;
      this.velocity.z *= -0.3;
      this.localPoint(0, 0.4, 0.5, _c);
      iceShatter(this.ctx, _c, 0.6);
      this.ctx.audio.play('land', { position: _c, volume: 0.7, pitch: 0.8 });
    }
  }

  /** 射出一圈冰刺：count 根，从 yaw0 起均分一周（世界方向） */
  private fireQuills(count: number, damage: number, yaw0: number): void {
    const y = this.position.y + QUILL_Y * this.sizeScale;
    for (let i = 0; i < count; i++) {
      const a = yaw0 + (i / count) * Math.PI * 2;
      const sx = Math.sin(a), sz = Math.cos(a);
      this.ctx.projectiles.spawn({
        owner: 'enemy',
        position: new THREE.Vector3(this.position.x + sx * 0.35 * this.sizeScale, y, this.position.z + sz * 0.35 * this.sizeScale),
        velocity: new THREE.Vector3(sx * QUILL_SPEED, 0, sz * QUILL_SPEED),
        gravity: 0,
        radius: QUILL_RADIUS,
        lifetime: QUILL_RANGE / QUILL_SPEED,
        enemyDamage: damage,
        element: 'none',
        color: 0xcfe6ff,
        visual: 'shard',
        scale: 1.7,
        sourceEnemy: this,
      });
    }
    this.ctx.audio.play('enemy_shot', { position: this.position, volume: 0.9, pitch: 0.7 });
  }

  /** 冰刺新星：射出整圈冰刺、留下残刺阵，自身死亡（不经过 combat：不算玩家击杀、不掉落） */
  private nova(): void {
    if (this.detonated || !this.alive) return;
    this.detonated = true;
    this.spokes?.release();
    this.spokes = null;
    this.fireQuills(QUILLS, this.def.damage * this.damageMult, this.novaYaw);
    const center = this.getBodyCenter(new THREE.Vector3());
    iceShatter(this.ctx, center, 1.4 * this.sizeScale, 0xd8ccff);
    this.ctx.fx.ring(center, QUILL_RANGE * 0.5, 0xc8bcff, 0.35);
    this.ctx.fx.shake(0.35, 0.25);
    this.ctx.audio.play('explosion', { position: center, pitch: 1.5, volume: 0.7 });
    this.leaveField(center);
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

  /** 残刺阵：斜插的一圈冰刺，每 0.5 秒扎一下站在里面的玩家 */
  private leaveField(center: THREE.Vector3): void {
    const ctx = this.ctx;
    const gy = ctx.world.groundHeight(center.x, center.z, center.y + 0.5);
    const ground = new THREE.Vector3(center.x, Number.isFinite(gy) ? Math.min(gy, center.y) : this.position.y, center.z);
    if (center.y - ground.y > 2.5) return;
    const r = FIELD_RADIUS * (this.isElite ? 1.2 : 1);
    spawnQuillField(ctx, ground, 0.7, r, this.isElite ? 18 : 14, FIELD_TIME);
    const dmg = this.def.damage * this.damageMult * FIELD_RATIO;
    let t = 0, tick = FIELD_TICK;
    ctx.tasks.add((dt) => {
      t += dt;
      tick -= dt;
      if (tick <= 0) {
        tick += FIELD_TICK;
        zonePlayer(ctx, ground, r, dmg, 'none', null, 1.2);
      }
      return t >= FIELD_TIME;
    });
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.spokes?.release();
    this.spokes = null;
    if (this.detonated || attackDirector.purging) return;
    // 新星之前被打死：冰刺只射出一半、伤害减半，不留残刺（延后一帧，避免在 combat 结算里生成投射物）
    this.detonated = true;
    const yaw0 = this.facing + Math.PI / 8;
    const dmg = this.def.damage * this.damageMult * 0.5;
    const center = this.getBodyCenter(new THREE.Vector3());
    iceShatter(this.ctx, center, 0.9 * this.sizeScale, 0xd8ccff);
    this.ctx.tasks.delay(0.05, () => this.fireQuills(QUILLS / 2, dmg, yaw0));
  }

  protected override cancelAttack(): void {
    this.spokes?.release();
    this.spokes = null;
    if (this.alive && (this.state === 'scrape' || this.state === 'charge' || this.state === 'bristle')) {
      // 眩晕 / 清理 / 玩家死亡：刺收回去，回去追
      this.setState('chase');
      this.restoreTint();
      this.accel = 30;
      this.rollCooldown(1.2, 2.2);
    }
  }

  protected override onDispose(): void {
    super.onDispose();
    this.spokes?.release();
    this.spokes = null;
  }

  protected override animateDeath(t: number): void {
    // 炸开：一下膨胀后缩没
    const s = this.sizeScale * (t < 0.3 ? 1 + t * 0.8 : Math.max(0.01, 1.24 * (1 - (t - 0.3) / 0.7)));
    this.model.scale.setScalar(s);
  }

  protected override pose(dt: number): void {
    const bristle = this.state === 'bristle' ? clamp01(this.stateTime / this.bristleTime) : 0;
    this.pBristle = damp(this.pBristle, bristle, 20, dt);
    this.pCharge = damp(this.pCharge, this.state === 'charge' ? 1 : this.state === 'scrape' ? 0.6 : 0, 10, dt);
    this.pScrape = damp(this.pScrape, this.state === 'scrape' ? 1 : 0, 14, dt);
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.nativeBody) this.poseNative(this.nativeBody, sp, dt);
    else this.poseBlockout(sp);

    // 冰光：刺根随蓄刺越来越亮（最后 0.2 秒闪烁），冲锋时微亮；眼睛常亮、冲锋时更亮
    FROST_FX_TIME.value = this.ctx.time.now;
    const b = this.pBristle;
    const flick = b > 0.7 ? (Math.sin(this.stateTime * 45) > 0 ? 1 : 0.6) : 1;
    if (this.glow) {
      this.glow.strength[0].value = (0.18 + 0.25 * this.pCharge + 1.8 * b * flick) * (this.alive ? 1 : 0.3);
      this.glow.strength[1].value = 0.8 + 0.8 * this.pCharge;
    }
    // 刨地 / 冲锋时鼻孔喷白气
    this.steamAcc += dt * (this.pScrape * 6 + this.pCharge * 2);
    if (this.steamAcc > 0.3) {
      this.steamAcc = 0;
      this.localPoint(0, 0.3, 0.55, _c);
      this.ctx.fx.burst(_c, C.steam, 3, 0.8, 0.5, 0.09 * this.sizeScale, -0.6);
    }
    if (this.state === 'charge' && sp > 6 && Math.random() < dt * 14) {
      // 冲锋扬雪
      this.localPoint((Math.random() - 0.5) * 0.4, 0.05, -0.3, _c);
      this.ctx.fx.burst(_c, 0xf2f8ff, 2, 1.4, 0.45, 0.08, 3);
    }
  }

  /**
   * 美术骨骼动画：步态相位驱动四条腿的 IK（小跑对角步 → 冲锋横向奔跑）；冲锋时低头、脊背一屈一伸；
   * 刨地时左前蹄往后刨；蓄刺时刺冠三段竖起、两侧外张，身子压低、四蹄撑开、全身打颤；冲空撞晕时甩头。
   */
  private poseNative(n: NativeBody, sp: number, dt: number): void {
    const P = n.pose;
    P.reset();
    const b = this.pBristle, c = this.pCharge, sc = this.pScrape;
    const move = clamp01(sp / 1.2);
    const sn = clamp01(sp / CHARGE_SPEED);
    const freq = GAIT_FREQ[0] + (GAIT_FREQ[1] - GAIT_FREQ[0]) * sn;
    this.gait = (this.gait + freq * dt * move) % 1;
    const duty = GAIT_DUTY[0] + (GAIT_DUTY[1] - GAIT_DUTY[0]) * sn;
    const sweep = Math.min(GAIT_SWEEP, (sp * duty) / (freq * this.sizeScale)) * (1 - b);
    const lift = (GAIT_LIFT[0] + (GAIT_LIFT[1] - GAIT_LIFT[0]) * sn) * move * (1 - b);
    const ph = this.gait * Math.PI * 2;
    const shiver = b > 0.3 ? Math.sin(this.age * 55) * 0.02 * b : 0;

    // 身体：随步子起伏；冲锋时前低后高、脊背屈伸；蓄刺时压低打颤；受击后仰；撞晕摇晃
    P.translate('hips', 0, 0.012 * move * Math.sin(ph * 2) - 0.035 * b, 0);
    P.rotate('hips', AX, 0.06 * c + 0.05 * sn * Math.sin(ph) + shiver);
    P.rotate('spine', AX, -0.08 * sn * Math.sin(ph + 0.6) - 0.06 * b);
    P.rotate('chest', AX, 0.05 * c - this.hurtKick * 0.3);
    if (this.stunTime > 0 || this.state === 'stagger') P.rotate('hips', AZ, Math.sin(this.age * 9) * 0.12);
    // 头：冲锋 / 刨地时低头顶出獠牙，蓄刺时低头缩颈，撞晕时甩头；平时抬头嗅
    const sniff = (1 - c) * (1 - b) * (1 - move);
    P.rotate('neck', AX, 0.32 * c + 0.2 * b - 0.1 * sniff + 0.04 * Math.sin(ph) * move);
    P.rotate('head', AX, 0.15 * c + 0.12 * b + 0.05 * Math.sin(this.age * 6) * sniff);
    P.rotate('head', AY, this.state === 'stagger' ? Math.sin(this.age * 14) * 0.45 : sniff * Math.sin(this.age * 2.2) * 0.25);
    // 刺冠：蓄刺时三段依次竖起（前快后慢），两侧外张，整丛变大；冲锋时微微竖起；跑动时随步子颤
    for (let i = 0; i < QUILL_BONES.length; i++) {
      const k = clamp01(b * 1.25 - i * 0.12);
      P.rotate(QUILL_BONES[i], AX, 0.55 * k + 0.1 * c + 0.03 * move * Math.sin(ph * 2 - i));
      P.scale(QUILL_BONES[i], 1 + 0.16 * k);
    }
    P.rotate('quill_L', AZ, -0.45 * b - 0.06 * c);
    P.rotate('quill_R', AZ, 0.45 * b + 0.06 * c);
    P.scale('quill_L', 1 + 0.12 * b);
    P.scale('quill_R', 1 + 0.12 * b);
    P.rotate('tail', AY, Math.sin(this.age * (6 + 10 * c)) * 0.4);
    P.rotate('tail', AX, -0.5 * b);
    // 腿 IK：触地段从前往后扫，腾空段抬蹄前摆；蓄刺时四蹄外撑；刨地时左前蹄往后刨两下
    for (const leg of LEGS) {
      const rest = P.restPosition(leg.e);
      if (!rest) continue;
      const off = leg.trot + (leg.gallop - leg.trot) * sn;
      const u = (this.gait + off) % 1;
      let dz: number, dy: number;
      if (u < duty) {
        dz = sweep * (0.5 - u / duty);
        dy = 0;
      } else {
        const t = (u - duty) / (1 - duty);
        dz = sweep * (-0.5 + t * t * (3 - 2 * t));
        dy = Math.sin(t * Math.PI) * lift;
      }
      if (leg.e === 'paw_L' && sc > 0.05) {
        const s = (this.stateTime / this.scrapeTime) * 2;
        const w = s % 1;
        dz += sc * (w < 0.5 ? 0.08 - w * 0.36 : -0.1 + (w - 0.5) * 0.36);
        dy += sc * (w < 0.5 ? 0.01 : Math.sin((w - 0.5) * 2 * Math.PI) * 0.05);
      }
      const side = rest.x > 0 ? 1 : -1;
      _t.set(rest.x + side * 0.04 * b, rest.y + dy, rest.z + dz + (leg.front ? 0.02 : -0.03) * b);
      P.twoBoneIK(leg.u, leg.l, leg.e, _t, 1);
    }
  }

  /** 白模动画：对角小跑、冲锋低头，蓄刺时三排冰刺依次竖起、刺根发光芯变大 */
  private poseBlockout(sp: number): void {
    const b = this.pBristle, c = this.pCharge;
    const amp = Math.min(1.2, sp / Math.max(1, this.def.speed)) * (1 - b);
    const ph = this.walkPhase * 1.6;
    this.body.position.y = BODY.y + Math.abs(Math.sin(ph)) * 0.02 * amp - 0.03 * b;
    this.body.rotation.x = 0.06 * c - this.hurtKick * 0.25;
    this.body.rotation.z = this.stunTime > 0 || this.state === 'stagger' ? Math.sin(this.age * 9) * 0.15 : 0;
    this.head.rotation.set(0.35 * c + 0.2 * b, this.state === 'stagger' ? Math.sin(this.age * 14) * 0.45 : 0, 0);
    for (let i = 0; i < this.quillRows.length; i++) {
      const k = clamp01(b * 1.25 - i * 0.12);
      this.quillRows[i].rotation.x = -0.6 * k - 0.1 * c;
      this.quillRows[i].scale.setScalar(1 + 0.18 * k);
    }
    for (const l of this.legs) {
      const off = (l.front ? 0 : Math.PI) + (l.side > 0 ? 0 : Math.PI);
      const swing = Math.sin(ph + off);
      l.upper.rotation.x = swing * 0.6 * amp;
      l.lower.rotation.x = (l.front ? 1 : -1) * Math.max(0, -swing) * 0.5 * amp;
      l.upper.rotation.z = l.side * 0.15 * b;
    }
  }
}
