import * as THREE from 'three';
import { MouseLookFilter } from '../core/MouseLookFilter';
import { Atmosphere, atmosphereForChapter } from '../world/Atmosphere';

/**
 * 空气透视检视页（atmosphere-lab.html）：同一个机位开 / 关对比。
 *   ?map=1-1      读 Unity 导出的场景（public/assets/unity-levels/scenes）；不带 map 是一片程序生成的层叠山谷
 *   ?atmo=0       关掉空气透视（只剩场景原有的雾）；?cloud=0 只关云影
 *   ?view=sun|cross|vista|spawn   机位：朝太阳 / 侧对太阳 / 升到 34 m 俯瞰 / 出生朝向
 *   ?base=12      低雾基准高度（默认：出生点脚下往下 2 m）；?t=30 云影推进到第几秒；?still 只出一帧
 * 操作：点画面锁定鼠标转视角，WASD 飞行（Shift 加速），F 开关空气透视，C 开关云影。
 */
const params = new URLSearchParams(location.search);
const status = document.getElementById('status')!;
const canvas = document.getElementById('view') as HTMLCanvasElement;
addEventListener('error', event => { status.textContent = `${event.message}`; document.title = 'error'; });
addEventListener('unhandledrejection', event => { status.textContent = `Promise 失败：${event.reason instanceof Error ? event.reason.stack : String(event.reason)}`; document.title = 'error'; });

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.debug.onShaderError = (gl, program) => { status.textContent = `Shader 编译失败：${gl.getProgramInfoLog(program) ?? '未知错误'}`; document.title = 'error'; };
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 4000);
camera.rotation.order = 'YXZ';

const mapId = params.get('map');
let chapter = 1, spawn = new THREE.Vector3(0, 0, 40), spawnYaw = 0, updateScene: (dt: number, t: number) => void = () => {};
if (mapId) {
  // Unity 场景的网页端读取模块还没入库：用 glob 按需载入（文件不在时是空表），检视页不对它们形成编译期依赖
  const modules = import.meta.glob<any>(['../world/UnitySceneView.ts', '../world/UnityLevelLibrary.ts', '../world/Collision.ts']);
  const load = (path: string): Promise<any> => {
    const loader = modules[path];
    if (!loader) throw new Error(`缺少 ${path}：Unity 场景的网页端读取模块不在这个工作区`);
    return loader();
  };
  const [{ UnitySceneView }, { UnityLevelLibrary }, { CollisionWorld }] = await Promise.all([load('../world/UnitySceneView.ts'), load('../world/UnityLevelLibrary.ts'), load('../world/Collision.ts')]);
  const response = await fetch(`/assets/unity-levels/scenes/${mapId}.json`);
  if (!response.ok) throw new Error(`Unity 场景 ${mapId} 尚未导出`);
  const doc = await response.json();
  await UnityLevelLibrary.preload(doc, (loaded: number, total: number) => { status.textContent = `${mapId} · 读取 ${loaded}/${total}`; });
  const view = new UnitySceneView({ scene, camera, world: new CollisionWorld(), settings: { quality: 'high' }, renderer }, doc, { environment: true, groundCover: true, colliders: false });
  scene.add(view.group);
  await view.ready;
  chapter = Number(mapId[0]) || 1;
  spawn = new THREE.Vector3().fromArray(doc.spawn.position);
  spawnYaw = Math.atan2(-doc.spawn.forward[0], -doc.spawn.forward[2]);
  updateScene = (dt, t) => view.update(dt, t);
} else {
  buildValley(scene);
}

const sun = scene.getObjectByProperty('isDirectionalLight', true) as THREE.DirectionalLight | undefined;
const toSun = sun ? sun.getWorldPosition(new THREE.Vector3()).sub(sun.target.getWorldPosition(new THREE.Vector3())).normalize() : new THREE.Vector3(0.5, 0.4, -0.7);
const sunYaw = Math.atan2(-toSun.x, -toSun.z);
const eye = spawn.clone().add(new THREE.Vector3(0, 1.62, 0));
const viewName = params.get('view') ?? 'spawn';
camera.position.copy(viewName === 'vista' ? spawn.clone().add(new THREE.Vector3(0, 34, 0)) : eye);
camera.rotation.set(viewName === 'vista' ? -0.2 : 0.03, viewName === 'sun' ? sunYaw : viewName === 'cross' ? sunYaw + Math.PI / 2 : spawnYaw, 0);

