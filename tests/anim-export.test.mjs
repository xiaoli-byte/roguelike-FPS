// 采样动画导出（scripts/web/export-native-anims.mjs → public/assets/anim/）的回归：
// 片段数 / 事件时刻 / 循环与连段与源数据一致，解码后的骨骼姿势按 Unity NativeClipBuilder 的换算还原到采样姿势，
// 导出的状态机与 Unity 生成规则（buildDefaultController）逐项相同。采样源数据不入库：找不到时相关用例跳过。
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { anim, animData, buildSkeleton, loadOverlay, loadSource, manifest, poseAt, ROOT, sourceDir } from './anim-fixtures.mjs';

const SRC = sourceDir();
const M = manifest();
const sourceIds = SRC ? readdirSync(SRC).filter((id) => { try { loadSource(SRC, id); return true; } catch { return false; } }).sort() : [];

test('清单：每个采样资产要么导出、要么写明跳过原因；合计片段数与源数据相同', { skip: !SRC && '没有 *.native-anim.json（不入库）' }, () => {
  let total = 0, exported = 0;
  for (const id of sourceIds) {
    const src = loadSource(SRC, id);
    total += Object.keys(src.clips).length;
    if (M.skipped[id]) {
      assert.ok(M.skipped[id].length > 10, `${id} 跳过要有原因`);
      continue;
    }
    const info = M.assets[id];
    assert.ok(info, `${id} 不在清单里`);
    assert.equal(info.nativeClips, Object.keys(src.clips).length, `${id} 片段数`);
    const data = animData(id);
    const names = Object.keys(data.clips).filter((k) => !data.clips[k].derived);
    assert.deepEqual(names.sort(), Object.keys(src.clips).sort(), `${id} 片段名`);
    exported += names.length;
  }
  assert.equal(sourceIds.length, Object.keys(M.assets).length + Object.keys(M.skipped).length);
  assert.equal(M.totals.nativeClips, exported);
  // 审计时的数：53 份源数据、487 个片段；魔将（18 个）因为 11-07 换了骨架跳过
  assert.equal(total, 487);
  assert.deepEqual(Object.keys(M.skipped), ['SK_Boss_Warlord']);
});

test('事件：采样事件的时刻原样保留（钳到片段长度），叠加表事件按归一化时刻 × 长度并入', { skip: !SRC && '没有采样源数据' }, () => {
  let sampled = 0, overlaid = 0;
  for (const id of Object.keys(M.assets)) {
    const src = loadSource(SRC, id);
    const overlay = loadOverlay(id);
    const data = animData(id);
    for (const [name, c] of Object.entries(src.clips)) {
      const out = data.clips[name];
      const length = (c.frames.length - 1) / src.fps;
      assert.equal(out.frames, c.frames.length, `${id}/${name} 帧数`);
      assert.ok(Math.abs(out.duration - length) < 1e-4, `${id}/${name} 时长`);
      const ov = overlay[name];
      const replace = !Array.isArray(ov) && !!ov?.replace;
      const extra = Array.isArray(ov) ? ov : ov?.events ?? [];
      const expected = [
        ...(replace ? [] : c.events.map((e) => ({ t: Math.min(e.t, length), name: e.name }))),
        ...extra.map((e) => ({ t: Math.min(1, Math.max(0, e.at)) * length, name: e.name })),
      ];
      assert.equal(out.events.length, expected.length, `${id}/${name} 事件数`);
      for (const e of expected) {
        assert.ok(out.events.some((o) => o.name === e.name && Math.abs(o.t - e.t) < 1e-4), `${id}/${name} 缺事件 ${e.name}@${e.t}`);
      }
      for (let i = 1; i < out.events.length; i++) assert.ok(out.events[i].t >= out.events[i - 1].t, `${id}/${name} 事件按时刻排序`);
      sampled += replace ? 0 : c.events.length;
      overlaid += extra.length;
    }
  }
  assert.ok(sampled > 300 && overlaid > 100, `采样事件 ${sampled}、叠加事件 ${overlaid}`);
});

test('循环、连段、录制速度：与源数据一致（叠加表覆盖优先）', { skip: !SRC && '没有采样源数据' }, () => {
  for (const id of Object.keys(M.assets)) {
    const src = loadSource(SRC, id);
    const overlay = loadOverlay(id);
    const data = animData(id);
    for (const [name, c] of Object.entries(src.clips)) {
      const ov = overlay[name] && !Array.isArray(overlay[name]) ? overlay[name] : {};
      const out = data.clips[name];
      assert.equal(out.loop, !!(ov.loop ?? c.loop), `${id}/${name} loop`);
      assert.equal(out.next ?? null, ov.next ?? c.next ?? null, `${id}/${name} next`);
      assert.equal(out.speed ?? null, ov.speed ?? c.speed ?? null, `${id}/${name} speed`);
    }
    if (src.clips.Hit && src.clips.Idle) {
      assert.equal(data.clips.Flinch?.derived, 'Hit', `${id} 有 Flinch 叠加片段`);
      assert.equal(data.clips.Flinch.frames, src.clips.Hit.frames.length + 1);
      assert.equal(data.clips.Flinch.events.length, 0);
    }
  }
});

