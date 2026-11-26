/**
 * 图鉴（照译 Unity G/UI/Screens/CodexScreen.cs，样式 css/screens/codex.css）：主菜单里打开，不挡游戏；返回回主菜单。
 *   上：标题 + 总收录数；四个页签（武器 / 秘卷 / 敌人 / 灵宠，各带「已收录 / 总数」与新条目红点）；
 *   左：一页 12 格（4 × 3）——缩略图（CodexThumbs 现拍的模型图；秘卷是单字签）+ 名字；未收录的模型图染黑成剪影、名字写「？？？」；
 *       新收录的角上有朱印「新」，选中看过就清掉；
 *   右：选中条目的详情——大图、名字、副标题、标签、描述；武器写基础数值与固有特性，秘卷按 1 层和叠满的描述，敌人写打法要点与基础数值，
 *       灵宠写攻击 / 被动 / 灵技 / 觉醒；未收录的只写怎么收录（敌人另写出没的章）。
 *   下：页码、上一页 / 下一页（也可以 Q / E 换页签，← → 在格子边上翻页）、返回。
 * 缩略图每帧最多拍一张，先拍选中的，再拍当前页；拍好之前显示单字占位。
 */
import type { EnemyDef, GameContext, ScrollDef, WeaponInstance } from '../../core/types';
import { ELEMENT_NAMES, RARITY_NAMES } from '../../core/types';
import type { PetDefView } from '../PetData';
import { chapterTitle, scrollRichText } from '../ScreenData';
import { type Codex, type CodexCatalog, type CodexEntry, type CodexKind, CODEX_COLUMNS, CODEX_KINDS, CODEX_PER_PAGE, KIND_NAMES, describeEnemy, lockedHint, pageCount, wrapPage } from '../codex/Codex';
import type { CodexThumbs } from '../codex/CodexThumbs';
import { sfx } from '../dom';
import { el, setText, show, text, toggle } from '../toolkit/el';
import { UIFontRole, warmup } from '../toolkit/UIFonts';
import { type BlockState, UIScreen } from '../toolkit/UIRouter';
import { CinnabarHi, GoldHi, Paper3, type RGBA, css, elementColor, rarityColor, rgb, withAlpha } from '../toolkit/UITheme';
import { btn, card, easeOut, num, num1, scroll } from './ScreenKit';

export const CODEX_ID = 'codex';

interface Cell {
  button: HTMLButtonElement;
  frame: HTMLDivElement;
  thumb: HTMLDivElement;
  badge: HTMLDivElement;
  glyph: HTMLDivElement;
  name: HTMLDivElement;
  entry: CodexEntry | null;
}

const MODE_NAMES: Record<string, string> = { semi: '半自动', auto: '全自动', burst: '点射', beam: '光束', spinup: '预热连射', charge: '蓄力' };

export class CodexScreen extends UIScreen {
  readonly id = CODEX_ID;
  override get blockState(): BlockState | null {
    return null;
  }
  override get freezeTime(): boolean {
    return false;
  }
  override get defaultFocus(): HTMLElement | null {
    return this.cells[0]?.entry ? this.cells[0].button : this.backBtn;
  }

  private readonly tabs: HTMLButtonElement[] = [];
  private readonly tabCounts: HTMLDivElement[] = [];
  private readonly tabDots: HTMLDivElement[] = [];
  private readonly cells: Cell[] = [];
  private frame!: HTMLDivElement;
  private heroThumb!: HTMLDivElement;
  private heroFrame!: HTMLDivElement;
  private chips!: HTMLDivElement;
  private statGrid!: HTMLDivElement;
  private traits!: HTMLDivElement;
  private total!: HTMLDivElement;
  private pageLabel!: HTMLDivElement;
  private heroGlyph!: HTMLDivElement;
  private dName!: HTMLDivElement;
  private dSub!: HTMLDivElement;
  private dDesc!: HTMLDivElement;
  private dFoot!: HTMLDivElement;
  private prevBtn!: HTMLButtonElement;
  private nextBtn!: HTMLButtonElement;
  private backBtn: HTMLButtonElement | null = null;
  private openedAt = 0;
  kind: CodexKind = 'weapon';
  page = 0;
  selected: CodexEntry | null = null;

