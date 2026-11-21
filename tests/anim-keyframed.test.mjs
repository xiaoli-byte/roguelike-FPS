// M12 第二期的对照（敌人改用片段、Blender 手 K 片段）：
//   · Unity 的 <资产>.events.json 叠加表与发布的 public/assets/anim/<资产>.json 逐条一致（片段、事件名、事件时刻 = 归一化时刻 × 片段长、连段、循环）；
//   · 各敌人类的片段表（clipCues：AI 状态 → 片段）引用的片段都在该资产的控制器里，Unity 对应 AI 播的状态一个不漏；
//   · 片段播放器（src/anim/ClipPlayer）：Play / PlayTimed / PlayLocomotion、受击、冻住、原地播放减掉烘进骨骼的根节点高度；
//   · 第四章手 K 片段与招式时间轴（前摇 / 出手 / 收招）对得上：片段长 = 招式总长、hit / release 事件落在释放帧 ≤ 1 帧；
//   · 鲲 / 鹏 / 火麒麟 / 旱魃 / 商人的手 K 片段齐全，首领招式等的事件都在片段里；
//   · 鲲鹏：照 Unity KunPengTests.KeyframedClips_EventsLandOnTheMoveTimeline_WithinOneFrame（潜袭 / 吐冰 / 羽刃雨 / 落台 / 起飞 / 倒下），
//     片段触发照 KunPeng/Moves 的 Act、释放帧顿帧照 ImpactHold（同秒数、×0.05 → ×1.6 追回）；火麒麟的 PlayAct 交叉淡入秒数逐个相同；
//   · 商人：强化台旁边的行商 Idle / Talk。
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

// ───────────── 首领：旱魃 / 鲲鹏 / 火麒麟 ─────────────

const { HANBA_CLIPS, clipSeconds, actAtSeconds, ANIM_LEAD } = await import('../src/enemies/bosses/HanbaPlans.ts');
const { HanbaAnimator } = await import('../src/enemies/bosses/HanbaModel.ts');

test('旱魃：播放器的片段表（帧数 / 事件）与导出的手 K 片段逐条一致；出手事件按 ActAt 拉伸后落在前摇结束前 1 帧以内', () => {
  const data = animData('SK_Boss_Hanba');
  let events = 0;
  for (const [name, c] of Object.entries(HANBA_CLIPS)) {
    const clip = data.clips[name];
    assert.ok(clip, `旱魃 ${name} 有片段`);
    assert.equal(clip.src ?? (name === 'Flinch' ? 'derived' : null), 'blender', `${name} 是手 K`);
    assert.ok(Math.abs(clip.duration - clipSeconds(name)) < 1e-3, `${name} 时长 ${clip.duration} = ${clipSeconds(name)}`);
    assert.equal(!!clip.loop, !!c.loop, `${name} 循环`);
    assert.equal(clip.events.length, c.events.length, `${name} 事件条数`);
    for (const [at, ev] of c.events) {
      assert.ok(clip.events.some((e) => e.name === ev && Math.abs(e.t - at * clip.duration) <= 2e-3), `${name} ${ev}@${at}`);
      events++;
    }
  }
  assert.equal(events, 40);
  // 出手事件：整段拉伸到「事件落在 hitAt − ANIM_LEAD」；与按时间兜底的出手差 ≤ 1 帧（30 fps）
  for (const [state, evt, hitAt] of [['sunSweep', 'beamStart', 1.2], ['droughtGale', 'hit', 1.0], ['summonWraiths', 'summon', 1.6], ['crackPalm', 'hit', 1.2], ['apsaraCall', 'summon', 1.8]]) {
    const frac = HANBA_CLIPS[state].events.find(([, n]) => n === evt)[0];
    const seconds = actAtSeconds(frac, hitAt);
    const fired = frac * seconds;
    assert.ok(hitAt - fired >= 0 && hitAt - fired <= FRAME + 1e-6, `${state}.${evt} 提前 ${((hitAt - fired) * 1000).toFixed(1)} ms`);
    assert.ok(Math.abs(hitAt - fired - ANIM_LEAD) < 1e-6);
  }
});

