/**
 * 4-4 神山海子的投影绘景（camera projection mapping）：把概念图（docs/art/concepts/ch4-631/4-4_haizi_scene_v5.jpg）
 * 从画它的那台相机（出生点机位，farMatte.ts 的 MATTE）投到冰斗壁、冰舌、冰斗缺口和远处湖岸的 3D 地形上。
 *
 * 为什么：程序着色的冰斗壁和缺口怎么调都只是「布局像」，画里那种一片片岩板夹雪、U 形谷底压暗、山脚一圈低雾、
 * 晨光的冷暖都出不来。绘景师的老办法是把画投到粗模上：出生点看过去就是那张画（画就是在这套白模上重绘的，形状对得上），
 * 换个位置看，颜色贴在几何上，视差是对的。
 *
 * 规则（按片元）：
 * - 只投到出生点相机看得见的面上：烘一张从投影机位看的深度图（第一次画湖的时候烘，静态场景只烘一次），比深度判遮挡；
 *   和投影方向几乎平行的面不投（拉伸）。
 * - 只投湖岸以外（离湖心 55 m 起渐入）；离镜头近（80 m 内渐出、50 m 内全无）退回程序着色——画只有 2048 宽，凑近了会糊。
 * - 画里的天、神山（make_far_matte.py 的保留区）和柱子、经幡、玛尼堆、湖心岛不投：贴图的透明通道 / 抹掉（make_far_matte.py）。
 * - 画里已经有光影和空气透视：直接替换最终颜色（雾、色调映射之后），不再打光；雷暴时和远山绘景一样压暗、去饱和。
 */
import * as THREE from 'three';
import { WORLD_UNIFORMS } from '../plateau/materials';
import { MATTE, matteCamera } from './farMatte';

export const PAINT = {
  /** public/ 下的路径：整张概念图（2048 × 1152），透明通道 = 投哪里 */
  url: 'assets/environment/haizi/scene_projection.webp',
  /** 离湖心多远开始投（m）：[全无, 全有] */
  ring: [55, 65] as const,
  /** 离镜头多近退回程序着色（m）：[全无, 全有] */
  near: [50, 80] as const,
  /** 深度图分辨率和投影机的近 / 远平面 */
  depthSize: [2048, 1152] as const,
  zNear: 10, zFar: 4000,
};

export interface PaintProjector {
  /** 给材质接上投影（链在已有的 onBeforeCompile 后面，程序缓存键加后缀） */
  apply(mat: THREE.Material): void;
  /** 烘深度图（要在场景里的静态件都摆好之后；hide 里的东西不挡投影） */
  bake(renderer: THREE.WebGLRenderer, scene: THREE.Scene, hide: THREE.Object3D[]): void;
  readonly baked: boolean;
  /** 贴图加载完 */
  ready: Promise<void>;
}

