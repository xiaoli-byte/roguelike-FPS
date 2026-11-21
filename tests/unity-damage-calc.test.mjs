// M13 对照：Unity EditMode 的 DamageCalcParityTests.cs、CombatPipelineTests.cs、StatSheetTests.cs → node --test。
// 同样的输入、同样的断言；Unity 那份的对照组是「TS 逐行移植」，这里反过来：对照组是 Unity DamageCalc.cs 的逐行移植（unity*），
// 表和常量直接从 C# 源码里读（Damage.cs 的 DamageTable、Stats.cs、Combat.cs、Status/*.cs），改了一边另一边就红。
// 只写测试：网页和 Unity 不一致的地方写成 todo，不改实现。M8 照 Unity 补上的（弱点伤害%、灵宠伤害源、免疫结果、玩家减益）已改成真断言。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { combatRig, cs, csConsts, csList, near, tsGraph } from './unity-parity-kit.mjs';

const graph = await tsGraph();
after(() => graph.dispose());
const DC = await graph.load('combat/DamageCalc.ts');
const ST = await graph.load('combat/Status.ts');
const { Stats, BASE_STATS } = await graph.load('core/Stats.ts');
const { IMMUNE_FEEDBACK_GAP } = await graph.load('combat/Combat.ts');
const PS = await graph.load('player/PlayerStatus.ts');
const SUN = await graph.load('enemies/bosses/HanbaSunburn.ts');
const readSrc = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

const ELEMENTS = ['none', 'fire', 'shock', 'corrode'];
const LAYERS = ['shield', 'armor', 'health'];
const RANKS = ['normal', 'elite', 'boss'];
const EPS = 1e-4;

/** 每项取不同的值，乘错一项就能看出来（同 DamageCalcParityTests.Sheet） */
function sheet() {
  const s = new Stats();
  s.setBase('critChance', 0);
  for (const [k, v] of Object.entries({
    damagePct: 0.3, skillDamagePct: 0.5, explosionDamagePct: 0.7, reactionDamagePct: 0.9, petDamagePct: 0.31, elementDamagePct: 0.11,
    fireDamagePct: 0.13, shockDamagePct: 0.17, corrodeDamagePct: 0.19, eliteDamagePct: 0.23, bossDamagePct: 0.29,
    shieldDamagePct: 0.25, armorDamagePct: -0.3,
  })) s.add(k, v, 't');
  return s;
}
const blank = () => { const s = new Stats(); s.setBase('critChance', 0); return s; };
const target = (rank = 'normal', o = {}) => ({ isElite: rank === 'elite', isBoss: rank === 'boss', maxHp: 100, hp: 100, shield: 0, armor: 0, ...o });

// ───────────── Unity 版（DamageCalc.cs 逐行移植，不要「顺手改对」：这里就是对照组）─────────────

const ELEMENT_STAT = { fire: 'fireDamagePct', shock: 'shockDamagePct', corrode: 'corrodeDamagePct' };
/** DamageCalc.EffectiveTags：显式标签 + 来源隐含的 */
function unityTags(source, tags) {
  const t = new Set(tags);
  if (source === 'weapon') t.add('weapon');
  if (source === 'skill') t.add('skill');
  if (source === 'explosion') t.add('explosion');
  if (source === 'pet') t.add('pet');
  if (source === 'melee') { t.add('weapon'); t.add('melee'); }
  return t;
}
function unityStatMultiplier(s, source, tags, element, rank) {
  if (tags.includes('reaction')) return s.mult('reactionDamagePct');
  const t = unityTags(source, tags);
  let m = 1;
  if (source !== 'status') {
    if (t.has('pet')) m *= s.mult('petDamagePct');
    else {
      if (t.has('weapon') || t.has('melee')) m *= s.mult('damagePct');
      if (t.has('skill')) m *= s.mult('skillDamagePct');
      if (t.has('explosion')) m *= s.mult('explosionDamagePct');
    }
  }
  if (element !== 'none') m *= s.mult('elementDamagePct') * s.mult(ELEMENT_STAT[element]);
  if (rank === 'elite') m *= s.mult('eliteDamagePct');
  else if (rank === 'boss') m *= s.mult('bossDamagePct');
  return m;
}
const unityIsDot = (source, tags) => source === 'status' && !tags.includes('chain') && (!tags.includes('reaction') || tags.includes('dot'));
function unityDotStatMultiplier(s, rank, element) {
  let m = 1;
  if (element !== 'none') m *= s.mult('elementDamagePct') * s.mult(ELEMENT_STAT[element]);
  if (rank === 'elite') m *= s.mult('eliteDamagePct');
  else if (rank === 'boss') m *= s.mult('bossDamagePct');
  return m > 0 && Number.isFinite(m) ? m : 1;
}
/** Damage.cs 的 DamageTable.Mult：[元素][Shield, Armor, Health] */
const unityLayerTable = (() => {
  const src = cs('Combat/Damage.cs');
  const body = src.slice(src.indexOf('static readonly float[,] Mult'));
  const rows = [...body.slice(0, body.indexOf('};')).matchAll(/\/\*\s*(\w+)\s*\*\/\s*\{([^}]+)\}/g)];
  return Object.fromEntries(rows.map(m => [m[1].toLowerCase(), csList(m[2])]));
})();
function unityLayerMultiplier(s, element, layer) {
  let m = unityLayerTable[element][LAYERS.indexOf(layer)];
  if (!s) return m;
  if (layer === 'shield') m *= s.mult('shieldDamagePct');
  else if (layer === 'armor') m *= s.mult('armorDamagePct');
  return m;
}
/** Damageable.ApplyLayers 的口径（= DamageCalcParityTests.Ts.ApplyLayers） */
function unityApplyLayers(s, shield, armor, hp, raw, element, skipShield) {
  const o = { shield, armor, hp, dealt: 0, effective: 0, shieldBroken: false, armorBroken: false };
  o.first = skipShield ? (armor > 0 ? 'armor' : 'health') : shield > 0 ? 'shield' : armor > 0 ? 'armor' : 'health';
  let remaining = raw;
  for (const layer of ['shield', 'armor']) {
    const gate = layer === 'shield' ? remaining > 0 && !skipShield : remaining > 1e-6;
    if (!gate || !(o[layer] > 0)) continue;
    const m = unityLayerMultiplier(s, element, layer), eff = remaining * m;
    let took;
    if (eff >= o[layer]) { took = o[layer]; o[layer] = 0; o[`${layer}Broken`] = true; remaining -= took / m; }
    else { took = eff; o[layer] -= eff; remaining = 0; }
    o.dealt += took; o.effective += took;
  }
  if (remaining > 1e-6) {
    const eff = remaining * unityLayerMultiplier(s, element, 'health');
    o.dealt += Math.min(eff, Math.max(0, o.hp));
    o.hp = Math.max(0, o.hp - eff);
    o.effective += eff;
  }
  return o;
}

