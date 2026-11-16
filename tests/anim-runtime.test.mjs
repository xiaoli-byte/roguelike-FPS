// 动画运行时（src/anim）的无头回归：AnimatorStateMachine 照 Unity 控制器的拓扑跑（Idle ⇄ Move 按 Speed、act_ 触发 → 连段 → 回移动、
// 持续型片段不自动退出、叠加层 Flinch、CrossFadeInFixedTime、事件逐帧派发），CreatureRig 的骨骼识别 / 受击弹簧 / 脚步 IK / 看向，
// CreatureLocomotion 的速度与倾斜。骨架按发布 GLB 的节点层级搭（不需要浏览器）。
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { anim, animData, buildSkeleton } from './anim-fixtures.mjs';

const DT = 1 / 60;

function machine(id) {
  const data = animData(id);
  const model = buildSkeleton(id);
  anim.ensureSockets(model, data);
  const clips = anim.buildClips(data);
  const sm = new anim.AnimatorStateMachine(model, data.controller ?? anim.buildDefaultController(data), clips);
  const events = [];
  let t = 0;
  sm.onEvent = (e) => events.push({ ...e, at: t });
  const run = (seconds, each) => {
    for (let i = 0, n = Math.round(seconds / DT); i < n; i++) { each?.(); sm.update(DT); t += DT; }
  };
  return { data, model, clips, sm, events, run, now: () => t };
}

/** 一直跑到当前状态变成 name（返回用时）；超时失败 */
function until(m, name, max = 10, layer = 0) {
  const t0 = m.now();
  while (m.sm.currentState(layer)?.name !== name) {
    assert.ok(m.now() - t0 < max, `等不到 ${name}（现在 ${m.sm.currentState(layer)?.name}）`);
    m.run(DT);
  }
  return m.now() - t0;
}

test('Locomotion：Speed 在 Idle / Walk / Move 阈值之间线性混合，超出两端钳住', () => {
  const m = machine('SK_Enemy_Fuzhu');
  const w = () => m.sm.clipWeights(0);
  m.run(0.1);
  assert.equal(m.sm.currentState().name, 'Locomotion');
  assert.ok(Math.abs(w().Idle - 1) < 1e-6);
  m.sm.setFloat('Speed', 2.2);
  m.run(DT);
  assert.ok(Math.abs(w().Walk - 1) < 1e-6 && w().Idle < 1e-6);
  m.sm.setFloat('Speed', 3.3);
  m.run(DT);
  assert.ok(Math.abs(w().Walk - 0.5) < 1e-6 && Math.abs(w().Move - 0.5) < 1e-6);
  m.sm.setFloat('Speed', 9);
  m.run(DT);
  assert.ok(Math.abs(w().Move - 1) < 1e-6);
});

test('Locomotion：混合树按 Unity 同步规则推进（长度 = Σ 权重 × 子片段长度），MoveScale 加快播放', () => {
  const m = machine('SK_Enemy_Fuzhu');
  m.sm.setFloat('Speed', 4.4);
  m.run(0.9);
  const move = m.clips.get('Move').duration;
  const n1 = m.sm.currentState().normalizedTime;
  assert.ok(Math.abs(n1 - (0.9 - DT) / move) < 0.02, `归一化时刻 ${n1}`);
  m.sm.setFloat('MoveScale', 2);
  m.run(0.45);
  const n2 = m.sm.currentState().normalizedTime;
  assert.ok(Math.abs(n2 - n1 - 0.9 / move) < 0.02, `MoveScale 2 时 0.45 s 走了 ${(n2 - n1) * move} s 的片段`);
});

