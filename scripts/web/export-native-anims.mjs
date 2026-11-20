// 采样动画（native-anim）→ 网页动画片段：public/assets/anim/<资产>.json + manifest.json。不需要 Unity。
//
//   node scripts/web/export-native-anims.mjs                    全部
//   node scripts/web/export-native-anims.mjs SK_Enemy_Fuzhu     只转这几个
//   node scripts/web/export-native-anims.mjs --check            只核对发布的文件是不是由当前源数据生成的（不写）
//   --unity <目录>   Unity 工程目录（默认本仓库的 unity/；在 git worktree 里、本仓库没有 native-anim 时退到主工作区的 unity/）
//
// 输入（每个资产 unity/Assets/Art/Characters/<资产>/Anim/）：
//   <资产>.native-anim.json   scripts/unity/bake-native-anims.mjs 在 Node 里跑网页敌人代码逐帧采的骨骼姿势（模型空间，30 fps，
//                             不入库、可再生成）
//   <资产>.events.json        事件叠加表（入库，手写）：补事件 / 替换事件 / 改连段 next、循环 loop、录制速度 speed
//   AC_<资产>.controller      Unity 状态机（入库）：网页 AnimatorStateMachine 照它的拓扑与转换时长跑，不另写一份
//   *.anim.meta               片段 guid → 片段名（控制器里按 guid 引用片段）
//   Keyframed/*.fbx.meta      Unity 用 Blender 手 K 片段替换了哪些状态（这些状态网页暂用采样片段，清单里标出来）
//   public/assets/characters/<资产>.glb   绑定骨架（节点层级与静止 TRS；和 Unity 那份 FBX 是同一个源 GLB）
//
// 换算照 Unity 的 NativeClipBuilder（去掉 glTF → Unity 的 X 镜像，网页本来就在 glTF 空间）：
//   朝向  W = q(t) · q_rest⁻¹ · R_bind   （模型空间增量乘到 GLB 绑定朝向上；49/53 个资产两份静止姿势逐位相同，增量 = 绝对值）
//   位置  P = p(t) + (0, rootY(t), 0)     （采样的绝对位置；rootY = 离地高度，与 Unity 一样加在每根骨骼上，子骨骼按父骨骼抵消）
//   局部  L = W_parent⁻¹ · W            （父节点不在采样里的——如 <资产>_Rig——取 GLB 静止矩阵）
//   挂点（琵琶、镜、壳、英雄持枪点）不是 GLB 节点：建成模型根下的 socket_<名>，局部 = 采样的模型空间。
//   受击叠加片段 Flinch = 待机第 0 帧 + Hit 全部帧（与 Unity 一样，叠加层以第 0 帧为参考姿势），事件清空。
//
// 输出格式（每个资产一份 JSON；数组用 base64 的小端类型化数组）：
//   nodes   被动画驱动的节点名（GLB 原名，父节点在前；socket_* 在后）
//   sockets [{ name, rest: [qx,qy,qz,qw,px,py,pz], scale }]
//   clips   { 状态: { frames, duration, loop, next?, speed?, unity?, derived?, events: [{ t, name, f? }],
//                     tracks: [[节点序号, 'q' | 'p', 帧序号 Uint16 | null（每帧都有）, 数值]] } }
//           朝向 Int16（×32767），位置 Float32。关键帧按 Unity Reduce 的贪心规则精简，容差收紧到朝向分量 0.0005、位置 0.0003 m
//           （Unity 用 0.0015 / 0.0008：长尾巴梢端累积到 1.5 cm；收紧后全量 3.5 MB、最大误差约 4 mm / 0.6°），
//           资产里任何一个片段动过的骨骼，每个片段都写（不动的写 1 帧），切换片段时不会落回别的片段的姿势
//   controller  AC_<资产>.controller 读出来的参数 / 层 / 状态 / 转换 / 混合树
//
// 为什么不嵌进 GLB：角色 GLB 是美术管线的产物（Unity 的 *.art.json 记着它们的哈希，350/350 对得上），
// 往里塞动画会让每次重采样都改一遍 1–2 MB 的模型文件；事件、连段、状态机也没有 glTF 的标准位置。单独的 JSON 小、可读、可核对。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { readAnimatorController, readMetaGuid } from './unity-yaml.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(ROOT, 'public/assets/anim');
const ROT_TOL = 0.0005;
const POS_TOL = 0.0003;
const ROT_MOVES_DEG = 0.05;
const POS_MOVES_SQ = 1e-8;

