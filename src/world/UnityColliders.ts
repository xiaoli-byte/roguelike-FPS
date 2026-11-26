import * as THREE from 'three';
import type { CollisionWorld } from './Collision';
import { UnityLevelLibrary, type UnitySceneDocument } from './UnityLevelLibrary';

/**
 * 网格碰撞（网格 / 球 / 胶囊碰撞体）：本关一份 collision.glb（assets/levels/<id>/collision.glb），每个碰撞体一个节点，
 * 节点名 = 文档里的 colliders[].mesh。顶点已是网页坐标的世界坐标（Unity 的 x 镜像在 2026-11-26 转换数据时烘掉了，运行时不再猜），
 * 换下适配器先放的同名包围盒代理（unity-proxy-<下标>）。
 */
export async function loadUnityColliders(document: UnitySceneDocument, world: CollisionWorld): Promise<void> {
  const meshColliders = document.colliders.map((collider, index) => ({ collider, index })).filter(({ collider }) => collider.mesh && collider.platform === undefined);
  if (!meshColliders.length) return;
  if (!document.collision) throw new Error(`关卡 ${document.id} 有网格碰撞体，但文档没有 collision`);
  const gltf = await UnityLevelLibrary.load(document.collision);
  const nodes = new Map<string, THREE.Mesh>();
  gltf.scene.traverse(object => {
    if (object instanceof THREE.Mesh) nodes.set(object.name, object);
  });
  for (const { collider, index } of meshColliders) {
    const mesh = nodes.get(collider.mesh!);
    if (!mesh) throw new Error(`关卡 ${document.id} 的 collision.glb 里没有碰撞体 ${collider.name} 的节点 ${collider.mesh}`);
    const attribute = mesh.geometry.getAttribute('position');
    // 拷一份：碰撞世界留着引用，GLB 在 UnityLevelLibrary 里按地址缓存（换关可能释放）
    const vertices = new Float32Array(attribute.count * 3);
    for (let i = 0; i < attribute.count; i++) {
      vertices[i * 3] = attribute.getX(i);
      vertices[i * 3 + 1] = attribute.getY(i);
      vertices[i * 3 + 2] = attribute.getZ(i);
    }
    const source = mesh.geometry.getIndex();
    const triangles = source ? Uint32Array.from({ length: source.count }, (_, i) => source.getX(i)) : Uint32Array.from({ length: attribute.count }, (_, i) => i);
    if (triangles.length < 3) throw new Error(`关卡碰撞体 ${document.id}/${collider.name} 没有有效三角面`);
    const tag = `unity-proxy-${index}`;
    for (const proxy of world.boxes.filter(box => box.tag === tag)) world.remove(proxy);
    world.addMesh(vertices, triangles, collider.activator ? `unity-activator-${collider.activator}` : 'wall');
  }
}
