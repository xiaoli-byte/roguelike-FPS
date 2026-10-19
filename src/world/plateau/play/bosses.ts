/**
 * 4-1 的三场领主战（设计见 docs/art/enemy-roster-v2.md「领主分配」「夔 · 移动」，规则见 chuanzang-v1.md 2.6）。
 * - 夔（⑥ 经幡山头）：走近残破雷鼓就压来雷暴、夔从鼓里站起来。一足蹦着追人，大跳落地掀冲击波（跳起来躲），血少了捶胸引雷。
 * - 飞廉（⑤ 冰川口冰舌顶上）：持续的风把人往外推，蓄力狂风、低头冲锋，血少了放龙卷风柱追人。
 * - 化蛇（④ 圣湖海子）：在湖里游，浮起来吐水弹、扑咬岸边的人；隔一阵张嘴吼叫（弱点全开）让湖水上涨，泡在水里掉血。
 * 打败领主：那个据点的灵火直接点亮，伤害 +20%、血上限 +25。玩家倒下或跑出擂台太远：领主回满血、战斗重置。
 */
import * as THREE from 'three';
import type { NativeBody } from '../../../assets/NativeRig';
import { LAKES, LORDS, type Lord } from '../spec';
import { CreatureAnimator, newAnimState, type AnimState } from './anim';
import { spawnCreature, spawnStatic } from './assets';
import type { HitSphere, PlayCtx, Target } from './core';

const MAGENTA = '#ff4fd8';
const _v = new THREE.Vector3();

interface SphereSpec { bone: string; r: number; mult: number }

export abstract class Boss implements Target {
  readonly host: THREE.Group;
  readonly body: NativeBody;
  readonly anim: AnimState = newAnimState();
  readonly animator: CreatureAnimator;
  readonly pos = new THREE.Vector3();
  readonly home = new THREE.Vector3();
  yaw = 0;
  hp: number;
  active = false;
  defeated = false;
  /** 领主奖励已发（只发一次） */
  rewarded = false;
  /** 擂台中心与半径 */
  readonly arena: THREE.Vector2;
  readonly arenaR: number;
  protected act = '';
  protected actT = 0;
  protected cd = 2;
  protected readonly mem: Record<string, number> = {};
  protected flash = 0;
  protected deadT = 0;
  private readonly hitList: HitSphere[];

  constructor(readonly lord: Lord, readonly label: string, readonly maxHp: number, model: 'SK_Boss_Kui' | 'SK_Boss_Feilian' | 'SK_Boss_Huashe',
    gait: 'kui' | 'quad' | 'serpent', private readonly sphereSpec: SphereSpec[], protected readonly scene: THREE.Scene) {
    const c = spawnCreature(model);
    this.host = c.host;
    this.body = c.body;
    this.animator = new CreatureAnimator(c.body.pose, gait);
    this.hp = maxHp;
    this.arena = new THREE.Vector2(lord.at[0], lord.at[2]);
    this.arenaR = lord.r;
    this.hitList = sphereSpec.map(s => ({ c: new THREE.Vector3(), r: s.r, mult: s.mult }));
    scene.add(this.host);
  }

  get alive(): boolean { return !this.defeated; }

  /** 当前阶段：1 → 2（血 < 66%）→ 3（血 < 33%） */
  get phase(): number { return this.hp < this.maxHp * 0.33 ? 3 : this.hp < this.maxHp * 0.66 ? 2 : 1; }

  spheres(): readonly HitSphere[] {
    if (!this.host.visible) return [];
    this.sphereSpec.forEach((s, i) => {
      const b = this.body.pose.bone(s.bone);
      if (b) b.getWorldPosition(this.hitList[i].c);
      this.hitList[i].mult = this.weakMult(s);
    });
    return this.hitList;
  }

  protected weakMult(s: SphereSpec): number { return s.mult; }

