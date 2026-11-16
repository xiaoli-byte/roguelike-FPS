/**
 * 动画检视页（anim-lab.html）：任一生物（?id=SK_Enemy_Fuzhu）逐片段播放、事件打点，或跑完整状态机。
 *   ?id=<资产>           默认 SK_Enemy_Fuzhu
 *   ?clip=<片段>         初始片段
 *   ?mode=machine        状态机模式（CreatureAnimator：Locomotion 混合、act_ 触发、叠加 Flinch、CreatureRig 看向 / 受击 / 脚步）
 *   ?strip=5             连拍：同一片段均匀取 5 个时刻并排摆开（截图用）
 *   ?t=0.4               片段模式下停在这个归一化时刻
 *   ?shot                不跑 rAF（无头截图）：window.animLab.simulate(秒) / render()
 * 片段数据：public/assets/anim/<资产>.json（scripts/web/export-native-anims.mjs）；模型：public/assets/characters/<资产>.glb。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CreatureAnimator, buildClip, clipMeta, ensureSockets, loadAnimManifest, loadCreatureAnimData } from '../anim';
import type { AnimatorEvent, ClipMeta, CreatureAnimData } from '../anim';

type Mode = 'clip' | 'machine' | 'strip';
const params = new URLSearchParams(location.search);
const assetId = params.get('id') ?? 'SK_Enemy_Fuzhu';
let mode: Mode = params.has('strip') ? 'strip' : params.get('mode') === 'machine' ? 'machine' : 'clip';
const stripCount = Math.max(2, Math.min(9, Number(params.get('strip')) || 5));
const shot = params.has('shot');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const metaEl = $('meta'), controlsEl = $('controls'), clipsEl = $('clips'), stateEl = $('state');
const timelineCanvas = $<HTMLCanvasElement>('timeline');
const view = $<HTMLCanvasElement>('view');

// ───────────── 场景 ─────────────
const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a3140);
scene.fog = new THREE.Fog(0x2a3140, 30, 90);
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 300);
const controls = new OrbitControls(camera, view);
controls.enableDamping = !shot;
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a3a28, 1.3));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.position.set(6, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: 0x3b3f48, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(120, 120, 0x59606e, 0x464c58);
(grid.material as THREE.Material).opacity = 0.35;
(grid.material as THREE.Material).transparent = true;
grid.position.y = 0.002;
scene.add(grid);

// ───────────── 数据 ─────────────
interface Lab {
  ready: boolean;
  error: string | null;
  data: CreatureAnimData | null;
  animator: CreatureAnimator | null;
  simulate: (seconds: number) => void;
  render: () => void;
  select: (clip: string) => void;
  setMode: (m: Mode) => void;
  events: AnimatorEvent[];
}
const lab: Lab = {
  ready: false, error: null, data: null, animator: null, events: [],
  simulate: () => {}, render: () => {}, select: () => {}, setMode: () => {},
};
(window as unknown as { animLab: Lab }).animLab = lab;

let data: CreatureAnimData;
let template: THREE.Object3D;
let bounds = new THREE.Box3();
let current = params.get('clip') ?? '';
let playhead = 0;
let paused = false;
const firedLog: { t: number; name: string; clip: string }[] = [];
let simTime = 0;

// 片段模式：独立的一份模型 + 混合器
let clipRoot: THREE.Group | null = null;
let clipModel: THREE.Object3D | null = null;
let clipMixer: THREE.AnimationMixer | null = null;
let clipAction: THREE.AnimationAction | null = null;
const clipCache = new Map<string, THREE.AnimationClip>();
// 状态机模式
let liveRoot: THREE.Group | null = null;
let ca: CreatureAnimator | null = null;
let walkCircle = false;
let walkAngle = 0;
let lookAtCamera = true;
// 连拍
let stripGroup: THREE.Group | null = null;
const labels: HTMLDivElement[] = [];

function getClip(name: string): THREE.AnimationClip {
  let c = clipCache.get(name);
  if (!c) clipCache.set(name, (c = buildClip(data, name)));
  return c;
}

function instance(): THREE.Object3D {
  const m = SkeletonUtils.clone(template);
  ensureSockets(m, data);
  m.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // 弱点发光壳：游戏里按前摇亮起，检视时关掉
    if (/_GlowShell/.test(mesh.name)) mesh.visible = false;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
  });
  return m;
}

const groundProbe = (_x: number, y: number, _z: number, max: number) => (y >= 0 && y - max <= 0 ? 0 : null);

// ───────────── 模式 ─────────────
function clear() {
  for (const r of [clipRoot, liveRoot, stripGroup]) if (r) scene.remove(r);
  clipMixer?.stopAllAction();
  clipRoot = liveRoot = stripGroup = null;
  clipMixer = null;
  clipAction = null;
  ca?.dispose();
  ca = null;
  lab.animator = null;
  for (const l of labels) l.remove();
  labels.length = 0;
}

function frameCamera(box: THREE.Box3, dir = new THREE.Vector3(0.55, 0.32, 1)) {
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y * 1.25, size.z) * 0.5 + 0.15;
  const dist = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, 1.25 / camera.aspect);
  camera.position.copy(center).addScaledVector(dir.normalize(), dist);
  controls.target.copy(center);
  camera.near = dist / 100;
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  controls.update();
  sun.position.copy(center).add(new THREE.Vector3(6, 12, 8).multiplyScalar(Math.max(1, radius / 2)));
  sun.target.position.copy(center);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -radius * 1.6;
  cam.right = cam.top = radius * 1.6;
  cam.far = radius * 40 + 50;
  cam.updateProjectionMatrix();
}

function setMode(m: Mode) {
  mode = m;
  clear();
  if (m === 'clip') {
    clipRoot = new THREE.Group();
    clipModel = instance();
    clipRoot.add(clipModel);
    scene.add(clipRoot);
    clipMixer = new THREE.AnimationMixer(clipModel);
    frameCamera(bounds.clone());
    select(current);
  } else if (m === 'machine') {
    liveRoot = new THREE.Group();
    const model = instance();
    liveRoot.add(model);
    scene.add(liveRoot);
    ca = new CreatureAnimator(data, model, { root: liveRoot, ground: groundProbe });
    ca.onEvent = (e) => logEvent(e.name, e.state, e.time);
    lab.animator = ca;
    frameCamera(bounds.clone().expandByScalar(Math.max(1, bounds.getSize(new THREE.Vector3()).x)));
  } else {
    buildStrip();
  }
  buildControls();
  buildClipList();
}

function buildStrip() {
  stripGroup = new THREE.Group();
  const clip = getClip(current);
  const size = bounds.getSize(new THREE.Vector3());
  const yaw = 0.9; // 侧 3/4 朝向：面朝时间前进的方向（+X）
  const footprint = Math.abs(Math.cos(yaw)) * size.x + Math.abs(Math.sin(yaw)) * size.z;
  const spacing = Math.max(footprint * 1.25, size.y * 0.55, 0.6);
  const all = new THREE.Box3();
  for (let k = 0; k < stripCount; k++) {
    const root = new THREE.Group();
    const model = instance();
    root.add(model);
    root.position.x = (k - (stripCount - 1) / 2) * spacing;
    root.rotation.y = yaw;
    stripGroup.add(root);
    const mixer = new THREE.AnimationMixer(model);
    const a = mixer.clipAction(clip);
    a.play();
    a.timeScale = 0;
    a.time = (clip.duration * k) / (stripCount - 1);
    mixer.update(0);
    root.updateMatrixWorld(true);
    all.union(new THREE.Box3().setFromObject(root, true));
    const label = document.createElement('div');
    label.style.cssText = 'position:fixed;z-index:3;transform:translate(-50%,0);color:#f6d48b;font:12px "Microsoft YaHei";text-shadow:0 1px 2px #000;pointer-events:none';
    label.textContent = `${a.time.toFixed(2)} s`;
    label.dataset.x = String(root.position.x);
    document.body.appendChild(label);
    labels.push(label);
  }
  scene.add(stripGroup);
  frameCamera(all, new THREE.Vector3(0, 0.28, 1));
}

function placeLabels() {
  const v = new THREE.Vector3();
  for (const l of labels) {
    v.set(Number(l.dataset.x), 0, bounds.max.z * 0.2).project(camera);
    l.style.left = `${((v.x + 1) / 2) * window.innerWidth}px`;
    l.style.top = `${((1 - v.y) / 2) * window.innerHeight + 6}px`;
  }
}

function select(name: string) {
  if (!data.clips[name]) return;
  current = name;
  playhead = 0;
  firedLog.length = 0;
  if (mode === 'clip' && clipMixer) {
    clipMixer.stopAllAction();
    clipAction = clipMixer.clipAction(getClip(name));
    clipAction.play();
    clipAction.timeScale = 0;
    const t = params.get('t');
    if (t !== null) { playhead = Number(t) * getClip(name).duration; paused = true; params.delete('t'); }
    applyClipTime(playhead, -1);
  } else if (mode === 'machine' && ca) {
    if (name === 'Idle' || name === 'Walk' || name === 'Move') {
      ca.playLocomotion();
      speedOverride = data.clips[name].speed ?? 0;
      const slider = document.getElementById('speed') as HTMLInputElement | null;
      if (slider) slider.value = String(speedOverride);
    } else if (name === 'Flinch') {
      ca.hit(new THREE.Vector3(0, 0, -1), 0.6, true);
    } else if (ca.hasState(name)) {
      ca.play(name);
    }
  } else if (mode === 'strip') {
    setMode('strip');
    return;
  }
  buildClipList();
}

let speedOverride = 0;

function applyClipTime(t: number, prev: number) {
  if (!clipAction || !clipMixer) return;
  const clip = clipAction.getClip();
  clipAction.time = Math.min(t, clip.duration);
  clipMixer.update(0);
  // 事件：跨过就记一笔（循环回绕时从头算）
  const meta = clipMeta(clip);
  for (const e of meta.events) {
    const crossed = prev < 0 ? e.time <= t && e.time >= 0 && t === 0 : prev <= t ? e.time > prev && e.time <= t : e.time > prev || e.time <= t;
    if (crossed) logEvent(e.name, current, e.time);
  }
}

function logEvent(name: string, clip: string, t: number) {
  firedLog.unshift({ t, name, clip });
  firedLog.length = Math.min(firedLog.length, 14);
  lab.events.push({ name, float: 0, layer: 0, state: clip, clip, time: t });
}

// ───────────── 界面 ─────────────
function button(label: string, on: boolean, click: () => void, title = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.innerHTML = label;
  if (on) b.classList.add('on');
  if (title) b.title = title;
  b.onclick = click;
  return b;
}

function buildControls() {
  controlsEl.innerHTML = '';
  const modes = document.createElement('div');
  modes.className = 'row';
  for (const [m, label] of [['clip', '片段'], ['machine', '状态机'], ['strip', '连拍']] as [Mode, string][]) modes.append(button(label, mode === m, () => setMode(m)));
  controlsEl.append(modes);
  if (mode === 'clip') {
    const row = document.createElement('div');
    row.className = 'row';
    row.append(button(paused ? '▶ 播放' : '❚❚ 暂停', false, () => { paused = !paused; buildControls(); }));
    const scrub = document.createElement('input');
    scrub.type = 'range'; scrub.min = '0'; scrub.max = '1'; scrub.step = '0.001';
    scrub.id = 'scrub';
    scrub.oninput = () => { paused = true; playhead = Number(scrub.value) * getClip(current).duration; applyClipTime(playhead, playhead); };
    row.append(scrub);
    controlsEl.append(row);
  } else if (mode === 'machine' && ca) {
    const row = document.createElement('div');
    row.className = 'row';
    const speed = document.createElement('input');
    speed.type = 'range'; speed.min = '0'; speed.max = String(Math.max(1, data.moveSpeed * 1.6)); speed.step = '0.05'; speed.value = String(speedOverride);
    speed.id = 'speed';
    speed.oninput = () => { speedOverride = Number(speed.value); };
    row.append('速度', speed);
    controlsEl.append(row);
    const acts = document.createElement('div');
    acts.className = 'row';
    for (const p of ca.animator.controller.parameters.filter((x) => x.name.startsWith('act_'))) {
      acts.append(button(p.name.slice(4), false, () => ca!.act(p.name.slice(4)), `触发 ${p.name}`));
    }
    controlsEl.append(acts);
    const misc = document.createElement('div');
    misc.className = 'row';
    misc.append(
      button('受击', false, () => ca!.hit(new THREE.Vector3(Math.random() - 0.5, 0, -1), 0.7, true), 'rig.hit + 叠加层 Flinch'),
      button('眩晕', false, () => ca!.play('Hit', 0.05), 'CrossFade 到 Hit 状态'),
      button('回移动', false, () => ca!.playLocomotion()),
      button('绕圈', walkCircle, () => { walkCircle = !walkCircle; buildControls(); }, '根节点绕圈走：看混合树、转弯倾斜、脚步锁定'),
      button('看镜头', lookAtCamera, () => { lookAtCamera = !lookAtCamera; buildControls(); }),
    );
    controlsEl.append(misc);
  }
}

function buildClipList() {
  clipsEl.innerHTML = '';
  for (const [name, c] of Object.entries(data.clips)) {
    const tag = [c.loop ? '↻' : '', c.events.length ? `◆${c.events.length}` : '', c.derived ? '派生' : '', c.next ? `→${c.next}` : ''].filter(Boolean).join(' ');
    const b = button(`<span>${name}</span><small>${c.duration.toFixed(2)}s ${tag}</small>`, name === current, () => select(name),
      c.unity === 'keyframed' ? 'Unity 里这个状态换成了 Blender 手 K 片段（网页暂用采样片段）' : '');
    if (c.unity === 'keyframed') b.classList.add('keyed');
    clipsEl.append(b);
  }
}

function drawTimeline() {
  const dpr = Math.min(2, window.devicePixelRatio);
  const w = timelineCanvas.clientWidth, h = timelineCanvas.clientHeight;
  if (timelineCanvas.width !== w * dpr) { timelineCanvas.width = w * dpr; timelineCanvas.height = h * dpr; }
  const g = timelineCanvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const def = data.clips[current];
  if (!def) return;
  const x0 = 16, x1 = w - 16, axisY = 44, dur = Math.max(def.duration, 1e-3);
  const X = (t: number) => x0 + ((x1 - x0) * t) / dur;
  g.font = '13px "Microsoft YaHei"';
  g.fillStyle = '#f6d48b';
  g.fillText(`${data.asset} · ${current}  ${def.duration.toFixed(3)} s · ${def.frames} 帧${def.loop ? ' · 循环' : ''}${def.next ? ` · 连段 → ${def.next}` : ''}${def.unity === 'keyframed' ? ' · Unity 用手 K 片段' : ''}`, x0, 18);
  g.strokeStyle = '#6b7183';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(x0, axisY); g.lineTo(x1, axisY); g.stroke();
  g.fillStyle = '#8b90a0';
  g.font = '11px "Microsoft YaHei"';
  const step = dur > 3 ? 0.5 : dur > 1.2 ? 0.25 : 0.1;
  for (let t = 0; t <= dur + 1e-6; t += step) {
    g.fillRect(X(t), axisY - 4, 1, 8);
    g.fillText(t.toFixed(2), X(t) - 10, axisY - 8);
  }
  // 事件打点：同一时刻的叠成一列
  const lanes = new Map<number, number>();
  const colors: Record<string, string> = { hit: '#ff6b5a', projectile: '#ffb347', explode: '#ff8a3d' };
  for (const e of def.events) {
    const key = Math.round(e.t * 1000);
    const lane = lanes.get(key) ?? 0;
    lanes.set(key, lane + 1);
    const color = colors[e.name] ?? (e.name.startsWith('sfx:') ? '#7fc8ff' : e.name.startsWith('fx:') ? '#b98cff' : '#9fe08a');
    const x = X(Math.min(e.t, dur));
    g.fillStyle = color;
    g.beginPath(); g.moveTo(x, axisY + 4); g.lineTo(x - 5, axisY + 12); g.lineTo(x + 5, axisY + 12); g.fill();
    g.fillText(`${e.name} ${e.t.toFixed(2)}`, Math.min(x + 6, x1 - 120), axisY + 24 + lane * 14);
  }
  // 播放头 / 连拍取样点
  g.fillStyle = '#f6d48b';
  if (mode === 'strip') {
    for (let k = 0; k < stripCount; k++) { const x = X((dur * k) / (stripCount - 1)); g.fillRect(x - 1, axisY - 14, 2, 28); }
  } else if (mode === 'clip') {
    const x = X(playhead % (dur + 1e-9));
    g.fillRect(x - 1, axisY - 16, 2, 32);
  } else if (mode === 'machine' && ca) {
    // 底层当前状态就是这个片段时，按它的归一化时刻画播放头
    const cs = ca.animator.currentState(0);
    if (cs?.name === current) {
      const n = def.loop ? cs.normalizedTime - Math.floor(cs.normalizedTime) : Math.min(1, cs.normalizedTime);
      g.fillRect(X(n * dur) - 1, axisY - 16, 2, 32);
    }
  }
  // 最近派发的事件
  g.fillStyle = '#c9c3b6';
  g.font = '12px "Microsoft YaHei"';
  const tail = firedLog.slice(0, 5).map((e) => `${e.clip} ${e.name}@${e.t.toFixed(2)}`).join('   ');
  if (tail) g.fillText(`已派发：${tail}`, x0, h - 10);
}

function drawState() {
  if (mode === 'machine' && ca) {
    const sm = ca.animator;
    const lines = [`状态机 ${sm.controller.name}`];
    sm.layers.forEach((l, i) => {
      const cs = sm.currentState(i);
      lines.push(`层 ${l.def.name}：${cs?.name ?? '-'} ${cs ? cs.normalizedTime.toFixed(2) : ''}${cs?.inTransition ? '（过渡中）' : ''}`);
      const w = Object.entries(sm.clipWeights(i)).filter(([, v]) => v > 0.005).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('，');
      if (w) lines.push(`  ${w}`);
    });
    lines.push(`Speed ${sm.getFloat('Speed').toFixed(2)}  MoveScale ${sm.getFloat('MoveScale').toFixed(2)}  ActScale ${sm.getFloat('ActScale').toFixed(2)}`);
    const rig = ca.rig;
    if (rig) lines.push(`腿 ${rig.legs.length}（锁 ${rig.legs.filter((l) => l.locked).length}）  倾斜 ${rig.lean.toFixed(1)}°  受击 ${rig.hitAngleDeg.toFixed(1)}°`);
    for (const e of firedLog.slice(0, 6)) lines.push(`◆ ${e.clip} ${e.name} @${e.t.toFixed(2)}s`);
    stateEl.textContent = lines.join('\n');
  } else {
    const def = data.clips[current];
    const m: ClipMeta | null = clipCache.has(current) ? clipMeta(getClip(current)) : null;
    stateEl.textContent = [`片段 ${current}`, `${def.frames} 帧 · ${def.duration.toFixed(3)} s · 曲线 ${def.tracks.length}`, `事件 ${m?.events.length ?? def.events.length}`,
      mode === 'clip' ? `播放头 ${playhead.toFixed(3)} s` : `连拍 ${stripCount} 张`].join('\n');
  }
}

// ───────────── 循环 ─────────────
function step(dt: number) {
  simTime += dt;
  if (mode === 'clip' && clipAction) {
    if (!paused) {
      const d = clipAction.getClip().duration;
      const prev = playhead;
      playhead += dt;
      if (playhead > d) playhead = clipMeta(clipAction.getClip()).loop ? playhead % d : 0;
      applyClipTime(playhead, prev);
      const scrub = document.getElementById('scrub') as HTMLInputElement | null;
      if (scrub) scrub.value = String(playhead / Math.max(d, 1e-3));
    }
  } else if (mode === 'machine' && ca && liveRoot) {
    if (walkCircle) {
      const r = 3, v = Math.max(0.5, speedOverride || data.moveSpeed || 2);
      walkAngle += (v / r) * dt;
      liveRoot.position.set(Math.sin(walkAngle) * r, 0, Math.cos(walkAngle) * r - r);
      liveRoot.rotation.y = walkAngle + Math.PI / 2;
      ca.locomotion.speedOverride = -1;
    } else {
      ca.locomotion.speedOverride = speedOverride;
    }
    if (ca.rig) ca.rig.lookTarget = lookAtCamera ? camera.position.clone() : null;
    ca.update(dt);
  }
}

function render() {
  if (mode === 'strip') placeLabels();
  renderer.render(scene, camera);
  drawTimeline();
  drawState();
}

lab.simulate = (seconds: number) => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) step(1 / 60);
};
lab.render = render;
lab.select = select;
lab.setMode = setMode;

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  render();
});

async function main() {
  const [manifest, d] = await Promise.all([loadAnimManifest().catch(() => null), loadCreatureAnimData(assetId)]);
  data = d;
  lab.data = d;
  const draco = new DRACOLoader();
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(`${import.meta.env.BASE_URL}${d.glb}`);
  template = gltf.scene;
  template.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(template, true);
  if (!current || !d.clips[current]) current = Object.keys(d.clips).find((k) => d.clips[k].events.length && !['Idle', 'Walk', 'Move'].includes(k)) ?? 'Idle';
  const info = manifest?.assets[assetId];
  // 资产切换
  const pick = document.createElement('select');
  for (const id of Object.keys(manifest?.assets ?? { [assetId]: 1 })) {
    const o = document.createElement('option');
    o.value = o.textContent = id;
    if (id === assetId) o.selected = true;
    pick.append(o);
  }
  pick.onchange = () => { params.set('id', pick.value); params.delete('clip'); location.search = params.toString(); };
  metaEl.textContent = [
    `${d.asset}（${d.defId ?? '-'}）`,
    `${Object.keys(d.clips).length} 个片段（${Object.values(d.clips).filter((c) => !c.derived).length} 采样），驱动 ${d.nodes.length} 个节点`,
    `移动片段录制速度 ${d.moveSpeed} m/s`,
    info?.keyframed.length ? `Unity 改用手 K 的状态（虚线）：${info.keyframed.join('、')}` : '',
    info?.pending.length ? `只有手 K、网页还没有的：${info.pending.join('、')}` : '',
  ].filter(Boolean).join('\n');
  metaEl.before(pick);
  setMode(mode);
  render();
  lab.ready = true;
  if (!shot) {
    const clock = new THREE.Clock();
    const loop = () => {
      step(Math.min(1 / 30, clock.getDelta()));
      controls.update();
      render();
      requestAnimationFrame(loop);
    };
    loop();
  }
}

main().catch((e) => {
  lab.error = String(e?.stack ?? e);
  metaEl.textContent = `读取失败：${e?.message ?? e}`;
  console.error(e);
});
