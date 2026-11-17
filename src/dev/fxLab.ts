import * as THREE from 'three';
import type { GameContext } from '../core/types';
import { FxSystem } from '../fx/Fx';

/**
 * 特效检视页（fx-lab.html）：不进游戏、单独触发每一种特效，对着一个敌人剪影、在亮 / 暗地面上看（docs/art/fx-style.md 第五节的自查用）。
 *   ?ground=sand|snow|dark|lava   地面明暗（默认 sand：本章最亮的地面；加法混合的层在亮地面上会淡一大截，必须在这儿看）
 *   ?quality=low|medium|high      画质档（粒子密度、点光源）
 *   ?play=名字[,名字…]            载入后立刻触发（名字见下）；?at=0.15 触发后推进到第几秒；?still 不自己跑动画帧（配合控制台逐步推进）
 * 按键（也是 lab.play 的名字）：
 *   1 smg 冲锋枪连射 0.5 秒   2 revolver 左轮一发   3 shotgun 霰弹一发
 *   4 impact 无元素落点   5 fire 火弹落点   6 shock 雷弹落点   7 corrode 蚀弹落点
 *   H hit 命中敌人   C crit 暴击   K death 击杀   X explosion 爆炸
 *   G grenade 燃爆雷落点（爆炸 + 火舌 + 烙印）   F foxfire 火灵飞行并命中   N ninetails 脚下法印 + 火星收拢
 *   E earth 砸地   Z arc 落雷点   S seal 一枚大法印（看纹样和写出）
 *   B 切换地面   空格 暂停 / 继续
 * 控制台（会话不在前台、动画帧不跑时用）：
 *   lab.play('fire')            触发
 *   lab.step(0.15)              按 1/60 秒的固定步长推进 0.15 秒并画一帧
 *   lab.shot()                  当前画面的 JPEG dataURL
 *   lab.stats()                 余韵层的累计计数；lab.bench('smg') 连射 2 秒量每帧 update 的 CPU 毫秒（开 / 关余韵层各一次）
 */
const params = new URLSearchParams(location.search);
const status = document.getElementById('status')!;
const canvas = document.getElementById('view') as HTMLCanvasElement;
addEventListener('error', event => { status.textContent = `${event.message}`; document.title = 'error'; });
addEventListener('unhandledrejection', event => { status.textContent = `Promise 失败：${event.reason instanceof Error ? event.reason.stack : String(event.reason)}`; document.title = 'error'; });

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth || 1280, innerHeight || 720, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.debug.onShaderError = (gl, program) => { status.textContent = `Shader 编译失败：${gl.getProgramInfoLog(program) ?? '未知错误'}`; document.title = 'error'; };

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, (innerWidth || 1280) / (innerHeight || 720), 0.05, 400);
camera.position.set(0, 1.62, 0);
camera.rotation.order = 'YXZ';
camera.rotation.set(-0.12, 0, 0);

// ───────────── 场地：一块地、一盏主光、两个敌人剪影 ─────────────
const GROUNDS = {
  sand: { ground: 0xd9bd8c, sky: 0x8fb4e6, sun: 2.2, amb: 0.9 },
  snow: { ground: 0xe6edf4, sky: 0xa9c4e8, sun: 2.0, amb: 1.0 },
  dark: { ground: 0x1c1b20, sky: 0x20242e, sun: 0.5, amb: 0.35 },
  lava: { ground: 0x2a2224, sky: 0x3a2a2a, sun: 0.8, amb: 0.5 },
} as const;
type GroundKind = keyof typeof GROUNDS;
const groundOrder: GroundKind[] = ['sand', 'snow', 'dark', 'lava'];
let groundKind: GroundKind = (params.get('ground') as GroundKind) in GROUNDS ? (params.get('ground') as GroundKind) : 'sand';

