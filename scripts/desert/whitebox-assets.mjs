// 第一章白盒 ↔ 已有美术资产（用户 2026-11-24：「尽量复用原来的已生成的美术资产」）。
//   node scripts/desert/whitebox-assets.mjs            从 public/assets/manifest.json 重新生成 src/world/desert/whitebox/assets.ts（已发布的沙漠件：ID、尺寸、用途）
//   node scripts/desert/whitebox-assets.mjs --report   每张白盒复用了哪些件（各几处、体块尺寸是资产的几倍）、哪些体块还没对上资产、要新做哪些件
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = new URL('../../', import.meta.url);
/** 用途说明（docs/art/ch1-map-kit.md 和各图设计稿）；avoid = 不要再用的件 */
const USE = {
  SM_Tripo_DesertPosthouseWall: '驿站残墙（院墙一段，两端平切可连排，矮段按高度缩放）',
  SM_Tripo_DesertHanWall: '汉长城直段（夯土夹芦苇层，半埋）',
  SM_Tripo_DesertHanWallEnd: '汉长城断口（缺口两侧）',
  SM_Tripo_DesertHanWallCorner: '汉长城转角 / 墩台',
  SM_Tripo_DesertBeaconTower: '烽燧（1-1 主地标）',
  SM_Tripo_DesertBeaconParapet: '烽燧台垛墙（1.1 m，半身掩体，沿台沿连排）',
  SM_Tripo_DesertBrushwoodPile: '积薪（柴堆，可放大 1.5–1.8 倍）',
  SM_Tripo_DesertCaravanWreck: '驼队残车',
  SM_Tripo_DesertGoodsPile: '货堆（半身掩体）',
  SM_Tripo_DesertMarketStall: '货摊（带篷）',
  SM_Tripo_DesertBarricade: '拒马',
  SM_Tripo_DesertPortalShrine: '出口祭坛（传送门）',
  SM_Tripo_DesertSeatedColossus: '敦煌坐像（1-1 远景地标；1-3 寺院前庭巨像）',
  SM_Tripo_DesertColossus: '胡狼头巨像（题材不对，不要再用）',
  SM_Tripo_DesertYardangFleet: '雅丹岩丘 · 舰形（20 m 级）',
  SM_Tripo_DesertYardangMedium: '雅丹岩丘 · 中（9 m）',
  SM_Tripo_DesertYardangSmall: '雅丹岩丘 · 小（4 m，可沿长轴拉伸）',
  SM_Tripo_DesertYardangSphinx: '狮身雅丹（1-2 出生点地标）',
  SM_Tripo_DesertRockArch: '岩拱（1-2 出口，拱洞前后通透）',
  SM_Tripo_DesertStupaBuried: '半埋佛塔（1-2 塔尖广场地标，带两级环台）',
  SM_Tripo_DesertBuriedRoofFlat: '半埋屋顶 · 平顶土坯房（屋脊之海的落脚平台）',
  SM_Tripo_DesertBuriedRoofHall: '半埋屋顶 · 殿堂歇山顶',
  SM_Tripo_DesertBuriedRoofHouse: '半埋屋顶 · 民居两坡顶',
  SM_Tripo_DesertFinial: '塔刹（半埋，掩体）',
  SM_Tripo_DesertShopHouse: '二层店铺楼（一层敞开店面，二层前廊）',
  SM_Tripo_DesertWell: '集市井台',
  SM_Tripo_DesertTemplePagoda: '寺塔（1-3 地标，22 m）',
  SM_Tripo_DesertCloister: '寺院回廊 · 二层（一跨，沿长向连排）',
  SM_Tripo_DesertCrescentPavilion: '月牙阁（1-4：一层敞廊、二层台）',
  SM_Tripo_DesertCornerTower: '城墙角楼',
  SM_Tripo_DesertGateway: '城门 / 门楼',
  SM_Tripo_DesertRampart: '城墙段（带垛口）',
  SM_Tripo_DesertRampartPlain: '城墙段（无垛口）',
  SM_Tripo_DesertRampartPanel: '城墙面板（派生件）',
  SM_Tripo_DesertRampartPlainPanel: '城墙面板 · 无垛口（派生件）',
  SM_Tripo_DesertRampartEndL: '城墙端头 · 左（派生件）',
  SM_Tripo_DesertRampartEndR: '城墙端头 · 右（派生件）',
  SM_Tripo_DesertCoverWall: '掩体矮墙（半身）',
  SM_Tripo_DesertColumn: '石柱（竖着像人影，交战区里放倒用）',
  SM_Tripo_DesertColumnRuin: '残柱 / 倒伏石柱（半身掩体）',
  SM_Tripo_DesertPlatformBlock: '台基块（拼台地、环台）',
  SM_Tripo_DesertStairs: '台阶',
  SM_Tripo_DesertTreasureHoard: '宝藏堆（藏宝点）',
  SM_Tripo_DesertBrazier: '火盆（补光来源）',
  SM_Tripo_DesertCamelthorn: '骆驼刺（散布）',
  SM_Tripo_DesertGravelScatter: '黑戈壁砾石（散布）',
  SM_Env_DesertTamarisk: '红柳（散布，高灌木）',
  SM_Env_DesertSandstone: '砂岩巨砾（掩体：整块全身，压扁半身）',
  SM_Env_DesertRuin: '残屋',
  SM_Env_DesertCliff: '崖壁段（旧件）',
  SM_Env_DesertGate: '门（旧件）',
  SM_Env_DesertWall: '墙段（旧件）',
  SM_Env_DesertCaveCeilingRift: '穴顶裂缝岩体（1-4 旧的地下穴方案，已不用）',
  SM_Prop_DesertIncenseBurner: '寺院香炉',
  SM_Prop_DesertStele: '龟趺碑',
  SM_Prop_DesertReliquary: '经函 / 圣物匣（藏宝点）',
  SM_Prop_DesertUrns: '陶罐',
  SM_Decal_DesertCartRuts: '古道车辙贴花',
  SM_Decal_DesertCrackedBed: '龟裂泉床贴花',
};
const AVOID = new Set(['SM_Tripo_DesertColossus', 'SM_Env_DesertCaveCeilingRift']);

