/**
 * 雪域天路 · 4-4 神山海子（雷泽雷神的擂台，章节终局）—— 网页检视页（plateau-lab.html?map=4-4）。
 * 地形、镜面湖、导雷石柱、湖岸掩体都在 src/world/haizi/（和 4-1 共用的在 src/world/plateau/），
 * 这里只负责组装、输入、机位、平面图和天气。设计见 docs/level-design/chuanzang-combat-v1.md 4.5。
 * 首领战之后挂在 play 上（setPlay）：每帧在镜头摆好之后调 play.update，它可以接管镜头（登场演出）；inputLocked 时人不动。
 */
import * as THREE from 'three';
import { MouseLookFilter } from '../core/MouseLookFilter';
import { SKY } from '../world/plateau/backdrop';
import { FIRE_STATE } from '../world/plateau/landmarks';
import { WORLD_UNIFORMS } from '../world/plateau/materials';
import { CollisionWorld, EYE, Walker } from '../world/plateau/walker';
import { Weather } from '../world/plateau/weather';
import { buildHaizi } from '../world/haizi/scene';
import { COIL, ISLAND, LAKE, MAP, PILLARS, PLACEMENTS, SPAWN, VIEWPOINTS, type Viewpoint } from '../world/haizi/spec';
import { HaiziTerrain } from '../world/haizi/terrain';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const t0 = performance.now();

// ───────────────────────────── 面板（换成 4-4 的选项） ─────────────────────────────

