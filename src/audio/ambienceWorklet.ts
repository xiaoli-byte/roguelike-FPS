/**
 * 环境声床的 AudioWorklet 处理器（docs/art/reference-tingyuyuan.md 第四节第 9 项，做法照《听雨园》的颗粒雨声 / 风声）。
 * 源码以字符串导出：AmbienceBed 用 Blob URL 载入；tests/ambience-bed.test.mjs 直接求值、离线跑。
 *
 * 全部现场合成、永远不重复：
 *  - 风：两路去相关的棕噪声低通（风身，截止频率跟着阵风走）+ 两个带通的呜咽 + 阵风大时一根细哨音；阵风是处理器里自己的慢随机。
 *  - 雨：远处的雨嘶（粉噪声带通，左右去相关）+ 近处一颗颗雨滴的「颗粒」，按泊松随机到达，按周围表面分池：
 *      软（草 / 土：低通噪声短促的「噗」）、硬（岩、石、木：短的共振「嗒」）、水（多数是「啪」，四分之一是上滑的气泡音「叮」）、
 *      雪（几乎不出声）、头顶（雨打屋顶 / 桥面：密的低一点的共振「嗒」，在头上）、檐口滴水（稀疏的大水滴「咚」，偏向檐口那边）。
 *  - 水：大江大河的轰鸣（棕噪声低通 + 浪花嘶声，慢慢起伏）、溪流潺潺（一串串高低不同的气泡音 + 水嘶）、静水拍岸（带通噪声一下一下 + 小水声）。
 *  - 雷：近雷先一声炸裂（高通白噪声）再滚雷；远雷只有低沉的滚雷（棕噪声两级低通，几段错开的起伏），越远越低越长越轻。
 *  - 屋里 / 檐下：外面的声音整体低通（indoor），头顶的雨和滴水不低通。
 *
 * 主线程每 0.08 s 发一次参数（{type:'p', p}），处理器每 128 帧按 0.35 s 的时间常数平滑过去；雷是 {type:'thunder', dist, pan}。
 */

/** 声床参数（AmbienceSense 每帧填，AmbienceBed 发给处理器）；没特别说明的都是 0..1 */
export interface AmbienceParams {
  /** 总音量 */
  volume: number;
  /** 风的强度 */
  wind: number;
  /** 开阔度：山脊、空地 1；背风的沟里、墙脚、屋里低 */
  exposure: number;
  /** 风的声像（−1 左 .. 1 右，偏向上风） */
  windPan: number;
  /** 雨强 */
  rain: number;
  /** 周围 2–14 m 的表面：软（草 / 土）、硬（岩、石、木、屋顶）、水、雪；和为 1 */
  soft: number;
  hard: number;
  water: number;
  snow: number;
  /** 头顶有遮挡（雨打在屋顶 / 桥面 / 檐上） */
  roof: number;
  /** 被围起来的程度（屋里、檐下：外面的声音低通） */
  indoor: number;
  /** 檐口滴水的量（下雨时和雨停后还湿着的时候）与声像 */
  drip: number;
  dripPan: number;
  /** 大江大河的轰鸣与声像 */
  roar: number;
  roarPan: number;
  /** 溪流潺潺与声像 */
  stream: number;
  streamPan: number;
  /** 静水拍岸与声像 */
  lap: number;
  lapPan: number;
}

export const AMBIENCE_DEFAULTS: AmbienceParams = {
  volume: 1, wind: 0.3, exposure: 1, windPan: 0, rain: 0, soft: 1, hard: 0, water: 0, snow: 0, roof: 0, indoor: 0,
  drip: 0, dripPan: 0, roar: 0, roarPan: 0, stream: 0, streamPan: 0, lap: 0, lapPan: 0,
};

