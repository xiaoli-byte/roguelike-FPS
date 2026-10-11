/**
 * 第二章辅助位（九尾狐巫 + 冰壁 + 铜镜、冰灯水母）的玩法回归：用真实的 EnemyBase / StandardEnemy / CollisionWorld，
 * 只把美术接入、词缀、高台换成桩，在一个最小的 GameContext 里逐帧推进。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function tsModule(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return dataModule(stripTypeScriptTypes(source, { mode: 'transform' }));
}

const mathUrl = await tsModule('../src/core/math.ts');
const typesUrl = await tsModule('../src/core/types.ts');
const enemyBaseUrl = await tsModule('../src/enemies/EnemyBase.ts', { '../core/types': typesUrl, '../core/math': mathUrl });
const tokensUrl = await tsModule('../src/enemies/AttackTokens.ts');
const modelsUrl = await tsModule('../src/enemies/Models.ts', { '../core/math': mathUrl });
const hazardsUrl = await tsModule('../src/enemies/Hazards.ts', { '../core/math': mathUrl });
const buffsUrl = await tsModule('../src/enemies/SupportBuffs.ts');
const visualsUrl = await tsModule('../src/enemies/bosses/Visuals.ts');
const fxUrl = await tsModule('../src/enemies/fx/FrostSupportFx.ts');
// 美术接入 / 词缀 / 高台：桩（玩法不依赖它们）
const artStub = dataModule('export function attachEnemyArt(o) { const n = globalThis.__frostNative?.(o.host, o.defId) ?? null; return { body: n, native: n, parts: [] }; }');
const affixStub = dataModule("export const AFFIX_NAMES = {}; export function createAffix() { return null; } export function isAffixId() { return false; }");
const levelsStub = dataModule('export function levelAt() {} export function playerLevel() { return { route: null, onTop: false }; }');
const standardUrl = await tsModule('../src/enemies/StandardEnemy.ts', {
  '../core/math': mathUrl, './EnemyBase': enemyBaseUrl, './AttackTokens': tokensUrl, './Affixes': affixStub,
  './Levels': levelsStub, './Models': modelsUrl, '../assets/EnemyArt': artStub,
});
const shared = {
  '../../core/math': mathUrl, '../StandardEnemy': standardUrl, '../EnemyBase': enemyBaseUrl, '../AttackTokens': tokensUrl,
  '../SupportBuffs': buffsUrl, '../bosses/Visuals': visualsUrl, '../Models': modelsUrl, '../fx/FrostSupportFx': fxUrl,
  '../Hazards': hazardsUrl,
};
const foxUrl = await tsModule('../src/enemies/types/FoxWitch.ts', shared);
const fox = await import(foxUrl);
const jelly = await import(await tsModule('../src/enemies/types/LanternJelly.ts', { ...shared, './FoxWitch': foxUrl }));
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { NativePose } = await import(await tsModule('../src/assets/NativeRig.ts', {
  'three/addons/utils/SkeletonUtils.js': new URL('../node_modules/three/examples/jsm/utils/SkeletonUtils.js', import.meta.url).href,
}));
const { attackDirector } = await import(tokensUrl);
const { chillPlayer, CHILL_SOURCE, bodyCrossesSegment } = await import(fxUrl);
const { FoxWitch, FoxIceWall, frostArmor, planIceWall, iceWallBoxes, ICE_WALL_ID, MIRROR_BREAK, WALL, TAIL_IDS } = fox;
const { LanternJelly, LINK } = jelly;

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const close = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b}`);

/** 玩家属性：只实现 moveSpeed 的加减（按来源） */
function makeStats(base) {
  const src = new Map();
  return {
    get(k) {
      let v = k === 'moveSpeed' ? base : 0;
      for (const m of src.values()) v += m.get(k) ?? 0;
      return v;
    },
    add(k, v, s) {
      if (!src.has(s)) src.set(s, new Map());
      const m = src.get(s);
      m.set(k, (m.get(k) ?? 0) + v);
    },
    removeSource(s) { src.delete(s); },
    has(s) { return src.has(s); },
  };
}

