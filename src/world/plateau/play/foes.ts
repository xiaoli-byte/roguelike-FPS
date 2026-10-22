/**
 * 第四章 8 种雷魅（+ 雷牦）的 AI（chuanzang-combat-v1.md 第 3 节）：分工、招式表（前摇 / 判定 / 破绽）、反制、带电。
 * 底座（受击四层、令牌、死法）在 foe.ts；招式 id 就是动画状态名（poses.ts 按它摆姿势、以后按它烘焙 Unity 片段）。
 */
import * as THREE from 'three';
import type { MonsterKind } from '../spec';
import type { DamageInfo, HitSphere, PlayCtx } from './core';
import { Foe, MAGENTA, glowSprite, type EncounterState, type FoeSpec } from './foe';
import { Beam, boulderMesh } from './fx';
import { defineMoves } from './moves';
import { spawnStatic } from './assets';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();

export const FOE_SPECS: Record<MonsterKind, FoeSpec> = {
  marmot: { model: 'SK_Enemy_Marmot', scale: 1.3, gait: 'upright', hp: 40, speed: 6.5, stride: 0.5, sight: 26, poise: 18, staggerTime: 0.4, hitch: 0.12, glowBone: 'orb', glowSize: 0.6, centerY: 0.35,
    spheres: [{ bone: 'spine', r: 0.32, mult: 1 }, { bone: 'head', r: 0.2, mult: 2 }, { bone: 'orb', r: 0.16, mult: 2.5 }] },
  tiangou: { model: 'SK_Enemy_Tiangou', scale: 1.1, gait: 'quad', hp: 80, speed: 9.5, stride: 1.1, sight: 30, poise: 30, staggerTime: 0.45, glowBone: 'rune', glowSize: 0.9, centerY: 0.55,
    spheres: [{ bone: 'chest', r: 0.42, mult: 1 }, { bone: 'hips', r: 0.38, mult: 1 }, { bone: 'head', r: 0.24, mult: 2 }] },
  aoyin: { model: 'SK_Enemy_Aoyin', scale: 1, gait: 'quad', hp: 900, speed: 3.5, stride: 1.6, sight: 30, poise: 220, staggerTime: 0.8, glowBone: 'orb', glowSize: 2.0, centerY: 1.3,
    spheres: [
      { bone: 'chest', r: 1.0, mult: 1, part: 'chest' }, { bone: 'hips', r: 0.9, mult: 1, part: 'rump' }, { bone: 'spine', r: 0.85, mult: 1, part: 'back' },
      { bone: 'upperarm_L', r: 0.55, mult: 1, part: 'shoulderL' }, { bone: 'upperarm_R', r: 0.55, mult: 1, part: 'shoulderR' },
      { bone: 'thigh_L', r: 0.55, mult: 1, part: 'haunchL' }, { bone: 'thigh_R', r: 0.55, mult: 1, part: 'haunchR' },
      { bone: 'head', r: 0.45, mult: 1.6 }, { bone: 'orb', r: 0.45, mult: 2.5, part: 'orb' },
    ] },
  leiyak: { model: 'SK_Enemy_Aoyin', scale: 0.72, gait: 'quad', hp: 260, speed: 4.5, stride: 1.3, sight: 28, poise: 90, staggerTime: 0.6, centerY: 1.3,
    spheres: [{ bone: 'chest', r: 1.0, mult: 1 }, { bone: 'hips', r: 0.9, mult: 1 }, { bone: 'head', r: 0.45, mult: 2 }] },
  jufu: { model: 'SK_Enemy_Jufu', scale: 1, gait: 'biped', hp: 240, speed: 5, stride: 0.9, sight: 55, poise: 60, staggerTime: 0.6, glowBone: 'palm', glowSize: 1.0, centerY: 1.0,
    spheres: [{ bone: 'chest', r: 0.42, mult: 1 }, { bone: 'hips', r: 0.36, mult: 1 }, { bone: 'head', r: 0.24, mult: 2 }, { bone: 'palm', r: 0.22, mult: 2 }, { bone: 'rock', r: 0.42, mult: 1, part: 'rock' }] },
  manman: { model: 'SK_Enemy_Manman', scale: 1.4, gait: 'bird', hp: 70, speed: 9, stride: 0.6, sight: 40, poise: 25, staggerTime: 0.5, glowBone: 'eye', glowSize: 0.8, centerY: 0.4,
    spheres: [{ bone: 'chest', r: 0.42, mult: 1 }, { bone: 'eye', r: 0.18, mult: 2.5 }] },
  liangu: { model: 'SM_EnemyPart_LianguCore', scale: 1, gait: 'quad', hp: 220, speed: 4, stride: 1, sight: 34, poise: 80, staggerTime: 0.5, centerY: 0,
    spheres: [{ bone: '', r: 0.5, mult: 1, part: 'core' }, ...[0, 1, 2, 3, 4, 5].map(i => ({ bone: '', r: 0.4, mult: 1, part: `drum${i}` }))] },
  dijiang: { model: 'SK_Enemy_Dijiang', scale: 1.2, gait: 'hexa', hp: 50, speed: 8, stride: 0.5, sight: 30, poise: Infinity, staggerTime: 0, glowBone: 'core', glowSize: 1.2, centerY: 0.5,
    spheres: [{ bone: 'body', r: 0.6, mult: 1 }, { bone: 'core', r: 0.25, mult: 2 }] },
  qiongqi: { model: 'SK_Enemy_Qiongqi', scale: 1.25, gait: 'quad', hp: 1100, speed: 5.5, stride: 1.4, sight: 34, poise: 150, staggerTime: 0.7, glowBone: 'crown', glowSize: 1.4, centerY: 0.9,
    spheres: [
      { bone: 'chest', r: 0.75, mult: 1 }, { bone: 'hips', r: 0.65, mult: 1 }, { bone: 'head', r: 0.38, mult: 1.6 }, { bone: 'crown', r: 0.3, mult: 2.5, part: 'crown' },
      { bone: 'wing_1_L', r: 0.4, mult: 1, part: 'wing' }, { bone: 'wing_1_R', r: 0.4, mult: 1, part: 'wing' },
    ] },
};

// ───────────────────────────── 招式表 ─────────────────────────────

const MARMOT = defineMoves('SK_Enemy_Marmot', [
  { id: 'scream', name: '尖啸', windup: 1.2, active: 0.3, recover: 0.6, noHit: true, events: [{ at: 1.2, name: 'shout' }] },
  { id: 'bite', name: '扑咬', windup: 0.35, active: 0.2, recover: 0.6, cooldown: 1.2 },
  { id: 'burrow', name: '钻洞', windup: 0.25, active: 1.2, recover: 0.4, cooldown: 6, noHit: true, events: [{ at: 0.25, name: 'hide' }, { at: 1.45, name: 'emerge' }] },
]);
const TIANGOU = defineMoves('SK_Enemy_Tiangou', [
  { id: 'howl', name: '雷吠', windup: 1.2, active: 0.6, recover: 0.6, cooldown: 7, noHit: true, events: [{ at: 1.2, name: 'lock' }, { at: 1.8, name: 'strike' }] },
  { id: 'pounce', name: '扑咬', windup: 0.3, active: 0.4, recover: 0.7, cooldown: 2.5 },
]);
const AOYIN = defineMoves('SK_Enemy_Aoyin', [
  { id: 'stampede', name: '刨地 → 领群踩踏', windup: 1.0, active: 3.0, recover: 1.2, cooldown: 5, glint: true },
  { id: 'gore', name: '四角挑', windup: 0.55, active: 0.25, recover: 0.7, cooldown: 1.6 },
  { id: 'slam', name: '雷球砸地', windup: 1.4, active: 0.3, recover: 1.0, glint: true },
]);
const JUFU = defineMoves('SK_Enemy_Jufu', [
  { id: 'climb', name: '抢高', windup: 0.5, active: 1.0, recover: 0.5, noHit: true, events: [{ at: 1.5, name: 'land' }] },
  { id: 'throw', name: '远投', windup: 1.0, active: 0.1, recover: 0.8, cooldown: 3, noHit: true, events: [{ at: 1.0, name: 'release' }] },
  { id: 'shove', name: '推开', windup: 0.45, active: 0.2, recover: 0.6, cooldown: 2 },
  { id: 'fall', name: '摔下高处', windup: 0, active: 0.8, recover: 1.5, noHit: true, events: [{ at: 0.8, name: 'land' }] },
]);
const MANMAN = defineMoves('SK_Enemy_Manman', [
  { id: 'sweep', name: '电弧横扫', windup: 0.8, active: 1.2, recover: 1.0, cooldown: 6 },
  { id: 'bolt', name: '电弹', windup: 0.4, active: 0.1, recover: 0.3, cooldown: 3, noHit: true, events: [{ at: 0.4, name: 'release' }] },
]);
const LIANGU = defineMoves('SM_EnemyPart_LianguCore', [
  { id: 'beat', name: '鼓点', windup: 0.25, active: 0.1, recover: 0.85, noHit: true, events: [{ at: 0.25, name: 'beat' }] },
  { id: 'clap', name: '惊雷', windup: 0.8, active: 0.2, recover: 1.0, cooldown: 3 },
  { id: 'orb', name: '雷心弹', windup: 0.4, active: 0.1, recover: 1.3, noHit: true, events: [{ at: 0.4, name: 'release' }] },
]);
const DIJIANG = defineMoves('SK_Enemy_Dijiang', [
  { id: 'swell', name: '球雷', windup: 0.8, active: 0.1, recover: 0, glint: true },
]);
const QIONGQI = defineMoves('SK_Enemy_Qiongqi', [
  { id: 'glide', name: '掠空扑杀', windup: 0.7, active: 1.6, recover: 0.8, cooldown: 4, glint: true, events: [{ at: 2.3, name: 'land' }] },
  { id: 'spin', name: '翼刃雷旋', windup: 0.5, active: 0.4, recover: 0.8, cooldown: 3 },
  { id: 'claw', name: '爪击', windup: 0.35, active: 0.5, recover: 0.6, cooldown: 1.2, events: [{ at: 0.45, name: 'hit1' }, { at: 0.7, name: 'hit2' }], noHit: true },
  { id: 'absorb', name: '吞雷', windup: 0.8, active: 0.6, recover: 0.4, noHit: true, events: [{ at: 0.8, name: 'eat' }] },
]);

/** 玩家被扇形 / 圆形范围扫到（在地上的才算：跳起来能躲的招传 groundOnly） */
function inCone(ctx: PlayCtx, x: number, z: number, yaw: number, r: number, half: number): boolean {
  const dx = ctx.feet.x - x, dz = ctx.feet.z - z, d = Math.hypot(dx, dz);
  if (d > r) return false;
  const a = Math.atan2(dx, dz) - yaw;
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= half || d < 1;
}

function knockFrom(ctx: PlayCtx, x: number, z: number, k: number, up = 0): { x: number; z: number; up: number } {
  const dx = ctx.feet.x - x, dz = ctx.feet.z - z, d = Math.max(0.5, Math.hypot(dx, dz));
  return { x: dx / d * k, z: dz / d * k, up };
}

