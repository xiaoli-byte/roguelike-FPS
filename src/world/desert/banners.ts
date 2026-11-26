import * as THREE from 'three';
import type { DesertPart, Rgb } from './spec';

/**
 * 旗幡（docs/art/level-art.md「特效」：环境里会动的东西）：立杆挑着的长幡、门楣 / 檐下挂下来的幡。
 * 敦煌一带的幡是一条竖长的布（顶上一根横杆挑着，底下剪成燕尾），褪了色的朱红 / 土黄 / 靛蓝。
 *
 * 所有布合成一个网格、所有杆合成一个网格：整组两次绘制调用。布的翻动在顶点着色器里算——
 * 离挂点越远摆得越开（aFlap 0..1），一道波从挂点往下走，再叠一点横向的抖；风大的时候整条布被吹得斜起来。
 * 布用双面的标准材质（吃场景的光、雾和调色），杆是深木色、杆头一个铜色的小宝珠。
 *
 * 用法：
 *   const banners = new Banners([{ kind: 'pole', at: [x, groundY, z], height: 7, length: 3.2, width: 0.8 }], { wind: [-0.8, 0.6] });
 *   group.add(banners.group);   // 每帧 banners.update(dt, t)；卸载时 dispose()
 */
export interface Banner {
  /** pole = 立杆挑幡（杆 + 顶上的横杆 + 竖挂的长幡）；hang = 从檐下 / 门楣挂下来的一条（只有横杆和布） */
  kind: 'pole' | 'hang';
  /** pole：杆脚（世界坐标，y = 地面）；hang：挂点（横杆中点，世界坐标） */
  at: [number, number, number];
  /** 布长、布宽（m） */
  length: number;
  width: number;
  /** pole：杆高（m），默认 length + 2.5 */
  height?: number;
  /** 布面朝向（方位角，度，0 = 布面朝 +Z、横杆沿 X），默认 0 */
  yaw?: number;
  /** 布的颜色（sRGB 0..1），默认褪色朱红 */
  color?: Rgb;
  /** 底边剪成燕尾，默认 true */
  swallowtail?: boolean;
}

export interface BannerOptions {
  /** 风吹向（XZ，单位向量） */
  wind: [number, number];
  /** 风力 0..1，默认 0.6 */
  strength?: number;
  seed?: number;
}

/** 敦煌幡的几种褪色布色（sRGB） */
export const BANNER_COLORS = {
  vermilion: [0.66, 0.2, 0.14] as Rgb,
  ochre: [0.78, 0.56, 0.24] as Rgb,
  indigo: [0.2, 0.27, 0.46] as Rgb,
  ivory: [0.86, 0.8, 0.68] as Rgb,
};

const ROWS = 12;
/** 布的「环境光」份额（自发光 × 布色） */
const AMBIENT = 0.42;

