/** Distant scenery reuses the published Hunyuan rock meshes, always at the last LOD. */
import * as THREE from 'three';
import { AssetLibrary } from '../assets/AssetLibrary';
import type { GameContext } from '../core/types';
import type { LevelLayout } from './LevelTypes';

export class SceneBackdrop {
  readonly group = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private readonly placements: { angle: number; radius: number; height: number; bury: number; yaw: number; wide: number; deep: number }[];
  private signature = '';
  private disposed = false;

  constructor(_ctx: GameContext, private readonly layout: LevelLayout, rand: () => number) {
    const L = this.layout;
    this.group.name = `scene.backdrop.${L.theme}`;
    // Keep the same random skyline when an asynchronously loaded cliff replaces
    // its older published formation; never consume the arena RNG in a callback.
    this.placements = Array.from({ length: 30 }, (_, i) => {
      const angle = i / 30 * Math.PI * 2 + rand() * .15;
      const radius = L.half + 55 + rand() * 45;
      const peak = i % 5 === 0;
      const height = peak ? 36 + rand() * 25 : 14 + rand() * 20;
      const bury = 6 + rand() * (peak ? 5 : 8), yaw = rand() * Math.PI * 2;
      const wide = peak ? .85 + rand() * .35 : 1.35 + rand() * .85, deep = 1 + rand() * .5;
      return { angle, radius, height, bury, yaw, wide, deep };
    });
    this.build();
    // When both art families are absent, ArenaBuilder owns its original fallback
    // ring. Only upgrade a backdrop we actually own, avoiding two overlapping rings.
    if (this.ready && !AssetLibrary.get(this.cliffId()))
      void AssetLibrary.preload().then(() => { if (!this.disposed) this.build(); });
  }

  get ready(): boolean { return this.group.children.length > 0; }

  private cliffId(): string {
    const theme = this.layout.theme;
    return `SM_Env_${theme === 'desert' ? 'Desert' : theme === 'frost' ? 'Frost' : 'Inferno'}Cliff`;
  }

  private build(): void {
    const L = this.layout;
    const cliff = AssetLibrary.get(this.cliffId());
    const fallbackId = L.theme === 'desert' ? 'SM_Env_DesertSandstone' : 'SM_Env_InfernoBasalt';
    const asset = cliff ?? AssetLibrary.get(fallbackId);
    if (!asset) return;
    if (asset.id === this.signature) return;
    this.signature = asset.id;
    this.group.clear();
    for (const resource of this.owned) resource.dispose();
    this.owned.length = 0;
    const source = asset.lods[asset.lods.length - 1];
    const applySnow = L.theme === 'frost' && !cliff;
    const toMaterial = (original: THREE.Material): THREE.Material => {
      const standard = original as THREE.MeshStandardMaterial;
      const material = new THREE.MeshBasicMaterial({
        map: standard.map ?? null, fog: true,
        color: L.theme === 'desert' ? 0xd6bca3 : L.theme === 'frost' ? 0x9db8d4 : 0x8c9abb,
      });
      const near = L.theme === 'desert' ? 24 : L.theme === 'frost' ? 60 : 48;
      const far = L.theme === 'desert' ? 150 : L.theme === 'frost' ? 180 : 190;
      material.onBeforeCompile = shader => {
        if (applySnow) {
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying float vBackdropSnow;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              vec3 snowNormal = normal;
              #ifdef USE_INSTANCING
                mat3 snowBasis = mat3(instanceMatrix);
                snowNormal /= vec3(dot(snowBasis[0], snowBasis[0]), dot(snowBasis[1], snowBasis[1]), dot(snowBasis[2], snowBasis[2]));
                snowNormal = snowBasis * snowNormal;
              #endif
              vBackdropSnow = smoothstep(.15, .70, normalize(mat3(modelMatrix) * snowNormal).y);`);
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vBackdropSnow;');
        }
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <map_fragment>', `#include <map_fragment>
            float backdropGrey = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(backdropGrey), .32);
            ${applySnow ? 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.61, .75, .88), vBackdropSnow * .86);' : ''}`)
          .replace('#include <fog_fragment>', `
            #ifdef USE_FOG
              float backdropFog = smoothstep(${near}.0, ${far}.0, vFogDepth);
              gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, backdropFog);
            #endif`);
      };
      material.customProgramCacheKey = () => `hunyuan-backdrop-${L.theme}-${applySnow ? 'snow-overlay' : 'authored'}-v5`;
      this.owned.push(material); return material;
    };
    const material = Array.isArray(source.material) ? source.material.map(toMaterial) : toMaterial(source.material);
    const mesh = new THREE.InstancedMesh(source.geometry, material, this.placements.length);
    mesh.name = `${asset.id}.backdrop.LOD${asset.lods.length - 1}`;
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    const object = new THREE.Object3D();
    const bounds = new THREE.Box3(), point = new THREE.Vector3(), positions = source.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) bounds.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(source.matrixWorld));
    const height = Math.max(1e-6, bounds.max.y - bounds.min.y);
    const center = bounds.getCenter(new THREE.Vector3());
    const offset = new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z);
    const size = bounds.getSize(new THREE.Vector3());
    for (let i = 0; i < mesh.count; i++) {
      const placement = this.placements[i], scale = placement.height / height;
      // The new broad mass can extend further sideways than a small rock. Keep
      // its entire horizontal footprint beyond the playable square's corners.
      const footprint = Math.hypot(size.x * scale * placement.wide, size.z * scale * placement.deep) * .5;
      const radius = Math.max(placement.radius, L.half * Math.SQRT2 + footprint + 6);
      // Partly bury broad low formations; a few taller peaks break the horizon rhythm.
      object.position.set(L.center.x + Math.sin(placement.angle) * radius, L.floorY - placement.bury, L.center.z + Math.cos(placement.angle) * radius);
      object.rotation.set(0, placement.yaw, 0);
      object.scale.set(scale * placement.wide, scale, scale * placement.deep);
      object.updateMatrix();
      mesh.setMatrixAt(i, object.matrix.clone().multiply(offset).multiply(source.matrixWorld));
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    this.group.add(mesh); this.owned.push(mesh);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent(); this.group.clear();
    for (const resource of this.owned) resource.dispose();
    this.owned.length = 0;
  }
}
