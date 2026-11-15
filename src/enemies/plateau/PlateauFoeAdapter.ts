import * as THREE from 'three';
import type { Actor, BoltOpts, DamageInfo, Elem, HitSphere, KnockBack, PlayCtx, PlayerState } from '../../world/plateau/play/core';
import type { Cinema } from '../../world/plateau/play/cinema';
import type { ElementSystem, ReactionId } from '../../world/plateau/play/elements';
import { CombatFx } from '../../world/plateau/play/fx';
import type { EncounterState, Foe } from '../../world/plateau/play/foe';
import { Manman, Marmot, MarmotNet, Roamer, createFoe } from '../../world/plateau/play/foes';
import type { Kit } from '../../world/plateau/play/kit';
import type { NavField } from '../../world/plateau/play/nav';
import type { HeightGrid } from '../../world/plateau/grid';
import type { MonsterKind } from '../../world/plateau/spec';
import { MONSTER_NAMES } from '../../world/plateau/spec';
import type { CollisionWorld as PlateauWorld, Walker } from '../../world/plateau/walker';
import type { Weather } from '../../world/plateau/weather';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { raySphere } from '../../core/math';
import { sampleUnityHeight } from '../../world/UnityHeightSampling';
import { EnemyBase } from '../EnemyBase';

const _point = new THREE.Vector3();
const _impulse = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

interface GroupRuntime {
  encounter: EncounterState;
  net: MarmotNet | null;
}

export class PlateauCombatRuntime implements PlayCtx {
  readonly scene: THREE.Scene;
  readonly fx: CombatFx;
  readonly elements: ElementSystem;
  readonly kit: Kit;
  readonly cinema = { locked: false } as Cinema;
  readonly terrain: HeightGrid;
  readonly world: PlateauWorld;
  readonly nav: NavField;
  readonly conductors: PlayCtx['conductors'] = [];
  readonly feet = new THREE.Vector3();
  readonly center = new THREE.Vector3();
  readonly pvel = new THREE.Vector2();
  readonly player: PlayerState;
  readonly adapters = new Set<PlateauFoeAdapter>();
  readonly groups = new Set<GroupRuntime>();
  private readonly actorCache: Actor[] = [];
  private current: PlateauFoeAdapter | null = null;
  private fxFrame = -1;

  constructor(readonly ctx: GameContext) {
    this.scene = ctx.scene;
    this.fx = new CombatFx(ctx.scene, this.terrain = this.makeTerrain(), this.world = this.makeWorld());
    this.kit = { stacks: (id: string) => ctx.scrolls.stacks(id) } as unknown as Kit;
    this.nav = { next: (x: number, z: number) => this.current?.nextNavPoint(x, z) ?? null } as unknown as NavField;
    this.elements = {
      apply: (actor: Actor, elem: Elem, power: number): ReactionId | null => {
        const enemy = this.enemyFor(actor);
        if (enemy) ctx.combat.applyStatus(enemy, elem === 'fire' ? 'burn' : elem, power, undefined, { depth: 1 });
        return null;
      },
      discharge: (actor: Actor): void => {
        const origin = actor.center(new THREE.Vector3());
        const nearby = this.actors().filter(other => other !== actor && other.alive && other.group === actor.group && other.center(_point).distanceTo(origin) < 8)
          .sort((a, b) => a.center(_from).distanceToSquared(origin) - b.center(_to).distanceToSquared(origin)).slice(0, 2);
        for (const other of nearby) {
          other.charge(6);
          const target = this.enemyFor(other);
          if (target) ctx.combat.damageEnemy(target, { base: 6, element: 'shock', source: 'skill', procDepth: 1, point: other.center(new THREE.Vector3()) });
        }
      },
    } as unknown as ElementSystem;
    const self = this;
    this.player = {
      get hp() { return self.ctx.player.hp; },
      set hp(value: number) { self.ctx.player.hp = value; },
      get maxHp() { return self.ctx.player.maxHp(); },
      set maxHp(_value: number) {},
      get shield() { return self.ctx.player.shield; },
      set shield(value: number) { self.ctx.player.shield = value; },
      get maxShield() { return self.ctx.player.maxShield(); },
      set maxShield(_value: number) {},
      dmgMul: 1,
      get alive() { return self.ctx.player.alive; },
      set alive(_value: boolean) {},
      get lastHurt() { return self.ctx.player.lastDamageTime; },
      set lastHurt(_value: number) {},
    };
  }

