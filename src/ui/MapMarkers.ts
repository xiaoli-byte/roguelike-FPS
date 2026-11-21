/**
 * 行旅图地点表（照译 Unity G/UI/MapMarkers.cs），罗盘条（hud/CompassStrip）与 M 键全图（screens/MapScreen）共用：
 *   · 发现：场地走到触发圈外 20 m 内（至少 36 m）或已开打；藏宝点走近（18 m）或调查过；灵火坛 30 m；补给营 40 m；出口 40 m 或已开启；
 *     首领场地边缘 30 m 内或已开战。发现过本关内不会再变回去。
 *   · 目标：交战中的场地 / 守军 → 首领战 → 已开启的出口 → 还没肃清的必清场地 / 还要点的灵火坛里最近的一个（选定后到完成前不换）→ 首领场地 → 出口。
 *     目标不用发现就显示。
 * 网页的数据来源（collectPois）：关卡的 AdventureInfo（ctx.stage.exploration：遭遇 = 场地 / 藏宝守军，物资点 = 藏宝，战前补给 = 补给营，
 * 清场后开的出口；首领关的终点遭遇 = 首领场地；旧式祭坛关的祭坛 = 灵火坛）+ 关卡目标的灵火坛（4-1 / 4-3 的 LevelObjectives）。
 * 与 Unity 的差异：出口在清关前没有位置（网页清场后才定哪个出口开），所以没开的出口不上图；场地没有「前置场地」数据，候选不分先后只看远近。
 * 方位照 Unity：北 = Unity +Z、东 = Unity +X。导出器把 Unity 坐标换成网页坐标时只翻 X（x_web = −x_unity，z 不变，见
 * WebSceneExporter.Point），所以网页场景里北 = +Z、东 = −X；俯视图北朝上（底图范围 area = [−xMax, −xMin, zMin, zMax]，网页坐标）。
 * 网页玩家的 yaw：0 朝 −Z（= 南）、逆时针为正，视线朝向 = 180° − yaw。
 * 本文件只 import 类型（测试按 data: URL 直接加载）。
 */
import type { GameContext } from '../core/types';

export type PoiKind = 'site' | 'cache' | 'camp' | 'exit' | 'boss' | 'altar';
export type MarkerState = 'idle' | 'active' | 'done';
export type RGBA4 = readonly [number, number, number, number];

/** 这一帧某个地点的实况（collectPois 给出） */
export interface PoiInput {
  /** 本关内稳定的键（发现记录按它存） */
  key: string;
  kind: PoiKind;
  name: string;
  x: number;
  z: number;
  optional?: boolean;
  state: MarkerState;
  /** 走进这个水平距离就算发现 */
  discoverRadius: number;
  /** 来源自己说已经发现了（开打、调查过、点亮、出口已开） */
  discovered?: boolean;
}

export interface MapMarker extends PoiInput {
  discovered: boolean;
  /** 离玩家的水平距离（米，最近一次 tick） */
  distance: number;
}

export const SITE_MARGIN = 20, SITE_MIN = 36, CACHE_RADIUS = 18, ALTAR_RADIUS = 30, CAMP_RADIUS = 40, EXIT_RADIUS = 40, BOSS_MARGIN = 30;

const GLYPHS: Record<PoiKind, string> = { site: '战', cache: '宝', camp: '营', exit: '门', boss: '首', altar: '火' };
const KIND_NAMES: Record<PoiKind, string> = { site: '场地', cache: '藏宝', camp: '补给营', exit: '出口', boss: '首领', altar: '灵火坛' };
const hex = (n: number, a = 1): RGBA4 => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
const DONE: RGBA4 = [0.569, 0.843, 0.745, 0.75];

/** 地点种类的图标字（罗盘 / 全图的小徽记） */
export function markerGlyph(k: PoiKind): string {
  return GLYPHS[k] ?? '·';
}

export function kindName(k: PoiKind): string {
  return KIND_NAMES[k] ?? '';
}

