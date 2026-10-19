/**
 * 第四章 8 种雷魅（+ 雷牦）的游玩版 AI。战斗设计见 docs/art/enemy-roster-v2.md「第四章」，数值见 chuanzang-v1.md 2.6。
 * 每只怪：正式模型（原生骨架）+ 程序化动作 + 一组命中球（弱点倍率更高）。
 * 状态：idle（在领地里待着）→ alert（发现玩家，整片遇敌一起醒）→ dead。玩家跑远了（离领地中心 r + 80 m）就脱战回家回血。
 */
import * as THREE from 'three';
import type { NativeBody } from '../../../assets/NativeRig';
import type { MonsterKind } from '../spec';
import { basinDistance } from '../terrain';
import { CreatureAnimator, newAnimState, type AnimState, type Gait } from './anim';
import { spawnCreature, spawnStatic, type PlateauModel } from './assets';
import type { HitSphere, PlayCtx, Target } from './core';
import { boulderMesh } from './fx';

const MAGENTA = new THREE.Color('#ff4fd8');
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

interface SphereSpec { bone: string; r: number; mult: number }
interface FoeSpec {
  model: PlateauModel; scale: number; gait: Gait; hp: number; speed: number; stride: number;
  spheres: SphereSpec[];
  /** 发现玩家的视距 */
  sight: number;
}

export const FOE_SPECS: Record<MonsterKind, FoeSpec> = {
  marmot: { model: 'SK_Enemy_Marmot', scale: 1.3, gait: 'upright', hp: 40, speed: 6.5, stride: 0.5, sight: 26,
    spheres: [{ bone: 'spine', r: 0.32, mult: 1 }, { bone: 'head', r: 0.2, mult: 2 }] },
  tiangou: { model: 'SK_Enemy_Tiangou', scale: 1.1, gait: 'quad', hp: 70, speed: 9.5, stride: 1.1, sight: 30,
    spheres: [{ bone: 'chest', r: 0.42, mult: 1 }, { bone: 'hips', r: 0.38, mult: 1 }, { bone: 'head', r: 0.24, mult: 2 }] },
  aoyin: { model: 'SK_Enemy_Aoyin', scale: 1, gait: 'quad', hp: 420, speed: 4.5, stride: 1.6, sight: 30,
    spheres: [{ bone: 'chest', r: 1.0, mult: 1 }, { bone: 'hips', r: 0.9, mult: 1 }, { bone: 'head', r: 0.45, mult: 1.6 }, { bone: 'orb', r: 0.45, mult: 2.5 }] },
  leiyak: { model: 'SK_Enemy_Aoyin', scale: 0.72, gait: 'quad', hp: 180, speed: 5.2, stride: 1.3, sight: 28,
    spheres: [{ bone: 'chest', r: 1.0, mult: 1 }, { bone: 'hips', r: 0.9, mult: 1 }, { bone: 'head', r: 0.45, mult: 2 }] },
  jufu: { model: 'SK_Enemy_Jufu', scale: 1, gait: 'biped', hp: 150, speed: 0, stride: 0.9, sight: 55,
    spheres: [{ bone: 'chest', r: 0.42, mult: 1 }, { bone: 'hips', r: 0.36, mult: 1 }, { bone: 'head', r: 0.24, mult: 2 }, { bone: 'palm', r: 0.22, mult: 2 }] },
  manman: { model: 'SK_Enemy_Manman', scale: 1.4, gait: 'bird', hp: 55, speed: 9, stride: 0.6, sight: 40,
    spheres: [{ bone: 'chest', r: 0.42, mult: 1 }, { bone: 'eye', r: 0.18, mult: 2.5 }] },
  liangu: { model: 'SM_EnemyPart_LianguCore', scale: 1, gait: 'quad', hp: 240, speed: 4, stride: 1, sight: 34, spheres: [] },
  dijiang: { model: 'SK_Enemy_Dijiang', scale: 1.2, gait: 'hexa', hp: 55, speed: 7.5, stride: 0.5, sight: 30,
    spheres: [{ bone: 'body', r: 0.6, mult: 1 }, { bone: 'core', r: 0.25, mult: 2 }] },
  qiongqi: { model: 'SK_Enemy_Qiongqi', scale: 1.25, gait: 'quad', hp: 650, speed: 5, stride: 1.4, sight: 34,
    spheres: [{ bone: 'chest', r: 0.75, mult: 1 }, { bone: 'hips', r: 0.65, mult: 1 }, { bone: 'head', r: 0.38, mult: 2 }, { bone: 'crown', r: 0.3, mult: 2.5 }] },
};

