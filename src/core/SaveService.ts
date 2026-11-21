/**
 * 存档服务（Unity G/Core/SaveService.cs 照译，docs/unity-parity.md D22 / R2；docs/threejs-migration.md 4.7）。
 * Unity 写 persistentDataPath/save/ 下的几个 JSON 文件；网页写 localStorage，一个「文件」一个键（键名 = 根目录/文件名）：
 *   spiritfire.save/profile.json       正式档——魂晶、天赋、英雄、生涯…（按档区分的段）
 *   spiritfire.save/profile.dev.json   调试档——调试局（?debugStage）、白盒检视页都只碰它，永远不碰正式档
 *   spiritfire.save/settings.json      两个档共用的玩家偏好——设置
 * 各带 .bak（上一次的主文件）和 .corrupt（读不了的坏文件，留作排查）。
 *
 * 一个存档文件 = 版本化信封 + 若干段（{@link SaveSection}）：
 *   { "version": 2, "game": "spiritfire", "build": "0.1.0", "savedAt": "2026-11-21T…Z",
 *     "sections": { "meta": { "v": 1, "data": {…} }, "career": { "v": 1, "data": {…} } } }
 * 读：主文件 → 解析 / 迁移失败就读 .bak → 再不行回到默认值；坏的主文件挪成 .corrupt。
 * 写：旧主文件先轮换成 .bak，再写新主文件（localStorage.setItem 本身是原子的，不需要 Unity 的 .tmp + File.Replace）。
 * 盘上有、这次没人认领的段原样写回（老版本读新段、某个系统这次没加载，都不丢数据）。
 * 文件版本比本程序新（玩家装回了旧版本）时只读不写，免得把新档写坏。
 * 文件级迁移在 {@link SaveService.migrate} 的表里；段级迁移由各段在 restore 里按版本处理。
 *
 * 老存档（M11d 之前的网页版）：信封 v1 就是 localStorage「gunflame.meta.v1」的原样（{version:1, essence, talents, unlockedHeroes, stats}）。
 * 新键里还没有文件时，正式档从 gunflame.meta.v1、调试档从 gunflame.whitebox.meta.v1 读一次，按 v1 → v2 迁成 meta / career 两段；
 * 老键不删不改（装回旧版本还能用）。设置的老键 gunflame.settings.v1 由设置段自己导入（core/GameSettings.ts，含音量换算）。
 */

/** 存储后端：浏览器 = localStorage；测试注入一个 Map 包出来的 */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/**
 * 存档的一段：各系统自己出一段，SaveService 只管信封、落盘、备份和迁移。
 * 现有的段：meta（魂晶 / 天赋 / 英雄）、career（生涯统计）、settings（玩家设置，共享文件）。
 */
export interface SaveSection {
  /** 段名（同一个文件里唯一，写进 JSON 当键） */
  readonly key: string;
  /** 这一段现在的结构版本：写盘时记下，读回来时原样交给 restore，段自己按版本升级（段级迁移钩子） */
  readonly version: number;
  /** 当前数据（能 JSON 序列化的值）；返回 undefined = 这次不写这一段，保留盘上原来的 */
  capture(): unknown;
  /**
   * 从盘上的数据恢复。data 为 null：文件里没有这一段（新档、或这一段是后加的），恢复成默认值（可以在这里做旧存储的一次性导入）。
   * version 是写盘时的版本，比现在小就在这里升级。
   */
  restore(data: unknown, version: number): void;
  /** 想知道自己属于哪个文件的段（自己调 save、区分正式档 / 调试档）：登记时、restore 之前收到所属文件 */
  bind?(file: SaveFile): void;
}

/** 一个存档文件读盘的结果 */
export type SaveLoadStatus =
  /** 还没读 */
  | 'notLoaded'
  /** 没有存档（新玩家）：全部默认值 */
  | 'fresh'
  /** 正常读到主文件（含从老键导入） */
  | 'loaded'
  /** 主文件坏了（或丢了），从 .bak 恢复；坏文件挪成 .corrupt 留作排查 */
  | 'recoveredFromBackup'
  /** 主文件和 .bak 都读不了：回到默认值，坏文件挪成 .corrupt，不会被下一次保存覆盖 */
  | 'corrupt';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)) as T);
const warn = (...args: unknown[]): void => { if (!SaveService.quiet) console.warn(...args); };

interface ReadResult {
  root: Json;
  version: number;
  migrated: boolean;
}

