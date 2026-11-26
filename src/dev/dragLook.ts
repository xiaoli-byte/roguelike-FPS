/**
 * 拖动转视角：检视页锁不上鼠标时的后备。
 *
 * Claude 桌面应用自带的浏览器面板不让网页锁定鼠标（requestPointerLock 报 WrongDocumentError），
 * 检视页的鼠标视角只在锁定时生效，于是在面板里完全转不了视角。锁定失败一次就切到拖动模式：
 * 在画面上按住左键或右键拖动转视角（右键菜单屏蔽掉）；能锁定的浏览器照旧走锁定 + 原始输入。
 */
export class DragLook {
  /** 锁定失败过：拖动模式 */
  active = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly canvas: HTMLElement,
    private readonly look: (dx: number, dy: number) => void,
    private readonly onFallback?: () => void,
  ) {
    canvas.addEventListener('mousedown', (e) => {
      if (!this.active || document.pointerLockElement === canvas || (e.button !== 0 && e.button !== 2)) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      if (!(e.buttons & 3)) { this.dragging = false; return; }   // 在窗口外松开的键
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.look(dx, dy);
    });
    addEventListener('mouseup', (e) => { if (!(e.buttons & 3)) this.dragging = false; });
    addEventListener('blur', () => { this.dragging = false; });
    canvas.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
    document.addEventListener('pointerlockerror', () => this.fail());
  }

  /** 锁定失败时调（重复调没关系） */
  fail(): void {
    if (this.active) return;
    this.active = true;
    this.onFallback?.();
  }
}

/**
 * 申请锁定鼠标：优先原始输入（unadjustedMovement），不支持就退回普通锁定，都锁不上就切到拖动模式。
 * 在画面的 click 里调（要用户手势）。
 */
export async function lockPointerOrDrag(canvas: HTMLElement, drag: DragLook): Promise<void> {
  if (drag.active) return;
  try {
    await canvas.requestPointerLock({ unadjustedMovement: true });
  } catch (error) {
    if (error instanceof Error && error.name === 'NotSupportedError') {
      try { await canvas.requestPointerLock(); } catch { drag.fail(); }
    } else {
      drag.fail();
    }
  }
}
