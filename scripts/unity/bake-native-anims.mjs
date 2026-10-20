// 原生骨架敌人的程序动画 → Unity 动画片段数据（离线采样）。
//
//   node --import ./scripts/unity/register.mjs scripts/unity/bake-native-anims.mjs            全部原生骨架敌人 / Boss / 英雄
//   node --import ./scripts/unity/register.mjs scripts/unity/bake-native-anims.mjs fuzhu qingniao SK_Boss_Kun
//
// Three.js 版每只怪的动作都是逐帧的程序动画（状态机 + 阻尼参数 + 步态相位 + IK），GLB 里没有关键帧。
// 这里在 Node 里跑真实的敌人代码（真实 EnemyBase / StandardEnemy / NativePose / 碰撞 / 导航，特效与音效是空桩），
// 骨架按发布 GLB 的节点 TRS 搭（stubs/EnemyArt.mjs），按几个脚本化场景推进 AI，逐帧记下每根骨骼在模型空间（host）的
// 朝向与位置，按状态切成片段：
//   Idle   关掉 AI、原地站立，从录到的数据里找首尾最接近的一段做成无缝循环
//   Move   玩家在远处，怪一路追近；取稳定移动的一段找循环点
//   Hit    待机中给一次受击抖动（hurtKick）
//   <状态>  玩家在近 / 中距离，AI 自然出招；每个状态取第一段完整的连续帧（windup → 出招 → 收招各自一段）
//   强制场景  每个资产自己的采样配置 bake/<资产>.mjs：摆场景道具（熔岩、地火、栖柱、高台、友军桩），
//            直接调 AI 自己的状态入口（beginX / startX，与游戏里完全同一段代码），把自然打不出来的招牌状态录下来
// 输出 unity/Assets/Art/Characters/<资产>/Anim/<资产>.native-anim.json（可再生成，不入库）；Unity 的 Spiritfire ▸ Art ▸ Sync
// 把它换算成各骨骼的局部曲线（模型空间增量 → Unity 自己的绑定姿势，不受骨骼轴向约定影响），并生成 Generic 状态机。
//
// ── 采样配置 bake/<资产 ID>.mjs（默认导出一个对象；没有文件就全用默认值）──
// 敌人：
//   idleState      待机用哪个状态（默认：有 'idle' 就用 idle）
//   idleLoopMax    待机循环最长秒数（默认 4）
//   natural        自然出招场景 { dists: [3, 7, 12, 1.2], seconds: 18, allies: [[id, 数量]], props: [...] }
//   scenes         强制场景数组，每个：
//     name           日志里的名字
//     props          场景道具（见 applyProps）：box / pillar / lava / fire / ally
//     at             本体出生点 [x, y, z]（默认原点）
//     player         玩家站位：{ dist, angle?, facing?, y? }（每帧跟着本体）、{ at: [x, y, z] }（固定）或 (e, api, i) => void
//     warmup         start 之前让 AI 自然跑几秒（默认 1.5；0 = 出生那一帧就开录，可录 enter 这类出生状态）
//     warmStep       (e, api, i) => void：warmup 期间每帧调用（压住冷却，别在 start 之前自己先出招）
//     start          (e, api) => void 或方法名字符串：强制进入状态（调 AI 自己的入口函数）
//     step           (e, api, i) => void：录制中每帧推进前调用（保持条件、定时触发下一招）
//     label          (e) => 状态名：给叠加在状态上的演出起名（如狐巫碎镜尖啸 = stalk 里的 screamTime）
//     seconds        录多久（默认 6）
//     capture        只收这些状态（默认：前面没录到的都收）
//     override       这些状态即使前面录到过也用本场景的覆盖
//     loops          { 状态: [最短秒, 最长秒] }：持续型状态（潜游、栖落、盘旋）切一段无缝循环
//     inPlace        片段不带离地高度（攀爬这类玩法自己抬升根节点的动作）
//   expect         应该有片段的状态（报告用：采样后缺哪个写进 notes）
//   skip           { 状态: 原因 }：已知采不到的状态（写进 notes）
// Boss（两形态各一份配置）：
//   boss, form, defId, theme, idle, acts, next, gait
//   seconds        { 招式: 秒 }：每段录多久（按游戏里这一段实际持续的时长；默认 2.4）
//   lead           { 招式: [前一段, 秒] }：连段后半先放前一段（不录）再录，姿势与游戏里一样是接过去的
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const ROOT = new URL('../../', import.meta.url);
const BAKE_DIR = new URL('./bake/', import.meta.url);
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
const { registerFloorFire } = await import('../../src/enemies/inferno/FireFeed.ts');
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
    // 布尔量要显式给：lenient 对没登记的键返回空函数（真值），isDashing 会被当成「在冲刺」，马面的钩子永远钩不中
    onGround: true, isDashing: false, isLunging: false,
    stats: lenient({ getBase: () => 7.5, get: () => 7.5, hasSource: () => false }),
  });
  const ctx = {
    rng: { range: (a, b) => a + (b - a) * Math.random(), sign: () => (Math.random() < 0.5 ? -1 : 1), chance: (p) => Math.random() < p,
      int: (a, b) => Math.floor(a + (b - a + 1) * Math.random()), next: () => Math.random(), pick: (arr) => arr[Math.floor(Math.random() * arr.length)] },
    time: { now: 0, dt: SIM_DT, frame: 0, timeScale: 1 },
    player, world, tasks: new TaskRunner(),
    scene: new THREE.Group(), stageGroup: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    settings: { quality: 'high' }, renderer: null, run: { chapter: 1 },
    stage: { arena: { minX: -60, minZ: -60, maxX: 60, maxZ: 60, floorY: 0, center: new THREE.Vector3() }, stage: { theme }, lavaSystem: null },
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

// ── 场景道具 ──
/** 熔岩掩码（WhiteboxLava）：竞技场全域 0.5 米一格，rects = [[minX, minZ, maxX, maxZ], …] 内是熔岩 */
function makeLava(arena, rects) {
  const cell = 0.5;
  const cols = Math.ceil((arena.maxX - arena.minX) / cell), rows = Math.ceil((arena.maxZ - arena.minZ) / cell);
  const mask = new Uint8Array(cols * rows);
  const out = rects.map(([minX, minZ, maxX, maxZ]) => ({ minX, minZ, maxX, maxZ }));
  for (const r of out) {
    for (let iz = 0; iz < rows; iz++) for (let ix = 0; ix < cols; ix++) {
      const x = arena.minX + (ix + 0.5) * cell, z = arena.minZ + (iz + 0.5) * cell;
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) mask[iz * cols + ix] = 1;
    }
  }
  return { minX: arena.minX, minZ: arena.minZ, cols, rows, cell, mask, rects: out };
}

