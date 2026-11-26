import * as THREE from 'three';
import type { Actor, BoltOpts, DamageInfo, Elem, HitSphere, KnockBack, PlayCtx, PlayerState } from '../../world/plateau/play/core';
import type { Cinema } from '../../world/plateau/play/cinema';
import type { ElementSystem, ReactionId } from '../../world/plateau/play/elements';
import { CombatFx } from '../../world/plateau/play/fx';
import { Foe, type EncounterState, type TokenKind as PackToken } from '../../world/plateau/play/foe';
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
import { attackDirector, type TokenKind } from '../AttackTokens';
import { AFFIX_NAMES, createAffix, isAffixId, type AffixController, type AffixHost } from '../Affixes';
import { BLAST_POISE, isBlastHit, isDotHit, isReactionHit } from '../HitReaction';
import { KNOCKBACK } from '../StandardEnemy';

const _point = new THREE.Vector3();
const _impulse = new THREE.Vector3();

/**
 * 群内令牌 → 全局出手名额（Unity PlateauEnemyAI.TakeToken 的 global 参数）：扑咬 / 天狗扑咬 / 獓狠挑角 = 近战，远投 / 电弹 / 雷吠 = 远程；
 * 持有上限秒数取各怪 Unity 调用的典型值（啸獭 1.5–2、帝江 1.2、獓狠 1.6；举父 2.5、蛮蛮 3.5、天狗雷吠 3）
 */
/** 玩家跑出领地多远脱战（Unity PlateauEnemyAI.LeashRange） */
const LEASH_RANGE = 90;

