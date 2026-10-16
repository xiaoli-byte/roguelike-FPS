// 第三章群怪（炭童 tantong、祸斗 huodou）的无头回归：真实的 EnemyBase / StandardEnemy / 碰撞 / 导航 / 任务调度 / FireFeed，
// 只把渲染相关（美术资产挂载、粒子、音效）换成记录调用的桩。每个用例逐帧推进状态机，走完一招主要攻击或一段交互
// （余烬复燃、吹火、祸斗食火 / 吐火 / 包抄）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

// EnemyBase staggers line-of-sight / repath timers with Math.random (and the FX jitter uses it too); seed it so every run
// steps the same frames.
let seed = 0x1f3a7c5;
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
const { TaskRunner } = await import(await ts('../src/core/Tasks.ts'));
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
// 美术挂载桩：测试可通过 globalThis.__infernoArt 注入一个按 creature_rigs 骨架搭出来的原生骨架身体
const artUrl = dataModule(`export function attachEnemyArt(o) {
  const n = globalThis.__infernoArt ? globalThis.__infernoArt(o) : null;
  return { body: n, native: n, parts: [] };
}`);
const affixUrl = dataModule(`export const AFFIX_NAMES = {}; export function isAffixId() { return false; } export function createAffix() { return null; }`);
const standardUrl = await ts('../src/enemies/StandardEnemy.ts', {
  '../core/math': mathUrl, './EnemyBase': enemyBaseUrl, './AttackTokens': tokensUrl, './Affixes': affixUrl,
  './Levels': levelsUrl, './Models': modelsUrl, '../assets/EnemyArt': artUrl,
});
const visualsUrl = await ts('../src/enemies/bosses/Visuals.ts');
const flameUrl = await ts('../src/enemies/fx/FlameFx.ts', { '../bosses/Visuals': visualsUrl });
const feedUrl = await ts('../src/enemies/inferno/FireFeed.ts');
const feed = await import(feedUrl);
const fxUrl = await ts('../src/enemies/fx/InfernoPackFx.ts', {
  '../../core/math': mathUrl, '../Hazards': hazardsUrl, '../Models': modelsUrl, '../bosses/Visuals': visualsUrl,
  './FlameFx': flameUrl, '../inferno/FireFeed': feedUrl,
});
const fx = await import(fxUrl);
const motionUrl = await ts('../src/enemies/frost/PackMotion.ts', { '../../core/math': mathUrl });
const shared = {
  '../../core/math': mathUrl, '../StandardEnemy': standardUrl, '../AttackTokens': tokensUrl, '../Models': modelsUrl,
  '../fx/FlameFx': flameUrl, '../fx/InfernoPackFx': fxUrl, '../inferno/FireFeed': feedUrl, '../frost/PackMotion': motionUrl,
};
const { Tantong, TantongEmber, TantongReborn, TANTONG_DEF, TANTONG_EMBER_DEF, TANTONG_REBORN_DEF, REKINDLE_TIME } =
  await import(await ts('../src/enemies/types/Tantong.ts', shared));
const { Huodou, HUODOU_DEF, MAX_MEALS } = await import(await ts('../src/enemies/types/Huodou.ts', shared));

const DT = 1 / 60;
const TYPES = { tantong: Tantong, tantong_ember: TantongEmber, tantong_reborn: TantongReborn, huodou: Huodou };

function arena(extraBoxes = []) {
  const world = new CollisionWorld();
  world.addBox(-30, -0.2, -30, 30, 0, 30, 'floor');
  for (const b of extraBoxes) world.addBox(...b);
  return world;
}

