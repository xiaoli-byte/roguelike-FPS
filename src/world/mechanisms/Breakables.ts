/**
 * 能打碎的场景件：可破坏物（Unity Destructible.cs）、可断裂桥段（BreakableSpan.cs）、2-1 冰拱下的冰棱（Levels/IcefallIcicle.cs）。
 *
 * 可破坏物：血 = baseHp × 难度；按伤害类型（射击 / 近战 / 爆炸 / 技能 / 火 / 雷 / 蚀…，位掩码同 Unity DamageKind）吃伤害，不吃的弹「格挡」，
 *   weakTo 里的 × weakMult；碎：碰撞体当帧撤掉、外观收掉、碎片 + 声音、大件震屏；掉落灵石 / 弹药 / 生命；火药罐炸一圈；通知 targets。
 *   网页的碰撞盒只有 onHit(伤害)：子弹 / 弹体 = 射击（拿着碎刃时 = 近战）；玩家方的范围伤害（ctx.combat.explode）按爆炸 + 元素另接一层。
 * 断桥：Step（玩家踩上某段 stepDelay 秒后开始抖、再 warnTime 秒塌）/ Damage（打空整座断，从被打的那段往两头塌）/ Signal（机关信号）；
 *   塌：碰撞体当帧撤掉、桥板带重力翻滚掉下去（26 m/s²），落到下面的地面或掉了 fallLimit 米就碎掉消失；整座断时每段比前一段晚 chainDelay。
 * 冰棱：血打空就松脱（重力 26），尖碰到落点高度砸地：范围伤害 × 难度（玩家吃 playerDamage）、冰屑、震屏；换成碎冰堆。
 * 与 Unity 的差异：残骸 / 碎冰堆（rubble / fallen）在保存的场景里是停用的，场景文档没有导出——碎了之后那里是空的；导航不挖洞。
 */
import * as THREE from 'three';
import type { StaticBox } from '../Collision';
import type { Activatable, MechanismHost } from './Host';
import type { BreakableSpanData, BreakKind, DestructibleData, IcicleData } from './MechanismData';
import { PartGroup } from './Parts';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const DEG = Math.PI / 180;

/** 伤害类型（Unity Destructible.DamageKind，按位） */
export const DamageKind = {
  None: 0, Shot: 1 << 0, Melee: 1 << 1, Explosion: 1 << 2, Skill: 1 << 3, Fire: 1 << 4, Shock: 1 << 5, Corrode: 1 << 6,
  Enemy: 1 << 7, Environment: 1 << 8, Pet: 1 << 9,
  Player: 1 | 2 | 4 | 8 | 16 | 32 | 64 | 512,
} as const;

/** 材质本色（碎片） */
export function kindColor(k: BreakKind): number {
  switch (k) {
    case 'wood': return 0x8a6440;
    case 'clay': return 0xb0704a;
    case 'stone': return 0x8f8a80;
    case 'ice': return 0xbfe8ff;
    default: return 0x7d7f86;
  }
}

/** 一下伤害的倍率（Unity Destructible.Filter）：类型不在 accepts 里 = 0（格挡），在 weakTo 里 × weakMult */
export function destructibleFilter(kind: number, accepts: number, weakTo: number, weakMult: number): number {
  if ((kind & accepts) === 0) return 0;
  return (kind & weakTo) !== 0 ? Math.max(0, weakMult) : 1;
}

/** 元素 → 伤害类型位 */
export function elementKind(element: string): number {
  return element === 'fire' ? DamageKind.Fire : element === 'shock' ? DamageKind.Shock : element === 'corrode' ? DamageKind.Corrode : 0;
}

function removeBoxes(host: MechanismHost, boxes: readonly StaticBox[]): void {
  for (const b of boxes) host.ctx.world.remove(b);
}

