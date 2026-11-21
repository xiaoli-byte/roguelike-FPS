// M11d 核心 · 画质档、距离剔除、性能预算（docs/threejs-migration.md 4.7）：照 Unity EditMode 的 GraphicsAudioTests（画质档）、PerfTests（剔除 / 预算）改写。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importTs } from './hanba-load.mjs';

const Q = await importTs('../src/core/QualityTiers.ts');
const C = await importTs('../src/core/CullLayers.ts');
const P = await importTs('../src/core/PerfBudget.ts');

const near = (a, b, eps = 1e-3, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} 期望 ${b}，实际 ${a}`);

// ───────────── 画质档 ─────────────

test('三档画质的参数逐项等于 QualityProfile.cs（低 / 中 / 高）', (t) => {
  const cs = readFileSync(new URL('../unity/Assets/Game/Scripts/Core/QualityProfile.cs', import.meta.url), 'utf8');
  if (cs.startsWith('%TSD-Header')) return t.skip('QualityProfile.cs 被透明加密（先跑 node scripts/unity/dlp-unity-fix.mjs）');
  const names = { Low: Q.QUALITY_LOW, Medium: Q.QUALITY_MEDIUM, High: Q.QUALITY_HIGH };
  let checked = 0;
  for (const [name, profile] of Object.entries(names)) {
    const body = new RegExp(`public static readonly QualityProfile ${name} = new\\(\\)\\s*\\{([\\s\\S]*?)\\};`).exec(cs)?.[1];
    assert.ok(body, `C# 里有 ${name}`);
    for (const m of body.matchAll(/(\w+) = ([^,\n]+),/g)) {
      const [, key, raw] = m;
      if (key === 'level') continue;
      const value = raw.trim();
      let want;
      if (value === 'true' || value === 'false') want = value === 'true';
      else if (/^-?[\d.]+f?$/.test(value)) want = Number(value.replace(/f$/, ''));
      else if (value.startsWith('"')) want = value.slice(1, -1);
      else want = value.split('.').pop().toLowerCase(); // 枚举：UpscalingFilterSelection.FSR → fsr、FurTier.Shells → shells
      assert.ok(key in profile, `${name}.${key} 网页表里有`);
      assert.deepEqual(profile[key], want, `${name}.${key}`);
      checked++;
    }
  }
  assert.ok(checked >= 3 * 25, `逐项核对了 ${checked} 个数`);
});

test('QualityTiers_AreOrdered：低 → 高逐项不降；高档 = PC 管线原值', () => {
  const t = Q.QUALITY_PROFILES;
  assert.deepEqual(t.map(p => p.level), ['low', 'medium', 'high']);
  assert.deepEqual(t.map(p => p.label), ['低', '中', '高']);
  for (let i = 1; i < t.length; i++) {
    const lo = t[i - 1], hi = t[i];
    for (const key of ['renderScale', 'msaa', 'shadowDistance', 'shadowCascades', 'shadowResolution', 'fxLights', 'particleDensity', 'particleCap', 'styleCapScale',
      'decalCap', 'statusEmitPerFrame', 'lodBias', 'terrainDetailDensity', 'detailCullDistance', 'scatterCullFog'])
      assert.ok(lo[key] <= hi[key], `${lo.label} → ${hi.label} ${key}`);
    assert.ok(lo.textureMipLimit >= hi.textureMipLimit);
  }
  assert.deepEqual(t.map(p => p.renderScale), [0.7, 0.85, 1]);
  assert.deepEqual(t.map(p => p.msaa), [1, 2, 4]);
  assert.deepEqual(t.map(p => p.particleCap), [1500, 3000, 5000]);
  assert.deepEqual(t.map(p => p.fxLights), [3, 6, 8]);
  assert.deepEqual(t.map(p => p.fur), ['none', 'fins', 'shells']);
  assert.deepEqual(t.map(p => [p.shadowDistance, p.shadowCascades, p.shadowResolution, p.softShadows]), [[45, 1, 1024, false], [70, 2, 2048, true], [90, 4, 2048, true]]);
  assert.deepEqual(t.map(p => p.ssao), [false, true, true]);
  assert.ok(t.every(p => p.stp === false), '不用 STP');
  const h = Q.QUALITY_HIGH;
  assert.deepEqual([h.renderScale, h.upscaling, h.msaa, h.shadowDistance, h.shadowCascades, h.shadowResolution, h.additionalLightShadows], [1, 'auto', 4, 90, 4, 2048, true]);
  assert.deepEqual(Q.terrainOverrides(h), { detailDensity: false, detailDistance: false, pixelError: false }, '高档不覆盖关卡的地形设置');
  assert.deepEqual(Q.terrainOverrides(Q.QUALITY_LOW), { detailDensity: true, detailDistance: true, pixelError: true });
  assert.equal(Q.qualityProfile('low'), Q.QUALITY_LOW);
  assert.equal(Q.qualityProfile('medium'), Q.QUALITY_MEDIUM);
  assert.equal(Q.qualityProfile('high'), Q.QUALITY_HIGH);
  assert.equal(Q.qualityProfile(0), Q.QUALITY_LOW);
  assert.equal(Q.qualityProfile('whatever'), Q.QUALITY_HIGH, '认不出来的按高');
  assert.equal(Q.describeQuality(Q.QUALITY_LOW), '低：渲染 0.7× FSR、MSAA 1×、阴影 45 m / 1 级 / 1024 硬、SSAO 关、闪光灯 3、粒子 0.45× / 上限 1500、毛发 none、lodBias 1、mip 1、Bloom 1/4');
});