let nextAllyId = 10000;
/** 最小游戏上下文：真实碰撞世界（一块地板），敌人列表、玩家、战斗只记录调用 */
function makeCtx() {
  const world = new CollisionWorld();
  world.addBox(-80, -1, -80, 80, 0, 80, 'floor');
  const list = [];
  const tasks = [];
  const playerPos = V(0, 0, 30);
  const factories = {};
  const ctx = {
    scene: new THREE.Scene(), stageGroup: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    world,
    rng: { range: (a, b) => (a + b) / 2, sign: () => 1, int: (a) => a, chance: () => false, next: () => 0.5 },
    tasks: { delay(s, fn) { tasks.push({ at: ctx.time.now + s, fn }); return () => {}; } },
    time: { now: 0, dt: 1 / 60, timeScale: 1, frame: 0 },
    settings: { quality: 'high' },
    renderer: null,
    run: { chapter: 1, difficulty: 1 },
    stage: { arena: { floorY: 0, center: V(0, 0, 0) }, stage: null },
    nav: {
      isWalkable: () => true, findPath: () => false, nearestWalkable: (p, out) => out.copy(p), platformAt: () => false,
      randomWalkable: (c, a, b, out) => { out.set(c.x + a, c.y, c.z); return true; },
    },
    player: {
      position: playerPos, velocity: V(0, 0, 0), get eye() { return V(playerPos.x, playerPos.y + 1.6, playerPos.z); },
      alive: true, radius: 0.4, height: 1.8, stats: makeStats(7.5), invulnerableTime: 0, applyImpulse() {},
    },
    enemies: {
      list,
      spawn(id, opts) {
        const f = factories[id];
        if (!f) return null;
        const e = f(ctx, opts);
        e.init();
        list.push(e);
        return e;
      },
      queryRadius(c, r, out = []) {
        out.length = 0;
        const b = V(0, 0, 0);
        for (const e of list) {
          if (!e.alive) continue;
          e.getBodyCenter(b);
          if (b.distanceTo(c) <= r + e.radius) out.push(e);
        }
        return out;
      },
      aliveCount: () => list.filter((e) => e.alive).length,
    },
    combat: {
      mods: [], dealt: [],
      addOutgoingModifier(fn) { this.mods.push(fn); return () => {}; },
      damagePlayer(a) { this.dealt.push(a); return a; },
    },
    projectiles: { shots: [], spawn(s) { this.shots.push(s); } },
    fx: new Proxy({}, { get: (_, k) => (k === 'groundWarning' || k === 'beam' ? () => () => {} : () => {}) }),
    audio: { play() {} },
  };
  factories[ICE_WALL_ID] = (c, o) => new FoxIceWall(c, o);
  ctx.add = (Cls, pos) => {
    const e = new Cls(ctx, { position: pos, level: 1 });
    e.init();
    list.push(e);
    return e;
  };
  /** 一个站着不动的同伴（只实现辅助怪会读写的字段） */
  ctx.ally = (x, z, hp = 50, id = 'grunt') => {
    const a = {
      id: nextAllyId++, def: { id }, alive: true, removed: false, isBoss: false, flying: false,
      position: V(x, 0, z), velocity: V(0, 0, 0), radius: 0.5, height: 1.8, hp, maxHp: 100, damageMult: 1, attackRate: 1, speedMult: 1,
      getBodyCenter(out) { return out.set(this.position.x, this.position.y + 0.9, this.position.z); },
      update() {}, dispose() {},
    };
    list.push(a);
    return a;
  };
  ctx.step = (seconds, dt = 1 / 60) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      ctx.time.now += dt;
      ctx.time.dt = dt;
      ctx.time.frame++;
      for (const e of [...list]) if (!e.removed) e.update(dt);
      for (let i = tasks.length - 1; i >= 0; i--) {
        if (tasks[i].at <= ctx.time.now) {
          const [task] = tasks.splice(i, 1);
          task.fn();
        }
      }
      for (let i = list.length - 1; i >= 0; i--) if (list[i].removed) list.splice(i, 1)[0].dispose();
    }
  };
  attackDirector.reset();
  return ctx;
}

// ───────────── 冰灯水母 ─────────────

