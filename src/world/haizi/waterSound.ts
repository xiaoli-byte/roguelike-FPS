/**
 * 4-4 神山海子的水声：涉水的一步、落水、跳出水、冲刺甩水、子弹打水、大冲击砸进湖里（落雷、龙爪、雷神身段出入水），
 * 加上走到湖边听得见的轻轻拍岸声。
 *
 * 配方用 src/audio/Synth.ts 的合成构件现场合成，经 src/audio/SynthPlayer.ts 播放（和检视页的枪声、脚步同一条总线）。
 * 脚下的声音不摆位；子弹打水、大冲击按距离衰减、按左右声像摆位。
 */
import * as THREE from 'three';
import type { SynthPlayer } from '../../audio/SynthPlayer';
import { noise, rnd, tone, type Voice } from '../../audio/Synth';

export type WaterSoundKind = 'step' | 'land' | 'out' | 'dash' | 'bullet' | 'boom';

export class WaterSound {
  private lapGain: GainNode | null = null;
  private lapTime = 0;
  private lastBullet = 0;
  private bulletBurst = 0;

  constructor(private readonly player: SynthPlayer) {
    player.onReady(p => this.startLapping(p));
  }

  /** 发一声。at：发声位置；k：力度 0..1（水深、落水速度；boom 是冲击大小） */
  play(kind: WaterSoundKind, at: THREE.Vector3, k = 1): void {
    const ac = this.player.ac;
    if (!ac) return;
    if (kind === 'bullet') {
      // 自动步枪一秒 9 发：同一小段时间里的弹着水声压一压，不然糊成一片
      const now = ac.currentTime;
      this.bulletBurst = now - this.lastBullet < 0.25 ? this.bulletBurst + 1 : 0;
      this.lastBullet = now;
      if (this.bulletBurst > 2 && Math.random() < 0.4) return;
    }
    const far = kind === 'bullet' || kind === 'boom';
    const kk = THREE.MathUtils.clamp(k, 0, 1);
    this.player.playRecipe(v => RECIPES[kind](v, kk), {
      position: far ? at : undefined, ref: kind === 'boom' ? 28 : 10, jitter: 0.08, send: kind === 'boom' ? 0.35 : 0.08,
    });
  }

  /** 拍岸声：near = 0（离水远）..1（站在水边 / 水里），每帧调 */
  shore(dt: number, near: number): void {
    const ac = this.player.ac;
    if (!ac || !this.lapGain) return;
    this.lapTime += dt;
    const t = this.lapTime;
    // 两个慢周期叠起来：一下一下不规则地拍
    const wave = Math.max(0, Math.sin(t * 2.3) * 0.6 + Math.sin(t * 1.37 + 1.3) * 0.5 + 0.15);
    this.lapGain.gain.setTargetAtTime(near * (0.05 + 0.16 * wave), ac.currentTime, 0.12);
  }

  private startLapping(p: SynthPlayer): void {
    const ac = p.ac!, kit = p.kit!, out = p.out!;
    const src = ac.createBufferSource();
    src.buffer = kit.buffer('pink');
    src.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.7;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    this.lapGain = ac.createGain();
    this.lapGain.gain.value = 0;
    src.connect(bp); bp.connect(lp); lp.connect(this.lapGain); this.lapGain.connect(out);
    src.start();
  }
}

/** 几颗水珠落回水面的「滴答」：短促的上滑正弦 */
function drips(v: Voice, n: number, from: number, to: number, gain: number): void {
  for (let i = 0; i < n; i++) {
    const f = rnd(800, 2300);
    tone(v, { f, f2: f * rnd(1.3, 1.7), sweep: 0.025, dur: rnd(0.025, 0.05), gain: gain * rnd(0.5, 1), at: rnd(from, to) });
  }
}

