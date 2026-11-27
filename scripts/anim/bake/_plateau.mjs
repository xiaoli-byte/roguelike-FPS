// 第四章（src/world/plateau/play）程序化姿势的离线采样器——雷魅（E 路）和 4-1 / 4-2 / 4-4 领主（B 路）共用。
//
// 第四章的生物不走 src/enemies 的注册表，没有可跑的敌人 AI：动作全在 anim.ts 的 CreatureAnimator（步态 + 受击 / 硬直 / 眩晕层）
// 和 poses.ts 的招式姿势表里，输入只是一份 AnimState（move / phase / flap / … / pose / stage / k）加连续时间 t。
// 所以这里不跑 AI，直接按招式时间轴推 AnimState，逐帧采 NativePose 的骨骼（与 bake-native-anims.mjs 同一个参照系、同一种
// native-anim.json 格式），Unity 的 Spiritfire ▸ Art ▸ Sync 照常换算成片段和 AC_ 状态机。
//
// 由 bake-native-anims.mjs 调用：采样配置 bake/<资产 ID>.mjs 里有 `plateau` 字段就走这里（不再要求 src/enemies 里注册过）。
//
// ── 配置 plateau: { … } ──
//   gait        anim.ts 的步态：'quad' | 'upright' | 'biped' | 'bird' | 'hexa' | 'serpent' | 'kui' | 'raptor' | 'titan'
//   model       姿势表的键（poses.ts 的 POSES；默认 = 资产 ID）
//   moves       招式表来源：默认取 docs/art/ch4-move-events.json 里这个资产的 moves（windup / active / recover 秒）；
//               也可以给对象 { <招式 id>: { windup, active, recover } } 覆盖或补充（演出姿势、表里没有的持续姿势）
//   only        只录这些招式（默认：表里全部）
//   skip        { <招式 id>: 原因 }：不录（写进 notes）
//   state       { <招式 id>: { all?, windup?, active?, recover? } }：按段覆盖 AnimState 的其它字段（move、flap、crouch、side、jaw…）；
//               特殊键 phaseRate（弧度 / 秒）：这一段里步态相位按它推进（冲撞、扑击在出手段要跑步态：move = 1、phaseRate = 速度 / 步幅 × π）
//   seconds     { <招式 id>: 秒 }：这一段录多久（默认 = 前摇 + 出手 + 收招；比它长的部分停在收招末）
//   lead        { <招式 id>: [前一招 id, 秒] }：连段后半先把前一招放够这么多秒（不录），姿势从它接过来
//   alias       { <片段名>: <招式 id> }：同一个姿势录成另一个片段名（獓狠四角挑左右各一段：goreL 用 gore 的姿势、side = −1）；
//               时长取招式 id 的，招式表里没有这个片段名也行
//   idle        { state?, seconds?: [最短, 最长] }：待机循环（默认 [1.6, 4]；state 覆盖 AnimState，如蛮蛮悬停 flap = 1）
//   gaits       { Walk: { speed, move, state? }, Move: { … } }：步态循环（speed 米 / 秒写进片段供混合树做阈值；
//               相位按 speed / stride × π 推进），[] 或 null = 不录（夔不走路）。默认 Walk = 半速 move 0.5、Move = 全速 move 1
//   speed, stride  默认步态用的全速（米 / 秒）和步幅（米，同 foes.ts FoeSpec.stride）
//   loops       { <状态名>: { pose?, stage?, k?, state?, seconds?: [最短, 最长] } }：持续循环（眩晕、潜游、盘旋、落地追啄…）；
//               写进片段的 loop = true（Unity 状态机里不自动退出，玩法 CrossFade 出去）。不给 pose 时只是 AnimState 的循环
//   hit         录 Hit（hurt 冲一下，0.55 s；默认 true）
//   stun        录 stun 循环（anim.stun → 1，默认 true）；stagger：录 stagger（硬直踉跄，按 staggerTime 秒，默认 0.6；false = 不录）
//
// 根节点位移不录（位置、朝向、离地高度全由玩法驱动；rootY 一律 0）；hips 的局部平移（蹲、跪、人立抬升）照常在骨骼姿势里。
// 采样器不产出动画事件：出手时刻写在 Anim/<资产>.events.json（照 ch4-move-events.json 的 clips 抄）。
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const ROOT = new URL('../../../', import.meta.url);

let EVENTS = null;
/** docs/art/ch4-move-events.json 里某资产的招式秒数 */
export function movesFromTable(asset) {
  EVENTS ??= JSON.parse(readFileSync(new URL('docs/art/ch4-move-events.json', ROOT), 'utf8'));
  return EVENTS.assets?.[asset]?.moves ?? {};
}

