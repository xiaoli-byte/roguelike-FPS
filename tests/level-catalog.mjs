// 测试用：按 src/world/level/catalog.ts 合成关卡清单（形状同原 Unity 导出的 manifest.json：stages[].id / available / pool / url），
// url = assets/levels/<id>/level.json（相对 public/）。2026-11-26 去 Unity 依赖后测试一律走这里，不再读 public/assets/unity-levels。
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const root = new URL('../', import.meta.url);

/** 关卡目录模块（catalog.ts 去掉类型后按 data: URL 载入；它没有 import） */
export async function loadCatalog() {
  const source = await readFile(new URL('src/world/level/catalog.ts', root), 'utf8');
  const js = stripTypeScriptTypes(source, { mode: 'transform' });
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

/** 原 manifest.json 形状的清单 */
export async function levelManifest() {
  const { LEVEL_CATALOG, levelUrl } = await loadCatalog();
  return { schema: 3, stages: LEVEL_CATALOG.map(entry => ({ ...entry, url: entry.available ? levelUrl(entry.id) : undefined })) };
}

/** 一张图的关卡文档（public/assets/levels/<id>/level.json） */
export async function levelDocument(id) {
  return JSON.parse(await readFile(new URL(`public/assets/levels/${id}/level.json`, root), 'utf8'));
}
