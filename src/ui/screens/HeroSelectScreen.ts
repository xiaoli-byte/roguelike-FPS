/**
 * 选英雄（照译 Unity G/UI/Screens/HeroSelectScreen.cs，样式 css/unity/menu.css 的 .sf-heroes）。主角是英雄本人，界面只在两侧：
 *   左：英雄名录（徽记、名字、称号、定位、序号；未解锁带锁）；
 *   中：英雄预览台（拖动旋转英雄）+ 底部名牌「英雄名 · 称号」；
 *   右：信息栏——大号名字（英雄色）/ 称号 / 定位与玩法标签 / 上手难度；描述与要诀；基础属性对比条（生命 / 护盾 / 移速，按全体英雄的最大值归一）
 *       和额外属性；Q / E / 被动；初始武器卡（类别、开火方式、元素、伤害 / 射速 / 弹匣 / 暴击）；
 *   右下：返回 /「出征 · 名字」。
 * 操作：点名录选人（双击直接出征）；1 / 2 / 3；↑ ↓ 在名录里换人，→ 跳到「出征」；名录上按回车出征。
 * 不挡游戏；返回回主菜单。
 * 网页差异：Unity 把镜头推到主菜单场景广场中央的祭台（HeroStage），网页没有菜单场景——中间的拖拽区里嵌旧选人页的 3D 预览台
 *   （HeroPreview：祭台、英雄模型持初始武器、氛围粒子，自己处理拖拽旋转）；定位 / 标签 / 难度 / 要诀在 labels.ts 的 HERO_META（Unity 在 HeroDef 上）。
 */
import type { GameContext, HeroDef, StatKey } from '../../core/types';
import { BASE_STATS, STAT_INFO } from '../../core/Stats';
import { getWeaponDef, hasWeaponDef, hitsPerShot, shotsPerSecond } from '../../weapons/WeaponDefs';
import { HeroPreview } from '../HeroPreview';
import { barRatio, cnNum, skillRow } from '../ScreenData';
import { sfx } from '../dom';
import { DIFFICULTY_NAMES, ELEMENT_GLYPH, fmtStat, heroMeta } from '../labels';
import { el, text, toggle } from '../toolkit/el';
import { UIFontRole, warmup } from '../toolkit/UIFonts';
import { UIIcon } from '../toolkit/UIIcons';
import { type BlockState, UIScreen } from '../toolkit/UIRouter';
import { Bad, Gold, css, elementColor, fadeRight, lerpColor, paint, rgb, withAlpha } from '../toolkit/UITheme';
import { btn, card, crest, easeOut, icon, num, num1, scroll } from './ScreenKit';

export const HERO_SELECT_SCREEN_ID = 'hero-select';
/** 解锁一位英雄要的魂晶（同旧选人页） */
export const HERO_UNLOCK_COST = 300;
const LAST_HERO_KEY = 'gunflame.menu.lastHero';

const BARS: { label: string; key: StatKey }[] = [
  { label: '生命', key: 'maxHp' },
  { label: '护盾', key: 'maxShield' },
  { label: '移速', key: 'moveSpeed' },
];
const baseOf = (h: HeroDef, k: StatKey) => h.base[k] ?? BASE_STATS[k];

export class HeroSelectScreen extends UIScreen {
  readonly id = HERO_SELECT_SCREEN_ID;
  override get blockState(): BlockState | null {
    return null;
  }
  override get freezeTime(): boolean {
    return false;
  }
  override get defaultFocus(): HTMLElement | null {
    return this.tabs[this.selected] ?? this.confirmBtn;
  }

  private readonly tabs: HTMLButtonElement[] = [];
  private readonly bars: { key: StatKey; fill: HTMLDivElement; number: HTMLDivElement }[] = [];
  private roster!: HTMLDivElement;
  private list!: HTMLDivElement;
  private info!: HTMLDivElement;
  private infoBody!: HTMLDivElement;
  private plate!: HTMLDivElement;
  private dragArea!: HTMLDivElement;
  private extras!: HTMLDivElement;
  private skills!: HTMLDivElement;
  private weapon!: HTMLDivElement;
  private lore!: HTMLDivElement;
  private headBlock!: HTMLDivElement;
  private plateName!: HTMLDivElement;
  private plateTitle!: HTMLDivElement;
  private confirmBtn: HTMLButtonElement | null = null;
  private preview: HeroPreview | null = null;
  private selected = 0;
  private openedAt = 0;
  private swapAt = -10;