test('旱魃：HanbaAnimator.bindClips 之后骨骼由手 K 片段驱动——取样时刻 = 播放器的归一化时刻，顿帧倍率照旧，另抬模型的 lift 归零', () => {
  const data = animData('SK_Boss_Hanba');
  const model = buildSkeleton('SK_Boss_Hanba');
  const stub = () => ({ rotation: { x: 0, set() {} } });
  const fired = [];
  const a = new HanbaAnimator({ armR: stub(), armL: stub(), torso: stub() }, (e) => fired.push(e));
  assert.equal(a.clipDriven, false);
  a.bindClips(model, data);
  assert.ok(a.clipDriven);
  const arm = model.getObjectByName('arm_R');
  const rest = arm.quaternion.clone();
  a.play('crackPalm', clipSeconds('crackPalm'));
  for (let i = 0; i < 74; i++) a.update(1 / 60);
  // 刚过 1.2 s（第 36 帧）：出手（hit@0.24 × 5 s）
  assert.ok(fired.includes('hit'), `事件 ${fired}`);
  assert.ok(Math.abs(a.u - 74 / 60 / 5) < 1e-6);
  assert.ok(arm.quaternion.angleTo(rest) > 0.2, '右臂离开了绑定姿势');
  assert.equal(a.lift, 0);
  // 与直接在 1.2 s 取样的片段姿势相同（交叉淡入 0.2 s 已经走完）
  const want = buildSkeleton('SK_Boss_Hanba');
  const clip = anim.buildClip(data, 'crackPalm');
  const mixer = new THREE.AnimationMixer(want);
  const act = mixer.clipAction(clip);
  act.play();
  act.time = a.u * 5;
  act.timeScale = 0;
  mixer.update(0);
  assert.ok(arm.quaternion.angleTo(want.getObjectByName('arm_R').quaternion) < 1e-3);
  // 顿帧：speed 0.05 时片段几乎不走
  const u0 = a.u;
  a.speed = 0.05;
  for (let i = 0; i < 6; i++) a.update(1 / 60);
  assert.ok(a.u - u0 < 0.001 + 1e-9);
  a.dispose();
  assert.equal(a.clipDriven, false);
});

test('鲲 / 鹏 / 火麒麟：招式播的动作名都有片段，招式等的出手事件（cue）都在对应片段里；鲲的片段把身体抬到水线（根骨骼 +10）', () => {
  const read = (f) => readFileSync(join(ROOT, 'src/enemies/bosses', f), 'utf8');
  const acts = (src) => new Set([...src.matchAll(/\bact\('(\w+)'/g)].map((m) => m[1]).filter((s) => s !== 'idle' && s !== 'Idle' && s !== 'Locomotion'));
  const kp = read('KunPengMoves.ts');
  const kun = animData('SK_Boss_Kun'), peng = animData('SK_Boss_Peng');
  for (const s of acts(kp)) assert.ok(kun.clips[s] || peng.clips[s], `鲲鹏招式播 ${s}`);
  const ev = (d, clip) => d.clips[clip].events.map((e) => e.name);
  assert.ok(ev(kun, 'slam').includes('wave2') && ev(kun, 'sink').includes('plunge') && ev(kun, 'sink').includes('breach'));
  assert.ok(ev(peng, 'spread').includes('flap') && ev(peng, 'perch').includes('flap') && ev(peng, 'perch').includes('hit'));
  // spread 的猛扇：片段 0.9 s、事件 0.43 s = 招式按时间兜底的 0.43 s
  assert.ok(Math.abs(peng.clips.spread.events.find((e) => e.name === 'flap').t - 0.43) <= FRAME);
  for (const id of ['SK_Boss_Qilin', 'SK_Boss_QilinBurn']) {
    const q = animData(id);
    for (const s of acts(read('QilinMoves.ts'))) assert.ok(q.clips[s] || (id === 'SK_Boss_QilinBurn' && s === 'drink'), `${id} 招式播 ${s}`);
    // 前摇等 hit 的两招（鳞刃、狂怒长啸）：人立片段的 hit 在片段末尾（拉伸到前摇时长后提前不到 1 帧 / 秒）
    const rear = q.clips.rear.events.find((e) => e.name === 'hit');
    assert.ok(rear && q.clips.rear.duration - rear.t <= FRAME + 1e-6);
  }
  // 鲲：片段以完全沉下去为参照，根骨骼抬 10 个模型单位（× 形态缩放 = KunBaseY − KunSunkY）
  const model = buildSkeleton('SK_Boss_Kun');
  const clip = anim.buildClip(kun, 'Idle');
  const track = clip.tracks.find((t) => t.name === 'root.position');
  assert.ok(Math.abs(track.values[1] - 10) < 0.01);
  assert.ok(model.getObjectByName('root'));
  // 模型层接了片段播放器
  for (const f of ['KunPeng.ts', 'Qilin.ts']) {
    const src = read(f);
    assert.match(src, /new ClipPlayer\(art\.native\.assetId, art\.native\.model, \{ root: this\.root, rig: false, inPlace: false \}\)/);
    assert.match(src, /!\/\^\(sfx\|fx\):\/\.test\(e\.name\)\) this\.emitAnimEvent\(e\.name\)/);
  }
});

