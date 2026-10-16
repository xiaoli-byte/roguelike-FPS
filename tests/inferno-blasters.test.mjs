import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

// 第三章炮击 / 自爆组（炮仗傀儡 / 神火飞鸦）的无头回归：用生产代码的 EnemyBase、StandardEnemy、AttackTokens、Hazards、
// 碰撞世界、导航网格、任务调度、NativePose、火药特效（InfernoBlastFx）、连环爆（ExplosiveChain）与地火登记（FireFeed），
// 逐帧推进到每只怪的招式，检查结算。美术加载换成桩：原生骨架模式按 creature_rigs/<asset>.json 搭同名骨架交给真实 NativePose。
// 伤害管线换成一个最小实现（damageEnemy 扣血 → onDamaged / onKilled，explode 按半径对 enemies.list 结算），用来验证连锁。

// 固定随机数（特效与少量摆放用 Math.random），每次运行结果一致
let seed = 0x9e3779b9;
Math.random = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function tsModule(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return dataModule(stripTypeScriptTypes(source, { mode: 'transform' }));
}

const mathUrl = await tsModule('../src/core/math.ts');
const typesUrl = await tsModule('../src/core/types.ts');
const statsUrl = await tsModule('../src/core/Stats.ts');
const tasksUrl = await tsModule('../src/core/Tasks.ts');
const modelsUrl = await tsModule('../src/enemies/Models.ts', { '../core/math': mathUrl });
const tokensUrl = await tsModule('../src/enemies/AttackTokens.ts');
const hazardsUrl = await tsModule('../src/enemies/Hazards.ts', { '../core/math': mathUrl });
const affixesUrl = await tsModule('../src/enemies/Affixes.ts', { './Models': modelsUrl, './Hazards': hazardsUrl });
const levelsUrl = await tsModule('../src/enemies/Levels.ts');
const enemyBaseUrl = await tsModule('../src/enemies/EnemyBase.ts', { '../core/types': typesUrl, '../core/math': mathUrl });
const nativeRigUrl = await tsModule('../src/assets/NativeRig.ts', {
  'three/addons/utils/SkeletonUtils.js': dataModule('export function clone(o) { return o.clone(); }'),
});
const enemyArtUrl = dataModule(`
  export function attachEnemyArt(o) {
    const n = globalThis.__infernoArt ? globalThis.__infernoArt(o) : null;
    if (n) for (const m of n.materials) o.own(m);
    return { body: n, native: n, parts: [] };
  }
`);
const standardUrl = await tsModule('../src/enemies/StandardEnemy.ts', {
  '../core/math': mathUrl, './EnemyBase': enemyBaseUrl, './AttackTokens': tokensUrl, './Affixes': affixesUrl,
  './Levels': levelsUrl, './Models': modelsUrl, '../assets/EnemyArt': enemyArtUrl,
});
const visualsUrl = await tsModule('../src/enemies/bosses/Visuals.ts');
const flameUrl = await tsModule('../src/enemies/fx/FlameFx.ts', { '../bosses/Visuals': visualsUrl });
const frostFxUrl = await tsModule('../src/enemies/fx/FrostSkirmishFx.ts', { '../../core/math': mathUrl, '../bosses/Visuals': visualsUrl });
const fireFeedUrl = await tsModule('../src/enemies/inferno/FireFeed.ts');
const blastFxUrl = await tsModule('../src/enemies/fx/InfernoBlastFx.ts', {
  '../../core/math': mathUrl, '../bosses/Visuals': visualsUrl, '../Hazards': hazardsUrl, './FlameFx': flameUrl, '../inferno/FireFeed': fireFeedUrl,
});
const chainUrl = await tsModule('../src/enemies/inferno/ExplosiveChain.ts', { '../AttackTokens': tokensUrl });
const enemyImports = {
  '../../core/math': mathUrl, '../StandardEnemy': standardUrl, '../AttackTokens': tokensUrl, '../Hazards': hazardsUrl,
  '../Models': modelsUrl, '../fx/FrostSkirmishFx': frostFxUrl, '../fx/InfernoBlastFx': blastFxUrl, '../inferno/ExplosiveChain': chainUrl,
};
const { Firecracker, FIRECRACKER_DEF } = await import(await tsModule('../src/enemies/types/Firecracker.ts', enemyImports));
const { FireCrow, FIRE_CROW_DEF } = await import(await tsModule('../src/enemies/types/FireCrow.ts', enemyImports));
const { listFires } = await import(fireFeedUrl);
const { CHAIN } = await import(chainUrl);
const { attackDirector } = await import(tokensUrl);
const { Stats } = await import(statsUrl);
const { TaskRunner } = await import(tasksUrl);
const { NativePose } = await import(nativeRigUrl);
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { NavGrid } = await import(await tsModule('../src/world/NavGrid.ts', { '../core/math': mathUrl }));

