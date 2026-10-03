/**
 * 占位英雄模型（胶囊体 + 持枪挂点）。各英雄的正式模型完成前使用，也作为未知 id 的兜底。
 */
import * as THREE from 'three';
import type { HeroRig } from './types';

export function buildPlaceholderHero(color = 0xd4a94e): HeroRig {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true });
  const geo = new THREE.CapsuleGeometry(0.32, 1.1, 4, 8);
  const body = new THREE.Mesh(geo, mat);
  body.position.y = 0.87;
  root.add(body);
  const hand = new THREE.Group();
  hand.position.set(-0.36, 1.05, 0.32);
  root.add(hand);
  return {
    root,
    height: 1.75,
    hand,
    materials: [mat],
    update(_dt, t) {
      body.scale.y = 1 + Math.sin(t * 2) * 0.01;
    },
    playIntro() {},
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
