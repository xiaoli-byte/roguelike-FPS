// M13 对照：Unity EditMode 的 WeaponStatsTests.cs → node --test。
// 解析器（WeaponStatsResolver.Compute ↔ resolveWeapon）逐项按 Unity 公式重算；品质 / 强化 / 掉落权重等常量是 Unity 版删除前
// 从 C# 冻结的规格（tests/fixtures/spec/weapons.json、cs-consts.json）。
// 掷骰（WeaponRoller ↔ WeaponSystem.roll / rollRarity）：WeaponSystem 的第一人称模型、世界模型、碎刃控制器打桩，
// 只借它原型上的 roll / rollRarity / upgradeCost（假的 this，只带 rng / 章节 / 属性表）。
// 只写测试，不改实现。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { near, spec, tsGraph } from './unity-parity-kit.mjs';

const graph = await tsGraph({
  'weapons/Viewmodel.ts': 'export class Viewmodel {}\nexport const createViewmodelState = () => ({});\n',
  'weapons/WeaponModels.ts': 'export const buildWorldModel = () => null;\n',
  'weapons/demonBlade/DemonBlade.ts': 'export class DemonBlade {}\n',
});
after(() => graph.dispose());
const W = await graph.load('weapons/WeaponDefs.ts');
const WS = await graph.load('weapons/WeaponStats.ts');
const { WeaponSystem } = await graph.load('weapons/WeaponSystem.ts');
const { Rng } = await graph.load('core/Rng.ts');
const { Stats } = await graph.load('core/Stats.ts');
const rules = await graph.load('progression/loot/rewardRules.ts');

const SPEC = spec('weapons');
const K = spec('cs-consts');
const lib = K['Weapons/WeaponDefs.cs'];
const rarityDamage = SPEC.rarityDamage;
const resolver = K['Weapons/WeaponStatsResolver.cs'];
const roller = K['Weapons/WeaponRoller.cs'];
const chapterRarity = SPEC.chapterRarity;

const def = id => W.getWeaponDef(id);
let uid = 1;
const inst = (id, rarity = 0, o = {}) => ({ uid: uid++, defId: id, rarity, level: 0, element: def(id).element, mag: 0, reserve: 0, affixes: def(id).innate.map(a => ({ ...a })), ...o });
const sheet = (rate = 0, mag = 0, reload = 0) => {
  const s = new Stats();
  if (rate) s.add('fireRatePct', rate, 'test');
  if (mag) s.add('magSizePct', mag, 'test');
  if (reload) s.add('reloadSpeedPct', reload, 'test');
  return s;
};
const roundHalfUp = v => Math.floor(v + 0.5);
/** 「一分不差」：只容许相对 1e-6（Unity 是 float32） */
const same = (actual, expected, msg) => near(assert, actual, expected, Math.max(1e-6, Math.abs(expected) * 1e-6), msg);
const CURRENT = ['revolver', 'smg', 'shotgun', 'launcher', 'beam', 'stormpod'];

test('品质 / 强化 / 解析器下限的常量同 Unity', () => {
  assert.deepEqual([...W.RARITY_DAMAGE], rarityDamage);
  assert.equal(W.MAX_LEVEL, lib.MaxUpgrade);
  assert.equal(W.LEVEL_DAMAGE, lib.UpgradeStep);
  assert.deepEqual([resolver.MinReloadMult, resolver.MinSpreadMult], [0.25, 0.1]);
  // Unity 的取整是 .5 进位（WeaponStatsResolver.RoundHalfUp = Mathf.FloorToInt(v + 0.5f)，同 Math.round，不是银行家舍入）：见下面的 roundHalfUp
});

