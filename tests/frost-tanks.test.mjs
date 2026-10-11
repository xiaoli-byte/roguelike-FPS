// 第二章坦克（冰甲旋龟 xuangui、玄冰巨蟹 frost_crab）的无头回归：真实的 EnemyBase / StandardEnemy / 子类，
// 真实的碰撞世界、导航网格、任务调度与攻击令牌；只把美术接入（EnemyArt）、地面贴花（GroundDecal）、词缀换成记录用的桩，
// 玩家、特效、音效、伤害管线只记录调用。逐帧 update 走完主招式，并检查正面减伤 / 弱点规则。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

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
const tokensUrl = await tsModule('../src/enemies/AttackTokens.ts');
const levelsUrl = await tsModule('../src/enemies/Levels.ts');
const enemyBaseUrl = await tsModule('../src/enemies/EnemyBase.ts', { '../core/types': typesUrl, '../core/math': mathUrl });
const affixesUrl = dataModule('export const AFFIX_NAMES = {}; export function isAffixId() { return false; } export function createAffix() { return null; }');
const enemyArtUrl = dataModule('export function attachEnemyArt() { return { body: null, native: null, parts: [] }; }');
const standardUrl = await tsModule('../src/enemies/StandardEnemy.ts', {
  '../core/math': mathUrl, './EnemyBase': enemyBaseUrl, './AttackTokens': tokensUrl, './Affixes': affixesUrl,
  './Levels': levelsUrl, './Models': modelsUrl, '../assets/EnemyArt': enemyArtUrl,
});
// 地面贴花桩：记录每块贴花的形状与是否已归还
const visualsUrl = dataModule(`
  export const decals = [];
  export class GroundDecal {
    static acquire(parent, color) { const d = new GroundDecal(); d.color = color; d.released = false; decals.push(d); return d; }
    circle(x, y, z, outer, inner = 0, arcCenter = 0, arcHalf = Math.PI) { this.shape = { kind: 'circle', x, y, z, outer, inner, arcCenter, arcHalf }; return this; }
    rect(x, y, z, yaw, length, halfWidth) { this.shape = { kind: 'rect', x, y, z, yaw, length, halfWidth }; return this; }
    set opacity(v) {} set fill(v) { this._fill = v; } set time(v) {} set pattern(v) { this._pattern = v; } set soft(v) {}
    release() { this.released = true; }
  }
`);
const { decals } = await import(visualsUrl);
const fxUrl = await tsModule('../src/enemies/fx/FrostTankFx.ts', { '../bosses/Visuals': visualsUrl });
const deps = {
  '../../core/math': mathUrl, '../StandardEnemy': standardUrl, '../AttackTokens': tokensUrl, '../bosses/Visuals': visualsUrl,
  '../Models': modelsUrl, '../fx/FrostTankFx': fxUrl,
};
const { XuanGui, XUANGUI_DEF } = await import(await tsModule('../src/enemies/types/XuanGui.ts', deps));
const { FrostCrab, FROST_CRAB_DEF } = await import(await tsModule('../src/enemies/types/FrostCrab.ts', deps));
const { attackDirector } = await import(tokensUrl);
const { TaskRunner } = await import(await tsModule('../src/core/Tasks.ts'));
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { NavGrid } = await import(await tsModule('../src/world/NavGrid.ts', { '../core/math': mathUrl }));

const DT = 1 / 60;

