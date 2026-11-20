// M13 对照：Unity EditMode 的 EliteAffixTests.cs（登记 / 随机 / 数值）与 EncounterTests.cs 里网页有对应实现的那几条
// （站位角色的默认到场延迟、锚点加分、精英体型 ×1.25）→ node --test。
// 精英词缀：src/enemies/Affixes.ts、EliteTornado.ts ↔ Enemies/Affixes/EliteAffix_*.cs、EliteTornado.cs；模型 / 危险物 / 名额打桩，只比登记表和数。
// 站位：src/enemies/Waves.ts、src/world/WaveRunner.ts ↔ Encounters/SpawnStations.cs（两边的私有常量读源码比）。
// EncounterSpec v2（Of / Wave / E、Promote、FromSquads / ToSquads、BandFor）、SquadAffixes.Resolve、InfernoSquads 网页还没有（M4 待办），不在这里。
// 只写测试，不改实现。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { cs, csConsts, csTest, tsGraph } from './unity-parity-kit.mjs';

const graph = await tsGraph({
  'enemies/Models.ts': 'export const Geo = {};\nexport const newAdditive = () => ({});\nexport const part = () => ({});\n',
  'enemies/Hazards.ts': 'export const blastPlayer = () => {};\n',
  'enemies/AttackTokens.ts': 'export const attackDirector = {};\n',
  'enemies/fx/SlashArc.ts': 'export const spawnSlashArc = () => {};\n',
  'enemies/bosses/Visuals.ts': 'export class GroundDecal {}\n',
});
after(() => graph.dispose());
const A = await graph.load('enemies/Affixes.ts');
const { TORNADO } = await graph.load('enemies/EliteTornado.ts');
const { Rng } = await graph.load('core/Rng.ts');
const ts = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const affixCs = id => cs(`Enemies/Affixes/EliteAffix_${id[0].toUpperCase()}${id.slice(1)}.cs`);
const num = s => Number(String(s).replace(/[fF]$/, ''));

test('登记了四种词缀：id、名字、颜色、顺序同 Unity（RegistryHasTheFourThreeJsAffixes）', () => {
  const expected = csTest('EliteAffixTests.cs');
  const ids = [...expected.match(/new\[\] \{ ("swift"[^}]+) \}, EliteAffixes\.All\.Select\(a => a\.Id\)/)[1].matchAll(/"(\w+)"/g)].map(m => m[1]);
  const names = [...expected.match(/new\[\] \{ ("迅捷"[^}]+) \}, EliteAffixes\.All\.Select\(a => a\.Name\)/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...A.AFFIX_IDS], ids);
  assert.deepEqual(A.AFFIX_IDS.map(id => A.AFFIX_NAMES[id]), names);
  for (const id of A.AFFIX_IDS) {
    const src = affixCs(id);
    assert.equal(src.match(/string Id => "(\w+)"/)[1], id);
    assert.equal(src.match(/string Name => "([^"]+)"/)[1], A.AFFIX_NAMES[id], `${id} 名字`);
    assert.equal(Number(src.match(/Color => Hex\.Rgb\((0x[0-9a-f]+)\)/)[1]), A.AFFIX_COLORS[id], `${id} 颜色`);
    assert.equal(Number(expected.match(new RegExp(`Hex\\.Rgb\\((0x[0-9a-f]+)\\), EliteAffixes\\.Get\\("${id}"\\)\\.Color`))[1]), A.AFFIX_COLORS[id]);
    assert.equal(A.isAffixId(id), true);
  }
  assert.equal(A.isAffixId('bogus'), false);
  assert.equal(A.isAffixId(null), false);
});

