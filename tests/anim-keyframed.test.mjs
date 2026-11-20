// M12 第二期的对照（敌人改用片段、Blender 手 K 片段）：
//   · Unity 的 <资产>.events.json 叠加表与发布的 public/assets/anim/<资产>.json 逐条一致（片段、事件名、事件时刻 = 归一化时刻 × 片段长、连段、循环）；
//   · 各敌人类的片段表（clipCues：AI 状态 → 片段）引用的片段都在该资产的控制器里，Unity 对应 AI 播的状态一个不漏；
//   · 片段播放器（src/anim/ClipPlayer）：Play / PlayTimed / PlayLocomotion、受击、冻住、原地播放减掉烘进骨骼的根节点高度；
//   · 第四章手 K 片段与招式时间轴（前摇 / 出手 / 收招）对得上：片段长 = 招式总长、hit / release 事件落在释放帧 ≤ 1 帧；
//   · 鲲 / 鹏 / 火麒麟 / 旱魃 / 商人的手 K 片段齐全，首领招式等的事件都在片段里。
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { anim, animData, buildSkeleton, loadOverlay, manifest, ROOT } from './anim-fixtures.mjs';

const M = manifest();
const FRAME = 1 / 30;
const CHARS = join(ROOT, 'unity/Assets/Art/Characters');
const overlayIds = existsSync(CHARS)
  ? readdirSync(CHARS).filter((id) => existsSync(join(CHARS, id, 'Anim', `${id}.events.json`))).sort()
  : [];

test('叠加表：Unity events.json 的每个片段、每条事件都在发布的动画数据里，时刻 = 归一化时刻 × 片段长（≤ 1 ms）', { skip: overlayIds.length === 0 && '没有 unity/ 目录' }, () => {
  let clips = 0, events = 0;
  const missing = [];
  for (const id of overlayIds) {
    if (M.skipped[id]) continue;
    assert.ok(M.assets[id], `${id} 有叠加表却不在动画清单里`);
    const data = animData(id);
    for (const [name, ov] of Object.entries(loadOverlay(id))) {
      const clip = data.clips[name];
      if (!clip) {
        // 只有 Unity 的镜像片段 / 没导出的手 K 状态可以缺（清单 pending 里写明）
        assert.ok((M.assets[id].pending ?? []).includes(name), `${id}/${name} 没有片段，也不在 pending 里`);
        missing.push(`${id}/${name}`);
        continue;
      }
      clips++;
      const list = Array.isArray(ov) ? ov : ov.events ?? [];
      if (!Array.isArray(ov)) {
        if (ov.next !== undefined) assert.equal(clip.next ?? null, ov.next ?? null, `${id}/${name} 连段`);
        if (ov.loop !== undefined) assert.equal(!!clip.loop, !!ov.loop, `${id}/${name} 循环`);
        if (ov.keyframed) assert.equal(clip.unity, 'keyframed', `${id}/${name} 手 K 标记`);
      }
      for (const e of list) {
        const want = Math.min(clip.duration, Math.max(0, e.at * clip.duration));
        const hit = clip.events.find((x) => x.name === e.name && Math.abs(x.t - want) <= 1e-3);
        assert.ok(hit, `${id}/${name} 事件 ${e.name}@${e.at}（${want.toFixed(3)} s）不在导出数据里：${clip.events.map((x) => `${x.name}@${x.t.toFixed(3)}`).join(' ')}`);
        events++;
      }
      // 叠加表整体替换采样事件的（replace / 手 K）：条数也要一样
      if (!Array.isArray(ov) && (ov.replace || ov.keyframed)) assert.equal(clip.events.length, list.length, `${id}/${name} 事件条数`);
    }
  }
  assert.ok(clips >= 90 && events >= 250, `对照了 ${clips} 个片段 ${events} 条事件`);
  assert.deepEqual(missing.sort(), ['SK_Boss_Feilian/sidestepL', 'SK_Boss_Feilian/wheelR', 'SK_Boss_Kui/sink'].filter((x) => missing.includes(x)));
});

