import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

// 第二章远程组（夫诸、冰鲸）：用生产的 EnemyBase / StandardEnemy / 碰撞世界 / 导航网格 / 任务调度无头运行，
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
const fxUrl = await tsModule('../src/enemies/fx/FrostRangedFx.ts', { '../../core/math': mathUrl, '../bosses/Visuals': visualsUrl });
const enemyImports = { '../../core/math': mathUrl, '../StandardEnemy': standardUrl, '../bosses/Visuals': visualsUrl, '../Models': modelsUrl, '../fx/FrostRangedFx': fxUrl };
const { Fuzhu, FUZHU_DEF } = await import(await tsModule('../src/enemies/types/Fuzhu.ts', enemyImports));
const { IceWhale, ICE_WHALE_DEF } = await import(await tsModule('../src/enemies/types/IceWhale.ts', enemyImports));
const fx = await import(fxUrl);
const { attackDirector } = await import(tokensUrl);
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { NavGrid } = await import(await tsModule('../src/world/NavGrid.ts', { '../core/math': mathUrl }));
const { TaskRunner } = await import(await tsModule('../src/core/Tasks.ts'));

const DT = 1 / 60;

/** 可复现的伪随机（导航网格的随机可走点用） */
function lcg(seed) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function makeCtx(playerAt = new THREE.Vector3(0, 0, 18)) {
  // 每个场景的时钟从 0 开始：攻击令牌（模块级）也要清空，否则上一个场景的授予时间会挡住这次申请
  attackDirector.reset();
  const events = { hits: [], impulses: [], warnings: [], audio: [] };
  const world = new CollisionWorld();
  world.addBox(-40, -0.5, -40, 40, 0, 40, 'floor');
  const scene = new THREE.Scene();
  const stageGroup = new THREE.Group();
  scene.add(stageGroup);
  const player = {
    position: playerAt.clone(), velocity: new THREE.Vector3(), eye: new THREE.Vector3(), radius: 0.35, height: 1.8,
    alive: true, onGround: true, isDashing: false, isLunging: false, invulnerableTime: 0,
    applyImpulse(v) { events.impulses.push(v.clone()); this.velocity.add(v); },
  };
  const ctx = {
    rng: { range: (a, b) => (a + b) / 2, sign: () => 1, next: lcg(7) }, player, world, scene, stageGroup, tasks: new TaskRunner(),
    time: { now: 0, dt: DT, frame: 0, timeScale: 1 },
    stage: { arena: { minX: -40, minZ: -40, maxX: 40, maxZ: 40, floorY: 0, center: new THREE.Vector3() }, stage: { theme: 'frost' } },
    run: { chapter: 1 }, settings: { quality: 'high' }, renderer: null,
    audio: { play: id => events.audio.push(id) },
    combat: { damagePlayer: (damage, element, source) => { events.hits.push({ damage, time: ctx.time.now, source }); return damage; } },
    enemies: { list: [], queryRadius: (c, r) => ctx.enemies.list.filter(e => e.alive && e.position.distanceTo(c) <= r + e.radius), spawn: () => null },
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

/** 推进一帧：敌人 update → 任务调度（与 Game 的顺序一致），玩家眼睛跟着位置 */
function frame(ctx, enemies) {
  ctx.time.now += DT;
  ctx.time.frame++;
  const p = ctx.player.position;
  ctx.player.eye.set(p.x, p.y + 1.6, p.z);
  for (const e of enemies) e.update(DT);
  ctx.tasks.update(DT);
}
function run(ctx, enemies, seconds, until = null) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    frame(ctx, enemies);
    if (until && until()) return true;
  }
  return false;
}

