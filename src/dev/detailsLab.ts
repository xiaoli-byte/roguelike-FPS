/** Local art/animation inspection entry; deliberately excluded from release entrypoints. */
import * as THREE from 'three';
import { Game } from '../core/Game';
import { Rng } from '../core/Rng';
import type { IEnemy, StageNode, StageType, ThemeId, WeaponInstance } from '../core/types';
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
import type { LayoutBox, LevelLayout } from '../world/LevelTypes';
import { preloadSceneSurface } from '../world/Textures';
import { applyHandPaintedEnvironment } from '../world/SceneSurfaceMaterial';
import { getStageDesign } from '../world/StageDesign';

const select = (id: string): HTMLSelectElement => document.getElementById(id) as HTMLSelectElement;
const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const mode = select('mode'), subject = select('subject'), hero = select('hero');
const attack = select('attack'), camera = select('camera');
const targetDistance = select('target-distance');
const sceneStage = select('scene-stage'), sceneType = select('scene-type');
const initial = new URLSearchParams(location.search);
const inspectionSeed = Number(initial.get('seed') ?? 20261004) >>> 0;
const progress = input('progress'), play = input('play'), reload = input('reload'), aim = input('aim');
const note = document.getElementById('note')!;
const toggleControls = document.getElementById('toggle-controls') as HTMLButtonElement;
toggleControls.onclick = () => {
  const collapsed = document.getElementById('controls')!.classList.toggle('collapsed');
  toggleControls.textContent = collapsed ? '展开面板' : '收起面板';
};
// Paused inspections must not freeze before the authored ground maps arrive.
await Promise.all([AssetLibrary.preload(), preloadSceneSurface()]);
const game = new Game(), ctx = game.ctx;
ctx.player.resetForRun(HEROES[0]);
const vm = new Viewmodel(ctx); vm.init();
const state = createViewmodelState();
let arena: ArenaView | null = null, enemy: IEnemy | null = null, prop: THREE.Group | null = null, elapsed = 0;
const propMaterials = new Map<THREE.Material, THREE.Material>();
let sceneLayout: LevelLayout | null = null;
let smashPreviewDistance = 0;
let redrawUntil = 0;
function requestRedraw(): void {
  // Weapon and enemy poses use damped transitions; let them settle after an
  // edit before freezing the paused image and releasing its GPU workload.
  redrawUntil = performance.now() + 600;
}
document.getElementById('controls')!.addEventListener('input', requestRedraw);
document.getElementById('controls')!.addEventListener('change', requestRedraw);
window.addEventListener('resize', requestRedraw);
document.addEventListener('visibilitychange', () => { if (!document.hidden) requestRedraw(); });
ctx.renderer.domElement.addEventListener('webglcontextrestored', requestRedraw);
const key = new THREE.DirectionalLight(0xffe8c3, 2.2); key.position.set(3, 5, 4);
const fill = new THREE.HemisphereLight(0xdceaff, 0x303044, 1.4);
const sceneNames = { desert: '沙寺', frost: '霜山', inferno: '熔火' };
const sceneThemes: ThemeId[] = ['desert', 'frost', 'inferno'];
const enemyNames = { grunt: '刀兵', brute: '盾锤蛮兵', archer: '弓手', marksman: '火枪兵', mortar: '炮手', shaman: '杖师' };
const propNames = {
  SM_Prop_DesertReliquary: '沙寺镇灵碑', SM_Prop_DesertUrns: '沙寺陶罐组',
  SM_Prop_FrostShrine: '霜山石灯龛', SM_Prop_FrostPrayerCairn: '霜山祈愿石',
  SM_Prop_InfernoCrucible: '熔火祭炉', SM_Prop_InfernoChainObelisk: '熔火锁魂碑',
  SM_Env_DesertSandstone: '沙寺侵蚀砂岩', SM_Env_FrostPine: '霜山积雪松树', SM_Env_InfernoBasalt: '熔火断裂玄武岩',
  SM_Env_DesertRuin: '沙寺残垣壁龛', SM_Env_FrostWayshrine: '霜山山道祭亭', SM_Env_InfernoFoundry: '熔火铸造祭炉',
  SM_Env_DesertWall: '沙寺院墙', SM_Env_DesertGate: '沙寺开放门楼',
  SM_Env_FrostWall: '霜山雪覆院墙', SM_Env_FrostGate: '霜山开放寺门',
  SM_Env_InfernoWall: '熔火堡墙', SM_Env_InfernoGate: '熔火开放堡门',
  SM_Env_DesertCliff: '沙寺宽断崖', SM_Env_FrostCliff: '霜山雪覆断崖', SM_Env_InfernoCliff: '熔火宽玄武断崖',
};
const enemyStates: Record<string, string[]> = { grunt: ['windup', 'slash', 'recover', 'lungeWindup', 'lunge'], brute: ['chargeWindup', 'charge', 'recover', 'bashWindup', 'bash'], archer: ['aim', 'fire', 'recover'], marksman: ['aim', 'lock', 'recover'], mortar: ['brace', 'fire', 'smashWindup', 'recover'], shaman: ['castCircle', 'ward', 'recover'] };
const attackNames = { mortar: [['shell', '三连炮击'], ['smash', '炮托砸击']], shaman: [['circle', '法阵施放'], ['ward', '护佑引导']] };
const timelines: Record<string, [string, number][]> = {
  shell: [['brace', 0.9], ['fire', 0.7], ['recover', 0.8], ['move', 0.6]],
  smash: [['smashWindup', 0.55], ['recover', 0.6], ['move', 0.6]],
  circle: [['castCircle', 0.45], ['recover', 0.6], ['move', 0.6]],
  ward: [['ward', 0.7], ['recover', 0.5], ['move', 0.6]],
};

