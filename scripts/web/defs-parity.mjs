#!/usr/bin/env node
/**
 * M2 数据对照：Unity 冻结的定义表（tests/fixtures/gameplay-defs.json，schema 2；原 public/assets 下的导出物，2026-11-26 挪到
 * tests/fixtures 作基线，运行时不读）↔ 网页 TS 定义表。网页表是唯一来源；改了数要么和基线一致，要么在下面的 EXCEPTIONS 写明原因。
 *
 *   node scripts/web/defs-parity.mjs            打印差异报告（含已登记的例外）
 *   node scripts/web/defs-parity.mjs --strict   有未登记的差异时退出码 1
 *
 * tests/unity-defs-parity.test.mjs 用同一份映射与例外表断言「没有未登记的差异」。
 *
 * 读网页表的方式：
 * - 武器：src/weapons/WeaponDefs.ts 只 import 类型，整份去类型后直接 import（def() 默认值、散布换算、isHitscan 等都是真的运行时代码）。
 * - 英雄 / 敌人：所在文件 import 了 three、模型、特效，不能整份执行。这里只求值文件里顶格的 `const` / `export const` 初始化式
 *   （数据字面量），按文件顺序求值；引用到的相对路径 import 递归求值对方文件，其余（three、函数、类）给一个占位代理。
 *   所以定义表必须写成字面量（可以引用本文件或别的文件里的常量），不能在函数里拼。
 *
 * 字段映射与单位约定见下方 WEAPON_FIELDS / ENEMY_FIELDS / HERO_FIELDS 的注释，汇总在 docs/threejs-migration.md「M2 字段映射」。
 */
import { readFile, readdir } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ───────────────────────────── 读 TS：顶格常量求值 ─────────────────────────────

const STUB = Symbol('stub');

/** 占位代理：任意属性、调用、new 都返回新的占位；转字符串得到 `<路径>`，对照时一眼能看出是没解析到的引用 */
function stub(label) {
  const target = function () {};
  return new Proxy(target, {
    get(_, key) {
      if (key === STUB) return label;
      if (key === Symbol.toPrimitive) return () => `<${label}>`;
      if (key === 'then') return undefined;
      return stub(`${label}.${String(key)}`);
    },
    apply: () => stub(`${label}()`),
    construct: () => stub(`new ${label}`),
  });
}

export function isStub(v) {
  return (typeof v === 'function' || typeof v === 'object') && v !== null && v[STUB] !== undefined;
}

/** 从 i（`=` 之后）扫到表达式结尾：深度 0 的 `;`，或深度 0 换行后紧跟顶格声明。跳过字符串、模板、注释 */
function scanExpression(src, i) {
  let depth = 0;
  const templates = []; // 模板字面量里 ${ 的括号深度栈
  const start = i;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) i = src.length; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '`' || (c === '}' && templates.length && templates[templates.length - 1] === depth)) {
      if (c === '}') templates.pop();
      i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { templates.push(depth); i += 2; break; }
        i++;
      }
      if (src[i] === '`') i++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === ';') return src.slice(start, i);
    else if (depth === 0 && c === '\n' && /^(export |const |let |function |class |import |type |interface )/.test(src.slice(i + 1, i + 12))) return src.slice(start, i);
    i++;
  }
  return src.slice(start, i);
}

/** 相对 import 的绑定：本地名 → { 文件, 导出名 } */
function importBindings(src, file) {
  const map = new Map();
  const re = /^import\s+(?!type\b)([^'";]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  for (const m of src.matchAll(re)) {
    const spec = m[2];
    if (!spec.startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), spec) + '.ts';
    const clause = m[1];
    const named = clause.match(/\{([^}]*)\}/);
    if (!named) continue;
    for (const part of named[1].split(',')) {
      const p = part.trim().replace(/^type\s+/, '');
      if (!p || part.trim().startsWith('type ')) continue;
      const [imported, local] = p.split(/\s+as\s+/).map(s => s.trim());
      map.set(local ?? imported, { file: target, name: imported });
    }
  }
  return map;
}

