/**
 * 关卡导演：生成 → 搭建 → 导航 → 放置玩家 → 按关卡类型布置（波次 / Boss / 宝箱 / 商店），
 * 清关结算与出口传送门，最终胜利判定，以及防卡关（出界敌人拉回、残敌传送到玩家附近）。
 * 跨系统只通过 ctx 接口交互。
 */
import * as THREE from 'three';
import type { ArenaInfo, GameContext, IEnemy, IStageDirector, StageNode, ThemeDef, WavePlan } from '../core/types';
import { Rng } from '../core/Rng';
import { buildWaves } from '../enemies/Waves';
import { ArenaView, addCollision } from './ArenaBuilder';
import { generateLevel, type LevelLayout } from './LevelGen';
import { Portal } from './Portal';
import { themeDef } from './Themes';
import { BOSS_LEAD, WaveRunner, isBossId } from './WaveRunner';

/** 进场后第一波开始的时间（秒） */
const FIRST_WAVE_AT = 2;
/** Boss 进场 2.5 秒后刷出（开波时显示 BOSS_LEAD 秒预警） */
const BOSS_SPAWN_AT = 2.5;
const PORTAL_DELAY_CLEAR = 1.4;
const PORTAL_DELAY_FREE = 0.8;
const VICTORY_DELAY = 4;
const STUCK_CHECK = 0.5;
const STRAGGLER_TIME = 45;
/** 「顶墙」判定：速度 > 1.5 m/s 但 0.5 秒内位移 < 0.15 米，持续 1.5 秒即侧移 0.9 米 */
const WEDGE_SPEED = 1.5;
const WEDGE_MOVE = 0.15;
const WEDGE_TIME = 1.5;
const WEDGE_NUDGE = 0.9;
const CLEAR_ESSENCE = 10;
const BOSS_IDS = ['boss_colossus', 'boss_matriarch', 'boss_warlord'];

const _v = new THREE.Vector3();

interface WedgeInfo { x: number; z: number; stuck: number }

function toArena(L: LevelLayout, theme: ThemeDef): ArenaInfo {
  const v = (p: { x: number; z: number }): THREE.Vector3 => new THREE.Vector3(p.x, L.floorY, p.z);
  return {
    minX: L.minX, minZ: L.minZ, maxX: L.maxX, maxZ: L.maxZ,
    floorY: L.floorY,
    playerSpawn: v(L.playerSpawn),
    playerYaw: L.playerYaw,
    spawnPoints: L.spawnPoints.map(v),
    rewardPoint: v(L.rewardPoint),
    portalPoints: L.portalPoints.map(v),
    shopPoint: v(L.shopPoint),
    center: v(L.center),
    theme,
  };
}

/** 敌人模块没有给出波次时的兜底计划（按设计文档的章节敌人池） */
function fallbackWaves(ctx: GameContext, stage: StageNode): WavePlan[] {
  const rng = ctx.rng;
  const ch = Math.min(2, Math.max(0, stage.chapter));
  const pools = [
    stage.index >= 2 ? ['grunt', 'archer', 'bomber', 'brute'] : ['grunt', 'archer', 'bomber'],
    ['grunt', 'archer', 'wisp', 'shaman', 'marksman', 'bomber'],
    ['grunt', 'archer', 'brute', 'bomber', 'wisp', 'shaman', 'mortar', 'marksman'],
  ];
  const pool = pools[ch];
  const elite = stage.type === 'elite';
  const count = elite ? 2 : 3 + (ch >= 2 ? 1 : 0);
  const waves: WavePlan[] = [];
  for (let i = 0; i < count; i++) {
    const total = (elite ? 3 : 4) + ch + i + rng.int(0, 1);
    const entries = [];
    let left = total;
    while (left > 0) {
      const n = Math.min(left, rng.int(1, 3));
      entries.push({ enemyId: rng.pick(pool), count: n });
      left -= n;
    }
    if (elite || (ch >= 1 && i === count - 1)) entries.push({ enemyId: rng.pick(pool), count: 1, elite: true });
    waves.push({ entries, triggerRemaining: i === 0 ? 0 : 2, delay: 1.2 });
  }
  return waves;
}

