// 后处理栈（M11a）：Volume Profile 导出、URP Neutral 曲线、LDR 调色 LUT、Volume 混合、玩法屏效。
// Profile 导出的数和 Unity 资产（文本 YAML）逐个对：这里用一个和导出器无关的正则读法，免得两边错到一起。
// Neutral / LUT 对照 URP 17.5 的着色器公式（unity/Library/PackageCache 里的源码，见 src/render/UrpColor.ts 开头）。
// 玩法屏效照搬 Unity EditMode 的 GraphicsAudioTests.GameplayVolumes_Curves。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';

const root = new URL('../', import.meta.url);
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  return import(data(stripTypeScriptTypes(source, { mode: 'transform' })));
}
const color = await ts('../src/render/UrpColor.ts');
const volume = await ts('../src/render/UrpVolume.ts');
// GameplayVolumes 只 import 了类型：去掉类型后没有别的依赖
const gameplay = await ts('../src/render/GameplayVolumes.ts');
const doc = JSON.parse(readFileSync(new URL('public/assets/unity-levels/volumes.json', root), 'utf8'));

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≠ ${b}（±${eps}）`);

// ───────────── Profile 导出 ─────────────

/** 独立的读法：按 `m_Name: 组件` 切块，取 `参数:\n  m_OverrideState: 1\n  m_Value: …` */
function readAsset(path) {
  const text = readFileSync(new URL(`unity/${path}`, root), 'utf8').replace(/\r\n/g, '\n');
  const out = {};
  for (const block of text.split(/^--- !u!114 &-?\d+\n/m).slice(1)) {
    const name = /^ {2}m_Name: (\S+)$/m.exec(block)?.[1];
    if (!name) continue;
    const params = {};
    const re = /^ {2}(\w+):\n {4}m_OverrideState: 1\n {4}m_Value: (.+)$/gm;
    for (let m = re.exec(block); m; m = re.exec(block)) {
      const raw = m[2].trim();
      params[m[1]] = raw.startsWith('{') ? [...raw.matchAll(/(\w+): (-?[\d.e+-]+)/g)].map(x => Number(x[2])) : Number(raw);
    }
    out[name] = { active: /^ {2}active: 1$/m.test(block), params };
  }
  return out;
}

test('volumes.json 的每个参数都等于 Unity 资产里的值', () => {
  let checked = 0;
  for (const [path, profile] of Object.entries(doc.profiles)) {
    const asset = readAsset(path);
    for (const [name, comp] of Object.entries(profile.components)) {
      assert.ok(asset[name], `${path} 没有 ${name}`);
      assert.equal(comp.active, asset[name].active, `${path} ${name}.active`);
      for (const [param, value] of Object.entries(comp)) {
        if (param === 'active') continue;
        const expected = asset[name].params[param];
        assert.notEqual(expected, undefined, `${path} ${name}.${param} 在资产里没勾 override`);
        if (Array.isArray(value)) assert.deepEqual(value, expected, `${path} ${name}.${param}`);
        else if (typeof value === 'boolean') assert.equal(value, expected !== 0, `${path} ${name}.${param}`);
        else assert.equal(value, expected, `${path} ${name}.${param}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 300, `只核对了 ${checked} 个参数`);
});

test('1-1 VP_Desert：抽查关键数（Inspector 里的值）', () => {
  const s = doc.scenes['1-1'];
  assert.equal(s.scene, 'Assets/Scenes/L1_1_GobiRoad.unity');
  assert.deepEqual(s.volumes.map(v => [v.profile, v.global, v.priority, v.weight]), [['Assets/Levels/L1_1_GobiRoad/VP_Desert.asset', true, 0, 1]]);
  const r = s.resolved;
  assert.equal(r.Tonemapping.mode, volume.TONEMAP_NEUTRAL);
  assert.equal(r.ColorAdjustments.postExposure, -0.919);
  assert.equal(r.ColorAdjustments.contrast, 24.4);
  assert.equal(r.ColorAdjustments.saturation, -11);
  assert.deepEqual([r.WhiteBalance.temperature, r.WhiteBalance.tint], [-9.5, -0.5]);
  assert.deepEqual([r.LiftGammaGain.lift[3], r.LiftGammaGain.gamma[3], r.LiftGammaGain.gain[3]], [-0.007, 0.258, -0.084]);
  assert.deepEqual([r.Bloom.threshold, r.Bloom.intensity, r.Bloom.scatter, r.Bloom.maxIterations], [1, 0.496, 0.65, 6]);
  assert.deepEqual(r.Bloom.tint, [1, 0.9, 0.78, 1]);
  assert.deepEqual([r.Vignette.intensity, r.Vignette.smoothness, r.Vignette.rounded], [0.276, 0.45, false]);
  assert.deepEqual([r.FirstPersonExposure.multiplier, r.FirstPersonExposure.gamma], [2.755, 1.2]);
  assert.equal(r.ChromaticAberration.intensity, 0, '关卡不开色差（玩法 Volume 才开）');
  assert.equal(doc.pipeline.colorGradingMode, 'LowDynamicRange');
  assert.equal(doc.pipeline.lutSize, 32);
});

