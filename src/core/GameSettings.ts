import type { Settings } from './types';
import { SaveService, type SaveFile, type SaveSection } from './SaveService';

/**
 * 设置表（Unity G/Core/GameSettings.cs 照译，docs/unity-parity.md 4.7；docs/threejs-migration.md 4.7）：
 * 每个设置项 = 键、类型、默认值、范围 / 步长、分组、显示名、选项名；值统一按数存（开关 0 / 1，多选一 = 下标）。
 * 设置页（ui/screens/SettingsScreen.ts）按这张表自动生成控件；ctx.settings 仍是带类型的那个对象（{@link Settings}），
 * 是这张表的活视图：画质 / 阴影精度在对象里是 'low' | 'medium' | 'high'，存档里是下标。
 * 存在 {@link SaveService.shared}（settings.json，正式档和调试档共用）的「settings」段，数据同 Unity：{ version: 1, entries: [{ key, value }] }
 * （只写和默认值不一样的项）。文件里还没有这一段时从 M11d 之前的老键 gunflame.settings.v1 导入一次（老键不删，装回旧版本还能用）。
 *
 * 老存档的音量是旧语义（{@link migrateLegacySettings}）：M11e 之前主 / 音效 / 音乐的推子缺省 0.8 / 0.9 / 0.5、音乐另乘 0.6，
 * M11e 把推子缺省改成 1、基础电平（主 0.8 / 音效 0.9 / 音乐 0.3）进了音频清单的 mix——导入时除以旧缺省，听感不变。
 *
 * 网页没有的 Unity 设置项（{@link UNITY_ONLY_SETTINGS}）：显示模式 / 分辨率 / 垂直同步（浏览器管）、手柄瞄准辅助（没有手柄输入）。
 * 网页独有：阴影精度（太阳阴影贴图 1024 / 2048 / 4096）。
 */
export type SettingType = 'float' | 'bool' | 'choice';

export interface SettingDef {
  readonly key: keyof Settings;
  readonly label: string;
  readonly group: string;
  readonly type: SettingType;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** 多选一的选项名 */
  readonly options?: readonly string[];
  /** 多选一在 ctx.settings 里存的值（缺省 = 存下标） */
  readonly values?: readonly string[];
  /** 读数怎么显示（缺省照 Unity SettingDef.Display） */
  readonly unit?: 'x' | 'deg';
  /** Unity 的设置表里没有这一项 */
  readonly webOnly?: boolean;
}

export const GROUP_CONTROLS = '操作', GROUP_VIDEO = '画面', GROUP_AUDIO = '声音';
export const SETTINGS_SECTION_KEY = 'settings';
/** M11d 之前的设置存档键（整个 Settings 对象的 JSON） */
export const LEGACY_SETTINGS_KEY = 'gunflame.settings.v1';
/** 帧率上限选项（= Unity GraphicsQuality.FrameCaps；−1 = 不限），与设置项 frameCap 的下标一一对应 */
export const FRAME_CAPS: readonly number[] = [30, 60, 90, 120, 144, 165, 240, -1];
/** 画质 / 阴影精度三档在 ctx.settings 里的值（下标 = Unity ArtQualityLevel） */
export const QUALITY_LEVELS = ['low', 'medium', 'high'] as const;

const TIER_LABELS = ['低', '中', '高'] as const;

function f(key: keyof Settings, label: string, group: string, def: number, min: number, max: number, step: number, unit?: 'x' | 'deg'): SettingDef {
  return { key, label, group, type: 'float', defaultValue: def, min, max, step, unit };
}

function b(key: keyof Settings, label: string, group: string, def: boolean): SettingDef {
  return { key, label, group, type: 'bool', defaultValue: def ? 1 : 0, min: 0, max: 1, step: 1 };
}

function c(key: keyof Settings, label: string, group: string, def: number, options: readonly string[], values?: readonly string[], webOnly = false): SettingDef {
  return { key, label, group, type: 'choice', defaultValue: def, min: 0, max: options.length - 1, step: 1, options, values, webOnly };
}

