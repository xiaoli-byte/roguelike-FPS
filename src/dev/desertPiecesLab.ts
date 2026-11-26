/**
 * 第一章新做的件检视页（desert-pieces.html?piece=<id>&view=<机位>）。
 * 自动收集 src/world/desert/pieces/*.ts 里导出的 LAB 条目；地面是 y = 0 的沙地，沙漠午后的光 + 风格化材质的三色环境光，
 * 和游戏里 Unity 场景件同一套材质路子。拖动转视角、WASD 飞（Q / E 升降、Shift 加速）。
 * 无头截图（scripts/desert/pieces-shots.mjs）：页面在后台没有 rAF，用 window.lab.setView(名) / setPiece(id) 手动出帧。
 */
import * as THREE from 'three';
import { DragLook } from './dragLook';
import { setStylizedEnvironment, stylizedShared } from '../world/UnityStylizedLit';
import type { UnityEnvironment } from '../world/UnityLevelLibrary';
import type { BuiltPiece, LabPiece, PieceContext } from '../world/desert/pieces/types';

const MODULES = import.meta.glob('../world/desert/pieces/*.ts', { eager: true }) as Record<string, { LAB?: LabPiece[] }>;
const PIECES: LabPiece[] = Object.values(MODULES).flatMap(m => m.LAB ?? []);
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(name: string): T => document.getElementById(name) as T;

// 沙漠午后：太阳西南偏高、暖白主光、天蓝 / 沙黄 / 赭地三色环境光（sRGB）
const ENV: Pick<UnityEnvironment, 'ambient' | 'sun'> = {
  ambient: { mode: 1, sky: [0.55, 0.66, 0.82, 1], equator: [0.74, 0.66, 0.55, 1], ground: [0.52, 0.4, 0.3, 1], light: [0.5, 0.5, 0.5, 1], intensity: 1 },
  sun: { forward: [0.45, -0.62, 0.64], color: [1, 0.9, 0.76, 1], intensity: 1.6, shadows: 2, shadowStrength: 0.85 },
};
setStylizedEnvironment(ENV);

const canvas = $<HTMLCanvasElement>('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const skyColor = new THREE.Color().setRGB(0.74, 0.8, 0.88, THREE.SRGBColorSpace);
scene.background = skyColor;
scene.fog = new THREE.Fog(new THREE.Color().setRGB(0.86, 0.8, 0.7, THREE.SRGBColorSpace), 180, 900);
const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1, 0.9, 0.76, THREE.SRGBColorSpace), 3.2);
const sunDir = new THREE.Vector3(-ENV.sun!.forward[0], -ENV.sun!.forward[1], -ENV.sun!.forward[2]).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(new THREE.Color().setRGB(0.55, 0.66, 0.82, THREE.SRGBColorSpace), new THREE.Color().setRGB(0.52, 0.4, 0.3, THREE.SRGBColorSpace), 0.6));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(0.8, 0.68, 0.5, THREE.SRGBColorSpace) }));
ground.receiveShadow = true;
scene.add(ground);

// 1.8 m 人形参照（level-art.md：比例最容易错）
const man = new THREE.Group();
{
  const m = new THREE.MeshLambertMaterial({ color: 0x2f6fd6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.2, 4, 8), m);
  body.position.y = 0.9;
  body.castShadow = true;
  man.add(body);
}
scene.add(man);

const boxGroup = new THREE.Group();
boxGroup.visible = false;
scene.add(boxGroup);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);
const state = { yaw: 0, pitch: 0, pos: new THREE.Vector3(0, 2, 20), piece: '', view: '' };
const ctx: PieceContext = { ground: () => 0, low: params.has('low'), environment: ENV };
let built: BuiltPiece | null = null;
let current: LabPiece | null = null;

function clearBoxes(): void {
  for (const c of [...boxGroup.children]) {
    boxGroup.remove(c);
    (c as THREE.LineSegments).geometry.dispose();
  }
}

