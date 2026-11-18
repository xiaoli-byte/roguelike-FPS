// 火麒麟（boss_qilin）无头回归：在真实的祝融炉心殿（inferno-5 V2 白盒：熔岩掩码 + 导航网格 + 熔岩系统）上找炉心殿几何，
// 构造首领，推进一阶段玄鳞的招式（踏火奔驰、张鳞、麟火、饮熔 + 锁扣坠鼎），强制越过 55% 血线验证巨鼎坠池、换成焚身，
// 再推进焚身的熔流轮转（LavaSystem.addLavaArea 临时熔岩）、三连俯冲 → 喘息、吐息扫象限（石柱 / 倒鼎挡得住）。
// 渲染与美术资产不参与：EnemyArt 换成空实现（等同 ?classic 的程序化兜底模型）。Math.random 用固定种子。
// 2026-11-18（docs/threejs-migration.md M6）：火麒麟改走首领框架（BossBrain / BossMove），数值与规则换成 Unity 的，这份测试跟着改——
//   招式 id 照 Unity（焚身是 burn_flood / burn_dives / burn_pant / burn_sweep / burn_rain）；鼎角砸中走框架的硬直（stagger 4 s、受伤 × 2），不再有 'stunned' 招式；
//   锁扣照 Unity 挂在殿墙内 0.9 m、锁身中心离地 12 m（Three.js 是 3–4 m）；熔流轮转按 Unity 的「俯视顺时针 = 方位角递增」（+Z 北、+X 东），
//   白盒的平面图北朝 −Z，所以在白盒上看是方位角递增那一圈；Unity 场景（3-4）的炉心殿按场景文档的首领场地 + Level_3_4 常量建（最后一条）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

// 固定随机：特效与少数抖动用 Math.random
let seed = 20261012;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
/** 替身模块（文件 URL → 源码）：美术挂载换成空实现 */
const STUBS = new Map([
  [new URL('../src/assets/EnemyArt.ts', import.meta.url).href, 'export function attachEnemyArt(){ return { body: null, native: null, parts: [] }; }'],
]);
const cache = new Map();
/** 递归载入 src/ 下的 TS：去类型，相对 import 换成 data: URL，'three' 换成本地构建 */
async function load(url) {
  const key = url.href;
  if (cache.has(key)) return cache.get(key);
  const pending = (async () => {
    if (STUBS.has(key)) return data(STUBS.get(key));
    let source = stripTypeScriptTypes(await readFile(url, 'utf8'), { mode: 'transform' });
    source = source.replaceAll("'three'", `'${threeUrl}'`);
    const specs = [...source.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)].map(m => m[1]);
    for (const spec of new Set(specs)) source = source.replaceAll(`'${spec}'`, `'${await load(new URL(`${spec}.ts`, url))}'`);
    return data(`${source}\n//# sourceURL=${url.href}`);
  })();
  cache.set(key, pending);
  return pending;
}
const ts = async path => import(await load(new URL(path, import.meta.url)));

const { Rng } = await ts('../src/core/Rng.ts');
const { TaskRunner } = await ts('../src/core/Tasks.ts');
const { WHITEBOX_REDESIGN_PLANS } = await ts('../src/world/WhiteboxPlans.ts');
const { generateWhitebox, whiteboxPoint } = await ts('../src/world/WhiteboxGen.ts');
const { CollisionWorld } = await ts('../src/world/Collision.ts');
const { NavGrid } = await ts('../src/world/NavGrid.ts');
const { LavaSystem, onLava } = await ts('../src/world/Lava.ts');
const { registerEnemy } = await ts('../src/enemies/Registry.ts');
const { locateFurnace, floodShapes } = await ts('../src/enemies/bosses/QilinArena.ts');
const { QilinFurnace, floodStrips } = await ts('../src/enemies/bosses/QilinFurnace.ts');
const { QilinLock, QILIN_LOCK_DEF } = await ts('../src/enemies/bosses/QilinLock.ts');
const { Qilin, QILIN_DEF, qilinDebug } = await ts('../src/enemies/bosses/Qilin.ts');
registerEnemy(QILIN_LOCK_DEF, (ctx, opts) => new QilinLock(ctx, opts));

const plan = WHITEBOX_REDESIGN_PLANS.find(p => p.id === 'inferno-5-v2');
const DT = 1 / 30;
const DEG = Math.PI / 180;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const wrapDeg = d => ((d + 540) % 360) - 180;
/** 平面图方位（0 = 东，+90° = 南）→ facing 约定（atan2(dx, dz)） */
const planAngle = deg => Math.atan2(Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180));