/** 最小 GameContext：真实碰撞 / 导航 / 任务；特效、音效只记录；战斗结算敌人伤害（够了就死）、记录玩家受伤 */
function context({ world = arena(), lava = null } = {}) {
  const events = { hits: [], warnings: [], kills: [], vanished: 0, audio: [] };
  const player = {
    position: new THREE.Vector3(0, 0, 10), velocity: new THREE.Vector3(), eye: new THREE.Vector3(),
    radius: 0.3, height: 1.8, alive: true, invulnerableTime: 0, yaw: 0,
    maxHp: () => 100, applyImpulse() {},
  };
  const ctx = {
    rng: { range: (a, b) => (a + b) / 2, sign: () => 1, chance: () => false, int: (a) => a, next: () => 0.5 },
    time: { now: 0, dt: DT, frame: 0, timeScale: 1 },
    player, world, tasks: new TaskRunner(),
    scene: new THREE.Group(), stageGroup: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    settings: { quality: 'high' }, renderer: null, run: { chapter: 2, difficulty: 1 },
    stage: {
      arena: { minX: -30, minZ: -30, maxX: 30, maxZ: 30, floorY: 0, center: new THREE.Vector3() }, stage: { theme: 'inferno' },
      lavaSystem: lava ? { lava } : null,
    },
    enemies: {
      list: [], queryRadius: () => [],
      spawn(id, opts) {
        const T = TYPES[id];
        if (!T) return null;
        const e = new T(ctx, { level: 1, ...opts, position: opts.position.clone() });
        e.init();
        e.onGround = true;
        ctx.enemies.list.push(e);
        return e;
      },
    },
    combat: {
      damagePlayer: (amount, element, source) => { events.hits.push({ amount, element, source, t: ctx.time.now }); return amount; },
      damageEnemy(e, req) {
        if (!e.alive) return null;
        e.hp -= req.base;
        const killed = e.hp <= 0;
        const result = { request: req, dealt: req.base, isCrit: false, killed, layer: 'health', shieldBroken: false, armorBroken: false, element: req.element, statusApplied: null };
        if (killed) {
          e.onKilled(result);
          e.alive = false;
          events.kills.push(e);
        }
        return result;
      },
      explode() {},
    },
    projectiles: { spawn() {} },
    loot: { dropHealth() {} },
    audio: { play: (id, o) => events.audio.push({ id, pitch: o?.pitch, t: ctx.time.now }) },
    fx: {
      burst() {}, shake() {}, explosion() {}, impact() {}, spawnEffect() {}, deathEffect() {}, ring() {},
      groundWarning: (c, r, d, color) => { const w = { c: c.clone(), r, d, color, cancelled: false }; events.warnings.push(w); return () => { w.cancelled = true; }; },
    },
  };
  ctx.nav = new NavGrid(ctx);
  if (lava) ctx.nav.setLava(lava);
  ctx.nav.build(ctx.stage.arena, 0.25);
  return { ctx, events };
}

