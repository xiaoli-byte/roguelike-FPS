/**
 * 轻量的实时合成音效播放器：检视页 / 游玩版（src/world/plateau/play）用。
 *
 * 正式游戏的 AudioSystem 挂在 GameContext 上（设置、混音总线、片段库、配乐导演），检视页没有这些；
 * 这里只取它的合成配方（Sfx.ts 的 SFX / SFX_META，片段库载入失败时正式游戏退回的也是这些），
 * 加一条总线：总音量 → 压缩器 → 输出，外加一个小房间混响（按配方的 send 量送）。
 * 浏览器要求先有用户手势：第一次 pointerdown / keydown 时才建 AudioContext，之前的 play 安静跳过。
 * 带 position 的声音按离耳朵的距离衰减、按左右声像摆位；耳朵每帧跟镜头（listen）。
 */
import * as THREE from 'three';
import type { SfxId } from '../core/types';
import { SFX, SFX_META, SFX_POSITIONAL } from './Sfx';
import { SynthKit, type Recipe, type Voice } from './Synth';

export interface SynthPlayOpts {
  /** 发声位置（世界坐标）；不给 = 就在耳边（玩家自己的声音） */
  position?: THREE.Vector3;
  /** 音量倍率 */
  volume?: number;
  /** 音高倍率（再叠配方自带的随机音高） */
  pitch?: number;
  /** 随机音高幅度（±），缺省 0.06 */
  jitter?: number;
  /** 混响发送量 0..1 */
  send?: number;
  /** 距离衰减的参考距离（m）：这么远时音量减半，缺省 12 */
  ref?: number;
}

const _to = new THREE.Vector3();
const _right = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class SynthPlayer {
  /** 总音量（0 = 静音） */
  volume = 0.8;
  private ac_: AudioContext | null = null;
  private kit_: SynthKit | null = null;
  private master: GainNode | null = null;
  private reverbIn: GainNode | null = null;
  private readonly ear = new THREE.Vector3();
  private readonly earRight = new THREE.Vector3(1, 0, 0);
  private readonly lastPlayed = new Map<string, number>();
  private readonly readyHooks: ((p: SynthPlayer) => void)[] = [];

  constructor() {
    const start = (): void => this.start();
    addEventListener('pointerdown', start);
    addEventListener('keydown', start);
  }

  /** AudioContext 已经建好并在跑 */
  get ready(): boolean { return !!this.ac_ && this.ac_.state === 'running'; }
  get ac(): AudioContext | null { return this.ac_; }
  get kit(): SynthKit | null { return this.kit_; }
  /** 总线入口（循环声直接接这里） */
  get out(): AudioNode | null { return this.master; }

  /** 声音系统起来时回调一次（已经起来就马上调）：循环声在这里建 */
  onReady(fn: (p: SynthPlayer) => void): void {
    if (this.ac_) fn(this); else this.readyHooks.push(fn);
  }

  private start(): void {
    if (this.ac_) {
      if (this.ac_.state === 'suspended') void this.ac_.resume();
      return;
    }
    try {
      const ac = new AudioContext();
      this.ac_ = ac;
      this.kit_ = new SynthKit(ac);
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
      this.master = ac.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(comp);
      comp.connect(ac.destination);
      // 小房间混响：衰减的双声道噪声当脉冲响应（高原上是开阔地，混响短而淡）
      const conv = ac.createConvolver();
      conv.buffer = roomImpulse(ac, 1.3);
      this.reverbIn = ac.createGain();
      this.reverbIn.gain.value = 0.55;
      this.reverbIn.connect(conv);
      conv.connect(this.master);
      for (const fn of this.readyHooks.splice(0)) fn(this);
    } catch { /* 没有 WebAudio：不出声 */ }
  }

  /** 每帧：耳朵跟着镜头 */
  listen(camera: THREE.Camera): void {
    camera.getWorldPosition(this.ear);
    this.earRight.set(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(_q));
    if (this.master && this.ac_) this.master.gain.setTargetAtTime(this.volume, this.ac_.currentTime, 0.05);
  }

  /** 正式游戏音效表里的一个（枪声、命中、跳、落地……），按 SFX_META 的音量 / 随机音高 / 节流 / 混响 */
  play(id: SfxId, opts: SynthPlayOpts = {}): void {
    const meta = SFX_META[id];
    if (!meta) return;
    const now = this.ac_?.currentTime ?? 0;
    const last = this.lastPlayed.get(id);
    if (meta.throttle > 0 && last !== undefined && now - last < meta.throttle) return;
    const recipe = (opts.position ? SFX_POSITIONAL[id] : undefined) ?? SFX[id];
    if (!recipe) return;
    if (this.playRecipe(recipe, { ...opts, volume: meta.gain * (opts.volume ?? 1), jitter: opts.jitter ?? meta.pitch, send: opts.send ?? meta.send })) {
      this.lastPlayed.set(id, now);
    }
  }

  /** 任意合成配方；返回是否真的出了声（没起来 / 太远听不见 = false） */
  playRecipe(recipe: Recipe, opts: SynthPlayOpts = {}): boolean {
    const ac = this.ac_, kit = this.kit_, master = this.master;
    if (!ac || !kit || !master || ac.state !== 'running' || this.volume <= 0) return false;
    let gain = opts.volume ?? 1, pan = 0;
    if (opts.position) {
      const d = _to.subVectors(opts.position, this.ear).length();
      gain *= 1 / (1 + d / (opts.ref ?? 12));
      if (gain < 0.02) return false;
      _right.copy(this.earRight).setY(0);
      if (d > 0.5 && _right.lengthSq() > 1e-6) pan = THREE.MathUtils.clamp(_to.normalize().dot(_right.normalize()), -1, 1) * 0.75;
    }
    const now = ac.currentTime;
    const out = ac.createGain();
    out.gain.value = gain;
    const panner = ac.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner);
    panner.connect(master);
    let send: GainNode | null = null;
    if ((opts.send ?? 0) > 0 && this.reverbIn) {
      send = ac.createGain();
      send.gain.value = opts.send!;
      panner.connect(send);
      send.connect(this.reverbIn);
    }
    const jitter = opts.jitter ?? 0.06;
    const v: Voice = { kit, ac, out, t: now + 0.003, p: (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * jitter), end: now };
    try {
      recipe(v);
    } catch (err) {
      console.error('[SynthPlayer] 合成失败', err);
    }
    const life = Math.max(0.1, v.end - now) * 1000 + 300;
    setTimeout(() => { out.disconnect(); panner.disconnect(); send?.disconnect(); }, life);
    return true;
  }
}

function roomImpulse(ac: AudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 80 ? i / 80 : 1);
    }
  }
  return buf;
}
