// 火麒麟（boss_qilin）无头回归：在真实的祝融炉心殿（inferno-5 V2 白盒：熔岩掩码 + 导航网格 + 熔岩系统）上找炉心殿几何，
// 构造首领，推进一阶段玄鳞的招式（踏火奔驰、张鳞、麟火、饮熔 + 锁扣坠鼎），强制越过 55% 血线验证巨鼎坠池、换成焚身，
// 再推进焚身的熔流轮转（LavaSystem.addLavaArea 临时熔岩）、三连俯冲 → 喘息、吐息扫象限（石柱 / 倒鼎挡得住）。
// 渲染与美术资产不参与：EnemyArt 换成空实现（等同 ?classic 的程序化兜底模型）。Math.random 用固定种子。
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
const { LavaSystem, onLava } = await import(await ts('../src/world/Lava.ts'));

const partsUrl = await ts('../src/enemies/bosses/parts.ts');
const visualsUrl = await ts('../src/enemies/bosses/Visuals.ts');
const hazardsUrl = await ts('../src/enemies/bosses/Hazards.ts', { '../../core/math': mathUrl, './Visuals': visualsUrl, './parts': partsUrl });
const enemyBaseUrl = await ts('../src/enemies/EnemyBase.ts', { '../core/types': typesUrl, '../core/math': mathUrl });
const tokensUrl = await ts('../src/enemies/AttackTokens.ts');
const registryUrl = await ts('../src/enemies/Registry.ts');
const { registerEnemy } = await import(registryUrl);
const artStub = data('export function attachEnemyArt(){ return { body: null, native: null, parts: [] }; }');
const bossBaseUrl = await ts('../src/enemies/bosses/BossBase.ts', {
  '../EnemyBase': enemyBaseUrl, '../AttackTokens': tokensUrl, '../../core/math': mathUrl, './Hazards': hazardsUrl, '../../assets/EnemyArt': artStub,
});
const kunArenaUrl = await ts('../src/enemies/bosses/KunPengArena.ts');
const arenaUrl = await ts('../src/enemies/bosses/QilinArena.ts', { './KunPengArena': kunArenaUrl });
const { locateFurnace, furnacePoint, floodShapes } = await import(arenaUrl);
const kunModelUrl = await ts('../src/enemies/bosses/KunPengModel.ts', { './parts': partsUrl });
const modelUrl = await ts('../src/enemies/bosses/QilinModel.ts', { './parts': partsUrl, './KunPengModel': kunModelUrl });
const cauldronUrl = await ts('../src/enemies/bosses/QilinCauldron.ts', { './parts': partsUrl });
const fxUrl = await ts('../src/enemies/bosses/QilinFx.ts');
const lockUrl = await ts('../src/enemies/bosses/QilinLock.ts', { '../EnemyBase': enemyBaseUrl, './parts': partsUrl });
const { QilinLock, QILIN_LOCK_DEF } = await import(lockUrl);
const { Qilin, QILIN_DEF, qilinDebug } = await import(await ts('../src/enemies/bosses/Qilin.ts', {
  '../../core/math': mathUrl, './BossBase': bossBaseUrl, '../../assets/EnemyArt': artStub, '../AttackTokens': tokensUrl, '../Registry': registryUrl,
  './QilinArena': arenaUrl, './QilinCauldron': cauldronUrl, './QilinFx': fxUrl, './QilinLock': lockUrl, './QilinModel': modelUrl,
  './KunPengModel': kunModelUrl, './parts': partsUrl,
}));
registerEnemy(QILIN_LOCK_DEF, (ctx, opts) => new QilinLock(ctx, opts));

const plan = WHITEBOX_REDESIGN_PLANS.find(p => p.id === 'inferno-5-v2');
const DT = 1 / 30;
const TAU = Math.PI * 2;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
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
    stage: { arena, stage: { theme: 'inferno' }, lavaSystem: null },
    scene: new THREE.Scene(), stageGroup: new THREE.Group(), renderer: null, settings: { quality: 'high' },
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
  if (withLava) {
    ctx.stage.lavaSystem = new LavaSystem(ctx, L.whitebox.lava, L.floorY, arena.playerSpawn);
  }
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