// Unity 的 DamageSource ↔ TS 的 source；Environment 对 TS 的 'scroll'（不吃任何来源加成）
const SOURCES = ['weapon', 'skill', 'explosion', 'status', 'scroll', 'pet'];
const TAGS = ['weapon', 'skill', 'explosion', 'reaction', 'dot', 'chain', 'pet'];
const tagSets = Array.from({ length: 1 << TAGS.length }, (_, mask) => TAGS.filter((_, i) => mask & (1 << i)));

// ───────────── 层倍率 ─────────────

test('LayerTableMatchesThreeJs: LAYER_MULT 与 Unity DamageTable 逐格相同', () => {
  assert.deepEqual(Object.keys(unityLayerTable), ELEMENTS);
  for (const e of ELEMENTS) for (const [i, l] of LAYERS.entries()) {
    assert.equal(DC.LAYER_MULT[e][l], unityLayerTable[e][i], `LAYER_MULT[${e}][${l}]`);
  }
  // DamageCalcParityTests 里抄的那张 Ts.LayerMult 也钉一下
  assert.deepEqual(ELEMENTS.map(e => LAYERS.map(l => DC.LAYER_MULT[e][l])), [[1, 0.75, 1], [0.8, 1, 1.25], [1.6, 0.8, 1], [1, 1.6, 1]]);
});

test('LayerMultiplierAppliesShieldAndArmorStats', () => {
  for (const [label, s] of [['无', blank()], ['有', sheet()]]) {
    for (const e of ELEMENTS) for (const l of LAYERS) {
      near(assert, DC.layerMultiplier(s, e, l), unityLayerMultiplier(s, e, l), EPS, `layerMultiplier(${e}, ${l})，属性表${label}`);
    }
  }
  const s = sheet();
  near(assert, DC.layerMultiplier(s, 'shock', 'shield'), 1.6 * 1.25, EPS, '雷打护盾 × 对护盾伤害');
  near(assert, DC.layerMultiplier(s, 'corrode', 'armor'), 1.6 * 0.7, EPS, '蚀打护甲 × 对护甲伤害');
  near(assert, DC.layerMultiplier(s, 'fire', 'health'), 1.25, EPS, '生命层不吃这两项');
});

// ───────────── 属性乘区 ─────────────

test('StatMultiplierMatchesThreeJsForAllCombinations: 来源 × 标签 × 元素 × 级别', () => {
  const s = sheet();
  let cases = 0;
  for (const source of SOURCES) for (const tags of tagSets) for (const element of ELEMENTS) for (const rank of RANKS) {
    const web = DC.statMultiplier(s, target(rank), { base: 100, source, tags, element });
    const unity = unityStatMultiplier(s, source, tags, element, rank);
    near(assert, web, unity, EPS * unity, `来源 ${source} 标签 [${tags}] 元素 ${element} 级别 ${rank}`);
    cases++;
  }
  assert.equal(cases, SOURCES.length * (1 << TAGS.length) * ELEMENTS.length * 3);
});

test('ReactionFlagEqualsReactionTag: 反应伤害只吃反应伤害%', () => {
  const s = sheet();
  for (const element of ELEMENTS) {
    const byTag = DC.statMultiplier(s, target(), { base: 1, source: 'status', element, tags: [DC.REACTION_TAG] });
    near(assert, byTag, s.mult('reactionDamagePct'), EPS);
  }
  assert.equal(DC.REACTION_TAG, 'reaction');
});

