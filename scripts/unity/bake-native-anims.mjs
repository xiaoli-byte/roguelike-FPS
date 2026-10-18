// 原生骨架敌人的程序动画 → Unity 动画片段数据（离线采样）。
//
//   node --import ./scripts/unity/register.mjs scripts/unity/bake-native-anims.mjs            全部原生骨架敌人
//   node --import ./scripts/unity/register.mjs scripts/unity/bake-native-anims.mjs fuzhu qingniao
//
// Three.js 版每只怪的动作都是逐帧的程序动画（状态机 + 阻尼参数 + 步态相位 + IK），GLB 里没有关键帧。
// 这里在 Node 里跑真实的敌人代码（真实 EnemyBase / StandardEnemy / NativePose / 碰撞 / 导航，特效与音效是空桩），
// 骨架按发布 GLB 的节点 TRS 搭（stubs/EnemyArt.mjs），按几个脚本化场景推进 AI，逐帧记下每根骨骼在模型空间（host）的
// 朝向与位置，按状态切成片段：
//   Idle   关掉 AI、原地站立，从录到的数据里找首尾最接近的一段做成无缝循环
//   Move   玩家在远处，怪一路追近；取稳定移动的一段找循环点
//   Hit    待机中给一次受击抖动（hurtKick）
//   <状态>  玩家在近 / 中距离，AI 自然出招；每个状态取第一段完整的连续帧（windup → 出招 → 收招各自一段）
// 输出 unity/Assets/Art/Characters/<资产>/Anim/<资产>.native-anim.json；Unity 的 Spiritfire ▸ Art ▸ Sync 把它换算成
// 各骨骼的局部曲线（模型空间增量 → Unity 自己的绑定姿势，不受骨骼轴向约定影响），并生成 Generic 状态机。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';

const ROOT = new URL('../../', import.meta.url);
const SIM_DT = 1 / 60;
const SAMPLE_EVERY = 2; // 30 fps
const FPS = 1 / (SIM_DT * SAMPLE_EVERY);

// ── 敌人代码依赖的最小游戏上下文（与 tests/*.test.mjs 的无头夹具同构）──
let seed = 0x5eed1234;
Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const { TaskRunner } = await import('../../src/core/Tasks.ts');
const { CollisionWorld } = await import('../../src/world/Collision.ts');
const { NavGrid } = await import('../../src/world/NavGrid.ts');
const { registerStandardEnemies } = await import('../../src/enemies/index.ts');
const { getEnemyEntry } = await import('../../src/enemies/Registry.ts');
const { attackDirector } = await import('../../src/enemies/AttackTokens.ts');
const { findNativeAsset, buildSkeleton } = await import('./stubs/EnemyArt.mjs');
registerStandardEnemies();

const noop = () => {};
/** 没登记的方法一律当空操作（召唤分身、掉落、伤害等与骨骼动作无关的调用） */
const lenient = (o) => new Proxy(o, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? noop : undefined) });

