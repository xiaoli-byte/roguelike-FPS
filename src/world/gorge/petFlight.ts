/**
 * 4-2 彩蛋 · 灵宠飞渡（docs/level-design/chuanzang-v1.md 3.8）：
 * 带着会飞的灵宠（精卫、重明鸟、应龙）走到峡谷里的三处风马旗台，按 F，演出分五段：
 *   ① 起势 1.2 s：镜头从眼睛弧线拉到身侧，灵宠从侧前方飞回来，绕着燎螺旋上升，一路洒灵火火星；
 *   ② 化形 1.3 s：灵宠悬在前上方，被灵火光罩包住、带回弹地变大，地上一圈冲击环，一道闪光，羽毛 / 鳞光四散；
 *   ③ 擒起约 2.4 s（见 GRAB）：灵宠绕到身后高处俯冲下来，燎下蹲蓄力、蹬地起跳、双手抡上去，跳到最高点抓住爪子（慢动作），
 *      被一把带走、腿甩到后面再荡回来，镜头从侧面绕到身后；
 *   ④ 滑翔：鼠标或 A / D 转向，W 俯冲，S 拉平，峡谷阵风往上托，翅尖拖出风痕，越快视野越宽；离地 8 m 内自动拉平减速；
 *   ⑤ 落地 2.2 s：灵宠猛扇翅膀减速、把人放到地上（扬起尘土，燎屈膝缓冲、松手），再飞起来缩回原样、回到侧前方的跟随位，镜头弧线回到眼睛。
 * 空格中途松手：人自己掉下去，灵宠缩回原样跟上。
 * 模型用美术管线发布的骨骼模型（public/assets/characters/SK_Pet_*.glb、SK_Hero_Fox.glb），动作全部程序化：
 * 翅膀骨骼绕身体长轴扇、身体俯成水平、腿往回摆；燎的上臂从 T 字姿势转到垂手 / 举手，每帧把灵宠的爪子对齐到燎的双手。
 * 灵宠系统本身在 Unity（docs/pet-system.md），网页这里只做演出。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FLIGHT_PERCHES, MAP, type FlightPerch } from './spec';

export type FlyingPetId = 'jingwei' | 'chongming' | 'yinglong';

/** 三只会飞的灵宠：模型、平时大小（随身）、飞渡时变大到多高、抓哪两根爪子骨骼、滑翔手感、灵火颜色 */
export const FLYING_PETS: Record<FlyingPetId, {
  name: string; url: string; carryHeight: number; rideHeight: number; grip: [string, string];
  /** bird：静止时身体立着（长轴 = 模型 Y），飞的时候整只俯成水平；dragon：四足站姿、身体本来就是水平的（长轴 = 模型 Z），姿态另算（dragonPose） */
  kind: 'bird' | 'dragon';
  speed: number; sink: number; flap: number;
  /** 模型静止时身体是立着的（站姿），飞的时候整个往前俯 pitch 弧度成水平；腿再往回摆，爪子朝下 */
  pitch: number; legs: string[];
  /** 化形时灵火的颜色（芯、外焰）和四散的碎片颜色（羽毛 / 鳞光） */
  fire: [string, string]; shard: string;
}> = {
  jingwei: {
    name: '精卫', url: 'assets/characters/SK_Pet_Jingwei.glb', carryHeight: 0.75, rideHeight: 3.6, grip: ['talon_L', 'talon_R'], kind: 'bird',
    speed: 13, sink: 1.9, flap: 1.25, pitch: 1.15, legs: ['thigh_L', 'thigh_R'], fire: ['#fff2c4', '#ff7a2a'], shard: '#ff5a3a',
  },
  chongming: {
    name: '重明鸟', url: 'assets/characters/SK_Pet_Chongming.glb', carryHeight: 1.1, rideHeight: 4.2, grip: ['talon_L', 'talon_R'], kind: 'bird',
    speed: 14, sink: 1.6, flap: 1.0, pitch: 1.15, legs: ['thigh_L', 'thigh_R'], fire: ['#f4ffff', '#4fd8ff'], shard: '#ffcc4a',
  },
  yinglong: {
    name: '应龙', url: 'assets/characters/SK_Pet_Yinglong.glb', carryHeight: 1.4, rideHeight: 4.6, grip: ['claw_L', 'claw_R'], kind: 'dragon',
    speed: 16.5, sink: 1.1, flap: 0.8, pitch: 0.12, legs: [], fire: ['#f0fff6', '#3fe0b0'], shard: '#9ff7ff',
  },
};

const HERO_URL = 'assets/characters/SK_Hero_Fox.glb';
const HERO_HEIGHT = 1.78;
const EYE = 1.62;

// ───────────────────────────── 骨骼模型 ─────────────────────────────

interface Posable {
  root: THREE.Group;
  bones: Map<string, THREE.Bone>;
  /** 每根骨骼的静止局部旋转、在模型根坐标系里的静止旋转 */
  rest: Map<string, { local: THREE.Quaternion; rel: THREE.Quaternion; pos: THREE.Vector3 }>;
  /** 模型原始高度（米，缩放前） */
  height: number;
  meshes: THREE.Mesh[];
}

const loader = (() => {
  const draco = new DRACOLoader();
  return new GLTFLoader().setDRACOLoader(draco);
})();
const cache = new Map<string, Promise<Posable | null>>();

/**
 * 读一个骨骼模型，只留最高一级 LOD；记下静止姿势（程序化动作都在静止姿势上叠加）。
 * three.js 读 glTF 时会把节点名里的「:」去掉（mixamorig:LeftArm → mixamorigLeftArm），这里统一去掉前缀。
 */
