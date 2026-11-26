// M7 地图机关的对照测试：Unity EditMode 的 LavaTests.cs 原样迁过来（同样的输入、同样的断言），其余机关（熔泉 / 熔流闸 / 流沙 / 牵引 /
// 安全区 / 软边界 / 天气 / 风场 / 雷暴 / 导体 / 可破坏物）按 C# 源码的常量与公式断言同样的数；再加导出数据（mechanisms.json）的核对。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return data(stripTypeScriptTypes(source, { mode: 'transform' }));
}
const lavaCoreUrl = await ts('../src/world/mechanisms/LavaCore.ts');
const partsUrl = await ts('../src/world/mechanisms/Parts.ts');
const telegraphUrl = await ts('../src/world/mechanisms/Telegraph.ts');
const safeGroundUrl = await ts('../src/world/mechanisms/SafeGround.ts');
const lavaUrl = await ts('../src/world/mechanisms/Lava.ts', {
  '../Atmosphere': data('export const Atmosphere = { uniforms: {} };'), './LavaCore': lavaCoreUrl,
});
const L = await import(lavaCoreUrl);
const { LavaField, LavaVolumeRuntime } = await import(lavaUrl);
const { SafeGround } = await import(safeGroundUrl);
const { GeyserClock, sluiceSegments } = await import(await ts('../src/world/mechanisms/LavaFeatures.ts', {
  './LavaCore': lavaCoreUrl, './Lava': lavaUrl, './Parts': partsUrl, './Telegraph': telegraphUrl,
}));
const G = await import(await ts('../src/world/mechanisms/Ground.ts'));
const B = await import(await ts('../src/world/mechanisms/Boundary.ts'));
const W = await import(await ts('../src/world/mechanisms/Weather.ts', {
  '../UnityStylizedLit': data(`import * as THREE from '${threeUrl}'; export const stylizedShared = { uSflWindDir: { value: new THREE.Vector4() } };`),
}));
const { WindField } = await import(await ts('../src/world/mechanisms/Wind.ts'));
const S = await import(await ts('../src/world/mechanisms/Storm.ts', {
  './Telegraph': telegraphUrl,
  '../UnityStylizedLit': data(`import * as THREE from '${threeUrl}'; export const stylizedShared = { uSflAmbient0: { value: new THREE.Vector3() }, uSflAmbient1: { value: new THREE.Vector3() }, uSflAmbient2: { value: new THREE.Vector3() } };`),
}));
const Br = await import(await ts('../src/world/mechanisms/Breakables.ts', { './Parts': partsUrl }));

const { LavaBody, LavaGeometry, LavaTuning, LavaTides, LavaLevelDriver, LavaContactTracker, LavaEnemyRule, HazardSpecs, buildLavaMesh } = L;
const near = (actual, expected, eps, message = '') => assert.ok(Math.abs(actual - expected) <= eps, `${message} ${actual} != ${expected}`);
const v3 = (x, y, z) => ({ x, y, z });

// ───────────────────────────── LavaTests.cs ─────────────────────────────

test('熔岩数值同 Three.js 的 LAVA 表（HazardSpec.Lava / LavaTuning）', () => {
  const s = HazardSpecs.lava();
  near(s.burst, 0.12, 1e-6, 'LAVA.burst');
  near(s.tick, 0.015, 1e-6, 'LAVA.burnTick');
  assert.deepEqual([...s.tickTimes], [0.2, 0.4]);
  near(s.sinkTime, 0.5, 1e-6);
  near(s.grace, 1, 1e-6);
  assert.equal(s.element, 'fire');
  assert.equal(LavaTuning.StandRise, 0.3);
  assert.equal(LavaTuning.SafeMargin, 1);
  assert.equal(LavaTuning.KnockWindow, 0.6);
  assert.equal(LavaTuning.TeleportStep, 4);
  const fall = HazardSpecs.fall();
  assert.equal(fall.burst, 0.1);
  assert.equal(fall.sinkTime, 0);
});

test('转过的盒与圆的平面形状', () => {
  const box = new LavaBody('box', v3(10, 0, 5), [6, 24], 0, 90);
  assert.ok(box.contains(10 + 11.5, 5), '转过之后长边沿 X');
  assert.ok(!box.contains(10, 5 + 4), '短边沿 Z（半宽 3）');
  near(box.inset(10, 5), 3, 1e-4, '中心离最近的边 3 m');
  near(box.inset(10, 5 + 4), -1, 1e-4, '边外 1 m');
  const rect = box.worldRect;
  near(rect.width, 24, 1e-3);
  near(rect.height, 6, 1e-3);
  near(box.closestPoint(10, 5 + 10).z, 5 + 3, 1e-4, '最近点落在边上');
  const disc = new LavaBody('disc', v3(0, 0, 0), [5, 0], 2);
  assert.ok(disc.contains(3, 3.9));
  assert.ok(!disc.contains(4, 4));
  near(disc.inset(0, 0), 5, 1e-4);
  near(disc.closestPoint(10, 0).x, 5, 1e-4);
  near(disc.closestPoint(10, 0).y, 2, 1e-4, '最近点的 y 是熔岩面');
});

test('高度窗口：岛 / 堤道高出熔岩面不算，地底隧道不算', () => {
  const lake = new LavaBody('disc', v3(0, 0, 0), [30, 0], 0, 0, 3);
  assert.ok(lake.touches(v3(5, 0, 0)));
  assert.ok(lake.touches(v3(5, -1.5, 0)), '湖床');
  assert.ok(lake.touches(v3(5, 0.29, 0)), 'standRise 以内');
  assert.ok(!lake.touches(v3(5, 0.31, 0)), '高出 standRise 不算');
  assert.ok(!lake.touches(v3(5, 1.4, 0)), '堤道');
  assert.ok(!lake.touches(v3(5, -3.5, 0)), 'depth 以下');
  assert.ok(!lake.touches(v3(31, 0, 0)), '形状外');
  assert.ok(lake.submerged(v3(5, -0.5, 0)));
  assert.ok(!lake.submerged(v3(5, -0.1, 0)), '刚没过脚底不算掉进去');
  lake.enabled = false;
  assert.ok(!lake.touches(v3(5, 0, 0)), '停用的熔岩不算');
});