const moduleCache = new Map();

/**
 * 求值一个 TS 文件里所有顶格常量（`const X =` / `export const X =`，按文件顺序），返回 { 名字: 值 }。
 * 求值出错的常量记成占位；引用的相对 import 递归求值对方文件。
 */
export async function evalConsts(file) {
  file = path.resolve(file);
  if (moduleCache.has(file)) return moduleCache.get(file);
  const values = new Map();
  moduleCache.set(file, values);
  const raw = await readFile(file, 'utf8');
  const src = stripTypeScriptTypes(raw, { mode: 'transform' });
  const imports = importBindings(src, file);
  const resolved = new Map();
  for (const [local, { file: dep, name }] of imports) {
    try {
      const mod = await evalConsts(dep);
      if (mod.has(name)) resolved.set(local, mod.get(name));
    } catch { /* 找不到的文件当占位 */ }
  }
  const scope = new Proxy(Object.create(null), {
    has: (_, key) => typeof key === 'string' && (values.has(key) || resolved.has(key) || !(key in globalThis)),
    get: (_, key) => {
      if (key === Symbol.unscopables) return undefined;
      if (values.has(key)) return values.get(key);
      if (resolved.has(key)) return resolved.get(key);
      return stub(String(key));
    },
  });
  const decl = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/gm;
  for (const m of src.matchAll(decl)) {
    const expr = scanExpression(src, m.index + m[0].length);
    try {
      // eslint-disable-next-line no-new-func
      values.set(m[1], new Function('__scope', `with (__scope) { return (${expr}\n); }`)(scope));
    } catch {
      values.set(m[1], stub(m[1]));
    }
  }
  return values;
}

/** 整份去类型后 import（只适用于只 import 类型的文件） */
export async function importTs(file) {
  const src = stripTypeScriptTypes(await readFile(file, 'utf8'), { mode: 'transform' });
  return import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
}

// ───────────────────────────── 读两边的表 ─────────────────────────────

/** 基线：Unity 冻结的定义表（tests/fixtures/gameplay-defs.json） */
export async function loadBaseline(root = ROOT) {
  return JSON.parse(await readFile(path.join(root, 'tests/fixtures/gameplay-defs.json'), 'utf8'));
}

/** 网页的表：武器（真模块）、英雄（三个技能文件里的 HeroDef + 选英雄界面元数据 + 基础属性）、敌人（types/*.ts 与第四章表里的 *_DEF） */
export async function loadWeb(root = ROOT) {
  const src = (p) => path.join(root, 'src', p);
  const weapons = await importTs(src('weapons/WeaponDefs.ts'));
  const heroes = {};
  for (const [file, name] of [['player/skills/fox.ts', 'FOX'], ['player/skills/falcon.ts', 'FALCON'], ['player/skills/bear.ts', 'BEAR']]) {
    const def = (await evalConsts(src(file))).get(name);
    heroes[def.id] = def;
  }
  const meta = (await evalConsts(src('ui/labels.ts'))).get('HERO_META');
  const baseStats = (await evalConsts(src('core/Stats.ts'))).get('BASE_STATS');
  const enemies = {};
  const addDef = (def, where) => {
    if (!def || isStub(def) || typeof def.id !== 'string') return;
    if (enemies[def.id]) throw new Error(`敌人 ${def.id} 在网页表里定义了两次（${where}）`);
    enemies[def.id] = def;
  };
  const typesDir = src('enemies/types');
  for (const f of (await readdir(typesDir)).filter((f) => f.endsWith('.ts')).sort()) {
    for (const [name, value] of await evalConsts(path.join(typesDir, f))) if (name.endsWith('_DEF')) addDef(value, f);
  }
  const plateau = await evalConsts(src('enemies/plateau/index.ts'));
  for (const def of plateau.get('PLATEAU_ENEMY_DEFS') ?? []) addDef(def, 'plateau/index.ts');
  const foeSpecs = (await evalConsts(src('world/plateau/play/foes.ts'))).get('FOE_SPECS');
  return { weapons, heroes, meta, baseStats, enemies, foeSpecs };
}