const ASSET = { firecracker: 'SK_Enemy_Firecracker', fire_crow: 'SK_Enemy_FireCrow' };

/** 按 creature_rigs/<asset>.json 搭同名骨架（Blender 坐标 → 模型坐标：x, z, −y），交给真实 NativePose */
function fakeNative(asset, host) {
  const rig = JSON.parse(readFileSync(new URL(`../art/pipeline/creature_rigs/${asset}.json`, import.meta.url), 'utf8'));
  const three = ([x, y, z]) => new THREE.Vector3(x, z, -y);
  const model = new THREE.Group();
  const bones = {};
  for (const name of Object.keys(rig.bones)) { bones[name] = new THREE.Bone(); bones[name].name = name; }
  for (const [name, b] of Object.entries(rig.bones)) {
    const parent = b.parent ? bones[b.parent] : model;
    const origin = b.parent ? three(rig.bones[b.parent].head) : new THREE.Vector3();
    bones[name].position.copy(three(b.head).sub(origin));
    parent.add(bones[name]);
  }
  host.add(model);
  const lod = new THREE.LOD();
  model.add(lod);
  return { lod, pose: new NativePose(model, host), glowShell: null, materials: [new THREE.MeshStandardMaterial()], dispose() {} };
}

function world() {
  const events = { hits: [], explodes: [], warnings: 0, impulses: [], kills: [], damaged: [] };
  const tasks = new TaskRunner();
  const list = [];
  const ctx = {
    rng: { range: (a, b) => (a + b) / 2, sign: () => 1, int: (a) => a, chance: () => false, next: () => 0.5 },
    time: { now: 0, dt: 1 / 60, timeScale: 1, frame: 0 },
    settings: { quality: 'high', screenShake: 1 }, renderer: null, run: { chapter: 2, flags: {} },
    scene: new THREE.Scene(), stageGroup: new THREE.Group(), tasks,
    audio: { play() {} },
    enemies: { list, queryRadius: () => [] },
    projectiles: { spawn() {} },
    fx: {
      burst() {}, explosion() {}, ring() {}, shake() {}, spawnEffect() {}, deathEffect() {}, impact() {},
      groundWarning: () => { events.warnings++; return () => {}; },
    },
  };
  // 最小伤害管线：扣血 → onDamaged，血尽 → onKilled（算击杀）；explode 对半径内（含敌人半径）的敌人逐个结算
  ctx.combat = {
    damagePlayer: (amount, element, source) => { events.hits.push({ amount, element, source, t: ctx.time.now }); return amount; },
    damageEnemy: (e, req) => {
      if (!e.alive || e.hp <= 0) return null;
      e.hp -= req.base;
      const killed = e.hp <= 0;
      const result = { request: req, dealt: req.base, isCrit: !!req.headshot, killed, layer: 'health', shieldBroken: false, armorBroken: false, element: req.element, statusApplied: null };
      events.damaged.push({ e, req, t: ctx.time.now });
      e.onDamaged(result);
      if (killed && e.alive) { events.kills.push({ e, t: ctx.time.now }); e.onKilled(result); }
      return result;
    },
    explode: (center, radius, req, opts) => {
      events.explodes.push({ center: center.clone(), radius, req, opts, t: ctx.time.now });
      for (const e of [...list]) {
        if (!e.alive || opts?.exclude?.has(e)) continue;
        if (e.getBodyCenter(new THREE.Vector3()).distanceTo(center) > radius + e.radius) continue;
        ctx.combat.damageEnemy(e, req);
      }
    },
  };
  ctx.scene.add(ctx.stageGroup);
  ctx.world = new CollisionWorld();
  ctx.world.addBox(-40, -0.5, -40, 40, 0, 40, 'floor');
  ctx.stage = { arena: { minX: -38, minZ: -38, maxX: 38, maxZ: 38, floorY: 0, center: new THREE.Vector3() }, stage: { theme: 'inferno' } };
  ctx.nav = new NavGrid(ctx);
  ctx.nav.build(ctx.stage.arena, 0.5);
  const player = {
    position: new THREE.Vector3(), velocity: new THREE.Vector3(), eye: new THREE.Vector3(),
    radius: 0.35, height: 1.8, alive: true, invulnerableTime: 0, stats: null,
    applyImpulse: v => events.impulses.push(v.clone()),
  };
  player.stats = new Stats(ctx);
  ctx.player = player;
  attackDirector.reset();
  return { ctx, events };
}

