// 第三章坦克（熔炉铁牛 iron_ox、火鼍 tuo）的无头回归：真实的 EnemyBase / StandardEnemy / 子类，真实的碰撞世界、导航网格、
// 熔岩系统（LavaSystem）、任务调度与攻击令牌；只把美术接入（EnemyArt）、地面贴花（GroundDecal）、词缀换成记录用的桩，
// 玩家、特效、音效、伤害管线只记录调用。逐帧 update 走完主招式，并检查铁甲 / 炉门、岩甲 / 熔肉 / 潜熔的伤害规则。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

// 固定随机数（特效抖动、铁渣墙的高低、火点位置都用 Math.random）：每次跑都一样
let seed = 0x2f6e2b1;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
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
// 地面贴花桩：记录每块贴花的形状、颜色、混合方式与是否已归还
const visualsUrl = dataModule(`
  export const decals = [];
  export class GroundDecal {
    static acquire(parent, color) { const d = new GroundDecal(); d.color = color; d.released = false; d.solid = false; decals.push(d); return d; }
    circle(x, y, z, outer, inner = 0, arcCenter = 0, arcHalf = Math.PI) { this.shape = { kind: 'circle', x, y, z, outer, inner, arcCenter, arcHalf }; return this; }
    rect(x, y, z, yaw, length, halfWidth) { this.shape = { kind: 'rect', x, y, z, yaw, length, halfWidth }; return this; }
    set opacity(v) {} set fill(v) { this._fill = v; } set time(v) {} set pattern(v) { this._pattern = v; } set soft(v) {}
    release() { this.released = true; }
  }
`);
const { decals } = await import(visualsUrl);
const fxUrl = await tsModule('../src/enemies/fx/InfernoTankFx.ts', { '../bosses/Visuals': visualsUrl });
const swimUrl = await tsModule('../src/enemies/inferno/lavaSwim.ts');
const deps = {
  '../../core/math': mathUrl, '../StandardEnemy': standardUrl, '../AttackTokens': tokensUrl, '../bosses/Visuals': visualsUrl,
  '../Models': modelsUrl, '../fx/InfernoTankFx': fxUrl, '../inferno/lavaSwim': swimUrl,
};
const { IronOx, IRON_OX_DEF } = await import(await tsModule('../src/enemies/types/IronOx.ts', deps));
const { Tuo, TUO_DEF } = await import(await tsModule('../src/enemies/types/Tuo.ts', deps));
const { slagWalls, SLAG, INFERNO } = await import(fxUrl);
const { attackDirector } = await import(tokensUrl);
const { TaskRunner } = await import(await tsModule('../src/core/Tasks.ts'));
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { NavGrid } = await import(await tsModule('../src/world/NavGrid.ts', { '../core/math': mathUrl }));
const { LavaSystem, onLava } = await import(await tsModule('../src/world/Lava.ts'));

const DT = 1 / 60;
const HALF = 20;

/** 熔岩渠：z ∈ [z0, z1) 横贯整个场地（每格 1 米） */
function lavaChannel(z0, z1) {
  const cols = HALF * 2, rows = HALF * 2, mask = new Uint8Array(cols * rows);
  for (let z = 0; z < rows; z++) for (let x = 0; x < cols; x++) {
    const wz = -HALF + z + 0.5;
    if (wz >= z0 && wz < z1) mask[z * cols + x] = 1;
  }
  return { minX: -HALF, minZ: -HALF, cols, rows, cell: 1, mask, rects: [{ minX: -HALF, minZ: z0, maxX: HALF, maxZ: z1 }] };
}