// ───────────────────────────── 啸獭 ─────────────────────────────

export class Marmot extends Foe {
  /** 在电网里（3 只以上相距 4 m 内）：带电 */
  inNet = false;
  private hits: number[] = [];
  private burrowTo = new THREE.Vector3();

  constructor(ctx: PlayCtx, at: THREE.Vector3, hover: number, names: Record<MonsterKind, string>) {
    super('marmot', ctx, FOE_SPECS.marmot, at, hover, names);
  }

  override charged(): boolean { return this.inNet || super.charged(); }

  override hit(dmg: number, mult: number, at: THREE.Vector3, info?: DamageInfo): number {
    const d = super.hit(dmg, mult, at, info);
    if (d > 0) this.hits.push(this.ctx.time);
    return d;
  }

  override notice(): void {
    super.notice();
    if (this.sentinel && !this.mem.screamed) {
      this.mem.screamed = 1;
      this.begin(MARMOT.scream);
      this.ctx.say('啸獭哨兵直立了——趁它尖啸前打掉！', 1.6);
    }
  }

  protected override onEvent(ev: string, dist: number): void {
    super.onEvent(ev, dist);
    const ctx = this.ctx;
    if (ev === 'shout') {
      this.mem.screamed = 2;
      ctx.fx.shockwave(this.pos.x, this.pos.z, 18, 0.6, undefined, '#ff9ae8');
      ctx.wake(this.pos.x, this.pos.z, 60);
      ctx.say('啸獭哨兵尖啸——60 m 内的兽群都醒了', 2.5);
    } else if (ev === 'hit') {
      if (dist < 1.8 && ctx.feet.y < this.pos.y + 1.4) ctx.hurt(6, '啸獭', undefined, this.charged() ? 'shock' : undefined);
    } else if (ev === 'hide') {
      this.host.visible = false;
      ctx.fx.spray(this.pos, ['#7a6448', '#a08a6a'], 14, 3, 3, 12, 0.5);
    } else if (ev === 'emerge') {
      this.pos.copy(this.burrowTo);
      this.host.visible = true;
      ctx.fx.spray(this.pos, ['#7a6448', '#a08a6a'], 18, 3, 4, 12, 0.6);
    }
  }

  protected override onInterrupt(id: string): void {
    // 尖啸被打断：只叫醒了自己这窝
    if (id === 'scream' && this.mem.screamed === 1) { this.mem.screamed = 3; this.ctx.say('哨兵的尖啸被打断了', 1.5); }
    if (id === 'burrow') { this.host.visible = true; }
  }

  protected override prepare(id: string): void {
    if (id === 'burrow') { const a = Math.random() * 6.3; this.burrowTo.set(this.pos.x + Math.sin(a) * 8, 0, this.pos.z + Math.cos(a) * 8); this.burrowTo.y = this.ctx.terrain.heightAt(this.burrowTo.x, this.burrowTo.z); }
    if (id === 'scream') this.mem.screamed = 1;
  }

  protected think(dt: number, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    if (this.move.busy) {
      const id = this.move.id, st = this.move.stage;
      if (id === 'scream') { this.faceTo(P.x, P.z, dt, 4); return; }
      if (id === 'bite') {
        this.faceTo(P.x, P.z, dt, 10);
        if (st === 'active') this.steer(P.x, P.z, 11, dt, 0.8);
        return;
      }
      if (id === 'burrow') {
        if (st === 'active') {
          // 地下：土包沿地面移过去
          this.pos.x += (this.burrowTo.x - this.pos.x) * Math.min(1, dt * 3);
          this.pos.z += (this.burrowTo.z - this.pos.z) * Math.min(1, dt * 3);
          this.pos.y = ctx.terrain.heightAt(this.pos.x, this.pos.z);
          if (Math.random() < 0.6) ctx.fx.spray(this.pos, '#8a7050', 2, 1.5, 1.5, 10, 0.4);
        }
        return;
      }
      return;
    }
    // 哨兵站在高处：叫完跳下来
    if (this.sentinel && this.hover > 0.5 && dist < 30) { this.hover = 0; this.pos.y = this.groundY(this.pos.x, this.pos.z); }
    // 钻洞换位：半秒内挨两枪，或被贴到 3 m 且血不到一半
    this.hits = this.hits.filter(t => ctx.time - t < 1);
    const burrows = this.enc?.burrows ?? [];
    if (burrows.length && (this.mem.burrowCd ?? 0) <= ctx.time && (this.hits.length >= 2 || (dist < 3 && this.hp < this.maxHp * 0.5))) {
      const far = burrows.filter(b => { const d = b.distanceTo(this.pos); return d > 5 && d < 12; });
      const to = (far.length ? far : burrows)[Math.floor(Math.random() * (far.length || burrows.length))];
      if (to && to.distanceTo(this.pos) > 2) {
        this.burrowTo.set(to.x, ctx.terrain.heightAt(to.x, to.z), to.z);
        this.mem.burrowCd = ctx.time + 6;
        this.hits = [];
        this.begin(MARMOT.burrow);
        return;
      }
    }
    // 扑咬：拿到近战令牌才扑；拿不到就在 3–6 m 绕着蹦
    if (dist < 2.0 && this.cd <= 0 && this.takeToken('melee')) {
      this.cd = MARMOT.bite.cooldown!;
      this.begin(MARMOT.bite);
      return;
    }
    const has = this.token === 'melee' || this.takeToken('melee');
    if (has) {
      const moved = this.steer(P.x, P.z, this.spec.speed, dt, 1.2);
      this.anim.move = moved > 0 ? 1 : 0;
    } else {
      const a = Math.atan2(this.pos.x - P.x, this.pos.z - P.z) + dt * 1.2 * (this.home.x % 2 > 1 ? 1 : -1);
      const R = 4 + 1.5 * Math.sin(ctx.time * 2 + this.home.z);
      const moved = this.steer(P.x + Math.sin(a) * R, P.z + Math.cos(a) * R, this.spec.speed, dt);
      this.anim.move = moved > 0 ? 0.8 : 0;
      this.faceTo(P.x, P.z, dt, 6);
    }
  }
}

/**
 * 啸獭电网：一处遇敌里相距 4.5 m 内的啸獭连边，连通的 3 只以上成网——网里的都带电，
 * 每条边是一道电弧，玩家碰到每 0.4 秒 4 伤害（挂雷殛）。打掉中间那只断网。
 */
export class MarmotNet {
  private lines: Beam[] = [];
  private tick = 0;
  edges: [Marmot, Marmot][] = [];

  constructor(private readonly ctx: PlayCtx, private readonly members: Marmot[]) {}

  update(dt: number): void {
    const alive = this.members.filter(m => m.alive && m.host.visible && m.state === 'alert');
    const adj = new Map<Marmot, Marmot[]>();
    const edges: [Marmot, Marmot][] = [];
    for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
      if (alive[i].pos.distanceTo(alive[j].pos) < 4.5) {
        edges.push([alive[i], alive[j]]);
        adj.set(alive[i], [...(adj.get(alive[i]) ?? []), alive[j]]);
        adj.set(alive[j], [...(adj.get(alive[j]) ?? []), alive[i]]);
      }
    }
    // 连通分量 ≥ 3 才成网
    const comp = new Map<Marmot, number>();
    let id = 0;
    for (const m of alive) {
      if (comp.has(m)) continue;
      const stack = [m];
      comp.set(m, id);
      while (stack.length) for (const n of adj.get(stack.pop()!) ?? []) if (!comp.has(n)) { comp.set(n, id); stack.push(n); }
      id++;
    }
    const size = new Map<number, number>();
    for (const c of comp.values()) size.set(c, (size.get(c) ?? 0) + 1);
    for (const m of this.members) m.inNet = m.alive && (size.get(comp.get(m) ?? -1) ?? 0) >= 3;
    this.edges = edges.filter(([a]) => a.inNet);
    // 画电弧（每帧重新抖一下）
    while (this.lines.length < this.edges.length) this.lines.push(new Beam(this.ctx.scene, '#ff4fd8', 6, 0.035));
    this.lines.forEach((l, i) => {
      const e = this.edges[i];
      if (!e) { l.hide(); return; }
      const a = e[0].center(_v).setY(e[0].pos.y + 0.45).clone(), b = e[1].center(_w).setY(e[1].pos.y + 0.45).clone();
      l.set(a, b, 0.7 + 0.3 * Math.random(), 0.2);
    });
    // 玩家碰到电弧
    this.tick -= dt;
    if (this.tick > 0 || this.ctx.invulnerable()) return;
    const P = this.ctx.feet;
    for (const [a, b] of this.edges) {
      const d = segDist(P.x, P.z, a.pos.x, a.pos.z, b.pos.x, b.pos.z);
      if (d < 0.6 && P.y < Math.max(a.pos.y, b.pos.y) + 0.7) {
        this.tick = 0.4;
        this.ctx.hurt(4, '啸獭的电网', undefined, 'shock');
        break;
      }
    }
  }

  dispose(): void { for (const l of this.lines) l.dispose(this.ctx.scene); this.lines = []; }
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1;
  const t = THREE.MathUtils.clamp(((px - ax) * vx + (pz - az) * vz) / L, 0, 1);
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}

// ───────────────────────────── 天狗 ─────────────────────────────

export class Tiangou extends Foe {
  private lockAt = new THREE.Vector3();

  constructor(ctx: PlayCtx, at: THREE.Vector3, hover: number, names: Record<MonsterKind, string>) {
    super('tiangou', ctx, FOE_SPECS.tiangou, at, hover, names);
  }

  /** 3 m 内落雷：衔雷，带电 8 秒 */
  absorbBolt(): void { if (this.alive) { this.charge(8); this.ctx.fx.burst(this.center(_v), 1, '#ff6ae0'); } }

  protected override onEvent(ev: string, dist: number): void {
    super.onEvent(ev, dist);
    const ctx = this.ctx;
    if (ev === 'warn' && this.move.id === 'howl') {
      // 雷标：跟着玩家走 1.2 秒，定格时交给落雷（0.6 秒后劈下）
      this.warns.push(ctx.fx.followMark(2.6, this.move.def!.windup, () => ctx.feet, (at) => this.lockAt.copy(at)));
    } else if (ev === 'lock' && this.move.id === 'howl') {
      ctx.bolt(this.lockAt.x, this.lockAt.z, { r: 2.6, delay: 0.6, dmg: 15, source: '天狗的雷标' });
    } else if (ev === 'warn' && this.move.id === 'pounce') {
      const yaw = Math.atan2(ctx.feet.x - this.pos.x, ctx.feet.z - this.pos.z);
      this.warns.push(ctx.fx.lineWarn(this.pos.x, this.pos.z, this.pos.x + Math.sin(yaw) * 4, this.pos.z + Math.cos(yaw) * 4, 1.2, 0.3, '#ffb347'));
    }
  }

