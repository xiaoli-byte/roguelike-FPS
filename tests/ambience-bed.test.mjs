import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// 环境声床的 AudioWorklet 处理器（src/audio/ambienceWorklet.ts）：在 Node 里离线跑，量电平 / 亮度 / 开销
const source = stripTypeScriptTypes(await readFile(new URL('../src/audio/ambienceWorklet.ts', import.meta.url), 'utf8'), { mode: 'transform' });
const { AMBIENCE_WORKLET_SRC, AMBIENCE_DEFAULTS } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const SR = 48000;

function processor(params) {
  let Cls = null;
  class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
  // 处理器只在构造时用一次 Math.random 播种：固定下来，每次跑出一样的声音（测试不飘）
  const seeded = Object.create(Math, { random: { value: () => 0.3711 } });
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'Math', AMBIENCE_WORKLET_SRC)(AudioWorkletProcessor, (name, c) => {
    assert.equal(name, 'ambience-bed');
    Cls = c;
  }, SR, seeded);
  return new Cls({ processorOptions: { params: { ...AMBIENCE_DEFAULTS, ...params } } });
}

/** 跑 seconds 秒；from 秒之后的 RMS（dB）、峰值、亮度（Hz）；events: [{ at, msg }] */
function render(params, seconds = 4, from = 1.5, events = []) {
  const P = processor(params);
  const L = new Float32Array(128), R = new Float32Array(128);
  let ss = 0, n = 0, peak = 0, d2 = 0, prev = 0, bad = 0;
  for (let o = 0; o < seconds * SR; o += 128) {
    for (const e of events) if (e.at * SR >= o && e.at * SR < o + 128) P.port.onmessage({ data: e.msg });
    P.process([], [[L, R]], {});
    if (o < from * SR) continue;
    for (let i = 0; i < 128; i++) {
      if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) bad++;
      ss += L[i] * L[i] + R[i] * R[i]; n += 2;
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      d2 += (L[i] - prev) ** 2; prev = L[i];
    }
  }
  return { db: 10 * Math.log10(ss / n + 1e-20), peak, bright: SR / (2 * Math.PI) * Math.sqrt(d2 / (ss / 2 + 1e-20)), bad };
}

test('什么都不给（无风无雨无水）就是静音', () => {
  const r = render({ wind: 0 });
  assert.equal(r.bad, 0);
  assert.ok(r.peak < 1e-6, `peak ${r.peak}`);
});

test('全开（大风、暴雨、屋顶、滴水、江、溪、拍岸）也不出坏值、不过 0 dBFS', () => {
  const r = render({ wind: 1, exposure: 1, rain: 1, soft: 0.25, hard: 0.25, water: 0.25, snow: 0.25, roof: 1, indoor: 1, drip: 1, roar: 1, stream: 1, lap: 1 });
  assert.equal(r.bad, 0);
  assert.ok(r.peak <= 1, `peak ${r.peak}`);
  assert.ok(r.db > -40, `${r.db} dB`);
});

test('各层的响度落在设计区间（dBFS）：微风轻、山脊大风响、江边比溪响、雪上的雨几乎只剩远处雨嘶', () => {
  const breeze = render({ wind: 0.35 }).db;
  const gale = render({ wind: 0.9 }).db;
  const sheltered = render({ wind: 0.5, exposure: 0.3 }).db;
  const grass = render({ wind: 0, rain: 1, soft: 1 }).db;
  const snow = render({ wind: 0, rain: 1, soft: 0, snow: 1 }).db;
  const river = render({ wind: 0, roar: 1 }).db;
  const stream = render({ wind: 0, stream: 1 }).db;
  assert.ok(breeze < -26 && breeze > -40, `breeze ${breeze}`);
  assert.ok(gale > breeze + 6, `gale ${gale} vs breeze ${breeze}`);
  assert.ok(sheltered < breeze, `sheltered ${sheltered}`);
  assert.ok(grass > -36 && grass < -24, `rain on grass ${grass}`);
  assert.ok(snow < grass - 1, `snow ${snow} vs grass ${grass}`);
  assert.ok(river > -26 && river > stream, `river ${river} stream ${stream}`);
});

test('雨刚起时（雨强从 0 往上爬）颗粒照样按新的雨强到达——不会被雨小时算出的超长间隔卡住', () => {
  // 先 2 秒没雨，再变暴雨（落在岩石上），看第 3–4 秒有没有「嗒」：岩面雨比只有雨嘶响得多
  const onRock = render({ wind: 0, rain: 0, soft: 0, hard: 1 }, 4, 3, [{ at: 2, msg: { type: 'p', p: { rain: 1 } } }]).db;
  const washOnly = render({ wind: 0, rain: 0, soft: 0, snow: 1 }, 4, 3, [{ at: 2, msg: { type: 'p', p: { rain: 1 } } }]).db;
  assert.ok(onRock > washOnly + 2, `rock ${onRock} vs wash ${washOnly}`);
});

test('屋里（indoor）把外面的雨嘶闷掉：更暗；头顶的雨（roof）在屋里照样清楚', () => {
  const out = render({ wind: 0, rain: 1, soft: 1 });
  const inside = render({ wind: 0, rain: 1, soft: 1, indoor: 1 });
  assert.ok(inside.bright < out.bright * 0.6, `bright ${inside.bright} vs ${out.bright}`);
  const roof = render({ wind: 0, rain: 1, soft: 1, roof: 1, indoor: 1 });
  assert.ok(roof.db > inside.db + 3, `roof ${roof.db} vs muffled ${inside.db}`);
});

test('雷：近雷比远雷响、远雷更低沉', () => {
  const near = render({ wind: 0 }, 9, 2, [{ at: 2, msg: { type: 'thunder', dist: 150, pan: 0 } }]);
  const far = render({ wind: 0 }, 9, 2, [{ at: 2, msg: { type: 'thunder', dist: 4000, pan: 0 } }]);
  assert.equal(near.bad + far.bad, 0);
  assert.ok(near.db > far.db + 8, `near ${near.db} far ${far.db}`);
  assert.ok(far.bright < near.bright, `bright far ${far.bright} near ${near.bright}`);
  assert.ok(near.peak <= 1);
});

test('开销：暴雨 + 大风 + 江一秒音频在 Node 里算得远快于实时', () => {
  const P = processor({ wind: 0.8, rain: 1, soft: 0.5, hard: 0.3, water: 0.2, roar: 1, stream: 0.5 });
  const L = new Float32Array(128), R = new Float32Array(128);
  for (let o = 0; o < SR; o += 128) P.process([], [[L, R]], {});   // 热身 + 参数平滑
  const t0 = performance.now();
  for (let o = 0; o < SR * 2; o += 128) P.process([], [[L, R]], {});
  const ms = (performance.now() - t0) / 2;
  assert.ok(ms < 250, `${ms.toFixed(1)} ms per second of audio`);
});
