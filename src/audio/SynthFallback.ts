/**
 * 退路：烘焙片段读不到时用老的实时合成配方（src/audio/Sfx*.ts、MusicTracks.ts——片段本来就是从它们烘出来的）。
 *   · 清单读不到（AudioBank.state = 'failed'）：全部音效 / 配乐 / 光束走合成；
 *   · 清单在、某个 id 的片段全都下载 / 解码失败：这个 id 走合成；曲目同理（menu / calm / combat / boss / boss_hanba）。
 *   · 声床没有实时版（Ambience.ts 只在离线烘焙里渲）：读不到就静音，警告一次。
 * 合成配方没有把 meta.gain 和那份短混响烘进去：音量这里乘 meta.gain，短混响省掉（混响总线的发送照常有）。
 * 节点接到同一套混音台总线上，所以压低、限幅、玩家音量都照样生效。
 */
import type { SfxId } from '../core/types';
import { SynthKit, type Voice } from './Synth';
import { SFX, SFX_META, SFX_POSITIONAL } from './Sfx';
import { MusicEngine, type SynthMusicId } from './Music';

export class SynthFallback {
  readonly kit: SynthKit;
  readonly music: MusicEngine;
  private readonly musicDry: GainNode;
  private readonly musicWet: GainNode;

  /** musicLevel：合成配乐接进 Music 总线前乘的电平（= 清单的 music × master，同片段的 musicBus） */
  constructor(readonly ac: AudioContext, musicOut: AudioNode, musicLevel: number) {
    this.kit = new SynthKit(ac);
    this.musicDry = ac.createGain();
    this.musicDry.gain.value = musicLevel;
    this.musicDry.connect(musicOut);
    // 合成配乐自带的混响发送：没有单独的卷积了，丢掉（Music 总线在 Unity 里也没有发送）
    this.musicWet = ac.createGain();
    this.musicWet.gain.value = 0;
    this.music = new MusicEngine(this.kit, this.musicDry, this.musicWet);
  }

  /** 有没有这个 id 的合成配方（positional = 带位置，优先敌方音色） */
  has(id: string, positional: boolean): boolean {
    return !!((positional && SFX_POSITIONAL[id as SfxId]) || SFX[id as SfxId]);
  }

  /** 有没有敌方音色的配方（带位置时换用、单独节流） */
  hasEnemyVariant(id: string): boolean {
    return !!SFX_POSITIONAL[id as SfxId];
  }

  /** 基础音量（片段里烘进去了，合成要自己乘） */
  baseGain(id: string): number {
    return SFX_META[id as SfxId]?.gain ?? 0.5;
  }

  /** 在 out 上按配方发一声，返回最晚结束时间（AudioContext 时间） */
  play(id: string, positional: boolean, out: AudioNode, at: number, pitch: number): number {
    const recipe = (positional ? SFX_POSITIONAL[id as SfxId] : undefined) ?? SFX[id as SfxId];
    if (!recipe) return at;
    const v: Voice = { kit: this.kit, ac: this.ac, out, t: at + 0.004, p: pitch, end: at + 0.05 };
    recipe(v);
    return v.end + 0.05;
  }

  setMusic(id: SynthMusicId): void {
    this.music.set(id);
  }

  /** 光束持续音的合成版（同老 AudioSystem.createBeam）：接到 out，返回要在收声时停掉的源和要断开的节点 */
  beam(out: AudioNode, pitch: number): { sources: AudioScheduledSourceNode[]; nodes: AudioNode[] } {
    const ac = this.ac;
    const now = ac.currentTime;
    // 同 audioBake 烘 shot_beam_loop 时的输入电平（meta.gain）；音量 / 总线由调用方的光束推子给
    const input = ac.createGain();
    input.gain.value = SFX_META.shot_beam.gain;
    input.connect(out);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.Q.value = 3;
    lp.connect(input);
    const wob = ac.createOscillator();
    wob.frequency.value = 6.5;
    const wobG = ac.createGain();
    wobG.gain.value = 520;
    wob.connect(wobG);
    wobG.connect(lp.frequency);
    const osc = (type: OscillatorType, f: number, g: number, detune = 0): [OscillatorNode, GainNode] => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = f * pitch;
      o.detune.value = detune;
      const gn = ac.createGain();
      gn.gain.value = g;
      o.connect(gn);
      gn.connect(lp);
      return [o, gn];
    };
    const [saw1, g1] = osc('sawtooth', 110, 0.34);
    const [saw2, g2] = osc('sawtooth', 165, 0.2, 8);
    const [sub, g3] = osc('square', 55, 0.14);
    const crackle = ac.createBufferSource();
    crackle.buffer = this.kit.buffer('white');
    crackle.loop = true;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const am = ac.createGain();
    am.gain.value = 0.5;
    const amLfo = ac.createOscillator();
    amLfo.type = 'square';
    amLfo.frequency.value = 23;
    const amDepth = ac.createGain();
    amDepth.gain.value = 0.5;
    amLfo.connect(amDepth);
    amDepth.connect(am.gain);
    const cg = ac.createGain();
    cg.gain.value = 0.16;
    crackle.connect(hp);
    hp.connect(am);
    am.connect(cg);
    cg.connect(input);
    const sources: AudioScheduledSourceNode[] = [wob, saw1, saw2, sub, crackle, amLfo];
    for (const s of sources) s.start(now);
    return { sources, nodes: [input, lp, wobG, g1, g2, g3, hp, am, amDepth, cg] };
  }
}