function spawn(ctx, Type, x, z, opts = {}) {
  const e = new Type(ctx, { position: new THREE.Vector3(x, 0, z), level: 1, ...opts });
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
    for (const e of ctx.enemies.list.slice()) if (!e.removed) e.update(DT);
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

function kill(ctx, e) {
  return ctx.combat.damageEnemy(e, { base: 9999, element: 'none', source: 'weapon' });
}


test('pack defs match the roster doc and construct headlessly with their procedural fallback bodies', () => {
  assert.equal(TANTONG_DEF.id, 'tantong');
  assert.equal(HUODOU_DEF.id, 'huodou');
  assert.equal(TANTONG_EMBER_DEF.id, 'tantong_ember');
  assert.equal(TANTONG_REBORN_DEF.id, 'tantong_reborn');
  assert.deepEqual(TANTONG_REBORN_DEF.coins, [0, 0], 'reborn tantong drops nothing');
  assert.deepEqual(TANTONG_EMBER_DEF.coins, [0, 0], 'ember pile drops nothing');
  assert.ok(TANTONG_DEF.hp === 30 && TANTONG_DEF.speed === 6.5 && Math.abs(TANTONG_DEF.scale - 1.3) < 0.01, 'roster doc: tantong hp 30, speed 6.5, 1.0 m art ×1.3');
  assert.ok(HUODOU_DEF.hp === 70 && HUODOU_DEF.speed === 8 && Math.abs(HUODOU_DEF.scale - 1.2) < 0.01, 'roster doc: huodou hp 70, speed 8, ×1.2');
  for (const Type of [Tantong, Huodou, TantongEmber]) {
    const { ctx } = context();
    const e = spawn(ctx, Type, 0, 0);
    run(ctx, 120);
    assert.ok(e.alive && Number.isFinite(e.position.x + e.position.y + e.position.z), `${Type.name} alive and finite`);
    e.dispose();
  }
  attackDirector.reset();
});

test('炭童 head flame is the weak spot: the head sphere sits on top of the head', () => {
  const { ctx } = context();
  const e = spawn(ctx, Tantong, 0, 0);
  run(ctx, 60);
  const head = e.getHeadCenter(new THREE.Vector3());
  assert.ok(head.y > 1.0 && head.y < 1.4, `head flame sphere at ${head.y.toFixed(2)}`);
  // 从正面平射头顶火苗 = 爆头，射肚子 = 身体
  const out = { distance: 0, headshot: false };
  assert.ok(e.raycastHit(new THREE.Vector3(0, head.y, 8), new THREE.Vector3(0, 0, -1), 50, out) && out.headshot);
  assert.ok(e.raycastHit(new THREE.Vector3(0, 0.5, 8), new THREE.Vector3(0, 0, -1), 50, out) && !out.headshot);
  attackDirector.reset();
});

test('炭童 pounce: 0.35 s crouch, a real hop, then two flailing claw hits', () => {
  const { ctx, events } = context();
  ctx.player.position.set(0, 0, 2.2);
  const e = spawn(ctx, Tantong, 0, 0);
  ready(ctx, e);
  let windAt = -1, hopAt = -1, maxY = 0;
  run(ctx, 120, () => {
    if (windAt < 0 && e.state === 'pounceWindup') windAt = ctx.time.now;
    if (hopAt < 0 && e.state === 'pounce') hopAt = ctx.time.now;
    if (e.state === 'pounce') maxY = Math.max(maxY, e.position.y);
    return e.state === 'recover';
  });
  assert.ok(windAt > 0 && hopAt > 0, 'pounce never started');
  assert.ok(Math.abs(hopAt - windAt - 0.35) < 0.03, `pounce wind-up ${(hopAt - windAt).toFixed(3)} s`);
  assert.ok(maxY > 0.1, `pounce is a hop (apex ${maxY.toFixed(2)} m)`);
  assert.equal(events.hits.length, 2, 'two flailing hits');
  for (const h of events.hits) assert.ok(Math.abs(h.amount - TANTONG_DEF.damage * 0.55) < 1e-6);
  attackDirector.reset();
});

test('炭童 throws a coal with a vermilion landing warning; it leaves a 2 s floor fire that burns and is registered for 祸斗', () => {
  const { ctx, events } = context();
  ctx.player.position.set(0, 0, 10);
  const e = spawn(ctx, Tantong, 0, 0);
  ready(ctx, e);
  let windAt = -1, throwAt = -1;
  run(ctx, 240, () => {
    if (windAt < 0 && e.state === 'throwWindup') windAt = ctx.time.now;
    if (throwAt < 0 && e.state === 'throwRelease') throwAt = ctx.time.now;
    return e.lastCoal?.done;
  });
  assert.ok(windAt > 0 && throwAt > 0, 'never threw');
  assert.ok(Math.abs(throwAt - windAt - 0.4) < 0.03, `throw wind-up ${(throwAt - windAt).toFixed(3)} s`);
  assert.equal(events.warnings.length, 1, 'landing warning');
  assert.equal(events.warnings[0].color, fx.INFERNO.warn, 'saturated vermilion warning (reads on dark basalt)');
  assert.ok(Math.abs(events.warnings[0].c.z - 10) < 1, 'warning at the player');
  assert.ok(events.hits.length >= 1 && events.hits[0].element === 'fire', 'coal hits the standing player with fire');
  const fire = e.lastCoal.fire;
  assert.ok(fire && fire.edible(), 'floor fire left behind');
  assert.ok(feed.listFires(ctx).includes(fire), 'floor fire registered in FireFeed');
  // 炭童去追 / 抛下一块之前，把它拉远，免得混进伤害统计
  e.cooldown = 99;
  const before = events.hits.length;
  run(ctx, 60);
  assert.ok(events.hits.length > before, 'standing in the floor fire burns');
  run(ctx, 120);
  assert.equal(fire.edible(), false, 'floor fire burns out after 2 s');
  attackDirector.reset();
});

test('炭童 death leaves an ember pile that re-ignites into a half-HP, loot-less tantong after 4 s; the reborn one dies for good', () => {
  const { ctx, events } = context();
  ctx.player.position.set(0, 0, 25);
  const e = spawn(ctx, Tantong, 0, 0);
  run(ctx, 45);
  kill(ctx, e);
  run(ctx, 10);
  const piles = ctx.enemies.list.filter(x => x instanceof TantongEmber && x.alive);
  assert.equal(piles.length, 1, 'ember pile spawned');
  const pile = piles[0];
  assert.ok(Math.hypot(pile.position.x, pile.position.z) < 0.3, 'pile lies where it died');
  assert.ok(feed.listFires(ctx).includes(pile), 'pile is edible fire for 祸斗');
  const killsBefore = events.kills.length;
  let rebornAt = -1;
  run(ctx, Math.round((REKINDLE_TIME + 0.5) * 60), () => {
    if (rebornAt < 0 && ctx.enemies.list.some(x => x instanceof TantongReborn)) rebornAt = ctx.time.now;
    return rebornAt > 0;
  });
  assert.ok(rebornAt > 0, 'pile never re-ignited');
  assert.equal(pile.alive, false, 'pile gone');
  assert.equal(events.kills.length, killsBefore, 're-ignition is not a player kill');
  const reborn = ctx.enemies.list.find(x => x instanceof TantongReborn);
  assert.equal(reborn.hp, Math.round(reborn.maxHp * 0.5), 'reborn at half HP');
  assert.equal(reborn.def.id, 'tantong_reborn');
  run(ctx, 45);
  kill(ctx, reborn);
  run(ctx, Math.round((REKINDLE_TIME + 1) * 60));
  assert.equal(ctx.enemies.list.filter(x => x instanceof TantongEmber && x.alive).length, 0, 'reborn tantong leaves no pile');
  assert.equal(ctx.enemies.list.filter(x => x instanceof Tantong && x.alive).length, 0);
  attackDirector.reset();
});

test('炭童 ember pile: one shot, area damage or stepping on it finishes it for good', () => {
  for (const how of ['shot', 'stomp']) {
    const { ctx, events } = context();
    ctx.player.position.set(0, 0, 25);
    const e = spawn(ctx, Tantong, 0, 0);
    run(ctx, 45);
    kill(ctx, e);
    run(ctx, 30);
    const pile = ctx.enemies.list.find(x => x instanceof TantongEmber && x.alive);
    assert.ok(pile, 'pile spawned');
    if (how === 'shot') {
      // 子弹打得到（不算爆头），一枪就散
      const out = { distance: 0, headshot: false };
      assert.ok(pile.raycastHit(new THREE.Vector3(0, 0.2, 5), new THREE.Vector3(0, 0, -1), 50, out), 'bullet hits the pile');
      assert.equal(out.headshot, false);
      ctx.combat.damageEnemy(pile, { base: 12, element: 'none', source: 'weapon' });
    } else {
      ctx.player.position.set(0.4, 0, 0.3);
      run(ctx, 5);
    }
    assert.equal(pile.alive, false, `${how}: pile finished`);
    assert.ok(events.kills.includes(pile), `${how}: counts as the player's kill`);
    ctx.player.position.set(0, 0, 25);
    run(ctx, Math.round((REKINDLE_TIME + 1) * 60));
    assert.equal(ctx.enemies.list.filter(x => x instanceof Tantong && x.alive).length, 0, `${how}: no re-ignition`);
    attackDirector.reset();
  }
});

test('炭童 packmate crouches by a pile within 3 m and blows on it for 1.2 s: the pile re-ignites early', () => {
  const { ctx } = context();
  ctx.player.position.set(0, 0, 25);
  const a = spawn(ctx, Tantong, 0, 0);
  const b = spawn(ctx, Tantong, 2.2, 0.5);
  run(ctx, 45);
  b.cooldown = 99;
  kill(ctx, a);
  let blowAt = -1, rebornAt = -1;
  const t0 = ctx.time.now;
  run(ctx, Math.round(REKINDLE_TIME * 60), () => {
    if (blowAt < 0 && b.state === 'blow') blowAt = ctx.time.now;
    if (ctx.enemies.list.some(x => x instanceof TantongReborn)) rebornAt = ctx.time.now;
    return rebornAt > 0;
  });
  assert.ok(blowAt > 0, `packmate never blew (state ${b.state})`);
  assert.ok(rebornAt > 0, 'pile never re-ignited');
  assert.ok(Math.abs(rebornAt - blowAt - 1.2) < 0.05, `blowing time ${(rebornAt - blowAt).toFixed(2)} s`);
  assert.ok(rebornAt - t0 < REKINDLE_TIME - 1, `re-ignited early (${(rebornAt - t0).toFixed(2)} s after death)`);
  attackDirector.reset();
});

test('炭童 that dies on lava leaves no pile', () => {
  const lava = { minX: -2, minZ: -2, cols: 4, rows: 4, cell: 1, mask: new Uint8Array(16).fill(1), rects: [{ minX: -2, minZ: -2, maxX: 2, maxZ: 2 }] };
  const { ctx } = context({ lava });
  ctx.player.position.set(0, 0, 25);
  const e = spawn(ctx, Tantong, 0, 0);
  run(ctx, 45);
  kill(ctx, e);
  run(ctx, 30);
  assert.equal(ctx.enemies.list.filter(x => x instanceof TantongEmber).length, 0);
  attackDirector.reset();
});

test('祸斗 bite: 0.3 s low crouch, a lunge, one bite', () => {
  const { ctx, events } = context();
  ctx.player.position.set(0, 0, 2.6);
  const e = spawn(ctx, Huodou, 0, 0);
  ready(ctx, e);
  let windAt = -1, lungeAt = -1;
  run(ctx, 120, () => {
    if (windAt < 0 && e.state === 'biteWindup') windAt = ctx.time.now;
    if (lungeAt < 0 && e.state === 'bite') lungeAt = ctx.time.now;
    return e.state === 'recover';
  });
  assert.ok(windAt > 0 && lungeAt > 0, 'bite never started');
  assert.ok(Math.abs(lungeAt - windAt - 0.3) < 0.03, `bite wind-up ${(lungeAt - windAt).toFixed(3)} s`);
  assert.equal(events.hits.length, 1);
  assert.ok(Math.abs(events.hits[0].amount - HUODOU_DEF.damage) < 1e-6);
  attackDirector.reset();
});

test('祸斗 flank bellies are the weak spot (side shots crit, the chest from the front does not), and they grow with meals', () => {
  const { ctx } = context();
  ctx.player.position.set(0, 0, 25);
  const e = spawn(ctx, Huodou, 0, 0);
  run(ctx, 60);
  // 眩晕定住（不跑不转），摆正在原点
  e.stunTime = 99;
  e.position.set(0, 0, 0);
  e.velocity.set(0, 0, 0);
  e.facing = 0;
  run(ctx, 2);
  const s = HUODOU_DEF.scale;
  const out = { distance: 0, headshot: false };
  const side = new THREE.Vector3(6, 0.56 * s, 0.1 * s), left = new THREE.Vector3(-1, 0, 0);
  assert.ok(e.raycastHit(side, left, 50, out), 'side shot hits');
  assert.equal(out.headshot, true, 'flank belly from the side = weak spot');
  assert.ok(e.raycastHit(new THREE.Vector3(0, 0.62 * s, 6), new THREE.Vector3(0, 0, -1), 50, out), 'front shot hits');
  assert.equal(out.headshot, false, 'chest from the front is not the weak spot');
  // 吃过火：火腹判定更大（贴着火腹球上沿外一点的射线，吃饱之后也算打中弱点）
  const flank = e.hits[0].anchor.getWorldPosition(new THREE.Vector3());
  const high = new THREE.Vector3(6, flank.y + e.hits[0].r * s * 1.15, flank.z);
  const before = e.raycastHit(high, left, 50, out) && out.headshot;
  e.meals = MAX_MEALS;
  run(ctx, 60);
  assert.ok(e.raycastHit(high, left, 50, out) && out.headshot, 'bigger weak spot after meals');
  assert.equal(before, false, 'just outside the hungry weak spot');
  attackDirector.reset();
});

test('祸斗 runs to a floor fire within 8 m, eats it for 1 s side-on to the player, and grows', () => {
  const { ctx } = context();
  ctx.player.position.set(0, 0, 14);
  const e = spawn(ctx, Huodou, 0, 0);
  run(ctx, 45);
  e.cooldown = 99;
  const fire = fx.spawnFloorFire(ctx, new THREE.Vector3(4, 0, 2), 1, 8, 1, null);
  let eatAt = -1, doneAt = -1, facingDot = 1;
  run(ctx, 360, () => {
    if (eatAt < 0 && e.state === 'eat') {
      eatAt = ctx.time.now;
      const fx_ = Math.sin(e.facing), fz = Math.cos(e.facing);
      const px = ctx.player.position.x - e.position.x, pz = ctx.player.position.z - e.position.z;
      facingDot = (fx_ * px + fz * pz) / Math.hypot(px, pz);
    }
    if (eatAt > 0 && e.meals === 1) doneAt = ctx.time.now;
    return doneAt > 0;
  });
  assert.ok(eatAt > 0, `never ate (state ${e.state})`);
  assert.ok(Math.abs(doneAt - eatAt - 1) < 0.05, `eating time ${(doneAt - eatAt).toFixed(2)} s`);
  assert.ok(Math.abs(facingDot) < 0.5, `flank toward the player while eating (facing·toPlayer = ${facingDot.toFixed(2)})`);
  assert.equal(fire.eaten, true, 'the floor fire is eaten');
  assert.equal(fire.edible(), false);
  run(ctx, 90);
  assert.ok(e.growth > 1.06, `bigger after a meal (×${e.growth.toFixed(3)})`);
  attackDirector.reset();
});

test('祸斗 eats a 炭童 ember pile: the tantong is gone for good (no re-ignition), and 炭童 stop blowing on a claimed pile', () => {
  const { ctx } = context();
  ctx.player.position.set(0, 0, 20);
  const t = spawn(ctx, Tantong, 3, 0);
  const h = spawn(ctx, Huodou, -2, -2);
  run(ctx, 45);
  h.cooldown = 99;
  kill(ctx, t);
  run(ctx, 300, () => h.state === 'seekFire' || h.state === 'eat');
  const pile = ctx.enemies.list.find(x => x instanceof TantongEmber && x.alive);
  assert.ok(pile && h.fireTarget === pile, 'hound went for the pile');
  assert.equal(pile.claimedBy, h.id, 'hound claims the pile');
  const mate = spawn(ctx, Tantong, 3.5, 1.5);
  assert.equal(pile.awaitingBlow(mate), false, 'a claimed pile is not blown on');
  mate.cooldown = 99;
  run(ctx, 300, () => h.meals === 1);
  assert.equal(h.meals, 1, `hound ate the pile (state ${h.state})`);
  assert.equal(ctx.enemies.list.filter(x => x instanceof TantongEmber && x.alive).length, 0, 'pile eaten');
  run(ctx, Math.round((REKINDLE_TIME + 1) * 60));
  assert.equal(ctx.enemies.list.filter(x => x instanceof TantongReborn).length, 0, 'no re-ignition after being eaten');
  attackDirector.reset();
});

test('祸斗 laps fire from a lava edge when no other fire is around', () => {
  // 一条熔岩带 x ∈ [4, 6]（导航把它当阻挡）
  const cols = 60, rows = 60, mask = new Uint8Array(cols * rows);
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) if (x >= 34 && x < 36) mask[z * cols + x] = 1;
  const lava = { minX: -30, minZ: -30, cols, rows, cell: 1, mask, rects: [{ minX: 4, minZ: -30, maxX: 6, maxZ: 30 }] };
  const { ctx } = context({ lava });
  ctx.player.position.set(-6, 0, 12);
  const e = spawn(ctx, Huodou, 0, 0);
  run(ctx, 45);
  e.cooldown = 99;
  run(ctx, 360, () => e.meals === 1);
  assert.equal(e.meals, 1, `never ate at the lava edge (state ${e.state})`);
  assert.ok(e.position.x < 4 && e.position.x > 1.5, `ate standing on the shore (x = ${e.position.x.toFixed(2)})`);
  attackDirector.reset();
});

