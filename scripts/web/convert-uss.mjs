// Unity UI Toolkit 样式（USS）→ 网页 CSS（docs/threejs-migration.md M11c）。
// Unity 的界面样式是规格：unity/Assets/Game/Resources/UI/*.uss 原样转成 src/ui/css/unity/*.css，网页界面（src/ui/toolkit、hud、screens）
// 搭和 Unity 一样的元素树、一样的 sf-* 类名，直接吃这些样式。改样式改 USS 再重跑本脚本，不要手改生成的 CSS。
//
//   node scripts/web/convert-uss.mjs            转换（只写有变化的文件）
//   node scripts/web/convert-uss.mjs --check    只核对生成的 CSS 是不是由当前 USS 转出来的（不写），不一致退出码 1
//   --unity <目录>   Unity 工程目录（默认本仓库的 unity/）
//
// 输出：src/ui/css/unity/<名字>.css（每份 USS 一份）+ index.css（按 FILES 的顺序 @import：theme 在最前，
// 对应 Unity 里 theme.uss 挂在层根、其余挂在更深的容器上——UI Toolkit 里离元素近的样式表优先，网页靠后导入的优先）。
//
// UI Toolkit 与浏览器的差异分两类：
//   1. 基准重置（UI Toolkit 默认每个元素都是纵向 flex、border-box、最小尺寸 0、没有行高……）不在这里，
//      手写在 src/ui/css/sf-base.css（:where(.sf-root …) 零优先级，生成的类规则总能盖过它）。
//   2. 属性映射在本文件：MAPPED 里的 -unity-* 属性换成等价 CSS；UNSUPPORTED 里的转不了，生成的 CSS 里留一行注释，
//      运行时没有对应效果（原因写在表里）。遇到两张表都没有的 -unity-* 属性也按「转不了」处理并在输出里报出来。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 转换顺序 = index.css 的导入顺序（theme 最前） */
export const FILES = ['theme', 'hud', 'menu', 'screens', 'dialog', 'map', 'codex', 'scrolls', 'stagecard'];

/** USS 里的 :root = UIRoot 给每一层建的根元素（挂主题样式表的那一个）；网页的层根带 .sf-root */
export const ROOT_SELECTOR = '.sf-root';

/**
 * -unity-font-definition: resource("UI/Fonts/SDF/<名>") → 字体角色（UIFonts：正文 / 标题 / 数字）的 CSS 变量 + 行高。
 * UI Toolkit 没有 line-height：行高写在字体资产里（UIFonts.SpecOf：正文 1.5、标题 1.3、数字 1.15），换字体就换行高
 */
export const FONT_RESOURCES = {
  'UI/Fonts/SDF/Body': ['var(--sf-font-body)', '1.5'],
  'UI/Fonts/SDF/BodyExt': ['var(--sf-font-body)', '1.5'],
  'UI/Fonts/SDF/Title': ['var(--sf-font-title)', '1.3'],
  'UI/Fonts/SDF/Number': ['var(--sf-font-num)', '1.15'],
};

/** UI Toolkit 的缓动名 → cubic-bezier（easings.net 的同名曲线）；elastic / bounce 没有三次贝塞尔等价，按 UNSUPPORTED 处理 */
export const EASINGS = {
  ease: 'ease', 'ease-in': 'ease-in', 'ease-out': 'ease-out', 'ease-in-out': 'ease-in-out', linear: 'linear',
  'ease-in-sine': 'cubic-bezier(0.12, 0, 0.39, 0)', 'ease-out-sine': 'cubic-bezier(0.61, 1, 0.88, 1)', 'ease-in-out-sine': 'cubic-bezier(0.37, 0, 0.63, 1)',
  'ease-in-cubic': 'cubic-bezier(0.32, 0, 0.67, 0)', 'ease-out-cubic': 'cubic-bezier(0.33, 1, 0.68, 1)', 'ease-in-out-cubic': 'cubic-bezier(0.65, 0, 0.35, 1)',
  'ease-in-circ': 'cubic-bezier(0.55, 0, 1, 0.45)', 'ease-out-circ': 'cubic-bezier(0, 0.55, 0.45, 1)', 'ease-in-out-circ': 'cubic-bezier(0.85, 0, 0.15, 1)',
  'ease-in-back': 'cubic-bezier(0.36, 0, 0.66, -0.56)', 'ease-out-back': 'cubic-bezier(0.34, 1.56, 0.64, 1)', 'ease-in-out-back': 'cubic-bezier(0.68, -0.6, 0.32, 1.6)',
};

