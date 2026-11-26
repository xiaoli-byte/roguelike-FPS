/**
 * 熔岩 v2 的运行时（Unity LavaVolume.cs + LavaField.cs）：
 *   LavaVolumeRuntime —— 一片熔岩：判定体 + 涨落驱动（自动涨落 / 脚本 riseTo、recede）+ 熔岩面网格跟着熔岩面上下、预警时翻涌发亮（着色器 uAgitation）；
 *   LavaField —— 场上全部熔岩的登记表与每帧规则：
 *     玩家：着地踩进 / 贴地滑过 / 脚底低于熔岩面 → SafeGround.sink(熔岩)（12% + 两跳 1.5%，0.5 s 托回，1 s 无敌）；安全落脚点不记在熔岩 1 m 内；
 *     敌人：自己走进去的拉回岸上，被击退 0.6 s 内落进去的非首领地面敌人烧死（计击杀、正常掉落）；首领 / 飞行 / 熔岩生物不受影响；
 *     表现：一盏跟着玩家附近熔岩的橙色点光、附近熔岩上升的火星。
 *   查询：isLava / isLavaAt / nearLava / surfaceHeight / nearestShore / bankToward / nearestLava（只给 XZ 的用碰撞世界的地面高度代替射线）。
 * 与 Unity 的差异：导航上的 Lava 区（代价 50）与涨潮挖洞没有（网页导航网格没有区域代价 / 动态挖洞）——地面敌人靠「走进去拉回」兜底；
 * 推下台沿（TryShoveOffLedge）要 NavMesh 的网格边查询，没做；掉进熔岩的掉落物吸向玩家（Pickup.Attract）没做。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../../core/types';
import { Atmosphere } from '../Atmosphere';
import {
  HazardSpecs, LavaBody, LavaContactTracker, LavaEnemyRule, LavaGeometry, LavaLevelDriver, LavaTuning, buildLavaMesh, moveTowards,
  type LavaGroundProbe, type LavaShape, type LavaTide, type LavaTidePhase, type V3,
} from './LavaCore';
import type { LavaVolumeData } from './MechanismData';
import type { SceneParts } from './Parts';
import type { SafeGround } from './SafeGround';

export const LAVA_ORANGE = 0xff6a1a, LAVA_GOLD = 0xffd070;
const EMBER = 0xff8c1f, LIGHT = 0xff6a20;
/** Unity LightIntensity 3.2 ↔ 网页旧 LAVA 点光 22（同一套手感的两种单位） */
const LIGHT_INTENSITY = 22, LIGHT_RANGE = 14, LIGHT_REACH = 10, EMBER_REACH = 18, EMBER_RATE = 30;

type LavaEnemy = IEnemy & { readonly knockedBack?: boolean; readonly swimsInLava?: boolean };

const _v = new THREE.Vector3();

/** 熔岩面材质（Spiritfire/Lava → UnityMaterials 的 ShaderMaterial）：认 uAgitation 这个 uniform */
function isLavaMaterial(m: THREE.Material): m is THREE.ShaderMaterial {
  return (m as THREE.ShaderMaterial).isShaderMaterial === true && !!(m as THREE.ShaderMaterial).uniforms?.uAgitation;
}

function lavaMaterialsOf(root: THREE.Object3D): THREE.ShaderMaterial[] {
  const out: THREE.ShaderMaterial[] = [];
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (isLavaMaterial(m)) out.push(m);
  });
  return out;
}

/** 一片熔岩（Unity LavaVolume） */
export class LavaVolumeRuntime {
  readonly body: LavaBody;
  readonly driver: LavaLevelDriver;
  readonly shape: LavaShape;
  readonly size: [number, number];
  /** 熔岩面渲染件（场景文档里导出的，或运行时按 BuildMesh 现建的） */
  private surface: THREE.Object3D[] = [];
  private materials: THREE.ShaderMaterial[] = [];
  private readonly surfaceBase: number[] = [];
  private agitation = 0;
  private shown = 0;
  private lastPhase: LavaTidePhase;
  private enabled = true;
  private readonly listeners: ((v: LavaVolumeRuntime, phase: LavaTidePhase) => void)[] = [];

