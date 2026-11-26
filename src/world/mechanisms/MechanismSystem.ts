/**
 * 地图机关的总管（M7）：Unity 场景视图搭好后（渲染件、碰撞体都在了）按 mechanisms.json 里这张图的数据建出全部机关，每帧推进，卸载时拆掉。
 * 机关清单与和 Unity 的对照见 docs/threejs-migration.md 4.5；数据由 scripts/web/export-mechanisms.mjs 从 Unity 场景 YAML 导出。
 *
 * 更新顺序（同 Unity 的执行顺序大意）：熔岩体与涨落 → 熔岩规则（玩家 / 敌人）→ 熔泉 / 熔流闸 → 流沙 / 牵引 / 安全区 → 可破坏物 / 断桥 / 冰棱 →
 *   各图脚本 → 软边界 → 天气（读软边界的白化）→ 雷暴（天气之后覆盖光与雾）→ 安全落脚点记录。
 * 调试：window.__mechanisms（?debug 时挂）——storm() 开一场雷暴、sandstorm() 让最近的区域风暴立刻预警、flood(hold) 涨熔铜渠、release(i) 放熔流闸……
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../../core/types';
import { stageHooks } from '../../enemies/bosses/framework/StageHooks';
import { bindKuiStorm, kuiStorm, type KuiStormHooks } from '../../enemies/bosses/lords/KuiStorm';
import { postEffects } from '../../render/PostStack';
import { pickLayoutVariant, layoutForce, underPath } from '../LevelLayout';
import type { UnitySceneDocument } from '../UnityLevelLibrary';
import { BoundaryField, BoundaryZone } from './Boundary';
import { BreakableSpan, DamageKind, Destructible, elementKind, IcefallIcicle } from './Breakables';
import { QuicksandField, SafeZones, SurfaceField } from './Ground';
import type { Activatable, MechanismHost, SitePhase } from './Host';
import { findLavaTemplate, LavaField, LavaVolumeRuntime } from './Lava';
import { LavaGeyser, LavaSluice } from './LavaFeatures';
import { FireGodThrone, FoundryChannels, FoundryLordGate, FoundryWindGate, ForgeWellDirector, LoreNote, ZheduoLevel } from './Levels';
import { loadBoundaryField, loadMechanisms, type MechanismBase, type SceneMechanisms } from './MechanismData';
import { SceneParts, ScreenFlash } from './Parts';
import { SafeGround } from './SafeGround';
import { stageGates } from './StageGates';
import { Conductor, LightningStrikes, PlateauStorm, type PlateauStormSpec } from './Storm';
import { Telegraphs } from './Telegraph';
import { WeatherDirector } from './Weather';
import { WindField } from './Wind';
import { desertArt, patchDesertMechanisms } from '../desert';

/** 走法变体停用的物体（同 LevelLayout.applyLevelLayout 的 off 集合）：机关的 scenePath 落在它们下面就不建 */
function layoutOff(document: UnitySceneDocument, ctx: GameContext): string[] {
  const variants = document.layout?.variants;
  if (!variants?.length) return [];
  const v = variants[pickLayoutVariant(variants, layoutForce(), ctx.run)];
  if (!v) return [];
  const keep = new Set<string>([v.spawn?.scenePath, v.exit, ...(v.only ?? [])].filter((p): p is string => !!p));
  const off = new Set<string>();
  const offPath = (p: string | null | undefined): void => { if (p && !keep.has(p)) off.add(p); };
  for (const o of variants) {
    if (!o || o === v) continue;
    offPath(o.spawn?.scenePath);
    offPath(o.exit);
    for (const p of o.only ?? []) offPath(p);
  }
  for (const p of v.hide ?? []) offPath(p);
  return [...off];
}

export class MechanismSystem implements MechanismHost {
  readonly group = new THREE.Group();
  readonly parts: SceneParts;
  readonly flash = new ScreenFlash();
  readonly safe: SafeGround;
  readonly lava: LavaField;
  readonly tele: Telegraphs;
  readonly inferno: boolean;
  readonly wind = new WindField();
  readonly conductors: Conductor[] = [];
  readonly strikes: LightningStrikes;
  storm: PlateauStorm | null = null;
  /** 接给夔的雷暴钩子（卸载时只解绑自己接上的那份：新关的机关可能先于旧关卸载建好） */
  private kuiHooks: KuiStormHooks | null = null;
  weather: WeatherDirector | null = null;
  boundary: BoundaryZone | null = null;
  quicksand: QuicksandField | null = null;
  surfaces: SurfaceField | null = null;
  safeZones: SafeZones | null = null;
  readonly volumes = new Map<string, LavaVolumeRuntime>();
  readonly geysers: LavaGeyser[] = [];
  readonly sluices: LavaSluice[] = [];
  readonly destructibles: Destructible[] = [];
  readonly spans: BreakableSpan[] = [];
  readonly icicles: IcefallIcicle[] = [];
  channels: FoundryChannels | null = null;
  readonly levels: { update(dt: number): void; dispose?(): void }[] = [];
  readonly data: SceneMechanisms;
  private readonly activatables = new Map<string, Activatable>();
  private readonly off: (() => void)[] = [];
  private readonly ready: Promise<void>;
  private disposed = false;
  private t = 0;

