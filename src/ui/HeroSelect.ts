/**
 * 英雄选择：左侧英雄名录（竖排条目）+ 右侧详情区。
 * 详情区以 3D 预览舞台为视觉中心：左列是占满整个详情区高度的舞台（HeroPreview：英雄角色模型右手持初始武器、
 * 站在祭台上，配英雄主题氛围；可拖拽旋转英雄；底部名牌为「英雄名 · 称号」；WebGL 不可用时用大号单字水印兜底）；
 * 右列上方是大号名字 / 称号 / 定位 / 标签 / 难度，下方信息栏（描述与要诀、基础属性对比条、Q / E / 被动、
 * 初始武器数据）自身滚动。窄屏时依次堆叠为：名字 → 舞台 → 信息栏。
 * 点击条目选中，「出征」或双击条目开始；键盘 1–9 选择、← → ↑ ↓ 切换、Enter 确认。
 * 生命周期：MainMenu 进入本页时 refresh() + activate()，离开或隐藏菜单时 deactivate()（停止预览渲染）。
 */
import type { GameContext, HeroDef, SkillDef, StatKey } from '../core/types';
import { BASE_STATS, STAT_INFO } from '../core/Stats';
import { getWeaponDef, hasWeaponDef, hitsPerShot, shotsPerSecond, type WeaponDef } from '../weapons/WeaponDefs';
import { h, icon, bindButton, button, sfx, clearChildren, formatNum } from './dom';
import { ICON_ESSENCE, ICON_LOCK } from './icons';
import {
  DIFFICULTY_NAMES, ELEMENT_GLYPH, WEAPON_NAMES, cnNum, elementCss, fmtStat, heroColor, heroGlyph, heroMeta,
} from './labels';
import { HeroPreview } from './HeroPreview';

/** 未解锁英雄的解锁价格（魂晶）。目前设计中三名英雄默认解锁，这里只是兜底。 */
const HERO_UNLOCK_COST = 300;

/** 详情区固定显示（并做进度条对比）的三项基础属性 */
const CORE_STATS: { key: StatKey; label: string }[] = [
  { key: 'maxHp', label: '生命' },
  { key: 'maxShield', label: '护盾' },
  { key: 'moveSpeed', label: '移速' },
];

/** 切换英雄时详情文字的淡出时长（毫秒）；淡入由 CSS 过渡完成，两段合计不超过 250ms */
const SWAP_OUT_MS = 90;

const DETAIL_ID = 'gf-hero-detail';

/** 保留 1 位小数并去掉多余的 0 */
function num1(v: number): string {
  return String(Math.round(v * 10) / 10);
}

function statOf(hero: HeroDef, key: StatKey): number {
  return hero.base[key] ?? BASE_STATS[key];
}

function fireModeName(def: WeaponDef): string {
  switch (def.mode) {
    case 'semi':
      return '半自动';
    case 'auto':
      return '全自动';
    case 'burst':
      return `${cnNum(Math.max(1, def.burstCount))}连发`;
    case 'beam':
      return '持续光束';
    case 'spinup':
      return '预热全自动';
    default:
      return '';
  }
}

/** 武器中文名与类别：优先取武器定义，没有定义时退回文案表 */
function weaponLabel(id: string): { name: string; category: string } {
  if (hasWeaponDef(id)) {
    const def = getWeaponDef(id);
    return { name: def.name, category: def.category };
  }
  const info = WEAPON_NAMES[id];
  return info ? { name: info.name, category: info.category } : { name: id, category: '' };
}

/**
 * 技能描述末尾常带「冷却 20 秒。」「2 次充能，每次充能 8 秒。」——与技能名旁的冷却 / 充能标注重复，
 * 显示标注时去掉这句，信息栏少折一行。
 */
const SKILL_TIMING_TAIL = /\s*(?:\d+\s*次充能[，,]\s*)?(?:每次充能|冷却)\s*[\d.]+\s*秒[。.]?\s*$/;

function skillDesc(text: string, hasMeta: boolean): string {
  if (!hasMeta) return text;
  const trimmed = text.replace(SKILL_TIMING_TAIL, '');
  return trimmed.length > 0 ? trimmed : text;
}

