// 界面四层与路由（src/ui/toolkit/UILayers.ts、UIRouter.ts，照译 Unity G/UI/Toolkit；docs/threejs-migration.md M11c），
// 以及提示队列（UIToasts：最多 4 条、相同合并 ×N）、FitLabel 的量宽余量、富文本转义。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function moduleFrom(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'), { mode: 'transform' });
  for (const [from, to] of Object.entries(imports)) source = source.replaceAll(`'${from}'`, `'${to}'`);
  return dataModule(source);
}

const layersUrl = await moduleFrom('../src/ui/toolkit/UILayers.ts');
const L = await import(layersUrl);
const R = await import(await moduleFrom('../src/ui/toolkit/UIRouter.ts'));
const fontsUrl = await moduleFrom('../src/ui/toolkit/UIFonts.ts');
const elUrl = await moduleFrom('../src/ui/toolkit/el.ts', { './UIFonts': fontsUrl });
const themeUrl = await moduleFrom('../src/ui/toolkit/UITheme.ts');
const E = await import(elUrl);
const { UIToasts } = await import(await moduleFrom('../src/ui/toolkit/UIToasts.ts', { './el': elUrl, './UIFonts': fontsUrl, './UITheme': themeUrl }));
const Fit = await import(await moduleFrom('../src/ui/toolkit/FitLabel.ts'));

// ───────────── 假 DOM ─────────────