export interface EncounterState {
  id: string; site: string; x: number; z: number; r: number;
  foes: Foe[];
  alerted: boolean;
  cleared: boolean;
}

/** 一只怪：模型、动作、命中球、AI 状态 */
export class Foe implements Target {
  readonly label: string;
  readonly spec: FoeSpec;
  readonly host: THREE.Group;
  readonly body: NativeBody | null;
  readonly anim: AnimState = newAnimState();
  readonly animator: CreatureAnimator | null;
  readonly pos = new THREE.Vector3();
  readonly home = new THREE.Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  state: 'idle' | 'alert' | 'dead' = 'idle';
  /** 被连鼓灵护住（伤害减半）的剩余时间 */
  shield = 0;
  /** 离地高度（飞的、站在屋顶上的） */
  hover: number;
  enc: EncounterState | null = null;
  sentinel = false;
  protected cd = 0;
  protected act = '';
  protected actT = 0;
  protected readonly mem: Record<string, number> = {};
  protected readonly vel = new THREE.Vector3();
  protected deadT = 0;
  private flash = 0;
  private readonly hitList: HitSphere[];
  private readonly extras: THREE.Object3D[] = [];
  private readonly shieldMesh: THREE.Mesh;

  constructor(readonly kind: MonsterKind, readonly scene: THREE.Scene, at: THREE.Vector3, hover: number, readonly names: Record<MonsterKind, string>) {
    this.spec = FOE_SPECS[kind];
    this.label = names[kind];
    this.hp = this.maxHp = this.spec.hp;
    this.hover = hover;
    if (kind === 'liangu') {
      this.host = buildLiangu();
      this.body = null;
      this.animator = null;
    } else {
      const c = spawnCreature(this.spec.model, this.spec.scale);
      this.host = c.host;
      this.body = c.body;
      this.animator = new CreatureAnimator(c.body.pose, this.spec.gait);
    }
    this.hitList = (kind === 'liangu' ? [{ bone: '', r: 0.5, mult: 2 }, { bone: '', r: 1.25, mult: 1 }] : this.spec.spheres)
      .map(s => ({ c: new THREE.Vector3(), r: s.r * this.spec.scale, mult: s.mult }));
    if (kind === 'leiyak') this.hitList.splice(3);
    // 獓狠的角间雷球、举父手里的雷石：插槽上的程序化件
    if (kind === 'aoyin') this.extras.push(glowOrb(0.42));
    if (kind === 'jufu') this.extras.push(boulderMesh(0.55));
    for (const e of this.extras) scene.add(e);
    this.shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({
      color: '#c792ff', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.shieldMesh.visible = false;
    scene.add(this.host, this.shieldMesh);
    this.pos.copy(at);
    this.home.copy(at);
  }

  get alive(): boolean { return this.state !== 'dead'; }

  spheres(): readonly HitSphere[] {
    if (!this.body) {
      // 连鼓灵：雷心 + 一圈鼓
      this.hitList[0].c.set(this.pos.x, this.pos.y + 0.45, this.pos.z);
      this.hitList[1].c.copy(this.hitList[0].c);
      return this.hitList;
    }
    const P = this.body.pose;
    this.spec.spheres.forEach((s, i) => {
      if (i >= this.hitList.length) return;
      const b = P.bone(s.bone);
      if (b) b.getWorldPosition(this.hitList[i].c);
      else this.hitList[i].c.copy(this.pos).setY(this.pos.y + 0.5 * this.spec.scale);
    });
    return this.hitList;
  }

  hit(dmg: number, mult: number, _at: THREE.Vector3): number {
    if (!this.alive) return 0;
    const d = dmg * mult * (this.shield > 0 ? 0.5 : 1);
    this.hp -= d;
    this.flash = 1;
    this.anim.hurt = Math.min(1, this.anim.hurt + 0.6);
    if (this.enc) this.enc.alerted = true;
    this.state = 'alert';
    if (this.hp <= 0) this.die();
    return d;
  }

  die(): void {
    this.state = 'dead';
    this.hp = 0;
    this.deadT = 0;
    this.shieldMesh.visible = false;
    for (const e of this.extras) e.visible = false;
  }

  /** 玩家倒下重来：活着的回家、回满血 */
  reset(): void {
    if (!this.alive) return;
    this.hp = this.maxHp;
    this.state = 'idle';
    this.pos.copy(this.home);
    this.act = ''; this.actT = 0; this.cd = 1;
    this.vel.set(0, 0, 0);
  }

  dispose(): void {
    this.scene.remove(this.host, this.shieldMesh);
    for (const e of this.extras) this.scene.remove(e);
  }

  // ─────────────── 移动 ───────────────

  protected canStand(ctx: PlayCtx, x: number, z: number): boolean {
    const T = ctx.terrain;
    // 怪不出盆地（玩家那边是风雪软边界，怪这边直接不让走）
    if (basinDistance(x, z) > 4) return false;
    if (T.waterDepthAt(x, z) > 0.7 || T.slopeAt(x, z) > 1.1) return false;
    return !ctx.world.blocked(x, z, T.heightAt(x, z));
  }

  protected groundY(ctx: PlayCtx, x: number, z: number): number {
    return ctx.world.groundAt(x, z, this.pos.y + 0.6);
  }

  protected face(angle: number, dt: number, rate = 8): void {
    let d = angle - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
  }

  protected faceTo(x: number, z: number, dt: number, rate = 8): void {
    this.face(Math.atan2(x - this.pos.x, z - this.pos.z), dt, rate);
  }

  /** 朝目标走一步，被挡就左右试几个角度绕；返回走过的距离 */
  protected steer(ctx: PlayCtx, tx: number, tz: number, speed: number, dt: number, keep = 0): number {
    const goal = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    if (goal <= keep + 0.05) return 0;
    // 追玩家（目标在玩家身边）、离得还远，或者上一步卡住了：按寻路场走下一个路点，绕开墙和房子
    if (this.hover <= 0.5 && ctx.nav && goal > keep + 3 && (Math.hypot(tx - ctx.feet.x, tz - ctx.feet.z) < 10 || this.mem.stuck > 0)) {
      const wp = ctx.nav.next(this.pos.x, this.pos.z);
      if (wp) { tx = wp[0]; tz = wp[1]; keep = 0; }
    }
    const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
    if (d <= keep + 0.05) return 0;
    const step = Math.min(d - keep, speed * dt);
    const base = Math.atan2(dx, dz);
    this.mem.stuck = Math.max(0, (this.mem.stuck ?? 0) - dt);
    for (const off of [0, 0.5, -0.5, 1.1, -1.1, 1.6, -1.6]) {
      const a = base + off, nx = this.pos.x + Math.sin(a) * step, nz = this.pos.z + Math.cos(a) * step;
      if (this.hover > 0.5 || this.canStand(ctx, nx, nz)) {
        this.pos.x = nx; this.pos.z = nz;
        if (this.hover <= 0.5) this.pos.y = this.groundY(ctx, nx, nz);
        this.face(a, dt);
        this.anim.phase += (step / this.spec.stride) * Math.PI;
        return step;
      }
    }
    this.mem.stuck = 2;
    return 0;
  }

  /** 冲锋 / 扑击的直线位移：撞到东西就停 */
  protected dash(ctx: PlayCtx, vx: number, vz: number, dt: number): boolean {
    const nx = this.pos.x + vx * dt, nz = this.pos.z + vz * dt;
    if (!this.canStand(ctx, nx, nz)) return false;
    this.pos.x = nx; this.pos.z = nz;
    this.anim.phase += (Math.hypot(vx, vz) * dt / this.spec.stride) * Math.PI;
    return true;
  }

  // ─────────────── 每帧 ───────────────

  update(dt: number, ctx: PlayCtx, near: boolean): void {
    if (this.state === 'dead') {
      this.deadT += dt;
      this.anim.dead = Math.min(1, this.deadT * 2);
      this.anim.move = 0;
      if (this.hover > 0.5 && this.kind !== 'jufu') this.pos.y = Math.max(ctx.terrain.heightAt(this.pos.x, this.pos.z), this.pos.y - dt * 9);
      if (this.deadT > 4) { this.host.visible = false; return; }
      if (this.deadT > 2.2) this.pos.y -= dt * 0.8;
    } else {
      this.cd -= dt;
      this.shield = Math.max(0, this.shield - dt);
      const dist = Math.hypot(ctx.feet.x - this.pos.x, ctx.feet.z - this.pos.z);
      if (this.state === 'idle') this.idle(dt, ctx, dist);
      else if (!ctx.player.alive) this.state = 'idle';
      else this.fight(dt, ctx, dist);
    }
    this.anim.hurt = Math.max(0, this.anim.hurt - dt * 4);
    this.flash = Math.max(0, this.flash - dt * 6);
    this.host.position.copy(this.pos);
    this.host.rotation.y = this.yaw;
    if (near) {
      const look = Math.atan2(ctx.feet.x - this.pos.x, ctx.feet.z - this.pos.z) - this.yaw;
      this.anim.look = this.state === 'alert' ? Math.atan2(Math.sin(look), Math.cos(look)) : 0;
      this.animator?.apply(this.anim, ctx.time + this.home.x);
      if (this.body) {
        const m = this.body.materials[0] as THREE.MeshStandardMaterial;
        m.emissive.setRGB(this.flash * 0.9, this.flash * 0.9, this.flash * 0.9);
      }
      if (this.kind === 'liangu') animateLiangu(this.host, ctx.time, this.act === 'pulse' ? this.actT : 0);
      this.host.updateMatrixWorld(true);
      this.placeExtras();
    }
    this.shieldMesh.visible = this.shield > 0 && this.alive;
    if (this.shieldMesh.visible) {
      this.shieldMesh.position.copy(this.pos).setY(this.pos.y + 0.8 * this.spec.scale * (this.kind === 'aoyin' ? 1.8 : 1));
      this.shieldMesh.scale.setScalar(this.kind === 'aoyin' ? 2.4 : this.kind === 'leiyak' ? 1.8 : 1.2);
    }
  }

  private placeExtras(): void {
    if (!this.body || this.extras.length === 0) return;
    const P = this.body.pose;
    const e = this.extras[0];
    if (this.kind === 'aoyin') {
      P.bone('orb')?.getWorldPosition(e.position);
      e.scale.setScalar(1 + 0.12 * Math.sin(performance.now() / 120));
    }
    if (this.kind === 'jufu') {
      e.visible = this.act === 'throw' && this.alive;
      P.bone('hand_R')?.getWorldPosition(e.position);
      e.position.y += 0.35;
    }
  }

  /** 没发现玩家：原地待着、小范围踱步；看见了就叫醒整片 */
  protected idle(dt: number, ctx: PlayCtx, dist: number): void {
    const back = Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z);
    this.anim.move = 0;
    if (back > 1.5 && this.spec.speed > 0) {
      const moved = this.steer(ctx, this.home.x, this.home.z, this.spec.speed * 0.6, dt);
      this.anim.move = moved > 0 ? 0.6 : 0;
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.3 * dt);
    }
    if (this.hover > 0.5 && this.kind !== 'jufu') {
      // 飞的绕着家盘旋
      const a = ctx.time * 0.5 + this.home.x;
      this.pos.x = this.home.x + Math.cos(a) * 4; this.pos.z = this.home.z + Math.sin(a) * 4;
      this.pos.y = ctx.terrain.heightAt(this.pos.x, this.pos.z) + this.hover;
      this.face(a + Math.PI / 2 + Math.PI, dt);
      this.anim.flap = 1;
    }
    const sight = this.sentinel ? 48 : this.spec.sight;
    if (dist < sight && ctx.player.alive && this.sees(ctx)) this.notice(ctx);
  }

