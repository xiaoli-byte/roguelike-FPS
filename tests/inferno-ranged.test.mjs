import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

// 可复现：特效里的随机散布（火舌位置、链环散落）也走种子
{
  let seed = 0x5eed1234 >>> 0;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// 第三章远程组（毕方、马面狱卒）：用生产的 EnemyBase / StandardEnemy / 碰撞世界 / 导航网格 / 任务调度无头运行，
// 只把美术接入（attachEnemyArt → 无资产，走白模）和 fx / 音效 / 伤害结算换成记录调用的桩。
const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function tsModule(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return dataModule(stripTypeScriptTypes(source, { mode: 'transform' }));
}
const mathUrl = await tsModule('../src/core/math.ts');
const typesUrl = await tsModule('../src/core/types.ts');
const modelsUrl = await tsModule('../src/enemies/Models.ts', { '../core/math': mathUrl });
const hazardsUrl = await tsModule('../src/enemies/Hazards.ts', { '../core/math': mathUrl });
const affixesUrl = await tsModule('../src/enemies/Affixes.ts', { './Models': modelsUrl, './Hazards': hazardsUrl });
const levelsUrl = await tsModule('../src/enemies/Levels.ts');
const tokensUrl = await tsModule('../src/enemies/AttackTokens.ts');
const enemyBaseUrl = await tsModule('../src/enemies/EnemyBase.ts', { '../core/types': typesUrl, '../core/math': mathUrl });
const artUrl = dataModule('export function attachEnemyArt() { return { body: null, native: null, parts: [] }; }');
const standardUrl = await tsModule('../src/enemies/StandardEnemy.ts', {
  '../core/math': mathUrl, './EnemyBase': enemyBaseUrl, './AttackTokens': tokensUrl, './Affixes': affixesUrl,
  './Levels': levelsUrl, './Models': modelsUrl, '../assets/EnemyArt': artUrl,
});
const visualsUrl = await tsModule('../src/enemies/bosses/Visuals.ts');
const feedUrl = await tsModule('../src/enemies/inferno/FireFeed.ts');
const flameUrl = await tsModule('../src/enemies/fx/FlameFx.ts', { '../bosses/Visuals': visualsUrl });
const frostRangedUrl = await tsModule('../src/enemies/fx/FrostRangedFx.ts', { '../../core/math': mathUrl, '../bosses/Visuals': visualsUrl });
const skirmishUrl = await tsModule('../src/enemies/fx/FrostSkirmishFx.ts', { '../../core/math': mathUrl, '../bosses/Visuals': visualsUrl });
const packMotionUrl = await tsModule('../src/enemies/frost/PackMotion.ts', { '../../core/math': mathUrl });
const fxUrl = await tsModule('../src/enemies/fx/InfernoRangedFx.ts', {
  '../../core/math': mathUrl, '../bosses/Visuals': visualsUrl, './FlameFx': flameUrl, './FrostRangedFx': frostRangedUrl, '../inferno/FireFeed': feedUrl,
});
const enemyImports = {
  '../../core/math': mathUrl, '../StandardEnemy': standardUrl, '../Models': modelsUrl, '../fx/FrostSkirmishFx': skirmishUrl,
  '../fx/FrostRangedFx': frostRangedUrl, '../frost/PackMotion': packMotionUrl, '../fx/InfernoRangedFx': fxUrl,
};
const { Bifang, BIFANG_DEF } = await import(await tsModule('../src/enemies/types/Bifang.ts', enemyImports));
const { Mamian, MAMIAN_DEF } = await import(await tsModule('../src/enemies/types/Mamian.ts', enemyImports));
const fx = await import(fxUrl);
const feed = await import(feedUrl);
const { attackDirector } = await import(tokensUrl);
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { NavGrid } = await import(await tsModule('../src/world/NavGrid.ts', { '../core/math': mathUrl }));
const { TaskRunner } = await import(await tsModule('../src/core/Tasks.ts'));

const DT = 1 / 60;

function lcg(seed) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** boxes: 额外的碰撞盒 [minX, minY, minZ, maxX, maxY, maxZ, tag]（在建导航网格之前放进世界） */
function makeCtx(playerAt = new THREE.Vector3(0, 0, 0), boxes = []) {
  attackDirector.reset();
  const events = { hits: [], impulses: [], warnings: [], audio: [] };
  const world = new CollisionWorld();
  world.addBox(-40, -0.5, -40, 40, 0, 40, 'floor');
  for (const b of boxes) world.addBox(...b);
  const scene = new THREE.Scene();
  const stageGroup = new THREE.Group();
  scene.add(stageGroup);
  const player = {
    position: playerAt.clone(), velocity: new THREE.Vector3(), eye: new THREE.Vector3(), radius: 0.35, height: 1.8,
    alive: true, onGround: true, isDashing: false, isLunging: false, invulnerableTime: 0, aim: new THREE.Vector3(0, 0, -1),
    applyImpulse(v) { events.impulses.push(v.clone()); this.velocity.add(v); },
    getAimDirection(out) { return out.copy(this.aim); },
  };
  const ctx = {
    rng: { range: (a, b) => (a + b) / 2, sign: () => 1, next: lcg(7) }, player, world, scene, stageGroup, tasks: new TaskRunner(),
    time: { now: 0, dt: DT, frame: 0, timeScale: 1 },
    stage: { arena: { minX: -40, minZ: -40, maxX: 40, maxZ: 40, floorY: 0, center: new THREE.Vector3() }, stage: { theme: 'inferno' } },
    run: { chapter: 3 }, settings: { quality: 'high' }, renderer: null,
    audio: { play: id => events.audio.push(id) },
    combat: { damagePlayer: (damage, element, source) => { events.hits.push({ damage, element, time: ctx.time.now, source }); return damage; } },
    enemies: { list: [], queryRadius: () => [], spawn: () => null, raycast: () => null },
    fx: {
      burst() {}, ring() {}, shake() {}, explosion() {}, spawnEffect() {}, deathEffect() {},
      groundWarning: (c, r, d, color) => { events.warnings.push({ c: c.clone(), r, d, color, time: ctx.time.now }); return () => {}; },
    },
  };
  ctx.nav = new NavGrid(ctx);
  ctx.nav.build(ctx.stage.arena, 0.5);
  return { ctx, events };
}

function spawn(Type, ctx, at = new THREE.Vector3()) {
  const e = new Type(ctx, { position: at });
  e.init();
  ctx.enemies.list.push(e);
  return e;
}

/** 推进一帧：玩家按速度移动（带地面摩擦）→ 敌人 update → 任务调度 */
function frame(ctx, enemies, playerPhysics = true) {
  ctx.time.now += DT;
  ctx.time.frame++;
  const p = ctx.player;
  if (playerPhysics) {
    p.position.x += p.velocity.x * DT;
    p.position.z += p.velocity.z * DT;
    const f = Math.exp(-8 * DT);
    p.velocity.x *= f;
    p.velocity.z *= f;
    p.velocity.y = 0;
  }
  p.eye.set(p.position.x, p.position.y + 1.6, p.position.z);
  for (const e of enemies) e.update(DT);
  ctx.tasks.update(DT);
}
function run(ctx, enemies, seconds, until = null, playerPhysics = true) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    frame(ctx, enemies, playerPhysics);
    if (until && until()) return true;
  }
  return false;
}

