/**
 * 熔铜匠（founder，第三章 · 祝融火狱 · 炉宫的辅助）：祝融铸坊里驼背的老铸匠，背上长着一口熔铜坩埚（和身体是一个模型，
 * 流嘴从坩埚口弯过他自己的右肩），手里什么都不拿。设计见 docs/art/enemy-roster-v2.md「熔铜匠 · 浇铜甲」。
 *
 * 他不直接打人，往同伴身上浇铜甲：
 * - 躲后排：躲在同伴身后，离玩家 10–16 米。
 * - 浇铜甲（约每 7 秒）：挑 14 米内没有甲、流嘴能直接浇到的同伴（优先血厚的大个子），弓背 0.8 秒（脚下目标同伴一圈橙色
 *   预警、坩埚往前倾、流嘴口越来越亮），坩埚一倾，一道熔铜从右肩的流嘴抛物线浇到同伴头上，从头顶往下盖住全身。
 * - 趁热打铁：铜甲 = 同伴最大生命 60% 的护甲层（IEnemy.armor，伤害先打在它上面）。前 2.5 秒通红，同伴受到的伤害 ×2
 *   （一打就碎）；之后冷成青铜色，受到的伤害 ×0.5，再撑 12 秒。打穿护甲层 = 铜甲碎掉，倍率随之撤掉。
 *   铜甲是真的金属：熔铜匠死了、坩埚裂了，已经浇上的甲照样留着，到时自己剥落（SupportBuffs 登记，来源是每一次浇铸）。
 * - 泼铜（玩家进 6 米）：原地甩一圈熔铜（脚下 3 米预警圈 0.6 秒），圈内吃一下烫伤，地上留 3 米熔铜区烧 4 秒，然后他往后退开。
 * - 裂锅：背上坩埚（熔铜液面 = 弱点，头部判定挂在 bronze 骨上）累计吃到最大生命 30% 的伤害就裂开：踉跄 1.2 秒，
 *   熔铜漏一地（烫到身边的同伴和他自己，之后走到哪漏到哪），再也不能浇甲。正面被他的头和驼背挡住：绕后或者从高处打。
 *
 * 动作：短腿蹒跚（髋部左右扭）、驼背呼吸；弓背时脊柱前屈、坩埚前倾并往右肩歪、右手朝目标一指；泼铜时整个人转一圈、
 * 双臂甩开；白胡子编辫三节、围裙前后片是弹簧骨骼，跟着身体的惯性甩。
 *
 * 状态机：enter → stalk → pourWindup → pouring → stalk；flingWindup → retreat → stalk；裂锅时 crackStagger → stalk
 */
import * as THREE from 'three';
import type { DamageResult, GameContext, IEnemy, SpawnOptions } from '../../core/types';
import { clamp01, raySphere } from '../../core/math';
import { StandardEnemy } from '../StandardEnemy';
import type { ScaledEnemyDef } from '../EnemyBase';
import type { NativeBody, NativePose } from '../../assets/NativeRig';
import { attackDirector } from '../AttackTokens';
import { BuffRegistry, type Buffable, type BuffSource } from '../SupportBuffs';
import { GroundDecal } from '../bosses/Visuals';
import { zonePlayer } from '../Hazards';
import { Geo, flat, joint, part } from '../Models';
import { Sway } from '../fx/FrostSupportFx';
import { BronzeCoat, INFERNO_SUPPORT as C, MoltenStream, spawnFirePool } from '../fx/InfernoSupportFx';

export const FOUNDER_DEF: ScaledEnemyDef = {
  id: 'founder',
  name: '熔铜匠',
  hp: 150,
  speed: 3,
  radius: 0.36,
  height: 1.55,
  // 泼铜的烫伤（熔铜区每 0.5 秒 = 0.35 倍）
  damage: 10,
  coins: [3, 5],
  essence: 1,
  // 弱点 = 背上坩埚里的熔铜液面（美术 1.21 米、身后 0.13 米；判定挂在 bronze 骨上）
  headY: 1.21,
  headRadius: 0.18,
  knockbackResist: 0.55,
  color: C.molten,
  // 美术按 1.6 米制作（含流嘴），游戏里放大约 1.3 倍
  scale: 1.3,
};

/** 浇铜甲 */
export const POUR = { range: 14, windup: 0.8, flight: 0.5, cooldown: [6.5, 7.5] as const, recover: 0.35 } as const;
/** 铜甲：护甲层 = 同伴最大生命的比例；通红阶段 / 冷却后阶段的时长与受伤倍率 */
export const BRONZE = { armor: 0.6, hot: 2.5, cold: 12, hotTaken: 2, coldTaken: 0.5 } as const;
/** 泼铜 */
export const FLING = { trigger: 6, radius: 3, windup: 0.6, pool: 4, cooldown: 5, retreat: 1.4, hit: 1.2, tick: 0.35 } as const;
/** 裂锅：坩埚累计承受的伤害（相对最大生命）；漏铜 */
export const CRUCIBLE_BREAK = 0.3;
const LEAK = { radius: 2.2, life: 5, dripEvery: 1.8, dripRadius: 1.1, dripLife: 3, allyFrac: 0.03, stagger: 1.2 } as const;
/** 躲在同伴身后：离玩家的距离带（米） */
const KEEP_RANGE = [10, 16] as const;
const BEHIND_ALLIES = 3;
const ENTER_TIME = 0.8;

/** 模型空间（未缩放，three 坐标：X = 生物左，Y = 上，Z = 前）的几个点：熔铜液面中心、流嘴口、真头中心 */
const SURFACE = new THREE.Vector3(0, 1.21, -0.13);
const SPOUT_TIP = new THREE.Vector3(-0.075, 1.5, 0.05);
const HEAD_C = new THREE.Vector3(0, 1.2, 0.17);