export class StageDirector implements IStageDirector {
  stage: StageNode | null = null;
  arena: ArenaInfo | null = null;
  cleared = false;
  waveIndex = 0;
  waveCount = 0;

  private layout: LevelLayout | null = null;
  private view: ArenaView | null = null;
  private waves: WaveRunner | null = null;
  private portals: Portal[] = [];
  private exits: StageNode[] | null = null;
  private bosses: IEnemy[] = [];
  private readonly bossPoint = new THREE.Vector3();
  private t = 0;
  private portalAt = -1;
  private victoryAt = -1;
  private victoryDone = false;
  private cleanupAt = -1;
  private stuckTimer = 0;
  private lastProgress = 0;
  private readonly wedge = new Map<IEnemy, WedgeInfo>();

  constructor(readonly ctx: GameContext) {}

  init(): void {
    const ev = this.ctx.events;
    ev.on('enemy:spawned', ({ enemy }) => this.onEnemySpawned(enemy));
    ev.on('enemy:killed', ({ enemy }) => this.onEnemyKilled(enemy));
  }

  // ───────────── 载入 / 卸载 ─────────────

  load(stage: StageNode): void {
    if (this.stage || this.view) this.unload();
    const ctx = this.ctx;
    this.stage = stage;

    const rng = new Rng(ctx.run.seed ^ (stage.chapter * 7919 + stage.index * 104729 + 17));
    const L = generateLevel(rng, stage);
    this.layout = L;
    const theme = themeDef(stage.theme);
    const arena = toArena(L, theme);
    this.arena = arena;
    this.bossPoint.set(L.bossPoint.x, L.floorY, L.bossPoint.z);

    addCollision(ctx.world, L);
    try {
      const vis = rng.fork(0x51ed);
      this.view = new ArenaView(ctx, L, theme, () => vis.next());
      ctx.scene.add(this.view.group);
    } catch (err) {
      // 视觉搭建失败时保留碰撞与玩法，避免整局卡死
      console.error('[StageDirector] arena build failed', err);
      this.view = null;
    }
    ctx.nav.build(arena);
    ctx.player.teleport(arena.playerSpawn.clone(), arena.playerYaw);

    switch (stage.type) {
      case 'combat':
      case 'elite':
      case 'boss':
        this.setupWaves(stage, arena);
        break;
      case 'treasure':
        ctx.loot.spawnChest(arena.rewardPoint.clone(), stage.reward === 'none' ? 'coins' : stage.reward);
        this.markFreeStage();
        break;
      case 'shop': {
        const sp = arena.shopPoint;
        const yaw = Math.atan2(arena.playerSpawn.x - sp.x, arena.playerSpawn.z - sp.z);
        ctx.loot.spawnShop(sp.clone(), yaw);
        if (stage.reward !== 'none') ctx.loot.spawnChest(arena.rewardPoint.clone(), stage.reward);
        this.markFreeStage();
        break;
      }
    }
  }

  unload(): void {
    const ctx = this.ctx;
    for (const p of this.portals) p.dispose();
    this.portals.length = 0;
    if (this.view) {
      this.view.dispose();
      this.view = null;
    }
    ctx.world.clear();
    ctx.scene.fog = null;
    if (this.bosses.length > 0) ctx.ui.setBoss(null);
    this.stage = null;
    this.arena = null;
    this.layout = null;
    this.waves = null;
    this.exits = null;
    this.bosses = [];
    this.cleared = false;
    this.waveIndex = 0;
    this.waveCount = 0;
    this.t = 0;
    this.portalAt = -1;
    this.victoryAt = -1;
    this.victoryDone = false;
    this.cleanupAt = -1;
    this.stuckTimer = 0;
    this.lastProgress = 0;
    this.wedge.clear();
  }

