import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return data(stripTypeScriptTypes(source, { mode: 'transform' }));
}
const rngUrl = await ts('../src/core/Rng.ts');
const encountersUrl = await ts('../src/world/WhiteboxEncounters.ts', {
  './WhiteboxGen': data('export function whiteboxPoint(plan,p){return {x:p[0]-plan.bounds[0]/2,z:p[1]-plan.bounds[1]/2};} export function whiteboxInsidePolygon(){return true;}'),
});
// 局流程 / 导演的真模块（敌人定义表留空：怪物表为空，导演不刷怪，只验证能随场景建起来）
const economyUrl = await ts('../src/progression/Economy.ts');
const rewardScaleUrl = await ts('../src/progression/RewardScale.ts', { './Economy': economyUrl });
const combatDirectorUrl = await ts('../src/world/CombatDirector.ts', {
  '../enemies/Registry': data('export function getEnemyDef(){return undefined;}'), '../progression/RewardScale': rewardScaleUrl,
});
const runRngUrl = await ts('../src/progression/RunRng.ts');
const stagePlanUrl = await ts('../src/progression/StagePlan.ts', { '../world/UnityStages': await ts('../src/world/UnityStages.ts') });
const runRouteUrl = await ts('../src/progression/RunRoute.ts', { './RunRng': runRngUrl, './StagePlan': stagePlanUrl });
const runPlanUrl = await ts('../src/progression/RunPlan.ts', { './RunRng': runRngUrl, './RunRoute': runRouteUrl, './StagePlan': stagePlanUrl });
const levelLayoutUrl = await ts('../src/world/LevelLayout.ts', { '../progression/RunRng': runRngUrl, '../progression/RunPlan': runPlanUrl });
// 关卡目标（灵火坛 / 据点首领，M6 三领主）：真模块；objectives.json 在 node 里读不到（fetch 相对路径）→ 关卡照旧终点战清关
const levelObjectivesUrl = await ts('../src/world/objectives/LevelObjectives.ts', {
  '../../progression/Economy': economyUrl, './SpiritAltar': await ts('../src/world/objectives/SpiritAltar.ts'),
});
const directorUrl = await ts('../src/world/StageDirector.ts', {
  './CombatDirector': combatDirectorUrl,
  './LevelLayout': levelLayoutUrl,
  './objectives/LevelObjectives': levelObjectivesUrl,
  './ChallengeEntrance': data('export class ChallengeEntrance{constructor(){}update(){}dispose(){}}'),
  '../core/Rng': rngUrl,
  '../assets/AssetLibrary': data('export const AssetLibrary={enabled:true};'),
  '../enemies/Waves': data('export function buildWaves(){return [];} export function buildEncounterWaves(){return [];}'),
  './ArenaBuilder': data(`import * as THREE from '${threeUrl}'; export function addCollision(){} export class ArenaView {group=new THREE.Group();artInspectionViews=[];artBrief='';update(){}dispose(){this.group.removeFromParent();}}`),
  './LevelGen': data('export function generateLevel(){throw new Error("Unexpected legacy map");}'),
  './NavGrid': data('export class NavGrid{}'),
  './UnityNavigation': data('export class UnityNavigation{}'),
  './Lava': data('export class LavaSystem{}'),
  './Portal': data('export class Portal{update(){}dispose(){}}'),
  './Themes': data('export function themeDef(id){return {id,name:id};} export function redesignThemeDef(id){return {id,name:id};}'),
  './WaveRunner': data('export const BOSS_LEAD=2; export class WaveRunner{} export function isBossId(){return true;}'),
  './AdventureBeacon': data('export class AdventureBeacon{constructor(){}}'),
  './WhiteboxMode': data('export function usesAuthoredLayout(){return false;} export function usesRedesignLayout(){return false;}'),
  './WhiteboxGen': data('export function generateWhitebox(){throw new Error("Unexpected whitebox");}'),
  './WhiteboxEncounters': encountersUrl,
  './UnitySceneData': data('export const UNITY_SCENE_DATA={};'),
  './UnitySceneAdapter': await ts('../src/world/UnitySceneAdapter.ts', {
    './WhiteboxEncounters': encountersUrl, '../core/math': await ts('../src/core/math.ts'),
    './CombatDirector': combatDirectorUrl, '../progression/Economy': economyUrl, './objectives/LevelObjectives': levelObjectivesUrl,
  }),
  './UnitySceneView': data(`import * as THREE from '${threeUrl}'; export class UnitySceneView {group=new THREE.Group();artInspectionViews=[];artBrief='';update(){}dispose(){this.group.removeFromParent();}}`),
  './unityAtmosphereDressing': data(`import * as THREE from '${threeUrl}'; export class UnityAtmosphereDressing {group=new THREE.Group();update(){}dispose(){this.group.removeFromParent();}}`),
  // 第一章美术重建层（src/world/desert/）：测试里不改文档
  './desert': data(`export const desertArt = () => null; export const patchDesertDocument = doc => doc; export const prepareDesertArt = async () => {}; export const desertDocument = () => null;`),
  './UnityLevelLibrary': data(`import {readFile} from 'node:fs/promises'; export const UnityLevelLibrary={scene:async id=>JSON.parse(await readFile(process.cwd()+'/public/assets/unity-levels/scenes/'+id+'.json','utf8'))}; export function unityHeights(){return new Float32Array();} export function unityPoint(v){return {x:v[0],y:v[1],z:v[2]};} export async function prepareUnityScene(){}`),
});
const { StageDirector } = await import(directorUrl);
const { Rng } = await import(rngUrl);
const manifest = JSON.parse(await readFile(new URL('../public/assets/unity-levels/manifest.json', import.meta.url), 'utf8'));