const COL = {
  skin: 0x3a302c, crack: 0xff6a20, apron: 0x6a4a30, beard: 0xe8e2d8, clay: 0x6a4e38, rim: 0xb07a3a, cloth: 0xd8ccb0,
};

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
type Side = 'L' | 'R';
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _t = new THREE.Vector3();
const _w = new THREE.Vector3();
const _hc = new THREE.Vector3();
const _scratch: IEnemy[] = [];
const _allies: IEnemy[] = [];

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** 临界阻尼弹簧：姿态权重的缓入缓出 */
class Ease {
  x = 0;
  private v = 0;
  constructor(private readonly w: number) {}
  step(target: number, dt: number): number {
    const h = Math.min(dt, 1 / 30), w = this.w;
    this.v += (w * w * (target - this.x) - 2 * w * this.v) * h;
    this.x += this.v * h;
    return this.x;
  }
}

/** 辅助怪眼里的「同伴」：活着、不是自己、不是首领 */
export function isInfernoAlly(self: IEnemy, e: IEnemy): boolean {
  return e !== self && e.alive && !e.removed && !e.isBoss;
}

// ───────────── 铜甲登记 ─────────────

type BuffAlly = IEnemy & Buffable;
/** 一次浇铸（BuffSource）：铜甲还在 = alive。熔铜匠死了甲照样留着，所以来源不是熔铜匠本人 */
interface Casting extends BuffSource {
  alive: boolean;
  silenced: boolean;
}
const NO_MODS = { damage: 1, rate: 1, speed: 1, taken: 1 };
/** 通红阶段（受伤 ×2）与冷却后（受伤 ×0.5）各一档「赐福」：限时、同一时间认一个来源 */
export const bronzeHot = new BuffRegistry<BuffAlly, Casting>(NO_MODS, { ...NO_MODS, taken: BRONZE.hotTaken });
export const bronzeCold = new BuffRegistry<BuffAlly, Casting>(NO_MODS, { ...NO_MODS, taken: BRONZE.coldTaken });

interface BronzeState {
  casting: Casting;
  /** 这次浇上的护甲量、浇之前同伴身上原有的护甲 */
  pool: number;
  base: number;
  start: number;
  hotUntil: number;
  until: number;
  cold: boolean;
  coat: BronzeCoat | null;
  height: number;
}
const bronze = new Map<IEnemy, BronzeState>();
const takenInstalled = new WeakSet<object>();
const tickerOn = new WeakSet<object>();

function installTakenModifier(ctx: GameContext): void {
  if (takenInstalled.has(ctx)) return;
  takenInstalled.add(ctx);
  ctx.combat.addOutgoingModifier((enemy) => bronzeHot.taken(enemy as BuffAlly) * bronzeCold.taken(enemy as BuffAlly));
}

/** 同伴身上铜甲的状态（测试 / 调试用）：剩余护甲、所处阶段 */
export function bronzeOn(e: IEnemy): { left: number; pool: number; hot: boolean } | null {
  const s = bronze.get(e);
  if (!s) return null;
  return { left: THREE.MathUtils.clamp(e.armor - s.base, 0, s.pool), pool: s.pool, hot: !s.cold };
}

/** 给同伴浇上铜甲（已有铜甲时不叠加，返回 false） */
export function grantBronze(ctx: GameContext, ally: IEnemy, scale = 1): boolean {
  if (bronze.has(ally) || !ally.alive) return false;
  const now = ctx.time.now;
  installTakenModifier(ctx);
  const pool = Math.max(1, Math.round(ally.maxHp * BRONZE.armor * scale));
  const base = Math.max(0, ally.armor || 0);
  ally.maxArmor = (ally.maxArmor || 0) + pool;
  ally.armor = base + pool;
  const casting: Casting = { alive: true, silenced: false };
  bronzeHot.grantBless(ally as BuffAlly, casting, now + BRONZE.hot, now);
  const s: BronzeState = {
    casting, pool, base, start: now, hotUntil: now + BRONZE.hot, until: now + BRONZE.hot + BRONZE.cold, cold: false,
    coat: ally.root ? BronzeCoat.acquire(ally.root) : null, height: Math.max(0.6, ally.height || 1.6),
  };
  bronze.set(ally, s);
  if (!tickerOn.has(ctx)) {
    tickerOn.add(ctx);
    ctx.tasks.add((dt) => {
      tickBronze(ctx, dt);
      if (bronze.size > 0) return false;
      tickerOn.delete(ctx);
      return true;
    });
  }
  return true;
}

/** 撤掉一副铜甲：shatter = 被打碎（崩飞的铜片），否则是到时剥落 / 同伴没了 */
function endBronze(ctx: GameContext, e: IEnemy, s: BronzeState, shatter: boolean): void {
  bronze.delete(e);
  s.casting.alive = false;
  const now = ctx.time.now;
  bronzeHot.refresh(e as BuffAlly, now);
  bronzeCold.refresh(e as BuffAlly, now);
  if (e.alive && !e.removed) {
    const left = THREE.MathUtils.clamp(e.armor - s.base, 0, s.pool);
    e.armor = Math.max(0, e.armor - left);
    e.maxArmor = Math.max(e.armor, (e.maxArmor || 0) - s.pool);
    if (!attackDirector.purging) {
      e.getBodyCenter(_hc);
      if (shatter) {
        ctx.fx.burst(_hc, s.cold ? C.bronze : C.molten, 22, 4.5, 0.8, 0.08, 12);
        ctx.fx.burst(_hc, C.spark, 10, 3, 0.4, 0.06, 4);
        ctx.audio.play('shield_break', { position: _hc, volume: 0.75, pitch: s.cold ? 0.7 : 1.1 });
      } else ctx.fx.burst(_hc, C.verdigris, 10, 1.6, 0.8, 0.07, 6);
    }
  }
  s.coat?.release();
  s.coat = null;
}

