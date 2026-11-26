// M10 第一人称持枪手感对照（Unity Weapons/HandlingProfile.cs + Handling/Profiles/HandlingProfile_<Id>.cs、TwoBoneIK.cs、WeaponHandRig.cs、
// WeaponPartAnimator.cs、WeaponRigFactory.cs、TrinityCycle.cs、RailgunCharge.cs、WeaponTint.cs、Pipeline/Runtime/FirstPersonViewmodel.cs、
// FireModes/WeaponStateMachine.cs 的 CommitLoad → 网页 src/weapons/WeaponHandling.ts、TwoBoneIK.ts、Viewmodel.ts、WeaponSystem.ts、WeaponModels.ts）。
// 期望值照 C# 抄成下面的常量，旁边注明出自哪个文件哪一行（路径相对 unity/Assets/Game/Scripts/，另注的除外）；测试不读 unity/ 下的任何文件
// （unity/ 和 public/assets/unity-* 以后整个删掉）。行为断言照 Unity EditMode 的 WeaponHandlingTests（持握表、换弹手位时间线、两骨 IK、加弹的动画事件）。
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
const num = s => Number(String(s).trim().replace(/f$/, ''));
const vec = s => s.split(',').map(num);

const mathUrl = await ts('../src/core/math.ts');
const typesUrl = await ts('../src/core/types.ts');
const defsUrl = await ts('../src/weapons/WeaponDefs.ts');
const fcUrl = await ts('../src/weapons/FireControl.ts');
const H = await import(await ts('../src/weapons/WeaponHandling.ts'));
const IK = await import(await ts('../src/weapons/TwoBoneIK.ts'));
const { WEAPON_DEFS, getWeaponDef } = await import(defsUrl);
const FC = await import(fcUrl);

// ───────────── 持握表（HandlingProfile） ─────────────

/**
 * Unity 各把 Weapons/Handling/Profiles/HandlingProfile_<Id>.cs：第 14 行 Make(id, LoadingAction.X, ReloadStyle.Y)，第 15 行起 p.xxx = … 改的几项。
 * 装填动作 / 换弹风格写成网页的名字（LoadingAction.CellTop → 'cellTop'，ReloadStyle.Magazine → 'mag'）
 */
const UNITY_PROFILES = {
  beam: { action: 'cellTop', style: 'cell', tweaks: { weight: 1.1 } }, // HandlingProfile_Beam.cs:14
  burst: { action: 'magazine', style: 'mag', tweaks: { weight: 1.05 } }, // HandlingProfile_Burst.cs:14
  crossbow: { action: 'boltClip', style: 'mag', tweaks: { weight: 1.05 } }, // HandlingProfile_Crossbow.cs:14
  flamer: { action: 'cellBottom', style: 'cell', tweaks: { weight: 1.3 } }, // HandlingProfile_Flamer.cs:14
  lantern: { action: 'wick', style: 'cell', tweaks: { weight: 0.9, swayScale: 1.2 } }, // HandlingProfile_Lantern.cs:14
  launcher: { action: 'tube', style: 'tube', tweaks: { cylinderSteps: 4, weight: 1.3 } }, // HandlingProfile_Launcher.cs:14
  magmashot: { action: 'breech', style: 'shell', tweaks: { weight: 1.1 } }, // HandlingProfile_Magmashot.cs:14
  minigun: { action: 'ammoBox', style: 'box', tweaks: { weight: 1.6, swayScale: 0.8, bobScale: 1.15 } }, // HandlingProfile_Minigun.cs:14
  railgun: { action: 'cellTop', style: 'cell', tweaks: { weight: 1.3, swayScale: 0.9 } }, // HandlingProfile_Railgun.cs:14
  revolver: { action: 'speedloader', style: 'cylinder', tweaks: { cylinderSteps: 8, weight: 0.7 } }, // HandlingProfile_Revolver.cs:14
  rifle: { action: 'magazine', style: 'mag', tweaks: { weight: 1 } }, // HandlingProfile_Rifle.cs:14
  shotgun: { action: 'shell', style: 'shell', tweaks: { pumpStroke: 0.075, weight: 1.15 } }, // HandlingProfile_Shotgun.cs:14
  smg: { action: 'magazine', style: 'mag', tweaks: { weight: 0.85, swayScale: 1.1 } }, // HandlingProfile_Smg.cs:14
  sniper: { action: 'magazine', style: 'mag', tweaks: { weight: 1.25, swayScale: 0.85, bobScale: 0.85 } }, // HandlingProfile_Sniper.cs:14
  stormpod: { action: 'drum', style: 'cylinder', tweaks: { cylinderSteps: 5, weight: 1.2 } }, // HandlingProfile_Stormpod.cs:14
  swarm: { action: 'tube', style: 'tube', tweaks: { weight: 1.35 } }, // HandlingProfile_Swarm.cs:14
  trinity: { action: 'speedloader', style: 'cylinder', tweaks: { weight: 0.7 } }, // HandlingProfile_Trinity.cs:14
};

test('handling: every gun has the Unity HandlingProfile (action, reload style tilt, per-gun weight / sway / bob / cylinder / pump)', () => {
  const U = UNITY_PROFILES;
  assert.equal(Object.keys(U).length, 17, 'Unity 17 把枪各一份');
  for (const [id, u] of Object.entries(U)) {
    const p = H.WEAPON_HANDLING[id];
    assert.ok(p, id);
    assert.equal(p.action, u.action, `${id} 装填动作`);
    const def = getWeaponDef(id);
    assert.equal(def.reloadStyle, u.style, `${id} 换弹风格`);
    // 预设 + 改的几项 = 网页表
    const expect = H.makeHandling(p, u.action, u.style, u.tweaks);
    for (const k of ['weight', 'swayScale', 'bobScale', 'cylinderSteps', 'pumpStroke', 'reachRoll', 'reachPitch', 'magPitch', 'magHideAt', 'loadAt', 'reachEnd']) near(p[k], expect[k], `${id}.${k}`);
    assert.deepEqual([...p.tiltRot], [...expect.tiltRot], `${id} tiltRot`);
    assert.deepEqual([...p.tiltPos], [...expect.tiltPos], `${id} tiltPos`);
    assert.deepEqual([...p.magOffset], [...expect.magOffset], `${id} magOffset`);
    for (const [k, v] of Object.entries(u.tweaks)) near(p[k], v, `${id}.${k}（HandlingProfile_${id}.cs）`);
  }
  // 碎刃不走枪的持握（Unity HandlingProfile.For 返回 null）；网页表留着那一行只为覆盖全部武器
  assert.equal(H.WEAPON_HANDLING.demon_blade.action, 'recall');
});

/**
 * 握点（M2 留给 M10 的 rightHand / rightPitch / leftHand / leftRoll）：Unity 武器表 Weapons/Defs/Weapon_<Id>.cs 写握持的那几行
 * （行号见各行末），是 Unity 坐标——Grip() 已经把 TS 的 x 取反。碎刃不写握持（全 0）。
 */