const profile = atmosphereForChapter(chapter);
// 调参：网址里带上字段名就覆盖默认值（?mistDensity=0.004&cloudShadow=0.5&cloudTile=600）
for (const key of Object.keys(profile) as (keyof typeof profile)[]) if (params.has(key)) profile[key] = Number(params.get(key));
const cloudShadow = profile.cloudShadow;
let on = params.get('atmo') !== '0', clouds = params.get('cloud') !== '0';
const baseY = params.has('base') ? Number(params.get('base')) : spawn.y - 2;
const apply = (): void => {
  if (on) {
    profile.cloudShadow = clouds ? cloudShadow : 0;
    Atmosphere.bind(scene, profile, { baseY });
  } else Atmosphere.unbind();
};
apply();

// 鼠标视角：复用 MouseLookFilter + unadjustedMovement（裸 movementX 会漂）
const look = new MouseLookFilter(), keys = new Set<string>();
canvas.addEventListener('click', () => { void (canvas.requestPointerLock as (options?: { unadjustedMovement: boolean }) => Promise<void> | void)({ unadjustedMovement: true }); });
document.addEventListener('pointerlockchange', () => look.reset());
document.addEventListener('mousemove', event => {
  if (document.pointerLockElement !== canvas) return;
  const m = look.sample(event.movementX, event.movementY, event.timeStamp);
  camera.rotation.y -= m.x * 0.0022;
  camera.rotation.x = Math.max(-1.5, Math.min(1.5, camera.rotation.x - m.y * 0.0022));
});
addEventListener('keydown', event => {
  keys.add(event.code);
  if (event.code === 'KeyF') { on = !on; apply(); }
  if (event.code === 'KeyC') { clouds = !clouds; apply(); }
});
addEventListener('keyup', event => keys.delete(event.code));
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const still = params.has('still'), t0 = Number(params.get('t') ?? 0), clock = new THREE.Clock(), move = new THREE.Vector3();
let frames = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.1, clock.getDelta()), t = t0 + (still ? 0 : clock.elapsedTime);
  move.set(Number(keys.has('KeyD')) - Number(keys.has('KeyA')), Number(keys.has('KeyE')) - Number(keys.has('KeyQ')), Number(keys.has('KeyS')) - Number(keys.has('KeyW')));
  if (move.lengthSq() > 0) camera.position.add(move.normalize().applyQuaternion(camera.quaternion).multiplyScalar((keys.has('ShiftLeft') ? 60 : 14) * dt));
  updateScene(dt, t);
  Atmosphere.update(t);
  renderer.render(scene, camera);
  if (++frames === 3) document.title = 'rendered';
  status.textContent = `${mapId ?? '层叠山谷'} · 空气透视 ${on ? '开' : '关'}（F）· 云影 ${on && clouds && cloudShadow > 0 ? '开' : '关'}（C）· 基准高度 ${baseY.toFixed(1)} m\n` +
    `${renderer.info.render.calls} calls / ${renderer.info.render.triangles} tris`;
});

/** 没有地图时的检视场景：一条山谷，五排越远越高的山，低角度侧光，雾终点在最远一排之外 */
function buildValley(target: THREE.Scene): void {
  const fogColor = new THREE.Color(0.86, 0.78, 0.66);
  target.background = fogColor;
  target.fog = new THREE.Fog(fogColor, 400, 1900);
  target.add(new THREE.HemisphereLight(new THREE.Color(0.44, 0.52, 0.78), new THREE.Color(0.44, 0.33, 0.25), 1.6));
  const light = new THREE.DirectionalLight(new THREE.Color(1, 0.86, 0.68), 3.2);
  light.position.set(170, 95, -120);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, { left: -220, right: 220, top: 220, bottom: -220, near: 1, far: 700 });
  target.add(light, light.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  target.add(ground);
  const rock = new THREE.MeshStandardMaterial({ color: 0x7c7468, roughness: 1, flatShading: true });
  let seed = 7;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [distance, count, height, radius] of [[70, 7, 26, 12], [140, 8, 48, 18], [240, 9, 80, 28], [400, 10, 130, 46], [700, 12, 210, 80]]) {
    for (let i = 0; i < count; i++) {
      const a = -1.2 + 2.4 * (i + rnd() * 0.7) / count, d = distance * (0.85 + 0.4 * rnd()), h = height * (0.6 + 0.8 * rnd());
      // 中线留出一条谷：越靠近视线正前方的山越矮
      const peak = new THREE.Mesh(new THREE.ConeGeometry(radius * (0.7 + 0.6 * rnd()), h * (0.35 + 0.65 * Math.min(1, Math.abs(a) * 2.2)), 7), rock);
      peak.position.set(Math.sin(a) * d, peak.geometry.parameters.height / 2 - 1, -Math.cos(a) * d + 40);
      peak.rotation.y = rnd() * 6.28;
      peak.castShadow = peak.receiveShadow = true;
      target.add(peak);
    }
  }
}
