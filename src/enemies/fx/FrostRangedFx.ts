/**
 * 第二章远程组（夫诸、冰鲸）的冰系特效与危险物。全部挂 ctx.stageGroup、由 ctx.tasks 驱动：
 * 施放者死亡 / 被打断后，已经发出的冰光余迹、冰柱、冰棱阵照样兑现（与蜃火珠、重炮兵的炮弹一致）。
 *
 *  - applyIceGlow：在美术材质上叠「冰晶自发光」——只点亮贴图里的青色（夫诸的四角角尖与胸口宝石、冰鲸的喷气孔），
 *    白毛、青灰纹、浅蓝冰壳都不亮；强度由敌人按蓄力进度驱动。
 *  - createFrostGlow：朝镜头的十字星光点（挂在角尖 / 喷气孔骨骼上，蓄力时变大变亮）。
 *  - castIceBeam：直线冰光。世界射线先求被掩体挡住的终点，再对「起点 → 终点」线段做玩家胶囊判定；留下冻地。
 *  - spawnFrozenStrip：冰光扫过的地面结冰 4 秒：冰面贴片 + 冰晶碎片；玩家踩在上面时加速度只剩一小部分（打滑）。
 *  - launchIcePillars：喷气孔喷出一道高高的冰雾气柱（spoutPlume），把冰柱喷上天，再分几处砸下（落点预警圈）；
 *    落点长出冰棱阵。
 *  - spawnSpikeField：冰棱阵——一簇冰锥 + 一个临时碰撞盒（CollisionWorld.addFromBottom / remove，只挡移动不挡子弹），
 *    盒子要等落点上没有玩家 / 敌人之后才放进去，不会把人卡进墙里或顶到冰棱上面。
 *  - spawnIceShockwave：贴地扩散的冰冲击波环（跳起或掩体能躲）。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../../core/types';
import { clamp01 } from '../../core/math';
import { BeamMesh } from '../bosses/Visuals';

export const FROST = {
  beam: 0x6fe6ff, core: 0xf0ffff, warn: 0x6fd8ff, strip: 0xa8ecff, ice: 0xcff4ff, iceDeep: 0x5fc8f0,
  mist: 0xe8f8ff, spark: 0xc8f8ff, shard: 0xdff6ff, snow: 0xf4fbff,
  /** 浅色冰面上的落点预警（饱和电光蓝；浅青的 warn 在冰面上几乎看不见） */
  warnSolid: 0x1a8cff,
  /** 喷气柱：外沿饱和青（亮背景上读得出轮廓）、中心近白 */
  plume: 0x38c4ff, plumeCore: 0xeaffff,
};

/** 所有冰系着色器共用的时钟（敌人每帧写入 ctx.time.now） */
export const FROST_FX_TIME = { value: 0 };

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

const NOISE = /* glsl */ `
float frHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float frNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(frHash(i), frHash(i + vec3(1,0,0)), f.x), mix(frHash(i + vec3(0,1,0)), frHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(frHash(i + vec3(0,0,1)), frHash(i + vec3(1,0,1)), f.x), mix(frHash(i + vec3(0,1,1)), frHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

// ───────────── 冰晶自发光（美术材质） ─────────────

export interface IceGlowHandle {
  /** 0 = 不亮；~0.4 平时微光；1.5+ 蓄力满 */
  readonly glow: { value: number };
}

/**
 * 在材质上叠冰晶自发光（保留原有 onBeforeCompile，例如角色边缘光）。识别在线性空间：
 * 蓝远大于红、绿也高 = 青色（角尖、宝石、喷气孔）；浅蓝冰壳（蓝 - 红约 0.4）和青灰毛纹不亮。
 */
export function applyIceGlow(material: THREE.MeshStandardMaterial, color = FROST.beam): IceGlowHandle {
  const glow = { value: 0.4 };
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.uIceTime = FROST_FX_TIME;
    shader.uniforms.uIceGlow = glow;
    shader.uniforms.uIceColor = { value: new THREE.Color(color) };
    shader.vertexShader = 'varying vec3 vIcePos;\n' + shader.vertexShader.replace(
      '#include <skinning_vertex>', '#include <skinning_vertex>\n  vIcePos = transformed;');
    shader.fragmentShader = 'uniform float uIceTime;\nuniform float uIceGlow;\nuniform vec3 uIceColor;\nvarying vec3 vIcePos;\n'
      + NOISE + shader.fragmentShader.replace('#include <opaque_fragment>', `
        {
          vec3 ic = diffuseColor.rgb;
          float cyan = smoothstep(0.5, 0.7, ic.b - ic.r) * smoothstep(0.35, 0.6, ic.g);
          float n = frNoise(vIcePos * 7.0 + vec3(0.0, uIceTime * 1.7, 0.0));
          outgoingLight += uIceColor * cyan * uIceGlow * (0.55 + 0.7 * n);
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `${prevKey}+iceglow`;
  material.needsUpdate = true;
  return { glow };
}