/** 祝融炉心殿的碰撞、导航与熔岩（与 StageDirector 相同：白盒碰撞盒 → NavGrid.setLava → build → LavaSystem） */
function infernoArena(time = { now: 0, dt: DT, frame: 0 }, withLava = true) {
  const node = { chapter: 2, index: 4, type: 'boss', theme: 'inferno', reward: 'coins' };
  const L = generateWhitebox(node, { redesign: true });
  const world = new CollisionWorld();
  for (const b of L.boxes) world.addBox(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.tag, b.noRaycast);
  const v = p => new THREE.Vector3(p.x, L.floorY, p.z);
  const arena = { minX: L.minX, minZ: L.minZ, maxX: L.maxX, maxZ: L.maxZ, floorY: L.floorY, playerSpawn: v(L.playerSpawn), playerYaw: 0,
    spawnPoints: [], rewardPoint: v(L.rewardPoint), portalPoints: [], shopPoint: v(L.shopPoint), center: v(L.center), theme: { id: 'inferno', name: '祝融火狱' } };
  const enemies = { list: [] };
  const nav = new NavGrid({ world, time, enemies });
  if (withLava) nav.setLava(L.whitebox.lava);
  nav.build(arena);
  return { L, world, arena, nav, time, enemies };
}

function makeCtx(withLava = true) {
  const { L, world, arena, nav, time, enemies } = infernoArena(undefined, withLava);
  const log = { damage: [], elements: [], impulses: [], toasts: [], setBoss: [], warnings: 0, spawned: [] };
  const tasks = new TaskRunner();
  const player = {
    alive: true, position: new THREE.Vector3(), velocity: new THREE.Vector3(), radius: 0.4, height: 1.8, eye: new THREE.Vector3(),
    onGround: true, invulnerableTime: 0,
    maxHp() { return 100; },
    applyImpulse(v) { log.impulses.push(v.clone()); },
    teleport(p) { this.position.copy(p); },
  };
  const ctx = {
    time, rng: new Rng(20261012), tasks, world, nav,
    stage: { arena, stage: { theme: 'inferno' }, lavaSystem: null, unityDocument: null },
    scene: new THREE.Scene(), stageGroup: new THREE.Group(), renderer: null, settings: { quality: 'high' },
    camera: new THREE.PerspectiveCamera(),
    player,
    combat: { damagePlayer(amount, element) { log.damage.push(amount); log.elements.push(element); return amount; } },
    projectiles: { spawn() {} },
    fx: { burst() {}, ring() {}, shake() {}, explosion() {}, spawnEffect() {}, deathEffect() {},
      groundWarning: () => { log.warnings++; return () => {}; } },
    audio: { play() {} },
    ui: { toast(text) { log.toasts.push(text); }, setBoss(e) { log.setBoss.push(e); }, banner() {} },
    enemies: {
      list: enemies.list,
      spawn(id, opts) {
        log.spawned.push(id);
        if (id !== QILIN_LOCK_DEF.id) return null;
        const e = new QilinLock(ctx, opts);
        e.init();
        enemies.list.push(e);
        return e;
      },
    },
    events: { on() {}, emit() {} },
  };
  if (withLava) ctx.stage.lavaSystem = new LavaSystem(ctx, L.whitebox.lava, L.floorY, arena.playerSpawn);
  return { ctx, log, arena, L };
}

function step(ctx, boss, seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    ctx.time.now += DT;
    ctx.time.dt = DT;
    boss.update(DT);
    for (const e of ctx.enemies.list) if (!e.removed) e.update(DT);
    ctx.tasks.update(DT);
  }
}

function spawnBoss(withLava = true, setup = null) {
  const env = makeCtx(withLava);
  setup?.(env);
  const at = whiteboxPoint(plan, plan.encounters.find(e => e.id === 'BOSS').at);
  const boss = new Qilin(env.ctx, { position: new THREE.Vector3(at.x, 0, at.z), level: 2.6 });
  boss.init();
  return { ...env, boss };
}

/** 玩家站在炉心殿圆心 angle 方向（facing 约定，弧度）、离圆心 r 米处 */
function placePlayer(env, angle, r) {
  const f = qilinDebug(env.boss).furnace;
  env.ctx.player.position.set(f.center.x + Math.sin(angle) * r, f.center.y, f.center.z + Math.cos(angle) * r);
  env.ctx.player.eye.copy(env.ctx.player.position).setY(env.ctx.player.position.y + 1.6);
  env.ctx.player.velocity.set(0, 0, 0);
}

/** 打断当前招式、强制下一招并推进到它结束（或 maxT 秒） */
function runMove(env, id, maxT = 10) {
  env.boss.abortCurrent();
  env.boss.queueMove(id);
  env.boss.restLeft = 0;
  let seen = false;
  for (let t = 0; t < maxT; t += DT) {
    step(env.ctx, env.boss, DT);
    if (env.boss.currentMove?.id === id) seen = true;
    else if (seen) return true;
  }
  return seen;
}

const KILL = { request: { base: 0, element: 'none', source: 'weapon', canCrit: false, procDepth: 0, tags: [] }, dealt: 1, isCrit: false, killed: true,
  layer: 'health', shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null };