  protected think(dt: number, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    if (this.move.busy) {
      const id = this.move.id, st = this.move.stage;
      if (id === 'howl') { this.faceTo(P.x, P.z, dt, 3); this.anim.move = 0; return; }
      if (id === 'pounce') {
        if (st === 'windup') { this.faceTo(P.x, P.z, dt, 12); this.vel.set(Math.sin(this.yaw) * 10, 0, Math.cos(this.yaw) * 10); return; }
        if (st === 'active') {
          this.anim.move = 1;
          this.dash(this.vel.x, this.vel.z, dt);
          this.pos.y = this.groundY(this.pos.x, this.pos.z) + Math.sin(this.move.stageK * Math.PI) * 1.2;
          if (!this.mem.bit && Math.hypot(P.x - this.pos.x, P.z - this.pos.z) < 1.6 && P.y < this.pos.y + 1.2) {
            this.mem.bit = 1;
            const ch = this.charged();
            ctx.hurt(ch ? 14 : 9, '天狗', { x: this.vel.x * 0.3, z: this.vel.z * 0.3 }, ch ? 'shock' : undefined);
          }
          return;
        }
        this.pos.y = this.groundY(this.pos.x, this.pos.z);
        return;
      }
      return;
    }
    // 雷吠：一群里同时只有一只（雷吠令牌），12–30 m 内、看得见才吠
    if (this.cd <= 0 && dist > 8 && dist < 30 && this.sees() && (this.mem.howlCd ?? 0) <= ctx.time && this.takeToken('howl')) {
      this.mem.howlCd = ctx.time + TIANGOU.howl.cooldown!;
      this.begin(TIANGOU.howl);
      return;
    }
    // 扑咬：只从玩家视野外（> 50°）、3–6 m 发动，一群里同时只有一只
    const behind = this.inPlayerView() > 0.9;
    if (this.cd <= 0 && dist > 2.5 && dist < 6 && behind && this.takeToken('pounce')) {
      this.cd = TIANGOU.pounce.cooldown!;
      this.mem.bit = 0;
      this.begin(TIANGOU.pounce);
      return;
    }
    // 绕圈：按「左后、右后、左侧、右侧」分站位；拿着扑咬令牌的往 4.5 m 收
    const mates = (this.enc?.foes ?? []).filter(f => f.alive && f.kind === 'tiangou');
    const slot = Math.max(0, mates.indexOf(this));
    const slots = [Math.PI - 0.7, Math.PI + 0.7, Math.PI - 1.6, Math.PI + 1.6];
    const fwd = ctx.yaw + Math.PI; // Walker.yaw 的前方是 −sin / −cos：转成 atan2(dx, dz) 的角
    const a = fwd + slots[slot % 4] + 0.15 * Math.sin(ctx.time * 0.7 + slot);
    const R = this.token === 'pounce' ? 4.5 : 13 + 3 * Math.sin(ctx.time * 0.5 + slot * 2);
    const moved = this.steer(P.x + Math.sin(a) * R, P.z + Math.cos(a) * R, this.spec.speed, dt);
    this.anim.move = moved > 0 ? Math.min(1, moved / (this.spec.speed * dt) + 0.2) : 0;
    if (moved === 0) this.faceTo(P.x, P.z, dt, 5);
  }
}

// ───────────────────────────── 獓狠 / 雷牦 ─────────────────────────────

const FUR_ZONES = ['chest', 'rump', 'back', 'shoulderL', 'shoulderR', 'haunchL', 'haunchR'];
const FUR_BONE: Record<string, string> = { chest: 'chest', rump: 'hips', back: 'spine', shoulderL: 'upperarm_L', shoulderR: 'upperarm_R', haunchL: 'thigh_L', haunchR: 'thigh_R' };

export class Aoyin extends Foe {
  /** 角间雷球攒的电（0..3） */
  orbCharge = 0;
  /** 每片蓑毛：1 = 完整，0 = 烧光（露出雷筋） */
  readonly fur: Record<string, number> = {};
  private readonly burning: Record<string, number> = {};
  private readonly veins: Record<string, THREE.Sprite> = {};
  private orbDmg = 0;
  private readonly orb: THREE.Mesh | null;
  leader: Aoyin | null = null;
  private lane = 0;

  constructor(kind: 'aoyin' | 'leiyak', ctx: PlayCtx, at: THREE.Vector3, hover: number, names: Record<MonsterKind, string>) {
    super(kind, ctx, FOE_SPECS[kind], at, hover, names);
    if (kind === 'aoyin') {
      for (const z of FUR_ZONES) {
        this.fur[z] = 1;
        const sp = glowSprite('#ff7ae6', 1.1);
        sp.visible = false;
        ctx.scene.add(sp);
        this.veins[z] = sp;
        this.extras.push(sp);
      }
      this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshBasicMaterial({ color: MAGENTA, transparent: true, opacity: 0.9 }));
      ctx.scene.add(this.orb);
      this.extras.push(this.orb);
    } else {
      this.orb = null;
      // 雷牦：毛色暗一点
      const m = this.body?.materials[0] as THREE.MeshStandardMaterial | undefined;
      if (m) { const c = m.clone(); c.color.multiplyScalar(0.62); this.body!.materials[0] = c; this.host.traverse(o => { const mm = o as THREE.Mesh; if (mm.isMesh) mm.material = c; }); }
    }
  }

  override charged(): boolean { return this.orbCharge > 0 || super.charged(); }
  armored(): boolean { return this.kind === 'aoyin' && FUR_ZONES.some(z => this.fur[z] > 0); }

  /** 熔金：每片蓑毛烧掉一半（熔铸再快一倍） */
  melt(k: number): void { for (const z of FUR_ZONES) if (this.fur[z] > 0) this.burning[z] = Math.max(this.burning[z] ?? 0, 0.5 * k); }

  protected override partMul(sphere: HitSphere | undefined, info: DamageInfo, dmg: number): number {
    if (this.kind !== 'aoyin') return 1;
    // 火：烧半径内（爆炸）或打中的那片蓑毛
    if (info.elem === 'fire' || info.kind === 'reaction') {
      const R = info.blastR ?? 0;
      for (const s of this.hitList) {
        if (!s.part || !FUR_ZONES.includes(s.part) || this.fur[s.part] <= 0) continue;
        if (s === sphere || (R > 0 && info.from && s.c.distanceTo(info.from) < R + s.r)) this.burning[s.part] = Math.max(this.burning[s.part] ?? 0, 1);
      }
    }
    if (sphere?.part === 'orb') {
      if (this.move.id === 'slam' && this.move.stage === 'windup') {
        this.orbDmg += dmg * 2.5;
        if (this.orbDmg >= 120) { this.orbDmg = 0; this.detonateOrb(); }
      }
      return 1;
    }
    if (info.kind === 'reaction' || info.kind === 'dot') return 1;
    if (sphere?.part && FUR_ZONES.includes(sphere.part)) return this.fur[sphere.part] > 0 ? 0.2 + 0.8 * (1 - this.fur[sphere.part]) : 1.25;
    return 1;
  }

  private detonateOrb(): void {
    const ctx = this.ctx;
    const at = this.boneWorld('orb', new THREE.Vector3());
    ctx.fx.burst(at, 3, '#ff7ae6');
    ctx.fx.spray(at, ['#ff7ae6', '#ffffff'], 40, 8, 4, 10, 0.7);
    ctx.shake(0.3);
    this.orbCharge = 0;
    this.interrupt();
    super.hit(150, 1, at, { kind: 'env', from: at, poise: 0 });
    this.stun(2.5, '雷球在脸上炸开，眩晕');
  }

  protected override onEvent(ev: string, dist: number): void {
    super.onEvent(ev, dist);
    const ctx = this.ctx, P = ctx.feet;
    const id = this.move.id;
    if (ev === 'warn' && id === 'stampede') {
      // 冲撞线：沿朝向 40 m（撞到挡路的就截短）
      const yaw = Math.atan2(P.x - this.pos.x, P.z - this.pos.z) + this.lane * 0;
      this.yaw = yaw;
      let len = 0;
      for (; len < 40; len += 2) if (!this.canStand(this.pos.x + Math.sin(yaw) * (len + 2), this.pos.z + Math.cos(yaw) * (len + 2))) break;
      this.mem.len = Math.max(8, len);
      this.mem.ax = this.pos.x; this.mem.az = this.pos.z;
      this.warns.push(ctx.fx.lineWarn(this.pos.x, this.pos.z, this.pos.x + Math.sin(yaw) * this.mem.len, this.pos.z + Math.cos(yaw) * this.mem.len, 3.2, this.move.def!.windup, '#ff5ad8'));
      this.mem.hit = 0;
      // 领群：同一处遇敌里空着的雷牦在两侧平行排开，一起冲
      if (this.kind === 'aoyin') {
        let lane = 1;
        for (const f of this.enc?.foes ?? []) {
          if (f instanceof Aoyin && f !== this && f.alive && f.kind === 'leiyak' && !f.move.busy && f.stunT <= 0) {
            const off = (lane % 2 ? 1 : -1) * 4 * Math.ceil(lane / 2);
            f.joinStampede(this, yaw, off);
            lane++;
          }
        }
      }
    } else if (ev === 'warn' && id === 'slam') {
      this.warns.push(ctx.fx.telegraph(this.pos.x, this.pos.z, 8, this.move.def!.windup, () => {}, '#ff5ad8'));
      this.orbDmg = 0;
      ctx.say('獓狠人立——打它角间的雷球！', 1.5);
    } else if (ev === 'hit' && id === 'slam') {
      const x = this.pos.x, z = this.pos.z;
      let done = false;
      ctx.fx.shockwave(x, z, 8, 0.35, (r) => {
        const d = Math.hypot(ctx.feet.x - x, ctx.feet.z - z);
        if (!done && Math.abs(d - r) < 1.2 && ctx.walker.grounded) { done = true; ctx.hurt(20, '獓狠的雷球砸地', knockFrom(ctx, x, z, 8, 5), 'shock'); }
      }, '#ff5ad8');
      ctx.fx.burst(this.pos.clone().setY(this.pos.y + 1), 3, '#ff7ae6');
      ctx.shake(0.4);
      this.orbCharge = 0;
    } else if (ev === 'hit' && id === 'gore') {
      if (inCone(ctx, this.pos.x, this.pos.z, this.yaw, 4.2 * this.spec.scale + 0.6, 1.05)) ctx.hurt(this.kind === 'aoyin' ? 16 : 11, this.label, knockFrom(ctx, this.pos.x, this.pos.z, 6, 7));
    }
  }

  /** 雷牦跟着獓狠冲：同一朝向、横向错开 off */
  joinStampede(lead: Aoyin, yaw: number, off: number): void {
    this.leader = lead;
    this.lane = off;
    this.pos.x += Math.cos(yaw) * off * 0.3; this.pos.z -= Math.sin(yaw) * off * 0.3;
    this.begin(AOYIN.stampede);
    this.yaw = yaw;
    this.mem.ax = this.pos.x; this.mem.az = this.pos.z;
    this.mem.len = (lead.mem.len ?? 30);
    this.mem.hit = 0;
    this.warns.push(this.ctx.fx.lineWarn(this.pos.x, this.pos.z, this.pos.x + Math.sin(yaw) * this.mem.len, this.pos.z + Math.cos(yaw) * this.mem.len, 2.6, AOYIN.stampede.windup, '#ff5ad8'));
  }

  protected override onInterrupt(id: string): void { if (id === 'stampede') this.leader = null; }
  protected override prepare(id: string): void { if (id === 'slam') this.orbCharge = 3; }

  protected think(dt: number, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    if (this.move.busy) {
      const id = this.move.id, st = this.move.stage;
      if (id === 'stampede') {
        if (st === 'active') {
          this.anim.move = 1;
          const spd = 13 * (this.haste > 0 ? 1.2 : 1);
          const ok = this.dash(Math.sin(this.yaw) * spd, Math.cos(this.yaw) * spd, dt);
          this.pos.y = this.groundY(this.pos.x, this.pos.z);
          if (Math.random() < 0.5) ctx.fx.spray(this.pos, ['#a89878', '#ff7ae6'], 2, 2, 1.5, 8, 0.5);
          if (!this.mem.hit && !ctx.invulnerable() && Math.hypot(P.x - this.pos.x, P.z - this.pos.z) < 2.0 * this.spec.scale + 0.6 && P.y < this.pos.y + 2.2 * this.spec.scale) {
            this.mem.hit = 1;
            ctx.hurt(this.kind === 'aoyin' ? 24 : 16, this.label, { x: Math.sin(this.yaw) * 14, z: Math.cos(this.yaw) * 14, up: 6 });
          }
          if (!ok || Math.hypot(this.pos.x - this.mem.ax, this.pos.z - this.mem.az) >= this.mem.len) {
            this.move.finishActive();
            if (this.kind === 'aoyin') this.orbCharge = Math.min(3, this.orbCharge + 1);
          }
        } else if (st === 'recover') {
          this.anim.move = Math.max(0, 1 - this.move.stageK * 2);
          if (this.move.stageK < 0.3) this.dash(Math.sin(this.yaw) * 4 * (1 - this.move.stageK / 0.3), Math.cos(this.yaw) * 4 * (1 - this.move.stageK / 0.3), dt);
          if (this.move.stageK > 0.5) this.faceTo(P.x, P.z, dt, 1.5);
        } else this.anim.move = 0;
        return;
      }
      if (id === 'gore') { if (this.move.stage === 'windup') this.faceTo(P.x, P.z, dt, 4); this.anim.move = 0; return; }
      if (id === 'slam') { this.anim.move = 0; return; }
      return;
    }
    if (this.kind === 'aoyin' && this.orbCharge >= 3 && this.cd <= 0) { this.begin(AOYIN.slam); this.cd = 2; return; }
    if (this.cd <= 0 && dist < 4.2 * this.spec.scale + 0.8 && this.takeToken('melee')) {
      this.anim.side = -this.anim.side;
      this.cd = AOYIN.gore.cooldown!;
      this.begin(AOYIN.gore);
      return;
    }
    if (this.kind === 'aoyin' && this.cd <= 0 && dist > 8 && dist < 34 && (this.mem.stampCd ?? 0) <= ctx.time) {
      this.mem.stampCd = ctx.time + AOYIN.stampede.cooldown!;
      this.cd = 1;
      this.begin(AOYIN.stampede);
      return;
    }
    if (this.kind === 'leiyak' && this.cd <= 0 && dist > 8 && dist < 26 && (this.mem.stampCd ?? 0) <= ctx.time && !(this.enc?.foes.some(f => f.kind === 'aoyin' && f.alive))) {
      // 没有獓狠带队的雷牦自己冲
      this.mem.stampCd = ctx.time + 6;
      this.begin(AOYIN.stampede);
      return;
    }
    const moved = this.steer(P.x, P.z, this.spec.speed, dt, 3);
    this.anim.move = moved > 0 ? 0.55 : 0;
    if (moved === 0) this.faceTo(P.x, P.z, dt, 2);
  }

  protected override placeExtras(): void {
    if (this.kind !== 'aoyin') return;
    const ctx = this.ctx;
    if (this.orb) {
      this.boneWorld('orb', this.orb.position);
      const charge = this.orbCharge / 3;
      const windup = this.move.id === 'slam' && this.move.stage === 'windup' ? this.move.stageK : 0;
      this.orb.scale.setScalar((0.8 + 0.5 * charge + 0.5 * windup) * (1 + 0.1 * Math.sin(ctx.time * 12)));
      (this.orb.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.31 + 0.5 * windup, 0.85 + 0.15 * windup);
    }
    for (const z of FUR_ZONES) {
      const b = this.burning[z] ?? 0;
      if (b > 0 && this.fur[z] > 0) {
        // 烧毛：1.5 秒烧光一片（熔铸 / 熔金更快），冒火
        const rate = (1 / 1.5) * (1 + this.ctx.kit.stacks('rx_mg_shatter'));
        this.fur[z] = Math.max(0, this.fur[z] - rate * (1 / 60) * Math.max(1, b));
        this.boneWorld(FUR_BONE[z], _v);
        if (Math.random() < 0.7) ctx.fx.spray(_v, ['#ff8a3a', '#ffd24a', '#3a3028'], 2, 1.5, 3, -2, 0.6);
        if (this.fur[z] <= 0) { this.burning[z] = 0; ctx.fx.burst(_v, 1.2, '#ff7ae6'); }
      }
      const sp = this.veins[z];
      sp.visible = this.alive && this.fur[z] <= 0;
      if (sp.visible) { this.boneWorld(FUR_BONE[z], sp.position); sp.material.opacity = 0.55 + 0.25 * Math.sin(ctx.time * 9 + z.length); }
    }
  }
}