test('act_ 触发：任意状态 0.12 s 过渡进招式，播完按 next（0.05 s）连段，最后 0.2 s 回 Locomotion；触发器被消耗', () => {
  const m = machine('SK_Enemy_Fuzhu');
  m.run(0.2);
  m.sm.setTrigger('act_crouch');
  m.run(DT);
  assert.equal(m.sm.currentState().name, 'crouch');
  assert.equal(m.sm.currentState().inTransition, true);
  assert.equal(m.sm.getBool('act_crouch'), false, '触发器在转换时消耗');
  m.run(0.12 + DT);
  assert.equal(m.sm.currentState().inTransition, false);
  const crouch = m.clips.get('crouch').duration, leap = m.clips.get('leap').duration, land = m.clips.get('land').duration;
  const tLeap = until(m, 'leap') + 0.12 + DT;
  assert.ok(Math.abs(tLeap - crouch * 0.98) < 3 * DT, `crouch → leap 在 ${tLeap.toFixed(3)} s（片段 ${crouch.toFixed(3)} s × 0.98）`);
  const tLand = until(m, 'land');
  assert.ok(Math.abs(tLand - leap * 0.98) < 3 * DT, `leap → land 在 ${tLand.toFixed(3)} s`);
  const tBack = until(m, 'Locomotion');
  assert.ok(Math.abs(tBack - land * 0.98) < 3 * DT);
  m.run(0.25);
  assert.equal(m.sm.currentState().inTransition, false);
  assert.ok(Math.abs(m.sm.clipWeights(0).Idle - 1) < 1e-6, '回到待机');
  // 事件：每段片段起点的事件按顺序各发一次
  const names = m.events.map((e) => e.name);
  assert.deepEqual(names, ['sfx:enemy_alert', 'sfx:jump', 'fx:ring', 'sfx:land']);
});

test('ActScale：PlayTimed 式拉伸——ActScale 2 时招式用一半时间走到 next', () => {
  const m = machine('SK_Enemy_Fuzhu');
  m.sm.setFloat('ActScale', 2);
  m.sm.crossFadeInFixedTime('charge', 0.08);
  m.run(DT);
  const t = until(m, 'recover') + DT;
  const charge = m.clips.get('charge').duration;
  assert.ok(Math.abs(t - (charge * 0.98) / 2) < 3 * DT, `charge 用了 ${t.toFixed(3)} s`);
});

test('事件：片段中段的事件按片段时刻派发（Tuo 吼叫 0 / 0.8 / 0.8 / 1.233 s），每个只发一次', () => {
  const m = machine('SK_Enemy_Tuo');
  m.run(0.1);
  m.sm.setTrigger('act_roar');
  const start = m.now();
  m.run(DT);
  until(m, 'Locomotion', 5); // Tuo 没有 land 片段：roar 的 next 落空，控制器里 0.2 s 回 Locomotion
  const got = m.events.filter((e) => e.state === 'roar').map((e) => [e.name, e.time, +(e.at - start).toFixed(3)]);
  assert.deepEqual(got.map((g) => g[0]), ['sfx:boss_roar', 'fx:ring', 'fx:shake', 'hit']);
  for (const [, time, at] of got) assert.ok(Math.abs(at - time) <= 2 * DT, `事件 ${time} s 在 ${at} s 派发`);
});

test('持续型片段（loop 招式，Tuo 潜游 swim）：进去后一直循环、不自动退出，事件每圈都发', () => {
  const m = machine('SK_Enemy_Tuo');
  const swim = m.clips.get('swim').duration;
  m.sm.setTrigger('act_swim');
  m.run(swim * 3 + 0.2);
  assert.equal(m.sm.currentState().name, 'swim');
  const rings = m.events.filter((e) => e.state === 'swim' && e.name === 'fx:ring').length;
  assert.ok(rings >= 3 * 6 && rings <= 3 * 7 + 2, `三圈发了 ${rings} 次 fx:ring`);
  m.sm.crossFadeInFixedTime('Locomotion', 0.15);
  m.run(0.2);
  assert.equal(m.sm.currentState().name, 'Locomotion');
});

test('叠加层 Flinch：Hit 触发 0.03 s 进 Flinch，exit 0.9 后 0.1 s 回 FlinchNone；连打重新开始；不打断底层招式', () => {
  const m = machine('SK_Enemy_Fuzhu');
  m.sm.setTrigger('act_charge');
  m.run(0.2);
  m.sm.setTrigger('Hit');
  m.run(DT);
  assert.equal(m.sm.currentState(1).name, 'Flinch');
  assert.equal(m.sm.currentState(0).name, 'charge', '底层招式照常');
  m.run(0.3);
  m.sm.setTrigger('Hit');
  m.run(DT);
  assert.ok(m.sm.currentState(1).normalizedTime < 0.1, '连打从头再来');
  const fl = m.clips.get('Flinch').duration;
  const t = until(m, 'FlinchNone', 3, 1);
  assert.ok(Math.abs(t - fl * 0.9) < 4 * DT, `Flinch 播了 ${t.toFixed(3)} s`);
});

