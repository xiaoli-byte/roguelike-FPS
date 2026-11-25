/**
 * 4-4 神山海子的水面互动：人在浅水里走、跳、冲刺时的涟漪和水花。
 *
 * - 涟漪画在湖面着色器里（scene.ts 的 rippleField，LakeSurface.addRipple 往里写）：一圈圈往外推、扰动倒影，
 *   刚溅起那一下带一圈白沫。走路每一步左右脚各起一圈，身后拖一串（尾迹），站着不动腿边偶尔一圈细纹。
 * - 水花是一池小水珠（THREE.Points）：抛出去、受重力、落回水面就没了；跳进水里是一圈皇冠形的水花加一团水雾，
 *   冲刺是往两边甩的扇面。水越深（没到小腿 / 膝盖）水花越大。
 * - 飞行模式贴着水面掠过也会拖出尾迹和水雾。
 *
 * 声音交给 waterSound.ts（sound 字段）；子弹打水由 CombatFx.onWater 转到 bulletHit。
 *
 * 透明材质不改透明通道（湖面反射贴图拿透明通道当标记，见 scene.ts 的 LAKE_FS）。
 */
import * as THREE from 'three';
import type { Walker } from '../plateau/walker';
import type { LakeSurface } from './scene';
import type { HaiziTerrain } from './terrain';
import type { WaterSound } from './waterSound';

const MAX = 700;
const _at = new THREE.Vector3();
const GRAVITY = 9.8;

const VS = /* glsl */ `
attribute float aLife;
attribute float aSize;
attribute float aAlpha;
attribute vec3 aVel;
uniform float uScale;
uniform vec2 uViewport;
varying float vLife;
varying float vAlpha;
varying vec2 vDir;
varying float vHalf;
varying float vRad;
void main() {
  vLife = aLife;
  // 水珠按速度拉成一小段（快门 1/30 秒的动态模糊）：投影这一帧和 35 ms 之后的位置，精灵盖住两头
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 trail = (viewMatrix * vec4(aVel * 0.035, 0.0)).xyz;
  vec4 c0 = projectionMatrix * mv;
  vec4 c1 = projectionMatrix * vec4(mv.xyz + trail, 1.0);
  vec2 s0 = c0.xy / c0.w * 0.5 * uViewport, s1 = c1.xy / max(c1.w, 1e-3) * 0.5 * uViewport;
  vec2 d = s1 - s0;
  float len = min(length(d), 80.0);
  float dia = max(1.5, aSize * uScale / max(-mv.z, 0.1));
  float size = len + dia;
  gl_PointSize = aLife > 0.0 ? size : 0.0;
  gl_Position = projectionMatrix * vec4(mv.xyz + trail * 0.5 * (len / max(length(d), 1e-3)), 1.0);
  vDir = len > 0.01 ? normalize(vec2(d.x, -d.y)) : vec2(1.0, 0.0);
  vHalf = 0.5 * len / size;
  vRad = 0.5 * dia / size;
  // 拉长了就淡一点（同一颗水珠的光摊到更长的一段上）
  vAlpha = aAlpha * clamp(1.6 * dia / size, 0.3, 1.0);
}`;

