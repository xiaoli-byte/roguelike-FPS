// M8 收尾：M13 对照测试对出来、落在 M8 的不一致项（tests/unity-*.test.mjs 的 todo）照 Unity 改完后的断言。
//   1. 弱点伤害%：命中弱点 / 被改判为弱点另乘 weakpointDamagePct；进攻卷「破绽」weak_point（Unity OffenseStatScrolls.cs）
//   2. 灵宠伤害源：source 'pet' 只吃 petDamagePct、不随机暴击（Unity DamageCalc.StatMultiplier / Combat.DamageEnemy）
//   3. 免疫提示：打不可选中的敌人返回 immune 结果，0.4 s 节流地派发 enemy:damaged（Unity Combat.Immune）
//   4. 玩家减益：Unity StatusId 的 8 项 = 网页敌人状态 5 项 + 玩家减益 3 项（寒意 / 点燃 / 日晒只挂玩家）
//   5. 焚雷扩散灼烧：按距离取最近 16 个（Unity CombatTuning.Thunderfire.SpreadTargets）
// 常量、定义直接读 C# 源码比；行为用真的 Combat / Reactions / ScrollSystem（临时目录转译整张模块图，同 scroll-tactics.test.mjs）。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

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
const cs = p => readFile(new URL(`../unity/Assets/Game/Scripts/${p}`, import.meta.url), 'utf8');
const src = p => readFile(new URL(`../src/${p}`, import.meta.url), 'utf8');
/** C# 里的 `const float A = 1f, B = 2.5f;` / `const int N = 3;` → { A: 1, B: 2.5, N: 3 } */
function csConsts(source) {
  const out = {};
  for (const m of source.matchAll(/const\s+(?:float|int)\s+([^;(){}]+);/g)) {
    for (const part of m[1].split(',')) {
      const kv = part.match(/^\s*(\w+)\s*=\s*(-?[\d.]+(?:e-?\d+)?)f?\s*$/);
      if (kv) out[kv[1]] = Number(kv[2]);
    }
  }
  return out;
}

const { ScrollSystem } = await import(await ts('progression/Scrolls.ts'));
const { SCROLL_DEFS } = await import(await ts('progression/ScrollDefs.ts'));
const { OFFENSE_SCROLLS } = await import(await ts('progression/scrolls/defsOffense.ts'));
const { Stats, BASE_STATS } = await import(await ts('core/Stats.ts'));
const { EventBus } = await import(await ts('core/EventBus.ts'));
const { TaskRunner } = await import(await ts('core/Tasks.ts'));
const { Rng } = await import(await ts('core/Rng.ts'));
const { Combat, IMMUNE_FEEDBACK_GAP } = await import(await ts('combat/Combat.ts'));
const { TF_SPREAD_TARGETS } = await import(await ts('combat/Reactions.ts'));

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
    world: { segmentBlocked: () => false, raycast: () => null },
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

test('weak_point「破绽」: definition read from Unity OffenseStatScrolls.cs, 119 scrolls in all', async () => {
  const u = await cs('Progression/Scrolls/Offense/OffenseStatScrolls.cs');
  const m = u.match(/new StatScroll \{ id = "weak_point", name = "([^"]+)", tags = new\[\] \{ "([^"]+)" \}, rarity = (\d), maxStacks = (\d), description = "([^"]+)", stats = new\[\] \{ \(Stat\.(\w+), ([\d.]+)f\) \} \}/);
  assert.ok(m, 'Unity 源码里找到「破绽」');
  const def = OFFENSE_SCROLLS.find(d => d.id === 'weak_point');
  assert.ok(def, '网页有「破绽」');
  assert.deepEqual(
    { name: def.name, tags: def.tags, rarity: def.rarity, maxStacks: def.maxStacks, description: def.description },
    { name: m[1], tags: [m[2]], rarity: Number(m[3]), maxStacks: Number(m[4]), description: m[5] },
  );
  assert.equal(m[6], 'WeakpointDamagePct');
  assert.equal(SCROLL_DEFS.length, 119);
  assert.equal(OFFENSE_SCROLLS.at(-1).id, 'weak_point', '放在进攻表尾，前 24 张顺序不动');
  // 3 层：属性表 +45%
  const f = fixture();
  for (let i = 0; i < 3; i++) f.ctx.scrolls.add('weak_point');
  close(f.ctx.player.stats.get('weakpointDamagePct'), 0.15 * Number(m[4]), '3 层');
});