  private makeTerrain(): HeightGrid {
    const ctx = this.ctx;
    const heightAt = (x: number, z: number): number => {
      let height = -Infinity;
      for (const field of ctx.world.heightfields) height = Math.max(height, sampleUnityHeight(field, x, z));
      return Number.isFinite(height) ? height : ctx.stage.arena?.floorY ?? 0;
    };
    const slopeAt = (x: number, z: number): number => {
      const e = 0.75;
      return Math.atan(Math.hypot((heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)));
    };
    return {
      heightAt,
      slopeAt,
      waterLevelAt: () => -Infinity,
      waterDepthAt: () => 0,
      lineOfSight: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => !ctx.world.segmentBlocked(_from.set(ax, ay, az), _to.set(bx, by, bz)),
    } as unknown as HeightGrid;
  }

  private makeWorld(): PlateauWorld {
    const ctx = this.ctx;
    return {
      groundAt: (x: number, z: number, feetY: number) => {
        const ground = ctx.world.groundHeight(x, z, feetY + 0.45, 0.25);
        return Number.isFinite(ground) ? ground : this.terrain.heightAt(x, z);
      },
      blocked: (x: number, z: number, feetY: number) => ctx.world.overlapsBody(x, feetY + 0.45, z, 0.35, 1.35) !== null,
      solidAt: (x: number, y: number, z: number) => ctx.world.sphereOverlaps(_point.set(x, y, z), 0.03),
    } as unknown as PlateauWorld;
  }

  get walker(): Walker { return { grounded: this.ctx.player.onGround } as unknown as Walker; }
  get weather(): Weather { return { level: 0 } as Weather; }
  get time(): number { return this.ctx.time.now; }
  get yaw(): number { return this.ctx.player.yaw; }

  actors(): readonly Actor[] {
    this.actorCache.length = 0;
    for (const adapter of this.adapters) {
      const foe = adapter.foe;
      if (foe.alive && foe.host.visible && foe.pos.distanceToSquared(this.feet) < 150 * 150) this.actorCache.push(foe);
    }
    return this.actorCache;
  }

  bound(x: number, z: number): number {
    const arena = this.ctx.stage.arena;
    if (!arena) return -1000;
    return Math.max(arena.minX - x, x - arena.maxX, arena.minZ - z, z - arena.maxZ);
  }

  hurt(dmg: number, source: string, knock?: KnockBack, elem?: Elem): void {
    if (this.invulnerable()) return;
    const enemy = this.current;
    this.ctx.combat.damagePlayer(dmg, elem ?? 'none', enemy, enemy?.position ?? this.feet);
    if (knock) this.ctx.player.applyImpulse(_impulse.set(knock.x, knock.up ?? 0, knock.z));
    if (source) this.lastSource = source;
  }

  private lastSource = '';

  bolt(x: number, z: number, opts: BoltOpts): void {
    const radius = opts.r ?? 3.2;
    this.fx.telegraph(x, z, radius, opts.delay ?? 1.2, () => {
      this.fx.bolt(x, z);
      if (Math.hypot(this.feet.x - x, this.feet.z - z) <= radius) this.hurt(opts.dmg ?? 18, opts.source, undefined, 'shock');
      for (const actor of this.actors()) {
        const distance = Math.hypot(actor.pos.x - x, actor.pos.z - z);
        const foe = actor as Foe;
        if (foe.kind === 'tiangou' && distance < 3) (foe as unknown as { absorbBolt(): void }).absorbBolt();
        if (foe instanceof Roamer && distance < 12) foe.absorbBolt(new THREE.Vector3(x, this.terrain.heightAt(x, z), z));
      }
      opts.onStrike?.(new THREE.Vector3(x, this.terrain.heightAt(x, z), z), null);
    }, '#ff5ad8');
  }

  say(text: string, seconds = 3): void { this.ctx.ui.toast(text, '#ff9ae8'); if (seconds <= 0) this.lastSource = ''; }
  wake(x: number, z: number, radius: number): void {
    for (const adapter of this.adapters) if (adapter.foe.alive && Math.hypot(adapter.foe.pos.x - x, adapter.foe.pos.z - z) <= radius) adapter.foe.notice();
  }
  shake(amount: number): void { this.ctx.fx.shake(amount, 0.2); }
  onFire(_at: THREE.Vector3, _r: number): void {}
  invulnerable(): boolean { return this.ctx.player.invulnerableTime > 0 || !this.ctx.player.alive; }
  dealt(_at: THREE.Vector3, _d: number, _weak: boolean, _info: DamageInfo): void {}