/** 模拟一次命中：扣血 + onDamaged（Combat 的最小子集） */
function hitEnemy(e, dmg, point, headshot = false) {
  e.hp -= dmg;
  e.onDamaged({ request: { base: dmg, element: 'none', source: 'weapon', point: point.clone(), headshot }, dealt: dmg, isCrit: headshot, killed: false });
}

// 柱子：顶面 5 米，2×2 米，在玩家 -Z 方向约 20 米
const PILLAR = [-1, 0, -21, 1, 5, -19, 'pillar'];

// ───────────── 毕方 ─────────────

test('bifang never hovers: spawned on the ground it glides onto a 5 m pillar top and stands pinned there', () => {
  const { ctx } = makeCtx(new THREE.Vector3(0, 0, 0), [PILLAR]);
  const e = spawn(Bifang, ctx, new THREE.Vector3(6, 0, -10));
  e.cooldown = 99;
  let peak = 0, glided = false;
  assert.ok(run(ctx, [e], 4, () => {
    if (e.state === 'glide') glided = true;
    peak = Math.max(peak, e.position.y);
    return e.state === 'perch' && glided;
  }), 'takes off, glides and lands');
  assert.equal(e.perchHigh, true, 'lands on a high perch');
  assert.ok(Math.abs(e.position.y - 5) < 0.02, `stands on the pillar top (y ${e.position.y.toFixed(3)})`);
  assert.ok(e.position.x > -1 && e.position.x < 1 && e.position.z > -21 && e.position.z < -19, 'on the top face');
  assert.ok(peak > 5.2 && peak < 9, `short glide arc (apex ${peak.toFixed(2)} m)`);
  // 站着时：高度钉死在柱顶，被推一下也不会飘起来 / 掉下去
  e.knockback(new THREE.Vector3(6, 3, 0));
  let minY = Infinity, maxY = -Infinity;
  run(ctx, [e], 2, () => { minY = Math.min(minY, e.position.y); maxY = Math.max(maxY, e.position.y); return false; });
  assert.ok(maxY - minY < 0.12, `pinned to the perch (y range ${minY.toFixed(3)}..${maxY.toFixed(3)})`);
  assert.ok(Math.abs(e.position.x - e.perch.x) < 0.01, 'held on the perch point');
});

