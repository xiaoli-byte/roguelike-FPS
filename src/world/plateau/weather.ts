/**
 * 高原雷暴（docs/level-design/chuanzang-v1.md 2.4、enemy-roster-v2.md 第四章「导电与引雷」）。
 * 切到雷暴后天色、雾、灯光在几秒内渐变；下雨；隔几秒落一道雷：
 * 先在地面出现 1.2 秒的紫红预警圈，再劈下来。落点 8 m 内有更高的导体（经幡杆、拉则、碉楼）时，雷被导体引走。
 * 只是天气演示，没有伤害。
 */
import * as THREE from 'three';
import { WORLD_UNIFORMS } from './materials';
import type { HeightGrid } from './grid';

export interface WeatherRig {
  scene: THREE.Scene; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; fog: THREE.Fog;
  clearFog: { color: THREE.Color; near: number; far: number }; stormFog: THREE.Color;
}

interface Strike { at: THREE.Vector3; t: number; ring: THREE.Mesh; bolt: THREE.Group | null; conductor: THREE.Vector3 | null }

const RAIN = 2600;

export class Weather {
  /** 目标天气：true = 雷暴 */
  stormy = false;
  private storm = 0;
  private flash = 0;
  private nextStrike = 3;
  private strikes: Strike[] = [];
  private readonly rain: THREE.LineSegments;
  private readonly rainPos: Float32Array;
  private readonly rainMat: THREE.LineBasicMaterial;
  private readonly ringGeo = new THREE.RingGeometry(0.8, 1, 48);
  private readonly boltCore = new THREE.MeshBasicMaterial({ color: '#fff4ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  private readonly boltGlow = new THREE.MeshBasicMaterial({ color: '#e04ad0', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
  private readonly sunBase: number;
  private readonly hemiBase: number;
  private seed = 9;

  /** 落雷劈下来的那一刻（at = 落点；导体被劈中时 conductor 是那个导体） */
  onStrike: ((at: THREE.Vector3, conductor: THREE.Vector3 | null) => void) | null = null;
  /** 大导体（4-2 的铁索桥）：给一个落点，返回要把雷引过去的导体点（不引就返回 null）；4-1 不用 */
  attract: ((x: number, z: number, r: number) => THREE.Vector3 | null) | null = null;

  constructor(private readonly rig: WeatherRig, private readonly terrain: HeightGrid, private readonly conductors: THREE.Vector3[]) {
    this.sunBase = rig.sun.intensity;
    this.hemiBase = rig.hemi.intensity;
    this.rainPos = new Float32Array(RAIN * 6);
    for (let i = 0; i < RAIN; i++) this.respawnDrop(i, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: '#c9cfe0', transparent: true, opacity: 0, depthWrite: false });
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 4;
    rig.scene.add(this.rain);
  }

  /** 当前雷暴强度 0..1（渐变中的值） */
  get level(): number { return this.storm; }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** 雨滴放在以镜头为原点的 50 × 30 × 50 m 盒子里（局部坐标），跟着镜头走 */
  private respawnDrop(i: number, anyHeight: boolean): void {
    const x = (this.rand() - 0.5) * 50, z = (this.rand() - 0.5) * 50;
    const y = anyHeight ? (this.rand() - 0.3) * 30 : 22 + this.rand() * 6;
    const o = i * 6;
    this.rainPos[o] = x; this.rainPos[o + 1] = y; this.rainPos[o + 2] = z;
    this.rainPos[o + 3] = x - 0.12; this.rainPos[o + 4] = y - 0.9; this.rainPos[o + 5] = z - 0.04;
  }

  update(dt: number, camera: THREE.Vector3): void {
    this.storm += ((this.stormy ? 1 : 0) - this.storm) * Math.min(1, dt * 0.6);
    const s = this.storm;
    WORLD_UNIFORMS.uStorm.value = s;
    this.flash = Math.max(0, this.flash - dt * 4);
    WORLD_UNIFORMS.uFlash.value = this.flash;
    const { sun, hemi, fog, clearFog, stormFog } = this.rig;
    sun.intensity = this.sunBase * (1 - 0.8 * s);
    hemi.intensity = this.hemiBase * (1 - 0.4 * s) + this.flash * 2.2;
    fog.color.copy(clearFog.color).lerp(stormFog, s);
    fog.near = clearFog.near + (60 - clearFog.near) * s;
    fog.far = clearFog.far + (1300 - clearFog.far) * s;
    // 雨：往下（略斜）落，落到盒子底部就回到顶上
    this.rain.visible = s > 0.02;
    this.rainMat.opacity = 0.32 * s;
    if (this.rain.visible) {
      this.rain.position.copy(camera);
      const fall = 26 * dt, drift = 3 * dt;
      for (let i = 0; i < RAIN; i++) {
        const o = i * 6;
        this.rainPos[o + 1] -= fall; this.rainPos[o + 4] -= fall;
        this.rainPos[o] += drift; this.rainPos[o + 3] += drift;
        if (this.rainPos[o + 1] < -10) this.respawnDrop(i, false);
      }
      (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    // 落雷
    if (s > 0.6) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) { this.nextStrike = 2.5 + this.rand() * 4; this.warn(camera); }
    }
    for (const k of this.strikes) this.tick(k, dt);
    this.strikes = this.strikes.filter(k => {
      if (k.t < 1.7) return true;
      this.rig.scene.remove(k.ring);
      if (k.bolt) this.rig.scene.remove(k.bolt);
      k.bolt?.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
      (k.ring.material as THREE.Material).dispose();
      return false;
    });
  }

  /** 选落点：镜头周围 20–110 m；8 m 内有导体就劈导体 */
  private warn(camera: THREE.Vector3): void {
    const a = this.rand() * Math.PI * 2, d = 20 + this.rand() * 90;
    const x = camera.x + Math.cos(a) * d, z = camera.z + Math.sin(a) * d;
    let at = new THREE.Vector3(x, this.terrain.heightAt(x, z), z);
    let best = 8, hit: THREE.Vector3 | null = null;
    const pulled = this.attract?.(x, z, this.rand());
    if (pulled) { at = pulled.clone(); hit = pulled; }
    else for (const c of this.conductors) {
      const dd = Math.hypot(c.x - x, c.z - z);
      if (dd < best) { best = dd; at = c.clone(); hit = c; }
    }
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color: '#ff5ad8', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    ring.rotation.x = -Math.PI / 2;
    const gy = this.terrain.heightAt(at.x, at.z);
    ring.position.set(at.x, gy + 0.15, at.z);
    this.rig.scene.add(ring);
    this.strikes.push({ at, t: 0, ring, bolt: null, conductor: hit });
  }

  private tick(k: Strike, dt: number): void {
    k.t += dt;
    // 预警圈 1.2 秒内收拢到 3 m，越来越亮
    const w = Math.min(1, k.t / 1.2);
    k.ring.scale.setScalar(6 - 3 * w);
    (k.ring.material as THREE.MeshBasicMaterial).opacity = k.t < 1.2 ? 0.35 + 0.6 * w : Math.max(0, 1 - (k.t - 1.2) * 2);
    if (k.t >= 1.2 && !k.bolt) {
      k.bolt = this.bolt(k.at);
      this.rig.scene.add(k.bolt);
      this.flash = 1;
      this.onStrike?.(k.at, k.conductor);
    }
    if (k.bolt) {
      const age = k.t - 1.2;
      k.bolt.visible = age < 0.08 || (age > 0.12 && age < 0.22);
    }
  }

  /** 一道折线闪电：从 220 m 高空折到落点，带两条分叉；白芯 + 紫红外光 */
  private bolt(at: THREE.Vector3): THREE.Group {
    const g = new THREE.Group();
    const pts: THREE.Vector3[] = [];
    const top = at.clone().add(new THREE.Vector3((this.rand() - 0.5) * 60, 220, (this.rand() - 0.5) * 60));
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = top.clone().lerp(at, t);
      if (i > 0 && i < n) p.add(new THREE.Vector3((this.rand() - 0.5) * 14 * (1 - t * 0.6), 0, (this.rand() - 0.5) * 14 * (1 - t * 0.6)));
      pts.push(p);
    }
    const seg = (a: THREE.Vector3, b: THREE.Vector3, r: number): void => {
      const len = a.distanceTo(b);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      for (const [mat, rr] of [[this.boltCore, r], [this.boltGlow, r * 3.5]] as const) {
        const geo = new THREE.CylinderGeometry(rr, rr, len, 5, 1, true);
        geo.translate(0, len / 2, 0);
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(a); m.quaternion.copy(q);
        g.add(m);
      }
    };
    for (let i = 0; i < n; i++) seg(pts[i], pts[i + 1], 0.35);
    for (const from of [4, 8]) {
      let a = pts[from];
      for (let k = 0; k < 4; k++) {
        const b = a.clone().add(new THREE.Vector3((this.rand() - 0.5) * 16, -12 - this.rand() * 10, (this.rand() - 0.5) * 16));
        seg(a, b, 0.18);
        a = b;
      }
    }
    return g;
  }
}
