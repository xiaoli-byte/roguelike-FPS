/**
 * 风神飞廉的风场（spec.WIND）与风的引导（docs/level-design/chuanzang-v1.md 2.5）。
 * windAt()：基础风向 + 巢穴的吸引，返回单位风向和强度 0..1（1 = 巢穴附近）。
 * 经幡、桑烟、草浪、空中风痕、地面刮痕、风蚀冰脊都按它来——越靠近飞廉，风的痕迹越明显：
 *   远处：经幡、桑烟、草浪轻轻偏向冰川口；中段：草浪成片推过去、空中出现风痕；
 *   近处：地面刮出顺风条纹、冰面立起风蚀冰脊，冰川顶上一根风涡柱远远就看得见。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, mat4 } from './geo';
import { WIND } from './spec';
import type { Terrain } from './terrain';

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface WindSample { dx: number; dz: number; strength: number }

let field: ((x: number, z: number) => WindSample) | null = null;

/** 换一张图的风场（4-2 的峡谷风）；不调用就是 4-1 飞廉的风场 */
export function setWindField(f: ((x: number, z: number) => WindSample) | null): void { field = f; }

export function windAt(x: number, z: number): WindSample {
  if (field) return field(x, z);
  const bl = Math.hypot(WIND.base[0], WIND.base[1]);
  const bx = WIND.base[0] / bl, bz = WIND.base[1] / bl;
  const tx = WIND.lair[0] - x, tz = WIND.lair[1] - z;
  const d = Math.hypot(tx, tz) || 1;
  const strength = smooth(WIND.radius, 30, d);
  // 远处只是轻轻偏过去，近处几乎完全朝向巢穴
  const k = Math.min(1, strength * 1.6);
  let dx = bx + (tx / d - bx) * k, dz = bz + (tz / d - bz) * k;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  return { dx, dz, strength };
}

// ───────────────────────────── 空中风痕 ─────────────────────────────

const STREAKS = 900;

/** 跟着镜头的风痕（细白线），顺风飘；每条的透明度取它所在位置的风强，远离飞廉时几乎看不见 */
export class WindStreaks {
  readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly life: Float32Array;
  private seed = 21;

  constructor(private readonly terrain: Terrain) {
    this.pos = new Float32Array(STREAKS * 6);
    this.col = new Float32Array(STREAKS * 8);
    this.life = new Float32Array(STREAKS);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
    for (let i = 0; i < STREAKS; i++) this.life[i] = -1;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  update(dt: number, cam: THREE.Vector3): void {
    const here = windAt(cam.x, cam.z).strength;
    this.lines.visible = here > 0.04;
    if (!this.lines.visible) return;
    for (let i = 0; i < STREAKS; i++) {
      const o = i * 6;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // 只有一部分风痕「活着」，风越强活着的越多
        if (this.rand() > here * 1.4) { this.col[i * 8 + 3] = this.col[i * 8 + 7] = 0; this.life[i] = 0.3; continue; }
        // 生成在镜头周围 8–45 m 的环里：贴脸的风痕在透视下会拉成一道道斜线，看着像下雨
        const a = this.rand() * Math.PI * 2, d = 8 + this.rand() * 37;
        const x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d;
        const y = this.terrain.heightAt(x, z) + 0.3 + this.rand() * 9;
        this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
        this.life[i] = 0.8 + this.rand() * 1.4;
      }
      const w = windAt(this.pos[o], this.pos[o + 2]);
      const speed = 6 + 24 * w.strength, len = 0.5 + 2.2 * w.strength;
      this.pos[o] += w.dx * speed * dt; this.pos[o + 2] += w.dz * speed * dt;
      this.pos[o + 3] = this.pos[o] - w.dx * len; this.pos[o + 4] = this.pos[o + 1] - 0.05; this.pos[o + 5] = this.pos[o + 2] - w.dz * len;
      const near = Math.min(1, Math.max(0, (Math.hypot(this.pos[o] - cam.x, this.pos[o + 2] - cam.z) - 5) / 8));
      const a = Math.min(1, this.life[i] * 2) * w.strength * 0.6 * near;
      this.col.set([0.93, 0.95, 1, a, 0.93, 0.95, 1, 0], i * 8);
    }
    const g = this.lines.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
  }
}

