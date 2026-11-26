// M5 敌人框架对照（Unity EditMode：EnemyFrameworkTests.cs 的出手名额、EliteAffixTests.cs 的词缀 / 龙卷、
// Ch4FoundationTests.cs 的受击四层）→ node --test：同样的输入、同样的断言；常量和 Unity 版删除前从 C# 冻结的规格比
// （tests/fixtures/spec/cs-consts.json、enemies.json）。
// 另加：出场位移（SpawnEntrance）、沙魇常量（SandWraithAI）、第四章招式表（PlateauKit.PlateauMoves ↔ foes.ts defineMoves）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
import { spec } from './unity-parity-kit.mjs';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return data(stripTypeScriptTypes(source, { mode: 'transform' }));
}
/** C# 常量，键 = 相对 Unity 工程 Game/Scripts 的文件名 */
const K = spec('cs-consts');
const ENEMIES = spec('enemies');

const attackTokensUrl = await ts('../src/enemies/AttackTokens.ts');
const hitReactionUrl = await ts('../src/enemies/HitReaction.ts');
const tornadoUrl = await ts('../src/enemies/EliteTornado.ts');
const entranceUrl = await ts('../src/enemies/SpawnEntrance.ts');
const { attackDirector } = await import(attackTokensUrl);
const HR = await import(hitReactionUrl);
const { TORNADO, sweepOverlaps } = await import(tornadoUrl);
const { ENTRANCE, entrancePlan, entranceAt } = await import(entranceUrl);
const { Rng } = await import(await ts('../src/core/Rng.ts'));

// 词缀：模型 / 危害 / 刀光 / 贴花打桩（只测数值与时序）
const blasts = [];
const affixesUrl = await ts('../src/enemies/Affixes.ts', {
  './Models': data(`export const Geo = new Proxy({}, { get: () => () => ({}) });
    export function newAdditive() { return { opacity: 1 }; }
    export function part() { return { rotation: { x: 0, y: 0, z: 0 }, position: { set() {} }, scale: { set() {}, setScalar() {} }, visible: true }; }`),
  './Hazards': data(`export function blastPlayer(...a) { globalThis.__blasts.push(a); }`),
  './AttackTokens': attackTokensUrl,
  './EliteTornado': tornadoUrl,
  './fx/SlashArc': data('export function spawnSlashArc() {}'),
  './bosses/Visuals': data(`export class GroundDecal { static acquire() { return new GroundDecal(); } rect() { return this; } circle() { return this; } release() {} }`),
});
globalThis.__blasts = blasts;
const { AFFIX_IDS, createAffix, rollAffix, SwiftAffix } = await import(affixesUrl);

// ───────────── 出手名额（EnemyFrameworkTests） ─────────────

const T0 = 100;

test('tokens: caps widen with chapter, same as Unity AttackTokens.Cap', async () => {
  attackDirector.reset();
  assert.deepEqual([0, 1, 2].map(c => attackDirector.cap('melee', c)), [4, 5, 6]);
  assert.deepEqual([0, 1, 2].map(c => attackDirector.cap('ranged', c)), [2, 3, 4]);
  assert.deepEqual([0, 1, 2].map(c => attackDirector.cap('heavy', c)), [1, 2, 2]);
  assert.equal(attackDirector.cap('melee', -3), 4, '章序夹到 0..2');
  assert.equal(attackDirector.cap('melee', 9), 6);
  // 发放间隔照 C# 的 Gap 表（近战 / 远程 / 重击）
  assert.deepEqual(ENEMIES.attackTokenGap, [0.12, 0.32, 0.7]);
  const web = await readFile(new URL('../src/enemies/AttackTokens.ts', import.meta.url), 'utf8');
  const gap = /const MIN_GAP[^=]*= \{ melee: ([\d.]+), ranged: ([\d.]+), heavy: ([\d.]+) \}/.exec(web).slice(1).map(Number);
  assert.deepEqual(gap, ENEMIES.attackTokenGap);
});

