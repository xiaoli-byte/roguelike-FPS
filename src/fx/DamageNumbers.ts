/**
 * 伤害数字：DOM 对象池（≤ 80），挂在 ctx.dom.world。
 *
 * - 每帧把世界锚点投影到屏幕，屏幕空间上浮 + 随机漂移 + 淡出；相机背后隐藏。
 * - 暴击：更大、金色描边、弹跳缩放。颜色：护盾蓝 / 护甲黄 / 生命白 / 元素色 / 治疗绿 / 玩家受伤红。
 * - 同一位置短时间内的同类伤害合并成一个数字（霰弹 9 颗弹丸只显示一个总数），合并时再弹一下。
 * - 玩家自己的受伤 / 治疗数字锚在准星下方（锚点离相机太近时）。
 * - 元素反应浮字（kind 'reaction'）：显示 opts.text、颜色取 opts.color，不参与合并，big 时更大（归墟）。
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
/** 反应浮字寿命 */
const REACTION_LIFE = 0.9;

type Kind = DamageLayer | 'heal' | 'player' | 'immune' | 'reaction';

const LAYER_CSS: Record<string, string> = {
  health: '#ffffff',
  shield: '#63c9ff',
  armor: '#ffd23f',
  heal: '#6dff8a',
  player: '#ff4a3d',
  immune: '#b9bec8',
  reaction: '#ffd84a',
};

function hexCss(hex: number): string {
  return '#' + (hex & 0xffffff).toString(16).padStart(6, '0');
}

/** 反应浮字颜色的 CSS 缓存（颜色种类很少） */
const reactionCss = new Map<number, string>();
function reactionColor(hex: number | undefined): string {
  if (hex === undefined || !Number.isFinite(hex)) return LAYER_CSS.reaction;
  let css = reactionCss.get(hex);
  if (!css) {
    css = hexCss(hex);
    reactionCss.set(hex, css);
  }
  return css;
}

