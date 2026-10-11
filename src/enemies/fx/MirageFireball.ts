/**
 * 蜃楼蟾的「蜃火珠」（设计见 docs/art/enemy-roster-v2.md）：自带弹道、碰撞、伤害与特效的抛物线火珠。
 *
 * - 真火珠：白金核心 + 翻卷的橙红火焰壳 + 热光晕，身后拖火焰尾迹、掉余烬、冒淡烟；落点有金色预警圈（随飞行进度填满）。
 *   落地：白闪、火焰蘑菇、冲击环、沙尘、余烬、按距离震屏；留下 2.6 秒的「炽沙」余火（小范围持续火伤）。
 * - 幻影火珠（分身吐的）：同形但半透明、偏冷白，没有光晕和尾焰、没有预警圈、不伤人，飞到一半碎成热浪消散。
 *
 * 只用 ctx.fx 的公共接口和自己的网格；逐帧更新挂在 ctx.tasks 上（发射者死后火珠照样飞完）。
 * 几何体与材质模块级缓存、实例走对象池，从不释放（避免着色器反复编译）。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../../core/types';
import { blastPlayer, zonePlayer } from '../Hazards';
import { GroundDecal } from '../bosses/Visuals';

export interface MirageFireballSpec {
  from: THREE.Vector3;
  velocity: THREE.Vector3;
  gravity: number;
  /** 预计飞行时间（秒）：预警圈按它填满 */
  flightTime: number;
  /** 预计落点（地面） */
  target: THREE.Vector3;
  /** 爆炸半径（米） */
  radius: number;
  /** 已乘过伤害倍率的直接伤害 */
  damage: number;
  source: IEnemy | null;
  /** 幻影火珠：不伤人、没有预警、飞到一半消散 */
  illusion?: boolean;
  /** 视觉缩放（精英 1.25） */
  scale?: number;
}

const ORB_RADIUS = 0.44;
const BURN_RADIUS = 1.9;
const BURN_TIME = 2.6;
const BURN_TICK = 0.5;
/** 余火每跳伤害 = 直接伤害 × 该比例 */
const BURN_RATIO = 0.12;
const ILLUSION_FADE_AT = 0.55;

const COLOR = {
  core: 0xfff3c4, flame: 0xff8a2a, ember: 0xff6a1a, trail: 0xffb040, smoke: 0x5a4636,
  sand: 0xc8a06a, warn: 0xffb030, burn: 0xff7a20, flash: 0xffd27a, illusion: 0xd8f0ff,
};

// ───────────── 着色器 ─────────────

const NOISE = /* glsl */ `
float hash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 51.3))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return 0.55 * noise(p) + 0.3 * noise(p * 2.1) + 0.15 * noise(p * 4.3); }
`;

/** 核心：白金内芯，边缘转橙，表面缓慢流动的熔流纹 */
const CORE_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const CORE_FRAG = /* glsl */ `
uniform float uTime; uniform vec3 uHot; uniform vec3 uRim; uniform float uAlpha;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
${NOISE}
void main() {
  float fres = pow(1.0 - max(dot(vN, vV), 0.0), 1.6);
  float flow = fbm(vP * 6.0 + vec3(0.0, uTime * 1.8, uTime * 0.7));
  vec3 col = mix(uHot, uRim, clamp(fres * 1.3 + (flow - 0.5) * 0.6, 0.0, 1.0));
  gl_FragColor = vec4(col * (1.6 + flow * 0.8), uAlpha);
}`;

/** 火焰壳：沿法线按噪声外翻的火舌，菲涅尔边缘更亮，加法混合 */
const SHELL_VERT = /* glsl */ `
uniform float uTime;
varying vec3 vN; varying vec3 vV; varying float vLick;
${NOISE}
void main() {
  float lick = fbm(normal * 2.6 + vec3(0.0, -uTime * 3.2, uTime * 1.1));
  vLick = lick;
  vec3 p = position + normal * (lick - 0.35) * 0.55 * length(position);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha;
varying vec3 vN; varying vec3 vV; varying float vLick;
void main() {
  float fres = pow(1.0 - abs(dot(vN, vV)), 1.2);
  float a = clamp(fres * 0.9 + vLick * 0.5 - 0.15, 0.0, 1.0) * uAlpha;
  gl_FragColor = vec4(uColor * (0.8 + vLick), a);
}`;

