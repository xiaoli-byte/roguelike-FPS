import * as THREE from 'three';
import type { EnemyDef, GameContext, IEnemy, RunState, StageNode } from '../core/types';
import { getEnemyDef } from '../enemies/Registry';
import {
  applyRewardScale, claimRoamingCoins, claimRoamingEssence, resetRoamingBudget, roamingCoinsGiven, roamingEssenceGiven,
} from '../progression/RewardScale';
import type { UnityEncounter, UnityMonsterEntry, UnitySceneDocument } from './UnityLevelLibrary';

/**
 * 战斗导演（Unity CombatDirector.cs 一比一；docs/level-design/run-variety.md §3，参考《雨中冒险 2》的 Combat Director；
 * 用户 2026-11-08：「射得爽是指武器牛逼，怪物少了满足不了爽感」）：正式的局（{@link CombatDirector.live}）在开放大图里，据点之间也持续有怪——
 *   · 游荡怪群：进关 {@link WARMUP} 秒后开始，每隔一段时间刷一群——只从关卡摆好的怪物入场点（MonsterEntry，场景文档 entries）进场：
 *     挑离玩家 22–75 m、走得到、优先玩家看不到的入场点，按入场方式播预告；
 *     还没摆入场点的老图退回到玩家视野外 24–42 m 的随机导航网格点（地面先亮 0.8 s 出生圈）；
 *     间隔随这一关待的时间缩短（22 s → 10 s）、群越来越大（3 → 7 只）、精英概率越来越高（5% → 25%）——拖得越久越热闹；
 *     怪物表取这张图各据点编制里出现过的敌人（题材、模型都对得上，不用另配表），按出现次数加权；熔岩里游的、首领不刷；
 *     重型单位（耐久 ≥ 表中位数 2.5 倍）一群最多一只。刷出来的怪直接锁定玩家（敌人 AI 本来就全图追玩家）。
 *   · 场上游荡怪最多 {@link MAX_ALIVE} 只；据点交战中、玩家在安全区（补给营）附近、关卡目标完成之后、玩家阵亡时暂停。
 *   · 据点加量（{@link CombatDirector.densify}）：据点开打时普通单位（非精英、条目 ≥ 2 只）× {@link SITE_DENSITY}，精英和单只重型不变。
 *   · 经济（docs/balance.md 第十二节）：据点加量后灵石 / 魂晶总量不变（每只按比例摊薄，RewardScale）；
 *     游荡怪照常掉，但每关游荡怪的灵石 / 魂晶有上限（Economy.roamingCoinCap / ROAMING_ESSENCE_PER_STAGE）。
 * 只在首领关以外的开放图里跑。调试局（?debugStage= 直接进关）缺省不跑；{@link CombatDirector.force}（网址 ?director=1 / 0）可以打开 / 关掉。
 *
 * 网页差异：入场方式的专属声光（门缝发光、熔岩鼓泡、炭堆、飞临叫声）和入场动作（跃下 / 飞临的弧线、熔岩爬出）
 * 还没有对应的网页特效（随 M4 遭遇 v2 的刷怪方式一起做），这里只保留各方式的预告时长和地面出生圈。
 */

/** 据点普通单位的倍率 */
export const SITE_DENSITY = 1.5;
/** 场上游荡怪上限 */
export const MAX_ALIVE = 12;
/** 进关后多久开始刷（秒） */
export const WARMUP = 25;
const INTERVAL_START = 22, INTERVAL_MIN = 10, INTERVAL_PER_MINUTE = 1.5;
const NEAR_MIN = 24, NEAR_MAX = 42, SAFE_ZONE_CLEAR = 30, WARN_TIME = 0.8, ENTRY_MIN = 22, ENTRY_MAX = 75;
/** Unity Color(1, 0.29, 0.23) / (1, 0.76, 0.2)，同 WaveRunner 的出生圈 */
const WARN_COLOR = 0xff4a3a, WARN_ELITE = 0xffc233;
/** 入场方式的预告时长（Unity SpawnCues：余烬 1.0 s、熔岩 0.8 s、增援门 1.1 s、飞临 0.8 s） */
const EMBER_TIME = 1.0, LAVA_TIME = 0.8, GATE_TIME = 1.1, FLY_TIME = 0.8;
/**
 * 熔岩里游的敌人（Unity：AI 实现 ILavaDweller 的只有火鼍 TuoAI）。M2 把定义表的 ai 导过来之后改读定义
 */