test('fuzhu telegraphs a tracked aim line, locks for the last 30% of its 1.2 s charge, then fires one straight ice beam', () => {
  const { ctx, events } = makeCtx();
  const e = spawn(Fuzhu, ctx);
  e.leapCd = 99;
  e.cooldown = 0;
  assert.ok(run(ctx, [e], 2, () => e.state === 'charge'), 'should start charging once visible and in range');
  const start = ctx.time.now;
  assert.ok(e.aimDecal, 'ground aim line appears with the charge');
  assert.equal(e.chargeTime, 1.2);
  // 跟踪段：玩家横移 2 米，瞄准方向跟上
  ctx.player.position.x = 2;
  run(ctx, [e], 0.6);
  assert.ok(e.aimDir.x > 0.05, `aim should follow the strafing player during tracking (${e.aimDir.x})`);
  // 锁定段：方向不再变化
  run(ctx, [e], 0.3);
  assert.ok(ctx.time.now - start > 1.2 * 0.7);
  const locked = e.aimDir.clone();
  ctx.player.position.x = 2.2;
  run(ctx, [e], 0.1);
  assert.ok(e.aimDir.distanceTo(locked) < 1e-9, 'aim must be locked in the last 30% of the charge');
  assert.equal(events.hits.length, 0, 'no damage before release');
  run(ctx, [e], 0.4, () => e.state === 'recover');
  assert.equal(e.state, 'recover');
  assert.ok(Math.abs(ctx.time.now - start - 1.2) < 2 * DT, `beam released at the end of the charge (${ctx.time.now - start})`);
  assert.equal(events.hits.length, 1, 'player standing on the locked line is hit exactly once');
  assert.equal(events.hits[0].damage, FUZHU_DEF.damage);
  assert.equal(e.aimDecal, null, 'aim line is withdrawn on release');
});

test('fuzhu beam misses a player who leaves the locked line, and cover blocks it', () => {
  {
    const { ctx, events } = makeCtx();
    const e = spawn(Fuzhu, ctx);
    e.leapCd = 99;
    e.cooldown = 0;
    run(ctx, [e], 2, () => e.state === 'charge');
    run(ctx, [e], 1.0); // locked by now
    ctx.player.position.x = 2.5; // sidestep out of the line
    run(ctx, [e], 0.4, () => e.state === 'recover');
    assert.equal(e.state, 'recover');
    assert.equal(events.hits.length, 0, 'sidestepping after the lock dodges the beam');
  }
  {
    const { ctx, events } = makeCtx();
    const e = spawn(Fuzhu, ctx);
    e.leapCd = 99;
    e.cooldown = 0;
    run(ctx, [e], 2, () => e.state === 'charge');
    // 玩家身前立起掩体（例如躲到冰柱后）
    ctx.world.addBox(-3, 0, 12, 3, 3, 12.6, 'cover');
    run(ctx, [e], 1.4, () => e.state === 'recover');
    assert.equal(e.state, 'recover');
    assert.equal(events.hits.length, 0, 'cover between the deer and the player blocks the beam');
  }
  {
    // 直接调用冰光：终点停在掩体正面
    const { ctx, events } = makeCtx();
    ctx.world.addBox(-3, 0, 12, 3, 3, 12.6, 'cover');
    const res = fx.castIceBeam(ctx, {
      from: new THREE.Vector3(0, 1.8, 0.5), dir: new THREE.Vector3(0, -0.04, 1).normalize(), range: 34, radius: 0.35,
      damage: 10, source: null, strip: { from: new THREE.Vector3(0, 0, 0.5), halfWidth: 0.9, duration: 4 },
    });
    assert.equal(res.blocked, true);
    assert.ok(Math.abs(res.end.z - 12) < 0.05, `beam ends on the cover face (${res.end.z})`);
    assert.equal(res.hitPlayer, false);
    assert.equal(events.hits.length, 0);
  }
});

test('frozen strip under the beam makes the player slide for 4 s, then thaws', () => {
  const { ctx } = makeCtx(new THREE.Vector3(0, 0, 6));
  fx.spawnFrozenStrip(ctx, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 20), 0.9, 4);
  const p = ctx.player;
  /** 模拟玩家松开按键时的地面摩擦（60 m/s²） */
  const brake = () => {
    const v = Math.hypot(p.velocity.x, p.velocity.z);
    const nv = Math.max(0, v - 60 * DT);
    if (v > 0) p.velocity.multiplyScalar(nv / v);
  };
  const slideFor = (seconds) => {
    // 以 6 米/秒冲上冰面（之前几帧不在冰上），然后松开按键
    ctx.time.frame += 5;
    p.velocity.set(6, 0, 0);
    p.position.set(0, 0, 6);
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      brake();
      ctx.time.now += DT;
      ctx.time.frame++;
      ctx.tasks.update(DT);
    }
    return Math.hypot(p.velocity.x, p.velocity.z);
  };
  ctx.tasks.update(0.3); // 冰面冻过去
  const onIce = slideFor(0.25);
  assert.ok(onIce > 3, `on ice the player keeps sliding (speed ${onIce.toFixed(2)} m/s after 0.25 s of braking)`);
  assert.equal(fx.playerOnIce(ctx), true);
  // 冰化掉之后正常刹车
  for (let i = 0; i < 5 * 60; i++) { ctx.time.now += DT; ctx.time.frame++; ctx.tasks.update(DT); }
  const thawed = slideFor(0.25);
  assert.equal(thawed, 0, 'after the strip thaws braking is normal again');
});