export class Destructible implements Activatable {
  readonly scenePath: string;
  hp: number;
  readonly maxHp: number;
  broken = false;
  blocked = 0;
  taken = 0;
  brokenBy = 0;
  private readonly look: PartGroup;
  private readonly boxes: StaticBox[];
  private readonly materials: THREE.Material[] = [];
  private readonly baseColors: THREE.Color[] = [];
  private readonly center: THREE.Vector3;
  private chipAt = 0;
  private readonly brokenListeners: (() => void)[] = [];

  constructor(private readonly host: MechanismHost, readonly d: DestructibleData) {
    this.scenePath = d.scenePath;
    const level = d.scaleWithDifficulty ? host.difficulty() : 1;
    this.maxHp = this.hp = Math.max(1, Math.round(d.baseHp * level));
    const root = d.intact ?? d.scenePath;
    const roots = host.parts.rootsUnder(root).filter(r => !d.rubble || !(r.userData.scenePath as string).startsWith(d.rubble));
    this.look = new PartGroup(roots, null);
    this.boxes = host.parts.collidersUnder(root).filter(() => true);
    for (const box of this.boxes) box.onHit = (damage = 0) => this.hitByShot(damage);
    const bb = new THREE.Box3();
    for (const b of this.boxes) bb.union(new THREE.Box3(new THREE.Vector3(b.minX, b.minY, b.minZ), new THREE.Vector3(b.maxX, b.maxY, b.maxZ)));
    this.center = bb.isEmpty() ? new THREE.Vector3(d.position[0], d.position[1] + d.size * 0.5, d.position[2]) : bb.getCenter(new THREE.Vector3());
  }

  onBroken(fn: () => void): void { this.brokenListeners.push(fn); }

  onActivated(on: boolean): void {
    if (on) this.break();
  }

  /** 子弹 / 弹体 / 近战打到碰撞盒（网页只知道伤害；拿着碎刃时算近战） */
  private hitByShot(damage: number): void {
    const melee = !!this.host.ctx.weapons.bladeHud;
    this.damage(damage, melee ? DamageKind.Melee : DamageKind.Shot, this.center);
  }

  /** 吃一下伤害（kind = 伤害类型位）；返回实际扣的 */
  damage(amount: number, kind: number, at: THREE.Vector3 | null): number {
    if (this.broken || !(amount > 0)) return 0;
    const mult = destructibleFilter(kind, this.d.accepts, this.d.weakTo, this.d.weakMult);
    if (mult <= 0) {
      this.blocked++;
      this.host.ctx.fx.damageNumber(_v.copy(at ?? this.center).setY((at ?? this.center).y + 0.6), 0, { kind: 'immune' });
      return 0;
    }
    const dealt = Math.min(this.hp, amount * mult);
    this.hp -= dealt;
    this.taken++;
    const now = this.host.ctx.time.now;
    if (now >= this.chipAt) {
      this.chipAt = now + 0.08;
      this.shatterFx(at ?? this.center, Math.min(0.8, Math.max(0.3, this.d.size * 0.3)));
    }
    this.darken(1 - this.hp / this.maxHp);
    if (this.hp <= 0) this.shatter(kind);
    return dealt;
  }

