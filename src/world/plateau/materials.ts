/**
 * 检视页共用材质：程序化画布贴图 + 统一的着色补丁。
 * 补丁只做三件事：云影（只压直射光）、地表细节噪声、建筑轮廓光；全部材质共用同一份 uniform。
 */
import * as THREE from 'three';
import { WIND } from './spec';

export const WORLD_UNIFORMS = {
  uTime: { value: 0 },
  uCloudOn: { value: 1 },
  /** 云影随风移动的方向和速度（米 / 秒） */
  uWind: { value: new THREE.Vector2(3.2, 1.1) },
  /** 雷暴强度 0..1（天气切换时渐变）与落雷闪光 0..1 */
  uStorm: { value: 0 },
  uFlash: { value: 0 },
  /** 风场：飞廉巢穴 (x, z, 影响半径) 与基础风向（spec.WIND，见 wind.ts） */
  uWindLair: { value: new THREE.Vector3(WIND.lair[0], WIND.lair[1], WIND.radius) },
  uWindBase: { value: new THREE.Vector2(WIND.base[0], WIND.base[1]).normalize() },
};

const NOISE_GLSL = /* glsl */ `
float pfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pfNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pfHash(i), pfHash(i + vec2(1.0, 0.0)), u.x), mix(pfHash(i + vec2(0.0, 1.0)), pfHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float pfFbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * pfNoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v / 0.9375;
}
float pfCloudShadow(vec2 xz) {
  vec2 p = (xz - uWind * uTime) * 0.0075;
  float n = pfFbm(p + vec2(3.1, 7.4));
  // 雷暴时满天乌云，云影换成整片阴天（直射光由灯光强度压低），这里只留一点浓淡
  return mix(1.0, 0.5, smoothstep(0.5, 0.64, n) * uCloudOn * (1.0 - uStorm * 0.7));
}
`;

export interface PatchOptions {
  /** 地表细节：世界坐标噪声调制底色，消除顶点色的平涂感 */
  detail?: boolean;
  /** 建筑轮廓光（枪火重生式的亮边） */
  rim?: number;
  /** 草丛摆动（InstancedMesh） */
  sway?: number;
  /** 经幡翻动：需要 aFlap / aPhase / aWind 属性 */
  flutter?: boolean;
  /** 地表四材质细节贴图（草 / 岩 / 雪 / 土）：需要 aMat 属性（材质权重） */
  splat?: boolean;
}

export function patchMaterial<T extends THREE.Material>(mat: T, opts: PatchOptions = {}): T {
  const key = `pf:${opts.detail ? 1 : 0}:${opts.rim ?? 0}:${opts.sway ?? 0}:${opts.flutter ? 1 : 0}:${opts.splat ? 1 : 0}`;
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, WORLD_UNIFORMS);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', `#include <common>
uniform float uTime;
varying vec3 vPfWorld;
${opts.flutter ? 'attribute float aFlap; attribute float aPhase; attribute vec3 aWind; attribute float aGust;' : ''}
${opts.sway ? 'uniform vec3 uWindLair; uniform vec2 uWindBase;' : ''}
${opts.splat ? 'attribute vec4 aMat; varying vec4 vMat; varying vec3 vPfN;' : ''}`);
    let begin = '#include <begin_vertex>';
    if (opts.flutter) begin += `
{
  // 风强（aGust）越大抖得越快越猛
  float w = sin(uTime * (5.5 + 7.0 * aGust) + aPhase + aFlap * 2.6) * (0.45 + 0.3 * aGust) + sin(uTime * (9.1 + 8.0 * aGust) + aPhase * 1.7) * 0.15;
  transformed += aWind * aFlap * (0.62 + w);
  transformed.y += aFlap * 0.06 * sin(uTime * 7.3 + aPhase);
}`;
    if (opts.sway) begin += `
{
  vec2 ip = vec2(0.0);
  #ifdef USE_INSTANCING
  ip = instanceMatrix[3].xz;
  #endif
  // 草浪：按风场（飞廉巢穴）弯向下风，离巢穴越近弯得越狠、浪推得越快
  vec2 toL = uWindLair.xy - ip;
  float dl = max(length(toL), 1.0);
  float st = smoothstep(uWindLair.z, 30.0, dl);
  vec2 dir = normalize(mix(uWindBase, toL / dl, min(1.0, st * 1.6)));
  float wave = sin(dot(ip, dir) * 0.11 - uTime * (1.6 + 3.5 * st)) * 0.5 + 0.5;
  float flick = sin(uTime * 3.3 + ip.x * 0.5 + ip.y * 0.37) * 0.25;
  float bend = (0.15 + st * 0.6) + wave * (0.35 + st * 0.9) + flick;
  vec2 ldir = dir;
  #ifdef USE_INSTANCING
  ldir = normalize((transpose(mat3(instanceMatrix)) * vec3(dir.x, 0.0, dir.y)).xz);
  #endif
  float k = ${opts.sway.toFixed(3)} * transformed.y * transformed.y;
  transformed.x += ldir.x * bend * k;
  transformed.z += ldir.y * bend * k;
}`;
    vs = vs.replace('#include <begin_vertex>', begin);
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 pw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  pw = instanceMatrix * pw;
  #endif
  vPfWorld = (modelMatrix * pw).xyz;
  ${opts.splat ? 'vMat = aMat; vPfN = normalize(mat3(modelMatrix) * objectNormal);' : ''}
}`);
    fs = fs.replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uCloudOn;