const groundMat = new THREE.MeshStandardMaterial({ color: GROUNDS[groundKind].ground, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.position.set(-20, 40, 12);
const amb = new THREE.HemisphereLight(0xcfe0ff, 0x9a8468, 0.9);
scene.add(sun, amb);

/** 敌人剪影：人形大小的暗色胶囊 + 头；验收看的就是特效有没有盖住它 */
const foes: THREE.Group[] = [];
function addFoe(x: number, z: number, color: number): void {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.9, 6, 12), mat);
  body.position.y = 0.8;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), mat);
  head.position.y = 1.68;
  g.add(body, head);
  g.position.set(x, 0, z);
  scene.add(g);
  foes.push(g);
}
addFoe(0.6, -8, 0x4a5a4e);
addFoe(-2.4, -14, 0x5a4a44);

function applyGround(): void {
  const g = GROUNDS[groundKind];
  groundMat.color.setHex(g.ground);
  scene.background = new THREE.Color(g.sky);
  sun.intensity = g.sun;
  amb.intensity = g.amb;
}
applyGround();

// ───────────── 游戏上下文的桩：特效系统只用到这几样 ─────────────
const quality = (params.get('quality') ?? 'high') as 'low' | 'medium' | 'high';
const time = { frame: 0, now: 0 };
const ctx = {
  scene, camera, renderer,
  settings: { quality, screenShake: 0, damageNumbers: false },
  events: { on: () => () => {} },
  dom: { world: document.getElementById('world')! },
  game: { state: 'playing' },
  cameraFx: { shakeIntensity: 0, shakeTime: 0 },
  stage: { arena: { floorY: 0 } },
  world: { groundHeight: () => 0 },
  time,
} as unknown as GameContext;
const fx = new FxSystem(ctx);
fx.init();
// 换关时游戏会预编译特效着色器；这里手动来一次，首次触发不卡
try { renderer.compile(scene, camera); } catch { /* 不影响运行 */ }

// ───────────── 触发 ─────────────
const UP = new THREE.Vector3(0, 1, 0);
const WARM = 0xffd9a0, FIRE = 0xff6a1f, SHOCK = 0x6fd8ff, CORRODE = 0x9dff4a, FOE_COLOR = 0xff4455, EMBER = 0xff9a3c, GOLD = 0xffc861, FIRE_CORE = 0xffd27a;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const muzzle = () => v(0.2, 1.49, -0.6);
const foeCenter = () => v(foes[0].position.x, 1.05, foes[0].position.z);
const rnd = (a: number) => (Math.random() - 0.5) * 2 * a;

/** 定时的后续动作（连射的下一发、飞行物的下一步）：按特效时间推进，不用 setTimeout，逐步推进时一样准 */
const pending: { at: number; run: () => void }[] = [];
let clock = 0;
const after = (delay: number, run: () => void) => pending.push({ at: clock + delay, run });

/** 飞行的火团（火灵）：按抛物线飞向目标，每 0.035 秒落一条火舌，到了就命中 */
const orbGeo = new THREE.IcosahedronGeometry(0.09, 1);
const orbMat = new THREE.MeshBasicMaterial({ color: FIRE_CORE });
const orbs: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; shed: number; target: THREE.Vector3 }[] = [];
function launchOrb(from: THREE.Vector3, target: THREE.Vector3): void {
  const mesh = new THREE.Mesh(orbGeo, orbMat);
  mesh.position.copy(from);
  scene.add(mesh);
  const vel = target.clone().sub(from).normalize().multiplyScalar(17).add(v(rnd(3), 2.5, 0));
  orbs.push({ mesh, vel, life: 3.5, shed: 0, target });
  fx.castSparks(from, vel, FIRE_CORE);
}

function shot(width: number, pellets: number, spread: number, color = WARM, size = 1): void {
  for (let i = 0; i < pellets; i++) {
    const to = v(rnd(spread) + 0.3, 0, -9 + rnd(spread));
    fx.tracer(muzzle(), to, color, width);
    fx.impact(to, UP, color, size);
  }
  time.frame++; // 每次开枪算新的一帧：气浪 / 扬尘按帧去重
}