/** 从玩家眼睛打 anchor：返回 { hit, headshot } */
function shoot(env, anchor) {
  env.boss.root.updateMatrixWorld(true);
  const target = anchor.getWorldPosition(new THREE.Vector3());
  const eye = env.ctx.player.eye.clone();
  const dir = target.clone().sub(eye).normalize();
  const out = { distance: 0, headshot: false };
  const hit = env.boss.raycastHit(eye, dir, 200, out);
  return { hit, headshot: out.headshot };
}

/** 一阶段：登场结束、站好 */
function afterEntrance(env, angle = Math.PI, r = 20) {
  placePlayer(env, angle, r);
  step(env.ctx, env.boss, 3.4);
}

/** 二阶段：越过 55%，等转换演出结束 */
function toPhase2(env) {
  const { boss, ctx } = env;
  boss.armor = 0;
  boss.hp = boss.maxHp * 0.54;
  step(ctx, boss, 5.6);
}

const yawOf = (f, p) => Math.atan2(p.x - f.center.x, p.z - f.center.z);

test('the furnace hall of 祝融炉心 is found from the inferno-5 lava mask and nav grid, not from hard-coded coordinates', () => {
  const env = makeCtx();
  const f = locateFurnace(env.ctx.nav, env.arena, env.L.whitebox.lava);
  const C = whiteboxPoint(plan, [55, 40]);
  assert.equal(f.found, true);
  assert.ok(Math.hypot(f.center.x - C.x, f.center.z - C.z) < 0.6, `pool centre ${f.center.x.toFixed(2)}, ${f.center.z.toFixed(2)}`);
  assert.ok(f.pool > 6.3 && f.pool < 8, `pool radius ${f.pool}`);
  assert.ok(f.wall > 22.5 && f.wall < 24.5, `hall wall ${f.wall}`);
  assert.equal(f.channels.length, 4, 'four radial lava channels');
  for (const deg of [-135, -45, 45, 135]) {
    assert.ok(f.channels.some(a => Math.abs(wrap(a - planAngle(deg))) < 0.06), `channel at plan ${deg}°: ${f.channels.map(a => a.toFixed(2))}`);
  }
  assert.ok(f.bridge[0] > 9 && f.bridge[0] < 11 && f.bridge[1] > 13 && f.bridge[1] < 15.5, `bridge ${f.bridge}`);
  for (const deg of [-90, 0, 90, 180]) assert.ok(f.quadrants.some(a => Math.abs(wrap(a - planAngle(deg))) < 0.06), `quadrant at plan ${deg}°`);
  // 换算成 Unity 的炉心殿（度）：四个象限、窄桥、跑道 = 墙内 3.2 m
  const u = QilinFurnace.fromLegacy(f);
  assert.equal(u.quadrantCount, 4);
  assert.ok(Math.abs(u.trackRadius - (f.wall - 3.2)) < 1e-6);
  for (let i = 0; i < 4; i++) assert.ok(f.quadrants.some(a => Math.abs(wrap(a - u.quadrantYaw(i) * DEG)) < 0.06), `Unity 象限 ${i}`);
  // 没有熔岩数据时退回导航识别（found = false），渠按对角线假设
  const fb = locateFurnace(env.ctx.nav, env.arena, null);
  assert.equal(fb.found, false);
  assert.equal(fb.channels.length, 4);
});

test('火麒麟 leaps out of the molten pool on the spawn side, then hangs four shootable chain locks on the hall wall', () => {
  const env = spawnBoss();
  const { boss } = env;
  const { furnace: f, form, cauldron } = qilinDebug(boss);
  assert.equal(form, 'xuan');
  assert.equal(boss.def.id, 'boss_qilin');
  assert.equal(QILIN_DEF.isBoss, true);
  assert.equal(boss.displayName, '火麒麟 · 玄鳞');
  // Unity 定档：难度 2.6 在 3.08 定档（28000 / 2400）下按难度等比折算
  assert.ok(Math.abs(boss.maxHp - Math.round(28000 * 2.6 / 3.08)) <= 1, `hp ${boss.maxHp}`);
  assert.ok(Math.abs(boss.maxArmor - Math.round(2400 * 2.6 / 3.08)) <= 1, `armor ${boss.maxArmor}`);
  // 刷新点在熔池北面：落在北侧池边（池外 4.5 m）
  const d = Math.hypot(boss.position.x - f.center.x, boss.position.z - f.center.z);
  assert.ok(Math.abs(d - (f.poolRadius + 4.5)) < 0.3, `lands on the pool rim (${d.toFixed(1)})`);
  assert.ok(boss.position.z < f.center.z, 'on the spawn (north) side');
  assert.equal(boss.untargetable, true, 'untargetable while leaping out');
  assert.equal(cauldron.state, 'hang');
  afterEntrance(env);
  assert.equal(boss.untargetable, false);
  assert.equal(boss.introDone, true);
  const locks = boss.lockList.filter(Boolean);
  assert.equal(locks.length, 4, 'four locks');
  for (const l of locks) {
    const r = Math.hypot(l.position.x - f.center.x, l.position.z - f.center.z);
    assert.ok(Math.abs(r - (f.wallRadius - 0.9)) < 0.8, `lock on the hall wall (${r.toFixed(1)})`);
    assert.ok(Math.abs(l.position.y + 0.75 - f.center.y - 12) < 0.3, `lock 12 m up (${(l.position.y - f.center.y).toFixed(1)})`);
    assert.equal(l.isBoss, false);
    assert.ok(Math.abs(l.maxHp - Math.round(110 * 2.6)) <= 1, 'lock hp 110 × difficulty');
  }
  const pearl = shoot(env, boss.weakAnchor);
  assert.equal(pearl.hit, true);
  assert.equal(pearl.headshot, true, 'the horn-root fire pearl is the weak spot');
  assert.ok(boss.getHeadCenter(new THREE.Vector3()).y > 5, 'pearl high on the head');
  boss.dispose();
});