// ───────────────────────────── 举父 ─────────────────────────────

export class Jufu extends Foe {
  private readonly rock: THREE.Object3D;
  private readonly target = new THREE.Vector3();
  private readonly perch = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private rockDmg = 0;
  private holding = false;

  constructor(ctx: PlayCtx, at: THREE.Vector3, hover: number, names: Record<MonsterKind, string>) {
    super('jufu', ctx, FOE_SPECS.jufu, at, hover, names);
    this.rock = boulderMesh(0.4);
    this.rock.visible = false;
    ctx.scene.add(this.rock);
    this.extras.push(this.rock);
  }

  /** 雷暴里 / 带电时手里是雷石 */
  private get storm(): boolean { return this.ctx.weather.level > 0.5 || super.charged(); }
  override charged(): boolean { return (this.holding && this.storm) || super.charged(); }

  override spheres(): readonly HitSphere[] {
    const list = super.spheres();
    // 手里的雷石只在举石的时候能打（位置在两只手中间）
    this.hitList[4].r = this.holding ? 0.42 : 0;
    this.rockAt(this.hitList[4].c);
    return list;
  }

  /** 雷石的位置：两只手中间 */
  private rockAt(out: THREE.Vector3): THREE.Vector3 {
    this.boneWorld('hand_L', out);
    this.boneWorld('hand_R', _u);
    return out.add(_u).multiplyScalar(0.5);
  }

  protected override partMul(sphere: HitSphere | undefined, _info: DamageInfo, dmg: number): number {
    if (sphere?.part === 'rock') {
      this.rockDmg += dmg;
      if (this.holding && this.rockDmg >= 40) this.popRock();
      return 0.5;
    }
    return 1;
  }

  /** 手中炸石：石头在它手里炸开，自伤 + 眩晕；带电时是焚雷 */
  private popRock(): void {
    const ctx = this.ctx;
    const at = this.rockAt(new THREE.Vector3());
    const wasStorm = this.storm;
    this.holding = false;
    this.rock.visible = false;
    ctx.fx.burst(at, 2.4, wasStorm ? '#ff7ae6' : '#ffb37a');
    ctx.fx.spray(at, ['#6e665e', '#ff7ae6'], 30, 7, 4, 14, 0.7);
    ctx.shake(0.2);
    super.hit(60, 1, at, { kind: 'env', from: at, poise: 0 });
    if (!this.alive) return;
    if (wasStorm) ctx.elements.apply(this, 'fire', 40);
    this.stun(2, '手里的石头炸了');
    this.maybeFall();
  }

  protected override onStagger(): void { this.maybeFall(); }

