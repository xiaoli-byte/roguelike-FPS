/**
 * 第三章辅助位（熔铜匠 + 铜甲、变脸傩巫 + 三面光环）的玩法回归：用真实的 EnemyBase / StandardEnemy / CollisionWorld /
 * SupportBuffs，只把美术接入、词缀、高台换成桩，在一个最小的 GameContext 里逐帧推进。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

// 固定随机数：特效里的 Math.random、死亡粒子等每次都一样
let seed = 0x9e3779b9;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

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
const frostFxUrl = await tsModule('../src/enemies/fx/FrostSupportFx.ts');
const flameFxUrl = await tsModule('../src/enemies/fx/FlameFx.ts', { '../bosses/Visuals': visualsUrl });
const fireFeedUrl = await tsModule('../src/enemies/inferno/FireFeed.ts');
const infFxUrl = await tsModule('../src/enemies/fx/InfernoSupportFx.ts', {
  '../bosses/Visuals': visualsUrl, '../Hazards': hazardsUrl, '../inferno/FireFeed': fireFeedUrl,
});
// 美术接入 / 词缀 / 高台：桩（玩法不依赖它们）
const artStub = dataModule('export function attachEnemyArt(o) { const n = globalThis.__infernoNative?.(o.host, o.defId) ?? null; return { body: n, native: n, parts: [] }; }');
const affixStub = dataModule("export const AFFIX_NAMES = {}; export function createAffix() { return null; } export function isAffixId() { return false; }");
const levelsStub = dataModule('export function levelAt() {} export function playerLevel() { return { route: null, onTop: false }; }');
const standardUrl = await tsModule('../src/enemies/StandardEnemy.ts', {
  '../core/math': mathUrl, './EnemyBase': enemyBaseUrl, './AttackTokens': tokensUrl, './Affixes': affixStub,
  './Levels': levelsStub, './Models': modelsUrl, '../assets/EnemyArt': artStub,
});
const shared = {
  '../../core/math': mathUrl, '../StandardEnemy': standardUrl, '../EnemyBase': enemyBaseUrl, '../AttackTokens': tokensUrl,
  '../SupportBuffs': buffsUrl, '../bosses/Visuals': visualsUrl, '../Models': modelsUrl, '../fx/FrostSupportFx': frostFxUrl,
  '../Hazards': hazardsUrl, '../fx/InfernoSupportFx': infFxUrl, '../fx/FlameFx': flameFxUrl,
};
const founderMod = await import(await tsModule('../src/enemies/types/Founder.ts', shared));
const nuoMod = await import(await tsModule('../src/enemies/types/Nuo.ts', shared));
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { NativePose } = await import(await tsModule('../src/assets/NativeRig.ts', {
  'three/addons/utils/SkeletonUtils.js': new URL('../node_modules/three/examples/jsm/utils/SkeletonUtils.js', import.meta.url).href,
}));
const { attackDirector } = await import(tokensUrl);
const { listFires } = await import(fireFeedUrl);
const { pourArc, BronzeCoat, maskWeights, applyNuoMask } = await import(infFxUrl);
const { Founder, POUR, BRONZE, FLING, CRUCIBLE_BREAK, bronzeOn } = founderMod;
const { Nuo, FACES, MASK_BREAK, FACE_CHANGE, SPIT } = nuoMod;

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const close = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b}`);

/** 最小游戏上下文：真实碰撞世界（一块地板）；敌人列表、玩家、战斗只记录调用；任务队列支持 add / delay */
function makeCtx() {
  const world = new CollisionWorld();
  world.addBox(-80, -1, -80, 80, 0, 80, 'floor');
  const list = [];
  const tasks = [];
  const playerPos = V(0, 0, 30);
  const ctx = {
    scene: new THREE.Scene(), stageGroup: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    world,
    rng: { range: (a, b) => (a + b) / 2, sign: () => 1, int: (a) => a, chance: () => false, next: () => 0.5 },
    tasks: {
      add(fn) { const t = { fn, dead: false }; tasks.push(t); return () => { t.dead = true; }; },
      delay(s, fn) { let left = s; return this.add((dt) => { left -= dt; if (left <= 0) { fn(); return true; } return false; }); },
    },
    time: { now: 0, dt: 1 / 60, timeScale: 1, frame: 0 },
    settings: { quality: 'high' },
    renderer: null,
    run: { chapter: 2, difficulty: 1 },
    stage: { arena: { floorY: 0, center: V(0, 0, 0) }, stage: null },
    nav: {
      isWalkable: () => true, findPath: () => false, nearestWalkable: (p, out) => out.copy(p), platformAt: () => false,
      randomWalkable: (c, a, b, out) => { out.set(c.x + a, c.y, c.z); return true; },
    },
    player: {
      position: playerPos, velocity: V(0, 0, 0), get eye() { return V(playerPos.x, playerPos.y + 1.6, playerPos.z); },
      alive: true, radius: 0.4, height: 1.8, invulnerableTime: 0, applyImpulse() {},
    },
    enemies: {
      list,
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
      mods: [], dealt: [], enemyHits: [],
      addOutgoingModifier(fn) { this.mods.push(fn); return () => {}; },
      damagePlayer(a) { this.dealt.push(a); return a; },
      damageEnemy(e, req) { this.enemyHits.push({ e, req }); e.hp -= req.base; return null; },
    },
    projectiles: { shots: [], spawn(s) { this.shots.push(s); } },
    fx: new Proxy({}, { get: (_, k) => (k === 'groundWarning' || k === 'beam' ? () => () => {} : () => {}) }),
    audio: { play() {} },
  };
  ctx.add = (Cls, pos) => {
    const e = new Cls(ctx, { position: pos, level: 1 });
    e.init();
    list.push(e);
    return e;
  };
  /** 站着不动的同伴：辅助怪会读写的字段 + 一个带实体网格的模型根（铜甲着色层挂在它下面） */
  let nextId = 20000;
  ctx.ally = (x, z, maxHp = 100, extra = {}) => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), new THREE.MeshStandardMaterial()));
    const a = {
      id: nextId++, def: { id: 'grunt' }, alive: true, removed: false, isBoss: false, flying: false, root,
      position: V(x, 0, z), velocity: V(0, 0, 0), radius: 0.5, height: 1.8, hp: maxHp, maxHp, armor: 0, maxArmor: 0,
      damageMult: 1, attackRate: 1, speedMult: 1,
      getBodyCenter(out) { return out.set(this.position.x, this.position.y + 0.9, this.position.z); },
      update() {}, dispose() {}, ...extra,
    };
    root.position.copy(a.position);
    list.push(a);
    return a;
  };
  ctx.step = (seconds, dt = 1 / 60) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      ctx.time.now += dt;
      ctx.time.dt = dt;
      ctx.time.frame++;
      for (const e of [...list]) if (!e.removed) e.update(dt);
      for (const task of [...tasks]) {
        if (task.dead) continue;
        if (task.fn(dt)) task.dead = true;
      }
      for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].dead) tasks.splice(i, 1);
      for (let i = list.length - 1; i >= 0; i--) if (list[i].removed) list.splice(i, 1)[0].dispose();
    }
  };
  ctx.taken = (e) => ctx.combat.mods.reduce((m, fn) => m * fn(e), 1);
  attackDirector.reset();
  return ctx;
}