  add(adapter: PlateauFoeAdapter): void {
    this.adapters.add(adapter);
    let group: GroupRuntime | undefined;
    let best = 42;
    for (const candidate of this.groups) {
      const distance = Math.hypot(candidate.encounter.x - adapter.foe.home.x, candidate.encounter.z - adapter.foe.home.z);
      if (distance < best) { best = distance; group = candidate; }
    }
    if (!group) {
      const { x, z } = adapter.foe.home;
      const encounter: EncounterState = {
        id: `unity-plateau-${this.groups.size}`, site: '', x, z, r: 42, foes: [], alerted: false, cleared: false,
        burrows: [], tokens: { melee: 0, pounce: 0, ranged: 0, howl: 0 },
      };
      group = { encounter, net: null };
      this.groups.add(group);
    }
    group.encounter.foes.push(adapter.foe);
    adapter.foe.enc = group.encounter;
    if (adapter.foe instanceof Marmot) {
      const marmots = group.encounter.foes.filter((foe): foe is Marmot => foe instanceof Marmot);
      group.net?.dispose();
      group.net = new MarmotNet(this, marmots);
    }
    if (adapter.foe instanceof Manman) {
      const birds = group.encounter.foes.filter((foe): foe is Manman => foe instanceof Manman);
      for (let i = 0; i + 1 < birds.length; i += 2) {
        birds[i].pair(birds[i + 1], true);
        birds[i + 1].pair(birds[i], false);
      }
    }
  }

  updateContextOnly(adapter: PlateauFoeAdapter): void {
    this.current = adapter;
    this.feet.copy(this.ctx.player.position);
    this.center.copy(this.ctx.player.position).y += 0.95;
    this.pvel.set(this.ctx.player.velocity.x, this.ctx.player.velocity.z);
  }

  update(adapter: PlateauFoeAdapter, dt: number): void {
    this.updateContextOnly(adapter);
    adapter.syncStatuses();
    adapter.foe.notePlayerVel(this.pvel.x, this.pvel.y);
    adapter.foe.update(dt, true);
    if (this.fxFrame !== this.ctx.time.frame) {
      this.fxFrame = this.ctx.time.frame;
      for (const group of this.groups) group.net?.update(dt);
      this.fx.update(dt, this.center, this.ctx.player.radius);
    }
    this.current = null;
  }

  remove(adapter: PlateauFoeAdapter): void {
    this.adapters.delete(adapter);
    for (const group of this.groups) {
      const index = group.encounter.foes.indexOf(adapter.foe);
      if (index >= 0) group.encounter.foes.splice(index, 1);
    }
    if (this.adapters.size === 0) {
      for (const group of this.groups) group.net?.dispose();
      this.groups.clear();
      this.fx.clear();
      this.fx.group.removeFromParent();
      runtimes.delete(this.ctx);
    }
  }

  private enemyFor(actor: Actor): PlateauFoeAdapter | null {
    for (const adapter of this.adapters) if (adapter.foe === actor) return adapter;
    return null;
  }
}

const runtimes = new WeakMap<GameContext, PlateauCombatRuntime>();
function runtimeFor(ctx: GameContext): PlateauCombatRuntime {
  let runtime = runtimes.get(ctx);
  if (!runtime) { runtime = new PlateauCombatRuntime(ctx); runtimes.set(ctx, runtime); }
  return runtime;
}

export class PlateauFoeAdapter extends EnemyBase {
  readonly foe: Foe;
  readonly runtime: PlateauCombatRuntime;
  private pathAt = -Infinity;
  private readonly pathPoint = new THREE.Vector3();

  constructor(ctx: GameContext, def: EnemyDef, opts: SpawnOptions) {
    super(ctx, def, opts);
    this.runtime = runtimeFor(ctx);
    const kind = def.id as MonsterKind;
    const hover = kind === 'manman' || kind === 'liangu' ? 3 : 0;
    const at = opts.position.clone();
    if (hover > 0) at.y += hover;
    this.foe = kind === 'qiongqi'
      ? new Roamer(this.runtime, at, MONSTER_NAMES, [[at.x, at.z]], [at.x, at.z])
      : createFoe(kind, this.runtime, at, hover, MONSTER_NAMES);
    this.foe.maxHp = this.maxHp;
    this.foe.hp = this.hp;
    this.position.copy(this.foe.pos);
    this.spawnDuration = 0;
    this.runtime.add(this);
  }