async function setPiece(id: string): Promise<boolean> {
  const p = PIECES.find(x => x.id === id);
  if (!p) return false;
  built?.dispose();
  if (built) scene.remove(built.object);
  clearBoxes();
  current = p;
  state.piece = id;
  built = await p.build(ctx);
  scene.add(built.object);
  // 碰撞盒线框
  const mat = new THREE.LineBasicMaterial({ color: 0xff3355 });
  for (const b of built.colliders) {
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...b.size)), mat);
    box.position.set(...b.center);
    if (b.rotation) box.quaternion.set(...b.rotation);
    boxGroup.add(box);
  }
  // 太阳的投影框跟着件的大小走
  const bb = new THREE.Box3().setFromObject(built.object);
  const c = bb.getCenter(new THREE.Vector3()), r = Math.max(8, bb.getSize(new THREE.Vector3()).length() * 0.6);
  sun.position.copy(c).addScaledVector(sunDir, r * 3);
  sun.target.position.copy(c);
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: r * 6 });
  sun.shadow.camera.updateProjectionMatrix();
  man.position.set(c.x + Math.min(6, bb.getSize(new THREE.Vector3()).x / 2 + 2), 0, bb.max.z + 2);
  $('note').textContent = `${p.title}：${p.note}（碰撞盒 ${built.colliders.length} 个）`;
  $('views').innerHTML = p.views.map((v, i) => `<button data-view="${v.name}">${i + 1} ${v.name}</button>`).join('');
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views button')) b.onclick = () => setView(b.dataset.view!);
  for (const b of document.querySelectorAll<HTMLButtonElement>('#pieces button')) b.classList.toggle('on', b.dataset.piece === id);
  setView(p.views[0]?.name ?? '');
  return true;
}

function setView(name: string): boolean {
  const v = current?.views.find(x => x.name === name);
  if (!v) { render(); return false; }
  state.view = name;
  camera.fov = v.fov ?? 60;
  camera.updateProjectionMatrix();
  state.pos.set(...v.eye);
  const d = new THREE.Vector3(...v.look).sub(state.pos).normalize();
  state.yaw = Math.atan2(-d.x, -d.z);
  state.pitch = Math.asin(d.y);
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views button')) b.classList.toggle('on', b.dataset.view === name);
  render();
  return true;
}

const keys = new Set<string>();
const drag = new DragLook(canvas, (dx, dy) => {
  state.yaw -= dx * 0.0022;
  state.pitch = Math.max(-1.52, Math.min(1.52, state.pitch - dy * 0.0022));
});
drag.active = true;
addEventListener('keydown', e => {
  keys.add(e.code);
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && current?.views[+digit[1] - 1]) setView(current.views[+digit[1] - 1].name);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const _f = new THREE.Vector3(), _r = new THREE.Vector3();
let last = performance.now(), t = 0;
function render(): void {
  camera.position.copy(state.pos);
  camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ');
  renderer.render(scene, camera);
  $('hud').textContent = `${current?.title ?? ''}  ${state.view}\nx ${state.pos.x.toFixed(1)}  y ${state.pos.y.toFixed(1)}  z ${state.pos.z.toFixed(1)}`;
}
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  stylizedShared.uSflTime.value = t;
  built?.update?.(dt, t);
  const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  _f.set(-Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch), -Math.cos(state.yaw) * Math.cos(state.pitch));
  _r.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const speed = (keys.has('ShiftLeft') ? 40 : 10) * dt;
  state.pos.addScaledVector(_f, fwd * speed).addScaledVector(_r, side * speed);
  state.pos.y += ((keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)) * speed;
  render();
  requestAnimationFrame(frame);
}

$('pieces').innerHTML = PIECES.map(p => `<button data-piece="${p.id}">${p.title}</button>`).join('') || '还没有件（src/world/desert/pieces/*.ts 导出 LAB）';
for (const b of document.querySelectorAll<HTMLButtonElement>('#pieces button')) b.onclick = () => void setPiece(b.dataset.piece!);
$<HTMLInputElement>('boxes').onchange = e => { boxGroup.visible = (e.target as HTMLInputElement).checked; render(); };
$<HTMLInputElement>('man').onchange = e => { man.visible = (e.target as HTMLInputElement).checked; render(); };
if (params.has('boxes')) { boxGroup.visible = true; $<HTMLInputElement>('boxes').checked = true; }
if (params.has('capture')) document.body.classList.add('capture');
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const lab = {
    ready: false, scene, renderer, pieces: PIECES.map(p => p.id),
    views: () => current?.views.map(v => v.name) ?? [],
    setPiece, setView,
    /** 推进 dt 秒（风吹、飘动）再出一帧：后台页没有 rAF 时截动画用 */
    step(dt: number): void { t += dt; stylizedShared.uSflTime.value = t; built?.update?.(dt, t); render(); },
    boxes(on: boolean): void { boxGroup.visible = on; render(); },
    man(on: boolean): void { man.visible = on; render(); },
    render,
};
Object.assign(window, { lab });

const first = params.get('piece') ?? PIECES[0]?.id;
void (first ? setPiece(first) : Promise.resolve(false)).then(() => {
  if (params.get('view')) setView(params.get('view')!);
  lab.ready = true;
  requestAnimationFrame(frame);
});