const GLOBAL_TOKEN: Record<PackToken, { kind: TokenKind; hold: number }> = {
  melee: { kind: 'melee', hold: 1.6 },
  pounce: { kind: 'melee', hold: 1.6 },
  ranged: { kind: 'ranged', hold: 3 },
  howl: { kind: 'ranged', hold: 3 },
};
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
    // 直接出手（Unity PlateauEnemyAI.Strike → HitPlayer）：出手者被灵宠嘲讽时打在灵体诱饵上，无效、不推；
    // 落雷（bolt）这类预警地面招不看嘲讽，照样伤
    const foe = this.current;
    if (foe?.taunted) {
      foe.decoyBlocked();
      return;
    }
    this.hurtFrom(foe, dmg, source, knock, elem);
  }

  /** 打玩家：伤害 × 出手者的伤害倍率（等级 × 精英 × 狂暴；Unity PlateauEnemyAI.Strike：dmg × DamageMult） */
  private hurtFrom(enemy: PlateauFoeAdapter | null, dmg: number, source: string, knock?: KnockBack, elem?: Elem): void {
    if (this.invulnerable()) return;
    this.ctx.combat.damagePlayer(dmg * (enemy?.damageMult ?? 1), elem ?? 'none', enemy, enemy?.position ?? this.feet);
    if (knock) this.ctx.player.applyImpulse(_impulse.set(knock.x, knock.up ?? 0, knock.z));
    if (source) this.lastSource = source;
  }

  /** 全局出手名额（主框架 AttackTokens，第四章章序夹到 2：近战 6 / 远程 4 / 重击 2） */
  globalToken(actor: Actor, kind: PackToken): boolean {
    const enemy = this.enemyFor(actor);
    if (!enemy) return true;
    const g = GLOBAL_TOKEN[kind];
    return attackDirector.tryAcquire(enemy.id, g.kind, this.ctx.time.now, g.hold, this.ctx.run.chapter);
  }

  releaseGlobalToken(actor: Actor): void {
    const enemy = this.enemyFor(actor);
    if (enemy) attackDirector.release(enemy.id);
  }

  private lastSource = '';

  bolt(x: number, z: number, opts: BoltOpts): void {
    const radius = opts.r ?? 3.2;
    const caster = this.current;
    this.fx.telegraph(x, z, radius, opts.delay ?? 1.2, () => {
      this.fx.bolt(x, z);
      if (Math.hypot(this.feet.x - x, this.feet.z - z) <= radius) this.hurtFrom(caster, opts.dmg ?? 18, opts.source, undefined, 'shock');
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

  enemyFor(actor: Actor): PlateauFoeAdapter | null {
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

/**
 * 第四章雷魅进主框架（M5）：行为仍由 world/plateau/play/foes.ts 的各 Foe 类驱动（Unity 的 AI/Plateau/* 就是照它译的，招式表逐项相同，
 * tests/enemy-framework.test.mjs 对照），这一层把它们接到和其他章同样的 EnemyBase / Registry / 定义表路径上：
 *   · 生命按难度 / 精英缩放（EnemyBase），精英体型 ×1.25（Foe.nextScale）、金环、词缀（AffixHost：迅捷的龙卷、坚盾的护盾层、爆裂、狂暴）；
 *   · 打玩家 × 伤害倍率（等级 × 精英 × 狂暴）；出手拿群内令牌之外再拿全局名额（AttackTokens）；
 *   · 元素眩晕（雷殛叠满）→ Foe 停摆；减速 / 词缀移速 / 出手速度 → Foe 的 speedMul / rateMul；
 *   · 击退走主框架的推力（Unity EnemyAI.Knockback，飞的不吃）；韧性按 HitReaction 的口径（持续伤害 0、爆炸 / 反应 ×3、弱点 ×2）。
 */
export class PlateauFoeAdapter extends EnemyBase implements AffixHost {
  readonly foe: Foe;

  /** 高原敌自己的带电（Foe.charged()）：combat/Charge 的 ChargeSystem.isCharged 一并读，火一碰就是焚雷（M8） */
  foeCharged(): boolean {
    return this.foe.charged();
  }
  readonly runtime: PlateauCombatRuntime;
  /** 词缀写入的倍率（AffixHost） */
  speedMult = 1;
  attackRate = 1;
  frenzied = false;
  affixAttackBusy = false;
  private affixCtl: AffixController | null = null;
  private pathAt = -Infinity;
  private readonly pathPoint = new THREE.Vector3();
  /** 还没推完的水平击退（m/s） */
  private readonly push = new THREE.Vector3();
  /** 上一次同步后的生命：Combat 的分层结算先扣护盾（坚盾），只有扣到生命的那部分交给 Foe */
  private lastHp: number;
  private readonly lastPos = new THREE.Vector3();

  constructor(ctx: GameContext, def: EnemyDef, opts: SpawnOptions) {
    super(ctx, def, opts);
    this.runtime = runtimeFor(ctx);
    const kind = def.id as MonsterKind;
    const hover = kind === 'manman' || kind === 'liangu' ? 3 : 0;
    const at = opts.position.clone();
    if (hover > 0) at.y += hover;
    // 精英 ×1.25（穷奇的规格本来就按精英折算过）
    Foe.nextScale = this.isElite && kind !== 'qiongqi' ? 1.25 : 1;
    try {
      this.foe = kind === 'qiongqi'
        ? new Roamer(this.runtime, at, MONSTER_NAMES, [[at.x, at.z]], [at.x, at.z])
        : createFoe(kind, this.runtime, at, hover, MONSTER_NAMES);
    } finally {
      Foe.nextScale = 1;
    }
    this.foe.maxHp = this.maxHp;
    this.foe.hp = this.hp;
    this.lastHp = this.hp;
    this.position.copy(this.foe.pos);
    this.lastPos.copy(this.position);
    this.spawnDuration = 0;
    this.runtime.add(this);
  }

  override init(): void {
    // 词缀挂件 / 金环挂在 model 下：model 跟着 Foe 的位置与朝向，按体型缩放（挂件按设计尺寸摆）
    this.root.add(this.model);
    this.model.scale.setScalar(this.sizeScale);
    this.root.rotation.y = this.facing = this.foe.yaw;
    this.ctx.scene.add(this.root);
    if (this.isElite && !this.flying) {
      const mat = this.ownMaterial(new THREE.MeshBasicMaterial({ color: 0xffc233, transparent: true, opacity: 0.85, depthWrite: false }));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 32), mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.05;
      ring.scale.setScalar(this.def.radius * 1.6);
      this.model.add(ring);
    }
    const affix = this.affix;
    if (this.isElite && isAffixId(affix)) {
      try {
        this.affixCtl = createAffix(this, affix);
        this.displayName = `精英·${AFFIX_NAMES[affix]} ${this.def.name}`;
      } catch (err) {
        console.error('[PlateauFoeAdapter] affix failed', err);
      }
    }
  }

  protected buildModel(): THREE.Object3D { return new THREE.Group(); }
  protected think(_dt: number): void {}

  // ───────────── AffixHost ─────────────

  /** 身上常驻的底色（词缀）：Foe 的自发光 = 底色 × 强度 + 闪白 */
  tintBody(color: number, intensity: number, _persistent = false): void {
    this.foe.tint.setHex(color);
    this.foe.tintIntensity = intensity;
  }

  ownMaterial<T extends THREE.Material>(m: T): T {
    this.clonedMats.push(m);
    return m;
  }

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
    // 减速按实际倍率走 speedMul（Unity SpeedMult = 元素减速的 SlowMult），不再用试玩页的固定 0.6
    this.foe.status.slow = 0;
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
    try {
      this.affixCtl?.onHurt(result);
    } catch (err) {
      console.error('[PlateauFoeAdapter] affix onHurt failed', err);
    }
    // 分层结算已经扣过护盾（坚盾的额外护盾）：只有扣到生命的那部分交给 Foe（它再按部位、眩晕易伤结算）
    const hpLoss = Math.max(0, this.lastHp - this.hp);
    if (hpLoss <= 0) {
      this.hp = this.lastHp;
      return;
    }
    const req = result.request;
    const point = req.point ?? this.foe.center(_point);
    let sphere: HitSphere | undefined;
    let distance = Infinity;
    for (const candidate of this.foe.spheres()) {
      const d = candidate.c.distanceToSquared(point);
      if (d < distance) { distance = d; sphere = candidate; }
    }
    const mult = req.headshot ? Math.max(1, sphere?.mult ?? 2) : 1;
    const dot = isDotHit(req);
    const blast = isBlastHit(req);
    const kind = dot ? 'dot' : isReactionHit(req) ? 'reaction' : blast ? 'blast' : 'bullet';
    const info: DamageInfo = {
      kind, elem: result.element === 'none' ? undefined : result.element as Elem,
      sphere, from: req.point,
      // 韧性口径同 HitReaction.PoiseDamage：持续伤害 0、爆炸 / 反应 ×3（弱点 ×2 由 Foe 按 mult 给）
      poise: dot ? 0 : blast ? BLAST_POISE : undefined,
    };
    this.foe.hp = Math.min(this.foe.maxHp, this.lastHp);
    this.foe.hit(hpLoss / mult, mult, point, info);
    this.hp = Math.max(0, this.foe.hp);
    this.lastHp = this.hp;
  }

  override onKilled(result: DamageResult): void {
    if (!this.alive) return;
    this.alive = false;
    if (this.foe.alive) this.foe.die();
    this.hp = 0;
    this.push.set(0, 0, 0);
    if (!attackDirector.purging && !result.request.tags?.includes('purge')) {
      try {
        this.affixCtl?.onDeath(result);
      } catch (err) {
        console.error('[PlateauFoeAdapter] affix onDeath failed', err);
      }
    }
  }

  /** 击退（Unity EnemyAI.Knockback）：地面的按推力推开（上限 9 m/s、8/s 衰减），冲量够大时失控；飞的不吃 */
  override knockback(impulse: THREE.Vector3): void {
    if (!this.alive || this.foe.hover > 0.5) return;
    const k = 1 - this.knockbackResist;
    if (k <= 0) return;
    const p = this.push;
    p.x += impulse.x * k;
    p.z += impulse.z * k;
    const len = Math.hypot(p.x, p.z);
    if (len > KNOCKBACK.maxPush) p.multiplyScalar(KNOCKBACK.maxPush / len);
    if (impulse.x * impulse.x + impulse.z * impulse.z > KNOCKBACK.controlLossImpulse ** 2) {
      this.controlLoss = Math.max(this.controlLoss, KNOCKBACK.controlLossTime * k);
    }
  }

  override update(dt: number): void {
    this.age += dt;
    if (this.alive) {
      // 元素眩晕（雷殛叠满、封脉）：Foe 停摆、打断招式；stunTime 由这里递减（EnemyBase.update 被整个接管了）
      if (this.stunTime > 0) {
        this.foe.applyStun(this.stunTime);
        this.stunTime = Math.max(0, this.stunTime - dt);
      }
      if (this.controlLoss > 0) this.controlLoss -= dt;
      this.foe.speedMul = this.slowMult * this.speedMult;
      this.foe.rateMul = this.attackRate;
      this.foe.held = this.affixAttackBusy;
      this.leash();
      if (this.push.x * this.push.x + this.push.z * this.push.z >= 0.0004 && dt > 0) {
        this.foe.shove(this.push.x * dt, this.push.z * dt);
        this.push.multiplyScalar(Math.exp(-KNOCKBACK.decay * dt));
      }
    }
    this.runtime.update(this, dt);
    this.position.copy(this.foe.pos);
    if (dt > 0) this.velocity.subVectors(this.position, this.lastPos).divideScalar(dt);
    this.lastPos.copy(this.position);
    this.root.rotation.y = this.facing = this.foe.yaw;
    this.hp = Math.max(0, this.foe.hp);
    this.lastHp = this.hp;
    if (this.alive) {
      try {
        this.affixCtl?.update(dt);
      } catch (err) {
        console.error('[PlateauFoeAdapter] affix update failed', err);
      }
    }
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
    // 死了：挂件（金环、词缀）跟着身体一起没
    if (!this.alive) this.model.visible = this.foe.host.visible;
    if (!this.foe.host.visible && !this.foe.alive) this.removed = true;
  }

  /**
   * 脱战（Unity PlateauEnemyAI.Think：玩家离领地 90 m 外、离它 60 m 外，不在出招）：回到没发现玩家的状态，回家、回血。
   * 穷奇游猎自己管（Unity Leashes = false）
   */
  private leash(): void {
    const f = this.foe;
    if (f.state !== 'alert' || f.move.busy || f instanceof Roamer) return;
    const p = this.ctx.player.position;
    if (Math.hypot(p.x - f.home.x, p.z - f.home.z) <= LEASH_RANGE || Math.hypot(p.x - f.pos.x, p.z - f.pos.z) <= 60) return;
    f.state = 'idle';
    if (f.enc) f.enc.alerted = false;
  }

  override dispose(): void {
    try {
      this.affixCtl?.dispose();
    } catch (err) {
      console.error('[PlateauFoeAdapter] affix dispose failed', err);
    }
    this.affixCtl = null;
    attackDirector.release(this.id);
    this.foe.dispose();
    this.runtime.remove(this);
    this.root.removeFromParent();
    for (const m of this.clonedMats) m.dispose();
    this.clonedMats.length = 0;
  }
}