test('tokens: first chapter grants four melee spaced by the gap', () => {
  attackDirector.reset();
  assert.ok(attackDirector.tryAcquire(1, 'melee', T0, 5, 0));
  assert.ok(!attackDirector.tryAcquire(2, 'melee', T0 + 0.05, 5, 0), '两次发放间隔 < 0.12 s');
  assert.ok(attackDirector.tryAcquire(2, 'melee', T0 + 0.2, 5, 0));
  assert.ok(attackDirector.tryAcquire(3, 'melee', T0 + 0.4, 5, 0));
  assert.ok(attackDirector.tryAcquire(4, 'melee', T0 + 0.6, 5, 0));
  assert.ok(!attackDirector.tryAcquire(5, 'melee', T0 + 0.8, 5, 0), '第一章近战上限 4');
  assert.ok(attackDirector.tryAcquire(5, 'melee', T0 + 0.8, 5, 1), '第二章近战上限 5');
});

test('tokens: holder renews even when full; expired holds are reclaimed', () => {
  attackDirector.reset();
  assert.ok(attackDirector.tryAcquire(1, 'heavy', T0, 1, 0));
  assert.ok(!attackDirector.tryAcquire(2, 'heavy', T0 + 0.9, 1, 0), '第一章重击上限 1');
  assert.ok(attackDirector.tryAcquire(1, 'heavy', T0 + 0.9, 1, 0), '已持有：续期');
  assert.ok(!attackDirector.tryAcquire(2, 'heavy', T0 + 1.5, 1, 0));
  assert.ok(attackDirector.tryAcquire(2, 'heavy', T0 + 2, 1, 0), '过期的名额自动回收');
  assert.ok(!attackDirector.holding(1));
});

test('tokens: ranged and heavy share a combined cap', () => {
  attackDirector.reset();
  for (let i = 0; i < 3; i++) assert.ok(attackDirector.tryAcquire(10 + i, 'ranged', T0 + i, 9, 1));
  assert.ok(attackDirector.tryAcquire(20, 'heavy', T0 + 4, 9, 1));
  assert.ok(!attackDirector.tryAcquire(21, 'heavy', T0 + 6, 9, 1), '重击才 1 个，但合计已满 4');
  assert.ok(attackDirector.tryAcquire(22, 'melee', T0 + 6, 9, 1), '近战不算进远程合计');
});

test('tokens: release / reset free slots; dead holders are pruned (Unity Prune)', () => {
  attackDirector.reset();
  assert.ok(attackDirector.tryAcquire(1, 'heavy', T0, 9, 0));
  attackDirector.release(1);
  assert.ok(attackDirector.tryAcquire(2, 'heavy', T0 + 1, 9, 0));
  attackDirector.reset();
  assert.equal(attackDirector.count('heavy'), 0);
  assert.ok(attackDirector.tryAcquire(3, 'heavy', T0 + 1.1, 9, 0), 'reset 也清掉了发放间隔');
  // 持有者死了：下一次申请时顺手收回
  const dead = new Set([3]);
  attackDirector.setLiveness(id => !dead.has(id));
  try {
    assert.ok(attackDirector.tryAcquire(4, 'heavy', T0 + 2, 9, 0), '死掉的持有者不占名额');
    assert.ok(!attackDirector.holding(3));
  } finally {
    attackDirector.setLiveness(null);
    attackDirector.reset();
  }
});

// ───────────── 受击四层（Ch4FoundationTests.HitLayers_*） ─────────────