test('lantern jelly links the three most wounded allies within 12 m and heals each 4% max HP per second', () => {
  const ctx = makeCtx();
  const j = ctx.add(LanternJelly, V(0, 1, 0));
  j.shockCd = 99;
  const a = ctx.ally(4, 0, 50), b = ctx.ally(0, 6, 80), c = ctx.ally(-5, 3, 20), d = ctx.ally(0, -8, 10);
  const far = ctx.ally(20, 0, 10);
  const wall = ctx.ally(3, -3, 5, ICE_WALL_ID);
  ctx.step(1.5);
  const linked = new Set(j.links.map((l) => l.ally));
  assert.equal(j.links.length, LINK.max);
  assert.ok(linked.has(d) && linked.has(c) && linked.has(a), 'the three lowest-HP allies in range are linked');
  assert.ok(!linked.has(b) && !linked.has(far) && !linked.has(wall), 'healthiest ally, far ally and ice walls are not linked');
  const before = [a.hp, c.hp, d.hp];
  ctx.step(2);
  close(a.hp - before[0], 8, 0.25, 'ally a healed 4%/s for 2 s');
  close(c.hp - before[1], 8, 0.25, 'ally c healed');
  close(d.hp - before[2], 8, 0.25, 'ally d healed');
  assert.equal(b.hp, 80);
});

test('a heal link is cut when line of sight breaks and stays cut for its retry time', () => {
  const ctx = makeCtx();
  const j = ctx.add(LanternJelly, V(0, 1, 0));
  j.shockCd = 99;
  const a = ctx.ally(6, 0, 40);
  ctx.step(1.5);
  assert.equal(j.links.length, 1);
  // 立一堵墙挡在水母和同伴之间
  const box = ctx.world.addBox(2.6, 0, -2, 3.2, 5, 2, 'wall');
  ctx.step(0.4);
  assert.equal(j.links.length, 0, 'blocked link is cut');
  const hp = a.hp;
  ctx.step(1);
  assert.equal(a.hp, hp, 'no healing through the wall');
  ctx.world.remove(box);
  ctx.step(0.8);
  assert.equal(j.links.length, 0, 'still inside the retry window');
  ctx.step(LINK.losRetry);
  assert.equal(j.links.length, 1, 're-linked once the retry window passed');
});

test('the player stepping through a tendril snaps it', () => {
  const ctx = makeCtx();
  const j = ctx.add(LanternJelly, V(0, 1, 0));
  j.shockCd = 99;
  const a = ctx.ally(9, 0, 40);
  ctx.step(1.5);
  assert.equal(j.links.length, 1);
  const L = j.links[0];
  // 玩家站到触须中段下面
  ctx.player.position.set((L.spec.from.x + L.spec.to.x) / 2, 0, (L.spec.from.z + L.spec.to.z) / 2);
  assert.ok(bodyCrossesSegment(L.spec.from, L.spec.to, ctx.player.position, 1.8, 0.4));
  j.shockCd = 99;
  ctx.step(0.1);
  assert.equal(j.links.length, 0);
  ctx.player.position.set(0, 0, 30);
  ctx.step(LINK.crossRetry - 0.5);
  assert.equal(j.links.length, 0);
  ctx.step(1);
  assert.equal(j.links.length, 1);
  void a;
});

test('frost-shock ring hits a player who comes within 5.5 m and chills them; a far player is safe', () => {
  const ctx = makeCtx();
  const j = ctx.add(LanternJelly, V(0, 1, 0));
  ctx.step(1);
  j.shockCd = 99;
  ctx.player.position.set(0, 0, 12);
  ctx.step(0.5);
  assert.equal(ctx.combat.dealt.length, 0);
  ctx.player.position.set(3, 0, 0);
  j.shockCd = 0;
  ctx.step(1.8);
  assert.equal(ctx.combat.dealt.length, 1, 'one shock after the 0.8 s windup');
  close(ctx.player.stats.get('moveSpeed'), 7.5 * 0.6, 1e-6, 'chilled 40%');
  ctx.step(1.8);
  close(ctx.player.stats.get('moveSpeed'), 7.5, 1e-6, 'chill wears off');
});

test('a heavy hit on the lantern core staggers the jelly and drops every link', () => {
  const ctx = makeCtx();
  const j = ctx.add(LanternJelly, V(0, 1, 0));
  j.shockCd = 99;
  ctx.ally(4, 0, 40); ctx.ally(-4, 0, 40);
  ctx.step(1.5);
  assert.equal(j.links.length, 2);
  j.onDamaged({ dealt: j.maxHp * 0.13, isCrit: false, request: { headshot: true } });
  assert.equal(j.links.length, 0);
  ctx.step(0.6);
  assert.equal(j.links.length, 0, 'no new links while staggered');
  ctx.step(1.5);
  assert.equal(j.links.length, 2);
});

