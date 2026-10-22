/**
 * 雪域天路 · 4-1 折多垭口·天路草甸（开放盆地）—— 网页检视页（plateau-lab.html）。
 * 不依赖游戏主循环：地形、地标、经幡、散布、水、烟、远景都在 src/world/plateau/ 里，
 * 这里只负责组装、输入、机位、平面图和自动验收。设计见 docs/level-design/chuanzang-v1.md。
 */
import * as THREE from 'three';
import { MouseLookFilter } from '../core/MouseLookFilter';
import { buildFarTerrain, buildMountains, buildSky, SKY } from '../world/plateau/backdrop';
import { FlagSystem } from '../world/plateau/flags';
import { Smoke, buildWater } from '../world/plateau/fx';
import { GeoBuilder } from '../world/plateau/geo';
import { FIRE_STATE, buildLandmarks, type Animated, type MapIcon, type SmokeEmitter } from '../world/plateau/landmarks';
import { WORLD_UNIFORMS, materials } from '../world/plateau/materials';
import { buildLords } from '../world/plateau/lords';
import { buildMonsters } from '../world/plateau/monsters';
import { GrassField, buildStaticScatter } from '../world/plateau/scatter';
import { ALERT_RADIUS, ENCOUNTERS, FIRES_TO_UNLOCK, GONGGA, LORDS, MAP, MONSTER_NAMES, POIS, ROAMER, SIGHT_CHECKS, SITES, VIEWPOINTS, WIND, type MonsterKind, type Viewpoint } from '../world/plateau/spec';
import { Terrain, basinDistance } from '../world/plateau/terrain';
import { Weather } from '../world/plateau/weather';
import { CollisionWorld, EYE, Walker } from '../world/plateau/walker';
import { WindStreaks, buildWindMarks, windAt } from '../world/plateau/wind';
import { PlayMode } from '../world/plateau/play/game';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const t0 = performance.now();

// ───────────────────────────── 渲染器与场景 ─────────────────────────────

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(SKY.horizon, 260, 4600);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 7000);

const hemi = new THREE.HemisphereLight('#c4dbff', '#6a8a44', 1.25);
scene.add(hemi);
// 阴影相机跟着镜头走（±140 m），地图再大阴影也一样清楚
const sun = new THREE.DirectionalLight('#fff2dc', 2.9);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 1000 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);

// ───────────────────────────── 组装 ─────────────────────────────

const terrain = new Terrain();
const terrainGroup = new THREE.Group();
terrainGroup.name = 'terrain';
for (const g of terrain.buildTiles(96)) {
  const m = new THREE.Mesh(g, materials().terrain);
  m.receiveShadow = true;
  m.castShadow = true;
  terrainGroup.add(m);
}
scene.add(terrainGroup);

const world = new CollisionWorld(terrain);
const builder = new GeoBuilder();
const flags = new FlagSystem();
const extra = new THREE.Group();
const anim: Animated[] = [];
const smokeEmitters: SmokeEmitter[] = [];
const icons: MapIcon[] = [];
const conductors: THREE.Vector3[] = [];
buildLandmarks({ terrain, b: builder, flags, world, extra, anim, smoke: smokeEmitters, icons, conductors });
scene.add(builder.build('landmarks'), flags.build(), extra);

const occupied = (x: number, z: number): boolean => world.occupied(x, z);
const staticScatter = buildStaticScatter(terrain, occupied);
scene.add(staticScatter.group);
const grass = new GrassField(terrain, occupied);
scene.add(grass.group);
scene.add(buildWater(terrain));
const smoke = new Smoke(smokeEmitters);
scene.add(smoke.points);
const sky = buildSky();
scene.add(sky, buildMountains(), buildFarTerrain(terrain));
const monsters = buildMonsters(terrain);
scene.add(monsters.group);
const lords = buildLords(terrain);
scene.add(lords.group);
const windMarks = buildWindMarks(terrain);
const windStreaks = new WindStreaks(terrain);
scene.add(windMarks.group, windStreaks.lines);
const fog = scene.fog as THREE.Fog;
const weather = new Weather({
  scene, sun, hemi, fog, clearFog: { color: fog.color.clone(), near: fog.near, far: fog.far }, stormFog: new THREE.Color(SKY.stormHorizon),
}, terrain, conductors);

const buildMs = performance.now() - t0;

// ───────────────────────────── 行走与机位 ─────────────────────────────

const walker = new Walker(world);
const optDouble = $<HTMLInputElement>('opt-double');
optDouble.onchange = () => { walker.doubleJump = optDouble.checked; };

