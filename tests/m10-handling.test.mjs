// M10 第一人称持枪手感对照（Unity Weapons/HandlingProfile.cs + Handling/Profiles/HandlingProfile_<Id>.cs、TwoBoneIK.cs、WeaponHandRig.cs、
// WeaponPartAnimator.cs、WeaponRigFactory.cs、TrinityCycle.cs、RailgunCharge.cs、WeaponTint.cs、Pipeline/Runtime/FirstPersonViewmodel.cs、
// FireModes/WeaponStateMachine.cs 的 CommitLoad → 网页 src/weapons/WeaponHandling.ts、TwoBoneIK.ts、Viewmodel.ts、WeaponSystem.ts、WeaponModels.ts）。
// 数值从 C# 源码读出来比；行为断言照 Unity EditMode 的 WeaponHandlingTests（持握表、换弹手位时间线、两骨 IK、加弹的动画事件）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function ts(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return data(stripTypeScriptTypes(source, { mode: 'transform' }));
}
const unity = path => readFile(new URL(`../unity/Assets/${path}`, import.meta.url), 'utf8');
const cs = path => unity(`Game/Scripts/${path}`);
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

const ACTION = { Magazine: 'magazine', Speedloader: 'speedloader', Drum: 'drum', Shell: 'shell', Breech: 'breech', Tube: 'tube', CellTop: 'cellTop', CellBottom: 'cellBottom', Wick: 'wick', AmmoBox: 'ammoBox', BoltClip: 'boltClip' };
const STYLE = { Magazine: 'mag', Cylinder: 'cylinder', Tube: 'tube', Cell: 'cell', Box: 'box', Shell: 'shell' };

/** Unity 各把 HandlingProfile_<Id>.cs：Make(id, 装填动作, 换弹风格) + 改的几项 */
async function unityProfiles() {
  const dir = new URL('../unity/Assets/Game/Scripts/Weapons/Handling/Profiles/', import.meta.url);
  const out = {};
  for (const f of (await readdir(dir)).filter(n => n.endsWith('.cs'))) {
    const text = await readFile(new URL(f, dir), 'utf8');
    const m = text.match(/HandlingProfile\.Make\("(\w+)", LoadingAction\.(\w+), ReloadStyle\.(\w+)\)/);
    assert.ok(m, f);
    const tweaks = {};
    for (const t of text.matchAll(/p\.(\w+) = (-?[\d.]+)f?;/g)) tweaks[t[1]] = Number(t[2]);
    out[m[1]] = { action: ACTION[m[2]], style: STYLE[m[3]], tweaks };
  }
  return out;
}

test('handling: every gun has the Unity HandlingProfile (action, reload style tilt, per-gun weight / sway / bob / cylinder / pump)', async () => {
  const U = await unityProfiles();
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

test('handling: Make presets and the default timeline match HandlingProfile.cs', async () => {
  const text = await cs('Weapons/HandlingProfile.cs');
  const fields = {};
  for (const m of text.matchAll(/public float ([^;]+);/g)) {
    for (const part of m[1].split(',')) {
      const kv = part.match(/^\s*(\w+)\s*=\s*(-?[\d.]+)f?\s*$/);
      if (kv) fields[kv[1]] = Number(kv[2]);
    }
  }
  const def = H.makeHandling({ right: [0, 0, 0], rightPitch: 0, leftRoll: 0, load: [0, 0, 0], finish: [0, 0, 0] }, 'magazine', 'mag');
  for (const k of ['reachEnd', 'magOutStart', 'magOutEnd', 'magInStart', 'magInEnd', 'loadAt', 'finishStart', 'finishEnd', 'magHideAt', 'cylinderSwing', 'cylinderSpin', 'weight', 'swayScale', 'bobScale']) {
    assert.ok(k in fields, `C# 缺 ${k}`);
    near(def[k], fields[k], k);
  }
  // 换弹风格 → 姿态
  const styles = [...text.matchAll(/case ReloadStyle\.(\w+): p\.tiltRot = new Vector3\(([^)]+)\); p\.tiltPos = new Vector3\(([^)]+)\);/g)];
  assert.equal(styles.length, 6);
  for (const [, s, rot, pos] of styles) {
    const p = H.makeHandling(def, 'recall', STYLE[s]);
    assert.deepEqual([...p.tiltRot], vec(rot), `${s} tiltRot`);
    assert.deepEqual([...p.tiltPos], vec(pos), `${s} tiltPos`);
  }
  // 装填动作 → 弹匣离位 / 俯仰 / 隐藏 / 伸手手型
  const block = text.slice(text.indexOf('switch (action)'), text.indexOf('return p;'));
  const cases = block.split(/(?=case LoadingAction\.)/).filter(c => c.startsWith('case'));
  let checked = 0;
  for (let i = 0; i < cases.length; i++) {
    const body = cases[i];
    const name = body.match(/case LoadingAction\.(\w+):/)[1];
    if (!/p\./.test(body)) continue; // fall-through 到下一条
    const names = [name];
    for (let j = i - 1; j >= 0 && !/p\./.test(cases[j]); j--) names.push(cases[j].match(/case LoadingAction\.(\w+):/)[1]);
    for (const n of names) {
      const p = H.makeHandling(def, ACTION[n], 'box');
      const off = body.match(/p\.magOffset = new Vector3\(([^)]+)\)/);
      if (off) assert.deepEqual([...p.magOffset], vec(off[1]), `${n} magOffset`);
      for (const k of ['magPitch', 'reachRoll', 'reachPitch', 'magHideAt']) {
        const m = body.match(new RegExp(`p\\.${k} = (-?[\\d.]+)f?;`));
        if (m) near(p[k], Number(m[1]), `${n}.${k}`);
      }
      checked++;
    }
  }
  assert.equal(checked, 11, '11 种装填动作');
  // 弹药袋（TS 原值；Unity 里 x 取反）
  const pouch = text.match(/Pouch = WeaponDef\.Grip\(([^)]+)\)/)[1];
  assert.deepEqual([...H.POUCH], vec(pouch));
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

