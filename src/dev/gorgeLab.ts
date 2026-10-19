/**
 * 雪域天路 · 4-2 大渡河·铁索桥峡谷（Y 形三江口）—— 网页检视页（plateau-lab.html?map=4-2）。
 * 地形、过河设施、地标、水、大鹗、动态环境都在 src/world/gorge/（和 4-1 共用的在 src/world/plateau/），
 * 这里只负责组装、输入（含溜索、急流）、机位、平面图和自动验收。设计见 docs/level-design/chuanzang-v1.md 第 3 节。
 */
import * as THREE from 'three';
import { MouseLookFilter } from '../core/MouseLookFilter';
import { buildMountains, buildSky, SKY } from '../world/plateau/backdrop';
import { FlagSystem } from '../world/plateau/flags';
import { GeoBuilder } from '../world/plateau/geo';
import { FIRE_STATE, type Animated, type MapIcon, type SmokeEmitter } from '../world/plateau/landmarks';
import { WORLD_UNIFORMS, materials } from '../world/plateau/materials';
import { buildMonsters } from '../world/plateau/monsters';
import { GrassField, buildStaticScatter } from '../world/plateau/scatter';
import { MONSTER_NAMES } from '../world/plateau/spec';
import { CollisionWorld, EYE, Walker } from '../world/plateau/walker';
import { Weather } from '../world/plateau/weather';
import { windAt } from '../world/plateau/wind';
import { GORGE_PEAKS, buildFarTerrain } from '../world/gorge/backdrop';
import { buildCrossings } from '../world/gorge/crossings';
import { buildDae } from '../world/gorge/dae';
import { Hazards } from '../world/gorge/hazards';
import { buildGorgeLandmarks } from '../world/gorge/landmarks';
import { buildNav } from '../world/gorge/nav';
import {
  ALERT_RADIUS, BANK_NAMES, ENCOUNTERS, FIRES_TO_UNLOCK, FLIGHT_PERCHES, FORD_CROSSING, LORD, MAP, POIS, ROAMER, ROCKFALL,
  SIGHT_CHECKS, SITES, SPANS, STONES, VIEWPOINTS, ZIPS, type MonsterKind, type Viewpoint,
} from '../world/gorge/spec';
import { GorgeTerrain, PATHS, fordWeight, macroAt, nearest } from '../world/gorge/terrain';
import { GorgeWater } from '../world/gorge/water';
import { FLYING_PETS, PetFlight, type FlyingPetId } from '../world/gorge/petFlight';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const t0 = performance.now();

// ───────────────────────────── 面板（换成 4-2 的选项） ─────────────────────────────

document.title = '雪域天路 · 4-2 大渡河峡谷';
$('title').textContent = '雪域天路 · 4-2';
$('subtitle').textContent = '大渡河·铁索桥峡谷（Y 形三江口，程序化白模）';
$('loading').textContent = '正在生成峡谷…';
$('storm-text').textContent = '风太大，回到峡谷里去';
document.querySelector('#panel .body')!.innerHTML = `
<h2>机位</h2><div id="views"></div>
<h2>选项</h2>
<label><input type="checkbox" id="opt-double"> 二段跳（鼯 / 额外跳跃秘卷）</label>
<label><input type="checkbox" id="opt-cloud" checked> 云影</label>
<label><input type="checkbox" id="opt-bound"> 显示坡顶线（黄）与起风线（红）</label>
<label><input type="checkbox" id="opt-coll"> 显示碰撞体</label>
<label><input type="checkbox" id="opt-scatter" checked> 草与野花</label>
<label><input type="checkbox" id="opt-monsters" checked> 雷魅白模（第四章怪物）</label>
<label><input type="checkbox" id="opt-dae" checked> 领主大鹗（演示循环）</label>
<label><input type="checkbox" id="opt-encounters" checked> 平面图显示遇敌区</label>
<label>随身灵宠 <select id="opt-pet"><option value="">无（没有会飞的灵宠）</option><option value="jingwei">精卫</option><option value="chongming" selected>重明鸟</option><option value="yinglong">应龙（神兽）</option></select></label>
<label>画质 <select id="opt-quality"><option value="high">高</option><option value="mid">中</option><option value="low">低</option></select>（帧率低时自动降分辨率）</label>
<label>天气 <select id="opt-weather"><option value="clear">晴</option><option value="storm">雷暴</option></select></label>
<label>点亮灵火 <input type="range" id="opt-fire" min="0" max="5" step="1" value="0"> <span id="fire-val">0/5</span></label>
<h2>动态环境</h2>
<div><button id="act-flood">涨水</button><label style="display:inline"><input type="checkbox" id="opt-flood"> 定时涨水</label></div>
<div><button id="act-gust">起一阵峡谷风</button><label style="display:inline"><input type="checkbox" id="opt-gust" checked> 定时阵风</label></div>
<div><button id="act-rock">落石</button><label style="display:inline"><input type="checkbox" id="opt-rock"> 定时落石</label> <button id="act-fix">修好栈道</button></div>
<div><button id="act-shock">雷桩放电（铁链通电）</button></div>
<label><input type="checkbox" id="opt-beacon"> 点燃碉楼烽火（大鹗进烟乱飞）</label>
<label><input type="checkbox" id="opt-wedge"> 打掉鹗巢危岩的木楔</label>
<h2>操作</h2>
<div class="row">点击画面锁定鼠标，Esc 解锁
WASD 移动　空格 跳　Shift 冲刺
E 在溜索起点挂上溜索，空格中途松手
F 在风马旗台上：灵宠飞渡（会飞的灵宠变大，抓着爪子飞下去，第三人称；鼠标 / A D 转向，W 俯冲，S 拉平，空格松手）
G 行走 / 飞行（飞行：空格升、C 降、Shift 加速）
M 平面图　1–9 机位
掉进急流不会死：被冲到下游河滩</div>
<h2>自动验收</h2><div class="row" id="checks">计算中…</div>
<h2>性能</h2><div class="row" id="perf">—</div>`;

