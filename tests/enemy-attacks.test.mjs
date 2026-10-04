import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function tsModule(path, imports = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [key, value] of Object.entries({ three: threeUrl, ...imports })) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return dataModule(stripTypeScriptTypes(source, { mode: 'transform' }));
}
const mathUrl = await tsModule('../src/core/math.ts');
const modelsUrl = await tsModule('../src/enemies/Models.ts', { '../core/math': mathUrl });
const posesUrl = await tsModule('../src/enemies/AttackPoses.ts');
const aimUrl = await tsModule('../src/enemies/CannonAim.ts');
const { applyCannonAim, boundCannonAim, createCannonAim } = await import(aimUrl);
const { buildHumanoid, reachArm, reachPalmGrip } = await import(modelsUrl);
const { MORTAR_CARRY, MORTAR_RIGHT_GRIP, MORTAR_MUZZLE, SHAMAN_CARRY, SHAMAN_FOCUS,
  SHAMAN_STAFF_GRIP, sampleMortarPose, sampleShamanPose, mortarRecoil, mortarSupportGrip } = await import(posesUrl);

// 用最小基类环境执行真实子类的 pose 与释放方法，避免为坐标回归启动浏览器/WebGL。
// 武器/身体关节保持真实 buildModel 的尺寸与挂点；玩法服务仅记录调用。
const baseUrl = dataModule(`
  import * as THREE from '${threeUrl}';
  export class StandardEnemy {
    constructor(ctx, def, opts) {
      this.ctx=ctx; this.def=def; this.root=new THREE.Group(); this.model=new THREE.Group(); this.root.add(this.model);
      this.position=this.root.position; this.position.copy(opts.position); this.facing=0; this.sizeScale=1;
      this.state='move'; this.stateTime=0; this.attackRate=1; this.damageMult=1; this.age=2;
      this.walkPhase=0; this.walkAmp=0; this.glowTarget=[0,0,0]; this.isElite=false;
    }
    glowPart(parent, geometry) { const m=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()); parent.add(m); return m; }
    setHeadAnchor() {} applyHurtAndStun() {} facePlayer() {} releaseAttack() {}
    faceTowards(p, rate, dt) {
      let d=(Math.atan2(p.x-this.position.x,p.z-this.position.z)-this.facing)%(Math.PI*2);
      if(d>Math.PI)d-=Math.PI*2; if(d<=-Math.PI)d+=Math.PI*2;
      this.facing+=Math.max(-rate*dt,Math.min(rate*dt,d));
    }
    setState(state) { this.state=state; this.stateTime=0; }
    distToPlayerXZ() { return 20; }
    getMuzzle(out) { return out.copy(this.position); }
  }
`);
const { Mortar } = await import(await tsModule('../src/enemies/types/Mortar.ts', {
  '../../core/math': mathUrl, '../Models': modelsUrl, '../StandardEnemy': baseUrl, '../AttackPoses': posesUrl,
  '../CannonAim': aimUrl,
}));
const { Shaman } = await import(await tsModule('../src/enemies/types/Shaman.ts', {
  '../../core/math': mathUrl, '../Models': modelsUrl, '../StandardEnemy': baseUrl, '../AttackPoses': posesUrl,
  '../Hazards': dataModule('export function zonePlayer() {}'),
}));

const typesUrl = await tsModule('../src/core/types.ts');
const enemyBaseUrl = await tsModule('../src/enemies/EnemyBase.ts', { '../core/types': typesUrl, '../core/math': mathUrl });
const { CollisionWorld } = await import(await tsModule('../src/world/Collision.ts'));
const { NavGrid } = await import(await tsModule('../src/world/NavGrid.ts', { '../core/math': mathUrl }));
// 移动/接触回归使用生产 EnemyBase 的 update、积分、导航与近战判定，仅隔离渲染/攻击导演。
const movementBaseUrl = dataModule(`
  import * as THREE from '${threeUrl}';
  import { EnemyBase } from '${enemyBaseUrl}';
  export class StandardEnemy extends EnemyBase {
    constructor(ctx,def,opts) {
      super(ctx,def,opts); this.state='move'; this.stateTime=0; this.attackRate=1; this.cooldown=2;
      this.walkPhase=0; this.walkAmp=0; this.glowTarget=[0,0,0]; this.sees=true;
    }
    think(dt) { this.stateTime+=dt; this.ai(dt); }
    animate(dt) { this.pose(dt); }
    glowPart(parent,geometry) { const m=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()); parent.add(m); return m; }
    setHeadAnchor() {} applyHurtAndStun() {} releaseAttack() {}
    requestAttack() { return true; }
    verticalReach(d) { return Math.abs(this.ctx.player.position.y-this.position.y)<=d; }
    setState(state) { this.state=state; this.stateTime=0; }
    windup(base,min) { return Math.max(Math.min(base,min),base/(1+(this.attackRate-1)*.45)); }
    rollCooldown() { this.cooldown=5; }
  }
`);
const { Mortar: MovingMortar, mortarSmashStepProgress } = await import(await tsModule('../src/enemies/types/Mortar.ts', {
  '../../core/math': mathUrl, '../Models': modelsUrl, '../StandardEnemy': movementBaseUrl, '../AttackPoses': posesUrl,
  '../CannonAim': aimUrl,
}));