  hit(dmg: number, mult: number, _at: THREE.Vector3): number {
    if (this.defeated || !this.host.visible) return 0;
    const d = dmg * mult;
    this.hp -= d;
    this.flash = 1;
    this.anim.hurt = Math.min(1, this.anim.hurt + 0.3);
    if (this.hp <= 0) { this.hp = 0; this.defeated = true; this.deadT = 0; }
    return d;
  }

  /** 玩家进了擂台：开打 */
  abstract shouldStart(ctx: PlayCtx): boolean;
  start(ctx: PlayCtx): void { this.active = true; this.cd = 1.5; this.act = ''; this.onStart(ctx); }
  protected abstract onStart(ctx: PlayCtx): void;
  /** 战斗重置：回满血、回原位 */
  reset(ctx: PlayCtx): void {
    if (this.defeated) return;
    this.active = false;
    this.hp = this.maxHp;
    this.act = ''; this.actT = 0;
    this.pos.copy(this.home);
    this.onReset(ctx);
  }
  protected onReset(_ctx: PlayCtx): void {}
  protected abstract think(dt: number, ctx: PlayCtx, dist: number): void;
  protected idle(_dt: number, _ctx: PlayCtx): void {}

  update(dt: number, ctx: PlayCtx): void {
    if (this.defeated) {
      this.deadT += dt;
      this.anim.dead = Math.min(1, this.deadT);
      this.anim.move = 0;
      if (this.deadT > 2.5) this.pos.y -= dt * 1.2;
      if (this.deadT > 6) this.host.visible = false;
    } else if (this.active) {
      this.actT += dt;
      this.cd -= dt;
      const dist = Math.hypot(ctx.feet.x - this.pos.x, ctx.feet.z - this.pos.z);
      this.think(dt, ctx, dist);
    } else {
      this.idle(dt, ctx);
    }
    this.anim.hurt = Math.max(0, this.anim.hurt - dt * 3);
    this.flash = Math.max(0, this.flash - dt * 6);
    this.host.position.copy(this.pos);
    this.host.rotation.y = this.yaw;
    const look = Math.atan2(ctx.feet.x - this.pos.x, ctx.feet.z - this.pos.z) - this.yaw;
    this.anim.look = this.active ? Math.atan2(Math.sin(look), Math.cos(look)) : 0;
    this.animator.apply(this.anim, ctx.time);
    (this.body.materials[0] as THREE.MeshStandardMaterial).emissive.setRGB(this.flash * 0.7, this.flash * 0.7, this.flash * 0.7);
    this.host.updateMatrixWorld(true);
    this.after(dt, ctx);
  }

  protected after(_dt: number, _ctx: PlayCtx): void {}

  protected faceTo(x: number, z: number, dt: number, rate: number): void {
    let d = Math.atan2(x - this.pos.x, z - this.pos.z) - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
  }

  protected ground(ctx: PlayCtx, x: number, z: number): number { return ctx.terrain.heightAt(x, z); }
}

// ───────────────────────────── 夔 ─────────────────────────────

export class KuiBoss extends Boss {
  private readonly drum: THREE.Group;
  private rise = 0;

  constructor(scene: THREE.Scene, ctx: PlayCtx) {
    const lord = LORDS.find(l => l.id === 'kui')!;
    super(lord, '夔', 8000, 'SK_Boss_Kui', 'kui', [
      { bone: 'chest', r: 1.5, mult: 1 }, { bone: 'hips', r: 1.0, mult: 1 }, { bone: 'head', r: 0.7, mult: 1.5 },
      { bone: 'drum_core', r: 0.6, mult: 2.5 }, { bone: 'shin', r: 0.5, mult: 1 },
    ], scene);
    const [px, pz] = lord.perch!;
    this.home.set(px, ctx.terrain.heightAt(px, pz), pz);
    this.pos.copy(this.home);
    this.yaw = Math.atan2(lord.at[0] - px, lord.at[2] - pz);
    this.host.visible = false;
    // 夔不在时，山头倒着它的残破雷鼓
    this.drum = spawnStatic('SM_Prop_KuiBrokenDrum', 1.3);
    this.drum.position.copy(this.home).setY(this.home.y + 0.6);
    this.drum.rotation.set(-1.25, this.yaw, 0);
    scene.add(this.drum);
  }

