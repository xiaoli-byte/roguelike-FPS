// 第二章群怪（冻鲛人 jiaoren、雪狌狌 xingxing）的无头回归：真实的 EnemyBase / StandardEnemy / 碰撞 / 导航 / 任务调度，
// 只把渲染相关（美术资产挂载、特效、音效）换成记录调用的桩。每个用例逐帧推进状态机，走完一招主要攻击。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

// EnemyBase staggers line-of-sight / repath timers with Math.random; seed it so every run steps the same frames
// (the ice-chunk test failed about once in a dozen runs when a late LOS refresh pushed the throw past its window).
let seed = 0x2f6e2b1;
Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const skelUrl = new URL('../node_modules/three/examples/jsm/utils/SkeletonUtils.js', import.meta.url).href;
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return dataModule(source + '\n//# sourceURL=' + new URL(path, import.meta.url).href);
}

const mathUrl = await ts('../src/core/math.ts');
const typesUrl = await ts('../src/core/types.ts');
const tasksUrl = await ts('../src/core/Tasks.ts');
const { TaskRunner } = await import(tasksUrl);
const { CollisionWorld } = await import(await ts('../src/world/Collision.ts'));
const { NavGrid } = await import(await ts('../src/world/NavGrid.ts', { '../core/math': mathUrl }));
const modelsUrl = await ts('../src/enemies/Models.ts', { '../core/math': mathUrl });
const tokensUrl = await ts('../src/enemies/AttackTokens.ts');
const { attackDirector } = await import(tokensUrl);
const levelsUrl = await ts('../src/enemies/Levels.ts');
const hazardsUrl = await ts('../src/enemies/Hazards.ts', { '../core/math': mathUrl });
const enemyBaseUrl = await ts('../src/enemies/EnemyBase.ts', { '../core/types': typesUrl, '../core/math': mathUrl });
const nativeRigUrl = await ts('../src/assets/NativeRig.ts', { 'three/addons/utils/SkeletonUtils.js': skelUrl });
const { NativePose } = await import(nativeRigUrl);
// 美术挂载桩：测试可通过 globalThis.__frostArt 注入一个按 creature_rigs 骨架搭出来的原生骨架身体
const artUrl = dataModule(`export function attachEnemyArt(o) {
  const n = globalThis.__frostArt ? globalThis.__frostArt(o) : null;
  return { body: n, native: n, parts: [] };
}`);
const affixUrl = dataModule(`export const AFFIX_NAMES = {}; export function isAffixId() { return false; } export function createAffix() { return null; }`);
const standardUrl = await ts('../src/enemies/StandardEnemy.ts', {
  '../core/math': mathUrl, './EnemyBase': enemyBaseUrl, './AttackTokens': tokensUrl, './Affixes': affixUrl,
  './Levels': levelsUrl, './Models': modelsUrl, '../assets/EnemyArt': artUrl,
});
const fxUrl = await ts('../src/enemies/fx/FrostPackFx.ts', { '../../core/math': mathUrl, '../Hazards': hazardsUrl, '../Models': modelsUrl });
const slashUrl = await ts('../src/enemies/fx/SlashArc.ts');
const motionUrl = await ts('../src/enemies/frost/PackMotion.ts', { '../../core/math': mathUrl });
const shared = {
  '../../core/math': mathUrl, '../StandardEnemy': standardUrl, '../AttackTokens': tokensUrl, '../Models': modelsUrl,
  '../fx/FrostPackFx': fxUrl, '../frost/PackMotion': motionUrl, '../Hazards': hazardsUrl, '../fx/SlashArc': slashUrl,
};
const { Jiaoren, JIAOREN_DEF } = await import(await ts('../src/enemies/types/Jiaoren.ts', shared));
const { Xingxing, XINGXING_DEF } = await import(await ts('../src/enemies/types/Xingxing.ts', shared));

const DT = 1 / 60;

function arena(extraBoxes = []) {
  const world = new CollisionWorld();
  world.addBox(-30, -0.2, -30, 30, 0, 30, 'floor');
  for (const b of extraBoxes) world.addBox(...b);
  return world;
}