export class Banners implements DesertPart {
  readonly group = new THREE.Group();
  private readonly uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3(1, 0, 0) } };
  private readonly disposables: { dispose(): void }[] = [];

  constructor(banners: readonly Banner[], options: BannerOptions) {
    this.group.name = 'DesertBanners';
    const wl = Math.hypot(options.wind[0], options.wind[1]) || 1;
    this.uniforms.uWind.value.set(options.wind[0] / wl, options.strength ?? 0.6, options.wind[1] / wl);
    let seed = options.seed ?? 917;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    // ── 布：每条 ROWS 段 × 3 列顶点（左 / 中 / 右），燕尾 = 底边中点往上提 ──
    const pos: number[] = [], col: number[] = [], flap: number[] = [], idx: number[] = [];
    const lin = new THREE.Color();
    // ── 杆：圆柱 + 横杆 + 宝珠，合进一个几何体 ──
    const poleParts: THREE.BufferGeometry[] = [], finials: THREE.BufferGeometry[] = [];
    for (const b of banners) {
      const yaw = (b.yaw ?? 0) * Math.PI / 180, ax = Math.cos(yaw), az = -Math.sin(yaw);
      const top: [number, number, number] = b.kind === 'pole'
        ? [b.at[0], b.at[1] + (b.height ?? b.length + 2.5), b.at[2]]
        : [b.at[0], b.at[1], b.at[2]];
      const color = b.color ?? BANNER_COLORS.vermilion, phase = rnd() * 6.283, tail = b.swallowtail ?? true;
      const base = pos.length / 3;
      for (let r = 0; r <= ROWS; r++) {
        const v = r / ROWS;
        for (let c = 0; c < 3; c++) {
          const u = c / 2 - 0.5;
          let y = top[1] - 0.12 - v * b.length;
          if (tail && r === ROWS && c === 1) y += b.length * 0.16;
          // 布边上颜色略深一点（褪色从中间开始）；顶点色按线性存（给的是 sRGB）
          const shade = c === 1 ? 1 : 0.9;
          lin.setRGB(color[0] * shade, color[1] * shade, color[2] * shade, THREE.SRGBColorSpace);
          pos.push(top[0] + ax * u * b.width, y, top[2] + az * u * b.width);
          col.push(lin.r, lin.g, lin.b);
          flap.push(v, phase, u, b.length);
        }
      }
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < 2; c++) {
        const a = base + r * 3 + c, d = a + 3;
        idx.push(a, d, a + 1, a + 1, d, d + 1);
      }
      // 横杆（比布宽 0.3 m）
      const bar = new THREE.CylinderGeometry(0.035, 0.035, b.width + 0.3, 6);
      bar.rotateZ(Math.PI / 2);
      bar.rotateY(yaw);
      bar.translate(top[0], top[1] - 0.08, top[2]);
      poleParts.push(bar);
      if (b.kind === 'pole') {
        const h = top[1] - b.at[1];
        const pole = new THREE.CylinderGeometry(0.055, 0.08, h + 0.35, 7);
        pole.translate(b.at[0], b.at[1] - 0.35 + (h + 0.35) / 2, b.at[2]);
        poleParts.push(pole);
        const ball = new THREE.SphereGeometry(0.13, 8, 6);
        ball.translate(top[0], top[1] + 0.12, top[2]);
        finials.push(ball);
      }
    }

    const cloth = new THREE.BufferGeometry();
    cloth.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cloth.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    cloth.setAttribute('aFlap', new THREE.Float32BufferAttribute(flap, 4));
    cloth.setIndex(idx);
    cloth.computeVertexNormals();
    cloth.computeBoundingSphere();
    if (cloth.boundingSphere) cloth.boundingSphere.radius += 6;
    // 场景里没有给标准材质的环境光（风格化材质自己算三色环境光），背光面会全黑：
    // 自发光 = 布色 × AMBIENT 顶上环境光那一份，背光面也是褪色的红 / 黄 / 蓝，不是一条黑布
    const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, emissive: new THREE.Color(AMBIENT, AMBIENT, AMBIENT) });
    clothMat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance *= vColor.rgb;`);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
uniform vec3 uWind; // xz = 风向，y = 风力
attribute vec4 aFlap; // 离挂点 0..1、相位、横向 -0.5..0.5、布长`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float v = aFlap.x, ph = aFlap.y, L = aFlap.w;
  float s = uWind.y;
  vec3 wdir = vec3(uWind.x, 0.0, uWind.z);
  vec3 side = vec3(-uWind.z, 0.0, uWind.x);
  // 一道从挂点往下走的波 + 阵风的慢起伏
  float gust = 0.65 + 0.35 * sin(uTime * 0.37 + ph) * sin(uTime * 0.23 + ph * 1.7);
  float wave = sin(uTime * (3.2 + 1.4 * s) - v * 5.5 + ph);
  float bend = pow(v, 1.35) * L;
  transformed += wdir * bend * s * gust * (0.42 + 0.1 * wave);
  transformed.y += bend * s * gust * 0.18 * (1.0 + 0.4 * wave);
  transformed += side * v * L * 0.07 * wave * s;
  // 布面自己的起伏（横向两边比中间摆得多一点）
  transformed += wdir * 0.12 * L * v * aFlap.z * sin(uTime * 4.1 - v * 7.0 + ph * 2.0) * s;
}`);
    };
    const clothMesh = new THREE.Mesh(cloth, clothMat);
    clothMesh.name = 'DesertBanners.cloth';
    clothMesh.castShadow = true;
    this.group.add(clothMesh);
    this.disposables.push(cloth, clothMat);

    if (poleParts.length) {
      const poles = mergeGeometries(poleParts);
      const poleColor = new THREE.Color().setRGB(0.24, 0.17, 0.12, THREE.SRGBColorSpace);
      const poleMat = new THREE.MeshStandardMaterial({ color: poleColor, roughness: 0.9, emissive: poleColor.clone().multiplyScalar(AMBIENT) });
      const poleMesh = new THREE.Mesh(poles, poleMat);
      poleMesh.name = 'DesertBanners.poles';
      poleMesh.castShadow = true;
      this.group.add(poleMesh);
      this.disposables.push(poles, poleMat);
    }
    if (finials.length) {
      const balls = mergeGeometries(finials);
      const ballColor = new THREE.Color().setRGB(0.62, 0.46, 0.2, THREE.SRGBColorSpace);
      const ballMat = new THREE.MeshStandardMaterial({ color: ballColor, roughness: 0.45, metalness: 0.6, emissive: ballColor.clone().multiplyScalar(AMBIENT) });
      const ballMesh = new THREE.Mesh(balls, ballMat);
      ballMesh.name = 'DesertBanners.finials';
      this.group.add(ballMesh);
      this.disposables.push(balls, ballMat);
    }
    for (const g of [...poleParts, ...finials]) g.dispose();
  }

  update(_dt: number, t: number): void {
    this.uniforms.uTime.value = t;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}

/** 只合并 position / normal / uv 的简单几何（都来自 three 的基础体，非索引化后拼起来） */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [];
  for (const g of parts) {
    const flat = g.index ? g.toNonIndexed() : g;
    const p = flat.getAttribute('position'), n = flat.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    if (flat !== g) flat.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.computeBoundingSphere();
  return out;
}
