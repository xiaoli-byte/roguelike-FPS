/**
 * 魔刀千刃的专用特效（IBladeFx，docs/demon-blade.md 第 8、10.8 节）：
 *
 *  - slashArc：挥砍弧光（BladeArcs：新月面片 + 外缘刃光带）
 *  - slashHit：垂直于斩击方向的扇形火花 + 一道小新月刀痕；重击加光团与地面环
 *  - mark：刃印——6 柄小刃绕敌人身体中心旋转（刃尖朝内），下方一圈细刃光环，脉动；跟随敌人（clearMarks 让它们淡出）
 *  - impale：千刃贯穿——28 柄刃光从上半球 4–6 米处错开射入身体中心（刃印的 6 柄从环上收入），到齐时爆闪；
 *    目标在视野外时刃群改从玩家眼前上方出发、掠过头顶射向它
 *  - dashTrail：突进残影（人形光片）+ 前方迎面掠过的风压线 + 两侧气流带 + 灵光尘
 *  - recall：飞刃召回——小刃片沿弧线飞向第一人称枪口（目标点相对主相机，玩家移动也能飞进刀里）
 *
 * 飞行中的刃片（贯穿 / 召回 / 刃印）共用一个 InstancedMesh（十字交叉的菱形刃光，加法混合），
 * 拖尾、刀痕、光环与风压线写进 FxSystem 的 RibbonBatch。所有池在构造时建好，热路径零分配；
 * 暂停时 FxSystem 传入 dt = 0（只渲染不推进）。
 */
import * as THREE from 'three';
import type { GameContext, IBladeFx, IEnemy } from '../core/types';
import { BladeArcs } from './BladeArcs';
import type { FlashEffects } from './Flash';
import type { GroundEffects } from './Ground';
import { STYLE_GLOW, STYLE_MOTE, STYLE_SPARK, type ParticlePool } from './Particles';
import type { RibbonBatch } from './Ribbons';
import type { SparkStreaks } from './Sparks';
import { ORDER_GLOW, WHITE, hexToColor, jitter, mixColor, rand, randomDir } from './shared';

/** 飞行刃片池（贯穿 + 召回）与渲染实例上限（再加刃印的 6 × MARKS） */
const DARTS = 512;
const MARKS = 24;
const MARK_BLADES = 6;
const INSTANCES = DARTS + MARKS * MARK_BLADES;
const CUTS = 24;
const WINDS = 40;
const GHOSTS = 6;
const GROUPS = 32;

/**
 * 贯穿：每名敌人的刃数、起点球壳半径、错开出发、飞行时长（出发后 0.1–0.16 秒到齐；BladeSkill 提前 IMPALE_LEAD 0.13 秒调用，
 * 刃群在伤害那一帧前后约 30 毫秒内命中）；刃印的 6 柄从环上收入，时长与主刃群一致
 */
const IMPALE_BLADES = 28;
const IMPALE_R0 = 4;
const IMPALE_R1 = 6;
const IMPALE_STAGGER = 0.03;
const IMPALE_FLY0 = 0.1;
const IMPALE_FLY1 = 0.13;
const IMPALE_MARK_FLY0 = 0.1;
const IMPALE_MARK_FLY1 = 0.12;
/**
 * 目标在视野外（与相机前向夹角 > 55°，16:9 下水平视野约 ±56°）时，刃群从玩家眼前上方出发、掠过头顶射向身后的目标：
 * 起点 = 相机 + 前向 × [2.5, 4] + 上 × [0.8, 2.4] + 右 × [−3, 3]
 */
const OFFSCREEN_COS = Math.cos((55 * Math.PI) / 180);
/** 刃光的混白（加法混合在亮色关卡会把主题色洗成白 / 粉，保持低混白） */
const HOT_WHITE = 0.3;
/** 刃印：环半径 = 敌人半径 + MARK_GAP；转速；淡入淡出 */
const MARK_GAP = 0.35;
const MARK_SPIN = 6;
const MARK_FADE = 0.1;
/** 召回：每次最多的刃片数、飞行时长、错开出发 */
const RECALL_MAX = 8;
const RECALL_FLY0 = 0.2;
const RECALL_FLY1 = 0.3;
const RECALL_STAGGER = 0.06;
/** 突进：残影间隔 / 寿命 / 尺寸，风压线寿命 */
const GHOST_GAP = 0.04;
const GHOST_LIFE = 0.3;
const GHOST_W = 0.9;
const GHOST_H = 1.8;
const WIND_LIFE = 0.18;

const KIND_IMPALE = 0;
const KIND_RECALL = 1;

