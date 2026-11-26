import * as THREE from 'three';
import type { ProbeReport } from './probe';
import { sunVector, type WbTerrain } from './terrain';
import { WB_COLORS, WB_METRICS, type V2, type WbSite } from './types';

/**
 * 白盒的画面：地形（按材质平涂、陡坡压暗）、体块、水面、太阳和阴影，再加一层标注（点位、据点圈、探针实测出来的路线）。
 * 路线画的是探针寻路的结果，不是手画的线：图上有线 = 真走得通。
 */
const MARK = {
  spawn: { color: '#ffffff', shape: 'circle' },
  stronghold: { color: '#fad028', shape: 'circle' },
  exit: { color: '#5adc5a', shape: 'circle' },
  boss: { color: '#e83232', shape: 'circle' },
  guard: { color: '#f5821e', shape: 'diamond' },
  entry: { color: '#e128c8', shape: 'triangle' },
  cache: { color: '#28d7eb', shape: 'square' },
  camp: { color: '#4a8cff', shape: 'square' },
  perch: { color: '#fad028', shape: 'chevron' },
  shade: { color: '#8a7cff', shape: 'circle' },
  summon: { color: '#e128c8', shape: 'circle' },
} as const;
type MarkKind = keyof typeof MARK;

function markTexture(kind: MarkKind, text: string): THREE.CanvasTexture {
  const size = 128, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!, m = MARK[kind], h = size / 2;
  g.lineWidth = 9;
  g.strokeStyle = '#15151a';
  g.fillStyle = m.color;
  g.beginPath();
  if (m.shape === 'circle') g.arc(h, h, h - 12, 0, Math.PI * 2);
  else if (m.shape === 'diamond') { g.moveTo(h, 12); g.lineTo(size - 12, h); g.lineTo(h, size - 12); g.lineTo(12, h); g.closePath(); }
  else if (m.shape === 'triangle') { g.moveTo(h, 12); g.lineTo(size - 14, size - 20); g.lineTo(14, size - 20); g.closePath(); }
  else if (m.shape === 'square') g.rect(22, 22, size - 44, size - 44);
  else { g.moveTo(18, h + 6); g.lineTo(h, h - 30); g.lineTo(size - 18, h + 6); g.moveTo(18, h + 40); g.lineTo(h, h + 4); g.lineTo(size - 18, h + 40); }
  if (m.shape === 'chevron') { g.lineWidth = 20; g.stroke(); g.lineWidth = 10; g.strokeStyle = m.color; g.stroke(); }
  else { g.fill(); g.stroke(); }
  if (text) {
    g.fillStyle = kind === 'boss' ? '#ffffff' : '#15151a';
    g.font = `bold ${text.length > 1 ? 50 : 72}px "Microsoft YaHei", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, h, m.shape === 'triangle' ? h + 14 : h + 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelTexture(text: string): { texture: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement('canvas'), g = c.getContext('2d')!;
  const font = 'bold 44px "Microsoft YaHei", sans-serif';
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 36;
  c.height = 64;
  g.font = font;
  g.fillStyle = 'rgba(20,20,26,0.78)';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#f2ead8';
  g.textBaseline = 'middle';
  g.fillText(text, 18, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { texture: t, aspect: c.width / c.height };
}

const srgb = (c: [number, number, number]): THREE.Color => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

export class WhiteboxView {
  readonly group = new THREE.Group();
  /** 标注层（点位、据点圈、路线、地标名）：整层可开关 */
  readonly overlay = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private readonly sprites: { sprite: THREE.Sprite; aspect: number; label: boolean }[] = [];
  /** 只在看全图的机位（斜俯瞰 / 俯视）显示的东西：路线带、点位标记、据点圈。玩家视角只留地标名 */
  private readonly mapOnly: THREE.Object3D[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(readonly terrain: WbTerrain, readonly report: ProbeReport) {
    const spec = terrain.spec;
    this.group.name = `whitebox-${spec.id}`;
    this.group.add(this.buildTerrain(), this.buildBlocks(), this.overlay);
    for (const w of spec.water ?? []) this.group.add(this.buildWater(w.pts, w.level));

    // 太阳 + 天光：阴影盖住整张图
    const [sx, sy, sz] = sunVector(spec), cx = spec.size[0] / 2, cz = spec.size[1] / 2, span = Math.hypot(spec.size[0], spec.size[1]) / 2 + 20;
    const sun = this.sun = new THREE.DirectionalLight(0xfff2dc, 2.1);
    sun.position.set(cx + sx * 600, sy * 600, cz + sz * 600);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 50, far: 1400 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.35;
    this.group.add(sun, sun.target, new THREE.HemisphereLight(0xdfe6f2, 0xb09a80, 1.9));

    this.buildMarkers();
    this.buildRoutes();
  }

  private buildTerrain(): THREE.Mesh {
    const t = this.terrain, step = 2;   // 画面用 1 m 的网格（行走面是 0.5 m）
    const gx = Math.floor((t.nx - 1) / step) + 1, gz = Math.floor((t.nz - 1) / step) + 1;
    const pos = new Float32Array(gx * gz * 3), col = new Float32Array(gx * gz * 3);
    const palette = Object.fromEntries(Object.entries(WB_COLORS).map(([k, v]) => [k, srgb(v)])) as Record<string, THREE.Color>;
    const c = new THREE.Color(), steep = srgb([0.42, 0.3, 0.27]);
    for (let iz = 0; iz < gz; iz++) {
      for (let ix = 0; ix < gx; ix++) {
        const k = iz * gx + ix, x = ix * step * t.cell, z = iz * step * t.cell;
        const y = t.groundAt(x, z);
        pos.set([x, y, z], k * 3);
        // 坡度表达可走性：> 40° 的面压成暗红褐，一眼看出走不上去
        const slope = Math.hypot(t.groundAt(x + 1, z) - t.groundAt(x - 1, z), t.groundAt(x, z + 1) - t.groundAt(x, z - 1)) / 2;
        c.copy(palette[t.matAt(x, z)]).lerp(steep, THREE.MathUtils.smoothstep(slope, 0.7, 1.0) * 0.75);
        col.set([c.r, c.g, c.b], k * 3);
      }
    }
    const idx = new Uint32Array((gx - 1) * (gz - 1) * 6);
    let n = 0;
    for (let iz = 0; iz < gz - 1; iz++) for (let ix = 0; ix < gx - 1; ix++) {
      const a = iz * gx + ix, b = a + 1, d = a + gx, e = d + 1;
      idx.set([a, d, b, b, d, e], n);
      n += 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'whitebox-terrain';
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  private buildBlocks(): THREE.Group {
    const out = new THREE.Group();
    out.name = 'whitebox-blocks';
    const mats = new Map<string, THREE.MeshLambertMaterial>();
    for (const b of this.terrain.blocks) {
      const h = Math.max(0.05, b.y1 - b.y0);
      const geo = b.kind === 'cyl' ? new THREE.CylinderGeometry(b.size[0], b.size[0], h, 20) : new THREE.BoxGeometry(b.size[0], h, b.size[1]);
      let mat = mats.get(b.mat);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({ color: srgb(WB_COLORS[b.mat]) });
        mats.set(b.mat, mat);
        this.disposables.push(mat);
      }
      this.disposables.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.at[0], (b.y0 + b.y1) / 2, b.at[1]);
      mesh.rotation.y = (b.rot ?? 0) * Math.PI / 180;
      mesh.castShadow = mesh.receiveShadow = true;
      out.add(mesh);
    }
    return out;
  }

  private buildWater(pts: V2[], level: number): THREE.Mesh {
    const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2);   // (x, y) → (x, 0, y)
    const mat = new THREE.MeshBasicMaterial({ color: srgb(WB_COLORS.water), transparent: true, opacity: 0.78, side: THREE.DoubleSide });
    this.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = level;
    return mesh;
  }

  private sprite(texture: THREE.Texture, at: THREE.Vector3, aspect: number, label: boolean): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true });
    this.disposables.push(mat, texture);
    const s = new THREE.Sprite(mat);
    s.position.copy(at);
    s.renderOrder = label ? 30 : 40;
    this.sprites.push({ sprite: s, aspect, label });
    if (!label) this.mapOnly.push(s);
    this.overlay.add(s);
    return s;
  }

  private buildMarkers(): void {
    const t = this.terrain, spec = t.spec;
    const put = (kind: MarkKind, s: WbSite, text: string, lift = 3): void => {
      const y = t.walkAt(s.at[0], s.at[1]);
      this.sprite(markTexture(kind, text), new THREE.Vector3(s.at[0], y + lift, s.at[1]), 1, false);
      // 一根细杆把标记拴在地面上（斜俯瞰时读得出它在哪）
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(s.at[0], y, s.at[1]), new THREE.Vector3(s.at[0], y + lift, s.at[1])]);
      const mat = new THREE.LineBasicMaterial({ color: MARK[kind].color });
      this.disposables.push(geo, mat);
      const pole = new THREE.Line(geo, mat);
      this.mapOnly.push(pole);
      this.overlay.add(pole);
    };
    put('spawn', spec.spawn, 'S');
    for (const s of spec.strongholds) {
      put('stronghold', s, s.id, 4);
      const ring = this.ring(s.at, s.r ?? 26, 0xfad028);
      this.mapOnly.push(ring);
      this.overlay.add(ring);
    }
    for (const s of spec.guards) put('guard', s, '');
    for (const s of spec.caches) put('cache', s, '');
    put('exit', spec.exit, 'E', 4);
    for (const s of spec.entries) {
      put('entry', s, '');
      if (s.from) {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(s.from[0], t.walkAt(s.from[0], s.from[1]) + 0.5, s.from[1]), new THREE.Vector3(s.at[0], t.walkAt(s.at[0], s.at[1]) + 0.5, s.at[1])]);
        const mat = new THREE.LineBasicMaterial({ color: 0xe128c8 });
        this.disposables.push(geo, mat);
        this.overlay.add(new THREE.Line(geo, mat));
      }
    }
    for (const s of spec.extras ?? []) put(s.kind, s, s.kind === 'boss' ? 'B' : s.kind === 'camp' ? '营' : '', s.kind === 'boss' ? 6 : 3);
    for (const b of t.blocks) {
      if (!b.landmark) continue;
      const { texture, aspect } = labelTexture(b.landmark);
      this.sprite(texture, new THREE.Vector3(b.at[0], b.y1 + 9, b.at[1]), aspect, true);
    }
  }

  /** 贴地的圆（据点场地范围） */
  private ring(at: V2, r: number, color: number): THREE.LineLoop {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 96; k++) {
      const a = k / 96 * Math.PI * 2, x = at[0] + Math.cos(a) * r, z = at[1] + Math.sin(a) * r;
      pts.push(new THREE.Vector3(x, this.terrain.walkAt(x, z) + 0.35, z));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts), mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
    this.disposables.push(geo, mat);
    return new THREE.LineLoop(geo, mat);
  }

  /** 探针实测的路线：金色主线 / 白色侧翼，贴地虚线带 + 箭头 */
  private buildRoutes(): void {
    const t = this.terrain;
    for (const route of this.report.routes) {
      if (route.pts.length < 2) continue;
      const main = route.kind === 'main', half = main ? 1.5 : 0.9;
      // 抹掉格子路径的锯齿：两遍 Chaikin
      let pts = route.pts.map(p => new THREE.Vector2(p[0], p[1]));
      for (let k = 0; k < 1; k++) {
        const next: THREE.Vector2[] = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) next.push(pts[i].clone().lerp(pts[i + 1], 0.25), pts[i].clone().lerp(pts[i + 1], 0.75));
        next.push(pts[pts.length - 1]);
        pts = next;
      }
      const pos: number[] = [], idx: number[] = [];
      const dash = main ? 5 : 3.5, gap = main ? 3 : 2.5, arrowEvery = 36;
      let s = 0, nextArrow = 14;
      const lift = (x: number, z: number): number => t.walkAt(x, z) + 0.45;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], len = a.distanceTo(b);
        if (len < 1e-4) continue;
        const dx = (b.x - a.x) / len, dz = (b.y - a.y) / len, nx = -dz * half, nz = dx * half;
        if (s % (dash + gap) < dash) {
          const base = pos.length / 3;
          pos.push(a.x + nx, lift(a.x, a.y), a.y + nz, a.x - nx, lift(a.x, a.y), a.y - nz, b.x + nx, lift(b.x, b.y), b.y + nz, b.x - nx, lift(b.x, b.y), b.y - nz);
          idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
        }
        s += len;
        if (s >= nextArrow) {
          nextArrow += arrowEvery;
          const w = half * 2.6, l = half * 4.2, base = pos.length / 3, y = lift(b.x, b.y) + 0.1;
          pos.push(b.x + dx * l, y, b.y + dz * l, b.x - dz * w, y, b.y + dx * w, b.x + dz * w, y, b.y - dx * w);
          idx.push(base, base + 1, base + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ color: main ? 0xf5c428 : 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false });
      this.disposables.push(geo, mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `route-${route.id}`;
      mesh.renderOrder = main ? 12 : 11;
      this.mapOnly.push(mesh);
      this.overlay.add(mesh);
    }
  }

  /**
   * 标记的屏幕大小：透视相机下 sizeAttenuation=false，scale 是「占画面高度的比例」；正交相机下 scale 是世界单位。
   * 每次换机位调一次。
   */
  fitMarkers(camera: THREE.Camera, playerView = false): void {
    for (const o of this.mapOnly) o.visible = !playerView;
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    const unit = ortho ? ((camera as THREE.OrthographicCamera).top - (camera as THREE.OrthographicCamera).bottom) / (camera as THREE.OrthographicCamera).zoom : 1;
    for (const m of this.sprites) {
      const h = (m.label ? 0.024 : 0.036) * unit;
      (m.sprite.material as THREE.SpriteMaterial).sizeAttenuation = ortho;
      (m.sprite.material as THREE.SpriteMaterial).needsUpdate = true;
      m.sprite.scale.set(h * m.aspect, h, 1);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}

/** 玩家眼高 */
export const WB_EYE = WB_METRICS.eye;
