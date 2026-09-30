/**
 * WebAudio 程序化合成的基础构件：噪声缓冲、失真曲线、混响脉冲，以及写音色用的小工具
 * （tone 振荡器 + 包络、noise 滤波噪声、filt / drive / vibrato 路由）。
 *
 * 所有频率参数都会乘以 voice.p（音高倍率），便于同一配方做随机音高变化。
 */

export type NoiseColor = 'white' | 'pink' | 'brown';

/** 一次发声的上下文：配方把节点接到 out，并在 end 里登记最晚结束时间 */
export interface Voice {
  kit: SynthKit;
  ac: AudioContext;
  out: AudioNode;
  /** 起始时间（AudioContext 时间） */
  t: number;
  /** 音高倍率 */
  p: number;
  /** 所有声源的最晚结束时间，由工具函数自动更新 */
  end: number;
}

export type Recipe = (v: Voice) => void;

const NOISE_SECONDS = 2.5;

/** 与一个 AudioContext 绑定的共享资源 */
export class SynthKit {
  private readonly noise: Record<NoiseColor, AudioBuffer>;
  private readonly curves = new Map<number, Float32Array<ArrayBuffer>>();

  constructor(readonly ac: AudioContext) {
    this.noise = {
      white: this.makeNoise('white'),
      pink: this.makeNoise('pink'),
      brown: this.makeNoise('brown'),
    };
  }

  buffer(color: NoiseColor): AudioBuffer {
    return this.noise[color];
  }

  private makeNoise(color: NoiseColor): AudioBuffer {
    const sr = this.ac.sampleRate;
    const n = Math.floor(sr * NOISE_SECONDS);
    const buf = this.ac.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    if (color === 'white') {
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } else if (color === 'pink') {
      // Paul Kellet 近似
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else {
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  /** 软削波失真曲线（按 amount 缓存） */
  curve(amount: number): Float32Array<ArrayBuffer> {
    const key = Math.round(amount * 10);
    let c = this.curves.get(key);
    if (!c) {
      const n = 1024;
      c = new Float32Array(n);
      const k = Math.max(0.01, amount);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      }
      this.curves.set(key, c);
    }
    return c;
  }

  /** 程序化混响脉冲：早期反射 + 指数衰减、越往后越暗的立体声尾音 */
  makeImpulse(seconds: number, decay: number): AudioBuffer {
    const sr = this.ac.sampleRate;
    const n = Math.floor(sr * seconds);
    const buf = this.ac.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // 低通系数随时间变小 → 尾音逐渐变暗
        const a = 0.9 - 0.75 * t;
        lp = lp * (1 - a) + (Math.random() * 2 - 1) * a;
        d[i] = lp * Math.pow(1 - t, decay);
      }
      // 早期反射
      const taps = ch === 0 ? [0.011, 0.023, 0.037, 0.052] : [0.015, 0.029, 0.041, 0.061];
      for (let k = 0; k < taps.length; k++) {
        const idx = Math.floor(taps[k] * sr);
        if (idx < n) d[idx] += (0.55 - k * 0.1) * (ch === 0 ? 1 : -1);
      }
    }
    return buf;
  }
}

// ───────────── 工具函数 ─────────────

function track(v: Voice, end: number): void {
  if (end > v.end) v.end = end;
}

/**
 * 振幅包络：0 → peak（attack）→ 保持 hold → 衰减到静音（总时长 dur）。返回结束时间。
 */
export function envelope(g: AudioParam, t0: number, peak: number, attack: number, hold: number, dur: number, curve: 'exp' | 'lin' = 'exp'): number {
  const a = Math.max(0.001, attack);
  const end = t0 + Math.max(dur, a + hold + 0.01);
  g.setValueAtTime(0, t0);
  g.linearRampToValueAtTime(peak, t0 + a);
  if (hold > 0) g.setValueAtTime(peak, t0 + a + hold);
  if (curve === 'exp') g.exponentialRampToValueAtTime(0.0001, end);
  else g.linearRampToValueAtTime(0, end);
  return end;
}

export interface ToneOpts {
  type?: OscillatorType;
  /** 起始频率（Hz） */
  f: number;
  /** 目标频率（指数滑音） */
  f2?: number;
  /** 滑音时长，缺省 = dur */
  sweep?: number;
  /** 相对 voice.t 的起始偏移 */
  at?: number;
  /** 总时长（含衰减） */
  dur: number;
  gain?: number;
  attack?: number;
  hold?: number;
  curve?: 'exp' | 'lin';
  detune?: number;
  dest?: AudioNode;
}

/** 振荡器 + 包络 */
export function tone(v: Voice, o: ToneOpts): OscillatorNode {
  const ac = v.ac;
  const t0 = v.t + (o.at ?? 0);
  const osc = ac.createOscillator();
  osc.type = o.type ?? 'sine';
  const f = Math.max(1, o.f * v.p);
  osc.frequency.setValueAtTime(f, t0);
  if (o.f2 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2 * v.p), t0 + (o.sweep ?? o.dur));
  if (o.detune) osc.detune.setValueAtTime(o.detune, t0);
  const g = ac.createGain();
  const end = envelope(g.gain, t0, o.gain ?? 0.5, o.attack ?? 0.002, o.hold ?? 0, o.dur, o.curve);
  osc.connect(g);
  g.connect(o.dest ?? v.out);
  osc.start(t0);
  osc.stop(end + 0.02);
  track(v, end + 0.03);
  return osc;
}

