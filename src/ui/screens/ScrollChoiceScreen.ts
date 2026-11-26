/**
 * 秘卷三选一（照译 Unity G/UI/Screens/ScrollChoiceScreen.cs，样式 css/screens/scrolls.css 的「挂轴」）：
 *   三张挂轴依次落下、展开（0.12 s 错开）；装裱绫绢的颜色 = 稀有度，上面铺点阵纹；宣纸上：竖排稀有度印、「新得 / 升层」戳、名字、
 *   按下一层的数值写的说明、红色代价行、层数菱形（已有实心、下一层呼吸）、标签（英雄专属朱字）。
 *   传说卷鎏金边框 + 外发光 + 流光，史诗卷淡紫外发光。
 * 选择：点击 / 1 2 3 / 键盘（左右移焦点、回车确认）。刚弹出 0.25 s 内忽略（正在连点开火时误选），choose(i, true) 不受限。
 * 选中后：回调同步执行（层数立即生效）、界面立即关闭（游戏恢复），卡面留在叠层上做 0.36 s 的选中 / 落选动画再收走。
 * 挡游戏：modal；返回键不关（必须选一张）。
 * 网页差异：秘卷定义没有「属性预览」接口（Unity ScrollDef.PreviewStats），卡面不画「当前 → 下一层」的属性行。
 */
import type { GameContext, ScrollDef } from '../../core/types';
import { RARITY_NAMES } from '../../core/types';
import { scrollCardView } from '../ScreenData';
import { sfx } from '../dom';
import { tagName } from '../labels';
import { el, text } from '../toolkit/el';
import { UIFontRole, warmup } from '../toolkit/UIFonts';
import { type BlockState, UIScreen } from '../toolkit/UIRouter';
import { GoldHi, type RGBA, css, fadeBoth, glow, lerpColor, paint, rarityColor, vignette, withAlpha } from '../toolkit/UITheme';
import { card, easeOut, paintDots } from './ScreenKit';

export const SCROLL_CHOICE_ID = 'scroll-choice';
export const CHOICE_GUARD = 0.25;
const Stagger = 0.12, DropTime = 0.5, UnrollDelay = 0.18, UnrollTime = 0.75, UnrollMax = 620, LeaveTime = 0.36;
const BROWN: RGBA = [0.23, 0.13, 0.06, 1];

export interface ScrollChoiceArgs {
  choices: ScrollDef[];
  onPick: ((def: ScrollDef) => void) | null;
}

interface Card {
  def: ScrollDef;
  button: HTMLButtonElement;
  body: HTMLDivElement;
  roll: HTMLDivElement;
  shimmer: HTMLDivElement | null;
  glow: HTMLDivElement | null;
  nextPips: HTMLDivElement[];
}

export class ScrollChoiceScreen extends UIScreen {
  readonly id = SCROLL_CHOICE_ID;
  override get blockState(): BlockState {
    return 'modal';
  }
  override get defaultFocus(): HTMLElement | null {
    return this.cards[0]?.button ?? null;
  }

  private readonly cards: Card[] = [];
  private backdrop!: HTMLDivElement;
  private cardsRow!: HTMLDivElement;
  private head!: HTMLDivElement;
  private sub!: HTMLDivElement;
  private args: ScrollChoiceArgs | null = null;
  private openedAt = 0;
  private leaveAt = -1;
  private picked = false;
  private leaveTimer = 0;

  constructor(private readonly ctx: GameContext, private readonly overlay: () => HTMLElement, private readonly now: () => number) {
    super();
  }

  /** 当前的选项（测试用） */
  get choices(): readonly ScrollDef[] {
    return this.args?.choices ?? [];
  }

  /** 还在等玩家选（开着且没选） */
  get pending(): boolean {
    return this.isOpen && !this.picked;
  }

  protected build(): HTMLElement {
    const root = el('sf-choice', null, 'scroll-choice');
    this.backdrop = el('sf-choice__backdrop', root);
    paint(el('sf-choice__vignette', this.backdrop), vignette([0.01, 0.008, 0.012, 0.9]));
    const inner = el('sf-choice__inner', root);
    this.head = el('sf-choice__head', inner);
    text('sf-choice__title', this.head, '择一秘卷', UIFontRole.Title);
    this.sub = text('sf-choice__sub', this.head, '');
    this.cardsRow = el('sf-choice__cards', inner);
    return root;
  }