test('TagDrivenStatMultipliers: 武器 / 爆炸 / 技能 / 持续伤害 / 反应各吃哪些加成', () => {
  const s = sheet();
  const dmg = s.mult('damagePct'), skill = s.mult('skillDamagePct'), blast = s.mult('explosionDamagePct');
  const fire = s.mult('elementDamagePct') * s.mult('fireDamagePct');
  const M = (source, tags = [], element = 'none', t = target()) => DC.statMultiplier(s, t, { base: 1, source, tags, element });

  near(assert, M('weapon'), dmg, EPS, '武器直接命中：只吃伤害%');
  near(assert, M('melee'), dmg, EPS, '近战（碎刃）同样只吃伤害%（TS source melee）');
  near(assert, M('explosion', ['weapon']), dmg * blast, EPS, '武器投射物的爆炸：伤害% 和爆炸伤害% 都吃');
  near(assert, M('weapon', ['explosion']), dmg * blast, EPS, '（来源 / 标签两种写法等价）');
  near(assert, M('explosion'), blast, EPS, '纯爆炸：只吃爆炸伤害%');
  near(assert, M('skill'), skill, EPS, '技能：只吃技能伤害%');
  near(assert, M('skill', ['explosion']), skill * blast, EPS, '技能爆炸：技能% × 爆炸%');
  near(assert, M('status', ['dot']), 1, EPS, '无元素的持续伤害：不吃任何来源加成');
  near(assert, M('status', ['weapon', 'skill', 'explosion']), 1, EPS, 'Status 来源连标签也不认');
  near(assert, M('status', ['dot'], 'fire'), fire, EPS, '灼烧跳伤：只吃元素% × 火焰%');
  near(assert, M('weapon', [], 'fire'), dmg * fire, EPS, '火属性武器：伤害% × 元素% × 火焰%');
  near(assert, M('status', ['reaction', 'weapon'], 'fire'), s.mult('reactionDamagePct'), EPS, '反应伤害：只吃反应伤害%（Pin 已含其他加成）');
  near(assert, M('pet'), s.mult('petDamagePct'), EPS, '灵宠：只吃灵宠伤害%');
  near(assert, M('pet', ['weapon', 'explosion']), s.mult('petDamagePct'), EPS, '灵宠不吃武器 / 爆炸伤害%');
  near(assert, M('pet', [], 'fire'), s.mult('petDamagePct') * fire, EPS, '灵宠的元素攻击照吃元素加成');
  near(assert, M('weapon', [], 'none', target('elite')), dmg * s.mult('eliteDamagePct'), EPS, '精英 × 精英伤害%');
  near(assert, M('weapon', [], 'none', target('boss')), dmg * s.mult('bossDamagePct'), EPS, '首领 × 首领伤害%');
  near(assert, M('status', ['reaction'], 'shock', target('boss')), s.mult('reactionDamagePct'), EPS, '反应打首领也不再乘首领伤害%');
});

test('NoStatsMeansNoMultiplier: 空属性表 = 1', () => {
  const s = blank();
  near(assert, DC.statMultiplier(s, target(), { base: 1, source: 'weapon', element: 'fire' }), 1, EPS);
  near(assert, DC.dotStatMultiplier(s, target('boss'), 'corrode'), 1, EPS);
  near(assert, DC.statusPowerFromDealt(s, target('boss'), 'corrode', 40), 40, EPS);
});

test('MultFloorIsPerStat: Stats.mult 下限 0.05，逐项取下限再相乘', () => {
  near(assert, csConsts(cs('Core/Stats.cs')).MinMult, 0.05, 1e-9, 'StatSheet.MinMult');
  const s = blank();
  s.add('damagePct', -3, 'debuff');
  s.add('explosionDamagePct', -0.99, 'debuff');
  near(assert, s.mult('damagePct'), 0.05, 1e-9, '1 + (−3) 钳到 0.05');
  near(assert, s.mult('explosionDamagePct'), 0.05, 1e-9, '1 − 0.99 = 0.01 也钳到 0.05');
  near(assert, DC.statMultiplier(s, target(), { base: 1, source: 'explosion', tags: ['weapon'], element: 'none' }), 0.05 * 0.05, 1e-9,
    '每一项各自取下限，再相乘（不是乘完再钳）');
  s.add('damagePct', 5, 'buff');
  near(assert, s.mult('damagePct'), 3, 1e-9, '正加成不封顶：1 + (−3 + 5)');
});

// ───────────── 持续伤害、状态强度、处决 ─────────────

test('IsDotMatchesThreeJs: 全部来源 × 标签组合', () => {
  for (const source of SOURCES) for (const tags of tagSets) {
    assert.equal(DC.isDot({ base: 1, source, tags, element: 'none' }), unityIsDot(source, tags), `isDot：来源 ${source} 标签 [${tags}]`);
  }
});

test('DotAndStatusPowerMatchThreeJs: 附着时除掉、每跳乘回', () => {
  const s = sheet();
  const cap = csConsts(cs('Combat/CombatTuning.cs')).PinCapOfMaxHp;
  assert.equal(ST.STATUS_POWER_CAP, cap, 'STATUS_POWER_CAP ↔ CombatTuning.PinCapOfMaxHp');
  assert.equal(cap, 0.5);
  for (const rank of RANKS) for (const [status, element] of [['burn', 'fire'], ['shock', 'shock'], ['corrode', 'corrode']]) {
    const t = target(rank, { maxHp: 400 });
    const mult = unityDotStatMultiplier(s, rank, element);
    near(assert, DC.dotStatMultiplier(s, t, element), mult, EPS, `dotStatMultiplier ${rank} ${element}`);
    for (const dealt of [0, 35, 150, 199, 200, 260, 5000, -10]) {
      near(assert, DC.statusPowerFromDealt(s, t, status, dealt), Math.min(Math.max(0, dealt), 400 * cap) / mult, EPS,
        `statusPowerFromDealt ${rank} ${element} dealt=${dealt}`);
      near(assert, DC.reactionPowerFromStatus(s, t, status, dealt), Math.max(0, dealt * mult), EPS * Math.max(1, Math.abs(dealt)),
        `reactionPowerFromStatus ${rank} ${element} power=${dealt}`);
    }
    const power = DC.statusPowerFromDealt(s, t, status, 120);
    near(assert, power * DC.dotStatMultiplier(s, t, element), 120, 1e-3, `除掉再乘回 = 原伤害（${rank} ${element}）`);
  }
  near(assert, DC.dotStatMultiplier(s, target(), 'none'), 1, EPS, '无元素：1');
});