const channel = () => [new LavaBody('box', v3(0, 0, 0), [1.6, 40], 0)];
const At = (offset, y = 0) => v3(offset, y, 3);

test('玩家：踩进去一次算一次，托回后再踩还算', () => {
  const lava = channel(), t = new LavaContactTracker();
  for (let i = 0; i < 10; i++) assert.ok(!t.step(lava, At(-3), true));
  assert.ok(t.step(lava, At(0), true), '走进去');
  for (let i = 0; i < 30; i++) t.reset();
  assert.ok(!t.step(lava, At(-3), true));
  assert.ok(!t.step(lava, At(-1.5), true), '离渠中线 1.5 m 还在岸上');
  assert.ok(t.step(lava, At(-0.5), true), '重新踩进去');
});

test('贴地冲刺一帧跨过窄渠也算，传送不算', () => {
  const lava = channel(), t = new LavaContactTracker();
  t.step(lava, At(-3), true);
  assert.ok(!t.step(lava, At(-1.9), true));
  assert.ok(t.step(lava, At(1.9), true), '一帧 3.8 m 跨过 1.6 m 的渠');
  t.reset();
  assert.ok(!t.step(lava, At(-3), true));
  assert.ok(!t.step(lava, At(20), true), '一帧 23 m 是传送');
});

test('跳过渠不受伤、落进去算、熔岩上空不算', () => {
  const lava = channel(), t = new LavaContactTracker();
  let entries = 0;
  const v = 7.5, dt = 1 / 60;
  for (let s = -3; s <= 3; s += v * dt) {
    const air = Math.abs(s) < 1.3;
    if (t.step(lava, At(s, air ? 0.6 : 0), !air)) entries++;
  }
  for (let i = 0; i < 10; i++) if (t.step(lava, At(3), true)) entries++;
  assert.equal(entries, 0);
  assert.ok(!t.step(lava, At(0, 0.8), false));
  assert.ok(t.step(lava, At(0), true));
});

test('从洞口掉进熔岩井不着地也算', () => {
  const well = [new LavaBody('disc', v3(0, -5, 0), [4, 0], -5, 0, 3)];
  const t = new LavaContactTracker();
  assert.ok(!t.step(well, v3(0, -2, 0), false));
  assert.ok(!t.step(well, v3(0, -5.1, 0), false), '刚碰到熔岩面');
  assert.ok(t.step(well, v3(0, -5.4, 0), false), '脚底低于熔岩面');
});

test('敌人：自己走进去拉回、击退窗口内烧死、免疫的不管、被掀在上空的不算', () => {
  const now = 10;
  assert.equal(LavaEnemyRule.decide(false, true, now, -Infinity), 'pushBack');
  assert.equal(LavaEnemyRule.decide(false, true, now, now), 'burn');
  assert.equal(LavaEnemyRule.decide(false, true, now, now - 0.3), 'burn');
  assert.equal(LavaEnemyRule.decide(false, true, now, now - 0.7), 'pushBack');
  assert.equal(LavaEnemyRule.decide(false, false, now, now), 'none');
  assert.equal(LavaEnemyRule.decide(true, true, now, now), 'none');
  const lava = channel();
  assert.ok(!LavaGeometry.touches(lava, At(0, 2)));
  assert.equal(LavaEnemyRule.decide(false, LavaGeometry.touches(lava, At(0, 0.1)), now + 0.4, now), 'burn');
  assert.ok(LavaEnemyRule.knocked(true, false) && LavaEnemyRule.knocked(false, true) && !LavaEnemyRule.knocked(false, false));
});

test('自动涨落：预警 → 涨 → 高位 → 退，循环', () => {
  const tide = LavaTides.channel();
  near(LavaTides.period(tide), 20, 1e-4);
  assert.deepEqual(LavaTides.sample(tide, 1), { k: 0, phase: 'low' });
  assert.deepEqual(LavaTides.sample(tide, 8.5), { k: 0, phase: 'warning' });
  const half = LavaTides.sample(tide, 9.5 + 1.25);
  near(half.k, 0.5, 1e-4);
  assert.equal(half.phase, 'rising');
  assert.deepEqual(LavaTides.sample(tide, 14), { k: 1, phase: 'high' });
  const f = LavaTides.sample(tide, 18.5);
  assert.equal(f.phase, 'falling');
  assert.ok(f.k > 0 && f.k < 1);
  assert.deepEqual(LavaTides.sample(tide, 21), { k: 0, phase: 'low' });
  assert.equal(LavaTides.sample({ ...tide, offset: 10 }, 1).phase, 'rising', '相位错开 10 s');
  const d = new LavaLevelDriver(2, LavaTides.channel());
  let lvl = 2;
  const seen = [];
  for (let i = 0; i < 21 * 30; i++) {
    d.step(1 / 30);
    if (seen.at(-1) !== d.phase) seen.push(d.phase);
    lvl = Math.max(lvl, d.level);
  }
  assert.deepEqual(seen, ['low', 'warning', 'rising', 'high', 'falling', 'low']);
  near(lvl, 3.2, 1e-3, '涨到基准面 + 1.2 m');
});

test('脚本 RiseTo：先预警再淹过堤道，退回后撤销', () => {
  const body = new LavaBody('box', v3(0, 0, 0), [10, 10], 0);
  const lava = [body];
  const d = new LavaLevelDriver(0);
  const causeway = v3(2, 1, 0);
  assert.ok(!LavaGeometry.touches(lava, causeway));
  assert.ok(!d.flooding);
  d.moveTo(0.9, 1, 0.5);
  assert.equal(d.phase, 'warning');
  assert.ok(d.flooding, '预警时导航就挖掉');
  assert.ok(!d.step(0.25), '预警期熔岩面不动');
  assert.equal(d.level, 0);
  assert.ok(d.step(0.5), '预警完开始涨');
  assert.equal(d.phase, 'rising');
  assert.ok(d.level > 0 && d.level < 0.9);
  for (let i = 0; i < 30; i++) d.step(0.05);
  assert.equal(d.phase, 'high');
  near(d.level, 0.9, 1e-5);
  body.level = d.level;
  assert.ok(LavaGeometry.touches(lava, causeway));
  assert.ok(LavaGeometry.submerged(lava, v3(2, 0, 0)));
  d.moveTo(d.baseLevel, 0.5);
  assert.equal(d.phase, 'falling');
  for (let i = 0; i < 20; i++) d.step(0.05);
  assert.equal(d.phase, 'low');
  assert.ok(!d.flooding);
  d.snap(0.4);
  assert.equal(d.level, 0.4);
  assert.ok(d.flooding);
  d.releaseToTide();
  assert.ok(!d.scripted);
});