  constructor(private readonly ctx: GameContext, private readonly book: Codex, private readonly catalog: () => CodexCatalog, private readonly thumbs: CodexThumbs | null, private readonly now: () => number) {
    super();
  }

  get pageCount(): number {
    return pageCount(this.catalog().of(this.kind).length);
  }

  /** 当前页显示的条目 */
  get pageEntries(): CodexEntry[] {
    return this.cells.filter((c) => c.entry).map((c) => c.entry!);
  }

  /** 当前页的缩略图都拍好了（或确认拍不了） */
  get pageThumbsReady(): boolean {
    return this.cells.every((c) => !c.entry || !this.thumbs || this.thumbs.ready(c.entry));
  }

  get detailName(): string {
    return this.dName?.textContent ?? '';
  }

  get detailText(): string {
    return this.dDesc?.textContent ?? '';
  }

  protected build(): HTMLElement {
    const ctx = this.ctx;
    const root = el('sf-codex-screen', null, 'codex');
    el('sf-backdrop sf-menu-sub__backdrop', root);
    this.frame = el('sf-frame sf-codex', root);
    const head = el('sf-panel__head sf-panel__head--split', this.frame);
    const titles = el('sf-panel__titles', head);
    text('sf-panel__title', titles, '图鉴', UIFontRole.Title);
    text('sf-panel__sub', titles, '首次获得的武器、秘卷、灵宠与首次交手的敌人都会收录在这里，跨局保留。');
    this.total = text('sf-codex__total', head, '', UIFontRole.Number);

    const tabRow = el('sf-codex__tabs', this.frame);
    for (const k of CODEX_KINDS) {
      const b = card(ctx, 'sf-codex__tab', tabRow, () => this.select(k));
      b.dataset.name = 'codex-tab-' + k;
      text('sf-codex__tabname', b, KIND_NAMES[k], UIFontRole.Title);
      this.tabCounts.push(text('sf-codex__tabcount', b, '', UIFontRole.Number));
      this.tabDots.push(el('sf-codex__dot', b));
      this.tabs.push(b);
    }

    const body = el('sf-codex__body', this.frame);
    const grid = el('sf-codex__grid', body);
    for (let i = 0; i < CODEX_PER_PAGE; i++) {
      const button = card(ctx, 'sf-codex__cell', grid, () => this.pick(i));
      button.dataset.name = 'codex-cell-' + i;
      button.addEventListener('focusin', () => this.pick(i));
      const frame = el('sf-codex__thumbframe', button);
      const thumb = el('sf-codex__thumb', frame);
      const glyph = text('sf-codex__glyph', frame, '', UIFontRole.Title);
      const badge = text('sf-seal sf-codex__new', button, '新', UIFontRole.Title);
      const name = text('sf-codex__name', button, '', UIFontRole.Title);
      this.cells.push({ button, frame, thumb, badge, glyph, name, entry: null });
    }

    const detail = el('sf-codex__detail', body);
    this.heroFrame = el('sf-codex__heroframe', detail);
    this.heroThumb = el('sf-codex__herothumb', this.heroFrame);
    this.heroGlyph = text('sf-codex__heroglyph', this.heroFrame, '', UIFontRole.Title);
    this.dName = text('sf-codex__dname', detail, '', UIFontRole.Title);
    this.dSub = text('sf-codex__dsub', detail, '');
    this.chips = el('sf-codex__chips', detail);
    const sv = scroll('sf-codex__dscroll', detail);
    this.dDesc = text('sf-codex__ddesc', sv, '', UIFontRole.Body, true);
    this.statGrid = el('sf-codex__stats', sv);
    this.traits = el('sf-codex__traits', sv);
    this.dFoot = text('sf-codex__dfoot', sv, '');

    const foot = el('sf-panel__foot', this.frame);
    this.prevBtn = btn(ctx, '上一页', 'sf-btn--sm', foot, () => this.prevPage());
    this.prevBtn.dataset.name = 'codex-prev';
    this.pageLabel = text('sf-codex__page', foot, '', UIFontRole.Number);
    this.nextBtn = btn(ctx, '下一页', 'sf-btn--sm', foot, () => this.nextPage());
    this.nextBtn.dataset.name = 'codex-next';
    text('sf-panel__hint', foot, 'Q / E 换类别　　← → 在边上翻页');
    el('sf-grow', foot);
    this.backBtn = btn(ctx, '返回', 'sf-btn--primary', foot, () => this.close());
    return root;
  }

