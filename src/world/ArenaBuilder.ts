/**
 * 把 LevelLayout 搭成场景：
 *  - 结构与装饰按材质合批（每种材质一个网格），地面为顶点色 + 程序化贴图的大平面；
 *  - 半球光 + 平行光（阴影相机按竞技场包围盒精确拟合）+ 恒定 4 盏闪烁点光源；
 *  - 雾、天空穹顶、远山、环境粒子、地面法阵、火盆火焰（实例化网格动画）。
 * 所有本关创建的几何体 / 材质 / 纹理都登记在 disposables，dispose() 时统一释放。
 * 另提供 addCollision：把布局盒子写入碰撞世界（地面一整块大盒子，顶面 y = floorY）。
 */
import * as THREE from 'three';
import type { GameContext, ThemeDef } from '../core/types';
import type { CollisionWorld } from './Collision';
import type { MatKey } from './Batch';
import { GeoBatch } from './Batch';
import type { LevelLayout } from './LevelGen';
import { drawProps, type FlameSpot } from './Props';
import { Particles, SkyDome, drawFarRing } from './Sky';
import { drawStructures } from './Structures';
import { makeFloorTextures, makeRuneTexture, makeStoneTexture, makeWoodTexture } from './Textures';
import type { ThemeStyle } from './Themes';
import { themeStyle } from './Themes';

type Rand = () => number;

interface Disposable { dispose(): void }

/** 布局 → 碰撞世界 */
export function addCollision(world: CollisionWorld, L: LevelLayout): void {
  const pad = L.wallThickness + 12;
  world.addBox(L.minX - pad, L.floorY - 4, L.minZ - pad, L.maxX + pad, L.floorY, L.maxZ + pad, 'floor');
  for (const b of L.boxes) world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
}

// 火焰几何（模块级缓存，永不释放）
let flameGeo: THREE.ConeGeometry | null = null;
let runeGeo: THREE.CircleGeometry | null = null;
const _obj = new THREE.Object3D();

