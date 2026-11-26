/**
 * 第四章材质样板页（plateau-lab.html?matboard=1）——docs/art/reference-tingyuyuan.md 第四节第 10 项①。
 *
 * 一块平地上把第四章的共用材质（plateau/materials.ts 的 materials()）各摆一份：球、倒角方块、立板，前面一块名牌；
 * 后面一排地表四层（草 / 岩 / 雪 / 土）各一块纯的，再一条四层轮着混的过渡带（看按高度混层的交界）；外加灰 / 白 / 黑三个参考球。
 * 天光、雾、后期和 4-1 一模一样（同一片天光下比），面板上切晴天 / 雷暴（雷暴时下雨、慢慢淋湿、积水），
 * 逐项开关、测开销、找闪点和三张图的检视页是同一套（plateau/lookdev.ts）。
 * 拖动转视角、滚轮缩放、右键平移；1–4 机位。脚本：window.matboard（scripts/plateau/lookdev.mjs 出图用）。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FilmPost } from '../render/FilmPost';
import { buildSky, SKY } from '../world/plateau/backdrop';
import { bakeCoverMap } from '../world/plateau/coverMap';
import { HeightGrid } from '../world/plateau/grid';
import { buildLookSwitches, findFireflies, mountLookPanel, profileSwitches, snapshot, warmLook } from '../world/plateau/lookdev';
import { WORLD_UNIFORMS, materials, textTexture, type MaterialKey } from '../world/plateau/materials';
import { Rain } from '../world/plateau/rain';
import { SkyAmbient } from '../world/plateau/skyAmbient';
import { Weather } from '../world/plateau/weather';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
document.title = '第四章材质样板';
$('loading').textContent = '正在摆材质样板…';

// ───────────────────────────── 渲染器与天光（和 4-1 一样） ─────────────────────────────

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const film = new FilmPost(renderer);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(SKY.horizon, 260, 4600);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 7000);
const hemi = new THREE.HemisphereLight('#c4dbff', '#6a8a44', 1.25);
const sun = new THREE.DirectionalLight('#fff2dc', 2.9);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 1000 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.5;
sun.position.copy(SKY.sunDir).multiplyScalar(450);
scene.add(hemi, sun, sun.target);
const sky = buildSky();
scene.add(sky);

// ───────────────────────────── 地面：地表四层的样块 + 过渡带 ─────────────────────────────

const LAYERS = [
  { name: '草', color: '#5c9a34' },
  { name: '岩', color: '#8b867d' },
  { name: '雪', color: '#f4f7fb' },
  { name: '土', color: '#8c7455' },
];
const TILE_Z = -28, STRIP_Z0 = -18, STRIP_Z1 = -10;
const TILE_X = [-27, -9, 9, 27];
/** 样块以外的地：砂砾灰 */
const NEUTRAL = '#988e80';

class BoardGround extends HeightGrid {
  constructor() {
    super({ minX: -60, maxX: 60, minZ: -40, maxZ: 40 });
    const col = LAYERS.map(l => new THREE.Color(l.color));
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const x = this.X(i), z = this.Z(j), k = this.idx(i, j);
      const w = [0, 0.15, 0, 0.85];   // 别处：中性的砂土地（土八成半、岩一成半），不抢样块的颜色
      const tile = TILE_X.findIndex(cx => Math.abs(x - cx) <= 5 && Math.abs(z - TILE_Z) <= 5);
      if (tile >= 0) { w.fill(0); w[tile] = 1; }
      else if (z >= STRIP_Z0 && z <= STRIP_Z1 && Math.abs(x) <= 40) {
        // 过渡带：草 → 岩 → 雪 → 土 → 草，每 20 m 换一层（线性权重，着色器按高度混出交界）
        const t = (x + 40) / 20, a = Math.floor(Math.min(3.999, t)), f = t - a;
        w.fill(0); w[a % 4] = 1 - f; w[(a + 1) % 4] = f;
      }
      for (let q = 0; q < 4; q++) this.mat[k * 4 + q] = w[q];
      const c = new THREE.Color(0, 0, 0);
      for (let q = 0; q < 4; q++) c.r += col[q].r * w[q], c.g += col[q].g * w[q], c.b += col[q].b * w[q];
      if (tile < 0 && !(z >= STRIP_Z0 && z <= STRIP_Z1 && Math.abs(x) <= 40)) c.set(NEUTRAL);
      this.colors[k * 3] = c.r; this.colors[k * 3 + 1] = c.g; this.colors[k * 3 + 2] = c.b;
      this.grass[k] = w[0];
      this.h[k] = 0;
    }
  }
  waterLevelAt(): number { return -Infinity; }
}
const ground = new BoardGround();
for (const g of ground.buildTiles(96)) {
  const m = new THREE.Mesh(g, materials().terrain);
  m.receiveShadow = true;
  scene.add(m);
}