/** 游戏事件（采样时记录调用时刻，写进片段做 Unity 动画事件）：伤害判定、发射弹体、特效、音效 */
function makeContext(theme) {
  const events = [];
  const log = (name) => events.push(name);
  const fx = new Proxy({}, { get: (_, k) => (...args) => { log(`fx:${String(k)}`); return k === 'groundWarning' ? noop : undefined; } });
  const world = new CollisionWorld();
  world.addBox(-60, -0.2, -60, 60, 0, 60, 'floor');
  const player = lenient({
    position: new THREE.Vector3(0, 0, 20), velocity: new THREE.Vector3(), eye: new THREE.Vector3(),
    radius: 0.3, height: 1.8, alive: true, invulnerableTime: 0, maxHp: () => 100,
    stats: lenient({ getBase: () => 7.5, get: () => 7.5, hasSource: () => false }),
  });
  const ctx = {
    rng: { range: (a, b) => a + (b - a) * Math.random(), sign: () => (Math.random() < 0.5 ? -1 : 1), chance: (p) => Math.random() < p,
      int: (a, b) => Math.floor(a + (b - a + 1) * Math.random()), next: () => Math.random(), pick: (arr) => arr[Math.floor(Math.random() * arr.length)] },
    time: { now: 0, dt: SIM_DT, frame: 0, timeScale: 1 },
    player, world, tasks: new TaskRunner(),
    scene: new THREE.Group(), stageGroup: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    settings: { quality: 'high' }, renderer: null, run: { chapter: 1 },
    stage: { arena: { minX: -60, minZ: -60, maxX: 60, maxZ: 60, floorY: 0, center: new THREE.Vector3() }, stage: { theme } },
    enemies: lenient({
      list: [],
      queryRadius(pos, r, out = []) {
        for (const e of this.list) if (!e.removed && e.position.distanceTo(pos) <= r) out.push(e);
        return out;
      },
      alive() { return this.list.filter((e) => !e.removed && e.alive !== false); },
    }),
    combat: lenient({ damagePlayer: (a) => { log('hit'); return a; }, explode: () => log('explode') }),
    projectiles: lenient({ spawn: () => log('projectile') }),
    loot: lenient({}),
    audio: lenient({ play: (name) => log(`sfx:${name}`) }),
    fx,
    __events: events,
  };
  ctx.nav = new NavGrid(ctx);
  ctx.nav.build(ctx.stage.arena, 0.5);
  return ctx;
}

// ── 个别敌人的采样设置 ──
/** 待机用哪个状态（默认：有 'idle' 就用 idle）。邪飞天的弹奏姿态在 hover（idle 是没有同伴时的闲置） */
const IDLE_STATE = { apsara: 'hover' };
/** 待机循环最长秒数（默认 4）：邪飞天的三道弯身段、两腿交替很慢，周期长 */
const IDLE_LOOP_MAX = { apsara: 8 };
/** 出招场景里放的同伴（辅助型：有同伴才会施法）：[同伴 id, 数量] */
const ALLIES = { apsara: ['jerboa_blade', 2] };

// ── 采样 ──
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

function bonesOf(model) {
  const out = [];
  model.traverse((o) => { if (o.isBone) out.push(o); });
  return out;
}

/** 要记录的节点：全部骨骼 + 挂点（非骨骼的命名节点，如琵琶挂点 / 英雄持枪点；追加在后面，数据里 sockets 记名字） */
function tracked(body) {
  return [...bonesOf(body.__model), ...(body.__sockets ?? [])];
}

/** 清单里绑在这只怪上的挂件（琵琶、盾、法器…）的挂点：在怪的模型里找同名的非骨骼节点 */
function findSockets(defId, root) {
  return Object.values(manifest).filter((m) => m.bind?.source === 'enemy' && m.bind.id === defId && m.bind.attachment)
    .map((m) => root.getObjectByName(m.bind.attachment)).filter((o) => o && !o.isBone);
}

/** 挂点在 host 空间的缩放（静止姿势；挂件按它缩放，如英雄持枪点把枪放大 1.35–1.4 倍） */
function socketScales(host, sockets) {
  host.updateWorldMatrix(true, true);
  _inv.copy(host.matrixWorld).invert();
  const out = {};
  for (const o of sockets) {
    _m.multiplyMatrices(_inv, o.matrixWorld).decompose(_p, _q, _s);
    out[o.name] = Math.round(((_s.x + _s.y + _s.z) / 3) * 1e4) / 1e4;
  }
  return out;
}

/**
 * 采样参照系：host 的父节点当前的世界矩阵 × host 自己的「静止」局部矩阵。
 * 这样 host 节点本身的运动（玄龟翻身 / 甲壳旋转、鲲绕水线俯仰升降、死亡侧倒）也算进骨骼姿势里，
 * 而角色整体的朝向 / 位移（根节点，AI 转身、走路）不算——那是玩法的事。
 */