  /** 站在屋顶 / 高处边上被打出硬直、眩晕：摔下去 */
  private maybeFall(): void {
    const ctx = this.ctx;
    const g = ctx.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y - g < 2.2 || !this.alive) return;
    // 找最近的边：8 个方向 4 m 内地面低 2 m 以上的那一侧
    let best: THREE.Vector3 | null = null;
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      for (let r = 1; r <= 4; r++) {
        const x = this.pos.x + Math.sin(a) * r, z = this.pos.z + Math.cos(a) * r;
        if (ctx.world.groundAt(x, z, this.pos.y + 0.5) < this.pos.y - 2) { if (!best || r < best.y) best = new THREE.Vector3(x, r, z); break; }
      }
    }
    if (!best) return;
    this.from.copy(this.pos);
    this.perch.set(best.x + (best.x - this.pos.x) * 0.3, 0, best.z + (best.z - this.pos.z) * 0.3);
    this.perch.y = ctx.terrain.heightAt(this.perch.x, this.perch.z);
    this.stunT = 0;
    this.begin(JUFU.fall);
    this.mem.falling = 1;
  }

  protected override onEvent(ev: string, dist: number): void {
    super.onEvent(ev, dist);
    const ctx = this.ctx, P = ctx.feet;
    const id = this.move.id;
    if (ev === 'warn' && id === 'throw') {
      // 往玩家正要去的地方扔：落点预警圈和举石同时出现
      this.holding = true;
      this.rockDmg = 0;
      const flight = Math.min(1.4, dist / 22 + 0.6);
      this.mem.flight = flight;
      const lead = this.move.def!.windup + flight;
      const tx = P.x + (this.mem.pvx ?? 0) * lead * 0.8, tz = P.z + (this.mem.pvz ?? 0) * lead * 0.8;
      this.target.set(tx, ctx.fx.ground(tx, tz), tz);
      this.warns.push(ctx.fx.telegraph(tx, tz, 3, lead, () => {}, this.storm ? '#ff5ad8' : '#ff8a3a'));
    } else if (ev === 'release' && id === 'throw') {
      this.holding = false;
      const from = this.rockAt(new THREE.Vector3());
      const storm = this.storm;
      ctx.fx.lob(from, this.target.clone(), this.mem.flight, boulderMesh(0.45), 3, (at) => {
        ctx.fx.burst(at, 3, storm ? '#ff7ae6' : '#ffb37a');
        ctx.fx.spray(at, ['#6e665e', '#9a8a78'], 16, 5, 4, 14, 0.6);
        if (at.distanceTo(ctx.feet) < 3.2 && !ctx.invulnerable()) ctx.hurt(18, storm ? '举父的雷石' : '举父的石头', knockFrom(ctx, at.x, at.z, 6, 3), storm ? 'shock' : undefined);
        if (storm) {
          // 雷石落地留 6 秒电场
          ctx.fx.field(at.x, at.z, 4, 6, '#ff5ad8', 0.5, () => {
            if (Math.hypot(ctx.feet.x - at.x, ctx.feet.z - at.z) < 4 && ctx.feet.y < at.y + 1) ctx.hurt(4, '雷石的电场', undefined, 'shock');
          });
        }
      }, '#ff8a3a', false);
      this.giveToken();
    } else if (ev === 'hit' && id === 'shove') {
      if (inCone(ctx, this.pos.x, this.pos.z, this.yaw, 5, 1.05)) ctx.hurt(12, '举父', knockFrom(ctx, this.pos.x, this.pos.z, 9, 3));
      this.mem.repos = 1;
    } else if (ev === 'land' && id === 'climb') {
      ctx.fx.spray(this.pos, ['#8a7a60'], 10, 3, 2, 10, 0.4);
    } else if (ev === 'land' && id === 'fall') {
      ctx.fx.spray(this.pos, ['#8a7a60'], 14, 4, 2, 10, 0.5);
      super.hit(30, 1, this.pos, { kind: 'env', poise: 0 });
      if (this.alive) { this.stunT = 0; this.stun(1.5, '从高处摔下来了'); }
    }
  }

  protected override onInterrupt(id: string): void { if (id === 'throw') { this.holding = false; } }

  protected override prepare(id: string): void {
    if (id === 'climb') { if (!this.findPerch()) this.perch.set(this.pos.x + 6, this.pos.y + 3, this.pos.z); this.from.copy(this.pos); }
    if (id === 'fall') { this.from.copy(this.pos); this.perch.set(this.pos.x + 3, this.ctx.terrain.heightAt(this.pos.x + 3, this.pos.z), this.pos.z); }
  }

  /** 25 m 内比现在高 3 m 以上、看得见玩家的落脚点 */
  private findPerch(): boolean {
    const ctx = this.ctx;
    let best = Infinity;
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2;
      for (let r = 6; r <= 25; r += 3) {
        const x = this.pos.x + Math.sin(a) * r, z = this.pos.z + Math.cos(a) * r;
        const top = ctx.world.groundAt(x, z, 1e4);
        if (top - this.pos.y < 3 || top - this.pos.y > 14 || ctx.bound(x, z) > 0) continue;
        if (ctx.terrain.waterDepthAt(x, z) > 0.3) continue;
        const c = ctx.center;
        if (!ctx.terrain.lineOfSight(x, top + 1.6, z, c.x, c.y, c.z)) continue;
        const score = r - (top - this.pos.y) * 0.5;
        if (score < best) { best = score; this.perch.set(x, top, z); }
      }
    }
    return best < Infinity;
  }

  protected think(dt: number, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    if (this.move.busy) {
      const id = this.move.id, st = this.move.stage;
      if (id === 'climb' || id === 'fall') {
        if (st === 'active') {
          const k = this.move.stageK;
          this.pos.x = this.from.x + (this.perch.x - this.from.x) * k;
          this.pos.z = this.from.z + (this.perch.z - this.from.z) * k;
          this.pos.y = this.from.y + (this.perch.y - this.from.y) * k + (id === 'climb' ? 3 : 1) * 4 * k * (1 - k);
          this.face(Math.atan2(this.perch.x - this.from.x, this.perch.z - this.from.z), dt, 6);
        } else if (st === 'recover') this.pos.y = this.perch.y;
        return;
      }
      this.faceTo(P.x, P.z, dt, 4);
      return;
    }
    this.faceTo(P.x, P.z, dt, 4);
    const elevated = this.pos.y - ctx.terrain.heightAt(this.pos.x, this.pos.z) > 2;
    // 抢高：开战先跳上最近的高处；被推开之后换一处
    if ((!elevated && !this.mem.climbed) || this.mem.repos) {
      this.mem.climbed = 1;
      this.mem.repos = 0;
      if (this.findPerch()) { this.from.copy(this.pos); this.begin(JUFU.climb); return; }
    }
    if (dist < 5 && this.cd <= 0) { this.cd = JUFU.shove.cooldown!; this.begin(JUFU.shove); return; }
    if (this.cd <= 0 && dist < 60 && dist > 6 && this.sees() && this.takeToken('ranged')) {
      this.cd = JUFU.throw.cooldown! + Math.random();
      this.begin(JUFU.throw);
      return;
    }
    // 没在高处、又没地方爬：指节着地跑到 15–25 m
    if (!elevated && (dist < 12 || dist > 30)) {
      const d = Math.max(1, dist);
      const tx = P.x + (this.pos.x - P.x) / d * 18, tz = P.z + (this.pos.z - P.z) / d * 18;
      const moved = this.steer(tx, tz, this.spec.speed, dt);
      this.anim.move = moved > 0 ? 0.9 : 0;
    } else this.anim.move = 0;
  }

  protected override placeExtras(): void {
    this.rock.visible = this.holding && this.alive;
    if (this.rock.visible) {
      this.rockAt(this.rock.position);
      const s = this.storm;
      this.rock.scale.setScalar(s ? 1 + 0.08 * Math.sin(this.ctx.time * 30) : 1);
    }
  }
}

// ───────────────────────────── 蛮蛮 ─────────────────────────────

export class Manman extends Foe {
  mate: Manman | null = null;
  lead = false;
  /** 比翼断了：落地追啄 */
  downed = false;
  private readonly arc: Beam;
  private readonly S = new THREE.Vector3();
  private readonly E = new THREE.Vector3();
  private side = 1;

  constructor(ctx: PlayCtx, at: THREE.Vector3, hover: number, names: Record<MonsterKind, string>) {
    super('manman', ctx, FOE_SPECS.manman, at, hover, names);
    this.arc = new Beam(ctx.scene, '#ff4fd8', 10, 0.05);
    this.extras.push(this.arc.group);
  }

  pair(mate: Manman, lead: boolean): void { this.mate = mate; this.lead = lead; this.side = lead ? 1 : -1; }

  override charged(): boolean { return (!this.downed && !!this.mate?.alive) || super.charged(); }

  protected override partMul(): number { return this.downed ? 1.5 : 1; }

  protected override onDeath(): void {
    const m = this.mate;
    if (m && m.alive && !m.downed) {
      m.downed = true;
      m.interrupt();
      m.ctx.say('蛮蛮比翼断了——另一只也飞不起来', 2);
    }
  }

  protected override onEvent(ev: string, dist: number): void {
    super.onEvent(ev, dist);
    const ctx = this.ctx;
    if (ev === 'release' && this.move.id === 'bolt') {
      const from = this.boneWorld('head', new THREE.Vector3());
      const dir = _w.copy(ctx.center).sub(from).normalize().multiplyScalar(24);
      ctx.fx.shot(from, dir.clone(), 0.35, '#ff7ae6', (at, hitP) => {
        if (hitP && !ctx.invulnerable()) ctx.hurt(7, '蛮蛮', undefined, 'shock');
        else ctx.fx.burst(at, 1, '#ff7ae6');
      });
    }
  }

  override force(id: string): boolean {
    if (id === 'sweep' && this.mate?.alive) { (this.lead ? this : this.mate).startSweep(); return true; }
    return super.force(id);
  }

  /** 领头的那只决定横扫，跟着的那只同步开始 */
  startSweep(): void {
    const ctx = this.ctx, P = ctx.feet;
    const c = _v.copy(this.pos).add(this.mate!.pos).multiplyScalar(0.5);
    const dir = _w.set(P.x - c.x, 0, P.z - c.z);
    if (dir.lengthSq() < 1) dir.set(1, 0, 0);
    dir.normalize();
    const S = this.S.set(P.x - dir.x * 15, 0, P.z - dir.z * 15);
    const E = this.E.set(P.x + dir.x * 15, 0, P.z + dir.z * 15);
    for (const b of [this, this.mate!]) {
      b.S.copy(S); b.E.copy(E);
      b.begin(MANMAN.sweep);
      b.mem.hit = 0;
    }
    this.warns.push(ctx.fx.lineWarn(S.x, S.z, E.x, E.z, 10, MANMAN.sweep.windup + 0.2, '#ff5ad8'));
  }

  protected think(dt: number, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    if (this.downed) {
      // 落地追啄
      this.hover = 0;
      this.anim.flap = 0.15;
      const g = this.groundY(this.pos.x, this.pos.z);
      this.pos.y = Math.max(g, this.pos.y - dt * 9);
      if (this.pos.y > g + 0.05) return;
      this.posture = 'hop';
      const moved = this.steer(P.x, P.z, 4, dt, 1.0);
      this.anim.move = moved > 0 ? 1 : 0;
      this.pos.y = g + Math.abs(Math.sin(ctx.time * 9)) * 0.25;
      if (dist < 1.5 && this.cd <= 0) { this.cd = 1; ctx.hurt(6, '蛮蛮'); }
      return;
    }
    this.anim.flap = 1;
    const mate = this.mate;
    const paired = !!mate?.alive;
    if (this.move.id === 'sweep') {
      const st = this.move.stage, k = this.move.stageK;
      const dir = _u.subVectors(this.E, this.S).normalize();
      const lat = _w.set(-dir.z, 0, dir.x).multiplyScalar(5 * this.side);
      let tgt: THREE.Vector3;
      if (st === 'windup') tgt = _v.copy(this.S).add(lat).setY(ctx.terrain.heightAt(this.S.x, this.S.z) + 1.0 + 4 * (1 - k));
      else if (st === 'active') {
        tgt = _v.copy(this.S).lerp(this.E, k).add(lat);
        tgt.y = ctx.fx.ground(tgt.x, tgt.z) + 1.0;
        this.pos.copy(tgt);
        // 电弧扫到玩家：玩家站在两只之间那条线上、没跳过去
        if (this.lead && paired && !this.mem.hit && !ctx.invulnerable()) {
          const d = segDist(P.x, P.z, this.pos.x, this.pos.z, mate!.pos.x, mate!.pos.z);
          if (d < 0.7 && P.y < Math.min(this.pos.y, mate!.pos.y) - 0.05) {
            this.mem.hit = 1;
            ctx.hurt(10, '蛮蛮的电弧', { x: dir.x * 9, z: dir.z * 9, up: 3 }, 'shock');
          }
        }
        this.face(Math.atan2(dir.x, dir.z), dt, 10);
        return;
      } else tgt = _v.copy(this.E).add(lat).setY(ctx.terrain.heightAt(this.E.x, this.E.z) + 1.0 + 6 * k);
      this.pos.lerp(tgt, Math.min(1, dt * (st === 'windup' ? 4 : 1.5)));
      this.face(Math.atan2(dir.x, dir.z), dt, 6);
      return;
    }
    if (this.move.busy) { this.faceTo(P.x, P.z, dt, 6); return; }
    // 盘旋：两只隔 6–10 m 绕玩家 15 m
    const leadBird = this.lead || !paired ? this : mate!;
    const a = ctx.time * 0.45 + leadBird.home.x * 0.3;
    const R = 15 + 2 * Math.sin(ctx.time * 0.4 + leadBird.home.z);
    const cx = P.x + Math.cos(a) * R, cz = P.z + Math.sin(a) * R;
    const spread = paired ? 4 + 1.5 * Math.sin(ctx.time * 0.8) : 0;
    const tx = cx + Math.cos(a) * spread * this.side, tz = cz + Math.sin(a) * spread * this.side;
    this.steer(tx, tz, this.spec.speed * (this.status.slow > 0 ? 0.6 : 1), dt);
    const ty = ctx.terrain.heightAt(this.pos.x, this.pos.z) + 7.5 + 1.5 * Math.sin(ctx.time + this.home.x);
    this.pos.y += (ty - this.pos.y) * Math.min(1, dt * 2);
    this.anim.move = 1;
    if (this.lead && paired && this.cd <= 0 && dist < 34 && this.takeToken('ranged') && !mate!.move.busy && !mate!.stunned) {
      this.cd = MANMAN.sweep.cooldown! + Math.random() * 2;
      mate!.cd = Math.max(mate!.cd, 2);
      this.startSweep();
      return;
    }
    if (this.cd <= 0 && dist < 40 && this.sees() && (this.mem.boltCd ?? 0) <= ctx.time) {
      this.mem.boltCd = ctx.time + MANMAN.bolt.cooldown! + Math.random() * 1.5;
      this.begin(MANMAN.bolt);
    }
  }