  private setupWaves(stage: StageNode, arena: ArenaInfo): void {
    const ctx = this.ctx;
    let plans: WavePlan[] = [];
    try {
      plans = (buildWaves(ctx, stage) ?? []).filter((w) => w && Array.isArray(w.entries));
    } catch (err) {
      console.error('[StageDirector] buildWaves failed', err);
    }
    if (stage.type === 'boss') {
      const hasBoss = plans.some((w) => w.entries.some((e) => isBossId(e.enemyId)));
      if (!hasBoss) plans.unshift({ entries: [{ enemyId: BOSS_IDS[Math.min(2, Math.max(0, stage.chapter))], count: 1 }] });
    } else if (plans.length === 0) {
      plans = fallbackWaves(ctx, stage);
    }
    this.waveCount = plans.length;
    this.waveIndex = 0;
    const firstHasBoss = plans.length > 0 && plans[0].entries.some((e) => isBossId(e.enemyId));
    const firstAt = firstHasBoss ? BOSS_SPAWN_AT - BOSS_LEAD : FIRST_WAVE_AT;
    this.waves = new WaveRunner(ctx, arena, plans, firstAt, this.bossPoint, (i, n, boss) => this.onWaveStart(i, n, boss));
    this.lastProgress = 0;
  }

  /** 宝藏 / 商店：无敌人，直接视为已通过 */
  private markFreeStage(): void {
    this.cleared = true;
    this.ctx.run.stagesCleared++;
    this.portalAt = PORTAL_DELAY_FREE;
  }

  // ───────────── 每帧 ─────────────

  update(dt: number): void {
    if (!this.stage || !this.arena) return;
    const ctx = this.ctx;
    this.t += dt;
    const t = this.t;
    this.view?.update(dt, t);
    for (const p of this.portals) p.update(dt, t);

    if (this.waves && !this.cleared) {
      this.waves.update(t);
      if (this.waves.current >= 0) this.waveIndex = this.waves.current;
      if (this.waves.done && t - this.waves.lastActivity > 0.4 && ctx.enemies.aliveCount() === 0) this.onCleared();
    }
    if (this.cleanupAt >= 0 && t >= this.cleanupAt) {
      this.cleanupAt = -1;
      if (ctx.enemies.aliveCount() > 0) ctx.enemies.killAll();
    }
    if (this.portalAt >= 0 && t >= this.portalAt) {
      this.portalAt = -1;
      this.openExits();
    }
    if (this.victoryAt >= 0 && !this.victoryDone && t >= this.victoryAt) {
      this.victoryDone = true;
      this.victoryAt = -1;
      if (ctx.game.state === 'playing') ctx.game.endRun(true);
    }
    this.stuckTimer -= dt;
    if (this.stuckTimer <= 0) {
      this.stuckTimer = STUCK_CHECK;
      this.antiStuck();
    }
  }

  // ───────────── 波次 / Boss ─────────────

  private onWaveStart(index: number, total: number, hasBoss: boolean): void {
    const ctx = this.ctx;
    this.waveIndex = index;
    this.lastProgress = this.t;
    ctx.events.emit('wave:started', { index, total });
    ctx.audio.play('wave_start');
    if (!hasBoss) ctx.ui.toast(`第 ${index + 1} / ${total} 波`);
  }

  private onEnemySpawned(e: IEnemy): void {
    if (!this.stage) return;
    this.lastProgress = this.t;
    if (!e.isBoss) return;
    if (this.bosses.includes(e)) return;
    this.bosses.push(e);
    const ctx = this.ctx;
    ctx.ui.banner(e.displayName, '首领', 3);
    ctx.audio.play('boss_roar');
    ctx.ui.setBoss(e);
    ctx.fx.shake(0.5, 0.9);
  }

  private onEnemyKilled(e: IEnemy): void {
    if (!this.stage) return;
    this.lastProgress = this.t;
    if (!e.isBoss) return;
    this.bosses = this.bosses.filter((b) => b !== e && b.alive);
    const ctx = this.ctx;
    if (this.bosses.length > 0) {
      ctx.ui.setBoss(this.bosses[0]);
      return;
    }
    ctx.ui.setBoss(null);
    if (this.stage.type === 'boss' && !this.cleared) {
      // 首领倒下：取消剩余波次，残余爪牙随之溃散
      this.waves?.cancel();
      this.cleanupAt = this.t + 1.2;
    }
  }

