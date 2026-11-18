/**
 * 界面的根（照译 Unity G/UI/Toolkit/UIRoot.cs）：按 UILayer 建四层面板，托管全局提示组件（Toasts / Banner / Curtain / Flash）和界面路由，
 * 每帧推进它们（全部用不缩放时间：暂停中照常淡出）。
 *
 * 网页的层结构（都在 ctx.dom.ui 里）：
 *   div.ui-layer.ui-layer--<层>            不缩放的壳，z-index 按层次序（Hud < Overlay < Modal < Toast）；旧的 gf-* 界面挂在这里（自己管缩放）
 *     div.sf-root.sf-root--<层>            按 1920×1080 Expand 缩放的面板根（= Unity 的 rootVisualElement，theme.css 的 :root）
 *       div.sf-layer.sf-layer--<层>        层内容容器（= Unity UIRoot.Layer(层)）
 * 只有界面层接指针（css/sf-base.css）。黑幕在提示层、加在提示队列之后（画在提示上面）；横幅、闪光在叠层。
 */
import { ALL_LAYERS, UILayer, layerName, panelSize } from './UILayers';
import { ScreenRouter } from './UIRouter';
import { UIToasts } from './UIToasts';
import { UIBanner } from './UIBanner';
import { UICurtain } from './UICurtain';
import { UIFlash } from './UIFlash';
import { UIFontRole, warmup } from './UIFonts';

/** 不缩放时间（秒） */
export const realNow = (): number => performance.now() / 1000;

export class UIRoot {
  /** 每层的壳（不缩放；旧界面挂这里） */
  readonly hosts: HTMLDivElement[] = [];
  /** 每层的缩放根（.sf-root） */
  readonly roots: HTMLDivElement[] = [];
  /** 每层的内容容器（.sf-layer） */
  readonly layers: HTMLDivElement[] = [];
  readonly router: ScreenRouter;
  readonly toasts: UIToasts;
  readonly banner: UIBanner;
  readonly curtain: UICurtain;
  readonly flash: UIFlash;
  /** 面板逻辑尺寸（设计像素，≥ 1920×1080）与缩放倍率 */
  readonly panel = { x: 1920, y: 1080, scale: 1 };
  /** 电影模式（首领登场演出）：HUD 层与提示条淡出 */
  hudHidden = false;

  constructor(readonly container: HTMLElement) {
    for (const layer of ALL_LAYERS) {
      const name = layerName(layer).toLowerCase();
      const host = document.createElement('div');
      host.className = `ui-layer ui-layer--${name}`;
      const root = document.createElement('div');
      root.className = `sf-root sf-root--${name}`;
      const c = document.createElement('div');
      c.className = `sf-layer sf-layer--${name}`;
      c.dataset.name = 'layer-' + name;
      root.appendChild(c);
      host.appendChild(root);
      container.appendChild(host);
      this.hosts[layer] = host;
      this.roots[layer] = root;
      this.layers[layer] = c;
    }
    this.toasts = new UIToasts(this.layers[UILayer.Toast], realNow, () => this.hudHidden);
    this.curtain = new UICurtain(this.layers[UILayer.Toast], realNow); // 黑幕在 toast 之后加 → 画在 toast 上面
    this.banner = new UIBanner(this.layers[UILayer.Overlay], realNow);
    this.flash = new UIFlash(this.layers[UILayer.Overlay], realNow);
    this.router = new ScreenRouter({
      layer: (l) => this.layers[l] ?? null,
      focused: () => (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null),
      now: realNow,
    });
    this.resize(window.innerWidth, window.innerHeight);
    // 常用字先加载，第一次弹提示不先闪系统字体
    void warmup('0123456789+-×%/:.,·…！？、。，「」灵石魂晶秘卷武器区域肃清出口已开启');
    void warmup('暂停继续设置放弃本局返回主菜单区域肃清', UIFontRole.Title);
    void warmup('0123456789/+-×.%∞', UIFontRole.Number);
  }

  /** 某一层的内容容器（往里加元素） */
  layer(layer: UILayer): HTMLDivElement {
    return this.layers[layer];
  }

  /** 某一层不缩放的壳（旧的 gf-* 界面挂这里） */
  host(layer: UILayer): HTMLDivElement {
    return this.hosts[layer];
  }

  /** 视口变了：四层按 1920×1080 Expand 重算缩放 */
  resize(width: number, height: number): void {
    const p = panelSize(width, height);
    this.panel.x = p.x;
    this.panel.y = p.y;
    this.panel.scale = p.scale;
    for (const r of this.roots) {
      r.style.width = `${p.x}px`;
      r.style.height = `${p.y}px`;
      r.style.transform = `scale(${p.scale})`;
    }
  }

  /** 有看得见的界面内容（提示、横幅、黑幕、闪光、打开的界面）：截图 / 调试用 */
  get hasVisibleContent(): boolean {
    return this.toasts.count > 0 || this.banner.isVisible || this.curtain.opacity > 0.001 || this.flash.isActive || this.router.count > 0;
  }

  /** 每帧（不缩放时间，秒） */
  tick(now: number, unscaledDt: number): void {
    this.toasts.tick(now);
    this.banner.tick(now);
    this.flash.tick(now);
    this.router.tick(unscaledDt);
  }
}