test('bifang "bi" cry draws a tracking aim line, locks for the last 30%, then "fang" spears the player and ignites them', () => {
  const { ctx, events } = makeCtx(new THREE.Vector3(0, 0, 0), [PILLAR]);
  const e = spawn(Bifang, ctx, new THREE.Vector3(6, 0, -10));
  e.cooldown = 99;
  run(ctx, [e], 4, () => e.state === 'perch' && e.perchHigh);
  e.cooldown = 0;
  assert.ok(run(ctx, [e], 1, () => e.state === 'cryBi'), 'starts the cry once perched and in view');
  const start = ctx.time.now;
  assert.ok(e.aimLine, 'aim line appears with the first cry');
  assert.ok(events.audio.includes('telegraph'), 'first cry is audible');
  ctx.player.position.x = 1.5;
  run(ctx, [e], 0.4);
  assert.ok(e.aimDir.x > 0.02, `aim follows the strafing player while tracking (${e.aimDir.x.toFixed(3)})`);
  run(ctx, [e], 0.25);
  const locked = e.aimDir.clone();
  ctx.player.position.x = 1.0;
  run(ctx, [e], 0.08);
  assert.ok(e.aimDir.distanceTo(locked) < 1e-9, 'aim locked in the last 30% of the cry');
  assert.equal(events.hits.length, 0);
  assert.ok(run(ctx, [e], 0.3, () => e.state === 'cryFang'));
  assert.ok(Math.abs(ctx.time.now - start - 0.8) < 3 * DT, `spear released at the end of the 0.8 s cry (${(ctx.time.now - start).toFixed(3)})`);
  assert.equal(e.aimLine, null, 'aim line withdrawn on release');
  // 玩家站在锁定线上：火矛（42 米/秒）约 0.5 秒飞到
  ctx.player.position.x = 1.5;
  run(ctx, [e], 0.8);
  const spear = events.hits.filter(h => h.damage === BIFANG_DEF.damage);
  assert.equal(spear.length, 1, 'spear hits the player on the locked line once');
  assert.equal(spear[0].element, 'fire');
  assert.equal(fx.playerIgnited(ctx), true, 'player is set on fire');
  run(ctx, [e], 2.2);
  const burns = events.hits.filter(h => h.damage === 3);
  assert.equal(burns.length, 4, `ignite ticks every 0.5 s for 2 s (${burns.length})`);
  assert.equal(fx.playerIgnited(ctx), false);
});

test('bifang spear misses a player who sidesteps after the lock and leaves a 3 s ember fire that 祸斗 can eat', () => {
  const { ctx, events } = makeCtx(new THREE.Vector3(0, 0, 0), [PILLAR]);
  const e = spawn(Bifang, ctx, new THREE.Vector3(6, 0, -10));
  e.cooldown = 99;
  run(ctx, [e], 4, () => e.state === 'perch' && e.perchHigh);
  e.cooldown = 0;
  run(ctx, [e], 1, () => e.state === 'cryBi');
  run(ctx, [e], 0.65);
  ctx.player.position.x = 3; // 锁定后横移
  run(ctx, [e], 1.0);
  assert.equal(events.hits.length, 0, 'sidestep dodges the straight spear');
  const fires = feed.listFires(ctx);
  assert.equal(fires.length, 1, 'missed spear leaves one floor fire, registered for 祸斗');
  const fire = fires[0];
  assert.ok(Math.abs(fire.position.y) < 0.05, 'fire sits on the floor');
  assert.ok(fire.position.z > 0 && fire.position.z < 12, `fire lands behind where the player stood (${fire.position.z.toFixed(2)})`);
  // 站进火里：每 0.5 秒烫一下
  ctx.player.position.copy(fire.position);
  run(ctx, [e], 1.05, null, false);
  assert.ok(events.hits.filter(h => h.damage === 4).length >= 2, 'standing in the ember fire burns');
  // 祸斗吃掉它：火立刻熄灭、不再烫
  fire.consume();
  const before = events.hits.length;
  run(ctx, [e], 1.0, null, false);
  assert.equal(events.hits.length, before, 'eaten fire stops burning');
  assert.equal(feed.listFires(ctx).length, 0);
  // 3 秒后自己也会烧完
  const f2 = fx.spawnEmberFire(ctx, new THREE.Vector3(5, 0, 5), null, 0.9, 3, 4);
  assert.ok(f2 && feed.listFires(ctx).length === 1);
  run(ctx, [e], 3.4, null, false);
  assert.equal(feed.listFires(ctx).length, 0, 'ember fire burns out after 3 s');
  assert.equal(f2.out, true);
});

