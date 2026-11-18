/**
 * 界面路由（照译 Unity G/UI/Toolkit/UIRouter.cs）：open / close / back 管一个界面栈。
 *   · 每个界面一个实例（register 登记，按 id 打开）；已经开着再打开 = 提到栈顶、再调一次 onOpen。
 *   · 界面挂在自己的层（缺省界面层 Modal）的层容器里；打开 = 放到最上面并显示，关上 = 拿下来。
 *   · 挡游戏的界面（blockState 非空）开着时 blocking 为真：HUD 淡出（Unity 压 GameStateMachine；网页的暂停 / 模态状态由 Game 管，
 *     界面只负责显示，见 UI.ts）。
 *   · 返回（Esc）：栈顶界面先自己处理（onBack 返回 true，比如设置页里正在改键），不处理就关掉它。
 *   · 键盘：方向键按空间位置移焦点（按住 0.4 s 后每 0.11 s 连发），回车 / 空格激活焦点元素，滑条在左右方向上直接调值（元素上的 sfNudge）。
 *   · 关掉栈顶界面时，焦点回到下面那个界面里、打开它之前的那个元素。
 * DOM 只经由 RouterHost 与少量元素方法（appendChild / remove / contains / focus / getBoundingClientRect / querySelectorAll），测试用假元素即可。
 */
import type { UILayer } from './UILayers';

/** 界面层（缺省） */
const MODAL_LAYER = 2 as UILayer;

/** 挡游戏时对应的游戏状态（Unity GameState.Modal / Paused / Summary / Menu） */
export type BlockState = 'modal' | 'paused' | 'summary' | 'menu';

/** 一个界面（暂停、设置、三选一、主菜单、结算…）。一般继承 UIScreen */
export interface IScreen {
  /** 路由 id（pause、settings、scroll-choice…） */
  readonly id: string;
  /** 挂在哪一层（缺省界面层 Modal） */
  readonly layer: UILayer;
  /** 打开时挡游戏的状态；null = 不挡游戏 */
  readonly blockState: BlockState | null;
  /** 挡游戏时是否同时停住时间 */
  readonly freezeTime: boolean;
  /** 打开后先聚焦的元素（null = 第一个可聚焦元素） */
  readonly defaultFocus: HTMLElement | null;
  /** 建界面（每个实例只调一次，之后复用） */
  createRoot(): HTMLElement;
  /** 打开（每次都调；arg = open 的参数） */
  onOpen(arg?: unknown): void;
  /** 关上（从栈里拿掉之后） */
  onClose(): void;
  /** 返回键：自己处理了返回 true，否则路由关掉这个界面 */
  onBack(): boolean;
  /** 在栈顶时每帧调用（不缩放时间，秒） */
  tick(dt: number): void;
  /** 方向键：自己处理了返回 true，否则路由按空间位置移动焦点。y = 1 是向上（同 Unity） */
  onNavigate(dx: number, dy: number): boolean;
  /** 其余按键（设置页的 Q / E 切页签；Unity 是界面 Tick 里读动作表）：处理了返回 true */
  onKey?(code: string): boolean;
}

/** 界面基类：缺省在界面层、挡游戏（modal）并停时间，返回键关自己；子类只写 build 和需要的钩子 */
export abstract class UIScreen implements IScreen {
  abstract readonly id: string;
  get layer(): UILayer {
    return MODAL_LAYER;
  }
  get blockState(): BlockState | null {
    return 'modal';
  }
  get freezeTime(): boolean {
    return true;
  }
  get defaultFocus(): HTMLElement | null {
    return null;
  }
  /** 界面根元素（build 的结果；打开过一次之后才有） */
  root: HTMLElement | null = null;
  /** 打开着时的路由（关自己用） */
  router: ScreenRouter | null = null;

  createRoot(): HTMLElement {
    const r = this.build();
    r.classList.add('sf-screen');
    this.root = r;
    return r;
  }

  /** 建界面：返回根元素（铺满全屏的 .sf-screen 由基类加上类名） */
  protected abstract build(): HTMLElement;
  onOpen(_arg?: unknown): void {}
  onClose(): void {}
  onBack(): boolean {
    return false;
  }
  tick(_dt: number): void {}
  onNavigate(_dx: number, _dy: number): boolean {
    return false;
  }
  get isOpen(): boolean {
    return !!this.router?.isOpen(this);
  }
  /** 关掉自己 */
  close(): void {
    this.router?.close(this);
  }
}