/** 40 × 40 米的空场，四周 3 米高的墙；可选一条熔岩渠（真实 LavaSystem + 导航把熔岩当阻挡） */
function arena(playerPos, lava = null) {
  const events = { hits: [], impulses: [], modifiers: [], knocks: [] };
  const world = new CollisionWorld();
  world.addBox(-HALF, -0.2, -HALF, HALF, 0, HALF, 'floor');
  world.addBox(-HALF - 1, 0, -HALF - 1, HALF + 1, 3, -HALF, 'wall');
  world.addBox(-HALF - 1, 0, HALF, HALF + 1, 3, HALF + 1, 'wall');
  world.addBox(-HALF - 1, 0, -HALF, -HALF, 3, HALF, 'wall');
  world.addBox(HALF, 0, -HALF, HALF + 1, 3, HALF, 'wall');
  const player = {
    position: playerPos.clone(), velocity: new THREE.Vector3(), eye: new THREE.Vector3(), radius: 0.35, height: 1.8,
    alive: true, onGround: true, invulnerableTime: 0, maxHp: () => 100,
    applyImpulse: v => events.impulses.push(v.clone()), cameraPunch() {}, teleport(p) { player.position.copy(p); },
  };
  const ctx = {
    rng: { range: (a, b) => (a + b) / 2, sign: () => 1, chance: () => false, next: () => 0.5 },
    time: { now: 0, dt: DT }, player, world, scene: new THREE.Scene(), stageGroup: new THREE.Group(),
    tasks: new TaskRunner(), settings: { quality: 'high' }, renderer: null, run: { chapter: 2 },
    enemies: { list: [] },
    stage: { arena: { minX: -HALF, minZ: -HALF, maxX: HALF, maxZ: HALF, floorY: 0, center: new THREE.Vector3() }, lavaSystem: null },
    audio: { play() {} },
    fx: { burst() {}, ring() {}, shake() {}, explosion() {}, spawnEffect() {}, groundWarning: () => () => {} },
    combat: {
      damagePlayer: (amount, element, source) => { events.hits.push({ amount, element, time: ctx.time.now, state: source?.state }); return amount; },
      damageEnemy: () => null,
      addOutgoingModifier: fn => { events.modifiers.push(fn); return () => {}; },
    },
  };
  ctx.nav = new NavGrid(ctx);
  if (lava) ctx.nav.setLava(lava);
  ctx.nav.build(ctx.stage.arena, 0.5);
  if (lava) ctx.stage.lavaSystem = new LavaSystem(ctx, lava, 0, { x: 0, z: -12 });
  return { ctx, events };
}

function spawn(Type, playerPos, { facing = 0, at = new THREE.Vector3(), lava = null } = {}) {
  attackDirector.reset();
  decals.length = 0;
  for (const w of [...slagWalls]) w.shatter();
  const { ctx, events } = arena(playerPos, lava);
  const e = new Type(ctx, { position: at.clone() });
  e.facing = facing;
  e.init();
  ctx.enemies.list.push(e);
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
    ctx.stage.lavaSystem?.update(DT, ctx.time.now);
    each?.(i);
  }
}

/** 一次玩家射击的伤害请求：从 shooter 打向敌人（可带命中点、爆头） */
function shotFrom(e, shooter, { headshot = false, point } = {}) {
  const dir = new THREE.Vector3().subVectors(e.position, shooter).setY(0).normalize();
  return { base: 10, element: 'none', source: 'weapon', direction: dir, headshot, point };
}

/** 跑到某个状态（最多 seconds 秒），返回经过的状态序列 */
function runUntil(e, ctx, state, seconds, each) {
  const seen = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n && e.state !== state; i++) {
    step(e, ctx, DT, each);
    if (seen.at(-1) !== e.state) seen.push(e.state);
  }
  return seen;
}

function inOrder(states, order) {
  let at = 0;
  for (const s of states) if (s === order[at]) at++;
  return at === order.length;
}

// ───────────── 熔炉铁牛 ─────────────