test('phase 1: gallop leaves burning hoofprints then charges across a quadrant; scale blades are stopped by basalt pillars', () => {
  const env = spawnBoss();
  const { boss, ctx, log } = env;
  const { furnace: f, fx } = qilinDebug(boss);
  afterEntrance(env, planAngle(60), 16);
  let maxPrints = 0, charged = false, ran = false, chargeLength = 0;
  boss.queueMove('gallop');
  boss.restLeft = 0;
  for (let t = 0; t < 16; t += DT) {
    step(ctx, boss, DT);
    const m = boss.currentMove;
    if (m?.id !== 'gallop') { if (ran) break; continue; }
    ran = true;
    maxPrints = Math.max(maxPrints, fx.printCount);
    if (m.leg === 'charge') { charged = true; chargeLength = m.chargeLength; }
    if (m.leg === 'run' && m.stageT > 0.5) {
      const r = Math.hypot(boss.position.x - f.center.x, boss.position.z - f.center.z);
      assert.ok(r > f.wallRadius - 6 && r < f.wallRadius, `galloping on the outer track (${r.toFixed(1)})`);
    }
  }
  assert.ok(ran, 'gallop ran');
  assert.ok(maxPrints >= 8, `burning hoofprints (${maxPrints})`);
  assert.ok(charged, 'turned and charged across a quadrant');
  assert.ok(chargeLength > 0.5, `charge line ${chargeLength}`);

  // 张鳞：玩家躲在石柱后（石柱在熔池南偏东 70°、半径 13）——鳞刃撞柱就碎
  const pillar = planAngle(70);
  const at = r => new THREE.Vector3(f.center.x + Math.sin(pillar) * r, f.center.y, f.center.z + Math.cos(pillar) * r);
  boss.position.copy(at(8.5));
  boss.velocity.set(0, 0, 0);
  placePlayer(env, pillar, 17.5);
  const eye = ctx.player.position.clone().setY(1.2), from = boss.position.clone().setY(1.2);
  assert.equal(ctx.world.segmentBlocked(from, eye), true, 'the pillar is between the boss and the player');
  let hits = log.damage.length;
  assert.ok(runMove(env, 'scales', 6), 'scales ran');
  step(ctx, boss, 1.5);
  assert.equal(log.damage.length, hits, 'no blade gets through the pillar');
  // 空地上：被鳞刃打中（火伤）
  boss.position.copy(at(8.5));
  placePlayer(env, planAngle(90), 11);
  assert.equal(ctx.world.segmentBlocked(boss.position.clone().setY(1.2), ctx.player.position.clone().setY(1.2)), false);
  hits = log.damage.length;
  assert.ok(runMove(env, 'scales', 6), 'scales ran again');
  step(ctx, boss, 1.0);
  assert.ok(log.damage.length > hits, 'blades hit a player in the open');
  assert.ok(log.elements.includes('fire'));

  // 麟火：近处的玩家被吐火烧到
  placePlayer(env, planAngle(90), 11);
  boss.facing = Math.atan2(ctx.player.position.x - boss.position.x, ctx.player.position.z - boss.position.z);
  hits = log.damage.length;
  assert.ok(runMove(env, 'breath', 5), 'short fire breath ran');
  assert.ok(log.damage.length > hits, 'breath burns a close player in front');
  boss.dispose();
});

