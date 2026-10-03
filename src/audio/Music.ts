/**
 * 音乐引擎：lookahead 调度的循环音序器（setInterval + AudioContext 时间，不依赖 requestAnimationFrame）。
 *
 * - 每首曲目一个 Player：独立的音量节点（→ 干声总线）与混响发送（→ 湿声总线）。
 * - 切换曲目时旧曲目淡出、新曲目淡入（交叉淡化），淡出结束后断开节点。
 * - 标签页隐藏时定时器会被浏览器降频，调度窗口相应拉长；卡顿追不上时跳过错过的步。
 * - 调度窗口 0.3 秒：换关时 Game 在一帧里同步搭建关卡（几何合并、导航网格、着色器编译），主线程会卡上
 *   几百毫秒，定时器在此期间不会触发；提前排好的音符能盖住这段空白。旧曲目已排的音符随它的音量一起淡出，
 *   所以窗口长一点不影响切歌。
 */
import type { MusicId } from '../core/types';
import type { SynthKit, Voice } from './Synth';
import { BossTrack, CalmTrack, CombatTrack, MenuTrack, type Track } from './MusicTracks';

const TICK_MS = 25;
const LOOKAHEAD = 0.3;
const LOOKAHEAD_HIDDEN = 1.4;
const FADE_OUT = 1.6;
const FADE_IN = 1.3;

interface Player {
  id: MusicId;
  track: Track;
  gain: GainNode;
  send: GainNode;
  step: number;
  next: number;
  /** 淡出完成时间；Infinity 表示正在播放 */
  stopAt: number;
}

function createTrack(id: Exclude<MusicId, 'none'>): Track {
  switch (id) {
    case 'menu':
      return new MenuTrack();
    case 'calm':
      return new CalmTrack();
    case 'combat':
      return new CombatTrack();
    case 'boss':
      return new BossTrack();
  }
}

export class MusicEngine {
  private players: Player[] = [];
  private current: MusicId = 'none';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly kit: SynthKit, private readonly dry: AudioNode, private readonly wet: AudioNode) {}

  get playing(): MusicId {
    return this.current;
  }

  /** 切换曲目（相同曲目忽略） */
  set(id: MusicId): void {
    if (id === this.current) return;
    this.current = id;
    const ac = this.kit.ac;
    const now = ac.currentTime;
    for (const p of this.players) {
      if (p.stopAt !== Infinity) continue;
      const g = p.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + FADE_OUT);
      p.stopAt = now + FADE_OUT + 0.05;
    }
    if (id !== 'none') {
      const track = createTrack(id);
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(track.level, now + FADE_IN);
      gain.connect(this.dry);
      const send = ac.createGain();
      send.gain.value = track.send;
      gain.connect(send);
      send.connect(this.wet);
      this.players.push({ id, track, gain, send, step: 0, next: now + 0.06, stopAt: Infinity });
    }
    this.ensureTimer();
    this.tick();
  }

  private ensureTimer(): void {
    if (this.timer !== null || this.players.length === 0) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const ac = this.kit.ac;
    const now = ac.currentTime;
    const ahead = typeof document !== 'undefined' && document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD;
    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      if (now >= p.stopAt) {
        p.gain.disconnect();
        p.send.disconnect();
        this.players.splice(i, 1);
        continue;
      }
      const tr = p.track;
      const sd = tr.stepDur;
      // 定时器被长时间挂起：跳过错过的步，保持小节对齐
      if (p.next < now - 0.2) {
        const missed = Math.ceil((now - p.next) / sd);
        for (let k = 0; k < missed; k++) this.advance(p);
        p.next += missed * sd;
      }
      while (p.next < now + ahead && p.next < p.stopAt) {
        const v: Voice = { kit: this.kit, ac, out: p.gain, t: p.next, p: 1, end: 0 };
        try {
          tr.play(p.step, v);
        } catch (err) {
          console.error('[Music] 调度出错', err);
        }
        p.next += sd;
        this.advance(p);
      }
    }
    if (this.players.length === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private advance(p: Player): void {
    p.step++;
    if (p.step >= p.track.steps) {
      p.step = 0;
      p.track.loop++;
    }
  }
}