/**
 * 摆场景道具（导航按碰撞盒 / 熔岩重建）：
 *   { kind: 'box', min: [x, y, z], max: [x, y, z] }         高台、矮墙、可攀爬的边缘
 *   { kind: 'pillar', at: [x, z], height, size }           栖柱（三青鸟 / 毕方落脚，顶面要在 1.4–7 米）
 *   { kind: 'lava', rects: [[minX, minZ, maxX, maxZ], …] }  熔岩地面（火鼍潜游、回熔）
 *   { kind: 'fire', at: [x, z], radius, seconds }           地火（FireFeed 登记，祸斗吃火）
 *   { kind: 'ally', id, at: [x, z], hp, frozen }            友军桩（辅助型施法对象；hp = 剩余比例；frozen = 不跑 AI）
 */
function applyProps(ctx, props = []) {
  let navDirty = false;
  const lava = [];
  const allies = [];
  for (const p of props) {
    switch (p.kind) {
      case 'box':
        ctx.world.addBox(p.min[0], p.min[1], p.min[2], p.max[0], p.max[1], p.max[2], p.tag ?? 'wall');
        navDirty = true;
        break;
      case 'pillar': {
        const s = (p.size ?? 1.2) / 2, [x, z] = p.at;
        ctx.world.addBox(x - s, 0, z - s, x + s, p.height ?? 3, z + s, 'wall');
        navDirty = true;
        break;
      }
      case 'lava':
        lava.push(...p.rects);
        break;
      case 'fire':
        registerFloorFire(ctx, new THREE.Vector3(p.at[0], 0, p.at[1]), p.radius ?? 1.2, p.seconds ?? 600);
        break;
      case 'ally':
        allies.push(p);
        break;
      default:
        throw new Error(`未知的场景道具 ${p.kind}`);
    }
  }
  if (lava.length) {
    const L = makeLava(ctx.stage.arena, lava);
    ctx.stage.lavaSystem = { lava: L };
    ctx.nav.setLava(L);
    navDirty = true;
  }
  if (navDirty) ctx.nav.build(ctx.stage.arena, 0.5);
  return allies;
}