test('fuzhu leaps about 10 m away from a player who closes in, landing on walkable ground', () => {
  const { ctx } = makeCtx(new THREE.Vector3(0, 0, 4));
  const e = spawn(Fuzhu, ctx);
  e.cooldown = 99;
  e.leapCd = 0;
  run(ctx, [e], 1.2, () => e.state === 'crouch');
  assert.equal(e.state, 'crouch');
  const from = e.position.clone();
  assert.ok(run(ctx, [e], 0.5, () => e.state === 'leap'), 'crouch launches the leap');
  let peak = 0;
  run(ctx, [e], 2.5, () => { peak = Math.max(peak, e.position.y); return e.state === 'land'; });
  assert.equal(e.state, 'land');
  const moved = Math.hypot(e.position.x - from.x, e.position.z - from.z);
  assert.ok(moved > 8.5 && moved < 11.5, `leap distance ${moved.toFixed(2)} m`);
  assert.ok(peak > 1.2 && peak < 3.5, `leap apex ${peak.toFixed(2)} m`);
  const dist = Math.hypot(e.position.x - ctx.player.position.x, e.position.z - ctx.player.position.z);
  assert.ok(dist > 11, `lands well away from the player (${dist.toFixed(2)} m)`);
  assert.ok(Math.abs(e.position.y) < 0.05 && e.onGround, 'lands on the floor');
  assert.ok(e.leapCd >= 4, 'leap goes on cooldown');
});

