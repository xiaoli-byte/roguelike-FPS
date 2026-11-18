/**
 * 音频素材库：读 public/assets/audio/audio-manifest.json（scripts/web/publish-audio.mjs 从 Unity 拷来），解码 ogg。
 *
 * - 音效片段（246 个、单声道 44.1 kHz，解出来约 70 MB）：清单到了就全部预取解码（并发 6），不等用户手势——
 *   解码用 OfflineAudioContext（不需要解锁），解出的 AudioBuffer 和播放用的 AudioContext 无关、可以直接用。
 *   还没解完的片段 play 时跳过这一声（不卡住）；解码失败的片段记下来，AudioSystem 对整个 id 都没有可用片段时退回合成配方。
 * - 曲目 / 声床（8 条立体声，menu 106 s 解出来 37 MB）：按需解码，缓存最近用过的，空闲的最多留 2 条。
 * 清单读不到（404、解析失败）→ state = 'failed'，AudioSystem 整体退回实时合成。
 */
import { clipName, enemyClipName, layerClipName, LAYER_SUFFIX } from './AudioRules';

export interface SfxEntry {
  id: string;
  variants: number;
  enemyVariants: number;
  gain: number;
  pitch: number;
  throttle: number;
  send: number;
  prio: number;
  /** 分层（I6）：瞬态 / 主体 / 尾音各几个变体；0 / 缺省 = 不分层 */
  layers?: number;
}

export interface MusicEntry {
  id: string;
  seconds: number;
  loopSeconds: number;
  bpm: number;
  level: number;
  send: number;
}

export interface AudioManifest {
  sampleRate: number;
  beamLoop?: string;
  mix?: { master: number; sfx: number; music: number };
  sfx: SfxEntry[];
  music: MusicEntry[];
  /** sfx/ 下实际有的片段名 */
  clips: string[];
  /** music/ 下实际有的曲目名 */
  musicClips: string[];
}

/** 一个 SfxId 的片段集（同 GameAudio.Def）：名字列表，解没解好由 AudioBank 查 */
export interface SfxDef {
  meta: SfxEntry;
  clips: string[];
  enemy: string[];
  /** 分层：三层各自的变体；三层都有才算分层，否则 null */
  layers: [string[], string[], string[]] | null;
}

const BASE = import.meta.env.BASE_URL;
const ROOT = `${BASE}assets/audio/`;
const SFX_CONCURRENCY = 6;
const IDLE_MUSIC_KEEP = 2;

type Ctor = typeof OfflineAudioContext;

export class AudioBank {
  state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  manifest: AudioManifest | null = null;
  readonly defs = new Map<string, SfxDef>();
  /** 已解码的音效片段 */
  private readonly buffers = new Map<string, AudioBuffer>();
  /** 解码 / 下载失败的片段 */
  readonly failed = new Set<string>();
  private readonly music = new Map<string, Promise<AudioBuffer | null>>();
  private readonly musicReady = new Map<string, AudioBuffer>();
  /** 正在用的曲目（不回收） */
  private readonly musicInUse = new Map<string, number>();
  private decoder: BaseAudioContext | null = null;
  private loading: Promise<void> | null = null;
  /** 解码耗时统计（调试） */
  decodeMs = 0;

  constructor(private readonly fallbackDecoder: () => BaseAudioContext | null) {}

  /** 开始读清单并预取全部音效片段（可重复调用） */
  load(): Promise<void> {
    this.loading ??= this.run();
    return this.loading;
  }