test('渲染比例：普通屏 0.7 / 0.85 / 1；高分屏按各档的设备像素比上限起算', () => {
  near(Q.renderPixelRatio(Q.QUALITY_LOW, 1), 0.7);
  near(Q.renderPixelRatio(Q.QUALITY_MEDIUM, 1), 0.85);
  near(Q.renderPixelRatio(Q.QUALITY_HIGH, 1), 1);
  near(Q.renderPixelRatio(Q.QUALITY_LOW, 2), 0.7, 1e-9, '低档不按高分屏渲染');
  near(Q.renderPixelRatio(Q.QUALITY_MEDIUM, 2), 1.5 * 0.85);
  near(Q.renderPixelRatio(Q.QUALITY_HIGH, 3), 2, 1e-9, '高档最多 2×');
  near(Q.renderPixelRatio(Q.QUALITY_HIGH, Number.NaN), 1);
});

// ───────────── 距离剔除（PerfTests）─────────────

test('ClassifyBySize：1 m 的件归小件层、4 m 归散布层、大件不剔', () => {
  assert.deepEqual([C.CullLayer.Detail, C.CullLayer.Scatter, C.DETAIL_MAX_SIZE, C.SCATTER_MAX_SIZE, C.SCATTER_FALLBACK], [8, 9, 1.6, 6, 400]);
  assert.equal(C.classifySize(1), C.CullLayer.Detail);
  assert.equal(C.classifySize(1.6), C.CullLayer.Detail);
  assert.equal(C.classifySize(4), C.CullLayer.Scatter);
  assert.equal(C.classifySize(6), C.CullLayer.Scatter);
  assert.equal(C.classifySize(10), -1, '大件（建筑、崖壁）不剔');
  assert.equal(C.classifySize(0), -1);
  assert.equal(C.classifySize(Number.NaN), -1);
});

test('CullDistancesPerTier：高档小件 120 m、散布到雾终点；中 / 低往近收；没开雾用兜底', () => {
  const h = C.cullDistances(Q.QUALITY_HIGH, 380);
  near(h.detail, 120);
  near(h.scatter, 380, 1e-3, '被雾吞掉之后才剔');
  const l = C.cullDistances(Q.QUALITY_LOW, 380);
  assert.ok(l.detail < h.detail && l.scatter < h.scatter);
  near(l.detail, 60);
  near(l.scatter, 380 * 0.65);
  near(C.cullDistances(Q.QUALITY_MEDIUM, 380).scatter, 380 * 0.85);
  near(C.cullDistances(Q.QUALITY_HIGH, 360).scatter, 360);
  near(C.cullDistances(Q.QUALITY_HIGH, 0).scatter, 400, 1e-3, '没开雾用兜底距离');
  near(C.cullDistances(Q.QUALITY_HIGH, 9000).scatter, 400, 1e-3, '雾终点异常也用兜底');
  near(C.cullDistances(Q.QUALITY_LOW, 60).scatter, 60, 1e-3, '散布不比小件近');
  for (const p of Q.QUALITY_PROFILES) assert.ok(C.cullDistances(p, 380).scatter >= C.cullDistances(p, 380).detail, p.label);
});

