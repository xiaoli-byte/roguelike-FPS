/**
 * 4-4 的神山（概念图 docs/art/concepts/ch4-631/4-4_haizi_scene_v5.jpg 正中那座）：画面里 631 的「一」，单独做。
 * 一座四棱金字塔，一条主棱正对玩家（出生点 → 湖心岛 → 神山一条线），左右两个大面：
 * 朝阳（东南偏南）的右面上半截吃到金光，左面在冷调阴影里；两面上顺坡几道深色岩肋，峰顶是雪。
 * 远景件：极坐标网格程序生成，切面着色，光直接烘进顶点色（1.4 km 外不在阴影贴图里，晨光又弱，实时光照拉不开两面的明暗）。
 */
import * as THREE from 'three';
import { patchMaterial } from '../plateau/materials';
import { fbm, ridged, smoothstep } from '../plateau/terrain';
import { DAWN, SACRED_PEAK, SPAWN } from './spec';

const hash = (i: number, j: number): number => {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const SNOW = new THREE.Color('#f1f5f9'), SNOW_SHADE = new THREE.Color('#b9c6d8'), ROCK = new THREE.Color('#6b6f78'), ROCK_LIT = new THREE.Color('#8f8678');
const GOLD = new THREE.Color(DAWN.summit.color);

export function buildSacredPeak(): THREE.Mesh {
  const { x: px, z: pz, height: H, radius: R } = SACRED_PEAK;
  const base = -60;
  // 主棱朝出生点
  const face = Math.atan2(SPAWN.z - pz, SPAWN.x - px);   // 和下面的 a 同一套：从 +x 起、朝 +z 转
  const NA = 128, NR = 34;
  /** 方位 a（从 +x 起，逆时针）、离峰心 t（0..1）处的高度 */
  const hAt = (t: number, a: number): number => {
    const rel = a - face;
    // 四条主棱：|cos(2·rel)| 在棱上 = 1、两棱之间的面上 = 0；开方让棱尖、面平
    const ridge = Math.pow(Math.abs(Math.cos(rel * 2)), 0.35);
    // 棱线的起伏在峰顶附近收掉，不然四个面都压低、只剩峰顶一个点 → 一根针
    const prof = Math.pow(1 - t, 1.55) * (1 - 0.28 * (1 - ridge) * smoothstep(0, 0.25, t));
    // 面上顺坡的次级肋：只在山腰，峰顶附近收掉
    const rib = (ridged(Math.cos(a) * 3 + t * 2, Math.sin(a) * 3 - t * 2, 3, 41) - 0.4) * 0.06 * smoothstep(0.05, 0.3, t);
    return base + H * (prof + rib) * (1 - 0.15 * smoothstep(0.85, 1, t));
  };
  const P: THREE.Vector3[] = [];
  for (let i = 0; i <= NR; i++) {
    const t = i / NR;
    for (let j = 0; j < NA; j++) {
      const a = ((j + (i > 0 && i < NR ? (hash(i, j) - 0.5) * 0.3 : 0)) / NA) * Math.PI * 2;
      const r = t * R;
      P.push(new THREE.Vector3(px + Math.cos(a) * r, i === 0 ? base + H * 1.0 : hAt(t, a), pz + Math.sin(a) * r));
    }
  }
  const sun = new THREE.Vector3(...DAWN.sunDir).normalize();
  const pos: number[] = [], col: number[] = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  const tri = (A: THREE.Vector3, B: THREE.Vector3, C: THREE.Vector3): void => {
    e1.subVectors(B, A); e2.subVectors(C, A); n.crossVectors(e1, e2).normalize();
    if (n.y < 0) { n.negate(); [B, C] = [C, B]; }
    const cy = (A.y + B.y + C.y) / 3, cx = (A.x + B.x + C.x) / 3 - px, cz = (A.z + B.z + C.z) / 3 - pz;
    const t = Math.hypot(cx, cz) / R;
    const lit = Math.max(0, n.dot(sun) / Math.max(0.25, Math.hypot(n.x, n.z)));     // 0..~1：低角度的晨光主要看水平朝向
    // 岩肋：顺坡的带子（按方位角分条，噪声打散边），山腰最多、峰顶没有
    const a = Math.atan2(cz, cx);
    const rib = ridged(Math.cos(a) * 3.2 + t * 1.6, Math.sin(a) * 3.2 - t * 1.3, 3, 43) + (fbm(a * 4, t * 7, 2, 44) - 0.5) * 0.3;
    const rock = smoothstep(0.62, 0.78, rib) * smoothstep(0.08, 0.3, t) * (1 - smoothstep(0.85, 1.0, t)) + smoothstep(0.55, 0.85, 1 - n.y) * 0.5;
    c.copy(SNOW_SHADE).lerp(SNOW, smoothstep(0.1, 0.6, lit));
    c.lerp(lit > 0.2 ? ROCK_LIT : ROCK, Math.min(1, rock) * 0.8);
    // 金顶：朝阳面、高于 from
    const gold = smoothstep(DAWN.summit.from, DAWN.summit.to, cy) * smoothstep(0.15, 0.6, lit) * DAWN.summit.strength;
    c.lerp(GOLD, gold * (1 - Math.min(1, rock) * 0.4));
    c.multiplyScalar(0.94 + hash(Math.round(cx), Math.round(cz)) * 0.08);
    for (const v of [A, B, C]) { pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); }
  };
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) {
    const j1 = (j + 1) % NA;
    const A = P[i * NA + j], B = P[i * NA + j1], C = P[(i + 1) * NA + j1], D = P[(i + 1) * NA + j];
    if (i === 0) { tri(A, C, D); continue; }                 // 峰顶一圈是三角扇
    if ((i + j) % 2) { tri(A, B, C); tri(A, C, D); } else { tri(A, B, D); tri(B, C, D); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  mesh.name = 'sacred-peak';
  return mesh;
}