test('没有词条时：每把武器 × 品质 × 强化 × 属性表，解析结果 = Unity 的公式（CurrentSixWeaponsMatchLegacyNumbers）', () => {
  const sheets = [new Stats(), sheet(0.07, 0.1, 0.1), sheet(0.21, 0.3, 0.5), sheet(0.28, 0.2, 0.3)];
  const sheetArgs = [[0, 0, 0], [0.07, 0.1, 0.1], [0.21, 0.3, 0.5], [0.28, 0.2, 0.3]];
  for (const d of W.WEAPON_DEFS) sheets.forEach((s, si) => {
    const [rate, mag, reload] = sheetArgs[si];
    for (let rarity = 0; rarity < 5; rarity++) for (let level = 0; level <= lib.MaxUpgrade; level++) {
      const w = inst(d.id, rarity, { level, affixes: [] });
      const r = WS.resolveWeapon(w, s);
      const at = `${d.id} 品质 ${rarity} +${level} 属性 #${si}`;
      same(r.damage, d.damage * rarityDamage[rarity] * (1 + lib.UpgradeStep * level), `${at}：伤害`);
      same(r.fireRate, d.fireRate * (1 + rate), `${at}：射速`);
      assert.equal(r.magCap, d.blade ? d.mag : Math.max(1, roundHalfUp(d.mag * (1 + mag))), `${at}：弹匣`);
      assert.equal(r.reserveCap, d.reserve, `${at}：备弹`);
      same(r.reloadTime, d.reloadTime / (1 + reload), `${at}：换弹`);
      same(r.shellTime, d.shellTime / (1 + reload), `${at}：逐发`);
      same(r.reloadStart, d.reloadStart / (1 + reload), `${at}：逐发准备`);
      same(r.critMult, d.critMult, `${at}：暴击倍率`);
      assert.equal(r.critChance, 0, `${at}：词条暴击率`);
      same(r.elementChance, d.element !== 'none' ? d.elementChance : 0, `${at}：元素率`);
      same(r.spreadMult, 1, `${at}：散布`);
      same(r.recoilMult, 1, `${at}：后坐`);
      assert.equal(r.pierce, d.pierce, `${at}：穿透`);
      same(r.explosionRadius, d.projectile?.explosionRadius ?? 0, `${at}：爆炸半径`);
      same(r.projSpeedMult, 1, `${at}：弹速倍率`);
      assert.equal(r.legendary, null, `${at}：传说`);
    }
  });
});

test('弹匣取整是 Math.round（.5 进位）：青冥雷蛊 5 × 1.3 = 6.5 → 7', () => {
  const s = new Stats();
  s.add('magSizePct', 0.3, 'bottomless');
  assert.equal(WS.resolveWeapon(inst('stormpod'), s).magCap, 7);
  for (const id of CURRENT) assert.equal(WS.resolveWeapon(inst(id), new Stats()).magCap, def(id).mag, `${id}：没有加成时弹匣 = 定义`);
});

test('秒伤：perShot = 伤害 × 弹丸 × 弹体；dps = perShot × 射速 × 点射数；蓄力按「冷却 + 蓄力时长」', () => {
  const shotgun = WS.resolveWeapon(inst('shotgun'), new Stats());
  near(assert, shotgun.perShot, 12 * 9, 1e-4);
  near(assert, shotgun.dps, 12 * 9 * 1.4, 1e-3);
  const smg = WS.resolveWeapon(inst('smg', 2, { level: 2 }), new Stats());
  near(assert, smg.dps, 11 * 1.35 * 1.24 * 13, 1e-2);
  for (const d of W.WEAPON_DEFS) {
    const s = sheet(0.25), r = WS.resolveWeapon(inst(d.id, 3, { level: 1, affixes: [] }), s);
    const hits = d.pellets * (d.projectile ? d.projectile.count : 1);
    same(r.perShot, r.damage * hits, `${d.id} perShot`);
    const dps = d.mode === 'charge'
      ? r.perShot / (1 / Math.max(0.01, r.fireRate) + d.chargeTime / Math.max(0.01, r.fireRateMult))
      : r.perShot * r.fireRate * d.burstCount;
    same(r.dps, dps, `${d.id} dps`);
    if (d.blade && d.blade.combo.length) {
      const cycle = d.blade.combo.reduce((t, c) => t + c.duration, 0), sum = d.blade.combo.reduce((t, c) => t + c.damage, 0);
      same(r.meleeDps, sum * r.damageMult / (cycle / r.fireRateMult), `${d.id} 近战秒伤`);
      same(r.meleeHitScale, Math.min(3, Math.max(0.5, d.fireRate * d.burstCount * hits / (d.blade.combo.length / cycle))), `${d.id} 近战命中系数`);
    } else {
      assert.equal(r.meleeDps, 0);
      assert.equal(r.meleeHitScale, 1);
    }
  }
});