test('drinking at 85%: shooting the lock behind it drops a cauldron corner on it — staggered 4 s, scales cracked (×2, whole body weak)', () => {
  const env = spawnBoss();
  const { boss, ctx, log } = env;
  const { furnace: f, cauldron } = qilinDebug(boss);
  afterEntrance(env, planAngle(0), 18);
  // 先白费一个：不饮熔时打锁扣，鼎角砸空
  const wasted = boss.lockList.findIndex(Boolean);
  boss.lockList[wasted].onKilled(KILL);
  step(ctx, boss, 1.0);
  assert.equal(cauldron.droppedCorner, wasted, 'that corner dropped');
  assert.equal(qilinDebug(boss).crackLeft, 0, 'nothing hit');
  assert.equal(boss.wastedCorners, 1);
  assert.ok(log.toasts.some(t => t.includes('白费')), 'player told the corner was wasted');
  assert.equal(boss.staggered, false);

  boss.armor = 0;
  boss.hp = boss.maxHp * 0.84;
  let sipping = false;
  for (let t = 0; t < 16 && !sipping; t += DT) {
    step(ctx, boss, DT);
    sipping = boss.currentMove?.id === 'drink' && boss.sipping;
  }
  assert.ok(sipping, 'leapt to the pool rim to drink');
  assert.equal(boss.drinksQueued, 1);
  const q = boss.drinkQuadrant;
  assert.notEqual(q, wasted, 'drinks on a side whose lock is still there');
  const r = Math.hypot(boss.position.x - f.center.x, boss.position.z - f.center.z);
  assert.ok(Math.abs(r - (f.poolRadius + 3.1)) < 0.3, `on the pool rim, 3.1 m out (${r.toFixed(1)})`);
  assert.ok(Math.abs(wrapDeg(yawOf(f, boss.position) / DEG - f.quadrantYaw(q))) < 6, 'in front of its lock quadrant');
  assert.equal(boss.lockList[q].highlight, true, 'the lock to shoot glows');
  // 打碎它身后那个锁扣
  boss.lockList[q].onKilled(KILL);
  step(ctx, boss, 0.8);
  assert.equal(boss.staggered, true, 'staggered by the cauldron corner');
  assert.equal(boss.cauldronHits, 1);
  assert.ok(qilinDebug(boss).crackLeft > 3, 'scales cracked');
  assert.equal(boss.armor, 0);
  assert.equal(boss.damageTakenMult, 2, 'takes ×2 damage');
  boss.damageTakenMult = 1; // 状态系统每帧重置：硬直的承伤倍率照样叠在上面
  assert.equal(boss.damageTakenMult, 2);
  // 全身都算弱点：打胸口也是爆头
  placePlayer(env, f.quadrantYaw(q) * DEG + 0.6, f.poolRadius + 12);
  assert.equal(shoot(env, boss.F.pts.chest).headshot, true, 'cracked body counts as weak spot');
  step(ctx, boss, 4);
  assert.equal(boss.staggered, false);
  assert.equal(qilinDebug(boss).crackLeft, 0);
  assert.equal(boss.damageTakenMult, 1);
  assert.equal(shoot(env, boss.F.pts.chest).headshot, false, 'weak spot back to the pearl only');

  // 70%：这次不打锁扣，饮完鳞甲回满、伤害 × 1.08
  const dmg0 = boss.damageMult;
  boss.hp = boss.maxHp * 0.69;
  let done = false;
  for (let t = 0; t < 14 && !done; t += DT) {
    step(ctx, boss, DT);
    done = boss.drinksQueued === 2 && boss.drinksFinished === 1 && boss.currentMove?.id !== 'drink' && boss.armor === boss.maxArmor;
  }
  assert.ok(done, 'second drink refilled the scale armour');
  assert.ok(Math.abs(boss.damageMult - dmg0 * 1.08) < 1e-6, 'damage × 1.08 after drinking');
  boss.dispose();
});

test('crossing 55%: the remaining chains snap, the cauldron crashes into the pool (cover box), and 焚身 bursts out', () => {
  const env = spawnBoss();
  const { boss, ctx, log } = env;
  const { furnace: f, cauldron } = qilinDebug(boss);
  afterEntrance(env, Math.PI, 18);
  const boxes = ctx.world.boxes.length;
  boss.armor = 0;
  boss.hp = boss.maxHp * 0.54;
  step(ctx, boss, 0.3);
  assert.equal(boss.phase, 1);
  assert.equal(boss.transitioning, true);
  assert.equal(boss.untargetable, true, 'untargetable during the transition');
  assert.equal(qilinDebug(boss).form, 'xuan', 'still 玄鳞 while it leaps into the pool');
  assert.ok(boss.lockList.every(l => l === null), 'locks removed with the chains');
  step(ctx, boss, 1.4);
  assert.equal(cauldron.state, 'fallen');
  assert.equal(ctx.world.boxes.length, boxes + 1, 'the overturned cauldron is a cover box in the pool');
  assert.ok(ctx.world.segmentBlocked(new THREE.Vector3(f.center.x - 6, 1.5, f.center.z), new THREE.Vector3(f.center.x + 6, 1.5, f.center.z)), 'cauldron blocks a line across the pool');
  // 逻辑位置 1.1 s 扎进熔池（瞬移到池里）
  assert.ok(Math.hypot(boss.position.x - f.center.x, boss.position.z - f.center.z) < f.poolRadius, 'capsule warped into the pool');
  step(ctx, boss, 0.6);
  assert.equal(qilinDebug(boss).form, 'burn', 'model swapped inside the lava column');
  assert.equal(boss.model.getObjectByName('qilin_burn_host').visible, true);
  assert.equal(boss.model.getObjectByName('qilin_xuan_host').visible, false);
  assert.equal(boss.displayName, '火麒麟 · 焚身');
  assert.ok(log.setBoss.includes(boss), 'boss bar renamed');
  assert.equal(boss.armor, 0, 'scales burst off');
  assert.equal(boss.hitShapes.filter(s => s.weak).length, 2, 'chest fire heart + horn pearl');
  step(ctx, boss, 3.6);
  assert.equal(boss.untargetable, false, 'transition finished');
  const r = Math.hypot(boss.position.x - f.center.x, boss.position.z - f.center.z);
  assert.ok(r > f.poolRadius, `landed on the far bank, out of the pool (${r.toFixed(1)})`);
  step(ctx, boss, 1.5);
  assert.ok(boss.position.y - f.center.y > 2.5, `焚身 runs in the air (${(boss.position.y - f.center.y).toFixed(1)} m)`);
  boss.dispose();
});