  override onOpen(arg?: unknown): void {
    this.openedAt = this.now();
    if (typeof arg === 'string' && (CODEX_KINDS as readonly string[]).includes(arg)) this.kind = arg as CodexKind;
    this.page = 0;
    this.selected = null;
    void warmup('图鉴武器秘卷敌人灵宠新？', UIFontRole.Title);
    this.showPage();
    this.tick();
  }

  override onClose(): void {
    this.book.flush();
    this.thumbs?.releaseRig();
  }

  // ───────────── 页签 / 翻页 ─────────────

  /** 换页签（回到第一页、选中第一条） */
  select(k: CodexKind): void {
    if (k === this.kind && this.selected) return;
    this.kind = k;
    this.page = 0;
    this.selected = null;
    this.showPage();
  }

  /** 翻到某一条所在的页签和页并选中它 */
  reveal(e: CodexEntry | null): boolean {
    if (!e) return false;
    const i = this.catalog().of(e.kind).indexOf(e);
    if (i < 0) return false;
    this.kind = e.kind;
    this.page = Math.floor(i / CODEX_PER_PAGE);
    this.selected = e;
    this.showPage();
    return true;
  }

  nextPage(): void {
    this.goPage(this.page + 1);
  }

  prevPage(): void {
    this.goPage(this.page - 1);
  }

  /** 翻到某一页（超出两端就绕回）；选中这一页第一条 */
  goPage(p: number): void {
    this.page = wrapPage(p, this.pageCount);
    this.selected = null;
    this.showPage();
    sfx(this.ctx, 'ui_confirm');
  }

  private showPage(): void {
    const book = this.book, cat = this.catalog();
    const list = cat.of(this.kind);
    this.page = Math.min(Math.max(0, this.page), this.pageCount - 1);
    this.total.textContent = `收录 ${book.totalCount} / ${cat.total}`;
    CODEX_KINDS.forEach((k, i) => {
      toggle(this.tabs[i], 'sf-codex__tab--on', k === this.kind);
      this.tabCounts[i].textContent = `${book.count(k)} / ${cat.of(k).length}`;
      show(this.tabDots[i], book.freshCount(k) > 0);
    });
    this.cells.forEach((c, i) => {
      c.entry = list[this.page * CODEX_PER_PAGE + i] ?? null;
      toggle(c.button, 'sf-codex__cell--empty', !c.entry);
      c.button.disabled = !c.entry;
      this.paintCell(c);
    });
    this.pageLabel.textContent = `第 ${this.page + 1} / ${this.pageCount} 页`;
    this.prevBtn.disabled = this.nextBtn.disabled = this.pageCount <= 1;
    if (!this.selected || !this.cells.some((c) => c.entry === this.selected)) this.selected = this.cells[0].entry;
    this.showDetail();
  }

  private pick(i: number): void {
    const e = this.cells[i]?.entry;
    if (!e || e === this.selected) return;
    this.selected = e;
    this.showDetail();
  }

  // ───────────── 格子 ─────────────

