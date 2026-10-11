/** Combat stations compiled from the authored floor plans, independently of art. */
import * as THREE from 'three';
import type { EnemyPlacement, StageNode, WaveEntry, WavePlan } from '../core/types';
import type { AdventureLayout, AdventureSpawnAnchor, LevelLayout, P2 } from './LevelTypes';
import type { WhiteboxPlan } from './WhiteboxTypes';
import { whiteboxInsidePolygon, whiteboxPoint } from './WhiteboxGen';
import type { SpawnRegion } from './WaveRunner';

type Squad = readonly [id: string, count: number, elite?: boolean][];
/** Keep counts inspectable and stable; display prose is never parsed as spawn code. */
export const WHITEBOX_SQUADS: Readonly<Record<string, Readonly<Record<string, Squad>>>> = {
  // 第一章新阵容：跳鼠刀兵（jerboa_blade）成群加入（刀客编排不动）
  'desert-1': { A: [['grunt', 2]], B: [['grunt', 2], ['archer', 1], ['jerboa_blade', 2]] },
  'desert-2': { A: [['grunt', 3]], B: [['grunt', 2], ['archer', 2]], C: [['brute', 1], ['grunt', 2], ['jerboa_blade', 3]] },
  'desert-3': { A: [['grunt', 2], ['archer', 1], ['jerboa_blade', 3]], B1: [['mortar', 1], ['grunt', 2]], B2: [['brute', 1], ['grunt', 2]], C: [['grunt', 2], ['archer', 1], ['shaman', 1]] },
  'desert-4': { A: [['grunt', 2], ['archer', 2]], B: [['mortar', 1], ['grunt', 2], ['jerboa_blade', 3]], P: [['brute', 1]], C: [['shaman', 1], ['archer', 2], ['grunt', 2]] },
  'desert-5': { BOSS: [['boss_colossus', 1]] },
  'frost-1': { A: [['grunt', 2], ['wisp', 1]], B: [['shaman', 1], ['grunt', 2]] },
  'frost-2': { A: [['grunt', 2], ['archer', 1]], B: [['mortar', 1], ['grunt', 1]], C: [['brute', 1], ['wisp', 1]] },
  'frost-3': { A: [['wisp', 2], ['grunt', 2]], B: [['mortar', 1], ['brute', 1]], C: [['shaman', 1], ['marksman', 1], ['grunt', 2]] },
  'frost-4': { A: [['marksman', 1], ['brute', 1]], B: [['wisp', 2], ['mortar', 1]], C: [['shaman', 1], ['brute', 1], ['grunt', 2]] },
  'frost-5': { BOSS: [['boss_matriarch', 1]] },
  'inferno-1': { A: [['grunt', 2], ['bomber', 1]], B: [['mortar', 1], ['shaman', 1], ['grunt', 2]], C: [['archer', 1], ['brute', 1], ['grunt', 2]] },
  'inferno-2': { A: [['brute', 1], ['grunt', 2]], B: [['mortar', 1], ['grunt', 1]], C: [['grunt', 2], ['bomber', 1]], D: [['shaman', 1], ['brute', 1], ['archer', 1], ['grunt', 2]] },
  'inferno-3': { A: [['archer', 1], ['grunt', 2]], B: [['mortar', 1], ['shaman', 1], ['grunt', 2]], C: [['brute', 1, true], ['archer', 1], ['grunt', 2]] },
  'inferno-4': { A: [['brute', 1, true], ['grunt', 2], ['bomber', 1]], B: [['shaman', 1], ['brute', 1, true], ['archer', 1], ['grunt', 2]] },
  'inferno-5': { A: [['boss_warlord', 1]] },
};
/** Free space around an enemy station (metres): a 0.9 m body clears stair steps, covers and deck rims. */
const STATION_CLEARANCE = .95;
/** Metres the player must be inside a (large enough) room before its fight starts. */
const ENTRY_DEPTH = 6;
/** Seconds before a melee pack's held-back member arrives on the flank. */
const FLANK_DELAY = 2.5;
const ROLES: EnemyPlacement[] = ['assault', 'flank', 'ranged', 'precision', 'artillery', 'support'];
// 赤沙新阵容：蝎尾弩卫远程、蜃楼蟾曲射炮击、火浣鼠与跳鼠刀兵侧翼、邪飞天辅助，镇墓兽按默认正面推进。
// 昆仑雪墟新阵容：冰鲸炮击、夫诸精确远程、三青鸟远程、狐巫与冰灯水母辅助、冻鲛人与冰河豚侧翼，
// 雪狌狌、冰棘豪彘、冰甲旋龟、玄冰巨蟹按默认正面推进。
const ARTILLERY = new Set(['mortar', 'mirage_toad', 'ice_whale']);
const PRECISION = new Set(['marksman', 'fuzhu']);
const SUPPORT = new Set(['shaman', 'apsara', 'fox_witch', 'lantern_jelly']);
const FLANK = new Set(['bomber', 'jerboa_blade', 'fire_rat', 'jiaoren', 'ice_puffer']);
const RANGED = new Set(['archer', 'wisp', 'scorpion_archer', 'qingniao']);
const roleFor = (id: string): EnemyPlacement => ARTILLERY.has(id) ? 'artillery' : PRECISION.has(id) ? 'precision'
  : SUPPORT.has(id) ? 'support' : FLANK.has(id) ? 'flank' : RANGED.has(id) ? 'ranged' : 'assault';