test('词条合计按 Unity 的公式进解析器（AffixTotalsFollowTsFormulas）', () => {
  const d = def('smg');
  const w = inst('smg', 3, {
    element: 'none',
    affixes: [
      ['dmg', 0.1], ['dmg', 0.05], ['rate', 0.12], ['mag', 0.3], ['reload', 0.2], ['critDmg', 0.25], ['critChance', 0.06], ['spread', 0.3], ['recoil', 0.4],
      ['pierce', 1], ['reserve', 0.5], ['hunter', 0.2], ['swift', 0.6], ['lg_nth', 6],
    ].map(([id, value]) => ({ id, value })),
  });
  let r = WS.resolveWeapon(w, new Stats());
  near(assert, r.damageMult, 1.6 * 1.15, 1e-9, '伤害倍率 = 品质 × (1 + 词条之和)');
  near(assert, r.damage, d.damage * 1.6 * 1.15, 1e-9);
  near(assert, r.fireRate, d.fireRate * 1.12, 1e-9);
  assert.equal(r.magCap, roundHalfUp(d.mag * 1.3));
  near(assert, r.reloadTime, d.reloadTime / 1.2, 1e-9);
  near(assert, r.critMult, d.critMult * 1.25, 1e-9);
  near(assert, r.critChance, 0.06, 1e-9);
  near(assert, r.spreadMult, 0.7, 1e-9);
  near(assert, r.recoilMult, 0.6, 1e-9);
  assert.equal(r.pierce, d.pierce + 1);
  assert.equal(r.reserveCap, roundHalfUp(d.reserve * 1.5));
  near(assert, r.hunter, 0.2, 1e-9);
  near(assert, r.swift, 0.6, 1e-9);
  assert.equal(r.legendary, 'lg_nth');
  assert.equal(r.legendaryValue, 6);
  assert.equal(r.elementChance, 0, '无元素实例的元素率是 0（元素率词条也不起作用）');

  const fire = inst('smg', 3, { element: 'fire', affixes: [{ id: 'elemChance', value: 0.1 }] });
  r = WS.resolveWeapon(fire, new Stats());
  near(assert, r.elementChance, Math.min(1, d.elementChance + 0.1), 1e-9, '有元素时 = 定义 + 词条，上限 1');

  const launcher = inst('launcher', 0, { affixes: [{ id: 'blast', value: 0.2 }, { id: 'projSpeed', value: 0.3 }] });
  const s = new Stats();
  s.add('explosionRadiusPct', 0.25, 'test');
  s.add('projectileSpeedPct', 0.1, 'test');
  const lr = WS.resolveWeapon(launcher, s);
  near(assert, lr.explosionRadius, 4 * 1.25 * 1.2, 1e-9);
  near(assert, def('launcher').projectile.speed * lr.projSpeedMult, 34 * 1.1 * 1.3, 1e-9, '弹速 = 定义 × 玩家弹速 × 词条');
});

test('下限：散布倍率 0.1、后坐倍率 0、换弹倍率 0.25', () => {
  const w = inst('revolver', 0, { affixes: [{ id: 'spread', value: 0.95 }, { id: 'recoil', value: 1.5 }] });
  const s = new Stats();
  s.add('reloadSpeedPct', -0.9, 'test');
  const r = WS.resolveWeapon(w, s);
  near(assert, r.spreadMult, resolver.MinSpreadMult, 1e-9);
  assert.equal(r.recoilMult, 0);
  near(assert, r.reloadTime, 1.6 / resolver.MinReloadMult, 1e-9);
});