  protected override render(near: boolean, dt: number): void {
    super.render(near, dt);
    // 两只之间的电弧（领头的那只画）；横扫前摇越来越亮
    const m = this.mate;
    const on = this.lead && this.alive && !this.downed && !!m?.alive && near;
    if (!on) { this.arc.hide(); return; }
    const a = this.boneWorld('chest', _v).clone(), b = m!.boneWorld('chest', _w).clone();
    const bright = this.move.id === 'sweep' ? (this.move.stage === 'windup' ? 0.5 + 0.5 * this.move.stageK : 1) : 0.35;
    this.arc.set(a, b, bright, 0.3);
  }
}

// ───────────────────────────── 连鼓灵 ─────────────────────────────

/** 能被连鼓灵护住的：雷魅和领主 */
interface Shieldable { alive: boolean; pos: THREE.Vector3; shieldLayers: number; haste: number; center(out: THREE.Vector3): THREE.Vector3 }

export class Liangu extends Foe {
  readonly drumHp = [45, 45, 45, 45, 45, 45];
  private beatIdx = 0;
  private readonly ring: THREE.Group;
  private readonly drums: THREE.Object3D[];
  private readonly mallet: THREE.Object3D;
  private readonly flashT = [0, 0, 0, 0, 0, 0];
  private spin = 0;
  private dropped = false;

  constructor(ctx: PlayCtx, at: THREE.Vector3, hover: number, names: Record<MonsterKind, string>) {
    const host = buildLiangu();
    super('liangu', ctx, FOE_SPECS.liangu, at, hover, names, { host, body: null });
    this.ring = host.getObjectByName('ring') as THREE.Group;
    this.drums = this.ring.children.filter(c => c.name === 'drum');
    this.mallet = host.getObjectByName('mallet')!;
  }

  override charged(): boolean { return true; }
  get drumsLeft(): number { return this.drumHp.filter(h => h > 0).length; }

  override spheres(): readonly HitSphere[] {
    if (!this.host.visible) return [];
    this.host.updateMatrixWorld(true);
    this.hitList[0].c.set(this.pos.x, this.pos.y + 0.45, this.pos.z);
    this.drums.forEach((d, i) => {
      d.getWorldPosition(this.hitList[i + 1].c);
      this.hitList[i + 1].r = this.drumHp[i] > 0 ? 0.42 : 0;
    });
    return this.hitList;
  }

  override center(out: THREE.Vector3): THREE.Vector3 { return out.set(this.pos.x, this.pos.y + 0.45, this.pos.z); }

  protected override partMul(sphere: HitSphere | undefined, info: DamageInfo, dmg: number): number {
    const p = sphere?.part ?? 'core';
    if (p.startsWith('drum')) {
      const i = Number(p.slice(4));
      if (this.drumHp[i] <= 0) return 0;
      this.drumHp[i] -= dmg;
      this.flashT[i] = 0.15;
      if (this.drumHp[i] <= 0) this.breakDrum(i);
      return 0;
    }
    // 爆炸、反应、持续伤害：直接打雷心，也震鼓
    if (info.kind !== 'bullet') {
      for (let i = 0; i < 6; i++) if (this.drumHp[i] > 0 && info.from && this.drums[i].getWorldPosition(_v).distanceTo(info.from) < (info.blastR ?? 3)) { this.drumHp[i] -= dmg * 0.6; if (this.drumHp[i] <= 0) this.breakDrum(i); }
    }
    const n = this.drumsLeft;
    return n === 0 ? 2 : n < 3 ? 1 : 0.25;
  }

  private breakDrum(i: number): void {
    const ctx = this.ctx;
    this.drumHp[i] = 0;
    const d = this.drums[i];
    const at = d.getWorldPosition(new THREE.Vector3());
    d.visible = false;
    ctx.fx.burst(at, 1.2, i === 0 ? '#ff9a8a' : '#e8c890');
    ctx.fx.spray(at, ['#c8a070', '#8a6a3a', '#ffffff'], 18, 5, 3, 12, 0.6);
    ctx.say(i === 0 ? '红鼓碎了——连鼓灵不能再给同伴加速' : `连鼓灵的鼓碎了一面（还剩 ${this.drumsLeft}）`, 1.4);
    if (this.drumsLeft === 0 && !this.dropped) {
      this.dropped = true;
      this.hover = 0.5;
      this.interrupt();
      ctx.say('六面鼓全碎——雷心掉到地上了，打它！', 2);
    }
  }

  protected override onEvent(ev: string, dist: number): void {
    super.onEvent(ev, dist);
    const ctx = this.ctx;
    if (ev === 'beat') {
      // 骨槌敲一面鼓：普通鼓给一个同伴一层静电护盾，红鼓给周围同伴加速
      const live = [0, 1, 2, 3, 4, 5].filter(i => this.drumHp[i] > 0);
      if (!live.length) return;
      this.beatIdx = live[(live.indexOf(this.beatIdx) + 1 + live.length) % live.length] ?? live[0];
      const i = this.beatIdx;
      this.flashT[i] = 0.25;
      const at = this.drums[i].getWorldPosition(new THREE.Vector3());
      const mates = this.mates().filter(f => f.pos.distanceTo(this.pos) < 15);
      if (i === 0) {
        for (const f of mates) { f.haste = 6; ctx.fx.arc(at, f.center(new THREE.Vector3()), '#ff9a8a', 0.25); }
      } else {
        const f = mates.filter(m => m.shieldLayers < 3).sort((a, b) => a.shieldLayers - b.shieldLayers)[0];
        if (f) { f.shieldLayers++; ctx.fx.arc(at, f.center(new THREE.Vector3()), '#c792ff', 0.25); }
      }
    } else if (ev === 'hit' && this.move.id === 'clap') {
      ctx.fx.shockwave(this.pos.x, this.pos.z, 7, 0.4, undefined, '#c792ff');
      if (dist < 7) ctx.hurt(10, '连鼓灵的惊雷', knockFrom(ctx, this.pos.x, this.pos.z, 10, 3), 'shock');
    } else if (ev === 'release' && this.move.id === 'orb') {
      const from = this.center(new THREE.Vector3());
      ctx.fx.shot(from, _w.copy(ctx.center).sub(from).normalize().multiplyScalar(16).clone(), 0.4, '#c792ff', (at, hitP) => {
        if (hitP && !ctx.invulnerable()) ctx.hurt(8, '连鼓灵', undefined, 'shock'); else ctx.fx.burst(at, 1.2, '#c792ff');
      });
    }
  }

  /** 受益的同伴：同一处遇敌的雷魅；领主召来的连鼓灵也护着领主 */
  private mates(): Shieldable[] {
    const list: Shieldable[] = (this.enc?.foes ?? []).filter(f => f !== this && f.alive);
    const o = this.owner as Shieldable | null;
    if (o && o.alive && 'shieldLayers' in o) list.push(o);
    return list;
  }

  protected think(dt: number, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    const mates = this.mates();
    let cx: number, cz: number;
    if (!mates.length || this.dropped) {
      // 同伴都倒了（或者鼓全碎）：自己出来，保持 12 m 打雷心弹
      const d = Math.max(1, dist);
      cx = P.x + (this.pos.x - P.x) / d * 12; cz = P.z + (this.pos.z - P.z) / d * 12;
    } else {
      // 躲在同伴群的后面 8 m
      cx = mates.reduce((s, f) => s + f.pos.x, 0) / mates.length;
      cz = mates.reduce((s, f) => s + f.pos.z, 0) / mates.length;
      const d = Math.hypot(cx - P.x, cz - P.z) || 1;
      cx += (cx - P.x) / d * 8; cz += (cz - P.z) / d * 8;
    }
    this.steer(cx, cz, this.spec.speed * (this.dropped ? 0.75 : 1), dt, 1);
    const g = ctx.terrain.heightAt(this.pos.x, this.pos.z);
    this.pos.y += (g + (this.dropped ? 0.5 : 3 + 0.3 * Math.sin(ctx.time * 2)) - this.pos.y) * Math.min(1, dt * 3);
    if (this.move.busy) return;
    if (dist < 5 && this.cd <= 0 && !this.dropped) { this.cd = LIANGU.clap.cooldown!; this.begin(LIANGU.clap); return; }
    if ((!mates.length || this.dropped) && dist < 35 && (this.mem.orbCd ?? 0) <= ctx.time) { this.mem.orbCd = ctx.time + 1.8; this.begin(LIANGU.orb); return; }
    if (this.drumsLeft > 0 && mates.length && !this.dropped) this.begin(LIANGU.beat);
  }