const _frame = new THREE.Matrix4();
function frameOf(host) {
  host.updateWorldMatrix(true, true);
  if (!host.userData.__restLocal) { host.updateMatrix(); host.userData.__restLocal = host.matrix.clone(); }
  return host.parent ? _frame.multiplyMatrices(host.parent.matrixWorld, host.userData.__restLocal) : _frame.copy(host.userData.__restLocal);
}

/** 当前帧：每根骨骼在参照系（见 frameOf）里的 [qx, qy, qz, qw, px, py, pz] */
function sample(host, bones) {
  _inv.copy(frameOf(host)).invert();
  const f = new Array(bones.length * 7);
  bones.forEach((b, i) => {
    _m.multiplyMatrices(_inv, b.matrixWorld).decompose(_p, _q, _s);
    f[i * 7] = _q.x; f[i * 7 + 1] = _q.y; f[i * 7 + 2] = _q.z; f[i * 7 + 3] = _q.w;
    f[i * 7 + 4] = _p.x; f[i * 7 + 5] = _p.y; f[i * 7 + 6] = _p.z;
  });
  return f;
}

function poseDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i += 7) {
    const dot = Math.abs(a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3]);
    d += 1 - Math.min(1, dot) + 0.5 * Math.hypot(a[i + 4] - b[i + 4], a[i + 5] - b[i + 5], a[i + 6] - b[i + 6]);
  }
  return d;
}

/** 在 frames[from..] 里找一段 [a, b) 使 b 处姿势最接近 a（无缝循环），长度在 [minS, maxS] 秒 */
function findLoop(frames, from, minS, maxS) {
  const minN = Math.round(minS * FPS), maxN = Math.round(maxS * FPS);
  const cands = [];
  for (let a = from; a < Math.min(frames.length - minN, from + Math.round(FPS)); a += 2) {
    for (let b = a + minN; b <= Math.min(frames.length - 1, a + maxN); b++) {
      cands.push({ a, b, d: poseDistance(frames[a].pose, frames[b].pose) });
    }
  }
  if (cands.length === 0) return null;
  // 误差接近最优（≤ 1.25 倍 + 小常数）的候选里取最长的：快周期（呼吸）的近似匹配很多，
  // 取最短的那个会把慢周期的动作（身段摆动、两腿交替、环顾）截掉一半，循环时一跳一跳
  const bestD = Math.min(...cands.map((c) => c.d));
  const ok = cands.filter((c) => c.d <= bestD * 1.25 + 0.02);
  return ok.reduce((x, c) => (c.b - c.a > x.b - x.a ? c : x));
}

function spawn(ctx, defId, pos) {
  const entry = getEnemyEntry(defId);
  const e = entry.factory(ctx, { position: pos.clone() });
  e.init();
  e.onGround = true;
  ctx.enemies.list.push(e);
  return e;
}

/** 推进 seconds 秒，每 SAMPLE_EVERY 帧采一次；beforeStep 可在每帧推进前改场景（如追着怪移动玩家） */
function record(ctx, e, body, seconds, beforeStep) {
  const bones = tracked(body);
  const out = [];
  const host = body.pose.host ?? body.__model.parent;
  const frames = Math.round(seconds / SIM_DT);
  for (let i = 0; i < frames; i++) {
    beforeStep?.(i);
    ctx.time.now += SIM_DT;
    ctx.time.frame++;
    const p = ctx.player.position;
    ctx.player.eye.set(p.x, p.y + 1.6, p.z);
    if (!e.removed) e.update(SIM_DT);
    ctx.tasks.update(SIM_DT);
    if (i % SAMPLE_EVERY === 0) {
      const v = e.velocity ?? new THREE.Vector3();
      out.push({ state: e.state, speed: Math.hypot(v.x, v.z), rootY: (e.root ?? e.object ?? host).position.y, pose: sample(host, bones),
        events: ctx.__events.splice(0) });
    }
  }
  return out;
}