// ───────────────────────────── 渲染器与场景 ─────────────────────────────

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(SKY.horizon, 260, 4200);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 7000);
const hemi = new THREE.HemisphereLight('#c4dbff', '#6a8a44', 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff2dc', 2.9);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 1000 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);

// ───────────────────────────── 组装 ─────────────────────────────

const terrain = new GorgeTerrain();
const terrainGroup = new THREE.Group();
for (const g of terrain.buildTiles(96)) {
  const m = new THREE.Mesh(g, materials().terrain);
  m.receiveShadow = true; m.castShadow = true;
  terrainGroup.add(m);
}
scene.add(terrainGroup);
const hazards = new Hazards(scene, terrain);   // 先装峡谷风场，经幡按它飘
const water = new GorgeWater();
scene.add(water.group);
const sky = buildSky();
scene.add(sky, buildMountains(GORGE_PEAKS), buildFarTerrain(terrain));
const world = new CollisionWorld(terrain);
const crossings = buildCrossings(terrain, world);
scene.add(crossings.group);
const flags = new FlagSystem();
const builder = new GeoBuilder();
const extra = new THREE.Group();
const anim: Animated[] = [];
const smokeEmitters: SmokeEmitter[] = [];
const icons: MapIcon[] = [];
const conductors: THREE.Vector3[] = [];
const props = buildGorgeLandmarks({ terrain, b: builder, flags, world, extra, anim, smoke: smokeEmitters, icons, conductors });
scene.add(builder.build('landmarks'), flags.build(), extra);
const occupied = (x: number, z: number): boolean => world.occupied(x, z) || terrain.roadNearest(x, z).d < 1.6;
const staticScatter = buildStaticScatter(terrain, occupied);
scene.add(staticScatter.group);
const grass = new GrassField(terrain, occupied);
scene.add(grass.group);
const groundTop = { heightAt: (x: number, z: number): number => world.groundAt(x, z, 1e4) };
const monsters = buildMonsters(groundTop, ENCOUNTERS, ROAMER);
scene.add(monsters.group);
const dae = buildDae(terrain);
scene.add(dae.group);
const fog = scene.fog as THREE.Fog;
const ironSet = new Set(crossings.ironConductors);
const weather = new Weather({
  scene, sun, hemi, fog, clearFog: { color: fog.color.clone(), near: fog.near, far: fog.far }, stormFog: new THREE.Color(SKY.stormHorizon),
}, terrain, [...conductors, ...crossings.ironConductors, ...crossings.conductors, ...props.thunderPosts.map(p => p.pos)]);
// 铁索桥是全图最大的导体：落点离桥 30 m 以内，七成被铁链引走
weather.attract = (x, z, r) => {
  let best: THREE.Vector3 | null = null, bd = 30;
  for (const c of crossings.ironConductors) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; } }
  return best && r < 0.7 ? best : null;
};
weather.onStrike = (_at, c) => {
  if (c && ironSet.has(c)) { crossings.electrify(1); showHint('雷劈中铁索桥，整座桥带电！'); }
};
hazards.onRockLand = (zone, at) => {
  if (zone.plank !== undefined && zone.seg !== undefined && !crossings.plankBroken(zone.plank, zone.seg)) {
    crossings.breakPlank(zone.plank, zone.seg, true);
    showHint(`落石砸断了${zone.name}的一段栈道，改走骡道`);
  }
  if (!walker.fly && Math.hypot(walker.feet.x - at.x, walker.feet.z - at.z) < 3 && Math.abs(walker.feet.y - at.y) < 4) showHint('被落石砸中！');
};
const buildMs = performance.now() - t0;

// ───────────────────────────── 行走、溜索、急流 ─────────────────────────────

const boundAt = (x: number, z: number): number => {
  if (x < terrain.minX || x > terrain.maxX || z < terrain.minZ || z > terrain.maxZ) return macroAt(x, z).bound;
  return terrain.basin[Math.round(z - terrain.minZ) * terrain.nx + Math.round(x - terrain.minX)];
};
const walker = new Walker(world, boundAt, MAP.softBoundary);

// 彩蛋 · 灵宠飞渡（3.8）：会飞的灵宠跟在身边；到风马旗台按 F
// 镜头避让：点在任何碰撞体里（房子、桥楼、旗杆、碉楼……，多留 0.6 m）就算挡住
const solidAt = (x: number, y: number, z: number): boolean => world.list.some(c => {
  if (c.off || y < c.y0 - 0.3 || y > c.y1 + 0.6) return false;
  if (c.kind === 'cyl') return Math.hypot(x - c.x, z - c.z) < c.r + 0.6;
  const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  return Math.abs(dx * cs - dz * sn) < c.hx + 0.6 && Math.abs(dx * sn + dz * cs) < c.hz + 0.6;
});
const flight = new PetFlight((x, z, y) => world.groundAt(x, z, y), (x, z) => terrain.heightAt(x, z), solidAt, boundAt, () => hazards.gust);
scene.add(flight.group);
const petParam = new URLSearchParams(location.search).get('pet');
const startPet = (petParam === '' || petParam === 'none') ? null : (petParam && petParam in FLYING_PETS ? petParam as FlyingPetId : 'chongming');
flight.setPet(startPet);
$<HTMLSelectElement>('opt-pet').value = startPet ?? '';
$<HTMLSelectElement>('opt-pet').onchange = e => {
  const v = (e.target as HTMLSelectElement).value as FlyingPetId | '';
  flight.setPet(v || null);
  showHint(v ? `随身灵宠：${FLYING_PETS[v].name}` : '没有会飞的灵宠：风马旗台上起不了飞');
};
function tryFlight(): void {
  if (flight.active || ride.zip >= 0 || walker.fly) return;
  if (!flight.petId) { showHint('要有会飞的灵宠（精卫、重明鸟、应龙）才能飞渡'); return; }
  if (!flight.canStart(walker.feet, walker.grounded)) { showHint('走到风马旗台（高处的风马旗杆旁）再按 F'); return; }
  if (flight.start(walker.feet, walker.yaw, camera.position, camera.getWorldDirection(new THREE.Vector3()))) showHint(`${flight.petName}化形——抓住它的爪子！`);
}
$<HTMLInputElement>('opt-double').onchange = e => { walker.doubleJump = (e.target as HTMLInputElement).checked; };

/** 溜索：E 挂上，沿钢索往下滑（越陡越快，顺风更快），空格松手，到头自动下到平台 */
const ride = { zip: -1, t: 0, v: 0 };
const swept = { t: 0 };
const BEACH = new THREE.Vector2(-42, 184);
const tmpV = new THREE.Vector3();

function tryZip(): void {
  if (ride.zip >= 0 || walker.fly) return;
  const k = crossings.zips.findIndex(z => !z.cut && Math.hypot(walker.feet.x - z.spec.from[0], walker.feet.z - z.spec.from[1]) < 4 && Math.abs(walker.feet.y - z.spec.from[2]) < 2.5);
  if (k < 0) { showHint('要站在溜索起点的木架下面才能挂上'); return; }
  ride.zip = k; ride.t = 0.015; ride.v = 3;
  crossings.zips[k].handle.userData.riding = true;
  showHint(`挂上${crossings.zips[k].spec.name}，空格松手`);
}

function updateRide(dt: number): void {
  const z = crossings.zips[ride.zip];
  const dir = tmpV.subVectors(z.b, z.a).normalize();
  const w = windAt(walker.feet.x, walker.feet.z);
  const tail = (w.dx * dir.x + w.dz * dir.z) * hazards.gust;
  const slope = (z.a.y - z.b.y) / z.length;
  ride.v = Math.min(18 + 6 * tail, Math.max(2.5, ride.v + (9.8 * slope + 5 * tail - 0.012 * ride.v * ride.v) * dt));
  ride.t += (ride.v * dt) / z.length;
  const p = z.at(Math.min(ride.t, 1));
  z.handle.position.copy(p);
  walker.feet.set(p.x, p.y - 2.9, p.z);
  walker.vy = 0;
  if (ride.t >= 0.985) {
    z.handle.userData.riding = false;
    ride.zip = -1;
    walker.place(z.spec.to[0], z.spec.to[1]);
    showHint(`到了：${BANK_NAMES[z.spec.banks[1]]}`);
  }
}

function dropZip(): void {
  if (ride.zip < 0) return;
  crossings.zips[ride.zip].handle.userData.riding = false;
  ride.zip = -1;
  walker.grounded = false; walker.vy = 0;
  showHint('松手了');
}

