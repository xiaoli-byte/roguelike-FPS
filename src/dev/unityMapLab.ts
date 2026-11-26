import * as THREE from 'three';
import { UnitySceneView } from '../world/UnitySceneView';
import { yawFromDir } from '../core/math';
import { UnityLevelLibrary, type UnitySceneDocument } from '../world/UnityLevelLibrary';
import { CollisionWorld } from '../world/Collision';
import { desertArt, patchDesertDocument, prepareDesertArt } from '../world/desert';

const params = new URLSearchParams(location.search);
const id = params.get('map') ?? '1-1';
const response = await fetch(`/assets/unity-levels/scenes/${id}.json`);
if (!response.ok) throw new Error(`Unity 场景 ${id} 尚未生成`);
// 第一章美术重建层（src/world/desert/）：和游戏里一样先改文档；网址带 desert=0 看 Unity 原样
await prepareDesertArt(id);
const documentData = patchDesertDocument(await response.json() as UnitySceneDocument, desertArt(id));
const status = document.getElementById('status')!;
window.addEventListener('error', event => {
  status.textContent = `${event.message}\n${event.error instanceof Error ? event.error.stack : ''}`;
  document.title = 'error';
});
window.addEventListener('unhandledrejection', event => {
  status.textContent = `Promise 失败：${event.reason instanceof Error ? event.reason.stack : String(event.reason)}`;
  document.title = 'error';
});
const map = document.getElementById('map') as HTMLImageElement;
if (documentData.map) map.src = `/${documentData.map.url}`;
else map.hidden = true;
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.debug.onShaderError = (gl, program) => {
  status.textContent += `\nShader 编译失败：${gl.getProgramInfoLog(program) ?? '未知错误'}`;
};
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ba9b7);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 3000);
const spawn = documentData.spawn.position;
camera.position.set(spawn[0], spawn[1] + 1.62, spawn[2]);
camera.rotation.y = yawFromDir(documentData.spawn.forward[0], documentData.spawn.forward[2]);
const ctx = {
  scene,
  camera,
  world: new CollisionWorld(),
  settings: { quality: 'high' },
  renderer,
} as unknown as ConstructorParameters<typeof UnitySceneView>[0];
try {
  await UnityLevelLibrary.preload(documentData, (loaded, total) => {
    status.textContent = `${id} · 正在读取 Unity 场景 ${loaded}/${total}`;
  });
} catch (error) {
  status.textContent = `Unity 场景加载失败：${error instanceof Error ? error.message : String(error)}`;
  throw error;
}
status.textContent = `${id} · 预载完成，构建环境`;
await new Promise(resolve => setTimeout(resolve, 0));
if (['noSky', 'noLights', 'flat'].includes(params.get('mode') ?? '')) documentData.environment.sky = null;
const view = new UnitySceneView(ctx, documentData, {
  environment: params.get('mode') !== 'noEnv',
  groundCover: params.get('mode') !== 'noDetails',
  colliders: params.get('mode') !== 'noDetails',
  reportEnvironment: stage => { status.textContent = `${id} · ${stage}`; },
});
status.textContent = `${id} · 环境构建完成，等待视图 ready`;
await new Promise(resolve => setTimeout(resolve, 0));
scene.add(view.group);
await view.ready;
status.textContent = `${id} · 视图 ready`;
await new Promise(resolve => setTimeout(resolve, 0));
camera.updateMatrixWorld(true);
const raycaster = new THREE.Raycaster();
raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
const hits = raycaster.intersectObjects(view.group.children, true).slice(0, 3);
const diagnostic = hits.length > 0 ? hits.map(hit => `${hit.object.name || hit.object.parent?.name}@${hit.distance.toFixed(2)}`).join(' / ') : 'no hit';
const mode = params.get('mode') ?? '';
if (mode === 'noLights') scene.fog = null;
if (mode === 'background' || mode === 'blue' || mode === 'noDistantBlue' || mode === 'noTerrainBlue' || mode === 'aerial' || mode === 'terrainOnly') {
  scene.background = new THREE.Color(0x3366ff);
  scene.fog = null;
}
if (mode === 'terrainOnly') for (const child of view.group.children) {
  if (child.name && child.name !== 'Terrain_L1_1') child.visible = false;
}
if (mode === 'aerial') {
  camera.position.set(spawn[0], 160, spawn[2] - 160);
  camera.lookAt(spawn[0], 0, spawn[2]);
}
view.group.traverse(object => {
  if (mode === 'noTerrainBlue' && object.name.startsWith('Terrain')) object.visible = false;
  if (mode === 'background' && object instanceof THREE.Mesh) object.visible = false;
  if (mode === 'noLights' && object instanceof THREE.Light) object.visible = false;
  if ((mode === 'noBackdrop' || mode === 'noDistant' || mode === 'noDistantBlue') && object.name === 'Backdrop') object.visible = false;
  if ((mode === 'noFarGround' || mode === 'noDistant' || mode === 'noDistantBlue') && (object.name === 'Far Ground' || object.name === 'Far_Ground')) object.visible = false;
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return;
  if (mode === 'noSky' || mode === 'flat') {
    if (mesh.material instanceof THREE.ShaderMaterial) mesh.visible = false;
  }
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (mode === 'noTerrain') for (const material of materials) {
    if (material.name === 'Terrain') {
      material.onBeforeCompile = () => {};
      material.customProgramCacheKey = () => 'terrain-off';
      material.needsUpdate = true;
    }
  }
  if (mode === 'noPBR' || mode === 'flat') {
    const replacements = materials.map(source => source instanceof THREE.MeshStandardMaterial
      ? new THREE.MeshBasicMaterial({ map: source.map, color: source.color, transparent: source.transparent, alphaTest: source.alphaTest, side: source.side })
      : source);
    mesh.material = Array.isArray(mesh.material) ? replacements : replacements[0];
  }
});
status.textContent = `${id} · ${documentData.title}\nUnity 场景直接导出 · ${documentData.renderers.length} 个渲染节点${mode ? ` · ${mode}` : ''}\n${diagnostic}`;
document.title = 'done';
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => {
  document.title = 'rendering';
  status.textContent = `${id} · ${mode || 'full'} · 首帧渲染中`;
  renderer.render(scene, camera);
  document.title = 'rendered';
  const background = scene.background instanceof THREE.Color ? `#${scene.background.getHexString()}` : scene.background?.type ?? 'null';
  status.textContent = `${id} · ${mode || 'full'} · 已出图 · ${renderer.info.render.calls} calls / ${renderer.info.render.triangles} tris\n${diagnostic}\n背景 ${background}`;
  renderer.setAnimationLoop(null);
});
