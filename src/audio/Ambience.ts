/**
 * 环境声床（Unity I6，只在 audio-bake.html 里离线渲）：每章一条立体声长循环，走 Unity 的 Ambience 总线。
 * 只有「空气」，没有旋律：压在音效和配乐底下，给开放大图一层持续的空间感（Unity 侧播放与混响见 AmbienceZone.cs 的 AmbienceDirector）。
 *
 *  - desert ：沙寺。低沉的风（棕噪声低通）+ 一阵阵阵风的呼啸（粉噪声带通，频率跟着风势走）+ 风大时起沙的嘶声（高通白噪声）
 *  - frost  ：霜山。更冷更高的风（带通 1.2 kHz、Q 高一点有哨音）+ 低处的山风 + 风口的细哨音 + 偶尔的冰裂（短促带通噪声 + 下滑音）
 *  - inferno：熔火。低频轰鸣（棕噪声 120 Hz 以下）+ 熔岩冒泡（下滑的低频「啵」）+ 噼啪的火星（零星的高频短脉冲）
 *
 * 每条按 seconds + 2 s 渲，最后 2 s 交叉淡入开头，得到无缝循环。随机只在烘焙时用一次，片段是固定的。
 */
import type { SynthKit } from './Synth';

export const AMBIENCE_IDS = ['amb_desert', 'amb_frost', 'amb_inferno'] as const;
export type AmbienceId = (typeof AMBIENCE_IDS)[number];

/** 声床长度（秒）与交叉淡化长度 */
export const AMBIENCE_SECONDS = 24;
export const AMBIENCE_XFADE = 2;

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** 风势曲线：每 step 秒一个随机点，三次平滑插值，0..1 */
function gusts(seconds: number, step: number, lo: number, hi: number): Float32Array {
  const n = Math.ceil(seconds * 50);
  const pts: number[] = [];
  for (let t = 0; t <= seconds + step * 2; t += step) pts.push(rnd(lo, hi));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / 50) / step;
    const k = Math.floor(t);
    const f = t - k;
    const s = f * f * (3 - 2 * f);
    out[i] = pts[k] * (1 - s) + pts[k + 1] * s;
  }
  return out;
}

interface Ctx {
  ac: OfflineAudioContext;
  kit: SynthKit;
  out: AudioNode;
  seconds: number;
}

/** 一路循环噪声 → 滤波 → 增益（曲线）→ 声像 */
function noiseBed(c: Ctx, color: 'white' | 'pink' | 'brown', type: BiquadFilterType, f: number, q: number, gain: Float32Array | number, pan: number,
  freqCurve?: Float32Array): void {
  const { ac, kit } = c;
  const src = ac.createBufferSource();
  src.buffer = kit.buffer(color);
  src.loop = true;
  const fl = ac.createBiquadFilter();
  fl.type = type;
  fl.frequency.value = f;
  fl.Q.value = q;
  if (freqCurve) fl.frequency.setValueCurveAtTime(freqCurve, 0, c.seconds);
  const g = ac.createGain();
  if (typeof gain === 'number') g.gain.value = gain;
  else g.gain.setValueCurveAtTime(gain, 0, c.seconds);
  const p = ac.createStereoPanner();
  p.pan.value = pan;
  src.connect(fl);
  fl.connect(g);
  g.connect(p);
  p.connect(c.out);
  src.start(0, Math.random() * 4);
  src.stop(c.seconds);
}

const scale = (a: Float32Array, k: number, add = 0): Float32Array => a.map((x) => x * k + add);

/** 一次短促的事件（冰裂、冒泡、噼啪）：带通噪声 + 可选的下滑正弦 */
function blip(c: Ctx, at: number, o: { f: number; q: number; dur: number; gain: number; pan: number; tone?: [number, number]; toneGain?: number }): void {
  const { ac, kit } = c;
  const p = ac.createStereoPanner();
  p.pan.value = o.pan;
  p.connect(c.out);
  const src = ac.createBufferSource();
  src.buffer = kit.buffer('white');
  const fl = ac.createBiquadFilter();
  fl.type = 'bandpass';
  fl.frequency.value = o.f;
  fl.Q.value = o.q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(o.gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);
  src.connect(fl);
  fl.connect(g);
  g.connect(p);
  src.start(at, Math.random() * 4);
  src.stop(at + o.dur + 0.02);
  if (o.tone) {
    const osc = ac.createOscillator();
    osc.frequency.setValueAtTime(o.tone[0], at);
    osc.frequency.exponentialRampToValueAtTime(o.tone[1], at + o.dur);
    const tg = ac.createGain();
    tg.gain.setValueAtTime(0, at);
    tg.gain.linearRampToValueAtTime(o.toneGain ?? o.gain, at + 0.006);
    tg.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);
    osc.connect(tg);
    tg.connect(p);
    osc.start(at);
    osc.stop(at + o.dur + 0.02);
  }
}