function spawnAllies(ctx, allies) {
  return allies.map((p) => {
    const a = spawn(ctx, p.id, new THREE.Vector3(p.at[0], 0, p.at[1]));
    if (p.hp !== undefined && 'hp' in a && 'maxHp' in a) a.hp = a.maxHp * p.hp;
    if (p.frozen) a.think = () => {};
    return a;
  });
}

// ── 采样 ──
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

function bonesOf(model) {
  const out = [];
  model.traverse((o) => { if (o.isBone) out.push(o); });
  return out;
}

/** 骨骼名：部件骨架（Boss 的程序化模型）用关节路径名（PartsRig.jointPaths），原生骨架用节点名 */
function boneNames(body) {
  return body.__joints ? body.__jointNames : bonesOf(body.__model).map((b) => b.name);
}

/** 要记录的节点：全部骨骼 + 挂点（非骨骼的命名节点，如琵琶挂点 / 英雄持枪点；追加在后面，数据里 sockets 记名字） */
function tracked(body) {
  return [...(body.__joints ?? bonesOf(body.__model)), ...(body.__sockets ?? [])];
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
  if (!entry) throw new Error(`游戏里没有注册 ${defId}`);
  const e = entry.factory(ctx, { position: pos.clone() });
  e.init();
  e.onGround = true;
  ctx.enemies.list.push(e);
  return e;
}

/**
 * 推进 seconds 秒，每 SAMPLE_EVERY 帧采一次；beforeStep 可在每帧推进前改场景（如追着怪移动玩家）。
 * 场上其他敌人（友军桩）同步推进；label 可以给帧起别的状态名（叠在状态上的演出）
 */
