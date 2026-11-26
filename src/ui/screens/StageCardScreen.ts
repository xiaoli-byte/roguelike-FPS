/**
 * 关间结算卡（照译 Unity G/UI/Screens/StageCardScreen.cs，样式 css/screens/stagecard.css）：出口进门后、下一关加载之前弹出，停住游戏。
 *   上：章名 · 关卡名 ·「完成」；中：本关四格（用时 / 击杀 / 灵石净变化与现有 / 秘卷层数与本关新得）；
 *   下：下一关预告——关卡名、难度（与本关的差）、清关奖励、标签（首领关 / 有补给营 / 新章节）；
 *   按钮：「继续」（F / 回车）进下一关，「重来本关」（R）。返回键不关（二选一）。弹出 0.5 s 后才认按键（防止进门那一下 F 连按直接跳过）。
 * 最后一关不弹这张卡（那里是整局结算）。换关开始（stage:loaded）时自己收起。
 * 网页差异：没有进关快照（M11d 存档 / 续玩），「重来本关」只在调用方给了 onRestart 时显示——现在不给，按钮与 R 键都不出现。
 */
import type { GameContext } from '../../core/types';
import type { KeyBinds } from '../KeyBinds';
import { type StageCardInfo, stageCardView } from '../ScreenData';
import { sfx } from '../dom';
import { el, show, text, toggle } from '../toolkit/el';
import { UIFontRole } from '../toolkit/UIFonts';
import { UIIcon } from '../toolkit/UIIcons';
import { type BlockState, UIScreen } from '../toolkit/UIRouter';
import { Gold, paint, radialSoft } from '../toolkit/UITheme';
import { btn, easeOut, gameModal, icon } from './ScreenKit';

export const STAGE_CARD_ID = 'stage-card';
/** 弹出后多久才认按键 */
export const STAGE_CARD_INPUT_DELAY = 0.5;

export interface StageCardArgs {
  info: StageCardInfo;
  /** 「继续」：界面先关掉自己（游戏回到 playing），再回调 */
  onContinue: () => void;
  /** 「重来本关」（没有 = 不提供） */
  onRestart?: () => void;
}

const ICONS = { hourglass: UIIcon.Hourglass, skull: UIIcon.Skull, coin: UIIcon.Coin, spark: UIIcon.Spark } as const;

export class StageCardScreen extends UIScreen {
  readonly id = STAGE_CARD_ID;
  override get blockState(): BlockState {
    return 'summary';
  }
  override get defaultFocus(): HTMLElement | null {
    return this.continueBtn;
  }

  private rootEl!: HTMLDivElement;
  private panel!: HTMLDivElement;
  private stats!: HTMLDivElement;
  private tags!: HTMLDivElement;
  private chapter!: HTMLDivElement;
  private title!: HTMLDivElement;
  private nextLabel!: HTMLDivElement;
  private nextTitle!: HTMLDivElement;
  private hint!: HTMLDivElement;
  private continueBtn: HTMLButtonElement | null = null;
  private restartBtn!: HTMLButtonElement;
  private args: StageCardArgs | null = null;
  private openedAt = 0;
  private off: (() => void) | null = null;
  private readonly modal = gameModal(() => this.ctx);
  /** 弹出以来按过「继续 / 重来」（测试用） */
  acted = false;
  /** 预告里的标签文字（测试用） */
  tagText = '';

  constructor(private readonly ctx: GameContext, private readonly keys: KeyBinds, private readonly now: () => number) {
    super();
  }

  get info(): StageCardInfo | null {
    return this.args?.info ?? null;
  }