test('hand rig IK constants match WeaponHandRig.cs (camera space z flipped)', async () => {
  const text = await cs('Weapons/WeaponHandRig.cs');
  const sh = vec(text.match(/shoulder = new\(([^)]+)\)/)[1]);
  const po = vec(text.match(/pole = new\(([^)]+)\)/)[1]);
  assert.deepEqual([...IK.HAND_IK.shoulder], [sh[0], sh[1], -sh[2]]);
  assert.deepEqual([...IK.HAND_IK.pole], [po[0], po[1], -po[2]]);
  near(IK.HAND_IK.upperArm, num(text.match(/upperArmLength = ([\d.]+f)/)[1]));
  near(IK.HAND_IK.forearm, num(text.match(/forearmLength = ([\d.]+f)/)[1]));
  near(IK.HAND_IK.weight, num(text.match(/ikWeight = ([\d.]+f)/)[1]));
  near(IK.HAND_IK.maxSwingDeg, num(text.match(/maxSwing = ([\d.]+f)/)[1]));
  // 平时刚性跟着握点走，只让偏差按 20/s 衰减；整匣换弹过了 loadAt 发加弹事件
  assert.match(text, /Mathf\.Exp\(-20f \* dt\)/);
  assert.match(text, /if \(!shell && p >= profile\.loadAt\) sm\.CommitLoad\(\);/);
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
const VM = await import(await ts('../src/weapons/Viewmodel.ts', {
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
}));
void flashTex;

function vmHarness() {
  const handlers = {};
  const viewCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 20);
  const ctx = {
    viewCamera, camera: new THREE.PerspectiveCamera(80, 16 / 9, 0.1, 1000), renderer: {},
    events: { on: (k, f) => { (handlers[k] ??= []).push(f); }, emit: (k, p) => (handlers[k] ?? []).forEach(f => f(p)) },
    player: { velocity: new THREE.Vector3(), onGround: true, yaw: 0, isDashing: false, hero: { color: 0x886644, id: 'fox' } },
    input: { enabled: true, mouseDX: 0, mouseDY: 0 }, settings: { invertY: false },
    time: { now: 0, dt: 1 / 60, timeScale: 1, frame: 0 },
  };
  const vm = new VM.Viewmodel(ctx);
  vm.init();
  vm.setVisible(true);
  return { vm, ctx };
}
let uid = 1;
const inst = (defId, element = 'none', rarity = 0) => ({ uid: uid++, defId, rarity, element, level: 0, mag: 10, reserve: 100, affixes: [] });

