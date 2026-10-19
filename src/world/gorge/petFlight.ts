/**
 * 4-2 彩蛋 · 灵宠飞渡（docs/level-design/chuanzang-v1.md 3.8）：
 * 带着会飞的灵宠（精卫、重明鸟、应龙）走到峡谷里的三处高台，按 F：灵宠飞起来变大、俯冲下来，
 * 燎双手抓住它的爪子被带离地面，镜头切到第三人称，在峡谷上空滑翔；落地（或空格松手）后灵宠缩回原样，回到第一人称。
 * 模型用美术管线发布的骨骼模型（public/assets/characters/SK_Pet_*.glb、SK_Hero_Fox.glb），动作全部程序化：
 * 扇翅膀 = 翅膀骨骼绕身体前后轴转，抓爪 = 燎的上臂转到头顶。灵宠系统本身在 Unity（docs/pet-system.md），网页这里只做演出。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FLIGHT_PERCHES, MAP, type FlightPerch } from './spec';

export type FlyingPetId = 'jingwei' | 'chongming' | 'yinglong';

/** 三只会飞的灵宠：模型、平时大小（随身）、飞渡时变大到多高、抓哪两根爪子骨骼、滑翔手感 */
export const FLYING_PETS: Record<FlyingPetId, {
  name: string; url: string; carryHeight: number; rideHeight: number; grip: [string, string];
  speed: number; sink: number; flap: number;
  /** 模型静止时身体是立着的（站姿），飞的时候整个往前俯 pitch 弧度成水平；腿再往回摆，爪子朝下 */
  pitch: number; legs: string[];
}> = {
  jingwei: { name: '精卫', url: 'assets/characters/SK_Pet_Jingwei.glb', carryHeight: 0.75, rideHeight: 3.6, grip: ['talon_L', 'talon_R'], speed: 13, sink: 1.9, flap: 1.25, pitch: 1.15, legs: ['thigh_L', 'thigh_R'] },
  chongming: { name: '重明鸟', url: 'assets/characters/SK_Pet_Chongming.glb', carryHeight: 1.1, rideHeight: 4.2, grip: ['talon_L', 'talon_R'], speed: 14, sink: 1.6, flap: 1.0, pitch: 1.15, legs: ['thigh_L', 'thigh_R'] },
  yinglong: { name: '应龙', url: 'assets/characters/SK_Pet_Yinglong.glb', carryHeight: 1.4, rideHeight: 4.6, grip: ['claw_L', 'claw_R'], speed: 16.5, sink: 1.1, flap: 0.8, pitch: 0.6, legs: ['upperarm_L', 'upperarm_R', 'thigh_L', 'thigh_R'] },
};

const HERO_URL = 'assets/characters/SK_Hero_Fox.glb';
const HERO_HEIGHT = 1.78;

interface Posable {
  root: THREE.Group;
  bones: Map<string, THREE.Bone>;
  /** 每根骨骼的静止局部旋转、在模型根坐标系里的静止旋转 */
  rest: Map<string, { local: THREE.Quaternion; rel: THREE.Quaternion }>;
  /** 模型原始高度（米，缩放前） */
  height: number;
}

const loader = (() => {
  const draco = new DRACOLoader();
  return new GLTFLoader().setDRACOLoader(draco);
})();
const cache = new Map<string, Promise<Posable | null>>();