/**
 * These burrow, roll, charge, crawl or gather in packs on the ground and never take a deck-top station (the snow
 * monkey climbs onto decks by itself; the fuzhu needs room around it to leap away).
 */
const GROUND_ONLY = new Set(['jerboa_blade', 'scorpion_archer', 'mirage_toad', 'fire_rat', 'tomb_beast',
  'jiaoren', 'xingxing', 'haozhi', 'fuzhu', 'ice_whale', 'xuangui', 'frost_crab', 'fox_witch']);
/** Chargers need a lane: an assault slot filled only by them arrives from the far side of the room, not at the door. */
const CHARGERS = new Set(['tomb_beast', 'xuangui', 'haozhi']);
/** Heavy enemies an elite stage promotes first. */
const ELITE_FIRST = ['brute', 'tomb_beast', 'xuangui', 'frost_crab'];
/** Seconds supports and back-line shooters wait so the front line is already in the fight when they appear. */
const LATE_SHOOTERS = new Set(['mortar', 'marksman', 'ice_whale', 'fuzhu']);
const arrivalDelayFor = (id: string): number => SUPPORT.has(id) ? .6 : LATE_SHOOTERS.has(id) ? 1.2 : 0;

export interface WhiteboxFight {
  id: string; label: string; room: string; final: boolean; optional: boolean; position: P2; facing: P2;
  anchors: AdventureSpawnAnchor[]; points: P2[]; radius: number; plans: WavePlan[];
  contains: (point: P2, halfWidth?: number) => boolean;
  /**
   * How far inside the room (metres, on every side) the player must be before the fight starts, so it opens
   * in the room among its cover instead of on the threshold where every melee enemy funnels into the door.
   */
  entryDepth: number;
  requires: string[];
}

export function whiteboxRoomContains(plan: WhiteboxPlan, roomId: string, point: P2, halfWidth = 0): boolean {
  const room = plan.rooms.find(r => r.id === roomId);
  if (!room) return false;
  const x = point.x + plan.bounds[0] / 2, y = point.z + plan.bounds[1] / 2;
  // Sample the whole horizontal body. CollisionWorld then rejects cover/wall overlap.
  for (const dx of [-halfWidth, 0, halfWidth]) for (const dy of [-halfWidth, 0, halfWidth]) {
    if (!whiteboxInsidePolygon([x + dx, y + dy], room.polygon)) return false;
  }
  return true;
}