// ───────────── 九尾狐巫 ─────────────

function quietFox(ctx, pos) {
  const f = ctx.add(FoxWitch, pos);
  f.wallCd = f.armorCd = f.mirrorCd = f.fireCd = 99;
  f.blinkCd = 99;
  return f;
}

test('ice-wall placement sits between the protected allies and the player, never on top of the player', () => {
  const plan = { x: 0, z: 0, yaw: 0 };
  assert.ok(planIceWall(V(0, 0, 10), V(0, 0, 24), plan));
  close(plan.z, 10 + 14 * 0.4, 1e-9);
  close(plan.yaw, 0, 1e-9);
  assert.ok(planIceWall(V(0, 0, 0), V(0, 0, 7), plan));
  assert.ok(plan.z <= 7 - 3.5 + 1e-9, 'keeps 3.5 m from the player');
  assert.equal(planIceWall(V(0, 0, 0), V(0, 0, 5), plan), false, 'too close for a wall');
  const boxes = iceWallBoxes(0, 0, 0, Math.PI / 4);
  assert.equal(boxes.length, WALL.segments);
  for (const b of boxes) assert.ok(b.maxY - b.minY === WALL.height);
});

test('the fox witch raises a real ice wall: it blocks sight, can be shattered, and crumbles on its own', () => {
  const ctx = makeCtx();
  const f = quietFox(ctx, V(0, 0, 4));
  const a = ctx.ally(0, 10, 100);
  ctx.player.position.set(0, 0, 24);
  ctx.step(1.8);
  const eye = () => ctx.player.eye;
  const chest = V(0, 1.2, 10);
  assert.equal(ctx.world.segmentBlocked(chest, eye()), false);
  f.wallCd = 0;
  ctx.step(1.3);
  assert.equal(f.walls.length, 1, 'one wall raised');
  const w = f.walls[0];
  assert.ok(w instanceof FoxIceWall);
  assert.equal(w.boxCount, WALL.segments);
  assert.ok(ctx.world.segmentBlocked(chest, eye()), 'the wall blocks line of sight between ally and player');
  assert.ok(w.position.z > 10 && w.position.z < 24 - 3);
  // 子弹先打在冰壁上
  const hit = { distance: 0, headshot: false };
  const dir = V(0, 0, -1);
  assert.ok(w.raycastHit(V(0, 1.2, 23), dir, 50, hit));
  const wh = ctx.world.raycast(V(0, 1.2, 23), dir, 50);
  assert.ok(hit.distance <= wh.distance, 'the wall entity is hit before (or with) its collision box');
  // 打碎：碰撞体立刻消失
  w.hp = 0;
  w.onKilled({ request: {}, dealt: 150, isCrit: false });
  assert.equal(w.boxCount, 0);
  assert.equal(ctx.world.segmentBlocked(chest, eye()), false);
  // 再立一道，等它到时自己崩解
  f.wallCd = 0;
  ctx.step(1.3);
  assert.equal(f.walls.filter((x) => x.alive).length, 1);
  const w2 = f.walls.find((x) => x.alive);
  f.wallCd = 99;
  ctx.step(WALL.life + 0.2);
  assert.equal(w2.alive, false, 'expired');
  assert.equal(w2.boxCount, 0);
  assert.equal(ctx.world.segmentBlocked(chest, eye()), false);
  void a;
});

test('walls shatter when their fox dies, and a fox keeps at most two walls', () => {
  const ctx = makeCtx();
  const f = quietFox(ctx, V(0, 0, 4));
  ctx.ally(0, 10, 100);
  ctx.player.position.set(0, 0, 26);
  ctx.step(1.8);
  for (let i = 0; i < 3; i++) {
    f.wallCd = 0;
    ctx.step(1.3);
  }
  const alive = ctx.enemies.list.filter((e) => e instanceof FoxIceWall && e.alive);
  assert.equal(alive.length, 2, 'the oldest wall broke when the third rose');
  f.hp = 0;
  f.onKilled({ request: {}, dealt: 999, isCrit: false });
  const aliveWalls = () => ctx.enemies.list.filter((e) => e instanceof FoxIceWall && e.alive).length;
  // 主人死后寿命只缩短一次（0.35–0.6 秒，测试 rng 取中值 0.475）；每帧重掷会让墙永远不碎
  ctx.step(0.3);
  assert.equal(aliveWalls(), 2, 'walls linger briefly after the fox dies');
  ctx.step(0.5);
  assert.equal(aliveWalls(), 0);
  assert.equal(ctx.world.boxes.length, 1, 'only the floor is left');
});