// ───────────────────────────── 字段映射 ─────────────────────────────

const ENUM = (table) => (v) => (v in table ? table[v] : `?${v}`);
const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : v);
/** Unity 枚举名 → TS 字符串字面量 */
export const ELEMENT = { None: 'none', Fire: 'fire', Shock: 'shock', Corrode: 'corrode' };
export const RELOAD_STYLE = { Magazine: 'mag', Shell: 'shell', Cylinder: 'cylinder', Tube: 'tube', Cell: 'cell', Box: 'box' };
/** Newtonsoft 把 float.PositiveInfinity 写成字符串 "Infinity" */
const num = (v) => (v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : v);

/**
 * 一列映射：key = Unity 字段名（报告里的列名），unity / web 取值函数，type 决定比较方式：
 *   num   数值，|a − b| ≤ 1e-6 + 1e-6·|a|（Unity 是 float32，Newtonsoft 写最短回读形式）
 *   exact 严格相等（字符串、布尔、枚举名）
 *   color Unity Color [r, g, b, a]（0–1）↔ TS 0xRRGGBB：每通道 round(c·255) 与 TS 字节差 ≤ 1（Unity 有些颜色手写成两位小数）；alpha 必须 1
 *   deep  结构递归比较，数值按 num
 */
const field = (key, unity = (u) => u[key], web = (w) => w[key], type = 'num') => ({ key, unity, web, type });

/**
 * 武器（Unity WeaponDef ↔ TS WeaponDef）。约定：
 * - 角度一律半角弧度，射速 = 发 / 秒（点射 = 轮 / 秒，光束 = 跳 / 秒），两边相同，不换算。
 * - 散布：Unity spreadTs = TS 原值，spreadScale = 0.4，spreadTuned = D11 之前手调的 6 把；有效值 spreadHip… 是属性
 *   （tuned ?? ts × scale；恢复速度不缩放）。TS 同样存 spreadTs / spreadScale / spreadTuned，def() 里算出有效的 spreadHip…，运行时只读有效值。
 * - 嵌套 ↔ 摊平：recoil.pitch ↔ recoilPitch…；kick.back / rot ↔ kickBack / kickRot；falloff [start, end, mult] | null ↔ falloffStart / End / Mult（null = 999 / 1000 / 1）。
 * - 视图偏移：Unity viewHip / viewAim = WeaponDef.View(x, y, z) = (x, y, −z)，TS viewOffset / aimOffset 是 Three.js 相机空间（z 前为负）→ z 取反比较。
 * - 弹体颜色：Unity Color ↔ TS 0xRRGGBB；稀有度倍率 RARITY_DAMAGE 不在 defs.json 里（在 WeaponLibrary 静态表），由测试另外断言。
 * - 不对照：prefab（Unity 是原作提取的 GunfireOriginal 模型名，网页用 SK_Weapon_<Id>.glb）、rightHand / leftHand / rightPitch / leftRoll（第一人称握点，M10 持枪手感迁）、
 *   subElement / subChance（Unity 旧字段，全表 None / 0，副元素已由 innate 词条承担）。
 */