test('DotTakesElementAndRankMultipliersButNotWeaponDamage (CombatPipelineTests)', () => {
  // 元素 +20%、火 +50%、精英 +30%、首领 +40%、武器伤害 +100%、反应伤害 +25%
  const s = blank();
  for (const [k, v] of Object.entries({ elementDamagePct: 0.2, fireDamagePct: 0.5, eliteDamagePct: 0.3, bossDamagePct: 0.4, damagePct: 1, reactionDamagePct: 0.25 })) s.add(k, v, 'test');
  near(assert, DC.dotStatMultiplier(s, target('normal'), 'fire'), 1.2 * 1.5, EPS);
  near(assert, DC.dotStatMultiplier(s, target('elite'), 'fire'), 1.2 * 1.5 * 1.3, EPS);
  near(assert, DC.dotStatMultiplier(s, target('boss'), 'fire'), 1.2 * 1.5 * 1.4, EPS);
  const dot = element => ({ base: 10, source: 'status', element, tags: ['dot'], procDepth: 1 });
  for (const rank of RANKS) {
    near(assert, DC.statMultiplier(s, target(rank), dot('fire')), DC.dotStatMultiplier(s, target(rank), 'fire'), EPS, '跳伤请求走 statMultiplier 是同一个倍率（不吃武器伤害）');
  }
  near(assert, DC.statMultiplier(s, target('elite'), { ...dot('shock'), tags: ['chain'] }), 1.2 * 1.3, EPS, '雷殛弹射同样只吃元素类 + 级别');
  near(assert, DC.statMultiplier(s, target('boss'), { ...dot('fire'), tags: ['dot', 'reaction'] }), 1.25, EPS, '熔池跳伤带 reaction + dot：只吃反应伤害');
});

test('StatusPowerDividesOutWhatEachTickMultipliesBack: 一层灼烧烧满 = 那一击 × 1.28', () => {
  const s = blank();
  for (const [k, v] of Object.entries({ elementDamagePct: 0.2, fireDamagePct: 0.5, eliteDamagePct: 0.3 })) s.add(k, v, 'test');
  const elite = target('elite', { maxHp: 1000 });
  const power = DC.statusPowerFromDealt(s, elite, 'burn', 100);
  const perTick = DC.dotStatMultiplier(s, elite, 'fire');
  near(assert, power * perTick, 100, 1e-3, '附着时除掉、每一跳乘回：同一份加成只算一次');
  near(assert, DC.reactionPowerFromStatus(s, elite, 'burn', power), 100, 1e-3);
  const ticks = ST.BURN_DURATION / ST.BURN_TICK;
  near(assert, power * ST.BURN_RATIO * ticks * perTick, 100 * 1.28, 1e-3);
  near(assert, DC.statusPowerFromDealt(s, elite, 'burn', 1e5) * perTick, 500, 1e-2, '上限：最大生命 × 0.5');
});

test('ExecuteThresholdMatchesThreeJs: 1e6 起算处决', async () => {
  const unity = csConsts(cs('Combat/DamageCalc.cs')).ExecuteBase;
  assert.equal(unity, 1e6);
  // 网页的 EXECUTE_BASE 没导出：读源码里的字面量比
  const web = Number((await import('node:fs')).readFileSync(new URL('../src/combat/Combat.ts', import.meta.url), 'utf8').match(/const EXECUTE_BASE = ([\de.]+);/)[1]);
  assert.equal(web, unity);
});

// ───────────── 分层结算 ─────────────

test('ApplyLayersMatchesThreeJs: 护盾 → 护甲 → 生命，打穿按下一层倍率折算', () => {
  const pools = [[0, 0, 100], [50, 0, 100], [0, 50, 100], [50, 50, 100], [30, 40, 20], [200, 0, 50]];
  const raws = [10, 45, 62.5, 80, 200, 1000];
  let cases = 0;
  for (const [label, s] of [['无', blank()], ['有', sheet()]]) {
    for (const [sh, ar, hp] of pools) for (const raw of raws) for (const e of ELEMENTS) for (const skip of [false, true]) {
      const enemy = { shield: sh, armor: ar, hp };
      const r = DC.applyLayers(s, enemy, raw, e, DC.newLayerOutcome(), skip);
      const u = unityApplyLayers(s, sh, ar, hp, raw, e, skip);
      const at = `盾 ${sh} 甲 ${ar} 血 ${hp}，层前 ${raw}，${e}，跳过护盾 ${skip}，属性表${label}`;
      near(assert, r.dealt, u.dealt, 1e-3, `实际扣除：${at}`);
      near(assert, r.effective, u.effective, 1e-3, `展示总量（含溢出）：${at}`);
      assert.equal(r.firstLayer, u.first, `最先打到的层：${at}`);
      assert.equal(r.shieldBroken, u.shieldBroken, `破盾：${at}`);
      assert.equal(r.armorBroken, u.armorBroken, `破甲：${at}`);
      near(assert, enemy.shield, u.shield, 1e-3, `剩余护盾：${at}`);
      near(assert, enemy.armor, u.armor, 1e-3, `剩余护甲：${at}`);
      near(assert, enemy.hp, u.hp, 1e-3, `剩余生命：${at}`);
      cases++;
    }
  }
  assert.ok(cases > 500);
});

// ───────────── 暴击与弱点（走 Combat.damageEnemy）─────────────

test('WeakpointForcesCritWithCritMultAndCritDamage', async () => {
  const rig = await combatRig(graph, THREE);
  const s = rig.ctx.player.stats;
  s.setBase('critChance', 0);
  s.add('damagePct', 0.2, 't');
  s.add('critDamagePct', 0.5, 't');
  const e = rig.enemy({ maxHp: 1e7 });
  const head = rig.hit(e, { headshot: true, canCrit: false, critMult: 2.5 });
  near(assert, head.dealt, 100 * 1.2 * 2.5 * 1.5, 1e-2, '爆头 = 基础 × 伤害% × critMult × (1 + 暴伤%)');
  assert.ok(head.isCrit, '命中弱点必定暴击（canCrit = false 只关随机暴击）');
  s.add('weakpointDamagePct', 0.15, 'scroll');
  near(assert, rig.hit(e, { headshot: true, canCrit: false, critMult: 2.5 }).dealt, 100 * 1.2 * 2.5 * 1.5 * 1.15, 1e-2, 'Unity 另乘弱点伤害%（秘卷「破绽」）');
  near(assert, rig.hit(e, { forceCrit: true }).dealt, 100 * 1.2 * 2 * 1.5, 1e-2, '只有弱点吃弱点伤害%，强制暴击不吃');
  s.removeSource('scroll');
  const forced = rig.hit(e, { forceCrit: true });
  near(assert, forced.dealt, 100 * 1.2 * 2 * 1.5, 1e-2, '强制暴击、critMult 缺省 2');
  assert.ok(forced.isCrit);
});