test('ice whale swells for 1 s, then rains 5 ice pillars on warned spots that grow movement-blocking spike fields for 5 s', () => {
  const { ctx, events } = makeCtx(new THREE.Vector3(0, 0, 16));
  const e = spawn(IceWhale, ctx);
  e.cooldown = 0;
  e.slamCd = 99;
  assert.ok(run(ctx, [e], 2, () => e.state === 'swell'), 'whale starts swelling');
  const swellAt = ctx.time.now;
  assert.ok(run(ctx, [e], 1.5, () => e.state === 'spout'));
  assert.ok(Math.abs(ctx.time.now - swellAt - 1.0) < 2 * DT, 'blowhole swells for 1 s');
  assert.equal(events.warnings.length, 0, 'no warning during the swell');
  frame(ctx, [e]);
  assert.equal(events.warnings.length, 5, 'five warning circles appear at the spout');
  const spots = events.warnings.map(w => w.c);
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
    assert.ok(spots[i].distanceTo(spots[j]) >= 2.6 - 1e-6, 'impact spots do not overlap');
  }
  assert.ok(spots.some(s => Math.hypot(s.x, s.z - 16) < 0.5), 'one pillar targets the player');
  assert.ok(events.warnings.every(w => w.r === 2 && w.d >= 1.35 && w.d <= 2.1));
  // 浅色冰面上看得见的饱和电光蓝预警圈；随机落点都在玩家朝冰鲸看时的视野扇面里（不砸看不见的身后）
  assert.ok(events.warnings.every(w => w.color === fx.FROST.warnSolid), 'pillar warnings use the solid electric-blue colour');
  const toWhale = Math.atan2(e.position.x - ctx.player.position.x, e.position.z - ctx.player.position.z);
  for (const w of events.warnings) {
    const dx = w.c.x - ctx.player.position.x, dz = w.c.z - ctx.player.position.z;
    if (Math.hypot(dx, dz) < 1) continue;
    const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - toWhale), Math.cos(Math.atan2(dx, dz) - toWhale)));
    assert.ok(off <= 2.0, `impact spot inside the player's forward view toward the whale (${off.toFixed(2)} rad off)`);
  }
  // 喷气柱：一道约 9 米高的冰雾气柱从喷气孔冲起；0.9 秒后（主会话截图的时刻）还清楚可见，冰柱正往上冲
  const plumes = () => ctx.stageGroup.children.filter(o => o.isMesh && o.material?.uniforms?.uAlpha && o.geometry?.type === 'CylinderGeometry');
  run(ctx, [e], 0.2);
  assert.equal(plumes().length, 1, 'spout plume appears');
  assert.ok(plumes()[0].scale.y > 8, `plume shoots ~9 m up (${plumes()[0].scale.y.toFixed(2)} m)`);
  run(ctx, [e], 0.7 - 2 * DT);
  assert.ok(plumes().length === 1 && plumes()[0].material.uniforms.uAlpha.value > 0.7, 'plume still clearly visible 0.9 s after the spout');
  assert.equal(events.hits.length, 0);
  // 玩家原地不动：被瞄准自己的那根砸中一次
  run(ctx, [e], 2.2);
  assert.equal(events.hits.length, 1, 'standing still gets hit by the pillar aimed at the player');
  assert.ok(events.hits[0].damage > ICE_WHALE_DEF.damage * 0.6 - 1e-6 && events.hits[0].damage <= ICE_WHALE_DEF.damage);
  assert.equal(fx.activeSpikeFields.length, 5, 'every impact grows a spike field');
  const boxes = () => ctx.world.boxes.filter(b => b.tag === 'ice_spikes');
  // 被砸中的玩家被推出落点；这里把玩家放回落点正中：那一处的冰棱阵不会把人卡进碰撞盒
  ctx.player.position.set(0, 0, 16);
  ctx.player.velocity.set(0, 0, 0);
  run(ctx, [e], 0.3);
  const underPlayer = fx.activeSpikeFields.find(f => Math.hypot(f.center.x, f.center.z - 16) < 0.5);
  assert.ok(underPlayer, 'field under the player');
  assert.equal(underPlayer.box, null, 'blocker waits while the player stands inside');
  assert.equal(boxes().length, 4);
  for (const b of boxes()) {
    assert.equal(b.noRaycast, true, 'spikes block movement, not bullets');
    assert.ok(b.maxY - b.minY >= 2.3, 'too tall to step or jump onto');
  }
  // 碰撞盒确实挡路：贴着冰棱阵走过去会撞墙
  const other = fx.activeSpikeFields.find(f => f.box);
  const body = new THREE.Vector3(other.center.x - 3, 0.001, other.center.z);
  const r = ctx.world.moveBody(body, 0.35, 1.8, new THREE.Vector3(3, 0, 0), true, 0.45);
  assert.equal(r.hitWall, true, 'walking into a spike field is blocked');
  ctx.player.position.set(0, 0, 22);
  run(ctx, [e], 0.2);
  assert.equal(boxes().length, 5, 'blocker closes once the player has stepped out');
  run(ctx, [e], 5.5);
  assert.equal(boxes().length, 0, 'spike fields melt after 5 s and release the space');
  assert.equal(fx.activeSpikeFields.length, 0);
});

test('ice whale keeps its 5 m body out of walls: head / tail probes back it off, and it will not swing its head into a wall while turning', () => {
  const k = ICE_WHALE_DEF.scale;
  // 场景 1：头顶在墙里（墙在 x 2.0–3.0，鲸面朝 +X），玩家在身后 16 米：退出来再转身
  // 场景 2：贴墙站着（墙在身体右侧 x 2.2 起），玩家在墙那一侧：不把头扫进墙里，先挪开再转
  for (const [wallMinX, facing, player] of [[2.0, Math.PI / 2, [-16, 0]], [2.2, 0, [16, 3]]]) {
    const { ctx } = makeCtx(new THREE.Vector3(player[0], 0, player[1]));
    ctx.world.addBox(wallMinX, 0, -6, wallMinX + 1, 3, 6, 'wall');
    const e = spawn(IceWhale, ctx);
    e.cooldown = 99;
    e.slamCd = 99;
    run(ctx, [e], e.spawnDuration + DT);
    e.position.set(0, 0, 0);
    e.velocity.set(0, 0, 0);
    e.facing = facing;
    const headIn = () => e.bodyProbeBlocked(e.facing, 2.1 * k);
    const tailIn = () => e.bodyProbeBlocked(e.facing, -2.15 * k);
    const startedIn = headIn();
    let newlyIn = 0, wasHead = headIn(), wasTail = tailIn();
    run(ctx, [e], 7, () => {
      const h = headIn(), t = tailIn();
      if ((h && !wasHead) || (t && !wasTail)) newlyIn++;
      wasHead = h; wasTail = t;
      return false;
    });
    assert.equal(newlyIn, 0, 'turning never sweeps the head or tail into the wall');
    assert.equal(headIn() || tailIn(), false, `body clear of the wall at the end (started in wall: ${startedIn})`);
    // 头尖（约 2.75 米）不在墙里
    const tip = e.position.x + Math.sin(e.facing) * 2.5 * k;
    assert.ok(tip < wallMinX + 0.05, `head tip outside the wall (${tip.toFixed(2)} vs ${wallMinX})`);
    assert.ok(e.facingDot() > 0.8, `still turns to face the player (${e.facingDot().toFixed(2)})`);
  }
});