// ───────────────────────────── 风涡柱、风蚀冰脊 ─────────────────────────────

export interface WindMarks { group: THREE.Group; update(t: number): void }

/** 螺旋线：t 0..1 自下而上，半径由窄变宽（漏斗） */
class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(private readonly phase: number, private readonly t0: number, private readonly t1: number) { super(); }
  override getPoint(u: number, target = new THREE.Vector3()): THREE.Vector3 {
    const t = this.t0 + (this.t1 - this.t0) * u;
    const a = this.phase + t * 2.6 * Math.PI * 2, r = 3 + 26 * Math.pow(t, 1.4);
    return target.set(Math.cos(a) * r, 2 + t * 70, Math.sin(a) * r);
  }
}

/** 风涡柱：5 股螺旋风带，每股断成几截；每截两头淡出，整根柱子底部淡入、顶部淡出（顶点 alpha） */
function funnelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const TUB = 48, RAD = 4;
  let seed = 11;
  const r = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 5; k++) {
    let t = r() * 0.12;
    while (t < 1) {
      const len = 0.12 + r() * 0.12, t1 = Math.min(1, t + len);
      const mid = (t + t1) / 2;
      const geo = new THREE.TubeGeometry(new Helix((k / 5) * Math.PI * 2, t, t1), TUB, 0.3 + 0.7 * mid, RAD, false);
      const n = geo.getAttribute('position').count, col = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const u = Math.floor(i / (RAD + 1)) / TUB, h = t + (t1 - t) * u;
        const a = Math.sin(Math.PI * u) * smooth(0, 0.08, h) * (1 - smooth(0.7, 1, h)) * 0.6;
        col.set([0.92, 0.92, 1, a], i * 4);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
      parts.push(geo);
      t = t1 + 0.04 + r() * 0.06;
    }
  }
  const merged = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  return merged;
}

/** 巢穴上空的风涡柱（漏斗形的螺旋风带，远处就看得见）+ 巢穴周围顺风排列的风蚀冰脊 */
export function buildWindMarks(terrain: Terrain): WindMarks {
  const group = new THREE.Group();
  group.name = 'wind-marks';
  const [lx, lz] = WIND.lair;
  const base = terrain.heightAt(lx, lz);
  const funnel = new THREE.Group();
  funnel.position.set(lx, base, lz);
  funnel.add(new THREE.Mesh(funnelGeometry(), new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  })));
  group.add(funnel);
  // 风蚀冰脊（雪面上顺风拉长的楔形脊）：离巢穴 70 m 内，越近越密越大
  const b = new GeoBuilder();
  let seed = 5;
  const r = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let fins = 0;
  for (let n = 0; n < 900 && fins < 140; n++) {
    const a = r() * Math.PI * 2, d = 8 + Math.pow(r(), 0.7) * 70;
    const x = lx + Math.cos(a) * d, z = lz + Math.sin(a) * d;
    if (terrain.slopeAt(x, z) > 0.5 || terrain.waterDepthAt(x, z) > 0.05) continue;
    const w = windAt(x, z);
    if (r() > w.strength) continue;
    const len = 1.5 + w.strength * 3.5 * (0.6 + r() * 0.6), hgt = 0.3 + w.strength * 0.8 * (0.6 + r() * 0.6);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(len, 0); shape.lineTo(len * 0.25, hgt); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.35 + r() * 0.4, bevelEnabled: false });
    geo.translate(-len * 0.5, 0, -0.2);
    // 尖头朝下风方向（指向巢穴），沿风向排列
    const yaw = Math.atan2(-w.dz, w.dx);
    b.add('ice', geo, r() < 0.5 ? '#e8f4fa' : '#d2e6f1', mat4(x, terrain.heightAt(x, z) - 0.08, z, yaw));
    fins++;
  }
  if (!b.isEmpty()) group.add(b.build('wind-fins'));
  return {
    group,
    update: (t) => {
      funnel.rotation.y = t * 0.9;
    },
  };
}
