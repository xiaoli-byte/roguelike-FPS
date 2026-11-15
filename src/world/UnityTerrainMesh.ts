import * as THREE from 'three';
import { unityHeights, type UnityHeightfield } from './UnityLevelLibrary';

export function createUnityTerrainMesh(field: UnityHeightfield, source: THREE.Object3D): THREE.Mesh {
  const resolution = field.resolution;
  const heights = unityHeights(field);
  const positions = new Float32Array(resolution * resolution * 3);
  const uv = new Float32Array(resolution * resolution * 2);
  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const index = z * resolution + x;
      positions[index * 3] = field.origin[0] + x * field.scale[0];
      positions[index * 3 + 1] = field.origin[1] + heights[index] * field.scale[1];
      positions[index * 3 + 2] = field.origin[2] + z * field.scale[2];
      uv[index * 2] = x / (resolution - 1);
      uv[index * 2 + 1] = 1 - z / (resolution - 1);
    }
  }
  const indices = new Uint32Array((resolution - 1) * (resolution - 1) * 6);
  let cursor = 0;
  for (let z = 0; z < resolution - 1; z++) {
    for (let x = 0; x < resolution - 1; x++) {
      const a = z * resolution + x, b = a + 1, c = a + resolution, d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  let material: THREE.Material | THREE.Material[] = new THREE.MeshStandardMaterial();
  source.traverse(object => {
    if (object instanceof THREE.Mesh) material = object.material;
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Terrain_Heightfield';
  return mesh;
}