function clipFrom(frames, a, b, loop) {
  const seg = frames.slice(a, b);
  const y0 = loop ? seg[0].rootY : frames[a].rootY;
  // 动画事件：只留对玩法 / 表现有意义的时刻（伤害、弹体、爆炸、音效、地面预警、震屏、冲击波）；
  // 粒子 burst / 拖尾这类每帧都在发的不记。同名事件 0.15 秒内只记一次
  const KEEP = /^(hit|projectile|explode|sfx:.*|fx:(groundWarning|explosion|shake|ring|impact|deathEffect|spawnEffect))$/;
  const events = [];
  const last = {};
  seg.forEach((f, i) => {
    const t = i / FPS;
    for (const name of new Set(f.events ?? [])) {
      if (!KEEP.test(name) || (last[name] !== undefined && t - last[name] < 0.15)) continue;
      last[name] = t;
      events.push({ t: Math.round(t * 1000) / 1000, name });
    }
  });
  return {
    loop,
    frames: seg.map((f) => f.pose.map((x) => Math.round(x * 1e5) / 1e5)),
    rootY: seg.map((f) => Math.round((f.rootY - y0) * 1e4) / 1e4),
    events,
  };
}

function bakeEnemy(defId, asset) {
  const clips = {};
  const notes = [];
  let bones = null, rest = null, sockets = [], socketScale = {};
  let attached = null;
  globalThis.__bakeAttached = (body) => { attached = body; };
  /** 新建一只本体（每个场景一只），挂上挂点 */
  const subject = (ctx, pos) => {
    attached = null;
    const e = spawn(ctx, defId, pos);
    const body = attached;
    if (!body) throw new Error('没有挂上原生骨架（清单 skeleton.mode 不是 native？）');
    body.__sockets = findSockets(defId, e.root);
    return { e, body };
  };
  const variant = asset.entry.bind.variant ?? 'desert';

  // 1) 待机：关掉 AI，速度清零，原地站立（IDLE_STATE 指定的状态，或有 idle 就用它）
  {
    attackDirector.reset?.();
    const ctx = makeContext(variant);
    ctx.player.position.set(0, 0, 40);
    const { e, body } = subject(ctx, new THREE.Vector3(0, 0, 0));
    bones = bonesOf(body.__model).map((b) => b.name);
    sockets = body.__sockets.map((o) => o.name);
    socketScale = socketScales(body.pose.host ?? body.__model.parent, body.__sockets);
    // 静止姿势：attach 之后、任何动画之前
    rest = sample(body.pose.host ?? body.__model.parent, tracked(body));
    record(ctx, e, body, 1.5); // 出生动画
    e.think = () => {};
    e.velocity?.set(0, 0, 0);
    if (IDLE_STATE[defId]) e.state = IDLE_STATE[defId];
    else if (Object.getPrototypeOf(e).constructor.toString().includes("'idle'")) e.state = 'idle';
    e.stateTime = 0;
    const maxLoop = IDLE_LOOP_MAX[defId] ?? 4;
    const idle = record(ctx, e, body, maxLoop + 3, () => { e.velocity?.set(0, e.velocity.y, 0); });
    const loop = findLoop(idle, Math.round(1.5 * FPS), Math.min(1.6, maxLoop / 2), maxLoop);
    if (loop) clips.Idle = clipFrom(idle, loop.a, loop.b, true);
    // 受击：待机中抖一下
    if ('hurtKick' in e) {
      e.hurtKick = 1;
      const hit = record(ctx, e, body, 0.7, () => { e.velocity?.set(0, e.velocity.y, 0); });
      clips.Hit = clipFrom(hit, 0, hit.length, false);
    }
  }

  // 2) 移动：先让 AI 自然追击，找出它移动时用的状态名；再关掉 AI、按指定速度直线前进录制——
  //    Walk = 半速、Move = 全速（def.speed），Unity 混合树按速度在 Idle / Walk / Move 之间过渡（Three.js 版只有一套步态参数）
  {
    attackDirector.reset?.();
    const ctx = makeContext(variant);
    ctx.player.position.set(0, 0, 30);
    const { e, body } = subject(ctx, new THREE.Vector3(0, 0, 0));
    const probe = record(ctx, e, body, 5, () => { const pos = e.root.position; ctx.player.position.set(pos.x, 0, pos.z + 30); });
    const counts = {};
    for (const f of probe) if (f.speed > 0.5) counts[f.state] = (counts[f.state] ?? 0) + 1;
    const moveState = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const fullSpeed = e.def?.speed ?? 3;
    if (!moveState) notes.push('没录到移动（原地型 / 飞行悬停）');
    else for (const [name, k] of [['Walk', 0.5], ['Move', 1]]) {
      const c2 = makeContext(variant);
      c2.player.position.set(0, 0, 60);
      const { e: m, body: b2 } = subject(c2, new THREE.Vector3(0, 0, 0));
      record(c2, m, b2, 1.2);
      const speed = fullSpeed * k;
      m.think = () => { m.state = moveState; m.setMove(0, 1, speed); };
      m.state = moveState;
      m.facing = 0;
      const frames = record(c2, m, b2, 6, () => { c2.player.position.set(m.root.position.x, 0, m.root.position.z + 60); m.facing = 0; });
      const loop = findLoop(frames, Math.round(1.5 * FPS), 0.5, 3);
      if (!loop) continue;
      const clip = clipFrom(frames, loop.a, loop.b, true);
      clip.speed = Math.round(frames.slice(loop.a, loop.b).reduce((sum, f) => sum + f.speed, 0) / (loop.b - loop.a) * 100) / 100;
      clip.sourceState = moveState;
      clips[name] = clip;
    }
  }

  // 3) 出招：玩家在 3 / 7 / 12 米，各跑 18 秒，按状态切段（辅助型放几个同伴，才会施法）；
  //    最后补一轮 1.2 米（贴脸招：跳鼠交叉斩 → 后跳），放在最后，前面三轮录到的片段不受影响
  const seen = new Set(['Idle', 'Walk', 'Move', 'Hit', clips.Move?.sourceState, IDLE_STATE[defId], 'move', 'chase', 'advance']);
  for (const dist of [3, 7, 12, 1.2]) {
    attackDirector.reset?.();
    const ctx = makeContext(variant);
    ctx.player.position.set(0, 0, dist);
    const { e, body } = subject(ctx, new THREE.Vector3(0, 0, 0));
    if (ALLIES[defId]) {
      const [ally, n] = ALLIES[defId];
      for (let k = 0; k < n; k++) {
        const a = spawn(ctx, ally, new THREE.Vector3(k % 2 ? 2 : -2, 0, 2));
        if ('hp' in a && 'maxHp' in a) a.hp = a.maxHp * 0.6; // 有人受伤，治疗类法术才会放
      }
    }
    const frames = record(ctx, e, body, 18, () => {
      // 玩家站在怪正前方固定距离（怪移动时跟着），出招能完整走完
      const pos = e.root.position;
      ctx.player.position.set(pos.x, 0, pos.z + dist);
      if (e.cooldown !== undefined) e.cooldown = Math.min(e.cooldown, 1.5);
      for (const o of ctx.enemies.list) if (o !== e && !o.removed) o.update(SIM_DT);
    });
    for (let i = 0, j = 0; i < frames.length; i = j) {
      j = i + 1;
      while (j < frames.length && frames[j].state === frames[i].state) j++;
      const st = frames[i].state;
      const n = j - i;
      // 最短 0.12 秒：交叉斩的出刀段只有 0.14 秒
      if (!st || seen.has(st) || n < 0.12 * FPS || n > 8 * FPS) continue;
      if (i === 0) continue; // 段首不完整
      seen.add(st);
      clips[st] = clipFrom(frames, i, j, false);
      // 紧跟着的状态：Unity 状态机按它把 windup → 出招 → 收招串成连段
      if (j < frames.length && frames[j].state !== st) clips[st].next = frames[j].state;
    }
  }
  globalThis.__bakeAttached = null;
  return { bones, sockets, socketScale, rest, clips, notes };
}

