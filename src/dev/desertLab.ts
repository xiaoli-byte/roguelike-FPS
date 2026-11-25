/**
 * 第一章白盒检视页（desert-lab.html?map=1-1&view=concept）。数据在 src/world/desert/whitebox/：
 * 同一份规格生成地形、跑可达性探针、搭画面；图上的路线是探针实测寻路的结果。
 * 机位：concept（对照路线概念图的斜俯瞰）、top（正交俯视）、spawn（出生第一眼）、s1…（主线上离各据点 32 m 处看过去）、exit。
 * F 落地：按玩家的规矩走（7.5 m/s、迈 0.45 m 台阶、坡 > 40° 上不去、空格跳 1.42 m）。
 * 无头截图（scripts/desert/whitebox-shots.mjs）：页面在后台没有 rAF，用 window.lab.setView(名) 手动出一帧。
 */
import * as THREE from 'three';
import { MouseLookFilter } from '../core/MouseLookFilter';
import { DragLook, lockPointerOrDrag } from './dragLook';
import { WHITEBOXES, buildTerrain, probeWhitebox, WB_METRICS, type V2 } from '../world/desert/whitebox';
import { WhiteboxView } from '../world/desert/whitebox/view';

const params = new URLSearchParams(location.search);
const id = params.get('map') ?? '1-1';
const spec = WHITEBOXES[id];
const $ = <T extends HTMLElement>(name: string): T => document.getElementById(name) as T;
if (!spec) {
  $('hud').textContent = `没有白盒 ${id}（有：${Object.keys(WHITEBOXES).join('、')}）`;
  throw new Error(`没有白盒 ${id}`);
}

const canvas = $<HTMLCanvasElement>('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const terrain = buildTerrain(spec);
const report = probeWhitebox(terrain);
const view = new WhiteboxView(terrain, report);
const scene = new THREE.Scene();
scene.background = new THREE.Color().setRGB(0.86, 0.87, 0.9, THREE.SRGBColorSpace);
scene.fog = new THREE.Fog(scene.background as THREE.Color, 900, 3600);
scene.add(view.group);
// 图外垫一块平地，斜俯瞰时图边不是悬空的
const skirt = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(0.78, 0.69, 0.56, THREE.SRGBColorSpace) }));
skirt.position.set(spec.size[0] / 2, -9.5, spec.size[1] / 2);
skirt.receiveShadow = true;
scene.add(skirt);

const persp = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.2, 4000);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
let camera: THREE.Camera = persp;

// ───────────── 机位 ─────────────
interface Shot { name: string; title: string; eye?: THREE.Vector3; look?: THREE.Vector3; fov?: number; top?: boolean }
const shots: Shot[] = [];
for (const v of spec.views) if (v.eye && v.look) shots.push({ name: v.name, title: v.title, eye: new THREE.Vector3(...v.eye), look: new THREE.Vector3(...v.look), fov: v.fov });
shots.push({ name: 'top', title: '俯视全图（正交，北在上）', top: true });
const ground = (p: V2, up = 0): THREE.Vector3 => new THREE.Vector3(p[0], terrain.walkAt(p[0], p[1]) + up, p[1]);
{
  const yaw = spec.spawn.yaw * Math.PI / 180;
  const eye = ground(spec.spawn.at, WB_METRICS.eye);
  shots.push({ name: 'spawn', title: '出生第一眼（玩家眼高）', eye, look: eye.clone().add(new THREE.Vector3(Math.sin(yaw) * 40, -1, -Math.cos(yaw) * 40)), fov: 75 });
}
const main = report.routes.find(r => r.kind === 'main');
/** 主线上到 target 之前 back 米处的点（玩家是从这儿走过来看到它的） */
function approach(target: V2, back: number): V2 | null {
  if (!main || main.pts.length < 2) return null;
  let best = 0, bd = Infinity;
  main.pts.forEach((p, i) => { const d = Math.hypot(p[0] - target[0], p[1] - target[1]); if (d < bd) { bd = d; best = i; } });
  let acc = 0;
  for (let i = best; i > 0; i--) {
    acc += Math.hypot(main.pts[i][0] - main.pts[i - 1][0], main.pts[i][1] - main.pts[i - 1][1]);
    if (acc >= back) return main.pts[i - 1];
  }
  return main.pts[0];
}
for (const s of [...spec.strongholds, ...(spec.extras ?? []).filter(e => e.kind === 'boss'), spec.exit]) {
  const from = approach(s.at, 32);
  if (!from || Math.hypot(from[0] - s.at[0], from[1] - s.at[1]) < 6) continue;
  shots.push({ name: s === spec.exit ? 'exit' : `s${s.id}`, title: `${s === spec.exit ? '出口' : s.id + ' ' + s.name} · 主线上 32 m 外看过去`, eye: ground(from, WB_METRICS.eye), look: ground(s.at, 1.2), fov: 75 });
}