/** 掉进深水（水没过腰）：被急流往下游冲，2.5 秒后冲上河滩 */
function updateCurrent(dt: number): void {
  if (walker.fly || ride.zip >= 0) { swept.t = 0; return; }
  const wl = terrain.waterLevelAt(walker.feet.x, walker.feet.z);
  if (wl - walker.feet.y > 0.9) {
    swept.t += dt;
    let best = Infinity, tx = 0, tz = 1;
    for (const p of PATHS) {
      const n = nearest(p, walker.feet.x, walker.feet.z);
      if (n.d < best) { best = n.d; let i = 0; while (i < p.s.length - 2 && p.s[i + 1] < n.s) i++; tx = p.tx[i]; tz = p.tz[i]; }
    }
    walker.feet.x += tx * 6 * dt; walker.feet.z += tz * 6 * dt;
    walker.feet.y = Math.max(walker.feet.y, wl - 1.2);
    if (swept.t > 2.5) {
      swept.t = 0;
      walker.place(BEACH.x, BEACH.y);
      showHint('被急流冲到了下游河滩');
    }
  } else swept.t = 0;
}

function goTo(vp: Viewpoint): void {
  if (ride.zip >= 0) dropZip();
  walker.fly = !vp.walk;
  if (vp.walk) walker.place(vp.pos[0], vp.pos[2]);
  else walker.feet.set(vp.pos[0], vp.pos[1], vp.pos[2]);
  walker.lookAt(new THREE.Vector3(...vp.look));
  showHint(`${vp.name}${vp.walk ? '' : '（飞行）'}`);
}
VIEWPOINTS.forEach((vp, i) => {
  const btn = document.createElement('button');
  btn.innerHTML = i < 9 ? `<kbd>${i + 1}</kbd>${vp.name}` : vp.name;
  btn.onclick = () => { goTo(vp); canvas.focus(); };
  $('views').appendChild(btn);
});

// ───────────────────────────── 输入 ─────────────────────────────

const keys = new Set<string>();
let jumpPressed = false, dashPressed = false, releasePressed = false, bigMap = false;
addEventListener('keydown', e => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { if (flight.phase === 'glide') releasePressed = true; else if (ride.zip >= 0) dropZip(); else jumpPressed = true; } }
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) dashPressed = true;
  if (e.code === 'KeyE' && !e.repeat) tryZip();
  if (e.code === 'KeyF' && !e.repeat) tryFlight();
  if (e.code === 'KeyG' && !e.repeat) {
    if (ride.zip >= 0) dropZip();
    walker.fly = !walker.fly;
    if (walker.fly) walker.feet.y += EYE; else walker.place(walker.feet.x, walker.feet.z);
    showHint(walker.fly ? '飞行模式' : '行走模式');
  }
  if (e.code === 'KeyM' && !e.repeat) toggleMap();
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && VIEWPOINTS[+digit[1] - 1]) goTo(VIEWPOINTS[+digit[1] - 1]);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
// 鼠标视角：和正式游戏（core/Input）一样，优先申请原始输入，并用 MouseLookFilter 过滤 Chrome 在 Windows 上偶发的位移尖峰
const lookFilter = new MouseLookFilter();
const LOOK_SENS = 0.0022;
let ignoreMouseUntil = 0;
function look(dx: number, dy: number): void {
  if (!dx && !dy) return;
  walker.yaw -= dx * LOOK_SENS;
  walker.pitch = Math.max(-1.52, Math.min(1.52, walker.pitch - dy * LOOK_SENS));
}
async function lockPointer(): Promise<void> {
  try {
    await canvas.requestPointerLock({ unadjustedMovement: true });
  } catch (error) {
    if (error instanceof Error && error.name === 'NotSupportedError') {
      try { await canvas.requestPointerLock(); } catch { /* 忽略 */ }
    }
  }
}
canvas.addEventListener('click', () => { if (document.pointerLockElement !== canvas) void lockPointer(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  lookFilter.reset();
  ignoreMouseUntil = locked ? performance.now() + 50 : 0;
  if (!locked) keys.clear();
});
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas || performance.now() < ignoreMouseUntil) return;
  const d = lookFilter.sample(e.movementX, e.movementY, e.timeStamp);
  look(d.x, d.y);
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

let hintTimer = 0;
function showHint(text: string): void {
  const el = $('hint');
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => { el.style.opacity = '0'; }, 2600);
}

$('toggle').onclick = () => {
  const c = $('panel').classList.toggle('collapsed');
  $('toggle').textContent = c ? '展开' : '收起';
};
$<HTMLInputElement>('opt-cloud').onchange = e => { WORLD_UNIFORMS.uCloudOn.value = (e.target as HTMLInputElement).checked ? 1 : 0; };
$<HTMLInputElement>('opt-scatter').onchange = e => { grass.group.visible = (e.target as HTMLInputElement).checked; };
$<HTMLInputElement>('opt-monsters').onchange = e => { monsters.group.visible = (e.target as HTMLInputElement).checked; };
$<HTMLInputElement>('opt-dae').onchange = e => { dae.group.visible = (e.target as HTMLInputElement).checked; };
$<HTMLSelectElement>('opt-weather').onchange = e => { weather.stormy = (e.target as HTMLSelectElement).value === 'storm'; };
let showEncounters = true;
$<HTMLInputElement>('opt-encounters').onchange = e => { showEncounters = (e.target as HTMLInputElement).checked; layoutMap(); };
const altars = SITES.filter(s => s.altar).length;
const fireInput = $<HTMLInputElement>('opt-fire');
fireInput.max = String(altars);
const showFire = (): void => {
  FIRE_STATE.lit = Number(fireInput.value);
  $('fire-val').textContent = `${FIRE_STATE.lit}/${altars}${FIRE_STATE.lit >= FIRES_TO_UNLOCK ? '（古驿道已开）' : ''}`;
};
fireInput.oninput = showFire;
showFire();
$('act-flood').onclick = () => { hazards.triggerFlood(); showHint('上游放水了：河滩、跳石要被淹'); };
$<HTMLInputElement>('opt-flood').onchange = e => { hazards.floodAuto = (e.target as HTMLInputElement).checked; };
$('act-gust').onclick = () => { hazards.triggerGust(); showHint('峡谷起风了'); };
$<HTMLInputElement>('opt-gust').onchange = e => { hazards.gustAuto = (e.target as HTMLInputElement).checked; };
$('act-rock').onclick = () => hazards.triggerRock();
$<HTMLInputElement>('opt-rock').onchange = e => { hazards.rockAuto = (e.target as HTMLInputElement).checked; };
$('act-fix').onclick = () => { for (const z of ROCKFALL) if (z.plank !== undefined && z.seg !== undefined) crossings.breakPlank(z.plank, z.seg, false); showHint('栈道修好了'); };
$('act-shock').onclick = () => {
  crossings.electrify(1);
  for (const p of props.thunderPosts) p.charge = 0;
  showHint('雷桩放电：铁链通电约 4 秒');
};
$<HTMLInputElement>('opt-beacon').onchange = e => { for (const b of props.beacons) b.lit = (e.target as HTMLInputElement).checked; };
$<HTMLInputElement>('opt-wedge').onchange = e => { if (props.looseRock) props.looseRock.dropped = (e.target as HTMLInputElement).checked; };