  constructor(private readonly ctx: GameContext, private readonly toast: (text: string, color?: string) => void, private readonly now: () => number) {
    super();
  }

  private get heroes(): readonly HeroDef[] {
    return this.ctx.heroes;
  }

  /** 选中的英雄（测试用） */
  get selectedHero(): HeroDef | null {
    return this.heroes[Math.min(Math.max(0, this.selected), this.heroes.length - 1)] ?? null;
  }

  protected build(): HTMLElement {
    const ctx = this.ctx;
    const root = el('sf-heroes', null, 'hero-select');
    root.style.pointerEvents = 'none';
    paint(el('sf-heroes__shade sf-heroes__shade--l', root), fadeRight([0.02, 0.016, 0.024, 0.9]));
    paint(el('sf-heroes__shade sf-heroes__shade--r', root), fadeRight([0.02, 0.016, 0.024, 0.92]));
    // 预览台（接指针：拖动旋转）：放在最底下，名录 / 信息栏盖在它上面
    this.dragArea = el('sf-heroes__drag', root);
    this.dragArea.style.pointerEvents = 'auto';

    const head = el('sf-heroes__head', root);
    text('sf-panel__title sf-heroes__title', head, '选择英雄', UIFontRole.Title);
    text('sf-panel__sub', head, '按 1 / 2 / 3 或 ↑ ↓ 切换英雄，回车出征；拖拽祭台旋转英雄。');

    this.roster = el('sf-heroes__roster', root);
    this.roster.style.pointerEvents = 'auto';
    text('sf-heroes__label', this.roster, '英雄名录');
    this.list = el('sf-heroes__list', this.roster);

    this.plate = el('sf-heroes__plate', root);
    const plaque = el('sf-heroes__plaque', this.plate);
    this.plateName = text('sf-heroes__pname', plaque, '', UIFontRole.Title);
    el('sf-heroes__pdot', plaque);
    this.plateTitle = text('sf-heroes__ptitle', plaque, '');
    text('sf-heroes__hint', this.plate, '拖拽旋转英雄');

    this.info = el('sf-heroes__info', root);
    this.info.style.pointerEvents = 'auto';
    this.headBlock = el('sf-hero-detail__head', this.info);
    this.infoBody = el('sf-heroes__body', scroll('sf-heroes__scroll', this.info));
    this.lore = el('sf-hero-detail__lore', this.infoBody);
    const stat = section(this.infoBody, '基础属性');
    this.extras = el('sf-hero-extras', stat.head);
    const barsEl = el('sf-hero-bars', stat.sect);
    for (const b of BARS) {
      const row = el('sf-hero-bar', barsEl);
      text('sf-hero-bar__label', row, b.label);
      const fill = el('sf-hero-bar__fill', el('sf-hero-bar__track', row));
      this.bars.push({ key: b.key, fill, number: text('sf-hero-bar__value', row, '', UIFontRole.Number) });
    }
    this.skills = el('sf-hero-skills', section(this.infoBody, '技能').sect);
    this.weapon = el('sf-hero-weapon', section(this.infoBody, '初始武器').sect);

    const foot = el('sf-heroes__foot', root);
    foot.style.pointerEvents = 'auto';
    btn(ctx, '返回', 'sf-btn--ghost', foot, () => this.close());
    this.confirmBtn = btn(ctx, '出征', 'sf-btn--primary sf-btn--wide sf-sound-confirm', foot, () => this.confirm());
    this.confirmBtn.dataset.name = 'hero-confirm';
    return root;
  }

  // ───────────── 开 / 关 ─────────────