/** 全部设置项（登记顺序 = 页签顺序与页内顺序，同 Unity GameSettings.All） */
export const GAME_SETTINGS: readonly SettingDef[] = [
  f('sensitivity', '鼠标灵敏度', GROUP_CONTROLS, 1, 0.2, 3, 0.05, 'x'),
  b('invertY', '反转 Y 轴', GROUP_CONTROLS, false),
  f('fov', '视野', GROUP_VIDEO, 80, 60, 110, 1, 'deg'),
  c('quality', '画质', GROUP_VIDEO, 2, TIER_LABELS, QUALITY_LEVELS),
  c('shadowQuality', '阴影精度', GROUP_VIDEO, 1, TIER_LABELS, QUALITY_LEVELS, true),
  c('frameCap', '帧率上限', GROUP_VIDEO, 7, ['30', '60', '90', '120', '144', '165', '240', '不限']),
  f('screenShake', '震屏强度', GROUP_VIDEO, 1, 0, 1.5, 0.05),
  f('screenEffects', '屏幕特效', GROUP_VIDEO, 1, 0, 1, 0.05),
  b('damageNumbers', '伤害数字', GROUP_VIDEO, true),
  f('masterVolume', '主音量', GROUP_AUDIO, 1, 0, 1, 0.05),
  f('musicVolume', '音乐', GROUP_AUDIO, 1, 0, 1, 0.05),
  f('sfxVolume', '音效', GROUP_AUDIO, 1, 0, 1, 0.05),
  f('ambienceVolume', '环境音', GROUP_AUDIO, 1, 0, 1, 0.05),
  f('uiVolume', '界面音', GROUP_AUDIO, 1, 0, 1, 0.05),
];

/** Unity GameSettings 里有、网页没有对应设置的键 */
export const UNITY_ONLY_SETTINGS: readonly string[] = ['aimAssist', 'displayMode', 'resolutionWidth', 'resolutionHeight', 'vsync'];

export function findSetting(key: string): SettingDef | null {
  return GAME_SETTINGS.find(d => d.key === key) ?? null;
}

/** 夹到范围、按步长取整（Unity GameSettings.Clean）；不是数的回默认值 */
export function cleanSetting(d: SettingDef, v: number): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return d.defaultValue;
  v = Math.min(d.max, Math.max(d.min, v));
  if (d.type !== 'float') return Math.round(v);
  if (d.step > 0) v = d.min + Math.round((v - d.min) / d.step) * d.step;
  return Math.round(Math.min(d.max, Math.max(d.min, v)) * 1e6) / 1e6;
}

/** ctx.settings 里的值 → 表里的数（开关 0 / 1，多选一 = 下标）；认不出来的回默认值 */
export function settingToNumber(d: SettingDef, field: unknown): number {
  if (d.type === 'bool') return typeof field === 'boolean' ? (field ? 1 : 0) : typeof field === 'number' ? (field >= 0.5 ? 1 : 0) : d.defaultValue;
  if (d.type === 'choice' && d.values) {
    const i = typeof field === 'string' ? d.values.indexOf(field) : typeof field === 'number' ? Math.round(field) : -1;
    return i >= 0 && i < d.values.length ? i : d.defaultValue;
  }
  return typeof field === 'number' && Number.isFinite(field) ? cleanSetting(d, field) : d.defaultValue;
}

/** 表里的数 → ctx.settings 里的值 */
export function settingFromNumber(d: SettingDef, v: number): number | boolean | string {
  v = cleanSetting(d, v);
  if (d.type === 'bool') return v >= 0.5;
  if (d.type === 'choice' && d.values) return d.values[v] ?? d.values[d.defaultValue];
  return v;
}

