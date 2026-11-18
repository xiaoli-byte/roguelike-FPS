// USS → CSS 转换（scripts/web/convert-uss.mjs，docs/threejs-migration.md M11c）：-unity-* 属性映射、:root → .sf-root、
// 转不了的属性留注释并报出来；仓库里生成的 src/ui/css/unity/*.css 必须是当前 USS 转出来的（同 --check）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { FILES, MAPPED, UNSUPPORTED, convertUss, indexCss, mapDecl, mapSelector, parseUss } from '../scripts/web/convert-uss.mjs';

const root = new URL('../', import.meta.url);
const decls = (css) => Object.fromEntries([...css.matchAll(/^\s+([-\w]+): ([^;]+);$/gm)].map((m) => [m[1], m[2]]));

test('-unity-text-align 拆成横向 text-align + 纵向 flex 对齐（看本规则的 flex-direction）', () => {
  assert.deepEqual(mapDecl('-unity-text-align', 'middle-center'), [['text-align', 'center'], ['justify-content', 'center']]);
  assert.deepEqual(mapDecl('-unity-text-align', 'lower-right'), [['text-align', 'right'], ['justify-content', 'flex-end']]);
  assert.deepEqual(mapDecl('-unity-text-align', 'upper-left'), [['text-align', 'left'], ['justify-content', 'flex-start']]);
  // 横向 flex（按钮）：上下归 align-items，左右归 justify-content
  const row = [{ prop: 'flex-direction', value: 'row' }];
  assert.deepEqual(mapDecl('-unity-text-align', 'middle-left', row), [['text-align', 'left'], ['align-items', 'center'], ['justify-content', 'flex-start']]);
  // 规则里显式写了的不覆盖
  const explicit = [{ prop: 'flex-direction', value: 'row' }, { prop: 'align-items', value: 'flex-start' }, { prop: 'justify-content', value: 'center' }];
  assert.deepEqual(mapDecl('-unity-text-align', 'middle-center', explicit), [['text-align', 'center']]);
  assert.ok(!Array.isArray(mapDecl('-unity-text-align', 'center')), '不认识的对齐算转不了');
});

test('描边、字体、字形、图标染色、背景缩放、white-space、缓动', () => {
  assert.deepEqual(mapDecl('-unity-text-outline-width', '1.2px'), [['-webkit-text-stroke-width', '2.4px'], ['paint-order', 'stroke fill']]);
  assert.deepEqual(mapDecl('-unity-text-outline-color', 'rgba(0, 0, 0, 0.8)'), [['-webkit-text-stroke-color', 'rgba(0, 0, 0, 0.8)']]);
  assert.deepEqual(mapDecl('-unity-text-outline', '1px #000'), [['-webkit-text-stroke-width', '2px'], ['-webkit-text-stroke-color', '#000'], ['paint-order', 'stroke fill']]);
  assert.deepEqual(mapDecl('-unity-font-definition', 'resource("UI/Fonts/SDF/Title")'), [['font-family', 'var(--sf-font-title)'], ['line-height', '1.3']]);
  assert.deepEqual(mapDecl('-unity-font-definition', 'resource("UI/Fonts/SDF/Number")'), [['font-family', 'var(--sf-font-num)'], ['line-height', '1.15']]);
  assert.deepEqual(mapDecl('-unity-font-definition', 'resource("UI/Fonts/SDF/Body")'), [['font-family', 'var(--sf-font-body)'], ['line-height', '1.5']]);
  assert.ok(!Array.isArray(mapDecl('-unity-font-definition', 'resource("UI/Fonts/SDF/Nope")')));
  assert.deepEqual(mapDecl('-unity-font-style', 'bold'), [['font-weight', '700'], ['font-style', 'normal']]);
  assert.deepEqual(mapDecl('-unity-font-style', 'bold-and-italic'), [['font-weight', '700'], ['font-style', 'italic']]);
  assert.deepEqual(mapDecl('-unity-background-image-tint-color', '#e8b64a'), [['--sf-tint', '#e8b64a']]);
  assert.deepEqual(mapDecl('-unity-background-scale-mode', 'scale-to-fit'), [['background-size', 'contain'], ['background-position', 'center'], ['background-repeat', 'no-repeat']]);
  assert.deepEqual(mapDecl('white-space', 'nowrap'), [['text-wrap-mode', 'nowrap']]);
  assert.deepEqual(mapDecl('white-space', 'normal'), [['text-wrap-mode', 'wrap']]);
  assert.deepEqual(mapDecl('white-space', 'pre-wrap'), [['white-space-collapse', 'preserve'], ['text-wrap-mode', 'wrap']]);
  assert.deepEqual(mapDecl('transition-timing-function', 'ease-out-cubic'), [['transition-timing-function', 'cubic-bezier(0.33, 1, 0.68, 1)']]);
  assert.ok(!Array.isArray(mapDecl('transition-timing-function', 'ease-out-elastic')), '弹性缓动没有三次贝塞尔等价');
  // 标准属性原样
  assert.deepEqual(mapDecl('translate', '-50% 0'), [['translate', '-50% 0']]);
  assert.deepEqual(mapDecl('scale', '-1 1'), [['scale', '-1 1']]);
});

