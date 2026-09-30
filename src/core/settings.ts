import type { Settings } from './types';

export const SETTINGS_KEY = 'gunflame.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  fov: 80,
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.5,
  quality: 'high',
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
