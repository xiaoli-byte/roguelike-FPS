/**
 * 熔岩地面（第三章 祝融火狱 V2）：没有挡墙，玩家能走进、跳进、被打进熔岩。
 *
 * 玩家：着地时身体中心踩到熔岩格（或这一帧贴地滑过熔岩，冲刺不能偷渡）→ 立刻一次火伤（最大生命 12%）+ 两跳灼烧
 * （各 1.5%），橙色闪屏、嘶响、镜头下沉；0.5 秒后被托回最后一个安全落脚点（持续记录：着地、离熔岩至少 1 米），
 * 并给 1 秒无敌防止连续受击致死。熔岩伤害无视冲刺无敌帧（否则冲刺能免伤穿过熔岩），但尊重调试无敌（> 5 秒）。
 * 每次重新踩进都会再扣血。跳过窄渠（离地）不受伤。
 *
 * 敌人：导航把熔岩当阻挡，地面敌人绕路走；直线走进熔岩的（AI 直接位移）被拉回上一帧的岸上位置。
 * 被击退（失控滑行）0.6 秒内落进熔岩的非首领地面敌人直接烧死（计击杀、正常掉落）。首领与飞行敌人不受熔岩影响，
 * 熔岩生物（swimsInLava = true，火鼍）也不受影响：它们自己在熔岩里游（不走导航网格）。
 *
 * 表现：每关一张熔岩面（一个 draw call，自发光流动熔岩 + 结壳裂纹 + 岸边暗色硬壳）、一组上升火星（一个 draw call）、
 * 一盏跟随玩家附近熔岩的橙色点光。
 *
 * 临时熔岩（addLavaArea，首领脚本用，例如火麒麟的「熔流轮转」把熔岩渠涨宽）：给一个多边形，多边形里的格子在撤掉之前
 * 都是熔岩——玩法掩码、导航（地面敌人绕开、重建导航网格）、熔岩面（从地面下涌上来）一起变；撤掉后恢复原样。
 * 熔岩掩码与矩形表就是关卡数据里那一份（导航网格共用同一个对象），首次使用时备份，撤掉 / 卸载时还原。
 *
 * 只依赖 three 与类型：测试可以直接加载本文件。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../core/types';
import type { WhiteboxLava, WhiteboxRect } from './WhiteboxTypes';

/** 数值（测试与调参共用） */
export const LAVA = {
  /** 踩进熔岩的瞬间伤害：最大生命比例 */
  burst: 0.12,
  /** 下沉期间的灼烧跳伤（最大生命比例）与时刻（秒，自踩入起） */
  burnTick: 0.015,
  burnAt: [0.2, 0.4] as readonly number[],
  /** 踩入到被托回安全点的时间 */
  sinkTime: 0.5,
  /** 下沉时镜头最多降低（米） */
  sinkDepth: 0.42,
  /** 托回后的无敌时间 */
  grace: 1,
  /** 安全落脚点离最近熔岩至少多远（米） */
  safeMargin: 1,
  /** 离地面多高以内算「站在熔岩上」（高台、掩体顶不算） */
  standRise: 0.3,
  /** 敌人被击退后多长时间内落进熔岩算「被打进去」 */
  knockWindow: 0.6,
  /** 超过这个无敌时长视为调试无敌，熔岩不扣血 */
  debugInvuln: 5,
} as const;

const SURFACE_LIFT = 0.04;
/** 临时熔岩的熔岩面涌上来之前沉在地面下多深 */
const FLOOD_DEPTH = 0.45;
const MAX_DIST_CELLS = 8;
const EMBERS = 90;

/** 熔岩场查询：世界坐标点是否在熔岩格上 */
export function onLava(lava: WhiteboxLava, x: number, z: number): boolean {
  const ix = Math.floor((x - lava.minX) / lava.cell), iz = Math.floor((z - lava.minZ) / lava.cell);
  return ix >= 0 && iz >= 0 && ix < lava.cols && iz < lava.rows && lava.mask[iz * lava.cols + ix] === 1;
}

/** 半径 r 内是否有熔岩格（按格子方块算距离） */
export function nearLava(lava: WhiteboxLava, x: number, z: number, r: number): boolean {
  const c = lava.cell;
  const x0 = Math.max(0, Math.floor((x - r - lava.minX) / c)), x1 = Math.min(lava.cols - 1, Math.floor((x + r - lava.minX) / c));
  const z0 = Math.max(0, Math.floor((z - r - lava.minZ) / c)), z1 = Math.min(lava.rows - 1, Math.floor((z + r - lava.minZ) / c));
  for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
    if (lava.mask[iz * lava.cols + ix] !== 1) continue;
    const cx = lava.minX + ix * c, cz = lava.minZ + iz * c;
    const dx = Math.max(cx - x, 0, x - cx - c), dz = Math.max(cz - z, 0, z - cz - c);
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

/** 线段 a→b（水平）是否经过熔岩格（按 1/4 格采样） */
function segmentOnLava(lava: WhiteboxLava, ax: number, az: number, bx: number, bz: number): boolean {
  const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / (lava.cell * 0.25)));
  for (let k = 0; k <= n; k++) if (onLava(lava, ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)) return true;
  return false;
}

