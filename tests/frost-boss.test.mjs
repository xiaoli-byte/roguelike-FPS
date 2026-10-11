// 鲲鹏（boss_kunpeng）无头回归：在真实的北冥冰台（frost-5 V2 白盒）导航网格上找冰窟，构造首领，逐招推进一阶段的鲲，
// 强制越过 50% 血线，验证冰雾里换成鹏（模型、受击形状、血条名称、飞行高度）以及鹏的第一招。
// 渲染与美术资产不参与：EnemyArt 换成空实现（等同 ?classic 的程序化兜底模型）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return data(source + '\n//# sourceURL=' + new URL(path, import.meta.url).href);
}

const typesUrl = await ts('../src/core/types.ts');
const mathUrl = await ts('../src/core/math.ts');
const { Rng } = await import(await ts('../src/core/Rng.ts'));
const { TaskRunner } = await import(await ts('../src/core/Tasks.ts'));
const plansUrl = await ts('../src/world/WhiteboxPlans.ts');
const { WHITEBOX_REDESIGN_PLANS } = await import(plansUrl);
const { generateWhitebox, whiteboxPoint } = await import(await ts('../src/world/WhiteboxGen.ts', { './WhiteboxPlans': plansUrl }));
const { CollisionWorld } = await import(await ts('../src/world/Collision.ts'));
const { NavGrid } = await import(await ts('../src/world/NavGrid.ts', { '../core/math': mathUrl }));

const partsUrl = await ts('../src/enemies/bosses/parts.ts');
const visualsUrl = await ts('../src/enemies/bosses/Visuals.ts');
const hazardsUrl = await ts('../src/enemies/bosses/Hazards.ts', { '../../core/math': mathUrl, './Visuals': visualsUrl, './parts': partsUrl });
const enemyBaseUrl = await ts('../src/enemies/EnemyBase.ts', { '../core/types': typesUrl, '../core/math': mathUrl });
const tokensUrl = await ts('../src/enemies/AttackTokens.ts');
const artStub = data('export function attachEnemyArt(){ return { body: null, native: null, parts: [] }; }');
const bossBaseUrl = await ts('../src/enemies/bosses/BossBase.ts', {
  '../EnemyBase': enemyBaseUrl, '../AttackTokens': tokensUrl, '../../core/math': mathUrl, './Hazards': hazardsUrl, '../../assets/EnemyArt': artStub,
});
const arenaUrl = await ts('../src/enemies/bosses/KunPengArena.ts');
const { locateIceHole } = await import(arenaUrl);
const fxUrl = await ts('../src/enemies/bosses/KunPengFx.ts');
const modelUrl = await ts('../src/enemies/bosses/KunPengModel.ts', { './parts': partsUrl });
const { KunPeng, KUNPENG_DEF, kunPengDebug } = await import(await ts('../src/enemies/bosses/KunPeng.ts', {
  '../../core/math': mathUrl, './BossBase': bossBaseUrl, '../../assets/EnemyArt': artStub, './KunPengArena': arenaUrl,
  './KunPengFx': fxUrl, './KunPengModel': modelUrl, './parts': partsUrl,
}));

const plan = WHITEBOX_REDESIGN_PLANS.find(p => p.id === 'frost-5-v2');
const DT = 1 / 30;

/** 北冥冰台的碰撞与导航（与 StageDirector 相同：白盒碰撞盒 → NavGrid.build） */
function frostArena(time = { now: 0, dt: DT, frame: 0 }) {
  const node = { chapter: 1, index: 4, type: 'boss', theme: 'frost', reward: 'coins' };
  const L = generateWhitebox(node, { redesign: true });
  const world = new CollisionWorld();
  for (const b of L.boxes) world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
  const v = p => new THREE.Vector3(p.x, L.floorY, p.z);
  const arena = { minX: L.minX, minZ: L.minZ, maxX: L.maxX, maxZ: L.maxZ, floorY: L.floorY, playerSpawn: v(L.playerSpawn), playerYaw: 0,
    spawnPoints: [], rewardPoint: v(L.rewardPoint), portalPoints: [], shopPoint: v(L.shopPoint), center: v(L.center), theme: { id: 'frost', name: '霜山' } };
  const nav = new NavGrid({ world, time });
  nav.build(arena);
  return { L, world, arena, nav, time };
}