export function buildPaintProjector(baseUrl: string): PaintProjector {
  const cam = matteCamera(PAINT.zNear, PAINT.zFar);
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const target = new THREE.WebGLRenderTarget(PAINT.depthSize[0], PAINT.depthSize[1]);
  target.depthTexture = new THREE.DepthTexture(PAINT.depthSize[0], PAINT.depthSize[1]);
  target.depthTexture.minFilter = target.depthTexture.magFilter = THREE.NearestFilter;
  const uniforms = {
    uPaintTex: { value: tex as THREE.Texture },
    uPaintDepth: { value: target.depthTexture as THREE.Texture },
    uPaintVP: { value: vp },
    uPaintEye: { value: cam.position.clone() },
    uPaintOn: { value: 0 },
    uPaintRange: { value: new THREE.Vector4(PAINT.ring[0], PAINT.ring[1], PAINT.near[0], PAINT.near[1]) },
    uPaintClip: { value: new THREE.Vector2(PAINT.zNear, PAINT.zFar) },
  };
  let loaded = false, baked = false;
  const ready = new Promise<void>((resolve) => {
    if (typeof document === 'undefined') { resolve(); return; }
    new THREE.ImageLoader().load(baseUrl + PAINT.url, (img) => {
      tex.image = img;
      tex.needsUpdate = true;
      loaded = true;
      if (baked) uniforms.uPaintOn.value = 1;
      resolve();
    }, undefined, () => resolve());   // 加载失败：退回程序着色
  });

  const apply = (mat: THREE.Material): void => {
    const prev = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey.bind(mat);
    mat.customProgramCacheKey = () => `${prevKey()}:paint`;
    mat.onBeforeCompile = (shader, renderer) => {
      prev.call(mat, shader, renderer);
      Object.assign(shader.uniforms, uniforms, { uStorm: WORLD_UNIFORMS.uStorm, uFlash: WORLD_UNIFORMS.uFlash });
      // patchMaterial 已经声明过 uStorm 的话不再重复声明
      const decl = (name: string): string => (shader.fragmentShader.includes(`uniform float ${name};`) ? '' : `uniform float ${name};`);
      const stormDecl = decl('uStorm'), flashDecl = decl('uFlash');
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPpWorld;\nvarying vec3 vPpN;')
        .replace('#include <project_vertex>', `#include <project_vertex>
  vPpWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vPpN = normalize(mat3(modelMatrix) * objectNormal);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vPpWorld;
varying vec3 vPpN;
uniform sampler2D uPaintTex;
uniform sampler2D uPaintDepth;
uniform mat4 uPaintVP;
uniform vec3 uPaintEye;
uniform float uPaintOn;
uniform vec4 uPaintRange;
uniform vec2 uPaintClip;
${stormDecl}
${flashDecl}`)
        .replace('#include <dithering_fragment>', `{
  // 投影绘景（paintProject.ts）：出生点相机看得见、离湖心够远、离镜头够远的面，最终颜色换成画里的颜色
  vec4 pc = uPaintVP * vec4(vPpWorld, 1.0);
  float w = uPaintOn * step(0.001, pc.w);
  vec3 nd = pc.xyz / max(pc.w, 1e-4);
  vec2 st = nd.xy * 0.5 + 0.5;
  w *= step(0.0, st.x) * step(st.x, 1.0) * step(0.0, st.y) * step(st.y, 1.0);
  if (w > 0.0) {
    // 遮挡：深度图里存的是投影机位看到的最近表面，比它远（超过一点余量）就是被挡住的
    float d = texture2D(uPaintDepth, st).r * 2.0 - 1.0;
    float n = uPaintClip.x, f = uPaintClip.y;
    float seen = 2.0 * n * f / (f + n - d * (f - n));
    w *= step(pc.w, seen + 1.5 + pc.w * 0.012);
    // 和投影方向几乎平行的面（会拉成长条）不投
    w *= smoothstep(0.04, 0.2, abs(dot(normalize(vPpN), normalize(uPaintEye - vPpWorld))));
    w *= smoothstep(uPaintRange.x, uPaintRange.y, length(vPpWorld.xz));
    w *= smoothstep(uPaintRange.z, uPaintRange.w, distance(cameraPosition, vPpWorld));
    vec4 p = texture2D(uPaintTex, st);
    w *= p.a;
    vec3 c = p.rgb;
    float gray = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3(gray) * 0.42, uStorm * 0.85) + vec3(0.9, 0.85, 1.0) * uFlash * 0.18;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(c, 1.0)).rgb, w);
  }
}
#include <dithering_fragment>`);
    };
    mat.needsUpdate = true;
  };

  const bake = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, hide: THREE.Object3D[]): void => {
    // 不写深度的东西（雾带、云、远山绘景、粒子）换成覆盖材质后会挡住投影，一起藏起来
    hide = [...hide];
    scene.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const one = Array.isArray(m) ? m[0] : m;
      if (o.visible && ((one && (one.transparent || !one.depthWrite)) || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite)) hide.push(o);
    });
    const vis = hide.map(o => o.visible);
    hide.forEach(o => { o.visible = false; });
    const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.shadowMap.autoUpdate, prevOverride = scene.overrideMaterial;
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    scene.overrideMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    (scene.overrideMaterial as THREE.Material).dispose();
    scene.overrideMaterial = prevOverride;
    renderer.shadowMap.autoUpdate = prevAuto;
    renderer.xr.enabled = prevXr;
    hide.forEach((o, i) => { o.visible = vis[i]; });
    baked = true;
    if (loaded) uniforms.uPaintOn.value = 1;
  };

  return { apply, bake, get baked() { return baked; }, ready };
}