test('叠加 Flinch 姿势：第 0 帧叠上去是零（参考帧 = 待机第 0 帧），踢满时腿 / 颈明显偏开，播完与没挨打的同一时刻一致', () => {
  const a = machine('SK_Enemy_Fuzhu'), b = machine('SK_Enemy_Fuzhu');
  const worst = () => {
    let w = 0;
    // 片段值是 Float32：|q| 比 1 小 1e-7 量级，同一个四元数直接 angleTo 自己也会得到 0.04°，先单位化
    a.model.traverse((o) => { const p = b.model.getObjectByName(o.name); if (p && o !== a.model) w = Math.max(w, THREE.MathUtils.radToDeg(o.quaternion.clone().normalize().angleTo(p.quaternion.clone().normalize()))); });
    return w;
  };
  b.sm.setTrigger('Hit');
  a.run(DT); b.run(DT);
  assert.ok(worst() < 0.2, `叠加起点几乎为零（${worst().toFixed(2)}°）`);
  a.run(5 * DT); b.run(5 * DT);
  assert.ok(worst() > 10, `踢满时最大偏差 ${worst().toFixed(1)}°`);
  a.run(1.2); b.run(1.2);
  assert.equal(b.sm.currentState(1).name, 'FlinchNone');
  assert.ok(worst() < 0.01, `播完后一致（${worst().toFixed(3)}°）`);
});

test('CrossFadeInFixedTime 到 Hit（眩晕）：0.95 处 0.1 s 回 Locomotion', () => {
  const m = machine('SK_Enemy_Fuzhu');
  m.sm.crossFadeInFixedTime('Hit', 0.05);
  m.run(DT);
  const hit = m.clips.get('Hit').duration;
  const t = until(m, 'Locomotion') + DT;
  assert.ok(Math.abs(t - hit * 0.95) < 3 * DT);
});

test('Play：立刻切状态、没有过渡；Qingniao 栖落 perched 是持续型', () => {
  const m = machine('SK_Enemy_Qingniao');
  m.sm.play('perched');
  m.run(DT);
  assert.equal(m.sm.currentState().inTransition, false);
  m.run(m.clips.get('perched').duration * 2.5);
  assert.equal(m.sm.currentState().name, 'perched');
});

test('没有控制器的资产按 NativeClipBuilder 规则现搭的状态机也能跑（Fuzhu 去掉 controller）', () => {
  const data = { ...animData('SK_Enemy_Fuzhu'), controller: null };
  const model = buildSkeleton('SK_Enemy_Fuzhu');
  const sm = new anim.AnimatorStateMachine(model, anim.buildDefaultController(data), anim.buildClips(data));
  sm.setTrigger('act_charge');
  for (let i = 0; i < 80; i++) sm.update(DT);
  assert.equal(sm.currentState().name, 'recover');
});

// ───────────── CreatureRig ─────────────
function rigged(id, ground = null) {
  const data = animData(id);
  const model = buildSkeleton(id);
  const root = new THREE.Group();
  root.add(model);
  const ca = new anim.CreatureAnimator(data, model, { root, ground });
  return { data, model, root, ca };
}

test('骨骼识别（CreatureRigBuilder）：Fuzhu 四条腿、hips 骨盆、颈 → 头、脊柱两节、尾巴一条弹簧链', () => {
  const { ca } = rigged('SK_Enemy_Fuzhu');
  const r = ca.rig;
  assert.deepEqual(r.legs.map((l) => l.end.name).sort(), ['fhoof_L', 'fhoof_R', 'hhoof_L', 'hhoof_R']);
  assert.deepEqual(r.legs.map((l) => l.upper.name).sort(), ['forearm_L', 'forearm_R', 'shin_L', 'shin_R'], '腿 = 末三节（蹄 → 管骨 → 前臂 / 胫）');
  assert.equal(r.pelvis.name, 'hips');
  assert.deepEqual(r.lookBones.map((b) => b.name), ['neck', 'head']);
  assert.deepEqual(r.spineBones.map((b) => b.name), ['spine', 'chest']);
  assert.deepEqual(r.springs.map((s) => `${s.family}:${s.bones.map((b) => b.name).join('>')}`), ['tail:tail_1>tail_2']);
  assert.ok(r.legLength > 0.2 && r.legLength < 1);
});

