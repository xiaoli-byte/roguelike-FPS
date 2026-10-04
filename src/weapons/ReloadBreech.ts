/** Add an animation hinge to the existing double-barrel art mesh, preserving its texture/LODs. */
import * as THREE from 'three';

function subset(source: THREE.BufferGeometry, vertices: number[]): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const a = attribute as THREE.BufferAttribute;
    const array = new (a.array.constructor as new (size: number) => THREE.TypedArray)(vertices.length * a.itemSize);
    for (let i = 0; i < vertices.length; i++) for (let k = 0; k < a.itemSize; k++) array[i * a.itemSize + k] = a.getComponent(vertices[i], k);
    result.setAttribute(name, new THREE.BufferAttribute(array, a.itemSize, a.normalized));
  }
  result.computeBoundingSphere();
  return result;
}

export function addReloadBreech(root: THREE.Group, owned: THREE.BufferGeometry[]): THREE.Group {
  const hinge = new THREE.Group(); hinge.name = 'reload.breech'; hinge.position.set(0, 0.004, -0.035);
  root.add(hinge); root.updateWorldMatrix(true, true);
  // Art is split into rigid pieces after binding. Only split the root piece; hands/other joints stay intact.
  const art = root.children.filter(o => o instanceof THREE.LOD && o.name.startsWith('SK_Weapon_') && o.name.endsWith('_j_r')) as THREE.LOD[];
  for (const body of art) {
    const barrels = new THREE.LOD(); barrels.name = `${body.name}.barrels`; hinge.add(barrels);
    for (const level of body.levels) {
      const mesh = level.object as THREE.Mesh;
      if (!mesh.isMesh) continue;
      const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      const positions = source.getAttribute('position');
      const toRoot = root.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
      const centroid = new THREE.Vector3(), point = new THREE.Vector3();
      const front: number[] = [], rest: number[] = [];
      for (let t = 0; t < positions.count; t += 3) {
        centroid.set(0, 0, 0);
        for (let k = 0; k < 3; k++) centroid.add(point.fromBufferAttribute(positions, t + k).applyMatrix4(toRoot));
        centroid.multiplyScalar(1 / 3);
        (centroid.z < -0.065 && centroid.y > -0.025 ? front : rest).push(t, t + 1, t + 2);
      }
      if (front.length && rest.length) {
        const fixed = subset(source, rest), moving = subset(source, front);
        mesh.geometry = fixed;
        moving.applyMatrix4(hinge.matrixWorld.clone().invert().multiply(mesh.matrixWorld));
        const barrel = new THREE.Mesh(moving, mesh.material);
        barrel.onBeforeRender = mesh.onBeforeRender;
        barrels.addLevel(barrel, level.distance);
        owned.push(fixed, moving);
      }
      source.dispose();
    }
  }
  // Existing blockout geometry remains an animation fallback when art is unavailable.
  for (const child of [...root.children]) if ((child as THREE.Mesh).isMesh && child.position.z < -0.05) hinge.attach(child);
  return hinge;
}