/** 熔岩湖（LavaTests.LakeProbe 原样） */
function lakeProbe(x, z, top, bottom) {
  const r = Math.hypot(x, z);
  if (Math.hypot(x + 8, z) < 2) return null;
  const g = r < 2 ? 2 : r < 10 ? -1.5 : r < 14 ? -1.5 + (3 + 1.5) * (r - 10) / 4 : 3;
  if (g > top || g < bottom) return null;
  return g;
}
const lake = () => [new LavaBody('disc', v3(0, 0, 0), [16, 0], 0, 0, 3)];

test('只给 XZ 的查询按地面判熔岩：湖床 / 岛 / 岸坡 / 地形洞', () => {
  const b = lake();
  let r = LavaGeometry.isLavaAt(b, 5, 0, lakeProbe);
  assert.ok(r.lava);
  near(r.groundY, -1.5, 1e-4);
  assert.ok(!LavaGeometry.isLavaAt(b, 1, 0, lakeProbe).lava, '湖心岛');
  assert.ok(LavaGeometry.isLavaAt(b, 11, 0, lakeProbe).lava, '岸坡下段');
  assert.ok(!LavaGeometry.isLavaAt(b, 13, 0, lakeProbe).lava, '岸坡上段');
  assert.ok(!LavaGeometry.isLavaAt(b, 15, 0, lakeProbe).lava);
  assert.ok(!LavaGeometry.isLavaAt(b, 20, 0, lakeProbe).lava);
  r = LavaGeometry.isLavaAt(b, -8, 0, lakeProbe);
  assert.ok(r.lava, '地形洞');
  near(r.groundY, 0, 1e-4);
});

test('最近的岸、朝目标上岸、岸上找最近的熔岩边', () => {
  const b = lake();
  let shore = LavaGeometry.nearestShore(b, v3(6, -1.5, 0), 10, lakeProbe);
  assert.ok(shore && !LavaGeometry.isLavaAt(b, shore.x, shore.z, lakeProbe).lava);
  assert.ok(Math.hypot(shore.x, shore.z) < 2.6, '最近的岸是湖心岛');
  shore = LavaGeometry.nearestShore(b, v3(0, -1.5, 9), 10, lakeProbe);
  assert.ok(shore && Math.hypot(shore.x, shore.z) > 11.3, '最近的岸是外岸');
  assert.equal(LavaGeometry.nearestShore(b, v3(6, -1.5, 0), 1, lakeProbe), null);
  const bank = LavaGeometry.bankToward(b, v3(6, -1.5, 0), v3(30, 3, 0), 12, lakeProbe);
  near(bank.x, 11.6, 0.3);
  near(bank.z, 0, 1e-3);
  assert.ok(bank.y > 0.3);
  const hit = LavaGeometry.nearestLava(b, v3(0, 3, 15), 6, lakeProbe);
  assert.ok(hit && LavaGeometry.isLavaAt(b, hit.lava.x, hit.lava.z, lakeProbe).lava);
  assert.ok(!LavaGeometry.isLavaAt(b, hit.bank.x, hit.bank.z, lakeProbe).lava);
  assert.ok(Math.hypot(hit.lava.x - hit.bank.x, hit.lava.z - hit.bank.z) < 0.8);
  near(Math.hypot(hit.lava.x, hit.lava.z), 11.6, 0.8);
  assert.equal(LavaGeometry.nearestLava(b, v3(0, 3, 40), 5, lakeProbe), null);
});

test('扫掠与熔岩面查询（重叠取高的）', () => {
  const lava = channel();
  assert.ok(LavaGeometry.sweep(lava, At(-2), At(2)));
  assert.ok(!LavaGeometry.sweep(lava, At(-3), At(-1)));
  assert.ok(!LavaGeometry.sweep(lava, At(-2, 1), At(2, 1)));
  const s = LavaGeometry.surfaceAt(lava, 0.5, 10);
  assert.equal(s.y, 0);
  assert.equal(s.body, lava[0]);
  assert.equal(LavaGeometry.surfaceAt(lava, 2, 10), null);
  lava.push(new LavaBody('box', v3(0, 0, 0), [4, 4], 0.8));
  assert.equal(LavaGeometry.surfaceAt(lava, 0.5, 1).y, 0.8);
});

test('熔岩面网格：顶点数据给着色器，三角形朝上（网页镜像后仍是正面）', () => {
  const m = buildLavaMesh('box', [24, 6], false, [0, 0.4]);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < m.positions.length; i += 3) {
    minX = Math.min(minX, m.positions[i]); maxX = Math.max(maxX, m.positions[i]);
    minZ = Math.min(minZ, m.positions[i + 2]); maxZ = Math.max(maxZ, m.positions[i + 2]);
  }
  near(maxX - minX, 24, 1e-3);
  near(maxZ - minZ, 6, 1e-3);
  assert.deepEqual([...m.info.slice(0, 4)], [12, 3, 0, 0], 'uv1 = (半宽, 半长, 盒, 不按深度)');
  near(m.flow[1], 0.4, 1e-6, 'uv2.y = 流动');
  const up = mesh => {
    const p = mesh.positions, t = mesh.indices;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vz = p[c + 2] - p[a + 2];
      if (!(uz * vx - ux * vz > 0)) return false;
    }
    return true;
  };
  assert.ok(up(m), '盒的三角形朝上');
  const d = buildLavaMesh('disc', [5, 0], true);
  assert.deepEqual([...d.info.slice(0, 4)], [5, 5, 1, 1]);
  assert.ok(up(d), '圆的三角形朝上');
});