  private paintCell(c: Cell): void {
    const e = c.entry;
    toggle(c.button, 'sf-codex__cell--on', !!e && e === this.selected);
    if (!e) {
      c.name.textContent = c.glyph.textContent = '';
      c.thumb.style.backgroundImage = '';
      show(c.badge, false);
      return;
    }
    const have = this.book.isUnlocked(e.kind, e.id);
    toggle(c.button, 'sf-codex__cell--locked', !have);
    toggle(c.button, 'sf-codex__cell--boss', e.boss);
    c.name.textContent = have ? e.name : '？？？';
    c.name.style.color = css(have ? e.color : Paper3);
    show(c.badge, have && this.book.isFresh(e.kind, e.id));
    this.paintThumb(e, have, c.thumb, c.glyph, c.frame);
  }

  /** 缩略图（拍好了用模型图，未收录压黑成剪影）或单字签 */
  private paintThumb(e: CodexEntry, have: boolean, thumb: HTMLElement, glyph: HTMLElement, frame: HTMLElement): void {
    const t = this.thumbs;
    const url = t && t.hasModel(e) ? t.peek(e) : null;
    if (url) {
      frame.style.borderColor = '';
      thumb.style.backgroundImage = `url(${url})`;
      // Unity 用图片染色 (0.02, 0.015, 0.03, 0.92)；网页用滤镜压成近黑的剪影
      thumb.style.filter = have ? '' : 'brightness(0.03)';
      thumb.style.opacity = have ? '' : '0.92';
      glyph.textContent = '';
      return;
    }
    thumb.style.backgroundImage = '';
    thumb.style.filter = thumb.style.opacity = '';
    const pending = !!t && t.hasModel(e) && !t.ready(e);
    glyph.textContent = have ? e.name.charAt(0) : '？';
    glyph.style.color = css(have ? e.color : Paper3);
    glyph.style.opacity = pending ? '0.35' : '1';
    // 单字签（秘卷）：收录了的框描成稀有度色
    frame.style.borderColor = have && !pending ? css(withAlpha(e.color as RGBA, 0.55)) : '';
  }

  // ───────────── 详情 ─────────────

  private showDetail(): void {
    for (const c of this.cells) toggle(c.button, 'sf-codex__cell--on', !!c.entry && c.entry === this.selected);
    this.chips.replaceChildren();
    this.statGrid.replaceChildren();
    this.traits.replaceChildren();
    const e = this.selected;
    if (!e) {
      this.dName.textContent = this.dSub.textContent = this.dFoot.textContent = this.heroGlyph.textContent = '';
      this.setDesc(this.kind === 'pet' ? '灵宠名录还没有条目。' : '这一类还没有条目。');
      this.heroThumb.style.backgroundImage = '';
      this.heroFrame.style.borderColor = '';
      return;
    }
    const book = this.book;
    const have = book.isUnlocked(e.kind, e.id);
    this.paintThumb(e, have, this.heroThumb, this.heroGlyph, this.heroFrame);
    this.dFoot.textContent = '';
    if (!have) {
      this.dName.textContent = '？？？';
      this.dName.style.color = css(Paper3);
      this.dSub.textContent = `${KIND_NAMES[e.kind]} · 未收录`;
      this.setDesc(lockedHint(e));
      if (e.kind === 'enemy' && e.chapter > 0) this.chip(`出没 · ${chapterTitle(e.chapter)}`, null);
      return;
    }
    this.dName.textContent = e.name;
    this.dName.style.color = css(e.color);
    this.dSub.textContent = e.subtitle ?? '';
    try {
      if (e.kind === 'weapon') this.describeWeapon(e);
      else if (e.kind === 'scroll') this.describeScroll(e.def as ScrollDef);
      else if (e.kind === 'enemy') this.describeEnemy(e);
      else this.describePet(e.def as PetDefView);
    } catch (err) {
      console.error('[UI] 图鉴详情失败', err);
    }
    if (book.isFresh(e.kind, e.id)) {
      book.markSeen(e.kind, e.id);
      for (const c of this.cells) if (c.entry === e) show(c.badge, false);
      CODEX_KINDS.forEach((k, i) => show(this.tabDots[i], book.freshCount(k) > 0));
    }
  }