interface Dart {
  active: boolean;
  kind: number;
  age: number;
  delay: number;
  dur: number;
  /** 起点（世界） */
  sx: number; sy: number; sz: number;
  /** 终点：贯穿为世界坐标；召回为主相机本地坐标 */
  ex: number; ey: number; ez: number;
  /** 召回弧线控制点相对两端中点的偏移（世界） */
  ox: number; oy: number; oz: number;
  /** 当前位置与上一位置（拖尾方向） */
  px: number; py: number; pz: number;
  qx: number; qy: number; qz: number;
  color: THREE.Color;
  size: number;
  /** 贯穿组下标（到达时计数） */
  group: number;
  moved: boolean;
}

interface Mark {
  active: boolean;
  enemy: IEnemy | null;
  life: number;
  age: number;
  /** 淡出计时（< 0 = 未在淡出） */
  fade: number;
  phase: number;
  color: THREE.Color;
  /** 最近一次的环心与半径（贯穿时刃印的刃片从这里射入） */
  cx: number; cy: number; cz: number;
  r: number;
}

interface Cut {
  active: boolean;
  x: number; y: number; z: number;
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  radius: number;
  rot: number;
  age: number;
  life: number;
  width: number;
  color: THREE.Color;
}

interface Wind {
  active: boolean;
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  age: number;
  life: number;
  width: number;
  color: THREE.Color;
}

interface Ghost {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  active: boolean;
  age: number;
  stamp: number;
}

interface ImpaleGroup {
  active: boolean;
  x: number; y: number; z: number;
  radius: number;
  color: number;
  /** 爆闪时刻（BladeFx 内部时间） */
  at: number;
}

export interface BladeFxDeps {
  glow: ParticlePool;
  sparks: SparkStreaks;
  ground: GroundEffects;
  flashes: FlashEffects;
}

// ───────────── 共享资源（模块级，永不释放） ─────────────

let bladeGeo: THREE.BufferGeometry | null = null;

/**
 * 刃光几何：两片十字交叉的菱形（XZ 与 YZ 平面），刃尖朝 +Z、长 1；顶点色从刃尖（亮）到尾端（暗），
 * 任意角度都看得到。实例色乘在顶点色上（加法混合下即亮度）。
 */
