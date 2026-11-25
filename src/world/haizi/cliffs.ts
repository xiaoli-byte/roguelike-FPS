/**
 * 4-4 神山海子的冰斗壁岩壳（概念图 docs/art/concepts/ch4-631/4-4_haizi_scene_v5.jpg 左右两侧的山壁）：
 * 一片片深色岩板夹着积雪、有层理、山脊线锐利——光滑的高度场做不出这种块面，所以在可玩区外面（半径 86 m 往外）
 * 盖一层程序生成的切面壳：极坐标网格，顶点按格子抖开，高度在地形上加层理（台阶化）和岩脊，
 * 每个三角面单独着色：陡面是岩，缓面是雪（朝太阳的雪暖一点，背阴的偏冷）。
 *
 * 看得见、走不到的远中景件（项目规矩：程序生成，不走 Tripo）；不加碰撞，可玩区和软边界都在 86 m 以内。
 * 冰舌那一条（GLACIER）上不加起伏，冰舌贴着壳走（cliffHeight）。
 */
import * as THREE from 'three';
import { patchMaterial } from '../plateau/materials';
import { fbm, ridged, smoothstep } from '../plateau/terrain';
import { DAWN, GLACIER } from './spec';
import { macroAt } from './terrain';

/** 壳的内外半径：内圈接回地形（可玩区 78 m + 软边界 4 m 再留 4 m），外圈接回远景地形 */
export const CLIFF_R0 = 86, CLIFF_R1 = 440;

