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
  'desert-1': { A: [['grunt', 2]], B: [['grunt', 2], ['archer', 1]] },
  'desert-2': { A: [['grunt', 3]], B: [['grunt', 2], ['archer', 2]], C: [['brute', 1], ['grunt', 2]] },
  'desert-3': { A: [['grunt', 2], ['archer', 1]], B1: [['mortar', 1], ['grunt', 2]], B2: [['brute', 1], ['grunt', 2]], C: [['grunt', 2], ['archer', 1], ['shaman', 1]] },
  'desert-4': { A: [['grunt', 2], ['archer', 2]], B: [['mortar', 1], ['grunt', 2]], P: [['brute', 1]], C: [['shaman', 1], ['archer', 2], ['grunt', 2]] },
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
const ROLES: EnemyPlacement[] = ['assault', 'flank', 'ranged', 'precision', 'artillery', 'support'];
const roleFor = (id: string): EnemyPlacement => id === 'mortar' ? 'artillery' : id === 'marksman' ? 'precision'
  : id === 'shaman' ? 'support' : id === 'bomber' ? 'flank' : id === 'archer' || id === 'wisp' ? 'ranged' : 'assault';

export interface WhiteboxFight {
  id: string; label: string; room: string; final: boolean; position: P2; facing: P2;
  anchors: AdventureSpawnAnchor[]; points: P2[]; radius: number; plans: WavePlan[];
  contains: (point: P2, halfWidth?: number) => boolean;
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
  const squads = WHITEBOX_SQUADS[plan.id];
  if (!squads) throw new Error(`Missing whitebox roster: ${plan.id}`);
  const sources = plan.encounters.flatMap(encounter => plan.id === 'desert-2' && encounter.id === 'B'
    ? [encounter, { ...encounter, room: 'north', at: [65, 24] as [number, number], facing: [48, 30] as [number, number] }]
    : [encounter]);
  return sources.map(encounter => {
    const room = plan.rooms.find(r => r.id === encounter.room);
    if (!room || !squads[encounter.id]) throw new Error(`Missing whitebox encounter: ${plan.id}/${encounter.id}`);
    const position = whiteboxPoint(plan, encounter.at), facing = whiteboxPoint(plan, encounter.facing);
    const contains = (point: P2, halfWidth = 0) => whiteboxRoomContains(plan, room.id, point, halfWidth);
    const polygon = room.polygon.map(p => whiteboxPoint(plan, p));
    const x0 = Math.min(...polygon.map(p => p.x)), x1 = Math.max(...polygon.map(p => p.x));
    const z0 = Math.min(...polygon.map(p => p.z)), z1 = Math.max(...polygon.map(p => p.z));
    const points: P2[] = [];
    const open = (p: P2, margin: number) => contains(p, margin) && !L.boxes.some(b =>
      b.minY < L.floorY + 3.5 && b.maxY > L.floorY + .05
      && p.x + margin > b.minX && p.x - margin < b.maxX && p.z + margin > b.minZ && p.z - margin < b.maxZ);
    for (let z = z0 + 1; z <= z1 - 1; z += 2) for (let x = x0 + 1; x <= x1 - 1; x += 2) {
      if (open({ x, z }, .8)) points.push({ x, z });
    }
    if (open(position, .8)) points.unshift(position);
    const dx = facing.x - position.x, dz = facing.z - position.z, length = Math.hypot(dx, dz) || 1;
    const anchors: AdventureSpawnAnchor[] = [];
    ROLES.forEach((role, lane) => {
      const forward = role === 'assault' ? 5 : role === 'flank' ? 3 : role === 'support' ? -3 : 0;
      const side = role === 'flank' ? 5 : role === 'ranged' ? -3 : role === 'precision' ? 3 : 0;
      const target = { x: position.x + dx / length * forward - dz / length * side,
        z: position.z + dz / length * forward + dx / length * side };
      const best = [...points].sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z));
      best.slice(0, 5).forEach(p => anchors.push({ ...p, role, lane: lane % 3 }));
    });
    const entries: WaveEntry[] = squads[encounter.id].map(([enemyId, count, elite]) => ({
      enemyId, count, elite, placement: roleFor(enemyId), arrivalDelay: enemyId === 'shaman' ? .6 : enemyId === 'mortar' || enemyId === 'marksman' ? 1.2 : 0,
    }));
    if (stage.type === 'elite' && !entries.some(e => e.elite)) {
      const candidate = entries.find(e => e.enemyId === 'brute') ?? entries[0];
      if (candidate && candidate.count > 1) { candidate.count--; entries.push({ ...candidate, count: 1, elite: true }); }
      else if (candidate) candidate.elite = true;
    }
    return { id: encounter.id, label: encounter.label, room: room.id, final: encounter.id === plan.encounters[plan.encounters.length - 1].id,
      position, facing, anchors, points, contains, radius: Math.hypot(x1 - x0, z1 - z0) + 1,
      requires: (plan.id === 'desert-1' && encounter.id === 'B') || (plan.id === 'frost-2' && encounter.id === 'B') ? ['A'] : [],
      plans: [{ entries, triggerRemaining: 0, label: encounter.label, hint: encounter.roster, delay: .8 }],
    };
  });
}