  shouldStart(ctx: PlayCtx): boolean { return Math.hypot(ctx.feet.x - this.home.x, ctx.feet.z - this.home.z) < 22; }

  protected onStart(ctx: PlayCtx): void {
    ctx.weather.stormy = true;
    this.rise = 0;
    this.act = 'rise'; this.actT = 0;
    ctx.say('雷暴压下来——夔从残鼓里站起来了！打它胸口的鼓心', 4);
  }

  protected override onReset(ctx: PlayCtx): void {
    ctx.weather.stormy = false;
    this.host.visible = false;
    this.drum.visible = true;
    this.host.scale.setScalar(1);
  }

  protected override weakMult(s: SphereSpec): number { return s.mult; }

  protected think(dt: number, ctx: PlayCtx, dist: number): void {
    const P = ctx.feet;
    this.anim.attack = Math.max(0, this.anim.attack - dt * 2);
    if (this.act === 'rise') {
      this.rise = Math.min(1, this.actT / 2.2);
      this.host.visible = true;
      this.host.scale.setScalar(0.25 + 0.75 * this.rise);
      this.drum.visible = this.rise < 0.6;
      this.anim.crouch = 1 - this.rise;
      if (this.actT > 0.2 && !this.mem.flashed) { this.mem.flashed = 1; ctx.fx.bolt(this.pos.x, this.pos.z); }
      if (this.rise >= 1) { this.act = ''; this.cd = 1; this.mem.hops = 0; }
      return;
    }
    this.faceTo(P.x, P.z, dt, 3);
    // 一足蹦跳：蓄力（蹲）→ 腾空（位移全在空中）→ 落地（缓冲）
    if (this.act === 'hop' || this.act === 'leap') {
      const big = this.act === 'leap';
      const tc = big ? 0.75 : 0.3, ta = big ? 1.05 : 0.55, tl = big ? 0.5 : 0.25;
      const t = this.actT;
      if (t < tc) { this.anim.crouch = t / tc * (big ? 1 : 0.6); return; }
      if (t < tc + ta) {
        const k = (t - tc) / ta;
        this.anim.crouch = 0;
        this.pos.x = this.mem.ax + (this.mem.bx - this.mem.ax) * k;
        this.pos.z = this.mem.az + (this.mem.bz - this.mem.az) * k;
        this.pos.y = this.ground(ctx, this.pos.x, this.pos.z) + (big ? 4.2 : 1.4) * 4 * k * (1 - k);
        return;
      }
      if (!this.mem.landed) {
        this.mem.landed = 1;
        this.pos.y = this.ground(ctx, this.pos.x, this.pos.z);
        const x = this.pos.x, z = this.pos.z;
        if (big) {
          // 冲击波环往外扫：环经过时人在地上就挨打（跳起来能躲过去）
          let done = false;
          ctx.fx.shockwave(x, z, 15, 0.9, (r) => {
            const d = Math.hypot(ctx.feet.x - x, ctx.feet.z - z);
            if (!done && Math.abs(d - r) < 1.3 && ctx.walker.grounded) {
              done = true;
              ctx.hurt(24, '夔的落地冲击', { x: (ctx.feet.x - x) / Math.max(1, d) * 10, z: (ctx.feet.z - z) / Math.max(1, d) * 10, up: 7 });
            }
          });
          ctx.fx.burst(_v.set(x, this.pos.y + 1, z), 5, '#ffc6f4');
        } else {
          ctx.fx.shockwave(x, z, 3.5, 0.35);
          if (Math.hypot(P.x - x, P.z - z) < 3.5 && ctx.walker.grounded) ctx.hurt(8, '夔', { x: (P.x - x) * 2, z: (P.z - z) * 2, up: 4 });
        }
      }
      if (t < tc + ta + tl) { this.anim.crouch = Math.sin((t - tc - ta) / tl * Math.PI) * (big ? 1 : 0.5); return; }
      this.act = ''; this.cd = this.phase === 3 ? 0.15 : 0.4;
      return;
    }
    if (this.act === 'drum') {
      // 捶胸引雷：每捶一下在玩家附近落几道雷
      this.anim.attack = 1;
      const beats = this.phase === 3 ? 5 : 3;
      const n = Math.floor(this.actT / 0.6);
      if (n > (this.mem.beat ?? -1) && n < beats) {
        this.mem.beat = n;
        for (let k = 0; k < 2; k++) {
          const a = Math.random() * Math.PI * 2, r = k === 0 ? 0 : 3 + Math.random() * 5;
          const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
          ctx.fx.telegraph(x, z, 3.2, 1.2, () => {
            ctx.fx.bolt(x, z);
            if (Math.hypot(ctx.feet.x - x, ctx.feet.z - z) < 3.2) ctx.hurt(18, '夔引来的雷');
          });
        }
      }
      if (this.actT > beats * 0.6 + 0.4) { this.act = ''; this.cd = 0.6; this.mem.beat = -1; }
      return;
    }
    if (this.cd > 0) return;
    // 选下一招：一般蹦 3 下追人，然后大跳；二阶段起插入捶胸引雷
    const hops = this.mem.hops ?? 0;
    if (this.phase >= 2 && hops > 0 && hops % 5 === 0 && this.mem.lastDrum !== hops) {
      this.act = 'drum'; this.actT = 0; this.mem.lastDrum = hops; this.mem.beat = -1;
      ctx.say('夔在捶胸——快离开脚下的紫圈', 2);
      return;
    }
    // 每第 4 下是大跳：直接砸向玩家脚下（落点提前出圈，跑开或者在冲击波到的时候跳起来）
    const big = hops % 4 === 3;
    const reach = big ? Math.min(dist, 14) : Math.min(Math.max(0, dist - 3), 3.5);
    const dx = (P.x - this.pos.x) / Math.max(0.1, dist), dz = (P.z - this.pos.z) / Math.max(0.1, dist);
    let bx = this.pos.x + dx * reach, bz = this.pos.z + dz * reach;
    // 不跳出擂台
    const ox = bx - this.arena.x, oz = bz - this.arena.y, od = Math.hypot(ox, oz);
    if (od > this.arenaR) { bx = this.arena.x + ox / od * this.arenaR; bz = this.arena.y + oz / od * this.arenaR; }
    this.act = big ? 'leap' : 'hop'; this.actT = 0; this.mem.landed = 0;
    this.mem.ax = this.pos.x; this.mem.az = this.pos.z; this.mem.bx = bx; this.mem.bz = bz;
    this.mem.hops = hops + 1;
    if (big) ctx.fx.telegraph(bx, bz, 4, 1.7, () => {}, '#ffb347');
  }
}