function rig(kind) {
  const root = new THREE.Group();
  root.position.set(5, 1.3, -9); root.rotation.y = 1.1; root.scale.setScalar(1.25);
  return buildHumanoid(root, { hipY: kind === 'mortar' ? 0.9 : 0.86, hipX: 0.17, thigh: 0.44, legW: 0.14,
    legColor: 0xffffff, torsoW: 0.5, torsoH: 0.6, torsoD: 0.3, torsoColor: 0xffffff,
    shoulderX: kind === 'mortar' ? 0.42 : 0.29, shoulderY: kind === 'mortar' ? 0.56 : 0.52,
    upperArm: kind === 'mortar' ? 0.32 : 0.28, foreArm: kind === 'mortar' ? 0.30 : 0.27,
    armW: 0.13, armColor: 0xffffff, neckY: 0.65 });
}
const mortarPalms = { 1: new THREE.Vector3(-0.0619, -0.0415, 0.0254), '-1': new THREE.Vector3(0.0614, -0.0406, 0.0234) };
const staffPalm = new THREE.Vector3(0.0197, -0.0815, -0.0079);
function supportPoint(p) {
  const point = new THREE.Vector3(); mortarSupportGrip(p, point); return point.toArray();
}
function gripError(r, side, weapon, point, palmOffset, forearmRoll = 0) {
  reachPalmGrip(r, side, weapon, ...point, palmOffset, new THREE.Vector3(side, -0.5, 0.15), forearmRoll);
  const hand = side > 0 ? r.handL : r.handR;
  assert.ok(hand.quaternion.angleTo(new THREE.Quaternion()) < 1e-8, 'weapon should not twist the wrist away from its forearm');
  const actual = hand.localToWorld(palmOffset.clone());
  const expected = weapon.localToWorld(new THREE.Vector3(...point));
  return actual.distanceTo(expected) / 1.25;
}

test('both cannon palms follow calibrated grip references with neutral wrists throughout brace, recoil and close strike', () => {
  const r = rig('mortar'), weapon = new THREE.Group(); r.torso.add(weapon);
  const out = {};
  for (const state of ['move', 'brace', 'fire', 'smashWindup', 'recover']) {
    for (const action of ['shell', 'smash']) for (let i = 0; i <= 100; i++) {
      sampleMortarPose(state, i / 100, state === 'fire' || state === 'recover' ? i / 100 * 0.35 : Infinity, action, out);
      weapon.position.set(out.x, out.y, out.z); weapon.rotation.set(out.pitch, out.yaw, out.roll);
      r.torso.rotation.set(out.lean, out.twist, 0);
      assert.ok(gripError(r, -1, weapon, MORTAR_RIGHT_GRIP, mortarPalms[-1]) < 0.002, `right ${state} ${i}`);
      assert.ok(gripError(r, 1, weapon, supportPoint(out), mortarPalms[1]) < 0.002, `left ${state} ${i}`);
    }
  }
});