/**
 * 采一个资产。H = bake-native-anims.mjs 交过来的工具（同一套参照系、找循环点、切片段）：
 *   { FPS, SIM_DT, SAMPLE_EVERY, sample(host, bones), findLoop(frames, from, minS, maxS), clipFrom(frames, a, b, loop), buildSkeleton(entry) }
 * 返回与 bakeEnemy 同形的结果 { bones, sockets, socketScale, rest, clips, notes }
 */
export async function bakePlateau(assetId, entry, cfg, H) {
  const { CreatureAnimator, newAnimState } = await import('../../../src/world/plateau/play/anim.ts');
  const { NativePose } = await import('../../../src/assets/NativeRig.ts');
  const P = cfg.plateau;
  const notes = [];

  // 骨架：按发布 GLB 的节点 TRS 搭，挂在一个原点的 host 下（采样参照系 = host 的静止矩阵，见 bake-native-anims frameOf）
  const host = new THREE.Group();
  host.name = assetId;
  const model = H.buildSkeleton(entry);
  host.add(model);
  host.updateWorldMatrix(true, true);
  host.updateMatrix();
  host.userData.__restLocal = host.matrix.clone();
  const pose = new NativePose(model, host);
  const bones = [];
  model.traverse((o) => { if (o.isBone) bones.push(o); });
  const rest = H.sample(host, bones);
  const animator = new CreatureAnimator(pose, P.gait ?? 'quad', P.model ?? assetId);

  // 时钟：连续时间 t（捶胸、游动波按 t 的正弦走），每 SAMPLE_EVERY 帧采一次
  let t = 0;
  let s = newAnimState();
  const fresh = () => { s = newAnimState(); return s; };
  const phaseRate = { v: 0 };
  /** 推进 seconds 秒；setup(k, dt) 每帧先改 AnimState；record = false 时只推不录 */
  const run = (seconds, setup, record = true) => {
    const out = [];
    const n = Math.round(seconds / H.SIM_DT);
    for (let i = 0; i < n; i++) {
      setup?.(i * H.SIM_DT, H.SIM_DT);
      s.phase += phaseRate.v * H.SIM_DT;
      t += H.SIM_DT;
      animator.apply(s, t);
      if (record && i % H.SAMPLE_EVERY === 0) {
        host.updateWorldMatrix(true, true);
        out.push({ state: s.pose || 'Idle', speed: 0, rootY: 0, pose: H.sample(host, bones), events: [] });
      }
    }
    return out;
  };
  const apply = (o) => {
    phaseRate.v = 0;
    if (!o) return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'phaseRate') phaseRate.v = v;
      else if (k in s) s[k] = v;
    }
  };
  /** 回到待机：清掉招式槽（权重淡出），站够 0.6 s */
  const settle = (idleState) => {
    fresh();
    apply(idleState);
    run(0.6, null, false);
  };

  const clips = {};
  const idleState = P.idle?.state ?? null;

  // 1) 待机循环
  {
    fresh();
    apply(idleState);
    run(1.0, null, false);
    const [lo, hi] = P.idle?.seconds ?? [1.6, 4];
    const frames = run(hi + 2.5);
    const loop = H.findLoop(frames, 0, lo, hi);
    if (loop) clips.Idle = H.clipFrom(frames, loop.a, loop.b, true);
    else notes.push('待机找不到循环点');
  }

  // 2) 步态循环
  const stride = P.stride ?? 1;
  const full = P.speed ?? 3;
  const gaits = P.gaits === undefined
    ? { Walk: { speed: full * 0.5, move: 0.5 }, Move: { speed: full, move: 1 } }
    : (P.gaits ?? {});
  for (const [name, g] of Object.entries(gaits)) {
    settle(idleState);
    apply({ ...(idleState ?? {}), ...(g.state ?? {}), move: g.move ?? 1 });
    phaseRate.v = (g.speed / stride) * Math.PI;
    run(1.2, null, false);
    const frames = run(6);
    const loop = H.findLoop(frames, 0, 0.4, 3);
    phaseRate.v = 0;
    if (!loop) { notes.push(`${name} 找不到循环点`); continue; }
    const clip = H.clipFrom(frames, loop.a, loop.b, true);
    clip.speed = Math.round(g.speed * 100) / 100;
    clip.sourceState = 'plateau';
    clips[name] = clip;
  }

  // 3) 招式：前摇 → 出手 → 收招一段录完，状态名 = 招式 id
  const table = { ...movesFromTable(assetId), ...(typeof P.moves === 'object' ? P.moves : {}) };
  const poseOf = (id) => P.alias?.[id] ?? id;
  const ids = [...(P.only ?? Object.keys(table)), ...Object.keys(P.alias ?? {})].filter((id, i, all) => {
    if (all.indexOf(id) !== i) return false;
    if (P.skip?.[id]) { notes.push(`不录 ${id}：${P.skip[id]}`); return false; }
    if (!table[id] && !table[poseOf(id)]) { notes.push(`招式表里没有 ${id}`); return false; }
    return true;
  });
  /** 把招式 m 推 seconds 秒（stage / k 按时间轴；段覆盖按 state 配置） */
  const playMove = (id, m, seconds, record) => {
    const W = m.windup ?? 0, A = m.active ?? 0, R = m.recover ?? 0;
    const st = P.state?.[id] ?? {};
    let lastStage = '';
    return run(seconds, (tt) => {
      const stage = tt < W ? 'windup' : tt < W + A ? 'active' : 'recover';
      const len = stage === 'windup' ? W : stage === 'active' ? A : R;
      const k = len > 0 ? Math.min(1, (stage === 'windup' ? tt : stage === 'active' ? tt - W : tt - W - A) / len) : 1;
      if (stage !== lastStage) {
        // 每段开头重置覆盖字段（上一段覆盖过的回到待机值），再叠这一段的
        const base = newAnimState();
        for (const key of Object.keys(s)) if (!['phase', 'hurt', 'hurtX', 'hurtZ', 'pose', 'stage', 'k'].includes(key)) s[key] = base[key];
        apply({ ...(idleState ?? {}), ...(st.all ?? {}), ...(st[stage] ?? {}) });
        lastStage = stage;
      }
      s.pose = poseOf(id);
      s.stage = stage;
      s.k = k;
    }, record);
  };
  for (const id of ids) {
    const m = table[id] ?? table[poseOf(id)];
    settle(idleState);
    const lead = P.lead?.[id];
    if (lead && table[lead[0]]) playMove(lead[0], table[lead[0]], lead[1], false);
    const total = (m.windup ?? 0) + (m.active ?? 0) + (m.recover ?? 0);
    const seconds = P.seconds?.[id] ?? total;
    if (!(seconds > 0.05)) { notes.push(`${id} 时长为 0，不录`); continue; }
    const frames = playMove(id, m, seconds, true);
    if (frames.length < 3) { notes.push(`${id} 太短（${frames.length} 帧）`); continue; }
    clips[id] = H.clipFrom(frames, 0, frames.length, false);
  }

  // 4) 持续循环（眩晕、盘旋、潜游、落地追啄、飞走…）
  const loops = { ...(P.stun === false ? {} : { stun: { state: { stun: 1 }, seconds: [1.4, 3.2] } }), ...(P.loops ?? {}) };
  for (const [name, L] of Object.entries(loops)) {
    settle(idleState);
    apply({ ...(idleState ?? {}), ...(L.state ?? {}) });
    const rate = phaseRate.v;
    const setup = () => {
      if (L.pose) { s.pose = L.pose; s.stage = L.stage ?? 'active'; s.k = L.k ?? 0.5; }
      if (L.state?.stun) s.stun = 1;
    };
    run(1.0, setup, false);
    phaseRate.v = rate;
    const [lo, hi] = L.seconds ?? [1, 3];
    const frames = run(hi + 2.5, setup);
    phaseRate.v = 0;
    const loop = H.findLoop(frames, 0, lo, hi);
    if (!loop) { notes.push(`循环 ${name} 找不到循环点`); continue; }
    for (const f of frames) f.state = name;
    const clip = H.clipFrom(frames, loop.a, loop.b, true);
    clips[name] = clip;
  }

  // 5) 受击 / 硬直（不循环）
  if (P.hit !== false) {
    settle(idleState);
    s.hurt = 1;
    s.hurtX = 0;
    s.hurtZ = 1; // 从正面打来：往后仰
    const frames = run(0.55, (tt, dt) => { s.hurt = Math.max(0, s.hurt - dt * 4); });
    for (const f of frames) f.state = 'Hit';
    clips.Hit = H.clipFrom(frames, 0, frames.length, false);
  }
  if (P.stagger !== false) {
    settle(idleState);
    const T = P.staggerTime ?? 0.6;
    const frames = run(T + 0.35, (tt, dt) => {
      s.stagger = tt < T ? Math.min(1, s.stagger + dt * 8) : Math.max(0, s.stagger - dt * 5);
    });
    for (const f of frames) f.state = 'stagger';
    clips.stagger = H.clipFrom(frames, 0, frames.length, false);
  }

  return {
    bones: bones.map((b) => b.name),
    sockets: [],
    socketScale: {},
    rest,
    clips,
    notes,
  };
}
