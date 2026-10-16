import type { StageNode } from '../core/types';
import type { LayoutBox, LevelLayout, P2, RampInfo } from './LevelTypes';
import { WHITEBOX_PLANS, WHITEBOX_REDESIGN_PLANS } from './WhiteboxPlans';
import type { WhiteboxCheckpoint, WhiteboxLava, WhiteboxPlan, WhiteboxPlatform, WhiteboxPoint, WhiteboxRect } from './WhiteboxTypes';

/** Fixed 0.5 m cells: centre sampling shifts edges by up to ~0.36 m diagonally. */
export const WHITEBOX_GRID_SIZE = 0.5;
const OUTER_PAD = 2;
// A visible technical boundary tall enough for the existing double-jump + cover stack.
const WALL_HEIGHT = 8;
const COVER_HEIGHT = 2.6;
/** Void fences (WhiteboxPlan.voids) top out above a double jump's reach (apex ≈ 2.7 m) so nobody stands on them. */
const VOID_FENCE_HEIGHT = 3.5;
/** Stair treads match the legacy courtyard platforms, so the player controller and nav ramps agree. */
const STEP_RISE = 0.4;
const STEP_DEPTH = 0.65;

/** With `redesign`, a V2 slice for this chapter slot replaces the shipped plan; other slots keep theirs. */
export function getWhiteboxPlan(stage: StageNode, redesign = false): WhiteboxPlan {
  const index = stage.type === 'boss' ? 5 : Math.min(5, Math.max(1, Math.floor(stage.index) + 1));
  const plan = (redesign ? WHITEBOX_REDESIGN_PLANS.find(p => p.chapter === stage.theme && p.index === index) : undefined)
    ?? WHITEBOX_PLANS.find(p => p.chapter === stage.theme && p.index === index);
  if (!plan) throw new Error(`Missing authored floor plan: ${stage.theme}/${index}`);
  return plan;
}

export function whiteboxPoint(plan: WhiteboxPlan, at: readonly number[]): P2 {
  return { x: at[0] - plan.bounds[0] / 2, z: at[1] - plan.bounds[1] / 2 };
}

function segmentDistance(p: readonly number[], a: WhiteboxPoint, b: WhiteboxPoint): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

export function whiteboxInsidePolygon(p: readonly number[], polygon: readonly WhiteboxPoint[]): boolean {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (segmentDistance(p, a, b) < 1e-7) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
}

/** Equal horizontal runs merge vertically; no giant enclosing box obscures holes. */
function mergeCells(cells: Uint8Array | Uint16Array, cols: number, rows: number, accepts: (value: number) => boolean, minX: number, minZ: number): WhiteboxRect[] {
  const output: WhiteboxRect[] = [];
  let previous = new Map<string, WhiteboxRect>();
  for (let z = 0; z < rows; z++) {
    const current = new Map<string, WhiteboxRect>();
    for (let x = 0; x < cols;) {
      if (!accepts(cells[z * cols + x])) { x++; continue; }
      const start = x;
      while (x < cols && accepts(cells[z * cols + x])) x++;
      const key = `${start}:${x}`, existing = previous.get(key);
      if (existing) {
        existing.maxZ = minZ + (z + 1) * WHITEBOX_GRID_SIZE;
        current.set(key, existing);
      } else {
        const rect = { minX: minX + start * WHITEBOX_GRID_SIZE, maxX: minX + x * WHITEBOX_GRID_SIZE, minZ: minZ + z * WHITEBOX_GRID_SIZE, maxZ: minZ + (z + 1) * WHITEBOX_GRID_SIZE };
        output.push(rect); current.set(key, rect);
      }
    }
    previous = current;
  }
  return output;
}

function heading(a: P2, b: P2): number { return Math.atan2(a.x - b.x, a.z - b.z); }