test('iron_ox: iron armour takes 20% everywhere (closed door too); the open furnace door takes x3; DOTs ignore it', () => {
  const { e, events } = spawn(IronOx, new THREE.Vector3(0, 0, 12));
  e.cooldown = 99; e.inhaleCd = 99;
  assert.equal(events.modifiers.length, 1, 'armour modifier registered once per context');
  const mod = events.modifiers[0];
  const front = new THREE.Vector3(0, 0, 12);
  assert.equal(mod(e, shotFrom(e, front)), 0.2);
  assert.equal(mod(e, shotFrom(e, new THREE.Vector3(0, 0, -12))), 0.2, 'no soft back: the weak spot is in FRONT');
  assert.equal(mod(e, shotFrom(e, front, { headshot: true })), 0.2, 'closed door is iron too');
  assert.equal(mod(e, { base: 5, element: 'fire', source: 'status' }), 1, 'DOTs ignore the iron');
  // 弱点在胸口正面、比背低得多
  const door = e.getHeadCenter(new THREE.Vector3());
  assert.ok(door.z > 0.9 && door.y > 0.8 && door.y < 1.6, `weak spot should sit on the chest front: ${door.toArray()}`);
  e.state = 'inhale'; e.stateTime = 0.5;
  assert.equal(e.doorOpen, true);
  assert.equal(mod(e, shotFrom(e, front, { headshot: true })), 3, 'open furnace door x3');
  assert.equal(mod(e, shotFrom(e, front)), 0.2, 'body still iron while inhaling');
  // 身体命中盒覆盖到背（头部判定在胸口，不能用基类按头高算的矮胶囊）
  const hit = { distance: 0, headshot: false };
  assert.ok(e.raycastHit(new THREE.Vector3(-10, 3, 0), new THREE.Vector3(1, 0, 0), 30, hit), 'a shot at the hump (3 m) hits');
  assert.equal(hit.headshot, false);
});

test('iron_ox: inhale pulls the player in and opens the door; uninterrupted it spits a 60° molten fan that cools into slag walls (real collision, 6 s)', () => {
  const { e, ctx, events } = spawn(IronOx, new THREE.Vector3(0, 0, 10));
  e.cooldown = 99; e.inhaleCd = 0;
  runUntil(e, ctx, 'inhale', 1); // 视线缓存刷新后才开始吸
  assert.equal(e.state, 'inhale');
  const fan = decals.find(d => d.shape?.kind === 'circle' && d.shape.arcHalf < Math.PI && d.color === INFERNO.warn);
  assert.ok(fan && fan.solid, 'spit fan warning (solid magenta) shown during the inhale');
  assert.ok(Math.abs(fan.shape.outer - 12) < 1e-6 && Math.abs(fan.shape.arcHalf - Math.PI / 6) < 1e-6, '12 m, 60° fan');
  let openRadius = 0;
  step(e, ctx, 1.0, () => { openRadius = Math.max(openRadius, e.headRadius); });
  const pulls = events.impulses.filter(v => v.z < -0.5 && Math.abs(v.x) < 0.2);
  assert.ok(pulls.length >= 4, `player pulled toward the ox (${pulls.length} pulses)`);
  assert.ok(openRadius > IRON_OX_DEF.headRadius * IRON_OX_DEF.scale * 1.5, 'door weak spot opens wide');
  const boxesBefore = ctx.world.boxes.length;
  const seen = runUntil(e, ctx, 'advance', 3);
  assert.ok(inOrder(seen, ['spitWindup', 'spit', 'advance']), `spit cycle: ${seen.join(' → ')}`);
  const spitHit = events.hits.find(h => h.state === 'spit');
  assert.ok(spitHit, 'the molten fan hits a player standing in it');
  assert.ok(Math.abs(spitHit.amount - IRON_OX_DEF.damage * 1.3) < 1e-6 && spitHit.element === 'fire', `spit damage ${spitHit.amount}`);
  assert.ok(e.walls.length >= 3, `slag walls raised (${e.walls.length})`);
  assert.ok(ctx.world.boxes.length > boxesBefore, 'walls add collision boxes');
  // 墙挡子弹 / 视线：从铁牛身前穿过第一排墙的线被挡住
  const w = e.walls[0].boxes[0];
  const a = new THREE.Vector3((w.minX + w.maxX) / 2, 0.8, w.minZ - 2), b = new THREE.Vector3((w.minX + w.maxX) / 2, 0.8, w.maxZ + 2);
  assert.ok(ctx.world.segmentBlocked(a, b), 'slag wall blocks shots');
  // 墙不会把玩家关在里面
  const p = ctx.player.position;
  for (const wall of e.walls) for (const box of wall.boxes) {
    assert.ok(!(p.x + 0.35 > box.minX && p.x - 0.35 < box.maxX && p.z + 0.35 > box.minZ && p.z - 0.35 < box.maxZ), 'no wall box inside the player');
  }
  step(e, ctx, SLAG.life + 0.2);
  assert.ok(e.walls.every(x => !x.alive), 'walls crumble after 6 s');
  assert.equal(ctx.world.boxes.length, boxesBefore, 'their boxes are removed');
  assert.ok(!ctx.world.segmentBlocked(a, b));
});

