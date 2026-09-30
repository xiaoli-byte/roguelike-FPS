import type { GameContext, IScrollSystem, Rarity, ScrollDef } from '../core/types';
import { RARITY_CSS, RARITY_NAMES } from '../core/types';
import { SCROLL_DEFS } from './ScrollDefs';

/**
 * 秘卷系统：持有、叠层、抽取。
 *  - add()：叠层时先卸载旧效果，再以新层数 apply。
 *  - roll()：按稀有度加权（幸运与章节提高高稀有度权重），排除满层与其他英雄的专属秘卷，不放回抽取。
 */

/** 各稀有度的基础权重 */
const RARITY_WEIGHT: readonly number[] = [100, 52, 26, 11, 4];

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
    const weight = (d: ScrollDef): number => {
      let w = RARITY_WEIGHT[d.rarity] ?? 1;
      w *= 1 + d.rarity * (0.1 * luck + 0.18 * chapter);
      if (this.ownedMap.has(d.id)) w *= 1.3; // 鼓励叠层
      if (d.heroOnly) w *= 1.5;
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