/** 路由需要的外部能力（UIRoot 提供；测试给假的） */
export interface RouterHost {
  /** 某一层的内容容器 */
  layer(layer: UILayer): HTMLElement | null;
  /** 当前焦点元素 */
  focused(): HTMLElement | null;
  /** 不缩放时间（秒） */
  now(): number;
  /** 界面音：激活 / 移焦点 / 返回 */
  sound?(kind: 'click' | 'hover' | 'back', el: HTMLElement | null): void;
}

interface Entry {
  screen: IScreen;
  root: HTMLElement;
  restoreFocus: HTMLElement | null;
  focusPending: boolean;
  focusTries: number;
}

/** 按住方向键：0.4 s 后开始连发，每 0.11 s 一次 */
export const REPEAT_DELAY = 0.4;
export const REPEAT_INTERVAL = 0.11;

/** 可聚焦元素（按钮、表单控件、tabindex ≥ 0） */
export const FOCUSABLE = 'button, input, select, textarea, [tabindex]';

type Listener = (s: IScreen) => void;

export class ScreenRouter {
  private readonly stack: Entry[] = [];
  private readonly roots = new Map<IScreen, HTMLElement>();
  private readonly instances = new Map<string, IScreen>();
  private readonly opened: Listener[] = [];
  private readonly closed: Listener[] = [];
  private heldX = 0;
  private heldY = 0;
  private nextRepeat = 0;

  constructor(private readonly host: RouterHost) {}

  // ───────────── 查询 ─────────────

