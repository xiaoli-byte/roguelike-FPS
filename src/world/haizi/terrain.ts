/**
 * 4-4 神山海子的高度场：一个圆形冰斗湖。
 * 由里往外：湖心岛 → 湖底（湖心岛和湖岸之间最深 7 m）→ 46 m 起变浅 → 约 52 m 出水的碎石湖岸（缓坡，岸线按方位起伏）→ 75 m 起慢慢变陡的冰斗壁（上半截积雪）。
 * 冰斗壁在北偏东（神山的方向）低下去成冰碛垭口，南面来路的谷口也低一些。
 * 同一个地形函数 macroAt() 也给图外的远景地形用（buildFarTerrain），图内图外接得上。
 */
import * as THREE from 'three';
import { HeightGrid } from '../plateau/grid';
import { patchMaterial } from '../plateau/materials';
import { fbm, ridged, smoothstep } from '../plateau/terrain';
import { ISLAND, LAKE, MAP, PEAK_BEARING } from './spec';

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** 两个方位角的差（−π..π） */
const angDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export interface Macro {
  h: number;
  /** 到可玩区边界的有符号距离（区内为负） */
  bound: number;
  /** 冰碛垭口（朝神山的缺口）权重 0..1 */
  window: number;
  /** 冰斗壁抬起来的高度（上色用：越高越可能积雪） */
  wall: number;
}

/** 湖岸剖面（不含噪声）：浅水 → 52 m 出水 → 75 m 处高 2.55 m，之后坡度一直延续 */
function shoreProfile(r: number): number {
  if (r <= LAKE.shoreR) return -1.2 + 1.35 * smoothstep(LAKE.deepR, LAKE.shoreR, r);
  return 0.15 + 2.4 * (r - LAKE.shoreR) / (LAKE.shoreOuterR - LAKE.shoreR);
}

/** 湖面以内的湖底 / 湖心岛（r < deepR） */
function lakeBed(x: number, z: number, r: number): number {
  const bed = LAKE.bottom + (-1.2 - LAKE.bottom) * smoothstep(30, LAKE.deepR, r);
  // 湖心岛：顶面平，边上 2.5 m 收成陡坎扎进湖底
  const di = Math.hypot(x - ISLAND.x, z - ISLAND.z);
  const top = ISLAND.h + (fbm(x * 0.3, z * 0.3, 2, 63) - 0.5) * 0.25;
  const island = top - smoothstep(ISLAND.r - 2.5, ISLAND.r + 4, di) * (top - LAKE.bottom - 0.5);
  return Math.max(bed, island);
}

export function macroAt(x: number, z: number): Macro {
  const r = Math.hypot(x, z);
  const bearing = Math.atan2(x, -z);
  const win = 1 - smoothstep(0.35, 0.95, Math.abs(angDiff(bearing, PEAK_BEARING)));
  const south = 1 - smoothstep(0.3, 0.75, Math.abs(angDiff(bearing, Math.PI)));
  let h: number, wall = 0;
  if (r < LAKE.deepR) {
    h = lakeBed(x, z, r);
  } else {
    // 岸线不是正圆：按方位起伏 ±2.5 m（只动浅水到湖岸这一段，46 m 的深水线不动）
    const wobble = (fbm(Math.cos(bearing) * 1.8 + 5, Math.sin(bearing) * 1.8 - 2, 3, 66) - 0.5) * 5;
    const rr = r + wobble * smoothstep(LAKE.deepR, LAKE.deepR + 4, r) * (1 - smoothstep(LAKE.shoreOuterR - 8, LAKE.shoreOuterR + 2, r));
    h = shoreProfile(rr);
    // 湖岸上的碎石起伏和冰碛小丘（离水越远越明显）
    h += (fbm(x * 0.06, z * 0.06, 3, 64) - 0.5) * 0.9 * smoothstep(LAKE.shoreR - 1, LAKE.shoreR + 8, r);
    // 冰斗壁：75 m 起慢慢变陡，230 m（图边）约 90 m 高，远处收在 300 m 左右；朝神山那一面低成冰碛垭口
    const s = Math.max(0, r - LAKE.shoreOuterR);
    if (s > 0) {
      const raw = 0.035 * s + 0.0035 * s * s;
      wall = 300 * Math.tanh(raw / 300);
      wall *= 1 - 0.85 * win * smoothstep(0, 30, s);
      wall *= 1 - 0.45 * south * smoothstep(0, 30, s);
      // 山壁上的岩脊和冲沟
      wall += (ridged(x * 0.011, z * 0.011, 4, 65) - 0.35) * Math.min(1, s / 50) * (3 + s * 0.09) * (1 - 0.7 * win);
      h += wall;
      // 冰碛垭口外是往神山方向下去的谷地
      h -= win * smoothstep(240, 700, r) * 30;
    }
  }
  return { h, bound: r - MAP.playRadius, window: win, wall };
}