if (!process.argv.includes('--report')) {
  const manifest = JSON.parse(readFileSync(new URL('public/assets/manifest.json', ROOT), 'utf8')).assets;
  const ids = Object.keys(manifest).filter(id => /Desert/.test(id) && manifest[id].kind === 'static').sort();
  const lines = ids.map(id => {
    const b = manifest[id].bounds, r = v => Math.round(v * 100) / 100;
    const size = [r(b.max[0] - b.min[0]), r(b.max[1] - b.min[1]), r(b.max[2] - b.min[2])];
    return `  ${id}: { size: [${size.join(', ')}], use: ${JSON.stringify(USE[id] ?? '')}${AVOID.has(id) ? ', avoid: true' : ''} },`;
  });
  const out = `// 自动生成：node scripts/desert/whitebox-assets.mjs —— 别手改；资产有增减就重跑（用途说明在脚本的 USE 表里）。
// 第一章已发布的沙漠美术资产（public/assets/props/<ID>.glb）：白盒体块用 asset 字段对上它们，搭正式场景时直接换件。

export interface WbAsset {
  /** 发布后的包围盒 [宽 x, 高 y, 深 z]（m，正面朝 +Z，轴心在底面中心） */
  size: [number, number, number];
  use: string;
  /** 不要再用的件（题材不对 / 方案已废） */
  avoid?: boolean;
}

export const WB_ASSETS: Record<string, WbAsset> = {
${lines.join('\n')}
};
`;
  writeFileSync(new URL('src/world/desert/whitebox/assets.ts', ROOT), out);
  console.log(`写了 ${ids.length} 件 → src/world/desert/whitebox/assets.ts`);
  process.exit(0);
}

