// M8 收尾：M13 对照测试对出来、落在 M8 的不一致项（tests/unity-*.test.mjs 的 todo）照 Unity 改完后的断言。
//   1. 弱点伤害%：命中弱点 / 被改判为弱点另乘 weakpointDamagePct；进攻卷「破绽」weak_point（Unity OffenseStatScrolls.cs）
//   2. 灵宠伤害源：source 'pet' 只吃 petDamagePct、不随机暴击（Unity DamageCalc.StatMultiplier / Combat.DamageEnemy）
//   3. 免疫提示：打不可选中的敌人返回 immune 结果，0.4 s 节流地派发 enemy:damaged（Unity Combat.Immune）
//   4. 玩家减益：Unity StatusId 的 8 项 = 网页敌人状态 5 项 + 玩家减益 3 项（寒意 / 点燃 / 日晒只挂玩家）
//   5. 焚雷扩散灼烧：按距离取最近 16 个（Unity CombatTuning.Thunderfire.SpreadTargets）
//   6. 格挡提示：整发被命中区挡掉弹「格挡」、派发事件；没被格挡的 0 伤害不发事件不弹字（Unity Combat / DamageNumbers）
//   7. 货币叫法：局内货币叫灵石（Unity D13），属性名、天赋、宝箱提示、奖励名、商店与掉落提示都对 Unity 的原文
// 常量、定义和 Unity 版删除前从 C# 冻结的规格比（tests/fixtures/spec/*.json）；行为用真的 Combat / Reactions / ScrollSystem
// （临时目录转译整张模块图，同 scroll-tactics.test.mjs）。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
import { spec, tsGraph } from './unity-parity-kit.mjs';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const dir = await mkdtemp(path.join(tmpdir(), 'spiritfire-m8-parity-'));
after(() => rm(dir, { recursive: true, force: true }));
const modules = new Map();
async function ts(relative) {
  const file = path.resolve(root, relative);
  if (modules.has(file)) return modules.get(file);
  const output = path.join(dir, path.relative(root, file)).replace(/\.ts$/, '.mjs');
  const url = pathToFileURL(output).href;
  modules.set(file, url);
  let source = stripTypeScriptTypes(await readFile(file, 'utf8'), { mode: 'transform' });
  for (const match of [...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)]) {
    const spec = match[1];
    const replacement = spec.startsWith('.')
      ? await ts(path.relative(root, path.resolve(path.dirname(file), spec + '.ts')))
      : import.meta.resolve(spec);
    source = source.replaceAll(`'${spec}'`, `'${replacement}'`).replaceAll(`"${spec}"`, `"${replacement}"`);
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, source);
  return url;
}
const src = p => readFile(new URL(`../src/${p}`, import.meta.url), 'utf8');
/** C# 常量，键 = 相对 Unity 工程 Game/Scripts 的文件名（#名字 = 文件里的一个类） */
const K = spec('cs-consts');
const COMBAT = spec('combat');

const { ScrollSystem } = await import(await ts('progression/Scrolls.ts'));
const { SCROLL_DEFS } = await import(await ts('progression/ScrollDefs.ts'));
const { OFFENSE_SCROLLS } = await import(await ts('progression/scrolls/defsOffense.ts'));
const { Stats, BASE_STATS } = await import(await ts('core/Stats.ts'));
const { EventBus } = await import(await ts('core/EventBus.ts'));
const { TaskRunner } = await import(await ts('core/Tasks.ts'));
const { Rng } = await import(await ts('core/Rng.ts'));
const { Combat, IMMUNE_FEEDBACK_GAP } = await import(await ts('combat/Combat.ts'));
const { TF_SPREAD_TARGETS } = await import(await ts('combat/Reactions.ts'));
const { BLOCKED_COLOR, BLOCKED_TEXT } = await import(await ts('combat/Feedback.ts'));
const { shockwave } = await import(await ts('player/skills/common.ts'));
const { Ballistics } = await import(await ts('weapons/Firing.ts'));
const { AffixEffects } = await import(await ts('weapons/AffixEffects.ts'));
// 碎刃：模型 / 特效 / 刃群 / 视图打桩（只跑刃群的伤害结算 swarmTick，不建场景）
const bladeGraph = await tsGraph({
  'weapons/demonBlade/BladeModel.ts': 'export const BLADE_PURPLE = 0x9a6bff;',
  'weapons/demonBlade/BladeEffects.ts': 'export class BladeEffects {}',
  'weapons/demonBlade/BladeSwarm.ts': 'export class BladeSwarm {}',
  'weapons/demonBlade/BladeView.ts': 'export function createBladePoseInput() { return {}; }',
});
after(() => bladeGraph.dispose());
const { DemonBlade } = await bladeGraph.load('weapons/demonBlade/DemonBlade.ts');