const PAL = {
  gravel: new THREE.Color('#c4bcb0'),
  gravelWarm: new THREE.Color('#d2c7b2'),
  gravelWet: new THREE.Color('#8d877e'),
  bedShallow: new THREE.Color('#6f9d95'),
  bedDeep: new THREE.Color('#2f5a5e'),
  rock: new THREE.Color('#8f8983'),
  rockDark: new THREE.Color('#6e6964'),
  rockCool: new THREE.Color('#7b8189'),
  snow: new THREE.Color('#f3f7fb'),
  snowShade: new THREE.Color('#cbd8e8'),
  grass: new THREE.Color('#6a8a48'),
  grassDry: new THREE.Color('#a49a63'),
};

export class HaiziTerrain extends HeightGrid {
  /** 水位偏移（米）：首领战涨水、湖面通电时改它；waterLevelAt 算上它 */
  lakeRise = 0;

  constructor() {
    super(MAP.bounds);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const k = this.idx(i, j);
      const m = macroAt(this.X(i), this.Z(j));
      this.h[k] = m.h;
      this.basin[k] = m.bound;
    }
    this.paint();
  }

  /** 湖面高度（含涨水）；湖盆以外返回 −∞ */
  waterLevelAt(x: number, z: number): number {
    return Math.hypot(x, z) < 95 ? LAKE.level + this.lakeRise : -Infinity;
  }

  /** 当前水位下的岸线半径（湖岸缓坡单调，二分） */
  shorelineR(rise = this.lakeRise): number {
    const level = LAKE.level + rise;
    let lo = LAKE.deepR - 4, hi = LAKE.shoreOuterR + 15;
    for (let n = 0; n < 24; n++) {
      const mid = (lo + hi) / 2;
      if (shoreProfile(mid) < level) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** 地标摆放接口（4-1 的地标搭法会问离路多远）：这张图没有路 */
  roadNearest(_x: number, _z: number): { d: number } { return { d: Infinity }; }

  private paint(): void {
    const c = new THREE.Color(), tmp = new THREE.Color();
    const { nx, nz } = this;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = this.idx(i, j);
      const x = this.X(i), z = this.Z(j);
      const h = this.h[k];
      const r = Math.hypot(x, z);
      const gx = (this.h[this.idx(Math.min(nx - 1, i + 1), j)] - this.h[this.idx(Math.max(0, i - 1), j)]) / 2;
      const gz = (this.h[this.idx(i, Math.min(nz - 1, j + 1))] - this.h[this.idx(i, Math.max(0, j - 1))]) / 2;
      const slope = Math.atan(Math.hypot(gx, gz));
      const n1 = fbm(x * 0.03, z * 0.03, 3, 71), n2 = fbm(x * 0.11, z * 0.11, 2, 72);
      // 底色：碎石湖岸（冷灰带一点暖）
      c.copy(PAL.gravel).lerp(PAL.gravelWarm, smoothstep(0.4, 0.75, n1) * 0.7);
      let grass = 0, rock = 0, snow = 0, dirt = 1;
      // 湖底：近岸浅青、深处暗青（水面是半透明的乳白青绿，湖底只透一点）
      if (h < -0.05) {
        tmp.copy(PAL.bedShallow).lerp(PAL.bedDeep, smoothstep(-0.5, -4, h));
        c.lerp(tmp, smoothstep(-0.05, -0.6, h));
      } else if (h < 0.35) {
        // 水线上下一圈湿石头
        c.lerp(PAL.gravelWet, (1 - smoothstep(0.05, 0.35, h)) * 0.6);
      }
      // 高山草甸：湖岸外圈和南面谷口一块块的（牛奶海边草很少，越往外越多）
      if (h > 0.4 && slope < 0.5) {
        const patch = smoothstep(0.52, 0.72, n1 + n2 * 0.25) * smoothstep(58, 72, r) * (1 - smoothstep(18, 34, h));
        const southBoost = smoothstep(0.5, 0.9, Math.cos(angDiff(Math.atan2(x, -z), Math.PI))) * 0.3;
        grass = clamp01(patch + southBoost * smoothstep(60, 80, r) * (1 - smoothstep(18, 34, h)));
        if (ISLAND.r + 1 > Math.hypot(x - ISLAND.x, z - ISLAND.z) && h > 0.6) grass = Math.max(grass, smoothstep(0.45, 0.7, n2) * 0.6);
        c.lerp(n2 > 0.5 ? PAL.grass : PAL.grassDry, grass * 0.85);
      }
      // 岩：冰斗壁的陡坡、岩脊
      rock = smoothstep(0.55, 0.85, slope);
      if (r > LAKE.shoreOuterR + 5) rock = Math.max(rock, smoothstep(0.55, 0.78, fbm(x * 0.04 + 3, z * 0.04, 3, 73)) * smoothstep(0.3, 0.6, slope));
      if (rock > 0) {
        tmp.copy(PAL.rock).lerp(PAL.rockDark, smoothstep(0.4, 0.7, n2)).lerp(PAL.rockCool, smoothstep(0.5, 0.8, n1) * 0.5);
        c.lerp(tmp, rock);
      }
      // 雪：坡上 14 m 往上，北坡（阴面）更低；太陡的岩壁挂不住雪
      const north = Math.max(0, -z / Math.max(1, r));
      snow = smoothstep(34 - north * 10, 60 - north * 10, h + (n1 - 0.5) * 18) * (1 - smoothstep(0.95, 1.25, slope) * 0.75);
      // 坡上残雪：背阴的冲沟里一条条
      snow = Math.max(snow, smoothstep(0.62, 0.78, fbm(x * 0.05, z * 0.05, 3, 77)) * smoothstep(8, 20, h) * (0.4 + north * 0.6));
      if (snow > 0) {
        tmp.copy(PAL.snow).lerp(PAL.snowShade, smoothstep(0.7, 1.0, slope) * 0.6 + north * 0.15);
        c.lerp(tmp, snow);
      }
      grass *= (1 - rock) * (1 - snow);
      dirt = clamp01(1 - grass - rock - snow);
      this.grass[k] = grass;
      this.mat[k * 4] = grass; this.mat[k * 4 + 1] = rock * (1 - snow);
      this.mat[k * 4 + 2] = snow; this.mat[k * 4 + 3] = dirt;
      this.colors[k * 3] = c.r; this.colors[k * 3 + 1] = c.g; this.colors[k * 3 + 2] = c.b;
    }
  }
}