// ───────────── 参数 ─────────────
const args = process.argv.slice(2);
const check = args.includes('--check');
let unityArg = null;
const want = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--unity') unityArg = args[++i];
  else if (!args[i].startsWith('--')) want.push(args[i]);
}

/** 主工作区：本仓库是 git worktree 时 .git 是个文件（gitdir: <主仓库>/.git/worktrees/<名>） */
function mainCheckout() {
  const dotGit = join(ROOT, '.git');
  if (!existsSync(dotGit)) return null;
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
    if (!m) return null;
    return resolve(m[1].trim(), '../../..');
  } catch {
    return null; // .git 是目录：本身就是主工作区
  }
}

const hasNative = (unityDir) => {
  const chars = join(unityDir, 'Assets/Art/Characters');
  return existsSync(chars) && readdirSync(chars).some((id) => existsSync(join(chars, id, 'Anim', `${id}.native-anim.json`)));
};

function pickUnityDir() {
  if (unityArg) return resolve(unityArg);
  const own = join(ROOT, 'unity');
  if (hasNative(own)) return own;
  const main = mainCheckout();
  if (main && hasNative(join(main, 'unity'))) return join(main, 'unity');
  throw new Error('找不到 *.native-anim.json（不入库，先跑 scripts/unity/bake-native-anims.mjs，或用 --unity 指定 Unity 工程目录）');
}

