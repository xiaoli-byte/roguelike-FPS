import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function moduleFrom(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [from, to] of Object.entries(imports)) source = source.replaceAll(`'${from}'`, `'${to}'`);
  return dataModule(source);
}
const domUrl = await moduleFrom('../src/ui/dom.ts');
const designUrl = dataModule('export function getStageDesign(){return {title:"检视关卡",routeHint:"穿过回廊与侧路"};}');
const { AdventureHUD } = await import(await moduleFrom('../src/ui/AdventureHUD.ts', {
  './dom': domUrl, '../world/StageDesign': designUrl,
}));

function fakeElement(tag) {
  return { tag, children: [], style: {}, dataset: {}, hidden: false, textContent: '',
    appendChild(child) { this.children.push(child); }, setAttribute() {},
    getContext() { return new Proxy({}, { get: (target, key) => target[key] ?? (() => {}), set: (target, key, value) => { target[key] = value; return true; } }); },
  };
}
function field(root, className) {
  if (root.className === className) return root;
  for (const child of root.children) { const found = field(child, className); if (found) return found; }
}

test('adventure HUD navigates to the active real encounter, then returns to altar and exit', () => {
  globalThis.document = { createElement: fakeElement };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.Path2D = class {};
  const encounter = { id: 'guard', label: '回廊守卫', kind: 'approach', position: new THREE.Vector3(12, 0, 0), radius: 24, phase: 'undiscovered' };
  const info = { title: '回廊', routeHint: '循侧路接近守卫', phase: 'explore', objective: new THREE.Vector3(0, 0, -30),
    sites: [{ id: 'cache', position: new THREE.Vector3(8, 0, 0), label: '补给', visited: false }],
    encounters: [encounter], zones: [], paths: [],
  };
  const ctx = { stage: { stage: {}, exploration: info, arena: { minX: -42, maxX: 42, minZ: -42, maxZ: 42 }, waveIndex: 0, waveCount: 0 },
    run: { stage: {} }, player: { position: new THREE.Vector3(), yaw: 0 },
  };
  const hud = new AdventureHUD(fakeElement('div'), ctx);
  hud.update(0);
  assert.equal(field(hud.root, 'gf-adventure__stage').textContent, '回廊');
  assert.equal(field(hud.root, 'gf-adventure__route').textContent, '循侧路接近守卫');
  assert.equal(field(hud.root, 'gf-adventure__distance').textContent, '30 米');
  encounter.phase = 'active'; ctx.stage.waveCount = 2;
  hud.update(100);
  assert.equal(hud.root.dataset.phase, 'explore', 'route encounters do not pretend the altar was activated');
  assert.equal(hud.root.dataset.encounter, 'active');
  assert.equal(field(hud.root, 'gf-adventure__label').textContent, '回廊守卫');
  assert.equal(field(hud.root, 'gf-adventure__distance').textContent, '12 米');
  assert.equal(field(hud.root, 'gf-adventure__direction').style.transform, 'rotate(90deg)');
  encounter.phase = 'cleared'; hud.update(200);
  assert.equal(field(hud.root, 'gf-adventure__label').textContent, '灵火祭坛');
  assert.match(field(hud.root, 'gf-adventure__discovered').textContent, /1\/1 遭遇/);
  info.phase = 'cleared'; hud.update(300);
  assert.equal(field(hud.root, 'gf-adventure__instruction').textContent, '清场奖励 · 出口即将开启');
  info.exit = new THREE.Vector3(0, 0, 10); hud.update(400);
  assert.equal(field(hud.root, 'gf-adventure__label').textContent, '前往出口');
  assert.equal(field(hud.root, 'gf-adventure__distance').textContent, '10 米');
  ctx.stage.exploration = null; hud.update(500);
  assert.equal(hud.root.hidden, true, 'non-exploration stages hide the travel map');
});

