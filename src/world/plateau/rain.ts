/**
 * 雨（docs/art/reference-tingyuyuan.md 第四节第 8 项，做法照《听雨园》的 weather/rain.js、veil.js、splash.js 重写）：
 *
 * - 雨丝：两个跟着镜头、取模循环的体积（近处 18×14×18 m 密、远处 50×30×50 m 疏），实例化面片，全在 GPU 上算，CPU 不逐滴更新。
 *   每滴按「这一帧到 1/40 秒前」两点投到屏幕上拉成一段，宽度夹在 1.2–2 像素，越长越淡（透明度 ∝ 1/长度，封顶）；
 *   落到遮挡图（coverMap.ts）以下就没了——檐下、树下、桥下没雨，落到水面为止。
 * - 远处雨幕：镜头四周 4 层圆柱「帘子」（14 / 22 / 34 / 52 m），每层一次绘制，画一格格错开的竖线 + 一层很淡的雾；
 *   遮挡图下面（屋里、桥下）不画。
 * - 水花：镜头周围 14 m 里的实例化小水花（落点一闪 + 崩出几粒水珠，只占每个周期的前 30%），
 *   位置每个周期按实例号 + 周期号哈希、落在遮挡图的表面（地面、屋顶、水面）上。
 *
 * 强度 0..1（Weather 的雷暴程度），风向跟全图的风。不写透明通道（湖面反射贴图拿它当标记）。
 */
import * as THREE from 'three';
import { COVER_GLSL, WORLD_UNIFORMS } from './materials';

const NEAR = { count: 9000, size: new THREE.Vector3(18, 14, 18), lift: 0.35, width: 1.9, alpha: 0.3 };
const FAR = { count: 14000, size: new THREE.Vector3(50, 30, 50), lift: 0.25, width: 1.3, alpha: 0.18 };
const VEILS = [14, 22, 34, 52];
const SPLASHES = 2000;

const DROP_VS = /* glsl */ `
attribute vec2 aCorner;     // x: −1 / 1 横向，y: 0 = 雨滴头，1 = 尾
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uSize;
uniform float uLift;
uniform vec3 uVel;
uniform float uIntensity;
uniform vec2 uViewport;
uniform float uWidth;
uniform float uAlpha;
uniform sampler2D uCoverTex;
uniform vec4 uCoverXf;
varying float vAlpha;
varying float vAlong;
${COVER_GLSL}
void main() {
  vAlong = aCorner.y;
  vAlpha = 0.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (aSeed.w > uIntensity) return;                       // 雨小时只留一部分
  vec3 vel = uVel * vec3(1.0, 0.85 + 0.3 * fract(aSeed.w * 7.31), 1.0);
  vec3 lo = uCam - uSize * vec3(0.5, uLift, 0.5);
  vec3 p = lo + mod(aSeed.xyz * uSize + vel * uTime - lo, uSize);
  if (p.y < coverAt(p.xz)) return;                         // 檐下、树下、水面以下
  vec3 tail = p - vel * (1.0 / 40.0);
  vec4 c0 = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(tail, 1.0);
  if (c0.w < 0.3 || c1.w < 0.3) return;
  vec2 s0 = c0.xy / c0.w * uViewport * 0.5, s1 = c1.xy / c1.w * uViewport * 0.5;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(0.0, 1.0);
  vec2 nrm = vec2(dir.y, -dir.x);                          // 这个方向面片才是逆时针（正面），反过来会被背面剔除
  vec4 c = mix(c0, c1, aCorner.y);
  c.xy += nrm * aCorner.x * (uWidth * 0.5) / (uViewport * 0.5) * c.w;
  gl_Position = c;
  float dist = c0.w;
  // 越长越淡（同一滴的光摊在更长的一段上）；贴着镜头的淡掉（像失焦），远处跟着体积边缘淡掉
  vAlpha = uAlpha * clamp(14.0 / max(len, 14.0), 0.2, 1.0) * smoothstep(0.6, 2.0, dist) * (1.0 - smoothstep(uSize.x * 0.35, uSize.x * 0.5, distance(p.xz, uCam.xz)));
}`;

