import * as THREE from 'three';
import type { GameContext, GameState, HeroDef, IGame, RunState, RunSummary, StageNode, System, WeaponInstance, WeaponSave } from './types';
import { EventBus } from './EventBus';
import { Input } from './Input';
import { Rng } from './Rng';
import { TaskRunner } from './Tasks';
import { CollisionWorld } from '../world/Collision';
import { loadSettings, saveSettings } from './settings';
import { FrameLimiter, targetFrameRate } from './GameSettings';
import { TimePriority, arbiterFor, type TimeScaleArbiter, type TimeScaleHandle } from './TimeScaleArbiter';
import { GameStateMachine } from './GameStateMachine';
import { HitStop } from './HitStop';
import { ClearSlowMo, EncounterClearWatcher } from './ClearSlowMo';
import { qualityProfile, renderPixelRatio } from './QualityTiers';
import { DistanceCuller, cullDistances, type MeshLike } from './CullLayers';

import { MetaProgress } from '../progression/Meta';
import { RunPlanner, setCurrentRun } from '../progression/RunPlan';
import { hasStageCatalog } from '../progression/StagePlan';
import * as Suspend from '../progression/RunSuspend';
import { ScrollSystem } from '../progression/Scrolls';
import { LootSystem } from '../progression/Loot';
import { InteractionSystem } from '../progression/Interaction';
import { HEROES } from '../player/Heroes';
import { PlayerController } from '../player/PlayerController';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { EnemyManager } from '../enemies/EnemyManager';
import { registerStandardEnemies } from '../enemies';
import { registerBosses } from '../enemies/bosses';
import { Combat } from '../combat/Combat';
import { ProjectileSystem } from '../combat/Projectiles';
import { UnityNavigation } from '../world/UnityNavigation';
import { StageDirector } from '../world/StageDirector';
import { AssetLibrary } from '../assets/AssetLibrary';
import { FxSystem } from '../fx/Fx';
import { AudioSystem } from '../audio/AudioSystem';
import { UIManager } from '../ui/UI';
import { PerformanceMeter } from '../dev/PerformanceMeter';
import { PostStack } from '../render/PostStack';

function placeholderRun(): RunState {
  const stage: StageNode = { chapter: 0, index: 0, type: 'combat', reward: 'none', theme: 'desert' };
  return {
    heroId: '', seed: 1, chapter: 0, stageIndex: 0, stage, coins: 0, kills: 0, damageDealt: 0,
    time: 0, stagesCleared: 0, essence: 0, difficulty: 1, flags: {},
  };
}

/**
 * 顶层游戏对象：创建渲染器与全部系统、驱动主循环、管理状态机（菜单 / 游戏 / 暂停 / 模态 / 结算）。
 *
 * M11d（docs/threejs-migration.md 4.7，照 Unity G/Core）：
 *   · 状态走 {@link GameStateMachine}（底层状态 + 模态栈：暂停、模态各是栈上的一项）；
 *   · 时间只由 {@link TimeScaleArbiter} 写：暂停 / 模态停住时间、阵亡慢动作 0.3、顿帧（{@link HitStop}）、清场慢动作（{@link ClearSlowMo}）；
 *   · 一局结束走 MetaProgress.bankRun（同一局只结一次）；每进一关写续玩档（progression/RunSuspend），主菜单「继续征程」、暂停菜单暂离；
 *   · 画质档（core/QualityTiers）的渲染比例、按距离剔除小件（core/CullLayers）、帧率上限。
 */
export class Game implements IGame {
  readonly ctx: GameContext;
  readonly debug: boolean;
  /** Created only with ?perf=1. The normal game has no profiling allocation or UI. */
  readonly performanceMeter: PerformanceMeter | null;
  /** 时间缩放仲裁（一个 ctx.time 一份，首领框架、后处理用的是同一个） */
  readonly timeArbiter: TimeScaleArbiter;
  readonly fsm: GameStateMachine;
  readonly hitStop: HitStop;
  readonly clearSlowMo: ClearSlowMo;
  /** 小件 / 散布件的距离剔除（只管 Unity 场景文档里的静态网格） */
  readonly culler = new DistanceCuller();
  private readonly clearWatcher = new EncounterClearWatcher();
  private readonly frameLimiter = new FrameLimiter();
  private readonly pauseKey = { name: 'pause' };
  private readonly modalKey = { name: 'modal' };
  private deathSlowMo: TimeScaleHandle | null = null;
  private lastFrame = 0;
  private updateOrder: System[] = [];
  private passiveDispose: (() => void) | null = null;
  private deathPending = false;
  private pausedAt = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  fps = 0;
  private inspectionView: (() => THREE.Camera | null) | null = null;
  /** 后处理栈（Unity 场景、画质中 / 高时接管渲染；src/render/PostStack.ts） */
  private readonly post: PostStack;

  /** Separate inspection camera; the real player's camera and controls stay intact. */
  setInspectionView(view: (() => THREE.Camera | null) | null): void { this.inspectionView = view; }

  constructor() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const root = document.getElementById('app') as HTMLElement;
    const worldLayer = document.getElementById('world-layer') as HTMLElement;
    const uiRoot = document.getElementById('ui-root') as HTMLElement;
    this.debug = new URLSearchParams(location.search).has('debug');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    // three r186 已移除 PCFSoft（首次渲染阴影时会被改成 PCF）；直接用 PCF，否则在那之前预编译的着色器缓存键对不上、全部白编
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.autoClear = false;
    renderer.setClearColor(0x07080b, 1);

