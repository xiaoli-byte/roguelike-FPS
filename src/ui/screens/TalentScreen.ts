/**
 * 局外天赋（照译 Unity G/UI/Screens/TalentScreen.cs，样式 css/unity/menu.css 的 .sf-talents）：花魂晶升级，对之后的每一局永久生效。
 * 两列天赋行：名字 + 等级、说明、等级菱形 +「当前 / 下一级」效果、购买按钮（魂晶图标 + 价格；不够时变暗、按了抖一下出拒绝音；满级禁用）。
 * 右上魂晶余额，页脚「已点亮 n / 总级数」。数据都来自 ctx.meta（存档与天赋表）。主菜单里打开，不挡游戏；返回回主菜单。
 */
import type { GameContext, TalentDef } from '../../core/types';
import { talentRow, talentTotals } from '../ScreenData';
import { sfx } from '../dom';
import { fmtStat } from '../labels';
import { el, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { UIIcon } from '../toolkit/UIIcons';
import { type BlockState, UIScreen } from '../toolkit/UIRouter';
import { btn, card, easeOut, icon, num, scroll } from './ScreenKit';

export const TALENTS_SCREEN_ID = 'talents';

interface Row {
  def: TalentDef;
  el: HTMLDivElement;
  info: HTMLDivElement;
  buy: HTMLButtonElement;
  shakeAt: number;
  flashAt: number;
}

export class TalentScreen extends UIScreen {
  readonly id = TALENTS_SCREEN_ID;
  override get blockState(): BlockState | null {
    return null;
  }
  override get freezeTime(): boolean {
    return false;
  }
  override get defaultFocus(): HTMLElement | null {
    return this.rows[0]?.buy ?? this.backBtn;
  }

  readonly rows: Row[] = [];
  private frame!: HTMLDivElement;
  private grid!: HTMLDivElement;
  private essence!: HTMLDivElement;
  private total!: HTMLDivElement;
  private backBtn: HTMLButtonElement | null = null;
  private openedAt = 0;

  constructor(private readonly ctx: GameContext, private readonly now: () => number) {
    super();
  }

  protected build(): HTMLElement {
    const root = el('sf-talents-screen', null, 'talents');
    el('sf-backdrop sf-menu-sub__backdrop', root);
    this.frame = el('sf-frame sf-talents', root);
    const head = el('sf-panel__head sf-panel__head--split', this.frame);
    const titles = el('sf-panel__titles', head);
    text('sf-panel__title', titles, '天赋', UIFontRole.Title);
    text('sf-panel__sub', titles, '魂晶在每局结束时结算。天赋对之后的每一局永久生效。');
    const wallet = el('sf-wallet', head);
    icon(UIIcon.Essence, 'sf-icon--essence', wallet);
    text('sf-wallet__label', wallet, '魂晶');
    this.essence = text('sf-wallet__num', wallet, '0', UIFontRole.Number);
    this.grid = el('sf-talents__grid', scroll('sf-talents__scroll', this.frame));
    const foot = el('sf-panel__foot', this.frame);
    this.total = text('sf-talents__total', foot, '', UIFontRole.Number);
    el('sf-grow', foot);
    this.backBtn = btn(this.ctx, '返回', 'sf-btn--primary', foot, () => this.close());
    return root;
  }

  override onOpen(): void {
    this.openedAt = this.now();
    this.buildRows();
    this.refresh();
    this.tick();
  }

  private buildRows(): void {
    this.grid.replaceChildren();
    this.rows.length = 0;
    const all = this.ctx.meta.talents;
    if (all.length === 0) {
      text('sf-empty', this.grid, '暂无可强化的天赋。');
      return;
    }
    for (const def of all) {
      const e = el('sf-talent', this.grid, 'talent-' + def.id);
      const info = el('sf-talent__info', e);
      const buy = card(this.ctx, 'sf-buy sf-silent', e, () => this.buy(def));
      buy.dataset.name = 'buy-' + def.id;
      this.rows.push({ def, el: e, info, buy, shakeAt: -1, flashAt: -1 });
    }
  }

  /** 按当前存档刷新全部行、余额、合计 */
  refresh(): void {
    const meta = this.ctx.meta;
    const have = meta.save.essence;
    this.essence.textContent = num(have);
    const tt = talentTotals(meta.talents, (id) => meta.talentLevel(id));
    this.total.textContent = `已点亮 ${tt.owned} / ${tt.total}`;
    for (const r of this.rows) {
      const t = r.def;
      const v = talentRow(t, meta.talentLevel(t.id), have, (x) => fmtStat(t.stat, x));
      toggle(r.el, 'sf-talent--maxed', v.maxed);
      r.info.replaceChildren();
      const name = el('sf-talent__namerow', r.info);
      text('sf-talent__name', name, t.name, UIFontRole.Title);
      text('sf-talent__lvl', name, v.level, UIFontRole.Number);
      text('sf-talent__desc', r.info, t.description);
      const eff = el('sf-talent__effect', r.info);
      const pips = el('sf-talent__pips', eff);
      for (const on of v.pips) el(on ? 'sf-talent__pip sf-talent__pip--on' : 'sf-talent__pip', pips);
      text('sf-talent__now', eff, v.now);
      if (!v.maxed) text('sf-talent__next', eff, v.next);
      r.buy.replaceChildren();
      toggle(r.buy, 'sf-buy--maxed', v.maxed);
      toggle(r.buy, 'sf-buy--short', v.short);
      if (v.maxed) text('sf-buy__label', r.buy, '已满级');
      else {
        icon(UIIcon.Essence, 'sf-icon--essence', r.buy);
        text('sf-buy__cost', r.buy, num(v.cost), UIFontRole.Number);
      }
      r.buy.title = v.tooltip;
    }
  }

  /** 买一级（按钮和测试都走这里）：成功返回 true */
  buy(def: TalentDef): boolean {
    const r = this.rows.find((x) => x.def === def);
    let ok = false;
    try {
      ok = this.ctx.meta.buyTalent(def.id);
      if (ok) this.ctx.meta.persist();
    } catch (err) {
      console.error('[UI] 天赋购买失败', err);
    }
    if (r) {
      if (ok) r.flashAt = this.now();
      else r.shakeAt = this.now();
    }
    sfx(this.ctx, ok ? 'ui_confirm' : 'ui_deny');
    this.refresh();
    return ok;
  }

  override tick(): void {
    const now = this.now();
    const k = easeOut((now - this.openedAt) / 0.28);
    this.frame.style.opacity = k.toFixed(3);
    this.frame.style.translate = `0px ${(14 * (1 - k)).toFixed(2)}px`;
    this.rows.forEach((r, i) => {
      const rk = easeOut((now - this.openedAt - 0.04 * i) / 0.35);
      let x = 0;
      if (r.shakeAt >= 0) {
        const s = (now - r.shakeAt) / 0.24;
        if (s >= 1) r.shakeAt = -1;
        else x = Math.sin(s * Math.PI * 3) * 6 * (1 - s);
      }
      r.el.style.translate = `${x.toFixed(2)}px ${(10 * (1 - rk)).toFixed(2)}px`;
      r.el.style.opacity = rk.toFixed(3);
      if (r.flashAt >= 0) {
        const f = (now - r.flashAt) / 0.48;
        if (f >= 1) {
          r.flashAt = -1;
          r.el.style.backgroundColor = '';
        } else r.el.style.backgroundColor = `rgba(212,169,85,${(0.3 * (1 - f)).toFixed(3)})`;
      }
    });
  }
}