// ───────────────────────────── 熔岩运行时（LavaField + SafeGround） ─────────────────────────────

function fakeCtx({ ground = () => 0 } = {}) {
  const calls = { damagePlayer: [], damageEnemy: [], teleports: [], sounds: [] };
  const player = {
    position: new THREE.Vector3(-3, 0, 3), velocity: new THREE.Vector3(), onGround: true, alive: true, isDashing: false, isLunging: false,
    invulnerableTime: 0, radius: 0.4, height: 1.8, maxHp: () => 100, teleport(p) { calls.teleports.push(p.clone()); this.position.copy(p); },
    applyImpulse() {}, stats: { add() {}, removeSource() {}, getBase: () => 7 },
  };
  const ctx = {
    time: { now: 0, frame: 0 }, player, settings: { quality: 'high' },
    world: { groundHeight: (x, z, top) => ground(x, z, top), query: () => [], moveBody() {}, boxes: [], remove() {} },
    enemies: { list: [], queryRadius: () => [] },
    nav: { nearestWalkable: (p, out) => { out.set(-3, 0, p.z); return true; }, randomWalkable: () => false },
    combat: {
      damagePlayer(a, el) { calls.damagePlayer.push([a, el]); return a; },
      damageEnemy(e, req) { calls.damageEnemy.push(req); e.hp -= req.base; if (e.hp <= 0) e.alive = false; return {}; },
      explode: () => 0, applyStatus() {},
    },
    fx: { burst() {}, ring() {}, shake() {}, groundWarning: () => () => {}, lightning() {}, damageNumber() {} },
    audio: { play(id) { calls.sounds.push(id); } },
    ui: { toast() {}, banner() {} },
  };
  return { ctx, calls };
}

test('LavaField：玩家踩进渠 → 12% 火伤、两跳 1.5%、0.5 s 后托回最近的安全点并给 1 s 无敌', () => {
  const { ctx, calls } = fakeCtx();
  const flash = { flash() {}, update() {} };
  const safe = new SafeGround(ctx, flash);
  const field = new LavaField(ctx, safe, new THREE.Group());
  const v = new LavaVolumeRuntime(field, 'test', v3(0, 0, 3), 0, 'box', [1.6, 40], 3, LavaTides.none());
  field.register(v);
  const step = dt => { ctx.time.now += dt; ctx.time.frame++; field.update(dt, ctx.time.now); safe.update(dt); };
  for (let i = 0; i < 20; i++) step(0.05); // 在岸上站 1 s：记下安全点
  assert.ok(safe.lastSafe.distanceTo(new THREE.Vector3(-3, 0, 3)) < 1e-6, '岸上记了安全点');
  ctx.player.position.set(0, 0, 3);
  step(0.05);
  assert.equal(field.entries, 1);
  assert.ok(safe.sinking);
  near(calls.damagePlayer[0][0], 12, 1e-9, '12% 最大生命');
  assert.equal(calls.damagePlayer[0][1], 'fire');
  for (let i = 0; i < 12; i++) step(0.05);
  assert.deepEqual(calls.damagePlayer.map(c => c[0]), [12, 1.5, 1.5], '两跳 1.5%');
  assert.ok(!safe.sinking, '0.5 s 后托回');
  assert.ok(calls.teleports.length === 1 && Math.abs(calls.teleports[0].x + 3) < 1e-6, '托回岸上的安全点');
  assert.ok(ctx.player.invulnerableTime >= 1, '1 s 无敌');
  // 安全点不记在熔岩 1 m 以内
  ctx.player.position.set(-1.5, 0, 10);
  for (let i = 0; i < 20; i++) step(0.05);
  assert.ok(safe.lastSafe.distanceTo(new THREE.Vector3(-1.5, 0, 10)) > 1, '离熔岩边 0.7 m 不记');
  assert.ok(safe.isHazard(v3(-0.8 - 0.95, 0, 3)) && !safe.isHazard(v3(-0.8 - 1.05, 0, 3)), '危险区 = 离熔岩 1 m');
});

test('LavaField：被击退进熔岩的烧死，自己走进去的拉回岸上，首领 / 飞行不管', () => {
  const { ctx, calls } = fakeCtx();
  const safe = new SafeGround(ctx, { flash() {}, update() {} });
  const field = new LavaField(ctx, safe, new THREE.Group());
  field.register(new LavaVolumeRuntime(field, 'test', v3(0, 0, 3), 0, 'box', [1.6, 40], 3, LavaTides.none()));
  const enemy = (x, extra = {}) => ({ position: new THREE.Vector3(x, 0, 3), velocity: new THREE.Vector3(1, 0, 0), alive: true, hp: 100, armor: 0, shield: 0, isBoss: false, flying: false, ...extra });
  const walker = enemy(-3), knocked = enemy(-3), boss = enemy(0, { isBoss: true }), flyer = enemy(0, { flying: true });
  ctx.enemies.list = [walker, knocked, boss, flyer];
  field.update(0.05, 0.05);
  walker.position.set(0, 0, 3);
  knocked.position.set(0, 0, 3);
  knocked.knockedBack = true;
  ctx.time.now = 0.1;
  field.update(0.05, 0.1);
  assert.equal(walker.position.x, -3, '自己走进去：拉回上一个岸上位置');
  assert.equal(walker.velocity.x, 0);
  assert.equal(knocked.alive, false, '被击退进去：烧死');
  assert.equal(calls.damageEnemy[0].element, 'fire');
  assert.ok(calls.damageEnemy[0].base >= 1e7, '处决级伤害');
  assert.ok(boss.alive && flyer.alive && boss.position.x === 0, '首领 / 飞行不受影响');
  assert.equal(field.burned, 1);
  assert.equal(field.pushedBack, 1);
});

