/**
 * 主菜单的背景（网页独有）：Unity 的主菜单叠在主菜单场景的 3D 远景上（MenuDirector：沙漠城门、篝火、远处的巨像），
 * 网页没有菜单场景——沿用旧主菜单的 CSS 远景（朱日、流云、远山、飘散的火星、纸纹，css/menu-backdrop.css），垫在界面层的缩放根下面。
 * 只在主菜单状态显示；鼠标视差只在移动时写一次 CSS 变量。
 */
import { h, icon } from '../dom';
import { ICON_CLOUD } from '../icons';

const EMBER_COUNT = 34;

export class MenuBackdrop {
  readonly root: HTMLDivElement;
  private raf = 0;
  private px = 0;
  private py = 0;

  /** host = 界面层不缩放的壳；背景插在它最前面（画在缩放根下面） */
  constructor(host: HTMLElement) {
    const root = (this.root = h('div', 'gf-menu gf-menu-backdrop'));
    root.hidden = true;
    host.insertBefore(root, host.firstChild);
    const bg = h('div', 'gf-menu__bg', root);
    h('div', 'gf-menu__sky', bg);
    h('div', 'gf-menu__sunhalo', h('div', 'gf-menu__sun', bg));
    for (let i = 1; i <= 4; i++) h('div', `gf-menu__mist gf-menu__mist--${i}`, bg);
    const clouds = h('div', 'gf-menu__clouds', bg);
    for (let i = 1; i <= 3; i++) icon(ICON_CLOUD, `gf-menu__cloud gf-menu__cloud--${i}`, clouds);
    h('div', 'gf-menu__range gf-menu__range--far', bg);
    h('div', 'gf-menu__range gf-menu__range--mid', bg);
    h('div', 'gf-menu__range gf-menu__range--near', bg);
    const embers = h('div', 'gf-menu__embers', bg);
    for (let i = 0; i < EMBER_COUNT; i++) {
      const e = h('i', 'gf-ember', embers);
      // 纯视觉随机
      const size = 1.5 + Math.random() * 3;
      e.style.left = `${(Math.random() * 100).toFixed(1)}%`;
      e.style.width = e.style.height = `${size.toFixed(1)}px`;
      e.style.setProperty('--dur', `${(7 + Math.random() * 9).toFixed(1)}s`);
      e.style.setProperty('--delay', `${(-Math.random() * 16).toFixed(1)}s`);
      e.style.setProperty('--sway', `${((Math.random() - 0.5) * 120).toFixed(0)}px`);
      if (Math.random() < 0.35) e.classList.add('gf-ember--gold');
    }
    h('div', 'gf-menu__grain', bg);
    h('div', 'gf-menu__vignette', bg);
    window.addEventListener('pointermove', this.onMove);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  setVisible(on: boolean): void {
    if (this.root.hidden === !on) return;
    this.root.hidden = !on;
  }

  private onMove = (e: PointerEvent): void => {
    if (this.root.hidden) return;
    this.px = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    this.py = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.root.style.setProperty('--mx', this.px.toFixed(3));
      this.root.style.setProperty('--my', this.py.toFixed(3));
    });
  };
}