  protected build(): HTMLElement {
    const ctx = this.ctx;
    const root = (this.rootEl = el('sf-stagecard', null, 'stage-card'));
    el('sf-stagecard__bg', root);
    paint(el('sf-stagecard__glow', root), radialSoft(Gold));
    this.panel = el('sf-stagecard__panel', root);
    this.chapter = text('sf-stagecard__chapter', this.panel, '');
    this.title = text('sf-stagecard__title', this.panel, '', UIFontRole.Title);
    text('sf-stagecard__done', this.panel, '完 成', UIFontRole.Title);
    this.stats = el('sf-stagecard__stats', this.panel);
    const next = el('sf-stagecard__next', this.panel);
    this.nextLabel = text('sf-stagecard__nextlabel', next, '下一关');
    this.nextTitle = text('sf-stagecard__nexttitle', next, '', UIFontRole.Title);
    this.tags = el('sf-stagecard__tags', next);
    const foot = el('sf-stagecard__foot', this.panel);
    this.continueBtn = btn(ctx, '继续', 'sf-btn--primary sf-btn--wide sf-sound-confirm', foot, () => this.continue());
    this.continueBtn.dataset.name = 'stagecard-continue';
    this.restartBtn = btn(ctx, '重来本关', 'sf-btn--ghost sf-btn--wide', foot, () => this.restart());
    this.restartBtn.dataset.name = 'stagecard-restart';
    this.hint = text('sf-stagecard__hint', this.panel, '');
    return root;
  }

  /** 返回键不关 */
  override onBack(): boolean {
    return true;
  }

  override onOpen(arg?: unknown): void {
    const a = (arg ?? null) as StageCardArgs | null;
    this.args = a;
    this.openedAt = this.now();
    this.acted = false;
    this.modal.open();
    this.off?.();
    this.off = this.ctx.events.on('stage:loaded', () => this.close());
    const v = stageCardView(a?.info ?? { stage: null, next: null, time: 0, kills: 0, coinsDelta: 0, coins: 0, scrolls: 0, scrollsGained: 0, nextReady: false });
    this.chapter.textContent = v.chapter;
    this.title.textContent = v.title;
    this.stats.replaceChildren();
    for (const s of v.stats) {
      const cell = el('sf-stagecard__stat', this.stats);
      icon(ICONS[s.icon], s.icon === 'coin' ? 'sf-icon--coin' : null, cell);
      text('sf-stagecard__slabel', cell, s.label);
      text('sf-stagecard__sval', cell, s.value, UIFontRole.Number);
      if (s.sub) text('sf-stagecard__ssub', cell, s.sub);
    }
    this.tags.replaceChildren();
    for (const t of v.tags) text('sf-chip__name', el('sf-chip ' + t.cls, this.tags), t.text);
    this.tagText = v.tags.map((t) => t.text).join(' / ');
    toggle(this.rootEl, 'sf-stagecard--boss', v.boss);
    this.nextLabel.textContent = v.nextLabel;
    this.nextTitle.textContent = v.nextTitle;
    this.continueBtn!.textContent = v.continueText;
    const canRestart = !!a?.onRestart;
    show(this.restartBtn, canRestart);
    this.hint.textContent = `${this.keys.label('interact')} / 回车 继续` + (canRestart ? `　　${this.keys.label('reload')} 重来本关` : '');
    this.tick();
    sfx(this.ctx, 'ui_confirm');
  }

  override onClose(): void {
    this.off?.();
    this.off = null;
    this.modal.close();
  }

  /** 「继续」：进下一关 */
  continue(): void {
    if (this.acted) return;
    this.acted = true;
    const cb = this.args?.onContinue;
    this.close();
    cb?.();
  }

  /** 「重来本关」 */
  restart(): void {
    if (this.acted || !this.args?.onRestart) return;
    this.acted = true;
    const cb = this.args.onRestart;
    this.close();
    cb();
  }

  /** F 继续 / R 重来（改过的键也认）；弹出 0.5 s 内不认 */
  onKey(code: string): boolean {
    if (this.acted || this.now() - this.openedAt < STAGE_CARD_INPUT_DELAY) return false;
    if (this.keys.matches('interact', code)) {
      this.continue();
      return true;
    }
    if (this.keys.matches('reload', code) && this.args?.onRestart) {
      this.restart();
      return true;
    }
    return false;
  }

  override tick(): void {
    const t = this.now() - this.openedAt;
    this.panel.style.opacity = String(Math.round(easeOut(t / 0.3) * 1000) / 1000);
    this.panel.style.translate = `0px ${(14 * (1 - easeOut(t / 0.4))).toFixed(2)}px`;
  }
}
