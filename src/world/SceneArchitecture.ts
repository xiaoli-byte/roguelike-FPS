/** Published building modules, spatially instanced without generating replacement art. */
import * as THREE from 'three';
import { AssetLibrary } from '../assets/AssetLibrary';
import { applyArtEnvironment } from '../assets/ArtEnvironment';
import type { GameContext } from '../core/types';
import type { LevelLayout, SceneArchitecturePlacement } from './LevelTypes';
import { applyHandPaintedEnvironment } from './SceneSurfaceMaterial';

/** One measured envelope for every LOD, including glTF node transforms. */
export function architectureAssetBounds(lods: readonly THREE.Mesh[]): THREE.Box3 {
  const bounds = new THREE.Box3(), point = new THREE.Vector3();
  for (const source of lods) {
    const positions = source.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) bounds.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(source.matrixWorld));
  }
  return bounds;
}

/** Uniform fit preserves doorways, masonry proportions and identical LOD anchors. */
export function architectureMatrix(source: THREE.Mesh, placement: SceneArchitecturePlacement, allBounds: THREE.Box3): THREE.Matrix4 {
  const size = allBounds.getSize(new THREE.Vector3()), envelope = placement.envelope;
  const scale = placement.s * Math.min(envelope.width / Math.max(size.x, 1e-6),
    envelope.height / Math.max(size.y, 1e-6), envelope.depth / Math.max(size.z, 1e-6));
  const transform = new THREE.Object3D();
  transform.position.set(placement.x, placement.y, placement.z);
  transform.rotation.y = placement.yaw; transform.scale.setScalar(scale); transform.updateMatrix();
  const offset = new THREE.Matrix4().makeTranslation(-(allBounds.min.x + allBounds.max.x) / 2,
    -allBounds.min.y, -(allBounds.min.z + allBounds.max.z) / 2);
  return transform.matrix.clone().multiply(offset).multiply(source.matrixWorld);
}

export class SceneArchitecture {
  readonly group = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private readonly built = new Set<string>();
  private readonly materials = new Map<THREE.Material, THREE.Material>();
  private readonly lods: THREE.LOD[] = [];
  private disposed = false;

  constructor(private readonly ctx: GameContext, private readonly layout: LevelLayout) {
    this.group.name = `scene.architecture.${layout.theme}`;
    if (!layout.architecture?.length) return;
    this.build();
    if (layout.architecture.some(a => !this.built.has(a.assetId)))
      void AssetLibrary.preload().then(() => { if (!this.disposed) this.build(); });
  }

  private copyMaterial(original: THREE.Material, assetId: string): THREE.Material {
    const existing = this.materials.get(original);
    if (existing) return existing;
    const material = original.clone();
    if (material instanceof THREE.MeshStandardMaterial) {
      applyArtEnvironment(material, this.ctx.renderer);
      material.envMapIntensity = .38;
      applyHandPaintedEnvironment(material, assetId);
    }
    this.materials.set(original, material); this.owned.push(material); return material;
  }

  private build(): void {
    const placements = this.layout.architecture ?? [];
    for (const assetId of new Set(placements.map(a => a.assetId))) {
      if (this.built.has(assetId)) continue;
      const asset = AssetLibrary.get(assetId);
      if (!asset) continue; // late or absent art creates no procedural substitute
      this.built.add(assetId);
      const matching = placements.filter(a => a.assetId === assetId);
      const low = this.ctx.settings.quality === 'low', finalIndex = asset.lods.length - 1;
      const firstIndex = low ? finalIndex : matching[0].type === 'gate' ? 0 : Math.min(1, finalIndex);
      const indices = Array.from({ length: finalIndex - firstIndex + 1 }, (_, i) => firstIndex + i);
      const bounds = architectureAssetBounds(asset.lods);
      const chunks = new Map<string, SceneArchitecturePlacement[]>();
      for (const placement of matching) {
        const key = `${Math.floor((placement.x - this.layout.center.x) / 18)},${Math.floor((placement.z - this.layout.center.z) / 18)}`;
        let chunk = chunks.get(key);
        if (!chunk) chunks.set(key, chunk = []);
        chunk.push(placement);
      }
      for (const [key, chunk] of chunks) {
        const lod = new THREE.LOD();
        lod.name = `${assetId}.court.${key}`;
        lod.position.set(chunk.reduce((sum, a) => sum + a.x, 0) / chunk.length, 0,
          chunk.reduce((sum, a) => sum + a.z, 0) / chunk.length);
        lod.updateMatrix(); lod.matrixAutoUpdate = false;
        lod.autoUpdate = false;
        const local = new THREE.Matrix4().makeTranslation(-lod.position.x, 0, -lod.position.z);
        for (const [level, index] of indices.entries()) {
          const source = asset.lods[index];
          const material = Array.isArray(source.material)
            ? source.material.map(m => this.copyMaterial(m, asset.id)) : this.copyMaterial(source.material, asset.id);
          const instance = new THREE.InstancedMesh(source.geometry, material, chunk.length);
          instance.name = `${assetId}.court.LOD${index}`;
          instance.castShadow = !low; instance.receiveShadow = true;
          instance.matrixAutoUpdate = false;
          for (let i = 0; i < chunk.length; i++) instance.setMatrixAt(i, local.clone().multiply(architectureMatrix(source, chunk[i], bounds)));
          instance.instanceMatrix.needsUpdate = true;
          instance.computeBoundingBox(); instance.computeBoundingSphere();
          const distance = level === 0 ? 0 : index === finalIndex ? 44 : 20;
          lod.addLevel(instance, distance, .12);
          this.owned.push(instance);
        }
        this.group.add(lod); this.lods.push(lod);
      }
    }
    this.group.updateMatrixWorld(true);
    this.update(this.ctx.camera);
  }

  update(camera: THREE.Camera): void {
    if (this.disposed || !camera) return;
    for (const lod of this.lods) lod.update(camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.group.removeFromParent(); this.group.clear();
    for (const resource of this.owned) resource.dispose();
    this.owned.length = 0; this.materials.clear(); this.built.clear(); this.lods.length = 0;
  }
}