const close = (actual, expected, msg = '') => assert.ok(Math.abs(actual - expected) < 1e-6, `${msg} ${actual} ≠ ${expected}`);

function fixture() {
  const enemies = [];
  const events = new EventBus();
  const ctx = {
    events, tasks: new TaskRunner(), rng: new Rng(1234),
    time: { now: 0, frame: 0 }, run: { difficulty: 1, chapter: 0, heroId: 'fox', damageDealt: 0, kills: 0, coins: 0, essence: 0 },
    settings: { damageNumbers: false }, stageGroup: new THREE.Group(),
    player: {
      alive: true, hp: 100, shield: 0, position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.7, 0),
      stats: new Stats(), invulnerableTime: 0, maxHp() { return this.stats.get('maxHp'); }, maxShield() { return this.stats.get('maxShield'); },
      addShield() { return 0; }, heal() { return 0; }, takeDamage() {}, reduceCooldowns() {},
    },
    weapons: { active: { uid: 1, defId: 'test', element: 'none', affixes: [] }, slots: [], isReloading: false, activeForm: null, magCapacity: () => 10 },
    enemies: {
      all: enemies, list: enemies,
      queryRadius(c, r, out = []) {
        out.length = 0;
        out.push(...enemies.filter(e => e.alive && !e.untargetable && e.position.distanceTo(c) <= r + e.radius));
        return out;
      },
      nearest: () => null,
    },
    world: { segmentBlocked: () => false, raycast: () => null, groundHeight: () => 0 },
    audio: { play() {} }, ui: { toast() {} }, meta: { addEssence() {} },
    fx: new Proxy({}, { get: () => () => {} }),
  };
  ctx.combat = new Combat(ctx);
  ctx.scrolls = new ScrollSystem(ctx);
  const advance = seconds => { ctx.time.now += seconds; ctx.time.frame++; ctx.tasks.update(seconds); ctx.combat.update(seconds); };
  const enemy = (x = 1, z = 0, extra = {}) => {
    const e = {
      id: enemies.length + 1, hp: 10000, maxHp: 10000, shield: 0, maxShield: 0, armor: 0, maxArmor: 0,
      alive: true, untargetable: false, damageTakenMult: 1, isBoss: false, isElite: false, radius: 0.4, height: 2,
      position: new THREE.Vector3(x, 0, z), statuses: new Map(), def: { color: 0xffffff, essence: 0 },
      getBodyCenter(out) { return out.copy(this.position).add(new THREE.Vector3(0, 1, 0)); },
      getHeadCenter(out) { return out.copy(this.position).add(new THREE.Vector3(0, 1.8, 0)); },
      onDamaged() {}, onKilled() {}, knockback() {}, die() { this.alive = false; },
      ...extra,
    };
    enemies.push(e);
    return e;
  };
  const damaged = [];
  events.on('enemy:damaged', ({ enemy: e, result }) => damaged.push({ e, result }));
  const hit = (e, o = {}) => ctx.combat.damageEnemy(e, { base: 100, element: 'none', source: 'weapon', procDepth: 0, canCrit: false, weaponUid: 1, ...o });
  return { ctx, enemy, hit, advance, damaged };
}

