/**
 * 图鉴数据（照译 Unity P/Progression/Codex.cs：Codex 存档段 + CodexEntry + CodexCatalog + Lore）：
 * 武器 / 秘卷 / 敌人（含首领）/ 灵宠，首次获得（敌人：首次交手）时收录；新收录的条目带「新」标记，图鉴里看过之后清掉。
 * 存档：{ "weapon": [...], "scroll": [...], "enemy": [...], "pet": [...], "fresh": ["enemy:apsara", …] }——认不出的 id 原样保留，只是不计进收录数。
 * 网页存 localStorage（CODEX_KEY；Unity 是存档文件里的 codex 段，M11d 存档迁移时并进去）。
 * 条目清单由 buildCatalog 按来源表建：武器按定义表顺序，秘卷按稀有度再按注册顺序，敌人按章（章末是首领；附属单位不单列），灵宠按名录顺序。
 * 本文件不 import 运行时模块（测试按 data: URL 直接加载）。
 */

export const CODEX_KEY = 'gunflame.codex.v1';
export const CODEX_KINDS = ['weapon', 'scroll', 'enemy', 'pet'] as const;
export type CodexKind = (typeof CODEX_KINDS)[number];
export const KIND_NAMES: Record<CodexKind, string> = { weapon: '武器', scroll: '秘卷', enemy: '敌人', pet: '灵宠' };

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export class Codex {
  private readonly unlocked: Record<CodexKind, string[]> = { weapon: [], scroll: [], enemy: [], pet: [] };
  private readonly lookup: Record<CodexKind, Set<string>> = { weapon: new Set(), scroll: new Set(), enemy: new Set(), pet: new Set() };
  private readonly fresh = new Set<string>();
  private readonly listeners: ((kind: CodexKind, id: string) => void)[] = [];
  private dirty = false;
  /** 条目清单（收录数只数清单里有的；UIManager 建好后给） */
  catalog: CodexCatalog | null = null;

  constructor(private readonly storage: Store | null = null) {
    try {
      const raw = storage?.getItem(CODEX_KEY);
      if (raw) this.restore(raw);
    } catch (err) {
      console.warn('[UI] 图鉴存档读不了，从空的开始', err);
    }
  }

  /** 新收录了一条（类别, id）：局内提示用 */
  onUnlocked(fn: (kind: CodexKind, id: string) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  isUnlocked(kind: CodexKind, id: string | null | undefined): boolean {
    return !!id && this.lookup[kind].has(id);
  }

  /** 新收录、还没在图鉴里看过 */
  isFresh(kind: CodexKind, id: string | null | undefined): boolean {
    return !!id && this.fresh.has(`${kind}:${id}`);
  }

  /** 按收录先后的 id（含认不出的） */
  unlockedIds(kind: CodexKind): readonly string[] {
    return this.unlocked[kind];
  }

  /** 某一类收录了几条（只数条目清单里有的；没有清单时数全部） */
  count(kind: CodexKind): number {
    const list = this.catalog?.of(kind);
    if (!list) return this.unlocked[kind].length;
    let n = 0;
    for (const e of list) if (this.isUnlocked(kind, e.id)) n++;
    return n;
  }

  get totalCount(): number {
    return CODEX_KINDS.reduce((n, k) => n + this.count(k), 0);
  }

  /** 某一类里还没看过的新条目数 */
  freshCount(kind: CodexKind): number {
    let n = 0;
    for (const e of this.catalog?.of(kind) ?? []) if (this.isFresh(kind, e.id)) n++;
    return n;
  }

  /** 收录一条：第一次收录返回 true（记「新」标记、稍后写盘、通知）；已经收录过、id 为空返回 false。不在清单里的 id 也收 */
  unlock(kind: CodexKind, id: string | null | undefined): boolean {
    if (!id || this.lookup[kind].has(id)) return false;
    this.lookup[kind].add(id);
    this.unlocked[kind].push(id);
    this.fresh.add(`${kind}:${id}`);
    this.dirty = true;
    for (const fn of this.listeners.slice()) {
      try {
        fn(kind, id);
      } catch (err) {
        console.error(err);
      }
    }
    return true;
  }

  /** 在图鉴里看过了：清掉「新」标记 */
  markSeen(kind: CodexKind, id: string | null | undefined): void {
    if (id && this.fresh.delete(`${kind}:${id}`)) this.dirty = true;
  }

  /** 清空（测试 / 调试） */
  clear(): void {
    for (const k of CODEX_KINDS) {
      this.unlocked[k].length = 0;
      this.lookup[k].clear();
    }
    this.fresh.clear();
    this.dirty = true;
  }

  capture(): string {
    const o: Record<string, string[]> = {};
    for (const k of CODEX_KINDS) o[k] = this.unlocked[k].slice();
    o.fresh = [...this.fresh];
    return JSON.stringify(o);
  }

  /** 宽容读取：某一项不是字符串数组就当空；重复的 id 去重 */
  restore(json: string): void {
    this.clear();
    this.dirty = false;
    let o: Record<string, unknown> | null = null;
    try {
      const v = JSON.parse(json) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>;
    } catch {
      o = null;
    }
    if (!o) return;
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []);
    for (const k of CODEX_KINDS)
      for (const id of strings(o[k]))
        if (!this.lookup[k].has(id)) {
          this.lookup[k].add(id);
          this.unlocked[k].push(id);
        }
    for (const key of strings(o.fresh)) this.fresh.add(key);
  }

  /** 有改动就写盘（界面每秒 / 关图鉴时调；Unity SaveSoon） */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      this.storage?.setItem(CODEX_KEY, this.capture());
    } catch {
      /* ignore */
    }
  }
}

