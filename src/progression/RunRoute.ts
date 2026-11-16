import { RunRng } from './RunRng';
import { POOL, STAGES, StageSpec, canonical, getDemoEnd, ready as planReady } from './StagePlan';

/**
 * 每局路线（Unity RunRoute.cs 一比一；docs/level-design/run-variety.md §1）：这一局每个位置打哪张图。开局时按局种子排好，
 * 存进 RunState.route（续玩 / 重来本关都带着它，读回来是同一条路线）。
 *
 * 规则：章的顺序不变（一章接一章，首领关永远是章末），每章的开放大图按种子洗牌——
 *   带首领前补给营的开放图（StageSpec.supplyCamp，第一章 1-3 沉沙古城的寺院塔院）钉在本章最后一张开放图的位置，补给永远在首领之前；
 *   场景还没建好的图（StagePlan.ready）不进路线，后面的槽位往前补（第四章只建了 4-1、4-3 时，这一章是 4-1、4-2 两个槽位）；
 *   每章的备选图（StagePlan.POOL，场景建好了的——网页 = 场景清单里 pool: true 的）和主图一起洗，抽满本章的开放图槽位。
 * 槽位的编号 / 关序 / 难度按位置算（第 1 张开放图永远是难度 1.00 的「1-1」），场景 / 标题 / 首领 / 补给营跟着抽到的地图走（StageSpec.map）。
 * 打乱用独立的随机流 {@link RunRoute.STREAM_NAME}（只由局种子决定，掉落 / 刷怪多掷几次不影响路线）。
 *
 * 不打乱（shuffle = false）= 规划表原顺序：生涯第一局（新手按设计顺序认识敌人）、调试局、测试。
 */
export class RunRoute {
  /** 打乱路线用的随机流名 */
  static readonly STREAM_NAME = 'route';

  private readonly slots: StageSpec[];
  /** 各槽位用的地图（规划表编号，按槽位顺序）：存档里存的就是它 */
  readonly maps: readonly string[];

  private constructor(picked: readonly StageSpec[]) {
    const n = picked.length;
    this.slots = new Array<StageSpec>(n);
    const maps = new Array<string>(n);
    let chapter = Number.MIN_SAFE_INTEGER, field = 0;
    for (let i = 0; i < n; i++) {
      const m = picked[i].map;
      if (m.chapter !== chapter) {
        chapter = m.chapter;
        field = 0;
      }
      // 开放图按章内位置编号；首领关保留规划表的关序（章末 = 3，第四章还没建满时编号也不跳）
      const index = m.isBoss ? m.index : field++;
      this.slots[i] = StageSpec.slot(m, this, i, index);
      maps[i] = m.code;
    }
    this.maps = maps;
  }

  /**
   * 排一条路线：shuffle 为真时按 seed 洗每章的开放图（补给营那张钉在章内最后），否则按规划表原顺序。
   * ready = 哪些图的场景能进（缺省 StagePlan.ready）；一张都进不了时退回规划表的最后一关（和原来一样能报错能测）
   */
  static build(seed: number, shuffle = true, ready: (s: StageSpec) => boolean = planReady): RunRoute {
    const all = STAGES;
    const picked: StageSpec[] = [];
    const rng = RunRng.stream(seed, RunRoute.STREAM_NAME);
    const free: StageSpec[] = [], pinned: StageSpec[] = [], bosses: StageSpec[] = [];
    for (let i = 0; i < all.length;) {
      const chapter = all[i].chapter;
      free.length = 0;
      pinned.length = 0;
      bosses.length = 0;
      for (; i < all.length && all[i].chapter === chapter; i++) {
        const s = all[i];
        if (!ready(s)) continue;
        if (s.isBoss) bosses.push(s);
        else if (s.supplyCamp) pinned.push(s);
        else free.push(s);
      }
      // 槽位数 = 本章建好的主图数（补给营那张占一个）；洗牌时备选图也进来抽，抽满为止
      const slots = free.length;
      if (shuffle) for (const a of POOL) if (a.chapter === chapter && ready(a)) free.push(a);
      // 每章各自派生一个子序列：某一章的图多了 / 少了，不改变别的章的顺序
      if (shuffle && free.length > 1) rng.fork(chapter).shuffle(free);
      for (let k = 0; k < slots && k < free.length; k++) picked.push(free[k]);
      picked.push(...pinned);
      picked.push(...bosses);
    }
    if (picked.length === 0) picked.push(all[all.length - 1]);
    return new RunRoute(picked);
  }