test('phase 2: rotating lava-channel floods widen the two channels of one quadrant at a time (clockwise, Unity order) through LavaSystem.addLavaArea', () => {
  const env = spawnBoss();
  const { boss, ctx } = env;
  const lava = ctx.stage.lavaSystem;
  const mask0 = lava.lava.mask.slice();
  const rects0 = lava.lava.rects.length;
  afterEntrance(env, Math.PI, 18);
  toPhase2(env);
  const { furnace: f } = qilinDebug(boss);
  const start = f.quadrantOf(ctx.player.position);
  const order = [];
  let quiet = 0;
  for (let t = 0; t < 45; t += DT) {
    step(ctx, boss, DT);
    const q = boss.flood?.floodingQuadrant ?? -1;
    if (q >= 0 && order[order.length - 1] !== q) {
      order.push(q);
      // 涨宽的渠：带子中心是熔岩，导航不可走
      for (const s of floodStrips(f, q)) {
        assert.equal(onLava(lava.lava, s.center.x, s.center.z), true, `flooded strip of quadrant ${q} is lava`);
        assert.equal(ctx.nav.isWalkable(s.center.x, s.center.z), false, 'and blocked for ground enemies');
      }
      assert.equal(lava.lavaAreas, 2, 'two widened channels at a time');
      assert.ok(lava.lava.rects.length > rects0);
    }
    if (order.length === 4 && (boss.flood?.floodingQuadrant ?? -1) < 0 && ++quiet > 60) break;
  }
  assert.equal(order.length, 4, `flooded every quadrant once: ${order}`);
  assert.equal(order[0], start, 'starts at the player\'s quadrant');
  for (let i = 1; i < 4; i++) {
    const d = wrapDeg(f.quadrantYaw(order[i]) - f.quadrantYaw(order[i - 1]));
    assert.ok(Math.abs(d - 90) < 6, `clockwise in Unity terms (yaw increasing): step ${i} turns ${d.toFixed(1)}°`);
  }
  assert.equal(lava.lavaAreas, 0, 'floods drained');
  assert.deepEqual(lava.lava.mask, mask0, 'lava mask restored');
  assert.equal(lava.lava.rects.length, rects0);
  boss.dispose();
});

test('phase 2: three fire-ring dives then a panting landing (chest heart weak spot); breath sweep is stopped by the fallen cauldron', () => {
  const env = spawnBoss();
  const { boss, ctx, log } = env;
  afterEntrance(env, Math.PI, 18);
  toPhase2(env);
  const { furnace: f } = qilinDebug(boss);
  step(ctx, boss, 3);
  placePlayer(env, planAngle(30), 18);
  const waves0 = boss.hazards.waves.length;
  boss.abortCurrent();
  boss.queueMove('burn_dives');
  boss.restLeft = 0;
  let stomps = 0, prev = '', rings = 0, panting = false;
  for (let t = 0; t < 16 && !panting; t += DT) {
    step(ctx, boss, DT);
    rings = Math.max(rings, boss.hazards.waves.length);
    const m = boss.currentMove;
    const leg = m?.id === 'burn_dives' ? m.leg : '';
    if (leg === 'recover' && prev !== 'recover') stomps++;
    prev = leg;
    panting = m?.id === 'burn_pant' && m.stage === 'active';
  }
  assert.equal(stomps, 3, 'three dives');
  assert.ok(rings > waves0, 'each stomp throws a ground fire ring');
  assert.ok(panting, 'lands panting after the third dive');
  step(ctx, boss, 0.6);
  assert.ok(boss.position.y - f.center.y < 0.6, 'on the floor while panting');
  assert.equal(onLava(ctx.stage.lavaSystem.lava, boss.position.x, boss.position.z), false, 'panting spot is floor, not lava');
  assert.equal(boss.heartBright, true, 'chest fire heart blazes');
  const front = boss.position.clone().add(new THREE.Vector3(Math.sin(boss.facing) * 12, 0, Math.cos(boss.facing) * 12));
  ctx.player.position.copy(front).setY(f.center.y);
  ctx.player.eye.copy(ctx.player.position).setY(f.center.y + 1.6);
  assert.equal(shoot(env, boss.F.pts.heart).headshot, true, 'chest fire heart is a weak spot');
  step(ctx, boss, 4);

  // 吐息扫象限：站在南象限（facing 0）、熔池正对面（倒鼎挡着）不受伤；站在空地被烧
  const southAt = new THREE.Vector3(f.center.x, f.center.y, f.center.z + 18);
  const q = f.quadrantOf(southAt);
  assert.ok(Math.abs(wrapDeg(f.quadrantYaw(q))) < 6);
  placePlayer(env, f.quadrantYaw(q) * DEG, 18);
  let hits = log.damage.length;
  assert.ok(runMove(env, 'burn_sweep', 9), 'sweep ran');
  assert.equal(log.damage.length, hits, 'behind the fallen cauldron: safe');
  placePlayer(env, f.quadrantYaw(q) * DEG + 0.55, 19);
  hits = log.damage.length;
  assert.ok(runMove(env, 'burn_sweep', 9), 'sweep ran again');
  assert.ok(log.damage.length > hits, 'the sweep burns a player in the open');
  // 火云雨：每颗火球都有落点预警
  const warns = log.warnings;
  assert.ok(runMove(env, 'burn_rain', 6), 'fire-cloud rain ran');
  assert.ok(log.warnings >= warns + 10, 'every meteor has a landing warning');
  // 死亡：熔流清空，3.4 秒后移除
  boss.onKilled(KILL);
  step(ctx, boss, 3.6);
  assert.equal(boss.removed, true);
  assert.equal(ctx.stage.lavaSystem.lavaAreas, 0);
  boss.dispose();
});

