// 灵宠定义（M9）→ 网页：src/pets/PetDefsData.ts（纯数据，不手抄）。不需要 Unity，直接读 C# 源码与美术 sidecar。
//
//   node scripts/web/export-pet-defs.mjs            写
//   node scripts/web/export-pet-defs.mjs --check    只核对 src/pets/PetDefsData.ts 是不是由当前 C# 生成的（不写）
//
// 读：
//   · unity/Assets/Game/Scripts/Pets/PetDefs.cs —— PetRarities（品阶名、品阶色、抽取权重、神兽金）与 PetLibrary.All 八只灵宠的对象初始化器
//     （缺省值读 PetDef 的字段初值：height 0.7、moveSpeed 9、followBack 3 / followSide 1.2 / flyHeight 2、skillCooldown 20、partGlow）；
//     颜色字面量 new Color(r, g, b) / CommonFx / MythicFx / DamageTable.ElementColor(Element.X)（后者读 Combat/Damage.cs）。
//   · unity/Assets/Art/Characters/SK_Pet_<名>/SK_Pet_<名>.art.json 的 fur 段（毛发壳层：毛长、每骨倍数、排除球 / 长方体）+ 设计包围盒高度；
//     缺省值读 Pipeline/Editor/FurBake.cs 的 FurSettings.From（`?? (feather ? a : b)` / `?? c`），毛长缺省 = 身高 × 0.02（羽 0.012），
//     发丝格子密度缺省 = 1 / (0.35 × 毛长)。
// 坐标：fur 的排除球 / 长方体是骨架坐标（Blender：前 −Y、左 +X、上 +Z），原样导出；网页加载时换到模型空间（src/pets/PetFur.ts）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const UNITY = join(ROOT, 'unity/Assets');
const OUT = join(ROOT, 'src/pets/PetDefsData.ts');
const check = process.argv.includes('--check');

const read = p => readFileSync(join(UNITY, p), 'utf8');
const defsCs = read('Game/Scripts/Pets/PetDefs.cs');
const damageCs = read('Game/Scripts/Combat/Damage.cs');
const furCs = read('Pipeline/Editor/FurBake.cs');

const num = s => Number(String(s).trim().replace(/[fFdD]$/, ''));
const r4 = v => Math.round(v * 1e6) / 1e6;

/** 顶层逗号切分（跳过字符串、括号 / 花括号里的逗号） */
function splitTop(text, sep = ',') {
  const out = [];
  let depth = 0, inStr = false, cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      cur += c;
      if (c === '\\') { cur += text[++i]; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; cur += c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    if (c === ')' || c === '}' || c === ']') depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

/** 从 start（指向开括号）起找配对的闭括号位置 */
function matchClose(text, start) {
  const open = text[start], close = { '{': '}', '(': ')', '[': ']' }[open];
  let depth = 0, inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  throw new Error(`括号没配上（${open} @ ${start}）`);
}

const colorLit = s => {
  const m = s.match(/^new(?:\s+Color)?\s*\(([^)]*)\)$/);
  if (!m) return null;
  const parts = m[1].split(',').map(num);
  return parts.slice(0, 3).map(r4);
};

// ───────────── 元素色（Combat/Damage.cs DamageTable.ElementColor）─────────────
const elementColors = {};
{
  const body = damageCs.slice(damageCs.indexOf('public static Color ElementColor'));
  for (const m of body.matchAll(/Element\.(\w+)\s*=>\s*(new Color\([^)]*\))/g)) elementColors[m[1]] = colorLit(m[2]);
  elementColors.None = [1, 1, 1];
  if (!elementColors.Fire || !elementColors.Shock || !elementColors.Corrode) throw new Error('Damage.cs 里没读到元素色');
}

// ───────────── PetRarities ─────────────
function arrayInit(name) {
  const i = defsCs.indexOf(name + ' = {');
  if (i < 0) throw new Error(`PetDefs.cs 里没找到 ${name}`);
  const open = defsCs.indexOf('{', i);
  return splitTop(defsCs.slice(open + 1, matchClose(defsCs, open)));
}
const rarity = {
  names: arrayInit('Names').map(s => JSON.parse(s)),
  colors: arrayInit('Colors').map(colorLit),
  weights: arrayInit('Weights').map(num),
  gold: colorLit(defsCs.match(/Gold\s*=\s*(new\([^)]*\))/)[1]),
};