  constructor(private readonly field: LavaField, readonly scenePath: string, center: V3, yaw: number, shape: LavaShape, size: [number, number],
    depth: number, tide: LavaTide, readonly flow: [number, number] = [0, 0]) {
    this.shape = shape;
    this.size = [Math.max(0.1, size[0]), Math.max(0.1, size[1])];
    this.driver = new LavaLevelDriver(center.y, tide);
    this.body = new LavaBody(shape, center, this.size, center.y, yaw, Math.max(0.1, depth));
    this.body.owner = this;
    this.lastPhase = this.driver.phase;
  }

  static fromData(field: LavaField, d: LavaVolumeData): LavaVolumeRuntime {
    return new LavaVolumeRuntime(field, d.scenePath, { x: d.position[0], y: d.position[1], z: d.position[2] }, d.yaw, d.shape, d.size, d.depth,
      { ...d.tide }, d.flow);
  }

  get baseLevel(): number { return this.driver.baseLevel; }
  get level(): number { return this.driver.level; }
  get targetLevel(): number { return this.driver.target; }
  get phase(): LavaTidePhase { return this.driver.phase; }
  get flooding(): boolean { return this.driver.flooding; }
  get active(): boolean { return this.enabled; }

  onPhase(fn: (v: LavaVolumeRuntime, phase: LavaTidePhase) => void): void { this.listeners.push(fn); }

  /** 接上熔岩面渲染件（y = 基准面 + SurfaceLift 的那一份） */
  bindSurface(roots: THREE.Object3D[]): void {
    this.surface = roots;
    this.surfaceBase.length = 0;
    for (const r of roots) this.surfaceBase.push(r.position.y - this.baseLevel);
    this.materials = roots.flatMap(lavaMaterialsOf);
  }