test('staff grip and the two distinct spell gestures remain reachable without snapping wide sleeves', () => {
  const r = rig('shaman'), weapon = new THREE.Group(); r.torso.add(weapon);
  const out = {}, previous = {};
  for (const state of ['castCircle', 'ward', 'recover']) for (const action of ['circle', 'ward']) {
    for (let i = 0; i <= 100; i++) {
      sampleShamanPose(state, i / 100, action, out);
      weapon.position.set(out.x, out.y, out.z); weapon.rotation.set(out.pitch, out.yaw, out.roll);
      r.torso.rotation.set(out.lean, out.twist, 0);
      assert.ok(gripError(r, -1, weapon, SHAMAN_STAFF_GRIP, staffPalm, out.staffForearmRoll) < 0.002, `${state} staff ${i}`);
      assert.ok(Math.abs(r.elbowR.rotation.y - out.staffForearmRoll) < 1e-8);
      const target = new THREE.Vector3(out.handX, out.handY, out.handZ);
      reachArm(r, 1, target, new THREE.Vector3(1, -0.25, 0.25));
      const actual = r.handL.getWorldPosition(new THREE.Vector3());
      const expected = r.torso.localToWorld(target.clone());
      assert.ok(actual.distanceTo(expected) / 1.25 < 0.002, `${state} palm ${i}`);
      if (i > 0) for (const [key, value] of Object.entries(out)) assert.ok(Math.abs(value - previous[key]) < 0.10, `${state} jump ${key}`);
      Object.assign(previous, out);
      assert.ok(Math.abs(out.handRoll) <= 0.11, 'wrist twist should not rotate the entire broad sleeve');
    }
  }
  const circle = {}, ward = {};
  sampleShamanPose('castCircle', 1, 'circle', circle); sampleShamanPose('ward', 1, 'ward', ward);
  assert.ok(circle.handZ > ward.handZ + 0.10 && ward.handY > circle.handY + 0.25);
});

test('forearm pronation rotates the palm around the staff while the wrist stays neutral and the contact reference stays exact', () => {
  const r = rig('shaman'), weapon = new THREE.Group(); r.torso.add(weapon);
  const p = {};
  for (const state of ['castCircle', 'ward']) for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    sampleShamanPose(state, progress, state === 'ward' ? 'ward' : 'circle', p);
    weapon.position.set(p.x, p.y, p.z); weapon.rotation.set(p.pitch, p.yaw, p.roll);
    r.torso.rotation.set(p.lean, p.twist, 0);
    for (const roll of [-0.4, -0.2, 0, 0.2, 0.4]) {
      assert.ok(gripError(r, -1, weapon, SHAMAN_STAFF_GRIP, staffPalm, roll) < 0.002);
      assert.ok(Math.abs(r.elbowR.rotation.y - roll) < 1e-8);
    }
  }
});

test('release/recovery boundaries are continuous and absolute sampling is history independent', () => {
  const end = {}, start = {};
  for (const [state, action] of [['brace', 'shell'], ['smashWindup', 'smash']]) {
    sampleMortarPose(state, 1, Infinity, action, end); sampleMortarPose('recover', 0, Infinity, action, start);
    assert.deepEqual(start, end);
    sampleMortarPose('recover', 1, Infinity, action, start); assert.deepEqual(start, MORTAR_CARRY);
  }
  for (const [state, action] of [['castCircle', 'circle'], ['ward', 'ward']]) {
    sampleShamanPose(state, 1, action, end); sampleShamanPose('recover', 0, action, start); assert.deepEqual(start, end);
    sampleShamanPose('recover', 1, action, start); assert.deepEqual(start, SHAMAN_CARRY);
    sampleShamanPose(state, 0.61, action, start); const expected = { ...start };
    sampleShamanPose('move', 0, action, start); sampleShamanPose(state, 0.61, action, start); assert.deepEqual(start, expected);
  }
  assert.equal(mortarRecoil(0), 1);
  assert.equal(mortarRecoil(0.35), 0);
  assert.equal(mortarRecoil(Infinity), 0);
  assert.ok(mortarRecoil(0.1) > 0 && mortarRecoil(0.3) < 0);
});