// ───────────── PetDef 字段初值（缺省）─────────────
const defClass = defsCs.slice(defsCs.indexOf('public sealed class PetDef'), defsCs.indexOf('public static class PetLibrary'));
const fieldDefault = name => {
  const m = defClass.match(new RegExp(`\\b${name}\\s*=\\s*([^,;]+(?:\\([^)]*\\))?)\\s*[,;]`));
  if (!m) throw new Error(`PetDef 里没找到 ${name} 的初值`);
  return m[1].trim();
};
const DEFAULTS = {
  height: num(fieldDefault('height')), moveSpeed: num(fieldDefault('moveSpeed')),
  followBack: num(fieldDefault('followBack')), followSide: num(fieldDefault('followSide')), flyHeight: num(fieldDefault('flyHeight')),
  skillCooldown: num(fieldDefault('skillCooldown')),
  partGlow: colorLit(defClass.match(/partGlow\s*=\s*(new\([^)]*\))/)[1]),
};

// ───────────── PetLibrary.All ─────────────
const lib = defsCs.slice(defsCs.indexOf('public static class PetLibrary'));
const named = {};
for (const m of lib.matchAll(/(\w+)\s*=\s*(new\([^)]*\))/g)) named[m[1]] = colorLit(m[2]);

function value(raw) {
  const s = raw.trim();
  if (s.startsWith('"')) return JSON.parse(s);
  if (/^-?[\d.]+[fF]?$/.test(s)) return r4(num(s));
  if (s === 'true' || s === 'false') return s === 'true';
  const enumM = s.match(/^(PetRarity|Element|PetShape)\.(\w+)$/);
  if (enumM) {
    if (enumM[1] === 'PetRarity') return ['Common', 'Rare', 'Mythic'].indexOf(enumM[2]);
    const v = enumM[2];
    return v[0].toLowerCase() + v.slice(1);
  }
  const c = colorLit(s);
  if (c) return c;
  const el = s.match(/^DamageTable\.ElementColor\(Element\.(\w+)\)$/);
  if (el) return elementColors[el[1]];
  if (named[s]) return named[s];
  const beh = s.match(/^\(\)\s*=>\s*new\s+(\w+)Behaviour\(\)$/);
  if (beh) return beh[1].toLowerCase();
  throw new Error(`认不出的值：${s}`);
}

const allStart = lib.indexOf('All =');
const allOpen = lib.indexOf('{', allStart);
const allBody = lib.slice(allOpen + 1, matchClose(lib, allOpen));
const defs = [];
for (const entry of splitTop(allBody)) {
  const open = entry.indexOf('{');
  const body = entry.slice(open + 1, matchClose(entry, open));
  const d = {};
  for (const kv of splitTop(body)) {
    const eq = kv.indexOf('=');
    const key = kv.slice(0, eq).trim();
    d[key === 'create' ? 'behaviour' : key] = value(kv.slice(eq + 1));
  }
  defs.push(d);
}
if (defs.length !== 8) throw new Error(`PetLibrary.All 读出 ${defs.length} 只（应为 8）`);

const KEYS = ['id', 'assetId', 'name', 'title', 'rarity', 'lore', 'role', 'element', 'flying', 'height', 'moveSpeed', 'followBack', 'followSide',
  'flyHeight', 'hover', 'shape', 'body', 'accent', 'fx', 'attackDesc', 'passiveName', 'passiveDesc', 'skillName', 'skillDesc', 'skillCooldown',
  'awakenDesc', 'behaviour', 'partId', 'partSocket', 'partGlow'];
const full = defs.map(d => {
  const o = {};
  for (const k of KEYS) {
    let v = d[k];
    if (v === undefined) {
      if (k in DEFAULTS) v = DEFAULTS[k];
      else if (k === 'flying') v = false;
      else if (k === 'hover') v = 0;
      else if (k === 'partId' || k === 'partSocket') v = '';
      else if (k === 'passiveName' || k === 'passiveDesc') v = '';
      else throw new Error(`${d.id} 缺字段 ${k}`);
    }
    o[k] = v;
  }
  return o;
});

// ───────────── 毛发（art.json 的 fur）─────────────
const furDefault = (name, feather) => {
  const pair = furCs.match(new RegExp(`\\b${name}\\s*=\\s*\\((?:float|int|bool)\\?\\)f\\["\\w+"\\]\\s*\\?\\?\\s*\\(feather\\s*\\?\\s*([\\w.]+)\\s*:\\s*([\\w.]+)\\)`));
  if (pair) return value(feather ? pair[1] : pair[2]);
  const one = furCs.match(new RegExp(`\\b${name}\\s*=\\s*\\((?:float|int|bool)\\?\\)f\\["\\w+"\\]\\s*\\?\\?\\s*([\\w.]+)\\s*,`));
  if (one) return value(one[1]);
  throw new Error(`FurBake.cs 里没找到 ${name} 的缺省值`);
};
const lengthK = furCs.match(/height\s*\*\s*\(feather\s*\?\s*([\d.]+)f\s*:\s*([\d.]+)f\)/);
const densityK = furCs.match(/1f\s*\/\s*\(([\d.]+)f\s*\*\s*Mathf\.Max\(([\d.]+)f,\s*s\.length\)\)/);
if (!lengthK || !densityK) throw new Error('FurBake.cs 里没读到毛长 / 密度的缺省公式');