function selectedSceneStage(): StageNode {
  const theme = subject.value as ThemeId, index = Math.max(0, Math.min(4, Number(sceneStage.value) || 0));
  const type = sceneType.value === 'auto' ? index === 4 ? 'boss' : 'combat' : sceneType.value as StageType;
  return { chapter: sceneThemes.indexOf(theme), index, type, theme, reward: 'none' };
}

function refreshStageChoices(): void {
  const index = sceneStage.value || initial.get('stage') || '0';
  const theme = subject.value as ThemeId, chapter = sceneThemes.indexOf(theme);
  sceneStage.replaceChildren(...Array.from({ length: 5 }, (_, i) => new Option(
    `${i + 1} · ${getStageDesign({ chapter, index: i, theme, type: i === 4 ? 'boss' : 'combat' }).title}`, String(i))));
  sceneStage.value = Array.from(sceneStage.options).some(o => o.value === index) ? index : '0';
}

function refreshSceneCameras(L: LevelLayout): void {
  const current = camera.value;
  const options = [['overview', '区域全景'], ['entrance', '入口视角'], ['focal', '主景近看'],
    ['objective', L.adventure ? '祭坛区域' : L.type === 'boss' ? '首领场地' : '目的地区域']];
  for (const [i, site] of (L.adventure?.sites ?? []).entries()) options.push([`site-${i}`, site.label]);
  for (const [i, encounter] of (L.adventure?.encounters ?? []).entries()) options.push([`encounter-${i}`, encounter.label]);
  camera.replaceChildren(...options.map(([value, name]) => new Option(name, value)));
  camera.value = options.some(([value]) => value === current) ? current : 'overview';
}

function groundSceneCamera(L: LevelLayout, p: { x: number; z: number }, distance: number): void {
  const focus = new THREE.Vector3(p.x, L.floorY + 1.3, p.z);
  const approach = new THREE.Vector3(L.playerSpawn.x - p.x, 0, L.playerSpawn.z - p.z);
  if (approach.lengthSq() < 1e-6) approach.set(Math.sin(L.playerYaw), 0, Math.cos(L.playerYaw));
  approach.normalize().multiplyScalar(distance);
  const preferred = focus.clone().add(approach); preferred.y = L.floorY + 2.8;
  ctx.camera.position.copy(clearSceneCamera(L, focus, preferred));
  ctx.camera.lookAt(focus);
}