function context() {
  const events = { shells: [], beams: [], bursts: [], timers: [] };
  const ctx = { rng: { range: (a, b) => (a + b) / 2 }, player: { position: new THREE.Vector3(10, 0, 20), velocity: new THREE.Vector3() },
    world: { groundHeight: () => 0 }, audio: { play() {} }, enemies: { queryRadius: () => [] },
    tasks: { delay: (time, fn) => { events.timers.push({ time, fn }); return () => {}; } },
    projectiles: { spawn: spec => events.shells.push(spec) }, fx: {
      groundWarning: () => () => {}, ring() {}, shake() {}, explosion() {},
      burst: point => events.bursts.push(point.clone()),
      beam: (from, to) => { events.beams.push({ from: from.clone(), to: to.clone() }); return () => {}; },
    } };
  return { ctx, events };
}
function model(Type) {
  const { ctx, events } = context();
  const e = new Type(ctx, { position: new THREE.Vector3(3, 1.4, -4) });
  e.model.add(e.buildModel()); e.model.scale.setScalar(1.25); e.pose(0);
  e.facing = 1.2; e.root.rotation.y = -0.7;
  return { e, events };
}

function aimingModel(range, height = 0, facing = 0) {
  const result = model(Mortar), { e } = result;
  e.position.set(2, 0.4, -3); e.facing = facing;
  e.ctx.player.position.set(2 + Math.sin(facing) * range, height, -3 + Math.cos(facing) * range);
  e.ctx.world.groundHeight = () => height;
  e.state = 'fire'; e.shotAge = Infinity; e.stateTime = 0;
  return result;
}

function axis(e) {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(e.tube.getWorldQuaternion(new THREE.Quaternion()));
}
function palmErrors(e) {
  const p = e.attackPose;
  return [-1, 1].map(side => {
    const hand = side > 0 ? e.rig.handL : e.rig.handR;
    const point = side > 0 ? supportPoint(p) : MORTAR_RIGHT_GRIP;
    assert.ok(hand.quaternion.angleTo(new THREE.Quaternion()) < 1e-8);
    return hand.localToWorld(mortarPalms[side].clone()).distanceTo(e.tube.localToWorld(new THREE.Vector3(...point))) / 1.25;
  });
}

test('actual cannon axis follows shell initial velocity over normal ranges, terrain heights and spread', () => {
  let maximumError = 0;
  for (const range of [6, 10, 15, 20, 27, 32]) for (const height of [-2, 0, 2]) {
    for (const scatter of [null, 0, Math.PI / 2, Math.PI]) {
      const { e, events } = aimingModel(range, height, 0.8);
      if (scatter !== null) e.ctx.rng.range = (a, b) => b === Math.PI * 2 ? scatter : 3.1;
      e.fireShell(scatter === null ? 0 : 1);
      if (scatter === null) assert.equal(e.cannonAim.limited, false, `${range}m height ${height}: ordinary first shot should remain fully aimed`);
      const angle = axis(e).angleTo(events.shells[0].velocity.clone().normalize());
      if (!e.cannonAim.limited) assert.ok(angle < 0.001, `${range}m height ${height} spread ${scatter}: axis error ${angle}`);
      maximumError = Math.max(maximumError, ...palmErrors(e));
      assert.ok(palmErrors(e).every(error => error < 0.002), `${range}m height ${height} spread ${scatter}: palms ${palmErrors(e)}`);
      // The launch warning still ends at the same ballistic landing, including terrain height.
      const shell = events.shells[0], time = shell.lifetime - 2;
      const landing = shell.position.clone().addScaledVector(shell.velocity, time); landing.y -= 0.5 * shell.gravity * time * time;
      assert.ok(Math.abs(landing.y - height) < 1e-8);
    }
  }
  assert.ok(maximumError < 0.002);
});

test('brace tracks the first shot progressively and release does not abruptly change the barrel angle', () => {
  for (const range of [6, 15, 32]) {
    const { e, events } = aimingModel(range, 0, -0.4);
    e.state = 'brace'; e.ctx.player.velocity.x = 0.5;
    e.stateTime = 0; e.pose(0); e.getMuzzle(new THREE.Vector3());
    let previous = axis(e);
    for (let frame = 0; frame <= 54; frame++) {
      e.stateTime = frame / 60;
      e.prepareAim(0, 1 / 60); e.pose(0);
      const next = axis(e);
      assert.ok(previous.angleTo(next) < 0.05, `${range}m brace jumps at frame ${frame}`);
      assert.ok(palmErrors(e).every(error => error < 0.002), `${range}m brace palms frame ${frame}: ${palmErrors(e)}`);
      previous = next;
    }
    e.state = 'fire'; e.stateTime = 0; e.fireShell(0);
    assert.ok(previous.angleTo(axis(e)) < 0.015, `${range}m first release jumps`);
    assert.ok(axis(e).angleTo(events.shells[0].velocity.clone().normalize()) < 0.001);
  }
});

