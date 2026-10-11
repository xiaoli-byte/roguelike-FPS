/**
 * 魔刀千刃 v2 的世界刃群（docs/demon-blade-v2.md 第 4–7、9 节）：128 片碎刃离开第一人称刀身后，在主场景里的去向与样子。
 *
 * 每片碎刃只有一份：在手里（HOME，第一人称刀身显示它）或在世界里（本模块的 ShardBuffer 显示它）。
 * - 出窍：按离刀顺序（刀尖在前）依次从第一人称刀身上的实际位置离开，沿弯曲轨迹汇成一股激流飞向阵形里自己的位置。
 * - 阵形：vortex 刃群旋涡（绕中心环绕并周期性俯冲穿过目标，「像下雨一样」）、shield 同心旋转圆盾、
 *   ball 杀气聚合的刃球（越转越快、越压越小）、scatter 爆发后向外炸散。
 * - 归刀：刀根附近的碎片先回，沿弯曲轨迹飞回第一人称刀身上各自的原位（原位随相机与刀姿每帧变化）。
 * 阵形中心 / 圆盾朝向由 DemonBlade 控制器每帧写入；本模块只管表现，不做伤害判定。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { bladeCells, SHARD_COUNT } from './BladeShape';
import { BLADE_PURPLE, bladeGlowTexture, bladeShardGeometry, ShardBuffer, shardMaterial } from './BladeModel';

/** 世界中碎片的缩放（比刀身上的大，远处也能看清）：刃群 / 圆盾 / 刃球 */
const SWARM_SCALE = 3.4;
const SHIELD_SCALE = 3.1;
const BALL_SCALE = 3.4;
/** 出窍：全部碎片依次离刀的总时长；飞行速度与时长上下限 */
const LAUNCH_SPREAD = 0.24;
const OUT_SPEED = 42;
const OUT_MIN = 0.1;
const OUT_MAX = 0.55;
/** 归刀：依次启程的总时长；飞行速度与时长上下限 */
const BACK_SPREAD = 0.14;
const BACK_SPEED = 48;
const BACK_MIN = 0.08;
const BACK_MAX = 0.42;
/** 圆盾的四圈碎片数（合计 128） */
const SHIELD_RINGS = [12, 28, 40, 48] as const;
/** 拖尾：长度 = 速度 × STREAK_TIME（上限 STREAK_MAX） */
const STREAK_TIME = 0.05;
const STREAK_MAX = 1.1;

export type SwarmFormation = 'vortex' | 'shield' | 'ball' | 'scatter';

/** 碎片状态：在手里 / 飞往阵形 / 在阵形中 / 飞回刀身 */
export const SHARD_HOME = 0;
export const SHARD_OUT = 1;
export const SHARD_FORMED = 2;
export const SHARD_BACK = 3;

