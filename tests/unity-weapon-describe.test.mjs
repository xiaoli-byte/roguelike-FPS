// M13 对照：Unity EditMode 的 WeaponDescriberTests.cs → node --test。
// 武器描述（WeaponDescriber ↔ src/weapons/Describe.ts）与拾取对比行（CompareLine / CompareLines ↔ src/progression/loot/weaponPrompt.ts）。
// 属性表用一张空的 Stats（Unity 传 null = 没有任何加成）。只写测试，不改实现。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { cs, csConsts, tsGraph } from './unity-parity-kit.mjs';

const graph = await tsGraph();
after(() => graph.dispose());
const W = await graph.load('weapons/WeaponDefs.ts');
const WS = await graph.load('weapons/WeaponStats.ts');
const D = await graph.load('weapons/Describe.ts');
const { weaponPrompt } = await graph.load('progression/loot/weaponPrompt.ts');
const { Stats } = await graph.load('core/Stats.ts');
const T = await graph.load('core/types.ts');

const stats = new Stats();
let uid = 1;
const make = (id, rarity = 0, o = {}) => ({ uid: uid++, defId: id, rarity, level: 0, element: W.getWeaponDef(id).element, mag: 0, reserve: 0, affixes: W.getWeaponDef(id).innate.map(a => ({ ...a })), ...o });
const describe = (id, rarity = 0, o) => { const inst = make(id, rarity, o); return D.describeWeapon(inst, WS.resolveWeapon(inst, stats)); };
const stat = (d, label) => d.stats.find(s => s.label === label)?.value ?? null;
const lib = csConsts(cs('Weapons/WeaponDefs.cs'));

test('每把武器 × 每个品质都有描述：品质名、名字、秒伤 / 暴击 / 强化行；枪还有伤害 / 射速 / 弹匣 / 备弹 / 换弹 / 元素', () => {
  const rarityNames = [...cs('Core/Rarity.cs').matchAll(/"(普通|精良|稀有|史诗|传说)"/g)].map(m => m[1]);
  assert.deepEqual([...T.RARITY_NAMES], rarityNames.slice(0, 5), '品质名同 Unity 的 Rarity.Name');
  for (const def of W.WEAPON_DEFS) for (let r = 0; r < 5; r++) {
    const d = describe(def.id, r);
    assert.equal(d.rarityName, T.RARITY_NAMES[r], def.id);
    assert.ok(d.name.endsWith(def.name), def.id);
    assert.ok(stat(d, '秒伤'), `${def.id} 没有秒伤行`);
    assert.ok(stat(d, '暴击'), `${def.id} 没有暴击行`);
    assert.equal(stat(d, '强化'), `0/${lib.MaxUpgrade}`, def.id);
    if (!def.blade) for (const label of ['伤害', '射速', '弹匣', '备弹', '换弹', '元素']) assert.ok(stat(d, label), `${def.id} 没有「${label}」`);
  }
});

test('蜂鸣冲锋枪的每一行（SmgMatchesTsFormat）', () => {
  const d = describe('smg');
  assert.equal(d.name, '蜂鸣冲锋枪');
  assert.equal(d.category, '冲锋枪');
  assert.deepEqual(
    ['伤害', '射速', '秒伤', '弹匣', '备弹', '换弹', '暴击', '元素', '穿透'].map(l => stat(d, l)),
    ['11', '13.0 发/秒', '约 143', '36', '252', '1.7 秒', '×2.0', '物理', null]);
});

test('各开火方式的专属写法：弹丸 ×N、逐发装填、连发、每跳 / 能量、蓄力区间、三相轮转、碎刃', () => {
  const shotgun = describe('shotgun');
  assert.ok(stat(shotgun, '伤害').endsWith(' ×9'));
  assert.ok(stat(shotgun, '换弹').endsWith('秒/发'), '逐发装填写每发耗时');
  assert.ok(stat(describe('burst'), '射速').includes('连发）'));
  const beam = describe('beam');
  assert.ok(stat(beam, '伤害').endsWith(' /跳'));
  assert.ok(stat(beam, '射速').endsWith('跳/秒'));
  assert.ok(stat(beam, '弹匣').endsWith('能量'));
  const rail = describe('railgun');
  assert.ok(stat(rail, '伤害').includes('–'), '蓄力武器写伤害区间');
  assert.ok(stat(rail, '射速').startsWith('蓄力 '));
  const tri = describe('trinity');
  assert.equal(tri.elementLabel, '三相');
  assert.ok(stat(tri, '元素').startsWith('三相轮转 '));
  const blade = describe('demon_blade');
  assert.ok(stat(blade, '斩'));
  assert.ok(stat(blade, '千刃出窍'));
  assert.ok(stat(blade, '秒伤').startsWith('斩 约 '));
  assert.ok(blade.skill);
  assert.ok(blade.traits.some(t => t.startsWith('【武器技能·杀气爆发】')), '碎刃特性行写武器技能');
});