/** AudioWorkletProcessor 的源码（注册名 'ambience-bed'） */
export const AMBIENCE_WORKLET_SRC = /* js */ `
const DEFAULTS = ${JSON.stringify(AMBIENCE_DEFAULTS)};
const MAXG = 160;
const RES_GAIN = 30;
// 颗粒种类
const T_NOISE = 0, T_RES = 1, T_BUB = 2;
// 颗粒池
const P_SOFT = 0, P_HARD = 1, P_WATER = 2, P_SNOW = 3, P_ROOF = 4, P_DRIP = 5, P_BABBLE = 6, P_LAP = 7, POOLS = 8;
// 状态变量滤波器（Zavalishin TPT）：每个滤波器占 4 个系数（a1, a2, a3, k）、2 个状态
const F_WBL = 0, F_WBR = 1, F_H1 = 2, F_H2 = 3, F_WH = 4, F_RWL = 5, F_RWR = 6, F_ROL = 7, F_ROR = 8, F_RS = 9, F_ST = 10, F_LAP = 11, NF = 12;

function svfSet(cf, f, sr, fc, q) {
  const g = Math.tan(Math.PI * Math.min(fc, sr * 0.45) / sr), k = 1 / q, a1 = 1 / (1 + g * (g + k));
  const o = f * 4;
  cf[o] = a1; cf[o + 1] = g * a1; cf[o + 2] = g * g * a1; cf[o + 3] = k;
}
function svfLow(st, cf, f, x) {
  const i = f * 2, o = f * 4, ic1 = st[i], ic2 = st[i + 1];
  const v3 = x - ic2, v1 = cf[o] * ic1 + cf[o + 1] * v3, v2 = ic2 + cf[o + 1] * ic1 + cf[o + 2] * v3;
  st[i] = 2 * v1 - ic1; st[i + 1] = 2 * v2 - ic2;
  return v2;
}
function svfBand(st, cf, f, x) {
  const i = f * 2, o = f * 4, ic1 = st[i], ic2 = st[i + 1];
  const v3 = x - ic2, v1 = cf[o] * ic1 + cf[o + 1] * v3, v2 = ic2 + cf[o + 1] * ic1 + cf[o + 2] * v3;
  st[i] = 2 * v1 - ic1; st[i + 1] = 2 * v2 - ic2;
  return v1;
}
function panL(p) { return Math.cos((Math.max(-1, Math.min(1, p)) + 1) * Math.PI / 4) * Math.SQRT2; }
function panR(p) { return Math.sin((Math.max(-1, Math.min(1, p)) + 1) * Math.PI / 4) * Math.SQRT2; }
function clip(x) {
  const a = Math.abs(x);
  if (a < 0.6) return x;
  const y = 0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4);
  return x < 0 ? -y : y;
}

class AmbienceBedProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.sr = sampleRate;
    this.tg = Object.assign({}, DEFAULTS, options && options.processorOptions && options.processorOptions.params || {});
    this.c = Object.assign({}, DEFAULTS);
    this.c.wind = 0; this.c.volume = 0;
    this.u = (Math.random() * 2147483647) | 0 || 1234567;
    this.cf = new Float32Array(NF * 4);
    this.st = new Float32Array(NF * 2);
    // 噪声状态：粉噪声 4 路（风呜咽、雨嘶左、雨嘶右、水）× 3；棕噪声 4 路（风左、风右、江左、江右）
    this.pk = new Float32Array(12);
    this.bn = new Float32Array(4);
    this.op = new Float32Array(8);   // 一阶滤波状态：雨嘶高通左右、拍岸低通、屋里低通左右
    this.gust = 0.4; this.gustTarget = 0.4; this.gustT = 0;
    this.time = 0;
    this.gk = new Int8Array(MAXG).fill(-1);
    this.gdl = new Int32Array(MAXG);
    this.ge = new Float32Array(MAXG);
    this.gdec = new Float32Array(MAXG);
    this.ga = new Float32Array(MAXG);
    this.gb = new Float32Array(MAXG);
    this.gy1 = new Float32Array(MAXG);
    this.gy2 = new Float32Array(MAXG);
    this.gw = new Float32Array(MAXG);
    this.gph = new Float32Array(MAXG);
    this.gx = new Float32Array(MAXG);
    this.gxd = new Float32Array(MAXG);
    this.gn = new Float32Array(MAXG);
    this.gl = new Float32Array(MAXG);
    this.gr = new Float32Array(MAXG);
    this.gin = new Uint8Array(MAXG);
    this.gfree = 0;
    this.next = new Float64Array(POOLS).fill(-1);
    this.th = [];
    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.type === 'p') Object.assign(this.tg, d.p);
      else if (d.type === 'thunder') this.thunder(+d.dist || 1000, +d.pan || 0);
    };
  }

  rnd() { let s = this.u; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.u = s; return (s >>> 0) / 4294967296; }
  logu(a, b) { return a * Math.pow(b / a, this.rnd()); }

  /** 起一颗颗粒；返回槽位（满了 = −1） */
  grain(kind, delay, amp, pan, inside) {
    let i = -1;
    for (let n = 0; n < MAXG; n++) {
      const j = (this.gfree + n) % MAXG;
      if (this.gk[j] < 0) { i = j; break; }
    }
    if (i < 0) return -1;
    this.gfree = (i + 1) % MAXG;
    this.gk[i] = kind; this.gdl[i] = delay; this.ge[i] = amp;
    this.gy1[i] = 0; this.gy2[i] = 0; this.gph[i] = 0; this.gx[i] = 0; this.gxd[i] = 0;
    this.gl[i] = panL(pan); this.gr[i] = panR(pan); this.gin[i] = inside ? 1 : 0;
    return i;
  }
  noiseGrain(delay, amp, pan, fc, tau, inside) {
    const i = this.grain(T_NOISE, delay, amp, pan, inside);
    if (i < 0) return;
    this.ga[i] = 1 - Math.exp(-2 * Math.PI * fc / this.sr);
    this.gdec[i] = Math.exp(-1 / (tau * this.sr));
  }
  resGrain(delay, amp, pan, f, tau, inside) {
    const i = this.grain(T_RES, delay, amp, pan, inside);
    if (i < 0) return;
    const r = Math.exp(-1 / (tau * this.sr));
    this.ga[i] = 2 * r * Math.cos(2 * Math.PI * Math.min(f, this.sr * 0.45) / this.sr);
    this.gb[i] = r * r;
    this.gdec[i] = r;
    this.gn[i] = (1 - r) * RES_GAIN;                  // 共振器的增益归一（短的、高的不会比长的低的响太多）
    this.gx[i] = 1; this.gxd[i] = Math.exp(-1 / (0.0004 * this.sr));
  }
  bubble(delay, amp, pan, f0, tau, rise, inside) {
    const i = this.grain(T_BUB, delay, amp, pan, inside);
    if (i < 0) return;
    this.gw[i] = 2 * Math.PI * f0 / this.sr;
    this.gb[i] = Math.exp(Math.log(rise) / (tau * 3 * this.sr));   // 音高上滑：三个时间常数里升 rise 倍
    this.gdec[i] = Math.exp(-1 / (tau * this.sr));
    this.gx[i] = 0.35; this.gxd[i] = Math.exp(-1 / (0.0006 * this.sr));
  }

  /** 每个池一颗颗粒的样子 */
  spawn(pool, delay) {
    const c = this.c, u = this.rnd();
    const near = 0.04 + 0.96 * u * u * u * u;          // 大多数很轻，偶尔一颗落在耳边
    const pan = this.rnd() * 2 - 1;
    switch (pool) {
      case P_SOFT: this.noiseGrain(delay, 0.26 * near, pan, this.logu(700, 2600), 0.003 + 0.006 * this.rnd(), false); break;
      case P_SNOW: this.noiseGrain(delay, 0.06 * near, pan, this.logu(400, 900), 0.004 + 0.006 * this.rnd(), false); break;
      case P_HARD: this.resGrain(delay, 0.11 * near, pan, this.logu(2200, 7000), 0.0012 + 0.003 * this.rnd(), false); break;
      case P_WATER:
        if (this.rnd() < 0.25) this.bubble(delay, 0.16 * near, pan, this.logu(1200, 3800), 0.005 + 0.014 * this.rnd(), 1.25 + 0.3 * this.rnd(), false);
        else this.noiseGrain(delay, 0.2 * near, pan, this.logu(1800, 4500), 0.002 + 0.003 * this.rnd(), false);
        break;
      case P_ROOF: this.resGrain(delay, 0.05 * (0.1 + 0.9 * u * u * u), pan * 0.5, this.logu(600, 2600), 0.002 + 0.004 * this.rnd(), true); break;
      case P_DRIP:
        this.bubble(delay, 0.1 + 0.1 * this.rnd(), c.dripPan + pan * 0.25, this.logu(450, 1200), 0.02 + 0.03 * this.rnd(), 1.3, true);
        if (this.rnd() < 0.5) this.noiseGrain(delay, 0.05, c.dripPan + pan * 0.25, 2200, 0.004, true);
        break;
      case P_BABBLE: this.bubble(delay, 0.03 + 0.09 * u * u, c.streamPan + pan * 0.35, this.logu(250, 1400), 0.006 + 0.024 * this.rnd(), 1.2 + 0.6 * this.rnd(), false); break;
      case P_LAP: this.bubble(delay, 0.03 + 0.04 * u, c.lapPan + pan * 0.4, this.logu(600, 1600), 0.01 + 0.02 * this.rnd(), 1.3, false); break;
    }
  }

  rate(pool) {
    const c = this.c, R = Math.pow(c.rain, 1.2), out = 1 - 0.8 * c.roof;
    switch (pool) {
      case P_SOFT: return 480 * R * c.soft * out;
      case P_HARD: return 600 * R * c.hard * out;
      case P_WATER: return 420 * R * c.water * out;
      case P_SNOW: return 150 * R * c.snow * out;
      case P_ROOF: return 1400 * R * c.roof;
      case P_DRIP: return 4 * c.drip;
      case P_BABBLE: return 110 * c.stream;
      case P_LAP: return 5 * c.lap;
    }
    return 0;
  }

  /** 一声雷：几段错开的起伏组成的滚雷；近的（< 500 m）先炸一声 */
  thunder(dist, pan) {
    if (this.th.length >= 4) this.th.shift();
    const sr = this.sr, dur = 2 + Math.min(5, dist / 900);
    const bursts = [];
    const n = 3 + Math.floor(this.rnd() * 5);
    for (let k = 0; k < n; k++) {
      bursts.push({
        at: k === 0 ? 0 : this.rnd() * dur * 0.7,
        att: (dist < 500 ? 0.02 : 0.12) + this.rnd() * (dist < 500 ? 0.08 : 0.35),
        dec: 0.4 + this.rnd() * 1.3,
        amp: k === 0 ? 1 : 0.35 + 0.65 * this.rnd(),
      });
    }
    this.th.push({
      t: 0, end: (dur + 6) * sr, bursts,
      crack: dist < 500 ? 1.3 / (1 + dist / 80) : 0, crackTau: 0.03 + dist / 4000,
      rumble: 1.2 / (1 + dist / 700),
      a: 1 - Math.exp(-2 * Math.PI * (70 + 700 / (1 + dist / 250)) / sr),
      y1: 0, y2: 0, b: 0, hp: 0, l: panL(pan * 0.8), r: panR(pan * 0.8),
    });
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const L = out[0], Rr = out[1] || null, n = L.length, sr = this.sr, dts = n / sr;
    // ── 参数平滑、每块的系数 ──
    const c = this.c, tg = this.tg, k = 1 - Math.exp(-dts / 0.35);
    for (const key in tg) c[key] += (tg[key] - c[key]) * k;
    this.time += dts;
    this.gustT -= dts;
    if (this.gustT <= 0) {
      this.gustTarget = 0.1 + 0.9 * Math.pow(this.rnd(), 0.8) * (0.6 + 0.4 * c.wind);
      this.gustT = 1 + 4 * this.rnd();
    }
    this.gust += (this.gustTarget - this.gust) * (1 - Math.exp(-dts / 1.1));
    const g = this.gust, cf = this.cf, st = this.st;
    svfSet(cf, F_WBL, sr, 160 + 520 * g, 0.8); svfSet(cf, F_WBR, sr, 170 + 540 * g, 0.8);
    svfSet(cf, F_H1, sr, 300 + 520 * g, 5); svfSet(cf, F_H2, sr, (300 + 520 * g) * 1.62, 7);
    svfSet(cf, F_WH, sr, 1100 + 700 * g, 25);
    svfSet(cf, F_RWL, sr, 6500 - 5200 * c.indoor, 0.7); svfSet(cf, F_RWR, sr, 6300 - 5000 * c.indoor, 0.7);
    svfSet(cf, F_ROL, sr, 420, 0.7); svfSet(cf, F_ROR, sr, 440, 0.7);
    svfSet(cf, F_RS, sr, 1500, 0.6); svfSet(cf, F_ST, sr, 900, 0.8); svfSet(cf, F_LAP, sr, 520, 0.7);
    const t = this.time;
    const W = c.wind * (0.25 + 0.75 * c.exposure) * (1 - 0.6 * c.indoor);
    const wBody = W * (0.5 + 0.7 * g) * 0.6;
    const wHowl = W * g * g * 0.32 * c.exposure;
    const wWhis = W * Math.pow(Math.max(0, g - 0.55), 2) * 1.6 * c.exposure;
    const hl = panL(c.windPan * 0.5), hr = panR(c.windPan * 0.5);
    const wash = Math.pow(c.rain, 1.3) * 0.11;
    const roarM = 1 + 0.1 * Math.sin(t * 0.37) + 0.07 * Math.sin(t * 1.13 + 2);
    const roar = c.roar * 0.5 * roarM, rl = panL(c.roarPan), rrp = panR(c.roarPan);
    const stream = c.stream * 0.07, sl = panL(c.streamPan), srp = panR(c.streamPan);
    const wave = Math.max(0, Math.sin(t * 2.3) * 0.6 + Math.sin(t * 1.37 + 1.3) * 0.5 + 0.15);
    const lap = c.lap * (0.05 + 0.16 * wave) * 1.2, ll = panL(c.lapPan), lr = panR(c.lapPan);
    const aHp = 1 - Math.exp(-2 * Math.PI * 500 / sr);
    const aLap = 1 - Math.exp(-2 * Math.PI * 1400 / sr);
    const aIn = 1 - Math.exp(-2 * Math.PI * (18000 * Math.pow(1200 / 18000, c.indoor)) / sr);
    const vol = c.volume * 0.9;
    // ── 这一块里到达的颗粒（泊松）：next 存的是「到下一颗还差多少累计到达率」（单位 1 的指数分布），
    //    每块减掉 rate × 块长——雨强怎么变都对（存成样本数的话，雨刚起时算出的间隔会长得离谱）
    for (let p = 0; p < POOLS; p++) {
      const r = this.rate(p);
      if (r < 1e-3) continue;
      const h = r * dts;
      let e = this.next[p] < 0 ? -Math.log(1 - this.rnd()) : this.next[p], used = 0;
      while (e <= h - used) {
        used += e;
        this.spawn(p, Math.min(n - 1, Math.floor(used / r * sr)));
        e = -Math.log(1 - this.rnd());
      }
      this.next[p] = e - (h - used);
    }
    const pk = this.pk, bn = this.bn, op = this.op;
    const gk = this.gk, gdl = this.gdl, ge = this.ge, gdec = this.gdec, ga = this.ga, gb = this.gb, gy1 = this.gy1, gy2 = this.gy2;
    const gw = this.gw, gph = this.gph, gx = this.gx, gxd = this.gxd, gn = this.gn, gl = this.gl, gr = this.gr, gin = this.gin;
    // 活着的颗粒（这一块里只遍历它们）
    const live = [];
    for (let i = 0; i < MAXG; i++) if (gk[i] >= 0) live.push(i);
    const th = this.th;
    let s = this.u;
    for (let j = 0; j < n; j++) {
      // 白噪声 → 粉噪声 / 棕噪声
      let oL = 0, oR = 0, iL = 0, iR = 0;
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const w0 = (s | 0) / 2147483648;
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const w1 = (s | 0) / 2147483648;
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const w2 = (s | 0) / 2147483648;
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const w3 = (s | 0) / 2147483648;
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const w4 = (s | 0) / 2147483648;
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const w5 = (s | 0) / 2147483648;
      // 风
      if (W > 1e-4) {
        bn[0] = (bn[0] + 0.02 * w0) / 1.02; bn[1] = (bn[1] + 0.02 * w1) / 1.02;
        pk[0] = 0.99765 * pk[0] + w2 * 0.099046; pk[1] = 0.963 * pk[1] + w2 * 0.2965164; pk[2] = 0.57 * pk[2] + w2 * 1.0526913;
        const pinkH = (pk[0] + pk[1] + pk[2] + w2 * 0.1848) * 0.25;
        const howl = (svfBand(st, cf, F_H1, pinkH) + 0.7 * svfBand(st, cf, F_H2, pinkH)) * wHowl + svfBand(st, cf, F_WH, w3) * wWhis;
        oL += svfLow(st, cf, F_WBL, bn[0] * 3.5) * wBody + howl * hl;
        oR += svfLow(st, cf, F_WBR, bn[1] * 3.5) * wBody + howl * hr;
      }
      // 远处的雨嘶（左右去相关）
      if (wash > 1e-4) {
        pk[3] = 0.99765 * pk[3] + w3 * 0.099046; pk[4] = 0.963 * pk[4] + w3 * 0.2965164; pk[5] = 0.57 * pk[5] + w3 * 1.0526913;
        pk[6] = 0.99765 * pk[6] + w4 * 0.099046; pk[7] = 0.963 * pk[7] + w4 * 0.2965164; pk[8] = 0.57 * pk[8] + w4 * 1.0526913;
        const xl = (pk[3] + pk[4] + pk[5] + w3 * 0.1848) * 0.25, xr = (pk[6] + pk[7] + pk[8] + w4 * 0.1848) * 0.25;
        op[0] += aHp * (xl - op[0]); op[1] += aHp * (xr - op[1]);
        oL += svfLow(st, cf, F_RWL, xl - op[0]) * wash;
        oR += svfLow(st, cf, F_RWR, xr - op[1]) * wash;
      }
      // 水：江的轰鸣、溪的水嘶、拍岸
      if (roar > 1e-4 || stream > 1e-4 || lap > 1e-4) {
        pk[9] = 0.99765 * pk[9] + w5 * 0.099046; pk[10] = 0.963 * pk[10] + w5 * 0.2965164; pk[11] = 0.57 * pk[11] + w5 * 1.0526913;
        const pw = (pk[9] + pk[10] + pk[11] + w5 * 0.1848) * 0.25;
        if (roar > 1e-4) {
          bn[2] = (bn[2] + 0.02 * w0) / 1.02; bn[3] = (bn[3] + 0.02 * w1) / 1.02;
          const spray = svfBand(st, cf, F_RS, pw) * 0.35;
          oL += (svfLow(st, cf, F_ROL, bn[2] * 3.5) + spray) * roar * rl;
          oR += (svfLow(st, cf, F_ROR, bn[3] * 3.5) + spray) * roar * rrp;
        }
        if (stream > 1e-4) { const h = svfBand(st, cf, F_ST, pw) * stream; oL += h * sl; oR += h * srp; }
        if (lap > 1e-4) { op[2] += aLap * (svfBand(st, cf, F_LAP, pw) - op[2]); oL += op[2] * lap * ll; oR += op[2] * lap * lr; }
      }
      // 颗粒
      for (let q = 0; q < live.length; q++) {
        const i = live[q];
        if (gk[i] < 0) continue;
        if (gdl[i] > 0) { gdl[i]--; continue; }
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const wn = (s | 0) / 2147483648;
        let v;
        const kind = gk[i];
        if (kind === T_NOISE) {
          gy1[i] += ga[i] * (wn - gy1[i]);
          v = gy1[i] * ge[i];
        } else if (kind === T_RES) {
          const x = wn * gx[i];
          gx[i] *= gxd[i];
          const y = x + ga[i] * gy1[i] - gb[i] * gy2[i];
          gy2[i] = gy1[i]; gy1[i] = y;
          v = y * gn[i] * ge[i];
        } else {
          v = (Math.sin(gph[i]) + wn * gx[i]) * ge[i];
          gph[i] += gw[i]; gw[i] *= gb[i]; gx[i] *= gxd[i];
        }
        if (kind !== T_RES) ge[i] *= gdec[i];
        if (gin[i]) { iL += v * gl[i]; iR += v * gr[i]; } else { oL += v * gl[i]; oR += v * gr[i]; }
        if (kind === T_RES) { if ((Math.abs(gy1[i]) + Math.abs(gy2[i])) * gn[i] * ge[i] < 3e-5 && gx[i] < 1e-3) gk[i] = -1; }
        else if (ge[i] < 3e-4) gk[i] = -1;
      }
      // 雷
      for (let q = 0; q < th.length; q++) {
        const T = th[q], ts = T.t / sr;
        let env = 0;
        for (let b = 0; b < T.bursts.length; b++) {
          const B = T.bursts[b], x = ts - B.at;
          if (x <= 0) continue;
          env += B.amp * (x < B.att ? x / B.att : Math.exp(-(x - B.att) / B.dec));
        }
        T.b = (T.b + 0.02 * w4) / 1.02;
        T.y1 += T.a * (T.b * 3.5 - T.y1); T.y2 += T.a * (T.y1 - T.y2);
        let v = T.y2 * env * T.rumble;
        if (T.crack > 0) {
          T.hp += 0.15 * (w5 - T.hp);
          const ce = ts < 0.002 ? ts / 0.002 : Math.exp(-(ts - 0.002) / T.crackTau);
          v += (w5 - T.hp) * ce * T.crack;
        }
        oL += v * T.l; oR += v * T.r;
        T.t++;
      }
      // 屋里：外面的声音低通；头顶的雨和滴水不过这道
      op[3] += aIn * (oL - op[3]); op[4] += aIn * (oR - op[4]);
      L[j] = clip((op[3] + iL) * vol);
      if (Rr) Rr[j] = clip((op[4] + iR) * vol);
    }
    this.u = s;
    for (let q = th.length - 1; q >= 0; q--) if (th[q].t > th[q].end) th.splice(q, 1);
    return true;
  }
}
registerProcessor('ambience-bed', AmbienceBedProcessor);
`;