test('随机：没被排除的均匀，排除表里的不给，全被排除不给词缀（RollIsUniformOverTheAffixesNotExcluded）', () => {
  const rng = new Rng(7), counts = {};
  for (let i = 0; i < 3000; i++) { const id = A.rollAffix(rng, ['volatile']); counts[id] = (counts[id] ?? 0) + 1; }
  assert.equal(counts.volatile, undefined, '排除表里的不随机给');
  assert.equal(Object.keys(counts).length, 3);
  for (const [id, n] of Object.entries(counts)) assert.ok(n >= 850 && n <= 1150, `${id} 均匀（约 1000）：${n}`);
  assert.equal(A.rollAffix(rng, ['swift', 'shielded', 'volatile', 'frenzied']), null, '全被排除：不给词缀');
  const all = {};
  for (let i = 0; i < 4000; i++) { const id = A.rollAffix(rng); all[id] = (all[id] ?? 0) + 1; }
  for (const id of A.AFFIX_IDS) assert.ok(all[id] >= 850 && all[id] <= 1150, `${id}：${all[id]}`);
});

test('火药类敌人的排除表里有「爆裂」（GunpowderEnemiesNeverRollVolatileThroughTheSquadSource）', () => {
  for (const file of ['enemies/types/Bomber.ts', 'enemies/types/FireCrow.ts', 'enemies/types/Firecracker.ts'])
    assert.match(ts(file), /affixExclusions: \['volatile'\]/, file);
});

test('四种词缀的数同 Unity：迅捷 ×1.5 / ×1.5，坚盾 60% 护盾、脱战 4 s 后每秒回 22%，爆裂 4.5 m / 1 s / 26，狂暴 40% 以下 伤害 ×1.2 攻速 ×1.6 移速 ×1.35', () => {
  const src = ts('enemies/Affixes.ts');
  // BuffMods(damage, rate, speed, taken)
  assert.match(cs('Enemies/EnemyBuffs.cs'), /BuffMods\(float damage, float rate, float speed, float taken\)/);
  const mods = id => affixCs(id).match(/BuffMods Mods = new\(([^)]+)\)/)[1].split(',').map(num);
  const [, swiftRate, swiftSpeed] = mods('swift');
  const swift = src.slice(src.indexOf('class SwiftAffix'), src.indexOf('class ShieldedAffix'));
  assert.equal(num(swift.match(/e\.speedMult \*= ([\d.]+);/)[1]), swiftSpeed);
  assert.equal(num(swift.match(/e\.attackRate \*= ([\d.]+);/)[1]), swiftRate);

  const sh = csConsts(affixCs('shielded'));
  const shielded = src.slice(src.indexOf('class ShieldedAffix'), src.indexOf('class VolatileAffix'));
  assert.equal(num(shielded.match(/Math\.round\(e\.maxHp \* ([\d.]+)\)/)[1]), sh.ShieldFrac);
  assert.equal(num(shielded.match(/now - e\.lastHurtTime > ([\d.]+)/)[1]), sh.RegenDelay);
  assert.equal(num(shielded.match(/e\.shield \+ e\.maxShield \* ([\d.]+) \* dt/)[1]), sh.RegenRate);

  const vo = csConsts(affixCs('volatile'));
  assert.deepEqual(['VOLATILE_RADIUS', 'VOLATILE_FUSE', 'VOLATILE_DAMAGE'].map(k => num(src.match(new RegExp(`const ${k} = ([\\d.]+);`))[1])), [vo.Radius, vo.Fuse, vo.BaseDamage]);

  const fr = csConsts(affixCs('frenzied'));
  const [frDamage, frRate, frSpeed] = mods('frenzied');
  const frenzied = src.slice(src.indexOf('class FrenziedAffix'));
  assert.equal(num(frenzied.match(/e\.hp <= e\.maxHp \* ([\d.]+)/)[1]), fr.Threshold);
  assert.equal(num(frenzied.match(/e\.speedMult \*= ([\d.]+);/)[1]), frSpeed);
  assert.equal(num(frenzied.match(/e\.attackRate \*= ([\d.]+);/)[1]), frRate);
  assert.equal(num(frenzied.match(/e\.damageMult \*= ([\d.]+);/)[1]), frDamage);
});