// ───────────── 星光点（角尖 / 喷气孔） ─────────────

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float sx = length(modelViewMatrix[0].xyz);
  mv.xy += position.xy * sx;
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAG = /* glsl */ `
uniform float uAlpha; uniform float uTime; uniform float uSeed; uniform vec3 uColor; uniform vec3 uCore;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float spin = uTime * 0.6 + uSeed * 6.0;
  vec2 q = vec2(cos(spin) * p.x - sin(spin) * p.y, sin(spin) * p.x + cos(spin) * p.y);
  float star = max(exp(-abs(q.x) * 18.0) , exp(-abs(q.y) * 18.0)) * (1.0 - smoothstep(0.2, 1.0, r));
  float halo = exp(-r * r * 6.0);
  float core = exp(-r * r * 40.0);
  float a = (halo * 0.55 + star * 0.8 + core) * uAlpha * (0.9 + 0.1 * sin(uTime * 13.0 + uSeed * 20.0));
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uColor, uCore, clamp(core + star * 0.4, 0.0, 1.0)) * a, a);
}`;

let glowGeo: THREE.PlaneGeometry | null = null;
let glowTemplate: THREE.ShaderMaterial | null = null;

export type FrostGlow = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

/** 朝镜头的十字星光点：直径 1（按 scale 放大），uAlpha 控制亮度。材质归调用方释放 */
export function createFrostGlow(color = FROST.beam, core = FROST.core): FrostGlow {
  if (!glowGeo) glowGeo = new THREE.PlaneGeometry(1, 1);
  if (!glowTemplate) {
    glowTemplate = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
      uniforms: {
        uAlpha: { value: 0 }, uTime: FROST_FX_TIME, uSeed: { value: 0 },
        uColor: { value: new THREE.Color(color) }, uCore: { value: new THREE.Color(core) },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
  }
  const mat = glowTemplate.clone();
  // 时钟共享（clone 会复制 uniform 对象，这里接回同一个）
  mat.uniforms.uTime = FROST_FX_TIME;
  mat.uniforms.uSeed.value = Math.random();
  (mat.uniforms.uColor.value as THREE.Color).setHex(color);
  (mat.uniforms.uCore.value as THREE.Color).setHex(core);
  const m = new THREE.Mesh(glowGeo, mat) as FrostGlow;
  m.frustumCulled = false;
  m.renderOrder = 5;
  m.castShadow = false;
  return m;
}

// ───────────── 几何小工具 ─────────────

/** 线段 ab 到线段 cd 最近距离的平方 */
function segSegDistSq(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): number {
  const d1 = _a.subVectors(b, a), d2 = _b.subVectors(d, c), r = _c.subVectors(a, c);
  const aa = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (aa <= 1e-8 && e <= 1e-8) return r.lengthSq();
  if (aa <= 1e-8) t = clamp01(f / e);
  else {
    const cc = d1.dot(r);
    if (e <= 1e-8) s = clamp01(-cc / aa);
    else {
      const bb = d1.dot(d2), den = aa * e - bb * bb;
      s = den > 1e-8 ? clamp01((bb * f - cc * e) / den) : 0;
      t = (bb * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-cc / aa); } else if (t > 1) { t = 1; s = clamp01((bb - cc) / aa); }
    }
  }
  const px = a.x + d1.x * s - (c.x + d2.x * t), py = a.y + d1.y * s - (c.y + d2.y * t), pz = a.z + d1.z * s - (c.z + d2.z * t);
  return px * px + py * py + pz * pz;
}

/** 带半径的线段是否碰到玩家胶囊 */
export function segmentHitsPlayer(ctx: GameContext, a: THREE.Vector3, b: THREE.Vector3, radius: number): boolean {
  const p = ctx.player;
  if (!p.alive) return false;
  const pr = p.radius;
  const lo = new THREE.Vector3(p.position.x, p.position.y + pr, p.position.z);
  const hi = new THREE.Vector3(p.position.x, p.position.y + Math.max(pr, p.height - pr), p.position.z);
  const r = radius + pr;
  return segSegDistSq(a, b, lo, hi) <= r * r;
}

/** 地面高度（找不到时用 fallback） */
function groundAt(ctx: GameContext, x: number, z: number, fromY: number, fallback: number): number {
  const gy = ctx.world.groundHeight(x, z, fromY);
  return Number.isFinite(gy) && gy > fromY - 6 ? gy : fallback;
}

// ───────────── 直线冰光 ─────────────

export interface IceBeamSpec {
  from: THREE.Vector3;
  /** 单位方向 */
  dir: THREE.Vector3;
  range: number;
  /** 光束判定半径（米） */
  radius: number;
  damage: number;
  source: IEnemy | null;
  /** 冻地：从 stripFrom（地面点，通常是施放者脚下前方）沿光束的地面投影铺到终点 */
  strip?: { from: THREE.Vector3; halfWidth: number; duration: number } | null;
  /** 视觉粗细倍率（精英） */
  scale?: number;
}

export interface IceBeamResult {
  end: THREE.Vector3;
  /** 光束被掩体 / 地面挡住（没有射满射程） */
  blocked: boolean;
  hitPlayer: boolean;
}

const BEAM_FADE = 0.42;

