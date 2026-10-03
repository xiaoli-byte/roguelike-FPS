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
import { NavGrid, type NavRamp } from './NavGrid';
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
/** 首领倒下后：1.2 秒时残余爪牙溃散，2.6 秒（死亡演出的最终爆炸前后）才结算清关 */
const BOSS_CLEANUP_DELAY = 1.2;
const BOSS_CLEAR_HOLD = 2.6;
const STUCK_CHECK = 0.5;
/** 最后 <= 2 只敌人这么久没有任何进展（击杀 / 刷怪）就把它们传送到玩家附近 */
const STRAGGLER_TIME = 30;
const CLEAR_ESSENCE = 10;
const BOSS_IDS = ['boss_colossus', 'boss_matriarch', 'boss_warlord'];

const _v = new THREE.Vector3();

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

function toNavRamps(L: LevelLayout): NavRamp[] {
  return L.ramps.map((r) => ({
    x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1,
    topY: L.floorY + r.top,
    sx0: r.sx0, sz0: r.sz0, sx1: r.sx1, sz1: r.sz1,
    foot: new THREE.Vector3(r.foot.x, L.floorY, r.foot.z),
    head: new THREE.Vector3(r.head.x, L.floorY + r.top, r.head.z),
  }));
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
  /** HUD 用的波次数；只有 Boss 的关卡为 0（不显示「第 1 / 1 波」） */
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
  /** 首领倒下后的清关结算最早时间 */
  private clearHoldUntil = -1;
  /** 宝藏 / 商店关：载入后第一帧再结算（保证 'stage:loaded' 先于 'stage:cleared'） */
  private freePending = false;
  private stuckTimer = 0;
  private lastProgress = 0;

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
    if (ctx.nav instanceof NavGrid) ctx.nav.setRamps(toNavRamps(L));
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
    if (ctx.nav instanceof NavGrid) ctx.nav.setRamps([]);
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
    this.clearHoldUntil = -1;
    this.freePending = false;
    this.stuckTimer = 0;
    this.lastProgress = 0;
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
    const bossOnly = plans.length > 0 && plans.every((w) => w.entries.length > 0 && w.entries.every((e) => isBossId(e.enemyId)));
    this.waveCount = bossOnly ? 0 : plans.length;
    this.waveIndex = 0;
    const firstHasBoss = plans.length > 0 && plans[0].entries.some((e) => isBossId(e.enemyId));
    const firstAt = firstHasBoss ? BOSS_SPAWN_AT - BOSS_LEAD : FIRST_WAVE_AT;
    this.waves = new WaveRunner(ctx, arena, plans, firstAt, this.bossPoint, (i, n, boss) => this.onWaveStart(i, n, boss));
    this.lastProgress = 0;
  }

  /** 宝藏 / 商店：无敌人，视为已通过（清关结算推迟到第一帧） */
  private markFreeStage(): void {
    this.cleared = true;
    this.freePending = true;
  }

  // ───────────── 每帧 ─────────────

  update(dt: number): void {
    if (!this.stage || !this.arena) return;
    const ctx = this.ctx;
    this.t += dt;
    const t = this.t;
    this.view?.update(dt, t);
    for (const p of this.portals) p.update(dt, t);

    if (this.freePending) {
      this.freePending = false;
      this.settleClear(this.stage);
      this.portalAt = t + PORTAL_DELAY_FREE;
    }
    if (this.waves && !this.cleared) {
      this.waves.update(t);
      if (this.waves.current >= 0) this.waveIndex = this.waves.current;
      if (this.waves.done && t - this.waves.lastActivity > 0.4 && t >= this.clearHoldUntil && ctx.enemies.aliveCount() === 0) this.onCleared();
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
    if (!hasBoss) ctx.ui.toast(total > 1 && index === total - 1 ? `第 ${index + 1} / ${total} 波 · 最后一波` : `第 ${index + 1} / ${total} 波`);
  }

  private onEnemySpawned(e: IEnemy): void {
    if (!this.stage) return;
    this.lastProgress = this.t;
    if (!e.isBoss) return;
    if (this.bosses.includes(e)) return;
    this.bosses.push(e);
    // 名号横幅与血条由关卡导演负责（Boss 登场结束时只补一条弱点提示）；吼叫与震屏由 Boss 自己的登场演出负责
    const ctx = this.ctx;
    ctx.ui.banner(e.displayName, this.arena ? `首领 · ${this.arena.theme.name}` : '首领', 3);
    ctx.ui.setBoss(e);
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
    // 不调用 setBoss(null)：血条自己显示「已击破」并在 1.8 秒后收起
    if (this.stage.type === 'boss' && !this.cleared) {
      // 首领倒下：取消剩余波次，残余爪牙随之溃散，等死亡演出接近尾声再结算
      this.waves?.cancel();
      this.cleanupAt = this.t + BOSS_CLEANUP_DELAY;
      this.clearHoldUntil = this.t + BOSS_CLEAR_HOLD;
      // 最终首领：胜利已定，不再因残留的弹幕 / 危险区判负
      if (ctx.runPlan.isFinalStage(this.stage)) this.protectPlayer(BOSS_CLEAR_HOLD + VICTORY_DELAY + 1);
    }
  }

  // ───────────── 清关 / 出口 ─────────────

  /** 清关结算：计数、魂晶、事件（战斗关清场时与宝藏 / 商店关载入后各一次） */
  private settleClear(stage: StageNode): void {
    const ctx = this.ctx;
    ctx.run.stagesCleared++;
    ctx.run.essence += CLEAR_ESSENCE;
    ctx.events.emit('stage:cleared', { stage });
  }

  private onCleared(): void {
    const stage = this.stage;
    const arena = this.arena;
    if (this.cleared || !stage || !arena) return;
    const ctx = this.ctx;
    this.cleared = true;
    this.waves?.cancel();
    this.bosses = [];
    this.settleClear(stage);
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
    this.ctx.ui.banner('灵火破晓', '深渊已平 · 凯旋而归', VICTORY_DELAY);
    this.protectPlayer(VICTORY_DELAY + 1);
    this.victoryAt = this.t + VICTORY_DELAY;
  }

  /** 胜负已定后的无敌（不覆盖更长的无敌，例如调试无敌） */
  private protectPlayer(seconds: number): void {
    const p = this.ctx.player;
    if (p.alive) p.invulnerableTime = Math.max(p.invulnerableTime, seconds);
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

  /**
   * 每 0.5 秒：出界 / 数值异常的敌人拉回场内；最后的残敌长时间没有进展时传送到玩家附近；玩家掉出世界兜底。
   * 寻常的「顶墙」由敌人自己的卡死绕行（StandardEnemy.navigate）与 EnemyBase 的侧向直线检测处理，
   * 这里不再做瞬移式推挤（人群互相推挤时会被误判，表现为敌人原地闪现）。
   */
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
      if (!bad) continue;
      _v.set(
        Number.isFinite(p.x) ? Math.min(a.maxX - 1, Math.max(a.minX + 1, p.x)) : a.center.x,
        a.floorY,
        Number.isFinite(p.z) ? Math.min(a.maxZ - 1, Math.max(a.minZ + 1, p.z)) : a.center.z,
      );
      ctx.nav.nearestWalkable(_v, _v);
      this.placeEnemy(e, _v, false);
    }

    // 最后 <= 2 只敌人长时间没有进展：传送到玩家附近（首领战中不算——玩家正在打首领）
    const w = this.waves;
    if (w && w.done && !this.cleared && alive > 0 && alive <= 2 && this.bosses.length === 0) {
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
