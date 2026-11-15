import * as THREE from 'three';
import { anchor, geo, glow, glowMesh, mesh, pivot, std } from './parts';

export interface HanbaRig {
  root: THREE.Group;
  body: THREE.Object3D;
  pearl: THREE.Object3D;
  ring: THREE.Group;
  hub: THREE.Object3D;
  disc: THREE.Mesh;
  armL: THREE.Group;
  armR: THREE.Group;
}

export function buildHanba(): HanbaRig {
  const root = new THREE.Group();
  const skin = std(0x9b7054, { rough: 0.88 });
  const cloth = std(0x5e3027, { rough: 0.95 });
  const trim = std(0xbc8348, { metal: 0.5, rough: 0.5 });
  const gold = glow(0xffd27a);
  const hot = glow(0xffefb0, 0.36, true);
  mesh(root, geo.cone(0.85, 2.2, 10), cloth, 0, 1.1, 0);
  mesh(root, geo.cyl(0.36, 0.58, 1.5, 9), skin, 0, 2.4, 0);
  mesh(root, geo.sphere(0.39, 12, 9), skin, 0, 3.58, 0.03);
  mesh(root, geo.cone(0.43, 1.15, 8), cloth, 0, 3.95, -0.18).rotation.x = -0.3;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const veil = mesh(root, geo.box(0.1, 2.25, 0.035), i % 2 ? cloth : trim, Math.sin(angle) * 0.72, 1.7, Math.cos(angle) * 0.52);
    veil.rotation.set(0.2 * Math.cos(angle), angle, 0.15 * Math.sin(angle));
  }
  const armL = pivot(root, -0.44, 2.93, 0), armR = pivot(root, 0.44, 2.93, 0);
  for (const [arm, sign] of [[armL, -1], [armR, 1]] as const) {
    mesh(arm, geo.cyl(0.095, 0.13, 1.18, 7), skin, sign * 0.36, -0.33, 0).rotation.z = sign * 0.85;
    mesh(arm, geo.sphere(0.13, 8, 6), trim, sign * 0.75, -0.69, 0);
  }
  const body = anchor(root, 0, 2.2, 0);
  const pearl = anchor(root, 0, 2.8, 0.44);
  pearl.name = 'socket_core';
  glowMesh(pearl, geo.sphere(0.2, 12, 8), glow(0xa5f5f1), 0, 0, 0, 'pearl');
  const ring = pivot(root, 0, 3.7, -1.65);
  const hub = anchor(ring, 0, 0, 0);
  mesh(ring, geo.torus(3, 0.12, 8, 64), trim);
  mesh(ring, geo.torus(2.65, 0.035, 6, 48), gold);
  const disc = mesh(ring, new THREE.CircleGeometry(2.7, 48), hot);
  disc.userData.glow = true;
  for (let i = 0; i < 8; i++) {
    const spoke = mesh(ring, geo.cyl(0.035, 0.12, 5.8, 5), trim);
    spoke.rotation.z = i * Math.PI / 4;
    glowMesh(ring, geo.sphere(0.11, 8, 6), gold, Math.sin(i * Math.PI / 4) * 3, Math.cos(i * Math.PI / 4) * 3, 0, 'sun');
  }
  glowMesh(ring, geo.sphere(0.48, 12, 8), gold, 0, 0, 0, 'sun');
  return { root, body, pearl, ring, hub, disc, armL, armR };
}
