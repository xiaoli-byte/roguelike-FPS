import type { StageNode } from '../core/types';
import type { LayoutBox, LevelLayout, P2 } from './LevelTypes';
import { WHITEBOX_PLANS } from './WhiteboxPlans';
import type { WhiteboxCheckpoint, WhiteboxPlan, WhiteboxPoint, WhiteboxRect } from './WhiteboxTypes';

/** Fixed 0.5 m cells: centre sampling shifts edges by up to ~0.36 m diagonally. */
export const WHITEBOX_GRID_SIZE = 0.5;
const OUTER_PAD = 2;
// A visible technical boundary tall enough for the existing double-jump + cover stack.
const WALL_HEIGHT = 8;
const COVER_HEIGHT = 2.6;

export function getWhiteboxPlan(stage: StageNode): WhiteboxPlan {
  const index = stage.type === 'boss' ? 5 : Math.min(5, Math.max(1, Math.floor(stage.index) + 1));
  const plan = WHITEBOX_PLANS.find(p => p.chapter === stage.theme && p.index === index);
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
function mergeCells(cells: Uint8Array, cols: number, rows: number, accepts: (value: number) => boolean, minX: number, minZ: number): WhiteboxRect[] {
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

/** Generate technical collision geometry directly from the approved 2D design. */
export function generateWhitebox(stage: StageNode): LevelLayout {
  const plan = getWhiteboxPlan(stage), [width, depth] = plan.bounds;
  const minX = -width / 2 - OUTER_PAD, minZ = -depth / 2 - OUTER_PAD;
  const cols = Math.ceil((width + OUTER_PAD * 2) / WHITEBOX_GRID_SIZE), rows = Math.ceil((depth + OUTER_PAD * 2) / WHITEBOX_GRID_SIZE);
  // 0 = traversable floor, 1 = outside mass, 2 = authored cover.
  const cells = new Uint8Array(cols * rows);
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) {
    const p: WhiteboxPoint = [(x + .5) * WHITEBOX_GRID_SIZE - OUTER_PAD, (z + .5) * WHITEBOX_GRID_SIZE - OUTER_PAD];
    const floor = plan.rooms.some(room => whiteboxInsidePolygon(p, room.polygon)) || plan.passages.some(path =>
      path.points.some((b, i) => i > 0 && segmentDistance(p, path.points[i - 1], b) <= path.width / 2));
    cells[z * cols + x] = !floor ? 1 : plan.covers.some(cover => whiteboxInsidePolygon(p, cover.polygon)) ? 2 : 0;
  }
  const boxes: LayoutBox[] = [];
  for (const [value, height, tag] of [[1, WALL_HEIGHT, 'whitebox-wall'], [2, COVER_HEIGHT, 'whitebox-cover']] as const) {
    for (const rect of mergeCells(cells, cols, rows, cell => cell === value, minX, minZ)) boxes.push({
      ...rect, minY: 0, maxY: height, look: value === 1 ? 'wall' : 'lowWall', tag, group: 0, noRaycast: false, v: 0,
    });
  }
  const floorRects = mergeCells(cells, cols, rows, value => value !== 1, minX, minZ);
  const playerSpawn = whiteboxPoint(plan, plan.entry.at), exit = whiteboxPoint(plan, plan.exit.at);
  const firstPath = plan.passages.find(path => path.id === plan.mainRoute[0]);
  const firstPoints = firstPath?.from === plan.entry.room ? firstPath.points : firstPath?.points.slice().reverse();
  const lookAt = firstPoints?.find(point => Math.hypot(point[0] - plan.entry.at[0], point[1] - plan.entry.at[1]) > 2);
  const playerYaw = heading(playerSpawn, lookAt ? whiteboxPoint(plan, lookAt) : exit);
  const overlaps = (p: P2, radius: number): boolean => boxes.some(b => p.x + radius > b.minX && p.x - radius < b.maxX && p.z + radius > b.minZ && p.z - radius < b.maxZ);
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
  return {
    type: stage.type, theme: stage.theme, half: Math.max(width, depth) / 2 + OUTER_PAD,
    minX, minZ, maxX: minX + cols * WHITEBOX_GRID_SIZE, maxZ: minZ + rows * WHITEBOX_GRID_SIZE,
    floorY: 0, wallThickness: WHITEBOX_GRID_SIZE, wallHeight: WALL_HEIGHT,
    boxes, decos: [], lights: [{ x: playerSpawn.x, y: 3, z: playerSpawn.z }, { x: center.x, y: 3, z: center.z }], runes: [], ramps: [],
    playerSpawn, playerYaw, spawnPoints, rewardPoint, portalPoints, shopPoint, bossPoint, center,
    checks: checkpoints.map(({ x, z }) => ({ x, z, g: 0 })),
    whitebox: { planId: plan.id, title: plan.title, plan, floorRects, checkpoints, gridSize: WHITEBOX_GRID_SIZE },
  };
}
