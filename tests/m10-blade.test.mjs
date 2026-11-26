// M10 碎刃第一人称对照（Unity Weapons/DemonBlade/BladeSwing.cs、BladeView.cs、BladeTrail.cs、BladeGlints.cs、BladeSwordSign.cs、BladeShards.cs、
// DemonBladeController.cs、Fx/FxTrail.cs、Fx/Presets/BladeTrail.cs → 网页 src/weapons/demonBlade/BladeView.ts、BladeTrail.ts、BladeGlints.ts、
// BladeSwordSign.ts、BladeSwarm.ts、DemonBlade.ts）。关键帧 / 常数照 C# 抄成下面的常量，旁边注明出自哪个文件哪一行（路径相对
// unity/Assets/Game/Scripts/；Unity 相机空间 z 朝前，比的时候取反）；测试不读 unity/ 下的任何文件（unity/ 以后整个删掉）。
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
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg ?? ''} ${a} ≠ ${b}`);

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
const bvUrl = await ts('../src/weapons/demonBlade/BladeView.ts', {
  '../../core/math': mathUrl,
  '../WeaponDefs': defsUrl,
  './BladeShape': shapeUrl,
  './BladeModel': modelStub,
  './BladeSwarm': data('export const SHARD_HOME = 0;'),
  './BladeTrail': await ts('../src/weapons/demonBlade/BladeTrail.ts'),
  './BladeGlints': await ts('../src/weapons/demonBlade/BladeGlints.ts'),
  './BladeSwordSign': await ts('../src/weapons/demonBlade/BladeSwordSign.ts'),
  '../../assets/ArtEnvironment': data('export function applyArtEnvironment() {}'),
  '../../assets/StaticAttachment': data('export function attachStaticPart() { return null; }'),
});
const BV = await import(bvUrl);

const VM_FOV = 60;
const ASPECTS = [16 / 9, 4 / 3];
/** 相机局部点（Three.js：z 朝后）→ 归一化屏幕坐标（−1..1 在画面内） */
function ndc(p, aspect) {
  const t = Math.tan(VM_FOV * 0.5 * Math.PI / 180);
  return [p.x / (-p.z * t * aspect), p.y / (-p.z * t)];
}
const combo = getWeaponDef('demon_blade').blade.combo;

// ───────────── 关键帧与常数 ─────────────

/**
 * Unity Weapons/DemonBlade/BladeSwing.cs 的关键帧 K(px, py, pz, dx, dy, dz, ex, ey, ez)：括号里是 TS 原值，Unity 读入时 z 取反——
 * 所以这里抄的就是 Three.js 相机空间的数（握刀点 p、刀身方向 d、刃口方向 e）
 */
const BLADE_KEYS = {
  Idle: [0.25, -0.22, -0.5, -0.28, 0.82, -0.5, -0.92, -0.1, 0.38], // :76
  Point: [0.26, -0.22, -0.46, -0.18, 0.5, -0.85, -0.76, -0.53, -0.17], // :78
  Shield: [0.12, -0.2, -0.4, -0.9, 0.25, -0.3, 0, 0, -1], // :80
  Raise: [0.22, -0.12, -0.42, -0.2, 0.95, -0.2, -0.6, 0, -0.8], // :82
};
/** 三段斩各三个关键帧（BladeSwing.cs Swings：第一段 :96–98、第二段 :102–104、第三段 :108–110——Unity 改过的刃口下压、刀面朝镜头侧倾） */
const BLADE_SWINGS = [
  [
    [0.24, 0, -0.48, 0.3, 0.85, -0.15, -0.75, 0.2, -0.6],
    [0.1, -0.12, -0.5, -0.62, -0.35, -0.7, -0.3, -0.9, 0.3],
    [-0.1, -0.19, -0.47, -0.75, -0.25, -0.6, -0.3, -0.85, 0.3],
  ],
  [
    [-0.14, -0.15, -0.46, -0.85, 0.3, -0.1, 0.3, 0.2, -0.9],
    [0.06, -0.14, -0.5, -0.5, 0.4, -0.77, 0.82, 0.1, -0.56],
    [0.28, -0.17, -0.44, 0.55, 0.35, -0.75, 0.75, -0.1, 0.6],
  ],
  [
    [0.3, -0.12, -0.44, 0.85, 0.08, -0.4, -0.4, -0.3, -0.92],
    [0.05, -0.15, -0.5, -0.72, -0.1, -0.68, -0.66, -0.45, 0.62],
    [-0.16, -0.2, -0.46, -0.85, -0.08, -0.45, -0.45, -0.42, 0.8],
  ],
];

test('blade keys: idle / point / shield / raise and the three swings equal Unity BladeSwing.cs (incl. the reworked third slash)', () => {
  const flat = k => [...k.p, ...k.d, ...k.e];
  for (const [name, key] of [['Idle', BV.IDLE], ['Point', BV.POINT], ['Shield', BV.SHIELD], ['Raise', BV.RAISE]]) {
    assert.deepEqual(flat(key), BLADE_KEYS[name], name);
  }
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.deepEqual(flat(BV.SWINGS[i][j]), BLADE_SWINGS[i][j], `第 ${i + 1} 段第 ${j + 1} 帧`);
});

/** BladeSwing.cs：WindFrac（:44）、RecoverP（:46）、StretchBaseY（:48） */
const SWING_CONSTS = { WindFrac: 0.55, RecoverP: 0.72, StretchBaseY: 0.09 };
/**
 * Weapons/DemonBlade/BladeView.cs：ModelScale（:31）、BlendTime（:33）、HitStopLight / HitStopHeavy（:35）、TrailSub（:37）、ArriveDecay / ArrivePeak（:39）、
 * SparkDepth（:41）、TrailInner（:43）、GlintSegs（:676）；命中一磕 sway.Kick(heavy ? 0.024 : 0.014, heavy ? 0.05 : 0.028)（:345）、
 * 刀身闪 hitFlash = heavy ? 1.4 : 1（:344）、左手臂缩放 LeftArmScale 0.76（:58）、右拳拳心 ArtRightFist（:53，Unity x 取反；比 TS 再偏 1.5 cm）
 */
const VIEW_CONSTS = {
  ModelScale: 0.72, BlendTime: 0.14, HitStopLight: 0.04, HitStopHeavy: 0.07, TrailSub: 4, ArriveDecay: 8, ArrivePeak: 1.8,
  SparkDepth: 1.6, TrailInner: 0.35, GlintSegs: 6,
  HitKick: [[0.014, 0.028], [0.024, 0.05]], HitFlash: [1, 1.4], LeftArmScale: 0.76, ArtRightFist: [-0.018, -0.05, 0.034],
};
/** 左手手势 (palm, fingers, fore)：BladeView.cs LeftPoint（:76）、LeftSeal（:77）、LeftRaise（:78），Unity 相机空间（z 朝前） */
const LEFT_POSES = {
  point: { palm: [-0.21, -0.135, 0.5], fingers: [0.5, 0.6, 0.62], fore: [-0.3, -0.55, -0.78] },
  seal: { palm: [-0.2, -0.14, 0.48], fingers: [0.12, 0.97, 0.2], fore: [-0.2, -0.55, -0.8] },
  raise: { palm: [-0.2, -0.08, 0.5], fingers: [0.2, 0.85, 0.5], fore: [-0.25, -0.7, -0.65] },
};
/** 刀光预设：Fx/Presets/BladeTrail.cs:22 的 new FxTrailSpec { … }；侧看补宽 screenWiden 0.75（Fx/FxTrail.cs:28 默认） */
const TRAIL_PRESET = {
  life: 0.16, headTime: 0.04, maxSamples: 64, fringe: 0.1, bodyAlpha: 0.72, hotMix: 0.3, headHotMix: 0.45,
  bodyIntensity: 1.25, fringeIntensity: 2, slowSpeed: 2.5, fastSpeed: 18, minBrightness: 0.25,
};
const TRAIL_SCREEN_WIDEN = 0.75;

test('blade constants equal BladeSwing / BladeView / BladeTrail preset', async () => {
  const F = BV.BLADE_FP;
  for (const [k, v] of Object.entries(SWING_CONSTS)) near(F[k], v, k);
  near(BV.BLADE_VM_SCALE, VIEW_CONSTS.ModelScale);
  for (const k of ['BlendTime', 'HitStopLight', 'HitStopHeavy', 'TrailSub', 'ArriveDecay', 'ArrivePeak', 'SparkDepth', 'TrailInner', 'GlintSegs']) near(F[k], VIEW_CONSTS[k], k);
  assert.deepEqual(F.HitKick, VIEW_CONSTS.HitKick);
  const src = await readFile(new URL('../src/weapons/demonBlade/BladeView.ts', import.meta.url), 'utf8');
  assert.match(src, new RegExp(`this\\.hitFlash = heavy \\? ${VIEW_CONSTS.HitFlash[1]} : ${VIEW_CONSTS.HitFlash[0]};`), '刀身闪');
  assert.match(src, new RegExp(`LEFT_ARM_SCALE = ${VIEW_CONSTS.LeftArmScale};`), '左手臂缩放');
  const fist = VIEW_CONSTS.ArtRightFist;
  assert.match(src, new RegExp(`ART_R_FIST = new THREE\\.Vector3\\(${-fist[0]}, ${fist[1]}, ${fist[2]}\\)`), '右拳拳心（x 取反）');
  // 左手手势（Unity 相机空间 → z 取反）
  for (const [key, { palm: p, fingers: f, fore: o }] of Object.entries(LEFT_POSES)) {
    const L = BV.LEFT_ART[key];
    assert.deepEqual([L.palm.x, L.palm.y, L.palm.z], [p[0], p[1], -p[2]], key);
    const fn = new THREE.Vector3(f[0], f[1], -f[2]).normalize(), on = new THREE.Vector3(o[0], o[1], -o[2]).normalize();
    assert.ok(L.fingers.distanceTo(fn) < 1e-6 && L.fore.distanceTo(on) < 1e-6, key);
  }
  // 刀光预设（FxTrailSpec 默认 + BladeTrailPreset）
  for (const [k, v] of Object.entries(TRAIL_PRESET)) near(TRAIL.TRAIL_SPEC[k], v, `刀光 ${k}`);
  near(TRAIL.TRAIL_SPEC.screenWiden, TRAIL_SCREEN_WIDEN);
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

/**
 * Weapons/DemonBlade/BladeSwordSign.cs：IndexLength / MiddleLength（:23）、GloveFrac（:25）；三只左手臂各自的食指指根 index（Unity 手臂空间）
 * 与皮肤 UV skinUv（Unity 的 v）：RedPanda（:30）、Pangolin（:36）、FlyingSquirrel（:42）
 */
const SIGN_CONSTS = { indexLength: 0.068, middleLength: 0.075, gloveFrac: 0.42 };
const SIGN_FITS = {
  SM_Arms_RedPandaL: { index: [0.006, -0.04, -0.05], skinUv: [0.0222, 0.8736] },
  SM_Arms_PangolinL: { index: [0, -0.045, -0.045], skinUv: [0.2696, 0.2311] },
  SM_Arms_FlyingSquirrelL: { index: [-0.026, -0.04, -0.024], skinUv: [0.5218, 0.5782] },
};

test('sword-sign fingers point where the gesture aims (Unity BladeSwordSignFingersPointWhereTheGestureAims)', () => {
  near(SIGN.SIGN.indexLength, SIGN_CONSTS.indexLength);
  near(SIGN.SIGN.middleLength, SIGN_CONSTS.middleLength);
  near(SIGN.SIGN.gloveFrac, SIGN_CONSTS.gloveFrac);
  for (const arm of ['SM_Arms_RedPandaL', 'SM_Arms_PangolinL', 'SM_Arms_FlyingSquirrelL', 'unknown']) {
    const fit = SIGN.swordSignFit(arm);
    if (arm !== 'unknown') {
      // Unity 手臂空间 x 取反、UV 的 v 翻转
      const { index: idx, skinUv: uv } = SIGN_FITS[arm];
      assert.ok(fit.index.distanceTo(new THREE.Vector3(-idx[0], idx[1], idx[2])) < 1e-6, `${arm} 食指指根`);
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

test('glints: one camera-facing quad per glint, additive, capped (Unity BladeGlints)', () => {
  near(GLINTS.GLINT_MAX, 160, '上限 Max = 160（Weapons/DemonBlade/BladeGlints.cs:16）');
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

// blade-lab 检视页（src/dev/bladeLab.ts）给 BladeView 的假上下文只有 time / camera / viewCamera，挥砍进度也从不写 slash。
// Unity 对应：BladeView.OnBladeStrike 的 if (feel) feel.Punch(…)、SpawnSparks 缺预设 / 相机就 return（BladeView.cs:363、:377）；
// BladeView.Clip 的 slash ??= DefaultSlash(seg)，取武器表 blade.combo[seg]（BladeView.cs:585、:591–594）
function labView(extra = {}) {
  const fpCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 50);
  const v = new BV.BladeView({ time: { now: 0 }, camera: fpCamera, viewCamera: fpCamera, ...extra }, 0x5a6a7a);
  fpCamera.add(v.root);
  return { v, fpCamera };
}
/** 照 bladeLab.fpFrame 推进一段：swingP 按段时长走，hitP 是检视页自己写的数，slash 留 null */
function labSlash(v, fpCamera, pose, seg, dur, hitP, onFrame) {
  pose.swing = seg;
  pose.hitP = hitP;
  for (let t = 0; t <= dur + 1e-9; t += 1 / 60) {
    pose.swingP = Math.min(1, t / dur);
    v.pose(1 / 60, pose);
    fpCamera.updateMatrixWorld(true);
    v.animate(1 / 60, pose);
    onFrame?.(v);
  }
}

test('view: blade-lab fake context (time / camera / viewCamera only) runs all three slashes and the combo without throwing', () => {
  const COMBO = [0.3, 0.3, 0.5];
  for (const segs of [[0], [1], [2], [0, 1, 2]]) {
    const { v, fpCamera } = labView();
    const pose = BV.createBladePoseInput();
    assert.equal(pose.slash, null, '检视页从不写 slash');
    assert.doesNotThrow(() => {
      for (const seg of segs) labSlash(v, fpCamera, pose, seg, COMBO[seg], seg === 2 ? 0.32 : 0.27);
    }, `检视页 ${segs.length > 1 ? 'combo' : `slash${segs[0]}`} 越过判定帧不该抛异常`);
    assert.equal(v.strikeEvents, segs.length, '判定帧事件照样派发（刃口白热一闪）');
  }
});

test('view: with no slash entry the third slash still stretches to the weapon-table 2.2 (Unity BladeView.DefaultSlash)', () => {
  // 带上 player / fx 桩：这条只看伸刃回退，不和上一条（假上下文抛异常）搅在一起
  const stubs = { player: { punchDegrees() {} }, fx: { burst() {} } };
  const { v, fpCamera } = labView(stubs);
  const pose = BV.createBladePoseInput();
  let peak = 1;
  labSlash(v, fpCamera, pose, 2, 0.5, 0.32, view => { peak = Math.max(peak, view.stretchNow); });
  assert.ok(peak > 2.1, `slash 为 null 时第三段也要伸到 2.2（实际 ${peak.toFixed(3)}）`);
  // 前两段照武器表不伸
  const b = labView(stubs);
  let peak0 = 1;
  labSlash(b.v, b.fpCamera, BV.createBladePoseInput(), 0, 0.3, 0.27, view => { peak0 = Math.max(peak0, view.stretchNow); });
  near(peak0, 1, '第一段不伸刃', 1e-6);
  const blade = getWeaponDef('demon_blade').blade;
  for (let seg = 0; seg < 3; seg++) assert.equal(BV.defaultSlash(seg), blade.combo[seg], `第 ${seg + 1} 段回退到武器表 combo[${seg}]`);
  assert.equal(BV.defaultSlash(7), blade.combo[2], '越界钳到最后一段（Mathf.Clamp(seg, 0, combo.Length − 1)）');
  assert.equal(BV.defaultSlash(-1), blade.combo[0]);
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

// 第一人称经 Viewmodel 驱动真的 BladeView：视觉顿帧按 Game.frame 记下的真实帧时长（ctx.time.rawDt）扣，同 Unity Time.unscaledDeltaTime
const VM = await import(await ts('../src/weapons/Viewmodel.ts', {
  '../core/types': await ts('../src/core/types.ts'),
  '../core/math': mathUrl,
  './WeaponDefs': defsUrl,
  './WeaponModels': data(`import * as THREE from '${threeUrl}';
