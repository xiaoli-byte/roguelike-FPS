/** Seeded regional layout. All visible rock/tree art comes from published Hunyuan assets. */
import type { Rng } from '../core/Rng';
import type { StageNode } from '../core/types';
import type { AdventureEncounter, AdventureRock, AdventureSpawnAnchor, DecoFootprint, DecoKind, LevelLayout, P2, SceneArchitecturePlacement } from './LevelTypes';
import { NAV_FOOT, labelComponents, rasterizeBlocked } from './NavGrid';
import { getStageDesign } from './StageDesign';

const HALF = 42;
const TAU = Math.PI * 2;
const snap = (n: number): number => Math.floor(n) + .5;
const distance = (a: P2, b: P2): number => Math.hypot(a.x - b.x, a.z - b.z);

function segmentDistance(p: P2, a: P2, b: P2): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / Math.max(1e-8, dx * dx + dz * dz)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}

function pointRockDistance(p: P2, rock: AdventureRock): number {
  return Math.hypot(Math.max(Math.abs(p.x - rock.x) - rock.width / 2, 0), Math.max(Math.abs(p.z - rock.z) - rock.depth / 2, 0));
}

function rockGap(a: AdventureRock, b: AdventureRock): number {
  return Math.hypot(Math.max(Math.abs(a.x - b.x) - (a.width + b.width) / 2, 0), Math.max(Math.abs(a.z - b.z) - (a.depth + b.depth) / 2, 0));
}

/** Exact segment/AABB test. Rounded corridor corners retain their actual width. */
function intersectsRock(a: P2, b: P2, rock: AdventureRock): boolean {
  let lo = 0, hi = 1;
  for (const [p, d, mn, mx] of [
    [a.x, b.x - a.x, rock.x - rock.width / 2, rock.x + rock.width / 2],
    [a.z, b.z - a.z, rock.z - rock.depth / 2, rock.z + rock.depth / 2],
  ]) {
    if (Math.abs(d) < 1e-8) { if (p < mn || p > mx) return false; continue; }
    const x = (mn - p) / d, y = (mx - p) / d;
    lo = Math.max(lo, Math.min(x, y)); hi = Math.min(hi, Math.max(x, y));
    if (lo > hi) return false;
  }
  return true;
}

function crossesRock(a: P2, b: P2, rock: AdventureRock, pad: number): boolean {
  if (intersectsRock(a, b, rock) || pointRockDistance(a, rock) < pad || pointRockDistance(b, rock) < pad) return true;
  for (const x of [rock.x - rock.width / 2, rock.x + rock.width / 2]) for (const z of [rock.z - rock.depth / 2, rock.z + rock.depth / 2]) {
    if (segmentDistance({ x, z }, a, b) < pad) return true;
  }
  return false;
}