/** 40 × 40 米的空场，四周 3 米高的墙；玩家站在 playerPos */
function arena(playerPos) {
  const events = { hits: [], impulses: [], modifiers: [] };
  const half = 20;
  const world = new CollisionWorld();
  world.addBox(-half, -0.2, -half, half, 0, half, 'floor');
  world.addBox(-half - 1, 0, -half - 1, half + 1, 3, -half, 'wall');
  world.addBox(-half - 1, 0, half, half + 1, 3, half + 1, 'wall');
  world.addBox(-half - 1, 0, -half, -half, 3, half, 'wall');
  world.addBox(half, 0, -half, half + 1, 3, half, 'wall');
  const player = {
    position: playerPos.clone(), velocity: new THREE.Vector3(), eye: new THREE.Vector3(), radius: 0.35, height: 1.8,
    alive: true, onGround: true, invulnerableTime: 0,
    applyImpulse: v => events.impulses.push(v.clone()), cameraPunch() {},
  };
  const ctx = {
    rng: { range: (a, b) => (a + b) / 2, sign: () => 1, chance: () => false, next: () => 0.5 },
    time: { now: 0, dt: DT }, player, world, scene: new THREE.Scene(), stageGroup: new THREE.Group(),
    tasks: new TaskRunner(), settings: { quality: 'high' }, renderer: null, run: { chapter: 1 },
    stage: { arena: { minX: -half, minZ: -half, maxX: half, maxZ: half, floorY: 0, center: new THREE.Vector3() } },
    audio: { play() {} },
    fx: { burst() {}, ring() {}, shake() {}, explosion() {}, spawnEffect() {}, groundWarning: () => () => {} },
    combat: {
      damagePlayer: (amount, element, source) => { events.hits.push({ amount, time: ctx.time.now, state: source?.state }); return amount; },
      addOutgoingModifier: fn => { events.modifiers.push(fn); return () => {}; },
    },
  };
  ctx.nav = new NavGrid(ctx);
  ctx.nav.build(ctx.stage.arena, 0.5);
  return { ctx, events };
}

function spawn(Type, playerPos, facing = 0) {
  attackDirector.reset();
  decals.length = 0;
  const { ctx, events } = arena(playerPos);
  const e = new Type(ctx, { position: new THREE.Vector3(0, 0, 0) });
  e.facing = facing;
  e.init();
  // 走完出生动画（出生时会转向玩家：走完后恢复测试指定的朝向）
  step(e, ctx, e.spawnDuration + DT);
  e.facing = facing;
  e.root.rotation.y = facing;
  return { e, ctx, events };
}

function step(e, ctx, seconds, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    ctx.time.now += DT;
    const p = ctx.player.position;
    ctx.player.eye.set(p.x, p.y + 1.6, p.z);
    e.update(DT);
    ctx.tasks.update(DT);
    each?.(i);
  }
}

/** 一次玩家射击的伤害请求：从 shooter 打向敌人 */
function shotFrom(e, shooter, headshot = false) {
  const dir = new THREE.Vector3().subVectors(e.position, shooter).setY(0).normalize();
  return { base: 10, element: 'none', source: 'weapon', direction: dir, headshot };
}

// ───────────── 冰甲旋龟 ─────────────

test('xuangui: the ice shell takes 15% from the front, full damage from behind, 40% while spinning, full while overheated', () => {
  const { e, events } = spawn(XuanGui, new THREE.Vector3(0, 0, 12));
  e.cooldown = 99; e.spinCd = 99;
  assert.equal(events.modifiers.length, 1, 'guard modifier registered once per context');
  const mod = events.modifiers[0];
  assert.equal(mod(e, shotFrom(e, new THREE.Vector3(0, 0, 12))), 0.15);
  assert.equal(mod(e, shotFrom(e, new THREE.Vector3(3, 0, 10))), 0.15, 'front cone is wide (cos 0.3)');
  assert.equal(mod(e, shotFrom(e, new THREE.Vector3(0, 0, -12))), 1, 'snake tail side is open');
  assert.equal(mod(e, shotFrom(e, new THREE.Vector3(12, 0, 0))), 1, 'flank is open');
  assert.equal(mod(e, { base: 5, element: 'fire', source: 'status' }), 1, 'DOTs ignore the shell');
  e.state = 'spin';
  assert.equal(mod(e, shotFrom(e, new THREE.Vector3(0, 0, -12))), 0.4);
  e.state = 'overheat';
  assert.equal(mod(e, shotFrom(e, new THREE.Vector3(0, 0, 12))), 1);
  // 弱点平时在身后的蛇头上
  const head = e.getHeadCenter(new THREE.Vector3());
  assert.ok(head.z < -1.5 && head.y > 1.5, `weak spot should sit on the snake head behind the shell: ${head.toArray()}`);
});