// ───────────── GLB ─────────────
function readGlbJson(path) {
  const b = readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} 不是 GLB`);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

/** GLB 场景层级：每个节点的父节点、先序序号、静止局部 / 世界矩阵 */
function glbHierarchy(doc) {
  const parent = new Map();
  doc.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const order = new Map();
  const local = doc.nodes.map((n) => {
    const m = new THREE.Matrix4();
    if (n.matrix) m.fromArray(n.matrix);
    else m.compose(new THREE.Vector3().fromArray(n.translation ?? [0, 0, 0]), new THREE.Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]), new THREE.Vector3().fromArray(n.scale ?? [1, 1, 1]));
    return m;
  });
  const world = new Array(doc.nodes.length);
  const visit = (i, pw) => {
    order.set(i, order.size);
    world[i] = pw ? pw.clone().multiply(local[i]) : local[i].clone();
    for (const c of doc.nodes[i].children ?? []) visit(c, world[i]);
  };
  for (const r of doc.scenes[doc.scene ?? 0].nodes) visit(r, null);
  // 名字 → 节点：GLTFLoader 按名字绑定曲线时取先序遍历第一个，这里同样取先序最靠前的
  const byName = new Map();
  [...order.entries()].sort((a, b) => a[1] - b[1]).forEach(([i]) => {
    const name = doc.nodes[i].name;
    if (name !== undefined && !byName.has(name)) byName.set(name, i);
  });
  return { parent, order, local, world, byName };
}

// ───────────── 关键帧精简（Unity NativeClipBuilder.Reduce 的贪心规则，按整个向量判断）─────────────
/** values: 每帧 stride 个分量；返回保留的帧序号（首尾总保留；整段都在容差内只留第 0 帧） */
function reduceKeys(values, stride, n, tol) {
  let constant = true;
  for (let f = 1; f < n && constant; f++) for (let c = 0; c < stride; c++) if (Math.abs(values[f * stride + c] - values[c]) > tol) { constant = false; break; }
  if (constant) return [0];
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const kept = [0];
  let anchor = 0;
  for (let i = 1; i < n - 1; i++) {
    let ok = true;
    for (let j = anchor + 1; j <= i && ok; j++) {
      const u = (j - anchor) / (i + 1 - anchor);
      for (let c = 0; c < stride; c++) {
        const a = values[anchor * stride + c], b = values[(i + 1) * stride + c];
        if (Math.abs(a + (b - a) * u - values[j * stride + c]) > tol) { ok = false; break; }
      }
    }
    if (!ok) { kept.push(i); anchor = i; }
  }
  kept.push(n - 1);
  return kept;
}

const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');

// ───────────── 事件叠加表（NativeClipBuilder.OverlayEntry / MergeEvents / ApplyOverlayMeta）─────────────
function overlayEntry(overlay, clip) {
  const tok = overlay[clip];
  if (Array.isArray(tok)) return { events: tok, replace: false, meta: {} };
  if (tok && typeof tok === 'object') return { events: tok.events ?? [], replace: !!tok.replace, meta: tok };
  return { events: [], replace: false, meta: {} };
}

const round = (x, k = 1e5) => Math.round(x * k) / k;

function mergeEvents(id, clip, own, overlay, length, warn) {
  const { events: extra, replace } = overlayEntry(overlay, clip);
  const list = replace ? [] : own.map((e) => ({ t: Math.min(e.t, length), name: e.name }));
  for (const ev of extra) {
    if (!ev?.name || ev.at === undefined) { warn(`${id}: 叠加表 ${clip} 里有缺 name / at 的事件，跳过`); continue; }
    const e = { t: round(Math.min(1, Math.max(0, ev.at)) * length), name: ev.name };
    if (ev.float !== undefined) e.f = ev.float;
    list.push(e);
  }
  // 稳定排序（同一时刻的事件保持原来的先后）
  return list.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map(({ e }) => e);
}

/** Unity StateName：一个文件一个 take 时用文件名；下划线 / 空格转驼峰 */
function stateName(raw) {
  raw = raw.slice(raw.lastIndexOf('|') + 1);
  const parts = raw.split(/[_\s\-.]+/).filter(Boolean);
  if (parts.length === 0) return raw;
  return parts[0] + parts.slice(1).map((s) => s[0].toUpperCase() + s.slice(1)).join('');
}

// ───────────── 单个资产 ─────────────
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _q2 = new THREE.Quaternion();

/** Blender 手 K 片段的中间件（scripts/web/blender-keyframed-dump.py 写；art/source 下的 _tmp 目录不入库，可重新生成） */
const keyframedDumpPath = (id) => join(ROOT, 'art/source/characters', id, 'anim/_tmp', `${id}.keyframed-anim.json`);

/** 资产清单（public/assets/manifest.json）里绑定的 id：只有手 K 片段、没有采样数据的资产（旱魃、商人）拿它当 defId */
function boundDefId(id) {
  try {
    const m = JSON.parse(readFileSync(join(ROOT, 'public/assets/manifest.json'), 'utf8'));
    return m.assets?.[id]?.bind?.id ?? null;
  } catch {
    return null;
  }
}

function exportAsset(unityDir, id, warn) {
  const animDir = join(unityDir, 'Assets/Art/Characters', id, 'Anim');
  const nativePath = join(animDir, `${id}.native-anim.json`);
  const dumpPath = keyframedDumpPath(id);
  const srcText = existsSync(nativePath) ? readFileSync(nativePath, 'utf8') : null;
  const kdText = existsSync(dumpPath) ? readFileSync(dumpPath, 'utf8') : null;
  const native = srcText ? JSON.parse(srcText) : null;
  const kd = kdText ? JSON.parse(kdText) : null;
  // 发布文件里已经有 Blender 片段、这台机器上却没有中间件：别拿采样片段把它们盖回去
  const outFile = join(OUT_DIR, `${id}.json`);
  if (!kd && existsSync(outFile)) {
    try {
      const pub = JSON.parse(readFileSync(outFile, 'utf8'));
      if (Object.values(pub.clips ?? {}).some((c) => c.src === 'blender')) {
        return { keep: `发布文件含 Blender 手 K 片段，本机没有 ${dumpPath.slice(ROOT.length + 1)}（先跑 node scripts/web/export-keyframed-anims.mjs ${id}）：保留原文件` };
      }
    } catch { /* 读不了就照常重导 */ }
  }
  if (!native && !kd) return { skipped: '没有采样数据也没有 Blender 中间件' };
  const sha1 = srcText ? createHash('sha1').update(srcText).digest('hex') : null;
  const glbRel = `assets/characters/${id}.glb`;
  const glbPath = join(ROOT, 'public', glbRel);
  if (!existsSync(glbPath)) return { skipped: `没有 ${glbRel}` };
  const doc = readGlbJson(glbPath);
  const H = glbHierarchy(doc);
  const fps = native?.fps ?? kd.fps;
  if (native && kd && kd.fps !== native.fps) warn(`${id}: Blender 片段 ${kd.fps} fps，采样片段 ${native.fps} fps`);
  if (native) {
    const missing = native.bones.filter((b) => !H.byName.has(b));
    if (missing.length) {
      return { skipped: `GLB 里没有采样骨架的 ${missing.length}/${native.bones.length} 根骨骼（${missing.slice(0, 3).join(', ')}…）：采样之后模型换过骨架，Unity 也接不上这些曲线` };
    }
  }
  if (kd) {
    const missing = kd.bones.filter((b) => !H.byName.has(b));
    if (missing.length) warn(`${id}: Blender 骨架有 ${missing.length} 根骨骼 GLB 里没有（${missing.slice(0, 3).join(', ')}…），这些曲线不要`);
  }
  // 数据源：采样（native-anim）在前；Blender 手 K 同名状态替换采样片段（Unity NativeClipBuilder.CopyKeyframed 同样按状态名覆盖）
  const sources = [];
  if (native) sources.push({ kind: 'native', data: native });
  if (kd) sources.push({ kind: 'blender', data: kd });
  const rows = (src, k) => ({
    q: new THREE.Quaternion(src.data.rest[k * 7], src.data.rest[k * 7 + 1], src.data.rest[k * 7 + 2], src.data.rest[k * 7 + 3]),
    p: new THREE.Vector3(src.data.rest[k * 7 + 4], src.data.rest[k * 7 + 5], src.data.rest[k * 7 + 6]),
  });
  for (const s of sources) s.index = new Map(s.data.bones.map((b, i) => [b, i]));
  const socketNames = native?.sockets ?? [];
  const boneNames = [...new Set(sources.flatMap((s) => s.data.bones))].filter((b) => H.byName.has(b));

  // 驱动对象：骨骼按 GLB 先序（父在前），挂点在后；每个数据源各有自己的序号与静止朝向（Blender 骨骼带自己的轴约定，增量抵消）
  const maps = boneNames.map((name) => {
    const node = H.byName.get(name);
    H.world[node].decompose(_p, _q, _s);
    const src = new Map();
    for (const s of sources) {
      const i = s.index.get(name);
      if (i !== undefined) src.set(s, { index: i, restInv: rows(s, i).q.invert() });
    }
    return {
      name, node, order: H.order.get(node), src,
      bindRot: _q.clone(), worldScale: _s.clone(),
      restLocal: (() => { const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); H.local[node].decompose(p, q, s); return { p, q, s }; })(),
    };
  }).sort((a, b) => a.order - b.order);
  const byNode = new Map(maps.map((m) => [m.node, m]));
  for (const m of maps) {
    // 父链上最近的被驱动骨骼；中间夹着的非驱动节点（极少见）按静止局部矩阵串起来
    let p = H.parent.get(m.node);
    const chain = [];
    while (p !== undefined && !byNode.has(p)) { chain.push(p); p = H.parent.get(p); }
    m.parentMap = p !== undefined ? byNode.get(p) : null;
    // between = 从驱动父骨骼（或场景根）到本骨骼父节点的静止矩阵
    const between = new THREE.Matrix4();
    for (let k = chain.length - 1; k >= 0; k--) between.multiply(H.local[chain[k]]);
    m.between = between;
  }
  const nativeSrc = sources.find((s) => s.kind === 'native');
  const sockets = socketNames.map((name, k) => {
    const index = native.bones.length + k;
    const r = rows(nativeSrc, index);
    return {
      name: `socket_${name}`, node: -1, socket: true, src: new Map([[nativeSrc, { index, restInv: r.q.clone().invert() }]]),
      bindRot: r.q.clone(), worldScale: new THREE.Vector3(1, 1, 1),
      parentMap: null, between: new THREE.Matrix4(),
      restLocal: { p: r.p, q: r.q, s: new THREE.Vector3(1, 1, 1) },
      scale: native.socketScale?.[name] ?? 1,
    };
  });
  const all = [...maps, ...sockets];
  for (const m of all) {
    m.parentIdx = m.parentMap ? all.indexOf(m.parentMap) : -1;
    m.restMatrix = new THREE.Matrix4().compose(m.restLocal.p, m.restLocal.q, m.restLocal.s);
  }
  const IDENTITY = new THREE.Matrix4();

  // 静止姿势偏差（报告用）：采样的静止姿势 vs GLB 绑定姿势；Blender 的只比位置（朝向带骨骼轴约定，不可比）
  let restPosErr = 0, restRotErr = 0, kdRestPosErr = 0;
  for (const m of maps) {
    H.world[m.node].decompose(_p, _q, _s);
    for (const [s, e] of m.src) {
      const r = rows(s, e.index);
      if (s.kind === 'native') {
        restPosErr = Math.max(restPosErr, _p.distanceTo(r.p));
        restRotErr = Math.max(restRotErr, THREE.MathUtils.radToDeg(_q.angleTo(r.q)));
      } else kdRestPosErr = Math.max(kdRestPosErr, _p.distanceTo(r.p));
    }
  }
  if (kd && kdRestPosErr > 0.002) warn(`${id}: Blender 骨架静止位置和 GLB 差 ${kdRestPosErr.toFixed(4)} m`);

  // 片段表：采样片段（被 Blender 同名片段替换的除外）+ Blender 片段 + Flinch（Idle 第 0 帧 + Hit，同一数据源）
  const clipEntries = [];
  const kdClips = kd ? kd.clips : {};
  if (native) for (const [name, c] of Object.entries(native.clips)) clipEntries.push([name, kdClips[name] ? { ...kdClips[name], loop: c.loop, next: c.next, speed: c.speed, events: [] } : c, kdClips[name] ? sources.at(-1) : nativeSrc]);
  if (kd) for (const [name, c] of Object.entries(kdClips)) if (!native?.clips[name]) clipEntries.push([name, { ...c, events: [] }, sources.at(-1)]);
  const idle = clipEntries.find(([n]) => n === 'Idle'), hitClip = clipEntries.find(([n]) => n === 'Hit');
  if (idle && hitClip && idle[2] === hitClip[2]) {
    const hit = hitClip[1];
    clipEntries.push(['Flinch', {
      loop: false,
      frames: [idle[1].frames[0], ...hit.frames],
      rootY: [idle[1].rootY?.[0] ?? 0, ...(hit.rootY ?? hit.frames.map(() => 0))],
      events: [],
      derived: true,
    }, idle[2]]);
  } else if (idle && hitClip) warn(`${id}: Idle / Hit 来自不同数据源，不派生 Flinch`);

  // 事件叠加表、手 K 替换表
  let overlay = {};
  const overlayPath = join(animDir, `${id}.events.json`);
  if (existsSync(overlayPath)) {
    try { overlay = JSON.parse(readFileSync(overlayPath, 'utf8')).clips ?? {}; } catch (e) { warn(`${id}: 事件叠加表读不了（${e.message}），忽略`); }
  }
  const keyDir = join(animDir, 'Keyframed');
  const keyframed = existsSync(keyDir)
    ? [...new Set(readdirSync(keyDir).filter((n) => /\.fbx(\.meta)?$/i.test(n)).map((n) => stateName(n.replace(/\.fbx(\.meta)?$/i, ''))))].sort()
    : [];
  if (kd) for (const k of keyframed) if (!kdClips[k]) warn(`${id}: Unity 有手 K 片段 ${k}，Blender 中间件里没有`);

  // 逐片段、逐帧：模型空间 → 局部
  const n = all.length;
  const perClip = [];
  const rotMoves = new Array(n).fill(false), posMoves = new Array(n).fill(false);
  const W = all.map(() => new THREE.Matrix4());
  const tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
  for (const [name, c, src] of clipEntries) {
    const frames = c.frames;
    const nf = frames.length;
    const rot = all.map(() => new Float64Array(nf * 4));
    const pos = all.map(() => new Float64Array(nf * 3));
    for (let f = 0; f < nf; f++) {
      const fr = frames[f];
      const dy = c.rootY?.[f] ?? 0;
      for (let k = 0; k < n; k++) {
        const m = all[k];
        // 父节点世界矩阵：驱动父骨骼本帧的 / 场景根（单位）；再乘上中间夹着的静止节点
        const parentWorld = _m.copy(m.parentIdx >= 0 ? W[m.parentIdx] : IDENTITY).multiply(m.between);
        const e = m.src.get(src);
        if (e) {
          const i = e.index * 7;
          _q.set(fr[i], fr[i + 1], fr[i + 2], fr[i + 3]).multiply(e.restInv).multiply(m.bindRot);
          tmpP.set(fr[i + 4], fr[i + 5] + dy, fr[i + 6]);
          W[k].compose(tmpP, _q, m.worldScale);
          _inv.copy(parentWorld).invert().multiply(W[k]).decompose(_p, _q2, tmpS);
        } else {
          // 这个数据源不驱动它：保持 GLB 静止局部（跟着父骨骼走）
          W[k].multiplyMatrices(parentWorld, m.restMatrix);
          _p.copy(m.restLocal.p);
          _q2.copy(m.restLocal.q);
        }
        const r = rot[k], o = f * 4;
        // 四元数连续性：与上一帧点积为负就取反
        if (f > 0 && r[o - 4] * _q2.x + r[o - 3] * _q2.y + r[o - 2] * _q2.z + r[o - 1] * _q2.w < 0) _q2.set(-_q2.x, -_q2.y, -_q2.z, -_q2.w);
        r[o] = _q2.x; r[o + 1] = _q2.y; r[o + 2] = _q2.z; r[o + 3] = _q2.w;
        pos[k][f * 3] = _p.x; pos[k][f * 3 + 1] = _p.y; pos[k][f * 3 + 2] = _p.z;
        if (!rotMoves[k] && THREE.MathUtils.radToDeg(_q2.angleTo(m.restLocal.q)) > ROT_MOVES_DEG) rotMoves[k] = true;
        if (!posMoves[k] && _p.distanceToSquared(m.restLocal.p) > POS_MOVES_SQ) posMoves[k] = true;
      }
    }
    perClip.push({ name, c, nf, rot, pos, src });
  }

  // 被驱动的节点（任何片段动过）：每个片段都写
  const driven = all.map((m, k) => ({ m, k })).filter(({ k }) => rotMoves[k] || posMoves[k]);
  const nodes = driven.map(({ m }) => m.name);
  const clips = {};
  let keyCount = 0, frameCount = 0;
  for (const { name, c, nf, rot, pos, src } of perClip) {
    const length = Math.max(0, (nf - 1) / fps);
    const tracks = [];
    driven.forEach(({ k }, ni) => {
      if (rotMoves[k]) {
        const keys = reduceKeys(rot[k], 4, nf, ROT_TOL);
        const v = new Int16Array(keys.length * 4);
        keys.forEach((f, j) => {
          _q.fromArray(rot[k], f * 4).normalize();
          v[j * 4] = Math.round(_q.x * 32767); v[j * 4 + 1] = Math.round(_q.y * 32767); v[j * 4 + 2] = Math.round(_q.z * 32767); v[j * 4 + 3] = Math.round(_q.w * 32767);
        });
        tracks.push([ni, 'q', keys.length === nf ? null : b64(Uint16Array.from(keys)), b64(v)]);
        keyCount += keys.length;
      }
      if (posMoves[k]) {
        const keys = reduceKeys(pos[k], 3, nf, POS_TOL);
        const v = new Float32Array(keys.length * 3);
        keys.forEach((f, j) => { v[j * 3] = pos[k][f * 3]; v[j * 3 + 1] = pos[k][f * 3 + 1]; v[j * 3 + 2] = pos[k][f * 3 + 2]; });
        tracks.push([ni, 'p', keys.length === nf ? null : b64(Uint16Array.from(keys)), b64(v)]);
        keyCount += keys.length;
      }
    });
    frameCount += nf;
    const ov = overlayEntry(overlay, name).meta;
    const clip = {
      frames: nf,
      duration: round(length),
      loop: !!(ov.loop ?? c.loop),
    };
    const next = ov.next ?? c.next;
    if (next) clip.next = next;
    const speed = ov.speed ?? c.speed;
    if (speed !== undefined) clip.speed = speed;
    if (c.derived) clip.derived = 'Hit';
    if (keyframed.includes(name)) clip.unity = 'keyframed';
    if (src.kind === 'blender' && !c.derived) clip.src = 'blender';
    // 根节点离地高度（已经烘进上面的骨骼位置，同 Unity）：另外单独记一份，玩法自己抬降根节点的敌人原地播放时减回去
    if (c.rootY?.some((y) => Math.abs(y) > 0.005)) clip.rootY = b64(Float32Array.from(c.rootY));
    clip.events = mergeEvents(id, name, c.events ?? [], overlay, length, warn);
    clip.tracks = tracks;
    clips[name] = clip;
  }
  for (const k of Object.keys(overlay)) if (!clips[k] && !keyframed.includes(k)) warn(`${id}: 叠加表里的状态 ${k} 没有片段，忽略`);

  // 状态机：AC_<资产>.controller
  let controller = null;
  const acPath = join(animDir, `AC_${id}.controller`);
  if (existsSync(acPath)) {
    const guidToClip = new Map();
    for (const f of readdirSync(animDir).filter((x) => x.endsWith('.anim.meta'))) {
      const guid = readMetaGuid(readFileSync(join(animDir, f), 'utf8'));
      const clip = f.replace(/\.anim\.meta$/, '');
      if (guid) guidToClip.set(guid, clip.startsWith(`${id}_`) ? clip.slice(id.length + 1) : clip);
    }
    const { unknownClips, ...ac } = readAnimatorController(readFileSync(acPath, 'utf8'), guidToClip);
    if (unknownClips.length) warn(`${id}: 控制器引用了 ${unknownClips.length} 个找不到 .meta 的片段`);
    controller = ac;
  } else warn(`${id}: 没有 AC_${id}.controller，状态机按 NativeClipBuilder 的规则现搭（网页运行时 buildDefaultController）`);

  // 控制器里有、网页没片段的状态：只有手 K（Blender）来源，等 GLB 导出
  const used = new Set();
  for (const l of controller?.layers ?? []) for (const s of l.states) {
    if (s.motion?.clip) used.add(s.motion.clip);
    for (const ch of s.motion?.blend?.children ?? []) if (ch.clip) used.add(ch.clip);
  }
  const pending = [...used].filter((x) => !clips[x]).sort();

  const out = {
    schema: 1,
    asset: id,
    defId: native ? (native.defId ?? null) : boundDefId(id),
    fps,
    glb: glbRel,
    source: kd ? { sha1, baked: native?.baked ?? null, keyframed: createHash('sha1').update(kdText).digest('hex'), script: kd.script ?? null } : { sha1, baked: native.baked ?? null },
    moveSpeed: overlayEntry(overlay, 'Move').meta.speed ?? native?.clips.Move?.speed ?? 0,
    nodes,
    sockets: sockets.map((s) => ({ name: s.name, rest: [...s.restLocal.q.toArray(), ...s.restLocal.p.toArray()].map((x) => round(x)), scale: s.scale })),
    clips,
    controller,
  };
  return {
    doc: out,
    info: {
      defId: out.defId,
      clips: Object.keys(clips).length,
      nativeClips: Object.values(clips).filter((c) => !c.derived && c.src !== 'blender').length,
      ...(kd ? { blenderClips: Object.values(clips).filter((c) => c.src === 'blender').length } : {}),
      eventClips: Object.values(clips).filter((c) => !c.derived && c.events.length).length,
      events: Object.values(clips).reduce((a, c) => a + c.events.length, 0),
      keyframed: Object.keys(clips).filter((k) => clips[k].unity === 'keyframed'),
      pending,
      restDeviation: { pos: round(restPosErr, 1e4), rotDeg: round(restRotErr, 1e2), ...(kd ? { blenderPos: round(kdRestPosErr, 1e4) } : {}) },
      keys: keyCount,
      frames: frameCount,
    },
  };
}

// ───────────── 主流程 ─────────────
const unityDir = pickUnityDir();
const charsDir = join(unityDir, 'Assets/Art/Characters');
// 有采样数据（native-anim）或有 Blender 手 K 中间件（旱魃、商人只有后者）的资产；发布过 Blender 片段的资产即使本机没有中间件也列进来（保留原文件）
const publishedBlender = (id) => {
  try { return Object.values(JSON.parse(readFileSync(join(OUT_DIR, `${id}.json`), 'utf8')).clips ?? {}).some((c) => c.src === 'blender'); } catch { return false; }
};
const ids = readdirSync(charsDir).filter((id) => existsSync(join(charsDir, id, 'Anim', `${id}.native-anim.json`)) || existsSync(keyframedDumpPath(id)) || (existsSync(join(charsDir, id, 'Anim')) && publishedBlender(id))).sort();
const targets = want.length ? ids.filter((id) => want.includes(id)) : ids;
const warnings = [];
const warn = (m) => warnings.push(m);

const manifestPath = join(OUT_DIR, 'manifest.json');
const prevManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
const manifest = { schema: 1, fps: 30, about: 'scripts/web/export-native-anims.mjs 生成；采样片段（native-anim）+ Blender 手 K 片段（export-keyframed-anims.mjs 的中间件，src = blender）+ Unity 状态机。pending = Unity 里只有 Blender 手 K 来源、网页还没有片段的状态', assets: {}, skipped: {}, keyframedOnly: {} };
if (want.length && prevManifest) Object.assign(manifest.assets, prevManifest.assets), Object.assign(manifest.skipped, prevManifest.skipped);

let stale = 0;
/** 发布文件按 LF 比（本机 core.autocrlf = true，检出的 manifest.json 是 CRLF） */
const readLf = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
mkdirSync(OUT_DIR, { recursive: true });
for (const id of targets) {
  const r = exportAsset(unityDir, id, warn);
  if (r.keep) {
    if (prevManifest?.assets?.[id]) manifest.assets[id] = prevManifest.assets[id];
    warn(`${id}: ${r.keep}`);
    console.log(`${id}: 未核对 — ${r.keep}`);
    continue;
  }
  if (r.skipped) {
    manifest.skipped[id] = r.skipped;
    delete manifest.assets[id];
    console.log(`${id}: 跳过 — ${r.skipped}`);
    continue;
  }
  delete manifest.skipped[id];
  const text = JSON.stringify(r.doc);
  const file = join(OUT_DIR, `${id}.json`);
  manifest.assets[id] = { file: `${id}.json`, glb: r.doc.glb, ...r.info, bytes: Buffer.byteLength(text) };
  const old = existsSync(file) ? readLf(file) : null;
  if (old !== text) {
    stale++;
    if (!check) writeFileSync(file, text);
  }
  const i = r.info;
  console.log(`${id}: ${i.nativeClips} 片段${i.blenderClips ? ` + Blender ${i.blenderClips}` : ''}（${i.eventClips} 带事件）${i.keyframed.length ? `  手K替换 ${i.keyframed.join(',')}` : ''}${i.pending.length ? `  待导 ${i.pending.join(',')}` : ''}  ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB  键 ${i.keys}${old === text ? '' : check ? '  ✘ 过期' : '  已写'}`);
}
// 只有手 K 片段、没有采样数据、也还没导过 Blender 中间件的资产
for (const id of readdirSync(charsDir).sort()) {
  if (ids.includes(id)) continue;
  const kd = join(charsDir, id, 'Anim', 'Keyframed');
  if (!existsSync(kd)) continue;
  manifest.keyframedOnly[id] = [...new Set(readdirSync(kd).filter((n) => /\.fbx(\.meta)?$/i.test(n)).map((n) => stateName(n.replace(/\.fbx(\.meta)?$/i, ''))))].sort();
}
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
manifest.assets = sortObj(manifest.assets);
manifest.skipped = sortObj(manifest.skipped);
const vals = Object.values(manifest.assets);
manifest.totals = {
  assets: vals.length,
  nativeClips: vals.reduce((a, x) => a + x.nativeClips, 0),
  eventClips: vals.reduce((a, x) => a + x.eventClips, 0),
  ...(vals.some((x) => x.blenderClips) ? { blenderClips: vals.reduce((a, x) => a + (x.blenderClips ?? 0), 0) } : {}),
  bytes: vals.reduce((a, x) => a + x.bytes, 0),
};
const mtext = JSON.stringify(manifest, null, 1) + '\n';
const oldManifest = existsSync(manifestPath) ? readLf(manifestPath) : null;
if (oldManifest !== mtext) {
  stale++;
  if (!check) writeFileSync(manifestPath, mtext);
}
for (const w of warnings) console.warn(`⚠ ${w}`);
console.log(`源：${unityDir}`);
console.log(`合计 ${manifest.totals.assets} 个资产、${manifest.totals.nativeClips} 个采样片段（${manifest.totals.eventClips} 个带事件）、${(manifest.totals.bytes / 1048576).toFixed(2)} MB；跳过 ${Object.keys(manifest.skipped).length}`);
if (check) {
  console.log(stale ? `✘ ${stale} 个文件和源数据对不上，重新跑一遍导出` : '✔ 发布的动画与源数据一致');
  process.exitCode = stale ? 1 : 0;
}