// ── Boss：两形态、setAnim 驱动（KunPeng.ts / Qilin.ts 的 animateKun / animatePeng / animateBody）──
/**
 * Boss 的 AI 招式编排复杂（召唤、场地机关、形态切换），这里不跑 AI：直接切形态、逐个 setAnim(名) 播放并采样。
 * 各动作的姿势参数在 Boss 代码里按 lam 平滑逼近目标，所以每段都从待机自然过渡过去（与游戏里一致）。
 * gait：火麒麟的步态频率取实际水平速度，Walk / Move 采样时让它以给定速度前进。
 */
const BOSSES = [
  { id: 'boss_kunpeng', forms: [
    { form: 'kun', defId: 'boss_kunpeng_kun', idle: 'idle',
      acts: ['inhale', 'bite', 'slamWind', 'slam', 'spit', 'roar', 'rise', 'sink', 'erupt'],
      next: { slamWind: 'slam', inhale: 'bite', sink: 'erupt' } },
    { form: 'peng', defId: 'boss_kunpeng_peng', idle: 'idle',
      acts: ['swoopReady', 'dive', 'crash', 'perch', 'takeoff', 'gust', 'spread', 'roar'],
      next: { swoopReady: 'dive', dive: 'crash' } },
  ] },
  { id: 'boss_qilin', gait: [['Walk', 6], ['Move', 16]], forms: [
    { form: 'xuan', defId: 'boss_qilin_xuan', idle: 'idle',
      acts: ['rear', 'scalesFire', 'drink', 'breath', 'stun', 'pant', 'tuck', 'leap', 'stomp', 'roar', 'paw'],
      next: { tuck: 'leap', leap: 'stomp', rear: 'scalesFire' } },
    { form: 'burn', defId: 'boss_qilin_burn', idle: 'idle',
      acts: ['rear', 'scalesFire', 'breath', 'stun', 'pant', 'tuck', 'leap', 'stomp', 'roar', 'paw'],
      next: { tuck: 'leap', leap: 'stomp', rear: 'scalesFire' } },
  ] },
];