test('weakpoint damage %: weak hits (and only weak hits) multiply by weakpointDamagePct, like Unity Combat.cs', async () => {
  assert.match(await cs('Combat/Combat.cs'), /if \(weak\) mult \*= stats\?\.Mult\(Stat\.WeakpointDamagePct\) \?\? 1f;/);
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
  // Unity 的 Stat 枚举（除注释）里每一项网页都有
  const st = await cs('Core/Stats.cs');
  const body = st.slice(st.indexOf('public enum Stat'), st.indexOf('public sealed class StatSheet')).replace(/\/\/[^\n]*/g, '');
  const names = body.slice(body.indexOf('{') + 1, body.indexOf('}')).split(',').map(x => x.trim()).filter(Boolean);
  const key = n => ({ MagPct: 'magSizePct' }[n] ?? n[0].toLowerCase() + n.slice(1));
  assert.deepEqual(names.map(key).filter(k => !(k in BASE_STATS)), [], '网页 StatKey 覆盖 Unity Stat 枚举');
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
  assert.equal(IMMUNE_FEEDBACK_GAP, csConsts(await cs('Combat/Combat.cs')).ImmuneFeedbackGap);
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

test('immune results do not count as hits: explosions, skill shockwaves, blade, detonate, affixes, thunder judgment', async () => {
  const f = fixture();
  const a = f.enemy(0, 1, { untargetable: true });
  const b = f.enemy(0, -1);
  // queryRadius 按契约跳过不可选中的；这里绕开它直接把两只都交给爆炸，免疫的那只不算命中
  f.ctx.enemies.queryRadius = (c, r, out = []) => { out.length = 0; out.push(a, b); return out; };
  const hits = f.ctx.combat.explode(new THREE.Vector3(0, 1, 0), 3, { base: 50, element: 'none', source: 'explosion', procDepth: 0, canCrit: false });
  assert.equal(hits, 1);
  // 调用方：都跳过 immune（Unity：DemonBladeController / Ballistics / SkillFx / AffixEffects 查 r.immune 或 total > 0）
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

// ───────────── 4. 玩家减益 ─────────────

test('status ids: Unity StatusId = enemy statuses (5) + player-only debuffs chill / sunburn / ignite', async () => {
  const u = await cs('Combat/Status/StatusEffect.cs');
  const ids = u.match(/public enum StatusId \{([^}]*)\}/)[1].split(',').map(s => s.trim().toLowerCase());
  const types = await src('core/types.ts');
  const enemyIds = [...types.match(/export type StatusId =([^;]*);/)[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
  const ps = await src('player/PlayerStatus.ts');
  const playerIds = [...ps.match(/export type PlayerStatusId =([^;]*);/)[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
  assert.deepEqual([...enemyIds, ...playerIds].sort(), [...ids].sort());
  // Unity：寒意 / 日晒 / 点燃 只挂玩家
  for (const name of ['Chill', 'Sunburn', 'Ignite']) assert.match(await cs(`Combat/Status/${name}Status.cs`), /Hosts => StatusHosts\.Player;/, name);
  assert.deepEqual(playerIds.sort(), ['chill', 'ignite', 'sunburn']);
});

// ───────────── 5. 焚雷扩散灼烧 ─────────────

test('thunderfire spread burns only the nearest 16 within the radius (Unity CombatTuning.Thunderfire.SpreadTargets)', async () => {
  const t = await cs('Combat/CombatTuning.cs');
  const block = t.slice(t.indexOf('public static class Thunderfire'), t.indexOf('}', t.indexOf('public static class Thunderfire')));
  assert.equal(TF_SPREAD_TARGETS, csConsts(block).SpreadTargets);
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