/** Platform deck plus stepped stairs and their nav ramps, in world coordinates (same model as LevelGen). */
function buildPlatform(plan: WhiteboxPlan, deck: WhiteboxPlatform, boxes: LayoutBox[], ramps: RampInfo[]): void {
  const [ax, az, bx, bz] = deck.rect, h = deck.height;
  const P = { x0: Math.min(ax, bx) - plan.bounds[0] / 2, x1: Math.max(ax, bx) - plan.bounds[0] / 2,
    z0: Math.min(az, bz) - plan.bounds[1] / 2, z1: Math.max(az, bz) - plan.bounds[1] / 2 };
  const cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2;
  boxes.push({ minX: P.x0, maxX: P.x1, minY: 0, maxY: h, minZ: P.z0, maxZ: P.z1, look: 'platform', tag: 'whitebox-platform', group: 0, noRaycast: false, v: 0 });
  const n = Math.max(2, Math.round(h / STEP_RISE)), rise = h / n, run = (n - 1) * STEP_DEPTH;
  for (const stair of deck.stairs) {
    const off = stair.offset ?? 0, sw = stair.width;
    let S: WhiteboxRect, foot: P2, head: P2;
    switch (stair.side) {
      case 'east': S = { minX: P.x1, maxX: P.x1 + run, minZ: cz + off - sw / 2, maxZ: cz + off + sw / 2 }; foot = { x: S.maxX + 1.4, z: cz + off }; head = { x: P.x1 - .9, z: cz + off }; break;
      case 'west': S = { minX: P.x0 - run, maxX: P.x0, minZ: cz + off - sw / 2, maxZ: cz + off + sw / 2 }; foot = { x: S.minX - 1.4, z: cz + off }; head = { x: P.x0 + .9, z: cz + off }; break;
      case 'south': S = { minX: cx + off - sw / 2, maxX: cx + off + sw / 2, minZ: P.z1, maxZ: P.z1 + run }; foot = { x: cx + off, z: S.maxZ + 1.4 }; head = { x: cx + off, z: P.z1 - .9 }; break;
      default: S = { minX: cx + off - sw / 2, maxX: cx + off + sw / 2, minZ: P.z0 - run, maxZ: P.z0 }; foot = { x: cx + off, z: S.minZ - 1.4 }; head = { x: cx + off, z: P.z0 + .9 }; break;
    }
    for (let k = 1; k < n; k++) {
      const top = k * rise, outer = (n - k) * STEP_DEPTH, inner = (n - 1 - k) * STEP_DEPTH;
      const step = stair.side === 'east' ? { minX: P.x1 + inner, maxX: P.x1 + outer, minZ: S.minZ, maxZ: S.maxZ }
        : stair.side === 'west' ? { minX: P.x0 - outer, maxX: P.x0 - inner, minZ: S.minZ, maxZ: S.maxZ }
          : stair.side === 'south' ? { minX: S.minX, maxX: S.maxX, minZ: P.z1 + inner, maxZ: P.z1 + outer }
            : { minX: S.minX, maxX: S.maxX, minZ: P.z0 - outer, maxZ: P.z0 - inner };
      boxes.push({ ...step, minY: 0, maxY: top, look: 'stair', tag: 'whitebox-stair', group: 0, noRaycast: false, v: 0 });
    }
    ramps.push({ x0: P.x0, z0: P.z0, x1: P.x1, z1: P.z1, top: h, sx0: S.minX, sz0: S.minZ, sx1: S.maxX, sz1: S.maxZ, foot, head, group: 0 });
  }
}

