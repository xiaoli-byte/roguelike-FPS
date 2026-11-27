/**
 * 音频系统（IAudio 实现）：播烘好的 ogg（public/assets/audio，audio-bake.html 渲 + scripts/audio/bake.py 转），行为照 Unity 的
 * GameAudio / AudioDuck / AudioOcclusion / MusicDirector / AmbienceDirector 一比一照译（规则和常数在 AudioRules.ts）。
 *
 * 混音台（AudioMixer.ts，照 Spiritfire.mixer）：Master（限幅）→ World（暂停 / 模态快照 0.45 + 6 kHz 低通、结算 0.8）
 *   → SFX（推子后发送 → Reverb）/ Music / Ambience / Reverb；UI 直接挂 Master（按钮音不被暂停压低）。
 *   玩家音量（主 / 音效 / 音乐 / 环境 / 界面）在各自的推子上；清单 mix 的基础电平（音效 0.9 × 主 0.8、音乐 0.3 × 0.8）乘在声道上。
 *
 * 音效（GameAudio.PlayInternal）：
 *   · 不带位置 = 玩家自己的声音；带位置 = 世界里的，有敌方音色（<id>@enemy_*）时用敌方音色，敌方音色单独节流
 *   · 同 id 节流（meta.throttle，只有真正发声才计入）、48 声道（满了抢占优先级不高于它的里面最低、最旧的）
 *   · 密集音（burn_tick / corrode_tick / shock_zap）：同时最多 3 声 + 最小间隔 + 叠声 × 1 / (1 + 0.35k)
 *   · 带位置：40 m 外不发、2 m 内不衰减、k^1.6；遮挡（相机到声源一条射线，ctx.world.raycast）→ 1.4 kHz 低通、× 0.7；
 *     近处声像收窄（pan × min(1, dist/3) × 0.85）；10 m 外渐闷、背后 5.5 kHz
 *   · 分层（I6，关键枪声 / 爆炸）：瞬态 / 主体 / 尾音三层各挑一个变体同时放，按距离配比（LayerGain），音高各自再抖 ±1.5%
 *   · 随机音高 ±meta.pitch；声道音量上限 1（AudioSource.volume）
 *   · 光束（玩家的 shot_beam，不带位置）：无缝循环片段 shot_beam_loop，每次开火刷新，0.24 s（游戏时间）没刷新就淡出
 * 配乐：交叉淡化（旧曲淡出 1.6 s、新曲淡入 1.3 s），曲目是无缝循环的 ogg，按需解码；选曲见 MusicDirector（有遭遇战的关卡里
 *   交战 → combat、首领在场 → boss / 旱魃 boss_hanba、其余 calm）。
 * 声床 + 混响（AmbienceDirector）：每章一条循环声床走 Ambience 总线（进关 2.5 s 淡入、阵亡压到 0.35）；SFX → Reverb 的发送按章节给底
 *   （沙寺 −20 / 霜山 −12 / 熔火 −10 dB，封闭的关卡 +5，局部混响区再加），20 dB/s 平滑；回菜单关掉。
 *
 * 退路（二选一选的是「退回合成」，不是 Unity 的静音）：清单读不到 → 全部走老的实时合成配方（SynthFallback）；
 *   某个 id 的片段全都载入失败 → 这个 id 走合成；曲目同理；声床没有实时版 → 静音并警告一次。
 *   清单还在路上、或某一声的片段还没解码好：跳过这一声（不等、不卡）。
 * unlock() 必须在用户手势里调用（可重复调用）；解锁前 play 静默忽略，setMusic 只记住曲目。
 */
import * as THREE from 'three';
import type { GameContext, IAudio, MusicId, SfxId } from '../core/types';
import { AudioBank, type SfxEntry } from './AudioBank';
import { AudioMixer, lowpassQDb, type PlayerVolumes } from './AudioMixer';
import * as R from './AudioRules';
import { SFX_META } from './Sfx';
import { isSynthMusic } from './Music';
import { SynthFallback } from './SynthFallback';
import { UISound } from './UISound';

type AudioCtor = typeof AudioContext;

interface VoiceSlot {
  index: number;
  /** 片段声道的源（合成声道 = null，配方自己的源各自停） */
  src: AudioBufferSourceNode | null;
  /** 声道推子；null = 空闲 */
  gain: GainNode | null;
  nodes: AudioNode[];
  id: string;
  prio: number;
  start: number;
  end: number;
}

interface MusicTrack {
  id: string;
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  /** vol 在 volAt 时刻的值；之后按 rate 线性走向 target（= Mathf.MoveTowards 每帧 dt × rate，用 AudioParam 斜坡排好，不依赖帧） */
  vol: number;
  volAt: number;
  target: number;
  rate: number;
}