  /** 说明是富文本标签（同 Unity dDesc）：秘卷的代价行按 <color> 标红 */
  private setDesc(s: string): void {
    setText(this.dDesc, s);
  }

  private chip(label: string, color: RGBA | null): void {
    const chip = el('sf-chip sf-codex__chip', this.chips);
    const l = text('sf-chip__name', chip, label);
    if (color) {
      l.style.color = css(color);
      chip.style.borderColor = css(withAlpha(color, 0.5));
    }
  }

  private stat(label: string, value: string): void {
    const row = el('sf-codex__stat', this.statGrid);
    text('sf-codex__statk', row, label);
    text('sf-codex__statv', row, value, UIFontRole.Number);
  }

  private trait(body: string, head?: string): void {
    const row = el('sf-codex__trait', this.traits);
    if (head) text('sf-codex__traithead', row, head, UIFontRole.Title);
    text('sf-codex__traittext', row, body, UIFontRole.Body, true);
  }

  private describeWeapon(e: CodexEntry): void {
    const w = e.def as { id: string; category: string; element: string; mode?: string; description?: string; projectile?: { explosionRadius?: number } | null };
    const inst = { uid: -1, defId: w.id, rarity: 0, element: w.element, level: 0, mag: 0, reserve: 0, affixes: [] } as unknown as WeaponInstance;
    const desc = this.ctx.weapons.describe(inst);
    this.dSub.textContent = desc?.category ?? w.category;
    if (desc?.elementLabel) this.chip(desc.elementLabel, GoldHi);
    else if (w.element !== 'none') this.chip(ELEMENT_NAMES[w.element as keyof typeof ELEMENT_NAMES] ?? w.element, elementColor(w.element));
    if (w.mode) this.chip(MODE_NAMES[w.mode] ?? w.mode, null);
    if ((w.projectile?.explosionRadius ?? 0) > 0) this.chip('爆炸', null);
    this.setDesc(w.description ?? '');
    if (desc) {
      for (const s of desc.stats) this.stat(s.label, s.value);
      for (const t of desc.traits) this.trait(t);
      if (desc.skill) this.trait(`${desc.skill.description}（冷却 ${num1(desc.skill.cooldown)} 秒）`, `武器技能 · ${desc.skill.name}`);
    }
    this.dFoot.textContent = '以上为普通品质、未强化的基础数值；品质与强化越高伤害越高，词条随掉落另掷。';
  }

  private describeScroll(s: ScrollDef): void {
    this.chip(RARITY_NAMES[s.rarity] ?? '', rarityColor(s.rarity));
    if (s.maxStacks > 1) this.chip(`最多 ${s.maxStacks} 层`, null);
    if (s.heroOnly) this.chip(`${this.ctx.heroes.find((h) => h.id === s.heroOnly)?.name ?? s.heroOnly} 专属`, GoldHi);
    // Unity DescribeScroll：dDesc = Describe(1)、叠满一层另列 Describe(maxStacks)；高风险卷的代价行是红色富文本
    const one = scrollRichText(s, 1);
    this.setDesc(one);
    if (s.maxStacks > 1) {
      const full = scrollRichText(s, s.maxStacks);
      if (full && full !== one) this.trait(full, `叠满 ${s.maxStacks} 层`);
    }
  }