function placePlayer(ctx, x, y, z) {
  ctx.player.position.set(x, y, z);
  ctx.player.eye.set(x, y + 1.6, z);
}

function spawn(Type, ctx, native, pos) {
  globalThis.__infernoArt = native ? o => fakeNative(ASSET[o.defId], o.host) : null;
  const e = new Type(ctx, { position: pos.clone() });
  e.init();
  globalThis.__infernoArt = null;
  ctx.enemies.list.push(e);
  return e;
}

/** 逐帧推进（全部敌人 + 任务），until 为真时提前返回 true */
function run(ctx, seconds, until) {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    ctx.time.now += dt;
    ctx.time.dt = dt;
    ctx.time.frame++;
    for (const e of ctx.enemies.list) if (!e.removed) e.update(dt);
    ctx.tasks.update(dt);
    if (until && until()) return true;
  }
  return false;
}

function assertFinite(e, label) {
  e.root.updateWorldMatrix(false, true);
  e.root.traverse(o => assert.ok(o.matrixWorld.elements.every(Number.isFinite), `${label}: non-finite transform on ${o.name || o.type}`));
}

/** 一个不会爆的普通敌人（连锁里吃伤害、记录击退） */
function dummy(ctx, pos) {
  const d = {
    alive: true, removed: false, hp: 1000, maxHp: 1000, shield: 0, armor: 0, radius: 0.4, height: 1.8, flying: false,
    position: pos.clone(), knocks: [], update() {}, onDamaged() {}, onKilled() { this.alive = false; },
    getBodyCenter(out) { return out.set(this.position.x, this.position.y + 0.9, this.position.z); },
  };
  ctx.enemies.list.push(d);
  return d;
}

