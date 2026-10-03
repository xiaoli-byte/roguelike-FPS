import type { GameContext, IScrollSystem, Rarity, ScrollDef } from '../core/types';
import { RARITY_CSS, RARITY_NAMES } from '../core/types';
import { SCROLL_DEFS } from './ScrollDefs';

/**
 * 秘卷系统：持有、叠层、抽取。
 *  - add()：叠层时先卸载旧效果，再以新层数 apply。
 *  - roll()：按稀有度加权（幸运与章节提高高稀有度权重），排除满层与其他英雄的专属秘卷，不放回抽取。
 *    反应秘卷按元素来源条件加权（docs/arsenal-expansion.md 6.4）：有元素来源 ×1.4、没有 ×0.5（英雄专属不降权），
 *    未拥有且属于已投入的流派再 ×1.3。
 */

/** 各稀有度的基础权重 */
const RARITY_WEIGHT: readonly number[] = [100, 52, 26, 11, 4];

/** 反应秘卷的标签 */
const REACTION_SCROLL_TAG = '反应';
/** 元素类秘卷的标签（已拥有即视为有元素来源） */
const ELEMENT_SCROLL_TAG = '元素';
/** 反应流派标签 */
const FLOW_TAGS: readonly string[] = ['焚雷', '熔金', '封脉', '归墟'];
/** 自带元素技能的英雄 */
const ELEMENT_HEROES: readonly string[] = ['fox', 'falcon'];
/** 提供额外元素来源的武器词条 / 传说特性 */
const ELEMENT_AFFIXES: readonly string[] = ['subFire', 'subShock', 'subCorrode', 'lg_prism', 'lg_lunhui'];

interface Owned {
  def: ScrollDef;
  stacks: number;
  unload: (() => void) | null;
}

export class ScrollSystem implements IScrollSystem {
  readonly all: readonly ScrollDef[] = SCROLL_DEFS;
  private byId = new Map<string, ScrollDef>();
  /** 按获得顺序保存 */
  private ownedMap = new Map<string, Owned>();

  constructor(readonly ctx: GameContext) {
    for (const d of this.all) this.byId.set(d.id, d);
  }

  owned(): { def: ScrollDef; stacks: number }[] {
    return Array.from(this.ownedMap.values(), (o) => ({ def: o.def, stacks: o.stacks }));
  }

  stacks(id: string): number {
    return this.ownedMap.get(id)?.stacks ?? 0;
  }

  get(id: string): ScrollDef | undefined {
    return this.byId.get(id);
  }

  add(id: string): void {
    const def = this.byId.get(id);
    if (!def) {
      console.warn(`[Scrolls] 未知秘卷：${id}`);
      return;
    }
    const ctx = this.ctx;
    let entry = this.ownedMap.get(id);
    if (entry && entry.stacks >= def.maxStacks) {
      ctx.ui.toast(`「${def.name}」已达最大层数`, '#9aa0a8');
      return;
    }
    if (!entry) {
      entry = { def, stacks: 0, unload: null };
      this.ownedMap.set(id, entry);
    }
    this.unloadEntry(entry);
    entry.stacks++;
    try {
      entry.unload = def.apply(ctx, entry.stacks);
    } catch (err) {
      console.error(`[Scrolls] apply ${id} threw`, err);
      entry.unload = null;
    }

    ctx.events.emit('scroll:acquired', { id, stacks: entry.stacks });
    ctx.audio.play('scroll_get');
    const stackText = def.maxStacks > 1 ? `（${entry.stacks}/${def.maxStacks} 层）` : '';
    ctx.ui.toast(`获得${RARITY_NAMES[def.rarity]}秘卷「${def.name}」${stackText}`, RARITY_CSS[def.rarity]);
  }

  roll(count: number, opts?: { minRarity?: Rarity; exclude?: string[] }): ScrollDef[] {
    const ctx = this.ctx;
    const heroId = ctx.player.hero?.id ?? ctx.run.heroId;
    const minRarity = opts?.minRarity ?? 0;
    const exclude = opts?.exclude;
    const pool = this.all.filter((d) =>
      d.rarity >= minRarity &&
      this.stacks(d.id) < d.maxStacks &&
      (!d.heroOnly || d.heroOnly === heroId) &&
      !(exclude && exclude.includes(d.id)));

    const luck = Math.max(0, ctx.player.stats.get('luck'));
    const chapter = Math.max(0, ctx.run.chapter);
    // 反应秘卷的条件加权：每次 roll 只算一次
    const hasElem = this.hasElementSource(heroId);
    const flows = this.ownedFlows();
    const weight = (d: ScrollDef): number => {
      let w = RARITY_WEIGHT[d.rarity] ?? 1;
      w *= 1 + d.rarity * (0.1 * luck + 0.18 * chapter);
      const owned = this.ownedMap.has(d.id);
      if (owned) w *= 1.3; // 鼓励叠层
      if (d.heroOnly) w *= 1.5;
      const tags = d.tags;
      if (tags && tags.includes(REACTION_SCROLL_TAG)) {
        if (!d.heroOnly) w *= hasElem ? 1.4 : 0.5;
        if (!owned && flows.size > 0 && tags.some((t) => flows.has(t))) w *= 1.3;
      }
      return w;
    };

    const out: ScrollDef[] = [];
    const n = Math.max(0, Math.floor(count));
    while (out.length < n && pool.length > 0) {
      const pick = ctx.rng.weighted(pool, weight);
      out.push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }
    return out;
  }

  /**
   * 本局是否已有元素来源：元素英雄（赤狐 / 雷隼）、任一武器带元素或副元素 / 万象 / 轮回词条、
   * 或已拥有任一元素类秘卷。
   */
  private hasElementSource(heroId: string): boolean {
    if (ELEMENT_HEROES.includes(heroId)) return true;
    for (const w of this.ctx.weapons.slots) {
      if (!w) continue;
      if (w.element !== 'none') return true;
      for (const a of w.affixes) if (ELEMENT_AFFIXES.includes(a.id)) return true;
    }
    for (const o of this.ownedMap.values()) {
      if (o.def.tags?.includes(ELEMENT_SCROLL_TAG)) return true;
    }
    return false;
  }

  /** 已拥有秘卷的标签里出现过的反应流派（焚雷 / 熔金 / 封脉 / 归墟） */
  private ownedFlows(): Set<string> {
    const out = new Set<string>();
    for (const o of this.ownedMap.values()) {
      const tags = o.def.tags;
      if (!tags) continue;
      for (const t of tags) if (FLOW_TAGS.includes(t)) out.add(t);
    }
    return out;
  }

  resetForRun(): void {
    for (const entry of this.ownedMap.values()) this.unloadEntry(entry);
    this.ownedMap.clear();
  }

  private unloadEntry(entry: Owned): void {
    if (!entry.unload) return;
    try {
      entry.unload();
    } catch (err) {
      console.error(`[Scrolls] unload ${entry.def.id} threw`, err);
    }
    entry.unload = null;
  }
}