export class SaveFile {
  private readonly raw = new Map<string, { v: number; data: unknown }>();
  private readonly attached = new Map<string, SaveSection>();
  private readonly byType = new Map<unknown, SaveSection>();
  private state: SaveLoadStatus = 'notLoaded';
  private version = 0;
  private loaded = false;
  private wasMigrated = false;
  private isReadOnly = false;
  private warnedReadOnly = false;
  /** 坏的主文件挪不开（存储没有 removeItem）：下一次保存不把它轮换进 .bak */
  private skipRotation = false;
  private isDirty = false;
  private fromLegacy = false;

  constructor(readonly name: string, private readonly store: SaveStorage | null, private readonly root: string) {}

  toString(): string {
    return this.name;
  }

  /** 读盘结果（第一次用到时读） */
  get status(): SaveLoadStatus {
    this.ensureLoaded();
    return this.state;
  }

  /** 盘上文件的信封版本（迁移之前；新档为 0） */
  get fileVersion(): number {
    this.ensureLoaded();
    return this.version;
  }

  /** 读盘时做过文件级迁移 */
  get migrated(): boolean {
    this.ensureLoaded();
    return this.wasMigrated;
  }

  /** 文件来自更新的版本：只读，save 不写 */
  get readOnly(): boolean {
    this.ensureLoaded();
    return this.isReadOnly;
  }

  /** 这份数据是从 M11d 之前的老键导入的（还没写过新键） */
  get importedLegacy(): boolean {
    this.ensureLoaded();
    return this.fromLegacy;
  }

  /** 有改动还没写盘（saveSoon 之后、刷盘之前） */
  get dirty(): boolean {
    return this.isDirty;
  }

  get filePath(): string {
    return `${this.root}/${this.name}.json`;
  }

  get backupPath(): string {
    return `${this.filePath}.bak`;
  }

  get corruptPath(): string {
    return `${this.filePath}.corrupt`;
  }

  // ───────────── 段 ─────────────

  /**
   * 取这个文件里的某一段（没有就 new 一个、用盘上的数据 restore 后登记）。同一类型每个文件只有一个实例。
   * 例：SaveService.profile.section(MetaSection)
   */
  section<T extends SaveSection>(type: new () => T): T {
    this.ensureLoaded();
    const have = this.byType.get(type);
    if (have) return have as T;
    const made = new type();
    this.attach(made);
    return made;
  }

  /** 登记一个现成的段实例，立即用盘上的数据 restore。段名重复抛异常 */
  attach(section: SaveSection): void {
    this.ensureLoaded();
    const key = section.key;
    if (!key) throw new Error(`[Save] ${section.constructor?.name ?? '段'} 没有段名`);
    const other = this.attached.get(key);
    if (other) {
      if (other === section) return;
      throw new Error(`[Save] ${this.name} 的段「${key}」重复：${other.constructor?.name} 与 ${section.constructor?.name}`);
    }
    this.attached.set(key, section);
    this.byType.set(section.constructor, section);
    section.bind?.(this);
    this.restoreSection(section);
  }

  /** 这个文件里有没有某一段（盘上的或已登记的） */
  has(key: string): boolean {
    this.ensureLoaded();
    return this.attached.has(key) || this.raw.has(key);
  }

  private restoreSection(section: SaveSection): void {
    const r = this.raw.get(section.key);
    if (!r) {
      section.restore(null, 0);
      return;
    }
    try {
      section.restore(clone(r.data), r.v);
    } catch (e) {
      // 段坏了：留一份整文件给排查，这一段回到默认值（其他段不受影响）
      warn(`[Save] ${this.name} 的段「${section.key}」读不了，回到默认值：${(e as Error)?.message ?? e}`);
      this.tryCopy(this.filePath, this.corruptPath);
      this.raw.delete(section.key);
      section.restore(null, 0);
    }
  }

  // ───────────── 写 ─────────────

