/**
 * 检视页 / 游玩版的出图后期（docs/art/reference-tingyuyuan.md 第四节第 1、2、3 项）：
 *   场景 → 半浮点目标（MSAA）→ Bloom（亮度夹顶、软阈值、双线性金字塔）→ 合成到画布：
 *   边角色差 → 曝光（部分自动曝光）+ Bloom → 色调映射（Khronos Neutral，和检视页原来一样）→ sRGB →
 *   程序化「印片」3D LUT（FilmLut.ts）→ 暗角 → 颗粒。
 *
 * 场景缓冲为什么是 sRGB 编码的（同 PostStack.ts 的做法）：天空、远山绘景、雾带等一批自写着色器直接输出显示空间的颜色。
 * 目标标成 XR 渲染目标，three 对它和画布一样按 texture.colorSpace（sRGB）编码；色调映射设成 None，交给最后一遍——
 * 于是所有着色器拿到的数值和画到画布时一样，只是超过 1 的高光留着给 Bloom；合成时精确解码回线性。
 * 关掉（enabled = false，网址 post=0）时照原样直接画到画布（Neutral 色调映射），对照用。
 *
 * 单项开关（网址）：bloom=0 lut=0 ae=0 grain=0 ca=0 vig=0；gputime=1 在 stats 里给场景 / 后期的 GPU 毫秒数。
 */
import * as THREE from 'three';
import { buildFilmLut, LUT_SIZE, LOOK_PLATEAU, type FilmLook } from './FilmLut';

export interface FilmSettings {
  look: FilmLook;
  /** 基础曝光（自动曝光在它上面加减） */
  exposure: number;
  bloom: {
    /** 叠回去的强度 */
    strength: number;
    /** 软阈值（线性亮度）和过渡宽度 */
    threshold: number;
    knee: number;
    /** 输入亮度上限（小的高光不炸成星星） */
    clamp: number;
    /** 泛光染色（暖一点像镜头的光晕） */
    tint: [number, number, number];
  };
  /** 暗角强度（0..1）、颗粒（显示空间幅度）、边角色差（1080p 下角上的像素数） */
  vignette: number;
  grain: number;
  ca: number;
  autoExposure: {
    /** 变暗时往回提多少（0..1，1 = 全补）、变亮时往回压多少 */
    up: number;
    down: number;
    /** 最多补多少 EV */
    maxEv: number;
    /** 适应速度（1/秒） */
    speed: number;
    /** 进图后多少秒内拿画面平均亮度当基准（这段时间不补） */
    calibrate: number;
  };
}

/** 第四章（川藏高原）：清冷的晨光；泛光只给真正亮的东西（雷、灵火、枪口焰、发光的晶石） */
export const FILM_PLATEAU: FilmSettings = {
  look: LOOK_PLATEAU,
  exposure: 1,
  bloom: { strength: 0.22, threshold: 0.95, knee: 0.45, clamp: 8, tint: [1.0, 0.94, 0.86] },
  vignette: 0.24,
  grain: 0.016,
  ca: 0.8,
  autoExposure: { up: 0.5, down: 0.33, maxEv: 1.2, speed: 1.2, calibrate: 1.5 },
};

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** sRGB 编码 ↔ 线性（超过 1 的也按同一条曲线延伸） */
const SRGB_GLSL = /* glsl */ `
vec3 srgbDecode(vec3 c) {
  c = max(c, 0.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 srgbEncode(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }`;