document.title = '雪域天路 · 4-4 神山海子';
$('title').textContent = '雪域天路 · 4-4';
$('subtitle').textContent = '神山海子（雷泽雷神的擂台，程序化白模）';
$('loading').textContent = '正在生成神山海子…';
$('storm-text').textContent = '风雪太大，回到湖岸上去';
document.querySelector('#panel .body')!.innerHTML = `
<h2>机位</h2><div id="views"></div>
<h2>选项</h2>
<label><input type="checkbox" id="opt-double"> 二段跳（鼯 / 额外跳跃秘卷）</label>
<label><input type="checkbox" id="opt-cloud" checked> 云影</label>
<label><input type="checkbox" id="opt-scatter" checked> 草与碎石</label>
<label>画质 <select id="opt-quality"><option value="high">高</option><option value="mid">中</option><option value="low">低</option></select>（帧率低时自动降分辨率）</label>
<label>天气 <select id="opt-weather"><option value="clear">晴</option><option value="storm">雷暴</option></select></label>
<label><input type="checkbox" id="opt-fire"> 点亮湖心岛灵火</label>
<h2>首领战用的场地状态（演示）</h2>
<label>水位 <input type="range" id="opt-rise" min="0" max="2" step="0.1" value="0"> <span id="rise-val">+0.0 m</span></label>
<label>湖水通电（雷泽） <input type="range" id="opt-glow" min="0" max="1" step="0.05" value="0"></label>
<label>石柱雷晶充能 <input type="range" id="opt-charge" min="0" max="1" step="0.05" value="0"></label>
<h2>操作</h2>
<div class="row">点击画面锁定鼠标，Esc 解锁
WASD 移动　空格 跳　Shift 冲刺
G 行走 / 飞行（飞行：空格升、C 降、Shift 加速）
M 平面图　1–9 机位
湖面半径 ${LAKE.deepR} m 以内是深水，走不进去；湖心岛要飞过去（首领战里踩雷神拱出水面的身段过去）</div>
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
const hemi = new THREE.HemisphereLight('#c4dbff', '#7a8a7a', 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff2dc', 2.9);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 1000 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);

// ───────────────────────────── 组装 ─────────────────────────────

const terrain = new HaiziTerrain();
const world = new CollisionWorld(terrain);
const reflectSize = (): [number, number] => {
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  return [Math.max(256, Math.round(s.x * 0.5)), Math.max(256, Math.round(s.y * 0.5))];
};
const arena = buildHaizi(scene, terrain, world, ...reflectSize());
const { sky, lake, pillars, conductors, anim, grass, scatter } = arena;
const fog = scene.fog as THREE.Fog;
const weather = new Weather({
  scene, sun, hemi, fog, clearFog: { color: fog.color.clone(), near: fog.near, far: fog.far }, stormFog: new THREE.Color(SKY.stormHorizon),
}, terrain, conductors);
const buildMs = performance.now() - t0;

// ───────────────────────────── 行走与机位 ─────────────────────────────

const boundAt = (x: number, z: number): number => Math.hypot(x, z) - MAP.playRadius;
const walker = new Walker(world, boundAt, MAP.softBoundary);
$<HTMLInputElement>('opt-double').onchange = e => { walker.doubleJump = (e.target as HTMLInputElement).checked; };

function goTo(vp: Viewpoint): void {
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

// ───────────────────────────── 首领战挂点 ─────────────────────────────

export interface HaiziPlayInput { firing: boolean; interact: boolean; reload: boolean; keys: ReadonlySet<string> }
/** 首领战：每帧在镜头按第一人称摆好之后调（可以改 camera 接管镜头）；inputLocked = true 时人不动（演出） */
export interface HaiziPlay { update(dt: number, input: HaiziPlayInput): void; inputLocked?: boolean }
let play: HaiziPlay | null = null;

// ───────────────────────────── 输入 ─────────────────────────────

const keys = new Set<string>();
let jumpPressed = false, dashPressed = false, reloadPressed = false, firing = false, bigMap = false;
addEventListener('mousedown', e => { if (e.button === 0 && document.pointerLockElement === canvas) firing = true; });
addEventListener('mouseup', e => { if (e.button === 0) firing = false; });
addEventListener('keydown', e => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jumpPressed = true; }
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) dashPressed = true;
  if (e.code === 'KeyR' && !e.repeat) reloadPressed = true;
  if (e.code === 'KeyG' && !e.repeat && !play) {
    walker.fly = !walker.fly;
    if (walker.fly) walker.feet.y += EYE; else walker.place(walker.feet.x, walker.feet.z);
    showHint(walker.fly ? '飞行模式' : '行走模式');
  }
  if (e.code === 'KeyM' && !e.repeat) toggleMap();
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && VIEWPOINTS[+digit[1] - 1] && !play) goTo(VIEWPOINTS[+digit[1] - 1]);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); firing = false; });
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
  lake.resize(...reflectSize());
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
$<HTMLInputElement>('opt-scatter').onchange = e => { grass.group.visible = scatter.group.visible = (e.target as HTMLInputElement).checked; };
$<HTMLSelectElement>('opt-weather').onchange = e => { weather.stormy = (e.target as HTMLSelectElement).value === 'storm'; };
$<HTMLInputElement>('opt-fire').onchange = e => { FIRE_STATE.mask = undefined; FIRE_STATE.lit = (e.target as HTMLInputElement).checked ? 1 : 0; };
$<HTMLInputElement>('opt-rise').oninput = e => {
  const v = Number((e.target as HTMLInputElement).value);
  lake.setRise(v);
  $('rise-val').textContent = `+${v.toFixed(1)} m`;
};
$<HTMLInputElement>('opt-glow').oninput = e => {
  const v = Number((e.target as HTMLInputElement).value);
  lake.setTint('#ff4fd8', v * 0.45);
  lake.setGlow(v);
};
$<HTMLInputElement>('opt-charge').oninput = e => { for (const p of pillars) p.setCharge(Number((e.target as HTMLInputElement).value)); };

// 画质：分辨率上限、阴影贴图、草的半径；帧率持续低于 48 时自动降分辨率
const QUALITY = { high: { cap: 1.5, shadow: 4096, grass: 110 }, mid: { cap: 1.15, shadow: 2048, grass: 85 }, low: { cap: 0.85, shadow: 1024, grass: 60 } };
let ratioCap = Math.min(devicePixelRatio, 1.5), ratio = ratioCap;
function setRatio(r: number): void {
  ratio = r;
  renderer.setPixelRatio(r);
  renderer.setSize(innerWidth, innerHeight, false);
  lake.resize(...reflectSize());
}
$<HTMLSelectElement>('opt-quality').onchange = e => {
  const Q = QUALITY[(e.target as HTMLSelectElement).value as keyof typeof QUALITY];
  ratioCap = Math.min(devicePixelRatio, Q.cap); setRatio(ratioCap);
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

// ───────────────────────────── 平面图 ─────────────────────────────

const mapEl = $<HTMLCanvasElement>('map');
const MW = 240, MR = 100;
const toMap = (x: number, z: number, W: number): [number, number] => [(x / MR + 1) * W / 2, (z / MR + 1) * W / 2];
function layoutMap(): void {
  const W = bigMap ? Math.round(MW * 2.6) : MW;
  mapEl.width = W; mapEl.height = W;
  if (!bigMap) { mapEl.style.width = `${MW}px`; mapEl.style.height = `${MW}px`; }
  else { mapEl.style.width = ''; mapEl.style.height = ''; }
}
function toggleMap(): void { bigMap = !bigMap; mapEl.classList.toggle('big', bigMap); layoutMap(); }
mapEl.onclick = toggleMap;
function drawMap(): void {
  const g = mapEl.getContext('2d')!, W = mapEl.width, s = W / (2 * MR);
  g.fillStyle = '#8f887c'; g.fillRect(0, 0, W, W);
  g.fillStyle = '#d9dee2';
  g.beginPath(); g.arc(W / 2, W / 2, (MAP.playRadius + 30) * s, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#b5ad9f';
  g.beginPath(); g.arc(W / 2, W / 2, MAP.playRadius * s, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#5fb8b6';
  g.beginPath(); g.arc(W / 2, W / 2, terrain.shorelineR() * s, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3f8f94';
  g.beginPath(); g.arc(W / 2, W / 2, LAKE.deepR * s, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#ff4fd866'; g.setLineDash([4, 4]); g.lineWidth = 2;
  g.beginPath(); g.arc(W / 2, W / 2, COIL.r * s, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#c9c1b2';
  g.beginPath(); g.arc(W / 2, W / 2, ISLAND.r * s, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#7fe0ff'; g.beginPath(); g.arc(W / 2, W / 2, 2.5, 0, Math.PI * 2); g.fill();
  for (const p of PLACEMENTS) {
    if (p.kind === 'altar') continue;
    const [x, y] = toMap(p.x, p.z, W);
    g.fillStyle = p.kind === 'boulder' ? '#6d675f' : '#f2efe8';
    g.beginPath(); g.arc(x, y, 2.6 * (bigMap ? 2 : 1), 0, Math.PI * 2); g.fill();
  }
  for (const p of pillars) {
    const [x, y] = toMap(p.pos.x, p.pos.z, W);
    g.fillStyle = p.charge > 0.5 ? '#ff4fd8' : '#e8d6ff'; g.strokeStyle = '#000';
    g.beginPath(); g.rect(x - 3, y - 3, 6, 6); g.fill(); g.stroke();
  }
  const [mx, my] = toMap(walker.feet.x, walker.feet.z, W);
  g.save(); g.translate(mx, my); g.rotate(-walker.yaw);
  g.fillStyle = walker.fly ? '#7fe0ff' : '#ffdf4a'; g.strokeStyle = '#000'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, -7); g.lineTo(4.5, 5); g.lineTo(0, 2.5); g.lineTo(-4.5, 5); g.closePath(); g.fill(); g.stroke();
  g.restore();
  g.fillStyle = '#fff'; g.font = '12px sans-serif'; g.fillText('北 ↑', W - 34, 16);
}

let fpsAcc = 0, fpsN = 0, hudT = 0, fps = 0;
function updateHud(dt: number): void {
  fpsAcc += dt; fpsN++;
  hudT += dt;
  $('storm').style.opacity = String(walker.fly ? 0 : walker.wind * 0.85);
  $('storm-text').style.opacity = walker.wind > 0.25 && !walker.fly ? '1' : '0';
  if (hudT < 0.25) return;
  fps = fpsN / Math.max(1e-3, fpsAcc); fpsAcc = 0; fpsN = 0; hudT = 0;
  const f = walker.feet, r = Math.hypot(f.x, f.z);
  const y = f.y - (walker.fly ? EYE : 0);
  const where = r < ISLAND.r + 2 ? '湖心岛' : r < terrain.shorelineR() ? '湖里' : r < MAP.playRadius ? '湖岸' : '雪山坡（软边界外）';
  const depth = terrain.waterDepthAt(f.x, f.z);
  $('hud').innerHTML = `<b>4-4 神山海子 · ${where}</b>\n海拔 ${(MAP.altitudeBase + y).toFixed(0)} m　离湖心 ${r.toFixed(0)} m${depth > 0.05 ? `　水深 ${depth.toFixed(1)} m` : ''}\n${walker.fly ? '飞行' : walker.grounded ? '行走' : '空中'}${walker.doubleJump ? ' · 二段跳' : ''}　x ${f.x.toFixed(0)}  z ${f.z.toFixed(0)}`;
  const info = renderer.info.render;
  $('perf').textContent = `${fps.toFixed(0)} FPS　绘制 ${info.calls} 次　${(info.triangles / 1000).toFixed(0)}k 三角形　分辨率 ${Math.round(ratio * 100)}%