// ───────────── 熔铜匠 ─────────────

function quietFounder(ctx, pos) {
  const f = ctx.add(Founder, pos);
  f.pourCd = f.flingCd = 99;
  return f;
}

test('the pour arc runs spout → ally head and rises by apex at its middle', () => {
  const a = V(0, 2, 0), b = V(6, 1, 0), out = V(0, 0, 0);
  assert.deepEqual(pourArc(a, b, 1.5, 0, out).toArray(), [0, 2, 0]);
  assert.deepEqual(pourArc(a, b, 1.5, 1, out).toArray(), [6, 1, 0]);
  pourArc(a, b, 1.5, 0.5, out);
  close(out.x, 3, 1e-9);
  close(out.y, 1.5 + 1.5, 1e-9, 'midpoint lifted by the apex');
});

test('the founder pours bronze armour on the biggest unarmoured ally in reach: red-hot ×2, then cold ×0.5, then it peels off', () => {
  const ctx = makeCtx();
  const f = quietFounder(ctx, V(0, 0, 0));
  const big = ctx.ally(5, 4, 300), small = ctx.ally(-4, 3, 100);
  const far = ctx.ally(20, 0, 999), flyer = ctx.ally(3, -3, 999, { flying: true });
  ctx.step(1.5);
  f.pourCd = 0;
  ctx.step(0.1);
  assert.equal(f.target, big, 'aims at the biggest ally within 14 m (not the far one, not the flyer)');
  ctx.step(POUR.windup + POUR.flight + 0.1);
  const on = bronzeOn(big);
  assert.ok(on && on.hot, 'red-hot armour poured');
  assert.equal(big.armor, 300 * BRONZE.armor);
  assert.equal(big.maxArmor, 300 * BRONZE.armor);
  assert.equal(bronzeOn(small), null);
  assert.equal(bronzeOn(far), null);
  assert.equal(bronzeOn(flyer), null);
  close(ctx.taken(big), BRONZE.hotTaken, 1e-9, 'red-hot: takes double damage');
  close(ctx.taken(small), 1, 1e-9);
  assert.ok(big.root.children[0].children.some((c) => c.userData.bronzeCoat), 'a bronze shader layer covers the ally');
  ctx.step(BRONZE.hot);
  assert.equal(bronzeOn(big).hot, false, 'cooled to bronze');
  close(ctx.taken(big), BRONZE.coldTaken, 1e-9, 'cold bronze: takes half damage');
  assert.equal(big.damageMult, 1, 'armour never changes outgoing damage');
  ctx.step(BRONZE.cold);
  assert.equal(bronzeOn(big), null, 'peeled off');
  assert.equal(big.armor, 0);
  assert.equal(big.maxArmor, 0);
  close(ctx.taken(big), 1, 1e-9);
  assert.equal(big.root.children[0].children.length, 0, 'shader layer removed');
});