test('hit layers: poise damage and the two-second window match HitReaction.cs', async () => {
  const c = K['Enemies/HitReaction.cs'];
  assert.equal(HR.POISE_DECAY_PER_SECOND, c.PoiseDecayPerSecond);
  assert.equal(HR.WEAK_POISE, c.WeakPoise);
  assert.equal(HR.BLAST_POISE, c.BlastPoise);
  assert.equal(HR.STUN_TAKEN_MULT, c.StunTakenMult);
  assert.equal(HR.DEFAULT_STAGGER_SECONDS, ENEMIES.staggerSeconds, 'EnemyDef.staggerSeconds 缺省值');

  assert.equal(HR.poiseDamage({ source: 'weapon' }, 10), 10);
  assert.equal(HR.poiseDamage({ source: 'weapon', headshot: true }, 10), 20, '弱点 × 2');
  assert.equal(HR.poiseDamage({ source: 'explosion' }, 10), 30, '爆炸 × 3');
  assert.equal(HR.poiseDamage({ source: 'weapon', tags: ['explosion'] }, 10), 30, '带爆炸标签的武器弹 × 3');
  assert.equal(HR.poiseDamage({ source: 'status', tags: ['reaction', 'thunderfire'] }, 10), 30, '反应 × 3');
  assert.equal(HR.poiseDamage({ source: 'status' }, 10), 0, '持续伤害不算韧性');
  assert.ok(HR.isDotHit({ source: 'status' }) && !HR.isDotHit({ source: 'status', tags: ['reaction'] }));

  const m = new HR.PoiseMeter(30);
  assert.ok(!m.add(20));
  assert.ok(m.add(10), '累计到韧性就硬直');
  assert.equal(m.value, 0, '破完清零');
  m.add(20);
  m.tick(1);
  assert.ok(Math.abs(m.value - 5) < 1e-4, '每秒回落韧性的一半（2 秒窗口）');
  m.tick(10);
  assert.equal(m.value, 0);
  assert.ok(!new HR.PoiseMeter(0).add(1e6), '韧性 0：不用韧性系统');
  assert.ok(!new HR.PoiseMeter(Infinity).add(1e6), '+∞：永远不硬直');
});

// ───────────── 精英词缀（EliteAffixTests） ─────────────

/** 一只假敌人（AffixHost）+ 假 ctx：只跑数值 */
function host({ hp = 100, dmg = 1, chapter = 0 } = {}) {
  const tasks = [];
  const player = { position: new THREE.Vector3(10, 0, 0), velocity: new THREE.Vector3(), alive: true, radius: 0.35, impulses: [], applyImpulse(v) { this.impulses.push(v.clone()); } };
  const ctx = {
    rng: new Rng(7), time: { now: 0, dt: 0 }, run: { chapter }, stage: { arena: { floorY: 0 } }, stageGroup: new THREE.Group(), scene: new THREE.Scene(),
    fx: { burst() {}, ring() {}, explosion() {}, shake() {}, groundWarning: () => () => {} },
    audio: { play() {} },
    world: { segmentBlocked: () => false, groundHeight: () => 0 },
    combat: { hits: [], damagePlayer(amount, element, source) { this.hits.push(amount); return amount; } },
    player,
    tasks: {
      add(fn) { const t = { fn, dead: false }; tasks.push(t); return () => { t.dead = true; }; },
      delay(s, fn) { let left = s; return this.add(dt => { left -= dt; if (left <= 0) { fn(); return true; } }); },
    },
    step(dt) {
      this.time.now += dt;
      this.time.dt = dt;
      for (const t of tasks.slice()) if (!t.dead && t.fn(dt) === true) t.dead = true;
    },
  };
  const e = {
    id: 1000 + Math.floor(Math.random() * 1e6), ctx, def: { id: 'x', radius: 0.4, height: 1.8 }, model: new THREE.Group(),
    position: new THREE.Vector3(), velocity: new THREE.Vector3(), alive: true, hp, maxHp: hp, shield: 0, maxShield: 0,
    height: 1.8, radius: 0.4, sizeScale: 1, lastHurtTime: -999, stunTime: 0,
    speedMult: 1, attackRate: 1, damageMult: dmg, frenzied: false, affixAttackBusy: false,
    tintBody() {}, ownMaterial: m => m, getBodyCenter: out => out.set(0, 0.9, 0),
  };
  return e;
}

test('affixes: the four Unity affixes; roll is uniform over the ones not excluded, null when all are', async () => {
  assert.deepEqual([...AFFIX_IDS], ['swift', 'shielded', 'volatile', 'frenzied']);
  const rng = new Rng(3);
  const counts = {};
  for (let i = 0; i < 3000; i++) {
    const a = rollAffix(rng, ['volatile']);
    counts[a] = (counts[a] ?? 0) + 1;
  }
  assert.ok(!('volatile' in counts), '排除表里的不随机给');
  assert.equal(Object.keys(counts).length, 3);
  for (const [k, v] of Object.entries(counts)) assert.ok(v > 850 && v < 1150, `${k} 均匀（约 1000）：${v}`);
  assert.equal(rollAffix(rng, ['swift', 'shielded', 'volatile', 'frenzied']), null, '全被排除：不给词缀');
});