interface EnemyTrack { x: number; z: number; knockAt: number }
/** swimsInLava：熔岩生物（第三章火鼍）自己在熔岩里游，不被拉回岸上、不被烧死 */
type LavaEnemy = IEnemy & { readonly knockedBack?: boolean; readonly swimsInLava?: boolean };

/** addLavaArea 的选项 */
export interface LavaFloodOptions {
  /** 熔岩面从地面下涌上来 / 退下去用的秒数（只是表现；玩法掩码在调用时立即生效） */
  rise?: number;
}

/** 一片临时熔岩（addLavaArea 的返回值） */
export interface LavaFlood {
  /** 新变成熔岩的格子数（原本就是熔岩的格子不算） */
  readonly cells: number;
  /** 还没撤掉 */
  readonly active: boolean;
  /** 撤掉这片熔岩：掩码、导航、熔岩面恢复（熔岩面按 rise 秒退下去）。可重复调用 */
  remove(): void;
}

interface FloodRec extends LavaFlood {
  active: boolean;
  readonly cellList: Int32Array;
  readonly rects: WhiteboxRect[];
  readonly rise: number;
}

/** 多边形（世界 XZ）是否包含点（偶奇规则） */
function inPolygon(poly: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[j];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) yes = !yes;
  }
  return yes;
}

/** 一组格子合并成矩形（先按行合并成段，再把上下相同的段接起来） */
function cellsToRects(lava: WhiteboxLava, cells: Int32Array): WhiteboxRect[] {
  const { cols, cell, minX, minZ } = lava;
  const set = new Set<number>(cells);
  const runs = new Map<string, { x0: number; x1: number; z0: number; z1: number }>();
  const out: { x0: number; x1: number; z0: number; z1: number }[] = [];
  const sorted = Array.from(cells).sort((a, b) => a - b);
  let prevRow = -1;
  let rowRuns: { x0: number; x1: number }[] = [];
  const flushRow = (row: number): void => {
    const next = new Map<string, { x0: number; x1: number; z0: number; z1: number }>();
    for (const r of rowRuns) {
      const key = `${r.x0}:${r.x1}`;
      const open = runs.get(key);
      if (open && open.z1 === row - 1) { open.z1 = row; next.set(key, open); }
      else { const n = { x0: r.x0, x1: r.x1, z0: row, z1: row }; out.push(n); next.set(key, n); }
    }
    runs.clear();
    for (const [k, v] of next) runs.set(k, v);
    rowRuns = [];
  };
  for (let k = 0; k < sorted.length; k++) {
    const i = sorted[k], row = Math.floor(i / cols), x = i % cols;
    if (row !== prevRow) { if (prevRow >= 0) flushRow(prevRow); prevRow = row; }
    const last = rowRuns[rowRuns.length - 1];
    if (last && last.x1 === x - 1 && set.has(i - 1)) last.x1 = x;
    else rowRuns.push({ x0: x, x1: x });
  }
  if (prevRow >= 0) flushRow(prevRow);
  return out.map((r) => ({ minX: minX + r.x0 * cell, maxX: minX + (r.x1 + 1) * cell, minZ: minZ + r.z0 * cell, maxZ: minZ + (r.z1 + 1) * cell }));
}

/** 熔岩玩法 + 表现。StageDirector 在有熔岩的关卡里创建，每帧 update，卸载时 dispose。 */
export class LavaSystem {
  readonly group = new THREE.Group();
  /** 最后一个安全落脚点（玩家被托回这里） */
  readonly safe = new THREE.Vector3();
  /** 本关踩进熔岩的次数（调试 / 测试） */
  entries = 0;
  private state: 'clear' | 'sinking' = 'clear';
  private sinkT = 0;
  private ticks = 0;
  private readonly prev = new THREE.Vector3();
  private prevGrounded = false;
  private readonly tracks = new WeakMap<IEnemy, EnemyTrack>();
  private readonly surface: LavaSurface;
  private flash = 0;
  private overlay: HTMLDivElement | null = null;
  private cancelSink: (() => void) | null = null;
  private disposed = false;
  /** 临时熔岩（addLavaArea）：首次使用时备份的原始掩码与矩形表 */
  private baseMask: Uint8Array | null = null;
  private baseRects: WhiteboxRect[] | null = null;
  private readonly floods: FloodRec[] = [];

  constructor(private readonly ctx: GameContext, readonly lava: WhiteboxLava, readonly floorY: number, spawn: { x: number; z: number }) {
    this.group.name = 'lava';
    this.safe.set(spawn.x, floorY, spawn.z);
    this.prev.copy(this.safe);
    this.surface = new LavaSurface(lava, floorY);
    this.group.add(this.surface.group);
  }