test('迅捷的前行龙卷：前摇 / 射程 / 速度 / 半径 / 高度 / 伤害 / 冷却 / 出手距离带同 Unity', () => {
  const c = csConsts(cs('Enemies/Affixes/EliteTornado.cs'));
  assert.deepEqual(
    [TORNADO.windup, TORNADO.range, TORNADO.speed, TORNADO.radius, TORNADO.height, TORNADO.baseDamage, TORNADO.cooldownMin, TORNADO.cooldownMax],
    [c.Windup, c.Range, c.Speed, c.Radius, c.Height, c.BaseDamage, c.CooldownMin, c.CooldownMax]);
  const swift = affixCs('swift');
  const first = swift.match(/tornadoCooldown = Random\.Range\(([\d.]+)f, ([\d.]+)f\)/);
  assert.deepEqual([TORNADO.firstMin, TORNADO.firstMax], [num(first[1]), num(first[2])], '第一次龙卷前的冷却');
  const band = swift.match(/distance < ([\d.]+)f \|\| distance > ([\d.]+)f \|\| Mathf\.Abs\(offset\.y\) > ([\d.]+)f/);
  assert.deepEqual([TORNADO.minDistance, TORNADO.maxDistance, TORNADO.maxRise], band.slice(1).map(num), '出手距离带与高差上限');
});

// ───────────── 站位（EncounterTests.RolesArrivalAndAnchorBonus / BodySizeScalesWithEliteAndArt 里网页有的部分）─────────────

test('站位角色的默认到场延迟同 Unity SpawnStations.DefaultArrival：前排 0、远程 0.2、辅助 0.6、侧袭 0.85、狙击 0.9、炮手 1.2', () => {
  const stations = cs('Encounters/SpawnStations.cs');
  const unity = Object.fromEntries([...stations.match(/DefaultArrival\(StationRole role\) => role switch\s*\{([\s\S]*?)\};/)[1].matchAll(/StationRole\.(\w+) => ([\d.]+)f/g)].map(m => [m[1].toLowerCase(), num(m[2])]));
  const web = Object.fromEntries([...ts('enemies/Waves.ts').match(/const ARRIVAL[^=]*= \{([^}]+)\}/)[1].matchAll(/(\w+): ([\d.]+)/g)].map(m => [m[1], Number(m[2])]));
  assert.deepEqual(web, { assault: 0, ...unity });
  const order = ['assault', 'ranged', 'support', 'flank', 'precision', 'artillery'].map(r => web[r]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), '前排先到、远程稍晚、侧袭与狙击再晚、炮手最后');
});

test('锚点加分（角色对 +8 / 不对 −3、同 lane +2）与精英体型 ×1.25 同 Unity', () => {
  const stations = cs('Encounters/SpawnStations.cs'), runner = ts('world/WaveRunner.ts');
  const bonus = stations.match(/role == q\.role \? (\d+) : (-\d+);\s*if \(lane == q\.lane\) s \+= (\d+);/);
  const web = runner.match(/\(a\.role === role \? (\d+) : (-\d+)\) \+ \(a\.lane === lane \? (\d+) : 0\)/);
  assert.deepEqual(web.slice(1).map(Number), bonus.slice(1).map(Number));
  assert.equal(num(stations.match(/\(elite \? ([\d.]+)f : 1f\)/)[1]), Number(runner.match(/\(enemy\.elite \? ([\d.]+) : 1\)/)[1]));
});

// ───────────── 不一致清单（不改实现）─────────────

test.todo('高台站位加分：Unity AnchorBonus 对俯射角色（远程 / 狙击 / 炮手）上高台 +3、其它角色 −1.5；网页 WaveRunner.pickPoint 的锚点没有 elevated 这一项（src/world/WaveRunner.ts）');
test.todo('Auto 站位：Unity 的锚点角色是 Auto 时不加不减；网页的锚点角色不等于请求角色一律 −3（WaveRunner 的锚点没有 auto 角色）');
test.todo('EncounterSpec v2（Of / Wave / E、Promote 按重型优先与 RunRng、FromSquads / ToSquads、BandFor 距离带）、SquadAffixes.Resolve（条目 → 小队 → 随机）、InfernoSquads：网页没有对应实现（M4 待办「EncounterSite v2 其余部分」），EncounterTests / InfernoSquadsTests 的这些用例没迁');