const LAVA_DWELLERS: ReadonlySet<string> = new Set(['tuo']);
/** 冲锋型（Unity EnemyDef.charger；defs.json 里有，网页 EnemyDef 还没有这一列） */
const CHARGERS: ReadonlySet<string> = new Set(['tomb_beast', 'xuangui', 'haozhi', 'aoyin', 'leiyak']);

/** 入场方式（Unity SpawnMode） */
export type SpawnMode = 'appear' | 'ambush' | 'ember' | 'lavaCrawl' | 'flyIn' | 'drop' | 'gate';
const SPAWN_MODES: readonly SpawnMode[] = ['appear', 'ambush', 'ember', 'lavaCrawl', 'flyIn', 'drop', 'gate'];

/** 场景文档的 mode（枚举整数，或名字）→ SpawnMode；认不出的按现身 */
export function spawnModeOf(mode: number | string | null | undefined): SpawnMode {
  if (typeof mode === 'number') return SPAWN_MODES[mode] ?? 'appear';
  if (typeof mode === 'string') {
    const m = SPAWN_MODES.find(name => name.toLowerCase() === mode.toLowerCase());
    if (m) return m;
  }
  return 'appear';
}

/** 入场方式的预告时长（同据点：现身 0.8 s、余烬 / 熔岩 / 增援门 / 飞临按 SpawnCues） */
export function cueTime(mode: SpawnMode): number {
  switch (mode) {
    case 'ember': return EMBER_TIME;
    case 'lavaCrawl': return LAVA_TIME;
    case 'gate': return GATE_TIME;
    case 'flyIn': return FLY_TIME;
    default: return WARN_TIME;
  }
}

/** 入场点进场后往哪走（水平，Unity MonsterEntry.Facing） */
export function entryFacing(entry: UnityMonsterEntry): THREE.Vector3 {
  const f = new THREE.Vector3(entry.forward?.[0] ?? 0, 0, entry.forward?.[2] ?? 1);
  return f.lengthSq() > 1e-4 ? f.normalize() : new THREE.Vector3(0, 0, 1);
}

/** 关卡导演提供的现场状态 */
export interface CombatDirectorHost {
  /** 据点交战中（Unity EncounterSite.ActiveSites.Count > 0） */
  siteActive(): boolean;
  /** 关卡目标完成 / 本关已完成（Unity LevelObjective.Complete、GameSession.Completed） */
  completed(): boolean;
}

/** 据点编制（网页 WavePlan 的子集：只看条目只数和精英） */
export interface DensifyWave {
  entries: { count: number; elite?: boolean }[];
}

interface PackPick {
  def: EnemyDef;
  position: THREE.Vector3;
  elite: boolean;
  cancel?: () => void;
}

interface PendingPack {
  at: number;
  picks: PackPick[];
  /** 入场方式与起点（跃下的墙头 / 增援门后；没有 = 落地点），落地后按它出场（Unity CombatDirector.Enter） */
  mode?: SpawnMode;
  from?: THREE.Vector3;
}

/** 能做出场位移的敌人（StandardEnemy.beginEntrance，Unity SpawnEntrance） */
interface EntranceHost {
  beginEntrance?(kind: 'hop' | 'fly' | 'jump', from: THREE.Vector3, to: THREE.Vector3): boolean;
}

/**
 * 入场动作（Unity CombatDirector.Enter）：跃下从起跳点跳到落点、飞临从入场点飞进来（落点上方 2 m）；
 * 熔岩爬出 / 余烬起身在 Unity 里只有落点的声光（SpawnCues），这里给一团对应颜色的溅射
 */
