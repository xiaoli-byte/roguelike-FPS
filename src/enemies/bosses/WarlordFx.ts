/**
 * 熔心魔将专属特效的网页版（Unity Fx.Warlord.cs，docs/art/vfx/warlord.md）。
 *   · 主形 · 暗月牙托亮刃（WarlordArc / WarlordCrescentMesh）照 Unity 自己做：一弯墨笔笔形的月牙（露锋起笔细 → 行笔渐粗 → 收笔前一顿 → 出锋），
 *     底下垫一层更大的暗紫褐月牙（普通混合）、中间熔铜色块（普通混合）、外缘白热刃口（加法）；刀头第一帧就扫到一半，前 40% 寿命缓出扫完，35% 起刀尾往刀头收。
 *     狂怒（fury > 0.5）多一层残月：晚 0.05 s、大 7%、只有赤色暗边。池化（最多 16 道）。飞行剑气（WarlordWaveFx）用同一个月牙，整弯常亮、跟着前沿走。
 *   · 其余（方铜渣、紫褐烟、重击落地、裂地线、狂怒换挡、居合刀光……）「精神对齐」：换成网页 ctx.fx 的粒子 / 冲击环 / 爆炸 / 光束组合，
 *     节拍（哪一帧、多大、什么颜色）照 Unity；逐粒子一致留给 M11b。
 * 角度：yaw 是世界 yaw（度，0 = +Z）；dir = 1 从魔将的右往左扫、−1 反向；tilt（弧度）正 = 右端压低（竖劈 tilt = −π/2：从上往下）；pitchDeg 正 = 整弯往前低头。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { screenFlash } from './HanbaFx';
import { EMBERS, FIRE, LAVA, WarlordPalette as Pal } from './WarlordDef';

export { screenFlash };

const DEG = Math.PI / 180;
const SEGMENTS = 28;
const ROW_AT = [0, 0.22, 0.45, 0.68, 0.86, 1];
const UNDER_A = [0.3, 0.72, 0.86, 0.88, 0.86, 0.74];
const BODY_A = [0, 0.72, 0.9, 0.95, 0.92, 0.55];
const EDGE_A = [0, 0, 0, 0.04, 0.16, 0.85];
const ROWS = ROW_AT.length;
const MAX_ARCS = 16;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 笔形（相对最厚处）：0 = 起笔 → 1 = 收笔。露锋 0.15、到一半就满、0.8 附近顿一下（+10%）、之后出锋尖收到 0 */
export function brush(u: number): number {
  u = Math.min(1, Math.max(0, u));
  const swell = Math.pow(smoothstep(0, 1, Math.min(1, u / 0.5)), 0.7);
  const entry = 0.15 + 0.85 * swell;
  const x = Math.min(1, Math.max(0, (u - 0.82) / 0.18));
  const exit = 1 - Math.pow(x, 1.6);
  const d = (u - 0.8) / 0.06;
  const press = 1 + 0.1 * Math.exp(-d * d);
  return entry * exit * press;
}

/** u 处的干笔程度：起笔那一段最干 */
export function dryness(u: number): number {
  return Math.min(1, Math.max(0, 1 - u / 0.38));
}

// ───────────────────────────── 月牙 ─────────────────────────────

interface ArcLook {
  radius: number; arc: number; dir: number; width: number; fury: number; seed: number;
  /** 只画暗边、不画刃口（残月） */
  ember: boolean;
}