  /** 栈顶界面（没有为 null） */
  get top(): IScreen | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1].screen : null;
  }

  get count(): number {
    return this.stack.length;
  }

  /** 有挡游戏的界面开着 */
  get blocking(): boolean {
    return this.stack.some((e) => e.screen.blockState !== null);
  }

  /** 栈里最上面一个挡游戏界面的状态（没有为 null） */
  get blockState(): BlockState | null {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const b = this.stack[i].screen.blockState;
      if (b) return b;
    }
    return null;
  }

  /** 从下到上的 id（测试 / 调试用） */
  get ids(): string[] {
    return this.stack.map((e) => e.screen.id);
  }

  isOpen(screen: IScreen | string): boolean {
    return typeof screen === 'string' ? this.find(screen) !== null : this.indexOf(screen) >= 0;
  }

  /** 栈里 id 对应的界面（没打开为 null） */
  find(id: string): IScreen | null {
    for (let i = this.stack.length - 1; i >= 0; i--) if (this.stack[i].screen.id === id) return this.stack[i].screen;
    return null;
  }

  /** 打开 / 关上时（打开在 onOpen 之后，关上在 onClose 之后） */
  onOpened(fn: Listener): () => void {
    this.opened.push(fn);
    return () => remove(this.opened, fn);
  }

  onClosed(fn: Listener): () => void {
    this.closed.push(fn);
    return () => remove(this.closed, fn);
  }

  // ───────────── 登记 ─────────────

  /** 登记一个界面实例（同 id 覆盖） */
  register(screen: IScreen): IScreen {
    if (screen?.id) this.instances.set(screen.id, screen);
    return screen;
  }

  get(id: string): IScreen | null {
    return this.instances.get(id) ?? null;
  }

  /** 已登记的界面 id（排序） */
  get registered(): string[] {
    return [...this.instances.keys()].sort();
  }

  // ───────────── 开 / 关 ─────────────

  /** 按 id 或实例打开（已经开着就提到栈顶并再调一次 onOpen）；没登记 / 建不起来返回 false */
  open(target: string | IScreen, arg?: unknown): boolean {
    const screen = typeof target === 'string' ? this.get(target) : target;
    if (!screen) {
      console.error(`[UI] 没有登记界面「${String(target)}」`);
      return false;
    }
    let root = this.roots.get(screen) ?? null;
    if (!root) {
      root = screen.createRoot();
      if (!root) return false;
      this.roots.set(screen, root);
    }
    const existing = this.indexOf(screen);
    let restore = this.host.focused();
    if (existing >= 0) {
      restore = this.stack[existing].restoreFocus;
      this.stack.splice(existing, 1);
    }
    const layerRoot = this.host.layer(screen.layer);
    // 放到层容器最后 = 画在同层其他界面上面（BringToFront）
    if (layerRoot) layerRoot.appendChild(root);
    root.style.display = '';
    if (screen instanceof UIScreen) screen.router = this;
    this.stack.push({ screen, root, restoreFocus: restore, focusPending: true, focusTries: 0 });
    this.heldX = this.heldY = 0;
    screen.onOpen(arg);
    for (const fn of this.opened.slice()) fn(screen);
    return true;
  }

  /** 关掉一个界面（不必在栈顶）；没开着返回 false */
  close(target: string | IScreen): boolean {
    const screen = typeof target === 'string' ? this.find(target) : target;
    if (!screen) return false;
    const i = this.indexOf(screen);
    if (i < 0) return false;
    const entry = this.stack[i];
    const wasTop = i === this.stack.length - 1;
    this.stack.splice(i, 1);
    entry.root.style.display = 'none';
    entry.root.remove();
    screen.onClose();
    if (wasTop && this.stack.length > 0) {
      // 焦点回到下面那个界面里打开它之前的元素
      const top = this.stack[this.stack.length - 1];
      const v = entry.restoreFocus;
      if (v && v.isConnected !== false && top.root.contains(v)) v.focus();
      else top.focusPending = true;
    } else if (wasTop) this.host.focused()?.blur?.();
    for (const fn of this.closed.slice()) fn(screen);
    return true;
  }

  /** 返回：栈顶界面先自己处理（onBack），不处理就关掉它。栈空返回 false */
  back(): boolean {
    const top = this.top;
    if (!top) return false;
    if (!top.onBack()) this.close(top);
    this.host.sound?.('back', null);
    return true;
  }

  /** 全部关掉（换关、回主菜单） */
  closeAll(): void {
    for (let i = this.stack.length - 1; i >= 0; i--) if (i < this.stack.length) this.close(this.stack[i].screen);
  }

  private indexOf(screen: IScreen): number {
    for (let i = this.stack.length - 1; i >= 0; i--) if (this.stack[i].screen === screen) return i;
    return -1;
  }

  // ───────────── 每帧 / 输入 ─────────────

  /** 每帧（不缩放时间）：栈顶界面的 tick、等待中的聚焦、按住方向键的连发 */
  tick(dt: number): void {
    if (this.stack.length === 0) {
      this.heldX = this.heldY = 0;
      return;
    }
    const entry = this.stack[this.stack.length - 1];
    if (entry.focusPending) this.tryInitialFocus(entry);
    entry.screen.tick(dt);
    if (this.stack.length === 0 || this.stack[this.stack.length - 1] !== entry) return;
    if (this.heldX === 0 && this.heldY === 0) return;
    const now = this.host.now();
    if (now >= this.nextRepeat) {
      this.nextRepeat = now + REPEAT_INTERVAL;
      this.navigate(this.heldX, this.heldY);
    }
  }

  /**
   * 键盘（UI.ts 在捕获阶段转进来）：down = 按下 / 抬起。栈空返回 false；处理了返回 true（调用方阻止默认行为）。
   * Esc = 返回，回车 / 空格 = 激活焦点元素（焦点在按钮上时浏览器自己会点，这里不重复），方向键 = 移焦点。
   */
  key(code: string, down: boolean, repeat = false): boolean {
    if (this.stack.length === 0) return false;
    const dir = ARROWS[code];
    if (dir) {
      if (!down) {
        if (this.heldX === dir[0] && this.heldY === dir[1]) this.heldX = this.heldY = 0;
        return true;
      }
      if (repeat) return true;
      this.heldX = dir[0];
      this.heldY = dir[1];
      this.nextRepeat = this.host.now() + REPEAT_DELAY;
      this.navigate(dir[0], dir[1]);
      return true;
    }
    if (!down || repeat) return false;
    if (code === 'Escape') return this.back();
    if (this.stack[this.stack.length - 1].screen.onKey?.(code)) return true;
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') return this.submit();
    return false;
  }

  /** 激活焦点元素（回车）：点它一下（按钮音由按钮自己的点击处理出） */
  submit(): boolean {
    const v = this.host.focused();
    if (!v || !this.isInTop(v)) return false;
    if ((v as HTMLButtonElement).disabled) {
      this.host.sound?.('click', v);
      return false;
    }
    v.click();
    return true;
  }

  /** 方向导航：界面自己先处理；滑条左右直接调值；否则按空间位置把焦点移到那个方向最近的元素（到头了绕回另一端）。y = 1 是向上 */
  navigate(dx: number, dy: number): boolean {
    const top = this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
    if (!top || (dx === 0 && dy === 0)) return false;
    if (top.screen.onNavigate(dx, dy)) return true;
    let current = this.host.focused();
    if (current && !this.isInTop(current)) current = null;
    if (current && dy === 0 && nudge(current, top.root, dx)) {
      this.host.sound?.('hover', current);
      return true;
    }
    const candidates = collectFocusable(top.root);
    const next = current === null ? candidates[0] ?? null : spatialPick(candidates.map((el) => ({ el, rect: el.getBoundingClientRect() })), current.getBoundingClientRect(), dx, dy, current);
    if (!next || next === current) return false;
    next.focus();
    this.host.sound?.('hover', next);
    return true;
  }

  private isInTop(v: HTMLElement): boolean {
    return this.stack.length > 0 && this.stack[this.stack.length - 1].root.contains(v);
  }

  private tryInitialFocus(entry: Entry): void {
    // 新加进页面的元素要等一帧排版完才看得见：拿不到就下一帧再试（最多 10 帧）
    let target = entry.screen.defaultFocus;
    if (!target || !canFocus(target)) target = collectFocusable(entry.root)[0] ?? null;
    if (target && canFocus(target)) {
      target.focus({ preventScroll: true });
      entry.focusPending = false;
    } else if (++entry.focusTries > 10) entry.focusPending = false;
  }
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