/** 平放在地上的名牌 */
function label(lines: string[], x: number, z: number, w = 3.2): THREE.Mesh {
  const tex = textTexture(lines, { bg: '#1c2630', fg: '#f3e6c4', w: 512, h: 160, font: 64, border: '#d9b45a' });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 160 / 512), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.rotation.x = -Math.PI / 2 + 0.5;
  m.position.set(x, 0.35, z);
  return m;
}
LAYERS.forEach((l, i) => scene.add(label([`地表 · ${l.name}`], TILE_X[i], TILE_Z + 6.5)));
scene.add(label(['混层过渡', '草 → 岩 → 雪 → 土 → 草'], -46, (STRIP_Z0 + STRIP_Z1) / 2, 6));

// ───────────────────────────── 共用材质：球 / 方块 / 立板 ─────────────────────────────

/** 每种材质摆样时用的顶点色（这一章里它最常见的颜色） */
const KIT: { key: MaterialKey; name: string; tint: string }[] = [
  { key: 'plain', name: '素色', tint: '#9a948a' },
  { key: 'stone', name: '石墙', tint: '#b3aa9c' },
  { key: 'whitewash', name: '白灰墙', tint: '#f2ede2' },
  { key: 'wood', name: '木', tint: '#9a7650' },
  { key: 'weave', name: '牦牛毛编织', tint: '#5d4c3e' },
  { key: 'tentWhite', name: '白帐篷', tint: '#efe9dc' },
  { key: 'mani', name: '玛尼石', tint: '#a2a6aa' },
  { key: 'dung', name: '牛粪墙', tint: '#7a6248' },
  { key: 'gold', name: '金顶', tint: '#d9a441' },
  { key: 'ice', name: '冰', tint: '#cfe8f4' },
  { key: 'glow', name: '雷魅邪火', tint: '#e03ac8' },
];