const fur = {};
for (const d of full) {
  const p = join(UNITY, `Art/Characters/${d.assetId}/${d.assetId}.art.json`);
  if (!existsSync(p)) throw new Error(`没有 ${p}`);
  const art = JSON.parse(readFileSync(p, 'utf8'));
  const f = art.fur;
  if (!f) continue;
  const feather = f.kind === 'feather';
  const height = art.bounds ? art.bounds.max[1] - art.bounds.min[1] : 1;
  const length = r4(f.length ?? height * num(feather ? lengthK[1] : lengthK[2]));
  const o = { kind: feather ? 'feather' : 'fur', length };
  for (const k of ['thickness', 'stretch', 'facing', 'comb', 'droop', 'shells', 'fins', 'detail', 'sheen', 'fuzz']) o[k] = f[k] ?? furDefault(k, feather);
  o.flowDroop = f.flow_droop ?? furDefault('flowDroop', feather);
  o.density = r4(f.density ?? 1 / (num(densityK[1]) * Math.max(num(densityK[2]), length)));
  o.bones = Object.entries(f.bones ?? {}).map(([pattern, mult]) => [pattern, mult]);
  o.exclude = (f.exclude ?? []).filter(e => e.center).map(e => ({ center: e.center, radius: e.radius }));
  o.excludeBoxes = (f.exclude ?? []).filter(e => e.min && e.max).map(e => ({ min: e.min, max: e.max }));
  fur[d.id] = o;
}

// ───────────── 写 ─────────────
const ts = `// 自动生成：node scripts/web/export-pet-defs.mjs（读 unity/Assets/Game/Scripts/Pets/PetDefs.cs、Combat/Damage.cs 的元素色、
// Art/Characters/SK_Pet_*/*.art.json 的 fur 段与 Pipeline/Editor/FurBake.cs 的缺省值）。不要手改；改了 C# 重新导出，--check 核对。
// 颜色是 Unity 的 0–1 线性分量 [r, g, b]；rarity 0 凡灵 / 1 灵兽 / 2 神兽；behaviour = 行为类名（去掉 Behaviour、小写）。

/** 品阶（PetRarities）：名字、颜色、抽取权重、神兽金 */
export const PET_RARITY_DATA = ${JSON.stringify(rarity)} as const;

export interface PetDefData {
  id: string; assetId: string; name: string; title: string; rarity: 0 | 1 | 2; lore: string; role: string;
  element: 'none' | 'fire' | 'shock' | 'corrode'; flying: boolean;
  height: number; moveSpeed: number; followBack: number; followSide: number; flyHeight: number; hover: number;
  shape: 'boar' | 'cat' | 'smallBird' | 'pheasant' | 'lion' | 'leopard' | 'sage' | 'dragon';
  body: readonly [number, number, number]; accent: readonly [number, number, number]; fx: readonly [number, number, number];
  attackDesc: string; passiveName: string; passiveDesc: string; skillName: string; skillDesc: string; skillCooldown: number; awakenDesc: string;
  behaviour: string; partId: string; partSocket: string; partGlow: readonly [number, number, number];
}

/** 八只灵宠（PetLibrary.All 的顺序） */
export const PET_DEF_DATA: readonly PetDefData[] = [
${full.map(d => '  ' + JSON.stringify(d) + ',').join('\n')}
];

export interface PetFurData {
  kind: 'fur' | 'feather'; length: number; thickness: number; stretch: number; facing: number; comb: number; droop: number;
  shells: number; fins: boolean; detail: number; sheen: number; fuzz: number; flowDroop: number; density: number;
  /** [骨骼名通配符, 倍数]，后写的覆盖先写的 */
  bones: readonly (readonly [string, number])[];
  exclude: readonly { center: readonly number[]; radius: number }[];
  excludeBoxes: readonly { min: readonly number[]; max: readonly number[] }[];
}

/** 有毛发壳层的灵宠（按 id） */
export const PET_FUR_DATA: Readonly<Record<string, PetFurData>> = {
${Object.entries(fur).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join('\n')}
};
`;

if (check) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== ts) {
    console.error('[export-pet-defs] src/pets/PetDefsData.ts 不是由当前 C# 生成的：重新跑 node scripts/web/export-pet-defs.mjs');
    process.exit(1);
  }
  console.log(`[export-pet-defs] 一致：${full.length} 只灵宠、${Object.keys(fur).length} 只有毛发`);
} else {
  writeFileSync(OUT, ts);
  console.log(`[export-pet-defs] 写入 ${OUT}：${full.length} 只灵宠、${Object.keys(fur).length} 只有毛发`);
}