  override onOpen(arg?: unknown): void {
    this.openedAt = this.now();
    this.buildRoster();
    let want = typeof arg === 'string' ? arg : '';
    if (!want) {
      try {
        want = localStorage.getItem(LAST_HERO_KEY) ?? '';
      } catch {
        want = '';
      }
    }
    this.select(Math.max(0, this.heroes.findIndex((h) => h.id === want)), false, true);
    this.startPreview();
    void warmup('选择英雄名录基础属性技能初始武器出征返回要诀上手简单中等进阶生命护盾移速被动冷却充能伤害射速弹匣暴击', UIFontRole.Body);
    this.tick();
  }

  override onClose(): void {
    try {
      this.preview?.stop();
    } catch (err) {
      console.error('[UI] 英雄预览台停止失败', err);
    }
  }

  private startPreview(): void {
    try {
      if (!this.preview) this.preview = new HeroPreview(this.ctx, this.dragArea);
      const h = this.selectedHero;
      if (h) this.preview.setHero(h);
      this.preview.start();
      this.preview.prewarm(this.heroes);
    } catch (err) {
      console.error('[UI] 英雄预览台启动失败', err);
    }
  }

  private unlocked(h: HeroDef): boolean {
    try {
      return this.ctx.meta.isHeroUnlocked(h.id);
    } catch {
      return true;
    }
  }

  private buildRoster(): void {
    this.list.replaceChildren();
    this.tabs.length = 0;
    this.heroes.forEach((h, i) => {
      const tab = card(this.ctx, 'sf-hero-tab', this.list, () => this.select(i, true));
      tab.dataset.name = 'hero-tab-' + h.id;
      tab.addEventListener('dblclick', () => this.confirm());
      tab.addEventListener('focusin', () => {
        if (this.selected !== i) this.select(i, true);
      });
      const medal = crest(h, tab, 'sf-hero-tab__medal');
      medal.style.width = medal.style.height = '52px';
      const names = el('sf-hero-tab__names', tab);
      text('sf-hero-tab__name', names, h.name, UIFontRole.Title);
      text('sf-hero-tab__title', names, h.title);
      text('sf-hero-tab__role', names, heroMeta(h).role).style.color = css(lerpColor(rgb(h.color), [1, 1, 1, 1], 0.25));
      if (i < 9) text('sf-hero-tab__index', tab, String(i + 1), UIFontRole.Number);
      const locked = !this.unlocked(h);
      if (locked) icon(UIIcon.Lock, 'sf-hero-tab__lock', tab);
      toggle(tab, 'sf-hero-tab--locked', locked);
      tab.style.borderLeftColor = css(rgb(h.color));
      this.tabs.push(tab);
    });
    if (this.heroes.length === 0) text('sf-empty', this.list, '暂无可选的英雄。');
  }

  // ───────────── 选择 / 出征 ─────────────

  /** 选中第 i 位：名录高亮、预览台换人、详情换内容（sound = 出悬停音） */
  select(i: number, sound: boolean, force = false): void {
    const n = this.heroes.length;
    if (n === 0) return;
    i = ((i % n) + n) % n;
    if (i === this.selected && !force) return;
    this.selected = i;
    const h = this.heroes[i];
    this.tabs.forEach((t, k) => toggle(t, 'sf-hero-tab--on', k === i));
    try {
      this.preview?.setHero(h);
    } catch (err) {
      console.error('[UI] 英雄预览台换人失败', err);
    }
    this.render(h);
    this.swapAt = this.now();
    if (sound) sfx(this.ctx, 'ui_hover');
  }

  /** 出征（未解锁时改成花魂晶解锁） */
  confirm(): void {
    const h = this.selectedHero;
    if (!h) return;
    const meta = this.ctx.meta;
    if (!this.unlocked(h)) {
      let ok = false;
      try {
        ok = meta.unlockHero(h.id, HERO_UNLOCK_COST);
        if (ok) meta.persist();
      } catch (err) {
        console.error('[UI] 解锁英雄失败', err);
      }
      sfx(this.ctx, ok ? 'ui_confirm' : 'ui_deny');
      this.toast(ok ? `已解锁 ${h.name}` : '魂晶不足', ok ? css(rgb(h.color)) : css(Bad));
      this.buildRoster();
      this.select(this.selected, false, true);
      return;
    }
    try {
      localStorage.setItem(LAST_HERO_KEY, h.id);
    } catch {
      /* ignore */
    }
    this.ctx.game.startRun(h.id);
  }