const plays: Record<string, () => void> = {
  smg: () => { for (let i = 0; i < 7; i++) after(i * 0.077, () => shot(0.02, 1, 0.8, WARM, 0.6)); },
  revolver: () => shot(0.03, 1, 0.2, WARM, 0.9),
  shotgun: () => shot(0.0072, 8, 1.6, WARM, 0.6),
  impact: () => fx.impact(v(0, 0, -4.5), UP, WARM, 1.2),
  fire: () => fx.impact(v(-1.5, 0, -4.5), UP, FIRE, 1.2),
  shock: () => fx.impact(v(0, 0, -4.5), UP, SHOCK, 1.2),
  corrode: () => fx.impact(v(1.5, 0, -4.5), UP, CORRODE, 1.2),
  hit: () => fx.enemyHit(foeCenter(), FOE_COLOR, false),
  crit: () => fx.enemyHit(foeCenter(), FOE_COLOR, true),
  death: () => { fx.enemyHit(foeCenter(), FOE_COLOR, false); fx.deathEffect(foeCenter(), FOE_COLOR, 1.4); },
  explosion: () => fx.explosion(v(-1.5, 0.4, -7), 3, FIRE),
  grenade: () => {
    const p = v(-1.2, 0.08, -7), q = v(-1.2, 0.4, -7);
    fx.flameBurst(q, FIRE, 1);
    fx.explosion(q, 4.5, FIRE);
    fx.ring(p, 4.5, FIRE, 0.4);
    fx.seal(p, null, 2.7, 0xd9480f, { write: 0.14, hold: 0.3, fade: 1.6, sides: 6, spin: 0.25, gain: 0.8 });
  },
  foxfire: () => { for (let i = 0; i < 3; i++) after(i * 0.3, () => launchOrb(v(rnd(1), 1.3, -0.8), foeCenter())); },
  ninetails: () => {
    const p = v(0, 0.08, -3.2);
    fx.seal(p, null, 1.5, FIRE, { write: 0.32, hold: 1.6, fade: 0.45, sides: 9, spin: 0.5, gain: 1.1 });
    fx.gather(p, EMBER, 16, 2.6, p, 1);
    fx.ring(p, 3.2, FIRE, 0.45);
  },
  earth: () => {
    const p = v(0, 0, -5);
    fx.earthBurst(p, GOLD, 5);
    fx.seal(v(0, 0.08, -5), null, 2.75, 0xc9a36b, { write: 0.12, hold: 0.3, fade: 1.4, sides: 4, spin: 0.2, gain: 0.8 });
    fx.ring(v(0, 0.08, -5), 5, GOLD, 0.45);
  },
  arc: () => { fx.lightning(v(1, 11, -5), v(1, 0.05, -5), 0xe8fbff); fx.arcBurst(v(1, 0.05, -5), SHOCK, 1.4); },
  seal: () => fx.seal(v(0, 0.08, -5), null, 3, FIRE, { write: 0.6, hold: 2.5, fade: 1, sides: 6, spin: 0.3, gain: 1 }),
};

// ───────────── 推进与绘制 ─────────────
let paused = false;
function advance(dt: number): void {
  clock += dt;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i].at <= clock) pending.splice(i, 1)[0].run();
  }
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    // 追踪：速度慢慢拐向目标（同游戏里火灵的转向 7 rad/s）
    const want = o.target.clone().sub(o.mesh.position).normalize().multiplyScalar(o.vel.length());
    o.vel.lerp(want, Math.min(1, 7 * dt));
    o.mesh.position.addScaledVector(o.vel, dt);
    o.life -= dt;
    o.shed -= dt;
    if (o.shed <= 0) {
      o.shed = 0.035;
      fx.flameShed(o.mesh.position, o.vel, FIRE, 0.34);
    }
    if (o.mesh.position.distanceTo(o.target) < 0.5 || o.life <= 0 || o.mesh.position.y < 0.05) {
      fx.flameHit(o.mesh.position, FIRE);
      scene.remove(o.mesh);
      orbs.splice(i, 1);
    }
  }
  time.frame++;
  time.now = clock;
  fx.update(dt);
}
function draw(): void {
  renderer.render(scene, camera);
  const s = fx.stats;
  status.textContent = `特效检视  地面 ${groundKind}  画质 ${quality}  t=${clock.toFixed(2)}${paused ? '（暂停）' : ''}\n`
    + `气浪 ${s.air}  扬尘 ${s.kick}  光屑 ${s.wake}  落点余韵 ${s.after}  击穿 ${s.through}  死亡余韵 ${s.death}  魂火 ${s.arrived}/${s.souls}\n`
    + `1 冲锋枪 2 左轮 3 霰弹 4-7 落点（无/火/雷/蚀） H 命中 C 暴击 K 击杀 X 爆炸 G 燃爆雷 F 火灵 N 尾焰 E 砸地 Z 落雷 S 法印 B 换地面`;
}

