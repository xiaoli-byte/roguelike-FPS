/**
 * 4-4 神山海子的冰舌（概念图 docs/art/concepts/ch4-631/4-4_haizi_scene_v5.jpg 左侧那片）：
 * 西北偏西的冰斗壁上，一条从冰斗顶淌下来的冰舌，舌尖停在湖岸外 82 m，舌尖是一道 3–4 m 的冰崖。
 *
 * 看得见、走不到的远中景件，按项目规矩程序生成（不走 Tripo）：一条顺着山坡的带子，几块大切面，
 * 中线最厚、两边贴回山坡；面片单独着色（flatShading），朝上的面亮、侧面偏青，不画细裂缝。
 * 只是看的：在可玩区（半径 78 m + 软边界）外面，不加碰撞。
 */
import * as THREE from 'three';
import { patchMaterial } from '../plateau/materials';
import { smoothstep } from '../plateau/terrain';
import { GLACIER } from './spec';
import { macroAt } from './terrain';

/** 0..1 的确定性伪随机（同一个格点每次一样） */
const hash = (i: number, j: number): number => {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const TOP = new THREE.Color('#e9f1f5'), TOP_SHADE = new THREE.Color('#cfdfe9'), SIDE = new THREE.Color('#a8c4d2'), CLIFF = new THREE.Color('#aac2cd');

export function buildGlacier(): THREE.Mesh {
  const G = GLACIER;
  const NS = 18, NU = 6;                      // 顺坡 18 段、横向 6 段：块面大，读得出切面
  const dir = (b: number): [number, number] => [Math.sin(b), -Math.cos(b)];
  /** 第 i 段（0 = 舌尖）横向第 j 点的世界坐标 */
  const point = (i: number, j: number): THREE.Vector3 => {
    const t = i / NS;
    const r = G.r0 + (G.r1 - G.r0) * t;
    const half = G.halfWidth0 + (G.halfWidth1 - G.halfWidth0) * smoothstep(0, 1, t);
    const u = (j / NU) * 2 - 1;                 // −1..1
    // 中线微微弯一点（冰川顺着冰斗壁的冲沟走），整条不是一根直尺
    const bend = Math.sin(t * 2.4) * 0.05;
    const [fx, fz] = dir(G.bearing + bend);
    const [sx, sz] = [-fz, fx];                 // 横向
    const x = fx * r + sx * u * half, z = fz * r + sz * u * half;
    const ground = macroAt(x, z).h;
    // 冰层：中线最厚、两边收成 0；舌根更厚；每个格点抖一点，切面才不呆板
    // 舌尖那几段额外抬高：舌尖读成一道冰墙，不是贴在地上的一片
    const snout = 1 + 0.9 * (1 - smoothstep(0, 0.12, t));
    const th = G.thick * (1 - u * u) * (0.75 + 0.6 * t) * snout + (hash(i, j) - 0.5) * 1.2 * (1 - u * u);
    return new THREE.Vector3(x, ground + Math.max(0.2, th), z);
  };
  const grid: THREE.Vector3[][] = [];
  for (let i = 0; i <= NS; i++) { const row: THREE.Vector3[] = []; for (let j = 0; j <= NU; j++) row.push(point(i, j)); grid.push(row); }

  const pos: number[] = [], col: number[] = [];
  const up = new THREE.Vector3(0, 1, 0), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, base?: THREE.Color): void => {
    e1.subVectors(b, a); e2.subVectors(c, a); nrm.crossVectors(e1, e2).normalize();
    if (nrm.y < 0) { [b, c] = [c, b]; nrm.negate(); }
    // 朝上的面亮（顶面受天光），越陡越偏青（侧面），再按面片抖一点亮度
    const k = nrm.dot(up);
    const cc = (base ?? TOP).clone().lerp(TOP_SHADE, smoothstep(0.95, 0.75, k)).lerp(SIDE, smoothstep(0.75, 0.35, k));
    cc.multiplyScalar(0.96 + hash(Math.round(a.x), Math.round(a.z)) * 0.08);
    for (const v of [a, b, c]) { pos.push(v.x, v.y, v.z); col.push(cc.r, cc.g, cc.b); }
  };
  for (let i = 0; i < NS; i++) for (let j = 0; j < NU; j++) {
    const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j + 1], d = grid[i + 1][j];
    // 对角线按格交替，块面朝向更散
    if ((i + j) % 2) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
  }
  // 舌尖冰崖：舌尖那一排点往下拉到山坡以下 1 m，一道竖着的冰墙
  for (let j = 0; j < NU; j++) {
    const a = grid[0][j], b = grid[0][j + 1];
    const a0 = a.clone().setY(macroAt(a.x, a.z).h - 1), b0 = b.clone().setY(macroAt(b.x, b.z).h - 1);
    // 冰崖朝湖：法线水平，tri() 按「朝上」翻面会翻错，这里直接按顺序写
    const cc = CLIFF.clone().multiplyScalar(0.95 + hash(j, 99) * 0.1);
    for (const v of [a, a0, b0, a, b0, b]) { pos.push(v.x, v.y, v.z); col.push(cc.r, cc.g, cc.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'glacier';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
