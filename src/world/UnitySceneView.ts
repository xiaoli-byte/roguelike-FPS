import * as THREE from 'three';
import type { GameContext } from '../core/types';
import { UnityLevelLibrary, unityPoint, unityQuaternion, type UnitySceneDocument } from './UnityLevelLibrary';
import type { AuthoredInspectionView } from './AuthoredSceneLayout';
import { UnityEnvironmentView } from './UnityEnvironment';
import { applyUnityTerrain } from './UnityTerrain';
import { applyUnityMaterial, applyUnityMaterialQuality } from './UnityMaterials';
import { createUnityTerrainMesh } from './UnityTerrainMesh';
import { createUnityVegetation } from './UnityVegetation';
import { loadUnityColliders } from './UnityColliders';
import { UnityGroundCoverView } from './UnityGroundCover';
import { UnityPlatformView } from './UnityPlatforms';
import { UnityWaterView } from './UnityWater';
import { UnityActivatorSystem } from './UnityActivators';
import { renderUnityWaterDepth } from './UnityWaterMaterial';

export class UnitySceneView {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  readonly artInspectionViews: AuthoredInspectionView[] = [];
  readonly artBrief: string;
  private readonly environment: UnityEnvironmentView | null;
  private readonly animatedMaterials = new Set<THREE.ShaderMaterial>();
  private readonly ownedMaterials = new Set<THREE.Material>();
  private readonly groundCover = new UnityGroundCoverView();
  private disposed = false;
  private readonly platforms: UnityPlatformView[] = [];
  private water: UnityWaterView | null = null;
  private activators: UnityActivatorSystem | null = null;

  constructor(private readonly ctx: GameContext, private readonly document: UnitySceneDocument, features: { environment?: boolean; groundCover?: boolean; colliders?: boolean; reportEnvironment?: (stage: string) => void } = {}) {
    this.group.name = `unity-scene-${document.id}`;
    this.artBrief = document.title;
    this.environment = features.environment === false ? null
      : new UnityEnvironmentView(ctx, document.environment, this.group, features.reportEnvironment, { chapter: Number.parseInt(document.id, 10) || 1, baseY: unityAtmosphereBaseY(document) });
    this.ready = Promise.all([
      UnityLevelLibrary.preload(document), this.environment?.ready,
      features.colliders === false ? Promise.resolve() : loadUnityColliders(document, ctx.world),
    ]).then(async () => {
      if (this.disposed) return;
      const roots = new Map<string, THREE.Object3D[]>();
      await Promise.all(document.renderers.map(async renderer => {
        const gltf = await UnityLevelLibrary.load(renderer.url);
        const terrainIndex = document.renderers.filter(item => item.terrain).indexOf(renderer);
        const root = renderer.terrain ? createUnityTerrainMesh(document.heightfields[terrainIndex], gltf.scene) : gltf.scene.clone(true);
        root.name = renderer.name;
        if (renderer.swing) root.userData.unitySwing = true;
        if (renderer.lamp) root.userData.unityLamp = true;
        if (!renderer.terrain) {
          root.position.copy(unityPoint(renderer.position));
          root.quaternion.copy(unityQuaternion(renderer.rotation));
          root.scale.fromArray(renderer.scale);
        }
        root.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = ctx.settings.quality !== 'low';
          mesh.receiveShadow = true;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (let i = 0; i < materials.length; i++) {
            const source = materials[i];
            if (!(source instanceof THREE.MeshStandardMaterial)) continue;
            const material = renderer.terrain ? source.clone() : applyUnityMaterial(source, document.environment);
            if (material instanceof THREE.ShaderMaterial) {
              this.animatedMaterials.add(material);
              mesh.castShadow = false;
            } else if (material instanceof THREE.MeshStandardMaterial) {
              if (renderer.terrain) applyUnityTerrain(material, renderer.terrain);
              applyUnityMaterialQuality(material, ctx.renderer);
            }
            if (material !== source) {
              this.ownedMaterials.add(material);
              if (Array.isArray(mesh.material)) mesh.material[i] = material;
              else mesh.material = material;
            }
          }
        });
        for (const dynamicId of [renderer.water, renderer.platform, renderer.activator]) {
          if (dynamicId === undefined) continue;
          const list = roots.get(dynamicId) ?? [];
          list.push(root);
          roots.set(dynamicId, list);
        }
        this.group.add(root);
      }));
      for (const def of document.platforms ?? []) {
        for (const root of roots.get(def.id) ?? []) this.platforms.push(new UnityPlatformView(ctx, def, root, document));
      }
      if (document.water?.length) this.water = new UnityWaterView(ctx, document, roots);
      if (document.activators?.length) this.activators = new UnityActivatorSystem(ctx, document, roots, this.platforms);
      if (document.vegetation) this.group.add(await createUnityVegetation(document, ctx.settings.quality !== 'low'));
      if (features.groundCover !== false && document.groundCover?.length) {
        this.group.add(this.groundCover.group);
        await Promise.all(document.groundCover.map(layer => this.groundCover.add(document, layer, ctx.settings.quality !== 'low')));
        this.groundCover.update(ctx.camera.position);
      }
    });
  }

  update(dt: number, t: number): void {
    this.environment?.update(t);
    this.groundCover.update(this.ctx.camera.position);
    for (const platform of this.platforms) platform.update(dt);
    this.water?.update(dt);
    this.activators?.update(dt);
    renderUnityWaterDepth(this.ctx, new Set([...this.animatedMaterials].filter(material => material.userData.unityWater)));
    for (const material of this.animatedMaterials) material.uniforms.uTime.value = t;
  }

  dispose(): void {
    this.disposed = true;
    this.activators?.dispose();
    this.activators = null;
    this.water?.dispose();
    this.water = null;
    this.platforms.length = 0;
    this.environment?.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedMaterials.clear();
    this.animatedMaterials.clear();
    this.group.removeFromParent();
  }
}

/**
 * 低雾的基准高度：这张图的低处。有水体取最低的水面；否则取导航网格顶点高度的 5% 分位（谷底，
 * 不被个别掉进坑里的顶点拉低）。都没有就用出生点脚下 2 m。
 */
export function unityAtmosphereBaseY(document: UnitySceneDocument): number {
  const waters = (document.water ?? []).map(water => water.center[1] + water.scale[1] * 0.5);
  if (waters.length) return Math.min(...waters);
  const vertices = document.navigation?.vertices ?? [];
  if (vertices.length) {
    const heights = vertices.map(vertex => vertex[1]).sort((a, b) => a - b);
    return heights[Math.floor((heights.length - 1) * 0.05)];
  }
  return document.spawn.position[1] - 2;
}