/** 最小 GameContext：真实碰撞 / 导航 / 任务；特效、音效、战斗只记录调用 */
function context(world = arena()) {
  const events = { hits: [], projectiles: [], warnings: [], heals: [], rings: [], slashes: 0 };
  const statsMods = [];
  const player = {
    position: new THREE.Vector3(0, 0, 10), velocity: new THREE.Vector3(), eye: new THREE.Vector3(),
    radius: 0.3, height: 1.8, alive: true, invulnerableTime: 0,
    maxHp: () => 100, applyImpulse() {},
    stats: {
      getBase: () => 7.5,
      add: (key, value, source) => statsMods.push({ key, value, source }),
      hasSource: source => statsMods.some(m => m.source === source),
      removeSource: source => { for (let i = statsMods.length - 1; i >= 0; i--) if (statsMods[i].source === source) statsMods.splice(i, 1); },
    },
  };
  const ctx = {
    rng: { range: (a, b) => (a + b) / 2, sign: () => 1, chance: () => false, int: (a) => a, next: () => 0.5 },
    time: { now: 0, dt: DT, frame: 0, timeScale: 1 },
    player, world, tasks: new TaskRunner(),
    scene: new THREE.Group(), stageGroup: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    settings: { quality: 'high' }, renderer: null, run: { chapter: 1 },
    stage: { arena: { minX: -30, minZ: -30, maxX: 30, maxZ: 30, floorY: 0, center: new THREE.Vector3() }, stage: { theme: 'frost' } },
    enemies: { list: [], queryRadius: () => [] },
    combat: {
      damagePlayer: (amount, element, source) => { events.hits.push({ amount, source, t: ctx.time.now }); return amount; },
      explode() {},
    },
    projectiles: { spawn: spec => events.projectiles.push(spec) },
    loot: { dropHealth: (pos, amount) => events.heals.push({ pos: pos.clone(), amount }) },
    audio: { play() {} },
    fx: {
      burst() {}, shake() {}, explosion() {}, impact() {}, spawnEffect() {}, deathEffect() {},
      ring: (c, r) => events.rings.push({ c: c.clone(), r }),
      groundWarning: (c, r, d) => { const w = { c: c.clone(), r, d, cancelled: false }; events.warnings.push(w); return () => { w.cancelled = true; }; },
    },
  };
  ctx.nav = new NavGrid(ctx);
  ctx.nav.build(ctx.stage.arena, 0.25);
  return { ctx, events, statsMods };
}

function spawn(ctx, Type, x, z, opts = {}) {
  const e = new Type(ctx, { position: new THREE.Vector3(x, 0, z), ...opts });
  e.init();
  e.onGround = true;
  ctx.enemies.list.push(e);
  return e;
}

/** 推进 n 帧：玩家眼睛、任务、敌人一起走；until 返回 true 时提前停 */
function run(ctx, frames, until = () => false) {
  for (let i = 0; i < frames; i++) {
    ctx.time.now += DT;
    ctx.time.frame++;
    const p = ctx.player.position;
    ctx.player.eye.set(p.x, p.y + 1.6, p.z);
    for (const e of ctx.enemies.list) if (!e.removed) e.update(DT);
    ctx.tasks.update(DT);
    if (until()) return i + 1;
  }
  return frames;
}

/** 跳过出生动画，并让首次攻击冷却立即就绪 */
function ready(ctx, ...es) {
  run(ctx, 45);
  for (const e of es) e.cooldown = 0;
}

test('both pack defs are registered-shaped and construct headlessly with their procedural fallback bodies', () => {
  assert.equal(JIAOREN_DEF.id, 'jiaoren');
  assert.equal(XINGXING_DEF.id, 'xingxing');
  assert.ok(XINGXING_DEF.hp >= 50 && XINGXING_DEF.hp <= 60 && XINGXING_DEF.speed === 6.5, 'roster doc: hp ≈ 55, speed 6.5');
  assert.ok(Math.abs(XINGXING_DEF.scale * 1.3 - 1.7) < 0.05, 'roster doc: 1.3 m art scaled to ≈ 1.7 m');
  for (const Type of [Jiaoren, Xingxing]) {
    const { ctx } = context();
    const e = spawn(ctx, Type, 0, 0);
    run(ctx, 120);
    assert.ok(e.alive && Number.isFinite(e.position.x + e.position.y + e.position.z));
    const head = e.getHeadCenter(new THREE.Vector3());
    assert.ok(head.y > 1.0 && head.y < 1.6, `${Type.name} head hit sphere at ${head.y}`);
    e.dispose();
  }
  attackDirector.reset();
});