test('hot armour shatters at once when its armour layer is shot through; the next pour picks the next ally', () => {
  const ctx = makeCtx();
  const f = quietFounder(ctx, V(0, 0, 0));
  const big = ctx.ally(5, 4, 300), small = ctx.ally(-4, 3, 100);
  ctx.step(1.5);
  f.pourCd = 0;
  ctx.step(POUR.windup + POUR.flight + POUR.recover + 0.15);
  assert.ok(bronzeOn(big)?.hot);
  // 打穿护甲层（Combat 先扣护甲；这里直接扣）
  big.armor -= 300 * BRONZE.armor;
  ctx.step(0.05);
  assert.equal(bronzeOn(big), null, 'shattered');
  assert.equal(big.maxArmor, 0);
  close(ctx.taken(big), 1, 1e-9, 'no more ×2 once the armour is gone');
  f.pourCd = 0;
  ctx.step(0.1);
  assert.equal(f.target, big, 'the shattered ally is a candidate again (biggest)');
  void small;
});

test('armour already poured stays after the founder dies, but a cracked crucible pours no more and leaks on its neighbours', () => {
  const ctx = makeCtx();
  const f = quietFounder(ctx, V(0, 0, 0));
  const big = ctx.ally(5, 4, 300);
  ctx.step(1.5);
  f.pourCd = 0;
  ctx.step(POUR.windup + POUR.flight + 0.3);
  assert.ok(bronzeOn(big));
  // 打坩埚：累计 30% 最大生命才裂
  f.onDamaged({ dealt: f.maxHp * 0.2, isCrit: false, request: { headshot: true } });
  assert.equal(f.silenced, false);
  close(f.crucibleCrack, 0.2 / CRUCIBLE_BREAK, 1e-9);
  f.onDamaged({ dealt: f.maxHp * 0.11, isCrit: false, request: { headshot: true } });
  assert.equal(f.silenced, true, 'crucible cracked');
  assert.ok(bronzeOn(big), 'poured armour is metal: it stays');
  assert.ok(listFires(ctx).length >= 1, 'the leak is registered as floor fire (huodou can eat it)');
  const near = ctx.ally(1, 1, 100);
  const hp0 = f.hp;
  ctx.step(1.2);
  assert.ok(ctx.combat.enemyHits.some((h) => h.e === near), 'leak burns the ally standing next to him');
  assert.ok(f.hp < hp0, 'and the founder himself');
  const fresh = ctx.ally(-5, 4, 500);
  f.pourCd = 0;
  ctx.step(3);
  assert.equal(bronzeOn(fresh), null, 'no more pours');
  f.hp = 0;
  f.onKilled({ request: {}, dealt: 999, isCrit: false });
  ctx.step(0.5);
  assert.ok(bronzeOn(big), 'armour outlives the founder');
});

