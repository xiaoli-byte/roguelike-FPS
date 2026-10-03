/**
 * 伤害数字：DOM 对象池（≤ 80），挂在 ctx.dom.world。
 *
 * - 每帧把世界锚点投影到屏幕，屏幕空间上浮 + 随机漂移 + 淡出；相机背后隐藏。
 * - 暴击：更大、金色描边、弹跳缩放。颜色：护盾蓝 / 护甲黄 / 生命白 / 元素色 / 治疗绿 / 玩家受伤红。
 * - 同一位置短时间内的同类伤害合并成一个数字（冲锋枪 / 机炮 / 光束连续命中同一个敌人时只显示一个滚动累加的总数），
 *   合并时再弹一下，锚点向最新命中点靠拢（跟得上移动中的敌人）。
 *   Combat 已经把「同一帧、同一敌人、同层、同元素」合并成一次调用，所以同一帧到来的两个同类数字必然属于
 *   不同敌人：同帧不合并，避免把挨在一起的两个敌人的伤害加到一起。
 * - 玩家自己的受伤 / 治疗数字锚在准星下方（锚点离相机太近时）。
 * - 持续伤害的一跳（opts.dot）：约 0.75 倍字号、颜色压暗、半透明、不弹跳，只小幅上浮后停住；
 *   同目标（按跳伤节拍 + 最近锚点判断）同层同元素的连续跳伤累加成一个数字，锚点平滑跟随目标，
 *   最后一跳后再停留一会儿淡出。DOT 与直接命中各自合并、互不混算（同元素的直接命中照常用大字）。
 * 样式自己注入（ui/styles.css 归 UI 模块）。
 */
import * as THREE from 'three';
import type { DamageLayer, DamageNumberOpts, Element } from '../core/types';
import { ELEMENT_COLORS } from '../core/types';

const POOL = 80;
const STYLE_ID = 'fx-damage-number-style';
/** 合并窗口：数字出生后多久内还能继续累加 */
const MERGE_WINDOW = 0.45;
const MERGE_DIST_SQ = 1.1 * 1.1;

// ── DOT（持续伤害一跳）──
// 契约里没有目标 id，「同目标」靠两条线索判断：
//  1) 节拍：同一目标同一元素的跳伤严格按固定间隔到来（战斗模块 Status 的 BURN_TICK / CORRODE_TICK，都是 0.5 秒，
//     特效与战斗用同一个已缩放、暂停时冻结的 dt），别的目标的跳伤相位是随机的；
//  2) 距离：与上一跳命中点最近的候选。
// 若战斗模块改了跳伤间隔，这里只会退化成「不合并、每跳一个小字」，不会算错。
/** 跳伤间隔（秒），与 Status.ts 的 BURN_TICK / CORRODE_TICK 一致 */
const DOT_TICK = 0.5;
/** 节拍容差：逐帧计时的量化误差 + Combat 刷新数字最多晚一帧（dt 钳在 0.05 以内） */
const DOT_TICK_TOLERANCE = 0.09;
/** 贴准星的玩家 DOT 只有一个目标：只要求距上一跳不超过这么久 */
const DOT_SCREEN_MERGE_GAP = 0.75;
/** 一个 DOT 数字最多累加这么久，之后的跳伤另起一个（长时间的 DOT 分段显示，也不会一直挂在头顶） */
const DOT_MERGE_MAX_AGE = 4;
/** 两跳之间目标可能已经跑出三米多（6.5 m/s × 0.5 s）：合并距离比直接命中宽，取最近的候选 */
const DOT_MERGE_DIST_SQ = 3.5 * 3.5;
/** 最后一跳后再停留的时间（含淡出） */
const DOT_HOLD = 0.8;
const DOT_FADE = 0.3;
const DOT_RISE = 24;
const DOT_RISE_TIME = 0.5;
const DOT_DRIFT = 32;
/** 最大不透明度（更暗） */
const DOT_ALPHA = 0.8;
/** 颜色压暗系数 */
const DOT_DIM = 0.78;
/** 锚点跟随速度（1/秒） */
const DOT_FOLLOW = 10;

type Kind = DamageLayer | 'heal' | 'player' | 'immune';

