import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { MouseLookFilter } from '../core/MouseLookFilter';
import { AirLife, type LeafCrown } from '../world/AirLife';
import { Atmosphere, atmosphereForChapter } from '../world/Atmosphere';
import { CloudSky, cloudSkyForChapter } from '../world/CloudSky';
import { MistStreams, mistBand, type MistStream } from '../world/MistStreams';
import { SunShafts } from '../world/SunShafts';
import { UnityAtmosphereDressing } from '../world/unityAtmosphereDressing';
import type { AtmosphereLayoutSource, UnityAtmosphereLayout } from '../world/unityAtmosphereLayout';

/**
 * 空气透视检视页（atmosphere-lab.html）：同一个机位开 / 关对比。
 *   ?map=1-1      读 Unity 导出的场景（public/assets/unity-levels/scenes）；不带 map 是一片程序生成的层叠山谷
 *   ?atmosphere=0 关掉空气透视（只剩场景原有的雾；Unity 场景的环境也认这个参数，线性雾起点不会被往后推）；?cloud=0 只关云影
 *   Unity 场景的雾带 / 水面雾 / 落叶 / 鸟按这张图的数据摆（unityAtmosphereLayout.ts）；?layout=debug 把摆位画成线：
 *                 橙 = 崖脚雾带，红 = 内圈，品红 = 外圈，白 = 最远一圈，绿 = 谷底，青 / 蓝 = 水面，黄圈 = 遭遇场地，橙 = 落叶的树，白圈 = 鸟
 *   ?mist=0       关掉流动雾带；?mist=x,y,z,长,半宽,雾团直径[,不透明度[,流速倍率]];…  自己摆几条顺风的直雾带（代替默认的那几条）
 *   ?shafts=0     关掉逆光的光柱；?shaft=0.3 强度，?shaftLength= ?shaftRadius= ?shaftProtect= 同名参数
 *   ?sky=0        关掉云天；?sky_low=0.5 这样带 sky_ 前缀的字段名覆盖云天的参数（low mid high height white lit shade sunGlow）
 *   ?life=0       关掉小活物（层叠山谷：三棵树下的落叶、远处一群鸟、出生点旁一团光里的尘；Unity 场景只有一群鸟）
 *   ?softdepth=1  检视页自己多画一遍场景深度，喂给雾带做软相交（主游戏里只有带水面的图有现成的深度）
 *   ?view=sun|cross|vista|spawn   机位：朝太阳 / 侧对太阳 / 升到 34 m 俯瞰 / 出生朝向；?pos=x,y,z ?yaw=弧度 ?pitch=弧度 直接给机位
 *   ?base=12      低雾基准高度（默认：Unity 场景按图自动算的低处，层叠山谷是出生点脚下 2 m）；?t=30 云影推进到第几秒；?still 只出一帧
 * 操作：点画面锁定鼠标转视角，WASD 飞行（Shift 加速），F 开关空气透视，C 开关云影，M 开关雾带，G 开关光柱，K 开关云天，L 开关小活物。
 * 控制台：lab.set({ mist: false }) 开关模块，lab.bench() 连画 40 帧量每帧耗时（毫秒，含 GPU）。
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
const valleyCrowns: LeafCrown[] = [];
let sceneDoc: (AtmosphereLayoutSource & { encounters?: { position: number[]; arenaRadius: number }[] }) | null = null;
let chapter = 1, spawn = new THREE.Vector3(0, 0, 40), spawnYaw = 0, sceneBaseY: number | null = null, updateScene: (dt: number, t: number) => void = () => {};
if (mapId) {
  // Unity 场景的网页端读取模块还没入库：用 glob 按需载入（文件不在时是空表），检视页不对它们形成编译期依赖
  const modules = import.meta.glob<any>(['../world/UnitySceneView.ts', '../world/UnityLevelLibrary.ts', '../world/Collision.ts']);
  const load = (path: string): Promise<any> => {
    const loader = modules[path];
    if (!loader) throw new Error(`缺少 ${path}：Unity 场景的网页端读取模块不在这个工作区`);
    return loader();
  };
  const [{ UnitySceneView, unityAtmosphereBaseY }, { UnityLevelLibrary }, { CollisionWorld }] = await Promise.all([load('../world/UnitySceneView.ts'), load('../world/UnityLevelLibrary.ts'), load('../world/Collision.ts')]);
  const response = await fetch(`/assets/unity-levels/scenes/${mapId}.json`);
  if (!response.ok) throw new Error(`Unity 场景 ${mapId} 尚未导出`);
  const doc = await response.json();
  await UnityLevelLibrary.preload(doc, (loaded: number, total: number) => { status.textContent = `${mapId} · 读取 ${loaded}/${total}`; });
  // 平台、机关、水体会读游戏上下文（玩家、事件、时间、提示、特效、随机数）：检视页没有游戏，给一组不做事的桩，玩家放到地底下不触发任何东西
  const stubs = {
    player: { position: new THREE.Vector3(0, -1000, 0), radius: 0.4, onGround: false, stats: { removeSource: () => {}, add: () => {}, getBase: () => 0 }, maxHp: () => 1, teleport: () => {} },
    events: new EventBus(), time: { now: 0 }, stage: {}, ui: { toast: () => {} }, fx: { ring: () => {}, burst: () => {} }, rng: { next: () => Math.random() },
    // 水面每帧要查玩家和怪泡在水里多深（4-1 的海子）：没有怪、没有导航、不结算
    enemies: { list: [] }, audio: { play: () => {} }, combat: { damagePlayer: () => {} }, nav: { nearestWalkable: () => false },
    // 机关要登记交互点和定时任务（3-2 的炉门 / 吊台）：登记了也没人触发
    interact: { add: () => () => {} }, tasks: { add: () => () => {}, delay: () => {} },
  };
  const view = new UnitySceneView({ scene, camera, world: new CollisionWorld(), settings: { quality: 'high' }, renderer, ...stubs }, doc, { environment: true, groundCover: true, colliders: false });
  if (typeof unityAtmosphereBaseY === 'function') sceneBaseY = unityAtmosphereBaseY(doc);
  scene.add(view.group);
  await view.ready;
  sceneDoc = doc;
  // 环境自己已经接了云天 / 光柱（以及按图的摆位）：检视页用自己那一份（能用网址调参、单独开关），把环境的拿掉，免得画两遍
  for (const name of ['CloudSky', 'SunShafts', 'UnityAtmosphereDressing']) for (let found = view.group.getObjectByName(name); found; found = view.group.getObjectByName(name)) found.removeFromParent();
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
if (params.has('pos')) camera.position.fromArray(params.get('pos')!.split(',').map(Number));
if (params.has('yaw')) camera.rotation.y = Number(params.get('yaw'));
if (params.has('pitch')) camera.rotation.x = Number(params.get('pitch'));

const profile = atmosphereForChapter(chapter);
// 调参：网址里带上字段名就覆盖默认值（?mistDensity=0.004&cloudShadow=0.5&cloudTile=600）
for (const key of Object.keys(profile) as (keyof typeof profile)[]) if (params.has(key)) profile[key] = Number(params.get(key));
const cloudShadow = profile.cloudShadow;
let on = params.get('atmosphere') !== '0' && params.get('atmo') !== '0', clouds = params.get('cloud') !== '0';
const flags = { mist: params.get('mist') !== '0', shafts: params.get('shafts') !== '0', sky: params.get('sky') !== '0', life: params.get('life') !== '0' };
const baseY = params.has('base') ? Number(params.get('base')) : sceneBaseY ?? spawn.y - 2;
const apply = (): void => {
  if (on) {
    profile.cloudShadow = clouds ? cloudShadow : 0;
    Atmosphere.bind(scene, profile, { baseY });
  } else Atmosphere.unbind();
  mist.mesh.visible = on && flags.mist;
  if (dressing?.waterMist) dressing.waterMist.mesh.visible = on && flags.mist;
  shafts.mesh.visible = on && flags.shafts;
  cloudSky.mesh.visible = on && flags.sky;
  life.group.visible = on && flags.life;
};
// 雾带要读风向，先接上空气透视再建
Atmosphere.bind(scene, profile, { baseY });
// Unity 场景：雾带 / 水面雾 / 落叶 / 鸟按这张图的数据摆；网址给了 ?mist=x,y,z,… 就只用手摆的那几条
const dressing = sceneDoc && !/[,;]/.test(params.get('mist') ?? '') ? new UnityAtmosphereDressing(sceneDoc) : null;
const mist = dressing?.mist ?? new MistStreams(dressing ? [] : mistLayout());
scene.add(dressing ? dressing.group : mist.mesh);
if (dressing && sceneDoc && params.get('layout') === 'debug') scene.add(layoutDebug(dressing.layout, sceneDoc));
const number = (key: string): number | undefined => params.has(key) ? Number(params.get(key)) : undefined;
const shafts = new SunShafts({ strength: number('shaft'), length: number('shaftLength'), radius: number('shaftRadius'), protect: number('shaftProtect') });
scene.add(shafts.mesh);
const skyProfile = cloudSkyForChapter(chapter);
for (const key of ['low', 'mid', 'high', 'height', 'white', 'lit', 'shade', 'sunGlow'] as const) if (params.has(`sky_${key}`)) skyProfile[key] = Number(params.get(`sky_${key}`));
// 层叠山谷自己的渐变天已经画了太阳
if (!mapId && !params.has('sky_sunGlow')) skyProfile.sunGlow = 0;
const cloudSky = new CloudSky(skyProfile);
scene.add(cloudSky.mesh);
// 小活物：层叠山谷里三棵树（buildValley 种的）下的落叶、朝太阳那一侧的一团尘、远处一群鸟
const ahead = new THREE.Vector3(-Math.sin(spawnYaw), 0, -Math.cos(spawnYaw));
const life = dressing ? { group: dressing.life?.group ?? new THREE.Group() } : new AirLife({
  leaves: mapId ? [] : valleyCrowns,
  birds: [{ center: [spawn.x + ahead.x * 220, spawn.y + 85, spawn.z + ahead.z * 220], radius: 70 }],
  motes: mapId ? [] : [{ center: [spawn.x + toSun.x * 9, spawn.y + 2.6, spawn.z + toSun.z * 9], size: [9, 4.5, 9] }],
});
if (!dressing) scene.add(life.group);
apply();

// ?softdepth=1：多画一遍场景深度（只写深度），给雾带做软相交
let depthTarget: THREE.WebGLRenderTarget | null = null;
const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
const bufferSize = new THREE.Vector2();
function renderDepth(): void {
  renderer.getDrawingBufferSize(bufferSize);
  if (!depthTarget || depthTarget.width !== bufferSize.x || depthTarget.height !== bufferSize.y) {
    depthTarget?.dispose();
    depthTarget = new THREE.WebGLRenderTarget(bufferSize.x, bufferSize.y, { depthTexture: new THREE.DepthTexture(bufferSize.x, bufferSize.y, THREE.UnsignedIntType) });
  }
  const visible = mist.mesh.visible, rays = shafts.mesh.visible, cloudy = cloudSky.mesh.visible, alive = life.group.visible, shadows = renderer.shadowMap.autoUpdate;
  mist.mesh.visible = shafts.mesh.visible = cloudSky.mesh.visible = life.group.visible = false;
  const water = dressing?.waterMist?.mesh.visible ?? false;
  if (dressing?.waterMist) dressing.waterMist.mesh.visible = false;
  scene.overrideMaterial = depthOnly;
  renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(depthTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.shadowMap.autoUpdate = shadows;
  scene.overrideMaterial = null;
  mist.mesh.visible = visible;
  shafts.mesh.visible = rays;
  cloudSky.mesh.visible = cloudy;
  life.group.visible = alive;
  if (dressing?.waterMist) dressing.waterMist.mesh.visible = water;
  mist.useSceneDepth(depthTarget.depthTexture);
}

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
  if (event.code === 'KeyM') { flags.mist = !flags.mist; apply(); }
  if (event.code === 'KeyG') { flags.shafts = !flags.shafts; apply(); }
  if (event.code === 'KeyK') { flags.sky = !flags.sky; apply(); }
  if (event.code === 'KeyL') { flags.life = !flags.life; apply(); }
});
addEventListener('keyup', event => keys.delete(event.code));
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const still = params.has('still'), softDepth = params.get('softdepth') === '1', clock = new THREE.Clock(), move = new THREE.Vector3();
let frames = 0, time = Number(params.get('t') ?? 0), calls = 0, triangles = 0;
// 一帧可能画不止一次 render（深度那一遍也算），绘制调用数自己按帧累加
renderer.info.autoReset = false;
function draw(dt: number): void {
  renderer.info.reset();
  updateScene(dt, time);
  Atmosphere.update(time);
  if (softDepth && mist.mesh.visible) renderDepth();
  else mist.useSceneDepth(null);
  renderer.render(scene, camera);
  calls = renderer.info.render.calls;
  triangles = renderer.info.render.triangles;
}
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.1, clock.getDelta());
  if (!still) time += dt;
  move.set(Number(keys.has('KeyD')) - Number(keys.has('KeyA')), Number(keys.has('KeyE')) - Number(keys.has('KeyQ')), Number(keys.has('KeyS')) - Number(keys.has('KeyW')));
  if (move.lengthSq() > 0) camera.position.add(move.normalize().applyQuaternion(camera.quaternion).multiplyScalar((keys.has('ShiftLeft') ? 60 : 14) * dt));
  draw(dt);
  if (++frames === 3) document.title = 'rendered';
  status.textContent = `${mapId ?? '层叠山谷'} · 空气透视 ${on ? '开' : '关'}（F）· 云影 ${on && clouds && cloudShadow > 0 ? '开' : '关'}（C）· 雾带 ${mist.mesh.visible ? `开 ${mist.count + (dressing?.waterMist?.count ?? 0)} 团` : '关'}（M）· 光柱 ${shafts.mesh.visible ? `开 ${shafts.level.toFixed(2)}` : '关'}（G）· 云天 ${cloudSky.mesh.visible ? '开' : '关'}（K）· 小活物 ${life.group.visible ? '开' : '关'}（L）· 基准高度 ${baseY.toFixed(1)} m\n` +
    `${calls} calls / ${triangles} tris`;
});

// 控制台 / 自动化用：开关模块、换时间、量耗时
(window as unknown as { lab: unknown }).lab = {
  camera, scene, renderer, profile, flags, shafts, skyProfile, cloudSky,
  set(change: Partial<typeof flags> & { atmosphere?: boolean; clouds?: boolean; t?: number }): void {
    if (change.atmosphere !== undefined) on = change.atmosphere;
    if (change.clouds !== undefined) clouds = change.clouds;
    if (change.t !== undefined) time = change.t;
    for (const key of Object.keys(flags) as (keyof typeof flags)[]) if (change[key] !== undefined) flags[key] = change[key]!;
    apply();
    draw(0);
  },
  /** 连画 n 帧再读一个像素（等 GPU 画完），返回每帧毫秒 */
  bench(n = 40): number {
    const gl = renderer.getContext(), px = new Uint8Array(4);
    draw(0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const start = performance.now();
    for (let i = 0; i < n; i++) draw(0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return Math.round((performance.now() - start) / n * 100) / 100;
  },
  stats: () => ({ calls, triangles, mist: mist.count + (dressing?.waterMist?.count ?? 0), shafts: shafts.level }),
  layout: dressing?.layout ?? null, doc: sceneDoc,
};

/**
 * 检视页自己摆的雾带。层叠山谷：每两排山之间一条，顺风从右往左绕过去，越远越大越浓越慢；镜头前的开阔地上只有几缕碎絮。
 * 网址 ?mist=x,y,z,长,半宽,直径[,不透明度[,流速]];… 时是那几条顺风的直雾带（Unity 场景里试摆位用，代替按图算出来的）。
 */
function mistLayout(): MistStream[] {
  const custom = params.get('mist');
  if (custom && custom !== '0' && custom !== '1') {
    return custom.split(';').map(item => {
      const [x, y, z, length, halfWidth, size, opacity, speed] = item.split(',').map(Number);
      return mistBand([x, y, z], length, { halfWidth, size, bow: length * 0.06 }, { opacity: opacity || 0.5, speed: speed || 0.6 });
    });
  }
  if (!mapId) {
    const arc = (radius: number, y: number, halfWidth: number, size: number, stream: Omit<MistStream, 'keys'>): MistStream => ({
      ...stream,
      keys: [1.2, 0.95, 0.45, -0.05, -0.55, -1.0, -1.2].map((a, i, all) => ({
        position: [Math.sin(a) * radius, y + 0.12 * size * Math.sin(a * 2.3 + radius), -Math.cos(a) * radius + 40] as [number, number, number],
        halfWidth, size, opacity: i === 0 || i === all.length - 1 ? 0 : 1,
      })),
    });
    return [
      arc(46, 5, 9, 11, { opacity: 0.16, speed: 1.2, stretch: 2, torn: 0.06, count: 12 }),
      arc(104, 8, 14, 26, { opacity: 0.36, speed: 0.7 }),
      arc(188, 15, 22, 42, { opacity: 0.5, speed: 0.6 }),
      arc(318, 26, 36, 66, { opacity: 0.64, speed: 0.5 }),
      arc(545, 44, 62, 112, { opacity: 0.78, speed: 0.42 }),
    ];
  }
  return [];
}

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
  // 渐变天 + 日盘和光晕（显示空间直接出色）：光柱要有一块够亮的天做光源，云也要有天可叠
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    uniforms: { uHorizon: { value: fogColor }, uTop: { value: new THREE.Color(0.38, 0.52, 0.8) }, uSun: { value: light.position.clone().normalize() }, uSunColor: { value: new THREE.Color(1, 0.9, 0.74) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 clip = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); gl_Position = clip.xyww; }',
    fragmentShader: `uniform vec3 uHorizon, uTop, uSun, uSunColor; varying vec3 vDir;
      void main(){ vec3 d = normalize( vDir ); float s = max( dot( d, uSun ), 0.0 );
        vec3 c = mix( uHorizon, uTop, pow( clamp( d.y, 0.0, 1.0 ), 0.55 ) );
        c += uSunColor * ( smoothstep( 0.9993, 0.9996, s ) * 2.0 + pow( s, 90.0 ) * 0.5 + pow( s, 10.0 ) * 0.16 );
        gl_FragColor = vec4( min( c, vec3( 1.0 ) ), 1.0 ); }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.onBeforeRender = (_renderer, _scene, lens) => { sky.position.copy(lens.position); sky.updateMatrixWorld(); };
  target.add(sky);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  target.add(ground);
  // 出生点附近三棵树：落叶只从它们的树冠下掉
  const bark = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 }), foliage = new THREE.MeshStandardMaterial({ color: 0xa8482c, roughness: 1, flatShading: true });
  for (const [x, z, height, radius] of [[-9, 22, 7.5, 3.6], [11, 14, 9, 4.2], [3, 2, 6.5, 3.2]]) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, height, 7), bark);
    trunk.position.set(x, height / 2, z);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), foliage);
    crown.position.set(x, height, z);
    crown.scale.y = 0.72;
    trunk.castShadow = crown.castShadow = true;
    target.add(trunk, crown);
    valleyCrowns.push({ position: [x, height, z], radius: radius * 0.9, ground: 0, count: 12 });
  }
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

/** ?layout=debug：把按图算出来的摆位画成线（不吃深度、不吃雾，俯视时一眼看清和地形、遭遇场地的关系） */
function layoutDebug(layout: UnityAtmosphereLayout, doc: AtmosphereLayoutSource): THREE.Group {
  const group = new THREE.Group();
  group.name = 'LayoutDebug';
  const line = (points: THREE.Vector3[], color: number, loop = false): void => {
    const material = new THREE.LineBasicMaterial({ color, depthTest: false, fog: false, toneMapped: false });
    const object = loop ? new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material) : new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
    object.renderOrder = 8000;
    object.frustumCulled = false;
    group.add(object);
  };
  const circle = (x: number, y: number, z: number, radius: number, color: number): void =>
    line(Array.from({ length: 40 }, (_, i) => new THREE.Vector3(x + Math.cos(i / 40 * 6.2832) * radius, y, z + Math.sin(i / 40 * 6.2832) * radius)), color, true);
  for (const stream of layout.mist) {
    const size = stream.keys[1].size;
    line(stream.keys.map(key => new THREE.Vector3(...key.position)), size <= 18 ? 0xffa020 : size <= 26 ? 0xff3030 : size <= 28 ? 0x30ff60 : size <= 48 ? 0xff30ff : 0xffffff);
  }
  for (const stream of layout.waterMist) line(stream.keys.map(key => new THREE.Vector3(...key.position)), stream.flat ? 0x30d0ff : 0x3060ff);
  for (const site of doc.encounters ?? []) circle(site.position[0], site.position[1] + 1, site.position[2], site.arenaRadius, 0xffe030);
  for (const boss of doc.bosses ?? []) circle(boss.center[0], boss.center[1] + 1, boss.center[2], boss.radius, 0xff9020);
  circle(doc.spawn.position[0], doc.spawn.position[1] + 1, doc.spawn.position[2], 4, 0xffffff);
  for (const tree of layout.leaves) line([new THREE.Vector3(tree.position[0], tree.ground, tree.position[2]), new THREE.Vector3(...tree.position)], 0xff8020);
  for (const flock of layout.birds) circle(flock.center[0], flock.center[1], flock.center[2], flock.radius, 0xffffff);
  return group;
}