test('iron_ox: shooting into the open furnace for 8% max HP chokes it — it kneels 2.5 s with the door open and does not spit', () => {
  const { e, ctx, events } = spawn(IronOx, new THREE.Vector3(0, 0, 10));
  e.cooldown = 99; e.inhaleCd = 0;
  runUntil(e, ctx, 'inhale', 1);
  step(e, ctx, 0.4);
  assert.equal(e.state, 'inhale');
  assert.equal(e.doorOpen, true);
  const point = e.getHeadCenter(new THREE.Vector3());
  const req = { base: 50, element: 'none', source: 'weapon', headshot: true, point };
  e.onDamaged({ request: req, dealt: e.maxHp * 0.05, isCrit: true, killed: false });
  assert.equal(e.state, 'inhale', 'not yet');
  e.onDamaged({ request: { ...req, headshot: false }, dealt: e.maxHp * 0.05, isCrit: false, killed: false });
  assert.equal(e.state, 'inhale', 'body hits do not count toward the choke');
  e.onDamaged({ request: req, dealt: e.maxHp * 0.035, isCrit: true, killed: false });
  assert.equal(e.state, 'choke', 'choked by 8.5% through the door');
  step(e, ctx, 1.2);
  assert.equal(e.state, 'choke');
  assert.equal(e.doorOpen, true, 'door stays open while it kneels');
  assert.equal(events.modifiers[0](e, shotFrom(e, new THREE.Vector3(0, 0, 10), { headshot: true })), 3);
  step(e, ctx, 1.5);
  assert.equal(e.state, 'advance', 'gets back up after 2.5 s');
  assert.equal(events.hits.length, 0, 'the choked inhale never spits');
  assert.ok(e.inhaleCd > 5, 'inhale goes on cooldown');
});

test('iron_ox: horn toss flings a player hugging its face; stepping back during the 0.5 s windup dodges', () => {
  const { e, ctx, events } = spawn(IronOx, new THREE.Vector3(0, 0, 3.6));
  e.cooldown = 0; e.inhaleCd = 99;
  step(e, ctx, DT * 2);
  assert.equal(e.state, 'tossWindup');
  assert.ok(decals.some(d => d.solid && d.color === INFERNO.warn && d.shape?.arcHalf < Math.PI), 'front sector warning');
  step(e, ctx, 0.45);
  assert.equal(events.hits.length, 0, 'no damage before the windup ends');
  step(e, ctx, 0.15);
  assert.equal(events.hits.length, 1);
  assert.ok(Math.abs(events.hits[0].amount - IRON_OX_DEF.damage * 1.2) < 1e-6);
  assert.ok(events.impulses.at(-1).y >= 9, 'tossed up');
  const dodge = spawn(IronOx, new THREE.Vector3(0, 0, 3.6));
  dodge.e.cooldown = 0; dodge.e.inhaleCd = 99;
  step(dodge.e, dodge.ctx, DT * 2);
  dodge.ctx.player.position.set(0, 0, 8);
  step(dodge.e, dodge.ctx, 0.7);
  assert.equal(dodge.events.hits.length, 0);
});

