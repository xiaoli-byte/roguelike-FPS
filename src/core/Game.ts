import * as THREE from 'three';
import type { GameContext, GameState, HeroDef, IGame, RunState, RunSummary, StageNode, System } from './types';
import { EventBus } from './EventBus';
import { Input } from './Input';
import { Rng } from './Rng';
import { TaskRunner } from './Tasks';
import { CollisionWorld } from '../world/Collision';
import { loadSettings, saveSettings } from './settings';

import { MetaProgress } from '../progression/Meta';
import { RunPlanner } from '../progression/RunPlan';
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
import { NavGrid } from '../world/NavGrid';
import { StageDirector } from '../world/StageDirector';
import { FxSystem } from '../fx/Fx';
import { AudioSystem } from '../audio/AudioSystem';
import { UIManager } from '../ui/UI';

function placeholderRun(): RunState {
  const stage: StageNode = { chapter: 0, index: 0, type: 'combat', reward: 'none', theme: 'desert' };
  return {
    heroId: '', seed: 1, chapter: 0, stageIndex: 0, stage, coins: 0, kills: 0, damageDealt: 0,
    time: 0, stagesCleared: 0, essence: 0, difficulty: 1, flags: {},
  };
}

/**
 * 顶层游戏对象：创建渲染器与全部系统、驱动主循环、管理状态机（菜单 / 游戏 / 暂停 / 模态 / 结算）。
 */
export class Game implements IGame {
  readonly ctx: GameContext;
  readonly debug: boolean;
  private _state: GameState = 'boot';
  private lastFrame = 0;
  private updateOrder: System[] = [];
  private passiveDispose: (() => void) | null = null;
  private deathPending = false;
  private pausedAt = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  fps = 0;

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
    const c = this.ctx as unknown as Record<string, unknown>;