function tinted(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function swatch(key: MaterialKey, tint: string, x: number, z: number): void {
  const mat = materials()[key];
  const add = (g: THREE.BufferGeometry, px: number, py: number, pz: number, ry = 0): void => {
    const m = new THREE.Mesh(tinted(g, tint), mat);
    m.position.set(px, py, pz);
    m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  };
  add(new THREE.SphereGeometry(0.9, 48, 24), x - 2.3, 0.9, z);
  add(new THREE.BoxGeometry(1.6, 1.6, 1.6, 2, 2, 2), x, 0.8, z, 0.5);
  add(new THREE.BoxGeometry(1.8, 2.6, 0.18), x + 2.4, 1.3, z - 0.3, -0.35);
}
const KIT_X0 = -22.5, KIT_DX = 9;
KIT.forEach((k, i) => {
  const row = i < 6 ? 0 : 1, col = i < 6 ? i : i - 6;
  const x = KIT_X0 + col * KIT_DX, z = row === 0 ? 2 : 14;
  swatch(k.key, k.tint, x, z);
  scene.add(label([k.name, k.key], x, z + 2.6));
});
// 参考球：18% 灰、白（0.9）、黑（0.04）——判断光的强弱和冷暖
const REF: [string, string][] = [['18% 灰', '#767676'], ['白 0.9', '#f2f2f2'], ['黑 0.04', '#383838']];
REF.forEach(([n, hex], i) => {
  const m = new THREE.Mesh(tinted(new THREE.SphereGeometry(0.7, 48, 24), hex), materials().plain);
  m.position.set(KIT_X0 + 5 * KIT_DX - 1.8 + i * 1.8, 0.7, 14);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
});
scene.add(label(['参考球：灰 / 白 / 黑'], KIT_X0 + 5 * KIT_DX, 16.6));

// ───────────────────────────── 天气、雨、柔光 ─────────────────────────────

const fog = scene.fog as THREE.Fog;
const weather = new Weather({
  scene, sun, hemi, fog, clearFog: { color: fog.color.clone(), near: fog.near, far: fog.far }, stormFog: new THREE.Color(SKY.stormHorizon),
}, ground, []);
const SHADOW_SOFT = 0.62;
sun.shadow.intensity = SHADOW_SOFT;
const skyAmbient = new SkyAmbient(renderer, scene, sky, hemi);
skyAmbient.setEnabled(true);
bakeCoverMap(renderer, scene, ground, [], 1024, 0);
const rain = new Rain(scene);
weather.builtinRain = false;

// ───────────────────────────── 机位与操作 ─────────────────────────────

interface BoardView { id: string; name: string; pos: [number, number, number]; look: [number, number, number] }
const VIEWPOINTS: BoardView[] = [
  { id: 'kit', name: '共用材质', pos: [0, 10, 37], look: [0, 0.6, 7] },
  { id: 'terrain', name: '地表四层 + 过渡', pos: [0, 30, 16], look: [0, 0, -20] },
  { id: 'close', name: '近看（石 / 白灰 / 木）', pos: [-12.5, 2.4, 9.5], look: [-13.5, 1.1, 2] },
  { id: 'over', name: '全景', pos: [-34, 26, 44], look: [0, 0, -6] },
];
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
function goTo(v: BoardView): void {
  camera.position.set(...v.pos);
  controls.target.set(...v.look);
  camera.lookAt(controls.target);
  controls.update();
}

const panel = $('panel');
$('title').textContent = '第四章 · 材质样板';
$('subtitle').textContent = '共用材质、地表四层、参考球，同一片天光（4-1）下比';
document.querySelectorAll<HTMLAnchorElement>('#maps a').forEach(a => a.classList.toggle('on', a.dataset.map === 'matboard'));
for (const id of ['hud', 'map', 'cross', 'storm', 'storm-text', 'hint']) document.getElementById(id)?.remove();
if (new URLSearchParams(location.search).get('panel') === '0') panel.classList.add('collapsed');
const body = panel.querySelector<HTMLElement>('.body')!;
body.innerHTML = `<h2>机位</h2><div id="views"></div>
<h2>天气</h2><label>天气 <select id="opt-weather"><option value="clear">晴</option><option value="storm">雷暴（下雨、渐湿、积水）</option></select></label>
<div class="row">拖动转视角　滚轮缩放　右键平移　1–4 机位</div>`;
VIEWPOINTS.forEach((v, i) => {
  const b = document.createElement('button');
  b.innerHTML = `<kbd>${i + 1}</kbd>${v.name}`;
  b.onclick = () => goTo(v);
  $('views').appendChild(b);
});
$<HTMLSelectElement>('opt-weather').onchange = e => { weather.stormy = (e.target as HTMLSelectElement).value === 'storm'; };
$('toggle').textContent = panel.classList.contains('collapsed') ? '展开' : '收起';
$('toggle').onclick = () => { panel.classList.toggle('collapsed'); $('toggle').textContent = panel.classList.contains('collapsed') ? '展开' : '收起'; };
addEventListener('keydown', e => {
  const d = /^Digit([1-4])$/.exec(e.code);
  if (d) goTo(VIEWPOINTS[+d[1] - 1]);
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

goTo(VIEWPOINTS[0]);
let time = 0;
function step(dt: number): void {
  time += dt;
  WORLD_UNIFORMS.uTime.value = time;
  controls.update();
  sky.position.copy(camera.position);
  weather.update(dt, camera.position);
  rain.update(camera, weather.level, WORLD_UNIFORMS.uWind.value, fog.color, renderer.domElement.width, renderer.domElement.height, dt);
  skyAmbient.update();
}
const render = (): void => { film.render(scene, camera); };

$('loading').textContent = '正在预热着色器…';
const warmMs = await warmLook(renderer, scene, camera, render, () => film.compileScene(scene, camera));
const lookSwitches = buildLookSwitches({
  renderer, scene, film, rain,
  extra: [{ id: 'soft', label: '柔光（天空环境光 + 半透明影子）', get: () => sun.shadow.intensity !== 1, set: on => { sun.shadow.intensity = on ? SHADOW_SOFT : 1; skyAmbient.setEnabled(on); } }],
});
mountLookPanel(body, lookSwitches, { render, camera, renderer, film });
$('loading').remove();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  step(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

Object.assign(window, {
  matboard: {
    scene, camera, renderer, film, weather, rain, VIEWPOINTS, goTo, render,
    /** 按固定步长推进 seconds 秒（不渲染；检视面板隐藏时浏览器不给 rAF） */
    simulate: (seconds: number, dt = 1 / 30) => { for (let t = 0; t < seconds - 1e-9; t += dt) step(dt); },
    lookdev: {
      switches: lookSwitches, warmMs,
      profile: () => profileSwitches(renderer, render, lookSwitches),
      fireflies: (frames?: number) => findFireflies(render, camera, renderer.domElement, { frames, film }),
  snapshot: (time?: number) => snapshot(render, renderer.domElement, { time }),
    },
  },
});