test('iron_ox: walks through small fry, shoving them aside', () => {
  const { e, ctx } = spawn(IronOx, new THREE.Vector3(0, 0, 15));
  e.cooldown = 99; e.inhaleCd = 99;
  const knocks = [];
  const grunt = { alive: true, flying: false, isBoss: false, maxHp: 60, radius: 0.4, height: 1.7, position: new THREE.Vector3(0, 0, 2.2), velocity: new THREE.Vector3(), knockback: v => knocks.push(v.clone()) };
  ctx.enemies.list.push(grunt);
  step(e, ctx, 1.5);
  assert.ok(knocks.length > 0 && knocks.some(v => Math.abs(v.x) > 3), 'grunt in its path is shoved sideways');
});

// ───────────── 火鼍 ─────────────

test('tuo: intact basalt plates take 25%, a broken plate exposes molten flesh (x2), the spine seam 50%, and it takes 50% while submerged', () => {
  const { e, ctx, events } = spawn(Tuo, new THREE.Vector3(0, 0, 12));
  step(e, ctx, DT * 2);
  assert.equal(e.state, 'land', 'no lava in the room: it fights on land');
  const mod = events.modifiers[0];
  const from = new THREE.Vector3(0, 6, 12);
  const c3 = e.plateCenter(3, new THREE.Vector3());
  assert.equal(e.plateAt(c3), 3);
  assert.equal(mod(e, shotFrom(e, from, { point: c3 })), 0.25, 'intact plate');
  assert.equal(mod(e, shotFrom(e, from)), 0.25, 'body');
  assert.equal(mod(e, shotFrom(e, from, { headshot: true })), 0.5, 'spine seam');
  assert.equal(mod(e, { base: 5, element: 'fire', source: 'status' }), 1);
  // 集火一块甲：减伤前累计 10% 最大生命就碎
  const per = e.maxHp * 0.1 * 0.25;
  e.onDamaged({ request: { base: 10, element: 'none', source: 'weapon', point: c3 }, dealt: per * 0.6, isCrit: false, killed: false });
  assert.equal(e.broken[3], false);
  e.onDamaged({ request: { base: 10, element: 'none', source: 'weapon', point: c3 }, dealt: per * 0.5, isCrit: false, killed: false });
  assert.equal(e.broken[3], true, 'plate 3 breaks');
  assert.equal(e.plateHeat[3], 1, 'that shader region turns to glowing flesh');
  assert.equal(e.brokenCount, 1);
  assert.equal(mod(e, shotFrom(e, from, { point: c3 })), 2, 'molten flesh x2');
  const c0 = e.plateCenter(0, new THREE.Vector3());
  assert.equal(mod(e, shotFrom(e, from, { point: c0 })), 0.25, 'other plates still armoured');
  // 潜熔：一律减半；熔岩面以下打不到，露出来的脊背打得到
  e.state = 'swim';
  assert.equal(e.submerged, true);
  assert.equal(mod(e, shotFrom(e, from, { point: c3 })), 0.5);
  const hit = { distance: 0, headshot: false };
  assert.equal(e.raycastHit(new THREE.Vector3(-10, 0.03, 0.3), new THREE.Vector3(1, 0, 0), 30, hit), false, 'nothing below the lava surface');
  assert.equal(e.raycastHit(new THREE.Vector3(0, 10, 0.3), new THREE.Vector3(0, -1, 0), 30, hit), true, 'the back above the lava is hittable');
  // 长身体：头和尾巴都有命中盒
  e.state = 'land';
  assert.equal(e.raycastHit(new THREE.Vector3(-10, 1.1, 1.7), new THREE.Vector3(1, 0, 0), 30, hit), true, 'snout');
  assert.equal(e.raycastHit(new THREE.Vector3(-10, 0.9, -2.2), new THREE.Vector3(1, 0, 0), 30, hit), true, 'tail');
});