/** 每帧：铜甲阶段（通红 → 冷青铜）、被打穿 / 到时、同伴死亡；更新铜甲着色层 */
function tickBronze(ctx: GameContext, _dt: number): void {
  const now = ctx.time.now;
  for (const [e, s] of [...bronze]) {
    if (!e.alive || e.removed) {
      endBronze(ctx, e, s, false);
      continue;
    }
    const left = THREE.MathUtils.clamp(e.armor - s.base, 0, s.pool);
    if (left <= 0.5) {
      endBronze(ctx, e, s, true);
      continue;
    }
    if (now >= s.until) {
      endBronze(ctx, e, s, false);
      continue;
    }
    if (!s.cold && now >= s.hotUntil) {
      // 冷却：通红那档到期，换上冷青铜那档（受伤 ×0.5）
      s.cold = true;
      bronzeCold.grantBless(e as BuffAlly, s.casting, s.until, now);
      e.getBodyCenter(_hc);
      ctx.fx.burst(_hc, 0x9a9088, 12, 1.2, 1.2, 0.12, -1.5);
    }
    if (s.coat) {
      const heat = s.cold ? Math.max(0, 1 - (now - s.hotUntil) / 0.9) : 1;
      s.coat.set(heat, (now - s.start) / 0.45, 1 - left / s.pool, now, e.position.y, s.height);
    }
  }
  bronzeHot.tick(now);
  bronzeCold.tick(now);
}

// ───────────── 熔铜匠 ─────────────

interface HandState {
  side: Side;
  axes: THREE.Vector3[];
  curl: number[];
}

export class Founder extends StandardEnemy {
  /** 裂锅（或死亡）后为 true：不再浇甲 */
  silenced = false;
  /** 坩埚挂点（白模；美术身体用 crucible 骨）与熔铜液面（弱点） */
  private crucible!: THREE.Group;
  private surface!: THREE.Mesh;
  private spoutGlow!: THREE.Mesh;
  private body!: THREE.Group;
  private classicHead!: THREE.Group;
  private classicArms: THREE.Group[] = [];
  private classicBeard!: THREE.Group;

  private pourCd: number;
  private flingCd: number;
  private windTime = 1;
  private crucibleDamage = 0;
  private hitAt = -9;
  private dripTimer = 0;
  /** 浇铸目标与液流 */
  target: IEnemy | null = null;
  private stream: MoltenStream | null = null;
  private readonly pourFrom = new THREE.Vector3();
  private readonly pourTo = new THREE.Vector3();
  private targetDecal: GroundDecal | null = null;
  private flingDecal: GroundDecal | null = null;
  private poured = false;
  private spin = 0;
  /** 真头判定点（head 骨局部偏移，afterInit 时算） */
  private readonly realHeadLocal = new THREE.Vector3();
  private readonly spoutLocal = new THREE.Vector3();