function goTo(vp: Viewpoint): void {
  walker.fly = !vp.walk;
  if (vp.walk) walker.place(vp.pos[0], vp.pos[2]);
  else walker.feet.set(vp.pos[0], vp.pos[1], vp.pos[2]);
  walker.lookAt(new THREE.Vector3(...vp.look));
  showHint(`${vp.name}${vp.walk ? '' : '（飞行）'}`);
}

const viewsEl = $('views');
VIEWPOINTS.forEach((vp, i) => {
  const btn = document.createElement('button');
  btn.innerHTML = i < 9 ? `<kbd>${i + 1}</kbd>${vp.name}` : vp.name;
  btn.onclick = () => { goTo(vp); canvas.focus(); };
  viewsEl.appendChild(btn);
});

// ───────────────────────────── 输入 ─────────────────────────────

const keys = new Set<string>();
let jumpPressed = false, dashPressed = false, bigMap = false;
/** 游玩模式（射击、雷魅、灵火、领主战）；null = 检视模式 */
let play: PlayMode | null = null;
let firing = false, reloadPressed = false, skillQ = false, skillE = false, anyKey = false, pick = 0;
addEventListener('mousedown', e => { if (e.button === 0 && document.pointerLockElement === canvas) firing = true; });
addEventListener('mouseup', e => { if (e.button === 0) firing = false; });
addEventListener('keydown', e => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jumpPressed = true; }
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) dashPressed = true;
  if (e.code === 'KeyR' && !e.repeat) reloadPressed = true;
  if (e.code === 'KeyQ' && !e.repeat) skillQ = true;
  if (e.code === 'KeyE' && !e.repeat) skillE = true;
  if (!e.repeat) anyKey = true;
  if (e.code === 'KeyG' && !e.repeat && !play) {
    walker.fly = !walker.fly;
    if (walker.fly) walker.feet.y += EYE;
    else walker.place(walker.feet.x, walker.feet.z);
    showHint(walker.fly ? '飞行模式' : '行走模式');
  }
  if (e.code === 'KeyM' && !e.repeat) toggleMap();
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && VIEWPOINTS[+digit[1] - 1] && !play) goTo(VIEWPOINTS[+digit[1] - 1]);
  if (digit && play && +digit[1] <= 3) pick = +digit[1];
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
// 鼠标视角：和正式游戏（core/Input）一样，优先申请原始输入（绕开系统鼠标加速），
// 并用 MouseLookFilter 过滤 Chrome 在 Windows 上偶发的位移尖峰——否则视角会突然跳一下或往一边漂。
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
    // 不支持原始输入时退回普通锁定；内嵌预览面板里不允许锁定，安静忽略
    if (error instanceof Error && error.name === 'NotSupportedError') {
      try { await canvas.requestPointerLock(); } catch { /* 忽略 */ }
    }
  }
}
canvas.addEventListener('click', () => { if (document.pointerLockElement !== canvas) void lockPointer(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  lookFilter.reset();
  // 锁定时浏览器会重定位光标，短暂忽略这段过渡事件
  ignoreMouseUntil = locked ? performance.now() + 50 : 0;
  if (!locked) { keys.clear(); firing = false; }
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
  hintTimer = window.setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

$('toggle').onclick = () => {
  const c = $('panel').classList.toggle('collapsed');
  $('toggle').textContent = c ? '展开' : '收起';
};
$<HTMLInputElement>('opt-cloud').onchange = e => { WORLD_UNIFORMS.uCloudOn.value = (e.target as HTMLInputElement).checked ? 1 : 0; };
$<HTMLInputElement>('opt-scatter').onchange = e => { grass.group.visible = (e.target as HTMLInputElement).checked; };
$<HTMLInputElement>('opt-kui').onchange = e => { lords.kuiAlways = (e.target as HTMLInputElement).checked; };
$<HTMLInputElement>('opt-monsters').onchange = e => { monsters.group.visible = lords.group.visible = (e.target as HTMLInputElement).checked; };
// 画质：渲染分辨率上限、阴影贴图、草的流式半径。帧率持续偏低时在上限以下自动降分辨率，富余时再升回去
const QUALITY = {
  high: { cap: Math.min(devicePixelRatio, 1.5), shadow: 4096, grass: 112 },
  mid: { cap: 1, shadow: 2048, grass: 90 },
  low: { cap: 0.75, shadow: 1024, grass: 64 },
} as const;
let ratioCap: number = QUALITY.high.cap, ratio = ratioCap;
function setRatio(r: number): void {
  ratio = r;
  renderer.setPixelRatio(r);
  renderer.setSize(innerWidth, innerHeight, false);
}
function applyQuality(q: keyof typeof QUALITY): void {
  const Q = QUALITY[q];
  ratioCap = Q.cap;
  setRatio(Q.cap);
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  sun.shadow.map?.dispose();
  (sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
  grass.radius = Q.grass;
}
$<HTMLSelectElement>('opt-quality').onchange = e => applyQuality((e.target as HTMLSelectElement).value as keyof typeof QUALITY);
let adaptT = 0, adaptFrames = 0;
function adaptResolution(dt: number): void {
  if (document.hidden) return;
  adaptT += dt; adaptFrames++;
  if (adaptT < 1.5) return;
  const fpsNow = adaptFrames / adaptT;
  adaptT = 0; adaptFrames = 0;
  if (fpsNow < 48 && ratio > 0.6) setRatio(Math.max(0.6, ratio - 0.15));
  else if (fpsNow > 80 && ratio < ratioCap) setRatio(Math.min(ratioCap, ratio + 0.1));
}
$<HTMLSelectElement>('opt-weather').onchange = e => { weather.stormy = (e.target as HTMLSelectElement).value === 'storm'; };
let showEncounters = true;
$<HTMLInputElement>('opt-encounters').onchange = e => { showEncounters = (e.target as HTMLInputElement).checked; layoutMap(); };
const altars = SITES.filter(s => s.altar).length;
const fireInput = $<HTMLInputElement>('opt-fire');
fireInput.max = String(altars);
const showFire = (): void => {
  FIRE_STATE.lit = Number(fireInput.value);
  $('fire-val').textContent = `${FIRE_STATE.lit}/${altars}${FIRE_STATE.lit >= FIRES_TO_UNLOCK ? '（出口已开）' : ''}`;
};
fireInput.oninput = showFire;
showFire();

// ───────────────────────────── 调试显示：盆地轮廓与软边界、碰撞体 ─────────────────────────────

function contour(level: number, color: string, stride = 2): THREE.LineSegments {
  const pts: number[] = [];
  const { nx, nz, minX, minZ, step, basin } = terrain;
  const P = (i: number, j: number): number => basin[j * nx + i] - level;
  const cross = (x0: number, z0: number, v0: number, x1: number, z1: number, v1: number): [number, number] => {
    const t = v0 / (v0 - v1);
    return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
  };
  const S = stride * step;
  for (let j = 0; j + stride < nz; j += stride) for (let i = 0; i + stride < nx; i += stride) {
    const x = minX + i * step, z = minZ + j * step;
    const a = P(i, j), b = P(i + stride, j), c = P(i + stride, j + stride), d = P(i, j + stride);
    const hits: [number, number][] = [];
    if ((a > 0) !== (b > 0)) hits.push(cross(x, z, a, x + S, z, b));
    if ((b > 0) !== (c > 0)) hits.push(cross(x + S, z, b, x + S, z + S, c));
    if ((c > 0) !== (d > 0)) hits.push(cross(x + S, z + S, c, x, z + S, d));
    if ((d > 0) !== (a > 0)) hits.push(cross(x, z + S, d, x, z, a));
    for (let k = 0; k + 1 < hits.length; k += 2)
      for (const [hx, hz] of [hits[k], hits[k + 1]]) pts.push(hx, terrain.heightAt(hx, hz) + 0.5, hz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
}

function colliderLines(): THREE.LineSegments {
  const pts: number[] = [];
  const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): void => { pts.push(ax, ay, az, bx, by, bz); };
  for (const c of world.list) {
    const ring: [number, number][] = [];
    if (c.kind === 'box') {
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
      for (const [lx, lz] of [[-c.hx, -c.hz], [c.hx, -c.hz], [c.hx, c.hz], [-c.hx, c.hz]]) ring.push([c.x + lx * cs + lz * sn, c.z - lx * sn + lz * cs]);
    } else {
      for (let k = 0; k < 10; k++) ring.push([c.x + Math.cos((k / 10) * 6.283) * c.r, c.z + Math.sin((k / 10) * 6.283) * c.r]);
    }
    for (let k = 0; k < ring.length; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length];
      seg(ax, c.y1, az, bx, c.y1, bz);
      seg(ax, c.y0, az, bx, c.y0, bz);
      if (c.kind === 'box' || k % 3 === 0) seg(ax, c.y0, az, ax, c.y1, az);
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

function drawMapBase(scale: number): void {
  const W = Math.round(MW * scale), H = Math.round(MH * scale);
  mapBase.width = W; mapBase.height = H;
  const g = mapBase.getContext('2d')!;
  const img = g.createImageData(W, H);
  const L = new THREE.Vector3(-0.6, 0.7, -0.4).normalize();
  const water = [0.18, 0.62, 0.72];
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const x = terrain.minX + ((px + 0.5) / W) * (terrain.maxX - terrain.minX);
    const z = terrain.minZ + ((py + 0.5) / H) * (terrain.maxZ - terrain.minZ);
    const i = Math.min(terrain.nx - 1, Math.round((x - terrain.minX) / terrain.step));
    const j = Math.min(terrain.nz - 1, Math.round((z - terrain.minZ) / terrain.step));
    const k = j * terrain.nx + i;
    const e = 1.5;
    const gx = (terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z)) / (2 * e);
    const gz = (terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
    const n = new THREE.Vector3(-gx, 1, -gz).normalize();
    const shade = 0.55 + 0.6 * Math.max(0, n.dot(L));
    const dim = terrain.basin[k] > MAP.softBoundary ? 0.6 : 1;
    const wet = terrain.waterDepthAt(x, z) > 0.05;
    const o = (py * W + px) * 4;
    for (let c = 0; c < 3; c++) {
      const v = wet ? water[c] : Math.pow(terrain.colors[k * 3 + c], 1 / 2.2);
      img.data[o + c] = Math.min(255, v * 255 * (wet ? 1 : shade) * dim);
    }
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.save();
  g.scale(W / MW, H / MH);
  const path = (pts: { x: number; z: number }[], color: string, width: number, dash: number[] = []): void => {
    g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.setLineDash(dash); g.beginPath();
    pts.forEach((p, i) => { const [mx, my] = toMap(p.x, p.z); if (i) g.lineTo(mx, my); else g.moveTo(mx, my); });
    g.stroke(); g.setLineDash([]);
  };
  path(terrain.river, '#6cc4dc', 2.2);
  for (const t of terrain.trails) path(t, '#f1e2bf', 1, [3, 2]);
  path(terrain.road, '#f3e3c0', 2.4);
  path(terrain.road, '#a88a5e', 1.1);
  g.textAlign = 'center';
  const label = (text: string, x: number, z: number, color: string, size = 10): void => {
    const [mx, my] = toMap(x, z);
    g.font = `bold ${size}px "Microsoft YaHei",sans-serif`;
    g.fillStyle = '#000b'; g.fillText(text, mx + 0.8, my + 0.8);
    g.fillStyle = color; g.fillText(text, mx, my);
  };
  for (const s of SITES) {
    const [mx, my] = toMap(s.x, s.z);
    g.strokeStyle = s.kind === 'exit' ? '#7fe0ffcc' : '#f6e7c1cc'; g.lineWidth = 1; g.setLineDash([3, 2]);
    g.beginPath(); g.arc(mx, my, (s.r / (terrain.maxX - terrain.minX)) * MW, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    if (s.altar) {
      const [ax, ay] = toMap(s.altar[0], s.altar[1]);
      g.fillStyle = '#000'; g.beginPath(); g.arc(ax, ay, 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5fdcff'; g.beginPath(); g.arc(ax, ay, 2.2, 0, Math.PI * 2); g.fill();
    }
    label(s.name, s.x, s.z - s.r * 0.15, s.kind === 'exit' ? '#9fe8ff' : '#fff6dc');
  }
  for (const p of POIS) label(p.name, p.x, p.z, '#ffe9a8', 8);
  if (showEncounters) drawEncounters(g, label);
  const marks: Partial<Record<MapIcon['kind'], string>> = { diaolou: '#d94f3a', diaolouRuin: '#a0614e', chorten: '#ffffff', stupa: '#ffffff', lhatse: '#e8b43c', house: '#c9a27b', flagGate: '#7fe0ff', daoban: '#4f8fe0', glacierSnout: '#cfeaf5', blackTent: '#222222' };
  for (const ic of icons) {
    const color = marks[ic.kind];
    if (!color) continue;
    const [mx, my] = toMap(ic.x, ic.z);
    g.fillStyle = '#000'; g.fillRect(mx - 2.4, my - 2.4, 4.8, 4.8);
    g.fillStyle = color; g.fillRect(mx - 1.7, my - 1.7, 3.4, 3.4);
  }
  g.fillStyle = '#fff'; g.font = 'bold 11px "Microsoft YaHei",sans-serif';
  g.fillText('北 ↑', MW - 16, 13);
  g.restore();
}

/** 遇敌区：领地（红）、啸獭哨兵警戒圈（橙）、穷奇巡视路线与巢穴（紫）、风向（白箭头）、领主擂台（金） */
function drawEncounters(g: CanvasRenderingContext2D, label: (text: string, x: number, z: number, color: string, size?: number) => void): void {
  const px = (m: number): number => (m / (terrain.maxX - terrain.minX)) * MW;
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
    label([...count].map(([k, n]) => `${MONSTER_NAMES[k]}${n > 1 ? '×' + n : ''}`).join(' '), e.x, e.z + e.r * 0.75, '#ffc2f2', 8);
  }
  g.strokeStyle = '#b48cff'; g.lineWidth = 1.4; g.setLineDash([5, 3]); g.beginPath();
  ROAMER.path.forEach(([x, z], i) => { const [mx, my] = toMap(x, z); if (i) g.lineTo(mx, my); else g.moveTo(mx, my); });
  g.closePath(); g.stroke(); g.setLineDash([]);
  const [lx, ly] = toMap(ROAMER.lair[0], ROAMER.lair[1]);
  g.fillStyle = '#b48cff'; g.beginPath(); g.arc(lx, ly, 3, 0, Math.PI * 2); g.fill();
  label(`${MONSTER_NAMES[ROAMER.kind]}巢穴`, ROAMER.lair[0], ROAMER.lair[1] - 10, '#d6c2ff', 8);
  // 风向：盆地里每 30 m 一支箭头，越靠近飞廉越长越不透明
  for (let z = terrain.minZ + 20; z < terrain.maxZ; z += 30) for (let x = terrain.minX + 20; x < terrain.maxX; x += 30) {
    if (basinDistance(x, z) > 0) continue;
    const w = windAt(x, z), len = 5 + 9 * w.strength;
    const [ax, ay] = toMap(x, z), hx = ax + w.dx * len, hy = ay + w.dz * len;
    g.strokeStyle = `rgba(232,236,255,${0.25 + 0.6 * w.strength})`; g.lineWidth = 0.8 + w.strength;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(hx, hy);
    g.lineTo(hx - w.dx * 2.6 - w.dz * 1.8, hy - w.dz * 2.6 + w.dx * 1.8); g.moveTo(hx, hy);
    g.lineTo(hx - w.dx * 2.6 + w.dz * 1.8, hy - w.dz * 2.6 - w.dx * 1.8); g.stroke();
  }
  // 领主擂台（金色），雷暴领主加「雷暴」字样
  for (const L of LORDS) {
    const [mx, my] = toMap(L.at[0], L.at[2]);
    g.strokeStyle = '#ffd34a'; g.lineWidth = 1.6;
    g.beginPath(); g.arc(mx, my, px(L.r), 0, Math.PI * 2); g.stroke();
    const [qx, qy] = toMap(...(L.perch ?? [L.at[0], L.at[2]]));
    g.fillStyle = '#ffd34a'; g.beginPath(); g.arc(qx, qy, 3.2, 0, Math.PI * 2); g.fill();
    label(`领主·${L.name}${L.storm ? '（雷暴）' : ''}`, L.at[0], L.at[2] - L.r - 4, '#ffe48a', 9);
  }
}

function toggleMap(): void {
  bigMap = !bigMap;
  mapEl.classList.toggle('big', bigMap);
  layoutMap();
}

function layoutMap(): void {
  drawMapBase(bigMap ? 2.6 : 1);
  mapEl.width = mapBase.width; mapEl.height = mapBase.height;
  if (!bigMap) { mapEl.style.width = `${MW}px`; mapEl.style.height = `${MH}px`; }
  else { mapEl.style.width = ''; mapEl.style.height = ''; }
}
mapEl.onclick = toggleMap;

function drawMap(): void {
  const g = mapEl.getContext('2d')!;
  g.drawImage(mapBase, 0, 0);
  const scale = mapEl.width / MW;
  const [mx, my] = toMap(walker.feet.x, walker.feet.z);
  g.save();
  g.scale(scale, scale);
  g.translate(mx, my);
  g.rotate(-walker.yaw);
  g.fillStyle = walker.fly ? '#7fe0ff' : '#ffdf4a';
  g.strokeStyle = '#000'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, -7); g.lineTo(4.5, 5); g.lineTo(0, 2.5); g.lineTo(-4.5, 5); g.closePath();
  g.fill(); g.stroke();
  g.restore();
}

// ───────────────────────────── 自动验收 ─────────────────────────────

/** 开放度：2 m 网格上，坡度 ≤ 40° 且水深 ≤ 1.1 m 的格子算能走；从出生点做连通搜索 */
function openness(): { basin: number; walkable: number; reach: number; reached: (x: number, z: number) => boolean } {
  const S = 2;
  const W = Math.floor((terrain.maxX - terrain.minX) / S), H = Math.floor((terrain.maxZ - terrain.minZ) / S);
  const walk = new Uint8Array(W * H), inBasin = new Uint8Array(W * H), seen = new Uint8Array(W * H);
  const lim = (40 * Math.PI) / 180;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = terrain.minX + (i + 0.5) * S, z = terrain.minZ + (j + 0.5) * S;
    const gi = Math.round((x - terrain.minX) / terrain.step), gj = Math.round((z - terrain.minZ) / terrain.step);
    const d = terrain.basin[gj * terrain.nx + gi];
    if (d <= 0) inBasin[j * W + i] = 1;
    if (d <= MAP.softBoundary && terrain.slopeAt(x, z) <= lim && terrain.waterDepthAt(x, z) <= 1.1) walk[j * W + i] = 1;
  }
  const spawn = SITES[0];
  const si = Math.floor((spawn.x - terrain.minX) / S), sj = Math.floor((spawn.z - terrain.minZ) / S);
  const queue = [sj * W + si];
  seen[queue[0]] = 1;
  while (queue.length) {
    const c = queue.pop()!;
    const i = c % W, j = Math.floor(c / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni;
      if (seen[n] || !walk[n]) continue;
      seen[n] = 1; queue.push(n);
    }
  }
  let basin = 0, walkable = 0, reach = 0;
  for (let k = 0; k < W * H; k++) if (inBasin[k]) { basin++; if (walk[k]) walkable++; if (seen[k]) reach++; }
  const reached = (x: number, z: number): boolean => {
    const ci = Math.floor((x - terrain.minX) / S), cj = Math.floor((z - terrain.minZ) / S);
    for (let r = 0; r <= 3; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const ni = ci + di, nj = cj + dj;
      if (ni >= 0 && nj >= 0 && ni < W && nj < H && seen[nj * W + ni]) return true;
    }
    return false;
  };
  return { basin: basin * S * S, walkable: walkable / basin, reach: reach / basin, reached };
}

function runChecks(): string {
  const lines: string[] = [];
  const op = openness();
  const ok = (b: boolean, text: string): string => `<span class="${b ? 'ok' : 'bad'}">${b ? '✓' : '✗'} ${text}</span>`;
  lines.push(`盆地 ${(op.basin / 10000).toFixed(1)} 公顷；盆地内没有空气墙，离盆地 ${MAP.softBoundary} m 外起风雪`);
  lines.push(ok(op.walkable >= 0.75, `盆地可走 ${(op.walkable * 100).toFixed(0)}%`) + `，从出生点走得到 ${(op.reach * 100).toFixed(0)}%`);
  const unreachable = SITES.filter(s => !op.reached(s.altar?.[0] ?? s.x, s.altar?.[1] ?? s.z));
  lines.push(ok(unreachable.length === 0, unreachable.length ? `走不到：${unreachable.map(s => s.name).join('、')}` : '全部据点和出口都走得到'));
  // 领主擂台：中心和擂台内 60% 的格子都要走得到（擂台不能是孤岛或半边悬崖）；水里出来的领主只看湖岸
  for (const L of LORDS) {
    let n = 0, hit = 0;
    for (let dz = -L.r; dz <= L.r; dz += 4) for (let dx = -L.r; dx <= L.r; dx += 4) {
      if (dx * dx + dz * dz > L.r * L.r) continue;
      n++;
      if (op.reached(L.at[0] + dx, L.at[2] + dz)) hit++;
    }
    const center = L.water || op.reached(L.at[0], L.at[2]);
    const where = L.water ? '中心在湖里，湖岸' : center ? '中心可达，' : '中心走不到，';
    lines.push(ok(center && hit / n >= 0.6, `领主·${L.name}擂台：${where}可走 ${((hit / n) * 100).toFixed(0)}%`));
  }
  const spawn = SITES[0];
  const far = SITES.filter(s => s.kind !== 'spawn').map(s => `${s.name.slice(0, 1)} ${Math.hypot(s.x - spawn.x, s.z - spawn.z).toFixed(0)}`);
  lines.push(`出生点直线距离（m）：${far.join('　')}`);
  const R = terrain.road;
  let maxGrade = 0;
  for (let i = 0; i < R.length - 1; i++) {
    const ds = R[i + 1].s - R[i].s;
    if (ds > 0.3) maxGrade = Math.max(maxGrade, Math.atan(Math.abs(R[i + 1].e - R[i].e) / ds) * (180 / Math.PI));
  }
  lines.push(`天路 ${R[R.length - 1].s.toFixed(0)} m（跑完约 ${(R[R.length - 1].s / 7.5 / 60).toFixed(1)} 分钟），最大坡度 ${maxGrade.toFixed(1)}°；盘山挡土墙 ${terrain.walls.filter(w => w.kind === 'cut').length} 段；桥 ${terrain.bridges.length} 座`);
  for (const s of SIGHT_CHECKS) {
    const fy = terrain.heightAt(s.from[0], s.from[1]) + EYE;
    const to = s.to === 'gongga' ? [GONGGA.x, GONGGA.height - 260, GONGGA.z] as const
      : s.rel ? [s.to[0], terrain.heightAt(s.to[0], s.to[2]) + s.to[1], s.to[2]] as const : s.to;
    const vis = terrain.lineOfSight(s.from[0], fy, s.from[1], to[0], to[1], to[2]);
    lines.push(`${ok(vis, s.name)}（${Math.hypot(to[0] - s.from[0], to[2] - s.from[1]).toFixed(0)} m）`);
  }
  return lines.join('\n');
}
$('checks').innerHTML = runChecks();

// ───────────────────────────── HUD ─────────────────────────────

function where(x: number, z: number): string {
  let best = '', bd = Infinity;
  for (const s of [...SITES, ...POIS]) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < s.r && d < bd) { bd = d; best = s.name; }
  }
  return best || '草甸';
}

let fpsAcc = 0, fpsN = 0, hudT = 0, fps = 0;
function updateHud(dt: number): void {
  fpsAcc += dt; fpsN++;
  hudT += dt;
  $('storm').style.opacity = String(walker.fly ? 0 : walker.wind * 0.85);
  $('storm-text').style.opacity = walker.wind > 0.25 && !walker.fly ? '1' : '0';
  if (hudT < 0.25) return;
  fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; hudT = 0;
  const f = walker.feet;
  const y = f.y - (walker.fly ? EYE : 0);
  $('hud').innerHTML = `<b>${where(f.x, f.z)}</b>\n海拔 ${(MAP.altitudeBase + y).toFixed(0)} m\n${walker.fly ? '飞行' : walker.grounded ? '行走' : '空中'}${walker.doubleJump ? ' · 二段跳' : ''}　x ${f.x.toFixed(0)}  z ${f.z.toFixed(0)}`;
  const info = renderer.info.render;
  $('perf').textContent = `${fps.toFixed(0)} FPS　绘制 ${info.calls} 次　${(info.triangles / 1000).toFixed(0)}k 三角形　分辨率 ${Math.round(ratio * 100)}%
生成 ${buildMs.toFixed(0)} ms　碰撞体 ${world.list.length}　经幡 ${flags.count}
草区块 ${grass.count}（${(grass.instances / 1000).toFixed(1)}k 丛）　杜鹃 ${staticScatter.stats.bushes}　石 ${staticScatter.stats.rocks}`;
}

// ───────────────────────────── 主循环 ─────────────────────────────

layoutMap();
goTo(VIEWPOINTS[0]);
$('loading').remove();
showHint('点击画面开始 · WASD 移动 · G 飞行 · 1–9 机位');

/** 进入游玩模式：加载正式模型、摆怪；检视用的白模、天气 / 灵火滑块、飞行和机位都停用 */
async function startPlay(): Promise<void> {
  if (play) return;
  $('play-choice')?.remove();
  monsters.group.visible = false;
  lords.group.visible = false;
  $('panel').classList.add('collapsed');
  $('toggle').textContent = '展开';
  for (const id of ['opt-fire', 'opt-weather', 'opt-kui', 'opt-monsters']) $<HTMLInputElement>(id).disabled = true;
  weather.stormy = false;
  walker.fly = false;
  const mode = new PlayMode(scene, camera, terrain, world, walker, weather, conductors);
  play = mode;
  await mode.start();
  showHint('左键射击 · Q 尾焰火灵 · E 燃爆雷 · R 换弹 · F 点亮灵火 · 空格跳 · Shift 冲刺（无敌） · M 地图');
}

// 开局选择：游玩 / 检视；网址带 ?play 直接进游玩
if (new URLSearchParams(location.search).has('play')) void startPlay();
else {
  const choice = document.createElement('div');
  choice.id = 'play-choice';
  choice.innerHTML = `<div><h2>雪域天路 · 4-1 折多垭口</h2>
    <button id="btn-play">开始游玩</button><p>射击、雷魅、灵火、三场领主战，完整打一遍</p>
    <button id="btn-inspect">检视地图</button><p>飞行、机位、白模、验收（原来的检视页）</p></div>`;
  document.body.appendChild(choice);
  $('btn-play').onclick = () => { void startPlay(); canvas.focus(); };
  $('btn-inspect').onclick = () => choice.remove();
}

const shadowCenter = new THREE.Vector3(), ahead = new THREE.Vector3();
let last = performance.now();
let time = 0;
/** manual：脚本推进（检视面板隐藏时浏览器不给 rAF），只模拟、可选不渲染、不排下一帧 */
function frame(now: number, manual = false, render = true): void {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  time += dt;
  WORLD_UNIFORMS.uTime.value = time;
  // 暂存的大位移超过确认窗口仍无后续事件时，按此前方向结算（真实甩枪不会被吞掉）
  const settled = lookFilter.flush(performance.now());
  look(settled.x, settled.y);
  const fly = walker.fly;
  // 游玩模式的演出 / 秘卷三选一：人不动（鼠标视角照转，演出结束后接得上）
  const held = play?.inputLocked ? new Set<string>() : keys;
  walker.update(dt, {
    forward: (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0),
    right: (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0),
    up: fly ? (held.has('Space') ? 1 : 0) - (held.has('KeyC') ? 1 : 0) : 0,
    jump: jumpPressed && !fly && !play?.inputLocked,
    dash: dashPressed && !fly && !play?.inputLocked,
    fast: held.has('ShiftLeft') || held.has('ShiftRight'),
  });
  jumpPressed = dashPressed = false;
  walker.eye(camera.position);
  camera.rotation.set(walker.pitch, walker.yaw, 0, 'YXZ');
  sky.position.copy(camera.position);
  // 阴影中心取镜头前方 60 m，按 8 m 吸附，避免阴影边缘闪烁
  ahead.set(-Math.sin(walker.yaw), 0, -Math.cos(walker.yaw)).multiplyScalar(60).add(camera.position);
  shadowCenter.set(Math.round(ahead.x / 8) * 8, 0, Math.round(ahead.z / 8) * 8);
  shadowCenter.y = terrain.heightAt(shadowCenter.x, shadowCenter.z);
  sun.target.position.copy(shadowCenter);
  sun.position.copy(shadowCenter).addScaledVector(SKY.sunDir, 450);
  grass.update(camera.position);
  for (const a of anim) a.update(time, dt);
  monsters.update(time, dt);
  weather.update(dt, camera.position);
  if (play) play.update(dt, { firing, interact: keys.has('KeyF'), reload: reloadPressed, skillQ, skillE, pick, anyKey });
  else lords.update(time, dt, weather.level);
  reloadPressed = skillQ = skillE = anyKey = false;
  pick = 0;
  windMarks.update(time);
  windStreaks.update(dt, camera.position);
  adaptResolution(dt);
  smoke.update(dt);
  if (render) {
    renderer.render(scene, camera);
    drawMap();
    updateHud(dt);
  }
  if (!manual) requestAnimationFrame(t => frame(t));
}
requestAnimationFrame(t => frame(t));

/** 调试：按固定步长推进 seconds 秒（脚本化试玩用） */
function simulate(seconds: number, step = 1 / 30, render = false): void {
  for (let k = 0; k < seconds / step; k++) frame(last + step * 1000, true, render);
}

// 调试入口（检视用）
Object.assign(window, { plateau: {
  scene, camera, renderer, terrain, world, walker, goTo, VIEWPOINTS, grass, FIRE_STATE, weather, monsters, lords, windAt, get play() { return play; }, startPlay, simulate,
  setFiring: (v: boolean) => { firing = v; },
  /** 脚本按键：q / e 技能、jump、dash、1–3 选秘卷、any 跳过演出；hold(code, on) 按住 / 松开 WASD 之类 */
  press: (k: string) => { if (k === 'q') skillQ = true; else if (k === 'e') skillE = true; else if (k === 'jump') jumpPressed = true; else if (k === 'dash') dashPressed = true; else if (k === 'any') anyKey = true; else if (/^[123]$/.test(k)) pick = +k; },
  hold: (code: string, on: boolean) => { if (on) keys.add(code); else keys.delete(code); },
  /** 渲染一帧（截图前） */
  render: () => { renderer.render(scene, camera); },
} });