export const ART_GLOW = { 0: 0.5, 1: 0.8, 2: 1.1, 3: 1.5, 4: 2.0 };
export const ART_GLOW_BASE = 1.6;
export const boxGeo = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const solidMat = c => new THREE.MeshStandardMaterial({ color: c });
export const getFlashTexture = () => new THREE.Texture();
export function setCrossbowString() {}
export function buildGunModel() { throw new Error('只测碎刃'); }`),
  './demonBlade/BladeView': bvUrl,
  '../assets/AssetLibrary': data('export const AssetLibrary = { findAttachments: () => [] };'),
  '../assets/ArtEnvironment': data('export function applyArtEnvironment() {}'),
  '../assets/StaticAttachment': data('export function attachStaticPart() { return null; }'),
  './WeaponHandling': await ts('../src/weapons/WeaponHandling.ts'),
  './TwoBoneIK': await ts('../src/weapons/TwoBoneIK.ts'),
  './FireControl': await ts('../src/weapons/FireControl.ts'),
  './ReloadBreech': data('export function addReloadBreech() { return null; }'),
  '../assets/OriginalWeaponLibrary': data('export const OriginalWeaponLibrary = { get: () => null, loaded: () => null };'),
  './OriginalWeaponView': data('export class OriginalRecoil {} export class OriginalWeaponView {}'),
}));

test('viewmodel → blade view: a hit stop granted in the same frame (time scale drops to 0.05 after dt was computed) still freezes the visual progress for 40 ms of real time', () => {
  // Unity：BladeView.Animate 按 Time.unscaledDeltaTime 扣视觉顿帧（Weapons/DemonBlade/BladeView.cs:441
  // if (hitStopLeft > 0) hitStopLeft = Mathf.Max(0, hitStopLeft - Time.unscaledDeltaTime)）
  const viewCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 20);
  const ctx = {
    viewCamera, camera: new THREE.PerspectiveCamera(80, 16 / 9, 0.1, 1000), renderer: {},
    events: { on() {}, emit() {} },
    player: { velocity: new THREE.Vector3(), onGround: true, yaw: 0, isDashing: false, hero: { color: 0x886644, id: 'fox' }, punchDegrees() {} },
    input: { enabled: true, mouseDX: 0, mouseDY: 0 }, settings: { invertY: false }, fx: { burst() {} },
    time: { now: 0, dt: 1 / 60, timeScale: 1, frame: 0, rawDt: 1 / 60 },
  };
  const vm = new VM.Viewmodel(ctx);
  vm.init();
  vm.setVisible(true);
  vm.setWeapon({ uid: 1, defId: 'demon_blade', rarity: 0, element: 'none', level: 0, mag: 0, reserve: 0, affixes: [] });
  const view = vm.bladeView();
  assert.ok(view, '碎刃的第一人称');
  const s = VM.createViewmodelState();
  const pose = BV.createBladePoseInput();
  const seg = combo[0];
  pose.swing = 0; pose.slash = seg; pose.hitP = seg.windup / seg.duration; pose.swingP = 0.4;
  s.blade = pose;
  // Game.frame：帧开头 dt = rawDt × timeScale，之后整帧都用这个 dt
  const frame = () => {
    const dt = ctx.time.rawDt * ctx.time.timeScale;
    return () => vm.update(dt, s);
  };
  frame()();
  // 命中那一帧：dt 已经按 timeScale 1 算好；控制器 resolveSlash 先 view.onHit，再 hitStop.request（仲裁器立刻把 timeScale 写成 0.05），之后才轮到第一人称
  const hitFrame = frame();
  view.onHit(false);
  ctx.time.timeScale = 0.05;
  const p0 = view.visualProgress;
  pose.swingP = 0.6;
  hitFrame();
  near(view.visualProgress, p0, '命中那一帧视觉进度就停住（不是 1/60 ÷ 0.05 ≈ 0.33 s 一下扣光）');
  frame()();
  near(view.visualProgress, p0, '真实时间 33 ms 还停着');
  frame()();
  assert.ok(view.visualProgress > p0, '真实时间过了 40 ms 放开');
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

/**
 * Weapons/DemonBlade/BladeShards.cs：阵形缩放 SwarmScale / ShieldScale / BallScale（:33）、出窍 LaunchSpread / OutSpeed / OutMin / OutMax（:35）、
 * 归刀 BackSpread / BackSpeed / BackMin / BackMax（:37）、盾环 ShieldRings = { 12, 28, 40, 48 }（:39）；
 * 拉丝拖尾 StreakTime 0.05 / StreakMax 1.1（Weapons/DemonBlade/BladeSwarmRenderer.cs:20）
 */
const SHARDS = {
  SWARM_SCALE: 3.4, SHIELD_SCALE: 3.1, BALL_SCALE: 3.4,
  LAUNCH_SPREAD: 0.24, OUT_SPEED: 42, OUT_MIN: 0.1, OUT_MAX: 0.55,
  BACK_SPREAD: 0.14, BACK_SPEED: 48, BACK_MIN: 0.08, BACK_MAX: 0.42,
};
const SHIELD_RINGS = [12, 28, 40, 48];
const STREAK = { time: 0.05, max: 1.1 };

test('world swarm constants equal BladeShards.cs (formation scales, launch / return, shield rings)', async () => {
  const src = await readFile(new URL('../src/weapons/demonBlade/BladeSwarm.ts', import.meta.url), 'utf8');
  for (const [w, v] of Object.entries(SHARDS)) {
    const m = src.match(new RegExp(`const ${w} = ([\\d.]+);`));
    assert.ok(m, `网页缺 ${w}`);
    near(Number(m[1]), v, w);
  }
  assert.match(src, new RegExp(`SHIELD_RINGS = \\[${SHIELD_RINGS.join(', ')}\\]`));
  assert.match(src, new RegExp(`STREAK_TIME = ${STREAK.time};[\\s\\S]*STREAK_MAX = ${STREAK.max};`));
});

const DB = await import(await ts('../src/weapons/demonBlade/DemonBlade.ts', {
  '../../core/math': mathUrl,
  './BladeModel': data('export const BLADE_PURPLE = 0x9a5cff;'),
  './BladeEffects': data('export class BladeEffects { init() {} update() {} }'),
  './BladeSwarm': data('export class BladeSwarm { init() {} update() {} }'),
  './BladeView': data('export function createBladePoseInput() { return {}; }'),
}));

/** 真的 DemonBlade 控制器：一个敌人站在正前方 dist 米，ctx.game.hitStop / player.punchDegrees / 第一人称记下调用 */
function bladeController(dist = 1.5) {
  const calls = { punch: [], stop: [], strike: [], hit: [], damage: 0 };
  const enemy = {
    alive: true, untargetable: false, radius: 0.4, height: 1.8, position: new THREE.Vector3(0, 0, -dist),
    getBodyCenter(o) { return o.set(this.position.x, 1, this.position.z); },
    getHeadCenter(o) { return o.set(this.position.x, 1.7, this.position.z); },
  };
  const ctx = {
    player: {
      alive: true, position: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.7, 0), height: 1.8,
      getForward: o => o.set(0, 0, -1), punchDegrees: (...a) => calls.punch.push(a),
    },
    enemies: { list: [enemy] }, world: { segmentBlocked: () => false },
    combat: { damageEnemy: () => { calls.damage++; return { immune: false }; } },
    fx: { enemyHit() {}, burst() {}, shake() {} }, audio: { play() {} }, events: { on() {}, emit() {} },
    game: { hitStop: { request: seconds => { calls.stop.push(seconds); return true; } } },
  };
  const view = { onStrike: (i, union) => calls.strike.push([i, union]), onHit: heavy => calls.hit.push(heavy) };
  const R = { legendary: null, legendaryValue: 0, critChance: 0, critMult: 2, damageMult: 1, elementChance: 0 };
  const blade = new DB.DemonBlade(ctx, { resolve: () => R, countShot: () => 1, view: () => view });
  const P = getWeaponDef('demon_blade').blade;
  const slash = idx => blade.resolveSlash({ uid: 7, defId: 'demon_blade', element: 'none' }, R, P, P.combo[idx], idx);
  return { calls, slash };
}

test('controller: judgement frame calls onStrike, hits punch the camera 1.6° / 0.5° and request a 70 / 40 ms hit stop (Unity DemonBladeController)', async () => {
  // Unity Weapons/DemonBlade/DemonBladeController.cs：判定帧 view?.OnStrike(idx, seg, union)（:440）、命中 feel.Punch(heavy ? 1.6 : 0.5, idx == 1 ? 1.4 : −1.4)（:448）、
  // HitStop.Request(heavy ? 0.07 : 0.04)（:450）、pose.slash = seg（:886）
  // 真跑控制器的判定帧：三段各中一次（第三段重击）
  const hit = bladeController();
  for (let idx = 0; idx < 3; idx++) hit.slash(idx);
  assert.equal(hit.calls.damage, 3, '三段各砍中一次');
  assert.deepEqual(hit.calls.strike, [[0, false], [1, false], [2, false]], '判定帧事件（Unity view.OnStrike）');
  assert.deepEqual(hit.calls.hit, [false, false, true], '第一人称命中一磕');
  assert.deepEqual(hit.calls.punch, [[0.5, -1.4], [0.5, 1.4], [1.6, -1.4]], '镜头冲击（Unity feel.Punch）');
  assert.deepEqual(hit.calls.stop, [0.04, 0.04, 0.07], '全局顿帧申请走 ctx.game.hitStop（Unity HitStop.Request）');
  // 空挥：判定帧事件照发，不冲击、不顿帧
  const miss = bladeController(40);
  miss.slash(2);
  assert.equal(miss.calls.damage, 0);
  assert.deepEqual(miss.calls.strike, [[2, false]]);
  assert.deepEqual([miss.calls.punch.length, miss.calls.stop.length, miss.calls.hit.length], [0, 0, 0]);
  const src = await readFile(new URL('../src/weapons/demonBlade/DemonBlade.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /as unknown as \{ (hitStop|punchDegrees)\?/, 'hitStop / punchDegrees 走 IGame / IPlayer 接口，类型检查管得到');
  assert.match(src, /s\.slash = seg;/);
  assert.match(src, /s\.unionStretch = P\.union\.stretch;/);
  near(getWeaponDef('demon_blade').blade.union.stretch, 1.3);
  // 判定帧的镜头一带（BladeView.OnBladeStrike，BladeView.cs:365–367：yaw 二段 0.32 / 三段 −0.5 / 一段 −0.28，pitch 一段 0.22 其余 0.06，
  // roll 二段 −0.25 其余 0.25）在上面「strike event fires once per slash」那条按 punchDegrees 的实参断言
});