test('xuangui: shell spin telegraphs, slides at the player, bounces off walls, leaves ice and ends overheated with the vent as weak spot', () => {
  const { e, ctx, events } = spawn(XuanGui, new THREE.Vector3(0, 0, 14));
  e.cooldown = 99; e.spinCd = 0;
  const states = [];
  let firstSpinPos = null;
  step(e, ctx, 8, () => {
    if (states.at(-1) !== e.state) states.push(e.state);
    if (e.state === 'spin' && !firstSpinPos) firstSpinPos = e.position.clone();
  });
  const order = ['retract', 'spin', 'overheat', 'rightself', 'advance'];
  let at = 0;
  for (const s of states) if (s === order[at]) at++;
  assert.equal(at, order.length, `spin cycle out of order: ${states.join(' → ')}`);
  const spinHits = events.hits.filter(h => h.state === 'spin');
  assert.ok(spinHits.length >= 1, 'the spinning shell should run over a player standing on its line');
  assert.ok(Math.abs(spinHits[0].amount - XUANGUI_DEF.damage * 1.25) < 1e-6, `spin damage ${spinHits[0].amount}`);
  for (let i = 1; i < spinHits.length; i++) assert.ok(spinHits[i].time - spinHits[i - 1].time >= 0.8 - 1e-9, 'one hit per 0.8 s');
  assert.ok(events.impulses.some(v => Math.hypot(v.x, v.z) > 8 && v.y > 0), 'spin hit knocks the player away');
  const ice = decals.filter(d => d._pattern === 1 && d.shape?.kind === 'circle' && d.color === 0x9fe4ff);
  assert.ok(ice.length >= 4, `ice band patches dropped along the path: ${ice.length}`);
  // 停下后过热翻倒：散热孔（弱点）翻向玩家
  const { e: e2, ctx: c2 } = spawn(XuanGui, new THREE.Vector3(0, 0, 14));
  e2.cooldown = 99; e2.spinCd = 0;
  step(e2, c2, 5, () => {});
  for (let i = 0; i < 600 && e2.state !== 'overheat'; i++) step(e2, c2, DT);
  assert.equal(e2.state, 'overheat');
  step(e2, c2, 0.5);
  const toPlayer = new THREE.Vector3().subVectors(c2.player.position, e2.position).setY(0).normalize();
  const vent = e2.getHeadCenter(new THREE.Vector3()).sub(e2.position);
  assert.ok(vent.dot(toPlayer) > 0.8, `vent should face the player while overheated (along ${vent.dot(toPlayer).toFixed(2)} m)`);
  assert.equal(e2.guarding, false);
});

test('xuangui: shell spin bounces at most twice and stops on the third wall', () => {
  // 玩家贴着远墙：旋壳一路撞墙反弹（玩家站在墙角外侧，被弱追踪带着来回撞）
  const { e, ctx } = spawn(XuanGui, new THREE.Vector3(0, 0, 10));
  e.cooldown = 99; e.spinCd = 0;
  step(e, ctx, 1.0);
  assert.equal(e.state, 'spin');
  ctx.player.position.set(0, 30, 0); // 玩家飞到半空：不再被撞到，只看撞墙
  let maxBounces = 0;
  step(e, ctx, 4, () => { if (e.state === 'spin') maxBounces = Math.max(maxBounces, e.bounces); });
  assert.ok(maxBounces <= 3, `bounces ${maxBounces}`);
  assert.notEqual(e.state, 'spin', 'spin ends (third wall or time limit)');
});

test('xuangui: opens with its signature spin — a turtle spawned 13 m away spins before it has crawled inside 8 m', () => {
  const { e, ctx } = spawn(XuanGui, new THREE.Vector3(0, 0, 13));
  let retractAt = -1, dist = 0;
  step(e, ctx, 4, () => {
    if (retractAt < 0 && e.state === 'retract') { retractAt = e.age; dist = e.distToPlayerXZ(); }
  });
  assert.ok(retractAt > 0, `never started the spin (state ${e.state})`);
  assert.ok(retractAt - e.spawnDuration <= 2.0, `first spin comes early (${(retractAt - e.spawnDuration).toFixed(2)} s after spawning)`);
  assert.ok(dist >= 8, `spin starts from range, not after walking into peck range (${dist.toFixed(2)} m)`);
});