// 画质：渲染分辨率上限、阴影贴图、草的流式半径；帧率持续偏低时自动降分辨率
const QUALITY = {
  high: { cap: Math.min(devicePixelRatio, 1.5), shadow: 4096, grass: 112 },
  mid: { cap: 1, shadow: 2048, grass: 90 },
  low: { cap: 0.75, shadow: 1024, grass: 64 },
} as const;
let ratioCap: number = QUALITY.high.cap, ratio = ratioCap;
function setRatio(r: number): void { ratio = r; renderer.setPixelRatio(r); renderer.setSize(innerWidth, innerHeight, false); }
$<HTMLSelectElement>('opt-quality').onchange = e => {
  const Q = QUALITY[(e.target as HTMLSelectElement).value as keyof typeof QUALITY];
  ratioCap = Q.cap; setRatio(Q.cap);
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  sun.shadow.map?.dispose();
  (sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
  grass.radius = Q.grass;
};
let adaptT = 0, adaptFrames = 0;
function adaptResolution(dt: number): void {
  if (document.hidden) return;
  adaptT += dt; adaptFrames++;
  if (adaptT < 1.5) return;
  const f = adaptFrames / adaptT;
  adaptT = 0; adaptFrames = 0;
  if (f < 48 && ratio > 0.6) setRatio(Math.max(0.6, ratio - 0.15));
  else if (f > 80 && ratio < ratioCap) setRatio(Math.min(ratioCap, ratio + 0.1));
}

// ───────────────────────────── 调试显示：坡顶线、碰撞体 ─────────────────────────────

function contour(level: number, color: string): THREE.LineSegments {
  const pts: number[] = [];
  const { nx, nz, minX, minZ, step, basin } = terrain;
  const stride = 2, S = stride * step;
  const P = (i: number, j: number): number => basin[j * nx + i] - level;
  const cross = (x0: number, z0: number, v0: number, x1: number, z1: number, v1: number): [number, number] => {
    const t = v0 / (v0 - v1);
    return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
  };
  for (let j = 0; j + stride < nz; j += stride) for (let i = 0; i + stride < nx; i += stride) {
    const x = minX + i * step, z = minZ + j * step;
    const a = P(i, j), b = P(i + stride, j), c = P(i + stride, j + stride), d = P(i, j + stride);
    const hits: [number, number][] = [];
    if ((a > 0) !== (b > 0)) hits.push(cross(x, z, a, x + S, z, b));
    if ((b > 0) !== (c > 0)) hits.push(cross(x + S, z, b, x + S, z + S, c));
    if ((c > 0) !== (d > 0)) hits.push(cross(x + S, z + S, c, x, z + S, d));
    if ((d > 0) !== (a > 0)) hits.push(cross(x, z + S, d, x, z, a));
    for (let k = 0; k + 1 < hits.length; k += 2) for (const [hx, hz] of [hits[k], hits[k + 1]]) pts.push(hx, terrain.heightAt(hx, hz) + 0.5, hz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
}
function colliderLines(): THREE.LineSegments {
  const pts: number[] = [];
  for (const c of world.list) {
    const ring: [number, number][] = [];
    if (c.kind === 'box') {
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
      for (const [lx, lz] of [[-c.hx, -c.hz], [c.hx, -c.hz], [c.hx, c.hz], [-c.hx, c.hz]]) ring.push([c.x + lx * cs + lz * sn, c.z - lx * sn + lz * cs]);
    } else for (let k = 0; k < 10; k++) ring.push([c.x + Math.cos((k / 10) * 6.283) * c.r, c.z + Math.sin((k / 10) * 6.283) * c.r]);
    for (let k = 0; k < ring.length; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length];
      pts.push(ax, c.y1, az, bx, c.y1, bz);
      if (c.kind === 'box' || k % 3 === 0) pts.push(ax, c.y0, az, ax, c.y1, az);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#39e6ff', depthTest: false, transparent: true, opacity: 0.7 }));
}
const lazy = <T extends THREE.Object3D>(make: () => T) => { let o: T | null = null; return (on: boolean) => { if (on && !o) scene.add(o = make()); if (o) o.visible = on; }; };
const showBound = lazy(() => { const g = new THREE.Group(); g.add(contour(0, '#ffe08a'), contour(MAP.softBoundary, '#ff5a3c')); return g; });
const showColl = lazy(colliderLines);
$<HTMLInputElement>('opt-bound').onchange = e => showBound((e.target as HTMLInputElement).checked);
$<HTMLInputElement>('opt-coll').onchange = e => showColl((e.target as HTMLInputElement).checked);

// ───────────────────────────── 平面图 ─────────────────────────────

const mapEl = $<HTMLCanvasElement>('map');
const MW = 360, MH = Math.round((MW * (terrain.maxZ - terrain.minZ)) / (terrain.maxX - terrain.minX));
const mapBase = document.createElement('canvas');
const toMap = (x: number, z: number): [number, number] => [((x - terrain.minX) / (terrain.maxX - terrain.minX)) * MW, ((z - terrain.minZ) / (terrain.maxZ - terrain.minZ)) * MH];
const px = (m: number): number => (m / (terrain.maxX - terrain.minX)) * MW;

function drawMapBase(scale: number): void {
  const W = Math.round(MW * scale), H = Math.round(MH * scale);
  mapBase.width = W; mapBase.height = H;
  const g = mapBase.getContext('2d')!;
  const img = g.createImageData(W, H);
  const L = new THREE.Vector3(-0.6, 0.7, -0.4).normalize();
  const water = [0.3, 0.55, 0.55];
  const cell = (terrain.maxX - terrain.minX) / W;
  for (let py = 0; py < H; py++) for (let pxi = 0; pxi < W; pxi++) {
    const x = terrain.minX + ((pxi + 0.5) / W) * (terrain.maxX - terrain.minX);
    const z = terrain.minZ + ((py + 0.5) / H) * (terrain.maxZ - terrain.minZ);
    const i = Math.min(terrain.nx - 1, Math.round(x - terrain.minX)), j = Math.min(terrain.nz - 1, Math.round(z - terrain.minZ));
    const k = j * terrain.nx + i;
    const e = 1.5;
    const gx = (terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z)) / (2 * e);
    const gz = (terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
    const n = new THREE.Vector3(-gx, 1, -gz).normalize();
    const shade = 0.5 + 0.65 * Math.max(0, n.dot(L));
    const dim = terrain.basin[k] > MAP.softBoundary ? 0.6 : 1;
    const wet = terrain.waterDepthAt(x, z) > 0.05;
    // 等高线：每 10 m 一条，每 50 m 加粗（垂直的图，平面图上要看得出高低）
    const y = terrain.h[k], band = Math.floor(y / 10), yr = terrain.heightAt(x + cell, z), yd = terrain.heightAt(x, z + cell);
    const line = !wet && (Math.floor(yr / 10) !== band || Math.floor(yd / 10) !== band);
    const thick = line && (Math.floor(yr / 50) !== Math.floor(y / 50) || Math.floor(yd / 50) !== Math.floor(y / 50));
    const o = (py * W + pxi) * 4;
    for (let c = 0; c < 3; c++) {
      let v = wet ? water[c] : Math.pow(terrain.colors[k * 3 + c], 1 / 2.2) * shade * dim;
      if (line) v *= thick ? 0.45 : 0.72;
      img.data[o + c] = Math.min(255, v * 255);
    }
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.save();
  g.scale(W / MW, H / MH);
  drawOverlay(g);
  g.restore();
}

function line(g: CanvasRenderingContext2D, pts: { x: number; z: number }[], color: string, width: number, dash: number[] = []): void {
  g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.setLineDash(dash); g.beginPath();
  pts.forEach((p, i) => { const [mx, my] = toMap(p.x, p.z); if (i) g.lineTo(mx, my); else g.moveTo(mx, my); });
  g.stroke(); g.setLineDash([]);
}
function label(g: CanvasRenderingContext2D, text: string, x: number, z: number, color: string, size = 10): void {
  const [mx, my] = toMap(x, z);
  g.font = `bold ${size}px "Microsoft YaHei",sans-serif`;
  g.textAlign = 'center';
  g.fillStyle = '#000b'; g.fillText(text, mx + 0.8, my + 0.8);
  g.fillStyle = color; g.fillText(text, mx, my);
}

function drawOverlay(g: CanvasRenderingContext2D): void {
  for (const t of terrain.trails) line(g, t.pts, '#f1e2bf', 1, [3, 2]);
  for (const pl of terrain.planks) line(g, pl.pts.map(([x, z]) => ({ x, z })), '#c98a4a', 1.8);
  for (const s of SPANS) {
    const a = { x: s.a[0], z: s.a[2] }, b = { x: s.b[0], z: s.b[2] };
    line(g, [a, b], s.kind === 'iron' ? '#1c1c22' : '#8a6a3c', s.kind === 'iron' ? 3.2 : 2.2);
    line(g, [a, b], s.kind === 'iron' ? '#9aa0aa' : '#d9b892', 1);
    label(g, s.name, (a.x + b.x) / 2 + 14, (a.z + b.z) / 2 + 9, '#ffffff', 9);
  }
  for (const z of ZIPS) {
    const a = { x: z.from[0], z: z.from[1] }, b = { x: z.to[0], z: z.to[1] };
    line(g, [a, b], '#6fe7ff', 1.3, [5, 2]);
    const [ax, ay] = toMap(a.x, a.z), [bx, by] = toMap(b.x, b.z);
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l;
    const mx = ax + dx * 0.6, my = ay + dy * 0.6;
    g.fillStyle = '#6fe7ff'; g.beginPath(); g.moveTo(mx + ux * 5, my + uy * 5); g.lineTo(mx - uy * 3, my + ux * 3); g.lineTo(mx + uy * 3, my - ux * 3); g.fill();
    label(g, `${z.name}（单向）`, (a.x + b.x) / 2, (a.z + b.z) / 2 - 6, '#a8f1ff', 8);
  }
  for (let i = 0; i < STONES.n; i++) {
    const t = (i + 0.5) / STONES.n;
    const [mx, my] = toMap(STONES.a[0] + (STONES.b[0] - STONES.a[0]) * t, STONES.a[1] + (STONES.b[1] - STONES.a[1]) * t);
    g.fillStyle = '#d8d0c2'; g.beginPath(); g.arc(mx, my, 1.1, 0, Math.PI * 2); g.fill();
  }
  label(g, '河滩涉水（涨水断）', FORD_CROSSING.x + 6, FORD_CROSSING.z + 2, '#bff3ff', 8);
  for (const z of ROCKFALL) {
    const [mx, my] = toMap(z.x, z.z);
    g.strokeStyle = '#ff9a3a'; g.lineWidth = 1; g.setLineDash([2, 2]);
    g.beginPath(); g.arc(mx, my, px(z.r), 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  }
  for (const s of SITES) {
    const [mx, my] = toMap(s.x, s.z);
    g.strokeStyle = s.kind === 'exit' ? '#7fe0ffcc' : '#f6e7c1cc'; g.lineWidth = 1; g.setLineDash([3, 2]);
    g.beginPath(); g.arc(mx, my, px(s.r), 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    if (s.altar) {
      const [ax, ay] = toMap(s.altar[0], s.altar[1]);
      g.fillStyle = '#000'; g.beginPath(); g.arc(ax, ay, 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5fdcff'; g.beginPath(); g.arc(ax, ay, 2.2, 0, Math.PI * 2); g.fill();
    }
    label(g, s.name, s.x, s.z - s.r * 0.2, s.kind === 'exit' ? '#9fe8ff' : '#fff6dc');
  }
  for (const p of POIS) label(g, p.name, p.x, p.z, '#ffe9a8', 8);
  // 灵宠飞渡的起飞台（风马旗台）
  for (const p of FLIGHT_PERCHES) {
    const [mx, my] = toMap(p.x, p.z);
    g.fillStyle = '#000'; g.beginPath(); g.moveTo(mx, my - 5); g.lineTo(mx + 4, my); g.lineTo(mx, my + 5); g.lineTo(mx - 4, my); g.closePath(); g.fill();
    g.fillStyle = '#8ff0ff'; g.beginPath(); g.moveTo(mx, my - 3.6); g.lineTo(mx + 2.8, my); g.lineTo(mx, my + 3.6); g.lineTo(mx - 2.8, my); g.closePath(); g.fill();
    label(g, '灵宠飞渡', p.x, p.z + 12, '#bff6ff', 8);
  }
  const marks: Partial<Record<MapIcon['kind'], string>> = { diaolou: '#d94f3a', house: '#c9a27b', flagGate: '#7fe0ff', daoban: '#a2442e', cave: '#3a2a20', stele: '#ff6ae0' };
  for (const ic of icons) {
    const color = marks[ic.kind];
    if (!color) continue;
    const [mx, my] = toMap(ic.x, ic.z);
    g.fillStyle = '#000'; g.fillRect(mx - 2.4, my - 2.4, 4.8, 4.8);
    g.fillStyle = color; g.fillRect(mx - 1.7, my - 1.7, 3.4, 3.4);
  }
  if (showEncounters) drawEncounters(g);
  g.fillStyle = '#fff'; g.font = 'bold 11px "Microsoft YaHei",sans-serif'; g.textAlign = 'center';
  g.fillText('北 ↑', MW - 16, 13);
}

/** 遇敌区（紫红）、啸獭哨兵警戒圈（橙）、穷奇路线与岩洞（紫）、峡谷风向（白箭头）、大鹗擂台与落脚点（金） */
function drawEncounters(g: CanvasRenderingContext2D): void {
  for (const e of ENCOUNTERS) {
    const [mx, my] = toMap(e.x, e.z);
    g.fillStyle = '#e03ac822'; g.strokeStyle = '#ff5ad8'; g.lineWidth = 1; g.setLineDash([2, 2]);
    g.beginPath(); g.arc(mx, my, px(e.r), 0, Math.PI * 2); g.fill(); g.stroke();
    for (const u of e.units.filter(u => u.sentinel)) {
      const [sx, sy] = toMap(u.at[0], u.at[2]);
      g.strokeStyle = '#ffae3a'; g.setLineDash([4, 3]);
      g.beginPath(); g.arc(sx, sy, px(ALERT_RADIUS), 0, Math.PI * 2); g.stroke();
    }
    g.setLineDash([]);
    for (const u of e.units) {
      const [ux, uy] = toMap(u.at[0], u.at[2]);
      g.fillStyle = u.sentinel ? '#ffae3a' : '#ff5ad8';
      g.beginPath(); g.arc(ux, uy, 1.6, 0, Math.PI * 2); g.fill();
    }
    const count = new Map<MonsterKind, number>();
    for (const u of e.units) count.set(u.kind, (count.get(u.kind) ?? 0) + 1);
    label(g, [...count].map(([k, n]) => `${MONSTER_NAMES[k]}${n > 1 ? '×' + n : ''}`).join(' '), e.x, e.z + e.r * 0.75, '#ffc2f2', 8);
  }
  g.strokeStyle = '#b48cff'; g.lineWidth = 1.4; g.setLineDash([5, 3]); g.beginPath();
  ROAMER.path.forEach(([x, z], i) => { const [mx, my] = toMap(x, z); if (i) g.lineTo(mx, my); else g.moveTo(mx, my); });
  g.closePath(); g.stroke(); g.setLineDash([]);
  label(g, '穷奇（地面游猎）', ROAMER.lair[0] + 10, ROAMER.lair[1] - 8, '#d6c2ff', 8);
  // 峡谷风：沿河往上游
  for (let z = terrain.minZ + 20; z < terrain.maxZ; z += 30) for (let x = terrain.minX + 20; x < terrain.maxX; x += 30) {
    if (boundAt(x, z) > 0) continue;
    const w = windAt(x, z), len = 4 + 8 * w.strength;
    const [ax, ay] = toMap(x, z), hx = ax + w.dx * len, hy = ay + w.dz * len;
    g.strokeStyle = `rgba(232,236,255,${0.25 + 0.6 * w.strength})`; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(hx, hy);
    g.lineTo(hx - w.dx * 2.6 - w.dz * 1.8, hy - w.dz * 2.6 + w.dx * 1.8); g.moveTo(hx, hy);
    g.lineTo(hx - w.dx * 2.6 + w.dz * 1.8, hy - w.dz * 2.6 - w.dx * 1.8); g.stroke();
  }
  const [lx, ly] = toMap(LORD.at[0], LORD.at[2]);
  g.strokeStyle = '#ffd34a'; g.lineWidth = 1.6;
  g.beginPath(); g.arc(lx, ly, px(LORD.r), 0, Math.PI * 2); g.stroke();
  for (const p of LORD.perches) {
    const [qx, qy] = toMap(p.at[0], p.at[2]);
    g.fillStyle = '#ffd34a'; g.beginPath(); g.arc(qx, qy, 2.6, 0, Math.PI * 2); g.fill();
  }
  label(g, '领主·大鹗（汇口上空）', LORD.at[0], LORD.at[2] - LORD.r + 8, '#ffe48a', 9);
}

function layoutMap(): void {
  drawMapBase(bigMap ? 2.6 : 1);
  mapEl.width = mapBase.width; mapEl.height = mapBase.height;
  if (!bigMap) { mapEl.style.width = `${MW}px`; mapEl.style.height = `${MH}px`; }
  else { mapEl.style.width = ''; mapEl.style.height = ''; }
}
function toggleMap(): void { bigMap = !bigMap; mapEl.classList.toggle('big', bigMap); layoutMap(); }
mapEl.onclick = toggleMap;

function drawMap(): void {
  const g = mapEl.getContext('2d')!;
  g.drawImage(mapBase, 0, 0);
  const scale = mapEl.width / MW;
  g.save(); g.scale(scale, scale);
  if (dae.group.visible) {
    const [dx, dy] = toMap(dae.pos.x, dae.pos.z);
    g.fillStyle = '#ffd34a'; g.strokeStyle = '#000'; g.beginPath(); g.arc(dx, dy, 3.4, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  const [mx, my] = toMap(walker.feet.x, walker.feet.z);
  g.translate(mx, my); g.rotate(-walker.yaw);
  g.fillStyle = walker.fly ? '#7fe0ff' : '#ffdf4a'; g.strokeStyle = '#000'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, -7); g.lineTo(4.5, 5); g.lineTo(0, 2.5); g.lineTo(-4.5, 5); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

// ───────────────────────────── 自动验收 ─────────────────────────────

function runChecks(): string {
  const tStart = performance.now();
  const out: string[] = [];
  const ok = (b: boolean, text: string): string => `<span class="${b ? 'ok' : 'bad'}">${b ? '✓' : '✗'} ${text}</span>`;
  const nav = buildNav(terrain, world.list, crossings.routes, crossings.zips.map(z => ({ id: z.spec.id, from: [z.spec.from[0], z.spec.from[1]], to: [z.spec.to[0], z.spec.to[1]] })),
    (x, z) => { const m = macroAt(x, z); return m.river === 'dd' && fordWeight(m.s) > 0.3; });
  const spawn = SITES[0], exit = SITES.find(s => s.kind === 'exit')!;
  const goal = (s: typeof SITES[number]): [number, number] => s.altar ? [s.altar[0], s.altar[1]] : [s.x, s.z];
  const fwd = nav.reach([spawn.x, spawn.z]);
  const st = nav.stats(fwd);
  out.push(`峡谷可玩区 ${(st.area / 10000).toFixed(1)} 公顷（坡顶以内、不含水面）；没有空气墙，过坡顶 ${MAP.softBoundary} m 起风`);
  out.push(ok(st.walkable >= 0.6, `可走 ${(st.walkable * 100).toFixed(0)}%`) + `（其余是陡于 40° 的崖），从出生点走得到 ${(st.reach * 100).toFixed(0)}%`);
  const miss = SITES.filter(s => !nav.hit(fwd, ...goal(s)));
  out.push(ok(!miss.length, miss.length ? `走不到：${miss.map(s => s.name).join('、')}` : '出生点走得到全部据点和出口'));
  const back = nav.reach([exit.x, exit.z], { reverse: true });
  const stuck = SITES.filter(s => s.kind !== 'exit' && !nav.hit(back, ...goal(s)));
  out.push(ok(!stuck.length, stuck.length ? `到不了出口：${stuck.map(s => s.name).join('、')}` : '每个据点都能走到出口（溜索单向也不会困住人）'));
  // 每一层：三块岸地的 L0–L3 都走得到
  const layerHit: Record<string, number> = {};
  for (let z = terrain.minZ + 2; z < terrain.maxZ; z += 4) for (let x = terrain.minX + 2; x < terrain.maxX; x += 4) {
    if (boundAt(x, z) > 0 || terrain.waterDepthAt(x, z) > 0.05) continue;
    const L = terrain.layerAt(x, z);
    const key = `${L.bank}${L.layer}`;
    if (nav.hit(fwd, x, z, 0)) layerHit[key] = (layerHit[key] ?? 0) + 1;
  }
  const layerLine = (['W', 'N', 'E'] as const).map(b => `${BANK_NAMES[b]} ${[0, 1, 2, 3].map(l => (layerHit[`${b}${l}`] ? `L${l}✓` : `L${l}✗`)).join(' ')}`).join('　');
  out.push(ok(!/✗/.test(layerLine), `分层：${layerLine}`));
  // 逐个断开过河 / 上下的路：所有据点仍然走得到、仍然能到出口
  const ids = [...crossings.routes.map(r => ({ id: r.id, name: r.name })), ...crossings.zips.map(z => ({ id: z.spec.id, name: z.spec.name })), { id: FORD_CROSSING.id, name: FORD_CROSSING.name }];
  const fails: string[] = [];
  for (const c of ids) {
    const f = nav.reach([spawn.x, spawn.z], { without: c.id });
    const bk = nav.reach([exit.x, exit.z], { without: c.id, reverse: true });
    const lost = SITES.filter(s => !nav.hit(f, ...goal(s)) || (s.kind !== 'exit' && !nav.hit(bk, ...goal(s))));
    if (lost.length) fails.push(`断了${c.name} → ${lost.map(s => s.name.slice(0, 1)).join('')}`);
  }
  out.push(ok(!fails.length, fails.length ? `断路检查：${fails.join('；')}` : `逐个断开 ${ids.length} 条过河 / 上下的路，每次都还能到全部据点和出口`));
  // 每两块岸地之间几种过法
  const pairs: Record<string, string[]> = {};
  const addPair = (banks: [string, string], name: string): void => { const k = [...banks].sort().join(''); (pairs[k] ??= []).push(name); };
  for (const s of SPANS) addPair(s.banks, s.name);
  for (const z of ZIPS) addPair(z.banks, z.name);
  addPair(STONES.banks, STONES.name);
  addPair(FORD_CROSSING.banks, FORD_CROSSING.name);
  const pairLine = Object.entries(pairs).map(([k, v]) => `${k.split('').map(b => BANK_NAMES[b as 'W']).join('—')} ${v.length} 种`).join('　');
  out.push(ok(Object.values(pairs).every(v => v.length >= 2) && Object.keys(pairs).length === 3, `过河：${pairLine}`));
  // 领主擂台：汇口上空，擂台下面能站人的地方
  let n = 0, hitN = 0;
  for (let dz = -LORD.r; dz <= LORD.r; dz += 6) for (let dx = -LORD.r; dx <= LORD.r; dx += 6) {
    if (dx * dx + dz * dz > LORD.r * LORD.r) continue;
    const x = LORD.at[0] + dx, z = LORD.at[2] + dz;
    if (terrain.waterDepthAt(x, z) > 0.05) continue;
    n++;
    if (nav.hit(fwd, x, z, 1)) hitN++;
  }
  out.push(ok(hitN / n >= 0.5, `领主·大鹗擂台（半径 ${LORD.r} m）：底下的岸地走得到 ${((hitN / n) * 100).toFixed(0)}%，三块岸地、桥和栈道都在擂台里`));
  // 骡道坡度、栈道台阶、溜索
  let maxGrade = 0, worst = '';
  for (const t of terrain.trails) for (let i = 0; i + 4 < t.pts.length; i += 2) {
    const a = t.pts[i], b = t.pts[i + 4];
    const gr = Math.abs(terrain.heightAt(b.x, b.z) - terrain.heightAt(a.x, a.z)) / Math.max(0.1, b.s - a.s);
    if (gr > maxGrade) { maxGrade = gr; worst = t.name; }
  }
  out.push(ok(maxGrade <= 0.58, `骡道 ${terrain.trails.length} 条，最陡 ${(Math.atan(maxGrade) * 180 / Math.PI).toFixed(0)}°（${worst}；≤ 30° 算好走，地形上限 40°）`));
  for (const z of crossings.zips) {
    let clear = Infinity;
    // 两头 15% 是起滑和落地平台（脚还踩在平台边上），不算
    for (let t = 0.15; t <= 0.9; t += 0.01) { const p = z.at(t); clear = Math.min(clear, p.y - 2.9 - Math.max(terrain.heightAt(p.x, p.z), terrain.waterLevelAt(p.x, p.z))); }
    const drop = z.a.y - z.b.y;
    out.push(ok(clear > 1.5, `${z.spec.name}：长 ${z.length.toFixed(0)} m，落差 ${drop.toFixed(0)} m（${(Math.atan(drop / z.length) * 180 / Math.PI).toFixed(0)}°），脚下最低离地 ${clear.toFixed(1)} m`));
  }
  for (const s of SIGHT_CHECKS) {
    const fy = terrain.heightAt(s.from[0], s.from[1]) + EYE;
    const to = s.rel ? [s.to[0], terrain.heightAt(s.to[0], s.to[2]) + s.to[1], s.to[2]] as const : s.to;
    const vis = terrain.lineOfSight(s.from[0], fy, s.from[1], to[0], to[1], to[2]);
    out.push(`${ok(vis, s.name)}（${Math.hypot(to[0] - s.from[0], to[2] - s.from[1]).toFixed(0)} m）`);
  }
  out.push(`（验收用时 ${(performance.now() - tStart).toFixed(0)} ms）`);
  return out.join('\n');
}

// ───────────────────────────── HUD ─────────────────────────────

const LAYER_NAMES = ['L0 河面', 'L1 中层台地', 'L2 高台', 'L3 坡顶'];
function where(x: number, z: number): string {
  let best = '', bd = Infinity;
  for (const s of [...SITES, ...POIS]) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < s.r && d < bd) { bd = d; best = s.name; }
  }
  return best || '峡谷';
}

let fpsAcc = 0, fpsN = 0, hudT = 0;
function updateHud(dt: number): void {
  fpsAcc += dt; fpsN++; hudT += dt;
  $('storm').style.opacity = String(walker.fly ? 0 : walker.wind * 0.85);
  $('storm-text').style.opacity = walker.wind > 0.25 && !walker.fly ? '1' : '0';
  if (hudT < 0.25) return;
  const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; hudT = 0;
  const f = walker.feet;
  const L = terrain.layerAt(f.x, f.z);
  const mode = flight.active ? `灵宠飞渡 · ${flight.petName}${flight.phase === 'glide' ? ` ${flight.speed.toFixed(0)} m/s　离地 ${flight.agl.toFixed(0)} m` : ''}` : ride.zip >= 0 ? `溜索 ${ride.v.toFixed(1)} m/s` : swept.t > 0 ? '被急流冲走！' : walker.fly ? '飞行' : walker.grounded ? '行走' : '空中';
  const env = [
    hazards.gust > 0.05 ? `峡谷风 ${(hazards.gust * 100).toFixed(0)}%` : '',
    hazards.floodLevel > 0.05 ? `涨水 +${hazards.floodLevel.toFixed(1)} m` : '',
    crossings.charge > 0.05 ? '铁索带电' : '',
    weather.level > 0.5 ? `雷桩攒电 ${(props.thunderPosts[0]?.charge * 100).toFixed(0)}%` : '',
  ].filter(Boolean).join('　');
  $('hud').innerHTML = `<b>${where(f.x, f.z)}</b>\n${BANK_NAMES[L.bank]} · ${LAYER_NAMES[L.layer]}　海拔 ${(MAP.altitudeBase + f.y - (walker.fly ? EYE : 0)).toFixed(0)} m\n${mode}${walker.doubleJump ? ' · 二段跳' : ''}　x ${f.x.toFixed(0)}  z ${f.z.toFixed(0)}${env ? '\n' + env : ''}${dae.group.visible ? `\n大鹗：${dae.state}` : ''}`;
  const info = renderer.info.render;
  $('perf').textContent = `${fps.toFixed(0)} FPS　绘制 ${info.calls} 次　${(info.triangles / 1000).toFixed(0)}k 三角形　分辨率 ${Math.round(ratio * 100)}%
生成 ${buildMs.toFixed(0)} ms　碰撞体 ${world.list.length}　经幡 ${flags.count}
草区块 ${grass.count}（${(grass.instances / 1000).toFixed(1)}k 丛）　杜鹃 ${staticScatter.stats.bushes}　石 ${staticScatter.stats.rocks}`;
}

// ───────────────────────────── 主循环 ─────────────────────────────

layoutMap();
// 地址参数（检视、截图、发链接用）：view=机位 id，panel=0 收起面板，dae=大鹗动作名的开头（先快进到那个动作）
const params = new URLSearchParams(location.search);
goTo(VIEWPOINTS.find(v => v.id === params.get('view')) ?? VIEWPOINTS[0]);
if (params.get('panel') === '0') { $('panel').classList.add('collapsed'); $('toggle').textContent = '展开'; }
$('loading').remove();
showHint('点击画面开始 · WASD 移动 · E 挂溜索 · G 飞行 · 1–9 机位');
setTimeout(() => { $('checks').innerHTML = runChecks(); }, 400);

const shadowCenter = new THREE.Vector3(), ahead = new THREE.Vector3();
const beaconSmoke: THREE.Vector3[] = [];
let last = performance.now(), time = 0, onIron = false;
let nearPerch: (typeof FLIGHT_PERCHES)[number] | null = null;
const eyeTmp = new THREE.Vector3();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(frozen ? 0 : dt, true);
  requestAnimationFrame(frame);
}

/** 一帧的模拟；render = false 时只推进逻辑（检视脚本在后台页面里按固定步长跑行走测试用） */
function tick(dt: number, render: boolean): void {
  time += dt;
  WORLD_UNIFORMS.uTime.value = time;
  const settled = lookFilter.flush(performance.now());
  look(settled.x, settled.y);
  hazards.update(dt, (x, z, y) => world.groundAt(x, z, y));
  water.flood = hazards.floodLevel;
  // 灵宠飞渡：飞的时候人挂在爪子下面，位置由飞渡决定；落地 / 松手后交还给行走
  const before = flight.phase;
  const inp = { forward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), right: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) };
  if (flight.phase === 'glide') walker.yaw -= inp.right * 1.1 * dt;
  if (flight.phase === 'glide' && flight.pull > 0.05) walker.yaw = flight.heading;
  const flightFeet = flight.update(time, { ...inp, yaw: walker.yaw, release: releasePressed, dt }, walker.eye(eyeTmp), walker.feet);
  releasePressed = false;
  if (before !== 'idle' && flight.phase === 'idle' && before === 'land') { walker.place(walker.feet.x, walker.feet.z); showHint('落地了'); }
  if (before === 'glide' && flight.phase === 'drop') { walker.grounded = false; walker.vy = -2; showHint('松手了'); }
  if (flight.near && !nearPerch && !flight.active) showHint(flight.petId ? `风马旗台：按 F 让${flight.petName}带你飞` : '风马旗台：要有会飞的灵宠才能飞渡');
  nearPerch = flight.near;
  if (flightFeet) { walker.feet.copy(flightFeet); walker.vy = 0; }
  else if (ride.zip >= 0) updateRide(dt);
  else {
    const fly = walker.fly;
    walker.update(dt, {
      forward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      right: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      up: fly ? (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0) : 0,
      jump: jumpPressed && !fly, dash: dashPressed && !fly,
      fast: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    });
    // 阵风：人在空中会被吹偏
    if (!fly && !walker.grounded && hazards.gust > 0.1) {
      const w = windAt(walker.feet.x, walker.feet.z), k = hazards.gust * 3.2 * dt;
      if (!world.blocked(walker.feet.x + w.dx * k, walker.feet.z + w.dz * k, walker.feet.y)) { walker.feet.x += w.dx * k; walker.feet.z += w.dz * k; }
    }
  }
  jumpPressed = dashPressed = false;
  if (!flightFeet) updateCurrent(dt);
  // 铁索带电：人在铁索桥上就被电
  const mid = crossings.ironMid;
  const onBridge = !walker.fly && Math.abs(walker.feet.y - mid.y) < 3 && Math.hypot(walker.feet.x - mid.x, walker.feet.z - mid.z) < 42;
  if (onBridge && crossings.charge > 0.3 && !onIron) showHint('铁索带电，被电了！先下桥');
  onIron = onBridge && crossings.charge > 0.3;
  $('storm').style.background = onIron ? 'radial-gradient(ellipse at center,#ff5ad800 30%,#ff5ad866 100%)' : '';
  // 雷桩：雷暴时慢慢攒电
  for (const p of props.thunderPosts) p.charge = Math.min(1, p.charge + (weather.level > 0.6 ? dt / 25 : 0));
  if (flight.thirdPerson) { camera.position.copy(flight.cam); camera.lookAt(flight.look); }
  else { walker.eye(camera.position); camera.rotation.set(walker.pitch, walker.yaw, 0, 'YXZ'); }
  // 滑翔越快视野越宽（飞渡结束后慢慢回到 72°）
  if (Math.abs(camera.fov - flight.fov) > 0.05) { camera.fov = flight.fov; camera.updateProjectionMatrix(); }
  sky.position.copy(camera.position);
  ahead.set(-Math.sin(walker.yaw), 0, -Math.cos(walker.yaw)).multiplyScalar(60).add(camera.position);
  shadowCenter.set(Math.round(ahead.x / 8) * 8, 0, Math.round(ahead.z / 8) * 8);
  shadowCenter.y = terrain.heightAt(shadowCenter.x, shadowCenter.z);
  sun.target.position.copy(shadowCenter);
  sun.position.copy(shadowCenter).addScaledVector(SKY.sunDir, 450);
  grass.update(camera.position);
  for (const a of anim) a.update(time, dt);
  crossings.update(time, dt, hazards.gust);
  monsters.update(time, dt);
  beaconSmoke.length = 0;
  for (const b of props.beacons) if (b.lit) beaconSmoke.push(b.pos.clone().add(new THREE.Vector3(6, 20, 0)));
  if (dae.group.visible) dae.update(time, dt, { bridgeCharge: crossings.charge, smoke: beaconSmoke });
  weather.update(dt, camera.position);
  if (!render) return;
  adaptResolution(dt);
  renderer.render(scene, camera);
  drawMap();
  updateHud(dt);
}
// fly=秒：站到起飞台、灵宠加载好就起飞，先快进这么多秒（截图检视第三人称用）；freeze=1 快进完定格
const flyParam = params.get('fly') ?? '';
// 地址里的「+」会被解成空格，两种都认
const flyLand = /^land[+ ]([\d.]+)$/.exec(flyParam);
const flyAt = flyLand ? 0.01 : Number(flyParam);
let frozen = false;
if (flyAt > 0) {
  const wait = setInterval(() => {
    if (!flight.canStart(walker.feet, true)) return;
    clearInterval(wait);
    walker.grounded = true;
    tryFlight();
    simulate(flyAt);
    // fly=land+秒：一直飞到开始落地，再快进这么多秒
    if (flyLand) { for (let n = 0; n < 4000 && flight.phase !== 'land'; n++) simulate(1 / 30); simulate(Number(flyLand[1])); }
    frozen = params.get('freeze') === '1';
  }, 300);
}
const daeAt = params.get('dae');
if (daeAt) { for (let n = 0; n < 400 && !dae.state.startsWith(daeAt); n++) simulate(0.5); simulate(1); }
requestAnimationFrame(frame);

/** 检视脚本用：按住一些键、按固定步长跑 seconds 秒（页面在后台时浏览器不跑动画帧） */
function simulate(seconds: number, hold: string[] = [], dt = 1 / 60): void {
  for (const k of hold) keys.add(k);
  for (let t = 0; t < seconds; t += dt) tick(dt, false);
  for (const k of hold) keys.delete(k);
}

// 调试入口（检视用）
Object.assign(window, { gorge: { scene, camera, renderer, terrain, world, walker, goTo, VIEWPOINTS, crossings, hazards, weather, dae, props, monsters, macroAt, PATHS, runChecks, buildMs, ride, tryZip, dropZip, simulate, swept, flight, tryFlight, jump: () => { jumpPressed = true; }, render: () => { renderer.render(scene, camera); drawMap(); updateHud(0.3); } } });