test('手 K 片段：鲲 7、鹏 13、火麒麟两形态各 10、旱魃 10、商人 2、第四章五种敌人——都从 Blender 导出（src = blender），没有待补的', () => {
  const want = {
    SK_Boss_Kun: 7, SK_Boss_Peng: 13, SK_Boss_Qilin: 10, SK_Boss_QilinBurn: 10, SK_Boss_Hanba: 10, SK_Npc_Merchant: 2,
    SK_Enemy_Aoyin: 2, SK_Enemy_Jufu: 1, SK_Enemy_Manman: 1, SK_Enemy_Qiongqi: 1, SK_Enemy_Tiangou: 1,
  };
  let total = 0;
  for (const [id, n] of Object.entries(want)) {
    const data = animData(id);
    const blender = Object.entries(data.clips).filter(([, c]) => c.src === 'blender');
    assert.equal(blender.length, n, `${id} 手 K 片段数`);
    assert.equal(M.assets[id].blenderClips, n, `${id} 清单`);
    assert.deepEqual(M.assets[id].pending ?? [], [], `${id} 不该有待补片段`);
    for (const [name, c] of blender) {
      assert.ok(c.frames >= 2 && Math.abs(c.duration - (c.frames - 1) * FRAME) < 1e-4, `${id}/${name} 时长 = (帧数 − 1) / 30`);
      assert.ok(c.tracks.length > 0, `${id}/${name} 有曲线`);
      for (const e of c.events) assert.ok(e.t >= 0 && e.t <= c.duration + 1e-6, `${id}/${name} 事件 ${e.name} 在片段内`);
    }
    total += n;
  }
  assert.equal(M.totals.blenderClips, total);
});

// ───────────── 敌人类的片段表 ─────────────

const TYPES = join(ROOT, 'src/enemies/types');
const AI = join(ROOT, 'unity/Assets/Game/Scripts/Enemies');

