/** 三章 Hunyuan3D 场景道具与轻量大气。共享几何与贴图，材质按场景复用。 */
import * as THREE from 'three';
import type { GameContext, ThemeId } from '../core/types';
import { AssetLibrary } from '../assets/AssetLibrary';
import { applyArtEnvironment } from '../assets/ArtEnvironment';
import type { Deco, LevelLayout } from './LevelTypes';
import type { ThemeStyle } from './Themes';
import type { FlameSpot } from './Props';
import { PROP_COLLIDER } from './LevelGen';
import { fitLandmarkTransform, fitNaturalPropScale, fitScenePropScale } from './ScenePropFit';
import { applyHandPaintedEnvironment } from './SceneSurfaceMaterial';

export const SCENE_PROP_IDS: Readonly<Record<ThemeId, Partial<Record<Deco['kind'], string>>>> = {
  desert: { statue: 'SM_Prop_DesertReliquary', pots: 'SM_Prop_DesertUrns', rock: 'SM_Env_DesertSandstone', landmark: 'SM_Env_DesertRuin' },
  frost: { stoneLantern: 'SM_Prop_FrostShrine', crystal: 'SM_Prop_FrostPrayerCairn', pine: 'SM_Env_FrostPine', landmark: 'SM_Env_FrostWayshrine' },
  inferno: { brazier: 'SM_Prop_InfernoCrucible', crystal: 'SM_Prop_InfernoChainObelisk', spike: 'SM_Prop_InfernoChainObelisk', rock: 'SM_Env_InfernoBasalt', landmark: 'SM_Env_InfernoFoundry' },
};

interface Haze { mesh: THREE.Mesh; x: number; z: number; phase: number }
interface Contact { x: number; y: number; z: number; yaw: number; w: number; d: number }

export class SceneDressing {
  readonly group = new THREE.Group();
  readonly replaced = new Set<Deco>();
  private readonly owned: { dispose(): void }[] = [];
  private readonly haze: Haze[] = [];
  private readonly materialCopies = new Map<THREE.Material, THREE.Material>();
  private readonly landmarkBounds = new Map<string, { min: number[]; max: number[] }>();
  private radialMap: THREE.CanvasTexture | null = null;
  private disposed = false;