  /** 是否正在熔岩里（下沉、等待托回） */
  get sinking(): boolean { return this.state === 'sinking'; }

  update(dt: number, t: number): void {
    if (this.disposed) return;
    const p = this.ctx.player;
    this.updatePlayer(dt);
    this.updateEnemies();
    this.updateFlash(dt);
    this.surface.update(dt, t, p.position);
  }

  // ───────────── 玩家 ─────────────

  private updatePlayer(dt: number): void {
    const p = this.ctx.player, L = this.lava;
    if (!p.alive) { this.endSink(); this.prevGrounded = false; return; }
    if (this.state === 'sinking') {
      this.sinkT += dt;
      const f = Math.exp(-12 * dt);
      p.velocity.x *= f; p.velocity.z *= f;
      while (this.ticks < LAVA.burnAt.length && this.sinkT >= LAVA.burnAt[this.ticks]) {
        this.ticks++;
        this.scorch(LAVA.burnTick);
        this.ctx.audio?.play('burn_tick', { volume: 0.9, pitch: 0.7 });
      }
      if (!p.alive) { this.endSink(); return; }
      if (this.sinkT >= LAVA.sinkTime) this.lift();
      return;
    }
    const pos = p.position;
    const grounded = p.onGround === true && pos.y <= this.floorY + LAVA.standRise;
    // 贴地连续两帧：检查这一帧滑过的整段（高速冲刺不能跨过熔岩格）；超过 4 米的位移是传送，不算
    const swept = grounded && this.prevGrounded && Math.hypot(pos.x - this.prev.x, pos.z - this.prev.z) < 4
      && segmentOnLava(L, this.prev.x, this.prev.z, pos.x, pos.z);
    if (grounded && (onLava(L, pos.x, pos.z) || swept)) {
      this.enter();
    } else if (p.onGround === true && !nearLava(L, pos.x, pos.z, LAVA.safeMargin)) {
      this.safe.copy(pos);
    }
    this.prev.copy(pos);
    this.prevGrounded = grounded;
  }

  /** 踩进熔岩：瞬间火伤 + 闪屏 + 嘶响 + 镜头下沉，开始计时托回 */
  private enter(): void {
    const ctx = this.ctx, p = ctx.player;
    this.state = 'sinking';
    this.sinkT = 0;
    this.ticks = 0;
    this.entries++;
    this.flash = 1;
    _v.set(p.position.x, this.floorY + 0.1, p.position.z);
    ctx.fx?.burst(_v, 0xff6a1a, 28, 5, 0.9, 0.11, -2);
    ctx.fx?.burst(_v, 0xffd070, 12, 3, 0.6, 0.07, -4);
    ctx.fx?.ring?.(_v, 1.8, 0xff6a1a, 0.45);
    ctx.fx?.shake(0.45, 0.3);
    ctx.audio?.play('skill_fire', { volume: 0.95, pitch: 0.7 });
    ctx.audio?.play('burn_tick', { volume: 1, pitch: 0.55 });
    this.scorch(LAVA.burst);
    // 镜头下沉：在所有系统之后（相机已由玩家写好）、渲染之前压低相机
    if (!this.cancelSink && ctx.tasks && ctx.camera) {
      this.cancelSink = ctx.tasks.add(() => {
        if (this.disposed || this.state !== 'sinking') { this.cancelSink = null; return true; }
        const k = Math.min(1, this.sinkT / (LAVA.sinkTime * 0.6));
        ctx.camera.position.y -= LAVA.sinkDepth * (1 - (1 - k) * (1 - k));
        return false;
      });
    }
  }

  /** 托回最后的安全落脚点，并给短暂无敌 */
  private lift(): void {
    const ctx = this.ctx, p = ctx.player;
    this.endSink();
    p.teleport(_v.copy(this.safe));
    p.invulnerableTime = Math.max(p.invulnerableTime, LAVA.grace);
    this.prev.copy(this.safe);
    this.prevGrounded = false;
    this.flash = Math.max(this.flash, 0.45);
    _v.set(this.safe.x, this.safe.y + 0.2, this.safe.z);
    ctx.fx?.burst(_v, 0xffb050, 10, 2.5, 0.5, 0.08, -3);
    ctx.audio?.play('dash', { volume: 0.5, pitch: 0.8 });
  }

  private endSink(): void {
    this.state = 'clear';
    this.cancelSink?.();
    this.cancelSink = null;
  }

