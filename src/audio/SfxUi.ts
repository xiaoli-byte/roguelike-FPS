/**
 * 拾取 / 交互 / 界面 / 流程音效配方。旋律性提示音统一用五声音阶，与配乐的东方风格一致。
 */
import type { SfxId } from '../core/types';
import { type Recipe, filt, mtof, noise, tone, vibrato } from './Synth';
import { bell, dizi, gong, guzheng, pad, taiko } from './Instruments';

export type UiSfxId = Extract<SfxId,
  | 'pickup_coin' | 'pickup_ammo' | 'pickup_health' | 'pickup_weapon'
  | 'chest_open' | 'portal' | 'buy' | 'scroll_get'
  | 'ui_click' | 'ui_hover' | 'ui_confirm' | 'ui_deny'
  | 'wave_start' | 'stage_clear' | 'victory' | 'defeat'>;

export const UI_SFX: Record<UiSfxId, Recipe> = {
  // ───────────── 拾取 ─────────────

  /** 金币：清脆的双音「叮铃」 */
  pickup_coin(v) {
    tone(v, { type: 'triangle', f: 1318, dur: 0.07, gain: 0.2 });
    tone(v, { type: 'triangle', f: 1976, at: 0.055, dur: 0.24, gain: 0.2 });
    tone(v, { f: 3952, at: 0.055, dur: 0.12, gain: 0.04 });
  },

  /** 弹药：两下机械咔嗒 + 箱子落定 */
  pickup_ammo(v) {
    noise(v, { dur: 0.02, gain: 0.38, filter: 'bandpass', f: 2200, q: 2 });
    noise(v, { at: 0.065, dur: 0.03, gain: 0.38, filter: 'bandpass', f: 1600, q: 2 });
    tone(v, { f: 190, f2: 120, dur: 0.09, gain: 0.28 });
    tone(v, { type: 'triangle', f: 920, at: 0.065, dur: 0.06, gain: 0.07 });
  },

  /** 生命：温暖的上行琶音 */
  pickup_health(v) {
    const notes = [523, 659, 784, 1046];
    for (let i = 0; i < notes.length; i++) {
      tone(v, { f: notes[i], at: i * 0.05, dur: 0.3, gain: 0.14 });
      tone(v, { type: 'triangle', f: notes[i], at: i * 0.05, dur: 0.22, gain: 0.05 });
    }
    noise(v, { dur: 0.35, gain: 0.04, filter: 'highpass', f: 6000, attack: 0.1 });
  },

  /** 拾取武器：金属碰撞 + 上扬的铃音 */
  pickup_weapon(v) {
    noise(v, { dur: 0.06, gain: 0.46, filter: 'bandpass', f: 1800, q: 1.5 });
    tone(v, { f: 170, f2: 90, dur: 0.11, gain: 0.38 });
    bell(v, 0.08, 784, 0.45, 0.5);
    bell(v, 0.15, 1175, 0.45, 0.6);
  },

  /** 开宝箱：木盖吱呀 + 落定 + 五声音阶闪光 */
  chest_open(v) {
    const bp = filt(v, 'bandpass', 620, 4);
    const creak = tone(v, { type: 'sawtooth', f: 95, f2: 125, sweep: 0.34, dur: 0.38, gain: 0.14, attack: 0.03, dest: bp });
    vibrato(v, [creak], 11, 60, 0, 0, 0.38);
    tone(v, { f: 135, f2: 70, at: 0.34, dur: 0.16, gain: 0.38 });
    noise(v, { at: 0.34, dur: 0.05, gain: 0.2, filter: 'lowpass', f: 900 });
    const sparkle = [1046, 1318, 1568, 2093];
    for (let i = 0; i < sparkle.length; i++) bell(v, 0.4 + i * 0.065, sparkle[i], 0.42, 0.55);
    noise(v, { at: 0.4, dur: 0.9, gain: 0.06, filter: 'highpass', f: 6500, attack: 0.2 });
  },

  /** 传送门：上旋的风声 + 和声涌起 + 低频落点 */
  portal(v) {
    noise(v, { dur: 0.95, gain: 0.38, filter: 'bandpass', f: 200, f2: 3000, sweep: 0.75, q: 1.6, attack: 0.25 });
    tone(v, { f: 220, f2: 440, sweep: 0.8, dur: 0.95, gain: 0.16, attack: 0.3 });
    tone(v, { f: 330, f2: 660, sweep: 0.8, dur: 0.9, gain: 0.09, attack: 0.3, detune: 8 });
    tone(v, { f: 62, at: 0.72, dur: 0.45, gain: 0.3 });
    noise(v, { at: 0.2, dur: 0.8, gain: 0.05, filter: 'highpass', f: 7000, attack: 0.3 });
  },

  /** 购买：「咔 — 叮」 */
  buy(v) {
    noise(v, { dur: 0.03, gain: 0.32, filter: 'highpass', f: 3500 });
    tone(v, { f: 210, f2: 120, dur: 0.06, gain: 0.24 });
    tone(v, { type: 'triangle', f: 1568, at: 0.03, dur: 0.26, gain: 0.18 });
    tone(v, { type: 'triangle', f: 2093, at: 0.09, dur: 0.42, gain: 0.18 });
    tone(v, { f: 4186, at: 0.09, dur: 0.2, gain: 0.04 });
  },

  /** 获得秘卷：古筝拨弦琶音 + 铺底 */
  scroll_get(v) {
    const notes = [74, 76, 81, 86]; // D5 E5 A5 D6
    for (let i = 0; i < notes.length; i++) guzheng(v, i * 0.075, mtof(notes[i]), 0.75, 1.1);
    pad(v, 0, [mtof(50), mtof(57), mtof(62)], 0.9, 1.2, 1400);
    noise(v, { at: 0.2, dur: 1.0, gain: 0.05, filter: 'highpass', f: 6500, attack: 0.3 });
  },

  // ───────────── 界面 ─────────────

  ui_click(v) {
    tone(v, { f: 1400, f2: 1000, dur: 0.035, gain: 0.16 });
    noise(v, { dur: 0.012, gain: 0.08, filter: 'highpass', f: 5000 });
  },

  ui_hover(v) {
    tone(v, { f: 2200, dur: 0.022, gain: 0.05 });
  },

  ui_confirm(v) {
    tone(v, { type: 'triangle', f: 784, dur: 0.09, gain: 0.17 });
    tone(v, { type: 'triangle', f: 1175, at: 0.07, dur: 0.18, gain: 0.17 });
    tone(v, { f: 2350, at: 0.07, dur: 0.12, gain: 0.03 });
  },

  ui_deny(v) {
    const lp = filt(v, 'lowpass', 1200, 1);
    tone(v, { type: 'square', f: 190, dur: 0.08, gain: 0.1, dest: lp });
    tone(v, { type: 'square', f: 150, at: 0.1, dur: 0.13, gain: 0.1, dest: lp });
  },

  // ───────────── 流程 ─────────────

  /** 波次开始：两声战鼓 + 号角 */
  wave_start(v) {
    taiko(v, 0, 58, 0.9);
    taiko(v, 0.22, 64, 0.7);
    const lp = filt(v, 'lowpass', 900, 0.8);
    tone(v, { type: 'sawtooth', f: 220, at: 0.36, dur: 0.85, gain: 0.12, attack: 0.15, hold: 0.35, dest: lp });
    tone(v, { type: 'sawtooth', f: 330, at: 0.36, dur: 0.8, gain: 0.07, attack: 0.18, hold: 0.3, detune: 5, dest: lp });
  },

  /** 清关：五声音阶上行 + 铃 */
  stage_clear(v) {
    const notes = [76, 79, 81, 83, 86, 88]; // E G A B D E
    for (let i = 0; i < notes.length; i++) guzheng(v, i * 0.08, mtof(notes[i]), 0.7, 1.2);
    bell(v, 0.5, mtof(88), 0.5, 1.6);
    gong(v, 0.5, 98, 0.3, 2.2);
  },

  /** 胜利：旋律 + 和弦 + 锣 */
  victory(v) {
    const mel = [72, 74, 76, 79, 81, 84]; // C D E G A C
    const at = [0, 0.16, 0.32, 0.48, 0.64, 0.92];
    for (let i = 0; i < mel.length; i++) {
      guzheng(v, at[i], mtof(mel[i]), 0.8, 1.2);
      dizi(v, at[i], mtof(mel[i] + 12), i === mel.length - 1 ? 1.4 : 0.14, 0.55, i === mel.length - 1);
    }
    pad(v, 0.92, [mtof(48), mtof(55), mtof(60), mtof(64)], 1.6, 1.3, 1600);
    gong(v, 0.92, 87, 0.7, 3.2);
    taiko(v, 0.92, 60, 0.8);
  },

  /** 失败：缓慢下行的笛声 + 低锣 */
  defeat(v) {
    const mel = [69, 67, 64, 62]; // A G E D
    for (let i = 0; i < mel.length; i++) dizi(v, i * 0.38, mtof(mel[i]), 0.42, 0.6);
    pad(v, 0.2, [mtof(50), mtof(57), mtof(60), mtof(65)], 1.8, 1, 900);
    gong(v, 1.3, 65, 0.8, 3.6);
  },
};