  override onOpen(arg?: unknown): void {
    this.stopLeave();
    const a = (arg ?? { choices: [], onPick: null }) as ScrollChoiceArgs;
    this.args = { choices: (a.choices ?? []).slice(0, 3), onPick: a.onPick ?? null };
    this.picked = false;
    this.leaveAt = -1;
    this.openedAt = this.now();
    const root = this.root!;
    root.style.pointerEvents = '';
    root.classList.remove('sf-choice--leaving');
    root.style.opacity = '1';
    const n = this.args.choices.length;
    this.sub.textContent = `点击卡片，或按 ${Array.from({ length: n }, (_, i) => i + 1).join(' / ')} 选择　·　← → 选择、回车确认`;
    this.cardsRow.replaceChildren();
    this.cards.length = 0;
    this.args.choices.forEach((def, i) => this.cards.push(this.buildCard(def, i)));
    (this.ctx.ui as { clearMessages?: () => void }).clearMessages?.();
    void warmup('择一秘卷新得升层层数唯一专属代价', UIFontRole.Body);
    this.tick();
  }

  override onClose(): void {
    const root = this.root;
    if (!root) return;
    // 选中后界面已关（游戏恢复），卡面挪到叠层上把选中 / 落选动画做完再收走；不是选中关掉的（换场景）直接收
    if (!this.picked) return;
    root.style.pointerEvents = 'none';
    this.overlay().appendChild(root);
    root.style.display = '';
    root.classList.add('sf-choice--leaving');
    this.leaveAt = this.now();
    for (const c of this.cards) c.button.style.pointerEvents = 'none';
    this.leaveTimer = window.setInterval(() => this.leaveStep(), 16);
  }

  private leaveStep(): void {
    const root = this.root;
    if (!root || this.leaveAt < 0) return this.stopLeave();
    const k = (this.now() - this.leaveAt) / LeaveTime;
    root.style.opacity = (1 - easeOut(k)).toFixed(3);
    this.backdrop.style.opacity = (1 - Math.min(1, Math.max(0, k * 2))).toFixed(3);
    if (k >= 1) this.stopLeave();
  }

  /** 收走还在做离场动画的卡面 */
  private stopLeave(): void {
    if (this.leaveTimer) window.clearInterval(this.leaveTimer);
    this.leaveTimer = 0;
    if (this.leaveAt < 0) return;
    this.leaveAt = -1;
    const root = this.root;
    if (!root) return;
    root.remove();
    root.style.opacity = '1';
    this.backdrop.style.opacity = '1';
    for (const c of this.cards) c.button.style.pointerEvents = '';
  }

  /** 返回键不关：必须选一张 */
  override onBack(): boolean {
    return true;
  }

  /** 1 / 2 / 3 选卡 */
  onKey(code: string): boolean {
    const m = /^(?:Digit|Numpad)([1-3])$/.exec(code);
    return m ? this.choose(Number(m[1]) - 1, false) : false;
  }

  override tick(): void {
    const now = this.now();
    const t = now - this.openedAt;
    this.backdrop.style.opacity = Math.min(1, Math.max(0, t / 0.3)).toFixed(3);
    const hk = easeOut(t / 0.4);
    this.head.style.opacity = hk.toFixed(3);
    this.head.style.translate = `0px ${(-12 * (1 - hk)).toFixed(2)}px`;
    const pulse = (0.55 + 0.45 * Math.sin(now * 7)).toFixed(3);
    this.cards.forEach((c, i) => {
      const local = t - i * Stagger;
      const drop = easeOut(local / DropTime);
      c.body.style.opacity = drop.toFixed(3);
      c.body.style.translate = `0px ${(-40 * (1 - drop)).toFixed(2)}px`;
      const unroll = easeOut((local - UnrollDelay) / UnrollTime);
      c.roll.style.maxHeight = unroll >= 1 ? 'none' : `${(UnrollMax * unroll).toFixed(1)}px`;
      // 下一层的菱形呼吸、传说流光
      for (const p of c.nextPips) p.style.opacity = pulse;
      if (c.shimmer) {
        const s = (now / 3.2) % 1;
        c.shimmer.style.left = `${(-60 + 200 * s).toFixed(1)}%`;
      }
      if (c.glow) c.glow.style.opacity = (0.75 + 0.25 * Math.sin(now * 2.2)).toFixed(3);
    });
  }

  /** 选第 index 张（force = 测试 / 转发，不受误触保护限制）。返回是否选成 */
  choose(index: number, force: boolean): boolean {
    const a = this.args;
    if (this.picked || !a || index < 0 || index >= this.cards.length) return false;
    if (!force && this.now() - this.openedAt < CHOICE_GUARD) return false;
    this.picked = true;
    this.cards.forEach((c, i) => c.button.classList.add(i === index ? 'sf-scroll--chosen' : 'sf-scroll--rejected'));
    const def = a.choices[index];
    const cb = a.onPick;
    a.onPick = null;
    sfx(this.ctx, 'ui_confirm');
    try {
      cb?.(def);
    } catch (err) {
      console.error('[UI] 秘卷选择回调失败', err);
    }
    this.close();
    // 在点击 / 按键处理里同步恢复游戏（重新锁定鼠标）
    try {
      this.ctx.game.closeModal();
    } catch (err) {
      console.error('[UI] closeModal 失败', err);
    }
    return true;
  }