  /** 越伤越暗（BaseColor → 0.55×） */
  private darken(hurt: number): void {
    if (!this.materials.length) {
      for (const m of this.look.ownMaterials()) {
        this.materials.push(m);
        this.baseColors.push((m as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color(1, 1, 1));
      }
    }
    for (let i = 0; i < this.materials.length; i++) {
      const m = this.materials[i] as THREE.MeshStandardMaterial;
      if (m.color) m.color.copy(this.baseColors[i]).multiplyScalar(1 - 0.45 * hurt);
    }
  }

  /** 直接碎（机关信号、测试） */
  break(): void {
    if (this.broken) return;
    this.hp = 0;
    this.shatter(DamageKind.None);
  }

  private shatterFx(at: THREE.Vector3, scale: number): void {
    const col = kindColor(this.d.kind);
    this.host.ctx.fx.burst(at, col, Math.round(8 + 10 * scale), 3 + 2 * scale, 0.5, 0.08 + 0.05 * scale, 9);
  }

  private shatter(by: number): void {
    if (this.broken) return;
    const ctx = this.host.ctx, d = this.d, c = this.center.clone();
    this.broken = true;
    this.brokenBy = by;
    removeBoxes(this.host, this.boxes);
    this.look.setVisible(false);
    this.shatterFx(c, d.size);
    const sound = d.kind === 'ice' ? 'shield_break' : d.kind === 'metal' ? 'hit_armor' : 'skill_earth';
    const pitch = d.kind === 'wood' ? 1.35 : d.kind === 'clay' ? 1.5 : d.kind === 'stone' ? 0.85 : 1;
    ctx.audio.play(sound, { position: c, volume: Math.min(1, Math.max(0.5, 0.45 + d.size * 0.2)), pitch });
    if (d.size >= 1.5 && ctx.player.position.distanceTo(c) < 6 + d.size * 4) ctx.fx.shake(0.12 * Math.min(3, d.size), 0.25);
    this.dropLoot(c);
    if (d.blastRadius > 0) {
      const level = this.host.difficulty();
      ctx.combat.explode(c, d.blastRadius, { base: d.blastDamage * level, element: 'none', source: 'explosion' }, { playerDamage: d.blastPlayerDamage });
      if (ctx.player.position.distanceTo(c) < d.blastRadius * 4) ctx.fx.shake(0.35, 0.35);
    }
    for (const path of d.targets) {
      const t = this.host.activatable(path);
      if (t && t !== this) t.onActivated(true);
    }
    for (const fn of this.brokenListeners) {
      try { fn(); } catch (err) { console.error('[Destructible] 碎了的回调出错', err); }
    }
  }

  private dropLoot(at: THREE.Vector3): void {
    const ctx = this.host.ctx, d = this.d;
    const rng = ctx.rng;
    if (d.coins[1] > 0) {
      const lo = Math.max(0, Math.min(d.coins[0], d.coins[1])), hi = Math.max(d.coins[0], d.coins[1]);
      const n = rng.int(lo, hi);
      if (n > 0) ctx.loot.dropCoins(at.clone(), n);
    }
    if (d.ammoChance > 0 && rng.next() < d.ammoChance) ctx.loot.dropAmmo(at.clone());
    if (d.healthChance > 0 && rng.next() < d.healthChance) ctx.loot.dropHealth(at.clone());
  }
}

// ───────────────────────────── 断桥 ─────────────────────────────

export type SegState = 'intact' | 'warning' | 'falling' | 'gone';
export const SPAN_GRAVITY = 26;

interface Seg {
  part: PartGroup;
  home: THREE.Vector3;
  boxes: StaticBox[];
  state: SegState;
  timer: number;
  vy: number;
  groundY: number;
  spin: THREE.Vector3;
  drift: THREE.Vector3;
  offset: THREE.Vector3;
  rot: THREE.Quaternion;
}

/** .NET System.Random(seed).NextDouble 的头几个数（断桥每段翻滚的种子；同 Unity 的 new System.Random(i * 7919 + 17)） */
function dotnetRandom(seed: number): () => number {
  // Knuth 减法生成器（.NET Framework System.Random 的算法）
  const MBIG = 2147483647, MSEED = 161803398;
  const seedArray = new Array<number>(56).fill(0);
  let subtraction = seed === -2147483648 ? MBIG : Math.abs(seed);
  let mj = MSEED - subtraction;
  seedArray[55] = mj;
  let mk = 1;
  for (let i = 1; i < 55; i++) {
    const ii = (21 * i) % 55;
    seedArray[ii] = mk;
    mk = mj - mk;
    if (mk < 0) mk += MBIG;
    mj = seedArray[ii];
  }
  for (let k = 1; k < 5; k++) for (let i = 1; i < 56; i++) {
    seedArray[i] -= seedArray[1 + (i + 30) % 55];
    if (seedArray[i] < 0) seedArray[i] += MBIG;
  }
  let inext = 0, inextp = 21;
  subtraction = 0;
  return () => {
    if (++inext >= 56) inext = 1;
    if (++inextp >= 56) inextp = 1;
    let r = seedArray[inext] - seedArray[inextp];
    if (r === MBIG) r--;
    if (r < 0) r += MBIG;
    seedArray[inext] = r;
    return r * (1 / MBIG);
  };
}

export class BreakableSpan implements Activatable {
  readonly scenePath: string;
  hp: number;
  readonly maxHp: number;
  fallenCount = 0;
  private readonly segs: Seg[] = [];
  private readonly hasHealth: boolean;