test('fast followup release aligns while the preceding recoil still has a small rebound', () => {
  const { e, events } = aimingModel(20);
  e.shotAge = 0.247;
  e.fireShell(1);
  assert.ok(axis(e).angleTo(events.shells[0].velocity.clone().normalize()) < 0.001);
});

test('scatter shots turn and brace the whole cannon before release without separating the palms', () => {
  for (const range of [6, 20, 32]) {
    const { e, events } = aimingModel(range);
    e.fireShell(0); e.pose(0);
    for (const [index, angle] of [[1, 0], [2, Math.PI]]) {
      e.ctx.rng.range = (a, b) => b === Math.PI * 2 ? angle : 3.1;
      let previous = axis(e);
      for (let frame = 1; frame <= 15; frame++) {
        e.shotAge = frame / 60;
        e.prepareAim(index, 1 / 60); e.pose(0);
        const next = axis(e);
        assert.ok(previous.angleTo(next) < 0.10, `${range}m scatter ${index} frame ${frame}: violent barrel swing`);
        assert.ok(palmErrors(e).every(error => error < 0.002));
        previous = next;
      }
      e.fireShell(index);
      assert.equal(e.cannonAim.limited, false, `${range}m scatter should face its ordinary landing`);
      const releaseJump = previous.angleTo(axis(e));
      assert.ok(releaseJump < 0.06, `${range}m scatter ${index}: release snaps by ${releaseJump}rad`);
      assert.ok(axis(e).angleTo(events.shells[index].velocity.clone().normalize()) < 0.001);
      e.pose(0); // The new shell has a deliberate recoil impulse before the next aiming interval.
    }
  }
});

test('aimed recoil and physically timed recovery preserve palm contact and bent supporting elbows', () => {
  for (const range of [6, 15, 32]) for (const height of [-2, 0, 2]) {
    const { e } = aimingModel(range, height);
    e.fireShell(0);
    const phases = [0, 0.07, 0.2, 0.34].map(age => ['fire', 0, age]);
    for (let i = 0; i <= 80; i++) phases.push(['recover', i / 80, i / 80 * 0.8]);
    for (const [state, progress, age] of phases) {
      e.state = state; e.stateTime = progress * 0.8; e.shotAge = age; e.pose(0);
      assert.ok(palmErrors(e).every(error => error < 0.002), `${range}m height ${height} ${state} ${progress}: palms ${palmErrors(e)}`);
      for (const elbow of [e.rig.elbowL, e.rig.elbowR]) {
        const bend = -elbow.rotation.x * 180 / Math.PI;
        assert.ok(bend > 5 && bend < 145, `${range}m height ${height} ${state}: elbow ${bend}`);
      }
    }
  }
});

test('extreme ballistic targets expose a bounded aim and compensation remains absolute', () => {
  const aim = createCannonAim();
  boundCannonAim(new THREE.Vector3(0, -1, 1), aim);
  assert.equal(aim.limited, true);
  const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(aim.rotation);
  assert.ok(Math.abs(Math.atan2(direction.z, direction.y) - 1.05) < 1e-8);
  boundCannonAim(new THREE.Vector3(10, 1, 0.1), aim);
  assert.equal(aim.limited, true);
  const out = {}, reference = {};
  sampleMortarPose('brace', 0.6, Infinity, 'shell', out); applyCannonAim(out, aim, 'brace', 0.6);
  Object.assign(reference, out);
  sampleMortarPose('brace', 0.6, Infinity, 'shell', out); applyCannonAim(out, aim, 'brace', 0.6);
  assert.deepEqual(out, reference, 'paused/dragged preview must not accumulate compensation');
});