生成 ${buildMs.toFixed(0)} ms　碰撞体 ${world.list.length}　导体 ${conductors.length}
草区块 ${grass.count}（${(grass.instances / 1000).toFixed(1)}k 丛）　碎石 ${scatter.stats.rocks}`;
}

// ───────────────────────────── 主循环 ─────────────────────────────

layoutMap();
const params = new URLSearchParams(location.search);
goTo(VIEWPOINTS.find(v => v.id === params.get('view')) ?? VIEWPOINTS[0]);
if (params.get('panel') === '0') { $('panel').classList.add('collapsed'); $('toggle').textContent = '展开'; }
$('loading').remove();
showHint('点击画面开始 · WASD 移动 · G 飞行 · 1–9 机位');

const shadowCenter = new THREE.Vector3(), ahead = new THREE.Vector3();
let last = performance.now(), time = 0;
function frame(now: number): void {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  tick(dt, true);
  requestAnimationFrame(frame);
}

/** 一帧；render = false 时只推进逻辑（检视脚本在后台页面里按固定步长跑） */
function tick(dt: number, render: boolean): void {
  time += dt;
  WORLD_UNIFORMS.uTime.value = time;
  const settled = lookFilter.flush(performance.now());
  look(settled.x, settled.y);
  const fly = walker.fly, locked = !!play?.inputLocked;
  walker.update(dt, {
    forward: locked ? 0 : (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
    right: locked ? 0 : (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
    up: fly && !locked ? (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0) : 0,
    jump: jumpPressed && !fly && !locked,
    dash: dashPressed && !fly && !locked,
    fast: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  });
  jumpPressed = dashPressed = false;
  walker.eye(camera.position);
  camera.rotation.set(walker.pitch, walker.yaw, 0, 'YXZ');
  // 首领战（可以接管镜头）
  play?.update(dt, { firing: firing && !locked, interact: keys.has('KeyE') && !locked, reload: reloadPressed && !locked, keys });
  reloadPressed = false;
  sky.position.copy(camera.position);
  // 阴影中心取镜头前方 60 m，按 8 m 吸附，避免阴影边缘闪烁
  const fwd = camera.getWorldDirection(ahead).setY(0);
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  ahead.copy(fwd.normalize()).multiplyScalar(60).add(camera.position);
  shadowCenter.set(Math.round(ahead.x / 8) * 8, 0, Math.round(ahead.z / 8) * 8);
  shadowCenter.y = terrain.heightAt(shadowCenter.x, shadowCenter.z);
  sun.target.position.copy(shadowCenter);
  sun.position.copy(shadowCenter).addScaledVector(SKY.sunDir, 450);
  grass.update(camera.position);
  for (const a of anim) a.update(time, dt);
  weather.update(dt, camera.position);
  lake.update();
  if (!render) return;
  adaptResolution(dt);
  renderer.render(scene, camera);
  drawMap();
  updateHud(dt);
}
requestAnimationFrame(frame);

/** 调试：按固定步长推进 seconds 秒（检视面板隐藏时浏览器不给 rAF）；render = true 时每步都渲染 */
function simulate(seconds: number, step = 1 / 30, render = false): void {
  for (let t = 0; t < seconds - 1e-9; t += step) tick(step, render);
}

// 调试入口（检视、首领战接入用）
Object.assign(window, {
  haizi: {
    scene, camera, renderer, terrain, world, walker, weather, lake, pillars, conductors, arena, goTo, VIEWPOINTS, simulate,
    SPAWN, PILLARS, COIL, keys,
    get play() { return play; },
    setPlay: (p: HaiziPlay | null) => { play = p; },
    setFiring: (v: boolean) => { firing = v; },
    jump: () => { jumpPressed = true; },
    dash: () => { dashPressed = true; },
    render: () => { renderer.render(scene, camera); drawMap(); updateHud(0.3); },
  },
});