test('缓存：没变化返回同一份；强化 / 属性版本 / 品质变了重算', () => {
  const w = inst('revolver'), s = new Stats();
  const a = WS.resolveWeapon(w, s);
  assert.equal(WS.resolveWeapon(w, s), a, '没变化时返回同一份缓存');
  const d0 = a.damage;
  w.level = 2;
  near(assert, WS.resolveWeapon(w, s).damage, d0 * 1.24, 1e-9, '强化后重算');
  const r0 = WS.resolveWeapon(w, s).fireRate;
  s.add('fireRatePct', 0.5, 'scroll');
  near(assert, WS.resolveWeapon(w, s).fireRate, r0 * 1.5, 1e-9, '属性版本变了重算');
  w.rarity = 4;
  near(assert, WS.resolveWeapon(w, s).fireRate, 3.5 * 1.5, 1e-9);
  near(assert, WS.resolveWeapon(w, s).damage, 38 * 1.9 * 1.24, 1e-9, '改品质后重算');
});

test('强化费用：round(50 × (等级 + 1) × (1 + 0.3 × 章))，负章节按 0，满级没有费用', () => {
  assert.deepEqual([lib.UpgradeBaseCost, lib.UpgradeChapterStep], [50, 0.3]);
  const cost = (level, chapter) => WeaponSystem.prototype.upgradeCost.call({ ctx: { run: { chapter } } }, { level });
  assert.equal(cost(0, 0), 50);
  assert.equal(cost(0, 2), 80);
  assert.equal(cost(1, 1), 130);
  assert.equal(cost(4, 0), 250);
  assert.equal(cost(4, -3), 250, '负章节按 0');
  assert.equal(cost(lib.MaxUpgrade, 0), null, '满级没有费用');
  for (let level = 0; level < lib.MaxUpgrade; level++) for (let ch = 0; ch < 4; ch++)
    assert.equal(cost(level, ch), Math.floor(lib.UpgradeBaseCost * (level + 1) * (1 + lib.UpgradeChapterStep * ch) + 0.5), `+${level} 第 ${ch + 1} 章`);
  const w = { level: 4 };
  WeaponSystem.prototype.upgrade.call({}, w);
  WeaponSystem.prototype.upgrade.call({}, w);
  assert.equal(w.level, lib.MaxUpgrade, '满级不再升');
});

// ───────────── 掷骰 ─────────────

const tsSystem = readFileSync(new URL('../src/weapons/WeaponSystem.ts', import.meta.url), 'utf8');

test('各章稀有度权重表、随机元素几率、幸运公式的常量同 Unity（网页源码 ↔ 冻结的 C# 规格）', () => {
  const ts = [...tsSystem.match(/CHAPTER_RARITY[^=]*=\s*\[([\s\S]*?)\];/)[1].matchAll(/\[([^\]]+)\]/g)].map(m => m[1].split(',').map(Number));
  assert.deepEqual(ts, chapterRarity);
  assert.equal(Number(tsSystem.match(/RANDOM_ELEMENT_CHANCE = ([\d.]+)/)[1]), roller.RandomElementChance);
  assert.deepEqual(SPEC.randomElements, ['fire', 'shock', 'corrode']);
  assert.match(tsSystem, /RANDOM_ELEMENTS[^=]*= \['fire', 'shock', 'corrode'\]/);
  assert.deepEqual([roller.LuckCommonDiv, roller.LuckRarityMul], [0.12, 0.15]);
  assert.match(tsSystem, /x === 0 \? w \/ \(1 \+ 0\.12 \* luck\) : w \* \(1 \+ 0\.15 \* luck \* x\)/);
  assert.equal(SPEC.randomElementMinRarity, 1, 'Unity RandomElementMinRarity = Rarity.Uncommon');
  assert.match(tsSystem, new RegExp(`element === 'none' && rarity >= ${SPEC.randomElementMinRarity} && rng\\.chance\\(RANDOM_ELEMENT_CHANCE\\)`));
});