test('冻鲛人 telegraphs 0.5 s, then throws a dodgeable bone spear from 10–18 m and regrows it', () => {
  const { ctx, events } = context();
  ctx.player.position.set(0, 0, 14);
  const e = spawn(ctx, Jiaoren, 0, 0);
  ready(ctx, e);
  let aimAt = -1;
  run(ctx, 120, () => {
    if (aimAt < 0 && e.state === 'aim') aimAt = ctx.time.now;
    return events.projectiles.length > 0;
  });
  assert.ok(aimAt > 0, 'never raised the spear');
  assert.equal(events.projectiles.length, 1);
  const wind = ctx.time.now - aimAt;
  assert.ok(wind >= 0.45 && wind <= 0.56, `spear wind-up ${wind.toFixed(3)} s`);
  const shot = events.projectiles[0];
  assert.equal(shot.owner, 'enemy');
  assert.equal(shot.enemyDamage, JIAOREN_DEF.damage);
  assert.equal(typeof shot.onImpact, 'function');
  assert.ok(shot.velocity.z > 20 && shot.velocity.length() < 26, 'spear flies at the player');
  assert.equal(e.hasSpear, false);
  shot.onImpact(new THREE.Vector3(0, 1.2, 14), null);
  // 投完就算接战：空手时贴近玩家；5 秒后手里重新冻出一支矛
  run(ctx, 60);
  assert.ok(e.engaged);
  run(ctx, 5 * 60);
  assert.equal(e.hasSpear, true);
  attackDirector.reset();
});

test('冻鲛人 spear blocked by a projectile ward (碎刃 shard barrier): no damage, and the flying spear mesh shatters on the ward', async () => {
  // 真实的投射物系统：飞矛弹道穿过玩家身前的挡弹圆盘 → 伤害取消、onBlocked 回调 → 飞矛外观当场碎掉
  const pvUrl = await ts('../src/combat/ProjectileVisuals.ts', { '../core/math': mathUrl });
  const blastUrl = await ts('../src/combat/Blast.ts', { '../core/math': mathUrl });
  const { ProjectileSystem: Projectiles } = await import(await ts('../src/combat/Projectiles.ts', { '../core/math': mathUrl, './ProjectileVisuals': pvUrl, './Blast': blastUrl }));
  const { ctx, events } = context();
  ctx.player.position.set(0, 0, 14);
  const spawned = [];
  ctx.projectiles = { spawn: spec => spawned.push(spec) };
  const e = spawn(ctx, Jiaoren, 0, 0);
  ready(ctx, e);
  run(ctx, 120, () => spawned.length > 0);
  assert.equal(spawned.length, 1, 'spear thrown');
  assert.equal(typeof spawned[0].onBlocked, 'function', 'spear projectile carries the onBlocked hook');
  const spear = e.lastSpear;
  assert.ok(spear && !spear.done, 'spear visual is in flight');
  // 把真实投射物系统接上，挡弹圆盘竖在玩家身前 1.2 米
  ctx.scene = new THREE.Scene();
  ctx.camera = new THREE.PerspectiveCamera();
  ctx.events = { on() {}, emit() {} };
  const proj = new Projectiles(ctx);
  proj.init();
  const blocks = [];
  proj.setWard({
    center: new THREE.Vector3(0, 1.5, 12.8), normal: new THREE.Vector3(0, 0, -1), radius: 1.4,
    onBlock: (point, damage) => blocks.push({ point: point.clone(), damage }),
  });
  proj.spawn(spawned[0]);
  for (let i = 0; i < 90 && blocks.length === 0; i++) {
    ctx.time.now += DT;
    proj.update(DT);
    ctx.tasks.update(DT);
  }
  assert.equal(blocks.length, 1, 'the ward stops the spear');
  assert.equal(blocks[0].damage, JIAOREN_DEF.damage);
  ctx.tasks.update(DT);
  assert.equal(events.hits.length, 0, 'blocked spear deals no damage');
  assert.equal(spear.done, true, 'spear mesh shatters at the ward instead of flying on');
  proj.setWard(null);
  attackDirector.reset();
});