test('祸斗 spits only after eating: 0.6 s cone telegraph, a fire cone that a sidestep dodges, then the belly is empty', () => {
  for (const dodge of [false, true]) {
    const { ctx, events } = context();
    ctx.player.position.set(0, 0, 6);
    const e = spawn(ctx, Huodou, 0, 0);
    run(ctx, 45);
    // 没吃过火不吐
    e.cooldown = 0;
    e.eatCooldown = 99;
    ctx.player.position.set(0, 0, 6);
    run(ctx, 20, () => e.state === 'spitWindup' || e.state === 'biteWindup');
    assert.notEqual(e.state, 'spitWindup', 'no spit on an empty belly');
    e.setState('run');
    attackDirector.reset();
    e.meals = 2;
    e.cooldown = 0;
    let windAt = -1, spitAt = -1;
    run(ctx, 120, () => {
      if (windAt < 0 && e.state === 'spitWindup') windAt = ctx.time.now;
      if (spitAt < 0 && e.state === 'spit') {
        spitAt = ctx.time.now;
        if (dodge) ctx.player.position.set(6, 0, 3);
      }
      return e.state === 'recover';
    });
    assert.ok(windAt > 0 && spitAt > 0, 'spit never started');
    assert.ok(Math.abs(spitAt - windAt - 0.6) < 0.03, `spit wind-up ${(spitAt - windAt).toFixed(3)} s`);
    const fire = events.hits.filter(h => h.element === 'fire');
    if (dodge) assert.equal(fire.length, 0, 'sidestepping out of the cone avoids the fire');
    else {
      assert.equal(fire.length, 4, 'four ticks over 0.8 s');
      for (const h of fire) assert.ok(Math.abs(h.amount - HUODOU_DEF.damage * 0.3) < 1e-6);
    }
    assert.equal(e.meals, 0, 'belly empty after spitting');
    assert.equal(e.cone, null, 'cone released');
    attackDirector.reset();
  }
});