  protected sees(ctx: PlayCtx): boolean {
    const eyeY = this.pos.y + 1.2 * this.spec.scale;
    return ctx.terrain.lineOfSight(this.pos.x, eyeY, this.pos.z, ctx.center.x, ctx.center.y, ctx.center.z);
  }

  /** 发现玩家：自己和整片遇敌都醒 */
  notice(ctx: PlayCtx): void {
    this.state = 'alert';
    if (this.enc && !this.enc.alerted) {
      this.enc.alerted = true;
      for (const f of this.enc.foes) if (f.alive) f.state = 'alert';
    }
    if (this.sentinel && !this.mem.screamed) {
      this.mem.screamed = 1;
      this.act = 'scream'; this.actT = 0;
      ctx.say('啸獭哨兵尖啸——整片的雷魅都醒了');
    }
  }

  /** 发现之后：各种怪各打各的 */
  protected fight(dt: number, ctx: PlayCtx, dist: number): void {
    const P = ctx.feet;
    this.actT += dt;
    this.anim.attack = Math.max(0, this.anim.attack - dt * 3);
    this.anim.jaw = Math.max(0, this.anim.jaw - dt * 3);
    this.anim.crouch = Math.max(0, this.anim.crouch - dt * 4);
    switch (this.kind) {
      case 'marmot': {
        if (this.act === 'scream') {
          this.anim.jaw = 1;
          if (this.actT > 1) this.act = '';
          return;
        }
        if (this.sentinel && this.hover > 0.5 && dist < 30) { this.hover = 0; this.pos.y = this.groundY(ctx, this.pos.x, this.pos.z); }
        const moved = this.steer(ctx, P.x, P.z, this.spec.speed, dt, 1.1);
        this.anim.move = moved > 0 ? 1 : 0;
        if (dist < 1.7 && this.cd <= 0) {
          this.cd = 0.9; this.anim.attack = 1; this.anim.jaw = 1;
          ctx.hurt(6, '啸獭');
        }
        break;
      }
      case 'tiangou': {
        if (this.act === 'lunge') {
          if (this.actT < 0.35) { this.anim.crouch = 1; this.faceTo(P.x, P.z, dt, 12); return; }
          if (this.actT < 0.8) {
            this.anim.attack = 1; this.anim.jaw = 1; this.anim.move = 1;
            this.dash(ctx, this.vel.x, this.vel.z, dt);
            this.pos.y = this.groundY(ctx, this.pos.x, this.pos.z) + Math.sin((this.actT - 0.35) / 0.45 * Math.PI) * 1.2;
            if (!this.mem.bit && Math.hypot(P.x - this.pos.x, P.z - this.pos.z) < 1.8) {
              this.mem.bit = 1;
              ctx.hurt(9, '天狗', { x: this.vel.x * 0.3, z: this.vel.z * 0.3 });
            }
            return;
          }
          this.act = ''; this.cd = 1.4;
          this.pos.y = this.groundY(ctx, this.pos.x, this.pos.z);
        }
        // 雷标：隔一阵在玩家脚下画一个圈，1.2 秒后落雷
        this.mem.rune = (this.mem.rune ?? 3 + Math.random() * 4) - dt;
        if (this.mem.rune <= 0 && dist < 32 && dist > 6) {
          this.mem.rune = 7 + Math.random() * 3;
          const x = P.x, z = P.z;
          ctx.fx.telegraph(x, z, 2.6, 1.2, () => {
            ctx.fx.bolt(x, z);
            if (Math.hypot(ctx.feet.x - x, ctx.feet.z - z) < 2.6) ctx.hurt(15, '天狗的雷标');
          });
        }
        if (dist < 8 && this.cd <= 0) {
          this.act = 'lunge'; this.actT = 0; this.mem.bit = 0;
          const d = Math.max(0.1, dist);
          this.vel.set((P.x - this.pos.x) / d * 15, 0, (P.z - this.pos.z) / d * 15);
          return;
        }
        // 绕着玩家跑：保持 5–7 m，侧向游走
        const side = (this.home.x % 2 > 1 ? 1 : -1);
        const a = Math.atan2(this.pos.x - P.x, this.pos.z - P.z) + side * 0.6;
        const moved = this.steer(ctx, P.x + Math.sin(a) * 6, P.z + Math.cos(a) * 6, this.spec.speed, dt);
        this.anim.move = moved > 0 ? 1 : 0;
        break;
      }
      case 'aoyin': case 'leiyak': {
        if (this.act === 'charge') {
          if (this.actT < 1.0) {
            this.anim.crouch = 0.6; this.anim.attack = this.actT;
            this.faceTo(P.x, P.z, dt, 3);
            return;
          }
          if (this.actT < 2.3) {
            this.anim.move = 1; this.anim.attack = 1;
            const spd = this.kind === 'aoyin' ? 20 : 17;
            const ok = this.dash(ctx, Math.sin(this.yaw) * spd, Math.cos(this.yaw) * spd, dt);
            this.pos.y = this.groundY(ctx, this.pos.x, this.pos.z);
            if (!this.mem.hit && Math.hypot(P.x - this.pos.x, P.z - this.pos.z) < 2.4 * this.spec.scale + 0.5) {
              this.mem.hit = 1;
              ctx.hurt(this.kind === 'aoyin' ? 24 : 16, this.label, { x: Math.sin(this.yaw) * 14, z: Math.cos(this.yaw) * 14, up: 6 });
            }
            if (ok) return;
          }
          this.act = ''; this.cd = this.kind === 'aoyin' ? 2.5 : 3;
        }
        if (this.act === 'stomp') {
          this.anim.attack = Math.min(1, this.actT / 0.6);
          if (this.actT >= 0.6) {
            this.act = ''; this.cd = 1.6;
            const x = this.pos.x, z = this.pos.z;
            ctx.fx.shockwave(x, z, 5.5, 0.45);
            if (dist < 5.5 && ctx.walker.grounded) ctx.hurt(14, this.label, { x: (P.x - x) / Math.max(1, dist) * 8, z: (P.z - z) / Math.max(1, dist) * 8, up: 4 });
          }
          return;
        }
        if (this.cd <= 0 && dist < 4.5 * this.spec.scale && this.kind === 'aoyin') { this.act = 'stomp'; this.actT = 0; return; }
        if (this.cd <= 0 && dist > 7 && dist < 32) {
          this.act = 'charge'; this.actT = 0; this.mem.hit = 0;
          ctx.fx.telegraph(this.pos.x + Math.sin(this.yaw) * 4, this.pos.z + Math.cos(this.yaw) * 4, 1.8, 0.9, () => {}, '#ffb347');
          return;
        }
        const moved = this.steer(ctx, P.x, P.z, this.spec.speed, dt, 3);
        this.anim.move = moved > 0 ? 0.7 : 0;
        break;
      }
      case 'jufu': {
        this.faceTo(P.x, P.z, dt, 4);
        if (this.act === 'throw') {
          this.anim.attack = Math.min(1, this.actT / 0.8);
          if (this.actT >= 0.8) {
            this.act = ''; this.cd = 3.2;
            const from = _v.copy(this.pos).setY(this.pos.y + 2.3);
            // 往玩家正在去的方向扔
            const lead = Math.min(1.2, dist / 22 + 0.4);
            const tx = P.x + (this.mem.pvx ?? 0) * lead, tz = P.z + (this.mem.pvz ?? 0) * lead;
            const to = new THREE.Vector3(tx, ctx.fx.ground(tx, tz), tz);
            ctx.fx.lob(from.clone(), to, lead, boulderMesh(0.55), 3.2, (at) => {
              ctx.fx.burst(at, 3, '#ffb37a');
              if (at.distanceTo(ctx.feet) < 3.2) ctx.hurt(18, '举父的雷石', { x: (ctx.feet.x - at.x) * 2, z: (ctx.feet.z - at.z) * 2, up: 3 });
            });
          }
          return;
        }
        if (dist < 4 && this.cd <= 0) {
          this.cd = 1.4; this.anim.attack = 1;
          ctx.hurt(12, '举父', { x: (P.x - this.pos.x) * 3, z: (P.z - this.pos.z) * 3 });
          return;
        }
        if (this.cd <= 0 && dist < 60 && this.sees(ctx)) { this.act = 'throw'; this.actT = 0; }
        break;
      }
      case 'manman': {
        // 绕着玩家盘旋，隔一阵射一发电弹
        this.anim.flap = 1;
        const a = ctx.time * 0.7 + this.home.x * 0.3;
        const R = 13 + 3 * Math.sin(ctx.time * 0.4 + this.home.z);
        const tx = P.x + Math.cos(a) * R, tz = P.z + Math.sin(a) * R;
        this.steer(ctx, tx, tz, this.spec.speed, dt);
        const ty = ctx.terrain.heightAt(this.pos.x, this.pos.z) + 7 + 2 * Math.sin(ctx.time + this.home.x);
        this.pos.y += (ty - this.pos.y) * Math.min(1, dt * 2);
        this.anim.move = 1;
        if (this.cd <= 0 && dist < 40 && this.sees(ctx)) {
          this.cd = 2.2; this.anim.jaw = 1;
          const from = _v.copy(this.pos).setY(this.pos.y + 0.5);
          const dir = _w.copy(ctx.center).sub(from).normalize().multiplyScalar(24);
          ctx.fx.shot(from.clone(), dir.clone(), 0.35, '#ff7ae6', (at, hitP) => {
            if (hitP) ctx.hurt(7, '蛮蛮');
            else ctx.fx.burst(at, 1, '#ff7ae6');
          });
        }
        break;
      }
      case 'liangu': {
        // 躲在同伴后面，给 14 m 内的同伴上护盾；玩家贴脸就震开
        const mates = this.enc?.foes.filter(f => f !== this && f.alive) ?? [];
        let cx = this.home.x, cz = this.home.z;
        if (!mates.length) {
          // 同伴都倒了：自己出来，保持 12 m 用雷心弹打人
          const d = Math.max(1, dist);
          cx = P.x + (this.pos.x - P.x) / d * 12; cz = P.z + (this.pos.z - P.z) / d * 12;
          this.mem.orb = (this.mem.orb ?? 1.5) - dt;
          if (this.mem.orb <= 0 && dist < 35) {
            this.mem.orb = 1.8;
            const from = _v.copy(this.pos).setY(this.pos.y + 0.45);
            ctx.fx.shot(from.clone(), _w.copy(ctx.center).sub(from).normalize().multiplyScalar(16), 0.4, '#c792ff', (at, hitP) => {
              if (hitP) ctx.hurt(8, '连鼓灵'); else ctx.fx.burst(at, 1.2, '#c792ff');
            });
          }
        } else {
          cx = mates.reduce((s, f) => s + f.pos.x, 0) / mates.length;
          cz = mates.reduce((s, f) => s + f.pos.z, 0) / mates.length;
          const d = Math.hypot(cx - P.x, cz - P.z) || 1;
          cx += (cx - P.x) / d * 8; cz += (cz - P.z) / d * 8;
        }
        this.steer(ctx, cx, cz, this.spec.speed, dt, 1);
        this.pos.y = ctx.terrain.heightAt(this.pos.x, this.pos.z) + 3 + 0.3 * Math.sin(ctx.time * 2);
        this.mem.buff = (this.mem.buff ?? 0) - dt;
        if (this.mem.buff <= 0) {
          this.mem.buff = 1;
          for (const f of mates) if (f.pos.distanceTo(this.pos) < 14) f.shield = 1.6;
        }
        if (this.act === 'pulse') {
          if (this.actT >= 0.5) {
            this.act = ''; this.cd = 3;
            ctx.fx.shockwave(this.pos.x, this.pos.z, 7, 0.4, undefined, '#c792ff');
            if (dist < 7) ctx.hurt(10, '连鼓灵', { x: (P.x - this.pos.x) * 2, z: (P.z - this.pos.z) * 2, up: 3 });
          }
        } else if (dist < 7 && this.cd <= 0) { this.act = 'pulse'; this.actT = 0; }
        break;
      }
      case 'dijiang': {
        if (this.act === 'swell') {
          const k = Math.min(1, this.actT / 0.8);
          this.body?.pose.scale('body', 1 + 0.5 * k);
          this.flash = 0.5 + 0.5 * Math.sin(this.actT * 30);
          if (this.actT >= 0.8) {
            ctx.fx.burst(_v.copy(this.pos).setY(this.pos.y + 0.6), 4.5, '#ff7ad8');
            ctx.fx.shockwave(this.pos.x, this.pos.z, 4.5, 0.3);
            if (dist < 4.5) ctx.hurt(22, '帝江', { x: (P.x - this.pos.x) * 3, z: (P.z - this.pos.z) * 3, up: 5 });
            this.die();
          }
          return;
        }
        const moved = this.steer(ctx, P.x, P.z, this.spec.speed, dt, 1);
        this.anim.move = moved > 0 ? 1 : 0;
        this.pos.y = this.groundY(ctx, this.pos.x, this.pos.z) + Math.abs(Math.sin(ctx.time * 7 + this.home.x)) * 0.6;
        this.anim.flap = 1;
        if (dist < 3.2) { this.act = 'swell'; this.actT = 0; }
        break;
      }
      default: break;
    }
  }

