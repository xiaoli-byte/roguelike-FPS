// bake-pet-anims.mjs 的工具：骨架来源（发布 GLB / 构建导出 GLB / 骨骼表 JSON）、逐帧采样、片段打包、校验报告。
// 采样格式与 bake-native-anims.mjs 完全一致（模型空间 [qx,qy,qz,qw,px,py,pz]，面朝 +Z、X = 生物左、Y = 上），
// 下游 NativeClipBuilder / CreatureRig 不用改。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const { NativePose } = await import('../../src/assets/NativeRig.ts');

export const ROOT = new URL('../../', import.meta.url);
export const rootPath = (rel) => fileURLToPath(new URL(rel, ROOT));

// ───────────── 骨架来源 ─────────────

function readGlbJson(file) {
  const b = readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: 不是 GLB`);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

/** 按 GLB 场景节点重建层级（同 stubs/EnemyArt.mjs buildSkeleton）：蒙皮关节建 Bone，其余节点建 Object3D，网格节点跳过 */
export function skeletonFromGlb(file) {
  const doc = readGlbJson(file);
  const joints = new Set((doc.skins ?? []).flatMap((s) => s.joints));
  if (joints.size === 0) throw new Error(`${file}: 没有蒙皮骨骼`);
  const model = new THREE.Group();
  model.name = 'Scene';
  const make = (i, parent) => {
    const n = doc.nodes[i];
    if (n.mesh !== undefined && !joints.has(i)) return;
    const o = joints.has(i) ? new THREE.Bone() : new THREE.Object3D();
    o.name = n.name ?? `node_${i}`;
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    parent.add(o);
    for (const c of n.children ?? []) make(c, o);
  };
  for (const r of doc.scenes[doc.scene ?? 0].nodes) make(r, model);
  return model;
}

/**
 * 骨骼表（art/pipeline/creature_rigs/<ID>.json，Blender 米制：前 = −Y、左 = +X、上 = +Z）→ 骨架。
 * 只有关节位置、朝向全取单位四元数——采样数据里的转动是「模型空间增量」，位置是绝对值，都与骨骼局部轴向无关，
 * 所以除了 rest 里的四元数，输出与真实导出 GLB 一致（预览用：真实输出请用发布 / 导出的 GLB）。
 */
export function skeletonFromRigJson(file, assetId = 'Rig') {
  const rig = JSON.parse(readFileSync(file, 'utf8'));
  const bones = rig.bones;
  if (!bones) throw new Error(`${file}: 没有 bones 表（旧格式 keep/add 的骨骼表不支持）`);
  const gl = (h) => new THREE.Vector3(h[0], h[2], -h[1]);
  const model = new THREE.Group();
  model.name = 'Scene';
  const rigNode = new THREE.Object3D();
  rigNode.name = `${assetId}_Rig`;
  model.add(rigNode);
  const made = new Map();
  const make = (name) => {
    if (made.has(name)) return made.get(name);
    const def = bones[name];
    const b = new THREE.Bone();
    b.name = name;
    const parent = def.parent ? make(def.parent) : rigNode;
    const ph = def.parent ? gl(bones[def.parent].head) : new THREE.Vector3();
    b.position.copy(gl(def.head)).sub(ph);
    parent.add(b);
    made.set(name, b);
    return b;
  };
  for (const name of Object.keys(bones)) make(name);
  return model;
}

/** 构建导出的最新版本：art/source/characters/<ID>/04_export/<ID>_native_vNNN.glb（不含 _hi 高清版） */
export function latestExport(id) {
  const re = new RegExp(`^${id}_native_v(\\d+)\\.glb$`);
  let best = null;
  for (const dir of [`art/source/characters/${id}/04_export`, `art/source/pets/${id}/04_export`]) {
    const abs = rootPath(dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      const m = re.exec(f);
      if (m && (!best || Number(m[1]) > best.v)) best = { v: Number(m[1]), file: `${abs}/${f}`, rel: `${dir}/${f}` };
    }
  }
  return best;
}

export function loadManifest() {
  const f = rootPath('public/assets/manifest.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).assets : {};
}

// ───────────── 姿势与采样 ─────────────

export function bonesOf(model) {
  const out = [];
  model.traverse((o) => { if (o.isBone) out.push(o); });
  return out;
}

/** 骨架 + NativePose + 便捷查询（父骨骼、静止位置、深度） */
export class Skeleton {
  constructor(model) {
    this.host = new THREE.Group();
    this.host.add(model);
    this.host.updateMatrixWorld(true);
    this.model = model;
    this.bones = bonesOf(model);
    this.names = this.bones.map((b) => b.name);
    this.byName = new Map(this.bones.map((b) => [b.name, b]));
    this.P = new NativePose(model, this.host);
  }
  has(n) { return !!n && this.byName.has(n); }
  parent(n) { const p = this.byName.get(n)?.parent; return p?.isBone ? p.name : null; }
  children(n) { return (this.byName.get(n)?.children ?? []).filter((c) => c.isBone).map((c) => c.name); }
  depth(n) { let d = 0; for (let b = this.byName.get(n); b?.parent?.isBone; b = b.parent) d++; return d; }
  rest(n) { return this.P.restPosition(n)?.clone() ?? null; }
  /** a 是否是 b 的祖先（或就是 b） */
  isAncestor(a, b) { for (let x = this.byName.get(b); x; x = x.parent) if (x.name === a) return true; return false; }
  find(re) { return this.names.filter((n) => re.test(n)); }
}

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

/** 当前帧：每根骨骼在模型空间（host）的 [qx, qy, qz, qw, px, py, pz]（同 bake-native-anims.mjs sample） */
export function sampleFrame(sk) {
  sk.host.updateMatrixWorld(true);
  _inv.copy(sk.host.matrixWorld).invert();
  const f = new Array(sk.bones.length * 7);
  sk.bones.forEach((b, i) => {
    _m.multiplyMatrices(_inv, b.matrixWorld).decompose(_p, _q, _s);
    f[i * 7] = _q.x; f[i * 7 + 1] = _q.y; f[i * 7 + 2] = _q.z; f[i * 7 + 3] = _q.w;
    f[i * 7 + 4] = _p.x; f[i * 7 + 5] = _p.y; f[i * 7 + 6] = _p.z;
  });
  return f;
}

const r5 = (x) => Math.round(x * 1e5) / 1e5;

/**
 * 录一个片段：pose(t) 摆好骨骼（自己 reset），按 fps 采样。
 * 循环片段：dur 必须是整数帧，采 0..N 共 N+1 帧（含收尾帧，= 第 0 帧）；非循环同样含 t = dur 的末帧。
 * rootY(t) 可选：整体离地高度（Unity 里加到全部骨骼上）。events：[{ t, name }]
 */
export function recordClip(sk, fps, { dur, loop, pose, rootY, events = [], speed, next }) {
  const N = Math.round(dur * fps);
  if (loop && Math.abs(N - dur * fps) > 1e-6) throw new Error(`循环片段长度 ${dur}s 不是整数帧（${fps} fps）`);
  const frames = [], ry = [];
  for (let i = 0; i <= N; i++) {
    const t = i / fps;
    pose(t);
    frames.push(sampleFrame(sk).map(r5));
    ry.push(Math.round((rootY ? rootY(t) : 0) * 1e4) / 1e4);
  }
  const clip = { loop: !!loop, frames, rootY: ry, events: events.map((e) => ({ t: Math.round(e.t * 1000) / 1000, name: e.name })).sort((a, b) => a.t - b.t) };
  if (speed !== undefined) clip.speed = Math.round(speed * 1000) / 1000;
  if (next) clip.next = next;
  return clip;
}

// ───────────── 校验 ─────────────

const FOOT_RE = /(^|_)(foot|paw|hoof|fhoof|hhoof)(_[LR])?$|^(Left|Right)Foot$|^leg\d+_foot_[LR]$/i;

/** 按名字猜腿（同 CreatureRigBuilder：脚往上两节）；有 Skeleton 时按真实父子关系 */
export function legsOf(doc, sk) {
  const legs = [];
  const idx = new Map(doc.bones.map((b, i) => [b, i]));
  for (const end of doc.bones) {
    if (!FOOT_RE.test(end)) continue;
    let mid, upper;
    if (sk) { mid = sk.parent(end); upper = mid && sk.parent(mid); }
    else {
      const s = end.slice(-2);
      mid = /^(paw|fhoof)/.test(end) ? `forearm${s}` : `shin${s}`;
      upper = /^(paw|fhoof)/.test(end) ? `upperarm${s}` : `thigh${s}`;
    }
    if (!idx.has(mid) || !idx.has(upper) || /^(hips|pelvis)$/i.test(mid) || /^(hips|pelvis)$/i.test(upper)) continue;
    const P = (n) => { const i = idx.get(n) * 7; return [doc.rest[i + 4], doc.rest[i + 5], doc.rest[i + 6]]; };
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    legs.push({ end, mid, upper, i: idx.get(end), restLift: Math.max(0, P(end)[1]), len: d(P(upper), P(mid)) + d(P(mid), P(end)) });
  }
  return legs;
}

function quatAngle(a, i, b, j) {
  const na = Math.hypot(a[i], a[i + 1], a[i + 2], a[i + 3]), nb = Math.hypot(b[j], b[j + 1], b[j + 2], b[j + 3]);
  const dot = Math.abs(a[i] * b[j] + a[i + 1] * b[j + 1] + a[i + 2] * b[j + 2] + a[i + 3] * b[j + 3]) / (na * nb);
  return 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
}

/**
 * 每个片段：帧数、循环接缝误差（收尾帧 vs 第 0 帧；接缝处的帧间跳变 vs 片段内最大帧间跳变）、
 * 支撑相（同 CreatureRig：脚离地 − 静止踝高 < 0.08 腿长）的最大滑步（按录制速度换算到世界空间）与脚高偏差。
 */
export function validateDoc(doc, sk, opts = {}) {
  const fps = doc.fps;
  const legs = legsOf(doc, sk);
  const legLen = legs.length ? legs.reduce((s, l) => s + l.len, 0) / legs.length : 0;
  const nb = doc.bones.length;
  const rows = [], warnings = [];
  for (const [name, c] of Object.entries(doc.clips)) {
    const F = c.frames, n = F.length;
    const row = { name, frames: n, dur: (n - 1) / fps, loop: c.loop, speed: c.speed ?? 0, events: c.events.map((e) => `${e.name}@${e.t}`).join(' ') };
    // 帧间最大跳变（度 / 毫米）
    let step = 0, stepP = 0;
    const stepOf = (A, B) => {
      let a = 0, p = 0;
      for (let b = 0; b < nb; b++) {
        a = Math.max(a, quatAngle(A, b * 7, B, b * 7));
        p = Math.max(p, Math.hypot(A[b * 7 + 4] - B[b * 7 + 4], A[b * 7 + 5] - B[b * 7 + 5], A[b * 7 + 6] - B[b * 7 + 6]));
      }
      return [a, p];
    };
    for (let i = 1; i < n; i++) { const [a, p] = stepOf(F[i - 1], F[i]); step = Math.max(step, a); stepP = Math.max(stepP, p); }
    row.maxStepDeg = step;
    if (c.loop) {
      const [sa, sp] = stepOf(F[0], F[n - 1]);
      row.seamDeg = sa; row.seamMm = sp * 1000;
      const [ja] = stepOf(F[n - 1], F[1]); // 接缝处的帧间变化（收尾帧 → 第 1 帧）
      row.seamStepDeg = ja;
      if (sa > 0.05 || sp > 1e-4) warnings.push(`${name}: 循环收尾帧与第 0 帧不一致（${sa.toFixed(3)}°, ${(sp * 1000).toFixed(2)} mm）`);
      if (ja > step * 1.5 + 0.5) warnings.push(`${name}: 接缝处跳变 ${ja.toFixed(2)}°/帧 > 片段内最大 ${step.toFixed(2)}°/帧`);
    }
    // 脚：支撑相滑步、脚高
    if (legs.length) {
      const sp = c.speed ?? 0;
      const reps = c.loop ? 2 : 1; // 循环片段展开两遍，跨接缝的支撑段也能量到
      let slip = 0, sink = 0, hover = 0, stanceFrames = 0, total = 0;
      for (const l of legs) {
        let lock = null;
        for (let r = 0; r < reps; r++) {
          for (let i = 0; i < n - (c.loop ? 1 : 0); i++) {
            const t = (r * (n - 1) + i) / fps;
            const f = F[i];
            const y = f[l.i * 7 + 5] + (c.rootY?.[i] ?? 0);
            const x = f[l.i * 7 + 4], z = f[l.i * 7 + 6] + sp * t;
            const stance = y - l.restLift < l.len * 0.08;
            if (r === reps - 1) { total++; if (stance) stanceFrames++; }
            if (stance) {
              if (!lock) lock = { x, z };
              else slip = Math.max(slip, Math.hypot(x - lock.x, z - lock.z) * (r === reps - 1 || !c.loop ? 1 : 0));
              sink = Math.min(sink, y - l.restLift);
              hover = Math.max(hover, y - l.restLift);
            } else lock = null;
          }
        }
      }
      row.slipMm = slip * 1000;
      row.slipRatio = legLen ? slip / (legLen * 0.3) : 0;
      row.sinkMm = sink * 1000;
      row.stanceHoverMm = hover * 1000;
      row.stancePct = total ? (100 * stanceFrames) / total : 0;
      if (row.slipRatio > 0.5) warnings.push(`${name}: 支撑相滑步 ${row.slipMm.toFixed(0)} mm（脚锁 ${(legLen * 0.3 * 1000).toFixed(0)} mm 就会断开）`);
      if (sink < -0.003) warnings.push(`${name}: 支撑脚低于静止高度 ${(-sink * 1000).toFixed(1)} mm`);
    }
    rows.push(row);
  }
  // 状态机约定：片段名不带下划线、next 不成环、只有 Idle/Walk/Move 循环
  for (const [name, c] of Object.entries(doc.clips)) {
    if (name.includes('_')) warnings.push(`片段名 ${name} 带下划线`);
    if (['Idle', 'Walk', 'Move'].includes(name) !== !!c.loop) warnings.push(`${name}: loop = ${c.loop}`);
    const seen = new Set([name]);
    for (let x = c.next; x; x = doc.clips[x]?.next) {
      if (!doc.clips[x]) { warnings.push(`${name}: next → ${x} 不存在（会回到 Locomotion）`); break; }
      if (seen.has(x)) { warnings.push(`${name}: next 成环（${[...seen, x].join(' → ')}）`); break; }
      seen.add(x);
    }
  }
  // 连段：前一段末帧与 next 段首帧应一致（Unity 只给 0.05 s 过渡）
  for (const [name, c] of Object.entries(doc.clips)) {
    const nx = c.next && doc.clips[c.next];
    if (!nx) continue;
    const A = c.frames[c.frames.length - 1], B = nx.frames[0];
    let a = 0, p = 0;
    for (let b = 0; b < nb; b++) {
      a = Math.max(a, quatAngle(A, b * 7, B, b * 7));
      p = Math.max(p, Math.hypot(A[b * 7 + 4] - B[b * 7 + 4], A[b * 7 + 5] - B[b * 7 + 5], A[b * 7 + 6] - B[b * 7 + 6]));
    }
    const row = rows.find((r) => r.name === name);
    row.chain = `→${c.next} ${a.toFixed(2)}°/${(p * 1000).toFixed(1)}mm`;
    if (a > 3 || p > 0.005) warnings.push(`${name} → ${c.next}: 连段接缝 ${a.toFixed(1)}°, ${(p * 1000).toFixed(1)} mm`);
  }
  if (doc.clips.Hit) warnings.push('有 Hit 片段（灵宠无敌，不该有）');
  for (const k of ['Idle', 'Walk', 'Move']) if (!doc.clips[k]) warnings.push(`缺 ${k}`);
  const mv = doc.clips.Move?.speed, wk = doc.clips.Walk?.speed;
  if (mv && wk && !(wk < mv)) warnings.push(`Walk 速度 ${wk} ≥ Move ${mv}`);
  if (opts.gameplaySpeed && mv && opts.gameplaySpeed / mv > 2.5 + 1e-6)
    warnings.push(`玩法速度 ${opts.gameplaySpeed} / Move ${mv} = ${(opts.gameplaySpeed / mv).toFixed(2)}× > MoveScale 上限 2.5×`);
  // 骨骼覆盖：动过的骨骼数
  const moved = new Set();
  for (const c of Object.values(doc.clips)) for (const f of c.frames) for (let b = 0; b < nb; b++) {
    if (moved.has(b)) continue;
    if (quatAngle(f, b * 7, doc.rest, b * 7) > 0.1 || Math.hypot(f[b * 7 + 4] - doc.rest[b * 7 + 4], f[b * 7 + 5] - doc.rest[b * 7 + 5], f[b * 7 + 6] - doc.rest[b * 7 + 6]) > 1e-3) moved.add(b);
  }
  const still = doc.bones.filter((_, b) => !moved.has(b));
  return { rows, warnings, legs, legLen, still };
}

export function printReport(doc, v, title) {
  const f1 = (x, d = 1) => (x === undefined ? '—' : x.toFixed(d));
  console.log(`\n${title}  fps ${doc.fps}  骨骼 ${doc.bones.length}（静止不动：${v.still.length ? v.still.join(',') : '无'}）`);
  if (v.legs.length) console.log(`  腿 ${v.legs.length}：${v.legs.map((l) => `${l.end}(踝高 ${(l.restLift * 1000).toFixed(0)}mm)`).join(' ')}  平均腿长 ${(v.legLen * 1000).toFixed(0)} mm，脚锁断开阈值 ${(v.legLen * 300).toFixed(0)} mm`);
  console.log('  片段           帧   秒     循环 速度m/s  接缝°   接缝mm  接缝跳变°  最大跳变°/帧  支撑%  滑步mm  脚高(低/高)mm   事件');
  for (const r of v.rows) {
    console.log(`  ${r.name.padEnd(14)} ${String(r.frames).padStart(4)} ${f1(r.dur, 2).padStart(5)}  ${r.loop ? '↻' : ' '}   ${f1(r.speed, 2).padStart(6)}  ${r.loop ? f1(r.seamDeg, 3).padStart(6) : '     —'}  ${r.loop ? f1(r.seamMm, 2).padStart(6) : '     —'}  ${r.loop ? f1(r.seamStepDeg, 2).padStart(8) : '       —'}  ${f1(r.maxStepDeg, 2).padStart(11)}  ${r.slipMm === undefined ? '     —' : f1(r.stancePct, 0).padStart(5)}  ${r.slipMm === undefined ? '     —' : f1(r.slipMm, 1).padStart(6)}  ${r.slipMm === undefined ? '        —' : `${f1(r.sinkMm, 1)}/${f1(r.stanceHoverMm, 1)}`.padStart(13)}   ${r.events}${r.chain ? `  ${r.chain}` : ''}`);
  }
  for (const w of v.warnings) console.log(`  ⚠ ${w}`);
  if (!v.warnings.length) console.log('  ✔ 无警告');
}