const DROP_FS = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
varying float vAlong;
void main() {
  float a = vAlpha * sin(3.14159 * clamp(vAlong, 0.0, 1.0));
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const VEIL_VS = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const VEIL_FS = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;
uniform float uRadius;
uniform float uFall;
uniform vec2 uWind;
uniform float uIntensity;
uniform float uAlpha;
uniform vec3 uColor;
uniform sampler2D uCoverTex;
uniform vec4 uCoverXf;
varying vec3 vWorld;
${COVER_GLSL}
float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  if (vWorld.y < coverAt(vWorld.xz)) discard;
  vec2 rel = vWorld.xz - uCam.xz;
  float u = atan(rel.y, rel.x) * uRadius;                       // 绕一圈的米数
  float spacing = 0.22 + uRadius * 0.004;
  float y = vWorld.y + dot(uWind, normalize(rel)) * 0.0;
  float col = floor(u / spacing);
  float h = hash(col + uRadius * 13.0);
  float x = fract(u / spacing) - 0.5 + (h - 0.5) * 0.7;
  float seg = fract((y + uFall * uTime * (0.9 + 0.2 * h)) / (1.6 + uRadius * 0.03) + h * 7.0);
  float streak = smoothstep(0.0, 0.08, seg) * (1.0 - smoothstep(0.3, 0.55, seg));
  float line = 1.0 - smoothstep(0.0, 0.06 + uRadius * 0.0012, abs(x));
  // 上下淡出（帘子顶和底），很淡的一层雨雾
  float vfade = smoothstep(uCam.y - 14.0, uCam.y - 6.0, vWorld.y) * (1.0 - smoothstep(uCam.y + 10.0, uCam.y + 24.0, vWorld.y));
  float a = (line * streak * 0.8 + 0.12) * uAlpha * uIntensity * vfade;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const SPLASH_VS = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform float uIntensity;
uniform sampler2D uCoverTex;
uniform vec4 uCoverXf;
varying vec2 vUv;
varying float vK;
varying float vSeed;
${COVER_GLSL}
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vUv = aCorner; vK = 1.0; vSeed = aSeed.y;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (aSeed.w > uIntensity) return;
  float period = 0.35 + aSeed.z * 0.4;
  float t = uTime / period + aSeed.x * 17.0;
  float cyc = floor(t);
  // 一个周期里只有前 30% 有水花（一溅就没），其余时间这个实例空着
  vK = fract(t) / 0.3;
  if (vK > 1.0) return;
  // 每个周期换一个地方：镜头周围 14 m 的格子（格子按镜头吸附，不跟着镜头滑）
  vec2 base = floor(uCam.xz / 14.0) * 14.0;
  vec2 xz = base + vec2(hash2(vec2(cyc, aSeed.y * 91.0)), hash2(vec2(aSeed.y * 53.0, cyc + 3.1))) * 28.0 - 7.0;
  if (distance(xz, uCam.xz) > 14.0) return;
  float y = coverAt(xz);
  if (y < -1000.0) return;
  float size = (0.035 + aSeed.z * 0.045) * (0.7 + 0.6 * vK);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 wp = vec3(xz.x, y + 0.01, xz.y) + right * aCorner.x * size + vec3(0.0, aCorner.y * size * 1.2, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const SPLASH_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
varying float vK;
varying float vSeed;
void main() {
  // 一溅：落点先闪一下，再往上、往外崩出几粒水珠（断开的一圈，不是整条弧），很快淡掉
  vec2 p = vec2(vUv.x, vUv.y * 1.2);
  float r = length(p);
  float ang = atan(p.x, p.y);
  float rad = 0.3 + 0.55 * vK;
  float beads = smoothstep(0.55, 0.95, cos(ang * 4.0 + vSeed * 40.0)) * exp(-pow((r - rad) / 0.12, 2.0));
  float flash = (1.0 - smoothstep(0.0, 0.35, r)) * (1.0 - smoothstep(0.0, 0.4, vK));
  float a = (beads * 0.9 + flash) * smoothstep(0.0, 0.06, vUv.y) * uAlpha * (1.0 - vK);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

/** 不改透明通道的普通混合 */
function blendKeepAlpha(m: THREE.ShaderMaterial): THREE.ShaderMaterial {
  Object.assign(m, {
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  return m;
}

function quadInstances(count: number, corners: number[]): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array((corners.length / 2) * 3).fill(0), 3));
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  g.instanceCount = count;
  return g;
}

export class Rain {
  readonly group = new THREE.Group();
  /** 当前强度（0..1） */
  intensity = 0;
  private readonly drops: THREE.ShaderMaterial[] = [];
  private readonly veils: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  private readonly splash: THREE.ShaderMaterial;
  private readonly color = new THREE.Color('#c3cbd8');
  private readonly cam = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly viewport = new THREE.Vector2(1280, 720);

  constructor(scene: THREE.Scene) {
    this.group.name = 'rain';
    for (const V of [FAR, NEAR]) {
      const mat = blendKeepAlpha(new THREE.ShaderMaterial({
        vertexShader: DROP_VS, fragmentShader: DROP_FS,
        uniforms: {
          uTime: WORLD_UNIFORMS.uTime, uCam: { value: this.cam }, uSize: { value: V.size }, uLift: { value: V.lift }, uVel: { value: this.vel },
          uIntensity: { value: 0 }, uViewport: { value: this.viewport }, uWidth: { value: V.width }, uAlpha: { value: V.alpha },
          uColor: { value: this.color }, uCoverTex: WORLD_UNIFORMS.uCoverTex, uCoverXf: WORLD_UNIFORMS.uCoverXf,
        },
      }));
      const mesh = new THREE.Mesh(quadInstances(V.count, [-1, 0, 1, 0, -1, 1, 1, 1]), mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.drops.push(mat);
      this.group.add(mesh);
    }
    for (const R of VEILS) {
      const mat = blendKeepAlpha(new THREE.ShaderMaterial({
        vertexShader: VEIL_VS, fragmentShader: VEIL_FS, side: THREE.BackSide,
        uniforms: {
          uTime: WORLD_UNIFORMS.uTime, uCam: { value: this.cam }, uRadius: { value: R }, uFall: { value: 9 }, uWind: { value: new THREE.Vector2() },
          uIntensity: { value: 0 }, uAlpha: { value: 0.16 - R * 0.0012 }, uColor: { value: this.color },
          uCoverTex: WORLD_UNIFORMS.uCoverTex, uCoverXf: WORLD_UNIFORMS.uCoverXf,
        },
      }));
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 40, 64, 1, true), mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.veils.push({ mesh, mat });
      this.group.add(mesh);
    }
    this.splash = blendKeepAlpha(new THREE.ShaderMaterial({
      vertexShader: SPLASH_VS, fragmentShader: SPLASH_FS,
      uniforms: {
        uTime: WORLD_UNIFORMS.uTime, uCam: { value: this.cam }, uIntensity: { value: 0 }, uAlpha: { value: 0.75 }, uColor: { value: this.color },
        uCoverTex: WORLD_UNIFORMS.uCoverTex, uCoverXf: WORLD_UNIFORMS.uCoverXf,
      },
    }));
    const sm = new THREE.Mesh(quadInstances(SPLASHES, [-1, 0, 1, 0, -1, 1, 1, 1]), this.splash);
    sm.frustumCulled = false;
    sm.renderOrder = 6;
    this.group.add(sm);
    this.group.visible = false;
    scene.add(this.group);
  }

  /**
   * 每帧：intensity = 雷暴程度（0..1）；wind = 风（米 / 秒，xz）；fogColor = 当前雾色（雨丝的颜色跟着它，比天暗一点）；
   * pixelWidth / pixelHeight：画布像素（雨丝的像素宽度用）
   */
  update(camera: THREE.Camera, intensity: number, wind: THREE.Vector2, fogColor: THREE.Color, pixelWidth: number, pixelHeight: number, dt = 1 / 60): void {
    this.intensity = intensity;
    // 湿度：下雨时渐湿（十几秒湿透），雨停慢慢干（约一分钟）；积水映的是当前的雾 / 天色
    const W = WORLD_UNIFORMS.uWet;
    W.value += (intensity - W.value) * Math.min(1, dt * (intensity > W.value ? 0.15 : 0.03));
    (WORLD_UNIFORMS.uRainSky.value as THREE.Vector3).set(fogColor.r, fogColor.g, fogColor.b);
    this.group.visible = intensity > 0.01;
    if (!this.group.visible) return;
    camera.getWorldPosition(this.cam);
    this.viewport.set(pixelWidth, pixelHeight);
    this.vel.set(wind.x, -9.5, wind.y);
    // 雨丝颜色：雾色往亮里提一点、往冷里偏一点（它折射的是天和周围，比天暗）
    this.color.copy(fogColor).lerp(new THREE.Color('#e8eef6'), 0.6);
    for (const m of this.drops) m.uniforms.uIntensity.value = intensity;
    for (const { mesh, mat } of this.veils) {
      mesh.position.set(this.cam.x, this.cam.y, this.cam.z);
      mat.uniforms.uIntensity.value = intensity;
      (mat.uniforms.uWind.value as THREE.Vector2).copy(wind);
    }
    this.splash.uniforms.uIntensity.value = intensity;
  }
}