test('品质放大伤害和秒伤；秒伤行 = 约 round(dps)', () => {
  const a = WS.resolveWeapon(make('rifle', 0), stats), b = WS.resolveWeapon(make('rifle', 4), stats);
  assert.ok(Math.abs(b.dps / a.dps - W.RARITY_DAMAGE[4]) < 1e-9);
  assert.equal(stat(describe('rifle', 4), '秒伤'), `约 ${Math.floor(b.dps + 0.5)}`);
});

test('数字格式：≥ 10 取整、< 10 留一位小数；百分比 .5 进位（NumberFormatsFollowTs）', () => {
  // 网页的 num / pct 不导出：改解析结果里的伤害，从「伤害」行读回来
  const inst = make('smg');
  const dmg = v => stat(D.describeWeapon(inst, { ...WS.resolveWeapon(inst, stats), damage: v }), '伤害');
  assert.equal(dmg(8), '8');
  assert.equal(dmg(7.46), '7.5');
  assert.equal(dmg(12.5), '13');
  const crit = v => stat(D.describeWeapon(inst, { ...WS.resolveWeapon(inst, stats), critChance: v }), '暴击');
  assert.equal(crit(0.123), '×2.0（+12% 暴击率）');
  assert.equal(crit(0.125), '×2.0（+13% 暴击率）');
});

/** 假的武器系统：describe 直接返回给定的描述 */
function prompt(picked, held, { full = true } = {}) {
  const a = { uid: 1, level: 0 }, b = held ? { uid: 2, level: 0 } : null;
  const ctx = { weapons: { active: b, slots: full ? [a, b] : [b, null], describe: inst => (inst === a ? picked : held) } };
  return weaponPrompt(ctx, a, '拾取').lines;
}
const one = (label, value, cur) => prompt({ name: 'x', element: 'fire', stats: [{ label, value }], traits: [] }, cur === null ? null : { name: 'y', element: 'fire', stats: [{ label, value: cur }], traits: [] })[0];

test('对比行：▲ 更好 / ▼ 更差，换弹越短越好，格式不同不标记号（CompareLineMarksBetterAndWorse）', () => {
  assert.equal(one('伤害', '23', null), '伤害  23');
  assert.equal(one('伤害', '23', '23'), '伤害  23');
  assert.equal(one('伤害', '23', '18'), '伤害  23 ▲（当前 18）');
  assert.equal(one('伤害', '12 ×9', '18 ×9'), '伤害  12 ×9 ▼（当前 18 ×9）');
  assert.equal(one('换弹', '1.5 秒', '2.0 秒'), '换弹  1.5 秒 ▲（当前 2.0 秒）', '换弹越短越好');
  assert.equal(one('射速', '蓄力 0.83 秒', '13.0 发/秒'), '射速  蓄力 0.83 秒（当前 13.0 发/秒）', '格式不同不标记号');
  assert.equal(one('伤害', '23', '12 ×9'), '伤害  23（当前 12 ×9）', '单发对多弹丸不标记号');
});

test('和手里的武器逐行对比：强化不单列、物理不列元素行、末行写替换 / 放入空槽位（CompareLinesAgainstHeldWeapon）', () => {
  const better = describe('smg', 3), held = describe('smg', 0);
  const lines = prompt(better, held);
  assert.ok(lines.some(l => l.startsWith('伤害') && l.includes('▲') && l.includes('（当前 11）')), lines.join('\n'));
  assert.ok(!lines.some(l => l.startsWith('强化')), '强化写在副标题里，不单列');
  assert.ok(!lines.some(l => l.startsWith('元素')), '物理不列元素行');
  assert.equal(lines.at(-1), '将替换当前武器：蜂鸣冲锋枪');
  assert.equal(prompt(better, held, { full: false }).at(-1), '放入空槽位，保留蜂鸣冲锋枪');
  assert.ok(!prompt(better, null).some(l => l.includes('当前')), '没有手持武器时不对比');
});

test('强化后描述跟着变（DescriptionIsCachedUntilWeaponChanges 的数）', () => {
  const w = make('revolver');
  assert.equal(stat(D.describeWeapon(w, WS.resolveWeapon(w, stats)), '强化'), '0/5');
  w.level = 2;
  assert.equal(stat(D.describeWeapon(w, WS.resolveWeapon(w, stats)), '强化'), '2/5');
});
