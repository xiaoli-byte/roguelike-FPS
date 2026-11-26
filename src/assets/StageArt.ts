/**
 * 进关前按本关读敌人 / 首领的美术资产，释放上一关用过、这一关用不到的（AssetLibrary 的 enemies / weapons 范围不整批读）。
 *
 * 2026-11-25 实测：开局把全部角色 / 武器读进来，游戏页渲染进程多占约 4.9 GB（解码后的贴图），其中 56 个敌人 / 首领约一半。
 * 一关只会出现本章名册里的十来种敌人和本关的首领，所以：
 *   要读的 = 这张图的波次敌人（含布局变体） ∪ 本章名册（首领召的小怪都在名册里：旱魃召沙魇 / 蝎弓手 / 邪飞天，火麒麟召炭童 / 火鸦）
 *           ∪ 本关首领（清单按形态分开绑：boss_kunpeng → boss_kunpeng_kun / _peng，所以按前缀匹配；表里没有这张图就读本章全部首领）。
 *   名册是生成的 TS 表 ./stageRosters（scripts/web/export-stage-rosters.mjs 从 public/assets/levels/<图>/level.json 汇总），运行时不读文件、
 *   不碰关卡库（2026-11-26 用户：「不能有任何依赖unity的代码」）。
 *   第四章的普通敌人走 PlateauFoeAdapter，模型由 world/plateau/play/assets 自己读，这里不重复读；第四章的领主走 BossBase，照常读。
 * 漏掉的（调试刷怪、旧地图的敌人）由 EnemyArt 补读：第一只用程序化模型，后面的就有美术。
 * 上一张图的关卡网格 / 贴图由关卡库在读新图时释放（UnityLevelLibrary.preload → releaseExcept），不在这里管。
 */
import type { StageNode } from '../core/types';
import { PLATEAU_ENEMY_IDS } from '../enemies/plateau';
import { AssetLibrary } from './AssetLibrary';
import { STAGE_ROSTERS } from './stageRosters';

export interface StageRosters {
  maps: Record<string, { chapter: number; enemies: string[]; bosses: string[] }>;
  chapters: Record<string, string[]>;
}

/**
 * 这一关要读的敌人绑定 id（清单 bind.id，bind.source = 'enemy'）。
 * known = 清单里全部敌人绑定 id（首领按前缀展开成各形态）；skip = 不经 AssetLibrary 读模型的敌人（第四章普通敌人）
 */
export function stageEnemyIds(o: {
  mapId: string;
  chapter: number;
  rosters: StageRosters;
  known: ReadonlySet<string>;
  skip: ReadonlySet<string>;
}): string[] {
  const map = o.rosters.maps[o.mapId];
  const enemies = new Set<string>([...(o.rosters.chapters[String(o.chapter)] ?? []), ...(map?.enemies ?? [])]);
  const bosses = new Set<string>(map
    ? map.bosses
    : Object.values(o.rosters.maps).filter(m => m.chapter === o.chapter).flatMap(m => m.bosses));
  const out = new Set<string>();
  for (const id of enemies) if (!o.skip.has(id) && o.known.has(id)) out.add(id);
  for (const boss of bosses) {
    if (o.known.has(boss)) out.add(boss);
    for (const id of o.known) if (id.startsWith(`${boss}_`)) out.add(id);
  }
  return [...out].sort();
}

/** 这一关用的地图编号（同 StageDirector.load：每局路线洗牌后槽位可能换图） */
export const stageMapId = (stage: StageNode): string => stage.map ?? `${stage.chapter + 1}-${stage.index + 1}`;

/**
 * 读这一关会出现的敌人 / 首领与 weapons 里的枪模，释放其余按需读的资产。在上一关的敌人清掉之后、这一关刷怪之前调（Game.loadStage）。
 * 返回读进来的敌人绑定 id（检视 / 测试用）。出错不抛：敌人退回程序化模型，关卡照常进
 */
export async function prepareStageArt(stage: StageNode, weapons: readonly string[] = []): Promise<string[]> {
  if (!AssetLibrary.enabled) return [];
  const mapId = stageMapId(stage);
  await AssetLibrary.preload('core');
  const ids = stageEnemyIds({
    mapId, chapter: stage.chapter + 1, rosters: STAGE_ROSTERS,
    known: new Set(AssetLibrary.knownBindIds('enemy')), skip: new Set<string>(PLATEAU_ENEMY_IDS),
  });
  // 武器：手上的、各英雄的初始武器（选英雄台一直摆着）留着；掉落 / 商店的用到时现读（WeaponModels.buildWorldModel）
  const keep = new Set([...AssetLibrary.boundIds('enemy', ids, stage.theme), ...AssetLibrary.boundIds('weapon', weapons)]);
  const released = AssetLibrary.releaseUnused(keep);
  await Promise.all([AssetLibrary.ensureBound('enemy', ids, stage.theme), AssetLibrary.ensureBound('weapon', weapons)]);
  console.info(`[assets] ${mapId}：敌人 / 首领美术 ${ids.length} 种、枪模 ${weapons.length} 把（共 ${keep.size} 个资产），释放 ${released} 个`);
  return ids;
}