function spawnBoss(withLava = true) {
  const env = makeCtx(withLava);
  const at = whiteboxPoint(plan, plan.encounters.find(e => e.id === 'BOSS').at);
  const boss = new Qilin(env.ctx, { position: new THREE.Vector3(at.x, 0, at.z), level: 2.6 });
  boss.init();
  return { ...env, boss };
}

/** 玩家站在炉心殿圆心 angle 方向（facing 约定）、离圆心 r 米处 */
function placePlayer(env, angle, r) {
  const f = qilinDebug(env.boss).furnace;
  env.ctx.player.position.set(f.center.x + Math.sin(angle) * r, f.center.y, f.center.z + Math.cos(angle) * r);
  env.ctx.player.eye.copy(env.ctx.player.position).setY(env.ctx.player.position.y + 1.6);
  env.ctx.player.velocity.set(0, 0, 0);
}

/** 打断当前招式、强制下一招并推进到它结束（或 maxT 秒） */
function runMove(env, id, maxT = 10) {
  if (env.boss.current) env.boss.abortMove();
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

test('the furnace hall of 祝融炉心 is found from the inferno-5 lava mask and nav grid, not from hard-coded coordinates', () => {
  const env = makeCtx();
  const f = locateFurnace(env.ctx.nav, env.arena, env.L.whitebox.lava);
  const C = whiteboxPoint(plan, [55, 40]);
  assert.equal(f.found, true);
  assert.ok(Math.hypot(f.center.x - C.x, f.center.z - C.z) < 0.6, `pool centre ${f.center.x.toFixed(2)}, ${f.center.z.toFixed(2)}`);
  assert.ok(f.pool > 6.3 && f.pool < 8, `pool radius ${f.pool}`);
  assert.ok(f.wall > 22.5 && f.wall < 24.5, `hall wall ${f.wall}`);
  assert.equal(f.channels.length, 4, 'four radial lava channels');
  // 渠在西北、东北、东南、西南四条对角线上
  for (const deg of [-135, -45, 45, 135]) {
    assert.ok(f.channels.some(a => Math.abs(wrap(a - planAngle(deg))) < 0.06), `channel at plan ${deg}°: ${f.channels.map(a => a.toFixed(2))}`);
  }
  assert.ok(f.bridge[0] > 9 && f.bridge[0] < 11 && f.bridge[1] > 13 && f.bridge[1] < 15.5, `bridge ${f.bridge}`);
  // 象限中线 = 东南西北（锁扣方向）
  for (const deg of [-90, 0, 90, 180]) assert.ok(f.quadrants.some(a => Math.abs(wrap(a - planAngle(deg))) < 0.06), `quadrant at plan ${deg}°`);
  // 没有熔岩数据时退回导航识别（found = false），渠按对角线假设
  const fb = locateFurnace(env.ctx.nav, env.arena, null);
  assert.equal(fb.found, false);
  assert.equal(fb.channels.length, 4);
});

test('火麒麟 leaps out of the molten pool on the spawn side, then hangs four shootable chain locks on the hall wall', () => {
  const env = spawnBoss();
  const { boss, ctx } = env;
  const { furnace: f, form, cauldron } = qilinDebug(boss);
  assert.equal(form, 'xuan');
  assert.equal(boss.def.id, 'boss_qilin');
  assert.equal(QILIN_DEF.isBoss, true);
  assert.equal(boss.displayName, '火麒麟 · 玄鳞');
  assert.ok(boss.maxArmor > 0, 'black-iron scale armour layer');
  // 刷新点在熔池北面：落在北侧池边
  const d = Math.hypot(boss.position.x - f.center.x, boss.position.z - f.center.z);
  assert.ok(d > f.pool && d < f.pool + 6, `lands on the pool rim (${d.toFixed(1)})`);
  assert.ok(boss.position.z < f.center.z, 'on the spawn (north) side');
  assert.equal(boss.untargetable, true, 'untargetable while leaping out');
  assert.equal(cauldron.state, 'hang');
  afterEntrance(env);
  assert.equal(boss.untargetable, false);
  const locks = boss.lockList.filter(Boolean);
  assert.equal(locks.length, 4, 'four locks');
  for (const l of locks) {
    const r = Math.hypot(l.position.x - f.center.x, l.position.z - f.center.z);
    assert.ok(Math.abs(r - (f.wall - 0.5)) < 0.8, `lock on the hall wall (${r.toFixed(1)})`);
    assert.ok(l.position.y - f.center.y > 2.5 && l.position.y - f.center.y < 4.5, 'lock 3–4 m up');
    assert.equal(l.isBoss, false);
  }
  // 角根火珠是弱点
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
  let maxPrints = 0, charged = false, ran = false;
  boss.queueMove('gallop');
  boss.restLeft = 0;
  for (let t = 0; t < 14; t += DT) {
    step(ctx, boss, DT);
    if (boss.current?.id !== 'gallop') { if (ran) break; continue; }
    ran = true;
    maxPrints = Math.max(maxPrints, fx.printCount);
    if (boss.gallopStage === 'charge') charged = true;
    // 奔驰时在外环跑道上
    if (boss.gallopStage === 'run' && boss.stageT > 0.5) {
      const r = Math.hypot(boss.position.x - f.center.x, boss.position.z - f.center.z);
      assert.ok(r > f.wall - 6 && r < f.wall, `galloping on the outer track (${r.toFixed(1)})`);
    }
  }
  assert.ok(ran, 'gallop ran');
  assert.ok(maxPrints >= 8, `burning hoofprints (${maxPrints})`);
  assert.ok(charged, 'turned and charged across a quadrant');
  assert.ok(boss.chargeLen > 9, `charge line ${boss.chargeLen}`);

  // 张鳞：玩家躲在石柱后（石柱在熔池南偏东 70°、半径 13）——鳞刃撞柱就碎
  const pillarDeg = 70;
  boss.position.copy(furnacePoint(f, planAngle(pillarDeg), 8.5, new THREE.Vector3()));
  boss.velocity.set(0, 0, 0);
  placePlayer(env, planAngle(pillarDeg), 17.5);
  const eye = ctx.player.position.clone().setY(1.2), from = boss.position.clone().setY(1.2);
  assert.equal(ctx.world.segmentBlocked(from, eye), true, 'the pillar is between the boss and the player');
  let hits = log.damage.length;
  assert.ok(runMove(env, 'scales', 6), 'scales ran');
  step(ctx, boss, 1.5);
  assert.equal(log.damage.length, hits, 'no blade gets through the pillar');
  // 空地上：被鳞刃打中（火伤）
  boss.position.copy(furnacePoint(f, planAngle(pillarDeg), 8.5, new THREE.Vector3()));
  placePlayer(env, planAngle(pillarDeg + 20), 11);
  assert.equal(ctx.world.segmentBlocked(boss.position.clone().setY(1.2), ctx.player.position.clone().setY(1.2)), false);
  hits = log.damage.length;
  assert.ok(runMove(env, 'scales', 6), 'scales ran again');
  step(ctx, boss, 1.0);
  assert.ok(log.damage.length > hits, 'blades hit a player in the open');
  assert.ok(log.elements.includes('fire'));

  // 麟火：近处的玩家被吐火烧到
  placePlayer(env, planAngle(pillarDeg + 20), 11);
  boss.facing = boss.yawToPlayer();
  hits = log.damage.length;
  assert.ok(runMove(env, 'breath', 5), 'short fire breath ran');
  assert.ok(log.damage.length > hits, 'breath burns a close player in front');
  boss.dispose();
});

test('drinking at 85%: shooting the lock behind it drops a cauldron corner on it — stunned 4 s, scales cracked (×2, whole body weak)', () => {
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
  assert.ok(log.toasts.some(t => t.includes('白费')), 'player told the corner was wasted');
  assert.notEqual(boss.current?.id, 'stunned');

  boss.armor = 0;
  boss.hp = boss.maxHp * 0.84;
  let sipping = false;
  for (let t = 0; t < 16 && !sipping; t += DT) {
    step(ctx, boss, DT);
    sipping = boss.current?.id === 'drink' && boss.drinkStage === 'sip';
  }
  assert.ok(sipping, 'leapt to the pool rim to drink');
  assert.equal(qilinDebug(boss).drinksDone, 1);
  const q = boss.drinkQ;
  assert.notEqual(q, wasted, 'drinks on a side whose lock is still there');
  const r = Math.hypot(boss.position.x - f.center.x, boss.position.z - f.center.z);
  assert.ok(r > f.pool && r < f.pool + 4.5, `on the pool rim (${r.toFixed(1)})`);
  assert.ok(Math.abs(wrap(Math.atan2(boss.position.x - f.center.x, boss.position.z - f.center.z) - f.quadrants[q])) < 0.1, 'in front of its lock quadrant');
  assert.equal(boss.lockList[q].highlight, true, 'the lock to shoot glows');
  // 打碎它身后那个锁扣
  boss.lockList[q].onKilled(KILL);
  step(ctx, boss, 0.8);
  assert.equal(boss.current?.id, 'stunned', 'stunned by the cauldron corner');
  assert.ok(qilinDebug(boss).crackLeft > 3, 'scales cracked');
  assert.equal(boss.armor, 0);
  assert.equal(boss.damageTakenMult, 2, 'takes ×2 damage');
  boss.damageTakenMult = 1; // 状态系统每帧重置：崩裂倍率照样叠在上面
  assert.equal(boss.damageTakenMult, 2);
  // 全身都算弱点：打胸口也是爆头
  placePlayer(env, f.quadrants[q] + 0.6, f.pool + 12);
  assert.equal(shoot(env, boss.F.pts.chest).headshot, true, 'cracked body counts as weak spot');
  step(ctx, boss, 4);
  assert.notEqual(boss.current?.id, 'stunned');
  assert.equal(qilinDebug(boss).crackLeft, 0);
  assert.equal(boss.damageTakenMult, 1);
  assert.equal(shoot(env, boss.F.pts.chest).headshot, false, 'weak spot back to the pearl only');

  // 70%：这次不打锁扣，饮完鳞甲回满
  boss.hp = boss.maxHp * 0.69;
  let done = false;
  for (let t = 0; t < 12 && !done; t += DT) {
    step(ctx, boss, DT);
    done = qilinDebug(boss).drinksDone === 2 && boss.current?.id !== 'drink' && boss.armor === boss.maxArmor;
  }
  assert.ok(done, 'second drink refilled the scale armour');
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
  assert.equal(boss.untargetable, true, 'untargetable during the transition');
  assert.equal(qilinDebug(boss).form, 'xuan', 'still 玄鳞 while it leaps into the pool');
  assert.ok(boss.lockList.every(l => l === null), 'locks removed with the chains');
  step(ctx, boss, 1.4);
  assert.equal(cauldron.state, 'fallen');
  assert.equal(ctx.world.boxes.length, boxes + 1, 'the overturned cauldron is a cover box in the pool');
  assert.ok(ctx.world.segmentBlocked(new THREE.Vector3(f.center.x - 6, 1.5, f.center.z), new THREE.Vector3(f.center.x + 6, 1.5, f.center.z)), 'cauldron blocks a line across the pool');
  step(ctx, boss, 0.6);
  assert.equal(qilinDebug(boss).form, 'burn', 'model swapped inside the lava column');
  assert.equal(boss.model.getObjectByName('qilin_burn_host').visible, true);
  assert.equal(boss.model.getObjectByName('qilin_xuan_host').visible, false);
  assert.equal(boss.displayName, '火麒麟 · 焚身');
  assert.ok(log.setBoss.includes(boss), 'boss bar renamed');
  assert.equal(boss.armor, 0, 'scales burst off');
  const weak = boss.hitShapes.filter(s => s.weak);
  assert.equal(weak.length, 2, 'chest fire heart + horn pearl');
  step(ctx, boss, 3.6);
  assert.equal(boss.untargetable, false, 'transition finished');
  assert.ok(boss.position.y - f.center.y > 2.5, `焚身 runs in the air (${(boss.position.y - f.center.y).toFixed(1)} m)`);
  boss.dispose();
});

test('phase 2: rotating lava-channel floods widen the two channels of one quadrant at a time (clockwise) through LavaSystem.addLavaArea', () => {
  const env = spawnBoss();
  const { boss, ctx } = env;
  const lava = ctx.stage.lavaSystem;
  const mask0 = lava.lava.mask.slice();
  const rects0 = lava.lava.rects.length;
  afterEntrance(env, Math.PI, 18);
  toPhase2(env);
  const { furnace: f } = qilinDebug(boss);
  // 转换结束后第一招就是熔流轮转（排队）
  const order = [];
  let quiet = 0;
  for (let t = 0; t < 45; t += DT) {
    step(ctx, boss, DT);
    const q = boss.floodingQuadrant;
    if (q >= 0 && order[order.length - 1] !== q) {
      order.push(q);
      // 涨宽的渠：多边形里的点是熔岩，导航不可走；渠外侧象限里离渠远的地方不受影响
      const poly = floodShapes(f, q).polygons[0];
      const cx = poly.reduce((s, p) => s + p[0], 0) / 4, cz = poly.reduce((s, p) => s + p[1], 0) / 4;
      assert.equal(onLava(lava.lava, cx, cz), true, `flooded strip of quadrant ${q} is lava`);
      assert.equal(ctx.nav.isWalkable(cx, cz), false, 'and blocked for ground enemies');
      assert.equal(lava.lavaAreas, 2, 'two widened channels at a time');
      assert.ok(lava.lava.rects.length > rects0);
    }
    if (order.length === 4 && boss.floodingQuadrant < 0 && ++quiet > 60) break;
  }
  assert.equal(order.length, 4, `flooded every quadrant once: ${order}`);
  assert.equal(order[0], 3, 'starts at the player\'s (north) quadrant');
  for (let i = 1; i < 4; i++) {
    const d = wrap(f.quadrants[order[i]] - f.quadrants[order[i - 1]]);
    assert.ok(Math.abs(d + Math.PI / 2) < 0.1, `clockwise seen from above (north up): step ${i} turns ${d.toFixed(2)}`);
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
  if (boss.current) boss.abortMove();
  boss.queueMove('dives');
  boss.restLeft = 0;
  let stomps = 0, prev = '', rings = 0;
  let panting = false;
  for (let t = 0; t < 16 && !panting; t += DT) {
    step(ctx, boss, DT);
    rings = Math.max(rings, boss.hazards.waves.length);
    if (boss.current?.id === 'dives' && boss.diveStage === 'recover' && prev !== 'recover') stomps++;
    prev = boss.current?.id === 'dives' ? boss.diveStage : '';
    panting = boss.current?.id === 'pant' && boss.pantStage === 'rest';
  }
  assert.equal(stomps, 3, 'three dives');
  assert.ok(rings > waves0, 'each stomp throws a ground fire ring');
  assert.ok(panting, 'lands panting after the third dive');
  step(ctx, boss, 0.6);
  assert.ok(boss.position.y - f.center.y < 0.6, 'on the floor while panting');
  assert.equal(onLava(ctx.stage.lavaSystem.lava, boss.position.x, boss.position.z), false, 'panting spot is floor, not lava');
  // 站在它正前方 12 米
  const front = boss.position.clone().add(new THREE.Vector3(Math.sin(boss.facing) * 12, 0, Math.cos(boss.facing) * 12));
  ctx.player.position.copy(front).setY(f.center.y);
  ctx.player.eye.copy(ctx.player.position).setY(f.center.y + 1.6);
  assert.equal(shoot(env, boss.F.pts.heart).headshot, true, 'chest fire heart is a weak spot');
  step(ctx, boss, 4);

  // 吐息扫象限：站在南象限、熔池正对面（倒鼎挡着）不受伤；站在空地被烧
  const q = 1; // 南（facing 0）
  assert.ok(Math.abs(wrap(f.quadrants[q])) < 0.1);
  placePlayer(env, f.quadrants[q], 18);
  let hits = log.damage.length;
  assert.ok(runMove(env, 'sweep', 9), 'sweep ran');
  assert.equal(log.damage.length, hits, 'behind the fallen cauldron: safe');
  // 空地：南象限偏东 30°（不在石柱后、不在倒鼎后）
  placePlayer(env, f.quadrants[q] + 0.55, 19);
  hits = log.damage.length;
  assert.ok(runMove(env, 'sweep', 9), 'sweep ran again');
  assert.ok(log.damage.length > hits, 'the sweep burns a player in the open');
  // 火云雨：每颗火球都有落点预警
  const warns = log.warnings;
  assert.ok(runMove(env, 'rain', 6), 'fire-cloud rain ran');
  assert.ok(log.warnings >= warns + 10, 'every meteor has a landing warning');
  // 死亡：floods 清空，3.4 秒后移除
  boss.onKilled(KILL);
  step(ctx, boss, 3.6);
  assert.equal(boss.removed, true);
  assert.equal(ctx.stage.lavaSystem.lavaAreas, 0);
  boss.dispose();
});

function furnaceAngleOf(f, p) {
  return Math.atan2(p.x - f.center.x, p.z - f.center.z);
}

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
  // 玩家的托回点就在要淹的地方
  lava.safe.set(cx, 0, cz);
  const flood = lava.addLavaArea(p, { rise: 0.4 });
  assert.ok(flood.cells > 20, `cells ${flood.cells}`);
  assert.equal(flood.active, true);
  assert.equal(onLava(lava.lava, cx, cz), true);
  assert.equal(ctx.nav.isWalkable(cx, cz), false, 'nav rebuilt with the new lava');
  assert.ok(Math.hypot(lava.safe.x - cx, lava.safe.z - cz) > 0.5, 'safe spot moved off the new lava');
  assert.equal(onLava(lava.lava, lava.safe.x, lava.safe.z), false);
  // 熔岩面：一张临时网格涌上来
  lava.update(0.5, 0.5);
  assert.ok(lava.group.getObjectByName('lava-flood'), 'flood surface mesh');
  flood.remove();
  flood.remove();
  assert.equal(flood.active, false);
  assert.deepEqual(lava.lava.mask, mask0, 'mask restored');
  assert.equal(ctx.nav.isWalkable(cx, cz), true, 'nav restored');
  lava.update(1, 1);
  assert.equal(lava.group.getObjectByName('lava-flood'), undefined, 'flood surface drained and released');
  // 卸载时还原关卡数据
  lava.addLavaArea(p);
  lava.dispose();
  assert.deepEqual(L.whitebox.lava.mask, mask0, 'dispose restores the shared layout lava data');
});

