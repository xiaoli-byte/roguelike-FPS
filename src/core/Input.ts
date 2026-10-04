/**
 * 键鼠输入。按「动作」查询（down/pressed/released），按帧结算。
 * 鼠标位移仅在指针锁定（或 freeLook 调试模式）时累积。
 */
import { MouseLookFilter } from './MouseLookFilter';

export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'dash' | 'reload' | 'interact'
  | 'skillPrimary' | 'skillSecondary' | 'weaponSkill'
  | 'weapon1' | 'weapon2' | 'swapWeapon'
  | 'pause' | 'inventory'
  | 'fire' | 'aim';

/** 键盘动作绑定（KeyboardEvent.code）。fire / aim 走鼠标按键；weaponSkill 键盘 V 与鼠标中键都可触发。 */
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  reload: ['KeyR'],
  interact: ['KeyF'],
  skillPrimary: ['KeyQ'],
  skillSecondary: ['KeyE'],
  /** 武器技能（魔刀千刃「千刃·无间」）；另绑定鼠标中键，见 MOUSE_ACTIONS */
  weaponSkill: ['KeyV'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  swapWeapon: ['KeyX'],
  pause: ['Escape', 'KeyP'],
  inventory: ['Tab'],
  fire: [],
  aim: [],
};

/** 鼠标按键绑定（MouseEvent.button）：0 左键 / 1 中键 / 2 右键 */
const MOUSE_ACTIONS: Partial<Record<Action, number>> = { fire: 0, aim: 2, weaponSkill: 1 };
/** 鼠标中键：按下时 preventDefault，避免浏览器进入自动滚动 / 中键粘贴 */
const MIDDLE_BUTTON = 1;

const PREVENT_DEFAULT = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6']);