  override init(): void {
    this.ctx.scene.add(this.root);
  }

  protected buildModel(): THREE.Object3D { return new THREE.Group(); }
  protected think(_dt: number): void {}

  nextNavPoint(x: number, z: number): [number, number] | null {
    if (this.timeForPath()) {
      this.pathAt = this.ctx.time.now;
      this.pathPoint.copy(this.ctx.player.position);
      this.ctx.nav.findPath(this.foe.pos, this.pathPoint, this.path);
    }
    const next = this.path.length > 1 ? this.path[1] : this.path[0];
    return next ? [next.x, next.z] : null;
  }

  private timeForPath(): boolean { return this.pathAt < this.ctx.time.now - 0.4 || this.path.length === 0; }

  syncStatuses(): void {
    for (const id of ['burn', 'shock', 'corrode'] as const) {
      const status = this.statuses.get(id);
      this.foe.status[id] = status?.remaining ?? 0;
      if (id === 'burn') this.foe.status.burnDps = status?.power ?? 0;
    }
    this.foe.status.slow = this.slowMult < 1 ? 1 : 0;
  }

  override getHeadCenter(out: THREE.Vector3): THREE.Vector3 {
    let best: HitSphere | null = null;
    for (const sphere of this.foe.spheres()) if (sphere.r > 0 && (!best || sphere.mult > best.mult)) best = sphere;
    return best ? out.copy(best.c) : this.foe.center(out);
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 { return this.foe.center(out); }

  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    if (!this.alive) return false;
    this.foe.host.updateMatrixWorld(true);
    let best = maxDist;
    let headshot = false;
    for (const sphere of this.foe.spheres()) {
      if (sphere.r <= 0) continue;
      const distance = raySphere(origin, dir, sphere.c, sphere.r);
      if (distance >= 0 && distance < best) { best = distance; headshot = sphere.mult > 1; }
    }
    if (best >= maxDist) return false;
    out.distance = best;
    out.headshot = headshot;
    return true;
  }

  override onDamaged(result: DamageResult): void {
    this.runtime.updateContextOnly(this);
    this.lastHurtTime = this.ctx.time.now;
    const point = result.request.point ?? this.foe.center(_point);
    let sphere: HitSphere | undefined;
    let distance = Infinity;
    for (const candidate of this.foe.spheres()) {
      const d = candidate.c.distanceToSquared(point);
      if (d < distance) { distance = d; sphere = candidate; }
    }
    const mult = result.request.headshot ? Math.max(1, sphere?.mult ?? 2) : 1;
    const kind = result.request.tags?.includes('explosion') ? 'blast' : result.request.source === 'status' ? 'dot' : 'bullet';
    const info: DamageInfo = {
      kind, elem: result.element === 'none' ? undefined : result.element as Elem,
      sphere, from: result.request.point,
    };
    this.foe.hp = Math.min(this.foe.maxHp, this.hp + result.dealt);
    this.foe.hit(result.dealt / mult, mult, point, info);
    this.hp = Math.max(0, this.foe.hp);
  }

  override onKilled(_result: DamageResult): void {
    this.alive = false;
    if (this.foe.alive) this.foe.die();
    this.hp = 0;
  }

  override knockback(_impulse: THREE.Vector3): void {}

  override update(dt: number): void {
    this.age += dt;
    this.runtime.update(this, dt);
    this.position.copy(this.foe.pos);
    this.hp = Math.max(0, this.foe.hp);
    if (!this.foe.alive && this.alive) {
      const result: DamageResult = {
        request: { base: 0, element: 'none', source: 'status', point: this.position.clone() },
        dealt: 0, isCrit: false, killed: true, layer: 'health', shieldBroken: false, armorBroken: false,
        element: 'none', statusApplied: null,
      };
      this.onKilled(result);
      this.ctx.events.emit('enemy:killed', { enemy: this, result });
      this.statuses.clear();
    }
    if (!this.foe.host.visible && !this.foe.alive) this.removed = true;
  }

  override dispose(): void {
    this.foe.dispose();
    this.runtime.remove(this);
    this.root.removeFromParent();
  }
}