test('fling: a player within 6 m is scalded, a 3 m molten pool keeps burning, and the founder backs off; huodou eating the pool puts it out', () => {
  const ctx = makeCtx();
  const f = quietFounder(ctx, V(0, 0, 0));
  ctx.step(1.5);
  ctx.player.position.set(0, 0, 2.5);
  f.flingCd = 0;
  ctx.step(FLING.windup + 0.1);
  assert.ok(ctx.combat.dealt.length >= 1, 'scalded by the fling');
  const pools = listFires(ctx);
  assert.equal(pools.length, 1, 'molten pool registered as floor fire');
  const n0 = ctx.combat.dealt.length;
  ctx.step(1.0);
  assert.ok(ctx.combat.dealt.length > n0, 'the pool keeps burning a player standing in it');
  assert.ok(Math.hypot(f.position.x, f.position.z) > 0.5, 'the founder backs off after the fling');
  pools[0].consume();
  const n1 = ctx.combat.dealt.length;
  ctx.step(1.5);
  assert.equal(ctx.combat.dealt.length, n1, 'eaten pool no longer burns');
  ctx.player.position.set(0, 0, 30);
  ctx.step(FLING.pool);
  assert.equal(listFires(ctx).length, 0);
});

test('the crucible is the weak spot: hit from behind and above, blocked by the head from the front', () => {
  const ctx = makeCtx();
  const f = quietFounder(ctx, V(0, 0, 0));
  ctx.player.position.set(0, 0, 20);
  ctx.step(1.5);
  const c = f.getHeadCenter(V(0, 0, 0));
  const hit = { distance: 0, headshot: false };
  // 从背后、略高处打坩埚
  const from = V(c.x, c.y + 1, c.z - 6);
  assert.ok(f.raycastHit(from, c.clone().sub(from).normalize(), 50, hit));
  assert.equal(hit.headshot, true, 'crucible hit from behind');
  // 从正面平视：先打到头 / 驼背
  const front = V(c.x, c.y, c.z + 8);
  assert.ok(f.raycastHit(front, c.clone().sub(front).normalize(), 50, hit));
  assert.equal(hit.headshot, false, 'the head and hunch shield the crucible from the front');
});

// ───────────── 变脸傩巫 ─────────────

function quietNuo(ctx, pos) {
  const n = ctx.add(Nuo, pos);
  n.spitCd = 99;
  n.faceTimer = 99;
  return n;
}

