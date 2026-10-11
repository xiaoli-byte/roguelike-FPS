/**
 * V2 redesign art placement, derived only from the plan geometry (no per-map side tables).
 *
 * Every placement is a target box: centre on the ground, yaw (the asset's +Z front turns to face
 * `yaw`), and the metres it must fill. The view fits each published Tripo model into that box.
 *  - ramparts (the modular wall kit: end, panels, end) tile every room/passage edge that faces solid mass,
 *    inner face on the collision line;
 *  - one gateway per passage, in the passage's stretch between rooms, its towers in the solid mass;
 *  - covers become columns (tall), barricades (vault height) or ruined cover walls (full height), unless
 *    the plan names set dressing (stall, goods pile, treasure hoard) for that cover box;
 *  - corner towers cap every solid chamfered room edge;
 *  - raised decks are ringed with podium blocks, and each stair ramp gets a stair flight;
 *  - one colossus landmark stands beyond the exit, visible down the final arena.
 */
import type { LevelLayout, P2 } from './LevelTypes';
import { whiteboxInsidePolygon, whiteboxPoint } from './WhiteboxGen';
import type { WhiteboxPlan, WhiteboxPoint } from './WhiteboxTypes';

export type RedesignArtKind = 'rampart' | 'gateway' | 'column' | 'barricade' | 'coverwall' | 'platform' | 'stairs' | 'landmark'
  | 'stall' | 'goods' | 'hoard' | 'ruin' | 'brazier' | 'tower' | 'shrine';

/**
 * Building kits by kit key. A plan uses its chapter's kit unless REDESIGN_PLAN_KITS names another one
 * (chapter 2 descends from the Kunlun palace to the frozen North Sea within the chapter).
 * The chapter-2 Kunlun kit keeps its historical SM_Tripo_* ids but is modelled with local Hunyuan3D 2mv.
 */
export const REDESIGN_ART_ASSETS: Readonly<Record<string, Readonly<Record<RedesignArtKind, string>>>> = {
  desert: {
    rampart: 'SM_Tripo_DesertRampartPanel', gateway: 'SM_Tripo_DesertGateway', column: 'SM_Tripo_DesertColumn',
    barricade: 'SM_Tripo_DesertBarricade', coverwall: 'SM_Tripo_DesertCoverWall', platform: 'SM_Tripo_DesertPlatformBlock',
    stairs: 'SM_Tripo_DesertStairs', landmark: 'SM_Tripo_DesertColossus',
    stall: 'SM_Tripo_DesertMarketStall', goods: 'SM_Tripo_DesertGoodsPile', hoard: 'SM_Tripo_DesertTreasureHoard',
    ruin: 'SM_Tripo_DesertColumnRuin', brazier: 'SM_Tripo_DesertBrazier', tower: 'SM_Tripo_DesertCornerTower',
    shrine: 'SM_Tripo_DesertPortalShrine',
  },
  frost: {
    rampart: 'SM_Tripo_FrostRampartPanel', gateway: 'SM_Tripo_FrostGateway', column: 'SM_Tripo_FrostColumn',
    barricade: 'SM_Tripo_FrostBarricade', coverwall: 'SM_Tripo_FrostCoverWall', platform: 'SM_Tripo_FrostPlatformBlock',
    stairs: 'SM_Tripo_FrostStairs', landmark: 'SM_Tripo_FrostKaiming',
    // Set dressing: a pilgrims' prayer shelter is the stall, frozen offerings the goods, the Queen Mother's jade the hoard.
    stall: 'SM_Tripo_FrostPrayerTent', goods: 'SM_Tripo_FrostOfferings', hoard: 'SM_Tripo_FrostJadeHoard',
    ruin: 'SM_Tripo_FrostColumnRuin', brazier: 'SM_Tripo_FrostIceLantern', tower: 'SM_Tripo_FrostCornerTower',
    shrine: 'SM_Tripo_FrostPortalShrine',
  },
  // The frozen North Sea (frost-3's lake hub, frost-5's ice-hole boss ring): glacier cliffs, whale-bone arches, a
  // whale-bone lighthouse for the towers and a junk frozen in the ice as the landmark.
  frostSea: {
    rampart: 'SM_Tripo_FrostSeaRampartPanel', gateway: 'SM_Tripo_FrostSeaGateway', column: 'SM_Tripo_FrostSeaColumn',
    barricade: 'SM_Tripo_FrostSeaBarricade', coverwall: 'SM_Tripo_FrostSeaCoverWall', platform: 'SM_Tripo_FrostSeaPlatformBlock',
    stairs: 'SM_Tripo_FrostSeaStairs', landmark: 'SM_Tripo_FrostSeaJunk',
    stall: 'SM_Tripo_FrostSeaYurt', goods: 'SM_Tripo_FrostSeaFishRack', hoard: 'SM_Tripo_FrostSeaPearlHoard',
    ruin: 'SM_Tripo_FrostSeaMastRuin', brazier: 'SM_Tripo_FrostSeaBoneLantern', tower: 'SM_Tripo_FrostSeaLighthouse',
    shrine: 'SM_Tripo_FrostSeaPortalShrine',
  },
};

