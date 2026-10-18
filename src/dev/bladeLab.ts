/**
 * 碎刃 v2 模型检视页（blade-lab.html，只在 dev 服务中使用）：整刀、128 片碎刃的几种排布、鬼眼。
 * 不依赖游戏上下文；碎片排布是检视用的示意动画，实战动作由 DemonBlade 控制器驱动。
 */
import * as THREE from 'three';
import { bladeCells, BLADE_LEN, SHARD_COUNT } from '../weapons/demonBlade/BladeShape';
import { buildDemonBlade } from '../weapons/demonBlade/BladeModel';
import { BladeView, createBladePoseInput } from '../weapons/demonBlade/BladeView';
import type { GameContext } from '../core/types';
import { AssetLibrary } from '../assets/AssetLibrary';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#d6d6d6');
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
// 与第一人称武器场景相同的灯光
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3440, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.6, 1, 0.8);
scene.add(sun);

const blade = buildDemonBlade(true);
scene.add(blade.root);
// 横放：刀柄在左、刀尖在右、刃口朝下（同设计图）
blade.root.rotation.set(0, 0, -Math.PI / 2);

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const view = $<HTMLSelectElement>('view'), state = $<HTMLSelectElement>('state'), eye = $<HTMLInputElement>('eye');
const readout = $<HTMLParagraphElement>('readout');
$<HTMLSelectElement>('bg').onchange = (e) => { scene.background = new THREE.Color((e.target as HTMLSelectElement).value); };

const target = new THREE.Vector3();
function placeCamera(): void {
  const v = view.value;
  blade.root.updateMatrixWorld(true);
  const center = (y: number): THREE.Vector3 => blade.frame.localToWorld(new THREE.Vector3(-0.03, y, 0));
  if (v === 'side') { target.copy(center(0.25)); camera.position.copy(target).add(new THREE.Vector3(0, 0, 2.3)); }
  else if (v === 'three') { target.copy(center(0.25)); camera.position.copy(target).add(new THREE.Vector3(-0.9, 0.55, 1.6)); }
  else if (v === 'root') { target.copy(center(0.04)); camera.position.copy(target).add(new THREE.Vector3(0.05, 0.05, 0.42)); }
  else if (v === 'tip') { target.copy(center(0.66)); camera.position.copy(target).add(new THREE.Vector3(0.05, 0.02, 0.5)); }
  else { target.copy(center(0.3)); camera.position.copy(target).add(new THREE.Vector3(0, -1.1, 0.9)); }
  camera.lookAt(target);
}
view.onchange = placeCamera;

const cells = bladeCells();
const q = new THREE.Quaternion(), axis = new THREE.Vector3(), e = new THREE.Euler();
function pose(t: number): void {
  const s = state.value;
  const b = blade.buffer;
  let coreTop = 10;
  for (let i = 0; i < SHARD_COUNT; i++) {
    const c = cells[i];
    const k = c.rank / (SHARD_COUNT - 1);
    if (s === 'closed') { b.set(i, c.cx, c.cy, 0, null, 1, 0); continue; }
    if (s === 'explode') {
      const f = 0.35 + 0.35 * Math.sin(t * 0.8);
      b.set(i, c.cx * (1 + f * 1.8), c.cy + (c.cy - 0.1) * f * 0.25, Math.sin(i * 1.7) * 0.01 * f, null, 1, 0.2 * f);
      continue;
    }
    if (s === 'shatter') {
      // 刀尖先走：每片按名次延迟，沿刀身往刀柄方向、向刃口外侧飞散
      const local = THREE.MathUtils.clamp((t % 3) * 1.4 - k * 1.6, 0, 1.5);
      if (local > 0) coreTop = Math.min(coreTop, c.cy - 0.02);
      e.set(local * 3 + i, local * 5, local * 2);
      q.setFromEuler(e);
      b.set(i, c.cx + local * (0.05 + 0.25 * Math.sin(i)), c.cy - local * 0.25 * (1 - k), local * 0.12 * Math.cos(i * 2.3), local > 0 ? q : null, 1, local > 0 ? 0.8 : 0);
      continue;
    }
    if (s === 'swarm') {
      coreTop = -1;
      const r = 0.22 + 0.12 * ((i * 37) % 11) / 11;
      const a = t * (2.4 + (i % 5) * 0.3) + i * 2.399;
      const h = Math.sin(i * 1.3 + t) * 0.12;
      axis.set(-Math.sin(a), 0, Math.cos(a));
      q.setFromAxisAngle(axis, 1.2).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a));
      b.set(i, -0.03 + Math.cos(a) * r, 0.35 + h, Math.sin(a) * r, q, 1.6, 0.9);
      continue;
    }
    // shield：同心环
    coreTop = -1;
    const ring = Math.floor(Math.sqrt(c.rank / SHARD_COUNT) * 4);
    const perRing = [10, 26, 40, 52][ring];
    const a = (c.rank % perRing) / perRing * Math.PI * 2 + t * (ring % 2 ? -0.6 : 0.6);
    const r = 0.06 + ring * 0.085;
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a + Math.PI / 2);
    b.set(i, -0.03 + Math.cos(a) * r, 0.35 + Math.sin(a) * r, 0, q, 2.2, 0.7);
  }
  blade.setCoreTop(coreTop);
  b.flush();
}