test('every permitted aim direction keeps both palms attached through peak recoil and recovery', () => {
  const r = rig('mortar'), weapon = new THREE.Group(); r.torso.add(weapon);
  const p = {}, baseline = {}, aim = createCannonAim();
  for (let pitch = 0.30; pitch <= 1.051; pitch += 0.025) for (const yaw of [-0.25, 0, 0.25]) {
    boundCannonAim(new THREE.Vector3(Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), Math.sin(pitch) * Math.cos(yaw)), aim);
    for (const [state, progress, age] of [['brace', 0.5, Infinity], ['fire', 0, 0], ['fire', 0, 0.07], ['fire', 0, 0.2], ['recover', 0.1, 0.08], ['recover', 0.5, 0.4]]) {
      sampleMortarPose(state, progress, age, 'shell', p); sampleMortarPose(state, progress, Infinity, 'shell', baseline);
      applyCannonAim(p, aim, state, progress, p.pitch - baseline.pitch);
      weapon.position.set(p.x, p.y, p.z); weapon.rotation.set(p.pitch, p.yaw, p.roll);
      r.torso.rotation.set(p.lean, p.twist, 0);
      const left = gripError(r, 1, weapon, supportPoint(p), mortarPalms[1]);
      const right = gripError(r, -1, weapon, MORTAR_RIGHT_GRIP, mortarPalms[-1]);
      assert.ok(left < 0.002 && right < 0.002, `pitch ${pitch} yaw ${yaw} ${state} age ${age}: palm ${left}/${right}`);
      assert.ok(-r.elbowL.rotation.x > 5 * Math.PI / 180 && -r.elbowR.rotation.x > 5 * Math.PI / 180,
        `pitch ${pitch} yaw ${yaw} ${state} age ${age}: elbows ${-r.elbowL.rotation.x * 180 / Math.PI}/${-r.elbowR.rotation.x * 180 / Math.PI}`);
    }
  }
});

test('real shell release samples current pose and emits at the actual transformed muzzle', () => {
  const { e, events } = model(Mortar);
  const previous = e.getMuzzle(new THREE.Vector3()).clone();
  e.state = 'fire'; e.stateTime = 0.01;
  e.fireShell(0);
  const actual = e.tube.localToWorld(new THREE.Vector3(...MORTAR_MUZZLE));
  assert.ok(events.shells[0].position.distanceTo(actual) < 1e-8);
  assert.ok(previous.distanceTo(actual) > 0.015, 'release should not reuse the preceding carry pose');
  assert.ok(events.bursts.every(p => p.distanceTo(actual) < 1e-8));
  e.shotAge = 0; e.pose(0);
  assert.ok(e.getMuzzle(new THREE.Vector3()).distanceTo(actual) > 0.04, 'visible recoil must move the transformed muzzle');
});

test('real triple-shot cadence and damage stay intact while each shell starts its own recoil', () => {
  const { e, events } = model(Mortar);
  e.state = 'fire'; e.attackRate = 2;
  e.ai(0.01); assert.equal(events.shells.length, 1); assert.equal(e.shotAge, 0);
  const gap = 0.35 / Math.sqrt(2);
  e.shotAge = 0.3; e.ai(gap - 0.001); assert.equal(events.shells.length, 1);
  e.ai(0.00101); assert.equal(events.shells.length, 2); assert.equal(e.shotAge, 0);
  e.shotAge = 0.3; e.ai(gap); assert.equal(events.shells.length, 3); assert.equal(e.shotAge, 0);
  assert.equal(e.state, 'recover'); assert.equal(e.lastAction, 'shell');
  assert.ok(events.shells.every(s => s.enemyDamage === 20 && s.explosionRadius === 3 && s.gravity === 20));
});

test('real circle and ward effects leave the transformed gem on their respective release poses', () => {
  for (const [state, action, duration, release] of [['castCircle', 'circle', 0.45, 'placeCircle'], ['ward', 'ward', 0.7, 'castWard']]) {
    const { e, events } = model(Shaman);
    const previous = e.getMuzzle(new THREE.Vector3()).clone();
    e.state = state; e.stateTime = duration; e.lastAction = action;
    e[release]();
    const actual = e.staff.localToWorld(new THREE.Vector3(...SHAMAN_FOCUS));
    assert.ok(actual.distanceTo(previous) > 0.15, `${action}: used prior pose`);
    if (action === 'circle') {
      assert.ok(events.beams[0].from.distanceTo(actual) < 1e-8);
      assert.equal(events.timers[0].time, 1.2, 'circle damage delay changed');
    } else assert.ok(events.bursts[0].distanceTo(actual) < 1e-8);
    assert.ok(e.getMuzzle(new THREE.Vector3()).distanceTo(actual) < 1e-8);
    assert.ok(e.rig.handR.quaternion.angleTo(new THREE.Quaternion()) < 1e-8, 'staff holding wrist must remain neutral');
    assert.ok(e.rig.handL.quaternion.angleTo(new THREE.Quaternion()) < 25 * Math.PI / 180, 'free spell gesture must stay within a natural local wrist angle');
  }
});