test('LavaVolume：自动涨落写进判定体和熔岩面网格，预警时翻涌', () => {
  const { ctx } = fakeCtx();
  const field = new LavaField(ctx, new SafeGround(ctx, { flash() {}, update() {} }), new THREE.Group());
  const v = new LavaVolumeRuntime(field, 'ch', v3(0, 2, 0), 0, 'box', [8, 35], 1.6, LavaTides.channel());
  const surface = new THREE.Object3D();
  surface.position.y = 2 + LavaTuning.SurfaceLift;
  v.bindSurface([surface]);
  field.register(v);
  const phases = [];
  v.onPhase((_, ph) => phases.push(ph));
  let maxAgitation = 0;
  for (let i = 0; i < 14 * 30; i++) {
    v.update(1 / 30);
    maxAgitation = Math.max(maxAgitation, v.agitationLevel);
  }
  assert.deepEqual(phases, ['warning', 'rising', 'high']);
  near(v.body.level, 3.2, 1e-4);
  near(surface.position.y, 3.2 + LavaTuning.SurfaceLift, 1e-4, '熔岩面网格跟着涨');
  assert.ok(maxAgitation > 0.9, '预警时翻涌');
});

// ───────────────────────────── 熔泉 / 熔流闸 ─────────────────────────────

test('间歇熔泉：按相位排第一次预警，预警 1.2 s → 喷 1.5 s → 休止到下一个周期', () => {
  const c = new GeyserClock(8, 0.25, 1.2, 1.5);
  c.setCycling(true, 10);
  near(c.nextAt, 10 + 0.25 * 8 + 0.3, 1e-9, '第一次预警 = phase × period + 0.3 s');
  const events = [];
  for (let t = 10; t < 30; t += 0.05) {
    const e = c.step(0.05, t);
    if (e) events.push([e, Math.round(t * 100) / 100]);
  }
  assert.equal(events[0][0], 'warn');
  near(events[0][1], 12.3, 0.051);
  assert.equal(events[1][0], 'erupt');
  near(events[1][1] - events[0][1], 1.2, 0.051);
  assert.equal(events[2][0], 'end');
  near(events[2][1] - events[1][1], 1.5, 0.051);
  near(events[3][1] - events[0][1], 8, 0.11, '一个周期 8 s');
  const d = new GeyserClock(8, 0, 1.2, 1.5);
  d.eruptNow(0.35);
  assert.equal(d.state, 'warning');
  near(d.stateLen, 0.35, 1e-9, '射爆岩壳：只预警 detonateWarn');
});

test('熔流闸：沿折线切段（≤ 6 m，拐角多盖 0.35 × 宽），熔流头 16 m/s', () => {
  // 3-3 南浇包的熔流道（网页坐标）
  const path = [[-170.5, -8, 50], [-150, -8, 50], [-134, -8, 44]];
  const { segments, length } = sluiceSegments(path, 8, 6);
  near(length, 20.5 + Math.hypot(16, 6), 1e-6);
  assert.equal(segments.length, Math.ceil(20.5 / 6) + Math.ceil(Math.hypot(16, 6) / 6));
  near(segments[0].length, 20.5 / 4, 1e-6, '第一段不加长');
  near(segments[3].length, 20.5 / 4 + 8 * 0.35, 1e-6, '拐角前一段往外多盖 2.8 m');
  near(segments[4].length, Math.hypot(16, 6) / 3 + 8 * 0.35, 1e-6, '拐角后一段也多盖');
  near(segments[0].yaw, 90, 1e-6, '沿 +X（网页）');
  assert.ok(segments.every(s => s.ground === -8));
  near(segments[4].start, 20.5, 1e-6, '熔流头到 20.5 m 时第 5 段开始涨');
});

// ───────────────────────────── 流沙 / 牵引 / 安全区 ─────────────────────────────

test('流沙：拉力边上 1.2 → 圆心 4.5 m/s，步速边上 ×0.7 → 芯里 ×0.3；走不出芯、冲刺能出', () => {
  const q = { position: [0, 0, 0], radius: 6, coreRadius: 2.2, pullEdge: 1.2, pullCore: 4.5, slowEdge: 0.7, slowCore: 0.3, above: 0.8, below: 1.5 };
  near(G.QuicksandMath.pullAt(q, 1), 1.2, 1e-9);
  near(G.QuicksandMath.pullAt(q, 0), 4.5, 1e-9);
  assert.equal(G.QuicksandMath.pullAt(q, 1.01), 0);
  near(G.QuicksandMath.slowAt(q, 1), 0.7, 1e-9);
  near(G.QuicksandMath.slowAt(q, 2.2 / 6), 0.3, 1e-9, '芯边上已经最慢');
  assert.equal(G.QuicksandMath.slowAt(q, 1.2), 1);
  // 芯里走 7.5 × 0.3 = 2.25 m/s 顶不过 4.5 m/s 的拉力
  assert.ok(7.5 * G.QuicksandMath.slowAt(q, 0) < G.QuicksandMath.pullAt(q, 0));
  assert.ok(G.QuicksandMath.at([q], v3(1, 0.5, 0)), '沙面上 0.5 m 还算');
  assert.equal(G.QuicksandMath.at([q], v3(1, 1, 0)), null, '高出 0.8 m 不算');
});