let bossesRegistered = false;
async function bakeBoss(spec) {
  if (!bossesRegistered) {
    const { registerBosses } = await import('../../src/enemies/bosses/index.ts');
    registerBosses();
    bossesRegistered = true;
  }
  const results = {};
  for (const f of spec.forms) {
    const bodies = {};
    globalThis.__bakeAttached = (body, o) => { bodies[o.defId] = body; };
    attackDirector.reset?.();
    const ctx = makeContext(f.form === 'burn' || spec.id.includes('qilin') ? 'zhurong' : 'beiming');
    ctx.ui = lenient({});
    ctx.player.position.set(0, 0, 25);
    const e = spawn(ctx, spec.id, new THREE.Vector3(0, 0, 0));
    globalThis.__bakeAttached = null;
    const body = bodies[f.defId];
    if (!body) throw new Error(`${spec.id}: 形态 ${f.form} 没挂上原生骨架 ${f.defId}`);
    body.__sockets = [];
    const host = body.pose.host ?? body.__model.parent;
    const bones = bonesOf(body.__model).map((b) => b.name);
    const rest = sample(host, tracked(body));
    e.think = () => {};
    e.useForm?.(f.form);
    const clips = {};
    const play = (name, seconds, move = 0) => {
      e.setAnim(name, true);
      return record(ctx, e, body, seconds, () => {
        if (move) { e.position.z += move * SIM_DT; ctx.player.position.set(e.position.x, 0, e.position.z + 25); }
      });
    };
    play(f.idle, 2);
    const idle = play(f.idle, 9);
    const loop = findLoop(idle, Math.round(1.5 * FPS), 2, 6);
    if (loop) clips.Idle = clipFrom(idle, loop.a, loop.b, true);
    for (const [name, speed] of spec.gait ?? []) {
      play('idle', 1.5, speed);
      const g = play('idle', 5, speed);
      const gl = findLoop(g, Math.round(1 * FPS), 0.4, 2.5);
      if (gl) { clips[name] = clipFrom(g, gl.a, gl.b, true); clips[name].speed = speed; }
    }
    for (const a of f.acts) {
      play(f.idle, 1.2); // 每招都从待机姿势起
      const frames = play(a, 2.4);
      clips[a] = clipFrom(frames, 0, frames.length, false);
      if (f.next[a]) clips[a].next = f.next[a];
    }
    const assetId = Object.entries(manifest).find(([, m]) => m.bind?.id === f.defId)?.[0];
    results[assetId] = { bones, sockets: [], socketScale: {}, rest, clips, notes: [] };
  }
  return results;
}

