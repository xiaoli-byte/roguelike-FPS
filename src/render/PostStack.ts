import * as THREE from 'three';
import type { GameContext } from '../core/types';
import { arbiterFor, TimePriority } from '../enemies/bosses/framework/TimeScaleArbiter';
import { GameplayVolumes } from './GameplayVolumes';
import { postScene } from './PostScene';
import {
  ALPHA_CLEAR_FRAGMENT, BLUR_H_FRAGMENT, BLUR_V_FRAGMENT, LUT_FRAGMENT, PASS_VERTEX, PREFILTER_FRAGMENT, UBER_FRAGMENT, UPSAMPLE_FRAGMENT,
} from './PostShaders';
import { bakeLutLdr, gammaToLinear, luminance, LUT_SIZE, lutUniforms, type GradingInput } from './UrpColor';
import { TONEMAP_NONE, type VolumeLayer, type VolumeParams } from './UrpVolume';

/**
 * 后处理栈（M11a，照 Unity URP 的 PC 档：HDR、MSAA、LDR 调色、32³ LUT）。只在 Unity 场景载入、画质不是「低」时接管；
 * 低画质 / 主菜单 / 网址带 post=0 时 Game 照原样直接画到画布（ACES，没有后处理）。
 *
 * 一帧（Game.render 调 render(camera, viewmodel)，返回 true = 这一帧画完了）：
 *   1. 世界 → hdr（半浮点 RGBA，MSAA 中 2× / 高 4×）。
 *   2. 枪模 viewScene → 同一张 hdr（先清深度；画之前一个全屏片把 alpha 清 0，之后 alpha = 枪模覆盖率）。
 *      同 Unity FirstPersonView：枪模和世界走同一遍后处理（泛光、色调映射、调色、暗角、色差都吃），不吃世界的阴影 / 雾 / 光柱。
 *      FirstPersonExposure（颜色 = 系数 × 颜色^伽马）在取样时按覆盖率补到枪模像素上。
 *   3. 泛光：URP Bloom.shader 的 Gaussian 金字塔（预滤波 → 横竖模糊下采样 → 散射混合上采样）。
 *   4. 调色 LUT：混好的 Volume 栈里调色参数变了的那一帧在 GPU 上重烘（LutBuilderLdr 的移植，32³ 条带，RGBA8）。
 *   5. UberPost → 画布：色差 → 泛光 → 暗角 → 后曝光 → Neutral（URP 的公式，不是 three 的 Khronos Neutral）→ LUT → sRGB。
 *   6. 显示空间的叠加物（SunShafts 光柱）：它拷画布、按显示空间的值算，所以放在调色之后画到画布上（一个代理网格转调
 *      原网格的 onBeforeRender，场景参数仍是世界场景）；这一帧真画了光柱、又画了枪模时，再按覆盖率把枪模像素重画一遍盖回去
 *      （光柱不落在枪上，和原来「世界 → 光柱 → 枪模」的顺序一样）。
 *
 * 场景缓冲为什么是 sRGB 编码的：Atmosphere 的雾片段、CloudSky、AirLife、MistStreams、Unity 水面等一批着色器
 * 在色彩空间转换之后按显示空间（sRGB）的颜色混雾、出色。hdr 标成 XR 渲染目标（three 对它和画布一样：按
 * renderer.toneMapping 做色调映射、按 texture.colorSpace 编码，雾色 / 背景色也按它换算），色调映射设成 None、
 * 颜色空间 sRGB——于是这些着色器拿到的数值和画到画布时一样（只是不再被 ACES 压缩、超过 1 的高光留着），
 * 后处理取样时再精确解码回线性。没有哪一层被色调映射两遍。
 */

const _camera = new THREE.Vector3();

/** 一个全屏三角形 */
function triangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return g;
}

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, extra: THREE.ShaderMaterialParameters = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: PASS_VERTEX, fragmentShader, depthTest: false, depthWrite: false, fog: false, toneMapped: false, ...extra,
  });
}

function target(w: number, h: number, options: THREE.RenderTargetOptions = {}): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, ...options,
  });
}

export interface PostStats {
  frames: number;
  lutBakes: number;
  bloomMips: number;
  shafts: number;
  samples: number;
  width: number;
  height: number;
}

let current: PostStack | null = null;

