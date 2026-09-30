/**
 * 武器音效配方：各类枪声、换弹、空仓、切枪。
 * 设计要点：瞬态（噪声爆裂）决定「脆 / 闷」，主体正弦下滑决定「重量」，尾音决定空间感。
 */
import type { SfxId } from '../core/types';
import { type Recipe, drive, filt, fm, noise, rnd, tone } from './Synth';

export type WeaponSfxId = Extract<SfxId,
  | 'shot_pistol' | 'shot_smg' | 'shot_rifle' | 'shot_shotgun' | 'shot_sniper' | 'shot_launcher' | 'shot_beam' | 'shot_bow' | 'shot_heavy'
  | 'reload_start' | 'reload_end' | 'dry_fire' | 'weapon_switch'>;

export const WEAPON_SFX: Record<WeaponSfxId, Recipe> = {
  /** 左轮：清脆的高频爆裂 + 金属余振 */
  shot_pistol(v) {
    const d = drive(v, 3, v.out, 0.8);
    noise(v, { dur: 0.09, gain: 0.95, filter: 'bandpass', f: 3300, q: 0.7, hp: 900, dest: d });
    tone(v, { f: 210, f2: 58, sweep: 0.08, dur: 0.17, gain: 0.85, dest: d });
    tone(v, { type: 'square', f: 2500, f2: 1300, dur: 0.02, gain: 0.14 });
    tone(v, { type: 'triangle', f: 1680, at: 0.004, dur: 0.16, gain: 0.05 });
    tone(v, { type: 'triangle', f: 2470, at: 0.004, dur: 0.1, gain: 0.03 });
    noise(v, { at: 0.02, dur: 0.38, gain: 0.16, filter: 'lowpass', f: 2400, f2: 380, attack: 0.012 });
  },

  /** 冲锋枪：短、紧、中高频 */
  shot_smg(v) {
    noise(v, { dur: 0.055, gain: 0.72, filter: 'bandpass', f: 2700, q: 0.9, hp: 700 });
    tone(v, { type: 'triangle', f: 170, f2: 72, sweep: 0.05, dur: 0.065, gain: 0.55 });
    tone(v, { type: 'square', f: 3100, dur: 0.008, gain: 0.08 });
    noise(v, { at: 0.01, dur: 0.12, gain: 0.09, filter: 'lowpass', f: 1600 });
  },

  /** 步枪：更宽的频带与更长的尾 */
  shot_rifle(v) {
    const d = drive(v, 2.5, v.out, 0.8);
    noise(v, { dur: 0.1, gain: 0.8, filter: 'lowpass', f: 5200, hp: 420, dest: d });
    tone(v, { f: 128, f2: 48, sweep: 0.1, dur: 0.13, gain: 0.72, dest: d });
    noise(v, { dur: 0.04, gain: 0.35, filter: 'bandpass', f: 1900, q: 1.2 });
    noise(v, { at: 0.02, dur: 0.3, gain: 0.15, filter: 'lowpass', f: 1300, f2: 300, attack: 0.01 });
  },

  /** 霰弹：厚重的低频冲击 + 宽带爆裂 + 隆隆尾音 */
  shot_shotgun(v) {
    const d = drive(v, 7, v.out, 0.6);
    noise(v, { color: 'brown', dur: 0.42, gain: 1.1, filter: 'lowpass', f: 5200, f2: 480, sweep: 0.3, dest: d });
    noise(v, { dur: 0.06, gain: 0.8, filter: 'highpass', f: 1400, dest: d });
    tone(v, { f: 100, f2: 36, sweep: 0.25, dur: 0.32, gain: 1.0, dest: d });
    tone(v, { type: 'triangle', f: 62, f2: 40, dur: 0.4, gain: 0.3 });
    noise(v, { color: 'brown', at: 0.05, dur: 0.7, gain: 0.3, filter: 'lowpass', f: 380, attack: 0.03 });
  },

  /** 狙击：炸裂 + 深沉轰鸣 + 远山回响（两次衰减回声） */
  shot_sniper(v) {
    const d = drive(v, 4, v.out, 0.7);
    noise(v, { dur: 0.065, gain: 1.0, filter: 'highpass', f: 2000, dest: d });
    tone(v, { f: 115, f2: 30, sweep: 0.35, dur: 0.5, gain: 0.95, dest: d });
    noise(v, { dur: 0.16, gain: 0.5, filter: 'bandpass', f: 1200, q: 0.8 });
    noise(v, { color: 'pink', at: 0.02, dur: 1.5, gain: 0.34, filter: 'lowpass', f: 1900, f2: 260, sweep: 1.4, attack: 0.02 });
    // 回声
    const echo1 = filt(v, 'lowpass', 1500, 0.7);
    noise(v, { at: 0.34, dur: 0.12, gain: 0.26, filter: 'bandpass', f: 1400, q: 0.8, dest: echo1 });
    tone(v, { f: 100, f2: 35, at: 0.34, dur: 0.35, gain: 0.22, dest: echo1 });
    const echo2 = filt(v, 'lowpass', 900, 0.7);
    noise(v, { at: 0.68, dur: 0.14, gain: 0.12, filter: 'bandpass', f: 1000, q: 0.8, dest: echo2 });
    tone(v, { f: 90, f2: 35, at: 0.68, dur: 0.35, gain: 0.1, dest: echo2 });
  },

  /** 榴弹：闷声「嗵」+ 管口气爆 */
  shot_launcher(v) {
    tone(v, { f: 140, f2: 46, sweep: 0.22, dur: 0.32, gain: 0.95 });
    noise(v, { color: 'brown', dur: 0.36, gain: 0.7, filter: 'lowpass', f: 950, f2: 200 });
    tone(v, { type: 'triangle', f: 430, f2: 150, dur: 0.08, gain: 0.3 });
    noise(v, { dur: 0.025, gain: 0.25, filter: 'highpass', f: 2500 });
    noise(v, { at: 0.03, dur: 0.3, gain: 0.12, filter: 'bandpass', f: 700, f2: 250, q: 1.4, attack: 0.03 });
  },

  /** 光束（一次性版本，持续嗡鸣由 AudioSystem 维持） */
  shot_beam(v) {
    const lp = filt(v, 'lowpass', 1700, 2);
    const o = tone(v, { type: 'sawtooth', f: 112, dur: 0.2, gain: 0.3, attack: 0.02, hold: 0.1, dest: lp });
    fm(v, o, 31, 18, 'sine', 0, 0.2);
    tone(v, { type: 'sawtooth', f: 169, dur: 0.2, gain: 0.16, attack: 0.02, hold: 0.1, detune: 9, dest: lp });
    noise(v, { dur: 0.18, gain: 0.12, filter: 'highpass', f: 3500, attack: 0.01, hold: 0.08 });
  },

  /** 弩：弓弦「嘣」+ 木质击打 + 破空声 */
  shot_bow(v) {
    const lp = filt(v, 'lowpass', 3600, 3, undefined, 260, 0.16);
    tone(v, { type: 'sawtooth', f: 152, f2: 134, sweep: 0.2, dur: 0.24, gain: 0.5, dest: lp });
    tone(v, { type: 'triangle', f: 304, f2: 268, sweep: 0.2, dur: 0.14, gain: 0.18, dest: lp });
    noise(v, { dur: 0.05, gain: 0.5, filter: 'bandpass', f: 1200, q: 2 });
    tone(v, { type: 'square', f: 3000, dur: 0.01, gain: 0.08 });
    tone(v, { f: 95, f2: 60, dur: 0.09, gain: 0.4 });
    noise(v, { at: 0.02, dur: 0.22, gain: 0.14, filter: 'bandpass', f: 2200, f2: 700, q: 1.5, attack: 0.03 });
  },

  /** 机炮：短促厚实、带机械咔嗒，适合 20 发/秒连射 */
  shot_heavy(v) {
    const d = drive(v, 5, v.out, 0.7);
    tone(v, { f: 150, f2: 58, sweep: 0.06, dur: 0.085, gain: 0.8, dest: d });
    noise(v, { dur: 0.07, gain: 0.7, filter: 'bandpass', f: 1400, q: 0.9, dest: d });
    tone(v, { type: 'square', f: 3800, dur: 0.008, gain: 0.1 });
    noise(v, { at: 0.012, dur: 0.14, gain: 0.1, filter: 'lowpass', f: 900 });
  },

  /** 换弹开始：卡榫咔嗒 + 弹匣滑出 */
  reload_start(v) {
    noise(v, { dur: 0.018, gain: 0.45, filter: 'bandpass', f: 3500, q: 2 });
    tone(v, { type: 'triangle', f: 1250, at: 0.008, dur: 0.08, gain: 0.08 });
    noise(v, { at: 0.07, dur: 0.12, gain: 0.18, filter: 'bandpass', f: 1400, f2: 700, q: 1.5, attack: 0.02 });
    noise(v, { at: 0.16, dur: 0.05, gain: 0.3, filter: 'bandpass', f: 900, q: 1.5 });
  },

  /** 换弹完成：弹匣入位 + 拉栓 */
  reload_end(v) {
    noise(v, { dur: 0.04, gain: 0.5, filter: 'bandpass', f: 1600, q: 1.5 });
    tone(v, { f: 230, f2: 110, dur: 0.07, gain: 0.36 });
    noise(v, { at: 0.1, dur: 0.03, gain: 0.45, filter: 'bandpass', f: 2800, q: 2 });
    noise(v, { at: 0.15, dur: 0.05, gain: 0.42, filter: 'bandpass', f: 1800, q: 1.8 });
    tone(v, { type: 'triangle', f: 1900, at: 0.15, dur: 0.07, gain: 0.08 });
  },

  /** 空仓：干涩的击锤声 */
  dry_fire(v) {
    noise(v, { dur: 0.014, gain: 0.4, filter: 'highpass', f: 3000 });
    tone(v, { type: 'square', f: 1800, dur: 0.01, gain: 0.08 });
    tone(v, { type: 'triangle', f: 900, at: 0.01, dur: 0.04, gain: 0.05 });
  },

  /** 切枪：布料摩擦 + 上膛咔嗒 */
  weapon_switch(v) {
    noise(v, { dur: 0.17, gain: 0.22, filter: 'bandpass', f: 700, f2: 2400, q: 1.2, attack: 0.05 });
    noise(v, { at: 0.11, dur: 0.018, gain: 0.35, filter: 'bandpass', f: 3000, q: 2 });
    tone(v, { type: 'triangle', f: rnd(1450, 1550), at: 0.11, dur: 0.06, gain: 0.07 });
  },
};