  override onNavigate(dx: number, dy: number): boolean {
    const ti = this.tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (ti < 0) return false;
    if (dy !== 0) {
      const next = (ti + (dy > 0 ? -1 : 1) + this.tabs.length) % this.tabs.length;
      this.tabs[next].focus();
      this.select(next, true);
      return true;
    }
    if (dx > 0) {
      this.confirmBtn?.focus();
      sfx(this.ctx, 'ui_hover');
      return true;
    }
    return false;
  }

  /** 1 / 2 / 3 换人；名录上按回车出征（按钮自己的确认只是选中） */
  onKey(code: string): boolean {
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (m) {
      const i = Number(m[1]) - 1;
      if (i >= this.heroes.length) return false;
      this.select(i, true);
      this.tabs[i]?.focus();
      return true;
    }
    return false;
  }

  /** 回车落在名录上（UI.ts 在把回车交给按钮之前先问这里）：选中的那一行 = 出征 */
  submitOnTab(target: EventTarget | null): boolean {
    const i = this.tabs.indexOf(target as HTMLButtonElement);
    if (i < 0 || i !== this.selected) return false;
    this.confirm();
    return true;
  }

  override tick(): void {
    const now = this.now();
    const k = easeOut((now - this.openedAt) / 0.45);
    this.roster.style.opacity = k.toFixed(3);
    this.roster.style.translate = `${(-24 * (1 - k)).toFixed(2)}px 0px`;
    const ik = easeOut((now - this.openedAt - 0.1) / 0.45);
    this.info.style.opacity = ik.toFixed(3);
    this.info.style.translate = `${(24 * (1 - ik)).toFixed(2)}px 0px`;
    // 换人：详情从淡出处淡入，名牌跟着
    const sk = easeOut((now - this.swapAt) / 0.25);
    this.infoBody.style.opacity = this.headBlock.style.opacity = sk.toFixed(3);
    this.plate.style.opacity = (sk * k).toFixed(3);
    this.plate.style.translate = `0px ${(8 * (1 - sk)).toFixed(2)}px`;
  }

  // ───────────── 详情 ─────────────

  private render(h: HeroDef): void {
    const c = rgb(h.color);
    const meta = heroMeta(h);
    this.plateName.textContent = h.name;
    this.plateTitle.textContent = h.title;
    this.plateName.style.color = css(lerpColor(c, [1, 1, 1, 1], 0.35));

    this.headBlock.replaceChildren();
    const names = el('sf-hero-detail__names', this.headBlock);
    text('sf-hero-detail__name', names, h.name, UIFontRole.Title).style.color = css(lerpColor(c, [1, 1, 1, 1], 0.2));
    text('sf-hero-detail__title', names, h.title, UIFontRole.Title);
    const metaRow = el('sf-hero-detail__meta', this.headBlock);
    const role = text('sf-hero-role', metaRow, meta.role);
    role.style.backgroundColor = css(withAlpha(c, 0.22));
    role.style.borderColor = css(withAlpha(c, 0.6));
    for (const t of meta.tags) text('sf-hero-tag', metaRow, t);
    const diff = el('sf-hero-diff', this.headBlock);
    const pips = el('sf-hero-diff__pips', diff);
    for (let k = 1; k <= 3; k++) {
      const pip = el('sf-hero-diff__pip', pips);
      if (k <= meta.difficulty) pip.style.backgroundColor = css(c);
    }
    text('sf-hero-diff__label', diff, '上手');
    text('sf-hero-diff__value', diff, DIFFICULTY_NAMES[meta.difficulty] ?? '');

    this.lore.replaceChildren();
    if (h.description) text('sf-hero-detail__desc', this.lore, h.description);
    if (meta.tip) {
      const tip = el('sf-hero-detail__tip', this.lore);
      text('sf-hero-detail__tiplabel', tip, '要诀');
      text('sf-hero-detail__tiptext', tip, meta.tip);
    }

    for (const b of this.bars) {
      const v = baseOf(h, b.key);
      b.fill.style.width = `${(barRatio(v, this.heroes.map((o) => baseOf(o, b.key))) * 100).toFixed(1)}%`;
      b.fill.style.backgroundColor = css(lerpColor(c, Gold, 0.35));
      b.number.textContent = num1(v);
    }
    this.extras.replaceChildren();
    for (const k of Object.keys(h.base) as StatKey[]) {
      if (BARS.some((b) => b.key === k)) continue;
      const d = (h.base[k] ?? 0) - BASE_STATS[k];
      if (Math.abs(d) < 1e-5) continue;
      text('sf-hero-extra', this.extras, `${STAT_INFO[k]?.name ?? k} ${fmtStat(k, d)}`);
    }

    this.skills.replaceChildren();
    this.skillRow('Q', h.primary, false);
    this.skillRow('E', h.secondary, true);
    const prow = el('sf-hero-skill sf-hero-skill--passive', this.skills);
    text('sf-hero-skill__key', prow, '被动');
    const pbody = el('sf-hero-skill__body', prow);
    text('sf-hero-skill__name', pbody, h.passive?.name ?? '—', UIFontRole.Title);
    if (h.passive?.description) text('sf-hero-skill__desc', pbody, h.passive.description);
    this.renderWeapon(h);
    this.confirmBtn!.textContent = this.unlocked(h) ? `出征 · ${h.name}` : `解锁 · ${num(HERO_UNLOCK_COST)} 魂晶`;
  }