test('affixes: shielded adds 60% shield and regens 22%/s after 4 s out of combat', async () => {
  const c = K['Enemies/Affixes/EliteAffix_Shielded.cs'];
  assert.deepEqual([c.ShieldFrac, c.RegenDelay, c.RegenRate], [0.6, 4, 0.22]);
  const e = host({ hp: 260 });
  const ctl = createAffix(e, 'shielded');
  assert.deepEqual([e.maxShield, e.shield], [156, 156], '额外护盾 = 最大生命 60%');
  e.shield = 50;
  e.lastHurtTime = 10;
  e.ctx.time.now = 13.9;
  ctl.update(1);
  assert.equal(e.shield, 50, '挨打后 4 s 内不回');
  e.ctx.time.now = 14.1;
  ctl.update(1);
  assert.ok(Math.abs(e.shield - (50 + 156 * 0.22)) < 1e-3, '每秒 22% 护盾上限');
  ctl.update(10);
  assert.equal(e.shield, 156, '回满为止');
});

test('affixes: volatile blows up 1 s after death for 26 × damage mult in 4.5 m', async () => {
  const c = K['Enemies/Affixes/EliteAffix_Volatile.cs'];
  assert.deepEqual([c.Radius, c.Fuse, c.BaseDamage], [4.5, 1, 26]);
  blasts.length = 0;
  const e = host({ dmg: 1.5 });
  const ctl = createAffix(e, 'volatile');
  ctl.update(0.5);
  ctl.onDeath({});
  e.ctx.step(0.9);
  assert.equal(blasts.length, 0, '1 s 引信');
  e.ctx.step(0.2);
  assert.equal(blasts.length, 1, '炸了');
  const [, , radius, damage, element] = blasts[0];
  assert.equal(radius, 4.5);
  assert.ok(Math.abs(damage - 26 * 1.5) < 1e-6, '26 × 伤害倍率（按死亡那一刻）');
  assert.equal(element, 'fire');
});

test('affixes: frenzied triggers once at ≤ 40% (damage ×1.2, rate ×1.6, speed ×1.35)', async () => {
  assert.equal(K['Enemies/Affixes/EliteAffix_Frenzied.cs'].Threshold, 0.4);
  const { damage, rate, speed, taken } = spec('elite-affixes').affixes.frenzied.mods;
  assert.deepEqual([damage, rate, speed, taken], [1.2, 1.6, 1.35, 1]);
  const e = host({ hp: 100 });
  const ctl = createAffix(e, 'frenzied');
  ctl.update(0.1);
  assert.ok(!e.frenzied);
  e.hp = 41;
  ctl.update(0.1);
  assert.ok(!e.frenzied, '41%：还没');
  e.hp = 40;
  ctl.update(0.1);
  assert.ok(e.frenzied, '40% 及以下狂暴');
  assert.deepEqual([e.damageMult, e.attackRate, e.speedMult], [1.2, 1.6, 1.35]);
  e.hp = 100;
  ctl.update(0.1);
  assert.deepEqual([e.damageMult, e.attackRate, e.speedMult], [1.2, 1.6, 1.35], '回血也不退出（只触发一次）');
});

