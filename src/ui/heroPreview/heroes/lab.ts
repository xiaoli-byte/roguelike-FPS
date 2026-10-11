/**
 * 英雄模型实验页（仅开发用，入口 /hero-lab.html，不参与打包）。
 * 一张画布分六个视口：正面、右前 3/4、右侧、背面、头部正面特写、头部 3/4 特写。
 *
 * URL 参数：
 *  - hero=fox|falcon|bear
 *  - t=秒：把待机动画推进到该时刻后定格（默认 1.0）
 *  - intro=秒：在 t 时刻触发 playIntro()，再推进 intro 秒后定格（用于检查亮相动作的某一帧）
 *  - anim=1：持续播放（默认定格，便于截图）
 *  - fid=序号&fu=秒：待机小动作定格（heroShows.ts）
 *  - nogun=1：不挂武器
 */
import * as THREE from 'three';
import { HEROES } from '../../../player/Heroes';
import { getWeaponDef } from '../../../weapons/WeaponDefs';
import { buildGunModel } from '../../../weapons/WeaponModels';
import { buildHeroModel } from './index';
import { AssetLibrary } from '../../../assets/AssetLibrary';
import { heroWhiteReview } from '../../../dev/heroWhiteReview';

const params = new URLSearchParams(location.search);
const heroId = params.get('hero') ?? 'fox';
const hero = HEROES.find((h) => h.id === heroId) ?? HEROES[0];
const T = Number(params.get('t') ?? 1);
const INTRO = params.has('intro') ? Number(params.get('intro')) : -1;
const ANIM = params.get('anim') === '1';
const WHITE = params.has('white');
const GRIP = params.get('grip') === '1';

const canvas = document.getElementById('lab') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setScissorTest(true);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xfff1dc, 0x231a26, 1.25));
const key = new THREE.DirectionalLight(0xffe0b0, 2.4);
key.position.set(2.5, 4, 3.5);
scene.add(key);
const rim = new THREE.DirectionalLight(hero.color, 2.6);
rim.position.set(-3, 3, -3.5);
scene.add(rim);
const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2530, roughness: 0.9 }));
scene.add(floor);

await AssetLibrary.preload();
const rig = buildHeroModel(hero.id, hero.color);
scene.add(rig.root);
if (params.get('nogun') !== '1') {
  const def = getWeaponDef(hero.startingWeapon);
  rig.hand.add(buildGunModel(def.id, 0, def.element).root);
}
// fid=序号&fu=秒：把待机小动作定格在某一帧（heroShows.ts 的 fidgets）
if (params.has('fid')) rig.root.userData.forceFidget = { index: Number(params.get('fid')), u: Number(params.get('fu') ?? 1) };
const prepareWhite = WHITE ? heroWhiteReview(scene, rig.root) : null;

let t = 0;
const step = 1 / 60;
const advance = (to: number): void => {
  while (t < to) {
    t += step;
    rig.update(step, t);
  }
};
advance(T);
if (INTRO >= 0) {
  rig.playIntro();
  advance(T + INTRO);
}

const H = rig.height;
const views: { label: string; pos: [number, number, number]; target: [number, number, number]; fov: number }[] = [
  { label: '正面', pos: [0, H * 0.6, 4.6], target: [0, H * 0.5, 0], fov: 32 },
  { label: '右前 3/4（持枪侧）', pos: [-3.2, H * 0.62, 3.3], target: [0, H * 0.5, 0], fov: 32 },
  { label: '右侧', pos: [-4.6, H * 0.6, 0], target: [0, H * 0.5, 0], fov: 32 },
  { label: '背面', pos: [0, H * 0.65, -4.6], target: [0, H * 0.5, 0], fov: 32 },
  { label: '头部正面', pos: [0, H * 0.86, 1.7], target: [0, H * 0.86, 0], fov: 26 },
  { label: '头部 3/4', pos: [-1.2, H * 0.88, 1.25], target: [0, H * 0.85, 0], fov: 26 },
];
const cams = views.map((v) => {
  const c = new THREE.PerspectiveCamera(v.fov, 1, 0.05, 50);
  c.position.set(...v.pos);
  c.lookAt(new THREE.Vector3(...v.target));
  return c;
});

const labels = document.getElementById('labels') as HTMLDivElement;
if (GRIP) { views[4].label = '持枪近看 · 前侧'; views[5].label = '持枪近看 · 外侧'; }
views.forEach((v) => {
  const d = document.createElement('div');
  d.textContent = v.label;
  labels.appendChild(d);
});
(document.getElementById('title') as HTMLDivElement).textContent = `${hero.name} · ${hero.title}  t=${t.toFixed(2)}${INTRO >= 0 ? `  intro+${INTRO}s` : ''}  高 ${H.toFixed(2)}m`;

const COLS = 3;
const ROWS = 2;
const gripPoint = new THREE.Vector3();
function render(): void {
  prepareWhite?.();
  if (GRIP) {
    rig.hand.getWorldPosition(gripPoint);
    for (const [i,offset] of [[4,[-.6,.28,.75]],[5,[-.85,.2,-.25]]] as const) {
      cams[i].position.copy(gripPoint).add(new THREE.Vector3(...offset));
      cams[i].lookAt(gripPoint); cams[i].fov = 32;
    }
  }
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  const cw = Math.floor(w / COLS);
  const ch = Math.floor(h / ROWS);
  cams.forEach((cam, i) => {
    const x = (i % COLS) * cw;
    const y = h - (Math.floor(i / COLS) + 1) * ch;
    renderer.setViewport(x, y, cw, ch);
    renderer.setScissor(x, y, cw, ch);
    renderer.setClearColor(i % 2 ? 0x1c1822 : 0x211c27, 1);
    renderer.clear();
    cam.aspect = cw / ch;
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
  });
}

if (ANIM) {
  let last = performance.now();
  const loop = (now: number): void => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    rig.update(dt, t);
    render();
  };
  requestAnimationFrame(loop);
} else {
  render();
  window.addEventListener('resize', render);
}
(window as unknown as { __lab: unknown }).__lab = { rig, scene, cams, render };
