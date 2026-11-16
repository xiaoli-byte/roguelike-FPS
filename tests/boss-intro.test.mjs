// 首领登场演出（Unity EditMode BossIntroTests 逐条改写）：缓动、落地零误差、环绕、决斗坐标系、视线、镜头表查找、旱魃演出表自检、跳过规则。
// 外加首领招式时间轴（BossMove：前摇 → 出手 → 收招、cue 先到先算、打断撤回预警）与旱魃招式的出手时刻跟动画事件对齐。
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { importTs } from './hanba-load.mjs';

const M = await importTs('../src/enemies/bosses/intro/IntroMath.ts');
const S = await importTs('../src/enemies/bosses/intro/BossIntroScript.ts');
const { hanbaIntro, RISE_SECONDS } = await importTs('../src/enemies/bosses/HanbaIntro.ts');
const { HanbaDef } = await importTs('../src/enemies/bosses/HanbaDef.ts');
const { BossMove } = await importTs('../src/enemies/bosses/framework/BossMove.ts');
const { bossMove } = await importTs('../src/enemies/bosses/framework/BossDef.ts');
const Plans = await importTs('../src/enemies/bosses/HanbaPlans.ts');

const EASES = ['linear', 'in', 'out', 'inOut', 'smoother'];
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} 期望 ${b}，实际 ${a}`);
const DEG = Math.PI / 180;

/** 玩家眼睛：原地慢慢转向首领（落地期间视线跟随） */
const eyeAt = t => ({ position: new THREE.Vector3(0, 1.62, 0), quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(-4 * DEG, 3 * t * DEG, 0, 'YXZ')), fov: 80 });

test('Eases_HitEndpoints_AndAreMonotonic', () => {
  for (const e of EASES) {
    assert.equal(M.ease(e, 0), 0);
    assert.equal(M.ease(e, 1), 1);
    assert.equal(M.ease(e, -0.5), 0);
    assert.equal(M.ease(e, 1.5), 1);
    assert.equal(M.ease(e, NaN), 0);
    let prev = 0;
    for (let i = 1; i <= 200; i++) {
      const v = M.ease(e, i / 200);
      assert.ok(v >= prev - 1e-6, `${e} 在 ${i / 200} 处回头了`);
      prev = v;
    }
  }
});

test('Smoother_StartsAndEndsAtRest', () => {
  const h = 1e-3;
  assert.ok((M.ease('smoother', h) - M.ease('smoother', 0)) / h < 1e-3, '落地起步速度为 0');
  assert.ok((M.ease('smoother', 1) - M.ease('smoother', 1 - h)) / h < 1e-3, '落地到达速度为 0');
  assert.equal(M.landWeight(1.3, 1.3), 1);
  assert.equal(M.landWeight(2, 1.3), 1);
  assert.equal(M.landWeight(0.1, 0), 1, '时长 0 = 直接到位');
  assert.equal(M.landWeight(0, 1.3), 0);
});

test('Blend_ReturnsTargetExactly_AtFullWeight', () => {
  let seed = 7;
  const r = (a, b) => { seed = (seed * 16807) % 2147483647; return a + (seed / 2147483647) * (b - a); };
  const rand = () => ({
    position: new THREE.Vector3(r(-50, 50), r(0, 30), r(-50, 50)),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(r(-80, 80) * DEG, r(-180, 180) * DEG, r(-10, 10) * DEG)),
    fov: r(30, 100),
  });
  for (let i = 0; i < 50; i++) {
    const a = rand(), b = rand();
    const full = M.blend(a, b, 1);
    assert.ok(full.position.equals(b.position) && full.quaternion.equals(b.quaternion) && full.fov === b.fov, 'w = 1 原样');
    assert.ok(M.blend(a, b, 1.7).position.equals(b.position));
    const none = M.blend(a, b, 0);
    assert.ok(none.position.equals(a.position) && none.quaternion.equals(a.quaternion), 'w = 0 原样是起点');
    const e = M.poseError(M.land(a, b, 1.4, 1.4), b);
    assert.equal(e.meters, 0);
    near(e.degrees, 0, 1e-3);
    assert.equal(e.fov, 0);
  }
});

test('Landing_ConvergesToMovingEye_WithoutJumps_AtAnyFrameRate', () => {
  const from = M.lookPose(new THREE.Vector3(3, 4, 30), new THREE.Vector3(0, 3, 40), 38, 4);
  let js = 3;
  const jitter = i => { js = (js * 16807) % 2147483647; return i % 17 === 5 ? 0.09 : 0.008 + (js / 2147483647) * 0.03; };
  for (const dts of [() => 1 / 60, () => 1 / 30, () => 1 / 144, jitter]) {
    for (const seconds of [1.4, 0.7]) {
      let u = 0, maxStep = 0, maxTurn = 0, frame = 0;
      let last = from, eye, pose;
      const total = M.poseError(from, eyeAt(0));
      for (;;) {
        u += dts(frame++);
        eye = eyeAt(u);
        pose = M.land(from, eye, u, seconds);
        maxStep = Math.max(maxStep, last.position.distanceTo(pose.position));
        maxTurn = Math.max(maxTurn, last.quaternion.angleTo(pose.quaternion) / DEG);
        last = pose;
        if (u >= seconds) break;
        assert.ok(frame < 10000);
      }
      const e = M.poseError(pose, eye);
      assert.equal(e.meters, 0, `${seconds}s 落地：最后一帧位置误差`);
      near(e.degrees, 0, 1e-3);
      assert.equal(e.fov, 0);
      assert.ok(maxStep / total.meters < 0.25, `单帧位移 ${maxStep.toFixed(2)} / ${total.meters.toFixed(1)}`);
      assert.ok(maxTurn / total.degrees < 0.25, `单帧转角 ${maxTurn.toFixed(1)} / ${total.degrees.toFixed(0)}`);
    }
  }
});

test('LandArcAndStretch_KeepHandoffExact', () => {
  assert.equal(M.landLift(3, 0), 0);
  assert.equal(M.landLift(3, 1), 0);
  assert.equal(M.landLift(3, 1.2), 0);
  near(M.landLift(3, 0.5), 3, 1e-5);
  assert.equal(M.landLift(NaN, 0.5), 0);
  assert.equal(M.landLiftFor(1), 0);
  assert.equal(M.landLiftFor(200), 4);
  assert.equal(M.landStretch(10), 1);
  near(M.landStretch(500), 1.45, 1e-5);
  assert.equal(M.landStretch(NaN), 1);
  let prev = 0;
  for (let m = 0; m < 120; m += 2.5) {
    const s = M.landStretch(m);
    assert.ok(s >= prev);
    prev = s;
  }
  const from = M.lookPose(new THREE.Vector3(4, 3, 50), new THREE.Vector3(0, 3, 60), 36);
  const eye = eyeAt(0);
  const seconds = 1.3 * M.landStretch(50), lift = M.landLiftFor(50);
  const end = M.land(from, eye, seconds, seconds);
  const p = end.position.clone().add(new THREE.Vector3(0, M.landLift(lift, M.landWeight(seconds, seconds)), 0));
  assert.equal(p.distanceTo(eye.position), 0);
});

test('Orbit_SweepsAroundPivot_WithoutCuttingThrough', () => {
  const a = new THREE.Vector3(-10, 6, -10), b = new THREE.Vector3(10, 3, -10);
  assert.ok(M.orbit(a, b, 0).distanceTo(a) < 1e-4);
  assert.ok(M.orbit(a, b, 1).distanceTo(b) < 1e-4);
  const la = Math.hypot(a.x, a.z);
  for (let i = 0; i <= 20; i++) {
    const p = M.orbit(a, b, i / 20);
    near(Math.hypot(p.x, p.z), la, 1e-3, '一路保持水平距离');
    near(p.y, 6 + (3 - 6) * i / 20, 1e-4, '高度线性');
  }
  assert.ok(M.orbit(a, b, 0.5).z < -13, '走的是看点前面的弧');
  assert.ok(M.finite(M.orbit(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0.5)));
});

test('DuelBasis_PointsFromPlayerToBoss（右 = Cross(up, forward)，与 Unity 同式）', () => {
  let b = M.duelBasis(new THREE.Vector3(0, 0, -20), new THREE.Vector3(0, 3, 0), new THREE.Vector3(1, 0, 0));
  assert.ok(b.forward.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-5);
  assert.ok(b.right.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-5);
  assert.ok(M.toWorld(new THREE.Vector3(1, 2, 3), b.forward, b.right).distanceTo(new THREE.Vector3(1, 2, 3)) < 1e-5);
  b = M.duelBasis(new THREE.Vector3(), new THREE.Vector3(0.1, 5, 0), new THREE.Vector3(-1, 0, 0));
  assert.ok(b.forward.distanceTo(new THREE.Vector3(-1, 0, 0)) < 1e-5, '玩家站在出生点上：退回备用方向');
  b = M.duelBasis(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
  assert.ok(b.forward.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-5, '全退化：+Z');
});

test('YawPitch_LooksAtTarget_AndClampsPitch（网页视线约定：yaw 0 朝 −Z、pitch > 0 抬头）', () => {
  const eye = new THREE.Vector3(2, 1.6, -5), target = new THREE.Vector3(-6, 4, 12);
  const { yaw, pitch } = M.yawPitch(eye, target, 60);
  const cp = Math.cos(pitch);
  const dir = new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  assert.ok(dir.dot(target.clone().sub(eye).normalize()) > 0.9999);
  near(M.yawPitch(eye, eye.clone().add(new THREE.Vector3(0, 50, 1)), 32).pitch, 32 * DEG, 1e-4, '仰角夹在上限');
});

test('LookRotation_NeverNaN，相机 −Z 看向目标，横滚', () => {
  for (const d of [new THREE.Vector3(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -3, 0), new THREE.Vector3(NaN, 0, 1)]) {
    const q = M.lookRotation(new THREE.Vector3(), d, 5);
    assert.ok([q.x, q.y, q.z, q.w].every(Number.isFinite), `${d.toArray()}`);
  }
  const from = new THREE.Vector3(1, 2, 3), to = new THREE.Vector3(-4, 5, 20);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(M.lookRotation(from, to));
  assert.ok(fwd.dot(to.clone().sub(from).normalize()) > 0.9999);
  const up0 = new THREE.Vector3(0, 1, 0).applyQuaternion(M.lookRotation(from, to, 0));
  const up10 = new THREE.Vector3(0, 1, 0).applyQuaternion(M.lookRotation(from, to, 10));
  near(up0.angleTo(up10) / DEG, 10, 1e-3, '横滚 10°');
});

test('ShotTimeline_Lookup', () => {
  const s = new S.BossIntroScript();
  s.id = 't';
  s.shots.push(S.IntroShot.make('a', 1), S.IntroShot.make('b', 2), S.IntroShot.make('c', 0.5));
  near(s.shotsSeconds, 3.5, 1e-5);
  assert.deepEqual(s.shotIndexAt(0), { index: 0, local: 0 });
  assert.equal(s.shotIndexAt(0.99).index, 0);
  let r = s.shotIndexAt(1);
  assert.equal(r.index, 1);
  near(r.local, 0, 1e-5);
  r = s.shotIndexAt(2.9);
  assert.equal(r.index, 1);
  near(r.local, 1.9, 1e-5);
  assert.equal(s.shotIndexAt(3.2).index, 2);
  r = s.shotIndexAt(3.6);
  assert.equal(r.index, -1, '播完');
  near(r.local, 0.1, 1e-5);
  near(s.shotStart(2), 3, 1e-5);
});

test('ShotPose_FollowsTable_AndBlendInStartsFromFirstPerson', () => {
  const script = new S.BossIntroScript();
  script.id = 't';
  const shot = S.IntroShot.make('x', 2).move(S.at('spawn', 0, 2, -10), S.at('spawn', 0, 2, -6)).look(S.at('spawn', 0, 2, 0)).fov(50, 40).ease('linear');
  script.shots.push(shot);
  const ctx = S.BossIntroContext.preview(script, new THREE.Vector3(0, 0, -30), new THREE.Vector3());
  const p0 = S.shotPose(shot, 0, ctx), p1 = S.shotPose(shot, 2, ctx);
  assert.ok(p0.position.distanceTo(new THREE.Vector3(0, 2, -10)) < 1e-4);
  assert.ok(p1.position.distanceTo(new THREE.Vector3(0, 2, -6)) < 1e-4);
  near(S.shotPose(shot, 1, ctx).fov, 45, 1e-4);
  assert.ok(new THREE.Vector3(0, 0, -1).applyQuaternion(p0.quaternion).dot(new THREE.Vector3(0, 0, 1)) > 0.9999, '看着出生点');
  const fp = { position: new THREE.Vector3(0, 1.6, -30), quaternion: new THREE.Quaternion(), fov: 80 };
  const start = M.blend(fp, p0, M.ease('inOut', 0));
  assert.ok(start.position.equals(fp.position));
  assert.equal(start.fov, fp.fov);
});

test('旱魃演出表：自检通过、6–10 s、三镜、第一镜平滑拔起、登场动作在交还前播完、特写前已现身、有场地小字', () => {
  const s = hanbaIntro;
  assert.equal(s.id, 'boss_hanba');
  assert.deepEqual(s.validate(), []);
  assert.ok(s.seconds >= 6 && s.seconds <= 10, `整段 ${s.seconds}`);
  near(s.seconds, 7.9, 1e-6, 'Unity 的 7.9 s');
  assert.ok(s.shots.length >= 3);
  assert.ok(s.shots[0].blendIn > 0);
  const def = new HanbaDef();
  assert.ok(s.spawnAt + def.intro.seconds <= s.seconds, '首领自己的登场动作要在镜头交还前播完');
  assert.ok(s.spawnAt < s.shotStart(s.shots.length - 1));
  assert.ok(s.epithet);
  assert.equal(RISE_SECONDS, 1.6);
  // 锚点在没有场景时也给有限的点
  const ctx = S.BossIntroContext.preview(s, new THREE.Vector3(5, 0, -40), new THREE.Vector3(0, 0, 8));
  for (const shot of s.shots) {
    for (const u of [0, shot.seconds * 0.5, shot.seconds]) {
      const p = S.shotPose(shot, u, ctx);
      assert.ok(M.finite(p.position) && p.fov >= 10 && p.fov <= 120, `${shot.name} @ ${u}`);
    }
  }
  assert.ok(M.finite(ctx.anchor('eye')));
  assert.ok(M.finite(ctx.anchor('no_such_anchor')));
});

test('Validate_CatchesBrokenTables', () => {
  const s = new S.BossIntroScript();
  s.id = 'broken';
  s.spawnAt = 9;
  s.landSeconds = 0.1;
  s.shots.push(S.IntroShot.make('a', 0).move(S.at('nowhere'), { anchor: '', offset: new THREE.Vector3(), sized: false }).look(S.at('head')).fov(5, 200));
  const p = s.validate();
  for (const key of ['时长', 'nowhere', '没有锚点', '视角', '生成时刻', '落回第一人称', '名字卡']) assert.ok(p.some(x => x.includes(key)), key);
});

test('SkipRule_FirstViewWaits_SeenSkipsAnytime', () => {
  assert.equal(S.skipAllowed(false, 0), false);
  assert.equal(S.skipAllowed(false, 1.49), false);
  assert.equal(S.skipAllowed(false, 1.5), true);
  assert.equal(S.skipAllowed(true, 0), true);
  assert.equal(S.FIRST_VIEW_LOCK, 1.5);
});

// ───────────── 招式时间轴（BossMove） ─────────────

class FakeHost {
  phase = 0; formId = 'hanba'; windupScale = 1; telegraphs = 0; acts = [];
  moveDamage(m) { return 15 * m; }
  notifyTelegraph() { this.telegraphs++; }
  playAct(s, sec) { this.acts.push([s, sec]); }
}

class Probe extends BossMove {
  log = [];
  cancels = 0;
  onTelegraph() { this.track(() => { this.cancels++; }); this.log.push('telegraph'); }
  get windupDone() { return this.cue('hit', this.windupTime); }
  onActiveBegin() { this.log.push(`active@${this.t.toFixed(2)}`); }
  onEnd(c) { this.log.push(c ? 'cancel' : 'end'); }
}

test('BossMove：前摇 → 出手 → 收招，动画事件先到就先出手，打断撤回预警', () => {
  const host = new FakeHost();
  const m = new Probe(bossMove({ id: 'p', windup: 1, active: 0.5, recover: 0.4 }));
  m.bind(host);
  m.begin();
  assert.equal(m.stage, 'windup');
  assert.equal(host.telegraphs, 1);
  let steps = 0;
  while (!m.step(0.1)) steps++;
  m.finish();
  const activeAt = Number(m.log.find(x => x.startsWith('active@')).slice(7));
  assert.ok(activeAt >= 1 - 1e-6 && activeAt <= 1.1 + 1e-6, `前摇 1 s 后出手（逐 0.1 s 推进，浮点累加差一帧）：${m.log.join(',')}`);
  assert.equal(m.log.at(-1), 'end');
  near(m.t, 1.9, 0.21);
  // 事件先到：0.3 s 时收到 hit 就出手
  const m2 = new Probe(bossMove({ id: 'p2', windup: 1, active: 0.5, recover: 0.4 }));
  m2.bind(host);
  m2.begin();
  m2.step(0.1);
  m2.step(0.1);
  m2.onAnimEvent('hit');
  m2.step(0.1);
  assert.equal(m2.stage, 'active');
  // 打断：撤回预警、onEnd(true)
  const m3 = new Probe(bossMove({ id: 'p3' }));
  m3.bind(host);
  m3.begin();
  m3.step(0.1);
  m3.cancel();
  m3.cancel();
  assert.equal(m3.cancels, 1);
  assert.equal(m3.log.filter(x => x === 'cancel').length, 1, '可重复调用');
  assert.equal(m3.cancelled, true);
});

test('旱魃招式的出手按 ActAt 拉伸：事件在整段片段里的时刻 = 前摇 − 1/60 s（各阶段节奏）', () => {
  const d = new HanbaDef();
  const table = [
    ['sunSweep', 'beamStart', Plans.SunSweep, 1.4], ['droughtGale', 'hit', Plans.HotWind, 1.1], ['summonWraiths', 'summon', Plans.SandWraiths, 1.6],
    ['crackPalm', 'hit', Plans.CrackLine, 1.2], ['apsaraCall', 'summon', Plans.ApsaraCall, 1.8],
  ];
  for (const [clip, evt, move, windup] of table) {
    for (const pace of d.pace) {
      const wind = Math.max(0.25, windup / pace);
      const seconds = Plans.actAtSeconds(move.ClipHit, wind);
      const scale = Plans.actScale(clip, seconds);
      const frac = Plans.HANBA_CLIPS[clip].events.find(e => e[1] === evt)[0];
      const at = frac * Plans.clipSeconds(clip) / scale;
      // ActScale 夹在 0.4–2.5 之内时事件正好落在前摇结束前一帧
      if (scale > 0.4 && scale < 2.5) near(at, wind - 1 / 60, 2e-3, `${clip} ${pace}`);
    }
  }
});