export interface NoiseOpts {
  color?: NoiseColor;
  at?: number;
  dur: number;
  gain?: number;
  attack?: number;
  hold?: number;
  curve?: 'exp' | 'lin';
  /** 主滤波器 */
  filter?: BiquadFilterType;
  f?: number;
  f2?: number;
  sweep?: number;
  q?: number;
  /** 额外高通 / 低通（Hz） */
  hp?: number;
  lp?: number;
  /** 播放速率（改变噪声「颗粒」） */
  rate?: number;
  dest?: AudioNode;
}

/** 滤波噪声 + 包络 */
export function noise(v: Voice, o: NoiseOpts): AudioBufferSourceNode {
  const ac = v.ac;
  const t0 = v.t + (o.at ?? 0);
  const src = ac.createBufferSource();
  src.buffer = v.kit.buffer(o.color ?? 'white');
  src.loop = true;
  src.playbackRate.setValueAtTime((o.rate ?? 1) * v.p, t0);
  let node: AudioNode = src;
  if (o.filter) {
    const f = ac.createBiquadFilter();
    f.type = o.filter;
    const f0 = Math.min(20000, Math.max(20, (o.f ?? 1000) * v.p));
    f.frequency.setValueAtTime(f0, t0);
    if (o.f2 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.min(20000, Math.max(20, o.f2 * v.p)), t0 + (o.sweep ?? o.dur));
    f.Q.setValueAtTime(o.q ?? 1, t0);
    node.connect(f);
    node = f;
  }
  if (o.hp) {
    const f = ac.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.setValueAtTime(o.hp, t0);
    node.connect(f);
    node = f;
  }
  if (o.lp) {
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(o.lp, t0);
    node.connect(f);
    node = f;
  }
  const g = ac.createGain();
  const end = envelope(g.gain, t0, o.gain ?? 0.5, o.attack ?? 0.002, o.hold ?? 0, o.dur, o.curve);
  node.connect(g);
  g.connect(o.dest ?? v.out);
  src.start(t0, Math.random() * (NOISE_SECONDS - 0.5));
  src.stop(end + 0.02);
  track(v, end + 0.03);
  return src;
}

/** 滤波器，接到 dest（缺省 voice.out），返回它以便把声源接进来 */
export function filt(v: Voice, type: BiquadFilterType, f: number, q = 1, dest?: AudioNode, f2?: number, sweep?: number, at = 0): BiquadFilterNode {
  const node = v.ac.createBiquadFilter();
  const t0 = v.t + at;
  node.type = type;
  node.frequency.setValueAtTime(Math.min(20000, Math.max(20, f * v.p)), t0);
  if (f2 !== undefined) node.frequency.exponentialRampToValueAtTime(Math.min(20000, Math.max(20, f2 * v.p)), t0 + (sweep ?? 0.2));
  node.Q.setValueAtTime(q, t0);
  node.connect(dest ?? v.out);
  return node;
}

/** 软削波失真 + 输出增益补偿 */
export function drive(v: Voice, amount: number, dest?: AudioNode, post = 0.7): AudioNode {
  const ws = v.ac.createWaveShaper();
  ws.curve = v.kit.curve(amount);
  ws.oversample = '2x';
  const g = v.ac.createGain();
  g.gain.value = post;
  ws.connect(g);
  g.connect(dest ?? v.out);
  return ws;
}

/** 给若干振荡器加颤音（音分），delay 秒后渐入 */
export function vibrato(v: Voice, oscs: OscillatorNode[], rate: number, depth: number, at = 0, delay = 0, dur = 1): void {
  const ac = v.ac;
  const t0 = v.t + at;
  const lfo = ac.createOscillator();
  lfo.frequency.setValueAtTime(rate, t0);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0, t0 + delay);
  g.gain.linearRampToValueAtTime(depth, t0 + delay + 0.15);
  lfo.connect(g);
  for (const o of oscs) g.connect(o.detune);
  lfo.start(t0);
  lfo.stop(t0 + dur + 0.05);
  track(v, t0 + dur + 0.06);
}

/** 频率调制：用 LFO 抖动振荡器频率（Hz 深度），做电流 / 嗡鸣 */
export function fm(v: Voice, osc: OscillatorNode, rate: number, depthHz: number, type: OscillatorType = 'square', at = 0, dur = 0.5): void {
  const ac = v.ac;
  const t0 = v.t + at;
  const lfo = ac.createOscillator();
  lfo.type = type;
  lfo.frequency.setValueAtTime(rate, t0);
  const g = ac.createGain();
  g.gain.setValueAtTime(depthHz, t0);
  lfo.connect(g);
  g.connect(osc.frequency);
  lfo.start(t0);
  lfo.stop(t0 + dur + 0.05);
  track(v, t0 + dur + 0.06);
}

/** 幅度调制节点：返回一个 GainNode（接到 dest），其增益被 LFO 在 [1-depth, 1] 间调制 */
export function tremolo(v: Voice, rate: number, depth: number, dest?: AudioNode, at = 0, dur = 0.5, type: OscillatorType = 'square'): GainNode {
  const ac = v.ac;
  const t0 = v.t + at;
  const g = ac.createGain();
  g.gain.setValueAtTime(1 - depth * 0.5, t0);
  const lfo = ac.createOscillator();
  lfo.type = type;
  lfo.frequency.setValueAtTime(rate, t0);
  const lg = ac.createGain();
  lg.gain.setValueAtTime(depth * 0.5, t0);
  lfo.connect(lg);
  lg.connect(g.gain);
  g.connect(dest ?? v.out);
  lfo.start(t0);
  lfo.stop(t0 + dur + 0.05);
  track(v, t0 + dur + 0.06);
  return g;
}

/** MIDI 音高 → 频率 */
export function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** 纯视觉 / 听觉随机 [a, b) */
export function rnd(a: number, b: number): number {
  return a + (b - a) * Math.random();
}