// ───────────── 1. 弱点伤害% + 「破绽」 ─────────────

test('weak_point「破绽」: definition from Unity OffenseStatScrolls.cs, 119 scrolls in all', async () => {
  const u = spec('scrolls').scrolls.weak_point;
  assert.equal(u.src, 'Progression/Scrolls/Offense/OffenseStatScrolls.cs');
  const def = OFFENSE_SCROLLS.find(d => d.id === 'weak_point');
  assert.ok(def, '网页有「破绽」');
  assert.deepEqual(
    { name: def.name, tags: def.tags, rarity: def.rarity, maxStacks: def.maxStacks, description: def.description },
    { name: u.name, tags: u.tags, rarity: u.rarity, maxStacks: u.maxStacks, description: u.description },
  );
  assert.deepEqual(u.stats, [['WeakpointDamagePct', 0.15]]);
  assert.equal(SCROLL_DEFS.length, 119);
  assert.equal(OFFENSE_SCROLLS.at(-1).id, 'weak_point', '放在进攻表尾，前 24 张顺序不动');
  // 3 层：属性表 +45%
  const f = fixture();
  for (let i = 0; i < 3; i++) f.ctx.scrolls.add('weak_point');
  close(f.ctx.player.stats.get('weakpointDamagePct'), u.stats[0][1] * u.maxStacks, '3 层');
});

test('weakpoint damage %: weak hits (and only weak hits) multiply by weakpointDamagePct, like Unity Combat.cs', async () => {
  // Unity Combat.cs：if (weak) mult *= stats?.Mult(Stat.WeakpointDamagePct) ?? 1f;
  const f = fixture();
  const e = f.enemy(3);
  const body0 = f.hit(e).dealt;
  const weak0 = f.hit(e, { headshot: true }).dealt;
  for (let i = 0; i < 3; i++) f.ctx.scrolls.add('weak_point');
  const body1 = f.hit(e).dealt;
  const weak1 = f.hit(e, { headshot: true }).dealt;
  close(body1, body0, '身体不变');
  close(weak1 / weak0, 1.45, '弱点 × (1 + 0.45)');
  close(weak0, body0 * 2, '弱点必暴（暴伤 ×2）');
  // Unity 的 Stat 枚举里每一项网页都有
  const key = n => ({ MagPct: 'magSizePct' }[n] ?? n[0].toLowerCase() + n.slice(1));
  assert.deepEqual(COMBAT.statEnum.map(key).filter(k => !(k in BASE_STATS)), [], '网页 StatKey 覆盖 Unity Stat 枚举');
});

// ───────────── 2. 灵宠伤害源 ─────────────

test('pet source: only petDamagePct scales it and it never rolls a random crit (Unity DamageSource.Pet)', () => {
  const f = fixture();
  const e = f.enemy(3);
  const stats = f.ctx.player.stats;
  stats.setBase('critChance', 1);
  const base = f.hit(e, { source: 'pet', canCrit: true, tags: ['pet'] });
  assert.equal(base.isCrit, false, '暴击率 100% 也不随机暴击');
  stats.add('damagePct', 0.5, 't');
  stats.add('skillDamagePct', 0.5, 't');
  close(f.hit(e, { source: 'pet', tags: ['pet'] }).dealt, base.dealt, '武器 / 技能加成不吃');
  stats.add('petDamagePct', 0.3, 't');
  close(f.hit(e, { source: 'pet', tags: ['pet'] }).dealt, base.dealt * 1.3, '只吃灵宠伤害');
  assert.equal(f.hit(e, { source: 'pet', tags: ['pet'], forceCrit: true }).isCrit, true, 'forceCrit 由灵宠自己给');
});

// ───────────── 3. 免疫提示 ─────────────