/** 一件立方体网格（单位矩阵平移到 x, y, z） */
function cube(size, x, y, z, extra = {}) {
  const h = size / 2;
  return {
    isMesh: true, visible: true, children: [],
    geometry: { boundingBox: { min: { x: -h, y: -h, z: -h }, max: { x: h, y: h, z: h } } },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1] },
    ...extra,
  };
}

test('场景分层：只收看得见的静态网格；蒙皮 / 实例化 / 着色器材质 / 会摆的 / 关着的都不动', () => {
  const pebble = cube(1, 10, 0, 0), boulder = cube(4, 20, 0, 0), cliff = cube(30, 0, 0, 50);
  const skinned = cube(1, 0, 0, 0, { isSkinnedMesh: true }), instanced = cube(1, 0, 0, 0, { isInstancedMesh: true });
  const water = cube(3, 0, 0, 0, { material: { isShaderMaterial: true } });
  const hidden = cube(1, 0, 0, 0, { visible: false });
  const lantern = { children: [cube(0.5, 5, 2, 0)], userData: { unityLamp: true }, visible: true };
  const banner = { children: [cube(2, 5, 2, 0)], userData: { unitySwing: true }, visible: true };
  const skipped = { name: 'enemy', children: [cube(1, 0, 0, 0)], visible: true };
  // 缩放过的件按世界尺寸算：0.5 m 的方块放大 5 倍 = 2.5 m → 散布
  const scaled = cube(0.5, 0, 0, 0);
  scaled.matrixWorld.elements = [5, 0, 0, 0, 0, 5, 0, 0, 0, 0, 5, 0, 30, 0, 0, 1];
  let updated = 0;
  const root = { visible: true, updateMatrixWorld: () => { updated++; }, children: [pebble, boulder, cliff, skinned, instanced, water, hidden, lantern, banner, skipped, scaled] };
  const culler = new C.DistanceCuller();
  assert.equal(culler.addScene(root, node => node.name === 'enemy'), 3);
  assert.equal(updated, 1);
  assert.deepEqual([culler.detailCount, culler.scatterCount, culler.count], [1, 2, 3]);
  const b = C.worldBounds(scaled);
  near(b.size, 2.5);
  assert.deepEqual(b.center, { x: 30, y: 0, z: 0 });
});