const UNITY_GRIPS = [
  { id: 'revolver', rightHand: [0, -0.003, 0], rightPitch: -0.02, leftHand: [0.034, -0.04, 0.035], leftRoll: 0.65 }, // Weapon_Revolver.cs:24
  { id: 'smg', rightHand: [0, 0, 0], rightPitch: 0, leftHand: [0, 0.02, -0.235], leftRoll: 0.04 }, // Weapon_Smg.cs:29
  { id: 'rifle', rightHand: [0, -0.055, 0.015], rightPitch: -0.05, leftHand: [0, 0.025, -0.105], leftRoll: -0.08 }, // Weapon_Rifle.cs:26
  { id: 'burst', rightHand: [0, 0, 0], rightPitch: 0, leftHand: [0, -0.005, -0.24], leftRoll: 0.1 }, // Weapon_Burst.cs:8
  { id: 'shotgun', rightHand: [0, 0.006, 0.02], rightPitch: -0.12, leftHand: [0, -0.002, -0.3], leftRoll: 0 }, // Weapon_Shotgun.cs:25
  { id: 'sniper', rightHand: [0, -0.001, 0.01], rightPitch: -0.06, leftHand: [0, 0.004, -0.3], leftRoll: -0.06 }, // Weapon_Sniper.cs:10
  { id: 'launcher', rightHand: [0, 0, 0], rightPitch: 0, leftHand: [0, -0.01, -0.27], leftRoll: 0 }, // Weapon_Launcher.cs:30
  { id: 'crossbow', rightHand: [0, -0.004, 0.008], rightPitch: 0.02, leftHand: [0, 0.01, -0.25], leftRoll: -0.1 }, // Weapon_Crossbow.cs:32
  { id: 'beam', rightHand: [0, 0, 0], rightPitch: 0, leftHand: [0, 0, -0.17], leftRoll: 0 }, // Weapon_Beam.cs:24
  { id: 'minigun', rightHand: [0, -0.012, -0.005], rightPitch: 0.12, leftHand: [0.085, 0.03, -0.2], leftRoll: 0.6 }, // Weapon_Minigun.cs:9
  { id: 'swarm', rightHand: [0, -0.006, 0.008], rightPitch: 0.06, leftHand: [0, 0, -0.2], leftRoll: 0.3 }, // Weapon_Swarm.cs:9
  { id: 'flamer', rightHand: [0, -0.003, 0.014], rightPitch: -0.04, leftHand: [0, -0.03, -0.26], leftRoll: 0.45 }, // Weapon_Flamer.cs:10
  { id: 'stormpod', rightHand: [0, 0, 0], rightPitch: 0, leftHand: [0, -0.02, -0.2], leftRoll: 0 }, // Weapon_Stormpod.cs:34
  { id: 'magmashot', rightHand: [0, 0.006, 0.02], rightPitch: -0.1, leftHand: [0, -0.02, -0.16], leftRoll: -0.12 }, // Weapon_Magmashot.cs:34
  { id: 'trinity', rightHand: [0, -0.003, 0], rightPitch: -0.02, leftHand: [0.034, -0.04, 0.03], leftRoll: 0.58 }, // Weapon_Trinity.cs:29
  { id: 'railgun', rightHand: [0, -0.001, 0.01], rightPitch: 0, leftHand: [0, -0.02, -0.32], leftRoll: -0.18 }, // Weapon_Railgun.cs:31
  { id: 'lantern', rightHand: [0, 0.008, 0.004], rightPitch: 0.12, leftHand: [0, -0.02, -0.12], leftRoll: 0.2 }, // Weapon_Lantern.cs:37
  { id: 'demon_blade', rightHand: [0, 0, 0], rightPitch: 0, leftHand: [0, 0, 0], leftRoll: 0 }, // Weapon_DemonBlade.cs（没写握持）
];
/** 三位英雄的第一人称手臂（M2 留给 M10 的 armR / armL） */
const UNITY_HERO_ARMS = [
  { id: 'fox', armR: 'SM_Arms_RedPandaR', armL: 'SM_Arms_RedPandaL' }, // Skills/Heroes/Hero_Liao.cs:21–22
  { id: 'falcon', armR: 'SM_Arms_FlyingSquirrelR', armL: 'SM_Arms_FlyingSquirrelL' }, // Skills/Heroes/Hero_Falcon.cs:22–23
  { id: 'bear', armR: 'SM_Arms_PangolinR', armL: 'SM_Arms_PangolinL' }, // Skills/Heroes/Hero_Bear.cs:22–23
];
/**
 * 例外各带原因：
 * - rifle：Unity 的裂风步枪换成了原作模型 SK_Weapon_Gunfire1001（Weapon_Rifle.cs:17 prefab，GunfireOriginal，不迁），握点是按那支枪量的；
 *   网页仍是自己的步枪模型，握点跟它走。
 * - launcher / beam / stormpod 的右手偏移、右手俯仰、左手横滚：Unity 移植时武器表里没写（上表全是 0，从来没有过别的值），
 *   而网页这几项在 Unity 移植之前（2026-10-04）就调好、对的是同一份美术枪模，保留网页。左手握点照样一致。
 */
const GRIP_EXCEPTIONS = { rifle: ['right', 'left'], launcher: ['right', 'pitch', 'roll'], beam: ['right', 'pitch', 'roll'], stormpod: ['right', 'pitch', 'roll'] };
test('grips: right hand / pitch, left grip / roll equal the Unity weapon table (Weapon_<Id>.cs; documented exceptions)', async () => {
  const weapons = UNITY_GRIPS;
  const models = await readFile(new URL('../src/weapons/WeaponModels.ts', import.meta.url), 'utf8');
  const builders = Object.fromEntries([...models.matchAll(/^  (\w+): build(\w+),$/gm)].map(m => [m[1], m[2]]));
  /** 枪模的左手握点（buildXxx 里的 m.leftHand；挂在泵上的再加泵的位置） */
  const modelLeft = id => {
    const body = models.split(`function build${builders[id]}(`)[1]?.split(/\nfunction /)[0] ?? '';
    const m = body.match(/m\.leftHand = new THREE\.Vector3\(([^)]+)\)/);
    if (!m) return null;
    const v = vec(m[1]);
    if (/m\.leftParent = pump/.test(body)) {
      const p = vec(body.match(/const pump = b\.group\(r, ([^)]+)\)/)[1]);
      return v.map((x, i) => x + p[i]);
    }
    return v;
  };
  let checked = 0;
  for (const w of weapons) {
    const h = H.WEAPON_HANDLING[w.id];
    assert.ok(h, `网页缺 ${w.id} 的持握`);
    const skip = GRIP_EXCEPTIONS[w.id] ?? [];
    const flip = v => [-v[0], v[1], v[2]];
    if (!skip.includes('right')) assert.deepEqual(flip(h.right).map(v => v + 0), w.rightHand, `${w.id} 右手`);
    if (!skip.includes('pitch')) near(h.rightPitch, w.rightPitch, `${w.id} 右手俯仰`);
    if (!skip.includes('roll')) near(h.leftRoll, w.leftRoll, `${w.id} 左手横滚`);
    if (!skip.includes('left') && w.id !== 'demon_blade') {
      const left = h.support ?? modelLeft(w.id);
      assert.ok(left, `${w.id} 左手握点`);
      left.forEach((v, i) => near(flip(left)[i], w.leftHand[i], `${w.id} 左手握点 ${'xyz'[i]}`, 1e-6));
    }
    checked++;
  }
  assert.equal(checked, 18);
  // 例外只是右手 / 俯仰 / 横滚三项（Unity 表这三项全 0），左手握点照样逐把比过了
  const table = Object.fromEntries(weapons.map(w => [w.id, w]));
  for (const id of ['launcher', 'beam', 'stormpod']) {
    assert.deepEqual([table[id].rightHand, table[id].rightPitch, table[id].leftRoll], [[0, 0, 0], 0, 0], `${id}：Unity 武器表没写握持`);
  }
  // 英雄的第一人称手臂（M2 留给 M10 的 HeroDef.armR / armL）：网页按清单 bind = fp / 英雄 / arm_r|arm_l 挂同一份资产
  const manifest = JSON.parse(await readFile(new URL('../public/assets/manifest.json', import.meta.url), 'utf8'));
  const entries = Array.isArray(manifest.assets) ? manifest.assets : Object.entries(manifest.assets ?? manifest).map(([key, v]) => ({ key, ...v }));
  const heroes = UNITY_HERO_ARMS;
  assert.equal(heroes.length, 3);
  for (const h of heroes) {
    for (const [side, key] of [['arm_r', h.armR], ['arm_l', h.armL]]) {
      const a = entries.find(e => e.key === key);
      assert.ok(a, `清单里没有 ${key}`);
      assert.deepEqual(a.bind, { source: 'fp', id: h.id, attachment: side }, `${h.id} ${side}`);
    }
  }
});

