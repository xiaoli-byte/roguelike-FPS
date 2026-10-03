/**
 * 「熔金」反应留下的熔池贴地视觉（docs/arsenal-expansion.md 2.4）：流动的熔火 + 零星蚀液斑 + 亮边。
 *
 * - 几何体与着色器模板模块级缓存；实例（各自一份材质克隆）走对象池复用、从不释放——
 *   着色器程序始终被引用，不会在最后一个熔池消失时被销毁、下次出现时再编译卡顿。
 * - 挂在 ctx.stageGroup 上，由反应系统的关卡任务逐帧驱动（animate）；换关时 Game 清空 stageGroup（只移除，不 dispose）。
 * - 同时最多 4 个熔池（反应系统负责），对象池实际只会有个位数实例。
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uHot;
uniform vec3 uCool;
uniform vec3 uAcid;
uniform float uTime;
uniform float uSeed;
uniform float uOpacity;
uniform float uPulse;
varying vec2 vP;
void main() {
  float d = length(vP);
  if (d >= 1.0) discard;
  float t = uTime + uSeed;
  vec2 q = vP * 2.6;
  // 熔火：几层正弦叠出缓慢翻涌的热斑
  float n = sin(q.x * 1.7 + t * 1.3) * sin(q.y * 1.9 - t * 1.1);
  n += 0.6 * sin((q.x - q.y) * 1.2 + t * 2.1);
  n += 0.45 * sin(d * 9.0 - t * 3.2);
  float hot = clamp(0.5 + 0.32 * n + uPulse * 0.15, 0.0, 1.0);
  vec3 col = mix(uCool, uHot, hot);
  // 蚀液斑：稀疏的绿色亮点
  float acid = smoothstep(0.82, 0.98, 0.5 + 0.5 * sin(q.x * 2.3 + t * 0.6 + uSeed) * sin(q.y * 2.1 - t * 0.8));
  col = mix(col, uAcid, acid * 0.6);
  float body = 1.0 - smoothstep(0.72, 1.0, d);
  float rim = smoothstep(0.8, 0.93, d) * (1.0 - smoothstep(0.93, 1.0, d));
  float a = body * (0.32 + 0.4 * hot) + rim * (0.6 + uPulse * 0.3);
  col *= 1.0 + rim * 0.6;
  gl_FragColor = vec4(col, clamp(a * uOpacity, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface PoolUniforms {
  uHot: { value: THREE.Color };
  uCool: { value: THREE.Color };
  uAcid: { value: THREE.Color };
  uTime: { value: number };
  uSeed: { value: number };
  uOpacity: { value: number };
  uPulse: { value: number };
}

/** 淡入 / 淡出时长（秒） */
const FADE_IN = 0.15;
const FADE_OUT = 0.45;

let geometry: THREE.PlaneGeometry | null = null;
let template: THREE.ShaderMaterial | null = null;
const free: ReactionPoolVisual[] = [];

function makeMaterial(): THREE.ShaderMaterial {
  if (!template) {
    template = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uHot: { value: new THREE.Color(0xffa040) },
        uCool: { value: new THREE.Color(0xa8280a) },
        uAcid: { value: new THREE.Color(0x9dff4a) },
        uTime: { value: 0 },
        uSeed: { value: 0 },
        uOpacity: { value: 0 },
        uPulse: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }
  return template.clone();
}

export class ReactionPoolVisual {
  readonly mesh: THREE.Mesh;
  private readonly u: PoolUniforms;
  private pooled = false;

  private constructor() {
    if (!geometry) geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
    const mat = makeMaterial();
    this.u = mat.uniforms as unknown as PoolUniforms;
    this.mesh = new THREE.Mesh(geometry, mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  /** 取一个实例并挂到 parent 下（通常是 ctx.stageGroup） */
  static acquire(parent: THREE.Object3D): ReactionPoolVisual {
    const v = free.pop() ?? new ReactionPoolVisual();
    v.pooled = false;
    v.u.uTime.value = 0;
    v.u.uOpacity.value = 0;
    v.u.uPulse.value = 0;
    v.u.uSeed.value = Math.random() * 20;
    v.mesh.visible = true;
    parent.add(v.mesh);
    return v;
  }

  /** 摆放：center 为池心（已含离地抬升），radius 为最终半径 */
  place(center: THREE.Vector3, radius: number): void {
    const r = Math.max(0.1, radius);
    this.mesh.position.copy(center);
    this.mesh.scale.set(r, r, 1);
  }

  /** age 为已存在秒数、life 为总时长；pulse 0..1 为跳伤时的闪亮（随后自行衰减） */
  animate(age: number, life: number, pulse: number): void {
    const u = this.u;
    u.uTime.value = age;
    const fadeIn = Math.min(1, age / FADE_IN);
    const fadeOut = Math.min(1, Math.max(0, (life - age) / FADE_OUT));
    u.uOpacity.value = fadeIn * fadeOut;
    u.uPulse.value = pulse;
  }

  /** 归还对象池（可重复调用） */
  release(): void {
    if (this.pooled) return;
    this.pooled = true;
    this.mesh.visible = false;
    this.mesh.removeFromParent();
    free.push(this);
  }
}
