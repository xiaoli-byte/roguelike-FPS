/**
 * 辅助怪给同伴的加成登记（邪飞天起用，见 docs/art/enemy-roster-v2.md「邪飞天 · 天乐与赐福」）。
 *
 * - 光环：任意一只来源在给它光环就生效，多个来源不叠加（只算一次）。
 * - 赐福：同一时间只认一个来源；到期、来源死亡或被沉默（琴碎）都立即失效。
 * - 倍率按乘法叠上、按乘法撤下：同伴身上的 damageMult / attackRate / speedMult 只乘「想要 ÷ 已乘」的差值，
 *   所以和词缀等其它乘法修改互不覆盖，撤下后精确回到原值。
 * - 受到的伤害（taken）不改同伴身上的字段，由调用方挂到全局伤害修正上查询。
 *
 * 本模块不依赖引擎与 three.js（单元测试直接加载：tests/support-buffs.test.mjs）。
 */

/** 加成来源（一只辅助怪） */
export interface BuffSource {
  readonly alive: boolean;
  /** 被沉默（例如琵琶被打碎）：不再提供任何加成 */
  readonly silenced: boolean;
}

/** 能被加成的同伴：伤害倍率是所有敌人都有的，攻速 / 移速只在有这些字段的敌人上改 */
export interface Buffable {
  readonly alive: boolean;
  /** 已被回收（换关清理时同伴不一定先死） */
  readonly removed?: boolean;
  damageMult: number;
  attackRate?: number;
  speedMult?: number;
}

/** 一档加成的倍率 */
export interface BuffMods {
  damage: number;
  rate: number;
  speed: number;
  /** 受到的伤害倍率（< 1 = 减伤） */
  taken: number;
}

export interface BuffState<S> {
  /** 正在给它光环的来源 */
  readonly sources: Set<S>;
  /** 赐福：谁给的、到期时间 */
  blessedBy: S | null;
  blessedUntil: number;
  /** 已经乘到它身上的倍率（撤下时除回去） */
  applied: { damage: number; rate: number; speed: number };
  /** 当前受到的伤害倍率 */
  taken: number;
  /** 调用方挂的视觉：赐福失效时 / 整条登记清掉时各回调一次 */
  fx: { onUnbless?: () => void; onClear?: () => void };
}

export class BuffRegistry<A extends Buffable, S extends BuffSource> {
  readonly map = new Map<A, BuffState<S>>();

  constructor(readonly aura: BuffMods, readonly bless: BuffMods) {}

  get(ally: A): BuffState<S> | undefined {
    return this.map.get(ally);
  }

  /** 受到的伤害倍率（没有加成时为 1） */
  taken(ally: A): number {
    return this.map.get(ally)?.taken ?? 1;
  }

  private ensure(ally: A): BuffState<S> {
    let b = this.map.get(ally);
    if (!b) {
      b = { sources: new Set(), blessedBy: null, blessedUntil: 0, applied: { damage: 1, rate: 1, speed: 1 }, taken: 1, fx: {} };
      this.map.set(ally, b);
    }
    return b;
  }

  /** 来源开始给它光环 */
  addAura(ally: A, source: S, now: number): BuffState<S> {
    const b = this.ensure(ally);
    b.sources.add(source);
    this.refresh(ally, now);
    return b;
  }

  /** 来源不再给它光环（离开范围等） */
  removeAura(ally: A, source: S, now: number): void {
    const b = this.map.get(ally);
    if (!b) return;
    b.sources.delete(source);
    this.refresh(ally, now);
  }

  /** 赐福：until 为到期时间；已被别的来源赐福时覆盖为这一个 */
  grantBless(ally: A, source: S, until: number, now: number): BuffState<S> {
    const b = this.ensure(ally);
    b.blessedBy = source;
    b.blessedUntil = until;
    this.refresh(ally, now);
    return b;
  }

  /** 撤下某个来源给的全部加成（来源死亡 / 被沉默 / 被清理） */
  dropSource(source: S, now: number): void {
    // Map 边遍历边删除当前项是安全的（删掉的不会再被访问）
    for (const [ally, b] of this.map) {
      b.sources.delete(source);
      if (b.blessedBy === source) b.blessedBy = null;
      this.refresh(ally, now);
    }
  }

  /** 每帧刷新所有登记（处理赐福到期、来源死亡 / 沉默、同伴死亡）；不分配内存 */
  tick(now: number): void {
    for (const ally of this.map.keys()) this.refresh(ally, now);
  }

  /** 按当前的光环 / 赐福重新算倍率，把差值乘到同伴身上；什么都没有了就撤掉登记 */
  refresh(ally: A, now: number): void {
    const b = this.map.get(ally);
    if (!b) return;
    for (const s of b.sources) if (!s.alive || s.silenced) b.sources.delete(s);
    const bs = b.blessedBy;
    if (bs && (now >= b.blessedUntil || !bs.alive || bs.silenced)) {
      b.blessedBy = null;
      b.fx.onUnbless?.();
    }
    // 同伴死了或已被回收：不再改它身上的字段，直接清掉登记
    if (!ally.alive || ally.removed) {
      this.map.delete(ally);
      b.fx.onClear?.();
      return;
    }
    const aura = b.sources.size > 0, blessed = !!b.blessedBy;
    const A = this.aura, B = this.bless;
    const damage = (aura ? A.damage : 1) * (blessed ? B.damage : 1);
    const rate = (aura ? A.rate : 1) * (blessed ? B.rate : 1);
    const speed = (aura ? A.speed : 1) * (blessed ? B.speed : 1);
    const ap = b.applied;
    ally.damageMult *= damage / ap.damage;
    if (typeof ally.attackRate === 'number') ally.attackRate *= rate / ap.rate;
    if (typeof ally.speedMult === 'number') ally.speedMult *= speed / ap.speed;
    ap.damage = damage;
    ap.rate = rate;
    ap.speed = speed;
    b.taken = (aura ? A.taken : 1) * (blessed ? B.taken : 1);
    if (!aura && !blessed) {
      this.map.delete(ally);
      b.fx.onClear?.();
    }
  }
}