async function isolatedFunction(path, name, nextName, bindings) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const start = source.indexOf(`function ${name}(`), end = source.indexOf(nextName, start);
  assert.ok(start >= 0 && end > start);
  return import(dataModule(`${bindings}\nexport ${stripTypeScriptTypes(source.slice(start, end), { mode: 'transform' })}`));
}

test('whitebox HUD renders floor rectangles and directs the player to the automatic final encounter', () => {
  globalThis.document = { createElement: fakeElement };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.Path2D = class {};
  const encounter = { id: 'final', label: '窑口守卫', position: new THREE.Vector3(20, 0, 0), phase: 'undiscovered' };
  const info = { title: '灰烬卸货场', phase: 'explore', automaticEncounters: true, objectiveLabel: '窑口守卫',
    objective: encounter.position, encounters: [encounter], sites: [], paths: [],
    floorRects: [{ minX: -10, maxX: 30, minZ: -5, maxZ: 5 }],
    zones: [{ label: '入口坪', position: new THREE.Vector3(), radius: 8 }],
  };
  const ctx = { stage: { stage: {}, exploration: info, arena: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 }, waveIndex: 0, waveCount: 0 },
    run: { stage: {} }, player: { position: new THREE.Vector3(), yaw: 0 },
  };
  const hud = new AdventureHUD(fakeElement('div'), ctx);
  hud.update(0);
  assert.equal(field(hud.root, 'gf-adventure__label').textContent, '窑口守卫');
  assert.equal(field(hud.root, 'gf-adventure__zone').textContent, '入口坪');
  assert.match(field(hud.root, 'gf-adventure__instruction').textContent, /自动触发/);
  info.phase = 'battle'; encounter.phase = 'active'; hud.update(100);
  assert.equal(hud.root.dataset.encounter, 'active');
  assert.equal(field(hud.root, 'gf-adventure__distance').textContent, '20 米');
  assert.equal(field(hud.root, 'gf-adventure__label').textContent, '窑口守卫');
  info.spawnBlocked = true; hud.update(200);
  assert.equal(field(hud.root, 'gf-adventure__instruction').textContent, '守卫等待入场 · 退回通道拉开距离');
  info.spawnBlocked = false; hud.update(300);
  assert.equal(field(hud.root, 'gf-adventure__instruction').textContent, '窑口守卫 · 击退拦路守卫');
});

test('boss arrival guides the player to supplies before directing them into the arena', () => {
  globalThis.document = { createElement: fakeElement };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.Path2D = class {};
  const boss = { id: 'BOSS', label: '首领战', position: new THREE.Vector3(80, 0, 0), phase: 'undiscovered' };
  const info = { title: '首领准备区', phase: 'explore', automaticEncounters: true, objectiveLabel: boss.label,
    objective: boss.position, encounters: [boss], sites: [], paths: [], zones: [],
    preparation: { room: 'preparation', label: '战前商人', position: new THREE.Vector3(10, 0, 0) } };
  const ctx = { stage: { stage: {}, exploration: info, arena: { minX: -30, maxX: 100, minZ: -30, maxZ: 30 }, waveIndex: 0, waveCount: 0 },
    run: { stage: {} }, player: { position: new THREE.Vector3(4, 0, 0), yaw: 0 } };
  const hud = new AdventureHUD(fakeElement('div'), ctx);
  hud.update(0);
  assert.equal(field(hud.root, 'gf-adventure__label').textContent, '战前商人');
  assert.equal(field(hud.root, 'gf-adventure__distance').textContent, '6 米');
  assert.match(field(hud.root, 'gf-adventure__instruction').textContent, /弹药、生命、护盾/);
  ctx.player.position.x = 35; hud.update(100);
  assert.equal(field(hud.root, 'gf-adventure__label').textContent, '首领战');
  assert.equal(field(hud.root, 'gf-adventure__distance').textContent, '45 米');
  info.phase = 'battle'; boss.phase = 'active'; hud.update(200);
  assert.equal(field(hud.root, 'gf-adventure__label').textContent, '首领战');
  assert.equal(hud.root.dataset.encounter, 'active');
});

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
