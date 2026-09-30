/**
 * 大容量粒子池：一个 THREE.Points + 自定义 ShaderMaterial。
 *
 * - 每个粒子有独立的颜色 / 大小（世界米）/ 透明度 / 形状，CPU 端积分速度、重力、阻尼、地面反弹。
 * - 环形分配：满了直接覆盖最旧分配的槽位，永不扩容、永不分配。
 * - 只上传 [0, hiWater) 的活跃区间；死亡粒子在顶点着色器里被裁掉。
 */
import * as THREE from 'three';
import { GLSL_FOG_FADE, GLSL_FOG_MIX } from './shared';

// 形状（写入 aShape）
export const SHAPE_GLOW = 0;
export const SHAPE_SPARK = 1;
export const SHAPE_SMOKE = 2;
export const SHAPE_CHUNK = 3;

// 透明度曲线
/** 线性淡出 */
export const FADE_OUT = 0;
/** 快速淡入后缓慢淡出（烟） */
export const FADE_SMOKE = 1;
/** 保持不透明，最后 30% 淡出（碎屑） */
export const FADE_HOLD = 2;
/** 先亮后暗的闪烁感（余烬） */
export const FADE_FLICKER = 3;

/** 粒子风格预设（模块级常量，避免每次发射传一堆参数） */
export interface ParticleStyle {
  gravity: number;
  /** 速度阻尼（每秒指数衰减系数） */
  drag: number;
  /** 生命结束时的大小倍率（<1 缩小，>1 膨胀） */
  grow: number;
  alpha: number;
  shape: number;
  fade: number;
  /** 碰到地面是否反弹（否则贴地停住） */
  bounce: boolean;
}

export const STYLE_GLOW: ParticleStyle = { gravity: 0, drag: 2.5, grow: 0.25, alpha: 1, shape: SHAPE_GLOW, fade: FADE_OUT, bounce: false };
export const STYLE_SPARK: ParticleStyle = { gravity: 14, drag: 1.2, grow: 0.3, alpha: 1, shape: SHAPE_SPARK, fade: FADE_OUT, bounce: true };
export const STYLE_EMBER: ParticleStyle = { gravity: -1.2, drag: 1.6, grow: 0.2, alpha: 1, shape: SHAPE_SPARK, fade: FADE_FLICKER, bounce: false };
export const STYLE_FIREBALL: ParticleStyle = { gravity: -2.5, drag: 3.2, grow: 1.6, alpha: 0.7, shape: SHAPE_GLOW, fade: FADE_OUT, bounce: false };
export const STYLE_MOTE: ParticleStyle = { gravity: -3.5, drag: 1.4, grow: 0.15, alpha: 1, shape: SHAPE_SPARK, fade: FADE_FLICKER, bounce: false };
export const STYLE_SMOKE: ParticleStyle = { gravity: -0.9, drag: 2.2, grow: 2.2, alpha: 0.5, shape: SHAPE_SMOKE, fade: FADE_SMOKE, bounce: false };
export const STYLE_DUST: ParticleStyle = { gravity: 0.6, drag: 4.0, grow: 2.2, alpha: 0.45, shape: SHAPE_SMOKE, fade: FADE_SMOKE, bounce: false };
export const STYLE_CHUNK: ParticleStyle = { gravity: 22, drag: 0.6, grow: 0.7, alpha: 1, shape: SHAPE_CHUNK, fade: FADE_HOLD, bounce: true };

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aShape;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vShape = aShape;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float depth = -mvPosition.z;
  // 贴脸的粒子淡掉，避免满屏大光斑
  vAlpha = aAlpha * smoothstep(0.12, 0.9, depth);
  gl_Position = projectionMatrix * mvPosition;
  if (aAlpha <= 0.001 || depth <= 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  } else {
    gl_PointSize = clamp(aSize * uScale / depth, 1.5, 320.0);
  }
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  vec3 col = vColor;
  float a;
  if (vShape < 0.5) {
    // 柔光：平方衰减 + 白热核心
    if (d > 1.0) discard;
    float f = 1.0 - d;
    a = f * f;
    col += vec3(0.85) * pow(f, 8.0);
  } else if (vShape < 1.5) {
    // 火花：小而硬的亮核 + 光晕
    if (d > 1.0) discard;
    float f = 1.0 - d;
    a = f * f * f * 0.7 + smoothstep(0.22, 0.0, d);
    col = mix(col, vec3(1.0), smoothstep(0.18, 0.0, d) * 0.75);
  } else if (vShape < 2.5) {
    // 烟：柔边圆，边缘略带起伏
    if (d > 1.0) discard;
    float ang = atan(c.y, c.x);
    float edge = 1.0 - 0.12 * sin(ang * 5.0 + vColor.r * 40.0);
    a = smoothstep(edge, 0.05, d) * 0.9;
    col *= 0.85 + 0.3 * (1.0 - gl_PointCoord.y);
  } else {
    // 碎屑：硬边菱形，上亮下暗
    float m = abs(c.x) + abs(c.y);
    if (m > 0.9) discard;
    a = 1.0;
    col *= 0.55 + 0.6 * (1.0 - gl_PointCoord.y);
  }
  a *= vAlpha;
