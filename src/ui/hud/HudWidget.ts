/**
 * HUD 部件框架（照译 Unity G/UI/Widgets/HudWidget.cs + HudArt.cs 的颜色 / 按键表）：
 *   HudWidget  一个 HUD 部件：build 建元素树（每个实例一次）、tick 每帧刷新（只写变化了的样式）、onAttach / onDetach 成对订阅事件、
 *              resetState 在换玩家（换关、重来）时清瞬态。一个部件抛异常只报一次，不影响其他部件（Hud 宿主管）。
 *   HudContext 部件看得到的世界：GameContext、面板尺寸、世界 → 面板投影、同宿主的其他部件。
 *   HudFrame   每帧的时间：缩放时间（跟着暂停停的：伤害数字、头顶血条）与不缩放时间（界面动画）。
 * Unity 用 [HudWidget(id, Order, Layer)] 反射登记；网页在 Hud.ts 里列一张表（加部件 = 加一行）。
 */
import * as THREE from 'three';
import type { Action } from '../../core/Input';
import type { GameContext } from '../../core/types';
import { UILayer } from '../toolkit/UILayers';
import { el } from '../toolkit/el';
import { rgb } from '../toolkit/UITheme';

export interface HudFrame {
  /** 缩放时间（暂停 / 模态时为 0） */
  dt: number;
  unscaledDt: number;
  /** 游戏时间（ctx.time.now） */
  time: number;
  /** 不缩放时间（秒） */
  unscaledTime: number;
  frame: number;
  /** 游戏在跑（没有暂停 / 模态界面） */
  playing: boolean;
}

/** HUD 颜色（Unity HudArt：Three.js css/hud.css、combat.css 的值） */
export const HudColors = {
  Reticle: [1, 0.976, 0.933, 0.95] as const,
  ReticleTarget: rgb(0xff5a3c),
  ShieldBlue: rgb(0x63c9ff),
  ArmorGold: rgb(0xffd23f),
  ArmorHi: rgb(0xffe08a),
  Trail: rgb(0xf1d2a6),
  CoinText: rgb(0xf4d58a),
  EssenceText: rgb(0xcfeaff),
  EnemyText: rgb(0xf0b8a8),
  StunBadge: rgb(0xf3e9a6),
  Primed: rgb(0xc89bff),
};

const keyCache = new Map<Action, { label: string; at: number }>();

/** KeyboardEvent.code → 按键提示文字（KeyR → R、Digit1 → 1、ShiftLeft → Shift） */
export function codeLabel(code: string | undefined): string {
  if (!code) return '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code === 'Space') return '空格';
  return code.replace(/(Left|Right)$/, '');
}

/** 按键提示文字（键鼠方案的第一个绑定，「F」「Q」…）：每个动作 2 秒查一次（改键后跟上，不每帧拼串） */
export function keyLabel(ctx: GameContext, action: Action, now: number): string {
  const c = keyCache.get(action);
  if (c && now - c.at < 2 && now >= c.at) return c.label;
  let s = '';
  try {
    s = codeLabel(ctx.input.bindings[action]?.[0]);
  } catch {
    s = '';
  }
  if (!s) s = action;
  keyCache.set(action, { label: s, at: now });
  return s;
}

/** 元素单字（火 / 雷 / 蚀） */
export function elementGlyph(e: string): string {
  return e === 'fire' ? '火' : e === 'shock' ? '雷' : e === 'corrode' ? '蚀' : '';
}

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export class HudContext {
  constructor(
    readonly game: GameContext,
    private readonly containers: Map<UILayer, HTMLElement>,
    private readonly widgets: HudWidget[],
    private readonly panel: { x: number; y: number },
  ) {}

  /** 某一层里这个 HUD 的容器（铺满全屏） */
  container(layer: UILayer): HTMLElement | null {
    return this.containers.get(layer) ?? null;
  }

  /** HUD 层的面板尺寸（设计像素，≥ 1920×1080） */
  get panelSize(): { x: number; y: number } {
    return this.panel;
  }

  /**
   * 世界坐标 → HUD 面板坐标（左上原点）；在相机背后（深度 < minDepth）返回 false。out.z = 沿视线的距离。
   * 按视口比例换算：面板铺满屏幕，相机也画满屏幕
   */
  project(world: THREE.Vector3, out: { x: number; y: number; z: number }, minDepth = 0.3): boolean {
    const cam = this.game.camera;
    cam.getWorldDirection(_f);
    const depth = _v.copy(world).sub(cam.position).dot(_f);
    out.z = depth;
    if (!(depth >= minDepth)) return false;
    _v.copy(world).project(cam);
    if (!Number.isFinite(_v.x) || !Number.isFinite(_v.y)) return false;
    out.x = (_v.x * 0.5 + 0.5) * this.panel.x;
    out.y = (1 - (_v.y * 0.5 + 0.5)) * this.panel.y;
    return true;
  }

  /** 同一个宿主上的另一个部件（没有为 null） */
  widget<T extends HudWidget>(type: abstract new (...args: never[]) => T): T | null {
    for (const w of this.widgets) if (w instanceof type) return w as T;
    return null;
  }
}

export abstract class HudWidget {
  /** 部件 id（Unity [HudWidget(id)]） */
  abstract readonly id: string;
  /** 同层叠放顺序（小的在下）：敌人头顶血条 0、伤害数字 5、受击暗角 10、准星 40、四角 50、提示卡 60 */
  readonly order: number = 50;
  /** 挂在哪一层（缺省 HUD 层；中央大字这类要盖过闪光的放 Overlay） */
  readonly layer: UILayer = UILayer.Hud;
  root!: HTMLElement;
  protected ctx!: HudContext;
  private readonly offs: (() => void)[] = [];

  get visible(): boolean {
    return !!this.root && this.root.style.display !== 'none';
  }

  set visible(v: boolean) {
    if (!this.root) return;
    const d = v ? '' : 'none';
    if (this.root.style.display !== d) this.root.style.display = d;
  }

  attach(ctx: HudContext, parent: HTMLElement): void {
    this.ctx = ctx;
    this.root = this.build() ?? el('sf-widget');
    if (!this.root.dataset.name) this.root.dataset.name = 'hud-' + this.id;
    parent.appendChild(this.root);
    this.onAttach();
  }

  detach(): void {
    try {
      this.onDetach();
      for (const off of this.offs.splice(0)) off();
    } finally {
      this.root?.remove();
    }
  }

  /** 挂上时订阅、拿下时自动退订（onAttach 里用） */
  protected listen(off: () => void): void {
    this.offs.push(off);
  }

  protected get game(): GameContext {
    return this.ctx.game;
  }

  /** 建元素树：返回根元素（宿主把它加进层容器） */
  protected abstract build(): HTMLElement;
  /** 挂上之后：订阅事件 */
  protected onAttach(): void {}
  /** 拿下之前：退订事件 */
  protected onDetach(): void {}
  /** 每帧（玩家与相机都已就位） */
  tick(_f: HudFrame): void {}
  /** 换玩家（换关 / 重来 / 新开一局）：清掉瞬态 */
  resetState(): void {}
}