const flat3 = (v, flipZ) => (v ? [v[0], v[1], flipZ ? -v[2] : v[2]] : v);
export const WEAPON_FIELDS = [
  field('name', undefined, undefined, 'exact'),
  field('category', undefined, undefined, 'exact'),
  field('kind', (u) => lower(u.kind), undefined, 'exact'),
  field('mode', (u) => lower(u.mode), undefined, 'exact'),
  field('reload', (u) => ENUM(RELOAD_STYLE)(u.reload), (w) => w.reloadStyle, 'exact'),
  ...['damage', 'fireRate', 'reloadTime', 'shellTime', 'reloadStart', 'mag', 'reserve', 'pellets', 'burstCount', 'burstInterval', 'pelletCone', 'pierce'].map((k) => field(k)),
  field('spreadTs', undefined, undefined, 'deep'),
  field('spreadScale'),
  field('spreadTuned', undefined, undefined, 'deep'),
  // 有效散布（Unity 计算属性）
  ...['spreadHip', 'spreadAim', 'spreadPerShot', 'spreadMax', 'spreadRecovery'].map((k) => field(k)),
  field('recoilPitch', undefined, (w) => w.recoil.pitch),
  field('recoilYaw', undefined, (w) => w.recoil.yaw),
  field('recoilBias', undefined, (w) => w.recoil.bias),
  field('recoilClimb', undefined, (w) => w.recoil.climb),
  field('critMult'),
  field('range'),
  field('falloffStart', undefined, (w) => (w.falloff ? w.falloff[0] : 999)),
  field('falloffEnd', undefined, (w) => (w.falloff ? w.falloff[1] : 1000)),
  field('falloffMult', undefined, (w) => (w.falloff ? w.falloff[2] : 1)),
  field('knockback'),
  field('kickBack', undefined, (w) => w.kick.back),
  field('kickRot', undefined, (w) => w.kick.rot),
  ...['shake', 'flash', 'tracerWidth', 'impactSize'].map((k) => field(k)),
  field('sfx', undefined, undefined, 'exact'),
  field('sfxVolume'),
  field('aimFov'),
  field('aimSpeed'),
  field('element', (u) => ENUM(ELEMENT)(u.element), undefined, 'exact'),
  field('elementChance'),
  field('innate', undefined, undefined, 'deep'),
  field('cycle', (u) => (u.cycle ? u.cycle.map(ENUM(ELEMENT)) : null), undefined, 'deep'),
  field('projectile', (u) => (u.projectile ? 'object' : null), (w) => (w.projectile ? 'object' : null), 'exact'),
  ...['speed', 'gravity', 'radius', 'explosionRadius', 'lifetime', 'scale', 'bounces', 'homing', 'count', 'stagger', 'fan'].map((k) =>
    field(`projectile.${k}`, (u) => u.projectile?.[k], (w) => w.projectile?.[k])),
  ...['rollAfter', 'explodeOnExpire', 'visual', 'fanFixed'].map((k) =>
    field(`projectile.${k}`, (u) => u.projectile?.[k], (w) => w.projectile?.[k], 'exact')),
  field('projectile.color', (u) => u.projectile?.color, (w) => w.projectile?.color, 'color'),
  ...['chainFraction', 'chainRange', 'spinup', 'moveSlow', 'chargeTime', 'chargeMinMult', 'chargeFullPierce'].map((k) => field(k)),
  field('chargeDetonate', undefined, undefined, 'exact'),
  field('dropWeight'),
  field('worldScale'),
  field('blade', undefined, undefined, 'deep'),
  field('viewHip', (u) => flat3(u.viewHip, true), (w) => w.viewOffset, 'deep'),
  field('viewAim', (u) => flat3(u.viewAim, true), (w) => w.aimOffset, 'deep'),
  field('description', undefined, undefined, 'exact'),
  field('notes', undefined, undefined, 'deep'),
  // 计算属性 ↔ TS 帮助函数
  field('IsHitscan', undefined, (w, m) => m.isHitscan(w), 'exact'),
  field('IsExplosive', undefined, (w, m) => m.isExplosive(w), 'exact'),
  field('IsBlade', undefined, (w, m) => m.isBlade(w), 'exact'),
  field('HitsPerShot', undefined, (w, m) => m.hitsPerShot(w)),
  field('ComboCycleTime', undefined, (w, m) => m.comboCycleTime(w)),
];