// ───────────────────────────── 飞廉 ─────────────────────────────

interface Tornado { mesh: THREE.Group; pos: THREE.Vector3; life: number; tick: number }

export class FeilianBoss extends Boss {
  private readonly orb: THREE.Mesh;
  private tornados: Tornado[] = [];

  constructor(scene: THREE.Scene, ctx: PlayCtx) {
    const lord = LORDS.find(l => l.id === 'feilian')!;
    super(lord, '飞廉', 7000, 'SK_Boss_Feilian', 'quad', [
      { bone: 'chest', r: 1.0, mult: 1 }, { bone: 'hips', r: 0.9, mult: 1 }, { bone: 'neck', r: 0.5, mult: 1 },
      { bone: 'head', r: 0.45, mult: 1.5 }, { bone: 'orb', r: 0.55, mult: 2.5 },
    ], scene);
    this.home.set(lord.at[0], ctx.terrain.heightAt(lord.at[0], lord.at[2]), lord.at[2]);
    this.pos.copy(this.home);
    this.yaw = Math.atan2(40 - lord.at[0], -150 - lord.at[2]);
    // 鹿角间的风雷珠：程序化发光球，挂在 orb 骨上
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12), new THREE.MeshBasicMaterial({ color: '#d9c4ff', transparent: true, opacity: 0.95 }));
    scene.add(this.orb);
  }

  shouldStart(ctx: PlayCtx): boolean { return Math.hypot(ctx.feet.x - this.home.x, ctx.feet.z - this.home.z) < 32; }

  protected onStart(ctx: PlayCtx): void {
    ctx.say('风神飞廉——狂风刮起来了！打鹿角间的风雷珠', 4);
  }

  protected override onReset(): void {
    for (const t of this.tornados) this.scene.remove(t.mesh);
    this.tornados = [];
  }

  protected override idle(dt: number, ctx: PlayCtx): void {
    this.anim.move = 0;
    this.faceTo(ctx.feet.x, ctx.feet.z, dt, 0.5);
  }

  protected think(dt: number, ctx: PlayCtx, dist: number): void {
    const P = ctx.feet;
    this.anim.attack = Math.max(0, this.anim.attack - dt * 2);
    this.anim.crouch = Math.max(0, this.anim.crouch - dt * 3);
    // 擂台里一直有风把人往外推
    if (dist < 42) {
      const k = 1.4 * dt / Math.max(1, dist);
      ctx.walker.shove((P.x - this.pos.x) * k, (P.z - this.pos.z) * k);
    }
    if (this.act === 'gust') {
      this.anim.attack = Math.min(1, this.actT);
      this.faceTo(P.x, P.z, dt, 4);
      if (this.actT >= 1 && this.actT < 1.6) {
        const k = 9 * dt / Math.max(1, dist);
        ctx.walker.shove((P.x - this.pos.x) * k, (P.z - this.pos.z) * k);
        if (!this.mem.gusted && dist < 40) { this.mem.gusted = 1; ctx.hurt(6, '飞廉的狂风'); }
      }
      if (this.actT >= 1.7) { this.act = ''; this.cd = 1.2; }
      return;
    }
    if (this.act === 'charge') {
      if (this.actT < 0.8) { this.anim.crouch = 0.6; this.anim.attack = 0.8; this.faceTo(P.x, P.z, dt, 5); return; }
      if (this.actT < 2) {
        this.anim.move = 1; this.anim.attack = 1;
        const nx = this.pos.x + Math.sin(this.yaw) * 24 * dt, nz = this.pos.z + Math.cos(this.yaw) * 24 * dt;
        if (this.onTop(ctx, nx, nz)) {
          this.pos.x = nx; this.pos.z = nz; this.pos.y = this.ground(ctx, nx, nz);
          this.anim.phase += 24 * dt / 1.6 * Math.PI;
          if (!this.mem.hit && Math.hypot(P.x - nx, P.z - nz) < 2.8) {
            this.mem.hit = 1;
            ctx.hurt(22, '飞廉冲锋', { x: Math.sin(this.yaw) * 16, z: Math.cos(this.yaw) * 16, up: 5 });
          }
          return;
        }
      }
      this.act = ''; this.cd = 1.4; this.anim.move = 0;
      return;
    }
    // 没在出招：小跑回到离玩家 12–18 m 的地方
    const want = 15;
    if (Math.abs(dist - want) > 3) {
      const dir = dist > want ? 1 : -1;
      const step = 7 * dt * dir;
      const nx = this.pos.x + (P.x - this.pos.x) / Math.max(1, dist) * step, nz = this.pos.z + (P.z - this.pos.z) / Math.max(1, dist) * step;
      if (this.onTop(ctx, nx, nz)) {
        this.pos.x = nx; this.pos.z = nz; this.pos.y = this.ground(ctx, nx, nz);
        this.anim.move = 0.6; this.anim.phase += Math.abs(step) / 1.6 * Math.PI;
      }
    } else this.anim.move = 0;
    this.faceTo(P.x, P.z, dt, 3);
    if (this.cd > 0) return;
    const n = (this.mem.n = (this.mem.n ?? 0) + 1);
    if (this.phase >= 2 && n % 3 === 0) {
      // 龙卷风柱
      const count = this.phase === 3 ? 3 : 2;
      for (let k = 0; k < count; k++) {
        const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 6;
        this.spawnTornado(ctx, P.x + Math.cos(a) * r, P.z + Math.sin(a) * r);
      }
      ctx.say('龙卷风柱——别被卷进去', 2);
      this.cd = 2;
      return;
    }
    if (n % 2 === 0) { this.act = 'gust'; this.actT = 0; this.mem.gusted = 0; ctx.say('飞廉在蓄风……', 1.2); return; }
    this.act = 'charge'; this.actT = 0; this.mem.hit = 0;
  }

  /** 只在冰舌顶上活动：不出擂台、不下冰崖（地面不低于起点 4 m 以上）、不上陡坡 */
  private onTop(ctx: PlayCtx, x: number, z: number): boolean {
    return Math.hypot(x - this.arena.x, z - this.arena.y) < this.arenaR && ctx.terrain.slopeAt(x, z) < 1.2 && ctx.terrain.heightAt(x, z) > this.home.y - 4;
  }

  private spawnTornado(ctx: PlayCtx, x: number, z: number): void {
    const g = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const cone = new THREE.Mesh(new THREE.TorusGeometry(0.6 + k * 0.45, 0.12, 4, 24, 4.5).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({
        color: '#e8e6ff', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
      }));
      cone.position.y = 0.5 + k * 1.6;
      g.add(cone);
    }
    g.position.set(x, ctx.terrain.heightAt(x, z), z);
    this.scene.add(g);
    this.tornados.push({ mesh: g, pos: g.position, life: 8, tick: 0 });
  }

  protected override after(dt: number, ctx: PlayCtx): void {
    this.body.pose.bone('orb')?.getWorldPosition(this.orb.position);
    this.orb.visible = !this.defeated;
    this.orb.scale.setScalar(1 + 0.15 * Math.sin(ctx.time * 7));
    this.tornados = this.tornados.filter(T => {
      T.life -= dt;
      const dx = ctx.feet.x - T.pos.x, dz = ctx.feet.z - T.pos.z, d = Math.hypot(dx, dz) || 1;
      T.pos.x += dx / d * 3.5 * dt; T.pos.z += dz / d * 3.5 * dt;
      T.pos.y = ctx.terrain.heightAt(T.pos.x, T.pos.z);
      T.mesh.children.forEach((c, k) => { c.rotation.y = ctx.time * (3 + k) * (k % 2 ? -1 : 1); });
      T.tick -= dt;
      if (d < 2.4 && T.tick <= 0) {
        T.tick = 0.5;
        ctx.hurt(6, '龙卷风柱', { x: -dz / d * 4, z: dx / d * 4, up: 3 });
      }
      if (T.life > 0 && this.active && !this.defeated) return true;
      this.scene.remove(T.mesh);
      return false;
    });
  }
}