/** Unity Weapons/HandlingProfile.cs 的字段默认值（第 29–49 行 public float …） */
const HP_DEFAULTS = {
  reachEnd: 0.14, // :29
  magOutStart: 0.12, magOutEnd: 0.38, magInStart: 0.55, magInEnd: 0.78, // :30
  loadAt: 0.78, // :31
  finishStart: 0.78, finishEnd: 0.88, // :32
  magHideAt: 1, // :38
  cylinderSwing: -0.045, // :42
  cylinderSpin: 14, // :44
  weight: 1, swayScale: 1, bobScale: 1, // :47
};
/** HandlingProfile.Make 里 switch (style) 的 case ReloadStyle.X: p.tiltRot = …; p.tiltPos = …;（第 67–72 行） */
const HP_STYLES = {
  mag: { rot: [0.12, 0, 0.45], pos: [-0.045, 0.05, 0.02] }, // :67 Magazine
  cylinder: { rot: [0.1, 0, 0.75], pos: [-0.04, 0, 0] }, // :68
  tube: { rot: [0.5, 0, 0.15], pos: [0, -0.04, 0.04] }, // :69
  cell: { rot: [0.12, 0, 0.3], pos: [-0.02, 0, 0] }, // :70
  box: { rot: [0, 0, 0.28], pos: [-0.02, -0.05, 0] }, // :71
  shell: { rot: [0.1, 0, -0.38], pos: [-0.015, 0.015, 0] }, // :72
};
/** HandlingProfile.Make 里 switch (action) 各 case 改的项（第 77–87 行；Speedloader 与 Drum 同一段、Shell 与 Breech 同一段） */
const HP_ACTIONS = {
  magazine: { magOffset: [0, -0.14, 0.03], magPitch: 0.3 }, // :77
  boltClip: { magOffset: [0, 0.13, 0.03], magPitch: -0.25, reachRoll: -0.9 }, // :78
  cellTop: { magOffset: [0.03, 0.12, 0], reachRoll: -0.9 }, // :79
  wick: { magOffset: [0.03, 0.12, 0], reachRoll: -0.9 }, // :80
  cellBottom: { magOffset: [0.03, -0.16, 0] }, // :81
  tube: { magOffset: [0, -0.02, 0.12], reachRoll: 0.65, magHideAt: 0.85 }, // :82
  ammoBox: { magOffset: [-0.02, -0.24, 0] }, // :83
  drum: { reachRoll: -1.25 }, // :85
  speedloader: { reachRoll: -1.25 }, // :84–85
  breech: { reachPitch: -0.3 }, // :87
  shell: { reachPitch: -0.3 }, // :86–87
};
/** 弹药袋 Pouch = WeaponDef.Grip(-0.11, -0.21, 0.08)（HandlingProfile.cs:114，括号里是 TS 原值；Unity 里 Grip 把 x 取反） */
const HP_POUCH = [-0.11, -0.21, 0.08];

test('handling: Make presets and the default timeline match HandlingProfile.cs', () => {
  const def = H.makeHandling({ right: [0, 0, 0], rightPitch: 0, leftRoll: 0, load: [0, 0, 0], finish: [0, 0, 0] }, 'magazine', 'mag');
  for (const [k, v] of Object.entries(HP_DEFAULTS)) near(def[k], v, k);
  // 伸手手型的默认值（:49）：没改过的装填动作保留
  near(H.makeHandling(def, 'cellBottom', 'box').reachRoll, 0.35, 'reachRoll 默认');
  near(H.makeHandling(def, 'magazine', 'box').reachPitch, 0.12, 'reachPitch 默认');
  // 换弹风格 → 姿态
  assert.equal(Object.keys(HP_STYLES).length, 6);
  for (const [s, { rot, pos }] of Object.entries(HP_STYLES)) {
    const p = H.makeHandling(def, 'recall', s);
    assert.deepEqual([...p.tiltRot], rot, `${s} tiltRot`);
    assert.deepEqual([...p.tiltPos], pos, `${s} tiltPos`);
  }
  // 装填动作 → 弹匣离位 / 俯仰 / 隐藏 / 伸手手型
  let checked = 0;
  for (const [action, expect] of Object.entries(HP_ACTIONS)) {
    const p = H.makeHandling(def, action, 'box');
    for (const [k, v] of Object.entries(expect)) {
      if (Array.isArray(v)) assert.deepEqual([...p[k]], v, `${action} ${k}`);
      else near(p[k], v, `${action}.${k}`);
    }
    checked++;
  }
  assert.equal(checked, 11, '11 种装填动作');
  assert.deepEqual([...H.POUCH], HP_POUCH);
});

test('handling: every gun has a profile matching its reload style (Unity EveryGunHasAHandlingProfileMatchingItsReloadStyle)', () => {
  let n = 0;
  for (const def of WEAPON_DEFS) {
    if (def.blade) continue;
    const p = H.WEAPON_HANDLING[def.id];
    assert.ok(p, def.id);
    assert.equal(def.shellTime > 0 && def.reloadStyle === 'shell', H.isShellAction(p.action), `${def.id}：逐发装填与换弹风格不一致`);
    assert.ok(p.weight > 0.2, def.id);
    assert.ok(p.loadAt >= p.magInEnd - 1e-4 && p.loadAt <= p.finishEnd, `${def.id}：弹匣入位（加弹）要在装入之后、收尾之前`);
    n++;
  }
  assert.equal(n, 17);
  assert.equal(H.WEAPON_HANDLING.revolver.cylinderSteps, 8);
  assert.equal(H.WEAPON_HANDLING.trinity.cylinderSteps, 0, '三才转轮由 TrinityCycle 那一路转');
  assert.ok(H.WEAPON_HANDLING.shotgun.pumpStroke > 0.05);
  assert.ok(H.WEAPON_HANDLING.minigun.weight > H.WEAPON_HANDLING.smg.weight, '机炮比冲锋枪重');
});

test('handling: mag curve and envelope follow the Three.js timeline (Unity MagCurveAndEnvelopeFollowThreeJs)', () => {
  const p = H.WEAPON_HANDLING.smg;
  near(H.magOut(p, 0.1), 0);
  near(H.magOut(p, 0.45), 1, '38–55% 离位');
  near(H.magOut(p, 0.25), 0.5, '12–38% 的中点');
  near(H.magOut(p, 0.8), 0, '78% 以后装回去了');
  near(H.reloadEnvelope(0), 0);
  near(H.reloadEnvelope(0.5), 1);
  near(H.reloadEnvelope(1), 0);
});

test('handling: magazine hand goes grip → load → finish → grip (Unity MagazineHandGoesGripLoadFinishGrip)', () => {
  const p = { ...H.WEAPON_HANDLING.rifle, leftRoll: 0.1 };
  const grip = [0, 0.006, -0.36], load = [-0.015, -0.065, -0.095], finish = [-0.04, 0.06, 0.005];
  const out = {};
  const at = o => [o.x, o.y, o.z];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  H.sampleLoadingHand(p, 0, grip, load, out, true, finish);
  assert.ok(dist(at(out), grip) < 1e-5, '开始在握点');
  near(out.roll, 0.1);
  near(out.pitch, 0);
  H.sampleLoadingHand(p, 0.5, grip, load, out, true, finish);
  assert.ok(dist(at(out), load) < 1e-5, '中段在送弹口');
  near(out.roll, p.reachRoll, '伸手的手型');
  H.sampleLoadingHand(p, 0.88, grip, load, out, true, finish);
  assert.ok(dist(at(out), finish) < 1e-5, '88% 到收尾点');
  H.sampleLoadingHand(p, 1, grip, load, out, true, finish);
  assert.ok(dist(at(out), grip) < 1e-5, '回到握点');
  near(out.roll, 0.1);
});

test('handling: shell hand shuttles pouch → port (Unity ShellHandShuttlesPouchToPort)', () => {
  const p = H.WEAPON_HANDLING.shotgun;
  const grip = [0, -0.002, -0.3], load = [-0.018, -0.03, -0.08];
  const out = {};
  const dist = (o, b) => Math.hypot(o.x - b[0], o.y - b[1], o.z - b[2]);
  H.sampleLoadingHand(p, 0.22, grip, load, out, true, load);
  assert.ok(dist(out, H.POUCH) < 1e-5, '22% 在弹药袋');
  near(out.pitch, p.reachPitch);
  H.sampleLoadingHand(p, 0.88, grip, load, out, true, load);
  assert.ok(dist(out, load) < 1e-5, '88% 送到装填口');
  H.sampleLoadingHand(p, 0, grip, load, out, false, load);
  assert.ok(dist(out, load) < 1e-5, '第二发起从装填口出发，不跳回握点');
});

// ───────────── 两骨 IK ─────────────