const ELEMENT_CSS: Record<Element, string> = {
  none: LAYER_CSS.health,
  fire: hexCss(ELEMENT_COLORS.fire),
  shock: hexCss(ELEMENT_COLORS.shock),
  corrode: hexCss(ELEMENT_COLORS.corrode),
};

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
.fx-dn.fx-dn-small { font-size: 16px; font-weight: 800; }
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
.fx-dn.fx-dn-reaction {
  font-size: 20px; font-weight: 900; letter-spacing: 3px;
  padding: 3px 6px 3px 9px; border-radius: 3px;
  background: rgba(10, 6, 12, 0.72);
  box-shadow: inset 0 0 0 1px currentColor, 0 2px 8px rgba(0, 0, 0, 0.6);
  text-shadow:
    2px 0 0 #000, -2px 0 0 #000, 0 2px 0 #000, 0 -2px 0 #000,
    1.5px 1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px -1.5px 0 #000;
}
.fx-dn.fx-dn-reaction-big { font-size: 25px; padding: 4px 8px 4px 11px; }
`;

interface DN {
  el: HTMLDivElement;
  active: boolean;
  /** 世界锚点 */
  x: number; y: number; z: number;
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
  kind: Kind;
  element: Element;
  amount: number;
  /** 反应浮字的文本（其他种类为空串） */
  text: string;
  stamp: number;
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
        el, active: false, x: 0, y: 0, z: 0, screen: false, sx: 0.5, sy: 0.5, age: 0, life: 1, pop: 0,
        driftX: 0, rise: 0, crit: false, kind: 'health', element: 'none', amount: 0, text: '', stamp: 0,
        shown: false, lastOpacity: -1, className: 'fx-dn',
      });
    }
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
  }

  private onResize(): void {
    this.width = window.innerWidth || 1920;
    this.height = window.innerHeight || 1080;
  }

  /**
   * 生成一个数字。camPos 用于判断锚点是否贴着相机（玩家自身的受伤 / 治疗）。
   */
  spawn(pos: THREE.Vector3, amount: number, opts: DamageNumberOpts | undefined, camPos: THREE.Vector3): void {
    if (!this.host || this.pool.length === 0) return;
    const kind: Kind = opts?.kind ?? 'health';
    if (kind === 'reaction') {
      this.spawnReaction(pos, opts);
      return;
    }
    const crit = !!opts?.crit && kind !== 'heal' && kind !== 'player' && kind !== 'immune';
    const element: Element = opts?.element ?? 'none';
    if (kind !== 'immune' && !(amount > 0)) return;

    const screen = (kind === 'player' || kind === 'heal') && pos.distanceToSquared(camPos) < 2.6 * 2.6;

    // 合并：同类、同暴击、同元素、锚点相近、仍在合并窗口内
    if (!screen && kind !== 'immune') {
      for (const d of this.pool) {
        if (!d.active || d.screen || d.kind !== kind || d.crit !== crit || d.element !== element) continue;
        if (d.age > MERGE_WINDOW) continue;
        const dx = d.x - pos.x, dy = d.y - pos.y, dz = d.z - pos.z;
        if (dx * dx + dy * dy + dz * dz > MERGE_DIST_SQ) continue;
        d.amount += amount;
        d.el.textContent = this.format(d.amount, kind);
        d.pop = 0;
        d.life = Math.min(d.life + 0.12, crit ? 1.6 : 1.3);
        return;
      }
    }

    const d = this.take();
    d.active = true;
    d.screen = screen;
    if (screen) {
      d.sx = 0.5 + (Math.random() - 0.5) * 0.08;
      d.sy = kind === 'heal' ? 0.6 : 0.57;
    } else {
      d.x = pos.x + (Math.random() - 0.5) * 0.35;
      d.y = pos.y + (Math.random() - 0.5) * 0.2 + 0.15;
      d.z = pos.z + (Math.random() - 0.5) * 0.35;
    }
    d.age = 0;
    d.pop = 0;
    d.life = crit ? 1.2 : kind === 'immune' ? 0.8 : 0.95;
    d.driftX = (Math.random() - 0.5) * (crit ? 70 : 55);
    d.rise = crit ? 70 : kind === 'player' ? 45 : 58;
    d.crit = crit;
    d.kind = kind;
    d.element = element;
    d.amount = kind === 'immune' ? 0 : amount;
    d.text = '';
    d.stamp = ++this.stamp;

    let cls = 'fx-dn';
    if (crit) cls += ' fx-dn-crit';
    else if (kind === 'player') cls += ' fx-dn-player';
    else if (kind === 'heal') cls += ' fx-dn-heal';
    else if (kind === 'immune') cls += ' fx-dn-immune';
    else if (amount < 5 && element !== 'none') cls += ' fx-dn-small';
    if (cls !== d.className) {
      d.el.className = cls;
      d.className = cls;
    }
    d.el.style.color = this.colorFor(kind, element, crit);
    d.el.textContent = this.format(d.amount, kind);
    d.lastOpacity = -1;
    this.activeCount++;
  }

  /** 反应浮字：允许 amount 为 0、不参与合并、寿命 0.9 秒，文本 / 颜色取自 opts */
  private spawnReaction(pos: THREE.Vector3, opts: DamageNumberOpts | undefined): void {
    const text = opts?.text;
    if (!text) return;
    const big = !!opts?.big;
    const d = this.take();
    d.active = true;
    d.screen = false;
    d.x = pos.x + (Math.random() - 0.5) * 0.2;
    d.y = pos.y;
    d.z = pos.z + (Math.random() - 0.5) * 0.2;
    d.age = 0;
    d.pop = 0;
    d.life = REACTION_LIFE;
    d.driftX = (Math.random() - 0.5) * 24;
    d.rise = big ? 46 : 40;
    d.crit = false;
    d.kind = 'reaction';
    d.element = 'none';
    d.amount = 0;
    d.text = text;
    d.stamp = ++this.stamp;
    const cls = big ? 'fx-dn fx-dn-reaction fx-dn-reaction-big' : 'fx-dn fx-dn-reaction';
    if (cls !== d.className) {
      d.el.className = cls;
      d.className = cls;
    }
    d.el.style.color = reactionColor(opts?.color);
    d.el.textContent = text;
    d.lastOpacity = -1;
    this.activeCount++;
  }

  private colorFor(kind: Kind, element: Element, crit: boolean): string {
    if (kind === 'heal' || kind === 'player' || kind === 'immune' || kind === 'shield' || kind === 'armor') return LAYER_CSS[kind];
    if (element !== 'none') return ELEMENT_CSS[element];
    return crit ? '#ffe46b' : LAYER_CSS.health;
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
      const t = d.age / d.life;
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      px += d.driftX * e * unit;
      py -= d.rise * e * unit;

      // 弹跳缩放
      let s: number;
      const p = d.pop;
      if (d.crit) {
        s = p < 0.07 ? 0.5 + (1.9 - 0.5) * (p / 0.07) : 1 + 0.9 * Math.exp(-(p - 0.07) * 9) * Math.cos((p - 0.07) * 24);
      } else {
        s = p < 0.05 ? 0.7 + (1.35 - 0.7) * (p / 0.05) : 1 + 0.35 * Math.exp(-(p - 0.05) * 14);
      }
      s *= distScale * Math.max(0.75, unit);

      const a = t < 0.62 ? 1 : 1 - (t - 0.62) / 0.38;
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
  }
}
