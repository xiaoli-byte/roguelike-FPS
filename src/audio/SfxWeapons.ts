/**
 * 武器音效配方：各类枪声、换弹、空仓、切枪，以及魔刀千刃（blade_*：挥砍、命中、千刃出窍、归刀、屏障、杀气聚合 / 爆发、刃群绞杀、鬼眼）。
 * 设计要点：瞬态（噪声爆裂）决定「脆 / 闷」，主体正弦下滑决定「重量」，尾音决定空间感。
 */
import type { SfxId } from '../core/types';
import { type Recipe, drive, filt, fm, noise, rnd, tone, tremolo, vibrato } from './Synth';

export type WeaponSfxId = Extract<SfxId,
  | 'shot_pistol' | 'shot_smg' | 'shot_rifle' | 'shot_shotgun' | 'shot_sniper' | 'shot_launcher' | 'shot_beam' | 'shot_bow' | 'shot_heavy'
  | 'reload_start' | 'reload_end' | 'dry_fire' | 'weapon_switch'
  | 'blade_swing' | 'blade_hit' | 'blade_throw' | 'blade_recall' | 'blade_morph' | 'blade_dash' | 'blade_impale'
  | 'blade_swarm' | 'blade_eye'>;

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

  // ───── 魔刀千刃（docs/demon-blade-v2.md）：挥砍要「破风」、命中要「钝重」；投掷 = 千刃出窍、召回 = 归刀、变形 = 屏障、突进 / 贯穿 = 杀气聚合 / 爆发 ─────

  /**
   * 挥砍破风「咻——」（三段 pitch 1.06 / 0.96 / 0.82）：带通噪声随刀速 600 → 3800 Hz 上扫、0.05 秒到峰，
   * 收势时中心回落；刃口高频嘶声点出最快的一瞬，粉噪声低通「呼」给出刀身的重量，极轻的哨音做刃鸣。
   */
  blade_swing(v) {
    noise(v, { dur: 0.2, gain: 0.6, attack: 0.05, filter: 'bandpass', f: 600, f2: 3800, sweep: 0.14, q: 1.2 });
    noise(v, { at: 0.08, dur: 0.16, gain: 0.22, attack: 0.02, filter: 'bandpass', f: 3200, f2: 900, sweep: 0.14, q: 1.6 });
    noise(v, { at: 0.035, dur: 0.07, gain: 0.13, attack: 0.02, filter: 'highpass', f: 5200 });
    noise(v, { color: 'pink', dur: 0.22, gain: 0.3, attack: 0.04, filter: 'lowpass', f: 900, f2: 260, sweep: 0.2 });
    tone(v, { f: 2200, f2: 1400, at: 0.03, dur: 0.14, gain: 0.025, attack: 0.03 });
  },

  /**
   * 斩击命中「噗嗵」：160 → 60 Hz 冲击 + 次低频下沉 + 棕噪声低通爆裂（钝、闷）过轻度失真，
   * 中频短促撕裂是刃口咬入；金属余振压得很轻，避免听成打在护甲上。
   */
  blade_hit(v) {
    const d = drive(v, 2, v.out, 0.85);
    tone(v, { f: 160, f2: 60, sweep: 0.07, dur: 0.11, gain: 0.95, dest: d });
    noise(v, { color: 'brown', dur: 0.09, gain: 0.85, filter: 'lowpass', f: 1800, f2: 500, sweep: 0.08, dest: d });
    tone(v, { f: 75, f2: 42, dur: 0.18, gain: 0.42, attack: 0.004 });
    noise(v, { dur: 0.035, gain: 0.3, filter: 'bandpass', f: 1300, q: 1.3, hp: 400 });
    tone(v, { type: 'triangle', f: 1850, at: 0.006, dur: 0.12, gain: 0.035 });
    tone(v, { type: 'triangle', f: 2770, at: 0.006, dur: 0.08, gain: 0.022 });
  },

  /**
   * 千刃出窍：刀身从刀尖起崩开（0.25 秒内 16 声由高到低的碎裂脆响，对应碎片依次离刀），
   * 同时一股激流呼啸（带通 900 → 3600 Hz 上扫）推出去，底下一声低沉的「嗡」给出整把刀化开的分量。
   */
  blade_throw(v) {
    for (let i = 0; i < 16; i++) {
      const k = i / 15;
      noise(v, { at: k * 0.25 + rnd(0, 0.012), dur: 0.014, gain: rnd(0.12, 0.2), filter: 'bandpass', f: 5200 - 2600 * k + rnd(-300, 300), q: 3 });
    }
    noise(v, { dur: 0.42, gain: 0.5, attack: 0.06, filter: 'bandpass', f: 900, f2: 3600, sweep: 0.3, q: 1.1 });
    noise(v, { color: 'pink', dur: 0.5, gain: 0.22, attack: 0.08, filter: 'lowpass', f: 600, f2: 1500, sweep: 0.4 });
    tone(v, { f: 95, f2: 60, dur: 0.45, gain: 0.35, attack: 0.03 });
    tone(v, { type: 'triangle', f: 1400, f2: 2300, sweep: 0.35, at: 0.05, dur: 0.4, gain: 0.03, attack: 0.05 });
  },

  /** 召回（换弹开始 / 斩击回刃 pitch 1.5）：刃片成群飞回的扫频呼啸（800 → 3000 Hz，颤音模拟片片掠过）+ 结尾金属合拢 */
  blade_recall(v) {
    for (let i = 0; i < 6; i++) tone(v, { type: 'sine', f: 1000 + i * 170, f2: 1900 + i * 230, sweep: 0.13, at: i * 0.04, dur: 0.18, gain: 0.012 });
    const flutter = tremolo(v, 26, 0.75, v.out, 0, 0.36, 'triangle');
    noise(v, { dur: 0.34, gain: 0.42, attack: 0.12, filter: 'bandpass', f: 800, f2: 3000, sweep: 0.32, q: 1.6, dest: flutter });
    noise(v, { color: 'pink', dur: 0.3, gain: 0.12, attack: 0.1, filter: 'lowpass', f: 600, f2: 1400, sweep: 0.3 });
    noise(v, { at: 0.3, dur: 0.02, gain: 0.32, filter: 'bandpass', f: 3500, q: 2 });
    tone(v, { type: 'triangle', f: 2400, at: 0.3, dur: 0.16, gain: 0.06 });
    tone(v, { type: 'triangle', f: 3600, at: 0.31, dur: 0.12, gain: 0.04 });
  },

  /** 变形：两声机括咔嗒（带通 3500）+ 刃鸣上扬（1500 → 2600 Hz，带颤音）+ 一缕出鞘的高频「锵」 */
  blade_morph(v) {
    for (let i = 0; i < 5; i++) tone(v, { type: 'triangle', f: 1650 + i * 210, f2: 900 + i * 110, sweep: 0.16, at: i * 0.024, dur: 0.17, gain: 0.018 });
    noise(v, { dur: 0.016, gain: 0.4, filter: 'bandpass', f: 3500, q: 2 });
    tone(v, { type: 'triangle', f: 900, at: 0.004, dur: 0.05, gain: 0.08 });
    noise(v, { at: 0.07, dur: 0.018, gain: 0.34, filter: 'bandpass', f: 3500, q: 2 });
    const ring = tone(v, { type: 'triangle', f: 1500, f2: 2600, sweep: 0.16, at: 0.03, dur: 0.24, gain: 0.08, attack: 0.02 });
    vibrato(v, [ring], 11, 18, 0.03, 0.05, 0.24);
    tone(v, { f: 3000, f2: 5200, sweep: 0.16, at: 0.03, dur: 0.18, gain: 0.025, attack: 0.02 });
    noise(v, { at: 0.02, dur: 0.18, gain: 0.12, attack: 0.04, filter: 'highpass', f: 4500, f2: 7500, sweep: 0.15 });
  },

  /**
   * 杀气聚合（0.5 秒后接爆发）：碎片向一点收紧的倒吸气（噪声带通 4000 → 700 Hz 下扫、渐强）+ 越转越快的刃鸣颤音
   * + 60 → 130 Hz 逐渐上升的低频压迫，到爆发前一刻最满。
   */
  blade_dash(v) {
    const d = drive(v, 1.4, v.out, 0.85);
    noise(v, { dur: 0.52, gain: 0.55, attack: 0.42, filter: 'bandpass', f: 4000, f2: 700, sweep: 0.5, q: 1.4 });
    const flutter = tremolo(v, 14, 0.7, v.out, 0, 0.55, 'triangle');
    noise(v, { dur: 0.52, gain: 0.3, attack: 0.3, filter: 'bandpass', f: 2200, f2: 3400, sweep: 0.5, q: 3, dest: flutter });
    tone(v, { f: 60, f2: 130, sweep: 0.5, dur: 0.55, gain: 0.55, attack: 0.4, dest: d });
    tone(v, { type: 'triangle', f: 880, f2: 1760, sweep: 0.5, dur: 0.52, gain: 0.04, attack: 0.3 });
  },

  /**
   * 刃群绞杀（千刃出窍期间每 0.11 秒一颗）：3–5 声随机的高频刃口擦击 + 一小段带颤的旋流风声。
   * 单颗很短，叠起来就是持续的「嚓嚓嚓」碎刃风暴。
   */
  blade_swarm(v) {
    const n = 3 + Math.floor(rnd(0, 3));
    for (let i = 0; i < n; i++) {
      noise(v, { at: rnd(0, 0.09), dur: rnd(0.008, 0.016), gain: rnd(0.25, 0.45), filter: 'bandpass', f: rnd(3000, 6500), q: 2.5 });
    }
    noise(v, { dur: 0.13, gain: 0.3, attack: 0.03, filter: 'bandpass', f: rnd(1100, 1600), f2: rnd(1800, 2400), sweep: 0.12, q: 1.4 });
    tone(v, { type: 'triangle', f: rnd(2400, 3200), at: rnd(0, 0.05), dur: 0.06, gain: 0.025 });
  },

  /**
   * 噬灵鬼眼：一口幽深的吸气（噪声低通 400 → 2200 Hz 上扫、渐强后收）+ 两个不协和的低沉人声般正弦（下滑）
   * + 睁眼那一刻的一声冷亮叮鸣。
   */
  blade_eye(v) {
    noise(v, { dur: 0.38, gain: 0.5, attack: 0.25, filter: 'lowpass', f: 400, f2: 2200, sweep: 0.34 });
    const g1 = tone(v, { f: 196, f2: 150, sweep: 0.4, dur: 0.45, gain: 0.22, attack: 0.08 });
    const g2 = tone(v, { f: 207, f2: 158, sweep: 0.4, dur: 0.45, gain: 0.18, attack: 0.08 });
    vibrato(v, [g1, g2], 6, 8, 0, 0.05, 0.45);
    tone(v, { type: 'triangle', f: 2640, at: 0.3, dur: 0.35, gain: 0.1 });
    tone(v, { type: 'sine', f: 3960, at: 0.3, dur: 0.25, gain: 0.05 });
  },

  /**
   * 千刃贯穿（一次释放一次，在伤害那一帧播放；刃群特效已提前发射，与伤害同时落下）：
   * 12 柄刃在 0.03 秒内接连刺入（2–5 kHz 随机瞬态）+ 110 → 35 Hz 重击过 drive(4)（与伤害同帧）
   * → 粉噪声低通 2400 → 300 的 1 秒长尾与刃鸣余韵。
   */
  blade_impale(v) {
    for (let i = 0; i < 12; i++) {
      noise(v, { at: rnd(0, 0.03), dur: 0.012, gain: rnd(0.18, 0.3), filter: 'bandpass', f: rnd(2000, 5000), q: 2.5 });
    }
    const d = drive(v, 4, v.out, 0.65);
    tone(v, { f: 110, f2: 35, sweep: 0.3, dur: 0.5, gain: 1.0, dest: d });
    noise(v, { color: 'brown', dur: 0.22, gain: 0.8, filter: 'lowpass', f: 2600, f2: 300, sweep: 0.2, dest: d });
    noise(v, { dur: 0.05, gain: 0.3, filter: 'highpass', f: 1800 });
    noise(v, { color: 'pink', at: 0.01, dur: 1.0, gain: 0.3, attack: 0.02, filter: 'lowpass', f: 2400, f2: 300, sweep: 0.9 });
    tone(v, { type: 'triangle', f: 1320, at: 0.01, dur: 0.7, gain: 0.04 });
    tone(v, { type: 'triangle', f: 1980, at: 0.01, dur: 0.5, gain: 0.025 });
  },
};