// ── 英雄：选人界面的原生骨骼演出（nativeTripo.ts：待机呼吸 / 环顾 / 双手 IK 持枪，亮相抬枪）──
/**
 * createNativeHero 需要 glTF 模板里有 *_LOD<n> 蒙皮网格（按 LOD0 的包围盒量身高）。这里只搭骨骼，
 * 每级 LOD 补一个按清单包围盒做的方盒蒙皮网格（全部顶点绑在第一根骨骼上，绑定姿势下包围盒 = 设计包围盒）。
 */
function heroTemplate(entry) {
  const model = buildSkeleton(entry);
  model.updateMatrixWorld(true);
  const bones = bonesOf(model);
  const skeleton = new THREE.Skeleton(bones);
  const b = entry.bounds;
  const size = new THREE.Vector3(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
  geo.translate((b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) / 2, (b.max[2] + b.min[2]) / 2);
  const n = geo.getAttribute('position').count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const lods = entry.lodDistance?.length ?? 1;
  for (let i = 0; i < lods; i++) {
    const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
    mesh.name = `${entry.url.split('/').pop().replace(/\.glb$/, '')}_LOD${i}`;
    model.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
  }
  return model;
}

async function bakeHero(heroId, assetId, entry) {
  const { createNativeHero } = await import('../../src/ui/heroPreview/heroes/nativeTripo.ts');
  const b = entry.bounds;
  const rig = createNativeHero(heroId, heroTemplate(entry), { lodDistance: entry.lodDistance, height: b.max[1] - b.min[1] });
  if (!rig) throw new Error('createNativeHero 返回 null（骨骼缺失？）');
  const host = rig.root;
  const model = host.children[0];
  if (Math.abs(model.scale.x - 1) > 1e-3) throw new Error(`英雄模型被缩放了 ${model.scale.x}（模板包围盒与清单不一致）`);
  // 持枪挂点：原点 = 握把顶部、−Z = 枪口，与枪模原点约定一致；Unity 里枪挂在它下面
  rig.hand.name = 'hand';
  const body = { __model: model, __sockets: [rig.hand], pose: { host } };
  const bones = bonesOf(model).map((x) => x.name);
  const rest = sample(host, tracked(body));
  const socketScale = socketScales(host, body.__sockets);
  let t = 0;
  const run = (seconds) => {
    const out = [];
    const frames = Math.round(seconds / SIM_DT);
    for (let i = 0; i < frames; i++) {
      t += SIM_DT;
      rig.update(SIM_DT, t);
      if (i % SAMPLE_EVERY === 0) out.push({ state: 'idle', speed: 0, rootY: 0, pose: sample(host, tracked(body)) });
    }
    return out;
  };
  const clips = {};
  run(2); // 进入待机的过渡
  const idle = run(11);
  const loop = findLoop(idle, 0, 2, 8);
  if (loop) clips.Idle = clipFrom(idle, loop.a, loop.b, true);
  rig.playIntro();
  const intro = run((rig.show?.intro ?? 1.5) + 1.2);
  clips.Show = clipFrom(intro, 0, intro.length, false);
  rig.dispose?.();
  return { bones, sockets: ['hand'], socketScale, rest, clips, notes: [] };
}

// ── 主流程 ──
const manifest = JSON.parse(readFileSync(new URL('public/assets/manifest.json', ROOT), 'utf8')).assets;
const want = process.argv.slice(2);
const targets = Object.entries(manifest)
  .filter(([id, e]) => e.skeleton?.mode === 'native' && e.bind?.source === 'enemy' && !e.bind.attachment && id.startsWith('SK_Enemy_'))
  .map(([id, e]) => ({ id, defId: e.bind.id, entry: e }))
  .filter((t) => want.length === 0 || want.includes(t.defId) || want.includes(t.id));

let failed = 0;
function write(t, r, t0) {
  const out = new URL(`unity/Assets/Art/Characters/${t.id}/Anim/`, ROOT);
  mkdirSync(out, { recursive: true });
  const doc = { schema: 1, asset: t.id, defId: t.defId, fps: FPS, bones: r.bones, sockets: r.sockets, socketScale: r.socketScale, rest: r.rest.map((x) => Math.round(x * 1e5) / 1e5),
    clips: r.clips, notes: r.notes, baked: new Date().toISOString() };
  writeFileSync(new URL(`${t.id}.native-anim.json`, out), JSON.stringify(doc));
  const names = Object.entries(r.clips).map(([k, c]) => `${k}(${(c.frames.length / FPS).toFixed(1)}s${c.loop ? '↻' : ''})`);
  console.log(`${t.id}: ${names.join(' ')}${r.sockets.length ? '  挂点 ' + r.sockets.join(',') : ''}${r.notes.length ? '  ⚠ ' + r.notes.join('；') : ''}  [${((Date.now() - t0) / 1000).toFixed(1)}s]`);
}
for (const t of targets) {
  if (!getEnemyEntry(t.defId)) { console.log(`${t.id}: — 游戏里已不再注册 ${t.defId}（退役资产），跳过`); continue; }
  const hit = findNativeAsset(t.defId, t.entry.bind.variant);
  if (!hit || hit.id !== t.id) { console.log(`${t.id}: — ${t.defId} 在游戏里绑定的是 ${hit?.id ?? '无'}，跳过`); continue; }
  try {
    const t0 = Date.now();
    write(t, bakeEnemy(t.defId, { id: t.id, entry: t.entry }), t0);
  } catch (err) {
    failed++;
    console.log(`${t.id}: ✘ ${err.stack?.split(String.fromCharCode(10)).slice(0, 4).join(' | ')}`);
  }
}
// Boss：两形态各自一份
for (const spec of BOSSES) {
  if (want.length && !want.includes(spec.id) && !spec.forms.some((f) => want.includes(f.defId))) continue;
  try {
    const t0 = Date.now();
    const r = await bakeBoss(spec);
    for (const [id, res] of Object.entries(r)) write({ id, defId: spec.id }, res, t0);
  } catch (err) {
    failed++;
    console.log(`${spec.id}: ✘ ${err.stack?.split(String.fromCharCode(10)).slice(0, 5).join(' | ')}`);
  }
}
// 英雄：原生骨骼的选人演出
const heroes = Object.entries(manifest)
  .filter(([id, e]) => e.skeleton?.mode === 'native' && e.bind?.source === 'hero' && !e.bind.attachment && id.startsWith('SK_Hero_'))
  .map(([id, e]) => ({ id, defId: e.bind.id, entry: e }))
  .filter((t) => want.length === 0 || want.includes(t.defId) || want.includes(t.id));
for (const t of heroes) {
  try {
    const t0 = Date.now();
    write(t, await bakeHero(t.defId, t.id, t.entry), t0);
  } catch (err) {
    failed++;
    console.log(`${t.id}: ✘ ${err.stack?.split(String.fromCharCode(10)).slice(0, 4).join(' | ')}`);
  }
}
process.exitCode = failed ? 1 : 0;