/** 热光晕：面向镜头的径向渐变（加法） */
const HALO_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; uniform float uTime;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.2) * (0.85 + 0.15 * sin(uTime * 23.0));
  gl_FragColor = vec4(uColor, a * uAlpha);
}`;
const HALO_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

interface OrbMats {
  core: THREE.ShaderMaterial;
  shell: THREE.ShaderMaterial;
  halo: THREE.ShaderMaterial;
}

let geo: { core: THREE.BufferGeometry; shell: THREE.BufferGeometry; halo: THREE.BufferGeometry } | null = null;
const time = { value: 0 };

function makeMats(illusion: boolean): OrbMats {
  const hot = new THREE.Color(illusion ? COLOR.illusion : COLOR.core);
  const rim = new THREE.Color(illusion ? 0x9ec8e8 : COLOR.flame);
  return {
    core: new THREE.ShaderMaterial({
      vertexShader: CORE_VERT, fragmentShader: CORE_FRAG, transparent: illusion, depthWrite: !illusion, toneMapped: false,
      uniforms: { uTime: time, uHot: { value: hot }, uRim: { value: rim }, uAlpha: { value: illusion ? 0.45 : 1 } },
    }),
    shell: new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: time, uColor: { value: new THREE.Color(illusion ? 0x8cc4ff : COLOR.flame) }, uAlpha: { value: illusion ? 0.25 : 0.9 } },
    }),
    halo: new THREE.ShaderMaterial({
      vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: time, uColor: { value: new THREE.Color(COLOR.trail) }, uAlpha: { value: illusion ? 0 : 0.75 } },
    }),
  };
}

/**
 * 单独的火焰壳（火浣鼠滚成火球时裹在身上）：与火珠同一套着色器，各实例有自己的颜色 / 透明度。
 * 网格是半径 1 的球，调用方自己缩放；每帧把 FLAME_TIME.value 设为 ctx.time.now 让火舌翻卷。
 * 材质由调用方持有和释放（着色器程序按源码缓存，不会重复编译）。
 */
export const FLAME_TIME = time;
export function createFlameShell(color: number, alpha: number): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  geo ??= { core: new THREE.IcosahedronGeometry(1, 3), shell: new THREE.IcosahedronGeometry(1, 3), halo: new THREE.PlaneGeometry(1, 1) };
  const mat = new THREE.ShaderMaterial({
    vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: time, uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha } },
  });
  const mesh = new THREE.Mesh(geo.shell, mat);
  mesh.castShadow = false;
  mesh.renderOrder = 2;
  return mesh;
}

let realMats: OrbMats | null = null;
let illusionMats: OrbMats | null = null;
const pool: THREE.Group[] = [];

function acquireOrb(parent: THREE.Object3D, illusion: boolean): THREE.Group {
  geo ??= { core: new THREE.IcosahedronGeometry(1, 3), shell: new THREE.IcosahedronGeometry(1, 3), halo: new THREE.PlaneGeometry(1, 1) };
  const mats = illusion ? (illusionMats ??= makeMats(true)) : (realMats ??= makeMats(false));
  const g = pool.pop() ?? (() => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo!.core), new THREE.Mesh(geo!.shell), new THREE.Mesh(geo!.halo));
    for (const c of group.children) c.frustumCulled = false;
    return group;
  })();
  const [core, shell, halo] = g.children as THREE.Mesh[];
  core.material = mats.core;
  shell.material = mats.shell;
  halo.material = mats.halo;
  core.renderOrder = 1;
  shell.renderOrder = 2;
  halo.renderOrder = 3;
  g.visible = true;
  parent.add(g);
  return g;
}

function releaseOrb(g: THREE.Group): void {
  g.removeFromParent();
  g.visible = false;
  pool.push(g);
}

// ───────────── 发射 ─────────────

const _prev = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _p = new THREE.Vector3();

/** 吐出一颗蜃火珠（真 / 幻影） */
export function launchMirageFireball(ctx: GameContext, spec: MirageFireballSpec): void {
  const illusion = !!spec.illusion;
  const s = spec.scale ?? 1;
  const pos = spec.from.clone();
  const vel = spec.velocity.clone();
  const landing = spec.target.clone();
  const orb = acquireOrb(ctx.stageGroup, illusion);
  const [core, shell, halo] = orb.children as THREE.Mesh[];
  core.scale.setScalar(ORB_RADIUS * 0.72 * s);
  shell.scale.setScalar(ORB_RADIUS * 1.15 * s);
  halo.scale.setScalar(ORB_RADIUS * 4.2 * s);
  orb.position.copy(pos);
  const cancelWarning = illusion ? null : ctx.fx.groundWarning(landing, spec.radius, spec.flightTime, COLOR.warn);
  let age = 0;
  let trailAcc = 0;
  let emberAcc = 0;
  let done = false;

  const finish = (): void => {
    done = true;
    releaseOrb(orb);
  };

  ctx.tasks.add((dt) => {
    if (done) return true;
    age += dt;
    time.value = ctx.time.now;
    _prev.copy(pos);
    vel.y -= spec.gravity * dt;
    pos.addScaledVector(vel, dt);
    orb.position.copy(pos);
    // 火焰壳翻滚、光晕朝向镜头、整体轻微脉动
    shell.rotation.x += dt * 2.1;
    shell.rotation.y += dt * 3.4;
    halo.quaternion.copy(ctx.camera.quaternion);
    const pulse = 1 + 0.08 * Math.sin(age * 26);
    core.scale.setScalar(ORB_RADIUS * 0.72 * s * pulse);

    if (illusion) {
      // 幻影：只有淡淡的冷光尾，飞到一半碎成热浪
      trailAcc += dt;
      if (trailAcc > 0.05) {
        trailAcc = 0;
        ctx.fx.burst(pos, COLOR.illusion, 1, 0.3, 0.3, 0.16 * s, -0.5);
      }
      if (age >= spec.flightTime * ILLUSION_FADE_AT) {
        ctx.fx.burst(pos, COLOR.illusion, 14, 2.4, 0.55, 0.18 * s, -1);
        ctx.fx.burst(pos, 0xfff4dc, 6, 1.2, 0.4, 0.3 * s, -0.5);
        finish();
        return true;
      }
      return false;
    }

    // 尾迹：沿这一帧走过的线段按 0.1 米间距补点，连成一条火焰带（外层橙焰 + 贴近火珠的白热内芯）
    const seg = _prev.distanceTo(pos);
    trailAcc += seg;
    while (trailAcc >= 0.1) {
      trailAcc -= 0.1;
      _p.lerpVectors(_prev, pos, 1 - trailAcc / Math.max(seg, 1e-4));
      ctx.fx.burst(_p, COLOR.trail, 1, 0.25, 0.42, 0.5 * s, -1.2);
      ctx.fx.burst(_p, COLOR.core, 1, 0.1, 0.18, 0.28 * s, 0);
    }
    emberAcc += dt;
    if (emberAcc > 0.09) {
      emberAcc = 0;
      // 只掉余烬：棕灰色会被粒子系统当成大团扬尘，飞行中不冒烟
      ctx.fx.burst(pos, COLOR.ember, 1, 1.4, 0.7, 0.06 * s, 5);
    }

    // 碰撞：玩家（直接命中）、墙体 / 掩体、地面；超时也炸
    const pl = ctx.player;
    _chest.set(pl.position.x, pl.position.y + Math.min(1.1, pl.height * 0.6), pl.position.z);
    let hit: THREE.Vector3 | null = null;
    if (pl.alive && pos.distanceTo(_chest) < pl.radius + ORB_RADIUS * s) hit = pos;
    else if (ctx.world.segmentBlocked(_prev, pos)) hit = _prev;
    else {
      const gy = ctx.world.groundHeight(pos.x, pos.z, pos.y + 1);
      if (Number.isFinite(gy) && pos.y <= gy) {
        _p.set(pos.x, gy, pos.z);
        hit = _p;
      } else if (age > spec.flightTime + 2) hit = pos;
    }
    if (!hit) return false;
    // 半路就炸了（撞上掩体 / 高台边）：撤掉落点预警，免得预警圈填满却没有爆炸
    if (hit.distanceToSquared(landing) > 1.5 * 1.5) cancelWarning?.();
    explode(ctx, hit.clone(), spec, s);
    finish();
    return true;
  });

  // 吐出瞬间：嘴前白金闪光 + 喷溅火星
  if (!illusion) {
    ctx.fx.burst(pos, COLOR.flash, 14, 4.5, 0.3, 0.2 * s, 1);
    ctx.fx.burst(pos, COLOR.ember, 10, 6, 0.5, 0.06 * s, 6);
  } else {
    ctx.fx.burst(pos, COLOR.illusion, 8, 3, 0.3, 0.16 * s, 0);
  }
}

/** 落地爆炸 + 炽沙余火 */
function explode(ctx: GameContext, center: THREE.Vector3, spec: MirageFireballSpec, s: number): void {
  const r = spec.radius;
  const gy = ctx.world.groundHeight(center.x, center.z, center.y + 1);
  const ground = new THREE.Vector3(center.x, Number.isFinite(gy) ? Math.min(gy, center.y) : center.y, center.z);
  // 白闪与爆团（ctx.fx.explosion 自带按距离的震屏）
  ctx.fx.explosion(center, r, 0xffa030);
  ctx.audio.play('explosion', { position: center, volume: 0.9, pitch: 0.85 });
  // 冲击环、火焰蘑菇（上升的火团 + 顶部的烟）、沙尘、余烬
  ctx.fx.ring(ground, r * 1.15, 0xffd080, 0.45);
  _p.copy(ground).setY(ground.y + 0.4);
  ctx.fx.burst(_p, 0xffc050, 16, 2.6, 0.65, 0.55 * s, -7);
  _p.y += 1.2;
  ctx.fx.burst(_p, COLOR.smoke, 3, 0.8, 1.0, 0.35 * s, -1.6);
  ctx.fx.burst(ground, COLOR.sand, 8, 4, 0.6, 0.1 * s, 15);
  ctx.fx.burst(center, COLOR.ember, 22, 5.5, 1.3, 0.06 * s, 4);
  blastPlayer(ctx, center, r, spec.damage, 'fire', spec.source, 0.5, 0.7);

  // 炽沙余火：流动的熔沙贴花，冒火星，每 0.5 秒结算一次小火伤，2.6 秒后熄灭
  const decal = GroundDecal.acquire(ctx.stageGroup, COLOR.burn).circle(ground.x, ground.y, ground.z, BURN_RADIUS * s);
  decal.pattern = 1;
  let t = 0;
  let tick = BURN_TICK;
  let sparks = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    decal.time = t;
    decal.opacity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - Math.max(0, t - (BURN_TIME - 0.8)) / 0.8);
    tick -= dt;
    if (tick <= 0) {
      tick += BURN_TICK;
      zonePlayer(ctx, ground, BURN_RADIUS * s, spec.damage * BURN_RATIO, 'fire', spec.source);
    }
    sparks += dt;
    if (sparks > 0.12 && t < BURN_TIME - 0.4) {
      sparks = 0;
      const a = Math.random() * Math.PI * 2, rr = Math.random() * BURN_RADIUS * s;
      _p.set(ground.x + Math.cos(a) * rr, ground.y + 0.1, ground.z + Math.sin(a) * rr);
      ctx.fx.burst(_p, COLOR.ember, 1, 1.2, 0.6, 0.07, -3);
    }
    if (t >= BURN_TIME) {
      decal.release();
      return true;
    }
    return false;
  });
}
