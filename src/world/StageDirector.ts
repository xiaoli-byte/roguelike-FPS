/**
 * 关卡导演：生成 → 搭建 → 导航 → 放置玩家 → 按关卡类型布置（探索祭坛 / 波次 / Boss / 宝箱 / 商店），
 * 清关结算与出口传送门，最终胜利判定，以及防卡关（出界敌人拉回、残敌传送到玩家附近）。
 * 跨系统只通过 ctx 接口交互。
 */
import * as THREE from 'three';
import type { AdventureInfo, ArenaInfo, GameContext, IEnemy, IStageDirector, StageNode, ThemeDef, WavePlan } from '../core/types';
import { Rng } from '../core/Rng';
import { AssetLibrary } from '../assets/AssetLibrary';
import { buildEncounterWaves, buildWaves } from '../enemies/Waves';
import { ArenaView, addCollision } from './ArenaBuilder';
import { generateLevel, type LevelLayout } from './LevelGen';
import { NavGrid, type NavRamp } from './NavGrid';
import { UnityNavigation } from './UnityNavigation';
import { LavaSystem } from './Lava';
import { Portal } from './Portal';
import { redesignThemeDef, themeDef } from './Themes';
import { BOSS_LEAD, WaveRunner, isBossId } from './WaveRunner';
import { AdventureBeacon } from './AdventureBeacon';
import { ChallengeEntrance } from './ChallengeEntrance';
import { usesAuthoredLayout, usesRedesignLayout } from './WhiteboxMode';
import { generateWhitebox } from './WhiteboxGen';
import { buildWhiteboxAdventure, buildWhiteboxFights, whiteboxPlansForApproach, whiteboxSpawnRegion, type WhiteboxFight } from './WhiteboxEncounters';
import type { WhiteboxMetadata, WhiteboxPlan } from './WhiteboxTypes';
import { unityFightRewardFactor, unityFights, unityLayout } from './UnitySceneAdapter';
import { CombatDirector } from './CombatDirector';
import { LevelObjectives, loadLevelObjectives, objectiveDriven } from './objectives/LevelObjectives';
import { chooseLevelLayout } from './LevelLayout';
import { UnitySceneView } from './UnitySceneView';
import { UnityAtmosphereDressing } from './unityAtmosphereDressing';
import { desertArt, desertDocument, patchDesertDocument, prepareDesertArt } from './desert';
import { UnityLevelLibrary, prepareUnityScene, unityHeights, unityPoint, type UnitySceneDocument } from './UnityLevelLibrary';

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
const DISCOVERY_RADIUS = 5.5;
/** Reveal an available authored chest while crossing its room, well before interaction range. */
const AUTHORED_CHEST_VISIBILITY = 18;

const _v = new THREE.Vector3();

function insidePlanRoom(plan: WhiteboxPlan, roomId: string, position: { x: number; z: number }): boolean {
  const room = plan.rooms.find(r => r.id === roomId);
  if (!room) return false;
  const x = position.x + plan.bounds[0] / 2, z = position.z + plan.bounds[1] / 2;
  let inside = false;
  for (let i = 0, j = room.polygon.length - 1; i < room.polygon.length; j = i++) {
    const a = room.polygon[i], b = room.polygon[j];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const cross = (x - a[0]) * dz - (z - a[1]) * dx;
    if (Math.abs(cross) < 1e-7 && x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0])
      && z >= Math.min(a[1], b[1]) && z <= Math.max(a[1], b[1])) return true;
    if ((a[1] > z) !== (b[1] > z) && x < dx * (z - a[1]) / dz + a[0]) inside = !inside;
  }
  return inside;
}

/** Chapter names shown (stage banner, boss title) on V2 redesign plans, where the chapter got a new identity. */
const REDESIGN_CHAPTER_NAMES: Readonly<Record<string, string>> = { frost: '昆仑雪墟', inferno: '祝融火狱' };