test('the nuo dance buffs allies within 16 m with the current face, and each face change swaps the buff', () => {
  const ctx = makeCtx();
  const n = quietNuo(ctx, V(0, 0, 0));
  const near = ctx.ally(6, 0, 100), far = ctx.ally(25, 0, 100);
  ctx.step(1.5);
  assert.equal(n.currentFace.id, 'red');
  close(near.damageMult, 1.35, 1e-9, 'red: damage');
  close(near.attackRate, 1.25, 1e-9, 'red: attack rate');
  assert.equal(far.damageMult, 1);
  n.faceTimer = 0;
  ctx.step(FACE_CHANGE.wipe + 0.1);
  assert.equal(n.currentFace.id, 'black');
  close(near.damageMult, 1, 1e-9, 'red buff gone after the swap');
  close(ctx.taken(near), 0.6, 1e-9, 'black: damage reduction');
  n.faceTimer = 0;
  ctx.step(FACE_CHANGE.wipe + 0.1);
  assert.equal(n.currentFace.id, 'gold');
  close(ctx.taken(near), 1, 1e-9);
  close(near.speedMult, 1.3, 1e-9, 'gold: speed');
  near.hp = 50;
  n.faceTimer = 99;
  ctx.step(2);
  close(near.hp, 54, 0.15, 'gold: 2% max HP per second');
  n.hp = 0;
  n.onKilled({ request: {}, dealt: 999, isCrit: false });
  ctx.step(0.1);
  close(near.speedMult, 1, 1e-9, 'aura gone with her');
});

test('the mask is only a weak spot from the front, and not while the sleeve wipes across it', () => {
  const ctx = makeCtx();
  const n = quietNuo(ctx, V(0, 0, 0));
  ctx.player.position.set(0, 0, 15);
  ctx.step(1.5);
  const c = n.getHeadCenter(V(0, 0, 0));
  const hit = { distance: 0, headshot: false };
  assert.ok(n.raycastHit(V(c.x, c.y, c.z + 6), V(0, 0, -1), 50, hit));
  assert.equal(hit.headshot, true, 'mask hit from the front');
  assert.ok(n.raycastHit(V(c.x, c.y, c.z - 6), V(0, 0, 1), 50, hit));
  assert.equal(hit.headshot, false, 'from behind it is just the body');
  n.faceTimer = 0;
  ctx.step(0.1);
  assert.equal(n.maskCovered, true);
  const c2 = n.getHeadCenter(V(0, 0, 0));
  assert.ok(n.raycastHit(V(c2.x, c2.y, c2.z + 6), V(0, 0, -1), 50, hit));
  assert.equal(hit.headshot, false, 'the sleeve covers the mask during the wipe');
  n.onDamaged({ dealt: n.maxHp * 0.5, isCrit: false, request: { headshot: true } });
  assert.equal(n.broken.some(Boolean), false, 'mask hits do not count while covered');
});

test('breaking the current face drops its buff at once, locks face changes for 6 s and takes that face out of the rotation', () => {
  const ctx = makeCtx();
  const n = quietNuo(ctx, V(0, 0, 0));
  const near = ctx.ally(6, 0, 100);
  ctx.step(1.5);
  close(near.damageMult, 1.35, 1e-9);
  n.onDamaged({ dealt: n.maxHp * 0.15, isCrit: false, request: { headshot: true } });
  assert.equal(n.broken[0], false);
  n.onDamaged({ dealt: n.maxHp * (MASK_BREAK.frac - 0.15 + 0.01), isCrit: false, request: { headshot: true } });
  assert.equal(n.broken[0], true, 'red face broken');
  close(near.damageMult, 1, 1e-9, 'its buff drops at once');
  ctx.step(MASK_BREAK.lock - 0.5);
  assert.equal(n.currentFace.id, 'red', 'no face change while locked');
  close(near.damageMult, 1, 1e-9, 'no buff from a broken face');
  ctx.step(1.2);
  assert.equal(n.currentFace.id, 'black', 'changes face once the lock ends');
  close(ctx.taken(near), 0.6, 1e-9);
  n.faceTimer = 0;
  ctx.step(FACE_CHANGE.wipe + 0.1);
  assert.equal(n.currentFace.id, 'gold');
  n.faceTimer = 0;
  ctx.step(FACE_CHANGE.wipe + 0.1);
  assert.equal(n.currentFace.id, 'black', 'the broken red face is skipped');
});