test('冻鲛人 pack: three close members lunge together (staggered), two do not; the pack gate holds', () => {
  for (const count of [3, 2]) {
    const { ctx, events } = context();
    ctx.player.position.set(0, 0, 0);
    const pack = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      pack.push(spawn(ctx, Jiaoren, Math.sin(a) * 4, Math.cos(a) * 4));
    }
    ready(ctx);
    for (const e of pack) { e.engaged = true; e.cooldown = 3; }
    const winds = new Set();
    let lunged = 0;
    run(ctx, 120, () => {
      for (const e of pack) if (e.state === 'lungeWindup') winds.add(e);
      lunged = pack.filter(e => e.state === 'lunge').length;
      return lunged === count;
    });
    if (count === 2) {
      assert.equal(winds.size, 0, 'two jiaoren must not start a pack lunge');
      continue;
    }
    assert.equal(winds.size, 3, 'all three members wind up');
    const windTimes = pack.map(e => e.windTime).sort((a, b) => a - b);
    assert.ok(windTimes[2] - windTimes[0] > 0.2, 'members are staggered');
    run(ctx, 60);
    assert.ok(events.hits.length >= 1 && events.hits.length <= 3, `pack hits ${events.hits.length}`);
    for (const h of events.hits) assert.ok(Math.abs(h.amount - JIAOREN_DEF.damage * 0.85) < 1e-6);
    // 收势后在门限时间内不会再发起一次群刺
    run(ctx, 90);
    assert.ok(pack.every(e => e.state !== 'lungeWindup'), 'pack gate / personal cooldown keeps them from re-lunging at once');
    attackDirector.reset();
  }
});

test('冻鲛人 drops its forehead pearl on death, which becomes a small heal pickup', () => {
  const { ctx, events } = context();
  ctx.player.position.set(0, 0, 8);
  const e = spawn(ctx, Jiaoren, 0, 0);
  run(ctx, 45);
  e.hp = 0;
  e.onKilled({ request: { base: 50, element: 'none', source: 'bullet' }, dealt: 50, isCrit: false, killed: true, layer: 'health', shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null });
  run(ctx, 30);
  assert.equal(events.heals.length, 0, 'pearl still rolling');
  run(ctx, 40);
  assert.equal(events.heals.length, 1);
  assert.equal(events.heals[0].amount, 5);
  assert.ok(events.heals[0].pos.y >= 0 && events.heals[0].pos.y < 0.4, 'pearl came to rest on the ground');
  attackDirector.reset();
});

test('雪狌狌 jump-slam: 0.45 s wind-up, real jump to a warned landing, ice ring damage and a short chill', () => {
  const { ctx, events, statsMods } = context();
  ctx.player.position.set(0, 0, 5);
  const e = spawn(ctx, Xingxing, 0, 0);
  ready(ctx, e);
  let windAt = -1, airAt = -1, maxY = 0;
  run(ctx, 120, () => {
    if (windAt < 0 && e.state === 'slamWindup') windAt = ctx.time.now;
    if (airAt < 0 && e.state === 'slamAir') airAt = ctx.time.now;
    if (e.state === 'slamAir') maxY = Math.max(maxY, e.position.y);
    return events.hits.length > 0 || (airAt > 0 && e.state === 'recover');
  });
  assert.ok(windAt > 0 && airAt > 0, 'slam never started');
  assert.ok(Math.abs(airAt - windAt - 0.45) < 0.03, `slam wind-up ${(airAt - windAt).toFixed(3)} s`);
  assert.ok(maxY > 0.5, `slam is a real jump (apex ${maxY.toFixed(2)} m)`);
  assert.equal(events.warnings.length, 1, 'landing warning');
  assert.equal(events.hits.length, 1);
  assert.ok(Math.abs(events.hits[0].amount - XINGXING_DEF.damage) < 1e-6);
  assert.ok(statsMods.some(m => m.key === 'moveSpeed' && m.value < 0), 'ice ring chills the player');
  assert.equal(e.state, 'recover');
  run(ctx, 100);
  assert.equal(statsMods.length, 0, 'chill wears off');
  attackDirector.reset();
});

