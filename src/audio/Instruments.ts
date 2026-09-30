/**
 * 乐器音色（音乐与部分旋律性音效共用）：
 * 古筝式拨弦、笛子（带气声与颤音）、编钟 / 铃、锣、太鼓、底鼓、军鼓、镲、木鱼、沙锤、贝斯、铺底 pad、铜管式和弦 stab。
 * 参数 at 为相对 voice.t 的偏移（秒），vel 为力度 0..1。
 */
import { type Voice, drive, filt, noise, tone, vibrato } from './Synth';

/** 古筝式拨弦：略低起音滑入本音、亮 → 暗的滤波包络、拨片瞬态 */
export function guzheng(v: Voice, at: number, f: number, vel: number, dur = 1.4): void {
  const t0 = v.t + at;
  const lp = v.ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.setValueAtTime(1.6, t0);
  lp.frequency.setValueAtTime(Math.min(14000, f * 11 * v.p), t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(250, f * 1.8 * v.p), t0 + 0.4);
  lp.connect(v.out);
  const o1 = tone(v, { type: 'triangle', f: f * 0.985, f2: f, sweep: 0.045, at, dur, gain: 0.42 * vel, attack: 0.003, dest: lp });
  const o2 = tone(v, { type: 'sawtooth', f: f * 2 * 0.985, f2: f * 2, sweep: 0.045, at, dur: dur * 0.55, gain: 0.1 * vel, attack: 0.002, dest: lp });
  noise(v, { at, dur: 0.035, gain: 0.1 * vel, filter: 'bandpass', f: Math.min(9000, f * 4), q: 2.5 });
  // 长音「揉弦」
  if (dur > 0.9) vibrato(v, [o1, o2], 5.5, 14, at, 0.3, dur);
}

/** 笛子：正弦 + 三角为主，气声噪声、渐入颤音，可带上方装饰音 */
export function dizi(v: Voice, at: number, f: number, dur: number, vel: number, grace = false): void {
  const hold = Math.max(0, dur - 0.07);
  const total = dur + 0.2;
  if (grace) {
    // 装饰音：上方二度快速滑入
    tone(v, { type: 'sine', f: f * 1.122, at: at - 0.055, dur: 0.07, gain: 0.16 * vel, attack: 0.01 });
  }
  const o1 = tone(v, { type: 'sine', f, at, dur: total, gain: 0.3 * vel, attack: 0.07, hold, curve: 'exp' });
  const o2 = tone(v, { type: 'triangle', f, at, dur: total, gain: 0.08 * vel, attack: 0.08, hold });
  const o3 = tone(v, { type: 'sine', f: f * 2, at, dur: total, gain: 0.05 * vel, attack: 0.09, hold });
  vibrato(v, [o1, o2, o3], 5.3, 16, at, Math.min(0.35, dur * 0.4), total);
  // 气声
  noise(v, { at, dur: total, gain: 0.04 * vel, filter: 'bandpass', f: f * 1.02, q: 5, attack: 0.06, hold });
  noise(v, { at, dur: 0.1, gain: 0.05 * vel, filter: 'highpass', f: 2600, attack: 0.02 });
}

/** 编钟 / 铃：非谐泛音 */
export function bell(v: Voice, at: number, f: number, vel: number, dur = 1.3): void {
  tone(v, { type: 'sine', f, at, dur, gain: 0.26 * vel });
  tone(v, { type: 'sine', f: f * 2.76, at, dur: dur * 0.55, gain: 0.1 * vel });
  tone(v, { type: 'sine', f: f * 5.4, at, dur: dur * 0.3, gain: 0.05 * vel });
  tone(v, { type: 'sine', f: f * 0.5, at, dur: dur * 0.8, gain: 0.05 * vel, attack: 0.01 });
}

/** 锣：低频非谐泛音，高泛音缓慢涌起，音高微微下沉 */
export function gong(v: Voice, at: number, f: number, vel: number, dur = 3.2): void {
  const partials = [1, 1.52, 2.03, 2.61, 3.22, 4.1];
  const gains = [0.36, 0.22, 0.16, 0.1, 0.07, 0.04];
  for (let i = 0; i < partials.length; i++) {
    tone(v, {
      type: 'sine', f: f * partials[i], f2: f * partials[i] * 0.985, at,
      dur: dur * (1 - i * 0.1), gain: gains[i] * vel, attack: 0.01 + i * 0.05,
    });
  }
  noise(v, { at, dur: 0.25, gain: 0.18 * vel, filter: 'lowpass', f: 900 });
}