#ifdef ADDITIVE
  ${GLSL_FOG_FADE}
#else
  ${GLSL_FOG_MIX}
#endif
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

/** 所有粒子池共享的像素缩放 uniform（= 画布像素高度 / (2·tan(fov/2))），由 FxSystem 每帧写入 */
export const particleScaleUniform = { value: 600 };

export class ParticlePool {
  readonly points: THREE.Points;
  readonly capacity: number;
  /** 当前存活数量 */
  alive = 0;

  private readonly geo: THREE.BufferGeometry;
  private readonly aPos: THREE.BufferAttribute;
  private readonly aColor: THREE.BufferAttribute;
  private readonly aSize: THREE.BufferAttribute;
  private readonly aAlpha: THREE.BufferAttribute;
  private readonly aShape: THREE.BufferAttribute;

  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly shape: Float32Array;

  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly grow: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly fade: Uint8Array;
  private readonly bounce: Uint8Array;

  private cursor = 0;
  private hiWater = 0;
  private dirtyMin = Infinity;
  private dirtyMax = -1;

  constructor(capacity: number, additive: boolean) {
    this.capacity = capacity;
    const n = capacity;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.shape = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.fade = new Uint8Array(n);
    this.bounce = new Uint8Array(n);

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.aShape = new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.setAttribute('aShape', this.aShape);
    geo.setDrawRange(0, 0);
    // 包围球无意义（粒子到处飞），关闭视锥剔除
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: additive ? { ADDITIVE: '' } : {},
    });
    // 缩放 uniform 共享同一个对象（merge 会克隆，这里在之后挂上）
    mat.uniforms.uScale = particleScaleUniform;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.name = additive ? 'fx.particles.additive' : 'fx.particles.alpha';
  }

  /**
   * 发射一个粒子。color 为线性空间颜色；size 为世界尺寸（米，直径）；gravity 缺省取风格值。
   */
  spawn(
    style: ParticleStyle,
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    color: THREE.Color,
    size: number,
    life: number,
    gravity: number = style.gravity,
  ): void {
    const i = this.cursor;
    this.cursor = i + 1 >= this.capacity ? 0 : i + 1;
    if (this.life[i] <= 0) this.alive++;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.col[i3] = color.r;
    this.col[i3 + 1] = color.g;
    this.col[i3 + 2] = color.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.size[i] = size;
    this.grow[i] = style.grow;
    this.alpha0[i] = style.alpha;
    this.alpha[i] = style.fade === FADE_SMOKE ? 0 : style.alpha;
    this.shape[i] = style.shape;
    this.grav[i] = gravity;
    this.drag[i] = style.drag;
    this.fade[i] = style.fade;
    this.bounce[i] = style.bounce ? 1 : 0;
    if (i + 1 > this.hiWater) this.hiWater = i + 1;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  update(dt: number, floorY: number): void {
    const hi = this.hiWater;
    if (hi === 0) return;
    const pos = this.pos, vel = this.vel, life = this.life, maxLife = this.maxLife;
    const size = this.size, alpha = this.alpha;
    let newHi = 0;
    let alive = 0;
    if (dt > 0) {
      for (let i = 0; i < hi; i++) {
        let l = life[i];
        if (l <= 0) continue;
        l -= dt;
        if (l <= 0) {
          life[i] = 0;
          alpha[i] = 0;
          size[i] = 0;
          continue;
        }
        life[i] = l;
        alive++;
        newHi = i + 1;
        const i3 = i * 3;
        const damp = Math.exp(-this.drag[i] * dt);
        let vx = vel[i3] * damp;
        let vy = vel[i3 + 1] * damp - this.grav[i] * dt;
        let vz = vel[i3 + 2] * damp;
        const px = pos[i3] + vx * dt;
        let py = pos[i3 + 1] + vy * dt;
        const pz = pos[i3 + 2] + vz * dt;
        // 只有下落的重力粒子才与地面发生作用
        if (py < floorY + 0.02 && vy < 0 && this.grav[i] > 0) {
          py = floorY + 0.02;
          if (this.bounce[i] && vy < -1.2) {
            vy = -vy * 0.32;
            vx *= 0.55;
            vz *= 0.55;
          } else {
            vy = 0;
            vx *= 0.4;
            vz *= 0.4;
          }
        }
        vel[i3] = vx;
        vel[i3 + 1] = vy;
        vel[i3 + 2] = vz;
        pos[i3] = px;
        pos[i3 + 1] = py;
        pos[i3 + 2] = pz;

        const t = 1 - l / maxLife[i];
        size[i] = this.size0[i] * (1 + (this.grow[i] - 1) * t);
        const a0 = this.alpha0[i];
        switch (this.fade[i]) {
          case FADE_SMOKE:
            alpha[i] = a0 * Math.min(1, t * 7) * (1 - t) * (1 - t * 0.3);
            break;
          case FADE_HOLD:
            alpha[i] = t < 0.7 ? a0 : a0 * (1 - (t - 0.7) / 0.3);
            break;
          case FADE_FLICKER:
            alpha[i] = a0 * (1 - t) * (0.65 + 0.35 * Math.sin(l * 37 + i));
            break;
          default:
            alpha[i] = a0 * (1 - t);
        }
      }
    } else {
      // 冻结（暂停）：只统计活跃区间
      for (let i = 0; i < hi; i++) {
        if (life[i] > 0) {
          alive++;
          newHi = i + 1;
        }
      }
    }
    this.alive = alive;
    // 冻结且没有新发射时，GPU 数据没变，不必重传
    if (dt > 0 || this.dirtyMax >= 0) this.upload(hi);
    this.hiWater = newHi;
    if (alive === 0) this.cursor = 0;
    this.geo.setDrawRange(0, newHi);
  }

  private upload(range: number): void {
    if (range <= 0) return;
    this.aPos.clearUpdateRanges();
    this.aPos.addUpdateRange(0, range * 3);
    this.aPos.needsUpdate = true;
    this.aSize.clearUpdateRanges();
    this.aSize.addUpdateRange(0, range);
    this.aSize.needsUpdate = true;
    this.aAlpha.clearUpdateRanges();
    this.aAlpha.addUpdateRange(0, range);
    this.aAlpha.needsUpdate = true;
    if (this.dirtyMax >= 0) {
      const lo = this.dirtyMin, cnt = this.dirtyMax - this.dirtyMin + 1;
      this.aColor.clearUpdateRanges();
      this.aColor.addUpdateRange(lo * 3, cnt * 3);
      this.aColor.needsUpdate = true;
      this.aShape.clearUpdateRanges();
      this.aShape.addUpdateRange(lo, cnt);
      this.aShape.needsUpdate = true;
      this.dirtyMin = Infinity;
      this.dirtyMax = -1;
    }
  }

  clear(): void {
    const hi = this.hiWater;
    for (let i = 0; i < hi; i++) {
      this.life[i] = 0;
      this.alpha[i] = 0;
      this.size[i] = 0;
    }
    this.upload(hi);
    this.alive = 0;
    this.cursor = 0;
    this.hiWater = 0;
    this.geo.setDrawRange(0, 0);
  }
}