test('解码姿势：每个片段若干帧的骨骼模型空间朝向 / 位置还原到采样值（Unity 增量换算，容差 6 mm / 1°）', { skip: !SRC && '没有采样源数据' }, () => {
  const ids = ['SK_Enemy_Fuzhu', 'SK_Enemy_FoxWitch', 'SK_Enemy_ScorpionArcher', 'SK_Boss_Kui', 'SK_Pet_Zheng', 'SK_Enemy_XuanGui'];
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  let checked = 0, worstP = 0, worstR = 0;
  for (const id of ids) {
    const src = loadSource(SRC, id);
    const data = animData(id);
    const model = buildSkeleton(id);
    anim.ensureSockets(model, data);
    model.updateMatrixWorld(true);
    // GLB 绑定朝向（模型空间）
    const bind = new Map();
    model.traverse((o) => { if (o !== model) { o.matrixWorld.decompose(p, q, s); bind.set(o.name, q.clone()); } });
    const names = [...src.bones, ...src.sockets.map((n) => `socket_${n}`)];
    for (const [clipName, c] of Object.entries(src.clips)) {
      const clip = anim.buildClip(data, clipName);
      const nf = c.frames.length;
      for (const f of [0, Math.floor(nf / 3), Math.floor((2 * nf) / 3), nf - 1]) {
        const pose = poseAt(model, clip, f / src.fps);
        const fr = c.frames[f];
        const dy = c.rootY?.[f] ?? 0;
        names.forEach((name, k) => {
          const i = k * 7;
          const restQ = new THREE.Quaternion(src.rest[i], src.rest[i + 1], src.rest[i + 2], src.rest[i + 3]);
          const bindQ = k < src.bones.length ? bind.get(THREE.PropertyBinding.sanitizeNodeName(name)) : restQ;
          const wantQ = new THREE.Quaternion(fr[i], fr[i + 1], fr[i + 2], fr[i + 3]).multiply(restQ.clone().invert()).multiply(bindQ);
          const wantP = new THREE.Vector3(fr[i + 4], fr[i + 5] + dy, fr[i + 6]);
          pose.get(THREE.PropertyBinding.sanitizeNodeName(name)).decompose(p, q, s);
          const dp = p.distanceTo(wantP), dr = THREE.MathUtils.radToDeg(q.angleTo(wantQ));
          worstP = Math.max(worstP, dp);
          worstR = Math.max(worstR, dr);
          assert.ok(dp < 0.006, `${id}/${clipName}@${f} ${name} 位置差 ${dp.toFixed(4)} m`);
          assert.ok(dr < 1, `${id}/${clipName}@${f} ${name} 朝向差 ${dr.toFixed(2)}°`);
          checked++;
        });
      }
    }
  }
  assert.ok(checked > 3000, `核对了 ${checked} 个骨骼姿势（最大误差 ${(worstP * 1000).toFixed(1)} mm / ${worstR.toFixed(2)}°）`);
});

test('状态机：导出的 AC_ 控制器与 NativeClipBuilder 的生成规则逐项相同（纯采样资产）', () => {
  let compared = 0;
  for (const [id, info] of Object.entries(M.assets)) {
    if (info.keyframed.length || info.pending.length) continue; // 手 K 片段并进来的控制器多了状态
    const data = animData(id);
    if (!data.controller) continue;
    const built = anim.buildDefaultController(data);
    const norm = (c) => JSON.parse(JSON.stringify({ parameters: c.parameters, layers: c.layers.map((l) => ({ ...l, states: [...l.states].sort((a, b) => a.name.localeCompare(b.name)) })) }));
    assert.deepEqual(norm(data.controller), norm(built), `${id} 控制器`);
    compared++;
  }
  assert.ok(compared >= 30, `对照了 ${compared} 个控制器`);
});

test('Fuzhu 控制器：Unity 的转换时长原样带过来', () => {
  const c = animData('SK_Enemy_Fuzhu').controller;
  const base = c.layers[0];
  assert.equal(base.defaultState, 'Locomotion');
  const loco = base.states.find((s) => s.name === 'Locomotion');
  assert.deepEqual(loco.motion.blend.children.map((ch) => [ch.clip, ch.threshold]), [['Idle', 0], ['Walk', 2.2], ['Move', 4.4]]);
  assert.equal(loco.speedParam, 'MoveScale');
  assert.deepEqual(base.anyState.map((t) => [t.to, t.conditions[0].param, t.duration]), [['crouch', 'act_crouch', 0.12], ['charge', 'act_charge', 0.12]]);
  const tr = (from) => base.states.find((s) => s.name === from).transitions[0];
  assert.deepEqual([tr('crouch').to, tr('crouch').exitTime, tr('crouch').duration], ['leap', 0.98, 0.05]);
  assert.deepEqual([tr('land').to, tr('land').duration], ['Locomotion', 0.2]);
  assert.deepEqual([tr('Hit').to, tr('Hit').exitTime, tr('Hit').duration], ['Locomotion', 0.95, 0.1]);
  const fl = c.layers[1];
  assert.equal(fl.blending, 'additive');
  assert.equal(fl.anyState[0].duration, 0.03);
  assert.equal(fl.states.find((s) => s.name === 'Flinch').transitions[0].exitTime, 0.9);
});

test('发布的动画文件由当前源数据生成（export-native-anims --check）', { skip: !SRC && '没有采样源数据' }, () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/web/export-native-anims.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout.split('\n').filter((l) => /过期|✘/.test(l)).join('\n') || r.stderr);
});
