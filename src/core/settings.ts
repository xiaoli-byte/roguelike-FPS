import type { Settings } from './types';

export const SETTINGS_KEY = 'gunflame.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  fov: 80,
  // 音量缺省同 Unity GameSettings（全 1）：基础电平（主 0.8 / 音效 0.9 / 音乐 0.3）在音频清单的 mix 里，不在玩家推子上
  masterVolume: 1,
  sfxVolume: 1,
  musicVolume: 1,
  ambienceVolume: 1,
  uiVolume: 1,
  quality: 'high',
  shadowQuality: 'medium',
  damageNumbers: true,
  screenShake: 1,
  invertY: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