  /**
   * 熔岩火伤走正常的玩家受伤流程（减伤、护盾、受伤修饰器、绝处逢生），但无视冲刺 / 托回的短无敌：
   * 否则冲刺能免伤穿过熔岩、托回后马上再踩进去也不疼。调试无敌（很长）照样生效。
   */
  private scorch(fraction: number): number {
    const p = this.ctx.player, combat = this.ctx.combat;
    if (!combat || !p.alive) return 0;
    const saved = p.invulnerableTime;
    if (saved > LAVA.debugInvuln) return 0;
    p.invulnerableTime = 0;
    try {
      return combat.damagePlayer(p.maxHp() * fraction, 'fire', null, p.position);
    } finally {
      p.invulnerableTime = Math.max(p.invulnerableTime, saved);
    }
  }

  // ───────────── 敌人 ─────────────

  private updateEnemies(): void {
    const list = this.ctx.enemies?.list;
    if (!list) return;
    const now = this.ctx.time.now, L = this.lava;
    for (let i = 0; i < list.length; i++) {
      const e = list[i] as LavaEnemy;
      if (!e.alive || e.flying || e.isBoss || e.swimsInLava) continue;
      const pos = e.position;
      let track = this.tracks.get(e);
      if (!track) {
        track = { x: pos.x, z: pos.z, knockAt: -Infinity };
        // 第一次见到就站在熔岩上（不该发生）：放到最近的可走格
        if (onLava(L, pos.x, pos.z) && this.ctx.nav?.nearestWalkable(pos, _v)) { track.x = _v.x; track.z = _v.z; }
        this.tracks.set(e, track);
      }
      if (e.knockedBack) track.knockAt = now;
      if (!onLava(L, pos.x, pos.z)) { track.x = pos.x; track.z = pos.z; continue; }
      if (pos.y > this.floorY + LAVA.standRise) continue; // 在熔岩上空飞过（被击飞、跳跃）
      if (now - track.knockAt <= LAVA.knockWindow && this.burnEnemy(e)) continue;
      // 自己走进来的（或没烧死的）：拉回岸上
      pos.x = track.x; pos.z = track.z;
      e.velocity.x = 0; e.velocity.z = 0;
    }
  }

  /** 被打进熔岩：非首领地面敌人直接烧死（计击杀、掉落照常）。返回是否已死亡 */
  private burnEnemy(e: IEnemy): boolean {
    const ctx = this.ctx;
    if (!ctx.combat) return false;
    _v.set(e.position.x, this.floorY + 0.2, e.position.z);
    ctx.fx?.burst(_v, 0xff6a1a, 30, 6, 1, 0.13, -3);
    ctx.fx?.burst(_v, 0xffd070, 14, 4, 0.7, 0.08, -5);
    ctx.audio?.play('skill_fire', { position: _v, volume: 0.9, pitch: 0.65 });
    ctx.combat.damageEnemy(e, {
      base: 1e7 + Math.max(0, e.hp) * 4, element: 'fire', source: 'status', canCrit: false, procDepth: 2, tags: ['lava'],
    });
    return !e.alive;
  }

  // ───────────── 临时熔岩 ─────────────