function loadPosable(url: string): Promise<Posable | null> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}${url}`).then(gltf => {
      const root = new THREE.Group();
      const scene = gltf.scene;
      const meshes: THREE.Mesh[] = [];
      scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const lod = /_LOD(\d+)$/.exec(m.name);
        m.visible = !lod || lod[1] === '0';
        m.castShadow = true; m.receiveShadow = true;
        m.frustumCulled = false;
        if (m.visible) meshes.push(m);
      });
      root.add(scene);
      root.updateMatrixWorld(true);
      const bones = new Map<string, THREE.Bone>();
      scene.traverse(o => { if ((o as THREE.Bone).isBone) bones.set(o.name.replace(/^mixamorig:?/, ''), o as THREE.Bone); });
      const inv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
      const toRoot = root.matrixWorld.clone().invert();
      // 绑定姿势下每根骨骼在模型根坐标系里的朝向和位置（一加载就记下来：之后骨骼都摆过姿势了，再量就不是静止姿势了）
      const rest = new Map<string, { local: THREE.Quaternion; rel: THREE.Quaternion; pos: THREE.Vector3 }>();
      for (const [name, b] of bones) rest.set(name, {
        local: b.quaternion.clone(), rel: inv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion())),
        pos: b.getWorldPosition(new THREE.Vector3()).applyMatrix4(toRoot),
      });
      const box = new THREE.Box3().setFromObject(scene);
      return { root, bones, rest, height: Math.max(0.1, box.max.y - box.min.y), meshes };
    }).catch(err => { console.warn(`[灵宠飞渡] ${url} 加载失败`, err); return null; });
    cache.set(url, p);
  }
  return p;
}

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _a = new THREE.Vector3();

/** 让骨骼绕「模型根坐标系里的轴 axis」在静止姿势上转 angle（父骨骼也转了时会累加，适合翅膀一节节折） */
function turn(p: Posable, name: string, axis: THREE.Vector3, angle: number): void {
  const b = p.bones.get(name), r = p.rest.get(name);
  if (!b || !r) return;
  _a.copy(axis).applyQuaternion(_q.copy(r.rel).invert()).normalize();
  b.quaternion.copy(r.local).multiply(_q.setFromAxisAngle(_a, angle));
}

/** 同一根骨骼先绕 ax1 转 a1、再绕 ax2 转 a2（两个轴都在模型根坐标系里，比如脊椎同时上下弯和左右摆） */
function turn2(p: Posable, name: string, ax1: THREE.Vector3, a1: number, ax2: THREE.Vector3, a2: number): void {
  const b = p.bones.get(name), r = p.rest.get(name);
  if (!b || !r) return;
  const inv = r.rel.clone().invert();
  const q1 = new THREE.Quaternion().setFromAxisAngle(ax1.clone().applyQuaternion(inv).normalize(), a1);
  const q2 = new THREE.Quaternion().setFromAxisAngle(ax2.clone().applyQuaternion(inv).normalize(), a2);
  b.quaternion.copy(r.local).multiply(q1).multiply(q2);
}

/**
 * 骨骼 a → b 的静止方向（模型根坐标系，单位向量），按加载时记下的绑定姿势算。
 * （以前是第一次用到时按「那一刻」的姿势量，那时腿可能已经被转过了，量出来的「静止方向」偏了二三十度，
 * 之后每帧都拿错的基准去转，应龙的上臂被多转了快 40°，胸口的皮被拉得鼓出来。）
 */
function restDir(p: Posable, a: string, b: string): THREE.Vector3 {
  const A = p.rest.get(a), B = p.rest.get(b);
  if (!A || !B) return new THREE.Vector3(0, -1, 0);
  return B.pos.clone().sub(A.pos).normalize();
}

/** 把骨骼 upper（指向 lower）从静止方向转到 dir（模型根坐标系） */
function aim(p: Posable, upper: string, lower: string, dir: THREE.Vector3): void {
  const rest = restDir(p, upper, lower);
  _q.setFromUnitVectors(rest, _v.copy(dir).normalize());
  const s = Math.hypot(_q.x, _q.y, _q.z);
  if (s < 1e-6) { const b = p.bones.get(upper), r = p.rest.get(upper); if (b && r) b.quaternion.copy(r.local); return; }
  turn(p, upper, new THREE.Vector3(_q.x / s, _q.y / s, _q.z / s), 2 * Math.atan2(s, _q.w));
}

/**
 * 一条腿（upper → mid → end）：upper 指向 d1、mid 指向 d2（都在父骨骼的坐标系里，也就是跟着身体走）。
 * mid 的方向要先扣掉 upper 已经转的那一下，不然会转两遍。
 */
function aimLimb(p: Posable, upper: string, mid: string, end: string, d1: THREE.Vector3, d2: THREE.Vector3): void {
  aim(p, upper, mid, d1);
  const q1 = new THREE.Quaternion().setFromUnitVectors(restDir(p, upper, mid), d1.clone().normalize());
  aim(p, mid, end, d2.clone().normalize().applyQuaternion(q1.invert()));
}

const ease = (k: number): number => { const t = Math.min(1, Math.max(0, k)); return t * t * (3 - 2 * t); };

/**
 * ③ 擒起的时间轴（秒，演出内的本地时间，抓住前后有慢动作）：
 * 0 起 灵宠从前上方绕到身后高处（swoop 之前），燎抬头看着它；crouch → takeoff 下蹲蓄力、双手往后摆；
 * takeoff → +push 蹬地（腿伸直、手往前上方甩）；离地后按重力飞到 apex 米高，最高点那一刻（catch）正好抓住俯冲下来的爪子；
 * 之后 carry 秒被带着往前上方飞，交给滑翔。
 */
const GRAB = { swoop: 0.8, crouch: 0.5, takeoff: 0.88, push: 0.1, apex: 1.15, drift: 0.5, gravity: 13, carry: 0.75 };
const GRAB_LEAVE = GRAB.takeoff + GRAB.push;
const GRAB_V0 = Math.sqrt(2 * GRAB.gravity * GRAB.apex);
const GRAB_CATCH = GRAB_LEAVE + GRAB_V0 / GRAB.gravity;
/** 0..1..0 的平滑小包（a 到 b 之间） */
const bump = (t: number, a: number, b: number): number => { const u = (t - a) / (b - a); return u <= 0 || u >= 1 ? 0 : Math.sin(u * Math.PI) ** 2; };
const clamp01 = (k: number): number => Math.min(1, Math.max(0, k));

/**
 * 燎的全身姿势。arms：0 垂手 → 1 双手举成 V 字；back：手往身后摆（蓄力）；crouch：下蹲（脚踩在地上，腰往下沉，上身前倾）；
 * lean：上身前倾（负 = 后仰）；tuck：空中收腿；legs：两条大腿一起往后（正）/ 往前甩；swing：两腿交替前后荡的幅度；
 * toes：绷脚尖；grip：手指握拢；look：看向这个世界坐标（不给就按 arms 抬头）。
 */
interface HeroPose { arms: number; back?: number; crouch?: number; lean?: number; tuck?: number; legs?: number; swing?: number; toes?: number; grip?: number; look?: THREE.Vector3 | null; time: number }

/** 跟随位偏离视线多少（弧度，约 31°）：在画面右（左）前方，整只看得见又不挡准星 */
const FOLLOW_SIDE = 0.55;
/** 回头看用的骨骼（有哪根转哪根，角度平分） */
const HEAD_BONES = ['neck', 'neck_1', 'neck_2', 'head'];

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** 临界阻尼弹簧（SmoothDamp）：cur 朝 target 走，smooth ≈ 追上要的秒数，st.v 是速度状态，maxSpeed 限速 */
function damp(cur: number, target: number, st: { v: number }, smooth: number, dt: number, maxSpeed = Infinity): number {
  if (dt <= 0) return cur;
  const w = 2 / Math.max(1e-4, smooth), x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const lim = maxSpeed * smooth;
  const d = THREE.MathUtils.clamp(cur - target, -lim, lim), to = cur - d;
  const tmp = (st.v + w * d) * dt;
  st.v = (st.v - w * tmp) * e;
  let out = to + (d + tmp) * e;
  if ((target - cur > 0) === (out > target)) { out = target; st.v = 0; }
  return out;
}

/** 向量版：整体限速（不是每个分量各限各的） */
function dampVec(cur: THREE.Vector3, target: THREE.Vector3, vel: THREE.Vector3, smooth: number, dt: number, maxSpeed: number): void {
  if (dt <= 0) return;
  const w = 2 / Math.max(1e-4, smooth), x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const d = cur.clone().sub(target);
  const lim = maxSpeed * smooth;
  if (d.length() > lim) d.setLength(lim);
  const to = cur.clone().sub(d);
  const tmp = vel.clone().addScaledVector(d, w).multiplyScalar(dt);
  vel.addScaledVector(tmp, -w).multiplyScalar(e);
  const out = to.add(d.add(tmp).multiplyScalar(e));
  if (target.clone().sub(cur).dot(out.clone().sub(target)) > 0) { out.copy(target); vel.set(0, 0, 0); }
  cur.copy(out);
}
const back = (k: number): number => { const t = Math.min(1, Math.max(0, k)), c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

// ───────────────────────────── 特效 ─────────────────────────────

const PARTICLE_VS = /* glsl */ `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying float vAlpha; varying vec3 vColor;
void main() {
  vAlpha = aAlpha; vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * 420.0 / -mv.z, 0.0, 64.0);
  gl_Position = projectionMatrix * mv;
}`;
const PARTICLE_FS = /* glsl */ `
varying float vAlpha; varying vec3 vColor; uniform float uSoft;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float a = pow(1.0 - r, uSoft) * vAlpha;
  gl_FragColor = vec4(vColor * (uSoft < 1.5 ? 1.0 : 1.0), a);
}`;

/** 一组粒子：火星（叠加发光）或尘土（普通混合）；每颗粒子有自己的速度、阻力、重力、寿命、大小、颜色 */
class Particles {
  readonly points: THREE.Points;
  private readonly n: number;
  private readonly pos: Float32Array; private readonly col: Float32Array;
  private readonly size: Float32Array; private readonly alpha: Float32Array;
  private readonly vel: Float32Array; private readonly life: Float32Array; private readonly age: Float32Array;
  private readonly base: Float32Array; private readonly grav: Float32Array;
  private next = 0;
  constructor(n: number, additive: boolean, soft: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.life = new Float32Array(n).fill(1);
    this.age = new Float32Array(n).fill(9); this.base = new Float32Array(n); this.grav = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, uniforms: { uSoft: { value: soft } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, size: number, life: number, gravity = 0): void {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3); this.col.set([color.r, color.g, color.b], i * 3);
    this.base[i] = size; this.life[i] = life; this.age[i] = 0; this.grav[i] = gravity;
  }
  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      const a = (this.age[i] += dt), t = a / this.life[i];
      if (t >= 1) { this.alpha[i] = 0; continue; }
      const drag = Math.exp(-dt * 1.8);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - this.grav[i] * dt; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.min(1, t * 8) * (1 - t);
      this.size[i] = this.base[i] * (0.6 + 0.8 * t);
    }
    const g = this.points.geometry;
    for (const name of ['position', 'aSize', 'aAlpha', 'aColor']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** 翅尖拖出的风痕：最近 N 个位置连成一条渐隐的带子（叠加发光） */
class Trail {
  readonly mesh: THREE.Mesh;
  private readonly hist: THREE.Vector3[] = [];
  private readonly pos: Float32Array; private readonly col: Float32Array;
  constructor(private readonly N: number, readonly color: THREE.Color) {
    this.pos = new Float32Array(N * 2 * 3); this.col = new Float32Array(N * 2 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }
  reset(): void { this.hist.length = 0; this.col.fill(0); (this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true; }
  push(p: THREE.Vector3, strength: number, width: number): void {
    this.hist.unshift(p.clone());
    if (this.hist.length > this.N) this.hist.pop();
    for (let i = 0; i < this.N; i++) {
      const h = this.hist[Math.min(i, this.hist.length - 1)] ?? p;
      const w = width * (1 - i / this.N);
      this.pos.set([h.x, h.y + w, h.z, h.x, h.y - w, h.z], i * 6);
      const k = i < this.hist.length ? strength * (1 - i / this.N) ** 1.5 : 0;
      this.col.set([this.color.r * k, this.color.g * k, this.color.b * k, this.color.r * k, this.color.g * k, this.color.b * k], i * 6);
    }
    const g = this.mesh.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

const AURA_VS = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const AURA_FS = /* glsl */ `
uniform vec3 uCore; uniform vec3 uEdge; uniform float uAlpha; uniform float uTime;
varying vec3 vN; varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
  float flick = 0.85 + 0.15 * sin(uTime * 23.0 + vN.y * 9.0);
  gl_FragColor = vec4(mix(uCore, uEdge, f) * flick, (0.12 + f) * uAlpha);
}`;

// ───────────────────────────── 飞渡 ─────────────────────────────

type Phase = 'idle' | 'rise' | 'grow' | 'grab' | 'glide' | 'land' | 'drop';

/** yaw：想飞的方向（鼠标和 A / D 都改它，检视页里就是第一人称的朝向） */
export interface FlightInput { forward: number; right: number; yaw: number; release: boolean; dt: number }

export class PetFlight {
  readonly group = new THREE.Group();
  petId: FlyingPetId | null = 'chongming';
  phase: Phase = 'idle';
  /** 第三人称镜头（演出期间每帧更新）和视野（越快越宽） */
  readonly cam = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  fov = 72;
  speed = 0;
  agl = 0;
  /** 被坡顶外的风往回推的程度 0..1（检视页据此把第一人称朝向也转过来，不跟风较劲） */
  pull = 0;
  /** 正在演出、镜头不在眼睛上（检视页按它切第三人称） */
  thirdPerson = false;
  near: FlightPerch | null = null;
  heading = 0;
  private pet: Posable | null = null;
  loadedId: FlyingPetId | null = null;
  hero: Posable | null = null;
  private heroScale = 1;
  /** 燎面朝 +z 时的修正转角（模型自己朝向不一定是 +z） */
  private heroFace = 0;
  private t = 0;
  private scale = 1;
  /** 燎的脚（飞渡期间的物理位置） */
  private readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private bank = 0;
  private flare = 0;
  private readonly start0 = new THREE.Vector3();
  private readonly eye0 = new THREE.Vector3();
  private readonly petFrom = new THREE.Vector3();
  private readonly camFrom = new THREE.Vector3();
  private readonly lookFrom = new THREE.Vector3();
  /** 擒起：跳到最高点时双手在哪（灵宠爪子要到的地方）、量过没有；燎的腿长（下蹲时腰沉多少） */
  private readonly catchAt = new THREE.Vector3();
  private catchReady = false;
  /** 擒起时镜头相对燎的偏移（走弹簧，拉近、被挡住抬高时都平滑） */
  private readonly grabOff = new THREE.Vector3();
  private readonly grabOffV = new THREE.Vector3();
  private legLen = 0.85;
  private readonly sparks = new Particles(700, true, 1.6);
  private readonly dust = new Particles(260, false, 1.2);
  private readonly aura: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly flash = new THREE.PointLight('#bff6ff', 0, 30, 2);
  private readonly trails = [new Trail(26, new THREE.Color('#d8fbff')), new Trail(26, new THREE.Color('#d8fbff'))];
  private ringT = -1;
  private readonly ringAt = new THREE.Vector3();
  private readonly fireCore = new THREE.Color(); private readonly fireEdge = new THREE.Color(); private readonly shardCol = new THREE.Color();
  private readonly dustCol = new THREE.Color('#b9a582');
  private seed = 11;
  /** 镜头偏在哪一侧（1 右 / −1 左），被挡住时换边，换了就保持 */
  private camSide = 1;
  // 平时跟随的状态：灵宠位置 / 速度，它在燎周围的方位角、距离、高度（各带一个弹簧速度），朝向、侧倾、俯仰
  private fState: 'init' | 'resume' | 'run' = 'init';
  private readonly fPos = new THREE.Vector3();
  private readonly fVel = new THREE.Vector3();
  private readonly fEye = new THREE.Vector3();
  /** 跟随位上一帧在哪、它自己移动的速度（燎走路 + 绕着燎转，平滑过）：位置弹簧按它加提前量 */
  private readonly fSlot = new THREE.Vector3();
  private readonly fSlotV = new THREE.Vector3();
  private fAng = 0; private readonly fAngV = { v: 0 };
  private fRad = 3; private readonly fRadV = { v: 0 };
  private fUp = 0.6; private readonly fUpV = { v: 0 };
  private fFace = 0; private readonly fFaceV = { v: 0 };
  private fBank = 0; private fPitch = 0.5; private fNose = 0; private fHead = 0;
  private fSide = 1; private fSideT = 0; private fMoving = false; private fAwayT = 0; private fLookT = 3;
  /** 视角转得多快（弧度 / 秒，平滑过）：持续转动时灵宠按这个提前量追，不会一直落在画面外 */
  private fYaw = 0; private fYawRate = 0;
  /** 翅膀扇动的相位（累加，扇动快慢变了也不跳）和这一刻的快慢 / 幅度 */
  private flapPh = 0; private flapT = -1; private flapS = 1; private flapA = 0.6;
  /** 应龙回头看的角度（叠在 dragonPose 的脖子和头上） */
  private dragonLook = 0;

  constructor(
    /** 脚下的地面（地形或桥面、屋顶）：y 以下最高的可站立面 */
    private readonly ground: (x: number, z: number, y: number) => number,
    /** 只看地形的高度（镜头不钻进地里） */
    private readonly terrainAt: (x: number, z: number) => number,
    /** 这个点在不在实心的东西里（房子、旗杆、桥楼……）：镜头被挡住就换边或往前推 */
    private readonly solid: (x: number, y: number, z: number) => boolean,
    private readonly bound: (x: number, z: number) => number,
    private readonly wind: () => number,
  ) {
    this.group.name = 'pet-flight';
    this.aura = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.ShaderMaterial({
      vertexShader: AURA_VS, fragmentShader: AURA_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uCore: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime: { value: 0 } },
    }));
    this.aura.visible = false;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), new THREE.MeshBasicMaterial({
      color: '#bff6ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.group.add(this.sparks.points, this.dust.points, this.aura, this.ring, this.flash, ...this.trails.map(t => t.mesh));
    void loadPosable(HERO_URL).then(h => {
      if (!h) return;
      this.hero = h;
      this.heroScale = HERO_HEIGHT / h.height;
      h.root.scale.setScalar(this.heroScale);
      // 朝向：脚跟 → 脚尖是前方，转成 +z
      const fwd = restDir(h, 'LeftFoot', 'LeftToeBase');
      this.heroFace = Math.atan2(fwd.x, fwd.z);
      // 腿长：髋 → 膝 → 踝（缩放后的米数），下蹲时据此算腰往下沉多少，脚才踩在地上
      h.root.updateMatrixWorld(true);
      const bp = (n: string) => h.bones.get(n)?.getWorldPosition(new THREE.Vector3());
      const hip = bp('LeftUpLeg'), knee = bp('LeftLeg'), ankle = bp('LeftFoot');
      if (hip && knee && ankle) this.legLen = hip.distanceTo(knee) + knee.distanceTo(ankle);
      h.root.visible = false;
      this.group.add(h.root);
    });
  }

  get active(): boolean { return this.phase !== 'idle'; }
  get petName(): string { return this.petId ? FLYING_PETS[this.petId].name : '无'; }

  private rand(): number { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  /** 换随身灵宠（null = 没有会飞的灵宠） */
  setPet(id: FlyingPetId | null): void {
    if (this.active) return;
    this.petId = id;
    if (this.pet) { this.group.remove(this.pet.root); this.pet = null; this.loadedId = null; }
    if (!id) return;
    const want = id;
    void loadPosable(FLYING_PETS[id].url).then(p => {
      if (!p || this.petId !== want) return;
      this.pet = p;
      this.loadedId = want;
      this.group.add(p.root);
      this.setScale(FLYING_PETS[want].carryHeight / p.height);
      this.fState = 'init';
      const S = FLYING_PETS[want];
      this.fireCore.set(S.fire[0]); this.fireEdge.set(S.fire[1]); this.shardCol.set(S.shard);
      (this.aura.material as THREE.ShaderMaterial).uniforms.uCore.value.set(S.fire[0]);
      (this.aura.material as THREE.ShaderMaterial).uniforms.uEdge.value.set(S.fire[1]);
      (this.ring.material as THREE.MeshBasicMaterial).color.set(S.fire[1]);
      this.flash.color.set(S.fire[0]);
      for (const t of this.trails) t.color.set(S.fire[0]);
    });
  }

  private setScale(s: number): void { this.scale = s; if (this.pet) this.pet.root.scale.setScalar(s); }

  /** 站在起飞台旁边、有会飞的灵宠、燎的模型也读好了：可以起飞 */
  canStart(feet: THREE.Vector3, grounded: boolean): FlightPerch | null {
    if (this.active || !this.pet || !this.hero || !grounded) return null;
    return FLIGHT_PERCHES.find(p => Math.hypot(p.x - feet.x, p.z - feet.z) < p.r) ?? null;
  }

  /** 开始飞渡：yaw = 玩家当前朝向（灵宠朝这个方向飞出去），eye = 第一人称镜头位置 */
  start(feet: THREE.Vector3, yaw: number, eye: THREE.Vector3, lookDir: THREE.Vector3): boolean {
    if (!this.pet || !this.loadedId || !this.hero) return false;
    this.phase = 'rise';
    this.t = 0;
    this.heading = yaw;
    this.pos.copy(feet);
    this.start0.copy(feet);
    this.eye0.copy(eye);
    this.petFrom.copy(this.pet.root.position);
    this.camFrom.copy(eye);
    this.lookFrom.copy(eye).addScaledVector(lookDir, 10);
    this.cam.copy(eye);
    this.look.copy(this.lookFrom);
    this.catchReady = false;
    this.flare = 0;
    for (const t of this.trails) t.reset();
    this.turnHead(0);
    this.thirdPerson = true;
    return true;
  }

  // ─────────── 姿势 ───────────

  private flapWings(time: number, speed: number, amp: number): void {
    const p = this.pet;
    if (!p || !this.loadedId) return;
    const S = FLYING_PETS[this.loadedId];
    // 相位按这一帧的快慢累加（直接用 time × speed 的话，speed 一变相位就跳，翅膀会抽一下）
    const step = this.flapT < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.flapT));
    this.flapT = time;
    this.flapPh = (this.flapPh + step * Math.PI * 2 * S.flap * speed) % (Math.PI * 2000);
    const ph = this.flapPh;
    // 翅膀绕身体长轴上下扇：鸟静止时身体立着，长轴 = 模型 Y（俯成水平后就是绕飞行方向扇）；
    // 龙是四足站姿，长轴 = 模型 Z，静止时翅膀往上收着，扇的时候先压到接近水平
    const dragon = S.kind === 'dragon';
    const ax = dragon ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0), bias = dragon ? -0.55 : 0.12;
    for (const [side, sgn] of [['L', 1], ['R', -1]] as const) {
      turn(p, `wing_1_${side}`, ax, sgn * (bias + amp * Math.sin(ph)));
      turn(p, `wing_2_${side}`, ax, sgn * amp * 0.45 * Math.sin(ph - 0.6));
      turn(p, `wing_3_${side}`, ax, sgn * amp * 0.3 * Math.sin(ph - 1.1));
    }
    if (dragon) return;
    const X = new THREE.Vector3(1, 0, 0);
    for (let k = 1; k <= 6; k++) turn(p, `tail_${k}`, X, 0.12 * Math.sin(time * 2 + k * 0.6));
  }

  /**
   * 灵宠的身体：俯 k × pitch 成飞行姿势，腿往回摆同样的角度（爪子朝下）；bank = 转弯侧倾，nose = 抬头（负）/ 低头；
   * face = 模型朝向角（朝向 (sin, cos)），默认就是飞行方向；hold = 爪子抓着燎的程度（龙的前爪会往下伸直握住）。
   */
  private body(k: number, bank: number, nose = 0, face = this.heading + Math.PI, hold = 0): void {
    const p = this.pet!, S = FLYING_PETS[this.loadedId!];
    p.root.rotation.set(S.pitch * k + nose, face, -bank, 'YXZ');
    if (S.kind === 'dragon') { this.dragonPose(k, hold, S.pitch * k + nose); return; }
    const X = new THREE.Vector3(1, 0, 0);
    for (const l of S.legs) turn(p, l, X, -S.pitch * k * 0.9);
  }

  /**
   * 应龙（有翼的四足中国龙）的飞行姿态，参考中国龙「游」的动态：头领着身体，波从脖子传到尾巴尖、越往后越大，头反过来抵消一部分保持平稳；
   * 四肢不直挺挺垂着，而是贴着身体——前爪往前探、微微握着（左前爪托着宝珠），后腿顺着尾巴往后拖，四条腿对角交替慢慢划（像在云里游），比身体的波晚半拍。
   * 悬停时腿放低、前爪张开往前抓；平飞时收紧、脖子往前伸；抓着燎时两只前爪往下伸直握住，后腿往后拖着荡。
   * k：0.4 以下是悬停，到 1 是平飞（和鸟的 k 同一个刻度）；hold：0..1 抓人的程度。
   */
  private dragonPose(k: number, hold: number, rootPitch: number): void {
    const p = this.pet!;
    const c = clamp01((k - 0.4) / 0.6), h = clamp01(hold);
    const ph = this.flapPh, t = Math.max(0, this.flapT);
    const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
    // ── 身体的波：脖子 → 胸 → 腰 → 尾巴，相位依次往后推 0.7、幅度越往后越大；竖直的波跟着扇翅膀，左右的慢波是「游」 ──
    const spine = ['neck_2', 'neck_1', 'chest', 'spine2', 'spine1', 'tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5', 'tail_6'];
    let frontPitch = 0, frontYaw = 0;
    spine.forEach((n, i) => {
      // 抓着人时前半身的波压小（爪子要稳），尾巴照样甩
      const damp = i < 5 ? 1 - 0.6 * h : 1;
      const v = (0.03 + 0.018 * i) * Math.sin(ph - 0.7 * i) * damp;
      const l = (0.025 + 0.022 * i) * Math.sin(t * 2.1 - 0.8 * i) * (0.45 + 0.55 * c) * damp;
      // 平飞时脖子往前伸（静止时脖子是竖着的，像站着的马），头再抬回来平视前方
      const reach = n === 'neck_1' ? 0.5 * c : n === 'neck_2' ? 0.25 * c : 0;
      turn2(p, n, X, v + reach, Y, l + (n === 'neck_2' ? this.dragonLook * 0.4 : 0));
      if (i < 5) { frontPitch += v + reach; frontYaw += l; }
    });
    // 头抵消身体的波和整体俯仰，保持平稳（头是飞行方向的指示，不能跟着晃）
    turn2(p, 'head', X, -frontPitch * 0.85 - rootPitch * 0.6, Y, -frontYaw * 0.8 + this.dragonLook * 0.6);
    // ── 四肢：方向在身体坐标系里（+z 前、+y 上、+x 左），划动绕身体左右轴转 ──
    // 上臂、大腿只在静止方向附近小幅转：前胸两侧的皮有一部分挂在上臂上、肚子最下面一圈挂在大腿上，转多了会把胸口、肚子拉得鼓出来
    // （量过：上臂往前 10° 时胸口最多拉长 33%、30° 时 99%、60° 时 191%；大腿往后 30° 时肚子底下 5% 的边拉长 16% 以上）。
    // 所以上臂最多往前约 11°、大腿最多往后约 7°，往前探、往后拖主要靠小臂 / 小腿和爪子（它们的权重只在腿上）
    const paddle = (phase: number, amp: number) => amp * Math.sin(t * 3.0 + phase) * (1 - h);
    const limb = (side: 'L' | 'R', front: boolean) => {
      const o = side === 'L' ? 1 : -1;
      const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x * o, y, z);
      let d1: THREE.Vector3, d2: THREE.Vector3, curl: number;
      if (front) {
        // 上臂：悬停略往前、平飞往前约 11°、抓人就是静止方向；小臂：悬停往前下方抓，平飞往前探、贴着下巴（左前爪托珠，抬得更高），抓人往下伸直
        const pearl = side === 'L' ? 1 : 0;
        // （小臂也只抬到 40° 左右：胸口底下靠前爪内侧的皮有四分之一挂在小臂上）
        const hover1 = v3(0.3, -0.95, 0.12), hover2 = v3(0.2, -0.62, 0.76);
        const cruise1 = v3(0.3, -0.93, 0.25), cruise2 = v3(0.15, -0.6 + 0.1 * pearl, 0.78);
        const hold1 = v3(0.31, -0.95, 0.06), hold2 = v3(0.15, -1, 0.04);
        d1 = hover1.lerp(cruise1, c).lerp(hold1, h);
        d2 = hover2.lerp(cruise2, c).lerp(hold2, h);
        curl = (-0.25 + 0.75 * c) * (1 - h) + 0.9 * h;
        // 对角交替划（左前和右后同相），划主要在小臂上
        const pd = paddle(side === 'L' ? 0 : Math.PI, 1);
        d1.applyAxisAngle(X, pd * 0.05);
        d2.applyAxisAngle(X, pd * (0.22 - 0.08 * c));
      } else {
        // 大腿：几乎就是静止方向，平飞再往后 10° 左右；小腿：悬停往下后方，平飞 / 抓人往后下方拖（约 53°，在肚子下面，不贴到侧腹上）
        const hover1 = v3(0.28, -0.9, -0.33), hover2 = v3(0.15, -0.8, -0.58);
        const cruise1 = v3(0.28, -0.82, -0.5), cruise2 = v3(0.12, -0.6, -0.8);
        d1 = hover1.lerp(cruise1, Math.max(c, h));
        d2 = hover2.lerp(cruise2, Math.max(c, h));
        // 后爪顺着腿往后伸（爪尖朝后下方），悬停时略微张开
        curl = 0.25 - 0.75 * Math.max(c, h);
        // 后腿比同侧前腿晚半拍；抓人时不划，改成被风吹着荡（都主要在小腿上）
        const pd = paddle(side === 'L' ? Math.PI - 1.2 : -1.2, 1) + 0.6 * h * Math.sin(t * 2.4 + (side === 'L' ? 0 : 1));
        d1.applyAxisAngle(X, pd * 0.04);
        d2.applyAxisAngle(X, pd * (0.27 - 0.08 * c));
      }
      const [u, m, e] = front ? [`upperarm_${side}`, `forearm_${side}`, `claw_${side}`] : [`thigh_${side}`, `shin_${side}`, `hclaw_${side}`];
      aimLimb(p, u, m, e, d1, d2);
      turn(p, e, X, curl);
    };
    limb('L', true); limb('R', true); limb('L', false); limb('R', false);
  }

  /**
   * 燎的姿势。arms：0 垂手（从 T 字姿势转下来），1 双手举过头；tuck：收腿（起跳 / 挂着荡）；swing：腿前后荡的幅度。
   * 胳膊的方向按模型自己的静止方向算（Mixamo 是 T 字，左臂朝 +x），不依赖骨骼的局部轴。
   */
  private poseHero(arms: number, tuck: number, swing: number, time: number): void {
    this.poseHeroFull({ arms, tuck, swing, time });
  }

  private poseHeroFull(o: HeroPose): void {
    const h = this.hero;
    if (!h) return;
    const back = ease(o.back ?? 0), crouch = o.crouch ?? 0, grip = o.grip ?? 0, arms = ease(o.arms);
    const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
    for (const [side, upper, lower] of [['Left', 'LeftArm', 'LeftForeArm'], ['Right', 'RightArm', 'RightForeArm']] as const) {
      const out = Math.sign(restDir(h, upper, lower).x) || (side === 'Left' ? 1 : -1);
      // 垂手 → （蓄力时）往身后摆 → 举成 V 字（燎头大、耳朵高，手要在头两边，爪子才不会扎进耳朵）
      const down = new THREE.Vector3(0.16 * out, -1, 0.05), behind = new THREE.Vector3(0.24 * out, -0.7, -0.68), up = new THREE.Vector3(0.55 * out, 1, 0.12);
      const dir = down.clone().lerp(behind, back).lerp(up, arms).normalize();
      // 中间那段（举到一半）往前划个弧，不从身体里穿过去（从身后甩上来时弧更大，像真的抡上去）
      dir.z += Math.sin(arms * Math.PI) * (0.9 + 0.5 * back);
      aim(h, upper, lower, dir.normalize());
      // 前臂保持静止的局部姿势（跟着上臂伸直）：上臂已经转到 dir，前臂再转一次就转过头了
      const fb = h.bones.get(lower), fr = h.rest.get(lower);
      if (fb && fr) fb.quaternion.copy(fr.local);
      // 手指握拢（T 字姿势手心朝下，四指往手心那边弯）
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (let j = 1; j <= 3; j++) turn(h, `${side}Hand${f}${j}`, Z, -out * grip * (j === 1 ? 0.8 : 1.1));
      turn(h, `${side}HandThumb2`, Y, out * grip * 0.6);
    }
    // 腿：下蹲 = 大腿往前 a、膝盖往回 2a、脚掌往前 a（脚底保持平，腰往下沉多少由 crouchDrop 算）
    const a = 0.95 * crouch, sw = (o.swing ?? 0) * Math.sin(o.time * 2.4), tuck = o.tuck ?? 0, legs = o.legs ?? 0, toes = o.toes ?? 0;
    turn(h, 'LeftUpLeg', X, -a - 0.5 * tuck + sw + legs);
    turn(h, 'RightUpLeg', X, -a - 0.25 * tuck - sw + legs);
    turn(h, 'LeftLeg', X, 2 * a + 0.9 * tuck);
    turn(h, 'RightLeg', X, 2 * a + 0.5 * tuck);
    turn(h, 'LeftFoot', X, -a + toes * 0.7);
    turn(h, 'RightFoot', X, -a + toes * 0.7);
    // 上身：下蹲时前倾保持平衡，lean 再加减
    const lean = 0.4 * crouch + (o.lean ?? 0);
    turn(h, 'Spine', X, lean * 0.5);
    turn(h, 'Spine1', X, lean * 0.5);
    // 头：看向 look（脖子转左右、头抬低），不给就按举手的程度抬头
    if (o.look) {
      h.root.updateMatrixWorld(true);
      const head = h.bones.get('Head');
      const hp = head ? h.root.worldToLocal(head.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(0, 1.6 / this.heroScale, 0);
      const d = h.root.worldToLocal(o.look.clone()).sub(hp);
      const yaw = THREE.MathUtils.clamp(wrapAngle(Math.atan2(d.x, d.z) - this.heroFace), -1.2, 1.2);
      const pitch = THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.5, 1.15);
      turn(h, 'Spine2', Y, yaw * 0.3);
      turn(h, 'Neck', Y, yaw * 0.7);
      turn(h, 'Head', X, -pitch * 0.8 + lean * 0.4);
    } else {
      turn(h, 'Spine2', Y, 0);
      turn(h, 'Neck', Y, 0);
      turn(h, 'Head', X, -0.45 * Math.min(1, o.arms * 1.4));
    }
  }

  /** 下蹲 crouch 时腰（模型根）要往下沉多少米，脚才还踩在地上 */
  private crouchDrop(crouch: number): number { return this.legLen * (1 - Math.cos(0.95 * crouch)); }

  private placeHero(lean = 0, swingT = 0): void {
    const h = this.hero!;
    h.root.position.copy(this.pos);
    h.root.rotation.set(lean + Math.sin(swingT * 1.3) * 0.06 * Math.min(1, swingT), this.heading + Math.PI - this.heroFace, -this.bank * 0.3, 'YXZ');
  }

  /** 燎双手的中点（世界坐标，先摆好姿势、放好位置） */
  private hands(out: THREE.Vector3): THREE.Vector3 {
    const h = this.hero!;
    h.root.updateMatrixWorld(true);
    const l = h.bones.get('LeftHand'), r = h.bones.get('RightHand');
    if (!l || !r) return out.copy(this.pos).add(new THREE.Vector3(0, 2.1, 0));
    return l.getWorldPosition(out).add(r.getWorldPosition(_v)).multiplyScalar(0.5);
  }

  /** 灵宠爪子的中点（世界坐标） */
  private grip(out: THREE.Vector3): THREE.Vector3 {
    const p = this.pet!, S = FLYING_PETS[this.loadedId!];
    p.root.updateMatrixWorld(true);
    const a = p.bones.get(S.grip[0]), b = p.bones.get(S.grip[1]);
    if (!a || !b) return out.copy(p.root.position);
    return a.getWorldPosition(out).add(b.getWorldPosition(_v)).multiplyScalar(0.5);
  }

  /** 把灵宠整体平移，让爪子正好落在燎的手上 */
  private snapPetToHands(): void {
    const p = this.pet!;
    const h = this.hands(new THREE.Vector3()), g = this.grip(new THREE.Vector3());
    p.root.position.add(h.sub(g));
  }

  // ─────────── 镜头 ───────────

  /** 从 subject 到 to 的连线，第一次碰到实心东西的位置（0..1，1 = 一路通畅） */
  private clearRun(subject: THREE.Vector3, to: THREE.Vector3): number {
    for (let k = 1; k <= 28; k++) {
      const t = k / 28;
      const x = subject.x + (to.x - subject.x) * t, y = subject.y + (to.y - subject.y) * t, z = subject.z + (to.z - subject.z) * t;
      if (this.terrainAt(x, z) + 0.8 > y || this.solid(x, y, z)) return Math.max(0, (k - 1.5) / 28);
    }
    return 1;
  }

  /**
   * 第三人称机位：在 subject 身后 back 米、偏到一侧 side 米、高 up 米。右边、左边都试，挑没被挡住的那边
   * （两边都挡就挑挡得少的那边、往前推到挡住之前）；永远在地面以上。
   */
  private shot(subject: THREE.Vector3, f: THREE.Vector3, back: number, side: number, up: number, out: THREE.Vector3, lock = false): THREE.Vector3 {
    const s = new THREE.Vector3(-f.z, 0, f.x);
    let best = -1;
    const cand = new THREE.Vector3();
    for (const sg of lock ? [this.camSide] : [this.camSide, -this.camSide]) {
      cand.copy(subject).addScaledVector(f, -back).addScaledVector(s, side * sg).add(new THREE.Vector3(0, up, 0));
      cand.y = Math.max(cand.y, this.terrainAt(cand.x, cand.z) + 1.2);
      const run = this.clearRun(subject, cand);
      if (run > best + 0.05) {
        best = run;
        out.lerpVectors(subject, cand, Math.max(0.2, run));
        if (run >= 1) { this.camSide = sg; break; }
      }
    }
    out.y = Math.max(out.y, this.terrainAt(out.x, out.z) + 1.2);
    return out;
  }

  /**
   * 侧面机位：在 subject 的左边或右边 dist 米（燎面朝峡谷时身后常常是上坡，侧面开阔），略往前 ahead 米、高 up 米；
   * 两边都试，挑没被挡住的那边并记住，下一帧不来回跳。
   */
  private sideShot(subject: THREE.Vector3, f: THREE.Vector3, dist: number, ahead: number, up: number, out: THREE.Vector3): THREE.Vector3 {
    const s = new THREE.Vector3(-f.z, 0, f.x);
    let best = -1;
    const cand = new THREE.Vector3();
    for (const sg of [this.camSide, -this.camSide]) {
      cand.copy(subject).addScaledVector(s, dist * sg).addScaledVector(f, ahead).add(new THREE.Vector3(0, up, 0));
      cand.y = Math.max(cand.y, this.terrainAt(cand.x, cand.z) + 1.5);
      const run = this.clearRun(subject, cand);
      if (run > best + 0.05) {
        best = run;
        out.lerpVectors(subject, cand, Math.max(0.25, run));
        if (run >= 1) { this.camSide = sg; break; }
      }
    }
    out.y = Math.max(out.y, this.terrainAt(out.x, out.z) + 1.2);
    return out;
  }

  /**
   * 擒起用的侧面机位：边是起跳前选好的，整段不换（换边会从人身上扫过去）；被挡住先往上抬，抬不开再往前推。
   */
  private lockedSide(subject: THREE.Vector3, f: THREE.Vector3, dist: number, ahead: number, up: number, out: THREE.Vector3): THREE.Vector3 {
    const s = new THREE.Vector3(-f.z, 0, f.x).multiplyScalar(this.camSide);
    const base = subject.clone().addScaledVector(s, dist).addScaledVector(f, ahead).add(new THREE.Vector3(0, up, 0));
    let best = -1;
    for (const lift of [0, 1.5, 3, 4.5]) {
      const cand = base.clone();
      cand.y = Math.max(cand.y + lift, this.terrainAt(cand.x, cand.z) + 1.5);
      const run = this.clearRun(subject, cand);
      if (run > best + 0.02) { best = run; out.lerpVectors(subject, cand, Math.max(0.3, run)); }
      if (run >= 1) break;
    }
    out.y = Math.max(out.y, this.terrainAt(out.x, out.z) + 1.2);
    return out;
  }

  /** 镜头最后一道保险：不在地下 */
  private keepCamAbove(): void { this.cam.y = Math.max(this.cam.y, this.terrainAt(this.cam.x, this.cam.z) + 0.9); }

  /** 燎的模型只在镜头离头超过 1.4 m 时显示（拉近到眼睛时藏起来，不会看到脑袋里面） */
  private heroVisibility(): void {
    const h = this.hero;
    if (!h) return;
    const head = this.pos.clone().add(new THREE.Vector3(0, EYE, 0));
    h.root.visible = this.cam.distanceTo(head) > 1.4;
  }

  // ─────────── 特效 ───────────

  private burstSparks(at: THREE.Vector3, n: number, speed: number, size: number, life: number, color: THREE.Color, up = 0): void {
    for (let i = 0; i < n; i++) {
      const u = this.rand() * 2 - 1, a = this.rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const v = new THREE.Vector3(Math.cos(a) * r, u, Math.sin(a) * r).multiplyScalar(speed * (0.4 + this.rand() * 0.6));
      v.y += up;
      this.sparks.emit(at, v, color, size * (0.6 + this.rand() * 0.8), life * (0.6 + this.rand() * 0.6), -0.5);
    }
  }

  private puffDust(at: THREE.Vector3, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a), 0.15 + this.rand() * 0.4, Math.sin(a)).multiplyScalar(speed * (0.5 + this.rand() * 0.6));
      this.dust.emit(at.clone().add(new THREE.Vector3(Math.cos(a) * 0.6, 0.1, Math.sin(a) * 0.6)), v, this.dustCol, 0.9 + this.rand() * 0.9, 1.4 + this.rand() * 0.8, 0.6);
    }
  }

  private shockRing(at: THREE.Vector3): void { this.ringT = 0; this.ringAt.copy(at); }

  private updateFx(dt: number, time: number): void {
    this.sparks.update(dt);
    this.dust.update(dt);
    (this.aura.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    if (this.ringT >= 0) {
      this.ringT += dt;
      const k = this.ringT / 0.9;
      this.ring.visible = k < 1;
      this.ring.position.copy(this.ringAt).setY(this.ringAt.y + 0.15);
      this.ring.scale.setScalar(1 + 15 * ease(k));
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      if (k >= 1) this.ringT = -1;
    }
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 200);
  }

  // ─────────── 每帧 ───────────

  /** 平时跟随的距离（燎的眼睛到灵宠，米）和比眼睛高多少：个子越大离得越远，画面里看着差不多大 */
  private followRange(): { rad: number; up: number } {
    const c = this.loadedId ? FLYING_PETS[this.loadedId].carryHeight : 1;
    return { rad: 1.6 + 1.6 * c, up: 0.2 + 0.2 * c };
  }

  /** 侧前方的跟随位（side = 1 右 / −1 左），落地收尾时灵宠飞回这里，跟随接着从这里开始 */
  private followSlot(eye: THREE.Vector3, yaw: number, side: number, ang = FOLLOW_SIDE): THREE.Vector3 {
    const { rad, up } = this.followRange(), a = yaw - side * ang;
    return eye.clone().add(new THREE.Vector3(-Math.sin(a) * rad, up, -Math.cos(a) * rad));
  }

  /** 这一侧的跟随位下面最高的东西（地形 / 屋顶 / 桥面）比眼睛高多少：贴着坡走时那一侧是山壁，换到另一边飞 */
  private sideFloor(eye: THREE.Vector3, yaw: number, side: number, ang: number): number {
    const s = this.followSlot(eye, yaw, side, ang);
    return Math.max(this.terrainAt(s.x, s.z), this.ground(s.x, s.z, s.y + 2)) - eye.y;
  }

  /**
   * 平时跟随（没在飞渡时每帧调一次，在第一人称镜头摆好之后）。灵宠有自己的位置，绕着燎飞：
   * - 视角小幅转动时它留在原地，像真东西一样在画面里滑过去，再慢慢靠回侧前方；
   * - 跑到身后看不见、或者挡在画面正中间，才绕个弧飞回侧前方（从身后绕，不横穿视线），离得近的那一侧；
   * - 走路时跟着往前飞（略超前一点，不拖在后面）；贴着坡走、那一侧是山壁就换到另一侧；
   * - 飞得快朝飞的方向、转弯侧倾，悬停时直起身子快扇翅膀，平飞时一阵扇一阵滑，偶尔回头看燎一眼；
   * - 不贴脸（离眼睛至少 1.5 m 多）、不钻进地里、不进房子。
   * halfFov：画面水平半视角（弧度），据此判断灵宠出没出画面、侧前方偏多少。
   */
  companion(time: number, dt: number, eye: THREE.Vector3, lookDir: THREE.Vector3, halfFov = 0.9): void {
    const p = this.pet;
    if (!p || !this.loadedId || this.active) return;
    const S = FLYING_PETS[this.loadedId];
    const yaw = Math.atan2(-lookDir.x, -lookDir.z);
    const { rad: R0, up: U0 } = this.followRange();
    // 低头看时跟着往下一点、抬头往上一点（还在画面里）
    const pitch = Math.asin(THREE.MathUtils.clamp(lookDir.y, -1, 1));
    const tilt = THREE.MathUtils.clamp(Math.tan(THREE.MathUtils.clamp(pitch, -0.6, 0.6)) * R0 * 0.75, -1.8, 1.8);
    // 刚换灵宠 / 瞬移到别的机位：直接放到跟随位；飞渡刚结束：从灵宠现在的位置接着飞
    if (this.fState !== 'run' || this.fEye.distanceTo(eye) > 12) {
      if (this.fState === 'resume') {
        this.fPos.copy(p.root.position);
        this.fFace = this.heading;
      } else {
        this.fSide = 1;
        this.fPos.copy(this.followSlot(eye, yaw, 1, THREE.MathUtils.clamp(halfFov - Math.atan2(0.8 * S.carryHeight, R0) - 0.07, 0.3, FOLLOW_SIDE)));
        this.fPos.y += tilt;
        this.fFace = yaw;
      }
      const d = this.fPos.clone().sub(eye);
      this.fAng = Math.atan2(-d.x, -d.z);
      this.fRad = Math.max(1.5, Math.hypot(d.x, d.z));
      this.fUp = d.y;
      this.fVel.set(0, 0, 0); this.fEye.copy(eye);
      this.fSlot.copy(this.fPos); this.fSlotV.set(0, 0, 0);
      this.fAngV.v = this.fRadV.v = this.fUpV.v = this.fFaceV.v = 0;
      this.fMoving = false; this.fAwayT = 0; this.fLookT = 3;
      this.fYaw = yaw; this.fYawRate = 0;
      this.fState = 'run';
    }
    if (dt <= 0) { p.root.position.copy(this.fPos); return; }

    this.fEye.copy(eye);
    this.fSideT += dt;
    this.fYawRate += (wrapAngle(yaw - this.fYaw) / dt - this.fYawRate) * Math.min(1, dt * 6);
    this.fYaw = yaw;

    // 灵宠在视线的哪一边：phi > 0 在右，< 0 在左；0 正前方，±π 正后方
    const phi = wrapAngle(yaw - this.fAng), aphi = Math.abs(phi);
    // 侧前方偏多少：整只都在画面里（个子大、画面窄就往里收），出画面的判定也按半个身子算
    const halfSize = Math.atan2(0.8 * S.carryHeight, R0);
    const sideAng = THREE.MathUtils.clamp(halfFov - halfSize - 0.07, 0.3, FOLLOW_SIDE), edge = halfFov - halfSize * 0.5;
    if (!this.fMoving) {
      // 挡在正中间，或者出了画面边缘一小会儿（甩一下视角又甩回来不算）；视角还在猛甩就先等它停下，看停在哪再飞
      const bad = aphi < 0.3 || aphi > edge;
      this.fAwayT = bad ? (Math.abs(this.fYawRate) > 2.5 ? this.fAwayT : this.fAwayT + dt) : 0;
      if (this.fAwayT > (aphi > edge + 0.8 ? 0.1 : 0.25)) {
        this.fMoving = true;
        this.fSide = Math.sign(phi) || this.fSide;
      }
    } else if (Math.abs(wrapAngle(phi - this.fSide * sideAng)) < 0.12 && Math.abs(this.fYawRate) < 0.35 && Math.abs(this.fAngV.v) < 0.3) {
      // 追到了、停稳了、视角也不转了，才回到「原地悬停」（一直在转就一直跟着追）
      this.fMoving = false;
    }
    if (!this.fMoving) this.fSide = Math.sign(phi) || this.fSide;
    // 这一侧是山壁（跟随位下面的地比眼睛还高）、另一侧开阔：换边，换过 2 s 内不再换
    if (this.fSideT > 2) {
      const here = this.sideFloor(eye, yaw, this.fSide, sideAng), there = this.sideFloor(eye, yaw, -this.fSide, sideAng);
      if (here > -0.6 && there < here - 1.5) { this.fSide = -this.fSide; this.fMoving = true; this.fSideT = 0; }
    }
    // 角度往哪边走：默认走近路；近路要横穿视线正前方时绕到身后走远路（看不见，就不晃眼）
    const wander = 0.09 * Math.sin(time * 0.31 + 1.3) + 0.05 * Math.sin(time * 0.83 + 0.4);
    const want = this.fSide * (sideAng + wander);
    let delta = wrapAngle(want - phi);
    if (this.fMoving && aphi > 0.3 && Math.sign(phi) !== Math.sign(want) && aphi + Math.abs(want) < Math.PI) delta -= Math.sign(delta) * Math.PI * 2;
    // 舒适区里很软（视角转它几乎不动），要绕回来时才快；追的时候按视角转速加提前量（弹簧本身会落后 转速 × 时间）
    const angSmooth = this.fMoving ? 0.35 : 2.4;
    // （只按「持续地转」算提前量：猛甩一下不算，不然灵宠会跟着视角来回急掉头）
    const lead = this.fMoving ? THREE.MathUtils.clamp(this.fYawRate, -1.5, 1.5) * angSmooth : 0;
    // 绕回来时角速度封顶（绕得太急像被甩过来；掉头太猛由下面位置的加速度上限管），同时飞得开一点
    this.fAng = damp(this.fAng, this.fAng - delta + lead, this.fAngV, angSmooth, dt, this.fMoving ? 2.7 : 0.7);
    this.fRad = damp(this.fRad, R0 + (this.fMoving ? 1.1 : 0) + 0.3 * Math.sin(time * 0.23), this.fRadV, 0.7, dt);
    // 高度：跟着低头抬头（tilt），追的时候飞高一点绕过来，平时上下轻轻浮
    this.fUp = damp(this.fUp, U0 + tilt + (this.fMoving ? 0.5 : 0) + 0.16 * Math.sin(time * 1.7) + 0.22 * Math.sin(time * 0.37 + 2), this.fUpV, 0.6, dt);

    // 想去的位置：眼睛 + 极坐标；下面有地 / 屋顶就抬高，钻进房子就往上躲
    const posSmooth = this.fMoving ? 0.4 : 0.36;
    const slot = eye.clone();
    slot.x += -Math.sin(this.fAng) * this.fRad;
    slot.z += -Math.cos(this.fAng) * this.fRad;
    slot.y += this.fUp;
    const clear = 0.55 + 0.45 * S.carryHeight;
    slot.y = Math.max(slot.y, this.terrainAt(slot.x, slot.z) + clear, this.ground(slot.x, slot.z, slot.y + 2) + clear);
    for (let i = 0; i < 8 && this.solid(slot.x, slot.y, slot.z); i++) slot.y += 0.6;
    // 往前看一小段：照现在的速度飞过去会擦到坡，就提前抬高（追人、绕弯时常常是贴着坡飞过去的）
    const ahead = this.fPos.clone().addScaledVector(this.fVel, 0.4);
    slot.y = Math.max(slot.y, this.terrainAt(ahead.x, ahead.z) + clear);
    // 跟随位自己在动（燎走路、绕着燎转）：弹簧追一个匀速移动的点会落后「速度 × 弹簧时间」，按这个提前量追就跟得上
    const sv = slot.clone().sub(this.fSlot).divideScalar(dt);
    if (sv.length() > 30) sv.setLength(30);
    this.fSlotV.lerp(sv, Math.min(1, dt * 6));
    this.fSlot.copy(slot);
    const prevVel = this.fVel.clone(), pos0 = this.fPos.clone();
    dampVec(this.fPos, slot.clone().addScaledVector(this.fSlotV, posSmooth), this.fVel, posSmooth, dt, 26);
    // 加速度封顶 60 m/s²：起步、急停、掉头都是一个弧，不会一下折过去（再低就追不上快走的人，反倒会撞到「不贴脸」的硬约束上）
    // （速度一律用这一帧实际走的距离算，不用弹簧内部的速度，上限才是对着真实运动卡的）
    const dv = this.fPos.clone().sub(pos0).divideScalar(dt).sub(prevVel);
    if (dv.length() > 60 * dt) dv.setLength(60 * dt);
    this.fVel.copy(prevVel).add(dv);
    this.fPos.copy(pos0).addScaledVector(this.fVel, dt);
    // 硬约束：不贴脸、不在地下
    const toPet = this.fPos.clone().sub(eye), dMin = 1.5 + 0.6 * S.carryHeight;
    if (toPet.length() < dMin) this.fPos.copy(eye).addScaledVector(toPet.normalize(), dMin);
    this.fPos.y = Math.max(this.fPos.y, this.terrainAt(this.fPos.x, this.fPos.z) + 0.4);
    p.root.position.copy(this.fPos);

    // 朝向：飞得快朝飞的方向，悬停时跟燎看同一个方向
    const hv = Math.hypot(this.fVel.x, this.fVel.z);
    const velYaw = Math.atan2(-this.fVel.x, -this.fVel.z);
    const w = THREE.MathUtils.smoothstep(hv, 0.8, 3);
    this.fFace = damp(this.fFace, this.fFace + wrapAngle(yaw + wrapAngle(velYaw - yaw) * w - this.fFace), this.fFaceV, 0.3, dt, 4.5);
    const turnRate = this.fFaceV.v;
    // 转弯往里侧倾（越快倾得越多）；越快身子越平；爬升抬头、下滑低头
    this.fBank += (THREE.MathUtils.clamp(turnRate * (0.2 + hv * 0.07), -0.7, 0.7) - this.fBank) * Math.min(1, dt * 5);
    this.fPitch += (0.45 + 0.5 * THREE.MathUtils.smoothstep(hv, 0.5, 7) - this.fPitch) * Math.min(1, dt * 3);
    this.fNose += (THREE.MathUtils.clamp(-this.fVel.y * 0.07, -0.35, 0.3) - this.fNose) * Math.min(1, dt * 4);
    this.heading = this.fFace;
    this.body(this.fPitch, this.fBank, this.fNose, this.fFace + Math.PI);

    // 翅膀：悬停快扇；平飞稳扇，隔一阵收翅滑一段；往下滑收翅；爬升、急加速用力扇
    const acc = this.fVel.clone().sub(prevVel).divideScalar(dt).length();
    const cruise = THREE.MathUtils.smoothstep(hv, 1, 6);
    let fs = 1.15 - 0.35 * cruise, fa = 0.72 - 0.16 * cruise;
    const effort = Math.min(1, Math.max(0, this.fVel.y * 0.4) + acc * 0.05);
    fs += 0.35 * effort; fa += 0.2 * effort;
    const glide = Math.max(
      THREE.MathUtils.smoothstep(-this.fVel.y, 0.5, 1.6) * THREE.MathUtils.smoothstep(hv, 2.5, 5),
      THREE.MathUtils.smoothstep(Math.sin(time * 0.7 + 0.5), 0.55, 0.85) * cruise * (1 - effort),
    );
    fs += (0.3 - fs) * glide; fa += (0.1 - fa) * glide;
    this.flapS += (fs - this.flapS) * Math.min(1, dt * 3);
    this.flapA += (fa - this.flapA) * Math.min(1, dt * 3);
    this.flapWings(time, this.flapS, this.flapA);

    // 头：平时往转弯的方向看，隔几秒回头看燎一眼
    this.fLookT -= dt;
    if (this.fLookT < -1.6) this.fLookT = 3 + this.rand() * 4;
    const toEye = Math.atan2(-(eye.x - this.fPos.x), -(eye.z - this.fPos.z));
    const headWant = this.fLookT < 0 ? THREE.MathUtils.clamp(wrapAngle(toEye - this.fFace), -1.1, 1.1) : THREE.MathUtils.clamp(turnRate * 0.2, -0.45, 0.45);
    this.fHead += (headWant - this.fHead) * Math.min(1, dt * 4);
    this.turnHead(this.fHead);

    // 平时也在身后飘几颗小火星
    if (this.rand() < dt * 5) this.sparks.emit(this.fPos.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(0, 0.3, 0), this.fireEdge, 0.05, 0.8);
  }

  /** 头和脖子绕竖直方向转 angle（转向世界里的「上」，跟身子俯多少无关）；0 = 回正 */
  private turnHead(angle: number): void {
    const p = this.pet!;
    // 龙的脖子和头每帧由 dragonPose 摆（身体的波、头的平衡），回头看的角度交给它叠上去
    if (this.loadedId && FLYING_PETS[this.loadedId].kind === 'dragon') { this.dragonLook = angle; return; }
    const names = HEAD_BONES.filter(n => p.bones.has(n));
    if (!names.length) return;
    const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(p.root.quaternion.clone().invert());
    for (const n of names) turn(p, n, ax, angle / names.length);
  }

  /**
   * 返回值：演出 / 滑翔期间燎的脚应该在哪（检视页把行走者放到这里）；没在飞渡或松手往下掉时返回 null。
   * eye 是第一人称的眼睛位置。平时的跟随不在这里，在 companion()（检视页摆好镜头之后调）。
   */
  update(time: number, inp: FlightInput, eye: THREE.Vector3, feet: THREE.Vector3): THREE.Vector3 | null {
    // 擒起抓住的那一下前后放慢到三成（演出里的东西都按放慢后的时间走，火星也是）
    const slow = this.phase === 'grab' ? 1 - 0.68 * bump(this.t, GRAB_CATCH - 0.14, GRAB_CATCH + 0.24) : 1;
    const dt = inp.dt * slow;
    this.updateFx(dt, time);
    if (!this.active) {
      this.near = FLIGHT_PERCHES.find(p => Math.hypot(p.x - feet.x, p.z - feet.z) < p.r) ?? null;
      this.aura.visible = false;
      this.fov += (72 - this.fov) * Math.min(1, dt * 3);
      return null;
    }
    const p = this.pet!, S = FLYING_PETS[this.loadedId!];
    const big = S.rideHeight / p.height, small = S.carryHeight / p.height;
    this.t += dt;
    const fwd = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const tmp = new THREE.Vector3();

    if (this.phase === 'rise') {
      // ① 起势：灵宠从侧前方飞回来，绕燎螺旋上升一圈半；镜头从眼睛弧线拉到身侧（先往后、再往旁边绕）
      const D = 1.2, k = Math.min(1, this.t / D), e = ease(k);
      const ang = Math.atan2(this.petFrom.z - this.pos.z, this.petFrom.x - this.pos.x) + e * Math.PI * 3;
      const rad = 1.6 + 2.6 * e, hgt = EYE + 3.6 * e;
      const spiral = tmp.set(this.pos.x + Math.cos(ang) * rad, this.pos.y + hgt, this.pos.z + Math.sin(ang) * rad);
      p.root.position.lerpVectors(this.petFrom, spiral, Math.min(1, k * 3));
      this.body(0.7, 0.4, 0, Math.atan2(-Math.sin(ang), Math.cos(ang)));
      this.flapWings(time, 1.5, 0.8);
      if (this.rand() < 0.8) this.burstSparks(p.root.position, 2, 0.8, 0.1, 0.8, this.fireEdge, 0.3);
      this.poseHero(0, 0, 0, time);
      this.heroFacing(fwd);
      // 起势一直盯着燎的胸口（灵宠绕着他转，自然在画面里）
      const subj = this.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
      const want = this.sideShot(subj, fwd, 6.5, 1.5, 1.0, new THREE.Vector3());
      // 弧线：先往上、往侧面绕开（不往身后退：身后常常是上坡），镜头不会从人身体里穿过去
      const mid = this.eye0.clone().lerp(want, 0.35).add(new THREE.Vector3(0, 2.2, 0));
      mid.y = Math.max(mid.y, this.terrainAt(mid.x, mid.z) + 2);
      this.cam.copy(bezier(this.camFrom, mid, want, e));
      this.keepCamAbove();
      this.look.lerpVectors(this.lookFrom, subj, ease(Math.min(1, k * 1.8)));
      this.heroVisibility();
      if (k >= 1) {
        this.phase = 'grow'; this.t = 0; this.petFrom.copy(p.root.position);
        this.camFrom.copy(this.cam); this.lookFrom.copy(this.look);
      }
      return this.pos.clone();
    }

    if (this.phase === 'grow') {
      // ② 化形：飞到前上方悬停，灵火光罩包住，带回弹地变大；地上冲击环、闪光、四散的羽毛 / 鳞光
      const D = 1.3, k = Math.min(1, this.t / D);
      const hover = this.pos.clone().addScaledVector(fwd, 5.5).add(new THREE.Vector3(0, 6.5, 0));
      p.root.position.lerpVectors(this.petFrom, hover, ease(k * 1.6));
      const g = k < 0.25 ? 0 : back((k - 0.25) / 0.75);
      this.setScale(small + (big - small) * g);
      this.body(0.35, 0, -0.25 * Math.sin(k * Math.PI), Math.atan2(this.pos.x - hover.x, this.pos.z - hover.z));   // 面朝燎
      this.flapWings(time, 1.2 + 0.6 * k, 0.9);
      this.aura.visible = true;
      this.aura.position.copy(p.root.position).add(new THREE.Vector3(0, S.rideHeight * 0.45 * Math.max(0.3, g), 0));
      this.aura.scale.setScalar(Math.max(1.2, S.rideHeight * 0.75 * Math.max(0.35, g)) * (1 + 0.06 * Math.sin(time * 18)));
      (this.aura.material as THREE.ShaderMaterial).uniforms.uAlpha.value = Math.sin(Math.min(1, k * 1.15) * Math.PI) * 1.1;
      // 灵火从四周往灵宠身上收（前半），变大的那一下炸开（k≈0.25）
      if (k < 0.25) for (let i = 0; i < 4; i++) {
        const a = this.rand() * Math.PI * 2, r = 3.5 + this.rand() * 2;
        const from = p.root.position.clone().add(new THREE.Vector3(Math.cos(a) * r, (this.rand() - 0.3) * 4, Math.sin(a) * r));
        this.sparks.emit(from, p.root.position.clone().sub(from).multiplyScalar(2.6), this.fireEdge, 0.14, 0.4);
      }
      if (k >= 0.25 && this.t - dt < D * 0.25) {
        const c = p.root.position.clone().add(new THREE.Vector3(0, S.rideHeight * 0.4, 0));
        this.burstSparks(c, 110, 7, 0.16, 1.1, this.fireCore, 0.6);
        this.burstSparks(c, 60, 4.5, 0.24, 1.4, this.shardCol, 0);
        this.flash.position.copy(c); this.flash.intensity = 40;
        this.shockRing(this.pos.clone().setY(this.ground(this.pos.x, this.pos.z, this.pos.y + 2)));
        this.puffDust(this.pos, 26, 7);
      }
      if (k > 0.25 && this.rand() < 0.6) this.burstSparks(p.root.position.clone().add(new THREE.Vector3(0, S.rideHeight * 0.5, 0)), 2, 2, 0.12, 0.9, this.fireEdge, 0.8);
      this.poseHero(0.25 * k, 0, 0, time);
      this.heroFacing(fwd);
      // 镜头框住燎和灵宠：对准两者中点，离得越远退得越远
      const petC = p.root.position.clone().add(new THREE.Vector3(0, S.rideHeight * 0.4 * Math.max(0.3, g), 0));
      const subj = this.pos.clone().add(new THREE.Vector3(0, 1.2, 0)).lerp(petC, 0.5);
      const want = this.sideShot(subj, fwd, 7 + 0.8 * petC.distanceTo(this.pos), 1.5, -0.5, new THREE.Vector3());
      this.cam.lerpVectors(this.camFrom, want, ease(k));
      this.keepCamAbove();
      this.look.lerpVectors(this.lookFrom, subj, ease(k * 1.5));
      this.heroVisibility();
      if (k >= 1) {
        this.phase = 'grab'; this.t = 0; this.petFrom.copy(p.root.position);
        this.camFrom.copy(this.cam); this.lookFrom.copy(this.look);
        this.aura.visible = false;
      }
      return this.pos.clone();
    }

    if (this.phase === 'grab') {
      // ③ 擒起（时间轴见 GRAB）：灵宠从前上方绕到身后高处、俯冲下来；燎抬头盯着它，下蹲蓄力、双手往后摆，
      // 蹬地起跳、双手抡上去，跳到最高点那一刻正好抓住爪子（慢动作、火星、镜头一震），被一把带走，腿先被甩到后面再荡回来
      const G = GRAB, tau = this.t, up = new THREE.Vector3(0, 1, 0);
      const g0 = this.start0.y;
      if (!this.catchReady) {
        // 镜头放哪一侧：蹲着和跳到最高点两个机位都试，挑两边里挡得少的那边，整段擒起不再换
        let bestSide = this.camSide, bestRun = -1;
        for (const sg of [this.camSide, -this.camSide]) {
          const sv = side.clone().multiplyScalar(sg);
          const low = this.start0.clone().add(new THREE.Vector3(0, 1.1, 0)), high = low.clone().add(new THREE.Vector3(0, G.apex, 0));
          const run = Math.min(
            this.clearRun(low, low.clone().addScaledVector(sv, 4.6).addScaledVector(fwd, 0.8)),
            this.clearRun(high, high.clone().addScaledVector(sv, 6.2).addScaledVector(fwd, 1.2).add(new THREE.Vector3(0, -0.3, 0))),
          );
          if (run > bestRun + 0.05) { bestRun = run; bestSide = sg; }
        }
        this.camSide = bestSide;
        this.grabOff.copy(this.cam).sub(this.start0);
        this.grabOffV.set(0, 0, 0);
        // 跳到最高点时双手在哪：摆成举手的姿势放到最高点量一次，灵宠的俯冲就瞄准这里
        this.pos.copy(this.start0).addScaledVector(fwd, G.drift).setY(g0 + G.apex);
        this.poseHeroFull({ arms: 1, time });
        this.heroFacing(fwd);
        this.hands(this.catchAt);
        this.pos.copy(this.start0);
        this.catchReady = true;
      }
      // 灵宠从镜头对面那一侧绕过去（不从镜头和燎之间穿过）
      const pSide = side.clone().multiplyScalar(-this.camSide);
      const chest = new THREE.Vector3();
      if (tau < GRAB_CATCH) {
        // ── 灵宠 ──
        const B = this.start0.clone().addScaledVector(fwd, -6.5).addScaledVector(pSide, 2).setY(g0 + G.apex + 6);
        const prevFace = p.root.rotation.y;
        if (tau < G.swoop) {
          // 绕：前上方 → 侧面兜一个大弧 → 身后高处，一边飞一边转身
          const k = tau / G.swoop, e = ease(k);
          const mid = this.start0.clone().addScaledVector(pSide, 7).addScaledVector(fwd, 1).setY(g0 + G.apex + 7.5);
          const at = bezier(this.petFrom, mid, B, e), nxt = bezier(this.petFrom, mid, B, Math.min(1, e + 0.02));
          const tan = nxt.sub(at);
          if (k > 0.98 || tan.lengthSq() < 1e-6) tan.copy(fwd);
          const face = Math.atan2(tan.x, tan.z);
          this.bank += (THREE.MathUtils.clamp(wrapAngle(face - prevFace) / Math.max(dt, 1e-4) * 0.12, -0.7, 0.7) - this.bank) * Math.min(1, dt * 6);
          this.body(0.85, this.bank, 0, face);
          p.root.position.copy(at);
          this.flapWings(time, 1.3 * slow, 0.9);
        } else {
          // 俯冲：先压低机头扎下来（翅膀收起），快到时抬头拉平、猛扇翅膀、爪子往前伸，爪子正好落在最高点的双手上
          const k = (tau - G.swoop) / (GRAB_CATCH - G.swoop);
          const flareK = ease((k - 0.62) / 0.38);
          this.bank += (0 - this.bank) * Math.min(1, dt * 6);
          this.body(1, this.bank, 0.28 * (1 - flareK) - 0.4 * flareK, Math.atan2(fwd.x, fwd.z), ease(k));
          const gripOff = this.grip(tmp).sub(p.root.position);
          const C = this.catchAt.clone().sub(gripOff);
          const c1 = B.clone().addScaledVector(fwd, 3).addScaledVector(up, -1.5), c2 = C.clone().addScaledVector(fwd, -1.6).addScaledVector(up, 0.3);
          p.root.position.copy(cubic(B, c1, c2, C, k));
          this.flapWings(time, (0.45 + 1.8 * flareK) * slow, 0.25 + 0.75 * flareK);
          if (k > 0.5 && this.rand() < 0.7) this.burstSparks(this.grip(tmp), 1, 0.6, 0.1, 0.5, this.fireEdge, 0.2);
        }
        // ── 燎 ──
        const kC = clamp01((tau - G.crouch) / (G.takeoff - G.crouch));
        const kP = clamp01((tau - G.takeoff) / G.push);
        // 下蹲 → 蹬地（越蹬越快）；离地后按重力走，最高点 = catch
        const crouch = tau < G.takeoff ? ease(kC) : 1 - kP * kP;
        const air = Math.max(0, tau - GRAB_LEAVE);
        const y = tau < GRAB_LEAVE ? g0 - this.crouchDrop(crouch) : g0 + GRAB_V0 * air - 0.5 * G.gravity * air * air;
        this.pos.copy(this.start0).addScaledVector(fwd, G.drift * ease(clamp01((tau - G.takeoff) / (GRAB_CATCH - G.takeoff)))).setY(y);
        // 手：先放下（化形时抬起了一点）→ 蓄力往后摆 → 蹬地时往前上方抡 → 举直等着抓
        const swingUp = ease(clamp01((tau - G.takeoff + 0.04) / 0.3));
        const back = tau < G.takeoff ? ease(kC) : 1 - swingUp;
        const arms = tau < G.crouch ? 0.25 * (1 - ease(tau / 0.35)) : swingUp;
        this.poseHeroFull({
          arms, back, crouch,
          lean: -0.16 * bump(tau, G.takeoff, GRAB_CATCH - 0.05),
          tuck: 0.4 * ease(clamp01(air / 0.3)),
          toes: bump(tau, G.takeoff - 0.02, G.takeoff + 0.4),
          look: p.root.position.clone().add(new THREE.Vector3(0, S.rideHeight * 0.3, 0)),
          time,
        });
        this.heroFacing(fwd);
        if (tau >= GRAB_LEAVE && tau - dt < GRAB_LEAVE) this.puffDust(this.start0, 18, 4.5);
        // ── 镜头：侧面，蓄力、起跳时拉近看清动作；灵宠扎下来时退开、压低往上拍，把人和灵宠一起框进来 ──
        chest.copy(this.pos).add(new THREE.Vector3(0, 1.1, 0));
        const petC = p.root.position.clone().add(new THREE.Vector3(0, S.rideHeight * 0.3, 0));
        const wide = ease(clamp01((tau - 0.95) / (GRAB_CATCH - 0.95)));
        const subj = chest.clone().lerp(petC, 0.12 + 0.3 * wide);
        const want = this.lockedSide(chest, fwd, 4.6 + 1.6 * wide, 0.8 + 0.4 * wide, 0.15 - 0.45 * wide, new THREE.Vector3());
        // 镜头相对燎的偏移走弹簧：从化形的远景拉近（约 0.7 s）、被挡住抬高都是平滑的，不会跳
        dampVec(this.grabOff, want.sub(this.pos), this.grabOffV, 0.3, dt, 30);
        this.cam.copy(this.pos).add(this.grabOff);
        this.look.lerpVectors(this.lookFrom, subj, ease(clamp01(tau / 0.75)));
        this.fov += (72 - 4 * bump(tau, GRAB_CATCH - 0.3, GRAB_CATCH + 0.3) - this.fov) * Math.min(1, dt * 8);
      } else {
        // ── 抓住了：灵宠带着人往前上方飞（人在前、灵宠对齐到手上），先往下一沉（接住人的重量）再爬升 ──
        const tc = tau - GRAB_CATCH, k = clamp01(tc / G.carry);
        if (tc - dt <= 0) {
          this.vel.copy(fwd).multiplyScalar(8.6).add(new THREE.Vector3(0, -1.6, 0));
          const hd = this.hands(new THREE.Vector3());
          this.burstSparks(hd, 46, 3.2, 0.13, 0.7, this.fireCore, 0.3);
          this.burstSparks(hd, 20, 2, 0.2, 0.9, this.shardCol, 0);
          this.flash.position.copy(hd); this.flash.intensity = 14;
        }
        const hv = 8.6 + (S.speed * 0.75 - 8.6) * ease(k);
        // 先往下一沉再爬升；前面是上坡就提前爬（照这个速度 0.8 s 后脚下的地面，留 1.2 m），不会一头撞进坡里
        const ahead = this.ground(this.pos.x + fwd.x * hv * 0.8, this.pos.z + fwd.z * hv * 0.8, this.pos.y + 30);
        const vyWant = Math.max(-1.6 + 4.8 * ease(clamp01(tc / 0.65)), (ahead + 1.2 - this.pos.y) / 0.8);
        this.vel.set(fwd.x * hv, tc - dt <= 0 ? this.vel.y : this.vel.y + (vyWant - this.vel.y) * Math.min(1, dt * 8), fwd.z * hv);
        this.pos.addScaledVector(this.vel, dt);
        // 保险：脚下至少离地 0.6 m
        const floor = this.ground(this.pos.x, this.pos.z, this.pos.y + 1) + 0.6;
        if (this.pos.y < floor) { this.pos.y = floor; this.vel.y = Math.max(this.vel.y, 0); }
        // 腿：被一把带走，先甩到后面，再像钟摆一样荡回来（越荡越小），慢慢换成滑翔时的晃腿
        const legs = 0.7 * Math.exp(-2.6 * tc) * Math.cos(5.2 * tc) * (1 - k * k);
        this.poseHeroFull({
          arms: 1, grip: ease(clamp01(tc / 0.08)), tuck: 0.4 - 0.05 * k, legs, swing: 0.3 * ease(k),
          // 抬头看灵宠，交给滑翔前回正（滑翔时不转头）
          look: k < 0.8 ? p.root.position.clone().add(new THREE.Vector3(0, S.rideHeight * 0.35, 0)) : null, time,
        });
        this.placeHero(0.1 * ease(k), tc);
        this.body(1, 0, -0.35 * (1 - ease(clamp01(tc / 0.4))), undefined, 1);
        this.flapWings(time, (2.1 - 0.8 * k) * slow, 1.0 - 0.3 * k);
        this.snapPetToHands();
        this.wingTrails(0.4 * k);
        // 镜头：侧面（接着抓住前的机位）→ 慢慢绕到身后，正好接上滑翔的追尾机位；抓住那一下震一震
        chest.copy(this.pos).add(new THREE.Vector3(0, 1.1, 0));
        const sideCam = this.lockedSide(chest, fwd, 6.2, 1.2, -0.3, new THREE.Vector3());
        const chase = this.shot(this.pos.clone().add(new THREE.Vector3(0, 2.0, 0)), fwd, 7.5, 2.6, 1.0, new THREE.Vector3(), true);
        const kc = ease(k);
        dampVec(this.grabOff, sideCam.lerp(chase, kc).sub(this.pos), this.grabOffV, 0.25, dt, 30);
        this.cam.copy(this.pos).add(this.grabOff);
        const shake = 0.16 * Math.exp(-tc / 0.12);
        this.cam.add(new THREE.Vector3(Math.sin(tc * 97) * shake, Math.sin(tc * 79 + 1) * shake, Math.sin(tc * 61 + 2) * shake * 0.6));
        // （看的点接着抓住前那一帧：人和灵宠之间偏人那边）
        const petC = p.root.position.clone().add(new THREE.Vector3(0, S.rideHeight * 0.3, 0));
        this.look.lerpVectors(chest.clone().lerp(petC, 0.42), this.pos.clone().add(new THREE.Vector3(0, 2, 0)).addScaledVector(fwd, 7), kc);
        this.fov += (72 - this.fov) * Math.min(1, dt * 4);
        if (k >= 1) {
          this.phase = 'glide'; this.t = 0;
          for (const t of this.trails) t.reset();
        }
      }
      this.keepCamAbove();
      this.heroVisibility();
      return this.pos.clone();
    }

    if (this.phase === 'glide') {
      // ④ 滑翔
      const turnRate = 1.1;
      let dYaw = Math.atan2(Math.sin(inp.yaw - this.heading), Math.cos(inp.yaw - this.heading));
      dYaw = THREE.MathUtils.clamp(dYaw, -turnRate * dt, turnRate * dt);
      // 快到坡顶外面就开始被风吹着往回转（越往外转得越急），不会飞出峡谷
      const out = this.bound(this.pos.x + this.vel.x * 1.5, this.pos.z + this.vel.z * 1.5);
      const pull = Math.min(1, Math.max(0, (out + 12) / (MAP.softBoundary + 12)));
      this.pull = pull;
      if (pull > 0) {
        const backYaw = Math.atan2(-(-8 - this.pos.x), -(-18 - this.pos.z));
        const rate = 2.4 * pull * dt;
        dYaw = THREE.MathUtils.clamp(dYaw + Math.atan2(Math.sin(backYaw - this.heading), Math.cos(backYaw - this.heading)) * pull, -rate - turnRate * dt, rate + turnRate * dt);
      }
      this.heading += dYaw;
      this.bank += ((dYaw / Math.max(dt, 1e-4)) * 0.45 - this.bank) * Math.min(1, dt * 3);
      const f = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
      const g = this.ground(this.pos.x, this.pos.z, this.pos.y);
      this.agl = this.pos.y - g;
      // 离地 8 m 内自动拉平减速（不会一头扎进地里）；前方有坡就抬高越过
      this.flare += ((this.agl < 8 && this.t > 1.2 ? 1 : 0) - this.flare) * Math.min(1, dt * 2.5);
      const target = S.speed * (1 + 0.35 * Math.max(0, inp.forward) - 0.3 * Math.max(0, -inp.forward)) * (1 - 0.35 * this.flare);
      let sink = S.sink + 2.6 * Math.max(0, inp.forward) - 1.0 * Math.max(0, -inp.forward) - 3.2 * this.wind();
      sink = sink * (1 - this.flare) + 1.2 * this.flare;
      const ahead = this.ground(this.pos.x + f.x * 9, this.pos.z + f.z * 9, this.pos.y + 30);
      if (ahead > this.pos.y - 2.5 && this.agl > 2) sink = Math.min(sink, -2.5 * Math.min(2, (ahead - this.pos.y + 2.5) / 3));
      const hv = Math.hypot(this.vel.x, this.vel.z) + (target - Math.hypot(this.vel.x, this.vel.z)) * Math.min(1, dt * 0.8);
      this.vel.set(f.x * hv, this.vel.y + (-sink - this.vel.y) * Math.min(1, dt * 1.5), f.z * hv);
      this.pos.addScaledVector(this.vel, dt);
      // 地图边缘硬挡（只是保险，正常在坡顶外就转回来了）
      const B = MAP.bounds;
      this.pos.x = Math.min(B.maxX - 12, Math.max(B.minX + 12, this.pos.x));
      this.pos.z = Math.min(B.maxZ - 12, Math.max(B.minZ + 12, this.pos.z));
      this.speed = this.vel.length();
      const g2 = this.ground(this.pos.x, this.pos.z, this.pos.y + 0.5);
      this.agl = this.pos.y - g2;
      if (this.agl < 0.3) this.pos.y = g2 + 0.3;
      this.poseHeroFull({ arms: 1, tuck: 0.35, swing: 0.3 + 0.2 * Math.min(1, this.speed / 18), grip: 1, time });
      this.placeHero(0.1, this.t);
      this.body(1, this.bank * 0.6, 0, undefined, 1);
      this.flapWings(time, 0.65 + 0.4 * Math.min(1, this.speed / 20) + this.flare * 0.8, 0.55 + this.flare * 0.3);
      this.snapPetToHands();
      this.wingTrails(Math.min(1, this.speed / 18) * 0.55);
      if (this.wind() > 0.3 && this.rand() < 0.4) this.burstSparks(p.root.position.clone().addScaledVector(f, -2), 1, 1.5, 0.1, 0.7, this.fireEdge, 0.4);
      this.fov += ((72 + 12 * Math.min(1, Math.max(0, (this.speed - 10) / 12))) - this.fov) * Math.min(1, dt * 2);
      const want = this.shot(this.pos.clone().add(new THREE.Vector3(0, 2.0, 0)), f, 7.5, 2.6, 1.0, new THREE.Vector3());
      this.cam.lerp(want, Math.min(1, dt * 4));
      this.keepCamAbove();
      this.look.lerp(this.pos.clone().add(new THREE.Vector3(0, 2, 0)).addScaledVector(f, 7), Math.min(1, dt * 6));
      this.heroVisibility();
      if (this.t > 1.2 && this.agl < 1.1) {
        this.phase = 'land'; this.t = 0;
        this.camFrom.copy(this.cam); this.lookFrom.copy(this.look);
      } else if (inp.release) {
        this.phase = 'drop'; this.t = 0; this.petFrom.copy(p.root.position);
        this.thirdPerson = false;
        if (this.hero) this.hero.root.visible = false;
      }
      return this.pos.clone();
    }

    if (this.phase === 'land') {
      // ⑤ 落地：前 0.6 s 灵宠猛扇翅膀刹住、把人放到地上（扬尘），再 1.6 s 飞起来缩回原样、回到侧前方的跟随位；镜头弧线回到眼睛
      const D1 = 0.6, D2 = 1.6;
      const f = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
      const g = this.ground(this.pos.x, this.pos.z, this.pos.y + 0.5);
      if (this.t < D1) {
        const k = this.t / D1;
        const v = Math.max(0, 1 - k) * this.speed * 0.5;
        this.pos.addScaledVector(f, v * dt);
        this.pos.y = Math.max(g, this.pos.y - (this.pos.y - g) * Math.min(1, dt * 8));
        this.poseHeroFull({ arms: 1, tuck: 0.35 * (1 - k), swing: 0.1, grip: 1, time });
        this.placeHero(0.1 * (1 - k), 0);
        this.body(1 - 0.6 * k, 0, -0.5 * k, undefined, 1);
        this.flapWings(time, 2.2, 1.0);
        this.snapPetToHands();
        if (this.t + dt >= D1) { this.pos.y = g; this.puffDust(this.pos, 30, 6); this.shockRing(this.pos); this.petFrom.copy(p.root.position); }
      } else {
        const k = Math.min(1, (this.t - D1) / D2), e = ease(k);
        this.pos.y = g;
        // 落地屈膝缓冲一下（腰往下沉、膝盖弯），同时松手、手放下
        const absorb = 0.55 * bump(k, -0.05, 0.4);
        this.poseHeroFull({ arms: Math.max(0, 1 - k * 2.5), grip: Math.max(0, 1 - k * 5), crouch: absorb, time });
        this.placeHero(0, 0);
        if (this.hero) this.hero.root.position.y -= this.crouchDrop(absorb);
        // 灵宠先往上飞开，再缩小飞回跟随位；缩小那一下洒一圈光点
        const eyeNow = this.pos.clone().add(new THREE.Vector3(0, EYE, 0));
        const shoulder = this.followSlot(eyeNow, this.heading, 1);
        // 跟随位在坡上可能低过地面：抬到离地的高度（跟随接手时就不会被「不在地下」硬顶上去）
        shoulder.y = Math.max(shoulder.y, this.terrainAt(shoulder.x, shoulder.z) + 0.55 + 0.45 * S.carryHeight);
        const upHigh = this.petFrom.clone().add(new THREE.Vector3(0, 5, 0)).addScaledVector(f, 3);
        p.root.position.copy(bezier(this.petFrom, upHigh, shoulder, e));
        this.setScale(big + (small - big) * ease(k * 1.5));
        if (k > 0.3 && k - dt / D2 <= 0.3) this.burstSparks(p.root.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 60, 3.5, 0.14, 0.9, this.fireCore, 0.4);
        this.body(0.55, 0, 0, undefined, 1 - ease(Math.min(1, k * 2)));
        this.flapWings(time, 1.3, 0.7);
        // 镜头：从身后弧线回到眼睛，先抬高绕到头顶后方，最后落进眼睛（燎的模型在离头 1.4 m 内隐藏）
        const mid = eyeNow.clone().addScaledVector(f, -2.8).add(new THREE.Vector3(0, 1.4, 0));
        mid.y = Math.max(mid.y, this.terrainAt(mid.x, mid.z) + 2);
        this.cam.copy(bezier(this.camFrom, mid, eyeNow, e));
        if (k < 0.85) this.keepCamAbove();
        this.look.lerpVectors(this.lookFrom, eyeNow.clone().addScaledVector(f, 10), e);
        this.fov += (72 - this.fov) * Math.min(1, dt * 3);
        this.heroVisibility();
        if (k >= 1) this.finish();
      }
      this.wingTrails(0);
      return this.pos.clone();
    }

    // drop：空中松手，人自己掉下去（检视页交还给行走、回到第一人称），灵宠缩回原样
    const k = Math.min(1, this.t / 1.0);
    this.setScale(big + (small - big) * ease(k));
    p.root.position.copy(this.petFrom).add(new THREE.Vector3(0, 2 * k, 0));
    this.flapWings(time, 1.4, 0.8);
    this.wingTrails(0);
    if (k >= 1) this.finish();
    return null;
  }

  /** 燎面朝 fwd 站着（演出前半段） */
  private heroFacing(fwd: THREE.Vector3): void {
    const h = this.hero;
    if (!h) return;
    h.root.position.copy(this.pos);
    h.root.rotation.set(0, Math.atan2(fwd.x, fwd.z) - this.heroFace, 0);
  }

  /** 翅尖的风痕（strength = 0 时渐隐） */
  private wingTrails(strength: number): void {
    const p = this.pet!;
    p.root.updateMatrixWorld(true);
    ['wing_3_L', 'wing_3_R'].forEach((n, i) => {
      const b = p.bones.get(n);
      if (b) this.trails[i].push(b.getWorldPosition(new THREE.Vector3()), strength, 0.12 * this.scale);
    });
  }

  private finish(): void {
    this.phase = 'idle';
    this.thirdPerson = false;
    if (this.hero) this.hero.root.visible = false;
    this.aura.visible = false;
    this.speed = 0; this.agl = 0; this.bank = 0;
    for (const t of this.trails) t.reset();
    this.fState = 'resume';
    if (this.pet && this.loadedId) this.setScale(FLYING_PETS[this.loadedId].carryHeight / this.pet.height);
  }
}

/** 三次贝塞尔：a → (b, c) → d */
function cubic(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number): THREE.Vector3 {
  const u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return new THREE.Vector3(
    w0 * a.x + w1 * b.x + w2 * c.x + w3 * d.x,
    w0 * a.y + w1 * b.y + w2 * c.y + w3 * d.y,
    w0 * a.z + w1 * b.z + w2 * c.z + w3 * d.z,
  );
}

/** 二次贝塞尔：a → (b) → c */
function bezier(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, t: number): THREE.Vector3 {
  const u = 1 - t;
  return new THREE.Vector3(
    u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    u * u * a.z + 2 * u * t * b.z + t * t * c.z,
  );
}