// ───── 第一人称预览：与游戏的武器场景相同的相机 / 灯光，背景放一块沙地与远处靶子 ─────
const fpScene = new THREE.Scene();
fpScene.background = new THREE.Color('#9fb4c8');
const fpCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 50);
fpScene.add(fpCamera);
fpScene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3440, 1.6));
const fpSun = new THREE.DirectionalLight(0xffffff, 1.8);
fpSun.position.set(0.6, 1, 0.4);
fpScene.add(fpSun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0xc9a878, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.6;
fpScene.add(ground);
for (let k = -2; k <= 2; k++) {
  const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 4, 12), new THREE.MeshStandardMaterial({ color: 0x5a6f86, roughness: 0.7 }));
  t.position.set(k * 1.6, -0.75, -5 - Math.abs(k));
  fpScene.add(t);
}
const fakeCtx = { time: { now: 0 }, camera: fpCamera, viewCamera: fpCamera } as unknown as GameContext;
const fpView = new BladeView(fakeCtx, 0x5a6a7a);
fpCamera.add(fpView.root);
// 英雄美术手臂（?hero=falcon|fox|bear，缺省雷隼）
const labHero = new URLSearchParams(location.search).get('hero') ?? 'falcon';
void AssetLibrary.preload().then(() => fpView.attachArtArms(AssetLibrary.findAttachments('fp', labHero), renderer));
const poseIn = createBladePoseInput();
const unionEl = $<HTMLInputElement>('union');
const COMBO = [0.3, 0.3, 0.5];
function fpFrame(dt: number, t: number): void {
  fakeCtx.time.now = t;
  const st = state.value;
  poseIn.swing = -1;
  poseIn.gesture = st === 'point' ? 'point' : st === 'shieldpose' ? 'shield' : st === 'raise' ? 'raise' : 'none';
  if (st.startsWith('slash') || st === 'combo') {
    let seg = st === 'combo' ? 0 : Number(st.slice(5));
    let local = t % (st === 'combo' ? 1.1 + 0.4 : COMBO[seg] + 0.35);
    if (st === 'combo') {
      for (seg = 0; seg < 3 && local > COMBO[seg]; seg++) local -= COMBO[seg];
      if (seg > 2) local = 99;
    }
    if (seg <= 2 && local <= COMBO[seg]) {
      poseIn.swing = seg;
      poseIn.swingP = local / COMBO[seg];
      poseIn.hitP = seg === 2 ? 0.32 : 0.27;
    }
  }
  const ov = (window as unknown as { __poseOverride?: Partial<typeof poseIn> }).__poseOverride;
  if (ov) Object.assign(poseIn, ov);
  poseIn.union = Number(unionEl.value);
  poseIn.eye = Number(eye.value);
  fpView.pose(dt, poseIn);
  fpCamera.updateMatrixWorld(true);
  fpView.animate(dt, poseIn);
}
Object.assign(window, { __view: fpView, __poseIn: poseIn });

let last = performance.now(), time = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  const w = canvas.clientWidth, h = canvas.clientHeight, pr = Math.min(2, devicePixelRatio);
  if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
  if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  blade.setAwake(Number(eye.value));
  $('eyev').textContent = eye.value;
  $('unionv').textContent = unionEl.value;
  if (view.value === 'fp') {
    fpCamera.aspect = w / h;
    fpCamera.updateProjectionMatrix();
    fpFrame(dt, time);
    renderer.render(fpScene, fpCamera);
  } else {
    pose(time);
    renderer.render(scene, camera);
  }
  readout.textContent = `碎刃 ${SHARD_COUNT} 片 · 刀身 ${BLADE_LEN} m\n面积 ${(cells.reduce((s, c) => s + c.area, 0) * 1e4).toFixed(0)} cm²\n三角形 ${(renderer.info.render.triangles)}`;
  requestAnimationFrame(frame);
}
addEventListener('resize', placeCamera);
addEventListener('keydown', (ev) => { if (ev.key === 'h') document.body.classList.toggle('clean'); });
placeCamera();
requestAnimationFrame(frame);
Object.assign(window, { __blade: blade, __lab: { view, state, eye, placeCamera, renderer, scene, camera, frame, setTime: (t: number) => { time = t; } } });

/**
 * 检视截图：按指定像素尺寸渲染一帧，发给本机截图接收服务（只在开发时手动调用；服务不在时静默失败）。
 * 用法：await __lab.capture('side.png', 1600, 600)
 */
async function capture(name: string, w: number, h: number, url = 'http://127.0.0.1:8799/'): Promise<string> {
  const pr = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  const fp = view.value === 'fp';
  const cam = fp ? fpCamera : camera;
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
  renderer.render(fp ? fpScene : scene, cam);
  const data = renderer.domElement.toDataURL('image/png');
  renderer.setPixelRatio(pr);
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data }) }).catch(() => null);
  return res && res.ok ? 'ok' : 'failed';
}
/** 第一人称定格截图：o 覆盖控制器状态（挥砍段 / 进度 / 手势），先推进若干帧让姿态过渡完成 */
async function fpShot(name: string, o: Partial<ReturnType<typeof createBladePoseInput>>, frames = 30): Promise<string> {
  view.value = 'fp';
  (window as unknown as { __poseOverride?: object }).__poseOverride = { swing: -1, gesture: 'none', ...o };
  const t0 = performance.now();
  if (o.swing !== undefined && o.swing >= 0) {
    // 从 0 推进到目标进度，经过判定帧前后的姿态
    const target = o.swingP ?? 0;
    for (let i = 0; i <= frames; i++) {
      (window as unknown as { __poseOverride: { swingP: number } }).__poseOverride.swingP = (target * i) / frames;
      frame(t0 + i * 16);
    }
  } else for (let i = 0; i < frames; i++) frame(t0 + i * 16);
  const r = await capture(name, 1280, 720);
  (window as unknown as { __poseOverride?: object }).__poseOverride = undefined;
  return r;
}
Object.assign((window as unknown as { __lab: object }).__lab, { capture, fpShot });