interface Beam {
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  synth: { sources: AudioScheduledSourceNode[]; nodes: AudioNode[] } | null;
  vol: number;
}

interface Bed {
  id: string;
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  vol: number;
}

/** 调试：最近发出的声音 */
interface EmitLog {
  id: string;
  bus: 'sfx' | 'ui';
  positional: boolean;
  enemy: boolean;
  layer: number;
  synth: boolean;
  clip: string;
  gain: number;
  lowpass: number;
  pan: number;
  pitch: number;
  occluded: boolean;
  t: number;
}

const OFF = R.REVERB_SEND_OFF;
/** 光束的真实时间保险：主循环停住（标签页隐藏、调试局不暂停）时 0.45 s 后自己淡掉 */
const BEAM_SAFETY = 0.45;

const _ray = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _hit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as unknown };

export class AudioSystem implements IAudio {
  private ac: AudioContext | null = null;
  private mixer: AudioMixer | null = null;
  private synth: SynthFallback | null = null;
  readonly bank: AudioBank;
  private failed = false;
  private readonly voices: VoiceSlot[] = [];
  private readonly dying: { nodes: AudioNode[]; end: number }[] = [];
  private readonly lastPlayed = new Map<string, number>();
  private readonly lastEnemy = new Map<string, number>();
  private readonly warned = new Set<string>();
  private mix: { master: number; sfx: number; music: number } = { ...R.DEFAULT_MIX };
  private readonly volumes: PlayerVolumes = { master: 1, sfx: 1, music: 1, ambience: 1, ui: 1 };
  // 光束
  private beam: Beam | null = null;
  private beamHeld = -1;
  private beamTargetVol = 0;
  // 配乐
  private musicWanted = 'none';
  private musicId = 'none';
  private readonly tracks: MusicTrack[] = [];
  private directorNext = 0;
  // 声床 + 混响
  private bed: Bed | null = null;
  private bedWanted: string | null = null;
  private ambStage: { chapter: number; map: string } | null = null;
  private sendDb = OFF;
  private lastReal = 0;
  /** 调试统计 */
  private readonly stats = { emitted: 0, sfxBus: 0, uiBus: 0, synth: 0, skippedPending: 0, skippedLoading: 0, throttled: 0, dense: 0, occluded: 0, stolen: 0 };
  private readonly log: EmitLog[] = [];

  constructor(readonly ctx: GameContext) {
    this.bank = new AudioBank(() => this.ac);
  }

  init(): void {
    const ev = this.ctx.events;
    // 清单和全部音效片段现在就开始下载、解码（离线上下文，不等用户手势）
    this.bank.load().then(() => {
      const m = this.bank.manifest;
      if (m?.mix) this.mix = { ...R.DEFAULT_MIX, ...m.mix };
      // 主菜单的曲子先解（开局第一首）
      if (this.bank.state === 'ready') void this.bank.musicBuffer('menu');
      // 清单到之前要过的配乐：现在补上
      if (this.ac?.state === 'running' && this.mixer) this.applyMusic(this.musicWanted);
    }, () => {});
    // 压低（AudioDuck）：状态 → 快照，过渡 0.3 s
    ev.on('game:stateChanged', ({ to }) => {
      this.mixer?.transitionTo(R.snapshotFor(to), R.DUCK_TRANSITION);
      // 离开关卡回主菜单：声床停、混响发送关（AmbienceDirector.OnDisable）
      if (to === 'menu') this.leaveStage();
    });
    ev.on('stage:loaded', ({ stage }) => {
      this.mixer?.transitionTo(R.snapshotFor(this.ctx.game.state), 0);
      const map = stage.map ?? `${stage.chapter + 1}-${stage.index + 1}`;
      const chapter = R.chapterOf(map, stage.chapter + 1);
      this.ambStage = { chapter, map };
      this.sendDb = OFF;
      this.startBed(R.bedFor(chapter));
    });
    // 关卡肃清：战斗 / 首领配乐交叉淡入舒缓曲（搜刮、选门时不再擂鼓；有遭遇战的关卡由选曲规则得出同样结果）
    ev.on('stage:cleared', () => {
      if (this.musicWanted === 'combat' || this.musicWanted === 'boss' || this.musicWanted === 'boss_hanba') this.setMusicId('calm');
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
        console.warn('[Audio] 浏览器没有 WebAudio，静音运行');
        return;
      }
      try {
        // 片段是 44.1 kHz：播放上下文同采样率，声源不重采样（输出时浏览器统一转到设备采样率）
        try {
          this.ac = new Ctor({ latencyHint: 'interactive', sampleRate: this.bank.manifest?.sampleRate ?? 44100 });
        } catch {
          this.ac = new Ctor({ latencyHint: 'interactive' });
        }
        this.build(this.ac);
      } catch (err) {
        console.warn('[Audio] 无法创建 AudioContext，音频已禁用', err);
        this.failed = true;
        this.ac = null;
        return;
      }
    }
    const ac = this.ac;
    if (ac.state === 'suspended') ac.resume().then(() => this.onRunning(), () => {});
    else this.onRunning();
  }