test('CritRules: 随机暴击 / noCrit / 持续伤害与反应不暴击', async () => {
  const rig = await combatRig(graph, THREE);
  const s = rig.ctx.player.stats;
  s.add('critChance', 2, 't'); // 必定掷中
  s.add('critDamagePct', 0.5, 't');
  s.add('reactionDamagePct', 0.4, 't');
  s.add('petDamagePct', 0.1, 't');
  const e = rig.enemy({ maxHp: 1e7 });
  const crit = rig.hit(e, { canCrit: undefined });
  near(assert, crit.dealt, 100 * 2 * 1.5, 1e-2, '随机暴击：critMult 2 × (1 + 50%)');
  assert.ok(crit.isCrit);
  const noCrit = rig.hit(e, { canCrit: false });
  near(assert, noCrit.dealt, 100, 1e-2, 'canCrit = false 关掉随机暴击');
  assert.ok(!noCrit.isCrit);
  const dot = rig.hit(e, { source: 'status', headshot: true, forceCrit: true, canCrit: undefined });
  near(assert, dot.dealt, 100, 1e-2, '持续伤害（status）不暴击，弱点 / 强制暴击也不行');
  assert.ok(!dot.isCrit);
  const rx = rig.hit(e, { source: 'status', tags: ['reaction'], forceCrit: true, canCrit: undefined });
  near(assert, rx.dealt, 100 * 1.4, 1e-2, '反应伤害不暴击，只吃反应伤害%');
  assert.ok(!rx.isCrit);
  const pet = rig.hit(e, { source: 'pet', canCrit: undefined, weaponUid: undefined });
  near(assert, pet.dealt, 100 * 1.1, 1e-2, '灵宠不随机暴击（docs/pet-system.md）');
  assert.ok(!pet.isCrit);
});

// ───────────── 状态（CombatPipelineTests）：跳数、叠层、眩晕、减速 ─────────────

/** 常量：Status.ts ↔ Unity Combat/Status/*.cs（EnemyStatus 的同名常量引用的就是它们） */
test('StatusConstantsMatchThreeJs (ReactionTuningTests): 灼烧 / 雷殛 / 蚀化 / 控制', async () => {
  const burn = csConsts(cs('Combat/Status/BurnStatus.cs')), shock = csConsts(cs('Combat/Status/ShockStatus.cs'));
  const corrode = csConsts(cs('Combat/Status/CorrodeStatus.cs')), stun = csConsts(cs('Combat/Status/StunStatus.cs')), slow = csConsts(cs('Combat/Status/SlowStatus.cs'));
  assert.deepEqual([ST.BURN_DURATION, ST.BURN_TICK, ST.BURN_RATIO, ST.BURN_MAX_STACKS], [burn.Duration, burn.TickInterval, burn.Ratio, burn.MaxStacks]);
  assert.deepEqual([burn.Duration, burn.TickInterval, burn.Ratio, burn.MaxStacks], [4, 0.5, 0.16, 3]);
  assert.deepEqual([ST.SHOCK_MARK_DURATION, ST.SHOCK_CHAIN_RANGE, ST.SHOCK_CHAIN_TARGETS, ST.SHOCK_CHAIN_RATIO, ST.SHOCK_STUN_STACKS, ST.SHOCK_STUN_DURATION, DC.SHOCK_MARK_BONUS],
    [shock.Duration, shock.ChainRange, shock.ChainTargets, shock.ChainRatio, shock.StunStacks, shock.StunSeconds, shock.MarkBonus]);
  assert.deepEqual([shock.Duration, shock.ChainRange, shock.ChainTargets, shock.ChainRatio, shock.StunStacks, shock.StunSeconds, shock.MarkBonus], [3, 8, 3, 0.5, 3, 0.8, 1.15]);
  assert.deepEqual([ST.CORRODE_DURATION, ST.CORRODE_TICK, ST.CORRODE_RATIO, ST.CORRODE_DAMAGE_TAKEN, ST.CORRODE_SLOW],
    [corrode.Duration, corrode.TickInterval, corrode.Ratio, corrode.Taken, corrode.SpeedFactor]);
  assert.deepEqual([corrode.Duration, corrode.TickInterval, corrode.Ratio, corrode.Taken, corrode.SpeedFactor], [5, 0.5, 0.08, 1.2, 0.8]);
  // 没导出的：读 Status.ts 源码里的字面量
  const web = csConsts((await import('node:fs')).readFileSync(new URL('../src/combat/Status.ts', import.meta.url), 'utf8').replace(/^const (\w+) = ([\d.e-]+);/gm, 'const float $1 = $2;'));
  assert.deepEqual([web.SHOCK_CHAIN_COOLDOWN, web.SLOW_DEFAULT_DURATION, web.SLOW_MAX, web.SLOW_MAX_ENTRIES, web.STUN_DEFAULT_DURATION],
    [shock.ChainCooldown, slow.DefaultSeconds, slow.Max, slow.MaxEntries, stun.DefaultSeconds]);
  assert.deepEqual([web.ELITE_STUN_SCALE, web.BOSS_STUN_SCALE, web.BOSS_STUN_MAX, web.BOSS_STUN_IMMUNITY, web.TICK_EPS],
    [stun.EliteScale, stun.BossScale, stun.BossMax, stun.BossImmunity, csConsts(cs('Combat/Status/StatusEffect.cs')).TickEps]);
});

test('BurnTotalPerApplicationIsPowerTimes128', () => {
  near(assert, ST.BURN_DURATION / ST.BURN_TICK, 8, 1e-9);
  near(assert, ST.BURN_RATIO * (ST.BURN_DURATION / ST.BURN_TICK), 1.28, 1e-9);
});