function movingModel(range, wall = false) {
  const { ctx, events } = context();
  ctx.time = { dt: 1 / 60, now: 0 };
  ctx.player.position.set(0, 0, range); ctx.player.radius = 0.3; ctx.player.height = 1.8;
  ctx.player.applyImpulse = () => {};
  ctx.world = new CollisionWorld(); ctx.world.addBox(-5, -0.2, -5, 5, 0, 5, 'floor');
  if (wall) ctx.world.addBox(-5, 0, 0.7, 5, 2, 0.9, 'wall');
  ctx.stage = { arena: { minX: -5, minZ: -5, maxX: 5, maxZ: 5, floorY: 0, center: new THREE.Vector3() } };
  ctx.nav = new NavGrid(ctx); ctx.nav.build(ctx.stage.arena, 0.25);
  events.hits = [];
  ctx.combat = { damagePlayer: (damage, element, e) => events.hits.push({ damage, time: ctx.time.now, position: e.position.clone() }) };
  const e = new MovingMortar(ctx, { position: new THREE.Vector3() });
  e.root.add(e.model); e.model.add(e.buildModel()); e.model.scale.setScalar(1);
  e.age = 2; e.onGround = true; e.pose(0);
  return { e, ctx, events };
}

test('real cannon-butt AI steps through navigation/collision and reaches the old 2.2–2.3m starting range at the unchanged contact time', t => {
  assert.equal(mortarSmashStepProgress(0), 0); assert.equal(mortarSmashStepProgress(0.1), 0);
  assert.equal(mortarSmashStepProgress(0.95), 1); assert.equal(mortarSmashStepProgress(1), 1);
  for (const range of [2.2, 2.3]) {
    const { e, ctx, events } = movingModel(range);
    for (let frame = 0; frame < 40 && events.hits.length === 0; frame++) { ctx.time.now += ctx.time.dt; e.update(ctx.time.dt); }
    assert.equal(events.hits.length, 1, `${range}m starting range: failed to advance into butt contact; advanced ${e.position.z}m`);
    const hit = events.hits[0];
    assert.equal(hit.damage, 14); assert.ok(Math.abs(hit.time - (0.55 + ctx.time.dt)) < ctx.time.dt + 1e-8);
    assert.ok(hit.position.z > 0.7 && hit.position.z < 1.3, `${range}m: step must move the collision body, not just the model`);
    assert.equal(e.model.position.z, 0);
    assert.equal(events.bursts.length, 1);
    const remaining = Math.hypot(ctx.player.position.x - events.bursts[0].x, ctx.player.position.z - events.bursts[0].z);
    assert.ok(remaining - ctx.player.radius <= 0.45 + 1e-8, `${range}m: impact still looks out of reach by ${remaining - ctx.player.radius}m`);
    t.diagnostic(`${range}m: body advanced ${hit.position.z.toFixed(4)}m; contact margin ${(remaining - ctx.player.radius).toFixed(4)}m; hit at ${(hit.time - ctx.time.dt).toFixed(4)}s after telegraph`);
  }
});

test('cannon-butt step is stopped by a wall and does not drag toward a player who evades after telegraph', () => {
  for (const wall of [true, false]) {
    const { e, ctx, events } = movingModel(2.2, wall);
    e.update(ctx.time.dt);
    const lockedTarget = e.smashStepTarget.clone();
    if (!wall) ctx.player.position.set(2.5, 0, 3.2);
    for (let frame = 1; frame < 40; frame++) { ctx.time.now += ctx.time.dt; e.update(ctx.time.dt); }
    assert.equal(events.hits.length, 0, wall ? 'wall permitted a phantom melee hit' : 'step chased and pulled toward a dodging player');
    assert.ok(e.smashStepTarget.distanceTo(lockedTarget) < 1e-8);
    if (wall) assert.ok(e.position.z < 0.24, 'step bypassed actual body collision');
    else assert.ok(Math.abs(e.position.x) < 0.01 && e.position.z < 1.3, 'locked step followed the evading target');
  }
});