/** Plans that use another kit than their chapter's (plan id → REDESIGN_ART_ASSETS key). */
export const REDESIGN_PLAN_KITS: Readonly<Record<string, string>> = { 'frost-3-v2': 'frostSea', 'frost-5-v2': 'frostSea' };

/** The kit key a plan builds with. */
export function redesignKitKey(plan: Pick<WhiteboxPlan, 'id' | 'chapter'>): string {
  const key = REDESIGN_PLAN_KITS[plan.id];
  return key && REDESIGN_ART_ASSETS[key] ? key : plan.chapter;
}

/**
 * Published proportions per kit (metres, measured from LOD0), which the placements keep:
 *  - gateway: the ground-level opening between its towers, overall width / height / depth; gateways scale
 *    uniformly so the opening frames the authored passage with `clearance` (stretching would distort the towers);
 *  - postDepthTolerance: plan gate posts (cover art 'gate') were authored for the desert gateway; a pair is
 *    spanned by the kit's gateway when its depth at the posts' width is within this of the posts' depth and the
 *    pair spans at most postMaxSpan;
 *  - exactRuns: wall runs end exactly at passage mouths, wrap acute corners and short ledges, and stop where a
 *    wall's body would reach floor (a passage leaving a room at a slant). The desert keeps its shipped layout;
 *  - shrine: the portal arch; tower: the corner tower; landmark: the statue (placed at LANDMARK_SCALE).
 */
export interface RedesignKitShape {
  gateway: { opening: number; width: number; height: number; depth: number; clearance: number };
  postDepthTolerance: number; postMaxSpan: number;
  exactRuns: boolean;
  /**
   * Minimum metres between corner towers (0 = one on every qualifying chamfer). Faceted rooms like the frost lake
   * have a chamfer every few metres; capping each one lined the shore with identical towers.
   */
  towerSpacing: number;
  shrine: { width: number; height: number; depth: number };
  tower: { width: number; depth: number; height: number };
  landmark: readonly [number, number, number];
}
export const REDESIGN_KIT_SHAPES: Readonly<Record<string, RedesignKitShape>> = {
  desert: {
    gateway: { opening: 5.389, width: 13.524, height: 11, depth: 4.01, clearance: 1.04 },
    postDepthTolerance: .5, postMaxSpan: 30, exactRuns: false, towerSpacing: 0,
    shrine: { width: 9.68, height: 11, depth: 3.3 },
    tower: { width: 7.2, depth: 7.2, height: 13 },
    landmark: [8.76, 16, 9.53],
  },
  // Hunyuan 2mv Kunlun kit: gateway opening measured at 1-3 m (its battered plinths narrow it to 4.35 m at the ground).
  frost: {
    gateway: { opening: 4.745, width: 12.004, height: 11.147, depth: 3.9, clearance: 1.04 },
    postDepthTolerance: 1, postMaxSpan: 36, exactRuns: true, towerSpacing: 26,
    shrine: { width: 10.458, height: 10.931, depth: 2.937 },
    tower: { width: 7.2, depth: 7.2, height: 13 },
    landmark: [8.127, 15.54, 7.877],
  },
  // Hunyuan 2mv North-Sea kit: the whale-bone arch's opening measured at 1-3 m (3.4 m between its cairns at the ground).
  frostSea: {
    gateway: { opening: 4.035, width: 10.779, height: 10.758, depth: 2.954, clearance: 1.04 },
    postDepthTolerance: 1, postMaxSpan: 36, exactRuns: true, towerSpacing: 26,
    shrine: { width: 7.623, height: 10.444, depth: 3.713 },
    tower: { width: 7.2, depth: 7.2, height: 13 },
    landmark: [5.819, 15.332, 9.74],
  },
};
/** Landmarks stand this much larger than their published size (seen from across the level). */
const LANDMARK_SCALE = 1.8;

