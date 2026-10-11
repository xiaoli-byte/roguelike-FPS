/** Interactive training harness: real player, weapon, collision, damage and fragment recall. */
import * as THREE from 'three';
import { Game } from '../core/Game';
import { HEROES } from '../player/Heroes';
import { EnemyBase } from '../enemies/EnemyBase';
import { registerEnemy } from '../enemies/Registry';
import type { EnemyDef, DamageResult } from '../core/types';
import { BLADE_SHARDS } from '../weapons/DemonBladeModel';

const game = new Game(), ctx = game.ctx;
const $ = (id: string) => document.getElementById(id)!;
const gate = $('gate'), canvas = ctx.dom.canvas;
let playing = false, last = performance.now(), hits = 0, damage = 0, hitUntil = 0;
let fallback = false;
ctx.settings.damageNumbers = false;
ctx.settings.quality = 'high';
ctx.settings.fov = 80;
ctx.renderer.shadowMap.enabled = false;
ctx.run.flags.manualBladeRecall = 1;
ctx.scene.background = new THREE.Color(0x151c30);
ctx.scene.fog = new THREE.Fog(0x151c30, 30, 65);
ctx.scene.add(new THREE.HemisphereLight(0xd4dfff, 0x38304e, 2));
const light = new THREE.DirectionalLight(0xf5eeff, 2.5); light.position.set(-4, 8, 3); ctx.scene.add(light);
const violet = new THREE.DirectionalLight(0x8965ff, 1.6); violet.position.set(6, 4, -14); ctx.scene.add(violet);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x252d43, roughness: .85 });
const floor = new THREE.Mesh(new THREE.BoxGeometry(32, .3, 40), floorMat); floor.position.set(0, -.15, -10); ctx.scene.add(floor);
ctx.world.addBox(-16, -.3, -30, 16, 0, 10, 'floor');
const grid = new THREE.GridHelper(32, 32, 0x556080, 0x333f59); grid.position.set(0, .003, -10); ctx.scene.add(grid);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x303951, roughness: .8 });
function wall(x: number, z: number, w: number, depth: number): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 5, depth), wallMat); mesh.position.set(x, 2.5, z); ctx.scene.add(mesh);
  ctx.world.addCentered(x, 2.5, z, w, 5, depth);
}
wall(0, -29, 32, .4); wall(-16, -10, .4, 40); wall(16, -10, .4, 40); wall(0, 10, 32, .4);
const stripeMat = new THREE.MeshBasicMaterial({ color: 0x956bff });
for (let i = -3; i <= 3; i++) {
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(.04, 3.7, .02), stripeMat);
  stripe.position.set(i * 4, 2.3, -28.78); ctx.scene.add(stripe);
}

const targetGeo = new THREE.CapsuleGeometry(.38, .95, 6, 12);
const ringGeo = new THREE.TorusGeometry(.26, .022, 6, 24);
const pedestalGeo = new THREE.CylinderGeometry(.65, .73, .08, 24);
const targetDef: EnemyDef = { id: 'blade_training_target', name: '试射靶', hp: 1000000,
  speed: 0, radius: .38, height: 1.75, headY: 1.58, headRadius: .21,
  damage: 0, coins: [0, 0], essence: 0, knockbackResist: 1, color: 0xa98cff };
class TrainingTarget extends EnemyBase {
  protected buildModel(): THREE.Object3D {
    const root = new THREE.Group();
    const body = new THREE.Mesh(targetGeo, new THREE.MeshStandardMaterial({ color: 0x5d7189, roughness: .45, emissive: 0x1e1933, emissiveIntensity: .25 }));
    body.position.y = .85; root.add(body);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: 0xd4b8ff, emissive: 0x754fa8, emissiveIntensity: 1 }));
    ring.position.set(0, 1.15, .37); root.add(ring);
    const pedestal = new THREE.Mesh(pedestalGeo, floorMat); pedestal.position.y = .04; root.add(pedestal);
    return root;
  }
  protected think(): void {}
  protected override onHurt(_result: DamageResult): void { this.hp = this.maxHp; }
}
registerEnemy(targetDef, (context, opts) => new TrainingTarget(context, targetDef, opts));
for (const [x, z] of [[0, -7], [-3.5, -10], [3.5, -10], [-6, -16], [0, -18], [6, -16]])
  ctx.enemies.spawn(targetDef.id, { position: new THREE.Vector3(x, 0, z), level: 1 });
ctx.events.on('enemy:damaged', ({ result }) => {
  hits++; damage += result.dealt; hitUntil = ctx.time.now + .12;
});