function remove<T>(list: T[], item: T): void {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}

/** 焦点在滑条（或滑条内部）上时左右直接调值：元素上挂了 sfNudge(sign) 的就是（SettingsScreen 的滑条） */
function nudge(focused: HTMLElement, root: HTMLElement, sign: number): boolean {
  for (let e: HTMLElement | null = focused; e && e !== root.parentElement; e = e.parentElement) {
    const fn = (e as HTMLElement & { sfNudge?: (s: number) => void }).sfNudge;
    if (typeof fn === 'function') {
      fn.call(e, sign);
      return true;
    }
  }
  return false;
}

/** 能拿焦点：没禁用、tabIndex ≥ 0、看得见（有尺寸） */
export function canFocus(e: HTMLElement | null): e is HTMLElement {
  if (!e) return false;
  if ((e as HTMLButtonElement).disabled) return false;
  if (typeof e.tabIndex === 'number' && e.tabIndex < 0) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** 可聚焦元素（文档顺序）；复合控件只算最外层那个，它内部可聚焦的子元素不单独占一格 */
export function collectFocusable(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const set = new Set<HTMLElement>();
  for (const e of Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))) {
    if (!canFocus(e)) continue;
    let inside = false;
    for (let p = e.parentElement; p && p !== root; p = p.parentElement) {
      if (set.has(p)) {
        inside = true;
        break;
      }
    }
    if (inside) continue;
    out.push(e);
    set.add(e);
  }
  return out;
}

export interface NavRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 空间导航（照译 UIRouter.Spatial）：方向上（屏幕坐标 y 向下，dy = 1 是向上）中心点在前方的候选里，取「前进距离 + 2 × 横向偏移」最小的；
 * 前方没有就绕回：取反方向最远、横向偏移最小的
 */
export function spatialPick<T>(candidates: { el: T; rect: NavRect }[], from: NavRect, dx: number, dy: number, self?: T): T | null {
  const sx = dx, sy = -dy;
  const cx = from.left + from.width / 2, cy = from.top + from.height / 2;
  let best: T | null = null, wrap: T | null = null;
  let bestScore = Infinity, wrapScore = Infinity;
  for (const c of candidates) {
    if (c.el === self) continue;
    const ex = c.rect.left + c.rect.width / 2 - cx, ey = c.rect.top + c.rect.height / 2 - cy;
    const along = ex * sx + ey * sy;
    const across = Math.abs(sx !== 0 ? ey : ex);
    if (along > 1) {
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = c.el;
      }
    } else if (along < -1) {
      const score = along + across * 2; // 越负越远
      if (score < wrapScore) {
        wrapScore = score;
        wrap = c.el;
      }
    }
  }
  return best ?? wrap;
}