test('two-bone IK keeps lengths and bends toward the pole (Unity TwoBoneIkKeepsLengthsAndBendsTowardPole)', () => {
  const root = new THREE.Vector3(0.1, -0.3, 0.25), target = new THREE.Vector3(0, 0.02, -0.2), pole = new THREE.Vector3(0.3, -0.4, 0);
  const e = new THREE.Vector3();
  assert.equal(IK.solveTwoBone(root, target, 0.3, 0.3, pole, e), true);
  near(root.distanceTo(e), 0.3, '上臂长不变', 1e-4);
  near(target.distanceTo(e), 0.3, '前臂长不变', 1e-4);
  const mid = root.clone().add(target).multiplyScalar(0.5);
  assert.ok(e.clone().sub(mid).dot(pole.clone().sub(mid)) > 0, '肘往提示点那边弯');
  const far = root.clone().add(target.clone().sub(root).normalize().multiplyScalar(2));
  assert.equal(IK.solveTwoBone(root, far, 0.3, 0.3, pole, e), false, '够不着');
  near(root.distanceTo(e), 0.3, '伸直时肘在上臂末端', 1e-3);
});

test('forearm rotation is identity at rest and swings with the elbow (Unity ForearmRotationIsIdentityAtRestAndSwingsWithElbow)', () => {
  const hand = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -6 * Math.PI / 180));
  const axis = new THREE.Vector3(0.094, -0.15, 0.162).normalize();
  const h = new THREE.Vector3(0, 0.02, -0.235);
  const e = h.clone().add(axis.clone().applyQuaternion(hand).multiplyScalar(0.3));
  const r = new THREE.Quaternion();
  IK.forearmRotation(hand, axis, h, e, r);
  assert.ok(r.angleTo(hand) < 0.01 * Math.PI / 180, '静止时就是摆好的手型');
  const lower = h.clone().add(new THREE.Vector3(0, -0.3, 0));
  IK.forearmRotation(hand, axis, h, lower, r);
  assert.ok(axis.clone().applyQuaternion(r).angleTo(new THREE.Vector3(0, -1, 0)) < 0.01 * Math.PI / 180, '前臂指向肘');
});

/**
 * Unity Weapons/WeaponHandRig.cs：shoulder / pole（:23，Unity 相机空间 z 朝前）、upperArmLength / forearmLength（:25）、ikWeight / maxSwing（:27）。
 * 平时刚性跟着握点走、偏差按 Exp(-20·dt) 衰减（:134）；整匣换弹过了 loadAt 调 sm.CommitLoad()（:128）——这两条在下面 viewmodel 的用例里按行为断言
 */
const HAND_RIG = { shoulder: [-0.19, -0.26, -0.05], pole: [-0.55, -0.6, 0.3], upperArm: 0.42, forearm: 0.40, weight: 0.7, maxSwing: 35 };

test('hand rig IK constants match WeaponHandRig.cs (camera space z flipped)', () => {
  const { shoulder: sh, pole: po } = HAND_RIG;
  assert.deepEqual([...IK.HAND_IK.shoulder], [sh[0], sh[1], -sh[2]]);
  assert.deepEqual([...IK.HAND_IK.pole], [po[0], po[1], -po[2]]);
  near(IK.HAND_IK.upperArm, HAND_RIG.upperArm);
  near(IK.HAND_IK.forearm, HAND_RIG.forearm);
  near(IK.HAND_IK.weight, HAND_RIG.weight);
  near(IK.HAND_IK.maxSwingDeg, HAND_RIG.maxSwing);
});

// ───────────── 枪模姿态（FirstPersonViewmodel）与零件 ─────────────

const flashTex = new THREE.Texture();
const gunModelsStub = data(`
import * as THREE from '${threeUrl}';
export const ART_GLOW = { 0: 0.5, 1: 0.8, 2: 1.1, 3: 1.5, 4: 2.0 };
export const ART_GLOW_BASE = 1.6;
export const boxGeo = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const solidMat = c => new THREE.MeshStandardMaterial({ color: c });
export const getFlashTexture = () => new THREE.Texture();
export function setCrossbowString() {}
export function buildGunModel(defId) {
  const root = new THREE.Group();
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.03, -0.4); root.add(muzzle);
  const mag = new THREE.Group(); mag.name = 'mag'; mag.position.set(0, -0.04, -0.12); root.add(mag);
  const isCyl = ['revolver', 'trinity', 'stormpod', 'launcher'].includes(defId);
  const art = new THREE.MeshStandardMaterial(); art.userData.glowBase = new THREE.Color(1.6, 1.6, 1.6);
  return {
    root, muzzle, mag, cylinder: isCyl ? mag : null, cylinderSteps: defId === 'trinity' ? 6 : 8, spinner: null, pump: defId === 'shotgun' ? new THREE.Group() : null,
    bolt: null, stringHalves: null, stringTip: null, energy: [], leftHand: new THREE.Vector3(0, 0.02, -0.235), leftParent: null, artGlow: art, blade: null,
  };
}`);
const vmImports = {
  '../core/types': typesUrl,
  '../core/math': mathUrl,
  './WeaponDefs': defsUrl,
  './WeaponModels': gunModelsStub,
  './demonBlade/BladeView': data('export class BladeView {} export function createBladePoseInput() { return { swing: -1, swingP: 0, hitP: 0.3, slash: null, unionStretch: 1.3, gesture: "none", union: 0, eye: 0, qi: 1 }; }'),
  '../assets/AssetLibrary': data('export const AssetLibrary = { findAttachments: () => [] };'),
  '../assets/ArtEnvironment': data('export function applyArtEnvironment() {}'),
  '../assets/StaticAttachment': data('export function attachStaticPart() { return null; }'),
  './WeaponHandling': await ts('../src/weapons/WeaponHandling.ts'),
  './TwoBoneIK': await ts('../src/weapons/TwoBoneIK.ts'),
  './FireControl': fcUrl,
  './ReloadBreech': data(`import * as THREE from '${threeUrl}'; export function addReloadBreech(root) { const g = new THREE.Group(); root.add(g); return g; }`),
  '../assets/OriginalWeaponLibrary': data('export const OriginalWeaponLibrary = { get: () => null, loaded: () => null };'),
  './OriginalWeaponView': data('export class OriginalRecoil {} export class OriginalWeaponView {}'),
};
const VM = await import(await ts('../src/weapons/Viewmodel.ts', vmImports));
/** 原作枪模（GunfireOriginal，不迁）预载好了的 Viewmodel：smg / revolver / railgun 走 OriginalWeaponView（桩），同 NATIVE_VIEWMODEL_WEAPONS */
const VMO = await import(await ts('../src/weapons/Viewmodel.ts', {
  ...vmImports,
  '../assets/OriginalWeaponLibrary': data(`export const OriginalWeaponLibrary = { get: () => null,
    loaded: id => (['smg', 'revolver', 'railgun'].includes(id) ? { gltf: {}, motion: {} } : null) };`),
  './OriginalWeaponView': data(`import * as THREE from '${threeUrl}';
export class OriginalRecoil { constructor() { this.position = new THREE.Vector3(); this.rotation = new THREE.Euler(); } update() {} fire() {} reset() {} }
export class OriginalWeaponView {
  constructor() { this.root = new THREE.Group(); this.muzzle = new THREE.Object3D(); this.root.add(this.muzzle);
    this.hip = new THREE.Vector3(0.2, -0.13, -0.6); this.aim = new THREE.Vector3(0, -0.08, -0.65); }
  update() {} fire() {} dispose() {}
}`),
}));
void flashTex;

function vmHarness(mod = VM) {
  const handlers = {};
  const viewCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 20);
  const ctx = {
    viewCamera, camera: new THREE.PerspectiveCamera(80, 16 / 9, 0.1, 1000), renderer: {},
    events: { on: (k, f) => { (handlers[k] ??= []).push(f); }, emit: (k, p) => (handlers[k] ?? []).forEach(f => f(p)) },
    player: { velocity: new THREE.Vector3(), onGround: true, yaw: 0, isDashing: false, hero: { color: 0x886644, id: 'fox' } },
    input: { enabled: true, mouseDX: 0, mouseDY: 0 }, settings: { invertY: false },
    time: { now: 0, dt: 1 / 60, timeScale: 1, frame: 0 },
  };
  const vm = new mod.Viewmodel(ctx);
  vm.init();
  vm.setVisible(true);
  return { vm, ctx };
}
let uid = 1;
const inst = (defId, element = 'none', rarity = 0) => ({ uid: uid++, defId, rarity, element, level: 0, mag: 10, reserve: 100, affixes: [] });