test('without lava data (fallback arena) 火麒麟 still runs both phases headlessly', () => {
  const env = spawnBoss(false);
  const { boss, ctx } = env;
  afterEntrance(env, Math.PI, 18);
  assert.equal(qilinDebug(boss).furnace.found, false);
  assert.ok(runMove(env, 'scales', 6));
  toPhase2(env);
  assert.equal(qilinDebug(boss).form, 'burn');
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
      // 玩家沿半径 16 米的圈慢慢绕
      const a = ctx.time.now * 0.15;
      placePlayer(env, a, 16);
      step(ctx, boss, DT);
      if (boss.current) seen.add(boss.current.id);
      const p = boss.position;
      assert.ok(Number.isFinite(p.x + p.y + p.z), 'finite position');
      const r = Math.hypot(p.x - f.center.x, p.z - f.center.z);
      assert.ok(r < f.wall + 1, `inside the hall (${r.toFixed(1)} m at ${ctx.time.now.toFixed(1)} s, ${boss.current?.id})`);
      assert.ok(p.y - f.center.y > -0.5 && p.y - f.center.y < maxAlt, `height ${(p.y - f.center.y).toFixed(1)} (${boss.current?.id})`);
    }
  };
  run(90, 7.5);
  for (const id of ['gallop', 'scales']) assert.ok(seen.has(id), `phase 1 used ${id}: ${[...seen]}`);
  boss.armor = 0;
  boss.hp = boss.maxHp * 0.54;
  run(95, 10);
  for (const id of ['flood', 'dives', 'pant', 'sweep', 'rain']) assert.ok(seen.has(id), `phase 2 used ${id}: ${[...seen]}`);
  assert.equal(qilinDebug(boss).form, 'burn');
  boss.dispose();
});