  // ───────────── 清关 / 出口 ─────────────

  private onCleared(): void {
    const stage = this.stage;
    const arena = this.arena;
    if (this.cleared || !stage || !arena) return;
    const ctx = this.ctx;
    this.cleared = true;
    this.waves?.cancel();
    if (this.bosses.length > 0) {
      this.bosses = [];
      ctx.ui.setBoss(null);
    }
    ctx.run.stagesCleared++;
    ctx.run.essence += CLEAR_ESSENCE;
    ctx.events.emit('stage:cleared', { stage });
    ctx.audio.play('stage_clear');

    const next = ctx.runPlan.nextOptions(ctx.run);
    this.exits = next;
    if (next.length === 0) {
      this.scheduleVictory();
    } else {
      const sub = stage.type === 'boss'
        ? '首领伏诛 · 生命已完全恢复'
        : stage.reward !== 'none' ? `奖励：${ctx.runPlan.rewardLabel(stage.reward)}` : '前路已开';
      ctx.ui.banner('区域肃清', sub, 2.8);
      if (stage.reward !== 'none') ctx.loot.spawnChest(arena.rewardPoint.clone(), stage.reward);
      this.portalAt = this.t + PORTAL_DELAY_CLEAR;
    }
    if (stage.type === 'boss' && ctx.player.alive) ctx.player.heal(ctx.player.maxHp());
  }

  private scheduleVictory(): void {
    if (this.victoryAt >= 0 || this.victoryDone) return;
    this.ctx.ui.banner('轮回终焉', '胜利', 4);
    this.victoryAt = this.t + VICTORY_DELAY;
  }

  /** 在远端生成 1–3 个出口传送门 */
  private openExits(): void {
    const arena = this.arena;
    if (!arena) return;
    const ctx = this.ctx;
    const opts = this.exits ?? ctx.runPlan.nextOptions(ctx.run);
    this.exits = null;
    if (opts.length === 0) {
      this.scheduleVictory();
      return;
    }
    const pts = arena.portalPoints;
    const n = Math.min(3, opts.length);
    const slots = n === 1 ? [1] : n === 2 ? [0, 2] : [0, 1, 2];
    const parent = this.view?.group ?? ctx.stageGroup;
    const c = arena.center;
    for (let i = 0; i < n; i++) {
      const p = pts.length > 0 ? pts[Math.min(pts.length - 1, slots[i])] : c;
      // 朝向竞技场中心，吸附到 90° 以便石框碰撞盒与模型一致
      const raw = Math.atan2(c.x - p.x, c.z - p.z);
      const yaw = Math.round(raw / (Math.PI / 2)) * (Math.PI / 2);
      this.portals.push(new Portal(ctx, opts[i], p, yaw, parent, i * 0.3));
    }
    ctx.ui.toast(n > 1 ? '出口已开启，选择你的道路' : '出口已开启');
  }

  // ───────────── 防卡关 ─────────────