test('地表牵引：冰面 / 冻地预设、按强度淡出、取最滑的一块', () => {
  assert.deepEqual(G.SurfaceProfiles.ice(), { id: 'ice', title: '冰面', accel: 0.15, friction: 0.1, enemyAccel: 0.2, stumble: 0.35 });
  assert.deepEqual(G.SurfaceProfiles.frost(), { id: 'frost', title: '冻地', accel: 0.25, friction: 0.2, enemyAccel: 0.35, stumble: 0.2 });
  const half = G.SurfaceProfiles.scaled(G.SurfaceProfiles.ice(), 0.5);
  near(half.accel, 0.575, 1e-9);
  near(half.stumble, 0.175, 1e-9);
  const box = new G.ZoneShape({ shape: 'box', radius: 0, above: 0.6, below: 0.8 }, new THREE.Matrix4().compose(new THREE.Vector3(0, -0.5, 70), new THREE.Quaternion(), new THREE.Vector3(30, 1, 96)).elements, [0, -0.5, 70]);
  near(box.top, 0, 1e-9, '单位立方体顶面');
  assert.ok(box.contains(v3(14, 0, 70 + 47)));
  assert.ok(!box.contains(v3(16, 0, 70)));
  assert.ok(!box.contains(v3(0, 0.7, 70)), '高出顶面 0.6 m');
  const zones = [
    { shape: box, profile: G.SurfaceProfiles.frost(), lifetime: 0, fadeTime: 0.6, age: 0 },
    { shape: box, profile: G.SurfaceProfiles.ice(), lifetime: 0, fadeTime: 0.6, age: 0 },
  ];
  assert.equal(G.sampleSurface(zones, v3(0, 0, 70)).id, 'ice', '重叠取最滑的');
  // 冲刺余速 9.9 m/s 在冰面上一帧只回落 friction 那一份
  const [vx] = G.tractionVelocity(9.9, 0, 0, 0, G.SurfaceProfiles.ice());
  near(vx, 9.9 * 0.9, 1e-9);
  const [ax] = G.tractionVelocity(0, 0, 7.5, 0, G.SurfaceProfiles.ice());
  near(ax, 7.5 * 0.15, 1e-9);
});

test('安全区：圆柱判定、挪到圈外 半径 + 额外 处（在中心时朝 +X）', () => {
  assert.ok(G.SafeZoneMath.inside([0, 0, 0], 10, 6, v3(9, 5, 0)));
  assert.ok(!G.SafeZoneMath.inside([0, 0, 0], 10, 6, v3(9, 7, 0)));
  assert.ok(G.SafeZoneMath.inside([0, 0, 0], 10, 6, v3(10.4, 0, 0), 0.5));
  assert.deepEqual(G.SafeZoneMath.pushOut([0, 0, 0], 10, v3(0, 1, 0), 2), v3(12, 1, 0));
  const p = G.SafeZoneMath.pushOut([0, 0, 0], 10, v3(0, 0, 3), 1.5);
  near(p.z, 11.5, 1e-9);
});

// ───────────────────────────── 软边界 ─────────────────────────────

test('软边界调参：风力、推回速度、白化、顶得住的深度（走路 +2.7 m、冲刺 +14 m）', () => {
  const t = B.SoftBoundary.defaults();
  assert.equal(B.SoftBoundary.wind(t, 7), 0.5);
  assert.equal(B.SoftBoundary.push(t, 0), 0);
  assert.equal(B.SoftBoundary.push(t, 0.5), 13);
  assert.equal(B.SoftBoundary.pushAt(t, 14), 22);
  near(B.SoftBoundary.holdDepth(t, 7.5), 2.7222, 1e-3);
  near(B.SoftBoundary.holdDepth(t, 22), 14, 1e-9);
  assert.equal(B.SoftBoundary.holdDepth(t, 23), Infinity);
  near(B.SoftBoundary.whiteout(t, -6), 0, 1e-9);
  near(B.SoftBoundary.whiteout(t, 14 * 0.55), 1, 1e-9);
  assert.ok(B.SoftBoundary.tetherOut(t, 4.1) && !B.SoftBoundary.tetherOut(t, 3.9));
  near(B.SoftBoundary.navReach(t, 1), 2 + 2 * 0.7072, 1e-9);
});

test('距离场：双线性采样、范围外外推、梯度、拴绳落点', () => {
  // 区内为负：d = x − 10（等值线 x = 10），格距 2，原点 (0, 0)，11 × 11
  const w = 11, data = new Float32Array(w * w);
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) data[j * w + i] = i * 2 - 10;
  const f = new B.BoundaryField(data, w, w, [0, 0], 2);
  near(f.sample(5, 7), -5, 1e-6);
  near(f.sample(25, 4), 10 + 5, 1e-6, '范围外加上到范围的距离');
  assert.deepEqual(f.outward(6, 6), [1, 0]);
  const [x] = f.moveToDistance(16, 6, -1);
  near(x, 9, 1e-4);
  const t = B.SoftBoundary.defaults();
  const to = B.BoundaryTether.findPoint(f, t, v3(16, 3, 6), () => 0, (p, r) => ({ x: p.x, y: 0, z: p.z }), null);
  near(to.x, 10 + 2 - 3, 1e-3, '退回导航边缘以内 3 m');
  assert.equal(to.y, 0, '落点在地面上');
  assert.equal(B.BoundaryTether.findPoint(f, t, v3(16, 3, 6), null, () => null, null), null);
});

// ───────────────────────────── 天气 ─────────────────────────────

test('天气预设与插值（WeatherProfiles / WeatherState.Lerp）', () => {
  const s = W.weatherProfile('sandstorm');
  assert.equal(s.visibility, 25);
  assert.equal(s.fogEnd, 32);
  assert.equal(W.weatherProfile('BLIZZARD').visibility, 40, 'id 不分大小写');
  assert.equal(W.whiteoutFor('Plateau'), 'whiteout-frost');
  assert.equal(W.whiteoutFor('Inferno'), 'whiteout-inferno');
  assert.equal(W.whiteoutFor('Desert'), 'whiteout-desert');
  const base = { fogColor: [0.88, 0.76, 0.6], fogStart: 40, fogEnd: 260, sunMult: 1, sunTint: [1, 1, 1], wind: 0.25, dome: 0, sound: 0 };
  const h = W.lerpWeather(base, s, 0.5);
  near(h.fogStart, 21, 1e-9);
  near(h.fogEnd, 146, 1e-9);
  near(h.sunMult, 0.725, 1e-9);
  near(h.wind, 0.625, 1e-9);
  near(h.sunTint[1], 0.9, 1e-9);
  assert.equal(W.lerpWeather(base, s, 0), base);
  near(W.remapFog(40, 40, 120), 120, 1e-9, '晴天 = 网页原样');
  near(W.remapFog(0, 40, 120), 0, 1e-9);
});