    const scene = new THREE.Scene();
    const stageGroup = new THREE.Group();
    stageGroup.name = 'stageGroup';
    scene.add(stageGroup);
    const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.05, 500);
    camera.rotation.order = 'YXZ';
    scene.add(camera);

    const viewScene = new THREE.Scene();
    const viewCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 20);
    viewScene.add(viewCamera);
    viewScene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3440, 1.6));
    const vmSun = new THREE.DirectionalLight(0xffffff, 1.8);
    vmSun.position.set(0.6, 1, 0.4);
    viewScene.add(vmSun);

    const input = new Input(canvas);
    if (this.debug) input.freeLook = true;

    // 先构造核心部分，再逐个挂系统（构造函数里不得访问其他系统）
    const ctx = {
      scene, stageGroup, camera, viewScene, viewCamera, renderer,
      dom: { root, canvas, world: worldLayer, ui: uiRoot },
      input,
      events: new EventBus(),
      world: new CollisionWorld(),
      rng: new Rng(Date.now() >>> 0),
      tasks: new TaskRunner(),
      time: { now: 0, dt: 0, timeScale: 1, frame: 0 },
      cameraFx: { shakeIntensity: 0, shakeTime: 0, fovKick: 0 },
      settings: loadSettings(),
      run: placeholderRun(),
      game: this as IGame,
      heroes: HEROES as readonly HeroDef[],
    } as unknown as Record<string, unknown>;
    this.ctx = ctx as unknown as GameContext;
    this.timeArbiter = arbiterFor(this.ctx.time);
    this.fsm = new GameStateMachine(this.timeArbiter, (from, to) => this.ctx.events.emit('game:stateChanged', { from, to }));
    const realClock = () => performance.now() / 1000;
    const host = { clock: realClock, isPlaying: () => this.fsm.isPlaying, playerDead: () => !this.ctx.player?.alive };
    this.hitStop = new HitStop(this.timeArbiter, host);
    this.clearSlowMo = new ClearSlowMo(this.timeArbiter, host);
    this.performanceMeter = new URLSearchParams(location.search).get('perf') === '1'
      ? new PerformanceMeter(renderer, () => ({
        quality: this.ctx.settings.quality, theme: this.ctx.run.stage.theme, gameState: this.state,
        chapter: this.ctx.run.stage.chapter, stageIndex: this.ctx.run.stage.index, stageType: this.ctx.run.stage.type,
        phase: this.ctx.stage.exploration?.encounters?.some(e => e.phase === 'active') ? 'encounter' : this.ctx.stage.exploration?.phase ?? this.ctx.run.stage.type,
        encounter: this.ctx.stage.exploration?.encounters?.find(e => e.phase === 'active')?.id ?? '',
        enemies: this.ctx.enemies.aliveCount(),
      })) : null;
    const c = this.ctx as unknown as Record<string, unknown>;
    // 先于各系统建：它的 stage:loaded 监听要排在特效 / 弹体的着色器预热之前（先切渲染状态，预热编的才是后处理用的变体）
    this.post = new PostStack(this.ctx);

    c.meta = new MetaProgress(this.ctx);
    c.runPlan = new RunPlanner(this.ctx);
    c.audio = new AudioSystem(this.ctx);
    c.fx = new FxSystem(this.ctx);
    c.ui = new UIManager(this.ctx);
    c.nav = new UnityNavigation(this.ctx);
    c.stage = new StageDirector(this.ctx);
    c.combat = new Combat(this.ctx);
    c.projectiles = new ProjectileSystem(this.ctx);
    c.enemies = new EnemyManager(this.ctx);
    c.weapons = new WeaponSystem(this.ctx);
    c.player = new PlayerController(this.ctx);
    c.scrolls = new ScrollSystem(this.ctx);
    c.loot = new LootSystem(this.ctx);
    c.interact = new InteractionSystem(this.ctx);

    registerStandardEnemies();
    registerBosses();

    const x = this.ctx;
    // 玩法系统（仅 playing 时更新），顺序即更新顺序
    this.updateOrder = [x.player, x.weapons, x.enemies, x.projectiles, x.combat, x.loot, x.interact, x.stage, x.scrolls];
    const all: System[] = [x.meta, x.audio, x.fx, x.ui, x.nav as unknown as System, x.stage, x.combat, x.projectiles, x.enemies, x.weapons, x.player, x.scrolls, x.loot, x.interact];
    for (const s of all) s.init?.();

    input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.debug) this.pause();
    };
    canvas.addEventListener('click', () => {
      this.ctx.audio.unlock();
      if (this.state === 'playing' && !input.pointerLocked) input.requestLock();
    });
    window.addEventListener('pointerdown', () => this.ctx.audio.unlock(), { once: true });
    window.addEventListener('keydown', () => this.ctx.audio.unlock(), { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing' && !this.debug) this.pause();
    });
    window.addEventListener('resize', () => this.resize());

    x.events.on('player:died', () => this.onPlayerDied());

    // 顿帧的内置来源（Unity HitStop.OnKilled / OnDamaged / OnReacted）与清场慢动作的击杀计数
    x.events.on('enemy:killed', ({ enemy, result }) => {
      this.clearWatcher.noteKill();
      this.hitStop.onKilled(enemy.isBoss ? 'boss' : enemy.isElite ? 'elite' : 'normal', result.request?.source);
    });
    x.events.on('enemy:damaged', ({ enemy, result }) => {
      this.hitStop.onDamaged(result.isCrit, result.killed, result.request?.source, result.dealt,
        (enemy.maxHp || 0) + (enemy.maxArmor || 0) + (enemy.maxShield || 0));
    });
    x.events.on('enemy:reaction', ({ depth, hits }) => this.hitStop.onReacted(depth, hits));
    // 换关：给 Unity 场景的小件 / 散布件分层（UnitySceneView 的根节点 unity-scene-<id>）
    x.events.on('stage:loaded', () => this.attachCulling());

    Suspend.RunSuspend.setHeroLookup(id => this.ctx.heroes.some(h => h.id === id));
    Suspend.RunSuspend.ensureInstalled();

    this.applySettings();
    this.resize();
    if (this.debug) this.installDebug();
  }

  /** 当前状态：模态栈顶（暂停 / 模态），栈空时是底层状态 */
  get state(): GameState {
    return this.fsm.current;
  }

  /** 切底层状态（菜单 / 游戏 / 过渡 / 结算），同时清空模态栈、撤掉它们停住的时间 */
  private setState(s: GameState): void {
    this.fsm.clearModals(s);
  }

  // ───────────── 启动 & 主循环 ─────────────

  start(): void {
    this.toMenu();
    this.lastFrame = performance.now();
    const loop = (t: number) => {
      requestAnimationFrame(loop);
      this.frame(t);
    };
    requestAnimationFrame(loop);
  }

  private frame(t: number): void {
    // 帧率上限（设置「帧率上限」；不限 = 每个 rAF 都跑）
    if (!this.frameLimiter.shouldRun(t, targetFrameRate(this.ctx.settings.frameCap))) return;
    this.performanceMeter?.beginFrame(t);
    const rawDt = Math.min(0.05, Math.max(0, (t - this.lastFrame) / 1000));
    this.lastFrame = t;
    const ctx = this.ctx;
    // 时间：到期的申请先撤（按真实时间），顿帧 / 清场慢动作到点收回，再算这一帧的 dt
    this.hitStop.update();
    this.clearSlowMo.update();
    this.timeArbiter.tick();
    const dt = rawDt * ctx.time.timeScale;
    ctx.time.dt = dt;
    ctx.time.frame++;

    this.fpsAcc += rawDt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    this.handleGlobalKeys();

    if (this.state === 'playing') {
      ctx.time.now += dt;
      ctx.run.time += dt;
      for (const s of this.updateOrder) {
        try {
          s.update?.(dt);
        } catch (err) {
          console.error('[Game] system update threw', s.constructor?.name, err);
        }
      }
      ctx.tasks.update(dt);
      // 清场慢动作：一处场地从开打变成清掉的那一帧（打过的只数够才放）
      for (const total of this.clearWatcher.observe(ctx.stage.exploration?.encounters)) this.clearSlowMo.onCleared(total);
    }

    // 表现层始终更新（菜单/暂停时用真实 dt）
    const presDt = this.state === 'playing' ? dt : rawDt;
    for (const s of [ctx.fx, ctx.audio, ctx.ui] as System[]) {
      try {
        s.update?.(presDt);
      } catch (err) {
        console.error('[Game] presentation update threw', s.constructor?.name, err);
      }
    }

    ctx.input.endFrame();
    this.performanceMeter?.endUpdate();
    this.performanceMeter?.beginRender();
    this.render();
    this.performanceMeter?.endRender();
  }

  private render(): void {
    const { renderer, scene, camera, viewScene, viewCamera } = this.ctx;
    const inspectionCamera = this.inspectionView?.() ?? null;
    const state = this.state;
    const viewmodel = !inspectionCamera && (state === 'playing' || state === 'paused' || state === 'modal' || state === 'transition');
    if (this.culler.count > 0) {
      const fog = scene.fog as { isFog?: boolean; far?: number } | null;
      this.culler.update((inspectionCamera ?? camera).position, cullDistances(qualityProfile(this.ctx.settings.quality), fog?.isFog ? fog.far ?? 0 : 0));
    }
    if (this.post.render(inspectionCamera ?? camera, viewmodel)) return;
    renderer.clear();
    renderer.render(scene, inspectionCamera ?? camera);
    if (viewmodel) {
      renderer.clearDepth();
      renderer.render(viewScene, viewCamera);
    }
  }

  private handleGlobalKeys(): void {
    const input = this.ctx.input;
    const escLike = input.keyPressed('Escape') || input.keyPressed('KeyP');
    if (!escLike) return;
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused' && performance.now() - this.pausedAt > 300) this.resume();
  }

  /** 给刚搭好的 Unity 场景分层（小件 / 散布件按距离剔除；别的场景视图不动） */
  private attachCulling(): void {
    this.culler.clear();
    if (new URLSearchParams(location.search).get('cull') === '0') return;
    try {
      // StageDirector 把 UnitySceneView 的根节点直接挂在 ctx.scene 上（不在 stageGroup 里）；两处都看
      for (const parent of [this.ctx.scene, this.ctx.stageGroup]) {
        for (const child of parent.children) {
          if (child.name.startsWith('unity-scene-')) this.culler.addScene(child as unknown as MeshLike);
        }
      }
    } catch (err) {
      console.error('[Game] 距离剔除分层失败', err);
      this.culler.clear();
    }
  }

  private resize(): void {
    const { renderer, camera, viewCamera, settings } = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    // 渲染比例照画质档（core/QualityTiers：低 0.7 / 中 0.85 / 高 1，乘在设备像素比上——各档有上限）
    renderer.setPixelRatio(renderPixelRatio(qualityProfile(settings.quality), window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    viewCamera.aspect = w / h;
    viewCamera.updateProjectionMatrix();
  }

  // ───────────── 流程控制（IGame） ─────────────

  startRun(heroId: string): void {
    const ctx = this.ctx;
    const hero = ctx.heroes.find((h) => h.id === heroId) ?? ctx.heroes[0];
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    // 上一局没结算就开新局（阵亡慢动作里点了再来一局之类）：先按失败结算（Unity SceneFlow.NewRun）
    this.bankCurrent(false);
    ctx.rng.reseed(seed);
    ctx.run = ctx.runPlan.createRun(hero.id, seed);
    // 有未完成的征程（续玩档）：开新局 = 放弃它，按败北结算（魂晶照常入账）再删档。
    // Unity 这里先弹确认框（MenuFlow.StartRun）；网页的确认框随 M11c 第二期，主菜单的「开始游戏」提示里写明了
    try {
      const dev = Suspend.devFor(ctx.run);
      if (Suspend.exists(dev)) Suspend.forfeit(dev);
    } catch (err) {
      console.error('[Game] 放弃未完成的征程失败', err);
    }
    // 开局锁定天赋（Unity TalentHooks.Lock）：整局（含暂离后继续征程）按这份快照生效
    ctx.run.talents = this.metaProgress.talentSnapshot();
    this.resetTime();
    this.deathPending = false;

    this.disposePassive();
    this.clearStage(true);
    ctx.scrolls.resetForRun();
    ctx.player.resetForRun(hero);
    ctx.weapons.resetForRun(hero.startingWeapon);
    this.passiveDispose = hero.passive.apply(ctx);
    ctx.events.emit('run:started', { run: ctx.run });

    this.setState('transition');
    ctx.ui.fade(1, 0.01).then(async () => {
      // 每局路线要等场景清单（备选图）：清单晚到时按它重排这一局的路线
      await ctx.runPlan.prepare?.(ctx.run);
      // 美术资源（角色 / 首领 / 道具 GLB）要在第一关刷怪前到齐：开局就站在场上的驻守怪、调试局直进的首领场，
      // 刷出来时模型没到会一直是程序化占位体（同 Unity：进图时资源已就绪）。模块加载时已在后台开始读，这里只等它读完
      await AssetLibrary.preload();
      if (!await this.loadStage(ctx.runPlan.firstStage(ctx.run))) { this.toMenu(false); return; }
      ctx.ui.showHUD(true);
      ctx.weapons.setViewmodelVisible(true);
      this.setState('playing');
      ctx.input.enabled = true;
      ctx.input.requestLock();
      ctx.ui.fade(0, 0.6);
    });
  }

  // ───────────── 续玩（Unity MenuFlow / RunSuspend）─────────────

  private get metaProgress(): MetaProgress {
    return this.ctx.meta as unknown as MetaProgress;
  }

  /** 时间回到 1：撤掉全部时间申请（开局 / 重开 / 回主菜单；Unity TimeScaleArbiter.Clear） */
  private resetTime(): void {
    this.deathSlowMo = null;
    this.hitStop.release();
    this.clearSlowMo.release();
    this.timeArbiter.clear();
  }

  /** 当前局没结算过就结算（魂晶入账、记生涯、写盘、删续玩档）；占位局、结算过的局返回 null */
  private bankCurrent(victory: boolean, summary?: RunSummary): RunSummary | null {
    const run = this.ctx.run;
    if (!run || !run.heroId) return null;
    try {
      return this.metaProgress.bankRun(run, victory, summary);
    } catch (err) {
      // 结算出错不影响阵亡 / 通关流程
      console.error('[Game] 结算失败', err);
      return null;
    }
  }

  /** 进关快照：这一局此刻的状态 + 秘卷层数（按获得顺序）、武器、生命护盾（Unity SceneFlow.EntrySnapshot） */
  private snapshotRun(): RunState {
    const ctx = this.ctx, run = ctx.run;
    const scrolls: Record<string, number> = {};
    for (const o of ctx.scrolls.owned()) if (o.stacks > 0) scrolls[o.def.id] = o.stacks;
    const weapons: WeaponSave[] = [];
    ctx.weapons.slots.forEach((w, slot) => {
      if (!w) return;
      weapons.push({
        id: w.defId, rarity: w.rarity, level: w.level, element: w.element, mag: w.mag, reserve: w.reserve,
        active: slot === ctx.weapons.activeSlot, affixes: w.affixes.map(a => ({ ...a })),
      });
    });
    return {
      ...run, stage: { ...run.stage }, flags: { ...run.flags }, route: run.route ? [...run.route] : undefined,
      talents: run.talents ? { ...run.talents } : undefined, scrolls, weapons, hp: ctx.player.hp, shield: ctx.player.shield,
    };
  }

  /**
   * 每进一关（{@link loadStage} 里、arrive 之后、发 stage:loaded 之前）：拍进关快照写续玩档（已经结算过的局、不写档的调试局不写）。
   * 照 Unity SceneFlow.Arrive：先 `entry = CloneRun(run)`，之后 Announce 才发 StageLoaded——进关时才生效的东西
   * （聚宝盆本金 + 利息、每关补 35% 备弹…）不进快照，继续征程时它们只再发一次，不会越「暂离 → 继续」越多
   */
  private writeEntrySnapshot(): void {
    try {
      const run = this.ctx.run;
      if (!Suspend.shouldWrite(run)) return;
      Suspend.write(this.snapshotRun(), Suspend.devFor(run));
    } catch (err) {
      console.error('[Game] 写续玩档失败', err);
    }
  }

  /** 把续玩档里的武器装回去：手上那把放第一槽。词条 / 品质 / 强化 / 元素 / 弹药照档里的 */
  private restoreWeapons(saves: readonly WeaponSave[], fallback: string): void {
    const weapons = this.ctx.weapons;
    const ordered = [...saves].sort((a, b) => Number(!!b.active) - Number(!!a.active)).slice(0, 2);
    weapons.resetForRun(ordered[0]?.id ?? fallback);
    const patch = (inst: WeaponInstance | null, s: WeaponSave): void => {
      if (!inst || inst.defId !== s.id) return;
      inst.rarity = Math.max(0, Math.min(4, Math.round(s.rarity))) as WeaponInstance['rarity'];
      inst.level = s.level;
      inst.element = s.element as WeaponInstance['element'];
      inst.affixes = (Array.isArray(s.affixes) ? s.affixes : []).filter((a): a is WeaponInstance['affixes'][number] =>
        !!a && typeof (a as { id?: unknown }).id === 'string' && typeof (a as { value?: unknown }).value === 'number').map(a => ({ ...a }));
      inst.mag = Math.min(s.mag, weapons.magCapacity(inst));
      inst.reserve = Math.min(s.reserve, weapons.reserveCapacity(inst));
    };
    if (ordered[0]) patch(weapons.slots[0], ordered[0]);
    if (ordered[1]) {
      const second = weapons.roll({ defId: ordered[1].id, rarity: 0 });
      patch(second, ordered[1]);
      // 直接放进第二槽：give() 会切枪、弹「获得武器」
      (weapons.slots as (WeaponInstance | null)[])[1] = second;
    }
    // 手上那把的词条换过了：让武器系统重算持有加成（M8 给武器系统加正式的读档入口之前先这样）
    (weapons as unknown as { applyHeldMods?(): void }).applyHeldMods?.();
  }

  /** 主菜单「继续征程」显示的那一局（没有 / 坏档为 null）。场景清单没读到之前不动盘上的档（备选图要清单才知道在不在） */
  suspendedRun(): { heroId: string; stageLabel: string; savedAt: string; time: number; coins: number } | null {
    try {
      const dev = Suspend.menuDev();
      const s = hasStageCatalog() ? Suspend.peek(dev) : Suspend.read(dev).result ?? null;
      return s ? { heroId: s.run.heroId, stageLabel: s.stage.label, savedAt: s.savedAt, time: s.run.time, coins: s.run.coins } : null;
    } catch (err) {
      console.error('[Game] 读续玩档失败', err);
      return null;
    }
  }

  /**
   * 继续征程（Unity MenuFlow.ResumeRun）：读续玩档设成当前局，从那一关开头接着打。没有档 / 坏档时提示并返回 false。
   * 与 Unity 的差异：照样发 run:started（网页的掉落、技能、HUD 靠它复位，不是「新开一局」的意思）
   */
  continueRun(): boolean {
    if (this.state !== 'menu') return false;
    const ctx = this.ctx;
    const dev = Suspend.menuDev();
    if (Suspend.read(dev).status === 'none') {
      ctx.ui.toast(Suspend.takeProblem() ?? '没有可以继续的征程', '#ff8a6a');
      return false;
    }
    this.resetTime();
    this.deathPending = false;
    this.setState('transition');
    ctx.ui.fade(1, 0.01).then(async () => {
      // 备选图在不在要等场景清单：读到之后再正式读档（坏档这时才挪成 .corrupt）
      await ctx.runPlan.prepare?.({ ...placeholderRun(), stagesCleared: 1 });
      const s = Suspend.peek(dev);
      const hero = s ? ctx.heroes.find((h) => h.id === s.run.heroId) : undefined;
      if (!s || !hero) {
        this.toMenu(false);
        ctx.ui.toast(Suspend.takeProblem() ?? '没有可以继续的征程', '#ff8a6a');
        return;
      }
      const run = s.run;
      const saved = { scrolls: run.scrolls ?? {}, weapons: run.weapons ?? [], hp: run.hp ?? -1, shield: run.shield ?? -1 };
      delete run.scrolls;
      delete run.weapons;
      delete run.hp;
      delete run.shield;
      ctx.rng.reseed(run.seed);
      ctx.run = run;
      setCurrentRun(run);
      Suspend.adopt(s);

      this.disposePassive();
      this.clearStage(true);
      ctx.scrolls.resetForRun();
      ctx.player.resetForRun(hero);
      this.restoreWeapons(saved.weapons, hero.startingWeapon);
      this.passiveDispose = hero.passive.apply(ctx);
      ctx.events.emit('run:started', { run });
      // 秘卷按获得顺序一层一层装回去；不弹「获得秘卷」、不响
      this.quietly(() => {
        for (const [id, stacks] of Object.entries(saved.scrolls)) for (let i = 0; i < stacks; i++) ctx.scrolls.add(id);
      });
      await AssetLibrary.preload();
      // 生命 / 护盾（< 0 = 满）：秘卷和天赋装好之后再夹到上限；要在进关快照、stage:loaded 之前装好（Unity RestoreAll 在 entry 之前）
      const restoreVitals = (): void => {
        const player = ctx.player;
        // 秘卷加的上限先让玩家结算掉（PlayerController.syncStatCaps：上限涨了当前值跟着涨）——不然第一帧再结算，
        // 档里的血量会被补上秘卷加的那一截，「暂离 → 继续」就能回血
        (player as unknown as { syncStatCaps?(): void }).syncStatCaps?.();
        if (saved.hp >= 0) player.hp = Math.max(1, Math.min(player.maxHp(), saved.hp));
        if (saved.shield >= 0) player.shield = Math.max(0, Math.min(player.maxShield(), saved.shield));
      };
      if (!await this.loadStage(run.stage, restoreVitals)) { this.toMenu(false); return; }
      ctx.ui.showHUD(true);
      ctx.weapons.setViewmodelVisible(true);
      this.setState('playing');
      ctx.input.enabled = true;
      ctx.input.requestLock();
      ctx.ui.fade(0, 0.6);
    });
    return true;
  }

  /** 这一局现在能不能暂离（盘上有它这一关的续玩档）；调试局、已经结算过的局、阵亡了的不能 */
  canSuspend(): boolean {
    const s = this.state;
    if (this.deathPending || this.ctx.player?.alive === false) return false;
    return (s === 'playing' || s === 'paused' || s === 'modal') && Suspend.canSuspend(this.ctx.run);
  }

  /**
   * 暂停菜单「返回主菜单」（Unity MenuFlow.Suspend）：能暂离就不结算、续玩档留着，下次主菜单「继续征程」从本关开头接着打
   * （本关里的进度不保留）；不能暂离（调试局、没写成档）就按失败结算再回主菜单。返回是否暂离
   */
  suspendRun(): boolean {
    const can = this.canSuspend();
    this.toMenu(!can);
    return can;
  }

  /** 做一段不该出提示 / 声音的事（读档时把秘卷装回去） */
  private quietly(fn: () => void): void {
    const ui = this.ctx.ui as unknown as { toast: unknown }, audio = this.ctx.audio as unknown as { play: unknown };
    const toast = ui.toast, play = audio.play;
    ui.toast = () => undefined;
    audio.play = () => undefined;
    try {
      fn();
    } catch (err) {
      console.error('[Game] 读档恢复失败', err);
    } finally {
      ui.toast = toast;
      audio.play = play;
    }
  }

  advance(next: StageNode): void {
    if (this.state !== 'playing') return;
    const ctx = this.ctx;
    this.setState('transition');
    ctx.input.enabled = false;
    ctx.audio.play('portal');
    ctx.ui.fade(1, 0.35).then(async () => {
      if (!await this.loadStage(next)) { this.toMenu(); return; }
      this.setState('playing');
      ctx.input.enabled = true;
      ctx.input.flushMouse();
      ctx.ui.fade(0, 0.5);
    });
  }

  /**
   * 换到这一关（Unity SceneFlow.Arrive → GameSession.Announce）：搭场景 → arrive（继续征程把档里的生命护盾装回去）→
   * 拍进关快照写续玩档 → 发 stage:loaded。False when the stage could not be built; callers return to the menu instead of a black screen.
   */
  private async loadStage(node: StageNode, arrive?: () => void): Promise<boolean> {
    const ctx = this.ctx;
    const run = ctx.run;
    run.chapter = node.chapter;
    run.stageIndex = node.index;
    run.stage = node;
    run.difficulty = ctx.runPlan.difficultyFor(node);
    this.clearStage(false);
    ctx.stage.unload();
    try {
      await ctx.stage.load(node);
    } catch (err) {
      console.error('[Game] stage load failed', err);
      if (new URLSearchParams(location.search).has('debugStage')) {
        const output = document.createElement('pre');
        output.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;max-width:90vw;white-space:pre-wrap;background:#200;color:#ff9b8a;font:16px monospace';
        output.textContent = `关卡载入失败：${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}`;
        document.body.appendChild(output);
      }
      ctx.ui.toast(`关卡载入失败：${err instanceof Error ? err.message : String(err)}`, '#ff8a6a');
      return false;
    }
    if (arrive) {
      try {
        arrive();
      } catch (err) {
        console.error('[Game] 读档恢复失败', err);
      }
    }
    // 快照先于 stage:loaded（Unity：Arrive 里 entry = CloneRun(run)，之后 Announce 才发 StageLoaded）
    this.writeEntrySnapshot();
    ctx.events.emit('stage:loaded', { stage: node });
    ctx.ui.banner(ctx.stage.arena?.theme.name ?? '', ctx.runPlan.stageLabel(node), 2.6);
    ctx.audio.setMusic(node.type === 'boss' ? 'boss' : node.type === 'shop' || node.type === 'treasure' ? 'calm' : 'combat');
    return true;
  }

  /** 清理关卡内的动态内容。full=true 时连常驻任务也清掉（新开一局 / 回菜单） */
  private clearStage(full: boolean): void {
    const ctx = this.ctx;
    ctx.enemies.clear?.();
    ctx.weapons.clear?.();
    ctx.projectiles.clear?.();
    ctx.loot.clear?.();
    ctx.interact.clear?.();
    ctx.combat.clear?.();
    ctx.fx.clear?.();
    ctx.tasks.clear(full);
    // 剔除名单跟着场景走；进行中的顿帧 / 清场慢动作不带进下一关
    this.culler.clear();
    this.hitStop.release();
    this.clearSlowMo.release();
    ctx.stageGroup.clear();
    ctx.run.flags.infiniteAmmo = 0;
    ctx.ui.setBoss(null);
    ctx.ui.setInteractPrompt(null);
    ctx.cameraFx.fovKick = 0;
    ctx.cameraFx.shakeIntensity = 0;
    ctx.cameraFx.shakeTime = 0;
  }

  /** 这一局此刻的结算单（结算界面、魂晶入账、生涯记录用） */
  private runSummary(victory: boolean): RunSummary {
    const ctx = this.ctx;
    const run = ctx.run;
    return {
      victory,
      heroId: run.heroId,
      chapter: run.chapter,
      stageIndex: run.stageIndex,
      stagesCleared: run.stagesCleared,
      kills: run.kills,
      damageDealt: Math.round(run.damageDealt),
      time: run.time,
      coins: run.coins,
      essenceEarned: Math.round(run.essence + (victory ? 200 : 0)),
      scrolls: ctx.scrolls.owned().map((o) => ({ id: o.def.id, name: o.def.name, rarity: o.def.rarity, stacks: o.stacks })),
      weapons: ctx.weapons.slots.filter((w): w is NonNullable<typeof w> => !!w).map((w) => ctx.weapons.describe(w).name),
    };
  }

  /** 一局结束、出结算界面。banked = 阵亡时当场结算的那一份（照它出界面，不再结一次） */
  endRun(victory: boolean, banked?: RunSummary): void {
    if (this.state === 'summary' || this.state === 'menu') return;
    const ctx = this.ctx;
    const summary = banked ?? this.runSummary(victory);
    // 结算（魂晶入账、记生涯、写盘、删续玩档）：同一局只结一次——阵亡时已经结算过的只出结算界面
    if (!banked) this.bankCurrent(victory, summary);
    ctx.events.emit('run:ended', { summary });
    this.disposePassive();
    ctx.cameraFx.fovKick = 0;
    this.setState('summary');
    this.resetTime();
    ctx.input.enabled = false;
    ctx.input.exitLock();
    ctx.weapons.setViewmodelVisible(false);
    ctx.ui.showHUD(false);
    ctx.ui.setBoss(null);
    ctx.audio.setMusic('none');
    ctx.audio.play(victory ? 'victory' : 'defeat');
    ctx.ui.showSummary(summary);
  }

  /**
   * 回主菜单（Unity MenuFlow.ToMenu）。bank = 没结算过的局先按失败结算（Three.js 原来的「返回主菜单不结算」会白丢本局魂晶，照 Unity 不跟）；
   * 暂离（{@link suspendRun}）、关卡载入失败、读档失败传 false：不结算，续玩档（如果有）留着
   */
  toMenu(bank = true): void {
    const ctx = this.ctx;
    const s = this.state;
    if (bank && s !== 'menu' && s !== 'boot' && s !== 'summary') this.bankCurrent(false);
    this.deathPending = false;
    this.disposePassive();
    this.clearStage(true);
    ctx.stage.unload();
    ctx.input.enabled = false;
    ctx.input.exitLock();
    ctx.weapons.setViewmodelVisible(false);
    ctx.ui.showHUD(false);
    ctx.ui.showPause(false);
    // 主菜单里没有局（Unity RunState.Current = null）：存档看的是菜单的档，不是上一局的
    ctx.run = placeholderRun();
    setCurrentRun(null);
    this.setState('menu');
    this.resetTime();
    ctx.ui.fade(0, 0.3);
    ctx.ui.showMainMenu();
    ctx.audio.setMusic('menu');
  }

  /** 暂停：模态栈上压一项（停住时间，暂停优先级）。阵亡慢动作里不能暂停（Unity GameSession.Update 玩家死了就不看暂停键） */
  pause(): void {
    if (this.state !== 'playing' || this.deathPending) return;
    this.pausedAt = performance.now();
    this.fsm.push(this.pauseKey, 'paused');
    this.ctx.input.enabled = false;
    this.ctx.input.exitLock();
    this.ctx.ui.showPause(true);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.ctx.ui.showPause(false);
    this.fsm.pop(this.pauseKey);
    if (!this.fsm.isPlaying) return;
    this.ctx.input.enabled = true;
    this.ctx.input.flushMouse();
    this.ctx.input.requestLock();
  }

  /** 模态界面（秘卷三选一…）：模态栈上压一项（停住时间，模态优先级）、放开鼠标、屏蔽玩家输入 */
  openModal(): void {
    if (this.state !== 'playing') return;
    this.fsm.push(this.modalKey, 'modal');
    this.ctx.input.enabled = false;
    this.ctx.input.exitLock();
  }

  closeModal(): void {
    if (this.state !== 'modal') return;
    this.fsm.pop(this.modalKey);
    if (!this.fsm.isPlaying) return;
    this.ctx.input.enabled = true;
    this.ctx.input.flushMouse();
    this.ctx.input.requestLock();
  }

  applySettings(): void {
    const { settings, camera, renderer } = this.ctx;
    camera.fov = settings.fov;
    camera.updateProjectionMatrix();
    renderer.shadowMap.enabled = settings.quality !== 'low';
    this.ctx.audio.applyVolumes(settings.masterVolume, settings.sfxVolume, settings.musicVolume);
    // 玩法屏效强度（低血量 / 受击 / 冲刺 / 慢动作）
    this.post.gameplay.amount = settings.screenEffects ?? 1;
    this.resize();
  }

  saveSettings(): void {
    saveSettings(this.ctx.settings);
  }

  /**
   * 阵亡（Unity GameSession.OnDied）：0.3 倍慢动作（经仲裁器，阵亡优先级），当场结算（魂晶入账、记生涯、写盘、删续玩档），
   * 半秒游戏时间后照这一份出结算界面。当场结算 = 慢动作这半秒里已经不能「暂离」：结算过的局 canSuspend 为 false、续玩档已删，
   * 暂停也打不开（{@link pause}）——不然暂停「返回主菜单」再「继续征程」就能带着进关时的血量回到本关开头，等于没死
   */
  private onPlayerDied(): void {
    if (this.deathPending || this.state !== 'playing') return;
    this.deathPending = true;
    const ctx = this.ctx;
    this.deathSlowMo?.dispose();
    this.deathSlowMo = this.timeArbiter.request(this, 0.3, TimePriority.DeathSlowMo);
    const summary = this.runSummary(false);
    this.bankCurrent(false, summary);
    ctx.weapons.setViewmodelVisible(false);
    ctx.tasks.delay(0.5, () => {
      this.deathSlowMo?.dispose();
      this.deathSlowMo = null;
      this.endRun(false, summary);
    }, true);
  }

  private disposePassive(): void {
    if (this.passiveDispose) {
      try {
        this.passiveDispose();
      } catch (err) {
        console.error(err);
      }
      this.passiveDispose = null;
    }
  }

  // ───────────── 调试 ─────────────

  private installDebug(): void {
    const ctx = this.ctx;
    (window as unknown as Record<string, unknown>).__game = this;
    (window as unknown as Record<string, unknown>).__ctx = ctx;
    let god = false;
    // __balance()：平衡模型的整份推演（经济投影、逐关估算、首领用时；Unity BalanceModel.Report），敌人 / 首领数值现读 defs.json
    (window as unknown as Record<string, unknown>).__balance = async () => {
      const [model, bosses, defs] = await Promise.all([import('../progression/BalanceModel'), import('../progression/BalanceBosses'),
        fetch(`${import.meta.env.BASE_URL}assets/unity-gameplay/defs.json`).then(r => r.json())]);
      model.setBalanceData(defs);
      const report = bosses.fullBalanceReport();
      console.info(report);
      return report;
    };
    ctx.events.on('game:stateChanged', ({ to }) => console.info('[debug] state →', to));
    // ?debug&spawn=mirage_toad[,id2…]：每进一关在玩家前方约 15 米处生成这些敌人（试玩新怪用，不进正式波次）
    const spawnIds = (new URLSearchParams(location.search).get('spawn') ?? '').split(',').filter(Boolean);
    if (spawnIds.length > 0) {
      ctx.events.on('stage:loaded', () => {
        ctx.tasks.delay(1.5, () => {
          const fwd = ctx.player.getForward(new THREE.Vector3()).setY(0).normalize();
          spawnIds.forEach((id, i) => {
            const at = ctx.player.position.clone().addScaledVector(fwd, 15).add(new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar((i - (spawnIds.length - 1) / 2) * 4));
            const pos = at.clone();
            if (!ctx.nav.nearestWalkable(at, pos)) pos.copy(at);
            if (!ctx.enemies.spawn(id, { position: pos, level: 1 })) console.warn(`[debug] 没有敌人类型 ${id}`);
          });
        });
      });
    }
    window.addEventListener('keydown', (e) => {
      if (this.state !== 'playing') return;
      switch (e.code) {
        case 'F1':
          god = !god;
          ctx.player.invulnerableTime = god ? 1e9 : 0;
          ctx.ui.toast(god ? '无敌：开' : '无敌：关');
          break;
        case 'F2':
          ctx.enemies.killAll();
          break;
        case 'F3':
          ctx.loot.offerScrolls(3);
          break;
        case 'F4':
          ctx.loot.dropWeapon(ctx.player.position.clone().add(new THREE.Vector3(0, 1, -2)), ctx.weapons.roll({ chapter: 2 }));
          break;
        case 'F6':
          ctx.run.coins += 1000;
          ctx.events.emit('coins:changed', { coins: ctx.run.coins, delta: 1000 });
          break;
      }
    });
  }
}