test('LavaSystem.addLavaArea: temporary lava updates the mask, nav and the safe spot, and remove() restores everything', () => {
  const env = makeCtx();
  const { ctx, L } = env;
  const lava = ctx.stage.lavaSystem;
  const f = locateFurnace(ctx.nav, env.arena, L.whitebox.lava);
  const mask0 = lava.lava.mask.slice();
  const { polygons } = floodShapes(f, 1);
  const p = polygons[0];
  const cx = p.reduce((s, q) => s + q[0], 0) / 4, cz = p.reduce((s, q) => s + q[1], 0) / 4;
  assert.equal(onLava(lava.lava, cx, cz), false);
  assert.equal(ctx.nav.isWalkable(cx, cz), true);
  lava.safe.set(cx, 0, cz);
  const flood = lava.addLavaArea(p, { rise: 0.4 });
  assert.ok(flood.cells > 20, `cells ${flood.cells}`);
  assert.equal(flood.active, true);
  assert.equal(onLava(lava.lava, cx, cz), true);
  assert.equal(ctx.nav.isWalkable(cx, cz), false, 'nav rebuilt with the new lava');
  assert.ok(Math.hypot(lava.safe.x - cx, lava.safe.z - cz) > 0.5, 'safe spot moved off the new lava');
  assert.equal(onLava(lava.lava, lava.safe.x, lava.safe.z), false);
  lava.update(0.5, 0.5);
  assert.ok(lava.group.getObjectByName('lava-flood'), 'flood surface mesh');
  flood.remove();
  flood.remove();
  assert.equal(flood.active, false);
  assert.deepEqual(lava.lava.mask, mask0, 'mask restored');
  assert.equal(ctx.nav.isWalkable(cx, cz), true, 'nav restored');
  lava.update(1, 1);
  assert.equal(lava.group.getObjectByName('lava-flood'), undefined, 'flood surface drained and released');
  lava.addLavaArea(p);
  lava.dispose();
  assert.deepEqual(L.whitebox.lava.mask, mask0, 'dispose restores the shared layout lava data');
});

test('without lava data (fallback arena) 火麒麟 still runs both phases headlessly; floods hurt through its own lava sheets', () => {
  const env = spawnBoss(false);
  const { boss, ctx, log } = env;
  afterEntrance(env, Math.PI, 18);
  assert.equal(qilinDebug(boss).furnace.found, false);
  assert.ok(runMove(env, 'scales', 6));
  toPhase2(env);
  assert.equal(qilinDebug(boss).form, 'burn');
  // 没有熔岩系统：熔流带自己的熔岩面，站在里面贴地被烧
  const f = qilinDebug(boss).furnace;
  let burned = false;
  for (let t = 0; t < 30 && !burned; t += DT) {
    step(ctx, boss, DT);
    const q = boss.flood?.floodingQuadrant ?? -1;
    if (q < 0) continue;
    const s = floodStrips(f, q)[0];
    ctx.player.position.set(s.center.x, f.center.y, s.center.z);
    const n = log.damage.length;
    step(ctx, boss, 0.6);
    burned = log.damage.length > n && boss.flood.flooded(ctx.player.position);
  }
  assert.ok(burned, 'standing in a widened channel burns');
  step(ctx, boss, 10);
  assert.ok(boss.alive);
  boss.dispose();
});