/** 推进 seconds 秒，数一数生命掉了几次（同 CombatPipelineTests.CountDrops） */
function countDrops(rig, e, seconds, dt = 1 / 60) {
  let drops = 0, last = e.hp;
  for (let t = 0; t < seconds; t += dt) {
    rig.advance(dt);
    if (e.hp < last - 1e-6) drops++;
    last = e.hp;
  }
  return drops;
}

test('BurnLayerTicksEightTimesThenExpires: 一层 4 s 正好 8 跳、最多 3 层', async () => {
  const rig = await combatRig(graph, THREE);
  rig.ctx.player.stats.setBase('critChance', 0);
  const e = rig.enemy({ maxHp: 1000 });
  rig.ctx.combat.applyStatus(e, 'burn', 10);
  assert.equal(e.statuses.get('burn').stacks, 1);
  assert.equal(countDrops(rig, e, 4.5), 8, '一层 4 s 正好 8 跳');
  near(assert, 1000 - e.hp, 10 * 0.16 * 8 * 1.25, 1e-3, '总量 = 强度 × 1.28（× 火打生命 1.25）');
  assert.ok(!e.statuses.has('burn'), '到期移除');
  for (let i = 0; i < 5; i++) rig.ctx.combat.applyStatus(e, 'burn', 10);
  assert.equal(e.statuses.get('burn').stacks, ST.BURN_MAX_STACKS, '最多 3 层');
  near(assert, e.statuses.get('burn').power, 30, 1e-6, '强度之和');
});

test('CorrodeTicksTenTimesAndAppliesTakenAndSlow', async () => {
  const rig = await combatRig(graph, THREE);
  const e = rig.enemy({ maxHp: 1000 });
  rig.ctx.combat.applyStatus(e, 'corrode', 10);
  rig.advance(1e-6);
  near(assert, e.damageTakenMult, 1.2, 1e-6, '蚀化期间承伤 ×1.2');
  near(assert, e.slowMult, 0.8, 1e-6, '移速 ×0.8');
  assert.equal(countDrops(rig, e, 5.5), 10, '5 s 正好 10 跳');
  assert.ok(!e.statuses.has('corrode'));
  near(assert, e.damageTakenMult, 1, 1e-6);
});

test('ShockStacksAndClearsAtThree: 叠到 3 层清空并眩晕 0.8 s', async () => {
  const rig = await combatRig(graph, THREE);
  const e = rig.enemy({ maxHp: 1000 });
  rig.ctx.combat.applyStatus(e, 'shock', 10, undefined, { depth: 1 });
  rig.ctx.combat.applyStatus(e, 'shock', 30, undefined, { depth: 1 });
  assert.equal(e.statuses.get('shock').stacks, 2);
  near(assert, e.statuses.get('shock').power, 30, 1e-6, '强度取较大');
  rig.ctx.combat.applyStatus(e, 'shock', 5, undefined, { depth: 1 });
  assert.ok(!e.statuses.has('shock'), '叠到 3 层清空');
  near(assert, e.statuses.get('stun')?.remaining ?? e.stunTime, 0.8, 1e-6, '并眩晕 0.8 s');
});

test('SlowTakesStrongestAndExpiresPerEntry', async () => {
  const rig = await combatRig(graph, THREE);
  const e = rig.enemy({ maxHp: 1000 });
  rig.ctx.combat.applyStatus(e, 'slow', 0.3, 1);
  rig.ctx.combat.applyStatus(e, 'slow', 0.5, 0.5);
  rig.advance(1e-6);
  near(assert, e.slowMult, 0.5, 1e-6, '取最强的一条');
  rig.advance(0.6);
  near(assert, e.slowMult, 0.7, 1e-6, '强的那条到期后回落');
  rig.advance(0.5);
  assert.ok(!e.statuses.has('slow'));
  near(assert, e.slowMult, 1, 1e-6);
  // > 1 按百分数；上限 90%
  const f = rig.enemy({ maxHp: 1000 });
  rig.ctx.combat.applyStatus(f, 'slow', 30, 1);
  rig.advance(1e-6);
  near(assert, f.slowMult, 0.7, 1e-6, '30 → 30%');
  const g = rig.enemy({ maxHp: 1000 });
  rig.ctx.combat.applyStatus(g, 'slow', 0.95, 1);
  rig.advance(1e-6);
  near(assert, g.slowMult, 0.1, 1e-6, '上限 90%');
});

test('StunScalesByRank: 精英 ×0.75，首领 ×0.35 且 ≤ 0.35 s', async () => {
  const rig = await combatRig(graph, THREE);
  const stunned = (o, seconds) => {
    const e = rig.enemy({ maxHp: 1000, ...o });
    rig.ctx.combat.applyStatus(e, 'stun', 0, seconds);
    return e.statuses.get('stun')?.remaining ?? 0;
  };
  near(assert, stunned({}, 0.8), 0.8, 1e-6);
  near(assert, stunned({ isElite: true }, 1), 0.75, 1e-6);
  near(assert, stunned({ isBoss: true }, 2), 0.35, 1e-6, '首领 ×0.35 且 ≤ 0.35 s');
  near(assert, stunned({ isBoss: true }, 0.7), 0.7 * 0.35, 1e-6);
  near(assert, stunned({}, -1), 0, 1e-6);
});

// ───────────── 吸血 / 魂晶 / 不可选中 / 处决 ─────────────