test('immune: untargetable hits return immune, settle nothing and raise enemy:damaged at most once per 0.4 s (Unity Combat.Immune)', async () => {
  assert.equal(IMMUNE_FEEDBACK_GAP, K['Combat/Combat.cs'].ImmuneFeedbackGap);
  const f = fixture();
  const e = f.enemy(3, 0, { untargetable: true });
  const r = f.hit(e);
  assert.ok(r, '不再返回 null');
  assert.equal(r.immune, true);
  assert.equal(r.dealt, 0);
  assert.equal(r.isCrit, false);
  assert.equal(e.hp, 10000, '不扣血');
  assert.equal(f.damaged.length, 1, '放行的这一次派发 enemy:damaged');
  assert.equal(f.damaged[0].result.immune, true);
  // 节流：0.4 s 内还是 immune 结果，但不再派发
  f.advance(0.2);
  assert.equal(f.hit(e).immune, true);
  assert.equal(f.damaged.length, 1);
  f.advance(0.25);
  f.hit(e);
  assert.equal(f.damaged.length, 2, '过了 0.4 s 再放行一次');
  // 持续伤害跳伤、处决、0 伤害：返回 immune、不提示
  f.advance(1);
  assert.equal(f.hit(e, { source: 'status' }).immune, true);
  assert.equal(f.hit(e, { base: 2e6 }).immune, true);
  assert.equal(f.hit(e, { base: 0 }).immune, true);
  assert.equal(f.damaged.length, 2);
  // 另一个敌人各自节流
  const e2 = f.enemy(4, 0, { untargetable: true });
  f.hit(e2);
  assert.equal(f.damaged.length, 3);
  // 已死的照旧返回 null（Unity default）
  const dead = f.enemy(5, 0, { alive: false });
  assert.equal(f.hit(dead), null);
});

/**
 * 不可选中在「调用方预筛之后、Combat 结算之前」才生效（同一帧里前一击触发了转阶段 / 遁地）：
 * untargetable 的前 n 次读数是 false（调用方自己的预筛），之后是 true（Combat 第 0 步）
 */
function turnsUntargetableAfter(e, n) {
  let reads = 0;
  Object.defineProperty(e, 'untargetable', { configurable: true, get: () => reads++ >= n, set() {} });
  return e;
}
const weaponReq = (o = {}) => ({ base: 50, element: 'none', source: 'explosion', procDepth: 0, canCrit: false, ...o });

test('immune results do not count as hits: explode / shockwave pre-filter, then Combat says immune', () => {
  // 爆炸：explodeAt 预筛读一次（false），damageEnemy 第 0 步读到 true
  {
    const f = fixture();
    const a = f.enemy(0, 1);
    const b = turnsUntargetableAfter(f.enemy(0, -1), 1);
    f.ctx.enemies.queryRadius = (c, r, out = []) => { out.length = 0; out.push(a, b); return out; };
    const hits = f.ctx.combat.explode(new THREE.Vector3(0, 1, 0), 3, weaponReq());
    assert.equal(hits, 1, '免疫的那只不算命中');
    assert.equal(b.hp, 10000);
    assert.ok(f.damaged.some(d => d.e === b && d.result.immune), 'Combat 给的是 immune 结果');
  }
  // 技能冲击波（skills/common.ts）：同样预筛后才变成不可选中
  {
    const f = fixture();
    const a = f.enemy(0, 1);
    const b = turnsUntargetableAfter(f.enemy(0, -1), 1);
    f.ctx.enemies.queryRadius = (c, r, out = []) => { out.length = 0; out.push(a, b); return out; };
    const hits = shockwave(f.ctx, new THREE.Vector3(0, 0, 0), { radius: 4, base: 40, knockback: 0, lift: 0, color: 0xffffff });
    assert.equal(hits, 1, '冲击波命中数不算免疫的');
    assert.equal(b.hp, 10000);
  }
});