/**
 * 敌人（Unity EnemyDef ↔ TS EnemyDef / ScaledEnemyDef）。约定：
 * - 尺寸是美术设计尺寸（放大前），两边生成时都乘 scale（精英再 × 1.25）：radius / height / weakHeight ↔ radius / height / headY。
 * - WeakHeight（计算属性：weakHeight > 0 ? weakHeight : height × 0.85）↔ headY ?? height × 0.85；weakRadius（缺省 0.2）↔ headRadius ?? radius × 0.55。
 *   Unity 的 WeakHeight 只给缺 Prefab 时的占位体用（真弱点挂在 weakBone 骨骼上）；网页的 headY 是静止姿态的头心 / 身体胶囊上沿 / 视线高，
 *   多数敌人两者同值，不同的登记在例外表。
 * - 枚举：element None/Fire/Shock/Corrode ↔ 'none'…；rank Normal/Elite/Boss ↔ 'normal'…；placementRole Assault… ↔ placement 'assault'…；
 *   role（AttackTokens.Kind）Melee/Ranged/Heavy ↔ role 'melee'…；hitboxes Capsule/Ragdoll ↔ 'capsule' / 'ragdoll'。
 * - TS 可选字段缺省同 Unity 的 C# 字段初值：armor / shield / knockbackResist / essence / poise / hitch = 0，scale = 1，staggerSeconds = 0.6，
 *   rank = normal，flying / groundOnly / charger = false，element = none，affixExclusions = []，hitboxes = capsule。
 * - poise：Unity +∞（Newtonsoft 写 "Infinity"）= 不硬直，TS 用 Infinity。
 * - coins：Unity Vector2Int（导出成 [min, max]）↔ TS [min, max]。
 * - 不对照：prefab（网页按 id 找美术）、ai（网页的行为类由 Registry 工厂决定）、GlowColor（element / color 推出来的）。
 */
const RANK = { Normal: 'normal', Elite: 'elite', Boss: 'boss' };
export const ENEMY_FIELDS = [
  field('name', undefined, undefined, 'exact'),
  ...['hp', 'speed', 'damage', 'radius', 'height'].map((k) => field(k)),
  ...['armor', 'shield', 'knockbackResist', 'essence'].map((k) => field(k, undefined, (w) => w[k] ?? 0)),
  field('scale', undefined, (w) => w.scale ?? 1),
  field('WeakHeight', undefined, (w) => w.headY ?? w.height * 0.85),
  field('weakRadius', undefined, (w) => w.headRadius ?? w.radius * 0.55),
  field('weakBone', undefined, (w) => w.weakBone ?? null, 'exact'),
  field('hitboxes', (u) => lower(u.hitboxes), (w) => w.hitboxes ?? 'capsule', 'exact'),
  field('role', (u) => lower(u.role), (w) => w.role, 'exact'),
  field('rank', (u) => ENUM(RANK)(u.rank), (w) => w.rank ?? 'normal', 'exact'),
  field('placementRole', (u) => lower(u.placementRole), (w) => w.placement, 'exact'),
  field('flying', undefined, (w) => w.flying ?? false, 'exact'),
  field('groundOnly', undefined, (w) => w.groundOnly ?? false, 'exact'),
  field('charger', undefined, (w) => w.charger ?? false, 'exact'),
  field('coins', undefined, undefined, 'deep'),
  field('color', undefined, undefined, 'color'),
  field('element', (u) => ENUM(ELEMENT)(u.element), (w) => w.element ?? 'none', 'exact'),
  field('affixExclusions', undefined, (w) => w.affixExclusions ?? [], 'deep'),
  field('poise', (u) => num(u.poise), (w) => w.poise ?? 0),
  field('staggerSeconds', undefined, (w) => w.staggerSeconds ?? 0.6),
  field('hitch', undefined, (w) => w.hitch ?? 0),
];

/**
 * 英雄（Unity HeroDef ↔ TS HeroDef + ui/labels.ts 的 HERO_META + core/Stats.ts 的 BASE_STATS）。约定：
 * - maxHp / maxShield / moveSpeed ↔ base 里的同名键，没写取 BASE_STATS；Unity baseStats [(Stat, value)] ↔ base 里其余的键（Stat 枚举名首字母小写）。
 * - startWeapon ↔ startingWeapon；passiveName / passiveDescription ↔ passive.name / passive.description（TS 说明是模板串，代入常量后比较）。
 * - role / difficulty / tags / tip ↔ HERO_META[id]。
 * - 不对照：armR / armL（第一人称手臂 Prefab，M10）、unlockCost（D8 三人全开，两边都没有解锁价）。
 */