/** 射出一道直线冰光：被掩体挡住的终点、玩家判定、光束与冰屑、冻地 */
export function castIceBeam(ctx: GameContext, s: IceBeamSpec): IceBeamResult {
  const from = s.from.clone();
  const dir = s.dir.clone().normalize();
  const hit = ctx.world.raycast(from, dir, s.range);
  const dist = hit ? hit.distance : s.range;
  const end = from.clone().addScaledVector(dir, dist);
  const hitPlayer = segmentHitsPlayer(ctx, from, end, s.radius);
  if (hitPlayer) {
    ctx.combat.damagePlayer(s.damage, 'none', s.source, from);
    // 小推力（< 3 米/秒，不触发击退硬直）：被冰光冲得一晃
    ctx.player.applyImpulse(_d.set(dir.x * 2.6, 0, dir.z * 2.6));
  }
  const k = s.scale ?? 1;
  // 光束：亮芯 + 外晕，0.42 秒内变细淡出；沿途撒冰屑
  const beam = BeamMesh.acquire(ctx.stageGroup, FROST.beam, FROST.core);
  beam.set(from, end, 0.32 * k);
  let t = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    const u = clamp01(t / BEAM_FADE);
    beam.setOpacity(1 - u * u);
    beam.flicker(0.85 + 0.15 * Math.sin(t * 60));
    beam.set(from, end, 0.32 * k * (1 + 0.6 * Math.exp(-t * 18)) * (1 - 0.6 * u));
    if (u >= 1) {
      beam.release();
      return true;
    }
    return false;
  });
  const n = Math.min(24, Math.max(2, Math.floor(dist / 1.2)));
  for (let i = 1; i <= n; i++) {
    _c.copy(from).addScaledVector(dir, (dist * i) / (n + 1));
    ctx.fx.burst(_c, i % 3 === 0 ? FROST.core : FROST.spark, 2, 1.4, 0.45, 0.07 * k, -1.5);
  }
  ctx.fx.burst(end, FROST.shard, 14, 5, 0.6, 0.12 * k, 9);
  ctx.fx.burst(end, FROST.mist, 6, 1.6, 0.8, 0.35 * k, -0.5);
  ctx.fx.burst(from, FROST.core, 8, 2.2, 0.3, 0.12 * k, 0);
  ctx.audio.play('shot_beam', { position: from, volume: 0.9, pitch: 1.35 });
  if (s.strip) {
    const g0 = s.strip.from;
    const gy = groundAt(ctx, end.x, end.z, end.y + 0.5, g0.y);
    // 冻地只铺在和起点差不多高的地面上（打到高台侧面时铺到台脚为止）
    _d.set(end.x, Math.abs(gy - g0.y) < 0.8 ? gy : g0.y, end.z);
    spawnFrozenStrip(ctx, g0, _d, s.strip.halfWidth * k, s.strip.duration);
  }
  return { end, blocked: !!hit, hitPlayer };
}

// ───────────── 冻地 ─────────────