  private readonly hands: HandState[] = [];
  private readonly eHunch = new Ease(6);
  private readonly ePoint = new Ease(7);
  private readonly eFling = new Ease(9);
  private readonly eStagger = new Ease(10);
  private readonly lean = new Sway(14, 5.5);
  private readonly beard = new Sway(20, 3.2);
  private readonly apron = new Sway(18, 3.5);
  private readonly prevVel = new THREE.Vector3();

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, FOUNDER_DEF, opts);
    this.pourCd = ctx.rng.range(2, 3.5);
    this.flingCd = ctx.rng.range(1, 2);
    this.deathDuration = 1.2;
    this.walkScale = 0.6;
    this.stepRate = 2.2;
    this.setState('enter');
    installTakenModifier(ctx);
  }

  protected override buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const skin = flat(COL.skin, { rough: 0.9 }), apron = flat(COL.apron), beard = flat(COL.beard), clay = flat(COL.clay, { rough: 0.85 });
    const rim = flat(COL.rim, { metal: 0.6, rough: 0.45 }), cloth = flat(COL.cloth);
    // 白模：短腿、驼背宽身、围裙、秃头 + 白胡子辫、粗胳膊大手；背上坩埚（流嘴弯过右肩 = -X）
    const body = joint(root, 0, 0, 0);
    this.body = body;
    for (const s of [1, -1]) {
      part(body, Geo.cyl(0.1, 0.11, 0.42, 6, 'bottom'), skin, s * 0.15, 0.05, 0.02);
      part(body, Geo.box(0.16, 0.08, 0.26), skin, s * 0.16, 0.04, 0.08);
      part(body, Geo.cyl(0.1, 0.1, 0.08, 6), cloth, s * 0.16, 0.14, 0.03);
    }
    part(body, Geo.box(0.56, 0.55, 0.42), skin, 0, 0.78, 0.04);
    part(body, Geo.box(0.42, 0.42, 0.04), apron, 0, 0.5, 0.27);
    const head = joint(body, 0, 1.08, 0.13);
    this.classicHead = head;
    part(head, Geo.ico(0.15, 1), skin, 0, 0.12, 0.03);
    part(head, Geo.cone(0.05, 0.1, 5, 'bottom'), beard, 0, 0.27, 0);
    const bj = joint(head, 0, 0.02, 0.12);
    this.classicBeard = bj;
    part(bj, Geo.cone(0.1, 0.36, 6), beard, 0, -0.14, 0.02).rotation.x = Math.PI;
    for (const s of [1, -1]) {
      const arm = joint(body, s * 0.24, 0.98, 0.02);
      part(arm, Geo.cyl(0.09, 0.08, 0.3, 6), skin, s * 0.04, -0.16, 0);
      part(arm, Geo.cyl(0.1, 0.1, 0.12, 6), cloth, s * 0.07, -0.32, 0);
      part(arm, Geo.box(0.14, 0.2, 0.16), skin, s * 0.1, -0.48, -0.02);
      this.classicArms.push(arm);
    }
    // 坩埚：挂点在上背（倾倒的转轴），液面是弱点
    const cru = joint(root, 0, 0.92, -0.06);
    cru.name = 'crucible';
    this.crucible = cru;
    part(cru, Geo.cyl(0.21, 0.15, 0.5, 10, 'bottom'), clay, 0, -0.12, -0.13);
    part(cru, Geo.torus(0.21, 0.035, 6, 16), rim, 0, 0.36, -0.13).rotation.x = Math.PI / 2;
    // 流嘴：从坩埚口右侧升起、弯过右肩
    part(cru, Geo.cyl(0.04, 0.045, 0.34, 6, 'bottom'), rim, -0.1, 0.28, -0.04);
    part(cru, Geo.cyl(0.035, 0.04, 0.16, 6), rim, -0.08, 0.6, 0.02).rotation.x = 1.0;
    this.surface = this.glowPart(cru, Geo.cyl(0.17, 0.17, 0.02, 14), C.molten, C.moltenHot,
      SURFACE.x, SURFACE.y - 0.92, SURFACE.z + 0.06, 0);
    this.spoutGlow = this.glowPart(cru, Geo.ico(0.05, 1), 0x000000, C.moltenHot,
      SPOUT_TIP.x, SPOUT_TIP.y - 0.92, SPOUT_TIP.z + 0.06, 1, true);
    this.setHeadAnchor(this.surface, 0, 0, 0);
    return root;
  }

  protected override afterInit(): void {
    const n = this.nativeBody;
    if (!n) return;
    this.body.visible = false;
    this.crucible.visible = false;
    // 弱点挂到熔铜液面骨上；真头、流嘴口按绑定姿势算好骨骼局部偏移
    const P = n.pose;
    const surf = P.bone('bronze');
    if (surf) this.setHeadAnchor(surf, 0, 0, 0);
    this.root.updateMatrixWorld(true);
    const host = this.model.children[0];
    const head = P.bone('head');
    if (head) head.worldToLocal(host.localToWorld(this.realHeadLocal.copy(HEAD_C)));
    const sp = P.bone('spout_tip') ?? P.bone('crucible');
    if (sp) sp.worldToLocal(host.localToWorld(this.spoutLocal.copy(SPOUT_TIP)));
    this.initHands(P);
  }

  /** 绑定姿势下每根手指的弯曲轴：手指方向 × 掌心法线（双手自然下垂，掌心朝身体） */
  private initHands(P: NativePose): void {
    for (const side of ['L', 'R'] as const) {
      const m = side === 'L' ? 1 : -1;
      const palm = _w.set(-m, 0, 0);
      const axes: THREE.Vector3[] = [];
      for (const f of FINGERS) {
        const a = P.restPosition(`${f}_1_${side}`), b = P.restPosition(`${f}_2_${side}`);
        const ax = new THREE.Vector3(0, 0, m);
        if (a && b) {
          ax.crossVectors(_v.subVectors(b, a).normalize(), palm);
          if (ax.lengthSq() < 1e-6) ax.set(0, 0, m);
          ax.normalize();
        }
        axes.push(ax);
      }
      this.hands.push({ side, axes, curl: [0.25, 0.25, 0.25, 0.25, 0.25] });
    }
  }

  protected override cancelAttack(): void {
    this.glowTarget[0] = 0;
    this.glowTarget[1] = 0;
    this.targetDecal?.release();
    this.targetDecal = null;
    this.flingDecal?.release();
    this.flingDecal = null;
    this.stream?.release();
    this.stream = null;
    this.target = null;
    this.spin = 0;
    if (this.state !== 'stalk' && this.state !== 'idle' && this.state !== 'enter' && this.state !== 'crackStagger') this.setState('stalk');
  }

  // ───────────── AI ─────────────

  protected override ai(dt: number): void {
    const rate = this.attackRate;
    this.pourCd -= dt * rate;
    this.flingCd -= dt * rate;
    if (this.silenced) this.drip(dt);
    switch (this.state) {
      case 'enter': {
        this.stopMoving();
        this.facePlayer(2, dt);
        if (this.stateTime >= ENTER_TIME) this.setState('stalk');
        break;
      }
      case 'stalk': {
        this.glowTarget[0] = this.silenced ? 0 : 0.2 + 0.1 * Math.sin(this.age * 2);
        if (this.flingCd <= 0 && this.distToPlayerXZ() < FLING.trigger && this.verticalReach(2)
          && this.requestAttack('melee', FLING.windup + 0.6)) {
          this.beginFling();
          break;
        }
        this.positionBehindAllies();
        if (!this.silenced && this.pourCd <= 0) {
          const t = this.pickPourTarget();
          if (t) {
            this.beginPour(t);
            break;
          }
          this.pourCd = 0.6;
        }
        this.facePlayer(3, dt);
        break;
      }
      case 'pourWindup': {
        this.stopMoving();
        const t = this.target;
        if (!t || !t.alive || bronze.has(t)) {
          this.pourCd = 1;
          this.cancelAttack();
          break;
        }
        this.faceTowards(t.position, 3, dt);
        const k = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.5 + 0.5 * k;
        this.glowTarget[1] = k;
        if (this.targetDecal) {
          this.targetDecal.circle(t.position.x, t.position.y, t.position.z, Math.max(0.9, t.radius * 2.2), Math.max(0.5, t.radius * 2.2) - 0.35);
          this.targetDecal.fill = k;
          this.targetDecal.time = this.age;
        }
        if (this.stateTime >= this.windTime) this.startStream();
        break;
      }
      case 'pouring': {
        this.stopMoving();
        const t = this.target;
        if (t) this.faceTowards(t.position, 3, dt);
        this.updateStream();
        if (this.stateTime >= POUR.flight + POUR.recover) {
          this.stream?.release();
          this.stream = null;
          this.target = null;
          this.glowTarget[1] = 0;
          this.pourCd = this.ctx.rng.range(POUR.cooldown[0], POUR.cooldown[1]);
          this.setState('stalk');
        }
        break;
      }
      case 'flingWindup': {
        this.stopMoving();
        const k = clamp01(this.stateTime / this.windTime);
        this.glowTarget[0] = 0.6 + 0.4 * k;
        if (this.flingDecal) {
          this.flingDecal.circle(this.position.x, this.position.y, this.position.z, FLING.radius);
          this.flingDecal.fill = k;
          this.flingDecal.time = this.age;
        }
        if (this.stateTime >= this.windTime) this.releaseFling();
        break;
      }
      case 'retreat': {
        // 泼完往后退开：背离玩家、略带横移
        const pl = this.ctx.player.position;
        const dx = this.position.x - pl.x, dz = this.position.z - pl.z;
        this.setMove(dx + dz * 0.3 * this.strafeSign, dz - dx * 0.3 * this.strafeSign, this.speed * 1.3);
        this.facePlayer(2, dt);
        if (this.stateTime >= FLING.retreat) this.setState('stalk');
        break;
      }
      case 'crackStagger': {
        this.stopMoving();
        if (this.stateTime >= LEAK.stagger) this.setState('stalk');
        break;
      }
      default:
        this.setState('stalk');
    }
  }

  /** 躲在同伴身后：同伴质心再往远离玩家的方向退几米，离玩家至少 10 米；没有同伴就和玩家保持 10–16 米 */
  private positionBehindAllies(): void {
    const pl = this.ctx.player.position;
    const allies = this.alliesWithin(22);
    if (allies.length === 0) {
      this.keepRange(KEEP_RANGE[0], KEEP_RANGE[1], this.speed);
      return;
    }
    _q.set(0, 0, 0);
    for (const e of allies) _q.add(e.position);
    _q.multiplyScalar(1 / allies.length);
    _v.set(_q.x - pl.x, 0, _q.z - pl.z);
    const d = _v.length() || 1;
    _q.addScaledVector(_v, BEHIND_ALLIES / d);
    _v.set(_q.x - pl.x, 0, _q.z - pl.z);
    if (_v.length() < KEEP_RANGE[0]) _q.set(pl.x, _q.y, pl.z).addScaledVector(_v.normalize(), KEEP_RANGE[0]);
    if (Math.hypot(_q.x - this.position.x, _q.z - this.position.z) > 1.8) this.navigate(_q, this.speed, 1.2);
    else this.stopMoving();
  }

  private alliesWithin(range: number): IEnemy[] {
    _allies.length = 0;
    const list = this.ctx.enemies.queryRadius(this.position, range, _scratch);
    for (const e of list) if (isInfernoAlly(this, e)) _allies.push(e);
    _scratch.length = 0;
    return _allies;
  }

  // ───────────── 浇铜甲 ─────────────

  /** 14 米内、没有铜甲、不飞、流嘴到它头顶之间没有遮挡的同伴里，最大生命最高的那个 */
  pickPourTarget(): IEnemy | null {
    let best: IEnemy | null = null;
    this.spoutWorld(_p);
    for (const e of this.alliesWithin(POUR.range)) {
      if (e.flying || bronze.has(e) || e instanceof Founder) continue;
      if (Math.hypot(e.position.x - this.position.x, e.position.z - this.position.z) > POUR.range) continue;
      _q.set(e.position.x, e.position.y + Math.max(0.6, e.height * 0.9), e.position.z);
      if (this.ctx.world.segmentBlocked(_p, _q)) continue;
      if (!best || e.maxHp > best.maxHp) best = e;
    }
    return best;
  }

  private beginPour(t: IEnemy): void {
    this.target = t;
    this.windTime = this.windup(POUR.windup, 0.5);
    this.setState('pourWindup');
    this.targetDecal?.release();
    this.targetDecal = GroundDecal.acquire(this.ctx.stageGroup, C.molten);
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.45, pitch: 0.8 });
  }

  /** 前摇结束：坩埚一倾，熔铜从流嘴抛出去 */
  private startStream(): void {
    const t = this.target;
    this.targetDecal?.release();
    this.targetDecal = null;
    if (!t) return;
    this.spoutWorld(this.pourFrom);
    this.pourTo.set(t.position.x, t.position.y + Math.max(0.6, t.height * 0.95), t.position.z);
    this.stream = MoltenStream.acquire(this.ctx.stageGroup);
    const d = this.pourFrom.distanceTo(this.pourTo);
    this.stream.setArc(this.pourFrom, this.pourTo, 1 + d * 0.12);
    this.poured = false;
    this.setState('pouring');
    this.ctx.audio.play('skill_fire', { position: this.pourFrom, volume: 0.7, pitch: 0.7 });
    this.ctx.fx.burst(this.pourFrom, C.spark, 10, 2, 0.4, 0.06, 4);
  }

  private updateStream(): void {
    const s = this.stream, t = this.target;
    const u = this.stateTime / POUR.flight;
    if (s) {
      // 液流跟着同伴走（落点是它此刻的头顶），起点跟着流嘴
      if (t && t.alive) this.pourTo.set(t.position.x, t.position.y + Math.max(0.6, t.height * 0.95), t.position.z);
      this.spoutWorld(this.pourFrom);
      const d = this.pourFrom.distanceTo(this.pourTo);
      s.setArc(this.pourFrom, this.pourTo, 1 + d * 0.12);
      s.update(Math.min(1, u * 1.1), Math.max(0, (this.stateTime - 0.28) / POUR.flight), this.age, 0.08 * this.sizeScale);
    }
    if (!this.poured && u >= 1) {
      this.poured = true;
      if (t && t.alive && grantBronze(this.ctx, t, this.isElite ? 1.3 : 1)) {
        t.getBodyCenter(_q);
        this.ctx.fx.burst(this.pourTo, C.moltenHot, 18, 3, 0.5, 0.08, 9);
        this.ctx.fx.burst(_q, C.molten, 14, 2, 0.7, 0.07, 6);
        this.ctx.audio.play('burn_tick', { position: _q, volume: 0.8, pitch: 0.6 });
      }
    }
  }

  /** 流嘴口的世界坐标（美术：spout_tip 骨；白模：流嘴发光件） */
  spoutWorld(out: THREE.Vector3): THREE.Vector3 {
    const sp = this.nativeBody?.pose.bone('spout_tip') ?? this.nativeBody?.pose.bone('crucible');
    if (sp) {
      sp.updateWorldMatrix(true, false);
      return sp.localToWorld(out.copy(this.spoutLocal));
    }
    this.spoutGlow.updateWorldMatrix(true, false);
    return this.spoutGlow.getWorldPosition(out);
  }

  // ───────────── 泼铜 ─────────────

  private beginFling(): void {
    this.windTime = this.windup(FLING.windup, 0.4);
    this.setState('flingWindup');
    this.flingDecal?.release();
    this.flingDecal = GroundDecal.acquire(this.ctx.stageGroup, C.ember);
    this.ctx.audio.play('telegraph', { position: this.position, volume: 0.5, pitch: 1.1 });
  }

  /** 甩一圈：圈内烫一下，地上留 3 米熔铜区烧 4 秒，然后退开 */
  private releaseFling(): void {
    const ctx = this.ctx;
    this.flingDecal?.release();
    this.flingDecal = null;
    this.releaseAttack();
    _p.set(this.position.x, this.position.y + 0.02, this.position.z);
    zonePlayer(ctx, _p, FLING.radius, this.def.damage * FLING.hit * this.damageMult, 'fire', this, 1.6);
    spawnFirePool(ctx, _p, FLING.radius, FLING.pool, { playerDamage: this.def.damage * FLING.tick * this.damageMult, allyFrac: 0, source: this });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      _q.set(_p.x + Math.sin(a) * FLING.radius * 0.7, _p.y + 0.9, _p.z + Math.cos(a) * FLING.radius * 0.7);
      ctx.fx.burst(_q, C.molten, 3, 2.5, 0.5, 0.07, 9);
    }
    ctx.fx.ring(_p, FLING.radius, C.molten, 0.4);
    ctx.audio.play('skill_fire', { position: _p, volume: 0.8, pitch: 0.9 });
    this.flingCd = FLING.cooldown;
    this.glowTarget[0] = 0.2;
    this.setState('retreat');
  }

  // ───────────── 受击 / 裂锅 / 死亡 ─────────────

  /** 坩埚液面是弱点；真头另加一个判定球（算打身体）：从正面平视时头和驼背挡住坩埚 */
  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    const hit = super.raycastHit(origin, dir, maxDist, out);
    if (!this.alive) return hit;
    this.realHead(_hc);
    const t = raySphere(origin, dir, _hc, 0.2 * this.sizeScale);
    if (t >= 0 && t <= maxDist && (!hit || t < out.distance - 0.03)) {
      out.distance = t;
      out.headshot = false;
      return true;
    }
    return hit;
  }

  realHead(out: THREE.Vector3): THREE.Vector3 {
    const b = this.nativeBody?.pose.bone('head');
    if (b) {
      b.updateWorldMatrix(true, false);
      return b.localToWorld(out.copy(this.realHeadLocal));
    }
    this.classicHead.updateWorldMatrix(true, false);
    return this.classicHead.localToWorld(out.set(0, 0.12, 0.03));
  }

  protected override onHurt(r: DamageResult): void {
    super.onHurt(r);
    if (this.silenced || !this.alive || !r.request.headshot) return;
    this.hitAt = this.age;
    this.crucibleDamage += r.dealt;
    this.glowLevel[0] = 1;
    if (this.crucibleDamage >= this.maxHp * CRUCIBLE_BREAK) this.crackCrucible();
    else this.ctx.audio.play('hit_armor', { position: this.getHeadCenter(_p), volume: 0.7, pitch: 0.8 });
  }

  /** 坩埚累计受伤占裂锅阈值的比例（测试 / 调试用） */
  get crucibleCrack(): number {
    return clamp01(this.crucibleDamage / (this.maxHp * CRUCIBLE_BREAK));
  }

  private crackCrucible(): void {
    const ctx = this.ctx;
    this.silenced = true;
    this.cancelAttack();
    this.releaseAttack();
    this.getHeadCenter(_p);
    ctx.fx.burst(_p, C.molten, 26, 4, 0.9, 0.08, 10);
    ctx.fx.burst(_p, C.slag, 14, 3, 0.8, 0.08, 12);
    ctx.audio.play('shield_break', { position: _p, volume: 1, pitch: 0.6 });
    ctx.audio.play('boss_roar', { position: this.position, volume: 0.35, pitch: 1.8 });
    // 熔铜漏一地：烫玩家、身边的同伴和他自己
    _q.set(this.position.x, this.position.y + 0.02, this.position.z);
    spawnFirePool(ctx, _q, LEAK.radius, LEAK.life, { playerDamage: this.def.damage * FLING.tick * this.damageMult, allyFrac: LEAK.allyFrac, source: this });
    this.dripTimer = LEAK.dripEvery;
    this.setState('crackStagger');
  }

  /** 裂锅后走到哪漏到哪：每隔一阵在脚下留一小摊 */
  private drip(dt: number): void {
    this.dripTimer -= dt;
    if (this.dripTimer > 0) return;
    this.dripTimer = LEAK.dripEvery;
    _q.set(this.position.x, this.position.y + 0.02, this.position.z);
    spawnFirePool(this.ctx, _q, LEAK.dripRadius, LEAK.dripLife, { playerDamage: this.def.damage * 0.25 * this.damageMult, allyFrac: LEAK.allyFrac * 0.5, source: this });
  }

  protected override onDeath(r: DamageResult): void {
    super.onDeath(r);
    this.silenced = true;
    if (attackDirector.purging) return;
    const ctx = this.ctx;
    this.getHeadCenter(_p);
    ctx.fx.burst(_p, C.molten, 24, 3.5, 1.0, 0.08, 9);
    ctx.fx.burst(this.getBodyCenter(_q), C.slag, 16, 2.5, 1.2, 0.09, 6);
    _q.set(this.position.x, this.position.y + 0.02, this.position.z);
    spawnFirePool(ctx, _q, 1.8, 3, { playerDamage: this.def.damage * 0.25 * this.damageMult, allyFrac: 0, source: null });
  }

  // ───────────── 动画 ─────────────

  private deathT = 0;

  /** 死亡：向前跪倒，坩埚压着他扑在地上，冒着烟冷掉 */
  protected override animateDeath(t: number): void {
    const dt = Math.max(0, (t - this.deathT) * this.deathDuration);
    this.deathT = t;
    this.model.rotation.x = 0.9 * smooth(t / 0.6);
    this.model.position.y = -0.25 * smooth(t / 0.6) * this.sizeScale;
    const fade = smooth((t - 0.6) / 0.4);
    this.model.scale.setScalar(Math.max(0.01, this.sizeScale * (1 - fade)));
    if (dt > 0) this.pose(dt);
    if (Math.random() < dt * 20) {
      this.getBodyCenter(_p);
      this.ctx.fx.burst(_p, 0x6a625a, 1, 0.8, 1.2, 0.1, -0.8);
    }
  }

  protected override pose(dt: number): void {
    const st = this.state;
    const cast = clamp01(this.stateTime / Math.max(0.01, this.windTime));
    this.eHunch.step(st === 'pourWindup' ? 0.6 + 0.4 * cast : st === 'pouring' ? (this.stateTime < POUR.flight ? 1 : 0.4) : 0, dt);
    this.ePoint.step(st === 'pourWindup' || st === 'pouring' ? 1 : 0, dt);
    this.eFling.step(st === 'flingWindup' ? 1 : 0, dt);
    this.eStagger.step(st === 'crackStagger' ? 1 : 0, dt);
    // 泼铜：前摇后半段整个人转一圈（模型自转，朝向不变）
    if (st === 'flingWindup') this.spin = Math.PI * 2 * smooth((cast - 0.35) / 0.65);
    else this.spin *= Math.exp(-10 * dt);
    if (this.spin < 1e-3) this.spin = 0;
    this.model.rotation.y = this.spin;
    if (this.nativeBody) this.poseNative(this.nativeBody, dt);
    else this.poseClassic(dt);
    // 熔铜液面：平时慢慢翻滚发亮，弓背时更亮；被打中闪一下；裂锅后暗下去
    const glow = this.nativeBody?.glowShell;
    if (glow) {
      const hit = Math.max(0, 1 - (this.age - this.hitAt) * 5);
      glow.opacity = this.alive && !this.silenced ? 0.35 + 0.15 * Math.sin(this.age * 3) + 0.4 * this.eHunch.x + 0.5 * hit : 0.05;
    }
  }

  /**
   * 美术骨骼动画（creature_rigs/SK_Enemy_Founder.json）。模型空间：X = 生物左侧，Y = 上，Z = 前。
   * - 身体：驼背呼吸、短腿蹒跚（髋部左右扭、身体随步子左右晃），随移动前倾；弓背浇铸时脊柱前屈、头抬起盯着目标。
   * - 坩埚：浇铸时前倾并往右肩歪（流嘴压低对准目标），平时随步子轻轻颠；泼铜时往外甩；裂锅后踉跄时乱晃。
   * - 手：双手自然下垂半握；浇铸时右手朝目标一指；泼铜时双臂甩开；踉跄时双手往背后够坩埚。
   * - 胡子辫三节、围裙前后片按惯性甩（弹簧）。
   */
  private poseNative(n: NativeBody, dt: number): void {
    const P = n.pose;
    P.reset();
    const t = this.age;
    const sf = Math.sin(this.facing), cf = Math.cos(this.facing);
    const vz = this.velocity.x * sf + this.velocity.z * cf, vx = this.velocity.x * cf - this.velocity.z * sf;
    const h = Math.max(dt, 1e-3);
    const az = ((this.velocity.x - this.prevVel.x) * sf + (this.velocity.z - this.prevVel.z) * cf) / h;
    const ax = ((this.velocity.x - this.prevVel.x) * cf - (this.velocity.z - this.prevVel.z) * sf) / h;
    this.prevVel.copy(this.velocity);
    this.lean.step(THREE.MathUtils.clamp(vz * 0.05, -0.12, 0.2), THREE.MathUtils.clamp(-vx * 0.05, -0.15, 0.15), dt);
    this.beard.step(THREE.MathUtils.clamp(-az * 0.015 - vz * 0.05, -0.5, 0.5), THREE.MathUtils.clamp(ax * 0.015 + vx * 0.05, -0.4, 0.4), dt);
    this.apron.step(THREE.MathUtils.clamp(-az * 0.012 - vz * 0.04, -0.4, 0.4), THREE.MathUtils.clamp(ax * 0.012, -0.3, 0.3), dt);
    const hunch = this.eHunch.x, point = this.ePoint.x, fling = this.eFling.x, stag = this.eStagger.x;
    const calm = (1 - hunch) * (1 - fling) * (1 - stag);
    const breath = Math.sin(t * 1.2);
    const tremble = stag * Math.sin(t * 37) * 0.04;
    const ph = this.walkPhase, amp = this.walkAmp;
    const hurt = this.hurtKick;

    // 身体：蹒跚（髋扭 + 左右晃），驼背呼吸，弓背前屈
    const waddle = Math.sin(ph) * amp;
    P.rotate('hips', AX, this.lean.x);
    P.rotate('hips', AZ, this.lean.y + 0.12 * waddle);
    P.rotate('hips', AY, 0.1 * waddle);
    P.rotate('spine', AX, 0.03 * breath * calm + 0.18 * hunch - 0.1 * hurt + 0.1 * stag);
    P.rotate('spine', AZ, -0.08 * waddle + tremble);
    P.rotate('chest', AX, 0.02 * breath + 0.16 * hunch + 0.12 * stag);
    P.rotate('chest', AY, 0.25 * fling * Math.sin(t * 9));
    // 头：看玩家 / 目标；弓背时抬头（抵消前屈），踉跄时乱晃
    const pl = this.target ? this.target.position : this.ctx.player.position;
    let dyaw = Math.atan2(pl.x - this.position.x, pl.z - this.position.z) - this.facing;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const look = THREE.MathUtils.clamp(dyaw, -0.35, 0.35) * (1 - stag);
    P.rotate('neck', AY, look * 0.5);
    P.rotate('head', AY, look * 0.5);
    P.rotate('neck', AX, -0.22 * hunch - 0.05 * breath * calm);
    P.rotate('head', AX, -0.12 * hunch + 0.2 * stag + tremble * 3);
    P.rotate('head', AZ, 0.06 * Math.sin(t * 0.6) * calm + tremble * 2);

    // 坩埚：前倾 + 往右肩歪（右 = -X：绕前后轴正转 = 顶部往右）；步子颠、甩、乱晃；被打中往后一弹
    const jolt = this.age - this.hitAt < 0.5 ? Math.exp(-8 * (this.age - this.hitAt)) * Math.sin(30 * (this.age - this.hitAt)) : 0;
    P.rotate('crucible', AX, 0.22 * hunch + 0.03 * Math.abs(Math.sin(ph)) * amp - 0.06 * jolt + 0.08 * stag * Math.sin(t * 11));
    P.rotate('crucible', AZ, 0.14 * hunch + 0.1 * fling * Math.sin(t * 9 + 1) + 0.05 * waddle + 0.08 * stag * Math.sin(t * 13));

    // 腿：短腿迈步（大腿前后摆、小腿抬、脚掌放平）
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 'L' : 'R';
      const sw = Math.sin(ph + i * Math.PI), lift = Math.max(0, Math.cos(ph + i * Math.PI));
      P.rotate(`thigh_${s}`, AX, -0.45 * amp * sw - 0.15 * lift * amp + this.lean.x * 0.4 - 0.1 * hunch);
      P.rotate(`shin_${s}`, AX, 0.6 * amp * lift + 0.08 * hunch);
      P.rotate(`foot_${s}`, AX, -0.35 * amp * lift);
      P.rotate(`toe_${s}`, AX, 0.25 * amp * lift);
    }
    // 围裙：前片跟着往前迈的腿，后片随惯性
    const fwd = Math.max(0, Math.sin(ph), Math.sin(ph + Math.PI)) * amp;
    P.rotate('apron_F1', AX, -0.3 * fwd + Math.min(0.05, this.apron.x) - 0.15 * hunch + 0.03 * Math.sin(t * 1.4));
    P.rotate('apron_F2', AX, this.apron.x * 0.5 - 0.1 * fling);
    P.rotate('apron_B1', AX, 0.25 * fwd + Math.max(-0.05, this.apron.x) + 0.15 * fling);
    P.rotate('apron_F1', AZ, this.apron.y);
    P.rotate('apron_B1', AZ, this.apron.y + 0.2 * fling * Math.sin(t * 9));

    // 胡子辫：三节弹簧（前后 + 左右），弓背时往前垂
    for (let k = 0; k < 3; k++) {
      const w = [0.5, 0.35, 0.3][k];
      P.rotate(`beard_${k + 1}`, AX, (this.beard.x + 0.05 * Math.sin(t * 1.3 - k)) * w - 0.12 * hunch * (k === 0 ? 1 : 0.3));
      P.rotate(`beard_${k + 1}`, AZ, (this.beard.y + 0.04 * Math.sin(t * 1.1 - k * 0.8) + 0.4 * fling * Math.sin(t * 9 - k)) * w);
    }

    // 手臂：走路前后摆；右手浇铸时朝前上方指；泼铜时双臂甩开；踉跄时双手往背后够
    for (const hs of this.hands) {
      const left = hs.side === 'L', m = left ? 1 : -1, s = hs.side;
      const swing = Math.sin(ph + (left ? Math.PI : 0)) * amp;
      P.rotate(`arm_${s}`, AX, 0.35 * swing - 0.05 * breath * calm);
      P.rotate(`arm_${s}`, AZ, m * (0.06 + 0.9 * fling + 0.03 * breath));
      if (!left) P.rotate(`arm_${s}`, AX, -1.15 * point);
      else P.rotate(`arm_${s}`, AX, -0.25 * point);
      P.rotate(`arm_${s}`, AX, 0.9 * stag);
      P.rotate(`arm_${s}`, AZ, m * 0.35 * stag);
      P.rotate(`forearm_${s}`, AX, -0.25 - 0.2 * Math.max(0, swing) - (left ? 0.35 : 0.1) * point + 0.4 * fling - 0.9 * stag);
      P.rotate(`hand_${s}`, AZ, m * 0.1 * fling);
      // 手指：平时半握；指向时食指伸直其余握；甩开时张开；踉跄时乱抓
      for (let f = 0; f < 5; f++) {
        let goal = 0.35;
        if (!left) goal = mix(goal, f === 1 ? 0 : 0.85, point);
        goal = mix(goal, -0.15, fling);
        goal = mix(goal, 0.7 + 0.1 * Math.sin(t * 29 + f), stag);
        const kk = 1 - Math.exp(-12 * dt);
        hs.curl[f] = mix(hs.curl[f], goal, kk);
        const c = hs.curl[f], axis = hs.axes[f], thumb = f === 0;
        P.rotate(`${FINGERS[f]}_1_${s}`, axis, c * (thumb ? 0.45 : 0.8));
        P.rotate(`${FINGERS[f]}_2_${s}`, axis, c * (thumb ? 0.5 : 0.95));
      }
    }
  }

  /** 程序化白模（?classic 或资产未就绪）：弓背、坩埚前倾、手臂摆动、胡子晃 */
  private poseClassic(dt: number): void {
    const t = this.age, hunch = this.eHunch.x, fling = this.eFling.x, stag = this.eStagger.x;
    const swing = Math.sin(this.walkPhase) * this.walkAmp;
    this.body.rotation.x = 0.2 * hunch - this.hurtKick * 0.15 + 0.1 * stag;
    this.body.rotation.z = 0.1 * swing;
    this.crucible.rotation.set(0.25 * hunch + 0.1 * stag * Math.sin(t * 11), 0, 0.15 * hunch + 0.1 * fling * Math.sin(t * 9));
    this.classicHead.rotation.x = -0.2 * hunch + 0.2 * stag;
    this.classicBeard.rotation.x = 0.1 * Math.sin(t * 1.3) - 0.1 * this.velocity.length() * 0.05;
    for (let j = 0; j < this.classicArms.length; j++) {
      const s = j === 0 ? 1 : -1;
      const arm = this.classicArms[j];
      arm.rotation.x = 0.4 * swing * s - (j === 1 ? 1.2 * this.ePoint.x : 0) + 0.9 * stag;
      arm.rotation.z = s * (0.05 + 1.0 * fling);
    }
    void dt;
  }
}