const LAYER_CSS: Record<string, string> = {
  health: '#ffffff',
  shield: '#63c9ff',
  armor: '#ffd23f',
  heal: '#6dff8a',
  player: '#ff4a3d',
  immune: '#b9bec8',
};

function hexCss(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

const ELEMENT_CSS: Record<Element, string> = {
  none: LAYER_CSS.health,
  fire: hexCss(ELEMENT_COLORS.fire),
  shock: hexCss(ELEMENT_COLORS.shock),
  corrode: hexCss(ELEMENT_COLORS.corrode),
};

/** '#rrggbb' 按通道乘以 k（DOT 用的压暗色） */
function dimCss(css: string, k: number): string {
  const v = parseInt(css.slice(1), 16);
  const r = Math.round(((v >> 16) & 255) * k);
  const g = Math.round(((v >> 8) & 255) * k);
  const b = Math.round((v & 255) * k);
  return hexCss((r << 16) | (g << 8) | b);
}

function dimRecord<K extends string>(src: Record<K, string>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(src) as K[]) out[key] = dimCss(src[key], DOT_DIM);
  return out;
}

const LAYER_DOT_CSS = dimRecord(LAYER_CSS);
const ELEMENT_DOT_CSS = dimRecord(ELEMENT_CSS);

const CSS = `
.fx-dn {
  position: absolute; left: 0; top: 0;
  pointer-events: none; white-space: nowrap; display: none;
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
  font-weight: 900; font-size: 21px; line-height: 1; letter-spacing: 0.5px;
  font-variant-numeric: tabular-nums;
  color: #fff;
  will-change: transform, opacity;
  text-shadow:
    1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000,
    1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000,
    0 3px 6px rgba(0, 0, 0, 0.55);
}
.fx-dn.fx-dn-dot {
  font-size: 16px; font-weight: 800; letter-spacing: 0.3px;
  text-shadow:
    1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000,
    0 2px 3px rgba(0, 0, 0, 0.5);
}
.fx-dn.fx-dn-crit {
  font-size: 31px;
  text-shadow:
    1.5px 0 0 #6b3300, -1.5px 0 0 #6b3300, 0 1.5px 0 #6b3300, 0 -1.5px 0 #6b3300,
    1px 1px 0 #6b3300, -1px 1px 0 #6b3300, 1px -1px 0 #6b3300, -1px -1px 0 #6b3300,
    0 0 6px rgba(255, 196, 40, 0.95), 0 0 14px rgba(255, 150, 20, 0.75), 0 0 24px rgba(255, 110, 0, 0.45);
}
.fx-dn.fx-dn-player { font-size: 24px; }
.fx-dn.fx-dn-heal { font-size: 22px; }
.fx-dn.fx-dn-immune { font-size: 17px; font-weight: 800; letter-spacing: 2px; }
`;

interface DN {
  el: HTMLDivElement;
  active: boolean;
  /** 世界锚点（已含出生时的随机偏移） */
  x: number; y: number; z: number;
  /** 锚点要去的位置：DOT 合并时更新，update 里平滑跟随；其他数字恒等于 x/y/z */
  tx: number; ty: number; tz: number;
  /** 出生时的随机偏移（锚点 = 命中点 + 偏移） */
  ox: number; oy: number; oz: number;
  /** 屏幕锚点模式（归一化坐标），用于玩家自身数字 */
  screen: boolean;
  sx: number; sy: number;
  age: number;
  life: number;
  /** 最近一次合并后的弹跳计时 */
  pop: number;
  driftX: number;
  rise: number;
  crit: boolean;
  /** 持续伤害的跳字 */
  dot: boolean;
  kind: Kind;
  element: Element;
  amount: number;
  stamp: number;
  /** 最近一次生成 / 合并时的帧号 */
  frame: number;
  /** 最近一次生成 / 合并时的 age（DOT 按「距上一跳」判断能否继续累加） */
  lastHit: number;
  // 缓存上次写入的样式，避免无谓的 DOM 写
  shown: boolean;
  lastOpacity: number;
  className: string;
}

const _v = new THREE.Vector3();

export class DamageNumbers {
  private readonly pool: DN[] = [];
  private host: HTMLElement | null = null;
  private width = 1920;
  private height = 1080;
  private stamp = 0;
  private activeCount = 0;
  /** 有新数字 / 合并 / 窗口尺寸变化，需要重新写 DOM */
  private dirty = true;
  private readonly lastCam = new Float64Array(6);

