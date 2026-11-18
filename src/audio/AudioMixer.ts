/**
 * WebAudio 混音台：照 Unity 的 Spiritfire.mixer（AudioMixerBuilder 生成，结构见 AudioMix.cs）。
 *
 *   Master   [推子 ← 主音量] [限幅：−2 dB，10 ms / 120 ms] → 输出
 *   ├─ World [推子 ← 快照：游玩 1 / 暂停 0.45 / 结算 0.8] [低通 ← 快照：暂停 6 kHz，其余 22 kHz]
 *   │  ├─ SFX      [推子 ← 音效音量] [发送 → Reverb，默认 −80 dB = 关；章节 / 混响区由 AmbienceDirector 写]
 *   │  ├─ Music    [推子 ← 音乐音量]
 *   │  ├─ Ambience [推子 ← 环境音量]（声床）
 *   │  └─ Reverb   [接收] [SFX Reverb：纯湿声] [推子 0 dB]
 *   └─ UI    [推子 ← 界面音量]（按钮音不被暂停压低）
 *
 * Unity 组里第 0 个是推子，效果器插在它后面：限幅器在主推子后、低通在 World 推子后、发送在 SFX 推子后（推子后发送）。
 * 玩家音量走推子（dB：线性 → linearToDb → 推子按 dB 放），快照只管 World 推子和低通，两者不在同一个推子上。
 * 快照过渡：推子按 dB 线性过渡（WebAudio 的指数斜坡 = dB 线性），低通截止按 Hz 线性过渡，都用 AudioContext 时间（不受游戏暂停影响）。
 * SFX Reverb 没有 WebAudio 对应物：卷积近似（衰减 1.49 s 的指数衰减立体声噪声、11 ms 预延迟，回送 Room + Reverb = −8 dB）。
 */
import {
  LIMITER_ATTACK, LIMITER_RELEASE, LIMITER_THRESHOLD, OPEN_LOWPASS, REVERB, REVERB_SEND_OFF, SNAPSHOTS, SNAPSHOT_GAMEPLAY,
  dbToLinear, faderGain, linearToDb, type BusId, type SnapshotName,
} from './AudioRules';

/** Lowpass Simple / AudioLowPassFilter 的 Q 0.7 换成 BiquadFilter 低通的共振 dB（WebAudio 低通的 Q 是 dB） */
export const lowpassQDb = (q: number): number => 20 * Math.log10(q);

export interface PlayerVolumes {
  master: number;
  sfx: number;
  music: number;
  ambience: number;
  ui: number;
}

export class AudioMixer {
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly world: GainNode;
  readonly worldLowpass: BiquadFilterNode;
  readonly sfx: GainNode;
  readonly music: GainNode;
  readonly ambience: GainNode;
  readonly reverbSend: GainNode;
  readonly reverb: ConvolverNode;
  readonly reverbOut: GainNode;
  readonly ui: GainNode;
  /** 当前快照与各推子的目标值（调试 / 实机核对用） */
  snapshot: SnapshotName = SNAPSHOT_GAMEPLAY;
  sendDb = REVERB_SEND_OFF;
  readonly volumes: PlayerVolumes = { master: 1, sfx: 1, music: 1, ambience: 1, ui: 1 };

  constructor(readonly ac: AudioContext) {
    const nyquist = ac.sampleRate / 2;
    this.limiter = ac.createDynamicsCompressor();
    // Unity Compressor 当限幅器用：硬拐点、最大压缩比
    this.limiter.threshold.value = LIMITER_THRESHOLD;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = LIMITER_ATTACK / 1000;
    this.limiter.release.value = LIMITER_RELEASE / 1000;
    this.limiter.connect(ac.destination);

    this.master = ac.createGain();
    this.master.connect(this.limiter);

    this.world = ac.createGain();
    this.worldLowpass = ac.createBiquadFilter();
    this.worldLowpass.type = 'lowpass';
    this.worldLowpass.Q.value = lowpassQDb(Math.SQRT1_2);
    this.worldLowpass.frequency.value = Math.min(OPEN_LOWPASS, nyquist * 0.999);
    this.world.connect(this.worldLowpass);
    this.worldLowpass.connect(this.master);

    this.ui = ac.createGain();
    this.ui.connect(this.master);

    this.sfx = ac.createGain();
    this.sfx.connect(this.world);
    this.music = ac.createGain();
    this.music.connect(this.world);
    this.ambience = ac.createGain();
    this.ambience.connect(this.world);

    // Reverb：SFX 推子后发送 → 接收 → 卷积（纯湿声）→ 回送推子 → World
    this.reverbSend = ac.createGain();
    this.reverbSend.gain.value = dbToLinear(REVERB_SEND_OFF);
    this.reverb = ac.createConvolver();
    this.reverb.buffer = makeRoomImpulse(ac);
    this.reverbOut = ac.createGain();
    this.reverbOut.gain.value = dbToLinear((REVERB.room + REVERB.reverb) / 100);
    this.sfx.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.reverbOut);
    this.reverbOut.connect(this.world);