test('LifestealIsCappedPerHit: 单次上限 = 最大生命 5%，至少 2 点', async () => {
  const unity = csConsts(cs('Combat/Combat.cs'));
  assert.deepEqual([unity.LifestealCapRatio, unity.LifestealCapMin], [0.05, 2]);
  const heal = async (dealt, lifesteal, maxHp) => {
    const rig = await combatRig(graph, THREE);
    const s = rig.ctx.player.stats;
    s.setBase('critChance', 0); s.setBase('maxHp', maxHp); s.add('lifesteal', lifesteal, 't');
    rig.ctx.player.hp = 0.001;
    rig.hit(rig.enemy({ maxHp: 1e7 }), { base: dealt });
    return rig.heals.at(-1) ?? 0;
  };
  near(assert, await heal(10, 0.1, 100), 1, EPS);
  near(assert, await heal(100, 0.1, 100), 5, EPS, '单次上限 = 最大生命 5%');
  near(assert, await heal(10, 0.5, 10), 2, EPS, '上限至少 2 点');
  near(assert, await heal(100, 0, 100), 0, EPS);
});

test('EssenceByDefAndRank: 精英 ×5、首领没写按 60、分身 0', async () => {
  const essence = async (def, o = {}) => {
    const rig = await combatRig(graph, THREE);
    rig.hit(rig.enemy({ maxHp: 10, def: { color: 0xffffff, ...def }, ...o }), { base: 1000 });
    return rig.ctx.run.essence;
  };
  assert.equal(await essence({ essence: 3 }), 3);
  assert.equal(await essence({ essence: 3 }, { isElite: true }), 15, '精英 ×5');
  assert.equal(await essence({}), 1);
  assert.equal(await essence({}, { isBoss: true }), 60, '首领没写魂晶按 60');
  assert.equal(await essence({ essence: 0 }), 0, '分身不给');
});

test('ImmuneFeedbackIsThrottledAndSkipsDots: 不可选中返回 immune、不结算，0.4 s 内同一敌人只提示一次，跳伤不提示', async () => {
  assert.equal(IMMUNE_FEEDBACK_GAP, csConsts(cs('Combat/Combat.cs')).ImmuneFeedbackGap, 'Combat.ImmuneFeedbackGap');
  assert.equal(IMMUNE_FEEDBACK_GAP, 0.4);
  const rig = await combatRig(graph, THREE);
  const e = rig.enemy({ maxHp: 1000, untargetable: true });
  let immune = 0;
  rig.events.on('enemy:damaged', ({ enemy, result }) => { if (enemy === e && result.immune) immune++; });
  const r = rig.hit(e, { base: 10 });
  assert.ok(r.immune);
  near(assert, r.dealt, 0, EPS);
  rig.hit(e, { base: 10 });
  assert.ok(rig.hit(e, { base: 10, source: 'status', element: 'fire', tags: ['dot'] }).immune);
  assert.equal(immune, 1, '0.4 s 内同一敌人只提示一次，跳伤不提示');
  assert.equal(e.hp, 1000, '不结算');
  rig.ctx.combat.applyStatus(e, 'burn', 10);
  assert.ok(!e.statuses.has('burn'), '也不挂状态');
  rig.advance(IMMUNE_FEEDBACK_GAP);
  rig.hit(e, { base: 10 });
  assert.equal(immune, 2, '过了 0.4 s 再提示一次');
});

test('PurgeIsSilentAndUnrewarded: 静默处决不算战果，普通处决照常算击杀', async () => {
  const rig = await combatRig(graph, THREE);
  const a = rig.enemy({ maxHp: 100, def: { essence: 3 } });
  const r = rig.hit(a, { base: 1e6, source: 'status', tags: ['purge'] });
  assert.ok(r.killed && !a.alive);
  assert.deepEqual([rig.ctx.run.kills, rig.ctx.run.essence, rig.ctx.run.damageDealt], [0, 0, 0], '静默处决没有战果');
  const b = rig.enemy({ maxHp: 100, def: { essence: 3 } });
  rig.hit(b, { base: 1e6, source: 'status' });
  assert.deepEqual([rig.ctx.run.kills, rig.ctx.run.essence], [1, 3], '普通处决照常算击杀');
});

// ───────────── 属性表（StatSheetTests）─────────────

test('StatSheet: AddAndRemoveBySource / SameSourceStacksAndRemovesTogether', () => {
  const s = new Stats();
  s.setBase('maxHp', 100);
  s.setBase('maxShield', 0);
  s.add('maxHp', 50, 'scroll');
  s.add('maxHp', 25, 'hero');
  s.add('maxShield', 10, 'hero');
  near(assert, s.get('maxHp'), 175, EPS);
  near(assert, s.get('maxShield'), 10, EPS);
  s.removeSource('scroll');
  near(assert, s.get('maxHp'), 125, EPS, '撤销一个来源只去掉它自己的修正');
  s.removeSource('hero');
  near(assert, s.get('maxHp'), 100, EPS);
  near(assert, s.get('maxShield'), 0, EPS);
  s.add('damagePct', 0.1, 'playtest');
  s.add('damagePct', 0.15, 'playtest');
  near(assert, s.get('damagePct'), 0.25, 1e-9);
  s.removeSource('playtest');
  s.removeSource('playtest'); // 重复撤销不出错
  near(assert, s.get('damagePct'), 0, 1e-9);
});

test('StatSheet.Default ↔ BASE_STATS：写了基础值的十项相同，其余为 0', () => {
  const src = cs('Core/Stats.cs');
  const unity = Object.fromEntries([...src.matchAll(/s\.SetBase\(Stat\.(\w+),\s*([\d.]+)f?\)/g)].map(m => [m[1], Number(m[2])]));
  const key = name => ({ MagPct: 'magSizePct' }[name] ?? name[0].toLowerCase() + name.slice(1));
  assert.equal(Object.keys(unity).length, 10);
  for (const [name, value] of Object.entries(unity)) assert.equal(BASE_STATS[key(name)], value, `${name} 基础值`);
  const defaults = new Set(Object.keys(unity).map(key));
  for (const [k, v] of Object.entries(BASE_STATS)) if (!defaults.has(k)) assert.equal(v, 0, `${k} 两边都没有基础值`);
  // 枚举 ↔ StatKey：两边一项不差（M8 补上了 weakpointDamagePct / petDamagePct）
  const body = src.slice(src.indexOf('public enum Stat'), src.indexOf('public sealed class StatSheet')).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const names = body.slice(body.indexOf('{') + 1, body.indexOf('}')).split(',').map(x => x.trim()).filter(Boolean);
  const missing = names.map(key).filter(k => !(k in BASE_STATS));
  assert.deepEqual(missing, [], 'Unity 的 Stat 枚举里网页没有的项');
  assert.deepEqual(Object.keys(BASE_STATS).filter(k => !names.map(key).includes(k)), [], '网页的 StatKey 都在 Unity 枚举里');
});