// ───────────── 鲲鹏：片段时间轴 / 片段触发 / 顿帧（照 Unity KunPengTests 与 KunPeng/Moves） ─────────────

const KPP = await import('../src/enemies/bosses/KunPengPlans.ts');
const { KunPengDef: KPDef } = await import('../src/enemies/bosses/KunPengDef.ts');
const { KunPeng } = await import('../src/enemies/bosses/KunPeng.ts');
const KP_UNITY = join(ROOT, 'unity/Assets/Game/Scripts/Bosses/KunPeng');
const QL_UNITY = join(ROOT, 'unity/Assets/Game/Scripts/Bosses/Qilin');
const bossSrc = (f) => readFileSync(join(ROOT, 'src/enemies/bosses', f), 'utf8');
/** 片段里事件的归一化时刻（Unity events.json 的 at） */
const evAt = (d, clip, name) => {
  const c = d.clips[clip];
  const e = c?.events.find((x) => x.name === name);
  assert.ok(e, `${clip} 里没有 ${name} 事件`);
  return e.t / c.duration;
};

test('鲲鹏：手 K 片段的事件落在招式时间轴上 ≤ 1 帧（照 Unity KunPengTests.KeyframedClips_EventsLandOnTheMoveTimeline_WithinOneFrame）', () => {
  const kun = animData('SK_Boss_Kun'), peng = animData('SK_Boss_Peng');
  const near = (actual, want, what) => assert.ok(Math.abs(actual - want) <= FRAME + 1e-3, `${what}：${actual.toFixed(4)} ≠ ${want}`);
  // 潜袭：sink = 整段前摇，erupt 接在后面（出手 + 收招），第 1 帧咬合
  const dive = KPP.KunDive.spec;
  assert.equal(kun.clips.sink.next, 'erupt', 'sink 接 erupt');
  near(evAt(kun, 'sink', 'plunge') * dive.windup, KPP.KunDive.PlungeAt, '下潜水花');
  near(evAt(kun, 'sink', 'breach') * dive.windup, KPP.KunDive.BreachAt, '破水');
  near(dive.windup + evAt(kun, 'erupt', 'hit') * (dive.active + dive.recover), dive.windup, '扑咬 = 前摇结束');
  // 吐冰：一段 1.3 s，projectile = 前摇结束
  const spit = KPP.KunSpit.spec;
  near(evAt(kun, 'spit', 'projectile') * (spit.windup + spit.active + spit.recover), spit.windup, '吐冰出手');
  // 羽刃雨：spread（前摇）→ spreadShed 循环，每 4 枚一圈，狂怒 14 枚累计不差 1 帧
  assert.equal(peng.clips.spread.next, 'spreadShed');
  const shed = peng.clips.spreadShed;
  assert.ok(shed.loop, '振翅洒羽是循环态');
  const shots = shed.events.filter((e) => e.name === 'projectile').map((e) => e.t / shed.duration);
  assert.equal(shots.length, 4, '一圈 4 枚');
  shots.forEach((at, i) => assert.ok(Math.abs(at - i * 0.25) <= 1e-3, `第 ${i} 枚 ${at}`));
  const shedLoop = 13 / 30;
  assert.ok(Math.abs(KPP.PengFeatherRain.RageFeathers * KPP.PengFeatherRain.Interval - KPP.PengFeatherRain.RageFeathers / 4 * shedLoop) <= FRAME,
    '循环一圈 = 4 × 0.11 s，狂怒最后一枚的累计偏差 < 1 帧');
  // 落台：perch 从下降开始播，触地 = 下降结束；之后循环栖落；起飞片段在起飞预警时播，离台 = 收招段开始
  assert.equal(peng.clips.perch.next, 'perchRest');
  near(evAt(peng, 'perch', 'hit') * KPP.PengPerch.PerchClip, KPP.PengPerch.DescendSeconds, '落台触地');
  assert.ok(peng.clips.perchRest.loop, '栖落是循环态');
  near(evAt(peng, 'takeoff', 'liftoff') * KPP.PengPerch.TakeoffClip, KPP.PengPerch.RestSeconds - KPP.PengPerch.TakeoffWarnAt, '起飞离台');
  // 倒下：翼折 / 触地 / 最后一声和 KunPengDeath 的时间轴一致，之后循环趴着
  const D = KPP.KunPengDeath;
  assert.equal(peng.clips.death.next, 'deathRest');
  assert.ok(Math.abs(peng.clips.death.duration - D.ClipSeconds) < 1e-3, 'death 片段 120 帧');
  near(evAt(peng, 'death', 'wingBreak') * D.ClipSeconds, D.BreakTime, '翼折');
  near(evAt(peng, 'death', 'land') * D.ClipSeconds, D.LandTime, '触地');
  near(evAt(peng, 'death', 'lastCry') * D.ClipSeconds, D.CryTime, '最后一声');
  assert.ok(D.LandTime < new KPDef().defeat.seconds * 0.88, '溃散隐去之前已经落地');
  assert.ok(peng.clips.deathRest.loop, '倒下之后循环趴着');
  // 化鹏长啸：鹏 roar 片段第 50 帧的 spread（展翅爆发）——片段从换形 1.55 s 起按剩余时长拉伸，落在 3.67 s，比转换演出 3.6 s 的兜底晚 2 帧，
  // 所以展翅其实总是兜底先到（Unity 同样：KunPengBrain.TransitionTick 的 Crossed(3.6f)），事件只在兜底没走到时起作用
  const tr = new KPDef().phases[0];
  const left = Math.max(0.5, tr.seconds - KPDef.TransitionSwap);
  const spreadAt = KPDef.TransitionSwap + evAt(peng, 'roar', 'spread') * left;
  assert.ok(spreadAt > 3.6 && spreadAt - 3.6 <= 3 * FRAME, `展翅 ${spreadAt.toFixed(3)} s`);
});

