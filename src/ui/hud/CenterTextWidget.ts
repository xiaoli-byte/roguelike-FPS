/**
 * 屏幕中央的大字（照译 Unity G/UI/Widgets/CenterTextWidget.cs；阵亡 / 本关完成）：叠层（和横幅、闪光同层，HUD 之上、界面之下），
 * 标题字体 72、朱红描边，支持 Unity 富文本（第二、三行用 <size=34> 之类缩小）；底下垫一层淡墨衬底。出现时 0.35 s 放大淡入。
 * 网页的阵亡 / 通关走结算界面，这块现在只由 UI.setCenterText 调（Unity GameUI.SetCenterText 的对应）。
 */
import { el, setOpacity, setScale, setText, text } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { UILayer } from '../toolkit/UILayers';
import { Ink0, paint, radialSoft } from '../toolkit/UITheme';
import { type HudFrame, HudWidget } from './HudWidget';

const InTime = 0.35;

export class CenterTextWidget extends HudWidget {
  readonly id = 'center-text';
  override readonly order = 80;
  override readonly layer = UILayer.Overlay;

  private label!: HTMLDivElement;
  private shownAt = -10;
  private animating = false;
  private value = '';

  /** 当前文字（测试用；收起为空） */
  get Text(): string {
    return this.visible ? this.value : '';
  }

  protected build(): HTMLElement {
    const root = el('sf-center');
    const backdrop = el('sf-center__backdrop', root);
    paint(backdrop, radialSoft(Ink0));
    this.label = text('sf-center__text', root, '', UIFontRole.Title, true);
    root.style.display = 'none';
    return root;
  }

  set(richText: string | null): void {
    const on = !!richText;
    if (on && this.value !== richText) {
      this.value = richText!;
      setText(this.label, richText!);
      this.shownAt = performance.now() / 1000;
      this.animating = true;
    }
    if (!on) {
      this.value = '';
      setText(this.label, '');
    }
    this.visible = on;
  }

  override tick(f: HudFrame): void {
    if (!this.animating) return;
    const k = (f.unscaledTime - this.shownAt) / InTime;
    if (k >= 1 || k < 0) {
      this.animating = false;
      setOpacity(this.label, null);
      setScale(this.label, null);
      return;
    }
    const e = 1 - (1 - k) * (1 - k) * (1 - k);
    setOpacity(this.label, e);
    setScale(this.label, 1.12 + (1 - 1.12) * e);
  }
}