test('viewmodel feel constants match FirstPersonViewmodel.cs + WeaponController ViewKickScale', async () => {
  const text = await unity('Pipeline/Runtime/FirstPersonViewmodel.cs');
  const F = VM.VM_FEEL;
  for (const m of text.matchAll(/const float ([^;]+);/g)) {
    for (const part of m[1].split(',')) {
      const kv = part.match(/^\s*(\w+)\s*=\s*([-\d.]+)f(?:\s*\/\s*([\d.]+)f)?\s*$/);
      if (!kv) continue;
      const v = kv[3] ? Number(kv[2]) / Number(kv[3]) : Number(kv[2]);
      assert.ok(kv[1] in F, `网页缺 ${kv[1]}`);
      near(F[kv[1]], v, kv[1]);
    }
  }
  near(F.SwayAmount, num(text.match(/swayAmount = ([\d.]+f)/)[1]));
  const springs = { 'sway.x': 'Sway', roll: 'Roll', fwd: 'Fwd', vy: 'Vy', land: 'Land' };
  for (const [ref, key] of Object.entries(springs)) {
    const m = text.match(new RegExp(`Spring\\(ref ${ref.replace('.', '\\.')}, [^;]*Omega\\(([\\d.]+)f\\), ([\\d.]+)f, dt\\)`));
    assert.ok(m, ref);
    assert.deepEqual([...F[key]], [Number(m[1]), Number(m[2])], ref);
  }
  for (const [ref, key] of Object.entries({ shownZ: 'ShownZ', shownRot: 'ShownRot', shownRoll: 'ShownRoll' })) {
    const m = text.match(new RegExp(`Spring\\(ref ${ref}, ref \\w+, \\w+, ([\\d.]+)f, ([\\d.]+)f, dt\\)`));
    assert.deepEqual([...F[key]], [Number(m[1]), Number(m[2])], ref);
  }
  assert.match(text, /kickZ \*= Mathf\.Exp\(-15f \* rec \* dt\)/);
  assert.match(text, /kickRot \*= Mathf\.Exp\(-12f \* rec \* dt\)/);
  near(F.RecZ, 15); near(F.RecRot, 12); near(F.RecRoll, 12);
  const wc = await cs('Weapons/WeaponController.cs');
  assert.match(wc, /view\?\.Kick\(def\.kickBack \* 0\.76f \* ViewKickScale \* strength, def\.kickRot \* ViewKickScale \* strength\)/);
  near(VM.VIEW_KICK_SCALE, FC.WEAPON_FEEL.ViewKickScale);
  near(VM.VM_SCALE, num((await cs('Core/PlayerFactory.cs')).match(/ViewmodelScale = ([\d.]+f)/)[1]));
  // 碎刃的 Sway（BladeView.Build）
  const bv = await cs('Weapons/DemonBlade/BladeView.cs');
  near(H.BLADE_SWAY.weight, num(bv.match(/sway\.weight = ([\d.]+f)/)[1]));
  near(H.BLADE_SWAY.swayScale, num(bv.match(/sway\.swayScale = ([\d.]+f)/)[1]));
  near(H.BLADE_SWAY.bobScale, num(bv.match(/sway\.bobScale = ([\d.]+f)/)[1]));
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

test('viewmodel: trinity glow flashes when the next element changes and shows the first element while reloading (Unity TrinityCycle)', async () => {
  const text = await cs('Weapons/TrinityCycle.cs');
  near(VM.TRINITY_FLASH.gain, num(text.match(/FlashGain = ([\d.]+f)/)[1]));
  near(VM.TRINITY_FLASH.decay, num(text.match(/FlashDecay = ([\d.]+f)/)[1]));
  assert.match(text, /0\.82f \+ 0\.14f \* Mathf\.Sin\(time \* 3f\) \+ FlashGain \* Mathf\.Clamp01\(flash\)/);
  near(VM.trinityPulse(0, 1), 0.82 + 0.9);
  assert.match(text, /int i = reloading \? 0 : w\.cycleIndex;/);
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

test('railgun charge glow pulse and the energy colour (Unity RailgunCharge)', async () => {
  const text = await cs('Weapons/RailgunCharge.cs');
  assert.match(text, /0\.8f \+ 0\.7f \* Mathf\.Clamp01\(charge\) \+ \(full \? Mathf\.Sin\(time \* 34f\) \* 0\.22f : Mathf\.Sin\(time \* 18f\) \* 0\.06f\)/);
  near(VM.chargePulse(1, false, 0), 1.5);
  near(VM.chargePulse(0.5, true, Math.PI / 68), 0.8 + 0.35 + 0.22, '', 1e-9);
  const fc = (await cs('Weapons/Ballistics.cs')).match(/FullChargeColor = new\(([^)]+)\)/)[1].split(',').map(num);
  const web = new THREE.Color(0xc9a8ff);
  const srgb = web.getRGB(new THREE.Color(), THREE.SRGBColorSpace);
  near(srgb.r, fc[0], 'r', 0.01); near(srgb.g, fc[1], 'g', 0.01); near(srgb.b, fc[2], 'b', 0.01);
  assert.match(await readFile(new URL('../src/weapons/Firing.ts', import.meta.url), 'utf8'), /FULL_CHARGE_GLOW = 0xc9a8ff/);
});

test('weapon tint: element × rarity glow × 1.6, no element keeps the art white grooves (Unity WeaponTint)', async () => {
  const text = await cs('Weapons/WeaponTint.cs');
  const glow = text.match(/Glow = \{ ([^}]+) \}/)[1].split(',').map(num);
  const base = num(text.match(/MaterialBase = ([\d.]+f)/)[1]);
  const mat = await unity('Art/Weapons/SK_Weapon_Burst/M_Weapon_Burst.mat');
  near(base, Number(mat.match(/_EmissionColor: \{r: ([\d.]+)/)[1]), '美术材质的发光基准');
  const src = await readFile(new URL('../src/weapons/WeaponModels.ts', import.meta.url), 'utf8');
  assert.match(src, /ART_GLOW: Record<Rarity, number> = \{ 0: 0\.5, 1: 0\.8, 2: 1\.1, 3: 1\.5, 4: 2\.0 \}/);
  assert.deepEqual(glow, [0.5, 0.8, 1.1, 1.5, 2.0]);
  assert.match(src, /ART_GLOW_BASE = 1\.6;/);
  assert.match(src, /if \(element === 'none'\) return out\.setRGB\(ART_GLOW_BASE, ART_GLOW_BASE, ART_GLOW_BASE\);/);
  assert.match(src, /const base = weaponGlowColor\(element, rarity\);/);
});

test('part animator: mag offsets / cylinder / pump follow the profile (Unity WeaponPartAnimator)', async () => {
  const text = await cs('Weapons/WeaponPartAnimator.cs');
  assert.match(text, /magOut = Mathf\.Lerp\(magOut, target, 1 - Mathf\.Exp\(-20f \* dt\)\)/);
  assert.match(text, /cylAngle = Mathf\.Lerp\(cylAngle, cylTarget, 1 - Mathf\.Exp\(-25f \* dt\)\)/);
  assert.match(text, /float t1 = \(sinceShot - 0\.12f\) \/ 0\.32f;/);
  assert.match(text, /float t2 = rackT \/ 0\.3f;/);
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

test('break action: magmashot opens 0.48 rad and slides a shell into alternating barrels (Unity BreakAction)', async () => {
  const text = await cs('Weapons/BreakAction.cs');
  near(VM.BREAK.OpenAngle, num(text.match(/OpenAngle = ([\d.]+f)/)[1]));
  for (const k of ['BoreX', 'BoreY', 'ChamberZ', 'ShellLength']) near(VM.BREAK[k], num(text.match(new RegExp(`${k} = (-?[\\d.]+f)`))[1]), k);
  assert.match(text, /Smooth\(\(shellProgress - 0\.55f\) \/ 0\.37f\)/);
  assert.match(text, /shellReload && shellProgress > 0\.22f && shellProgress < 0\.98f/);
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

test('C# state machine CommitLoad / CancelReload still read like the port', async () => {
  const text = await cs('Weapons/FireModes/WeaponStateMachine.cs');
  assert.match(text, /if \(!Reloading \|\| ShellReload \|\| loadCommitted \|\| w == null\) return false;/);
  assert.match(text, /bool committed = !ShellReload && loadCommitted;/);
  assert.match(text, /if \(rack && !committed\) Rack\(w\);/);
  assert.match(text, /if \(!loadCommitted\) Load\(w, R\);/);
  const wc = await cs('Weapons/WeaponController.cs');
  assert.match(wc, /if \(Machine\.LoadCommitted && !Machine\.ShellReload && !WeaponStateMachine\.IsShell\(w\?\.def\)\) GameAudio\.Play\("weapon_switch", 0\.45f, 1\.25f\);/);
});