  protected override render(near: boolean, dt: number): void {
    super.render(near, dt);
    if (!near) return;
    const t = this.ctx.time;
    const clap = this.move.id === 'clap' && this.move.stage === 'windup' ? this.move.stageK : 0;
    this.spin += dt * (1.4 + 6 * clap);
    this.ring.rotation.y = this.spin;
    this.ring.visible = this.alive || this.deadT < 0.1;
    this.ring.scale.setScalar(1 + 0.25 * (this.move.id === 'clap' && this.move.stage === 'active' ? 1 : 0));
    this.ring.rotation.z = this.anim.stagger * 0.4 * Math.sin(t * 9);
    // 骨槌转到要敲的那面鼓，敲的时候往下一砸
    const beatK = this.move.id === 'beat' ? (this.move.stage === 'windup' ? this.move.stageK : this.move.stage === 'active' ? 1 : 1 - this.move.stageK) : 0;
    // 鼓 k 在环上的角度是 k/6·2π（环绕 y 转 spin）：骨槌握柄端在雷心上方，锤头朝外斜下，敲的时候砸到那面鼓上
    const a = (this.beatIdx / 6) * Math.PI * 2 + this.spin;
    this.mallet.position.set(0, 1.1 - 0.3 * beatK, 0);
    this.mallet.rotation.set(0, -a + Math.PI / 2, 0);
    this.mallet.rotateX(0.9 + 0.75 * beatK);
    this.mallet.visible = this.alive;
    this.drums.forEach((d, i) => {
      this.flashT[i] = Math.max(0, this.flashT[i] - dt);
      const lit = Math.max(this.flashT[i] * 4, clap);
      d.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.emissive) m.emissive.setRGB(lit * 0.9, lit * 0.5, lit * 0.9); });
    });
    const core = this.host.getObjectByName('glow') as THREE.Mesh | undefined;
    if (core) core.scale.setScalar(this.dropped ? 1.6 : 1 + 0.15 * Math.sin(t * 8));
    if (this.dropped && this.alive) this.host.rotation.x += dt * 3;
  }

  protected override onDeath(): void {
    const ctx = this.ctx;
    ctx.fx.burst(this.center(_v), 2, '#ffffff');
    ctx.fx.spray(this.center(_v), ['#c8a070', '#8a6a3a', '#c792ff'], 30, 6, 3, 12, 0.8);
  }
}

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
    d.name = 'drum';
    const a = (k / 6) * Math.PI * 2;
    d.position.set(Math.cos(a) * 1.15, 0.2, Math.sin(a) * 1.15);
    d.rotation.set(Math.PI / 2, 0, a);
    d.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = (m.material as THREE.MeshStandardMaterial).clone();
      if (k === 0) (m.material as THREE.MeshStandardMaterial).color.set('#ff9a8a');
    });
    ring.add(d);
  }
  const ringBand = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.05, 6, 48).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8a6a3a', metalness: 0.6, roughness: 0.45 }));
  ringBand.position.y = 0.45;
  ring.add(ringBand);
  g.add(ring);
  const mallet = spawnStatic('SM_EnemyPart_LianguMallet');
  mallet.name = 'mallet';
  g.add(mallet);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: MAGENTA, transparent: true, opacity: 0.9 }));
  glow.name = 'glow';
  glow.position.y = 0.45;
  g.add(glow);
  return g;
}

// ───────────────────────────── 帝江 ─────────────────────────────

export class Dijiang extends Foe {
  private hopT = 0;
  private hopLen = 0.5;
  private hopH = 0.6;
  private readonly hopFrom = new THREE.Vector3();
  private readonly hopTo = new THREE.Vector3();
  private spinYaw = 0;

  constructor(ctx: PlayCtx, at: THREE.Vector3, hover: number, names: Record<MonsterKind, string>) {
    super('dijiang', ctx, FOE_SPECS.dijiang, at, hover, names);
    this.hopFrom.copy(at); this.hopTo.copy(at);
  }

  override charged(): boolean { return this.move.id === 'swell' || super.charged(); }

  override hit(dmg: number, mult: number, at: THREE.Vector3, info?: DamageInfo): number {
    const d = super.hit(dmg, mult, at, info);
    // 太轻：被打退半步
    if (d > 0 && this.alive && info?.kind === 'bullet') {
      _v.subVectors(this.pos, this.ctx.center).setY(0).normalize().multiplyScalar(0.12);
      if (this.canStand(this.pos.x + _v.x, this.pos.z + _v.z)) { this.pos.x += _v.x; this.pos.z += _v.z; this.hopTo.x += _v.x; this.hopTo.z += _v.z; }
    }
    return d;
  }

  protected override onEvent(ev: string, dist: number): void {
    super.onEvent(ev, dist);
    if (ev === 'hit' && this.move.id === 'swell') this.pop(true);
  }

  /** 炸：self = 自己胀爆（打玩家 22），否则是被打死的爆囊（打周围敌人 40、打 2.5 m 内的玩家 10）；6 m 内的帝江接着一个个引爆 */
  pop(self: boolean): void {
    const ctx = this.ctx;
    const at = this.center(new THREE.Vector3());
    ctx.fx.burst(at, 4, '#ff7ad8');
    ctx.fx.burst(at, 2.2, '#ffffff');
    ctx.fx.spray(at, ['#ff5ad8', '#ffd2f3', '#c0402a'], 40, 9, 5, 12, 0.7);
    ctx.fx.shockwave(this.pos.x, this.pos.z, 4, 0.3, undefined, '#ff7ad8');
    ctx.shake(0.3);
    const dist = Math.hypot(ctx.feet.x - this.pos.x, ctx.feet.z - this.pos.z);
    if (self) { if (dist < 4 && !ctx.invulnerable()) ctx.hurt(22, '帝江的球雷', knockFrom(ctx, this.pos.x, this.pos.z, 10, 5), 'shock'); }
    else if (dist < 2.5 && !ctx.invulnerable()) ctx.hurt(10, '帝江的爆囊', knockFrom(ctx, this.pos.x, this.pos.z, 6, 3));
    for (const o of ctx.actors()) {
      if (o === this || !o.alive) continue;
      const d = o.center(_v).distanceTo(at);
      if (!self && d < 4) o.hit(40 * ctx.player.dmgMul, 1, o.center(_w), { kind: 'blast', from: at, poise: 3, elem: undefined });
      if (o instanceof Dijiang && d < 6 && !o.mem.chain) {
        o.mem.chain = ctx.time + 0.15;
      }
    }
    if (this.alive) this.die({ kind: 'blast', from: at });
    this.host.visible = false;
  }

  protected override onDeath(info?: DamageInfo): void {
    // 被打死（不是自己胀爆）：爆囊
    if (info?.kind !== 'blast' || !this.mem.popped) {
      this.mem.popped = 1;
      if (this.host.visible) this.pop(false);
    }
  }

  override update(dt: number, near: boolean): void {
    // 连锁引爆：前一只炸开 0.15 秒后轮到这只（不管醒没醒）
    if (this.alive && this.mem.chain && this.ctx.time >= this.mem.chain) { this.mem.chain = 0; this.mem.popped = 1; this.pop(false); }
    super.update(dt, near);
  }

  protected think(dt: number, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    if (this.move.busy) {
      // 胀大：原地转圈
      this.spinYaw += dt * (6 + 14 * this.move.stageK);
      this.yaw = this.spinYaw;
      this.flash = 0.4 + 0.4 * Math.sin(this.move.t * (10 + 30 * this.move.stageK));
      this.pos.y = this.groundY(this.pos.x, this.pos.z);
      return;
    }
    if (dist < 2.5) { this.begin(DIJIANG.swell); this.mem.popped = 1; return; }
    // 歌舞：一蹦一蹦地过来，越近蹦得越快；前面有矮掩体或河就一大跳跃过去
    this.hopT += dt * (this.haste > 0 ? 1.4 : 1) * (this.status.slow > 0 ? 0.6 : 1);
    const interval = dist > 15 ? 0.5 : dist > 8 ? 0.33 : 0.25;
    if (this.hopT >= this.hopLen) {
      this.hopT = 0;
      this.hopLen = interval;
      this.hopFrom.copy(this.pos);
      const step = this.spec.speed * interval;
      const a = Math.atan2(P.x - this.pos.x, P.z - this.pos.z) + (Math.random() - 0.5) * 0.5;
      let nx = this.pos.x + Math.sin(a) * Math.min(step, Math.max(0.5, dist - 1.5)), nz = this.pos.z + Math.cos(a) * Math.min(step, Math.max(0.5, dist - 1.5));
      this.hopH = 0.6;
      if (!this.canStand(nx, nz)) {
        // 跃过：往前多跳 2.5 m，跳 2.2 m 高
        const fx = this.pos.x + Math.sin(a) * (step + 2.5), fz = this.pos.z + Math.cos(a) * (step + 2.5);
        if (this.canStand(fx, fz)) { nx = fx; nz = fz; this.hopH = 2.2; this.hopLen = interval * 1.8; }
        else {
          const wp = ctx.nav?.next(this.pos.x, this.pos.z);
          if (wp) { nx = wp[0]; nz = wp[1]; } else { nx = this.pos.x; nz = this.pos.z; }
        }
      }
      this.hopTo.set(nx, this.groundY(nx, nz), nz);
    }
    const k = Math.min(1, this.hopT / this.hopLen);
    this.pos.x = this.hopFrom.x + (this.hopTo.x - this.hopFrom.x) * k;
    this.pos.z = this.hopFrom.z + (this.hopTo.z - this.hopFrom.z) * k;
    this.pos.y = this.hopFrom.y + (this.hopTo.y - this.hopFrom.y) * k + this.hopH * 4 * k * (1 - k);
    this.anim.phase += dt * 14;
    this.anim.move = 1;
    this.anim.flap = 1;
    // 一边转圈一边往前
    this.spinYaw += dt * 5;
    this.yaw = Math.atan2(P.x - this.pos.x, P.z - this.pos.z) + Math.sin(this.spinYaw) * 1.2;
  }
}

// ───────────────────────────── 穷奇（游猎精英） ─────────────────────────────

export class Roamer extends Foe {
  private leg = 0;
  private fled = false;
  private wingDmg = 0;
  private crownDmg = 0;
  private readonly A = new THREE.Vector3();
  private readonly B = new THREE.Vector3();
  private readonly ridge = new THREE.Vector3();
  private readonly boltAt = new THREE.Vector3();
  private readonly shadow: THREE.Mesh;
  private crash = false;