test('区域风暴：走近开始计时、firstDelay 后预警、强度与锁定距离（1-1 ④ 驼队营地沙暴）', () => {
  const r = new W.StormRegion({ name: '沙暴', center: [-220, -2.3, 74], radius: 28, fade: 24, profile: 'sandstorm', from: [-1, 0],
    calm: 22, warn: 7, storm: 18, abate: 6, firstDelay: 6, armRadius: 85, loop: true });
  r.tick(1, v3(0, 0, 0));
  assert.equal(r.phase, 'idle', '离得远不计时');
  const at = v3(-220, 0, 74);
  r.tick(0.01, at);
  assert.equal(r.phase, 'calm');
  for (let t = 0; t < 6; t += 0.1) r.tick(0.1, at);
  assert.equal(r.phase, 'warning', 'firstDelay 6 s 后第一次预警');
  for (let t = 0; t < 7; t += 0.1) r.tick(0.1, at);
  assert.equal(r.phase, 'storm');
  for (let t = 0; t < 3; t += 0.1) r.tick(0.1, at);
  near(r.intensity, 1, 1e-9, '风暴 2.5 s 涨满');
  near(r.weight(v3(-220 + 28 + 24, 0, 74)), 0, 1e-9, '半径 + fade 外没有');
  near(W.lockOnRange([r], at), 25, 1e-9, '沙暴里锁定距离 25 m');
  assert.ok(!W.canLockOn([r], at, v3(-220, 0, 74 + 30)));
  assert.ok(W.canLockOn([r], at, v3(-220, 0, 74 + 20)));
  assert.equal(W.lockOnRange([r], v3(0, 0, 0)), Infinity);
});

// ───────────────────────────── 风场 ─────────────────────────────

test('风场：基础风、吸引点（越近越朝它）、推开的点、步速倍率', () => {
  const w = new WindField();
  assert.deepEqual(w.base.dir.map(v => Math.round(v * 1e4) / 1e4), [0.8211, -0.5708], '没设时 (−0.82, −0.57)（网页 x 取反）');
  near(w.base.strength, 0.25, 1e-9);
  w.weather = { dir: [0, -1], strength: 0.35 };
  assert.deepEqual(w.base.dir, [0, -1]);
  const a = w.addAttractor(v3(100, 0, 0), 260, 1, 30);
  const nearPt = w.sample(v3(80, 0, 0));
  assert.ok(nearPt.dir[0] > 0.99 && nearPt.strength === 1, '风眼 30 m 内完全朝它、满强度');
  near(a.weight(v3(100 - 145, 0, 0)), 0.5, 1e-9, '半程 smoothstep 0.5');
  a.strength = -1;
  assert.ok(w.sample(v3(80, 0, 0)).dir[0] < -0.99, '负强度往外推');
  w.playerSpeedK = 0.25;
  near(w.speedMult(v3(80, 0, 0), -1, 0), 1.25, 1e-9, '顺风 +25%');
  near(w.speedMult(v3(80, 0, 0), 1, 0), 0.75, 1e-9);
  w.reset();
  assert.equal(w.attractors.length, 0);
});

// ───────────────────────────── 雷暴 / 导体 ─────────────────────────────

test('导体引雷：attractRadius 内顶最高的、顶要比落点高 1 m；充电 / 掉电', () => {
  const pole = new S.Conductor({ position: [0, 0, 0], height: 6.2, attractRadius: 5, canCharge: true, chargePerStrike: 1, drainPerSecond: 0.1, chargedAt: 0.05, splashRadius: 2, splashDamage: 12 });
  const tower = new S.Conductor({ position: [3, 0, 0], height: 12, attractRadius: 5, canCharge: false, chargePerStrike: 1, drainPerSecond: 0, chargedAt: 0.05, splashRadius: 2, splashDamage: 12 });
  assert.equal(S.Conductor.best(v3(1, 0, 0), [pole, tower]), tower, '更高的导体');
  assert.equal(S.Conductor.best(v3(-4, 0, 0), [pole, tower]), pole);
  assert.equal(S.Conductor.best(v3(1, 6, 0), [pole]), null, '顶不比落点高 1 m');
  pole.onStruck(1);
  assert.ok(pole.charged && pole.strikes === 1);
  pole.update(null, 9.6);
  near(pole.charge, 0.04, 1e-9);
  assert.ok(!pole.charged, '掉到 0.05 以下不再带电');
  tower.onStruck(1);
  assert.ok(!tower.charged, '碉楼只引雷');
});

test('雷暴的票：等入场条件 → 3 s 渐入 → 强度 0.6 起落雷 → 4 s 渐出后回调', () => {
  let open = false, exited = 0;
  const t = new S.StormTicket(S.stormSpec({ enterWhen: () => open, onExit: () => exited++ }));
  t.nextStrike = 0.5;
  assert.ok(!S.stepTicket(t, 0.1));
  assert.equal(t.stage, 'waiting');
  open = true;
  let strikes = 0, first = -1, time = 0;
  for (let i = 0; i < 60; i++) {
    time += 0.1;
    if (S.stepTicket(t, 0.1, () => 0)) {
      strikes++;
      if (first < 0) first = time;
    }
  }
  assert.equal(t.stage, 'full');
  near(first, 0.1 + 1.8 + 0.5, 0.11, '强度 0.6（1.8 s）之后才开始倒数');
  assert.ok(strikes >= 2, '间隔 2.5 s 起');
  t.end();
  for (let i = 0; i < 41; i++) S.stepTicket(t, 0.1);
  assert.equal(t.stage, 'done');
  assert.equal(exited, 1);
  const w = new S.StormTicket(S.stormSpec({ enterWhen: () => false, onExit: () => exited++ }));
  w.end();
  assert.ok(w.done && exited === 1, '还在等入场条件的直接作废，不回调');
});

// ───────────────────────────── 可破坏物 ─────────────────────────────

