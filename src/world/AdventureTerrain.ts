/** Instanced, published Hunyuan formations. Collision and visual footprints share one envelope. */
import * as THREE from 'three';
import { AssetLibrary, type LoadedAsset } from '../assets/AssetLibrary';
import { applyArtEnvironment } from '../assets/ArtEnvironment';
import type { GameContext } from '../core/types';
import type { AdventureRock, LevelLayout } from './LevelTypes';
import { applyHandPaintedEnvironment } from './SceneSurfaceMaterial';

/** Measured vertices account for non-identity glTF transforms and LOD decimation. */
export function adventureRockMatrix(source: THREE.Mesh, rock: AdventureRock, floorY: number, measured?: THREE.Box3): THREE.Matrix4 {
  const bounds = measured ?? new THREE.Box3();
  if (!measured) {
    const p = new THREE.Vector3(), positions = source.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) bounds.expandByPoint(p.fromBufferAttribute(positions, i).applyMatrix4(source.matrixWorld));
  }
  const extent = bounds.getSize(new THREE.Vector3());
  const quarter = Math.round(rock.yaw / (Math.PI / 2));
  const width = quarter & 1 ? rock.depth : rock.width, depth = quarter & 1 ? rock.width : rock.depth;
  const object = new THREE.Object3D();
  object.position.set(rock.x, floorY, rock.z); object.rotation.y = rock.yaw;
  object.scale.set(width / Math.max(1e-6, extent.x), rock.height / Math.max(1e-6, extent.y), depth / Math.max(1e-6, extent.z));
  object.updateMatrix();
  const offset = new THREE.Matrix4().makeTranslation(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2);
  return object.matrix.clone().multiply(offset).multiply(source.matrixWorld);
}

export class AdventureTerrain {
  readonly group = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private disposed = false;
  private signature = '';

  constructor(private readonly ctx: GameContext, private readonly layout: LevelLayout) {
    this.group.name = `adventure.terrain.${layout.theme}`;
    if (!layout.adventure) return;
    this.build();
    // Retain the old published formation while the proper broad cliff loads,
    // then replace it once. No substitute artistic mesh is constructed here.
    if (!AssetLibrary.get(this.cliffId()) || !AssetLibrary.get(this.rubbleId()))
      void AssetLibrary.preload().then(() => { if (!this.disposed) this.build(); });
  }

  private cliffId(): string {
    return `SM_Env_${this.layout.theme === 'desert' ? 'Desert' : this.layout.theme === 'frost' ? 'Frost' : 'Inferno'}Cliff`;
  }

  private rubbleId(): string {
    return this.layout.theme === 'inferno' ? 'SM_Env_InfernoBasalt' : 'SM_Env_DesertSandstone';
  }