test('affixes: swift tornado sweep catches crossed players but respects height and radius', async () => {
  const c = K['Enemies/Affixes/EliteTornado.cs'];
  assert.deepEqual(
    [TORNADO.windup, TORNADO.range, TORNADO.speed, TORNADO.radius, TORNADO.height, TORNADO.baseDamage, TORNADO.cooldownMin, TORNADO.cooldownMax],
    [c.Windup, c.Range, c.Speed, c.Radius, c.Height, c.BaseDamage, c.CooldownMin, c.CooldownMax]);
  const from = { x: 0, y: 0, z: 0 }, to = { x: 0, y: 0, z: 4 };
  assert.ok(sweepOverlaps(from, to, { x: 0.4, y: 0, z: 2 }, 0.35), '一帧跨过玩家也要命中');
  assert.ok(sweepOverlaps(from, to, { x: 1.5, y: 0, z: 2 }, 0.35), '龙卷半径与玩家胶囊半径相加');
  assert.ok(!sweepOverlaps(from, to, { x: 2, y: 0, z: 2 }, 0.35), '横向躲开');
  assert.ok(!sweepOverlaps(from, to, { x: 0, y: TORNADO.height + 0.2, z: 2 }, 0.35), '高过风柱');
  assert.ok(!sweepOverlaps(from, to, { x: 0, y: -2.1, z: 2 }, 0.35), '深坑下方');
  // Unity Swift：首次冷却 4.5–6.5、出手距离 4–24 m、高差 ≤ 4、收招 0.22（recovery = 0.22f）、
  // 打中玩家的冲量 3.5 / 2.2 / 6.2（EliteTornado：direction × 3.5 + side × 2.2 + up × 6.2）
  assert.deepEqual([TORNADO.firstMin, TORNADO.firstMax], [4.5, 6.5]);
  assert.deepEqual([TORNADO.minDistance, TORNADO.maxDistance, TORNADO.maxRise], [4, 24, 4]);
  assert.equal(TORNADO.recovery, 0.22);
  assert.deepEqual([TORNADO.pushForward, TORNADO.pushSide, TORNADO.pushUp], [3.5, 2.2, 6.2]);
});

test('affixes: swift speeds up ×1.5, then winds 0.85 s, takes the heavy token and releases a tornado for 18 × mult', () => {
  attackDirector.reset();
  const e = host({ dmg: 1.4 });
  const ctl = createAffix(e, 'swift');
  assert.ok(ctl instanceof SwiftAffix);
  assert.deepEqual([e.speedMult, e.attackRate], [1.5, 1.5], '移速、攻速 ×1.5');
  // 冷却没到：不出
  e.ctx.step(1 / 30);
  ctl.update(1 / 30);
  assert.ok(!ctl.winding);
  // 冷却到了、玩家 10 m 外看得见：蓄风、拿重击名额、基础 AI 停手
  for (let i = 0; i < 300 && !ctl.winding; i++) {
    e.ctx.step(1 / 30);
    ctl.update(1 / 30);
  }
  assert.ok(ctl.winding, '冷却到了就蓄风');
  assert.ok(e.affixAttackBusy, '蓄风期间基础 AI 停手');
  assert.ok(attackDirector.holding(e.id), '拿着重击名额');
  let t = 0;
  while (ctl.winding && t < 2) {
    e.ctx.step(1 / 60);
    ctl.update(1 / 60);
    t += 1 / 60;
  }
  assert.ok(Math.abs(t - TORNADO.windup) < 0.04, `蓄风 0.85 s（实际 ${t.toFixed(3)}）`);
  assert.equal(ctl.released, 1);
  assert.ok(Math.abs(ctl.last.damage - 18 * 1.4) < 1e-6, '18 × 伤害倍率');
  assert.ok(!attackDirector.holding(e.id), '放出后还名额');
  assert.ok(e.affixAttackBusy, '收招 0.22 s 内还停着');
  for (let i = 0; i < 20; i++) {
    e.ctx.step(1 / 60);
    ctl.update(1 / 60);
  }
  assert.ok(!e.affixAttackBusy, '收招完交还基础 AI');
  // 龙卷沿锁定方向（+x，朝玩家）8 m/s 前行，碰到站在 10 m 处的玩家打一次
  for (let i = 0; i < 90; i++) e.ctx.step(1 / 30);
  assert.equal(ctl.last.playerHits, 1, '碰到玩家只结算一次');
  assert.ok(Math.abs(e.ctx.combat.hits[0] - 18 * 1.4) < 1e-6);
  const imp = e.ctx.player.impulses[0];
  assert.ok(Math.abs(imp.x - 3.5) < 1e-6 && Math.abs(imp.y - 6.2) < 1e-6 && Math.abs(imp.z + 2.2) < 1e-6, '冲量：前 3.5、侧 2.2、上 6.2');
  ctl.dispose();
  attackDirector.reset();
});

