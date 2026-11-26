// M8 战斗契约 / 带电 / 命中区 / 弹体对照（Unity Combat/、Enemies/HitZone.cs + EnemyBody.cs → 网页 src/combat/）。
// 常量和 Unity 版删除前从 C# 冻结的规格（tests/fixtures/spec/cs-consts.json、combat.json）比；行为断言照 Unity EditMode
// （Ch4FoundationTests 的带电、CombatPipelineTests 的灵宠 / 弱点、ProjectileTests 的挡弹区与弱点规则）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
import { spec } from './unity-parity-kit.mjs';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return data(stripTypeScriptTypes(source, { mode: 'transform' }));
}
const src = path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
/** C# 常量（const / public 数值字段），键 = 相对 Unity 工程 Game/Scripts 的文件名 */
const K = spec('cs-consts');
const near =(a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} ≠ ${b}`);

const mathUrl = await ts('../src/core/math.ts');
const PET = await import(await ts('../src/combat/PetContract.ts'));
const ZONE = await import(await ts('../src/combat/HitZone.ts'));
const CHARGE = await import(await ts('../src/combat/Charge.ts'));
const CALC = await import(await ts('../src/combat/DamageCalc.ts', { '../core/types': data('export const ELEMENT_COLORS = {};'), '../core/math': mathUrl }).catch(() => null) ?? data('export {}')).catch(() => ({}));

// ───────────── 灵宠伤害源 / 弱点（契约） ─────────────

test('pet contract: source "pet" only scales with petDamagePct and never rolls a random crit', async () => {
  const hit = PET.petHit(40, 'fire', 0.3);
  assert.equal(hit.source, 'pet');
  assert.equal(hit.canCrit, false, '灵宠默认不随机暴击');
  assert.deepEqual(hit.tags, ['pet']);
  // Combat：灵宠那一支只乘 petDamagePct（源码结构锁住，免得以后把武器 / 技能加成漏进来）
  const calc = await src('combat/DamageCalc.ts');
  assert.match(calc, /if \(isPetHit\(req\)\) m \*= stats\.mult\('petDamagePct'\);\s*else \{/);
  const combat = await src('combat/Combat.ts');
  assert.match(combat, /!isPetHit\(req\) && ctx\.rng\.next\(\) < stats\.get\('critChance'\)/, '灵宠不掷随机暴击');
  assert.match(combat, /if \(weak\) mult \*= stats\.mult\('weakpointDamagePct'\)/, '弱点（含改判）吃「弱点伤害」');
  const stats = await src('core/Stats.ts');
  assert.match(stats, /weakpointDamagePct: 0,\s*petDamagePct: 0/);
  if (CALC.isPetHit) {
    assert.ok(CALC.isPetHit({ source: 'pet' }));
    assert.ok(CALC.isPetHit({ source: 'skill', tags: ['pet'] }));
    assert.ok(!CALC.isPetHit({ source: 'weapon' }));
  }
});

test('force-weakpoint: only weapon / skill / explosion direct hits can be re-judged; throwing judges are skipped', () => {
  PET.clearForceWeakpoints();
  const enemy = { alive: true };
  const off1 = PET.addForceWeakpoint(() => { throw new Error('boom'); });
  const off2 = PET.addForceWeakpoint((e, req) => req.base >= 10);
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(PET.forcedWeakpoint(enemy, { base: 20, source: 'weapon' }, false), true);
    assert.equal(PET.forcedWeakpoint(enemy, { base: 5, source: 'weapon' }, false), false);
    assert.equal(PET.forcedWeakpoint(enemy, { base: 20, source: 'skill' }, false), true);
    assert.equal(PET.forcedWeakpoint(enemy, { base: 20, source: 'explosion' }, false), true);
    for (const source of ['pet', 'status', 'scroll', 'melee']) assert.equal(PET.forcedWeakpoint(enemy, { base: 20, source }, false), false, source);
    assert.equal(PET.forcedWeakpoint(enemy, { base: 20, source: 'weapon' }, true), false, '反应伤害不判');
    assert.equal(PET.forcedWeakpoint(enemy, { base: 20, source: 'weapon', headshot: true }, false), false, '已经是弱点不再判');
  } finally {
    console.error = quiet;
  }
  off1();
  off2();
  assert.equal(PET.forceWeakpointCount(), 0);
});

// ───────────── 命中区 / 弱点规则 ─────────────

test('hit zones: constants match Unity EnemyBody / HitZone / WeakpointRule', async () => {
  const body = K['Enemies/EnemyBody.cs'];
  const zone = K['Enemies/HitZone.cs'];
  const rule = K['Combat/Projectiles/ProjectileTargeting.cs'];
  near(ZONE.ZONE_TOLERANCE, body.ZoneTolerance);
  near(ZONE.ZONE_FALLBACK, body.ZoneFallback);
  near(ZONE.FACING_COS, zone.facingCos);
  near(ZONE.WEAKPOINT_WINDOW, rule.Window);
  // 敌人射线、投射物各自内联了一份 1.5（不 import，免得测试打桩）：一起锁住
  for (const file of ['enemies/EnemyBase.ts', 'combat/Projectiles.ts']) assert.match(await src(file), new RegExp(`const WEAKPOINT_WINDOW = ${rule.Window};`), file);
  assert.equal(ZONE.BLOCK_BELOW, 0.5, '倍率 < 0.5 记为格挡（Unity Damageable）');
});

test('weakpoint rule: head first = weak; body first with the weakpoint within 1.5 m behind = weak at the body distance', () => {
  assert.deepEqual(ZONE.weakHit(-1, 4, 50), { distance: 4, weak: true });
  assert.deepEqual(ZONE.weakHit(5, 4, 50), { distance: 4, weak: true }, '弱点先中');
  assert.deepEqual(ZONE.weakHit(4, 5.4, 50), { distance: 4, weak: true }, '先进身体、1.4 m 后穿过弱点');
  assert.deepEqual(ZONE.weakHit(4, 5.6, 50), { distance: 4, weak: false }, '1.6 m 外不算');
  assert.deepEqual(ZONE.weakHit(4, -1, 50), { distance: 4, weak: false });
  assert.deepEqual(ZONE.weakHit(-1, 60, 50), { distance: -1, weak: false }, '只中弱点但超出射程');
  assert.deepEqual(ZONE.weakHit(-1, -1, 50), { distance: -1, weak: false });
});

test('hit zones: zoneAt picks by tolerance / priority / fallback; facing gate; break counter fires once', () => {
  const fwd = out => out.set(0, 0, 1);
  const set = new ZONE.HitZoneSet(fwd);
  const at = (x, y, z) => out => out.set(x, y, z);
  const torso = set.add(new ZONE.HitZone('torso', ZONE.capsuleShape(at(0, 0.4, 0), at(0, 1.4, 0), 0.4)));
  const shield = set.add(new ZONE.HitZone('shield', ZONE.sphereShape(at(0, 1, 0.5), 0.5), { multiplier: 0.2, facing: 'front', priority: 2 }));
  const head = set.add(new ZONE.HitZone('head', ZONE.sphereShape(at(0, 1.9, 0), 0.25), { weakpoint: true, breakAt: 50 }));
  assert.equal(set.affectsDamage, true);
  assert.equal(set.zoneAt(new THREE.Vector3(0, 1, 0.95), false), shield, '表面 + 优先级高的先');
  assert.equal(set.zoneAt(new THREE.Vector3(0, 1.9, 0.2), true), head, '弱点命中先在弱点区里找');
  assert.equal(set.zoneAt(new THREE.Vector3(0, 1.9, 0.2), false), torso, '非弱点命中不落在弱点区：退到 0.5 m 内最近的普通区');
  assert.equal(set.zoneAt(new THREE.Vector3(5, 5, 5), false), null);
  assert.equal(set.zoneAt(null, false), null, '没有命中点不算区');
  // 朝向门：正面打来（飞行方向 −Z）× 0.2 且记为格挡；背后打来按普通部位
  assert.equal(shield.multiplierFor(new THREE.Vector3(0, 0, -1)), 0.2);
  assert.equal(shield.multiplierFor(new THREE.Vector3(0, 0, 1)), 1);
  assert.equal(shield.multiplierFor(null), 1, '方向退化时有门的不通过');
  assert.ok(shield.multiplierFor(new THREE.Vector3(0, 0, -1)) < ZONE.BLOCK_BELOW);
  // 计数：累计到 breakAt 发一次 broke
  let broke = 0, hits = 0;
  head.broke.push(() => broke++);
  head.damaged.push(() => hits++);
  head.record(30);
  head.record(30);
  head.record(30);
  assert.equal(broke, 1);
  assert.equal(hits, 3);
  head.resetCount();
  head.record(60);
  assert.equal(broke, 2, 'resetCount 之后可以再碎一次');
  // 射线：先进躯干、往前 1.5 m 内穿过头 → 按弱点算，距离是躯干的
  const hit = set.raycast(new THREE.Vector3(0, 0.2, -1), new THREE.Vector3(0, 1.7, 1).normalize(), 20, null);
  assert.ok(hit && hit.weak && hit.zone === head);
  head.setActive(false);
  const hit2 = set.raycast(new THREE.Vector3(0, 0.2, -1), new THREE.Vector3(0, 1.7, 1).normalize(), 20, null);
  assert.ok(hit2 && !hit2.weak, '关掉的区打不到');
});

// ───────────── 带电（Ch4FoundationTests） ─────────────

test('charge: constants match Unity Charge.cs', async () => {
  const c = K['Combat/Charge.cs'];
  for (const k of ['DefaultSeconds', 'ArcRadius', 'ArcDamage', 'ArcTargets', 'MaxHops', 'ArcsPerSecond']) near(CHARGE.CHARGE[k], c[k], k);
});

test('charge: apply keeps the longer remaining time; hold is permanent until every holder releases', () => {
  const book = new CHARGE.ChargeBook();
  const e = { alive: true, untargetable: false };
  let started = 0;
  book.onCharged = () => started++;
  assert.equal(book.apply(e, 6), true);
  assert.equal(book.apply(e, 2), true);
  near(book.remaining(e), 6, '不累加、取较大者');
  assert.equal(started, 1, '续时长不再发「开始带电」');
  book.tick(5);
  near(book.remaining(e), 1);
  const a = book.hold(e), b = book.hold(e);
  assert.equal(book.remaining(e), Infinity);
  book.tick(10);
  assert.ok(book.isCharged(e));
  a();
  assert.ok(book.isCharged(e), '还有一个持有');
  b();
  book.tick(0.01);
  assert.ok(!book.isCharged(e));
  // 无效目标：已死 / 不可选中
  assert.equal(book.apply({ alive: false, untargetable: false }, 6), false);
  assert.equal(book.apply({ alive: true, untargetable: true }, 6), false);
  assert.equal(book.apply(e, NaN), false);
});

test('charge: a charged kill arcs to the 2 nearest non-boss allies and the chain stops after 4 hops', () => {
  const mk = (extra = {}) => ({ alive: true, untargetable: false, ...extra });
  const list = [mk(), mk({ isBoss: true }), mk({ alive: false }), mk(), mk()];
  const first = CHARGE.arcTargets(0, list);
  assert.equal(first.hop, 1);
  assert.deepEqual(first.targets, [list[0], list[3]], '首领、死的跳过，取最近的 2 个');
  assert.equal(CHARGE.arcTargets(3, list).targets.length, 2, '第 4 跳还传');
  assert.equal(CHARGE.arcTargets(4, list).targets.length, 0, '跳数到 4 不再往下传');
  // 账本：死亡时取出带电与跳数；传来的电取较小的跳数
  const book = new CHARGE.ChargeBook();
  const e = mk();
  book.apply(e, 6, null, 3);
  book.apply(e, 6, null, 1);
  assert.deepEqual(book.died(e), { was: true, hop: 1 });
  assert.deepEqual(book.died(e), { was: false, hop: 0 });
});

test('charge: the death arc picks like Unity Nearest — body centre within 8 m (no radius padding), only the nearest ArcTargets + 2 are candidates', async () => {
  // Unity Charge.Arc：ReactionSystem.Nearest(c, radius, ArcTargets + 2, from, false, near)，Nearest 按 Distance(from, CenterOf(d)) > range 剔除
  const at = (x, extra = {}) => ({ alive: true, untargetable: false, isBoss: false, radius: 1.2, height: 2, getBodyCenter: o => o.set(x, 1, 0), ...extra });
  const c = new THREE.Vector3(0, 1, 0);
  const near = at(7.5), far = at(8.6);
  assert.deepEqual(CHARGE.arcCandidates(c, 8, [far, near], null), [near], '身体中心 8.6 m：不在 8 m 内（不加敌人半径）');
  const b1 = at(1, { isBoss: true }), b2 = at(2, { isBoss: true }), b3 = at(3, { isBoss: true }), n4 = at(4), n5 = at(5);
  const list = CHARGE.arcCandidates(c, 8, [n5, b3, n4, b1, b2], null);
  assert.deepEqual(list, [b1, b2, b3, n4], '只取最近 ArcTargets + 2 = 4 个，首领照样占名额');
  assert.deepEqual(CHARGE.arcTargets(0, list).targets, [n4], '再跳过首领：只传到 1 个');
  const self = at(0.5);
  assert.deepEqual(CHARGE.arcCandidates(c, 8, [self, at(1, { alive: false }), at(1.5, { untargetable: true }), n4], self), [n4], 'from 自己、死的、不可选中的不算');
  assert.deepEqual(CHARGE.arcCandidates(c, 0, [n4], null), []);

  // 运行时：ChargeSystem.arc 走 EnemyManager.queryRadius（「半径 + 敌人半径」粗筛）后照上面的名单传电
  const run = pool => {
    const struck = [];
    const ctx = {
      events: { on() {} },
      enemies: {
        queryRadius(center, r, out = []) {
          out.length = 0;
          const v = new THREE.Vector3();
          for (const e of pool) if (e.alive && !e.untargetable && e.getBodyCenter(v).distanceTo(center) <= r + e.radius) out.push(e);
          return out;
        },
      },
      fx: { lightning() {}, burst() {} },
      audio: { play() {} },
      combat: { damageEnemy: t => { struck.push(t); return null; } },
    };
    const sys = new CHARGE.ChargeSystem(ctx);
    const n = sys.arc(at(0), 0);
    assert.equal(n, struck.length);
    return struck;
  };
  assert.deepEqual(run([far, near]), [near], '8 m 外（8.6 m，粗筛能查到）的不传');
  assert.deepEqual(run([n5, b3, n4, b1, b2]), [n4], '最近 4 个里 3 个是首领：只传 1 个，不往第 5 个找');
  assert.deepEqual(run([at(2), at(3), at(4)]).length, 2, '正常情况传最近 2 个');
});

test('charge: a death arc that kills its first target stops there, like Unity (the nested Arc clears the shared near list)', async () => {
  // Unity Charge.Arc：near 是静态共用表；hop / 半径不合格在 near.Clear() 之前 return，否则进来清一次、走完再清一次。
  // 传电的 6 点雷伤打死目标 → Damageable.Died 同步 → ChargeState.OnDied → Charge.Arc 重入，把 near 清空，外层 `i < near.Count` 为假就停
  const at = (x, hp = 100) => ({ alive: true, untargetable: false, isBoss: false, hp, radius: 0.5, height: 2, getBodyCenter: o => o.set(x, 1, 0) });
  // 和 Combat 一样：打死就同步派发 enemy:killed（ChargeSystem 在构造时订阅）
  const world = pool => {
    const dealt = new Map();
    let onKilled = null;
    const ctx = {
      events: { on(name, fn) { if (name === 'enemy:killed') onKilled = fn; } },
      enemies: {
        queryRadius(center, r, out = []) {
          out.length = 0;
          const v = new THREE.Vector3();
          for (const e of pool) if (e.alive && !e.untargetable && e.getBodyCenter(v).distanceTo(center) <= r + e.radius) out.push(e);
          return out;
        },
      },
      fx: { lightning() {}, burst() {} },
      audio: { play() {} },
      combat: {
        damageEnemy(t, req) {
          dealt.set(t, (dealt.get(t) ?? 0) + req.base);
          t.hp -= req.base;
          if (t.hp <= 0 && t.alive) {
            t.alive = false;
            onKilled({ enemy: t });
          }
          return null;
        },
      },
    };
    return { sys: new CHARGE.ChargeSystem(ctx), dealt };
  };

  // 源头 x=0（已死，和真的死亡放电一样）；a（x=1，6 血）挨第一跳就死；b、c 满血
  {
    const src = at(0), a = at(1, 6), b = at(2), c = at(3);
    src.alive = false;
    const { sys, dealt } = world([src, a, b, c]);
    assert.equal(sys.arc(src, 0), 1, '外层只传到 a：a 死后重入的放电清空了 near');
    assert.equal(a.alive, false);
    assert.equal(dealt.get(b), CHARGE.CHARGE.ArcDamage, 'b 只挨 a 放的那一下（不是 12）');
    assert.equal(dealt.get(c), CHARGE.CHARGE.ArcDamage, 'c 由 a 的放电传到');
    assert.equal(sys.book.state(b).hop, 2, 'b 的电是 a 传来的第 2 跳，不被外层压回第 1 跳');
    assert.equal(sys.book.state(c).hop, 2);
  }
  // 跳数到顶：a 的电是第 4 跳，它死了也不放（Unity 在 near.Clear() 之前 return），外层照常传完 2 个
  {
    const src = at(0), a = at(1, 6), b = at(2), c = at(3);
    src.alive = false;
    const { sys, dealt } = world([src, a, b, c]);
    assert.equal(sys.arc(src, 3), 2);
    assert.equal(a.alive, false);
    assert.equal(dealt.get(b), CHARGE.CHARGE.ArcDamage);
    assert.equal(dealt.has(c), false, 'a 没放电，c 不挨');
    assert.equal(sys.arc(src, CHARGE.CHARGE.MaxHops), 0, '第 5 跳不传');
  }
  // 没打死：照常传 2 个
  {
    const src = at(0), a = at(1), b = at(2), c = at(3);
    src.alive = false;
    const { sys, dealt } = world([src, a, b, c]);
    assert.equal(sys.arc(src, 0), 2);
    assert.deepEqual([dealt.get(a), dealt.get(b), dealt.has(c)], [CHARGE.CHARGE.ArcDamage, CHARGE.CHARGE.ArcDamage, false]);
  }
});

test('charge counts as shock for reactions (Unity GameReactionEnv.Has)', async () => {
  const rx = await src('combat/Reactions.ts');
  assert.equal((rx.match(/st\.has\('shock'\) \|\| this\.host\.isCharged\?\.\(enemy\) === true/g) ?? []).length, 2, '反应判定与引爆两处都读带电');
  // 领主：夔一直带电、飞廉二阶段起珠子在时带电；高原敌自己的带电经 foeCharged 读
  assert.match(await src('enemies/bosses/lords/Kui.ts'), /charge\.hold\(this, this\)/);
  assert.match(await src('enemies/bosses/lords/Feilian.ts'), /this\.phase >= 1 && this\.orbIntact && this\.introDone/);
  assert.match(await src('enemies/plateau/PlateauFoeAdapter.ts'), /foeCharged\(\): boolean/);
});

// 顿帧（Core/HitStop.cs）只有一份：M11d 的 src/core/HitStop.ts（Game 接事件），对照在 tests/unity-core-time.test.mjs

// ───────────── 弹体：挡弹区、落地滚动 ─────────────

test('projectiles: roll / bounce constants match Unity ProjectileMath', async () => {
  const m = K['Combat/Projectiles/ProjectileMath.cs'];
  const p = await src('combat/Projectiles.ts');
  const tsConst = name => Number(p.match(new RegExp(`const ${name} = ([\\d.]+);`))[1]);
  near(tsConst('ROLL_SPEED'), m.RollSpeed);
  near(tsConst('ROLL_FRICTION'), m.RollFriction, '滚动摩擦 2.5（Unity 调过的现值）');
  near(tsConst('ROLL_ENTRY_KEEP'), m.RollEntryKeep);
  near(tsConst('BOUNCE_NORMAL_KEEP'), m.BounceNormalKeep);
  near(tsConst('BOUNCE_TANGENT_KEEP'), m.BounceTangentKeep);
  // 青冥雷蛊：反弹用完后滚动
  assert.match(await src('weapons/WeaponDefs.ts'), /id: 'stormpod'[\s\S]{0,700}rollAfter: true/);
  assert.match(await src('weapons/Firing.ts'), /rollAfter: p\.rollAfter \? true : undefined/);
});

test('projectile wards: disc blocks both ways, sphere only blocks what flies in from outside', async () => {
  const pvStub = data('export const PROJECTILE_VISUALS = {}; export class ProjectileView {} export function tailOffset() { return 0; } export class Trail {} export function viewSize() { return 1; }');
  const blastStub = data('export function blastPlayer() { return 0; } export function lineClear() { return true; }');
  const { wardEntry } = await import(await ts('../src/combat/Projectiles.ts', { '../core/math': mathUrl, './ProjectileVisuals': pvStub, './Blast': blastStub }));
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const disc = { center: V(0, 1, 0), normal: V(0, 0, 1), radius: 1, shape: 'disc' };
  near(wardEntry(disc, V(0, 1, -2), V(0, 0, 1), 5), 2);
  near(wardEntry(disc, V(0, 1, 2), V(0, 0, -1), 5), 2, '两面都挡');
  assert.equal(wardEntry(disc, V(2, 1, -2), V(0, 0, 1), 5), -1, '穿过点在半径外');
  assert.equal(wardEntry(disc, V(0, 1, -2), V(1, 0, 0), 5), -1, '与圆盘平行');
  assert.equal(wardEntry(disc, V(0, 1, -2), V(0, 0, 1), 1), -1, '这一段够不到');
  const sphere = { center: V(0, 1, 0), normal: V(0, 1, 0), radius: 1.6, shape: 'sphere' };
  near(wardEntry(sphere, V(0, 1, -5), V(0, 0, 1), 10), 3.4);
  assert.equal(wardEntry(sphere, V(0, 1, 0.5), V(0, 0, 1), 10), -1, '罩子里打出去的不被自己的罩子吃掉');
  assert.equal(wardEntry(sphere, V(0, 1, -5), V(0, 0, -1), 10), -1, '背着球飞');
  assert.equal(wardEntry({ ...sphere, radius: 0 }, V(0, 1, -5), V(0, 0, 1), 10), -1);
});

// ───────────── 状态 / 反应数值（CombatTuning.cs 是单一来源） ─────────────

test('status + reaction numbers match Unity CombatTuning', async () => {
  const status = await src('combat/Status.ts');
  const rx = await src('combat/Reactions.ts');
  /** CombatTuning 的嵌套类 */
  const block = name => K[`Combat/CombatTuning.cs#${name}`];
  const burn = block('Burn'), shock = block('Shock'), corrode = block('Corrode'), control = block('Control');
  const has = (text, value, what) => assert.ok(new RegExp(`(?<![\\d.])${String(value).replace('.', '\\.')}(?![\\d])`).test(text), `${what} = ${value} 在网页源码里找不到`);
  for (const [k, v] of Object.entries(burn)) has(status, v, `Burn.${k}`);
  for (const [k, v] of Object.entries(shock)) has(status + rx + await src('combat/DamageCalc.ts'), v, `Shock.${k}`);
  for (const [k, v] of Object.entries(corrode)) has(status, v, `Corrode.${k}`);
  for (const [k, v] of Object.entries(control)) has(status, v, `Control.${k}`);
  // 四种反应的 k / floor / cap / 冷却
  const tune = spec('combat').reactions.tune;
  assert.deepEqual(tune, [[1, 14, 80, 1], [1, 14, 100, 1.2], [1, 14, 90, 1.2], [1.5, 40, 320, 6]]);
  for (const row of tune) for (const v of row) has(rx, v, `反应表 ${row.join('/')}`);
  const totals = K['Combat/CombatTuning.cs'];
  for (const k of ['MaxReactionDepth', 'FrameBudget', 'QueueCap', 'CascadeDelay', 'AbyssWindup', 'IcdFloor', 'DetonateIcd', 'PinCapOfMaxHp', 'StrengthPerLevel']) has(rx + await src('combat/Combat.ts'), totals[k], k);
  // 击杀结算：精英魂晶 × 5、首领 60（KillResolver）；吸血单次上限 5%（至少 2 点）；免疫提示间隔 0.4 s
  const kill = K['Combat/KillResolver.cs'];
  assert.deepEqual([kill.BossEssence, kill.EliteEssenceMult, kill.DefaultEssence], [60, 5, 1]);
  const combat = await src('combat/Combat.ts');
  assert.match(combat, /isBoss \? 60 : 1/);
  const uc = K['Combat/Combat.cs'];
  assert.deepEqual([uc.LifestealCapRatio, uc.LifestealCapMin, uc.ImmuneFeedbackGap, uc.MaxExplodeDepth], [0.05, 2, 0.4, 6]);
  has(combat, 0.05, '吸血上限');
});