// ───────────── 条目清单 ─────────────

export type RGBA4 = readonly [number, number, number, number];

/** 图鉴里的一条（名字、章节、稀有度、对应的定义） */
export interface CodexEntry<D = unknown> {
  kind: CodexKind;
  id: string;
  name: string;
  /** 名字下面的一行（武器类别、秘卷稀有度、敌人定位、灵宠称号） */
  subtitle: string;
  /** 主题色（稀有度色、元素色、首领朱砂） */
  color: RGBA4;
  /** 出没的章（敌人；0 = 不分章） */
  chapter: number;
  boss: boolean;
  def: D;
}

export interface WeaponSrc { id: string; name: string; category: string; element: string }
export interface ScrollSrc { id: string; name: string; rarity: number }
export interface EnemySrc { id: string; name: string; isBoss?: boolean; rank?: string; flying?: boolean; element?: string; placement?: string }
export interface PetSrc { id: string; name: string; title: string; rarityName: string; rarityColor: number }

export interface CatalogSources {
  weapons: readonly WeaponSrc[];
  scrolls: readonly ScrollSrc[];
  enemies: readonly EnemySrc[];
  pets: readonly PetSrc[];
  rarityName(r: number): string;
  rarityColor(r: number): RGBA4;
  elementColor(e: string): RGBA4;
}

const PAPER: RGBA4 = [0.937, 0.894, 0.8, 1], PAPER2: RGBA4 = [0.784, 0.725, 0.6, 1], CINNABAR_HI: RGBA4 = [1, 0.353, 0.235, 1];
const hex = (n: number): RGBA4 => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];

/** 不单列的附属单位（蜃景分身、炭童余烬）；复燃的炭童算炭童；测试场用的首领不列 */
export const HIDDEN_ENEMIES = new Set(['mirage_toad_decoy', 'tantong_ember', 'boss_proxy', 'boss_hazard_lab']);
export const ENEMY_ALIAS: Record<string, string> = { tantong_reborn: 'tantong' };

/** 名册 id → 图鉴 id（别名换成本体，附属单位返回 null） */
export function codexEnemyId(rosterId: string | null | undefined): string | null {
  if (!rosterId || HIDDEN_ENEMIES.has(rosterId)) return null;
  return ENEMY_ALIAS[rosterId] ?? rosterId;
}

const ROLES: Record<string, string> = { assault: '突击', flank: '侧袭', ranged: '远程', precision: '狙击', artillery: '炮击', support: '辅助' };

/** 敌人的定位（站位角色 + 飞行）；没有站位数据的写「敌人」 */
export function roleName(e: EnemySrc): string {
  const role = e.placement ? ROLES[e.placement] ?? '辅助' : '敌人';
  return e.flying ? `${role} · 飞行` : role;
}

export class CodexCatalog {
  private readonly lists: Record<CodexKind, CodexEntry[]>;