  /** 马上写盘（各段 capture → 信封 → 轮换 .bak → 写主文件）；只读或失败返回 false */
  save(): boolean {
    this.ensureLoaded();
    if (this.isReadOnly) {
      if (!this.warnedReadOnly) warn(`[Save] ${this.name} 来自更新的版本（v${this.version} > v${SaveService.CurrentVersion}），不写盘`);
      this.warnedReadOnly = true;
      return false;
    }
    if (!this.store) return false;
    for (const [key, s] of this.attached) {
      try {
        const data = s.capture();
        if (data !== undefined) this.raw.set(key, { v: s.version, data: clone(data) });
      } catch (e) {
        // 这一段这次写不出来：沿用盘上上一次的数据
        console.error(e);
      }
    }
    const sections: Json = {};
    for (const [key, r] of this.raw) sections[key] = { v: r.v, data: r.data };
    const root = {
      version: SaveService.CurrentVersion,
      game: 'spiritfire',
      build: SaveService.build,
      savedAt: new Date().toISOString(),
      sections,
    };
    try {
      const text = JSON.stringify(root, null, 2);
      const old = this.skipRotation ? null : this.store.getItem(this.filePath);
      if (old != null) this.store.setItem(this.backupPath, old);
      this.store.setItem(this.filePath, text);
      this.skipRotation = false;
      this.fromLegacy = false;
      this.isDirty = false;
      return true;
    } catch (e) {
      warn(`[Save] 写 ${this.filePath} 失败：${(e as Error)?.message ?? e}`);
      return false;
    }
  }

  /**
   * 稍后写盘（设置面板拖滑条时一秒内会改很多次）：浏览器里合并到约 0.75 秒后、切走 / 关页时一起写；
   * 没有页面（node 测试）时立即写（同 Unity 的编辑模式）
   */
  saveSoon(): void {
    this.isDirty = true;
    if (!SaveService.deferWrites) {
      this.save();
      return;
    }
    scheduleFlush();
  }

  // ───────────── 读 ─────────────

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.raw.clear();
    this.wasMigrated = this.isReadOnly = this.fromLegacy = false;
    this.version = 0;

    const mainText = this.read(this.filePath), bakText = this.read(this.backupPath);
    const mainExists = mainText != null;
    let mainError: string | null = null;
    if (mainExists) {
      const r = tryRead(mainText);
      if (typeof r !== 'string') {
        this.accept(r);
        this.state = 'loaded';
        return;
      }
      mainError = r;
    }
    if (bakText != null) {
      const r = tryRead(bakText);
      if (typeof r !== 'string') {
        this.accept(r);
        this.state = 'recoveredFromBackup';
        warn(mainExists ? `[Save] ${this.filePath} 损坏（${mainError}），已从 .bak 恢复` : `[Save] ${this.filePath} 不见了，已从 .bak 恢复`);
        if (mainExists) this.moveAside(mainText);
        return;
      }
      mainError ??= r;
    }
    if (!mainExists && bakText == null) {
      // M11d 之前的老键：原样就是信封 v1
      const legacyKey = SaveService.LegacyKeys[this.name];
      const legacyText = legacyKey ? this.read(legacyKey) : null;
      if (legacyText != null) {
        const r = tryRead(legacyText);
        if (typeof r !== 'string') {
          this.accept(r);
          this.state = 'loaded';
          this.fromLegacy = true;
          return;
        }
        warn(`[Save] 老存档 ${legacyKey} 读不了（${r}），按新档开始；老键原样留着`);
      }
      this.state = 'fresh';
      return;
    }
    this.state = 'corrupt';
    warn(`[Save] ${this.filePath} 和 .bak 都读不了（${mainError}），回到默认值；坏文件留在 .corrupt`);
    if (mainExists) this.moveAside(mainText);
  }

  private accept(r: ReadResult): void {
    this.version = r.version;
    this.wasMigrated = r.migrated;
    this.isReadOnly = r.version > SaveService.CurrentVersion;
    const sections = r.root.sections;
    if (!isObject(sections)) return;
    for (const [name, value] of Object.entries(sections)) {
      // 每段是 { "v": 版本, "data": 数据 }；不认识的形状整段跳过（不让一段的问题拖垮整个文件）
      if (!isObject(value) || !('data' in value) || value.data === undefined) continue;
      const v = Number.isSafeInteger(value.v) ? (value.v as number) : 0;
      this.raw.set(name, { v, data: value.data });
    }
  }

  /** 坏的主文件挪成 .corrupt（覆盖上一次的），之后的保存写新主文件、不会把它轮换进 .bak */
  private moveAside(text: string): void {
    try {
      this.store?.setItem(this.corruptPath, text);
      if (this.store?.removeItem) this.store.removeItem(this.filePath);
      else this.skipRotation = true;
    } catch (e) {
      this.skipRotation = true;
      warn(`[Save] 挪开坏档 ${this.filePath} 失败：${(e as Error)?.message ?? e}`);
    }
  }

  private read(key: string): string | null {
    try {
      return this.store?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private tryCopy(from: string, to: string): void {
    try {
      const text = this.read(from);
      if (text != null) this.store?.setItem(to, text);
    } catch {
      /* 只是留给排查的副本 */
    }
  }
}

/** 读一份文件文本：成功给内容，失败给原因 */
function tryRead(text: string): ReadResult | string {
  try {
    if (!text.trim()) throw new Error('空文件');
    const o: unknown = JSON.parse(text);
    if (!isObject(o)) throw new Error('顶层不是对象');
    if (!Number.isSafeInteger(o.version) || (o.version as number) < 1) throw new Error('缺少版本号');
    const version = o.version as number;
    const m = SaveService.migrate(o, version);
    return { root: m.root, version, migrated: m.migrated };
  } catch (e) {
    return (e as Error)?.message ?? String(e);
  }
}

/**
 * v1 → v2：M11d 之前网页版的 MetaSave 拆成 meta 段（魂晶、天赋、英雄）和 career 段（stats 原样，字段同名）。
 * 字段的合法性（负数、超上限、类型不对）由各段的 restore 清洗，这里只搬家。
 */
function fromWebV1(v1: Json): Json {
  const meta = {
    essence: clone(v1.essence) ?? 0,
    talents: clone(v1.talents) ?? {},
    unlockedHeroes: clone(v1.unlockedHeroes) ?? [],
  };
  const sections: Json = { meta: { v: 1, data: meta } };
  if (isObject(v1.stats)) sections.career = { v: 1, data: clone(v1.stats) };
  return { version: 2, game: 'spiritfire', sections };
}

/** 信封迁移表：从某个版本升一级（每步必须把 "version" 写成更大的数） */
const migrations: Record<number, (root: Json) => Json> = {
  1: fromWebV1,
};

// ───────────── 延时刷盘（Unity SaveFlusher）─────────────

const FLUSH_DELAY_MS = 750;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushHooks = false;

function scheduleFlush(): void {
  if (!flushHooks && typeof window !== 'undefined' && typeof document !== 'undefined') {
    flushHooks = true;
    // 切到后台 / 关页：马上写
    document.addEventListener('visibilitychange', () => { if (document.hidden) SaveService.flush(); });
    window.addEventListener('pagehide', () => SaveService.flush());
  }
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    SaveService.flush();
  }, FLUSH_DELAY_MS);
}