/** 显示用的值文字（Unity SettingDef.Display：「80」「开」「高」「100%」；网页多两种单位：灵敏度「1.00×」、视野「80°」） */
export function settingDisplay(d: SettingDef, v: number): string {
  if (d.type === 'bool') return v >= 0.5 ? '开' : '关';
  if (d.type === 'choice') return d.options?.[Math.round(v)] ?? String(Math.round(v));
  if (d.unit === 'x') return `${v.toFixed(2)}×`;
  if (d.unit === 'deg') return `${Math.round(v)}°`;
  return d.max <= 1.5 && d.min >= 0 && d.step < 1 ? `${Math.round(v * 100)}%` : d.step < 1 ? v.toFixed(2) : String(Math.round(v));
}

/** 全部默认值拼出来的设置对象 */
export function defaultSettings(): Settings {
  const s: Record<string, unknown> = {};
  for (const d of GAME_SETTINGS) s[d.key] = settingFromNumber(d, d.defaultValue);
  return s as unknown as Settings;
}

// ───────────── 老存档 ─────────────

/** M11e 之前三个音量推子的缺省值：那时它们就是总线电平（音乐另乘 0.6 = 清单里的 0.3） */
export const LEGACY_VOLUME_DEFAULTS = { masterVolume: 0.8, sfxVolume: 0.9, musicVolume: 0.5 } as const;

/**
 * M11d 之前的设置对象（gunflame.settings.v1）→ { 键: 表里的数 }（已夹范围、按步长取整）。
 * 音量：没有 ambienceVolume / uiVolume 两个字段 = M11e 之前存的（旧语义），除以旧缺省换成新推子（旧 0.8 / 0.9 / 0.5 → 1 / 1 / 1，
 * 旧音乐 0.25 → 0.5：实际电平 0.25 × 0.6 = 0.15 = 0.5 × 清单的 0.3）；超过旧缺省的夹在 1。M11e 之后存的（有那两个字段）原样。
 */
export function migrateLegacySettings(legacy: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof legacy !== 'object' || legacy === null || Array.isArray(legacy)) return out;
  const o = legacy as Record<string, unknown>;
  const oldVolumes = !('ambienceVolume' in o) && !('uiVolume' in o);
  for (const d of GAME_SETTINGS) {
    if (!(d.key in o)) continue;
    let field = o[d.key];
    if (oldVolumes && d.key in LEGACY_VOLUME_DEFAULTS && typeof field === 'number' && Number.isFinite(field))
      field = Math.max(0, field) / LEGACY_VOLUME_DEFAULTS[d.key as keyof typeof LEGACY_VOLUME_DEFAULTS];
    const valid = d.type === 'bool' ? typeof field === 'boolean'
      : d.type === 'choice' && d.values ? typeof field === 'string' && d.values.includes(field)
      : typeof field === 'number' && Number.isFinite(field);
    if (valid) out[d.key] = cleanSetting(d, settingToNumber(d, d.type === 'float' ? Math.min(d.max, Math.max(d.min, field as number)) : field));
  }
  return out;
}

// ───────────── 存档段 ─────────────

type ChangeListener = (def: SettingDef | null) => void;

/** 设置在存档里的一段（Unity GameSettings.SettingsSection）。{@link settings} 是 ctx.settings 用的那个对象，整个会话同一个 */
export class SettingsSection implements SaveSection {
  readonly key = SETTINGS_SECTION_KEY;
  readonly version = 1;
  readonly settings: Settings = defaultSettings();
  file: SaveFile | null = null;
  /** 这一次是从老键导入的（测试 / 排查用） */
  importedLegacy = false;
  private readonly listeners: ChangeListener[] = [];

  bind(file: SaveFile): void {
    this.file = file;
  }

  /** 表里的数（读 ctx.settings 的当前值） */
  get(d: SettingDef): number {
    return settingToNumber(d, (this.settings as unknown as Record<string, unknown>)[d.key]);
  }

  /** 改一项（夹到范围、按步长取整），变了就稍后写盘并通知（Unity GameSettings.Set） */
  set(d: SettingDef, v: number): boolean {
    if (typeof v !== 'number' || Number.isNaN(v)) return false;
    v = cleanSetting(d, v);
    if (Math.abs(this.get(d) - v) < 1e-6) return false;
    (this.settings as unknown as Record<string, unknown>)[d.key] = settingFromNumber(d, v);
    this.file?.saveSoon();
    this.raise(d);
    return true;
  }