  private describeEnemy(e: CodexEntry): void {
    const d = e.def as EnemyDef;
    if (e.chapter > 0) this.chip(chapterTitle(e.chapter), null);
    if (e.boss) this.chip('首领', CinnabarHi);
    if (d.element && d.element !== 'none') this.chip(ELEMENT_NAMES[d.element], elementColor(d.element));
    if (d.flying) this.chip('飞行', null);
    this.setDesc(describeEnemy(e));
    if (e.boss) return;
    this.stat('生命', num(d.hp));
    if ((d.armor ?? 0) > 0) this.stat('护甲', num(d.armor!));
    if ((d.shield ?? 0) > 0) this.stat('护盾', num(d.shield!));
    this.stat('移速', num1(d.speed));
    if (d.damage > 0) this.stat('伤害', num(d.damage));
    this.dFoot.textContent = '基础数值（难度 1）；越往后的关卡生命与伤害越高，精英另有词缀。';
  }

  private describePet(p: PetDefView): void {
    this.chip(p.rarityName, rgb(p.rarityColor));
    if (p.element !== 'none') this.chip(ELEMENT_NAMES[p.element], elementColor(p.element));
    if (p.role) this.chip(p.role, null);
    this.setDesc(p.lore ?? '');
    if (p.attackDesc) this.trait(p.attackDesc, '攻击');
    if (p.passiveDesc) this.trait(p.passiveDesc, p.passiveName ? `被动 · ${p.passiveName}` : '被动');
    if (p.skillDesc) this.trait(`${p.skillDesc}（冷却 ${num1(p.skillCooldown)} 秒）`, p.skillName ? `灵技 · ${p.skillName}` : '灵技');
    if (p.awakenDesc) this.trait(p.awakenDesc, '觉醒');
  }

  // ───────────── 每帧 / 键盘 ─────────────

  /** 在最左 / 最右一列再往外按：翻页 */
  override onNavigate(dx: number, _dy: number): boolean {
    if (dx === 0) return false;
    const i = this.cells.findIndex((c) => c.button === document.activeElement);
    if (i < 0) return false;
    const col = i % CODEX_COLUMNS, row = Math.floor(i / CODEX_COLUMNS) * CODEX_COLUMNS;
    if (dx < 0 && col === 0) {
      this.prevPage();
      this.focusCell(row + CODEX_COLUMNS - 1);
      return true;
    }
    if (dx > 0 && col === CODEX_COLUMNS - 1) {
      this.nextPage();
      this.focusCell(row);
      return true;
    }
    return false;
  }

  private focusCell(i: number): void {
    for (let k = Math.min(Math.max(0, i), this.cells.length - 1); k >= 0; k--)
      if (this.cells[k].entry) {
        this.cells[k].button.focus();
        return;
      }
  }

  /** Q / E 换页签 */
  onKey(code: string): boolean {
    const i = CODEX_KINDS.indexOf(this.kind);
    if (code === 'KeyQ') this.select(CODEX_KINDS[(i + 3) % 4]);
    else if (code === 'KeyE') this.select(CODEX_KINDS[(i + 1) % 4]);
    else return false;
    return true;
  }

  override tick(): void {
    const k = easeOut((this.now() - this.openedAt) / 0.28);
    this.frame.style.opacity = String(Math.round(k * 1000) / 1000);
    this.frame.style.translate = `0px ${(14 * (1 - k)).toFixed(2)}px`;
    const t = this.thumbs;
    if (!t) return;
    // 缩略图：每帧拍一张，先拍选中的，再拍这一页的
    if (this.selected && !t.ready(this.selected)) this.shoot(this.selected);
    else {
      const c = this.cells.find((x) => x.entry && !t.ready(x.entry));
      if (c?.entry) this.shoot(c.entry);
    }
  }

  private shoot(e: CodexEntry): void {
    this.thumbs!.get(e);
    const have = this.book.isUnlocked(e.kind, e.id);
    for (const c of this.cells) if (c.entry === e) this.paintThumb(e, have, c.thumb, c.glyph, c.frame);
    if (e === this.selected) this.paintThumb(e, have, this.heroThumb, this.heroGlyph, this.heroFrame);
  }
}