  /** 记下玩家速度（举父往前扔用）：由游戏主循环每帧给 */
  notePlayerVel(vx: number, vz: number): void { this.mem.pvx = vx; this.mem.pvz = vz; }
}

/** 穷奇：全图游猎的精英。平时沿巡视路线走；发现就扑；血少飞回巢穴回血一次 */
export class Roamer extends Foe {
  private leg = 0;
  private fled = false;

  constructor(scene: THREE.Scene, at: THREE.Vector3, names: Record<MonsterKind, string>, private readonly path: [number, number][], private readonly lair: [number, number]) {
    super('qiongqi', scene, at, 0, names);
  }

  protected override idle(dt: number, ctx: PlayCtx, dist: number): void {
    const [tx, tz] = this.path[this.leg];
    const moved = this.steer(ctx, tx, tz, this.spec.speed, dt);
    this.anim.move = moved > 0 ? 0.5 : 0;
    if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < 3 || moved === 0) this.leg = (this.leg + 1) % this.path.length;
    this.anim.flap = 0;
    this.hp = Math.min(this.maxHp, this.hp + dt * 10);
    if (dist < this.spec.sight && ctx.player.alive && this.sees(ctx)) { this.state = 'alert'; ctx.say('穷奇盯上你了'); }
  }

  protected override fight(dt: number, ctx: PlayCtx, dist: number): void {
    const P = ctx.feet;
    this.actT += dt;
    this.anim.attack = Math.max(0, this.anim.attack - dt * 3);
    this.anim.jaw = Math.max(0, this.anim.jaw - dt * 3);
    this.anim.crouch = Math.max(0, this.anim.crouch - dt * 4);
    if (!this.fled && this.hp < this.maxHp * 0.3) { this.fled = true; this.act = 'flee'; this.actT = 0; ctx.say('穷奇受伤，飞回巢穴了'); }
    if (this.act === 'flee') {
      this.anim.flap = 1; this.anim.move = 1;
      this.hover = 6;
      this.steer(ctx, this.lair[0], this.lair[1], 13, dt);
      this.pos.y += (ctx.terrain.heightAt(this.pos.x, this.pos.z) + 8 - this.pos.y) * Math.min(1, dt * 2);
      if (Math.hypot(this.lair[0] - this.pos.x, this.lair[1] - this.pos.z) < 4) {
        this.hover = 0; this.pos.y = this.groundY(ctx, this.pos.x, this.pos.z);
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.08 * dt);
        this.anim.flap = 0; this.anim.move = 0;
        if (this.hp > this.maxHp * 0.6 || dist < 18) { this.act = ''; }
      }
      return;
    }
    if (this.act === 'pounce') {
      if (this.actT < 0.5) { this.anim.crouch = 1; this.faceTo(P.x, P.z, dt, 10); return; }
      const k = (this.actT - 0.5) / 0.7;
      if (k < 1) {
        this.anim.flap = 1; this.anim.attack = 1; this.anim.jaw = 1;
        this.pos.x = this.mem.ax + (this.mem.bx - this.mem.ax) * k;
        this.pos.z = this.mem.az + (this.mem.bz - this.mem.az) * k;
        this.pos.y = this.groundY(ctx, this.pos.x, this.pos.z) + Math.sin(k * Math.PI) * 4;
        return;
      }
      this.act = ''; this.cd = 2.2; this.anim.flap = 0;
      this.pos.y = this.groundY(ctx, this.pos.x, this.pos.z);
      ctx.fx.shockwave(this.pos.x, this.pos.z, 3, 0.3);
      if (Math.hypot(P.x - this.pos.x, P.z - this.pos.z) < 3) ctx.hurt(18, '穷奇', { x: Math.sin(this.yaw) * 10, z: Math.cos(this.yaw) * 10, up: 4 });
      return;
    }
    if (dist < 3 && this.cd <= 0) {
      this.cd = 1.2; this.anim.attack = 1; this.anim.jaw = 1;
      ctx.hurt(12, '穷奇');
      return;
    }
    if (dist > 6 && dist < 20 && this.cd <= 0 && this.canStand(ctx, P.x, P.z)) {
      this.act = 'pounce'; this.actT = 0;
      this.mem.ax = this.pos.x; this.mem.az = this.pos.z; this.mem.bx = P.x; this.mem.bz = P.z;
      ctx.fx.telegraph(P.x, P.z, 3, 1.1, () => {}, '#ffb347');
      return;
    }
    if (dist > 70) { this.state = 'idle'; return; }
    const moved = this.steer(ctx, P.x, P.z, 8, dt, 2.5);
    this.anim.move = moved > 0 ? 1 : 0;
  }
}

