/**
 * 剑指的两根手指（Unity BladeSwordSign.cs，M10）。英雄的第一人称左手（SM_Arms_<英雄>L）是握护木姿势的一整块静态网格，没有手指骨骼，拳头张不开——
 * 所以剑指用程序姿态模拟：在拳头前沿食指、中指的指根处补两根伸直并拢的手指（8 棱锥台 + 圆头），其余三指与拇指仍是美术拳头里扣着的样子。
 * 手指直接用手臂自己的材质（同一张贴图），UV 钉在贴图里手套与指尖皮肤的两块纯色区域上：指根一截是手套色、指尖一截是皮肤色。
 * 指根位置、手指方向、两处 UV 按英雄登记（数据来自 Unity 对三只手臂网格的测量），没登记的手臂退回赤熊猫（燎）的数值。
 *
 * 坐标换算：Unity 的数值是 Unity 导入后的手臂局部空间（glTF → Unity 时 x 取反），这里取反回网页（glTF）的手臂空间；
 * UV 的 v 同样换回 glTF 约定（v_gltf = 1 − v_unity）。镜像后三角形绕序反过来。
 */
import * as THREE from 'three';

/** 一只左手的剑指数据（网页手臂局部空间）：食指 / 中指指根、手指方向、手套 / 皮肤 UV */
export interface SwordSignFit {
  index: THREE.Vector3;
  middle: THREE.Vector3;
  dir: THREE.Vector3;
  gloveUv: THREE.Vector2;
  skinUv: THREE.Vector2;
}

/** 食指 / 中指长度与半径（米，手臂局部）；指根这一截是手套（占指长的比例） */
export const SIGN = { indexLength: 0.068, middleLength: 0.075, indexRadius: 0.0105, middleRadius: 0.011, gloveFrac: 0.42 } as const;
const SIDES = 8;

/** Unity 手臂空间 → 网页手臂空间（x 取反）；Unity UV → glTF UV（v 翻转） */
const U = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(-x, y, z);
const UV = (u: number, v: number): THREE.Vector2 => new THREE.Vector2(u, 1 - v);

/** 手指方向（Unity (0.02, 0.18, −1)） */
const DIR = U(0.02, 0.18, -1).normalize();

const FITS: Record<string, SwordSignFit> = {
  SM_Arms_RedPandaL: { index: U(0.006, -0.04, -0.05), middle: U(-0.019, -0.042, -0.052), dir: DIR, gloveUv: UV(0.3894, 0.4328), skinUv: UV(0.0222, 0.8736) },
  SM_Arms_PangolinL: { index: U(0, -0.045, -0.045), middle: U(-0.024, -0.047, -0.05), dir: DIR, gloveUv: UV(0.7381, 0.3609), skinUv: UV(0.2696, 0.2311) },
  SM_Arms_FlyingSquirrelL: { index: U(-0.026, -0.04, -0.024), middle: U(-0.047, -0.042, -0.026), dir: DIR, gloveUv: UV(0.6809, 0.4018), skinUv: UV(0.5218, 0.5782) },
};

/** 按左手臂资产 id 取剑指数据（没登记的用燎的） */
export function swordSignFit(armId: string | null | undefined): SwordSignFit {
  return (armId && FITS[armId]) || FITS.SM_Arms_RedPandaL;
}

/** 食指指尖（手臂局部） */
export function indexTip(f: SwordSignFit, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(f.dir).multiplyScalar(SIGN.indexLength).add(f.index);
}

/** 两根手指的网格（手臂局部坐标）；指根一截 UV 钉在手套色、指尖一截钉在皮肤色（交界处两圈重合的顶点各用一种 UV） */
export function buildSwordSign(f: SwordSignFit): THREE.BufferGeometry {
  const V: number[] = [], UVs: number[] = [], T: number[] = [];
  finger(f.index, f.dir, SIGN.indexLength, SIGN.indexRadius, f, V, UVs, T);
  finger(f.middle, f.dir, SIGN.middleLength, SIGN.middleRadius, f, V, UVs, T);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UVs, 2));
  g.setIndex(T);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.name = 'Sword Sign Fingers';
  return g;
}

const _a = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();

/** 一根手指：指根略粗的 8 棱台 → 手套 / 皮肤交界（两圈）→ 指尖前一圈 → 半球形圆头 */
function finger(b: THREE.Vector3, dirIn: THREE.Vector3, len: number, r: number, f: SwordSignFit, V: number[], UVs: number[], T: number[]): void {
  const dir = dirIn.clone().normalize();
  // Unity 用 Cross(dir, up)；镜像空间里换成 Cross(up, dir)，两根轴跟着镜像（形状对称，任一组正交基都行）
  _a.crossVectors(new THREE.Vector3(0, 1, 0), dir);
  if (_a.lengthSq() < 1e-6) _a.crossVectors(new THREE.Vector3(1, 0, 0), dir);
  _a.normalize();
  _c.crossVectors(_a, dir);
  const rings: [number, number, boolean][] = [
    [0, 1.08, false], [SIGN.gloveFrac, 1, false], [SIGN.gloveFrac, 1, true], [1 - (r * 0.9) / len, 0.92, true], [1 - (r * 0.35) / len, 0.6, true],
  ];
  const start = V.length / 3;
  for (const [t, k, skin] of rings) {
    for (let s = 0; s < SIDES; s++) {
      const ang = (s * Math.PI * 2) / SIDES;
      _p.copy(b).addScaledVector(dir, t * len).addScaledVector(_a, Math.cos(ang) * r * k).addScaledVector(_c, Math.sin(ang) * r * k);
      V.push(_p.x, _p.y, _p.z);
      const uv = skin ? f.skinUv : f.gloveUv;
      UVs.push(uv.x, uv.y);
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    if (k === 1) continue; // 交界两圈重合：不连面
    for (let s = 0; s < SIDES; s++) {
      const i0 = start + k * SIDES + s, i1 = start + k * SIDES + ((s + 1) % SIDES);
      const j0 = i0 + SIDES, j1 = i1 + SIDES;
      // 右手系逆时针朝外
      T.push(i0, j0, i1, i1, j0, j1);
    }
  }
  // 圆头：最后一圈收到指尖一点
  const tip = V.length / 3;
  _p.copy(b).addScaledVector(dir, len);
  V.push(_p.x, _p.y, _p.z);
  UVs.push(f.skinUv.x, f.skinUv.y);
  const last = start + (rings.length - 1) * SIDES;
  for (let s = 0; s < SIDES; s++) T.push(last + s, tip, last + ((s + 1) % SIDES));
}