test('bifang leg is the damage window: 25% leg damage knocks it off the pillar, it flounders 2.5 s on the ground, then flies back up', () => {
  const { ctx } = makeCtx(new THREE.Vector3(0, 0, 0), [PILLAR]);
  const e = spawn(Bifang, ctx, new THREE.Vector3(6, 0, -10));
  e.cooldown = 99;
  run(ctx, [e], 4, () => e.state === 'perch' && e.perchHigh);
  // 射线：瞄腿命中腿（非爆头）、瞄炭火是爆头
  const out = { distance: 0, headshot: false };
  const leg = e.legHits[2].anchor.getWorldPosition(new THREE.Vector3());
  const eye = ctx.player.eye;
  assert.ok(e.raycastHit(eye, leg.clone().sub(eye).normalize(), 60, out) && !out.headshot, 'leg sphere is hittable');
  const ember = e.getHeadCenter(new THREE.Vector3());
  assert.ok(e.raycastHit(eye, ember.clone().sub(eye).normalize(), 60, out) && out.headshot, 'ember in the beak is the weak spot');
  // 身体中枪不算腿
  const body = e.getBodyCenter(new THREE.Vector3());
  hitEnemy(e, 10, body);
  assert.equal(e.legDamage, 0);
  const per = e.maxHp * 0.25 / 3 + 0.01;
  for (let i = 0; i < 3; i++) {
    hitEnemy(e, per, e.legHits[2].anchor.getWorldPosition(new THREE.Vector3()));
    run(ctx, [e], 0.05);
  }
  assert.ok(run(ctx, [e], 0.3, () => e.state === 'fall' || e.state === 'downed'), 'leg gives way');
  assert.equal(e.state, 'fall');
  assert.ok(run(ctx, [e], 1.2, () => e.state === 'downed'), 'lands on the ground');
  assert.ok(Math.abs(e.position.y) < 0.05, `down on the floor (y ${e.position.y.toFixed(3)})`);
  assert.ok(e.position.z > -19, 'fell off the pillar on the player side, not on its top');
  const downAt = ctx.time.now;
  assert.ok(run(ctx, [e], 3.5, () => e.state !== 'downed'));
  assert.ok(Math.abs(ctx.time.now - downAt - 2.5) < 3 * DT, `downed for 2.5 s (${(ctx.time.now - downAt).toFixed(2)})`);
  assert.ok(run(ctx, [e], 4, () => e.state === 'perch' && e.perchHigh), 'flies back up to a perch');
  assert.ok(Math.abs(e.position.y - 5) < 0.02);
});

test('bifang relocates when the player climbs to its height or after losing 30% hp, and cannot fire for 2 s after moving', () => {
  const second = [12, 0, -21, 14, 5.5, -19, 'pillar'];
  const ledge = [-3, 0, -14, 3, 4.6, -10, 'platform'];
  const { ctx } = makeCtx(new THREE.Vector3(0, 0, 0), [PILLAR, second, ledge]);
  const e = spawn(Bifang, ctx, new THREE.Vector3(6, 0, -6));
  e.cooldown = 99;
  run(ctx, [e], 4, () => e.state === 'perch' && e.perchHigh);
  const first = e.perch.clone();
  // 玩家爬上和它差不多高、9 米内的地方（站在高台上）
  ctx.player.position.set(first.x - 2, first.y - 0.5, first.z + 7);
  e.cooldown = 0;
  assert.ok(run(ctx, [e], 3, () => e.state === 'takeoff'), 'player at its height makes it move');
  assert.ok(e.cooldown >= 1.9, 'no firing for 2 s after starting to move');
  run(ctx, [e], 4, () => e.state === 'perch');
  assert.ok(e.perch.distanceTo(first) > 3, 'moved to another perch');
  // 被打掉 30% 血
  ctx.player.position.set(0, 0, 0);
  run(ctx, [e], 0.2);
  const at = e.perch.clone();
  e.cooldown = 99;
  hitEnemy(e, e.maxHp * 0.31, e.getBodyCenter(new THREE.Vector3()));
  assert.ok(run(ctx, [e], 1, () => e.state === 'takeoff'), 'losing 30% hp triggers a move');
  run(ctx, [e], 4, () => e.state === 'perch');
  assert.ok(e.perch.distanceTo(at) > 1, 'lands somewhere else');
});