  /** 没导出熔岩面（场景里 MeshFilter 空着、Awake 才建）时按 BuildMesh 现建：材质借场上已有熔岩的 */
  buildSurface(parent: THREE.Object3D, template: THREE.ShaderMaterial, depthShore = true): void {
    const data = buildLavaMesh(this.shape, this.size, depthShore, this.flow);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(data.positions.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
    g.setAttribute('_lava_info', new THREE.BufferAttribute(data.info, 4));
    g.setAttribute('_lava_flow', new THREE.BufferAttribute(data.flow, 4));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    g.computeBoundingSphere();
    const material = template.clone();
    // 空气透视层的共享 uniform 要原样挂回去（clone 会把它们拷成私有的）
    Object.assign(material.uniforms, Atmosphere.uniforms);
    material.uniforms.uAgitation.value = 0;
    const mesh = new THREE.Mesh(g, material);
    mesh.name = `${this.scenePath}/Surface (runtime)`;
    mesh.frustumCulled = false;
    mesh.position.set(this.body.center.x, this.baseLevel + LavaTuning.SurfaceLift, this.body.center.z);
    mesh.rotation.y = this.body.yaw * Math.PI / 180;
    mesh.userData.mechanismOwned = true;
    parent.add(mesh);
    this.field.ownMaterial(material);
    this.bindSurface([mesh]);
  }

  /** 启用 / 停用（熔流闸的熔岩段：停用 = 不留判定、不留绘制） */
  setActive(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.body.enabled = on;
    for (const r of this.surface) r.visible = on;
    if (on) this.applyLevel();
  }

  /** 涨到 / 退到 level：先预警 warn 秒（翻涌发亮），再 seconds 秒缓入缓出过去；停掉自动涨落 */
  riseTo(level: number, seconds = 1.5, warn = 0.8): void {
    this.driver.moveTo(level, seconds, warn);
  }

  recede(seconds = 1.5): void {
    this.riseTo(this.baseLevel, seconds, 0);
  }

  releaseToTide(): void { this.driver.releaseToTide(); }

  update(dt: number): void {
    if (!this.enabled) return;
    if (this.driver.step(dt)) this.applyLevel();
    if (this.driver.phase !== this.lastPhase) {
      const ph = this.driver.phase;
      this.lastPhase = ph;
      const at = _v.set(this.body.center.x, this.level, this.body.center.z);
      if (ph === 'warning') this.field.ctx.audio.play('burn_tick', { position: at, volume: 0.8, pitch: 0.45 });
      else if (ph === 'rising') this.field.ctx.audio.play('skill_fire', { position: at, volume: 0.7, pitch: 0.5 });
      for (const fn of this.listeners) {
        try { fn(this, ph); } catch (err) { console.error('[Lava] 阶段回调出错', err); }
      }
    }
    // 翻涌：预警 / 涨潮时熔岩更亮、流得更快
    const ph = this.driver.phase;
    const want = ph === 'warning' ? 1 : ph === 'rising' ? 0.75 : ph === 'high' ? 0.25 : 0;
    this.agitation = moveTowards(this.agitation, want, dt * 2.5);
    if (this.materials.length && Math.abs(this.agitation - this.shown) > 0.01) {
      for (const m of this.materials) m.uniforms.uAgitation.value = this.agitation;
      this.shown = this.agitation;
    }
  }

  /** 熔岩面高度写进判定体、熔岩面网格 */
  applyLevel(): void {
    this.body.level = this.driver.level;
    for (let i = 0; i < this.surface.length; i++) this.surface[i].position.y = this.body.level + this.surfaceBase[i];
  }

  get agitationLevel(): number { return this.agitation; }
}

interface Track { bank: THREE.Vector3; hasBank: boolean; knockAt: number }

/** 场上的熔岩（Unity LavaField） */
export class LavaField {
  readonly bodies: LavaBody[] = [];
  readonly volumes: LavaVolumeRuntime[] = [];
  /** 本关玩家踩进熔岩的次数、烧死的敌人、拉回的次数（调试 / 测试） */
  entries = 0;
  burned = 0;
  pushedBack = 0;
  /** 只给 XZ 的查询用的地面探测：碰撞世界里 [bottom, top] 之间最高的面 */
  readonly probe: LavaGroundProbe;
  private readonly tracker = new LavaContactTracker();
  private readonly tracks = new WeakMap<IEnemy, Track>();
  private readonly light = new THREE.PointLight(LIGHT, 0, LIGHT_RANGE, 2);
  private readonly lightAt = new THREE.Vector3();
  private lightScan = 0;
  private lightWant = 0;
  private emberDebt = 0;
  private seed = 0x9e3779b9;
  private readonly owned: THREE.Material[] = [];
  private hazardOff: (() => void) | null = null;
  private readonly entered: ((feet: V3) => void)[] = [];
  private readonly burnedListeners: ((e: IEnemy) => void)[] = [];

  constructor(readonly ctx: GameContext, private readonly safe: SafeGround, parent: THREE.Object3D) {
    this.probe = (x, z, top, bottom) => {
      const g = ctx.world.groundHeight(x, z, top);
      return Number.isFinite(g) && g >= bottom ? g : null;
    };
    this.light.name = 'lava-field-light';
    this.light.castShadow = false;
    this.light.visible = false;
    parent.add(this.light);
  }

  get any(): boolean { return this.bodies.length > 0; }

  register(v: LavaVolumeRuntime): void {
    this.volumes.push(v);
    this.bodies.push(v.body);
    // 第一片登记时向 SafeGround 登记危险区：离熔岩 1 m 以内不记成安全点、托回时跳过
    this.hazardOff ??= this.safe.registerHazard(feet => LavaGeometry.near(this.bodies, feet, LavaTuning.SafeMargin));
  }