const KEYS: Record<string, string> = {
  Digit1: 'smg', Digit2: 'revolver', Digit3: 'shotgun', Digit4: 'impact', Digit5: 'fire', Digit6: 'shock', Digit7: 'corrode',
  KeyH: 'hit', KeyC: 'crit', KeyK: 'death', KeyX: 'explosion', KeyG: 'grenade', KeyF: 'foxfire', KeyN: 'ninetails', KeyE: 'earth', KeyZ: 'arc', KeyS: 'seal',
};
addEventListener('keydown', (e) => {
  if (e.code === 'KeyB') { groundKind = groundOrder[(groundOrder.indexOf(groundKind) + 1) % groundOrder.length]; applyGround(); return; }
  if (e.code === 'Space') { paused = !paused; return; }
  const name = KEYS[e.code];
  if (name) plays[name]();
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth || 1280, innerHeight || 720, false);
  camera.aspect = (innerWidth || 1280) / (innerHeight || 720);
  camera.updateProjectionMatrix();
});

const lab = {
  fx,
  names: Object.keys(plays),
  play(name: string): string {
    const run = plays[name];
    if (!run) return `没有「${name}」：${Object.keys(plays).join(' ')}`;
    run();
    return name;
  },
  /** 按固定步长推进 seconds 秒并画一帧 */
  step(seconds: number, dt = 1 / 60): number {
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) advance(dt);
    draw();
    return clock;
  },
  ground(kind: GroundKind): void { if (kind in GROUNDS) { groundKind = kind; applyGround(); draw(); } },
  shot(qualityJpeg = 0.88): string { draw(); return canvas.toDataURL('image/jpeg', qualityJpeg); },
  stats: () => ({ ...fx.stats }),
  /** 触发 name 后推进 seconds 秒，量每步 advance 的 CPU 毫秒（中位数 / 95 分位）；余韵层开、关各一次 */
  bench(name = 'smg', seconds = 2): Record<string, { median: number; p95: number }> {
    const layers = ['impactAfter', 'tracerWake', 'shotWorld', 'hitThrough', 'deathAfter'] as const;
    const raw = fx as unknown as Record<string, unknown>;
    const saved = layers.map((k) => raw[k]);
    const measure = (): { median: number; p95: number } => {
      const ts: number[] = [];
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) {
        if (i % 30 === 0) plays[name]();
        const t0 = performance.now();
        advance(1 / 60);
        ts.push(performance.now() - t0);
      }
      ts.sort((a, b) => a - b);
      return { median: +ts[Math.floor(ts.length / 2)].toFixed(3), p95: +ts[Math.floor(ts.length * 0.95)].toFixed(3) };
    };
    layers.forEach((k) => { raw[k] = () => {}; });
    const off = measure();
    layers.forEach((k, i) => { raw[k] = saved[i]; });
    const on = measure();
    draw();
    return { off, on };
  },
};
(window as unknown as { lab: typeof lab }).lab = lab;

for (const name of (params.get('play') ?? '').split(',').filter(Boolean)) lab.play(name);
const at = Number(params.get('at'));
if (at > 0) lab.step(at);
draw();

if (!params.has('still')) {
  let last = performance.now();
  const loop = (t: number): void => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!paused && dt > 0) advance(dt);
    draw();
  };
  requestAnimationFrame(loop);
}
document.title = document.title === 'error' ? 'error' : '特效检视';