  private build(): void {
    const L = this.layout;
    const rubble = AssetLibrary.get(this.rubbleId()), formation = AssetLibrary.get(this.cliffId()) ?? rubble;
    const signature = `${formation?.id ?? '-'}:${rubble?.id ?? '-'}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.group.clear();
    for (const resource of this.owned) resource.dispose();
    this.owned.length = 0;
    const families = new Map<LoadedAsset, AdventureRock[]>();
    for (const rock of L.adventure!.rocks) {
      const source = rock.ridge ? formation : rubble;
      if (!source) continue;
      let rocks = families.get(source);
      if (!rocks) families.set(source, rocks = []);
      rocks.push(rock);
    }
    for (const [asset, family] of families) this.buildFamily(asset, family);
  }

  private buildFamily(asset: LoadedAsset, family: AdventureRock[]): void {
    const L = this.layout;
    const low = this.ctx.settings.quality === 'low';
    const nearIndex = low ? asset.lods.length - 1 : Math.min(1, asset.lods.length - 1);
    const indices = nearIndex === asset.lods.length - 1 ? [nearIndex] : [nearIndex, asset.lods.length - 1];
    const sources = indices.map(index => {
      const mesh = asset.lods[index], bounds = new THREE.Box3(), point = new THREE.Vector3();
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) bounds.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
      return { mesh, bounds, index };
    });
    const materialCopies = new Map<THREE.Material, THREE.Material>();
    const copyMaterial = (original: THREE.Material): THREE.Material => {
      const cached = materialCopies.get(original);
      if (cached) return cached;
      const material = original.clone();
      if (material instanceof THREE.MeshStandardMaterial) {
        applyArtEnvironment(material, this.ctx.renderer);
        material.envMapIntensity = .42; material.roughness = Math.max(.85, material.roughness);
        applyHandPaintedEnvironment(material, asset.id);
        if (L.theme === 'frost' && asset.id !== 'SM_Env_FrostCliff') {
          material.color.set(0x98aab8);
          material.onBeforeCompile = shader => {
            shader.vertexShader = shader.vertexShader
              .replace('#include <common>', '#include <common>\nvarying float vAdventureSnow;')
              .replace('#include <begin_vertex>', `#include <begin_vertex>
                vec3 snowNormal = normal;
                #ifdef USE_INSTANCING
                  mat3 snowBasis = mat3(instanceMatrix);
                  snowNormal /= vec3(dot(snowBasis[0], snowBasis[0]), dot(snowBasis[1], snowBasis[1]), dot(snowBasis[2], snowBasis[2]));
                  snowNormal = snowBasis * snowNormal;
                #endif
                vAdventureSnow = smoothstep(.20, .75, normalize(mat3(modelMatrix) * snowNormal).y);`);
            shader.fragmentShader = shader.fragmentShader
              .replace('#include <common>', '#include <common>\nvarying float vAdventureSnow;')
              .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(.64, .73, .82), vAdventureSnow * .88);');
          };
          material.customProgramCacheKey = () => 'adventure-snow-rock-v1';
        }
      }
      materialCopies.set(original, material);
      this.owned.push(material); return material;
    };
    // A single all-map bounding sphere submits every rock even when most are
    // behind the camera. Small spatial batches retain instancing and allow the
    // renderer to cull whole off-screen formations, with a cheaper distant LOD.
    const chunks = new Map<string, AdventureRock[]>();
    for (const rock of family) {
      const key = `${Math.floor((rock.x - L.center.x) / 24)},${Math.floor((rock.z - L.center.z) / 24)}`;
      let rocks = chunks.get(key);
      if (!rocks) chunks.set(key, rocks = []);
      rocks.push(rock);
    }
    for (const [key, rocks] of chunks) {
      const lod = new THREE.LOD();
      lod.name = `${asset.id}.adventure.rocks.${key}`;
      lod.position.set(rocks.reduce((sum, r) => sum + r.x, 0) / rocks.length, 0,
        rocks.reduce((sum, r) => sum + r.z, 0) / rocks.length);
      lod.updateMatrix(); lod.matrixAutoUpdate = false;
      const local = new THREE.Matrix4().makeTranslation(-lod.position.x, 0, -lod.position.z);
      for (const [level, { mesh: source, bounds, index }] of sources.entries()) {
        const material = Array.isArray(source.material) ? source.material.map(copyMaterial) : copyMaterial(source.material);
        const mesh = new THREE.InstancedMesh(source.geometry, material, rocks.length);
        mesh.name = `${asset.id}.adventure.LOD${index}`;
        mesh.receiveShadow = true; mesh.castShadow = !low;
        mesh.matrixAutoUpdate = false;
        for (let i = 0; i < rocks.length; i++) mesh.setMatrixAt(i, local.clone().multiply(adventureRockMatrix(source, rocks[i], L.floorY, bounds)));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingBox(); mesh.computeBoundingSphere();
        lod.addLevel(mesh, level === 0 ? 0 : 42, .1);
        this.owned.push(mesh);
      }
      this.group.add(lod);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.group.removeFromParent(); this.group.clear();
    for (const resource of this.owned) resource.dispose();
    this.owned.length = 0;
  }
}
