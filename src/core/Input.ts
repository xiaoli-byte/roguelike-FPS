/**
 * 键鼠输入。按「动作」查询（down/pressed/released），按帧结算。
 * 鼠标位移仅在指针锁定（或 freeLook 调试模式）时累积。
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'dash' | 'reload' | 'interact'
  | 'skillPrimary' | 'skillSecondary'
  | 'weapon1' | 'weapon2' | 'swapWeapon'
  | 'pause' | 'inventory'
  | 'fire' | 'aim';

/** 键盘动作绑定（KeyboardEvent.code）。fire/aim 走鼠标按键。 */
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
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  swapWeapon: ['KeyX'],
  pause: ['Escape', 'KeyP'],
  inventory: ['Tab'],
  fire: [],
  aim: [],
};

const MOUSE_ACTIONS: Partial<Record<Action, number>> = { fire: 0, aim: 2 };

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
    window.addEventListener('blur', () => this.releaseAll());

    window.addEventListener('mousedown', (e) => {
      if (!this.locked && !this.freeLook && e.target !== canvas) return;
      this.buttons.add(e.button);
      this.buttonsPressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.buttons.delete(e.button);
      this.buttonsReleased.add(e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.freeLook) return;
      // 过滤部分浏览器在指针锁定下偶发的巨大跳变
      const dx = Math.abs(e.movementX) > 400 ? 0 : e.movementX;
      const dy = Math.abs(e.movementY) > 400 ? 0 : e.movementY;
      this.mouseDX += dx;
      this.mouseDY += dy;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked && !this.freeLook) return;
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });

    document.addEventListener('pointerlockchange', () => {
      const now = document.pointerLockElement === canvas;
      if (now === this.locked) return;
      this.locked = now;
      if (!now) this.releaseAll();
      this.onLockChange?.(now);
    });
    document.addEventListener('pointerlockerror', () => {
      console.warn('[Input] pointer lock request failed');
    });
  }

  get pointerLocked(): boolean {
    return this.locked;
  }

  /** 需要在用户手势中调用 */
  requestLock(): void {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: false } as any) as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => undefined);
    } catch {
      /* 某些环境不支持 */
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
  }

  releaseAll(): void {
    for (const k of this.keys) this.keysReleased.add(k);
    for (const b of this.buttons) this.buttonsReleased.add(b);
    this.keys.clear();
    this.buttons.clear();
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
