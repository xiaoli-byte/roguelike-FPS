// M13 对照测试共用的工具（Unity EditMode 测试 → node --test）：
//   · tsGraph()：把 src/ 的一棵模块图去类型后写进临时目录再 import（循环依赖照跑：Combat ↔ Reactions ↔ Feedback），可按文件打桩；
//   · spec()：读 Unity 删除前冻结的 C# 规格（tests/fixtures/spec/*.json），对照测试的期望值一律从这里来，不再打开 unity/；
//     csConsts() / csNumber() / csList() 只是解析 C# 写法的纯函数（冻结时用过），不读文件；
//   · combatRig()：真的 Combat + Stats + EventBus + TaskRunner，敌人 / 玩家是最小的假对象（同 tests/scroll-tactics.test.mjs 的夹具）。
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const srcRoot = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * 冻结的规格快照：tests/fixtures/spec/<name>.json（Unity 版删除前一次性从 C# / Unity 导出物导出，出处写在每份文件的 _comment、*At、_lines 里）。
 * 常量总表 cs-consts.json 的键是相对 Unity 工程 Assets/Game/Scripts 的 C# 文件名（#名字 = 文件里的一段）。
 */
export const spec = name => JSON.parse(readFileSync(new URL(`./fixtures/spec/${name}.json`, import.meta.url), 'utf8'));

const num = text => Number(String(text).replace(/_/g, '').replace(/[fFdDmM]$/, ''));

/** C# 里的 `const float A = 1f, B = 2.5f;` / `const int N = 3;` / `static readonly float X = 0.1f;` → { A: 1, B: 2.5, N: 3, X: 0.1 } */
export function csConsts(source) {
  const out = {};
  for (const m of source.matchAll(/(?:const|static\s+readonly)\s+(?:float|int|double)\s+([^;]+);/g)) {
    for (const part of m[1].split(',')) {
      const kv = part.match(/^\s*(\w+)\s*=\s*(-?[\d._]+(?:e-?\d+)?)[fFdD]?\s*$/);
      if (kv) out[kv[1]] = num(kv[2]);
    }
  }
  return out;
}

/** 读 `name = 1.5f` / `name: 1.5f` / `name => 1.5f` 里的那个数（第一处）；没找到抛错，免得悄悄比 undefined */
export function csNumber(source, name) {
  const m = source.match(new RegExp(`\\b${name}\\b\\s*(?:=>|=|:)\\s*(-?[\\d._]+(?:e-?\\d+)?)[fFdD]?`));
  if (!m) throw new Error(`C# 源码里没找到 ${name}`);
  return num(m[1]);
}

/** C# 数字字面量列表 `1f, 0.75f, 2` → [1, 0.75, 2] */
export const csList = text => text.split(',').map(s => s.trim()).filter(Boolean).map(num);

/**
 * 一棵临时模块图。stubs：{ 'enemies/Models.ts': '<js 源码>' }（键相对 src/），命中的文件不读原文件。
 * 返回 { load(relative) → Promise<模块>, url(relative) → Promise<file: URL>, dispose() }。
 */