  /** 全部恢复默认（Unity ResetAll） */
  resetAll(): void {
    for (const d of GAME_SETTINGS) this.set(d, d.defaultValue);
  }

  /** 某一项变了（set / resetAll 改的才发；界面直接写 ctx.settings 的走 game.applySettings） */
  onChanged(fn: ChangeListener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private raise(d: SettingDef | null): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(d);
      } catch (e) {
        console.error(e);
      }
    }
  }

  capture(): unknown {
    const entries: { key: string; value: number }[] = [];
    for (const d of GAME_SETTINGS) {
      const v = this.get(d);
      if (Math.abs(v - d.defaultValue) > 1e-6) entries.push({ key: d.key, value: v });
    }
    return { version: 1, entries };
  }

  restore(data: unknown): void {
    const s = this.settings as unknown as Record<string, unknown>;
    for (const d of GAME_SETTINGS) s[d.key] = settingFromNumber(d, d.defaultValue);
    this.importedLegacy = false;
    if (data === null || data === undefined) {
      // 文件里还没有这一段：从老键导入一次
      let legacy: unknown = null;
      try {
        const raw = SaveService.storage?.getItem(LEGACY_SETTINGS_KEY) ?? null;
        if (raw) legacy = JSON.parse(raw);
      } catch {
        legacy = null;
      }
      const values = migrateLegacySettings(legacy);
      for (const d of GAME_SETTINGS) if (d.key in values) s[d.key] = settingFromNumber(d, values[d.key]);
      if (legacy !== null && typeof legacy === 'object') {
        this.importedLegacy = true;
        this.file?.saveSoon();
      }
      return;
    }
    const entries = (data as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (typeof e !== 'object' || e === null) continue;
      const { key, value } = e as { key?: unknown; value?: unknown };
      const d = typeof key === 'string' ? findSetting(key) : null;
      if (d && typeof value === 'number' && !Number.isNaN(value)) s[d.key] = settingFromNumber(d, value);
    }
  }
}

/** 设置段（共享文件 settings.json 里的；换了存储 / 存档根之后是新的实例） */
export function settingsSection(): SettingsSection {
  return SaveService.shared.section(SettingsSection);
}

/**
 * 帧率上限的节拍（requestAnimationFrame 上限帧）：按上限的间隔排「下一帧该出的时刻」，没到就跳过这个 rAF。
 * 显示器刷新率不是上限的整数倍时（144 Hz 限 60）每帧隔 2 或 3 个 rAF，平均帧率就是上限。上限 ≤ 0 = 不限。
 */
export class FrameLimiter {
  private due = NaN;

  /** 这个 rAF（时间戳 tMs，毫秒）要不要跑一帧 */
  shouldRun(tMs: number, cap: number): boolean {
    if (!(cap > 0)) {
      this.due = NaN;
      return true;
    }
    const interval = 1000 / cap;
    // 第一帧、或者停了很久（切走标签页）：从现在重新排
    if (Number.isNaN(this.due) || tMs - this.due > interval * 4) {
      this.due = tMs + interval;
      return true;
    }
    // 留 1 ms 余量：rAF 的时间戳有抖动，差一点点就算到了
    if (tMs < this.due - 1) return false;
    this.due += interval;
    return true;
  }
}

/** 按设置算出的帧率上限（−1 = 不限；Unity GraphicsQuality.TargetFrameRate 的网页版：没有垂直同步这一项，浏览器本来就跟显示器同步） */
export function targetFrameRate(capIndex: number | undefined): number {
  const i = typeof capIndex === 'number' && Number.isFinite(capIndex) ? Math.round(capIndex) : FRAME_CAPS.length - 1;
  return FRAME_CAPS[Math.min(FRAME_CAPS.length - 1, Math.max(0, i))];
}