  constructor(readonly ctx: GameContext, readonly document: UnitySceneDocument, data: SceneMechanisms, viewGroup: THREE.Object3D) {
    this.data = data;
    this.group.name = 'mechanisms';
    viewGroup.add(this.group);
    this.parts = new SceneParts(ctx, document, viewGroup);
    this.inferno = document.id.startsWith('3-');
    this.safe = new SafeGround(ctx, this.flash);
    this.lava = new LavaField(ctx, this.safe, this.group);
    this.tele = new Telegraphs(ctx, this.group);
    this.strikes = new LightningStrikes(ctx, () => this.conductors);
    const off = layoutOff(document, ctx);
    const live = <T extends MechanismBase>(list: T[] | undefined): T[] => (list ?? []).filter(m => !off.some(root => underPath(m.scenePath, root)));
    // 熔岩体
    const template = findLavaTemplate(this.parts);
    for (const d of live(data.lava)) {
      const v = LavaVolumeRuntime.fromData(this.lava, d);
      const roots = this.parts.rootsAt(d.surface);
      if (roots.length) v.bindSurface(roots);
      else if (d.surface && template) v.buildSurface(this.group, template, d.depthShore);
      this.lava.register(v);
      v.applyLevel();
      this.volumes.set(d.scenePath, v);
    }
    // 可破坏物在熔流闸之前建（熔流闸的吊钩是一件可破坏物）
    for (const d of live(data.destructibles)) this.addActivatable(this.destructibles, new Destructible(this, d));
    for (const d of live(data.spans)) this.addActivatable(this.spans, new BreakableSpan(this, d));
    for (const d of live(data.icicles)) this.icicles.push(new IcefallIcicle(this, d));
    for (const d of live(data.geysers)) this.geysers.push(new LavaGeyser(this, d));
    for (const d of live(data.sluices)) this.addActivatable(this.sluices, new LavaSluice(this, d));
    if (data.quicksand?.length) this.quicksand = new QuicksandField(this, live(data.quicksand));
    if (data.surfaces?.length) this.surfaces = new SurfaceField(this, live(data.surfaces));
    if (data.safeZones?.length) this.safeZones = new SafeZones(this, live(data.safeZones), data.camps ?? []);
    for (const d of live(data.conductors)) this.conductors.push(new Conductor(d));
    // 各图脚本
    const gate = (fn: (id: string) => boolean): (() => void) => stageGates.addFightGate(fn);
    const channelData = live(data.foundryChannels)[0];
    if (channelData) {
      this.channels = new FoundryChannels(this, channelData);
      this.levels.push({ update: () => this.channels!.update() });
      stageGates.foundryChannels = this.channels;
      // 首领倒下 / 领主战结算：熔铜渠退回
      this.off.push(ctx.events.on('enemy:killed', ({ enemy }) => {
        if (enemy.isBoss && enemy.def.id === 'boss_warlord') this.channels?.recede();
      }));
    }
    for (const d of live(data.fireGodThrones)) this.levels.push(new FireGodThrone(this, d, this.channels));
    for (const d of live(data.windGates)) this.levels.push(new FoundryWindGate(this, d, gate));
    for (const d of live(data.lordGates)) this.levels.push(new FoundryLordGate(this, d, gate));
    for (const d of live(data.forgeWells)) this.levels.push(new ForgeWellDirector(this, d, () => this.geysers));
    for (const d of live(data.lore)) this.levels.push(new LoreNote(this, d));
    for (const d of live(data.zheduo)) this.levels.push(new ZheduoLevel(this, d));
    // 天气 / 雷暴（主光：环境视图登记的太阳）
    const sun = stageHooks.sun?.light ?? null;
    const addPostLayer = (layer: { priority: number; weight: number; overrides: Record<string, unknown> }) => postEffects.addLayer(layer as never);
    if (data.weather) {
      this.weather = new WeatherDirector(ctx, data.weather, {
        whiteout: () => this.boundary?.playerWhiteout ?? 0,
        inward: p => this.boundary?.inwardAt(p) ?? [0, 0],
        addPostLayer,
      }, sun);
      this.wind.weather = { dir: data.weather.windDir, strength: data.weather.baseWind };
    }
    this.storm = new PlateauStorm(ctx, this.strikes, sun, stageHooks.sun?.ambients ?? [], addPostLayer, this.group);
    // 夔（src/enemies/bosses/lords/KuiStorm.ts）经这里用落雷 / 经幡杆导体 / 高原雷暴：数值由夔按 Unity 定好传进来
    const storm = this.storm;
    this.kuiHooks = {
      strike: (p, o) => this.strikes.strike(p, { warn: o.warn, radius: o.radius, damage: o.damage, noTelegraph: o.noTelegraph, ignoreConductors: o.ignoreConductors, height: o.height }),
      nearestCharged: (p, radius) => {
        const c = Conductor.nearestCharged(p, radius, this.conductors);
        return c ? { top: c.top, base: c.base, discharge: () => { c.discharge(); } } : null;
      },
      // Unity KuiBrain：Arena.Contains(c.Base, margin)——圆形场地按水平距离
      chargeConductors: (center, radius, amount) => {
        for (const c of this.conductors) {
          const b = c.base;
          if (Math.hypot(b.x - center.x, b.z - center.z) <= radius) c.addCharge(amount);
        }
      },
      beginStorm: (center, spec) => storm.begin({ center, ...spec }),
      clearStrikes: () => this.strikes.clear(),
    };
    bindKuiStorm(this.kuiHooks);
    // 玩家方的范围伤害打可破坏物（网页碰撞盒只有 onHit：爆炸另接一层）
    this.hookExplosions();
    // 软边界：距离场是单独的二进制文件，载入完再接上
    const b = data.boundary;
    this.ready = b ? loadBoundaryField(b.url).then(field => {
      if (this.disposed || !field) return;
      this.boundary = new BoundaryZone(this, b, new BoundaryField(field, b.width, b.height, b.origin, b.cell));
    }) : Promise.resolve();
    this.safe.resetTo(ctx.player.position.clone());
    // 关卡导演选据点时问一句（StageDirector.fightGate）
    const stage = ctx.stage as { fightGate?: ((id: string) => boolean) | null };
    const gateFn = (id: string): boolean => stageGates.fightBlocked(id, ctx.player.position);
    stage.fightGate = gateFn;
    this.off.push(() => { if (stage.fightGate === gateFn) stage.fightGate = null; });
    if (ctx.game?.debug && typeof window !== 'undefined') (window as unknown as { __mechanisms?: unknown }).__mechanisms = this;
  }