// ───────────── 服务 ─────────────

let storageOverride: SaveStorage | null = null;
let rootOverride: string | null = null;
let seenStorage: SaveStorage | null = null;
let main: SaveFile | null = null, dev: SaveFile | null = null, shared: SaveFile | null = null;

function ambientStorage(): SaveStorage | null {
  if (storageOverride) return storageOverride;
  try {
    return (globalThis as { localStorage?: SaveStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** 存储换了（测试换了 globalThis.localStorage）：丢掉已经读进来的文件，下次访问重新读 */
function currentStorage(): SaveStorage | null {
  const s = ambientStorage();
  if (s !== seenStorage) {
    seenStorage = s;
    main = dev = shared = null;
  }
  return s;
}

function file(which: 'main' | 'dev' | 'shared'): SaveFile {
  const store = currentStorage();
  if (which === 'main') return main ??= new SaveFile(SaveService.MainName, store, SaveService.root);
  if (which === 'dev') return dev ??= new SaveFile(SaveService.DevName, store, SaveService.root);
  return shared ??= new SaveFile(SaveService.SharedName, store, SaveService.root);
}

export const SaveService = {
  /**
   * 信封版本。v1 = M11d 之前网页版 localStorage「gunflame.meta.v1」的原样，读到时迁成 v2 的 meta / career 两段
   * （也就是说老存档直接就能读，Unity 的存档 JSON 放进来也能读）
   */
  CurrentVersion: 2,
  MainName: 'profile', DevName: 'profile.dev', SharedName: 'settings',
  DefaultRoot: 'spiritfire.save',
  /** M11d 之前的老键（文件名 → localStorage 键）：新键里没有文件时读一次 */
  LegacyKeys: { profile: 'gunflame.meta.v1', 'profile.dev': 'gunflame.whitebox.meta.v1' } as Record<string, string>,
  /** 写进信封的程序版本（package.json 的 version） */
  build: '0.1.0',
  /** 强制用调试档（测试、调试工具） */
  forceDev: false,
  /** 网页的「命令行 -devprofile」：白盒检视页（progression/Meta.ts 挂上 isWhiteboxMode） */
  devSource: null as (() => boolean) | null,
  /** 当前局（progression/RunPlan.ts 的 currentRun；Game 开局时挂上）：调试局 → 调试档 */
  currentRun: null as (() => { dev?: boolean } | null) | null,
  /** saveSoon 合并写盘（浏览器）；false = 立即写（node 测试） */
  deferWrites: typeof window !== 'undefined' && typeof document !== 'undefined',
  /** 不打警告（测试里故意喂坏档时用） */
  quiet: false,

  /** 存档根（键名前缀；测试用 {@link useRoot} 换） */
  get root(): string {
    return rootOverride ?? this.DefaultRoot;
  },

  /** 正式档 */
  get main(): SaveFile {
    return file('main');
  },
  /** 调试档（调试局、白盒检视页、测试） */
  get dev(): SaveFile {
    return file('dev');
  },
  /** 两个档共用的文件（设置） */
  get shared(): SaveFile {
    return file('shared');
  },

  /** 现在用的是调试档：forceDev、白盒检视页，或当前局是调试局 */
  get devActive(): boolean {
    return usesDev(this.currentRun?.() ?? null);
  },

  /** 当前该用的档（主菜单 / 天赋面板 / 开局读天赋都用它） */
  get profile(): SaveFile {
    return this.profileFor(this.currentRun?.() ?? null);
  },

  /** 某一局该用的档：调试局 → dev；其余看 forceDev / 白盒 */
  profileFor(run: { dev?: boolean } | null | undefined): SaveFile {
    return usesDev(run) ? this.dev : this.main;
  },

  /** 换存档根（测试；null = 恢复缺省）。丢掉已经读进来的文件（不写盘），下次访问重新读；已经拿到手的段实例属于旧文件，要重新取 */
  useRoot(root: string | null): void {
    rootOverride = root || null;
    main = dev = shared = null;
  },

  /** 换存储后端（测试；null = 恢复 localStorage）。同样丢掉已经读进来的文件 */
  useStorage(storage: SaveStorage | null): void {
    storageOverride = storage;
    main = dev = shared = null;
  },

  /** 现在的存储后端（续玩档 core/RunSuspend.ts 也写在这里） */
  get storage(): SaveStorage | null {
    return currentStorage();
  },

  /** 把所有有改动的文件写盘（关页、切走、saveSoon 的延时到了） */
  flush(): void {
    if (main?.dirty) main.save();
    if (dev?.dirty) dev.save();
    if (shared?.dirty) shared.save();
  },

  /** 文件级迁移：一级一级升到 {@link CurrentVersion}；没有对应的迁移、或迁移没升版本就抛异常（按坏档处理） */
  migrate(root: Json, version: number): { root: Json; migrated: boolean } {
    let migrated = false;
    while (version < this.CurrentVersion) {
      const step = migrations[version];
      if (!step) throw new Error(`没有从 v${version} 升级的迁移`);
      root = step(root);
      const next = Number.isSafeInteger(root.version) ? (root.version as number) : 0;
      if (next <= version) throw new Error(`v${version} 的迁移没有升版本`);
      version = next;
      migrated = true;
    }
    return { root, migrated };
  },
};

function usesDev(run: { dev?: boolean } | null | undefined): boolean {
  if (SaveService.forceDev || !!run?.dev) return true;
  try {
    return !!SaveService.devSource?.();
  } catch {
    return false;
  }
}

// ───────────── 宽容读取（Unity MetaJson：坏字段当 0 / 空）─────────────

/** 非负整数：数字且 > 0 时向下取整，其余 0 */
export function nonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(2147483647, Math.floor(v)) : 0;
}

/** 非负数：数字且 > 0 时原值，其余 0 */
export function nonNeg(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** { 名字: 正整数 }（≤ 0、不是数字、空名字的不要） */
export function intMap(v: unknown): Record<string, number> {
  const map: Record<string, number> = {};
  if (!isObject(v)) return map;
  for (const [name, value] of Object.entries(v)) {
    const n = nonNegInt(value);
    if (n > 0 && name) map[name] = n;
  }
  return map;
}

export function intList(v: unknown): number[] {
  return Array.isArray(v) ? v.map(nonNegInt) : [];
}

/** 非空字符串列表（去重，保持顺序） */
export function stringList(v: unknown): string[] {
  const list: string[] = [];
  if (!Array.isArray(v)) return list;
  for (const x of v) if (typeof x === 'string' && x.length > 0 && !list.includes(x)) list.push(x);
  return list;
}
