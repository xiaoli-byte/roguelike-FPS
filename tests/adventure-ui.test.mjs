// M11c 第二期（2026-11-21）改过：旧的行旅图 AdventureHUD（src/ui/AdventureHUD.ts，角落小地图 + 方向箭头）换成了 Unity 的
// 罗盘条 + M 键全图（src/ui/MapMarkers.ts、hud/CompassStrip.ts、screens/MapScreen.ts）。原来对 AdventureHUD 和 dom 的打桩测试
// 改成对同一批关卡状态（AdventureInfo）测新的地点表：地点从哪来、目标怎么选、距离与方位。后面两条检视页的测试没动。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function moduleFrom(path) {
  return dataModule(stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' }));
}
const { MapModel, bearing, headingOf, deltaAngle } = await import(await moduleFrom('../src/ui/MapMarkers.ts'));

function context(info, type = 'combat', player = new THREE.Vector3()) {
  return { stage: { stage: { type }, exploration: info, cleared: false }, enemies: { list: [] }, player: { position: player, yaw: 0 } };
}
const targetOf = model => model.markers.target && { name: model.markers.target.name, verb: model.markers.targetVerb, meters: Math.round(model.markers.target.distance) };

test('travel map targets the nearest required site, the active real encounter, then the altar and the exit', () => {
  const encounter = { id: 'guard', label: '回廊守卫', kind: 'approach', position: new THREE.Vector3(12, 0, 0), radius: 24, phase: 'undiscovered' };
  const info = { title: '回廊', routeHint: '循侧路接近守卫', phase: 'explore', objective: new THREE.Vector3(0, 0, -30),
    sites: [{ id: 'cache', position: new THREE.Vector3(8, 0, 0), label: '补给', visited: false }],
    encounters: [encounter], zones: [], paths: [],
  };
  const ctx = context(info);
  const model = new MapModel();
  model.update(ctx);
  assert.equal(model.snap.title, '回廊');
  assert.deepEqual(model.markers.all.map(m => `${m.kind}:${m.name}`), ['site:回廊守卫', 'cache:补给', 'altar:灵火祭坛']);
  assert.deepEqual(targetOf(model), { name: '回廊守卫', verb: '前往', meters: 12 }, 'the nearest unfinished required site is the target');
  assert.ok(model.markers.all.every(m => m.discovered || m.kind === 'altar'), 'site within 36 m and cache within 18 m are discovered; the altar 30 m away is on the edge');
  encounter.phase = 'active';
  model.update(ctx);
  assert.deepEqual(targetOf(model), { name: '回廊守卫', verb: '交战中', meters: 12 });
  assert.equal(Math.round(deltaAngle(headingOf(ctx.player.yaw), bearing(0, 0, 12, 0))), 90, 'a target due east sits 90° clockwise of a north-facing player');
  encounter.phase = 'cleared';
  model.update(ctx);
  assert.deepEqual(targetOf(model), { name: '灵火祭坛', verb: '点亮', meters: 30 }, 'route encounters do not pretend the altar was activated');
  assert.deepEqual(model.markers.progress('site', true), { done: 1, total: 1 });
  info.phase = 'cleared';
  model.update(ctx);
  assert.equal(model.markers.target, null, 'nothing to point at until the exit opens');
  info.exit = new THREE.Vector3(0, 0, 10);
  model.update(ctx);
  assert.deepEqual(targetOf(model), { name: '出口', verb: '前往出口', meters: 10 });
  assert.equal(Math.round(Math.abs(bearing(0, 0, 0, 10))), 180, '+Z is south on the web map');
  ctx.stage.exploration = null;
  model.update(ctx);
  assert.equal(model.markers.all.length, 0, 'non-exploration stages have no markers');
});

test('whitebox stages mark the automatic final encounter as a site and keep it as the target while fighting', () => {
  const encounter = { id: 'final', label: '窑口守卫', kind: 'approach', position: new THREE.Vector3(20, 0, 0), radius: 14, phase: 'undiscovered' };
  const info = { title: '灰烬卸货场', phase: 'explore', automaticEncounters: true, objectiveLabel: '窑口守卫',
    objective: encounter.position, encounters: [encounter], sites: [], paths: [],
    floorRects: [{ minX: -10, maxX: 30, minZ: -5, maxZ: 5 }],
    zones: [{ label: '入口坪', position: new THREE.Vector3(), radius: 8 }],
  };
  const ctx = context(info);
  const model = new MapModel();
  model.update(ctx);
  assert.deepEqual(model.markers.all.map(m => m.kind), ['site'], 'whitebox stages have no altar marker');
  assert.deepEqual(targetOf(model), { name: '窑口守卫', verb: '前往', meters: 20 });
  assert.deepEqual(model.markers.discovery(), { found: 1, total: 1 });
  info.phase = 'battle'; encounter.phase = 'active';
  model.update(ctx);
  assert.deepEqual(targetOf(model), { name: '窑口守卫', verb: '交战中', meters: 20 });
});