test('雪狌狌 climbs onto a raised deck within 3.5 m instead of waiting below', () => {
  // 2.4 米高的平台（无台阶），玩家站在上面
  const { ctx } = context(arena([[-4, 0, 3, 4, 2.4, 8, 'platform']]));
  ctx.player.position.set(0, 2.4, 6);
  const e = spawn(ctx, Xingxing, 0, -1);
  ready(ctx, e);
  e.cooldown = 99;
  const seen = new Set();
  const trace = [];
  run(ctx, 360, () => {
    seen.add(e.state);
    if (ctx.time.frame % 6 === 0) trace.push(`${e.state}:${e.position.z.toFixed(2)},${e.position.y.toFixed(2)}`);
    return e.position.y > 2.3 && e.onGround && e.state === 'chase';
  });
  if (process.env.FROST_TRACE) console.log(trace.join(' '));
  assert.ok(seen.has('climbPrep') && seen.has('climb'), `states ${[...seen]}`);
  assert.ok(e.position.y > 2.3, `ended at y=${e.position.y.toFixed(2)}`);
  assert.ok(e.position.z > 3, 'stands on the deck');
  attackDirector.reset();
});

test('雪狌狌 throws an ice chunk with a landing warning when the player is out of climbing reach', () => {
  // 5 米高的塔（超过 3.5 米爬不上去）
  const { ctx, events } = context(arena([[-2, 0, 6, 2, 5, 10, 'platform']]));
  ctx.player.position.set(0, 5, 8);
  const e = spawn(ctx, Xingxing, 0, -2);
  ready(ctx, e);
  let windAt = -1;
  run(ctx, 360, () => {
    if (windAt < 0 && e.state === 'throwWindup') windAt = ctx.time.now;
    return events.hits.length > 0;
  });
  assert.ok(windAt > 0, 'never wound up a throw');
  assert.equal(events.warnings.length, 1, 'chunk landing warning');
  assert.ok(Math.abs(events.warnings[0].c.y - 5) < 0.05, 'warning sits on the tower top');
  assert.equal(events.hits.length, 1, 'chunk hits the standing player');
  const full = XINGXING_DEF.damage * 0.75;
  assert.ok(events.hits[0].amount <= full + 1e-6 && events.hits[0].amount >= full * 0.6, `chunk damage ${events.hits[0].amount}`);
  attackDirector.reset();
});

test('雪狌狌 rally: killing one makes nearby packmates beat their chests for a second', () => {
  const { ctx } = context();
  ctx.player.position.set(0, 0, 15);
  const a = spawn(ctx, Xingxing, 0, 0);
  const b = spawn(ctx, Xingxing, 3, 0);
  const far = spawn(ctx, Xingxing, -20, -10);
  run(ctx, 45);
  a.hp = 0;
  a.onKilled({ request: { base: 99, element: 'none', source: 'bullet' }, dealt: 99, isCrit: false, killed: true, layer: 'health', shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null });
  assert.equal(b.state, 'rally');
  assert.notEqual(far.state, 'rally');
  run(ctx, 70);
  assert.notEqual(b.state, 'rally');
  attackDirector.reset();
});