/** 太鼓：重低音 + 皮面噪声 */
export function taiko(v: Voice, at: number, f: number, vel: number): void {
  tone(v, { type: 'sine', f: f * 1.6, f2: f * 0.8, sweep: 0.12, at, dur: 0.6, gain: 0.85 * vel });
  tone(v, { type: 'triangle', f: f * 2.3, f2: f * 1.6, sweep: 0.06, at, dur: 0.12, gain: 0.12 * vel });
  noise(v, { at, dur: 0.09, gain: 0.32 * vel, filter: 'lowpass', f: 700 });
}

export function kick(v: Voice, at: number, vel: number): void {
  tone(v, { type: 'sine', f: 165, f2: 45, sweep: 0.09, at, dur: 0.34, gain: 0.95 * vel });
  tone(v, { type: 'triangle', f: 2200, at, dur: 0.008, gain: 0.08 * vel });
}

export function snare(v: Voice, at: number, vel: number): void {
  noise(v, { at, dur: 0.17, gain: 0.5 * vel, filter: 'bandpass', f: 1900, q: 0.8, hp: 380 });
  tone(v, { type: 'triangle', f: 205, f2: 170, sweep: 0.05, at, dur: 0.09, gain: 0.32 * vel });
}

export function hat(v: Voice, at: number, vel: number, open = false): void {
  noise(v, { at, dur: open ? 0.22 : 0.045, gain: 0.2 * vel, filter: 'highpass', f: 7200, q: 0.7 });
}

export function crash(v: Voice, at: number, vel: number): void {
  noise(v, { at, dur: 1.6, gain: 0.22 * vel, filter: 'highpass', f: 3800 });
  noise(v, { at, dur: 0.9, gain: 0.1 * vel, filter: 'bandpass', f: 8000, q: 0.5 });
}

export function woodblock(v: Voice, at: number, f: number, vel: number): void {
  tone(v, { type: 'sine', f, at, dur: 0.08, gain: 0.32 * vel });
  tone(v, { type: 'triangle', f: f * 2.7, at, dur: 0.03, gain: 0.08 * vel });
}

export function shaker(v: Voice, at: number, vel: number): void {
  noise(v, { at, dur: 0.07, gain: 0.1 * vel, filter: 'bandpass', f: 6200, q: 1, attack: 0.015 });
}

/** 贝斯：锯齿过低通 + 正弦次低音；distort 时加失真（Boss 曲） */
export function bass(v: Voice, at: number, f: number, dur: number, vel: number, bright = 0.5, distort = false): void {
  const t0 = v.t + at;
  const cutoff = f * 3 + bright * 1400;
  let dest: AudioNode = v.out;
  if (distort) dest = drive(v, 6, v.out, 0.45);
  const lp = v.ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.setValueAtTime(4, t0);
  lp.frequency.setValueAtTime(cutoff, t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(80, f * 1.5), t0 + Math.max(0.08, dur * 0.7));
  lp.connect(dest);
  const hold = Math.max(0, dur * 0.6);
  tone(v, { type: 'sawtooth', f, at, dur: dur + 0.08, gain: 0.3 * vel, attack: 0.004, hold, dest: lp });
  tone(v, { type: 'sine', f: f * 0.5 < 30 ? f : f * 0.5, at, dur: dur + 0.08, gain: 0.35 * vel, attack: 0.004, hold });
}

/** 铺底和弦：每个音两只失谐锯齿，经共享低通，慢起慢收 */
export function pad(v: Voice, at: number, freqs: readonly number[], dur: number, vel: number, cutoff = 1100): void {
  const lp = filt(v, 'lowpass', cutoff, 0.4);
  const attack = Math.min(0.8, dur * 0.3);
  for (const f of freqs) {
    tone(v, { type: 'sawtooth', f, at, dur: dur + 0.9, gain: 0.05 * vel, attack, hold: Math.max(0, dur - attack), curve: 'lin', detune: -7, dest: lp });
    tone(v, { type: 'sawtooth', f, at, dur: dur + 0.9, gain: 0.05 * vel, attack, hold: Math.max(0, dur - attack), curve: 'lin', detune: 7, dest: lp });
  }
}

/** 短促的铜管式和弦 */
export function stab(v: Voice, at: number, freqs: readonly number[], vel: number): void {
  const lp = filt(v, 'lowpass', 3200, 1.2, undefined, 500, 0.22, at);
  for (const f of freqs) {
    tone(v, { type: 'sawtooth', f, at, dur: 0.24, gain: 0.09 * vel, attack: 0.006, detune: (Math.random() - 0.5) * 12, dest: lp });
  }
}