function system(seed, { luck = 0, chapter = 0 } = {}) {
  const stats = new Stats();
  if (luck) stats.add('luck', luck, 'test');
  const self = Object.create(WeaponSystem.prototype);
  self.ctx = { rng: new Rng(seed), run: { chapter }, player: { stats } };
  self.resolve = w => WS.resolveWeapon(w, stats);
  return self;
}
function histogram(chapter, min, luck, n, seed) {
  const s = system(seed, { luck });
  const h = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) h[s.rollRarity(chapter, min)]++;
  return h;
}
/** WeaponRoller.RarityWeight */
function unityRarityWeight(chapter, rarity, luck, minRarity = 0) {
  if (rarity < minRarity) return 0;
  const w = chapterRarity[Math.min(Math.max(chapter, 0), chapterRarity.length - 1)][rarity];
  return rarity === 0 ? w / (1 + roller.LuckCommonDiv * luck) : w * (1 + roller.LuckRarityMul * luck * rarity);
}

test('稀有度分布 = 各章权重表；超出表的章节按最后一章', () => {
  const n = 100000;
  chapterRarity.forEach((row, ch) => {
    const total = row.reduce((a, b) => a + b, 0), h = histogram(ch, 0, 0, n, 1234 + ch);
    row.forEach((w, r) => near(assert, h[r] / n, w / total, 0.01, `第 ${ch + 1} 章 品质 ${r}`));
  });
  const far = histogram(7, 0, 0, 40000, 5), last = chapterRarity.at(-1), total = last.reduce((a, b) => a + b, 0);
  last.forEach((w, r) => near(assert, far[r] / 40000, w / total, 0.012, `第 8 章按最后一章 品质 ${r}`));
});

test('保底与幸运：保底后按剩余权重分；普通 ÷ (1 + 0.12L)，其余 × (1 + 0.15·L·品质)', () => {
  const h = histogram(0, 3, 0, 20000, 7);
  assert.equal(h[0] + h[1] + h[2], 0, '保底史诗：不会出更低的');
  near(assert, h[3] / 20000, 2 / 2.4, 0.015, '史诗 2 : 传说 0.4');
  assert.equal(system(1).rollRarity(0, 4), 4);
  const mean = hist => hist.reduce((s, c, i) => s + i * c, 0) / hist.reduce((s, c) => s + c, 0);
  const noLuck = histogram(0, 0, 0, 20000, 11), luck5 = histogram(0, 0, 5, 20000, 11);
  assert.ok(mean(luck5) > mean(noLuck) + 0.2, '幸运提高平均品质');
  assert.ok(luck5[0] < noLuck[0], '幸运压低普通');
  near(assert, unityRarityWeight(0, 0, 5), 58 / 1.6, 1e-9);
  near(assert, unityRarityWeight(1, 3, 5), 9 * (1 + 0.15 * 5 * 3), 1e-9);
  // 幸运 5 时的分布也按 Unity 的权重公式
  const big = histogram(1, 0, 5, 60000, 19);
  const weights = [0, 1, 2, 3, 4].map(r => unityRarityWeight(1, r, 5)), total = weights.reduce((a, b) => a + b, 0);
  weights.forEach((w, r) => near(assert, big[r] / 60000, w / total, 0.012, `幸运 5 品质 ${r}`));
});

test('随机元素：只给精良以上、定义里没有元素的武器；35%，三种均分', () => {
  const s = system(99);
  for (let i = 0; i < 2000; i++) assert.equal(s.roll({ defId: 'revolver', rarity: 0 }).element, 'none', '普通不掷随机元素');
  for (let i = 0; i < 200; i++) assert.equal(s.roll({ defId: 'launcher', rarity: 4 }).element, 'fire', '有元素的武器保持定义元素');
  const n = 60000, counts = { none: 0, fire: 0, shock: 0, corrode: 0 };
  for (let i = 0; i < n; i++) counts[s.roll({ defId: 'revolver', rarity: 2 }).element]++;
  const withElement = n - counts.none;
  near(assert, withElement / n, roller.RandomElementChance, 0.01, '精良以上 35% 随机元素');
  for (const e of ['fire', 'shock', 'corrode']) near(assert, counts[e] / withElement, 1 / 3, 0.02, `${e} 均分`);
});