function reset(): void {
  ctx.input.releaseAll(); ctx.input.flushMouse();
  ctx.projectiles.clear?.(); ctx.fx.clear?.(); ctx.combat.clear?.();
  ctx.player.resetForRun(HEROES[0]); ctx.player.teleport(new THREE.Vector3(0, 0, 0), 0);
  ctx.weapons.resetForRun('demon_blade', 'ranged');
  ctx.weapons.setViewmodelVisible(true);
  hits = damage = hitUntil = 0;
  // Warm the real hand pose and target appearance without accepting any input.
  ctx.input.enabled = false;
  for (let i = 0; i < 45; i++) { ctx.player.update?.(1 / 60); ctx.weapons.update?.(1 / 60); ctx.enemies.update?.(1 / 60); }
  last = performance.now(); updateHud();
}
function pause(): void {
  playing = false; ctx.input.enabled = false; ctx.input.releaseAll(); ctx.input.flushMouse();
  gate.hidden = false; $('gate-title').textContent = '继续驾驭千刃'; $('start').textContent = '继续试射';
  ctx.input.exitLock();
}
function start(): void {
  playing = true; gate.hidden = true; last = performance.now();
  ctx.input.releaseAll(); ctx.input.flushMouse(); ctx.input.enabled = true;
  canvas.focus(); ctx.audio.unlock(); ctx.input.requestLock();
}
ctx.input.onLockChange = locked => {
  if (locked) { fallback = false; $('connection').textContent = '鼠标已锁定，Esc 释放鼠标。'; }
  else if (playing) pause();
};
document.addEventListener('pointerlockerror', () => {
  fallback = true;
  $('connection').textContent = '当前浏览器使用自由光标瞄准；J 射击、C 切换形态也可用。';
});
// Cursor aiming remains usable in browser panels which do not support Pointer Lock.
canvas.addEventListener('mousemove', event => {
  if (!playing || ctx.input.pointerLocked) return;
  fallback = true;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * 2 - 1;
  const y = 1 - (event.clientY - rect.top) / rect.height * 2;
  const tan = Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov / 2));
  ctx.player.yaw = -Math.atan(x * tan * ctx.camera.aspect);
  ctx.player.pitch = Math.atan(y * tan / Math.sqrt(1 + (x * tan * ctx.camera.aspect) ** 2));
});
ctx.input.bindings.fire = ['KeyJ']; ctx.input.bindings.aim = ['KeyC'];
// Process a tap while it is actually held, including clicks shorter than a rendering frame.
window.addEventListener('mousedown', event => {
  if (playing && event.button === 0 && (ctx.input.pointerLocked || event.target === canvas)) ctx.weapons.update?.(0);
});
window.addEventListener('keydown', event => {
  if (!playing) return;
  if (event.code === 'Escape' || event.code === 'KeyP') pause();
  else if (!event.repeat && event.code === 'KeyJ') ctx.weapons.update?.(0);
});
window.addEventListener('blur', () => { if (playing) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });
canvas.addEventListener('click', () => { if (playing && !ctx.input.pointerLocked && !fallback) ctx.input.requestLock(); });
$('start').onclick = start;
$('menu').onclick = pause;
$('restart').onclick = () => { reset(); $('gate-title').textContent = '亲手驾驭千刃'; $('start').textContent = '开始试射'; };

function updateHud(): void {
  const inst = ctx.weapons.active;
  const n = inst?.mag ?? 0, uid = inst?.uid ?? 0;
  $('ammo-count').innerHTML = `${n} <span>/ ${BLADE_SHARDS}</span>`;
  const ranged = ctx.weapons.activeForm === 'ranged';
  $('form').textContent = ranged ? '千刃 · 远程' : '斩 · 近战';
  const recalling = ctx.weapons.isReloading;
  $('status').textContent = recalling ? `正在召回 · ${Math.round(ctx.weapons.reloadProgress * 100)}%`
    : !ranged ? '左键三段连斩 · 右键切回远程后召回'
    : n === 0 ? '刀身已空 · 按 R 召回全部碎片' : '松开左键停火 · 按 R 召回';
  const skill=ctx.weapons.weaponSkill;
  $('blade-skill').textContent=skill ? `V · ${skill.name} · ${skill.active?'施展中':skill.cooldownRemaining>0?`${skill.cooldownRemaining.toFixed(1)} 秒`:'就绪'}` : '';
  $('blade-skill').dataset.skill=skill?.id??'';
  $('blade-skill').dataset.cooldown=String(skill?.cooldownRemaining??0);
  $('stats').textContent = `命中 ${hits} 次\n累计伤害 ${damage.toFixed(1)}\n悬停 / 召回碎片 ${ctx.projectiles.retainedBladeFragments(uid)}${fallback ? '\n自由光标瞄准 · J 射击 / C 换形' : ''}`;
  $('crosshair').classList.toggle('hit', ctx.time.now < hitUntil);
  $('hud').dataset.ammo = String(n); $('stats').dataset.hits = String(hits);
  $('hud').dataset.pitch = String(ctx.player.pitch); $('hud').dataset.yaw = String(ctx.player.yaw);
  $('stats').dataset.retained = String(ctx.projectiles.retainedBladeFragments(uid));
}
reset();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (playing) {
    ctx.time.now += dt; ctx.time.dt = dt; ctx.time.frame++;
    ctx.player.update?.(dt); ctx.weapons.update?.(dt); ctx.enemies.update?.(dt);
    ctx.projectiles.update?.(dt); ctx.combat.update?.(dt); ctx.fx.update?.(dt); ctx.audio.update?.(dt);
  }
  ctx.renderer.clear(); ctx.renderer.render(ctx.scene, ctx.camera);
  ctx.renderer.clearDepth(); ctx.renderer.render(ctx.viewScene, ctx.viewCamera);
  updateHud(); ctx.input.endFrame();
}
requestAnimationFrame(frame);