test('fire spit sweeps half a circle in front of her: hits a close player in the open, leaves floor fire, and walls stop it', () => {
  const ctx = makeCtx();
  const n = quietNuo(ctx, V(0, 0, 0));
  ctx.player.position.set(0, 0, 4);
  ctx.step(1.5);
  n.spitCd = 0;
  ctx.step(SPIT.windup + SPIT.sweep + 0.2);
  const total = ctx.combat.dealt.reduce((a, b) => a + b, 0);
  assert.ok(total > 0, 'the jet sweeps across the player');
  assert.ok(total < n.def.damage * SPIT.dps * SPIT.sweep, 'only while the jet is on the player');
  assert.ok(listFires(ctx).length > 0, 'embers left on the floor are edible floor fire');

  const ctx2 = makeCtx();
  const m = quietNuo(ctx2, V(0, 0, 0));
  ctx2.player.position.set(0, 0, 4);
  ctx2.step(1.5);
  ctx2.world.addBox(-3, 0, 1.6, 3, 4, 2.2, 'wall');
  m.spitCd = 0;
  ctx2.step(SPIT.windup + SPIT.sweep + 0.2);
  assert.equal(ctx2.combat.dealt.length, 0, 'the wall blocks the jet');
});

// ───────────── 特效小件 ─────────────

test('bronze coat layers every solid mesh (skinned meshes share the skeleton) and releases cleanly', () => {
  const root = new THREE.Group();
  const solid = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const glow = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending }));
  const bone = new THREE.Bone();
  const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  skinned.add(bone);
  skinned.bind(new THREE.Skeleton([bone]));
  root.add(solid, glow, skinned);
  const coat = BronzeCoat.acquire(root);
  assert.equal(coat.layerCount, 2, 'glow parts are not coated');
  const layer = skinned.children.find((c) => c.userData.bronzeCoat);
  assert.ok(layer?.isSkinnedMesh && layer.skeleton === skinned.skeleton);
  coat.set(1, 0.5, 0.2, 1, 0, 1.8);
  coat.release();
  assert.equal(solid.children.length, 0);
  assert.equal(skinned.children.filter((c) => c.userData.bronzeCoat).length, 0);
});

test('nuo mask weights come from the mask joint of the skin attributes', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.3, 0.2, 0, 1.4, 0.2, 0, 0.5, 0], 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([3, 0, 0, 0, 2, 3, 0, 0, 1, 0, 0, 0], 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 0.4, 0.6, 0, 0, 1, 0, 0, 0], 4));
  const w = maskWeights(g, 3);
  assert.deepEqual([...w].map((x) => Math.round(x * 100) / 100), [1, 0.6, 0]);
  const h = applyNuoMask(new THREE.MeshStandardMaterial(), [{ geometry: g, joint: 3 }]);
  assert.ok(g.getAttribute('aMask'), 'mask attribute added');
  assert.equal(h.maskVerts, 2);
  close(h.center.y, 1.35, 1e-6, 'crack centre at the mask');
});

// ───────────── 原生骨架动画（按 creature_rigs/*.json 搭出同一套骨骼，逐个状态跑 poseNative） ─────────────

