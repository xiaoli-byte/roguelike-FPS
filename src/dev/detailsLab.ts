/** Local art/animation inspection entry; deliberately excluded from release entrypoints. */
import * as THREE from 'three';
import { Game } from '../core/Game';
import { Rng } from '../core/Rng';
import type { IEnemy, ThemeId, WeaponInstance } from '../core/types';
import { HEROES } from '../player/Heroes';
import { WEAPON_DEFS, getWeaponDef } from '../weapons/WeaponDefs';
import { WEAPON_HANDLING } from '../weapons/WeaponHandling';
import { Viewmodel, createViewmodelState } from '../weapons/Viewmodel';
import { AssetLibrary } from '../assets/AssetLibrary';
import { ArenaView } from '../world/ArenaBuilder';
import { generateLevel } from '../world/LevelGen';
import { THEMES } from '../world/Themes';
import { EnemyBase } from '../enemies/EnemyBase';
import { mortarSmashStepProgress } from '../enemies/types/Mortar';
import { applyArtEnvironment } from '../assets/ArtEnvironment';
import type { LevelLayout } from '../world/LevelTypes';

const select = (id: string): HTMLSelectElement => document.getElementById(id) as HTMLSelectElement;
const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const mode = select('mode'), subject = select('subject'), hero = select('hero');
const attack = select('attack'), camera = select('camera');
const targetDistance = select('target-distance');
const progress = input('progress'), play = input('play'), reload = input('reload'), aim = input('aim');
const note = document.getElementById('note')!;
const toggleControls = document.getElementById('toggle-controls') as HTMLButtonElement;
toggleControls.onclick = () => {
  const collapsed = document.getElementById('controls')!.classList.toggle('collapsed');
  toggleControls.textContent = collapsed ? '展开面板' : '收起面板';
};
await AssetLibrary.preload();
const game = new Game(), ctx = game.ctx;
ctx.player.resetForRun(HEROES[0]);
const vm = new Viewmodel(ctx); vm.init();
const state = createViewmodelState();
let arena: ArenaView | null = null, enemy: IEnemy | null = null, prop: THREE.Group | null = null, elapsed = 0;
let sceneLayout: LevelLayout | null = null;
let smashPreviewDistance = 0;
const key = new THREE.DirectionalLight(0xffe8c3, 2.2); key.position.set(3, 5, 4);
const fill = new THREE.HemisphereLight(0xdceaff, 0x303044, 1.4);
const sceneNames = { desert: '沙寺', frost: '霜山', inferno: '熔火' };
const enemyNames = { grunt: '刀兵', brute: '盾锤蛮兵', archer: '弓手', marksman: '火枪兵', mortar: '炮手', shaman: '杖师' };
const propNames = { SM_Prop_DesertReliquary: '沙寺镇灵碑', SM_Prop_DesertUrns: '沙寺陶罐组', SM_Prop_FrostShrine: '霜山石灯龛', SM_Prop_FrostPrayerCairn: '霜山祈愿石', SM_Prop_InfernoCrucible: '熔火祭炉', SM_Prop_InfernoChainObelisk: '熔火锁魂碑' };
const enemyStates: Record<string, string[]> = { grunt: ['windup', 'slash', 'recover', 'lungeWindup', 'lunge'], brute: ['chargeWindup', 'charge', 'recover', 'bashWindup', 'bash'], archer: ['aim', 'fire', 'recover'], marksman: ['aim', 'lock', 'recover'], mortar: ['brace', 'fire', 'smashWindup', 'recover'], shaman: ['castCircle', 'ward', 'recover'] };
const attackNames = { mortar: [['shell', '三连炮击'], ['smash', '炮托砸击']], shaman: [['circle', '法阵施放'], ['ward', '护佑引导']] };
const timelines: Record<string, [string, number][]> = {
  shell: [['brace', 0.9], ['fire', 0.7], ['recover', 0.8], ['move', 0.6]],
  smash: [['smashWindup', 0.55], ['recover', 0.6], ['move', 0.6]],
  circle: [['castCircle', 0.45], ['recover', 0.6], ['move', 0.6]],
  ward: [['ward', 0.7], ['recover', 0.5], ['move', 0.6]],
};