  /** 按 mechanisms.json 建（没有数据 / 读不到时返回 null，关卡照常） */
  static async create(ctx: GameContext, document: UnitySceneDocument, viewGroup: THREE.Object3D): Promise<MechanismSystem | null> {
    const doc = await loadMechanisms();
    // 第一章重做版整份给机关数据（不读 Unity 导出的 mechanisms.json）；美术层：天气的基础雾色 / 风向跟新光照、新风向走
    const art = desertArt(document.id);
    const raw = art?.mechanisms?.() ?? doc?.scenes[document.id];
    if (!raw) return null;
    const data = patchDesertMechanisms(raw, art);
    const system = new MechanismSystem(ctx, document, data, viewGroup);
    await system.ready;
    return system;
  }

  private addActivatable<T extends Activatable>(list: T[], item: T): void {
    list.push(item);
    this.activatables.set(item.scenePath, item);
  }

  // ───────────── MechanismHost ─────────────

  difficulty(): number {
    const d = this.ctx.run?.difficulty;
    return d && d > 0 ? d : 1;
  }

  site(title: string | null | undefined): SitePhase | null {
    if (!title) return null;
    return this.ctx.stage.exploration?.encounters?.find(e => e.id === title)?.phase ?? null;
  }

  activeSite(): string | null {
    return this.ctx.stage.exploration?.encounters?.find(e => e.phase === 'active')?.id ?? null;
  }

  volume(scenePath: string | null | undefined): LavaVolumeRuntime | null {
    return scenePath ? this.volumes.get(scenePath) ?? null : null;
  }

  activatable(scenePath: string | null | undefined): Activatable | null {
    return scenePath ? this.activatables.get(scenePath) ?? null : null;
  }

  boss(id: string): IEnemy | null {
    return this.ctx.enemies.list.find(e => e.alive && e.isBoss && e.def.id === id) ?? null;
  }

