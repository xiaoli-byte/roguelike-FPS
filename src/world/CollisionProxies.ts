/**
 * Visible stand-ins for collision that only published art draws.
 *
 * Published walls, gates and landmarks have no procedural substitute, but their collision boxes are
 * always added. With art disabled (`?classic`), a failed GLB/Draco decode, or a missing manifest
 * entry, the player would collide with nothing visible. This draws plain stone blocks for exactly
 * those boxes while any of their models is absent, and hides them once every model has loaded.
 */
import * as THREE from 'three';
import { AssetLibrary } from '../assets/AssetLibrary';
import type { LevelLayout } from './LevelTypes';
import { SCENE_PROP_IDS } from './SceneDressing';

/** Box tags whose only visible surface is published art. */
export const ART_ONLY_COLLIDER_TAGS: readonly string[] = ['architecture-wall', 'architecture-gate', 'landmark'];

/** Published models this layout's art-only colliders depend on. */
export function artOnlyAssetIds(L: LevelLayout): string[] {
  const ids = new Set((L.architecture ?? []).map(a => a.assetId));
  const landmark = SCENE_PROP_IDS[L.theme]?.landmark;
  if (landmark && L.decos.some(d => d.kind === 'landmark')) ids.add(landmark);
  return [...ids];
}

export function artIsMissing(ids: readonly string[]): boolean {
  return !AssetLibrary.enabled || ids.some(id => !AssetLibrary.get(id));
}

export class CollisionProxies {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly material: THREE.MeshStandardMaterial;
  private disposed = false;

  constructor(L: LevelLayout, color: number) {
    this.group.name = 'scene.collisionProxies';
    this.material = new THREE.MeshStandardMaterial({ color, roughness: .92, metalness: 0 });
    const boxes = L.boxes.filter(b => b.look === 'collider' && ART_ONLY_COLLIDER_TAGS.includes(b.tag));
    const ids = artOnlyAssetIds(L);
    if (!boxes.length || !ids.length) return;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, boxes.length);
    mesh.name = 'scene.collisionProxies.blocks';
    const m = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), q = new THREE.Quaternion();
    boxes.forEach((b, i) => {
      position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      scale.set(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
      mesh.setMatrixAt(i, m.compose(position, q, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    this.group.visible = artIsMissing(ids);
    // Settled loading decides once; anything still missing keeps its readable stand-in.
    void AssetLibrary.preload().then(() => { if (!this.disposed) this.group.visible = artIsMissing(ids); },
      () => { if (!this.disposed) this.group.visible = true; });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent(); this.group.clear();
    this.geometry.dispose(); this.material.dispose();
  }
}