test('蝎尾弩卫的尾巴不挂弹簧（主动瞄准的肢体）；狐巫九尾分叉成多条链', () => {
  assert.equal(rigged('SK_Enemy_ScorpionArcher').ca.rig.springs.filter((s) => s.family === 'tail').length, 0);
  const fox = rigged('SK_Enemy_FoxWitch').ca.rig;
  assert.ok(fox.springs.filter((s) => s.family === 'tail').length >= 9, `狐巫尾巴链 ${fox.springs.filter((s) => s.family === 'tail').length} 条`);
});

test('受击弹簧：重击把脊柱推歪（≤ 25°）再弹回；方向 = 受力方向', () => {
  const { ca, model } = rigged('SK_Enemy_Fuzhu');
  ca.update(DT);
  const chest = model.getObjectByName('chest');
  const head0 = new THREE.Vector3().setFromMatrixPosition(model.getObjectByName('head').matrixWorld);
  ca.hit(new THREE.Vector3(1, 0, 0), 1);
  let peak = 0, pushed = 0;
  for (let i = 0; i < 12; i++) {
    ca.update(DT);
    peak = Math.max(peak, ca.rig.hitAngleDeg);
    model.updateMatrixWorld(true);
    pushed = Math.max(pushed, new THREE.Vector3().setFromMatrixPosition(model.getObjectByName('head').matrixWorld).x - head0.x);
  }
  assert.ok(peak > 5 && peak <= 25.001, `最大压歪 ${peak.toFixed(1)}°`);
  assert.ok(pushed > 0.01, `头顺着受力方向（+X）移动 ${pushed.toFixed(3)} m`);
  for (let i = 0; i < 90; i++) ca.update(DT);
  assert.ok(ca.rig.hitAngleDeg < 0.5, `1.5 s 后回弹到 ${ca.rig.hitAngleDeg.toFixed(2)}°`);
  assert.ok(chest, 'chest');
});

test('姿势保护：连续受击 / 看向不会让没被动画重写的骨骼一帧帧累积歪掉', () => {
  const { ca, model } = rigged('SK_Enemy_Fuzhu');
  ca.rig.lookTarget = new THREE.Vector3(3, 1, 3);
  for (let i = 0; i < 240; i++) {
    if (i % 6 === 0) ca.hit(new THREE.Vector3(1, 0, 0), 0.3);
    ca.update(DT);
  }
  ca.rig.lookTarget = null;
  for (let i = 0; i < 240; i++) ca.update(DT);
  const sm = new anim.AnimatorStateMachine(buildSkeleton('SK_Enemy_Fuzhu'), ca.animator.controller, ca.clips);
  // 停手 4 秒后，脊柱与只做 Idle 的同一时刻相比差不多（弹簧回位、保护还原）
  for (let i = 0; i < 480; i++) sm.update(DT);
  const a = model.getObjectByName('chest').quaternion, b = sm.mixer.getRoot().getObjectByName('chest').quaternion;
  assert.ok(THREE.MathUtils.radToDeg(a.angleTo(b)) < 2, `胸口偏差 ${THREE.MathUtils.radToDeg(a.angleTo(b)).toFixed(2)}°`);
});

test('看向：目标在左前方，头转过去；目标在身后，放开', () => {
  // 两只同步跑：一只看向、一只不看，头的世界朝向之差就是看向层加上去的转动
  const a = rigged('SK_Enemy_Fuzhu'), b = rigged('SK_Enemy_Fuzhu');
  const step = (n) => { for (let i = 0; i < n; i++) { a.ca.update(DT); b.ca.update(DT); } };
  const added = () => {
    const qa = a.model.getObjectByName('head').getWorldQuaternion(new THREE.Quaternion());
    const qb = b.model.getObjectByName('head').getWorldQuaternion(new THREE.Quaternion());
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(qa.multiply(qb.invert()));
    return { yaw: THREE.MathUtils.radToDeg(Math.atan2(f.x, f.z)), pitch: THREE.MathUtils.radToDeg(Math.asin(f.y)) };
  };
  step(30);
  a.ca.rig.lookTarget = new THREE.Vector3(4, 0.9, 4); // +X = 生物的左前方（three 右手系）
  step(120);
  const left = added();
  assert.ok(left.yaw > 25 && left.yaw <= 75.5, `头往左转了 ${left.yaw.toFixed(1)}°`);
  a.ca.rig.lookTarget = new THREE.Vector3(0, 6, 3); // 正上前方：抬头
  step(120);
  assert.ok(added().pitch > 15 && added().pitch <= 35.5, `抬头 ${added().pitch.toFixed(1)}°`);
  a.ca.rig.lookTarget = new THREE.Vector3(0, 1, -5); // 身后：放开
  step(150);
  assert.ok(Math.abs(added().yaw) < 2 && Math.abs(added().pitch) < 2, `身后的目标放开（${added().yaw.toFixed(1)}°）`);
});