test('immune results do not count as hits: veinseal conduct and reaction center hits (enemy:reaction hits)', () => {
  // 封脉导流：先选定 3 个目标再逐个结算；打第一个时它的受击回调让第二个转入不可选中（转阶段）→ 第二个是 immune，不算命中
  {
    const f = fixture();
    const reactions = [];
    f.ctx.events.on('enemy:reaction', ev => reactions.push(ev));
    const center = f.enemy(0, 0);
    const a = f.enemy(1, 0);
    const b = f.enemy(2, 0);
    a.onDamaged = () => { b.untargetable = true; };
    assert.ok(f.ctx.combat.triggerReaction(center, 'veinseal', 100));
    f.advance(0.05);
    assert.equal(reactions.length, 1);
    assert.equal(a.hp < 10000, true, '导流打到了第一个');
    assert.equal(b.hp, 10000, '第二个已不可选中');
    assert.equal(reactions[0].hits, 2, '中心 + 第一个导流；免疫的不算');
  }
  // 反应打中心（Reactions.hit）：焚雷排进队列后中心转入不可选中——中心那一击是 immune，hit() 返回 null，不算命中
  {
    const f = fixture();
    const reactions = [];
    f.ctx.events.on('enemy:reaction', ev => reactions.push(ev));
    const center = f.enemy(0, 0);
    assert.ok(f.ctx.combat.triggerReaction(center, 'thunderfire', 100));
    center.untargetable = true;
    f.advance(0.05);
    assert.equal(reactions.length, 1);
    assert.equal(center.hp, 10000);
    assert.equal(reactions[0].hits, 0, '只有一只、它又免疫：0 命中');
  }
});

test('immune results do not trigger: full-charge detonate (Ballistics), weapon affixes (AffixEffects), blade swarm (DemonBlade)', () => {
  // 满蓄引爆：射线层交来的目标在结算时是 immune → 不引爆（Unity Ballistics）；对照组：可选中的照常引爆
  {
    const f = fixture();
    const detonated = [];
    f.ctx.combat.detonate = (e, o) => { detonated.push({ e, o }); return null; };
    const imm = f.enemy(0, -5, { untargetable: true });
    const ok = f.enemy(0, -5);
    let target = imm;
    f.ctx.enemies.raycast = (origin, dir, maxDist, exclude) => (exclude.has(target) ? null
      : { enemy: target, distance: 5, headshot: false, point: new THREE.Vector3(0, 1, -5) });
    const b = new Ballistics(f.ctx, { getMuzzleWorld: o => o.set(0, 1.5, 0) }, () => 0.5);
    const R = { def: { range: 60, chargeDetonate: true, knockback: 0, impactSize: 1, tracerWidth: 0.02 }, damage: 100, pierce: 0, elementChance: 0, critMult: 2, critChance: 0 };
    const inst = { uid: 1, element: 'none', affixes: [] };
    const shot = { mult: 1, pierceBonus: 0, full: true, strength: 1 };
    const fire = () => b.trace(inst, R, new THREE.Vector3(0, 1.7, 0), new THREE.Vector3(0, 0, -1), false, 1, 0xffffff, 'none', shot);
    fire();
    assert.equal(detonated.length, 0, '打在免疫上不引爆');
    assert.equal(imm.hp, 10000);
    target = ok;
    fire();
    assert.equal(detonated.length, 1, '对照：可选中的满蓄照常引爆');
    assert.equal(detonated[0].e, ok);
  }
  // 武器词条：immune 结果会派发 enemy:damaged（提示用），但词条不触发（Unity AffixEffects.OnDamaged）——用狂热叠层看
  {
    const f = fixture();
    const inst = { uid: 1, element: 'none', affixes: [] };
    const rt = { shots: 0, frenzy: 0, frenzyTime: -1, lastHeadBlast: -1, readyAt: 0, cycleIndex: 0, rxnHasteUntil: 0 };
    const R = { legendary: 'lg_frenzy', legendaryValue: 0, hitShield: 0, headBlast: 0, ricochet: 0, meleeHitScale: 1, def: { pellets: 1 },
      subFire: 0, subShock: 0, subCorrode: 0, detonate: 0, seed: 0, killRefill: 0 };
    const fx = new AffixEffects(f.ctx, { find: uid => (uid === 1 ? inst : null), resolve: () => R, runtime: () => rt, refill() {} });
    f.ctx.events.on('enemy:damaged', ({ enemy, result }) => fx.onDamaged(enemy, result));
    const imm = f.enemy(3, 0, { untargetable: true });
    const r = f.hit(imm, { weaponUid: 1 });
    assert.ok(r.immune);
    assert.ok(f.damaged.some(d => d.result === r), 'immune 结果派发了 enemy:damaged');
    assert.equal(rt.frenzy, 0, '免疫不叠狂热');
    f.hit(f.enemy(4, 0), { weaponUid: 1 });
    assert.equal(rt.frenzy, 1, '对照：真打中叠一层');
  }
  // 碎刃刃群：按距离逐个结算；打第一只时它的受击回调让第二只转入不可选中 → 第二只 immune，不算命中、不涨刀意
  {
    const f = fixture();
    const a = f.enemy(1, 0);
    const b = f.enemy(2, 0);
    a.onDamaged = () => { b.untargetable = true; };
    const gained = [];
    const P = { swarm: { maxTargets: 6, damage: 10, elementScale: 1 }, intent: { swarmHit: 1 } };
    const blade = { ctx: f.ctx, swarm: { center: new THREE.Vector3(0, 0, 0) }, hits: [], P, gainIntent: v => gained.push(v) };
    DemonBlade.prototype.swarmTick.call(blade, { uid: 1, element: 'none' }, { damageMult: 1, elementChance: 0, critMult: 2, critChance: 0 }, P, 5);
    assert.ok(a.hp < 10000);
    assert.equal(b.hp, 10000);
    assert.deepEqual(gained, [1], '刀意只按真打中的 1 只涨');
  }
});

