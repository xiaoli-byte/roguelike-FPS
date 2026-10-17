// Node 模块钩子：让 Node 直接 import 游戏的 TS 源码（离线采样用，不经过 Vite）。
// - resolve：src/ 里的 import 不带扩展名（'../core/math'），依次尝试 .ts / /index.ts；
//   STUBS 里登记的模块（美术挂载等依赖浏览器 / GLB 加载的部分）换成 scripts/unity/stubs/ 下的桩。
// - load：.ts 源码用 Node 自带的 stripTypeScriptTypes（transform 模式，支持 enum / 参数属性）去掉类型。
import { existsSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const STUB_DIR = new URL('./stubs/', import.meta.url);
/** 源码相对 src/ 的路径（不带扩展名）→ 桩文件 */
const STUBS = {
  'assets/EnemyArt': 'EnemyArt.mjs',
  'assets/AssetLibrary': 'AssetLibrary.mjs',
  'ui/heroPreview/heroes/heroShowFx': 'heroShowFx.mjs',
};

export async function resolve(specifier, context, next) {
  const parent = context.parentURL;
  if (parent && parent.endsWith('.ts') && (specifier.startsWith('./') || specifier.startsWith('../'))) {
    const base = new URL(specifier, parent);
    const rel = fileURLToPath(base).replaceAll('\\', '/').split('/src/')[1]?.replace(/\.ts$/, '');
    if (rel && STUBS[rel]) return { url: new URL(STUBS[rel], STUB_DIR).href, shortCircuit: true };
    for (const cand of [base.href, base.href + '.ts', base.href + '/index.ts']) {
      if (/\.(ts|mjs|js|json)$/.test(cand) && existsSync(fileURLToPath(cand))) return { url: cand, shortCircuit: true };
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.ts')) {
    const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url });
    return { format: 'module', source, shortCircuit: true };
  }
  return next(url, context);
}