  /**
   * 把多边形（世界 XZ，[x, z] 顶点）里的格子临时变成熔岩，直到返回值的 remove()：
   *  - 玩法：onLava / nearLava 与玩家、敌人的熔岩判定立即生效（站在里面的玩家下一帧就会踩进熔岩）；
   *  - 导航：导航网格与本系统共用同一份掩码 / 矩形表，这里补上新矩形并重建网格（地面敌人绕开）；
   *    已经站在新熔岩上的地面敌人挪到最近的可走点；
   *  - 安全落脚点：玩家记录的托回点如果落进（或贴着）新熔岩，就近换一个离熔岩 safeMargin 以外的可走点；
   *  - 表现：熔岩面在 rise 秒内从地面下涌上来，岸边硬壳按新的岸线重算。
   * 原本就是熔岩的格子不受影响；几片临时熔岩可以重叠，撤掉一片不会撤掉另一片还盖着的格子。
   */
  addLavaArea(polygon: readonly (readonly [number, number])[], opts: LavaFloodOptions = {}): LavaFlood {
    const L = this.lava;
    if (!this.baseMask) {
      this.baseMask = L.mask.slice();
      this.baseRects = L.rects.slice();
    }
    const base = this.baseMask;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of polygon) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const c = L.cell;
    const i0 = Math.max(0, Math.floor((x0 - L.minX) / c)), i1 = Math.min(L.cols - 1, Math.floor((x1 - L.minX) / c));
    const j0 = Math.max(0, Math.floor((z0 - L.minZ) / c)), j1 = Math.min(L.rows - 1, Math.floor((z1 - L.minZ) / c));
    const list: number[] = [];
    if (polygon.length >= 3) {
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * L.cols + i;
        if (base[k] === 1) continue;
        if (inPolygon(polygon, L.minX + (i + 0.5) * c, L.minZ + (j + 0.5) * c)) list.push(k);
      }
    }
    const cellList = Int32Array.from(list);
    const rects = cellsToRects(L, cellList);
    const rise = Math.max(0.01, opts.rise ?? 0.6);
    const rec: FloodRec = {
      active: true, cellList, rects, rise, cells: cellList.length,
      remove: () => {
        if (!rec.active || this.disposed) return;
        rec.active = false;
        this.floods.splice(this.floods.indexOf(rec), 1);
        this.surface.sinkFlood(rec);
        this.applyFloods();
      },
    };
    if (cellList.length === 0) { rec.active = false; return rec; }
    this.floods.push(rec);
    this.surface.addFlood(rec, rects);
    this.applyFloods();
    return rec;
  }

  /** 撤掉所有临时熔岩 */
  clearLavaAreas(): void {
    for (const f of this.floods.slice()) f.remove();
  }

  /** 当前生效的临时熔岩片数 */
  get lavaAreas(): number { return this.floods.length; }

  /** 按原始掩码 + 生效的临时熔岩重写掩码与矩形表，重建导航，挪开安全点与站在新熔岩上的敌人 */
  private applyFloods(): void {
    const L = this.lava, base = this.baseMask, baseRects = this.baseRects;
    if (!base || !baseRects) return;
    L.mask.set(base);
    L.rects.length = 0;
    for (const r of baseRects) L.rects.push(r);
    for (const f of this.floods) {
      for (let k = 0; k < f.cellList.length; k++) L.mask[f.cellList[k]] = 1;
      for (const r of f.rects) L.rects.push(r);
    }
    this.surface.refreshBank();
    const ctx = this.ctx;
    const nav = ctx.nav as (GameContext['nav'] & { cellSize?: number }) | undefined;
    const arena = ctx.stage?.arena;
    if (nav && arena && typeof nav.build === 'function') nav.build(arena, nav.cellSize ?? 1);
    // 托回点落进新熔岩：就近换一个
    if (nearLava(L, this.safe.x, this.safe.z, LAVA.safeMargin)) this.relocateSafe();
    // 已经站在新熔岩上的地面敌人：挪到最近的可走点
    const list = ctx.enemies?.list;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i] as LavaEnemy;
        if (!e.alive || e.flying || e.isBoss || e.swimsInLava || !onLava(L, e.position.x, e.position.z)) continue;
        if (!nav?.nearestWalkable(e.position, _v) || onLava(L, _v.x, _v.z)) continue;
        e.position.x = _v.x; e.position.z = _v.z;
        e.velocity.x = 0; e.velocity.z = 0;
        const track = this.tracks.get(e);
        if (track) { track.x = _v.x; track.z = _v.z; }
      }
    }
  }

  /** 从当前托回点向外一圈圈找离熔岩 safeMargin 以外、导航可走的点 */
  private relocateSafe(): void {
    const L = this.lava, nav = this.ctx.nav, s = this.safe;
    for (let r = 0.75; r <= 16; r += 0.75) {
      const n = Math.max(8, Math.ceil((r * Math.PI * 2) / 1.2));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = s.x + Math.sin(a) * r, z = s.z + Math.cos(a) * r;
        if (nearLava(L, x, z, LAVA.safeMargin)) continue;
        if (nav && !nav.isWalkable(x, z)) continue;
        s.set(x, this.floorY, z);
        return;
      }
    }
  }

  // ───────────── 闪屏 ─────────────

  private updateFlash(dt: number): void {
    if (this.state === 'sinking') this.flash = Math.max(this.flash, 0.6);
    else this.flash = Math.max(0, this.flash - dt * 1.6);
    if (this.flash <= 0 && !this.overlay) return;
    const el = this.ensureOverlay();
    if (el) el.style.opacity = this.flash.toFixed(3);
  }

  private ensureOverlay(): HTMLDivElement | null {
    if (this.overlay || typeof document === 'undefined') return this.overlay;
    const el = document.createElement('div');
    el.className = 'lava-flash';
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:3;opacity:0;'
      + 'background:radial-gradient(ellipse at 50% 55%, rgba(255,150,40,.10) 0%, rgba(255,110,20,.32) 45%, rgba(230,60,0,.78) 82%, rgba(150,20,0,.92) 100%);';
    (document.getElementById('app') ?? document.body).appendChild(el);
    this.overlay = el;
    return el;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.endSink();
    this.overlay?.remove();
    this.overlay = null;
    this.group.removeFromParent();
    // 临时熔岩：把关卡数据里的掩码 / 矩形表还原（同一份数据可能被重新加载）
    if (this.baseMask && this.baseRects) {
      this.lava.mask.set(this.baseMask);
      this.lava.rects.length = 0;
      for (const r of this.baseRects) this.lava.rects.push(r);
    }
    this.floods.length = 0;
    this.surface.dispose();
  }
}

/**
 * 熔岩面：所有熔岩格合并成一张网格（一个 draw call），自发光流动熔岩 + 结壳板块的发光裂缝 + 岸边暗色硬壳
 * （岸距场存在一张 R8 纹理里）；一组上升火星（Points，一个 draw call）；一盏跟随玩家附近熔岩的橙色点光。
 */