  play(id: SfxId, opts?: { position?: THREE.Vector3; volume?: number; pitch?: number }): void {
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || !this.mixer) return;
    try {
      this.playInternal(id, opts?.position, opts?.volume, opts?.pitch);
    } catch (err) {
      console.error('[Audio] 播放音效失败', id, err);
    }
  }

  setMusic(id: MusicId): void {
    this.setMusicId(id);
  }

  uiClick(button: HTMLElement): void {
    UISound.click(this.ctx, button);
  }

  uiHover(button: HTMLElement): void {
    UISound.hover(this.ctx, button);
  }

  applyVolumes(master: number, sfx: number, music: number): void {
    // 存档损坏时可能是 NaN / undefined：按缺省 1（Unity GameSettings 的缺省）
    const ok = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? R.clamp01(x) : 1);
    // 环境音 / 界面音：IAudio.applyVolumes 只带前三档，另外两档直接读设置（老存档没有这两个字段时 loadSettings 补缺省 1）
    const s = this.ctx.settings;
    this.volumes.master = ok(master);
    this.volumes.sfx = ok(sfx);
    this.volumes.music = ok(music);
    this.volumes.ambience = ok(s.ambienceVolume);
    this.volumes.ui = ok(s.uiVolume);
    this.mixer?.setVolumes(this.volumes);
  }

  update(_dt: number): void {
    const real = performance.now() / 1000;
    const rdt = this.lastReal > 0 ? Math.min(0.25, Math.max(0, real - this.lastReal)) : 0;
    this.lastReal = real;
    const ac = this.ac;
    if (!ac || !this.mixer) return;
    const now = ac.currentTime;
    this.sweep(now);
    this.updateBeam(now, rdt);
    this.updateMusic(now);
    if (real >= this.directorNext) {
      this.directorNext = real + R.MUSIC_POLL;
      this.directMusic();
    }
    this.updateAmbience(now, rdt);
  }

  // ───────────── 搭建 ─────────────

  private build(ac: AudioContext): void {
    this.mixer = new AudioMixer(ac);
    this.mixer.setVolumes(this.volumes);
    this.mixer.transitionTo(R.snapshotFor(this.ctx.game?.state ?? 'menu'), 0);
    for (let i = 0; i < R.MAX_VOICES; i++) this.voices.push({ index: i, src: null, gain: null, nodes: [], id: '', prio: 0, start: 0, end: 0 });
  }

  private onRunning(): void {
    if (!this.ac || this.ac.state !== 'running') return;
    this.applyMusic(this.musicWanted);
    if (this.bedWanted && !this.bed) this.startBed(this.bedWanted);
    for (const fn of this.ambienceWaiters.splice(0)) fn({ ac: this.ac, out: this.mixer?.ambience ?? null });
  }

  private readonly ambienceWaiters: ((p: { ac: AudioContext | null; out: AudioNode | null }) => void)[] = [];

  /**
   * 实时环境声床（audio/AmbienceBed.ts，第四章网页原生高原场景用）接 Ambience 总线：声音系统跑起来时回调一次（已经在跑就马上调）。
   * 和烘好的章节声床走同一条总线、同一个音量推子
   */
  ambiencePort(): { onReady(fn: (p: { ac: AudioContext | null; out: AudioNode | null }) => void): void } {
    return {
      onReady: fn => {
        if (this.ac && this.ac.state === 'running' && this.mixer) fn({ ac: this.ac, out: this.mixer.ambience });
        else this.ambienceWaiters.push(fn);
      },
    };
  }

  private fallback(): SynthFallback {
    this.synth ??= new SynthFallback(this.ac!, this.mixer!.music, R.musicBusLevel(this.mix));
    return this.synth;
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(msg);
  }

  // ───────────── 音效（GameAudio.PlayInternal） ─────────────

  private playInternal(id: string, at: THREE.Vector3 | undefined, volumeIn?: number, pitchIn?: number): void {
    const ac = this.ac!;
    const mixer = this.mixer!;
    const bankState = this.bank.state;
    if (bankState === 'idle' || bankState === 'loading') {
      // 清单还在路上：跳过这一声
      this.stats.skippedLoading++;
      return;
    }
    const positional = at !== undefined;
    const def = bankState === 'ready' ? this.bank.defs.get(id) : undefined;
    // 片段可用 = 清单里有、没有载入失败；全都失败 / 清单里没有 → 合成配方
    const usable = (names: readonly string[]): string[] => names.filter(n => !this.bank.failed.has(n));
    let synth = false;
    let enemy = false;
    let list: string[] = [];
    let layers: [string[], string[], string[]] | null = null;
    let meta: SfxEntry | undefined = def?.meta;
    if (def) {
      const enemyClips = usable(def.enemy);
      enemy = positional && enemyClips.length > 0;
      list = enemy ? enemyClips : usable(def.clips);
      if (def.layers && !enemy) {
        const ls = def.layers.map(usable) as [string[], string[], string[]];
        if (ls[0].length > 0 && ls[1].length > 0 && ls[2].length > 0) layers = ls;
      }
      if (list.length === 0 && !layers && !(id === 'shot_beam' && !positional)) synth = true;
    } else {
      synth = true;
    }
    if (synth) {
      const sm = SFX_META[id as SfxId];
      const fb = this.synth ?? (sm ? this.fallback() : null);
      if (!sm || !fb?.has(id, positional)) {
        this.warnOnce(id, `[Audio] 没有音效 ${id}`);
        return;
      }
      if (bankState === 'ready') this.warnOnce(`synth:${id}`, `[Audio] 音效 ${id} 的片段载入失败，退回实时合成`);
      meta ??= { id, variants: 0, enemyVariants: 0, gain: sm.gain, pitch: sm.pitch, throttle: sm.throttle, send: sm.send, prio: sm.prio };
      enemy = positional && fb.hasEnemyVariant(id);
    }
    if (!meta) return;

    const lastMap = enemy ? this.lastEnemy : this.lastPlayed;
    const now = ac.currentTime;
    const last = lastMap.get(id);
    if (meta.throttle > 0 && last !== undefined && now - last < meta.throttle) {
      this.stats.throttled++;
      return;
    }
    const volume = R.sanitizeVolume(volumeIn);
    const ui = R.isUiSound(id);
    const sfxBus = R.sfxBusLevel(this.mix);
    let gain = volume * sfxBus;
    if (R.DENSE[id]) {
      const since = last !== undefined ? now - last : 999;
      const d = R.denseAllow(id, this.liveVoices(id, now), since);
      if (!d.allow) {
        this.stats.dense++;
        return;
      }
      gain *= d.gain;
    }
    let lowpass = 0, pan = 0, dist = 0, k = 1, occl = 1, occluded = false;
    const raw = gain;
    if (at) {
      if (!(Number.isFinite(at.x) && Number.isFinite(at.y) && Number.isFinite(at.z))) return;
      const e = this.ctx.camera.matrixWorld.elements;
      const dx = at.x - e[12], dy = at.y - e[13], dz = at.z - e[14];
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist >= R.SILENT_DIST) return;
      k = R.distanceK(dist);
      gain *= R.distanceGain(k);
      // 遮挡（I6）：隔着地形 / 建筑发闷、轻一点
      if (this.occluded(e[12], e[13], e[14], dx, dy, dz, dist)) {
        const o = R.applyOcclusion(lowpass, occl);
        lowpass = o.lowpass;
        occl = o.gain;
        gain *= occl;
        occluded = true;
        this.stats.occluded++;
      }
      if (dist > 0.3) {
        const inv = 1 / dist;
        // 相机 x 轴 = 右方；−z 轴 = 前方（Unity listener.forward）
        const blend = R.panBlend(dist);
        pan = (dx * e[0] + dy * e[1] + dz * e[2]) * inv * blend;
        const front = -(dx * e[8] + dy * e[9] + dz * e[10]) * inv;
        lowpass = R.mergeLowpass(lowpass, R.spatialLowpass(dist, front));
      }
    }
    if (!(gain >= R.MIN_GAIN)) return;
    const pitch = R.sanitizePitch(pitchIn);
    const p = R.voicePitch(pitch, Math.random() * 2 - 1, meta.pitch);

    // 玩家自己的光束武器（不带位置）走持续音
    if (id === 'shot_beam' && !positional) {
      lastMap.set(id, now);
      this.holdBeam(volume, pitch);
      return;
    }
    const bus = ui ? mixer.ui : mixer.sfx;
    // 分层（I6）：三层各挑一个变体同时放，按距离配比；音高各自再抖 ±1.5%
    if (layers && !synth) {
      let any = false;
      for (let layer = 0; layer < 3; layer++) {
        const lg = raw * occl * (positional ? R.layerGain(layer, dist, k) : 1);
        if (!(lg >= R.MIN_GAIN)) continue;
        const name = this.pickReady(layers[layer]);
        if (!name) {
          this.stats.skippedPending++;
          continue;
        }
        const v = this.freeVoice(meta.prio, now);
        if (!v) break;
        const lp = R.layerPitch(p, (Math.random() * 2 - 1) * R.LAYER_PITCH_JITTER);
        this.emitClip(v, id, name, bus, lp, lg, pan, lowpass, meta.prio, now);
        this.record(id, ui, positional, enemy, layer, false, name, lg, lowpass, pan, lp, occluded, now);
        any = true;
      }
      if (any) lastMap.set(id, now);
      return;
    }
    let name = '';
    if (!synth) {
      name = this.pickReady(list) ?? '';
      if (!name) {
        // 片段还没解码好：跳过这一声
        this.stats.skippedPending++;
        return;
      }
    }
    const v = this.freeVoice(meta.prio, now);
    if (!v) return;
    // 只有真正发声才计入节流
    lastMap.set(id, now);
    if (synth) this.emitSynth(v, id, positional, bus, p, gain, pan, lowpass, meta.prio, now);
    else this.emitClip(v, id, name, bus, p, gain, pan, lowpass, meta.prio, now);
    this.record(id, ui, positional, enemy, -1, synth, name, gain, lowpass, pan, p, occluded, now);
  }

  /** 遮挡（AudioOcclusion.Blocked）：听者 → 声源之间被世界几何挡住；3 m 内不算，首尾各让开 0.4 m */
  private occluded(lx: number, ly: number, lz: number, dx: number, dy: number, dz: number, dist: number): boolean {
    if (dist < R.OCCLUSION_MIN_DIST) return false;
    const world = this.ctx.world as { raycast?: (o: THREE.Vector3, d: THREE.Vector3, max: number, out?: unknown) => unknown } | undefined;
    if (!world?.raycast) return false;
    const inv = 1 / dist;
    _ray.set(dx * inv, dy * inv, dz * inv);
    _origin.set(lx, ly, lz).addScaledVector(_ray, R.OCCLUSION_INSET);
    try {
      return world.raycast(_origin, _ray, dist - 2 * R.OCCLUSION_INSET, _hit) !== null;
    } catch {
      return false;
    }
  }

  /** 随机挑一个已解码的变体（没有 = 还在解码） */
  private pickReady(names: readonly string[]): string | null {
    const ready = names.filter(n => this.bank.clip(n));
    return ready.length ? ready[Math.floor(Math.random() * ready.length)] : null;
  }

  private playing(v: VoiceSlot, now: number): boolean {
    return v.gain !== null && now < v.end;
  }

  private liveVoices(id: string, now: number): number {
    let n = 0;
    for (const v of this.voices) if (v.id === id && this.playing(v, now)) n++;
    return n;
  }

  /** 空闲声道；满了抢占优先级不高于它的里面最低、最旧的（GameAudio.FreeVoice） */
  private freeVoice(prio: number, now: number): VoiceSlot | null {
    let best: VoiceSlot | null = null;
    for (const v of this.voices) {
      if (!this.playing(v, now)) return v;
      if (v.prio > prio) continue;
      if (!best || v.prio < best.prio || (v.prio === best.prio && v.start < best.start)) best = v;
    }
    if (best) this.stats.stolen++;
    return best;
  }

  /** 停掉一个声道（抢占）：8 ms 淡出防爆音，节点交给 sweep 断开 */
  private stopVoice(v: VoiceSlot, now: number): void {
    if (!v.gain) return;
    const g = v.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 0.008);
    if (v.src) {
      try {
        v.src.stop(now + 0.012);
      } catch {
        /* 已停 */
      }
    }
    this.dying.push({ nodes: v.nodes, end: now + 0.06 });
    v.gain = null;
    v.src = null;
    v.nodes = [];
  }

  /** 声道链：推子（音量上限 1）→ 低通（有才接）→ 声像（有才接）→ 总线 */
  private chain(v: VoiceSlot, bus: AudioNode, gain: number, pan: number, lowpass: number): GainNode {
    const ac = this.ac!;
    const g = ac.createGain();
    g.gain.value = R.voiceVolume(gain);
    const nodes: AudioNode[] = [g];
    let head: AudioNode = g;
    if (lowpass > 0) {
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(lowpass, ac.sampleRate * 0.4995);
      lp.Q.value = lowpassQDb(R.VOICE_LOWPASS_Q);
      head.connect(lp);
      head = lp;
      nodes.push(lp);
    }
    if (pan !== 0 && typeof ac.createStereoPanner === 'function') {
      const pn = ac.createStereoPanner();
      pn.pan.value = R.clamp(pan, -1, 1);
      head.connect(pn);
      head = pn;
      nodes.push(pn);
    }
    head.connect(bus);
    v.gain = g;
    v.nodes = nodes;
    return g;
  }

  private emitClip(v: VoiceSlot, id: string, name: string, bus: AudioNode, p: number, gain: number, pan: number, lowpass: number, prio: number, now: number): void {
    const buf = this.bank.clip(name)!;
    this.stopVoice(v, now);
    const g = this.chain(v, bus, gain, pan, lowpass);
    const src = this.ac!.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = p;
    src.connect(g);
    src.start(now);
    v.src = src;
    v.nodes.push(src);
    v.id = id;
    v.prio = prio;
    v.start = now;
    v.end = now + buf.duration / p;
    this.stats.emitted++;
    if (bus === this.mixer!.ui) this.stats.uiBus++;
    else this.stats.sfxBus++;
  }

  private emitSynth(v: VoiceSlot, id: string, positional: boolean, bus: AudioNode, p: number, gain: number, pan: number, lowpass: number, prio: number, now: number): void {
    const fb = this.fallback();
    this.stopVoice(v, now);
    // 合成配方没有烘进基础音量：乘 meta.gain
    const g = this.chain(v, bus, gain * fb.baseGain(id), pan, lowpass);
    v.id = id;
    v.prio = prio;
    v.start = now;
    v.end = fb.play(id, positional, g, now, p);
    this.stats.emitted++;
    this.stats.synth++;
    if (bus === this.mixer!.ui) this.stats.uiBus++;
    else this.stats.sfxBus++;
  }

  /** 回收已结束的声道和被抢占的尾巴 */
  private sweep(now: number): void {
    for (const v of this.voices) {
      if (v.gain && now >= v.end + 0.02) {
        disconnectAll(v.nodes);
        v.gain = null;
        v.src = null;
        v.nodes = [];
      }
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (this.dying[i].end < now) {
        disconnectAll(this.dying[i].nodes);
        this.dying.splice(i, 1);
      }
    }
  }

  private record(id: string, ui: boolean, positional: boolean, enemy: boolean, layer: number, synth: boolean, clip: string, gain: number, lowpass: number, pan: number, pitch: number, occluded: boolean, t: number): void {
    this.log.push({ id, bus: ui ? 'ui' : 'sfx', positional, enemy, layer, synth, clip, gain: round(gain), lowpass: Math.round(lowpass), pan: round(pan), pitch: round(pitch), occluded, t: round(t) });
    if (this.log.length > 40) this.log.shift();
  }

  // ───────────── 光束（GameAudio.HoldBeam） ─────────────

  private holdBeam(volume: number, pitch: number): void {
    const ac = this.ac!;
    const m = this.bank.manifest;
    const loop = m?.beamLoop;
    const buf = loop ? this.bank.clip(loop) : undefined;
    const useSynth = this.bank.state === 'failed' || !loop || this.bank.failed.has(loop);
    if (!buf && !useSynth) return; // 片段还没解码好
    this.beamHeld = this.ctx.time.now;
    this.beamTargetVol = R.beamTarget(volume, R.sfxBusLevel(this.mix));
    const bp = R.beamPitch(pitch);
    const now = ac.currentTime;
    if (this.beam) {
      this.beam.src?.playbackRate.setValueAtTime(bp, now);
      return;
    }
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.connect(this.mixer!.sfx);
    const beam: Beam = { gain, src: null, synth: null, vol: 0 };
    if (buf) {
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = bp;
      src.connect(gain);
      src.start(now, Math.random() * buf.duration * 0.9);
      beam.src = src;
    } else {
      beam.synth = this.fallback().beam(gain, bp);
    }
    this.beam = beam;
  }

  private updateBeam(now: number, dt: number): void {
    const b = this.beam;
    if (!b) return;
    // 0.24 s（游戏时间）没被刷新就淡出；暂停 / 模态 / 结算时（Unity：timeScale = 0）不算保持
    const t = this.ctx.time;
    const held = this.ctx.game.state === 'playing' && t.timeScale > 0 && t.now - this.beamHeld <= R.BEAM_HOLD;
    b.vol = R.beamStep(b.vol, held, this.beamTargetVol, dt);
    const g = b.gain.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(b.vol, now, 0.01);
    g.setTargetAtTime(0, now + BEAM_SAFETY, 0.05);
    if (!held && b.vol <= 0.001) {
      this.beam = null;
      const stopAt = now + 0.05;
      const srcs: AudioScheduledSourceNode[] = b.src ? [b.src] : b.synth?.sources ?? [];
      for (const s of srcs) {
        try {
          s.stop(stopAt);
        } catch {
          /* 已停 */
        }
      }
      this.dying.push({ nodes: [b.gain, ...srcs, ...(b.synth?.nodes ?? [])], end: stopAt + 0.05 });
    }
  }

  // ───────────── 配乐（GameAudio.SetMusic + MusicDirector） ─────────────

  private setMusicId(id: string): void {
    this.musicWanted = id || 'none';
    if (this.ac?.state === 'running' && this.mixer) this.applyMusic(this.musicWanted);
  }

  private applyMusic(id: string): void {
    if (!id) id = 'none';
    // 清单还在路上：先不动，读完后 init 里重放一次 musicWanted
    if (this.bank.state === 'idle' || this.bank.state === 'loading') return;
    if (id === this.musicId) return;
    this.musicId = id;
    const now = this.ac!.currentTime;
    for (const t of this.tracks) {
      this.retarget(t, now, 0, 1 / R.MUSIC_FADE_OUT);
    }
    const clip = this.bank.state === 'ready' && this.bank.hasMusic(id);
    if (!clip) {
      // 退路：合成配乐（清单读不到、没有这条曲目的片段）
      if (id === 'none') this.synth?.setMusic('none');
      else if (isSynthMusic(id) && (this.bank.state === 'failed' || this.bank.state === 'ready')) {
        if (this.bank.state === 'ready') this.warnOnce(`music:${id}`, `[Audio] 没有配乐片段 ${id}，退回实时合成`);
        this.fallback().setMusic(id);
      } else if (id !== 'none') {
        this.warnOnce(`music:${id}`, `[Audio] 没有配乐 ${id}`);
      }
      return;
    }
    this.synth?.setMusic('none');
    const gain = this.ac!.createGain();
    gain.gain.value = 0;
    gain.connect(this.mixer!.music);
    const track: MusicTrack = { id, gain, src: null, vol: 0, volAt: now, target: 1, rate: 1 / R.MUSIC_FADE_IN };
    this.tracks.push(track);
    this.bank.retainMusic(id);
    const start = (buf: AudioBuffer | null): void => {
      if (!this.tracks.includes(track) || track.target <= 0) return; // 解码期间已经被换掉
      if (!buf) {
        this.warnOnce(`music:${id}`, `[Audio] 配乐 ${id} 载入失败，退回实时合成`);
        this.removeTrack(track);
        if (isSynthMusic(id)) this.fallback().setMusic(id);
        return;
      }
      const ac = this.ac!;
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      const t0 = ac.currentTime;
      src.start(t0);
      track.src = src;
      // 从开始放的这一刻起淡入
      track.vol = 0;
      track.volAt = t0;
      this.retarget(track, t0, 1, 1 / R.MUSIC_FADE_IN);
    };
    const ready = this.bank.musicNow(id);
    if (ready) start(ready);
    else this.bank.musicBuffer(id).then(start, () => start(null));
  }

  /** 某一刻的音量（线性走向 target） */
  private volAt(t: MusicTrack, now: number): number {
    return R.moveTowards(t.vol, t.target, Math.max(0, now - t.volAt) * t.rate);
  }

  /** 改目标：把「每帧 MoveTowards」排成一条 AudioParam 斜坡（音量 × 配乐总线电平） */
  private retarget(t: MusicTrack, now: number, target: number, rate: number): void {
    t.vol = t.src ? this.volAt(t, now) : 0;
    t.volAt = now;
    t.target = target;
    t.rate = rate;
    if (!t.src) return; // 还在解码：开始放时再排
    const bus = R.musicBusLevel(this.mix);
    const g = t.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(t.vol * bus, now);
    const dur = Math.abs(target - t.vol) / rate;
    if (dur > 0) g.linearRampToValueAtTime(target * bus, now + dur);
  }

  private updateMusic(now: number): void {
    for (let i = this.tracks.length - 1; i >= 0; i--) {
      const t = this.tracks[i];
      if (t.target <= 0 && (!t.src || this.volAt(t, now) <= 0)) this.removeTrack(t);
    }
  }

  private removeTrack(t: MusicTrack): void {
    const i = this.tracks.indexOf(t);
    if (i >= 0) this.tracks.splice(i, 1);
    try {
      t.src?.stop();
    } catch {
      /* 已停 */
    }
    disconnectAll([t.gain, ...(t.src ? [t.src] : [])]);
    this.bank.releaseMusic(t.id);
  }

  /**
   * 选曲（MusicDirector）：有遭遇战场地的关卡里（Unity：场景里有 EncounterSite），每 0.5 s 判一次：
   * 交战 → combat；首领在场 → boss（旱魃 → boss_hanba）；否则 calm。玩家阵亡时不动（Game 已切到 none）。
   * 网页多一条：只在关卡里（playing / paused / modal）判，结算 / 菜单 / 换关时不改 Game 指定的曲目。
   */
  private directMusic(): void {
    const ctx = this.ctx;
    const st = ctx.game?.state;
    if (st !== 'playing' && st !== 'paused' && st !== 'modal') return;
    const ex = ctx.stage?.exploration;
    if (!ex?.encounters?.length) return;
    if (ctx.player && !ctx.player.alive) return;
    const active = ex.encounters.some(e => e.phase === 'active');
    let boss: string | null = null;
    for (const e of ctx.enemies?.list ?? []) {
      if (e.alive && e.def.id.startsWith('boss')) {
        boss = e.def.id;
        break;
      }
    }
    const hasHanba = this.bank.state === 'ready' ? this.bank.hasMusic('boss_hanba') : this.bank.state === 'failed';
    this.setMusicId(R.musicWant(active, boss, hasHanba));
  }

  // ───────────── 声床 + 混响（AmbienceDirector） ─────────────

  private startBed(id: string): void {
    this.stopBed();
    this.bedWanted = id;
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || !this.mixer) return; // 解锁后再起
    if (this.bank.state === 'failed' || (this.bank.state === 'ready' && !this.bank.hasMusic(id))) {
      this.warnOnce(`bed:${id}`, `[Audio] 没有环境声床 ${id}（重跑 audio-bake.html 的 I6 段 + python -I scripts/audio/bake.py <输出目录> --partial），静音`);
      return;
    }
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.connect(this.mixer.ambience);
    const bed: Bed = { id, gain, src: null, vol: 0 };
    this.bed = bed;
    this.bank.retainMusic(id);
    const go = (buf: AudioBuffer | null): void => {
      if (this.bed !== bed) return;
      if (!buf) {
        this.warnOnce(`bed:${id}`, `[Audio] 环境声床 ${id} 载入失败，静音`);
        return;
      }
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      src.start(ac.currentTime, Math.random() * buf.duration * 0.9);
      bed.src = src;
    };
    const ready = this.bank.musicNow(id);
    if (ready) go(ready);
    else if (this.bank.state === 'ready') this.bank.musicBuffer(id).then(go, () => go(null));
    else void this.bank.load().then(() => (this.bank.state === 'ready' ? this.bank.musicBuffer(id) : null)).then(go, () => go(null));
  }

  private stopBed(): void {
    const b = this.bed;
    this.bed = null;
    if (!b) return;
    try {
      b.src?.stop();
    } catch {
      /* 已停 */
    }
    disconnectAll([b.gain, ...(b.src ? [b.src] : [])]);
    this.bank.releaseMusic(b.id);
  }

  private leaveStage(): void {
    this.bedWanted = null;
    this.stopBed();
    this.ambStage = null;
    this.sendDb = OFF;
    this.mixer?.setReverbSendDb(OFF);
  }

  private updateAmbience(now: number, dt: number): void {
    const b = this.bed;
    if (b?.src) {
      const want = this.ctx.player && !this.ctx.player.alive ? R.BED_DEAD_LEVEL : 1;
      b.vol = R.moveTowards(b.vol, want, dt / R.BED_FADE_IN);
      b.gain.gain.cancelScheduledValues(now);
      b.gain.gain.setTargetAtTime(b.vol * R.BED_LEVEL, now, 0.05);
    }
    const s = this.ambStage;
    if (!s || !this.mixer) return;
    const e = this.ctx.camera.matrixWorld.elements;
    const target = R.reverbBaseDb(s.chapter, s.map) + R.zoneExtraAt(e[12], e[13], e[14], R.AMBIENCE_ZONES[s.map] ?? []);
    const next = R.reverbSendStep(this.sendDb, target, dt);
    if (Math.abs(next - this.mixer.sendDb) > 0.005) this.mixer.setReverbSendDb(next);
    this.sendDb = next;
  }

  // ───────────── 调试 ─────────────

  /** 实机核对用（window.__ctx.audio.describe()）：素材解码进度、混音台、声道、配乐、声床、最近发出的声音 */
  describe(): Record<string, unknown> {
    const now = this.ac?.currentTime ?? 0;
    const active = this.voices.filter(v => this.playing(v, now));
    return {
      context: this.ac ? { state: this.ac.state, sampleRate: this.ac.sampleRate } : null,
      failed: this.failed,
      bank: this.bank.describe(),
      mixer: this.mixer?.describe() ?? null,
      mix: this.mix,
      voices: { active: active.length, ids: active.map(v => v.id) },
      music: { wanted: this.musicWanted, current: this.musicId, tracks: this.tracks.map(t => ({ id: t.id, started: !!t.src, vol: round(this.volAt(t, now)), target: t.target })), synth: this.synth?.music.playing ?? null },
      bed: this.bed ? { id: this.bed.id, started: !!this.bed.src, vol: round(this.bed.vol) } : null,
      ambience: this.ambStage ? { ...this.ambStage, sendDb: round(this.sendDb) } : null,
      beam: this.beam ? { vol: round(this.beam.vol), target: round(this.beamTargetVol), clip: !!this.beam.src } : null,
      stats: { ...this.stats },
      log: this.log.slice(),
    };
  }
}

function disconnectAll(nodes: readonly AudioNode[]): void {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      /* 已断开 */
    }
  }
}

const round = (x: number): number => Math.round(x * 1000) / 1000;
