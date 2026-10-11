import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

// 第二章游击组（三青鸟 / 冰河豚 / 冰棘豪彘）的无头回归：用生产代码的 EnemyBase、StandardEnemy、AttackTokens、Hazards、
// 碰撞世界、导航网格、任务调度与 NativePose，逐帧推进到每只怪的主招式，检查招式结算。
// 美术加载（AssetLibrary / GLB）换成桩：白模模式不挂美术；原生骨架模式按 creature_rigs/<asset>.json 的骨骼位置
// 搭一副同名骨架交给真实 NativePose，驱动与游戏里同一套骨骼动画代码。

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
// 美术接入桩：测试按需挂一副原生骨架（globalThis.__frostArt）
const enemyArtUrl = dataModule(`
  export function attachEnemyArt(o) {
    const n = globalThis.__frostArt ? globalThis.__frostArt(o) : null;
    if (n) for (const m of n.materials) o.own(m);
    return { body: n, native: n, parts: [] };
  }
`);
const standardUrl = await tsModule('../src/enemies/StandardEnemy.ts', {
  '../core/math': mathUrl, './EnemyBase': enemyBaseUrl, './AttackTokens': tokensUrl, './Affixes': affixesUrl,
  './Levels': levelsUrl, './Models': modelsUrl, '../assets/EnemyArt': enemyArtUrl,
});
const visualsUrl = await tsModule('../src/enemies/bosses/Visuals.ts');
const fxUrl = await tsModule('../src/enemies/fx/FrostSkirmishFx.ts', { '../../core/math': mathUrl, '../bosses/Visuals': visualsUrl });
const enemyImports = {
  '../../core/math': mathUrl, '../StandardEnemy': standardUrl, '../AttackTokens': tokensUrl, '../Hazards': hazardsUrl,
  '../Models': modelsUrl, '../fx/FrostSkirmishFx': fxUrl,
};
const { Qingniao, QINGNIAO_DEF } = await import(await tsModule('../src/enemies/types/Qingniao.ts', enemyImports));
const { IcePuffer, ICE_PUFFER_DEF } = await import(await tsModule('../src/enemies/types/IcePuffer.ts', enemyImports));
const { Haozhi, HAOZHI_DEF } = await import(await tsModule('../src/enemies/types/Haozhi.ts', enemyImports));
const { FOG_SLOW_SOURCE } = await import(fxUrl);
const { attackDirector } = await import(tokensUrl);
const { Stats } = await import(statsUrl);
const { TaskRunner } = await import(tasksUrl);
const { NativePose } = await import(nativeRigUrl);
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { NavGrid } = await import(await tsModule('../src/world/NavGrid.ts', { '../core/math': mathUrl }));

const ASSET = { qingniao: 'SK_Enemy_Qingniao', ice_puffer: 'SK_Enemy_IcePuffer', haozhi: 'SK_Enemy_Haozhi' };

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

function world(extra) {
  const events = { shots: [], hits: [], explodes: [], warnings: 0, impulses: [] };
  const tasks = new TaskRunner();
  const ctx = {
    rng: { range: (a, b) => (a + b) / 2, sign: () => 1, int: (a) => a, chance: () => false },
    time: { now: 0, dt: 1 / 60, timeScale: 1, frame: 0 },
    settings: { quality: 'high' }, renderer: null, run: { chapter: 1, flags: {} },
    scene: new THREE.Scene(), stageGroup: new THREE.Group(), tasks,
    audio: { play() {} },
    enemies: { list: [], queryRadius: () => [] },
    projectiles: { spawn: spec => events.shots.push(spec) },
    combat: {
      damagePlayer: (amount, element, source, from) => { events.hits.push({ amount, element, source, t: ctx.time.now }); return amount; },
      explode: (center, radius, req, opts) => events.explodes.push({ center: center.clone(), radius, req, opts }),
    },
    fx: {
      burst() {}, explosion() {}, ring() {}, shake() {}, spawnEffect() {}, deathEffect() {}, impact() {},
      groundWarning: () => { events.warnings++; return () => {}; },
    },
  };
  ctx.scene.add(ctx.stageGroup);
  ctx.world = new CollisionWorld();
  ctx.world.addBox(-30, -0.5, -30, 30, 0, 30, 'floor');
  extra?.(ctx.world);
  ctx.stage = { arena: { minX: -28, minZ: -28, maxX: 28, maxZ: 28, floorY: 0, center: new THREE.Vector3() }, stage: { theme: 'frost' } };
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
  globalThis.__frostArt = native ? o => fakeNative(ASSET[o.defId], o.host) : null;
  const e = new Type(ctx, { position: pos.clone() });
  e.init();
  globalThis.__frostArt = null;
  return e;
}