test('bifang on open ground (no high points) stays on the ground at range instead of hovering', () => {
  const { ctx, events } = makeCtx(new THREE.Vector3(0, 0, 0));
  const e = spawn(Bifang, ctx, new THREE.Vector3(0, 0, -18));
  e.cooldown = 0;
  let maxIdleY = 0;
  run(ctx, [e], 6, () => {
    if (e.state === 'perch' || e.state === 'cryBi' || e.state === 'recover') maxIdleY = Math.max(maxIdleY, e.position.y);
    return false;
  });
  assert.ok(maxIdleY < 0.02, `stands on the floor when not gliding (max y ${maxIdleY.toFixed(3)})`);
  // 关卡把它瞬移到半空的回收点（飞行单位 floor + 2.5）：落回脚下的地面，不会被拉回旧落脚点、也不会悬在空中
  e.cooldown = 99;
  run(ctx, [e], 1, () => e.state === 'perch');
  e.position.set(8, 2.5, -8);
  run(ctx, [e], 0.1);
  assert.ok(e.state !== 'perch' || (Math.abs(e.position.y) < 0.02 && Math.hypot(e.position.x - 8, e.position.z + 8) < 0.5),
    `adopts the recovery point on the ground (${e.state} ${e.position.toArray().map(v => v.toFixed(2))})`);
  assert.equal(e.perchHigh, false);
  assert.ok(events.hits.length >= 1 || events.audio.filter(a => a === 'telegraph').length >= 1, 'still attacks from the ground');
});

// ───────────── 马面狱卒 ─────────────

function hookedMamian(playerZ = 12, boxes = []) {
  const made = makeCtx(new THREE.Vector3(0, 0, playerZ), boxes);
  const e = spawn(Mamian, made.ctx, new THREE.Vector3(0, 0, 0));
  e.cooldown = 99;
  run(made.ctx, [e], e.spawnDuration + DT);
  e.cooldown = 0;
  return { ...made, e };
}

test('mamian whirls the chain 0.9 s overhead, throws a visible hook and drags the player ~8 m to stop in front of it', () => {
  const { ctx, events, e } = hookedMamian();
  assert.ok(run(ctx, [e], 1, () => e.state === 'spin'), 'starts whirling the chain');
  const spinAt = ctx.time.now;
  run(ctx, [e], 0.3);
  assert.ok(e.chain.visible, 'procedural chain links appear out of the wrist shackle');
  const root = e.chainRoot(new THREE.Vector3());
  assert.ok(e.hookPos.y > root.y + 0.2, 'hook circles above the shackle');
  assert.ok(run(ctx, [e], 1, () => e.state === 'throw'));
  assert.ok(Math.abs(ctx.time.now - spinAt - 0.9) < 3 * DT, `0.9 s whirl before the throw (${(ctx.time.now - spinAt).toFixed(2)})`);
  assert.equal(events.hits.length, 0, 'no damage before the hook lands');
  assert.ok(run(ctx, [e], 1.2, () => e.state === 'drag'), 'hook reaches the player');
  assert.equal(events.hits.length, 1);
  assert.equal(events.hits[0].damage, MAMIAN_DEF.damage);
  const from = ctx.player.position.z;
  const dragAt = ctx.time.now;
  run(ctx, [e], 1.5, () => e.state !== 'drag');
  assert.equal(e.dragEnd, 'done');
  assert.ok(ctx.time.now - dragAt <= 1.25, 'drag lasts at most 1.2 s');
  const pulled = from - ctx.player.position.z;
  assert.ok(pulled > 6.5 && pulled < 8.6, `pulled about 8 m (${pulled.toFixed(2)})`);
  assert.ok(ctx.player.position.z > 2.2, `stops in front of it, not on top of it (${ctx.player.position.z.toFixed(2)})`);
  run(ctx, [e], 0.3);
  assert.ok(Math.abs(ctx.player.velocity.z) < 2, 'drag momentum is taken off when it lets go');
});

