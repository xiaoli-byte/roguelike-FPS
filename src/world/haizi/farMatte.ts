/**
 * 4-4 神山海子的远山绘景（matte painting）：神山、两侧远峰和它们背后的天，直接用概念图上画好的那一块
 * （docs/art/concepts/ch4-631/4-4_haizi_scene_v5.jpg，裁剪和抠透明见 tools/make_far_matte.py）。
 *
 * 远山走不到，又是画面 631 里的「一」——程序拼的山再怎么调也不像画，所以这里不再建模，贴一块绘景背景板：
 * 概念图是在出生点白模上重绘的，相机参数已知（render_blockouts.mjs 的 VIEWS['4-4']），
 * 把裁剪框里每个点按那台相机反投影到眼前 1.5 km 的竖直面上，背景板从出生点看就和概念图逐像素对齐；
 * 可玩区只有半径 80 m，1.5 km 外的东西在湖岸上走动时视差不到 3°，看不出是一张板。
 *
 * 着色：画里已经有空气透视，所以不吃场景雾、不过色调映射；雷暴（WORLD_UNIFORMS.uStorm）时压暗去饱和，闪电时提亮。
 * 湖面的平面反射会把它也画进去——概念图里湖中那道金色倒影就是它。
 */
import * as THREE from 'three';
import { WORLD_UNIFORMS } from '../plateau/materials';

export const MATTE = {
  /** public/ 下的路径（运行时拼 BASE_URL） */
  url: 'assets/environment/haizi/far_mountains_matte.webp',
  /** 绘景在概念图（2048 × 1152）里的归一化范围：tools/make_far_matte.py 的 BOX 左右各加宽 PAD（可以超出 0..1，就是画框外的方向） */
  u0: (256 - 384) / 2048, u1: (1792 + 384) / 2048, v0: 0, v1: 576 / 1152,   // 左右各加宽 384 px（make_far_matte.py 的 PAD）
  /** 概念图那台相机：出生点眼睛、朝向（度）、竖直视角、画幅 */
  eye: [-18, 3.5, 67.6] as const, yawDeg: -15, pitchDeg: 3, fovDeg: 50, aspect: 16 / 9,
  /** 背景板离眼睛的水平距离（m）：在冰斗壁（440 m）和远景地形（1.4 km）之外 */
  distance: 1500,
  /** 网格细分：竖直面相对画面有一点仰角，分细一点，贴图和概念图逐点对得上 */
  cols: 32, rows: 10,
};

export interface FarMatte {
  mesh: THREE.Mesh;
  /** 贴图加载完（截图脚本等它） */
  ready: Promise<void>;
}

/** 画概念图的那台相机（出生点机位）：远山绘景反投影、投影绘景（paintProject.ts）都用它 */
export function matteCamera(near = 0.1, far = 10000): THREE.PerspectiveCamera {
  const M = MATTE;
  const cam = new THREE.PerspectiveCamera(M.fovDeg, M.aspect, near, far);
  cam.position.set(...M.eye);
  cam.rotation.set(THREE.MathUtils.degToRad(M.pitchDeg), THREE.MathUtils.degToRad(M.yawDeg), 0, 'YXZ');
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

export function buildFarMatte(baseUrl: string): FarMatte {
  const M = MATTE;
  const cam = matteCamera();
  const eye = cam.position.clone();
  const yaw = THREE.MathUtils.degToRad(M.yawDeg);
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));   // 水平朝前
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const p = new THREE.Vector3();
  for (let r = 0; r <= M.rows; r++) for (let c = 0; c <= M.cols; c++) {
    const s = c / M.cols, t = r / M.rows;                              // 贴图坐标（t 从上往下）
    const u = M.u0 + (M.u1 - M.u0) * s, v = M.v0 + (M.v1 - M.v0) * t;  // 概念图里的位置
    p.set(u * 2 - 1, 1 - v * 2, 0.5).unproject(cam).sub(eye).normalize();
    const k = M.distance / p.dot(fwd);                                 // 射线打到眼前 distance 处的竖直面
    pos.push(eye.x + p.x * k, eye.y + p.y * k, eye.z + p.z * k);
    uv.push(s, 1 - t);
  }
  for (let r = 0; r < M.rows; r++) for (let c = 0; c < M.cols; c++) {
    const a = r * (M.cols + 1) + c, b = a + 1, d = a + M.cols + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);

  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStorm = WORLD_UNIFORMS.uStorm;
    shader.uniforms.uFlash = WORLD_UNIFORMS.uFlash;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uStorm;\nuniform float uFlash;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  // 雷暴：远山压暗、去饱和，沉进乌云里；闪电一亮
  float gray = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(gray) * 0.42, uStorm * 0.85) + vec3(0.9, 0.85, 1.0) * uFlash * 0.18;`);
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'far-mountains-matte';
  mesh.renderOrder = -800;          // 透明队列里排在云天（−900）后面：盖住云；雾带（−5）、水面在它前面
  mesh.frustumCulled = false;
  mesh.visible = false;             // 贴图到了再显示
  const ready = new Promise<void>((resolve) => {
    if (typeof document === 'undefined') { resolve(); return; }
    new THREE.ImageLoader().load(baseUrl + M.url, (img) => {
      tex.image = img;
      tex.needsUpdate = true;
      mesh.visible = true;
      resolve();
    }, undefined, () => resolve());   // 加载失败：只是没有远山，场景照常
  });
  return { mesh, ready };
}