function toArena(L: LevelLayout, theme: ThemeDef): ArenaInfo {
  const v = (p: { x: number; z: number }): THREE.Vector3 => new THREE.Vector3(p.x, L.floorY, p.z);
  return {
    minX: L.minX, minZ: L.minZ, maxX: L.maxX, maxZ: L.maxZ,
    floorY: L.floorY,
    playerSpawn: v(L.playerSpawn),
    playerYaw: L.playerYaw,
    spawnPoints: L.spawnPoints.map(v),
    spawnAnchors: L.adventure?.spawnAnchors?.map(p => ({ position: v(p), role: p.role, lane: p.lane, elevated: p.elevated })),
    rewardPoint: v(L.rewardPoint),
    portalPoints: L.portalPoints.map(v),
    shopPoint: v(L.shopPoint),
    center: v(L.center),
    theme,
    openTerrain: !!L.unityHeightfield,
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
  /** HUD 用的波次数；探索尚未启动、纯 Boss 关为 0。 */
  waveCount = 0;
  private adventureState: AdventureInfo | null = null;
  private beacon: AdventureBeacon | null = null;
  /** 探索状态只暴露给 HUD；支路奖励记录随关卡卸载，不会因来回走动重刷。 */
  get exploration(): AdventureInfo | null { return this.adventureState; }
  get whitebox(): WhiteboxMetadata | null { return this.layout?.whitebox ?? null; }
  /** Dev workbench viewpoints; these never change gameplay navigation or checkpoints. */
  get artInspectionViews() { return this.view?.artInspectionViews ?? []; }
  get artBrief() { return this.view?.artBrief ?? null; }

  private layout: LevelLayout | null = null;
  private view: ArenaView | UnitySceneView | null = null;
  /** 这张 Unity 场景按图摆的雾带 / 水面雾 / 落叶 / 鸟（docs/art/composition.md 8.5「按图摆位」） */
  private dressing: UnityAtmosphereDressing | null = null;
  private unityDocument: UnitySceneDocument | null = null;
  /** 战斗导演（游荡怪群；每张 Unity 图一个，正式的局才真正刷） */
  private director: CombatDirector | null = null;
  /** 关卡目标（灵火坛 N 选 M / 据点首领，objectives.json；4-1 / 4-3）：完成后清关开出口；其余关卡为 null */
  private objective: LevelObjectives | null = null;
  /** 关卡目标（调试 / 测试读） */
  get levelObjective(): LevelObjectives | null { return this.objective; }
  /** Chapter-3 lava floor (WhiteboxLava): hurts and returns the player, burns enemies knocked in. */
  private lava: LavaSystem | null = null;
  /** The current level's lava runtime (dev tools, tests); null on levels without lava. */
  get lavaSystem(): LavaSystem | null { return this.lava; }
  /** 地图机关挡着的据点 / 首领场（M7：3-3 风闸没拉开前的第二次进殿、关卡目标完成前的领主战）；机关系统挂上，卸载时撤掉 */
  fightGate: ((id: string) => boolean) | null = null;
  private waves: WaveRunner | null = null;
  private encounterWaves: WaveRunner | null = null;
  private activeEncounterId: string | null = null;
  private nextEncounterAt = 0;
  private whiteboxFights: WhiteboxFight[] = [];
  private activeWhiteboxFight: WhiteboxFight | null = null;
  private readonly encounterEye = new THREE.Vector3();
  private readonly encounterTarget = new THREE.Vector3();
  private portals: Portal[] = [];
  private challengeEntrances: ChallengeEntrance[] = [];
  private investigatedRooms = new Set<string>();
  private sideRooms = new Set<string>();
  /** Loot may already be cleared by Game; each shop disposer is idempotent. */
  private shopDisposers: (() => void)[] = [];
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

  load(stage: StageNode): Promise<void> {
    // 每局路线洗牌后槽位「1-1」可能用别的图（stage.map）
    const mapId = stage.map ?? `${stage.chapter + 1}-${stage.index + 1}`;
    // 第一章重做版：场景文档由白盒编出来（不读 Unity 导出的场景文件）
    const redo = desertDocument(mapId);
    if (redo) return redo.then(document => this.loadResolved(stage, document));
    const pending = UnityLevelLibrary.scene(mapId) as UnitySceneDocument | Promise<UnitySceneDocument | null> | null;
    if (pending && typeof (pending as Promise<UnitySceneDocument | null>).then === 'function') {
      return Promise.resolve(pending).then(document => this.loadResolved(stage, document));
    }
    return this.loadResolved(stage, pending as UnitySceneDocument | null);
  }

  private async loadResolved(stage: StageNode, document: UnitySceneDocument | null): Promise<void> {
    if (document) {
      await this.loadWith(stage, false, document);
      return;
    }
    try {
      await this.loadWith(stage, false, null);
    } catch (err) {
      // An authored plan that fails (missing roster, unreachable entrance, bad data) must not leave a
      // black, input-locked screen: fall back to the procedural map for this stage. Game handles a
      // second failure by returning to the menu.
      if (!usesAuthoredLayout()) throw err;
      console.error('[StageDirector] authored stage failed, using procedural fallback', err);
      this.unload();
      await this.loadWith(stage, true, null);
      this.ctx.ui.toast('本关布局载入失败，已改用备用地图', '#ff8a6a');
    }
  }

  private async loadWith(stage: StageNode, procedural: boolean, unityDocument: UnitySceneDocument | null): Promise<void> {
    if (this.stage || this.view) this.unload();
    const ctx = this.ctx;
    this.stage = stage;

    const rng = new Rng(ctx.run.seed ^ (stage.chapter * 7919 + stage.index * 104729 + 17));
    // 图内布局变体（LevelLayout）：这一局怎么走这张图——在搭场景之前把别的走法的出生点 / 出口 / 物体滤掉
    const layout = unityDocument ? chooseLevelLayout(unityDocument, ctx.run) : null;
    if (layout) unityDocument = layout.document;
    // 第一章美术重建层（src/world/desert/）：光照 / 雾 / 天空、地形外圈、场景件、据点锚点在搭场景之前改好
    if (unityDocument) {
      await prepareDesertArt(unityDocument.id);
      unityDocument = patchDesertDocument(unityDocument, desertArt(unityDocument.id));
    }
    this.unityDocument = unityDocument;
    if (unityDocument) await prepareUnityScene(unityDocument);
    const objectives = unityDocument ? await loadLevelObjectives(unityDocument.id) : null;
    const L = unityDocument ? unityLayout(unityDocument, stage, objectives)
      : usesAuthoredLayout() && !procedural ? generateWhitebox(stage, { redesign: usesRedesignLayout(stage.theme) }) : generateLevel(rng, stage, { adventure: AssetLibrary.enabled });
    if (unityDocument) {
      this.whiteboxFights = unityFights(unityDocument, { live: CombatDirector.live(ctx.run), objectives });
      this.director = new CombatDirector(ctx, unityDocument, stage, {
        siteActive: () => this.activeWhiteboxFight !== null, completed: () => this.cleared,
      }, layout?.allEncounters);
      if (L.adventure && unityDocument.map) L.adventure.mapImage = { url: unityDocument.map.url, area: unityDocument.map.area };
    } else if (L.whitebox) {
      this.whiteboxFights = buildWhiteboxFights(L, stage);
      L.adventure = buildWhiteboxAdventure(L, this.whiteboxFights);
    }
    this.layout = L;
    // A V2 redesign plan may rename its chapter (frost V2 is 昆仑雪墟; the LD-03 frost maps keep 霜雪古寺).
    // V2 plans also render with their own theme overrides (the V2 inferno forge palace is lit warm, LD-03 cold violet).
    const v2 = !!L.whitebox?.plan.id.endsWith('-v2');
    const base = v2 ? redesignThemeDef(stage.theme) : themeDef(stage.theme), renamed = v2 ? REDESIGN_CHAPTER_NAMES[stage.theme] : undefined;
    const theme = renamed ? { ...base, name: renamed } : base;
    const arena = toArena(L, theme);
    if (unityDocument) arena.killY = Math.min(-60, (unityDocument.navigation?.vertices ?? []).reduce((m, v) => Math.min(m, v[1]), Infinity) - 40);
    this.arena = arena;
    this.bossPoint.set(L.bossPoint.x, L.floorY, L.bossPoint.z);

    addCollision(ctx.world, L);
    if (unityDocument) for (const field of unityDocument.heightfields) ctx.world.addHeightfield({
      origin: unityPoint(field.origin), scale: unityPoint(field.scale), resolution: field.resolution, heights: unityHeights(field),
    });
    try {
      const vis = rng.fork(0x51ed);
      this.view = unityDocument ? new UnitySceneView(ctx, unityDocument) : new ArenaView(ctx, L, theme, () => vis.next());
      ctx.scene.add(this.view.group);
      if (this.view instanceof UnitySceneView && this.view.ready) await this.view.ready;
      if (unityDocument && this.view instanceof UnitySceneView) {
        // 氛围摆位是锦上添花：出了错只是这张图没有雾，不能挡住进关
        try {
          this.dressing = new UnityAtmosphereDressing(unityDocument, desertArt(unityDocument.id)?.layout);
          this.view.group.add(this.dressing.group);
        } catch (err) {
          console.warn('[StageDirector] 氛围摆位没建起来', err);
          this.dressing = null;
        }
      }
    } catch (err) {
      if (unityDocument) {
        this.view?.dispose();
        this.view = null;
        throw err;
      }
      // An authored scene that cannot be drawn would be an invisible maze; load() retries this stage
      // on the procedural map instead. That map's own failure keeps collision and play (old behaviour).
      if (usesAuthoredLayout() && !procedural) throw err;
      // 视觉搭建失败时保留碰撞与玩法，避免整局卡死
      console.error('[StageDirector] arena build failed', err);
      this.view = null;
    }
    if (ctx.nav instanceof UnityNavigation) ctx.nav.setUnityDocument(unityDocument);
    // Lava has no collision box: navigation blocks it directly (set before the grid is built).
    if (ctx.nav instanceof NavGrid) ctx.nav.setLava(L.whitebox?.lava ?? null);
    ctx.nav.build(arena);
    if (ctx.nav instanceof NavGrid) ctx.nav.setRamps(toNavRamps(L));
    ctx.player.teleport(arena.playerSpawn.clone(), arena.playerYaw);
    if (L.whitebox?.lava) {
      this.lava = new LavaSystem(ctx, L.whitebox.lava, L.floorY, arena.playerSpawn);
      ctx.scene.add(this.lava.group);
    }

    switch (stage.type) {
      case 'combat':
      case 'elite':
        if (L.adventure) this.setupAdventure(L, arena);
        else this.setupWaves(stage, arena);
        break;
      case 'boss':
        if (L.whitebox) {
          this.setupAdventure(L, arena);
          this.setupBossSupply(L, arena);
        }
        else this.setupWaves(stage, arena);
        break;
      case 'treasure':
        if (L.whitebox) this.setupAdventure(L, arena);
        ctx.loot.spawnChest(arena.rewardPoint.clone(), stage.reward === 'none' ? 'coins' : stage.reward);
        this.markFreeStage();
        break;
      case 'shop': {
        if (L.whitebox) this.setupAdventure(L, arena);
        const sp = arena.shopPoint;
        const yaw = Math.atan2(arena.playerSpawn.x - sp.x, arena.playerSpawn.z - sp.z);
        this.retainShop(ctx.loot.spawnShop(sp.clone(), yaw));
        if (stage.reward !== 'none') ctx.loot.spawnChest(arena.rewardPoint.clone(), stage.reward);
        this.markFreeStage();
        break;
      }
    }
    if (unityDocument && objectives && objectiveDriven(objectives)) {
      this.objective = new LevelObjectives(ctx, objectives, this.view?.group ?? ctx.stageGroup, {
        siteCleared: (title) => this.adventureState?.encounters?.find(e => e.id === title)?.phase === 'cleared',
        stageCode: unityDocument.id,
      });
    }
  }

  unload(): void {
    const ctx = this.ctx;
    this.waves?.cancel();
    this.encounterWaves?.cancel(); this.encounterWaves = null;
    this.director?.dispose(); this.director = null;
    this.objective?.dispose(); this.objective = null;
    this.activeEncounterId = null; this.nextEncounterAt = 0;
    this.whiteboxFights = [];
    this.activeWhiteboxFight = null;
    this.beacon?.dispose(); this.beacon = null; this.adventureState = null;
    this.challengeEntrances.forEach(entrance => entrance.dispose());
    this.challengeEntrances.length = 0;
    this.investigatedRooms.clear(); this.sideRooms.clear();
    this.shopDisposers.forEach(dispose => dispose());
    this.shopDisposers.length = 0;
    for (const p of this.portals) p.dispose();
    this.portals.length = 0;
    // 先于场景视图释放：视图卸载时会解绑空气透视
    this.dressing?.dispose();
    this.dressing = null;
    if (this.view) {
      this.view.dispose();
      this.view = null;
    }
    this.lava?.dispose(); this.lava = null;
    ctx.world.clear();
    if (ctx.nav instanceof NavGrid) { ctx.nav.setRamps([]); ctx.nav.setLava(null); }
    if (ctx.nav instanceof UnityNavigation) ctx.nav.setUnityDocument(null);
    ctx.scene.fog = null;
    if (this.bosses.length > 0) ctx.ui.setBoss(null);
    this.stage = null;
    this.arena = null;
    this.layout = null;
    this.unityDocument = null;
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

  private retainShop(dispose: (() => void) | void): void {
    // Older inspection fixtures implement spawnShop as a void-returning recorder.
    if (typeof dispose === 'function') this.shopDisposers.push(dispose);
  }

  private setupBossSupply(L: LevelLayout, arena: ArenaInfo): void {
    const plan = L.whitebox?.plan, preparation = plan?.preparation;
    if (!plan || !preparation) return;
    const center = new THREE.Vector3(preparation.at[0] - plan.bounds[0] / 2, arena.floorY,
      preparation.at[1] - plan.bounds[1] / 2);
    const yaw = Math.atan2(preparation.facing[0] - preparation.at[0], preparation.facing[1] - preparation.at[1]);
    this.retainShop(this.ctx.loot.spawnShop(center, yaw));
    if (this.adventureState) this.adventureState.preparation = {
      room: preparation.room, label: preparation.label, position: center.clone(),
    };
    this.ctx.ui.toast(`${preparation.label} · 可购买武器、秘卷、强化与战备补给；进入主战区才会迎战首领`, '#a9dec7');
  }

  private setupAdventure(L: LevelLayout, arena: ArenaInfo): void {
    const adventure = L.adventure;
    if (!adventure) return;
    const v = (p: { x: number; z: number }): THREE.Vector3 => new THREE.Vector3(p.x, L.floorY, p.z);
    this.adventureState = {
      phase: 'explore', objective: v(adventure.objective),
      ...(L.whitebox ? { automaticEncounters: true, objectiveLabel: this.whiteboxFights.find(f => f.final)?.label ?? '终点',
        floorRects: L.whitebox.floorRects } : {}),
      title: adventure.title, routeHint: adventure.routeHint,
      mapImage: adventure.mapImage,
      encounters: (adventure.encounters ?? []).map(e => ({
        id: e.id, label: e.label, kind: e.kind, position: v(e), radius: e.arenaRadius, triggerRadius: e.triggerRadius,
        phase: 'undiscovered', siteId: e.siteId,
        optional: this.whiteboxFights.find(f => f.id === e.id)?.optional,
      })),
      sites: adventure.sites.map(s => ({ id: s.id, label: s.label, position: v(s), visited: false })),
      zones: adventure.zones.map(z => ({ id: z.id, label: z.label, position: v(z), radius: z.radius })),
      paths: adventure.paths.map(p => ({ width: p.width, points: p.points.map(v) })),
    };
    const parent = this.view?.group ?? this.ctx.stageGroup;
    if (!L.whitebox) this.beacon = new AdventureBeacon(this.ctx, this.adventureState.objective, parent, () => this.activateAdventure(arena));
    else this.setupChallengeEntrances(L, arena, parent);
    this.ctx.ui.toast(adventure.routeHint ?? '探索支路寻找物资，准备好后在灵火祭坛启动试炼', '#ffda82');
  }

  private setupChallengeEntrances(L: LevelLayout, arena: ArenaInfo, parent: THREE.Object3D): void {
    const plan = L.whitebox!.plan;
    if (this.stage?.type !== 'combat' && this.stage?.type !== 'elite') return;
    const mainRooms = new Set(plan.mainRoute.flatMap(id => {
      const passage = plan.passages.find(p => p.id === id)!;
      return [passage.from, passage.to];
    }));
    const rooms = new Set([
      ...this.whiteboxFights.filter(f => f.optional).map(f => f.room),
      ...plan.rewards.filter(r => !mainRooms.has(r.room)).map(r => r.room),
    ]);
    for (const room of rooms) {
      const fight = this.whiteboxFights.find(f => f.optional && f.room === room);
      const passage = plan.passages.find(p => (p.from === room && mainRooms.has(p.to)) || (p.to === room && mainRooms.has(p.from)))
        ?? plan.passages.find(p => p.from === room || p.to === room);
      const at = passage ? (passage.from === room ? passage.points[0] : passage.points.at(-1)!)
        : plan.rooms.find(r => r.id === room)!.labelAt;
      const position = new THREE.Vector3(at[0] - plan.bounds[0] / 2, arena.floorY, at[1] - plan.bounds[1] / 2);
      const safe = new THREE.Vector3();
      if (!this.ctx.nav.nearestWalkable(position, safe)) {
        if (!this.unityDocument) throw new Error(`${plan.id}/${room}: no reachable challenge entrance`);
        safe.copy(position);
      }
      this.sideRooms.add(room);
      L.whitebox!.checkpoints.push({ id: `challenge-${room}`, label: `隐秘入口 · ${plan.rooms.find(r => r.id === room)!.label}`,
        x: safe.x, z: safe.z, yaw: Math.atan2(position.x - arena.center.x, position.z - arena.center.z) });
      this.challengeEntrances.push(new ChallengeEntrance(this.ctx, room, safe, parent,
        () => !this.encounterWaves && this.adventureState?.phase !== 'battle' && this.ctx.enemies.aliveCount() === 0
          && this.t >= this.nextEncounterAt && (!fight || fight.requires.every(id =>
            this.adventureState?.encounters?.find(e => e.id === id)?.phase === 'cleared')),
        () => {
          this.investigatedRooms.add(room);
          const info = this.adventureState?.encounters?.find(e => e.id === fight?.id);
          if (info) info.discovered = true;
          this.ctx.ui.toast(fight ? '支路挑战已开启 · 进入房间迎战守卫' : '入口已查明 · 深入房间探索', '#b591f2');
        },
        () => {
          const info = this.adventureState?.encounters?.find(e => e.id === fight?.id);
          if (info) info.discovered = true;
          this.ctx.ui.toast('发现隐秘入口 · 按 F 调查，或继续沿主路前进', '#b591f2');
        }));
    }
  }

  private activateAdventure(arena: ArenaInfo): boolean {
    const state = this.adventureState;
    if (!state || state.phase !== 'explore' || !this.stage || this.ctx.game.state !== 'playing' || !this.ctx.player.alive) return false;
    if (this.encounterWaves || this.ctx.enemies.aliveCount() > 0) {
      this.ctx.ui.toast('先解决正在交战的守卫，再启动祭坛试炼', '#ffb57c');
      return false;
    }
    state.phase = 'battle';
    const local = { ...arena, center: state.objective.clone(), spawnPoints: arena.spawnPoints.filter(p => {
      const d = Math.hypot(p.x - state.objective.x, p.z - state.objective.z);
      return d >= 12 && d <= 23;
    }) };
    this.setupWaves(this.stage, local, this.t, true);
    this.ctx.audio.play('telegraph', { position: state.objective, volume: .8, pitch: .8 });
    this.ctx.fx.ring(state.objective, 8, 0xffda82, 1.4);
    this.ctx.ui.banner('灵火试炼', '守卫正在集结 · 清场后开启出口', 2.6);
    return true;
  }

  /** Trigger a single local encounter; unopened side routes never add enemies to another fight. */
  private updateEncounters(): void {
    if (this.layout?.whitebox) { this.updateWhiteboxEncounters(); return; }
    const state = this.adventureState, source = this.layout?.adventure, arena = this.arena, stage = this.stage;
    const ctx = this.ctx;
    if (!state || !source || !arena || !stage || !ctx.player.alive || ctx.game.state !== 'playing') return;
    if (this.encounterWaves) {
      this.encounterWaves.update(this.t);
      if (this.encounterWaves.current >= 0) this.waveIndex = this.encounterWaves.current;
      if (this.encounterWaves.done && this.t - this.encounterWaves.lastActivity > .4 && ctx.enemies.aliveCount() === 0) {
        const encounter = state.encounters?.find(e => e.id === this.activeEncounterId);
        if (encounter) {
          encounter.phase = 'cleared';
          ctx.ui.toast(`${encounter.label} · 守卫已清除${encounter.siteId ? '，可收取物资' : '，继续探索'}`, '#a9dec7');
        }
        this.encounterWaves = null; this.activeEncounterId = null;
        this.activeWhiteboxFight = null;
        this.waveIndex = 0; this.waveCount = 0;
        this.nextEncounterAt = this.t + 1.5;
      }
      return;
    }
    if (state.phase !== 'explore' || this.t < this.nextEncounterAt || ctx.enemies.aliveCount() > 0) return;
    const player = ctx.player.position;
    if (Math.abs(player.y - arena.floorY) > 3) return;
    const candidates = (source.encounters ?? []).map((e, ordinal) => ({ e, ordinal,
      distance: Math.hypot(player.x - e.x, player.z - e.z),
      info: state.encounters?.find(info => info.id === e.id),
    })).filter(c => c.info?.phase === 'undiscovered' && c.distance <= c.e.triggerRadius)
      .sort((a, b) => a.distance - b.distance);
    this.encounterEye.copy(player); this.encounterEye.y += 1.2;
    const candidate = candidates.find(c => {
      this.encounterTarget.set(c.e.x, arena.floorY + 1.2, c.e.z);
      return !ctx.world.segmentBlocked(this.encounterEye, this.encounterTarget);
    });
    if (!candidate?.info || candidate.e.anchors.length === 0) return;
    const { e, ordinal, info } = candidate;
    const plans = buildEncounterWaves(ctx, stage, e.kind, ordinal);
    if (!plans.length) return;
    const anchors = e.anchors.map(a => ({ position: new THREE.Vector3(a.x, a.y ?? arena.floorY, a.z), role: a.role, lane: a.lane, elevated: a.elevated }));
    const local = { ...arena, center: info.position.clone(), spawnPoints: anchors.map(a => a.position), spawnAnchors: anchors };
    info.phase = 'active'; this.activeEncounterId = e.id;
    this.waveIndex = 0; this.waveCount = plans.length; this.lastProgress = this.t;
    this.encounterWaves = new WaveRunner(ctx, local, plans, this.t + .4, this.bossPoint,
      (i, n, boss) => this.onWaveStart(i, n, boss),
      { center: local.center, minRadius: 0, maxRadius: e.arenaRadius, minPlayerDistance: 10 });
    ctx.ui.banner(e.label, plans[0].hint ?? (e.kind === 'cache' ? '击败守卫后收取支路物资' : '留意两侧通道，可利用掩体周旋'), 2.5);
  }

  /** The reviewed plans end in their authored final room, with no extra altar wave. */
  private updateWhiteboxEncounters(): void {
    const state = this.adventureState, arena = this.arena, ctx = this.ctx;
    if (!state || !arena || !ctx.player.alive || ctx.game.state !== 'playing') return;
    if (this.encounterWaves) {
      this.encounterWaves.update(this.t);
      if (this.encounterWaves.current >= 0) this.waveIndex = this.encounterWaves.current;
      if (this.encounterWaves.done && this.t - this.encounterWaves.lastActivity > .4 && ctx.enemies.aliveCount() === 0) {
        const info = state.encounters?.find(e => e.id === this.activeEncounterId);
        // 据点首领（4-1 三领主）的结算横幅「X · 平息」由关卡目标在倒下 6.3 s 后打：这里不另报「守卫已清除」
        if (info) { info.phase = 'cleared'; if (!info.id.startsWith('boss:')) ctx.ui.toast(`${info.label} · 守卫已清除`, '#a9dec7'); }
        this.encounterWaves = null; this.activeEncounterId = null; this.activeWhiteboxFight = null;
        this.waveIndex = 0; this.waveCount = 0; this.nextEncounterAt = this.t + 1.5;
      }
      return;
    }
    if ((state.phase !== 'explore' && state.phase !== 'cleared') || this.t < this.nextEncounterAt || ctx.enemies.aliveCount() > 0) return;
    const player = ctx.player.position;
    // 白盒关卡是一整块平地，按 floorY 判断在不在场地层；Unity 开放图的高低起伏大，同 Unity EncounterSite 只看水平距离，
    // 首领场的高度由它自己的 contains 判断（UnitySceneAdapter：首领场地面 ±6 m）
    if (!this.unityDocument && Math.abs(player.y - arena.floorY) > 3) return;
    const plan = this.layout?.whitebox?.plan;
    if (this.stage?.type === 'boss' && plan?.preparation
      && insidePlanRoom(plan, plan.preparation.room, player)) return;
    const candidate = this.whiteboxFights.find(fight => {
      if (fight.optional && !this.investigatedRooms.has(fight.room)) return false;
      if (state.phase === 'cleared' && fight.final) return false;
      if (state.encounters?.find(e => e.id === fight.id)?.phase !== 'undiscovered') return false;
      if (fight.requires.some(id => state.encounters?.find(e => e.id === id)?.phase !== 'cleared')) return false;
      if (this.fightGate?.(fight.id)) return false;
      // A prepared boss starts across the main-room threshold, never from the shopping approach.
      if (this.stage?.type === 'boss' && plan?.preparation && !fight.contains(player)) return false;
      // Enter the actual room or its visible approach, never the same-radius room behind a wall.
      // Inside means some metres past the threshold (entryDepth), so the fight opens among the room's cover.
      const atApproach = Math.hypot(player.x - fight.facing.x, player.z - fight.facing.z) <= 3;
      if (!fight.contains(player, fight.entryDepth) && !atApproach) return false;
      // Unity 首领场同 Unity BossEncounter.PlayerInArena：场地范围 + 首领场地面 ±6 m（UnitySceneAdapter 的 contains）就开打，不看视线——
      // 2-4 的首领锚点在冰窟对岸、冰沿一圈 2.2 m 的冰窟边缘段挡着，出生营地又低于环台 8 m；3-3 的魔将出生在 10 m 高的火神殿高台上。
      // 只对首领场（boss:），普通遭遇照旧看视线
      if (this.unityDocument && fight.id.startsWith('boss:')) return true;
      this.encounterEye.copy(player); this.encounterEye.y += 1.2;
      this.encounterTarget.set(fight.facing.x, arena.floorY + 1.2, fight.facing.z);
      return !ctx.world.segmentBlocked(this.encounterEye, this.encounterTarget);
    });
    if (!candidate) return;
    const info = state.encounters!.find(e => e.id === candidate.id)!;
    // A shared encounter may be approached through a different room (the inn's north warehouse).
    info.position.set(candidate.position.x, arena.floorY, candidate.position.z);
    const anchors = candidate.anchors.map(p => ({ position: new THREE.Vector3(p.x, p.y ?? arena.floorY, p.z), role: p.role, lane: p.lane, elevated: p.elevated }));
    const local: ArenaInfo = { ...arena, center: info.position.clone(), spawnAnchors: anchors,
      spawnPoints: candidate.points.map(p => new THREE.Vector3(p.x, (p as { y?: number }).y ?? arena.floorY, p.z)) };
    info.phase = 'active'; this.activeEncounterId = candidate.id; this.activeWhiteboxFight = candidate; this.lastProgress = this.t;
    const plans = whiteboxPlansForApproach(candidate, this.layout!, player);
    const boss = plans.some(w => w.entries.some(e => isBossId(e.enemyId)));
    this.waveIndex = 0; this.waveCount = boss ? 0 : plans.length;
    const runner = new WaveRunner(ctx, local, plans, this.t + .4,
      new THREE.Vector3(candidate.position.x, arena.floorY, candidate.position.z),
      (i, n, hasBoss) => this.onWaveStart(i, n, hasBoss), whiteboxSpawnRegion(candidate, arena.floorY));
    if (candidate.final) { state.phase = 'battle'; this.waves = runner; }
    else this.encounterWaves = runner;
    // Unity 首领场的 label 是首领 id（boss_kunpeng…），首领刷出时另有名字横幅 / 登场演出的名字卡：这里不再压一条
    if (!(this.unityDocument && (candidate.final || candidate.id.startsWith('boss:')))) ctx.ui.banner(candidate.label, candidate.final ? '清除终点守卫后开启出口' : '当前房间遭遇 · 清场后可继续选路', 2.5);
  }

  private discoverSites(): void {
    const state = this.adventureState, adventure = this.layout?.adventure, player = this.ctx.player;
    if (!state || !adventure || !player.alive || this.ctx.game.state !== 'playing') return;
    const plan = this.layout?.whitebox?.plan;
    for (const site of state.sites) {
      if (site.visited || Math.abs(player.position.y - site.position.y) > 3
        || Math.hypot(player.position.x - site.position.x, player.position.z - site.position.z)
          > (plan ? AUTHORED_CHEST_VISIBILITY : DISCOVERY_RADIUS)) continue;
      const authoredReward = plan?.rewards[Number(site.id.replace('whitebox-cache-', ''))];
      if (authoredReward && this.sideRooms.has(authoredReward.room) && !this.investigatedRooms.has(authoredReward.room)) continue;
      if (authoredReward && !insidePlanRoom(plan!, authoredReward.room, player.position)) continue;
      // Quiet branches (shop/treasure) reuse a combat floor plan but build no fights;
      // a guard that never exists must not lock its cache forever.
      if (authoredReward?.requires !== undefined && this.whiteboxFights.length > 0) {
        if (authoredReward.requires.some(id => state.encounters?.find(e => e.id === id)?.phase !== 'cleared')) continue;
      } else {
        const guard = authoredReward ? state.encounters?.find(e => this.whiteboxFights.some(f => f.id === e.id && f.room === authoredReward.room))
          : state.encounters?.find(e => e.siteId === site.id);
        if (guard && guard.phase !== 'cleared') continue;
      }
      this.encounterEye.copy(player.position); this.encounterEye.y += 1.2;
      this.encounterTarget.copy(site.position); this.encounterTarget.y += .6;
      if (this.ctx.world.segmentBlocked(this.encounterEye, this.encounterTarget)) continue;
      // 先登记再产生掉落，交互/奖励回调即使在同帧再次更新，也不能重复发现。
      site.visited = true;
      const source = adventure.sites.find(s => s.id === site.id);
      const reward = authoredReward?.reward ?? source?.reward;
      if (reward && reward !== 'none') this.ctx.loot.spawnChest(site.position.clone(), reward);
      this.ctx.ui.toast(`发现 ${site.label} · 支路物资已出现`, '#ffda82');
    }
  }

  private setupWaves(stage: StageNode, arena: ArenaInfo, startAt = 0, local = false): void {
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
    const firstAt = startAt + (firstHasBoss ? BOSS_SPAWN_AT - BOSS_LEAD : FIRST_WAVE_AT);
    this.waves = new WaveRunner(ctx, arena, plans, firstAt, this.bossPoint, (i, n, boss) => this.onWaveStart(i, n, boss),
      local ? { center: arena.center, minRadius: 12, maxRadius: 23, minPlayerDistance: 12 } : undefined);
    this.lastProgress = startAt;
  }

  /** 宝藏 / 商店：无敌人，视为已通过（清关结算推迟到第一帧） */
  private markFreeStage(): void {
    this.cleared = true;
    this.freePending = true;
    if (this.layout?.whitebox && this.adventureState) this.adventureState.phase = 'cleared';
  }

  // ───────────── 每帧 ─────────────

  update(dt: number): void {
    if (!this.stage || !this.arena) return;
    const ctx = this.ctx;
    this.t += dt;
    const t = this.t;
    this.view?.update(dt, t);
    this.lava?.update(dt, t);
    this.beacon?.update(dt, t);
    for (const entrance of this.challengeEntrances) entrance.update(dt, t);
    this.updateEncounters();
    this.director?.update(dt);
    if (this.objective) {
      this.objective.update(dt);
      // 关卡目标完成（灵火 N / M）：没有遭遇在打时清关开出口（Unity LevelObjective.Completed → ExitPortal）
      if (this.objective.complete && !this.cleared && !this.encounterWaves && !this.waves) this.onCleared();
    }
    this.discoverSites();
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
    if (this.layout?.whitebox && this.adventureState) {
      this.adventureState.spawnBlocked = (this.encounterWaves ?? this.waves)?.waitingForSpace ?? false;
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
    const runner = this.encounterWaves ?? this.waves;
    // 据点开战（Unity EncounterSite.Activate → EncounterStarted，战鼓等秘卷听它）：一场只报一次；首领战（Unity BossEncounter）不报
    if (index === 0 && !runner?.waves.some(w => w.entries.some(e => isBossId(e.enemyId)))) {
      ctx.events.emit('encounter:started', { id: this.activeEncounterId, waves: total });
    }
    ctx.audio.play('wave_start');
    if (!hasBoss) {
      const plan = runner?.waves[index];
      ctx.ui.toast(plan?.label ? `${plan.label} · 第 ${index + 1} / ${total} 波`
        : total > 1 && index === total - 1 ? `第 ${index + 1} / ${total} 波 · 最后一波` : `第 ${index + 1} / ${total} 波`);
    }
  }

  private onEnemySpawned(e: IEnemy): void {
    if (!this.stage) return;
    this.lastProgress = this.t;
    // 据点加量摊薄 / 驻守点减半（Unity EncounterSite.RewardFactor）
    CombatDirector.applySiteReward(e, unityFightRewardFactor(this.activeWhiteboxFight));
    if (!e.isBoss) return;
    if (this.bosses.includes(e)) return;
    this.bosses.push(e);
    // 名号横幅与血条由关卡导演负责（Boss 登场结束时只补一条弱点提示）；吼叫与震屏由 Boss 自己的登场演出负责
    const ctx = this.ctx;
    // 有登场演出的首领（旱魃）由演出自己打电影式名字卡
    if (!(e as { introDirected?: boolean }).introDirected) ctx.ui.banner(e.displayName, this.arena ? `首领 · ${this.arena.theme.name}` : '首领', 3);
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
    if (this.adventureState) {
      this.adventureState.phase = 'cleared';
      // Legacy altar completion disperses patrols. Authored guarded loot instead
      // requires the actual room fight; skipping a branch cannot complete its prerequisite.
      for (const encounter of this.adventureState.encounters ?? []) {
        if (!this.layout?.whitebox || encounter.phase === 'active') encounter.phase = 'cleared';
      }
    }
    this.beacon?.setPhase('cleared');
    this.waves?.cancel();
    this.encounterWaves?.cancel(); this.encounterWaves = null; this.activeEncounterId = null;
    this.activeWhiteboxFight = null;
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

  /** 清关后只开启一个主线出口，可选挑战留在当前关卡。 */
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
    const parent = this.view?.group ?? ctx.stageGroup;
    const c = arena.center;
    {
      const p = pts.length > 0 ? pts[Math.min(pts.length - 1, 1)] : c;
      // 朝向竞技场中心，吸附到 90° 以便石框碰撞盒与模型一致
      const raw = Math.atan2(c.x - p.x, c.z - p.z);
      const yaw = Math.round(raw / (Math.PI / 2)) * (Math.PI / 2);
      // A portal shrine in the plan right at this exit (V2 levels) is the portal's frame.
      const plan = this.layout?.whitebox?.plan;
      const shrine = !!plan?.covers.some(c => c.art === 'shrine' && c.polygon.some(([x, z]) =>
        Math.hypot(x - plan.bounds[0] / 2 - p.x, z - plan.bounds[1] / 2 - p.z) < 6));
      this.portals.push(new Portal(ctx, opts[0], p, yaw, parent, 0, shrine));
      if (this.adventureState) this.adventureState.exit = p.clone();
    }
    ctx.ui.toast('主线出口已开启 · 可先回头探索，再前往下一关');
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
        || (p.y < a.floorY - 3 && !(ctx.world.groundHeight(p.x, p.z, p.y + 1) > p.y - 3)) || p.y > a.floorY + 40;
      if (!bad) continue;
      _v.set(
        Number.isFinite(p.x) ? Math.min(a.maxX - 1, Math.max(a.minX + 1, p.x)) : a.center.x,
        a.floorY,
        Number.isFinite(p.z) ? Math.min(a.maxZ - 1, Math.max(a.minZ + 1, p.z)) : a.center.z,
      );
      ctx.nav.nearestWalkable(_v, _v);
      // A non-finite body can never be hit or cleared: relax the keep-away rule, and if the room still
      // has no legal station, use the clamped walkable point rather than leave it at NaN.
      const corrupt = !Number.isFinite(p.x + p.y + p.z);
      if (!this.whiteboxRecoveryPoint(e, _v)) {
        if (!corrupt) continue;
        this.whiteboxRecoveryPoint(e, _v, true);
      }
      this.placeEnemy(e, _v, false);
    }

    // 最后 <= 2 只敌人长时间没有进展：传送到玩家附近（首领战中不算——玩家正在打首领）
    const w = this.encounterWaves ?? this.waves;
    if (w && w.done && (!this.cleared || this.encounterWaves !== null) && alive > 0 && alive <= 2 && this.bosses.length === 0) {
      const since = this.t - Math.max(this.lastProgress, w.lastActivity);
      if (since >= STRAGGLER_TIME) {
        this.lastProgress = this.t;
        let moved = 0;
        for (const e of ctx.enemies.list) {
          if (!e.alive || e.isBoss) continue;
          if (!ctx.nav.randomWalkable(ctx.player.position, 6, 11, _v)) continue;
          if (!this.whiteboxRecoveryPoint(e, _v)) continue;
          this.placeEnemy(e, _v, true);
          moved++;
        }
        if (moved > 0) ctx.ui.toast('残敌现身！');
      }
    }

    // 玩家掉出世界兜底
    const pp = ctx.player.position;
    // 低于 floorY 15 m 但脚下还有地面的不算掉出去（Unity 1-4：floorY 是台地上的出生点，月牙泉泉床低 17 m）
    if (ctx.player.alive && (!Number.isFinite(pp.x + pp.y + pp.z) || (pp.y < a.floorY - 15 && !(ctx.world.groundHeight(pp.x, pp.z, pp.y + 1) > pp.y - 3))
      || pp.x < a.minX - 3 || pp.x > a.maxX + 3 || pp.z < a.minZ - 3 || pp.z > a.maxZ + 3)) {
      ctx.player.teleport(a.playerSpawn.clone(), a.playerYaw);
    }
  }

  /** Recovery teleports obey the same room boundary as arrivals in the blockout. */
  private whiteboxRecoveryPoint(enemy: IEnemy, preferred: THREE.Vector3, nearPlayer = false): boolean {
    const fight = this.activeWhiteboxFight;
    if (!this.layout?.whitebox || !fight) return true;
    // radius and height already carry the art scale and elite scale.
    const width = enemy.radius + .15, height = enemy.height + .1;
    const player = this.ctx.player.position;
    const legal = (p: { x: number; z: number }) => (nearPlayer || Math.hypot(p.x - player.x, p.z - player.z) >= 10)
      && fight.contains(p, width) && this.ctx.nav.isWalkable(p.x, p.z)
      && !this.ctx.world.overlapsBody(p.x, this.arena!.floorY, p.z, width, height);
    if (legal(preferred)) return true;
    const best = fight.points.filter(legal).sort((a, b) => Math.hypot(a.x - preferred.x, a.z - preferred.z)
      - Math.hypot(b.x - preferred.x, b.z - preferred.z))[0];
    if (!best) return false;
    preferred.set(best.x, this.arena!.floorY, best.z); return true;
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