function setCamera(): void {
  if (mode.value === 'enemy') {
    const angle = camera.value === 'front' ? 0 : camera.value === 'right' ? -Math.PI / 2 : camera.value === 'left' ? Math.PI / 2 : -0.48;
    const stepCentre = subject.value === 'mortar' && attack.value === 'smash' ? smashPreviewDistance * 0.5 : 0;
    const distance = stepCentre > 0 ? 5.7 : 4.7;
    ctx.camera.position.set(Math.sin(angle) * distance, 1.8, Math.cos(angle) * distance + stepCentre);
    ctx.camera.lookAt(0, 1.28, stepCentre);
  } else if (mode.value === 'scene' && sceneLayout) {
    const L = sceneLayout;
    ctx.camera.fov = camera.value === 'focal' ? 54 : 80; ctx.camera.updateProjectionMatrix();
    if (camera.value === 'entrance') {
      ctx.camera.position.set(L.playerSpawn.x, L.floorY + 1.7, L.playerSpawn.z);
      ctx.camera.lookAt(L.center.x, L.floorY + 1.6, L.center.z);
    } else if (camera.value === 'focal') {
      const focal = L.decos.find(d => d.sceneRole === 'focal' && d.sceneLayer === 'principal') ?? L.decos.find(d => d.sceneLayer === 'principal');
      const x = focal?.x ?? L.center.x, z = focal?.z ?? L.center.z, y = focal?.y ?? L.floorY;
      ctx.camera.position.set(x - 4.2, y + 2.2, z + 5.8);
      ctx.camera.lookAt(x, y + 1.15, z);
    } else {
      ctx.camera.position.set(L.center.x + L.half * 0.35, L.floorY + L.half * 0.85, L.center.z + L.half * 0.6);
      ctx.camera.lookAt(L.center.x, L.floorY + 1.3, L.center.z);
    }
  }
}

function chooseSubject(): void {
  const choices = mode.value === 'enemy' ? attackNames[subject.value as keyof typeof attackNames] ?? [['default', '完整攻击']] : [];
  attack.replaceChildren(...choices.map(([value, name]) => new Option(name, value)));
  show();
}