/**
 * The modular wall kit per theme, split offline from the published Tripo sections by
 * art/pipeline/derive_wall_kit.py: a bay panel cut through both pilaster centre lines (and capped), the
 * two stepped ends outside them, and a plain variant panel. Runs are laid end, panels, end; neighbouring
 * panels meet face to face so every joint is the middle of a pilaster. Widths are the pieces' own (metres,
 * from the manifest bounds); a run scales them uniformly along its length to fit, within a few percent.
 */
export const REDESIGN_WALL_KITS: Readonly<Record<string, {
  panel: string; plain: string; endL: string; endR: string; widths: { panel: number; plain: number; end: number };
  /** Preferred stretch of the kit along a run. */
  scale: number;
}>> = {
  desert: {
    panel: 'SM_Tripo_DesertRampartPanel', plain: 'SM_Tripo_DesertRampartPlainPanel',
    endL: 'SM_Tripo_DesertRampartEndL', endR: 'SM_Tripo_DesertRampartEndR',
    widths: { panel: 4.5, plain: 6.5, end: 1.736 }, scale: 4.8 / 4.5,
  },
  // Pilasters at the section ends: bays 5.7 m, the plain panel cut through its outer crenels (three merlons).
  frost: {
    panel: 'SM_Tripo_FrostRampartPanel', plain: 'SM_Tripo_FrostRampartPlainPanel',
    endL: 'SM_Tripo_FrostRampartEndL', endR: 'SM_Tripo_FrostRampartEndR',
    widths: { panel: 5.7, plain: 4.9, end: 1.062 }, scale: 1,
  },
  // Glacier cliffs without pilasters: the middle 4.0 / 4.4 m of each section, the tapered edges as run ends.
  frostSea: {
    panel: 'SM_Tripo_FrostSeaRampartPanel', plain: 'SM_Tripo_FrostSeaRampartPlainPanel',
    endL: 'SM_Tripo_FrostSeaRampartEndL', endR: 'SM_Tripo_FrostSeaRampartEndR',
    widths: { panel: 4, plain: 4.4, end: .876 }, scale: 1,
  },
};
/** Share of panels that take the plain variant (never two in a row). */
const RAMPART_VARIANT_SHARE = .3;
/** The least stretch along a run before a plain panel (if wider) is swapped back to fit it. */
const RAMPART_SCALE_MIN = .88;
/** Deterministic [0, 1) from a position, so the same plan always builds the same wall. */
const hash01 = (x: number, z: number): number => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

export interface RedesignArtPlacement {
  kind: RedesignArtKind;
  assetId: string;
  x: number; y: number; z: number;
  /** Rotation about +Y; the model's +Z (front) ends up facing (sin yaw, cos yaw). */
  yaw: number;
  /** Target size in metres along the model's own X (width), Y (height), Z (depth) after rotation. */
  size: [number, number, number];
}

const RAMPART_DEPTH = 3, SAMPLE = .5;
/** Gateways keep this much of their passage clear on each side of their depth, so no face meets a room. */
const GATEWAY_MARGIN = 1;
/** A wall stretch that stops at a gateway's tower reaches this far into it, hiding its end piece in the tower. */
const GATEWAY_TUCK = 1;
/*
 * The portal shrine (REDESIGN_KIT_SHAPES[kit].shrine) is an arch the exit portal rises in front of. Its two pylons
 * are 'shrine' cover boxes on the floor; its back stands on the boundary wall line, so the arch (open front to
 * back) shows the rampart behind it. Corner towers always clear the ramparts.
 */

/**
 * Inside an open void (WhiteboxPlan.voids, frost-5's ice hole where the boss rises): never solid mass, so its rim
 * gets no rampart or tower (the boss draws the water and ice; the generator fences it invisibly). The margin
 * covers the faceted inner edge of the ring polygon around the circle.
 */
function insideVoid(plan: WhiteboxPlan, p: WhiteboxPoint): boolean {
  return (plan.voids ?? []).some(v => Math.hypot(p[0] - v.center[0], p[1] - v.center[1]) <= v.radius + 1.5);
}