// ───────────── 复用清单 ─────────────
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  if ((typeof rest[0] === 'string' ? rest[0] : rest[0]?.type) === 'ExperimentalWarning') return;
  return emitWarning.call(this, warning, ...rest);
};
registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
      const file = fileURLToPath(new URL(specifier, context.parentURL));
      if (!/\.[cm]?[jt]s$/i.test(file)) for (const candidate of [`${file}.ts`, `${file}/index.ts`]) if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return next(url, context);
  },
});
const { WHITEBOXES, buildTerrain } = await import('../../src/world/desert/whitebox/index.ts');
const { WB_ASSETS } = await import('../../src/world/desert/whitebox/assets.ts');
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
let bad = 0;
for (const [id, spec] of Object.entries(WHITEBOXES)) {
  if (only.length && !only.includes(id)) continue;
  const terrain = buildTerrain(spec);
  const used = new Map(), fresh = new Map(), bare = [];
  /** 同名的几个体块是同一件资产的几个部分（门的两根柱 + 门楣、柜台 + 篷）：只数一次，缩放按整件的顶高算 */
  const parts = new Map();
  for (const b of terrain.blocks) {
    // 露出地面的高度（悬空的顶也从地面算起），加上埋进去的部分
    const tall = b.y1 - terrain.groundAt(b.at[0], b.at[1]) + (b.sink ?? 0);
    if (b.asset) {
      const a = WB_ASSETS[b.asset];
      if (!a) { console.log(`✗ ${id}：体块用了不存在的资产 ${b.asset}`); bad++; continue; }
      if (a.avoid) { console.log(`✗ ${id}：体块用了不该再用的资产 ${b.asset}`); bad++; }
      const e = used.get(b.asset) ?? { count: 0, scales: [] };
      used.set(b.asset, e);
      if (b.name) {
        const key = `${b.asset}|${b.name}`;
        if (!parts.has(key)) e.count++;
        parts.set(key, Math.max(parts.get(key) ?? 0, tall));
      } else {
        e.count++;
        e.scales.push(tall / a.size[1]);
      }
    } else if (b.needs) {
      // 同名的几块（一棵树的干 + 冠）算一件
      const key = b.name ? `${b.needs}|${b.name}` : null;
      if (!key || !parts.has(key)) fresh.set(b.needs, (fresh.get(b.needs) ?? 0) + 1);
      if (key) parts.set(key, 0);
    }
    else bare.push(b);
  }
  for (const [key, tall] of parts) {
    const asset = key.split('|')[0];
    if (!WB_ASSETS[asset]) continue;
    used.get(asset).scales.push(tall / WB_ASSETS[asset].size[1]);
  }
  // 地形图章也可以标资产（雅丹丘、城墙这类用地形做的大件）：缩放按图章的高度算
  let terrainOps = 0;
  for (const o of spec.terrain) {
    if (!o.asset) continue;
    const a = WB_ASSETS[o.asset];
    if (!a) { console.log(`✗ ${id}：地形图章用了不存在的资产 ${o.asset}`); bad++; continue; }
    terrainOps++;
    const e = used.get(o.asset) ?? { count: 0, scales: [] };
    e.count++;
    const h = typeof o.h === 'number' ? o.h : Array.isArray(o.hs) ? Math.max(...o.hs) - Math.min(0, ...o.hs) : Array.isArray(o.h) ? Math.max(...o.h) : a.size[1];
    e.scales.push(h / a.size[1]);
    used.set(o.asset, e);
  }
  const total = terrain.blocks.length + terrainOps, reuse = [...used.values()].reduce((s, e) => s + e.count, 0);
  console.log(`\n## ${id} ${spec.name}：体块和标了资产的地形共 ${total} 件，复用已有资产 ${reuse} 件（${used.size} 种），要新做 ${[...fresh.values()].reduce((s, v) => s + v, 0)} 件（${fresh.size} 种），没标的 ${bare.length} 件`);
  console.log('| 已有资产 | 用途 | 几处 | 体块高 ÷ 资产高 |');
  console.log('|---|---|---|---|');
  for (const [asset, e] of [...used].sort((p, q) => q[1].count - p[1].count)) {
    const lo = Math.min(...e.scales), hi = Math.max(...e.scales);
    const scale = lo === hi ? lo.toFixed(2) : `${lo.toFixed(2)}–${hi.toFixed(2)}`;
    console.log(`| ${asset} | ${WB_ASSETS[asset].use} | ${e.count} | ${scale}${lo < 0.5 || hi > 2 ? ' ⚠ 缩放过大' : ''} |`);
  }
  if (fresh.size) console.log(`要新做：${[...fresh].map(([n, c]) => `${n} ×${c}`).join('；')}`);
  if (bare.length) console.log(`没标资产的体块（${bare.length}）：${bare.slice(0, 12).map(b => `${b.name ?? b.mat}@(${b.at[0]},${b.at[1]})`).join('、')}${bare.length > 12 ? ' …' : ''}`);
}
process.exit(bad ? 1 : 0);
