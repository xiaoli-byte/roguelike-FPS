/**
 * 英雄演出逐帧检查页（hero-show.html）：把出场或一个小动作按时间点渲染成一张网格（选人界面的 3/4 机位，
 * 加一列侧面），一次截图看完整段动作。截图工具在页面停止重绘后容易超时，所以这里渲染一次就停。
 *
 *   /hero-show.html?hero=fox                     出场，默认 12 个时间点
 *   /hero-show.html?hero=bear&times=0,0.3,0.6     指定时间点（秒）
 *   /hero-show.html?hero=falcon&fid=1             第 1 个小动作（heroShows.ts 的 fidgets）
 *   &idle=1                                       待机（从 t=4 起每 0.5 秒一帧）
 *   &side=1                                       每帧加一张右侧视角
 *   &save=名字                                    把网格图交给本机保存服务（127.0.0.1:8799，开发检查用）
 */
import * as THREE from 'three';
import { HEROES } from '../player/Heroes';
import { buildHeroModel } from '../ui/heroPreview/heroes/index';
import { getWeaponDef } from '../weapons/WeaponDefs';
import { buildGunModel } from '../weapons/WeaponModels';
import { AssetLibrary } from '../assets/AssetLibrary';

const params = new URLSearchParams(location.search);
const heroId = params.get('hero') ?? 'fox';
const hero = HEROES.find((h) => h.id === heroId) ?? HEROES[0];
const fid = params.has('fid') ? Number(params.get('fid')) : -1;
const idle = params.get('idle') === '1';
const side = params.get('side') === '1';

await AssetLibrary.preload();
const rig = buildHeroModel(hero.id, hero.color);
const def = getWeaponDef(hero.startingWeapon);
rig.hand.add(buildGunModel(def.id, 0, def.element).root);
const dur = rig.show?.intro ?? 1.5;
const times = params.has('times') ? params.get('times')!.split(',').map(Number)
  : Array.from({ length: 12 }, (_, i) => (i / 11) * (fid >= 0 ? 2.4 : idle ? 5.5 : dur));

const W = 320, H = 380;
const cols = side ? 2 : 4;
const n = times.length * (side ? 2 : 1);
const rows = Math.ceil(n / cols);
const sheet = document.getElementById('sheet') as HTMLCanvasElement;
sheet.width = cols * W;
sheet.height = rows * H;
const g = sheet.getContext('2d')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x221d29);
scene.add(new THREE.HemisphereLight(0xfff1dc, 0x231a26, 1.25));
const key = new THREE.DirectionalLight(0xffe0b0, 2.4);
key.position.set(2.5, 4, 3.5);
scene.add(key);
const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3040, roughness: 0.9 }));
scene.add(floor);
const pivot = new THREE.Group();
pivot.rotation.y = 27 * Math.PI / 180;     // 选人界面的默认朝向
pivot.add(rig.root);
scene.add(pivot);
const h = rig.height;
const cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 40);
const camSide = new THREE.PerspectiveCamera(32, W / H, 0.1, 40);
const far = 0.68 * h / Math.tan((16 * Math.PI) / 180);
cam.position.set(0, 0.55 * h, far);
cam.lookAt(0, 0.6 * h, 0);
camSide.position.set(-far, 0.55 * h, 0.2);
camSide.lookAt(0, 0.6 * h, 0);

let t = 0;
const step = 1 / 60;
const advance = (to: number): void => {
  while (t < to - 1e-6) {
    t += step;
    rig.update(step, t);
  }
};
advance(4);
let base = t;
if (fid >= 0) {
  // 小动作由模型自己调度；这里每帧强制成「第 fid 个、进行到 u 秒」
  base = t;
} else if (!idle) {
  rig.playIntro();
  base = t;
}
let k = 0;
for (const at of times) {
  if (fid >= 0) {
    rig.root.userData.forceFidget = { index: fid, u: at };
    advance(base + at + step);
  } else advance(base + at);
  for (const c of side ? [cam, camSide] : [cam]) {
    renderer.render(scene, c);
    const x = (k % cols) * W, y = Math.floor(k / cols) * H;
    g.drawImage(renderer.domElement, x, y);
    g.fillStyle = '#f3d9a0';
    g.font = '14px Microsoft YaHei';
    g.fillText(`${at.toFixed(2)}s${c === camSide ? ' 侧' : ''}`, x + 8, y + 18);
    k++;
  }
}
(document.getElementById('title') as HTMLDivElement).textContent =
  `${hero.name} · ${fid >= 0 ? `小动作 ${fid}` : idle ? '待机' : `出场 ${dur}s`}`;
// &save=名字：把网格图交给本机的保存服务（开发检查用，没有服务时忽略）
const save = params.get('save');
if (save) await fetch(`http://127.0.0.1:8799/save?name=${encodeURIComponent(save)}.png`, { method: 'POST', body: sheet.toDataURL('image/png') }).catch(() => undefined);
document.title = 'done';