export class LavaSurface {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly distTex: THREE.DataTexture;
  private readonly embers: THREE.Points;
  private readonly emberGeo = new THREE.BufferGeometry();
  private readonly emberMat: THREE.PointsMaterial;
  private readonly emberTex: THREE.DataTexture;
  private readonly emberLife = new Float32Array(EMBERS);
  private readonly emberSpeed = new Float32Array(EMBERS);
  private readonly emberPhase = new Float32Array(EMBERS);
  private readonly cells: Int32Array;
  private readonly light = new THREE.PointLight(0xff6a20, 0, 16, 2);
  private readonly lightAt = new THREE.Vector3();
  private lightScan = 0;
  private lightWant = 0;
  private seed = 0x9e3779b9;
  /** 临时熔岩的熔岩面（共用本熔岩面的材质；level 0 = 沉在地面下，1 = 涌满） */
  private readonly floodMeshes = new Map<object, { mesh: THREE.Mesh; level: number; target: number; rise: number }>();

  constructor(private readonly lava: WhiteboxLava, private readonly floorY: number) {
    this.group.name = 'lava-surface';
    const y = floorY + SURFACE_LIFT, pos: number[] = [], index: number[] = [];
    for (const r of lava.rects) {
      const b = pos.length / 3;
      pos.push(r.minX, y, r.minZ, r.maxX, y, r.minZ, r.maxX, y, r.maxZ, r.minX, y, r.maxZ);
      index.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geometry.setIndex(index);
    this.geometry.computeBoundingSphere();

    this.distTex = bankDistance(lava);
    const size = new THREE.Vector2(lava.cols * lava.cell, lava.rows * lava.cell);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uDist: { value: null }, uOrigin: { value: new THREE.Vector2(lava.minX, lava.minZ) },
        uSize: { value: size }, uMaxDist: { value: MAX_DIST_CELLS * lava.cell },
      }]),
      vertexShader: LAVA_VERT, fragmentShader: LAVA_FRAG, fog: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    });
    this.material.uniforms.uDist.value = this.distTex;
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.name = 'lava-surface';
    mesh.frustumCulled = false;
    this.group.add(mesh);

    // 火星：从玩家附近的熔岩格上升
    const cells: number[] = [];
    for (let i = 0; i < lava.mask.length; i++) if (lava.mask[i] === 1) cells.push(i);
    this.cells = Int32Array.from(cells);
    this.emberGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
    this.emberGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
    this.emberTex = emberSprite();
    this.emberMat = new THREE.PointsMaterial({ size: 0.2, map: this.emberTex, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: true });
    this.embers = new THREE.Points(this.emberGeo, this.emberMat);
    this.embers.name = 'lava-embers';
    this.embers.frustumCulled = false;
    for (let i = 0; i < EMBERS; i++) this.emberLife[i] = -this.rand() * 2.5; // 错开出生
    this.group.add(this.embers);

    this.light.name = 'lava-light';
    this.light.position.set(lava.minX, floorY - 50, lava.minZ);
    this.group.add(this.light);
  }

  private rand(): number {
    // xorshift32：表现用，不占用对局随机数
    let s = this.seed;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.seed = s >>> 0;
    return this.seed / 4294967296;
  }

  /** 玩家附近（±18 米）随机一个熔岩格中心；附近没有就全图随机 */
  private pickCell(near: THREE.Vector3, out: THREE.Vector3): void {
    const L = this.lava;
    for (let k = 0; k < 8; k++) {
      const x = near.x + (this.rand() - 0.5) * 36, z = near.z + (this.rand() - 0.5) * 36;
      if (onLava(L, x, z)) { out.set(x, 0, z); return; }
    }
    const c = this.cells[Math.floor(this.rand() * this.cells.length)] ?? 0;
    out.set(L.minX + ((c % L.cols) + this.rand()) * L.cell, 0, L.minZ + (Math.floor(c / L.cols) + this.rand()) * L.cell);
  }

  update(dt: number, t: number, player: THREE.Vector3): void {
    this.material.uniforms.uTime.value = t;
    // 火星
    const pa = this.emberGeo.getAttribute('position') as THREE.BufferAttribute;
    const ca = this.emberGeo.getAttribute('color') as THREE.BufferAttribute;
    const P = pa.array as Float32Array, C = ca.array as Float32Array;
    for (let i = 0; i < EMBERS; i++) {
      let life = this.emberLife[i] + dt;
      const j = i * 3;
      if (life >= 0 && (life > 2.6 || this.emberSpeed[i] === 0)) {
        this.pickCell(player, _v);
        P[j] = _v.x; P[j + 1] = this.floorY + 0.1; P[j + 2] = _v.z;
        this.emberSpeed[i] = 0.6 + this.rand() * 1.4;
        this.emberPhase[i] = this.rand() * 6.283;
        life = this.rand() * 0.3;
      }
      this.emberLife[i] = life;
      if (life < 0) { C[j] = C[j + 1] = C[j + 2] = 0; continue; }
      const sp = this.emberSpeed[i], ph = this.emberPhase[i];
      P[j] += Math.sin(t * 1.7 + ph) * 0.25 * dt;
      P[j + 1] += sp * dt;
      P[j + 2] += Math.cos(t * 1.3 + ph) * 0.25 * dt;
      const fade = Math.min(1, life * 4) * Math.max(0, 1 - life / 2.6);
      C[j] = fade; C[j + 1] = fade * (0.35 + 0.3 * Math.sin(ph)); C[j + 2] = fade * 0.06;
    }
    pa.needsUpdate = true;
    ca.needsUpdate = true;
    // 点光：每 0.15 秒找玩家 10 米内最近的熔岩，平滑移过去；附近没有熔岩就熄灭
    this.lightScan -= dt;
    if (this.lightScan <= 0) {
      this.lightScan = 0.15;
      this.lightWant = this.nearestLava(player, 10, this.lightAt) ? 1 : 0;
    }
    const k = 1 - Math.exp(-6 * dt);
    if (this.lightWant > 0) {
      if (this.light.intensity < 0.05) this.light.position.set(this.lightAt.x, this.floorY + 1.2, this.lightAt.z);
      this.light.position.x += (this.lightAt.x - this.light.position.x) * k;
      this.light.position.z += (this.lightAt.z - this.light.position.z) * k;
      this.light.position.y = this.floorY + 1.2;
    }
    const flicker = 0.85 + 0.15 * Math.sin(t * 9.1) * Math.sin(t * 5.3 + 1.2);
    this.light.intensity += (this.lightWant * 22 * flicker - this.light.intensity) * k;
    this.updateFloods(dt);
  }

  /** 临时熔岩的熔岩面：一张同材质的网格，从地面下 FLOOD_DEPTH 米涌上来 */
  addFlood(key: object, rects: readonly WhiteboxRect[], rise = 0.6): void {
    const y = this.floorY + SURFACE_LIFT, pos: number[] = [], index: number[] = [];
    for (const r of rects) {
      const b = pos.length / 3;
      pos.push(r.minX, y, r.minZ, r.maxX, y, r.minZ, r.maxX, y, r.maxZ, r.minX, y, r.maxZ);
      index.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.name = 'lava-flood';
    mesh.frustumCulled = false;
    mesh.position.y = -FLOOD_DEPTH;
    this.group.add(mesh);
    const r = (key as { rise?: number }).rise ?? rise;
    this.floodMeshes.set(key, { mesh, level: 0, target: 1, rise: r });
  }

  /** 临时熔岩撤掉：熔岩面退回地面下，然后释放 */
  sinkFlood(key: object): void {
    const f = this.floodMeshes.get(key);
    if (f) f.target = 0;
  }

  /** 熔岩掩码变了：按新的岸线重算岸边硬壳（距离纹理原地更新） */
  refreshBank(): void {
    fillBankDistance(this.lava, this.distTex.image.data as Uint8Array);
    this.distTex.needsUpdate = true;
  }

  private updateFloods(dt: number): void {
    for (const [key, f] of this.floodMeshes) {
      const step = dt / f.rise;
      f.level = f.target > f.level ? Math.min(f.target, f.level + step) : Math.max(f.target, f.level - step);
      const e = f.level * f.level * (3 - 2 * f.level);
      f.mesh.position.y = -FLOOD_DEPTH * (1 - e);
      f.mesh.visible = f.level > 0.001;
      if (f.target === 0 && f.level <= 0) {
        f.mesh.removeFromParent();
        f.mesh.geometry.dispose();
        this.floodMeshes.delete(key);
      }
    }
  }

  /** 半径 r 内离 p 最近的熔岩格中心 */
  private nearestLava(p: THREE.Vector3, r: number, out: THREE.Vector3): boolean {
    const L = this.lava, c = L.cell;
    const x0 = Math.max(0, Math.floor((p.x - r - L.minX) / c)), x1 = Math.min(L.cols - 1, Math.floor((p.x + r - L.minX) / c));
    const z0 = Math.max(0, Math.floor((p.z - r - L.minZ) / c)), z1 = Math.min(L.rows - 1, Math.floor((p.z + r - L.minZ) / c));
    let best = r * r, found = false;
    for (let iz = z0; iz <= z1; iz += 2) for (let ix = x0; ix <= x1; ix += 2) {
      if (L.mask[iz * L.cols + ix] !== 1) continue;
      const x = L.minX + (ix + 0.5) * c, z = L.minZ + (iz + 0.5) * c, d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < best) { best = d; out.set(x, 0, z); found = true; }
    }
    return found;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const f of this.floodMeshes.values()) f.mesh.geometry.dispose();
    this.floodMeshes.clear();
    this.geometry.dispose();
    this.material.dispose();
    this.distTex.dispose();
    this.emberGeo.dispose();
    this.emberMat.dispose();
    this.emberTex.dispose();
    this.light.dispose();
  }
}