const STRIP_VERT = /* glsl */ `
varying vec2 vP;
uniform vec2 uSize;
void main() {
  // 平面 x ∈ [-0.5, 0.5] → 横向 ±1.35 个半宽（留出噪声边缘），y → 沿冰面 0..长度；局部 +Z 为冰面方向
  vP = vec2(position.x * 2.7 * uSize.x, (position.y + 0.5) * uSize.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vP.x, 0.0, vP.y, 1.0);
}`;
const STRIP_FRAG = /* glsl */ `
uniform float uTime; uniform float uOpacity; uniform float uGrow; uniform vec2 uSize; uniform vec3 uColor;
varying vec2 vP;
${NOISE}
void main() {
  float hw = uSize.x;
  float edgeN = frNoise(vec3(vP.y * 1.3, 0.0, 3.0)) * 0.35;
  float side = 1.0 - smoothstep(hw * (0.7 + edgeN), hw * (1.0 + edgeN), abs(vP.x));
  float ends = smoothstep(0.0, 0.6, vP.y) * (1.0 - smoothstep(uSize.y - 0.6, uSize.y, vP.y));
  float grown = 1.0 - smoothstep(uGrow - 1.5, uGrow, vP.y);
  float m = side * ends * grown;
  if (m < 0.01) discard;
  float crack = abs(frNoise(vec3(vP * 2.2, 1.0)) - 0.5);
  crack = 1.0 - smoothstep(0.0, 0.05, crack);
  float sheen = pow(frNoise(vec3(vP * 0.7 + vec2(uTime * 0.4, 0.0), 2.0)), 3.0);
  float sparkle = step(0.985, frHash(vec3(floor(vP * 9.0), floor(uTime * 6.0))));
  vec3 col = mix(uColor * 0.8, vec3(0.95, 1.0, 1.0), 0.35 + 0.4 * sheen) + crack * 0.25 + sparkle * 0.8;
  gl_FragColor = vec4(col, m * uOpacity * (0.55 + 0.25 * crack + 0.2 * sheen));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

let stripGeo: THREE.PlaneGeometry | null = null;
let stripTemplate: THREE.ShaderMaterial | null = null;
let crystalGeo: THREE.BufferGeometry | null = null;
let crystalMat: THREE.MeshStandardMaterial | null = null;

function iceCrystalAssets(): { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial } {
  if (!crystalGeo) {
    // 底面在原点、高 1 的五棱冰锥
    crystalGeo = new THREE.ConeGeometry(0.5, 1, 5, 1);
    crystalGeo.translate(0, 0.5, 0);
  }
  if (!crystalMat) {
    crystalMat = new THREE.MeshStandardMaterial({
      color: 0xd2f4ff, emissive: 0x2a8cc8, emissiveIntensity: 0.55, roughness: 0.18, metalness: 0.05,
      transparent: true, opacity: 0.9, flatShading: true,
    });
  }
  return { geo: crystalGeo, mat: crystalMat };
}

/** 玩家冰面打滑的跨帧状态（多条冻地重叠时只结算一次） */
const slip = { frame: -10, vx: 0, vz: 0 };
/** 冰面上加速度只剩这么多（其余被抵消 = 打滑） */
const ICE_TRACTION = 0.1;
/** 冰面上的滑行阻力（每秒衰减率） */
const ICE_DRAG = 0.6;

/** 是否正在打滑（测试与 UI 提示用） */
export function playerOnIce(ctx: GameContext): boolean {
  return slip.frame >= ctx.time.frame - 1;
}

/**
 * 冰光扫过的冻地：a → b（地面点）一条半宽 halfWidth 的冰面，duration 秒后化掉。
 * 冰面沿光束方向在 0.25 秒内「冻过去」；踩上去打滑（见 ICE_TRACTION）。
 */
export function spawnFrozenStrip(ctx: GameContext, a: THREE.Vector3, b: THREE.Vector3, halfWidth: number, duration: number): void {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 0.5) return;
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  if (!stripGeo) stripGeo = new THREE.PlaneGeometry(1, 1);
  if (!stripTemplate) {
    stripTemplate = new THREE.ShaderMaterial({
      vertexShader: STRIP_VERT, fragmentShader: STRIP_FRAG,
      uniforms: {
        uTime: FROST_FX_TIME, uOpacity: { value: 0 }, uGrow: { value: 0 },
        uSize: { value: new THREE.Vector2(1, 1) }, uColor: { value: new THREE.Color(FROST.strip) },
      },
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
  }
  const mat = stripTemplate.clone();
  mat.uniforms.uTime = FROST_FX_TIME;
  (mat.uniforms.uSize.value as THREE.Vector2).set(halfWidth, len);
  const sheet = new THREE.Mesh(stripGeo, mat);
  sheet.frustumCulled = false;
  sheet.renderOrder = 2;
  const y = (a.y + b.y) / 2;
  sheet.position.set(a.x, y + 0.03, a.z);
  sheet.rotation.set(0, yaw, 0);
  ctx.stageGroup.add(sheet);

  // 冰面两侧冒出的冰晶碎片（贴地小冰锥），化冰时缩回地里
  const { geo, mat: cmat } = iceCrystalAssets();
  const shards = new THREE.Group();
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const count = Math.min(14, Math.max(3, Math.floor(len / 1.6)));
  for (let i = 0; i < count; i++) {
    const along = (i + 0.5 + (Math.random() - 0.5) * 0.6) / count * len;
    const side = (Math.random() < 0.5 ? -1 : 1) * halfWidth * (0.55 + Math.random() * 0.45);
    const m = new THREE.Mesh(geo, cmat);
    m.position.set(a.x + fx * along + fz * side, y, a.z + fz * along - fx * side);
    const h = 0.18 + Math.random() * 0.3;
    m.scale.set(h * 0.45, h, h * 0.45);
    m.rotation.set((Math.random() - 0.5) * 0.9, Math.random() * Math.PI, (Math.random() - 0.5) * 0.9);
    m.castShadow = false;
    m.userData.h = h;
    m.userData.along = along;
    shards.add(m);
  }
  ctx.stageGroup.add(shards);
  ctx.audio.play('land', { position: b, volume: 0.35, pitch: 1.8 });

  let t = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    const grow = Math.min(1, t / 0.25) * (len + 1.5);
    mat.uniforms.uGrow.value = grow;
    const fade = t < duration - 0.6 ? 1 : Math.max(0, (duration - t) / 0.6);
    mat.uniforms.uOpacity.value = Math.min(1, t / 0.08) * fade;
    for (const c of shards.children) {
      const show = grow >= (c.userData.along as number) ? 1 : 0;
      const hh = (c.userData.h as number) * Math.max(0.02, show * fade);
      c.scale.set(hh * 0.45, hh, hh * 0.45);
    }
    if (t < duration) slipPlayer(ctx, a, yaw, Math.min(grow, len), halfWidth, y, dt);
    if (t >= duration) {
      sheet.removeFromParent();
      shards.removeFromParent();
      mat.dispose();
      return true;
    }
    return false;
  });
}

/** 玩家站在冻地上：抵消这一帧大部分的速度变化（加速和刹车都变得很慢），保留滑行速度 */
function slipPlayer(ctx: GameContext, a: THREE.Vector3, yaw: number, len: number, hw: number, y: number, dt: number): void {
  const p = ctx.player;
  if (!p.alive || !p.onGround || p.isDashing || p.isLunging) return;
  if (Math.abs(p.position.y - y) > 0.6) return;
  const dx = p.position.x - a.x, dz = p.position.z - a.z;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const along = dx * fx + dz * fz;
  const side = dx * fz - dz * fx;
  if (along < 0 || along > len || Math.abs(side) > hw + p.radius * 0.5) return;
  const frame = ctx.time.frame;
  if (slip.frame === frame) return;
  const v = p.velocity;
  if (slip.frame < frame - 1) {
    // 刚踩上冰面：从当前速度开始滑
    slip.vx = v.x;
    slip.vz = v.z;
  } else {
    const drag = Math.exp(-ICE_DRAG * dt);
    const bx = slip.vx * drag, bz = slip.vz * drag;
    // 玩家这一帧想要的变化只保留 ICE_TRACTION
    let ix = (v.x - bx) * (ICE_TRACTION - 1);
    let iz = (v.z - bz) * (ICE_TRACTION - 1);
    // 单帧冲量 < 3 米/秒（不触发击退硬直）
    const m = Math.hypot(ix, iz);
    if (m > 2.8) {
      ix *= 2.8 / m;
      iz *= 2.8 / m;
    }
    if (m > 1e-4) p.applyImpulse(_d.set(ix, 0, iz));
    slip.vx = v.x;
    slip.vz = v.z;
  }
  slip.frame = frame;
}

// ───────────── 冰棱阵 ─────────────

export interface SpikeFieldSpec {
  center: THREE.Vector3;
  /** 冰棱分布半径（米）；碰撞盒为内接方形 */
  radius: number;
  duration: number;
  /** 冰锥高度（米） */
  height: number;
}

/** 当前活动的冰棱阵（测试 / 调试用） */
export const activeSpikeFields: { center: THREE.Vector3; box: unknown | null; ended: boolean; until: number }[] = [];

/**
 * 冰棱阵：一簇冰锥长出来，持续 duration 秒阻挡移动（临时碰撞盒，不挡子弹和视线），然后缩回地里碎掉。
 * 碰撞盒在落点上没有玩家 / 敌人时才加入（玩家被砸中会被推开，走出去之后冰棱阵才「封死」）。
 */
export function spawnSpikeField(ctx: GameContext, s: SpikeFieldSpec): void {
  const { geo, mat } = iceCrystalAssets();
  const g = new THREE.Group();
  const c = s.center.clone();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat);
    const main = i === 0;
    const a = (i / (n - 1)) * Math.PI * 2 + Math.random() * 0.5;
    const rr = main ? 0 : s.radius * (0.35 + 0.55 * Math.random());
    m.position.set(Math.sin(a) * rr, -0.05, Math.cos(a) * rr);
    const h = s.height * (main ? 1 : 0.5 + Math.random() * 0.4);
    const w = h * (main ? 0.38 : 0.32);
    m.scale.set(w, h, w);
    // 外圈的冰锥向外斜
    m.rotation.set(main ? 0 : Math.cos(a) * 0.35, Math.random() * Math.PI, main ? 0 : -Math.sin(a) * 0.35);
    m.castShadow = main;
    g.add(m);
  }
  g.position.copy(c);
  g.scale.set(1, 0.01, 1);
  ctx.stageGroup.add(g);
  // 换关时任务被清掉、记录不会自己移除：顺手清理早已过期的记录
  for (let i = activeSpikeFields.length - 1; i >= 0; i--) {
    if (ctx.time.now > activeSpikeFields[i].until + 2) activeSpikeFields.splice(i, 1);
  }
  const rec = { center: c, box: null as unknown, ended: false, until: ctx.time.now + s.duration + 0.5 };
  activeSpikeFields.push(rec);
  const half = s.radius * 0.75;
  const boxH = Math.max(2.4, s.height + 0.3);
  let t = 0;
  let box: ReturnType<GameContext['world']['addFromBottom']> | null = null;
  ctx.tasks.add((dt) => {
    t += dt;
    if (t < 0.22) g.scale.y = Math.max(0.01, (t / 0.22) * (1.15 - 0.15 * (t / 0.22)));
    else if (t < s.duration) g.scale.y = 1;
    const live = t >= 0.12 && t < s.duration;
    if (live && !box && fieldClear(ctx, c, half)) {
      box = ctx.world.addFromBottom(c.x, c.y - 0.1, c.z, half * 2, boxH, half * 2, 'ice_spikes', true);
      rec.box = box;
    }
    if (t >= s.duration && box) {
      ctx.world.remove(box);
      box = null;
      rec.box = null;
      _a.set(c.x, c.y + 0.6, c.z);
      ctx.fx.burst(_a, FROST.shard, 16, 4.5, 0.7, 0.14, 12);
      ctx.audio.play('hit_armor', { position: _a, volume: 0.45, pitch: 1.6 });
    }
    if (t >= s.duration) {
      // 碎裂下沉
      const u = clamp01((t - s.duration) / 0.4);
      g.position.y = c.y - u * s.height;
      if (u >= 1) {
        g.removeFromParent();
        rec.ended = true;
        const i = activeSpikeFields.indexOf(rec);
        if (i >= 0) activeSpikeFields.splice(i, 1);
        return true;
      }
    }
    return false;
  });
}

/** 方形区域里没有玩家 / 活着的敌人（含半径余量） */
function fieldClear(ctx: GameContext, c: THREE.Vector3, half: number): boolean {
  const p = ctx.player;
  const pr = p.radius + 0.05;
  if (Math.abs(p.position.x - c.x) < half + pr && Math.abs(p.position.z - c.z) < half + pr && p.position.y < c.y + 2.6) return false;
  for (const e of ctx.enemies.queryRadius(c, half * 1.5 + 2)) {
    const r = e.radius * 0.85 + 0.05;
    if (Math.abs(e.position.x - c.x) < half + r && Math.abs(e.position.z - c.z) < half + r && e.position.y < c.y + 2.6) return false;
  }
  return true;
}

// ───────────── 冰柱雨 ─────────────

export interface PillarVolleySpec {
  /** 喷出点（喷气孔） */
  from: THREE.Vector3;
  /** 落点（地面点）与各自的落地时间（从现在起，秒） */
  targets: readonly THREE.Vector3[];
  times: readonly number[];
  /** 砸中半径、伤害（已乘 damageMult） */
  radius: number;
  damage: number;
  source: IEnemy | null;
  field: { radius: number; duration: number; height: number };
  scale?: number;
}

/** 冰柱下落的最后一段时长（秒）：从高空出现到砸地 */
const PILLAR_FALL = 0.42;
const PILLAR_DROP_HEIGHT = 15;
/** 喷上天的冰柱飞多久后消失在高处；上升初速（米/秒，逐根加快）、大小 */
const PILLAR_RISE = 0.95;
const PILLAR_RISE_SPEED = 15;
const PILLAR_RISE_SCALE = 1.05;
/** 喷气柱：高度（米，乘 scale）、顶部半径、冲到顶的时间、总时长 */
const PLUME_HEIGHT = 9;
const PLUME_RADIUS = 0.8;
const PLUME_SHOOT = 0.18;
const PLUME_HOLD = 0.75;
const PLUME_TIME = 1.5;

let pillarGeo: THREE.BufferGeometry | null = null;
let pillarGlowMat: THREE.MeshBasicMaterial | null = null;

function pillarMesh(scale: number): THREE.Mesh {
  if (!pillarGeo) {
    // 六棱冰柱：中段粗、两头尖（全长约 2.2，中心在原点，尖头朝 +Y）
    const parts = [
      new THREE.CylinderGeometry(0.0, 0.32, 0.7, 6, 1, false).translate(0, 0.9, 0),
      new THREE.CylinderGeometry(0.32, 0.26, 1.1, 6, 1, false),
      new THREE.CylinderGeometry(0.26, 0.0, 0.4, 6, 1, false).translate(0, -0.75, 0),
    ];
    const pos: number[] = [];
    for (const p of parts) {
      const flat = p.toNonIndexed();
      pos.push(...(flat.getAttribute('position').array as Float32Array));
      flat.dispose();
      p.dispose();
    }
    pillarGeo = new THREE.BufferGeometry();
    pillarGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    pillarGeo.computeVertexNormals();
  }
  const { mat } = iceCrystalAssets();
  const m = new THREE.Mesh(pillarGeo, mat);
  m.scale.setScalar(scale);
  m.castShadow = true;
  // 外面套一层加法发光壳：暗背景里冰柱是一道亮青的光
  pillarGlowMat ??= new THREE.MeshBasicMaterial({
    color: FROST.beam, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const glow = new THREE.Mesh(pillarGeo, pillarGlowMat);
  glow.scale.set(1.45, 1.15, 1.45);
  glow.castShadow = false;
  glow.renderOrder = 4;
  m.add(glow);
  return m;
}

// ───────────── 喷气柱 ─────────────

const PLUME_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFres;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vFres = 1.0 - abs(dot(n, normalize(cameraPosition - wp.xyz)));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const PLUME_FRAG = /* glsl */ `
uniform float uAlpha; uniform float uTime; uniform vec3 uColor; uniform vec3 uCore;
varying vec2 vUv;
varying float vFres;
void main() {
  float h = vUv.y;
  // 往上冲的水汽条纹
  float streak = 0.5 + 0.5 * sin(vUv.x * 43.98 + h * 3.0) * sin(h * 16.0 - uTime * 26.0 + vUv.x * 18.85);
  float top = 1.0 - smoothstep(0.55, 1.0, h);
  float base = smoothstep(0.0, 0.05, h);
  float a = uAlpha * top * base * (0.4 + 0.4 * streak) * (0.6 + 0.4 * vFres);
  if (a < 0.004) discard;
  // 轮廓是饱和青（亮背景上看得出来），中心近白
  vec3 col = mix(uCore, uColor, clamp(vFres * 0.9 + (1.0 - streak) * 0.25, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

let plumeGeo: THREE.CylinderGeometry | null = null;
let plumeTemplate: THREE.ShaderMaterial | null = null;

/**
 * 喷气柱：从喷气孔猛地冲起一道约 9 米高、上粗下细的冰雾水柱（0.18 秒冲到顶），撑到 0.75 秒后变宽、淡掉（共 1.5 秒）。
 * 普通混合 + 不走色调映射：外沿饱和青、中心近白，亮的雪地 / 天空和暗的极夜背景上都读得出来。
 */
export function spoutPlume(ctx: GameContext, from: THREE.Vector3, scale = 1): void {
  if (!plumeGeo) {
    plumeGeo = new THREE.CylinderGeometry(1, 0.32, 1, 14, 1, true);
    plumeGeo.translate(0, 0.5, 0);
  }
  plumeTemplate ??= new THREE.ShaderMaterial({
    vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG,
    uniforms: {
      uAlpha: { value: 0 }, uTime: { value: 0 },
      uColor: { value: new THREE.Color(FROST.plume) }, uCore: { value: new THREE.Color(FROST.plumeCore) },
    },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const mat = plumeTemplate.clone();
  const mesh = new THREE.Mesh(plumeGeo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.castShadow = false;
  const base = from.clone();
  mesh.position.copy(base);
  mesh.scale.set(0.01, 0.01, 0.01);
  ctx.stageGroup.add(mesh);
  const H = PLUME_HEIGHT * scale, R0 = PLUME_RADIUS * scale;
  let t = 0, puff = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    puff += dt;
    const u = clamp01(t / PLUME_SHOOT);
    const grow = 1 - (1 - u) * (1 - u);
    const late = clamp01((t - PLUME_HOLD) / (PLUME_TIME - PLUME_HOLD));
    const h = H * (grow + 0.15 * late);
    const r = R0 * (0.6 + 0.4 * grow + 0.5 * late);
    mesh.scale.set(r, Math.max(0.01, h), r);
    mat.uniforms.uTime.value = t;
    mat.uniforms.uAlpha.value = (0.35 + 0.65 * u) * (1 - late);
    // 顶上不断喷开的水雾、冰屑
    if (puff > 0.06 && t < PLUME_HOLD + 0.1) {
      puff = 0;
      _d.set(base.x, base.y + h * 0.9, base.z);
      ctx.fx.burst(_d, FROST.mist, 3, 2.5, 0.8, 0.45 * scale, -1);
      ctx.fx.burst(_d, FROST.spark, 2, 4, 0.5, 0.14 * scale, 6);
    }
    if (t >= PLUME_TIME) {
      mesh.removeFromParent();
      mat.dispose();
      return true;
    }
    return false;
  });
}

/**
 * 冰柱雨：从喷气孔喷出 N 根冰柱冲上天（视觉），各落点立刻亮出预警圈，按 times 依次从高空砸下：
 * 砸中半径内的玩家（水平距离 + 高度差，头顶来的，掩体不挡），然后长出冰棱阵。
 */
export function launchIcePillars(ctx: GameContext, s: PillarVolleySpec): void {
  const k = s.scale ?? 1;
  const from = s.from.clone();
  // 喷气柱：一眼就看得出「它喷了」
  spoutPlume(ctx, from, k);
  // 上升段：冰柱带着冰屑冲上天（够慢、够大，14 米外抬眼就能看到它们升上去）
  const risers = s.targets.map((tgt, i) => {
    const m = pillarMesh(PILLAR_RISE_SCALE * k);
    m.position.copy(from);
    ctx.stageGroup.add(m);
    const dx = tgt.x - from.x, dz = tgt.z - from.z, d = Math.hypot(dx, dz) || 1;
    // 略微朝落点方向斜着喷出
    return { m, vx: (dx / d) * 2.2, vz: (dz / d) * 2.2, vy: PILLAR_RISE_SPEED + i * 1.2, spin: (Math.random() - 0.5) * 6 };
  });
  let rt = 0, trail = 0;
  ctx.tasks.add((dt) => {
    rt += dt;
    trail += dt;
    const puff = trail > 0.05;
    if (puff) trail = 0;
    for (const r of risers) {
      r.m.position.x += r.vx * dt;
      r.m.position.z += r.vz * dt;
      r.m.position.y += r.vy * dt;
      r.m.rotation.y += r.spin * dt;
      r.m.rotation.z = Math.atan2(-r.vx, r.vy);
      if (puff) ctx.fx.burst(r.m.position, FROST.spark, 1, 0.6, 0.4, 0.12 * k, -1);
    }
    if (rt >= PILLAR_RISE) {
      for (const r of risers) {
        ctx.fx.burst(r.m.position, FROST.mist, 3, 1.5, 0.5, 0.3 * k, 0);
        r.m.removeFromParent();
      }
      return true;
    }
    return false;
  });
  ctx.fx.burst(from, FROST.mist, 18, 6, 0.9, 0.35 * k, -2);
  ctx.fx.burst(from, FROST.shard, 22, 9, 0.8, 0.1 * k, 12);

  s.targets.forEach((tgt, i) => {
    const target = tgt.clone();
    const T = Math.max(PILLAR_FALL + 0.1, s.times[i] ?? 1.4);
    // 预警圈：饱和电光蓝（普通混合的地面预警，浅青色在浅色冰面上看不出来）
    ctx.fx.groundWarning(target, s.radius, T, FROST.warnSolid);
    ctx.tasks.delay(T - PILLAR_FALL, () => {
      const m = pillarMesh(1.15 * k);
      m.rotation.set(Math.PI, Math.random() * Math.PI, 0);
      m.position.set(target.x, target.y + PILLAR_DROP_HEIGHT, target.z);
      ctx.stageGroup.add(m);
      let ft = 0;
      ctx.tasks.add((dt) => {
        ft += dt;
        const u = clamp01(ft / PILLAR_FALL);
        m.position.y = target.y + PILLAR_DROP_HEIGHT * (1 - u * u) + 1.1 * k;
        if (ft % 0.06 < dt) ctx.fx.burst(m.position, FROST.spark, 1, 0.5, 0.3, 0.14 * k, 2);
        if (u >= 1) {
          m.removeFromParent();
          pillarImpact(ctx, target, s, k);
          return true;
        }
        return false;
      });
    });
  });
}

function pillarImpact(ctx: GameContext, c: THREE.Vector3, s: PillarVolleySpec, k: number): void {
  const p = ctx.player;
  const dx = p.position.x - c.x, dz = p.position.z - c.z;
  const d = Math.hypot(dx, dz);
  const dy = p.position.y - c.y;
  if (p.alive && d <= s.radius + p.radius * 0.5 && dy > -0.8 && dy < 3.2) {
    const kk = 1 - 0.4 * clamp01(d / s.radius);
    ctx.combat.damagePlayer(s.damage * kk, 'none', s.source, _a.set(c.x, c.y + 0.5, c.z));
    // 推出落点（冰棱阵随后封住这里）
    const inv = d > 0.05 ? 1 / d : 0;
    const dirx = d > 0.05 ? dx * inv : 1, dirz = d > 0.05 ? dz * inv : 0;
    p.applyImpulse(_b.set(dirx * 6.5, 3.2, dirz * 6.5));
  }
  _a.set(c.x, c.y + 0.4, c.z);
  ctx.fx.burst(_a, FROST.shard, 20, 7, 0.8, 0.13 * k, 16);
  ctx.fx.burst(_a, FROST.mist, 8, 2.5, 0.9, 0.45 * k, -0.8);
  ctx.fx.ring(_b.set(c.x, c.y + 0.05, c.z), s.radius * 1.2, FROST.ice, 0.45);
  const dist = Math.hypot(p.position.x - c.x, p.position.z - c.z);
  if (dist < 22) ctx.fx.shake(0.05 + 0.25 * (1 - dist / 22), 0.25);
  ctx.audio.play('boss_slam', { position: _a, volume: 0.55, pitch: 1.35 });
  spawnSpikeField(ctx, { center: c, radius: s.field.radius * k, duration: s.field.duration, height: s.field.height * k });
}

// ───────────── 冰冲击波 ─────────────

export interface IceWaveSpec {
  center: THREE.Vector3;
  maxRadius: number;
  speed: number;
  damage: number;
  source: IEnemy | null;
  /** 玩家脚底离地高于这么多就躲过（跳起） */
  jumpClear?: number;
  knockback?: number;
}

let waveGeo: THREE.RingGeometry | null = null;
let waveTemplate: THREE.MeshBasicMaterial | null = null;

/** 贴地扩散的冰冲击波环：环经过玩家时（贴地、没被掩体挡住）伤害一次并向外击退 */
export function spawnIceShockwave(ctx: GameContext, s: IceWaveSpec): void {
  if (!waveGeo) {
    waveGeo = new THREE.RingGeometry(0.82, 1, 48, 1);
    waveGeo.rotateX(-Math.PI / 2);
  }
  if (!waveTemplate) {
    waveTemplate = new THREE.MeshBasicMaterial({
      color: FROST.ice, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
  }
  const mat = waveTemplate.clone();
  const ring = new THREE.Mesh(waveGeo, mat);
  const c = s.center.clone();
  ring.position.set(c.x, c.y + 0.06, c.z);
  ring.frustumCulled = false;
  ctx.stageGroup.add(ring);
  const clear = s.jumpClear ?? 0.6;
  const knock = s.knockback ?? 8;
  let r = 0.6, hit = false, dustAcc = 0;
  ctx.tasks.add((dt) => {
    const prev = r;
    r += s.speed * dt;
    ring.scale.setScalar(r);
    mat.opacity = 0.85 * (1 - clamp01((r - s.maxRadius * 0.6) / (s.maxRadius * 0.4)));
    dustAcc += dt;
    if (dustAcc > 0.05) {
      dustAcc = 0;
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        _a.set(c.x + Math.sin(a) * r, c.y + 0.15, c.z + Math.cos(a) * r);
        ctx.fx.burst(_a, Math.random() < 0.5 ? FROST.shard : FROST.snow, 1, 1.6, 0.45, 0.12, 6);
      }
    }
    const p = ctx.player;
    // damage <= 0：只有视觉（玩家刚被同一招的爆心重击命中，不再吃第二段）
    if (!hit && p.alive && s.damage > 0) {
      const d = Math.hypot(p.position.x - c.x, p.position.z - c.z);
      if (d + p.radius >= prev && d - p.radius <= r + 0.4 && p.position.y - c.y < clear && p.position.y - c.y > -1) {
        _a.set(c.x, c.y + 0.5, c.z);
        _b.set(p.position.x, p.position.y + 0.5, p.position.z);
        if (!ctx.world.segmentBlocked(_a, _b)) {
          hit = true;
          ctx.combat.damagePlayer(s.damage, 'none', s.source, _a);
          const inv = d > 0.05 ? 1 / d : 0;
          p.applyImpulse(_c.set((p.position.x - c.x) * inv * knock, 3.5, (p.position.z - c.z) * inv * knock));
        }
      }
    }
    if (r >= s.maxRadius) {
      ring.removeFromParent();
      mat.dispose();
      return true;
    }
    return false;
  });
}
