// 给 node --test 载入 src/ 下的纯 TS 模块：stripTypeScriptTypes 去类型，相对路径的 import 递归换成 data: URL，'three' 换成本地构建。
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const cache = new Map();

async function load(url) {
  const key = url.href;
  if (cache.has(key)) return cache.get(key);
  const pending = (async () => {
    let source = stripTypeScriptTypes(await readFile(url, 'utf8'), { mode: 'transform' });
    source = source.replaceAll("'three'", `'${threeUrl}'`);
    const specs = [...source.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)].map(m => m[1]);
    for (const spec of new Set(specs)) {
      const dep = new URL(`${spec}.ts`, url);
      source = source.replaceAll(`'${spec}'`, `'${await load(dep)}'`);
    }
    return `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${url.href}`).toString('base64')}`;
  })();
  cache.set(key, pending);
  return pending;
}

/** import('../src/…') 的 TS 版：path 相对 tests/ */
export async function importTs(path) {
  return import(await load(new URL(path, import.meta.url)));
}