/** 招式文件里 act(...) / Act(...) / PlayAct(...) 的调用：状态名 + 其余实参（按顶层逗号拆） */
function actCalls(src, re) {
  const out = [];
  for (const m of src.matchAll(re)) {
    const args = [];
    let depth = 0, cur = '';
    for (const ch of m[2]) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        if (cur.trim()) args.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) args.push(cur.trim());
    out.push({ state: m[1], args });
  }
  return out;
}

test('鲲鹏：招式播哪些片段照 Unity KunPengMove.Act（控制器自己连段的扑咬 / 猛砸 / 破水和中途回待机只换程序化姿势）', { skip: !existsSync(KP_UNITY) && '没有 unity/ 目录' }, () => {
  const unity = readdirSync(join(KP_UNITY, 'Moves')).filter((f) => f.endsWith('.cs') && f !== 'KunPengMove.cs')
    .flatMap((f) => actCalls(readFileSync(join(KP_UNITY, 'Moves', f), 'utf8'), /\bAct\("(\w+)"([^;]*)\);/g).map((c) => c.state));
  const web = bossSrc('KunPengMoves.ts');
  const acts = actCalls(web, /this\.act\('(\w+)'([^;]*)\);/g);
  const clipStates = [...acts.filter((c) => c.args[1] !== 'false').map((c) => c.state), ...actCalls(web, /this\.clipAct\('(\w+)'([^;]*)\);/g).map((c) => c.state)];
  assert.deepEqual([...clipStates].sort(), [...unity].sort(), '片段触发（每处一次）');
  assert.deepEqual(acts.filter((c) => c.args[1] === 'false').map((c) => c.state).sort(), ['bite', 'erupt', 'idle', 'idle', 'idle', 'perch', 'slam']);
  // 连段：被跳过的那几个状态确实由控制器自己接上
  const kun = animData('SK_Boss_Kun'), peng = animData('SK_Boss_Peng');
  assert.equal(kun.clips.inhale.next, 'bite');
  assert.equal(kun.clips.slamWind.next, 'slam');
  assert.equal(kun.clips.sink.next, 'erupt');
  for (const s of clipStates) assert.ok(kun.clips[s] || peng.clips[s], `${s} 有片段`);
});