  constructor(ctx: PlayCtx, at: THREE.Vector3, names: Record<MonsterKind, string>, private readonly path: [number, number][], private readonly lair: [number, number]) {
    super('qiongqi', ctx, FOE_SPECS.qiongqi, at, 0, names);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.4, depthWrite: false }));
    this.shadow.visible = false;
    this.shadow.renderOrder = 3;
    ctx.scene.add(this.shadow);
    this.extras.push(this.shadow);
  }

  override spheres(): readonly HitSphere[] {
    const list = super.spheres();
    // 翼根只在滑翔、旋斩时露出来
    const open = this.move.id === 'glide' && this.move.stage === 'active' || this.move.id === 'spin';
    for (const s of this.hitList) if (s.part === 'wing') s.mult = open ? 2 : 1, s.r = open ? 0.45 * this.spec.scale : 0;
    return list;
  }

  protected override partMul(sphere: HitSphere | undefined, _info: DamageInfo, dmg: number): number {
    if (sphere?.part === 'wing' && this.move.id === 'glide' && this.move.stage === 'active') {
      this.wingDmg += dmg * 2;
      if (this.wingDmg >= 120 && !this.crash) { this.crash = true; this.ctx.say('穷奇的翼根被打穿——坠地了！', 1.8); }
    }
    if (sphere?.part === 'crown' && this.move.id === 'absorb') {
      this.crownDmg += dmg * 2.5;
      if (this.crownDmg >= 80) { this.crownDmg = 0; this.ctx.fx.burst(this.boneWorld('crown', _v), 2, '#ff7ae6'); this.stun(1.5, '雷冠过载，眩晕'); }
    }
    return 1;
  }

  protected override prepare(id: string): void {
    if (id === 'absorb') { this.boltAt.set(this.pos.x + 4, this.pos.y, this.pos.z + 4); this.crownDmg = 0; }
  }

  /** 12 m 内落雷：去接雷 */
  absorbBolt(at: THREE.Vector3): void {
    if (!this.alive || this.state !== 'alert' || this.move.busy || this.stunned || this.fled && this.mem.flee) return;
    this.boltAt.copy(at);
    this.crownDmg = 0;
    this.begin(QIONGQI.absorb);
  }

  protected override idle(dt: number, dist: number): void {
    const ctx = this.ctx;
    // 雷暴时主动来找 70 m 内的玩家（领主战里不来搅局）
    if (ctx.weather.level > 0.5 && dist < 70 && ctx.player.alive && !ctx.actors().some(a => a.isBoss)) { this.state = 'alert'; ctx.say('雷暴里，穷奇闻着味找来了', 2.5); return; }
    const [tx, tz] = this.path[this.leg];
    const moved = this.steer(tx, tz, this.spec.speed, dt);
    this.anim.move = moved > 0 ? 0.5 : 0;
    if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < 3 || moved === 0) this.leg = (this.leg + 1) % this.path.length;
    this.anim.flap = 0;
    this.hp = Math.min(this.maxHp, this.hp + dt * 10);
    if (dist < this.spec.sight && ctx.player.alive && this.sees()) { this.state = 'alert'; ctx.say('穷奇盯上你了——看地上的影子', 2.5); }
  }

  protected override onEvent(ev: string, dist: number): void {
    super.onEvent(ev, dist);
    const ctx = this.ctx, P = ctx.feet;
    const id = this.move.id;
    if (ev === 'warn' && id === 'glide') {
      this.A.copy(this.pos);
      const lead = 0.7 + Math.min(1.6, dist / 18);
      this.B.set(P.x + (this.mem.pvx ?? 0) * lead * 0.6, 0, P.z + (this.mem.pvz ?? 0) * lead * 0.6);
      if (!this.canStand(this.B.x, this.B.z)) this.B.set(P.x, 0, P.z);
      this.B.y = this.groundY(this.B.x, this.B.z);
      this.mem.flight = Math.min(1.6, Math.max(0.8, this.A.distanceTo(this.B) / 18));
      this.warns.push(ctx.fx.telegraph(this.B.x, this.B.z, 3.5, 0.7 + this.mem.flight, () => {}, '#ffb347'));
      this.wingDmg = 0;
      this.crash = false;
    } else if (ev === 'land' && id === 'glide') {
      // 落在 0.8 秒的收招开头：3.5 m 扑杀
      this.landSlam();
    } else if (ev === 'hit' && id === 'spin') {
      ctx.fx.shockwave(this.pos.x, this.pos.z, 4, 0.25, undefined, '#ff7ae6');
      if (dist < 4.2) ctx.hurt(16, '穷奇的翼刃雷旋', knockFrom(ctx, this.pos.x, this.pos.z, 7, 3), this.charged() ? 'shock' : undefined);
    } else if ((ev === 'hit1' || ev === 'hit2') && id === 'claw') {
      this.anim.side = ev === 'hit1' ? 1 : -1;
      if (inCone(ctx, this.pos.x, this.pos.z, this.yaw, 3.2, 0.9)) ctx.hurt(10, '穷奇的爪击', knockFrom(ctx, this.pos.x, this.pos.z, 3));
    } else if (ev === 'eat' && id === 'absorb') {
      ctx.fx.bolt(this.boltAt.x, this.boltAt.z);
      ctx.fx.arc(this.boneWorld('crown', new THREE.Vector3()), this.boneWorld('crown', new THREE.Vector3()).add(new THREE.Vector3(0, 30, 0)), '#ffd6fb', 0.3, 1.5);
      this.charge(15);
      ctx.say('穷奇吞了雷——下一次扑杀带电', 1.8);
    }
  }

  private landSlam(): void {
    const ctx = this.ctx, P = ctx.feet;
    this.pos.y = this.groundY(this.pos.x, this.pos.z);
    this.shadow.visible = false;
    ctx.fx.shockwave(this.pos.x, this.pos.z, 3.5, 0.3, undefined, this.charged() ? '#ff7ae6' : '#ffd0a0');
    ctx.fx.spray(this.pos, ['#8a7a60', '#c8b898'], 16, 5, 2, 10, 0.5);
    ctx.shake(0.2);
    if (Math.hypot(P.x - this.pos.x, P.z - this.pos.z) < 3.5 && !ctx.invulnerable() && P.y < this.pos.y + 2) {
      ctx.hurt(22, '穷奇的扑杀', { x: Math.sin(this.yaw) * 10, z: Math.cos(this.yaw) * 10, up: 4 }, this.charged() ? 'shock' : undefined);
    }
  }

  /** 25 m 内比现在高 4 m 以上的山脊 / 丘顶 */
  private findRidge(): boolean {
    const ctx = this.ctx;
    let best = Infinity;
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2;
      for (let r = 6; r <= 25; r += 4) {
        const x = this.pos.x + Math.sin(a) * r, z = this.pos.z + Math.cos(a) * r;
        const h = ctx.terrain.heightAt(x, z);
        if (h - this.pos.y < 4 || !this.canStand(x, z)) continue;
        if (r < best) { best = r; this.ridge.set(x, h, z); }
      }
    }
    return best < Infinity;
  }

  protected think(dt: number, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    this.shadow.visible = false;
    if (!this.fled && this.hp < this.maxHp * 0.3 && !this.move.busy) { this.fled = true; this.mem.flee = 1; this.interrupt(); ctx.say('穷奇受伤，展翼飞回巢穴了——可以追', 2.5); }
    this.posture = this.mem.flee ? 'flee' : '';
    if (this.mem.flee) {
      this.anim.flap = 1; this.anim.move = 1;
      this.hover = 6;
      this.steer(this.lair[0], this.lair[1], 13, dt);
      this.pos.y += (ctx.terrain.heightAt(this.pos.x, this.pos.z) + 8 - this.pos.y) * Math.min(1, dt * 2);
      if (Math.hypot(this.lair[0] - this.pos.x, this.lair[1] - this.pos.z) < 4) {
        this.hover = 0; this.pos.y = this.groundY(this.pos.x, this.pos.z);
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.08 * dt);
        this.anim.flap = 0; this.anim.move = 0;
        if (this.hp > this.maxHp * 0.6 || dist < 18) this.mem.flee = 0;
      }
      return;
    }
    if (this.move.busy) {
      const id = this.move.id, st = this.move.stage;
      if (id === 'glide') {
        if (st === 'windup') { this.faceTo(this.B.x, this.B.z, dt, 8); return; }
        if (st === 'active') {
          const k = Math.min(1, this.move.stageT / this.mem.flight);
          if (this.crash) {
            // 翼根被打穿：直直掉下去，摔晕
            this.pos.y -= dt * 14;
            const g = this.groundY(this.pos.x, this.pos.z);
            if (this.pos.y <= g) { this.pos.y = g; this.move.finishActive(); this.crash = false; this.stunT = 0; this.stun(2, '坠地眩晕'); ctx.fx.spray(this.pos, ['#8a7a60'], 20, 5, 2, 10, 0.5); }
            return;
          }
          this.pos.x = this.A.x + (this.B.x - this.A.x) * k;
          this.pos.z = this.A.z + (this.B.z - this.A.z) * k;
          const base = this.A.y + (this.B.y - this.A.y) * k;
          this.pos.y = Math.max(this.groundY(this.pos.x, this.pos.z), base + 4 * 4 * k * (1 - k));
          this.anim.flap = 0.2;
          // 地上的影子：越接近落点越大越黑
          const g = ctx.terrain.heightAt(this.pos.x, this.pos.z);
          this.shadow.visible = true;
          this.shadow.position.set(this.pos.x, g + 0.12, this.pos.z);
          this.shadow.scale.setScalar(1.2 + 1.8 * k);
          (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.35 * k;
          if (k >= 1) this.move.finishActive();
          return;
        }
        this.anim.flap = 0;
        return;
      }
      if (id === 'absorb') {
        if (this.move.stage === 'windup') this.faceTo(this.boltAt.x, this.boltAt.z, dt, 6);
        return;
      }
      if (id === 'claw' && this.move.stage === 'windup') this.faceTo(P.x, P.z, dt, 10);
      return;
    }
    // 落地后被贴脸：旋斩
    if (dist < 3.8 && this.cd <= 0 && (this.mem.spinCd ?? 0) <= ctx.time && Math.random() < 0.5) {
      this.mem.spinCd = ctx.time + QIONGQI.spin.cooldown!;
      this.cd = 0.6;
      this.begin(QIONGQI.spin);
      return;
    }
    if (dist < 3 && this.cd <= 0) { this.cd = QIONGQI.claw.cooldown!; this.begin(QIONGQI.claw); return; }
    const high = this.pos.y - P.y > 3;
    // 掠空扑杀：从高处 15–35 m，或者从地面 10–25 m 起跳
    if (this.cd <= 0 && (this.mem.glideCd ?? 0) <= ctx.time && ((high && dist > 12 && dist < 35) || (!high && dist > 9 && dist < 24))) {
      this.mem.glideCd = ctx.time + QIONGQI.glide.cooldown!;
      this.cd = 1;
      this.begin(QIONGQI.glide);
      return;
    }
    // 上脊：先跑上近处的高地
    if (!this.mem.ridged && dist > 10) {
      this.mem.ridged = 1;
      if (this.findRidge()) this.mem.goRidge = 1;
    }
    if (this.mem.goRidge) {
      const moved = this.steer(this.ridge.x, this.ridge.z, 8, dt);
      this.anim.move = moved > 0 ? 1 : 0;
      if (moved === 0 || this.ridge.distanceTo(this.pos) < 2.5) this.mem.goRidge = 0;
      return;
    }
    if (dist > 80) { this.state = 'idle'; return; }
    const moved = this.steer(P.x, P.z, dist > 12 ? 8 : 5.5, dt, 2.5);
    this.anim.move = moved > 0 ? 1 : 0;
  }
}

/** 按种类造一只 */
export function createFoe(kind: MonsterKind, ctx: PlayCtx, at: THREE.Vector3, hover: number, names: Record<MonsterKind, string>): Foe {
  switch (kind) {
    case 'marmot': return new Marmot(ctx, at, hover, names);
    case 'tiangou': return new Tiangou(ctx, at, hover, names);
    case 'aoyin': case 'leiyak': return new Aoyin(kind, ctx, at, hover, names);
    case 'jufu': return new Jufu(ctx, at, hover, names);
    case 'manman': return new Manman(ctx, at, hover, names);
    case 'liangu': return new Liangu(ctx, at, hover, names);
    case 'dijiang': return new Dijiang(ctx, at, hover, names);
    case 'qiongqi': throw new Error('穷奇用 Roamer');
  }
}

export type { EncounterState };
export { Foe };