test('脚步 IK：地面抬高 6 cm，支撑脚落到地面上（≥ 地面 + 踝高），骨盆跟着抬；地面平时脚不动', () => {
  let groundY = 0;
  const probe = (x, y, z, max) => (y - groundY <= max && y >= groundY ? groundY : null);
  const { ca, model } = rigged('SK_Enemy_Fuzhu', probe);
  for (let i = 0; i < 60; i++) ca.update(DT);
  const footY = () => ca.rig.legs.map((l) => new THREE.Vector3().setFromMatrixPosition(l.end.matrixWorld).y);
  const flat = footY();
  groundY = 0.06;
  for (let i = 0; i < 90; i++) ca.update(DT);
  model.updateMatrixWorld(true);
  const raised = footY();
  ca.rig.legs.forEach((l, i) => {
    assert.ok(raised[i] >= groundY + l.restLift - 0.01, `${l.end.name} 落在 ${raised[i].toFixed(3)}（地面 ${groundY} + 踝高 ${l.restLift.toFixed(3)}）`);
    assert.ok(raised[i] - flat[i] > 0.03, `${l.end.name} 抬高了 ${(raised[i] - flat[i]).toFixed(3)} m`);
  });
});

test('两骨 IK：末端到达够得着的目标，弯曲平面不变', () => {
  const a = new THREE.Object3D(), b = new THREE.Object3D(), c = new THREE.Object3D();
  a.add(b); b.add(c);
  b.position.set(0, -0.5, 0.05);
  c.position.set(0, -0.5, -0.05);
  a.updateMatrixWorld(true);
  const target = new THREE.Vector3(0.1, -0.7, 0.2);
  anim.solveTwoBone(a, b, c, target);
  a.updateMatrixWorld(true);
  const end = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
  assert.ok(end.distanceTo(target) < 1e-3, `末端离目标 ${end.distanceTo(target)}`);
});

test('CreatureLocomotion：根节点 3 m/s 前进 → Speed 平滑到 3；右转时身体向右压（lean > 0），左转向左', () => {
  const { ca, root } = rigged('SK_Enemy_Fuzhu');
  for (let i = 0; i < 60; i++) { root.position.z += 3 * DT; ca.update(DT); }
  assert.ok(Math.abs(ca.animator.getFloat('Speed') - 3) < 0.05, `Speed ${ca.animator.getFloat('Speed')}`);
  assert.equal(ca.animator.getFloat('MoveScale'), 1);
  // three 绕 +Y 负转 = 从上往下看顺时针 = 右转
  for (let i = 0; i < 20; i++) { root.rotation.y -= 1.5 * DT; root.position.z += 3 * DT; ca.update(DT); }
  assert.ok(ca.rig.lean > 1, `右转 lean ${ca.rig.lean.toFixed(2)}`);
  for (let i = 0; i < 20; i++) { root.rotation.y += 1.5 * DT; root.position.z += 3 * DT; ca.update(DT); }
  assert.ok(ca.rig.lean < -1, `左转 lean ${ca.rig.lean.toFixed(2)}`);
  // 超过最快片段的录制速度：MoveScale 加快
  for (let i = 0; i < 60; i++) { root.position.x += 8 * DT; ca.update(DT); }
  assert.ok(ca.animator.getFloat('MoveScale') > 1.5, `MoveScale ${ca.animator.getFloat('MoveScale')}`);
});

test('CreatureAnimator.playTimed：ActScale = 片段长 / 期望秒数（钳 0.4–2.5）', () => {
  const { ca } = rigged('SK_Enemy_Fuzhu');
  const len = ca.clipLength('charge');
  ca.playTimed('charge', len / 2);
  assert.ok(Math.abs(ca.animator.getFloat('ActScale') - 2) < 1e-6);
  ca.playTimed('charge', len * 10);
  assert.equal(ca.animator.getFloat('ActScale'), 0.4);
  ca.play('charge');
  assert.equal(ca.animator.getFloat('ActScale'), 1);
});