  private skillRow(key: string, s: HeroDef['primary'] | null, secondary: boolean): void {
    const v = skillRow(s, secondary);
    const row = el('sf-hero-skill', this.skills);
    text('sf-hero-skill__key', row, key, UIFontRole.Number);
    const body = el('sf-hero-skill__body', row);
    const name = el('sf-hero-skill__namerow', body);
    text('sf-hero-skill__name', name, v.name, UIFontRole.Title);
    if (v.meta) text('sf-hero-skill__meta', name, v.meta);
    if (v.desc) text('sf-hero-skill__desc', body, v.desc);
  }

  private renderWeapon(h: HeroDef): void {
    this.weapon.replaceChildren();
    const d = hasWeaponDef(h.startingWeapon) ? getWeaponDef(h.startingWeapon) : null;
    const head = el('sf-hero-weapon__head', this.weapon);
    text('sf-hero-weapon__name', head, d ? d.name : h.startingWeapon, UIFontRole.Title);
    if (!d) return;
    if (d.category) text('sf-hero-weapon__tag', head, d.category);
    const mode = { semi: '半自动', auto: '全自动', burst: `${cnNum(Math.max(1, d.burstCount))}连发`, beam: '持续光束', spinup: '预热全自动', charge: '蓄力' }[d.mode] ?? '';
    if (mode) text('sf-hero-weapon__tag', head, mode);
    if (d.element !== 'none') text('sf-hero-weapon__tag', head, `${ELEMENT_GLYPH[d.element]}属性`).style.color = css(elementColor(d.element));
    const cells = el('sf-hero-weapon__cells', this.weapon);
    const hits = Math.max(1, hitsPerShot(d));
    cell(cells, '伤害', hits > 1 ? `${num1(d.damage)}×${hits}` : num1(d.damage), null);
    cell(cells, '射速', shotsPerSecond(d).toFixed(1), d.mode === 'beam' ? '跳/秒' : '发/秒');
    cell(cells, '弹匣', String(d.mag), null);
    cell(cells, '暴击', `×${num1(d.critMult)}`, null);
    const desc = (d as { description?: string }).description;
    if (desc) text('sf-hero-weapon__desc', this.weapon, desc);
  }
}

function section(parent: HTMLElement, title: string): { sect: HTMLDivElement; head: HTMLDivElement } {
  const sect = el('sf-hero-sect', parent);
  const head = el('sf-hero-sect__head', sect);
  text('sf-hero-sect__title', head, title, UIFontRole.Title);
  return { sect, head };
}

function cell(parent: HTMLElement, label: string, value: string, unit: string | null): void {
  const c = el('sf-hero-weapon__cell', parent);
  const row = el('sf-hero-weapon__numrow', c);
  text('sf-hero-weapon__num', row, value, UIFontRole.Number);
  if (unit) text('sf-hero-weapon__unit', row, unit);
  text('sf-hero-weapon__label', c, label);
}