const RECIPES: Record<WaterSoundKind, (v: Voice, k: number) => void> = {
  // 涉水一步：哗的一下（带通噪声往下扫）+ 水面拍击的嘶声 + 水深时一声低沉的「咕」+ 几颗水珠
  step(v, deep) {
    noise(v, { color: 'pink', filter: 'bandpass', f: 1000, f2: 480, sweep: 0.16, q: 0.8, dur: 0.24, gain: 0.32 + 0.3 * deep, attack: 0.005 });
    noise(v, { color: 'white', hp: 2600, dur: 0.12, gain: 0.08 + 0.06 * deep, at: 0.008, attack: 0.004 });
    if (deep > 0.3) tone(v, { f: 210, f2: 95, sweep: 0.08, dur: 0.1, gain: 0.14 * deep, at: 0.02 });
    drips(v, 2 + Math.round(deep * 2), 0.06, 0.28, 0.04);
  },
  // 落水：闷响 + 一大片水花声往下收 + 拍击的嘶声 + 一阵水珠落回来的滴答
  land(v, k) {
    tone(v, { f: 120, f2: 42, sweep: 0.2, dur: 0.3, gain: 0.35 + 0.3 * k });
    noise(v, { color: 'brown', filter: 'lowpass', f: 2400, f2: 380, sweep: 0.6, q: 0.5, dur: 0.75, gain: 0.55 + 0.35 * k, attack: 0.006 });
    noise(v, { color: 'white', filter: 'bandpass', f: 3200, q: 0.6, dur: 0.4, gain: 0.2 + 0.15 * k, attack: 0.004 });
    drips(v, 10 + Math.round(12 * k), 0.25, 1.1, 0.05);
  },
  // 从水里跳出来：腿上带起的水哗一下，再滴答几声
  out(v) {
    noise(v, { color: 'pink', filter: 'bandpass', f: 1300, f2: 700, sweep: 0.15, q: 0.7, dur: 0.2, gain: 0.22, attack: 0.01 });
    drips(v, 5, 0.18, 0.6, 0.035);
  },
  // 冲刺：哗地一道往上扫 + 甩出去的水雾嘶声
  dash(v, deep) {
    noise(v, { color: 'pink', filter: 'bandpass', f: 450, f2: 2200, sweep: 0.22, q: 0.9, dur: 0.34, gain: 0.38 + 0.2 * deep, attack: 0.02 });
    noise(v, { color: 'white', hp: 3400, dur: 0.4, gain: 0.13, attack: 0.04, at: 0.04 });
    drips(v, 4, 0.2, 0.55, 0.035);
  },
  // 大冲击砸进湖里（落雷、龙爪、雷神身段出入水）：很低的闷响 + 一大片水墙塌下来的轰响 + 水雾嘶声 + 一阵密集的水珠落回
  boom(v, k) {
    tone(v, { f: 75, f2: 32, sweep: 0.35, dur: 0.5, gain: 0.5 + 0.3 * k });
    noise(v, { color: 'brown', filter: 'lowpass', f: 1600, f2: 260, sweep: 0.9, q: 0.5, dur: 1.2, gain: 0.7 + 0.2 * k, attack: 0.01 });
    noise(v, { color: 'pink', filter: 'bandpass', f: 2400, f2: 900, sweep: 0.6, q: 0.5, dur: 0.8, gain: 0.25 + 0.15 * k, attack: 0.02, at: 0.05 });
    drips(v, 16 + Math.round(14 * k), 0.4, 1.6, 0.05);
  },
  // 子弹打水：「嗤」的一下脆响 + 一声往下掉的「噗」+ 小水花
  bullet(v, k) {
    noise(v, { color: 'white', hp: 2800, dur: 0.035, gain: 0.3 * (0.6 + 0.4 * k), attack: 0.001 });
    tone(v, { f: 1500, f2: 420, sweep: 0.06, dur: 0.09, gain: 0.12, at: 0.004 });
    noise(v, { color: 'pink', filter: 'bandpass', f: 1600, q: 0.8, dur: 0.18, gain: 0.14 * (0.5 + 0.5 * k), at: 0.01 });
    if (Math.random() < 0.6) drips(v, 2, 0.12, 0.4, 0.03);
  },
};