export function enterSpawn(ctx: GameContext, enemy: IEnemy, mode: SpawnMode, from: THREE.Vector3, to: THREE.Vector3): void {
  const host = enemy as unknown as EntranceHost;
  switch (mode) {
    case 'drop':
      host.beginEntrance?.('jump', from, to);
      break;
    case 'flyIn':
      host.beginEntrance?.('fly', from, to.clone().setY(to.y + 2));
      break;
    case 'lavaCrawl':
      ctx.fx.burst(to, 0xff6a1f, 14, 4, 0.6, 0.14, 8);
      break;
    case 'ember':
      ctx.fx.burst(to, 0xffa040, 16, 2.5, 0.9, 0.08, -2);
      break;
    default:
      break;
  }
}

type EnemyDefLookup = (id: string) => EnemyDef | undefined;

const _eye = new THREE.Vector3(), _target = new THREE.Vector3(), _hit = new THREE.Vector3(), _p = new THREE.Vector3();

function flat(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class CombatDirector {
  /** 强制打开（true）/ 关掉（false）；null = 按局判断（正式的局开，调试局关）。缺省读网址 ?director=1 / 0 */
  static force: boolean | null = typeof location === 'undefined' ? null
    : (value => value === '1' ? true : value === '0' ? false : null)(new URLSearchParams(location.search).get('director'));

  /** 这一局要不要加怪：force 优先；否则正式的局（不是调试局）才加 */
  static live(run: RunState | null | undefined): boolean {
    if (CombatDirector.force !== null) return CombatDirector.force;
    return !!run && !run.dev;
  }

  /**
   * 据点开打时按 {@link SITE_DENSITY} 给普通单位加量（克隆编制后调；不是 live 的局原样返回）。
   * 返回这个据点每只怪的奖励倍率 = 原只数 ÷ 加量后只数：据点的灵石 / 魂晶总量不变，平摊到更多的怪上；没加量返回 1
   */
  static densify(waves: readonly (DensifyWave | null | undefined)[] | null | undefined, live: boolean): number {
    if (!waves || !live) return 1;
    let before = 0, after = 0;
    for (const w of waves) {
      for (const e of w?.entries ?? []) {
        if (!e || e.count <= 0) continue;
        before += e.count;
        if (!e.elite && e.count >= 2) e.count = Math.ceil(Math.fround(e.count * SITE_DENSITY));
        after += e.count;
      }
    }
    return after > before && before > 0 ? Math.fround(before / after) : 1;
  }

  /** 据点刷出来的怪挂奖励倍率（Unity EncounterSite：factor < 1 才挂；游荡怪之后会被 roaming 覆盖） */
  static applySiteReward(enemy: IEnemy, factor: number): void {
    if (factor < 1) applyRewardScale(enemy, factor, factor);
  }

  // 游荡怪的每关奖励额度（实现在 progression/RewardScale，Loot / Combat 也读它）
  static readonly resetRoamingBudget = resetRoamingBudget;
  static readonly claimRoamingCoins = claimRoamingCoins;
  static readonly claimRoamingEssence = claimRoamingEssence;
  static get roamingCoinsGiven(): number { return roamingCoinsGiven(); }
  static get roamingEssenceGiven(): number { return roamingEssenceGiven(); }

  /** 这一关刷过的群数 / 只数（测试、调试用） */
  packs = 0;
  spawned = 0;

  private readonly alive: IEnemy[] = [];
  private readonly roster: { def: EnemyDef; weight: number }[] = [];
  private medianBulk = 1;
  private now = 0;
  private stageStart = 0;
  private nextPack = 0;
  private pending: PendingPack | null = null;
  private readonly path: THREE.Vector3[] = [];

  /**
   * 进了新的一关（Unity Arrive）：重新收怪物表、计时从头来、游荡怪奖励额度清零。
   * encounters = 这张图的全部据点（含被布局停用的，已按变体换好编制），默认取文档里的
   */
  constructor(
    private readonly ctx: GameContext,
    private readonly document: UnitySceneDocument,
    private readonly stage: StageNode,
    private readonly host: CombatDirectorHost,
    encounters: readonly UnityEncounter[] = document.encounters,
    private readonly defOf: EnemyDefLookup = getEnemyDef,
  ) {
    this.stageStart = this.now;
    this.nextPack = this.now + WARMUP;
    resetRoamingBudget();
    this.buildRoster(encounters);
  }

  /** 场上活着的游荡怪 */
  get aliveCount(): number {
    for (let i = this.alive.length - 1; i >= 0; i--) if (!this.alive[i].alive) this.alive.splice(i, 1);
    return this.alive.length;
  }

  /** 这张图的游荡怪物表（敌人 id → 权重） */
  get rosterWeights(): readonly { id: string; weight: number }[] {
    return this.roster.map(r => ({ id: r.def.id, weight: r.weight }));
  }

  /** 这一关场上的入场点数 */
  get entries(): number {
    return this.document.entries?.length ?? 0;
  }

  /** 正在等预告结束的一群 */
  get packPending(): boolean {
    return this.pending !== null;
  }

  update(dt: number): void {
    this.now += dt;
    if (this.pending && this.now >= this.pending.at) this.finishPack();
    const ctx = this.ctx;
    if (!CombatDirector.live(ctx.run) || this.stage.type === 'boss' || this.roster.length === 0 || this.pending) return;
    if (!ctx.player.alive || ctx.game.state !== 'playing' || this.host.completed()) return;
    const now = this.now;
    // 据点交战中、安全区附近：不刷，计时顺延（不攒着一起刷）
    const ppos = ctx.player.position;
    if (this.host.siteActive() || this.nearSafeZone(ppos, SAFE_ZONE_CLEAR)) {
      this.nextPack = Math.max(this.nextPack, now + 4);
      return;
    }
    if (now < this.nextPack) return;
    const minutes = (now - this.stageStart) / 60;
    this.nextPack = now + Math.max(INTERVAL_MIN, INTERVAL_START - INTERVAL_PER_MINUTE * minutes);
    const alive = this.aliveCount;
    if (alive >= MAX_ALIVE) return;
    let size = clamp(3 + Math.floor(minutes / 1.5), 3, 7);
    size = Math.min(size, MAX_ALIVE - alive);
    if (size <= 0) return;
    const eliteChance = clamp(0.05 + 0.025 * minutes, 0.05, 0.25);
    const place = this.tryPlace(ppos);
    if (place) this.spawnPack(place.anchor, place.entry, size, eliteChance);
  }

  /** 调试 / 测试：不管计时立刻刷一群（size 只）；找不到点、正在刷、没有怪物表时返回 false */
  spawnNow(size = 4, eliteChance = 0): boolean {
    if (this.pending || this.roster.length === 0) return false;
    const place = this.tryPlace(this.ctx.player.position);
    if (!place) return false;
    this.spawnPack(place.anchor, place.entry, clamp(size, 1, MAX_ALIVE), eliteChance);
    return true;
  }

  /** 离开这一关：取消还没落地的出生圈 */
  dispose(): void {
    for (const pick of this.pending?.picks ?? []) pick.cancel?.();
    this.pending = null;
    this.alive.length = 0;
  }

  private buildRoster(encounters: readonly UnityEncounter[]): void {
    this.roster.length = 0;
    const weights = new Map<string, number>();
    for (const site of encounters) {
      for (const w of site.waves ?? []) {
        for (const e of w?.entries ?? []) {
          if (!e?.enemy) continue;
          weights.set(e.enemy, (weights.get(e.enemy) ?? 0) + Math.max(1, e.count));
        }
      }
    }
    const bulks: number[] = [];
    for (const [id, weight] of weights) {
      const def = this.defOf(id);
      if (!def || def.isBoss) continue;
      if (LAVA_DWELLERS.has(def.id)) continue;
      this.roster.push({ def, weight });
      bulks.push(CombatDirector.bulk(def));
    }
    if (bulks.length > 0) {
      bulks.sort((a, b) => a - b);
      this.medianBulk = Math.max(1, bulks[Math.floor(bulks.length / 2)]);
    }
  }

  private static bulk(d: EnemyDef): number {
    const charger = (d as EnemyDef & { charger?: boolean }).charger ?? CHARGERS.has(d.id);
    return Math.max(1, d.hp + (d.armor ?? 0) + (d.shield ?? 0)) * (charger ? 1.5 : 1);
  }

  private heavy(d: EnemyDef): boolean {
    return CombatDirector.bulk(d) >= this.medianBulk * 2.5;
  }

  private nearSafeZone(p: { x: number; z: number }, margin: number): boolean {
    for (const camp of this.document.camps ?? []) {
      if (flat({ x: camp.position[0], z: camp.position[2] }, p) < camp.safeRadius + margin) return true;
    }
    return false;
  }

  /** NavMesh.SamplePosition(p, maxDistance)：最近的导航点在 maxDistance 内 */
  private sample(p: THREE.Vector3, maxDistance: number, out: THREE.Vector3): boolean {
    return this.ctx.nav.nearestWalkable(p, out) && out.distanceTo(p) <= maxDistance;
  }

  /** NavMesh.CalculatePath(...).status == PathComplete */
  private pathComplete(from: THREE.Vector3, to: THREE.Vector3): boolean {
    this.path.length = 0;
    return this.ctx.nav.findPath(from, to, this.path);
  }

  /**
   * 挑一个进场点：关卡摆了入场点就只在入场点里挑（离玩家 22–75 m、走得到、不在安全区附近，玩家看不到的权重 × 3、近的优先）；
   * 一个入场点都没摆的老图退回到玩家视野外 24–42 m 的随机导航网格点
   */
  private tryPlace(ppos: THREE.Vector3): { anchor: THREE.Vector3; entry: UnityMonsterEntry | null } | null {
    if (this.entries > 0) return this.tryEntry(ppos);
    const anchor = this.tryRandom(ppos);
    return anchor ? { anchor, entry: null } : null;
  }

  private tryEntry(ppos: THREE.Vector3): { anchor: THREE.Vector3; entry: UnityMonsterEntry } | null {
    const ctx = this.ctx;
    const eye = ctx.camera ? _eye.copy(ctx.camera.position) : _eye.copy(ppos).setY(ppos.y + 1.62);
    const picks: { e: UnityMonsterEntry; at: THREE.Vector3; w: number }[] = [];
    let total = 0;
    for (const e of this.document.entries ?? []) {
      _p.set(e.position[0], e.position[1], e.position[2]);
      const d = flat(_p, ppos);
      if (d < ENTRY_MIN || d > ENTRY_MAX || this.nearSafeZone(_p, 6)) continue;
      if (!this.sample(_p, 3, _hit)) continue;
      if (!e.flyersOnly && !this.pathComplete(_hit, ppos)) continue;
      _target.copy(_hit).setY(_hit.y + 1.2);
      const hidden = ctx.world.segmentBlocked(eye, _target);
      const w = (hidden ? 3 : 1) * (1.4 - (d - ENTRY_MIN) / (ENTRY_MAX - ENTRY_MIN));
      picks.push({ e, at: _hit.clone(), w });
      total += w;
    }
    if (picks.length === 0) return null;
    let r = ctx.rng.next() * total;
    for (const { e, at, w } of picks) {
      r -= w;
      if (r > 0) continue;
      return { anchor: at, entry: e };
    }
    const last = picks[picks.length - 1];
    return { anchor: last.at, entry: last.e };
  }

  /** 老图兜底：玩家视野外（优先背后 / 侧面）24–42 m、导航网格上、走得到、离安全区够远的一个点 */
  private tryRandom(ppos: THREE.Vector3): THREE.Vector3 | null {
    const ctx = this.ctx;
    const fwd = new THREE.Vector3();
    if (ctx.camera) ctx.camera.getWorldDirection(fwd);
    else fwd.set(-Math.sin(ctx.player.yaw), 0, -Math.cos(ctx.player.yaw));
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-4) fwd.normalize();
    else fwd.set(0, 0, 1);
    for (let i = 0; i < 14; i++) {
      const a = ctx.rng.next() * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      // 前 10 次只要视野外的（和视线方向夹角 > 70°），实在找不到再放宽
      if (i < 10 && dir.dot(fwd) > 0.34) continue;
      _p.copy(ppos).addScaledVector(dir, ctx.rng.range(NEAR_MIN, NEAR_MAX));
      if (!this.sample(_p, 6, _hit)) continue;
      if (flat(_hit, ppos) < NEAR_MIN - 4 || this.nearSafeZone(_hit, SAFE_ZONE_CLEAR)) continue;
      if (Math.abs(_hit.y - ppos.y) > 14) continue;
      if (!this.pathComplete(_hit, ppos)) continue;
      return _hit.clone();
    }
    return null;
  }

  private spawnPack(anchor: THREE.Vector3, entry: UnityMonsterEntry | null, size: number, eliteChance: number): void {
    const ctx = this.ctx;
    let mode = entry ? spawnModeOf(entry.mode) : 'appear';
    if (mode === 'ambush') mode = 'appear'; // 入场点不做埋伏（埋伏是驻守点的事）
    const flyers = !!entry?.flyersOnly;
    const spread = entry ? Math.max(1, entry.spread) : 4;
    const cue = cueTime(mode);
    const picks: PackPick[] = [];
    const heavy = { taken: false };
    let elite = false;
    for (let i = 0; i < size; i++) {
      const def = this.pickDef(heavy, flyers);
      if (!def) break;
      _p.set(anchor.x + ctx.rng.range(-spread, spread), anchor.y, anchor.z + ctx.rng.range(-spread, spread));
      const position = this.sample(_p, 3, _hit) ? _hit.clone() : anchor.clone();
      const e: boolean = !elite && ctx.rng.next() < eliteChance;
      elite ||= e;
      // 落点都给出生圈（不伤人，原色）：跃下 / 飞临的人先看见落点
      const cancel = ctx.fx.groundWarning(position, Math.max(1.1, def.radius + 0.3), cue, e ? WARN_ELITE : WARN_COLOR);
      picks.push({ def, position, elite: e, cancel: typeof cancel === 'function' ? cancel : undefined });
    }
    const f = entry?.from;
    const from = f && f.length >= 3 && Number.isFinite(f[0] + f[1] + f[2]) ? new THREE.Vector3(f[0], f[1], f[2]) : anchor.clone();
    this.pending = { at: this.now + cue, picks, mode, from };
  }

  private finishPack(): void {
    const pack = this.pending;
    this.pending = null;
    if (!pack) return;
    const ctx = this.ctx;
    // Unity：换关中 / 已经离开这一关就不刷（离关时 dispose 已清掉 pending）
    if (ctx.game.state !== 'playing') {
      for (const pick of pack.picks) pick.cancel?.();
      return;
    }
    for (const { def, position, elite } of pack.picks) {
      let enemy: IEnemy | null = null;
      try {
        enemy = ctx.enemies.spawn(def.id, { position: position.clone(), elite: elite || undefined, level: ctx.run.difficulty });
      } catch (err) {
        console.error('[CombatDirector] spawn failed', def.id, err);
      }
      if (!enemy) continue;
      if (pack.mode && pack.mode !== 'appear' && pack.from) {
        try {
          enterSpawn(ctx, enemy, pack.mode, pack.from, position);
        } catch (err) {
          console.error('[CombatDirector] entrance failed', def.id, err);
        }
      }
      applyRewardScale(enemy, 1, 1, true);
      this.alive.push(enemy);
      this.spawned++;
    }
    this.packs++;
  }

  private pickDef(heavy: { taken: boolean }, flyersOnly = false): EnemyDef | null {
    const taken = heavy.taken;
    const skip = (d: EnemyDef): boolean => (taken && this.heavy(d)) || (flyersOnly && !d.flying);
    let total = 0;
    for (const { def, weight } of this.roster) if (!skip(def)) total += weight;
    if (total <= 0) return null;
    let r = this.ctx.rng.next() * total;
    for (const { def, weight } of this.roster) {
      if (skip(def)) continue;
      r -= weight;
      if (r <= 0) {
        if (this.heavy(def)) heavy.taken = true;
        return def;
      }
    }
    for (const { def } of this.roster) if (!skip(def)) return def;
    return null;
  }
}