test('mamian hook misses a player who sidesteps after the throw, and the chain reels back', () => {
  const { ctx, events, e } = hookedMamian(14);
  run(ctx, [e], 2, () => e.state === 'throw');
  ctx.player.position.x = 2.5;
  assert.ok(run(ctx, [e], 1.5, () => e.state === 'reel'), 'hook flies past');
  assert.equal(events.hits.length, 0);
  assert.ok(run(ctx, [e], 1.5, () => e.state === 'move'));
  assert.equal(e.chain.visible, false, 'chain is wound back into the shackle');
  assert.ok(e.cooldown > 5, `hook goes on its ~8 s cooldown (${e.cooldown.toFixed(2)} s left after the miss)`);
});

test('mamian chain: shooting it mid-drag snaps it; dashing or jumping slips free', () => {
  {
    const { ctx, e } = hookedMamian();
    run(ctx, [e], 3, () => e.state === 'drag');
    run(ctx, [e], 0.2);
    const from = ctx.player.position.z;
    // 瞄着链子中段开枪
    const root = e.chainRoot(new THREE.Vector3());
    const mid = root.clone().lerp(e.hookPos, 0.5);
    ctx.player.aim.copy(mid).sub(ctx.player.eye).normalize();
    e.onPlayerFired();
    frame(ctx, [e]);
    assert.equal(e.dragEnd, 'cut', 'chain snapped by the shot');
    assert.equal(e.state, 'staggered');
    run(ctx, [e], 0.6);
    assert.ok(from - ctx.player.position.z < 3, 'pull stops when the chain breaks');
    assert.ok(e.cooldown > 6, 'needs a new cooldown to throw again');
  }
  {
    // 瞄着马面本身（链根 / 锁芯附近）开枪不算打链子
    const { ctx, e } = hookedMamian();
    run(ctx, [e], 3, () => e.state === 'drag');
    const lock = e.getHeadCenter(new THREE.Vector3());
    ctx.player.aim.copy(lock).sub(ctx.player.eye).normalize();
    e.onPlayerFired();
    assert.equal(e.chainCut, false, 'aiming at the wrist lock is not a chain hit');
  }
  for (const how of ['dash', 'jump']) {
    const { ctx, e } = hookedMamian();
    run(ctx, [e], 3, () => e.state === 'drag');
    if (how === 'dash') ctx.player.isDashing = true;
    else { ctx.player.onGround = false; ctx.player.velocity.y = 4; }
    frame(ctx, [e], false);
    assert.equal(e.dragEnd, 'escape', `${how} slips the hook`);
  }
});

test('mamian drag stops 1.2 m short of lava between the player and the jailer; no drag when lava is right in front', () => {
  // 熔岩带：z 在 [5, 7] 之间横贯全场（导航网格的熔岩查询打桩）
  const lavaZ = [5, 7];
  const crosses = (a, b) => {
    const lo = Math.min(a.z, b.z), hi = Math.max(a.z, b.z);
    return hi >= lavaZ[0] && lo <= lavaZ[1];
  };
  {
    const { ctx, e } = hookedMamian(13);
    ctx.nav.crossesLava = crosses;
    run(ctx, [e], 3, () => e.state === 'drag');
    let minZ = Infinity;
    run(ctx, [e], 1.6, () => { minZ = Math.min(minZ, ctx.player.position.z); return e.state !== 'drag'; });
    run(ctx, [e], 0.5, () => { minZ = Math.min(minZ, ctx.player.position.z); return false; });
    assert.ok(minZ > lavaZ[1] + 0.8, `player stops on the near bank, never in lava (closest z ${minZ.toFixed(2)})`);
    assert.ok(13 - minZ > 3, 'still dragged up to the bank');
  }
  {
    const { ctx, e } = hookedMamian(7.8);
    ctx.nav.crossesLava = crosses;
    run(ctx, [e], 3, () => e.dragEnd !== '');
    run(ctx, [e], 0.5);
    assert.ok(ctx.player.position.z > 7.6, `no drag when the bank is right ahead (z ${ctx.player.position.z.toFixed(2)})`);
  }
});

test('mamian sweeps the chain around itself when the player is within 4 m; jumping clears it', () => {
  for (const jumping of [false, true]) {
    const { ctx, events, e } = hookedMamian(3);
    e.cooldown = 99;
    assert.ok(run(ctx, [e], 1, () => e.state === 'sweepWind'), 'close player triggers the chain sweep');
    assert.equal(events.warnings.length, 1, 'ground warning ring');
    assert.equal(events.warnings[0].color, fx.INFERNO.warn, 'pale-gold telegraph readable on basalt and lava');
    if (jumping) ctx.player.position.y = 1.2;
    run(ctx, [e], 0.9, null, false);
    const sweep = events.hits.filter(h => Math.abs(h.damage - MAMIAN_DEF.damage * 1.6) < 1e-6);
    assert.equal(sweep.length, jumping ? 0 : 1, jumping ? 'jump clears the sweep' : 'sweep hits a grounded player');
  }
});