test('tuo: slides into the lava channel and swims in it (LavaSystem leaves it alone), surfaces with bubbles and lunges ashore to bite for x1.5', () => {
  const lava = lavaChannel(4, 9);
  const { e, ctx, events } = spawn(Tuo, new THREE.Vector3(8, 0, 15), { at: new THREE.Vector3(-6, 0, 1.5), lava });
  assert.equal(e.swimsInLava, true);
  const seen = runUntil(e, ctx, 'swim', 6);
  assert.equal(e.state, 'swim', `entered the lava (${seen.join(' → ')})`);
  assert.ok(onLava(lava, e.position.x, e.position.z), 'standing on lava');
  // 在熔岩里游向玩家那一侧的岸，不被 LavaSystem 拉回岸上
  let maxLavaRun = 0, run = 0, lane = null;
  const states = [];
  step(e, ctx, 6, () => {
    if (states.at(-1) !== e.state) states.push(e.state);
    run = onLava(lava, e.position.x, e.position.z) ? run + 1 : 0;
    maxLavaRun = Math.max(maxLavaRun, run);
    lane ??= decals.find(d => d.shape?.kind === 'rect' && d.solid && d.color === INFERNO.warn);
  });
  assert.ok(maxLavaRun * DT > 0.8, `swam in the lava for ${(maxLavaRun * DT).toFixed(2)} s without being pushed out`);
  assert.ok(inOrder(states, ['swim', 'surge', 'lunge', 'bite', 'land']), `ambush cycle: ${states.join(' → ')}`);
  assert.ok(lane, 'lunge lane warning (solid magenta) during the bubbling');
  const bite = events.hits.find(h => h.state === 'bite');
  assert.ok(bite, 'ambush bite lands');
  assert.ok(Math.abs(bite.amount - TUO_DEF.damage * 1.5) < 1e-6, `ambush bite x1.5 (${bite.amount})`);
  assert.ok(!onLava(lava, e.position.x, e.position.z) && e.position.z > 9, 'lunged ashore');
});

test('tuo: tail sweep hits a player at its flank and knocks them toward the nearest lava; a jump clears it', () => {
  const lava = lavaChannel(4, 9);
  // 火鼍在南岸、背对熔岩（朝 -Z），玩家在它身后侧
  const { e, ctx, events } = spawn(Tuo, new THREE.Vector3(1.5, 0, 2.6), { at: new THREE.Vector3(0, 0, 0), facing: Math.PI, lava });
  e.state = 'land'; e.biteCd = 99; e.sweepCd = 0; e.ambushCd = 99;
  step(e, ctx, DT * 2);
  assert.equal(e.state, 'sweepWindup');
  assert.ok(decals.some(d => d.solid && d.color === INFERNO.warn && d.shape?.kind === 'circle' && Math.abs(d.shape.arcHalf - Math.PI / 2) < 1e-6), 'rear half-circle warning');
  step(e, ctx, 0.7);
  const hit = events.hits.find(h => h.state === 'sweep');
  assert.ok(hit, 'sweep lands');
  assert.ok(Math.abs(hit.amount - TUO_DEF.damage * 0.8) < 1e-6);
  const k = events.impulses.at(-1);
  assert.ok(k.z > 6 && k.y > 0, `knocked toward the lava channel (north): ${k.toArray().map(v => v.toFixed(1))}`);
  const jump = spawn(Tuo, new THREE.Vector3(1.5, 0, 2.6), { at: new THREE.Vector3(0, 0, 0), facing: Math.PI, lava });
  jump.e.state = 'land'; jump.e.biteCd = 99; jump.e.sweepCd = 0; jump.e.ambushCd = 99;
  step(jump.e, jump.ctx, DT * 2);
  jump.ctx.player.position.y = 1.2;
  step(jump.e, jump.ctx, 0.7);
  assert.equal(jump.events.hits.filter(h => h.state === 'sweep').length, 0, 'jumping clears the sweep');
});