    this.transitionTo(SNAPSHOT_GAMEPLAY, 0);
  }

  /** 某条总线的输入节点 */
  bus(id: BusId): AudioNode {
    switch (id) {
      case 'master': return this.master;
      case 'world': return this.world;
      case 'sfx': return this.sfx;
      case 'music': return this.music;
      case 'ambience': return this.ambience;
      case 'reverb': return this.reverbSend;
      case 'ui': return this.ui;
    }
  }

  /** 玩家音量（设置里的 0..1）写到推子上（Unity：AudioMix.ApplyVolumes → 暴露参数，SetFloat 立即生效；这里 15 ms 平滑防爆音） */
  setVolumes(v: PlayerVolumes): void {
    Object.assign(this.volumes, v);
    const now = this.ac.currentTime;
    const set = (p: AudioParam, linear: number): void => {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.setTargetAtTime(faderGain(linear), now, 0.015);
    };
    set(this.master.gain, v.master);
    set(this.sfx.gain, v.sfx);
    set(this.music.gain, v.music);
    set(this.ambience.gain, v.ambience);
    set(this.ui.gain, v.ui);
  }

  /** 切快照（seconds = 过渡时间；0 = 立即） */
  transitionTo(name: SnapshotName, seconds: number): void {
    this.snapshot = name;
    const s = SNAPSHOTS[name];
    const now = this.ac.currentTime;
    const nyquist = this.ac.sampleRate / 2;
    const lp = Math.min(s.lowpass, nyquist * 0.999);
    const g = this.world.gain, f = this.worldLowpass.frequency;
    g.cancelScheduledValues(now);
    f.cancelScheduledValues(now);
    if (seconds <= 0) {
      g.setValueAtTime(s.world, now);
      f.setValueAtTime(lp, now);
      return;
    }
    // 推子按 dB 线性过渡 = 线性增益的指数斜坡（三个快照的 World 都 > 0）
    g.setValueAtTime(Math.max(1e-4, g.value), now);
    g.exponentialRampToValueAtTime(s.world, now + seconds);
    f.setValueAtTime(f.value, now);
    f.linearRampToValueAtTime(lp, now + seconds);
  }

  /** 混响发送（dB，−80 = 关） */
  setReverbSendDb(db: number): void {
    this.sendDb = db;
    const now = this.ac.currentTime;
    const p = this.reverbSend.gain;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(dbToLinear(db), now, 0.02);
  }

  /** 当前各推子（dB）与快照（调试） */
  describe(): Record<string, unknown> {
    const db = (n: GainNode): number => Math.round(linearToDb(n.gain.value) * 100) / 100;
    return {
      snapshot: this.snapshot,
      masterDb: db(this.master), worldDb: db(this.world), worldGain: this.world.gain.value, worldLowpass: Math.round(this.worldLowpass.frequency.value),
      sfxDb: db(this.sfx), musicDb: db(this.music), ambienceDb: db(this.ambience), uiDb: db(this.ui),
      reverbSendDb: this.sendDb, volumes: { ...this.volumes },
    };
  }
}

/**
 * SFX Reverb 的近似脉冲：立体声去相关噪声 × 指数衰减（RT60 = decayTime），越往后越暗（Room HF），前面 11 ms 预延迟
 * 和几条 −26 dB 的早期反射（Reflections）。ConvolverNode 默认按能量归一化，电平由回送推子给。
 */
function makeRoomImpulse(ac: BaseAudioContext): AudioBuffer {
  const sr = ac.sampleRate;
  const rt60 = REVERB.decayTime;
  const pre = Math.floor(0.011 * sr);
  const n = pre + Math.floor(sr * rt60 * 1.2);
  const buf = ac.createBuffer(2, n, sr);
  const refl = dbToLinear(REVERB.reflections / 100);
  // HF 衰减比整体快一点：一阶低通的系数随时间从 0.85 降到 0.35
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const a = 0.85 - 0.5 * Math.min(1, t / rt60);
      lp += ((Math.random() * 2 - 1) - lp) * a;
      d[i] = lp * Math.exp((-6.907755 * t) / rt60);
    }
    const taps = ch === 0 ? [0.007, 0.017, 0.029] : [0.009, 0.021, 0.033];
    for (const tap of taps) {
      const i = pre + Math.floor(tap * sr);
      if (i < n) d[i] += refl * 6 * (ch === 0 ? 1 : -1);
    }
  }
  return buf;
}