/** Keep ground-level inspection presets out of the real scene envelopes. */
function clearSceneCamera(L: LevelLayout, focus: THREE.Vector3, preferred: THREE.Vector3): THREE.Vector3 {
  const boxes = L.boxes.filter(b => b.look !== 'invisible');
  const inside = (p: THREE.Vector3, b: LayoutBox): boolean =>
    p.x >= b.minX - .35 && p.x <= b.maxX + .35
    && p.y >= b.minY - .35 && p.y <= b.maxY + .35
    && p.z >= b.minZ - .35 && p.z <= b.maxZ + .35;
  const obscures = (p: THREE.Vector3, b: LayoutBox): boolean => {
    // The last metre may enter the inspected prop itself. Earlier rock/wall
    // intersections still reject the viewpoint, including a camera in a cliff.
    let enter = 0, exit = Math.max(0, 1 - 1 / p.distanceTo(focus));
    for (const [start, delta, low, high] of [
      [p.x, focus.x - p.x, b.minX - .1, b.maxX + .1],
      [p.y, focus.y - p.y, b.minY - .1, b.maxY + .1],
      [p.z, focus.z - p.z, b.minZ - .1, b.maxZ + .1],
    ]) {
      if (Math.abs(delta) < 1e-8) { if (start < low || start > high) return false; continue; }
      const a = (low - start) / delta, c = (high - start) / delta;
      enter = Math.max(enter, Math.min(a, c)); exit = Math.min(exit, Math.max(a, c));
      if (enter > exit) return false;
    }
    return true;
  };
  const distance = Math.hypot(preferred.x - focus.x, preferred.z - focus.z);
  const angle = Math.atan2(preferred.x - focus.x, preferred.z - focus.z);
  const angles = [0];
  for (let i = 1; i < 8; i++) angles.push(i * Math.PI / 8, -i * Math.PI / 8);
  angles.push(Math.PI);
  let safeFallback: THREE.Vector3 | undefined;
  // First preserve the original distance and eye height; only move closer if
  // the whole ring is occluded. Never lift the camera into an overhead view.
  for (const scale of [1, .8, .6, .4, .2]) for (const offset of angles) {
    const candidate = scale === 1 && offset === 0 ? preferred : new THREE.Vector3(
      focus.x + Math.sin(angle + offset) * distance * scale, preferred.y,
      focus.z + Math.cos(angle + offset) * distance * scale);
    if (candidate.x < L.minX + .35 || candidate.x > L.maxX - .35
      || candidate.z < L.minZ + .35 || candidate.z > L.maxZ - .35
      || boxes.some(b => inside(candidate, b))) continue;
    safeFallback ??= candidate;
    if (!boxes.some(b => obscures(candidate, b))) return candidate;
  }
  // Adventure destinations reserve an open interaction area. A final close
  // position stays there if every more distant composition is obstructed.
  return safeFallback ?? new THREE.Vector3(focus.x, preferred.y, focus.z);
}