const hash = (i: number, j: number): number => {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const angDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** 0..1：离冰舌中线多近（1 = 冰舌下面，岩壳在这里不起伏，冰舌贴着走） */
export function glacierMask(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const half = (GLACIER.halfWidth0 + (GLACIER.halfWidth1 - GLACIER.halfWidth0) * smoothstep(GLACIER.r0, GLACIER.r1, r)) * 1.25;
  const lateral = Math.abs(angDiff(Math.atan2(x, -z), GLACIER.bearing)) * r;
  return (1 - smoothstep(half * 0.8, half * 1.25, lateral)) * smoothstep(GLACIER.r0 - 6, GLACIER.r0, r);
}

/** 岩壳的高度：地形 + 层理台阶 + 岩脊；内外圈收回到地形，冰舌下面不起伏 */
export function cliffHeight(x: number, z: number): number {
  const m = macroAt(x, z);
  const r = Math.hypot(x, z);
  const fade = smoothstep(CLIFF_R0, CLIFF_R0 + 14, r) * (1 - smoothstep(CLIFF_R1 - 60, CLIFF_R1, r)) * (1 - glacierMask(x, z));
  if (fade <= 0) return m.h;
  const wall = Math.max(0, m.wall);
  // 层理：按 9 m 一级往台阶上靠（一层层的岩板），越高越明显
  const step = 9;
  const terr = (Math.round(m.h / step) * step - m.h) * 0.45 * smoothstep(6, 30, wall);
  // 岩脊：顺坡的棱，块面大
  const rib = (ridged(x * 0.018, z * 0.018, 3, 91) - 0.35) * (2 + wall * 0.06);
  // 碎块：每块岩板高低错开一点
  const block = (fbm(x * 0.05, z * 0.05, 2, 92) - 0.5) * 2.2 * smoothstep(4, 20, wall);
  return m.h + Math.max(0.25, (terr + rib + block) * fade + 0.25);
}

// 岩是中灰（概念图的岩板在晨光阴影里也只比雪暗两三档，不是黑的）
const ROCK = new THREE.Color('#9a9894'), ROCK_DARK = new THREE.Color('#84858a'), ROCK_COOL = new THREE.Color('#939aa4');
const SNOW = new THREE.Color('#eef3f8'), SNOW_SHADE = new THREE.Color('#c6d1df'), SNOW_WARM = new THREE.Color('#f6eee6');
const MORAINE = new THREE.Color('#6e6a64');

export function buildCliffs(): THREE.Mesh {
  const NA = 168, NR = 44;
  const ring = (i: number): number => CLIFF_R0 * Math.pow(CLIFF_R1 / CLIFF_R0, i / NR);
  const vx: number[] = [], vz: number[] = [], vy: number[] = [];
  for (let i = 0; i <= NR; i++) {
    const r0 = ring(i), dr = ring(Math.min(NR, i + 1)) - r0;
    for (let j = 0; j < NA; j++) {
      // 内外圈不抖（接缝要和地形对齐），中间按格子抖开，网格不规则块面才不呆
      const edge = i === 0 || i === NR;
      const a = ((j + (edge ? 0 : (hash(i, j) - 0.5) * 0.35)) / NA) * Math.PI * 2;
      const r = r0 + (edge ? 0 : (hash(j, i + 31) - 0.5) * 0.35 * dr);
      const x = Math.sin(a) * r, z = -Math.cos(a) * r;
      vx.push(x); vz.push(z); vy.push(edge && i === 0 ? macroAt(x, z).h - 0.05 : cliffHeight(x, z));
    }
  }
  // 天空可见度（AO，只压环境光）：在壳自己的极坐标网格上朝 8 个方向找地平线仰角，cos²θ 平均（同 HeightGrid.skyVisibility）
  const vis = new Float32Array((NR + 1) * NA);
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let i = 0; i <= NR; i++) for (let j = 0; j < NA; j++) {
    const k = i * NA + j;
    let sum = 0;
    for (const [di, dj] of dirs) {
      let maxT = 0;
      for (const st of [1, 2, 3, 5, 8, 13]) {
        const i2 = i + di * st;
        if (i2 < 0 || i2 > NR) break;
        const k2 = i2 * NA + (((j + dj * st) % NA) + NA) % NA;
        const d = Math.hypot(vx[k2] - vx[k], vz[k2] - vz[k]);
        if (d < 0.5) continue;
        maxT = Math.max(maxT, (vy[k2] - vy[k]) / d);
      }
      sum += 1 / (1 + maxT * maxT);
    }
    vis[k] = sum / dirs.length;
  }
  const pos: number[] = [], col: number[] = [], sky: number[] = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  const sunXZ = new THREE.Vector2(DAWN.sunDir[0], DAWN.sunDir[2]).normalize();
  const c = new THREE.Color();
  const face = (ia: number, ib: number, ic: number): void => {
    A.set(vx[ia], vy[ia], vz[ia]); B.set(vx[ib], vy[ib], vz[ib]); C.set(vx[ic], vy[ic], vz[ic]);
    e1.subVectors(B, A); e2.subVectors(C, A); n.crossVectors(e1, e2).normalize();
    let sb = vis[ib], sc = vis[ic];
    if (n.y < 0) { n.negate(); const t = B.clone(); B.copy(C); C.copy(t); [sb, sc] = [sc, sb]; }
    const cx = (A.x + B.x + C.x) / 3, cz = (A.z + B.z + C.z) / 3, cy = (A.y + B.y + C.y) / 3;
    const m = macroAt(cx, cz);
    const k = hash(Math.round(cx * 0.7), Math.round(cz * 0.7));
    // 缓面是雪、陡面是岩；雪线随高度往下压，岩带用一层噪声打断（大块，不碎）
    const steep = 1 - n.y;
    const band = fbm(cx * 0.012, cz * 0.012, 3, 93);
    // 岩带成片：按面心位置的大块噪声 + 顺等高线的层理带决定（概念图的岩板一条条顺着层理），
    // 坡度只加一点——不按单个三角面的朝向挑，不然岩撒成一片碎玻璃
    const patch = smoothstep(0.48, 0.66, fbm(cx * 0.016, cz * 0.016, 3, 95));
    const strata = smoothstep(0.35, 0.8, Math.sin(cy * 0.55 + fbm(cx * 0.03, cz * 0.03, 2, 96) * 5)) * smoothstep(0.4, 0.7, band);
    const rockiness = patch * 0.75 + strata * 0.45 + smoothstep(0.45, 0.7, steep) * 0.3;
    const snowy = !(rockiness > 0.55 && m.wall > 4);
    if (snowy) {
      const facing = new THREE.Vector2(n.x, n.z).dot(sunXZ);
      c.copy(SNOW_SHADE).lerp(SNOW, smoothstep(0.5, 0.95, n.y)).lerp(SNOW_WARM, Math.max(0, facing) * 0.5);
    } else {
      c.copy(ROCK).lerp(ROCK_DARK, smoothstep(0.35, 0.75, k)).lerp(ROCK_COOL, smoothstep(0.55, 0.9, band) * 0.6);
      c.multiplyScalar(0.9 + 0.2 * smoothstep(0.2, 0.6, steep));
    }
    // 朝神山的冰碛垭口：低矮的碎石垄，雪少
    if (m.window > 0.5 && m.wall < 25) c.lerp(MORAINE, (m.window - 0.5) * 1.2 * (snowy ? 0.5 : 0.8));
    for (const v of [A, B, C]) { pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); }
    sky.push(vis[ia], sb, sc);
  };
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) {
    const j1 = (j + 1) % NA;
    const a = i * NA + j, b = i * NA + j1, cc = (i + 1) * NA + j1, d = (i + 1) * NA + j;
    if ((i + j) % 2) { face(a, b, cc); face(a, cc, d); } else { face(a, b, d); face(b, cc, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSky', new THREE.Float32BufferAttribute(sky, 1));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { sky: true }));
  mesh.name = 'cirque-cliffs';
  mesh.receiveShadow = true;
  return mesh;
}