  /** 规划表原顺序（跳过没建好的图） */
  static canonical(ready?: (s: StageSpec) => boolean): RunRoute {
    return RunRoute.build(0, false, ready);
  }

  /** 按存档里的地图编号恢复路线（不再检查场景在不在：开局时查过了）。有编号不在规划表里 → null（坏档） */
  static fromMaps(codes: readonly string[] | null | undefined): RunRoute | null {
    if (!codes || codes.length === 0) return null;
    const picked: StageSpec[] = [];
    for (const c of codes) {
      const s = canonical(c);
      if (!s) return null;
      picked.push(s);
    }
    return new RunRoute(picked);
  }

  /** 这条路线的地图顺序是不是 codes */
  matches(codes: readonly string[] | null | undefined): boolean {
    if (!codes || codes.length !== this.maps.length) return false;
    for (let i = 0; i < this.maps.length; i++) if (codes[i] !== this.maps[i]) return false;
    return true;
  }

  /** 全部槽位（按顺序，不受试玩开关影响） */
  get all(): readonly StageSpec[] { return this.slots; }
  get count(): number { return this.slots.length; }
  get first(): StageSpec { return this.slots[0]; }
  /** 完整版的最后一关（路线的最后一个槽位） */
  get last(): StageSpec { return this.slots[this.slots.length - 1]; }
  /** 这一局的最后一关：试玩开关指向路线里更早的槽位时是它，否则 {@link last} */
  get final(): StageSpec { return this.demoSlot ?? this.last; }
  /** 试玩开关开着（DemoEnd 是路线里最后一关之前的某个槽位） */
  get isDemo(): boolean { return this.demoSlot !== null; }

  private get demoSlot(): StageSpec | null {
    const s = this.get(getDemoEnd());
    return s && s.order < this.last.order ? s : null;
  }

  /** 按槽位编号取（「1-2」）；没有则 null */
  get(code: string | null | undefined): StageSpec | null {
    if (!code) return null;
    return this.slots.find(s => s.code === code) ?? null;
  }

  /** 按场景路径取（不区分大小写，斜杠方向不限）；不在路线里则 null */
  forScene(scenePath: string | null | undefined): StageSpec | null {
    if (!scenePath) return null;
    const p = scenePath.replace(/\\/g, '/').toLowerCase();
    return this.slots.find(s => s.scene.toLowerCase() === p) ?? null;
  }

  /** 用地图 map（规划表的关或别的路线的槽位都行）的那个槽位；不在路线里则 null */
  forMap(map: StageSpec | null | undefined): StageSpec | null {
    if (!map) return null;
    return this.slots.find(s => s.map === map.map) ?? null;
  }

  /** s 是这条路线上的槽位（别的路线 / 规划表的关按地图换成这条路线的槽位） */
  private own(s: StageSpec | null | undefined): StageSpec | null {
    return !s ? null : s.route === this ? s : this.forMap(s);
  }

  /** 下一关；这一局的最后一关（{@link final}）之后返回 null */
  next(s: StageSpec | null | undefined): StageSpec | null {
    const o = this.own(s);
    if (!o || this.isFinal(o)) return null;
    return o.order + 1 < this.slots.length ? this.slots[o.order + 1] : null;
  }

  /** 打完它 = 胜利结算（试玩版 = DemoEnd） */
  isFinal(s: StageSpec | null | undefined): boolean {
    const o = this.own(s);
    return !!o && o.order >= this.final.order;
  }

  /** 完整版的最后一关（击败全部首领） */
  isLast(s: StageSpec | null | undefined): boolean {
    const o = this.own(s);
    return !!o && o.order >= this.last.order;
  }

  /** 在这一局要走的路线上（试玩版 DemoEnd 之后的不算） */
  inPlay(s: StageSpec | null | undefined): boolean {
    const o = this.own(s);
    return !!o && o.order <= this.final.order;
  }

  /** 这一局要走的关卡（第一关 … {@link final}） */
  get playable(): readonly StageSpec[] {
    return this.slots.slice(0, this.final.order + 1);
  }

  /** 日志 / 调试用：「1-1 雅丹迷城 → 1-2 古道穿越戈壁 → 1-3 沉沙古城 → 1-4 …」 */
  describe(): string {
    return this.slots.map(s => `${s.code} ${s.title}`).join(' → ');
  }

  toString(): string {
    return this.maps.join(',');
  }
}