/** 有等价 CSS 的 -unity-* 属性（实现见 mapDecl） */
export const MAPPED = {
  '-unity-font-definition': 'font-family: var(--sf-font-*)（字体角色变量，sf-base.css 里定义回退链）+ 该字体的行高',
  '-unity-font': 'font-family（同上）',
  '-unity-font-style': 'font-weight / font-style（bold 由浏览器合成粗体，同 SDF 字体的加粗）',
  '-unity-text-align': 'text-align（横向）+ justify-content / align-items（纵向：UI Toolkit 文字在元素框内对齐，网页标签是 flex 容器）',
  '-unity-text-outline-width': '-webkit-text-stroke-width × 2 + paint-order: stroke fill（描边画在字后面，只露出外侧一半，宽度同 SDF 外描边）',
  '-unity-text-outline-color': '-webkit-text-stroke-color',
  '-unity-text-outline': '-webkit-text-stroke（同上两条）',
  '-unity-background-image-tint-color': '--sf-tint（图标是内联 SVG，用 currentColor 上色：.sf-icon { color: var(--sf-tint) }）',
  '-unity-background-scale-mode': 'background-size: 100% 100% / cover / contain',
  '-unity-word-spacing': 'word-spacing',
  'white-space': 'text-wrap-mode（+ white-space-collapse）：UI Toolkit 的 \n 在任何 white-space 下都换行，网页层根设 white-space-collapse: preserve-breaks，这里只换「能不能自动折行」',
  'transition-timing-function': 'UI Toolkit 缓动名 → cubic-bezier（EASINGS）',
};

/** 转不了的属性：网页没有对应效果，生成的 CSS 里留注释 */
export const UNSUPPORTED = {
  '-unity-paragraph-spacing': '浏览器没有段间距属性；只在 theme 的层根上设过 4px，界面里的多段文字都是单段（\\n 换行），看不出差别',
  '-unity-overflow-clip-box': '浏览器的 overflow 总是按内边距框裁剪',
  '-unity-slice-left': '九宫格贴图要用 border-image 另写；USS 里没有用到',
  '-unity-slice-right': '同上',
  '-unity-slice-top': '同上',
  '-unity-slice-bottom': '同上',
  '-unity-slice-scale': '同上',
  '-unity-text-overflow-position': '浏览器的省略号只能在末尾',
  '-unity-text-generator': '字形生成器（标准 / 高级）是 UI Toolkit 的渲染选项',
  '-unity-editor-text-rendering-mode': '编辑器专用（SDF / 位图）',
  '-unity-text-auto-size': 'CSS 没有按框自动调字号；需要的界面在代码里算',
};

const isUnityProp = p => p.startsWith('-unity-');

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''));
}

/** 解析 USS：返回 [{ selectors: string[], decls: [{ prop, value, line }], line }] */
export function parseUss(source) {
  const src = stripComments(source.replace(/\r\n?/g, '\n'));
  const rules = [];
  let i = 0;
  const lineAt = pos => src.slice(0, pos).split('\n').length;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) {
      if (src.slice(i).trim()) throw new Error(`第 ${lineAt(i)} 行之后有不完整的规则`);
      break;
    }
    const close = src.indexOf('}', open);
    if (close < 0) throw new Error(`第 ${lineAt(open)} 行的规则没有闭合`);
    const head = src.slice(i, open);
    const selectorText = head.trim().replace(/\s+/g, ' ');
    if (!selectorText) throw new Error(`第 ${lineAt(open)} 行的规则没有选择器`);
    const selectors = selectorText.split(',').map(s => s.trim()).filter(Boolean);
    const body = src.slice(open + 1, close);
    const decls = [];
    let offset = open + 1;
    for (const raw of body.split(';')) {
      const at = offset + (raw.length - raw.trimStart().length);
      offset += raw.length + 1;
      const t = raw.trim();
      if (!t) continue;
      const colon = t.indexOf(':');
      if (colon <= 0) throw new Error(`第 ${lineAt(at)} 行：看不懂的声明「${t}」`);
      decls.push({ prop: t.slice(0, colon).trim(), value: t.slice(colon + 1).trim().replace(/\s+/g, ' '), line: lineAt(at) });
    }
    rules.push({ selectors, decls, line: lineAt(open - head.length + (head.length - head.trimStart().length)) });
    i = close + 1;
  }
  return rules;
}

