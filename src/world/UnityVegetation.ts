import * as THREE from 'three';
import { UnityLevelLibrary, unityPoint, unityQuaternion, type UnitySceneDocument } from './UnityLevelLibrary';
import { applyUnityMaterial } from './UnityMaterials';

export async function createUnityVegetation(document: UnitySceneDocument, highQuality: boolean): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'unity-vegetation';
  const vegetation = document.vegetation;
  if (!vegetation) return group;
  for (const prototype of vegetation.prototypes) {
    const gltf = await UnityLevelLibrary.load(prototype.url);
    const source = gltf.scene.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined;
    if (!source) continue;
    const instances = vegetation.instances.filter(instance => instance.prototype === prototype.index);
    // 树冠走 Spiritfire/Foliage（风、逆光透光、球形法线），其余按材质的 Unity 着色器转
    const material = Array.isArray(source.material)
      ? source.material.map(item => item instanceof THREE.MeshStandardMaterial ? applyUnityMaterial(item, document.environment) : item)
      : source.material instanceof THREE.MeshStandardMaterial ? applyUnityMaterial(source.material, document.environment) : source.material;
    const mesh = new THREE.InstancedMesh(source.geometry, material, instances.length);
    mesh.name = prototype.name;
    mesh.castShadow = highQuality;
    mesh.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i];
      matrix.compose(unityPoint(instance.position), unityQuaternion(instance.rotation), new THREE.Vector3().fromArray(instance.scale));
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}