const FAR_ROCK = new THREE.Color('#77716b'), FAR_GRAVEL = new THREE.Color('#9d968b'), FAR_SNOW = new THREE.Color('#f2f6fb'), FAR_GRASS = new THREE.Color('#5f7a4a');

/** 图外 1.4 km 的地形：同一个地形函数往外延伸（冰斗壁、朝神山的谷地），图内部分不画（由高度图负责） */
export function buildFarTerrain(terrain: HaiziTerrain): THREE.Mesh {
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
      const far = smoothstep(300, 900, Math.hypot(x, z));
      y = m.h + far * (fbm(x * 0.002, z * 0.002, 3, 74) - 0.35) * 220 * (1 - 0.8 * m.window);
    }
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
  }
  const c = new THREE.Color();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
    const yr = i < n - 1 ? pos[(k + 1) * 3 + 1] : y, yd = j < n - 1 ? pos[(k + n) * 3 + 1] : y;
    const slope = Math.atan(Math.hypot(yr - y, yd - y) / cell);
    c.copy(fbm(x * 0.004, z * 0.004, 2, 75) > 0.5 ? FAR_GRAVEL : FAR_GRASS).lerp(FAR_ROCK, smoothstep(0.45, 0.85, slope) * 0.85);
    c.lerp(FAR_SNOW, smoothstep(60, 140, y + (fbm(x * 0.006, z * 0.006, 3, 76) - 0.5) * 60) * (1 - smoothstep(0.9, 1.2, slope) * 0.6));
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