function insideFloor(plan: WhiteboxPlan, p: WhiteboxPoint): boolean {
  if (plan.rooms.some(room => whiteboxInsidePolygon(p, room.polygon))) return true;
  return plan.passages.some(path => path.points.some((b, i) => {
    if (i === 0) return false;
    const a = path.points[i - 1], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz) <= path.width / 2;
  }));
}

type BoundaryRun = { a: WhiteboxPoint; b: WhiteboxPoint; n: WhiteboxPoint };

/**
 * How far a run reaching a polygon corner must continue past it so that its body (RAMPART_DEPTH deep,
 * behind the inner face) closes the wedge outside the turn, plus a margin for the model's stepped ends.
 */
function cornerReach(u: WhiteboxPoint, v: WhiteboxPoint): number {
  const turn = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
  return Math.min(4, RAMPART_DEPTH * Math.tan(turn / 2) + .6);
}

/** Edge runs of floor that face outside mass, as [start, end, outward normal] in plan metres. */
function boundaryRuns(plan: WhiteboxPlan, exact: boolean): BoundaryRun[] {
  // Room edges remember their neighbours' directions so runs that reach a corner can wrap it.
  const edges: { a: WhiteboxPoint; b: WhiteboxPoint; prev?: WhiteboxPoint; next?: WhiteboxPoint }[] = [];
  const dir = (a: WhiteboxPoint, b: WhiteboxPoint): WhiteboxPoint => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  };
  for (const room of plan.rooms) {
    const poly = room.polygon, n = poly.length;
    poly.forEach((a, i) => edges.push({ a, b: poly[(i + 1) % n],
      prev: dir(poly[(i + n - 1) % n], a), next: dir(poly[(i + 1) % n], poly[(i + 2) % n]) }));
  }
  for (const path of plan.passages) for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / len * path.width / 2, nz = (b[0] - a[0]) / len * path.width / 2;
    edges.push({ a: [a[0] + nx, a[1] + nz], b: [b[0] + nx, b[1] + nz] }, { a: [b[0] - nx, b[1] - nz], b: [a[0] - nx, a[1] - nz] });
  }
  const runs: BoundaryRun[] = [];
  for (const { a, b, prev, next } of edges) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1) continue;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    // Scan both sides: an edge carrying a passage mouth has floor on its outer side there, so no single
    // sample (the midpoint, say) can tell which side is outward. Only the outward side ever yields runs.
    for (const s of [1, -1]) {
      const nx = uz * s, nz = -ux * s;
      let start = -1;
      const steps = Math.floor(len / SAMPLE);
      const isWall = (t: number) => {
        const px = a[0] + ux * t, pz = a[1] + uz * t;
        const out: WhiteboxPoint = [px + nx * .6, pz + nz * .6];
        return !insideFloor(plan, out) && !insideVoid(plan, out) && insideFloor(plan, [px - nx * .6, pz - nz * .6]);
      };
      // Where a run meets an opening between two samples, find the mouth to a few centimetres: stopping a whole
      // sample short left a slit at the corner where a passage leaves a room.
      const mouth = (wallT: number, openT: number) => {
        for (let i = 0; i < 6; i++) { const mid = (wallT + openT) / 2; if (isWall(mid)) wallT = mid; else openT = mid; }
        return wallT;
      };
      for (let k = 0; k <= steps; k++) {
        const t = Math.min(len, k * SAMPLE);
        const wall = isWall(t);
        if (wall && start < 0) start = exact && k > 0 ? mouth(t, t - SAMPLE) : t;
        if ((!wall || k === steps) && start >= 0) {
          let end = wall ? t : exact ? mouth(t - SAMPLE, t) : t - SAMPLE, from = start;
          // Runs cut by an opening stop there (the gateway frames it); runs reaching a corner wrap it. At an acute
          // corner the inward probe leaves the room up to a metre short of the vertex: that still reaches the corner
          // (nothing opens there). A short ledge between a corner and a passage mouth counts with its wrap.
          const openAt = (t: number) => insideFloor(plan, [a[0] + ux * t + nx * .6, a[1] + uz * t + nz * .6]);
          const wrapFrom = prev && (from === 0 || (exact && from <= 1 && !openAt(0))) ? cornerReach(prev, [ux, uz]) : 0;
          const wrapEnd = next && k === steps && (wall || (exact && len - end <= 1 && !openAt(len))) ? cornerReach([ux, uz], next) : 0;
          if (end - from >= 2 || exact && (wrapFrom || wrapEnd) && Math.min(end, len) - Math.max(from, 0) + wrapFrom + wrapEnd >= 2) {
            if (wrapFrom) from = -wrapFrom;
            if (wrapEnd) end = len + wrapEnd;
            runs.push({ a: [a[0] + ux * from, a[1] + uz * from], b: [a[0] + ux * end, a[1] + uz * end], n: [nx, nz] });
          }
          start = -1;
        }
      }
    }
  }
  return runs;
}

