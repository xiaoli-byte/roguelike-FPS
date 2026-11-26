/**
 * 俯视遮挡图（docs/art/reference-tingyuyuan.md 第四节第 7 项）：从正上方往下拍一次整张图，每个像素记那里最高的表面的世界高度
 * （地面、屋顶、桥面、树冠、水面）。雨（rain.ts）落到它以下就没了——檐下、树下、桥下没雨；
 * 湿表面（materials.ts 的 wet 块）拿它判断头顶有没有遮挡——檐下的墙脚、桥下的地面是干的。
 *
 * 建场景时拍一次（静态）。天空、透明的东西（雾、云、粒子、绘景板）、怪、草不拍。
 * 世界 → 贴图：u = (x − minX) / 宽，v = 1 − (z − minZ) / 深（WORLD_UNIFORMS.uCoverXf = (minX, minZ, 1/宽, 1/深)）。
 */
import * as THREE from 'three';
import type { HeightGrid } from './grid';
import { COVER_GLSL, WORLD_UNIFORMS } from './materials';

export { COVER_GLSL };

const BAKE_VS = /* glsl */ `
varying float vY;
void main() {
  vec4 wp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vY = wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BAKE_FS = /* glsl */ `
varying float vY;
void main() { gl_FragColor = vec4(vY, 0.0, 0.0, 1.0); }`;

export interface CoverMapResult {
  texture: THREE.Texture;
  /** 渲染目标（要在 CPU 上查高度时 readRenderTargetPixels） */
  target: THREE.WebGLRenderTarget;
  /** 每像素多少米 */
  metersPerPixel: number;
}

/**
 * 拍遮挡图。hide：额外不拍的（怪、草、会动的东西）；不写深度 / 透明的、粒子、线、精灵自动不拍。
 * res：贴图边长（像素），缺省 2048（4-1 约 0.34 m 一像素）。
 */
export function bakeCoverMap(renderer: THREE.WebGLRenderer, scene: THREE.Scene, terrain: HeightGrid, hide: THREE.Object3D[] = [], res = 2048): CoverMapResult {
  const W = terrain.maxX - terrain.minX, D = terrain.maxZ - terrain.minZ;
  const target = new THREE.WebGLRenderTarget(res, res, {
    type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, D / 2, -D / 2, 1, 20000);
  const cx = (terrain.minX + terrain.maxX) / 2, cz = (terrain.minZ + terrain.maxZ) / 2;
  cam.position.set(cx, 10000, cz);
  cam.up.set(0, 0, -1);           // 画面右 = +x，画面上 = −z
  cam.lookAt(cx, 0, cz);
  cam.updateMatrixWorld(true);

  const hidden: THREE.Object3D[] = [...hide];
  scene.traverse(o => {
    if (!o.visible) return;
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    const one = Array.isArray(m) ? m[0] : m;
    const isSky = o.name === 'sky' || o.name === 'sky-linear';
    if (isSky || (one && (one.transparent || !one.depthWrite)) || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) hidden.push(o);
  });
  const vis = hidden.map(o => o.visible);
  hidden.forEach(o => { o.visible = false; });
  const mat = new THREE.ShaderMaterial({ vertexShader: BAKE_VS, fragmentShader: BAKE_FS, side: THREE.DoubleSide });
  const prevOverride = scene.overrideMaterial, prevTarget = renderer.getRenderTarget(), prevAuto = renderer.shadowMap.autoUpdate;
  const prevFog = scene.fog;
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  try {
    scene.overrideMaterial = mat;
    scene.fog = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    scene.overrideMaterial = prevOverride;
    scene.fog = prevFog;
    renderer.shadowMap.autoUpdate = prevAuto;
    hidden.forEach((o, i) => { o.visible = vis[i]; });
    mat.dispose();
  }
  WORLD_UNIFORMS.uCoverTex.value = target.texture;
  (WORLD_UNIFORMS.uCoverXf.value as THREE.Vector4).set(terrain.minX, terrain.minZ, 1 / W, 1 / D);
  return { texture: target.texture, target, metersPerPixel: Math.max(W, D) / res };
}