const readRig = async (asset) => JSON.parse(await readFile(new URL(`../art/pipeline/creature_rigs/${asset}.json`, import.meta.url), 'utf8'));
function nativeFrom(rig, host) {
  const toModel = ([x, y, z]) => V(x, z, -y);
  const bones = {};
  const model = new THREE.Group();
  for (const name of Object.keys(rig.bones)) {
    const bone = new THREE.Bone();
    bone.name = name;
    bones[name] = bone;
  }
  for (const [name, b] of Object.entries(rig.bones)) {
    const head = toModel(b.head);
    const ph = b.parent ? toModel(rig.bones[b.parent].head) : V(0, 0, 0);
    bones[name].position.copy(head.sub(ph));
    (b.parent ? bones[b.parent] : model).add(bones[name]);
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

/** 世界点在敌人自己的模型坐标里（X = 生物左，Z = 前） */
function localOf(e, p) {
  const dx = p.x - e.position.x, dz = p.z - e.position.z, s = Math.sin(e.facing), c = Math.cos(e.facing);
  return { x: (dx * c - dz * s) / e.sizeScale, y: (p.y - e.position.y) / e.sizeScale, z: (dx * s + dz * c) / e.sizeScale };
}

test('founder native skeleton animates through pour, fling, crack and death without NaNs; the spout sits on his right shoulder', async () => {
  const ctx = makeCtx();
  const rig = await readRig('SK_Enemy_Founder');
  globalThis.__infernoNative = (host, id) => (id === 'founder' ? nativeFrom(rig, host) : null);
  const f = quietFounder(ctx, V(0, 0, 0));
  globalThis.__infernoNative = null;
  ctx.ally(5, 4, 300);
  ctx.player.position.set(0, 0, 16);
  ctx.step(1.5);
  assertFiniteRig(f, 'stalk');
  const sp = localOf(f, f.spoutWorld(V(0, 0, 0)));
  assert.ok(sp.x < -0.03, `spout on the creature's right (-X): ${sp.x.toFixed(3)}`);
  assert.ok(sp.y > 1.35, `spout above the head: ${sp.y.toFixed(3)}`);
  const head = localOf(f, f.realHead(V(0, 0, 0)));
  const weak = localOf(f, f.getHeadCenter(V(0, 0, 0)));
  assert.ok(weak.z < head.z - 0.15, 'the crucible weak spot is behind the head');
  f.pourCd = 0;
  for (let i = 0; i < 90; i++) ctx.step(1 / 60);
  assertFiniteRig(f, 'pour');
  f.pourCd = 99;
  ctx.player.position.set(0, 0, 3);
  f.flingCd = 0;
  ctx.step(0.8);
  assertFiniteRig(f, 'fling');
  f.onDamaged({ dealt: f.maxHp * 0.31, isCrit: false, request: { headshot: true } });
  ctx.step(0.8);
  assertFiniteRig(f, 'crack');
  f.hp = 0;
  f.onKilled({ request: {}, dealt: 999, isCrit: false });
  ctx.step(0.6);
  assertFiniteRig(f, 'death');
});

test('nuo native skeleton animates through dance, wipe, broken face, spit and death without NaNs; the mouth socket is in front of the mask', async () => {
  const ctx = makeCtx();
  const rig = await readRig('SK_Enemy_Nuo');
  for (const b of ['mask', 'mouth', 'feather_L', 'ribbon_B3', 'sleeve_R2', 'pinky_2_L']) assert.ok(rig.bones[b], `rig has ${b}`);
  assert.equal(rig.bones.mouth.deform, false, 'the mouth is a socket bone');
  globalThis.__infernoNative = (host, id) => (id === 'nuo' ? nativeFrom(rig, host) : null);
  const n = quietNuo(ctx, V(0, 0, 0));
  globalThis.__infernoNative = null;
  ctx.ally(5, 2, 100);
  ctx.player.position.set(0, 0, 16);
  ctx.step(2);
  assertFiniteRig(n, 'dance');
  const mouth = localOf(n, n.mouthWorld(V(0, 0, 0)));
  const maskC = localOf(n, n.getHeadCenter(V(0, 0, 0)));
  assert.ok(mouth.z > 0.15 && mouth.y > 1.15 && mouth.y < maskC.y, `mouth socket in front of and below the mask centre (${mouth.y.toFixed(2)}, ${mouth.z.toFixed(2)})`);
  n.faceTimer = 0;
  ctx.step(0.3);
  assertFiniteRig(n, 'wipe');
  ctx.step(0.4);
  n.onDamaged({ dealt: n.maxHp * 0.3, isCrit: false, request: { headshot: true } });
  ctx.step(1);
  assertFiniteRig(n, 'cover');
  ctx.step(1.5);
  ctx.player.position.set(0, 0, 4);
  n.spitCd = 0;
  ctx.step(1.0);
  assertFiniteRig(n, 'spit');
  n.hp = 0;
  n.onKilled({ request: {}, dealt: 999, isCrit: false });
  ctx.step(0.6);
  assertFiniteRig(n, 'death');
  assert.equal(FACES.length, 3);
});
