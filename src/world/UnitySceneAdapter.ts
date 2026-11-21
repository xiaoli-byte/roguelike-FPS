import type { AnchorRole, EnemyPlacement, StageNode } from '../core/types';
import { yawFromDir } from '../core/math';
import type { LevelLayout, P2 } from './LevelTypes';
import type { WhiteboxFight } from './WhiteboxEncounters';
import { buildWhiteboxAdventure } from './WhiteboxEncounters';
import type { WhiteboxMetadata, WhiteboxPlan, WhiteboxPoint } from './WhiteboxTypes';
import type { UnityEncounter, UnitySceneDocument } from './UnityLevelLibrary';
import { CombatDirector } from './CombatDirector';
import { ROADSIDE_REWARD_MULT } from '../progression/Economy';
import { inStrongholdThreshold, objectiveDriven, type LevelObjectivesDoc } from './objectives/LevelObjectives';

/**
 * 场景文档里的站位角色是 Unity StationRole 的枚举值（WebSceneExporter 写 (int)role）：0 = Auto，1–6 = 正面 / 侧袭 / 远程 / 狙击 / 炮手 / 辅助。
 * 锚点的 Auto 不挑角色（WaveRunner.anchorBonus 不加不减）；编制条目的 Auto 按敌人自己的站位（WaveRunner 的 defaultPlacement）
 */
const ROLES = ['auto', 'assault', 'flank', 'ranged', 'precision', 'artillery', 'support'] as const;
const anchorRole = (role: number): AnchorRole => ROLES[Number.isInteger(role) && role >= 0 && role < ROLES.length ? role : 0];
const entryPlacement = (role: number): EnemyPlacement | undefined => {
  const r = anchorRole(role);
  return r === 'auto' ? undefined : r;
};
const BOSS_IDS: Readonly<Record<string, string>> = {
  boss_hanba: 'boss_hanba', boss_kunpeng: 'boss_kunpeng', boss_warlord: 'boss_warlord', boss_qilin: 'boss_qilin',
  boss_kui: 'boss_kui', boss_feilian: 'boss_feilian', boss_huashe: 'boss_huashe',
};
/** 首领战在行旅图 / 遭遇提示里的名字（首领定义里的 name 去掉副标题；这里不 import 首领模块，免得关卡载入拖进首领的全部依赖） */
const BOSS_LABELS: Readonly<Record<string, string>> = {
  boss_hanba: '旱魃', boss_kunpeng: '鲲鹏', boss_warlord: '熔心魔将', boss_qilin: '火麒麟',
  boss_kui: '夔', boss_feilian: '飞廉', boss_huashe: '化蛇',
};
const bossLabel = (id: string) => BOSS_LABELS[id] ?? id;

function room(id: string, label: string, center: WhiteboxPoint, radius: number) {
  const r = Math.max(4, radius);
  return {
    id, label,
    polygon: [[center[0] - r, center[1] - r], [center[0] + r, center[1] - r], [center[0] + r, center[1] + r], [center[0] - r, center[1] + r]] as WhiteboxPoint[],
    labelAt: [center[0], center[1]] as WhiteboxPoint,
  };
}

/**
 * 藏宝点的奖励串（Unity RewardRegistry：第一段是种类）→ 网页宝箱奖励：带参数的武器奖励（'weapon:min=1' / 'weapon:stormpod:1'）原样交给
 * LootSystem.grant 解析（rewardRules.parseWeaponReward）；灵兽封印（'pet' / 'pet:<id>' / 'pet:rarity=N'，M9 灵宠）原样；秘卷 / 治疗 / 强化按种类；
 * 网页没有的退成灵石。
 * 这里不 import rewardRules：测试按模块名打桩
 */
function cacheReward(reward: string): NonNullable<WhiteboxPlan['rewards'][number]['reward']> {
  const key = reward.split(':')[0];
  if (key === 'weapon') return reward === 'weapon' ? 'weapon' : reward as `weapon:${string}`;
  if (key === 'pet') return reward === 'pet' ? 'pet' : reward as `pet:${string}`;
  return key === 'scroll' || key === 'heal' || key === 'upgrade' ? key : 'coins';
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
    room: `boss:${boss.id}:${index}`, label: bossLabel(boss.id), roster: '首领战', timing: '首领',
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
      label: cache.title, reward: cacheReward(cache.reward),
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
  /**
   * 关卡目标（objectives.json，world/objectives/LevelObjectives）：灵火坛 N 选 M / 据点首领的关卡没有终点战（清关交给目标），
   * 据点首领（stronghold）不是终点战、按导出的门槛圆触发（Unity ZheduoLevel.strongholds）
   */
  objectives?: LevelObjectivesDoc | null;
}