  /** 包一层 ctx.combat.explode：玩家方的爆炸也打场景件（按爆炸 + 元素类型，距离线性衰减到 falloff） */
  private hookExplosions(): void {
    if (!this.destructibles.length) return;
    const combat = this.ctx.combat as { explode: GameContext['combat']['explode'] };
    const original = combat.explode;
    const self = this;
    const wrapped: GameContext['combat']['explode'] = function (this: unknown, center, radius, req, opts) {
      const n = original.call(combat, center, radius, req, opts);
      if (req.source !== 'status') {
        for (const d of self.destructibles) {
          if (d.broken) continue;
          const c = new THREE.Vector3(d.d.position[0], d.d.position[1] + d.d.size * 0.5, d.d.position[2]);
          const dist = c.distanceTo(center);
          if (dist > radius + d.d.size * 0.5) continue;
          const fall = opts?.falloff ?? 0.5;
          const k = 1 - (1 - fall) * Math.min(1, dist / Math.max(0.01, radius));
          d.damage(req.base * k, DamageKind.Explosion | elementKind(req.element), c);
        }
      }
      return n;
    };
    combat.explode = wrapped;
    this.off.push(() => { if (combat.explode === wrapped) combat.explode = original; });
  }

  // ───────────── 每帧 ─────────────

  update(dt: number): void {
    if (this.disposed || !(dt > 0)) return;
    this.t += dt;
    this.lava.update(dt, this.t);
    for (const g of this.geysers) g.update(dt);
    for (const s of this.sluices) s.update(dt);
    this.quicksand?.update(dt);
    this.surfaces?.update(dt);
    this.safeZones?.update(dt);
    for (const s of this.spans) s.update(dt);
    for (const i of this.icicles) i.update(dt);
    for (const l of this.levels) l.update(dt);
    this.boundary?.update(dt);
    this.wind.update(this.ctx, dt);
    for (const c of this.conductors) c.update(this.ctx, dt);
    this.strikes.update(dt);
    this.weather?.update(dt);
    this.storm?.update(dt);
    this.tele.update(dt);
    this.flash.update(dt);
    this.safe.update(dt);
  }

  // ───────────── 调试 ─────────────

  /** 开一场雷暴（领主还没接进来之前的调试入口） */
  stormBegin(spec: PlateauStormSpec = {}): void {
    this.storm?.begin(spec);
  }

  /** 最近的区域风暴立刻预警 */
  sandstorm(): string | null {
    const r = this.weather?.forceNearest(this.ctx.player.position, 'warning');
    return r?.d.name ?? null;
  }

  describe(): Record<string, unknown> {
    return {
      scene: this.document.id, lava: this.volumes.size, lavaEntries: this.lava.entries, lavaBurned: this.lava.burned, lavaPushedBack: this.lava.pushedBack,
      geysers: this.geysers.map(g => ({ path: g.d.scenePath, state: g.state, eruptions: g.eruptions, hits: g.playerHits })),
      sluices: this.sluices.map(s => ({ path: s.d.scenePath, phase: s.phase, fired: s.fired, kills: s.kills })),
      quicksand: this.quicksand ? { inside: this.quicksand.playerInside, sink: this.quicksand.playerSink, swallowed: this.quicksand.swallowed } : null,
      surface: this.surfaces ? { on: this.surfaces.playerOnSurface, id: this.surfaces.playerSurface.id } : null,
      boundary: this.boundary ? { distance: this.boundary.playerDistance, wind: this.boundary.playerWind, whiteout: this.boundary.playerWhiteout } : null,
      weather: this.weather ? { fog: [this.weather.current.fogStart, this.weather.current.fogEnd], storms: this.weather.regions.map(r => r.phase) } : null,
      storm: this.storm ? { level: this.storm.level, tickets: this.storm.tickets.length, strikes: this.strikes.count } : null,
      destructibles: this.destructibles.map(d => ({ path: d.d.scenePath, hp: d.hp, broken: d.broken })),
      spans: this.spans.map(s => ({ path: s.d.scenePath, fallen: s.fallenCount, of: s.count })),
      safeRecoveries: this.safe.recoveries, sinking: this.safe.sinking,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.off) off();
    this.off.length = 0;
    for (const g of this.geysers) g.dispose();
    for (const s of this.sluices) s.dispose();
    for (const l of this.levels) l.dispose?.();
    this.quicksand?.dispose();
    this.boundary?.dispose();
    this.weather?.dispose();
    if (this.kuiHooks && kuiStorm.hooks === this.kuiHooks) bindKuiStorm(null);
    this.kuiHooks = null;
    this.storm?.dispose();
    this.strikes.clear();
    this.lava.dispose();
    this.tele.dispose();
    this.flash.dispose();
    if (stageGates.foundryChannels === this.channels) stageGates.foundryChannels = null;
    this.group.removeFromParent();
    const w = typeof window !== 'undefined' ? window as unknown as { __mechanisms?: unknown } : null;
    if (w?.__mechanisms === this) w.__mechanisms = undefined;
  }
}
