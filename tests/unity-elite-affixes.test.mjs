// M13 对照：Unity EditMode 的 EliteAffixTests.cs（登记 / 随机 / 数值）与 EncounterTests.cs 里网页有对应实现的那几条
// （站位角色的默认到场延迟、锚点加分、精英体型 ×1.25）→ node --test。
// 精英词缀：src/enemies/Affixes.ts、EliteTornado.ts ↔ Enemies/Affixes/EliteAffix_*.cs、EliteTornado.cs；模型 / 危险物 / 名额打桩，只比登记表和数。
// 站位：src/enemies/Waves.ts、src/world/WaveRunner.ts ↔ Encounters/SpawnStations.cs（网页的私有常量读源码，Unity 那边是冻结的规格）。
// Unity 一侧是 Unity 版删除前从 C# 冻结的规格：tests/fixtures/spec/elite-affixes.json、cs-consts.json。
// 只写测试，不改实现。
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { spec, tsGraph } from './unity-parity-kit.mjs';

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
// WaveRunner（锚点加分）：敌人登记表打桩，单独一张图
const runnerGraph = await tsGraph({ 'enemies/Registry.ts': 'export function getEnemyDef() { return undefined; }\n' });
after(() => runnerGraph.dispose());
const W = await runnerGraph.load('world/WaveRunner.ts');
const ts = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const SPEC = spec('elite-affixes');
const K = spec('cs-consts');
/** EliteAffix_<Id>.cs 的常量 */
const affixConsts = id => K[SPEC.affixes[id].src];
const num = s => Number(String(s).replace(/[fF]$/, ''));

test('登记了四种词缀：id、名字、颜色、顺序同 Unity（RegistryHasTheFourThreeJsAffixes）', () => {
  assert.deepEqual([...A.AFFIX_IDS], SPEC.ids);
  assert.deepEqual(A.AFFIX_IDS.map(id => A.AFFIX_NAMES[id]), SPEC.names);
  for (const id of A.AFFIX_IDS) {
    const u = SPEC.affixes[id];
    assert.equal(u.id, id);
    assert.equal(u.name, A.AFFIX_NAMES[id], `${id} 名字`);
    assert.equal(u.color, A.AFFIX_COLORS[id], `${id} 颜色`);
    assert.equal(u.testColor, A.AFFIX_COLORS[id], `${id} 颜色（EliteAffixTests）`);
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
  // EliteAffix_*.cs 的 BuffMods Mods = new(damage, rate, speed, taken)
  const { rate: swiftRate, speed: swiftSpeed } = SPEC.affixes.swift.mods;
  const swift = src.slice(src.indexOf('class SwiftAffix'), src.indexOf('class ShieldedAffix'));
  assert.equal(num(swift.match(/e\.speedMult \*= ([\d.]+);/)[1]), swiftSpeed);
  assert.equal(num(swift.match(/e\.attackRate \*= ([\d.]+);/)[1]), swiftRate);

  const sh = affixConsts('shielded');
  const shielded = src.slice(src.indexOf('class ShieldedAffix'), src.indexOf('class VolatileAffix'));
  assert.equal(num(shielded.match(/Math\.round\(e\.maxHp \* ([\d.]+)\)/)[1]), sh.ShieldFrac);
  assert.equal(num(shielded.match(/now - e\.lastHurtTime > ([\d.]+)/)[1]), sh.RegenDelay);
  assert.equal(num(shielded.match(/e\.shield \+ e\.maxShield \* ([\d.]+) \* dt/)[1]), sh.RegenRate);

  const vo = affixConsts('volatile');
  assert.deepEqual(['VOLATILE_RADIUS', 'VOLATILE_FUSE', 'VOLATILE_DAMAGE'].map(k => num(src.match(new RegExp(`const ${k} = ([\\d.]+);`))[1])), [vo.Radius, vo.Fuse, vo.BaseDamage]);

  const fr = affixConsts('frenzied');
  const { damage: frDamage, rate: frRate, speed: frSpeed } = SPEC.affixes.frenzied.mods;
  const frenzied = src.slice(src.indexOf('class FrenziedAffix'));
  assert.equal(num(frenzied.match(/e\.hp <= e\.maxHp \* ([\d.]+)/)[1]), fr.Threshold);
  assert.equal(num(frenzied.match(/e\.speedMult \*= ([\d.]+);/)[1]), frSpeed);
  assert.equal(num(frenzied.match(/e\.attackRate \*= ([\d.]+);/)[1]), frRate);
  assert.equal(num(frenzied.match(/e\.damageMult \*= ([\d.]+);/)[1]), frDamage);
});

test('迅捷的前行龙卷：前摇 / 射程 / 速度 / 半径 / 高度 / 伤害 / 冷却 / 出手距离带同 Unity', () => {
  const c = K['Enemies/Affixes/EliteTornado.cs'];
  assert.deepEqual(
    [TORNADO.windup, TORNADO.range, TORNADO.speed, TORNADO.radius, TORNADO.height, TORNADO.baseDamage, TORNADO.cooldownMin, TORNADO.cooldownMax],
    [c.Windup, c.Range, c.Speed, c.Radius, c.Height, c.BaseDamage, c.CooldownMin, c.CooldownMax]);
  // EliteAffix_Swift.cs：tornadoCooldown = Random.Range(4.5f, 6.5f)；distance < 4f || distance > 24f || |offset.y| > 4f 不出手
  assert.deepEqual([TORNADO.firstMin, TORNADO.firstMax], SPEC.swift.firstCooldown, '第一次龙卷前的冷却');
  assert.deepEqual([TORNADO.minDistance, TORNADO.maxDistance, TORNADO.maxRise], SPEC.swift.band, '出手距离带与高差上限');
});

// ───────────── 站位（EncounterTests.RolesArrivalAndAnchorBonus / BodySizeScalesWithEliteAndArt 里网页有的部分）─────────────

test('站位角色的默认到场延迟同 Unity SpawnStations.DefaultArrival：前排 0、远程 0.2、辅助 0.6、侧袭 0.85、狙击 0.9、炮手 1.2', () => {
  const web = Object.fromEntries([...ts('enemies/Waves.ts').match(/const ARRIVAL[^=]*= \{([^}]+)\}/)[1].matchAll(/(\w+): ([\d.]+)/g)].map(m => [m[1], Number(m[2])]));
  assert.deepEqual(web, { assault: 0, ...SPEC.stations.defaultArrival });
  const order = ['assault', 'ranged', 'support', 'flank', 'precision', 'artillery'].map(r => web[r]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), '前排先到、远程稍晚、侧袭与狙击再晚、炮手最后');
});