test('可破坏物的伤害类型：不吃的格挡、怕的加倍', () => {
  const K = Br.DamageKind;
  assert.equal(K.Player, 639);
  // 3-1 的货堆：accepts 6 = 近战 | 爆炸（子弹打不动）
  assert.equal(Br.destructibleFilter(K.Shot, 6, 0, 2), 0);
  assert.equal(Br.destructibleFilter(K.Melee, 6, 0, 2), 1);
  // 补给坩埚：accepts 玩家的一切，怕爆炸 × 2
  assert.equal(Br.destructibleFilter(K.Explosion | K.Fire, 639, 4, 2), 2);
  assert.equal(Br.destructibleFilter(K.Enemy, 639, 4, 2), 0, '敌人打不碎');
  assert.equal(Br.elementKind('fire'), K.Fire);
  assert.equal(Br.kindColor('wood'), 0x8a6440);
});

// ───────────────────────────── 导出数据 ─────────────────────────────

// 机关数据在每张图的 level.json 里（public/assets/levels/<id>/level.json 的 mechanisms 段；2026-11-26 由 Unity 导出的 mechanisms.json 一次性转来）
const scene = id => JSON.parse(readFileSync(new URL(`../public/assets/levels/${id}/level.json`, import.meta.url), 'utf8'));
const LEVEL_IDS = ['1-1', '1-2', '1-3', '1-4', '1-A', '2-1', '2-2', '2-3', '2-4', '2-A', '3-1', '3-2', '3-3', '3-4', '3-A', '4-1', '4-3'];
const mech = { scenes: Object.fromEntries(LEVEL_IDS.map(id => [id, scene(id).mechanisms]).filter(([, m]) => m)) };

test('关卡机关数据：每张图都有天气，16 张有软边界，机关的 scenePath 对得上场景文档', () => {
  assert.equal(Object.keys(mech.scenes).length, 17);
  for (const [id, s] of Object.entries(mech.scenes)) {
    assert.ok(s.weather, `${id} 有天气导演`);
    const doc = scene(id);
    const f = doc.environment.fog;
    assert.deepEqual([s.weather.baseFogStart, s.weather.baseFogEnd], [f.start, f.end], `${id} 天气基础雾 = 场景雾`);
    for (const v of s.lava ?? []) {
      const r = doc.renderers.find(x => x.scenePath === v.surface);
      if (!r) continue; // 场景里 MeshFilter 空着的熔岩面（3-2 ① 铸槽）运行时现建
      near(r.position[0], v.position[0], 0.01, `${id} ${v.scenePath} 熔岩面 x`);
      near(r.position[2], v.position[2], 0.01);
      near(r.position[1], v.position[1] + 0.04, 0.02, '熔岩面画在判定高度上方 4 cm');
    }
    if (id !== '2-4') assert.ok(s.boundary, `${id} 有软边界`);
  }
  assert.equal(mech.scenes['1-2'].quicksand.length, 3);
  assert.equal(mech.scenes['3-3'].lava.length, 49);
  assert.equal(mech.scenes['3-3'].foundryChannels[0].surge.length, 8);
  assert.equal(mech.scenes['3-3'].foundryChannels[0].rise, 0.75);
  assert.equal(mech.scenes['3-3'].sluices.length, 2);
  assert.equal(mech.scenes['4-1'].conductors.length, 41);
  assert.deepEqual(mech.scenes['1-1'].weather.windDir.map(v => Math.round(v * 1e4) / 1e4), [0.8211, -0.5708], '风向 x 取反');
  assert.equal(mech.scenes['1-1'].weather.regions[0].profile, 'sandstorm');
});

test('软边界距离场：尺寸对得上文件（字节在转换时已逐个比对过）', async () => {
  for (const [id, s] of Object.entries(mech.scenes)) {
    if (!s.boundary) continue;
    const bytes = readFileSync(new URL(`../public/${s.boundary.url}`, import.meta.url));
    assert.equal(bytes.length, s.boundary.width * s.boundary.height * 4, id);
  }
  // 1-1 出生点在可玩区里（距离为负），界外 60 m 在起风线外
  const b = mech.scenes['1-1'].boundary;
  const f = new B.BoundaryField(new Float32Array(readFileSync(new URL(`../public/${b.url}`, import.meta.url)).buffer.slice(0)), b.width, b.height, b.origin, b.cell);
  const spawn = scene('1-1').spawn.position;
  assert.ok(f.sample(-spawn[0], spawn[2]) < 0, '出生点在界内（网页点按 −x 采样）');
});


// ───────────────────────────── 各图脚本的门槛 ─────────────────────────────

test('关卡目标：据点表还没建时不算完成；必清据点全肃清才算（3-3 领主战门槛）', async () => {
  const Lv = await import(await ts('../src/world/mechanisms/Levels.ts', {
    './Lava': data('export const LAVA_ORANGE = 0, LAVA_GOLD = 0;'), './Parts': partsUrl,
  }));
  const { stageGates } = await import(await ts('../src/world/mechanisms/StageGates.ts'));
  const encounters = [];
  const host = { ctx: { stage: { exploration: { encounters } } }, site: t => encounters.find(e => e.id === t)?.phase ?? null };
  const objective = { title: '肃清铸范大坊', required: ['范场', '神范前庭'], optional: [], altarsNeeded: 0 };
  assert.equal(Lv.objectiveComplete(host, objective), false, '据点表还没建');
  encounters.push({ id: '范场', phase: 'cleared' }, { id: '神范前庭', phase: 'active' }, { id: 'boss:boss_warlord:0', phase: 'undiscovered' });
  assert.equal(Lv.objectiveComplete(host, objective), false);
  encounters[1].phase = 'cleared';
  assert.equal(Lv.objectiveComplete(host, objective), true);
  assert.equal(Lv.objectiveComplete(host, null), true, '没给目标：非首领、非可选的据点全肃清');
  let locked = true;
  const off = stageGates.addFightGate(id => id === 'boss:boss_warlord:0' && locked);
  assert.ok(stageGates.fightBlocked('boss:boss_warlord:0', v3(0, 0, 0)));
  assert.ok(!stageGates.fightBlocked('范场', v3(0, 0, 0)));
  locked = false;
  assert.ok(!stageGates.fightBlocked('boss:boss_warlord:0', v3(0, 0, 0)));
  off();
});