/** 逐帧推进（敌人 + 任务），until 为真时提前返回 true */
function run(ctx, e, seconds, until) {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    ctx.time.now += dt;
    ctx.time.dt = dt;
    ctx.time.frame++;
    if (!e.removed) e.update(dt);
    ctx.tasks.update(dt);
    if (until && until()) return true;
  }
  return false;
}

function assertFinite(e, label) {
  e.root.updateWorldMatrix(false, true);
  e.root.traverse(o => assert.ok(o.matrixWorld.elements.every(Number.isFinite), `${label}: non-finite transform on ${o.name || o.type}`));
}

const killResult = () => ({
  request: { base: 10, element: 'none', source: 'weapon' }, dealt: 10, isCrit: false, killed: true, layer: 'health',
  shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null,
});

for (const native of [false, true]) {
  const mode = native ? 'native skeleton' : 'procedural model';

  test(`冰棘豪彘 (${mode}): scrape → charge → bristle → 16-quill horizontal nova aimed through the player, then quill field`, () => {
    const { ctx, events } = world();
    placePlayer(ctx, 0, 0, 14);
    const e = spawn(Haozhi, ctx, native, new THREE.Vector3(0, 0, 0));
    const states = new Set();
    let novaYawFrom = null, quillPose = 0;
    const fired = run(ctx, e, 8, () => {
      states.add(e.state);
      if (e.state === 'bristle' && !novaYawFrom) novaYawFrom = e.position.clone();
      if (native && e.state === 'bristle' && e.stateTime > 0.5) {
        quillPose = Math.max(quillPose, e.nativeBody.pose.bone('quill_1').quaternion.angleTo(new THREE.Quaternion()));
      }
      return events.shots.length > 0;
    });
    assert.ok(fired, `no nova; states ${[...states]}`);
    for (const s of ['chase', 'scrape', 'charge', 'bristle']) assert.ok(states.has(s), `missing state ${s}: ${[...states]}`);
    assert.equal(events.shots.length, 16);
    assert.equal(e.alive, false, 'nova kills the boar');
    const dist = Math.hypot(ctx.player.position.x - e.position.x, ctx.player.position.z - e.position.z);
    assert.ok(dist <= 6.2 && dist > 2, `nova fired from ${dist.toFixed(2)}m (should stop inside 6m, not on the player)`);
    const toPlayer = new THREE.Vector3().subVectors(ctx.player.position, novaYawFrom).setY(0).normalize();
    let best = -1;
    for (const s of events.shots) {
      assert.equal(s.owner, 'enemy');
      assert.equal(s.velocity.y, 0, 'quills fly horizontally');
      assert.ok(Math.abs(Math.hypot(s.velocity.x, s.velocity.z) - 20) < 1e-6);
      assert.ok(Math.abs(s.lifetime * 20 - 12) < 1e-6, '12m range');
      assert.ok(Math.abs(s.position.y - (e.position.y + 0.62 * 1.4)) < 1e-6, 'quills at ~0.87m: a jump clears them');
      assert.equal(s.enemyDamage, HAOZHI_DEF.damage);
      best = Math.max(best, s.velocity.clone().normalize().dot(toPlayer));
    }
    assert.ok(best > 0.999, 'one quill lane points at the player at bristle start (spokes match quills)');
    if (native) assert.ok(quillPose > 0.3, `quill crown should bristle on the native rig (${quillPose})`);
    // 残刺阵：走进去每 0.5 秒扎一下（伤害 = 冰刺 × 0.3），4 秒后消失
    placePlayer(ctx, e.position.x + 1, 0, e.position.z);
    const before = events.hits.length;
    run(ctx, e, 1.05);
    const field = events.hits.slice(before);
    assert.ok(field.length >= 2, 'quill field pricks the player standing in it');
    assert.ok(field.every(h => Math.abs(h.amount - HAOZHI_DEF.damage * 0.3) < 1e-6));
    run(ctx, e, 3.5);
    const after = events.hits.length;
    run(ctx, e, 1);
    assert.equal(events.hits.length, after, 'field expires after 4s');
  });

  test(`冰棘豪彘 (${mode}): killed before the nova sprays only half the quills at half damage, no field`, () => {
    const { ctx, events } = world();
    placePlayer(ctx, 0, 0, 30);
    const e = spawn(Haozhi, ctx, native, new THREE.Vector3(0, 0, 0));
    run(ctx, e, 1);
    assert.equal(e.state, 'chase');
    e.onKilled(killResult());
    assert.equal(events.shots.length, 0, 'deferred out of the damage pipeline');
    run(ctx, e, 0.2);
    assert.equal(events.shots.length, 8);
    assert.ok(events.shots.every(s => s.enemyDamage === HAOZHI_DEF.damage * 0.5));
  });

  test(`冰河豚 (${mode}): drift → dive → 0.8s inflate to 2x → burst + slowing frost fog that clears itself`, () => {
    const { ctx, events } = world();
    placePlayer(ctx, 0, 0, 7);
    const e = spawn(IcePuffer, ctx, native, new THREE.Vector3(0, 0, 0));
    const states = new Set();
    let maxHead = 0, maxBodyScale = 0, inflateStart = -1, burstAt = -1, hoverY = 0;
    const burst = run(ctx, e, 8, () => {
      states.add(e.state);
      if (e.state === 'drift') hoverY = Math.max(hoverY, e.position.y);
      if (e.state === 'inflate' && inflateStart < 0) inflateStart = ctx.time.now;
      if (e.alive) maxHead = Math.max(maxHead, e.headRadius);
      if (native && e.alive) maxBodyScale = Math.max(maxBodyScale, e.nativeBody.pose.bone('body').scale.x);
      if (!e.alive && burstAt < 0) burstAt = ctx.time.now;
      return !e.alive;
    });
    assert.ok(burst, `no burst; states ${[...states]}`);
    for (const s of ['drift', 'dive', 'inflate']) assert.ok(states.has(s), `missing ${s}: ${[...states]}`);
    assert.ok(hoverY > 1.8, `floats above the player before diving (${hoverY.toFixed(2)})`);
    assert.ok(Math.abs(burstAt - inflateStart - 0.8) < 0.05, `inflate lasts 0.8s (${(burstAt - inflateStart).toFixed(3)})`);
    assert.equal(events.warnings, 1, 'inflate shows a ground warning');
    assert.ok(maxHead > ICE_PUFFER_DEF.headRadius * 1.8, 'weak-spot sphere grows with the body');
    if (native) assert.ok(maxBodyScale > 1.85, `body bone inflates to ~2x (${maxBodyScale})`);
    assert.equal(events.hits.length, 1, 'burst hits the player once');
    assert.ok(events.hits[0].amount > ICE_PUFFER_DEF.damage * 0.55 && events.hits[0].amount <= ICE_PUFFER_DEF.damage);
    // 冻雾：玩家在雾里移速 −40%，离开 / 雾散后撤销
    run(ctx, e, 0.1);
    assert.ok(ctx.player.stats.hasSource(FOG_SLOW_SOURCE), 'standing in the fog slows');
    assert.ok(Math.abs(ctx.player.stats.get('moveSpeed') - 7.5 * 0.6) < 1e-6);
    placePlayer(ctx, 0, 0, 20);
    run(ctx, e, 0.1);
    assert.ok(!ctx.player.stats.hasSource(FOG_SLOW_SOURCE), 'leaving the fog removes the slow');
    placePlayer(ctx, e.position.x, 0, e.position.z);
    run(ctx, e, 0.1);
    assert.ok(ctx.player.stats.hasSource(FOG_SLOW_SOURCE));
    run(ctx, e, 4.2);
    assert.ok(!ctx.player.stats.hasSource(FOG_SLOW_SOURCE), 'fog expires after 4s');
    assert.ok(Math.abs(ctx.player.stats.get('moveSpeed') - 7.5) < 1e-6);
  });

  test(`冰河豚 (${mode}): popped mid-inflate hurts only other enemies and leaves a small fog; popped while drifting just shatters`, () => {
    for (const phase of ['inflate', 'drift']) {
      const { ctx, events } = world();
      placePlayer(ctx, 0, 0, phase === 'inflate' ? 7 : 40);
      const e = spawn(IcePuffer, ctx, native, new THREE.Vector3(0, 0, 0));
      assert.ok(run(ctx, e, 6, () => e.state === phase && e.stateTime > 0.2), `never reached ${phase}`);
      e.onKilled(killResult());
      run(ctx, e, 0.3);
      assert.equal(events.hits.length, 0, `${phase}: no player damage when popped`);
      if (phase === 'inflate') {
        assert.equal(events.explodes.length, 1);
        assert.equal(events.explodes[0].opts.playerDamage, 0);
        placePlayer(ctx, e.position.x, 0, e.position.z);
        run(ctx, e, 0.1);
        assert.ok(ctx.player.stats.hasSource(FOG_SLOW_SOURCE), 'popped puffer still leaves a small fog');
        run(ctx, e, 3);
        assert.ok(!ctx.player.stats.hasSource(FOG_SLOW_SOURCE));
      } else {
        assert.equal(events.explodes.length, 0);
      }
    }
  });

  test(`三青鸟 (${mode}): climbs to 8–11m, winds up 0.5s, fires a 5-feather line from both wings and the chest`, () => {
    const { ctx, events } = world();
    placePlayer(ctx, 0, 0, 20);
    const e = spawn(Qingniao, ctx, native, new THREE.Vector3(0, 0, 0));
    let windup = -1;
    const fired = run(ctx, e, 6, () => {
      if (e.state === 'volley' && windup < 0) windup = ctx.time.now;
      return events.shots.length > 0;
    });
    assert.ok(fired, `no volley (state ${e.state})`);
    assert.ok(Math.abs(ctx.time.now - windup - 0.5) < 0.05, 'feathers leave after the 0.5s wing pull-back');
    assert.ok(e.position.y > 6 && e.position.y < 12, `hovering high (${e.position.y.toFixed(2)})`);
    assert.equal(events.shots.length, 5);
    // 出射点：两翼尖（翅膀此刻上扬后掠，水平跨度约 1.7 米）、两翼中、胸前；左翼的在生物左侧（局部 +X）
    const local = events.shots.map(s => e.root.worldToLocal(s.position.clone()));
    assert.ok(local[0].x > 0.55 && local[4].x < -0.55, `wing-tip feathers on opposite wings (${local[0].x.toFixed(2)} / ${local[4].x.toFixed(2)})`);
    assert.ok(local[0].x > local[1].x && local[1].x > local[2].x && local[2].x > local[3].x && local[3].x > local[4].x, 'origins ordered left → right');
    assert.ok(Math.abs(local[2].x) < 0.1, 'middle feather from the chest jewel');
    for (const s of events.shots) {
      assert.equal(s.visual, 'shard');
      assert.ok(Math.abs(s.velocity.length() - 22) < 1e-6);
      assert.equal(s.enemyDamage, QINGNIAO_DEF.damage);
    }
    // 在玩家处排成横排：落点（沿各自方向飞到玩家所在距离）两两相距约 2 米
    const hitsAtPlayer = events.shots.map(s => {
      const t = (ctx.player.position.z - s.position.z) / s.velocity.z;
      return s.position.clone().addScaledVector(s.velocity, t);
    }).sort((a, b) => a.x - b.x);
    for (let i = 1; i < hitsAtPlayer.length; i++) {
      const gap = hitsAtPlayer[i].distanceTo(hitsAtPlayer[i - 1]);
      assert.ok(gap > 1.5 && gap < 2.6, `feather gap ${gap.toFixed(2)}`);
    }
    assert.ok(Math.abs(hitsAtPlayer[2].x - ctx.player.position.x) < 0.3, 'middle feather on the player');
    assertFinite(e, 'volley');
    run(ctx, e, 1);
    assert.equal(e.state, 'hover');
  });

  test(`三青鸟 (${mode}): a ground-level spawn starts airborne and the long tail plumes never dip into the floor while it climbs`, () => {
    const { ctx } = world();
    placePlayer(ctx, 0, 0, 20);
    const e = spawn(Qingniao, ctx, native, new THREE.Vector3(0, 0, 0));
    assert.ok(e.position.y >= 2.0 * QINGNIAO_DEF.scale - 1e-6, `spawned in the air (${e.position.y.toFixed(2)} m)`);
    // 美术网格的尾羽尖垂在脚底下 1 个模型单位（ART_DROP，随出生动画的缩放一起长大）：起飞全程不进地面
    let clearance = Infinity;
    run(ctx, e, 2, () => { clearance = Math.min(clearance, e.position.y - 1.0 * e.model.scale.x); return false; });
    assert.ok(clearance > 0.05, `tail tip stays above the floor from the first frame (clearance ${clearance.toFixed(2)} m)`);
    // 贴着地面飞（脚底离地 0.9 米）时尾羽往后上方收起，抬到脚底以上
    const tailLow = () => {
      e.root.updateWorldMatrix(true, true);
      let low = Infinity;
      const v = new THREE.Vector3();
      if (native) e.root.traverse(o => { if (o.isBone && o.name.startsWith('tail_')) low = Math.min(low, o.getWorldPosition(v).y); });
      else for (const chain of e.plumeJoints) low = Math.min(low, chain[2].localToWorld(v.set(0, -0.38, 0)).y);
      return low;
    };
    e.position.y = 0.9;
    e.velocity.set(0, 0, 0);
    run(ctx, e, 2 / 60);
    assert.ok(e.position.y < 1.2, 'still low for the check');
    assert.ok(tailLow() > e.position.y, `low flight tucks the tail up behind the body (tail ${tailLow().toFixed(2)} m, feet ${e.position.y.toFixed(2)} m)`);
  });

  test(`三青鸟 (${mode}): losing 30% hp triggers screech → low swoop past the player (contact hit) → climbs away`, () => {
    const { ctx, events } = world();
    placePlayer(ctx, 0, 0, 18);
    const e = spawn(Qingniao, ctx, native, new THREE.Vector3(0, 0, 0));
    run(ctx, e, 1.2);
    e.onDamaged({ ...killResult(), killed: false, dealt: QINGNIAO_DEF.hp * 0.31 });
    const states = new Set();
    let low = Infinity;
    run(ctx, e, 6, () => {
      states.add(e.state);
      if (e.state === 'swoopDown' || e.state === 'swoopUp') low = Math.min(low, e.position.y);
      return states.has('swoopUp') && e.state === 'hover';
    });
    for (const s of ['screech', 'swoopDown', 'swoopUp', 'hover']) assert.ok(states.has(s), `missing ${s}: ${[...states]}`);
    assert.ok(low < 1.5, `swoops down to the player (${low.toFixed(2)}m)`);
    const swoopHits = events.hits.filter(h => Math.abs(h.amount - 22) < 1e-6);
    assert.equal(swoopHits.length, 1, 'a standing player is clipped exactly once');
    assert.equal(events.impulses.length, 1, 'and knocked aside');
    assertFinite(e, 'swoop');
  });

  test(`三青鸟 (${mode}): after ~12s of flight perches on a pillar top for 3s (damage window), then takes off`, () => {
    const { ctx } = world(w => w.addBox(10, 0, 9, 12, 3, 11, 'pillar'));
    placePlayer(ctx, 0, 0, 0);
    const e = spawn(Qingniao, ctx, native, new THREE.Vector3(-10, 0, -10));
    run(ctx, e, 1);
    e.flyTime = 99;
    e.cooldown = 99;
    assert.ok(run(ctx, e, 9, () => e.state === 'perched'), `never perched (${e.state})`);
    assert.ok(Math.abs(e.position.y - 3) < 0.15, `stands on the pillar top (${e.position.y.toFixed(3)})`);
    assert.ok(e.position.x > 9.9 && e.position.x < 12.1 && e.position.z > 8.9 && e.position.z < 11.1, 'on the pillar');
    const t0 = ctx.time.now;
    assert.ok(run(ctx, e, 4, () => e.state === 'takeoff'));
    assert.ok(Math.abs(ctx.time.now - t0 - 3) < 0.05, 'rests 3s');
    assert.ok(run(ctx, e, 1, () => e.state === 'hover'));
    assertFinite(e, 'perch');
  });

  test(`三青鸟 (${mode}): chest frost jewel is the weak spot; body, head and inner wings take body hits`, () => {
    const { ctx } = world();
    placePlayer(ctx, 0, 0, 18);
    const e = spawn(Qingniao, ctx, native, new THREE.Vector3(0, 0, 0));
    run(ctx, e, 1.5);
    const out = { distance: 0, headshot: false };
    const jewel = e.hits[0].anchor.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(Math.sin(e.facing), 0, Math.cos(e.facing));
    const from = jewel.clone().addScaledVector(fwd, 8);
    assert.ok(e.raycastHit(from, jewel.clone().sub(from).normalize(), 50, out));
    assert.equal(out.headshot, true, 'shot at the jewel from the front is a weak-spot hit');
    const wing = e.hits[5].anchor.getWorldPosition(new THREE.Vector3());
    const wFrom = wing.clone().addScaledVector(fwd, 8);
    assert.ok(e.raycastHit(wFrom, wing.clone().sub(wFrom).normalize(), 50, out));
    assert.equal(out.headshot, false, 'inner wing is hittable body');
    const miss = jewel.clone().add(new THREE.Vector3(0, 3, 0)).addScaledVector(fwd, 8);
    assert.equal(e.raycastHit(miss, fwd.clone().negate(), 50, out), false, 'shots above the crest miss');
  });
}
