import * as THREE from 'three';
import type { CollisionWorld } from './Collision';
import { UnityLevelLibrary, type UnitySceneDocument } from './UnityLevelLibrary';

export async function loadUnityColliders(document: UnitySceneDocument, world: CollisionWorld): Promise<void> {
  await Promise.all(document.colliders.map(async (collider, index) => {
    if (!collider.url || collider.platform !== undefined) return;
    const gltf = await UnityLevelLibrary.load(collider.url);
    const positions: number[] = [];
    const indices: number[] = [];
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const attribute = object.geometry.getAttribute('position');
      const base = positions.length / 3;
      for (let i = 0; i < attribute.count; i++) positions.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
      const source = object.geometry.getIndex();
      if (source) for (let i = 0; i < source.count; i++) indices.push(base + source.getX(i));
      else for (let i = 0; i < attribute.count; i++) indices.push(base + i);
    });
    if (indices.length < 3) throw new Error(`Unity 碰撞体 ${document.id}/${collider.name} 没有有效三角面`);
    const tag = `unity-proxy-${index}`;
    for (const proxy of world.boxes.filter(box => box.tag === tag)) world.remove(proxy);
    world.addMesh(new Float32Array(positions), new Uint32Array(indices), collider.activator ? `unity-activator-${collider.activator}` : 'wall');
  }));
}