const camel = (s) => s[0].toLowerCase() + s.slice(1);
const CORE_STATS = ['maxHp', 'maxShield', 'moveSpeed'];
export const HERO_FIELDS = [
  ...['name', 'title', 'description'].map((k) => field(k, undefined, undefined, 'exact')),
  field('color', undefined, undefined, 'color'),
  ...CORE_STATS.map((k) => field(k, undefined, (w, ctx) => w.base[k] ?? ctx.baseStats[k])),
  field('baseStats',
    (u) => Object.fromEntries(u.baseStats.map((s) => [camel(s.Item1), s.Item2])),
    (w) => Object.fromEntries(Object.entries(w.base).filter(([k]) => !CORE_STATS.includes(k))), 'deep'),
  field('startWeapon', undefined, (w) => w.startingWeapon, 'exact'),
  ...['role', 'difficulty', 'tip'].map((k) => field(k, undefined, (w, ctx) => ctx.meta[w.id]?.[k], k === 'difficulty' ? 'num' : 'exact')),
  field('tags', undefined, (w, ctx) => ctx.meta[w.id]?.tags, 'deep'),
  field('passiveName', undefined, (w) => w.passive.name, 'exact'),
  field('passiveDescription', undefined, (w) => w.passive.description, 'exact'),
];

// ───────────────────────────── 比较 ─────────────────────────────

const closeNum = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-6 + 1e-6 * Math.abs(a));