// ───────────── 视角 / 移动 ─────────────
const state = { yaw: 0, pitch: 0, pos: new THREE.Vector3(), walking: false, vy: 0, grounded: true, shot: '' };
function setView(name: string): boolean {
  const s = shots.find(v => v.name === name);
  if (!s) return false;
  state.shot = name;
  state.walking = false;
  if (s.top) {
    const aspect = innerWidth / innerHeight, pad = 14;
    const halfH = Math.max((spec.size[1] + pad * 2) / 2, (spec.size[0] + pad * 2) / 2 / aspect);
    Object.assign(ortho, { left: -halfH * aspect, right: halfH * aspect, top: halfH, bottom: -halfH });
    ortho.position.set(spec.size[0] / 2, 900, spec.size[1] / 2);
    ortho.up.set(0, 0, -1);
    ortho.lookAt(spec.size[0] / 2, 0, spec.size[1] / 2);
    ortho.updateProjectionMatrix();
    camera = ortho;
  } else {
    camera = persp;
    persp.fov = s.fov ?? 60;
    persp.updateProjectionMatrix();
    state.pos.copy(s.eye!);
    const d = s.look!.clone().sub(s.eye!).normalize();
    state.yaw = Math.atan2(-d.x, -d.z);
    state.pitch = Math.asin(d.y);
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views button')) b.classList.toggle('on', b.dataset.view === name);
  render();
  return true;
}

const keys = new Set<string>();
const lookFilter = new MouseLookFilter();
let ignoreMouseUntil = 0;
function look(dx: number, dy: number): void {
  if (camera !== persp) return;
  state.yaw -= dx * 0.0022;
  state.pitch = Math.max(-1.52, Math.min(1.52, state.pitch - dy * 0.0022));
}
const drag = new DragLook(canvas, look);
drag.active = true;   // 检视页缺省拖动转视角；落地走（F）时再锁鼠标
document.addEventListener('pointerlockchange', () => {
  lookFilter.reset();
  ignoreMouseUntil = document.pointerLockElement === canvas ? performance.now() + 50 : 0;
});
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas || performance.now() < ignoreMouseUntil) return;
  const d = lookFilter.sample(e.movementX, e.movementY, e.timeStamp);
  look(d.x, d.y);
});
addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && shots[+digit[1] - 1]) setView(shots[+digit[1] - 1].name);
  if (e.code === 'KeyO') { const box = $<HTMLInputElement>('overlay'); box.checked = !box.checked; view.overlay.visible = box.checked; }
  if (e.code === 'KeyF' && camera === persp) {
    state.walking = !state.walking;
    state.vy = 0;
    $('cross').style.display = state.walking ? 'block' : 'none';
    if (state.walking) void lockPointerOrDrag(canvas, drag);
    else if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const _f = new THREE.Vector3(), _r = new THREE.Vector3();
function move(dt: number): void {
  if (camera !== persp) return;
  const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (state.walking) {
    // 玩家的规矩：水平 7.5 m/s，迈得过 0.45 m，坡 > 40° 或更高的坎上不去；空格跳
    _f.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    _r.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
    const speed = WB_METRICS.runSpeed * dt, feet = state.pos.y - WB_METRICS.eye;
    const dx = (_f.x * fwd + _r.x * side) * speed, dz = (_f.z * fwd + _r.z * side) * speed;
    const tryMove = (mx: number, mz: number): void => {
      const nx = state.pos.x + mx, nz = state.pos.z + mz;
      const rise = terrain.walkAt(nx, nz) - feet;
      if (rise <= (state.grounded ? WB_METRICS.step : 0.05) + Math.tan(WB_METRICS.maxSlope * Math.PI / 180) * Math.hypot(mx, mz)) { state.pos.x = nx; state.pos.z = nz; }
    };
    tryMove(dx, 0);
    tryMove(0, dz);
    if (keys.has('Space') && state.grounded) { state.vy = 8.6; state.grounded = false; }
    state.vy -= 26 * dt;
    let y = feet + state.vy * dt;
    const floor = terrain.walkAt(state.pos.x, state.pos.z);
    if (y <= floor || (state.grounded && floor - y <= WB_METRICS.step && state.vy <= 0)) { y = floor; state.vy = 0; state.grounded = true; }
    else if (y - floor > 0.05) state.grounded = false;
    state.pos.y = y + WB_METRICS.eye;
  } else {
    _f.set(-Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch), -Math.cos(state.yaw) * Math.cos(state.pitch));
    _r.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
    const speed = (keys.has('ShiftLeft') ? 120 : 40) * dt;
    state.pos.addScaledVector(_f, fwd * speed).addScaledVector(_r, side * speed);
    state.pos.y += ((keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)) * speed;
  }
}