test('ice whale flipper slam: rears 0.8 s with a warning, core hit once, ground wave can be jumped', () => {
  {
    const { ctx, events } = makeCtx(new THREE.Vector3(0, 0, 3.5));
    const e = spawn(IceWhale, ctx);
    e.cooldown = 99;
    e.slamCd = 0;
    assert.ok(run(ctx, [e], 1.2, () => e.state === 'rear'), 'close player triggers the rear-up');
    const at = ctx.time.now;
    assert.equal(events.warnings.length, 1, 'rear-up shows a ground warning');
    run(ctx, [e], 1.6);
    assert.equal(events.hits.length, 1, 'core slam hits once (the following wave spares the same player)');
    assert.ok(Math.abs(events.hits[0].time - at - (0.8 + 0.35 * 0.6)) < 3 * DT, 'impact after the 0.8 s rear-up');
    assert.ok(Math.abs(events.hits[0].damage - ICE_WHALE_DEF.damage * 1.3) < 1e-6);
  }
  for (const jumping of [false, true]) {
    const { ctx, events } = makeCtx(new THREE.Vector3(0, 0, 4));
    const e = spawn(IceWhale, ctx);
    e.cooldown = 99;
    e.slamCd = 0;
    run(ctx, [e], 1.2, () => e.state === 'rear');
    // 玩家退到爆心之外；跳起时脚底离地 1 米
    ctx.player.position.set(0, jumping ? 1.0 : 0, 8);
    run(ctx, [e], 2.0);
    assert.equal(events.hits.length, jumping ? 0 : 1, jumping ? 'jumping clears the ground wave' : 'ground wave hits a grounded player');
    if (!jumping) assert.ok(Math.abs(events.hits[0].damage - ICE_WHALE_DEF.damage * 0.8) < 1e-6);
  }
});

// ───────────── 原生骨架动画（美术身体）路径 ─────────────
// 按 creature_rigs/<asset>.json 的骨骼位置搭一副同名骨架（Blender (x, y, z) → 模型空间 (x, z, -y)），
// 用生产的 NativePose 驱动：步态 IK、蓄力 / 跳跃 / 炮击姿势全部跑一遍，检查数值有限、蹄子 / 鳍不穿地。
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
const { Fuzhu: NativeFuzhu } = await nativeEnemy('../src/enemies/types/Fuzhu.ts', '../art/pipeline/creature_rigs/SK_Enemy_Fuzhu.json');
const { IceWhale: NativeWhale } = await nativeEnemy('../src/enemies/types/IceWhale.ts', '../art/pipeline/creature_rigs/SK_Enemy_IceWhale.json');

function boneY(e, name) {
  const p = e.nativeBody.pose.hostPosition(name, new THREE.Vector3());
  assert.ok(Number.isFinite(p.x + p.y + p.z), `${name} position is finite`);
  return p.y;
}