  ownMaterial(m: THREE.Material): void { this.owned.push(m); }

  onPlayerEntered(fn: (feet: V3) => void): void { this.entered.push(fn); }
  onEnemyBurned(fn: (e: IEnemy) => void): void { this.burnedListeners.push(fn); }

  // ───────────── 查询 ─────────────

  isLava(feet: V3, rise: number = LavaTuning.StandRise): boolean { return LavaGeometry.touches(this.bodies, feet, rise); }
  isLavaAt(x: number, z: number): boolean { return LavaGeometry.isLavaAt(this.bodies, x, z, this.probe).lava; }
  nearLava(feet: V3, margin: number = LavaTuning.SafeMargin): boolean { return LavaGeometry.near(this.bodies, feet, margin); }
  submerged(feet: V3): boolean { return LavaGeometry.submerged(this.bodies, feet); }
  /** p 的 XZ 上方熔岩面的高度（只看形状）；不在任何熔岩形状里返回 NaN */
  surfaceHeight(p: V3): number { return LavaGeometry.surfaceAt(this.bodies, p.x, p.z)?.y ?? NaN; }
  volumeAt(p: V3): LavaVolumeRuntime | null { return (LavaGeometry.surfaceAt(this.bodies, p.x, p.z)?.body.owner as LavaVolumeRuntime) ?? null; }
  nearestShore(from: V3, maxDist = 10): V3 | null { return LavaGeometry.nearestShore(this.bodies, from, maxDist, this.probe); }
  bankToward(from: V3, to: V3, maxDist = 12): V3 | null { return LavaGeometry.bankToward(this.bodies, from, to, maxDist, this.probe); }
  nearestLava(from: V3, maxDist: number): { lava: V3; bank: V3 } | null { return LavaGeometry.nearestLava(this.bodies, from, maxDist, this.probe); }

  /** 不受熔岩影响：首领、飞行、熔岩生物 */
  isImmune(e: IEnemy): boolean {
    const x = e as LavaEnemy;
    return e.isBoss || e.flying || x.swimsInLava === true;
  }

  /** 其它系统直接把敌人挪开（熔泉掀飞、熔流闸）：之后 KnockWindow 秒内落进熔岩算被打进去 */
  noteKnocked(e: IEnemy): void {
    this.trackOf(e).knockAt = this.ctx.time.now;
  }

  // ───────────── 每帧 ─────────────

  update(dt: number, t: number): void {
    for (const v of this.volumes) v.update(dt);
    if (this.bodies.length === 0 || !(dt > 0)) return;
    this.updatePlayer();
    this.updateEnemies(this.ctx.time.now);
    this.updateAmbience(dt, t);
  }

  private updatePlayer(): void {
    const p = this.ctx.player;
    if (!p.alive || this.safe.sinking) {
      this.tracker.reset();
      return;
    }
    const feet = p.position;
    if (!this.tracker.step(this.bodies, feet, p.onGround)) return;
    this.tracker.reset();
    this.entries++;
    // 两团火星 + 贴地冲击环（闪屏、嘶响、晃镜头、扣血在 SafeGround.sink）
    const s = this.surfaceHeight(feet);
    _v.set(feet.x, (Number.isNaN(s) ? feet.y : s) + 0.1, feet.z);
    this.ctx.fx.burst(_v, LAVA_ORANGE, 28, 5, 0.9, 0.11, -2);
    this.ctx.fx.burst(_v, LAVA_GOLD, 12, 3, 0.6, 0.07, -4);
    this.ctx.fx.ring(_v, 1.8, LAVA_ORANGE, 0.45);
    this.safe.sink(HazardSpecs.lava());
    for (const fn of this.entered) fn({ x: feet.x, y: feet.y, z: feet.z });
  }

  private trackOf(e: IEnemy): Track {
    let t = this.tracks.get(e);
    if (!t) {
      t = { bank: new THREE.Vector3(), hasBank: false, knockAt: -Infinity };
      this.tracks.set(e, t);
    }
    return t;
  }

