/**
 * 俯视遮挡图（docs/art/reference-tingyuyuan.md 第四节第 7 项）：从正上方往下拍一次整张图，每个像素记那里最高的表面的世界高度
 * （地面、屋顶、桥面、树冠、水面）。雨（rain.ts）落到它以下就没了——檐下、树下、桥下没雨；
 * 湿表面（materials.ts 的 wet 块）拿它判断头顶有没有遮挡——檐下的墙脚、桥下的地面是干的。
 *
 * 建场景时拍一次（静态）。天空、透明的东西（雾、云、粒子、绘景板）、怪、草不拍。
 * 另拍一张低一点分辨率的读回 CPU（heightAt）：环境声床（ambienceSense.ts）拿它判断头顶有没有屋顶、四周有没有墙、离檐口多远。
 * 世界 → 贴图：u = (x − minX) / 宽，v = 1 − (z − minZ) / 深（WORLD_UNIFORMS.uCoverXf = (minX, minZ, 1/宽, 1/深)）。
 */
import * as THREE from 'three';
import type { GridBounds } from './grid';
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
  /** CPU 上查遮挡高度（最近的像素）；图外 / 没读回来返回 −1e4 */
  heightAt: (x: number, z: number) => number;
}

/**
 * 拍遮挡图。hide：额外不拍的（怪、草、会动的东西）；不写深度 / 透明的、粒子、线、精灵自动不拍。
 * terrain：拍哪一块（世界坐标的边界；高原地形本身就是）。res：贴图边长（像素），缺省 2048（4-1 约 0.34 m 一像素）；cpuRes：读回 CPU 那张的边长，缺省 1024（0 = 不读）。
 */
export function bakeCoverMap(renderer: THREE.WebGLRenderer, scene: THREE.Scene, terrain: GridBounds, hide: THREE.Object3D[] = [], res = 2048, cpuRes = 1024): CoverMapResult {
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
  let cpu: Float32Array | null = null;
  try {
    scene.overrideMaterial = mat;
    scene.fog = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    // 4-4 湖面的 onBeforeRender 画完倒影会把天空设回可见：拍第二张之前再藏一遍，不然拍进 4000 m 的天穹
    hidden.forEach(o => { o.visible = false; });
    if (cpuRes > 0) cpu = readBack(renderer, scene, cam, cpuRes);
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
  const minX = terrain.minX, minZ = terrain.minZ, N = cpuRes;
  const heightAt = (x: number, z: number): number => {
    if (!cpu) return -1e4;
    const u = (x - minX) / W, v = 1 - (z - minZ) / D;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return -1e4;
    return cpu[Math.floor(v * N) * N + Math.floor(u * N)];
  };
  return { texture: target.texture, target, metersPerPixel: Math.max(W, D) / res, heightAt };
}

/** 同一个机位再拍一张 RGBA 浮点（读回格式各家都支持）、只留 R 通道；第 0 行 = 贴图 v = 0 */
function readBack(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, n: number): Float32Array | null {
  const rt = new THREE.WebGLRenderTarget(n, n, {
    type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
  try {
    renderer.setRenderTarget(rt);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    const rgba = new Float32Array(n * n * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, n, n, rgba);
    const out = new Float32Array(n * n);
    for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
    return out;
  } catch (err) {
    console.warn('[coverMap] 读回 CPU 失败，声床当作四周空旷', err);
    return null;
  } finally {
    rt.dispose();
  }
}
