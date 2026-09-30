/**
 * 程序化配乐曲目。每首曲子 8 小节循环、16 分音符步进；旋律用固定种子按五声音阶生成，
 * 每次进入曲目听到的都是同一首「作品」，循环之间有变奏（旋律分段出现、鼓点加花）。
 *
 *  - menu   ：72 BPM，D 羽调，古筝分解和弦 + 笛子长音，神秘舒缓
 *  - calm   ：90 BPM，G 宫调，木鱼 / 沙锤轻打，商店与宝藏关
 *  - combat ：132 BPM，E 羽调，推进的鼓组 + 八分贝斯 + 古筝十六分琶音 + 笛子主旋律
 *  - boss   ：150 BPM，A 调带降二级色彩，双踩、失真贝斯、太鼓、铜管 stab、古筝轮指
 */
import { Rng } from '../core/Rng';
import { type Voice, mtof } from './Synth';
import { bass, bell, crash, dizi, gong, guzheng, hat, kick, pad, shaker, snare, stab, taiko, woodblock } from './Instruments';

export interface MelodyNote {
  m: number;
  /** 时值（16 分音符步数） */
  len: number;
  grace: boolean;
  vel: number;
}

const MINOR_PENTA = [0, 3, 5, 7, 10];
const MAJOR_PENTA = [0, 2, 4, 7, 9];
/** 带降二级的「阴」五声（A Bb C D E G 型） */
const DARK_PENTA = [0, 1, 3, 5, 7, 10];