/** Unity Pipeline/Runtime/FirstPersonViewmodel.cs（路径相对 unity/Assets/）第 63–67 行的 const float 全部 */
const FPV_CONSTS = {
  BobAmp: 0.011, BobRoll: 0.018, Breath: 0.0032, SwayClampX: 0.05, SwayClampY: 0.04, // :63
  RollPerSpeed: 0.009, RollClamp: 0.07, FwdPerSpeed: 0.0022, FwdClamp: 0.02, VyPerSpeed: 0.0022, VyClamp: 0.03, // :64
  LandPerSpeed: 0.0035, LandMax: 0.05, JumpLift: 0.012, // :65
  KickCap: 2.4, // :66
  SubStep: 1 / 240, // :67
};
/** FirstPersonViewmodel.cs 的弹簧 [ω, ζ]：鼠标滞后 / 侧倾 / 前后 / 竖直 / 落地（:213、:217–220，ω 再按 √枪重放慢）与后坐显示（:229–231） */
const FPV_SPRINGS = {
  Sway: [14, 0.62], Roll: [9, 0.8], Fwd: [8, 0.75], Vy: [8, 0.75], Land: [11, 0.42],
  ShownZ: [42, 0.55], ShownRot: [40, 0.55], ShownRoll: [36, 0.6],
};
/** swayAmount（FirstPersonViewmodel.cs:32）；后坐回位 kickZ *= Exp(-15·rec·dt)（:226）、kickRot *= Exp(-12·rec·dt)（:227） */
const FPV_SWAY_AMOUNT = 0.00042;
const FPV_KICK_DECAY = { z: 15, rot: 12 };
/**
 * 枪模后坐缩放 ViewKickScale 0.55（Weapons/WeaponController.cs:110），向后那一路再 × 0.76（:555 view?.Kick(def.kickBack * 0.76f * ViewKickScale * strength, …)）；
 * 枪模整体缩放 ViewmodelScale 0.76（Core/PlayerFactory.cs:50）；碎刃的 Sway 枪重 / 晃动 / 摆动（Weapons/DemonBlade/BladeView.cs:172–174）
 */
const VIEW_KICK_SCALE = 0.55;
const VIEWMODEL_SCALE = 0.76;
const BLADE_SWAY = { weight: 0.85, swayScale: 1.1, bobScale: 0.9 };

test('viewmodel feel constants match FirstPersonViewmodel.cs + WeaponController ViewKickScale', async () => {
  const F = VM.VM_FEEL;
  for (const [k, v] of Object.entries(FPV_CONSTS)) {
    assert.ok(k in F, `网页缺 ${k}`);
    near(F[k], v, k);
  }
  near(F.SwayAmount, FPV_SWAY_AMOUNT);
  for (const [key, spring] of Object.entries(FPV_SPRINGS)) assert.deepEqual([...F[key]], spring, key);
  near(F.RecZ, FPV_KICK_DECAY.z); near(F.RecRot, FPV_KICK_DECAY.rot); near(F.RecRoll, FPV_KICK_DECAY.rot);
  near(VM.VIEW_KICK_SCALE, VIEW_KICK_SCALE);
  near(VM.VIEW_KICK_SCALE, FC.WEAPON_FEEL.ViewKickScale, 'Viewmodel 用的就是 FireControl 那份');
  // 向后那一路再乘 VM_SCALE（0.76）
  const vm = await readFile(new URL('../src/weapons/Viewmodel.ts', import.meta.url), 'utf8');
  assert.match(vm, /VM_SCALE \* VIEW_KICK_SCALE/);
  near(VM.VM_SCALE, VIEWMODEL_SCALE);
  // 碎刃的 Sway（BladeView.Build）
  near(H.BLADE_SWAY.weight, BLADE_SWAY.weight);
  near(H.BLADE_SWAY.swayScale, BLADE_SWAY.swayScale);
  near(H.BLADE_SWAY.bobScale, BLADE_SWAY.bobScale);
});

test('viewmodel: kick stacks to 2.4× and decays slower on heavier guns; the shown kick goes through the spring', () => {
  const { vm } = vmHarness();
  const s = VM.createViewmodelState();
  const run = (defId) => {
    vm.setWeapon(inst(defId));
    for (let i = 0; i < 5; i++) vm.onShot(getWeaponDef(defId), 0xffffff, 1);
    const peak = [];
    let min = Infinity, max = -Infinity;
    for (let f = 0; f < 60; f++) {
      vm.update(1 / 60, s);
      const d = vm.debug();
      peak.push(d.kickBack);
      max = Math.max(max, d.kickBack);
      min = Math.min(min, d.kickBack);
    }
    return { peak, max, min };
  };
  const def = getWeaponDef('smg');
  const smg = run('smg');
  assert.ok(smg.max <= def.kick.back * VM.VM_SCALE * VM.VIEW_KICK_SCALE * 2.4 * 1.25, '叠加有上限');
  assert.ok(smg.peak.indexOf(smg.max) >= 1, '显示走弹簧：后坐过一两帧才到峰（不是瞬移）');
  const mini = run('minigun');
  const t = r => r.peak.findIndex(v => v < r.max * 0.2);
  // 机炮 1.6 倍重：回位比冲锋枪慢（单位后坐量归一）
  assert.ok(t(mini) > t(smg), `重枪回位慢：机炮 ${t(mini)} 帧 vs 冲锋枪 ${t(smg)} 帧`);
});

test('viewmodel: landing pushes the gun down by ≈ min(5 cm, v × 0.0035) × weight^0.3 and springs back', () => {
  const { vm, ctx } = vmHarness();
  const s = VM.createViewmodelState();
  vm.setWeapon(inst('rifle'));
  ctx.events.emit('player:landed', { fallSpeed: 10 });
  let peak = 0, low = 0;
  for (let f = 0; f < 90; f++) {
    vm.update(1 / 60, s);
    peak = Math.max(peak, vm.debug().land);
    low = Math.min(low, vm.debug().land);
  }
  assert.ok(peak > 0.02 && peak < 0.05, `下沉 ${peak}`);
  assert.ok(low < 0, '压下去再弹一下（ζ 0.42）');
  near(vm.debug().land, 0, '回到原位', 2e-3);
});

test('viewmodel: full reload tilts by the profile envelope, seats at loadAt (commit event once) and the left hand reaches the port', () => {
  const { vm } = vmHarness();
  const s = VM.createViewmodelState();
  let commits = 0;
  vm.onCommitLoad = () => commits++;
  vm.setWeapon(inst('smg'));
  s.reloading = true;
  const prof = H.WEAPON_HANDLING.smg;
  const steps = 120;
  let maxTilt = 0, maxMag = 0, maxHand = 0, swing = 0;
  for (let i = 0; i <= steps; i++) {
    s.reloadP = i / steps;
    vm.update(1 / 60, s);
    const d = vm.debug();
    maxTilt = Math.max(maxTilt, d.reloadTilt);
    maxMag = Math.max(maxMag, d.magOut);
    maxHand = Math.max(maxHand, d.handOffset);
    swing = Math.max(swing, d.forearmSwing);
    if (s.reloadP < prof.loadAt) assert.equal(commits, 0, `进度 ${s.reloadP} 还没入位`);
  }
  assert.equal(commits, 1, '弹匣入位只发一次加弹事件');
  assert.ok(maxTilt > 0.8, '换弹姿态包络');
  assert.ok(maxMag > 0.8, '弹匣离位');
  assert.ok(maxHand > 0.05, '左手离开握点去送弹口');
  assert.ok(swing > 1 && swing <= 35 + 1e-6, `前臂跟 IK 摆动 ${swing}° （≤ 35°）`);
  s.reloading = false;
  for (let i = 0; i < 60; i++) vm.update(1 / 60, s);
  assert.ok(vm.debug().handOffset < 0.005, '换完回到握点');
  assert.ok(vm.debug().forearmSwing < 1, '静止时 IK 不改摆好的握持姿势');
});

test('viewmodel: shell reload ignores the commit event and uses the shell tilt', () => {
  const { vm } = vmHarness();
  const s = VM.createViewmodelState();
  let commits = 0;
  vm.onCommitLoad = () => commits++;
  vm.setWeapon(inst('shotgun'));
  s.reloading = true;
  s.shellMode = true;
  for (let i = 0; i <= 60; i++) {
    s.reloadP = (i % 30) / 29;
    vm.update(1 / 60, s);
  }
  assert.equal(commits, 0, '逐发装填按每一发的时间压弹');
  assert.ok(vm.debug().shellTilt > 0.9);
  near(vm.debug().reloadTilt, 0, '整匣姿态不叠');
});