export function buildWhiteboxAdventure(L: LevelLayout, fights: WhiteboxFight[]): AdventureLayout {
  const plan = L.whitebox!.plan;
  const final = fights.find(f => f.final);
  const objective = final?.position ?? whiteboxPoint(plan, plan.exit.at);
  return { designId: plan.id, title: plan.title, routeHint: plan.routeChoice,
    objective, rocks: [], paths: plan.passages.map(p => ({ width: p.width, points: p.points.map(point => whiteboxPoint(plan, point)) })),
    zones: plan.rooms.map(r => ({ id: r.id, label: r.label, ...whiteboxPoint(plan, r.labelAt), radius: 8 })),
    sites: plan.rewards.map((r, i) => ({ id: `whitebox-cache-${i}`, label: r.label, ...whiteboxPoint(plan, r.at), reward: i % 2 ? 'scroll' : 'coins' })),
    encounters: fights.filter((f, i) => fights.findIndex(other => other.id === f.id) === i).map(f => ({ id: f.id, label: f.label,
      kind: plan.rewards.some(r => r.room === f.room) && !f.final ? 'cache' : 'approach',
      ...f.position, triggerRadius: f.radius, arenaRadius: f.radius, anchors: f.anchors,
      siteId: plan.rewards.findIndex(r => r.room === f.room) >= 0 ? `whitebox-cache-${plan.rewards.findIndex(r => r.room === f.room)}` : undefined,
    })), spawnAnchors: final?.anchors ?? [],
  };
}

/** The cloister enters the flag court from the west; it swaps the same two slots. */
export function whiteboxPlansForApproach(fight: WhiteboxFight, L: LevelLayout, player: P2): WavePlan[] {
  if (L.whitebox?.planId !== 'desert-4' || fight.id !== 'B'
    || player.x + L.whitebox.plan.bounds[0] / 2 >= 76 || player.z + L.whitebox.plan.bounds[1] / 2 >= 52) return fight.plans;
  return fight.plans.map(wave => ({ ...wave, hint: '僧廊侧门 · 炮手与两名爆骸', entries: wave.entries.map(entry =>
    entry.enemyId === 'grunt' ? { ...entry, enemyId: 'bomber', placement: 'flank' } : { ...entry }) }));
}

export function whiteboxSpawnRegion(fight: WhiteboxFight, floorY: number): SpawnRegion {
  return { center: new THREE.Vector3(fight.position.x, floorY, fight.position.z), minRadius: 0,
    maxRadius: fight.radius, minPlayerDistance: 10, contains: (point, halfWidth) => fight.contains(point, halfWidth) };
}
