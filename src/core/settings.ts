import type { Settings } from './types';
import { LEGACY_SETTINGS_KEY, defaultSettings, settingsSection } from './GameSettings';

/**
 * 玩家设置的读写入口。设置表、存档段、老存档导入（含音量换算）在 core/GameSettings.ts（M11d，照 Unity GameSettings）；
 * 落盘在 SaveService 的共享文件 spiritfire.save/settings.json。
 */

/** M11d 之前的存档键：只在第一次导入时读，不再写 */
export const SETTINGS_KEY = LEGACY_SETTINGS_KEY;

/** 默认值（= 设置表各项的 defaultValue；音量全 1：基础电平在音频清单的 mix 里，不在玩家推子上） */
export const DEFAULT_SETTINGS: Settings = defaultSettings();

/** ctx.settings 用的那个对象：存档里「settings」段的活视图（整个会话同一个对象，直接改它的字段再 saveSettings） */
export function loadSettings(): Settings {
  try {
    return settingsSection().settings;
  } catch (e) {
    console.error(e);
    return { ...DEFAULT_SETTINGS };
  }
}

/** 稍后写盘（拖滑条时一秒内会调很多次，合并成一次）。s 不是 loadSettings 给的那个对象时先把它的字段抄过去 */
export function saveSettings(s: Settings): void {
  try {
    const section = settingsSection();
    if (s !== section.settings) Object.assign(section.settings, s);
    section.file?.saveSoon();
  } catch (e) {
    console.error(e);
  }
}