/** 没有持握表时弹匣入位那一顿的进度：FirstPersonViewmodel.seatAt 默认 0.8（Pipeline/Runtime/FirstPersonViewmodel.cs:40） */
const FPV_SEAT_AT = 0.8;

test('viewmodel: original-model guns (smg / revolver / railgun) seat at the handling loadAt, not the 0.8 default (Unity WeaponRigFactory.Configure writes seatAt before the original branch)', () => {
  // Unity Weapons/WeaponRigFactory.cs：Build 先 Configure(vm, profile)（:51；里面 vm.seatAt = profile.loadAt，:109），
  // 原作分支 if (original) vm.reloadTiltRot = … = Vector3.zero（:52）之后只清换弹 / 逐发姿态，没动 seatAt；也不挂 WeaponHandRig（if (!original)，:65）
  const steps = 200;
  for (const id of ['smg', 'revolver', 'railgun']) {
    const { vm } = vmHarness(VMO);
    vm.setWeapon(inst(id));
    assert.ok(vm.cur?.original, `${id} 走原作枪模`);
    assert.equal(vm.cur.profile, null, `${id} 不套换弹姿态 / 左手（原作分支）`);
    const s = VMO.createViewmodelState();
    const seats = [];
    let commits = 0;
    vm.onCommitLoad = () => commits++;
    vm.seat = () => seats.push(s.reloadP);
    s.reloading = true;
    for (let i = 0; i <= steps; i++) {
      s.reloadP = i / steps;
      vm.update(1 / 60, s);
    }
    const loadAt = H.WEAPON_HANDLING[id].loadAt;
    assert.equal(seats.length, 1, `${id} 一次整匣换弹一顿`);
    near(seats[0], Math.ceil(loadAt * steps - 1e-9) / steps, `${id} 在持握表 loadAt ${loadAt} 那一步一顿（不是默认 0.8）`, 1e-9);
    assert.equal(commits, 0, `${id} 没有左手：不发加弹事件，弹药到时才加`);
  }
  near(VMO.SEAT_AT_DEFAULT, FPV_SEAT_AT, '没有持握表时按 FirstPersonViewmodel.seatAt 默认');
});

/**
 * Unity Weapons/TrinityCycle.cs：FlashGain 0.9 / FlashDecay 14（:20）；甩出 SwingOut 0.045、自转 ReloadSpin 14、锁膛阻尼 LockDamp 25（:18）；
 * 灵纹亮度 0.82 + 0.14·sin(3t) + FlashGain·clamp01(flash)（:80）；换弹中显示第一种元素 int i = reloading ? 0 : w.cycleIndex（:52）
 */
const TRINITY = { flashGain: 0.9, flashDecay: 14, swingOut: 0.045, reloadSpin: 14, lockDamp: 25 };
const trinityGlow = (time, flash) => 0.82 + 0.14 * Math.sin(time * 3) + TRINITY.flashGain * Math.min(1, Math.max(0, flash));

test('viewmodel: trinity glow flashes when the next element changes and shows the first element while reloading (Unity TrinityCycle)', async () => {
  near(VM.TRINITY_FLASH.gain, TRINITY.flashGain);
  near(VM.TRINITY_FLASH.decay, TRINITY.flashDecay);
  for (const [t, f] of [[0, 1], [0.4, 0.5], [1.7, 0], [2.2, 1.6]]) near(VM.trinityPulse(t, f), trinityGlow(t, f), `灵纹亮度 t=${t} flash=${f}`, 1e-9);
  near(VM.trinityPulse(0, 1), 0.82 + 0.9);
  const { vm } = vmHarness();
  const s = VM.createViewmodelState();
  vm.setWeapon(inst('trinity'));
  s.elementHint = 'fire';
  s.cycleIndex = 0;
  vm.update(1 / 60, s);
  near(vm.debug().glowFlash, 0, '第一次显示不闪');
  s.elementHint = 'shock';
  s.cycleIndex = 1;
  vm.update(1 / 60, s);
  assert.ok(vm.debug().glowFlash > 0.7, '换元素亮闪');
  for (let i = 0; i < 20; i++) vm.update(1 / 60, s);
  assert.ok(vm.debug().glowFlash < 0.05, '0.15 s 左右收回');
  // WeaponSystem 在换弹中写第一种元素
  const ws = await readFile(new URL('../src/weapons/WeaponSystem.ts', import.meta.url), 'utf8');
  assert.match(ws, /const next = shown === inst && this\.reloading \? 0 : idx;/);
});

/** Unity Weapons/RailgunCharge.cs:48 灵纹亮度 0.8 + 0.7·clamp01(charge) + (full ? 0.22·sin(34t) : 0.06·sin(18t))；满蓄色 FullChargeColor（Weapons/Ballistics.cs:46，sRGB） */
const railGlow = (charge, full, t) => 0.8 + 0.7 * Math.min(1, Math.max(0, charge)) + (full ? Math.sin(t * 34) * 0.22 : Math.sin(t * 18) * 0.06);
const FULL_CHARGE_COLOR = [0.79, 0.66, 1];

test('railgun charge glow pulse and the energy colour (Unity RailgunCharge)', async () => {
  for (const [c, full, t] of [[1, false, 0], [0.5, true, Math.PI / 68], [0.2, false, 0.31], [1.4, true, 1.05]]) near(VM.chargePulse(c, full, t), railGlow(c, full, t), `蓄力 ${c}`, 1e-9);
  near(VM.chargePulse(1, false, 0), 1.5);
  near(VM.chargePulse(0.5, true, Math.PI / 68), 0.8 + 0.35 + 0.22, '', 1e-9);
  const web = new THREE.Color(0xc9a8ff);
  const srgb = web.getRGB(new THREE.Color(), THREE.SRGBColorSpace);
  const fc = FULL_CHARGE_COLOR;
  near(srgb.r, fc[0], 'r', 0.01); near(srgb.g, fc[1], 'g', 0.01); near(srgb.b, fc[2], 'b', 0.01);
  assert.match(await readFile(new URL('../src/weapons/Firing.ts', import.meta.url), 'utf8'), /FULL_CHARGE_GLOW = 0xc9a8ff/);
});

/**
 * Unity Weapons/WeaponTint.cs：稀有度亮度 Glow = { 0.5, 0.8, 1.1, 1.5, 2.0 }（:26）、MaterialBase 1.6（:27）；
 * 美术材质的发光基准 Art/Weapons/SK_Weapon_Burst/M_Weapon_Burst.mat:85 的 _EmissionColor 是 (1.6, 1.6, 1.6)，和 MaterialBase 一致
 */
const TINT = { glow: [0.5, 0.8, 1.1, 1.5, 2.0], materialBase: 1.6 };

test('weapon tint: element × rarity glow × 1.6, no element keeps the art white grooves (Unity WeaponTint)', async () => {
  const src = await readFile(new URL('../src/weapons/WeaponModels.ts', import.meta.url), 'utf8');
  const art = src.match(/ART_GLOW: Record<Rarity, number> = \{ 0: ([\d.]+), 1: ([\d.]+), 2: ([\d.]+), 3: ([\d.]+), 4: ([\d.]+) \}/);
  assert.ok(art, 'ART_GLOW 表');
  assert.deepEqual(art.slice(1).map(Number), TINT.glow);
  near(Number(src.match(/ART_GLOW_BASE = ([\d.]+);/)[1]), TINT.materialBase);
  assert.match(src, /if \(element === 'none'\) return out\.setRGB\(ART_GLOW_BASE, ART_GLOW_BASE, ART_GLOW_BASE\);/);
  assert.match(src, /const base = weaponGlowColor\(element, rarity\);/);
});

/**
 * Unity Weapons/WeaponPartAnimator.cs：弹匣离位 magOut 按 1 − Exp(−20·dt) 追（:127）、转轮按 1 − Exp(−25·dt)（:135）、
 * 泵动开火后 t1 = (sinceShot − 0.12) / 0.32（:171）、上膛 t2 = rackT / 0.3（:173）
 */