function render(): void {
  if (camera === persp) {
    persp.position.copy(state.pos);
    persp.rotation.set(state.pitch, state.yaw, 0, 'YXZ');
  }
  // 玩家视角（眼高机位、落地走）不画路线带和点位标记：贴地的带在眼前会铺满画面
  view.fitMarkers(camera, camera === persp && (state.walking || persp.fov >= 70));
  renderer.render(scene, camera);
  const s = shots.find(v => v.name === state.shot);
  $('hud').innerHTML = `<b>${spec.id} ${spec.name}</b>\n${s?.title ?? ''}\n${camera === persp ? `x ${state.pos.x.toFixed(0)}  z ${state.pos.z.toFixed(0)}  高 ${state.pos.y.toFixed(1)}${state.walking ? '  · 落地走' : ''}` : ''}`;
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  move(dt);
  render();
  requestAnimationFrame(frame);
}

// ───────────── 面板 ─────────────
$('title').textContent = `${spec.id} ${spec.name} · 白盒（${spec.motif}）`;
$('mood').textContent = spec.mood;
$('maps').innerHTML = Object.keys(WHITEBOXES).map(k => `<a href="?map=${k}" class="${k === id ? 'on' : ''}">${k}</a>`).join('');
$('views').innerHTML = shots.map((s, i) => `<button data-view="${s.name}" title="${s.title}">${i + 1} ${s.name}</button>`).join('');
for (const b of document.querySelectorAll<HTMLButtonElement>('#views button')) b.onclick = () => setView(b.dataset.view!);
$<HTMLInputElement>('overlay').onchange = e => { view.overlay.visible = (e.target as HTMLInputElement).checked; };
$('routes').innerHTML = report.routes.map(r => `<tr><td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'}</td><td>${r.kind === 'main' ? '主线' : '侧翼 ' + r.id}</td><td>${r.length.toFixed(0)} m · ${r.seconds.toFixed(0)} s · 最陡 ${r.maxSlope.toFixed(0)}° · 最窄 ${r.minWidth.toFixed(1)} m${r.problems.length ? '<br>' + r.problems.join('<br>') : ''}</td></tr>`).join('');
$('rows').innerHTML = report.rows.map(r => `<tr><td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'}</td><td>${r.kind} ${r.id}</td><td>${r.name}<br>${r.detail}</td></tr>`).join('');

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  persp.aspect = innerWidth / innerHeight;
  persp.updateProjectionMatrix();
  if (camera === ortho) setView('top');
});

if (params.get('overlay') === '0') { view.overlay.visible = false; $<HTMLInputElement>('overlay').checked = false; }
if (params.has('capture')) document.body.classList.add('capture');
setView(params.get('view') ?? shots[0].name);
requestAnimationFrame(frame);

Object.assign(window, {
  lab: {
    ready: true, spec, terrain, report, view, scene, renderer, shots: shots.map(s => s.name), maps: Object.keys(WHITEBOXES),
    setView,
    overlay(on: boolean): void { view.overlay.visible = on; render(); },
    render,
  },
});
