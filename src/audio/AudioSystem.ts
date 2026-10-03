/**
 * 音频系统（IAudio 实现）：全部音效与音乐均由 WebAudio 程序化合成，无任何外部素材。
 *
 * 信号流：
 *   音效 voice ─(低通?)─(声像?)─┬→ sfxDry ──────────────┐
 *                              └→ send → sfxWet ─┐      ├→ master → 压缩限幅 → 输出
 *   音乐 track ─┬→ musicDry ─────────────────────┼──────┘
 *              └→ send → musicWet ──────────────┴→ 卷积混响 → reverbOut ┘
 *
 * - unlock() 必须在用户手势里调用（可重复调用）；解锁前 play 静默忽略，setMusic 只记住曲目。
 * - 带 position 的音效按与相机距离衰减（≈40 米静音）+ 基于相机朝向的左右声像，远处 / 背后略闷。
 * - 同 id 节流（枪声除外）、同时发声上限 48（按优先级抢占最旧的）。
 * - 光束武器的 shot_beam（无 position）是一条持续嗡鸣：连续调用只刷新保持时间，停止调用后自动淡出。
 *   武器每 0.16 秒（游戏时间）调用一次；按游戏时间判断「停了」，低帧率下不会断续，暂停 / 模态 / 死亡时立即收声。
 * - 关卡肃清（stage:cleared）后战斗 / Boss 配乐交叉淡入为舒缓曲（搜刮、选门时不再擂鼓）；下一关由 Game 重新指定。
 */
import type * as THREE from 'three';
import type { GameContext, IAudio, MusicId, SfxId } from '../core/types';
import { clamp, clamp01 } from '../core/math';
import { SynthKit, type Voice } from './Synth';
import { SFX, SFX_META, SFX_POSITIONAL } from './Sfx';
import { MusicEngine } from './Music';

const MAX_VOICES = 48;
/** 超过这个距离完全听不见 */
const SILENT_DIST = 40;
/** 这个距离内不衰减 */
const NEAR_DIST = 2;
/** 音乐总线相对音量（让音效始终站在前面） */
const MUSIC_TRIM = 0.6;
/** 光束嗡鸣：超过这么久（游戏秒）没被刷新就收声（武器每 0.16 秒刷新一次） */
const BEAM_HOLD_GAME = 0.24;
/** 光束嗡鸣：真实时间保险（主循环停住 / 游戏时间不走时） */
const BEAM_HOLD_REAL = 0.45;

interface ActiveVoice {
  input: GainNode;
  chain: AudioNode[];
  end: number;
  prio: number;
  start: number;
}

interface BeamVoice {
  input: GainNode;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  release: number;
}

type AudioCtor = typeof AudioContext;

export class AudioSystem implements IAudio {
  private ac: AudioContext | null = null;
  private kit: SynthKit | null = null;
  private master: GainNode | null = null;
  private sfxDry: GainNode | null = null;
  private sfxWet: GainNode | null = null;
  private musicDry: GainNode | null = null;
  private musicWet: GainNode | null = null;
  private music: MusicEngine | null = null;
  private wantedMusic: MusicId = 'none';
  private readonly vol = { master: 0.8, sfx: 0.9, music: 0.5 };
  /** 暂停 / 模态时压低音乐 */
  private duck = 1;
  private readonly voices: ActiveVoice[] = [];
  /** 被抢占、正在快速淡出的发声 */
  private readonly dying: ActiveVoice[] = [];
  private readonly lastPlayed: Partial<Record<SfxId, number>> = {};
  /** 敌方变体音色的节流时间（与 lastPlayed 分开） */
  private readonly lastVariant: Partial<Record<SfxId, number>> = {};
  private beam: BeamVoice | null = null;
  /** 光束嗡鸣最近一次被刷新时的游戏时间 */
  private beamGameTime = 0;
  private failed = false;

  constructor(readonly ctx: GameContext) {}