/** Generate technical collision geometry directly from the approved 2D design. */
export function generateWhitebox(stage: StageNode, opts: { redesign?: boolean } = {}): LevelLayout {
  const plan = getWhiteboxPlan(stage, opts.redesign), [width, depth] = plan.bounds;
  const minX = -width / 2 - OUTER_PAD, minZ = -depth / 2 - OUTER_PAD;
  const cols = Math.ceil((width + OUTER_PAD * 2) / WHITEBOX_GRID_SIZE), rows = Math.ceil((depth + OUTER_PAD * 2) / WHITEBOX_GRID_SIZE);
  // 0 = traversable floor, 1 = outside mass, 2 = authored cover, 3 = fenced inner void (see WhiteboxPlan.voids),
  // 4 = lava floor (lava voids and lava hazard strips; walkable for the player, no fence, blocked for enemy nav).
  const cells = new Uint8Array(cols * rows);
  // A cell belongs to a void when its centre lies within the void's radius plus half a cell (the ring's faceted inner
  // edge stays floor; anything else non-floor near the hole is fence, not wall).
  const voidAt = (p: WhiteboxPoint): 3 | 4 | 0 => {
    let hit: 3 | 4 | 0 = 0;
    for (const v of plan.voids ?? []) if (Math.hypot(p[0] - v.center[0], p[1] - v.center[1]) <= v.radius + WHITEBOX_GRID_SIZE / 2) {
      if (v.kind === 'lava') return 4;
      hit = 3;
    }
    return hit;
  };
  const lavaStrips = (plan.hazards ?? []).filter(h => h.kind === 'lava');
  const inLavaStrip = (p: WhiteboxPoint): boolean => lavaStrips.some(h =>
    h.points.some((b, i) => i > 0 && segmentDistance(p, h.points[i - 1], b) <= h.width / 2));
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) {
    const p: WhiteboxPoint = [(x + .5) * WHITEBOX_GRID_SIZE - OUTER_PAD, (z + .5) * WHITEBOX_GRID_SIZE - OUTER_PAD];
    const floor = plan.rooms.some(room => whiteboxInsidePolygon(p, room.polygon)) || plan.passages.some(path =>
      path.points.some((b, i) => i > 0 && segmentDistance(p, path.points[i - 1], b) <= path.width / 2));
    cells[z * cols + x] = !floor ? (voidAt(p) || 1)
      : plan.covers.some(cover => whiteboxInsidePolygon(p, cover.polygon)) ? 2 : inLavaStrip(p) ? 4 : 0;
  }
  const lava = buildLava(cells, cols, rows, minX, minZ);
  /** Whether a disc of radius r around p touches a lava cell (placement clearance; false without lava). */
  const touchesLava = (p: P2, r: number): boolean => !!lava && lavaWithin(lava, p.x, p.z, r);
  const boxes: LayoutBox[] = [];
  // Outer masses must out-reach a double jump from the tallest standable top (pillar or deck):
  // jump apex ≈ 2.7 m plus body clearance. Shipped plans (2.6 m cover) keep the reviewed 8 m.
  const tallest = Math.max(COVER_HEIGHT, ...plan.covers.map(c => c.height || COVER_HEIGHT), ...(plan.platforms ?? []).map(p => p.height));
  const wallHeight = Math.max(WALL_HEIGHT, Math.ceil(tallest + 3.4));
  for (const rect of mergeCells(cells, cols, rows, cell => cell === 1, minX, minZ)) boxes.push({
    ...rect, minY: 0, maxY: wallHeight, look: 'wall', tag: 'whitebox-wall', group: 0, noRaycast: false, v: 0,
  });
  // Voids: a fence the player cannot clear with a double jump, invisible and transparent to shots and sight.
  for (const rect of mergeCells(cells, cols, rows, cell => cell === 3, minX, minZ)) boxes.push({
    ...rect, minY: 0, maxY: VOID_FENCE_HEIGHT, look: 'lowWall', tag: 'whitebox-void', group: 0, noRaycast: true, v: 0,
  });
  // Each cover keeps its authored height (V2 mixes 1.2 m vault cover, 2.6 m cover and taller pillars).
  // All shipped LD-03 covers are 2.6 m, so their collision is unchanged.
  const coverCells = new Uint16Array(cols * rows);
  for (let i = 0; i < cells.length; i++) if (cells[i] === 2) {
    const p: WhiteboxPoint = [(i % cols + .5) * WHITEBOX_GRID_SIZE - OUTER_PAD, (Math.floor(i / cols) + .5) * WHITEBOX_GRID_SIZE - OUTER_PAD];
    coverCells[i] = plan.covers.findIndex(cover => whiteboxInsidePolygon(p, cover.polygon)) + 1;
  }
  const heights = [...new Set(plan.covers.map(cover => cover.height || COVER_HEIGHT))];
  for (const height of heights) {
    const accepts = (cell: number) => cell > 0 && (plan.covers[cell - 1].height || COVER_HEIGHT) === height;
    for (const rect of mergeCells(coverCells, cols, rows, accepts, minX, minZ)) boxes.push({
      ...rect, minY: 0, maxY: height, look: 'lowWall', tag: 'whitebox-cover', group: 0, noRaycast: false, v: 0,
    });
  }
  const ramps: RampInfo[] = [];
  for (const deck of plan.platforms ?? []) buildPlatform(plan, deck, boxes, ramps);
  const floorRects = mergeCells(cells, cols, rows, value => value !== 1, minX, minZ);
  const playerSpawn = whiteboxPoint(plan, plan.entry.at), exit = whiteboxPoint(plan, plan.exit.at);
  const firstPath = plan.passages.find(path => path.id === plan.mainRoute[0]);
  const firstPoints = firstPath?.from === plan.entry.room ? firstPath.points : firstPath?.points.slice().reverse();
  const lookAt = firstPoints?.find(point => Math.hypot(point[0] - plan.entry.at[0], point[1] - plan.entry.at[1]) > 2);
  const playerYaw = heading(playerSpawn, lookAt ? whiteboxPoint(plan, lookAt) : exit);
  // Lava counts as an obstacle for every placement (portal, reward, shop, enemy spawns); plans without lava are unchanged.
  const overlaps = (p: P2, radius: number): boolean => boxes.some(b => p.x + radius > b.minX && p.x - radius < b.maxX && p.z + radius > b.minZ && p.z - radius < b.maxZ)
    || touchesLava(p, radius);
  const exitRoom = plan.rooms.find(room => room.id === plan.exit.room)!;
  const insideExit = (p: P2): boolean => whiteboxInsidePolygon([p.x + width / 2, p.z + depth / 2], exitRoom.polygon);
  const portalPoints: P2[] = [];
  // Ordered rings keep the three exit choices separated, entirely within the exit room.
  const safeNearExit = (radius: number, occupied: readonly P2[], gap: number): P2 => {
    for (let ring = 0; ring <= 14; ring += .5) for (let j = 0; j < (ring === 0 ? 1 : 48); j++) {
      const angle = j * Math.PI * 2 / 48;
      const p = { x: exit.x + Math.cos(angle) * ring, z: exit.z + Math.sin(angle) * ring };
      if (insideExit(p) && !overlaps(p, radius) && occupied.every(q => Math.hypot(q.x - p.x, q.z - p.z) >= gap)) return p;
    }
    throw new Error(`${plan.id}: no safe exit interaction placement`);
  };
  const authoredRewards = plan.rewards.map(reward => whiteboxPoint(plan, reward.at));
  for (let i = 0; i < 3; i++) portalPoints.push(safeNearExit(1.5, [...portalPoints, ...authoredRewards], 4));
  // A portal shrine at the exit: the portal (the director opens portalPoints[1]) stands in its arch, 1.5 m in
  // front of the shrine's back wall, whichever way the shrine faces.
  const shrinePylons = plan.covers.filter(cover => cover.art === 'shrine');
  if (shrinePylons.length >= 2) {
    const box = (c: typeof shrinePylons[number]) => ({ x0: Math.min(...c.polygon.map(q => q[0])), x1: Math.max(...c.polygon.map(q => q[0])),
      z0: Math.min(...c.polygon.map(q => q[1])), z1: Math.max(...c.polygon.map(q => q[1])) });
    const [a, b] = shrinePylons.map(box), face = shrinePylons[0].face ?? 'west';
    const arch: [number, number] = face === 'west' ? [Math.max(a.x1, b.x1) - 1.5, (Math.min(a.z1, b.z1) + Math.max(a.z0, b.z0)) / 2]
      : face === 'east' ? [Math.min(a.x0, b.x0) + 1.5, (Math.min(a.z1, b.z1) + Math.max(a.z0, b.z0)) / 2]
      : face === 'south' ? [(Math.min(a.x1, b.x1) + Math.max(a.x0, b.x0)) / 2, Math.min(a.z0, b.z0) + 1.5]
      : [(Math.min(a.x1, b.x1) + Math.max(a.x0, b.x0)) / 2, Math.max(a.z1, b.z1) - 1.5];
    portalPoints[1] = whiteboxPoint(plan, arch);
  }
  const rewardPoint = safeNearExit(.9, [...portalPoints, ...authoredRewards], 3.2);
  let shopPoint = safeNearExit(.9, [...portalPoints, rewardPoint], 3.2);
  // The shop is a 6.4m arc, rather than a single interaction point. Reserve
  // its tables, customer positions and approach before dynamic stalls load.
  const shopFits = (p: P2): boolean => !overlaps(p, 8)
    && Math.hypot(p.x - playerSpawn.x, p.z - playerSpawn.z) >= 2
    && [...portalPoints, rewardPoint, ...authoredRewards].every(q => Math.hypot(q.x - p.x, q.z - p.z) >= 10);
  if (stage.type === 'boss' && plan.preparation) {
    shopPoint = whiteboxPoint(plan, plan.preparation.at);
    if (!shopFits(shopPoint)) throw new Error(`${plan.id}: pre-boss merchant lacks complete shop clearance`);
  } else if (stage.type === 'shop') {
    const candidates: P2[] = [];
    for (const room of plan.rooms) {
      candidates.push(whiteboxPoint(plan, room.labelAt));
      const xs = room.polygon.map(p => p[0]), zs = room.polygon.map(p => p[1]);
      for (let z = Math.min(...zs) + 8; z <= Math.max(...zs) - 8; z += 2)
        for (let x = Math.min(...xs) + 8; x <= Math.max(...xs) - 8; x += 2) candidates.push(whiteboxPoint(plan, [x, z]));
    }
    const safe = candidates.filter(shopFits).sort((a, b) => Math.hypot(a.x - playerSpawn.x, a.z - playerSpawn.z)
      - Math.hypot(b.x - playerSpawn.x, b.z - playerSpawn.z))[0];
    if (!safe) throw new Error(`${plan.id}: no room fits the complete merchant arc`);
    shopPoint = safe;
  }
  const center = whiteboxPoint(plan, plan.encounters.at(-1)?.at ?? plan.exit.at);
  const bossPoint = whiteboxPoint(plan, plan.encounters[0]?.at ?? plan.exit.at);
  const checkpoints: WhiteboxCheckpoint[] = [
    { id: 'entry', label: '入口', ...playerSpawn, yaw: playerYaw },
    { id: 'exit', label: '出口', ...exit, yaw: heading(exit, center) },
    ...plan.encounters.map(encounter => ({ id: `encounter-${encounter.id}`, label: `${encounter.id} · ${encounter.label}`, ...whiteboxPoint(plan, encounter.at), yaw: heading(whiteboxPoint(plan, encounter.at), whiteboxPoint(plan, encounter.facing)) })),
    ...plan.rewards.map((reward, i) => ({ id: `reward-${i + 1}`, label: reward.label, ...whiteboxPoint(plan, reward.at), yaw: heading(whiteboxPoint(plan, reward.at), center) })),
    ...(plan.preparation ? [{ id: 'preparation', label: plan.preparation.label, ...shopPoint,
      yaw: heading(shopPoint, whiteboxPoint(plan, plan.preparation.facing)) }] : []),
    ...plan.rooms.map(room => ({ id: `room-${room.id}`, label: room.label, ...whiteboxPoint(plan, room.labelAt), yaw: heading(whiteboxPoint(plan, room.labelAt), center) })),
  ];
  const spawnPoints: P2[] = [];
  const spawnCells = new Set<number>(), spawnCols = Math.ceil(width / 3);
  for (const room of plan.rooms) {
    if (room.id === plan.preparation?.room) continue;
    const xs = room.polygon.map(p => p[0]), zs = room.polygon.map(p => p[1]);
    const x0 = Math.max(2, Math.ceil((Math.min(...xs) - 2) / 3) * 3 + 2);
    const z0 = Math.max(2, Math.ceil((Math.min(...zs) - 2) / 3) * 3 + 2);
    for (let z = z0; z < Math.min(depth, Math.max(...zs)); z += 3) for (let x = x0; x < Math.min(width, Math.max(...xs)); x += 3) {
      const cell = (z - 2) / 3 * spawnCols + (x - 2) / 3;
      if (spawnCells.has(cell)) continue;
      if (!whiteboxInsidePolygon([x, z], room.polygon)) continue;
      const p = whiteboxPoint(plan, [x, z]);
      if (Math.hypot(p.x - playerSpawn.x, p.z - playerSpawn.z) < 10 || overlaps(p, 1.3)) continue;
      if ([...portalPoints, rewardPoint, shopPoint].some(q => Math.hypot(q.x - p.x, q.z - p.z) < 3)) continue;
      // Candidates share the same 3m lattice: only duplicate cells can violate
      // the old 2.9m separation. Avoid an O(n²) scan as maps gain more rooms.
      spawnCells.add(cell); spawnPoints.push(p);
    }
  }
  // A portal shrine's arch is closed by an invisible slab across its mouth, so the player stops in front of
  // the portal (still within its reach) instead of walking into the arch. Added after the portal, reward and
  // shop points are placed, so it never pushes the portal out of the arch; it does not stop shots.
  const pylons = plan.covers.filter(cover => cover.art === 'shrine').map(cover => {
    const xs = cover.polygon.map(q => q[0]), zs = cover.polygon.map(q => q[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), face: cover.face ?? 'west' };
  });
  for (let i = 0; i + 1 < pylons.length; i += 2) {
    const [a, b] = [pylons[i], pylons[i + 1]], alongZ = a.face === 'east' || a.face === 'west';
    // Between the pylons along the across axis, a 0.2 m slab on their front edge.
    const lo = alongZ ? Math.min(a.z1, b.z1) : Math.min(a.x1, b.x1), hi = alongZ ? Math.max(a.z0, b.z0) : Math.max(a.x0, b.x0);
    const front = { west: Math.min(a.x0, b.x0), east: Math.max(a.x1, b.x1), north: Math.min(a.z0, b.z0), south: Math.max(a.z1, b.z1) }[a.face] ?? a.x0;
    const inward = a.face === 'west' || a.face === 'north' ? .2 : -.2;
    const [p0, p1] = alongZ ? [whiteboxPoint(plan, [front, lo]), whiteboxPoint(plan, [front + inward, hi])] : [whiteboxPoint(plan, [lo, front]), whiteboxPoint(plan, [hi, front + inward])];
    boxes.push({ minX: Math.min(p0.x, p1.x), maxX: Math.max(p0.x, p1.x), minZ: Math.min(p0.z, p1.z), maxZ: Math.max(p0.z, p1.z), minY: 0, maxY: 6,
      look: 'lowWall', tag: 'whitebox-blocker', group: 0, noRaycast: true, v: 0 });
  }
  return {
    type: stage.type, theme: stage.theme, half: Math.max(width, depth) / 2 + OUTER_PAD,
    minX, minZ, maxX: minX + cols * WHITEBOX_GRID_SIZE, maxZ: minZ + rows * WHITEBOX_GRID_SIZE,
    floorY: 0, wallThickness: WHITEBOX_GRID_SIZE, wallHeight,
    boxes, decos: [], lights: [{ x: playerSpawn.x, y: 3, z: playerSpawn.z }, { x: center.x, y: 3, z: center.z }], runes: [], ramps,
    playerSpawn, playerYaw, spawnPoints, rewardPoint, portalPoints, shopPoint, bossPoint, center,
    checks: checkpoints.map(({ x, z }) => ({ x, z, g: 0 })),
    whitebox: { planId: plan.id, title: plan.title, plan, floorRects, checkpoints, gridSize: WHITEBOX_GRID_SIZE, ...(lava ? { lava } : {}) },
  };
}

/** Lava cells (value 4) as a runtime field; undefined when the plan has none. */
function buildLava(cells: Uint8Array, cols: number, rows: number, minX: number, minZ: number): WhiteboxLava | undefined {
  const mask = new Uint8Array(cols * rows);
  let any = false;
  for (let i = 0; i < cells.length; i++) if (cells[i] === 4) { mask[i] = 1; any = true; }
  if (!any) return undefined;
  return { minX, minZ, cols, rows, cell: WHITEBOX_GRID_SIZE, mask, rects: mergeCells(cells, cols, rows, cell => cell === 4, minX, minZ) };
}

/** Whether any lava cell lies within r metres of world point (x, z) (cell squares, not centres; Lava.ts nearLava). */
function lavaWithin(lava: WhiteboxLava, x: number, z: number, r: number): boolean {
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