export async function tsGraph(stubs = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'spiritfire-parity-'));
  const modules = new Map();
  const stubFiles = new Map(Object.entries(stubs).map(([k, v]) => [path.resolve(srcRoot, k), v]));
  async function url(relative) {
    const file = path.resolve(srcRoot, relative);
    if (modules.has(file)) return modules.get(file);
    const output = path.join(dir, path.relative(srcRoot, file)).replace(/\.ts$/, '.mjs');
    const href = pathToFileURL(output).href;
    modules.set(file, href);
    let source = stubFiles.has(file)
      ? stubFiles.get(file)
      : stripTypeScriptTypes(await readFile(file, 'utf8'), { mode: 'transform' });
    for (const match of [...source.matchAll(/(?:from\s+|import\s*\(?\s*)['"]([^'"]+)['"]/g)]) {
      const spec = match[1];
      const replacement = spec.startsWith('.')
        ? await url(path.relative(srcRoot, path.resolve(path.dirname(file), spec + '.ts')))
        : import.meta.resolve(spec);
      source = source.replaceAll(`'${spec}'`, `'${replacement}'`).replaceAll(`"${spec}"`, `"${replacement}"`);
    }
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, source);
    return href;
  }
  return {
    url,
    load: async relative => import(await url(relative)),
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

/** .NET 的 Math.Round / Mathf.Round：四舍六入五成双（TS 的 Math.round 是五入，对照取整规则时用） */
export function roundHalfEven(x) {
  const f = Math.floor(x), d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

/** float32 往返（Unity 的数是单精度：0.1f + 0.2f 这类和 double 差在第 8 位） */
export const f32 = x => Math.fround(x);

/** 断言用：|a − b| ≤ eps */
export function near(assert, actual, expected, eps = 1e-6, message = '') {
  assert.ok(Math.abs(actual - expected) <= eps, `${message ? message + '：' : ''}${actual} ≠ ${expected}（容差 ${eps}）`);
}

/**
 * 真的 Combat 管线 + 假玩家 / 假敌人。graph = tsGraph() 的返回值（同一张图里的 Stats / EventBus 才是同一个类）。
 * rng：{ next() }，缺省总返回 0.999（不随机暴击、不随机附着），要「必中」的用例自己换。
 */
export async function combatRig(graph, THREE, { rng } = {}) {
  const { Stats } = await graph.load('core/Stats.ts');
  const { EventBus } = await graph.load('core/EventBus.ts');
  const { TaskRunner } = await graph.load('core/Tasks.ts');
  const { Combat } = await graph.load('combat/Combat.ts');
  const enemies = [], cooldowns = [], heals = [], toasts = [];
  const events = new EventBus();
  const weapon = uid => ({ uid, defId: 'test', mag: 3, reserve: 40, element: 'none', affixes: [], rarity: 0, level: 0 });
  const a = weapon(1), b = weapon(2);
  const ctx = {
    events, tasks: new TaskRunner(), rng: rng ?? { next: () => 0.999, range: (lo, hi) => lo + (hi - lo) * 0.5, int: lo => lo, chance: () => false, pick: list => list[0] },
    time: { now: 0, frame: 0, dt: 1 / 60 },
    run: { difficulty: 1, chapter: 0, heroId: 'fox', damageDealt: 0, kills: 0, coins: 0, essence: 0, flags: {} },
    settings: { damageNumbers: false }, stageGroup: new THREE.Group(),
    player: {
      alive: true, hp: 100, shield: 0, position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.7, 0),
      stats: new Stats(), invulnerableTime: 0,
      maxHp() { return this.stats.get('maxHp'); },
      maxShield() { return this.stats.get('maxShield'); },
      addShield(n) { const d = Math.max(0, Math.min(n, this.maxShield() - this.shield)); this.shield += d; return d; },
      heal(n) { const d = Math.max(0, Math.min(n, this.maxHp() - this.hp)); this.hp += d; heals.push(n); if (d > 0) events.emit('player:healed', { amount: d }); return d; },
      takeDamage(n) { this.hp -= n; }, reduceCooldowns(n, slot) { cooldowns.push({ n, slot }); },
    },
    weapons: { active: a, slots: [a, b], isReloading: false, activeForm: null, magCapacity: () => 10 },
    enemies: { all: enemies, list: enemies, queryRadius(c, r, out = []) { out.length = 0; out.push(...enemies.filter(e => e.alive && e.position.distanceTo(c) <= r)); return out; } },
    world: { segmentBlocked: () => false, raycast: () => null },
    audio: { play() {} }, ui: { toast(...args) { toasts.push(args); } }, meta: { addEssence() {} },
    fx: new Proxy({}, { get: () => () => {} }),
  };
  ctx.combat = new Combat(ctx);
  const advance = seconds => { ctx.time.now += seconds; ctx.time.frame++; ctx.tasks.update(seconds); ctx.combat.update(seconds); };
  const enemy = (o = {}) => {
    const e = {
      id: enemies.length + 1, hp: 10000, maxHp: 10000, shield: 0, maxShield: 0, armor: 0, maxArmor: 0,
      alive: true, untargetable: false, damageTakenMult: 1, isBoss: false, isElite: false, radius: 1, height: 2,
      position: new THREE.Vector3(1, 0, 0), statuses: new Map(), def: { color: 0xffffff, essence: 0 }, stunTime: 0, slowMult: 1,
      getBodyCenter(out) { return out.copy(this.position).add(new THREE.Vector3(0, 1, 0)); },
      getHeadCenter(out) { return out.copy(this.position).add(new THREE.Vector3(0, 1.8, 0)); },
      onDamaged() {}, onKilled() {}, knockback() {}, die() { this.alive = false; },
      ...o,
    };
    if (o.x !== undefined) e.position.set(o.x, 0, o.z ?? 0);
    if (o.maxHp !== undefined && o.hp === undefined) e.hp = o.maxHp;
    if (o.maxShield !== undefined && o.shield === undefined) e.shield = o.maxShield;
    if (o.maxArmor !== undefined && o.armor === undefined) e.armor = o.maxArmor;
    enemies.push(e);
    return e;
  };
  const hit = (e, overrides = {}) => ctx.combat.damageEnemy(e, {
    base: 100, element: 'none', source: 'weapon', procDepth: 0, canCrit: false, weaponUid: ctx.weapons.active.uid, ...overrides,
  });
  return { ctx, a, b, events, advance, enemy, hit, enemies, cooldowns, heals, toasts, Stats };
}