/** 熔岩格到最近岸边的距离（格，倒角距离变换，上限 MAX_DIST_CELLS），编码成 R8 纹理 */
function bankDistance(lava: WhiteboxLava): THREE.DataTexture {
  const data = new Uint8Array(lava.cols * lava.rows);
  fillBankDistance(lava, data);
  const tex = new THREE.DataTexture(data, lava.cols, lava.rows, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** bankDistance 的距离变换本体：写进 data（cols × rows，0..255） */
function fillBankDistance(lava: WhiteboxLava, data: Uint8Array): void {
  const { cols, rows, mask } = lava, n = cols * rows, d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = mask[i] === 1 ? MAX_DIST_CELLS : 0;
  const D = Math.SQRT2;
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) {
    const i = z * cols + x;
    if (d[i] === 0) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (z > 0) {
      v = Math.min(v, d[i - cols] + 1);
      if (x > 0) v = Math.min(v, d[i - cols - 1] + D);
      if (x < cols - 1) v = Math.min(v, d[i - cols + 1] + D);
    }
    d[i] = v;
  }
  for (let z = rows - 1; z >= 0; z--) for (let x = cols - 1; x >= 0; x--) {
    const i = z * cols + x;
    if (d[i] === 0) continue;
    let v = d[i];
    if (x < cols - 1) v = Math.min(v, d[i + 1] + 1);
    if (z < rows - 1) {
      v = Math.min(v, d[i + cols] + 1);
      if (x < cols - 1) v = Math.min(v, d[i + cols + 1] + D);
      if (x > 0) v = Math.min(v, d[i + cols - 1] + D);
    }
    d[i] = v;
  }
  // 格子中心到岸的距离 ≈ (d - 0.5) 格；存成 0..255
  for (let i = 0; i < n; i++) data[i] = Math.round(Math.max(0, Math.min(1, (d[i] - 0.5) / MAX_DIST_CELLS)) * 255);
}

/** 火星贴图：16×16 径向渐变（不依赖 canvas） */
function emberSprite(): THREE.DataTexture {
  const s = 16, data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const r = Math.hypot(x + 0.5 - s / 2, y + 0.5 - s / 2) / (s / 2), a = Math.max(0, 1 - r) ** 1.6, i = (y * s + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(a * 255);
  }
  const tex = new THREE.DataTexture(data, s, s, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const LAVA_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec2 vXZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vXZ = wp.xz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const LAVA_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform sampler2D uDist;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform float uMaxDist;
varying vec2 vXZ;

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
// 结壳板块：到最近 / 次近种子点的距离（板块缝 = 两者之差小的地方）
vec2 plates(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(h21(n + g), h21(n + g + 19.19));
    o = 0.5 + 0.38 * sin(uTime * 0.22 + 6.2831 * o);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return vec2(d1, d2);
}

void main() {
  vec2 p = vXZ;
  // 缓慢翻涌的流向（域扭曲）
  vec2 q = vec2(fbm(p * 0.11 + vec2(uTime * 0.035, 0.0)), fbm(p * 0.11 + vec2(5.2, 1.3) - vec2(0.0, uTime * 0.03)));
  float heat = fbm(p * 0.28 + q * 2.6 + vec2(uTime * 0.06, -uTime * 0.045));
  vec2 v = plates(p * 0.32 + q * 1.4);
  float seam = 1.0 - smoothstep(0.0, 0.16, v.y - v.x);
  float plate = smoothstep(0.15, 0.75, v.x);
  // 离岸距离（米）：岸边一圈暗色硬壳，往里逐渐熔开
  float bank = texture2D(uDist, (p - uOrigin) / uSize).r * uMaxDist;
  float rim = 1.0 - smoothstep(0.1, 1.5, bank);
  float t = heat * 0.95 + seam * 0.75 - plate * 0.25 - 0.18;
  t = clamp(t * (1.0 - rim * 0.9), 0.0, 1.0);
  vec3 crust = vec3(0.045, 0.022, 0.016);
  vec3 c = mix(crust, vec3(0.42, 0.045, 0.01), smoothstep(0.08, 0.32, t));
  c = mix(c, vec3(1.0, 0.33, 0.035), smoothstep(0.3, 0.68, t));
  c = mix(c, vec3(1.0, 0.82, 0.38), smoothstep(0.74, 1.0, t));
  float pulse = 0.88 + 0.12 * sin(uTime * 1.6 + heat * 7.0);
  gl_FragColor = vec4(c * 1.55 * pulse, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const _v = new THREE.Vector3();