export class Input {
  readonly canvas: HTMLCanvasElement;
  bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);

  /** 为 false 时 down/pressed 一律返回 false（例如打开模态框时） */
  enabled = true;
  /** 调试：未锁定指针也累积鼠标位移 */
  freeLook = false;

  /** 本帧（上次 endFrame 以来）鼠标位移，像素 */
  mouseDX = 0;
  mouseDY = 0;
  /** 本帧滚轮累计（>0 向下） */
  wheel = 0;

  /** 指针锁定状态变化回调（Game 设置） */
  onLockChange: ((locked: boolean) => void) | null = null;

  private keys = new Set<string>();
  private keysPressed = new Set<string>();
  private keysReleased = new Set<string>();
  private buttons = new Set<number>();
  private buttonsPressed = new Set<number>();
  private buttonsReleased = new Set<number>();
  private locked = false;
  private focused = true;
  private ignoreMouseUntil = 0;
  private readonly lookFilter = new MouseLookFilter();
  private lockRequestPending = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.keysPressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.keysReleased.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.focused = false;
      this.releaseAll();
    });
    window.addEventListener('focus', () => {
      this.focused = true;
      this.flushMouse();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });

    window.addEventListener('mousedown', (e) => {
      if (!this.locked && !this.freeLook && e.target !== canvas) return;
      if (e.button === MIDDLE_BUTTON) e.preventDefault();
      this.buttons.add(e.button);
      this.buttonsPressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.buttons.delete(e.button);
      this.buttonsReleased.add(e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || !this.focused || document.hidden) return;
      if (!this.freeLook && (!this.locked || document.pointerLockElement !== canvas)) return;
      if (performance.now() < this.ignoreMouseUntil) return;
      const delta = this.lookFilter.sample(e.movementX, e.movementY, e.timeStamp);
      this.mouseDX += delta.x;
      this.mouseDY += delta.y;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked && !this.freeLook) return;
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    // 中键单击（auxclick）在部分浏览器会打开链接 / 粘贴：游戏中一律拦截
    window.addEventListener('auxclick', (e) => {
      if (e.button === MIDDLE_BUTTON && (this.locked || e.target === canvas)) e.preventDefault();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });

    document.addEventListener('pointerlockchange', () => {
      const now = document.pointerLockElement === canvas;
      this.lockRequestPending = false;
      if (now === this.locked) return;
      this.locked = now;
      this.flushMouse();
      // 锁定时浏览器会重定位光标，短暂忽略这段过渡事件。
      this.ignoreMouseUntil = now ? performance.now() + 50 : 0;
      if (!now) this.releaseAll();
      this.onLockChange?.(now);
    });
    document.addEventListener('pointerlockerror', () => {
      this.lockRequestPending = false;
      console.warn('[Input] pointer lock request failed');
    });
  }

  get pointerLocked(): boolean {
    return this.locked;
  }

  /** 需要在用户手势中调用 */
  requestLock(): void {
    if (this.locked || this.lockRequestPending) return;
    this.lockRequestPending = true;
    void this.acquireLock();
  }

  private async acquireLock(): Promise<void> {
    try {
      // 优先原始输入，避免操作系统鼠标加速放大异常位移。
      await this.canvas.requestPointerLock({ unadjustedMovement: true });
    } catch (error) {
      if (error instanceof Error && error.name === 'NotSupportedError') {
        try {
          await this.canvas.requestPointerLock();
        } catch {
          /* 失败由 pointerlockerror 通知；保持未锁定状态 */
        }
      }
    } finally {
      this.lockRequestPending = false;
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(action: Action): boolean {
    if (!this.enabled) return false;
    const b = MOUSE_ACTIONS[action];
    if (b !== undefined && this.buttons.has(b)) return true;
    for (const c of this.bindings[action]) if (this.keys.has(c)) return true;
    return false;
  }

  pressed(action: Action): boolean {
    if (!this.enabled) return false;
    const b = MOUSE_ACTIONS[action];
    if (b !== undefined && this.buttonsPressed.has(b)) return true;
    for (const c of this.bindings[action]) if (this.keysPressed.has(c)) return true;
    return false;
  }

  released(action: Action): boolean {
    const b = MOUSE_ACTIONS[action];
    if (b !== undefined && this.buttonsReleased.has(b)) return true;
    for (const c of this.bindings[action]) if (this.keysReleased.has(c)) return true;
    return false;
  }

  /** 原始按键查询（不受 enabled 影响），用于调试快捷键 */
  keyDown(code: string): boolean {
    return this.keys.has(code);
  }

  keyPressed(code: string): boolean {
    return this.keysPressed.has(code);
  }

  mouseDown(button: number): boolean {
    return this.enabled && this.buttons.has(button);
  }

  /** 每帧末尾调用 */
  endFrame(): void {
    this.keysPressed.clear();
    this.keysReleased.clear();
    this.buttonsPressed.clear();
    this.buttonsReleased.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  /** 丢弃本帧累积的鼠标位移（例如解除暂停时） */
  flushMouse(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.lookFilter.reset();
  }

  releaseAll(): void {
    for (const k of this.keys) this.keysReleased.add(k);
    for (const b of this.buttons) this.buttonsReleased.add(b);
    this.keys.clear();
    this.buttons.clear();
    this.keysPressed.clear();
    this.buttonsPressed.clear();
    this.flushMouse();
    this.wheel = 0;
  }

  /** 测试/自动化：模拟按键 */
  simulateKey(code: string, isDown: boolean): void {
    if (isDown) {
      if (!this.keys.has(code)) this.keysPressed.add(code);
      this.keys.add(code);
    } else {
      this.keys.delete(code);
      this.keysReleased.add(code);
    }
  }

  simulateButton(button: number, isDown: boolean): void {
    if (isDown) {
      if (!this.buttons.has(button)) this.buttonsPressed.add(button);
      this.buttons.add(button);
    } else {
      this.buttons.delete(button);
      this.buttonsReleased.add(button);
    }
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}