test('affixes: swift cancels the wind-up when stunned and gives the token back', () => {
  attackDirector.reset();
  const e = host();
  const ctl = createAffix(e, 'swift');
  for (let i = 0; i < 300 && !ctl.winding; i++) {
    e.ctx.step(1 / 30);
    ctl.update(1 / 30);
  }
  assert.ok(ctl.winding);
  e.stunTime = 1;
  ctl.update(1 / 30);
  assert.ok(!ctl.winding && !e.affixAttackBusy && !attackDirector.holding(e.id), '眩晕打断蓄风、交还名额');
  assert.equal(ctl.released, 0);
  attackDirector.reset();
});

// ───────────── 出场位移（SpawnEntrance.cs） ─────────────

test('entrance: hop / fly / jump timings and arcs match SpawnEntrance.cs', async () => {
  const c = K['Encounters/SpawnModes/SpawnEntrance.cs'];
  assert.deepEqual([ENTRANCE.hopTime, ENTRANCE.peekTime, ENTRANCE.jumpTime, ENTRANCE.flySpeed], [c.HopTime, c.PeekTime, c.JumpTime, c.FlySpeed]);
  const a = { x: 0, y: 0, z: 0 };
  const hop = entrancePlan('hop', a, { x: 4, y: 2, z: 0 });
  assert.deepEqual([hop.delay, hop.duration, hop.height], [0, 1.2, 1.2 + 2 * 0.5], '熔岩爬出：1.2 s，弧高 1.2 + 爬高的一半');
  const fly = entrancePlan('fly', a, { x: 30, y: 0, z: 0 });
  assert.equal(fly.duration, 2.5, '飞临：30 m ÷ 12 m/s');
  assert.ok(Math.abs(fly.height - 3.6) < 1e-9, '弧高 = 距离 × 0.12');
  assert.equal(entrancePlan('fly', a, { x: 3, y: 0, z: 0 }).duration, 1.2, '至少 1.2 s');
  assert.equal(entrancePlan('fly', a, { x: 90, y: 0, z: 0 }).height, 6, '弧高最多 6 m');
  const jump = entrancePlan('jump', { x: 0, y: 5, z: 0 }, { x: 4, y: 0, z: 0 });
  assert.deepEqual([jump.delay, jump.duration, jump.height], [0.6, 0.75, 1.2], '跃下：露头 0.6 s、跳 0.75 s');
  const out = {};
  assert.equal(entranceAt(jump, { x: 0, y: 5, z: 0 }, { x: 4, y: 0, z: 0 }, 0.3, out), 0);
  assert.deepEqual(out, { x: 0, y: 5, z: 0 }, '露头期间停在墙头');
  const u = entranceAt(jump, { x: 0, y: 5, z: 0 }, { x: 4, y: 0, z: 0 }, 0.6 + 0.375, out);
  assert.equal(u, 0.5);
  assert.ok(Math.abs(out.x - 2) < 1e-9 && Math.abs(out.y - (2.5 + 1.2)) < 1e-9, '跃下线性插值 + 弧高 × 4u(1 − u)');
  entranceAt(hop, a, { x: 4, y: 2, z: 0 }, 0.3, out);
  assert.ok(Math.abs(out.x - 4 * 0.15625) < 1e-9, '其余按 SmoothStep');
  assert.equal(entranceAt(hop, a, { x: 4, y: 2, z: 0 }, 5, out), 1);
  assert.deepEqual(out, { x: 4, y: 2, z: 0 });
});

// ───────────── 沙魇（SandWraithAI.cs） ─────────────

