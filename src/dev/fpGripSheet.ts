/**
 * 第一人称握持总览（fp-grip.html）：一位英雄 × 全部武器，每把枪渲染一格第一人称视角（待机，不开镜、不换弹），
 * 拼成一张网格图，一次看完美术手臂和每把枪的握点是否对得上。
 *
 *   /fp-grip.html?hero=fox|bear|falcon        &weapons=smg,rifle  只看几把
 *   &save=名字                                  把网格图交给本机保存服务（127.0.0.1:8799，开发检查用）
 *   &zoom=1.6                                   放大画面右下角（第一人称模型在那里）
 *   &reload=0.45                                换弹进行到该进度（0–1）时的画面；不给则是待机
 *   &aim=1                                      开镜
 */
import * as THREE from 'three';
import { Game } from '../core/Game';
import type { WeaponInstance } from '../core/types';
import { HEROES } from '../player/Heroes';
import { WEAPON_DEFS } from '../weapons/WeaponDefs';
import { Viewmodel, createViewmodelState } from '../weapons/Viewmodel';
import { AssetLibrary } from '../assets/AssetLibrary';

const params = new URLSearchParams(location.search);
const hero = HEROES.find((h) => h.id === params.get('hero')) ?? HEROES[0];
const only = params.get('weapons')?.split(',');
const defs = WEAPON_DEFS.filter((d) => !only || only.includes(d.id));
const zoom = Number(params.get('zoom') ?? 1.6);
const reloadAt = params.has('reload') ? Number(params.get('reload')) : -1;
const aim = params.get('aim') === '1';

await AssetLibrary.preload();
const game = new Game();
const ctx = game.ctx;
ctx.player.resetForRun(hero);
const vm = new Viewmodel(ctx);
vm.init();
vm.setVisible(true);
const state = createViewmodelState();
const { renderer, viewScene, viewCamera } = ctx;
const W = 400, H = 300;
renderer.setPixelRatio(1);
renderer.setSize(Math.round(W * zoom), Math.round(H * zoom), false);
viewCamera.aspect = W / H;
viewCamera.updateProjectionMatrix();
viewScene.background = new THREE.Color(0x2a3140);
viewScene.add(new THREE.HemisphereLight(0xdceaff, 0x303044, 1.6));
const key = new THREE.DirectionalLight(0xffe8c3, 2.2);
key.position.set(3, 5, 4);
viewScene.add(key);

const cols = 4;
const sheet = document.getElementById('sheet') as HTMLCanvasElement;
sheet.width = cols * W;
sheet.height = Math.ceil(defs.length / cols) * H;
const g = sheet.getContext('2d')!;
let i = 0;
for (const def of defs) {
  const inst: WeaponInstance = { uid: 9000 + i, defId: def.id, rarity: 0, element: def.element, level: 0, mag: 10, reserve: 99, affixes: [] };
  vm.setWeapon(inst);
  state.reloading = false;
  state.aimT = aim ? 1 : 0;
  for (let f = 0; f < 90; f++) vm.update(1 / 60, state);    // 换枪的抬起动作走完、阻尼稳定
  if (reloadAt >= 0) {
    state.reloading = true;
    state.shellMode = def.reloadStyle === 'shell';
    state.reloadP = reloadAt;
    for (let f = 0; f < 40; f++) vm.update(1 / 60, state);  // 换弹姿势的阻尼走完
  }
  renderer.render(viewScene, viewCamera);
  const src = renderer.domElement;
  // 只取右下 1/zoom 的区域（模型在画面右下）
  g.drawImage(src, src.width * (1 - 1 / zoom), src.height * (1 - 1 / zoom), src.width / zoom, src.height / zoom,
    (i % cols) * W, Math.floor(i / cols) * H, W, H);
  g.fillStyle = '#f3d9a0';
  g.font = '15px Microsoft YaHei';
  g.fillText(`${def.name}（${def.id}）`, (i % cols) * W + 8, Math.floor(i / cols) * H + 20);
  i++;
}
(document.getElementById('title') as HTMLDivElement).textContent = `${hero.name} · 第一人称${reloadAt >= 0 ? `换弹 ${reloadAt}` : '握持'} · ${defs.length} 把`;
const save = params.get('save');
if (save) await fetch(`http://127.0.0.1:8799/save?name=${encodeURIComponent(save)}.png`, { method: 'POST', body: sheet.toDataURL('image/png') }).catch(() => undefined);
document.title = 'done';