uniform float uStorm;
uniform vec2 uWind;
varying vec3 vPfWorld;
${opts.splat ? 'varying vec4 vMat; varying vec3 vPfN; uniform sampler2D tDGrass; uniform sampler2D tDRock; uniform sampler2D tDSnow; uniform sampler2D tDDirt;' : ''}
${NOISE_GLSL}`);
    if (opts.splat) {
      const t = detailTextures();
      Object.assign(shader.uniforms, { tDGrass: { value: t.grass }, tDRock: { value: t.rock }, tDSnow: { value: t.snow }, tDDirt: { value: t.dirt } });
      // 四张世界坐标细节贴图按材质权重混合；岩石用三向投影（陡坡不拉伸）；随距离淡出，远处不闪
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 an = abs(normalize(vPfN)); an /= (an.x + an.y + an.z);
  float gr = texture2D(tDGrass, vPfWorld.xz / 1.7).r;
  float di = texture2D(tDDirt, vPfWorld.xz / 1.3).r;
  float sn = texture2D(tDSnow, vPfWorld.xz / 5.0).r;
  float rk = texture2D(tDRock, vPfWorld.xz / 3.2).r * an.y + texture2D(tDRock, vPfWorld.zy / 3.2).r * an.x + texture2D(tDRock, vPfWorld.xy / 3.2).r * an.z;
  vec4 w = vMat / max(1e-3, vMat.x + vMat.y + vMat.z + vMat.w);
  float det = gr * w.x + rk * w.y + sn * w.z + di * w.w;
  float fade = 1.0 - smoothstep(45.0, 160.0, length(vViewPosition));
  diffuseColor.rgb *= mix(1.0, 0.42 + 1.16 * det, fade * 0.85);
}`);
    }
    if (opts.detail) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
{
  float d1 = pfNoise(vPfWorld.xz * 0.9);
  float d2 = pfNoise(vPfWorld.xz * 3.7 + 11.0);
  float d3 = pfNoise(vPfWorld.xz * 11.0 - 5.0);
  diffuseColor.rgb *= 0.8 + 0.22 * d1 + 0.12 * d2 + 0.1 * d3;
}`);
    let lights = `#include <lights_fragment_end>
{
  float cs = pfCloudShadow(vPfWorld.xz);
  reflectedLight.directDiffuse *= cs;
  reflectedLight.directSpecular *= cs;
}`;
    if (opts.rim) lights += `
{
  vec3 vd = normalize(vViewPosition);
  float rim = pow(1.0 - clamp(dot(normalize(normal), vd), 0.0, 1.0), 3.0);
  reflectedLight.indirectDiffuse += rim * ${opts.rim.toFixed(3)} * diffuseColor.rgb;
}`;
    fs = fs.replace('#include <lights_fragment_end>', lights);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  return mat;
}

// ───────────────────────────── 画布贴图 ─────────────────────────────

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d')!;
  draw(g, rng(seed));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

const shade = (base: [number, number, number], k: number): string =>
  `rgb(${Math.round(Math.min(255, base[0] * k))},${Math.round(Math.min(255, base[1] * k))},${Math.round(Math.min(255, base[2] * k))})`;

/** 片石砌：薄而长的石片一层层叠（丹巴碉楼、嘉绒民居） */
function slateMasonry(g: CanvasRenderingContext2D, r: () => number, light: boolean): void {
  const W = 512, H = 512;
  g.fillStyle = light ? '#d9d4ca' : '#4a4640';
  g.fillRect(0, 0, W, H);
  const tones: [number, number, number][] = light
    ? [[236, 233, 226], [228, 224, 214], [241, 238, 231], [222, 219, 210]]
    : [[132, 126, 116], [116, 109, 99], [148, 139, 124], [125, 120, 113], [140, 128, 110], [104, 99, 92]];
  let y = 0;
  while (y < H) {
    const rowH = 9 + Math.floor(r() * 16);
    let x = -Math.floor(r() * 60);
    while (x < W) {
      const w = 34 + Math.floor(r() * 110);
      const t = tones[Math.floor(r() * tones.length)];
      const k = 0.88 + r() * 0.22;
      g.fillStyle = shade(t, k);
      const inset = light ? 0.6 : 1.4;
      g.fillRect(x + inset, y + inset, w - inset * 2, rowH - inset * 2);
      // 上沿亮、下沿暗，给一点体积
      g.fillStyle = shade(t, k * 1.12);
      g.fillRect(x + inset, y + inset, w - inset * 2, 2);
      g.fillStyle = shade(t, k * 0.78);
      g.fillRect(x + inset, y + rowH - inset - 2, w - inset * 2, 2);
      x += w;
    }
    y += rowH;
  }
  // 雨痕
  for (let i = 0; i < 40; i++) {
    g.fillStyle = light ? 'rgba(120,110,95,0.06)' : 'rgba(30,25,20,0.08)';
    g.fillRect(r() * W, r() * H, 2 + r() * 5, 30 + r() * 120);
  }
}

let cache: Record<string, THREE.Texture> | null = null;

export function textures(): Record<'stone' | 'whitewash' | 'wood' | 'weave' | 'tentWhite' | 'mani' | 'dung', THREE.Texture> {
  if (cache) return cache as ReturnType<typeof textures>;
  const stone = canvasTexture(512, 512, (g, r) => slateMasonry(g, r, false), 11);
  const whitewash = canvasTexture(512, 512, (g, r) => slateMasonry(g, r, true), 12);
  const wood = canvasTexture(256, 256, (g, r) => {
    g.fillStyle = '#7a3b26'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(40,15,8,0.18)' : 'rgba(170,90,60,0.14)';
      g.fillRect(0, r() * 256, 256, 1 + r() * 3);
    }
    for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(25,10,5,0.35)'; g.fillRect(0, i * 32, 256, 1.5); }
  }, 13);
  const weave = canvasTexture(256, 256, (g, r) => {
    g.fillStyle = '#26221f'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32) {
      g.fillStyle = r() < 0.5 ? '#3a322b' : '#1c1916';
      g.fillRect(0, y, 256, 14 + r() * 8);
    }
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(80,70,60,0.25)' : 'rgba(0,0,0,0.25)';
      g.fillRect(r() * 256, r() * 256, 1, 4 + r() * 6);
    }
    g.fillStyle = '#6b4b32'; g.fillRect(0, 120, 256, 6);
  }, 14);
  const tentWhite = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 256, 256);
    // 下沿蓝色吉祥纹（抽象回纹）
    g.fillStyle = '#2f5aa8'; g.fillRect(0, 196, 256, 46);
    g.fillStyle = '#f2efe6';
    for (let x = 0; x < 256; x += 32) {
      g.fillRect(x + 6, 204, 20, 4); g.fillRect(x + 6, 204, 4, 22); g.fillRect(x + 6, 222, 14, 4);
      g.fillRect(x + 16, 212, 4, 14);
    }
    g.fillStyle = '#c33a2c'; g.fillRect(0, 190, 256, 6); g.fillRect(0, 242, 256, 4);
    // 上方的蓝色八瑞相式团花（几何化）
    g.fillStyle = '#2f5aa8';
    for (let x = 32; x < 256; x += 64) {
      g.beginPath(); g.arc(x, 90, 18, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f2efe6'; g.beginPath(); g.arc(x, 90, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2f5aa8';
    }
  }, 15);
  const mani = canvasTexture(256, 256, (g, r) => {
    const cols = ['#3a6db0', '#c2453a', '#3b8f55', '#d9b23a', '#e9e5da', '#7f7a72', '#7f7a72', '#8a847a'];
    for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) {
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.fillRect(x + 1, y + 1, 30, 30);
      // 抽象刻纹（不写真实经文）
      g.fillStyle = 'rgba(255,255,255,0.75)';
      for (let k = 0; k < 3; k++) g.fillRect(x + 6 + k * 7, y + 8 + r() * 4, 4, 12 + r() * 6);
      g.fillRect(x + 5, y + 7, 22, 2);
    }
  }, 16);
  const dung = canvasTexture(128, 128, (g, r) => {
    g.fillStyle = '#5a4532'; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) for (let x = (y / 16) % 2 ? -8 : 0; x < 128; x += 16) {
      g.fillStyle = shade([110, 86, 60], 0.75 + r() * 0.4);
      g.beginPath(); g.ellipse(x + 8, y + 8, 7.5, 6.5, 0, 0, Math.PI * 2); g.fill();
    }
  }, 17);
  cache = { stone, whitewash, wood, weave, tentWhite, mani, dung };
  return cache as ReturnType<typeof textures>;
}

// ───────────────────────────── 地表细节贴图（灰度，均值约 0.5，可无缝平铺） ─────────────────────────────

function dataTexture(draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, 256, 256);
  draw(g, rng(seed));
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** 在 (x, y) 画一笔；靠近边缘时在对边再画一次，保证平铺无缝 */
function wrapped(x: number, y: number, pad: number, draw: (x: number, y: number) => void): void {
  for (const dx of [0, -256, 256]) for (const dy of [0, -256, 256]) {
    const xx = x + dx, yy = y + dy;
    if (xx > -pad && xx < 256 + pad && yy > -pad && yy < 256 + pad) draw(xx, yy);
  }
}

const gray = (v: number, a = 1): string => `rgba(${v | 0},${v | 0},${v | 0},${a})`;

let detailCache: { grass: THREE.Texture; rock: THREE.Texture; snow: THREE.Texture; dirt: THREE.Texture } | null = null;

export function detailTextures(): { grass: THREE.Texture; rock: THREE.Texture; snow: THREE.Texture; dirt: THREE.Texture } {
  if (detailCache) return detailCache;
  // 草：成丛的短叶纹
  const grass = dataTexture((g, r) => {
    // 成丛的深浅斑块
    for (let i = 0; i < 46; i++) {
      const x = r() * 256, y = r() * 256, rad = 14 + r() * 30, v = r() < 0.5 ? 70 : 185;
      wrapped(x, y, rad, (xx, yy) => {
        const grd = g.createRadialGradient(xx, yy, 0, xx, yy, rad);
        grd.addColorStop(0, gray(v, 0.45)); grd.addColorStop(1, gray(v, 0));
        g.fillStyle = grd; g.fillRect(xx - rad, yy - rad, rad * 2, rad * 2);
      });
    }
    for (let i = 0; i < 2600; i++) {
      const x = r() * 256, y = r() * 256, len = 6 + r() * 12, a = (r() - 0.5) * 0.8, v = 50 + r() * 170;
      wrapped(x, y, 20, (xx, yy) => {
        g.strokeStyle = gray(v, 0.62); g.lineWidth = 1 + r() * 1.5;
        g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + Math.sin(a) * len, yy - Math.cos(a) * len); g.stroke();
      });
    }
  }, 31);
  // 岩：横向层理 + 裂缝 + 斑点
  const rock = dataTexture((g, r) => {
    for (let y = 0; y < 256; y += 6 + r() * 14) {
      const v = 90 + r() * 80, h = 2 + r() * 6;
      g.fillStyle = gray(v, 0.55);
      g.fillRect(0, y, 256, h);
    }
    for (let i = 0; i < 26; i++) {
      let x = r() * 256, y = r() * 256;
      g.strokeStyle = gray(40, 0.6); g.lineWidth = 1 + r();
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 30; y += r() * 18; g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 900; i++) wrapped(r() * 256, r() * 256, 3, (x, y) => { g.fillStyle = gray(60 + r() * 150, 0.5); g.fillRect(x, y, 2, 2); });
  }, 32);
  // 雪：柔和的起伏 + 闪点
  const snow = dataTexture((g, r) => {
    for (let i = 0; i < 60; i++) {
      const x = r() * 256, y = r() * 256, rad = 20 + r() * 50, v = 100 + r() * 60;
      wrapped(x, y, rad, (xx, yy) => {
        const grd = g.createRadialGradient(xx, yy, 0, xx, yy, rad);
        grd.addColorStop(0, gray(v, 0.5)); grd.addColorStop(1, gray(v, 0));
        g.fillStyle = grd; g.fillRect(xx - rad, yy - rad, rad * 2, rad * 2);
      });
    }
    for (let i = 0; i < 500; i++) { g.fillStyle = gray(230, 0.8); g.fillRect(r() * 256, r() * 256, 1, 1); }
  }, 33);
  // 土 / 碎石：大小不一的卵石
  const dirt = dataTexture((g, r) => {
    for (let i = 0; i < 700; i++) {
      const x = r() * 256, y = r() * 256, rx = 1.5 + r() * 5, ry = rx * (0.6 + r() * 0.4), v = 70 + r() * 140, rot = r() * 3;
      wrapped(x, y, 8, (xx, yy) => {
        g.fillStyle = gray(v * 0.55, 0.5);
        g.beginPath(); g.ellipse(xx + 0.8, yy + 0.8, rx, ry, rot, 0, Math.PI * 2); g.fill();
        g.fillStyle = gray(v, 0.75);
        g.beginPath(); g.ellipse(xx, yy, rx, ry, rot, 0, Math.PI * 2); g.fill();
      });
    }
  }, 34);
  detailCache = { grass, rock, snow, dirt };
  return detailCache;
}

/** 文字牌（道班、垭口碑） */
export function textTexture(lines: string[], opts: { bg: string; fg: string; w?: number; h?: number; font?: number; border?: string }): THREE.CanvasTexture {
  const w = opts.w ?? 512, h = opts.h ?? 256;
  return canvasTexture(w, h, (g) => {
    g.fillStyle = opts.bg; g.fillRect(0, 0, w, h);
    if (opts.border) { g.strokeStyle = opts.border; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20); }
    g.fillStyle = opts.fg;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const size = opts.font ?? 72;
    lines.forEach((line, i) => {
      g.font = `bold ${i === 0 ? size : Math.round(size * 0.5)}px "Microsoft YaHei","PingFang SC",sans-serif`;
      g.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05);
    });
  }, 1);
}

// ───────────────────────────── 共用材质 ─────────────────────────────

let mats: ReturnType<typeof buildMaterials> | null = null;

function buildMaterials() {
  const t = textures();
  const lam = (p: THREE.MeshLambertMaterialParameters, o: PatchOptions = { rim: 0.22 }) => patchMaterial(new THREE.MeshLambertMaterial(p), o);
  return {
    plain: lam({ vertexColors: true }),
    stone: lam({ vertexColors: true, map: t.stone }),
    whitewash: lam({ vertexColors: true, map: t.whitewash }),
    wood: lam({ vertexColors: true, map: t.wood }),
    weave: lam({ vertexColors: true, map: t.weave, side: THREE.DoubleSide }),
    tentWhite: lam({ vertexColors: true, map: t.tentWhite, side: THREE.DoubleSide }),
    mani: lam({ vertexColors: true, map: t.mani }),
    dung: lam({ vertexColors: true, map: t.dung }),
    gold: lam({ vertexColors: true, emissive: new THREE.Color('#5a3c08'), emissiveIntensity: 0.55 }, { rim: 0.6 }),
    ice: lam({ vertexColors: true, emissive: new THREE.Color('#2c5a72'), emissiveIntensity: 0.3 }, { rim: 0.5 }),
    /** 第四章雷魅的邪火：紫红雷光、白芯（弱点、电纹、眼睛） */
    glow: lam({ vertexColors: true, emissive: new THREE.Color('#e03ac8'), emissiveIntensity: 1.25 }, { rim: 0 }),
    terrain: patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { detail: true, splat: true }),
  };
}

export type MaterialKey = Exclude<keyof ReturnType<typeof buildMaterials>, 'terrain'>;

export function materials(): ReturnType<typeof buildMaterials> {
  return (mats ??= buildMaterials());
}
