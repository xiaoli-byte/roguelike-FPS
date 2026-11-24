// M10 碎刃第一人称对照（Unity Weapons/DemonBlade/BladeSwing.cs、BladeView.cs、BladeTrail.cs、BladeGlints.cs、BladeSwordSign.cs、BladeShards.cs、
// DemonBladeController.cs、Fx/FxTrail.cs、Fx/Presets/BladeTrail.cs → 网页 src/weapons/demonBlade/BladeView.ts、BladeTrail.ts、BladeGlints.ts、
// BladeSwordSign.ts、BladeSwarm.ts、DemonBlade.ts）。关键帧 / 常数从 C# 源码读出来比（Unity 相机空间 z 朝前，读入时取反）；
// 行为断言照 Unity EditMode 的 BladeFirstPersonTests（判定帧事件、构图约束、伸刃时间线、刀光、剑指、碎片交接）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return data(stripTypeScriptTypes(source, { mode: 'transform' }));
}
const cs = path => readFile(new URL(`../unity/Assets/Game/Scripts/${path}`, import.meta.url), 'utf8');
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg ?? ''} ${a} ≠ ${b}`);
const num = s => Number(String(s).trim().replace(/f$/, ''));

const mathUrl = await ts('../src/core/math.ts');
const shapeUrl = await ts('../src/weapons/demonBlade/BladeShape.ts');
const SHAPE = await import(shapeUrl);
const defsUrl = await ts('../src/weapons/WeaponDefs.ts');
const { getWeaponDef } = await import(defsUrl);
const TRAIL = await import(await ts('../src/weapons/demonBlade/BladeTrail.ts'));
const SIGN = await import(await ts('../src/weapons/demonBlade/BladeSwordSign.ts'));
const GLINTS = await import(await ts('../src/weapons/demonBlade/BladeGlints.ts'));
const modelStub = data(`
import * as THREE from '${threeUrl}';
export const BLADE_PURPLE = 0x9a5cff;
export const GRIP_Y = -0.085;
export function buildDemonBlade() {
  const root = new THREE.Group(); const frame = new THREE.Group(); root.add(frame); const tip = new THREE.Object3D(); frame.add(tip);
  const shown = new Array(128).fill(true), scale = new Array(128).fill(1), glow = new Array(128).fill(0);
  return {
    root, frame, tip, shardMat: { userData: { uniforms: { uBoost: { value: 0 } } } },
    buffer: { set(i, x, y, z, q, s, g) { shown[i] = true; scale[i] = s; glow[i] = g; }, hide(i) { shown[i] = false; }, flush() {}, shown, scale, glow },
    setAwake() {}, setCoreTop() {}, setAura() {}, dispose() {},
  };
}`);
const BV = await import(await ts('../src/weapons/demonBlade/BladeView.ts', {
  '../../core/math': mathUrl,
  './BladeShape': shapeUrl,
  './BladeModel': modelStub,
  './BladeSwarm': data('export const SHARD_HOME = 0;'),
  './BladeTrail': await ts('../src/weapons/demonBlade/BladeTrail.ts'),
  './BladeGlints': await ts('../src/weapons/demonBlade/BladeGlints.ts'),
  './BladeSwordSign': await ts('../src/weapons/demonBlade/BladeSwordSign.ts'),
  '../../assets/ArtEnvironment': data('export function applyArtEnvironment() {}'),
  '../../assets/StaticAttachment': data('export function attachStaticPart() { return null; }'),
}));

const VM_FOV = 60;
const ASPECTS = [16 / 9, 4 / 3];
/** 相机局部点（Three.js：z 朝后）→ 归一化屏幕坐标（−1..1 在画面内） */
function ndc(p, aspect) {
  const t = Math.tan(VM_FOV * 0.5 * Math.PI / 180);
  return [p.x / (-p.z * t * aspect), p.y / (-p.z * t)];
}
const combo = getWeaponDef('demon_blade').blade.combo;

// ───────────── 关键帧与常数 ─────────────

/** Unity BladeSwing.K(px, py, pz, dx, dy, dz, ex, ey, ez)：TS 原值，读入时 z 取反——所以括号里就是 Three.js 相机空间的数 */
function kArgs(src) {
  return src.split(',').map(num);
}

test('blade keys: idle / point / shield / raise and the three swings equal Unity BladeSwing.cs (incl. the reworked third slash)', async () => {
  const text = await cs('Weapons/DemonBlade/BladeSwing.cs');
  const flat = k => [...k.p, ...k.d, ...k.e];
  for (const [name, key] of [['Idle', BV.IDLE], ['Point', BV.POINT], ['Shield', BV.SHIELD], ['Raise', BV.RAISE]]) {
    const m = text.match(new RegExp(`public static readonly Key ${name} = K\\(([^)]+)\\);`));
    assert.ok(m, name);
    assert.deepEqual(flat(key), kArgs(m[1]), name);
  }
  const swings = text.slice(text.indexOf('public static readonly Key[][] Swings'), text.indexOf('public static Quaternion Basis'));
  const ks = [...swings.matchAll(/K\(([^)]+)\)/g)].map(m => kArgs(m[1]));
  assert.equal(ks.length, 9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.deepEqual(flat(BV.SWINGS[i][j]), ks[i * 3 + j], `第 ${i + 1} 段第 ${j + 1} 帧`);
});

test('blade constants equal BladeSwing / BladeView / BladeTrail preset', async () => {
  const sw = await cs('Weapons/DemonBlade/BladeSwing.cs');
  const bv = await cs('Weapons/DemonBlade/BladeView.cs');
  const get = (src, name) => num(src.match(new RegExp(`\\b${name} = ([-\\d.]+f?)`))[1]);
  const F = BV.BLADE_FP;
  near(F.WindFrac, get(sw, 'WindFrac'));
  near(F.RecoverP, get(sw, 'RecoverP'));
  near(F.StretchBaseY, get(sw, 'StretchBaseY'));
  near(BV.BLADE_VM_SCALE, get(bv, 'ModelScale'));
  near(F.BlendTime, get(bv, 'BlendTime'));
  near(F.HitStopLight, get(bv, 'HitStopLight'));
  near(F.HitStopHeavy, get(bv, 'HitStopHeavy'));
  near(F.TrailSub, get(bv, 'TrailSub'));
  near(F.ArriveDecay, get(bv, 'ArriveDecay'));
  near(F.ArrivePeak, get(bv, 'ArrivePeak'));
  near(F.SparkDepth, get(bv, 'SparkDepth'));
  near(F.TrailInner, get(bv, 'TrailInner'));
  near(F.GlintSegs, get(bv, 'GlintSegs'));
  assert.match(bv, /sway\.Kick\(heavy \? 0\.024f : 0\.014f, heavy \? 0\.05f : 0\.028f\)/);
  assert.deepEqual(F.HitKick, [[0.014, 0.028], [0.024, 0.05]]);
  assert.match(bv, /hitFlash = heavy \? 1\.4f : 1f;/);
  assert.match(bv, /LeftArmScale = 0\.76f/);
  // 右拳拳心（Unity 量过：比 TS 再偏 1.5 cm；Unity x 取反）
  const fist = bv.match(/ArtRightFist = new\(([^)]+)\)/)[1].split(',').map(num);
  const src = await readFile(new URL('../src/weapons/demonBlade/BladeView.ts', import.meta.url), 'utf8');
  assert.match(src, new RegExp(`ART_R_FIST = new THREE\\.Vector3\\(${-fist[0]}, ${fist[1]}, ${fist[2]}\\)`));
  // 左手手势（Unity 相机空间 → z 取反）
  for (const [cname, key] of [['LeftPoint', 'point'], ['LeftSeal', 'seal'], ['LeftRaise', 'raise']]) {
    const m = bv.match(new RegExp(`${cname} = new\\(new Vector3\\(([^)]+)\\), new Vector3\\(([^)]+)\\), new Vector3\\(([^)]+)\\)\\)`));
    const [p, f, o] = [m[1], m[2], m[3]].map(s => s.split(',').map(num));
    const L = BV.LEFT_ART[key];
    assert.deepEqual([L.palm.x, L.palm.y, L.palm.z], [p[0], p[1], -p[2]], cname);
    const fn = new THREE.Vector3(f[0], f[1], -f[2]).normalize(), on = new THREE.Vector3(o[0], o[1], -o[2]).normalize();
    assert.ok(L.fingers.distanceTo(fn) < 1e-6 && L.fore.distanceTo(on) < 1e-6, cname);
  }
  // 刀光预设（FxTrailSpec 默认 + BladeTrailPreset）
  const preset = (await cs('Fx/Presets/BladeTrail.cs')).match(/Trail = new FxTrailSpec\s*\{([^}]+)\}/)[1];
  for (const m of preset.matchAll(/(\w+) = ([\d.]+)f?/g)) near(TRAIL.TRAIL_SPEC[m[1]], Number(m[2]), `刀光 ${m[1]}`);
  near(TRAIL.TRAIL_SPEC.screenWiden, num((await cs('Fx/FxTrail.cs')).match(/screenWiden = ([\d.]+f)/)[1]));
});

// ───────────── 三段斩时间线（剪辑事件、构图） ─────────────

test('slash timeline puts the strike event on the judgement frame (Unity BladeSlashClipsPutTheStrikeEventOnTheJudgementFrame)', () => {
  assert.equal(combo.length, 3);
  for (let i = 0; i < 3; i++) {
    const seg = combo[i];
    const hitP = seg.windup / seg.duration;
    // 判定帧事件 = 控制器 swingT ≥ windup 结算命中的那一刻
    near(BV.strikeP(hitP) * seg.duration, seg.windup, `第 ${i + 1} 段判定帧`);
    near(BV.windupP(hitP) * seg.duration, seg.windup * BV.BLADE_FP.WindFrac, `第 ${i + 1} 段出刀`);
    const recover = BV.BLADE_FP.RecoverP * seg.duration;
    assert.ok(seg.windup * BV.BLADE_FP.WindFrac < seg.windup && seg.windup < recover && recover < seg.duration, `第 ${i + 1} 段事件顺序`);
  }
});

test('slashes hit the key poses on their events (Unity BladeSlashClipsHitTheKeyPosesOnTheirEvents; the web samples the timeline directly, no baked clip)', () => {
  const idle = new BV.Pose().set(BV.IDLE);
  const out = new BV.Pose(), key = new BV.Pose();
  for (let i = 0; i < 3; i++) {
    const hitP = combo[i].windup / combo[i].duration;
    const at = [BV.windupP(hitP), BV.strikeP(hitP), 1];
    for (let k = 0; k < 3; k++) {
      BV.sampleSwing(i, at[k], hitP, idle, out);
      key.set(BV.SWINGS[i][k]);
      assert.ok(out.p.distanceTo(key.p) < 1e-3, `第 ${i + 1} 段第 ${k + 1} 个关键姿态位置`);
      assert.ok(out.q.angleTo(key.q) < 0.5 * Math.PI / 180, `第 ${i + 1} 段第 ${k + 1} 个关键姿态朝向`);
    }
  }
});

test('swings keep the grip on screen and the tip forward; the strike passes through mid-screen (Unity BladeSwingsKeepTheGripOnScreenAndTheTipForward)', () => {
  const idle = new BV.Pose().set(BV.IDLE);
  const out = new BV.Pose();
  const tip = new THREE.Vector3(), mid = new THREE.Vector3();
  for (let i = 0; i < 3; i++) {
    const hitP = combo[i].windup / combo[i].duration;
    for (let p = 0; p <= 1.0001; p += 0.02) {
      BV.sampleSwing(i, p, hitP, idle, out);
      tip.set(0, 1, 0).applyQuaternion(out.q);
      assert.ok(tip.z < 0.05, `第 ${i + 1} 段 p=${p.toFixed(2)}：刀尖转向了镜头（${tip.toArray()}）`);
      for (const aspect of ASPECTS) {
        const g = ndc(out.p, aspect);
        assert.ok(Math.abs(g[0]) < 1 && Math.abs(g[1]) < 1, `第 ${i + 1} 段 p=${p.toFixed(2)}：握刀点出了画面（${g}）`);
      }
    }
    BV.sampleSwing(i, hitP, hitP, idle, out);
    out.bladePoint(0, SHAPE.BLADE_LEN * 0.5, mid);
    for (const aspect of ASPECTS) {
      const g = ndc(mid, aspect);
      assert.ok(Math.abs(g[0]) < 0.8 && Math.abs(g[1]) < 0.8, `第 ${i + 1} 段判定帧时刀身中段不在画面中部（${g}）`);
    }
  }
  for (const g of ['none', 'point', 'shield', 'raise']) {
    const k = new BV.Pose().set(BV.gestureKey(g));
    tip.set(0, 1, 0).applyQuaternion(k.q);
    assert.ok(tip.z < 0.05, `手势 ${g} 刀尖转向了镜头`);
    for (const aspect of ASPECTS) {
      const n = ndc(k.p, aspect);
      assert.ok(Math.abs(n[0]) < 1 && Math.abs(n[1]) < 1, `手势 ${g} 握刀点出了画面`);
    }
  }
});

test('third slash stretches around the strike (Unity BladeThirdSlashStretchesAroundTheStrike)', () => {
  for (let i = 0; i < 2; i++) for (let p = 0; p <= 1; p += 0.05) near(BV.slashStretch(p, combo[i].windup / combo[i].duration, combo[i].stretch), 1, `第 ${i + 1} 段不伸刃`, 1e-5);
  const s3 = combo[2], h = s3.windup / s3.duration;
  near(s3.stretch, 2.2, '', 1e-4);
  near(BV.slashStretch(0, h, s3.stretch), 1, '起手不伸', 1e-5);
  near(BV.slashStretch(h * BV.BLADE_FP.WindFrac, h, s3.stretch), 1, '出刀那一刻开始伸', 1e-4);
  near(BV.slashStretch(h, h, s3.stretch), 2.2, '判定帧伸满', 1e-4);
  near(BV.slashStretch(BV.BLADE_FP.RecoverP, h, s3.stretch), 2.2, '收势前保持', 1e-4);
  near(BV.slashStretch(1, h, s3.stretch), 1, '收势缩回', 1e-4);
  let prev = 1;
  for (let p = h * BV.BLADE_FP.WindFrac; p <= h; p += 0.01) {
    const s = BV.slashStretch(p, h, s3.stretch);
    assert.ok(s >= prev - 1e-5, '伸刃单调');
    prev = s;
  }
  assert.equal(BV.stretchY(0.05, 2.2), 0.05, '刀根一截不动');
  near(BV.stretchY(SHAPE.BLADE_LEN, 2.2), 0.09 + (SHAPE.BLADE_LEN - 0.09) * 2.2, '刀尖按倍率拉长');
});

// ───────────── 刀光 ─────────────

test('blade trail brightens with swing speed (Unity BladeTrailUsesTheFxPresetAndBrightensWithSwingSpeed)', () => {
  const S = TRAIL.TRAIL_SPEC;
  near(TRAIL.trailBrightness(0), S.minBrightness);
  near(TRAIL.trailBrightness(S.fastSpeed * 2), 1);
  let prev = 0;
  for (let v = 0; v <= S.fastSpeed * 1.2; v += 0.5) {
    const b = TRAIL.trailBrightness(v);
    assert.ok(b >= prev - 1e-6, '越快越亮');
    prev = b;
  }
  near(TRAIL.trailBrightness(NaN), S.minBrightness);
});

test('blade trail ages out and breaks between slashes (Unity BladeTrailAgesOutAndBreaksBetweenSlashes)', () => {
  const trail = new TRAIL.BladeTrail();
  const S = trail.spec;
  const color = new THREE.Color(0xff00ff);
  const v = (x, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  trail.push(v(0), v(0, 1), 0);
  trail.tick(0, color, null);
  assert.equal(trail.visible, false, '一个采样点画不出带子');
  trail.push(v(0.1), v(0.1, 1), S.fastSpeed * 2);
  trail.tick(0.01, color, null);
  assert.equal(trail.visible, true, '两个相连的采样点画出带子');
  near(trail.peakBrightness, 1, '', 1e-5);
  near(trail.lastBrightness, 1, '', 1e-5);
  // 新一段另起一条：只有一个点的新条不跟旧条连起来；旧条过期后整条消失
  trail.break();
  trail.push(v(-1), v(-1, 1), 0);
  trail.tick(S.life * 0.9, color, null);
  assert.equal(trail.size, 3);
  trail.tick(S.life * 0.06, color, null);
  assert.equal(trail.size, 1, '旧的两个点过期了');
  assert.equal(trail.visible, false, '剩下的那一点自成一条，画不出带子');
  // 采样点上限：最老的挤掉
  trail.clear();
  for (let i = 0; i < S.maxSamples + 10; i++) trail.push(v(i), v(i, 1), 5);
  assert.equal(trail.size, S.maxSamples);
  // 墨笔起收锋：起笔端收成尖、中段饱满、贴刀端略收
  near(TRAIL.brushWidth(0), 0);
  near(TRAIL.brushWidth(0.5), 1);
  near(TRAIL.brushWidth(1), 0.7);
});

test('blade trail mesh: body (normal blend) + additive fringe, side-on sweeps get widened on screen', () => {
  const trail = new TRAIL.BladeTrail();
  const cam = new THREE.Object3D();
  cam.position.set(0, 0, 0.5);
  const parent = new THREE.Group();
  parent.add(trail.mesh, cam);
  // 刀身朝前（−Z）、沿 x 横扫：扫掠面 = x-z 平面，从 (0,0,0.5) 看几乎侧对
  for (let i = 0; i < 6; i++) trail.push(new THREE.Vector3(i * 0.03, -0.1, -0.3), new THREE.Vector3(i * 0.03, -0.1, -0.7), 20);
  trail.tick(0.001, new THREE.Color(0x9a5cff), cam);
  assert.equal(trail.visible, true);
  assert.ok(trail.lastWiden > 0.5, `侧看补宽 ${trail.lastWiden}`);
  const groups = trail.mesh.geometry.groups;
  assert.equal(groups.length, 2);
  assert.equal(trail.mesh.material[1].blending, THREE.AdditiveBlending, '外缘光边加色');
  assert.equal(trail.mesh.material[0].blending, THREE.NormalBlending, '带身普通混合（亮背景上看得见）');
});

// ───────────── 剑指、手势、光点 ─────────────

test('left hand rises only for sword signs (Unity BladeLeftHandRisesOnlyForSwordSigns)', () => {
  assert.equal(BV.leftHandWeight('none'), 0);
  assert.equal(BV.leftHandWeight('point'), 1);
  assert.equal(BV.leftHandWeight('raise'), 1);
  assert.equal(BV.leftHandWeight('shield'), 0.8);
  assert.equal(BV.gestureKey('none'), BV.IDLE);
  assert.equal(BV.gestureKey('point'), BV.POINT);
});

test('sword-sign fingers point where the gesture aims (Unity BladeSwordSignFingersPointWhereTheGestureAims)', async () => {
  const text = await cs('Weapons/DemonBlade/BladeSwordSign.cs');
  near(SIGN.SIGN.indexLength, num(text.match(/IndexLength = ([\d.]+f)/)[1]));
  near(SIGN.SIGN.middleLength, num(text.match(/MiddleLength = ([\d.]+f)/)[1]));
  near(SIGN.SIGN.gloveFrac, num(text.match(/GloveFrac = ([\d.]+f)/)[1]));
  for (const arm of ['SM_Arms_RedPandaL', 'SM_Arms_PangolinL', 'SM_Arms_FlyingSquirrelL', 'unknown']) {
    const fit = SIGN.swordSignFit(arm);
    if (arm !== 'unknown') {
      // Unity 手臂空间 x 取反、UV 的 v 翻转
      const block = text.match(new RegExp(`static readonly Fit ${arm.replace('SM_Arms_', '').replace(/L$/, '')} = new\\(\\)\\s*\\{([\\s\\S]*?)\\};`))[1];
      const idx = block.match(/index = new Vector3\(([^)]+)\)/)[1].split(',').map(num);
      assert.ok(fit.index.distanceTo(new THREE.Vector3(-idx[0], idx[1], idx[2])) < 1e-6, `${arm} 食指指根`);
      const uv = block.match(/skinUv = new Vector2\(([^)]+)\)/)[1].split(',').map(num);
      assert.ok(Math.abs(fit.skinUv.x - uv[0]) < 1e-6 && Math.abs(fit.skinUv.y - (1 - uv[1])) < 1e-6, `${arm} 皮肤 UV`);
    }
    for (const g of ['point', 'shield', 'raise']) {
      const L = BV.LEFT_ART[g === 'shield' ? 'seal' : g];
      const q = BV.leftRotation(fit.dir, L.fingers, L.fore, new THREE.Quaternion());
      assert.ok(fit.dir.clone().applyQuaternion(q).angleTo(L.fingers) < 0.5 * Math.PI / 180, `${arm} ${g}：手指没指向手势方向`);
      const fore = BV.ART_L_FORE.clone().applyQuaternion(q);
      assert.ok(fore.dot(L.fore) > 0.3, `${arm} ${g}：前臂没朝画面左下方`);
      assert.ok(fore.y < 0, `${arm} ${g}：前臂朝上了`);
      const tip = SIGN.indexTip(fit).multiplyScalar(0.76).applyQuaternion(q).add(L.palm);
      for (const aspect of ASPECTS) {
        const n = ndc(tip, aspect);
        assert.ok(n[0] > -1 && n[0] < 0.2 && Math.abs(n[1]) < 1, `${arm} ${g}：指尖不在画面左半边（${n}）`);
      }
    }
    const geo = SIGN.buildSwordSign(fit);
    assert.ok(geo.attributes.position.count > 40);
    assert.equal(geo.index.count % 3, 0);
    const box = geo.boundingBox;
    assert.ok(box.distanceToPoint(fit.index) < 0.002 && box.distanceToPoint(SIGN.indexTip(fit)) < 0.002, '两根手指从指根伸出、长度对得上');
    const uvs = new Set();
    for (let i = 0; i < geo.attributes.uv.count; i++) uvs.add(`${geo.attributes.uv.getX(i)},${geo.attributes.uv.getY(i)}`);
    assert.equal(uvs.size, 2, '指根手套色 + 指尖皮肤色两处 UV');
    // 法线朝外（镜像后绕序反过来了）：食指中段一圈的法线背离指轴
    const n = geo.attributes.normal, p = geo.attributes.position;
    let outward = 0;
    for (let i = 8; i < 16; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i).sub(fit.index);
      const radial = v.sub(fit.dir.clone().multiplyScalar(v.dot(fit.dir)));
      if (new THREE.Vector3().fromBufferAttribute(n, i).dot(radial) > 0) outward++;
    }
    assert.equal(outward, 8, '手指的面朝外');
  }
});

test('glints: one camera-facing quad per glint, additive, capped (Unity BladeGlints)', async () => {
  near(GLINTS.GLINT_MAX, num((await cs('Weapons/DemonBlade/BladeGlints.cs')).match(/Max = (\d+)/)[1]));
  const g = new GLINTS.BladeGlints();
  g.begin();
  g.add(new THREE.Vector3(0, 0, -0.5), 0.06, new THREE.Color(1, 1, 1), 0.5);
  g.add(new THREE.Vector3(0, 0, -0.5), 0, new THREE.Color(1, 1, 1), 0.5);
  g.add(new THREE.Vector3(0, 0, -0.5), 0.06, new THREE.Color(1, 1, 1), 0.001);
  g.end();
  assert.equal(g.lastCount, 1, '尺寸 / 强度太小的不画');
  assert.equal(g.mesh.visible, true);
  assert.equal(g.mesh.material.blending, THREE.AdditiveBlending);
  g.begin();
  g.end();
  assert.equal(g.mesh.visible, false);
});

test('view hands shards over at the same screen point (Unity BladeViewHandsShardsOverAtTheSameScreenPoint)', () => {
  const p = new THREE.Vector3(0.21, -0.13, -0.6);
  const a = BV.fovRatio(80, VM_FOV);
  const tv = Math.tan(VM_FOV * 0.5 * Math.PI / 180), tm = Math.tan(40 * Math.PI / 180);
  near((p.x * a) / (-p.z * tm), p.x / (-p.z * tv), '', 1e-5);
  near((p.y * a) / (-p.z * tm), p.y / (-p.z * tv), '', 1e-5);
  near(BV.fovRatio(60, 60), 1);
});

// ───────────── 视图行为（命中顿帧按真实时间、事件派发、碎片发光） ─────────────

function view() {
  const punches = [], bursts = [];
  const viewCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 20);
  const ctx = {
    viewCamera, camera: new THREE.PerspectiveCamera(80, 16 / 9, 0.1, 1000), time: { now: 0, timeScale: 1 },
    player: { punchDegrees: (...a) => punches.push(a) }, fx: { burst: (...a) => bursts.push(a) },
  };
  const v = new BV.BladeView(ctx, 0x886644);
  viewCamera.add(v.root);
  const kicks = [];
  v.onKick = (b, r) => kicks.push([b, r]);
  return { v, ctx, punches, bursts, kicks };
}

test('view: strike event fires once per slash on the judgement frame, punches the camera and throws sparks', () => {
  const { v, punches, bursts } = view();
  const pose = BV.createBladePoseInput();
  for (let seg = 0; seg < 3; seg++) {
    const s = combo[seg];
    pose.swing = seg;
    pose.slash = s;
    pose.hitP = s.windup / s.duration;
    const before = v.strikeEvents;
    for (let t = 0; t <= s.duration + 1e-9; t += 1 / 60) {
      pose.swingP = Math.min(1, t / s.duration);
      v.pose(1 / 60, pose);
      v.root.updateMatrixWorld(true);
      v.animate(1 / 60, pose);
    }
    assert.equal(v.strikeEvents - before, 1, `第 ${seg + 1} 段判定帧事件一次`);
  }
  assert.equal(punches.length, 3, '判定帧镜头一带');
  assert.deepEqual(punches.map(p => p.map(x => Math.round(x * 100) / 100)), [[0.22, 0.25, -0.28], [0.06, -0.25, 0.32], [0.06, 0.25, -0.5]]);
  assert.equal(bursts.length, 3, '判定帧甩出火星（随 M11b 换预设）');
});

test('view: hit stop freezes the visual progress for 40 / 70 ms of real time even when game time is slowed', () => {
  const { v, ctx, kicks } = view();
  const pose = BV.createBladePoseInput();
  const s = combo[0];
  pose.swing = 0; pose.slash = s; pose.hitP = s.windup / s.duration;
  pose.swingP = 0.4;
  v.pose(1 / 60, pose);
  v.onHit(false);
  assert.deepEqual(kicks[0], [0.014, 0.028], '命中往回一磕');
  const p0 = v.visualProgress;
  // 全局顿帧 ×0.05：游戏 dt 很小，视觉顿帧按真实时间 40 ms 放开
  ctx.time.timeScale = 0.05;
  pose.swingP = 0.6;
  for (let i = 0; i < 2; i++) v.pose(1 / 60 * 0.05, pose, 1 / 60);
  near(v.visualProgress, p0, '顿帧中视觉进度停住');
  for (let i = 0; i < 2; i++) v.pose(1 / 60 * 0.05, pose, 1 / 60);
  assert.ok(v.visualProgress > p0, '40 ms 真实时间后追上');
  v.onHit(true);
  assert.deepEqual(kicks[1], [0.024, 0.05]);
});

test('view: shards glow with hit / strike / union / stretch and bump when they arrive', () => {
  const { v, ctx } = view();
  const pose = BV.createBladePoseInput();
  const arrivedAt = new Float64Array(128).fill(-99);
  arrivedAt[10] = 0;
  v.setSwarm({ state: new Uint8Array(128), arrivedAt });
  ctx.time.now = 0;
  v.pose(1 / 60, pose);
  v.animate(1 / 60, pose);
  const buf = v.model.buffer;
  near(buf.scale[10], 1.2, '刚归位的放大一下');
  near(buf.scale[11], 1, '其余原样');
  assert.ok(v.glints.lastCount >= 1, '归位闪的光点');
  v.onHit(true);
  v.pose(1 / 60, pose);
  v.animate(1 / 60, pose);
  assert.ok(buf.glow[11] > 0.6, '命中整把刀亮一下');
});

// ───────────── 刃群 / 控制器接线 ─────────────

test('world swarm constants equal BladeShards.cs (formation scales, launch / return, shield rings)', async () => {
  const text = await cs('Weapons/DemonBlade/BladeShards.cs');
  const src = await readFile(new URL('../src/weapons/demonBlade/BladeSwarm.ts', import.meta.url), 'utf8');
  const pairs = { SwarmScale: 'SWARM_SCALE', ShieldScale: 'SHIELD_SCALE', BallScale: 'BALL_SCALE', LaunchSpread: 'LAUNCH_SPREAD', OutSpeed: 'OUT_SPEED', OutMin: 'OUT_MIN', OutMax: 'OUT_MAX', BackSpread: 'BACK_SPREAD', BackSpeed: 'BACK_SPEED', BackMin: 'BACK_MIN', BackMax: 'BACK_MAX' };
  for (const [u, w] of Object.entries(pairs)) {
    const a = num(text.match(new RegExp(`\\b${u} = ([\\d.]+f?)`))[1]);
    const b = Number(src.match(new RegExp(`const ${w} = ([\\d.]+);`))[1]);
    near(b, a, u);
  }
  assert.match(text, /ShieldRings = \{ 12, 28, 40, 48 \}/);
  assert.match(src, /SHIELD_RINGS = \[12, 28, 40, 48\]/);
  const r = await cs('Weapons/DemonBlade/BladeSwarmRenderer.cs');
  assert.match(r, /StreakTime = 0\.05f, StreakMax = 1\.1f/);
  assert.match(src, /STREAK_TIME = 0\.05;[\s\S]*STREAK_MAX = 1\.1;/);
});

test('controller: judgement frame calls onStrike, hits punch the camera 1.6° / 0.5° and request a 70 / 40 ms hit stop (Unity DemonBladeController)', async () => {
  const text = await cs('Weapons/DemonBlade/DemonBladeController.cs');
  assert.match(text, /view\?\.OnStrike\(idx, seg, union\);/);
  assert.match(text, /feel\.Punch\(heavy \? 1\.6f : 0\.5f, idx == 1 \? 1\.4f : -1\.4f\)/);
  assert.match(text, /HitStop\.Request\(heavy \? 0\.07f : 0\.04f\)/);
  assert.match(text, /pose\.slash = seg;/);
  const src = await readFile(new URL('../src/weapons/demonBlade/DemonBlade.ts', import.meta.url), 'utf8');
  assert.match(src, /this\.host\.view\(\)\?\.onStrike\(idx, this\.unionLeft > 0\);/);
  assert.match(src, /punch\.call\(player, heavy \? 1\.6 : 0\.5, idx === 1 \? 1\.4 : -1\.4\)/);
  assert.match(src, /hitStop\?\.request\(heavy \? 0\.07 : 0\.04\)/);
  assert.match(src, /s\.slash = seg;/);
  assert.match(src, /s\.unionStretch = P\.union\.stretch;/);
  near(getWeaponDef('demon_blade').blade.union.stretch, 1.3);
  // 判定帧的镜头一带（BladeView.OnBladeStrike）
  const bv = await cs('Weapons/DemonBlade/BladeView.cs');
  assert.match(bv, /float yaw = segment == 1 \? 0\.32f : segment == 2 \? -0\.5f : -0\.28f;/);
  assert.match(bv, /float pitch = segment == 0 \? 0\.22f : 0\.06f;/);
  assert.match(bv, /feel\.Punch\(pitch, segment == 1 \? -0\.25f : 0\.25f, yaw\)/);
});