test('tuo: with 3 plates broken it crawls back into the lava and regrows them within 5 s (red, then black)', () => {
  const lava = lavaChannel(4, 9);
  const { e, ctx } = spawn(Tuo, new THREE.Vector3(10, 0, -12), { at: new THREE.Vector3(0, 0, 0.5), lava });
  e.state = 'land'; e.biteCd = 99; e.sweepCd = 99; e.ambushCd = 99;
  for (const i of [0, 3, 5]) {
    const c = e.plateCenter(i, new THREE.Vector3());
    e.onDamaged({ request: { base: 10, element: 'none', source: 'weapon', point: c }, dealt: e.maxHp, isCrit: false, killed: false });
  }
  e.hp = e.maxHp; // 测试只看甲
  assert.equal(e.brokenCount, 3);
  const seen = runUntil(e, ctx, 'regrow', 6);
  assert.equal(e.state, 'regrow', `went back to the lava (${seen.join(' → ')})`);
  assert.ok(seen.includes('toLava'));
  step(e, ctx, 2.5);
  const mid = e.plateHeat[3];
  assert.ok(mid > 0.05 && mid < 0.95, `plate cooling from molten to crust (${mid.toFixed(2)})`);
  step(e, ctx, 2.7);
  assert.equal(e.brokenCount, 0, 'plates regrown');
  assert.ok(e.plateHeat.every(h => h === 0));
  assert.notEqual(e.state, 'regrow');
});

test('tuo: on land it bites a player in front; backing off during the windup dodges', () => {
  const { e, ctx, events } = spawn(Tuo, new THREE.Vector3(0, 0, 3.0));
  step(e, ctx, DT);
  e.biteCd = 0; e.sweepCd = 99;
  step(e, ctx, DT * 2);
  assert.equal(e.state, 'biteWindup');
  step(e, ctx, 0.5);
  assert.equal(events.hits.length, 1);
  assert.ok(Math.abs(events.hits[0].amount - TUO_DEF.damage) < 1e-6);
  const dodge = spawn(Tuo, new THREE.Vector3(0, 0, 3.0));
  step(dodge.e, dodge.ctx, DT);
  dodge.e.biteCd = 0; dodge.e.sweepCd = 99;
  step(dodge.e, dodge.ctx, DT * 2);
  dodge.ctx.player.position.set(0, 0, 8);
  step(dodge.e, dodge.ctx, 0.5);
  assert.equal(dodge.events.hits.length, 0);
});

test('tuo: below 40% HP it roars once — a jumpable ground shockwave and burning spots on the banks', () => {
  const lava = lavaChannel(4, 9);
  const { e, ctx, events } = spawn(Tuo, new THREE.Vector3(0, 0, -5), { at: new THREE.Vector3(0, 0, 0.5), lava });
  e.state = 'land'; e.biteCd = 99; e.sweepCd = 99; e.ambushCd = 99;
  e.hp = Math.floor(e.maxHp * 0.35);
  step(e, ctx, DT * 2);
  assert.equal(e.state, 'roar');
  step(e, ctx, 1.4);
  const wave = events.hits.find(h => h.state === 'roar');
  assert.ok(wave && wave.element === 'fire', 'shockwave hits a grounded player');
  assert.ok(decals.filter(d => d._pattern === 1 && d.color === INFERNO.lava).length >= 3, 'burning spots splashed around');
  // 只吼一次
  step(e, ctx, 3);
  assert.equal(events.hits.filter(h => h.state === 'roar').length, 1);
});