// ─────────────── 连鼓灵：骨笼雷心 + 六面鼓 + 骨槌（部件拼装，程序化绕转） ───────────────

function buildLiangu(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'liangu';
  const core = spawnStatic('SM_EnemyPart_LianguCore');
  core.name = 'core';
  g.add(core);
  const ring = new THREE.Group();
  ring.name = 'ring';
  for (let k = 0; k < 6; k++) {
    const d = spawnStatic('SM_EnemyPart_LianguDrum');
    const a = (k / 6) * Math.PI * 2;
    d.position.set(Math.cos(a) * 1.15, 0.2, Math.sin(a) * 1.15);
    d.rotation.set(Math.PI / 2, 0, a);
    if (k === 0) d.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.material = (m.material as THREE.MeshStandardMaterial).clone(); (m.material as THREE.MeshStandardMaterial).color.set('#ff9a8a'); }
    });
    ring.add(d);
  }
  const ringBand = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.05, 6, 48).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8a6a3a', metalness: 0.6, roughness: 0.45 }));
  ringBand.position.y = 0.45;
  ring.add(ringBand);
  g.add(ring);
  const mallet = spawnStatic('SM_EnemyPart_LianguMallet');
  mallet.name = 'mallet';
  mallet.position.set(0.9, -0.6, 0);
  g.add(mallet);
  const glow = glowOrb(0.3);
  glow.position.y = 0.45;
  g.add(glow);
  return g;
}

function animateLiangu(g: THREE.Group, t: number, pulse: number): void {
  const ring = g.getObjectByName('ring');
  if (ring) { ring.rotation.y = t * 1.4; ring.scale.setScalar(1 + 0.25 * pulse); }
  const mallet = g.getObjectByName('mallet');
  if (mallet) mallet.rotation.z = Math.sin(t * 6) * 0.5;
}

function glowOrb(r: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: MAGENTA, transparent: true, opacity: 0.9 }));
  m.renderOrder = 3;
  return m;
}