export function generateAdventure(rng: Rng, stage: StageNode): LevelLayout {
  const design = getStageDesign(stage);
  const objective = { ...design.objective }, entrance = { ...design.entrance };
  const sites = [
    { id: 'west-cache', label: stage.theme === 'frost' ? '林间补给' : stage.theme === 'inferno' ? '冷却洞窟' : '风蚀营地', ...design.sites[0], reward: 'coins' as const },
    { id: 'east-cache', label: stage.theme === 'frost' ? '雪径行囊' : stage.theme === 'inferno' ? '熔岩边哨' : '旅人驿站', ...design.sites[1], reward: 'weapon' as const },
    { id: 'north-cache', label: stage.theme === 'frost' ? '古寺秘藏' : stage.theme === 'inferno' ? '黑岩遗藏' : '失落石窟', ...design.sites[2], reward: 'scroll' as const },
  ];
  const paths = design.paths.map(path => ({ ...path, points: path.points.map(p => ({ ...p })) }));
  const L: LevelLayout = {
    type: stage.type, theme: stage.theme, half: HALF,
    minX: -HALF, minZ: -HALF, maxX: HALF, maxZ: HALF, floorY: 0, wallThickness: 2, wallHeight: 20,
    boxes: [], decos: [], lights: [], runes: [], ramps: [], checks: [],
    playerSpawn: entrance, playerYaw: Math.atan2(-(objective.x - entrance.x), -(objective.z - entrance.z)),
    spawnPoints: [], rewardPoint: { x: objective.x, z: objective.z + 3.5 },
    portalPoints: [-8, 0, 8].map(x => ({ x: objective.x + x, z: objective.z - 10 })),
    shopPoint: { x: objective.x, z: objective.z + 3.5 }, bossPoint: { ...objective }, center: { x: 0, z: 0 },
    adventure: { designId: design.id, title: design.title, routeHint: design.routeHint,
      objective, sites, paths, rocks: [], zones: [
      { id: 'arrival', label: '入口营地', ...entrance, radius: 11 },
      { ...sites[0], id: 'west', label: sites[0].label, radius: 10 },
      { ...sites[1], id: 'east', label: sites[1].label, radius: 10 },
      { ...sites[2], id: 'north', label: sites[2].label, radius: 9 },
      { id: 'shrine', label: '灵火祭坛', ...objective, radius: 14 },
    ] },
  };
  const box = (x: number, z: number, width: number, depth: number, height: number, tag = 'rock', group = 0, look: 'collider' | 'invisible' | 'platform' | 'stair' = 'collider', y = 0): void => {
    L.boxes.push({ minX: x - width / 2, minY: y, minZ: z - depth / 2, maxX: x + width / 2, maxY: y + height, maxZ: z + depth / 2, tag, group, look, noRaycast: look === 'invisible', v: rng.next() });
  };
  const addRock = (rock: AdventureRock): void => {
    L.adventure!.rocks.push(rock);
    box(rock.x, rock.z, rock.width, rock.depth, rock.height);
  };
  const reserved = [{ ...entrance, radius: 4.2 }, { ...objective, radius: 3.5 },
    ...sites.map(p => ({ ...p, radius: 3.8 })), ...L.portalPoints.map(p => ({ ...p, radius: 3.4 })),
    { ...L.rewardPoint, radius: 3.4 }];
  const footprint: DecoFootprint = stage.theme === 'desert' ? { width: 4.8, height: 4.4, depth: 2.6 }
    : stage.theme === 'frost' ? { width: 4.2, height: 5, depth: 3.2 } : { width: 4.6, height: 4.8, depth: 3.4 };
  // Actual all-LOD gate envelopes, uniformly fitted to 10.5m width. The snowy
  // roof is thicker than the brief; retain its reviewed scale and open passage.
  const gateEnvelope = stage.theme === 'desert'
    ? { width: 10.5, height: 6.5013729527072535, depth: 1.3561618288130897 }
    : stage.theme === 'frost'
      ? { width: 10.5, height: 6.373720098054656, depth: 2.225805098460656 }
      : { width: 10.5, height: 6.508423087107384, depth: 1.292190407446681 };
  const wallEnvelope = stage.theme === 'desert'
    ? { width: 6.598757627086841, height: 3.961362131374905, depth: 1.3 }
    : stage.theme === 'frost'
      ? { width: 6.120086181502612, height: 3.4414789662240515, depth: 1.3 }
      : { width: 6.140273912515699, height: 3.0009073182372017, depth: 1.3 };
  const arrivalGate = design.gateSockets[0];
  const looseGateReserves: AdventureRock[] = design.gateSockets.map(gate => {
    const c = Math.abs(Math.cos(gate.yaw)), sn = Math.abs(Math.sin(gate.yaw));
    return { ...gate, width: (gateEnvelope.width * c + gateEnvelope.depth * sn) * gate.s,
      depth: (gateEnvelope.depth * c + gateEnvelope.width * sn) * gate.s,
      height: gateEnvelope.height * gate.s };
  });
  const arrivalPostFeet = [-1, 1].map(sign => ({ x: arrivalGate.x + sign * (gateEnvelope.width + 6.4) * 1.2 / 4, z: arrivalGate.z }));
  const overlookCandidates = [design.overlook, ...[
    [14.5, 12.5], [14.5, 14.5], [12.5, 14.5], [16.5, 12.5], [-17.5, 14.5], [-17.5, 18.5],
    [14.5, -2.5], [16.5, 2.5], [-14.5, -13.5], [-12.5, 12.5], [3.5, -22.5],
  ].map(([x, z]) => ({ x, z })),
    ...Array.from({ length: 21 }, (_, ix) => Array.from({ length: 19 }, (_, iz) => ({ x: ix * 2 - 20.5, z: iz * 2 - 20.5 }))).flat()
      .sort((a, b) => distance(a, design.overlook) - distance(b, design.overlook))];
  const overlook = overlookCandidates.map(p => ({ ...p, width: 6.6, depth: 12.5, height: 1.2, yaw: 0 }))
    .find(p => !reserved.some(q => pointRockDistance(q, p) < q.radius)
      && looseGateReserves.every(gate => rockGap(p, gate) >= .7)
      && !paths.slice(0, -1).some(path => path.points.slice(1).some((b, i) => crossesRock(path.points[i], b, p, path.width / 2 + .45))));
  if (!overlook) throw new Error(`${design.id}: no clear lookout pocket`);
  const spurStart = paths.slice(0, -1).flatMap(path => path.points)
    .slice().sort((a, b) => distance(a, { x: overlook.x, z: overlook.z + 4.7 }) - distance(b, { x: overlook.x, z: overlook.z + 4.7 }))[0];
  paths[paths.length - 1].points = [{ ...spurStart },
    { x: overlook.x - 7.5, z: overlook.z + 6.7 }, { x: overlook.x, z: overlook.z + 4.7 }];
  // Four small architectural alcoves give each discovery a recognizable place.
  // Reserve their whole solid footprint before the formations and loose rubble;
  // the 48 existing boundary rocks may bend outward but never gain instances.
  const acceptedLandmarks: AdventureRock[] = [];
  const landmarkPlans = [
    { x: sites[0].x - 5.7, z: sites[0].z + 1.5, target: sites[0], s: .92, role: 'alcove' as const },
    { x: sites[1].x + 6.5, z: sites[1].z - 6, target: sites[1], s: .92, role: 'alcove' as const },
    { x: sites[2].x + 6, z: sites[2].z + 6, target: sites[2], s: .92, role: 'alcove' as const },
    { x: objective.x - 9.5, z: objective.z + 6, target: objective, s: 1, role: 'focal' as const },
  ].map(plan => {
    const candidates = [{ x: plan.x, z: plan.z }, ...[
      [-9.5, 6], [9.5, 6], [-10.5, -2.5], [10.5, -2.5], [-4.5, 10.5], [4.5, 10.5],
      [-9.5, -8.5], [9.5, -8.5], [-6, 9.5], [6, 9.5],
    ].map(([dx, dz]) => ({ x: plan.target.x + dx, z: plan.target.z + dz })),
      ...[10, 12, 14, 16].flatMap(radius => Array.from({ length: 32 }, (_, i) => ({
        x: snap(plan.target.x + Math.sin(i * TAU / 32) * radius),
        z: snap(plan.target.z + Math.cos(i * TAU / 32) * radius),
      })))];
    for (const point of candidates) {
      const quarter = Math.round(Math.atan2(plan.target.x - point.x, plan.target.z - point.z) / (Math.PI / 2));
      const p = { ...plan, ...point, yaw: quarter * Math.PI / 2,
        width: (quarter & 1 ? footprint.depth : footprint.width) * plan.s,
        depth: (quarter & 1 ? footprint.width : footprint.depth) * plan.s, height: footprint.height * plan.s };
      if (Math.abs(p.x) + p.width / 2 > 37.4 || Math.abs(p.z) + p.depth / 2 > 37.4) continue;
      if (Math.hypot(Math.abs(p.x) + p.width / 2, Math.abs(p.z) + p.depth / 2) > 35) continue;
      if (reserved.some(q => pointRockDistance(q, p) < q.radius)) continue;
      if (rockGap(p, overlook) < .7) continue;
      if (acceptedLandmarks.some(q => rockGap(p, q) < .2)) continue;
      if (looseGateReserves.some(gate => rockGap(p, gate) < .25)) continue;
      if (paths.some(path => path.points.slice(1).some((b, i) => crossesRock(path.points[i], b, p, path.width / 2 + .45)))) continue;
      acceptedLandmarks.push(p); return p;
    }
    throw new Error(`${design.id}: no clear ${plan.role} landmark court`);
  });
  const primary: DecoKind = stage.theme === 'desert' ? 'statue' : 'crystal';
  const companion: DecoKind = stage.theme === 'desert' ? 'pots' : stage.theme === 'frost' ? 'stoneLantern' : 'brazier';
  const wallFootprint = (wall: typeof design.wallPlans[number]): AdventureRock => {
    const c = Math.abs(Math.cos(wall.yaw)), sn = Math.abs(Math.sin(wall.yaw));
    return { ...wall, width: wallEnvelope.width * c + wallEnvelope.depth * sn,
      depth: wallEnvelope.depth * c + wallEnvelope.width * sn, height: wallEnvelope.height };
  };
  const sizes: Partial<Record<DecoKind, [number, number]>> = { statue: [1.9, 2.9], crystal: [1.4, 2.4], stoneLantern: [1, 2.3], brazier: [.9, 1.1], pine: [1.7, 4.6] };
  const propPlans: { kind: DecoKind; x: number; z: number; s: number; width: number; depth: number; height: number; yaw: number;
    layer: 'support' | 'accent'; role: 'focal' | 'alcove'; lit: boolean }[] = [];
  const planProp = (kind: DecoKind, target: P2, preferred: P2, s: number, layer: 'support' | 'accent', role: 'focal' | 'alcove', lit = false): void => {
    const size = sizes[kind] ?? [1.3, 1.2], width = size[0] * Math.min(1.25, s), height = size[1] * s;
    const angle = Math.atan2(preferred.x - target.x, preferred.z - target.z);
    const candidates = [preferred];
    for (const radius of [5.5, 6.5, 7.5, 9]) for (const turn of [0, .5, -.5, 1, -1, 1.5, -1.5, Math.PI])
      candidates.push({ x: target.x + Math.sin(angle + turn) * radius, z: target.z + Math.cos(angle + turn) * radius });
    for (const p of candidates) {
      const volume = { ...p, width, depth: width, height, yaw: 0 };
      if (Math.abs(p.x) + width / 2 > 36 || Math.abs(p.z) + width / 2 > 36) continue;
      if (reserved.some(q => pointRockDistance(q, volume) < q.radius)) continue;
      if (rockGap(volume, overlook) < .3 || landmarkPlans.some(q => rockGap(volume, q) < .2)
        || propPlans.some(q => rockGap(volume, q) < .4)) continue;
      if (design.wallPlans.some(wall => rockGap(volume, wallFootprint(wall)) < .2)) continue;
      if (looseGateReserves.some(gate => rockGap(volume, gate) < .3)) continue;
      if (paths.some(path => path.points.slice(1).some((b, i) => crossesRock(path.points[i], b, volume, path.width / 2 + .45)))) continue;
      propPlans.push({ ...volume, kind, s, layer, role, lit }); return;
    }
  };
  planProp(primary, objective, { x: objective.x + 1.9, z: objective.z }, 1.5, 'support', 'focal');
  for (const sign of [-1, 1]) planProp(companion, objective, { x: objective.x + sign * 4.7, z: objective.z + 2.8 }, .85, 'support', 'focal', stage.theme !== 'desert');
  for (const site of sites) {
    planProp(primary, site, { x: site.x + 3.8, z: site.z - 1.8 }, .92, 'support', 'alcove');
    planProp(companion, site, { x: site.x - 3.8, z: site.z - 1.7 }, .8, 'accent', 'alcove');
  }
  const courtWalls: typeof design.wallPlans = [];
  for (const [index, landmark] of landmarkPlans.entries()) {
    const court = (['west', 'east', 'north', 'shrine'] as const)[index];
    const local = (x: number, z: number): P2 => ({
      x: landmark.x + x * Math.cos(landmark.yaw) + z * Math.sin(landmark.yaw),
      z: landmark.z - x * Math.sin(landmark.yaw) + z * Math.cos(landmark.yaw),
    });
    courtWalls.push({ court, ...local(0, -footprint.depth * landmark.s / 2 - .86), yaw: landmark.yaw });
    for (const sign of [-1, 1]) courtWalls.push({ court,
      ...local(sign * (footprint.width * landmark.s / 2 + .95), 2.55), yaw: landmark.yaw + Math.PI / 2 });
  }
  for (const offset of [-5.65, 5.65]) for (const dz of [7, .6])
    courtWalls.push({ court: 'arrival', x: arrivalGate.x + offset, z: arrivalGate.z + dz, yaw: Math.PI / 2 });
  for (const dz of [-5.1, 5.1]) courtWalls.push({ court: 'shrine', x: objective.x + 7.1, z: objective.z + dz, yaw: 0 });
  // Reserve the authored street geometry before choosing any cliff or rubble.
  // The same modules are later placed first, so accepted corridor walls cannot
  // disappear inside a wide Hunyuan cliff whose source fills the whole box.
  const authoredWalls = [...design.wallPlans, ...courtWalls].filter(wall => {
    const volume = wallFootprint(wall);
    return Math.abs(wall.x) + volume.width / 2 <= 37.6 && Math.abs(wall.z) + volume.depth / 2 <= 37.6
      && !reserved.some(p => pointRockDistance(p, volume) < p.radius)
      && rockGap(volume, overlook) >= .7 && landmarkPlans.every(p => rockGap(volume, p) >= .15)
      && propPlans.every(prop => rockGap(volume, prop) >= .2)
      && !paths.some(path => path.points.slice(1).some((b, i) => crossesRock(path.points[i], b, volume, path.width / 2 + .25)));
  });
  const authoredWallReserves = authoredWalls.map(wallFootprint);
  const clearRock = (rock: AdventureRock): boolean => {
    // The northern portal reaches beyond the walking strip. Use the existing
    // radial boundary bend to leave its complete frame clear; keep the same
    // 48 formations, dimensions and random sequence.
    if (looseGateReserves.some(gate => rockGap(rock, gate) < .2)) return false;
    if (authoredWallReserves.some(wall => rockGap(rock, wall) < .25)) return false;
    if (propPlans.some(prop => rockGap(rock, prop) < .4)) return false;
    if (reserved.some(p => pointRockDistance(p, rock) < p.radius) || rockGap(rock, overlook) < .7
      || landmarkPlans.some(p => rockGap(rock, p) < (rock.ridge === 'boundary' ? .12 : .6))) return false;
    return !paths.some(path => path.points.slice(1).some((b, i) => crossesRock(path.points[i], b, rock, path.width / 2 + .45)));
  };
  // Dense overlapping formations close the actual playable boundary. Its inward
  // silhouette undulates; the emergency air boundary is beyond these visible rocks.
  const phase = rng.range(0, TAU);
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * TAU;
    let radius = Math.max(36, Math.min(41.8, 39.2 + Math.sin(a * 3 + phase) * 2.2 + Math.cos(a * 5 - phase) * 1.5));
    const ridge = .5 + .5 * Math.sin(a * 4 + phase);
    const rock = { x: Math.sin(a) * radius, z: Math.cos(a) * radius, ridge: 'boundary',
      width: rng.range(8.8, 11.8), depth: rng.range(8.8, 11.8), height: 4.6 + ridge * 5.4 + rng.range(0, 2.2), yaw: rng.int(0, 3) * Math.PI / 2 };
    // Local bends give way to reserved paths rather than forcing them through cliffs.
    while (!clearRock(rock) && radius < 44.5) { radius = Math.min(44.5, radius + .35); rock.x = Math.sin(a) * radius; rock.z = Math.cos(a) * radius; }
    addRock(rock);
  }
  for (const sign of [-1, 1]) {
    box(sign * 48, 0, 2, 98, 64, 'boundary', 0, 'invisible');
    box(0, sign * 48, 98, 2, 64, 'boundary', 0, 'invisible');
  }
  // Each regional ridge is a connected assembly, selected inside the empty
  // space between walking corridors. Large formations make the route choices
  // visible from ground level instead of merely describing them in metadata.
  const ridgeTemplates = design.ridges;
  for (const template of ridgeTemplates) {
    const parts: AdventureRock[] = [];
    for (const [ax, az] of template.anchors) {
      const width = rng.range(5.2, 7.2), depth = rng.range(5.0, 6.8), height = rng.range(...design.ridgeHeight), yaw = rng.int(0, 3) * Math.PI / 2;
      let best: AdventureRock | null = null, bestScore = Infinity;
      for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
        const rock = { x: ax + dx, z: az + dz, width, depth, height, yaw, ridge: template.id };
        if (!clearRock(rock)) continue;
        if (parts.length && (!parts.some(p => rockGap(p, rock) < .2) || parts.some(p => distance(p, rock) < 2.5))) continue;
        if (L.adventure!.rocks.some(p => p.ridge !== template.id && rockGap(p, rock) < 1.2)) continue;
        const score = dx * dx + dz * dz;
        if (score < bestScore) { best = rock; bestScore = score; }
      }
      if (best) { addRock(best); parts.push(best); }
    }
  }
  for (const [index, p] of landmarkPlans.entries()) {
    const group = 400 + index;
    box(p.x, p.z, p.width, p.depth, p.height, 'landmark', group);
    L.decos.push({ kind: 'landmark', x: p.x, y: L.floorY, z: p.z, yaw: p.yaw, s: p.s,
      w: footprint.width, h: footprint.height, v: rng.next(), group, lit: false,
      sceneRole: p.role, sceneLayer: 'principal', footprint: { ...footprint } });
  }
  for (let tries = 0, placed = 0; tries < 180 && placed < 8; tries++) {
    const rock = { x: rng.range(-29, 29), z: rng.range(-29, 26), width: rng.range(2.4, 5.2), depth: rng.range(2.4, 5.2), height: rng.range(1.8, 4.6), yaw: rng.int(0, 3) * Math.PI / 2 };
    if (!clearRock(rock)) continue;
    // Only loose rubble yields to architectural joints and narrow views of
    // both entrance post feet. The regional ridges, roads and their RNG order
    // remain unchanged; no foreground rock can fill an approved gate frame.
    if (looseGateReserves.some(gate => rockGap(rock, gate) < .2)
      || arrivalPostFeet.some(foot => crossesRock(entrance, foot, rock, .5))) continue;
    if (L.adventure!.rocks.some(r => rockGap(r, rock) < 1.3)) continue;
    addRock(rock); placed++;
  }
  const prop = (kind: DecoKind, x: number, z: number, s = 1, layer: 'principal' | 'support' | 'accent' = 'support', role: 'focal' | 'alcove' | 'platform' = 'alcove', y = 0, lit = false): void => {
    if (sizes[kind]) { const [w, h] = sizes[kind]!; box(x, z, w * Math.min(1.25, s), w * Math.min(1.25, s), h * s, 'prop', 0, 'collider', y); }
    L.decos.push({ kind, x, y, z, yaw: rng.range(-.15, .15), s, w: 1, h: 1, v: rng.next(), group: 0, lit, sceneRole: role, sceneLayer: layer });
  };
  for (const p of propPlans) prop(p.kind, p.x, p.z, p.s, p.layer, p.role, 0, p.lit);
  // A low lookout supplies a genuine change of elevation. 30 cm rises stay
  // inside the existing player/enemy step limit; NAV uses its foot/head link.
  const group = 300;
  const ox = overlook.x - 8.5, oz = overlook.z + .25;
  box(8.5 + ox, -2.5 + oz, 6, 6, 1.2, 'platform', group, 'platform');
  for (let i = 0; i < 4; i++) box(8.5 + ox, 3.3 + oz - i * .8, 3.6, .8, (i + 1) * .3, 'stair', group, 'stair');
  const foot = { x: 8.5 + ox, z: 4.45 + oz }, head = { x: 8.5 + ox, z: -.05 + oz };
  L.ramps.push({ x0: 5.5 + ox, z0: -5.5 + oz, x1: 11.5 + ox, z1: .5 + oz, top: 1.2,
    sx0: 6.7 + ox, sz0: .5 + oz, sx1: 10.3 + ox, sz1: 3.7 + oz, foot, head, group });
  L.checks.push({ ...foot, g: group });
  prop(companion, 7.5 + ox, -3.7 + oz, .65, 'accent', 'platform', 1.2);
  // Building modules define streets and destination courts at human scale. They
  // are published Hunyuan meshes; the boxes below exist only for physics/nav.
  // The natural ridges keep their original seed sequence and remain the larger
  // regional boundary. Buildings may meet a rock face but never an interaction,
  // the lookout, a solid alcove or either independent walking corridor.
  L.architecture = [];
  const architectureReserved = [...reserved, { ...L.rewardPoint, radius: 3.4 },
    ...propPlans.map(p => ({ x: p.x, z: p.z, radius: p.width / 2 + .2 }))];
  // Exact all-LOD bounds after the original 6.6×4.4×1.3 uniform fit. This
  // retains the approved visual scale and removes the invisible top/side
  // strips that a full reference box would otherwise leave around the art.
  const prefix = stage.theme === 'desert' ? 'Desert' : stage.theme === 'frost' ? 'Frost' : 'Inferno';
  const architectureBoxes = (a: SceneArchitecturePlacement): LevelLayout['boxes'] => {
    const local = a.type === 'gate' ? [
      { x0: -a.envelope.width / 2, x1: -a.passage!.width / 2, y0: 0, y1: a.envelope.height },
      { x0: a.passage!.width / 2, x1: a.envelope.width / 2, y0: 0, y1: a.envelope.height },
      { x0: -a.passage!.width / 2, x1: a.passage!.width / 2, y0: a.passage!.height, y1: a.envelope.height },
    ] : [{ x0: -a.envelope.width / 2, x1: a.envelope.width / 2, y0: 0, y1: a.envelope.height }];
    const c = Math.cos(a.yaw), sn = Math.sin(a.yaw);
    return local.map(bounds => {
      const corners = [bounds.x0, bounds.x1].flatMap(x => [-a.envelope.depth / 2, a.envelope.depth / 2]
        .map(z => ({ x: a.x + (x * c + z * sn) * a.s, z: a.z + (-x * sn + z * c) * a.s })));
      return { minX: Math.min(...corners.map(p => p.x)), maxX: Math.max(...corners.map(p => p.x)),
        minZ: Math.min(...corners.map(p => p.z)), maxZ: Math.max(...corners.map(p => p.z)),
        minY: a.y + bounds.y0 * a.s, maxY: a.y + bounds.y1 * a.s,
        tag: `architecture-${a.type}`, group: 0, look: 'collider' as const, noRaycast: false, v: 0 };
    });
  };
  const clearArchitecture = (boxes: LevelLayout['boxes']): boolean => boxes.every(b => {
    if (b.minY >= L.floorY + 1.9) return true; // a real lintel leaves navigation beneath it
    const volume = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2,
      width: b.maxX - b.minX, depth: b.maxZ - b.minZ, height: b.maxY - b.minY, yaw: 0 };
    if (Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minZ), Math.abs(b.maxZ)) > 37.6) return false;
    if (architectureReserved.some(p => pointRockDistance(p, volume) < p.radius)) return false;
    if (rockGap(volume, overlook) < .7) return false;
    if (L.adventure!.rocks.some(rock => rockGap(volume, rock) < .2)) return false;
    if (L.boxes.some(other => ['landmark', 'prop', 'platform', 'stair'].includes(other.tag)
      && Math.hypot(Math.max(b.minX - other.maxX, other.minX - b.maxX, 0), Math.max(b.minZ - other.maxZ, other.minZ - b.maxZ, 0)) < .15)) return false;
    return !paths.some(path => path.points.slice(1).some((end, i) => crossesRock(path.points[i], end, volume, path.width / 2 + .25)));
  });
  const architecture = (type: SceneArchitecturePlacement['type'], court: SceneArchitecturePlacement['court'], x: number, z: number, yaw = 0, s = 1): boolean => {
    if (L.architecture!.some(a => a.type === type && Math.hypot(a.x - x, a.z - z) < .01
      && Math.abs(Math.sin(a.yaw - yaw)) < .01)) return false;
    if (type === 'wall' && L.architecture!.length >= design.wallBudget) return false;
    const a: SceneArchitecturePlacement = { assetId: `SM_Env_${prefix}${type === 'wall' ? 'Wall' : 'Gate'}`,
      type, court, x, y: L.floorY, z, yaw, s, envelope: { ...(type === 'wall' ? wallEnvelope : gateEnvelope) },
      ...(type === 'gate' ? { passage: { width: 6.4, height: 3.8 } } : {}) };
    const boxes = architectureBoxes(a);
    if (!clearArchitecture(boxes)) return false;
    L.architecture!.push(a); L.boxes.push(...boxes); return true;
  };
  // The nearer 22–24m fork has no gate-width pocket. This straight part of
  // the existing approach exposes both posts without touching the ridge.
  for (const gate of design.gateSockets) architecture('gate', gate.court, gate.x, gate.z, gate.yaw, gate.s);
  for (const wall of authoredWalls) architecture('wall', wall.court, wall.x, wall.z, wall.yaw);
  // The wide vestibule and its continuation are one architectural sequence.
  for (const offset of [-5.65, 5.65]) for (const dz of [7, .6]) architecture('wall', 'arrival', arrivalGate.x + offset, arrivalGate.z + dz, Math.PI / 2);
  // The northern approach has a second true portal before the altar court.
  // Placing it along the straight regional route leaves the three exit circles
  // clear; a gate beside the altar would put its posts into those exits.
  for (const offset of [-5.1, 5.1]) architecture('wall', 'shrine', objective.x + 7.1, objective.z + offset, 0);
  // Back walls and short returns connect each alcove to a recognisable court.
  // A rejected return remains open instead of constricting a preserved route.
  for (const [index, landmark] of landmarkPlans.entries()) {
    const court = (['west', 'east', 'north', 'shrine'] as const)[index];
    const local = (x: number, z: number): P2 => ({
      x: landmark.x + x * Math.cos(landmark.yaw) + z * Math.sin(landmark.yaw),
      z: landmark.z - x * Math.sin(landmark.yaw) + z * Math.cos(landmark.yaw),
    });
    const back = local(0, -footprint.depth * landmark.s / 2 - .86);
    architecture('wall', court, back.x, back.z, landmark.yaw);
    for (const sign of [-1, 1]) {
      const shoulder = local(sign * (footprint.width * landmark.s / 2 + .95), 2.55);
      architecture('wall', court, shoulder.x, shoulder.z, landmark.yaw + Math.PI / 2);
    }
  }
  // Short, open boundary-facing wall stretches frame the two outer routes.
  for (const [court, x, z, yaw] of [
    ['west', -31.4, 14.6, Math.PI / 2], ['west', -31.4, 8.2, Math.PI / 2],
    ['east', 16.5, 29.4, 0], ['east', 23, 29.4, 0],
    ['north', -8.4, -33.7, 0], ['north', -2, -33.7, 0],
  ] as const) architecture('wall', court, x, z, yaw);
  if (stage.theme === 'frost') {
    // Published pine's root/trunk measures <=.71m radius below .5m across
    // all LODs; its leafy crown reaches 1.48m. Reserve solid roots rather
    // than treating the whole crown as an opaque, ground-level obstruction.
    const treeRng = rng.fork(0x50494e45);
    const treeCandidates: { x: number; z: number; s: number; jitter: number }[] = [];
    const focal = landmarkPlans[3];
    for (let x = -33.5; x <= 33.5; x++) for (let z = -32.5; z <= 27.5; z++) {
      const s = treeRng.range(1.10, 1.35), root = { x, z, width: 1.46 * s, depth: 1.46 * s, height: 2.2 * s, yaw: 0 };
      if (!clearRock(root)) continue;
      if (L.boxes.some(b => !b.noRaycast && b.minY < root.height && Math.hypot(
        Math.max(b.minX - x - root.width / 2, x - root.width / 2 - b.maxX, 0),
        Math.max(b.minZ - z - root.depth / 2, z - root.depth / 2 - b.maxZ, 0)) < .25)) continue;
      const crownRadius = 1.55 * s;
      if (distance({ x, z }, objective) < 5.4 + crownRadius) continue;
      if (L.boxes.some(b => (b.tag === 'landmark' || b.tag.startsWith('architecture-'))
        && Math.hypot(Math.max(b.minX - x, x - b.maxX, 0), Math.max(b.minZ - z, z - b.maxZ, 0)) < crownRadius + .15)) continue;
      if (segmentDistance({ x, z }, entrance, focal) < crownRadius + .3) continue;
      treeCandidates.push({ x, z, s, jitter: treeRng.next() * .3 });
    }
    const trees: P2[] = [];
    const plantTree = (candidate: typeof treeCandidates[number]): void => {
      trees.push(candidate);
      box(candidate.x, candidate.z, 1.46 * candidate.s, 1.46 * candidate.s, 2.2 * candidate.s, 'pine-trunk');
      L.decos.push({ kind: 'pine', x: candidate.x, y: L.floorY, z: candidate.z, yaw: treeRng.range(-.3, .3),
        s: candidate.s, w: 1, h: 1, v: treeRng.next(), group: 0, lit: false, sceneRole: 'corner', sceneLayer: 'support' });
    };
    for (const anchor of [{ x: -28, z: 13 }, { x: 28, z: 17 }, { x: -19, z: -21 }]) {
      let cluster: P2 | null = null;
      for (let member = 0; member < 2; member++) {
        const target: P2 = cluster ?? anchor;
        const candidate: typeof treeCandidates[number] | undefined = treeCandidates.filter(p => trees.every(q => distance(p, q) >= 2.8)
          && (!cluster || distance(p, cluster) < 6)).sort((a, b) => distance(a, target) + a.jitter - distance(b, target) - b.jitter)[0];
        if (!candidate) continue;
        cluster ??= candidate;
        plantTree(candidate);
      }
    }
    // Very narrow regional pockets can admit only one member of a pair. Fill
    // the remaining sparse accents from the furthest measured safe pockets.
    while (trees.length < 6) {
      const separation = (p: P2): number => Math.min(...trees.map(q => distance(p, q)));
      const candidate = treeCandidates.filter(p => separation(p) >= 2.8)
        .sort((a, b) => separation(b) - separation(a) + a.jitter - b.jitter)[0];
      if (!candidate) break;
      plantTree(candidate);
    }
  }
  L.runes.push({ ...objective, r: 3.4, gold: true });
  // Spawn selection uses the exact native navigation grid, with physical margin
  // for enemy body sizes. Waves stay around the objective rather than the full map.
  const size = HALF * 2, blocked = new Uint8Array(size * size), components = new Int32Array(size * size);
  rasterizeBlocked(L.boxes, -HALF, -HALF, size, size, 1, 0, NAV_FOOT, blocked);
  labelComponents(blocked, size, size, components, new Int32Array(size * size));
  const cell = (p: P2): number => Math.floor(p.z + HALF) * size + Math.floor(p.x + HALF);
  const home = components[cell(entrance)];
  for (const separation of [4.2, 3.1, 2.2]) {
    for (let tries = 0; tries < 1800 && L.spawnPoints.length < 16; tries++) {
      const angle = rng.range(0, TAU), radius = rng.range(12, 23);
      const p = { x: snap(objective.x + Math.sin(angle) * radius), z: snap(objective.z + Math.cos(angle) * radius) };
      if (Math.abs(p.x) >= HALF - 2 || Math.abs(p.z) >= HALF - 2 || distance(p, objective) < 12 || distance(p, objective) > 23 || distance(p, entrance) < 14) continue;
      if (components[cell(p)] !== home || blocked[cell(p)]) continue;
      if (L.spawnPoints.some(q => distance(p, q) < separation) || sites.some(q => distance(p, q) < 3.4) || L.portalPoints.some(q => distance(p, q) < 3.4)) continue;
      if (L.boxes.some(b => Math.hypot(Math.max(b.minX - p.x, p.x - b.maxX, 0), Math.max(b.minZ - p.z, p.z - b.maxZ, 0)) < 1.35)) continue;
      L.spawnPoints.push(p);
    }
  }
  const groundSafe = (p: P2, margin = 1.35): boolean => Math.abs(p.x) < HALF - 2 && Math.abs(p.z) < HALF - 2
    && !blocked[cell(p)] && components[cell(p)] === home
    && L.boxes.every(b => b.minY >= 1.9 || Math.hypot(Math.max(b.minX - p.x, p.x - b.maxX, 0),
      Math.max(b.minZ - p.z, p.z - b.maxZ, 0)) >= margin);
  const roles: AdventureSpawnAnchor['role'][] = ['assault', 'flank', 'ranged', 'precision', 'artillery', 'support'];
  L.adventure!.spawnAnchors = L.spawnPoints.map((p, i) => ({ ...p, role: roles[i % roles.length], lane: i % 3 - 1 }));
  L.adventure!.encounters = [];
  for (const plan of design.encounterPlans) {
    let selected: AdventureEncounter | null = null;
    // A cache remains next to its actual chest. Approach centres may move a
    // few metres along their battle pocket to retain a complete safe formation.
    const offsets = [[0, 0], [0, 2], [0, -2], [2, 0], [-2, 0], [2, 2], [-2, -2]];
    for (const [dx, dz] of offsets) {
      const centre = { x: snap(plan.x + dx), z: snap(plan.z + dz) };
      if (!groundSafe(centre, .65) || distance(centre, entrance) < 12) continue;
      const candidates: P2[] = [];
      for (const radius of [12.5, 15.5, 18.5, 21.5, 24.5]) for (let i = 0; i < 48; i++) {
        const angle = i * TAU / 48;
        const p = { x: snap(centre.x + Math.sin(angle) * radius), z: snap(centre.z + Math.cos(angle) * radius) };
        const r = distance(p, centre);
        if (r < 12 || r > 26 || distance(p, entrance) < 12 || !groundSafe(p)) continue;
        if (reserved.some(q => distance(p, q) < 3.4)) continue;
        if (!candidates.some(q => distance(p, q) < .5)) candidates.push(p);
      }
      let fx = centre.x - plan.from.x, fz = centre.z - plan.from.z;
      const length = Math.hypot(fx, fz) || 1; fx /= length; fz /= length;
      const anchors: AdventureSpawnAnchor[] = [];
      const formations: [AdventureSpawnAnchor['role'], number, number][] = [
        ['assault', 12.5, -3], ['assault', 12.5, 3], ['flank', 8, -15], ['flank', 8, 15],
        ['ranged', 18, -8], ['ranged', 18, 8], ['precision', 22, -3], ['artillery', 20, 12],
        ['support', 20, 0], ['precision', 22, 3],
      ];
      for (const [role, forward, side] of formations) {
        const target = { x: centre.x + fx * forward - fz * side, z: centre.z + fz * forward + fx * side };
        const safe = candidates.filter(p => anchors.every(a => distance(a, p) >= 2.2)
          && (role !== 'precision' || distance(p, centre) >= 18));
        const assault = anchors.find(a => a.role === 'assault');
        const score = (p: P2): number => distance(p, target)
          + (role === 'support' && assault ? Math.max(0, Math.abs(distance(p, assault) - 7.5) - 1.5) * 2 : 0);
        safe.sort((a, b) => score(a) - score(b));
        const candidate = safe[0];
        if (candidate) anchors.push({ ...candidate, role, lane: side < -1 ? -1 : side > 1 ? 1 : 0 });
      }
      if (anchors.length < 8 || roles.some(role => !anchors.some(a => a.role === role))) continue;
      selected = { id: plan.id, label: plan.label, kind: plan.kind, ...centre, triggerRadius: plan.kind === 'cache' ? 7 : 6.5,
        arenaRadius: 26, ...(plan.siteIndex === undefined ? {} : { siteId: sites[plan.siteIndex].id }), anchors };
      break;
    }
    if (!selected) throw new Error(`${design.id}: no complete safe formation for ${plan.id}`);
    L.adventure!.encounters.push(selected);
  }
  return L;
}