const PART_ANIM = { magRate: 20, cylRate: 25, pumpDelay: 0.12, pumpTime: 0.32, rackTime: 0.3 };

test('part animator: mag offsets / cylinder / pump follow the profile (Unity WeaponPartAnimator)', async () => {
  const vmSrc = await readFile(new URL('../src/weapons/Viewmodel.ts', import.meta.url), 'utf8');
  assert.match(vmSrc, new RegExp(`const t1 = \\(s\\.sinceShot - ${PART_ANIM.pumpDelay}\\) / ${PART_ANIM.pumpTime};`), '泵动时间');
  assert.match(vmSrc, new RegExp(`const t2 = this\\.rackT / ${PART_ANIM.rackTime};`), '上膛时间');
  assert.match(vmSrc, new RegExp(`this\\.magOut = damp\\(this\\.magOut, [^;]+, ${PART_ANIM.magRate}, dt\\);`), '弹匣离位的追随速度');
  assert.match(vmSrc, new RegExp(`this\\.cylAngle = damp\\(this\\.cylAngle, this\\.cylTarget, ${PART_ANIM.cylRate}, dt\\)`), '转轮的追随速度');
  const { vm } = vmHarness();
  const s = VM.createViewmodelState();
  const w = inst('swarm');
  vm.setWeapon(w);
  s.reloading = true;
  s.reloadP = 0.45;
  for (let i = 0; i < 60; i++) vm.update(1 / 60, s);
  assert.ok(vm.debug().magOut > 0.95);
  // 管式装填（雷蛊）塞进去后隐藏
  const mag = vm.root.getObjectByName('mag');
  assert.equal(mag.visible, false, '管式装填：离位到 85% 以后隐藏');
  vm.setWeapon(inst('smg'));
  for (let i = 0; i < 60; i++) vm.update(1 / 60, s);
  const m2 = vm.root.getObjectByName('mag');
  assert.equal(m2.visible, true);
  near(m2.position.y, -0.04 + H.WEAPON_HANDLING.smg.magOffset[1] * vm.debug().magOut, '弹匣下抽 0.14（Unity 收过）', 1e-6);
});

test('hand rests on the grip and the trinity cylinder is left to the cycle (Unity HandRigRestsOnTheGripSocket / PartAnimatorBindsMagButLeavesTrinityCylinderAlone)', async () => {
  const { vm } = vmHarness();
  const s = VM.createViewmodelState();
  vm.setWeapon(inst('smg'));
  for (let i = 0; i < 10; i++) vm.update(1 / 60, s);
  const arm = vm.root.getObjectByName('arm_l');
  const grip = new THREE.Vector3(0, 0.02, -0.235);
  assert.ok(arm.position.distanceTo(grip) < 1e-5, '左手在握点');
  const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, H.WEAPON_HANDLING.smg.leftRoll));
  assert.ok(arm.quaternion.angleTo(rest) < 0.05 * Math.PI / 180, '静止时 IK 不改摆好的握持姿势');

  // 三才：转轮兼弹匣，不按弹匣的偏移 / 俯仰动（归 TrinityCycle：甩出 SwingOut、自转 ReloadSpin、锁膛，TrinityCycle.cs:18）
  const { swingOut: swing, reloadSpin: spin, lockDamp } = TRINITY;
  near(-H.WEAPON_HANDLING.trinity.cylinderSwing, swing, 'SwingOut');
  near(H.WEAPON_HANDLING.trinity.cylinderSpin, spin, 'ReloadSpin');
  assert.match(await readFile(new URL('../src/weapons/Viewmodel.ts', import.meta.url), 'utf8'), new RegExp(`this\\.cylAngle = damp\\(this\\.cylAngle, this\\.cylTarget, ${lockDamp}, dt\\)`));
  vm.setWeapon(inst('trinity'));
  const cyl = vm.root.getObjectByName('mag');
  const base = cyl.position.clone();
  const rotX = cyl.rotation.x;
  s.elementHint = 'fire';
  s.cycleIndex = 0;
  s.reloading = true;
  s.reloadP = 0.45;
  for (let i = 0; i < 60; i++) vm.update(1 / 60, s);
  assert.ok(vm.debug().magOut > 0.95);
  near(cyl.position.y, base.y, '不按弹匣下抽');
  near(cyl.rotation.x, rotX, '不按弹匣俯仰');
  near(cyl.position.x, base.x - swing * vm.debug().magOut, '转轮甩出');
  assert.equal(cyl.visible, true);
});

/**
 * Unity Weapons/BreakAction.cs：OpenAngle 0.48（:15）、BoreX / BoreY / ChamberZ / ShellLength（:18）；
 * 这一发 Smooth((shellProgress − 0.55) / 0.37) 滑进枪管（:51），弹壳只在 0.22 < shellProgress < 0.98 时画（:43）
 */
const BREAK_ACTION = { OpenAngle: 0.48, BoreX: 0.019, BoreY: 0.04, ChamberZ: -0.065, ShellLength: 0.052 };

test('break action: magmashot opens 0.48 rad and slides a shell into alternating barrels (Unity BreakAction)', async () => {
  for (const [k, v] of Object.entries(BREAK_ACTION)) near(VM.BREAK[k], v, k);
  // 55% 以前停在膛口后上方，92% 以后全进去
  near(VM.breakShellPose(0.55, 0, new THREE.Vector3()).y, BREAK_ACTION.BoreY + 0.035, '55% 还没动');
  near(VM.breakShellPose(0.92, 0, new THREE.Vector3()).y, BREAK_ACTION.BoreY, '92% 到底');
  const held = VM.breakShellPose(0.3, 0, new THREE.Vector3());
  const seated = VM.breakShellPose(0.95, 0, new THREE.Vector3());
  near(held.y, 0.075); near(held.z, -0.02);
  near(seated.y, 0.04); near(seated.z, -0.065 - 0.026);
  assert.ok(VM.breakShellPose(0.95, 1, new THREE.Vector3()).x === -seated.x, '两管交替');
  // 赤蛟霰铳手里不拿弹（弹壳画在膛口），泵动霰弹枪手里拿一发
  const { vm } = vmHarness();
  const s = VM.createViewmodelState();
  vm.setWeapon(inst('magmashot'));
  assert.equal(vm.root.getObjectByName('reload.rounds'), undefined);
  s.reloading = true; s.shellMode = true; s.reloadP = 0.5; s.shellsInserted = 1;
  vm.update(1 / 60, s);
  const shell = vm.root.getObjectByName('reload.shell');
  assert.equal(shell.visible, true);
  near(shell.position.x, VM.BREAK.BoreX, '第二发进另一根枪管');
  vm.setWeapon(inst('shotgun'));
  assert.ok(vm.root.getObjectByName('reload.rounds'));
});

// ───────────── 加弹的动画事件（WeaponSystem.commitLoad，Unity WeaponStateMachine.CommitLoad） ─────────────
// Unity Weapons/FireModes/WeaponStateMachine.cs：CommitLoad 的闸门 if (!Reloading || ShellReload || loadCommitted || w == null) return false（:398）；
// 结束换弹时 bool committed = !ShellReload && loadCommitted（:433）、if (rack && !committed) Rack(w)（:439）；到时 if (!loadCommitted) Load(w, R)（:378）。
// 收尾音 Weapons/WeaponController.cs:623：LoadCommitted 且不是逐发装填时只放 weapon_switch 0.45 / 1.25——网页只认「动画事件加的那一匣」（见下面原作枪模那条）。
// 下面几条按这些行为在真 WeaponSystem 上断言。

