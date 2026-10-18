/**
 * 音频烘焙页（audio-bake.html）：把 Three.js 版程序合成的全部音效与配乐，用浏览器的 OfflineAudioContext 离线渲成 WAV，
 * 逐个 POST 给本机接收器（scripts/audio/bake_receiver.py）落盘，再由 scripts/audio/bake.py 转 ogg 放进 Unity。
 * Unity 版没有 WebAudio：音色以这里渲出的片段为准（与 Three.js 一字不差，以后可以逐个换成正式素材）。
 *
 * - 音效：每个 SfxId 渲 1–3 个变体（配方里有随机，pitch 抖动为 0 的提示音只渲 1 个）；带位置播放的敌方音色另存 <id>@enemy。
 *   混音同 AudioSystem.play：基础音量 meta.gain 烘进片段，混响按 meta.send 送进同一个卷积混响（2.6 s 脉冲，回送 0.85）。
 *   单声道（Unity 里做 3D 声像）；尾巴裁到 -80 dB 并淡出 15 ms；峰值超过 0.98 的整体压到 0.98。
 * - 光束持续音：AudioSystem.createBeam 同款节点图，取稳态的 2 秒（各振荡 / 调制的公共周期）做无缝循环。
 * - 配乐：四首曲目各渲第 0–4 遍，裁掉第 0 遍（前奏），第 1–4 遍拼成无缝循环（A/B 段交替不断）；立体声，带混响发送。
 * - 最后写 manifest.json（各音效的混音参数、变体数、曲目时长）。
 */
import { SynthKit, type Recipe, type Voice } from '../audio/Synth';
import { SFX, SFX_META, SFX_POSITIONAL } from '../audio/Sfx';
import { BossTrack, CalmTrack, CombatTrack, MenuTrack, type Track } from '../audio/MusicTracks';
import type { SfxId } from '../core/types';

const SR = 44100;
const RECEIVER = 'http://127.0.0.1:8765';
const REVERB_RETURN = 0.85;
const TAIL = 3.0;

const log = (s: string, cls = ''): void => {
  const el = document.getElementById('log')!;
  const d = document.createElement('div');
  d.textContent = s;
  if (cls) d.className = cls;
  el.prepend(d);
};

/** 32 位浮点 WAV（Unity / ffmpeg 都认） */
function wav(chs: Float32Array[]): Blob {
  const n = chs[0].length, c = chs.length;
  const buf = new ArrayBuffer(44 + n * c * 4);
  const dv = new DataView(buf);
  const str = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * c * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 3, true); dv.setUint16(22, c, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR * c * 4, true); dv.setUint16(32, c * 4, true); dv.setUint16(34, 32, true);
  str(36, 'data'); dv.setUint32(40, n * c * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) { dv.setFloat32(o, chs[k][i], true); o += 4; }
  return new Blob([buf], { type: 'audio/wav' });
}