function desert(c: Ctx): void {
  const s = c.seconds;
  const gust = gusts(s, 2.6, 0.2, 1);
  noiseBed(c, 'brown', 'lowpass', 480, 0.7, scale(gust, 0.32, 0.18), -0.35);
  noiseBed(c, 'brown', 'lowpass', 520, 0.7, scale(gusts(s, 2.9, 0.2, 1), 0.3, 0.18), 0.35);
  // 阵风呼啸：频率跟风势走（600 → 1500 Hz）
  noiseBed(c, 'pink', 'bandpass', 900, 0.9, scale(gust, 0.16, 0.03), 0.1, scale(gust, 900, 600));
  // 起沙：风势过 0.6 才有
  noiseBed(c, 'white', 'highpass', 4800, 0.7, gust.map((x) => Math.max(0, x - 0.6) * 0.12), -0.1);
}

function frost(c: Ctx): void {
  const s = c.seconds;
  const gust = gusts(s, 2.2, 0.15, 1);
  noiseBed(c, 'brown', 'lowpass', 300, 0.7, scale(gusts(s, 3.1, 0.3, 1), 0.28, 0.12), 0);
  noiseBed(c, 'pink', 'bandpass', 1200, 2.2, scale(gust, 0.22, 0.05), -0.4, scale(gust, 800, 900));
  noiseBed(c, 'pink', 'bandpass', 1350, 2.2, scale(gusts(s, 2.4, 0.15, 1), 0.2, 0.05), 0.4, scale(gust, 700, 1000));
  // 风口的细哨音：正弦，跟着阵风的峰出现
  const osc = c.ac.createOscillator();
  osc.frequency.setValueCurveAtTime(scale(gust, 500, 1650), 0, s);
  const og = c.ac.createGain();
  og.gain.setValueCurveAtTime(gust.map((x) => Math.max(0, x - 0.7) * 0.06), 0, s);
  osc.connect(og);
  og.connect(c.out);
  osc.start(0);
  osc.stop(s);
  // 冰裂：每 4–8 s 一下
  for (let t = rnd(1, 3); t < s - 0.5; t += rnd(4, 8)) {
    blip(c, t, { f: rnd(300, 650), q: 6, dur: rnd(0.12, 0.3), gain: rnd(0.08, 0.16), pan: rnd(-0.8, 0.8), tone: [rnd(900, 1400), rnd(250, 400)], toneGain: 0.03 });
  }
}

function inferno(c: Ctx): void {
  const s = c.seconds;
  noiseBed(c, 'brown', 'lowpass', 110, 0.8, scale(gusts(s, 3.5, 0.5, 1), 0.5, 0.25), -0.2);
  noiseBed(c, 'brown', 'lowpass', 130, 0.8, scale(gusts(s, 3.8, 0.5, 1), 0.45, 0.25), 0.2);
  // 远处的火声：带通粉噪声，慢慢起伏
  noiseBed(c, 'pink', 'bandpass', 700, 0.6, scale(gusts(s, 1.7, 0, 1), 0.05, 0.02), 0);
  // 熔岩冒泡：低频「啵」
  for (let t = rnd(0.2, 0.8); t < s - 0.3; t += rnd(0.35, 1.4)) {
    const f0 = rnd(90, 160);
    blip(c, t, { f: rnd(250, 500), q: 2, dur: rnd(0.08, 0.16), gain: rnd(0.04, 0.09), pan: rnd(-0.7, 0.7), tone: [f0, f0 * 0.5], toneGain: rnd(0.12, 0.22) });
  }
  // 火星噼啪：零星的高频短脉冲（成簇）
  for (let t = rnd(0.1, 0.5); t < s - 0.2; t += rnd(0.6, 2.2)) {
    const n = 1 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) blip(c, t + k * rnd(0.02, 0.07), { f: rnd(2500, 5000), q: 1.5, dur: rnd(0.01, 0.025), gain: rnd(0.04, 0.1), pan: rnd(-0.9, 0.9) });
  }
}

const BUILDERS: Record<AmbienceId, (c: Ctx) => void> = { amb_desert: desert, amb_frost: frost, amb_inferno: inferno };

/** 在离线上下文里搭一条声床（长度 = seconds），接到 out */
export function buildAmbience(id: AmbienceId, ac: OfflineAudioContext, kit: SynthKit, out: AudioNode, seconds: number): void {
  BUILDERS[id]({ ac, kit, out, seconds });
}
