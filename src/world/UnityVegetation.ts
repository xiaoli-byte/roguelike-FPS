import * as THREE from 'three';
import { UnityLevelLibrary, unityPoint, unityQuaternion, type UnitySceneDocument } from './UnityLevelLibrary';
import { applyUnityMaterial } from './UnityMaterials';

/**
 * 植被分块边长（米）。一个原型的全部实例放进一个 InstancedMesh 时，包围球盖住整张图，视锥剔除和阴影剔除都失效：
 * 4-3 的 43,603 棵树（3311 万面）每帧主画面画一遍、阴影再画一遍，出生点视角实测 7283 万面 / 帧（2026-11-25）。
 * 按格子拆开后，画面外的格子不画，阴影只画阴影相机（跟相机 90 m）碰到的格子；画出来的树和原来一模一样。
 * 128 m：4-3（1.5 km 见方、7 种树）拆成约 810 块，视锥里通常几百块；再小绘制调用涨得比省下的三角面快。
 * 不按距离剔：4-3 的雾终点 3200 m，远处的林子是构图的一部分。
 */
export const VEGETATION_CELL = 128;

type VegetationInstance = NonNullable<UnitySceneDocument['vegetation']>['instances'][number];

/** 按水平格子分组（键 = 格子坐标），同一格子里保持导出顺序 */
export function vegetationCells(instances: readonly VegetationInstance[], cell = VEGETATION_CELL): Map<string, VegetationInstance[]> {
  const cells = new Map<string, VegetationInstance[]>();
  for (const instance of instances) {
    const key = `${Math.floor(instance.position[0] / cell)},${Math.floor(instance.position[2] / cell)}`;
    let list = cells.get(key);
    if (!list) cells.set(key, list = []);
    list.push(instance);
  }
  return cells;
}

export async function createUnityVegetation(document: UnitySceneDocument, highQuality: boolean): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'unity-vegetation';
  const vegetation = document.vegetation;
  if (!vegetation) return group;
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3();
  for (const prototype of vegetation.prototypes) {
    const gltf = await UnityLevelLibrary.load(prototype.url);
    const source = gltf.scene.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined;
    if (!source) continue;
    const instances = vegetation.instances.filter(instance => instance.prototype === prototype.index);
    // 树冠走 Spiritfire/Foliage（风、逆光透光、球形法线），其余按材质的 Unity 着色器转；同一原型的各块共用一份材质
    const material = Array.isArray(source.material)
      ? source.material.map(item => item instanceof THREE.MeshStandardMaterial ? applyUnityMaterial(item, document.environment) : item)
      : source.material instanceof THREE.MeshStandardMaterial ? applyUnityMaterial(source.material, document.environment) : source.material;
    for (const [key, list] of vegetationCells(instances)) {
      const mesh = new THREE.InstancedMesh(source.geometry, material, list.length);
      mesh.name = `${prototype.name}@${key}`;
      mesh.castShadow = highQuality;
      mesh.receiveShadow = true;
      for (let i = 0; i < list.length; i++) {
        const instance = list[i];
        matrix.compose(unityPoint(instance.position), unityQuaternion(instance.rotation), scale.fromArray(instance.scale));
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      // 包围球只盖这一格的树：视锥 / 阴影相机据它剔整块
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return group;
}