  constructor(private readonly host: MechanismHost, readonly d: BreakableSpanData) {
    this.scenePath = d.scenePath;
    this.hasHealth = (d.triggers & 2) !== 0;
    const level = host.difficulty();
    this.maxHp = this.hp = Math.max(1, Math.round(d.baseHp * level));
    for (const s of d.segments) {
      const part = new PartGroup(host.parts.rootsUnder(s.scenePath), s.position, s.rotation);
      const boxes = host.parts.collidersUnder(s.scenePath);
      if (this.hasHealth) for (const b of boxes) b.onHit = (damage = 0) => this.damage(damage, new THREE.Vector3(...s.position));
      this.segs.push({
        part, home: new THREE.Vector3(...s.position), boxes, state: 'intact', timer: 0, vy: 0, groundY: 0,
        spin: new THREE.Vector3(), drift: new THREE.Vector3(), offset: new THREE.Vector3(), rot: new THREE.Quaternion(),
      });
    }
  }

  get count(): number { return this.segs.length; }
  get collapsed(): boolean { return this.segs.length > 0 && this.fallenCount >= this.segs.length; }
  stateOf(i: number): SegState { return this.segs[i]?.state ?? 'gone'; }

  onActivated(on: boolean): void {
    if (on && (this.d.triggers & 4) !== 0) this.breakAll(this.d.signalOrigin);
  }

  private damage(amount: number, at: THREE.Vector3): void {
    if (this.hp <= 0 || !(amount > 0)) return;
    this.hp -= amount;
    if (this.hp > 0) return;
    let from = Math.floor(this.segs.length / 2), best = Infinity;
    for (let i = 0; i < this.segs.length; i++) {
      const dd = this.segs[i].home.distanceToSquared(at);
      if (dd < best) { best = dd; from = i; }
    }
    this.breakAll(from);
  }

  /** 整座断：从 origin 那段（−1 = 正中）开始往两头塌，每段晚 chainDelay 秒 */
  breakAll(origin = -1): void {
    if (this.segs.length === 0) return;
    if (origin < 0 || origin >= this.segs.length) origin = Math.floor(this.segs.length / 2);
    for (let i = 0; i < this.segs.length; i++) this.warn(i, Math.abs(i - origin) * Math.max(0, this.d.chainDelay));
    this.hp = 0;
    this.host.ctx.audio.play('skill_earth', { position: this.segs[origin].home, volume: 0.9, pitch: 0.7 });
  }

