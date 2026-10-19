/**
 * 4-2 彩蛋 · 灵宠飞渡（docs/level-design/chuanzang-v1.md 3.8）：
 * 带着会飞的灵宠（精卫、重明鸟、应龙）走到峡谷里的三处风马旗台，按 F，演出分五段：
 *   ① 起势 1.2 s：镜头从眼睛弧线拉到身侧，灵宠离开肩头，绕着燎螺旋上升，一路洒灵火火星；
 *   ② 化形 1.3 s：灵宠悬在前上方，被灵火光罩包住、带回弹地变大，地上一圈冲击环，一道闪光，羽毛 / 鳞光四散；
 *   ③ 擒起 1.1 s：灵宠绕到身后俯冲过头顶，燎起跳、双手举起抓住爪子，被提离地面，镜头转到身后；
 *   ④ 滑翔：鼠标或 A / D 转向，W 俯冲，S 拉平，峡谷阵风往上托，翅尖拖出风痕，越快视野越宽；离地 8 m 内自动拉平减速；
 *   ⑤ 落地 2.2 s：灵宠猛扇翅膀减速、把人放到地上（扬起尘土），再飞起来缩回原样、回到肩头，镜头弧线回到眼睛。
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
  speed: number; sink: number; flap: number;
  /** 模型静止时身体是立着的（站姿），飞的时候整个往前俯 pitch 弧度成水平；腿再往回摆，爪子朝下 */
  pitch: number; legs: string[];
  /** 化形时灵火的颜色（芯、外焰）和四散的碎片颜色（羽毛 / 鳞光） */
  fire: [string, string]; shard: string;
}> = {
  jingwei: {
    name: '精卫', url: 'assets/characters/SK_Pet_Jingwei.glb', carryHeight: 0.75, rideHeight: 3.6, grip: ['talon_L', 'talon_R'],
    speed: 13, sink: 1.9, flap: 1.25, pitch: 1.15, legs: ['thigh_L', 'thigh_R'], fire: ['#fff2c4', '#ff7a2a'], shard: '#ff5a3a',
  },
  chongming: {
    name: '重明鸟', url: 'assets/characters/SK_Pet_Chongming.glb', carryHeight: 1.1, rideHeight: 4.2, grip: ['talon_L', 'talon_R'],
    speed: 14, sink: 1.6, flap: 1.0, pitch: 1.15, legs: ['thigh_L', 'thigh_R'], fire: ['#f4ffff', '#4fd8ff'], shard: '#ffcc4a',
  },
  yinglong: {
    name: '应龙', url: 'assets/characters/SK_Pet_Yinglong.glb', carryHeight: 1.4, rideHeight: 4.6, grip: ['claw_L', 'claw_R'],
    speed: 16.5, sink: 1.1, flap: 0.8, pitch: 0.6, legs: ['upperarm_L', 'upperarm_R', 'thigh_L', 'thigh_R'], fire: ['#f0fff6', '#3fe0b0'], shard: '#9ff7ff',
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
  rest: Map<string, { local: THREE.Quaternion; rel: THREE.Quaternion }>;
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
      const rest = new Map<string, { local: THREE.Quaternion; rel: THREE.Quaternion }>();
      for (const [name, b] of bones) rest.set(name, { local: b.quaternion.clone(), rel: inv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion())) });
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

/** 骨骼 a → b 的静止方向（模型根坐标系，单位向量） */
function restDir(p: Posable, a: string, b: string): THREE.Vector3 {
  const A = p.bones.get(a), B = p.bones.get(b);
  if (!A || !B) return new THREE.Vector3(0, -1, 0);
  const key = `dir:${b}`;
  if (A.userData[key]) return A.userData[key] as THREE.Vector3;
  const inv = new THREE.Matrix4().copy(p.root.matrixWorld).invert();
  const pa = A.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv), pb = B.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
  return (A.userData[key] = pb.sub(pa).normalize());
}