/**
 * 玩法 / 关卡代码用的钩子（PostStack 不在时什么也不做）：
 *   postEffects.pulseHurt(0.6)   受击色差脉冲（玩家受伤已经自动接了，机关 / 演出另外打）
 *   postEffects.pulseDash()      冲刺屏效（玩家冲刺已经自动接了）
 *   postEffects.addLayer({ priority: 50, weight: 0.8, overrides: { ColorAdjustments: { saturation: -20 } } })  天气、首领……返回注销函数
 *   postEffects.screenEffects = 0.5   设置「屏幕特效」
 */
export const postEffects = {
  pulseHurt(strength: number): void {
    current?.gameplay.pulseHurt(strength);
  },
  pulseDash(): void {
    current?.gameplay.pulseDash();
  },
  addLayer(layer: VolumeLayer): () => void {
    return postScene.addLayer(layer);
  },
  get screenEffects(): number {
    return current?.gameplay.amount ?? 1;
  },
  set screenEffects(value: number) {
    if (current) current.gameplay.amount = value;
  },
};

export class PostStack {
  readonly gameplay: GameplayVolumes;
  /** 上一帧混好的 Volume 栈（调试 / 截图核对用） */
  params: VolumeParams | null = null;
  readonly stats: PostStats = { frames: 0, lutBakes: 0, bloomMips: 0, shafts: 0, samples: 0, width: 0, height: 0 };
  /** 网址 post=0：整个关掉（对照截图用） */
  disabled: boolean;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly toneMapping: THREE.ToneMapping;
  private readonly supported: boolean;
  private hdr: THREE.WebGLRenderTarget | null = null;
  private readonly lut = target(LUT_SIZE * LUT_SIZE, LUT_SIZE, { type: THREE.UnsignedByteType });
  private lutKey = '';
  private mipDown: THREE.WebGLRenderTarget[] = [];
  private mipUp: THREE.WebGLRenderTarget[] = [];
  private readonly bloomBase = new THREE.Vector2(-1, -1);
  private readonly size = new THREE.Vector2();
  private readonly quad: THREE.Mesh;
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fp = new THREE.Vector4(1, 1, 0, 0);
  private readonly prefilter: THREE.ShaderMaterial;
  private readonly blurH: THREE.ShaderMaterial;
  private readonly blurV: THREE.ShaderMaterial;
  private readonly upsample: THREE.ShaderMaterial;
  private readonly lutBuilder: THREE.ShaderMaterial;
  private readonly uber: THREE.ShaderMaterial;
  private readonly uberVm: THREE.ShaderMaterial;
  private readonly alphaClear: THREE.Mesh;
  private readonly overlayScene = new THREE.Scene();
  private readonly proxies = new Map<THREE.Mesh, THREE.Mesh>();
  private engaged = false;
  /** 当前 Unity 场景的根节点（离开场景 = 关卡卸载了） */
  private stageRoot: THREE.Object3D | null = null;