function makeCtx() {
  const { world, arena, nav, time } = frostArena();
  const log = { damage: [], impulses: [], toasts: [], setBoss: [], warnings: 0 };
  const tasks = new TaskRunner();
  const player = {
    alive: true, position: new THREE.Vector3(), velocity: new THREE.Vector3(), radius: 0.4, height: 1.8, eye: new THREE.Vector3(),
    applyImpulse(v) { log.impulses.push(v.clone()); this.velocity.add(v); },
  };
  const ctx = {
    time, rng: new Rng(20261011), tasks, world, nav,
    stage: { arena, stage: { theme: 'frost' } },
    scene: new THREE.Scene(), stageGroup: new THREE.Group(), renderer: null, settings: { quality: 'high' },
    player,
    combat: { damagePlayer(amount) { log.damage.push(amount); return amount; } },
    projectiles: { spawn() {} },
    fx: { burst() {}, ring() {}, shake() {}, explosion() {}, spawnEffect() {}, deathEffect() {},
      groundWarning: () => { log.warnings++; return () => {}; } },
    audio: { play() {} },
    ui: { toast(text) { log.toasts.push(text); }, setBoss(e) { log.setBoss.push(e); }, banner() {} },
    enemies: { spawn() { return null; }, list: [] },
    events: { on() {}, emit() {} },
  };
  return { ctx, log, arena };
}

function step(ctx, boss, seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    ctx.time.now += DT;
    ctx.time.dt = DT;
    boss.update(DT);
    ctx.tasks.update(DT);
  }
}

function spawnBoss() {
  const env = makeCtx();
  const boss = new KunPeng(env.ctx, { position: (() => { const p = whiteboxPoint(plan, plan.encounters.find(e => e.id === 'BOSS').at); return new THREE.Vector3(p.x, 0, p.z); })(), level: 1.8 });
  boss.init();
  return { ...env, boss };
}

/** 玩家站在冰窟圆心 angle 方向、离圆心 r 米的环台上 */
function placePlayer(env, angle, r) {
  const h = kunPengDebug(env.boss).hole;
  env.ctx.player.position.set(h.center.x + Math.sin(angle) * r, h.center.y, h.center.z + Math.cos(angle) * r);
  env.ctx.player.eye.copy(env.ctx.player.position).setY(env.ctx.player.position.y + 1.6);
  env.ctx.player.velocity.set(0, 0, 0);
}

/** 强制下一招并推进到它结束（或 maxT 秒） */
function runMove(env, id, maxT = 8) {
  env.boss.queueMove(id);
  env.boss.restLeft = 0;
  let seen = false;
  for (let t = 0; t < maxT; t += DT) {
    step(env.ctx, env.boss, DT);
    if (env.boss.current?.id === id) seen = true;
    else if (seen) return true;
  }
  return seen;
}

test('the ice hole of 北冥冰台 is found from the frost-5 V2 nav grid, not from hard-coded coordinates', () => {
  const { arena, nav } = frostArena();
  const hole = locateIceHole(nav, arena);
  const expect = whiteboxPoint(plan, [80, 56]);
  assert.equal(hole.found, true);
  assert.ok(Math.hypot(hole.center.x - expect.x, hole.center.z - expect.z) < 1.2, `centre ${hole.center.x.toFixed(2)}, ${hole.center.z.toFixed(2)}`);
  assert.ok(hole.radius > 13.5 && hole.radius < 16.5, `radius ${hole.radius}`);
  assert.ok(hole.outer > 39 && hole.outer < 46, `outer ${hole.outer}`);
  // 没有导航网格 / 竞技场时退回虚拟冰窟
  const fb = locateIceHole(null, arena);
  assert.equal(fb.found, false);
  assert.ok(fb.radius > 0);
});