function record(ctx, e, body, seconds, beforeStep, label) {
  const bones = tracked(body);
  const out = [];
  const host = body.pose.host ?? body.__model.parent;
  const frames = Math.round(seconds / SIM_DT);
  for (let i = 0; i < frames; i++) {
    beforeStep?.(i);
    for (const o of ctx.enemies.list) if (o !== e && !o.removed) o.update(SIM_DT);
    ctx.time.now += SIM_DT;
    ctx.time.frame++;
    const p = ctx.player.position;
    ctx.player.eye.set(p.x, p.y + 1.6, p.z);
    if (!e.removed) e.update(SIM_DT);
    ctx.tasks.update(SIM_DT);
    if (i % SAMPLE_EVERY === 0) {
      const v = e.velocity ?? new THREE.Vector3();
      out.push({ state: label?.(e) ?? e.state, speed: Math.hypot(v.x, v.z), rootY: (e.root ?? e.object ?? host).position.y, pose: sample(host, bones),
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

/**
 * 按状态把录到的帧切成片段。o：
 *   firstComplete  第一段是完整的（强制场景：start 刚把状态切进去）；自然场景的第一段从中间开始，不要
 *   capture / override / loops / inPlace  见文件头
 * 返回本次新收的状态名
 */
function harvest(frames, clips, seen, o = {}) {
  const took = [];
  for (let i = 0, j = 0; i < frames.length; i = j) {
    j = i + 1;
    while (j < frames.length && frames[j].state === frames[i].state) j++;
    const st = frames[i].state;
    if (!st || took.includes(st)) continue;
    if (o.capture && !o.capture.includes(st)) continue;
    if (seen.has(st) && !o.override?.includes(st)) continue;
    if (i === 0 && !o.firstComplete) continue; // 段首不完整
    const loop = o.loops?.[st];
    let clip;
    if (loop) {
      const seg = frames.slice(i, j);
      const l = findLoop(seg, Math.min(Math.round(0.3 * FPS), Math.max(0, seg.length - Math.round(loop[0] * FPS) - 1)), loop[0], loop[1]);
      if (!l) continue;
      clip = clipFrom(seg, l.a, l.b, true);
    } else {
      const n = j - i;
      // 最短 0.12 秒：交叉斩的出刀段只有 0.14 秒
      if (n < 0.12 * FPS || n > (o.maxS ?? 8) * FPS) continue;
      clip = clipFrom(frames, i, j, false);
      // 紧跟着的状态：Unity 状态机按它把 windup → 出招 → 收招串成连段
      if (j < frames.length && frames[j].state !== st) clip.next = frames[j].state;
    }
    if (o.inPlace) clip.rootY = clip.rootY.map(() => 0);
    clips[st] = clip;
    seen.add(st);
    took.push(st);
  }
  return took;
}

/** 玩家站位：{ dist, angle, facing, y }（每帧跟着本体；facing = 角度相对本体朝向）、{ at }（固定）或函数 */
function placePlayer(ctx, e, spec, api, i) {
  if (!spec) return;
  if (typeof spec === 'function') { spec(e, api, i); return; }
  if (spec.at) { ctx.player.position.set(spec.at[0], spec.at[1] ?? 0, spec.at[2]); return; }
  const pos = e.root.position;
  const a = (spec.angle ?? 0) + (spec.facing ? e.facing ?? 0 : 0);
  ctx.player.position.set(pos.x + Math.sin(a) * spec.dist, spec.y ?? 0, pos.z + Math.cos(a) * spec.dist);
}

function bakeEnemy(defId, asset, cfg) {
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
  const idleState = cfg.idleState;

  // 1) 待机：关掉 AI，速度清零，原地站立（idleState 指定的状态，或有 idle 就用它）
  {
    attackDirector.reset?.();
    const ctx = makeContext(variant);
    ctx.player.position.set(0, 0, 40);
    const { e, body } = subject(ctx, new THREE.Vector3(0, 0, 0));
    bones = boneNames(body);
    sockets = body.__sockets.map((o) => o.name);
    socketScale = socketScales(body.pose.host ?? body.__model.parent, body.__sockets);
    // 静止姿势：attach 之后、任何动画之前
    rest = sample(body.pose.host ?? body.__model.parent, tracked(body));
    record(ctx, e, body, 1.5); // 出生动画
    e.think = () => {};
    e.velocity?.set(0, 0, 0);
    if (idleState) e.state = idleState;
    else if (Object.getPrototypeOf(e).constructor.toString().includes("'idle'")) e.state = 'idle';
    e.stateTime = 0;
    const maxLoop = cfg.idleLoopMax ?? 4;
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
    const moveState = cfg.moveState ?? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
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
  const seen = new Set(['Idle', 'Walk', 'Move', 'Hit', clips.Move?.sourceState, idleState, 'move', 'chase', 'advance', ...(cfg.locomotion ?? [])]);
  const nat = cfg.natural ?? {};
  for (const dist of nat.dists ?? [3, 7, 12, 1.2]) {
    attackDirector.reset?.();
    const ctx = makeContext(variant);
    const allies = applyProps(ctx, nat.props);
    ctx.player.position.set(0, 0, dist);
    const { e, body } = subject(ctx, new THREE.Vector3(0, 0, 0));
    spawnAllies(ctx, allies);
    for (const [ally, n] of nat.allies ?? []) {
      for (let k = 0; k < n; k++) {
        const a = spawn(ctx, ally, new THREE.Vector3(k % 2 ? 2 : -2, 0, 2));
        if ('hp' in a && 'maxHp' in a) a.hp = a.maxHp * 0.6; // 有人受伤，治疗类法术才会放
      }
    }
    const frames = record(ctx, e, body, nat.seconds ?? 18, () => {
      // 玩家站在怪正前方固定距离（怪移动时跟着），出招能完整走完
      const pos = e.root.position;
      ctx.player.position.set(pos.x, 0, pos.z + dist);
      if (e.cooldown !== undefined) e.cooldown = Math.min(e.cooldown, 1.5);
    });
    harvest(frames, clips, seen);
  }

  // 4) 强制场景：每个资产自己的配置（bake/<资产>.mjs）
  for (const sc of cfg.scenes ?? []) {
    attackDirector.reset?.();
    const ctx = makeContext(sc.theme ?? variant);
    const allyProps = applyProps(ctx, sc.props);
    const at = sc.at ?? [0, 0, 0];
    ctx.player.position.set(0, 0, 8);
    const { e, body } = subject(ctx, new THREE.Vector3(at[0], at[1] ?? 0, at[2]));
    const api = { ctx, THREE, player: ctx.player, subject: e, allies: spawnAllies(ctx, allyProps), spawn: (id, p) => spawn(ctx, id, new THREE.Vector3(p[0], p[1] ?? 0, p[2])) };
    const follow = (i) => placePlayer(ctx, e, sc.player, api, i);
    const warm = sc.warmup ?? 1.5;
    if (warm > 0) record(ctx, e, body, warm, (i) => { follow(i); sc.warmStep?.(e, api, i); });
    try {
      if (typeof sc.start === 'string') e[sc.start]();
      else sc.start?.(e, api);
    } catch (err) {
      notes.push(`场景 ${sc.name ?? '?'} 的 start 出错：${err.message}`);
      continue;
    }
    const frames = record(ctx, e, body, sc.seconds ?? 6, (i) => { follow(i); sc.step?.(e, api, i); }, sc.label);
    const took = harvest(frames, clips, seen, { firstComplete: true, capture: sc.capture, override: sc.override, loops: sc.loops, inPlace: sc.inPlace, maxS: sc.maxS });
    if (process.env.BAKE_VERBOSE) {
      const seq = [];
      for (const f of frames) if (seq[seq.length - 1] !== f.state) seq.push(f.state);
      console.log(`  [${sc.name ?? '?'}] ${seq.join(' → ')}  收 ${took.join(',') || '—'}`);
    }
  }
  for (const st of cfg.expect ?? []) {
    if (!clips[st]) notes.push(`缺 ${st}${cfg.skip?.[st] ? `：${cfg.skip[st]}` : '：采样没进入这个状态'}`);
  }
  globalThis.__bakeAttached = null;
  return { bones, sockets, socketScale, rest, clips, notes };
}

// ── Boss：两形态、setAnim 驱动（KunPeng.ts / Qilin.ts 的 animateKun / animatePeng / animateBody）──
/**
 * Boss 的 AI 招式编排复杂（召唤、场地机关、形态切换），这里不跑 AI：直接切形态、逐个 setAnim(名) 播放并采样。
 * 各动作的姿势参数在 Boss 代码里按 lam 平滑逼近目标，所以每段都从待机自然过渡过去（与游戏里一致）。
 * 招式没有游戏事件（不跑 AI），出手时刻由 <资产>.events.json 叠加表补（NativeClipBuilder 写成动画事件）。
 * gait：火麒麟的步态频率取实际水平速度，Walk / Move 采样时让它以给定速度前进。
 * 每个形态一份配置 bake/<资产>.mjs（boss = Boss 的敌人 id，同一个 Boss 的各形态按 Boss 归组、共用一次出生）。
 */
let bossesRegistered = false;
async function bakeBoss(bossId, forms) {
  if (!bossesRegistered) {
    const { registerBosses } = await import('../../src/enemies/bosses/index.ts');
    registerBosses();
    bossesRegistered = true;
  }
  const results = {};
  for (const f of forms) {
    const bodies = {};
    globalThis.__bakeAttached = (body, o) => { bodies[o.defId] = body; };
    // 部件骨架的 Boss（熔心魔将）：让 EnemyArt 桩按清单的骨架指纹把程序化模型的关节交出来。
    // PartsRig 在这里才 import：模块初始化会消耗固定种子的随机数，放在前面会让所有敌人的采样跟着变
    globalThis.__bakeParts = f.parts ? { jointPaths: (await import('../../src/assets/PartsRig.ts')).jointPaths } : null;
    attackDirector.reset?.();
    const ctx = makeContext(f.theme ?? 'beiming');
    ctx.ui = lenient({});
    ctx.player.position.set(0, 0, 25);
    const e = spawn(ctx, bossId, new THREE.Vector3(0, 0, 0));
    globalThis.__bakeAttached = null;
    globalThis.__bakeParts = null;
    const body = bodies[f.defId];
    if (!body) throw new Error(`${bossId}: 形态 ${f.form ?? '-'} 没挂上骨架 ${f.defId}`);
    body.__sockets = [];
    const host = body.pose.host ?? body.__model.parent;
    const bones = boneNames(body);
    // 部件骨架的静止姿势由桩在挂上时（登场演出之前）取好
    const rest = body.__restSample ?? sample(host, tracked(body));
    e.think = () => {};
    if (f.form) e.useForm?.(f.form);
    const clips = {};
    const play = (name, seconds, move = 0) => {
      e.setAnim(name, true);
      return record(ctx, e, body, seconds, () => {
        if (move) { e.position.z += move * SIM_DT; ctx.player.position.set(e.position.x, 0, e.position.z + 25); }
      });
    };
    const idle = f.idle ?? 'idle';
    play(idle, 2);
    const idleFrames = play(idle, 9);
    const loop = findLoop(idleFrames, Math.round(1.5 * FPS), 2, 6);
    if (loop) clips.Idle = clipFrom(idleFrames, loop.a, loop.b, true);
    for (const [name, speed] of f.gait ?? []) {
      let g;
      if (f.gaitBy === 'velocity') {
        // 步态按 velocity 算的（熔心魔将）：让它自己按 setMove 走（积分出真实速度），玩家在前方跟着
        e.think = () => e.setMove(0, 1, speed);
        e.facing = 0;
        const walk = (s) => record(ctx, e, body, s, () => { e.facing = 0; ctx.player.position.set(e.position.x, 0, e.position.z + 25); });
        e.setAnim(idle, true);
        walk(1.5);
        g = walk(5);
        e.think = () => {};
        e.velocity.set(0, 0, 0);
      } else {
        play(idle, 1.5, speed);
        g = play(idle, 5, speed);
      }
      const gl = findLoop(g, Math.round(1 * FPS), 0.4, 2.5);
      if (gl) { clips[name] = clipFrom(g, gl.a, gl.b, true); clips[name].speed = speed; }
    }
    for (const a of f.acts) {
      play(idle, 1.2); // 每招都从待机姿势起
      // 连段后半（猛砸、扑咬、破冰）在游戏里是从前一段的姿势接过去的：先把前一段放够它在游戏里的时长（不录），再录这一段
      const lead = f.lead?.[a];
      if (lead) play(lead[0], lead[1]);
      const frames = play(a, f.seconds?.[a] ?? 2.4);
      clips[a] = clipFrom(frames, 0, frames.length, false);
      if (f.next?.[a]) clips[a].next = f.next[a];
    }
    results[f.asset] = { bones, sockets: [], socketScale: {}, rest, clips, notes: [] };
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
/** 每个资产的采样配置（bake/<资产 ID>.mjs；下划线开头的是共用工具，不是配置） */
const configs = {};
for (const f of readdirSync(fileURLToPath(BAKE_DIR)).filter((n) => n.endsWith('.mjs') && !n.startsWith('_')).sort()) {
  configs[f.replace(/\.mjs$/, '')] = (await import(new URL(f, BAKE_DIR).href)).default ?? {};
}
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
    write(t, bakeEnemy(t.defId, { id: t.id, entry: t.entry }, configs[t.id] ?? {}), t0);
  } catch (err) {
    failed++;
    console.log(`${t.id}: ✘ ${err.stack?.split(String.fromCharCode(10)).slice(0, 4).join(' | ')}`);
  }
}
// Boss：按 Boss 归组（同一个 Boss 的各形态一次出生），每个形态写一份
const bossGroups = {};
for (const [asset, c] of Object.entries(configs)) {
  if (!c.boss) continue;
  if (want.length && !want.includes(c.boss) && !want.includes(c.defId) && !want.includes(asset)) continue;
  (bossGroups[c.boss] ??= []).push({ ...c, asset });
}
for (const [bossId, forms] of Object.entries(bossGroups)) {
  try {
    const t0 = Date.now();
    const r = await bakeBoss(bossId, forms);
    for (const [id, res] of Object.entries(r)) write({ id, defId: bossId }, res, t0);
  } catch (err) {
    failed++;
    console.log(`${bossId}: ✘ ${err.stack?.split(String.fromCharCode(10)).slice(0, 5).join(' | ')}`);
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
