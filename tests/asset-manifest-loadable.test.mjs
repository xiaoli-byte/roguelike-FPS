// 清单里的每个 GLB 都要能被 AssetLibrary 认出来：它只认名字以 _LOD<n> 结尾的 THREE.Mesh（src/assets/AssetLibrary.ts）。
// 一个 glTF mesh 有多个图元（多个材质）时，GLTFLoader 把它拆成 Group + 子网格，节点名落在 Group 上，资产库就找不到网格，
// 运行时悄悄退回程序化模型——发布了等于没发布。这里按 GLB 的 JSON 查：要有一个 _LOD0 节点，挂的 mesh 只有一个图元。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('public/assets/manifest.json', root), 'utf8')).assets;

/**
 * 已知加载不了、运行时退回程序化模型的条目（2026-11-25 实测控制台报「GLB 里没有按 _LOD<n> 命名的网格」）。
 * 修好一条就从这里删掉；新出现的不许进来，先修资产。
 */
const KNOWN_UNLOADABLE = {
  SM_Weapon_BoneDragon: '手工发布（build_bone_dragon.py 直出），70 个部件节点，没有 _LOD0 网格；运行时退回程序化火炮',
  SK_Weapon_Gunfire1301: 'LOD0 有 2 个图元（两个材质），GLTFLoader 拆成 Group；运行时退回程序化霰弹枪',
};

async function glbJson(url) {
  const bytes = await readFile(new URL(`public/${url}`, root));
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
}

/** 能当 LOD0 用的节点：名字以 _LOD0 结尾、挂一个只有一个图元的 mesh */
function hasLoadableLod0(json) {
  return (json.nodes ?? []).some((n) => /_LOD0$/.test(n.name ?? '') && n.mesh != null && json.meshes[n.mesh].primitives.length === 1);
}

test('every manifest GLB exposes a single-primitive _LOD0 mesh (AssetLibrary contract)', async () => {
  const broken = [];
  for (const [id, entry] of Object.entries(manifest)) {
    for (const url of [entry.url, entry.hiUrl].filter(Boolean)) {
      if (!hasLoadableLod0(await glbJson(url))) broken.push(id);
    }
  }
  assert.deepEqual([...new Set(broken)].sort(), Object.keys(KNOWN_UNLOADABLE).sort(),
    '加载不了的资产变了：新出现的先修资产（单图元、命名 <资产ID>_LOD0），修好的从 KNOWN_UNLOADABLE 删掉');
});