/** 把骨骼 upper（指向 lower）从静止方向转到 dir（模型根坐标系） */
function aim(p: Posable, upper: string, lower: string, dir: THREE.Vector3): void {
  const rest = restDir(p, upper, lower);
  _q.setFromUnitVectors(rest, _v.copy(dir).normalize());
  const s = Math.hypot(_q.x, _q.y, _q.z);
  if (s < 1e-6) { const b = p.bones.get(upper), r = p.rest.get(upper); if (b && r) b.quaternion.copy(r.local); return; }
  turn(p, upper, new THREE.Vector3(_q.x / s, _q.y / s, _q.z / s), 2 * Math.atan2(s, _q.w));
}

const ease = (k: number): number => { const t = Math.min(1, Math.max(0, k)); return t * t * (3 - 2 * t); };
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
  private heroUp = 0;
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
    this.heroUp = 0;
    this.flare = 0;
    for (const t of this.trails) t.reset();
    this.thirdPerson = true;
    return true;
  }

  // ─────────── 姿势 ───────────

  private flapWings(time: number, speed: number, amp: number): void {
    const p = this.pet;
    if (!p || !this.loadedId) return;
    const S = FLYING_PETS[this.loadedId];
    const ph = time * Math.PI * 2 * S.flap * speed;
    // 静止姿势身体是立着的，身体长轴 = 模型 Y；翅膀绕它上下扇（身体俯成水平后就是绕飞行方向扇）
    const Y = new THREE.Vector3(0, 1, 0);
    for (const [side, sgn] of [['L', 1], ['R', -1]] as const) {
      turn(p, `wing_1_${side}`, Y, sgn * (0.12 + amp * Math.sin(ph)));
      turn(p, `wing_2_${side}`, Y, sgn * amp * 0.45 * Math.sin(ph - 0.6));
      turn(p, `wing_3_${side}`, Y, sgn * amp * 0.3 * Math.sin(ph - 1.1));
    }
    const X = new THREE.Vector3(1, 0, 0);
    for (let k = 1; k <= 6; k++) turn(p, `tail_${k}`, X, 0.12 * Math.sin(time * 2 + k * 0.6));
  }

  /**
   * 灵宠的身体：俯 k × pitch 成飞行姿势，腿往回摆同样的角度（爪子朝下）；bank = 转弯侧倾，nose = 抬头（负）/ 低头；
   * face = 模型朝向角（朝向 (sin, cos)），默认就是飞行方向。
   */
  private body(k: number, bank: number, nose = 0, face = this.heading + Math.PI): void {
    const p = this.pet!, S = FLYING_PETS[this.loadedId!];
    p.root.rotation.set(S.pitch * k + nose, face, -bank, 'YXZ');
    const X = new THREE.Vector3(1, 0, 0);
    for (const l of S.legs) turn(p, l, X, -S.pitch * k * 0.9);
  }

  /**
   * 燎的姿势。arms：0 垂手（从 T 字姿势转下来），1 双手举过头；tuck：收腿（起跳 / 挂着荡）；swing：腿前后荡的幅度。
   * 胳膊的方向按模型自己的静止方向算（Mixamo 是 T 字，左臂朝 +x），不依赖骨骼的局部轴。
   */
  private poseHero(arms: number, tuck: number, swing: number, time: number): void {
    const h = this.hero;
    if (!h) return;
    for (const [side, upper, lower, hand] of [['L', 'LeftArm', 'LeftForeArm', 'LeftHand'], ['R', 'RightArm', 'RightForeArm', 'RightHand']] as const) {
      const out = Math.sign(restDir(h, upper, lower).x) || (side === 'L' ? 1 : -1);
      // 举起来是 V 字（燎头大、耳朵高，手要在头两边，爪子才不会扎进耳朵）
      const down = new THREE.Vector3(0.16 * out, -1, 0.05), up = new THREE.Vector3(0.55 * out, 1, 0.12);
      const dir = down.clone().lerp(up, ease(arms)).normalize();
      // 中间那段（举到一半）往前划个弧，不从身体里穿过去
      dir.z += Math.sin(ease(arms) * Math.PI) * 0.9;
      aim(h, upper, lower, dir.normalize());
      // 前臂保持静止的局部姿势（跟着上臂伸直）：上臂已经转到 dir，前臂再转一次就转过头了
      const fb = h.bones.get(lower), fr = h.rest.get(lower);
      if (fb && fr) fb.quaternion.copy(fr.local);
      void hand;
    }
    const X = new THREE.Vector3(1, 0, 0);
    const sw = swing * Math.sin(time * 2.4);
    turn(h, 'LeftUpLeg', X, -0.5 * tuck + sw);
    turn(h, 'RightUpLeg', X, -0.25 * tuck - sw);
    turn(h, 'LeftLeg', X, 0.9 * tuck);
    turn(h, 'RightLeg', X, 0.5 * tuck);
    // 抬头看灵宠
    turn(h, 'Head', X, -0.45 * Math.min(1, arms * 1.4));
  }

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
  private shot(subject: THREE.Vector3, f: THREE.Vector3, back: number, side: number, up: number, out: THREE.Vector3): THREE.Vector3 {
    const s = new THREE.Vector3(-f.z, 0, f.x);
    let best = -1;
    const cand = new THREE.Vector3();
    for (const sg of [this.camSide, -this.camSide]) {
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

  /** 没在飞渡：灵宠跟在玩家右前方飞（第一人称时在画面右边缘看得见） */
  private follow(eye: THREE.Vector3, yaw: number, time: number, dt: number): void {
    if (!this.pet) return;
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
    const target = eye.clone().addScaledVector(r, 1.4).addScaledVector(f, 1.3).add(new THREE.Vector3(0, -0.15 + 0.12 * Math.sin(time * 2.1), 0));
    this.pet.root.position.lerp(target, Math.min(1, dt * 7));
    this.heading = yaw;
    this.body(0.55, 0);
    this.flapWings(time, 0.9, 0.55);
    // 平时也在身后飘几颗小火星
    if (this.rand() < dt * 5) this.sparks.emit(this.pet.root.position.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(0, 0.3, 0), this.fireEdge, 0.05, 0.8);
  }

  /**
   * 返回值：演出 / 滑翔期间燎的脚应该在哪（检视页把行走者放到这里）；没在飞渡或松手往下掉时返回 null。
   * eye / lookDir 是第一人称的眼睛位置和视线（灵宠跟随、镜头拉出来的起点）。
   */
  update(time: number, inp: FlightInput, eye: THREE.Vector3, feet: THREE.Vector3): THREE.Vector3 | null {
    const dt = inp.dt;
    this.updateFx(dt, time);
    if (!this.active) {
      this.near = FLIGHT_PERCHES.find(p => Math.hypot(p.x - feet.x, p.z - feet.z) < p.r) ?? null;
      if (this.pet) this.follow(eye, inp.yaw, time, dt);
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
      // ① 起势：灵宠离开肩头，绕燎螺旋上升一圈半；镜头从眼睛弧线拉到身侧（先往后、再往旁边绕）
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
      // ③ 擒起：灵宠从前上方绕到身后、俯冲过头顶；燎起跳举手，爪子正好落到手上，人被提起来
      const D = 1.1, k = Math.min(1, this.t / D), e = ease(k);
      const jump = Math.max(0, Math.sin(Math.min(1, Math.max(0, (k - 0.45) / 0.35)) * Math.PI * 0.5));
      this.heroUp = k < 0.62 ? jump * 0.7 : 0.7 + 2.6 * ease((k - 0.62) / 0.38);
      this.pos.y = this.start0.y + this.heroUp;
      this.poseHero(Math.min(1, 0.25 + k * 1.4), jump * 0.6, 0, time);
      this.heroFacing(fwd);
      // 灵宠沿弧线：前上方 → 身后上方 → 落到手上（最后 40% 直接对齐到手）
      const behind = this.start0.clone().addScaledVector(fwd, -7).add(new THREE.Vector3(0, 7, 0));
      if (k < 0.6) {
        p.root.position.copy(bezier(this.petFrom, behind.clone().add(side.clone().multiplyScalar(6)), behind, ease(k / 0.6)));
        this.body(0.9, 0.5 * Math.sin(k / 0.6 * Math.PI));
      } else {
        this.body(1, 0, -0.35 * (1 - ease((k - 0.6) / 0.4)));
        const from = behind.clone(), target = p.root.position.clone();
        this.snapPetToHands();
        target.copy(p.root.position);
        p.root.position.lerpVectors(from, target, ease((k - 0.6) / 0.4));
        if (k > 0.95) this.snapPetToHands();
      }
      this.flapWings(time, 1.5, 0.95);
      if (k > 0.6 && this.t - dt <= D * 0.62) { this.puffDust(this.start0, 18, 5); this.burstSparks(this.hands(new THREE.Vector3()), 30, 3, 0.12, 0.6, this.fireCore, 0.4); }
      const subj = this.pos.clone().add(new THREE.Vector3(0, 1.4, 0)).lerp(p.root.position, 0.4);
      const want = this.shot(subj, fwd, 6 + 0.6 * p.root.position.distanceTo(this.pos), 3.5, 0.8, new THREE.Vector3());
      this.cam.lerpVectors(this.camFrom, want, e);
      this.keepCamAbove();
      this.look.lerpVectors(this.lookFrom, subj.clone().addScaledVector(fwd, 3 * e), e);
      this.heroVisibility();
      if (k >= 1) {
        this.phase = 'glide'; this.t = 0;
        this.vel.copy(fwd).multiplyScalar(S.speed * 0.75).add(new THREE.Vector3(0, 3.2, 0));
        for (const t of this.trails) t.reset();
      }
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
      this.poseHero(1, 0.35, 0.3 + 0.2 * Math.min(1, this.speed / 18), time);
      this.placeHero(0.1, this.t);
      this.body(1, this.bank * 0.6);
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
      // ⑤ 落地：前 0.6 s 灵宠猛扇翅膀刹住、把人放到地上（扬尘），再 1.6 s 飞起来缩回原样、回到肩头；镜头弧线回到眼睛
      const D1 = 0.6, D2 = 1.6;
      const f = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
      const g = this.ground(this.pos.x, this.pos.z, this.pos.y + 0.5);
      if (this.t < D1) {
        const k = this.t / D1;
        const v = Math.max(0, 1 - k) * this.speed * 0.5;
        this.pos.addScaledVector(f, v * dt);
        this.pos.y = Math.max(g, this.pos.y - (this.pos.y - g) * Math.min(1, dt * 8));
        this.poseHero(1, 0.35 * (1 - k), 0.1, time);
        this.placeHero(0.1 * (1 - k), 0);
        this.body(1 - 0.6 * k, 0, -0.5 * k);
        this.flapWings(time, 2.2, 1.0);
        this.snapPetToHands();
        if (this.t + dt >= D1) { this.pos.y = g; this.puffDust(this.pos, 30, 6); this.shockRing(this.pos); this.petFrom.copy(p.root.position); }
      } else {
        const k = Math.min(1, (this.t - D1) / D2), e = ease(k);
        this.pos.y = g;
        this.poseHero(Math.max(0, 1 - k * 2.5), 0, 0, time);
        this.placeHero(0, 0);
        // 灵宠先往上飞开，再缩小绕回肩头；缩小那一下洒一圈光点
        const eyeNow = this.pos.clone().add(new THREE.Vector3(0, EYE, 0));
        const shoulder = eyeNow.clone().addScaledVector(new THREE.Vector3(-f.z, 0, f.x), 1.4).addScaledVector(f, 1.3).add(new THREE.Vector3(0, -0.15, 0));
        const upHigh = this.petFrom.clone().add(new THREE.Vector3(0, 5, 0)).addScaledVector(f, 3);
        p.root.position.copy(bezier(this.petFrom, upHigh, shoulder, e));
        this.setScale(big + (small - big) * ease(k * 1.5));
        if (k > 0.3 && k - dt / D2 <= 0.3) this.burstSparks(p.root.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 60, 3.5, 0.14, 0.9, this.fireCore, 0.4);
        this.body(0.55, 0);
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
    if (this.pet && this.loadedId) this.setScale(FLYING_PETS[this.loadedId].carryHeight / this.pet.height);
  }
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
