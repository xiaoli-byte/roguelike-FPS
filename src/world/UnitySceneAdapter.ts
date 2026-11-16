import type { StageNode } from '../core/types';
import { yawFromDir } from '../core/math';
import type { LevelLayout, P2 } from './LevelTypes';
import type { WhiteboxFight } from './WhiteboxEncounters';
import { buildWhiteboxAdventure } from './WhiteboxEncounters';
import type { WhiteboxMetadata, WhiteboxPlan, WhiteboxPoint } from './WhiteboxTypes';
import type { UnityEncounter, UnitySceneDocument } from './UnityLevelLibrary';
import { CombatDirector } from './CombatDirector';
import { ROADSIDE_REWARD_MULT } from '../progression/Economy';

const ROLES = ['assault', 'flank', 'ranged', 'precision', 'artillery', 'support'] as const;
const BOSS_IDS: Readonly<Record<string, string>> = {
  boss_hanba: 'boss_hanba', boss_kunpeng: 'boss_kunpeng', boss_warlord: 'boss_warlord', boss_qilin: 'boss_qilin',
};

function room(id: string, label: string, center: WhiteboxPoint, radius: number) {
  const r = Math.max(4, radius);
  return {
    id, label,
    polygon: [[center[0] - r, center[1] - r], [center[0] + r, center[1] - r], [center[0] + r, center[1] + r], [center[0] - r, center[1] + r]] as WhiteboxPoint[],
    labelAt: [center[0], center[1]] as WhiteboxPoint,
  };
}

function planFor(document: UnitySceneDocument, spawn: P2, exit: P2): WhiteboxPlan {
  const half: WhiteboxPoint = [document.bounds.max[0] - document.bounds.min[0], document.bounds.max[2] - document.bounds.min[2]];
  const at = (point: P2): WhiteboxPoint => [point.x + half[0] / 2, point.z + half[1] / 2];
  const encounters = document.encounters.map((site, index) => ({
    id: site.title || `E${index}`, at: at({ x: site.position[0], z: site.position[2] }),
    room: site.title || `E${index}`, label: site.title,
    roster: site.waves[0]?.hint ?? site.waves[0]?.label ?? '肃清区域',
    timing: '按场景编排', facing: at({ x: site.position[0], z: site.position[2] + 1 }),
    requires: site.requires,
  }));
  for (const [index, boss] of document.bosses.entries()) encounters.push({
    id: `boss:${boss.id}:${index}`, at: at({ x: boss.position[0], z: boss.position[2] }),
    room: `boss:${boss.id}:${index}`, label: boss.id, roster: '首领战', timing: '首领',
    facing: at({ x: boss.position[0], z: boss.position[2] + 1 }), requires: [],
  });
  const entryId = 'entry', exitId = 'exit';
  const rooms = [
    room(entryId, '入口', at(spawn), 10),
    ...encounters.map(encounter => room(encounter.id, encounter.label, encounter.at, document.encounters.find(site => site.title === encounter.id)?.arenaRadius ?? 24)),
    room(exitId, '出口', at(exit), 10),
  ];
  const routeIds = [entryId, ...encounters.map(encounter => encounter.id), exitId];
  const passages = routeIds.slice(1).map((to, index) => ({
    id: `route-${index}`, from: routeIds[index], to,
    points: [rooms[index].labelAt, rooms[index + 1].labelAt], width: 6, kind: 'main' as const, note: 'Unity 主线',
  }));
  return {
    id: `unity-${document.id}`, chapter: 'desert', index: 0,
    title: document.title, subtitle: 'Unity 场景', identity: document.title,
    objective: '按 Unity 关卡目标推进', pacing: [], routeChoice: '', encounterLogic: '', artBrief: document.title,
    whiteboxChecks: [], bounds: half, rooms, passages,
    entry: { room: entryId, at: at(spawn) }, exit: { room: exitId, at: at(exit) },
    mainRoute: passages.map(passage => passage.id),
    covers: [], encounters,
    rewards: document.caches.map((cache, index) => ({
      at: at({ x: cache.position[0], z: cache.position[2] }), room: cache.guard ?? encounters.at(-1)?.id ?? exitId,
      label: cache.title, reward: cache.reward === 'weapon' ? 'weapon' : cache.reward === 'scroll' ? 'scroll' : cache.reward === 'heal' ? 'heal' : 'coins',
      requires: cache.guard ? [cache.guard] : [],
    })),
    sightlines: [], notes: [],
    preparation: document.camps.length > 0 ? {
      room: 'camp', at: at({ x: document.camps[0].position[0], z: document.camps[0].position[2] }),
      facing: at({ x: document.camps[0].position[0], z: document.camps[0].position[2] + 1 }), label: document.camps[0].title,
    } : undefined,
  };
}

/**
 * 每个据点每只怪的击杀奖励倍率（Unity EncounterSite.RewardFactor = 据点加量摊薄 × 驻守点 0.5）：
 * StageDirector 在这个据点刷出来的怪上挂 RewardScale（< 1 才挂）。首领场 / 没加量的普通据点 = 1
 */
const rewardFactors = new WeakMap<WhiteboxFight, number>();

export function unityFightRewardFactor(fight: WhiteboxFight | null | undefined): number {
  return fight ? rewardFactors.get(fight) ?? 1 : 1;
}

export interface UnityFightOptions {
  /** 正式的局（CombatDirector.live）：据点普通单位 × 1.5 加量，奖励按比例摊薄 */
  live?: boolean;
}