test('immune results do not count as hits: thunder judgment only counts hits that dealt damage', async () => {
  const f = fixture();
  const a = f.enemy(0, 1, { untargetable: true });
  const b = f.enemy(0, -1);
  // 调用方：都跳过 immune（Unity：DemonBladeController / Ballistics / SkillFx / AffixEffects 查 r.immune 或 total > 0）。上面三条测试用真调用驱动，这里只把写法钉住
  assert.match(await src('player/skills/common.ts'), /if \(r && !r\.immune\) hits\+\+;/);
  assert.equal((await src('weapons/demonBlade/DemonBlade.ts')).match(/if \(!res \|\| res\.immune\) continue;/g)?.length, 2);
  assert.match(await src('weapons/Firing.ts'), /detonate && res && !res\.immune && !res\.killed/);
  assert.match(await src('weapons/AffixEffects.ts'), /if \(result\.immune \|\| uid === undefined/);
  assert.match(await src('combat/Reactions.ts'), /return r && !r\.immune \? r : null;/);
  // 天雷引：免疫不计数（Unity BlastScrolls「total <= 0 不算」）
  f.ctx.scrolls.add('thunder_judgment');
  const booms = [];
  const explode = f.ctx.combat.explode.bind(f.ctx.combat);
  f.ctx.combat.explode = (c, r, req, o) => { booms.push(req); return explode(c, r, req, o); };
  for (let i = 0; i < 20; i++) { f.advance(0.5); f.hit(a); }
  assert.equal(booms.length, 0, '只打在免疫上攒不满');
  for (let i = 0; i < 16; i++) { f.advance(0.1); f.hit(b); }
  assert.equal(booms.length, 1, '真打出伤害的 16 次召唤一次');
});

// ───────────── 3b. 格挡提示 ─────────────

test('blocked: a hit zone that eats the whole shot pops 格挡 (not 免疫) and still raises enemy:damaged; unblocked zero damage stays silent', async () => {
  // Unity DamageNumbers：Kind.Blocked => "格挡"，r.blocked && r.total < 1 时弹「格挡」不弹数字；Combat：total > 0 || immune || blocked 才派发
  assert.equal(BLOCKED_TEXT, COMBAT.damageNumbers.blockedText);
  assert.equal(BLOCKED_COLOR, COMBAT.damageNumbers.blockedColor);

  const f = fixture();
  const shown = [];
  f.ctx.settings.damageNumbers = true;
  f.ctx.ui.damageNumber = (pos, amount, opts) => shown.push({ amount, ...opts });
  const zone = mult => ({ zoneAt: () => ({ multiplierFor: () => mult, record() {} }) });
  // 整发挡掉（区倍率 0）
  const wall = f.enemy(3, 0, { hitZones: zone(0) });
  const r = f.hit(wall, { point: new THREE.Vector3(3, 1, 0), direction: new THREE.Vector3(1, 0, 0) });
  assert.equal(r.blocked, true);
  assert.equal(r.dealt, 0);
  assert.equal(f.damaged.at(-1).result, r, '格挡也派发 enemy:damaged');
  f.advance(0.016);
  assert.deepEqual(shown.map(s => [s.kind, s.text]), [['reaction', '格挡']], '弹「格挡」，不弹「免疫」');
  assert.equal(shown[0].color, BLOCKED_COLOR);
  // 挡掉大半、剩下不到 1 点：Unity 也弹「格挡」不弹数字
  shown.length = 0;
  const chip = f.enemy(4, 0, { hitZones: zone(0.004) });
  const r2 = f.hit(chip, { point: new THREE.Vector3(4, 1, 0), direction: new THREE.Vector3(1, 0, 0) });
  assert.ok(r2.blocked && r2.dealt > 0 && r2.dealt < 1);
  f.advance(0.016);
  assert.deepEqual(shown.map(s => s.text ?? s.amount), ['格挡']);
  // 同一帧几颗弹丸都被挡：照 Unity 不合并（每颗一个「格挡」）
  shown.length = 0;
  for (let i = 0; i < 3; i++) f.hit(wall, { point: new THREE.Vector3(3, 1, 0), direction: new THREE.Vector3(1, 0, 0) });
  f.advance(0.016);
  assert.equal(shown.filter(s => s.text === '格挡').length, 3);
  // 没被格挡的 0 伤害：Unity 不发事件、不弹字（以前网页弹「免疫」）
  shown.length = 0;
  const n = f.damaged.length;
  const numb = f.enemy(5, 0, { damageTakenMult: 0 });
  const r3 = f.hit(numb);
  assert.ok(r3 && !r3.blocked && !r3.immune && r3.dealt === 0);
  f.advance(0.016);
  assert.equal(f.damaged.length, n, '不派发');
  assert.deepEqual(shown, [], '不弹字');
  // 处决被挡也不弹字（Unity DamageNumbers 先判 IsExecute）
  f.hit(wall, { base: 2e6, point: new THREE.Vector3(3, 1, 0), direction: new THREE.Vector3(1, 0, 0) });
  f.advance(0.016);
  assert.deepEqual(shown, []);
});

// ───────────── 7. 货币叫法 ─────────────

test('currency is 灵石 (Unity D13): stat name, wealth talent, chest hint, reward name, shop / loot toasts match the Unity strings', async () => {
  // Unity 原文（StatInfo、Talent_Wealth、CoinsReward、ShopCounter、UpgradeReward、LootDirector）
  const S = spec('ui-screens').strings;
  const unityText = {
    stat: S.coinGainStatName, talent: S.wealthTalent, chest: S.coinsChestLines, rewardName: S.coinsRewardName,
    notEnough: S.notEnough, upgrade: S.upgradeToCoins, scrollsFull: S.scrollsFull,
  };
  assert.equal(unityText.scrollsFull, '秘卷已全部满层，改为灵石');
  const { STAT_INFO } = await import(await ts('core/Stats.ts'));
  assert.equal(STAT_INFO.coinGainPct.name, unityText.stat);
  assert.equal(unityText.stat, '灵石获取');
  const meta = await src('progression/Meta.ts');
  assert.ok(meta.includes(`talent('wealth', '财富', 'coinGainPct', 0.08, '${unityText.talent}')`), '财富天赋描述');
  const chests = await src('progression/loot/Chests.ts');
  for (const line of unityText.chest) assert.ok(chests.includes(`'${line}'`), `宝箱提示「${line}」`);
  assert.ok((await src('progression/RunPlan.ts')).includes(`coins: '${unityText.rewardName}'`), '奖励名');
  assert.ok((await src('progression/loot/Shop.ts')).includes(`this.deny('${unityText.notEnough}')`), '商店「灵石不足」');
  const loot = await src('progression/Loot.ts');
  for (const t of [...unityText.upgrade, unityText.scrollsFull]) assert.ok(loot.includes(`'${t}'`), `提示「${t}」`);
  // 这几处文件的字符串字面量里不再出现「金币」（注释里讲机制的不算）
  for (const file of ['core/Stats.ts', 'progression/Meta.ts', 'progression/Loot.ts', 'progression/RunPlan.ts', 'progression/loot/Chests.ts', 'progression/loot/Shop.ts', 'progression/loot/Pickups.ts']) {
    const text = (await src(file)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(text, /['"`][^'"`\n]*金币[^'"`\n]*['"`]/, `${file}：字符串里还写着金币`);
  }
});

// ───────────── 4. 玩家减益 ─────────────

test('status ids: Unity StatusId = enemy statuses (5) + player-only debuffs chill / sunburn / ignite', async () => {
  const ids = COMBAT.statusIds;
  const types = await src('core/types.ts');
  const enemyIds = [...types.match(/export type StatusId =([^;]*);/)[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
  const ps = await src('player/PlayerStatus.ts');
  const playerIds = [...ps.match(/export type PlayerStatusId =([^;]*);/)[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
  assert.deepEqual([...enemyIds, ...playerIds].sort(), [...ids].sort());
  // Unity：寒意 / 日晒 / 点燃 只挂玩家（Hosts => StatusHosts.Player）
  for (const name of ['Chill', 'Sunburn', 'Ignite']) assert.equal(COMBAT.playerHost[name], true, name);
  assert.deepEqual(playerIds.sort(), ['chill', 'ignite', 'sunburn']);
});

// ───────────── 5. 焚雷扩散灼烧 ─────────────

test('thunderfire spread burns only the nearest 16 within the radius (Unity CombatTuning.Thunderfire.SpreadTargets)', async () => {
  assert.equal(TF_SPREAD_TARGETS, K['Combat/CombatTuning.cs#Thunderfire'].SpreadTargets);
  assert.equal(TF_SPREAD_TARGETS, 16);
  const f = fixture();
  const center = f.enemy(0, 0);
  // 20 只围一圈，距离 0.5…2.4 m（都在 3 m 内）；外面再放一只 3.3 m（queryRadius 带半径能查到，身体中心超出 3 m，Unity 不点）
  const ring = [];
  for (let i = 0; i < 20; i++) {
    const d = 0.5 + i * 0.1, a = i * 2.4;
    ring.push(f.enemy(Math.cos(a) * d, Math.sin(a) * d));
  }
  const outside = f.enemy(3.3, 0);
  assert.equal(f.ctx.combat.triggerReaction(center, 'thunderfire', 100), true);
  f.advance(0.05);
  f.advance(0.05);
  const burning = ring.filter(e => e.statuses.has('burn'));
  assert.equal(burning.length, 16, '只点最近的 16 只');
  assert.deepEqual(burning, ring.slice(0, 16), '按距离由近到远');
  assert.equal(outside.statuses.has('burn'), false, '身体中心在 R 外不点');
});