test('鲲鹏：释放帧顿帧与 Unity 同帧同秒数；顿帧把片段压到 ×0.05（≤ 0.12 s）、之后 ×1.6 追回，欠下的时间还清；没有片段时不顿', { skip: !existsSync(KP_UNITY) && '没有 unity/ 目录' }, () => {
  const holds = (src, re) => [...src.matchAll(re)].map((m) => Number(m[1]));
  const unity = [...readdirSync(join(KP_UNITY, 'Moves')).filter((f) => f.endsWith('.cs')).map((f) => join(KP_UNITY, 'Moves', f)), join(KP_UNITY, 'KunPengBrain.cs')]
    .flatMap((p) => holds(readFileSync(p, 'utf8'), /ImpactHold\((\d*\.\d+)f\)/g)).sort();
  const web = [...holds(bossSrc('KunPengMoves.ts'), /impactHold\((\d*\.\d+)\)/g), ...holds(bossSrc('KunPeng.ts'), /this\.impactHold\((\d*\.\d+)\)/g)].sort();
  assert.deepEqual(web, unity);
  assert.equal(web.length, 8);
  // 时间倍率：拿 KunPeng 原型上的 impactHold / holdDt 跑（片段 ready、活着）
  const kp = Object.create(KunPeng.prototype);
  Object.defineProperty(kp, 'formClips', { get: () => ({ ready: true }) });
  Object.assign(kp, { alive: true, holdLeft: 0, holdDebt: 0, impactHolds: 0 });
  const dt = 1 / 60;
  kp.impactHold(0.08);
  kp.impactHold(0.5);
  assert.equal(kp.impactHolds, 2);
  let animT = 0, real = 0, slow = 0;
  for (let i = 0; i < 120; i++) {
    const a = kp.holdDt(dt);
    if (a < dt * 0.5) slow++;
    animT += a;
    real += dt;
  }
  assert.equal(slow, Math.ceil(0.12 / dt - 1e-9), '上限 0.12 s');
  assert.ok(Math.abs(animT - real) < dt, `追回后片段时间 = 真实时间（差 ${(real - animT).toFixed(4)} s）`);
  // 程序化摆姿势（没有片段）时不顿
  const proc = Object.create(KunPeng.prototype);
  Object.defineProperty(proc, 'formClips', { get: () => null });
  Object.assign(proc, { alive: true, holdLeft: 0, holdDebt: 0, impactHolds: 0 });
  proc.impactHold(0.08);
  assert.equal(proc.impactHolds, 0);
  assert.equal(proc.holdDt(dt), dt);
});

