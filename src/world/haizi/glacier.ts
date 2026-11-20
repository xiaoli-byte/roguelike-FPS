/**
 * 4-4 神山海子的冰舌（概念图 docs/art/concepts/ch4-631/4-4_haizi_scene_v5.jpg 左侧那片冰崩）：
 * 西北偏北的冰斗壁上，一条从冰斗顶淌下来的冰舌，台阶状——每一级的顶面比山坡缓，冰往下越积越厚，
 * 到下一级前是一道几米到十来米的冰崖（顶面白、立面青）；舌尖停在湖岸外 82 m，是一道冰墙。
 *
 * 看得见、走不到的远中景件，按项目规矩程序生成（不走 Tripo）：大切面，面片单独着色（flatShading），不画细裂缝。
 * 只是看的：在可玩区（半径 78 m + 软边界）外面，不加碰撞。冰舌下面的岩壳不起伏（cliffs.ts 的 glacierMask）。
 */
import * as THREE from 'three';
import { patchMaterial } from '../plateau/materials';
import { smoothstep } from '../plateau/terrain';
import { CLIFF_R0, cliffHeight } from './cliffs';
import { GLACIER } from './spec';
import { macroAt } from './terrain';

const hash = (i: number, j: number): number => {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const TOP = new THREE.Color('#f5f9fc'), TOP_SHADE = new THREE.Color('#e2eef5'), FRONT = new THREE.Color('#d2e8f3'), FRONT_DEEP = new THREE.Color('#b9d8e8');

/** 冰舌底下的地面：舌尖一段在湖岸地形上，往上贴着岩壳 */
const ground = (x: number, z: number): number => (Math.hypot(x, z) < CLIFF_R0 + 2 ? macroAt(x, z).h : cliffHeight(x, z));

export function buildGlacier(): THREE.Mesh {
  const G = GLACIER;
  const NU = 8;
  // 台阶：从舌尖往上，越往上一级越长（透视里看起来差不多）
  const bounds: number[] = [G.r0];
  for (let len = 22; bounds[bounds.length - 1] < G.r1; len *= 1.15) bounds.push(Math.min(G.r1, bounds[bounds.length - 1] + len));
  const at = (r: number, u: number): [number, number] => {
    const t = (r - G.r0) / (G.r1 - G.r0);
    const half = G.halfWidth0 + (G.halfWidth1 - G.halfWidth0) * smoothstep(0, 1, t);
    const b = G.bearing + Math.sin(t * 2.4) * 0.05;
    const fx = Math.sin(b), fz = -Math.cos(b);
    return [fx * r + -fz * u * half, fz * r + fx * u * half];
  };
  const thick = (r: number, u: number): number => G.thick * (1 - u * u) * (0.8 + 0.5 * (r - G.r0) / (G.r1 - G.r0));
  type V = THREE.Vector3;
  const rows: V[][] = [];
  // 冰崖前沿按列前后错开（同一道冰崖的上下两排用同一组错位，立面才是竖的）：冰块大小不一，不是一级级楼梯
  const jag = (bi: number, j: number): number => (j === 0 || j === NU ? 0 : (hash(bi * 7 + 3, j) - 0.5) * 0.55 * (bounds[Math.min(bounds.length - 1, bi + 1)] - bounds[bi] || 12));
  const rowAt = (r: number, yOf: (x: number, z: number, u: number) => number, salt: number, bi = -1): V[] => {
    const row: V[] = [];
    for (let j = 0; j <= NU; j++) {
      const u = (j / NU) * 2 - 1;
      const [x, z] = at(bi >= 0 ? r + jag(bi, j) : r, u);
      // 冰崖上沿按列高低错开（同一道冰崖上下两排用同一组），侧面看也是一块块大小不一的冰体，不是一级级楼梯
      const lift = bi >= 0 ? (hash(bi * 5 + 1, j) - 0.5) * 4.5 * (1 - u * u) : 0;
      row.push(new THREE.Vector3(x, yOf(x, z, u) + lift + (hash(salt, j) - 0.5) * 0.8 * (1 - u * u), z));
    }
    return row;
  };
  // 从上往下排：每一级 = 上沿一排、中间一排、下沿一排（冰积厚了），再接下一级上沿（同一个半径、低一截 = 冰崖）
  for (let k = bounds.length - 1; k > 0; k--) {
    const rb = bounds[k], ra = bounds[k - 1];
    const slopeAt = (u: number): number => {
      const [x0, z0] = at(ra, u), [x1, z1] = at(rb, u);
      return (ground(x1, z1) - ground(x0, z0)) / Math.max(1, rb - ra);
    };
    // 顶面只有山坡坡度的 35%：从上沿往下走，冰面比山坡缓，越往下越厚
    const top = (r: number) => (x: number, z: number, u: number): number => {
      const [xb, zb] = at(rb, u);
      return Math.max(ground(x, z) + 0.3, ground(xb, zb) + thick(rb, u) - (rb - r) * slopeAt(u) * 0.35);
    };
    rows.push(rowAt(rb, top(rb), k * 3, k));
    rows.push(rowAt((ra + rb) / 2, top((ra + rb) / 2), k * 3 + 1));
    rows.push(rowAt(ra, top(ra), k * 3 + 2, k - 1));
  }
  // 舌尖冰墙：最下面一排往下拉到地面以下 1 m
  rows.push(rows[rows.length - 1].map(v => new THREE.Vector3(v.x, macroAt(v.x, v.z).h - 1, v.z)));

  const pos: number[] = [], col: number[] = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  const tri = (a: V, b: V, cc: V, seed: number): void => {
    e1.subVectors(b, a); e2.subVectors(cc, a); n.crossVectors(e1, e2).normalize();
    // 冰崖（立面）的法线接近水平：不按「朝上」翻面，按朝外（离开山坡、朝湖）翻
    const horiz = Math.hypot(n.x, n.z);
    if (n.y < 0 && horiz < 0.9) { [b, cc] = [cc, b]; n.negate(); }
    const k = Math.max(0, n.y);
    c.copy(TOP).lerp(TOP_SHADE, smoothstep(0.95, 0.7, k)).lerp(FRONT, smoothstep(0.7, 0.4, k)).lerp(FRONT_DEEP, smoothstep(0.35, 0.05, k));
    c.multiplyScalar(0.95 + hash(seed, 7) * 0.1);
    for (const v of [a, b, cc]) { pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); }
  };
  for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j < NU; j++) {
    const a = rows[i][j], b = rows[i][j + 1], cc = rows[i + 1][j + 1], d = rows[i + 1][j];
    if ((i + j) % 2) { tri(a, b, cc, i * 31 + j); tri(a, cc, d, i * 31 + j + 9); } else { tri(a, b, d, i * 31 + j); tri(b, cc, d, i * 31 + j + 9); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // 冰透光：加一点冷色自发光，背光的冰崖也是青白的，不是深蓝的
  const mesh = new THREE.Mesh(g, patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, emissive: '#6f8ea3', emissiveIntensity: 0.35 })));
  mesh.name = 'glacier';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