test('转不了的属性：表里有原因、表外的 -unity-* 也报出来，生成的 CSS 留注释', () => {
  const r = mapDecl('-unity-paragraph-spacing', '4px');
  assert.equal(r.unsupported, UNSUPPORTED['-unity-paragraph-spacing']);
  assert.match(mapDecl('-unity-something-new', '1').unsupported, /没有登记/);
  const out = convertUss(':root {\n  --ink: #000;\n  -unity-paragraph-spacing: 4px;\n  color: var(--ink);\n}\n.a:hover > .b, .c { -unity-text-align: middle-center; }', 't');
  assert.equal(out.unsupported.length, 1);
  assert.equal(out.unsupported[0].line, 3);
  assert.match(out.css, /^\.sf-root \{$/m);
  assert.match(out.css, /\/\* USS -unity-paragraph-spacing: 4px（转不了：/);
  assert.match(out.css, /^\.a:hover > \.b,\n\.c \{$/m);
  assert.equal(mapSelector(':root'), '.sf-root');
  assert.equal(mapSelector('.x:focus .y'), '.x:focus .y');
  // 每个登记过的映射都真能转
  for (const p of Object.keys(MAPPED)) assert.ok(p.startsWith('-unity-') || p === 'transition-timing-function' || p === 'white-space');
  assert.throws(() => parseUss('.a { color: red;'), /没有闭合/);
  assert.throws(() => parseUss('.a { color red; }'), /看不懂/);
});

test('仓库里的 src/ui/css/unity/*.css 是当前 USS 转出来的（= convert-uss.mjs --check）', () => {
  let unsupported = 0, rules = 0;
  for (const f of FILES) {
    const src = readFileSync(new URL(`unity/Assets/Game/Resources/UI/${f}.uss`, root), 'utf8');
    const out = convertUss(src, f);
    const path = new URL(`src/ui/css/unity/${f}.css`, root);
    assert.ok(existsSync(path), `${f}.css 没有生成`);
    assert.equal(readFileSync(path, 'utf8'), out.css, `${f}.css 不是最新的（跑 node scripts/web/convert-uss.mjs）`);
    unsupported += out.unsupported.length;
    rules += out.rules;
  }
  assert.equal(readFileSync(new URL('src/ui/css/unity/index.css', root), 'utf8'), indexCss());
  assert.ok(rules > 700, `规则数 ${rules}`);
  // 现在 9 份 USS 里转不了的只有 theme 的段间距
  assert.equal(unsupported, 1);
  // 关键样式照 Unity：HUD 武器弹匣 54 号数字、右下对齐
  const hud = readFileSync(new URL('src/ui/css/unity/hud.css', root), 'utf8');
  const mag = hud.slice(hud.indexOf('.sf-weapon__mag {'), hud.indexOf('}', hud.indexOf('.sf-weapon__mag {')));
  assert.deepEqual({ size: decls(mag)['font-size'], align: decls(mag)['text-align'], v: decls(mag)['justify-content'] }, { size: '54px', align: 'right', v: 'flex-end' });
  // 打包字体已发布（publish_fonts.py）
  const fonts = JSON.parse(readFileSync(new URL('public/assets/fonts/fonts.json', root), 'utf8'));
  assert.deepEqual(fonts.fonts.map((x) => x.family), ['SF Body', 'SF Body Ext', 'SF Title', 'SF Number']);
  for (const x of fonts.fonts) assert.ok(existsSync(new URL(`public/assets/fonts/${x.file}`, root)), x.file);
  const css = readFileSync(new URL('src/ui/css/sf-fonts.css', root), 'utf8');
  for (const x of fonts.fonts) assert.match(css, new RegExp(`font-family: "${x.family}";\\n  src: url\\("/assets/fonts/${x.file}"\\)`));
});