test('锚点加分（角色对 +8 / 不对 −3、同 lane +2、高台对俯射 +3 / 其它 −1.5、Auto 不加不减）与精英体型 ×1.25 同 Unity', () => {
  const runner = ts('world/WaveRunner.ts');
  // SpawnStations.cs：角色对 / 不对、同 lane、高台对俯射 / 其它
  const web = runner.match(/if \(anchorRole !== 'auto'\) s \+= anchorRole === role \? (\d+) : (-\d+);\s*if \(anchorLane === lane\) s \+= (\d+);\s*if \(elevated\) s \+= raisedRole\(role\) \? (\d+) : (-[\d.]+);/);
  assert.deepEqual(web.slice(1).map(Number), SPEC.stations.anchorBonus);
  assert.equal(SPEC.stations.eliteBodyScale, Number(runner.match(/\(enemy\.elite \? ([\d.]+) : 1\)/)[1]));
  // 俯射角色（RaisedRole）：远程 / 狙击 / 炮手
  assert.deepEqual(['assault', 'flank', 'ranged', 'precision', 'artillery', 'support'].filter(W.raisedRole), SPEC.stations.raisedRoles);
  // EncounterTests.RolesArrivalAndAnchorBonus 的四条
  assert.equal(W.anchorBonus('ranged', 1, true, 'ranged', 1), 8 + 2 + 3, '角色 + lane + 远程上高台');
  assert.equal(W.anchorBonus('flank', 0, false, 'ranged', 1), -3, '角色不对');
  assert.equal(W.anchorBonus('auto', 1, false, 'ranged', 1), 2, 'Auto 站位不加不减');
  assert.equal(W.anchorBonus('assault', 0, true, 'assault', 1), 8 - 1.5, '正面不爱上高台');
  // 只站地面的敌人跳过高台锚点（Unity SpawnStations 同样）
  assert.match(runner, /if \(a\.elevated && groundOnly\) continue;/);
});

test('场景文档的站位角色按 Unity StationRole 读（0 = Auto，1–6 = 正面 / 侧袭 / 远程 / 狙击 / 炮手 / 辅助），条目的 Auto 按敌人定义的站位', () => {
  const role = SPEC.stations.roles;
  assert.deepEqual(role, ['auto', 'assault', 'flank', 'ranged', 'precision', 'artillery', 'support']);
  const adapter = ts('world/UnitySceneAdapter.ts');
  assert.deepEqual(JSON.parse(adapter.match(/const ROLES = (\[[^\]]+\]) as const;/)[1].replaceAll("'", '"')), role, '网页的角色表按枚举顺序，0 是 auto');
  assert.match(adapter, /return r === 'auto' \? undefined : r;/, '条目的 Auto 不写死角色');
  assert.match(ts('world/WaveRunner.ts'), /placement: e\.placement \?\? getEnemyDef\(e\.enemyId\)\?\.placement \?\? defaultPlacement\(e\.enemyId\)/);
});

// ───────────── 网页还没有的（不改实现）─────────────

test.todo('高台站位的数据：关卡文档的 encounters[].anchors 只有 position / lane / role，没有 elevated（网页 WaveRunner.anchorBonus 与 UnitySceneAdapter 已经接好，关卡数据补上这一项就生效）');
test.todo('遭遇规格 v2（Of / Wave / E、Promote 按重型优先与 RunRng、FromSquads / ToSquads、BandFor 距离带）、小队词缀解析（条目 → 小队 → 随机）、炼狱小队：网页没有对应实现（M4 待办「EncounterSite v2 其余部分」）');
