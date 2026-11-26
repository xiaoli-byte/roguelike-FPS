// 界面样式（src/ui/css/screens/*.css，手写；2026-11 前由 Unity 的 USS 转出，转换脚本已随 Unity 退役）与打包字体的发布清单。
// 文件名沿用旧的 uss-convert（package.json 的测试列表认这个名字）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const lf = (s) => s.replace(/\r\n/g, '\n');
const decls = (css) => Object.fromEntries([...css.matchAll(/^\s+([-\w]+): ([^;]+);$/gm)].map((m) => [m[1], m[2]]));
const SCREENS = ['theme', 'hud', 'menu', 'screens', 'dialog', 'map', 'codex', 'scrolls', 'stagecard'];

test('界面样式：screens/index.css 按 theme 在前的顺序引入全部九份，styles.css 引入 screens/index.css', () => {
  const index = lf(readFileSync(new URL('src/ui/css/screens/index.css', root), 'utf8'));
  assert.deepEqual([...index.matchAll(/@import '\.\/(\w+)\.css';/g)].map((m) => m[1]), SCREENS);
  for (const f of SCREENS) assert.ok(existsSync(new URL(`src/ui/css/screens/${f}.css`, root)), `${f}.css`);
  const styles = lf(readFileSync(new URL('src/ui/styles.css', root), 'utf8'));
  assert.match(styles, /@import '\.\/css\/screens\/index\.css';/);
  assert.ok(!existsSync(new URL('src/ui/css/unity', root)), '旧目录 css/unity 已改名 css/screens');
});

test('关键样式：HUD 武器弹匣 54 号数字、右下对齐；设置页滑条用 sf-slider__* 类', () => {
  const hud = readFileSync(new URL('src/ui/css/screens/hud.css', root), 'utf8');
  const mag = hud.slice(hud.indexOf('.sf-weapon__mag {'), hud.indexOf('}', hud.indexOf('.sf-weapon__mag {')));
  assert.deepEqual({ size: decls(mag)['font-size'], align: decls(mag)['text-align'], v: decls(mag)['justify-content'] }, { size: '54px', align: 'right', v: 'flex-end' });
  // 滑条：元素结构（SettingsScreen 的 Slider）和两处样式（sf-base 的几何、screens.css 的颜色）用同一套类名
  const settings = readFileSync(new URL('src/ui/screens/SettingsScreen.ts', root), 'utf8');
  for (const part of ['drag-container', 'tracker', 'dragger']) assert.ok(settings.includes(`'sf-slider__${part}'`), part);
  const base = readFileSync(new URL('src/ui/css/sf-base.css', root), 'utf8');
  const screens = readFileSync(new URL('src/ui/css/screens/screens.css', root), 'utf8');
  for (const part of ['tracker', 'dragger']) {
    assert.ok(base.includes(`.sf-slider__${part}`), `sf-base ${part}`);
    assert.ok(screens.includes(`.sf-slider .sf-slider__${part}`), `screens ${part}`);
  }
  for (const f of readdirSync(new URL('src/ui/css/screens/', root))) {
    assert.doesNotMatch(readFileSync(new URL(`src/ui/css/screens/${f}`, root), 'utf8'), /unity-base-slider/, f);
  }
});

test('打包字体已发布（scripts/web/fonts.py）：清单里的四个字族都有文件，sf-fonts.css 一一声明', () => {
  const fonts = JSON.parse(readFileSync(new URL('public/assets/fonts/fonts.json', root), 'utf8'));
  assert.deepEqual(fonts.fonts.map((x) => x.family), ['SF Body', 'SF Body Ext', 'SF Title', 'SF Number']);
  for (const x of fonts.fonts) assert.ok(existsSync(new URL(`public/assets/fonts/${x.file}`, root)), x.file);
  const css = lf(readFileSync(new URL('src/ui/css/sf-fonts.css', root), 'utf8'));
  for (const x of fonts.fonts) assert.match(css, new RegExp(`font-family: "${x.family}";\\n  src: url\\("/assets/fonts/${x.file}"\\)`));
});
