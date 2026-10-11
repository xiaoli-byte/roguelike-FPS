/**
 * 第二章辅助位（九尾狐巫、冰灯水母）共用的特效与玩法小工具。
 *
 * - LightTendrils：朝向相机的发光细带（光触须 / 霜链），可以从起点「伸出去」（extend 0..1）、带波动，亮点沿带子流动。
 * - FrostShell：罩在同伴身上的冰壳（霜甲），多面体冰晶 + 加法描边，对象池复用。
 * - iceWallGeometry：冰壁的多面体冰块（按种子确定形状，几何体模块级缓存）。
 * - Sway：二维阻尼弹簧（尾巴、触须、袖子这类弹簧骨骼的惯性）。
 * - chillPlayer：冻结减速（按玩家当前移速的比例扣，到点撤掉；重复命中刷新时长，不叠加）。
 *
 * 本模块只依赖 three.js（单元测试直接加载：tests/frost-support.test.mjs）。
 */
import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _wave = new THREE.Vector3();

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// ───────────────────────────── 光触须 ─────────────────────────────

/** 一根光触须的端点与状态（调用方持有、每帧改写） */
export interface TendrilSpec {
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  /** 0..1：从起点伸出去的长度比例（连上的过程） */
  extend: number;
  /** 0..1：整体亮度 */
  alpha: number;
  /** 随机相位（每根不同，波动错开） */
  seed: number;
}

/**
 * 朝向相机的发光细带（加法混合，顶点色控制明暗）。每根带子 SEG 段，中段按正弦摆动（像水里的触须），
 * 亮点从起点流向终点（治疗 / 供能的方向）。一个实例最多画 max 根，一次 draw call。
 */
export class LightTendrils {
  static readonly SEG = 14;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly max: number;