function getBladeGeo(): THREE.BufferGeometry {
  if (bladeGeo) return bladeGeo;
  const w = 0.09, mid = -0.08;
  const p = [
    0, 0, 0.5, w, 0, mid, 0, 0, -0.5, -w, 0, mid,
    0, 0, 0.5, 0, w, mid, 0, 0, -0.5, 0, -w, mid,
  ];
  const c = [1, 1, 1, 0.75, 0.75, 0.75, 0.12, 0.12, 0.12, 0.75, 0.75, 0.75];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute([...c, ...c], 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  g.computeBoundingSphere();
  bladeGeo = g;
  return g;
}

let ghostTex: THREE.DataTexture | null = null;

/** 残影贴图：头 + 躯干 + 双腿的柔和人形（白色，alpha 衰减） */
function getGhostTexture(): THREE.DataTexture {
  if (ghostTex) return ghostTex;
  const W = 32, H = 64;
  const data = new Uint8Array(W * H * 4);
  const capsule = (px: number, py: number, ax: number, ay: number, bx: number, by: number, r: number): number => {
    const vx = bx - ax, vy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(px - ax - vx * t, py - ay - vy * t) - r;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 归一化：u ∈ [−0.5, 0.5]（宽 0.9 米），v ∈ [0, 1]（自脚底向上 1.8 米）
      const u = ((x + 0.5) / W - 0.5) * 0.5, v = 1 - (y + 0.5) / H;
      const d = Math.min(
        Math.hypot(u, v - 0.86) - 0.075,
        capsule(u, v, 0, 0.5, 0, 0.72, 0.1),
        capsule(u, v, -0.05, 0.05, -0.04, 0.48, 0.045),
        capsule(u, v, 0.05, 0.05, 0.04, 0.48, 0.045),
        capsule(u, v, -0.13, 0.48, -0.1, 0.72, 0.035),
        capsule(u, v, 0.13, 0.48, 0.1, 0.72, 0.035),
      );
      const a = Math.max(0, Math.min(1, 1 - d / 0.06)) * (0.55 + 0.45 * Math.max(0, Math.min(1, -d / 0.05)));
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  ghostTex = tex;
  return tex;
}

// ───────────── 临时量 ─────────────

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const _camPos = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _hot = new THREE.Color();

/** 与 n 垂直的一组正交基（a, b） */
function basis(n: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): void {
  if (Math.abs(n.y) < 0.9) a.set(0, 1, 0);
  else a.set(1, 0, 0);
  a.addScaledVector(n, -a.dot(n)).normalize();
  b.crossVectors(n, a);
}

export class BladeFx implements IBladeFx {
  readonly group = new THREE.Group();
  private readonly arcs = new BladeArcs();
  private readonly blades: THREE.InstancedMesh;
  private readonly colorAttr: THREE.InstancedBufferAttribute;
  private readonly darts: Dart[] = [];
  private readonly marks: Mark[] = [];
  private readonly cuts: Cut[] = [];
  private readonly winds: Wind[] = [];
  private readonly ghosts: Ghost[] = [];
  private readonly groups: ImpaleGroup[] = [];
  private dartCursor = 0;
  private cutCursor = 0;
  private windCursor = 0;
  private ghostStamp = 0;
  private lastGhost = -99;
  private time = 0;
  private instCount = 0;

  constructor(private readonly ctx: GameContext, private readonly deps: BladeFxDeps) {
    this.group.name = 'fx.blade';
    this.group.add(this.arcs.group);

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false, fog: false,
    });
    this.blades = new THREE.InstancedMesh(getBladeGeo(), mat, INSTANCES);
    this.blades.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(INSTANCES * 3), 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.blades.instanceColor = this.colorAttr;
    this.blades.count = 0;
    this.blades.frustumCulled = false;
    this.blades.renderOrder = ORDER_GLOW + 1;
    this.blades.name = 'fx.bladeShards';
    this.group.add(this.blades);

    for (let i = 0; i < DARTS; i++) {
      this.darts.push({
        active: false, kind: 0, age: 0, delay: 0, dur: 1, sx: 0, sy: 0, sz: 0, ex: 0, ey: 0, ez: 0, ox: 0, oy: 0, oz: 0,
        px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, color: new THREE.Color(), size: 1, group: -1, moved: false,
      });
    }
    for (let i = 0; i < MARKS; i++) {
      this.marks.push({ active: false, enemy: null, life: 0, age: 0, fade: -1, phase: 0, color: new THREE.Color(), cx: 0, cy: 0, cz: 0, r: 1 });
    }
    for (let i = 0; i < CUTS; i++) {
      this.cuts.push({ active: false, x: 0, y: 0, z: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, radius: 0.3, rot: 0, age: 0, life: 0.14, width: 0.05, color: new THREE.Color() });
    }
    for (let i = 0; i < WINDS; i++) {
      this.winds.push({ active: false, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, age: 0, life: WIND_LIFE, width: 0.015, color: new THREE.Color() });
    }
    for (let i = 0; i < GHOSTS; i++) {
      const gm = new THREE.SpriteMaterial({
        map: getGhostTexture(), color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
      });
      const sprite = new THREE.Sprite(gm);
      sprite.center.set(0.5, 0);
      sprite.scale.set(GHOST_W, GHOST_H, 1);
      sprite.visible = false;
      sprite.renderOrder = ORDER_GLOW - 2;
      this.group.add(sprite);
      this.ghosts.push({ sprite, mat: gm, active: false, age: 0, stamp: 0 });
    }
    for (let i = 0; i < GROUPS; i++) this.groups.push({ active: false, x: 0, y: 0, z: 0, radius: 1, color: 0, at: 0 });
  }

  /** 画质系数（低画质减少数量） */
  private density(): number {
    const q = this.ctx.settings.quality;
    return q === 'low' ? 0.5 : q === 'medium' ? 0.75 : 1;
  }

  private groundBelow(p: THREE.Vector3): number {
    const g = this.ctx.world.groundHeight(p.x, p.z, p.y + 0.1);
    return Number.isFinite(g) ? g : (this.ctx.stage?.arena?.floorY ?? 0);
  }

  // ───────────── IBladeFx ─────────────

  slashArc(origin: THREE.Vector3, yaw: number, pitch: number, segment: number, range: number, halfAngle: number, color: number): void {
    this.arcs.spawn(origin, yaw, pitch, segment, range, halfAngle, color);
  }

  slashHit(point: THREE.Vector3, dir: THREE.Vector3, color: number, heavy: boolean): void {
    const { glow, sparks } = this.deps;
    hexToColor(color, _c);
    mixColor(_c, WHITE, HOT_WHITE, _hot);
    _d.copy(dir);
    if (_d.lengthSq() < 1e-8) _d.set(0, 0, -1);
    _d.normalize();
    basis(_d, _a, _b);
    const px = point.x, py = point.y, pz = point.z;
    // 垂直于斩击方向的扇形火花（约 140°，围绕一个随机方位）
    const n = Math.max(4, Math.round((heavy ? 16 : 11) * this.density()));
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const ang = base + (i / (n - 1) - 0.5) * 2.4 + jitter(0.12);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const sp = rand(6, 13) * (heavy ? 1.2 : 1);
      const fw = rand(1, 4);
      sparks.spawn(
        px, py, pz,
        (_a.x * ca + _b.x * sa) * sp + _d.x * fw, (_a.y * ca + _b.y * sa) * sp + _d.y * fw + 1, (_a.z * ca + _b.z * sa) * sp + _d.z * fw,
        i & 1 ? _c : _hot, rand(0.12, 0.3), heavy ? 0.026 : 0.02, 10,
      );
    }
    glow.spawn(STYLE_GLOW, px, py, pz, 0, 0, 0, _hot, heavy ? 0.6 : 0.36, 0.08);
    // 小新月刀痕：斜跨命中点、外扩淡出
    const cut = this.cuts[this.cutCursor];
    this.cutCursor = (this.cutCursor + 1) % CUTS;
    cut.active = true;
    cut.x = px;
    cut.y = py;
    cut.z = pz;
    cut.ax = _a.x; cut.ay = _a.y; cut.az = _a.z;
    cut.bx = _b.x; cut.by = _b.y; cut.bz = _b.z;
    cut.radius = heavy ? 0.5 : 0.36;
    cut.rot = base + Math.PI * 0.5;
    cut.age = 0;
    cut.life = heavy ? 0.18 : 0.14;
    cut.width = heavy ? 0.075 : 0.05;
    cut.color.copy(_hot);
    if (heavy) {
      glow.spawn(STYLE_GLOW, px, py, pz, 0, 0, 0, _c, 1.1, 0.13);
      _p.set(px, this.groundBelow(point), pz);
      if (py - _p.y < 2.5) this.deps.ground.ring(_p, 1.2, color, 0.3, false);
    }
  }

  mark(enemy: IEnemy, duration: number, color: number): void {
    // 同一敌人重复打印：刷新原刃印
    let m: Mark | null = null;
    for (const k of this.marks) {
      if (k.active && k.enemy === enemy) {
        m = k;
        break;
      }
    }
    if (!m) {
      for (const k of this.marks) {
        if (!k.active) {
          m = k;
          break;
        }
      }
    }
    if (!m) {
      // 满了：顶掉剩余时间最短的
      m = this.marks[0];
      for (const k of this.marks) if (k.life - k.age < m.life - m.age) m = k;
    }
    if (!(m.active && m.enemy === enemy)) {
      m.age = 0;
      m.phase = Math.random() * Math.PI * 2;
    }
    m.active = true;
    m.enemy = enemy;
    m.life = m.age + Math.max(0.1, duration);
    m.fade = -1;
    hexToColor(color, m.color);
    enemy.getBodyCenter(_p);
    m.cx = _p.x;
    m.cy = _p.y;
    m.cz = _p.z;
    m.r = enemy.radius + MARK_GAP;
  }

  impale(enemy: IEnemy, color: number): void {
    enemy.getBodyCenter(_t);
    const radius = Math.max(0.3, enemy.radius);
    const gi = this.takeGroup();
    const g = this.groups[gi];
    let latest = 0;
    // 刃印的 6 柄从环上收入（与主刃群同时到齐）
    for (const m of this.marks) {
      if (!m.active || m.enemy !== enemy) continue;
      const k0 = m.phase + m.age * MARK_SPIN;
      for (let i = 0; i < MARK_BLADES; i++) {
        const ang = k0 + (i / MARK_BLADES) * Math.PI * 2;
        _s.set(m.cx + Math.cos(ang) * m.r, m.cy + 0.15, m.cz + Math.sin(ang) * m.r);
        latest = Math.max(latest, this.launchImpale(_s, _t, color, 0, rand(IMPALE_MARK_FLY0, IMPALE_MARK_FLY1), 0.42, gi));
      }
      m.active = false;
      m.enemy = null;
    }
    // 视野外的目标：刃群从玩家眼前上方掠过头顶再射向它（否则整段贯穿都发生在屏幕外）
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    _camPos.setFromMatrixPosition(cam.matrixWorld);
    cam.getWorldDirection(_camFwd);
    _d.subVectors(_t, _camPos);
    const dl = _d.length();
    const offscreen = dl > 1e-3 && _d.dot(_camFwd) / dl < OFFSCREEN_COS;
    if (offscreen) {
      _camRight.crossVectors(_camFwd, UP);
      if (_camRight.lengthSq() < 1e-6) _camRight.set(1, 0, 0);
      _camRight.normalize();
    }
    // 四面八方（偏上半球）的千刃
    const n = Math.max(10, Math.round(IMPALE_BLADES * this.density()));
    for (let i = 0; i < n; i++) {
      if (offscreen) {
        _s.copy(_camPos)
          .addScaledVector(_camFwd, rand(2.5, 4))
          .addScaledVector(UP, rand(0.8, 2.4))
          .addScaledVector(_camRight, rand(-3, 3));
      } else {
        randomDir(_d);
        if (_d.y < -0.15) _d.y = -_d.y * 0.6;
        _d.normalize();
        const r = rand(IMPALE_R0, IMPALE_R1) + radius;
        _s.copy(_t).addScaledVector(_d, r);
      }
      latest = Math.max(latest, this.launchImpale(_s, _t, color, rand(0, IMPALE_STAGGER), rand(IMPALE_FLY0, IMPALE_FLY1), rand(0.42, 0.6), gi));
    }
    g.active = true;
    g.x = _t.x;
    g.y = _t.y;
    g.z = _t.z;
    g.radius = radius;
    g.color = color;
    g.at = this.time + latest;
  }

  /** 所有仍在显示的刃印进入淡出（技能被中止、不会贯穿时） */
  clearMarks(): void {
    for (const m of this.marks) if (m.active && m.fade < 0) m.fade = 0;
  }

  dashTrail(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const { glow } = this.deps;
    hexToColor(color, _c);
    mixColor(_c, WHITE, HOT_WHITE, _hot);
    _d.subVectors(to, from);
    _d.y = 0;
    const len = _d.length();
    if (len > 1e-4) _d.multiplyScalar(1 / len);
    else this.ctx.player.getForward(_d);
    _a.set(-_d.z, 0, _d.x); // 水平侧向
    const eyeH = Math.max(1, this.ctx.player.eye.y - this.ctx.player.position.y);
    // 残影：每 GHOST_GAP 秒最多一个，留在身后
    if (this.time - this.lastGhost >= GHOST_GAP) {
      this.lastGhost = this.time;
      const gh = this.takeGhost();
      gh.active = true;
      gh.age = 0;
      gh.stamp = ++this.ghostStamp;
      gh.sprite.position.copy(from);
      gh.mat.color.copy(_c);
      gh.mat.opacity = 0.5;
      gh.sprite.visible = true;
    }
    // 前方迎面掠过的风压线（玩家冲过它们）与两侧气流带
    const d = this.density();
    const lines = Math.max(1, Math.round(3 * d));
    for (let i = 0; i < lines; i++) {
      const side = (Math.random() < 0.5 ? -1 : 1) * rand(0.55, 1.5);
      const ahead = rand(1.5, 5);
      const h = rand(0.3, eyeH + 0.6);
      const l = rand(0.8, 1.6);
      this.addWind(
        to.x + _d.x * ahead + _a.x * side, to.y + h, to.z + _d.z * ahead + _a.z * side,
        to.x + _d.x * (ahead - l) + _a.x * side, to.y + h, to.z + _d.z * (ahead - l) + _a.z * side,
        rand(0.008, 0.018), _hot, WIND_LIFE,
      );
    }
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? -0.4 : 0.4;
      this.addWind(
        from.x + _a.x * s, from.y + eyeH * 0.62, from.z + _a.z * s,
        to.x + _a.x * s, to.y + eyeH * 0.62, to.z + _a.z * s,
        0.03, _c, 0.22,
      );
    }
    // 灵光尘
    const motes = Math.max(1, Math.round(4 * d));
    for (let i = 0; i < motes; i++) {
      const t = Math.random();
      glow.spawn(
        STYLE_MOTE,
        from.x + (to.x - from.x) * t + jitter(0.4), from.y + rand(0.2, eyeH), from.z + (to.z - from.z) * t + jitter(0.4),
        jitter(0.6), rand(0.4, 1.2), jitter(0.6), i & 1 ? _c : _hot, rand(0.05, 0.1), rand(0.3, 0.55),
      );
    }
  }

  recall(from: THREE.Vector3, to: THREE.Vector3, count: number, color: number): void {
    const n = Math.min(RECALL_MAX, Math.max(0, Math.round(count)));
    if (n <= 0) return;
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    // 终点存成主相机本地坐标：玩家移动 / 转身时仍飞进第一人称刀里
    _t.copy(to);
    cam.worldToLocal(_t);
    _d.subVectors(to, from);
    const dist = _d.length();
    if (dist > 1e-4) _d.multiplyScalar(1 / dist);
    else _d.set(0, 1, 0);
    basis(_d, _a, _b);
    hexToColor(color, _c);
    mixColor(_c, WHITE, HOT_WHITE, _hot);
    for (let i = 0; i < n; i++) {
      const dt = this.takeDart();
      dt.active = true;
      dt.kind = KIND_RECALL;
      dt.age = 0;
      dt.delay = (i / n) * RECALL_STAGGER + rand(0, 0.015);
      dt.dur = rand(RECALL_FLY0, RECALL_FLY1);
      dt.sx = from.x + jitter(0.25);
      dt.sy = from.y + jitter(0.25);
      dt.sz = from.z + jitter(0.25);
      dt.ex = _t.x;
      dt.ey = _t.y;
      dt.ez = _t.z;
      // 略带弧度：控制点偏向侧上方（各片方位错开）
      const ang = (i / n) * Math.PI * 2 + rand(0, 0.8);
      const k = Math.min(1.6, dist * 0.22);
      dt.ox = (_a.x * Math.cos(ang) + _b.x * Math.sin(ang)) * k;
      dt.oy = (_a.y * Math.cos(ang) + _b.y * Math.sin(ang)) * k + k * 0.4;
      dt.oz = (_a.z * Math.cos(ang) + _b.z * Math.sin(ang)) * k;
      dt.px = dt.qx = dt.sx;
      dt.py = dt.qy = dt.sy;
      dt.pz = dt.qz = dt.sz;
      dt.color.copy(i & 1 ? _c : _hot);
      dt.size = rand(0.2, 0.26);
      dt.group = -1;
      dt.moved = false;
    }
  }

  // ───────────── 内部 ─────────────

  private takeDart(): Dart {
    for (let k = 0; k < DARTS; k++) {
      const i = (this.dartCursor + k) % DARTS;
      if (!this.darts[i].active) {
        this.dartCursor = (i + 1) % DARTS;
        return this.darts[i];
      }
    }
    // 全满：覆盖游标处（最早发射的一批）
    const d = this.darts[this.dartCursor];
    this.dartCursor = (this.dartCursor + 1) % DARTS;
    return d;
  }

  private takeGroup(): number {
    let best = 0;
    for (let i = 0; i < GROUPS; i++) {
      if (!this.groups[i].active) return i;
      if (this.groups[i].at < this.groups[best].at) best = i;
    }
    return best;
  }

  private takeGhost(): Ghost {
    let oldest = this.ghosts[0];
    for (const g of this.ghosts) {
      if (!g.active) return g;
      if (g.stamp < oldest.stamp) oldest = g;
    }
    return oldest;
  }

  /** 发射一柄贯穿刃，返回它的到达时间（相对现在） */
  private launchImpale(start: THREE.Vector3, end: THREE.Vector3, color: number, delay: number, dur: number, size: number, group: number): number {
    const dt = this.takeDart();
    dt.active = true;
    dt.kind = KIND_IMPALE;
    dt.age = 0;
    dt.delay = delay;
    dt.dur = dur;
    dt.sx = dt.px = dt.qx = start.x;
    dt.sy = dt.py = dt.qy = start.y;
    dt.sz = dt.pz = dt.qz = start.z;
    dt.ex = end.x;
    dt.ey = end.y;
    dt.ez = end.z;
    dt.ox = dt.oy = dt.oz = 0;
    hexToColor(color, _c2);
    // 少量混白：刃群读作「千柄红刃」而不是白色火花
    mixColor(_c2, WHITE, Math.random() * 0.12, dt.color);
    dt.size = size;
    dt.group = group;
    dt.moved = false;
    return delay + dur;
  }

  private addWind(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, color: THREE.Color, life: number): void {
    const w = this.winds[this.windCursor];
    this.windCursor = (this.windCursor + 1) % WINDS;
    w.active = true;
    w.ax = ax; w.ay = ay; w.az = az;
    w.bx = bx; w.by = by; w.bz = bz;
    w.age = 0;
    w.life = life;
    w.width = width;
    w.color.copy(color);
  }

  /** 写入一个刃光实例（pos、朝向 dir（单位）、长度 size、颜色 × 亮度） */
  private pushBlade(x: number, y: number, z: number, dx: number, dy: number, dz: number, size: number, color: THREE.Color, k: number): void {
    const i = this.instCount;
    if (i >= INSTANCES || k <= 0.002) return;
    _d.set(dx, dy, dz);
    _q.setFromUnitVectors(Z_AXIS, _d);
    _s.set(size * 0.75, size * 0.75, size);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    this.blades.setMatrixAt(i, _m);
    this.colorAttr.setXYZ(i, color.r * k, color.g * k, color.b * k);
    this.instCount = i + 1;
  }

  // ───────────── 每帧 ─────────────

  /** 推进并渲染；batch 为 FxSystem 本帧的线状特效批次（begin 与 end 之间调用） */
  update(dt: number, camPos: THREE.Vector3, batch: RibbonBatch): void {
    this.time += dt;
    this.instCount = 0;
    this.arcs.update(dt);
    this.arcs.render(batch);
    this.updateDarts(dt, batch);
    this.updateMarks(dt, batch);
    this.updateGroups();
    this.updateCuts(dt, batch);
    this.updateWinds(dt, batch);
    this.updateGhosts(dt);
    // 实例数为 0 时仍保持可见（几乎零开销），换关预编译能编到它的着色器
    const n = this.instCount;
    this.blades.count = n;
    if (n > 0) {
      this.blades.instanceMatrix.clearUpdateRanges();
      this.blades.instanceMatrix.addUpdateRange(0, n * 16);
      this.blades.instanceMatrix.needsUpdate = true;
      this.colorAttr.clearUpdateRanges();
      this.colorAttr.addUpdateRange(0, n * 3);
      this.colorAttr.needsUpdate = true;
    }
    void camPos;
  }

  private updateDarts(dt: number, batch: RibbonBatch): void {
    const cam = this.ctx.camera;
    let camReady = false;
    const { glow, sparks } = this.deps;
    for (const d of this.darts) {
      if (!d.active) continue;
      d.age += dt;
      const t = (d.age - d.delay) / d.dur;
      if (t < 0) continue;
      const tc = Math.min(1, t);
      d.qx = d.px;
      d.qy = d.py;
      d.qz = d.pz;
      let ex = d.ex, ey = d.ey, ez = d.ez;
      if (d.kind === KIND_RECALL) {
        if (!camReady) {
          cam.updateMatrixWorld();
          camReady = true;
        }
        _t.set(d.ex, d.ey, d.ez).applyMatrix4(cam.matrixWorld);
        ex = _t.x;
        ey = _t.y;
        ez = _t.z;
        // 二次贝塞尔（先快后慢地收进刀里）
        const u = 1 - (1 - tc) * (1 - tc);
        const g = 1 - u;
        const cx = (d.sx + ex) * 0.5 + d.ox, cy = (d.sy + ey) * 0.5 + d.oy, cz = (d.sz + ez) * 0.5 + d.oz;
        d.px = g * g * d.sx + 2 * g * u * cx + u * u * ex;
        d.py = g * g * d.sy + 2 * g * u * cy + u * u * ey;
        d.pz = g * g * d.sz + 2 * g * u * cz + u * u * ez;
      } else {
        // 贯穿：略加速射入
        const u = tc ** 1.3;
        d.px = d.sx + (ex - d.sx) * u;
        d.py = d.sy + (ey - d.sy) * u;
        d.pz = d.sz + (ez - d.sz) * u;
      }
      if (t >= 1) {
        d.active = false;
        if (d.kind === KIND_IMPALE) {
          // 刃入体：两三点火花
          _c.copy(d.color);
          for (let k = 0; k < 2; k++) {
            randomDir(_d);
            const sp = rand(3, 8);
            sparks.spawn(ex, ey, ez, _d.x * sp, _d.y * sp + 1, _d.z * sp, _c, rand(0.08, 0.18), 0.018, 8);
          }
        } else {
          glow.spawn(STYLE_GLOW, ex, ey, ez, 0, 0, 0, d.color, 0.05, 0.06);
        }
        continue;
      }
      // 朝向：沿运动方向（刚出发时朝终点）
      let vx = d.px - d.qx, vy = d.py - d.qy, vz = d.pz - d.qz;
      let vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (vl < 1e-5) {
        vx = ex - d.px;
        vy = ey - d.py;
        vz = ez - d.pz;
        vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      } else {
        d.moved = true;
      }
      vx /= vl;
      vy /= vl;
      vz /= vl;
      const fadeIn = Math.min(1, (d.age - d.delay) / 0.03);
      this.pushBlade(d.px, d.py, d.pz, vx, vy, vz, d.size, d.color, fadeIn);
      // 拖尾：刃后一道细光
      const tail = d.kind === KIND_RECALL ? 0.35 : 1.1;
      const w = d.kind === KIND_RECALL ? 0.018 : 0.032;
      const c = d.color;
      batch.quad(
        d.px - vx * tail * Math.min(1, t * 3), d.py - vy * tail * Math.min(1, t * 3), d.pz - vz * tail * Math.min(1, t * 3),
        d.px, d.py, d.pz, w * 0.2, w, c.r, c.g, c.b, 0, 0.75 * fadeIn,
      );
    }
  }

  private updateMarks(dt: number, batch: RibbonBatch): void {
    for (const m of this.marks) {
      if (!m.active) continue;
      m.age += dt;
      const e = m.enemy;
      if (m.fade < 0 && (!e || !e.alive || e.removed || m.age >= m.life)) m.fade = 0;
      if (m.fade >= 0) {
        m.fade += dt;
        if (m.fade >= MARK_FADE) {
          m.active = false;
          m.enemy = null;
          continue;
        }
      }
      if (e && !e.removed) {
        e.getBodyCenter(_p);
        m.cx = _p.x;
        m.cy = _p.y;
        m.cz = _p.z;
        m.r = e.radius + MARK_GAP;
      }
      const k = Math.min(1, m.age / MARK_FADE) * (m.fade >= 0 ? 1 - m.fade / MARK_FADE : 1);
      const pulse = 1 + 0.12 * Math.sin(m.age * 12 + m.phase);
      const r = m.r * pulse;
      const spin = m.phase + m.age * MARK_SPIN;
      const size = (0.3 + Math.min(0.3, m.r * 0.12)) * pulse;
      const bob = Math.sin(m.age * 5 + m.phase) * 0.05;
      mixColor(m.color, WHITE, 0.08 + 0.12 * Math.max(0, Math.sin(m.age * 12 + m.phase)), _hot);
      for (let i = 0; i < MARK_BLADES; i++) {
        const ang = spin + (i / MARK_BLADES) * Math.PI * 2;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        // 刃尖朝内、略向下指着敌人
        const dx = -ca, dy = -0.35, dz = -sa;
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
        this.pushBlade(m.cx + ca * r, m.cy + 0.15 + bob, m.cz + sa * r, dx / l, dy / l, dz / l, size, _hot, k * 0.9);
      }
      // 细刃光环
      const q = 14;
      const ry = m.cy - 0.05 + bob;
      let px = m.cx + r, pz = m.cz;
      for (let i = 1; i <= q; i++) {
        const ang = (i / q) * Math.PI * 2;
        const x = m.cx + Math.cos(ang) * r, z = m.cz + Math.sin(ang) * r;
        batch.quad(px, ry, pz, x, ry, z, 0.018, 0.018, m.color.r, m.color.g, m.color.b, 0.4 * k, 0.4 * k);
        px = x;
        pz = z;
      }
    }
  }

  /** 贯穿组：刃到齐时爆闪 + 火花爆散 + 地面环 */
  private updateGroups(): void {
    const { glow, sparks, ground, flashes } = this.deps;
    for (const g of this.groups) {
      if (!g.active || this.time < g.at) continue;
      g.active = false;
      hexToColor(g.color, _c);
      mixColor(_c, WHITE, HOT_WHITE, _hot);
      _p.set(g.x, g.y, g.z);
      const s = 0.8 + g.radius;
      glow.spawn(STYLE_GLOW, g.x, g.y, g.z, 0, 0, 0, _hot, s * 1.1, 0.09);
      glow.spawn(STYLE_GLOW, g.x, g.y, g.z, 0, 0, 0, _c, s * 2, 0.16);
      flashes.sphere(_p, s * 0.2, s * 0.9, g.color, 0.18);
      const n = Math.max(8, Math.round(26 * this.density()));
      for (let i = 0; i < n; i++) {
        randomDir(_d);
        const sp = rand(8, 18);
        sparks.spawn(g.x, g.y, g.z, _d.x * sp, _d.y * sp + 2, _d.z * sp, i % 3 === 0 ? _hot : _c, rand(0.2, 0.45), 0.026, 12);
      }
      for (let i = 0; i < 6; i++) {
        randomDir(_d);
        glow.spawn(STYLE_SPARK, g.x, g.y, g.z, _d.x * 4, _d.y * 4 + 2, _d.z * 4, _hot, rand(0.07, 0.12), rand(0.3, 0.5), 8);
      }
      _p.y = this.groundBelow(_p);
      if (g.y - _p.y < 3) ground.ring(_p, 1.6 + g.radius, g.color, 0.35, false);
      if (this.ctx.settings.quality !== 'low') {
        _p.y = g.y;
        flashes.light(_p, g.color, 30, 6, 0.22);
      }
    }
  }

  private updateCuts(dt: number, batch: RibbonBatch): void {
    for (const c of this.cuts) {
      if (!c.active) continue;
      c.age += dt;
      const t = c.age / c.life;
      if (t >= 1) {
        c.active = false;
        continue;
      }
      const r = c.radius * (0.6 + 0.4 * (1 - (1 - t) * (1 - t)));
      const alpha = (1 - t) * (1 - t);
      const q = 6;
      let px = 0, py = 0, pz = 0, pw = 0;
      for (let i = 0; i <= q; i++) {
        const s = i / q;
        const ang = c.rot + (s - 0.5) * 1.7;
        const ca = Math.cos(ang) * r, sa = Math.sin(ang) * r;
        // 新月：圆弧中段略向外鼓
        const x = c.x + c.ax * ca + c.bx * sa, y = c.y + c.ay * ca + c.by * sa, z = c.z + c.az * ca + c.bz * sa;
        const w = c.width * Math.sin(Math.PI * s);
        if (i > 0) batch.quad(px, py, pz, x, y, z, pw, w, c.color.r, c.color.g, c.color.b, alpha, alpha);
        px = x;
        py = y;
        pz = z;
        pw = w;
      }
    }
  }

  private updateWinds(dt: number, batch: RibbonBatch): void {
    for (const w of this.winds) {
      if (!w.active) continue;
      w.age += dt;
      const t = w.age / w.life;
      if (t >= 1) {
        w.active = false;
        continue;
      }
      const a = Math.sin(Math.PI * Math.min(1, t * 1.4)) * 0.55;
      batch.quad(w.ax, w.ay, w.az, w.bx, w.by, w.bz, w.width * 0.3, w.width, w.color.r, w.color.g, w.color.b, 0, a);
    }
  }

  private updateGhosts(dt: number): void {
    for (const g of this.ghosts) {
      if (!g.active) continue;
      g.age += dt;
      const t = g.age / GHOST_LIFE;
      if (t >= 1) {
        g.active = false;
        g.sprite.visible = false;
        continue;
      }
      g.mat.opacity = 0.5 * (1 - t) * (1 - t);
      g.sprite.scale.set(GHOST_W * (1 + 0.15 * t), GHOST_H * (1 + 0.05 * t), 1);
    }
  }

  clear(): void {
    this.arcs.clear();
    for (const d of this.darts) d.active = false;
    for (const m of this.marks) {
      m.active = false;
      m.enemy = null;
    }
    for (const c of this.cuts) c.active = false;
    for (const w of this.winds) w.active = false;
    for (const g of this.ghosts) {
      g.active = false;
      g.sprite.visible = false;
    }
    for (const g of this.groups) g.active = false;
    this.instCount = 0;
    this.blades.count = 0;
    this.lastGhost = -99;
  }
}