test('frost armour cuts damage taken by allies within 12 m by 30% for 5 s', () => {
  const ctx = makeCtx();
  const f = quietFox(ctx, V(0, 0, 0));
  const near = ctx.ally(5, 0, 100), far = ctx.ally(25, 0, 100);
  ctx.step(1.8);
  f.armorCd = 0;
  ctx.step(1.0);
  f.armorCd = 99;
  const taken = (e) => ctx.combat.mods.reduce((m, fn) => m * fn(e), 1);
  close(taken(near), 0.7, 1e-9, 'armoured');
  close(taken(far), 1, 1e-9, 'out of range');
  assert.equal(near.damageMult, 1, 'armour does not change outgoing damage');
  ctx.step(5);
  close(taken(near), 1, 1e-9, 'armour expired');
});

test('the mirror beam needs line of sight: it hits and chills in the open, and a wall in the way blocks it', () => {
  const ctx = makeCtx();
  const f = quietFox(ctx, V(0, 0, 0));
  ctx.player.position.set(0, 0, 15);
  ctx.step(1.8);
  f.mirrorCd = 0;
  ctx.step(1.0);
  f.mirrorCd = 99;
  assert.equal(ctx.combat.dealt.length, 1, 'beam hit');
  close(ctx.player.stats.get('moveSpeed'), 7.5 * 0.3, 1e-6, '70% slow');
  ctx.step(1.6);
  close(ctx.player.stats.get('moveSpeed'), 7.5, 1e-6, 'slow wears off');
  // 蓄光途中玩家躲到掩体后面
  f.mirrorCd = 0;
  ctx.step(0.3);
  f.mirrorCd = 99;
  ctx.world.addBox(-2, 0, 11, 2, 4, 11.6, 'cover');
  ctx.step(1.0);
  assert.equal(ctx.combat.dealt.length, 1, 'blocked beam does no damage');
});

test('breaking the mirror silences her support (armour, walls) and switches her to homing fox-fire', () => {
  const ctx = makeCtx();
  const f = quietFox(ctx, V(0, 0, 0));
  const near = ctx.ally(4, 0, 100);
  ctx.player.position.set(0, 0, 15);
  ctx.step(1.8);
  f.armorCd = 0;
  ctx.step(1.0);
  f.armorCd = 99;
  assert.ok(frostArmor.get(near)?.blessedBy === f);
  // 打铜镜：累计 30% 最大生命才碎
  f.onDamaged({ dealt: f.maxHp * 0.2, isCrit: false, request: { headshot: true } });
  assert.equal(f.silenced, false);
  close(f.mirrorCrack, 0.2 / MIRROR_BREAK, 1e-9);
  f.onDamaged({ dealt: f.maxHp * 0.11, isCrit: false, request: { headshot: true } });
  assert.equal(f.silenced, true, 'mirror shattered');
  frostArmor.tick(ctx.time.now);
  assert.equal(frostArmor.get(near), undefined, 'armour dropped at once');
  // 不再立墙
  f.wallCd = 0;
  f.fireCd = 0;
  ctx.step(2.2);
  assert.equal(f.walls.length, 0);
  assert.equal(ctx.projectiles.shots.length, 3, 'three fox-fires');
  for (const s of ctx.projectiles.shots) assert.ok(s.homing > 0);
});

test('chill does not stack: a second hit refreshes the duration at the stronger ratio', () => {
  const ctx = makeCtx();
  const st = ctx.player.stats;
  chillPlayer(ctx, 0.4, 1);
  close(st.get('moveSpeed'), 7.5 * 0.6, 1e-9);
  chillPlayer(ctx, 0.7, 1);
  close(st.get('moveSpeed'), 7.5 * 0.3, 1e-9);
  ctx.step(0.5);
  chillPlayer(ctx, 0.4, 1);
  close(st.get('moveSpeed'), 7.5 * 0.3, 1e-9, 'keeps the stronger ratio while active');
  ctx.step(1.8);
  assert.equal(st.has(CHILL_SOURCE), false);
  close(st.get('moveSpeed'), 7.5, 1e-9);
});