  init(): void {
    const ev = this.ctx.events;
    ev.on('game:stateChanged', ({ to }) => {
      this.duck = to === 'paused' || to === 'modal' ? 0.45 : to === 'summary' ? 0.8 : 1;
      this.applyBusGains(0.25);
      // 离开 playing（暂停、模态、结算、回菜单）时光束嗡鸣立即收声
      if (to !== 'playing' && this.beam && this.ac) this.releaseBeam(this.ac.currentTime);
    });
    ev.on('stage:cleared', () => {
      if (this.wantedMusic === 'combat' || this.wantedMusic === 'boss') this.setMusic('calm');
    });
  }

  // ───────────── IAudio ─────────────

  unlock(): void {
    if (this.failed) return;
    if (!this.ac) {
      const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return;
      }
      try {
        this.ac = new Ctor({ latencyHint: 'interactive' });
        this.build(this.ac);
      } catch (err) {
        console.warn('[Audio] 无法创建 AudioContext，音频已禁用', err);
        this.failed = true;
        this.ac = null;
        return;
      }
    }
    const ac = this.ac;
    if (ac.state === 'suspended') {
      ac.resume().then(() => this.syncMusic(), () => {});
    } else {
      this.syncMusic();
    }
  }

  play(id: SfxId, opts?: { position?: THREE.Vector3; volume?: number; pitch?: number }): void {
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || !this.kit || !this.sfxDry || !this.sfxWet) return;
    const meta = SFX_META[id];
    const pos = opts?.position;
    // 带位置 = 敌方事件借用了玩家音效 id：换敌方音色，并单独节流（不和同 id 的玩家命中音互相挡）
    const variant = pos ? SFX_POSITIONAL[id] : undefined;
    const recipe = variant ?? SFX[id];
    if (!meta || !recipe) return;
    const lastMap = variant ? this.lastVariant : this.lastPlayed;
    const now = ac.currentTime;
    if (meta.throttle > 0) {
      const last = lastMap[id];
      if (last !== undefined && now - last < meta.throttle) return;
    }

    // 非有限的 volume / pitch / position 会让 AudioParam 赋值抛错（每次都进 catch 打日志）：按缺省处理 / 丢弃
    const vol = opts?.volume;
    let gain = meta.gain * (vol !== undefined && Number.isFinite(vol) ? Math.min(4, Math.max(0, vol)) : 1);
    let pan = 0;
    let lowpass = 0;
    let sendMul = 1;
    if (pos && !(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z))) return;
    if (pos) {
      const e = this.ctx.camera.matrixWorld.elements;
      const dx = pos.x - e[12], dy = pos.y - e[13], dz = pos.z - e[14];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist >= SILENT_DIST) return;
      const k = dist <= NEAR_DIST ? 1 : 1 - (dist - NEAR_DIST) / (SILENT_DIST - NEAR_DIST);
      gain *= Math.pow(k, 1.6);
      if (dist > 0.3) {
        const inv = 1 / dist;
        // 相机 x 轴 = 右方；-z 轴 = 前方
        pan = (dx * e[0] + dy * e[1] + dz * e[2]) * inv * Math.min(1, dist / 3) * 0.85;
        const front = -(dx * e[8] + dy * e[9] + dz * e[10]) * inv;
        const far = dist > 10 ? 900 + 17000 * Math.pow(1 - dist / (SILENT_DIST + 8), 2) : 20000;
        const behind = front < -0.25 ? 5500 : 20000;
        const lp = Math.min(far, behind);
        if (lp < 19000) lowpass = lp;
      }
      sendMul = 1 + dist / 18;
    }
    if (!(gain >= 0.003)) return;
    const pm = opts?.pitch;
    const pitch = clamp((pm !== undefined && Number.isFinite(pm) ? pm : 1) * (1 + (Math.random() * 2 - 1) * meta.pitch), 0.25, 4);

    // 光束持续音（玩家自己的光束武器不带 position）
    if (id === 'shot_beam' && !pos) {
      this.lastPlayed[id] = now;
      this.holdBeam(ac, gain, pitch);
      return;
    }

    this.sweep(now);
    if (this.voices.length >= MAX_VOICES && !this.steal(meta.prio, now)) return;
    // 只有真正发声才计入节流（被抢占失败丢掉的声音不应挡住下一次）
    lastMap[id] = now;

    try {
      const input = ac.createGain();
      input.gain.value = gain;
      const chain: AudioNode[] = [input];
      let head: AudioNode = input;
      if (lowpass > 0) {
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = lowpass;
        lp.Q.value = 0.5;
        head.connect(lp);
        head = lp;
        chain.push(lp);
      }
      if (pan !== 0 && typeof ac.createStereoPanner === 'function') {
        const pn = ac.createStereoPanner();
        pn.pan.value = clamp(pan, -1, 1);
        head.connect(pn);
        head = pn;
        chain.push(pn);
      }
      head.connect(this.sfxDry);
      const send = Math.min(1, meta.send * sendMul);
      if (send > 0.005) {
        const sg = ac.createGain();
        sg.gain.value = send;
        head.connect(sg);
        sg.connect(this.sfxWet);
        chain.push(sg);
      }
      // 先登记再调配方：配方中途抛错时，已经接上总线的节点也会被 sweep 回收
      const entry: ActiveVoice = { input, chain, end: now + 0.1, prio: meta.prio, start: now };
      this.voices.push(entry);
      const v: Voice = { kit: this.kit, ac, out: input, t: now + 0.004, p: pitch, end: now + 0.05 };
      recipe(v);
      entry.end = v.end + 0.05;
    } catch (err) {
      console.error('[Audio] 播放音效失败', id, err);
    }
  }

  setMusic(id: MusicId): void {
    this.wantedMusic = id;
    this.syncMusic();
  }

  applyVolumes(master: number, sfx: number, music: number): void {
    // 存档损坏时可能是 NaN / undefined：NaN 写进 AudioParam 会抛错（Game 构造时就会调用这里）
    const ok = (x: number, d: number): number => (Number.isFinite(x) ? clamp01(x) : d);
    this.vol.master = ok(master, 0.8);
    this.vol.sfx = ok(sfx, 0.9);
    this.vol.music = ok(music, 0.5);
    this.applyBusGains(0.05);
  }

  update(_dt: number): void {
    const ac = this.ac;
    if (!ac) return;
    const now = ac.currentTime;
    this.sweep(now);
    const b = this.beam;
    if (b) {
      const stale = this.ctx.game.state !== 'playing' || this.ctx.time.now - this.beamGameTime > BEAM_HOLD_GAME;
      if (stale || now > b.release) this.releaseBeam(now);
    }
  }

  // ───────────── 内部 ─────────────

  private build(ac: AudioContext): void {
    const kit = new SynthKit(ac);
    this.kit = kit;

    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 8;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    comp.connect(ac.destination);

    const master = ac.createGain();
    master.connect(comp);
    this.master = master;

    const reverb = ac.createConvolver();
    reverb.buffer = kit.makeImpulse(2.6, 2.6);
    const reverbOut = ac.createGain();
    reverbOut.gain.value = 0.85;
    reverb.connect(reverbOut);
    reverbOut.connect(master);

    this.sfxDry = ac.createGain();
    this.sfxDry.connect(master);
    this.sfxWet = ac.createGain();
    this.sfxWet.connect(reverb);
    this.musicDry = ac.createGain();
    this.musicDry.connect(master);
    this.musicWet = ac.createGain();
    this.musicWet.connect(reverb);

    this.music = new MusicEngine(kit, this.musicDry, this.musicWet);
    this.applyBusGains(0);
  }

  private syncMusic(): void {
    const ac = this.ac;
    if (!ac || !this.music || ac.state !== 'running') return;
    this.music.set(this.wantedMusic);
  }

  private applyBusGains(timeConstant: number): void {
    const ac = this.ac;
    if (!ac || !this.master || !this.sfxDry || !this.sfxWet || !this.musicDry || !this.musicWet) return;
    const now = ac.currentTime;
    const musicLevel = this.vol.music * MUSIC_TRIM * this.duck;
    const set = (p: AudioParam, v: number): void => {
      p.cancelScheduledValues(now);
      if (timeConstant <= 0) p.setValueAtTime(v, now);
      else {
        p.setValueAtTime(p.value, now);
        p.setTargetAtTime(v, now, timeConstant);
      }
    };
    set(this.master.gain, this.vol.master);
    set(this.sfxDry.gain, this.vol.sfx);
    set(this.sfxWet.gain, this.vol.sfx);
    set(this.musicDry.gain, musicLevel);
    set(this.musicWet.gain, musicLevel);
  }

  /** 回收已结束的发声 */
  private sweep(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].end < now) {
        this.disconnect(this.voices[i]);
        this.voices.splice(i, 1);
      }
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (this.dying[i].end < now) {
        this.disconnect(this.dying[i]);
        this.dying.splice(i, 1);
      }
    }
  }

  /** 抢占：淡掉优先级不高于 prio 的最旧发声；找不到返回 false（新声音被丢弃） */
  private steal(prio: number, now: number): boolean {
    let idx = -1;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.prio > prio) continue;
      if (idx < 0 || v.prio < this.voices[idx].prio || (v.prio === this.voices[idx].prio && v.start < this.voices[idx].start)) idx = i;
    }
    if (idx < 0) return false;
    const v = this.voices[idx];
    this.voices.splice(idx, 1);
    const g = v.input.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(0, now, 0.012);
    v.end = now + 0.08;
    this.dying.push(v);
    return true;
  }

  private disconnect(v: ActiveVoice): void {
    for (const n of v.chain) {
      try {
        n.disconnect();
      } catch {
        /* 已断开 */
      }
    }
  }

  // ───────────── 光束持续音 ─────────────

  private holdBeam(ac: AudioContext, gain: number, pitch: number): void {
    // 暂停 / 结算等状态下不起持续音（update 不会在这些状态里续命，起了也只会立刻收掉）
    if (this.ctx.game.state !== 'playing') return;
    const now = ac.currentTime;
    if (!this.beam) this.beam = this.createBeam(ac, pitch);
    const b = this.beam;
    this.beamGameTime = this.ctx.time.now;
    const g = b.input.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(gain * 0.6, now, 0.025);
    // 保险：若不再被调用且主循环也停了（标签页隐藏），自己淡出
    g.setTargetAtTime(0, now + BEAM_HOLD_REAL + 0.03, 0.05);
    b.release = now + BEAM_HOLD_REAL;
  }

  private createBeam(ac: AudioContext, pitch: number): BeamVoice {
    const kit = this.kit!;
    const now = ac.currentTime;
    const input = ac.createGain();
    input.gain.value = 0;
    input.connect(this.sfxDry!);
    const send = ac.createGain();
    send.gain.value = 0.12;
    input.connect(send);
    send.connect(this.sfxWet!);

    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.Q.value = 3;
    lp.connect(input);

    // 滤波器摆动 → 能量流动的「呜呜」感
    const wob = ac.createOscillator();
    wob.frequency.value = 6.5;
    const wobG = ac.createGain();
    wobG.gain.value = 520;
    wob.connect(wobG);
    wobG.connect(lp.frequency);

    const saw1 = ac.createOscillator();
    saw1.type = 'sawtooth';
    saw1.frequency.value = 110 * pitch;
    const g1 = ac.createGain();
    g1.gain.value = 0.34;
    saw1.connect(g1);
    g1.connect(lp);

    const saw2 = ac.createOscillator();
    saw2.type = 'sawtooth';
    saw2.frequency.value = 165 * pitch;
    saw2.detune.value = 8;
    const g2 = ac.createGain();
    g2.gain.value = 0.2;
    saw2.connect(g2);
    g2.connect(lp);

    const sub = ac.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 55 * pitch;
    const g3 = ac.createGain();
    g3.gain.value = 0.14;
    sub.connect(g3);
    g3.connect(lp);

    // 电弧噼啪：高通噪声 × 方波幅度调制
    const crackle = ac.createBufferSource();
    crackle.buffer = kit.buffer('white');
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
    return {
      input,
      nodes: [input, send, lp, wobG, g1, g2, g3, hp, am, amDepth, cg],
      sources,
      release: now + 0.2,
    };
  }

  private releaseBeam(now: number): void {
    const b = this.beam;
    if (!b) return;
    this.beam = null;
    const g = b.input.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(0, now, 0.05);
    for (const s of b.sources) {
      try {
        s.stop(now + 0.4);
      } catch {
        /* 已停止 */
      }
    }
    this.dying.push({ input: b.input, chain: [...b.nodes, ...b.sources], end: now + 0.45, prio: 3, start: now });
  }
}