async function save(path: string, body: Blob | string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${RECEIVER}/save?path=${encodeURIComponent(path)}`, { method: 'POST', body });
      if (r.ok) return;
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (attempt >= 3) throw new Error(`保存 ${path} 失败：${e}`);
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }
}

/** 干声总线 + 卷积混响（同 AudioSystem.build） */
function bus(ac: OfflineAudioContext, kit: SynthKit, send: number): GainNode {
  const dry = ac.createGain();
  dry.connect(ac.destination);
  if (send > 0.005) {
    const conv = ac.createConvolver();
    conv.buffer = kit.makeImpulse(2.6, 2.6);
    const sg = ac.createGain();
    sg.gain.value = send;
    const ret = ac.createGain();
    ret.gain.value = REVERB_RETURN;
    dry.connect(sg);
    sg.connect(conv);
    conv.connect(ret);
    ret.connect(ac.destination);
  }
  return dry;
}

/** 裁掉 -80 dB 以下的尾巴、淡出，峰值压到 0.98；返回 [片段, 原峰值] */
function finish(buf: AudioBuffer, from = 0, to = buf.length): [Float32Array[], number] {
  const chs: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c).slice(from, to));
  let last = 0, peak = 0;
  for (const d of chs) for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
    if (a > 1e-4 && i > last) last = i;
  }
  return [chs, peak];
}

function trimSfx(buf: AudioBuffer): [Float32Array[], number] {
  const [chs, peak] = finish(buf);
  let last = 0;
  for (const d of chs) for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) > 1e-4) { last = i; break; }
  const n = Math.min(chs[0].length, last + Math.round(SR * 0.02));
  const fade = Math.round(SR * 0.015);
  const k = peak > 0.98 ? 0.98 / peak : 1;
  const out = chs.map((d) => {
    const o = d.slice(0, Math.max(1, n));
    for (let i = 0; i < o.length; i++) {
      const f = i >= o.length - fade ? (o.length - i) / fade : 1;
      o[i] *= k * f;
    }
    return o;
  });
  return [out, peak];
}

/** 先空跑一遍配方拿到时长（配方有随机，留足余量），再离线渲 */
function probe(recipe: Recipe, p: number): number {
  const ac = new OfflineAudioContext(1, SR, SR);
  const kit = new SynthKit(ac as unknown as AudioContext);
  const v: Voice = { kit, ac: ac as unknown as AudioContext, out: ac.createGain(), t: 0, p, end: 0.05 };
  recipe(v);
  return v.end;
}

async function renderSfx(recipe: Recipe, gain: number, send: number): Promise<[Float32Array[], number]> {
  const len = Math.min(14, probe(recipe, 1) * 1.25 + (send > 0.005 ? TAIL : 0.3) + 0.3);
  const ac = new OfflineAudioContext(1, Math.ceil(len * SR), SR);
  const kit = new SynthKit(ac as unknown as AudioContext);
  const dry = bus(ac, kit, send);
  const input = ac.createGain();
  input.gain.value = gain;
  input.connect(dry);
  const v: Voice = { kit, ac: ac as unknown as AudioContext, out: input, t: 0.004, p: 1, end: 0.05 };
  recipe(v);
  return trimSfx(await ac.startRendering());
}

/** 光束持续音：AudioSystem.createBeam 的节点图，取 0.5–2.5 s 的稳态做 2 秒循环 */
async function renderBeam(gain: number): Promise<Float32Array[]> {
  const ac = new OfflineAudioContext(1, Math.ceil(3 * SR), SR);
  const kit = new SynthKit(ac as unknown as AudioContext);
  const dry = bus(ac, kit, 0.12);
  const input = ac.createGain();
  input.gain.value = gain;
  input.connect(dry);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1500;
  lp.Q.value = 3;
  lp.connect(input);
  const osc = (type: OscillatorType, f: number, g: number, detune = 0): OscillatorNode => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    const gn = ac.createGain();
    gn.gain.value = g;
    o.connect(gn);
    gn.connect(lp);
    return o;
  };
  const wob = ac.createOscillator();
  wob.frequency.value = 6.5;
  const wobG = ac.createGain();
  wobG.gain.value = 520;
  wob.connect(wobG);
  wobG.connect(lp.frequency);
  // saw2 的 8 音分失谐会让 2 秒不是整周期：循环版去掉失谐（差别听不出来）
  const srcs: AudioScheduledSourceNode[] = [wob, osc('sawtooth', 110, 0.34), osc('sawtooth', 165, 0.2), osc('square', 55, 0.14)];
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
  srcs.push(crackle, amLfo);
  for (const s of srcs) s.start(0);
  const buf = await ac.startRendering();
  const [chs] = finish(buf, Math.round(0.5 * SR), Math.round(2.5 * SR));
  // 噪声段首尾 20 ms 交叉淡化，循环点不咔哒
  const d = chs[0], x = Math.round(0.02 * SR);
  const head = d.slice(0, x);
  for (let i = 0; i < x; i++) {
    const k = i / x;
    d[d.length - x + i] = d[d.length - x + i] * (1 - k) + head[i] * k;
  }
  return [d.slice(0, d.length)];
}

/** 配乐：第 0–4 遍顺序调度（同 MusicEngine.tick），裁出第 1–4 遍 */
async function renderTrack(track: Track, loops = 4): Promise<[Float32Array[], number]> {
  const L = track.steps * track.stepDur;
  const total = (loops + 1) * L + TAIL;
  const ac = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
  const kit = new SynthKit(ac as unknown as AudioContext);
  const dry = bus(ac, kit, track.send);
  const g = ac.createGain();
  g.gain.value = track.level;
  g.connect(dry);
  let step = 0;
  for (let k = 0; k < (loops + 1) * track.steps; k++) {
    const v: Voice = { kit, ac: ac as unknown as AudioContext, out: g, t: 0.06 + k * track.stepDur, p: 1, end: 0 };
    track.play(step, v);
    step++;
    if (step >= track.steps) {
      step = 0;
      track.loop++;
    }
  }
  const buf = await ac.startRendering();
  const a = Math.round((0.06 + L) * SR), b = Math.round((0.06 + (loops + 1) * L) * SR);
  const [chs, peak] = finish(buf, a, b);
  if (peak > 0.98) for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= 0.98 / peak;
  return [chs, peak];
}

async function main(): Promise<void> {
  const manifest: Record<string, unknown> = { sampleRate: SR, generated: new Date().toISOString(), sfx: {}, music: {} };
  const sfxOut = manifest.sfx as Record<string, unknown>;
  const ids = Object.keys(SFX) as SfxId[];
  let n = 0, hot = 0;
  for (const id of ids) {
    const meta = SFX_META[id];
    const variants = meta.pitch > 0 ? 3 : 1;
    for (let i = 0; i < variants; i++) {
      const [chs, peak] = await renderSfx(SFX[id], meta.gain, meta.send);
      if (peak > 0.98) hot++;
      await save(`sfx/${id}_${i}.wav`, wav(chs));
      n++;
    }
    const enemy = SFX_POSITIONAL[id];
    let enemyVariants = 0;
    if (enemy) {
      enemyVariants = 3;
      for (let i = 0; i < enemyVariants; i++) {
        const [chs] = await renderSfx(enemy, meta.gain, meta.send);
        await save(`sfx/${id}@enemy_${i}.wav`, wav(chs));
        n++;
      }
    }
    sfxOut[id] = { variants, enemyVariants, gain: meta.gain, pitch: meta.pitch, throttle: meta.throttle, send: meta.send, prio: meta.prio };
    log(`${id} ×${variants}${enemyVariants ? ` + 敌方 ×${enemyVariants}` : ''}`);
  }
  await save('sfx/shot_beam_loop.wav', wav(await renderBeam(SFX_META.shot_beam.gain)));
  (manifest as { beamLoop?: string }).beamLoop = 'shot_beam_loop';
  log(`音效 ${n} 个片段（${hot} 个峰值超限已压到 0.98）+ 光束循环`, 'ok');

  const musicOut = manifest.music as Record<string, unknown>;
  for (const [id, make] of [['menu', () => new MenuTrack()], ['calm', () => new CalmTrack()], ['combat', () => new CombatTrack()], ['boss', () => new BossTrack()]] as const) {
    const track = make();
    const [chs, peak] = await renderTrack(track);
    await save(`music/${id}.wav`, wav(chs));
    musicOut[id] = { seconds: chs[0].length / SR, loopSeconds: track.steps * track.stepDur, bpm: track.bpm, level: track.level, send: track.send, peak };
    log(`配乐 ${id}：${(chs[0].length / SR).toFixed(1)} s`, 'ok');
  }
  // 总线比例（AudioSystem：音效 0.9、音乐 0.5 × 0.6）
  manifest.mix = { master: 0.8, sfx: 0.9, music: 0.5 * 0.6 };
  await save('manifest.json', JSON.stringify(manifest, null, 2));
  await fetch(`${RECEIVER}/done`, { method: 'POST' }).catch(() => undefined);
  log('全部完成', 'ok');
  document.title = '音频烘焙 · 完成';
}

main().catch((e) => {
  log(String(e), 'bad');
  document.title = '音频烘焙 · 失败';
  console.error(e);
});
