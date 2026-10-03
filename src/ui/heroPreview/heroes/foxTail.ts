/**
 * 赤狐的蓬松大尾巴：一条按骨骼链蒙皮的低多边形毛管（SkinnedMesh）。
 * 静止姿态沿本地 +Y 伸直，bones[i] 位于第 i 节起点，最后一根骨骼在尾尖。
 *
 * 造型：毛管由一层层「毛片」叠成——每片从窄圈向尾尖方向张开到宽圈，再在宽圈处陡然收回，
 * 平直着色下形成朝尾尖翻起的锯齿状毛簇轮廓（像叠瓦）；宽圈上的顶点再交替伸缩，让每片的边缘成为一簇簇尖毛。
 * 顶点色从尾根深赤渐变到尾尖白，收进去的窄圈压暗一档，给毛片之间一点缝隙阴影。
 */
import * as THREE from 'three';

export interface FoxTail {
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
}

export interface TailOpts {
  lengths: readonly number[];
  /** 每节起点半径，长度 = lengths.length + 1（最后一个为尾尖半径） */
  radii: readonly number[];
  radial: number;
  /** 毛片数（沿整条尾巴均匀分布） */
  tufts: number;
  rand: () => number;
  /** 沿尾长 u∈[0,1] 的颜色（写进 out） */
  color: (u: number, out: THREE.Color) => void;
}

export function buildFoxTail(mat: THREE.Material, o: TailOpts): FoxTail {
  const n = o.lengths.length;
  const starts: number[] = [0];
  for (let i = 0; i < n; i++) starts.push(starts[i] + o.lengths[i]);
  const L = starts[n];
  const centers = o.lengths.map((len, i) => starts[i] + len / 2);

  const radiusAt = (y: number): number => {
    if (y <= 0) return o.radii[0];
    if (y >= L) return o.radii[n];
    let i = 0;
    while (i < n - 1 && y > starts[i + 1]) i++;
    const f = (y - starts[i]) / o.lengths[i];
    const s = f * f * (3 - 2 * f);
    return o.radii[i] + (o.radii[i + 1] - o.radii[i]) * s;
  };

  const pos: number[] = [];
  const col: number[] = [];
  const skinI: number[] = [];
  const skinW: number[] = [];
  const c = new THREE.Color();
  const weights = (y: number): [number, number, number] => {
    if (y <= centers[0]) return [0, 0, 0];
    if (y >= centers[n - 1]) {
      const f = Math.min(1, (y - centers[n - 1]) / (L - centers[n - 1]));
      return [n - 1, n, f * 0.5];
    }
    let i = 0;
    while (i < n - 2 && y > centers[i + 1]) i++;
    return [i, i + 1, (y - centers[i]) / (centers[i + 1] - centers[i])];
  };
  const pushVert = (x: number, y: number, z: number, u: number, shade: number): void => {
    pos.push(x, y, z);
    o.color(u, c);
    col.push(c.r * shade, c.g * shade, c.b * shade);
    const [a, b, w] = weights(y);
    skinI.push(a, b, 0, 0);
    skinW.push(1 - w, w, 0, 0);
  };

  const R = o.radial;
  // 圈：尾根内收的一圈，然后每片毛 = 窄圈（略高于上一片的宽圈）+ 宽圈（片的尾尖端）。
  // 宽圈的顶点交替「伸长并朝尾尖翘」/「缩回」，片的边缘成为一圈锯齿状的尖毛簇（不是整齐的环纹）。
  interface RingSpec { y: number; k: number; shade: number; spike: number; gap: number }
  const rings: RingSpec[] = [{ y: -0.05, k: 0.66, shade: 0.82, spike: 0, gap: 0 }];
  const y0 = 0.03;
  const y1 = L * 0.96;
  for (let s = 0; s < o.tufts; s++) {
    const a = y0 + ((y1 - y0) * s) / o.tufts;
    const b = y0 + ((y1 - y0) * (s + 1)) / o.tufts;
    const u = b / L;
    rings.push({ y: a + (b - a) * 0.34, k: 0.9, shade: 0.86, spike: 0, gap: 0 });
    rings.push({ y: b, k: 1.0, shade: 1, spike: 0.1 + 0.1 * u, gap: b - a });
  }

  for (let r = 0; r < rings.length; r++) {
    const g = rings[r];
    const base = radiusAt(g.y) * g.k;
    // 每圈错开半格 → 菱形面片
    const twist = (r * Math.PI) / R + (r >> 1) * 0.41;
    for (let k = 0; k < R; k++) {
      const a = twist + (k / R) * Math.PI * 2 + (o.rand() - 0.5) * 0.24;
      let rr = base * (1 + (o.rand() - 0.5) * 0.08);
      let y = g.y + (o.rand() - 0.5) * 0.006;
      if (g.spike) {
        const tip = (k + (r >> 1)) % 2 === 0;
        const j = 0.6 + o.rand() * 0.7;
        rr *= tip ? 1 + g.spike * j : 1 - g.spike * 0.35;
        y += tip ? g.gap * (0.12 + 0.14 * o.rand()) : -g.gap * 0.15;
      }
      pushVert(Math.cos(a) * rr, y, Math.sin(a) * rr * 0.9, Math.max(0, g.y) / L, g.shade);
    }
  }
  const tipIdx = pos.length / 3;
  pushVert(0, L + o.radii[n] * 2.2, 0, 1, 1);
  const baseIdx = pos.length / 3;
  pushVert(0, -0.08, 0, 0, 0.8);

  const idx: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < R; k++) {
      const a = r * R + k;
      const b = r * R + ((k + 1) % R);
      const c2 = (r + 1) * R + k;
      const d = (r + 1) * R + ((k + 1) % R);
      idx.push(a, c2, b, b, c2, d);
    }
  }
  const last = (rings.length - 1) * R;
  for (let k = 0; k < R; k++) {
    idx.push(last + k, tipIdx, last + ((k + 1) % R));
    idx.push(k, (k + 1) % R, baseIdx);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const bones: THREE.Bone[] = [];
  for (let i = 0; i <= n; i++) {
    const b = new THREE.Bone();
    b.position.y = i === 0 ? 0 : o.lengths[i - 1];
    if (i > 0) bones[i - 1].add(b);
    bones.push(b);
  }
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false;
  return { mesh, bones };
}