function deepEqual(a, b) {
  if (typeof a === 'number' || typeof b === 'number') return closeNum(a, b);
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

function colorEqual(u, w) {
  if (u === undefined && w === undefined) return true;
  if (!Array.isArray(u) || typeof w !== 'number') return false;
  const bytes = [(w >> 16) & 255, (w >> 8) & 255, w & 255];
  return Math.abs(u[3] - 1) < 1e-6 && bytes.every((b, i) => Math.abs(Math.round(u[i] * 255) - b) <= 1);
}

function same(type, u, w) {
  if (isStub(w)) return false;
  switch (type) {
    case 'num': return closeNum(u, w);
    case 'exact': return u === w;
    case 'color': return colorEqual(u, w);
    case 'deep': return deepEqual(u, w);
    default: throw new Error(type);
  }
}

const show = (v) => {
  if (isStub(v)) return `<未解析 ${String(v)}>`;
  if (typeof v === 'number' && v > 0xff && Number.isInteger(v)) return `0x${v.toString(16).padStart(6, '0')}`;
  return JSON.stringify(v) ?? String(v);
};

/**
 * 有意保留的差异（表、id、字段 → 原因）。测试断言：除这些之外没有差异，且这里每一条仍然是真的差异（修好了就删掉）。
 * key 为 '*' 表示整行（网页表里没有这个 id）。
 */
export const EXCEPTIONS = [
  {
    table: 'weapons', id: 'rifle', key: 'viewAim',
    reason: 'Unity 步枪第一人称换成 Gunfire 1001 原作模型（提把机瞄，开镜高 0.055）；GunfireOriginal 不迁，网页仍是自家 SK_Weapon_Rifle + 程序红点（准心高 0.1），开镜位置跟自家瞄具走',
  },
  {
    table: 'weapons', id: 'lantern', key: 'projectile.visual',
    reason: 'Unity 给蚀蛊灯新做了 lantern 弹体外观（ProjectileVisuals 的 Lantern 飘行 + 光晕）；网页 ProjectileVisual 还没有这一种，随 M11b 特效核心迁，之前沿用 orb',
  },
  {
    table: 'enemies', id: 'huodou', key: 'WeakHeight',
    reason: 'Unity weakHeight 0.56 是肋下熔火（弱点）中心，只给缺 Prefab 的占位体用；网页 headY 0.92 是头心（视线 / 血条 / 身体胶囊上沿），弱点由 Huodou 的逐骨命中球给出（肋下 r 0.11，同 Unity weakBone chest / weakRadius）',
  },
  {
    table: 'enemies', id: 'firecracker', key: 'WeakHeight',
    reason: 'Unity weakHeight 0.76 是腹部火药仓（弱点）中心，只给占位体用；网页 headY 1.52 是木头脑袋（头不是弱点，算身体胶囊上沿与视线），弱点火药仓由 Firecracker 的逐骨命中球给出',
  },
];

const exceptionKey = (table, id, key) => `${table}/${id}/${key}`;

/** 逐表逐行逐列比较，返回 { diffs: [{ table, id, key, unity, web, reason? }], missing: [{ table, id, reason? }] } */
export function compare(unity, web) {
  const diffs = [];
  const missing = [];
  const excepted = new Map(EXCEPTIONS.map((e) => [exceptionKey(e.table, e.id, e.key), e.reason]));
  const run = (table, rows, lookup, fields, ctx) => {
    for (const u of rows) {
      const w = lookup(u.id);
      if (!w) {
        missing.push({ table, id: u.id, reason: excepted.get(exceptionKey(table, u.id, '*')) });
        continue;
      }
      for (const f of fields) {
        const uv = f.unity(u);
        const wv = f.web(w, ctx);
        if (same(f.type, uv, wv)) continue;
        diffs.push({ table, id: u.id, key: f.key, unity: uv, web: wv, reason: excepted.get(exceptionKey(table, u.id, f.key)) });
      }
    }
  };
  const weaponById = new Map(web.weapons.WEAPON_DEFS.map((w) => [w.id, w]));
  run('weapons', unity.weapons, (id) => weaponById.get(id), WEAPON_FIELDS, web.weapons);
  run('enemies', unity.enemies, (id) => web.enemies[id], ENEMY_FIELDS, web);
  run('heroes', unity.heroes, (id) => web.heroes[id], HERO_FIELDS, web);
  return { diffs, missing };
}

/** 例外表里已经不成立的条目（差异已消失） */
export function staleExceptions(result) {
  const live = new Set([
    ...result.diffs.map((d) => exceptionKey(d.table, d.id, d.key)),
    ...result.missing.map((m) => exceptionKey(m.table, m.id, '*')),
  ]);
  return EXCEPTIONS.filter((e) => !live.has(exceptionKey(e.table, e.id, e.key)));
}

export function report(result) {
  const lines = [];
  const open = result.diffs.filter((d) => !d.reason);
  const known = result.diffs.filter((d) => d.reason);
  const missingOpen = result.missing.filter((m) => !m.reason);
  lines.push(`未登记的差异 ${open.length} 处，缺行 ${missingOpen.length}，已登记例外 ${known.length + result.missing.length - missingOpen.length} 处`);
  for (const m of result.missing) lines.push(`  ${m.reason ? '例外' : '缺行'} ${m.table}/${m.id}${m.reason ? `：${m.reason}` : '：网页表里没有这一行'}`);
  for (const d of open) lines.push(`  差异 ${d.table}/${d.id}.${d.key}：Unity ${show(d.unity)} ≠ 网页 ${show(d.web)}`);
  for (const d of known) lines.push(`  例外 ${d.table}/${d.id}.${d.key}：Unity ${show(d.unity)} / 网页 ${show(d.web)}（${d.reason}）`);
  for (const e of staleExceptions(result)) lines.push(`  过期例外 ${e.table}/${e.id}.${e.key}：两边已经一致，从 EXCEPTIONS 删掉`);
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = compare(await loadBaseline(), await loadWeb());
  console.log(report(result));
  const bad = result.diffs.some((d) => !d.reason) || result.missing.some((m) => !m.reason) || staleExceptions(result).length > 0;
  if (process.argv.includes('--strict') && bad) process.exitCode = 1;
}