test('鲲鹏 / 火麒麟：收招、转换结束回步态（Unity FinishMove / EndTransition 的 PlayLocomotion）；鹏倒下播手 K death，火麒麟倒下片段 97% 冻住', () => {
  const kp = bossSrc('KunPeng.ts'), ql = bossSrc('Qilin.ts');
  assert.match(kp, /onMoveEnded\(_m: BossMove\): void \{\s*if \(this\.alive\) this\.formClips\?\.playLocomotion\(\);/);
  assert.match(kp, /onTransitionEnd\(_phase: BossPhaseDef\): void \{[\s\S]{0,120}this\.formClips\?\.playLocomotion\(\);/);
  assert.match(kp, /evt === 'spread' && this\.transitioning && this\.isPeng\) this\.spreadBurst\(\)/);
  assert.match(kp, /this\.deathKeyframed = !this\.deathKun && !!c\?\.ready && c\.has\('death'\);\s*if \(this\.deathKeyframed\) c!\.play\('death', 0\.08\);/);
  for (const ev of ['wingBreak', 'flail', 'land', 'lastCry']) assert.match(kp, new RegExp(`case '${ev}':`));
  assert.match(ql, /onMoveEnded\(_m: BossMove\): void \{\s*if \(this\.alive\) this\.clipLoco = true;/);
  assert.match(ql, /fc\.frozen = t >= 0\.97;/);
});

test('火麒麟：招式的片段与交叉淡入秒数照 Unity Brain.PlayAct（缺省 0.1，鳞刃 0.08 / 0.03、扑踏 0.04 / 0.08、扑掌 0.08、奔驰回步态 0.05）', { skip: !existsSync(QL_UNITY) && '没有 unity/ 目录' }, () => {
  const fadeOf = (args) => (args.length >= 2 ? Number(args[1].replace(/f$/, '')) : 0.1);
  const unity = readdirSync(join(QL_UNITY, 'Moves')).filter((f) => f.endsWith('.cs'))
    .flatMap((f) => actCalls(readFileSync(join(QL_UNITY, 'Moves', f), 'utf8'), /Brain\.PlayAct\("(\w+)"([^;]*)\);/g))
    .map((c) => `${c.state}@${fadeOf(c.args)}`).sort();
  const web = actCalls(bossSrc('QilinMoves.ts'), /this\.act\('(\w+)'([^;]*)\);/g).map((c) => `${c.state}@${fadeOf(c.args)}`).sort();
  assert.deepEqual(web, unity);
  const xuan = animData('SK_Boss_Qilin'), burn = animData('SK_Boss_QilinBurn');
  for (const s of new Set(web.map((x) => x.split('@')[0]))) assert.ok(s === 'Locomotion' || xuan.clips[s] || burn.clips[s], `${s} 有片段`);
});

const { Qilin } = await import('../src/enemies/bosses/Qilin.ts');
const { QilinDef: QLDef } = await import('../src/enemies/bosses/QilinDef.ts');

/** 火麒麟原型 + 记录调用的片段播放器桩：act / setAnim / onPresent / introTick 都走真代码，每帧 syncClip 一次 */
function qilinClipRig() {
  const calls = [];
  const c = {
    state: 'Locomotion', ready: true, has: () => true,
    play(s, fade) { calls.push(`play ${s} ${fade}`); this.state = s; },
    playTimed(s, sec, fade) { calls.push(`timed ${s} ${+sec.toFixed(3)} ${fade}`); this.state = s; },
    playLocomotion() { calls.push('loco 0.15'); this.state = 'Locomotion'; },
  };
  const form = { clipAnim: '' };
  const q = Object.create(Qilin.prototype);
  Object.assign(q, {
    anim: 'idle', animT: 0, animLeft: Infinity, clipSeconds: 0, clipFade: 0.1, clipLoco: false, clipActed: false, lastAct: null,
    alive: true, xuan: form, burn: null, bdef: new QLDef(), introRoared: false, fx: null,
    furnace: { center: new THREE.Vector3(0, 0, 0), floorY: 0 }, position: new THREE.Vector3(0, 0, -9), modelOffset: new THREE.Vector3(),
    ctx: { fx: { ring() {}, burst() {} } }, playSfx() {}, quake() {},
  });
  return { q, calls, sync: () => q.syncClip(form, c) };
}

test('火麒麟登场：现身播一次 tuck（拉伸到 3.2 s），跃出段不再逐帧重播，落地只播一次 rear（照 Unity BossBrain.Spawn 的 PlayAct(intro) 与 QilinBrain.IntroTick）', { skip: !existsSync(QL_UNITY) && '没有 unity/ 目录' }, () => {
  const brain = readFileSync(join(QL_UNITY, 'QilinBrain.cs'), 'utf8');
  const body = brain.slice(brain.indexOf('protected override void IntroTick'), brain.indexOf('protected override void OnIntroEnd'));
  const unityIntro = actCalls(body, /PlayAct\("(\w+)"([^;]*)\);/g).map((c) => `${c.state}@${Number(c.args[0].replace(/f$/, ''))}`);
  assert.deepEqual(unityIntro, ['rear@1.2'], 'Unity 登场里只有落地那一下');
  const { q, calls, sync } = qilinClipRig();
  const def = q.bdef;
  assert.equal(def.intro.anim, 'tuck');
  q.onPresent();
  sync();
  const dt = 1 / 60;
  for (let age = 0; age <= def.intro.seconds; age += dt) {
    q.introTick(Math.min(1, age / def.intro.seconds), 0);
    sync();
  }
  assert.deepEqual(calls, [`timed tuck ${def.intro.seconds} 0.1`, 'timed rear 1.2 0.1'], `片段调用：${calls.slice(0, 6).join(' / ')}${calls.length > 6 ? ` …共 ${calls.length} 次` : ''}`);
  assert.equal(q.anim, 'rear');
});

// ───────────── 商人 ─────────────

const { MerchantNpcs } = await import('../src/progression/loot/Merchant.ts');
// Node 里 src/assets/AssetLibrary 换成 scripts/unity/stubs 的桩（ts-hooks）：测试改桩的 get / findBound，当作行商资产已加载
const { AssetLibrary } = await import('../scripts/unity/stubs/AssetLibrary.mjs');

/** 无网格骨架 + 一块三角形的蒙皮网格（attachNativeBody 要 _LOD0 网格），当作已加载的行商资产 */
function fakeMerchantAsset() {
  const scene = buildSkeleton('SK_Npc_Merchant');
  const bones = [];
  scene.traverse((o) => { if (o.isBone) bones.push(o); });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.name = 'SK_Npc_Merchant_LOD0';
  scene.add(mesh);
  mesh.bind(new THREE.Skeleton(bones));
  return {
    id: 'SK_Npc_Merchant', gltf: { scene }, lods: [mesh],
    entry: { skeleton: { mode: 'native' }, bind: { source: 'npc', id: 'merchant' }, lodDistance: [0], bounds: { min: [-0.5, 0, -0.4], max: [0.5, 1.5, 0.4] } },
  };
}

test('商人：强化台旁边摆狸猫行商（Idle / Talk 两段手 K 循环）——玩家走近或刚成交就 Talk，走开、成交过去 3 s 后交叉淡回 Idle；站位是墙就不摆', async () => {
  const data = animData('SK_Npc_Merchant');
  assert.ok(data.clips.Idle.loop && data.clips.Talk.loop, 'Idle / Talk 都是循环');
  assert.deepEqual(data.controller.layers[0].states.map((s) => s.name).sort(), ['Locomotion', 'Talk']);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const p = join(ROOT, 'public', String(url).replace(/^\/+/, ''));
    return existsSync(p) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(p, 'utf8')) } : { ok: false, status: 404, json: async () => null };
  };
  const { get, findBound } = AssetLibrary;
  let asset = fakeMerchantAsset();
  AssetLibrary.get = (id) => (id === 'SK_Npc_Merchant' ? asset : null);
  AssetLibrary.findBound = () => null;
  try {
    const handlers = {};
    let wall = null;
    const ctx = {
      world: { raycast: () => wall, groundHeight: () => 0 }, stage: { arena: { floorY: 0 } },
      events: { on: (name, h) => { handlers[name] = h; } },
      player: { alive: true, position: new THREE.Vector3(0, 0, 0), eye: new THREE.Vector3(0, 1.6, 0) }, time: { now: 0 },
    };
    const group = new THREE.Group();
    const m = new MerchantNpcs(ctx, group);
    const dispose = m.spawn(new THREE.Vector3(0, 0, -6.4), new THREE.Vector3(0, 0, 0));
    assert.equal(group.children.length, 1, '摆上了');
    const host = group.children[0];
    // 摊位弧（6.4 m）往外 0.8 m、从强化台往一侧挪 12.5°（半个摊位间隔），面朝商铺中心
    const side = 12.5 * Math.PI / 180;
    assert.ok(host.position.distanceTo(new THREE.Vector3(-Math.sin(side) * 7.2, 0, -Math.cos(side) * 7.2)) < 1e-6, `站位 ${host.position.toArray()}`);
    assert.ok(Math.abs(host.rotation.y - side) < 1e-6, '面朝商铺中心');
    const k = m.keepers[0];
    for (let i = 0; i < 100 && !k.clips.ready; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(k.clips.ready, '片段读好了');
    const step = (s) => { for (let t = 0; t < s; t += 0.05) { ctx.time.now += 0.05; m.update(0.05); } };
    step(0.5);
    assert.equal(k.clips.state, 'Locomotion', '玩家在 7.2 m 外：待机');
    ctx.player.position.set(0, 0, -3);
    step(0.5);
    assert.equal(k.clips.state, 'Talk', '走近：开口');
    ctx.player.position.set(0, 0, 12);
    step(0.5);
    assert.equal(k.clips.state, 'Locomotion', '走开：回待机');
    // 在最右边的摊位前买东西（离行商 8.2 m，不算走近）
    ctx.player.position.set(4.6, 0, -1.2);
    step(0.2);
    assert.equal(k.clips.state, 'Locomotion');
    handlers['coins:changed']({ coins: 10, delta: -40 });
    step(0.2);
    assert.equal(k.clips.state, 'Talk', '刚成交：开口');
    step(3);
    assert.equal(k.clips.state, 'Locomotion', '成交 3 s 后回待机');
    handlers['coins:changed']({ coins: 50, delta: 40 });
    step(0.2);
    assert.equal(k.clips.state, 'Locomotion', '进账不算成交');
    dispose();
    assert.equal(group.children.length, 0, '撤掉了');
    assert.equal(m.keepers.length, 0);
    // 台子后面是墙：不摆
    wall = { distance: 0.6, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, 1) };
    m.spawn(new THREE.Vector3(0, 0, -6.4), new THREE.Vector3(0, 0, 0));
    assert.equal(group.children.length, 0);
    // 资产没加载：不摆、不出替身
    wall = null;
    asset = null;
    m.spawn(new THREE.Vector3(0, 0, -6.4), new THREE.Vector3(0, 0, 0));
    assert.equal(group.children.length, 0);
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(AssetLibrary, { get, findBound });
  }
});