test('按球面距离剔：超过这一层距离的不画，回到范围内再画；别人藏起来的不去动；关掉 / 换关全放出来', () => {
  const culler = new C.DistanceCuller();
  const near1 = cube(1, 50, 0, 0), far1 = cube(1, 0, 0, 130), rock = cube(4, 0, 0, 130), farRock = cube(4, 300, 0, 300), up = cube(1, 0, 125, 0);
  const mech = cube(1, 0, 0, 200);
  for (const m of [near1, far1, rock, farRock, up, mech]) culler.add(m, C.classifySize(4 === m.geometry.boundingBox.max.x * 2 ? 4 : 1), C.worldBounds(m).center);
  mech.visible = false; // 机关自己藏起来的
  const high = C.cullDistances(Q.QUALITY_HIGH, 380), low = C.cullDistances(Q.QUALITY_LOW, 380);
  const cam = { x: 0, y: 0, z: 0 };
  assert.equal(culler.update(cam, high), 3);
  assert.deepEqual([near1.visible, far1.visible, rock.visible, farRock.visible, up.visible], [true, false, true, false, false], '小件 120 m、散布 380 m；竖直方向也算（球面）');
  assert.equal(culler.culledCount, 3);
  assert.equal(mech.visible, false);
  assert.equal(culler.update(cam, high), 0, '相机没动、距离没变：什么都不做');
  // 降到低档：小件 60 m、散布 247 m
  assert.equal(culler.update(cam, low), 0, '50 m 的小件、130 m 的石头都还在范围里');
  cam.z = 100;
  culler.update(cam, low);
  assert.deepEqual([near1.visible, far1.visible, rock.visible], [false, true, true], '走近了的放出来，走远了的剔掉');
  // 相机只挪了一点点：不重算
  near1.visible = true;
  cam.z = 100.5;
  assert.equal(culler.update(cam, low), 0);
  // 距离写 0 = 不剔（Unity layerCullDistances 的 0）
  cam.z = 0;
  culler.update(cam, { detail: 0, scatter: 0 });
  assert.deepEqual([near1.visible, far1.visible, rock.visible, farRock.visible, up.visible], [true, true, true, true, true]);
  assert.equal(mech.visible, false, '没被这里剔过的不去放出来');
  // 关掉（对照截图）/ 换关
  culler.update({ x: 0, y: 0, z: 900 }, high);
  assert.ok(culler.culledCount > 0);
  culler.disabled = true;
  assert.equal(culler.culledCount, 0);
  assert.ok([near1, far1, rock, farRock, up].every(m => m.visible));
  assert.equal(culler.update({ x: 0, y: 0, z: 900 }, high), 0);
  culler.disabled = false;
  culler.update({ x: 0, y: 0, z: 900 }, high);
  culler.clear();
  assert.equal(culler.count, 0);
  assert.ok([near1, far1, rock, farRock, up].every(m => m.visible), '换关时全放出来');
});

// ───────────── 性能预算（PerfTests.BudgetFlagsOnlyOverruns）─────────────

test('BudgetFlagsOnlyOverruns：预算有数；只报超出的项；拿不到的量不检查', () => {
  assert.deepEqual(P.PERF_HIGH, { gpuP95Ms: 8, mainP95Ms: 16, drawCalls: 4400, setPass: 480, triangles: 8_300_000, frustumRenderers: 460 });
  assert.deepEqual(P.PERF_LOW, { gpuP95Ms: 3.5, mainP95Ms: 15, drawCalls: 1350, setPass: 230, triangles: 2_900_000, frustumRenderers: 390 });
  assert.deepEqual(P.PERF_STATIC_HIGH, { renderers: 400, triangles: 2_100_000, draws: 480 });
  assert.deepEqual(P.PERF_STATIC_LOW, { renderers: 360, triangles: 2_000_000, draws: 400 });
  for (const high of [true, false]) {
    const l = P.perfLimits(high);
    assert.equal(P.checkPerf(high, 1, 1, 1, 1, 1, 1), null);
    assert.ok(P.checkPerf(high, 1, 1, l.drawCalls + 1, 1, 1, 1).includes('绘制调用'));
    assert.ok(P.checkPerf(high, l.gpuP95Ms + 1, 1, 1, 1, 1, 1).includes('GPU P95'));
    assert.equal(P.checkPerf(high, -1, -1, 0, 0, 0, 0), null, '拿不到的量不检查');
    assert.equal(P.checkPerfStatic(high, 1, 1, 1), null);
    const s = high ? P.PERF_STATIC_HIGH : P.PERF_STATIC_LOW;
    assert.ok(P.checkPerfStatic(high, 1, s.triangles + 1, 1).includes('三角面'));
  }
  assert.equal(P.checkPerf(true, 9.5, 1, 5000, 1, 1, 1), 'GPU P95 9.50 ms > 8.00 ms、绘制调用 5,000 > 4,400');
  assert.ok(P.PERF_HIGH.drawCalls >= P.PERF_LOW.drawCalls, '低档预算不比高档宽');
  assert.ok(P.PERF_HIGH.gpuP95Ms >= P.PERF_LOW.gpuP95Ms);
  assert.ok(P.PERF_STATIC_HIGH.triangles >= P.PERF_STATIC_LOW.triangles);
});