test('xuangui: a player hugging the beak gets spun too — after two pecks it backs off, telegraphs and spins from short range', () => {
  const { e, ctx, events } = spawn(XuanGui, new THREE.Vector3(0, 0, 3.0));
  e.spinCd = 0; e.biteCd = 99; e.cooldown = 0;
  const states = [];
  let backoffFrom = null, retractDist = 0, retractTime = 0;
  step(e, ctx, 12, () => {
    // 玩家贴着鸟喙不走（被啄退了就再贴上去）
    const fx = Math.sin(e.facing), fz = Math.cos(e.facing);
    if (e.state === 'advance' || e.state === 'peckWindup') ctx.player.position.set(e.position.x + fx * 3, 0, e.position.z + fz * 3);
    if (states.at(-1) !== e.state) {
      states.push(e.state);
      if (e.state === 'backoff') backoffFrom = e.position.clone();
      if (e.state === 'retract') retractDist = e.distToPlayerXZ();
    }
    if (e.state === 'retract') retractTime += DT;
  });
  const pecks = events.hits.filter(h => h.state === 'peck').length;
  const order = ['peck', 'peck', 'backoff', 'retract', 'spin'];
  let at = 0;
  for (const s of states) if (s === order[at]) at++;
  assert.equal(at, order.length, `close-range spin sequence: ${states.join(' → ')}`);
  assert.ok(pecks >= 2, `pecked twice first (${pecks})`);
  assert.ok(backoffFrom, 'backed off');
  assert.ok(retractDist > 4, `opened a gap before spinning (${retractDist.toFixed(2)} m)`);
  assert.ok(retractTime >= 0.75, `full 0.8 s shell telegraph before the spin (${retractTime.toFixed(2)} s)`);
  assert.ok(decals.some(d => d.shape?.kind === 'rect'), 'lane warning shown for the close spin');
});

test('xuangui: snake tail strikes a player lingering behind, beak pecks a player in front', () => {
  const { e, ctx, events } = spawn(XuanGui, new THREE.Vector3(0, 0, -3.4));
  e.cooldown = 99; e.spinCd = 99; e.biteCd = 0;
  step(e, ctx, 0.15);
  assert.equal(e.state, 'biteWindup');
  step(e, ctx, 0.5);
  assert.equal(events.hits.length, 1, 'bite lands');
  assert.ok(Math.abs(events.hits[0].amount - XUANGUI_DEF.damage * 0.7) < 1e-6);
  // 正面贴脸：猛啄
  const front = spawn(XuanGui, new THREE.Vector3(0, 0, 3.0));
  front.e.spinCd = 99; front.e.biteCd = 99; front.e.cooldown = 0;
  step(front.e, front.ctx, 0.1);
  assert.equal(front.e.state, 'peckWindup');
  step(front.e, front.ctx, 0.5);
  assert.equal(front.events.hits.length, 1, 'peck lands');
  assert.ok(Math.abs(front.events.hits[0].amount - XUANGUI_DEF.damage) < 1e-6);
  // 前摇里退开就躲过
  const dodge = spawn(XuanGui, new THREE.Vector3(0, 0, 3.0));
  dodge.e.spinCd = 99; dodge.e.biteCd = 99; dodge.e.cooldown = 0;
  step(dodge.e, dodge.ctx, 0.1);
  dodge.ctx.player.position.set(0, 0, 7);
  step(dodge.e, dodge.ctx, 0.5);
  assert.equal(dodge.events.hits.length, 0, 'stepping back out of the peck dodges it');
});

// ───────────── 玄冰巨蟹 ─────────────

test('frost_crab: claw wall takes 15% from the front, the back vent is open; shell break below 35% halves the wall and stops the grab', () => {
  const { e, ctx, events } = spawn(FrostCrab, new THREE.Vector3(0, 0, 12));
  const mod = events.modifiers[0];
  assert.equal(mod(e, shotFrom(e, new THREE.Vector3(0, 0, 12))), 0.15);
  assert.equal(mod(e, shotFrom(e, new THREE.Vector3(0, 0, -12))), 1);
  const vent = e.getHeadCenter(new THREE.Vector3());
  assert.ok(vent.z < -1.2, `weak spot is the back vent: ${vent.toArray()}`);
  e.hp = Math.floor(e.maxHp * 0.3);
  step(e, ctx, DT);
  assert.equal(e.state, 'shellBreak');
  assert.equal(e.broken, true);
  assert.equal(mod(e, shotFrom(e, new THREE.Vector3(0, 0, 12))), 1, 'no guard during the break');
  step(e, ctx, 1.0);
  assert.equal(e.state, 'advance');
  assert.equal(mod(e, shotFrom(e, new THREE.Vector3(0, 0, 12))), 0.5);
  assert.ok(e.speed > FROST_CRAB_DEF.speed * 1.3, 'faster after the claw breaks');
  ctx.player.position.set(0, 0, 3.2);
  e.grabCd = 0;
  const seen = new Set();
  step(e, ctx, 3, () => seen.add(e.state));
  assert.ok(!seen.has('grabWindup'), 'no grab without the big claw');
});