  constructor(src: CatalogSources) {
    const elemental = (e: string | undefined, fallback: RGBA4) => (e && e !== 'none' ? src.elementColor(e) : fallback);
    const weapon: CodexEntry[] = src.weapons.map((w) => ({ kind: 'weapon', id: w.id, name: w.name, subtitle: w.category, color: elemental(w.element, PAPER), chapter: 0, boss: false, def: w }));
    const scroll: CodexEntry[] = src.scrolls
      .map((s, i) => ({ s, i }))
      .sort((a, b) => a.s.rarity - b.s.rarity || a.i - b.i)
      .map(({ s }) => ({ kind: 'scroll', id: s.id, name: s.name, subtitle: `${src.rarityName(s.rarity)}秘卷`, color: src.rarityColor(s.rarity), chapter: 0, boss: false, def: s }));
    const seqOf = new Map<CodexEntry, number>();
    const enemy: CodexEntry[] = [];
    src.enemies.forEach((e, i) => {
      if (codexEnemyId(e.id) !== e.id) return;
      const boss = !!e.isBoss || e.rank === 'boss';
      const entry: CodexEntry = boss
        ? { kind: 'enemy', id: e.id, name: e.name, subtitle: '首领', chapter: loreChapter(e.id), boss: true, color: CINNABAR_HI, def: e }
        : { kind: 'enemy', id: e.id, name: e.name, subtitle: roleName(e), chapter: loreChapter(e.id), boss: false, color: elemental(e.element, PAPER2), def: e };
      // 首领排在本章敌人之后
      seqOf.set(entry, (boss ? 100000 : 0) + i);
      enemy.push(entry);
    });
    enemy.sort((a, b) => (a.chapter > 0 ? a.chapter : 99) - (b.chapter > 0 ? b.chapter : 99) || seqOf.get(a)! - seqOf.get(b)!);
    const pet: CodexEntry[] = src.pets.map((p) => ({ kind: 'pet', id: p.id, name: p.name, subtitle: `${p.rarityName} · ${p.title}`, color: hex(p.rarityColor), chapter: 0, boss: false, def: p }));
    this.lists = { weapon, scroll, enemy, pet };
  }

  of(kind: CodexKind): readonly CodexEntry[] {
    return this.lists[kind];
  }

  find(kind: CodexKind, id: string | null | undefined): CodexEntry | null {
    return (id && this.lists[kind].find((e) => e.id === id)) || null;
  }

  get total(): number {
    return CODEX_KINDS.reduce((n, k) => n + this.lists[k].length, 0);
  }
}

/** 敌人 / 首领的描述（没写的按定义拼一句） */
export function describeEnemy(e: CodexEntry): string {
  const lore = LORE[e.id]?.[1];
  if (lore) return lore;
  return e.boss ? '镇守一方的首领。' : `${roleName(e.def as EnemySrc)}型敌人。`;
}

export function lockedHint(e: CodexEntry): string {
  switch (e.kind) {
    case 'weapon': return '尚未收录。在宝箱、补给营或首领奖励里拿到这把武器后收录。';
    case 'scroll': return '尚未收录。获得一次这卷秘卷后收录。';
    case 'enemy': return e.boss ? '尚未收录。与这位首领交手后收录。' : '尚未收录。第一次与它交手后收录。';
    default: return '尚未收录。与这只灵宠结契后收录。';
  }
}

export function loreChapter(id: string): number {
  return LORE[id]?.[0] ?? 0;
}

