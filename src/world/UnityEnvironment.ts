import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { GameContext } from '../core/types';
import type { UnityEnvironment as EnvironmentData } from './UnityLevelLibrary';
import { Atmosphere, atmosphereForChapter } from './Atmosphere';

type Rgba = [number, number, number, number];

function color(value: Rgba): THREE.Color {
  return new THREE.Color().setRGB(value[0], value[1], value[2], THREE.SRGBColorSpace);
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clip.xyww;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 bottomColor;
uniform vec3 sunColor;
uniform vec3 sunDirection;
uniform float sharpness;
uniform float horizonGlow;
uniform float sunSize;
uniform float sunHalo;
uniform float exposure;
varying vec3 vDirection;
void main() {
  vec3 direction = normalize(vDirection);
  float up = direction.y;
  vec3 sky = mix(horizonColor, topColor, pow(clamp(up, 0.0, 1.0), 1.0 / sharpness));
  vec3 ground = mix(horizonColor, bottomColor, clamp(-up * 4.0, 0.0, 1.0));
  vec3 result = up >= 0.0 ? sky : ground;
  result += horizonColor * horizonGlow * exp(-abs(up) * 12.0);
  float sun = dot(direction, normalize(sunDirection));
  float disc = smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.6, sun);
  float halo = pow(clamp(sun, 0.0, 1.0), 64.0) * sunHalo + pow(clamp(sun, 0.0, 1.0), 8.0) * sunHalo * 0.25;
  result += sunColor * (disc * 6.0 + halo);
  gl_FragColor = vec4(result * exposure, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * 空气透视 / 云影层（Atmosphere.ts，网页独有，Unity 里没有）。`chapter` 选章节默认值，`baseY` 是这张图低雾的
 * 基准高度（谷底或水面的世界 y）。网址带 `atmosphere=0` 关掉这一层，看 Unity 原样的雾。
 */
export interface UnityAtmosphereOptions {
  chapter: number;
  baseY: number;
}

/** 接上空气层后线性雾起点至少推到这里（终点不动），否则 40 m 起的线性雾会把低雾 / 空气层盖平 */
const ATMOSPHERE_FOG_START = 120;

function atmosphereEnabled(): boolean {
  return typeof location === 'undefined' || new URLSearchParams(location.search).get('atmosphere') !== '0';
}

export class UnityEnvironmentView {
  ready: Promise<void> = Promise.resolve();
  private atmosphere = false;
  private sun: THREE.DirectionalLight | null = null;
  private readonly sky: THREE.Mesh | null;
  private cube: THREE.CubeTexture | null = null;
  private readonly localLights: THREE.Light[] = [];
  private shader: THREE.ShaderMaterial | null = null;

  constructor(private readonly ctx: GameContext, private readonly data: EnvironmentData, parent: THREE.Group, report?: (stage: string) => void, atmosphere?: UnityAtmosphereOptions) {
    report?.('fog');
    const fogColor = color(data.fog.color);
    ctx.scene.background = fogColor;
    ctx.scene.fog = data.fog.enabled
      ? data.fog.mode === 1 ? new THREE.Fog(fogColor, data.fog.start, data.fog.end) : new THREE.FogExp2(fogColor, data.fog.density)
      : null;
    report?.('ambient');
    const ambient = data.ambient;
    if (ambient.mode === 0 || ambient.mode === 3) {
      parent.add(new THREE.AmbientLight(color(ambient.light), ambient.intensity));
    } else {
      parent.add(new THREE.HemisphereLight(color(ambient.sky), color(ambient.ground), ambient.intensity));
    }
    report?.('sun');
    if (data.sun) {
      const sun = new THREE.DirectionalLight(color(data.sun.color), data.sun.intensity);
      sun.position.fromArray(data.sun.forward).multiplyScalar(-120);
      sun.target.position.set(0, 0, 0);
      sun.castShadow = data.sun.shadows > 0 && ctx.settings.quality !== 'low';
      sun.shadow.bias = -0.0003;
      sun.shadow.normalBias = 0.08;
      sun.shadow.camera.left = -140;
      sun.shadow.camera.right = 140;
      sun.shadow.camera.top = 140;
      sun.shadow.camera.bottom = -140;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 500;
      parent.add(sun, sun.target);
      this.sun = sun;
    }
    report?.('local lights');
    for (const item of data.lights) {
      const lightColor = color(item.color);
      if (item.type === 2) {
        const light = new THREE.PointLight(lightColor, item.intensity, item.range, 2);
        light.position.fromArray(item.position);
        parent.add(light);
      } else if (item.type === 1) {
        const light = new THREE.SpotLight(lightColor, item.intensity, item.range, item.spotAngle * Math.PI / 360, 0.5, 2);
        light.position.fromArray(item.position);
        light.target.position.copy(light.position).add(new THREE.Vector3().fromArray(item.forward));
        parent.add(light, light.target);
      }
    }
    this.localLights.push(...parent.children.filter(object => object instanceof THREE.PointLight || object instanceof THREE.SpotLight) as THREE.Light[]);
    report?.('sky');
    this.sky = this.createSky(parent);
    report?.('camera');
    ctx.camera.far = Math.max(ctx.camera.far, data.fog.enabled && data.fog.mode === 1 ? data.fog.end * 1.5 : 3000);
    ctx.camera.updateProjectionMatrix();
    if (atmosphere && ctx.scene.fog && atmosphereEnabled()) {
      report?.('atmosphere');
      if (ctx.scene.fog instanceof THREE.Fog) ctx.scene.fog.near = Math.min(Math.max(ctx.scene.fog.near, ATMOSPHERE_FOG_START), ctx.scene.fog.far);
      Atmosphere.bind(ctx.scene, atmosphereForChapter(atmosphere.chapter), { baseY: atmosphere.baseY, sun: this.sun });
      this.atmosphere = true;
    }
    report?.('environment complete');
  }

  update(t = 0): void {
    if (this.atmosphere) Atmosphere.update(t);
    for (const light of this.localLights) light.userData.cameraDistance = light.position.distanceToSquared(this.ctx.camera.position);
    this.localLights.sort((a, b) => a.userData.cameraDistance - b.userData.cameraDistance);
    for (let i = 0; i < this.localLights.length; i++) {
      const light = this.localLights[i];
      const range = light instanceof THREE.PointLight || light instanceof THREE.SpotLight ? light.distance : 0;
      light.visible = i < 8 && light.userData.cameraDistance <= (range + 35) ** 2;
    }
    if (this.sky) this.sky.position.copy(this.ctx.camera.position);
  }

  dispose(): void {
    if (this.atmosphere) Atmosphere.unbind();
    this.atmosphere = false;
    this.cube?.dispose();
    this.cube = null;
    if (!this.sky) return;
    this.sky.geometry.dispose();
    if (this.shader) this.shader.dispose();
    else if (this.sky.material instanceof THREE.ShaderMaterial) this.sky.material.dispose();
  }

  private createSky(parent: THREE.Group): THREE.Mesh | null {
    const data = this.data.sky;
    if (!data) return null;
    if (data.cubemap?.length === 6) {
      const base = import.meta.env?.BASE_URL ?? '/';
      this.ready = new THREE.CubeTextureLoader().loadAsync(data.cubemap.map(url => `${base}${url}`)).then(cube => {
        this.cube = cube;
        cube.colorSpace = THREE.SRGBColorSpace;
        cube.flipY = true;
        this.ctx.scene.background = cube;
      });
      return null;
    }
    if (data.shader === 'Skybox/Procedural') {
      const sky = new Sky();
      sky.scale.setScalar(4000);
      sky.material.uniforms.turbidity.value = (data.floats._AtmosphereThickness ?? 1) * 3;
      sky.material.uniforms.rayleigh.value = 1.5 / Math.max(0.5, data.floats._AtmosphereThickness ?? 1);
      sky.material.uniforms.mieCoefficient.value = 0.005;
      sky.material.uniforms.mieDirectionalG.value = 0.76;
      const direction = this.data.sun?.forward ?? [0, -1, 0];
      sky.material.uniforms.sunPosition.value.set(-direction[0], -direction[1], -direction[2]);
      parent.add(sky);
      return sky as unknown as THREE.Mesh;
    }
    const colors = data.colors;
    const floats = data.floats;
    const direction = this.data.sun?.forward ?? [0, -1, 0];
    this.shader = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: color(colors._TopColor ?? [0.3, 0.45, 0.75, 1]) },
        horizonColor: { value: color(colors._HorizonColor ?? colors._SkyTint ?? [0.85, 0.75, 0.6, 1]) },
        bottomColor: { value: color(colors._BottomColor ?? colors._GroundColor ?? [0.4, 0.33, 0.25, 1]) },
        sunColor: { value: color(colors._SunColor ?? [1, 0.9, 0.7, 1]) },
        sunDirection: { value: new THREE.Vector3(-direction[0], -direction[1], -direction[2]) },
        sharpness: { value: floats._HorizonSharpness ?? 2.5 },
        horizonGlow: { value: floats._HorizonGlow ?? 0.4 },
        sunSize: { value: floats._SunSize ?? 0.03 },
        sunHalo: { value: floats._SunHalo ?? 0.6 },
        exposure: { value: floats._Exposure ?? 1 },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.shader);
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    parent.add(sky);
    return sky;
  }
}