test('frost_crab: claw opens for 0.6 s then snaps shut on a player in front, flinging them; backing off dodges it', () => {
  const { e, ctx, events } = spawn(FrostCrab, new THREE.Vector3(0, 0, 3.2));
  e.grabCd = 0; e.sweepCd = 99;
  step(e, ctx, DT * 2);
  assert.equal(e.state, 'grabWindup');
  const sector = decals.find(d => d.shape?.kind === 'circle' && d.shape.arcHalf < Math.PI);
  assert.ok(sector, 'a front sector warning is shown');
  // 浅色冰面上看得见：饱和电光蓝 + 普通混合（之前是叠加的浅青，在冰面上只剩巨钳的影子）
  assert.equal(sector.solid, true, 'grab warning is drawn with normal blending, not additive');
  assert.equal(sector.color, 0x0e86ff, 'saturated electric-blue warning colour');
  step(e, ctx, 0.55);
  assert.equal(events.hits.length, 0, 'no damage before the 0.6 s telegraph ends');
  step(e, ctx, 0.1);
  assert.equal(events.hits.length, 1);
  assert.ok(Math.abs(events.hits[0].amount - FROST_CRAB_DEF.damage * 1.6) < 1e-6);
  const fling = events.impulses.at(-1);
  assert.ok(Math.hypot(fling.x, fling.z) > 10 && fling.y > 0, 'grabbed player is flung');
  assert.equal(e.struck, true);
  assert.ok(sector.released, 'warning is cleared');
  // 看到钳子张开就后撤
  const dodge = spawn(FrostCrab, new THREE.Vector3(0, 0, 3.2));
  dodge.e.grabCd = 0; dodge.e.sweepCd = 99;
  step(dodge.e, dodge.ctx, DT * 2);
  assert.equal(dodge.e.state, 'grabWindup');
  dodge.ctx.player.position.set(0, 0, 6.5);
  step(dodge.e, dodge.ctx, 0.8);
  assert.equal(dodge.events.hits.length, 0);
  assert.equal(dodge.e.struck, false);
});

test('frost_crab: small claw sweeps a flanking player with a ground ring that a jump clears', () => {
  const { e, ctx, events } = spawn(FrostCrab, new THREE.Vector3(4, 0, 0));
  e.grabCd = 99; e.sweepCd = 0;
  step(e, ctx, DT * 2);
  assert.equal(e.state, 'sweepWindup');
  step(e, ctx, 1.2);
  assert.equal(events.hits.length, 1);
  assert.ok(Math.abs(events.hits[0].amount - FROST_CRAB_DEF.damage * 0.75) < 1e-6);
  const jump = spawn(FrostCrab, new THREE.Vector3(4, 0, 0));
  jump.e.grabCd = 99; jump.e.sweepCd = 0;
  step(jump.e, jump.ctx, DT * 2);
  assert.equal(jump.e.state, 'sweepWindup');
  step(jump.e, jump.ctx, 0.48);
  jump.ctx.player.position.y = 1.2; // 起跳躲过冲击环
  step(jump.e, jump.ctx, 0.7);
  assert.equal(jump.events.hits.length, 0);
});

test('frost_crab: advances sideways with the claw toward the player', () => {
  const { e, ctx } = spawn(FrostCrab, new THREE.Vector3(0, 0, 15));
  e.grabCd = 99; e.sweepCd = 99;
  let lateral = 0, forward = 0;
  step(e, ctx, 2, () => {
    const fx = Math.sin(e.facing), fz = Math.cos(e.facing);
    forward += Math.abs(e.velocity.x * fx + e.velocity.z * fz);
    lateral += Math.abs(e.velocity.x * fz - e.velocity.z * fx);
  });
  assert.ok(lateral > forward * 1.5, `crab should mostly walk sideways (lateral ${lateral.toFixed(1)} vs forward ${forward.toFixed(1)})`);
  assert.ok(e.position.z > 0.5, 'and still closes in');
  assert.ok(e.facingDot() > 0.95, 'claw wall stays on the player');
});
