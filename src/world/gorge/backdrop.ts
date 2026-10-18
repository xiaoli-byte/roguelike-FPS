/**
 * 4-2 的远景：天空沿用 4-1；外围地形就是峡谷地形函数往图外的延伸（河谷在图外收成深槽继续流），
 * 再远是一圈雪山——北面墨尔多一带的雪峰、西南远处的贡嘎群峰。
 */
import * as THREE from 'three';
import type { PeakSpec } from '../plateau/backdrop';
import { patchMaterial } from '../plateau/materials';
import { fbm, smoothstep } from '../plateau/terrain';
import { macroAt, type GorgeTerrain } from './terrain';

export const GORGE_PEAKS: PeakSpec[] = [
  { x: -260, z: -1450, height: 620, radius: 700, ridges: 4, sharp: 1.45, seed: 11.3, snow: 0.42, green: 0.1 },
  { x: 380, z: -1600, height: 520, radius: 640, ridges: 3, sharp: 1.35, seed: 12.1, snow: 0.45, green: 0.15 },
  { x: 1150, z: -900, height: 420, radius: 620, ridges: 4, sharp: 1.25, seed: 13.7, snow: 0.5, green: 0.3 },
  { x: -1300, z: -700, height: 480, radius: 700, ridges: 4, sharp: 1.3, seed: 14.4, snow: 0.48, green: 0.25 },
  { x: -1500, z: 900, height: 760, radius: 820, ridges: 3, sharp: 1.6, seed: 15.2, snow: 0.36, green: 0 },
  { x: -900, z: 1500, height: 520, radius: 680, ridges: 4, sharp: 1.3, seed: 16.6, snow: 0.45, green: 0.2 },
  { x: 1300, z: 1100, height: 300, radius: 700, ridges: 5, sharp: 1.1, seed: 17.9, snow: 0.9, green: 0.7 },
  { x: 500, z: 1600, height: 260, radius: 720, ridges: 5, sharp: 1.0, seed: 18.3, snow: 1.4, green: 1 },
];

const GRASS = new THREE.Color('#4f7d3a'), GRASS_FAR = new THREE.Color('#5a7a52'), ROCK = new THREE.Color('#77706a'), SNOW = new THREE.Color('#f2f6fb');

/** 图外 1.4 km 的地形：用同一个地形函数（图外横断面越收越紧），图内部分不画（由高度图负责） */
export function buildFarTerrain(terrain: GorgeTerrain): THREE.Mesh {
  const R = 1400, cell = 16;
  const n = Math.round((2 * R) / cell) + 1;
  const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
  const inside = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -R + i * cell, z = -R + j * cell, k = j * n + i;
    const inMap = x >= terrain.minX && x <= terrain.maxX && z >= terrain.minZ && z <= terrain.maxZ;
    let y: number;
    if (inMap) { y = terrain.heightAt(x, z) - 6; inside[k] = 1; }
    else {
      const m = macroAt(x, z);
      // 远处再叠一层大起伏，山脊不至于一样高
      const far = smoothstep(300, 900, Math.hypot(x, z));
      y = m.h + far * (fbm(x * 0.002, z * 0.002, 3, 51) - 0.3) * 260;
    }
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
  }
  const c = new THREE.Color();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
    const yr = i < n - 1 ? pos[(k + 1) * 3 + 1] : y, yd = j < n - 1 ? pos[(k + n) * 3 + 1] : y;
    const slope = Math.atan(Math.hypot(yr - y, yd - y) / cell);
    c.copy(fbm(x * 0.004, z * 0.004, 2, 44) > 0.5 ? GRASS : GRASS_FAR).lerp(ROCK, smoothstep(0.55, 0.9, slope) * 0.85);
    c.lerp(SNOW, smoothstep(230, 300, y + (fbm(x * 0.006, z * 0.006, 3, 45) - 0.5) * 60) * (1 - smoothstep(0.9, 1.2, slope) * 0.6));
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const idx: number[] = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, cc = a + n + 1, d = a + n;
    if (inside[a] && inside[b] && inside[cc] && inside[d]) continue;
    idx.push(a, cc, b, a, d, cc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true })));
  mesh.name = 'far-terrain';
  mesh.receiveShadow = true;
  return mesh;
}
