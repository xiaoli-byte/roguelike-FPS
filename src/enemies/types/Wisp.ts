/**
 * 幽灵飞灯（wisp）：飞行的纸灯笼鬼。悬停 3–4.5 米、保持 9–17 米横移漂浮；
 * 核心充能 0.6 秒（鬼火变亮、灯身旋转加快）后发射一枚缓慢追踪的光球（精英两枚）。
 * 看不到玩家时升高并寻找视线。灯笼上的鬼脸是弱点。
 *
 * 状态机：drift → charge → recover → drift
 */
import * as THREE from 'three';
import type { EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { clamp01 } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import { Geo, additiveMat, flat, joint, part } from '../Models';

export const WISP_DEF: EnemyDef = {
  id: 'wisp',
  name: '幽灵飞灯',
  hp: 60,
  shield: 40,
  speed: 5.5,
  radius: 0.36,
  height: 1.1,
  flying: true,
  damage: 10,
  coins: [2, 4],
  essence: 1,
  headY: 0.74,
  headRadius: 0.3,
  knockbackResist: 0.2,
  color: 0x8fe8ff,
};

const MIN_RANGE = 9;
const MAX_RANGE = 17;
const CHARGE_TIME = 0.6;
const ORB_SPEED = 8.5;
const ORB_HOMING = 1.5;

const C = {
  paper: 0xd9482b, paperGlow: 0x5a1a08, wood: 0x2e1c12, tassel: 0xb3202a, gold: 0xc9a24a,
  face: 0x7fe0ff, faceHot: 0xffffff, core: 0x3aa8e8, coreHot: 0xeaffff, flame: 0x5fd8ff,
};

const _muzzle = new THREE.Vector3();
const _side = new THREE.Vector3();

export class Wisp extends StandardEnemy {
  private lantern!: THREE.Group;
  private rings: THREE.Mesh[] = [];
  private tassels: THREE.Group[] = [];
  private flame!: THREE.Mesh;
  private chargeTime = CHARGE_TIME;
  private readonly baseHover: number;
  private bobPhase: number;
  private spin = 0;

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, WISP_DEF, opts);
    this.baseHover = ctx.rng.range(3.0, 4.4);
    this.hoverHeight = this.baseHover;
    this.bobPhase = ctx.rng.range(0, Math.PI * 2);
    this.accel = 14;
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const L = joint(root, 0, 0.62, 0);
    this.lantern = L;
    // 纸灯身（自发光的红纸）+ 木框
    part(L, Geo.cyl(0.3, 0.3, 0.5, 8), flat(C.paper, { emissive: C.paperGlow, ei: 1.2, rough: 0.95 }), 0, 0, 0);
    for (const y of [-0.26, 0.26]) this.rings.push(part(L, Geo.torus(0.31, 0.03, 4, 8), flat(C.wood), 0, y, 0, Math.PI / 2, 0, 0));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 8;
      part(L, Geo.box(0.025, 0.5, 0.025), flat(C.wood), Math.sin(a) * 0.29, 0, Math.cos(a) * 0.29);
    }
    part(L, Geo.cyl(0.18, 0.31, 0.1, 8), flat(C.wood), 0, 0.31, 0);
    part(L, Geo.cyl(0.31, 0.18, 0.08, 8), flat(C.wood), 0, -0.3, 0);
    part(L, Geo.torus(0.07, 0.015, 4, 10), flat(C.gold, { metal: 0.6 }), 0, 0.41, 0);
    // 鬼脸（弱点）
    this.glowPart(L, Geo.box(0.085, 0.055, 0.02), C.face, C.faceHot, 0.09, 0.11, 0.285);
    this.glowPart(L, Geo.box(0.085, 0.055, 0.02), C.face, C.faceHot, -0.09, 0.11, 0.285);
    this.glowPart(L, Geo.box(0.14, 0.035, 0.02), C.face, C.faceHot, 0, -0.03, 0.285);
    // 灯芯鬼火 + 下垂的幽焰
    this.glowPart(L, Geo.ico(0.12), C.core, C.coreHot, 0, -0.34, 0);
    this.flame = part(L, Geo.cone(0.17, 0.55, 6), additiveMat(C.flame, 0.55), 0, -0.6, 0, Math.PI, 0, 0);
    // 流苏
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const tg = joint(L, Math.sin(a) * 0.22, -0.34, Math.cos(a) * 0.22);
      part(tg, Geo.box(0.035, 0.34, 0.035, 'top'), flat(C.tassel), 0, 0, 0);
      part(tg, Geo.ico(0.04), flat(C.gold, { metal: 0.6 }), 0, -0.34, 0);
      this.tassels.push(tg);
    }
    return root;
  }

  override getMuzzle(out: THREE.Vector3): THREE.Vector3 {
    return this.localPoint(0, 0.28, 0.35, out);
  }

  protected override ai(dt: number): void {
    const d = this.distToPlayerXZ();
    this.updateHover();
    switch (this.state) {
      case 'chase':
      case 'drift': {
        this.glowTarget[0] = 0.15;
        if (this.seekSight(MIN_RANGE - 2, MAX_RANGE, this.speed, this.hoverHeight)) {
          this.faceMovement(4, dt);
          break;
        }
        this.keepRange(MIN_RANGE, MAX_RANGE, this.speed, 0.7);
        this.facePlayer(5, dt);
        if (this.cooldown <= 0 && this.sees && d <= 26) {
          if (this.requestAttack('ranged', CHARGE_TIME + 0.9)) {
            this.chargeTime = this.windup(CHARGE_TIME, 0.4);
            this.setState('charge');
            this.getMuzzle(_muzzle);
            this.ctx.fx.burst(_muzzle, C.flame, 8, 1.5, 0.5, 0.08, -1);
          } else {
            this.cooldown = this.ctx.rng.range(0.3, 0.8);
          }
        }
        break;
      }
      case 'charge': {
        this.glowTarget[0] = 0.3 + 0.7 * clamp01(this.stateTime / this.chargeTime);
        this.facePlayer(6, dt);
        this.keepRange(MIN_RANGE, MAX_RANGE, this.speed * 0.3, 0.3);
        if (this.stateTime >= this.chargeTime) {
          this.fireOrbs();
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        this.glowTarget[0] = 0.15;
        this.keepRange(MIN_RANGE, MAX_RANGE, this.speed, 0.7);
        this.facePlayer(4, dt);
        if (this.stateTime >= 0.4) {
          this.releaseAttack();
          this.rollCooldown(2.6, 4.0);
          this.setState('drift');
        }
        break;
      }
      default:
        this.setState('drift');
    }
  }

  /** 悬停高度：随玩家所在高度抬升，看不到玩家时再升高一些，并带缓慢起伏 */
  private updateHover(): void {
    const floor = this.ctx.stage.arena?.floorY ?? 0;
    const pl = this.ctx.player.position;
    let y = Math.max(floor + this.baseHover, pl.y + this.baseHover * 0.8);
    if (this.blindTime > 0.6) y += 1.5;
    this.flyTargetY = y + Math.sin(this.age * 1.6 + this.bobPhase) * 0.35;
  }

  private fireOrbs(): void {
    const count = this.isElite ? 2 : 1;
    this.getMuzzle(_muzzle);
    for (let i = 0; i < count; i++) {
      let from = _muzzle;
      if (count > 1) {
        // 左右各一枚，初速略微外偏，形成夹击
        const s = i === 0 ? 1 : -1;
        _side.set(Math.cos(this.facing) * s * 0.4, 0, -Math.sin(this.facing) * s * 0.4).add(_muzzle);
        from = _side;
      }
      this.shoot({
        speed: ORB_SPEED, damage: this.def.damage, radius: 0.3, color: 0x9ff0ff,
        homing: ORB_HOMING, visual: 'orb', lifetime: 5.5, scale: 1.3, from, spread: count > 1 ? 0.12 : 0,
      });
    }
    this.ctx.fx.burst(_muzzle, C.flame, 12, 3, 0.4, 0.08, 0);
  }

  protected override cancelAttack(): void {
    this.glowTarget[0] = 0.15;
    if (this.state === 'charge' || this.state === 'recover') {
      this.setState('drift');
      this.rollCooldown(0.8, 1.4);
    }
  }

  protected override pose(dt: number): void {
    const L = this.lantern;
    const sn = Math.sin(this.facing);
    const cs = Math.cos(this.facing);
    const vx = this.velocity.x;
    const vz = this.velocity.z;
    const fwd = vx * sn + vz * cs;
    const lat = vx * cs - vz * sn;
    const charging = this.state === 'charge';
    L.rotation.x = fwd * 0.05 - this.hurtKick * 0.5;
    L.rotation.z = -lat * 0.05 + Math.sin(this.age * 1.8 + this.bobPhase) * 0.08;
    if (this.stunTime > 0) L.rotation.z += Math.sin(this.age * 9) * 0.3;
    this.spin += dt * (1.2 + this.glowLevel[0] * 9);
    this.rings[0].rotation.z = this.spin;
    this.rings[1].rotation.z = -this.spin;
    for (let i = 0; i < this.tassels.length; i++) {
      const tg = this.tassels[i];
      tg.rotation.x = -fwd * 0.08 + Math.sin(this.age * 3 + i * 2) * 0.15;
      tg.rotation.z = lat * 0.08 + Math.cos(this.age * 2.6 + i) * 0.12;
    }
    const f = 1 + Math.sin(this.age * 13) * 0.08 + (charging ? this.glowLevel[0] * 0.5 : 0);
    this.flame.scale.set(f, 1 + Math.sin(this.age * 9) * 0.15 + (charging ? 0.4 : 0), f);
  }

  protected override animateDeath(t: number): void {
    // 坠落时打转、熄灭缩小
    this.model.rotation.z = t * 4;
    this.model.rotation.x = -t * 1.2;
    this.model.scale.setScalar(Math.max(0.01, this.sizeScale * (1 - t * t * 0.7)));
  }
}