test('Kun rises from the ice hole on the spawn side and its weak spot is the forehead pearl', () => {
  const env = spawnBoss();
  const { boss, ctx } = env;
  const { hole, form } = kunPengDebug(boss);
  assert.equal(form, 'kun');
  assert.equal(boss.def.id, 'boss_kunpeng');
  assert.equal(KUNPENG_DEF.isBoss, true);
  assert.match(boss.displayName, /鲲鹏/);
  // 刷新点在冰窟北侧（−Z）：鲲就在冰窟北半边、圆心以内探头
  const d = Math.hypot(boss.position.x - hole.center.x, boss.position.z - hole.center.z);
  assert.ok(d < hole.radius, 'Kun stays inside the hole');
  assert.ok(boss.position.z < hole.center.z, 'first emergence on the spawn (north) side');
  assert.equal(boss.untargetable, true, 'untargetable while rising');
  placePlayer(env, Math.PI, hole.radius + 10);
  const before = boss.position.clone();
  step(ctx, boss, 3.3);
  assert.equal(boss.untargetable, false, 'targetable after the entrance');
  assert.ok(boss.position.distanceTo(before) < 0.5, 'zero-velocity Kun is not pushed by the hole collision block');
  // 从玩家位置瞄准额珠：命中弱点（爆头）
  boss.root.updateMatrixWorld(true);
  const pearl = boss.getHeadCenter(new THREE.Vector3());
  const eye = ctx.player.eye.clone();
  const dir = pearl.clone().sub(eye).normalize();
  const hit = { distance: 0, headshot: false };
  assert.equal(boss.raycastHit(eye, dir, 100, hit), true);
  assert.equal(hit.headshot, true, 'the pearl is the weak spot');
  assert.ok(pearl.y > 4, `pearl high on the head (${pearl.y.toFixed(2)})`);
});

test('phase 1 attacks: inhale pulls toward the hole, slam throws an ice wave, dive resurfaces at the player, spit lobs ice', () => {
  const env = spawnBoss();
  const { boss, ctx, log } = env;
  const { hole } = kunPengDebug(boss);
  placePlayer(env, Math.PI, hole.radius + 9);
  step(ctx, boss, 3.3);

  // 吞吸：扇形内的玩家被一阵阵拉向冰窟（冲量指向圆心一侧）
  log.impulses.length = 0;
  assert.ok(runMove(env, 'inhale'), 'inhale ran');
  assert.ok(log.impulses.length >= 10, `pull pulses ${log.impulses.length}`);
  const toward = log.impulses.filter(v => v.z > 0).length;
  assert.ok(toward / log.impulses.length > 0.9, 'pulled toward the hole (+Z from the north side)');

  // 猛砸：落点重击 + 冰浪（玩家站在落点上）
  boss.queueMove('slam');
  boss.restLeft = 0;
  step(ctx, boss, DT * 2);
  assert.equal(boss.current?.id, 'slam');
  const impact = boss.impact.clone();
  ctx.player.position.set(impact.x, impact.y, impact.z);
  const hits = log.damage.length;
  step(ctx, boss, 1.3);
  assert.ok(log.damage.length > hits, 'slam blast hits a player standing on the impact point');
  assert.ok(boss.hazards.waves.length > 0, 'slam throws an ice wave across the ring');
  step(ctx, boss, 2);

  // 潜袭：沉下去（不可选中），从玩家那一侧破冰而出
  placePlayer(env, Math.PI / 2, hole.radius + 12);
  boss.queueMove('dive');
  boss.restLeft = 0;
  step(ctx, boss, 1.0);
  assert.equal(boss.current?.id, 'dive');
  assert.equal(boss.untargetable, true, 'submerged Kun is untargetable');
  step(ctx, boss, 2.3);
  assert.equal(boss.untargetable, false);
  const ang = Math.atan2(boss.position.x - hole.center.x, boss.position.z - hole.center.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(ang - Math.PI / 2), Math.cos(ang - Math.PI / 2))) < 0.5, `resurfaced on the player side (${ang.toFixed(2)})`);

  // 吐冰：远处的玩家收到带落点预警的抛物线冰弹
  placePlayer(env, Math.PI / 2, hole.radius + 20);
  const warns = log.warnings;
  assert.ok(runMove(env, 'spit'), 'spit ran');
  assert.ok(log.warnings >= warns + 3, 'three ice lobs with ground warnings');
});