export function buildWhiteboxFights(L: LevelLayout, stage: StageNode): WhiteboxFight[] {
  const plan = L.whitebox?.plan;
  if (!plan || stage.type === 'shop' || stage.type === 'treasure') return [];
  const squads = WHITEBOX_SQUADS[plan.id] ?? {};
  if (!WHITEBOX_SQUADS[plan.id] && plan.encounters.some(e => !e.squad)) throw new Error(`Missing whitebox roster: ${plan.id}`);
  const mainRooms = new Set(plan.mainRoute.flatMap(id => {
    const passage = plan.passages.find(p => p.id === id)!;
    return [passage.from, passage.to];
  }));
  const sources = plan.encounters.flatMap(encounter => [encounter,
    ...(encounter.approaches ?? []).map(approach => ({ ...encounter, ...approach }))]);
  return sources.map(encounter => {
    const room = plan.rooms.find(r => r.id === encounter.room);
    const squad = encounter.squad ?? squads[encounter.id];
    if (!room || !squad) throw new Error(`Missing whitebox encounter: ${plan.id}/${encounter.id}`);
    const position = whiteboxPoint(plan, encounter.at), facing = whiteboxPoint(plan, encounter.facing);
    const contains = (point: P2, halfWidth = 0) => whiteboxRoomContains(plan, room.id, point, halfWidth);
    const polygon = room.polygon.map(p => whiteboxPoint(plan, p));
    const x0 = Math.min(...polygon.map(p => p.x)), x1 = Math.max(...polygon.map(p => p.x));
    const z0 = Math.min(...polygon.map(p => p.z)), z1 = Math.max(...polygon.map(p => p.z));
    const points: P2[] = [];
    const openAt = (p: P2, y: number, margin: number) => !L.boxes.some(b =>
      b.minY < y + 3.5 && b.maxY > y + .05
      && p.x + margin > b.minX && p.x - margin < b.maxX && p.z + margin > b.minZ && p.z - margin < b.maxZ);
    const open = (p: P2, margin: number) => contains(p, margin) && openAt(p, L.floorY, margin);
    for (let z = z0 + 1; z <= z1 - 1; z += 2) for (let x = x0 + 1; x <= x1 - 1; x += 2) {
      if (open({ x, z }, STATION_CLEARANCE)) points.push({ x, z });
    }
    if (open(position, STATION_CLEARANCE)) points.unshift(position);
    // Stair-served decks inside this room: their tops are stations for the shooting roles, so the
    // authored height takes part in the fight instead of every squad spawning on the floor.
    const deckPoints: (P2 & { y: number })[] = [];
    const seenDecks = new Set<string>();
    for (const r of L.ramps) {
      const key = `${r.x0},${r.z0},${r.x1},${r.z1}`;
      if (seenDecks.has(key) || !contains({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 })) continue;
      seenDecks.add(key);
      const y = L.floorY + r.top;
      for (let z = r.z0 + 1; z <= r.z1 - 1; z += 2) for (let x = r.x0 + 1; x <= r.x1 - 1; x += 2) {
        if (openAt({ x, z }, y, STATION_CLEARANCE)) deckPoints.push({ x, z, y });
      }
    }
    const dx = facing.x - position.x, dz = facing.z - position.z, length = Math.hypot(dx, dz) || 1;
    // Station offsets grow with the room (fixed metres clumped a whole squad in the middle of a 50 m hall).
    const spread = Math.max(1, Math.min(2.4, Math.min(x1 - x0, z1 - z0) / 18));
    const anchors: AdventureSpawnAnchor[] = [];
    // A role is raised only when it is filled, and every enemy filling it can stand on a deck.
    const groundRoles = new Set(squad.filter(([id]) => GROUND_ONLY.has(id)).map(([id]) => roleFor(id)));
    const deckRoles = new Set(squad.filter(([id]) => !GROUND_ONLY.has(id)).map(([id]) => roleFor(id)));
    const assault = squad.filter(([id]) => roleFor(id) === 'assault');
    const chargersOnly = assault.length > 0 && assault.every(([id]) => CHARGERS.has(id));
    ROLES.forEach((role, lane) => {
      const forward = (role === 'assault' ? (chargersOnly ? -4 : 5) : role === 'flank' ? 3 : role === 'support' ? -3 : 0) * spread;
      const side = (role === 'flank' ? 5 : role === 'ranged' ? -3 : role === 'precision' ? 3 : 0) * spread;
      const target = { x: position.x + dx / length * forward - dz / length * side,
        z: position.z + dz / length * forward + dx / length * side };
      const raised = (role === 'ranged' || role === 'precision' || role === 'artillery') && deckPoints.length > 0 && deckRoles.has(role) && !groundRoles.has(role);
      const pool: (P2 & { y?: number })[] = raised ? deckPoints : points;
      const best = [...pool].sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z));
      best.slice(0, 5).forEach(p => anchors.push({ ...p, role, lane: lane % 3 }));
    });
    const entries: WaveEntry[] = squad.flatMap(([enemyId, count, elite]): WaveEntry[] => {
      const entry: WaveEntry = { enemyId, count, elite, placement: roleFor(enemyId),
        arrivalDelay: arrivalDelayFor(enemyId) };
      // A melee pack of three or more holds one back to come in late from the side: the first rush is
      // smaller and the fight turns instead of ending in one clump at the player.
      if (entry.placement !== 'assault' || elite || count < 3) return [entry];
      return [{ ...entry, count: count - 1 }, { ...entry, count: 1, placement: 'flank', arrivalDelay: FLANK_DELAY }];
    });
    if (stage.type === 'elite' && !entries.some(e => e.elite)) {
      const candidate = entries.find(e => ELITE_FIRST.includes(e.enemyId)) ?? entries[0];
      if (candidate && candidate.count > 1) { candidate.count--; entries.push({ ...candidate, count: 1, elite: true }); }
      else if (candidate) candidate.elite = true;
    }
    // Shared approaches keep the original encounter's role, even from a side room.
    const original = plan.encounters.find(e => e.id === encounter.id)!;
    return { id: encounter.id, label: encounter.label, room: room.id, final: encounter.id === plan.encounters[plan.encounters.length - 1].id,
      optional: !mainRooms.has(original.room) && encounter.id !== plan.encounters.at(-1)?.id,
      position, facing, anchors, points, contains, radius: Math.hypot(x1 - x0, z1 - z0) + 1,
      entryDepth: Math.max(0, Math.min(ENTRY_DEPTH, Math.min(x1 - x0, z1 - z0) / 2 - 2)),
      requires: encounter.requires ?? ((plan.id === 'desert-1' && encounter.id === 'B') || (plan.id === 'frost-2' && encounter.id === 'B') ? ['A'] : []),
      plans: [{ entries, triggerRemaining: 0, label: encounter.label, hint: encounter.roster, delay: .8 }],
    };
  });
}

