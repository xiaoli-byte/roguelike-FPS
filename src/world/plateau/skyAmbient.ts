/**
 * 从程序天空生成的环境光（docs/art/reference-tingyuyuan.md 第四节第 3 项「柔光」）。
 *
 * 原来的环境光是一盏半球光：上面一个天色、下面一个地色，朝向一样的面亮度一样，阴面平平的一片。
 * 这里把天空（buildSky 的穹顶，换成线性色的拷贝）和一圈地面色渲进一张小立方体贴图，投成二阶球谐（LightProbe，Lambert 认）：
 * 朝地平线亮处、朝太阳那边的天光、朝头顶的蓝都不一样，阴面也带着天色。晴天、雷暴各烘一套，按 uStorm 混。
 *
 * 和 Weather 配合：Weather 每帧按雷暴程度改半球光的强度（闪电时加一下）。半球光留着当「强度旋钮」，颜色清零；
 * 探针的强度每帧 = 校准系数 × 半球光当前强度 / 原来的强度。校准：探针朝上那一面的辐照度亮度 = 原半球光的天色 × 强度。
 * 烘完之前（异步读回）照旧用原来的半球光。
 */
import * as THREE from 'three';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js';
import { WORLD_UNIFORMS } from './materials';

const lum = (c: THREE.Color | THREE.Vector3): number => {
  const r = 'r' in c ? c.r : c.x, g = 'g' in c ? c.g : c.y, b = 'b' in c ? c.b : c.z;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** 天空穹顶（直接输出 sRGB 的那个）换成线性色的拷贝：颜色 uniform 从 sRGB 换成线性，其余共享 */
function linearSkyCopy(sky: THREE.Mesh): THREE.Mesh {
  const src = sky.material as THREE.ShaderMaterial;
  const m = src.clone();
  for (const k of ['uTime', 'uStorm', 'uFlash'] as const) if (m.uniforms[k]) m.uniforms[k] = WORLD_UNIFORMS[k];
  for (const k of ['uTop', 'uMid', 'uHorizon', 'uStormHorizon']) {
    const v = src.uniforms[k]?.value as THREE.Vector3 | undefined;
    if (!v) continue;
    const c = new THREE.Color().setRGB(v.x, v.y, v.z, THREE.SRGBColorSpace);
    m.uniforms[k] = { value: new THREE.Vector3(c.r, c.g, c.b) };
  }
  if (src.uniforms.uSunDir) m.uniforms.uSunDir = src.uniforms.uSunDir;
  const mesh = new THREE.Mesh(sky.geometry, m);
  mesh.scale.setScalar(500);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

export interface SkyAmbientOptions {
  /** 地面反上来的颜色（下半球）；缺省用半球光的地色 */
  ground?: THREE.ColorRepresentation;
  /** 整体再乘多少（1 = 朝上的面和原半球光一样亮） */
  gain?: number;
  /** 保留多少天空的色度（1 = 原样；天空的蓝比半球光的灰蓝浓得多，全保留的话阴面和地面会偏蓝紫）。缺省 0.75 */
  saturation?: number;
}

export class SkyAmbient {
  readonly probe = new THREE.LightProbe();
  /** 探针烘好了（之前用原来的半球光） */
  ready = false;
  private readonly clear = new THREE.SphericalHarmonics3();
  private readonly storm = new THREE.SphericalHarmonics3();
  private readonly hemiRef: number;
  private readonly hemiSky: THREE.Color;
  private readonly hemiGround: THREE.Color;
  private scale = 1;
  private on = true;

  constructor(private readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, private readonly sky: THREE.Mesh,
    private readonly hemi: THREE.HemisphereLight, private readonly opts: SkyAmbientOptions = {}) {
    this.hemiRef = Math.max(1e-3, hemi.intensity);
    this.hemiSky = hemi.color.clone();
    this.hemiGround = hemi.groundColor.clone();
    this.probe.intensity = 0;
    this.probe.name = 'sky-ambient';
    scene.add(this.probe);
    void this.bake();
  }

  private async bake(): Promise<void> {
    const r = this.renderer;
    const env = new THREE.Scene();
    env.add(linearSkyCopy(this.sky));
    // 下半球：地面反上来的光（离地平线越近越接近天色，像远处的地面在雾里）
    const ground = new THREE.Color(this.opts.ground ?? this.hemiGround);
    const g = new THREE.SphereGeometry(400, 32, 12, 0, Math.PI * 2, Math.PI / 2 + 0.03, Math.PI / 2 - 0.03);
    env.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: ground, side: THREE.BackSide, fog: false, toneMapped: false })));
    // 晴天、雷暴各渲一张（同步渲完、马上还原 uniform，读回是异步的，期间页面照常出帧）
    const targets = [0, 1].map(() => new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType, generateMipmaps: false }));
    const storm0 = WORLD_UNIFORMS.uStorm.value, flash0 = WORLD_UNIFORMS.uFlash.value, tm = r.toneMapping;
    try {
      r.toneMapping = THREE.NoToneMapping;
      WORLD_UNIFORMS.uFlash.value = 0;
      targets.forEach((t, i) => {
        WORLD_UNIFORMS.uStorm.value = i;
        new THREE.CubeCamera(1, 5000, t).update(r, env);
      });
    } finally {
      WORLD_UNIFORMS.uStorm.value = storm0; WORLD_UNIFORMS.uFlash.value = flash0;
      r.toneMapping = tm;
    }
    try {
      this.clear.copy((await LightProbeGenerator.fromCubeRenderTarget(r, targets[0])).sh);
      this.storm.copy((await LightProbeGenerator.fromCubeRenderTarget(r, targets[1])).sh);
    } finally {
      for (const t of targets) t.dispose();
      g.dispose();
    }
    // 去一点饱和（按亮度往灰里拉，球谐是线性的，逐个系数做就行）
    const sat = this.opts.saturation ?? 0.75;
    for (const sh of [this.clear, this.storm]) for (const c of sh.coefficients) { const l = lum(c); c.set(l + (c.x - l) * sat, l + (c.y - l) * sat, l + (c.z - l) * sat); }
    // 校准：朝上那一面和原半球光的天色一样亮
    const up = this.clear.getIrradianceAt(new THREE.Vector3(0, 1, 0), new THREE.Vector3());
    const want = lum(this.hemiSky) * this.hemiRef;
    this.scale = (want / Math.max(1e-4, lum(up))) * (this.opts.gain ?? 1);
    this.ready = true;
    this.setEnabled(this.on);
  }

  /** 每帧：按雷暴程度混两套球谐，强度跟着半球光（Weather 在改它） */
  update(): void {
    if (!this.ready || !this.on) return;
    const s = THREE.MathUtils.clamp(WORLD_UNIFORMS.uStorm.value, 0, 1);
    const sh = this.probe.sh.coefficients, a = this.clear.coefficients, b = this.storm.coefficients;
    for (let i = 0; i < 9; i++) sh[i].copy(a[i]).lerp(b[i], s);
    this.probe.intensity = this.scale * this.hemi.intensity / this.hemiRef;
  }

  /** 关掉（对照）：半球光颜色还原，探针归零 */
  setEnabled(on: boolean): void {
    this.on = on;
    if (!this.ready) return;
    if (on) { this.hemi.color.setRGB(0, 0, 0); this.hemi.groundColor.setRGB(0, 0, 0); this.update(); }
    else { this.hemi.color.copy(this.hemiSky); this.hemi.groundColor.copy(this.hemiGround); this.probe.intensity = 0; }
  }
}