function fightsFor(document: UnitySceneDocument, options: UnityFightOptions = {}): WhiteboxFight[] {
  const regular = document.encounters.map((site: UnityEncounter, index): WhiteboxFight => {
    const position = { x: site.position[0], z: site.position[2] };
    const facing = { x: position.x, z: position.z + 1 };
    const plans = site.waves.map(wave => ({
      label: wave.label, hint: wave.hint, triggerRemaining: wave.triggerRemaining, delay: wave.delay,
      entries: wave.entries.map(entry => ({
        enemyId: entry.enemy, count: entry.count, elite: entry.elite,
        affix: entry.affix || undefined, placement: entryPlacement(entry.role),
        arrivalDelay: entry.arrivalDelay >= 0 ? entry.arrivalDelay : undefined,
      })),
    }));
    // 据点加量（每关新建的编制拷贝，改它不动文档）；奖励倍率 = 摊薄 × 驻守点减半
    const factor = CombatDirector.densify(plans, !!options.live) * (site.roadside ? ROADSIDE_REWARD_MULT : 1);
    const fight: WhiteboxFight = {
      id: site.title || `E${index}`, label: site.title, room: site.title || `E${index}`,
      final: false, optional: site.optional, position, facing,
      anchors: site.anchors.map(anchor => ({
        x: anchor.position[0], y: anchor.position[1], z: anchor.position[2], lane: anchor.lane, role: anchorRole(anchor.role),
        // 高台站位：导出器（WebSceneExporter.Encounter）还没写 SpawnAnchor.elevated，导出后这里直接生效
        ...(anchor.elevated ? { elevated: true } : {}),
      })),
      points: [position], radius: site.arenaRadius,
      contains: (point, halfWidth = 0) => Math.hypot(point.x - position.x, point.z - position.z) <= site.arenaRadius + halfWidth,
      entryDepth: site.entryDepth, requires: site.requires,
      plans,
    };
    if (factor < 1) rewardFactors.set(fight, factor);
    return fight;
  });
  const byObjective = objectiveDriven(options.objectives);
  const bosses = document.bosses.map((boss, index): WhiteboxFight => {
    const position = { x: boss.position[0], z: boss.position[2] };
    const ground = { ...position, y: boss.position[1] };
    // 矩形场地（3-3 神范台 88 × 88 m）导出的 radius 只是圆形场地的缺省 20 m：半径至少盖到首领出生点（魔将出生在火神殿高台上，离中心 39.5 m）
    const radius = Math.max(boss.radius, Math.hypot(boss.position[0] - boss.center[0], boss.position[2] - boss.center[2]) + 4);
    // 首领出生点（Unity BossArena.BossSpawnPoint，可以在高台上）本身总在场内：刷首领时校验刷怪点不会把它挡在外面
    const atSpawn = (point: { x: number; z: number; y?: number }, halfWidth: number) => Math.hypot(point.x - boss.position[0], point.z - boss.position[2]) <= 3 + halfWidth
      && (point.y === undefined || Math.abs(point.y - boss.position[1]) < 6);
    // 据点模式（4-1 三领主，Unity BossEncounter.stronghold）：不是终点战；门槛按导出的圆（ZheduoLevel.strongholds：圆心 / 半径 / 脚的高度范围）
    const stronghold = !!boss.stronghold && byObjective;
    const threshold = stronghold ? options.objectives?.bosses.find(b => b.bossId === boss.id && b.stronghold)?.threshold : undefined;
    return {
      id: `boss:${boss.id}:${index}`, label: bossLabel(boss.id), room: `boss:${boss.id}:${index}`,
      final: !stronghold, optional: false, position, facing: { x: position.x, z: position.z + 1 },
      // 锚点带上 Unity 首领锚点的真实高度：不带的话会被补成关卡 floorY（1-4 是出生台地 16 m），首领要刷在泉床上空
      anchors: [{ ...ground, role: 'assault', lane: 0 }], points: [ground], radius,
      // 同 Unity BossEncounter.PlayerInArena：场地范围内，且脚在首领场自己的地面高度 6 m 以内（1-4 的泉床低于出生台地 16 m）
      contains: (point: { x: number; z: number; y?: number }, halfWidth = 0) => atSpawn(point, halfWidth)
        || (threshold ? inStrongholdThreshold(threshold, point)
          : Math.hypot(point.x - boss.center[0], point.z - boss.center[2]) <= radius + halfWidth && (point.y === undefined || Math.abs(point.y - boss.floorY) < 6)),
      entryDepth: 2, requires: [],
      plans: [{ entries: [{ enemyId: BOSS_IDS[boss.id] ?? boss.id, count: 1 }], label: boss.id }],
    };
  });
  // 有终点首领就以它清关；目标驱动的关卡（灵火坛 / 据点）没有终点战
  if (regular.length > 0) regular[regular.length - 1].final = !bosses.some(b => b.final) && !byObjective;
  return [...regular, ...bosses];
}

export function unityLayout(document: UnitySceneDocument, stage: StageNode, objectives: LevelObjectivesDoc | null = null): LevelLayout {
  const spawn = { x: document.spawn.position[0], z: document.spawn.position[2] };
  const firstExit = document.exits[0];
  const exit = firstExit ? { x: firstExit.position[0], z: firstExit.position[2] } : spawn;
  const plan = planFor(document, spawn, exit);
  const fights = fightsFor(document, { objectives });
  const finalBoss = document.bosses.find(b => !b.stronghold);
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
    // 清关宝箱：落在终点首领的宝箱点；据点首领（4-1 三领主）各自结算自己的宝箱，清关宝箱落在出口
    rewardPoint: finalBoss ? { x: finalBoss.reward[0], z: finalBoss.reward[2] } : exit,
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
