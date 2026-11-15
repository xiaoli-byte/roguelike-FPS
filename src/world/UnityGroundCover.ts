import * as THREE from 'three';
import { UnityLevelLibrary, unityHeights, unityPoint, type UnityGroundCover, type UnityHeightfield, type UnitySceneDocument } from './UnityLevelLibrary';
import { sampleUnityHeight, type UnityHeightSamples } from './UnityHeightSampling';

interface Patch {
  mesh: THREE.InstancedMesh;
  center: THREE.Vector3;
  radius: number;
  distance: number;
}

const up = new THREE.Vector3(0, 1, 0);

function hash(x: number, z: number, seed: number, salt: number): number {
  let n = Math.imul(x + seed * 31 + salt * 137, 374761393) ^ Math.imul(z - seed * 17 + salt * 73, 668265263);
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}

function counts(layer: UnityGroundCover): Int32Array {
  const bytes = Uint8Array.from(atob(layer.counts), character => character.charCodeAt(0));
  return new Int32Array(bytes.buffer);
}

function fieldHeight(field: UnityHeightSamples, u: number, v: number): number {
  return sampleUnityHeight(field,
    field.origin.x + (1 - u) * field.scale.x * (field.resolution - 1),
    field.origin.z + v * field.scale.z * (field.resolution - 1));
}

export class UnityGroundCoverView {
  readonly group = new THREE.Group();
  private readonly patches: Patch[] = [];
  private readonly heights = new Map<UnityHeightfield, Float32Array>();

  constructor() {
    this.group.name = 'unity-ground-cover';
  }

  async add(document: UnitySceneDocument, layer: UnityGroundCover, highQuality: boolean): Promise<void> {
    let geometry: THREE.BufferGeometry;
    let material: THREE.Material | THREE.Material[];
    if (layer.url) {
      const source = (await UnityLevelLibrary.load(layer.url)).scene.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined;
      if (!source) return;
      geometry = source.geometry;
      material = source.material;
    } else {
      if (!layer.texture) return;
      geometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
      material = new THREE.MeshStandardMaterial({ map: await UnityLevelLibrary.loadTexture(layer.texture, true), side: THREE.DoubleSide, alphaTest: 0.4, roughness: 1 });
    }
    const field = document.heightfields.find(candidate => Math.abs(candidate.origin[2] - layer.origin[2]) < 1e-4
      && Math.abs(candidate.origin[0] + layer.terrainSize[0] - layer.origin[0]) < 1e-4);
    if (!field) return;
    let heights = this.heights.get(field);
    if (!heights) {
      heights = unityHeights(field);
      this.heights.set(field, heights);
    }
    const sampledField = { origin: unityPoint(field.origin), scale: unityPoint(field.scale), resolution: field.resolution, heights };
    const densities = counts(layer);
    const cellX = layer.terrainSize[0] / layer.width, cellZ = layer.terrainSize[2] / layer.height;
    const cells = new Map<string, number[]>();
    for (let z = 0; z < layer.height; z++) for (let x = 0; x < layer.width; x++) {
      const count = Math.floor(densities[z * layer.width + x] * layer.density);
      if (count <= 0) continue;
      const key = `${Math.floor(x * cellX / 24)},${Math.floor(z * cellZ / 24)}`;
      let list = cells.get(key);
      if (!list) cells.set(key, list = []);
      for (let i = 0; i < count; i++) list.push(x, z, i);
    }
    const position = new THREE.Vector3(), normal = new THREE.Vector3(), scale = new THREE.Vector3();
    const yaw = new THREE.Quaternion(), rotation = new THREE.Quaternion(), matrix = new THREE.Matrix4();
    const color = new THREE.Color(), dry = new THREE.Color().setRGB(layer.dryColor[0], layer.dryColor[1], layer.dryColor[2]);
    for (const list of cells.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, list.length / 3);
      mesh.name = layer.name;
      mesh.castShadow = highQuality;
      mesh.receiveShadow = true;
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0, instance = 0; i < list.length; i += 3, instance++) {
        const x = list[i], z = list[i + 1], seed = layer.noiseSeed + instance * 97;
        const u = THREE.MathUtils.clamp((x + 0.5 + (hash(x, z, seed, 1) - 0.5) * layer.positionJitter) / layer.width, 0, 1);
        const v = THREE.MathUtils.clamp((z + 0.5 + (hash(x, z, seed, 2) - 0.5) * layer.positionJitter) / layer.height, 0, 1);
        position.set(layer.origin[0] - u * layer.terrainSize[0], fieldHeight(sampledField, u, v), layer.origin[2] + v * layer.terrainSize[2]);
        const dx = (fieldHeight(sampledField, Math.min(1, u + 1 / layer.width), v) - fieldHeight(sampledField, Math.max(0, u - 1 / layer.width), v)) / (2 * cellX);
        const dz = (fieldHeight(sampledField, u, Math.min(1, v + 1 / layer.height)) - fieldHeight(sampledField, u, Math.max(0, v - 1 / layer.height))) / (2 * cellZ);
        normal.set(dx, 1, -dz).normalize().lerp(up, 1 - layer.alignToGround).normalize();
        rotation.setFromUnitVectors(up, normal);
        yaw.setFromAxisAngle(up, hash(x, z, seed, 3) * Math.PI * 2);
        rotation.multiply(yaw);
        const width = THREE.MathUtils.lerp(layer.minWidth, layer.maxWidth, hash(x, z, seed, 4));
        const height = THREE.MathUtils.lerp(layer.minHeight, layer.maxHeight, hash(x, z, seed, 5));
        scale.set(width, height, width);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(instance, matrix);
        color.setRGB(layer.healthyColor[0], layer.healthyColor[1], layer.healthyColor[2]).lerp(dry, hash(x, z, seed, 6));
        mesh.setColorAt(instance, color);
        minX = Math.min(minX, position.x); maxX = Math.max(maxX, position.x);
        minY = Math.min(minY, position.y); maxY = Math.max(maxY, position.y);
        minZ = Math.min(minZ, position.z); maxZ = Math.max(maxZ, position.z);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.patches.push({
        mesh,
        center: new THREE.Vector3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5),
        radius: Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5 + layer.maxHeight * 12,
        distance: layer.viewDistance,
      });
    }
  }

  update(camera: THREE.Vector3): void {
    for (const patch of this.patches) {
      const dx = patch.center.x - camera.x, dy = patch.center.y - camera.y, dz = patch.center.z - camera.z;
      patch.mesh.visible = Math.sqrt(dx * dx + dy * dy + dz * dz) <= patch.distance + patch.radius;
    }
  }
}