/** 第一人称刀身提供碎片 i 在原位时的世界位置与朝向，返回世界缩放（随相机与刀姿每帧变化） */
export interface ShardHomeProvider {
  homeWorld(i: number, pos: THREE.Vector3, quat: THREE.Quaternion): number;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/** 以 y 轴对准 dir、z 轴尽量贴近 ref 的朝向 */
function alignY(dir: THREE.Vector3, ref: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _y.copy(dir);
  if (_y.lengthSq() < 1e-10) return out;
  _y.normalize();
  _x.crossVectors(_y, ref);
  if (_x.lengthSq() < 1e-8) _x.crossVectors(_y, Math.abs(_y.y) < 0.9 ? UP : _z.set(1, 0, 0));
  _x.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** 沿速度方向的拉丝拖尾（每片一条，实例化四边形，顶点着色器朝向相机） */
class StreakBatch {
  readonly mesh: THREE.Mesh;
  private readonly a: THREE.InstancedBufferAttribute;
  private readonly b: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.InstancedBufferGeometry;

  constructor(count: number) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    // a = (头 xyz, 宽)；b = (尾 xyz, 亮度)
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aHead', this.a);
    this.geo.setAttribute('aTail', this.b);
    this.geo.instanceCount = count;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(BLADE_PURPLE) }, uHot: { value: new THREE.Color(0xf2e8ff) } },
      vertexShader: /* glsl */ `
        attribute vec4 aHead; attribute vec4 aTail;
        varying vec2 vUv; varying float vI;
        void main() {
          vUv = uv; vI = aTail.w;
          vec3 head = aHead.xyz, tail = aTail.xyz;
          vec3 p = mix(tail, head, uv.y);
          vec3 axis = head - tail;
          vec3 toCam = cameraPosition - p;
          vec3 side = cross(axis, toCam);
          float sl = length(side);
          side = sl > 1e-6 ? side / sl : vec3(0.0);
          p += side * (uv.x - 0.5) * aHead.w * mix(0.35, 1.0, uv.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform vec3 uHot;
        varying vec2 vUv; varying float vI;
        void main() {
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float a = across * across * vUv.y * vI;
          vec3 c = mix(uColor, uHot, pow(across, 6.0) * vUv.y);
          gl_FragColor = vec4(c * a, a);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.name = 'demonBlade.streaks';
  }

  set(i: number, head: THREE.Vector3, tail: THREE.Vector3, width: number, intensity: number): void {
    const A = this.a.array as Float32Array, B = this.b.array as Float32Array;
    A[i * 4] = head.x; A[i * 4 + 1] = head.y; A[i * 4 + 2] = head.z; A[i * 4 + 3] = width;
    B[i * 4] = tail.x; B[i * 4 + 1] = tail.y; B[i * 4 + 2] = tail.z; B[i * 4 + 3] = intensity;
  }

  off(i: number): void {
    (this.b.array as Float32Array)[i * 4 + 3] = 0;
    (this.a.array as Float32Array)[i * 4 + 3] = 0;
  }

  flush(): void {
    this.a.needsUpdate = true;
    this.b.needsUpdate = true;
  }
}

/**
 * 每片碎刃一团柔光（屏幕空间大小随距离衰减但有下限）：远处的刃群读作一团旋转的紫光，近处只是淡淡的辉光。
 */
class GlowPoints {
  readonly points: THREE.Points;
  private readonly pos: THREE.BufferAttribute;
  private readonly size: THREE.BufferAttribute;

  constructor(count: number) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.size = new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('aSize', this.size);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: bladeGlowTexture() }, uColor: { value: new THREE.Color(0xb88cff) }, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        uniform float uScale;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float dist = max(0.1, -mv.z);
          // 世界尺寸 aSize 投影成像素；远处保底 6 像素，近处封顶 90 像素
          gl_PointSize = aSize > 0.0 ? clamp(aSize * uScale / dist, 6.0, 90.0) : 0.0;
          // 近处淡（不糊住画面），远处浓（远处靠它读出刃群）
          vA = aSize > 0.0 ? clamp(dist / 10.0, 0.12, 0.9) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec3 uColor;
        varying float vA;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vA;
          gl_FragColor = vec4(uColor * a, a);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'demonBlade.glow';
  }

  set(i: number, p: THREE.Vector3, size: number): void {
    (this.pos.array as Float32Array).set([p.x, p.y, p.z], i * 3);
    (this.size.array as Float32Array)[i] = size;
  }

  off(i: number): void {
    (this.size.array as Float32Array)[i] = 0;
  }

  /** 视口高度变化时更新像素换算（投影 1 米在 1 单位距离处的像素数） */
  setViewport(heightPx: number, fovDeg: number): void {
    ((this.points.material as THREE.ShaderMaterial).uniforms.uScale.value as number) = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  flush(): void {
    this.pos.needsUpdate = true;
    this.size.needsUpdate = true;
  }
}

/** 圆盾中间的能量膜：六边形格纹 + 外缘光圈 + 挡弹时的局部闪光 */
function shieldMembrane(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(BLADE_PURPLE) },
      uAlpha: { value: 0 },
      uTime: { value: 0 },
      uHit: { value: new THREE.Vector3(0, 0, -1) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha; uniform float uTime; uniform vec3 uHit;
      varying vec2 vP;
      float hexDist(vec2 p) {
        p = abs(p);
        return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
      }
      void main() {
        float r = length(vP);
        vec2 g = vP * 9.0;
        vec2 s = vec2(1.0, 1.7320508);
        vec2 a = mod(g, s) - s * 0.5;
        vec2 b = mod(g - s * 0.5, s) - s * 0.5;
        vec2 h = dot(a, a) < dot(b, b) ? a : b;
        float edge = smoothstep(0.42, 0.5, hexDist(h));
        float rim = smoothstep(0.82, 1.0, r) * (1.0 - smoothstep(1.0, 1.04, r));
        float wave = 0.5 + 0.5 * sin(r * 18.0 - uTime * 6.0);
        float hit = uHit.z >= 0.0 ? exp(-length(vP - uHit.xy) * 4.0) * max(0.0, 1.0 - uHit.z * 4.0) : 0.0;
        float a2 = (edge * (0.18 + 0.12 * wave) * (0.35 + 0.65 * r) + rim * 0.9 + hit * 1.6) * uAlpha;
        gl_FragColor = vec4(mix(uColor, vec3(1.0), hit * 0.6 + rim * 0.25) * a2, a2);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 48), mat);
  m.name = 'demonBlade.shieldMembrane';
  m.frustumCulled = false;
  m.renderOrder = 5;
  m.visible = false;
  return m;
}

/** 刃群范围光环：细圆环 + 旋转的断续刻痕，加法混合 */
function vortexRing(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(BLADE_PURPLE) }, uAlpha: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha; uniform float uTime;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float a = atan(vP.y, vP.x);
        float rim = smoothstep(0.86, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
        float dash = step(0.45, fract(a * 6.0 / 6.2831853 * 4.0 + uTime * 1.6));
        float inner = smoothstep(0.55, 0.8, r) * (1.0 - smoothstep(0.8, 0.86, r)) * dash * 0.6;
        float fill = (1.0 - smoothstep(0.0, 0.95, r)) * 0.12;
        float k = (rim + inner + fill) * uAlpha;
        gl_FragColor = vec4(uColor * k, k);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), mat);
  m.name = 'demonBlade.vortexRing';
  m.frustumCulled = false;
  m.renderOrder = 4;
  m.visible = false;
  return m;
}

export class BladeSwarm {
  readonly group = new THREE.Group();
  readonly buffer = new ShardBuffer();
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly streaks = new StreakBatch(SHARD_COUNT);
  private readonly glow = new GlowPoints(SHARD_COUNT);
  private readonly membrane = shieldMembrane();
  private readonly core: THREE.Sprite;
  /** 刃群范围光环（地面附近缓慢旋转的紫色圆环，半径 = 判定半径） */
  private readonly ring: THREE.Mesh;
  /** 刃群中心的紫色雾光（远处读出「那里有一团刃在绞」） */
  private readonly haze: THREE.Sprite;
  /** 判定半径（控制器写入；光环按它缩放） */
  hitRadius = 2.2;
  private provider: ShardHomeProvider | null = null;

  /** 当前阵形与其参数（控制器每帧写入） */
  formation: SwarmFormation = 'vortex';
  readonly center = new THREE.Vector3();
  /** 刃群的视觉半径（判定半径由控制器决定） */
  radius = 1.5;
  /** 圆盾：圆心、朝外法线、右 / 上方向、半径 */
  readonly shieldCenter = new THREE.Vector3();
  readonly shieldNormal = new THREE.Vector3(0, 0, 1);
  readonly shieldRight = new THREE.Vector3(1, 0, 0);
  readonly shieldUp = new THREE.Vector3(0, 1, 0);
  shieldRadius = 0.85;
  /** 刃球压缩进度 0..1 */
  ballCompress = 0;
  /** 整体亮度加成（人刀合一） */
  boost = 0;

  // 每片的状态与轨迹
  readonly state = new Uint8Array(SHARD_COUNT);
  /** 到达时刻（ctx.time.now）：刚回到刀身的碎片闪一下 */
  readonly arrivedAt = new Float32Array(SHARD_COUNT).fill(-99);
  private readonly delay = new Float32Array(SHARD_COUNT);
  private readonly t = new Float32Array(SHARD_COUNT);
  private readonly dur = new Float32Array(SHARD_COUNT);
  private readonly from = new Float32Array(SHARD_COUNT * 3);
  private readonly fromQ = new Float32Array(SHARD_COUNT * 4);
  private readonly fromS = new Float32Array(SHARD_COUNT);
  private readonly bend = new Float32Array(SHARD_COUNT * 3);
  private readonly pos = new Float32Array(SHARD_COUNT * 3);
  private readonly prev = new Float32Array(SHARD_COUNT * 3);
  private readonly rot = new Float32Array(SHARD_COUNT * 4);
  private readonly scl = new Float32Array(SHARD_COUNT);
  // 阵形中每片的固定随机参数
  private readonly axis = new Float32Array(SHARD_COUNT * 3);
  private readonly basis = new Float32Array(SHARD_COUNT * 3);
  private readonly rad = new Float32Array(SHARD_COUNT);
  private readonly omega = new Float32Array(SHARD_COUNT);
  private readonly phase = new Float32Array(SHARD_COUNT);
  private readonly dive = new Float32Array(SHARD_COUNT);
  private readonly sphere = new Float32Array(SHARD_COUNT * 3);
  /** 离刀名次 → 片号 */
  private readonly byRank = new Int32Array(SHARD_COUNT);
  private time = 0;
  /** 阵形开始时刻（刃球 / 炸散按它计时） */
  private formedAt = 0;
  private membraneHit = -1;
  private readonly hitLocal = new THREE.Vector2();

  constructor(private readonly ctx: GameContext) {
    this.group.name = 'demonBlade.swarm';
    this.mat = shardMaterial(this.buffer);
    const u = this.mat.userData.uniforms as { uEdge: { value: number }; uSeam: { value: number }; uBoost: { value: number } };
    u.uEdge.value = 1.8;
    u.uSeam.value = 0.9;
    this.mesh = new THREE.Mesh(bladeShardGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'demonBlade.worldShards';
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: bladeGlowTexture(), color: 0xb98aff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.core.visible = false;
    this.core.renderOrder = 7;
    this.ring = vortexRing();
    this.haze = new THREE.Sprite(new THREE.SpriteMaterial({
      map: bladeGlowTexture(), color: 0x8a50ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.haze.renderOrder = 4;
    this.haze.visible = false;
    this.group.add(this.haze);
    this.group.add(this.mesh, this.streaks.mesh, this.glow.points, this.membrane, this.core, this.ring);
    for (let i = 0; i < SHARD_COUNT; i++) this.buffer.hide(i);
    this.buffer.flush();

    const cells = bladeCells();
    let seed = 91;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < SHARD_COUNT; i++) {
      this.byRank[cells[i].rank] = i;
      // 环绕轴：大多接近竖直（水平旋涡），少数倾斜，形成立体的绞杀球
      _a.set((rnd() - 0.5) * 1.1, 1, (rnd() - 0.5) * 1.1).normalize();
      this.axis.set([_a.x, _a.y, _a.z], i * 3);
      _b.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(_a).normalize();
      this.basis.set([_b.x, _b.y, _b.z], i * 3);
      this.rad[i] = 0.35 + 0.65 * Math.sqrt(rnd());
      this.omega[i] = (5 + 4 * rnd()) * (rnd() < 0.2 ? -1 : 1);
      this.phase[i] = rnd() * Math.PI * 2;
      this.dive[i] = 0.55 + 0.35 * rnd();
      // 刃球：斐波那契球面方向
      const k = i + 0.5, yy = 1 - (2 * k) / SHARD_COUNT, rr = Math.sqrt(1 - yy * yy), th = k * 2.39996323;
      this.sphere.set([Math.cos(th) * rr, yy, Math.sin(th) * rr], i * 3);
    }
  }

  init(): void {
    this.ctx.scene.add(this.group);
  }

  setProvider(p: ShardHomeProvider | null): void {
    this.provider = p;
  }

  /** 全部在手里 */
  allHome(): boolean {
    for (let i = 0; i < SHARD_COUNT; i++) if (this.state[i] !== SHARD_HOME) return false;
    return true;
  }

  /** 已到达阵形的比例 */
  formedFraction(): number {
    let n = 0;
    for (let i = 0; i < SHARD_COUNT; i++) if (this.state[i] === SHARD_FORMED) n++;
    return n / SHARD_COUNT;
  }

  /** 不在手里的碎片数 */
  awayCount(): number {
    let n = 0;
    for (let i = 0; i < SHARD_COUNT; i++) if (this.state[i] !== SHARD_HOME) n++;
    return n;
  }

  /**
   * 出窍 / 换阵形：手里的碎片按离刀顺序（刀尖在前）依次离开，已在外面的碎片直接改飞新阵形的位置。
   */
  launch(formation: SwarmFormation): void {
    this.formation = formation;
    this.formedAt = this.time;
    for (let r = 0; r < SHARD_COUNT; r++) {
      const i = this.byRank[r];
      const st = this.state[i];
      if (st === SHARD_HOME) {
        this.state[i] = SHARD_OUT;
        this.delay[i] = (r / (SHARD_COUNT - 1)) * LAUNCH_SPREAD;
        this.t[i] = -1;
      } else {
        this.beginLeg(i, SHARD_OUT, 0);
      }
    }
  }

  /** 炸散（杀气爆发）：从刃球向外炸开，之后由控制器 recall */
  scatter(): void {
    this.formation = 'scatter';
    this.formedAt = this.time;
    for (let i = 0; i < SHARD_COUNT; i++) if (this.state[i] !== SHARD_HOME) this.beginLeg(i, SHARD_OUT, 0);
  }

  /** 归刀：刀根附近的先回（spreadMul 缩放依次启程的总时长；0 = 同时） */
  recall(spreadMul = 1): void {
    for (let r = 0; r < SHARD_COUNT; r++) {
      const i = this.byRank[r];
      if (this.state[i] === SHARD_HOME || this.state[i] === SHARD_BACK) continue;
      this.beginLeg(i, SHARD_BACK, (1 - r / (SHARD_COUNT - 1)) * BACK_SPREAD * spreadMul);
    }
  }

  /** 立即全部回到手里（切枪 / 死亡 / 换关） */
  snapHome(): void {
    for (let i = 0; i < SHARD_COUNT; i++) {
      this.state[i] = SHARD_HOME;
      this.buffer.hide(i);
      this.streaks.off(i);
      this.glow.off(i);
    }
    this.buffer.flush();
    this.streaks.flush();
    this.glow.flush();
    this.membrane.visible = false;
    this.core.visible = false;
  }

  /** 圆盾被击中：局部闪光（point 为世界坐标） */
  flashShield(point: THREE.Vector3): void {
    _a.subVectors(point, this.shieldCenter);
    this.hitLocal.set(_a.dot(this.shieldRight) / Math.max(0.01, this.shieldRadius), _a.dot(this.shieldUp) / Math.max(0.01, this.shieldRadius));
    this.membraneHit = 0;
  }

  /** 从当前位置开始一段飞行：kind = OUT（去阵形）/ BACK（回刀身） */
  private beginLeg(i: number, kind: number, delay: number): void {
    this.state[i] = kind;
    this.delay[i] = delay;
    this.t[i] = -1;
  }

  /** 飞行起点 = 当前位置（在手里的碎片取第一人称刀身上的实际位置） */
  private captureStart(i: number): void {
    if (this.state[i] === SHARD_OUT && this.scl[i] === 0) {
      const s = this.provider ? this.provider.homeWorld(i, _p, _q) : 1;
      this.from.set([_p.x, _p.y, _p.z], i * 3);
      this.fromQ.set([_q.x, _q.y, _q.z, _q.w], i * 4);
      this.fromS[i] = s;
      this.pos.set([_p.x, _p.y, _p.z], i * 3);
      this.prev.set([_p.x, _p.y, _p.z], i * 3);
      this.rot.set([_q.x, _q.y, _q.z, _q.w], i * 4);
      this.scl[i] = s;
    } else {
      this.from.set(this.pos.subarray(i * 3, i * 3 + 3), i * 3);
      this.fromQ.set(this.rot.subarray(i * 4, i * 4 + 4), i * 4);
      this.fromS[i] = this.scl[i];
    }
  }

  /** 阵形中第 i 片此刻的位置 / 朝向 / 缩放 */
  private slot(i: number, pos: THREE.Vector3, quat: THREE.Quaternion): number {
    const tt = this.time;
    switch (this.formation) {
      case 'vortex': {
        _a.fromArray(this.axis, i * 3);
        _b.fromArray(this.basis, i * 3);
        _c.crossVectors(_a, _b);
        const th = this.phase[i] + this.omega[i] * tt;
        // 周期性俯冲：半径收到接近 0 再弹出，碎片一次次穿过目标
        const per = this.dive[i];
        const ph = ((tt + this.phase[i]) % per) / per;
        const d = ph < 0.28 ? Math.sin((ph / 0.28) * Math.PI) : 0;
        const r = this.radius * this.rad[i] * (1 - 0.88 * d);
        pos.copy(_b).multiplyScalar(Math.cos(th) * r).addScaledVector(_c, Math.sin(th) * r);
        pos.y *= 0.72;
        pos.add(this.center);
        // 朝向：沿切线（环绕方向），刃面贴着环绕平面
        _v.copy(_c).multiplyScalar(Math.cos(th)).addScaledVector(_b, -Math.sin(th)).multiplyScalar(Math.sign(this.omega[i]));
        alignY(_v, _a, quat);
        return SWARM_SCALE;
      }
      case 'shield': {
        const cells = bladeCells();
        const rank = cells[i].rank;
        let ring = 0, start = 0;
        while (ring < SHIELD_RINGS.length - 1 && rank >= start + SHIELD_RINGS[ring]) start += SHIELD_RINGS[ring++];
        const n = SHIELD_RINGS[ring];
        const dir = ring % 2 ? -1 : 1;
        const ang = ((rank - start) / n) * Math.PI * 2 + dir * tt * (1.6 - ring * 0.25);
        const r = this.shieldRadius * (0.2 + 0.8 * ((ring + 0.5) / SHIELD_RINGS.length));
        pos.copy(this.shieldCenter).addScaledVector(this.shieldRight, Math.cos(ang) * r).addScaledVector(this.shieldUp, Math.sin(ang) * r);
        _v.copy(this.shieldRight).multiplyScalar(-Math.sin(ang)).addScaledVector(this.shieldUp, Math.cos(ang));
        alignY(_v, this.shieldNormal, quat);
        return SHIELD_SCALE * (1 - 0.12 * ring);
      }
      case 'ball': {
        const k = this.ballCompress;
        const spin = (6 + 24 * k * k) * (tt - this.formedAt);
        _a.fromArray(this.sphere, i * 3);
        _a.applyAxisAngle(_b.set(0.3, 1, 0.2).normalize(), spin);
        const r = 1.5 * (1 - 0.78 * k) * (0.85 + 0.15 * Math.sin(i * 3.1 + tt * 9));
        pos.copy(this.center).addScaledVector(_a, r);
        _v.crossVectors(_b, _a);
        alignY(_v, _a, quat);
        return BALL_SCALE * (1 - 0.35 * k);
      }
      default: {
        // 炸散：沿刃球方向冲出、减速
        const e = this.time - this.formedAt;
        _a.fromArray(this.sphere, i * 3);
        const r = 0.4 + 6.2 * (1 - Math.exp(-e * 7)) * (0.7 + 0.3 * this.rad[i]);
        pos.copy(this.center).addScaledVector(_a, r);
        alignY(_a, UP, quat);
        return BALL_SCALE;
      }
    }
  }

  update(dt: number, time: number): void {
    this.time = time;
    const buf = this.buffer;
    let anyAway = false;
    for (let i = 0; i < SHARD_COUNT; i++) {
      const st = this.state[i];
      if (st === SHARD_HOME) {
        if (this.scl[i] !== 0) {
          buf.hide(i);
          this.scl[i] = 0;
        }
        this.streaks.off(i);
        this.glow.off(i);
        continue;
      }
      anyAway = true;
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        if (this.delay[i] > 0) continue;
      }
      if (this.t[i] < 0) {
        this.captureStart(i);
        // 弯曲轨迹：在起终点连线的侧向随机偏一段，汇成一股带弧度的激流
        const target = st === SHARD_BACK ? this.homeTarget(i, _c, _q) : (this.slot(i, _c, _q), _c);
        const dist = _c.distanceTo(_a.fromArray(this.from, i * 3));
        const speed = st === SHARD_BACK ? BACK_SPEED : OUT_SPEED;
        this.dur[i] = Math.min(st === SHARD_BACK ? BACK_MAX : OUT_MAX, Math.max(st === SHARD_BACK ? BACK_MIN : OUT_MIN, dist / speed));
        _b.subVectors(target, _a);
        _v.set(Math.sin(i * 12.9898) , Math.cos(i * 78.233), Math.sin(i * 4.1)).cross(_b).normalize().multiplyScalar(dist * (0.12 + 0.12 * this.rad[i]));
        this.bend.set([_v.x, _v.y, _v.z], i * 3);
        this.t[i] = 0;
      }
      const prevT = this.t[i];
      this.t[i] = Math.min(1, prevT + dt / Math.max(0.01, this.dur[i]));
      const k = st === SHARD_FORMED ? 1 : easeOut(this.t[i]);
      let s: number;
      if (st === SHARD_FORMED) {
        s = this.slot(i, _p, _q);
      } else {
        const target = st === SHARD_BACK ? this.homeTarget(i, _c, _q) : _c;
        const ts = st === SHARD_BACK ? this.lastHomeScale : this.slot(i, _c, _q);
        _a.fromArray(this.from, i * 3);
        _b.fromArray(this.bend, i * 3);
        // 二次贝塞尔：控制点 = 中点 + 侧偏
        const u = 1 - k;
        _p.copy(_a).multiplyScalar(u * u)
          .addScaledVector(_v.addVectors(_a, target).multiplyScalar(0.5).add(_b), 2 * u * k)
          .addScaledVector(target, k * k);
        _m.identity();
        const q0 = _x.set(0, 0, 0);
        void q0;
        const fq = new THREE.Quaternion().fromArray(this.fromQ, i * 4);
        _q.copy(fq.slerp(_q, smooth(this.t[i])));
        s = this.fromS[i] + (ts - this.fromS[i]) * smooth(this.t[i]);
        if (this.t[i] >= 1) {
          if (st === SHARD_BACK) {
            this.state[i] = SHARD_HOME;
            this.arrivedAt[i] = time;
            buf.hide(i);
            this.scl[i] = 0;
            this.streaks.off(i);
            this.glow.off(i);
            continue;
          }
          this.state[i] = SHARD_FORMED;
        }
      }
      // 飞行中的碎片朝速度方向
      this.prev.set(this.pos.subarray(i * 3, i * 3 + 3), i * 3);
      this.pos.set([_p.x, _p.y, _p.z], i * 3);
      this.rot.set([_q.x, _q.y, _q.z, _q.w], i * 4);
      this.scl[i] = s;
      const flying = st !== SHARD_FORMED;
      buf.set(i, _p.x, _p.y, _p.z, _q, s, flying ? 1.1 + this.boost : 0.55 + this.boost);
      // 圆盾里的碎片就在眼前，柔光收小，免得糊住视线
      this.glow.set(i, _p, this.formation === 'shield' ? 0.05 : (flying ? 0.5 : 0.42) * (1 + 0.5 * this.boost));
      // 拖尾
      _a.fromArray(this.prev, i * 3);
      _v.subVectors(_p, _a);
      const sp = dt > 0 ? _v.length() / dt : 0;
      if (sp > 0.5) {
        const len = Math.min(STREAK_MAX, sp * STREAK_TIME);
        _b.copy(_p).addScaledVector(_v.normalize(), -len);
        this.streaks.set(i, _p, _b, 0.035 * s, Math.min(1, 0.35 + sp / 25) * (flying ? 1 : 0.85));
      } else {
        this.streaks.off(i);
      }
    }
    buf.flush();
    this.streaks.flush();
    this.glow.setViewport(this.ctx.renderer.domElement.height, this.ctx.camera.fov);
    this.glow.flush();
    this.mat.userData.uniforms.uBoost.value = this.boost;
    this.updateMembrane(dt, anyAway);
    this.updateCore(anyAway);
    this.updateRing(dt, anyAway);
  }

  private updateRing(dt: number, anyAway: boolean): void {
    const r = this.ring;
    const mat = r.material as THREE.ShaderMaterial;
    const want = anyAway && this.formation === 'vortex' ? this.formedFraction() : 0;
    mat.uniforms.uAlpha.value += (want - mat.uniforms.uAlpha.value) * Math.min(1, dt * 8);
    // 中心雾光：随碎片到齐浮现，缓慢脉动；离镜头近时减弱，免得糊住视线
    const hz = this.haze;
    const hm = hz.material as THREE.SpriteMaterial;
    const near = Math.min(1, this.center.distanceTo(this.ctx.camera.position) / 8);
    hm.opacity = mat.uniforms.uAlpha.value * (0.32 + 0.08 * Math.sin(this.time * 7)) * near;
    hz.visible = hm.opacity > 0.01;
    if (hz.visible) {
      hz.position.copy(this.center);
      hz.scale.setScalar(this.hitRadius * 2.2);
      hm.rotation = this.time * 2.5;
    }
    r.visible = mat.uniforms.uAlpha.value > 0.01;
    if (!r.visible) return;
    r.position.copy(this.center);
    r.position.y -= 0.55;
    r.scale.setScalar(this.hitRadius);
    mat.uniforms.uTime.value = this.time;
  }

  private lastHomeScale = 1;

  /** 归刀目标：第一人称刀身上的原位（没有提供者时退回刃群中心） */
  private homeTarget(i: number, out: THREE.Vector3, quat: THREE.Quaternion): THREE.Vector3 {
    if (!this.provider) {
      this.lastHomeScale = 1;
      return out.copy(this.center);
    }
    this.lastHomeScale = this.provider.homeWorld(i, out, quat);
    return out;
  }

  private updateMembrane(dt: number, anyAway: boolean): void {
    const m = this.membrane;
    const u = (m.material as THREE.ShaderMaterial).uniforms;
    const want = anyAway && this.formation === 'shield' ? this.formedFraction() : 0;
    u.uAlpha.value += (want - u.uAlpha.value) * Math.min(1, dt * 12);
    m.visible = u.uAlpha.value > 0.01;
    if (!m.visible) return;
    m.position.copy(this.shieldCenter);
    // 右手系：z = x × y，朝向玩家（与 shieldNormal 相反）
    _m.makeBasis(this.shieldRight, this.shieldUp, _v.copy(this.shieldNormal).negate());
    m.quaternion.setFromRotationMatrix(_m);
    m.scale.setScalar(this.shieldRadius * 1.08);
    u.uTime.value = this.time;
    if (this.membraneHit >= 0) {
      this.membraneHit += dt;
      if (this.membraneHit > 0.3) this.membraneHit = -1;
    }
    u.uHit.value.set(this.hitLocal.x, this.hitLocal.y, this.membraneHit);
  }

  private updateCore(anyAway: boolean): void {
    const on = anyAway && this.formation === 'ball';
    this.core.visible = on;
    if (!on) return;
    const k = this.ballCompress;
    this.core.position.copy(this.center);
    this.core.scale.setScalar(0.6 + 2.2 * k * k);
    (this.core.material as THREE.SpriteMaterial).opacity = 0.35 + 0.65 * k;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.buffer.dispose();
    this.mat.dispose();
  }
}