// ───────────────────────────── 化蛇 ─────────────────────────────

export class HuasheBoss extends Boss {
  private readonly lake = LAKES.find(l => l.id === 'holy')!;
  private swimA = 0;
  private flood = 0;
  private readonly lakeMesh: THREE.Object3D | null;
  private readonly baseLevel: number;

  constructor(scene: THREE.Scene, ctx: PlayCtx) {
    const lord = LORDS.find(l => l.id === 'huashe')!;
    super(lord, '化蛇', 7500, 'SK_Boss_Huashe', 'serpent', [
      { bone: 'head', r: 0.7, mult: 2 }, { bone: 'chest', r: 1.1, mult: 1 }, { bone: 'spine2', r: 1.0, mult: 1 },
      { bone: 'hips', r: 0.9, mult: 1 }, { bone: 'tail_3', r: 0.6, mult: 1 },
    ], scene);
    this.baseLevel = ctx.terrain.waterLevelAt(this.lake.x, this.lake.z);
    this.lakeMesh = scene.getObjectByName('lake.holy') ?? null;
    this.swimPos(ctx, 0);
    this.home.copy(this.pos);
  }

  /** 湖心岛占着中间：沿椭圆的 0.62 倍游一圈 */
  private swimPos(ctx: PlayCtx, a: number): void {
    const L = this.lake, c = Math.cos(L.rot), s = Math.sin(L.rot);
    const ex = Math.cos(a) * L.rx * 0.62, ez = Math.sin(a) * L.rz * 0.62;
    this.pos.set(L.x + ex * c - ez * s, 0, L.z + ex * s + ez * c);
    this.pos.y = this.baseLevel + this.flood * 1.5 - 0.3;
    const ta = a + 0.05;
    const tx = Math.cos(ta) * L.rx * 0.62, tz = Math.sin(ta) * L.rz * 0.62;
    const nx = L.x + tx * c - tz * s, nz = L.z + tx * s + tz * c;
    this.yaw = Math.atan2(nx - this.pos.x, nz - this.pos.z);
    void ctx;
  }