/** 读一个骨骼模型，只留最高一级 LOD；记下静止姿势（程序化动作都在静止姿势上叠加） */
function loadPosable(url: string): Promise<Posable | null> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}${url}`).then(gltf => {
      const root = new THREE.Group();
      const scene = gltf.scene;
      scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const lod = /_LOD(\d+)$/.exec(m.name);
        m.visible = !lod || lod[1] === '0';
        m.castShadow = true; m.receiveShadow = true;
        m.frustumCulled = false;
      });
      root.add(scene);
      root.updateMatrixWorld(true);
      const bones = new Map<string, THREE.Bone>();
      scene.traverse(o => { if ((o as THREE.Bone).isBone) bones.set(o.name.replace(/^mixamorig:/, ''), o as THREE.Bone); });
      const inv = new THREE.Quaternion().copy(root.getWorldQuaternion(new THREE.Quaternion())).invert();
      const rest = new Map<string, { local: THREE.Quaternion; rel: THREE.Quaternion }>();
      for (const [name, b] of bones) rest.set(name, { local: b.quaternion.clone(), rel: inv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion())) });
      const box = new THREE.Box3().setFromObject(scene);
      return { root, bones, rest, height: Math.max(0.1, box.max.y - box.min.y) };
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

/** 把上臂从静止方向转到 dir（模型根坐标系） */
function aim(p: Posable, upper: string, lower: string, dir: THREE.Vector3, k: number): void {
  const b = p.bones.get(upper), c = p.bones.get(lower), r = p.rest.get(upper);
  if (!b || !c || !r) return;
  // 静止方向：上臂 → 前臂（根坐标系）
  const rest = (b.userData.restDir as THREE.Vector3 | undefined) ?? (() => {
    const inv = new THREE.Matrix4().copy(p.root.matrixWorld).invert();
    const pa = b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv), pb = c.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    return (b.userData.restDir = pb.sub(pa).normalize());
  })();
  _q.setFromUnitVectors(rest, _v.copy(dir).normalize());
  const ang = 2 * Math.acos(Math.min(1, Math.abs(_q.w))) * k;
  _a.set(_q.x, _q.y, _q.z);
  if (_a.lengthSq() < 1e-8) { b.quaternion.copy(r.local); return; }
  turn(p, upper, _a.normalize().multiplyScalar(Math.sign(_q.w) || 1), ang);
}

type Phase = 'idle' | 'summon' | 'swoop' | 'glide' | 'land' | 'drop';

/** yaw：想飞的方向（鼠标和 A / D 都改它，检视页里就是第一人称的朝向） */
export interface FlightInput { forward: number; right: number; yaw: number; release: boolean; dt: number }

export class PetFlight {
  readonly group = new THREE.Group();
  petId: FlyingPetId | null = 'chongming';
  phase: Phase = 'idle';
  /** 第三人称镜头（飞渡期间每帧更新） */
  readonly cam = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  /** 当前滑翔速度、离地高度（HUD） */
  speed = 0;
  agl = 0;
  /** 高台提示：玩家站在哪个起飞台旁边 */
  near: FlightPerch | null = null;
  private pet: Posable | null = null;
  private loadedId: FlyingPetId | null = null;
  private hero: Posable | null = null;
  private t = 0;
  private scale = 1;
  private readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private heading = 0;
  private bank = 0;
  private readonly burst: THREE.Mesh;
  private readonly from = new THREE.Vector3();
  private readonly camFrom = new THREE.Vector3();
  private handsOffset = new THREE.Vector3(0, 2.05, 0);

  constructor(
    /** 脚下的地面（地形或桥面、屋顶）：y 以下最高的可站立面 */
    private readonly ground: (x: number, z: number, y: number) => number,
    private readonly bound: (x: number, z: number) => number,
    private readonly wind: () => number,
  ) {
    this.group.name = 'pet-flight';
    // 变大时的灵火光圈（青金色）
    this.burst = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({
      color: '#8ff0ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.group.add(this.burst);
    void loadPosable(HERO_URL).then(h => {
      if (!h) return;
      this.hero = h;
      const s = HERO_HEIGHT / h.height;
      h.root.scale.setScalar(s);
      h.root.visible = false;
      this.group.add(h.root);
      // 双手举过头抓爪：算一次手在模型根坐标系里的高度，挂在爪子下面时用
      this.poseHero(1, 0);
      h.root.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(h.root.matrixWorld).invert();
      const l = h.bones.get('LeftHand'), r = h.bones.get('RightHand');
      if (l && r) this.handsOffset = l.getWorldPosition(new THREE.Vector3()).add(r.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5).applyMatrix4(inv).multiplyScalar(s);
      this.poseHero(0, 0);
    });
  }

  get active(): boolean { return this.phase !== 'idle'; }
  get thirdPerson(): boolean { return this.phase === 'summon' || this.phase === 'swoop' || this.phase === 'glide' || this.phase === 'land'; }
  get petName(): string { return this.petId ? FLYING_PETS[this.petId].name : '无'; }

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
    });
  }

  private setScale(s: number): void { this.scale = s; if (this.pet) this.pet.root.scale.setScalar(s); }

  /** 站在起飞台旁边、有会飞的灵宠、在地上：可以起飞 */
  canStart(feet: THREE.Vector3, grounded: boolean): FlightPerch | null {
    if (this.active || !this.pet || !grounded) return null;
    return FLIGHT_PERCHES.find(p => Math.hypot(p.x - feet.x, p.z - feet.z) < p.r) ?? null;
  }

  /** 开始飞渡：yaw = 玩家当前朝向（灵宠朝这个方向飞出去） */
  start(feet: THREE.Vector3, yaw: number, eye: THREE.Vector3): boolean {
    if (!this.pet || !this.loadedId) return false;
    this.phase = 'summon';
    this.t = 0;
    this.heading = yaw;
    this.pos.copy(feet);
    this.from.copy(this.pet.root.position);
    this.camFrom.copy(eye);
    this.cam.copy(eye);
    if (this.hero) this.hero.root.visible = true;
    return true;
  }

  /** 跟在玩家肩后上方飞（没在飞渡时） */
  private follow(eye: THREE.Vector3, yaw: number, time: number): void {
    if (!this.pet) return;
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
    // 右前方、略低于视线：第一人称时在画面右边缘看得见
    const target = eye.clone().addScaledVector(r, 1.4).addScaledVector(f, 1.3).add(new THREE.Vector3(0, -0.15 + 0.12 * Math.sin(time * 2.1), 0));
    this.pet.root.position.lerp(target, 0.12);
    this.heading = yaw;
    this.body(0.55, 0);
    this.flapWings(time, 0.9, 0.55);
  }

  private flapWings(time: number, speed: number, amp: number): void {
    const p = this.pet;
    if (!p || !this.loadedId) return;
    const S = FLYING_PETS[this.loadedId];
    const w = Math.sin(time * Math.PI * 2 * S.flap * speed);
    // 静止姿势身体是立着的，身体长轴 = 模型 Y；翅膀绕它上下扇（身体俯成水平后就是绕飞行方向扇）
    const Y = new THREE.Vector3(0, 1, 0);
    for (const [side, sgn] of [['L', 1], ['R', -1]] as const) {
      turn(p, `wing_1_${side}`, Y, sgn * (0.12 + amp * w));
      turn(p, `wing_2_${side}`, Y, sgn * amp * 0.45 * Math.sin(time * Math.PI * 2 * S.flap * speed - 0.6));
      turn(p, `wing_3_${side}`, Y, sgn * amp * 0.3 * Math.sin(time * Math.PI * 2 * S.flap * speed - 1.1));
    }
    const X = new THREE.Vector3(1, 0, 0);
    for (let k = 1; k <= 6; k++) turn(p, `tail_${k}`, X, 0.12 * Math.sin(time * 2 + k * 0.6));
  }

  /** 灵宠的身体：俯 k × pitch 成飞行姿势，腿往回摆同样的角度（爪子朝下）；bank = 转弯侧倾 */
  private body(k: number, bank: number): void {
    const p = this.pet!, S = FLYING_PETS[this.loadedId!];
    p.root.rotation.set(S.pitch * k, this.heading + Math.PI, -bank, 'YXZ');
    const X = new THREE.Vector3(1, 0, 0);
    for (const l of S.legs) turn(p, l, X, -S.pitch * k * 0.9);
  }

  /** 燎的姿势：k = 0 垂手，1 双手举过头抓爪；swing = 腿荡的幅度 */
  private poseHero(k: number, swing: number, time = 0): void {
    const h = this.hero;
    if (!h) return;
    aim(h, 'LeftArm', 'LeftForeArm', new THREE.Vector3(0.22, 1, 0.06), k);
    aim(h, 'RightArm', 'RightForeArm', new THREE.Vector3(-0.22, 1, 0.06), k);
    const X = new THREE.Vector3(1, 0, 0);
    turn(h, 'LeftUpLeg', X, swing * Math.sin(time * 2.2) - 0.15 * k);
    turn(h, 'RightUpLeg', X, -swing * Math.sin(time * 2.2) - 0.1 * k);
    turn(h, 'LeftLeg', X, 0.35 * k);
    turn(h, 'RightLeg', X, 0.2 * k);
  }

  /** 爪子中点（世界坐标） */
  private grip(out: THREE.Vector3): THREE.Vector3 {
    const p = this.pet!, S = FLYING_PETS[this.loadedId!];
    p.root.updateMatrixWorld(true);
    const a = p.bones.get(S.grip[0]), b = p.bones.get(S.grip[1]);
    if (!a || !b) return out.copy(p.root.position);
    return a.getWorldPosition(out).add(b.getWorldPosition(_v)).multiplyScalar(0.5);
  }

  /**
   * 每帧。返回值：飞渡期间玩家脚下的位置（检视页把行走者放到这里）；不在飞渡时返回 null。
   * eye / yaw 是第一人称的眼睛位置和朝向（灵宠跟随、起飞时镜头的起点）。
   */
  update(time: number, inp: FlightInput, eye: THREE.Vector3, feet: THREE.Vector3): THREE.Vector3 | null {
    const dt = inp.dt;
    this.burst.visible = false;
    if (!this.active) {
      this.near = this.canStart(feet, true) ? FLIGHT_PERCHES.find(p => Math.hypot(p.x - feet.x, p.z - feet.z) < p.r) ?? null : null;
      if (this.pet) this.follow(eye, inp.yaw, time);
      return null;
    }
    const p = this.pet!, S = FLYING_PETS[this.loadedId!];
    const big = S.rideHeight / p.height, small = S.carryHeight / p.height;
    this.t += dt;
    const fwd = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    if (this.phase === 'summon') {
      // 1.8 秒：飞到玩家前上方，灵火一闪变大
      const k = Math.min(1, this.t / 1.8), e = k * k * (3 - 2 * k);
      const hover = this.pos.clone().addScaledVector(fwd, 9).add(new THREE.Vector3(0, 7, 0));
      p.root.position.lerpVectors(this.from, hover, e);
      this.body(0.55 + 0.45 * e, 0);
      this.setScale(small + (big - small) * e);
      this.burst.visible = true;
      this.burst.position.copy(p.root.position).add(new THREE.Vector3(0, S.rideHeight * 0.5 * e, 0));
      this.burst.scale.setScalar(1 + 7 * Math.sin(k * Math.PI));
      (this.burst.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.sin(k * Math.PI);
      this.flapWings(time, 1.3, 0.75);
      this.poseHero(e * 0.4, 0);
      this.thirdPersonCam(this.pos.clone().add(new THREE.Vector3(0, 1, 0)), fwd, e, 9, 4);
      if (k >= 1) { this.phase = 'swoop'; this.t = 0; this.from.copy(p.root.position); }
      return this.pos.clone();
    }
    if (this.phase === 'swoop') {
      // 0.9 秒：俯冲下来，爪子落到燎举起的手上，把人带离地面
      const k = Math.min(1, this.t / 0.9), e = k * k * (3 - 2 * k);
      this.poseHero(0.4 + 0.6 * e, 0);
      // 抓住之后（后 40%）把人往上提 2.5 m，离开地面
      if (k > 0.6) this.pos.y = this.ground(this.pos.x, this.pos.z, this.pos.y + 3) + 2.5 * ((k - 0.6) / 0.4);
      const handWorld = this.pos.clone().add(this.handsOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading + Math.PI));
      const gripNow = this.grip(new THREE.Vector3());
      const targetRoot = p.root.position.clone().add(handWorld.clone().sub(gripNow));
      p.root.position.lerpVectors(this.from, targetRoot, e);
      this.body(1, 0);
      this.flapWings(time, 1.6, 0.9);
      this.thirdPersonCam(this.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), fwd, 1, 11, 4.5);
      if (k >= 1) {
        this.phase = 'glide'; this.t = 0;
        this.vel.copy(fwd).multiplyScalar(S.speed * 0.8).add(new THREE.Vector3(0, 3.5, 0));
      }
      return this.pos.clone();
    }
    if (this.phase === 'glide') {
      // 滑翔：鼠标 / A D 转向，W 俯冲加速，S 拉平减速；峡谷阵风往上托；出界时风把人吹回峡谷
      const turnRate = 1.1;
      let dYaw = Math.atan2(Math.sin(inp.yaw - this.heading), Math.cos(inp.yaw - this.heading));
      dYaw = THREE.MathUtils.clamp(dYaw, -turnRate * dt, turnRate * dt);
      if (this.bound(this.pos.x, this.pos.z) > MAP.softBoundary) {
        // 朝峡谷中心（汇口）转回来
        const back = Math.atan2(-(-8 - this.pos.x), -(-18 - this.pos.z));
        dYaw += THREE.MathUtils.clamp(Math.atan2(Math.sin(back - this.heading), Math.cos(back - this.heading)), -1.5 * dt, 1.5 * dt);
      }
      this.heading += dYaw;
      this.bank += ((dYaw / Math.max(dt, 1e-4)) * 0.45 - this.bank) * Math.min(1, dt * 3);
      const target = S.speed * (1 + 0.35 * Math.max(0, inp.forward) - 0.3 * Math.max(0, -inp.forward));
      const sink = S.sink + 2.6 * Math.max(0, inp.forward) - 1.0 * Math.max(0, -inp.forward) - 3.2 * this.wind();
      const f = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
      const hv = Math.hypot(this.vel.x, this.vel.z) + (target - Math.hypot(this.vel.x, this.vel.z)) * Math.min(1, dt * 0.8);
      this.vel.set(f.x * hv, this.vel.y + (-sink - this.vel.y) * Math.min(1, dt * 1.5), f.z * hv);
      this.pos.addScaledVector(this.vel, dt);
      this.speed = this.vel.length();
      const g = this.ground(this.pos.x, this.pos.z, this.pos.y);
      this.agl = this.pos.y - g;
      // 起飞后 1.2 秒内不算落地（还贴着起飞台）
      if (this.t > 1.2 && this.agl < 0.6) { this.pos.y = g; this.phase = 'land'; this.t = 0; this.from.copy(p.root.position); }
      else if (this.agl < 0.3) this.pos.y = g + 0.3;
      this.attachPet(fwd.copy(f), time);
      if (inp.release) { this.phase = 'drop'; this.t = 0; this.from.copy(p.root.position); }
      this.thirdPersonCam(this.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), f, 1, 9, 1.5);
      return this.pos.clone();
    }
    if (this.phase === 'land') {
      // 1.2 秒：放下人，灵宠飞起来缩回原样，镜头回到第一人称
      const k = Math.min(1, this.t / 1.2), e = k * k * (3 - 2 * k);
      this.poseHero(1 - e, 0);
      p.root.position.copy(this.from).add(new THREE.Vector3(0, 3 * e, 0));
      this.body(1 - 0.45 * e, 0);
      this.setScale(big + (small - big) * e);
      this.flapWings(time, 1.4, 0.8);
      const eyeNow = this.pos.clone().add(new THREE.Vector3(0, 1.62, 0));
      this.cam.lerp(eyeNow, e * 0.5 + 0.1);
      this.look.copy(eyeNow).add(fwd.clone().multiplyScalar(10));
      if (k >= 1) this.finish();
      return this.pos.clone();
    }
    // drop：空中松手，人自己掉下去（检视页交还给行走），灵宠缩回原样
    const k = Math.min(1, this.t / 1.0);
    this.setScale(big + (small - big) * k);
    p.root.position.copy(this.from).add(new THREE.Vector3(0, 2 * k, 0));
    this.flapWings(time, 1.4, 0.8);
    if (k >= 1) this.finish();
    return null;
  }

  /** 灵宠挂在玩家头顶：爪子正好在燎举起的双手上；身体随转弯侧倾 */
  private attachPet(f: THREE.Vector3, time: number): void {
    const p = this.pet!, h = this.hero;
    this.body(1, this.bank * 0.6);
    this.flapWings(time, 0.65 + 0.4 * Math.min(1, this.speed / 20), 0.55);
    if (h) {
      h.root.position.copy(this.pos);
      h.root.rotation.set(Math.sin(time * 1.3) * 0.08, this.heading + Math.PI, -this.bank * 0.3, 'YXZ');
      this.poseHero(1, 0.35, time);
    }
    const hands = this.pos.clone().add(this.handsOffset.clone().applyEuler(h?.root.rotation ?? new THREE.Euler()));
    const gripNow = this.grip(new THREE.Vector3());
    p.root.position.add(hands.sub(gripNow));
  }

  /** 第三人称：在身后偏右、比燎略高一点的地方看着他（灵宠在他头顶，人和灵宠都在画面里） */
  private thirdPersonCam(subject: THREE.Vector3, f: THREE.Vector3, blend: number, back: number, up: number): void {
    const side = new THREE.Vector3(-f.z, 0, f.x);
    const want = subject.clone().addScaledVector(f, -back).addScaledVector(side, back * 0.32).add(new THREE.Vector3(0, up, 0));
    const g = this.ground(want.x, want.z, want.y + 50) + 1.5;
    if (want.y < g) want.y = g;
    this.cam.lerp(this.camFrom.clone().lerp(want, blend), 0.15);
    this.look.copy(subject).addScaledVector(f, 7).add(new THREE.Vector3(0, 1.2, 0));
    if (this.hero && this.phase !== 'glide') { this.hero.root.position.copy(this.pos); this.hero.root.rotation.set(0, this.heading + Math.PI, 0); }
  }

  private finish(): void {
    this.phase = 'idle';
    if (this.hero) this.hero.root.visible = false;
    this.speed = 0; this.agl = 0;
    if (this.pet && this.loadedId) this.setScale(FLYING_PETS[this.loadedId].carryHeight / this.pet.height);
  }
}