const FS = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHi;
varying float vLife;
varying float vAlpha;
varying vec2 vDir;
varying float vHalf;
varying float vRad;
void main() {
  if (vLife <= 0.0) discard;
  vec2 c = gl_PointCoord - 0.5;
  float t = clamp(dot(c, vDir), -vHalf, vHalf);
  float d = length(c - vDir * t) / max(vRad, 1e-3);
  if (d > 1.0) discard;
  // 边缘软，中间一点高光（映着天）
  float a = smoothstep(1.0, 0.3, d) * vAlpha * clamp(vLife * 3.0, 0.0, 1.0);
  vec3 col = mix(uColor, uHi, smoothstep(0.6, 0.0, d) * 0.7);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class WaterFx {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly life = new Float32Array(MAX);
  private readonly maxLife = new Float32Array(MAX);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  /** 每颗的阻力（水雾大、慢，阻力大） */
  private readonly drag = new Float32Array(MAX);
  private next = 0;
  private alive = 0;
  private readonly mat: THREE.ShaderMaterial;

  // 走动状态
  private prev = new THREE.Vector3();
  private hasPrev = false;
  private wasIn = false;
  private stride = 0;
  private foot = 1;
  private wakeT = 0;
  private idleT = 0;
  private dashT = 0;
  private prevSpeed = 0;
  /** 水声（waterSound.ts）；不接就没声 */
  sound: WaterSound | null = null;

  constructor(scene: THREE.Scene, private readonly lake: LakeSurface, private readonly terrain: HaiziTerrain) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: {
        uScale: { value: 600 },
        uViewport: { value: new THREE.Vector2(1280, 720) },
        uColor: { value: new THREE.Color('#cfe2e8') },
        uHi: { value: new THREE.Color('#ffffff') },
      },
      transparent: true, depthWrite: false,
      // 颜色正常混合；透明通道保持不变（反射贴图的标记）
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.name = 'water-splash';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  /** 每帧在 walker.update 之后调。camera / pixelWidth / pixelHeight（画布像素）：水珠按透视算像素大小和拖影长度 */
  update(dt: number, walker: Walker, camera: THREE.PerspectiveCamera, pixelWidth: number, pixelHeight: number): void {
    this.mat.uniforms.uScale.value = pixelHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    (this.mat.uniforms.uViewport.value as THREE.Vector2).set(pixelWidth, pixelHeight);
    if (dt > 0) this.drive(dt, walker);
    this.simulate(dt);
  }

  /**
   * 子弹打在水面上（CombatFx.onWater）：一圈涟漪、往上蹿的一小柱水、四周溅开的水珠、一小团水雾、弹着水声。
   * strength：1 = 打进水里，0.6 = 穿过水面打中水下的东西
   */
  bulletHit(at: THREE.Vector3, strength = 1): void {
    const lv = this.terrain.waterLevelAt(at.x, at.z);
    const y = Number.isFinite(lv) ? lv : at.y;
    this.lake.addRipple(at.x, at.z, 0.18 + 0.3 * strength);
    // 远处也要看得见：水柱的水珠比走路踢起的大一圈
    for (let i = 0; i < Math.round(5 + 6 * strength); i++) {
      this.emit(at.x + (Math.random() - 0.5) * 0.12, y + 0.03, at.z + (Math.random() - 0.5) * 0.12,
        (Math.random() - 0.5) * 1.1, 2.6 + Math.random() * 3 * strength, (Math.random() - 0.5) * 1.1,
        0.07 + Math.random() * 0.07, 0.9, 0.5 + Math.random() * 0.35, 0.15);
    }
    for (let i = 0; i < Math.round(6 + 6 * strength); i++) {
      const a = Math.random() * Math.PI * 2, out = 0.8 + Math.random() * 1.2;
      this.emit(at.x, y + 0.03, at.z, Math.cos(a) * out, 1 + Math.random() * 1.6, Math.sin(a) * out,
        0.05 + Math.random() * 0.05, 0.8, 0.4 + Math.random() * 0.3, 0.2);
    }
    this.emit(at.x, y + 0.15, at.z, 0, 0.5, 0, 0.35 + 0.25 * strength, 0.14, 0.7, 2.2);
    this.sound?.play('bullet', _at.set(at.x, y, at.z), strength);
  }

  // ───────────────────────────── 人和水 ─────────────────────────────

  private drive(dt: number, walker: Walker): void {
    const f = walker.feet;
    const level = this.terrain.waterLevelAt(f.x, f.z);
    const bed = this.terrain.heightAt(f.x, f.z);
    const depth = level - bed;
    if (!this.hasPrev) { this.prev.copy(f); this.hasPrev = true; this.wasIn = false; return; }
    const dx = f.x - this.prev.x, dz = f.z - this.prev.z;
    const speed = Math.hypot(dx, dz) / dt;
    const vy = (f.y - this.prev.y) / dt;
    const teleport = speed > 80;   // 切机位
    const wet = Number.isFinite(level) && depth > 0.03;
    // 脚在水面以下（站在浅水底）或刚好贴着水面
    const inWater = wet && !walker.fly && f.y <= level + 0.06;
    // 飞行贴着水面掠过
    const skim = wet && walker.fly && f.y < level + 0.8 && f.y > level - 0.3 && speed > 2;

    if (!teleport) {
      // 从空中落进水里（跳下来、从雷神身上掉下来）：皇冠水花 + 一圈大涟漪 + 白沫
      if (wet && !walker.fly && this.prev.y > level + 0.02 && f.y <= level + 0.02 && -vy > 2.2) {
        this.land(f.x, f.z, level, Math.min(1, (-vy - 2.2) / 9), depth);
      }
      // 从水里跳起来：腿上带起一圈水珠
      if (this.wasIn && !inWater && !walker.fly && vy > 3) this.jumpOut(f.x, f.z, level, depth);
    }

    if (inWater && !teleport) {
      const deep = THREE.MathUtils.clamp(depth / 0.9, 0, 1);   // 没到脚踝 → 0，没到膝盖 → 1
      const dirX = speed > 0.1 ? dx / (speed * dt) : 0, dirZ = speed > 0.1 ? dz / (speed * dt) : 0;
      if (speed > 0.6) {
        this.idleT = 0;
        // 一步一圈，左右脚交替
        this.stride += speed * dt;
        if (this.stride > 0.8) {
          this.stride = 0;
          this.foot = -this.foot;
          const ox = -dirZ * 0.17 * this.foot, oz = dirX * 0.17 * this.foot;
          this.lake.addRipple(f.x + ox + dirX * 0.25, f.z + oz + dirZ * 0.25, 0.22 + 0.25 * deep + 0.02 * speed);
          this.step(f.x + ox, f.z + oz, level, dirX, dirZ, speed, deep);
        }
        // 身后拖一串尾迹
        this.wakeT -= dt;
        if (this.wakeT <= 0) {
          this.wakeT = speed > 10 ? 0.09 : 0.26;
          this.lake.addRipple(f.x - dirX * 0.3, f.z - dirZ * 0.3, 0.14 + 0.12 * deep + Math.min(0.5, speed * 0.02));
        }
        // 冲刺：往两边甩的扇面
        if (speed > 12) {
          if (this.prevSpeed <= 12) this.sound?.play('dash', f, deep);
          this.dashT -= dt;
          if (this.dashT <= 0) { this.dashT = 0.03; this.dashSpray(f.x, f.z, level, dirX, dirZ, speed, deep); }
        }
      } else {
        // 站着不动：腿边偶尔一圈细纹
        this.idleT -= dt;
        if (this.idleT <= 0) { this.idleT = 1.4 + Math.random() * 0.8; this.lake.addRipple(f.x, f.z, 0.08 + 0.06 * deep); }
      }
    }
    if (skim && !teleport) {
      this.wakeT -= dt;
      if (this.wakeT <= 0) {
        const s = Math.hypot(dx, dz) / dt;
        this.wakeT = 0.12;
        const k = 1 - THREE.MathUtils.clamp((f.y - level) / 0.8, 0, 1);
        this.lake.addRipple(f.x, f.z, 0.2 + 0.5 * k);
        for (let i = 0; i < Math.round(3 + 6 * k); i++) this.emit(f.x, level + 0.05, f.z,
          (Math.random() - 0.5) * 2 - (dx / dt / s) * 1.5, 1 + Math.random() * 2.5 * k, (Math.random() - 0.5) * 2 - (dz / dt / s) * 1.5,
          0.03 + Math.random() * 0.04, 0.7, 0.6 + Math.random() * 0.4, 0.4);
      }
    }
    if (this.sound) {
      const shore = Math.abs(Math.hypot(f.x, f.z) - this.terrain.shorelineR());
      this.sound.shore(dt, Math.max(inWater ? 1 : 0, THREE.MathUtils.smoothstep(18 - shore, 0, 17)) * (walker.fly && !skim ? 0.4 : 1));
    }
    this.prevSpeed = teleport ? 0 : speed;
    this.wasIn = inWater;
    this.prev.copy(f);
  }

  /** 走一步：脚往前踢起几颗水珠，水越深越多 */
  private step(x: number, z: number, level: number, dirX: number, dirZ: number, speed: number, deep: number): void {
    this.sound?.play('step', _at.set(x, level, z), deep);
    const n = Math.round(3 + speed * 0.5 + deep * 8);
    for (let i = 0; i < n; i++) {
      const fwd = 0.6 + Math.random() * 1.2 + speed * 0.08;
      this.emit(x + (Math.random() - 0.5) * 0.2, level + 0.04, z + (Math.random() - 0.5) * 0.2,
        dirX * fwd + (Math.random() - 0.5) * 0.9, 1.2 + Math.random() * (1.4 + deep * 1.6), dirZ * fwd + (Math.random() - 0.5) * 0.9,
        0.015 + Math.random() * 0.025, 0.6, 0.5 + Math.random() * 0.4, 0.2);
    }
  }

  /** 落水：一圈皇冠形水花（外翻）、中间往上蹿的一柱、贴水面散开的一团水雾，涟漪 + 白沫 */
  private land(x: number, z: number, level: number, impact: number, depth: number, silent = false): void {
    if (!silent) this.sound?.play('land', _at.set(x, level, z), impact);
    const deep = THREE.MathUtils.clamp(depth / 0.9, 0, 1);
    const k = 0.35 + 0.65 * impact;
    this.lake.addRipple(x, z, 0.6 + 0.9 * k);
    this.lake.addRipple(x, z, 0.25 + 0.3 * k);
    const crown = Math.round(40 + 70 * k * (0.5 + 0.5 * deep));
    for (let i = 0; i < crown; i++) {
      const a = (i / crown) * Math.PI * 2 + Math.random() * 0.3, out = 0.7 + Math.random() * 1.6 * k;
      const r = 0.25 + Math.random() * 0.2;
      this.emit(x + Math.cos(a) * r, level + 0.05, z + Math.sin(a) * r,
        Math.cos(a) * out, 2.4 + Math.random() * 3.4 * k, Math.sin(a) * out,
        0.03 + Math.random() * 0.05, 0.85, 0.6 + Math.random() * 0.5, 0.15);
    }
    const column = Math.round(6 + 10 * k);
    for (let i = 0; i < column; i++) {
      this.emit(x + (Math.random() - 0.5) * 0.3, level + 0.1, z + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.8, 3.5 + Math.random() * 3 * k, (Math.random() - 0.5) * 0.8,
        0.04 + Math.random() * 0.06, 0.9, 0.7 + Math.random() * 0.4, 0.1);
    }
    // 水雾：大、淡、慢
    for (let i = 0; i < Math.round(6 + 8 * k); i++) {
      const a = Math.random() * Math.PI * 2, out = 0.4 + Math.random() * 1.2;
      this.emit(x, level + 0.2 + Math.random() * 0.4, z, Math.cos(a) * out, 0.4 + Math.random() * 0.9, Math.sin(a) * out,
        0.6 + Math.random() * 0.8 * k, 0.15, 0.9 + Math.random() * 0.6, 2.2);
    }
  }

  /** 从水里跳起来：腿上带起来的水珠往下掉 */
  private jumpOut(x: number, z: number, level: number, depth: number): void {
    this.sound?.play('out', _at.set(x, level, z), depth);
    this.lake.addRipple(x, z, 0.35 + 0.3 * THREE.MathUtils.clamp(depth / 0.9, 0, 1));
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      this.emit(x + Math.cos(a) * 0.15, level + 0.1 + Math.random() * 0.3, z + Math.sin(a) * 0.15,
        Math.cos(a) * 0.6, 1.5 + Math.random() * 2, Math.sin(a) * 0.6, 0.03 + Math.random() * 0.03, 0.85, 0.5 + Math.random() * 0.3, 0.2);
    }
  }

  /** 冲刺：往两侧斜后方甩出去的扇面 */
  private dashSpray(x: number, z: number, level: number, dirX: number, dirZ: number, speed: number, deep: number): void {
    const n = Math.round(4 + deep * 5);
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const out = 2 + Math.random() * 3;
      const back = -0.2 * speed * (0.3 + Math.random() * 0.4);
      this.emit(x + dirX * 0.3, level + 0.05, z + dirZ * 0.3,
        -dirZ * side * out + dirX * back, 1.5 + Math.random() * 2.5, dirX * side * out + dirZ * back,
        0.03 + Math.random() * 0.05, 0.85, 0.5 + Math.random() * 0.4, 0.3);
    }
    if (Math.random() < 0.4) this.emit(x, level + 0.3, z, -dirX * 1.5, 0.6, -dirZ * 1.5, 0.5 + Math.random() * 0.4, 0.12, 0.8, 2.2);
  }

  // ───────────────────────────── 水珠 ─────────────────────────────

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, alpha: number, life: number, drag: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    if (this.life[i] <= 0) this.alive++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.maxLife[i] = life;
    this.size[i] = size; this.alpha[i] = alpha; this.drag[i] = drag;
  }

  private simulate(dt: number): void {
    if (this.alive <= 0) return;
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 3;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[o] *= k; this.vel[o + 2] *= k;
      // 水雾几乎不受重力，水珠照常往下掉
      this.vel[o + 1] = this.vel[o + 1] * k - GRAVITY * dt * (this.drag[i] > 1 ? 0.05 : 1);
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      // 落回水面（或地上）就没了
      const lv = this.terrain.waterLevelAt(this.pos[o], this.pos[o + 2]);
      const floor = Math.max(Number.isFinite(lv) ? lv : -Infinity, this.terrain.heightAt(this.pos[o], this.pos[o + 2]));
      if (this.vel[o + 1] < 0 && this.pos[o + 1] < floor) this.life[i] = 0;
      if (this.life[i] <= 0) { this.life[i] = 0; continue; }
      alive++;
    }
    this.alive = alive;
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aVel as THREE.BufferAttribute).needsUpdate = true;
  }

  /**
   * 大冲击砸进湖里（CombatFx.water 的 strength > 1：落雷 2.2、龙爪 2、冲击波 1.6、雷神身段出入水 1.4、投射物 1.3）：
   * 一圈大涟漪、皇冠水花、往上冲的水柱、一团水雾、轰响
   */
  splash(at: THREE.Vector3, strength: number): void {
    const lv = this.terrain.waterLevelAt(at.x, at.z);
    if (!Number.isFinite(lv)) return;
    const s = THREE.MathUtils.clamp((strength - 1) / 1.3, 0, 1);
    this.lake.addRipple(at.x, at.z, 1 + 0.5 * s);
    this.land(at.x, at.z, lv, 0.6 + 0.4 * s, 1, true);
    // 水柱：比人落水高得多
    for (let i = 0; i < Math.round(10 + 22 * s); i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * (0.6 + 1.2 * s);
      this.emit(at.x + Math.cos(a) * r, lv + 0.1, at.z + Math.sin(a) * r,
        Math.cos(a) * (0.5 + Math.random()), 5 + Math.random() * (4 + 6 * s), Math.sin(a) * (0.5 + Math.random()),
        0.08 + Math.random() * 0.1, 0.9, 0.9 + Math.random() * 0.6, 0.1);
    }
    for (let i = 0; i < Math.round(4 + 6 * s); i++) {
      const a = Math.random() * Math.PI * 2, out = 0.5 + Math.random() * 1.5;
      this.emit(at.x, lv + 0.5 + Math.random() * 1.5 * s, at.z, Math.cos(a) * out, 0.8 + Math.random(), Math.sin(a) * out,
        1 + Math.random() * (0.8 + 1.2 * s), 0.13, 1.4 + Math.random() * 0.8, 1.6);
    }
    this.sound?.play('boom', _at.set(at.x, lv, at.z), s);
  }

  /** 调试 / 截图：在 (x, z) 模拟一次落水 */
  splashAt(x: number, z: number, impact = 1): void {
    const lv = this.terrain.waterLevelAt(x, z);
    this.land(x, z, lv, impact, lv - this.terrain.heightAt(x, z));
  }
}