/** 解析 clipCues() 的返回表：AI 状态 → 片段状态名（'loco' = Locomotion） */
function cueTable(src) {
  const m = /clipCues\(\)[^{]*\{\s*return \{([\s\S]*?)\n    \};/.exec(src);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const k = /^\s*(\w+): (.*),\s*$/.exec(line);
    if (!k) continue;
    const c = /clip: '(\w+)'/.exec(k[2]);
    out[k[1]] = k[2] === "'loco'" ? 'Locomotion' : c ? c[1] : k[1];
  }
  return out;
}

const typeFiles = readdirSync(TYPES).filter((f) => f.endsWith('.ts'));
const cued = typeFiles.map((f) => {
  const src = readFileSync(join(TYPES, f), 'utf8');
  const table = cueTable(src);
  const defId = /id: '(\w+)'/.exec(src)?.[1];
  const asset = Object.entries(M.assets).find(([, v]) => v.defId === defId)?.[0];
  return { name: f.replace('.ts', ''), src, table, defId, asset };
}).filter((t) => t.table);

test('片段表：前三章 27 种有片段的敌人都有 clipCues，引用的片段都是该资产控制器里的状态', () => {
  assert.equal(cued.length, 27);
  for (const t of cued) {
    assert.ok(t.asset, `${t.name}（${t.defId}）找不到动画资产`);
    const states = new Set(animData(t.asset).controller.layers[0].states.map((s) => s.name));
    for (const [state, clip] of Object.entries(t.table)) assert.ok(states.has(clip), `${t.name}: ${state} → ${clip} 不是 ${t.asset} 的状态`);
    assert.ok(Object.values(t.table).includes('Locomotion') || t.name === 'Tuo', `${t.name} 至少有一个状态回 Locomotion`);
  }
  // 有原生骨架片段、却没有片段表的普通敌人：没有
  const enemyAssets = Object.entries(M.assets).filter(([id]) => id.startsWith('SK_Enemy_')).map(([id]) => id);
  const plateau = ['SK_Enemy_Aoyin', 'SK_Enemy_Dijiang', 'SK_Enemy_Jufu', 'SK_Enemy_Manman', 'SK_Enemy_Marmot', 'SK_Enemy_Qiongqi', 'SK_Enemy_Tiangou'];
  assert.deepEqual(enemyAssets.filter((id) => !plateau.includes(id) && !cued.some((t) => t.asset === id)), []);
});

test('片段表：Unity 对应 AI 里 Play / PlayTimed / Act* 播的每个状态，网页敌人类都播（片段表或直接 playClip）', { skip: !existsSync(AI) && '没有 unity/ 目录' }, () => {
  let checked = 0;
  for (const t of cued) {
    const path = [join(AI, `${t.name}AI.cs`), join(AI, 'AI/Frost', `${t.name}AI.cs`), join(AI, 'AI/Inferno', `${t.name}AI.cs`)].find(existsSync);
    assert.ok(path, `${t.name} 找不到 Unity AI`);
    const cs = readFileSync(path, 'utf8');
    const states = new Set(animData(t.asset).controller.layers[0].states.map((s) => s.name));
    const played = new Set([...cs.matchAll(/\b(?:Play|PlayTimed|Act|ActTimed|ActOnce|ActLoop|Go|Enter)\(\s*"([a-z]\w*)"/g)].map((x) => x[1]).filter((s) => states.has(s)));
    const web = new Set([...Object.values(t.table), ...[...t.src.matchAll(/playClip\('(\w+)'/g)].map((x) => x[1])]);
    for (const s of played) {
      assert.ok(web.has(s), `${t.name}: Unity 播 ${s}，网页没有`);
      checked++;
    }
  }
  assert.ok(checked > 60, `对照了 ${checked} 个状态`);
});

test('片段表的过渡秒数：第一章六种敌人与 Unity 的 Play / PlayTimed 实参逐个相同', { skip: !existsSync(AI) && '没有 unity/ 目录' }, () => {
  let n = 0;
  for (const name of ['FireRat', 'JerboaBlade', 'MirageToad', 'ScorpionArcher', 'TombBeast']) {
    const t = cued.find((x) => x.name === name);
    const cs = readFileSync(join(AI, `${name}AI.cs`), 'utf8');
    for (const m of cs.matchAll(/\bPlay(Timed)?\("([a-z]\w*)",(?:[^;]*?,)?\s*([\d.]+)f\);/g)) {
      const line = new RegExp(`^\\s*${m[2]}: \\{[^}]*fade: ([\\d.]+)`, 'm').exec(t.src);
      assert.ok(line, `${name}.${m[2]} 没有片段表项`);
      assert.equal(Number(line[1]), Number(m[3]), `${name}.${m[2]} 过渡秒数`);
      assert.equal(/secs:/.test(new RegExp(`^\\s*${m[2]}: \\{[^}]*\\}`, 'm').exec(t.src)[0]), !!m[1], `${name}.${m[2]} 是不是 PlayTimed`);
      n++;
    }
  }
  assert.ok(n >= 20, `对照了 ${n} 处`);
});

// ───────────── 片段播放器 ─────────────

function player(id, opts = {}) {
  const data = animData(id);
  const model = buildSkeleton(id);
  const root = new THREE.Group();
  root.add(model);
  root.updateMatrixWorld(true);
  const p = new anim.ClipPlayer(id, model, { root, data, ...opts });
  const events = [];
  p.onEvent = (e) => events.push(e.name);
  const run = (seconds, dt = 1 / 60) => { for (let i = 0, n = Math.round(seconds / dt); i < n; i++) p.update(dt); };
  return { data, model, root, p, events, run };
}

test('ClipPlayer：给了数据同步建好；Play / PlayTimed / PlayLocomotion 照 EnemyAI；没有的状态不播；事件转出来', () => {
  const k = player('SK_Enemy_Fuzhu');
  assert.ok(k.p.ready);
  assert.equal(k.p.state, 'Locomotion');
  k.p.playTimed('charge', k.p.clipLength('charge') / 2, 0.08);
  k.run(0.2);
  assert.equal(k.p.state, 'charge');
  assert.ok(Math.abs(k.p.anim.animator.getFloat('ActScale') - 2) < 1e-6, 'PlayTimed：ActScale = 片段长 / 秒数');
  k.p.play('recover', 0.06);
  k.run(0.1);
  assert.equal(k.p.state, 'recover');
  assert.equal(k.p.anim.animator.getFloat('ActScale'), 1, 'Play：ActScale 复位');
  k.p.play('没有这个状态');
  k.run(0.05);
  assert.equal(k.p.state, 'recover');
  k.p.playLocomotion();
  k.run(0.3);
  assert.equal(k.p.state, 'Locomotion');
  // 事件：蝎尾弩卫开火片段里有事件就转出来
  const t = player('SK_Enemy_Tuo');
  t.p.play('roar');
  t.run(1.5);
  assert.ok(t.events.length >= 2, `鼍吼叫的事件 ${t.events}`);
});

test('ClipPlayer：数据没到之前记下最后一次请求，建好后补播；冻住以后骨骼不再动；dispose 后不再 ready', () => {
  const data = animData('SK_Enemy_Fuzhu');
  const model = buildSkeleton('SK_Enemy_Fuzhu');
  const root = new THREE.Group();
  root.add(model);
  const p = new anim.ClipPlayer('SK_Enemy_Fuzhu', model, { root, data: null });
  assert.equal(p.ready, false);
  p.play('crouch');
  p.playTimed('charge', 1.2);
  p.update(1 / 60);
  assert.equal(p.state, null);
  // 数据到了（ClipPlayer 内部的 build；这里直接调私有方法模拟 fetch 回来）
  p.build(data);
  assert.ok(p.ready);
  for (let i = 0; i < 12; i++) p.update(1 / 60);
  assert.equal(p.state, 'charge');
  const head = model.getObjectByName('head');
  p.frozen = true;
  const q = head.quaternion.clone();
  for (let i = 0; i < 30; i++) p.update(1 / 60);
  assert.ok(head.quaternion.angleTo(q) < 1e-9, '冻住（死亡）后停在最后一帧');
  p.dispose();
  assert.equal(p.ready, false);
});

test('ClipPlayer 原地播放：片段带 rootY（采样时玩法抬起根节点，已烘进骨骼）时模型根 position.y 抵掉它；不开 inPlace 时保持原始数据', () => {
  const withRootY = Object.entries(M.assets).flatMap(([id]) => Object.entries(animData(id).clips).filter(([, c]) => c.rootY).map(([name]) => `${id}/${name}`));
  assert.ok(withRootY.includes('SK_Enemy_Fuzhu/leap'), `带 rootY 的片段：${withRootY}`);
  const peak = (inPlace) => {
    const k = player('SK_Enemy_Fuzhu', { inPlace, rig: false });
    k.p.play('leap', 0);
    let minY = 0, hipsMax = -Infinity;
    const hips = k.model.getObjectByName('hips');
    const v = new THREE.Vector3();
    for (let i = 0; i < 40; i++) {
      k.p.update(1 / 60);
      k.root.updateMatrixWorld(true);
      minY = Math.min(minY, k.model.position.y);
      hipsMax = Math.max(hipsMax, hips.getWorldPosition(v).y);
    }
    return { minY, hipsMax };
  };
  const raw = peak(false), flat = peak(true);
  assert.equal(raw.minY, 0, '原始数据不动模型根');
  assert.ok(flat.minY < -0.5, `原地播放把模型根往下抵（${flat.minY.toFixed(2)}）`);
  assert.ok(raw.hipsMax - flat.hipsMax > 0.5, `骨盆不再跟着烘进去的跳跃高度抬（${raw.hipsMax.toFixed(2)} → ${flat.hipsMax.toFixed(2)}）`);
});

test('受击：ClipPlayer.hit 推受击弹簧；stagger 触发叠加层 Flinch，不打断底层招式', () => {
  const k = player('SK_Enemy_Fuzhu');
  k.p.playTimed('charge', 2);
  k.run(0.3);
  k.p.hit(new THREE.Vector3(0, 0, 1), 1, true);
  k.run(0.1);
  assert.equal(k.p.state, 'charge', '底层还在蓄力');
  assert.equal(k.p.anim.animator.currentState(1)?.name, 'Flinch');
});

// ───────────── 第四章：片段与招式时间轴 ─────────────

await import('../src/world/plateau/play/foes.ts');
const { moveTable, moveEvents, movesOf } = await import('../src/world/plateau/play/moves.ts');

test('第四章七种有片段的敌人：每一招都有同名片段；手 K 片段长 = 招式总长，采样片段差不到 1.5 帧；片段按总长拉伸后每个时间点落在时间轴 ≤ 1 帧', () => {
  const T = moveTable();
  const assets = ['SK_Enemy_Aoyin', 'SK_Enemy_Dijiang', 'SK_Enemy_Jufu', 'SK_Enemy_Manman', 'SK_Enemy_Marmot', 'SK_Enemy_Qiongqi', 'SK_Enemy_Tiangou'];
  let moves = 0, cues = 0, handKeyed = 0;
  for (const asset of assets) {
    const data = animData(asset);
    const states = new Set(data.controller.layers[0].states.map((s) => s.name));
    for (const need of ['Locomotion', 'Hit', 'stun']) assert.ok(states.has(need), `${asset} 有 ${need} 状态`);
    for (const m of movesOf(asset)) {
      const clip = data.clips[m.id];
      assert.ok(clip && states.has(m.id), `${asset}/${m.id} 有片段`);
      const total = m.windup + m.active + m.recover;
      if (clip.src === 'blender') {
        assert.ok(Math.abs(clip.duration - total) < 1e-3, `${asset}/${m.id} 手 K 片段长 ${clip.duration} = 招式总长 ${total}`);
        handKeyed++;
      } else assert.ok(Math.abs(clip.duration - total) <= 1.5 * FRAME, `${asset}/${m.id} 采样片段长 ${clip.duration} ≈ ${total}`);
      // 片段事件（Unity events.json 由同一张招式表生成）：拉伸到招式总长后与时间轴的差
      for (const e of moveEvents(m)) {
        if (e.name === 'warn' || e.name === 'end') continue;
        const ev = clip.events.filter((x) => x.name === e.name);
        assert.ok(ev.length > 0, `${asset}/${m.id} 片段里有 ${e.name} 事件`);
        const best = Math.min(...ev.map((x) => Math.abs((x.t / clip.duration) * total - e.at)));
        assert.ok(best <= FRAME + 1e-6, `${asset}/${m.id} ${e.name} 差 ${(best * 1000).toFixed(1)} ms（> 1 帧）`);
        cues++;
      }
      moves++;
    }
    assert.ok(T[asset], `${asset} 在招式表里`);
  }
  assert.equal(moves, 19);
  assert.equal(handKeyed, 6, '獓狠踩踏 / 砸地、举父远投、蛮蛮横扫、穷奇滑翔、天狗扑咬是手 K');
  assert.ok(cues >= 20, `对照了 ${cues} 个时间点`);
});

test('第四章的 Foe 接了片段播放器：Begin 按招式总长拉伸、眩晕 stun、硬直 stagger、持续姿势 hop / flee 都是控制器里的状态', () => {
  const src = readFileSync(join(ROOT, 'src/world/plateau/play/foe.ts'), 'utf8');
  assert.match(src, /new ClipPlayer\(this\.body\.assetId, this\.body\.model/);
  assert.match(src, /c\.playTimed\(want, \(d\.windup \+ d\.active \+ d\.recover\) \/ Math\.max\(0\.01, mv\.speed\), 0\.1\)/);
  assert.match(src, /c\.playTimed\('stagger', Math\.max\(0\.3, this\.staggerT \+ 0\.3\), 0\.06\)/);
  const has = (id, s) => animData(id).controller.layers[0].states.some((x) => x.name === s);
  assert.ok(has('SK_Enemy_Manman', 'hop') && has('SK_Enemy_Qiongqi', 'flee'));
  for (const id of ['SK_Enemy_Aoyin', 'SK_Enemy_Jufu', 'SK_Enemy_Manman', 'SK_Enemy_Marmot', 'SK_Enemy_Qiongqi', 'SK_Enemy_Tiangou']) assert.ok(has(id, 'stagger'), `${id} stagger`);
});