export function buildRedesignArtLayout(L: LevelLayout): RedesignArtPlacement[] {
  const meta = L.whitebox;
  if (!meta) return [];
  const plan = meta.plan, kitKey = redesignKitKey(plan), ids = REDESIGN_ART_ASSETS[kitKey], shape = REDESIGN_KIT_SHAPES[kitKey];
  if (!ids || !shape) return [];
  const GATEWAY = shape.gateway, SHRINE = shape.shrine, TOWER = shape.tower;
  const out: RedesignArtPlacement[] = [];
  const world = (p: readonly number[]): P2 => whiteboxPoint(plan, p);
  const yawFacing = (dx: number, dz: number): number => Math.atan2(dx, dz);
  const height = L.wallHeight;

  const gateways: RedesignArtPlacement[] = [];
  // One gateway per passage, centred on the stretch of its centreline that lies outside every room, so
  // the towers stand in the solid mass either side of the passage and nothing but the open archway
  // overlaps walkable floor. Rooms that meet directly (no outside stretch long enough for the gateway's
  // depth) get no gateway; their ramparts already frame the shared opening.
  for (const path of plan.passages) {
    const scale = path.width * GATEWAY.clearance / GATEWAY.opening, depth = GATEWAY.depth * scale;
    let best: { a: WhiteboxPoint; ux: number; uz: number; t0: number; t1: number } | null = null;
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
      let t0 = -1, t1 = -1;
      for (let t = 0; t <= len; t += .25) {
        if (plan.rooms.some(r => whiteboxInsidePolygon([a[0] + ux * t, a[1] + uz * t], r.polygon))) continue;
        if (t0 < 0) t0 = t;
        t1 = t;
      }
      if (t0 >= 0 && (!best || t1 - t0 > best.t1 - best.t0)) best = { a, ux, uz, t0, t1 };
    }
    if (!best || best.t1 - best.t0 < depth + GATEWAY_MARGIN * 2) continue;
    const t = (best.t0 + best.t1) / 2, mx = best.a[0] + best.ux * t, mz = best.a[1] + best.uz * t;
    // A slanted passage swings the far tower corners sideways into a room: skip rather than intrude.
    const opening = GATEWAY.opening * scale, width = GATEWAY.width * scale;
    let intrudes = false;
    for (let u = -.5; u <= .5 + 1e-9 && !intrudes; u += 1 / 16) for (let v = -.5; v <= .5 + 1e-9; v += 1 / 8) {
      const across = u * width;
      if (Math.abs(across) < opening / 2) continue;
      if (insideFloor(plan, [mx - best.uz * across + best.ux * v * depth, mz + best.ux * across + best.uz * v * depth])) { intrudes = true; break; }
    }
    if (intrudes) continue;
    const c = world([mx, mz]);
    const gateway: RedesignArtPlacement = { kind: 'gateway', assetId: ids.gateway, x: c.x, y: 0, z: c.z, yaw: yawFacing(-best.ux, -best.uz),
      size: [GATEWAY.width * scale, GATEWAY.height * scale, depth] };
    out.push(gateway); gateways.push(gateway);
  }

  // Ramparts: inner face on the boundary, body extending into the outer mass, front facing the floor.
  // Each run is the kit's left end, a row of panels (some plain) and its right end, scaled together along
  // the run so the pieces abut exactly. A run stops at a gateway's towers and resumes past them (the towers
  // frame the passage; a wall laid through them hid all but their inner jambs), each stretch with its own ends.
  const kit = REDESIGN_WALL_KITS[kitKey];
  const insideGateway = (x: number, z: number) => gateways.some(g => {
    const dx = x - g.x, dz = z - g.z, c = Math.cos(g.yaw), s = Math.sin(g.yaw);
    return Math.abs(dx * c - dz * s) <= g.size[0] / 2 && Math.abs(dx * s + dz * c) <= g.size[2] / 2;
  });
  const layRun = (a0: WhiteboxPoint, ux: number, uz: number, n: WhiteboxPoint, len: number) => {
    if (!kit) return;
    const w = kit.widths, count = Math.max(0, Math.round((len / kit.scale - 2 * w.end) / w.panel));
    // Plain panels (never two in a row); the wider plain panel is dropped again where it would squeeze the run.
    const plain: boolean[] = [];
    for (let i = 0; i < count; i++) plain.push(!plain[i - 1] && hash01(a0[0] + ux * (i + 1) * 4.8, a0[1] + uz * (i + 1) * 4.8) < RAMPART_VARIANT_SHARE);
    const modelLength = () => 2 * w.end + plain.reduce((sum, v) => sum + (v ? w.plain : w.panel), 0);
    while (len / modelLength() < RAMPART_SCALE_MIN && plain.includes(true)) plain[plain.lastIndexOf(true)] = false;
    const scale = len / modelLength();
    // The model's own +X runs along the run (sign > 0) or against it: the left end then starts the run.
    const yaw = yawFacing(-n[0], -n[1]), sign = Math.sign(Math.cos(yaw) * ux - Math.sin(yaw) * uz) || 1;
    const pieces = [sign > 0 ? kit.endL : kit.endR, ...plain.map(v => v ? kit.plain : kit.panel), sign > 0 ? kit.endR : kit.endL];
    let t = 0;
    for (const assetId of pieces) {
      const width = (assetId === kit.plain ? w.plain : assetId === kit.panel ? w.panel : w.end) * scale, mid = t + width / 2;
      t += width;
      const back = RAMPART_DEPTH / 2, c = world([a0[0] + ux * mid + n[0] * back, a0[1] + uz * mid + n[1] * back]);
      out.push({ kind: 'rampart', assetId, x: c.x, y: 0, z: c.z, yaw, size: [width, height, RAMPART_DEPTH] });
    }
  };
  for (const run of kit ? boundaryRuns(plan, shape.exactRuns) : []) {
    const span = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]);
    const ux = (run.b[0] - run.a[0]) / span, uz = (run.b[1] - run.a[1]) / span;
    // Runs reach past a corner only where boundaryRuns wrapped it; an open end (a passage mouth) stops on the
    // edge, or its end piece would stick out into the opening. Stretches inside a gateway are left to it.
    let from = -1, gatedBefore = false;
    const steps = Math.ceil(span / .25);
    for (let k = 0; k <= steps; k++) {
      const at = Math.min(k * .25, span), back: WhiteboxPoint = [run.a[0] + ux * at + run.n[0] * RAMPART_DEPTH / 2, run.a[1] + uz * at + run.n[1] * RAMPART_DEPTH / 2];
      const body = world(back), gated = insideGateway(body.x, body.z);
      // A wall meeting a passage at a slant would push its body into that passage: it stops where its body
      // reaches floor (the passage's own walls close the corner).
      const free = !gated && !(shape.exactRuns && insideFloor(plan, back)), last = k === steps;
      if (free && from < 0) from = at > 0 && gatedBefore ? Math.max(0, at - GATEWAY_TUCK) : at;
      if (!free) gatedBefore = gated;
      if ((!free || last) && from >= 0) {
        // A stretch meeting a gateway tucks its end piece into the tower, so short stretches still close.
        const to = free ? at : gated ? Math.min(span, at - .25 + GATEWAY_TUCK) : at - .25;
        if (to - from >= 2) layRun([run.a[0] + ux * from, run.a[1] + uz * from], ux, uz, run.n, to - from);
        from = -1;
      }
    }
  }

  // Covers by height.
  const gatePosts: { x0: number; x1: number; z0: number; z1: number; face?: string }[] = [];
  const shrinePosts: typeof gatePosts = [];
  for (const cover of plan.covers) {
    const xs = cover.polygon.map(p => p[0]), zs = cover.polygon.map(p => p[1]);
    if (cover.art === 'gate' || cover.art === 'shrine') {
      (cover.art === 'gate' ? gatePosts : shrinePosts).push({ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), face: cover.face });
      continue;
    }
    const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...zs) - Math.min(...zs);
    const c = world([(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...zs) + Math.min(...zs)) / 2]);
    const along = w >= d, length = Math.max(w, d), thick = Math.min(w, d);
    if (cover.art) {
      // Set dressing fills its collision box; its front looks the authored way (plan +y is world +z).
      const yaw = { north: Math.PI, south: 0, east: Math.PI / 2, west: -Math.PI / 2 }[cover.face ?? 'south'];
      const sideways = cover.face === 'east' || cover.face === 'west';
      out.push({ kind: cover.art, assetId: ids[cover.art], x: c.x, y: 0, z: c.z, yaw, size: sideways ? [d, cover.height, w] : [w, cover.height, d] });
      continue;
    }
    if (cover.height >= 4) out.push({ kind: 'column', assetId: ids.column, x: c.x, y: 0, z: c.z, yaw: 0, size: [w, cover.height, d] });
    else out.push({ kind: cover.height <= 1.5 ? 'barricade' : 'coverwall', assetId: cover.height <= 1.5 ? ids.barricade : ids.coverwall,
      x: c.x, y: 0, z: c.z, yaw: along ? 0 : Math.PI / 2, size: [length, cover.height, thick] });
  }

  // Gate posts pair up into one gateway spanning both, scaled uniformly to that span (an entrance where two
  // rooms meet directly, so no passage gateway fits): its towers are the posts, its arch the opening.
  for (const [i, a] of gatePosts.entries()) for (const b of gatePosts.slice(i + 1)) {
    const x0 = Math.min(a.x0, b.x0), x1 = Math.max(a.x1, b.x1), z0 = Math.min(a.z0, b.z0), z1 = Math.max(a.z1, b.z1);
    const across = a.face === 'east' || a.face === 'west' ? z1 - z0 : x1 - x0, deep = across === x1 - x0 ? z1 - z0 : x1 - x0;
    if (across > shape.postMaxSpan || Math.abs(deep - (across / GATEWAY.width) * GATEWAY.depth) > shape.postDepthTolerance) continue;
    const scale = across / GATEWAY.width, c = world([(x0 + x1) / 2, (z0 + z1) / 2]);
    const yaw = ({ north: Math.PI, south: 0, east: Math.PI / 2, west: -Math.PI / 2 } as Record<string, number>)[a.face ?? 'south'] ?? 0;
    // Never deeper than the posts (the art has no collision of its own): a deeper kit is pressed slightly.
    out.push({ kind: 'gateway', assetId: ids.gateway, x: c.x, y: 0, z: c.z, yaw, size: [GATEWAY.width * scale, GATEWAY.height * scale, Math.min(GATEWAY.depth * scale, deep)] });
  }

  // Shrine pylons pair up into the portal shrine: its width spans both pylons, its front on their front edge and
  // its recess reaching back past them into the wall.
  for (const [i, a] of shrinePosts.entries()) for (const b of shrinePosts.slice(i + 1)) {
    const x0 = Math.min(a.x0, b.x0), x1 = Math.max(a.x1, b.x1), z0 = Math.min(a.z0, b.z0), z1 = Math.max(a.z1, b.z1);
    const face = a.face ?? 'west', alongZ = face === 'east' || face === 'west', across = alongZ ? z1 - z0 : x1 - x0;
    if (Math.abs(across - SHRINE.width) > .5) continue;
    const f = ({ north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] } as Record<string, number[]>)[face];
    // Front edge of the pylons, then half the shrine's depth back from it.
    const front = alongZ ? (f[0] < 0 ? x0 : x1) : (f[1] < 0 ? z0 : z1), mid = front - (alongZ ? f[0] : f[1]) * SHRINE.depth / 2;
    const c = world(alongZ ? [mid, (z0 + z1) / 2] : [(x0 + x1) / 2, mid]);
    const yaw = ({ north: Math.PI, south: 0, east: Math.PI / 2, west: -Math.PI / 2 } as Record<string, number>)[face] ?? 0;
    out.push({ kind: 'shrine', assetId: ids.shrine, x: c.x, y: 0, z: c.z, yaw, size: [SHRINE.width, SHRINE.height, SHRINE.depth] });
  }

  // Deck sides are a ring of podium blocks (the scene view lays one paved slab over the top, so interior
  // blocks would never be seen); stairs on every ramp, front (low end) facing away from the deck.
  for (const deck of plan.platforms ?? []) {
    const [x0, z0, x1, z1] = deck.rect, w = Math.abs(x1 - x0), d = Math.abs(z1 - z0);
    const nx = Math.max(1, Math.round(w / 4)), nz = Math.max(1, Math.round(d / 4));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue;
      const c = world([Math.min(x0, x1) + (i + .5) * w / nx, Math.min(z0, z1) + (j + .5) * d / nz]);
      out.push({ kind: 'platform', assetId: ids.platform, x: c.x, y: 0, z: c.z, yaw: 0, size: [w / nx, deck.height, d / nz] });
    }
  }
  for (const ramp of L.ramps) {
    const sx = ramp.sx1 - ramp.sx0, sz = ramp.sz1 - ramp.sz0;
    const dx = ramp.foot.x - ramp.head.x, dz = ramp.foot.z - ramp.head.z, alongX = Math.abs(dx) > Math.abs(dz);
    out.push({ kind: 'stairs', assetId: ids.stairs, x: (ramp.sx0 + ramp.sx1) / 2, y: 0, z: (ramp.sz0 + ramp.sz1) / 2,
      yaw: alongX ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : (dz > 0 ? 0 : Math.PI),
      size: alongX ? [sz, ramp.top, sx] : [sx, ramp.top, sz] });
  }

  // Corner towers on every chamfered (diagonal) room edge that is solid wall along its whole length: they
  // cap the joints where rampart runs turn and break the even skyline. Front face just behind the edge.
  for (const room of plan.rooms) room.polygon.forEach((a, i) => {
    const b = room.polygon[(i + 1) % room.polygon.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (Math.abs(b[0] - a[0]) < .5 || Math.abs(b[1] - a[1]) < .5 || len < TOWER.width) return;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    for (const s of [1, -1]) {
      const nx = uz * s, nz = -ux * s;
      const solid = [.15, .5, .85].every(k => {
        const px = a[0] + (b[0] - a[0]) * k, pz = a[1] + (b[1] - a[1]) * k;
        const out: WhiteboxPoint = [px + nx * .6, pz + nz * .6];
        return !insideFloor(plan, out) && !insideVoid(plan, out) && insideFloor(plan, [px - nx * .6, pz - nz * .6]);
      });
      if (!solid) continue;
      const back = TOWER.depth / 2 + .2;
      const c = world([(a[0] + b[0]) / 2 + nx * back, (a[1] + b[1]) / 2 + nz * back]);
      if (shape.towerSpacing > 0 && out.some(o => o.kind === 'tower' && Math.hypot(o.x - c.x, o.z - c.z) < shape.towerSpacing)) continue;
      out.push({ kind: 'tower', assetId: ids.tower, x: c.x, y: 0, z: c.z, yaw: yawFacing(-nx, -nz),
        size: [TOWER.width, Math.max(TOWER.height, height + 4), TOWER.depth] });
    }
  });

  // Landmark beyond the exit, on the far side of the exit room's wall, facing back down the level.
  const exit = world(plan.exit.at), entry = world(plan.entry.at);
  const dirX = exit.x - entry.x, dirZ = exit.z - entry.z, dist = Math.hypot(dirX, dirZ) || 1;
  const ux = dirX / dist, uz = dirZ / dist;
  // The kit's published statue proportions, uniform so the statue never stretches.
  const size = shape.landmark.map(v => v * LANDMARK_SCALE) as [number, number, number];
  // 26 m out, or further until its footprint leaves the floor (an exit inside a big arena, as in a boss ring).
  const plan0 = world([0, 0]), toPlan = (x: number, z: number): WhiteboxPoint => [x - plan0.x, z - plan0.z];
  const clear = (t: number) => {
    for (let u = -.5; u <= .5 + 1e-9; u += .25) for (let v = -.5; v <= .5 + 1e-9; v += .25) {
      const x = exit.x + ux * t - uz * u * size[0] + ux * v * size[2], z = exit.z + uz * t + ux * u * size[0] + uz * v * size[2];
      if (insideFloor(plan, toPlan(x, z)) || insideVoid(plan, toPlan(x, z))) return false;
    }
    return true;
  };
  let reach = 26;
  while (reach < 160 && !clear(reach)) reach += 4;
  out.push({ kind: 'landmark', assetId: ids.landmark, x: exit.x + ux * reach, y: 0, z: exit.z + uz * reach,
    yaw: yawFacing(-dirX, -dirZ), size });
  return out;
}