class FakeEl {
  constructor(tag = 'div', rect = { left: 0, top: 0, width: 10, height: 10 }) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.dataset = {};
    this.rect = rect;
    this.tabIndex = tag === 'button' ? 0 : -1;
    this.disabled = false;
    this.clicks = 0;
    this.textContent = '';
    this.className = '';
    const cls = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => cls.add(x)),
      remove: (...c) => c.forEach((x) => cls.delete(x)),
      contains: (c) => cls.has(c),
      toggle: (c, on) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c)),
    };
  }
  get isConnected() {
    return true;
  }
  appendChild(c) {
    c.parentElement?.children.splice(c.parentElement.children.indexOf(c), 1);
    this.children.push(c);
    c.parentElement = this;
    return c;
  }
  append(...cs) {
    for (const c of cs) this.appendChild(c);
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  contains(o) {
    for (let p = o; p; p = p.parentElement) if (p === this) return true;
    return false;
  }
  focus() {
    focused = this;
  }
  blur() {
    if (focused === this) focused = null;
  }
  click() {
    this.clicks++;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  querySelectorAll() {
    const out = [];
    const walk = (e) => {
      for (const c of e.children) {
        if (c.tagName === 'BUTTON' || c.tabIndex >= 0) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

let focused = null;
let clock = 0;
const layers = [new FakeEl(), new FakeEl(), new FakeEl(), new FakeEl()];
const sounds = [];
function makeRouter() {
  focused = null;
  for (const l of layers) l.children.length = 0;
  return new R.ScreenRouter({ layer: (i) => layers[i], focused: () => focused, now: () => clock, sound: (k) => sounds.push(k) });
}

class TestScreen extends R.UIScreen {
  constructor(id, opts = {}) {
    super();
    this.id = id;
    this.opts = opts;
    this.log = [];
    this.buttons = [];
  }
  get blockState() {
    return 'blockState' in this.opts ? this.opts.blockState : 'modal';
  }
  get layer() {
    return this.opts.layer ?? 2;
  }
  build() {
    const r = new FakeEl();
    for (const rect of this.opts.buttons ?? [{ left: 0, top: 0, width: 10, height: 10 }]) {
      const b = new FakeEl('button', rect);
      r.appendChild(b);
      this.buttons.push(b);
    }
    return r;
  }
  onOpen(arg) {
    this.log.push(['open', arg]);
  }
  onClose() {
    this.log.push(['close']);
  }
  onBack() {
    return !!this.opts.keep;
  }
}

// ───────────── 层 ─────────────

test('四层：次序、只有界面层接输入、1920×1080 Expand 缩放', () => {
  assert.deepEqual(L.ALL_LAYERS, [0, 1, 2, 3]);
  assert.deepEqual(L.ALL_LAYERS.map(L.layerName), ['Hud', 'Overlay', 'Modal', 'Toast']);
  assert.deepEqual(L.ALL_LAYERS.map(L.sortingOrder), [0, 100, 200, 300]);
  assert.deepEqual(L.ALL_LAYERS.map(L.interactive), [false, false, true, false]);
  // 16:9 各分辨率的逻辑尺寸都正好 1920×1080
  for (const [w, h] of [[1280, 720], [1366, 768], [1600, 900], [2560, 1440]]) {
    const p = L.panelSize(w, h);
    assert.ok(Math.abs(p.x - 1920) < 1e-6 * 1920 + 3 && Math.abs(p.y - 1080) < 3, `${w}×${h} → ${p.x}×${p.y}`);
  }
  // 16:10 高多出来；窄窗口宽多出来——两边都不小于 1920×1080
  const p1 = L.panelSize(1920, 1200);
  assert.deepEqual([p1.x, p1.y, p1.scale], [1920, 1200, 1]);
  const p2 = L.panelSize(1477, 791);
  assert.ok(p2.x >= 1920 && Math.abs(p2.y - 1080) < 1e-6);
  assert.equal(L.layerScale(0, 0), 1, '零尺寸退回 1');
});

// ───────────── 路由 ─────────────

test('打开 / 关上：栈、挡游戏、重开提到栈顶、事件顺序', () => {
  const r = makeRouter();
  const pause = r.register(new TestScreen('pause', { blockState: 'paused' }));
  const settings = r.register(new TestScreen('settings', { blockState: null }));
  const events = [];
  r.onOpened((s) => events.push('+' + s.id));
  r.onClosed((s) => events.push('-' + s.id));
  assert.equal(r.open('nope'), false);
  assert.equal(r.count, 0);
  assert.ok(r.open('pause', 7));
  assert.deepEqual(pause.log, [['open', 7]]);
  assert.ok(pause.root.classList.contains('sf-screen'), '界面根加上 sf-screen');
  assert.equal(pause.root.parentElement, layers[2], '挂在界面层');
  assert.equal(r.blocking, true);
  assert.equal(r.blockState, 'paused');
  r.open('settings');
  assert.deepEqual(r.ids, ['pause', 'settings']);
  assert.equal(r.top, settings);
  assert.equal(r.blockState, 'paused', '设置页不挡游戏，挡游戏的仍是暂停');
  // 重开暂停：提到栈顶、再调一次 onOpen、DOM 放到层容器最后
  r.open('pause');
  assert.deepEqual(r.ids, ['settings', 'pause']);
  assert.equal(pause.log.length, 2);
  assert.equal(layers[2].children.at(-1), pause.root);
  // 关不在栈顶的
  assert.ok(r.close('settings'));
  assert.equal(settings.root.style.display, 'none');
  assert.equal(settings.root.parentElement, null);
  assert.deepEqual(r.ids, ['pause']);
  assert.equal(r.close('settings'), false);
  r.closeAll();
  assert.equal(r.count, 0);
  assert.equal(r.blocking, false);
  assert.deepEqual(events, ['+pause', '+settings', '+pause', '-settings', '-pause']);
  assert.ok(pause.isOpen === false);
});

test('返回：栈顶先自己处理（onBack），不处理就关掉；关掉栈顶后焦点回到下面界面里原来的元素', () => {
  const r = makeRouter();
  const pause = r.register(new TestScreen('pause', { buttons: [{ left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 40, width: 10, height: 10 }] }));
  const rebinding = r.register(new TestScreen('settings', { blockState: null, keep: true }));
  r.open('pause');
  r.tick(0.016);
  assert.equal(focused, pause.buttons[0], '打开后聚焦第一个可聚焦元素');
  pause.buttons[1].focus();
  r.open('settings');
  r.tick(0.016);
  assert.equal(focused, rebinding.buttons[0]);
  assert.ok(r.back(), '设置页自己处理了返回（改键中）');
  assert.ok(r.isOpen('settings'));
  rebinding.opts.keep = false;
  assert.ok(r.key('Escape', true));
  assert.ok(!r.isOpen('settings'));
  assert.equal(focused, pause.buttons[1], '焦点回到打开设置前的「设置」按钮');
  assert.ok(sounds.includes('back'));
  r.back();
  assert.equal(r.count, 0);
  assert.equal(r.back(), false, '栈空返回 false');
  assert.equal(r.key('Escape', true), false, '栈空时按键不归路由');
});

test('方向键空间导航：前方最近（前进 + 2×横偏），到头绕回；按住 0.4 s 后每 0.11 s 连发；回车激活；滑条左右调值', () => {
  const r = makeRouter();
  // 2×2 网格：A(0,0) B(100,0) / C(0,100) D(100,100)
  const s = r.register(new TestScreen('grid', { buttons: [{ left: 0, top: 0, width: 20, height: 20 }, { left: 100, top: 0, width: 20, height: 20 }, { left: 0, top: 100, width: 20, height: 20 }, { left: 100, top: 100, width: 20, height: 20 }] }));
  r.open('grid');
  r.tick(0);
  const [A, B, C, D] = s.buttons;
  assert.equal(focused, A);
  clock = 10;
  r.key('ArrowRight', true);
  assert.equal(focused, B);
  r.key('ArrowDown', true);
  assert.equal(focused, D);
  r.key('ArrowDown', true);
  assert.equal(focused, B, '到底绕回最上面（同一列）');
  r.key('ArrowDown', false);
  // 按住：0.4 s 内不连发，之后每 0.11 s 一次
  r.key('ArrowLeft', true);
  assert.equal(focused, A);
  clock = 10.3;
  r.tick(0.016);
  assert.equal(focused, A);
  clock = 10.41;
  r.tick(0.016);
  assert.equal(focused, B, '连发一次（左边到头绕回右边）');
  clock = 10.45;
  r.tick(0.016);
  assert.equal(focused, B);
  clock = 10.53;
  r.tick(0.016);
  assert.equal(focused, A);
  r.key('ArrowLeft', false);
  clock = 11;
  r.tick(0.016);
  assert.equal(focused, A, '松开后不再连发');
  // 回车 = 点焦点按钮；禁用的不点
  r.key('Enter', true);
  assert.equal(A.clicks, 1);
  A.disabled = true;
  r.key('Enter', true);
  assert.equal(A.clicks, 1);
  // 滑条：焦点在挂了 sfNudge 的元素上时左右直接调值
  const nudges = [];
  B.sfNudge = (sign) => nudges.push(sign);
  B.focus();
  r.key('ArrowRight', true);
  r.key('ArrowRight', false);
  r.key('ArrowLeft', true);
  assert.deepEqual(nudges, [1, -1]);
  assert.equal(focused, B);
  // 界面自己的按键（设置页 Q / E）
  s.onKey = (code) => code === 'KeyQ';
  assert.equal(r.key('KeyQ', true), true);
  assert.equal(r.key('KeyZ', true), false);
});

test('spatialPick 照 Unity：只看中心点在前方的，取前进 + 2 × 横偏最小；前方没有取反方向最远', () => {
  const rect = (x, y) => ({ left: x - 5, top: y - 5, width: 10, height: 10 });
  const from = rect(0, 0);
  const c = [
    { el: 'near-but-off', rect: rect(30, 40) }, // 30 + 80 = 110
    { el: 'far-in-line', rect: rect(90, 0) }, //   90 + 0 = 90
    { el: 'behind', rect: rect(-50, 0) },
  ];
  assert.equal(R.spatialPick(c, from, 1, 0), 'far-in-line');
  assert.equal(R.spatialPick(c, from, -1, 0), 'behind');
  // 向上（dy = 1）没有候选 → 绕回最下面的
  assert.equal(R.spatialPick(c, from, 0, 1), 'near-but-off');
  assert.equal(R.spatialPick([], from, 1, 0), null);
});

// ───────────── 提示队列 ─────────────

test('提示队列：相同文字合并 ×N、最多 4 条（挤掉最老的）、电影模式整层淡出', () => {
  globalThis.document = { createElement: (tag) => new FakeEl(tag) };
  let now = 0, hidden = false;
  const parent = new FakeEl();
  const t = new UIToasts(parent, () => now, () => hidden);
  t.push('区域肃清');
  t.push('区域肃清');
  t.push('区域肃清', '#ff0000', 5);
  assert.deepEqual(t.texts, ['区域肃清 ×3']);
  for (const s of ['甲', '乙', '丙', '丁']) t.push(s);
  assert.deepEqual(t.texts, ['甲', '乙', '丙', '丁'], '满 4 条挤掉最老的');
  t.push('丁');
  assert.deepEqual(t.texts.at(-1), '丁 ×2');
  t.tick(0);
  // 2.8 s 后自然离场（「丁」合并时刷新了计时）
  now = 2.9;
  t.tick(now);
  assert.equal(t.count, 0);
  t.push('戊');
  hidden = true;
  now = 3.0;
  t.tick(now);
  now = 3.2;
  t.tick(now);
  assert.equal(t.root.style.opacity, '0', '电影模式 0.15 s 内淡完');
  t.clear();
  assert.equal(t.count, 0);
  delete globalThis.document;
});

// ───────────── FitLabel / 富文本 ─────────────

test('FitLabel：余量 = 2 + 字距 × 最长一行字数（富文本去标签）', () => {
  assert.equal(Fit.longestLine('武器伤害 +55%', false), 9);
  assert.equal(Fit.longestLine('一行\n长一些的一行', false), 6);
  assert.equal(Fit.longestLine('<color=#fff>玉碎</color>', true), 2);
  assert.equal(Fit.fitExtra('玉碎', 6), 2 + 12);
  assert.equal(Fit.fitExtra('玉碎', 0), 2);
});

test('富文本：认 color / size / b / i / 换行，其余转义，缺的闭合补上', () => {
  assert.equal(E.richToHtml('<color=#ffd98a>1-1 · 完成</color>\n<size=34>用时</size>'), '<span style="color:#ffd98a">1-1 · 完成</span><br><span style="font-size:34px">用时</span>');
  assert.equal(E.richToHtml('<b>粗<i>斜'), '<b>粗<i>斜</i></b>');
  assert.equal(E.richToHtml('<script>x</script> & "q"'), '&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;');
  assert.equal(E.richToHtml('<color=red;x:y>坏</color>'), '坏', '颜色参数不合法时丢掉标签');
  assert.equal(E.formatNum(1280), '1,280');
  assert.equal(E.formatNum(-1234567), '-1,234,567');
  assert.equal(E.cooldownText(3.2), '4');
  assert.equal(E.cooldownText(0.42), '0.5');
  assert.equal(E.cooldownText(0), '');
});