const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tExposure;
uniform vec2 uTexel;
uniform vec4 uParams;   // x 阈值, y 过渡宽度, z 亮度上限, w 基础曝光
varying vec2 vUv;
${SRGB_GLSL}
void main() {
  // 4 个点平均（顺便半分辨率），再软阈值
  vec3 c = srgbDecode(texture2D(tScene, vUv + uTexel * vec2(-0.5, -0.5)).rgb) + srgbDecode(texture2D(tScene, vUv + uTexel * vec2(0.5, -0.5)).rgb)
         + srgbDecode(texture2D(tScene, vUv + uTexel * vec2(-0.5, 0.5)).rgb) + srgbDecode(texture2D(tScene, vUv + uTexel * vec2(0.5, 0.5)).rgb);
  c *= 0.25 * uParams.w * exp2(texture2D(tExposure, vec2(0.5)).r);
  float l = luma(c);
  c *= min(1.0, uParams.z / max(l, 1e-4));
  l = min(l, uParams.z);
  float soft = clamp(l - uParams.x + uParams.y, 0.0, 2.0 * uParams.y);
  soft = soft * soft / (4.0 * uParams.y + 1e-4);
  float k = max(soft, l - uParams.x) / max(l, 1e-4);
  gl_FragColor = vec4(c * k, 1.0);
}`;

/** 双线性下采样（中心 4 份 + 四角各 1 份） */
const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;

/** 上采样（帐篷 8 点）+ 这一级的下采样结果 */
const UP_FRAG = /* glsl */ `
uniform sampler2D tLow;
uniform sampler2D tCur;
uniform vec2 uTexel;    // 低一级的像素大小
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  c += texture2D(tLow, vUv + uTexel * vec2(-2.0, 0.0)).rgb + texture2D(tLow, vUv + uTexel * vec2(2.0, 0.0)).rgb;
  c += texture2D(tLow, vUv + uTexel * vec2(0.0, -2.0)).rgb + texture2D(tLow, vUv + uTexel * vec2(0.0, 2.0)).rgb;
  c += (texture2D(tLow, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tLow, vUv + uTexel * vec2(1.0, -1.0)).rgb
      + texture2D(tLow, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tLow, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 2.0;
  gl_FragColor = vec4(c / 12.0 + texture2D(tCur, vUv).rgb, 1.0);
}`;

/** 测光：画面亮度的对数（中心加权、过亮的灯不算），存 (加权 log2 亮度, 权重)，之后靠 mip 求平均 */
const LUM_FRAG = /* glsl */ `
uniform sampler2D tScene;
varying vec2 vUv;
${SRGB_GLSL}
void main() {
  float l = luma(srgbDecode(texture2D(tScene, vUv).rgb));
  float lg = clamp(log2(max(l, 1e-5)), -10.0, 3.0);
  vec2 d = (vUv - vec2(0.5, 0.55)) * vec2(1.6, 2.0);
  float w = mix(0.2, 1.0, exp(-dot(d, d) * 2.0));
  gl_FragColor = vec4(lg * w, w, 0.0, 1.0);
}`;

/** 曝光状态（1×1，ping-pong）：x = 当前补偿 EV，y = 基准 log2 亮度 */
const ADAPT_FRAG = /* glsl */ `
uniform sampler2D tLum;
uniform sampler2D tPrev;
uniform float uLod;
uniform vec4 uAe;       // x 往回提, y 往回压, z 上限 EV, w 这一帧的适应系数
uniform float uCalib;   // 1 = 校准中（拿当前亮度当基准，不补）
uniform float uReset;
varying vec2 vUv;
void main() {
  vec2 m = textureLod(tLum, vec2(0.5), uLod).rg;
  float lg = m.x / max(m.y, 1e-4);
  vec2 prev = texture2D(tPrev, vec2(0.5)).rg;
  float key = uReset > 0.5 ? lg : (uCalib > 0.5 ? mix(prev.y, lg, 0.15) : prev.y);
  float diff = key - lg;                                     // > 0：画面比基准暗，要提
  float want = uCalib > 0.5 ? 0.0 : clamp(diff * (diff > 0.0 ? uAe.x : uAe.y), -uAe.z, uAe.z);
  float ev = uReset > 0.5 ? 0.0 : mix(prev.x, want, uAe.w);
  gl_FragColor = vec4(ev, key, 0.0, 1.0);
}`;

const UBER_FRAG = /* glsl */ `
precision highp sampler3D;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tExposure;
uniform sampler3D tLut;
uniform vec4 uMain;     // x 基础曝光, y 泛光强度, z 色差（uv）, w LUT 混合
uniform vec3 uTint;
uniform vec4 uFx;       // x 暗角, y 颗粒, z 宽高比, w 帧种子
uniform vec2 uLutCoord; // (N−1)/N, 0.5/N
varying vec2 vUv;
${SRGB_GLSL}
vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d * vec2(uFx.z, 1.0), d * vec2(uFx.z, 1.0)) / (0.25 * (uFx.z * uFx.z + 1.0));
  vec2 off = d * r2 * uMain.z;
  vec3 c = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b);
  vec3 lin = srgbDecode(c) * uMain.x * exp2(texture2D(tExposure, vec2(0.5)).r);
  lin += texture2D(tBloom, vUv).rgb * uMain.y * uTint;
  vec3 disp = srgbEncode(clamp(neutral(lin), 0.0, 1.0));
  vec3 graded = texture(tLut, disp * uLutCoord.x + uLutCoord.y).rgb;
  disp = mix(disp, graded, uMain.w);
  // 暗角：按宽高比修正的半径
  float v = length(d * vec2(uFx.z, 1.0)) / length(vec2(0.5 * uFx.z, 0.5));
  disp *= 1.0 - uFx.x * smoothstep(0.35, 1.05, v);
  // 颗粒：亮处少一点
  float n = hash(gl_FragCoord.xy + uFx.w) + hash(gl_FragCoord.yx * 1.7 + uFx.w * 3.1) - 1.0;
  disp += n * uFx.y * (1.0 - 0.6 * luma(disp));
  gl_FragColor = vec4(disp, 1.0);
}`;

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
}

function rt(w: number, h: number, o: THREE.RenderTargetOptions = {}): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, ...o,
  });
}

/** EXT_disjoint_timer_query_webgl2 的异步 GPU 计时（拿不到扩展就什么也不做） */
class GpuTimer {
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: { name: string; q: WebGLQuery }[] = [];
  private cur: { name: string; q: WebGLQuery } | null = null;
  readonly ms: Record<string, number> = {};
  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as never;
  }
  begin(name: string): void {
    if (!this.ext || this.cur) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.cur = { name, q };
  }
  end(): void {
    if (!this.ext || !this.cur) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.cur);
    this.cur = null;
  }
  poll(): void {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!disjoint) {
        const ms = gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
        this.ms[p.name] = this.ms[p.name] === undefined ? ms : this.ms[p.name] * 0.9 + ms * 0.1;
      }
      gl.deleteQuery(p.q);
      this.pending.splice(i, 1);
    }
  }
}

export class FilmPost {
  /** 整个关掉 = 照原样直接画到画布 */
  enabled: boolean;
  readonly flags: { bloom: boolean; lut: boolean; ae: boolean; grain: boolean; ca: boolean; vignette: boolean };
  /** 调试：每遍的 GPU 毫秒数（网址 gputime=1） */
  readonly stats: { scene: number; post: number; bloomLevels: number; width: number; height: number; ev: number } = { scene: 0, post: 0, bloomLevels: 0, width: 0, height: 0, ev: 0 };

  private readonly toneMapping: THREE.ToneMapping;
  private readonly supported: boolean;
  private hdr: THREE.WebGLRenderTarget | null = null;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private readonly lum = rt(64, 64, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  private ae = [rt(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }), rt(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })];
  private aeReset = true;
  private calibT = 0;
  private readonly lut: THREE.Data3DTexture;
  private readonly quad: THREE.Mesh;
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly prefilter: THREE.ShaderMaterial;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  private readonly lumMat: THREE.ShaderMaterial;
  private readonly adaptMat: THREE.ShaderMaterial;
  private readonly uber: THREE.ShaderMaterial;
  private readonly size = new THREE.Vector2();
  private readonly timer: GpuTimer | null;
  private frame = 0;
  private readonly black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);

  constructor(private readonly renderer: THREE.WebGLRenderer, readonly settings: FilmSettings = FILM_PLATEAU, samples = 4) {
    this.toneMapping = renderer.toneMapping;
    const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
    const on = (k: string): boolean => q.get(k) !== '0';
    this.enabled = on('post');
    this.flags = { bloom: on('bloom'), lut: on('lut'), ae: on('ae'), grain: on('grain'), ca: on('ca'), vignette: on('vig') };
    this.supported = renderer.capabilities.isWebGL2 !== false
      && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
    if (!this.supported) console.warn('[FilmPost] 不支持半浮点渲染目标，后期关闭');
    this.samples = samples;
    this.lut = buildFilmLut(settings.look);
    this.black.needsUpdate = true;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(g);
    this.quad.frustumCulled = false;
    this.prefilter = pass(PREFILTER_FRAG, { tScene: { value: null }, tExposure: { value: null }, uTexel: { value: new THREE.Vector2() }, uParams: { value: new THREE.Vector4() } });
    this.downMat = pass(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = pass(UP_FRAG, { tLow: { value: null }, tCur: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.lumMat = pass(LUM_FRAG, { tScene: { value: null } });
    this.adaptMat = pass(ADAPT_FRAG, { tLum: { value: this.lum.texture }, tPrev: { value: null }, uLod: { value: 6 }, uAe: { value: new THREE.Vector4() }, uCalib: { value: 1 }, uReset: { value: 1 } });
    this.uber = pass(UBER_FRAG, {
      tScene: { value: null }, tBloom: { value: null }, tExposure: { value: null }, tLut: { value: this.lut },
      uMain: { value: new THREE.Vector4() }, uTint: { value: new THREE.Vector3(...settings.bloom.tint) }, uFx: { value: new THREE.Vector4() },
      uLutCoord: { value: new THREE.Vector2((LUT_SIZE - 1) / LUT_SIZE, 0.5 / LUT_SIZE) },
    });
    this.timer = q.get('gputime') === '1' ? new GpuTimer(renderer.getContext() as WebGL2RenderingContext) : null;
  }

  private readonly samples: number;

  /**
   * 跟着检视页的画质档降级：低 = 关泛光、自动曝光、色差（只留调色、暗角、颗粒这些几乎不花钱的）；中 / 高 = 全开。
   * 网址里单独关掉的项不会被这里打开。
   */
  setQuality(level: string): void {
    const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
    const on = (k: string): boolean => q.get(k) !== '0';
    const full = level !== 'low';
    this.flags.bloom = full && on('bloom');
    this.flags.ae = full && on('ae');
    this.flags.ca = full && on('ca');
  }

  /** 换图 / 切到出生点后调：重新拿画面平均亮度当自动曝光的基准 */
  recalibrate(): void { this.aeReset = true; this.calibT = 0; }

  /**
   * 按场景那一遍的真实状态（画到 HDR 目标、不做色调映射）预编场景里所有材质的着色器——
   * 直接 renderer.compileAsync 是按「画到屏幕、Neutral 色调映射」编的，编出来的变体这里一个都用不上（plateau/lookdev.ts 的预热用）。
   */
  async compileScene(scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
    const r = this.renderer;
    if (!this.enabled || !this.supported) { await r.compileAsync(scene, camera); return; }
    const prevTone = r.toneMapping, prevTarget = r.getRenderTarget();
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.ensure());
    try {
      await r.compileAsync(scene, camera);
    } finally {
      r.setRenderTarget(prevTarget);
      r.toneMapping = prevTone;
    }
  }

  /** 画一帧（代替 renderer.render(scene, camera)）。dt：真实秒数（自动曝光的适应用） */
  render(scene: THREE.Scene, camera: THREE.Camera, dt = 1 / 60): void {
    const r = this.renderer;
    if (!this.enabled || !this.supported) {
      if (r.toneMapping !== this.toneMapping) r.toneMapping = this.toneMapping;
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    if (r.toneMapping !== THREE.NoToneMapping) r.toneMapping = THREE.NoToneMapping;
    // renderer.info 按整帧累计（场景 + 后期各遍），不然性能面板只看到最后那一遍合成
    const autoReset = r.info.autoReset;
    r.info.reset();
    r.info.autoReset = false;
    try {
      this.renderFrame(scene, camera, dt);
    } finally {
      r.info.autoReset = autoReset;
    }
  }

  private renderFrame(scene: THREE.Scene, camera: THREE.Camera, dt: number): void {
    const r = this.renderer;
    const hdr = this.ensure();
    const S = this.settings;
    this.timer?.poll();

    // 1. 场景
    this.timer?.begin('scene');
    r.setRenderTarget(hdr);
    r.clear(true, true, true);
    r.render(scene, camera);
    this.timer?.end();

    this.timer?.begin('post');
    // 2. 测光 + 曝光状态
    const prevAe = this.ae[0], nextAe = this.ae[1];
    if (this.flags.ae) {
      this.lumMat.uniforms.tScene.value = hdr.texture;
      this.draw(this.lumMat, this.lum);
      this.calibT += dt;
      const A = S.autoExposure;
      const u = this.adaptMat.uniforms;
      u.tPrev.value = prevAe.texture;
      u.uLod.value = Math.log2(64);
      (u.uAe.value as THREE.Vector4).set(A.up, A.down, A.maxEv, 1 - Math.exp(-dt * A.speed));
      u.uCalib.value = this.calibT < A.calibrate ? 1 : 0;
      u.uReset.value = this.aeReset ? 1 : 0;
      this.aeReset = false;
      this.draw(this.adaptMat, nextAe);
      this.ae = [nextAe, prevAe];
    }
    const exposureTex = this.flags.ae ? this.ae[0].texture : this.black;

    // 3. 泛光
    let bloomTex: THREE.Texture = this.black;
    if (this.flags.bloom && S.bloom.strength > 0 && this.down.length) {
      const B = S.bloom;
      const pu = this.prefilter.uniforms;
      pu.tScene.value = hdr.texture; pu.tExposure.value = exposureTex;
      (pu.uTexel.value as THREE.Vector2).set(1 / hdr.width, 1 / hdr.height);
      (pu.uParams.value as THREE.Vector4).set(B.threshold, B.knee, B.clamp, S.exposure);
      this.draw(this.prefilter, this.down[0]);
      for (let i = 1; i < this.down.length; i++) {
        const src = this.down[i - 1];
        this.downMat.uniforms.tSrc.value = src.texture;
        (this.downMat.uniforms.uTexel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
        this.draw(this.downMat, this.down[i]);
      }
      let low = this.down[this.down.length - 1];
      for (let i = this.down.length - 2; i >= 0; i--) {
        this.upMat.uniforms.tLow.value = low.texture;
        this.upMat.uniforms.tCur.value = this.down[i].texture;
        (this.upMat.uniforms.uTexel.value as THREE.Vector2).set(1 / low.width, 1 / low.height);
        this.draw(this.upMat, this.up[i]);
        low = this.up[i];
      }
      bloomTex = this.up[0].texture;
    }

    // 4. 合成到画布
    const u = this.uber.uniforms;
    u.tScene.value = hdr.texture; u.tBloom.value = bloomTex; u.tExposure.value = exposureTex;
    const w = hdr.width, h = hdr.height;
    (u.uMain.value as THREE.Vector4).set(S.exposure, this.flags.bloom ? S.bloom.strength / Math.max(1, this.down.length) : 0,
      this.flags.ca ? (S.ca * (h / 1080)) / Math.max(1, w) * 2 : 0, this.flags.lut ? 1 : 0);
    (u.uFx.value as THREE.Vector4).set(this.flags.vignette ? S.vignette : 0, this.flags.grain ? S.grain : 0, w / h, (this.frame++ % 97) * 1.37);
    this.draw(this.uber, null);
    this.timer?.end();
    if (this.timer) { this.stats.scene = this.timer.ms.scene ?? 0; this.stats.post = this.timer.ms.post ?? 0; }
    this.stats.bloomLevels = this.down.length; this.stats.width = w; this.stats.height = h;
  }

  /** 调试：读回当前的补偿 EV（同步读，别每帧调） */
  readEv(): number {
    const buf = new Uint16Array(4);
    this.renderer.readRenderTargetPixels(this.ae[0], 0, 0, 1, 1, buf);
    return (this.stats.ev = THREE.DataUtils.fromHalfFloat(buf[0]));
  }

  private draw(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.quadCam);
  }

  /** 按画布的物理像素建 / 改目标 */
  private ensure(): THREE.WebGLRenderTarget {
    const s = this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(s.x)), h = Math.max(1, Math.floor(s.y));
    if (!this.hdr || this.hdr.width !== w || this.hdr.height !== h) {
      if (!this.hdr) {
        this.hdr = rt(w, h, { depthBuffer: true, samples: this.samples });
        this.hdr.texture.colorSpace = THREE.SRGBColorSpace;
        // three 对 XR 目标和画布一样：按 renderer.toneMapping（这里是 None）和 texture.colorSpace（sRGB）出色
        (this.hdr as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
      } else this.hdr.setSize(w, h);
      for (const t of [...this.down, ...this.up]) t.dispose();
      this.down = []; this.up = [];
      let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
      for (let i = 0; i < 6 && bw >= 8 && bh >= 8; i++) {
        this.down.push(rt(bw, bh));
        this.up.push(rt(bw, bh));
        bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      }
    }
    return this.hdr;
  }

  dispose(): void {
    this.hdr?.dispose();
    for (const t of [...this.down, ...this.up, this.lum, ...this.ae]) t.dispose();
    this.lut.dispose();
  }
}