test('mamian: breaking the wrist lock (30% hp of headshots) drops the chain and turns it into a faster brawler', () => {
  const { ctx, events, e } = hookedMamian(9);
  e.cooldown = 99;
  const lock = e.getHeadCenter(new THREE.Vector3());
  const out = { distance: 0, headshot: false };
  assert.ok(e.raycastHit(ctx.player.eye, lock.clone().sub(ctx.player.eye).normalize(), 40, out) && out.headshot, 'wrist lock is the weak spot');
  for (let i = 0; i < 3; i++) hitEnemy(e, e.maxHp * 0.105, lock, true);
  assert.equal(e.disarmed, false, 'body of the lock damage not reached yet');
  frame(ctx, [e]);
  assert.equal(e.disarmed, true);
  assert.equal(e.state, 'staggered');
  // 弱点换成马头
  const head = e.getHeadCenter(new THREE.Vector3());
  assert.ok(head.y > lock.y + 0.4, 'weak spot moves up to the horse head');
  assert.ok(run(ctx, [e], 2, () => e.state === 'brawl'));
  ctx.player.position.set(0, 0, 9);
  const start = e.position.clone();
  assert.ok(run(ctx, [e], 4, () => e.state === 'punchWind'), 'closes in to punch');
  assert.ok(e.position.distanceTo(start) > 4, 'walks up to the player');
  run(ctx, [e], 1, null, false);
  assert.ok(events.hits.some(h => Math.abs(h.damage - MAMIAN_DEF.damage * 1.5) < 1e-6), 'heavy punch lands');
});

// ───────────── 原生骨架动画（美术身体）路径 ─────────────
const skeletonUtilsUrl = new URL('../node_modules/three/examples/jsm/utils/SkeletonUtils.js', import.meta.url).href;
const nativeRigUrl = await tsModule('../src/assets/NativeRig.ts', { 'three/addons/utils/SkeletonUtils.js': skeletonUtilsUrl });
async function nativeEnemy(path, rigPath) {
  const rig = JSON.parse(await readFile(new URL(rigPath, import.meta.url), 'utf8'));
  const art = dataModule(`
    import * as THREE from '${threeUrl}';
    import { NativePose } from '${nativeRigUrl}';
    const BONES = ${JSON.stringify(rig.bones)};
    export function attachEnemyArt(o) {
      const model = new THREE.Group();
      const bones = {};
      for (const [name, b] of Object.entries(BONES)) {
        const bone = new THREE.Bone();
        bone.name = name;
        bone.userData.h = new THREE.Vector3(b.head[0], b.head[2], -b.head[1]);
        bones[name] = bone;
      }
      for (const [name, b] of Object.entries(BONES)) {
        const parent = b.parent ? bones[b.parent] : null;
        (parent ?? model).add(bones[name]);
        bones[name].position.copy(bones[name].userData.h).sub(parent ? parent.userData.h : new THREE.Vector3());
      }
      o.host.add(model);
      o.host.updateWorldMatrix(true, true);
      const material = new THREE.MeshStandardMaterial();
      o.own(material);
      const nb = { lod: model, pose: new NativePose(model, o.host), glowShell: new THREE.MeshBasicMaterial(), materials: [material], dispose() {} };
      return { body: nb, native: nb, parts: [] };
    }`);
  const std = await tsModule('../src/enemies/StandardEnemy.ts', {
    '../core/math': mathUrl, './EnemyBase': enemyBaseUrl, './AttackTokens': tokensUrl, './Affixes': affixesUrl,
    './Levels': levelsUrl, './Models': modelsUrl, '../assets/EnemyArt': art,
  });
  return import(await tsModule(path, { ...enemyImports, '../StandardEnemy': std }));
}
const { Bifang: NativeBifang } = await nativeEnemy('../src/enemies/types/Bifang.ts', '../art/pipeline/creature_rigs/SK_Enemy_Bifang.json');
const { Mamian: NativeMamian } = await nativeEnemy('../src/enemies/types/Mamian.ts', '../art/pipeline/creature_rigs/SK_Enemy_Mamian.json');