/** 徽记颜色：交战红、肃清青绿、未动琥珀；藏宝纸白、补给营亮金、出口青、首领朱砂、灵火冰蓝 */
export function markerColor(kind: PoiKind, state: MarkerState): RGBA4 {
  if (state === 'done') return DONE;
  switch (kind) {
    case 'site': return state === 'active' ? hex(0xff9476) : hex(0xe6b679);
    case 'cache': return state === 'active' ? hex(0xff9476) : hex(0xefe4cc);
    case 'camp': return hex(0xf4d893);
    case 'exit': return hex(0xb8eaff);
    case 'boss': return hex(0xff6a4d);
    case 'altar': return hex(0x9ef0ff);
    default: return hex(0xefe4cc);
  }
}

/** 世界水平方位角（度，0 = 北 +Z，顺时针到 90 = 东 −X；= Unity MapMarkers.Bearing 换到网页坐标） */
export function bearing(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return (Math.atan2(fromX - toX, toZ - fromZ) * 180) / Math.PI;
}

/** 视线水平朝向（度，0 = 北，−180..180）：网页视线 = (−sin yaw, −cos yaw)，换成 Unity 坐标 (sin yaw, −cos yaw) 再照 Unity Heading 取 atan2(x, z) */
export function headingOf(yaw: number): number {
  return deltaAngle(0, 180 - (yaw * 180) / Math.PI);
}