test('crossing 50% swaps Kun for Peng inside the ice-fog flash; Peng flies above the ring and opens with a gust', () => {
  const env = spawnBoss();
  const { boss, ctx, log } = env;
  const { hole } = kunPengDebug(boss);
  placePlayer(env, Math.PI, hole.radius + 12);
  step(ctx, boss, 3.3);
  boss.shield = 0;
  boss.hp = boss.maxHp * 0.48;
  step(ctx, boss, 0.3);
  assert.equal(boss.phase, 1);
  assert.equal(boss.untargetable, true, 'untargetable during the transition');
  assert.equal(kunPengDebug(boss).form, 'kun', 'Kun still visible while it sinks');
  step(ctx, boss, 1.5);
  assert.equal(kunPengDebug(boss).form, 'peng', 'model swapped inside the fog');
  const pengHost = boss.model.getObjectByName('peng_host');
  const kunHost = boss.model.getObjectByName('kun_host');
  assert.equal(pengHost.visible, true);
  assert.equal(kunHost.visible, false);
  let underPeng = false;
  pengHost.traverse(o => { if (o === boss.weakAnchor) underPeng = true; });
  assert.ok(underPeng, 'weak spot (pearl) now on Peng');
  assert.equal(boss.displayName, '鲲鹏 · 鹏');
  assert.ok(log.setBoss.includes(boss), 'boss bar renamed');
  step(ctx, boss, 3.2);
  assert.equal(boss.untargetable, false, 'transition finished');
  assert.ok(boss.position.y > hole.center.y + 10, `Peng above the ice-hole block (${boss.position.y.toFixed(1)})`);
  // 第一招：扇翼狂风，把环台上的玩家往外推
  log.impulses.length = 0;
  for (let t = 0; t < 8 && !log.impulses.length; t += DT) step(ctx, boss, DT);
  step(ctx, boss, 1);
  assert.ok(log.impulses.length > 0, 'gust pushes the player');
  const p = ctx.player.position;
  const out = new THREE.Vector3(p.x - hole.center.x, 0, p.z - hole.center.z).normalize();
  assert.ok(log.impulses.every(v => v.x * out.x + v.z * out.z > 0), 'gust pushes outward, toward the ring edge');
});

test('phase 2 moves run headlessly: swoop, feather rain, perch rest window', () => {
  const env = spawnBoss();
  const { boss, ctx, log } = env;
  const { hole } = kunPengDebug(boss);
  placePlayer(env, 0.4, hole.radius + 12);
  step(ctx, boss, 3.3);
  boss.shield = 0;
  boss.hp = boss.maxHp * 0.45;
  step(ctx, boss, 5);
  assert.equal(kunPengDebug(boss).form, 'peng');
  step(ctx, boss, 7);
  assert.ok(runMove(env, 'swoop', 10), 'swoop ran');
  const warns = log.warnings;
  assert.ok(runMove(env, 'rain', 6), 'feather rain ran');
  assert.ok(log.warnings >= warns + 10, 'every feather blade has a landing warning');
  boss.movesSincePerch = 2;
  boss.queueMove('perch');
  boss.restLeft = 0;
  let landed = false;
  for (let t = 0; t < 18 && !landed; t += DT) {
    step(ctx, boss, DT);
    if (boss.current?.id === 'perch' && boss.perchStage === 'rest' && boss.stageT > 0.6 && boss.position.y - hole.center.y < 3) landed = true;
  }
  assert.ok(landed, 'Peng lands on the ring (or an altar on it) to rest: main damage window');
  const d = Math.hypot(boss.perchAt.x - hole.center.x, boss.perchAt.z - hole.center.z);
  assert.ok(d > hole.radius && d < hole.outer, 'landing point is on the ring');
  assert.ok(Math.abs(boss.position.y - boss.perchAt.y) < 0.35, `landing impact is resolved at the height Peng actually stands on (${boss.position.y.toFixed(2)} vs ${boss.perchAt.y.toFixed(2)})`);
  // 死亡：逻辑位置钉住，3.2 秒后移除
  boss.onKilled({ request: { base: 0, element: 'none', source: 'weapon', canCrit: false, procDepth: 0, tags: [] }, dealt: 1, isCrit: false, killed: true,
    layer: 'health', shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null });
  step(ctx, boss, 3.4);
  assert.equal(boss.removed, true);
  boss.dispose();
});

