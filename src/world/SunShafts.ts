import * as THREE from 'three';
import { Atmosphere } from './Atmosphere';

/**
 * 逆光的光柱（docs/art/composition.md 第 8.4 节）：太阳在画面里或画面边上时，把太阳附近天空里足够亮的部分
 * 沿着「离开太阳」的方向拖出去——光从山口、殿脊、树冠的缺口里漏出来，遮住太阳的东西投下一道道暗条。
 *
 * 做法取舍（主游戏直接画到画布，没有后期链，也没有场景颜色 / 深度贴图）：
 *   选的：画完世界之后把画布拷一份（copyTexSubImage2D，一次全屏拷贝），四分之一分辨率做亮度遮罩 + 三遍
 *         径向模糊，再用一个全屏三角形加色叠回去。整件事发生在这个网格自己的 onBeforeRender 里：
 *         不改 Game 的渲染流程，不多画一遍场景，绘制调用 +5；太阳不在画面附近时整个跳过（三角形移出裁剪空间）。
 *   没选：朝太阳的加色扇面（几何体）——零额外通道，但光柱的形状和遮挡无关，只是一张贴在天上的放射纹；
 *         为了要遮挡再画一遍场景深度——绘制调用翻倍，4-1 这种七百多次调用的图划不来。
 * 克制：强度默认 0.22；叠回去时按原画面的亮度加权（暗处保护），逆光的敌人和山的剪影不被照灰，
 *       被提亮的主要是它们背后的雾和天——剪影和背景的明度差只增不减（第 6 节「敌人优先」）。
 * 颜色是显示空间的（拷的就是画布上的值）。只在直接画到画布时生效；画到渲染目标（截图、缩略图）时不出光柱。
 *
 * 用法（先 Atmosphere.bind，太阳方向读它的）：
 *   const shafts = new SunShafts();
 *   scene.add(shafts.mesh);        // 世界场景里最后画（renderOrder 很大），第一人称武器那一层在它之后、不受影响
 *   shafts.dispose();              // 卸载这张图时
 */
export interface SunShaftOptions {
  /** 强度，默认 0.22。熔火章（天是烟）给 0.1 以下或者干脆不接 */
  strength?: number;
  /** 光柱拖多远 0..0.98，默认 0.93：一个亮点离太阳 r，能拖到离太阳 r / (1 - length) 处。小 = 只是太阳周围一圈光晕 */
  length?: number;
  /** 太阳周围多大范围的天空算光源（画面高度的倍数），默认 0.8 */
  radius?: number;
  /** 亮度门槛（显示空间 0..1）：比它亮的才算光源。不给就按场景雾色自动定（比雾色亮一点） */
  threshold?: number;
  /** 暗处保护 0..1，默认 0.6：0 = 纯加色，1 = 暗的像素完全不被照亮 */
  protect?: number;
  /** 日盘补偿，默认 4：画布上的颜色最多到 1，烧白的那一小块（日盘、光晕的芯）按 1 + boost 倍算，光才拖得远 */
  boost?: number;
  /** 光柱往日光色偏多少 0..1，默认 0.5 */
  tint?: number;
}

const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = position.xy * 0.5 + 0.5;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const MASK_FRAGMENT = /* glsl */ `
uniform sampler2D tFrame;
uniform vec2 uTexel;
uniform vec2 uSun;
uniform float uAspect;
uniform vec4 uMask; // 门槛下限, 上限, 1 / 半径², 日盘补偿
uniform vec3 uTint;
varying vec2 vUv;
void main() {
	vec3 c = 0.25 * ( texture2D( tFrame, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb + texture2D( tFrame, vUv + uTexel * vec2( 1.0, -1.0 ) ).rgb
		+ texture2D( tFrame, vUv + uTexel * vec2( -1.0, 1.0 ) ).rgb + texture2D( tFrame, vUv + uTexel * vec2( 1.0, 1.0 ) ).rgb );
	float l = dot( c, vec3( 0.3, 0.5, 0.2 ) );
	vec2 q = ( vUv - uSun ) * vec2( uAspect, 1.0 );
	float core = smoothstep( 0.9, 1.0, l );
	gl_FragColor = vec4( c * uTint * ( exp( -dot( q, q ) * uMask.z ) * ( smoothstep( uMask.x, uMask.y, l ) + uMask.w * core * core ) ), 1.0 );
}
`;

const BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uSun;
uniform float uLength;
varying vec2 vUv;
void main() {
	vec2 dir = ( uSun - vUv ) * uLength;
	vec3 sum = vec3( 0.0 );
	float total = 0.0;
	for ( int i = 0; i < 8; i++ ) {
		float f = ( float( i ) + 0.5 ) / 8.0;
		vec2 uv = vUv + dir * f;
		float inside = step( 0.0, uv.x ) * step( uv.x, 1.0 ) * step( 0.0, uv.y ) * step( uv.y, 1.0 );
		float w = 1.0 - f * 0.35;
		sum += texture2D( tSource, uv ).rgb * w * inside;
		total += w;
	}
	gl_FragColor = vec4( sum / total, 1.0 );
}
`;

const COMPOSITE_VERTEX = /* glsl */ `
uniform vec4 uShaft; // 强度, 暗处保护, 0, 0
varying vec2 vUv;
void main() {
	vUv = position.xy * 0.5 + 0.5;
	// 这一帧没有光柱：三角形移出裁剪空间，一个像素都不画
	gl_Position = uShaft.x > 0.0 ? vec4( position.xy, 0.0, 1.0 ) : vec4( 2.0, 2.0, 2.0, 1.0 );
}
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D tShaft;
uniform sampler2D tFrame;
uniform vec4 uShaft;
varying vec2 vUv;
void main() {
	vec3 s = texture2D( tShaft, vUv ).rgb * uShaft.x;
	// 膝：太阳跟前不再往上堆成一团白，远处拖出去的那点光原样保留
	s /= 1.0 + 1.5 * dot( s, vec3( 0.3, 0.5, 0.2 ) );
	// 暗处保护：原画面越暗的地方加得越少，逆光的剪影保持是剪影
	float l = dot( texture2D( tFrame, vUv ).rgb, vec3( 0.3, 0.5, 0.2 ) );
	s *= mix( 1.0, smoothstep( 0.04, 0.6, l ), uShaft.y );
	// 抖动：大片平滑的渐变叠在天上不出色带
	float n = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	gl_FragColor = vec4( max( s + ( n - 0.5 ) / 255.0, 0.0 ), 1.0 );
}
`;

// 三遍径向模糊，每遍 8 个采样：前两遍的步长固定，补上后一遍相邻采样之间的空隙；最后一遍的步长由 length 定
const BLUR_NEAR = 0.1, BLUR_MID = 0.32;

export class SunShafts {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** 可以随时改，下一帧生效 */
  readonly options: Required<Omit<SunShaftOptions, 'threshold'>> & { threshold: number | null };
  /** 上一帧光柱实际的强度（0 = 这一帧没画）：检视 / 调试用 */
  level = 0;

  private frame: THREE.FramebufferTexture | null = null;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private readonly passScene = new THREE.Scene();
  private readonly passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly passMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly mask: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;
  private readonly size = new THREE.Vector2();
  private readonly sun = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly fogColor = new THREE.Color();

  constructor(options: SunShaftOptions = {}) {
    this.options = {
      strength: options.strength ?? 0.22, length: options.length ?? 0.93, radius: options.radius ?? 0.8,
      threshold: options.threshold ?? null, protect: options.protect ?? 0.6, tint: options.tint ?? 0.5, boost: options.boost ?? 4,
    };
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({ uniforms, vertexShader: PASS_VERTEX, fragmentShader, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    this.mask = pass(MASK_FRAGMENT, {
      tFrame: { value: null }, uTexel: { value: new THREE.Vector2() }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 },
      uMask: { value: new THREE.Vector4() }, uTint: { value: new THREE.Vector3(1, 1, 1) },
    });
    this.blur = pass(BLUR_FRAGMENT, { tSource: { value: null }, uSun: this.mask.uniforms.uSun, uLength: { value: 0 } });
    this.passMesh = new THREE.Mesh(triangle, this.mask);
    this.passMesh.frustumCulled = false;
    this.passScene.add(this.passMesh);

    const material = new THREE.ShaderMaterial({
      uniforms: { tShaft: { value: null }, tFrame: { value: null }, uShaft: { value: new THREE.Vector4() } },
      vertexShader: COMPOSITE_VERTEX, fragmentShader: COMPOSITE_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(triangle, material);
    this.mesh.name = 'SunShafts';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9000;
    this.mesh.onBeforeRender = (renderer, scene, camera) => this.prepare(renderer as THREE.WebGLRenderer, scene, camera);
  }

  /** 世界画完、轮到这个网格之前：拷画布、做遮罩和径向模糊，把结果交给叠加用的材质 */
  private prepare(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const shaft = this.mesh.material.uniforms.uShaft.value as THREE.Vector4, o = this.options;
    shaft.set(0, o.protect, 0, 0);
    this.level = 0;
    const sunLight = Atmosphere.uniforms.sfSunLight.value as Float32Array, sunDir = Atmosphere.uniforms.sfAtmoSunDir.value as Float32Array;
    // 只在直接画到画布时做；空气透视没接上、太阳落山时不做
    if (!Atmosphere.active || renderer.getRenderTarget() !== null || sunLight[3] <= 0 || o.strength <= 0) return;
    camera.getWorldDirection(this.forward);
    const facing = this.forward.x * sunDir[0] + this.forward.y * sunDir[1] + this.forward.z * sunDir[2];
    if (facing < 0.12) return;
    this.sun.set(sunDir[0], sunDir[1], sunDir[2]).multiplyScalar(1000).add(camera.getWorldPosition(this.forward)).project(camera);
    // 太阳离开画面越远越弱：出画一个画面高度之外就没有了
    const out = Math.max(Math.abs(this.sun.x) - 1, Math.abs(this.sun.y) - 1, 0);
    const level = o.strength * sunLight[3] * Math.min(1, (facing - 0.12) / 0.2) * Math.max(0, 1 - out / 0.9);
    if (level < 0.004) return;

    renderer.getDrawingBufferSize(this.size);
    const width = this.size.x, height = this.size.y, w = Math.max(1, Math.round(width / 4)), h = Math.max(1, Math.round(height / 4));
    if (!this.frame || this.frame.image.width !== width || this.frame.image.height !== height) {
      this.frame?.dispose();
      this.frame = new THREE.FramebufferTexture(width, height);
      this.frame.minFilter = this.frame.magFilter = THREE.LinearFilter;
    }
    if (!this.targets || this.targets[0].width !== w || this.targets[0].height !== h) {
      this.targets?.forEach(target => target.dispose());
      const make = (): THREE.WebGLRenderTarget => new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      this.targets = [make(), make()];
    }
    renderer.copyFramebufferToTexture(this.frame);

    // 门槛：从比雾色暗一点起算（雾色 = 地平线上最常见的亮度），太阳周围那片更亮的天整片都是光源，被山尖、殿脊切开才有一道道的光
    let low = o.threshold ?? 0.8;
    if (o.threshold === null && scene.fog) {
      const c = this.fogColor.copy(scene.fog.color).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
      low = Math.min(0.85, Math.max(0.3, 0.3 * c.r + 0.5 * c.g + 0.2 * c.b - 0.06));
    }
    const m = this.mask.uniforms, tint = o.tint;
    m.tFrame.value = this.frame;
    m.uTexel.value.set(1 / width, 1 / height);
    m.uSun.value.set(this.sun.x * 0.5 + 0.5, this.sun.y * 0.5 + 0.5);
    m.uAspect.value = width / height;
    m.uMask.value.set(low, Math.min(1, low + 0.22), 1 / Math.max(0.01, o.radius * o.radius), Math.max(0, o.boost));
    const peak = Math.max(sunLight[0], sunLight[1], sunLight[2], 1e-3);
    m.uTint.value.set(1 + (sunLight[0] / peak - 1) * tint, 1 + (sunLight[1] / peak - 1) * tint, 1 + (sunLight[2] / peak - 1) * tint);

    // 中途换渲染目标再换回来（和 three 的 Reflector 同一个做法）；统计不清零，这几遍照常算进这一帧
    const autoReset = renderer.info.autoReset, shadows = renderer.shadowMap.autoUpdate, xr = renderer.xr.enabled;
    renderer.info.autoReset = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.xr.enabled = false;
    let [a, b] = this.targets;
    this.passMesh.material = this.mask;
    renderer.setRenderTarget(a);
    renderer.render(this.passScene, this.passCamera);
    this.passMesh.material = this.blur;
    const far = 1 - (1 - Math.min(0.98, Math.max(0.5, o.length))) / ((1 - BLUR_NEAR) * (1 - BLUR_MID));
    for (const step of [BLUR_NEAR, BLUR_MID, far]) {
      this.blur.uniforms.tSource.value = a.texture;
      this.blur.uniforms.uLength.value = step;
      renderer.setRenderTarget(b);
      renderer.render(this.passScene, this.passCamera);
      [a, b] = [b, a];
    }
    renderer.setRenderTarget(null);
    renderer.info.autoReset = autoReset;
    renderer.shadowMap.autoUpdate = shadows;
    renderer.xr.enabled = xr;

    const u = this.mesh.material.uniforms;
    u.tShaft.value = a.texture;
    u.tFrame.value = this.frame;
    shaft.x = level;
    this.level = level;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mask.dispose();
    this.blur.dispose();
    this.frame?.dispose();
    this.targets?.forEach(target => target.dispose());
    this.frame = null;
    this.targets = null;
  }
}
