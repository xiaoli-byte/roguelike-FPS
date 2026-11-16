/**
 * 登场演出的画面层（Unity Bosses/Intro/CinematicOverlay.cs）：上下黑边、电影式名字卡（场地小字 + 首领名 + 称号）、按住跳过的提示与进度。
 * DOM + CSS（挂在 ctx.dom.ui 上），按真实时间推进；dispose 时整块移除。
 */

const STYLE_ID = 'boss-intro-overlay-style';
const CSS = `
.bio-root{position:absolute;inset:0;pointer-events:none;z-index:40;overflow:hidden;font-family:"Noto Serif SC","Songti SC",serif}
.bio-bar{position:absolute;left:0;right:0;height:11vh;background:#000;transform:scaleY(0)}
.bio-bar.top{top:0;transform-origin:top}.bio-bar.bottom{bottom:0;transform-origin:bottom}
.bio-cap{position:absolute;left:8vw;bottom:17vh;color:#f6e7c8;opacity:0;text-shadow:0 2px 12px rgba(0,0,0,.75);transition:opacity .6s}
.bio-cap .ep{font-size:1.5vh;letter-spacing:.5em;color:#d9b27a;margin-bottom:.8vh}
.bio-cap .nm{font-size:7vh;letter-spacing:.35em;line-height:1}
.bio-cap .tt{font-size:2.2vh;letter-spacing:.6em;margin-top:1.2vh;color:#ffd27a}
.bio-cap .ln{height:2px;width:0;margin-top:1.4vh;background:linear-gradient(90deg,#ffd27a,transparent);transition:width 1.2s ease-out}
.bio-cap.on .ln{width:28vw}
.bio-hint{position:absolute;right:4vw;bottom:3.6vh;color:#e9dcc4;font:500 1.5vh/1 system-ui,sans-serif;letter-spacing:.15em;opacity:0;transition:opacity .3s;display:flex;align-items:center;gap:.8vh}
.bio-ring{width:2.2vh;height:2.2vh;border-radius:50%;background:conic-gradient(#ffd27a var(--p,0%),rgba(255,255,255,.18) 0)}
`;

export class CinematicOverlay {
  readonly root: HTMLDivElement;
  private readonly top: HTMLDivElement;
  private readonly bottom: HTMLDivElement;
  private readonly caption: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private readonly hintText: HTMLSpanElement;
  /** 黑边目标（0 = 收起，1 = 全开）与当前 */
  barsTarget = 0;
  bars = 0;
  private captionLeft = 0;
  captionVisible = false;

  static create(parent: HTMLElement | null | undefined): CinematicOverlay | null {
    if (!parent || typeof document === 'undefined') return null;
    return new CinematicOverlay(parent);
  }

  private constructor(parent: HTMLElement) {
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    const div = (cls: string, host: HTMLElement) => {
      const d = document.createElement('div');
      d.className = cls;
      host.appendChild(d);
      return d;
    };
    this.root = div('bio-root', parent);
    this.top = div('bio-bar top', this.root);
    this.bottom = div('bio-bar bottom', this.root);
    this.caption = div('bio-cap', this.root);
    this.hint = div('bio-hint', this.root);
    this.ring = div('bio-ring', this.hint);
    this.hintText = document.createElement('span');
    this.hint.appendChild(this.hintText);
  }

  showCaption(name: string, title: string | null, epithet: string | null, seconds: number): void {
    this.caption.innerHTML = '';
    const line = (cls: string, text: string | null) => {
      if (!text) return;
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = text;
      this.caption.appendChild(d);
    };
    line('ep', epithet);
    line('nm', name);
    line('tt', title);
    const ln = document.createElement('div');
    ln.className = 'ln';
    this.caption.appendChild(ln);
    this.caption.style.opacity = '1';
    requestAnimationFrame(() => this.caption.classList.add('on'));
    this.captionVisible = true;
    this.captionLeft = Math.max(0.5, seconds);
  }

  hideCaption(): void {
    if (!this.captionVisible) return;
    this.captionVisible = false;
    this.caption.style.opacity = '0';
    this.caption.classList.remove('on');
  }

  setHint(visible: boolean, progress: number, text: string | null): void {
    this.hint.style.opacity = visible ? '1' : '0';
    this.ring.style.setProperty('--p', `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`);
    if (text !== null && this.hintText.textContent !== text) this.hintText.textContent = text;
  }

  /** 推进（真实秒）：黑边按 3/s 追目标，名字卡到时淡出 */
  tick(udt: number): void {
    const step = udt * 3;
    this.bars = this.bars < this.barsTarget ? Math.min(this.barsTarget, this.bars + step) : Math.max(this.barsTarget, this.bars - step);
    const e = this.bars * this.bars * (3 - 2 * this.bars);
    this.top.style.transform = `scaleY(${e})`;
    this.bottom.style.transform = `scaleY(${e})`;
    if (this.captionVisible) {
      this.captionLeft -= udt;
      if (this.captionLeft <= 0) this.hideCaption();
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