test('Peng picks flat ring spots to perch (not the 2.5 m altars); forced onto an altar, the landing impact uses the altar top', () => {
  const env = spawnBoss();
  const { boss, ctx, arena } = env;
  const { hole } = kunPengDebug(boss);
  const floor = arena.floorY;
  for (let i = 0; i < 16; i++) {
    placePlayer(env, (i / 16) * Math.PI * 2, hole.radius + 12);
    boss.pickPerchSpot();
    const top = ctx.world.groundHeight(boss.perchAt.x, boss.perchAt.z, floor + 8, boss.radius * 0.85);
    assert.ok(boss.perchAt.y - floor < 0.3 && top - floor < 0.3, `perch spot ${i} is flat ground (spot y ${boss.perchAt.y.toFixed(2)}, ground ${top.toFixed(2)})`);
  }
  // 硬把落点放到东侧祭台中央：落地后站在台顶，落地冲击也按台顶结算
  placePlayer(env, 0.4, hole.radius + 12);
  step(ctx, boss, 3.3);
  boss.shield = 0;
  boss.hp = boss.maxHp * 0.45;
  step(ctx, boss, 12);
  assert.equal(kunPengDebug(boss).form, 'peng');
  boss.movesSincePerch = 2;
  boss.queueMove('perch');
  boss.restLeft = 0;
  let forced = false, rest = false;
  for (let t = 0; t < 20 && !rest; t += DT) {
    step(ctx, boss, DT);
    if (boss.current?.id === 'perch' && !forced) {
      forced = true;
      boss.perchAt.set(hole.center.x + 36, floor, hole.center.z);
    }
    if (boss.current?.id === 'perch' && boss.perchStage === 'rest') rest = true;
  }
  assert.ok(rest, 'Peng reached the rest stage');
  assert.ok(boss.position.y - floor > 2.2, `stands on the altar top (${(boss.position.y - floor).toFixed(2)} m)`);
  assert.ok(Math.abs(boss.perchAt.y - boss.position.y) < 0.35, `impact height = altar top (${(boss.perchAt.y - floor).toFixed(2)} m)`);
  boss.dispose();
});

test('Kun keeps its flat cut under the water through slam, dive bite and the slam wind-up', () => {
  const env = spawnBoss();
  const { boss, ctx } = env;
  const { hole } = kunPengDebug(boss);
  placePlayer(env, Math.PI, hole.radius + 9);
  step(ctx, boss, 3.3);
  const host = boss.kun.host;
  const water = hole.center.y + 0.06;
  // 切口（模型原点所在的水平面）的外缘：往后 3、往前 2.8、两侧 2.8（模型单位）
  const rim = [[0, -3], [0, 2.8], [2.8, 0], [-2.8, 0], [2, -2], [-2, -2], [2, 2], [-2, 2]];
  let worst = -Infinity, pearlLow = Infinity;
  const anims = new Set();
  for (const id of ['slam', 'dive', 'slam']) {
    boss.queueMove(id);
    boss.restLeft = 0;
    for (let t = 0; t < 7; t += DT) {
      step(ctx, boss, DT);
      boss.root.updateMatrixWorld(true);
      anims.add(boss.anim);
      for (const [x, z] of rim) worst = Math.max(worst, host.localToWorld(new THREE.Vector3(x, 0, z)).y - water);
      if (boss.anim === 'slam') pearlLow = Math.min(pearlLow, boss.kun.pts.pearl.getWorldPosition(new THREE.Vector3()).y - hole.center.y);
    }
  }
  for (const a of ['slamWind', 'slam']) assert.ok(anims.has(a), `exercised ${a}: ${[...anims]}`);
  assert.ok(worst < -0.2, `flat cut stays under the water surface (highest rim ${worst.toFixed(2)} m)`);
  // 猛砸时头趴在环台上：额珠离地近，但不埋进地面
  assert.ok(pearlLow > 0.5 && pearlLow < 4, `pearl rests low over the ring during the slam (${pearlLow.toFixed(2)} m)`);
  boss.dispose();
});