function makeLayer(blending: THREE.Blending, order: number): { mesh: THREE.Mesh; geo: THREE.BufferGeometry; pos: Float32Array; col: Float32Array } {
  const n = (SEGMENTS + 1) * ROWS;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  const idx: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    for (let k = 0; k < ROWS - 1; k++) {
      const a = i * ROWS + k, b = a + 1, c = a + ROWS, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending, toneMapped: false, fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return { mesh, geo, pos, col };
}

const _c = new THREE.Color();

class Arc {
  readonly group = new THREE.Group();
  private readonly under = makeLayer(THREE.NormalBlending, 5);
  private readonly body = makeLayer(THREE.NormalBlending, 6);
  private readonly edge = makeLayer(THREE.AdditiveBlending, 7);
  active = false;
  age = 0;
  life = 0.32;
  reveal = 0.5;
  /** 常亮（飞行剑气）：刀头 = 1、刀尾 = 0，直到撤掉 */
  steady = false;
  ending = -1;
  delay = 0;
  look: ArcLook = { radius: 3, arc: 1.5, dir: 1, width: 1, fury: 0, seed: 0, ember: false };
  gen = 0;

  constructor() {
    this.group.add(this.under.mesh, this.body.mesh, this.edge.mesh);
    this.group.visible = false;
  }

  paint(head: number, tail: number, alpha: number, grow: number): void {
    const p = this.look;
    const hot = new THREE.Color(p.ember ? Pal.FuryHot : Pal.hotAt(p.fury));
    const copper = new THREE.Color(p.ember ? Pal.FuryDeep : Pal.copperAt(p.fury));
    const deep = new THREE.Color(p.ember ? Pal.FuryDeep : Pal.deepAt(p.fury));
    if (p.ember) deep.multiplyScalar(0.75);
    const underC = new THREE.Color(Pal.Under);
    const pu = this.under.pos, pb = this.body.pos, pe = this.edge.pos;
    const cu = this.under.col, cb = this.body.col, ce = this.edge.col;
    for (let i = 0; i <= SEGMENTS; i++) {
      const u = i / SEGMENTS;
      // 起点在魔将右侧（模型空间 −X）：a > 0 → x < 0
      const a = (u - 0.5) * p.arc * -p.dir;
      const sn = Math.sin(a), cs = Math.cos(a);
      const thick = p.width * brush(u);
      const wob = 1 + 0.04 * Math.sin(u * 9.4 + p.seed);
      const on = u <= head && u >= tail;
      const lead = on ? Math.min(1, Math.max(0, 1 - (head - u) * 3.5)) : 0;
      const soft = on ? Math.min(1, Math.max(0, (head - u) * 12)) * Math.min(1, Math.max(0, (u - tail) * 6)) * alpha : 0;
      const dry = dryness(u) * 0.85;
      for (let k = 0; k < ROWS; k++) {
        const v = i * ROWS + k;
        const inner = thick * (1 - ROW_AT[k]) * (k <= 2 ? wob : 1);
        const r = (p.radius - inner) * grow;
        pb[v * 3] = pe[v * 3] = -sn * r;
        pb[v * 3 + 1] = pe[v * 3 + 1] = 0;
        pb[v * 3 + 2] = pe[v * 3 + 2] = cs * r;
        const ru = (p.radius + p.width * 0.12 - inner * 1.18) * grow;
        pu[v * 3] = -sn * ru;
        pu[v * 3 + 1] = -0.01;
        pu[v * 3 + 2] = cs * ru;
        const gap = k === 2 || k === 4 ? 1 - dry : 1;
        cu[v * 4] = underC.r; cu[v * 4 + 1] = underC.g; cu[v * 4 + 2] = underC.b;
        cu[v * 4 + 3] = soft * UNDER_A[k] * gap;
        _c.copy(k <= 2 ? deep : copper).lerp(copper, lead * 0.4 * (k / (ROWS - 1)));
        cb[v * 4] = _c.r; cb[v * 4 + 1] = _c.g; cb[v * 4 + 2] = _c.b;
        cb[v * 4 + 3] = soft * BODY_A[k] * gap;
        ce[v * 4] = hot.r; ce[v * 4 + 1] = hot.g; ce[v * 4 + 2] = hot.b;
        ce[v * 4 + 3] = p.ember ? 0 : soft * (EDGE_A[k] + (k === ROWS - 2 ? 0.3 * lead : 0));
      }
    }
    for (const l of [this.under, this.body, this.edge]) {
      (l.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (l.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  /** 推进一帧；返回 true = 结束 */
  step(dt: number): boolean {
    if (this.delay > 0) {
      this.delay -= dt;
      this.group.visible = false;
      return false;
    }
    this.group.visible = true;
    this.age += dt;
    if (this.steady) {
      let alpha = Math.min(1, this.age / 0.06);
      if (this.ending >= 0) {
        this.ending += dt;
        alpha *= Math.max(0, 1 - this.ending / 0.15);
        if (this.ending >= 0.15) return true;
      }
      this.paint(1.05, -0.05, alpha, 1);
      return false;
    }
    const t = this.age / Math.max(0.05, this.life);
    if (t >= 1) return true;
    const head = this.reveal + (1.12 - this.reveal) * (1 - Math.pow(1 - Math.min(1, t / 0.4), 2.4));
    const tail = Math.min(1, Math.max(0, (t - 0.35) / 0.65)) * 1.15;
    this.paint(head, tail, 1, 1 + 0.08 * t);
    return false;
  }
}

const pool: Arc[] = [];

/** 拿一道空闲的月牙（满了复用最老的） */
function take(ctx: GameContext): Arc {
  let oldest: Arc | null = null;
  for (const a of pool) {
    if (!a.active) return attach(ctx, a);
    if (!a.steady && (!oldest || a.age / a.life > oldest.age / oldest.life)) oldest = a;
  }
  if (pool.length < MAX_ARCS || !oldest) {
    const a = new Arc();
    pool.push(a);
    return attach(ctx, a);
  }
  return attach(ctx, oldest);
}

function attach(ctx: GameContext, a: Arc): Arc {
  if (a.group.parent !== ctx.stageGroup) ctx.stageGroup.add(a.group);
  return a;
}

/** 月牙句柄：moveTo 跟着前沿走（飞行剑气），cancel 提前收掉 */
export interface ArcHandle {
  moveTo(p: THREE.Vector3): void;
  cancel(): void;
}

const NO_ARC: ArcHandle = { moveTo: () => {}, cancel: () => {} };

/** 月牙的朝向：yaw → 往前低头 pitch → 绕前方轴倾斜 tilt */
export function arcRotation(yawDeg: number, tilt: number, pitchDeg: number, out = new THREE.Quaternion()): THREE.Quaternion {
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawDeg * DEG);
  const qp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchDeg * DEG);
  const qt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt);
  return out.copy(qy).multiply(qp).multiply(qt);
}

interface CrescentOpts {
  life?: number;
  pitchDeg?: number;
  reveal?: number;
  /** −1 按狂怒自动、0 不要、1 要 */
  echo?: number;
  steady?: boolean;
  rotation?: THREE.Quaternion;
}

/** 一弯月牙（Fx.WarlordCrescent）：arc = 弧长（弧度），width = 最厚处（米） */
export function crescent(ctx: GameContext, center: THREE.Vector3, yawDeg: number, radius: number, arc: number, dir: number, tilt: number, width: number,
  fury: number, o: CrescentOpts = {}): ArcHandle {
  if (!Number.isFinite(center.x + center.y + center.z) || !(radius > 0.1)) return NO_ARC;
  const rot = o.rotation ?? arcRotation(yawDeg, tilt, o.pitchDeg ?? 0);
  const main = spawnArc(ctx, center, rot, { radius, arc: Math.min(Math.PI * 2, Math.max(0.1, arc)), dir: dir >= 0 ? 1 : -1,
    width: Math.min(radius * 0.8, Math.max(0.1, width)), fury: Math.min(1, Math.max(0, fury)), seed: Math.random() * 6.28, ember: false }, o, 0);
  const echo = o.echo ?? -1;
  let second: Arc | null = null;
  if (!o.steady && (echo > 0 || (echo < 0 && fury > 0.5)) && ctx.settings.quality !== 'low') {
    second = spawnArc(ctx, center, rot, { radius: radius * 1.07, arc: Math.min(Math.PI * 2, Math.max(0.1, arc)), dir: dir >= 0 ? 1 : -1,
      width: Math.min(radius * 0.8, Math.max(0.1, width)), fury, seed: Math.random() * 6.28, ember: true }, o, 0.05);
  }
  const gen = main.gen;
  return {
    moveTo: (p) => {
      if (main.gen === gen && main.active) main.group.position.copy(p);
    },
    cancel: () => {
      if (main.gen !== gen || !main.active) return;
      if (main.steady) main.ending = Math.max(0, main.ending);
      else main.life = Math.min(main.life, main.age + 0.06);
      if (second && second.active) second.life = Math.min(second.life, second.age + 0.06);
    },
  };
}

function spawnArc(ctx: GameContext, center: THREE.Vector3, rot: THREE.Quaternion, look: ArcLook, o: CrescentOpts, delay: number): Arc {
  const a = take(ctx);
  a.gen++;
  a.active = true;
  a.age = 0;
  a.life = Math.max(0.08, o.life ?? 0.32);
  a.reveal = Math.min(1.15, Math.max(0, o.reveal ?? 0.5));
  a.steady = !!o.steady;
  a.ending = -1;
  a.delay = delay;
  a.look = look;
  a.group.position.copy(center);
  a.group.quaternion.copy(rot);
  a.group.visible = false;
  const gen = a.gen;
  if (!a.steady) a.step(0);
  ctx.tasks.add((dt) => {
    if (a.gen !== gen) return true;
    if (!a.step(dt)) return false;
    a.active = false;
    a.group.visible = false;
    return true;
  });
  return a;
}

// ───────────────────────────── 其余特效（精神对齐） ─────────────────────────────

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/** 点缀 · 方块铜渣：沿 dir 甩出去的几块铜渣 + 一小撮拉丝火星 */
export function shards(ctx: GameContext, at: THREE.Vector3, dir: THREE.Vector3, size: number, fury: number, chunk = true): void {
  _a.copy(at).addScaledVector(dir, 0.3);
  ctx.fx.burst(_a, Pal.hotAt(fury), Math.round(6 + size * 8), 5 + size * 3, 0.35, 0.06, 9);
  if (chunk) ctx.fx.burst(_a, Pal.Slag, Math.round(3 + size * 3), 4 + size * 2, 0.7, 0.14, 14);
}

/** 紫褐尘浪（Fx.WarlordSmoke） */
export function smoke(ctx: GameContext, at: THREE.Vector3, radius: number, count = 4): void {
  ctx.fx.burst(at, Pal.Smoke, Math.max(2, count * 2), 1.2 + radius, 1.1, 0.5 + radius * 0.2, -1.2);
}

/** 重击落地（Fx.WarlordImpact）：贴地粗环、熔铜冠、方铜渣崩一圈、紫褐尘浪 */
export function impact(ctx: GameContext, ground: THREE.Vector3, radius: number, fury: number): void {
  _a.copy(ground).setY(ground.y + 0.08);
  ctx.fx.ring(_a, radius * 1.6, Pal.copperAt(fury), 0.45);
  ctx.fx.ring(_a, radius * 0.9, Pal.hotAt(fury), 0.3);
  _b.copy(ground).setY(ground.y + 0.35);
  ctx.fx.burst(_b, Pal.copperAt(fury), Math.round(14 + radius * 6), 4 + radius * 1.5, 0.6, 0.16, 12);
  ctx.fx.burst(_b, Pal.Slag, Math.round(5 + radius * 2), 5 + radius, 0.8, 0.16, 16);
  smoke(ctx, _b, radius * 0.6, 3);
}

/** 竖劈往前崩开的裂地线（Fx.WarlordCleaveLine）：沿线一节一节崩开 */
export function cleaveLine(ctx: GameContext, from: THREE.Vector3, dir: THREE.Vector3, length: number, fury: number): void {
  const n = Math.max(2, Math.round(length / 1.6));
  for (let i = 1; i <= n; i++) {
    const p = from.clone().addScaledVector(dir, (i / n) * length);
    ctx.tasks.delay(i * 0.035, () => {
      ctx.fx.burst(p.clone().setY(p.y + 0.25), Pal.copperAt(fury), 8, 3.5, 0.5, 0.13, 10);
      ctx.fx.ring(p.clone().setY(p.y + 0.06), 1.4, Pal.deepAt(fury), 0.3);
    });
  }
}

/** 陨石雨的号令（Fx.WarlordBeacon）：剑尖冲天光柱 + 天上一团火光 */
export function beacon(ctx: GameContext, tip: THREE.Vector3, fury: number): void {
  _a.copy(tip).setY(tip.y + 26);
  ctx.fx.beam(tip, _a, Pal.hotAt(fury), 0.5, 0.45);
  ctx.fx.burst(tip, Pal.hotAt(fury), 20, 5, 0.6, 0.2, -2);
  ctx.fx.burst(_a, FIRE, 24, 4, 0.9, 0.5, -1);
}

/** 狂怒换挡（Fx.WarlordFuryShift）：白热冲击环 + 紫褐烟环 + 全身喷铜火星 */
export function furyShift(ctx: GameContext, feet: THREE.Vector3, chest: THREE.Vector3): void {
  _a.copy(feet).setY(feet.y + 0.1);
  ctx.fx.ring(_a, 14, Pal.FuryHot, 0.6);
  ctx.fx.ring(_a, 9, Pal.Smoke, 0.9);
  ctx.fx.burst(chest, Pal.FuryCopper, 46, 11, 0.8, 0.2, -1);
  ctx.fx.explosion(chest, 2.6, Pal.FuryHot);
}

/** 熔铜落地（Fx.WarlordLanding）：重击落地 + 往四向崩开的「十」字熔铜裂口 + 紫褐尘浪 */
export function landing(ctx: GameContext, ground: THREE.Vector3, radius: number, fwd: THREE.Vector3, fury: number): void {
  impact(ctx, ground, radius * 0.75, fury);
  const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  for (const d of [fwd, fwd.clone().negate(), right, right.clone().negate()]) cleaveLine(ctx, ground, d.clone().normalize(), radius * 0.9, fury);
  // 闪光压低贴地（不用大爆炸团）：落地的身体始终在画面里
  ctx.fx.ring(_a.copy(ground).setY(ground.y + 0.05), radius * 1.2, Pal.hotAt(fury), 0.35);
  smoke(ctx, _a.copy(ground).setY(ground.y + 0.4), radius * 0.5, 5);
}

/** 怒视 / 破绽（Fx.WarlordGlare）：一点白热闪 + 一撮火星 */
export function glare(ctx: GameContext, at: THREE.Vector3, fury: number): void {
  ctx.fx.burst(at, Pal.hotAt(fury), 10, 2.2, 0.35, 0.18, -1);
  ctx.fx.ring(at, 0.9, Pal.hotAt(fury), 0.25);
}

/** 居合拔刀（Fx.WarlordIaiDraw）：一道白热的「一闪」直线 + 起步的紫褐尘 */
export function iaiDraw(ctx: GameContext, from: THREE.Vector3, dir: THREE.Vector3, dash: number, fury: number): void {
  _a.copy(from).setY(from.y + 1.4);
  _b.copy(_a).addScaledVector(dir, dash);
  ctx.fx.beam(_a, _b, Pal.hotAt(fury), 0.12, 0.18);
  smoke(ctx, _a.copy(from).setY(from.y + 0.3), 1, 3);
}

/**
 * 一道长刀光（Fx.WarlordStroke）：沿 along 方向、长 length 的一弯细长月牙（弦沿着线，往 bow 一侧微微鼓起）
 */
export function stroke(ctx: GameContext, mid: THREE.Vector3, along: THREE.Vector3, bow: THREE.Vector3, length: number, width: number, fury: number, life: number): void {
  const R = length * 1.4;
  const arc = 2 * Math.asin(Math.min(1, length / (2 * R)));
  const side = bow.clone().normalize();
  const center = mid.clone().addScaledVector(side, -R * Math.cos(arc / 2));
  // 月牙所在平面：局部 +Z = bow（拱向）、局部 X 沿 along
  const z = side, x = along.clone().normalize().negate();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  crescent(ctx, center, 0, R, arc, 1, 0, width, fury, { life, rotation: new THREE.Quaternion().setFromRotationMatrix(m), reveal: 0.9 });
}

/** 居合收刀「咔」：整条线上的刀光现形（迟到的刀光）+ 火星 + 方铜渣 */
export function iaiCut(ctx: GameContext, from: THREE.Vector3, dir: THREE.Vector3, length: number, halfWidth: number, fury: number): void {
  const mid = from.clone().addScaledVector(dir, length * 0.5).setY(from.y + 1.3);
  stroke(ctx, mid, dir, new THREE.Vector3(0, 1, 0), length, Math.min(1.2, halfWidth * 0.6), fury, 0.45);
  _a.copy(from).setY(from.y + 1.3);
  _b.copy(_a).addScaledVector(dir, length);
  ctx.fx.beam(_a, _b, Pal.hotAt(fury), 0.08, 0.22);
  for (let i = 1; i <= 4; i++) shards(ctx, from.clone().addScaledVector(dir, (i / 5) * length).setY(from.y + 1.1), new THREE.Vector3(0, 1, 0), 0.6, fury, i === 2);
}

/** 突刺：剑尖往前一道细长的刺光 */
export function thrustFlare(ctx: GameContext, tip: THREE.Vector3, dir: THREE.Vector3, fury: number): void {
  _a.copy(tip).addScaledVector(dir, 3.2);
  ctx.fx.beam(tip, _a, Pal.hotAt(fury), 0.1, 0.25);
  ctx.fx.burst(tip, Pal.hotAt(fury), 10, 4, 0.3, 0.08, 4);
}

/** 回旋斩：一整圈月牙 + 贴地粗环 + 方铜渣一圈往外甩（第二圈更大更薄） */
export function spinRing(ctx: GameContext, feet: THREE.Vector3, radius: number, inner: number, yawDeg: number, fury: number, second: boolean): void {
  _a.copy(feet).setY(feet.y + (second ? 0.9 : 1.2));
  crescent(ctx, _a, yawDeg, radius * 0.92, Math.PI * 2 * 0.97, 1, 0, second ? Math.max(0.5, (radius - inner) * 0.3) : Math.min(1.8, radius * 0.3), fury,
    { life: 0.4, pitchDeg: 0, reveal: 0.35 });
  _b.copy(feet).setY(feet.y + 0.08);
  ctx.fx.ring(_b, radius * 1.05, Pal.copperAt(fury), 0.4);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + yawDeg * DEG;
    const d = new THREE.Vector3(Math.sin(a), 0.2, Math.cos(a));
    shards(ctx, _b.clone().addScaledVector(d, radius * 0.7).setY(feet.y + 0.9), d, 0.6, fury, i % 3 === 0);
  }
}

/** 剑气 / 刀光撞上掩体或飞完（Fx.WarlordWaveBurst） */
export function waveBurst(ctx: GameContext, at: THREE.Vector3, vertical: boolean, fury: boolean, wall: boolean): void {
  const f = fury ? 1 : 0;
  ctx.fx.burst(at, Pal.hotAt(f), wall ? 18 : 10, wall ? 6 : 3.5, 0.45, 0.14, 6);
  if (wall) ctx.fx.explosion(at, vertical ? 1.4 : 1.1, Pal.copperAt(f));
  else ctx.fx.burst(at, Pal.Smoke, 4, 1.4, 0.8, 0.4, -1);
}

/** 十字剑气交汇（Fx.WarlordCrossFlare）：交点亮一个「十」字 */
export function crossFlare(ctx: GameContext, at: THREE.Vector3, dir: THREE.Vector3, halfWidth: number, fury: boolean): void {
  const f = fury ? 1 : 0;
  const side = new THREE.Vector3(dir.z, 0, -dir.x);
  ctx.fx.beam(_a.copy(at).addScaledVector(side, -halfWidth), _b.copy(at).addScaledVector(side, halfWidth), Pal.hotAt(f), 0.18, 0.25);
  ctx.fx.beam(_a.copy(at).setY(at.y - 1.2), _b.copy(at).setY(at.y + 2.2), Pal.hotAt(f), 0.18, 0.25);
  ctx.fx.burst(at, Pal.hotAt(f), 24, 6, 0.45, 0.16, 2);
}

/** 熔铜溅（Fx.MoltenSplash）：一小团熔铜往上溅再落回去 */
export function moltenSplash(ctx: GameContext, at: THREE.Vector3, size: number, color: number = Pal.Copper): void {
  ctx.fx.burst(at, color, Math.round(6 + size * 6), 3 + size * 2, 0.55, 0.12 + size * 0.05, 14);
}

/** 熔铜冠（Fx.MoltenBurst）：一大团熔铜炸开 */
export function moltenBurst(ctx: GameContext, at: THREE.Vector3, size: number, color: number = Pal.Copper): void {
  ctx.fx.burst(at, color, Math.round(10 + size * 10), 4 + size * 2.5, 0.7, 0.16 + size * 0.05, 12);
  ctx.fx.burst(at, Pal.hotAt(0), Math.round(4 + size * 4), 2 + size, 0.4, 0.2 + size * 0.06, 2);
}

/** 火柱（Fx.FlamePillar） */
export function flamePillar(ctx: GameContext, at: THREE.Vector3, radius: number, height: number): void {
  // 一串细小的火舌往上窜（粒子小、数量多：大颗粒会叠成一串白球）
  const n = Math.max(3, Math.round(height / 0.45));
  for (let i = 0; i < n; i++) {
    ctx.fx.burst(_a.copy(at).setY(at.y + (i / n) * height), i % 3 === 0 ? Pal.FuryDeep : FIRE, 5, 0.8 + radius, 0.45, 0.12 + radius * 0.2, -9);
  }
  ctx.fx.burst(_a.copy(at).setY(at.y + height), EMBERS, 6, 2.5, 0.7, 0.06, -4);
}

/** 地面残火（FlameTongues.Ground）：一圈小火苗 */
export function groundFlames(ctx: GameContext, at: THREE.Vector3, radius: number, count: number, seconds: number): void {
  let t = 0, acc = 0;
  ctx.tasks.add((dt) => {
    t += dt;
    acc += dt;
    if (acc >= 0.12) {
      acc = 0;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        _a.set(at.x + Math.sin(a) * radius, at.y + 0.2, at.z + Math.cos(a) * radius);
        ctx.fx.burst(_a, i % 2 ? FIRE : EMBERS, 2, 0.8, 0.5, 0.3, -5);
      }
    }
    return t >= seconds;
  });
}

/** 熔铜贴花 / 熔铜滩（Fx.MoltenSplat） */
export function moltenSplat(ctx: GameContext, at: THREE.Vector3, radius: number): void {
  ctx.fx.ring(_a.copy(at).setY(at.y + 0.05), radius, LAVA, 1.2);
  moltenBurst(ctx, _a.copy(at).setY(at.y + 0.3), radius * 0.4);
}

/** 第三章方形裂纹（Fx.Ch3Crack）：一小块熔铜裂口 */
export function ch3Crack(ctx: GameContext, at: THREE.Vector3, size: number, fury: number): void {
  ctx.fx.ring(_a.copy(at).setY(at.y + 0.05), size * 1.3, Pal.deepAt(fury), 0.5);
  ctx.fx.burst(_a.copy(at).setY(at.y + 0.15), Pal.copperAt(fury), 8, 2.5, 0.4, 0.1, 10);
}