// ───────────── 玩家减益（CombatPipelineTests 的 C3：寒意 / 点燃 / 日晒，网页在 player/PlayerStatus.ts）─────────────

test('ChillTakesStrongestCappedAt70Percent', () => {
  const u = csConsts(cs('Combat/Status/ChillStatus.cs'));
  assert.deepEqual([PS.CHILL.MaxSlow, PS.CHILL.DefaultSeconds, PS.CHILL.MaxEntries], [u.MaxSlow, u.DefaultSeconds, u.MaxEntries]);
  near(assert, PS.chillFraction(35), 0.35, 1e-6, '> 1 按百分数');
  const chill = new PS.ChillInstance();
  chill.apply(0.35, 1.5);
  chill.apply(0.9, 0.5);
  near(assert, chill.slow, 0.7, 1e-6, '取最强的一条，上限 70%');
  near(assert, chill.speedMult, 0.3, 1e-6);
  chill.tick(0.6);
  near(assert, chill.speedMult, 0.65, 1e-6, '强的那条到期后回落到次强的');
  chill.tick(1);
  assert.ok(!chill.active);
  near(assert, chill.speedMult, 1, 1e-6);
});

test('IgniteTicksEveryHalfSecondAndRefreshesWithoutStacking', () => {
  const u = csConsts(cs('Combat/Status/IgniteStatus.cs'));
  assert.deepEqual([PS.IGNITE.DefaultSeconds, PS.IGNITE.TickInterval, PS.IGNITE.EndGrace, PS.IGNITE.LastTickGrace], [u.DefaultSeconds, u.TickInterval, u.EndGrace, u.LastTickGrace]);
  const ignite = new PS.IgniteInstance(null);
  ignite.apply(3, 2);
  near(assert, ignite.remainingDotRaw, 4 * 3, 1e-6, '2 s × 每 0.5 s 一跳 = 4 跳');
  ignite.apply(5, 1);
  near(assert, ignite.remainingDotRaw, 4 * 5, 1e-6, '再点燃：时长取更晚的到期，跳伤取较大');
  // 同 CombatPipelineTests.CountDrops：每帧看剩余跳伤掉了几次
  let drops = 0, last = ignite.remainingDotRaw;
  for (let t = 0; t < 2.5; t += 1 / 60) {
    if (ignite.active) ignite.tick(1 / 60);
    const now = ignite.active ? ignite.remainingDotRaw : 0;
    if (now < last - 1e-4) drops++;
    last = now;
  }
  assert.equal(drops, 4);
  assert.ok(!ignite.active);
});

test('SunburnStacksWhileExposedAndFadesInShade', () => {
  const u = csConsts(cs('Combat/Status/SunburnStatus.cs'));
  assert.deepEqual(
    [SUN.SUNBURN_STACK_SECONDS, SUN.SUNBURN_TICK_INTERVAL, SUN.SUNBURN_DAMAGE_PER_STACK, SUN.SUNBURN_DECAY_DELAY, SUN.SUNBURN_DECAY_PER_SECOND, SUN.SUNBURN_MAX_STACKS],
    [u.StackSeconds, u.TickInterval, u.DamagePerStack, u.DecayDelay, u.DecayPerSecond, u.MaxStacks],
  );
  const sun = new SUN.SunburnInstance(null);
  sun.apply(SUN.SUNBURN_STACK_SECONDS);
  assert.equal(sun.stacks, 1);
  for (let i = 0; i < 20; i++) sun.apply(SUN.SUNBURN_STACK_SECONDS);
  assert.equal(sun.stacks, SUN.SUNBURN_MAX_STACKS, '最多 10 层');
  near(assert, sun.tickDamage, SUN.SUNBURN_MAX_STACKS * SUN.SUNBURN_DAMAGE_PER_STACK, 1e-6);
  sun.tick(0.2);
  assert.equal(sun.stacks, SUN.SUNBURN_MAX_STACKS, '刚离开日晒还不消退');
  sun.tick(0.2);
  assert.ok(sun.stacks < SUN.SUNBURN_MAX_STACKS, '离开 0.3 s 后开始消退');
  for (let i = 0; i < 300 && sun.active; i++) sun.tick(1 / 60);
  assert.ok(!sun.active, '躲进影子几秒内清空');
});

test('EveryStatusHasOneDefinition: Unity StatusId 的 8 项 = 网页敌人状态 5 项 + 玩家减益 3 项（寒意 / 日晒 / 点燃只挂玩家）', () => {
  const ids = cs('Combat/Status/StatusEffect.cs').match(/public enum StatusId \{([^}]*)\}/)[1].split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const enemy = [...readSrc('core/types.ts').match(/export type StatusId =([^;]*);/)[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
  const player = [...readSrc('player/PlayerStatus.ts').match(/export type PlayerStatusId =([^;]*);/)[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
  assert.deepEqual([...enemy].sort(), ['burn', 'corrode', 'shock', 'slow', 'stun']);
  assert.deepEqual([...player].sort(), ['chill', 'ignite', 'sunburn']);
  assert.deepEqual([...enemy, ...player].sort(), [...ids].sort());
  for (const name of ['Chill', 'Sunburn', 'Ignite']) assert.match(cs(`Combat/Status/${name}Status.cs`), /Hosts => StatusHosts\.Player;/, `${name} 只挂玩家`);
});