// ───────────── 原生骨架动画（按 creature_rigs/*.json 搭出同一套骨骼，逐个状态跑 poseNative） ─────────────

/** 按管线的骨骼 JSON（Blender 坐标：前 -Y、左 +X、上 +Z）搭一套 THREE.Bone，挂到敌人的模型根下，返回最小 NativeBody */
const readRig = async (asset) => JSON.parse(await readFile(new URL(`../art/pipeline/creature_rigs/${asset}.json`, import.meta.url), 'utf8'));
function nativeFrom(rig, host) {
  const toModel = ([x, y, z]) => V(x, z, -y);
  const bones = {};
  const model = new THREE.Group();
  for (const [name, b] of Object.entries(rig.bones)) {
    const bone = new THREE.Bone();
    bone.name = name;
    bones[name] = bone;
  }
  for (const [name, b] of Object.entries(rig.bones)) {
    const head = toModel(b.head);
    const parent = b.parent ? bones[b.parent] : null;
    const ph = b.parent ? toModel(rig.bones[b.parent].head) : V(0, 0, 0);
    bones[name].position.copy(head.sub(ph));
    (parent ?? model).add(bones[name]);
  }
  host.add(model);
  return { lod: model, pose: new NativePose(model, host), glowShell: new THREE.MeshBasicMaterial(), materials: [], dispose() {} };
}

function assertFiniteRig(e, label) {
  e.root.updateMatrixWorld(true);
  e.root.traverse((o) => {
    if (!o.isBone) return;
    const p = o.getWorldPosition(V(0, 0, 0));
    assert.ok(Number.isFinite(p.x + p.y + p.z) && Number.isFinite(o.quaternion.x + o.quaternion.w), `${label}: bone ${o.name} is finite`);
  });
}

test('fox witch native skeleton animates through every state without NaNs; her hands never reach the mirror', async () => {
  const ctx = makeCtx();
  const rig = await readRig('SK_Enemy_FoxWitch');
  globalThis.__frostNative = (host, id) => (id === 'fox_witch' ? nativeFrom(rig, host) : null);
  const f = quietFox(ctx, V(0, 0, 0));
  globalThis.__frostNative = null;
  ctx.ally(4, 6, 60);
  ctx.player.position.set(0, 0, 16);
  ctx.step(1.8);
  assertFiniteRig(f, 'stalk');
  const minHandMirror = { d: Infinity };
  const watch = () => {
    const m = f.mirror.getWorldPosition(V(0, 0, 0));
    for (const s of ['L', 'R']) {
      const h = f.nativeBody.pose.bone(`middle_2_${s}`).getWorldPosition(V(0, 0, 0));
      minHandMirror.d = Math.min(minHandMirror.d, h.distanceTo(m));
    }
  };
  for (const cd of ['wallCd', 'armorCd', 'mirrorCd']) {
    f[cd] = 0;
    for (let i = 0; i < 70; i++) { ctx.step(1 / 60); watch(); }
    f[cd] = 99;
    assertFiniteRig(f, cd);
  }
  assert.ok(minHandMirror.d > 0.12, `fingertips stay clear of the floating mirror (closest ${minHandMirror.d.toFixed(3)} m)`);
  // 闪身、碎镜、死亡
  f.blinkCd = 0;
  ctx.player.position.set(0, 0, 4);
  ctx.step(0.5);
  assertFiniteRig(f, 'blink');
  f.onDamaged({ dealt: f.maxHp * 0.31, isCrit: false, request: { headshot: true } });
  ctx.step(1.5);
  assertFiniteRig(f, 'scream');
  f.hp = 0;
  f.onKilled({ request: {}, dealt: 999, isCrit: false });
  ctx.step(0.6);
  assertFiniteRig(f, 'death');
});