test('3-3 局部 Volume（火神王座）：盒子、优先级、混合距离；2-A 的第二个全局 Volume', () => {
  const local = doc.scenes['3-3'].volumes.find(v => !v.global);
  assert.equal(local.profile, 'Assets/Levels/L3_3_Foundry/VP_FireGodThrone.asset');
  assert.deepEqual([local.priority, local.blendDistance, local.weight], [20, 48, 1]);
  // Unity (152, 28, 164)、BoxCollider 136 × 100 × 136 → 网页 x 取反
  assert.deepEqual(local.boxes, [{ center: [-152, 28, 164], halfSize: [68, 50, 68], rotation: [0, 0, 0, 1] }]);
  const look = doc.scenes['2-A'].volumes.find(v => v.priority === 5);
  assert.equal(look.profile, 'Assets/Levels/L2_A_Crevasse/LV_L2A_Look.asset');
  assert.deepEqual(doc.scenes['2-A'].resolved.ShadowsMidtonesHighlights.shadows, [1, 1.02, 1.06, 0.06]);
  assert.equal(doc.scenes['2-A'].resolved.ColorAdjustments.postExposure, -0.62, '优先级 5 的盖过 0 的');
});

// Unity 版已冻结：工作区里编辑器重存过、没提交的 Volume 资产不算数（入库的 volumes.json 按已提交的资产生成）
const volumeSources = ['unity/Assets/Levels', 'unity/Assets/Scenes', 'unity/Assets/Settings'];
const dirtyUnity = spawnSync('git', ['status', '--porcelain', '--', ...volumeSources], { cwd: root, encoding: 'utf8' }).stdout?.trim();