  private updateEnemies(now: number): void {
    const list = this.ctx.enemies.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i] as LavaEnemy;
      if (!e.alive) continue;
      if (this.isImmune(e)) continue;
      const tr = this.trackOf(e);
      // 击退只认明确的信号（失控滑行 knockedBack）：传送、落地吸附不算
      if (LavaEnemyRule.knocked(false, e.knockedBack === true)) tr.knockAt = now;
      const pos = e.position;
      const inLava = LavaGeometry.touches(this.bodies, pos);
      switch (LavaEnemyRule.decide(false, inLava, now, tr.knockAt)) {
        case 'none':
          if (!inLava) {
            tr.bank.copy(pos);
            tr.hasBank = true;
          }
          break;
        case 'burn':
          this.burn(e);
          break;
        case 'pushBack':
          this.pushBack(e, tr);
          break;
      }
    }
  }

  /** 自己走进熔岩 / 被涨潮淹到：拉回上一个岸上位置；岸也被淹了就找最近的岸上导航点 */
  private pushBack(e: IEnemy, tr: Track): void {
    if (!tr.hasBank || LavaGeometry.touches(this.bodies, tr.bank)) {
      const to = this.dryNavPoint(e.position);
      if (!to) return;
      tr.bank.copy(to);
      tr.hasBank = true;
    }
    e.position.copy(tr.bank);
    e.velocity.set(0, 0, 0);
    this.pushedBack++;
  }

  /** 离 pos 最近的、不在熔岩里的导航点（先就近找，再沿熔岩找岸） */
  private dryNavPoint(pos: THREE.Vector3): THREE.Vector3 | null {
    const out = new THREE.Vector3();
    // Unity：NavMesh.SamplePosition(pos, 2 / 4 / 8 / 12 m, 非 Lava 区)。网页导航没有区域：最近点不在熔岩里就用，否则一圈圈随机找
    if (this.ctx.nav.nearestWalkable(pos, out) && out.distanceTo(pos) <= 12 && !LavaGeometry.touches(this.bodies, out)) return out;
    for (const r of [2, 4, 8, 12]) {
      for (let k = 0; k < 6; k++) {
        if (!this.ctx.nav.randomWalkable(pos, r * 0.5, r, out) || LavaGeometry.touches(this.bodies, out)) continue;
        return out;
      }
    }
    const shore = this.nearestShore(pos, 12);
    if (shore && this.ctx.nav.nearestWalkable(_v.set(shore.x, shore.y, shore.z), out) && !LavaGeometry.touches(this.bodies, out)) return out;
    return null;
  }

  /** 被打进熔岩：一击处决级的环境伤害（不暴击、不附着；计击杀、正常掉落）；火免疫的换无属性再来一次 */
  burn(e: IEnemy): void {
    if (!e.alive) return;
    const s = this.surfaceHeight(e.position);
    const at = new THREE.Vector3(e.position.x, (Number.isNaN(s) ? e.position.y : s) + 0.2, e.position.z);
    this.ctx.fx.burst(at, LAVA_ORANGE, 30, 6, 1, 0.13, -3);
    this.ctx.fx.burst(at, LAVA_GOLD, 14, 4, 0.7, 0.08, -5);
    this.ctx.audio.play('skill_fire', { position: at, volume: 0.9, pitch: 0.65 });
    executeEnemy(this.ctx, e, at);
    this.burned++;
    for (const fn of this.burnedListeners) fn(e);
  }

  // ───────────── 点光 · 火星 ─────────────

  private updateAmbience(dt: number, t: number): void {
    const p = this.ctx.player.position;
    this.lightScan -= dt;
    if (this.lightScan <= 0) {
      this.lightScan = 0.15;
      const hit = this.nearestLava(p, LIGHT_REACH);
      this.lightWant = hit ? 1 : 0;
      if (hit) {
        const s = this.surfaceHeight(hit.lava);
        this.lightAt.set(hit.lava.x, Number.isNaN(s) ? hit.lava.y : s, hit.lava.z);
      }
    }
    const k = 1 - Math.exp(-6 * dt);
    const light = this.light;
    if (this.lightWant > 0) {
      if (light.intensity < 0.05) light.position.copy(this.lightAt);
      light.position.x += (this.lightAt.x - light.position.x) * k;
      light.position.z += (this.lightAt.z - light.position.z) * k;
      light.position.y = this.lightAt.y + 1.2;
    }
    const flicker = 0.85 + 0.15 * Math.sin(t * 9.1) * Math.sin(t * 5.3 + 1.2);
    light.intensity += (this.lightWant * LIGHT_INTENSITY * flicker - light.intensity) * k;
    light.visible = light.intensity > 0.02;
    // 火星：玩家 18 m 内有熔岩时从附近的熔岩上冒
    if (!this.nearAnyShape(p, EMBER_REACH)) {
      this.emberDebt = 0;
      return;
    }
    const density = this.ctx.settings.quality === 'low' ? 0.5 : this.ctx.settings.quality === 'medium' ? 0.75 : 1;
    this.emberDebt = Math.min(8, this.emberDebt + dt * EMBER_RATE * density);
    while (this.emberDebt >= 1) {
      this.emberDebt -= 1;
      this.emitEmber(p);
    }
  }

  private nearAnyShape(p: THREE.Vector3, r: number): boolean {
    for (const b of this.bodies) if (b.enabled && b.inset(p.x, p.z) >= -r && p.y - b.level < 30) return true;
    return false;
  }

  private emitEmber(near: THREE.Vector3): void {
    for (let k = 0; k < 6; k++) {
      const x = near.x + (this.rand() - 0.5) * EMBER_REACH * 2, z = near.z + (this.rand() - 0.5) * EMBER_REACH * 2;
      const s = LavaGeometry.surfaceAt(this.bodies, x, z);
      if (!s || !this.isLavaAt(x, z)) continue;
      this.ctx.fx.burst(_v.set(x, s.y + 0.1, z), EMBER, 1, 0.35, 1.8 + this.rand() * 0.8, 0.14 + this.rand() * 0.08, -0.9 - this.rand() * 0.8);
      return;
    }
  }

  /** xorshift32：表现用，不占用对局随机数 */
  private rand(): number {
    let s = this.seed;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.seed = s >>> 0;
    return this.seed / 4294967296;
  }

  dispose(): void {
    this.hazardOff?.();
    this.hazardOff = null;
    this.light.removeFromParent();
    this.light.dispose();
    for (const m of this.owned) m.dispose();
    this.owned.length = 0;
  }
}

/**
 * 一击处决级的环境伤害（Unity Burn / Scorch：ExecuteBase + (生命 + 护甲 + 护盾) × 4，火；火免疫的换无属性再来一次）。
 * 网页的伤害来源没有「环境」，按 'status'（不暴击、不触发武器词条）
 */
export function executeEnemy(ctx: GameContext, e: IEnemy, at: THREE.Vector3): void {
  const base = 1e7 + Math.max(0, e.hp + e.armor + e.shield) * 4;
  ctx.combat.damageEnemy(e, { base, element: 'fire', source: 'status', canCrit: false, procDepth: 2, tags: ['lava'], point: at, elementChance: 0 });
  if (e.alive) ctx.combat.damageEnemy(e, { base, element: 'none', source: 'status', canCrit: false, procDepth: 2, tags: ['lava'], point: at, bypassShield: true });
}

/** 场上所有熔岩面材质里挑一份当模板（运行时现建的熔岩面用） */
export function findLavaTemplate(parts: SceneParts): THREE.ShaderMaterial | null {
  for (const root of parts.all()) {
    const list = lavaMaterialsOf(root);
    if (list.length) return list[0];
  }
  return null;
}