    c.meta = new MetaProgress(this.ctx);
    c.runPlan = new RunPlanner(this.ctx);
    c.audio = new AudioSystem(this.ctx);
    c.fx = new FxSystem(this.ctx);
    c.ui = new UIManager(this.ctx);
    c.nav = new NavGrid(this.ctx);
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
      if (!locked && this._state === 'playing' && !this.debug) this.pause();
    };
    canvas.addEventListener('click', () => {
      this.ctx.audio.unlock();
      if (this._state === 'playing' && !input.pointerLocked) input.requestLock();
    });
    window.addEventListener('pointerdown', () => this.ctx.audio.unlock(), { once: true });
    window.addEventListener('keydown', () => this.ctx.audio.unlock(), { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this._state === 'playing' && !this.debug) this.pause();
    });
    window.addEventListener('resize', () => this.resize());

    x.events.on('player:died', () => this.onPlayerDied());

    this.applySettings();
    this.resize();
    if (this.debug) this.installDebug();
  }

  get state(): GameState {
    return this._state;
  }

  private setState(s: GameState): void {
    if (s === this._state) return;
    const from = this._state;
    this._state = s;
    this.ctx.events.emit('game:stateChanged', { from, to: s });
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
    const rawDt = Math.min(0.05, Math.max(0, (t - this.lastFrame) / 1000));
    this.lastFrame = t;
    const ctx = this.ctx;
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

    if (this._state === 'playing') {
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
    }

    // 表现层始终更新（菜单/暂停时用真实 dt）
    const presDt = this._state === 'playing' ? dt : rawDt;
    for (const s of [ctx.fx, ctx.audio, ctx.ui] as System[]) {
      try {
        s.update?.(presDt);
      } catch (err) {
        console.error('[Game] presentation update threw', s.constructor?.name, err);
      }
    }

    ctx.input.endFrame();
    this.render();
  }

  private render(): void {
    const { renderer, scene, camera, viewScene, viewCamera } = this.ctx;
    renderer.clear();
    renderer.render(scene, camera);
    if (this._state === 'playing' || this._state === 'paused' || this._state === 'modal' || this._state === 'transition') {
      renderer.clearDepth();
      renderer.render(viewScene, viewCamera);
    }
  }

  private handleGlobalKeys(): void {
    const input = this.ctx.input;
    const escLike = input.keyPressed('Escape') || input.keyPressed('KeyP');
    if (!escLike) return;
    if (this._state === 'playing') this.pause();
    else if (this._state === 'paused' && performance.now() - this.pausedAt > 300) this.resume();
  }

  private resize(): void {
    const { renderer, camera, viewCamera, settings } = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const pr = settings.quality === 'low' ? Math.min(dpr, 1) * 0.75 : settings.quality === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 2);
    renderer.setPixelRatio(pr);
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
    ctx.rng.reseed(seed);
    ctx.run = ctx.runPlan.createRun(hero.id, seed);
    ctx.time.timeScale = 1;
    this.deathPending = false;

    this.disposePassive();
    this.clearStage(true);
    ctx.scrolls.resetForRun();
    ctx.player.resetForRun(hero);
    ctx.weapons.resetForRun(hero.startingWeapon);
    this.passiveDispose = hero.passive.apply(ctx);
    ctx.events.emit('run:started', { run: ctx.run });

    this.setState('transition');
    ctx.ui.fade(1, 0.01).then(() => {
      this.loadStage(ctx.runPlan.firstStage(ctx.run));
      ctx.ui.showHUD(true);
      ctx.weapons.setViewmodelVisible(true);
      this.setState('playing');
      ctx.input.enabled = true;
      ctx.input.requestLock();
      ctx.ui.fade(0, 0.6);
    });
  }

  advance(next: StageNode): void {
    if (this._state !== 'playing') return;
    const ctx = this.ctx;
    this.setState('transition');
    ctx.input.enabled = false;
    ctx.audio.play('portal');
    ctx.ui.fade(1, 0.35).then(() => {
      this.loadStage(next);
      this.setState('playing');
      ctx.input.enabled = true;
      ctx.input.flushMouse();
      ctx.ui.fade(0, 0.5);
    });
  }

  private loadStage(node: StageNode): void {
    const ctx = this.ctx;
    const run = ctx.run;
    run.chapter = node.chapter;
    run.stageIndex = node.index;
    run.stage = node;
    run.difficulty = ctx.runPlan.difficultyFor(node);
    this.clearStage(false);
    ctx.stage.unload();
    ctx.stage.load(node);
    ctx.events.emit('stage:loaded', { stage: node });
    ctx.ui.banner(ctx.stage.arena?.theme.name ?? '', ctx.runPlan.stageLabel(node), 2.6);
    ctx.audio.setMusic(node.type === 'boss' ? 'boss' : node.type === 'shop' || node.type === 'treasure' ? 'calm' : 'combat');
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
    ctx.stageGroup.clear();
    ctx.run.flags.infiniteAmmo = 0;
    ctx.ui.setBoss(null);
    ctx.ui.setInteractPrompt(null);
    ctx.cameraFx.fovKick = 0;
    ctx.cameraFx.shakeIntensity = 0;
    ctx.cameraFx.shakeTime = 0;
  }

  endRun(victory: boolean): void {
    if (this._state === 'summary' || this._state === 'menu') return;
    const ctx = this.ctx;
    const run = ctx.run;
    ctx.time.timeScale = 1;
    const summary: RunSummary = {
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
    ctx.meta.addEssence(summary.essenceEarned);
    ctx.meta.recordRun(summary);
    ctx.meta.persist();
    ctx.events.emit('run:ended', { summary });
    this.disposePassive();
    ctx.cameraFx.fovKick = 0;
    this.setState('summary');
    ctx.input.enabled = false;
    ctx.input.exitLock();
    ctx.weapons.setViewmodelVisible(false);
    ctx.ui.showHUD(false);
    ctx.ui.setBoss(null);
    ctx.audio.setMusic('none');
    ctx.audio.play(victory ? 'victory' : 'defeat');
    ctx.ui.showSummary(summary);
  }

  toMenu(): void {
    const ctx = this.ctx;
    ctx.time.timeScale = 1;
    this.deathPending = false;
    this.disposePassive();
    this.clearStage(true);
    ctx.stage.unload();
    ctx.input.enabled = false;
    ctx.input.exitLock();
    ctx.weapons.setViewmodelVisible(false);
    ctx.ui.showHUD(false);
    ctx.ui.showPause(false);
    this.setState('menu');
    ctx.ui.fade(0, 0.3);
    ctx.ui.showMainMenu();
    ctx.audio.setMusic('menu');
  }

  pause(): void {
    if (this._state !== 'playing') return;
    this.pausedAt = performance.now();
    this.setState('paused');
    this.ctx.input.enabled = false;
    this.ctx.input.exitLock();
    this.ctx.ui.showPause(true);
  }

  resume(): void {
    if (this._state !== 'paused') return;
    this.ctx.ui.showPause(false);
    this.setState('playing');
    this.ctx.input.enabled = true;
    this.ctx.input.flushMouse();
    this.ctx.input.requestLock();
  }

  openModal(): void {
    if (this._state !== 'playing') return;
    this.setState('modal');
    this.ctx.input.enabled = false;
    this.ctx.input.exitLock();
  }

  closeModal(): void {
    if (this._state !== 'modal') return;
    this.setState('playing');
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
    this.resize();
  }

  saveSettings(): void {
    saveSettings(this.ctx.settings);
  }

  private onPlayerDied(): void {
    if (this.deathPending || this._state !== 'playing') return;
    this.deathPending = true;
    const ctx = this.ctx;
    ctx.time.timeScale = 0.3;
    ctx.weapons.setViewmodelVisible(false);
    ctx.tasks.delay(0.5, () => {
      ctx.time.timeScale = 1;
      this.endRun(false);
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
    ctx.events.on('game:stateChanged', ({ to }) => console.info('[debug] state →', to));
    window.addEventListener('keydown', (e) => {
      if (this._state !== 'playing') return;
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
