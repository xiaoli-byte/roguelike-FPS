/**
 * 经幡：横绳上的五色小旗（风马旗）和杆上的竖幡（达觉）。
 * 所有旗子合成一个网格、一次绘制；翻动在顶点着色器里做（aFlap = 离绳 / 杆的距离，aWind = 被吹开的方向）。
 */
import * as THREE from 'three';
import { patchMaterial } from './materials';
import { windAt } from './wind';

/** 蓝、白、红、绿、黄 */
export const FLAG_COLORS = ['#2d5fc0', '#f1eee4', '#c8322c', '#2f9a4c', '#efbf2a'].map(c => new THREE.Color(c));


export class FlagSystem {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private flap: number[] = [];
  private phase: number[] = [];
  private wind: number[] = [];
  /** 风强 0..1（离飞廉越近越大）：旗子抖得更快更猛 */
  private gust: number[] = [];
  private curGust = 0;
  private rope: number[] = [];
  private seed = 7;
  count = 0;

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private vert(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, flap: number, phase: number, w: THREE.Vector3): void {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
    this.flap.push(flap);
    this.phase.push(phase);
    this.wind.push(w.x, w.y, w.z);
    this.gust.push(this.curGust);
  }

  /** 一面旗：上沿 a→b，向下垂 h，分两行以便弯曲 */
  private flag(a: THREE.Vector3, b: THREE.Vector3, h: number, c: THREE.Color, w: THREE.Vector3, phase: number): void {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3(0, -1, 0)).normalize();
    const rows = 2;
    for (let r = 0; r < rows; r++) {
      const f0 = r / rows, f1 = (r + 1) / rows;
      const a0 = a.clone().setY(a.y - h * f0), b0 = b.clone().setY(b.y - h * f0);
      const a1 = a.clone().setY(a.y - h * f1), b1 = b.clone().setY(b.y - h * f1);
      this.vert(a0, n, c, f0, phase, w); this.vert(a1, n, c, f1, phase, w); this.vert(b1, n, c, f1, phase + 0.4, w);
      this.vert(a0, n, c, f0, phase, w); this.vert(b1, n, c, f1, phase + 0.4, w); this.vert(b0, n, c, f0, phase + 0.4, w);
    }
    this.count++;
  }

  /** 悬链线上的一串旗子 */
  addLine(a: THREE.Vector3, b: THREE.Vector3, opts: { sag?: number; spacing?: number; size?: number } = {}): void {
    const span = a.distanceTo(b);
    if (span < 0.5) return;
    const sag = (opts.sag ?? 0.06) * span;
    const spacing = opts.spacing ?? 0.52;
    const size = opts.size ?? 0.46;
    const at = (t: number): THREE.Vector3 => new THREE.Vector3().lerpVectors(a, b, t).setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t));
    // 绳子
    const segs = Math.max(4, Math.ceil(span / 1.5));
    for (let i = 0; i < segs; i++) {
      const p = at(i / segs), q = at((i + 1) / segs);
      this.rope.push(p.x, p.y, p.z, q.x, q.y, q.z);
    }
    // 吹开方向：绳子的水平法线里与当地风向同侧的那个；绳子顺风时吹不开。风场越强吹得越开
    const ws = windAt((a.x + b.x) / 2, (a.z + b.z) / 2);
    const windV = new THREE.Vector3(ws.dx, 0, ws.dz);
    this.curGust = ws.strength;
    const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    if (perp.dot(windV) < 0) perp.negate();
    const strength = (0.12 + 0.3 * Math.abs(perp.dot(windV))) * (1 + 1.6 * ws.strength);
    const w = perp.multiplyScalar(size * (0.4 + strength));
    const n = Math.floor(span / spacing);
    const offset = this.rand() * 5;
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.08) / n, t1 = (i + 0.92) / n;
      const c = FLAG_COLORS[(i + Math.floor(offset)) % 5].clone().multiplyScalar(0.86 + this.rand() * 0.18);
      this.flag(at(t0), at(t1), size * (0.95 + this.rand() * 0.12), c, w, i * 0.55 + offset);
    }
  }

  /** 杆上的竖幡：从 base 往上 h，向 dirAngle 方向展开 width */
  addBanner(base: THREE.Vector3, h: number, width: number, dirAngle: number, color: THREE.Color): void {
    // 竖幡顺着当地风向飘（dirAngle 只在无风处起作用）
    const ws = windAt(base.x, base.z);
    this.curGust = ws.strength;
    const ang = ws.strength > 0.02 ? Math.atan2(ws.dz, ws.dx) : dirAngle;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const n = new THREE.Vector3(-dir.z, 0, dir.x);
    const w = n.clone().multiplyScalar(0.55).add(dir.clone().multiplyScalar(0.15));
    const cols = 4, rows = 6;
    const phase = this.rand() * 6;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const u0 = c / cols, u1 = (c + 1) / cols, v0 = r / rows, v1 = (r + 1) / rows;
      const p = (u: number, v: number) => base.clone().addScaledVector(dir, width * u).setY(base.y + h * v);
      const ph = phase + v0 * 1.4;
      this.vert(p(u0, v0), n, color, u0, ph, w); this.vert(p(u1, v0), n, color, u1, ph, w); this.vert(p(u1, v1), n, color, u1, ph + 0.3, w);
      this.vert(p(u0, v0), n, color, u0, ph, w); this.vert(p(u1, v1), n, color, u1, ph + 0.3, w); this.vert(p(u0, v1), n, color, u0, ph + 0.3, w);
    }
    this.count++;
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'flags';
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('aFlap', new THREE.Float32BufferAttribute(this.flap, 1));
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.phase, 1));
    geo.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 3));
    geo.setAttribute('aGust', new THREE.Float32BufferAttribute(this.gust, 1));
    geo.computeBoundingSphere();
    // 翻动位移超出包围球，关掉视锥剔除以免在画面边缘闪没
    const mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { flutter: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    const ropeGeo = new THREE.BufferGeometry();
    ropeGeo.setAttribute('position', new THREE.Float32BufferAttribute(this.rope, 3));
    const ropes = new THREE.LineSegments(ropeGeo, new THREE.LineBasicMaterial({ color: '#3a3128' }));
    ropes.frustumCulled = false;
    group.add(ropes);
    return group;
  }
}