test('祸斗 pack flanks: one holds in front and barks, the others circle to the sides and behind, growling back there', () => {
  const { ctx, events } = context();
  ctx.player.position.set(0, 0, 0);
  ctx.player.yaw = 0; // 看向 −Z
  const pack = [spawn(ctx, Huodou, -1, -12), spawn(ctx, Huodou, 1, -12), spawn(ctx, Huodou, 0, -13), spawn(ctx, Huodou, 2, -13)];
  run(ctx, 45);
  for (let i = 0; i < 6 * 60; i++) {
    for (const e of pack) e.cooldown = 99;
    run(ctx, 1);
  }
  const p = pack.map(e => e.position);
  const front = p.filter(q => q.z < -3);
  const behind = p.filter(q => q.z > 2);
  const sides = p.filter(q => Math.abs(q.x) > 2.5 && Math.abs(q.z) < 3.5);
  assert.ok(front.length >= 1, `someone holds in front ${p.map(q => q.toArray().map(v => v.toFixed(1))).join(' | ')}`);
  assert.ok(behind.length >= 1, `someone circled behind ${p.map(q => q.toArray().map(v => v.toFixed(1))).join(' | ')}`);
  assert.ok(sides.length >= 2, `two on the sides ${p.map(q => q.toArray().map(v => v.toFixed(1))).join(' | ')}`);
  assert.ok(pack.some(e => e.lastGrowl > 0), 'growled from behind');
  assert.ok(events.audio.some(a => a.id === 'enemy_alert' && a.pitch > 0.9), 'front one barks');
  attackDirector.reset();
});