/** a → b 的最短角差（度，−180..180） */
export function deltaAngle(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export class MapMarkers {
  private readonly list: MapMarker[] = [];
  private readonly found = new Set<string>();
  private signature = '';
  /** 当前目标（没有为 null）与它的动词（「前往」「交战中」「首领战」「前往出口」…） */
  target: MapMarker | null = null;
  targetVerb = '';
  /** 地点表重建的次数（界面据此重建元素） */
  version = 0;

  /** 全部地点（含没发现的；显示前看 visible） */
  get all(): readonly MapMarker[] {
    return this.list;
  }

  /** 显示：发现过，或者是当前目标 */
  visible(m: MapMarker): boolean {
    return m.discovered || m === this.target;
  }

  /** 换关：地点、发现记录清零 */
  reset(): void {
    this.list.length = 0;
    this.found.clear();
    this.signature = '';
    this.target = null;
    this.targetVerb = '';
    this.version++;
  }

  /** 按这一帧的地点实况与玩家位置刷新：地点集合变了就重建、更新发现 / 状态、选目标。altarsNeeded = 还要再点灵火坛 */
  tick(pois: readonly PoiInput[], px: number, pz: number, altarsNeeded = false): void {
    const sig = pois.map((p) => p.key).join('|');
    if (sig !== this.signature) {
      this.signature = sig;
      const targetKey = this.target?.key;
      this.list.length = 0;
      for (const p of pois) this.list.push({ ...p, discovered: this.found.has(p.key), distance: 0 });
      this.target = this.list.find((m) => m.key === targetKey) ?? null;
      this.version++;
    }
    for (let i = 0; i < this.list.length; i++) {
      const m = this.list[i], p = pois[i];
      m.state = p.state;
      m.x = p.x;
      m.z = p.z;
      m.name = p.name;
      m.distance = Math.hypot(m.x - px, m.z - pz);
      if (!m.discovered && (p.discovered || m.distance <= p.discoverRadius)) {
        m.discovered = true;
        this.found.add(m.key);
      }
    }
    this.pickTarget(altarsNeeded);
  }

  private first(kind: PoiKind, state: MarkerState): MapMarker | null {
    return this.list.find((m) => m.kind === kind && m.state === state) ?? null;
  }

  private pickTarget(altarsNeeded: boolean): void {
    // 1 交战中的场地 / 守军
    let t = this.first('site', 'active') ?? this.first('cache', 'active');
    if (t) return this.set(t, '交战中');
    // 2 首领战
    t = this.first('boss', 'active');
    if (t) return this.set(t, '首领战');
    // 3 出口已开
    t = this.first('exit', 'active');
    if (t) return this.set(t, '前往出口');
    // 4 必清场地 / 还要点的灵火坛：当前目标还没完成就不换；否则挑最近的
    const cur = this.target;
    if (cur && cur.state !== 'done' && this.list.includes(cur) && candidate(cur, altarsNeeded)) return this.set(cur, verb(cur));
    let best: MapMarker | null = null;
    for (const m of this.list) if (candidate(m, altarsNeeded) && (!best || m.distance < best.distance)) best = m;
    if (best) return this.set(best, verb(best));
    // 5 首领场地 → 出口
    t = this.first('boss', 'idle') ?? this.first('exit', 'idle');
    this.set(t, !t ? '' : t.kind === 'boss' ? '首领' : '出口');
  }

  private set(t: MapMarker | null, v: string): void {
    this.target = t;
    this.targetVerb = v ?? '';
  }

  /** 发现过的地点数 / 总数（不含出口与首领：它们是目的地，不算探索） */
  discovery(): { found: number; total: number } {
    let found = 0, total = 0;
    for (const m of this.list) {
      if (m.kind === 'exit' || m.kind === 'boss') continue;
      total++;
      if (m.discovered) found++;
    }
    return { found, total };
  }

  /** 某种地点完成数 / 总数（必清场地传 requiredOnly） */
  progress(kind: PoiKind, requiredOnly = false): { done: number; total: number } {
    let done = 0, total = 0;
    for (const m of this.list) {
      if (m.kind !== kind || (requiredOnly && m.optional)) continue;
      total++;
      if (m.state === 'done') done++;
    }
    return { done, total };
  }
}

const verb = (m: MapMarker) => (m.kind === 'altar' ? '点亮' : '前往');

/** 目标候选：没肃清的必清场地，或还要点亮的灵火坛 */
function candidate(m: MapMarker, altarsNeeded: boolean): boolean {
  if (m.state === 'done') return false;
  if (m.kind === 'altar') return altarsNeeded;
  return m.kind === 'site' && !m.optional;
}

// ───────────── 网页的数据来源 ─────────────

export interface MapSnapshot {
  pois: PoiInput[];
  /** 还要再点灵火坛（关卡目标没满） */
  altarsNeeded: boolean;
  /** 关卡名（全图标题；没有为空串） */
  title: string;
  /** 俯视图与它盖住的世界范围 [minX, maxX, minZ, maxZ]（没有为 null） */
  image: { url: string; area: readonly [number, number, number, number] } | null;
}

interface AltarLike {
  position: { x: number; z: number };
  lit: boolean;
  kindling: boolean;
  spec?: { name?: string };
}

/** 从关卡状态收集这一帧的地点（没有探索数据的关卡返回空表） */
export function collectPois(ctx: GameContext): MapSnapshot {
  const out: MapSnapshot = { pois: [], altarsNeeded: false, title: '', image: null };
  const stage = ctx.stage;
  const info = stage?.exploration ?? null;
  if (!info) return out;
  out.title = info.title ?? '';
  out.image = info.mapImage ?? null;
  const bossStage = stage.stage?.type === 'boss';
  const obj = info.objective;
  for (const e of info.encounters ?? []) {
    const atObjective = Math.hypot(e.position.x - obj.x, e.position.z - obj.z) < 1;
    if (bossStage && atObjective) continue; // 首领关的终点遭遇算首领场地（下面）
    const state: MarkerState = e.phase === 'active' ? 'active' : e.phase === 'cleared' ? 'done' : 'idle';
    const cache = e.kind === 'cache';
    out.pois.push({
      key: 'enc:' + e.id, kind: cache ? 'cache' : 'site', name: e.label, x: e.position.x, z: e.position.z, optional: !!e.optional || cache, state,
      discoverRadius: cache || e.optional ? CACHE_RADIUS : Math.max(SITE_MIN, (e.triggerRadius ?? e.radius) + SITE_MARGIN),
      discovered: e.phase !== 'undiscovered' || !!e.discovered,
    });
  }
  for (const s of info.sites)
    out.pois.push({ key: 'site:' + s.id, kind: 'cache', name: s.label, x: s.position.x, z: s.position.z, optional: true, state: s.visited ? 'done' : 'idle', discoverRadius: CACHE_RADIUS, discovered: s.visited });
  if (info.preparation) {
    const p = info.preparation;
    out.pois.push({ key: 'camp:' + p.room, kind: 'camp', name: p.label, x: p.position.x, z: p.position.z, state: 'idle', discoverRadius: CAMP_RADIUS });
  }
  const objective = (stage as { levelObjective?: { altars?: AltarLike[]; lit?: number; needed?: number } | null }).levelObjective ?? null;
  if (objective?.altars?.length) {
    objective.altars.forEach((a, i) => {
      out.pois.push({
        key: 'altar:' + i, kind: 'altar', name: a.spec?.name || '灵火坛', x: a.position.x, z: a.position.z,
        state: a.lit ? 'done' : a.kindling ? 'active' : 'idle', discoverRadius: ALTAR_RADIUS, discovered: a.lit,
      });
    });
    out.altarsNeeded = (objective.lit ?? 0) < (objective.needed ?? 0);
  } else if (bossStage) {
    let fighting = false;
    for (const e of ctx.enemies?.list ?? []) if (e.isBoss && e.alive) fighting = true;
    const state: MarkerState = stage.cleared || info.phase === 'cleared' ? 'done' : fighting ? 'active' : 'idle';
    out.pois.push({ key: 'boss', kind: 'boss', name: info.objectiveLabel ?? '首领', x: obj.x, z: obj.z, state, discoverRadius: 20 + BOSS_MARGIN, discovered: state !== 'idle' });
  } else if (!info.automaticEncounters) {
    // 旧式祭坛关：启动试炼的灵火祭坛
    const state: MarkerState = info.phase === 'cleared' ? 'done' : info.phase === 'battle' ? 'active' : 'idle';
    out.pois.push({ key: 'altar', kind: 'altar', name: info.objectiveLabel ?? '灵火祭坛', x: obj.x, z: obj.z, state, discoverRadius: ALTAR_RADIUS, discovered: state !== 'idle' });
    out.altarsNeeded = state !== 'done';
  }
  if (info.exit) out.pois.push({ key: 'exit', kind: 'exit', name: '出口', x: info.exit.x, z: info.exit.z, state: 'active', discoverRadius: EXIT_RADIUS, discovered: true });
  return out;
}

/** 罗盘条与全图共用的一份地点状态：每帧（或打开全图时）按关卡状态刷新；换关（探索数据换了对象）时清空发现记录 */
export class MapModel {
  readonly markers = new MapMarkers();
  snap: MapSnapshot = { pois: [], altarsNeeded: false, title: '', image: null };
  private infoRef: unknown = undefined;

  update(ctx: GameContext): void {
    const info = ctx.stage?.exploration ?? null;
    if (info !== this.infoRef) {
      this.infoRef = info;
      this.markers.reset();
    }
    this.snap = collectPois(ctx);
    const p = ctx.player?.position;
    this.markers.tick(this.snap.pois, p?.x ?? 0, p?.z ?? 0, this.snap.altarsNeeded);
  }
}

/** 没有俯视图时的范围：地点 + 玩家的包围盒外扩 30 m，至少 120 m 见方 → [minX, maxX, minZ, maxZ] */
export function fallbackArea(markers: readonly { x: number; z: number }[], px: number, pz: number): [number, number, number, number] {
  let x0 = px, x1 = px, z0 = pz, z1 = pz;
  for (const m of markers) {
    x0 = Math.min(x0, m.x);
    x1 = Math.max(x1, m.x);
    z0 = Math.min(z0, m.z);
    z1 = Math.max(z1, m.z);
  }
  const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
  const w = Math.max(120, x1 - x0 + 60), h = Math.max(120, z1 - z0 + 60);
  return [cx - w * 0.5, cx + w * 0.5, cz - h * 0.5, cz + h * 0.5];
}

/**
 * 世界 XZ（网页坐标）→ 图上的比例位置（0..1，u 向右 = 东、v 向下 = 南，北在上）。
 * 照 Unity MapScreen：u = (x_unity − xMin) / 宽、top = 1 − (z − zMin) / 高；x_unity = −x，area[1] = −xMin，所以 u = (area[1] − x) / 宽
 */
export function worldToMap(area: readonly [number, number, number, number], x: number, z: number): { u: number; v: number } {
  const c = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return { u: c((area[1] - x) / Math.max(1e-3, area[1] - area[0])), v: c((area[3] - z) / Math.max(1e-3, area[3] - area[2])) };
}

/** 图框尺寸（设计像素）：按面板留出标题行和底栏，保持底图长宽比 */
export function mapBoxSize(panelW: number, panelH: number, area: readonly [number, number, number, number]): { w: number; h: number } {
  const maxW = Math.min(1500, panelW - 90 * 2), maxH = Math.max(200, panelH - 230);
  const aspect = (area[1] - area[0]) / Math.max(1, area[3] - area[2]);
  let w = maxW, h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { w: Math.round(w), h: Math.round(h) };
}