function setCamera(): void {
  requestRedraw();
  if (mode.value === 'prop' && prop) {
    const bounds = new THREE.Box3().setFromObject(prop);
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    const angle = prop.rotation.y + (camera.value === 'front' ? 0 : camera.value === 'back' ? Math.PI : camera.value === 'right' ? -Math.PI / 2 : camera.value === 'left' ? Math.PI / 2 : -.3);
    const distance = Math.max(1.8, size.y * 1.85, Math.hypot(size.x, size.z) * 1.2);
    ctx.camera.position.set(center.x + Math.sin(angle) * distance, bounds.min.y + size.y * .7, center.z + Math.cos(angle) * distance);
    ctx.camera.lookAt(center.x, bounds.min.y + size.y * .45, center.z);
  } else if (mode.value === 'enemy') {
    const angle = camera.value === 'front' ? 0 : camera.value === 'right' ? -Math.PI / 2 : camera.value === 'left' ? Math.PI / 2 : -0.48;
    const stepCentre = subject.value === 'mortar' && attack.value === 'smash' ? smashPreviewDistance * 0.5 : 0;
    const distance = stepCentre > 0 ? 5.7 : 4.7;
    ctx.camera.position.set(Math.sin(angle) * distance, 1.8, Math.cos(angle) * distance + stepCentre);
    ctx.camera.lookAt(0, 1.28, stepCentre);
  } else if (mode.value === 'scene' && sceneLayout) {
    const L = sceneLayout;
    ctx.camera.fov = camera.value === 'overview' ? 58 : camera.value === 'focal' ? 54 : 80; ctx.camera.updateProjectionMatrix();
    if (camera.value === 'entrance') {
      ctx.camera.position.set(L.playerSpawn.x, L.floorY + 1.7, L.playerSpawn.z);
      ctx.camera.lookAt(L.playerSpawn.x - Math.sin(L.playerYaw) * 12, L.floorY + 1.6,
        L.playerSpawn.z - Math.cos(L.playerYaw) * 12);
    } else if (camera.value === 'focal') {
      const focal = L.decos.find(d => d.kind === 'landmark' && d.sceneRole === 'focal')
        ?? L.decos.find(d => d.sceneRole === 'focal' && d.sceneLayer === 'principal') ?? L.decos.find(d => d.sceneLayer === 'principal');
      const x = focal?.x ?? L.center.x, z = focal?.z ?? L.center.z, y = focal?.y ?? L.floorY;
      if (focal?.footprint) {
        const height = focal.footprint.height * focal.s, angle = focal.yaw - .4, distance = height * 1.85;
        ctx.camera.position.set(x + Math.sin(angle) * distance, y + height * .55, z + Math.cos(angle) * distance);
        ctx.camera.lookAt(x, y + height * .42, z);
      } else {
        ctx.camera.position.set(x - 4.2, y + 2.2, z + 5.8);
        ctx.camera.lookAt(x, y + 1.15, z);
      }
    } else if (camera.value === 'objective') {
      groundSceneCamera(L, L.adventure?.objective ?? (L.type === 'boss' ? L.bossPoint : L.rewardPoint), Math.max(8, L.half * .28));
    } else if (camera.value.startsWith('encounter-') && L.adventure) {
      const encounter = L.adventure.encounters?.[Number(camera.value.slice(10))];
      if (encounter) groundSceneCamera(L, encounter, Math.max(8, encounter.arenaRadius * .9));
    } else if (camera.value.startsWith('site-') && L.adventure) {
      const index = Number(camera.value.slice(5)), p = L.adventure.sites[index] ?? L.adventure.sites[0];
      if (!p) return;
      const landmark = L.decos.filter(d => d.kind === 'landmark').sort((a, b) =>
        Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      if (landmark?.footprint) {
        const x = (p.x + landmark.x) * .5, z = (p.z + landmark.z) * .5;
        const height = landmark.footprint.height * landmark.s, angle = landmark.yaw - .6;
        const distance = Math.max(10, height * 2.1);
        const focus = new THREE.Vector3(x, L.floorY + height * .3, z);
        ctx.camera.position.copy(clearSceneCamera(L, focus,
          new THREE.Vector3(x + Math.sin(angle) * distance, L.floorY + height * .5, z + Math.cos(angle) * distance)));
        ctx.camera.lookAt(focus);
      } else {
        groundSceneCamera(L, p, 9);
      }
    } else {
      ctx.camera.position.set(L.center.x + L.half * 0.85, L.floorY + L.half * 1.45, L.center.z + L.half * 1.5);
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
  requestRedraw();
  arena?.dispose(); arena = null;
  sceneLayout = null;
  prop?.removeFromParent(); prop = null;
  for (const material of propMaterials.values()) material.dispose();
  propMaterials.clear();
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
    const cloneMaterial = (source: THREE.Material): THREE.Material => {
      let material = propMaterials.get(source);
      if (!material) {
        material = source.clone();
        if (material instanceof THREE.MeshStandardMaterial) {
          applyArtEnvironment(material, ctx.renderer);
          applyHandPaintedEnvironment(material, asset.id);
        }
        propMaterials.set(source, material);
      }
      return material;
    };
    asset.lods.forEach((src, i) => {
      const material = Array.isArray(src.material) ? src.material.map(cloneMaterial) : cloneMaterial(src.material);
      const mesh = new THREE.Mesh(src.geometry, material); mesh.applyMatrix4(src.matrixWorld);
      lod.addLevel(mesh, asset.entry.lodDistance[i]);
    });
    ctx.scene.add(prop);
    const height = asset.entry.bounds.max[1] - asset.entry.bounds.min[1], distance = Math.max(1.8, height * 1.85);
    ctx.camera.position.set(-distance * 0.3, height * 0.7, distance); ctx.camera.lookAt(0, height * 0.45, 0);
    const generator = asset.entry.generator?.mode === 'multiview' ? 'Hunyuan3D 2mv 四视图' : 'Hunyuan3D 2.1';
    note.textContent = `${propNames[subject.value as keyof typeof propNames]} · 本机 ${generator} · PBR · ${asset.lods.length} 级 LOD · ${Math.round((asset.entry.bytes ?? 0) / 1024)} KB。`;
  } else {
    key.removeFromParent(); fill.removeFromParent();
    refreshStageChoices();
    const stage = selectedSceneStage(), design = getStageDesign(stage), theme = stage.theme;
    const rng = new Rng(inspectionSeed ^ (stage.chapter * 7919 + stage.index * 104729 + 17));
    const layout = generateLevel(rng, stage, { adventure: AssetLibrary.enabled });
    sceneLayout = layout;
    const visual = rng.fork(0x51ed);
    arena = new ArenaView(ctx, layout, THEMES[theme], () => visual.next());
    ctx.scene.add(arena.group);
    refreshSceneCameras(layout);
    const guidance = stage.type === 'shop' ? '休整院落：寻找商人，购买补给与强化武器。'
      : stage.type === 'treasure' ? '宝藏院落：没有敌人，寻找宝箱与出口。' : `${design.routeHint} ${design.combatHint}`;
    note.textContent = `${stage.chapter + 1}-${stage.index + 1} · ${design.title}。${guidance}`;
  }
  setCamera();
  elapsed = 0;
}
function chooseMode(): void {
  const options = mode.value === 'weapon' ? WEAPON_DEFS.map(d => [d.id, d.name]) : Object.entries(mode.value === 'enemy' ? enemyNames : mode.value === 'prop' ? propNames : sceneNames);
  subject.replaceChildren(...options.map(([value, name]) => new Option(name, value)));
  const cameras = mode.value === 'scene' ? [['overview', '区域全景'], ['entrance', '入口视角'], ['focal', '主景近看'], ['objective', '祭坛区域'], ['site-0', '支路补给一'], ['site-1', '支路补给二'], ['site-2', '支路补给三']] : [['threeQuarter', '三分之四'], ['front', '正面'], ['right', '右侧'], ['left', '左侧'], ...(mode.value === 'prop' ? [['back', '背面']] : [])];
  camera.replaceChildren(...cameras.map(([value, name]) => new Option(name, value)));
  document.getElementById('attack-control')!.hidden = mode.value !== 'enemy';
  document.getElementById('camera-control')!.hidden = !['enemy', 'scene', 'prop'].includes(mode.value);
  document.getElementById('scene-stage-control')!.hidden = mode.value !== 'scene';
  document.getElementById('scene-type-control')!.hidden = mode.value !== 'scene';
  document.getElementById('hero-control')!.hidden = mode.value !== 'weapon';
  document.getElementById('progress-control')!.hidden = mode.value !== 'weapon' && mode.value !== 'enemy';
  document.getElementById('reload-control')!.hidden = mode.value !== 'weapon';
  document.getElementById('aim-control')!.hidden = mode.value !== 'weapon';
  document.getElementById('progress-label')!.textContent = mode.value === 'weapon' ? '装填进度' : '动作进度';
  chooseSubject();
}
// Shareable paused poses also survive Vite reloads while the animation is being tuned.
function updateLink(): void {
  requestRedraw();
  const params = new URLSearchParams({ mode: mode.value, subject: subject.value, action: attack.value,
    camera: camera.value, distance: targetDistance.value, progress: progress.value, play: play.checked ? '1' : '0' });
  if (mode.value === 'scene') {
    params.set('stage', sceneStage.value); params.set('type', sceneType.value); params.set('seed', String(inspectionSeed));
  }
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
mode.onchange = () => { chooseMode(); updateLink(); };
subject.onchange = () => { chooseSubject(); updateLink(); };
sceneStage.onchange = sceneType.onchange = () => { show(); updateLink(); };
attack.onchange = () => { show(); updateLink(); };
camera.onchange = () => { setCamera(); updateLink(); };
targetDistance.onchange = () => { show(); updateLink(); };
progress.oninput = updateLink; play.onchange = updateLink;
hero.onchange = () => { ctx.player.resetForRun(HEROES.find(h => h.id === hero.value)!); show(); };
const chooseOption = (control: HTMLSelectElement, value: string | null): void => {
  if (value && Array.from(control.options).some(o => o.value === value)) control.value = value;
};
chooseOption(mode, initial.get('mode'));
chooseOption(sceneType, initial.get('type'));
chooseOption(targetDistance, initial.get('distance'));
chooseMode();
chooseOption(subject, initial.get('subject')); chooseSubject();
chooseOption(attack, initial.get('action')); chooseOption(camera, initial.get('camera')); show();
if (initial.has('progress')) progress.value = String(THREE.MathUtils.clamp(Number(initial.get('progress')) || 0, 0, 1));
if (initial.has('play')) play.checked = initial.get('play') === '1';
updateLink();
let last = performance.now();
function frame(now: number): void {
  // Paused previews redraw only while edits settle. Playing scene inspection
  // is capped at 30 Hz; playing weapon/enemy animation retains normal RAF.
  if ((!play.checked && now > redrawUntil)
    || ((mode.value === 'scene' || !play.checked) && now - last < 1000 / 30 - .5)) {
    requestAnimationFrame(frame); return;
  }
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