/** 选择器：:root → .sf-root；其余（类、子代 >、后代、:hover / :focus / :active / :disabled）浏览器同义 */
export function mapSelector(sel) {
  return sel.replace(/(^|[\s>,(])\:root\b/g, `$1${ROOT_SELECTOR}`).replace(/^:root\b/, ROOT_SELECTOR);
}

const doubleLength = v => {
  const m = /^(-?\d*\.?\d+)(px)?$/.exec(v.trim());
  if (!m) return `calc(${v} * 2)`;
  const n = Number(m[1]) * 2;
  return `${Number.isInteger(n) ? n : +n.toFixed(4)}px`;
};

function fontFamily(value) {
  const m = /^resource\(\s*"?([^")]+)"?\s*\)$/.exec(value) || /^url\(\s*"?([^")]+)"?\s*\)$/.exec(value);
  if (!m) return null;
  const path = m[1].replace(/^project:\/+/, '').replace(/^.*Resources\//, '').replace(/\.(asset|ttf|otf)$/i, '');
  return FONT_RESOURCES[path] ?? null;
}

const TEXT_ALIGN = /^(upper|middle|lower)-(left|center|right)$/;
const V_FLEX = { upper: 'flex-start', middle: 'center', lower: 'flex-end' };

/**
 * 一条声明 → CSS 声明列表；转不了返回 { unsupported: 原因 }。
 * rule = 同一规则里的全部声明（-unity-text-align 要看本规则的 flex-direction、有没有显式写 justify-content / align-items）
 */
export function mapDecl(prop, value, rule = []) {
  const has = p => rule.some(d => d.prop === p);
  switch (prop) {
    case '-unity-font-definition':
    case '-unity-font': {
      const f = fontFamily(value);
      return f ? [['font-family', f[0]], ['line-height', f[1]]] : { unsupported: `不认识的字体资源 ${value}（FONT_RESOURCES 里加一条）` };
    }
    case '-unity-font-style': {
      const v = value.toLowerCase();
      const bold = v === 'bold' || v === 'bold-and-italic', italic = v === 'italic' || v === 'bold-and-italic';
      if (!['normal', 'bold', 'italic', 'bold-and-italic'].includes(v)) return { unsupported: `不认识的字形 ${value}` };
      return [['font-weight', bold ? '700' : '400'], ['font-style', italic ? 'italic' : 'normal']];
    }
    case '-unity-text-align': {
      const m = TEXT_ALIGN.exec(value.trim());
      if (!m) return { unsupported: `不认识的对齐 ${value}` };
      const out = [['text-align', m[2]]];
      const row = rule.some(d => d.prop === 'flex-direction' && /^row/.test(d.value));
      // 文字是 flex 容器里的匿名项：纵向 flex 用 justify-content 管上下；横向 flex 用 align-items 管上下
      const vProp = row ? 'align-items' : 'justify-content';
      if (!has(vProp)) out.push([vProp, V_FLEX[m[1]]]);
      if (row && !has('justify-content')) out.push(['justify-content', m[2] === 'left' ? 'flex-start' : m[2] === 'right' ? 'flex-end' : 'center']);
      return out;
    }
    case '-unity-text-outline-width':
      return [['-webkit-text-stroke-width', doubleLength(value)], ['paint-order', 'stroke fill']];
    case '-unity-text-outline-color':
      return [['-webkit-text-stroke-color', value]];
    case '-unity-text-outline': {
      const m = /^(\S+)\s+(.+)$/.exec(value.trim());
      if (!m) return [['-webkit-text-stroke-width', doubleLength(value)], ['paint-order', 'stroke fill']];
      return [['-webkit-text-stroke-width', doubleLength(m[1])], ['-webkit-text-stroke-color', m[2]], ['paint-order', 'stroke fill']];
    }
    case '-unity-background-image-tint-color':
      return [['--sf-tint', value]];
    case '-unity-background-scale-mode': {
      const size = { 'stretch-to-fill': '100% 100%', 'scale-and-crop': 'cover', 'scale-to-fit': 'contain' }[value.trim()];
      if (!size) return { unsupported: `不认识的缩放模式 ${value}` };
      return [['background-size', size], ['background-position', 'center'], ['background-repeat', 'no-repeat']];
    }
    case '-unity-word-spacing':
      return [['word-spacing', value]];
    case 'white-space': {
      const v = value.trim();
      if (v === 'nowrap') return [['text-wrap-mode', 'nowrap']];
      if (v === 'normal') return [['text-wrap-mode', 'wrap']];
      if (v === 'pre-wrap') return [['white-space-collapse', 'preserve'], ['text-wrap-mode', 'wrap']];
      if (v === 'pre') return [['white-space-collapse', 'preserve'], ['text-wrap-mode', 'nowrap']];
      return { unsupported: `不认识的 white-space ${value}` };
    }
    case 'transition-timing-function': {
      const parts = value.split(',').map(s => s.trim());
      const mapped = parts.map(p => EASINGS[p]);
      if (mapped.some(m => !m)) return { unsupported: `没有等价曲线的缓动 ${value}（EASINGS 里加一条）` };
      return [['transition-timing-function', mapped.join(', ')]];
    }
    default:
      if (isUnityProp(prop)) return { unsupported: UNSUPPORTED[prop] ?? '没有登记的 -unity-* 属性（加进 MAPPED 或 UNSUPPORTED）' };
      return [[prop, value]];
  }
}

/** 一份 USS → { css, unsupported: [{ line, prop, value, reason }] } */
export function convertUss(source, name = 'uss') {
  const rules = parseUss(source);
  const unsupported = [];
  const out = [];
  out.push(`/*`);
  out.push(` * 由 scripts/web/convert-uss.mjs 从 unity/Assets/Game/Resources/UI/${name}.uss 生成，不要手改（改 USS 后重跑脚本）。`);
  out.push(` * :root → ${ROOT_SELECTOR}（层根）；-unity-* 属性按脚本里的 MAPPED 表换成等价 CSS，UNSUPPORTED 表里的留注释。`);
  out.push(` */`);
  for (const r of rules) {
    out.push('');
    out.push(`${r.selectors.map(mapSelector).join(',\n')} {`);
    for (const d of r.decls) {
      const m = mapDecl(d.prop, d.value, r.decls);
      if (!Array.isArray(m)) {
        unsupported.push({ file: name, line: d.line, prop: d.prop, value: d.value, reason: m.unsupported });
        out.push(`    /* USS ${d.prop}: ${d.value}（转不了：${m.unsupported.replace(/\*\//g, '* /')}） */`);
        continue;
      }
      for (const [p, v] of m) out.push(`    ${p}: ${v};`);
    }
    out.push('}');
  }
  return { css: out.join('\n') + '\n', unsupported, rules: rules.length };
}

export function indexCss(files = FILES) {
  return [
    '/* 由 scripts/web/convert-uss.mjs 生成：Unity UI Toolkit 样式（theme 在最前，对应 Unity 里挂在层根；其余挂在更深的容器上、优先级更高） */',
    ...files.map(f => `@import './${f}.css';`),
    '',
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const unityArg = args.indexOf('--unity');
  const UNITY = resolve(unityArg >= 0 ? args[unityArg + 1] : join(ROOT, 'unity'));
  const SRC = join(UNITY, 'Assets/Game/Resources/UI');
  const OUT = join(ROOT, 'src/ui/css/unity');
  const rel = p => relative(ROOT, p).replace(/\\/g, '/');
  const outputs = [];
  const allUnsupported = [];
  let ruleCount = 0;
  for (const f of FILES) {
    const path = join(SRC, `${f}.uss`);
    if (!existsSync(path)) throw new Error(`找不到 ${rel(path)}`);
    const text = readFileSync(path, 'utf8');
    if (text.startsWith('%TSD-Header')) throw new Error(`${rel(path)} 是 DLP 密文：先跑 node scripts/unity/dlp-unity-fix.mjs`);
    const { css, unsupported, rules } = convertUss(text, f);
    ruleCount += rules;
    allUnsupported.push(...unsupported);
    outputs.push([join(OUT, `${f}.css`), css]);
  }
  outputs.push([join(OUT, 'index.css'), indexCss()]);

  const stale = [];
  for (const [path, css] of outputs) {
    const cur = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (cur === css) continue;
    stale.push(rel(path));
    if (!check) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, css);
    }
  }
  console.log(`USS → CSS：${FILES.length} 份、${ruleCount} 条规则${check ? '（只核对）' : ''}`);
  if (allUnsupported.length) {
    console.log(`转不了的属性 ${allUnsupported.length} 处（生成的 CSS 里留了注释）：`);
    for (const u of allUnsupported) console.log(`  ${u.file}.uss:${u.line}  ${u.prop}: ${u.value}  —— ${u.reason}`);
  }
  if (check) {
    if (stale.length) {
      console.error(`生成的 CSS 和 USS 对不上（跑 node scripts/web/convert-uss.mjs）：\n  ${stale.join('\n  ')}`);
      process.exit(1);
    }
    console.log('生成的 CSS 是最新的');
  } else console.log(stale.length ? `写了 ${stale.length} 个文件：\n  ${stale.join('\n  ')}` : '没有变化');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