  constructor(ctx: GameContext, L: LevelLayout, st: ThemeStyle, rand: () => number, flames: FlameSpot[]) {
    this.group.name = `scene.details.${L.theme}`;
    const contacts: Contact[] = [];
    const shrines: { x: number; y: number; z: number; scale: number }[] = [];
    const naturalBounds = new Map<string, { min: number[]; max: number[]; radius: number }>();
    const pendingLandmarks: Deco[] = [];
    // 模型只实例化已发布的 Hunyuan 资产，陈设与碰撞已在布局生成阶段校验。
    for (const d of L.decos) {
      if (d.kind === 'landmark') {
        const contact = this.attachLandmark(ctx, L, d);
        if (contact) contacts.push(contact);
        else pendingLandmarks.push(d);
        continue;
      }
      const id = SCENE_PROP_IDS[L.theme][d.kind];
      const asset = id ? AssetLibrary.get(id) : null;
      if (!asset) continue;
      const lod = new THREE.LOD();
      lod.name = `${asset.id}.${d.sceneRole ?? 'cover'}`;
      lod.position.set(d.x, d.y, d.z);
      lod.rotation.y = d.yaw;
      const natural = asset.entry.class === 'nature_prop' && (d.kind === 'pine' || d.kind === 'rock');
      if (natural && !naturalBounds.has(asset.id)) {
        // A measured radius keeps sparse crowns tall; using the AABB diagonal would shrink them.
        const vertex = new THREE.Vector3(), bounds = new THREE.Box3(); let radius = 0;
        for (const source of asset.lods) {
          const positions = source.geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i).applyMatrix4(source.matrixWorld);
            bounds.expandByPoint(vertex);
            radius = Math.max(radius, Math.hypot(vertex.x, vertex.z));
          }
        }
        // Decimation can slightly expand a distant LOD; include every level in the visual envelope.
        naturalBounds.set(asset.id, { min: bounds.min.toArray(), max: bounds.max.toArray(), radius });
      }
      const measured = naturalBounds.get(asset.id);
      const scale = natural
        ? fitNaturalPropScale(measured ?? asset.entry.bounds, d.s, d.kind as 'pine' | 'rock', measured?.radius)
        : fitScenePropScale(asset.entry.bounds, d.yaw, d.s, PROP_COLLIDER[d.kind]);
      lod.scale.setScalar(scale);
      const low = ctx.settings.quality === 'low';
      asset.lods.forEach((src, i) => {
        if (low && i === 0 && asset.lods.length > 1) return;
        const copy = (source: THREE.Material): THREE.Material => {
          const cached = this.materialCopies.get(source);
          if (cached) return cached;
          const material = source.clone();
          if (material instanceof THREE.MeshStandardMaterial) {
            applyArtEnvironment(material, ctx.renderer);
            material.envMapIntensity = L.theme === 'inferno' ? 0.72 : L.theme === 'frost' ? 0.62 : 0.52;
            material.roughness = Math.max(0.48, Math.min(1, material.roughness));
            applyHandPaintedEnvironment(material, asset.id);
          }
          this.materialCopies.set(source, material); this.owned.push(material);
          return material;
        };
        const material = Array.isArray(src.material) ? src.material.map(copy) : copy(src.material);
        const mesh = new THREE.Mesh(src.geometry, material);
        mesh.name = src.name;
        mesh.castShadow = !low && d.sceneLayer !== 'accent';
        mesh.receiveShadow = true;
        mesh.applyMatrix4(src.matrixWorld);
        mesh.matrixAutoUpdate = false;
        let distance = low && i === 1 ? 0 : asset.entry.lodDistance[i] ?? i * 20;
        if (natural && d.kind === 'rock') distance *= Math.max(.15, scale);
        lod.addLevel(mesh, distance);
      });
      lod.updateMatrix(); lod.matrixAutoUpdate = false;
      this.group.add(lod);
      this.replaced.add(d);
      const bounds = asset.entry.bounds;
      contacts.push({ x: d.x, y: d.y, z: d.z, yaw: d.yaw, w: (bounds.max[0] - bounds.min[0]) * scale, d: (bounds.max[2] - bounds.min[2]) * scale });
      if (d.kind === 'stoneLantern') shrines.push({ x: d.x, y: d.y + bounds.max[1] * scale * 0.53, z: d.z, scale });
      if (d.kind === 'brazier') flames.push({ x: d.x, y: d.y + asset.entry.bounds.max[1] * scale * 0.85, z: d.z, s: scale });
    }
    // 接触阴影和灯龛辉光是平面渲染效果，低画质也保留贴地层次，不增加点光源。
    if (contacts.length) this.contactShadows(contacts);
    this.surfacePatina(L, st, contacts, rand);
    if (shrines.length) this.shrineGlow(shrines, st);
    if (ctx.settings.quality !== 'low') this.atmosphere(L, st, rand);
    // A fast start can precede the background GLB load. Only these new landmarks
    // retry after preload; no placeholder art is generated while they are absent.
    if (pendingLandmarks.length) void AssetLibrary.preload().then(() => {
      if (this.disposed) return;
      const lateContacts = pendingLandmarks.map(d => this.attachLandmark(ctx, L, d)).filter((p): p is Contact => !!p);
      if (lateContacts.length) {
        this.contactShadows(lateContacts);
        this.surfacePatina(L, st, lateContacts, rand, false);
      }
    });
  }

  private attachLandmark(ctx: GameContext, L: LevelLayout, d: Deco): Contact | null {
    if (!d.footprint || this.replaced.has(d)) return null;
    const id = SCENE_PROP_IDS[L.theme].landmark, asset = id ? AssetLibrary.get(id) : null;
    if (!asset) return null;
    let bounds = this.landmarkBounds.get(asset.id);
    if (!bounds) {
      const measured = new THREE.Box3(), point = new THREE.Vector3();
      for (const source of asset.lods) {
        const positions = source.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) measured.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(source.matrixWorld));
      }
      if (measured.isEmpty()) return null;
      bounds = { min: measured.min.toArray(), max: measured.max.toArray() };
      this.landmarkBounds.set(asset.id, bounds);
    }
    const fit = fitLandmarkTransform(bounds, d.footprint), scale = fit.scale * d.s;
    const offset = new THREE.Matrix4().makeTranslation(...fit.offset);
    const lod = new THREE.LOD();
    lod.name = `${asset.id}.${d.sceneRole ?? 'alcove'}`;
    lod.position.set(d.x, d.y, d.z); lod.rotation.y = d.yaw; lod.scale.setScalar(scale);
    const low = ctx.settings.quality === 'low';
    const copyMaterial = (source: THREE.Material): THREE.Material => {
      const cached = this.materialCopies.get(source);
      if (cached) return cached;
      const material = source.clone();
      if (material instanceof THREE.MeshStandardMaterial) {
        applyArtEnvironment(material, ctx.renderer);
        material.envMapIntensity = L.theme === 'inferno' ? .72 : L.theme === 'frost' ? .62 : .52;
        material.roughness = Math.max(.48, Math.min(1, material.roughness));
        applyHandPaintedEnvironment(material, asset.id);
      }
      this.materialCopies.set(source, material); this.owned.push(material);
      return material;
    };
    asset.lods.forEach((source, index) => {
      if (low && index === 0 && asset.lods.length > 1) return;
      const material = Array.isArray(source.material) ? source.material.map(copyMaterial) : copyMaterial(source.material);
      const mesh = new THREE.Mesh(source.geometry, material);
      mesh.name = source.name; mesh.castShadow = !low; mesh.receiveShadow = true;
      mesh.applyMatrix4(offset.clone().multiply(source.matrixWorld)); mesh.matrixAutoUpdate = false;
      const distance = low && index === 1 ? 0 : index === 0 ? 0 : index === 1 ? 20 : low ? 30 : 42;
      lod.addLevel(mesh, distance, .1);
    });
    lod.updateMatrix(); lod.matrixAutoUpdate = false;
    this.group.add(lod); this.replaced.add(d);
    return { x: d.x, y: d.y, z: d.z, yaw: d.yaw,
      w: (bounds.max[0] - bounds.min[0]) * scale, d: (bounds.max[2] - bounds.min[2]) * scale };
  }

  private radialTexture(): THREE.CanvasTexture {
    if (this.radialMap) return this.radialMap;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d')!;
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.48)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient; g.fillRect(0, 0, 64, 64);
    const map = new THREE.CanvasTexture(canvas);
    this.owned.push(map);
    this.radialMap = map; return map;
  }

  /** Flat material overlays tie the existing art into its terrain; these are not art meshes. */
  private surfacePatina(L: LevelLayout, st: ThemeStyle, contacts: Contact[], rand: () => number, includeWalls = true): void {
    const spots = contacts.filter(p => Math.abs(p.y - L.floorY) < 0.1).map(p => ({
      x: p.x, z: p.z, yaw: p.yaw + rand() * 0.6,
      w: Math.max(1.4, p.w * 2.1), d: Math.max(1.2, p.d * 1.7),
    }));
    for (const wall of includeWalls ? L.boxes.filter(b => b.look === 'wall') : []) {
      const alongX = wall.maxX - wall.minX > wall.maxZ - wall.minZ;
      const length = alongX ? wall.maxX - wall.minX : wall.maxZ - wall.minZ;
      const n = Math.max(1, Math.floor(length / 6.5));
      for (let i = 0; i < n; i++) {
        const fraction = (i + 0.3 + rand() * 0.4) / n;
        const x = alongX ? wall.minX + fraction * length : wall.minX < L.center.x ? wall.maxX + 0.6 : wall.minX - 0.6;
        const z = alongX ? wall.minZ < L.center.z ? wall.maxZ + 0.6 : wall.minZ - 0.6 : wall.minZ + fraction * length;
        spots.push({ x, z, yaw: alongX ? 0 : Math.PI / 2, w: 4 + rand() * 3, d: 1.8 + rand() * 1.2 });
      }
    }
    if (!spots.length) return;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d')!;
    const fade = g.createRadialGradient(64, 64, 7, 64, 64, 63);
    fade.addColorStop(0, 'rgba(255,255,255,.72)');
    fade.addColorStop(0.5, 'rgba(255,255,255,.46)'); fade.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = fade; g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 1200; i++) {
      g.fillStyle = `rgba(0,0,0,${0.15 + rand() * 0.4})`;
      g.fillRect(rand() * 128, rand() * 128, 1 + rand() * 3, 1 + rand() * 2);
    }
    const map = new THREE.CanvasTexture(canvas);
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map,
      color: L.theme === 'desert' ? st.sand : L.theme === 'frost' ? st.snow : 0x96879e,
      opacity: L.theme === 'frost' ? 0.36 : 0.22, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    mesh.name = 'scene.surfacePatina';
    const o = new THREE.Object3D();
    spots.forEach((s, i) => {
      o.position.set(s.x, L.floorY + 0.008, s.z); o.rotation.y = s.yaw; o.scale.set(s.w, 1, s.d);
      o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    // Draw this translucent colour layer before the tighter contact shadows.
    mesh.renderOrder = -1;
    this.group.add(mesh); this.owned.push(map, geo, mat, mesh);
  }

  private contactShadows(spots: Contact[]): void {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: this.radialTexture(), color: 0x1b1715, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    mesh.name = 'scene.contactShadows';
    const o = new THREE.Object3D();
    spots.forEach((s, i) => {
      o.position.set(s.x, s.y + 0.012, s.z);
      o.rotation.y = s.yaw;
      o.scale.set(Math.max(0.25, s.w * 1.2), 1, Math.max(0.25, s.d * 1.2));
      o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    this.owned.push(geo, mat, mesh);
  }

  private shrineGlow(spots: { x: number; y: number; z: number; scale: number }[], st: ThemeStyle): void {
    const mat = new THREE.SpriteMaterial({ map: this.radialTexture(), color: st.glow, opacity: 0.22, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.owned.push(mat);
    for (const s of spots) {
      const glow = new THREE.Sprite(mat);
      glow.name = 'scene.shrineGlow';
      glow.position.set(s.x, s.y, s.z);
      glow.scale.setScalar(s.scale * 0.72);
      this.group.add(glow);
    }
  }

  private atmosphere(L: LevelLayout, st: ThemeStyle, rand: () => number): void {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    const g = canvas.getContext('2d')!;
    g.scale(2, 1);
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.32)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient; g.fillRect(0, 0, 64, 64);
    const map = new THREE.CanvasTexture(canvas);
    const geo = new THREE.PlaneGeometry(14, 2.4);
    const material = new THREE.MeshBasicMaterial({ map, color: st.cloud.color, transparent: true, opacity: L.theme === 'inferno' ? 0.045 : 0.035, depthWrite: false, side: THREE.DoubleSide });
    this.owned.push(map, geo, material);
    for (let side = 0; side < 4; side++) {
      const a = side * Math.PI / 2;
      for (let i = 0; i < 2; i++) {
        const mesh = new THREE.Mesh(geo, material);
        const along = (i === 0 ? -1 : 1) * L.half * 0.42;
        mesh.position.set(L.center.x + Math.sin(a) * (L.half - 0.6) + Math.cos(a) * along, L.floorY + 1.15, L.center.z + Math.cos(a) * (L.half - 0.6) - Math.sin(a) * along);
        mesh.rotation.y = a;
        this.group.add(mesh);
        this.haze.push({ mesh, x: mesh.position.x, z: mesh.position.z, phase: rand() * 6 });
      }
    }
  }

  update(time: number): void {
    for (const h of this.haze) {
      h.mesh.position.x = h.x + Math.sin(time * 0.18 + h.phase) * 0.75;
      h.mesh.position.z = h.z + Math.cos(time * 0.15 + h.phase) * 0.75;
    }

  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.group.clear();
    for (const resource of this.owned) resource.dispose();
    this.owned.length = 0;
    this.materialCopies.clear(); this.landmarkBounds.clear(); this.radialMap = null;
  }
}
