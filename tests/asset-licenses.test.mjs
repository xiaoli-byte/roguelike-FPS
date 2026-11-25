// 发布资产的许可门禁（docs: art/README.md「11. 许可与合规」）。
// 清单（public/assets/manifest.json）里每条资产都要带许可，且许可必须落在已知的几类里；
// 不可再分发的第三方资产只能是下面白名单里登记过的，新增一条就要先在这里写明理由。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('public/assets/manifest.json', root), 'utf8')).assets;

/** 许可文本 → 类别。新的来源先在这里登记，别让清单里出现没人认识的许可。 */
const CATEGORIES = [
  { id: 'tripo', match: /^Tripo Studio/, redistributable: true },
  { id: 'project', match: /^project-original /, redistributable: true },
  // Tencent Hunyuan 3D Community License：产出不得在欧盟 / 英国 / 韩国境内使用或分发
  { id: 'hunyuan', match: /Hunyuan/, redistributable: true, regionRestricted: true },
  { id: 'third-party-game', match: /installed-game asset/, redistributable: false },
];

/**
 * 不可再分发、但暂时留在发布路径里的资产。2026-11-25 用户：枪火提取武器「暂时保留」——
 * 原型期本机使用，主游戏的冲锋枪 / 左轮 / 灵炮等靠它们的原生双手与开火、换弹动画；对外发布前必须换掉。
 * public/assets/gunfire-original/（OriginalWeaponLibrary 读的那份）同属这一批，没有进主清单。
 */
const NOT_REDISTRIBUTABLE_ALLOWED = new Set([
  'SK_Weapon_Gunfire1001', 'SK_Weapon_Gunfire1002', 'SK_Weapon_Gunfire1008',
  'SK_Weapon_Gunfire1106', 'SK_Weapon_Gunfire1202', 'SK_Weapon_Gunfire1301',
]);

const category = (license) => CATEGORIES.find((c) => c.match.test(license));

test('every published asset carries a license', () => {
  const missing = Object.entries(manifest).filter(([, e]) => typeof e.license !== 'string' || !e.license.trim()).map(([id]) => id);
  assert.deepEqual(missing, [], `清单条目缺 license 字段：${missing.join(', ')}`);
});

test('every license falls in a known category', () => {
  const unknown = Object.entries(manifest).filter(([, e]) => e.license && !category(e.license)).map(([id, e]) => `${id}: ${e.license}`);
  assert.deepEqual(unknown, [], `没登记的许可类别（先在 CATEGORIES 里登记）：\n${unknown.join('\n')}`);
});

test('non-redistributable assets are only the allow-listed ones', () => {
  const found = Object.entries(manifest).filter(([, e]) => category(e.license ?? '')?.redistributable === false).map(([id]) => id).sort();
  assert.deepEqual(found, [...NOT_REDISTRIBUTABLE_ALLOWED].sort(),
    '不可再分发的资产变了：新增的要先进白名单并写明理由，换掉的从白名单删掉');
});

test('region-restricted licenses state the restriction', () => {
  const silent = Object.entries(manifest)
    .filter(([, e]) => category(e.license ?? '')?.regionRestricted && !/欧盟.*英国.*韩国/.test(e.license))
    .map(([id]) => id);
  assert.deepEqual(silent, [], `Hunyuan 产出的许可里要写明「不得在欧盟 / 英国 / 韩国使用或分发」：${silent.join(', ')}`);
});