async function weaponSystem() {
  let vmInstance = null;
  const statsUrl = data('export {}');
  const mod = await import(await ts('../src/weapons/WeaponSystem.ts', {
    '../core/math': mathUrl,
    './Affixes': data('export function rollAffixes() { return []; } export function isLegendaryId() { return false; }'),
    './AffixEffects': data('export class AffixEffects { init() {} flush() {} clear() {} onDamaged() {} }'),
    './Describe': data('export function describeWeapon() { return {}; }'),
    './Firing': data('export class Ballistics { hitscan() {} projectile() {} beamTick() {} beamTrace() {} stopBeam() {} elementOverride() { return null; } } export function makeBeamHit() { return {}; } export const NO_SHOT = {}; export function shotColor() { return 0xffffff; }'),
    './FireControl': fcUrl,
    './FlameCone': data('export class FlameCone { emit() {} } export function flameConeHandles() { return false; }'),
    './RailgunBeam': data('export class RailgunBeams { update() {} clear() {} spawn() {} }'),
    './Viewmodel': data(`export function createViewmodelState() { return { blade: null }; }
      export class Viewmodel { constructor() { this.onCommitLoad = null; globalThis.__vm = this; this.shells = 0; this.racks = 0; }
        init() {} setWeapon() {} prune() {} update() {} clearTransient() {} resetModels() {} setVisible() {} bladeView() { return null; }
        getMuzzleWorld(o) { return o; } onShot() {} dryKick() {} shellInserted() { this.shells++; } rack() { this.racks++; } }`),
    './WeaponDefs': defsUrl,
    './demonBlade/DemonBlade': data('export class DemonBlade { constructor() { this.active = false; this.pose = {}; } init() {} tick() {} stow() {} resetForRun() {} }'),
    './WeaponModels': data('export function buildWorldModel() { return null; }'),
    './WeaponStats': await ts('../src/weapons/WeaponStats.ts', {
      './Affixes': data('export function isLegendaryId() { return false; }'), '../core/math': mathUrl, './WeaponDefs': defsUrl, '../core/Stats': statsUrl,
    }),
  }));
  const audio = [], events = [];
  const keys = new Set(), pressed = new Set();
  const ctx = {
    input: { enabled: true, down: k => keys.has(k), pressed: k => pressed.has(k), wheel: 0 },
    player: { alive: true, stats: { version: 0, get: () => 0, mult: () => 1, add() {}, removeSource() {} }, velocity: new THREE.Vector3(), onGround: true, isDashing: false, addRecoil() {} },
    time: { now: 0 }, run: { flags: {}, chapter: 0 }, rng: { next: () => 0.5, weighted: a => a[0], chance: () => false, pick: a => a[0] },
    events: { on() {}, emit: (k, p) => events.push(k) }, audio: { play: (id, o) => audio.push([id, o]) }, ui: { toast() {} },
    cameraFx: { fovKick: 0 }, enemies: { list: [] }, fx: { shake() {} }, camera: { position: new THREE.Vector3() }, scene: null,
  };
  const ws = new mod.WeaponSystem(ctx);
  vmInstance = globalThis.__vm;
  let t = 0;
  const frame = (reload = false) => {
    if (reload) pressed.add('reload');
    t += 1 / 60;
    ctx.time.now = t;
    ws.update(1 / 60);
    pressed.clear();
  };
  const idle = s => { for (let i = 0, n = Math.round(s * 60); i < n; i++) frame(); };
  const mk = (defId, mag, reserve) => ({ uid: uid++, defId, rarity: 0, element: 'none', level: 0, mag, reserve: reserve ?? getWeaponDef(defId).reserve, affixes: [] });
  return { ws, vm: vmInstance, ctx, frame, idle, mk, audio, events };
}

test('commit load adds ammo early without changing the reload time (Unity CommitLoadAddsAmmoEarlyWithoutChangingReloadTime)', async () => {
  const h = await weaponSystem();
  const def = getWeaponDef('smg');
  const w = h.mk('smg', 3);
  const reserve0 = w.reserve;
  h.ws.slots = [w, null];
  h.frame(true);
  assert.equal(h.ws.isReloading, true);
  assert.equal(h.vm.onCommitLoad !== null, true, '第一人称接上了加弹事件');
  assert.equal(h.ws.commitLoad(), true, '换弹中第一次调：加弹');
  assert.equal(w.mag, def.mag, '动画事件到了就加满');
  assert.equal(w.reserve, reserve0 - (def.mag - 3));
  assert.equal(h.ws.commitLoad(), false, '同一次换弹只加一次');
  assert.equal(h.ws.isReloading, true, '换弹动作还在收尾');
  h.idle(def.reloadTime + 0.1);
  assert.equal(h.ws.isReloading, false);
  assert.equal(w.mag, def.mag, '到时不再重复加');
  assert.equal(w.reserve, reserve0 - (def.mag - 3));
  assert.equal(h.events.filter(e => e === 'weapon:reloaded').length, 1);
  // 弹匣入位已经咔哒一声：收尾只给一声轻的
  assert.ok(h.audio.some(([id, o]) => id === 'weapon_switch' && o?.pitch === 1.25), '收尾的轻声');
});

test('reload without a first-person rig still loads at the end (Unity ReloadWithoutRigStillLoadsAtTheEnd)', async () => {
  const h = await weaponSystem();
  const def = getWeaponDef('rifle');
  const w = h.mk('rifle', 0);
  h.ws.slots = [w, null];
  h.frame(true);
  h.idle(def.reloadTime * 0.9);
  assert.equal(w.mag, 0, '没有动画事件时到时才加（原行为）');
  h.idle(def.reloadTime * 0.2 + 0.1);
  assert.equal(w.mag, def.mag);
  assert.equal(h.ws.isLoadCommitted, true);
});

test('a magazine loaded at the end (original-model smg / revolver / railgun: no hand event) still ends with the reload_end click, not only the soft weapon_switch', async () => {
  // Unity 原作枪不挂 WeaponHandRig，到时 Load → LoadCommitted 也是真，收尾只放轻声；那边原作动画（GunfireOriginalAnimation）自己播原作换弹音。
  // 网页不迁原作动画，所以按「这一匣是不是动画事件加的」选：到时才加的照旧咔哒一声（M10 之前三把枪都是 reload_end 0.85）
  for (const id of ['smg', 'revolver', 'railgun']) {
    const h = await weaponSystem();
    const def = getWeaponDef(id);
    const w = h.mk(id, 0);
    h.ws.slots = [w, null];
    h.frame(true);
    assert.equal(h.ws.isReloading, true, `${id} 开始换弹`);
    h.audio.length = 0;
    h.idle(def.reloadTime + 0.1);
    assert.equal(h.ws.isReloading, false);
    assert.equal(w.mag, def.mag, `${id} 到时加满`);
    const clicks = h.audio.filter(([k]) => k === 'reload_end' || k === 'weapon_switch');
    assert.deepEqual(clicks, [['reload_end', { volume: 0.85 }]], `${id} 换完弹咔哒一声`);
    assert.equal(h.ws.isLoadCommitted, true, '到时加的也算入位（Unity LoadCommitted）');
    assert.equal(h.ws.isLoadedByEvent, false);
  }
  // 动画事件加的那一匣：入位时咔哒，收尾只给轻声（Unity Loaded / Reloaded）
  const h = await weaponSystem();
  const w = h.mk('rifle', 0);
  h.ws.slots = [w, null];
  h.frame(true);
  h.audio.length = 0;
  h.ws.commitLoad();
  h.idle(getWeaponDef('rifle').reloadTime + 0.1);
  assert.equal(h.ws.isLoadedByEvent, true);
  assert.deepEqual(h.audio.filter(([k]) => k === 'reload_end' || k === 'weapon_switch'),
    [['reload_end', { volume: 0.85 }], ['weapon_switch', { volume: 0.45, pitch: 1.25 }]]);
});

test('switching after the mag seats keeps the ammo and counts as a reload (Unity SwitchingAfterTheMagSeatsKeepsTheAmmo)', async () => {
  const h = await weaponSystem();
  const def = getWeaponDef('smg');
  const w = h.mk('smg', 0), other = h.mk('revolver', 8);
  h.ws.slots = [w, other];
  h.frame(true);
  h.ws.commitLoad();
  h.ws.switchTo(1);
  assert.equal(h.ws.isReloading, false);
  assert.equal(w.mag, def.mag, '弹匣已经入位：切走也保留');
  assert.equal(h.events.filter(e => e === 'weapon:reloaded').length, 1, '算一次换弹（秘卷的换弹钩子照常触发）');
  assert.equal(h.vm.racks, 0, '整匣换弹没有上膛动作');
});

test('shell reload ignores commit load (Unity ShellReloadIgnoresCommitLoad)', async () => {
  const h = await weaponSystem();
  const w = h.mk('shotgun', 0);
  h.ws.slots = [w, null];
  h.frame(true);
  assert.equal(h.ws.isReloading, true);
  assert.equal(h.ws.commitLoad(), false, '逐发装填按每一发的时间压弹');
  assert.equal(w.mag, 0);
});