/** 按 creature_rigs/<asset>.json 搭出与发布资产同名、同位置的骨架，当作原生骨架身体（模型空间 = Blender (x, z, -y)） */
async function fakeNative(asset) {
  const rig = JSON.parse(await readFile(new URL(`../art/pipeline/creature_rigs/${asset}.json`, import.meta.url), 'utf8'));
  return (o) => {
    const model = new THREE.Group();
    const bones = {};
    const toModel = h => new THREE.Vector3(h[0], h[2], -h[1]);
    for (const [name, b] of Object.entries(rig.bones)) {
      const bone = new THREE.Bone();
      bone.name = name;
      bones[name] = bone;
    }
    for (const [name, b] of Object.entries(rig.bones)) {
      const bone = bones[name];
      const head = toModel(b.head);
      if (b.parent) {
        bones[b.parent].add(bone);
        bone.position.copy(head.sub(toModel(rig.bones[b.parent].head)));
      } else {
        model.add(bone);
        bone.position.copy(head);
      }
    }
    o.host.add(model);
    model.updateWorldMatrix(true, true);
    const pose = new NativePose(model, o.host);
    return { pose, lod: new THREE.Group(), glowShell: null, materials: [], dispose() {} };
  };
}

test('native skeleton poses stay finite and keep feet on the ground through every state (both rigs)', async () => {
  for (const [Type, asset, states] of [
    [Jiaoren, 'SK_Enemy_Jiaoren', ['advance', 'aim', 'throw', 'lungeWindup', 'lunge', 'jabWindup', 'recover']],
    [Xingxing, 'SK_Enemy_SnowXingxing', ['chase', 'slamWindup', 'recover', 'throwWindup', 'climbPrep', 'rally', 'swipeWindup']],
  ]) {
    globalThis.__frostArt = await fakeNative(asset);
    const { ctx } = context();
    ctx.player.position.set(0, 0, 6);
    const e = spawn(ctx, Type, 0, 0);
    globalThis.__frostArt = null;
    assert.ok(e.nativeBody, `${asset}: native body attached`);
    run(ctx, 45);
    const P = e.nativeBody.pose;
    for (const st of states) {
      e.state = st;
      e.stateTime = 0.2;
      for (let i = 0; i < 40; i++) {
        e.velocity.set(0, 0, st === 'chase' || st === 'advance' ? 6 : 0);
        e.pose(DT);
      }
      for (const name of ['hips', 'head', 'hand_L', 'hand_R', 'foot_L', 'foot_R', 'tail_3']) {
        const p = P.hostPosition(name, new THREE.Vector3());
        assert.ok(Number.isFinite(p.x + p.y + p.z), `${asset} ${st}: ${name} not finite`);
      }
      if (st !== 'chase' && st !== 'advance') {
        for (const s of ['L', 'R']) {
          const foot = P.hostPosition(`foot_${s}`, new THREE.Vector3());
          const rest = P.restPosition(`foot_${s}`);
          assert.ok(Math.abs(foot.y - rest.y) < 0.05, `${asset} ${st}: foot_${s} lifted ${foot.y - rest.y}`);
        }
      }
    }
    // 姿势方向的抽查：鲛人举矛时右手高过肩；狌狌四足狂奔时双手撑地、跳砸蓄力时双拳举过头
    const hand = s => P.hostPosition(`hand_${s}`, new THREE.Vector3());
    const settle = (st, time, speed = 0) => {
      e.state = st;
      e.stateTime = time;
      for (let i = 0; i < 60; i++) {
        e.velocity.set(0, 0, speed);
        e.pose(DT);
      }
    };
    if (Type === Jiaoren) {
      settle('aim', e.windTime);
      assert.ok(hand('R').y > 0.75, `aim: right hand at ${hand('R').y.toFixed(2)}`);
    } else {
      settle('chase', 0, 6);
      for (const s of ['L', 'R']) assert.ok(hand(s).y < 0.3, `knuckle run: hand_${s} at ${hand(s).y.toFixed(2)}`);
      settle('slamWindup', e.windTime);
      for (const s of ['L', 'R']) assert.ok(hand(s).y > 0.95, `slam wind-up: hand_${s} at ${hand(s).y.toFixed(2)}`);
    }
    // 投掷物挂在美术手骨上
    if (Type === Jiaoren) assert.equal(e.spear.parent?.name, 'hand_R');
    else assert.equal(e.chunk.parent?.name, 'hand_R');
    e.dispose();
  }
  attackDirector.reset();
});
