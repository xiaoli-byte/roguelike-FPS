/**
 * 关卡生成（纯数据）：盒子列表 + 外观种类 + 装饰点 + 各类关键点。
 *
 * 规范坐标系：玩家出生在 +Z 一侧、朝 -Z（yaw = 0），出口传送门在 -Z 远端；
 * 生成完毕后整体随机旋转 k·90°，再做连通性校验（泛洪），失败时移除挡路的障碍组或重生成。
 * 同一个 Rng（同种子）得到完全相同的布局。
 */
import type { Rng } from '../core/Rng';
import type { StageNode, ThemeId } from '../core/types';
import { finalizeLights, removeGroup, rotateLayout, validateAndRepair } from './LevelCheck';
import type { BoxLook, Deco, DecoKind, LevelLayout, P2 } from './LevelTypes';
import { themeStyle } from './Themes';

export type { BoxLook, Deco, DecoKind, LayoutBox, LevelLayout, P2, RuneMark } from './LevelTypes';

interface Rect { x0: number; z0: number; x1: number; z1: number }
interface Circle { x: number; z: number; r: number }

export const WALL_T = 2;
const STEP_RISE = 0.4;
const STEP_DEPTH = 0.65;
const COVER_GAP = 2.2;
const TAU = Math.PI * 2;

// ───────────────────────────── 几何小工具 ─────────────────────────────

function rectC(cx: number, cz: number, sx: number, sz: number): Rect {
  return { x0: cx - sx / 2, z0: cz - sz / 2, x1: cx + sx / 2, z1: cz + sz / 2 };
}

function union(a: Rect, b: Rect): Rect {
  return { x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) };
}

function rectDist(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dz = Math.max(0, a.z0 - b.z1, b.z0 - a.z1);
  return Math.hypot(dx, dz);
}