function hash2(x: number, z: number, s: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/** 平滑值噪声 0..1 */
function vnoise(x: number, z: number, s: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s);
  const b = hash2(ix + 1, iz, s);
  const c = hash2(ix, iz + 1, s);
  const d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

interface Lamp { light: THREE.PointLight; base: number; phase: number; flicker: number }
interface Rune { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; speed: number; base: number }

export class ArenaView {
  readonly group = new THREE.Group();
  private readonly disposables: Disposable[] = [];
  private readonly lamps: Lamp[] = [];
  private readonly runes: Rune[] = [];
  private readonly flameSpots: FlameSpot[] = [];
  private flameOuter: THREE.InstancedMesh | null = null;
  private flameInner: THREE.InstancedMesh | null = null;
  private floorMat: THREE.MeshStandardMaterial | null = null;
  private readonly sky: SkyDome;
  private readonly particles: Particles;
  private readonly st: ThemeStyle;
  private disposed = false;

  constructor(private readonly ctx: GameContext, private readonly L: LevelLayout, private readonly theme: ThemeDef, rand: Rand) {
    this.group.name = 'arena';
    const st = themeStyle(L.theme);
    this.st = st;
    const center = new THREE.Vector3(L.center.x, L.floorY, L.center.z);

    // ── 合批几何 ──
    const mats = this.makeMaterials(rand);
    const batch = new GeoBatch(rand);
    drawStructures(batch, L, st, rand);
    drawProps(batch, L, st, rand, this.flameSpots);
    drawFarRing(batch, L, theme, st, rand);
    for (const mesh of batch.build(mats)) {
      this.group.add(mesh);
      this.disposables.push(mesh.geometry);
    }

    this.buildFloor(rand);
    this.buildRunes(rand);
    this.buildFlames();
    this.buildLights(center);

    this.sky = new SkyDome(theme, st, center);
    this.group.add(this.sky.mesh);
    this.disposables.push(this.sky);

    this.particles = new Particles(st, ctx.settings.quality, rand);
    this.group.add(this.particles.points);
    this.disposables.push(this.particles);
  }

  // ───────────── 材质 ─────────────

  private makeMaterials(rand: Rand): Record<MatKey, THREE.Material> {
    const stoneTex = makeStoneTexture(rand);
    const woodTex = makeWoodTexture(rand);
    this.disposables.push(stoneTex, woodTex);
    const std = (p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, metalness: 0, ...p });
    const mats: Record<MatKey, THREE.Material> = {
      stone: std({ map: stoneTex, roughness: 0.92 }),
      rough: std({ roughness: 0.95 }),
      wood: std({ map: woodTex, roughness: 0.85 }),
      lacquer: std({ roughness: 0.42, metalness: 0.05 }),
      metal: std({ roughness: 0.38, metalness: 0.45 }),
      gloss: std({ roughness: 0.16, metalness: 0.2 }),
      cloth: std({ roughness: 1, side: THREE.DoubleSide }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      far: std({ roughness: 1 }),
    };
    for (const k of Object.keys(mats) as MatKey[]) this.disposables.push(mats[k]);
    return mats;
  }

  // ───────────── 地面 ─────────────

  private buildFloor(rand: Rand): void {
    const L = this.L;
    const st = this.st;
    const ext = L.half + L.wallThickness + 1;
    const size = ext * 2;
    const segs = 48;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const tex = makeFloorTextures(L.theme, this.theme, st, rand);
    this.disposables.push(geo, tex.map);
    if (tex.emissive) this.disposables.push(tex.emissive);

    // 世界坐标 UV + 大尺度明暗噪声 + 墙根暗角
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const seed = rand() * 100;
    const H = L.half;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + L.center.x;
      const z = pos.getZ(i) + L.center.z;
      uv.setXY(i, x / tex.tile, -z / tex.tile);
      let f = 0.9 + (vnoise(x * 0.07, z * 0.07, seed) - 0.5) * 0.22 + (vnoise(x * 0.31, z * 0.31, seed + 3) - 0.5) * 0.1;
      const edge = Math.min(H - Math.abs(x - L.center.x), H - Math.abs(z - L.center.z));
      const e = Math.max(0, Math.min(1, edge / 2.6));
      f *= 0.7 + 0.3 * e * e * (3 - 2 * e);
      col[i * 3] = f;
      col[i * 3 + 1] = f;
      col[i * 3 + 2] = f;
    }
    uv.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.MeshStandardMaterial({
      map: tex.map,
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      emissive: tex.emissive ? 0xffffff : 0x000000,
      emissiveMap: tex.emissive,
      emissiveIntensity: tex.emissive ? st.floorGlow * 1.2 : 0,
    });
    this.floorMat = mat;
    this.disposables.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'floor';
    mesh.position.set(L.center.x, L.floorY, L.center.z);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
  }

  /** 地面法阵（纯装饰，缓慢旋转） */
  private buildRunes(rand: Rand): void {
    if (this.L.runes.length === 0) return;
    if (!runeGeo) {
      runeGeo = new THREE.CircleGeometry(1, 64);
      runeGeo.rotateX(-Math.PI / 2);
    }
    const tex = makeRuneTexture(rand);
    this.disposables.push(tex);
    for (const r of this.L.runes) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: r.gold ? this.st.gold : this.theme.accent,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.disposables.push(mat);
      const mesh = new THREE.Mesh(runeGeo, mat);
      mesh.position.set(r.x, this.L.floorY + 0.03, r.z);
      mesh.scale.setScalar(r.r);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.runes.push({ mesh, mat, speed: (rand() < 0.5 ? -1 : 1) * (0.04 + rand() * 0.04), base: 0.42 + rand() * 0.12 });
    }
  }

  // ───────────── 火焰 ─────────────

  private buildFlames(): void {
    const n = this.flameSpots.length;
    if (n === 0) return;
    if (!flameGeo) {
      flameGeo = new THREE.ConeGeometry(0.28, 0.9, 6, 1, true);
      flameGeo.translate(0, 0.45, 0);
    }
    const outerMat = new THREE.MeshBasicMaterial({ color: this.st.glow, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const innerMat = new THREE.MeshBasicMaterial({ color: this.st.glowHot, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.disposables.push(outerMat, innerMat);
    this.flameOuter = new THREE.InstancedMesh(flameGeo, outerMat, n);
    this.flameInner = new THREE.InstancedMesh(flameGeo, innerMat, n);
    for (const m of [this.flameOuter, this.flameInner]) {
      m.frustumCulled = false;
      m.renderOrder = 3;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      this.disposables.push(m);
    }
    this.updateFlames(0);
  }

  private updateFlames(t: number): void {
    const outer = this.flameOuter;
    const inner = this.flameInner;
    if (!outer || !inner) return;
    for (let i = 0; i < this.flameSpots.length; i++) {
      const f = this.flameSpots[i];
      const k = 1 + 0.2 * Math.sin(t * 11 + i * 1.7) + 0.09 * Math.sin(t * 27.3 + i * 3.1);
      const w = 1 - 0.07 * Math.sin(t * 13.7 + i);
      _obj.position.set(f.x, f.y, f.z);
      _obj.rotation.set(0.07 * Math.sin(t * 5.1 + i), t * 0.8 + i, 0.07 * Math.cos(t * 4.3 + i));
      _obj.scale.set(f.s * w * 1.35, f.s * k * 1.25, f.s * w * 1.35);
      _obj.updateMatrix();
      outer.setMatrixAt(i, _obj.matrix);
      _obj.scale.set(f.s * w * 0.7, f.s * k * 0.75, f.s * w * 0.7);
      _obj.rotation.y = -t * 1.3 + i;
      _obj.updateMatrix();
      inner.setMatrixAt(i, _obj.matrix);
    }
    outer.instanceMatrix.needsUpdate = true;
    inner.instanceMatrix.needsUpdate = true;
  }

  // ───────────── 灯光 ─────────────

  private buildLights(center: THREE.Vector3): void {
    const L = this.L;
    const st = this.st;
    const theme = this.theme;
    const ctx = this.ctx;

    const hemi = new THREE.HemisphereLight(st.hemiSky, st.hemiGround, st.hemiIntensity);
    this.group.add(hemi);

    const sun = new THREE.DirectionalLight(theme.sun, st.sunIntensity);
    const dir = new THREE.Vector3(st.sunDir[0], st.sunDir[1], st.sunDir[2]).normalize();
    sun.position.copy(center).addScaledVector(dir, 110);
    sun.target.position.copy(center);
    this.group.add(sun, sun.target);
    this.disposables.push(sun);

    const quality = ctx.settings.quality;
    if (quality !== 'low') {
      sun.castShadow = true;
      const size = quality === 'high' ? 2048 : 1024;
      sun.shadow.mapSize.set(size, size);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.035;
      // 把竞技场（含围墙与墙顶装饰）的 8 个角投到光源视空间，精确拟合正交阴影相机
      const cam = sun.shadow.camera;
      const probe = new THREE.OrthographicCamera();
      probe.position.copy(sun.position);
      probe.lookAt(center);
      probe.updateMatrixWorld(true);
      const inv = probe.matrixWorldInverse;
      const e = L.half + L.wallThickness + 1;
      const top = L.floorY + L.wallHeight + 4.5;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      const p = new THREE.Vector3();
      for (const x of [center.x - e, center.x + e]) {
        for (const y of [L.floorY - 0.5, top]) {
          for (const z of [center.z - e, center.z + e]) {
            p.set(x, y, z).applyMatrix4(inv);
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
            minZ = Math.min(minZ, p.z);
            maxZ = Math.max(maxZ, p.z);
          }
        }
      }
      cam.left = minX;
      cam.right = maxX;
      cam.bottom = minY;
      cam.top = maxY;
      cam.near = Math.max(0.5, -maxZ - 2);
      cam.far = -minZ + 2;
      cam.updateProjectionMatrix();
    }

    // 恒定 4 盏点光源（数量不变，换关不触发着色器重编译）
    const flickerAmt = L.theme === 'frost' ? 0.35 : 1;
    for (let i = 0; i < L.lights.length; i++) {
      const s = L.lights[i];
      const light = new THREE.PointLight(st.lampColor, st.lampIntensity, 18, 1.4);
      light.position.set(s.x, s.y, s.z);
      light.castShadow = false;
      this.group.add(light);
      this.disposables.push(light);
      this.lamps.push({ light, base: st.lampIntensity, phase: i * 2.17, flicker: flickerAmt });
    }

    ctx.scene.fog = new THREE.Fog(theme.fogColor, st.fogNear, st.fogFar);
  }

  // ───────────── 每帧 ─────────────

  update(_dt: number, t: number): void {
    if (this.disposed) return;
    for (const l of this.lamps) {
      const f = 0.1 * Math.sin(t * 9.3 + l.phase) + 0.06 * Math.sin(t * 23.1 + l.phase * 2.3) + 0.04 * Math.sin(t * 3.7 + l.phase);
      l.light.intensity = l.base * (1 + f * l.flicker);
    }
    this.updateFlames(t);
    for (const r of this.runes) {
      r.mesh.rotation.y = t * r.speed;
      r.mat.opacity = r.base * (0.8 + 0.2 * Math.sin(t * 1.3 + r.speed * 40));
    }
    if (this.floorMat && this.st.floorGlow > 0) {
      this.floorMat.emissiveIntensity = this.st.floorGlow * (1.15 + 0.35 * Math.sin(t * 1.4) + 0.1 * Math.sin(t * 3.9));
    }
    this.sky.update(t);
    const canvas = this.ctx.renderer.domElement;
    this.particles.update(t, this.ctx.camera, canvas.height || 1080);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch (err) {
        console.error('[ArenaView] dispose failed', err);
      }
    }
    this.disposables.length = 0;
    this.lamps.length = 0;
    this.runes.length = 0;
    this.group.clear();
    if (this.ctx.scene.fog) this.ctx.scene.fog = null;
  }
}