  constructor(private readonly ctx: GameContext) {
    this.renderer = ctx.renderer;
    this.toneMapping = ctx.renderer.toneMapping;
    const search = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
    this.disabled = search.get('post') === '0';
    // 半浮点渲染目标（WebGL2 + EXT_color_buffer_float）不支持时整个不开
    this.supported = ctx.renderer.capabilities.isWebGL2 !== false
      && (ctx.renderer.extensions.has('EXT_color_buffer_float') || ctx.renderer.extensions.has('EXT_color_buffer_half_float'));
    if (!this.supported) console.warn('[post] 不支持半浮点渲染目标，后处理关闭');

    const geometry = triangle();
    this.quad = new THREE.Mesh(geometry, undefined);
    this.quad.frustumCulled = false;

    const shared = { tColor: { value: null }, uFp: { value: this.fp } };
    this.prefilter = pass(PREFILTER_FRAGMENT, { ...shared, uTexel: { value: new THREE.Vector2() }, uParams: { value: new THREE.Vector4() } });
    this.blurH = pass(BLUR_H_FRAGMENT, { tSource: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.blurV = pass(BLUR_V_FRAGMENT, { tSource: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upsample = pass(UPSAMPLE_FRAGMENT, { tSource: { value: null }, tLow: { value: null }, uScatter: { value: 0.5 } });
    this.lutBuilder = pass(LUT_FRAGMENT, {
      uLutParams: { value: new THREE.Vector4(LUT_SIZE, 0.5 / (LUT_SIZE * LUT_SIZE), 0.5 / LUT_SIZE, LUT_SIZE / (LUT_SIZE - 1)) },
      uColorBalance: { value: new THREE.Vector3(1, 1, 1) }, uColorFilter: { value: new THREE.Vector3(1, 1, 1) }, uHueSatCon: { value: new THREE.Vector3(0, 1, 1) },
      uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      uShadows: { value: new THREE.Vector3(1, 1, 1) }, uMidtones: { value: new THREE.Vector3(1, 1, 1) }, uHighlights: { value: new THREE.Vector3(1, 1, 1) },
      uShaHiLimits: { value: new THREE.Vector4(0, 0.3, 0.55, 1) },
    });
    const uberUniforms = (): Record<string, THREE.IUniform> => ({
      ...shared, tBloom: { value: null }, tLut: { value: this.lut.texture }, uBloom: { value: new THREE.Vector4() }, uBloomOn: { value: 0 },
      uChroma: { value: 0 }, uVignette1: { value: new THREE.Vector4() }, uVignette2: { value: new THREE.Vector4() },
      uLutParams: { value: new THREE.Vector4(1 / (LUT_SIZE * LUT_SIZE), 1 / LUT_SIZE, LUT_SIZE - 1, 1) }, uTonemap: { value: 1 },
    });
    this.uber = pass(UBER_FRAGMENT, uberUniforms());
    this.uberVm = pass(UBER_FRAGMENT, uberUniforms(), { defines: { VM_PASS: 1 }, transparent: true, blending: THREE.NormalBlending });

    // 画枪模之前的全屏片：颜色不动（ZERO, ONE），alpha 清 0（ZERO, ZERO）
    this.alphaClear = new THREE.Mesh(geometry, pass(ALPHA_CLEAR_FRAGMENT, {}, {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.ZeroFactor,
    }));
    this.alphaClear.name = 'PostStack.alphaClear';
    this.alphaClear.frustumCulled = false;
    this.alphaClear.renderOrder = -1e9;

    this.gameplay = new GameplayVolumes({
      hpFraction: () => {
        const max = ctx.player?.maxHp?.() ?? 0;
        return max > 0 ? ctx.player.hp / max : Number.NaN;
      },
      dead: () => !ctx.player?.alive,
      timeScale: () => ctx.time.timeScale,
      timePriority: () => {
        const winner = arbiterFor(ctx.time).winner;
        if (winner) return winner.priority;
        // 玩家阵亡：Game 直接写 0.3（Unity 走仲裁器的 DeathSlowMo）
        return ctx.player && !ctx.player.alive && ctx.time.timeScale < 0.98 ? TimePriority.DeathSlowMo : null;
      },
    });
    for (const layer of this.gameplay.layers) postScene.addLayer(layer);
    ctx.events.on('player:damaged', (e) => this.gameplay.onPlayerHit(e.toHp, e.toShield, (ctx.player.maxHp() || 0) + (ctx.player.maxShield() || 0)));
    ctx.events.on('player:dashed', () => this.gameplay.pulseDash());
    // 换关：认出 Unity 场景（UnitySceneView 的根节点 unity-scene-<id>），载入它的 Volume。Game 先于各系统建本对象，
    // 这个监听排在特效 / 弹体的着色器预热之前：先把渲染器切到后处理的状态，预热编出来的就是这里用的变体
    ctx.events.on('stage:loaded', () => this.attachStage());
    postScene.onChange(() => this.prime());
    current = this;
    // 先在后台读 volumes.json（57 KB），第一次进关时已经在缓存里
    if (this.supported && !this.disabled) void postScene.fetchDocument();

    if (search.has('debug') && typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__post = {
        stack: this, scene: postScene, effects: postEffects,
        /** GPU 烘的 LUT 和 CPU 参考实现逐格比，返回最大差（8 位的格数） */
        lutCheck: () => this.lutCheck(),
      };
    }
  }

  /** 这一帧是否接管 */
  get active(): boolean {
    return this.supported && !this.disabled && this.ctx.settings.quality !== 'low' && postScene.active;
  }

  /**
   * 画这一帧。返回 false = 不接管（Game 照原样直接画到画布）。
   * viewmodel = 这一帧要不要画枪模（同 Game 原来的判断：游戏 / 暂停 / 模态 / 过渡中，且没有检视相机）。
   */
  render(camera: THREE.Camera, viewmodel: boolean): boolean {
    const r = this.renderer, ctx = this.ctx;
    // 关卡卸载了（根节点离开场景）：不再接管，直到下一张 Unity 图载入
    if (this.stageRoot && this.stageRoot.parent !== ctx.scene) {
      this.stageRoot = null;
      postScene.clear();
    }
    if (!this.active) {
      this.disengage();
      return false;
    }
    this.engaged = true;
    this.gameplay.update();
    camera.getWorldPosition(_camera);
    const p = this.params = postScene.evaluate(_camera);
    const hdr = this.ensureTargets();
    r.toneMapping = THREE.NoToneMapping;

    // 1. 世界
    r.setRenderTarget(hdr);
    r.clear(true, true, false);
    r.render(ctx.scene, camera);

    // 2. 枪模（alpha = 覆盖率）
    if (viewmodel) {
      ctx.viewScene.add(this.alphaClear);
      r.clearDepth();
      try {
        r.render(ctx.viewScene, ctx.viewCamera);
      } finally {
        ctx.viewScene.remove(this.alphaClear);
      }
    }
    const fpe = p.FirstPersonExposure;
    this.fp.set(fpe.multiplier, fpe.gamma, viewmodel ? 1 : 0, 0);

    // 3. 泛光
    const bloom = p.Bloom.intensity > 0 ? this.renderBloom(p, hdr) : null;
    // 4. LUT
    this.bakeLut(p);
    // 5. UberPost → 画布
    this.setUber(this.uber, p, hdr, bloom);
    this.draw(this.uber, null);

    // 6. 显示空间的叠加物（光柱），再把枪模盖回去
    this.stats.shafts = 0;
    if (postScene.overlays.length > 0) {
      this.syncProxies();
      r.render(this.overlayScene, camera);
      for (const mesh of postScene.overlays) {
        const level = (mesh.material as THREE.ShaderMaterial).uniforms?.uShaft?.value?.x ?? 0;
        this.stats.shafts = Math.max(this.stats.shafts, level);
      }
      if (viewmodel && this.stats.shafts > 0) {
        this.setUber(this.uberVm, p, hdr, bloom);
        this.draw(this.uberVm, null);
      }
    }
    this.stats.frames++;
    return true;
  }

  dispose(): void {
    this.disengage();
    this.hdr?.dispose();
    this.lut.dispose();
    for (const t of [...this.mipDown, ...this.mipUp]) t.dispose();
    for (const m of [this.prefilter, this.blurH, this.blurV, this.upsample, this.lutBuilder, this.uber, this.uberVm, this.alphaClear.material as THREE.Material]) m.dispose();
    this.quad.geometry.dispose();
    if (current === this) current = null;
  }

  // ───────────── 内部 ─────────────

  /** stage:loaded：场景根下的 unity-scene-<id>（UnitySceneView）= 这一关是 Unity 场景，按它的 id 载入 Volume */
  private attachStage(): void {
    const prefix = 'unity-scene-';
    const root = this.ctx.scene.children.find(child => child.name.startsWith(prefix)) ?? null;
    this.stageRoot = root;
    if (!root) {
      postScene.clear();
      return;
    }
    void postScene.load(root.name.slice(prefix.length), root);
  }

  /**
   * 场景载入 / 卸载：要接管就提前把色调映射切成 None（之后的 compile / 预热编的就是这里用的变体——
   * 画到画布 + None + sRGB 和画到 hdr（XR 目标）+ None + sRGB 的着色器参数一样，命中同一个程序），不接管就还原
   */
  private prime(): void {
    if (!this.active) {
      this.disengage();
      return;
    }
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.engaged = true;
  }

  /** 还原成直接画到画布的状态 */
  private disengage(): void {
    const r = this.renderer;
    if (this.hdr && r.getRenderTarget() === this.hdr) r.setRenderTarget(null);
    if (!this.engaged) return;
    this.engaged = false;
    r.toneMapping = this.toneMapping;
  }

  private ensureTargets(): THREE.WebGLRenderTarget {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x)), h = Math.max(1, Math.floor(this.size.y));
    // Unity 的 MSAA：中 2×、高 4×（QualityProfile）
    const samples = this.ctx.settings.quality === 'high' ? 4 : 2;
    if (!this.hdr || this.hdr.width !== w || this.hdr.height !== h || this.hdr.samples !== samples) {
      this.hdr?.dispose();
      const hdr = target(w, h, { depthBuffer: true, samples });
      // 当成 XR 渲染目标：three 按 renderer.toneMapping / texture.colorSpace 出色（见类说明）
      hdr.texture.colorSpace = THREE.SRGBColorSpace;
      (hdr as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
      hdr.texture.name = 'PostStack.hdr';
      this.hdr = hdr;
      this.stats.samples = samples;
      this.stats.width = w;
      this.stats.height = h;
    }
    return this.hdr;
  }

  private draw(material: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(to);
    this.renderer.render(this.quad, this.quadCamera);
  }

  /** URP BloomPostProcessPass.BloomGaussian */
  private renderBloom(p: VolumeParams, hdr: THREE.WebGLRenderTarget): THREE.Texture {
    const b = p.Bloom;
    const down = b.downscale === 1 ? 2 : 1;
    const bw = Math.max(1, hdr.width >> down), bh = Math.max(1, hdr.height >> down);
    if (this.bloomBase.x !== bw || this.bloomBase.y !== bh) {
      for (const t of [...this.mipDown, ...this.mipUp]) t.dispose();
      this.mipDown = [];
      this.mipUp = [];
      let w = bw, h = bh;
      for (let i = 0; i < 8; i++) {
        this.mipDown.push(target(w, h));
        this.mipUp.push(target(w, h));
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
      }
      this.bloomBase.set(bw, bh);
    }
    const mipCount = Math.min(Math.max(Math.floor(Math.log2(Math.max(bw, bh)) - 1), 1), Math.max(1, b.maxIterations));
    this.stats.bloomMips = mipCount;

    const threshold = gammaToLinear(b.threshold);
    const scatter = 0.05 + (0.95 - 0.05) * b.scatter;
    const pf = this.prefilter.uniforms;
    pf.tColor.value = hdr.texture;
    pf.uTexel.value.set(1 / hdr.width, 1 / hdr.height);
    pf.uParams.value.set(scatter, b.clamp, threshold, threshold * 0.5);
    this.draw(this.prefilter, this.mipDown[0]);

    for (let i = 1; i < mipCount; i++) {
      const src = this.mipDown[i - 1];
      this.blurH.uniforms.tSource.value = src.texture;
      this.blurH.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.draw(this.blurH, this.mipUp[i]);
      const mid = this.mipUp[i];
      this.blurV.uniforms.tSource.value = mid.texture;
      this.blurV.uniforms.uTexel.value.set(1 / mid.width, 1 / mid.height);
      this.draw(this.blurV, this.mipDown[i]);
    }
    for (let i = mipCount - 2; i >= 0; i--) {
      const low = i === mipCount - 2 ? this.mipDown[i + 1] : this.mipUp[i + 1];
      const u = this.upsample.uniforms;
      u.tSource.value = this.mipDown[i].texture;
      u.tLow.value = low.texture;
      u.uScatter.value = scatter;
      this.draw(this.upsample, this.mipUp[i]);
    }
    return mipCount === 1 ? this.mipDown[0].texture : this.mipUp[0].texture;
  }

  private gradingInput(p: VolumeParams): GradingInput {
    const ca = p.ColorAdjustments, lgg = p.LiftGammaGain, smh = p.ShadowsMidtonesHighlights;
    return {
      temperature: p.WhiteBalance.temperature, tint: p.WhiteBalance.tint,
      contrast: ca.contrast, colorFilter: ca.colorFilter, hueShift: ca.hueShift, saturation: ca.saturation,
      lift: lgg.lift, gamma: lgg.gamma, gain: lgg.gain,
      shadows: smh.shadows, midtones: smh.midtones, highlights: smh.highlights,
      shadowsStart: smh.shadowsStart, shadowsEnd: smh.shadowsEnd, highlightsStart: smh.highlightsStart, highlightsEnd: smh.highlightsEnd,
    };
  }

  /** ColorGradingLutPass：调色参数变了才重烘（低血量 / 慢动作渐变时每帧烘，一遍 1024 × 32） */
  private bakeLut(p: VolumeParams): void {
    const input = this.gradingInput(p);
    const key = JSON.stringify(input);
    if (key === this.lutKey) return;
    this.lutKey = key;
    const u = lutUniforms(input), m = this.lutBuilder.uniforms;
    m.uColorBalance.value.fromArray(u.colorBalance);
    m.uColorFilter.value.fromArray(u.colorFilter);
    m.uHueSatCon.value.fromArray(u.hueSatCon);
    m.uLift.value.fromArray(u.lift);
    m.uGamma.value.fromArray(u.gamma);
    m.uGain.value.fromArray(u.gain);
    m.uShadows.value.fromArray(u.shadows);
    m.uMidtones.value.fromArray(u.midtones);
    m.uHighlights.value.fromArray(u.highlights);
    m.uShaHiLimits.value.fromArray(u.shaHiLimits);
    this.draw(this.lutBuilder, this.lut);
    this.stats.lutBakes++;
  }

  /** UberPostProcessPass 的参数 */
  private setUber(material: THREE.ShaderMaterial, p: VolumeParams, hdr: THREE.WebGLRenderTarget, bloom: THREE.Texture | null): void {
    const u = material.uniforms;
    u.tColor.value = hdr.texture;
    u.tBloom.value = bloom;
    u.uBloomOn.value = bloom ? 1 : 0;
    // 泛光色调：.linear，再按亮度归一
    const t = p.Bloom.tint, tr = gammaToLinear(t[0]), tg = gammaToLinear(t[1]), tb = gammaToLinear(t[2]), lum = luminance(tr, tg, tb);
    if (lum > 0) u.uBloom.value.set(p.Bloom.intensity, tr / lum, tg / lum, tb / lum);
    else u.uBloom.value.set(p.Bloom.intensity, 1, 1, 1);
    u.uChroma.value = p.ChromaticAberration.intensity > 0 ? p.ChromaticAberration.intensity * 0.05 : 0;
    const v = p.Vignette;
    u.uVignette1.value.set(v.color[0], v.color[1], v.color[2], v.rounded ? hdr.width / hdr.height : 1);
    u.uVignette2.value.set(v.center[0], v.center[1], v.intensity * 3, v.smoothness * 5);
    u.uLutParams.value.w = Math.pow(2, p.ColorAdjustments.postExposure);
    // ACES 没有关卡用；万一有，按 Neutral 画（LDR 档的 ACES 曲线没移植）
    u.uTonemap.value = p.Tonemapping.mode === TONEMAP_NONE ? 0 : 1;
  }

  /** 叠加物的代理：共用原网格的几何体和材质，onBeforeRender 转给原网格（场景参数给世界场景：光柱的门槛读雾色） */
  private syncProxies(): void {
    const live = new Set(postScene.overlays);
    for (const [mesh, proxy] of this.proxies) {
      if (live.has(mesh)) continue;
      this.overlayScene.remove(proxy);
      this.proxies.delete(mesh);
    }
    for (const mesh of postScene.overlays) {
      let proxy = this.proxies.get(mesh);
      if (!proxy) {
        proxy = new THREE.Mesh(mesh.geometry, mesh.material);
        proxy.frustumCulled = false;
        proxy.renderOrder = mesh.renderOrder;
        proxy.onBeforeRender = (renderer, _scene, camera, geometry, material, group) =>
          mesh.onBeforeRender(renderer, this.ctx.scene, camera, geometry, material, group);
        this.overlayScene.add(proxy);
        this.proxies.set(mesh, proxy);
      }
      proxy.visible = mesh.visible && mesh.parent !== null;
    }
  }

  /** 调试：读回 GPU 烘的 LUT，和 CPU 参考实现（UrpColor.bakeLutLdr）逐格比，返回最大差（8 位的格数）和平均差 */
  private lutCheck(): { max: number; mean: number; texels: number } | null {
    if (!this.params) return null;
    const u = lutUniforms(this.gradingInput(this.params));
    const cpu = bakeLutLdr(u, LUT_SIZE);
    const gpu = new Uint8Array(cpu.length);
    this.renderer.readRenderTargetPixels(this.lut, 0, 0, LUT_SIZE * LUT_SIZE, LUT_SIZE, gpu);
    let max = 0, sum = 0, n = 0;
    for (let i = 0; i < cpu.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(cpu[i + c] - gpu[i + c]);
        max = Math.max(max, d);
        sum += d;
        n++;
      }
    }
    return { max, mean: sum / n, texels: cpu.length / 4 };
  }
}