function context() {
  const handlers = new Map();
  return {
    rng: new Rng(1234), run: { seed: 1, difficulty: 1, stagesCleared: 0, essence: 0 },
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), stageGroup: new THREE.Group(), game: { state: 'playing', endRun() {} },
    player: { alive: true, position: new THREE.Vector3(), yaw: 0, radius: .4, height: 1.8,
      teleport(p, yaw) { this.position.copy(p); this.yaw = yaw; }, heal() {} },
    world: { clear() {}, segmentBlocked() { return false; }, addHeightfield() {} },
    nav: { build() {}, nearestWalkable(p, out) { out.copy(p); return false; },
      findPath(_from, to, out) { out.push(to.clone()); return true; },
      isWalkable() { return true; }, randomWalkable(center, _min, _max, out) { out.copy(center); return true; } },
    interact: { add() { return () => {}; } }, loot: { spawnChest() {}, spawnShop() {} },
    ui: { toast() {}, setBoss() {}, banner() {} }, audio: { play() {} }, fx: { ring() {}, shake() {}, groundWarning() {} },
    events: { on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
      emit(name, payload) { for (const fn of handlers.get(name) ?? []) fn(payload); } },
    enemies: { list: [], aliveCount() { return 0; }, spawn() {}, killAll() {} },
    runPlan: { nextOptions: () => [], isFinalStage: () => false, rewardLabel: r => r, stageLabel: () => '1-1' },
  };
}

for (const stage of manifest.stages.filter(stage => stage.available)) test(`${stage.id}: Unity scene initializes in StageDirector`, async () => {
  const ctx = context();
  const director = new StageDirector(ctx);
  await director.load({ chapter: stage.chapter - 1, index: stage.index, type: stage.kind, reward: stage.reward, theme: 'desert', map: stage.id });
  assert.ok(director.arena);
  assert.ok(director.whitebox);
  // 藏宝点的奖励串（Unity RewardRegistry）：带参数的武器奖励原样交给 LootSystem.grant（weapon:min=1 不再退成金币），强化照旧是强化，
  // 灵兽封印（M9 灵宠）原样，网页没有的退成灵石
  const doc = JSON.parse(await readFile(new URL(`../public/assets/unity-levels/scenes/${stage.id}.json`, import.meta.url), 'utf8'));
  const want = doc.caches.map(c => (c.reward.startsWith('weapon') || c.reward.split(':')[0] === 'pet' ? c.reward : ['scroll', 'heal', 'upgrade'].includes(c.reward.split(':')[0]) ? c.reward.split(':')[0] : 'coins'));
  assert.deepEqual(director.whitebox.plan.rewards.map(r => r.reward), want, `${stage.id}：藏宝点奖励`);
  director.unload();
});