function fightsFor(document: UnitySceneDocument, options: UnityFightOptions = {}): WhiteboxFight[] {
  const regular = document.encounters.map((site: UnityEncounter, index): WhiteboxFight => {
    const position = { x: site.position[0], z: site.position[2] };
    const facing = { x: position.x, z: position.z + 1 };
    const plans = site.waves.map(wave => ({
      label: wave.label, hint: wave.hint, triggerRemaining: wave.triggerRemaining, delay: wave.delay,
      entries: wave.entries.map(entry => ({
        enemyId: entry.enemy, count: entry.count, elite: entry.elite,
        affix: entry.affix || undefined, placement: ROLES[Math.max(0, Math.min(ROLES.length - 1, entry.role))],
        arrivalDelay: entry.arrivalDelay >= 0 ? entry.arrivalDelay : undefined,
      })),
    }));
    // 据点加量（每关新建的编制拷贝，改它不动文档）；奖励倍率 = 摊薄 × 驻守点减半
    const factor = CombatDirector.densify(plans, !!options.live) * (site.roadside ? ROADSIDE_REWARD_MULT : 1);
    const fight: WhiteboxFight = {
      id: site.title || `E${index}`, label: site.title, room: site.title || `E${index}`,
      final: false, optional: site.optional, position, facing,
      anchors: site.anchors.map(anchor => ({
        x: anchor.position[0], y: anchor.position[1], z: anchor.position[2], lane: anchor.lane, role: ROLES[Math.max(0, Math.min(ROLES.length - 1, anchor.role))],
      })),
      points: [position], radius: site.arenaRadius,
      contains: (point, halfWidth = 0) => Math.hypot(point.x - position.x, point.z - position.z) <= site.arenaRadius + halfWidth,
      entryDepth: site.entryDepth, requires: site.requires,
      plans,
    };
    if (factor < 1) rewardFactors.set(fight, factor);
    return fight;
  });
  const bosses = document.bosses.map((boss, index): WhiteboxFight => {
    const position = { x: boss.position[0], z: boss.position[2] };
    return {
      id: `boss:${boss.id}:${index}`, label: boss.id, room: `boss:${boss.id}:${index}`,
      final: true, optional: false, position, facing: { x: position.x, z: position.z + 1 },
      anchors: [{ ...position, role: 'assault', lane: 0 }], points: [position], radius: boss.radius,
      contains: (point, halfWidth = 0) => Math.hypot(point.x - boss.center[0], point.z - boss.center[2]) <= boss.radius + halfWidth,
      entryDepth: 2, requires: [],
      plans: [{ entries: [{ enemyId: BOSS_IDS[boss.id] ?? boss.id, count: 1 }], label: boss.id }],
    };
  });
  if (regular.length > 0) regular[regular.length - 1].final = bosses.length === 0;
  return [...regular, ...bosses];
}

export function unityLayout(document: UnitySceneDocument, stage: StageNode): LevelLayout {
  const spawn = { x: document.spawn.position[0], z: document.spawn.position[2] };
  const firstExit = document.exits[0];
  const exit = firstExit ? { x: firstExit.position[0], z: firstExit.position[2] } : spawn;
  const plan = planFor(document, spawn, exit);
  const fights = fightsFor(document);
  const metadata: WhiteboxMetadata = {
    planId: plan.id, title: document.title, plan,
    floorRects: [{ minX: document.bounds.min[0], minZ: document.bounds.min[2], maxX: document.bounds.max[0], maxZ: document.bounds.max[2] }],
    checkpoints: [], gridSize: 1,
  };
  const layout: LevelLayout = {
    type: stage.type, theme: stage.theme,
    half: Math.max(document.bounds.max[0] - document.bounds.min[0], document.bounds.max[2] - document.bounds.min[2]) / 2,
    minX: document.bounds.min[0], minZ: document.bounds.min[2], maxX: document.bounds.max[0], maxZ: document.bounds.max[2],
    floorY: document.spawn.position[1], wallThickness: 1, wallHeight: 40,
    boxes: document.colliders.map((collider, index) => ({ collider, index })).filter(item => item.collider.platform === undefined).map(({ collider, index }) => ({
      minX: collider.min[0], minY: collider.min[1], minZ: collider.min[2],
      maxX: collider.max[0], maxY: collider.max[1], maxZ: collider.max[2],
      look: 'collider', tag: collider.activator ? `unity-activator-${collider.activator}` : collider.url ? `unity-proxy-${index}` : collider.kind === 'box' ? 'wall' : 'cover', group: 0, noRaycast: false, v: 0,
      obb: collider.center && collider.size && collider.rotation ? { center: collider.center, size: collider.size, rotation: collider.rotation } : undefined,
    })),
    decos: [], lights: [], runes: [], ramps: [],
    playerSpawn: spawn, playerYaw: yawFromDir(document.spawn.forward[0], document.spawn.forward[2]),
    spawnPoints: document.encounters.flatMap(site => site.anchors.map(anchor => ({ x: anchor.position[0], z: anchor.position[2] }))),
    rewardPoint: document.bosses[0] ? { x: document.bosses[0].reward[0], z: document.bosses[0].reward[2] } : exit,
    portalPoints: document.exits.map(exit => ({ x: exit.position[0], z: exit.position[2] })),
    shopPoint: document.camps[0] ? { x: document.camps[0].position[0], z: document.camps[0].position[2] } : spawn,
    bossPoint: document.bosses[0] ? { x: document.bosses[0].position[0], z: document.bosses[0].position[2] } : exit,
    center: { x: (document.bounds.min[0] + document.bounds.max[0]) / 2, z: (document.bounds.min[2] + document.bounds.max[2]) / 2 },
    checks: [], whitebox: metadata,
    unityHeightfield: document.heightfields.length > 0,
  };
  layout.adventure = buildWhiteboxAdventure(layout, fights);
  return layout;
}

export { fightsFor as unityFights };