for (const native of [false, true]) {
  const mode = native ? 'native skeleton' : 'procedural model';

  test(`炮仗傀儡 (${mode}): brace → 1.2s fuse → 8 rockets around the player, each with a warning circle, leaving edible floor fires`, () => {
    const { ctx, events } = world();
    placePlayer(ctx, 0, 0, 18);
    const e = spawn(Firecracker, ctx, native, new THREE.Vector3(0, 0, 0));
    const states = new Set();
    let fuseStart = -1, volleyAt = -1, lidOpen = 0;
    const fired = run(ctx, 8, () => {
      states.add(e.state);
      if (e.state === 'fuse' && fuseStart < 0) fuseStart = ctx.time.now;
      if (e.state === 'fuse') lidOpen = Math.max(lidOpen, -e.lidHinge.rotation.x);
      if (e.state === 'volley' && volleyAt < 0) volleyAt = ctx.time.now;
      return volleyAt > 0;
    });
    assert.ok(fired, `no volley; states ${[...states]}`);
    for (const s of ['march', 'brace', 'fuse', 'volley']) assert.ok(states.has(s), `missing state ${s}`);
    assert.ok(Math.abs(volleyAt - fuseStart - 1.2) < 0.05, `fuse burns 1.2s (${(volleyAt - fuseStart).toFixed(3)})`);
    assert.ok(lidOpen > 1.2, `rocket-box lid swings open during the fuse (${lidOpen.toFixed(2)} rad)`);
    assert.equal(events.warnings, 8, '8 warning circles');
    const targets = e.volleyTargets;
    assert.equal(targets.length, 8);
    for (const t of targets) assert.ok(Math.hypot(t.x - 0, t.z - 18) <= 6.3, 'targets within 6 m of the player');
    for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
      assert.ok(Math.hypot(targets[i].x - targets[j].x, targets[i].z - targets[j].z) >= 1.69, 'targets spread apart');
    }
    assert.ok(targets.some(t => Math.hypot(t.x, t.z - 18) < 0.3), 'one rocket lands on the player');
    run(ctx, 2.3);
    const rocketHits = events.hits.filter(h => h.element === 'fire' && h.amount > FIRECRACKER_DEF.damage * 0.4);
    assert.ok(rocketHits.length >= 1, 'a standing player is hit');
    assert.ok(rocketHits.every(h => h.amount <= FIRECRACKER_DEF.damage + 1e-6));
    assert.ok(listFires(ctx).length >= 4, `rocket impacts leave floor fires for 祸斗 (${listFires(ctx).length})`);
    run(ctx, 3);
    assert.equal(listFires(ctx).length, 0, 'floor fires burn out after 2.5 s');
    assert.equal(e.state, 'march');
    assertFinite(e, 'volley');
  });

  test(`炮仗傀儡 (${mode}): shooting the powder chamber while the fuse burns duds the volley: scattered rockets hurt enemies, puppet topples 2s`, () => {
    const { ctx, events } = world();
    placePlayer(ctx, 0, 0, 18);
    const e = spawn(Firecracker, ctx, native, new THREE.Vector3(0, 0, 0));
    assert.ok(run(ctx, 6, () => e.state === 'fuse' && e.stateTime > 0.3), 'never lit the fuse');
    const res = (point, headshot) => ({
      request: { base: 5, element: 'none', source: 'weapon', point, headshot }, dealt: 5, isCrit: headshot, killed: false,
      layer: 'health', shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null,
    });
    // 打头（投射物的爆头）不算
    e.onDamaged(res(e.getHeadCenter(new THREE.Vector3()), true));
    assert.equal(e.state, 'fuse', 'a head shot does not dud');
    e.onDamaged(res(e.bellyCenter(new THREE.Vector3()), true));
    assert.equal(e.state, 'toppled');
    assert.equal(events.warnings, 8, 'scattered rockets show warnings');
    const t0 = ctx.time.now;
    run(ctx, 1.4);
    assert.equal(events.explodes.length, 8, 'every scattered rocket blasts nearby enemies');
    for (const x of events.explodes) {
      assert.ok(x.req.knockback > 0 && x.req.base > 0);
      const d = Math.hypot(x.center.x - e.position.x, x.center.z - e.position.z);
      assert.ok(d >= 2.2 && d <= 7.4, `scatter lands 2.5–7 m from the puppet (${d.toFixed(2)})`);
    }
    assert.equal(events.hits.length, 0, 'the far player is safe');
    assert.ok(run(ctx, 2, () => e.state === 'getup'));
    assert.ok(Math.abs(ctx.time.now - t0 - 2) < 0.05, 'topples for 2 s');
    assert.ok(run(ctx, 1, () => e.state === 'march'));
    assertFinite(e, 'dud');
  });

  test(`炮仗傀儡 (${mode}): a close player triggers a stomp and 4 ground rats that chase the feet; jumping clears them`, () => {
    for (const airborne of [false, true]) {
      const { ctx, events } = world();
      placePlayer(ctx, 0, airborne ? 1.6 : 0, 5);
      const e = spawn(Firecracker, ctx, native, new THREE.Vector3(0, 0, 0));
      assert.ok(run(ctx, 3, () => e.state === 'stomp'), 'never stomped');
      run(ctx, 3.5);
      const rats = events.hits.filter(h => Math.abs(h.amount - FIRECRACKER_DEF.damage * 0.6) < FIRECRACKER_DEF.damage * 0.35);
      if (airborne) assert.equal(events.hits.length, 0, 'rats blast at ground level: an airborne player is not hit');
      else assert.ok(rats.length >= 2, `rats reach a standing player (${rats.length})`);
    }
  });

  test(`炮仗傀儡 (${mode}): death detonates kin in 3.5 m one after another, blasts other enemies with knockback, spares far kin`, () => {
    const { ctx, events } = world();
    placePlayer(ctx, 0, 0, 25);
    const a = spawn(Firecracker, ctx, native, new THREE.Vector3(0, 0, 0));
    const b = spawn(Firecracker, ctx, native, new THREE.Vector3(2.6, 0, 0));
    const far = spawn(Firecracker, ctx, native, new THREE.Vector3(12, 0, 0));
    const crow = spawn(FireCrow, ctx, native, new THREE.Vector3(-1.5, 0, 1));
    const grunt = dummy(ctx, new THREE.Vector3(0, 0, -2.5));
    run(ctx, 1);
    crow.position.set(-1.5, 0.8, 1);
    ctx.combat.damageEnemy(a, { base: 500, element: 'none', source: 'weapon' });
    assert.equal(a.alive, false);
    run(ctx, 1.2);
    assert.equal(b.alive, false, 'neighbouring puppet chain-detonated');
    assert.equal(crow.alive, false, 'crow in range chain-detonated');
    assert.equal(far.alive, true, 'puppet 12 m away untouched');
    const killB = events.kills.find(k => k.e === b), killC = events.kills.find(k => k.e === crow);
    assert.ok(killB.t - ctx.time.now < 0 && killB.t > events.kills[0].t + CHAIN.hop - 0.02, 'chain hops are staggered');
    assert.ok(killC && killB && Math.abs(killB.t - killC.t) > 0.03, 'kin explode one after another');
    const gruntHits = events.damaged.filter(d => d.e === grunt);
    assert.ok(gruntHits.length >= 1, 'other enemies take the blast');
    assert.ok(gruntHits.every(d => d.req.knockback > 0), 'with knockback (into lava)');
    assert.ok(events.explodes.every(x => x.opts.playerDamage === 0), 'enemy-side blasts never double-hit the player');
    assert.equal(events.hits.length, 0, 'player 25 m away is safe');
  });

  test(`神火飞鸦 (${mode}): circles high, ignites 0.7s with a ground dive line, then dives in a straight line to the locked point (no homing)`, () => {
    const { ctx, events } = world();
    placePlayer(ctx, 0, 0, 0);
    const e = spawn(FireCrow, ctx, native, new THREE.Vector3(9, 0, 0));
    let hoverY = 0, igniteAt = -1, diveAt = -1;
    assert.ok(run(ctx, 8, () => {
      if (e.state === 'circle') hoverY = Math.max(hoverY, e.position.y);
      if (e.state === 'ignite' && igniteAt < 0) igniteAt = ctx.time.now;
      return e.state === 'ignite';
    }), `never ignited (${e.state})`);
    assert.ok(hoverY > 7, `circles 8–14 m up (${hoverY.toFixed(2)})`);
    const locked = e.diveTarget.clone();
    assert.ok(locked.distanceTo(new THREE.Vector3(0, 0, 0)) < 1e-6, 'locks the player position at ignition');
    assert.equal(events.warnings, 1, 'impact warning circle');
    assert.ok(run(ctx, 1, () => { if (e.state === 'dive' && diveAt < 0) diveAt = ctx.time.now; return e.state === 'dive'; }));
    assert.ok(Math.abs(diveAt - igniteAt - 0.7) < 0.05, `ignite lasts 0.7s (${(diveAt - igniteAt).toFixed(3)})`);
    // 玩家横移 4 米：俯冲不追踪
    placePlayer(ctx, 4.5, 0, 0);
    const start = e.diveStart.clone(), dir = e.diveVel.clone().normalize();
    let dev = 0;
    const crashed = run(ctx, 3, () => {
      if (e.alive) {
        const c = e.getBodyCenter(new THREE.Vector3()).sub(start);
        dev = Math.max(dev, c.clone().sub(dir.clone().multiplyScalar(c.dot(dir))).length());
      }
      return !e.alive;
    });
    assert.ok(crashed, 'crashes');
    assert.ok(dev < 0.35, `straight dive (max deviation ${dev.toFixed(3)} m)`);
    const end = e.position;
    assert.ok(Math.hypot(end.x - locked.x, end.z - locked.z) < 1.6, `hits the locked point (${Math.hypot(end.x - locked.x, end.z - locked.z).toFixed(2)})`);
    assert.equal(events.hits.length, 0, 'the sidestepping player dodged');
    assert.equal(events.kills.length, 0, 'a crash is not a player kill');
    const fires = listFires(ctx);
    assert.equal(fires.length, 1, 'burning paper ash left on the floor (edible by 祸斗)');
    // 站进纸灰里被烧；纸灰被吃掉后不再烧
    placePlayer(ctx, fires[0].position.x, 0, fires[0].position.z);
    run(ctx, 0.6);
    const burned = events.hits.length;
    assert.ok(burned >= 1, 'ash burns a player standing in it');
    fires[0].consume();
    run(ctx, 1.5);
    assert.equal(events.hits.length, burned, 'eaten ash stops burning');
  });

  test(`神火飞鸦 (${mode}): a standing player is blasted once; a flock takes turns igniting 1.5–3 s apart`, () => {
    const { ctx, events } = world();
    placePlayer(ctx, 0, 0, 0);
    const crows = [0, 1, 2, 3].map(i => spawn(FireCrow, ctx, native, new THREE.Vector3(Math.sin(i * 1.6) * 9, 0, Math.cos(i * 1.6) * 9)));
    const ignites = [];
    const seen = new Set();
    run(ctx, 14, () => {
      for (const c of crows) if (c.state === 'ignite' && !seen.has(c)) { seen.add(c); ignites.push(ctx.time.now); }
      return seen.size === crows.length && crows.every(c => !c.alive);
    });
    assert.ok(ignites.length >= 3, `flock ignitions (${ignites.length})`);
    for (let i = 1; i < ignites.length; i++) {
      const gap = ignites[i] - ignites[i - 1];
      assert.ok(gap >= 1.5 - 1e-6 && gap <= 3.4, `turn gap ${gap.toFixed(2)} s`);
    }
    const blasts = events.hits.filter(h => h.amount > FIRE_CROW_DEF.damage * 0.45);
    assert.ok(blasts.length >= 1, 'a standing player gets blasted');
    assert.ok(blasts.every(h => h.amount <= FIRE_CROW_DEF.damage + 1e-6));
    for (const c of crows) assertFinite(c, 'flock');
  });

  test(`神火飞鸦 (${mode}): shot down in the air it explodes into its neighbours (chain), never hurting the player`, () => {
    const { ctx, events } = world();
    placePlayer(ctx, 0, 0, 0);
    const a = spawn(FireCrow, ctx, native, new THREE.Vector3(10, 0, 0));
    const b = spawn(FireCrow, ctx, native, new THREE.Vector3(12, 0, 0));
    const c = spawn(FireCrow, ctx, native, new THREE.Vector3(14, 0, 0));
    run(ctx, 1);
    for (const [e, x] of [[a, 10], [b, 12], [c, 14]]) { e.position.set(x, 9, 0); e.velocity.set(0, 0, 0); e.cooldown = 99; }
    ctx.combat.damageEnemy(a, { base: 50, element: 'none', source: 'weapon' });
    run(ctx, 0.8);
    assert.equal(b.alive, false, 'neighbour 2 m away caught in the blast');
    assert.equal(c.alive, false, 'and it chains on to the next');
    assert.equal(events.hits.length, 0);
    assert.ok(events.explodes.every(x => x.opts.playerDamage === 0 && x.radius === 3));
  });

  test(`神火飞鸦 (${mode}): the powder drum is the weak spot`, () => {
    const { ctx } = world();
    placePlayer(ctx, 0, 0, 20);
    const e = spawn(FireCrow, ctx, native, new THREE.Vector3(0, 0, 0));
    run(ctx, 1.2);
    const drum = e.getBodyCenter(new THREE.Vector3());
    const out = { distance: 0, headshot: false };
    const from = drum.clone().add(new THREE.Vector3(0, -3, 6));
    assert.ok(e.raycastHit(from, drum.clone().sub(from).normalize(), 50, out));
    assert.equal(out.headshot, true);
    assertFinite(e, 'crow');
  });

  test(`炮仗傀儡 (${mode}): belly chamber is the weak spot, the painted head is not`, () => {
    const { ctx } = world();
    placePlayer(ctx, 0, 0, 18);
    const e = spawn(Firecracker, ctx, native, new THREE.Vector3(0, 0, 0));
    run(ctx, 1);
    const out = { distance: 0, headshot: false };
    const belly = e.bellyCenter(new THREE.Vector3());
    const fwd = new THREE.Vector3(Math.sin(e.facing), 0, Math.cos(e.facing));
    const from = belly.clone().addScaledVector(fwd, 8);
    assert.ok(e.raycastHit(from, belly.clone().sub(from).normalize(), 50, out));
    assert.equal(out.headshot, true, 'belly hit counts as a weak-spot hit');
    const head = e.getHeadCenter(new THREE.Vector3());
    const hFrom = head.clone().addScaledVector(fwd, 8);
    assert.ok(e.raycastHit(hFrom, head.clone().sub(hFrom).normalize(), 50, out));
    assert.equal(out.headshot, false, 'head is a body hit');
    assert.ok(head.y > 1.6 && head.y < 2.1, `head anchor at the wooden head (${head.y.toFixed(2)})`);
  });
}