  /** 让第 i 段开始塌：先抖 delay + warnTime 秒 */
  warn(i: number, delay = 0): void {
    const s = this.segs[i];
    if (!s || s.state !== 'intact') return;
    s.state = 'warning';
    s.timer = -Math.max(0, delay);
    this.host.ctx.audio.play('enemy_melee', { position: s.home, volume: 0.35, pitch: 0.5 + 0.1 * (i % 3) });
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    const d = this.d;
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i];
      switch (s.state) {
        case 'intact':
          if ((d.triggers & 1) !== 0 && this.someoneOn(s)) this.warn(i, d.stepDelay);
          break;
        case 'warning': {
          s.timer += dt;
          if (s.timer < 0) break;
          const k = Math.min(1, s.timer / Math.max(0.05, d.warnTime));
          const j = 0.03 + 0.06 * k;
          // 抖：越抖越狠、往下沉一点（Unity：home + 偏移，homeRot × Euler(sin·3k, 0, sin·3k)；镜像后绕 z 取反）
          _q.setFromEuler(_e.set(Math.sin(s.timer * 53) * 3 * k * DEG, 0, -Math.sin(s.timer * 41) * 3 * k * DEG, 'YXZ'));
          s.part.set(null, _q, null, _v.set(Math.sin(s.timer * 61) * j, -0.05 * k, Math.cos(s.timer * 47) * j));
          if (s.timer >= d.warnTime) this.fall(i);
          break;
        }
        case 'falling': {
          s.vy -= SPAN_GRAVITY * dt;
          s.offset.x += s.drift.x * dt;
          s.offset.z += s.drift.z * dt;
          s.offset.y += s.vy * dt;
          s.rot.multiply(_q.setFromEuler(_e.set(s.spin.x * dt * DEG, s.spin.y * dt * DEG, s.spin.z * dt * DEG, 'YXZ')));
          s.part.set(null, s.rot, null, s.offset);
          const y = s.home.y + s.offset.y;
          if (y <= s.groundY + d.segmentThickness * 0.5 || y < s.home.y - d.fallLimit) this.land(i);
          break;
        }
      }
    }
  }

  /** 这段桥板上方站着玩家（stepByEnemies 时敌人也算） */
  private someoneOn(s: Seg): boolean {
    const half = Math.max(this.d.segmentSize[0], this.d.segmentSize[1]) * 0.5;
    const check = (p: THREE.Vector3): boolean => Math.abs(p.x - s.home.x) <= half && Math.abs(p.z - s.home.z) <= half
      && p.y >= s.home.y - 0.1 && p.y <= s.home.y + 0.7 && this.overSegment(s, p);
    if (this.host.ctx.player.alive && check(this.host.ctx.player.position)) return true;
    if (this.d.stepByEnemies) for (const e of this.host.ctx.enemies.list) if (e.alive && !e.flying && check(e.position)) return true;
    return false;
  }

  /** 精确到桥板的朝向（OverlapBox 用 homeRot）：点投到桥板的局部 XZ */
  private overSegment(s: Seg, p: THREE.Vector3): boolean {
    const inv = s.part.pivot.clone().invert();
    const l = p.clone().applyMatrix4(inv);
    return Math.abs(l.x) <= this.d.segmentSize[0] * 0.5 && Math.abs(l.z) <= this.d.segmentSize[1] * 0.5;
  }

  private fall(i: number): void {
    const s = this.segs[i], ctx = this.host.ctx;
    s.state = 'falling';
    s.part.set(null, null);
    removeBoxes(this.host, s.boxes);
    // 站在上面的地面敌人：往下推一下交给重力（网页没有 LaunchUp）
    for (const e of ctx.enemies.list) {
      if (!e.alive || e.flying || !this.overSegment(s, e.position) || Math.abs(e.position.y - s.home.y) > 1.2) continue;
      e.knockback(_v.set(0, 2.5, 0));
    }
    const g = ctx.world.groundHeight(s.home.x, s.home.z, s.home.y - 0.5);
    s.groundY = Number.isFinite(g) && g > s.home.y - 200 ? g : s.home.y - 200;
    s.vy = -0.5;
    const r = dotnetRandom(i * 7919 + 17);
    const R = (): number => r() * 2 - 1;
    // Unity 的旋转是左手系：网页镜像后绕 y / z 的角速度取反（绕 x 不变）
    s.spin.set(R() * 90, -R() * 40, -R() * 120);
    s.drift.set(-R() * 0.6, 0, R() * 0.6);
    this.fallenCount++;
    const col = kindColor(this.d.kind);
    ctx.fx.burst(s.home, col, 8, 2.5, 0.5, 0.07, 9);
    ctx.audio.play('skill_earth', { position: s.home, volume: 0.5, pitch: this.d.kind === 'ice' ? 1.5 : 1.25 });
  }

  private land(i: number): void {
    const s = this.segs[i], ctx = this.host.ctx;
    s.state = 'gone';
    const at = s.home.clone().add(s.offset);
    ctx.fx.burst(at, kindColor(this.d.kind), 22, 5, 0.7, 0.12, 9);
    if (s.offset.y > -this.d.fallLimit) ctx.audio.play('skill_earth', { position: at, volume: 0.45, pitch: 1.1 });
    s.part.setVisible(false);
  }
}

