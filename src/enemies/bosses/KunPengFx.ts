/**
 * 鲲鹏的场景特效（每个首领实例一份，挂 ctx.stageGroup，首领释放时整体移除并释放）：
 *  - 北冥冰窟：深色海水圆面（涟漪 + 越靠近冰沿越浅）、冰沿一圈浮冰与斜插的碎冰、从水面升起的寒雾；
 *    setAgitation(k) 让水面翻涌（鲲出水、吞吸、化鹏时）。
 *  - 冰雾爆闪：冰窟上方的半球形浓雾，flash(k) 控制浓度；化鹏时用它遮住换模型。
 *  - 吞吸气流：一串冰屑沿螺旋被吸向鲲口（实例化网格，一次绘制）。
 *  - 狂风：贴地的白色风痕从冰窟向外飞掠（实例化网格）。
 *  - 羽刃：鹏洒下的冰羽刃，从翼尖飞向落点，落地回调（伤害由首领结算）。
 * 所有网格常驻场景、不用时透明度为 0：着色器在登场时就编译好，第一次化鹏不卡顿。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import type { IceHole } from './KunPengArena';

const TAU = Math.PI * 2;
const MAX_SUCK = 40;
const MAX_STREAK = 32;
const MAX_FLOE = 26;
export const MAX_FEATHERS = 18;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

const WATER_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform float uAgit;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uGlow;
varying vec2 vP;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float r = length(vP) / uRadius;
  float n = noise(vP * 0.35 + uTime * 0.15) * 0.6 + noise(vP * 1.1 - uTime * 0.3) * 0.4;
  float ripple = sin(length(vP) * (2.2 + uAgit * 1.5) - uTime * (1.5 + uAgit * 5.0) + n * 3.0);
  vec3 col = mix(uDeep, uShallow, smoothstep(0.35, 1.0, r) * 0.85 + n * 0.12);
  col += uGlow * (0.06 + 0.22 * uAgit) * smoothstep(0.55, 1.0, ripple * 0.5 + 0.5) * (1.0 - r * 0.5);
  // 冰沿内侧一圈碎冰泡沫
  float foam = smoothstep(0.86, 0.99, r) * (0.55 + 0.45 * n);
  col = mix(col, vec3(0.86, 0.94, 1.0), foam * 0.7);
  gl_FragColor = vec4(col, 1.0);
}
`;
const MIST_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const MIST_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAmount;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float n = noise(vec2(vUv.x * 24.0 + uTime * 0.2, vUv.y * 3.0 - uTime * 0.45));
  float a = pow(1.0 - vUv.y, 1.6) * (0.35 + 0.65 * n) * uAmount;
  gl_FragColor = vec4(uColor, a);
}
`;
const DOME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAmount;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float n = noise(vW.xz * 0.12 + vec2(uTime * 0.3, -uTime * 0.2)) * 0.6 + noise(vW.xy * 0.3 + uTime * 0.5) * 0.4;
  float a = uAmount * (0.78 + 0.3 * n);
  gl_FragColor = vec4(uColor * (0.92 + 0.12 * n), clamp(a, 0.0, 1.0));
}
`;

interface Feather {
  live: boolean;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  spin: number;
  onLand: ((p: THREE.Vector3) => void) | null;
}

export class KunPengFx {
  readonly group = new THREE.Group();
  private readonly water: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  private readonly mist: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly floes: THREE.InstancedMesh;
  private readonly shards: THREE.Mesh[] = [];
  private readonly suck: THREE.InstancedMesh;
  private readonly streaks: THREE.InstancedMesh;
  private readonly feathers: THREE.InstancedMesh;
  private readonly feather: Feather[] = [];
  private readonly floeSeeds: { a: number; r: number; s: number; ph: number; yaw: number }[] = [];
  private readonly suckSeeds: { u: number; a: number; r: number }[] = [];
  private readonly streakSeeds: { a: number; r: number; h: number; v: number }[] = [];
  private readonly owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  private time = 0;
  private agit = 0;
  private agitTarget = 0;
  private flashLevel = 0;
  private suckLevel = 0;
  private suckOn = false;
  private readonly mouth = new THREE.Vector3();
  private suckYaw = 0;
  private gustLevel = 0;
  private gustOn = false;
  private gustInner = 0;
  private gustOuter = 1;
  private readonly gustCenter = new THREE.Vector3();

  constructor(private readonly ctx: GameContext, private readonly hole: IceHole) {
    const R = hole.radius;
    const c = hole.center;
    this.group.name = 'kunpeng_fx';
    this.group.position.set(c.x, c.y, c.z);

    // 海水（略低于地面，冰沿一圈碎冰盖住接缝）
    const wGeo = new THREE.CircleGeometry(R, 64);
    const wMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      uniforms: {
        uTime: { value: 0 }, uRadius: { value: R }, uAgit: { value: 0 },
        uDeep: { value: new THREE.Color(0x041526) }, uShallow: { value: new THREE.Color(0x1d5a7e) }, uGlow: { value: new THREE.Color(0x7fe8ff) },
      },
    });
    this.water = new THREE.Mesh(wGeo, wMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0.06;
    this.water.receiveShadow = false;
    this.group.add(this.water);

    // 寒雾：开口圆筒，越高越淡
    const mGeo = new THREE.CylinderGeometry(R * 0.97, R, 6, 48, 1, true);
    mGeo.translate(0, 3, 0);
    const mMat = new THREE.ShaderMaterial({
      vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0.5 }, uColor: { value: new THREE.Color(0xd8f2ff) } },
    });
    this.mist = new THREE.Mesh(mGeo, mMat);
    this.mist.renderOrder = 3;
    this.group.add(this.mist);

    // 冰雾爆闪：半球浓雾（双面：站在里面的玩家同样被白雾遮住）
    const dGeo = new THREE.SphereGeometry(R * 1.3, 32, 14, 0, TAU, 0, Math.PI / 2);
    const dMat = new THREE.ShaderMaterial({
      vertexShader: MIST_VERT, fragmentShader: DOME_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uColor: { value: new THREE.Color(0xeaf8ff) } },
    });
    this.dome = new THREE.Mesh(dGeo, dMat);
    this.dome.renderOrder = 6;
    this.group.add(this.dome);

    // 浮冰
    const fGeo = new THREE.CylinderGeometry(1, 1.1, 0.35, 6);
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xdff2ff, emissive: 0x2a6ea8, emissiveIntensity: 0.25, roughness: 0.3, flatShading: true });
    this.floes = new THREE.InstancedMesh(fGeo, iceMat, MAX_FLOE);
    this.floes.frustumCulled = false;
    for (let i = 0; i < MAX_FLOE; i++) {
      this.floeSeeds.push({ a: (i / MAX_FLOE) * TAU + Math.random() * 0.2, r: R * (0.72 + Math.random() * 0.24), s: 0.7 + Math.random() * 1.1, ph: Math.random() * TAU, yaw: Math.random() * TAU });
    }
    this.group.add(this.floes);
    // 冰沿碎冰：斜插在冰沿上、向外倾的冰棱
    const sGeo = new THREE.ConeGeometry(0.45, 1, 5);
    sGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU + Math.random() * 0.15;
      const sh = new THREE.Mesh(sGeo, iceMat);
      const h = 0.7 + Math.random() * 1.6;
      sh.position.set(Math.sin(a) * (R + 0.15), -0.1, Math.cos(a) * (R + 0.15));
      sh.scale.set(0.8 + Math.random() * 0.6, h, 0.8 + Math.random() * 0.6);
      sh.rotation.set(Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45, 'XYZ');
      sh.castShadow = false;
      this.shards.push(sh);
      this.group.add(sh);
    }

    // 吞吸冰屑
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xdff8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const chip = new THREE.OctahedronGeometry(0.22, 0);
    this.suck = new THREE.InstancedMesh(chip, glowMat, MAX_SUCK);
    this.suck.frustumCulled = false;
    for (let i = 0; i < MAX_SUCK; i++) this.suckSeeds.push({ u: Math.random(), a: (Math.random() - 0.5) * 1.3, r: Math.random() });
    this.ctx.stageGroup.add(this.suck);

    // 风痕
    const streakGeo = new THREE.BoxGeometry(0.07, 0.07, 3.2);
    const streakMat = new THREE.MeshBasicMaterial({ color: 0xf0fbff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.streaks = new THREE.InstancedMesh(streakGeo, streakMat, MAX_STREAK);
    this.streaks.frustumCulled = false;
    for (let i = 0; i < MAX_STREAK; i++) this.streakSeeds.push({ a: Math.random() * TAU, r: Math.random(), h: 0.3 + Math.random() * 3.5, v: 18 + Math.random() * 10 });
    this.ctx.stageGroup.add(this.streaks);

    // 羽刃
    const fbGeo = new THREE.OctahedronGeometry(1, 0);
    fbGeo.scale(0.22, 0.05, 1.1);
    const fbMat = new THREE.MeshStandardMaterial({ color: 0xe8f7ff, emissive: 0x5ad0ff, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.1, flatShading: true });
    this.feathers = new THREE.InstancedMesh(fbGeo, fbMat, MAX_FEATHERS);
    this.feathers.frustumCulled = false;
    for (let i = 0; i < MAX_FEATHERS; i++) {
      this.feather.push({ live: false, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 1, spin: 0, onLand: null });
      this.feathers.setMatrixAt(i, ZERO);
    }
    this.ctx.stageGroup.add(this.feathers);

    this.owned.push(wGeo, wMat, mGeo, mMat, dGeo, dMat, fGeo, iceMat, sGeo, glowMat, chip, streakGeo, streakMat, fbGeo, fbMat);
    this.ctx.stageGroup.add(this.group);
    this.update(0);
  }

  /** 水面翻涌程度 0..1（平滑过渡） */
  setAgitation(k: number): void {
    this.agitTarget = k;
  }

  /** 冰雾爆闪浓度 0..1（立即生效，由首领逐帧驱动） */
  flash(k: number): void {
    this.flashLevel = Math.max(0, Math.min(1, k));
  }

  /** 吞吸气流：冰屑从 yaw 方向的扇形里被吸向 mouth */
  suction(on: boolean, mouth?: THREE.Vector3, yaw = 0): void {
    this.suckOn = on;
    if (mouth) this.mouth.copy(mouth);
    this.suckYaw = yaw;
  }

  /** 狂风：从 center 向外，贴地风痕在 [inner, outer] 半径之间掠过 */
  gust(on: boolean, center?: THREE.Vector3, inner = 0, outer = 1): void {
    this.gustOn = on;
    if (center) this.gustCenter.copy(center);
    this.gustInner = inner;
    this.gustOuter = outer;
  }

  /** 发射一枚羽刃：dur 秒后落在 to，回调结算伤害。槽位用完时返回 false */
  launchFeather(from: THREE.Vector3, to: THREE.Vector3, dur: number, onLand: (p: THREE.Vector3) => void): boolean {
    const f = this.feather.find((x) => !x.live);
    if (!f) return false;
    f.live = true;
    f.from.copy(from);
    f.to.copy(to);
    f.t = 0;
    f.dur = Math.max(0.2, dur);
    f.spin = Math.random() * TAU;
    f.onLand = onLand;
    return true;
  }

  /** 收回所有在空中的羽刃（不结算） */
  clearFeathers(): void {
    for (let i = 0; i < this.feather.length; i++) {
      this.feather[i].live = false;
      this.feather[i].onLand = null;
      this.feathers.setMatrixAt(i, ZERO);
    }
    this.feathers.instanceMatrix.needsUpdate = true;
  }

  activeFeathers(): number {
    let n = 0;
    for (const f of this.feather) if (f.live) n++;
    return n;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.agit += (this.agitTarget - this.agit) * Math.min(1, dt * 2.5);
    const wu = this.water.material.uniforms;
    wu.uTime.value = t;
    wu.uAgit.value = this.agit;
    const mu = this.mist.material.uniforms;
    mu.uTime.value = t;
    mu.uAmount.value = 0.45 + 0.4 * this.agit + 0.3 * this.flashLevel;
    const du = this.dome.material.uniforms;
    du.uTime.value = t;
    du.uAmount.value = this.flashLevel;
    this.dome.visible = true;
    this.dome.scale.setScalar(0.85 + 0.15 * this.flashLevel);

    // 浮冰：随水面起伏，翻涌时颠簸、被推向冰沿
    for (let i = 0; i < MAX_FLOE; i++) {
      const s = this.floeSeeds[i];
      const bob = Math.sin(t * (0.8 + this.agit * 3) + s.ph) * (0.05 + 0.25 * this.agit);
      const rr = s.r + this.agit * 0.6 * Math.sin(t * 2 + s.ph);
      _p.set(Math.sin(s.a) * rr, 0.08 + bob, Math.cos(s.a) * rr);
      _e.set(Math.sin(t * 1.3 + s.ph) * 0.12 * (0.3 + this.agit), s.yaw + t * 0.05, Math.cos(t * 1.1 + s.ph) * 0.12 * (0.3 + this.agit));
      _q.setFromEuler(_e);
      _s.set(s.s, 1, s.s * 0.8);
      this.floes.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.floes.instanceMatrix.needsUpdate = true;

    this.updateSuck(dt);
    this.updateGust(dt);
    this.updateFeathers(dt);
  }

  private updateSuck(dt: number): void {
    this.suckLevel += ((this.suckOn ? 1 : 0) - this.suckLevel) * Math.min(1, dt * 4);
    const lvl = this.suckLevel;
    const mat = this.suck.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.9 * lvl;
    for (let i = 0; i < MAX_SUCK; i++) {
      const s = this.suckSeeds[i];
      if (lvl < 0.01) {
        this.suck.setMatrixAt(i, ZERO);
        continue;
      }
      s.u -= dt * (0.55 + s.r * 0.4);
      if (s.u <= 0) {
        s.u += 1;
        s.a = (Math.random() - 0.5) * 1.3;
        s.r = Math.random();
      }
      // u = 1 在扇形远端（约 22 米），u = 0 到达口部；越近转得越快
      const dist = 2 + s.u * 20;
      const swirl = s.a * s.u + (1 - s.u) * 2.4 * Math.sin(this.time * 3 + s.r * 6);
      const a = this.suckYaw + swirl;
      _p.set(this.mouth.x + Math.sin(a) * dist, this.mouth.y - 0.5 + s.u * (0.6 + s.r * 2.5) - (1 - s.u) * 0.2, this.mouth.z + Math.cos(a) * dist);
      _q.setFromAxisAngle(UP, this.time * 4 + s.r * 9);
      _s.setScalar((0.6 + s.r) * (0.5 + 0.5 * s.u) * lvl);
      this.suck.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.suck.instanceMatrix.needsUpdate = true;
  }

  private updateGust(dt: number): void {
    this.gustLevel += ((this.gustOn ? 1 : 0) - this.gustLevel) * Math.min(1, dt * 5);
    const lvl = this.gustLevel;
    (this.streaks.material as THREE.MeshBasicMaterial).opacity = 0.55 * lvl;
    const span = Math.max(1, this.gustOuter - this.gustInner);
    for (let i = 0; i < MAX_STREAK; i++) {
      const s = this.streakSeeds[i];
      if (lvl < 0.01) {
        this.streaks.setMatrixAt(i, ZERO);
        continue;
      }
      s.r += (dt * s.v) / span;
      if (s.r >= 1) {
        s.r -= 1;
        s.a = Math.random() * TAU;
        s.h = 0.3 + Math.random() * 3.5;
      }
      const rr = this.gustInner + s.r * span;
      _p.set(this.gustCenter.x + Math.sin(s.a) * rr, this.gustCenter.y + s.h, this.gustCenter.z + Math.cos(s.a) * rr);
      _q.setFromAxisAngle(UP, s.a);
      _s.set(1, 1, (0.6 + 0.8 * Math.sin(s.r * Math.PI)) * lvl);
      this.streaks.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.streaks.instanceMatrix.needsUpdate = true;
  }

  private updateFeathers(dt: number): void {
    let any = false;
    for (let i = 0; i < this.feather.length; i++) {
      const f = this.feather[i];
      if (!f.live) continue;
      any = true;
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      _p.lerpVectors(f.from, f.to, u);
      _p.y += 2.5 * u * (1 - u);
      _d.subVectors(f.to, f.from).normalize();
      _q.setFromUnitVectors(_s.set(0, 0, 1), _d);
      _q.multiply(_q2.setFromAxisAngle(_s.set(0, 0, 1), f.spin + f.t * 6));
      this.feathers.setMatrixAt(i, _m.compose(_p, _q, _s.set(1.3, 1.3, 1.3)));
      if (u >= 1) {
        f.live = false;
        this.feathers.setMatrixAt(i, ZERO);
        const cb = f.onLand;
        f.onLand = null;
        cb?.(f.to);
      }
    }
    if (any) this.feathers.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.suck.removeFromParent();
    this.streaks.removeFromParent();
    this.feathers.removeFromParent();
    this.floes.dispose();
    this.suck.dispose();
    this.streaks.dispose();
    this.feathers.dispose();
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    for (const f of this.feather) f.onLand = null;
  }
}