export function buildWhiteboxAdventure(L: LevelLayout, fights: WhiteboxFight[]): AdventureLayout {
  const plan = L.whitebox!.plan;
  const final = fights.find(f => f.final);
  const objective = final?.position ?? whiteboxPoint(plan, plan.exit.at);
  return { designId: plan.id, title: plan.title, routeHint: '沿主路推进；留意隐秘入口，可自行决定是否调查。',
    objective, rocks: [], paths: plan.passages.map(p => ({ width: p.width, points: p.points.map(point => whiteboxPoint(plan, point)) })),
    zones: plan.rooms.map(r => ({ id: r.id, label: r.label, ...whiteboxPoint(plan, r.labelAt), radius: 8 })),
    sites: plan.rewards.map((r, i) => ({ id: `whitebox-cache-${i}`, label: r.label, ...whiteboxPoint(plan, r.at), reward: r.reward ?? (i % 2 ? 'scroll' : 'coins') })),
    encounters: fights.filter((f, i) => fights.findIndex(other => other.id === f.id) === i).map(f => ({ id: f.id, label: f.label,
      kind: plan.rewards.some(r => r.room === f.room) && !f.final ? 'cache' : 'approach',
      ...f.position, triggerRadius: f.radius, arenaRadius: f.radius, anchors: f.anchors,
      siteId: plan.rewards.findIndex(r => r.room === f.room) >= 0 ? `whitebox-cache-${plan.rewards.findIndex(r => r.room === f.room)}` : undefined,
    })), spawnAnchors: final?.anchors ?? [],
  };
}

/** The cloister enters the flag court from the west; it swaps the same two slots. */
export function whiteboxPlansForApproach(fight: WhiteboxFight, L: LevelLayout, player: P2): WavePlan[] {
  const plan = L.whitebox?.plan;
  if (plan?.id !== 'desert-4' || fight.id !== 'B') return fight.plans;
  const connection = plan.passages.find(path => [path.from, path.to].includes('cloister') && [path.from, path.to].includes(fight.room));
  if (!connection) return fight.plans;
  const points = connection.from === 'cloister' ? connection.points : [...connection.points].reverse();
  let threshold: P2 | null = null;
  for (let i = 1; i < points.length && !threshold; i++) {
    const a = points[i - 1], b = points[i], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2));
    for (let j = 0; j <= steps; j++) {
      const p = whiteboxPoint(plan, [a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps]);
      if (fight.contains(p)) { threshold = p; break; }
    }
  }
  if (!threshold || Math.hypot(player.x - threshold.x, player.z - threshold.z) > 8) return fight.plans;
  return fight.plans.map(wave => ({ ...wave, hint: '僧廊侧门 · 炮手与两名爆骸', entries: wave.entries.map(entry =>
    entry.enemyId === 'grunt' ? { ...entry, enemyId: 'bomber', placement: 'flank' } : { ...entry }) }));
}

export function whiteboxSpawnRegion(fight: WhiteboxFight, floorY: number): SpawnRegion {
  return { center: new THREE.Vector3(fight.position.x, floorY, fight.position.z), minRadius: 0,
    maxRadius: fight.radius, minPlayerDistance: 10, contains: (point, halfWidth) => fight.contains(point, halfWidth) };
}