test('roll 出来的实例：弹匣 / 备弹装满、固有词条排最前、保底生效、按掉落权重每把都会出；指定 id / 品质照办', () => {
  const s = system(5, { chapter: 1 });
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const w = s.roll({ chapter: 1, minRarity: 1 });
    const d = def(w.defId), r = s.resolve(w);
    assert.ok(w.rarity >= 1);
    assert.equal(w.mag, r.magCap, '弹匣装满');
    assert.equal(w.reserve, r.reserveCap, '备弹装满');
    if (d.element !== 'none') assert.equal(w.element, d.element);
    d.innate.forEach((a, k) => assert.equal(w.affixes[k].id, a.id, '固有词条排最前'));
    seen.add(w.defId);
  }
  assert.equal(seen.size, W.WEAPON_DEFS.length, '500 次里每把都出现过（按掉落权重）');
  const fixed = s.roll({ defId: 'stormpod', rarity: 1 });
  assert.deepEqual([fixed.defId, fixed.rarity, fixed.element], ['stormpod', 1, 'corrode']);
  // 掉落权重：出现率 = dropWeight ÷ 总和
  const n = 40000, counts = {}, total = W.WEAPON_DEFS.reduce((t, d) => t + d.dropWeight, 0), t = system(31);
  for (let i = 0; i < n; i++) { const id = t.roll({ rarity: 0 }).defId; counts[id] = (counts[id] ?? 0) + 1; }
  for (const d of W.WEAPON_DEFS) near(assert, counts[d.id] / n, d.dropWeight / total, 0.008, `${d.id} 的掉落率`);
  for (let i = 0; i < 50; i++) {
    const w = s.roll({ defId: 'revolver', rarity: 4 });
    assert.ok(s.resolve(w).legendary, '传说品质一定带特性');
  }
});

test('武器奖励的提示文案同 Unity（WeaponReward.Hint）', () => {
  // 网页的保底不写在奖励串里，由关卡类型 / 章节决定：普通 → 不保底，首领第一章 → 史诗，第二章起 → 传说
  assert.equal(rules.weaponRewardHint('combat', 0), '一把随机武器');
  assert.equal(rules.weaponRewardHint('boss', 0), '一把史诗及以上品质的武器');
  assert.equal(rules.weaponRewardHint('boss', 1), '一把传说品质的武器');
});

// ───────────── 奖励串（M8 照 Unity 改齐的）─────────────

test('武器奖励串同 Unity WeaponReward.Parse（WeaponStatsTests.WeaponRewardStringsParse）：weapon / weapon:min=N / weapon:<id> / weapon:<id>:N / weapon:<id>:min=N', () => {
  const p = rules.parseWeaponReward;
  assert.deepEqual(p('weapon'), { id: null, rarity: null, minRarity: 0 });
  assert.deepEqual(p('weapon:min=3'), { id: null, rarity: null, minRarity: 3 });
  assert.deepEqual(p('weapon:beam'), { id: 'beam', rarity: 0, minRarity: 0 }, '旧写法：指定武器 = 普通品质');
  assert.deepEqual(p('weapon:stormpod:1'), { id: 'stormpod', rarity: 1, minRarity: 0 });
  assert.deepEqual(p('weapon:revolver:min=2'), { id: 'revolver', rarity: null, minRarity: 2 });
  assert.equal(p('weapon:min=9').minRarity, 4, '保底夹到传说');
  // 参数顺序随意、空段跳过、品质夹到 0–4、第一个非数字段才是 id
  assert.deepEqual(p('weapon:2:smg'), { id: 'smg', rarity: 2, minRarity: 0 });
  assert.deepEqual(p('weapon::smg: :min=-1'), { id: 'smg', rarity: null, minRarity: 0 });
  assert.deepEqual(p('weapon:smg:revolver:7'), { id: 'smg', rarity: 4, minRarity: 0 });
  // 种类：带参数的武器奖励也是 'weapon'
  for (const r of ['weapon', 'weapon:min=1', 'weapon:beam']) assert.equal(rules.rewardKey(r), 'weapon');
  for (const r of ['scroll', 'coins', 'heal', 'upgrade', 'none']) assert.equal(rules.rewardKey(r), r);
});