test('soak: 90 s of free move choice in each phase keeps 火麒麟 inside the hall, at a sane height, with finite state', () => {
  const env = spawnBoss();
  const { boss, ctx } = env;
  const { furnace: f } = qilinDebug(boss);
  afterEntrance(env, Math.PI, 18);
  const seen = new Set();
  const run = (seconds, maxAlt) => {
    for (let t = 0; t < seconds; t += DT) {
      const a = ctx.time.now * 0.15;
      placePlayer(env, a, 16);
      step(ctx, boss, DT);
      if (boss.currentMove) seen.add(boss.currentMove.id);
      const p = boss.position;
      assert.ok(Number.isFinite(p.x + p.y + p.z), 'finite position');
      const r = Math.hypot(p.x - f.center.x, p.z - f.center.z);
      assert.ok(r < f.wallRadius + 1, `inside the hall (${r.toFixed(1)} m at ${ctx.time.now.toFixed(1)} s, ${boss.currentMove?.id})`);
      const m = boss.currentMove;
      assert.ok(p.y - f.center.y > -0.5 && p.y - f.center.y < maxAlt,
        `height ${(p.y - f.center.y).toFixed(1)} (${m?.id} ${m?.stage} ${m?.leg ?? ''}) at ${p.x.toFixed(1)}, ${p.z.toFixed(1)} r ${r.toFixed(1)}, target ${m?.target ? m.target.toArray().map(v => v.toFixed(1)) : '-'}, fly ${boss.flyTargetY.toFixed(1)}`);
    }
  };
  run(90, 7.5);
  for (const id of ['gallop', 'scales']) assert.ok(seen.has(id), `phase 1 used ${id}: ${[...seen]}`);
  boss.armor = 0;
  boss.hp = boss.maxHp * 0.54;
  run(95, 10);
  for (const id of ['burn_flood', 'burn_dives', 'burn_pant', 'burn_sweep', 'burn_rain']) assert.ok(seen.has(id), `phase 2 used ${id}: ${[...seen]}`);
  assert.equal(qilinDebug(boss).form, 'burn');
  // 15% 狂怒：排上狂怒长啸，熔流按狂怒重开
  boss.hp = boss.maxHp * 0.12;
  let roared = false;
  for (let t = 0; t < 12 && !roared; t += DT) {
    step(ctx, boss, DT);
    roared = boss.rageRoars > 0;
  }
  assert.equal(boss.enraged, true);
  assert.ok(roared, 'rage roar sent the fire wave');
  boss.dispose();
});

test('Unity 3-4：炉心殿按场景文档的首领场地 + Level_3_4 常量建，场景里的吊鼎 / 锁扣正式件被认领并跟着动', () => {
  let art = null;
  const lockArt = [];
  const env = spawnBoss(false, (e) => {
    const C = whiteboxPoint(plan, [55, 40]);
    e.ctx.stage.unityDocument = { bosses: [{ id: 'boss_qilin', center: [C.x, 0, C.z], floorY: e.L.floorY, radius: 23.5 }] };
    // 场景视图画的静态正式件：吊鼎在鼎身中心下 4.2 m（足底），锁扣在四个象限中线上、离圆心 23.67 m、离地 10.8 m
    const view = new THREE.Group();
    art = new THREE.Group();
    art.name = 'SM_Prop_QilinCauldron_LOD0';
    art.position.set(C.x, e.L.floorY + 3, C.z);
    view.add(art);
    for (const yaw of [-90, 0, 90, 180]) {
      const l = new THREE.Group();
      l.name = 'SM_Prop_QilinChainLock_LOD0';
      l.position.set(C.x + Math.sin(yaw * DEG) * 23.67, e.L.floorY + 10.8, C.z + Math.cos(yaw * DEG) * 23.67);
      view.add(l);
      lockArt.push(l);
    }
    e.ctx.scene.add(view);
  });
  const { boss, ctx } = env;
  const f = qilinDebug(boss).furnace;
  assert.equal(f.poolRadius, 7);
  assert.equal(f.wallRadius, 24);
  assert.equal(f.trackRadius, 20.8);
  assert.equal(f.mouths.length, 2, '两座炉口');
  assert.equal(f.vents.length, 2, '两处高排烟口');
  assert.equal(boss.arenaRadius, 23.5);
  assert.equal(qilinDebug(boss).cauldron.hasArt, true, '吊鼎正式件被认领');
  afterEntrance(env, Math.PI, 18);
  const locks = boss.lockList.filter(Boolean);
  assert.equal(locks.length, 4);
  for (const l of locks) assert.ok(Math.abs(l.position.y + 0.75 - (f.center.y + 12)) < 1e-6);
  // 打碎一个锁扣：鼎角坠下，正式件跟着鼎走；锁扣的正式件随锁身掉下去、移除后藏起来
  const before = art.position.clone();
  const i = boss.lockList.findIndex(Boolean);
  boss.lockList[i].onKilled(KILL);
  step(ctx, boss, 1.2);
  assert.ok(art.position.distanceTo(before) > 0.5, `吊鼎正式件跟着倾倒（移动 ${art.position.distanceTo(before).toFixed(2)} m）`);
  assert.equal(lockArt.filter(o => !o.visible).length, 1, '碎掉的锁扣正式件藏起来');
  boss.dispose();
});