  private antiStuck(): void {
    const ctx = this.ctx;
    const a = this.arena;
    if (!a) return;
    let alive = 0;
    for (const e of ctx.enemies.list) {
      if (!e.alive) continue;
      alive++;
      const p = e.position;
      const bad = !Number.isFinite(p.x + p.y + p.z)
        || p.x < a.minX - 0.5 || p.x > a.maxX + 0.5 || p.z < a.minZ - 0.5 || p.z > a.maxZ + 0.5
        || p.y < a.floorY - 3 || p.y > a.floorY + 40;
      if (!bad) {
        this.checkWedged(e);
        continue;
      }
      _v.set(
        Number.isFinite(p.x) ? Math.min(a.maxX - 1, Math.max(a.minX + 1, p.x)) : a.center.x,
        a.floorY,
        Number.isFinite(p.z) ? Math.min(a.maxZ - 1, Math.max(a.minZ + 1, p.z)) : a.center.z,
      );
      ctx.nav.nearestWalkable(_v, _v);
      this.placeEnemy(e, _v, false);
    }

    for (const e of this.wedge.keys()) if (!e.alive) this.wedge.delete(e);

    // 最后 <= 2 只敌人 45 秒没有进展：传送到玩家附近
    const w = this.waves;
    if (w && w.done && !this.cleared && alive > 0 && alive <= 2) {
      const since = this.t - Math.max(this.lastProgress, w.lastActivity);
      if (since >= STRAGGLER_TIME) {
        this.lastProgress = this.t;
        let moved = 0;
        for (const e of ctx.enemies.list) {
          if (!e.alive || e.isBoss) continue;
          if (!ctx.nav.randomWalkable(ctx.player.position, 6, 11, _v)) continue;
          this.placeEnemy(e, _v, true);
          moved++;
        }
        if (moved > 0) ctx.ui.toast('残敌现身！');
      }
    }

    // 玩家掉出世界兜底
    const pp = ctx.player.position;
    if (ctx.player.alive && (!Number.isFinite(pp.x + pp.y + pp.z) || pp.y < a.floorY - 15
      || pp.x < a.minX - 3 || pp.x > a.maxX + 3 || pp.z < a.minZ - 3 || pp.z > a.maxZ + 3)) {
      ctx.player.teleport(a.playerSpawn.clone(), a.playerYaw);
    }
  }

  /**
   * 顶墙检测：敌人想走（速度不小）却几乎没挪动，多半是沿直线顶在障碍物端面上。
   * 持续 1.5 秒后把它沿垂直于速度的方向侧移 0.9 米（目标点可走且不与静态几何重叠）。
   * 原地站桩的敌人速度接近 0，不会被误判。
   */
  private checkWedged(e: IEnemy): void {
    if (e.flying || e.isBoss) return;
    const w = this.wedge.get(e);
    if (!w) {
      this.wedge.set(e, { x: e.position.x, z: e.position.z, stuck: 0 });
      return;
    }
    const p = e.position;
    const moved = Math.hypot(p.x - w.x, p.z - w.z);
    const sp = Math.hypot(e.velocity.x, e.velocity.z);
    w.x = p.x;
    w.z = p.z;
    if (e.stunTime > 0 || sp < WEDGE_SPEED || moved > WEDGE_MOVE) {
      w.stuck = 0;
      return;
    }
    w.stuck += STUCK_CHECK;
    if (w.stuck < WEDGE_TIME) return;
    w.stuck = 0;
    const ux = e.velocity.x / sp;
    const uz = e.velocity.z / sp;
    const ctx = this.ctx;
    const first = ctx.rng.chance(0.5) ? 1 : -1;
    for (let k = 0; k < 4; k++) {
      const side = k % 2 === 0 ? first : -first;
      const back = k < 2 ? 0 : 0.5;
      let ox = -uz * side - ux * back;
      let oz = ux * side - uz * back;
      const l = Math.hypot(ox, oz);
      ox /= l;
      oz /= l;
      const nx = p.x + ox * WEDGE_NUDGE;
      const nz = p.z + oz * WEDGE_NUDGE;
      if (!ctx.nav.isWalkable(nx, nz)) continue;
      if (ctx.world.overlapsBody(nx, p.y + 0.02, nz, e.radius * 0.85, e.height)) continue;
      p.x = nx;
      p.z = nz;
      w.x = nx;
      w.z = nz;
      return;
    }
  }

  private placeEnemy(e: IEnemy, to: THREE.Vector3, fx: boolean): void {
    const floor = this.arena?.floorY ?? 0;
    e.position.set(to.x, floor + (e.flying ? 2.5 : 0.05), to.z);
    e.velocity.set(0, 0, 0);
    if (fx) {
      this.ctx.fx.spawnEffect(e.position, e.def.color ?? 0xff4455);
      this.ctx.audio.play('enemy_spawn', { position: e.position, volume: 0.6 });
    }
  }
}