test('武器奖励串的发放与提示同 Unity（EconomyConfig.ApplyTier + WeaponReward.Grant / Hint）：不带参数按关卡档位保底，写死的原样', () => {
  const roll = rules.weaponRewardRoll;
  // ApplyTier：'weapon' 在首领宝箱 → weapon:min=3（第一章）/ min=4（第二章起），精英 → min=1，普通不保底；带参数的不再套档位
  assert.deepEqual(roll('weapon', 'combat', 0), {});
  assert.deepEqual(roll('weapon', 'elite', 0), { minRarity: 1 });
  assert.deepEqual(roll('weapon', 'boss', 0), { minRarity: 3 });
  assert.deepEqual(roll('weapon', 'boss', 2), { minRarity: 4 });
  assert.deepEqual(roll('weapon:smg', 'boss', 1), { defId: 'smg', rarity: 0 }, '关卡写死的武器原样（ScrollRuntimeTests：ApplyTier("weapon:smg", Elite) = "weapon:smg"）');
  assert.deepEqual(roll('weapon:min=1', 'boss', 1), { minRarity: 1 });
  assert.deepEqual(roll('weapon:stormpod:1', 'combat', 0), { defId: 'stormpod', rarity: 1 });
  assert.deepEqual(roll('weapon:revolver:min=2', 'combat', 0), { defId: 'revolver', minRarity: 2 });
  // 交给 WeaponSystem.roll：指定的武器 / 品质 / 保底都生效（Unity WeaponRoller.Roll：rarity 写了就用，低于保底抬到保底）
  for (let seed = 1; seed <= 40; seed++) {
    const s = system(seed, { chapter: 0 });
    const a = s.roll({ chapter: 0, ...roll('weapon:stormpod:1', 'combat', 0) });
    assert.deepEqual([a.defId, a.rarity], ['stormpod', 1]);
    const b = s.roll({ chapter: 0, ...roll('weapon:revolver:min=2', 'combat', 0) });
    assert.equal(b.defId, 'revolver'); assert.ok(b.rarity >= 2, `保底稀有，掷出 ${b.rarity}`);
    assert.ok(s.roll({ chapter: 0, ...roll('weapon:min=3', 'combat', 0) }).rarity >= 3);
    assert.equal(s.roll({ chapter: 0, ...roll('weapon:beam', 'boss', 1) }).rarity, 0, '旧写法普通品质，首领档也不抬');
  }
  // 提示（WeaponStatsTests 里 h.Hint 的三条 + 指定武器显示名字）
  const hint = (r, type = 'combat', chapter = 0) => rules.weaponRewardHintFor(r, type, chapter, id => (W.hasWeaponDef(id) ? W.getWeaponDef(id).name : undefined));
  assert.equal(hint('weapon'), '一把随机武器');
  assert.equal(hint('weapon:min=3'), '一把史诗及以上品质的武器');
  assert.equal(hint('weapon:min=4'), '一把传说品质的武器');
  assert.equal(hint('weapon', 'boss', 0), '一把史诗及以上品质的武器', '不带参数按关卡档位（同 weaponRewardHint）');
  assert.equal(hint('weapon:stormpod:1'), `精良 · ${def('stormpod').name}`);
  assert.equal(hint('weapon:beam'), def('beam').name, '普通品质只写名字');
  assert.equal(hint('weapon:revolver:min=2'), `${def('revolver').name}（稀有及以上）`);
  assert.equal(hint('weapon:no_such_gun:2'), '一把稀有品质的武器', '查不到的武器按没指定说；固定品质不写「及以上」');
});