  // ───────────── 卡面 ─────────────

  private buildCard(def: ScrollDef, i: number): Card {
    let owned = 0;
    try {
      owned = this.ctx.scrolls.stacks(def.id);
    } catch {
      owned = 0;
    }
    const v = scrollCardView(def, owned, RARITY_NAMES[def.rarity] ?? '');
    const rc = rarityColor(def.rarity);
    const epic = def.rarity >= 3, legend = def.rarity >= 4;
    const button = card(this.ctx, `sf-scroll sf-scroll--r${Math.min(4, Math.max(0, def.rarity))} sf-silent`, this.cardsRow, () => this.choose(i, false));
    button.dataset.name = 'scroll-card-' + (i + 1);
    const body = el('sf-scroll__body', button);
    body.style.opacity = '0';
    const c: Card = { def, button, body, roll: null!, shimmer: null, glow: null, nextPips: [] };
    if (epic) {
      c.glow = el('sf-scroll__glow', body);
      paint(c.glow, glow(withAlpha(rc, legend ? 0.55 : 0.32)));
    }
    // 挂绳
    const cord = el('sf-scroll__cord', body);
    el('sf-scroll__cordl', cord);
    el('sf-scroll__cordr', cord);
    rod(body);
    const roll = (c.roll = el('sf-scroll__roll', body));
    roll.style.maxHeight = '0px';
    const silk = el('sf-scroll__silk', roll);
    silk.style.backgroundColor = css(lerpColor([0.1, 0.078, 0.063, 1], rc, 0.58));
    paintDots(el('sf-scroll__dots', silk), [1, 1, 1, legend ? 0.16 : 0.1], 10);
    if (legend) {
      silk.style.borderColor = css(GoldHi);
      c.shimmer = el('sf-scroll__shimmer', el('sf-scroll__shimmerclip', silk));
      paint(c.shimmer, fadeBoth([1, 0.96, 0.82, 0.42]));
    }
    const paper = el('sf-scroll__paper', silk);
    el('sf-scroll__frame', paper);
    text('sf-scroll__rarity', paper, v.rarityVertical, UIFontRole.Title).style.backgroundColor = css(lerpColor(rc, [0.23, 0.05, 0.03, 1], 0.28));
    text('sf-scroll__state', paper, v.state);
    text('sf-scroll__name', paper, def.name, UIFontRole.Title);
    paint(el('sf-scroll__rule', paper), fadeBoth(lerpColor(rc, BROWN, 0.4)));
    text('sf-scroll__desc', paper, v.upside, UIFontRole.Body, true);
    if (v.downside) {
      const down = el('sf-scroll__downside', paper);
      text('sf-scroll__downlabel', down, '代价');
      text('sf-scroll__downtext', down, v.downside);
    }
    const stacks = el('sf-scroll__stacks', paper);
    if (v.pips.length > 0) {
      const pips = el('sf-scroll__pips', stacks);
      for (const kind of v.pips) {
        const pip = el('sf-scroll__pip', pips);
        if (kind === 'owned') pip.classList.add('sf-scroll__pip--owned');
        else if (kind === 'next') {
          pip.classList.add('sf-scroll__pip--next');
          pip.style.backgroundColor = css(lerpColor(rc, BROWN, 0.4));
          c.nextPips.push(pip);
        }
      }
    }
    text('sf-scroll__count', stacks, v.count, v.pips.length > 0 ? UIFontRole.Number : UIFontRole.Body);
    const tags = el('sf-scroll__tags', paper);
    if (def.heroOnly) text('sf-scroll__tag sf-scroll__tag--hero', tags, `${this.ctx.heroes.find((h) => h.id === def.heroOnly)?.name ?? def.heroOnly}专属`);
    for (const t of def.tags ?? []) if (t) text(t === 'risk' || t === '高风险' ? 'sf-scroll__tag sf-scroll__tag--risk' : 'sf-scroll__tag', tags, tagName(t));
    if (tags.childElementCount === 0) tags.remove();
    rod(body);
    text('sf-scroll__key sf-key', body, String(i + 1), UIFontRole.Number);
    if (legend) button.classList.add('sf-scroll--legend');
    return c;
  }
}

function rod(parent: HTMLElement): void {
  const r = el('sf-scroll__rod', parent);
  el('sf-scroll__knob sf-scroll__knob--l', r);
  el('sf-scroll__knob sf-scroll__knob--r', r);
}