/** 按 creature_rigs/<asset>.json 搭出与发布资产同名、同位置的骨架，当作原生骨架身体（模型空间 = Blender (x, z, -y)） */
async function fakeNative(asset) {
  const rig = JSON.parse(await readFile(new URL(`../art/pipeline/creature_rigs/${asset}.json`, import.meta.url), 'utf8'));
  return (o) => {
    const model = new THREE.Group();
    const bones = {};
    const toModel = h => new THREE.Vector3(h[0], h[2], -h[1]);
    for (const name of Object.keys(rig.bones)) {
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

test('native skeleton poses stay finite and keep planted feet on the ground (both rigs)', async () => {
  for (const [Type, asset, states, feet, moving] of [
    [Tantong, 'SK_Enemy_Tantong', ['chase', 'pounceWindup', 'flail', 'throwWindup', 'throwRelease', 'blow', 'recover'], ['foot_L', 'foot_R'], 'chase'],
    [Huodou, 'SK_Enemy_Huodou', ['run', 'biteWindup', 'eat', 'spitWindup', 'spit', 'recover'], ['paw_L', 'paw_R', 'foot_L', 'foot_R'], 'run'],
  ]) {
    globalThis.__infernoArt = await fakeNative(asset);
    const { ctx } = context();
    ctx.player.position.set(0, 0, 6);
    const e = spawn(ctx, Type, 0, 0);
    globalThis.__infernoArt = null;
    assert.ok(e.nativeBody, `${asset}: native body attached`);
    run(ctx, 45);
    const P = e.nativeBody.pose;
    const settle = (st, time, speed = 0, frames = 40) => {
      e.state = st;
      e.stateTime = time;
      for (let i = 0; i < frames; i++) {
        e.velocity.set(0, 0, speed);
        e.pose(DT);
      }
    };
    for (const st of states) {
      settle(st, 0.2, st === moving ? e.def.speed : 0);
      for (const name of ['hips', 'head', ...feet]) {
        const p = P.hostPosition(name, new THREE.Vector3());
        assert.ok(Number.isFinite(p.x + p.y + p.z), `${asset} ${st}: ${name} not finite`);
      }
      if (st !== moving) {
        for (const f of feet) {
          const y = P.hostPosition(f, new THREE.Vector3()).y, rest = P.restPosition(f).y;
          assert.ok(Math.abs(y - rest) < 0.05, `${asset} ${st}: ${f} lifted ${(y - rest).toFixed(3)}`);
        }
      }
    }
    if (Type === Tantong) {
      // 抛炭抡到最高时右手举过头顶；吹火时头低于站立
      settle('throwWindup', e.windTime * 0.99);
      const hand = P.hostPosition('hand_R', new THREE.Vector3());
      assert.ok(hand.y > P.restPosition('arm_R').y + 0.06, `throw: right hand above the shoulder (${hand.y.toFixed(2)})`);
      settle('chase', 0, 0);
      const stand = P.hostPosition('head', new THREE.Vector3()).y;
      settle('blow', 0.5);
      assert.ok(P.hostPosition('head', new THREE.Vector3()).y < stand - 0.05, 'blow: crouched head-down');
      assert.equal(e.coal.parent?.name, 'hand_R', 'coal rides the art hand bone');
    } else {
      // 吃火时低头到地；双悬空奔跑时腰椎屈伸（一个周期内胸的高度变化明显）
      settle('eat', 0.5);
      const mouthY = e.mouth(new THREE.Vector3()).y - e.position.y;
      assert.ok(mouthY < 0.5, `eat: muzzle down at the fire (${mouthY.toFixed(2)} m)`);
      const ys = [];
      e.state = 'run';
      for (let i = 0; i < 60; i++) {
        e.velocity.set(0, 0, e.def.speed);
        e.pose(DT);
        ys.push(P.hostPosition('chest', new THREE.Vector3()).y);
      }
      assert.ok(e.pGallop > 0.9, `gallop blend ${e.pGallop}`);
      assert.ok(Math.max(...ys) - Math.min(...ys) > 0.03, 'double-suspension gallop: the body rises and dips each stride');
    }
    e.dispose();
  }
  attackDirector.reset();
});