function boneAt(e, name) {
  const p = e.nativeBody.pose.hostPosition(name, new THREE.Vector3());
  assert.ok(Number.isFinite(p.x + p.y + p.z), `${name} position is finite`);
  return p;
}

test('bifang native skeleton: foot stays planted while crouching to take off, neck folds into an S on the cry, leg trails in the glide', () => {
  const { ctx } = makeCtx(new THREE.Vector3(0, 0, 0), [PILLAR]);
  const e = spawn(NativeBifang, ctx, new THREE.Vector3(6, 0, -10));
  assert.ok(e.nativeBody, 'native body attached');
  e.cooldown = 99;
  const toesRest = e.nativeBody.pose.restPosition('toes').clone();
  const headRest = e.nativeBody.pose.restPosition('head').clone();
  let crouchDrift = 0, trailed = 0, sawCrouch = false;
  run(ctx, [e], 4, () => {
    for (const b of ['hips', 'neck_3', 'head', 'wing_3_L', 'wing_3_R', 'crest_2', 'tail_2', 'toes']) boneAt(e, b);
    if (e.state === 'takeoff' && e.stateTime > 0.2) {
      sawCrouch = true;
      crouchDrift = Math.max(crouchDrift, boneAt(e, 'toes').distanceTo(toesRest));
    }
    if (e.state === 'glide' && e.stateTime > 0.4) trailed = Math.max(trailed, toesRest.z - boneAt(e, 'toes').z);
    return e.state === 'perch' && e.perchHigh;
  });
  assert.ok(sawCrouch);
  assert.ok(crouchDrift < 0.03, `foot pinned by IK during the crouch (${crouchDrift.toFixed(3)})`);
  assert.ok(trailed > 0.15, `leg trails behind in the glide (${trailed.toFixed(3)})`);
  e.cooldown = 0;
  run(ctx, [e], 1, () => e.state === 'cryBi');
  run(ctx, [e], 0.5);
  const head = boneAt(e, 'head');
  assert.ok(head.z < headRest.z - 0.03, `head pulled back into the S-curve (${(head.z - headRest.z).toFixed(3)})`);
});

test('mamian native skeleton: whirl lifts the shackled wrist overhead, fingers curl, feet stay planted while walking', () => {
  const { ctx } = makeCtx(new THREE.Vector3(0, 0, 30));
  const e = spawn(NativeMamian, ctx, new THREE.Vector3(0, 0, 0));
  assert.ok(e.nativeBody);
  e.cooldown = 99;
  const footRest = e.nativeBody.pose.restPosition('foot_L').y;
  let lowest = Infinity, lifted = 0, walked = 0;
  run(ctx, [e], 3, () => {
    walked = Math.max(walked, Math.hypot(e.velocity.x, e.velocity.z));
    const y = boneAt(e, 'foot_L').y - footRest;
    lowest = Math.min(lowest, y);
    lifted = Math.max(lifted, y);
    for (const b of ['mane_3', 'robe_F2', 'robe_B2', 'jaw', 'ear_L', 'index_2_L', 'thumb_2_R']) boneAt(e, b);
    return false;
  });
  assert.ok(walked > 2, `walks into its band (${walked.toFixed(2)} m/s)`);
  assert.ok(lowest > -0.02, `planted foot never sinks (${lowest.toFixed(3)})`);
  assert.ok(lifted > 0.04, `swing lifts the foot (${lifted.toFixed(3)})`);
  ctx.player.position.set(0, 0, e.position.z + 12);
  e.cooldown = 0;
  run(ctx, [e], 2, () => e.state === 'spin');
  run(ctx, [e], 0.6);
  const wrist = boneAt(e, 'hand_L').y;
  const head = boneAt(e, 'head').y;
  assert.ok(wrist > head, `shackled wrist raised above the head while whirling (${wrist.toFixed(2)} vs ${head.toFixed(2)})`);
  const tip = boneAt(e, 'index_2_R');
  assert.ok(tip.distanceTo(e.nativeBody.pose.restPosition('index_2_R')) > 0.01, 'fingers curl');
});

test('inferno ranged: both enemies register under the ranged group', async () => {
  const src = await readFile(new URL('../src/enemies/inferno/registerRanged.ts', import.meta.url), 'utf8');
  assert.match(src, /registerEnemy\(BIFANG_DEF/);
  assert.match(src, /registerEnemy\(MAMIAN_DEF/);
  assert.equal(BIFANG_DEF.id, 'bifang');
  assert.equal(MAMIAN_DEF.id, 'mamian');
});