// ───────────────────────────── 冰棱 ─────────────────────────────

export class IcefallIcicle {
  hp: number;
  falling = false;
  landed = false;
  lastHits = 0;
  private speed = 0;
  private drop = 0;
  private readonly part: PartGroup | null;
  private readonly boxes: StaticBox[];
  private readonly hangY: number;

  constructor(private readonly host: MechanismHost, readonly d: IcicleData) {
    this.hp = Math.max(1, Math.round(d.baseHp * host.difficulty()));
    this.part = d.hanging ? new PartGroup(host.parts.rootsUnder(d.hanging.scenePath), d.hanging.position, d.hanging.rotation) : null;
    this.boxes = d.hanging ? host.parts.collidersUnder(d.hanging.scenePath) : [];
    this.hangY = d.hanging ? d.hanging.position[1] : d.position[1];
    for (const b of this.boxes) b.onHit = (damage = 0) => this.damage(damage);
  }

  damage(amount: number): void {
    if (this.falling || this.landed || !(amount > 0)) return;
    this.hp -= amount;
    if (this.hp <= 0) this.dropNow();
  }

  /** 松脱：开始往下掉 */
  dropNow(): void {
    if (this.falling || this.landed) return;
    this.falling = true;
    this.speed = 0;
    removeBoxes(this.host, this.boxes);
    const p = this.d.hanging?.position ?? this.d.position;
    this.host.ctx.fx.burst(new THREE.Vector3(p[0], p[1], p[2]), 0x9fdcff, 10, 2.5, 0.4, 0.08, 8);
  }

  update(dt: number): void {
    if (!this.falling || this.landed) return;
    this.speed += 26 * dt;
    const step = this.speed * dt;
    const tip = this.hangY - this.drop - this.d.tipDepth;
    if (tip - step <= this.d.groundY) {
      this.drop = this.hangY - this.d.tipDepth - this.d.groundY;
      this.part?.setWorldOffset(_v.set(0, -this.drop, 0));
      this.land();
      return;
    }
    this.drop += step;
    this.part?.setWorldOffset(_v.set(0, -this.drop, 0));
  }

  private land(): void {
    const ctx = this.host.ctx, d = this.d;
    this.falling = false;
    this.landed = true;
    const p = d.hanging?.position ?? d.position;
    const at = new THREE.Vector3(p[0], d.groundY, p[2]);
    this.part?.setVisible(false);
    const level = this.host.difficulty();
    const center = at.clone().setY(at.y + 0.6);
    this.lastHits = ctx.combat.explode(center, d.radius, { base: d.dropDamage * level, element: 'none', source: 'explosion', canCrit: false },
      { playerDamage: d.playerDamage, noFx: true, falloff: 0.4 });
    ctx.fx.ring(at.setY(at.y + 0.05), d.radius, 0x9fdcff, 0.45);
    ctx.fx.burst(center, 0xbfe8ff, 26, 5, 0.7, 0.1, 9);
    if (ctx.player.position.distanceTo(at) < 22) ctx.fx.shake(0.35, 0.3);
    ctx.audio.play('explosion', { position: at, volume: 0.7, pitch: 1.35 });
  }
}