  constructor(parent: THREE.Object3D, color: number, max = 4) {
    this.max = max;
    const S = LightTendrils.SEG;
    const n = max * (S + 1) * 2;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx: number[] = [];
    for (let k = 0; k < max; k++) {
      const base = k * (S + 1) * 2;
      for (let i = 0; i < S; i++) {
        const v = base + i * 2;
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    parent.add(this.mesh);
  }

  /**
   * @param width 带宽（米）
   * @param wave 摆动幅度（米，中段最大）
   */
  update(list: readonly TendrilSpec[], width: number, wave: number, time: number, camera: THREE.Vector3): void {
    const S = LightTendrils.SEG;
    let k = 0;
    for (const t of list) {
      if (k >= this.max) break;
      const ext = clamp01(t.extend);
      if (ext <= 0.001 || t.alpha <= 0.001) continue;
      const base = k * (S + 1) * 2;
      _dir.subVectors(t.to, t.from);
      const len = _dir.length() || 1e-3;
      _dir.multiplyScalar(1 / len);
      // 摆动方向：与带子垂直、尽量水平（触须左右游）
      _wave.set(-_dir.z, 0, _dir.x);
      if (_wave.lengthSq() < 1e-6) _wave.set(1, 0, 0);
      _wave.normalize();
      for (let i = 0; i <= S; i++) {
        const u = (i / S) * ext;
        const env = Math.sin(Math.PI * Math.min(1, u / Math.max(0.2, ext)));
        const sw = Math.sin(u * 9 - time * 3.2 + t.seed * 6.3) * wave * env;
        const lift = Math.sin(u * 5.5 - time * 2.1 + t.seed * 3.1) * wave * 0.6 * env;
        _a.copy(t.from).addScaledVector(_dir, u * len).addScaledVector(_wave, sw);
        _a.y += lift;
        _toCam.subVectors(camera, _a).normalize();
        _side.crossVectors(_dir, _toCam);
        if (_side.lengthSq() < 1e-8) _side.set(0, 1, 0);
        // 末端（正在伸出的尖）收细；两端都略细
        const w = width * 0.5 * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, 0.12 + (i / S) * 0.88)));
        _side.normalize().multiplyScalar(w);
        const v = (base + i * 2) * 3;
        const p = this.pos;
        p[v] = _a.x + _side.x; p[v + 1] = _a.y + _side.y; p[v + 2] = _a.z + _side.z;
        p[v + 3] = _a.x - _side.x; p[v + 4] = _a.y - _side.y; p[v + 5] = _a.z - _side.z;
        // 亮点从起点流向终点
        const pulse = Math.pow(Math.max(0, Math.sin(u * Math.PI * 4 - time * 6 + t.seed * 5)), 5);
        const c = (0.4 + 0.9 * pulse) * t.alpha * (i === S && ext < 1 ? 1.4 : 1);
        const cc = this.col;
        cc[v] = cc[v + 1] = cc[v + 2] = cc[v + 3] = cc[v + 4] = cc[v + 5] = c;
      }
      k++;
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, k * S * 6);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** 线段上离点 p 最近的点的参数 t（0..1） */
export function closestOnSegment(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number {
  _a.subVectors(b, a);
  const l2 = _a.lengthSq();
  if (l2 < 1e-9) return 0;
  return clamp01(_b.subVectors(p, a).dot(_a) / l2);
}

/**
 * 玩家的身体（脚底 feet、身高 height、半径 radius 的竖直胶囊）是否穿过线段 a → b：
 * 沿线段取 12 个点，任何一点水平距离 < radius + pad 且在身高范围内即算穿过（「挡住连线」）。
 */
export function bodyCrossesSegment(a: THREE.Vector3, b: THREE.Vector3, feet: THREE.Vector3, height: number, radius: number, pad = 0.15): boolean {
  const r = radius + pad;
  for (let i = 1; i < 12; i++) {
    const u = i / 12;
    const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u, z = a.z + (b.z - a.z) * u;
    if (y < feet.y - 0.1 || y > feet.y + height + 0.1) continue;
    const dx = x - feet.x, dz = z - feet.z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

// ───────────────────────────── 霜甲冰壳 ─────────────────────────────

let shellGeo: THREE.BufferGeometry | null = null;
let shellEdges: THREE.EdgesGeometry | null = null;
const shellPool: FrostShell[] = [];

/** 冰晶多面体（低细分的二十面体，顶点按固定种子错开，不是光滑球） */
function frostShellGeometry(): THREE.BufferGeometry {
  if (!shellGeo) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    // 同一位置的顶点（非索引几何）按位置取同一个随机量，冰壳保持封闭
    const jitter = new Map<string, number>();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      let j = jitter.get(key);
      if (j === undefined) {
        const h = Math.sin(p.getX(i) * 12.9898 + p.getY(i) * 78.233 + p.getZ(i) * 37.719) * 43758.5453;
        j = 0.9 + 0.2 * (h - Math.floor(h));
        jitter.set(key, j);
      }
      p.setXYZ(i, p.getX(i) * j, p.getY(i) * j, p.getZ(i) * j);
    }
    g.computeVertexNormals();
    shellGeo = g;
    shellEdges = new THREE.EdgesGeometry(g, 20);
  }
  return shellGeo;
}

/**
 * 霜甲：罩在同伴身上的一层冰壳（半透明冰面 + 加法冰棱描边），随同伴移动、轻轻起伏；
 * 刚结上时从脚下往上冻（show 0 → 1），碎掉时散成冰屑（调用方放粒子）。
 */
export class FrostShell {
  readonly group = new THREE.Group();
  private readonly ice: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  private pooled = false;
  /** 结冰进度（0..1） */
  show = 0;

  private constructor() {
    const geo = frostShellGeometry();
    this.ice = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x9fdcff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.edges = new THREE.LineSegments(shellEdges!, new THREE.LineBasicMaterial({
      color: 0xc8f4ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.ice.renderOrder = 3;
    this.edges.renderOrder = 4;
    this.group.add(this.ice, this.edges);
  }

  static acquire(parent: THREE.Object3D): FrostShell {
    const s = shellPool.pop() ?? new FrostShell();
    s.pooled = false;
    s.show = 0;
    s.group.visible = true;
    parent.add(s.group);
    return s;
  }

  /** 罩住一个身体：脚底 feet、半径 r、高 h；t = 时间（起伏） */
  place(feet: THREE.Vector3, r: number, h: number, t: number): void {
    const k = this.show;
    const breathe = 1 + 0.025 * Math.sin(t * 2.3);
    this.group.position.set(feet.x, feet.y + h * 0.5 * k, feet.z);
    this.group.scale.set(r * 1.35 * breathe, Math.max(0.01, h * 0.58 * k), r * 1.35 * breathe);
    this.group.rotation.y = t * 0.15;
    this.ice.material.opacity = 0.2 * k + 0.05 * Math.sin(t * 3.1);
    this.edges.material.opacity = (0.55 + 0.25 * Math.sin(t * 4.7)) * k;
  }

  release(): void {
    if (this.pooled) return;
    this.pooled = true;
    this.group.removeFromParent();
    shellPool.push(this);
  }
}

// ───────────────────────────── 冰壁几何 ─────────────────────────────

const wallGeoCache = new Map<string, THREE.BufferGeometry[]>();

/**
 * 冰壁的冰块：沿 X 排一列竖直的多面体冰柱（五棱柱 + 尖顶，高低错落、前后微微错开），
 * 合起来是一道宽 width、高约 height、厚 thick 的冰墙；局部坐标原点在墙底中心，墙面朝 ±Z。
 * 返回每块冰的几何体（已摆好位置），按参数缓存。
 */
export function iceWallGeometry(width: number, height: number, thick: number): THREE.BufferGeometry[] {
  const key = `${width.toFixed(2)}:${height.toFixed(2)}:${thick.toFixed(2)}`;
  const hit = wallGeoCache.get(key);
  if (hit) return hit;
  const out: THREE.BufferGeometry[] = [];
  const n = Math.max(4, Math.round(width / 0.55));
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed % 10000) / 10000;
  };
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const x = (u - 0.5) * width;
    // 中间高、两端低，再加一点随机
    const h = height * (0.72 + 0.28 * Math.sin(Math.PI * u)) * (0.9 + 0.2 * rand());
    const r = (width / n) * (0.62 + 0.2 * rand());
    const body = new THREE.CylinderGeometry(r * 0.82, r, h * 0.8, 5, 1).translate(0, h * 0.4, 0);
    const tip = new THREE.ConeGeometry(r * 0.82, h * 0.25, 5, 1).translate(0, h * 0.8 + h * 0.125, 0);
    for (const g of [body, tip]) {
      g.rotateY(rand() * Math.PI);
      g.scale(1, 1, (thick / (2 * r)) * (0.85 + 0.3 * rand()));
      g.rotateZ((rand() - 0.5) * 0.18);
      g.translate(x, 0, (rand() - 0.5) * thick * 0.25);
      out.push(g.toNonIndexed());
      g.dispose();
    }
  }
  // 底座：几块压在地上的碎冰
  for (let i = 0; i < 3; i++) {
    const g = new THREE.DodecahedronGeometry(thick * 0.55, 0);
    g.scale(1.4, 0.55, 1);
    g.translate((i - 1) * width * 0.33, thick * 0.12, (rand() - 0.5) * thick * 0.4);
    out.push(g.toNonIndexed());
    g.dispose();
  }
  for (const g of out) g.computeVertexNormals();
  wallGeoCache.set(key, out);
  return out;
}

// ───────────────────────────── 弹簧 ─────────────────────────────

/** 二维阻尼弹簧（x、y 两个独立分量）：k 刚度、d 阻尼；step 返回当前偏移 */
export class Sway {
  x = 0;
  y = 0;
  private vx = 0;
  private vy = 0;
  private readonly k: number;
  private readonly d: number;

  constructor(k: number, d: number) {
    this.k = k;
    this.d = d;
  }

  step(tx: number, ty: number, dt: number): void {
    const h = Math.min(dt, 1 / 30);
    this.vx += (this.k * (tx - this.x) - this.d * this.vx) * h;
    this.vy += (this.k * (ty - this.y) - this.d * this.vy) * h;
    this.x += this.vx * h;
    this.y += this.vy * h;
  }

  /** 给一个瞬时速度冲量（甩尾、被打中） */
  kick(vx: number, vy: number): void {
    this.vx += vx;
    this.vy += vy;
  }
}

// ───────────────────────────── 冻结减速 ─────────────────────────────

/** 冻结减速的属性来源名（Stats.removeSource 按名字撤） */
export const CHILL_SOURCE = 'frost_support_chill';

interface ChillHost {
  readonly player: { readonly stats: { get(key: 'moveSpeed'): number; add(key: 'moveSpeed', value: number, source: string): void; removeSource(source: string): void } };
  readonly time: { readonly now: number };
  readonly tasks: { delay(seconds: number, fn: () => void): unknown };
}

const chillUntil = new WeakMap<object, number>();
const currentChill = new WeakMap<object, number>();

/**
 * 冻结减速：玩家移速按当前值扣掉 frac（0.7 = 减速 70%），duration 秒后撤掉。
 * 再次命中时先撤旧的再按新的比例扣（取更强的那次的比例），时长刷新；所以不会越叠越慢。
 * @returns 本次实际扣掉的移速
 */
export function chillPlayer(ctx: ChillHost, frac: number, duration: number): number {
  const stats = ctx.player.stats;
  const now = ctx.time.now;
  const active = (chillUntil.get(ctx) ?? -Infinity) > now;
  const prev = active ? currentChill.get(ctx) ?? 0 : 0;
  stats.removeSource(CHILL_SOURCE);
  const f = Math.max(prev, clamp01(frac));
  const amount = stats.get('moveSpeed') * f;
  stats.add('moveSpeed', -amount, CHILL_SOURCE);
  currentChill.set(ctx, f);
  const until = Math.max(chillUntil.get(ctx) ?? -Infinity, now + duration);
  chillUntil.set(ctx, until);
  ctx.tasks.delay(until - now + 1e-3, () => {
    if ((chillUntil.get(ctx) ?? 0) > ctx.time.now) return;
    stats.removeSource(CHILL_SOURCE);
    currentChill.delete(ctx);
  });
  return amount;
}