/** 敌人与首领的图鉴描述（打法要点）：id → [章, 描述]（照抄 Unity CodexCatalog.Lore） */
export const LORE: Record<string, readonly [number, string]> = {
  // ── 第一章 · 赤沙古道 ──
  jerboa_blade: [1, '戈壁里成群出没的跳鼠兵，三五只一拥而上，扑斩接交叉斩。弱点：两耳之间的铜铃。'],
  fire_rat: [1, '浑身火毛的鼠妖，蜷成火球滚进人群，死时自爆。整个身体都是弱点，趁它滚过来之前打掉。'],
  scorpion_archer: [1, '披甲的蝎人弩手，躲在远处压制射击。弱点：尾巴弧顶的毒囊。'],
  tomb_beast: [1, '活过来的唐三彩镇墓兽，重甲冲锋，正面极硬。弱点：背上的龟裂，绕到身后打。'],
  apsara: [1, '怀抱琵琶的堕落飞天，悬在半空为同伴赐福。弱点：琵琶的琴轸——先打掉她。'],
  mirage_toad: [1, '躲在岩丘后吊射火球，还会吐出蜃景分身迷惑人。弱点：下颌的喉囊。'],
  sand_wraith: [1, '被旱魃的日火烧成沙的跳鼠兵，潜在沙下逼近，破沙旋斩之后会硬直片刻。'],
  boss_hanba: [1, '第一章首领。悬浮的干瘦女神，背负白金日轮，所到之处赤地千里。烈日、焦土、赤地三个阶段：日轮扫射、召来沙魇、吸干泉水。躲进阴影里能少受日晒。'],
  // ── 第二章 · 北冥昆仑 ──
  frost_crab: [2, '巨钳竖在脸前当墙、横着走的坦克，夹击甩人、横扫冲击环；血量低时巨钳碎裂。弱点：背后的鳃缝。'],
  ice_puffer: [2, '飘近之后俯冲、鼓气炸开，留下减速冻雾。整个身体都是弱点，鼓气时还会变大。'],
  jiaoren: [2, '先远投骨矛、再成群突刺的鲛人。弱点：额头的鲛珠，死后会掉下一点回复。'],
  xingxing: [2, '四足狂奔、跳砸冰环、攀上高台，够不着就抛冰块。弱点：额头冰晶。'],
  xuangui: [2, '正面冰壳格挡，缩壳旋转撞墙反弹，过热时翻倒露出散热孔。平时弱点在身后的蛇头。'],
  fox_witch: [2, '躲在同伴身后立冰壁、结霜甲，用照妖镜放冻结光束。打碎她的铜镜，她就只能放追踪狐火。'],
  fuzhu: [2, '精准远程。远远踱步，蓄力射出直线冰光，光下的地面结冰打滑；被逼近就后跳拉开。弱点：胸口冰晶。'],
  haozhi: [2, '刨地冲锋，冲到近前急停竖刺，炸出一圈冰刺后自毁，留下残刺阵。弱点：背上的刺冠。'],
  ice_whale: [2, '炮兵。喷气孔胀亮后喷出冰柱，落点长出挡路的冰棱阵；贴近会昂身拍击。弱点：头顶喷气孔。'],
  lantern_jelly: [2, '漂浮的辅助，光触须连着同伴为它们回血；靠近会放一圈冻电。打它的灯芯能把连线全部打断。'],
  qingniao: [2, '在高处盘旋，冰羽横排扇射，掉血时俯冲换位，飞累了落到柱顶歇脚。弱点：胸口霜晶。'],
  boss_kunpeng: [2, '第二章首领。《庄子》北冥之鱼，化而为鸟：先是冰窟里的鲲，吞吸、猛砸掀冰浪、从脚下破冰潜袭；半血之后化而为鹏，转到空中作战。'],
  // ── 第三章 · 祝融炉心 ──
  huodou: [3, '食火吐火的黑犬，三四只包抄扑咬；吃掉地上的火会变大，吃过火才吐火。弱点：两侧肋间的熔火腹。'],
  tantong: [3, '一米来高的炭块小孩，成群扑抓、抛炭；死后碎成余烬，不补刀会复燃。弱点：头顶的烛芯火苗。'],
  fire_crow: [3, '成群盘旋，轮流点火俯冲撞地爆炸；在空中打爆会炸到同伴。一枪即死。'],
  firecracker: [3, '远远一窝蜂齐射，近身撒地老鼠；引信烧着时打它的火药仓能让它哑炸。弱点：腹部铜火药仓。'],
  founder: [3, '躲在同伴身后往它们身上浇铜甲，近身泼铜；背上的坩埚被打裂就不再浇。弱点：坩埚里的熔铜。'],
  iron_ox: [3, '照镇河铁牛铸成的炉牛，铁甲极硬；胸口炉门只在鼓风吸气、呛火跪倒时敞开——那是打进炉膛的时机。'],
  mamian: [3, '马头狱卒，甩出勾魂索把人拖到身前；射断链子、跳起或冲刺都能挣脱。锁芯被打坏后改用双拳肉搏。'],
  nuo: [3, '跳火傩给附近同伴加赤 / 黑 / 金三张脸之一的光环，隔一阵变一次脸。弱点：傩面，只能从正面打。'],
  bifang: [3, '独脚火鹤，单足立在柱顶高台，「毕—方」两声：一声瞄准、一声射出火矛。打它的腿能让它摔下来。弱点：喙里的炭火。'],
  tuo: [3, '熔岩河里的巨鳄，背负玄武岩甲，潜熔游动、岸边扑咬、甩尾扫人。弱点：脊背的熔岩接缝。'],
  boss_warlord: [3, '铸范大坊的领主，熔火深渊的统帅。一身玄铁甲、角盔、一柄焰刃：烈焰冲锋、火焰横扫、陨石雨、跃击、焰刃连斩。'],
  boss_qilin: [3, '第三章的首领，祝融炉心的守炉神兽。玄鳞形态踏火奔驰、张鳞、饮熔回甲——打断锁链让巨鼎砸下能崩碎它的鳞甲；血量过半后化为焚身。'],
};

/** 分页：总页数（至少 1）、某页的条目、翻页绕回 */
export const CODEX_COLUMNS = 4, CODEX_ROWS = 3, CODEX_PER_PAGE = CODEX_COLUMNS * CODEX_ROWS;

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / CODEX_PER_PAGE));
}

export function wrapPage(p: number, pages: number): number {
  return ((p % pages) + pages) % pages;
}