function pointRectDist(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

function dist(a: P2, b: P2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** 吸附到 1 米格中心（边界为整数时格中心在 k + 0.5） */
function snap(v: number): number {
  return Math.floor(v) + 0.5;
}

/** 墙面上的点：side 0=北(-Z) 1=南(+Z) 2=西(-X) 3=东(+X)；t 沿墙坐标，o 离墙距离 */
function wallPoint(H: number, side: number, t: number, o: number): P2 {
  switch (side) {
    case 0: return { x: t, z: -H + o };
    case 1: return { x: t, z: H - o };
    case 2: return { x: -H + o, z: t };
    default: return { x: H - o, z: t };
  }
}

/** 面向场内的 yaw（模型 +Z 指向场内） */
const WALL_YAW = [0, Math.PI, Math.PI / 2, -Math.PI / 2];

// ───────────────────────────── 生成器 ─────────────────────────────

type CoverKind = 'crate' | 'lowWall' | 'ruin' | 'pillar' | 'stele' | 'statue' | 'cactus' | 'pine' | 'crystal' | 'spike';

const COVER_WEIGHTS: Record<ThemeId, [CoverKind, number][]> = {
  desert: [['crate', 3], ['lowWall', 3], ['ruin', 2], ['pillar', 2], ['stele', 1], ['statue', 1.2], ['cactus', 1]],
  frost: [['crate', 2], ['lowWall', 3], ['pillar', 2.5], ['stele', 1.2], ['pine', 2], ['crystal', 1.3]],
  inferno: [['crate', 1.5], ['lowWall', 3], ['ruin', 2.5], ['pillar', 2], ['stele', 1], ['spike', 2], ['crystal', 1]],
};

type WallPropKind = 'cactus' | 'statue' | 'pots' | 'dune' | 'pine' | 'crystal' | 'snowdrift' | 'spike' | 'rock';

const WALL_PROPS: Record<ThemeId, [WallPropKind, number][]> = {
  desert: [['cactus', 3], ['statue', 1], ['pots', 1.5], ['dune', 3]],
  frost: [['pine', 4], ['crystal', 1.5], ['snowdrift', 3]],
  inferno: [['spike', 3], ['crystal', 1.5], ['rock', 2]],
};

/** 带碰撞的装饰：足迹边长与高度 */
const PROP_COLLIDER: Partial<Record<DecoKind, [number, number]>> = {
  cactus: [0.8, 3.0],
  statue: [1.9, 2.9],
  pine: [1.7, 4.6],
  crystal: [1.4, 2.4],
  spike: [1.7, 3.0],
  brazier: [0.9, 1.1],
  stoneLantern: [1.0, 2.3],
  lanternPost: [0.4, 3.4],
};

/** 带碰撞装饰的足迹边长（随缩放增大，上限 1.25 倍） */
function propSize(kind: DecoKind, s: number): number {
  const c = PROP_COLLIDER[kind];
  return c ? c[0] * Math.min(1.25, s) : 0;
}

/** 贴墙道具碰撞体与墙面之间留的缝（小于可走阈值，且让开 0.5 米深的壁柱） */
const WALL_SLOT = 0.55;
/** 贴墙道具与场内障碍的最小间距（保证大体型敌人能通过） */
const PROP_GAP = 2.0;

class Gen {
  readonly L: LevelLayout;
  readonly H: number;
  private occ: { r: Rect; g: number }[] = [];
  private reserved: Circle[] = [];
  private nextGroup = 1;
  private pilasters: number[][] = [[], [], [], []];
  private gateHalf: number;
  private hasPavilion = false;

  constructor(private rng: Rng, private stage: StageNode) {
    const type = stage.type;
    const H = type === 'boss' ? 32 : type === 'treasure' ? 18 : type === 'shop' ? 19 : 28;
    this.H = H;
    this.gateHalf = H >= 28 ? 4.2 : 3.4;
    const st = themeStyle(stage.theme);
    const zero = (): P2 => ({ x: 0, z: 0 });
    this.L = {
      type, theme: stage.theme, half: H,
      minX: -H, minZ: -H, maxX: H, maxZ: H, floorY: 0,
      wallThickness: WALL_T, wallHeight: st.wallHeight,
      boxes: [], decos: [], lights: [], runes: [],
      playerSpawn: zero(), playerYaw: 0, spawnPoints: [],
      rewardPoint: zero(), portalPoints: [], shopPoint: zero(), bossPoint: zero(), center: zero(),
      checks: [],
    };
  }

  run(): LevelLayout {
    this.perimeter();
    this.keyPoints();
    this.lights();
    switch (this.stage.type) {
      case 'combat':
      case 'elite':
        this.combat(this.stage.type === 'elite');
        break;
      case 'boss':
        this.boss();
        break;
      case 'treasure':
        this.treasure();
        break;
      case 'shop':
        this.shop();
        break;
    }
    this.cornerClusters();
    this.wallProps();
    this.wallBanners();
    if (this.stage.type === 'combat' || this.stage.type === 'elite' || this.stage.type === 'boss') this.spawnPoints();
    return this.L;
  }

  // ───────────── 基础 ─────────────

  private group(): number {
    return this.nextGroup++;
  }

  private box(look: BoxLook, tag: string, g: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, noRaycast = false): void {
    this.L.boxes.push({
      minX: Math.min(x0, x1), minY: Math.min(y0, y1), minZ: Math.min(z0, z1),
      maxX: Math.max(x0, x1), maxY: Math.max(y0, y1), maxZ: Math.max(z0, z1),
      look, tag, group: g, noRaycast, v: this.rng.next(),
    });
  }

  private deco(kind: DecoKind, x: number, z: number, o: Partial<Deco> = {}): Deco {
    const d: Deco = {
      kind, x, z, y: o.y ?? 0, yaw: o.yaw ?? 0, s: o.s ?? 1, w: o.w ?? 1, h: o.h ?? 1,
      v: this.rng.next(), group: o.group ?? 0, lit: o.lit ?? false,
    };
    this.L.decos.push(d);
    return d;
  }

  /**
   * 矩形能否放下：在内圈边界内、与已占用矩形间距 >= gap（与围墙结构的间距 >= structGap）、不侵入保留圆。
   * 贴墙道具用很小的 structGap 紧贴墙体 / 壁柱，避免留下只有小怪能钻的窄缝。
   */
  private fits(r: Rect, gap: number, inner = 3.5, structGap = gap): boolean {
    const H = this.H;
    if (r.x0 < -H + inner || r.x1 > H - inner || r.z0 < -H + inner || r.z1 > H - inner) return false;
    for (const o of this.occ) if (rectDist(r, o.r) < (o.g === 0 ? structGap : gap)) return false;
    for (const c of this.reserved) if (pointRectDist(c.x, c.z, r) < c.r) return false;
    return true;
  }

  private occupy(r: Rect, g: number): void {
    this.occ.push({ r, g });
  }

  /** 点离保留圆与已占用区域是否足够远（纯装饰用） */
  private clearAt(x: number, z: number, pad: number): boolean {
    for (const c of this.reserved) if (Math.hypot(c.x - x, c.z - z) < c.r + pad * 0.5) return false;
    for (const o of this.occ) if (pointRectDist(x, z, o.r) < pad) return false;
    return true;
  }

  /** 带碰撞体的装饰道具 */
  private propWithCollider(kind: DecoKind, x: number, z: number, gap: number, inner: number, o: Partial<Deco> = {}, structGap = gap): boolean {
    const c = PROP_COLLIDER[kind];
    if (!c) return false;
    const s = o.s ?? 1;
    const size = propSize(kind, s);
    const r = rectC(x, z, size, size);
    if (!this.fits(r, gap, inner, structGap)) return false;
    const g = o.group ?? this.group();
    this.box('collider', 'prop', g, r.x0, 0, r.z0, r.x1, c[1] * s, r.z1);
    this.occupy(r, g);
    this.deco(kind, x, z, { ...o, group: g });
    return true;
  }

  // ───────────── 围墙 / 关键点 / 灯 ─────────────

  private perimeter(): void {
    const H = this.H;
    const T = WALL_T;
    const wh = this.L.wallHeight;
    // 四面墙（内侧面恰为竞技场边界）
    const walls: [number, number, number, number][] = [
      [-H - T, -H - T, H + T, -H],
      [-H - T, H, H + T, H + T],
      [-H - T, -H, -H, H],
      [H, -H, H + T, H],
    ];
    for (const [x0, z0, x1, z1] of walls) {
      this.box('wall', 'wall', 0, x0, 0, z0, x1, wh, z1);
      // 墙顶以上的空气墙：防止跳出界，不挡射线
      this.box('invisible', 'wall', 0, x0, wh, z0, x1, 40, z1, true);
    }
    // 角楼（向内突出 1.2 米）
    const tw = 1.2;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x0 = sx < 0 ? -H - T - 0.6 : H - tw;
        const x1 = sx < 0 ? -H + tw : H + T + 0.6;
        const z0 = sz < 0 ? -H - T - 0.6 : H - tw;
        const z1 = sz < 0 ? -H + tw : H + T + 0.6;
        this.box('tower', 'wall', 0, x0, 0, z0, x1, wh + 3, z1);
        this.occupy({ x0, z0, x1, z1 }, 0);
      }
    }
    // 壁柱
    const count = Math.max(3, Math.round((2 * H - 8) / 7) + 1);
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < count; i++) {
        const t = -H + 4 + (i * (2 * H - 8)) / (count - 1);
        if (side === 0 && Math.abs(t) < this.gateHalf + 1.6) continue;
        if (side === 1 && Math.abs(t) < 3.4) continue;
        const a = wallPoint(H, side, t - 0.5, 0);
        const b = wallPoint(H, side, t + 0.5, 0.5);
        const r: Rect = { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) };
        this.box('pilaster', 'wall', 0, r.x0, 0, r.z0, r.x1, wh + 0.4, r.z1);
        this.occupy(r, 0);
        this.pilasters[side].push(t);
      }
    }
    // 远端大门（牌楼）：两根门柱有碰撞，其余为装饰
    const gh = Math.min(7.2, wh - 1);
    for (const sx of [-1, 1]) {
      const cx = sx * this.gateHalf;
      this.box('gatePillar', 'pillar', 0, cx - 0.6, 0, -H, cx + 0.6, gh, -H + 1.2);
      this.occupy({ x0: cx - 0.6, z0: -H, x1: cx + 0.6, z1: -H + 1.2 }, 0);
    }
    this.deco('gate', 0, -H, { yaw: 0, w: this.gateHalf, h: gh });
    // 入口（出生点背后的紧闭大门）
    this.deco('door', 0, H, { yaw: Math.PI, w: 2.2, h: Math.min(5, wh - 2.5) });
  }

  private keyPoints(): void {
    const H = this.H;
    const L = this.L;
    const rng = this.rng;
    const type = this.stage.type;
    const small = type === 'treasure' || type === 'shop';
    L.playerSpawn = { x: snap(rng.range(-3, 3)), z: snap(H - (small ? 3.5 : 4.5)) };
    L.playerYaw = 0;
    const spacing = type === 'boss' ? 12 : small ? 7 : 11;
    const pz = -H + (small ? 4 : 4.5);
    L.portalPoints = [{ x: -spacing, z: pz + 0.4 }, { x: 0, z: pz }, { x: spacing, z: pz + 0.4 }];
    switch (type) {
      case 'boss':
        L.rewardPoint = { x: 0, z: 2 };
        L.bossPoint = { x: 0, z: -9 };
        break;
      case 'treasure':
        L.rewardPoint = { x: 0, z: -1.5 };
        break;
      case 'shop':
        L.rewardPoint = { x: 0, z: 7.5 };
        L.shopPoint = { x: 0, z: -2.5 };
        break;
      default:
        L.rewardPoint = { x: rng.range(-2.5, 2.5), z: rng.range(-3, 1.5) };
    }
    if (type !== 'shop') L.shopPoint = { ...L.rewardPoint };

    const res = this.reserved;
    res.push({ x: L.playerSpawn.x, z: L.playerSpawn.z, r: small ? 3.5 : 4.5 });
    res.push({ x: L.rewardPoint.x, z: L.rewardPoint.z, r: 3.2 });
    for (const p of L.portalPoints) res.push({ x: p.x, z: p.z, r: 3.8 });
    if (type === 'shop') res.push({ x: L.shopPoint.x, z: L.shopPoint.z, r: 8.5 });
    if (type === 'boss') res.push({ x: L.bossPoint.x, z: L.bossPoint.z, r: 4.5 });
  }

  /** 4 个带点光源的火盆 / 灯笼 */
  private lights(): void {
    const H = this.H;
    const L = this.L;
    const type = this.stage.type;
    const kind: DecoKind = type === 'shop' ? 'lanternPost' : this.stage.theme === 'frost' ? 'stoneLantern' : 'brazier';
    let spots: P2[];
    if (type === 'boss') {
      spots = [{ x: -13, z: -13 }, { x: 13, z: -13 }, { x: -13, z: 13 }, { x: 13, z: 13 }];
    } else if (type === 'treasure') {
      const r = L.rewardPoint;
      spots = [{ x: r.x - 5.5, z: r.z - 5.5 }, { x: r.x + 5.5, z: r.z - 5.5 }, { x: r.x - 5.5, z: r.z + 5.5 }, { x: r.x + 5.5, z: r.z + 5.5 }];
    } else if (type === 'shop') {
      const s = L.shopPoint;
      spots = [{ x: -9.6, z: s.z - 5 }, { x: 9.6, z: s.z - 5 }, { x: -9.6, z: s.z + 5 }, { x: 9.6, z: s.z + 5 }];
    } else {
      // 远端大门两侧（紧贴门柱）+ 出生点一侧的两面侧墙（紧贴墙面）
      const half = propSize(kind, 1) / 2;
      const gx = this.gateHalf + 0.6 + half + 0.05;
      const off = WALL_SLOT + half;
      spots = [{ x: -gx, z: -H + off }, { x: gx, z: -H + off }, { x: -(H - off), z: H * 0.22 }, { x: H - off, z: H * 0.22 }];
    }
    for (const p of spots) {
      const yaw = Math.atan2(-p.x, -p.z);
      // 与保留圆冲突时沿着朝中心方向微调
      for (let k = 0; k < 6; k++) {
        const nx = p.x * (1 - k * 0.06);
        const nz = p.z * (1 - k * 0.06);
        if (this.propWithCollider(kind, nx, nz, PROP_GAP, 0.05, { yaw, lit: true }, 0.04)) break;
      }
    }
  }

  // ───────────── 战斗关 ─────────────

  private combat(elite: boolean): void {
    const rng = this.rng;
    const H = this.H;
    // 高台
    const nPlat = elite ? rng.int(2, 3) : rng.int(2, 4);
    const anchors: P2[] = rng.shuffle([
      { x: -0.55, z: -0.35 }, { x: 0.55, z: -0.35 }, { x: -0.55, z: 0.3 }, { x: 0.55, z: 0.3 },
      { x: 0, z: -0.1 }, { x: -0.3, z: 0.62 }, { x: 0.3, z: 0.62 },
    ]);
    let placed = 0;
    for (const a of anchors) {
      if (placed >= nPlat) break;
      for (let tries = 0; tries < 14; tries++) {
        const cx = a.x * H + rng.range(-3, 3);
        const cz = a.z * H + rng.range(-3, 3);
        const w = rng.range(5, 8);
        const d = rng.range(4.2, 6.4);
        const h = rng.pick(elite ? [2.0, 2.4, 2.8] : [1.6, 2.0, 2.4, 2.8]);
        if (this.platform(cx, cz, w, d, h, this.stairSideToward(cx, cz), rng.range(2.2, 2.8), true)) {
          placed++;
          break;
        }
      }
    }
    // 中央牌坊
    if (!elite && rng.chance(0.55)) this.paifang(rng.range(-H * 0.3, H * 0.12));
    // 掩体
    const nCover = elite ? rng.int(12, 17) : rng.int(14, 22);
    const weights = COVER_WEIGHTS[this.stage.theme];
    let covers = 0;
    for (let tries = 0; tries < 700 && covers < nCover; tries++) {
      const kind = rng.weighted(weights, (e) => e[1])[0];
      if (this.cover(kind, rng.range(-H + 4, H - 4), rng.range(-H + 4, H - 4))) covers++;
    }
  }

  /** 台阶朝向：朝竞技场中心的那一侧（25% 概率换另一轴） */
  private stairSideToward(cx: number, cz: number): number {
    let alongX = Math.abs(cx) > Math.abs(cz);
    if (this.rng.chance(0.25)) alongX = !alongX;
    if (alongX) return cx > 0 ? 1 : 0;
    return cz > 0 ? 3 : 2;
  }

  /**
   * 高台 + 一侧台阶（side 0=+X 1=-X 2=+Z 3=-Z）。每级 0.4 米、进深 0.65 米。
   * 台阶口前方保留落脚区并登记为可达性校验点。
   */
  private platform(cx: number, cz: number, w: number, d: number, h: number, side: number, sw: number, allowPavilion: boolean): boolean {
    const rng = this.rng;
    const n = Math.max(2, Math.round(h / STEP_RISE));
    const rise = h / n;
    const run = (n - 1) * STEP_DEPTH;
    const P = rectC(cx, cz, w, d);
    const edgeLen = side < 2 ? d : w;
    const maxOff = Math.max(0, (edgeLen - sw) / 2 - 0.6);
    const off = rng.range(-maxOff, maxOff);
    let S: Rect;
    let land: P2;
    switch (side) {
      case 0: S = { x0: P.x1, x1: P.x1 + run, z0: cz + off - sw / 2, z1: cz + off + sw / 2 }; land = { x: S.x1 + 1.4, z: cz + off }; break;
      case 1: S = { x0: P.x0 - run, x1: P.x0, z0: cz + off - sw / 2, z1: cz + off + sw / 2 }; land = { x: S.x0 - 1.4, z: cz + off }; break;
      case 2: S = { x0: cx + off - sw / 2, x1: cx + off + sw / 2, z0: P.z1, z1: P.z1 + run }; land = { x: cx + off, z: S.z1 + 1.4 }; break;
      default: S = { x0: cx + off - sw / 2, x1: cx + off + sw / 2, z0: P.z0 - run, z1: P.z0 }; land = { x: cx + off, z: S.z0 - 1.4 }; break;
    }
    const U = union(P, S);
    if (!this.fits(U, 2.6)) return false;
    const landC: Circle = { x: land.x, z: land.z, r: sw / 2 + 0.9 };
    const H = this.H;
    if (Math.abs(land.x) > H - 1.6 || Math.abs(land.z) > H - 1.6) return false;
    for (const o of this.occ) if (pointRectDist(landC.x, landC.z, o.r) < landC.r) return false;

    const g = this.group();
    this.box('platform', 'platform', g, P.x0, 0, P.z0, P.x1, h, P.z1);
    for (let k = 1; k < n; k++) {
      const top = k * rise;
      const outer = (n - k) * STEP_DEPTH;
      const inner = (n - 1 - k) * STEP_DEPTH;
      switch (side) {
        case 0: this.box('stair', 'stair', g, P.x1 + inner, 0, S.z0, P.x1 + outer, top, S.z1); break;
        case 1: this.box('stair', 'stair', g, P.x0 - outer, 0, S.z0, P.x0 - inner, top, S.z1); break;
        case 2: this.box('stair', 'stair', g, S.x0, 0, P.z1 + inner, S.x1, top, P.z1 + outer); break;
        default: this.box('stair', 'stair', g, S.x0, 0, P.z0 - outer, S.x1, top, P.z0 - inner); break;
      }
    }
    this.occupy(U, g);
    this.reserved.push(landC);
    this.L.checks.push({ x: land.x, z: land.z, g });

    if (allowPavilion && !this.hasPavilion && w >= 5 && d >= 4.6 && rng.chance(0.5)) {
      // 亭子：四根朱漆柱 + 屋顶（屋顶底面在台面上方 2.9 米）
      this.hasPavilion = true;
      const ph = 2.9;
      const inset = 0.45;
      for (const px of [P.x0 + inset, P.x1 - inset]) {
        for (const pz of [P.z0 + inset, P.z1 - inset]) {
          this.box('post', 'pillar', g, px - 0.18, h, pz - 0.18, px + 0.18, h + ph, pz + 0.18);
        }
      }
      this.box('roof', 'roof', g, P.x0 - 0.55, h + ph, P.z0 - 0.55, P.x1 + 0.55, h + ph + 0.28, P.z1 + 0.55);
    } else {
      // 台阶对侧的角上立一杆旗（纯装饰，让开城垛）
      if (rng.chance(0.65)) {
        const xs = side === 0 ? [P.x0 + 0.9] : side === 1 ? [P.x1 - 0.9] : [P.x0 + 0.9, P.x1 - 0.9];
        const zs = side === 2 ? [P.z0 + 0.9] : side === 3 ? [P.z1 - 0.9] : [P.z0 + 0.9, P.z1 - 0.9];
        this.deco('banner', rng.pick(xs), rng.pick(zs), { y: h, yaw: rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), h: rng.range(3.6, 4.4), group: g });
      }
      // 城垛式矮护栏（台阶一侧不设）
      for (let e = 0; e < 4; e++) {
        if (e === side) continue;
        const alongX = e >= 2;
        const len = alongX ? w : d;
        const cnt = Math.floor((len - 0.4) / 1.35) + 1;
        const step = (len - 0.5) / Math.max(1, cnt - 1);
        for (let i = 0; i < cnt; i++) {
          if (rng.chance(0.22)) continue;
          const t = (alongX ? P.x0 : P.z0) + 0.25 + i * step;
          if (alongX) {
            const z = e === 2 ? P.z1 - 0.2 : P.z0 + 0.2;
            this.box('parapet', 'cover', g, t - 0.25, h, z - 0.2, t + 0.25, h + 0.75, z + 0.2);
          } else {
            const x = e === 0 ? P.x1 - 0.2 : P.x0 + 0.2;
            this.box('parapet', 'cover', g, x - 0.2, h, t - 0.25, x + 0.2, h + 0.75, t + 0.25);
          }
        }
      }
    }
    return true;
  }

  /** 中央牌坊：两根柱子有碰撞，横梁在头顶（不影响地面导航） */
  private paifang(cz: number): void {
    const half = 3.4;
    const a = rectC(-half, cz, 1.1, 1.1);
    const b = rectC(half, cz, 1.1, 1.1);
    if (!this.fits(a, COVER_GAP) || !this.fits(b, COVER_GAP)) return;
    const g = this.group();
    this.box('gatePillar', 'pillar', g, a.x0, 0, a.z0, a.x1, 6.2, a.z1);
    this.box('gatePillar', 'pillar', g, b.x0, 0, b.z0, b.x1, 6.2, b.z1);
    this.box('lintel', 'cover', g, -half - 0.9, 4.9, cz - 0.4, half + 0.9, 5.5, cz + 0.4);
    this.occupy(a, g);
    this.occupy(b, g);
    this.reserved.push({ x: 0, z: cz, r: 1.8 });
  }

  /** 放置一个掩体；位置不合适返回 false */
  private cover(kind: CoverKind, x: number, z: number): boolean {
    const rng = this.rng;
    const gap = COVER_GAP;
    switch (kind) {
      case 'crate': {
        const v = rng.next();
        if (v < 0.4) {
          const s = rng.range(1.2, 1.5);
          const r = rectC(x, z, s, s);
          if (!this.fits(r, gap)) return false;
          const g = this.group();
          this.box('crate', 'cover', g, r.x0, 0, r.z0, r.x1, s, r.z1);
          this.occupy(r, g);
        } else if (v < 0.75) {
          const r = rectC(x, z, 1.4, 1.4);
          if (!this.fits(r, gap)) return false;
          const g = this.group();
          this.box('crate', 'cover', g, r.x0, 0, r.z0, r.x1, 1.4, r.z1);
          const ox = rng.range(-0.15, 0.15);
          const oz = rng.range(-0.15, 0.15);
          this.box('crate', 'cover', g, x + ox - 0.5, 1.4, z + oz - 0.5, x + ox + 0.5, 2.4, z + oz + 0.5);
          this.occupy(r, g);
        } else {
          const alongX = rng.chance(0.5);
          const r = alongX ? rectC(x, z, 2.7, 1.3) : rectC(x, z, 1.3, 2.7);
          if (!this.fits(r, gap)) return false;
          const g = this.group();
          if (alongX) {
            this.box('crate', 'cover', g, r.x0, 0, r.z0, x - 0.05, 1.3, r.z1);
            this.box('crate', 'cover', g, x + 0.05, 0, r.z0, r.x1, 1.3, r.z1);
            this.box('crate', 'cover', g, x - 0.9, 1.3, z - 0.5, x + 0.1, 2.3, z + 0.5);
          } else {
            this.box('crate', 'cover', g, r.x0, 0, r.z0, r.x1, 1.3, z - 0.05);
            this.box('crate', 'cover', g, r.x0, 0, z + 0.05, r.x1, 1.3, r.z1);
            this.box('crate', 'cover', g, x - 0.5, 1.3, z - 0.1, x + 0.5, 2.3, z + 0.9);
          }
          this.occupy(r, g);
          if (rng.chance(0.5)) this.deco('pots', r.x1 + 0.6, z, { group: g, s: rng.range(0.8, 1) });
        }
        return true;
      }
      case 'lowWall': {
        const len = rng.range(3, 6);
        const th = 0.7;
        const h = rng.range(1.15, 1.5);
        const alongX = rng.chance(0.5);
        const a = alongX ? rectC(x, z, len, th) : rectC(x, z, th, len);
        let b: Rect | null = null;
        if (rng.chance(0.3)) {
          const len2 = rng.range(2, 3.4);
          const end = rng.sign();
          const dir = rng.sign();
          b = alongX
            ? rectC(x + end * (len / 2 - th / 2), z + dir * (len2 / 2 + th / 2), th, len2)
            : rectC(x + dir * (len2 / 2 + th / 2), z + end * (len / 2 - th / 2), len2, th);
        }
        const r = b ? union(a, b) : a;
        if (!this.fits(r, gap)) return false;
        const g = this.group();
        this.box('lowWall', 'cover', g, a.x0, 0, a.z0, a.x1, h, a.z1);
        if (b) this.box('lowWall', 'cover', g, b.x0, 0, b.z0, b.x1, h, b.z1);
        this.occupy(r, g);
        return true;
      }
      case 'ruin': {
        const len = rng.range(4, 7);
        const th = 0.9;
        const alongX = rng.chance(0.5);
        const r = alongX ? rectC(x, z, len, th) : rectC(x, z, th, len);
        if (!this.fits(r, gap)) return false;
        const g = this.group();
        let t = -len / 2;
        let first = true;
        while (t < len / 2 - 1e-3) {
          const seg = Math.min(len / 2 - t, rng.range(0.8, 1.6));
          const last = t + seg >= len / 2 - 1e-3;
          const h = rng.range(1.4, 3.2) * (first || last ? 0.7 : 1);
          if (alongX) this.box('ruin', 'cover', g, x + t, 0, r.z0, x + t + seg, h, r.z1);
          else this.box('ruin', 'cover', g, r.x0, 0, z + t, r.x1, h, z + t + seg);
          t += seg;
          first = false;
        }
        this.occupy(r, g);
        for (let i = 0; i < 3; i++) {
          const side = rng.sign();
          const along = rng.range(-len / 2, len / 2);
          const px = alongX ? x + along : x + side * rng.range(0.8, 1.4);
          const pz = alongX ? z + side * rng.range(0.8, 1.4) : z + along;
          this.deco('rock', px, pz, { group: g, s: rng.range(0.25, 0.5), yaw: rng.range(0, TAU) });
        }
        return true;
      }
      case 'pillar': {
        const s = rng.range(1.1, 1.4);
        const h = rng.range(3.6, 5.5);
        if (rng.chance(0.3)) {
          const alongX = rng.chance(0.5);
          const off = 1.9;
          const a = alongX ? rectC(x - off, z, s, s) : rectC(x, z - off, s, s);
          const b = alongX ? rectC(x + off, z, s, s) : rectC(x, z + off, s, s);
          const r = union(a, b);
          if (!this.fits(r, gap)) return false;
          const g = this.group();
          this.box('pillar', 'pillar', g, a.x0, 0, a.z0, a.x1, h, a.z1);
          this.box('pillar', 'pillar', g, b.x0, 0, b.z0, b.x1, h, b.z1);
          this.occupy(a, g);
          this.occupy(b, g);
          return true;
        }
        const r = rectC(x, z, s, s);
        if (!this.fits(r, gap)) return false;
        const g = this.group();
        this.box('pillar', 'pillar', g, r.x0, 0, r.z0, r.x1, h, r.z1);
        this.occupy(r, g);
        return true;
      }
      case 'stele': {
        const alongX = rng.chance(0.5);
        const base = alongX ? rectC(x, z, 1.5, 0.95) : rectC(x, z, 0.95, 1.5);
        if (!this.fits(base, gap)) return false;
        const g = this.group();
        this.box('steleBase', 'cover', g, base.x0, 0, base.z0, base.x1, 0.5, base.z1);
        const slab = alongX ? rectC(x, z, 1.0, 0.42) : rectC(x, z, 0.42, 1.0);
        this.box('stele', 'cover', g, slab.x0, 0.5, slab.z0, slab.x1, 3.0, slab.z1);
        this.occupy(base, g);
        return true;
      }
      default: {
        // statue / cactus / pine / crystal / spike：装饰模型 + 碰撞体
        const yaw = Math.round(Math.atan2(-x, -z) / (Math.PI / 2)) * (Math.PI / 2);
        const s = kind === 'statue' ? 1 : rng.range(0.95, 1.25);
        const ok = this.propWithCollider(kind, x, z, gap, 3.5, { yaw, s });
        if (ok && (kind === 'statue' || kind === 'spike')) {
          const g = this.nextGroup - 1;
          for (let i = 0; i < 2; i++) {
            const a = rng.range(0, TAU);
            this.deco('rock', x + Math.sin(a) * 1.5, z + Math.cos(a) * 1.5, { group: g, s: rng.range(0.25, 0.45), yaw: a });
          }
        }
        return ok;
      }
    }
  }

  // ───────────── Boss 关 ─────────────

  private boss(): void {
    const rng = this.rng;
    const H = this.H;
    this.reserved.push({ x: 0, z: 0, r: 17 });
    // 环形石柱
    const n = 10;
    const a0 = rng.next() * TAU;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i * TAU) / n;
      const R = rng.range(23, 25.5);
      const x = Math.sin(a) * R;
      const z = Math.cos(a) * R;
      const r = rectC(x, z, 1.7, 1.7);
      if (!this.fits(r, COVER_GAP, 2.5)) continue;
      const g = this.group();
      const broken = rng.chance(0.3);
      this.box(broken ? 'ruin' : 'pillar', 'pillar', g, r.x0, 0, r.z0, r.x1, broken ? rng.range(2.8, 3.8) : rng.range(6.5, 8), r.z1);
      this.occupy(r, g);
      if (broken) this.deco('rock', x + rng.range(-1.6, 1.6), z + rng.range(-1.6, 1.6), { group: g, s: rng.range(0.3, 0.55) });
    }
    // 四角：两个高台 + 两段 L 形残垣
    const corners: P2[] = rng.shuffle([{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: -1, z: 1 }, { x: 1, z: 1 }]);
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      const cx = c.x * (H - 7);
      const cz = c.z * (H - 7);
      if (i < 2) {
        const side = rng.chance(0.5) ? (c.x > 0 ? 1 : 0) : (c.z > 0 ? 3 : 2);
        this.platform(cx, cz, 6, 5.6, 2.0, side, 2.4, false);
      } else {
        this.cover('lowWall', cx, cz) || this.cover('ruin', cx, cz);
      }
    }
    this.L.runes.push({ x: 0, z: 0, r: 13, gold: false });
  }

  // ───────────── 宝藏关 ─────────────

  private treasure(): void {
    const H = this.H;
    const L = this.L;
    this.gallery(2);
    this.gallery(3);
    L.runes.push({ x: L.rewardPoint.x, z: L.rewardPoint.z, r: 4.2, gold: true });
    // 奖励点两侧的石碑
    const r = L.rewardPoint;
    for (const sx of [-1, 1]) this.cover('stele', r.x + sx * 9.6, r.z + 0.5);
    // 画廊里的陶罐
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const z = this.rng.range(-H + 5, H - 5);
        const x = sx * (H - 1.4);
        if (this.clearAt(x, z, 0.8)) this.deco('pots', x, z, { s: this.rng.range(0.8, 1.1), yaw: this.rng.range(0, TAU) });
      }
    }
  }

  /** 回廊：一排朱漆柱 + 斜屋顶，side 2=西 3=东 */
  private gallery(side: 2 | 3): void {
    const H = this.H;
    const sx = side === 2 ? -1 : 1;
    const x = sx * (H - 4);
    const zs: number[] = [];
    const cnt = 5;
    for (let i = 0; i < cnt; i++) zs.push(-H + 5 + (i * (2 * H - 10)) / (cnt - 1));
    const g = this.group();
    for (const z of zs) {
      const r = rectC(x, z, 0.8, 0.8);
      if (!this.fits(r, 1.2, 1.5)) continue;
      this.box('pillar', 'pillar', g, r.x0, 0, r.z0, r.x1, 4.3, r.z1);
      this.occupy(r, g);
    }
    const x0 = sx < 0 ? -H : x - 0.6;
    const x1 = sx < 0 ? x + 0.6 : H;
    this.box('galleryRoof', 'roof', g, x0, 4.3, zs[0] - 1.4, x1, 4.6, zs[zs.length - 1] + 1.4);
  }

  // ───────────── 商店关 ─────────────

  private shop(): void {
    const H = this.H;
    const L = this.L;
    const rng = this.rng;
    // 两侧摊棚（放在壁柱之间）
    const ts = this.pilasters[3];
    const slots: number[] = [];
    for (let i = 0; i + 1 < ts.length; i++) slots.push((ts[i] + ts[i + 1]) / 2);
    for (const sx of [-1, 1]) {
      for (const z of slots) {
        const x = sx * (H - 2.15);
        const counter: Rect = sx > 0 ? { x0: H - 2.6, x1: H - 1.7, z0: z - 1.6, z1: z + 1.6 } : { x0: -H + 1.7, x1: -H + 2.6, z0: z - 1.6, z1: z + 1.6 };
        if (!this.fits(counter, 1.0, 1.2)) continue;
        const g = this.group();
        this.box('counter', 'cover', g, counter.x0, 0, counter.z0, counter.x1, 1.0, counter.z1);
        this.occupy({ x0: Math.min(counter.x0, sx * H), x1: Math.max(counter.x1, sx * H), z0: counter.z0, z1: counter.z1 }, g);
        this.deco('stall', x, z, { yaw: sx > 0 ? -Math.PI / 2 : Math.PI / 2, w: 1.8, group: g, v: rng.next() });
      }
    }
    // 横跨场地的灯笼串（两端立杆贴着壁柱）
    for (const z of ts) if (Math.abs(z) < H - 6) this.deco('lanternString', 0, z, { w: H - 0.9, h: 5.8 });
    L.runes.push({ x: L.shopPoint.x, z: L.shopPoint.z, r: 5.8, gold: true });
    // 角落里的货箱
    for (const sx of [-1, 1]) {
      const x = sx * (H - 4.2);
      const z = H - 5.2;
      this.cover('crate', x, z);
    }
  }

  // ───────────── 墙边装饰 ─────────────

  /** 四角的主题装饰：一个带碰撞的道具紧贴角楼与墙面，旁边配几件纯装饰 */
  private cornerClusters(): void {
    const H = this.H;
    const rng = this.rng;
    const main: Record<ThemeId, DecoKind> = { desert: 'cactus', frost: 'pine', inferno: 'spike' };
    const soft: Record<ThemeId, WallPropKind[]> = { desert: ['dune', 'pots'], frost: ['snowdrift', 'snowdrift'], inferno: ['rock', 'rock'] };
    const theme = this.stage.theme;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const s = rng.range(1.0, 1.3);
        const half = propSize(main[theme], s) / 2;
        // 沿其中一面墙紧贴角楼
        const alongX = rng.chance(0.5);
        const a = H - 1.2 - 0.05 - half;
        const b = H - WALL_SLOT - half;
        const x = sx * (alongX ? a : b);
        const z = sz * (alongX ? b : a);
        this.propWithCollider(main[theme], x, z, PROP_GAP, 0.05, { yaw: rng.range(0, TAU), s }, 0.04);
        for (const kind of soft[theme]) {
          const px = sx * (H - rng.range(1.0, 3.5));
          const pz = sz * (H - rng.range(1.0, 3.5));
          this.wallProp(kind, px, pz, rng.range(0, TAU));
        }
      }
    }
  }

  private wallProps(): void {
    const H = this.H;
    const rng = this.rng;
    const props = WALL_PROPS[this.stage.theme];
    for (let side = 0; side < 4; side++) {
      let t = -H + 5 + rng.range(0, 3);
      while (t < H - 5) {
        const kind = rng.weighted(props, (e) => e[1])[0];
        const low = kind === 'dune' || kind === 'snowdrift';
        const s = rng.range(0.9, 1.3);
        const solid = PROP_COLLIDER[kind as DecoKind] !== undefined;
        const off = low ? rng.range(0.5, 0.9) : solid ? WALL_SLOT + propSize(kind as DecoKind, s) / 2 : rng.range(0.8, 1.4);
        const p = wallPoint(H, side, t, off);
        this.wallProp(kind, p.x, p.z, WALL_YAW[side] + (low ? 0 : rng.range(-0.6, 0.6)), s);
        t += rng.range(5.5, 8.5);
      }
    }
  }

  private wallProp(kind: WallPropKind, x: number, z: number, yaw: number, scale = 1): void {
    const rng = this.rng;
    switch (kind) {
      case 'dune':
      case 'snowdrift':
        if (this.clearAt(x, z, 0.2)) this.deco(kind, x, z, { yaw, s: rng.range(0.8, 1.4), w: rng.range(2.2, 4.2), h: rng.range(0.35, 0.6) });
        return;
      case 'pots':
      case 'rock':
        if (this.clearAt(x, z, 0.6)) this.deco(kind, x, z, { yaw, s: kind === 'rock' ? rng.range(0.4, 0.8) : rng.range(0.8, 1.15) });
        return;
      default:
        this.propWithCollider(kind, x, z, PROP_GAP, 0.05, { yaw, s: scale }, 0.04);
    }
  }

  /** 壁柱之间的墙面垂幡 */
  private wallBanners(): void {
    const H = this.H;
    const wh = this.L.wallHeight;
    for (let side = 0; side < 4; side++) {
      const ts = this.pilasters[side];
      for (let i = 0; i + 1 < ts.length; i++) {
        const t = (ts[i] + ts[i + 1]) / 2;
        if (ts[i + 1] - ts[i] > 12) continue; // 跨过大门 / 入口
        if (!this.rng.chance(0.55)) continue;
        const p = wallPoint(H, side, t, 0.02);
        this.deco('wallBanner', p.x, p.z, { yaw: WALL_YAW[side], y: wh - 0.7, h: this.rng.range(3.4, 4.4) });
      }
    }
  }

  // ───────────── 刷怪点 ─────────────

  private spawnPoints(): void {
    const H = this.H;
    const L = this.L;
    const rng = this.rng;
    const want = this.stage.type === 'combat' ? 14 : 12;
    const pts: P2[] = [];
    for (const minSep of [5.5, 4.2, 3.2]) {
      for (let tries = 0; tries < 900 && pts.length < want; tries++) {
        const p = { x: snap(rng.range(-H + 2.5, H - 2.5)), z: snap(rng.range(-H + 2.5, H - 2.5)) };
        if (dist(p, L.playerSpawn) < 14) continue;
        if (dist(p, L.rewardPoint) < 3) continue;
        if (L.portalPoints.some((q) => dist(p, q) < 3)) continue;
        if (this.stage.type === 'boss' && dist(p, L.bossPoint) < 5) continue;
        if (this.occ.some((o) => pointRectDist(p.x, p.z, o.r) < 1.3)) continue;
        if (L.checks.some((c) => dist(p, c) < 1.6)) continue;
        if (pts.some((q) => dist(p, q) < minSep)) continue;
        pts.push(p);
      }
      if (pts.length >= 10) break;
    }
    L.spawnPoints = pts;
  }
}

/**
 * 生成关卡布局。rng 由调用方按 (run.seed, chapter, index) 创建；同种子结果可复现。
 */
export function generateLevel(rng: Rng, stage: StageNode): LevelLayout {
  for (let attempt = 0; attempt < 6; attempt++) {
    const L = new Gen(rng, stage).run();
    rotateLayout(L, rng.int(0, 3));
    if (validateAndRepair(L)) {
      finalizeLights(L);
      return L;
    }
  }
  // 兜底：去掉全部可移除的障碍，只保留围墙结构
  const L = new Gen(rng, stage).run();
  const groups = new Set<number>();
  for (const b of L.boxes) if (b.group > 0) groups.add(b.group);
  for (const g of groups) removeGroup(L, g);
  validateAndRepair(L);
  finalizeLights(L);
  return L;
}