function subtitleText(canDrag: boolean): string {
  return `按 1 / 2 / 3 或 ↑ ↓ 切换英雄，Enter 出征${canDrag ? '；拖拽舞台可旋转英雄' : ''}。`;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

interface StatBar {
  key: StatKey;
  fill: HTMLElement;
  value: HTMLElement;
}

export class HeroSelect {
  readonly root: HTMLDivElement;
  private sub: HTMLParagraphElement;
  private list: HTMLDivElement;
  private confirmBtn: HTMLButtonElement;
  private tabs: HTMLElement[] = [];
  private selected = 0;
  private built = false;
  private active = false;

  // ───── 详情区 ─────
  private detail: HTMLElement;
  private headEl: HTMLElement;
  private loreEl: HTMLDivElement;
  private stage: HTMLDivElement;
  private markEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private plateEl: HTMLDivElement;
  private lockEl: HTMLDivElement;
  private lockNote: HTMLParagraphElement;
  private bars: StatBar[] = [];
  private extrasEl: HTMLDivElement;
  private skillsEl: HTMLDivElement;
  private weaponEl: HTMLDivElement;

  // ───── 3D 预览与切换状态 ─────
  private preview: HeroPreview | null = null;
  /** 已交给预览台的英雄 id（避免重复 setHero 触发重复过渡） */
  private previewId: string | null = null;
  /** 详情区最近一次请求展示的英雄 id */
  private targetId: string | null = null;
  /** 详情区是否已经渲染过（首次渲染不做切换动画） */
  private rendered = false;
  private swapTimer = 0;

  constructor(private readonly ctx: GameContext, onBack: () => void) {
    this.root = h('div', 'gf-heroes');
    const head = h('div', 'gf-panel__head gf-heroes__head', this.root);
    h('h2', 'gf-panel__title', head, '选择英雄');
    this.sub = h('p', 'gf-panel__sub', head, subtitleText(false));

    const body = h('div', 'gf-heroes__body', this.root);

    // ───── 左栏：名录 ─────
    const roster = h('div', 'gf-heroes__roster', body);
    h('div', 'gf-heroes__label', roster, '英雄名录');
    this.list = h('div', 'gf-heroes__list', roster);
    this.list.setAttribute('role', 'tablist');
    this.list.setAttribute('aria-orientation', 'vertical');
    this.list.setAttribute('aria-label', '英雄名录');

    // ───── 右栏：详情（网格：左列舞台跨两行；右列上为名字区、下为信息栏。DOM 顺序即窄屏堆叠顺序） ─────
    this.detail = h('section', 'gf-hero-detail', body);
    this.detail.id = DETAIL_ID;
    this.detail.setAttribute('role', 'tabpanel');
    this.headEl = h('header', 'gf-hero-detail__head gf-hero-swap', this.detail);

    // 预览舞台（HeroPreview 的 host；canvas 由 HeroPreview 挂入）
    this.stage = h('div', 'gf-hero-stage is-fallback', this.detail);
    this.markEl = h('div', 'gf-hero-stage__mark', this.stage);
    this.markEl.setAttribute('aria-hidden', 'true');
    h('div', 'gf-hero-stage__frame', this.stage);
    this.hintEl = h('div', 'gf-hero-stage__hint', this.stage, '拖拽旋转英雄');
    this.hintEl.hidden = true;
    this.plateEl = h('div', 'gf-hero-stage__plate gf-hero-swap', this.stage);
    this.lockEl = h('div', 'gf-hero-stage__lock', this.stage);
    this.lockEl.hidden = true;
    icon(ICON_LOCK, 'gf-icon gf-hero-stage__lockicon', this.lockEl);
    h('div', 'gf-hero-stage__locktext', this.lockEl, '尚未解锁');
    this.lockNote = h('p', 'gf-hero-stage__locknote', this.lockEl);
    const unlockBtn = h('button', 'gf-btn gf-btn--primary gf-btn--sm', this.lockEl);
    unlockBtn.type = 'button';
    icon(ICON_ESSENCE, 'gf-icon gf-icon--essence', unlockBtn);
    h('span', null, unlockBtn, `${formatNum(HERO_UNLOCK_COST)} 解锁`);
    bindButton(ctx, unlockBtn, (e) => {
      e.stopPropagation();
      this.unlockSelected();
    });

    // 信息栏（高度不足时自身滚动）：描述与要诀在最上方
    const info = h('div', 'gf-hero-info', this.detail);
    this.loreEl = h('div', 'gf-hero-detail__lore gf-hero-swap', info);
    const statSect = this.section(info, '基础属性');
    const barsEl = h('div', 'gf-hero-bars', statSect);
    for (const s of CORE_STATS) {
      const row = h('div', 'gf-hero-bar', barsEl);
      h('span', 'gf-hero-bar__label', row, s.label);
      const track = h('div', 'gf-hero-bar__track', row);
      const fill = h('div', 'gf-hero-bar__fill', track);
      const value = h('b', 'gf-hero-bar__value', row);
      this.bars.push({ key: s.key, fill, value });
    }
    // 额外属性（额外跳跃、减伤等）放在小节标题行右端，不单独占一行
    this.extrasEl = h('div', 'gf-hero-extras gf-hero-swap', statSect.firstElementChild as HTMLElement);
    this.skillsEl = h('div', 'gf-hero-skills gf-hero-swap', this.section(info, '技能'));
    this.weaponEl = h('div', 'gf-hero-weapon gf-hero-swap', this.section(info, '初始武器'));

    // ───── 页脚 ─────
    const foot = h('div', 'gf-panel__foot gf-heroes__foot', this.root);
    button(ctx, 'gf-btn gf-btn--ghost', foot, '返回', () => onBack());
    this.confirmBtn = button(ctx, 'gf-btn gf-btn--primary gf-btn--wide', foot, '出征', () => this.confirm());
  }

  /** 构建（仅首次）+ 同步锁定状态 + 刷新当前选择 */
  refresh(): void {
    if (!this.built) {
      this.built = true;
      this.build();
    }
    this.syncLocks();
    this.select(Math.min(this.selected, Math.max(0, this.tabs.length - 1)), false, false);
  }

  /** 本页可见：把当前英雄交给预览台并开始渲染。可重复调用 */
  activate(): void {
    this.active = true;
    const preview = this.preview;
    if (!preview) return;
    const hero = this.heroes()[this.selected];
    if (hero) this.showPreviewHero(hero);
    try {
      preview.start();
      // 其余英雄趁空闲预先搭好（首次切换时不必现场建模、编译着色器）
      preview.prewarm(this.heroes());
    } catch (err) {
      console.error('[UI] 英雄预览台启动失败', err);
    }
    this.syncPreviewMode();
  }

  /** 本页不可见：停止预览渲染。可重复调用 */
  deactivate(): void {
    this.active = false;
    try {
      this.preview?.stop();
    } catch (err) {
      console.error('[UI] 英雄预览台停止失败', err);
    }
  }

  /** 返回 true 表示已处理该按键 */
  handleKey(e: KeyboardEvent): boolean {
    const n = this.tabs.length;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (m) {
      const k = Number(m[1]) - 1;
      if (k < n) {
        this.select(k, true);
        return true;
      }
      return false;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      this.confirm();
      return true;
    }
    const d =
      e.code === 'ArrowLeft' || e.code === 'ArrowUp' ? -1 : e.code === 'ArrowRight' || e.code === 'ArrowDown' ? 1 : 0;
    if (d !== 0 && n > 0) {
      this.select((this.selected + d + n) % n, true);
      return true;
    }
    return false;
  }

  private heroes(): readonly HeroDef[] {
    return this.ctx.heroes ?? [];
  }

  private unlocked(id: string): boolean {
    try {
      return this.ctx.meta.isHeroUnlocked(id);
    } catch {
      return true;
    }
  }

  private essence(): number {
    try {
      return this.ctx.meta.save.essence;
    } catch {
      return 0;
    }
  }

  // ───────────────────────────── 选择 / 出征 ─────────────────────────────

  /**
   * 选中第 i 位英雄：名录高亮、主题色、出征按钮、锁定遮罩、属性条立即更新；
   * 详情文字做短暂的淡出 → 更新 → 淡入（animate 为 false 时直接更新）。
   */
  private select(i: number, withSound: boolean, animate = true): void {
    const heroes = this.heroes();
    if (this.tabs.length === 0 || heroes.length === 0) {
      this.confirmBtn.textContent = '出征';
      this.confirmBtn.disabled = true;
      this.confirmBtn.classList.add('is-disabled');
      return;
    }
    const idx = Math.max(0, Math.min(i, this.tabs.length - 1));
    const hero = heroes[idx];
    if (!hero) return;
    this.selected = idx;
    this.tabs.forEach((t, k) => {
      t.classList.toggle('is-selected', k === idx);
      t.setAttribute('aria-selected', String(k === idx));
    });
    // 焦点在名录上时跟随选择移动（键盘切换）
    const focused = document.activeElement;
    const tab = this.tabs[idx];
    if (focused && focused !== tab && this.tabs.includes(focused as HTMLElement)) tab.focus({ preventScroll: true });
    this.detail.setAttribute('aria-labelledby', tab.id);

    this.root.style.setProperty('--hero', heroColor(hero));
    this.syncSelected(hero);
    this.updateBars(hero);
    this.showPreviewHero(hero);
    if (hero.id !== this.targetId) {
      this.targetId = hero.id;
      this.swapDetail(animate);
    }
    if (withSound) sfx(this.ctx, 'ui_hover');
  }

  /** 在点击 / 按键处理函数里同步调用 startRun */
  private confirm(): void {
    const hero = this.heroes()[this.selected];
    if (!hero) return;
    if (!this.unlocked(hero.id)) {
      sfx(this.ctx, 'ui_deny');
      return;
    }
    sfx(this.ctx, 'ui_confirm');
    this.ctx.game.startRun(hero.id);
  }

  private unlockSelected(): void {
    const ctx = this.ctx;
    const hero = this.heroes()[this.selected];
    if (!hero) return;
    let ok = false;
    try {
      ok = ctx.meta.unlockHero(hero.id, HERO_UNLOCK_COST);
      if (ok) ctx.meta.persist();
    } catch (err) {
      console.error('[UI] 解锁英雄失败', err);
    }
    if (ok) {
      sfx(ctx, 'ui_confirm');
      ctx.ui.toast(`已解锁 ${hero.name}`, heroColor(hero));
    } else {
      sfx(ctx, 'ui_deny');
      ctx.ui.toast('魂晶不足', '#ff6a4d');
    }
    this.syncLocks();
    this.select(this.selected, false, false);
  }

  /** 当前英雄的出征按钮与舞台锁定遮罩 */
  private syncSelected(hero: HeroDef): void {
    const ok = this.unlocked(hero.id);
    this.confirmBtn.textContent = ok ? `出征 · ${hero.name}` : '尚未解锁';
    this.confirmBtn.disabled = !ok;
    this.confirmBtn.classList.toggle('is-disabled', !ok);
    this.lockEl.hidden = ok;
    this.stage.classList.toggle('is-locked', !ok);
    if (!ok) this.lockNote.textContent = `持有魂晶 ${formatNum(this.essence())}`;
  }

  private syncLocks(): void {
    const heroes = this.heroes();
    this.tabs.forEach((tab, i) => {
      const hero = heroes[i];
      if (!hero) return;
      const locked = !this.unlocked(hero.id);
      tab.classList.toggle('is-locked', locked);
      const lock = tab.querySelector<HTMLElement>('.gf-hero-tab__lock');
      if (lock) lock.hidden = !locked;
      tab.setAttribute('aria-label', `${hero.name} · ${hero.title} · ${heroMeta(hero).role}${locked ? '（未解锁）' : ''}`);
    });
  }

  // ───────────────────────────── 3D 预览 ─────────────────────────────

  private showPreviewHero(hero: HeroDef): void {
    const preview = this.preview;
    if (!preview || this.previewId === hero.id) return;
    this.previewId = hero.id;
    try {
      preview.setHero(hero);
    } catch (err) {
      console.error('[UI] 英雄预览切换失败', err);
    }
  }

  /** WebGL 不可用时：水印更显眼、隐藏拖拽提示与副标题里的拖拽说明 */
  private syncPreviewMode(): void {
    const ok = !!this.preview && this.preview.supported;
    this.stage.classList.toggle('is-fallback', !ok);
    this.hintEl.hidden = !ok;
    this.sub.textContent = subtitleText(ok);
  }

  // ───────────────────────────── 构建 ─────────────────────────────

  private build(): void {
    clearChildren(this.list);
    this.tabs = [];
    const heroes = this.heroes();
    heroes.forEach((hero, i) => this.tabs.push(this.buildTab(hero, i)));
    if (heroes.length === 0) h('div', 'gf-empty', this.list, '暂无可选的英雄。');
    this.detail.hidden = heroes.length === 0;

    // 3D 预览台只创建一次，之后切换英雄都复用
    if (!this.preview) {
      try {
        this.preview = new HeroPreview(this.ctx, this.stage);
      } catch (err) {
        console.error('[UI] 英雄预览台创建失败', err);
        this.preview = null;
      }
    }
    this.syncPreviewMode();
  }

  private buildTab(hero: HeroDef, i: number): HTMLElement {
    const meta = heroMeta(hero);
    const tab = h('div', 'gf-hero-tab', this.list);
    tab.id = `gf-hero-tab-${hero.id}`;
    tab.tabIndex = 0;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', DETAIL_ID);
    tab.style.setProperty('--hero', heroColor(hero));
    tab.style.setProperty('--i', String(i));
    bindButton(this.ctx, tab, () => this.select(i, false));
    tab.addEventListener('dblclick', () => {
      this.select(i, false);
      this.confirm();
    });
    // Tab 键聚焦即选中（之后 Enter 出征的就是聚焦的这位）
    tab.addEventListener('focus', () => {
      if (this.selected !== i) this.select(i, tab.matches(':focus-visible'));
    });

    const medal = h('div', 'gf-hero-tab__medal', tab);
    h('span', 'gf-hero-tab__glyph', medal, heroGlyph(hero));
    const names = h('div', 'gf-hero-tab__names', tab);
    h('div', 'gf-hero-tab__name', names, hero.name);
    h('div', 'gf-hero-tab__title', names, hero.title);
    h('div', 'gf-hero-tab__role', names, meta.role);
    if (i < 9) {
      const idx = h('span', 'gf-hero-tab__index', tab, String(i + 1));
      idx.setAttribute('aria-hidden', 'true');
    }
    const lock = icon(ICON_LOCK, 'gf-icon gf-hero-tab__lock', tab);
    lock.hidden = true;
    return tab;
  }

  private section(parent: HTMLElement, title: string): HTMLElement {
    const sect = h('section', 'gf-hero-sect', parent);
    h('h4', 'gf-hero-sect__title', sect, title);
    return sect;
  }

  // ───────────────────────────── 详情渲染 ─────────────────────────────

  private swapDetail(animate: boolean): void {
    window.clearTimeout(this.swapTimer);
    this.swapTimer = 0;
    if (!animate || !this.rendered || reducedMotion()) {
      this.root.classList.remove('is-swapping');
      this.renderCurrent();
      return;
    }
    this.root.classList.add('is-swapping');
    this.swapTimer = window.setTimeout(() => {
      this.swapTimer = 0;
      this.renderCurrent();
      this.root.classList.remove('is-swapping');
    }, SWAP_OUT_MS);
  }

  private renderCurrent(): void {
    const hero = this.heroes()[this.selected];
    if (!hero) return;
    this.rendered = true;
    this.renderHead(hero);
    this.renderStage(hero);
    this.renderExtras(hero);
    this.renderSkills(hero);
    this.renderWeapon(hero);
  }

  private renderHead(hero: HeroDef): void {
    const meta = heroMeta(hero);
    const head = this.headEl;
    clearChildren(head);

    const ident = h('div', 'gf-hero-detail__ident', head);
    const names = h('div', 'gf-hero-detail__names', ident);
    h('h3', 'gf-hero-detail__name', names, hero.name);
    h('span', 'gf-hero-detail__title', names, hero.title);

    const tags = h('div', 'gf-hero-detail__meta', ident);
    h('span', 'gf-hero-role', tags, meta.role);
    for (const t of meta.tags) h('span', 'gf-hero-tag', tags, t);

    const diffName = DIFFICULTY_NAMES[meta.difficulty] ?? '';
    const diff = h('div', 'gf-hero-diff', ident);
    diff.setAttribute('aria-label', `上手难度：${diffName}`);
    const pips = h('span', 'gf-hero-diff__pips', diff);
    pips.setAttribute('aria-hidden', 'true');
    for (let k = 1; k <= 3; k++) h('i', k <= meta.difficulty ? 'gf-hero-diff__pip is-on' : 'gf-hero-diff__pip', pips);
    h('span', null, diff, '上手');
    h('b', null, diff, diffName);

    const lore = this.loreEl;
    clearChildren(lore);
    if (hero.description) h('p', 'gf-hero-detail__desc', lore, hero.description);
    if (meta.tip) {
      const tip = h('p', 'gf-hero-detail__tip', lore);
      h('span', 'gf-hero-detail__tiplabel', tip, '要诀');
      h('span', null, tip, meta.tip);
    }
    lore.hidden = lore.childElementCount === 0;
  }

  /** 舞台：单字水印（2D 兜底时是主视觉）+ 底部名牌「英雄名 · 称号」（武器信息在右侧信息栏） */
  private renderStage(hero: HeroDef): void {
    this.markEl.textContent = heroGlyph(hero);
    clearChildren(this.plateEl);
    const plaque = h('div', 'gf-hero-stage__plaque', this.plateEl);
    h('b', 'gf-hero-stage__pname', plaque, hero.name);
    if (hero.title) {
      h('i', 'gf-hero-stage__dot', plaque);
      h('span', 'gf-hero-stage__ptitle', plaque, hero.title);
    }
  }

  /** 生命 / 护盾 / 移速：长度按所有英雄中的最大值归一化 */
  private updateBars(hero: HeroDef): void {
    const heroes = this.heroes();
    for (const b of this.bars) {
      const v = statOf(hero, b.key);
      let max = 0;
      for (const o of heroes) max = Math.max(max, statOf(o, b.key));
      const k = max > 0 ? Math.max(0, Math.min(1, v / max)) : 0;
      b.fill.style.width = `${(k * 100).toFixed(1)}%`;
      b.value.textContent = num1(v);
    }
  }

  /** 与默认值不同的其他基础属性（额外跳跃、减伤等） */
  private renderExtras(hero: HeroDef): void {
    const el = this.extrasEl;
    clearChildren(el);
    for (const key of Object.keys(hero.base) as StatKey[]) {
      if (CORE_STATS.some((c) => c.key === key)) continue;
      const v = hero.base[key];
      if (v === undefined || v === BASE_STATS[key]) continue;
      h('span', 'gf-hero-extra', el, `${STAT_INFO[key]?.name ?? key} ${fmtStat(key, v - BASE_STATS[key])}`);
    }
    el.hidden = el.childElementCount === 0;
  }

  private renderSkills(hero: HeroDef): void {
    const el = this.skillsEl;
    clearChildren(el);
    this.skillRow(el, 'Q', hero.primary, false);
    this.skillRow(el, 'E', hero.secondary, true);
    const passive = h('div', 'gf-hero-skill gf-hero-skill--passive', el);
    h('span', 'gf-hero-skill__key', passive, '被动');
    const body = h('div', 'gf-hero-skill__body', passive);
    h('div', 'gf-hero-skill__name', body, hero.passive.name || '—');
    if (hero.passive.description) h('div', 'gf-hero-skill__desc', body, hero.passive.description);
  }

  private skillRow(parent: HTMLElement, key: string, def: SkillDef, secondary: boolean): void {
    const row = h('div', 'gf-hero-skill', parent);
    h('span', 'gf-hero-skill__key', row, key);
    const body = h('div', 'gf-hero-skill__body', row);
    const name = h('div', 'gf-hero-skill__name', body, def.name || '—');
    const meta: string[] = [];
    if (def.cooldown > 0) meta.push(`冷却 ${num1(def.cooldown)} 秒`);
    if (secondary || def.charges > 1) meta.push(`${Math.max(1, def.charges)} 次充能`);
    if (meta.length) h('span', 'gf-hero-skill__meta', name, meta.join(' · '));
    if (def.description) h('div', 'gf-hero-skill__desc', body, skillDesc(def.description, def.cooldown > 0));
  }

  private renderWeapon(hero: HeroDef): void {
    const el = this.weaponEl;
    clearChildren(el);
    const id = hero.startingWeapon;
    const w = weaponLabel(id);
    const head = h('div', 'gf-hero-weapon__head', el);
    h('b', 'gf-hero-weapon__name', head, w.name);
    if (w.category) h('span', 'gf-hero-weapon__cat', head, w.category);
    if (!hasWeaponDef(id)) return;

    const def = getWeaponDef(id);
    const mode = fireModeName(def);
    if (mode) h('span', 'gf-hero-weapon__mode', head, mode);
    if (def.element !== 'none') {
      const chip = h('span', 'gf-hero-weapon__elem', head, `${ELEMENT_GLYPH[def.element]}属性`);
      chip.style.setProperty('--elem', elementCss(def.element));
    }

    const cells = h('div', 'gf-hero-weapon__cells', el);
    const hits = hitsPerShot(def);
    this.weaponCell(cells, '伤害', hits > 1 ? `${num1(def.damage)}×${hits}` : num1(def.damage));
    this.weaponCell(cells, '射速', shotsPerSecond(def).toFixed(1), def.mode === 'beam' ? '跳/秒' : '发/秒');
    this.weaponCell(cells, '弹匣', String(def.mag));
    this.weaponCell(cells, '暴击', `×${num1(def.critMult)}`);
    if (def.description) h('p', 'gf-hero-weapon__desc', el, def.description);
  }

  private weaponCell(parent: HTMLElement, label: string, value: string, unit?: string): void {
    const cell = h('div', 'gf-hero-weapon__cell', parent);
    const v = h('b', 'gf-hero-weapon__num', cell, value);
    if (unit) h('small', null, v, unit);
    h('span', 'gf-hero-weapon__label', cell, label);
  }
}