test('导出器 --check：入库的 volumes.json 和当前 Unity 资产一致', { skip: dirtyUnity ? 'Unity 场景 / Volume 资产有未提交的改动' : false }, () => {
  const r = spawnSync(process.execPath, ['scripts/web/export-volume-profiles.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

// ───────────── Neutral ─────────────

/** URP Color.hlsl 的 NeutralCurve / NeutralTonemap，照抄一遍做对照 */
function urpNeutral(x) {
  const a = 0.2, b = 0.29, c = 0.24, d = 0.272, e = 0.02, f = 0.3;
  const curve = v => ((v * (a * v + c * b) + d * e) / (v * (a * v + b) + d * f)) - e / f;
  const ws = 1 / curve(5.3);
  return curve(Math.max(0, x) * ws) * ws;
}

test('URP Neutral：白点缩放 ≈ 1.31338（URP 注释里的数），抽查各段', () => {
  close(color.NEUTRAL_WHITE_SCALE, 1.31338, 1e-5);
  for (const x of [0, 0.001, 0.01, 0.05, 0.18, 0.5, 1, 2, 4, 5.3, 10, 100]) close(color.neutralTonemap(x), urpNeutral(x), 1e-12, `x=${x}`);
  assert.equal(color.neutralTonemap(0), 0);
  assert.equal(color.neutralTonemap(-1), 0, '负数先夹 0');
  // 输出到 1 的输入 = 5.3 / 白点缩放
  close(color.neutralTonemap(5.3 / color.NEUTRAL_WHITE_SCALE), 1, 1e-12);
  // 几个手算值（用 URP 公式在别处算的，保留 5 位）
  close(color.neutralTonemap(0.18), 0.18167, 5e-5, '中灰几乎不动');
  close(color.neutralTonemap(1), 0.63112, 5e-5, '1.0');
  close(color.neutralTonemap(2), 0.83884, 5e-5, '2.0');
  // 和 three 的 NeutralToneMapping（Khronos PBR Neutral）不是一回事：中灰那里就差很多
  // Khronos PBR Neutral 对灰（r = g = b）：x < 0.08 时减 x − 6.25x²，否则减 0.04；0.76 以下不压
  const khronos = x => {
    const v = x - (x < 0.08 ? x - 6.25 * x * x : 0.04);
    if (v < 0.76) return v;
    const d = 0.24;
    return 1 - d * d / (v + d - 0.76);
  };
  assert.ok(Math.abs(khronos(0.18) - color.neutralTonemap(0.18)) > 0.02);
});

// ───────────── LUT ─────────────

const identity = {
  temperature: 0, tint: 0, contrast: 0, colorFilter: [1, 1, 1, 1], hueShift: 0, saturation: 0,
  lift: [1, 1, 1, 0], gamma: [1, 1, 1, 0], gain: [1, 1, 1, 0],
  shadows: [1, 1, 1, 0], midtones: [1, 1, 1, 0], highlights: [1, 1, 1, 0], shadowsStart: 0, shadowsEnd: 0.3, highlightsStart: 0.55, highlightsEnd: 1,
};
const gradingOf = r => ({
  temperature: r.WhiteBalance.temperature, tint: r.WhiteBalance.tint, contrast: r.ColorAdjustments.contrast, colorFilter: r.ColorAdjustments.colorFilter,
  hueShift: r.ColorAdjustments.hueShift, saturation: r.ColorAdjustments.saturation,
  lift: r.LiftGammaGain.lift, gamma: r.LiftGammaGain.gamma, gain: r.LiftGammaGain.gain,
  shadows: r.ShadowsMidtonesHighlights.shadows, midtones: r.ShadowsMidtonesHighlights.midtones, highlights: r.ShadowsMidtonesHighlights.highlights,
  shadowsStart: r.ShadowsMidtonesHighlights.shadowsStart, shadowsEnd: r.ShadowsMidtonesHighlights.shadowsEnd,
  highlightsStart: r.ShadowsMidtonesHighlights.highlightsStart, highlightsEnd: r.ShadowsMidtonesHighlights.highlightsEnd,
});

test('调色常量：白平衡 0 = LMS 系数 1；Lift / Gamma / Gain 照 ColorUtils', () => {
  const lms = color.colorBalanceToLms(0, 0);
  for (const v of lms) close(v, 1, 2e-4, 'D65 白点');
  const cold = color.colorBalanceToLms(-9.5, -0.5);
  assert.ok(cold[2] > cold[0], '色温往负 = 偏蓝（S 系数大）');
  // 1-1：轨迹球都是白（1,1,1），只剩 w：lift = w，gamma = 1 / (1 + w)，gain = 1 + w
  const lgg = color.prepareLiftGammaGain([1, 1, 1, -0.007], [1, 1, 1, 0.258], [1, 1, 1, -0.084]);
  for (let i = 0; i < 3; i++) {
    close(lgg.lift[i], -0.007, 1e-7);
    close(lgg.gamma[i], 1 / 1.258, 1e-7);
    close(lgg.gain[i], 0.916, 1e-7);
  }
  // 阴影 / 高光轨迹球：w > 0 时 ×4、< 0 时 ×1
  const smh = color.prepareShadowsMidtonesHighlights([1, 1.02, 1.06, 0.06], [1, 1, 1, 0], [1, 1, 1, -0.04]);
  close(smh.shadows[0], 1 + 0.24, 1e-7);
  close(smh.highlights[0], 0.96, 1e-7);
  close(color.gammaToLinear(0.5), 0.214041, 1e-6);
  close(color.gammaToLinear(2), Math.pow(2, 2.2), 1e-9, '> 1 时按 2.2 次幂');
});

test('LDR LUT：默认参数 = 恒等（只在 127/128 处封顶），双线性取样还原输入', () => {
  const u = color.lutUniforms(identity);
  const lut = color.bakeLutLdr(u, 32);
  assert.equal(lut.length, 32 * 1024 * 4);
  let worst = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 1024; x++) {
    const k = (y * 1024 + x) * 4, i = x % 32, s = Math.floor(x / 32);
    const want = [i, y, s].map(v => Math.round(Math.min(v / 31, 127 / 128) * 255));
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(lut[k + c] - want[c]));
  }
  // HSV 来回（URP 的 RgbToHsv 带 1e-4 的 e）在暗处差一点点
  assert.ok(worst <= 1, `恒等 LUT 最大偏差 ${worst} 格`);
  const out = [0, 0, 0];
  for (const rgb of [[0.2, 0.5, 0.8], [0.03, 0.9, 0.4], [0.6, 0.6, 0.6]]) {
    color.applyLut2D(lut, 32, rgb[0], rgb[1], rgb[2], out);
    for (let c = 0; c < 3; c++) close(out[c], rgb[c], 2.5 / 255, `取样 ${rgb}`);
  }
});

test('LDR LUT：1-1 的调色——灰不偏色（除了白平衡）、单调、范围对、比原来更对比更冷', () => {
  const u = color.lutUniforms(gradingOf(doc.scenes['1-1'].resolved));
  const out = [0, 0, 0];
  let prev = -1;
  for (let i = 0; i <= 31; i++) {
    const v = i / 31;
    color.gradeLdr(v, v, v, u, out);
    for (const c of out) assert.ok(c >= 0 && c <= 127 / 128 + 1e-9, `范围 ${out}`);
    const l = color.luminance(out[0], out[1], out[2]);
    assert.ok(l >= prev - 1e-6, `灰阶单调：${i}`);
    prev = l;
    if (v > 0.05 && v < 0.8) assert.ok(out[2] > out[0], `色温 −9.5 → 灰偏蓝 ${out}`);
  }
  // lift −0.007 把近黑压死（URP 的 lift 是加法偏移），gamma +0.258（指数 1 / 1.258）把中间调提亮
  assert.ok(color.luminance(...color.gradeLdr(0.01, 0.01, 0.01, u, [0, 0, 0])) < 0.002);
  const mid = color.luminance(...color.gradeLdr(0.18, 0.18, 0.18, u, [0, 0, 0]));
  assert.ok(mid > 0.2 && mid < 0.24, `中灰 ${mid}`);
  // 饱和度 −11：纯色的饱和度降下来
  const sat = c => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
  const red = color.gradeLdr(0.6, 0.2, 0.1, u, [0, 0, 0]);
  assert.ok(sat(red) < sat([0.6, 0.2, 0.1]) + 0.05);
});

test('LDR LUT：低血量（饱和度 −38）把颜色压灰，权重 0 时原样', () => {
  const base = doc.scenes['1-1'];
  const low = new gameplay.GameplayVolumes({ hpFraction: () => 0.05, dead: () => false, timeScale: () => 1, timePriority: () => null }, () => 0);
  low.update();
  assert.equal(low.lowHealth.weight, 1);
  const hurt = volume.evaluateVolumes(doc, base, low.layers, null);
  assert.equal(hurt.ColorAdjustments.saturation, -38, '低血量盖过关卡的 −11（覆盖，不是叠加）');
  assert.equal(hurt.ColorAdjustments.contrast, 6);
  const calm = volume.evaluateVolumes(doc, base, [], null);
  assert.deepEqual(calm, base.resolved);
});

// ───────────── Volume 混合 ─────────────

test('Volume 混合：局部盒子按距离平方衰减（VolumeManager），优先级高的后混', () => {
  const s = doc.scenes['3-3'];
  const inside = volume.evaluateVolumes(doc, s, [], [-152, 28, 164]);
  assert.equal(inside.ColorAdjustments.contrast, 26);
  assert.equal(inside.ColorAdjustments.saturation, 10);
  assert.equal(inside.ColorAdjustments.postExposure, 0.25, '火神王座没勾后曝光：保留全局的');
  const far = volume.evaluateVolumes(doc, s, [], [-152 + 68 + 60, 28, 164]);
  assert.equal(far.ColorAdjustments.contrast, 30, '盒外 60 m > 混合距离 48 m：不起作用');
  // 盒外 24 m：t = 1 − 24² / 48² = 0.75
  const edge = volume.evaluateVolumes(doc, s, [], [-152 + 68 + 24, 28, 164]);
  close(edge.ColorAdjustments.contrast, 30 + (26 - 30) * 0.75, 1e-9);
  close(edge.Bloom.intensity, 0.55 + (0.95 - 0.55) * 0.75, 1e-9);
  // 布尔 / 枚举：t > 0 就换
  const state = volume.defaultVolumeParams();
  volume.blendVolume(state, { Vignette: { rounded: true }, Bloom: { maxIterations: 3 } }, 0.5);
  assert.equal(state.Vignette.rounded, true);
  assert.equal(state.Bloom.maxIterations, Math.trunc(6 + (3 - 6) * 0.5));
  // 旋转的盒子：绕 y 转 90°，半长 (10, 1, 2) → 世界里沿 x 只有 2
  const s45 = Math.SQRT1_2;
  const box = { center: [0, 0, 0], halfSize: [10, 1, 2], rotation: [0, s45, 0, s45] };
  assert.equal(volume.boxDistanceSq(box, 0, 0, 9), 0, '世界 z 方向是盒子的长边');
  close(volume.boxDistanceSq(box, 3, 0, 0), 1, 1e-9, '世界 x 方向只有 2');
});

// ───────────── 玩法屏效（Unity GraphicsAudioTests） ─────────────

test('玩法屏效曲线（照 Unity EditMode 断言）', () => {
  const g = gameplay, G = g.GAMEPLAY_VOLUMES;
  assert.equal(g.lowHealthTarget(0.5, false), 0);
  close(g.lowHealthTarget(0.35, false), 0, 1e-4);
  close(g.lowHealthTarget(0.1, false), 1, 1e-4);
  close(g.lowHealthTarget(0.02, false), 1, 1e-4);
  const mid = g.lowHealthTarget(0.2, false);
  assert.ok(mid >= 0.3 && mid <= 0.9);
  assert.equal(g.lowHealthTarget(0.05, true), 0, '阵亡交给慢动作');
  const small = g.hurtStrength(5, 0, 200), big = g.hurtStrength(60, 0, 200);
  assert.ok(small >= 0.35 && small <= 0.5);
  close(big, 1, 1e-4);
  assert.ok(g.hurtStrength(0, 5, 200) < small, '只扣护盾弱一些');
  assert.equal(g.hurtStrength(0, 0, 200), 0);
  close(g.hurtEnvelope(G.HurtAttack), 1, 1e-4);
  assert.ok(g.hurtEnvelope(0.35) < 0.12, '0.35 s 基本褪完');
  assert.equal(g.hurtEnvelope(1), 0, '不拖尾');
  close(g.dashEnvelope(G.DashHold), 1, 1e-4);
  assert.equal(g.dashEnvelope(0.4), 0, '冲刺屏效 0.32 s 收完');
  close(g.slowTarget(0.3, G.DeathSlowMoPriority), 1, 1e-4);
  assert.equal(g.slowTarget(0.05, 100), 0, '顿帧不算慢动作');
  assert.equal(g.slowTarget(1, G.DeathSlowMoPriority), 0);
  assert.ok(G.HurtAberration <= 0.4 && G.DashAberration <= G.HurtAberration);
});

test('玩法屏效的层：受击脉冲、慢动作渐入，乘「屏幕特效」', () => {
  let now = 0, scale = 1, priority = null;
  const v = new gameplay.GameplayVolumes({ hpFraction: () => 1, dead: () => false, timeScale: () => scale, timePriority: () => priority }, () => now);
  v.update();
  v.onPlayerHit(30, 0, 200);
  now = 0.03;
  v.update();
  close(v.hurt.weight, gameplay.hurtStrength(30, 0, 200), 1e-9, '0.03 s 到峰值');
  now = 1;
  v.update();
  assert.equal(v.hurt.weight, 0);
  scale = 0.3; priority = 200;
  for (let i = 0; i < 30; i++) { now += 1 / 60; v.update(); }
  assert.equal(v.slow.weight, 1, '0.2 s 内渐入到满（5 / s）');
  v.amount = 0.5;
  v.update();
  assert.equal(v.slow.weight, 0.5);
  const params = volume.evaluateVolumes(null, null, v.layers, null);
  close(params.ChromaticAberration.intensity, 0.15 * 0.5, 1e-9);
});