test('sand wraith: move constants and roster entry match SandWraithAI / Enemy_SandWraith', async () => {
  const c = K['Enemies/SandWraithAI.cs'];
  const src = await readFile(new URL('../src/enemies/types/SandWraith.ts', import.meta.url), 'utf8');
  const literal = src.match(/export const SAND_WRAITH = (\{[\s\S]*?\}) as const;/)[1];
  const W = Function(`return (${literal});`)();
  const pairs = {
    burrowMin: 'BurrowMin', burrowMax: 'BurrowMax', sinkTime: 'SinkTime', tunnelSpeed: 'TunnelSpeed', tunnelMax: 'TunnelMax', surfaceTime: 'SurfaceTime',
    eruptRadius: 'EruptRadius', eliteEruptRadius: 'EliteEruptRadius', eruptMult: 'EruptMult', eruptKnock: 'EruptKnock', eruptKnockUp: 'EruptKnockUp',
    recoverAfterErupt: 'RecoverAfterErupt', slashRange: 'SlashRange', slashWindup: 'SlashWindup', recoverAfterSlash: 'RecoverAfterSlash',
    chainRange: 'ChainRange', sinkDepth: 'SinkDepth', riseTime: 'RiseTime',
  };
  for (const [ts, csName] of Object.entries(pairs)) assert.equal(W[ts], c[csName], `${ts} ↔ ${csName}`);
  // 前摇按 Unity Windup(time, minFraction) 的口径：Windup(SlashWindup, 0.24f)、Windup(SurfaceTime, 0.45f)
  assert.match(src, /windupFrac\(W\.slashWindup, 0\.24\)/);
  assert.match(src, /windupFrac\(W\.surfaceTime, 0\.45\)/);
  // 用自己的名册生成（原来漏传，跑起来是跳鼠刀兵的 42 生命 / 7 移速 / 体型 1.3）；Unity Enemy_SandWraith：scale 1.4、hp 55、speed 5.6、damage 12
  assert.match(src, /super\(ctx, opts, SAND_WRAITH_DEF\)/);
  assert.match(src, /scale: 1\.4, hp: 55, speed: 5\.6, damage: 12/);
});

// ───────────── 第四章招式表（PlateauKit.PlateauMoves ↔ foes.ts defineMoves） ─────────────

test('plateau: leash range and haste numbers match PlateauEnemyAI', async () => {
  const adapter = await readFile(new URL('../src/enemies/plateau/PlateauFoeAdapter.ts', import.meta.url), 'utf8');
  assert.equal(K['Enemies/AI/Plateau/PlateauEnemyAI.cs'].LeashRange, Number(adapter.match(/const LEASH_RANGE = (\d+);/)[1]), '脱战距离');
  // Unity PlateauEnemyAI：DistToPlayer > 60 不处理；连鼓灵加速 BuffMods(1, 1.4, 1.4, 1)；未警觉时每秒回 30% 生命
  assert.match(adapter, /<= 60\) return;/);
  const foe = await readFile(new URL('../src/world/plateau/play/foe.ts', import.meta.url), 'utf8');
  assert.match(foe, /this\.haste > 0 \? 1\.4 : 1/, '连鼓灵加速：攻速 / 移速 ×1.4');
  assert.match(foe, /if \(this\.hp < this\.maxHp\) this\.hp = Math\.min\(this\.maxHp, this\.hp \+ this\.maxHp \* 0\.3 \* dt\)/, '未警觉时每秒回 30%');
});

test('plateau: every Unity PlateauMove has the same timings / flags / events as foes.ts', async () => {
  // PlateauKit.PlateauMoves：资产 → 招式（id / 名字 / 前摇 / 判定 / 收招 / 冷却 / 闪光 / 不判伤 / 事件）
  const byAsset = ENEMIES.plateauMoves;
  assert.ok(Object.keys(byAsset).length >= 8, '八种资产的招式表');

  const foes = await readFile(new URL('../src/world/plateau/play/foes.ts', import.meta.url), 'utf8');
  const web = {};
  for (const m of foes.matchAll(/defineMoves\('(\w+)', (\[[\s\S]*?\])\);/g)) web[m[1]] = Function(`return (${m[2]});`)();
  for (const [asset, moves] of Object.entries(byAsset)) {
    const list = web[asset];
    assert.ok(list, `foes.ts 有 ${asset} 的招式表`);
    for (const u of moves) {
      const w = list.find(x => x.id === u.id);
      assert.ok(w, `${asset}.${u.id}`);
      assert.deepEqual(
        [w.windup, w.active, w.recover, w.cooldown ?? 0, !!w.glint, !!w.noHit, (w.events ?? []).map(e => `${e.at}:${e.name}`)],
        [u.windup, u.active, u.recover, u.cooldown, u.glint, u.noHit, u.events.map(e => `${e.at}:${e.name}`)],
        `${asset}.${u.id}`);
    }
  }
});