  private async run(): Promise<void> {
    this.state = 'loading';
    let m: AudioManifest;
    try {
      const res = await fetch(`${ROOT}audio-manifest.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      m = await res.json() as AudioManifest;
      if (!Array.isArray(m.sfx) || !Array.isArray(m.clips)) throw new Error('清单缺 sfx / clips');
    } catch (err) {
      console.warn('[Audio] 读不到 assets/audio/audio-manifest.json（先跑 node scripts/web/publish-audio.mjs），退回实时合成', err);
      this.state = 'failed';
      return;
    }
    this.manifest = m;
    m.musicClips ??= [];
    const have = new Set(m.clips);
    const collect = (names: string[]): string[] => names.filter(n => have.has(n));
    for (const e of m.sfx) {
      const range = (n: number, f: (i: number) => string): string[] => collect(Array.from({ length: Math.max(0, n | 0) }, (_, i) => f(i)));
      let layers: SfxDef['layers'] = null;
      if ((e.layers ?? 0) > 0) {
        const ls = LAYER_SUFFIX.map((_, k) => range(e.layers ?? 0, i => layerClipName(e.id, k, i)));
        if (ls[0].length > 0 && ls[1].length > 0 && ls[2].length > 0) layers = [ls[0], ls[1], ls[2]];
      }
      this.defs.set(e.id, { meta: e, clips: range(e.variants, i => clipName(e.id, i)), enemy: range(e.enemyVariants, i => enemyClipName(e.id, i)), layers });
    }
    this.state = 'ready';
    // 预取：界面音、玩家枪声先解（最常听到、第一声就要有），其余按清单顺序
    const order = [...m.clips].sort((a, b) => rank(a) - rank(b));
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < order.length) {
        const name = order[next++];
        const buf = await this.decode(`${ROOT}sfx/${clipUrl(name)}.ogg`);
        if (buf) this.buffers.set(name, buf);
        else this.failed.add(name);
      }
    };
    await Promise.all(Array.from({ length: SFX_CONCURRENCY }, worker));
  }

  /** 解码用的上下文：优先离线上下文（不需要用户手势），没有就等播放用的那个 */
  private decoderContext(): BaseAudioContext | null {
    if (this.decoder) return this.decoder;
    const w = globalThis as unknown as { OfflineAudioContext?: Ctor; webkitOfflineAudioContext?: Ctor };
    const C = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
    if (C) {
      try {
        this.decoder = new C(1, 1, this.manifest?.sampleRate ?? 44100);
        return this.decoder;
      } catch {
        /* 退到播放上下文 */
      }
    }
    return this.fallbackDecoder();
  }

  private async decode(url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      let ctx = this.decoderContext();
      // 没有离线上下文的浏览器：等用户手势建好播放上下文再解
      for (let i = 0; !ctx && i < 600; i++) {
        await new Promise(r => setTimeout(r, 100));
        ctx = this.decoderContext();
      }
      if (!ctx) throw new Error('没有可用于解码的 AudioContext');
      const t0 = performance.now();
      const buf = await ctx.decodeAudioData(data);
      this.decodeMs += performance.now() - t0;
      return buf;
    } catch (err) {
      console.warn('[Audio] 片段载入失败', url, err);
      return null;
    }
  }

  /** 已解码的音效片段（没解好 / 失败 = undefined） */
  clip(name: string): AudioBuffer | undefined {
    return this.buffers.get(name);
  }

  /** 这些片段里有没有还在路上的（没解好也没失败） */
  pending(names: readonly string[]): boolean {
    return names.some(n => !this.buffers.has(n) && !this.failed.has(n));
  }

  /** 已解码的音效片段数 / 清单里的总数 */
  get decoded(): number { return this.buffers.size; }
  get total(): number { return this.manifest?.clips.length ?? 0; }

  /** 有没有这条曲目 / 声床的片段 */
  hasMusic(id: string): boolean {
    return !!this.manifest?.musicClips.includes(id);
  }

  /** 曲目 / 声床的 AudioBuffer（按需解码；没有这条 / 失败 = null） */
  musicBuffer(id: string): Promise<AudioBuffer | null> {
    let p = this.music.get(id);
    if (!p) {
      if (!this.hasMusic(id)) return Promise.resolve(null);
      p = this.decode(`${ROOT}music/${clipUrl(id)}.ogg`).then(buf => {
        if (buf) this.musicReady.set(id, buf);
        else this.music.delete(id);
        return buf;
      });
      this.music.set(id, p);
    }
    return p;
  }

  /** 已解码好的曲目（同步查） */
  musicNow(id: string): AudioBuffer | null {
    return this.musicReady.get(id) ?? null;
  }

  /** 曲目开始 / 停止使用：空闲的解码结果最多留 2 条（按最近用过的） */
  retainMusic(id: string): void {
    this.musicInUse.set(id, (this.musicInUse.get(id) ?? 0) + 1);
    // 重新插入 = 移到最近
    const p = this.music.get(id);
    if (p) { this.music.delete(id); this.music.set(id, p); }
  }

  releaseMusic(id: string): void {
    const n = (this.musicInUse.get(id) ?? 1) - 1;
    if (n > 0) this.musicInUse.set(id, n);
    else this.musicInUse.delete(id);
    const idle = [...this.music.keys()].filter(k => !this.musicInUse.has(k) && this.musicReady.has(k));
    for (const k of idle.slice(0, Math.max(0, idle.length - IDLE_MUSIC_KEEP))) {
      this.music.delete(k);
      this.musicReady.delete(k);
    }
  }

  /** 调试：解码进度、失败、曲目缓存 */
  describe(): Record<string, unknown> {
    return {
      state: this.state, decoded: this.decoded, total: this.total, failed: [...this.failed],
      musicDecoded: [...this.musicReady.keys()], decodeMs: Math.round(this.decodeMs),
    };
  }
}

/** 预取顺序：界面音 → 玩家枪声 / 换弹 → 命中反馈 → 其余 */
function rank(name: string): number {
  if (name.startsWith('ui_')) return 0;
  if (name.startsWith('shot_') || name.startsWith('reload_') || name.startsWith('dry_fire') || name.startsWith('weapon_switch')) return 1;
  if (name.startsWith('hit') || name.startsWith('kill')) return 2;
  return 3;
}

/**
 * 片段名 → 网址路径段：名字只有小写字母、数字、下划线和 @（敌方音色 <id>@enemy_<i>）。@ 在路径里合法，不能转成 %40——
 * Vite 开发服务器的静态目录按字面文件名找，%40 找不到会回退成 index.html（解码失败）
 */
function clipUrl(name: string): string {
  return encodeURIComponent(name).replace(/%40/g, '@');
}