  shouldStart(ctx: PlayCtx): boolean { return Math.hypot(ctx.feet.x - this.lake.x, ctx.feet.z - this.lake.z) < this.arenaR - 4; }

  protected onStart(ctx: PlayCtx): void {
    ctx.say('湖面翻起浪——化蛇来了！它张嘴吼的时候弱点全开', 4);
  }

  protected override onReset(ctx: PlayCtx): void { this.flood = 0; this.applyFlood(ctx); }

  protected override weakMult(s: SphereSpec): number { return s.bone === 'head' && this.act === 'roar' ? 3 : s.mult; }

  protected override idle(dt: number, ctx: PlayCtx): void {
    this.swimA += dt * 0.12;
    this.swimPos(ctx, this.swimA);
  }

  protected think(dt: number, ctx: PlayCtx, dist: number): void {
    const P = ctx.feet;
    this.anim.jaw = Math.max(0, this.anim.jaw - dt * 2);
    this.anim.attack = Math.max(0, this.anim.attack - dt * 2);
    // 朝玩家那一侧的湖岸游
    const L = this.lake;
    const pa = Math.atan2(((P.z - L.z) * Math.cos(L.rot) - (P.x - L.x) * Math.sin(L.rot)) / L.rz, ((P.x - L.x) * Math.cos(L.rot) + (P.z - L.z) * Math.sin(L.rot)) / L.rx);
    if (this.act === '' || this.act === 'swim') {
      let d = pa - this.swimA;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.swimA += Math.max(-0.35 * dt, Math.min(0.35 * dt, d));
      this.swimPos(ctx, this.swimA);
    }
    if (this.act === 'spit') {
      this.pos.y = this.baseLevel + this.flood * 1.5 - 0.2;
      this.faceTo(P.x, P.z, dt, 3);
      this.anim.jaw = 1;
      const n = Math.floor(this.actT / 0.45);
      if (n > (this.mem.spat ?? -1) && n < 3) {
        this.mem.spat = n;
        const from = this.body.pose.bone('head')?.getWorldPosition(new THREE.Vector3()) ?? this.pos.clone();
        const ox = (Math.random() - 0.5) * 4, oz = (Math.random() - 0.5) * 4;
        const to = new THREE.Vector3(P.x + ox, 0, P.z + oz);
        to.y = ctx.fx.ground(to.x, to.z);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: '#7fe0ff', transparent: true, opacity: 0.85 }));
        ctx.fx.lob(from, to, 1.1, ball, 2.6, (at) => {
          ctx.fx.burst(at, 2.6, '#9fe8ff');
          if (at.distanceTo(ctx.feet) < 2.6) ctx.hurt(12, '化蛇的水弹');
        });
      }
      if (this.actT > 1.6) { this.act = ''; this.cd = 1.5; this.mem.spat = -1; }
      return;
    }
    if (this.act === 'bite') {
      this.faceTo(P.x, P.z, dt, 6);
      this.anim.attack = 1; this.anim.jaw = 1;
      this.pos.y = this.baseLevel + this.flood * 1.5;
      if (this.actT > 0.45 && !this.mem.bit) {
        this.mem.bit = 1;
        const head = this.body.pose.bone('head')?.getWorldPosition(new THREE.Vector3());
        if (head && Math.hypot(P.x - head.x, P.z - head.z) < 4.5) ctx.hurt(20, '化蛇', { x: (P.x - head.x) * 3, z: (P.z - head.z) * 3, up: 4 });
      }
      if (this.actT > 0.9) { this.act = ''; this.cd = 1.2; }
      return;
    }
    if (this.act === 'roar') {
      this.pos.y = this.baseLevel + this.flood * 1.5;
      this.faceTo(P.x, P.z, dt, 2);
      this.anim.jaw = 1;
      this.flood = Math.min(1, this.flood + dt);
      if (this.actT > 2.6) { this.act = ''; this.cd = 1; this.mem.floodT = this.phase === 3 ? 7 : 5; }
      return;
    }
    if (this.cd > 0) return;
    const head = this.body.pose.bone('head')?.getWorldPosition(new THREE.Vector3()) ?? this.pos;
    const near = Math.hypot(P.x - head.x, P.z - head.z);
    const n = (this.mem.n = (this.mem.n ?? 0) + 1);
    if (near < 7) { this.act = 'bite'; this.actT = 0; this.mem.bit = 0; return; }
    if (n % (this.phase === 3 ? 2 : 3) === 0 && this.flood === 0) {
      this.act = 'roar'; this.actT = 0;
      ctx.say('化蛇张嘴吼叫——湖水要涨了，上高处！', 2.5);
      return;
    }
    if (dist < 60) { this.act = 'spit'; this.actT = 0; this.mem.spat = -1; }
  }

  protected override after(dt: number, ctx: PlayCtx): void {
    // 涨水：吼完之后湖面抬高 1.5 m 几秒，泡在水里的人持续掉血
    if (this.act !== 'roar' && this.flood > 0) {
      this.mem.floodT = (this.mem.floodT ?? 0) - dt;
      if (this.mem.floodT <= 0 || !this.active) this.flood = Math.max(0, this.flood - dt * 0.6);
    }
    this.applyFlood(ctx);
    if (this.flood > 0.3 && this.active) {
      const L = this.lake, P = ctx.feet;
      const level = this.baseLevel + this.flood * 1.5;
      const c = Math.cos(L.rot), s = Math.sin(L.rot), dx = P.x - L.x, dz = P.z - L.z;
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      const inside = (lx / (L.rx * 1.35)) ** 2 + (lz / (L.rz * 1.35)) ** 2 < 1;
      this.mem.soak = (this.mem.soak ?? 0) - dt;
      if (inside && P.y < level - 0.1 && this.mem.soak <= 0) { this.mem.soak = 0.5; ctx.hurt(4, '涨起来的湖水'); }
    }
  }

  private applyFlood(_ctx: PlayCtx): void {
    if (!this.lakeMesh) return;
    this.lakeMesh.position.y = this.baseLevel + this.flood * 1.5;
    const k = 1 + 0.15 * this.flood;
    this.lakeMesh.scale.set(k, 1, k);
  }
}

export const LORD_MAGENTA = MAGENTA;