test('fox witch has nine tail chains (four per fan + the centre hero tail) and drives every one of them', async () => {
  const rig = await readRig('SK_Enemy_FoxWitch');
  assert.equal(TAIL_IDS.length, 9, 'nine tails');
  assert.equal(TAIL_IDS.filter((id) => id[0] === 'L').length, 4);
  assert.equal(TAIL_IDS.filter((id) => id[0] === 'R').length, 4);
  for (const id of TAIL_IDS) {
    for (const k of [1, 2, 3]) assert.ok(rig.bones[`tail_${id}_${k}`], `rig has tail_${id}_${k}`);
    assert.equal(rig.bones[`tail_${id}_1`].parent, 'tail_root', `tail ${id} hangs on tail_root`);
    assert.ok(rig.limits.some((l) => l.bones.includes(`tail_${id}_1`)), `tail ${id} weights are limited to its own region`);
  }
  const ctx = makeCtx();
  globalThis.__frostNative = (host, id) => (id === 'fox_witch' ? nativeFrom(rig, host) : null);
  const f = quietFox(ctx, V(0, 0, 0));
  globalThis.__frostNative = null;
  ctx.ally(4, 6, 60);
  ctx.player.position.set(0, 0, 16);
  assert.equal(f.tails.length, 9, 'every chain found in the native skeleton');
  const c = f.tails.find((tl) => tl.bones[0] === 'tail_C_1');
  assert.ok(c && c.side === 0, 'the centre tail is neither fan');
  const P = f.nativeBody.pose;
  const d = P.restPosition('tail_C_3').clone().sub(P.restPosition('tail_C_1'));
  assert.ok(d.y > 0 && d.z < 0 && Math.abs(d.x) < 0.02, 'the centre tail rises up and back, on the midline');
  assert.ok(Math.abs(c.curlAxis.x) > 0.99, 'it curls in the midline plane');
  ctx.step(1.8);
  // 待机：九条尾巴的第一节都在动
  const q0 = TAIL_IDS.map((id) => P.bone(`tail_${id}_1`).quaternion.clone());
  ctx.step(0.7);
  TAIL_IDS.forEach((id, i) => assert.ok(P.bone(`tail_${id}_1`).quaternion.angleTo(q0[i]) > 1e-3, `tail ${id} sways`));
  // 施霜甲：两扇张开，主尾向后上方挺起（尾尖比绑定姿势更靠后）
  const tip = () => P.hostPosition('tail_C_3', V(0, 0, 0)).z;
  const rest = P.restPosition('tail_C_3').z;
  f.armorCd = 0;
  let flared = Infinity;
  for (let i = 0; i < 50; i++) {
    ctx.step(1 / 60);
    if (f.eFlare.x > 0.6) flared = Math.min(flared, tip());
  }
  assert.ok(Number.isFinite(flared), 'the fan flares during the armour cast');
  assert.ok(flared < rest - 0.03, `the hero tail lifts back when the fan flares (tip z ${flared.toFixed(3)} vs rest ${rest.toFixed(3)})`);
  assertFiniteRig(f, 'flare');
});

test('lantern jelly native skeleton animates (drift, links, shock, stagger) without NaNs, tendrils start at tentacle tips', async () => {
  const ctx = makeCtx();
  const rig = await readRig('SK_Enemy_LanternJelly');
  globalThis.__frostNative = (host, id) => (id === 'lantern_jelly' ? nativeFrom(rig, host) : null);
  const j = ctx.add(LanternJelly, V(0, 1, 0));
  globalThis.__frostNative = null;
  j.shockCd = 99;
  ctx.ally(5, 2, 40); ctx.ally(-4, 3, 30);
  ctx.step(2);
  assertFiniteRig(j, 'drift');
  assert.equal(j.links.length, 2);
  const core = j.coreWorld(V(0, 0, 0));
  for (const L of j.links) {
    assert.ok(L.spec.from.y < core.y - 0.2, `tendril leaves from a tentacle tip below the bell (${L.spec.from.toArray().map((v) => v.toFixed(2))} vs core ${core.toArray().map((v) => v.toFixed(2))}, pos ${j.position.toArray().map((v) => v.toFixed(2))})`);
    assert.ok(L.spec.from.distanceTo(core) < 2.5);
  }
  ctx.player.position.set(2, 0, 2);
  j.shockCd = 0;
  ctx.step(0.5);
  assertFiniteRig(j, 'shock');
  ctx.step(1);
  j.onDamaged({ dealt: j.maxHp * 0.2, isCrit: false, request: { headshot: true } });
  ctx.step(0.5);
  assertFiniteRig(j, 'stagger');
});