test('fuzhu native skeleton: gait keeps planted hooves on the ground, charge lowers the horns, leap tucks the legs', () => {
  const { ctx } = makeCtx(new THREE.Vector3(0, 0, 30));
  const e = spawn(NativeFuzhu, ctx);
  assert.ok(e.nativeBody, 'native body attached');
  assert.equal(e.stars.length, 6, 'six horn-tip glows on the head bone');
  e.cooldown = 99;
  e.leapCd = 99;
  const hooves = ['fhoof_L', 'fhoof_R', 'hhoof_L', 'hhoof_R'];
  const rest = Object.fromEntries(hooves.map(h => [h, e.nativeBody.pose.restPosition(h).y]));
  let walked = 0, lowest = Infinity, lifted = 0;
  run(ctx, [e], 3, () => {
    walked = Math.max(walked, Math.hypot(e.velocity.x, e.velocity.z));
    for (const h of hooves) {
      const y = boneY(e, h);
      lowest = Math.min(lowest, y - rest[h]);
      lifted = Math.max(lifted, y - rest[h]);
    }
    return false;
  });
  assert.ok(walked > 2, `deer walks toward its band (${walked.toFixed(2)} m/s)`);
  assert.ok(lowest > -0.02, `fetlocks never sink below their rest height (${lowest.toFixed(3)})`);
  assert.ok(lifted > 0.04, `swing phase lifts the hooves (${lifted.toFixed(3)})`);
  // 蓄力：低头，角间光团变亮
  const headRest = e.nativeBody.pose.restPosition('head').y;
  ctx.player.position.set(0, 0, 16);
  e.position.set(0, 0, 0);
  e.cooldown = 0;
  run(ctx, [e], 2, () => e.state === 'charge');
  run(ctx, [e], 1.0);
  assert.ok(boneY(e, 'head') < headRest - 0.08, 'charging lowers the head to aim the horns');
  assert.ok(e.orb.material.uniforms.uAlpha.value > 0.4, 'the light between the horns builds up');
  run(ctx, [e], 0.4, () => e.state === 'recover');
  // 跳跃：前腿折起（腕关节抬高）
  ctx.player.position.set(0, 0, 4 + e.position.z);
  e.leapCd = 0;
  e.state = 'move';
  run(ctx, [e], 1.0, () => e.state === 'leap');
  run(ctx, [e], 0.3);
  const carpus = e.nativeBody.pose.hostPosition('fcannon_L', new THREE.Vector3()).y - e.nativeBody.pose.restPosition('fcannon_L').y;
  assert.ok(carpus > 0.05, `front legs fold during the leap (${carpus.toFixed(3)})`);
});

test('ice whale native skeleton: crawl plants the flippers, swell inflates the blowhole, rear lifts the front', () => {
  const { ctx } = makeCtx(new THREE.Vector3(0, 0, 40));
  const e = spawn(NativeWhale, ctx);
  assert.ok(e.nativeBody);
  e.cooldown = 99;
  e.slamCd = 99;
  const wristRest = e.nativeBody.pose.restPosition('hand_L').y;
  let lowest = Infinity, lifted = 0, moved = 0;
  const start = e.position.clone();
  run(ctx, [e], 4, () => {
    const y = boneY(e, 'hand_L') - wristRest;
    lowest = Math.min(lowest, y);
    lifted = Math.max(lifted, y);
    boneY(e, 'fluke');
    return false;
  });
  moved = e.position.distanceTo(start);
  assert.ok(moved > 2, `whale crawls toward its band (${moved.toFixed(2)} m in 4 s)`);
  assert.ok(lowest > -0.03, `planted flipper never sinks (${lowest.toFixed(3)})`);
  assert.ok(lifted > 0.1, `recovery stroke lifts the flipper (${lifted.toFixed(3)})`);
  ctx.player.position.set(0, 0, e.position.z + 16);
  e.cooldown = 0;
  run(ctx, [e], 3, () => e.state === 'swell');
  run(ctx, [e], 0.9);
  const hole = e.nativeBody.pose.bone('blowhole').scale.x;
  assert.ok(hole > 1.2, `blowhole swells (${hole.toFixed(2)})`);
  run(ctx, [e], 3);
  ctx.player.position.set(e.position.x, 0, e.position.z + 3.5);
  e.slamCd = 0;
  e.state = 'move';
  const headRest = e.nativeBody.pose.restPosition('head').y;
  run(ctx, [e], 1.5, () => e.state === 'rear');
  run(ctx, [e], 0.7);
  assert.ok(boneY(e, 'head') > headRest + 0.3, 'rear-up lifts the head and front body');
});
