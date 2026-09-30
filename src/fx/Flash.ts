/**
 * 爆炸闪光球（放大淡出的菲涅尔发光球）与复用点光源池。
 *
 * 点光源常驻场景、强度为 0 时视为空闲：增删光源会改变光照数量、触发全场材质重编译，所以绝不增删。
 */
import * as THREE from 'three';
import { ORDER_FLASH, hexToColor } from './shared';

const SPHERES = 16;
/** 点光源池大小（契约要求 ≤ 4） */
const LIGHTS = 3;

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uHot;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = abs(dot(normalize(vN), normalize(vV)));
  float a = pow(f, 1.6) * uOpacity;
  vec3 col = mix(uColor, vec3(1.0, 0.95, 0.85), uHot * pow(f, 2.5));
  gl_FragColor = vec4(col * 1.4, a);
  #include <colorspace_fragment>
}
`;

let sphereGeo: THREE.IcosahedronGeometry | null = null;

interface SphereUniforms {
  [k: string]: THREE.IUniform;
  uColor: THREE.IUniform<THREE.Color>;
  uOpacity: THREE.IUniform<number>;
  uHot: THREE.IUniform<number>;
}

interface FlashSphere {
  mesh: THREE.Mesh;
  u: SphereUniforms;
  active: boolean;
  age: number;
  life: number;
  r0: number;
  r1: number;
  stamp: number;
}

interface PooledLight {
  light: THREE.PointLight;
  active: boolean;
  age: number;
  life: number;
  peak: number;
  stamp: number;
}

export class FlashEffects {
  readonly group = new THREE.Group();
  private readonly spheres: FlashSphere[] = [];
  private readonly lights: PooledLight[] = [];
  private stamp = 0;

  constructor() {
    this.group.name = 'fx.flashes';
    if (!sphereGeo) sphereGeo = new THREE.IcosahedronGeometry(1, 2);
    for (let i = 0; i < SPHERES; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uHot: { value: 1 } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(sphereGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = ORDER_FLASH;
      this.group.add(mesh);
      this.spheres.push({ mesh, u: mat.uniforms as SphereUniforms, active: false, age: 0, life: 0.3, r0: 0.1, r1: 1, stamp: 0 });
    }
    for (let i = 0; i < LIGHTS; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2);
      light.castShadow = false;
      light.name = `fx.light${i}`;
      this.lights.push({ light, active: false, age: 0, life: 0.3, peak: 0, stamp: 0 });
    }
  }

  /** 把光源挂到场景（只调用一次；光源不放进 group，以免被预编译时重复计数） */
  attachLights(scene: THREE.Scene): void {
    for (const l of this.lights) scene.add(l.light);
  }

  private take<T extends { active: boolean; stamp: number }>(pool: T[]): T {
    let oldest = pool[0];
    for (const it of pool) {
      if (!it.active) return it;
      if (it.stamp < oldest.stamp) oldest = it;
    }
    return oldest;
  }

  /** 闪光球：半径从 r0 放大到 r1，同时淡出、由白热转为主色 */
  sphere(center: THREE.Vector3, r0: number, r1: number, color: number, life: number): void {
    const s = this.take(this.spheres);
    s.active = true;
    s.age = 0;
    s.life = life;
    s.r0 = r0;
    s.r1 = r1;
    s.stamp = ++this.stamp;
    hexToColor(color, s.u.uColor.value);
    s.u.uOpacity.value = 1;
    s.u.uHot.value = 1;
    s.mesh.position.copy(center);
    s.mesh.scale.setScalar(r0);
    s.mesh.visible = true;
  }

  /** 点光源闪一下：peak 为峰值强度（坎德拉），distance 为照明范围 */
  light(pos: THREE.Vector3, color: number, peak: number, distance: number, life: number): void {
    const l = this.take(this.lights);
    l.active = true;
    l.age = 0;
    l.life = life;
    l.peak = peak;
    l.stamp = ++this.stamp;
    l.light.position.copy(pos);
    hexToColor(color, l.light.color);
    l.light.distance = distance;
    l.light.intensity = peak;
  }

  update(dt: number): void {
    for (const s of this.spheres) {
      if (!s.active) continue;
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      s.mesh.scale.setScalar(s.r0 + (s.r1 - s.r0) * e);
      s.u.uOpacity.value = (1 - t) * (1 - t);
      s.u.uHot.value = 1 - t;
    }
    for (const l of this.lights) {
      if (!l.active) continue;
      l.age += dt;
      const t = l.age / l.life;
      if (t >= 1) {
        l.active = false;
        l.light.intensity = 0;
        continue;
      }
      // 起亮极快、二次衰减
      const k = t < 0.08 ? t / 0.08 : (1 - t) * (1 - t) / (0.92 * 0.92);
      l.light.intensity = l.peak * Math.min(1, k);
    }
  }

  clear(): void {
    for (const s of this.spheres) {
      s.active = false;
      s.mesh.visible = false;
    }
    for (const l of this.lights) {
      l.active = false;
      l.light.intensity = 0;
    }
  }
}