function show(): void {
  arena?.dispose(); arena = null;
  sceneLayout = null;
  prop?.removeFromParent(); prop = null;
  ctx.enemies.clear?.(); enemy = null;
  smashPreviewDistance = 0;
  ctx.scene.fog = null; ctx.scene.background = new THREE.Color(0x1c2835);
  ctx.scene.add(key, fill);
  vm.setVisible(mode.value === 'weapon');
  document.getElementById('distance-control')!.hidden = mode.value !== 'enemy' || subject.value !== 'mortar' || attack.value !== 'shell';
  ctx.camera.fov = mode.value === 'scene' ? 80 : 38; ctx.camera.updateProjectionMatrix();
  if (mode.value === 'weapon') {
    const def = getWeaponDef(subject.value);
    const inst: WeaponInstance = { uid: WEAPON_DEFS.indexOf(def) + 9000 + HEROES.findIndex(h => h.id === hero.value) * 100, defId: def.id, rarity: 0, element: def.element, level: 0, mag: 0, reserve: 99, affixes: [] };
    vm.setWeapon(inst);
    note.textContent = `${def.name} · ${WEAPON_HANDLING[def.id]?.action ?? '召回'}。逐发装填显示单发进度，可暂停并拖动进度检查握点。`;
  } else if (mode.value === 'enemy') {
    enemy = ctx.enemies.spawn(subject.value, { position: new THREE.Vector3(), level: 1 });
    if (enemy) {
      ctx.scene.add(enemy.root); enemy.root.rotation.y = 0; (enemy as EnemyBase).model.scale.setScalar(1);
      if (subject.value === 'mortar' && attack.value === 'shell') {
        // Use the production ballistic aim for a stationary target; this invokes no attack/damage event.
        ctx.player.position.set(0, 0, Number(targetDistance.value)); ctx.player.velocity.set(0, 0, 0);
        const cannon = enemy as unknown as { state: string; stateTime: number; shotAge: number; prepareAim(index: number, dt: number, release: boolean): number };
        cannon.state = 'fire'; cannon.stateTime = 0; cannon.shotAge = Infinity;
        cannon.prepareAim(0, 0, true); cannon.state = 'move';
      } else if (subject.value === 'mortar') {
        ctx.player.position.set(0, 0, 2.2); ctx.player.velocity.set(0, 0, 0);
        const cannon = enemy as unknown as { prepareSmashStep(): void; smashStepTarget: THREE.Vector3 };
        cannon.prepareSmashStep(); smashPreviewDistance = cannon.smashStepTarget.z;
      }
    }
    note.textContent = subject.value === 'mortar' && attack.value === 'shell'
      ? '炮击距离决定曲射仰角。可暂停拖动进度，并切换正面或侧面检查承托、架炮、每发后坐与收势。'
      : subject.value === 'mortar'
        ? '炮托先抬举，再前踏下砸。这里按锁定落脚点检视无障碍动作；实战前踏受碰撞约束，伤害按真实炮尾接触判断。'
        : '可选择招式，暂停后拖动动作进度，并切换正面或侧面检查握点与蓄力、释放、收势。';
  } else if (mode.value === 'prop') {
    const asset = AssetLibrary.get(subject.value);
    if (!asset) { note.textContent = '这件道具尚未发布，生成和校验完成后刷新可查看。'; return; }
    prop = new THREE.Group(); const lod = new THREE.LOD(); prop.add(lod);
    asset.lods.forEach((src, i) => {
      const mesh = new THREE.Mesh(src.geometry, src.material); mesh.applyMatrix4(src.matrixWorld);
      const material = mesh.material as THREE.MeshStandardMaterial; applyArtEnvironment(material, ctx.renderer);
      lod.addLevel(mesh, asset.entry.lodDistance[i]);
    });
    ctx.scene.add(prop);
    const height = asset.entry.bounds.max[1] - asset.entry.bounds.min[1], distance = Math.max(1.8, height * 1.85);
    ctx.camera.position.set(-distance * 0.3, height * 0.7, distance); ctx.camera.lookAt(0, height * 0.45, 0);
    note.textContent = `${propNames[subject.value as keyof typeof propNames]} · 本机 Hunyuan3D 2.1 · PBR · 两级 LOD · ${Math.round((asset.entry.bytes ?? 0) / 1024)} KB。`;
  } else {
    key.removeFromParent(); fill.removeFromParent();
    const theme = subject.value as ThemeId, rng = new Rng(20261004);
    const layout = generateLevel(rng, { chapter: 0, index: 1, type: 'combat', reward: 'none', theme });
    sceneLayout = layout;
    arena = new ArenaView(ctx, layout, THEMES[theme], () => rng.next());
    ctx.scene.add(arena.group);
    note.textContent = `${sceneNames[theme]} · 固定种子场景。可切换入口、主景近看与全景，收起面板查看完整构图。正式陈设来自本机 Hunyuan3D。`;
  }
  setCamera();
  elapsed = 0;
}
function chooseMode(): void {
  const options = mode.value === 'weapon' ? WEAPON_DEFS.map(d => [d.id, d.name]) : Object.entries(mode.value === 'enemy' ? enemyNames : mode.value === 'prop' ? propNames : sceneNames);
  subject.replaceChildren(...options.map(([value, name]) => new Option(name, value)));
  const cameras = mode.value === 'scene' ? [['overview', '场景全景'], ['entrance', '入口视角'], ['focal', '主景近看']] : [['threeQuarter', '三分之四'], ['front', '正面'], ['right', '右侧'], ['left', '左侧']];
  camera.replaceChildren(...cameras.map(([value, name]) => new Option(name, value)));
  document.getElementById('attack-control')!.hidden = mode.value !== 'enemy';
  document.getElementById('camera-control')!.hidden = !['enemy', 'scene'].includes(mode.value);
  document.getElementById('hero-control')!.hidden = mode.value !== 'weapon';
  document.getElementById('progress-control')!.hidden = mode.value !== 'weapon' && mode.value !== 'enemy';
  document.getElementById('reload-control')!.hidden = mode.value !== 'weapon';
  document.getElementById('aim-control')!.hidden = mode.value !== 'weapon';
  document.getElementById('progress-label')!.textContent = mode.value === 'weapon' ? '装填进度' : '动作进度';
  chooseSubject();
}
// Shareable paused poses also survive Vite reloads while the animation is being tuned.
const initial = new URLSearchParams(location.search);
function updateLink(): void {
  const params = new URLSearchParams({ mode: mode.value, subject: subject.value, action: attack.value,
    camera: camera.value, distance: targetDistance.value, progress: progress.value, play: play.checked ? '1' : '0' });
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
mode.onchange = () => { chooseMode(); updateLink(); };
subject.onchange = () => { chooseSubject(); updateLink(); };
attack.onchange = () => { show(); updateLink(); };
camera.onchange = () => { setCamera(); updateLink(); };
targetDistance.onchange = () => { show(); updateLink(); };
progress.oninput = updateLink; play.onchange = updateLink;
hero.onchange = () => { ctx.player.resetForRun(HEROES.find(h => h.id === hero.value)!); show(); };
const chooseOption = (control: HTMLSelectElement, value: string | null): void => {
  if (value && Array.from(control.options).some(o => o.value === value)) control.value = value;
};
chooseOption(mode, initial.get('mode'));
chooseOption(targetDistance, initial.get('distance'));
chooseMode();
chooseOption(subject, initial.get('subject')); chooseSubject();
chooseOption(attack, initial.get('action')); chooseOption(camera, initial.get('camera')); show();
if (initial.has('progress')) progress.value = String(THREE.MathUtils.clamp(Number(initial.get('progress')) || 0, 0, 1));
if (initial.has('play')) play.checked = initial.get('play') === '1';
updateLink();
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (play.checked) elapsed += dt;
  ctx.time.now = elapsed;
  if (mode.value === 'weapon') {
    const def = getWeaponDef(subject.value);
    state.reloading = reload.checked;
    state.reloadP = play.checked ? (elapsed % 3.6) / 3.6 : Number(progress.value);
    if (play.checked) progress.value = String(state.reloadP);
    state.shellMode = def.reloadStyle === 'shell';
    state.aimT = aim.checked ? 1 : 0;
    if (def.id === 'demon_blade') { state.form = 'melee'; state.blades = 12; state.bladesMax = 12; }
    else state.form = null;
    vm.update(dt, state);
  } else if (enemy) {
    const base = enemy as EnemyBase;
    const animation = base as unknown as { state: string; stateTime: number; age: number; glowTarget: number[]; lastAction: string; shotAge: number; windTime: number; recoverTime: number; animate(dt: number): void };
    const phases = timelines[attack.value] ?? enemyStates[subject.value].map(s => [s, 0.8] as [string, number]);
    const total = phases.reduce((sum, [, duration]) => sum + duration, 0);
    let t = play.checked ? elapsed % total : Number(progress.value) * (total - 0.00001);
    if (play.checked) progress.value = String(t / total);
    animation.age = play.checked ? elapsed : t;
    for (const [phase, duration] of phases) {
      if (t < duration) { animation.state = phase; animation.stateTime = t; break; }
      t -= duration;
    }
    if (subject.value === 'mortar') {
      animation.lastAction = attack.value;
      animation.windTime = attack.value === 'smash' ? 0.55 : 0.9;
      animation.recoverTime = attack.value === 'smash' ? 0.6 : 0.8;
      const sampledShotAge = attack.value === 'shell'
        ? animation.state === 'fire' ? t % 0.35 : animation.state === 'recover' ? t : Infinity : Infinity;
      // Mortar.pose advances its shot clock by dt; keep the inspector's paused absolute sample exact.
      animation.shotAge = sampledShotAge - dt;
      // Absolute unobstructed preview uses the production locked step target and leg phase.
      // Combat displacement itself remains integrated through EnemyBase collision movement.
      base.position.z = attack.value === 'smash'
        ? smashPreviewDistance * (animation.state === 'smashWindup'
          ? mortarSmashStepProgress(t / 0.55) : 1) : 0;
    } else if (subject.value === 'shaman') {
      animation.lastAction = attack.value;
      animation.windTime = 0.45;
      animation.recoverTime = attack.value === 'ward' ? 0.5 : 0.6;
    }
    animation.glowTarget[0] = ['brace', 'fire', 'castCircle', 'smashWindup'].includes(animation.state) ? 1 : 0;
    animation.glowTarget[1] = animation.state === 'ward' ? 1 : 0;
    animation.animate(dt);
  } else if (prop) prop.rotation.y = elapsed * 0.3;
  else arena?.update(dt, elapsed);
  ctx.renderer.clear(); ctx.renderer.render(ctx.scene, ctx.camera);
  if (mode.value === 'weapon') { ctx.renderer.clearDepth(); ctx.renderer.render(ctx.viewScene, ctx.viewCamera); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