function scaleNotes(root: number, intervals: readonly number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let o = -4; o <= 5; o++) {
    for (const iv of intervals) {
      const n = root + o * 12 + iv;
      if (n >= lo && n <= hi) out.push(n);
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * 生成一段旋律（按步索引的稀疏数组）。随机游走 + 回归中心，结尾落在主音上。
 */
function genMelody(seed: number, scale: readonly number[], center: number, steps: number, density: number, lens: readonly number[], rootClass: number): (MelodyNote | undefined)[] {
  const rng = new Rng(seed);
  const out: (MelodyNote | undefined)[] = new Array(steps);
  let c = 0;
  for (let i = 0; i < scale.length; i++) if (Math.abs(scale[i] - center) < Math.abs(scale[c] - center)) c = i;
  const lo = Math.max(0, c - 5);
  const hi = Math.min(scale.length - 1, c + 6);
  let idx = c;
  let s = 0;
  let last = -1;
  while (s < steps) {
    if (s > 0 && rng.next() > density) {
      s += 2;
      continue;
    }
    let len = rng.pick(lens);
    if (s + len > steps) len = steps - s;
    const r = rng.next();
    idx += r < 0.14 ? -2 : r < 0.44 ? -1 : r < 0.54 ? 0 : r < 0.86 ? 1 : 2;
    if (idx < lo) idx = lo + 1;
    if (idx > hi) idx = hi - 1;
    if (Math.abs(idx - c) > 3 && rng.next() < 0.5) idx += idx > c ? -1 : 1;
    out[s] = { m: scale[idx], len, grace: len >= 4 && rng.next() < 0.3, vel: 0.8 + rng.next() * 0.2 };
    last = s;
    s += len;
  }
  // 乐句收在主音上
  if (last >= 0) {
    const n = out[last]!;
    let best = n.m;
    let bestD = Infinity;
    for (const m of scale) {
      if (m % 12 !== rootClass) continue;
      const d = Math.abs(m - n.m);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    n.m = best;
    n.len = Math.max(n.len, Math.min(8, steps - last));
  }
  return out;
}

export abstract class Track {
  abstract readonly bpm: number;
  /** 曲目音量 */
  abstract readonly level: number;
  /** 混响发送 */
  abstract readonly send: number;
  readonly bars = 8;
  /** 已完成的循环次数（第一遍为 0） */
  loop = 0;

  get stepDur(): number {
    return 60 / this.bpm / 4;
  }

  get steps(): number {
    return this.bars * 16;
  }

  /** 调度第 step 步（0..steps-1）的所有音符，v.t 为该步的开始时间 */
  abstract play(step: number, v: Voice): void;
}

// ───────────── 主菜单 ─────────────

export class MenuTrack extends Track {
  readonly bpm = 72;
  readonly level = 0.9;
  readonly send = 0.55;
  private readonly chords = [
    [50, 57, 60, 65], // Dm7
    [46, 53, 57, 62], // Bb
    [43, 50, 55, 58], // Gm
    [45, 52, 57, 62], // A sus
  ];
  private readonly arpOrder = [0, 1, 2, 3, 2, 1, 3, 2];
  private readonly arpMask: boolean[] = [];
  private readonly melA: (MelodyNote | undefined)[];
  private readonly melB: (MelodyNote | undefined)[];

  constructor() {
    super();
    const rng = new Rng(1017);
    for (let i = 0; i < 64; i++) this.arpMask.push(i % 4 === 0 || rng.next() < 0.62);
    const scale = scaleNotes(62, MINOR_PENTA, 62, 88);
    this.melA = genMelody(2201, scale, 74, 64, 0.38, [4, 6, 8, 8, 12], 2);
    this.melB = genMelody(2202, scale, 76, 64, 0.42, [4, 4, 6, 8, 10], 2);
  }

  play(step: number, v: Voice): void {
    const sd = this.stepDur;
    const bar = step >> 4;
    const s = step & 15;
    const ch = this.chords[bar >> 1];
    if ((step & 31) === 0) {
      pad(v, 0, [mtof(ch[1]), mtof(ch[2]), mtof(ch[3]), mtof(ch[0] + 12)], sd * 30, 0.95, 850);
      bass(v, 0, mtof(ch[0] - 12), sd * 28, 0.45, 0.02);
    }
    if (s === 0) taiko(v, 0, 52, bar % 2 === 0 ? 0.32 : 0.2);
    if (s === 10 && bar % 2 === 1) woodblock(v, 0, 720, 0.18);
    if ((step & 1) === 0) {
      const i = step >> 1;
      if (this.arpMask[i]) {
        const k = this.arpOrder[i & 7];
        guzheng(v, 0, mtof(ch[k] + 24), i % 4 === 0 ? 0.38 : 0.26, 1.8);
      }
    }
    if (bar >= 4) {
      const mel = this.loop % 2 === 0 ? this.melA : this.melB;
      const n = mel[step - 64];
      if (n) dizi(v, 0, mtof(n.m), n.len * sd, 0.55 * n.vel, n.grace);
    }
    if (step === 0) bell(v, 0, mtof(86), 0.16, 2.6);
    if (step === 64) bell(v, 0, mtof(81), 0.14, 2.6);
  }
}

// ───────────── 商店 / 宝藏 ─────────────

export class CalmTrack extends Track {
  readonly bpm = 90;
  readonly level = 0.85;
  readonly send = 0.4;
  /** [根音, 和弦音...] 每两小节一个 */
  private readonly chords = [
    [43, 55, 59, 62], // G
    [40, 55, 59, 64], // Em
    [36, 55, 60, 64], // C
    [38, 54, 57, 62], // D
  ];
  private readonly arp = [1, 2, 3, 2, 1, 2, 3, 2];
  private readonly melA: (MelodyNote | undefined)[];
  private readonly melB: (MelodyNote | undefined)[];

  constructor() {
    super();
    const scale = scaleNotes(67, MAJOR_PENTA, 67, 93);
    this.melA = genMelody(3301, scale, 79, 64, 0.5, [2, 2, 4, 4, 6, 8], 7);
    this.melB = genMelody(3302, scale, 81, 64, 0.55, [2, 2, 2, 4, 4, 8], 7);
  }

  play(step: number, v: Voice): void {
    const sd = this.stepDur;
    const bar = step >> 4;
    const s = step & 15;
    const ch = this.chords[bar >> 1];
    if ((step & 31) === 0) pad(v, 0, [mtof(ch[1] + 12), mtof(ch[2] + 12), mtof(ch[3] + 12)], sd * 30, 0.5, 1000);
    if (s === 0) {
      bass(v, 0, mtof(ch[0]), sd * 6, 0.55, 0.15);
      kick(v, 0, 0.42);
    }
    if (s === 8) {
      bass(v, 0, mtof(ch[0] + 7), sd * 6, 0.45, 0.15);
      if (bar % 2 === 1) kick(v, 0, 0.28);
    }
    if (s === 6 || s === 14) woodblock(v, 0, s === 6 ? 900 : 760, 0.26);
    if ((s & 1) === 0) shaker(v, 0, (s & 3) === 2 ? 0.4 : 0.22);
    if ((s & 1) === 0) {
      const k = this.arp[(s >> 1) & 7];
      guzheng(v, 0, mtof(ch[k] + 12), s % 4 === 0 ? 0.36 : 0.26, 1.2);
    }
    const firstHalf = bar < 4;
    if (!(firstHalf && this.loop === 0)) {
      const n = firstHalf ? this.melA[step] : this.melB[step - 64];
      if (n) dizi(v, 0, mtof(n.m), n.len * sd, 0.5 * n.vel, n.grace);
    }
    if (step === 0 && this.loop > 0) bell(v, 0, mtof(91), 0.12, 2);
  }
}

// ───────────── 战斗 ─────────────

interface BarChord {
  root: number;
  tones: readonly number[];
}

const COMBAT_BARS: BarChord[] = [
  { root: 40, tones: [52, 55, 59, 64] }, // Em
  { root: 40, tones: [52, 55, 59, 64] },
  { root: 36, tones: [48, 52, 55, 60] }, // C
  { root: 36, tones: [48, 52, 55, 60] },
  { root: 38, tones: [50, 54, 57, 62] }, // D
  { root: 38, tones: [50, 54, 57, 62] },
  { root: 40, tones: [52, 55, 59, 64] }, // Em
  { root: 35, tones: [47, 51, 54, 59] }, // B
];

export class CombatTrack extends Track {
  readonly bpm = 132;
  readonly level = 0.8;
  readonly send = 0.22;
  private readonly kickPat = [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0];
  private readonly bassPat = [0, 0, 12, 0, 7, 0, 10, 7];
  private readonly arp8 = [0, 1, 2, 3, 2, 1, 2, 3];
  private readonly arp16 = [0, 1, 2, 3, 1, 2, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2];
  private readonly melA: (MelodyNote | undefined)[];
  private readonly melB: (MelodyNote | undefined)[];

  constructor() {
    super();
    const scale = scaleNotes(64, MINOR_PENTA, 64, 91);
    this.melA = genMelody(4401, scale, 76, 64, 0.55, [2, 2, 2, 4, 4, 6], 4);
    this.melB = genMelody(4402, scale, 81, 64, 0.72, [2, 2, 2, 2, 4], 4);
  }

  play(step: number, v: Voice): void {
    const sd = this.stepDur;
    const bar = step >> 4;
    const s = step & 15;
    const bc = COMBAT_BARS[bar];
    const second = bar >= 4;
    const fillBar = bar === 7;

    // 鼓
    if (this.kickPat[s] || (bar % 2 === 1 && s === 11) || (second && s === 14 && !fillBar)) kick(v, 0, 0.9);
    if (fillBar && s >= 8) {
      snare(v, 0, 0.3 + (s - 8) * 0.07);
      if ((s & 1) === 0) taiko(v, 0, 62 + (s - 8) * 4, 0.55 + (s - 8) * 0.05);
    } else {
      if (s === 4 || s === 12) snare(v, 0, 0.78);
      if (s === 15 && bar % 4 === 3) snare(v, 0, 0.28);
    }
    if (second) hat(v, 0, (s & 3) === 2 ? 0.42 : (s & 1) === 0 ? 0.28 : 0.18);
    else if ((s & 1) === 0) hat(v, 0, (s & 3) === 2 ? 0.45 : 0.28, s === 14 && bar % 2 === 0);
    if (s === 0 && (bar === 0 || bar === 4)) taiko(v, 0, 56, 0.85);
    if (step === 0 && this.loop > 0) crash(v, 0, 0.55);

    // 贝斯：八分音符推进
    if ((s & 1) === 0) {
      const off = this.bassPat[(s >> 1) & 7];
      bass(v, 0, mtof(bc.root + off), sd * 1.7, s === 0 ? 0.8 : 0.62, 0.55);
    }

    // 和声
    if (s === 0) pad(v, 0, bc.tones.map((m) => mtof(m + 12)), sd * 15, 0.32, 950);

    // 古筝：前半八分、后半十六分琶音
    if (second) {
      const k = this.arp16[s];
      guzheng(v, 0, mtof(bc.tones[k] + 24), (s & 3) === 0 ? 0.32 : 0.2, 0.55);
    } else if ((s & 1) === 0) {
      const k = this.arp8[(s >> 1) & 7];
      guzheng(v, 0, mtof(bc.tones[k] + 24), s === 0 ? 0.36 : 0.26, 0.8);
    }

    // 笛子主旋律：第一遍只在后半出现，之后前后都有
    const n = second ? this.melB[step - 64] : this.loop > 0 ? this.melA[step] : undefined;
    if (n) dizi(v, 0, mtof(n.m), n.len * sd, 0.62 * n.vel, n.grace);
  }
}

// ───────────── Boss ─────────────

const BOSS_BARS: BarChord[] = [
  { root: 33, tones: [45, 48, 52, 57] }, // Am
  { root: 33, tones: [45, 48, 52, 57] },
  { root: 34, tones: [46, 50, 53, 58] }, // Bb
  { root: 34, tones: [46, 50, 53, 58] },
  { root: 33, tones: [45, 48, 52, 57] }, // Am
  { root: 33, tones: [45, 48, 52, 57] },
  { root: 31, tones: [43, 47, 50, 55] }, // G
  { root: 28, tones: [40, 44, 47, 52] }, // E
];

export class BossTrack extends Track {
  readonly bpm = 150;
  readonly level = 0.8;
  readonly send = 0.2;
  private readonly kickPat = [1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0];
  private readonly kickPat2 = [1, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 1, 1, 0];
  private readonly run: number[];
  private readonly melA: (MelodyNote | undefined)[];
  private readonly melB: (MelodyNote | undefined)[];

  constructor() {
    super();
    const scale = scaleNotes(69, DARK_PENTA, 69, 96);
    this.melA = genMelody(5501, scale, 76, 64, 0.62, [2, 2, 4, 4, 6], 9);
    this.melB = genMelody(5502, scale, 81, 64, 0.78, [2, 2, 2, 2, 4], 9);
    // 下行快速音阶（古筝刮奏）
    this.run = scaleNotes(69, DARK_PENTA, 69, 93).reverse();
  }

  play(step: number, v: Voice): void {
    const sd = this.stepDur;
    const bar = step >> 4;
    const s = step & 15;
    const bc = BOSS_BARS[bar];
    const second = bar >= 4;
    const fillBar = bar === 7;

    // 鼓：双踩 + 军鼓 + 太鼓
    const kp = bar >= 6 ? this.kickPat2 : this.kickPat;
    if (kp[s]) kick(v, 0, 0.95);
    if (fillBar && s >= 8) {
      snare(v, 0, 0.35 + (s - 8) * 0.07);
    } else {
      if (s === 4 || s === 12) snare(v, 0, 0.85);
      if (s === 11) snare(v, 0, 0.22);
    }
    hat(v, 0, (s & 1) === 0 ? 0.34 : 0.17);
    if (second && (s & 3) === 0) taiko(v, 0, (s & 4) === 0 ? 50 : 64, 0.7);
    if (step === 0) {
      taiko(v, 0, 44, 1);
      crash(v, 0, 0.6);
      if (this.loop % 2 === 0) gong(v, 0, 73, 0.55, 3);
    }

    // 失真贝斯：十六分脉冲，每拍重音，逢 6 / 14 步八度跳
    const oct = s === 6 || s === 14 ? 12 : 0;
    bass(v, 0, mtof(bc.root + 12 + oct), sd * 0.9, (s & 3) === 0 ? 0.72 : 0.45, 0.7, true);

    // 铜管式 stab（第 3–4、7–8 小节）
    if ((bar === 2 || bar === 3 || bar === 6 || bar === 7) && (s === 2 || s === 10)) {
      stab(v, 0, [mtof(bc.root + 24), mtof(bc.root + 31), mtof(bc.root + 36)], 0.9);
    }

    // 暗色铺底
    if (s === 0) pad(v, 0, bc.tones.map((m) => mtof(m + 12)), sd * 15, 0.3, 700);

    // 古筝：前半轮指（同音快速反复），后半刮奏
    if (!second) {
      const top = bc.root + 36 + ((s & 4) === 0 ? 0 : 7);
      guzheng(v, 0, mtof(top), (s & 3) === 0 ? 0.3 : 0.17, 0.35);
    } else if (bar % 2 === 1 && s >= 8) {
      const i = (s - 8) * 2;
      guzheng(v, 0, mtof(this.run[i % this.run.length]), 0.26, 0.4);
    }

    // 笛子：第一遍只有后半，之后前半低一些、后半高亢
    const n = second ? this.melB[step - 64] : this.loop > 0 ? this.melA[step] : undefined;
    if (n) dizi(v, 0, mtof(n.m), n.len * sd, 0.6 * n.vel, n.grace);
  }
}