  /** 注入样式并建池（在 FxSystem.init 中调用） */
  init(host: HTMLElement): void {
    this.host = host;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'fx-dn';
      host.appendChild(el);
      this.pool.push({
        el, active: false, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, ox: 0, oy: 0, oz: 0,
        screen: false, sx: 0.5, sy: 0.5, age: 0, life: 1, pop: 0,
        driftX: 0, rise: 0, crit: false, dot: false, kind: 'health', element: 'none', amount: 0, stamp: 0, frame: -1, lastHit: 0,
        shown: false, lastOpacity: -1, className: 'fx-dn',
      });
    }
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
  }

  private onResize(): void {
    this.width = window.innerWidth || 1920;
    this.height = window.innerHeight || 1080;
    this.dirty = true;
  }

  /**
   * 生成一个数字。camPos 用于判断锚点是否贴着相机（玩家自身的受伤 / 治疗）；frame 为当前帧号（同帧不合并）。
   */
  spawn(pos: THREE.Vector3, amount: number, opts: DamageNumberOpts | undefined, camPos: THREE.Vector3, frame: number): void {
    if (!this.host || this.pool.length === 0) return;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
    const kind: Kind = opts?.kind ?? 'health';
    const crit = !!opts?.crit && kind !== 'heal' && kind !== 'player' && kind !== 'immune';
    // DOT 本身不会暴击；万一和同帧的直接暴击被合成了一次调用，按暴击显示（那一下确实是暴击）
    const dot = !!opts?.dot && !crit && kind !== 'immune';
    const element: Element = opts?.element ?? 'none';
    if (kind !== 'immune' && !(amount > 0 && amount < 1e9)) return;

    const screen = (kind === 'player' || kind === 'heal') && pos.distanceToSquared(camPos) < 2.6 * 2.6;

    // 合并：同类（DOT / 直接命中分开）、同暴击、同元素、锚点相近、仍在合并窗口内、不是同一帧来的（同帧 = 不同目标）。
    // 有多个候选时取锚点最近的那个。贴准星的玩家数字只有 DOT 合并（直接受伤每下单独显示）。
    if (kind !== 'immune' && (!screen || dot)) {
      let best: DN | null = null;
      let bestSq = Infinity;
      const maxSq = dot ? DOT_MERGE_DIST_SQ : MERGE_DIST_SQ;
      for (const d of this.pool) {
        if (!d.active || d.screen !== screen || d.dot !== dot) continue;
        if (d.kind !== kind || d.crit !== crit || d.element !== element || d.frame === frame) continue;
        if (dot) {
          const gap = d.age - d.lastHit;
          if (d.age > DOT_MERGE_MAX_AGE) continue;
          if (screen ? gap > DOT_SCREEN_MERGE_GAP : Math.abs(gap - DOT_TICK) > DOT_TICK_TOLERANCE) continue;
        } else if (d.age > MERGE_WINDOW) continue;
        let sq = 0;
        if (!screen) {
          // 与上一次命中点（目标锚点去掉随机偏移）比较
          const dx = d.tx - d.ox - pos.x, dy = d.ty - d.oy - pos.y, dz = d.tz - d.oz - pos.z;
          sq = dx * dx + dy * dy + dz * dz;
          if (sq > maxSq) continue;
        }
        if (sq < bestSq) {
          best = d;
          bestSq = sq;
        }
      }
      if (best) {
        this.merge(best, pos, amount, frame);
        return;
      }
    }

    const d = this.take();
    d.active = true;
    d.screen = screen;
    if (screen) {
      d.sx = 0.5 + (Math.random() - 0.5) * 0.08;
      d.sy = kind === 'heal' ? 0.6 : 0.57;
      if (dot) d.sy += 0.035;
    } else {
      d.ox = (Math.random() - 0.5) * 0.35;
      d.oy = (Math.random() - 0.5) * 0.2 + 0.15;
      d.oz = (Math.random() - 0.5) * 0.35;
      d.x = d.tx = pos.x + d.ox;
      d.y = d.ty = pos.y + d.oy;
      d.z = d.tz = pos.z + d.oz;
    }
    d.age = 0;
    d.pop = 0;
    d.lastHit = 0;
    d.life = dot ? DOT_HOLD : crit ? 1.2 : kind === 'immune' ? 0.8 : 0.95;
    d.driftX = (Math.random() - 0.5) * (dot ? DOT_DRIFT : crit ? 70 : 55);
    d.rise = dot ? DOT_RISE : crit ? 70 : kind === 'player' ? 45 : 58;
    d.crit = crit;
    d.dot = dot;
    d.kind = kind;
    d.element = element;
    d.amount = kind === 'immune' ? 0 : amount;
    d.stamp = ++this.stamp;
    d.frame = frame;
    this.dirty = true;

    let cls = 'fx-dn';
    if (crit) cls += ' fx-dn-crit';
    else if (dot) cls += ' fx-dn-dot';
    else if (kind === 'player') cls += ' fx-dn-player';
    else if (kind === 'heal') cls += ' fx-dn-heal';
    else if (kind === 'immune') cls += ' fx-dn-immune';
    if (cls !== d.className) {
      d.el.className = cls;
      d.className = cls;
    }
    d.el.style.color = this.colorFor(kind, element, crit, dot);
    d.el.textContent = this.format(d.amount, kind);
    d.lastOpacity = -1;
    this.activeCount++;
  }

  /** 把一次命中累加进已有数字 */
  private merge(d: DN, pos: THREE.Vector3, amount: number, frame: number): void {
    d.amount += amount;
    d.el.textContent = this.format(d.amount, d.kind);
    d.frame = frame;
    if (d.dot) {
      // DOT：不弹跳；最后一跳后再停留 DOT_HOLD 秒；锚点在 update 里平滑跟上目标
      d.life = Math.max(d.life, d.age + DOT_HOLD);
      d.lastHit = d.age;
      if (!d.screen) {
        d.tx = pos.x + d.ox;
        d.ty = pos.y + d.oy;
        d.tz = pos.z + d.oz;
      }
    } else {
      d.pop = 0;
      d.life = Math.min(d.life + 0.12, d.crit ? 1.6 : 1.3);
      d.lastHit = d.age;
      // 锚点向最新命中点靠拢一半：跟得上移动的敌人，合并时的弹跳掩盖了这一下位移
      const hx = (d.x - d.ox - pos.x) * 0.5, hy = (d.y - d.oy - pos.y) * 0.5, hz = (d.z - d.oz - pos.z) * 0.5;
      d.x = d.tx = d.x - hx;
      d.y = d.ty = d.y - hy;
      d.z = d.tz = d.z - hz;
    }
    this.dirty = true;
  }

  private colorFor(kind: Kind, element: Element, crit: boolean, dot: boolean): string {
    const layer = dot ? LAYER_DOT_CSS : LAYER_CSS;
    if (kind === 'heal' || kind === 'player' || kind === 'immune' || kind === 'shield' || kind === 'armor') return layer[kind];
    if (element !== 'none') return (dot ? ELEMENT_DOT_CSS : ELEMENT_CSS)[element];
    return crit ? '#ffe46b' : layer.health;
  }

  private format(amount: number, kind: Kind): string {
    if (kind === 'immune') return '免疫';
    const n = amount < 1 ? 1 : Math.round(amount);
    if (kind === 'heal') return '+' + n;
    if (kind === 'player') return '-' + n;
    return String(n);
  }

  private take(): DN {
    let oldest = this.pool[0];
    for (const d of this.pool) {
      if (!d.active) return d;
      if (d.stamp < oldest.stamp) oldest = d;
    }
    this.activeCount--;
    return oldest;
  }

  /**
   * 每帧推进与投影。调用前 camera.matrixWorld / matrixWorldInverse 必须是最新的。
   */
  update(dt: number, camera: THREE.PerspectiveCamera, camPos: THREE.Vector3, camFwd: THREE.Vector3, enabled: boolean): void {
    if (this.activeCount <= 0) return;
    if (!enabled) {
      this.clear();
      return;
    }
    // 暂停 / 模态框：时间不走、相机不动、没有新数字时，DOM 不需要重写
    const lc = this.lastCam;
    const camSame = lc[0] === camPos.x && lc[1] === camPos.y && lc[2] === camPos.z
      && lc[3] === camFwd.x && lc[4] === camFwd.y && lc[5] === camFwd.z;
    if (dt <= 0 && camSame && !this.dirty) return;
    lc[0] = camPos.x; lc[1] = camPos.y; lc[2] = camPos.z;
    lc[3] = camFwd.x; lc[4] = camFwd.y; lc[5] = camFwd.z;
    this.dirty = false;
    const W = this.width, H = this.height;
    const unit = H / 1080;
    for (const d of this.pool) {
      if (!d.active) continue;
      d.age += dt;
      d.pop += dt;
      if (d.age >= d.life) {
        this.hide(d);
        continue;
      }
      // DOT 数字的锚点平滑跟上最新一跳的位置（没有弹跳来掩盖瞬移）
      if (d.dot && !d.screen && dt > 0) {
        const k = 1 - Math.exp(-dt * DOT_FOLLOW);
        d.x += (d.tx - d.x) * k;
        d.y += (d.ty - d.y) * k;
        d.z += (d.tz - d.z) * k;
      }
      let px: number, py: number, distScale = 1;
      if (d.screen) {
        px = d.sx * W;
        py = d.sy * H;
      } else {
        const rx = d.x - camPos.x, ry = d.y - camPos.y, rz = d.z - camPos.z;
        const depth = rx * camFwd.x + ry * camFwd.y + rz * camFwd.z;
        if (depth < 0.3) {
          this.setShown(d, false);
          continue;
        }
        _v.set(d.x, d.y, d.z).project(camera);
        if (_v.x < -1.2 || _v.x > 1.2 || _v.y < -1.2 || _v.y > 1.2) {
          this.setShown(d, false);
          continue;
        }
        px = (_v.x * 0.5 + 0.5) * W;
        py = (-_v.y * 0.5 + 0.5) * H;
        const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
        distScale = Math.min(1.15, Math.max(0.62, 1.25 - dist * 0.014));
      }
      let s: number, a: number;
      if (d.dot) {
        // DOT：只在出生后小幅上浮然后停住（合并会延长寿命，位移不能跟着寿命走，否则会往回掉）；
        // 不弹跳；更暗；最后一跳后 DOT_HOLD 秒内淡出
        const r = Math.min(1, d.age / DOT_RISE_TIME);
        const e = 1 - (1 - r) * (1 - r) * (1 - r);
        px += d.driftX * e * unit;
        py -= d.rise * e * unit;
        s = distScale * Math.max(0.75, unit);
        a = Math.min(1, d.age / 0.08) * Math.min(1, (d.life - d.age) / DOT_FADE) * DOT_ALPHA;
      } else {
        const t = d.age / d.life;
        const e = 1 - (1 - t) * (1 - t) * (1 - t);
        px += d.driftX * e * unit;
        py -= d.rise * e * unit;

        // 弹跳缩放
        const p = d.pop;
        if (d.crit) {
          s = p < 0.07 ? 0.5 + (1.9 - 0.5) * (p / 0.07) : 1 + 0.9 * Math.exp(-(p - 0.07) * 9) * Math.cos((p - 0.07) * 24);
        } else {
          s = p < 0.05 ? 0.7 + (1.35 - 0.7) * (p / 0.05) : 1 + 0.35 * Math.exp(-(p - 0.05) * 14);
        }
        s *= distScale * Math.max(0.75, unit);
        a = t < 0.62 ? 1 : 1 - (t - 0.62) / 0.38;
      }
      this.setShown(d, true);
      d.el.style.transform = `translate3d(${px.toFixed(1)}px,${py.toFixed(1)}px,0) translate(-50%,-50%) scale(${s.toFixed(3)})`;
      const ar = Math.round(a * 50) / 50;
      if (ar !== d.lastOpacity) {
        d.lastOpacity = ar;
        d.el.style.opacity = String(ar);
      }
    }
  }

  private setShown(d: DN, v: boolean): void {
    if (d.shown === v) return;
    d.shown = v;
    d.el.style.display = v ? 'block' : 'none';
  }

  private hide(d: DN): void {
    if (!d.active) return;
    d.active = false;
    this.activeCount--;
    this.setShown(d, false);
  }

  clear(): void {
    for (const d of this.pool) this.hide(d);
    this.activeCount = 0;
    this.dirty = true;
  }
}
