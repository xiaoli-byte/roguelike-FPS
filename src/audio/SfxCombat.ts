/**
 * 战斗音效配方：命中 / 暴击 / 击杀、爆炸、玩家动作与受伤、敌人与 Boss、技能、元素状态。
 */
import type { SfxId } from '../core/types';
import { type Recipe, drive, filt, fm, noise, rnd, tone, tremolo, vibrato } from './Synth';

export type CombatSfxId = Extract<SfxId,
  | 'hit' | 'hit_crit' | 'hit_shield' | 'hit_armor' | 'kill' | 'explosion'
  | 'player_hurt' | 'shield_break' | 'shield_recharge' | 'low_hp'
  | 'jump' | 'land' | 'dash' | 'footstep'
  | 'enemy_shot' | 'enemy_melee' | 'enemy_alert' | 'enemy_death' | 'enemy_spawn' | 'enemy_charge'
  | 'boss_roar' | 'boss_slam' | 'telegraph'
  | 'skill_fire' | 'skill_shock' | 'skill_earth' | 'skill_buff' | 'skill_throw'
  | 'burn_tick' | 'shock_zap' | 'corrode_tick'>;

export const COMBAT_SFX: Record<CombatSfxId, Recipe> = {
  // ───────────── 命中反馈 ─────────────

  /** 命中：短促的「嗒」 */
  hit(v) {
    tone(v, { f: 1150, f2: 720, dur: 0.035, gain: 0.3 });
    noise(v, { dur: 0.02, gain: 0.16, filter: 'bandpass', f: 3500, q: 1.5 });
    tone(v, { f: 190, f2: 120, dur: 0.05, gain: 0.22 });
  },

  /** 爆头：清亮的「叮」 */
  hit_crit(v) {
    tone(v, { f: 2093, dur: 0.42, gain: 0.3 });
    tone(v, { f: 3140, dur: 0.26, gain: 0.12 });
    tone(v, { f: 4186, dur: 0.16, gain: 0.06 });
    noise(v, { dur: 0.012, gain: 0.25, filter: 'highpass', f: 5000 });
    tone(v, { f: 260, f2: 120, dur: 0.07, gain: 0.28 });
  },

  /** 打在护盾上：玻璃感的电流嘶声 */
  hit_shield(v) {
    const o = tone(v, { f: 1750, f2: 2500, dur: 0.075, gain: 0.17 });
    fm(v, o, 90, 160, 'sine', 0, 0.08);
    tone(v, { type: 'square', f: 880, dur: 0.05, gain: 0.05 });
    noise(v, { dur: 0.055, gain: 0.22, filter: 'highpass', f: 4500 });
  },

  /** 打在护甲上：金属「当」 */
  hit_armor(v) {
    const f = rnd(560, 660);
    tone(v, { type: 'triangle', f, dur: 0.14, gain: 0.24 });
    tone(v, { type: 'triangle', f: f * 1.47, dur: 0.11, gain: 0.14 });
    tone(v, { f: f * 2.09, dur: 0.08, gain: 0.08 });
    noise(v, { dur: 0.03, gain: 0.28, filter: 'bandpass', f: 3000, q: 2 });
  },

  /** 击杀确认：上行双音 + 低频一顿 */
  kill(v) {
    tone(v, { type: 'triangle', f: 880, dur: 0.09, gain: 0.26 });
    tone(v, { type: 'triangle', f: 1318, at: 0.06, dur: 0.2, gain: 0.26 });
    tone(v, { f: 2637, at: 0.06, dur: 0.22, gain: 0.06 });
    tone(v, { f: 130, f2: 50, dur: 0.13, gain: 0.42 });
    noise(v, { dur: 0.04, gain: 0.14, filter: 'bandpass', f: 1800, q: 1 });
  },

  /** 爆炸：冲击 + 轰鸣 + 碎屑噼啪 */
  explosion(v) {
    const d = drive(v, 3.5, v.out, 0.75);
    noise(v, { dur: 0.08, gain: 0.7, filter: 'highpass', f: 1200, dest: d });
    tone(v, { f: 78, f2: 27, sweep: 0.5, dur: 0.85, gain: 1.0, dest: d });
    noise(v, { color: 'brown', dur: 1.35, gain: 1.0, filter: 'lowpass', f: 2400, f2: 170, sweep: 1.1, attack: 0.004, dest: d });
    const crackle = tremolo(v, 23, 0.9, v.out, 0.06, 0.7);
    noise(v, { at: 0.06, dur: 0.65, gain: 0.14, filter: 'bandpass', f: 3200, q: 2.5, dest: crackle });
    noise(v, { color: 'brown', at: 0.1, dur: 1.6, gain: 0.3, filter: 'lowpass', f: 320, attack: 0.1 });
  },

  // ───────────── 玩家 ─────────────

  /** 受伤：闷击 + 短促的喘息噪声 */
  player_hurt(v) {
    const d = drive(v, 2, v.out, 0.8);
    tone(v, { f: 170, f2: 70, dur: 0.16, gain: 0.6, dest: d });
    noise(v, { dur: 0.13, gain: 0.32, filter: 'bandpass', f: 700, q: 1.4, attack: 0.005 });
    noise(v, { dur: 0.04, gain: 0.18, filter: 'bandpass', f: 2200, q: 1 });
  },

  /** 护盾破碎：玻璃碎裂（随机高频碎响）+ 下坠嗡声 */
  shield_break(v) {
    for (let i = 0; i < 11; i++) {
      tone(v, { f: rnd(2600, 6400), at: rnd(0, 0.22), dur: rnd(0.05, 0.2), gain: rnd(0.06, 0.12) });
    }
    noise(v, { dur: 0.38, gain: 0.42, filter: 'highpass', f: 3400, attack: 0.002 });
    noise(v, { dur: 0.12, gain: 0.3, filter: 'bandpass', f: 1800, q: 0.8 });
    tone(v, { f: 950, f2: 170, dur: 0.34, gain: 0.22 });
    tone(v, { f: 115, f2: 48, dur: 0.24, gain: 0.4 });
  },

  /** 护盾充能：上扬的闪烁音 */
  shield_recharge(v) {
    const o = tone(v, { f: 420, f2: 1300, sweep: 0.45, dur: 0.52, gain: 0.16, attack: 0.05 });
    vibrato(v, [o], 17, 30, 0, 0.05, 0.5);
    tone(v, { type: 'triangle', f: 840, f2: 2600, sweep: 0.45, dur: 0.48, gain: 0.05, attack: 0.08 });
    noise(v, { dur: 0.45, gain: 0.05, filter: 'highpass', f: 6000, attack: 0.22 });
  },

  /** 低血量：心跳 */
  low_hp(v) {
    tone(v, { f: 64, f2: 50, dur: 0.14, gain: 0.75 });
    noise(v, { dur: 0.06, gain: 0.12, filter: 'lowpass', f: 300 });
    tone(v, { f: 54, f2: 44, at: 0.2, dur: 0.16, gain: 0.58 });
  },

  jump(v) {
    noise(v, { dur: 0.13, gain: 0.16, filter: 'bandpass', f: 480, f2: 1100, q: 1.2, attack: 0.02 });
    tone(v, { f: 180, f2: 260, dur: 0.07, gain: 0.08 });
  },

  land(v) {
    tone(v, { f: 115, f2: 48, dur: 0.12, gain: 0.5 });
    noise(v, { dur: 0.1, gain: 0.32, filter: 'lowpass', f: 620 });
    noise(v, { dur: 0.04, gain: 0.08, filter: 'bandpass', f: 2600, q: 1 });
  },

  /** 冲刺：破空呼啸 */
  dash(v) {
    noise(v, { dur: 0.28, gain: 0.42, filter: 'bandpass', f: 380, f2: 2500, sweep: 0.12, q: 1.2, attack: 0.02 });
    tone(v, { f: 300, f2: 900, dur: 0.12, gain: 0.06 });
    tone(v, { f: 95, f2: 60, dur: 0.14, gain: 0.2 });
  },

  footstep(v) {
    noise(v, { dur: 0.06, gain: 0.26, filter: 'lowpass', f: rnd(700, 1100) });
    tone(v, { f: rnd(80, 100), dur: 0.05, gain: 0.12 });
    noise(v, { dur: 0.02, gain: 0.05, filter: 'highpass', f: 3000 });
  },

  // ───────────── 敌人 ─────────────

  /** 敌方射击：柔和的「咻」，与玩家枪声区分 */
  enemy_shot(v) {
    tone(v, { type: 'triangle', f: 840, f2: 300, dur: 0.15, gain: 0.28 });
    noise(v, { dur: 0.05, gain: 0.22, filter: 'bandpass', f: 1500, q: 1 });
    tone(v, { f: 1650, f2: 500, dur: 0.08, gain: 0.07 });
  },

  /** 近战挥砍：刀风 + 击中 */
  enemy_melee(v) {
    noise(v, { dur: 0.17, gain: 0.4, filter: 'bandpass', f: 1600, f2: 380, sweep: 0.13, q: 1.5, attack: 0.03 });
    tone(v, { f: 150, f2: 70, at: 0.09, dur: 0.11, gain: 0.4 });
    noise(v, { at: 0.09, dur: 0.04, gain: 0.2, filter: 'bandpass', f: 2400, q: 1.2 });
  },

  /** 发现玩家：短促低吼 */
  enemy_alert(v) {
    const bp = filt(v, 'bandpass', 700, 3);
    const d = drive(v, 3, bp, 0.8);
    const o1 = tone(v, { type: 'sawtooth', f: 108, f2: 96, dur: 0.32, gain: 0.4, attack: 0.03, dest: d });
    const o2 = tone(v, { type: 'sawtooth', f: 162, f2: 140, dur: 0.3, gain: 0.18, attack: 0.03, dest: d });
    vibrato(v, [o1, o2], 9, 45, 0, 0, 0.32);
  },

  /** 敌人死亡：下坠哀鸣 + 化散「噗」 */
  enemy_death(v) {
    const lp = filt(v, 'lowpass', 1500, 1, undefined, 400, 0.4);
    tone(v, { type: 'sawtooth', f: 250, f2: 58, sweep: 0.4, dur: 0.45, gain: 0.24, dest: lp });
    noise(v, { dur: 0.36, gain: 0.34, filter: 'lowpass', f: 1300, f2: 300 });
    tone(v, { f: 92, f2: 40, dur: 0.22, gain: 0.34 });
  },

  /** 敌人出生：神秘的上扬 */
  enemy_spawn(v) {
    const o = tone(v, { f: 220, f2: 660, sweep: 0.6, dur: 0.72, gain: 0.16, attack: 0.25 });
    vibrato(v, [o], 6, 20, 0, 0.1, 0.72);
    tone(v, { type: 'triangle', f: 330, f2: 990, sweep: 0.6, dur: 0.68, gain: 0.06, attack: 0.3 });
    noise(v, { dur: 0.62, gain: 0.07, filter: 'highpass', f: 5000, attack: 0.3 });
    noise(v, { dur: 0.62, gain: 0.12, filter: 'bandpass', f: 400, f2: 1600, q: 1.4, attack: 0.3 });
  },

  /** 蓄力冲锋：逐渐升高的尖啸 + 低频隆隆 */
  enemy_charge(v) {
    const lp = filt(v, 'lowpass', 2300, 1.5);
    tone(v, { type: 'sawtooth', f: 140, f2: 620, sweep: 0.75, dur: 0.82, gain: 0.2, attack: 0.05, dest: lp });
    noise(v, { color: 'brown', dur: 0.8, gain: 0.36, filter: 'lowpass', f: 420, attack: 0.2 });
    tone(v, { f: 70, dur: 0.8, gain: 0.24, attack: 0.3 });
  },

  /** Boss 咆哮：多层锯齿 + 共振峰 + 失真 */
  boss_roar(v) {
    const bp = filt(v, 'bandpass', 540, 1.2, undefined, 380, 1.6);
    const d = drive(v, 5, bp, 0.9);
    const o1 = tone(v, { type: 'sawtooth', f: 80, f2: 66, sweep: 1.7, dur: 1.75, gain: 0.42, attack: 0.12, hold: 0.9, dest: d });
    const o2 = tone(v, { type: 'sawtooth', f: 120, f2: 98, sweep: 1.7, dur: 1.7, gain: 0.26, attack: 0.14, hold: 0.85, dest: d });
    const o3 = tone(v, { type: 'sawtooth', f: 56, f2: 46, sweep: 1.7, dur: 1.7, gain: 0.3, attack: 0.1, hold: 0.9, dest: d });
    vibrato(v, [o1, o2, o3], 7, 45, 0, 0.1, 1.75);
    noise(v, { dur: 1.6, gain: 0.3, filter: 'bandpass', f: 850, f2: 380, q: 1, attack: 0.15, hold: 0.6 });
    tone(v, { f: 40, dur: 1.6, gain: 0.4, attack: 0.2, hold: 0.8 });
  },

  /** Boss 砸地：巨大的低频冲击 */
  boss_slam(v) {
    const d = drive(v, 2.5, v.out, 0.85);
    tone(v, { f: 58, f2: 24, sweep: 0.7, dur: 1.15, gain: 1.0, dest: d });
    noise(v, { color: 'brown', dur: 1.5, gain: 0.95, filter: 'lowpass', f: 950, f2: 120, sweep: 1.2, dest: d });
    noise(v, { dur: 0.07, gain: 0.55, filter: 'bandpass', f: 1800, q: 1 });
    const rubble = tremolo(v, 17, 0.8, v.out, 0.1, 0.7);
    noise(v, { at: 0.1, dur: 0.7, gain: 0.14, filter: 'bandpass', f: 2500, q: 2, dest: rubble });
  },

  /** 预警：带颤动的上扬「锵」 */
  telegraph(v) {
    const o = tone(v, { f: 520, f2: 1040, sweep: 0.28, dur: 0.36, gain: 0.2, attack: 0.02 });
    vibrato(v, [o], 16, 35, 0, 0, 0.36);
    tone(v, { type: 'triangle', f: 1040, f2: 2080, sweep: 0.28, dur: 0.3, gain: 0.05, attack: 0.03 });
    noise(v, { dur: 0.3, gain: 0.05, filter: 'highpass', f: 6000, attack: 0.1 });
  },

  // ───────────── 技能 ─────────────

  /** 火焰技能：呼啸的火焰 + 噼啪 */
  skill_fire(v) {
    noise(v, { dur: 0.62, gain: 0.52, filter: 'bandpass', f: 420, f2: 1500, sweep: 0.35, q: 0.8, attack: 0.04 });
    noise(v, { color: 'brown', dur: 0.72, gain: 0.4, filter: 'lowpass', f: 720, attack: 0.05 });
    const crackle = tremolo(v, 29, 0.9, v.out, 0, 0.55);
    noise(v, { dur: 0.52, gain: 0.12, filter: 'highpass', f: 3000, dest: crackle });
    tone(v, { f: 92, f2: 58, dur: 0.42, gain: 0.3 });
  },

  /** 雷电技能：电弧嗡鸣 */
  skill_shock(v) {
    const hp = filt(v, 'highpass', 280, 0.7);
    const o = tone(v, { type: 'sawtooth', f: 92, dur: 0.46, gain: 0.3, attack: 0.005, hold: 0.15, dest: hp });
    fm(v, o, 38, 70, 'square', 0, 0.46);
    const am = tremolo(v, 47, 0.95, v.out, 0, 0.36);
    noise(v, { dur: 0.36, gain: 0.34, filter: 'highpass', f: 2600, dest: am });
    tone(v, { f: 1850, f2: 600, dur: 0.16, gain: 0.12 });
  },

  /** 大地技能：重击 + 碎石 */
  skill_earth(v) {
    const d = drive(v, 3, v.out, 0.8);
    tone(v, { f: 72, f2: 30, sweep: 0.5, dur: 0.82, gain: 0.95, dest: d });
    noise(v, { color: 'brown', dur: 1.0, gain: 0.8, filter: 'lowpass', f: 1250, f2: 150, sweep: 0.8, dest: d });
    noise(v, { dur: 0.05, gain: 0.5, filter: 'highpass', f: 1500 });
    const rubble = tremolo(v, 13, 0.85, v.out, 0.05, 0.6);
    noise(v, { at: 0.05, dur: 0.6, gain: 0.26, filter: 'bandpass', f: 900, q: 1, rate: 0.6, dest: rubble });
  },

  /** 增益技能：上扬和弦 + 微光 */
  skill_buff(v) {
    const notes = [392, 587, 784];
    for (let i = 0; i < notes.length; i++) {
      tone(v, { f: notes[i], at: i * 0.04, dur: 0.95, gain: 0.11, attack: 0.15 });
      tone(v, { type: 'triangle', f: notes[i], at: i * 0.04, dur: 0.8, gain: 0.05, attack: 0.18, detune: 6 });
    }
    noise(v, { dur: 0.85, gain: 0.06, filter: 'highpass', f: 7000, attack: 0.3 });
    tone(v, { f: 300, f2: 1200, dur: 0.5, gain: 0.08, attack: 0.05 });
  },

  /** 投掷：短促的破空 */
  skill_throw(v) {
    noise(v, { dur: 0.19, gain: 0.32, filter: 'bandpass', f: 600, f2: 1900, q: 1.3, attack: 0.03 });
    noise(v, { dur: 0.012, gain: 0.18, filter: 'highpass', f: 3500 });
    tone(v, { f: 220, f2: 150, dur: 0.06, gain: 0.1 });
  },

  // ───────────── 元素状态 ─────────────

  burn_tick(v) {
    noise(v, { dur: 0.03, gain: 0.16, filter: 'highpass', f: 2500 });
    noise(v, { at: 0.035, dur: 0.025, gain: 0.12, filter: 'bandpass', f: 1300, q: 1.5 });
    noise(v, { dur: 0.13, gain: 0.07, filter: 'lowpass', f: 800, attack: 0.02 });
  },

  shock_zap(v) {
    const o = tone(v, { type: 'sawtooth', f: 2200, f2: 800, dur: 0.075, gain: 0.1 });
    fm(v, o, 120, 400, 'square', 0, 0.08);
    noise(v, { dur: 0.08, gain: 0.26, filter: 'highpass', f: 4000 });
  },

  corrode_tick(v) {
    tone(v, { f: 280, f2: 640, dur: 0.08, gain: 0.18 });
    tone(v, { f: 420, f2: 820, at: 0.05, dur: 0.07, gain: 0.1 });
    noise(v, { dur: 0.08, gain: 0.06, filter: 'lowpass', f: 600 });
  },
};