test('boss stages show the supply camp once near it and point at the boss arena', () => {
  const boss = { id: 'BOSS', label: '首领战', kind: 'approach', position: new THREE.Vector3(80, 0, 0), radius: 20, phase: 'undiscovered' };
  const info = { title: '首领准备区', phase: 'explore', automaticEncounters: true, objectiveLabel: boss.label,
    objective: boss.position, encounters: [boss], sites: [], paths: [], zones: [],
    preparation: { room: 'preparation', label: '战前商人', position: new THREE.Vector3(10, 0, 0) } };
  const ctx = context(info, 'boss', new THREE.Vector3(4, 0, 0));
  const model = new MapModel();
  model.update(ctx);
  assert.deepEqual(model.markers.all.map(m => `${m.kind}:${m.name}`), ['camp:战前商人', 'boss:首领战'], 'the final encounter of a boss stage is the boss arena, not a site');
  const camp = model.markers.all[0], arena = model.markers.all[1];
  assert.equal(camp.discovered, true); assert.equal(Math.round(camp.distance), 6);
  assert.equal(arena.discovered, false, 'the arena is 76 m away');
  assert.equal(model.markers.visible(arena), true, 'the target shows without being discovered');
  assert.deepEqual(targetOf(model), { name: '首领战', verb: '首领', meters: 76 });
  ctx.player.position.x = 35;
  model.update(ctx);
  assert.deepEqual(targetOf(model), { name: '首领战', verb: '首领', meters: 45 });
  assert.equal(arena.discovered, true, 'within the arena edge + 30 m');
  ctx.enemies.list.push({ isBoss: true, alive: true });
  model.update(ctx);
  assert.deepEqual(targetOf(model), { name: '首领战', verb: '首领战', meters: 45 });
});

async function isolatedFunction(path, name, nextName, bindings) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const start = source.indexOf(`function ${name}(`), end = source.indexOf(nextName, start);
  assert.ok(start >= 0 && end > start);
  return import(dataModule(`${bindings}\nexport ${stripTypeScriptTypes(source.slice(start, end), { mode: 'transform' })}`));
}

test('both inspection selectors address all 15 chapter positions and default the last to boss', async () => {
  globalThis.__inspectionControls = { theme: { value: 'desert' }, index: { value: '0' }, type: { value: 'auto' } };
  const common = 'const themes=["desert","frost","inferno"],c=globalThis.__inspectionControls;';
  const details = await isolatedFunction('../src/dev/detailsLab.ts', 'selectedSceneStage', 'function refreshStageChoices',
    `${common}const sceneThemes=themes,subject=c.theme,sceneStage=c.index,sceneType=c.type;`);
  const tour = await isolatedFunction('../src/dev/adventureLab.ts', 'selectedStage', 'refreshStageChoices();',
    `${common}const theme=c.theme,stageIndex=c.index,stageType=c.type;`);
  for (const [chapter, theme] of ['desert', 'frost', 'inferno'].entries()) for (let index = 0; index < 5; index++) {
    const c = globalThis.__inspectionControls; c.theme.value = theme; c.index.value = String(index); c.type.value = 'auto';
    for (const stage of [details.selectedSceneStage(), tour.selectedStage()]) {
      assert.equal(stage.chapter, chapter); assert.equal(stage.index, index); assert.equal(stage.theme, theme);
      assert.equal(stage.type, index === 4 ? 'boss' : 'combat');
    }
    for (const type of ['combat', 'elite', 'shop', 'treasure', 'boss']) {
      c.type.value = type;
      assert.equal(details.selectedSceneStage().type, type); assert.equal(tour.selectedStage().type, type);
    }
  }
});

test('encounter walkthrough searches inside trigger range with body clearance and refuses distant fallback', async () => {
  let blocked = true, teleported = null, notifications = 0;
  globalThis.__tourNav = { game: { state: 'playing' }, nav: { isWalkable(x) { return !blocked && x < -.2; } }, ui: { toast() { notifications++; } } };
  globalThis.__tourGo = position => { teleported = position; };
  const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
  const { goNear } = await isolatedFunction('../src/dev/adventureLab.ts', 'goNear', 'altarButton.onclick',
    `import * as THREE from '${threeUrl}';const ctx=globalThis.__tourNav,game=ctx.game,go=globalThis.__tourGo;`);
  const point = new THREE.Vector3();
  goNear(point, 4);
  assert.equal(teleported, null); assert.equal(notifications, 1);
  blocked = false; goNear(point, 4);
  assert.ok(teleported); assert.ok(teleported.distanceTo(point) < 4);
  assert.ok([[0, 0], [.5, 0], [-.5, 0], [0, .5], [0, -.5]]
    .every(([x, z]) => globalThis.__tourNav.nav.isWalkable(teleported.x + x, teleported.z + z)));
});
